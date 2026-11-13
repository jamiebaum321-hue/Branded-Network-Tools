import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AppError, audit, clientScope } from './store.mjs';
import { auditPage, changeAccount, createJobToken, finishSetup, inviteAccount, listAccounts, listJobTokens, rateLimit,
  resetAccount, revokeJobToken, sessionUser, setupInfo, signIn, signOut } from './accounts.mjs';
import { clientDetail, copyFormLink, createClient, getSubmission, listClients, listSubmissions, publicForm,
  revokeFormLinks, saveIntake, submitIntake, updateClient, deleteClient, updateNextStep } from './clients.mjs';
import { contracts, followUps } from './accountwork.mjs';
import { createRecord, deleteRecord, openIssues, updateRecord } from './records.mjs';
import { askAssistant, assistantConfigured } from './assistant.mjs';
import { addActivity, createApproval, decideApproval, listActivityLog, listApprovals, markReviewed, pendingCount, reviewCount } from './approvals.mjs';
import { acknowledgeToday, metrics, today } from './dashboard.mjs';
import { alerts, seeAlerts } from './events.mjs';
import { metadata, mcpHttp } from './mcp.mjs';
import { attachMailId, board, cardDetail, completeFollowup, createCard, decideSuggestion, listActivity, listCards,
  listSuggestions, manualActivity, refreshDue, reviewDraft, staffDraft, stages, suggestionFor, updateCard } from './pipeline.mjs';
import { submissionPdf } from './pdf.mjs';
import { importSeed } from './seed.mjs';
import { boundedInt, choice, int, list, object, str, validate } from './validation.mjs';
import { cleanExpired } from './accounts.mjs';
import { assertWebOrigin, clientIp, empty, json, protect, readJson, readSession, sessionCookie } from './http.mjs';

