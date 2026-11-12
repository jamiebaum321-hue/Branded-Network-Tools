import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AppError, audit, clientScope } from './store.mjs';
import { auditPage, changeAccount, createJobToken, finishSetup, inviteAccount, listAccounts, listJobTokens, rateLimit,
  resetAccount, revokeJobToken, sessionUser, setupInfo, signIn, signOut } from './accounts.mjs';
import { addClientNote, clientBoard, clientDetail, clientTimeline, copyFormLink, createClient, getSubmission, listClients, listSubmissions,
  publicForm, revokeFormLinks, saveIntake, saveProfile, startOnboarding, submitIntake, updateClient } from './clients.mjs';
import { acknowledgeToday, metrics, today } from './dashboard.mjs';
import { alerts, seeAlerts } from './events.mjs';
import { metadata, mcpHttp } from './mcp.mjs';
import { attachMailId, board, cardDetail, completeFollowup, createCard, decideSuggestion, listActivity, listCards,
  listSuggestions, manualActivity, refreshDue, reviewDraft, staffDraft, stages, suggestionCounts, suggestionFor, updateCard } from './pipeline.mjs';
import { reportPdf, submissionPdf } from './pdf.mjs';
import { addEntry, currentPeriod, deleteEntry, monthlyReport, reportDocument, reportsOverview, saveSummary, updateEntry } from './reports.mjs';
import { stageIds } from '../public/lifecycle.mjs';
import { importSeed } from './seed.mjs';
import { boundedInt, choice, int, list, object, str, validate } from './validation.mjs';
import { assertWebOrigin, empty, json, protect, readJson, readSession, sessionCookie } from './http.mjs';

const assets = new Map(Object.entries({
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'],
  '/ui.mjs': ['ui.mjs', 'text/javascript; charset=utf-8'],
  '/views.mjs': ['views.mjs', 'text/javascript; charset=utf-8'],
  '/intake-fields.mjs': ['intake-fields.mjs', 'text/javascript; charset=utf-8'],
  '/lifecycle.mjs': ['lifecycle.mjs', 'text/javascript; charset=utf-8'],
  '/client-views.mjs': ['client-views.mjs', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
}));
const shellPath = /^(?:\/|\/today|\/signin|\/opportunities|\/reports|\/pipeline(?:\/(?:metrics|cards\/[\w-]+|suggestions(?:\/[\w-]+)?))?|\/clients(?:\/[\w-]+(?:\/submissions\/[\w-]+)?)?|\/admin|\/setup\/[\w-]+|\/onboard\/[\w.-]+)$/;
const ident = '([a-zA-Z0-9_-]{1,80})';
const month = '(\\d{4}-\\d\\d)';
const fileName = (value) => value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 65) || 'client';
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

function visibleOwners(store, actor) {
  if (actor.role === 'admin') return store.all('SELECT id,name,enabled FROM users ORDER BY name');
  const [where, args] = clientScope(actor, 'c.id');
  return store.all(`WITH accessible AS (SELECT c.id,c.owner_id FROM clients c WHERE ${where})
    SELECT DISTINCT u.id,u.name,u.enabled FROM users u WHERE u.id=? OR u.id IN (
      SELECT owner_id FROM accessible UNION SELECT m.user_id FROM client_members m JOIN accessible a ON a.id=m.client_id
      UNION SELECT p.owner_id FROM cards p JOIN accessible a ON a.id=p.client_id) ORDER BY u.name`, ...args, actor.id);
}

function sendPdf(res, document, filename) {
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': document.length, 'Cache-Control': 'no-store' });
  res.end(document);
}

