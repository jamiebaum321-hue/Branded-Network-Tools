import { createHmac } from 'node:crypto';
import { sections } from '../public/intake-fields.mjs';
import { AppError, audit, canAccessClient, clientFor, clientScope, decode, digest, encode, id, iso, requireAdmin, requireHuman } from './store.mjs';
import { email, int, list, object, str, validate } from './validation.mjs';
import { emit } from './events.mjs';
import { primaryEngagement } from './client-links.mjs';
import { provisionClient, insertDeal, workspaceAccounts, companyId, applyIntakeBilling } from './engagements.mjs';

const clientFields = { name: str(180), owner_id: str(80), member_ids: list(str(80), 500) };
const submissionFields = 's.id,s.client_id,s.version,s.form_version,s.submitted_at,s.source_ref';

export function listClients(store, actor, { q, limit = 50, offset = 0 } = {}) {
  const [scope, params] = clientScope(actor, 'c.id');
  const rows = store.all(`SELECT c.*,u.name AS owner_name,
    (${primaryEngagement}) AS engagement_id,
    (SELECT count(*) FROM cards p WHERE p.client_id=c.id AND p.stage<>'closed') AS open_cards,
    (SELECT max(s.submitted_at) FROM submissions s WHERE s.client_id=c.id) AS latest_submission
    FROM clients c JOIN users u ON u.id=c.owner_id WHERE (${scope}) AND (? IS NULL OR instr(lower(c.name),lower(?))>0)
    ORDER BY c.name COLLATE NOCASE,c.id LIMIT ? OFFSET ?`, ...params, q ?? null, q ?? null, limit + 1, offset);
  return { items: rows.slice(0, limit), next_offset: rows.length > limit ? offset + limit : null };
}

function ensureActive(store, userId) {
  if (!store.get('SELECT 1 FROM users WHERE id=? AND enabled=1', userId)) throw new AppError(400, 'Choose an active account.');
}

export function insertClient(store, actor, data, createdAt = iso(), createEngagement = true) {
  const clientId = id();
  const owner = data.owner_id ?? actor.id;
  ensureActive(store, owner);
  for (const userId of data.member_ids ?? []) ensureActive(store, userId);
  store.run('INSERT INTO clients VALUES(?,?,?,?)', clientId, data.name, owner, createdAt);
  for (const userId of new Set(data.member_ids ?? [])) store.run('INSERT INTO client_members VALUES(?,?)', clientId, userId);
  provisionClient(store,{id:clientId,name:data.name,owner_id:owner,created_at:createdAt},createEngagement);
  audit(store, actor, 'client.created', 'client', clientId, clientId, { owner_id: owner });
  if(actor.kind==='system') return {id:clientId,name:data.name,owner_id:owner};
  return clientFor(store, actor, clientId);
}

export function createClient(store, actor, input) {
  requireAdmin(actor);
  const data=validate(object({...clientFields,pipeline_stage:str(80),contact:str(150,0),contact_email:str(254,0)},['name']),input);
  if(data.contact_email) email(data.contact_email);
  return store.tx(()=>{
    const owner=data.owner_id||actor.id;
    if(data.pipeline_stage && !workspaceAccounts(store,actor,'solutions').some(p=>p.id===owner)) throw new AppError(400,'Choose a Solutions owner.');
    const client=insertClient(store,actor,data,iso(),!data.pipeline_stage);
    const details={contact:data.contact||'',contact_email:data.contact_email||''};
    if(data.pipeline_stage) insertDeal(store,actor,'solutions',{client_id:client.id,company:client.name,stage:data.pipeline_stage,details},owner);
    else if(details.contact||details.contact_email) store.run('UPDATE engagements SET details=? WHERE id=?',encode(details),client.id);
    return client;
  });
}

