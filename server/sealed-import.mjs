import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { importSeed } from './seed.mjs';
import { accountFields } from './clients.mjs';
import { introStatuses } from '../public/account-fields.mjs';
import { recordData } from './records.mjs';
import { stages } from './pipeline.mjs';
import { encode, iso } from './store.mjs';
import { choice, object, str, validate } from './validation.mjs';

// A one-time data migration can ship with the code without exposing client records in the repository:
// the file is AES-256-GCM encrypted and its key lives only in the server environment.
const sealedFile = new URL('../data/tracker-import.sealed', import.meta.url);
const recordSets = ['clients', 'partners', 'introductions', 'outreach_activity', 'suggested_leads', 'onboarding_submissions', 'client_records', 'approvals', 'activity_log'];

const keyFrom = (value) => {
  const key = Buffer.from(value ?? '', 'base64url');
  if (key.length !== 32) throw new Error('The import key must be 32 bytes, base64url encoded.');
  return key;
};

export function seal(input, keyText) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyText), iv);
  const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(input)))), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), body].map(part => typeof part === 'string' ? part : part.toString('base64url')).join('.');
}

export function unseal(text, keyText) {
  const [version, iv, tag, body] = text.trim().split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unrecognised sealed import file.');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyText), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(gunzipSync(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()])).toString('utf8'));
}

// Applies the sealed import once, as the first active admin. Safe on every cold start: already-imported
// records are recognised by namespace and source ID, and concurrent starts wait on an advisory lock.
export async function applySealedImport(store, env, file = sealedFile) {
  if (!env.TRACKER_IMPORT_KEY || !existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  const input = unseal(text, env.TRACKER_IMPORT_KEY);
  if (input.sync) return applyTrackerSync(store, input, createHash('sha256').update(text).digest('hex'));
  const total = recordSets.reduce((sum, kind) => sum + (input[kind]?.length ?? 0), 0);
  return store.tx(async () => {
    await store.exec("SELECT pg_advisory_xact_lock(hashtext('branded_sealed_import'))");
    // Count only the records this file carries, so a later file in the same namespace still applies.
    const keys = recordSets.flatMap(kind => (input[kind] ?? []).map(row => `${kind}|${row.id}`));
    const done = (await store.get(`SELECT count(*) AS n FROM imported_records WHERE namespace=? AND (kind||'|'||source_id)=ANY(?::text[])`,
      input.namespace, keys)).n;
    if (done >= total) return null;
    const admin = await store.get("SELECT id,name,role FROM users WHERE role='admin' AND enabled=1 ORDER BY created_at,id LIMIT 1");
    if (!admin) return null;
    const result = await importSeed(store, { kind: 'user', ...admin }, input);
    console.log('Sealed import applied:', JSON.stringify(result.counts));
    return result;
  });
}

// ---- Re-sync from the Solutions Tracker ----
// A sync file brings the site in line with the tracker once: it updates clients, pipeline cards and
// billing/issue records already imported, and adds cards and records that are new. It never re-creates a
// client (one deleted on the site stays deleted), and it runs once per file, so later edits made on the
// site aren't overwritten on the next cold start.
const clientSync = object({ id: str(250), name: str(180), ...accountFields }, ['id']);
const cardSync = object({ id: str(250), client_id: str(250), company: str(180), person: str(150, 0), email: str(254, 0),
  stage: choice(...stages), intro_status: choice('', ...Object.keys(introStatuses)), outcome: str(300, 0), next_step: str(300, 0),
  introduced_by: str(120, 0) }, ['id', 'company', 'stage']);
const pick = (row, keys) => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));

async function mapped(store, namespace, kind) {
  const rows = await store.all('SELECT source_id,local_id FROM imported_records WHERE namespace=? AND kind=?', namespace, kind);
  return new Map(rows.map(row => [row.source_id, row.local_id]));
}

export async function applyTrackerSync(store, input, marker) {
  const namespace = input.namespace;
  return store.tx(async () => {
    await store.exec("SELECT pg_advisory_xact_lock(hashtext('branded_sealed_import'))");
    if (await store.get("SELECT 1 FROM imported_records WHERE namespace=? AND kind='sync' AND source_id=?", namespace, marker)) return null;
    const admin = await store.get("SELECT id,name,role FROM users WHERE role='admin' AND enabled=1 ORDER BY created_at,id LIMIT 1");
    if (!admin) return null;
    const clients = await mapped(store, namespace, 'clients');
    const known = row => !row.client_id || clients.has(row.client_id);
    const now = iso();
    const counts = { clients_updated: 0, cards_updated: 0, notes_updated: 0, records_updated: 0 };

    for (const raw of input.clients ?? []) {
      const localId = clients.get(raw.id);
      if (!localId) continue;
      const { id: _id, ...fields } = validate(clientSync, pick(raw, Object.keys(clientSync.properties)));
      const keys = Object.keys(fields);
      if (!keys.length) continue;
      const values = keys.map(key => key === 'contacts' ? encode(fields[key]) : fields[key]);
      const changed = await store.run(`UPDATE clients SET ${keys.map(key => `${key}=?`).join(',')},updated_at=? WHERE id=?`, ...values, now, localId);
      counts.clients_updated += changed.changes;
    }

    const cards = await mapped(store, namespace, 'partners');
    for (const raw of input.partners ?? []) {
      const cardId = cards.get(raw.id);
      if (!cardId || !known(raw)) continue;
      const row = validate(cardSync, pick(raw, Object.keys(cardSync.properties)));
      const previous = await store.get('SELECT stage FROM cards WHERE id=?', cardId);
      if (!previous) continue;
      await store.run(`UPDATE cards SET company=?,person=?,email=?,stage=?,intro_status=?,outcome=?,next_step=?,introduced_by=?,
        entered_at=CASE WHEN stage=? THEN entered_at ELSE ? END,updated_at=?,version=version+1 WHERE id=?`,
      row.company, row.person ?? '', row.email ?? '', row.stage, row.intro_status ?? '', row.outcome ?? '', row.next_step ?? '',
      row.introduced_by ?? '', row.stage, now, now, cardId);
      counts.cards_updated++;
    }
    for (const raw of input.introductions ?? []) {
      const cardId = cards.get(raw.partner_id);
      if (!cardId || typeof raw.notes !== 'string') continue;
      const result = await store.run("UPDATE activity SET body=? WHERE card_id=? AND kind='introduction' AND body<>?", raw.notes.slice(0, 4000), cardId, raw.notes.slice(0, 4000));
      counts.notes_updated += result.changes;
    }

    const records = await mapped(store, namespace, 'client_records');
    for (const raw of input.client_records ?? []) {
      const recordId = records.get(raw.id);
      if (!recordId || !known(raw)) continue;
      await store.run('UPDATE client_records SET data=?,updated_at=? WHERE id=?', encode(recordData(raw.kind, raw.data)), now, recordId);
      counts.records_updated++;
    }

    // Anything new in the tracker (cards, intro notes, billing/issue records) goes through the normal import.
    const additions = { version: 1, namespace };
    for (const kind of ['partners', 'introductions', 'outreach_activity', 'client_records']) additions[kind] = (input[kind] ?? []).filter(known);
    const added = await importSeed(store, { kind: 'user', ...admin }, additions);
    await store.run('INSERT INTO imported_records VALUES(?,?,?,?)', namespace, 'sync', marker, now);
    console.log('Tracker sync applied:', JSON.stringify({ ...counts, added: added.counts }));
    return { ...counts, added: added.counts };
  });
}