export function createApp(store, config) {
  const routes = [];
  const route = (method, path, handle, policy = {}) => routes.push({ method, regex: new RegExp(`^${path}$`), handle, policy });
  const staticFiles = new Map([...assets].map(([path, [name, type]]) => [path, {
    bytes: readFileSync(new URL(`../public/${name}`, import.meta.url)), type,
  }]));
  const shell = { bytes: readFileSync(new URL('../public/index.html', import.meta.url)), type: 'text/html; charset=utf-8' };

  route('GET', '/api/health', () => ({ ok: store.get('SELECT 1 AS ok').ok === 1 }), options);
  route('GET', '/api/session', ({ actor }) => ({ user: actor, demo: config.demo, time_zone: config.timeZone }), options);
  route('POST', '/api/session', async ({ res, data, ip, session }) => {
    const auth = await signIn(store, data, ip, session);
    res.setHeader('Set-Cookie', sessionCookie(config, auth.value, auth.maxAge));
    return { user: auth.user };
  }, options);
  route('POST', '/api/session/logout', ({ res, actor, session }) => {
    signOut(store, actor, session);
    res.setHeader('Set-Cookie', sessionCookie(config, '', 0));
    return { ok: true };
  });
  route('GET', '/api/setup/([\\w-]{43})', ({ ids, ip }) => {
    rateLimit(store, `setup-read:${ip}`, 80, 900000);
    return setupInfo(store, ids[0]);
  }, options);
  route('POST', '/api/setup/([\\w-]{43})', async ({ ids, data, ip, res }) => {
    const auth = await finishSetup(store, ids[0], data?.password, ip);
    res.setHeader('Set-Cookie', sessionCookie(config, auth.value, auth.maxAge));
    return { user: auth.user };
  }, options);

  route('GET', '/api/context', ({ actor }) => ({ clients: listClients(store, actor, { limit: 500 }).items, owners: visibleOwners(store, actor) }));
  route('GET', '/api/today', ({ actor }) => today(store, actor, config.timeZone));
  route('POST', '/api/today/seen', ({ actor, data }) => acknowledgeToday(store, actor,
    validate(object({ reply_cursor: int(0, Number.MAX_SAFE_INTEGER) }), data).reply_cursor));
  route('GET', '/api/alerts', ({ actor }) => { refreshDue(store); return alerts(store, actor); });
  route('POST', '/api/alerts/seen', ({ actor, data }) => seeAlerts(store, actor,
    validate(object({ ids: list(str(80), 30) }), data).ids));
  route('GET', '/api/board', ({ actor, url }) => ({ groups: board(store, actor, boardQuery(url)) }));
  route('GET', '/api/cards', ({ actor, url }) => listCards(store, actor, boardQuery(url)));
  route('POST', '/api/cards', ({ actor, data }) => ({ card: createCard(store, actor, data) }));
  route('GET', `/api/cards/${ident}`, ({ actor, ids, url }) => {
    refreshDue(store);
    const result = cardDetail(store, actor, ids[0], selectQuery(url, 'activity_id', str(80)));
    audit(store, actor, 'card.viewed', 'card', result.card.id, result.card.client_id);
    return result;
  });
  route('PATCH', `/api/cards/${ident}`, ({ actor, ids, data }) => ({ card: updateCard(store, actor, ids[0], data) }));
  route('POST', `/api/cards/${ident}/followups/${ident}/complete`, ({ actor, ids }) => ({ card: completeFollowup(store, actor, ...ids) }));
  route('GET', `/api/cards/${ident}/activity`, ({ actor, ids, url }) => listActivity(store, actor, ids[0],
    { before: boundedInt(url.searchParams.get('before'), undefined, Number.MAX_SAFE_INTEGER) }));
  route('POST', `/api/cards/${ident}/activity`, ({ actor, ids, data }) => ({ activity: manualActivity(store, actor, ids[0], data) }));
  route('POST', `/api/cards/${ident}/activity/${ident}/source`, ({ actor, ids, data }) => attachMailId(store, actor, ...ids, data));
  route('POST', `/api/cards/${ident}/drafts`, ({ actor, ids, data }) => ({ draft: staffDraft(store, actor, ids[0], data) }));
  route('POST', `/api/cards/${ident}/drafts/${ident}/review`, ({ actor, ids, data }) => reviewDraft(store, actor, ...ids,
    validate(object({ updated_at: str(40) }), data).updated_at));
  route('GET', '/api/metrics', ({ actor, url }) => metrics(store, actor, { ...boardQuery(url),
    from: selectQuery(url, 'from', str(10)), to: selectQuery(url, 'to', str(10)) }, config.timeZone));

  route('GET', '/api/suggestions', ({ actor, url }) => listSuggestions(store, actor, { ...pageQuery(url, 35),
    client_id: selectQuery(url, 'client_id', str(80)), q: selectQuery(url, 'q'), fit: selectQuery(url, 'fit', str(120)),
    source: selectQuery(url, 'source', str(160)), status: selectQuery(url, 'status', choice('pending','approved','dismissed')) }));
  route('GET', '/api/suggestion-counts', ({ actor, url }) => suggestionCounts(store, actor, selectQuery(url, 'client_id', str(80))));
  route('GET', `/api/suggestions/${ident}`, ({ actor, ids }) => {
    const result = suggestionFor(store, actor, ids[0]);
    audit(store, actor, 'suggestion.viewed', 'suggestion', result.id, result.client_id);
    return { suggestion: result };
  });
  route('POST', `/api/suggestions/${ident}/decision`, ({ actor, ids, data }) => ({ suggestion: decideSuggestion(store, actor, ids[0],
    validate(object({ decision: choice('approved','dismissed') }), data).decision) }));

  const clientQuery = url => ({ q: selectQuery(url, 'q'), owner_id: selectQuery(url, 'owner_id', str(80)),
    stage: selectQuery(url, 'stage', choice(...stageIds)), phase: selectQuery(url, 'phase', choice('sales', 'delivery', 'closed')) });
  route('GET', '/api/clients', ({ actor, url }) => listClients(store, actor, { ...pageQuery(url), ...clientQuery(url) }));
  route('GET', '/api/client-board', ({ actor, url }) => ({ groups: clientBoard(store, actor, { phase: 'sales', ...clientQuery(url), stage: undefined }) }));
  route('POST', '/api/clients', ({ actor, data }) => ({ client: createClient(store, actor, data) }));
  route('GET', `/api/clients/${ident}`, ({ actor, ids }) => clientDetail(store, actor, ids[0]));
  route('PATCH', `/api/clients/${ident}`, ({ actor, ids, data }) => ({ client: updateClient(store, actor, ids[0], data) }));
  route('POST', `/api/clients/${ident}/onboarding`, ({ actor, ids }) => startOnboarding(store, actor, ids[0], config.linkSecret));
  route('POST', `/api/clients/${ident}/notes`, ({ actor, ids, data }) => addClientNote(store, actor, ids[0], data));
  route('GET', `/api/clients/${ident}/timeline`, ({ actor, ids, url }) => clientTimeline(store, actor, ids[0],
    { before: boundedInt(url.searchParams.get('before'), undefined, Number.MAX_SAFE_INTEGER) }));
  route('POST', `/api/clients/${ident}/profile`, ({ actor, ids, data }) => ({ submission: saveProfile(store, actor, ids[0], data) }));
  route('POST', `/api/clients/${ident}/form-link`, ({ actor, ids }) => copyFormLink(store, actor, ids[0], config.linkSecret));
  route('POST', `/api/clients/${ident}/form-link/revoke`, ({ actor, ids }) => revokeFormLinks(store, actor, ids[0]));
  route('GET', `/api/clients/${ident}/submissions`, ({ actor, ids, url }) => listSubmissions(store, actor, ids[0],
    { before: boundedInt(url.searchParams.get('before'), undefined, Number.MAX_SAFE_INTEGER) }));
  route('GET', `/api/clients/${ident}/submissions/${ident}`, ({ actor, ids }) => {
    const result = getSubmission(store, actor, ...ids);
    audit(store, actor, 'intake.viewed', 'submission', result.id, result.client_id);
    return { submission: result };
  });
  route('GET', `/api/clients/${ident}/submissions/${ident}/pdf`, async ({ actor, ids, res }) => {
    const result = getSubmission(store, actor, ...ids);
    const document = await submissionPdf(result, config);
    audit(store, actor, 'intake.pdf_exported', 'submission', result.id, result.client_id);
    sendPdf(res, document, `${fileName(result.client_name)}-onboarding-v${result.version}.pdf`);
  });

  route('GET', '/api/reports', ({ actor, url }) => reportsOverview(store, actor,
    selectQuery(url, 'period', str(7)) ?? currentPeriod(config.timeZone), config.timeZone));
  route('GET', `/api/clients/${ident}/reports/${month}`, ({ actor, ids }) => monthlyReport(store, actor, ...ids, config.timeZone));
  route('POST', `/api/clients/${ident}/reports/${month}`, ({ actor, ids, data }) => saveSummary(store, actor, ...ids, data));
  route('GET', `/api/clients/${ident}/reports/${month}/pdf`, async ({ actor, ids, res }) => {
    const report = monthlyReport(store, actor, ...ids, config.timeZone);
    const document = await reportPdf(reportDocument(report), config);
    audit(store, actor, 'report.pdf_exported', 'report', null, report.client.id, { period: report.period });
    sendPdf(res, document, `${fileName(report.client.name)}-report-${report.period}.pdf`);
  });
  route('POST', `/api/clients/${ident}/report-entries`, ({ actor, ids, data }) => ({ entry: addEntry(store, actor, ids[0], data) }));
  route('PATCH', `/api/report-entries/${ident}`, ({ actor, ids, data }) => ({ entry: updateEntry(store, actor, ids[0], data) }));
  route('POST', `/api/report-entries/${ident}/delete`, ({ actor, ids }) => deleteEntry(store, actor, ids[0]));
  route('GET', '/api/onboard/([\\w.-]{80})', ({ ids, ip }) => {
    rateLimit(store, `form-read:${ip}`, 150, 900000);
    return publicForm(store, ids[0], config.linkSecret);
  }, options);
  route('POST', '/api/onboard/([\\w.-]{80})/draft', ({ ids, data, ip }) => {
    rateLimit(store, `form-write:${ip}`, 150, 900000);
    return saveIntake(store, ids[0], data, config.linkSecret);
  }, options);
  route('POST', '/api/onboard/([\\w.-]{80})/submit', ({ ids, data, ip }) => {
    rateLimit(store, `form-submit:${ip}`, 40, 900000);
    return { submission: submitIntake(store, ids[0], data, config.linkSecret) };
  }, options);

  route('GET', '/api/admin/accounts', ({ actor }) => ({ items: listAccounts(store, actor) }));
  route('POST', '/api/admin/accounts', ({ actor, data }) => inviteAccount(store, actor, data));
  route('PATCH', `/api/admin/accounts/${ident}`, ({ actor, ids, data }) => ({ user: changeAccount(store, actor, ids[0], data) }));
  route('POST', `/api/admin/accounts/${ident}/setup`, ({ actor, ids }) => ({ setup: resetAccount(store, actor, ids[0]) }));
  route('GET', '/api/admin/job-tokens', ({ actor }) => ({ items: listJobTokens(store, actor) }));
  route('POST', '/api/admin/job-tokens', ({ actor, data }) => createJobToken(store, actor, data));
  route('POST', `/api/admin/job-tokens/${ident}/revoke`, ({ actor, ids }) => revokeJobToken(store, actor, ids[0]));
  route('GET', '/api/admin/audit', ({ actor, url }) => auditPage(store, actor, {
    after: boundedInt(url.searchParams.get('after'), undefined, Number.MAX_SAFE_INTEGER),
    user_id: selectQuery(url, 'user_id', str(80)), action: selectQuery(url, 'action', str(100)),
  }));
  route('POST', '/api/admin/import/(preview|apply)', ({ actor, ids, data }) => importSeed(store, actor, data, ids[0] === 'preview'),
    { bodyLimit: 5 * 1024 * 1024 });

  const server = createServer({ requestTimeout: 30000, headersTimeout: 10000, maxHeaderSize: 16384 }, async (req, res) => {
    protect(res, config);
    try {
      if (req.headers.host?.toLowerCase() !== config.origin.host.toLowerCase()) {
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
        const actor = sessionUser(store, session);
        if (!actor && !found.policy.public) { req.resume(); throw new AppError(401, 'Sign in to continue.'); }
        if (path.startsWith('/api/admin/') && actor?.role !== 'admin') { req.resume(); throw new AppError(403, 'Admin access is required.'); }
        const isWrite = req.method !== 'GET';
        if (isWrite) assertWebOrigin(req, config);
        const data = isWrite ? await readJson(req, found.policy.bodyLimit) : undefined;
        // Revalidate after receiving a body so account revocation during a slow upload takes effect.
        const current = isWrite && actor ? sessionUser(store, session) : actor;
        if (!current && !found.policy.public) throw new AppError(401, 'Sign in to continue.');
        const response = await found.handle({ res, actor: current, data, session, url,
          ids: found.regex.exec(path).slice(1), ip: req.socket.remoteAddress ?? 'unknown' });
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
        console.error(`[${incident}] ${error.name}: ${error.code ?? 'unexpected'}\n${error.stack?.split('\n').slice(1, 4).join('\n')}`);
        json(res, 500, { error: 'Something went wrong. Try again or share the reference with an admin.', incident });
      }
    }
  });
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  return server;
}