export function updateClient(store, actor, clientId, input) {
  requireAdmin(actor);
  const data = validate(object(clientFields, []), input);
  return store.tx(() => {
    const previous = clientFor(store, actor, clientId);
    const owner = data.owner_id ?? previous.owner_id;
    ensureActive(store, owner);
    store.run('UPDATE clients SET name=?,owner_id=? WHERE id=?', data.name ?? previous.name, owner, clientId);
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
    audit(store, actor, 'client.updated', 'client', clientId, clientId, { fields: Object.keys(data), owner_id: owner });
    const company=companyId(store,data.name??previous.name);
    const changedAt=iso();
    for(const deal of store.all('SELECT id,company_id,owner_id FROM engagements WHERE client_id=?',clientId)) {
      const assigned=deal.owner_id===previous.owner_id || !canAccessClient(store,deal.owner_id,clientId)?owner:deal.owner_id;
      if(company!==deal.company_id || assigned!==deal.owner_id)
        store.run('UPDATE engagements SET company_id=?,owner_id=?,updated_at=?,version=version+1 WHERE id=?',company,assigned,changedAt,deal.id);
    }
    if(data.member_ids) store.run(`DELETE FROM engagement_members WHERE engagement_id IN (SELECT id FROM engagements WHERE client_id=?)
      AND user_id<>? AND user_id NOT IN (SELECT user_id FROM client_members WHERE client_id=?)`,clientId,owner,clientId);
    return clientFor(store, actor, clientId);
  });
}

export function clientDetail(store, actor, clientId) {
  const client = clientFor(store, actor, clientId);
  const link = store.get(`SELECT expires_at,created_at FROM form_links WHERE client_id=? AND revoked=0
    AND expires_at>? AND submission_id IS NULL ORDER BY created_at DESC LIMIT 1`, clientId, Date.now()) ?? null;
  return {
    client, link, engagement_id:store.get(`SELECT (${primaryEngagement}) AS id FROM clients c WHERE c.id=?`,clientId)?.id,
    engagements:store.all('SELECT id,title,stage,signed_at,created_at FROM engagements WHERE client_id=? ORDER BY created_at DESC,id',clientId),
    files:store.all(`SELECT f.id,f.name,f.purpose,f.mime,length(f.bytes) size,f.created_at,(SELECT note FROM attachment_lists WHERE file_id=f.id) list_note FROM attachments f LEFT JOIN engagements e ON e.id=f.engagement_id
      WHERE e.client_id=? OR (f.client_id=? AND f.submission_id IS NOT NULL) ORDER BY f.created_at DESC,f.id`,clientId,clientId),
    submissions: listSubmissions(store, actor, clientId, {}),
    member_ids: store.all('SELECT user_id FROM client_members WHERE client_id=? ORDER BY user_id', clientId).map(row => row.user_id),
    owners: store.all(`SELECT id,name FROM users WHERE enabled=1 AND (role='admin' OR (id IN (SELECT user_id FROM workspace_members WHERE line='solutions') AND
      (id=? OR id IN (SELECT user_id FROM client_members WHERE client_id=?)))) ORDER BY name`, client.owner_id, clientId),
  };
}

export function formToken(publicId, secret) {
  return `${publicId}.${createHmac('sha256', secret).update(`onboarding:${publicId}`).digest('base64url')}`;
}

