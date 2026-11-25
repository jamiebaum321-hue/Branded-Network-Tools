import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { invitationToken } from './invite-link.mjs';
import { ready as mailReady } from './mail.mjs';
import { AppError, audit, clientFor, digest, id, iso, requireAdmin, system, token } from './store.mjs';
import { bool, choice, email, int, list, object, str, validate } from './validation.mjs';

const derive = promisify(scrypt);
const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const sessionMs = 12 * 60 * 60 * 1000;
const setupMs = 24 * 60 * 60 * 1000;
const unusedHash = `${'0'.repeat(64)}.${'0'.repeat(64)}`;
const fields = 'id,name,email,role,enabled,oauth_subject,onboarding_alerts,created_at,password_hash IS NOT NULL AS has_password';
const userRow = (store, userId) => store.get(`SELECT ${fields} FROM users WHERE id=?`, userId);
const principal = (user) => ({ kind: 'user', id: user.id, name: user.name, email: user.email, role: user.role });

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new AppError(400, 'Use a password between 12 and 256 characters.');
  }
  const salt = digest(token());
  return `${salt}.${(await derive(password, salt, 32, scryptOptions)).toString('hex')}`;
}

async function matchesPassword(password, stored) {
  const [salt, expected] = (stored || unusedHash).split('.');
  const actual = await derive(password, salt, 32, scryptOptions);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex')) && Boolean(stored);
}

export function rateLimit(store, key, limit, windowMs) {
  const now = Date.now();
  const row = store.get(`INSERT INTO rate_limits(key,expires_at,attempts) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
    RETURNING attempts`, digest(key), now + windowMs, now, now);
  if (row.attempts > limit) throw new AppError(429, 'Too many attempts. Try again shortly.');
}

function issueSetup(store, userId, value = token()) {
  const expiresAt = Date.now() + setupMs;
  store.run('DELETE FROM setup_tokens WHERE user_id=?', userId);
  store.run('INSERT INTO setup_tokens VALUES(?,?,?)', digest(value), userId, expiresAt);
  return { path: `/setup/${value}`, expires_at: new Date(expiresAt).toISOString() };
}

export function bootstrap(store, name, address) {
  name = validate(str(100), name, 'Name');
  address = email(address);
  return store.tx(() => {
    if (store.get("SELECT 1 FROM users WHERE role='admin' AND enabled=1 AND password_hash IS NOT NULL")) {
      throw new AppError(409, 'An active admin already exists. Invite users from Admin.');
    }
    const existing = store.get('SELECT id FROM users WHERE email=?', address);
    const userId = existing?.id ?? id();
    if (existing) store.run("UPDATE users SET role='admin',enabled=1,name=? WHERE id=?", name, userId);
    else store.run(`INSERT INTO users(id,name,email,role,onboarding_alerts,created_at)
      VALUES(?,?,?,'admin',1,?)`, userId, name, address, iso());
    audit(store, system, 'account.bootstrap', 'user', userId);
    return issueSetup(store, userId);
  });
}

export function listAccounts(store, actor) {
  requireAdmin(actor);
  return store.all(`SELECT ${fields} FROM users ORDER BY name COLLATE NOCASE, id`);
}

export function inviteAccount(store, actor, input, config = {}) {
  requireAdmin(actor);
  const data = validate(object({ name:str(100), email:str(254), role:choice('admin','member'),
    workspaces:list(choice('solutions','media','capital'),3), delivery:choice('link','email') }, ['name','email','role']),input);
  if (data.delivery==='email' && !mailReady(config)) throw new AppError(409,'Connect Microsoft 365 in settings or choose a shareable link.');
  data.email = email(data.email);
  return store.tx(() => {
    if (store.get('SELECT 1 FROM users WHERE email=?', data.email)) throw new AppError(409, 'An account already uses that email.');
    const userId = id();
    store.run('INSERT INTO users(id,name,email,role,created_at) VALUES(?,?,?,?,?)', userId, data.name, data.email, data.role, iso());
    audit(store, actor, 'account.invited', 'user', userId, null, { role: data.role });
    for (const line of new Set(data.workspaces ?? ['solutions'])) store.run('INSERT OR IGNORE INTO workspace_members VALUES(?,?)',userId,line);
    const mailId=id();
    const setup=issueSetup(store,userId,data.delivery==='email'?invitationToken(config.linkSecret,mailId):token());
    if (data.delivery==='email') store.run(`INSERT INTO dispatches(id,dedupe_key,kind,recipient,subject,body,created_at) VALUES(?,?,'team_invite',?,?,?,?)`,
      mailId,'invite:'+mailId,data.email,'Your invitation to Branded Network',
      actor.name+' invited you to Branded Network. Use this link within 24 hours to set your password and sign in.',iso());
    return {user:userRow(store,userId),setup,delivery:data.delivery==='email'?'queued':'link'};
  });
}

