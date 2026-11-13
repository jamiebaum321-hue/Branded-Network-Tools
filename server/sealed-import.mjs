import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { importSeed } from './seed.mjs';

// A one-time data migration can ship with the code without exposing client records in the repository:
// the file is AES-256-GCM encrypted and its key lives only in the server environment.
const sealedFile = new URL('../data/tracker-import.sealed', import.meta.url);
const recordSets = ['clients', 'partners', 'introductions', 'outreach_activity', 'suggested_leads', 'onboarding_submissions', 'client_records'];

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
  const input = unseal(readFileSync(file, 'utf8'), env.TRACKER_IMPORT_KEY);
  const total = recordSets.reduce((sum, kind) => sum + (input[kind]?.length ?? 0), 0);
  return store.tx(async () => {
    await store.exec("SELECT pg_advisory_xact_lock(hashtext('branded_sealed_import'))");
    const done = (await store.get('SELECT count(*) AS n FROM imported_records WHERE namespace=?', input.namespace)).n;
    if (done >= total) return null;
    const admin = await store.get("SELECT id,name,role FROM users WHERE role='admin' AND enabled=1 ORDER BY created_at,id LIMIT 1");
    if (!admin) return null;
    const result = await importSeed(store, { kind: 'user', ...admin }, input);
    console.log('Sealed import applied:', JSON.stringify(result.counts));
    return result;
  });
}
