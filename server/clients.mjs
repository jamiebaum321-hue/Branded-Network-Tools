import { createHmac } from 'node:crypto';
import { sections } from '../public/intake-fields.mjs';
import { AppError, audit, canAccessClient, clientFor, clientScope, decode, digest, encode, id, iso, requireAdmin, requireHuman } from './store.mjs';
import { email, int, list, object, str, validate } from './validation.mjs';
import { emit } from './events.mjs';

const clientFields = { name: str(180), owner_id: str(80), member_ids: list(str(80), 500) };
const submissionFields = 's.id,s.client_id,s.version,s.form_version,s.submitted_at,s.source_ref';

export async function listClients(store, actor, { q, limit = 50, offset = 0 } = {}) {
  const [scope, params] = clientScope(actor, 'c.id');
  const rows = await store.all(`SELECT c.*,u.name AS owner_name,
    (SELECT count(*) FROM cards p WHERE p.client_id=c.id AND p.stage<>'closed') AS open_cards,
    (SELECT max(s.submitted_at) FROM submissions s WHERE s.client_id=c.id) AS latest_submission
    FROM clients c JOIN users u ON u.id=c.owner_id WHERE (${scope}) AND (?::text IS NULL OR strpos(lower(c.name),lower(?::text))>0)
    ORDER BY lower(c.name),c.id LIMIT ? OFFSET ?`, ...params, q ?? null, q ?? null, limit + 1, offset);
  return { items: rows.slice(0, limit), next_offset: rows.length > limit ? offset + limit : null };
}

async function ensureActive(store, userId) {
  if (!await store.get('SELECT 1 FROM users WHERE id=? AND enabled=1', userId)) throw new AppError(400, 'Choose an active account.');
}

export async function insertClient(store, actor, data, createdAt = iso()) {
  const clientId = id();
  const owner = data.owner_id ?? actor.id;
  await ensureActive(store, owner);
  for (const userId of data.member_ids ?? []) await ensureActive(store, userId);
  await store.run('INSERT INTO clients VALUES(?,?,?,?)', clientId, data.name, owner, createdAt);
  for (const userId of new Set(data.member_ids ?? [])) await store.run('INSERT INTO client_members VALUES(?,?)', clientId, userId);
  await audit(store, actor, 'client.created', 'client', clientId, clientId, { owner_id: owner });
  return clientFor(store, actor, clientId);
}

export async function createClient(store, actor, input) {
  requireAdmin(actor);
  const data = validate(object(clientFields, ['name']), input);
  return store.tx(() => insertClient(store, actor, data));
}

export async function updateClient(store, actor, clientId, input) {
  requireAdmin(actor);
  const data = validate(object(clientFields, []), input);
  return store.tx(async () => {
    const previous = await clientFor(store, actor, clientId);
    const owner = data.owner_id ?? previous.owner_id;
    await ensureActive(store, owner);
    await store.run('UPDATE clients SET name=?,owner_id=? WHERE id=?', data.name ?? previous.name, owner, clientId);
    if (data.member_ids) {
      for (const userId of data.member_ids) await ensureActive(store, userId);
      await store.run('DELETE FROM client_members WHERE client_id=?', clientId);
      for (const userId of new Set(data.member_ids)) await store.run('INSERT INTO client_members VALUES(?,?)', clientId, userId);
    }
    const activeOwners = await store.all(`SELECT DISTINCT p.owner_id AS id FROM cards p JOIN users u ON u.id=p.owner_id
      WHERE p.client_id=? AND p.stage<>'closed' AND u.enabled=1`, clientId);
    for (const user of activeOwners) if (!await canAccessClient(store, user.id, clientId)) {
      throw new AppError(409, 'Reassign this client’s open cards before removing their owner’s access.');
    }
    await audit(store, actor, 'client.updated', 'client', clientId, clientId, { fields: Object.keys(data), owner_id: owner });
    return clientFor(store, actor, clientId);
  });
}

export async function clientDetail(store, actor, clientId) {
  const client = await clientFor(store, actor, clientId);
  const link = await store.get(`SELECT expires_at,created_at FROM form_links WHERE client_id=? AND revoked=0
    AND expires_at>? AND submission_id IS NULL ORDER BY created_at DESC LIMIT 1`, clientId, Date.now()) ?? null;
  return {
    client, link, submissions: await listSubmissions(store, actor, clientId, {}),
    member_ids: (await store.all('SELECT user_id FROM client_members WHERE client_id=? ORDER BY user_id', clientId)).map(row => row.user_id),
    owners: await store.all(`SELECT id,name FROM users WHERE enabled=1 AND (role='admin' OR id=? OR id IN (
      SELECT user_id FROM client_members WHERE client_id=?)) ORDER BY name`, client.owner_id, clientId),
  };
}

function formToken(publicId, secret) {
  return `${publicId}.${createHmac('sha256', secret).update(`onboarding:${publicId}`).digest('base64url')}`;
}

export async function copyFormLink(store, actor, clientId, secret) {
  requireHuman(actor);
  return store.tx(async () => {
    await clientFor(store, actor, clientId);
    const active = await store.get(`SELECT public_id,expires_at FROM form_links WHERE client_id=? AND revoked=0
      AND expires_at>? AND submission_id IS NULL ORDER BY created_at DESC LIMIT 1`, clientId, Date.now());
    const publicId = active?.public_id ?? id();
    const value = formToken(publicId, secret);
    const expiresAt = active?.expires_at ?? Date.now() + 14 * 86400000;
    if (!active) {
      await store.run('INSERT INTO form_links(token_hash,public_id,client_id,expires_at,created_at) VALUES(?,?,?,?,?)',
        digest(value), publicId, clientId, expiresAt, iso());
    } else if (!await store.get('SELECT 1 FROM form_links WHERE token_hash=?', digest(value))) {
      throw new AppError(409, 'The form link was signed with an older secret. Revoke it and create a new link.');
    }
    await audit(store, actor, active ? 'intake.link_copied' : 'intake.link_created', 'client', clientId, clientId);
    return { path: `/onboard/${value}`, expires_at: new Date(expiresAt).toISOString() };
  });
}