export function changeAccount(store, actor, userId, input) {
  requireAdmin(actor);
  const data = validate(object({ name: str(100), role: choice('admin', 'member'), enabled: bool,
    oauth_subject: str(300, 0), onboarding_alerts: bool }, []), input);
  return store.tx(() => {
    const user = userRow(store, userId);
    if (!user) throw new AppError(404, 'Account not found.');
    const role = data.role ?? user.role;
    const enabled = data.enabled === undefined ? user.enabled : Number(data.enabled);
    const subject = data.oauth_subject === undefined ? user.oauth_subject : data.oauth_subject || null;
    if (actor.id === userId && (!enabled || role !== user.role)) throw new AppError(409, 'Ask another admin to change your access.');
    if (user.role === 'admin' && user.enabled && user.has_password && (role !== 'admin' || !enabled)
      && !store.get("SELECT 1 FROM users WHERE role='admin' AND enabled=1 AND password_hash IS NOT NULL AND id<>?", userId)) {
      throw new AppError(409, 'Keep at least one active admin.');
    }
    if (subject && store.get('SELECT 1 FROM users WHERE oauth_subject=? AND id<>?', subject, userId)) {
      throw new AppError(409, 'That OAuth subject is already assigned.');
    }
    const alerts = data.onboarding_alerts === undefined ? user.onboarding_alerts : Number(data.onboarding_alerts);
    store.run('UPDATE users SET name=?,role=?,enabled=?,oauth_subject=?,onboarding_alerts=?,profile_version=profile_version+1 WHERE id=?',
      data.name ?? user.name, role, enabled, subject, alerts, userId);
    if (!enabled) {
      store.run('DELETE FROM sessions WHERE user_id=?', userId);
      store.run('DELETE FROM setup_tokens WHERE user_id=?', userId);
    }
    audit(store, actor, 'account.updated', 'user', userId, null, { role, enabled: Boolean(enabled), onboarding_alerts: Boolean(alerts) });
    return userRow(store, userId);
  });
}

export function resetAccount(store, actor, userId) {
  requireAdmin(actor);
  return store.tx(() => {
    const user = userRow(store, userId);
    if (!user?.enabled) throw new AppError(404, 'Active account not found.');
    audit(store, actor, 'account.setup_link_issued', 'user', userId);
    return issueSetup(store, userId);
  });
}

function validSetup(store, value) {
  const user = store.get(`SELECT u.id,u.name,u.email,u.role FROM setup_tokens t JOIN users u ON u.id=t.user_id
    WHERE t.token_hash=? AND t.expires_at>? AND u.enabled=1`, digest(value), Date.now());
  if (!user) throw new AppError(410, 'This setup link has expired or already been used. Ask an admin for a new link.');
  return user;
}

export function setupInfo(store, value) {
  const user = validSetup(store, value);
  return { name: user.name, email: user.email };
}

function issueSession(store, user) {
  const value = token();
  store.run('INSERT INTO sessions VALUES(?,?,?)', digest(value), user.id, Date.now() + sessionMs);
  return { value, maxAge: sessionMs / 1000, user: principal(user) };
}