const assets = new Map(Object.entries({
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'],
  '/ui.mjs': ['ui.mjs', 'text/javascript; charset=utf-8'],
  '/views.mjs': ['views.mjs', 'text/javascript; charset=utf-8'],
  '/intake-fields.mjs': ['intake-fields.mjs', 'text/javascript; charset=utf-8'],
  '/account-fields.mjs': ['account-fields.mjs', 'text/javascript; charset=utf-8'],
  '/record-kinds.mjs': ['record-kinds.mjs', 'text/javascript; charset=utf-8'],
  '/assistant.mjs': ['assistant.mjs', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/favicon.ico': ['assets/brand/favicon.ico', 'image/x-icon'],
  '/assets/brand/network-mark.svg': ['assets/brand/network-mark.svg', 'image/svg+xml'],
  '/assets/accents/network-orbits.svg': ['assets/accents/network-orbits.svg', 'image/svg+xml'],
  '/assets/type/plus-jakarta-sans-latin.woff2': ['assets/type/plus-jakarta-sans-latin.woff2', 'font/woff2'],
}));
const imageAssets = [
  ...['favicon-32', 'favicon-48', 'apple-touch-icon', 'social-share', 'network-touch'].map(name => [`brand/${name}.png`, 'image/png']),
  ...['focus-rings', 'iris-dot-grid', 'connection-ribbon'].map(name => [`accents/${name}.png`, 'image/png']),
  ...['today', 'pipeline', 'clients', 'settings', 'metrics', 'suggested-leads']
    .flatMap(name => ['ink', 'iris'].map(tone => [`icons/${name}-${tone}.png`, 'image/png'])),
  ['icons/alerts-ink.png', 'image/png'],
  ['icons/onboarding-iris.png', 'image/png'],
  ...['pipeline-board', 'client-onboarding', 'suggested-connections', 'pipeline-insights', 'today-caught-up',
    'day-planner', 'pipeline-flow', 'client-portfolio', 'contact-profile', 'workspace-controls', 'onboarding-flow',
    'signal-pipeline', 'signal-today', 'signal-clients', 'signal-intake', 'signal-welcome', 'signal-leads']
    .map(name => [`artwork/${name}.webp`, 'image/webp']),
];
for (const [path, type] of imageAssets) assets.set(`/assets/${path}`, [`assets/${path}`, type]);
const shellPath = /^(?:\/|\/today|\/signin|\/pipeline(?:\/(?:metrics|cards\/[\w-]+|suggestions(?:\/[\w-]+)?))?|\/clients(?:\/[\w-]+(?:\/submissions\/[\w-]+)?)?|\/prospects|\/approvals|\/activity|\/followups|\/contracts|\/admin|\/setup\/[\w-]+|\/onboard\/[\w.-]+)$/;
const ident = '([a-zA-Z0-9_-]{1,80})';
const options = { public: true };

function selectQuery(url, key, schema = str(180)) {
  const value = url.searchParams.get(key)?.trim();
  return value ? validate(schema, value, key) : undefined;
}

function pageQuery(url, limit = 50) {
  return { limit: Math.max(1, boundedInt(url.searchParams.get('limit'), limit, 100)),
    offset: boundedInt(url.searchParams.get('offset'), 0, 1000000) };
}

function boardQuery(url) {
  return { ...pageQuery(url, 30), q: selectQuery(url, 'q'), client_id: selectQuery(url, 'client_id', str(80)),
    owner_id: selectQuery(url, 'owner_id', str(80)), stage: selectQuery(url, 'stage', choice(...stages)),
    due: selectQuery(url, 'due', choice('due', 'scheduled')) };
}

async function visibleOwners(store, actor) {
  if (actor.role === 'admin') return store.all('SELECT id,name,enabled FROM users ORDER BY name');
  const [where, args] = clientScope(actor, 'c.id');
  return store.all(`WITH accessible AS (SELECT c.id,c.owner_id FROM clients c WHERE ${where})
    SELECT DISTINCT u.id,u.name,u.enabled FROM users u WHERE u.id=? OR u.id IN (
      SELECT owner_id FROM accessible UNION SELECT m.user_id FROM client_members m JOIN accessible a ON a.id=m.client_id
      UNION SELECT p.owner_id FROM cards p JOIN accessible a ON a.id=p.client_id) ORDER BY u.name`, ...args, actor.id);
}

export function createHandler(store, config) {
  const routes = [];
  const route = (method, path, handle, policy = {}) => routes.push({ method, regex: new RegExp(`^${path}$`), handle, policy });
  const staticFiles = new Map([...assets].map(([path, [name, type]]) => [path, {
    bytes: readFileSync(new URL(`../public/${name}`, import.meta.url)), type,
  }]));
  const shellTemplate = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const shareImage = new URL('/assets/brand/social-share.png', config.origin).href;
  const shell = { bytes: Buffer.from(shellTemplate.replace('{{SHARE_IMAGE_URL}}', shareImage)), type: 'text/html; charset=utf-8' };

  route('GET', '/api/health', async () => ({ ok: (await store.get('SELECT 1 AS ok')).ok === 1 }), options);
  route('GET', '/api/session', ({ actor }) => ({ user: actor, time_zone: config.timeZone }), options);
  route('GET', '/api/cron/cleanup', async ({ req }) => {
    if (!config.cronSecret || req.headers.authorization !== `Bearer ${config.cronSecret}`) throw new AppError(401, 'Cron authorization required.');
    await cleanExpired(store);
    return { ok: true };
  }, options);
  route('POST', '/api/session', async ({ res, data, ip, session }) => {
    const auth = await signIn(store, data, ip, session);
    res.setHeader('Set-Cookie', sessionCookie(config, auth.value, auth.maxAge));
    return { user: auth.user };
  }, options);
  route('POST', '/api/session/logout', async ({ res, actor, session }) => {
    await signOut(store, actor, session);
    res.setHeader('Set-Cookie', sessionCookie(config, '', 0));
    return { ok: true };
  });
  route('GET', '/api/setup/([\\w-]{43})', async ({ ids, ip }) => {
    await rateLimit(store, `setup-read:${ip}`, 80, 900000);
    return setupInfo(store, ids[0]);
  }, options);
  route('POST', '/api/setup/([\\w-]{43})', async ({ ids, data, ip, res }) => {
    const auth = await finishSetup(store, ids[0], data?.password, ip);
    res.setHeader('Set-Cookie', sessionCookie(config, auth.value, auth.maxAge));
    return { user: auth.user };
  }, options);

  route('GET', '/api/context', async ({ actor }) => ({ clients: (await listClients(store, actor, { limit: 500 })).items, owners: await visibleOwners(store, actor) }));
  route('GET', '/api/today', ({ actor }) => today(store, actor));
  route('POST', '/api/today/seen', ({ actor, data }) => acknowledgeToday(store, actor,
    validate(object({ reply_cursor: int(0, Number.MAX_SAFE_INTEGER) }), data).reply_cursor));
  route('GET', '/api/alerts', async ({ actor }) => { await refreshDue(store); return alerts(store, actor); });
  route('POST', '/api/alerts/seen', ({ actor, data }) => seeAlerts(store, actor,
    validate(object({ ids: list(str(80), 30) }), data).ids));
  route('GET', '/api/board', async ({ actor, url }) => ({ groups: await board(store, actor, boardQuery(url)) }));
  route('GET', '/api/cards', ({ actor, url }) => listCards(store, actor, boardQuery(url)));
  route('POST', '/api/cards', async ({ actor, data }) => ({ card: await createCard(store, actor, data) }));
  route('GET', `/api/cards/${ident}`, async ({ actor, ids, url }) => {
    await refreshDue(store);
    const result = await cardDetail(store, actor, ids[0], selectQuery(url, 'activity_id', str(80)));
    await audit(store, actor, 'card.viewed', 'card', result.card.id, result.card.client_id);
    return result;
  });
  route('PATCH', `/api/cards/${ident}`, async ({ actor, ids, data }) => ({ card: await updateCard(store, actor, ids[0], data) }));
  route('POST', `/api/cards/${ident}/followups/${ident}/complete`, async ({ actor, ids }) => ({ card: await completeFollowup(store, actor, ...ids) }));
  route('GET', `/api/cards/${ident}/activity`, ({ actor, ids, url }) => listActivity(store, actor, ids[0],
    { before: boundedInt(url.searchParams.get('before'), undefined, Number.MAX_SAFE_INTEGER) }));
  route('POST', `/api/cards/${ident}/activity`, async ({ actor, ids, data }) => ({ activity: await manualActivity(store, actor, ids[0], data) }));
  route('POST', `/api/cards/${ident}/activity/${ident}/source`, ({ actor, ids, data }) => attachMailId(store, actor, ...ids, data));
  route('POST', `/api/cards/${ident}/drafts`, async ({ actor, ids, data }) => ({ draft: await staffDraft(store, actor, ids[0], data) }));
  route('POST', `/api/cards/${ident}/drafts/${ident}/review`, ({ actor, ids, data }) => reviewDraft(store, actor, ...ids,
    validate(object({ updated_at: str(40) }), data).updated_at));
  route('GET', '/api/metrics', ({ actor, url }) => metrics(store, actor, { ...boardQuery(url),
    from: selectQuery(url, 'from', str(10)), to: selectQuery(url, 'to', str(10)) }, config.timeZone));

  route('GET', '/api/suggestions', ({ actor, url }) => listSuggestions(store, actor, { ...pageQuery(url, 35),
    client_id: selectQuery(url, 'client_id', str(80)), q: selectQuery(url, 'q'), fit: selectQuery(url, 'fit', str(120)),
    source: selectQuery(url, 'source', str(160)), status: selectQuery(url, 'status', choice('pending','approved','dismissed')) }));
  route('GET', `/api/suggestions/${ident}`, async ({ actor, ids }) => {
    const result = await suggestionFor(store, actor, ids[0]);
    await audit(store, actor, 'suggestion.viewed', 'suggestion', result.id, result.client_id);
    return { suggestion: result };
  });
  route('POST', `/api/suggestions/${ident}/decision`, async ({ actor, ids, data }) => ({ suggestion: await decideSuggestion(store, actor, ids[0],
    validate(object({ decision: choice('approved','dismissed') }), data).decision) }));

  route('GET', '/api/clients', ({ actor, url }) => {
    const group = url.searchParams.get('group');
    if (group && !['clients', 'prospects'].includes(group)) throw new AppError(400, 'Choose clients or prospects.');
    return listClients(store, actor, { ...pageQuery(url, 100), q: selectQuery(url, 'q'), group: group || undefined });
  });
  route('POST', '/api/clients', async ({ actor, data }) => ({ client: await createClient(store, actor, data) }));
  route('GET', `/api/clients/${ident}`, ({ actor, ids }) => clientDetail(store, actor, ids[0]));
  route('PATCH', `/api/clients/${ident}`, async ({ actor, ids, data }) => ({ client: await updateClient(store, actor, ids[0], data) }));
  route('POST', `/api/clients/${ident}/next-step`, async ({ actor, ids, data }) => ({ client: await updateNextStep(store, actor, ids[0], data) }));
  route('POST', `/api/clients/${ident}/records`, async ({ actor, ids, data }) => ({ record: await createRecord(store, actor, ids[0], data) }));
  route('POST', '/api/records', async ({ actor, data }) => ({ record: await createRecord(store, actor, null, data) }));
  route('PATCH', `/api/records/${ident}`, async ({ actor, ids, data }) => ({ record: await updateRecord(store, actor, ids[0], data) }));
  route('DELETE', `/api/records/${ident}`, ({ actor, ids }) => deleteRecord(store, actor, ids[0]));
  route('GET', '/api/issues', async ({ actor }) => ({ items: await openIssues(store, actor) }));
  route('GET', '/api/approvals', ({ actor, url }) => listApprovals(store, actor, {
    status: url.searchParams.get('status') === 'decided' ? 'decided' : 'pending', client_id: url.searchParams.get('client_id') || undefined }));
  route('POST', '/api/approvals', async ({ actor, data }) => ({ approval: await createApproval(store, actor, data) }));
  route('POST', `/api/approvals/${ident}/decision`, async ({ actor, ids, data }) => ({ approval: await decideApproval(store, actor, ids[0], data) }));
  route('GET', '/api/activity-log', ({ actor, url }) => listActivityLog(store, actor, {
    client_id: url.searchParams.get('client_id') || undefined, review: url.searchParams.get('review') === '1' ? 1 : undefined,
    before: url.searchParams.get('before') || undefined }));
  route('POST', '/api/activity-log', async ({ actor, data }) => ({ entry: await addActivity(store, actor, data) }));
  route('POST', `/api/activity-log/${ident}/reviewed`, async ({ actor, ids }) => ({ entry: await markReviewed(store, actor, ids[0]) }));
  route('GET', '/api/badges', async ({ actor }) => ({ approvals: await pendingCount(store, actor), review: await reviewCount(store, actor) }));
  route('GET', '/api/assistant', () => ({ configured: assistantConfigured() }));
  route('POST', '/api/assistant', async ({ actor, data }) => {
    await rateLimit(store, `assistant:${actor.id}`, 30, 600000);
    return askAssistant(store, actor, config, data);
  }, { bodyLimit: 200000 });
  route('GET', '/api/followups', ({ actor }) => followUps(store, actor, config.timeZone));
  route('GET', '/api/contracts', ({ actor }) => contracts(store, actor, config.timeZone));
  route('DELETE', `/api/clients/${ident}`, ({ actor, ids }) => deleteClient(store, actor, ids[0]));
  route('POST', `/api/clients/${ident}/form-link`, ({ actor, ids }) => copyFormLink(store, actor, ids[0], config.linkSecret));
  route('POST', `/api/clients/${ident}/form-link/revoke`, ({ actor, ids }) => revokeFormLinks(store, actor, ids[0]));
  route('GET', `/api/clients/${ident}/submissions`, ({ actor, ids, url }) => listSubmissions(store, actor, ids[0],
    { before: boundedInt(url.searchParams.get('before'), undefined, Number.MAX_SAFE_INTEGER) }));
  route('GET', `/api/clients/${ident}/submissions/${ident}`, async ({ actor, ids }) => {
    const result = await getSubmission(store, actor, ...ids);
    await audit(store, actor, 'intake.viewed', 'submission', result.id, result.client_id);
    return { submission: result };
  });
  route('GET', `/api/clients/${ident}/submissions/${ident}/pdf`, async ({ actor, ids, res }) => {
    const result = await getSubmission(store, actor, ...ids);
    const document = await submissionPdf(result);
    const filename = result.client_name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 65) || 'client';
    await audit(store, actor, 'intake.pdf_exported', 'submission', result.id, result.client_id);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}-onboarding-v${result.version}.pdf"`,
      'Content-Length': document.length, 'Cache-Control': 'no-store' });
    res.end(document);
  });
  route('GET', '/api/onboard/([\\w.-]{80})', async ({ ids, ip }) => {
    await rateLimit(store, `form-read:${ip}`, 150, 900000);
    return publicForm(store, ids[0], config.linkSecret);
  }, options);
  route('POST', '/api/onboard/([\\w.-]{80})/draft', async ({ ids, data, ip }) => {
    await rateLimit(store, `form-write:${ip}`, 150, 900000);
    return saveIntake(store, ids[0], data, config.linkSecret);
  }, options);
  route('POST', '/api/onboard/([\\w.-]{80})/submit', async ({ ids, data, ip }) => {
    await rateLimit(store, `form-submit:${ip}`, 40, 900000);
    return { submission: await submitIntake(store, ids[0], data, config.linkSecret) };
  }, options);

  route('GET', '/api/admin/accounts', async ({ actor }) => ({ items: await listAccounts(store, actor) }));
  route('POST', '/api/admin/accounts', ({ actor, data }) => inviteAccount(store, actor, data));
  route('PATCH', `/api/admin/accounts/${ident}`, async ({ actor, ids, data }) => ({ user: await changeAccount(store, actor, ids[0], data) }));
  route('POST', `/api/admin/accounts/${ident}/setup`, async ({ actor, ids }) => ({ setup: await resetAccount(store, actor, ids[0]) }));
  route('GET', '/api/admin/job-tokens', async ({ actor }) => ({ items: await listJobTokens(store, actor) }));
  route('POST', '/api/admin/job-tokens', ({ actor, data }) => createJobToken(store, actor, data));
  route('POST', `/api/admin/job-tokens/${ident}/revoke`, ({ actor, ids }) => revokeJobToken(store, actor, ids[0]));
  route('GET', '/api/admin/audit', ({ actor, url }) => auditPage(store, actor, {
    after: boundedInt(url.searchParams.get('after'), undefined, Number.MAX_SAFE_INTEGER),
    user_id: selectQuery(url, 'user_id', str(80)), action: selectQuery(url, 'action', str(100)),
  }));
  route('POST', '/api/admin/import/(preview|apply)', ({ actor, ids, data }) => importSeed(store, actor, data, ids[0] === 'preview'),
    { bodyLimit: 4 * 1024 * 1024 });

  return async function handle(req, res) {
    protect(res, config);
    try {
      if (!config.anyHost && !(config.hosts ?? new Set([config.origin.host.toLowerCase()])).has(req.headers.host?.toLowerCase())) {
        req.resume();
        throw new AppError(421, 'Use the configured app address.');
      }
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new AppError(400, 'Invalid request URL.');
      const url = new URL(req.url, config.origin);
      const path = url.pathname;
      if (path === '/mcp') return await mcpHttp(req, res, store, config);
      if (config.oauth && ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'].includes(path)
        && req.method === 'GET') return json(res, 200, metadata(config));
      if (path.startsWith('/api/')) {
        const candidates = routes.filter(row => row.regex.test(path));
        const found = candidates.find(row => row.method === req.method);
        if (!found) {
          req.resume();
          if (candidates.length) return empty(res, 405, { Allow: candidates.map(row => row.method).join(', ') });
          throw new AppError(404, 'This endpoint does not exist.');
        }
        const session = readSession(req, config);
        const actor = await sessionUser(store, session);
        if (!actor && !found.policy.public) { req.resume(); throw new AppError(401, 'Sign in to continue.'); }
        if (path.startsWith('/api/admin/') && actor?.role !== 'admin') { req.resume(); throw new AppError(403, 'Admin access is required.'); }
        const isWrite = req.method !== 'GET';
        if (isWrite) assertWebOrigin(req, config);
        const data = isWrite ? await readJson(req, found.policy.bodyLimit) : undefined;
        // Revalidate after receiving a body so account revocation during a slow upload takes effect.
        const current = isWrite && actor ? await sessionUser(store, session) : actor;
        if (!current && !found.policy.public) throw new AppError(401, 'Sign in to continue.');
        const response = await found.handle({ req, res, actor: current, data, session, url,
          ids: found.regex.exec(path).slice(1), ip: clientIp(req, config) });
        if (!res.writableEnded) json(res, 200, response);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { req.resume(); return empty(res, 405, { Allow: 'GET, HEAD' }); }
      const file = staticFiles.get(path) ?? (shellPath.test(path) ? shell : null);
      if (!file) throw new AppError(404, 'Page not found.');
      res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.bytes.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : file.bytes);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof AppError) json(res, error.status, { error: error.message, ...(error.details ? { details: error.details } : {}) });
      else {
        const incident = randomUUID();
        console.error(`[${incident}] ${error.name}: ${error.code ?? 'unexpected'} ${process.env.DEBUG_ERRORS ? error.message : ''}\n${error.stack?.split('\n').slice(1, 4).join('\n')}`);
        json(res, 500, { error: 'Something went wrong. Try again or share the reference with an admin.', incident });
      }
    }
  };
}

export function createApp(store, config) {
  const server = createServer({ requestTimeout: 30000, headersTimeout: 10000, maxHeaderSize: 16384 }, createHandler(store, config));
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  return server;
}
