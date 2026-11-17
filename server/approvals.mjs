import { AppError, audit, clientFor, clientScope, decode, encode, id, iso, requireAdmin, requireHuman } from './store.mjs';
import { introStatuses } from '../public/account-fields.mjs';
import { bool, choice, day, json, list, nullable, object, str, validate } from './validation.mjs';

export const approvalKinds = ['email_draft', 'record_update', 'note', 'intro_update'];
export const approvalStatuses = ['pending', 'approved', 'rejected', 'done'];

// Tracker field names a record_update may carry, and the client columns they map to.
// Anything else (stage, fee, dates, SCA, invoices) is never changed by an approval.
const recordFields = { nxt: 'next_step', nxt_due: 'next_due', nxt_owner: 'next_owner', latest: 'latest' };
const recordFieldSchemas = { next_step: str(1000, 0), next_due: nullable(day), next_owner: str(120, 0), latest: str(4000, 0) };

export const approvalSchema = object({
  dedupe_key: str(250), client_id: str(80), kind: choice(...approvalKinds), trigger: str(120, 0), title: str(500),
  why: str(8000, 0), source: str(2000, 0), payload: json(),
}, ['dedupe_key', 'kind', 'title']);

const present = row => row && ({ ...row, payload: decode(row.payload) });
const clientLookup = `LEFT JOIN clients c ON c.id=a.client_id`;

// Clients the person can see, plus workspace-wide proposals for admins.
function scopeFor(actor, column) {
  const [scope, args] = clientScope(actor, column);
  const admin = actor.kind === 'user' && actor.role === 'admin';
  return [`((${column} IS NOT NULL AND (${scope}))${admin ? ` OR ${column} IS NULL` : ''})`, args];
}

async function approvalFor(store, actor, approvalId) {
  const [scope, args] = scopeFor(actor, 'a.client_id');
  const row = await store.get(`SELECT a.*,c.name AS client_name FROM approvals a ${clientLookup} WHERE a.id=? AND ${scope}`, approvalId, ...args);
  if (!row) throw new AppError(404, 'Approval not found.');
  return present(row);
}