export async function finishSetup(store, value, password, ip) {
  rateLimit(store, `setup:${ip}`, 30, 15 * 60 * 1000);
  validSetup(store, value);
  const hash = await hashPassword(password);
  return store.tx(() => {
    const user = validSetup(store, value);
    store.run('UPDATE users SET password_hash=? WHERE id=?', hash, user.id);
    store.run('DELETE FROM setup_tokens WHERE user_id=?', user.id);
    store.run('DELETE FROM sessions WHERE user_id=?', user.id);
    audit(store, principal(user), 'account.password_set', 'user', user.id);
    return issueSession(store, user);
  });
}

export async function signIn(store, input, ip, currentSession) {
  if (typeof input?.email !== 'string' || input.email.length > 254 || typeof input.password !== 'string' || input.password.length > 256) {
    throw new AppError(401, 'Email or password is incorrect.');
  }
  const address = input.email.trim().toLowerCase();
  rateLimit(store, `signin:ip:${ip}`, 100, 15 * 60 * 1000);
  rateLimit(store, `signin:account:${address}`, 10, 15 * 60 * 1000);
  const user = store.get('SELECT id,name,email,role,password_hash FROM users WHERE email=? AND enabled=1', address);
  if (!await matchesPassword(input.password, user?.password_hash) || !user) throw new AppError(401, 'Email or password is incorrect.');
  return store.tx(() => {
    const current = store.get('SELECT id,name,email,role,password_hash FROM users WHERE id=? AND enabled=1', user.id);
    if (!current || current.password_hash !== user.password_hash) throw new AppError(401, 'Email or password is incorrect.');
    if (currentSession) store.run('DELETE FROM sessions WHERE token_hash=?', digest(currentSession));
    store.run('DELETE FROM rate_limits WHERE key=?', digest(`signin:account:${address}`));
    audit(store, principal(current), 'session.signed_in', 'user', current.id);
    return issueSession(store, current);
  });
}

export function sessionUser(store, value) {
  if (!value || !/^[a-zA-Z0-9_-]{43}$/.test(value)) return null;
  const user = store.get(`SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.enabled=1`, digest(value), Date.now());
  return user ? principal(user) : null;
}

export function signOut(store, actor, value) {
  store.tx(() => {
    store.run('DELETE FROM sessions WHERE token_hash=?', digest(value));
    audit(store, actor, 'session.signed_out', 'user', actor.id);
  });
}

export function profile(s,a) {
  return s.get('SELECT id,name,email,role,job_title,phone,bio,onboarding_alerts,profile_version FROM users WHERE id=? AND enabled=1',a.id);
}
export function saveProfile(s,a,input) {
  const d=validate(object({name:str(100),job_title:str(150,0),phone:str(70,0),bio:str(1500,0),onboarding_alerts:bool,version:int(1,2147483647)}),input);
  return s.tx(()=>{
    if (!s.run('UPDATE users SET name=?,job_title=?,phone=?,bio=?,onboarding_alerts=?,profile_version=profile_version+1 WHERE id=? AND profile_version=?',
      d.name,d.job_title,d.phone,d.bio,Number(d.onboarding_alerts),a.id,d.version).changes) throw new AppError(409,'Your profile changed. Refresh before saving.');
    audit(s,a,'profile.updated','user',a.id);
    return profile(s,a);
  });
}
export async function changePassword(s,a,session,input,ip) {
  const d=validate(object({current:str(256),password:str(256,12)}),input);
  rateLimit(s,'profile-password:'+a.id+':'+ip,10,900000);
  const old=s.get('SELECT password_hash FROM users WHERE id=?',a.id)?.password_hash;
  if (!await matchesPassword(d.current,old)) throw new AppError(400,'The current password is incorrect.');
  const next=await hashPassword(d.password);
  return s.tx(()=>{
    if (!s.run('UPDATE users SET password_hash=? WHERE id=? AND enabled=1 AND password_hash=?',next,a.id,old).changes) throw new AppError(409,'Sign in again before changing your password.');
    s.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?',a.id,digest(session));
    s.run('DELETE FROM setup_tokens WHERE user_id=?',a.id);
    audit(s,a,'profile.password_changed','user',a.id);
    return {ok:true};
  });
}
export function listJobTokens(store, actor) {
  requireAdmin(actor);
  return store.all(`SELECT id,label,all_clients,created_at,expires_at,revoked_at,
    (SELECT json_group_array(client_id) FROM mcp_clients WHERE token_id=t.id) AS client_ids
    FROM mcp_tokens t ORDER BY created_at DESC`).map(row => ({ ...row, client_ids: JSON.parse(row.client_ids) }));
}

