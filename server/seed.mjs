import { AppError, audit, clientFor, requireAdmin } from './store.mjs';
import { insertClient, insertSubmission, intakeAnswers } from './clients.mjs';
import { appendActivity, evidenceSchema, importOutreach, insertCard, insertSuggestion, stages } from './pipeline.mjs';
import { choice, email, int, num, object, str, time, validate } from './validation.mjs';

const identity = { id: str(250), client_id: str(250) };
const dates = { created_at: str(40), entered_at: str(40) };
const card = { company: str(180), person: str(150, 0), title: str(160, 0), email: str(254, 0),
  owner_email: str(254), stage: choice(...stages), next_step: str(300, 0), outcome: str(300, 0), due_at: str(40, 0),
  branded_relationship: str(600, 0), ...dates };
const definitions = {
  clients: object({ id: str(250), name: str(180), owner_email: str(254), created_at: str(40) }, ['id', 'name']),
  partners: object({ ...identity, ...card, fit_reason: str(2500, 0) }, ['id', 'client_id', 'company']),
  introductions: object({ ...identity, ...card, partner_id: str(250), occurred_at: str(40), status: str(150, 0), notes: str(4000, 0) }, ['id', 'client_id']),
  outreach_activity: object({ ...identity, partner_id: str(250), kind: choice('sent', 'reply', 'note'), occurred_at: str(40),
    subject: str(300, 0), body: str(4000, 0), message_reference: str(600, 0), mailbox_scope: str(160), outlook_message_id: str(1000) },
  ['id', 'client_id', 'partner_id', 'kind', 'occurred_at']),
  suggested_leads: object({ ...identity, company: str(180), person: str(150, 0), title: str(160, 0), email: str(254, 0),
    reason: str(2500), source: str(160), fit: str(120), evidence: evidenceSchema, branded_relationship: str(600),
    score: num(-1000000, 1000000), candidate_key: str(400), reviewer_email: str(254), created_at: str(40),
    status: choice('new', 'pending', 'pending_review') }, ['id', 'client_id', 'company', 'reason', 'source']),
  onboarding_submissions: object({ ...identity, submitted_at: str(40), form_version: int(1, 10000),
    source_ref: str(600, 0), answers: object({}, []) }, ['id', 'client_id', 'submitted_at', 'answers']),
};

async function accountId(store, address) {
  if (!address) return undefined;
  const row = await store.get('SELECT id FROM users WHERE email=? AND enabled=1', email(address));
  if (!row) throw new AppError(400, 'The specified owner or reviewer does not have an active account.');
  return row.id;
}

async function imported(store, namespace, kind, sourceId) {
  return (await store.get('SELECT local_id FROM imported_records WHERE namespace=? AND kind=? AND source_id=?', namespace, kind, sourceId))?.local_id;
}

