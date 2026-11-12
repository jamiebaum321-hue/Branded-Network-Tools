import { createHmac } from 'node:crypto';
import { completeness, formVersion, intakeFields } from '../public/intake-fields.mjs';
import { phaseStages, stageIds, stageInfo } from '../public/lifecycle.mjs';
import { AppError, audit, canAccessClient, clientFor, clientScope, decode, digest, encode, id, iso, requireAdmin, requireHuman } from './store.mjs';
import { choice, day, email, int, list, nullable, object, str, validate, webLink } from './validation.mjs';
import { emit } from './events.mjs';
import { moveStage, timeline } from './lifecycle.mjs';

const accessFields = { owner_id: str(80), member_ids: list(str(80), 500) };
const detailFields = {
  name: str(180), stage: choice(...stageIds), website: str(600, 0), contact_name: str(150, 0), contact_title: str(160, 0),
  contact_email: str(254, 0), contact_phone: str(70, 0), monthly_value: nullable(int(0, 100000000)), source: str(200, 0),
  next_step: str(300, 0), next_step_at: nullable(str(10, 0)), started_on: nullable(str(10, 0)), closed_reason: str(600, 0),
};
const detailKeys = Object.keys(detailFields).filter(key => key !== 'stage');
const clientFields = { ...detailFields, ...accessFields };
const submissionFields = 's.id,s.client_id,s.version,s.form_version,s.submitted_at,s.source_ref';
const clientSelect = `c.*,u.name AS owner_name,
  (SELECT count(*) FROM cards p WHERE p.client_id=c.id AND p.stage<>'closed') AS open_cards,
  (SELECT count(*) FROM suggestions s WHERE s.client_id=c.id AND s.status='pending') AS pending_matches,
  (SELECT max(s.submitted_at) FROM submissions s WHERE s.client_id=c.id) AS latest_submission`;

function clientFilters(actor, { q, stage, phase, owner_id }) {
  const [scope, params] = clientScope(actor, 'c.id');
  const where = [`(${scope})`];
  if (q) { where.push('instr(lower(c.name),lower(?))>0'); params.push(q); }
  if (owner_id) { where.push('c.owner_id=?'); params.push(owner_id); }
  if (stage) { where.push('c.stage=?'); params.push(stage); }
  if (phase) {
    const selected = phaseStages(phase);
    where.push(`c.stage IN (${selected.map(() => '?').join(',')})`);
    params.push(...selected);
  }
  return [where.join(' AND '), params];
}

export function listClients(store, actor, { limit = 50, offset = 0, ...filters } = {}) {
  const [where, params] = clientFilters(actor, filters);
  const rows = store.all(`SELECT ${clientSelect} FROM clients c JOIN users u ON u.id=c.owner_id WHERE ${where}
    ORDER BY c.name COLLATE NOCASE,c.id LIMIT ? OFFSET ?`, ...params, limit + 1, offset);
  return { items: rows.slice(0, limit), next_offset: rows.length > limit ? offset + limit : null };
}

// One column per stage of the chosen phase, most recently updated first.
export function clientBoard(store, actor, { phase = 'sales', ...filters } = {}) {
  const [where, params] = clientFilters(actor, { ...filters, phase });
  const rows = store.all(`WITH listed AS (SELECT ${clientSelect},
      row_number() OVER(PARTITION BY c.stage ORDER BY coalesce(c.updated_at,c.created_at) DESC,c.id) AS rn,
      count(*) OVER(PARTITION BY c.stage) AS total, sum(coalesce(c.monthly_value,0)) OVER(PARTITION BY c.stage) AS value
    FROM clients c JOIN users u ON u.id=c.owner_id WHERE ${where})
    SELECT * FROM listed WHERE rn<=60 ORDER BY stage,rn`, ...params);
  return phaseStages(phase).map(stage => {
    const selected = rows.filter(row => row.stage === stage);
    return { stage, total: selected[0]?.total ?? 0, value: selected[0]?.value ?? 0,
      items: selected.map(({ total, value, rn, ...row }) => row) };
  });
}

function ensureActive(store, userId) {
  if (!store.get('SELECT 1 FROM users WHERE id=? AND enabled=1', userId)) throw new AppError(400, 'Choose an active account.');
}