export function createJobToken(store, actor, input) {
  requireAdmin(actor);
  const data = validate(object({ label: str(100), all_clients: bool, client_ids: list(str(80), 500), days: int(1, 365) }), input);
  const clients = [...new Set(data.client_ids)];
  if (!data.all_clients && !clients.length) throw new AppError(400, 'Choose at least one client or All clients.');
  if (data.all_clients && clients.length) throw new AppError(400, 'Choose either All clients or specific clients.');
  return store.tx(() => {
    clients.forEach(clientId => clientFor(store, actor, clientId));
    const value = `bnt_${token()}`;
    const tokenId = id();
    const expiresAt = Date.now() + data.days * 86400000;
    store.run(`INSERT INTO mcp_tokens(id,token_hash,label,all_clients,created_by,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?)`, tokenId, digest(value), data.label, Number(data.all_clients), actor.id, iso(), expiresAt);
    clients.forEach(clientId => store.run('INSERT INTO mcp_clients VALUES(?,?)', tokenId, clientId));
    audit(store, actor, 'mcp.token_issued', 'mcp_token', tokenId, null, { all_clients: data.all_clients, client_count: clients.length });
    return { id: tokenId, token: value, expires_at: new Date(expiresAt).toISOString() };
  });
}

export function revokeJobToken(store, actor, tokenId) {
  requireAdmin(actor);
  return store.tx(() => {
    const result = store.run('UPDATE mcp_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL', iso(), tokenId);
    if (!result.changes) throw new AppError(404, 'Active job credential not found.');
    audit(store, actor, 'mcp.token_revoked', 'mcp_token', tokenId);
    return { ok: true };
  });
}

export function jobActor(store, value) {
  if (!/^bnt_[a-zA-Z0-9_-]{43}$/.test(value)) return null;
  const row = store.get('SELECT id,label,all_clients FROM mcp_tokens WHERE token_hash=? AND expires_at>? AND revoked_at IS NULL', digest(value), Date.now());
  return row ? { kind: 'claude', id: row.id, name: 'claude', label: row.label, all_clients: row.all_clients } : null;
}

export function oauthReader(store, subject) {
  const user = store.get('SELECT id,name,email,role FROM users WHERE oauth_subject=? AND enabled=1', subject);
  return user ? { ...principal(user), readOnly: true, oauthSubject: subject } : null;
}

export function auditPage(store, actor, { after, action, user_id }) {
  requireAdmin(actor);
  const filters = [];
  const params = [];
  if (after) { filters.push('seq<?'); params.push(after); }
  if (action) { filters.push('action=?'); params.push(action); }
  if (user_id) { filters.push('actor_id=?'); params.push(user_id); }
  const rows = store.all(`SELECT * FROM audit_log ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    ORDER BY seq DESC LIMIT 51`, ...params);
  const items = rows.slice(0, 50).map(row => ({ ...row, details: JSON.parse(row.details) }));
  return { items, next: rows.length > 50 ? items.at(-1).seq : null };
}

export function cleanExpired(store) {
  const now = Date.now();
  store.tx(() => {
    store.run('DELETE FROM sessions WHERE expires_at<=?', now);
    store.run('DELETE FROM setup_tokens WHERE expires_at<=?', now);
    store.run('DELETE FROM rate_limits WHERE expires_at<=?', now);
    store.run("UPDATE form_links SET draft='{}' WHERE expires_at<=? AND draft<>'{}'", now);
    store.run('DELETE FROM attachments WHERE submission_id IS NULL AND form_key IN (SELECT token_hash FROM form_links WHERE expires_at<=? OR revoked=1)',now);
  });
}