function normalizedInput(kind, raw) {
  if (kind !== 'onboarding_submissions') return validate(definitions[kind], raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError(400, 'Expected a submission record.');
  const validated = validate(definitions[kind], { ...raw, answers: {} });
  validated.answers = intakeAnswers(raw.answers);
  return validated;
}

async function writeRow(store, actor, namespace, kind, row) {
  if (kind === 'clients') return (await insertClient(store, actor, { name: row.name, owner_id: await accountId(store, row.owner_email) },
    row.created_at ? time(row.created_at) : undefined)).id;
  const clientId = await imported(store, namespace, 'clients', row.client_id);
  if (!clientId) throw new AppError(400, `Client reference ${row.client_id} was not found in this import namespace.`);
  const client = await clientFor(store, actor, clientId);
  if (kind === 'onboarding_submissions') {
    return (await insertSubmission(store, actor, clientId, row.answers, { imported: true, submittedAt: time(row.submitted_at),
      formVersion: row.form_version, sourceRef: row.source_ref || `${namespace}:${row.id}` })).id;
  }
  if (kind === 'suggested_leads') {
    return (await insertSuggestion(store, actor, { ...row, client_id: clientId, reviewer_id: await accountId(store, row.reviewer_email),
      candidate_key: row.candidate_key ?? `${namespace}:${row.id}`, fit: row.fit ?? 'Unknown', evidence: row.evidence ?? [],
      branded_relationship: row.branded_relationship ?? 'Unknown' }, row.created_at ? time(row.created_at) : undefined)).id;
  }
  const createPipelineCard = async () => {
    if (!row.company) throw new AppError(400, 'A company is required when an introduction has no partner reference.');
    const createdAt = row.created_at ? time(row.created_at) : row.occurred_at ? time(row.occurred_at) : undefined;
    const enteredAt = row.entered_at ? time(row.entered_at) : createdAt;
    if (createdAt && enteredAt && enteredAt < createdAt) throw new AppError(400, 'The stage date is earlier than the card creation date.');
    return insertCard(store, actor, { ...row, client_id: clientId, owner_id: (await accountId(store, row.owner_email)) ?? client.owner_id,
      stage: row.stage ?? (kind === 'introductions' ? 'in_conversation' : 'to_contact') }, { createdAt, enteredAt, reason: row.fit_reason ?? '' });
  };
  if (kind === 'partners') return (await createPipelineCard()).id;
  const partnerId = row.partner_id ? await imported(store, namespace, 'partners', row.partner_id) : null;
  if (row.partner_id && !partnerId) throw new AppError(400, `Partner reference ${row.partner_id} was not found.`);
  const pipelineCard = partnerId ? await store.get('SELECT * FROM cards WHERE id=? AND client_id=?', partnerId, clientId) : await createPipelineCard();
  if (!pipelineCard) throw new AppError(400, 'The partner reference belongs to a different client.');
  if (kind === 'outreach_activity') return (await importOutreach(store, actor, pipelineCard, { ...row, occurred_at: time(row.occurred_at) })).id;
  return (await appendActivity(store, actor, pipelineCard, { kind: 'introduction', body: row.notes ?? '',
    occurred_at: row.occurred_at ? time(row.occurred_at) : row.created_at ? time(row.created_at) : undefined,
    detail: { status: row.status ?? '', source_id: row.id, outcome: row.outcome ?? '' } }, { emitReply: false })).id;
}

class Preview extends Error {
  constructor(result) { super('Import preview'); this.result = result; }
}

export async function importSeed(store, actor, input, preview = false) {
  requireAdmin(actor);
  const kinds = Object.keys(definitions);
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1
    || Object.keys(input).some(key => !['version', 'namespace', ...kinds].includes(key))) {
    throw new AppError(400, 'Use the version 1 JSON import format documented in the repository.');
  }
  const namespace = validate(str(120), input.namespace, 'Import namespace');
  if (kinds.some(kind => input[kind] !== undefined && !Array.isArray(input[kind]))) throw new AppError(400, 'Each record set must be an array.');
  if (kinds.reduce((total, kind) => total + (input[kind]?.length ?? 0), 0) > 5000) {
    throw new AppError(413, 'Use a maximum of 5,000 records per batch. Keep the same namespace across batches.');
  }
  try {
    return await store.tx(async () => {
      const result = { namespace, counts: {}, errors: [] };
      for (const kind of kinds) {
        const counts = result.counts[kind] = { added: 0, skipped: 0, invalid: 0 };
        const seen = new Set();
        const rows = input[kind] ?? [];
        for (let index = 0; index < rows.length; index++) {
          await store.exec('SAVEPOINT seed_row');
          try {
            const row = normalizedInput(kind, rows[index]);
            if (seen.has(row.id)) throw new AppError(400, 'The export contains a duplicate source ID.');
            seen.add(row.id);
            if (await imported(store, namespace, kind, row.id)) counts.skipped++;
            else {
              const localId = await writeRow(store, actor, namespace, kind, row);
              await store.run('INSERT INTO imported_records VALUES(?,?,?,?)', namespace, kind, row.id, localId);
              counts.added++;
            }
          } catch (error) {
            await store.exec('ROLLBACK TO seed_row');
            if (!(error instanceof AppError)) throw error;
            counts.invalid++;
            if (result.errors.length < 100) result.errors.push({ set: kind, row: index + 1, message: error.message });
          } finally {
            await store.exec('RELEASE seed_row');
          }
        }
      }
      if (preview) throw new Preview(result);
      if (result.errors.length) throw new AppError(400, 'Fix the import errors before loading the data.', result);
      await audit(store, actor, 'seed.imported', 'import', null, null, { namespace, counts: result.counts });
      return result;
    });
  } catch (error) {
    if (error instanceof Preview) return error.result;
    throw error;
  }
}
