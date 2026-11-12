import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

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

const migrations = ['schema.sql', 'schema-2.sql'];
export const schemaVersion = migrations.length;

export function openStore(path) {
  if (!path) throw new Error('Set DATABASE_PATH before starting the app.');
  const file = path === ':memory:' ? path : resolve(path);
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file, { timeout: 5000, enableForeignKeyConstraints: true });
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > migrations.length) {
    db.close();
    throw new Error('The database requires a newer app version.');
  }
  const store = {
    db,
    get: (sql, ...params) => db.prepare(sql).get(...params),
    all: (sql, ...params) => db.prepare(sql).all(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params),
    tx(work) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = work();
        if (value instanceof Promise) throw new Error('A transaction must be synchronous.');
        db.exec('COMMIT');
        return value;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  // Each file upgrades the database by one version. A new database runs them all in order.
  if (version < migrations.length) store.tx(() => {
    for (let next = store.get('PRAGMA user_version').user_version; next < migrations.length; next++) {
      db.exec(readFileSync(new URL(`./${migrations[next]}`, import.meta.url), 'utf8'));
      db.exec(`PRAGMA user_version=${next + 1}`);
    }
  });
  return store;
}

export const system = Object.freeze({ kind: 'system', id: null, name: 'System' });
export const actorName = (actor) => actor.kind === 'claude' ? 'claude' : actor.name;

export function audit(store, actor, action, entity, entityId = null, clientId = null, details = {}) {
  store.run(`INSERT INTO audit_log(actor,actor_id,action,entity,entity_id,client_id,details,at)
    VALUES(?,?,?,?,?,?,?,?)`, actorName(actor), actor.id, action, entity, entityId, clientId, encode(details), iso());
}

export function requireAdmin(actor) {
  if (actor.kind !== 'user' || actor.role !== 'admin') throw new AppError(403, 'Admin access is required.');
}

export function requireHuman(actor) {
  if (actor.kind !== 'user' || actor.readOnly) throw new AppError(403, 'Use a manager account to make this change.');
}

// Matches and report entries may be saved by the Claude job or by a signed-in manager working through Claude.
export function requireAssistant(actor) {
  if (actor.kind !== 'claude' && !(actor.kind === 'user' && actor.assistantWrites)) {
    throw new AppError(403, 'This credential cannot save records.');
  }
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

export function clientFor(store, actor, clientId) {
  const [where, args] = clientScope(actor, 'c.id');
  const client = store.get(`SELECT c.*, u.name AS owner_name FROM clients c
    JOIN users u ON u.id=c.owner_id WHERE c.id=? AND (${where})`, clientId, ...args);
  if (!client) throw new AppError(404, 'Client not found.');
  return client;
}

export function canAccessClient(store, userId, clientId) {
  const user = store.get('SELECT id, role FROM users WHERE id=? AND enabled=1', userId);
  if (!user) return false;
  const [where, params] = clientScope({ kind: 'user', ...user }, 'c.id');
  return Boolean(store.get(`SELECT 1 FROM clients c WHERE c.id=? AND (${where})`, clientId, ...params));
}