function cleanDetails(data) {
  const result = { ...data };
  if (result.website !== undefined) result.website = webLink(result.website, 'Website');
  if (result.contact_email !== undefined) result.contact_email = email(result.contact_email, true);
  for (const key of ['next_step_at', 'started_on']) if (result[key] !== undefined) result[key] = day(result[key], true);
  return result;
}

// Used inside an existing transaction, including seed import and the local demo.
export function insertClient(store, actor, input, createdAt = iso()) {
  const data = cleanDetails(input);
  const clientId = id();
  const owner = data.owner_id ?? actor.id;
  ensureActive(store, owner);
  for (const userId of data.member_ids ?? []) ensureActive(store, userId);
  const stage = data.stage ?? 'delivering';
  if (stageInfo[stage].phase === 'closed' && !data.closed_reason) throw new AppError(400, 'Enter why this was closed.');
  store.run(`INSERT INTO clients(id,name,owner_id,created_at,stage,stage_entered_at,updated_at,website,contact_name,contact_title,
    contact_email,contact_phone,monthly_value,source,next_step,next_step_at,started_on,closed_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  clientId, data.name, owner, createdAt, stage, createdAt, createdAt, data.website ?? '', data.contact_name ?? '', data.contact_title ?? '',
  data.contact_email ?? '', data.contact_phone ?? '', data.monthly_value ?? null, data.source ?? '', data.next_step ?? '',
  data.next_step_at ?? null, data.started_on ?? null, data.closed_reason ?? '');
  for (const userId of new Set(data.member_ids ?? [])) store.run('INSERT INTO client_members VALUES(?,?)', clientId, userId);
  timeline(store, actor, clientId, { kind: 'stage', stage }, createdAt);
  audit(store, actor, 'client.created', 'client', clientId, clientId, { owner_id: owner, stage });
  return clientFor(store, actor, clientId);
}

// Any manager can open an opportunity they own. Assigning other people stays with admins.
export function createClient(store, actor, input) {
  requireHuman(actor);
  const data = validate(object(clientFields, ['name']), input);
  if (actor.role !== 'admin' && ((data.owner_id && data.owner_id !== actor.id) || data.member_ids?.length)) requireAdmin(actor);
  return store.tx(() => insertClient(store, actor, { stage: 'prospect', ...data }));
}

export function updateClient(store, actor, clientId, input) {
  requireHuman(actor);
  const data = cleanDetails(validate(object(clientFields, []), input));
  if (data.owner_id !== undefined || data.member_ids !== undefined) requireAdmin(actor);
  return store.tx(() => {
    const previous = clientFor(store, actor, clientId);
    const next = { ...previous, ...data };
    const closing = data.stage && data.stage !== previous.stage && stageInfo[data.stage].phase === 'closed';
    if (closing && !data.closed_reason) throw new AppError(400, 'Enter why this is being closed.');
    ensureActive(store, next.owner_id);
    const changed = detailKeys.filter(key => previous[key] !== next[key]);
    if (changed.length || next.owner_id !== previous.owner_id) {
      store.run(`UPDATE clients SET name=?,owner_id=?,website=?,contact_name=?,contact_title=?,contact_email=?,contact_phone=?,monthly_value=?,
        source=?,next_step=?,next_step_at=?,started_on=?,closed_reason=?,updated_at=? WHERE id=?`, next.name, next.owner_id, next.website,
      next.contact_name, next.contact_title, next.contact_email, next.contact_phone, next.monthly_value, next.source, next.next_step,
      next.next_step_at, next.started_on, next.closed_reason, iso(), clientId);
    }
    if (data.member_ids) {
      for (const userId of data.member_ids) ensureActive(store, userId);
      store.run('DELETE FROM client_members WHERE client_id=?', clientId);
      for (const userId of new Set(data.member_ids)) store.run('INSERT INTO client_members VALUES(?,?)', clientId, userId);
    }
    const activeOwners = store.all(`SELECT DISTINCT p.owner_id AS id FROM cards p JOIN users u ON u.id=p.owner_id
      WHERE p.client_id=? AND p.stage<>'closed' AND u.enabled=1`, clientId);
    if (activeOwners.some(user => !canAccessClient(store, user.id, clientId))) {
      throw new AppError(409, 'Reassign this client’s open cards before removing their owner’s access.');
    }
    if (data.stage) moveStage(store, actor, previous, data.stage, closing ? next.closed_reason : '');
    audit(store, actor, 'client.updated', 'client', clientId, clientId, { fields: Object.keys(data), owner_id: next.owner_id });
    return clientFor(store, actor, clientId);
  });
}

export function addClientNote(store, actor, clientId, input) {
  requireHuman(actor);
  const data = validate(object({ body: str(4000) }), input);
  return store.tx(() => {
    clientFor(store, actor, clientId);
    const noteId = timeline(store, actor, clientId, { kind: 'note', body: data.body });
    store.run('UPDATE clients SET updated_at=? WHERE id=?', iso(), clientId);
    audit(store, actor, 'client.note_added', 'client', clientId, clientId);
    return { id: noteId };
  });
}

export function clientTimeline(store, actor, clientId, { before, limit = 25 } = {}) {
  clientFor(store, actor, clientId);
  const rows = store.all(`SELECT seq,id,kind,from_stage,stage,body,actor,at FROM client_timeline WHERE client_id=? AND (? IS NULL OR seq<?)
    ORDER BY seq DESC LIMIT ?`, clientId, before ?? null, before ?? null, limit + 1);
  const items = rows.slice(0, limit);
  return { items, next_cursor: rows.length > limit ? items.at(-1).seq : null };
}

// The profile is the newest saved version of the onboarding answers.
export function clientProfile(store, clientId) {
  const row = store.get(`SELECT ${submissionFields},s.answers FROM submissions s WHERE s.client_id=?
    ORDER BY s.submitted_at DESC,s.version DESC LIMIT 1`, clientId);
  if (!row) return null;
  const answers = decode(row.answers);
  return { ...row, answers, completeness: completeness(answers) };
}

function activeLink(store, clientId) {
  return store.get(`SELECT public_id,expires_at,created_at,draft<>'{}' AS started FROM form_links WHERE client_id=? AND revoked=0
    AND expires_at>? AND submission_id IS NULL ORDER BY created_at DESC LIMIT 1`, clientId, Date.now()) ?? null;
}

export function clientDetail(store, actor, clientId) {
  const client = clientFor(store, actor, clientId);
  const link = activeLink(store, clientId);
  const counts = store.get(`SELECT
    (SELECT count(*) FROM suggestions WHERE client_id=c.id AND status='pending') AS matches_pending,
    (SELECT count(*) FROM suggestions WHERE client_id=c.id) AS matches_total,
    (SELECT count(*) FROM cards WHERE client_id=c.id AND stage<>'closed') AS cards_open,
    (SELECT count(*) FROM cards WHERE client_id=c.id AND stage='in_conversation') AS in_conversation,
    (SELECT count(*) FROM cards WHERE client_id=c.id) AS cards_total,
    (SELECT count(*) FROM report_entries WHERE client_id=c.id) AS report_entries
    FROM clients c WHERE c.id=?`, clientId);
  return {
    client, counts, profile: clientProfile(store, clientId), timeline: clientTimeline(store, actor, clientId),
    link: link && { expires_at: link.expires_at, created_at: link.created_at, started: Boolean(link.started) },
    submissions: listSubmissions(store, actor, clientId, {}),
    member_ids: store.all('SELECT user_id FROM client_members WHERE client_id=? ORDER BY user_id', clientId).map(row => row.user_id),
    owners: store.all(`SELECT id,name FROM users WHERE enabled=1 AND (role='admin' OR id=? OR id IN (
      SELECT user_id FROM client_members WHERE client_id=?)) ORDER BY name`, client.owner_id, clientId),
  };
}

function formToken(publicId, secret) {
  return `${publicId}.${createHmac('sha256', secret).update(`onboarding:${publicId}`).digest('base64url')}`;
}

// Returns the active onboarding link, creating one when none is open. Call inside a transaction.
function formLink(store, actor, clientId, secret) {
  const active = activeLink(store, clientId);
  const publicId = active?.public_id ?? id();
  const value = formToken(publicId, secret);
  const expiresAt = active?.expires_at ?? Date.now() + 14 * 86400000;
  if (!active) {
    store.run('INSERT INTO form_links(token_hash,public_id,client_id,expires_at,created_at) VALUES(?,?,?,?,?)',
      digest(value), publicId, clientId, expiresAt, iso());
  } else if (!store.get('SELECT 1 FROM form_links WHERE token_hash=?', digest(value))) {
    throw new AppError(409, 'The form link was signed with an older secret. Revoke it and create a new link.');
  }
  audit(store, actor, active ? 'intake.link_copied' : 'intake.link_created', 'client', clientId, clientId);
  return { path: `/onboard/${value}`, expires_at: new Date(expiresAt).toISOString() };
}

export function copyFormLink(store, actor, clientId, secret) {
  requireHuman(actor);
  return store.tx(() => {
    clientFor(store, actor, clientId);
    return formLink(store, actor, clientId, secret);
  });
}

// Moves a won opportunity into onboarding and hands back the link to send to the client.
export function startOnboarding(store, actor, clientId, secret) {
  requireHuman(actor);
  return store.tx(() => {
    const client = clientFor(store, actor, clientId);
    if (stageInfo[client.stage].phase === 'closed') throw new AppError(409, 'Reopen this client before starting onboarding.');
    if (stageInfo[client.stage].phase === 'sales') moveStage(store, actor, client, 'onboarding', 'Onboarding started.');
    return { ...formLink(store, actor, clientId, secret), client: clientFor(store, actor, clientId) };
  });
}

export function revokeFormLinks(store, actor, clientId) {
  requireHuman(actor);
  return store.tx(() => {
    clientFor(store, actor, clientId);
    const result = store.run(`UPDATE form_links SET revoked=1,draft='{}' WHERE client_id=? AND revoked=0 AND submission_id IS NULL`, clientId);
    audit(store, actor, 'intake.links_revoked', 'client', clientId, clientId, { count: result.changes });
    return { ok: true };
  });
}

const fieldSchema = field => field.rows ? list(object(Object.fromEntries(field.rows.map(child => [child.key, fieldSchema(child)])), []), 40)
  : field.type === 'number' ? int(0, 10000000)
    : field.type === 'multi' ? list(choice(...field.options), field.options.length)
      : field.type === 'select' ? choice('', ...field.options) : str(field.max ?? 500, 0);
const intakeSchema = object(Object.fromEntries(intakeFields.map(field => [field.key, fieldSchema(field)])), []);

function validLink(value) {
  if (!/^[0-9a-f-]{36}\.[a-zA-Z0-9_-]{43}$/.test(value)) throw new AppError(404, 'Form link not found.');
  return digest(value);
}

function getFormLink(store, value, secret) {
  const hash = validLink(value);
  if (value !== formToken(value.split('.')[0], secret)) throw new AppError(404, 'Form link not found.');
  const row = store.get(`SELECT f.*,c.name AS client_name FROM form_links f JOIN clients c ON c.id=f.client_id
    WHERE f.token_hash=?`, hash);
  if (!row) throw new AppError(404, 'Form link not found.');
  if (row.revoked || row.expires_at <= Date.now()) throw new AppError(410, 'This form link has expired. Ask your contact for a new link.');
  return row;
}

function normalizeField(field, value) {
  if (field.rows) return value.map(row => Object.fromEntries(field.rows.filter(child => Object.hasOwn(row, child.key))
    .map(child => [child.key, normalizeField(child, row[child.key])]))).filter(row => Object.values(row).some(Boolean));
  if (field.type === 'multi') return [...new Set(value)];
  if (field.type === 'email' && value) return email(value);
  if (field.type === 'url' && value) {
    let url;
    try { url = new URL(value); } catch { throw new AppError(400, `${field.label} must be a complete URL.`); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new AppError(400, `${field.label} must be a web URL.`);
    }
  }
  return value;
}

export function intakeAnswers(input, { complete = false } = {}) {
  const data = validate(intakeSchema, input);
  for (const field of intakeFields) {
    if (complete && field.required && !data[field.key]) throw new AppError(400, `${field.label} is required.`);
    if (Object.hasOwn(data, field.key)) data[field.key] = normalizeField(field, data[field.key]);
  }
  if (Buffer.byteLength(encode(data)) > 180000) throw new AppError(413, 'The form is too large. Use links for long lists.');
  return data;
}

export function publicForm(store, value, secret) {
  const row = getFormLink(store, value, secret);
  // Returning clients start from their last answers so an update is quick.
  const previous = row.submission_id ? null : clientProfile(store, row.client_id)?.answers;
  return { client_name: row.client_name, submitted: Boolean(row.submission_id),
    draft: row.submission_id ? {} : { company: row.client_name, ...previous, ...decode(row.draft) } };
}

export function saveIntake(store, value, input, secret) {
  const data = intakeAnswers(input);
  return store.tx(() => {
    const row = getFormLink(store, value, secret);
    if (row.submission_id) throw new AppError(409, 'This form was already submitted.');
    store.run('UPDATE form_links SET draft=? WHERE token_hash=?', encode(data), row.token_hash);
    return { ok: true };
  });
}

export function insertSubmission(store, actor, clientId, answers, options = {}) {
  const next = store.get('SELECT coalesce(max(version),0)+1 AS version FROM submissions WHERE client_id=?', clientId).version;
  const submissionId = id();
  const at = options.submittedAt ?? iso();
  store.run(`INSERT INTO submissions(id,client_id,version,form_version,submitted_at,answers,source_ref)
    VALUES(?,?,?,?,?,?,?)`, submissionId, clientId, next, options.formVersion ?? (options.imported ? 1 : formVersion), at,
  encode(answers), options.sourceRef ?? null);
  const action = options.imported ? 'intake.imported' : options.staff ? 'profile.edited' : 'intake.submitted';
  audit(store, actor, action, 'submission', submissionId, clientId, { version: next });
  if (!options.imported && !options.staff) emit(store, { type: 'onboarding_submitted', key: `submission:${submissionId}`,
    clientId, recordId: submissionId, title: 'New onboarding submission', at, payload: { version: next } });
  return { id: submissionId, client_id: clientId, version: next, submitted_at: at };
}

// Fills empty client contact fields from the answers. Existing values are never overwritten.
function adoptContact(store, clientId, answers) {
  const client = store.get('SELECT * FROM clients WHERE id=?', clientId);
  const pairs = [['contact_name', answers.contact_name], ['contact_title', answers.contact_title], ['contact_email', answers.contact_email],
    ['contact_phone', answers.phone], ['website', answers.website]].filter(([key, value]) => value && !client[key]);
  for (const [key, value] of pairs) store.run(`UPDATE clients SET ${key}=?,updated_at=? WHERE id=?`, value, iso(), clientId);
  return client;
}

export function submitIntake(store, value, input, secret) {
  return store.tx(() => {
    const row = getFormLink(store, value, secret);
    if (row.submission_id) return store.get('SELECT id,client_id,version,submitted_at FROM submissions WHERE id=?', row.submission_id);
    const data = intakeAnswers(input, { complete: true });
    const actor = { kind: 'external', name: 'Client form', id: null };
    const submitted = insertSubmission(store, actor, row.client_id, data);
    store.run("UPDATE form_links SET submission_id=?,draft='{}' WHERE token_hash=?", submitted.id, row.token_hash);
    const client = adoptContact(store, row.client_id, data);
    if (['won', 'onboarding'].includes(client.stage)) moveStage(store, actor, client, 'matching', 'Onboarding form submitted.');
    return submitted;
  });
}

// A manager's correction to the profile is saved as a new version, so history is kept.
export function saveProfile(store, actor, clientId, input) {
  requireHuman(actor);
  const data = intakeAnswers(input);
  return store.tx(() => {
    clientFor(store, actor, clientId);
    const saved = insertSubmission(store, actor, clientId, data, { staff: true, sourceRef: `Edited by ${actor.name}` });
    adoptContact(store, clientId, data);
    return saved;
  });
}

export function listSubmissions(store, actor, clientId, { before, limit = 30 }) {
  clientFor(store, actor, clientId);
  const rows = store.all(`SELECT ${submissionFields} FROM submissions s WHERE s.client_id=? AND (? IS NULL OR s.version<?)
    ORDER BY s.version DESC LIMIT ?`, clientId, before ?? null, before ?? null, limit + 1);
  const items = rows.slice(0, limit);
  return { items, next_cursor: rows.length > limit ? items.at(-1).version : null };
}

export function getSubmission(store, actor, clientId, submissionId) {
  const client = clientFor(store, actor, clientId);
  const row = store.get(`SELECT ${submissionFields},s.answers FROM submissions s WHERE s.client_id=? AND (? IS NULL OR s.id=?)
    ORDER BY s.submitted_at DESC,s.version DESC LIMIT 1`, clientId, submissionId ?? null, submissionId ?? null);
  if (!row) throw new AppError(404, 'Submission not found.');
  return { ...row, client_name: client.name, answers: decode(row.answers) };
}
