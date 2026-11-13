import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const id = () => randomUUID();
export const iso = () => new Date().toISOString();
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const encode = (value) => JSON.stringify(value);
export const decode = (value) => JSON.parse(value);

// BIGINT millisecond timestamps, identity sequences and count(*) all fit in a safe JS integer.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);

const migrations = [
  { version: 1, sql: () => readFileSync(new URL('./schema.sql', import.meta.url), 'utf8') },
  { version: 2, sql: () => readFileSync(new URL('./migrations/002-accounts.sql', import.meta.url), 'utf8') },
  { version: 3, sql: () => readFileSync(new URL('./migrations/003-client-records.sql', import.meta.url), 'utf8') },
  { version: 4, sql: () => readFileSync(new URL('./migrations/004-tracker-corrections.sql', import.meta.url), 'utf8') },
  { version: 5, sql: () => readFileSync(new URL('./migrations/005-mercosa-signed.sql', import.meta.url), 'utf8') },
  { version: 6, sql: () => readFileSync(new URL('./migrations/006-approvals-activity.sql', import.meta.url), 'utf8') },
];

// Queries are written with `?` placeholders; translate them to $1..$n outside string literals.
const translated = new Map();
function placeholders(sql) {
  let result = translated.get(sql);
  if (result) return result;
  let index = 0;
  let quoted = false;
  result = '';
  for (const char of sql) {
    if (char === "'") quoted = !quoted;
    result += char === '?' && !quoted ? `$${++index}` : char;
  }
  if (translated.size < 2000) translated.set(sql, result);
  return result;
}

const retryable = new Set(['40001', '40P01']);
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function openStore(connectionString, { schema, max = Number(process.env.DATABASE_POOL_MAX || 5) } = {}) {
  if (!connectionString) throw new Error('Set DATABASE_URL before starting the app.');
  const pool = new pg.Pool({ connectionString, max, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000,
    ...(schema ? { options: `-c search_path=${schema}` } : {}) });
  pool.on('error', error => console.error('Idle database client error:', error.code ?? error.message));
  if (process.env.VERCEL) {
    try { (await import('@vercel/functions')).attachDatabasePool(pool); } catch { /* optional helper */ }
  }
  const scope = new AsyncLocalStorage();
  const query = async (sql, params) => (scope.getStore() ?? pool).query(placeholders(sql), params);
  const store = {
    pool,
    get: async (sql, ...params) => (await query(sql, params)).rows[0],
    all: async (sql, ...params) => (await query(sql, params)).rows,
    run: async (sql, ...params) => ({ changes: (await query(sql, params)).rowCount }),
    exec: async (sql) => { await (scope.getStore() ?? pool).query(sql); },
    // Serializable transactions keep the read-then-write checks equivalent to a single-writer database.
    async tx(work) {
      if (scope.getStore()) return work();
      for (let attempt = 1; ; attempt++) {
        const client = await pool.connect();
        let broken = false;
        try {
          await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
          const value = await scope.run(client, work);
          await client.query('COMMIT');
          return value;
        } catch (error) {
          try { await client.query('ROLLBACK'); } catch { broken = true; }
          if (retryable.has(error.code) && attempt < 8) {
            await pause(Math.random() * 20 * attempt);
            continue;
          }
          throw error;
        } finally {
          client.release(broken);
        }
      }
    },
    close: () => pool.end(),
  };
  await migrate(store);
  return store;
}

async function migrate(store) {
  await store.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const latest = migrations.at(-1).version;
  const current = (await store.get('SELECT coalesce(max(version),0) AS version FROM schema_migrations')).version;
  if (current > latest) throw new Error('The database requires a newer app version.');
  if (current === latest) return;
  await store.tx(async () => {
    await store.exec("SELECT pg_advisory_xact_lock(hashtext('branded_network_migrations'))");
    const applied = (await store.get('SELECT coalesce(max(version),0) AS version FROM schema_migrations')).version;
    for (const migration of migrations.filter(row => row.version > applied)) {
      await store.exec(migration.sql());
      await store.run('INSERT INTO schema_migrations VALUES(?,?)', migration.version, iso());
    }
  });
}

export const system = Object.freeze({ kind: 'system', id: null, name: 'System' });
export const actorName = (actor) => actor.kind === 'claude' ? 'claude' : actor.name;

export async function audit(store, actor, action, entity, entityId = null, clientId = null, details = {}) {
  await store.run(`INSERT INTO audit_log(actor,actor_id,action,entity,entity_id,client_id,details,at)
    VALUES(?,?,?,?,?,?,?,?)`, actorName(actor), actor.id, action, entity, entityId, clientId, encode(details), iso());
}

export function requireAdmin(actor) {
  if (actor.kind !== 'user' || actor.role !== 'admin') throw new AppError(403, 'Admin access is required.');
}

export function requireHuman(actor) {
  if (actor.kind !== 'user' || actor.readOnly) throw new AppError(403, 'Use a manager account to make this change.');
}

// The expression is supplied by callers, never interpolated from a request.
export function clientScope(actor, column) {
  if (actor.kind === 'user' && actor.role === 'admin') return ['1=1', []];
  if (actor.kind === 'claude') {
    return actor.all_clients ? ['1=1', []] : [
      `EXISTS (SELECT 1 FROM mcp_clients access WHERE access.client_id=${column} AND access.token_id=?)`, [actor.id],
    ];
  }
  if (actor.kind === 'user') return [
    `EXISTS (SELECT 1 FROM clients owner WHERE owner.id=${column} AND owner.owner_id=?)
      OR EXISTS (SELECT 1 FROM client_members member WHERE member.client_id=${column} AND member.user_id=?)`,
    [actor.id, actor.id],
  ];
  return ['0=1', []];
}

export async function clientFor(store, actor, clientId) {
  const [where, args] = clientScope(actor, 'c.id');
  const client = await store.get(`SELECT c.*, u.name AS owner_name FROM clients c
    JOIN users u ON u.id=c.owner_id WHERE c.id=? AND (${where})`, clientId, ...args);
  if (!client) throw new AppError(404, 'Client not found.');
  return client;
}

export async function canAccessClient(store, userId, clientId) {
  const user = await store.get('SELECT id, role FROM users WHERE id=? AND enabled=1', userId);
  if (!user) return false;
  const [where, params] = clientScope({ kind: 'user', ...user }, 'c.id');
  return Boolean(await store.get(`SELECT 1 FROM clients c WHERE c.id=? AND (${where})`, clientId, ...params));
}