function intakeLink(store,actor,clientId,secret) {
    clientFor(store, actor, clientId);
    const active = store.get(`SELECT public_id,expires_at FROM form_links WHERE client_id=? AND revoked=0
      AND expires_at>? AND submission_id IS NULL ORDER BY created_at DESC LIMIT 1`, clientId, Date.now());
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
    return { publicId,path:`/onboard/${value}`,expires_at:new Date(expiresAt).toISOString() };
}
export function copyFormLink(store,actor,clientId,secret) {
  requireHuman(actor);
  return store.tx(()=>{
    const {path,expires_at}=intakeLink(store,actor,clientId,secret);
    return {path,expires_at};
  });
}
export function queueIntakeEmail(store,actor,clientId,input,config,available) {
  requireHuman(actor);
  const d=validate(object({recipient:str(254),request_id:str(80)}),input),recipient=email(d.recipient);
  return store.tx(()=>{
    const client=clientFor(store,actor,clientId);
    const key=digest(JSON.stringify(['intake',actor.id,clientId,d.request_id]));
    const previous=store.get('SELECT recipient,status FROM dispatches WHERE id=?',key);
    if(previous) {
      if(previous.recipient!==recipient) throw new AppError(409,'The recipient changed. Reopen the intake form to send again.');
      return {status:previous.status};
    }
    if(!available) throw new AppError(409,'Workspace email is unavailable. Reopen the form to use your email app.');
    const {publicId}=intakeLink(store,actor,clientId,config.linkSecret);
    store.run(`INSERT INTO dispatches(id,dedupe_key,kind,recipient,subject,body,created_at) VALUES(?,?,'client_intake',?,?,?,?)`,
      key,'intake:'+publicId+':'+key,recipient,'Branded Hospitality Solutions | '+client.name+' client intake',
      'Please complete the Branded Hospitality Solutions intake for '+client.name+'. You can include existing documents and shared links.',iso());
    audit(store,actor,'intake.email_queued','client',clientId,clientId);
    return {status:'queued'};
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

const intakeFields = sections.flatMap(section => section.fields);
const fieldSchema = field => field.rows ? list(object(Object.fromEntries(field.rows.map(child => [child.key, fieldSchema(child)])), []), 40)
  : field.type === 'number' ? int(0, 10000000) : str(field.max ?? 500, 0);
const intakeSchema = object(Object.fromEntries(intakeFields.map(field => [field.key, fieldSchema(field)])), []);

function validLink(value) {
  if (!/^[0-9a-f-]{36}\.[a-zA-Z0-9_-]{43}$/.test(value)) throw new AppError(404, 'Form link not found.');
  return digest(value);
}

export function getFormLink(store, value, secret) {
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
  return { client_name: row.client_name, submitted: Boolean(row.submission_id),
    files:store.all('SELECT id,name,purpose,(SELECT note FROM attachment_lists WHERE file_id=attachments.id) list_note FROM attachments WHERE form_key=? ORDER BY created_at',row.token_hash),
    draft: row.submission_id ? {} : { company: row.client_name, ...decode(row.draft) } };
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
    VALUES(?,?,?,?,?,?,?)`, submissionId, clientId, next, options.formVersion ?? 1, at, encode(answers), options.sourceRef ?? null);
  audit(store, actor, options.imported ? 'intake.imported' : 'intake.submitted', 'submission', submissionId, clientId, { version: next });
  if (!options.imported) emit(store, { type: 'onboarding_submitted', key: `submission:${submissionId}`,
    clientId, recordId: submissionId, title: 'New onboarding submission', at, payload: { version: next } });
  return { id: submissionId, client_id: clientId, version: next, submitted_at: at };
}

export function submitIntake(store, value, input, secret, config) {
  return store.tx(() => {
    const row = getFormLink(store, value, secret);
    if (row.submission_id) return store.get('SELECT id,client_id,version,submitted_at FROM submissions WHERE id=?', row.submission_id);
    const data = intakeAnswers(input, { complete: true });
    const actor = { kind: 'external', name: 'Client form', id: null };
    const submitted = insertSubmission(store, actor, row.client_id, data);
    store.run('UPDATE attachments SET submission_id=? WHERE form_key=?',submitted.id,row.token_hash);
    applyIntakeBilling(store,row.client_id,data,config);
    store.run("UPDATE form_links SET submission_id=?,draft='{}' WHERE token_hash=?", submitted.id, row.token_hash);
    return submitted;
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
  return { ...row, client_name: client.name, answers: decode(row.answers),
    files:store.all('SELECT id,name,purpose,mime,length(bytes) AS size FROM attachments WHERE submission_id=? ORDER BY created_at',row.id) };
}