// A proposal is stored once per dedupe key: a rejected or decided proposal is never proposed again.
export async function insertApproval(store, actor, data, { status = 'pending', createdAt = iso(), decision = {} } = {}) {
  if (data.client_id) await clientFor(store, actor, data.client_id);
  const existing = await store.get('SELECT id FROM approvals WHERE dedupe_key=?', data.dedupe_key);
  if (existing) return { ...present(await store.get('SELECT * FROM approvals WHERE id=?', existing.id)), duplicate: true };
  const approvalId = id();
  await store.run(`INSERT INTO approvals(id,dedupe_key,client_id,kind,trigger,status,title,why,source,payload,result,decided_by,decided_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, approvalId, data.dedupe_key, data.client_id ?? null, data.kind, data.trigger ?? '', status,
  data.title, data.why ?? '', data.source ?? '', encode(data.payload ?? {}), decision.result ?? '', decision.decided_by ?? null,
  decision.decided_at ?? null, createdAt);
  await audit(store, actor, 'approval.created', 'approval', approvalId, data.client_id ?? null, { kind: data.kind, dedupe_key: data.dedupe_key });
  return present(await store.get('SELECT * FROM approvals WHERE id=?', approvalId));
}

export async function createApproval(store, actor, input) {
  requireHuman(actor);
  const data = validate(approvalSchema, input);
  if (!data.client_id) requireAdmin(actor);
  return store.tx(() => insertApproval(store, actor, data));
}

export async function listApprovals(store, actor, { status = 'pending', client_id } = {}) {
  const [scope, args] = scopeFor(actor, 'a.client_id');
  const statuses = status === 'decided' ? ['approved', 'rejected', 'done'] : ['pending'];
  const rows = await store.all(`SELECT a.*,c.name AS client_name FROM approvals a ${clientLookup}
    WHERE ${scope} AND a.status IN (${statuses.map(() => '?').join(',')}) AND (?::text IS NULL OR a.client_id=?)
    ORDER BY ${status === 'decided' ? 'a.decided_at DESC NULLS LAST,' : ''} a.created_at DESC, a.id LIMIT 300`,
  ...args, ...statuses, client_id ?? null, client_id ?? null);
  const items = rows.map(present);
  // Show the current value beside each proposed record change so the approver sees what will be replaced.
  for (const item of items) {
    if (item.kind === 'record_update') item.changes = await describeChanges(store, item);
    if (item.kind === 'intro_update') item.changes = await describeIntroChanges(store, item);
  }
  return { items };
}

export async function pendingCount(store, actor) {
  const [scope, args] = scopeFor(actor, 'a.client_id');
  return (await store.get(`SELECT count(*) AS n FROM approvals a WHERE a.status='pending' AND ${scope}`, ...args)).n;
}

async function describeChanges(store, approval) {
  const fields = approval.payload?.fields ?? {};
  const client = approval.client_id ? await store.get('SELECT * FROM clients WHERE id=?', approval.client_id) : null;
  return Object.entries(fields).map(([field, value]) => {
    const column = recordFields[field];
    return { field, column: column ?? null, label: column ? column.replaceAll('_', ' ') : field, current: column && client ? client[column] ?? '' : '',
      proposed: value ?? '', supported: Boolean(column) };
  });
}

async function applyRecordUpdate(store, actor, approval) {
  if (!approval.client_id) throw new AppError(409, 'This proposal is not linked to a client, so there is nothing to update.');
  // Proposals from the old tracker name the record they target; only company records can change here.
  const path = String(approval.payload?.path ?? '');
  if (path && !path.startsWith('companies/')) throw new AppError(409, 'Only client next steps can be updated from an approval. Make this change by hand.');
  const changes = await describeChanges(store, approval);
  const unsupported = changes.filter(change => !change.supported).map(change => change.field);
  if (unsupported.length || !changes.length) throw new AppError(409, `These fields can't be changed from an approval: ${unsupported.join(', ') || 'none listed'}. Make this change by hand.`);
  const values = {};
  for (const change of changes) values[change.column] = validate(recordFieldSchemas[change.column], change.proposed === '' && change.column === 'next_due' ? null : change.proposed, change.label);
  const columns = Object.keys(values);
  await store.run(`UPDATE clients SET updated_at=?${columns.map(column => `,${column}=?`).join('')} WHERE id=?`, iso(), ...columns.map(column => values[column]), approval.client_id);
  await audit(store, actor, 'client.updated_from_approval', 'client', approval.client_id, approval.client_id, {
    approval_id: approval.id, changes: changes.map(change => ({ field: change.column, old: change.current, new: values[change.column] })),
  });
  return `Applied: ${changes.map(change => `${change.label} → ${values[change.column] ?? 'cleared'}`).join('; ')}`;
}

// ---- Intro updates: status and next step on one pipeline card ----
const introFieldLabels = { intro_status: 'intro status', next_step: 'next step' };

async function introCard(store, approval) {
  const cardId = String(approval.payload?.card_id ?? '');
  return cardId ? store.get('SELECT * FROM cards WHERE id=? AND client_id=?', cardId, approval.client_id) : null;
}

async function describeIntroChanges(store, approval) {
  const card = await introCard(store, approval);
  const fields = approval.payload?.fields ?? {};
  return Object.entries(fields).map(([field, value]) => ({ field, column: introFieldLabels[field] ? field : null,
    label: `${card?.company ?? 'Intro'}: ${introFieldLabels[field] ?? field}`, current: card?.[field] ?? '', proposed: value ?? '',
    supported: Boolean(introFieldLabels[field]) && Boolean(card) }));
}

async function applyIntroUpdate(store, actor, approval) {
  const card = await introCard(store, approval);
  if (!card) throw new AppError(409, 'That intro is no longer on the pipeline. Make this change by hand.');
  const fields = approval.payload?.fields ?? {};
  const status = fields.intro_status === undefined ? card.intro_status : validate(choice('', ...Object.keys(introStatuses)), fields.intro_status, 'Intro status');
  const nextStep = fields.next_step === undefined ? card.next_step : validate(str(300, 0), fields.next_step, 'Next step');
  const stage = introStatuses[status] ?? card.stage;
  const now = iso();
  await store.run(`UPDATE cards SET intro_status=?,next_step=?,stage=?,outcome=CASE WHEN ?='closed' THEN ? ELSE outcome END,
    entered_at=CASE WHEN stage=? THEN entered_at ELSE ? END,updated_at=?,version=version+1 WHERE id=?`,
  status, nextStep, stage, stage, status, stage, now, now, card.id);
  await audit(store, actor, 'card.updated_from_approval', 'card', card.id, card.client_id, { approval_id: approval.id,
    changes: [['intro_status', card.intro_status, status], ['next_step', card.next_step, nextStep]].filter(([, a, b]) => a !== b) });
  return `Applied to ${card.company}: ${[status !== card.intro_status && `status → ${status}`, nextStep !== card.next_step && 'next step updated'].filter(Boolean).join('; ') || 'no change needed'}`;
}

export async function decideApproval(store, actor, approvalId, input) {
  requireHuman(actor);
  const data = validate(object({ decision: choice('approve', 'reject'), note: str(2000, 0) }, ['decision']), input);
  return store.tx(async () => {
    const approval = await approvalFor(store, actor, approvalId);
    if (approval.status !== 'pending') throw new AppError(409, 'This proposal has already been decided.');
    let status = data.decision === 'reject' ? 'rejected' : approval.kind === 'note' ? 'done' : 'approved';
    let result = data.note ?? '';
    if (data.decision === 'approve' && approval.kind === 'record_update') result = [await applyRecordUpdate(store, actor, approval), result].filter(Boolean).join('. ');
    if (data.decision === 'approve' && approval.kind === 'intro_update') result = [await applyIntroUpdate(store, actor, approval), result].filter(Boolean).join('. ');
    if (data.decision === 'approve' && approval.kind === 'email_draft') result = result || 'Approved. Opened as a draft in the approver’s mail app; nothing was sent by the app.';
    await store.run('UPDATE approvals SET status=?,result=?,decided_by=?,decided_at=? WHERE id=?', status, result, actor.name, iso(), approvalId);
    await audit(store, actor, `approval.${data.decision === 'reject' ? 'rejected' : 'approved'}`, 'approval', approvalId, approval.client_id, { kind: approval.kind });
    return approvalFor(store, actor, approvalId);
  });
}

// ---- Activity log ----

const activitySchema = object({ client_id: str(80), text: str(4000), source: str(1000, 0), review: bool, at: str(40), shared: bool }, ['text']);
const presentActivity = row => row && ({ ...row, message_ids: decode(row.message_ids), review: Boolean(row.review), shared: Boolean(row.shared) });

export async function insertActivity(store, actor, data, createdAt = iso()) {
  if (data.client_id) await clientFor(store, actor, data.client_id);
  const entryId = id();
  await store.run(`INSERT INTO activity_log(id,client_id,company_label,at,text,source,review,message_ids,created_by,created_at,shared)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`, entryId, data.client_id ?? null, data.company_label ?? '', data.at ?? createdAt, data.text, data.source ?? '',
  data.review ? 1 : 0, encode(data.message_ids ?? []), actor.name ?? 'System', createdAt, data.shared && data.client_id ? 1 : 0);
  return presentActivity(await store.get('SELECT * FROM activity_log WHERE id=?', entryId));
}

export async function addActivity(store, actor, input) {
  requireHuman(actor);
  const data = validate(activitySchema, input);
  if (!data.client_id) requireAdmin(actor);
  if (data.shared && !data.client_id) throw new AppError(400, 'Only updates about a client can be shared with that client.');
  if (data.at && !Number.isFinite(Date.parse(data.at))) throw new AppError(400, 'Enter a valid date and time.');
  return store.tx(async () => {
    const entry = await insertActivity(store, actor, { ...data, source: data.source || `Logged by ${actor.name}`, at: data.at ? new Date(data.at).toISOString() : undefined });
    await audit(store, actor, 'activity.logged', 'activity_log', entry.id, data.client_id ?? null);
    return entry;
  });
}

export async function listActivityLog(store, actor, { client_id, review, before, limit = 60 } = {}) {
  const [scope, args] = scopeFor(actor, 'l.client_id');
  const rows = await store.all(`SELECT l.*,c.name AS client_name FROM activity_log l LEFT JOIN clients c ON c.id=l.client_id
    WHERE ${scope} AND (?::text IS NULL OR l.client_id=?) AND (?::int IS NULL OR l.review=?::int)
      AND (?::text IS NULL OR (l.at,l.id) < (split_part(?::text,'|',1), split_part(?::text,'|',2)))
    ORDER BY l.at DESC,l.id DESC LIMIT ?`, ...args, client_id ?? null, client_id ?? null, review ?? null, review ?? null,
  before ?? null, before ?? null, before ?? null, limit + 1);
  const items = rows.slice(0, limit).map(presentActivity);
  return { items, next: rows.length > limit ? `${items.at(-1).at}|${items.at(-1).id}` : null };
}

export async function reviewCount(store, actor) {
  const [scope, args] = scopeFor(actor, 'l.client_id');
  return (await store.get(`SELECT count(*) AS n FROM activity_log l WHERE l.review=1 AND ${scope}`, ...args)).n;
}

export async function markReviewed(store, actor, entryId) {
  requireHuman(actor);
  return store.tx(async () => {
    const [scope, args] = scopeFor(actor, 'l.client_id');
    const entry = await store.get(`SELECT l.* FROM activity_log l WHERE l.id=? AND ${scope}`, entryId, ...args);
    if (!entry) throw new AppError(404, 'Activity entry not found.');
    if (entry.review) {
      await store.run('UPDATE activity_log SET review=0,reviewed_by=?,reviewed_at=? WHERE id=?', actor.name, iso(), entryId);
      await audit(store, actor, 'activity.reviewed', 'activity_log', entryId, entry.client_id);
    }
    return presentActivity(await store.get('SELECT * FROM activity_log WHERE id=?', entryId));
  });
}

export const importedApprovalSchema = object({
  id: str(250), client_id: str(250), kind: choice(...approvalKinds), trigger: str(120, 0), status: choice(...approvalStatuses), title: str(500),
  why: str(8000, 0), source: str(2000, 0), payload: json(), result: str(8000, 0), decided_by: str(200, 0), decided_at: str(40, 0), created_at: str(40),
}, ['id', 'kind', 'status', 'title']);
export const importedActivitySchema = object({
  id: str(250), client_id: str(250), company_label: str(300, 0), at: str(40), text: str(8000), source: str(2000, 0), review: bool, message_ids: list(str(1000), 200),
}, ['id', 'at', 'text']);

// Share (or stop sharing) one client update with that client's portal.
export async function shareActivity(store, actor, entryId, input) {
  requireHuman(actor);
  const { shared } = validate(object({ shared: bool }), input);
  return store.tx(async () => {
    const row = await store.get('SELECT * FROM activity_log WHERE id=?', entryId);
    if (!row?.client_id) throw new AppError(404, 'Only updates about a client can be shared.');
    await clientFor(store, actor, row.client_id);
    await store.run('UPDATE activity_log SET shared=? WHERE id=?', shared ? 1 : 0, entryId);
    await audit(store, actor, shared ? 'portal.update_shared' : 'portal.update_unshared', 'activity_log', entryId, row.client_id);
    return presentActivity(await store.get('SELECT * FROM activity_log WHERE id=?', entryId));
  });
}
