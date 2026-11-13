import { AppError, audit, clientFor, clientScope, decode, encode, id, iso, requireAdmin, requireHuman } from './store.mjs';
import { choice, day, int, nullable, num, object, str, validate } from './validation.mjs';
import { recordKinds } from '../public/record-kinds.mjs';

const month = { type: 'string', minLength: 7, maxLength: 7 };
const fieldSchema = (field) => {
  const optional = schema => field.required ? schema : nullable(schema);
  switch (field.type) {
    case 'textarea': return str(8000, field.required ? 1 : 0);
    case 'int': return optional(int(0, 1000000000000));
    case 'number': return optional(num(0, 1000000000000));
    case 'date': return optional(day);
    case 'month': return optional(month);
    case 'url': return str(1000, 0);
    case 'choice': return choice(...(field.required ? [] : ['']), ...field.options);
    default: return str(500, field.required ? 1 : 0);
  }
};
const schemas = Object.fromEntries(Object.entries(recordKinds).map(([kind, info]) =>
  [kind, object(Object.fromEntries(info.fields.map(field => [field.key, fieldSchema(field)])), info.fields.filter(field => field.required).map(field => field.key))]));

export function recordData(kind, input) {
  const info = recordKinds[kind];
  if (!info) throw new AppError(400, 'Choose a valid record type.');
  const data = validate(schemas[kind], input, info.singular[0].toUpperCase() + info.singular.slice(1));
  for (const field of info.fields) {
    const value = data[field.key];
    if (value === null || value === '' || value === undefined) { delete data[field.key]; continue; }
    if (field.type === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new AppError(400, `${field.label} must be a month (YYYY-MM).`);
    if (field.type === 'url') {
      let url;
      try { url = new URL(value); } catch { throw new AppError(400, `${field.label} must be a full web address.`); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new AppError(400, `${field.label} must be a full web address.`);
    }
  }
  return data;
}

const present = row => ({ ...row, data: decode(row.data) });

async function recordFor(store, actor, recordId) {
  const row = await store.get('SELECT * FROM client_records WHERE id=?', recordId);
  if (!row) throw new AppError(404, 'Record not found.');
  if (row.client_id) await clientFor(store, actor, row.client_id);
  else requireAdmin(actor);
  return row;
}

export async function insertRecord(store, actor, clientId, kind, data, at = iso()) {
  if (clientId) await clientFor(store, actor, clientId);
  else if (kind !== 'issues') throw new AppError(400, 'Only issues can belong to the whole workspace.');
  else requireAdmin(actor);
  const key = recordKinds[kind].key ? data[recordKinds[kind].key] : null;
  if (key && await store.get('SELECT 1 FROM client_records WHERE client_id=? AND kind=? AND record_key=?', clientId, kind, key)) {
    throw new AppError(409, `This client already has a ${recordKinds[kind].singular} for ${key}. Edit that one instead.`);
  }
  const recordId = id();
  await store.run(`INSERT INTO client_records(id,client_id,kind,record_key,data,created_at,updated_at,updated_by)
    VALUES(?,?,?,?,?,?,?,?)`, recordId, clientId, kind, key, encode(data), at, at, actor.name ?? 'System');
  await audit(store, actor, 'record.created', kind, recordId, clientId);
  return present(await store.get('SELECT * FROM client_records WHERE id=?', recordId));
}

export async function createRecord(store, actor, clientId, input) {
  requireHuman(actor);
  const kind = validate(choice(...Object.keys(recordKinds)), input?.kind, 'Record type');
  const data = recordData(kind, input?.data);
  return store.tx(() => insertRecord(store, actor, clientId, kind, data));
}

export async function updateRecord(store, actor, recordId, input) {
  requireHuman(actor);
  return store.tx(async () => {
    const previous = await recordFor(store, actor, recordId);
    const data = recordData(previous.kind, input?.data);
    const keyField = recordKinds[previous.kind].key;
    const key = keyField ? data[keyField] : null;
    if (key && key !== previous.record_key && await store.get('SELECT 1 FROM client_records WHERE client_id=? AND kind=? AND record_key=?',
      previous.client_id, previous.kind, key)) throw new AppError(409, `This client already has a ${recordKinds[previous.kind].singular} for ${key}.`);
    await store.run('UPDATE client_records SET data=?,record_key=?,updated_at=?,updated_by=? WHERE id=?', encode(data), key, iso(), actor.name, recordId);
    await audit(store, actor, 'record.updated', previous.kind, recordId, previous.client_id);
    return present(await store.get('SELECT * FROM client_records WHERE id=?', recordId));
  });
}

export async function deleteRecord(store, actor, recordId) {
  requireHuman(actor);
  return store.tx(async () => {
    const previous = await recordFor(store, actor, recordId);
    await store.run('DELETE FROM client_records WHERE id=?', recordId);
    await audit(store, actor, 'record.deleted', previous.kind, recordId, previous.client_id);
    return { deleted: recordId };
  });
}

const order = { issues: 0, onboarding: 1, kpis: 2, reports: 3, billing: 4, intel: 5, briefs: 6, wins: 7 };
function sortRecords(kind, rows) {
  const value = (row, key) => row.data[key] ?? '';
  const sorters = {
    issues: (a, b) => (value(a, 'status') === 'Resolved') - (value(b, 'status') === 'Resolved')
      || ['High', 'Medium', 'Low', ''].indexOf(value(a, 'priority')) - ['High', 'Medium', 'Low', ''].indexOf(value(b, 'priority')),
    onboarding: (a, b) => (a.data.no ?? 9999) - (b.data.no ?? 9999),
    intel: (a, b) => String(value(b, 'date')).localeCompare(value(a, 'date')),
    billing: (a, b) => String(value(b, 'invoice_date')).localeCompare(value(a, 'invoice_date')),
  };
  return rows.sort(sorters[kind] ?? ((a, b) => String(b.record_key ?? b.created_at).localeCompare(a.record_key ?? a.created_at)));
}

export async function clientRecords(store, actor, clientId) {
  await clientFor(store, actor, clientId);
  const rows = (await store.all('SELECT * FROM client_records WHERE client_id=? ORDER BY created_at,id', clientId)).map(present);
  return Object.fromEntries(Object.keys(recordKinds).sort((a, b) => order[a] - order[b])
    .map(kind => [kind, sortRecords(kind, rows.filter(row => row.kind === kind))]));
}

// Open issues across every client the person can see, plus workspace-wide issues for admins.
export async function openIssues(store, actor) {
  const [scope, args] = clientScope(actor, 'r.client_id');
  const admin = actor.kind === 'user' && actor.role === 'admin';
  const rows = (await store.all(`SELECT r.*,c.name AS client_name FROM client_records r LEFT JOIN clients c ON c.id=r.client_id
    WHERE r.kind='issues' AND ((r.client_id IS NOT NULL AND (${scope})) ${admin ? 'OR r.client_id IS NULL' : ''})
    ORDER BY r.created_at`, ...args)).map(present).filter(row => row.data.status !== 'Resolved');
  return sortRecords('issues', rows);
}