export async function revokeFormLinks(store, actor, clientId) {
  requireHuman(actor);
  return store.tx(async () => {
    await clientFor(store, actor, clientId);
    const result = await store.run(`UPDATE form_links SET revoked=1,draft='{}' WHERE client_id=? AND revoked=0 AND submission_id IS NULL`, clientId);
    await audit(store, actor, 'intake.links_revoked', 'client', clientId, clientId, { count: result.changes });
    return { ok: true };
  });
}

const intakeFields = sections.flatMap(section => section.fields);
const fieldSchema = field => field.rows ? list(object(Object.fromEntries(field.rows.map(child => [child.key, fieldSchema(child)])), []), 40)
  : field.type === 'number' ? int(0, 10000000) : str(field.max ?? 500, 0);
const intakeSchema = object(Object.fromEntries(intakeFields.map(field => [field.key, fieldSchema(field)])), []);

function validLink(value) {
  if (!/^[0-9a-f-]{36}\.[a-zA-Z0-9_-]{43}$/.test(value)) throw new AppError(404, 'Form link not found.');
  return digest(value);
}

async function getFormLink(store, value, secret) {
  const hash = validLink(value);
  if (value !== formToken(value.split('.')[0], secret)) throw new AppError(404, 'Form link not found.');
  const row = await store.get(`SELECT f.*,c.name AS client_name FROM form_links f JOIN clients c ON c.id=f.client_id
    WHERE f.token_hash=?`, hash);
  if (!row) throw new AppError(404, 'Form link not found.');
  if (row.revoked || row.expires_at <= Date.now()) throw new AppError(410, 'This form link has expired. Ask your contact for a new link.');
  return row;
}

function normalizeField(field, value) {
  if (field.rows) return value.map(row => Object.fromEntries(field.rows.filter(child => Object.hasOwn(row, child.key))
    .map(child => [child.key, normalizeField(child, row[child.key])]))).filter(row => Object.values(row).some(Boolean));
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

export async function publicForm(store, value, secret) {
  const row = await getFormLink(store, value, secret);
  return { client_name: row.client_name, submitted: Boolean(row.submission_id),
    draft: row.submission_id ? {} : { company: row.client_name, ...decode(row.draft) } };
}

export async function saveIntake(store, value, input, secret) {
  const data = intakeAnswers(input);
  return store.tx(async () => {
    const row = await getFormLink(store, value, secret);
    if (row.submission_id) throw new AppError(409, 'This form was already submitted.');
    await store.run('UPDATE form_links SET draft=? WHERE token_hash=?', encode(data), row.token_hash);
    return { ok: true };
  });
}

export async function insertSubmission(store, actor, clientId, answers, options = {}) {
  const next = (await store.get('SELECT coalesce(max(version),0)+1 AS version FROM submissions WHERE client_id=?', clientId)).version;
  const submissionId = id();
  const at = options.submittedAt ?? iso();
  await store.run(`INSERT INTO submissions(id,client_id,version,form_version,submitted_at,answers,source_ref)
    VALUES(?,?,?,?,?,?,?)`, submissionId, clientId, next, options.formVersion ?? 1, at, encode(answers), options.sourceRef ?? null);
  await audit(store, actor, options.imported ? 'intake.imported' : 'intake.submitted', 'submission', submissionId, clientId, { version: next });
  if (!options.imported) await emit(store, { type: 'onboarding_submitted', key: `submission:${submissionId}`,
    clientId, recordId: submissionId, title: 'New onboarding submission', at, payload: { version: next } });
  return { id: submissionId, client_id: clientId, version: next, submitted_at: at };
}

export async function submitIntake(store, value, input, secret) {
  return store.tx(async () => {
    const row = await getFormLink(store, value, secret);
    if (row.submission_id) return store.get('SELECT id,client_id,version,submitted_at FROM submissions WHERE id=?', row.submission_id);
    const data = intakeAnswers(input, { complete: true });
    const actor = { kind: 'external', name: 'Client form', id: null };
    const submitted = await insertSubmission(store, actor, row.client_id, data);
    await store.run("UPDATE form_links SET submission_id=?,draft='{}' WHERE token_hash=?", submitted.id, row.token_hash);
    return submitted;
  });
}

export async function listSubmissions(store, actor, clientId, { before, limit = 30 }) {
  await clientFor(store, actor, clientId);
  const rows = await store.all(`SELECT ${submissionFields} FROM submissions s WHERE s.client_id=? AND (?::bigint IS NULL OR s.version<?::bigint)
    ORDER BY s.version DESC LIMIT ?`, clientId, before ?? null, before ?? null, limit + 1);
  const items = rows.slice(0, limit);
  return { items, next_cursor: rows.length > limit ? items.at(-1).version : null };
}

export async function getSubmission(store, actor, clientId, submissionId) {
  const client = await clientFor(store, actor, clientId);
  const row = await store.get(`SELECT ${submissionFields},s.answers FROM submissions s WHERE s.client_id=? AND (?::text IS NULL OR s.id=?::text)
    ORDER BY s.submitted_at DESC,s.version DESC LIMIT 1`, clientId, submissionId ?? null, submissionId ?? null);
  if (!row) throw new AppError(404, 'Submission not found.');
  return { ...row, client_name: client.name, answers: decode(row.answers) };
}
