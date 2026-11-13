import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { bootstrap, bootstrapFromEnv } from '../server/accounts.mjs';
import { createApp } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';
import { applySealedImport, seal } from '../server/sealed-import.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Each test gets its own Postgres schema in TEST_DATABASE_URL, dropped afterwards.
const databaseUrl = process.env.TEST_DATABASE_URL;
const test = (name, fn) => nodeTest(name, { skip: !databaseUrl && 'Set TEST_DATABASE_URL to a disposable Postgres database.' }, fn);

async function isolatedSchema(t) {
  const schema = `test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  return schema;
}

const adminEmail = 'admin@example.test';
const password = 'Example-Test-Password-24';
const past = () => new Date(Date.now() - 86400000).toISOString();
const future = () => new Date(Date.now() + 86400000).toISOString();

async function fixture(t) {
  const store = await openStore(databaseUrl, { schema: await isolatedSchema(t) });
  const config = { production: false, origin: new URL('http://127.0.0.1:1'), timeZone: 'America/New_York',
    linkSecret: 'disposable-test-link-secret-0123456789', oauth: null, mcpOrigins: new Set(), trustProxy: false, cronSecret: null };
  const server = createApp(store, config);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.origin = new URL(`http://127.0.0.1:${server.address().port}`);
  config.mcpOrigins.add(config.origin.origin);
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
    await store.close();
  });
  const request = (path, { method = 'GET', body, cookie, headers = {} } = {}) => fetch(new URL(path, config.origin), {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: config.origin.origin } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const check = async (path, options, expected = 200) => {
    const res = await request(path, options);
    const result = await res.json();
    assert.equal(res.status, expected, `${path}: ${JSON.stringify(result)}`);
    return { result, res };
  };
  const setup = await bootstrap(store, 'First Admin', adminEmail);
  const activate = async (link) => {
    const { result, res } = await check(`/api${link}`, { method: 'POST', body: { password } });
    return { user: result.user, cookie: res.headers.get('set-cookie').split(';')[0] };
  };
  const owner = await activate(setup.path);
  const as = (cookie = owner.cookie) => async (path, body, method, status) => (await check(path, {
    cookie, method: method || (body === undefined ? 'GET' : 'POST'), ...(body === undefined ? {} : { body }),
  }, status)).result;
  const admin = as();
  const addClient = async (name = 'Sample Client', other = {}) => (await admin('/api/clients', { name, ...other })).client;
  const addCard = async (client, other = {}) => (await admin('/api/cards', { client_id: client.id, company: 'Sample Restaurant', person: 'Alex Example', ...other })).card;
  const tokenFor = async (client) => (await admin('/api/admin/job-tokens', {
    label: 'Test job', all_clients: false, client_ids: [client.id], days: 1,
  })).token;
  let rpcId = 0;
  const rpc = async (token, method, params = {}, status = 200, headers = {}) => {
    const response = await request('/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: ++rpcId, method, params },
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', ...headers } });
    const json = await response.json();
    assert.equal(response.status, status, JSON.stringify(json));
    return json.result ?? json.error;
  };
  const call = async (token, name, args) => (await rpc(token, 'tools/call', { name, arguments: args })).structuredContent;
  return { store, config, request, check, activate, owner, as, admin, addClient, addCard, tokenFor, rpc, call };
}

test('sign-in, client isolation, multiple admins, account revocation and audit', async t => {
  const f = await fixture(t);
  const anonymous = await f.request('/api/board');
  assert.equal(anonymous.status, 401);
  const denial = await f.request('/api/clients', { method: 'POST', body: { name: 'Bad origin' }, cookie: f.owner.cookie,
    headers: { Origin: 'https://invalid.example' } });
  assert.equal(denial.status, 403);
  const { setup } = await f.admin('/api/admin/accounts', { name: 'Member', email: 'member@example.test', role: 'member' });
  const member = await f.activate(setup.path);
  await f.check(`/api${setup.path}`, { method: 'POST', body: { password } }, 410);
  const client = await f.addClient('Shared client', { member_ids: [member.user.id] });
  const restricted = await f.addClient('Restricted client');
  const personal = f.as(member.cookie);
  assert.deepEqual((await personal('/api/clients')).items.map(row => row.id), [client.id]);
  await personal(`/api/clients/${restricted.id}`, undefined, 'GET', 404);
  await personal('/api/admin/accounts', undefined, 'GET', 403);
  const second = await f.admin('/api/admin/accounts', { name: 'Second Admin', email: 'second@example.test', role: 'admin' });
  const authorized = await f.activate(second.setup.path);
  assert.equal((await f.as(authorized.cookie)('/api/admin/accounts')).items.filter(u => u.role === 'admin').length, 2);
  await f.admin(`/api/admin/accounts/${member.user.id}`, { enabled: false }, 'PATCH');
  await personal('/api/today', undefined, 'GET', 401);
  const entries = (await f.admin('/api/admin/audit')).items;
  assert(entries.some(row => row.action === 'account.updated' && row.actor_id === f.owner.user.id));
  assert(entries.some(row => row.action === 'account.password_set' && row.actor_id === authorized.user.id));
});

test('Claude scope and replay-safe sent and reply logs, metrics, and alerts', async t => {
  const f = await fixture(t);
  const client = await f.addClient();
  const card = await f.addCard(client);
  const other = await f.addCard(await f.addClient('Outside job scope'));
  const job = await f.tokenFor(client);
  await f.rpc('invalid', 'tools/list', {}, 401);
  await f.rpc(job, 'tools/list', {}, 403, { Origin: 'https://invalid.example' });
  assert.equal((await f.rpc(job, 'initialize', { protocolVersion: '2025-11-25' })).protocolVersion, '2025-11-25');
  const tools = (await f.rpc(job, 'tools/list')).tools;
  assert.deepEqual(tools.filter(tool => !tool.annotations.readOnlyHint).map(tool => tool.name).sort(),
    ['add_suggested_lead', 'log_reply', 'log_sent_email', 'save_draft']);
  assert.equal((await f.rpc(job, 'tools/call', { name: 'move_stage', arguments: {} })).code, -32602);
  assert.equal((await f.call(job, 'get_pipeline_card', { card_id: other.id })).status, 404);
  const sent = { card_id: card.id, mailbox_scope: 'team', outlook_message_id: 'outbound-1', sent_at: past(), subject: 'Intro' };
  const first = await f.call(job, 'log_sent_email', sent);
  assert.equal(first.actor, 'claude');
  assert.equal(first.replayed, false);
  assert.deepEqual(await f.call(job, 'log_sent_email', sent), { ...first, replayed: true });
  const reply = { card_id: card.id, mailbox_scope: 'team', outlook_message_id: 'inbound-1', received_at: past(), body: 'Let’s talk.' };
  const replayed = await Promise.all([f.call(job, 'log_reply', reply), f.call(job, 'log_reply', reply)]);
  assert.equal(replayed[0].activity_id, replayed[1].activity_id);
  assert.equal(replayed.filter(row => row.replayed).length, 1);
  assert.equal((await f.call(job, 'list_card_activity', { card_id: card.id })).items.length, 2);
  const feed = await f.call(job, 'list_events', {});
  assert.equal(feed.items.filter(row => row.type === 'reply_logged').length, 1);
  assert.equal(feed.items[0].audience[0].email, adminEmail);
  assert.equal((await f.call(job, 'list_events', { after: feed.next_cursor })).items.length, 0);
  assert.equal((await f.admin('/api/alerts')).unread, 1);
  const stats = await f.admin('/api/metrics');
  assert.equal(stats.sent, 1);
  assert.equal(stats.replies, 1);
  const sameClientCard = await f.addCard(client, { company: 'Different card' });
  assert.equal((await f.call(job, 'log_sent_email', { ...sent, card_id: sameClientCard.id })).status, 409);
});

test('OAuth MCP identities are read-only and require audience, scope and client access', async t => {
  const f = await fixture(t);
  const issuer = 'https://identity.example.test';
  const resource = new URL('/mcp', f.config.origin).href;
  f.config.oauth = { issuer, introspection: new URL('/introspect', issuer), clientId: 'mcp', secret: 'example' };
  const { setup } = await f.admin('/api/admin/accounts', { name: 'Reader', email: 'reader@example.test', role: 'member' });
  const reader = await f.activate(setup.path);
  await f.admin(`/api/admin/accounts/${reader.user.id}`, { oauth_subject: 'approved-subject' }, 'PATCH');
  const allowed = await f.addCard(await f.addClient('Assigned client', { member_ids: [reader.user.id] }));
  const denied = await f.addCard(await f.addClient('Unassigned client'));
  const fetchLocally = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input, options) => {
    if (input.href !== f.config.oauth.introspection.href) return fetchLocally(input, options);
    const bearer = options.body.get('token');
    return Promise.resolve(Response.json({ active: true, iss: issuer,
      aud: bearer === 'wrong-audience' ? 'https://elsewhere.example.test/mcp' : resource,
      scope: bearer === 'missing-scope' ? '' : 'pipeline:read', sub: 'approved-subject' }));
  });
  const discovery = await f.check('/.well-known/oauth-protected-resource/mcp', {});
  assert.equal(discovery.result.resource, resource);
  await f.rpc('wrong-audience', 'tools/list', {}, 401);
  await f.rpc('missing-scope', 'tools/list', {}, 403);
  assert((await f.rpc('reader-token', 'tools/list')).tools.every(tool => tool.annotations.readOnlyHint));
  assert.equal((await f.rpc('reader-token', 'tools/call', { name: 'log_reply' })).code, -32602);
  assert.equal((await f.call('reader-token', 'get_pipeline_card', { card_id: allowed.id })).card.id, allowed.id);
  assert.equal((await f.call('reader-token', 'get_pipeline_card', { card_id: denied.id })).status, 404);
  await f.admin(`/api/admin/accounts/${reader.user.id}`, { enabled: false }, 'PATCH');
  await f.rpc('reader-token', 'tools/list', {}, 403);
});

test('due occurrences, Today, draft protection, stage changes and event replay', async t => {
  const f = await fixture(t);
  const client = await f.addClient();
  const card = await f.addCard(client, { stage: 'reached_out', due_at: past(), email: 'contact@example.test' });
  const job = await f.tokenFor(client);
  const today = await f.admin('/api/today');
  assert.equal(today.followups[0].card_id, card.id);
  assert.equal(today.drafts[0].extra, 'template');
  const due = (await f.call(job, 'list_due_followups', {})).items[0];
  assert.equal(due.followup_id, card.followup_id);
  assert.equal((await f.call(job, 'get_pipeline_card', { card_id: card.id })).card.draft_status, 'awaiting_review');
  const input = { card_id: card.id, followup_id: due.followup_id, subject: 'Follow up', body: 'Can we talk next week?' };
  const saved = await f.call(job, 'save_draft', input);
  assert.equal((await f.call(job, 'save_draft', input)).replayed, true);
  const draft = (await f.admin(`/api/cards/${card.id}`)).drafts[0];
  assert.equal(draft.id, saved.draft_id);
  assert.equal(draft.source, 'claude');
  await f.admin(`/api/cards/${card.id}/drafts`, { draft_id: draft.id, updated_at: draft.updated_at, subject: 'Human edit', body: 'Edited text' });
  const changed = await f.call(job, 'save_draft', { ...input, mailbox_scope: 'team', outlook_message_id: 'source-2', body: 'New draft' });
  assert.equal(changed.preserved, true);
  assert.equal((await f.admin(`/api/cards/${card.id}`)).drafts[0].subject, 'Human edit');
  const reply = await f.call(job, 'log_reply', { card_id: card.id, mailbox_scope: 'team', outlook_message_id: 'fresh', received_at: past() });
  const fresh = await f.admin('/api/today');
  assert.equal(fresh.replies[0].id, reply.activity_id);
  assert.match(fresh.replies[0].href, /#activity-/);
  await f.admin('/api/today/seen', { reply_cursor: fresh.reply_cursor });
  assert.deepEqual((await f.admin('/api/today')).replies, []);
  await f.admin(`/api/cards/${card.id}`, { version: card.version, stage: 'in_conversation', due_at: future() }, 'PATCH');
  await f.admin(`/api/cards/${card.id}`, { version: card.version, stage: 'closed', outcome: 'Declined' }, 'PATCH', 409);
  const feed = (await f.call(job, 'list_events', {})).items;
  assert.equal(feed.filter(row => row.type === 'follow_up_due').length, 1);
  assert.equal(feed.find(row => row.type === 'follow_up_due').actionable, false);
  assert.equal(feed.filter(row => row.type === 'stage_changed').length, 1);
  const stageChange = (await f.call(job, 'list_card_activity', { card_id: card.id })).items.find(row => row.kind === 'stage');
  assert.equal(stageChange.detail.entered_at, card.entered_at);
});

test('discovered lead approval and dismissal stay with staff', async t => {
  const f = await fixture(t);
  const client = await f.addClient();
  const job = await f.tokenFor(client);
  const input = { client_id: client.id, company: 'New Restaurant Group', person: 'Rory Example', reason: 'Growing drive-through footprint',
    source: 'Apollo', evidence: [{ source: 'HubSpot', detail: 'Example ICP evidence' }], fit: 'Strong', branded_relationship: 'Known', score: 91, candidate_key: 'person:example-01' };
  const first = await f.call(job, 'add_suggested_lead', input);
  assert.equal(first.status, 'pending');
  assert.equal((await f.call(job, 'add_suggested_lead', input)).suggestion_id, first.suggestion_id);
  assert.equal((await f.admin('/api/today')).leads[0].id, first.suggestion_id);
  const path = `/api/suggestions/${first.suggestion_id}/decision`;
  const approved = await f.admin(path, { decision: 'approved' });
  assert.equal((await f.admin(path, { decision: 'approved' })).suggestion.card_id, approved.suggestion.card_id);
  const { card } = await f.admin(`/api/cards/${approved.suggestion.card_id}`);
  assert.equal(card.stage, 'to_contact');
  assert.equal(card.fit_reason, input.reason);
  assert.equal(card.person, input.person);
  assert.equal(card.branded_relationship, input.branded_relationship);
  const other = await f.call(job, 'add_suggested_lead', { ...input, candidate_key: 'company:example-02', person: '' });
  assert.equal((await f.admin(`/api/suggestions/${other.suggestion_id}/decision`, { decision: 'dismissed' })).suggestion.card_id, null);
  assert.deepEqual((await f.admin('/api/today')).leads, []);
});

test('onboarding drafts, a single submission event, archived versions and protected PDF', async t => {
  const f = await fixture(t);
  const client = await f.addClient('Café North');
  const job = await f.tokenFor(client);
  const link = await f.admin(`/api/clients/${client.id}/form-link`, {});
  assert.equal((await f.admin(`/api/clients/${client.id}/form-link`, {})).path, link.path);
  const form = `/api${link.path}`;
  const answers = { company: client.name, contact_name: 'Josée Example', contact_email: 'intake@example.test', icp: 'Multiunit QSR',
    minimum_locations: 0, priority_targets: [{ company: 'Named target' }], assets: [{ label: 'One-pager', link: 'https://example.com/folder' }] };
  await f.check(`${form}/draft`, { method: 'POST', body: answers });
  assert.equal((await f.check(form, {})).result.draft.company, client.name);
  const submitted = (await f.check(`${form}/submit`, { method: 'POST', body: answers })).result.submission;
  assert.deepEqual((await f.check(`${form}/submit`, { method: 'POST', body: answers })).result.submission, submitted);
  const saved = await f.call(job, 'get_onboarding_submission', { client_id: client.id });
  assert.equal(saved.submission.answers.contact_name, 'Josée Example');
  assert.equal(saved.submission.answers.minimum_locations, 0);
  const feed = await f.call(job, 'list_events', { types: ['onboarding_submitted'] });
  assert.equal(feed.items.length, 1);
  const pdfLink = await f.call(job, 'get_onboarding_pdf_link', { client_id: client.id, submission_id: submitted.id });
  assert.equal((await f.request(pdfLink.url)).status, 401);
  const pdf = await f.request(pdfLink.url, { cookie: f.owner.cookie });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  const second = await f.admin(`/api/clients/${client.id}/form-link`, {});
  assert.notEqual(second.path, link.path);
  const next = (await f.check(`/api${second.path}/submit`, { method: 'POST', body: { ...answers, icp: 'Updated ICP' } })).result.submission;
  assert.equal(next.version, 2);
  const old = await f.admin(`/api/clients/${client.id}/submissions/${submitted.id}`);
  assert.equal(old.submission.answers.icp, answers.icp);
});

test('one-time seed preview and atomic repeat import across clients', async t => {
  const f = await fixture(t);
  const input = { version: 1, namespace: 'legacy-export', clients: [{ id: 'a', name: 'Client A' }, { id: 'b', name: 'Client B' }],
    partners: [{ id: 'partner-1', client_id: 'a', company: 'Partner Group', stage: 'reached_out' }],
    introductions: [{ id: 'intro-1', client_id: 'a', partner_id: 'partner-1', occurred_at: past(), notes: 'Historical introduction' }],
    outreach_activity: [{ id: 'mail-1', client_id: 'a', partner_id: 'partner-1', kind: 'reply', occurred_at: past(),
      mailbox_scope: 'team', outlook_message_id: 'historic-reply' }],
    suggested_leads: [{ id: 'lead-1', client_id: 'b', company: 'New Group', reason: 'ICP fit', source: 'Outlook', status: 'new' }],
    onboarding_submissions: [{ id: 'form-a', client_id: 'a', submitted_at: past(), answers: { icp: 'First ICP' } },
      { id: 'form-b', client_id: 'b', submitted_at: past(), answers: { icp: 'Second ICP' } }] };
  const preview = await f.admin('/api/admin/import/preview', input);
  assert.equal(preview.counts.onboarding_submissions.added, 2);
  assert.deepEqual((await f.admin('/api/clients')).items, []);
  const invalid = { ...input, partners: [{ id: 'invalid', client_id: 'missing', company: 'Bad link' }] };
  await f.admin('/api/admin/import/apply', invalid, 'POST', 400);
  assert.deepEqual((await f.admin('/api/clients')).items, []);
  assert.equal((await f.admin('/api/admin/import/apply', input)).counts.introductions.added, 1);
  assert.equal((await f.admin('/api/admin/import/apply', input)).counts.clients.skipped, 2);
  const clients = (await f.admin('/api/clients')).items;
  assert.equal(clients.length, 2);
  for (const client of clients) assert.equal((await f.admin(`/api/clients/${client.id}/submissions`)).items.length, 1);
  assert.equal((await f.admin('/api/cards')).items.length, 1);
  assert.equal((await f.admin('/api/alerts')).unread, 0);
  assert.deepEqual((await f.admin('/api/today')).replies, []);
  assert.equal((await f.admin('/api/metrics')).replies, 1);
});

test('persistent store keeps accounts across restarts and only runs migrations once', async t => {
  const schema = await isolatedSchema(t);
  const first = await openStore(databaseUrl, { schema });
  await bootstrap(first, 'Persistent Admin', adminEmail);
  await first.close();
  const reopened = await openStore(databaseUrl, { schema });
  try {
    assert.equal((await reopened.get('SELECT email FROM users')).email, adminEmail);
    assert.deepEqual((await reopened.all('SELECT version FROM schema_migrations')).map(row => row.version), [1, 2, 3, 4, 5]);
  } finally { await reopened.close(); }
});

test('environment bootstrap issues one known setup link until an admin sets a password', async t => {
  const f = await fixture(t);
  const env = { BOOTSTRAP_ADMIN_NAME: 'Env Admin', BOOTSTRAP_ADMIN_EMAIL: 'env@example.test', BOOTSTRAP_SETUP_TOKEN: 'A'.repeat(43) };
  assert.equal(await bootstrapFromEnv(f.store, env), false);
  const schema = await isolatedSchema(t);
  const store = await openStore(databaseUrl, { schema });
  t.after(() => store.close());
  assert.equal(await bootstrapFromEnv(store, env), true);
  assert.equal(await bootstrapFromEnv(store, env), false);
  assert.equal((await store.get('SELECT count(*) AS n FROM setup_tokens')).n, 1);
});

test('admins can permanently delete a client and everything recorded under it', async t => {
  const f = await fixture(t);
  const input = { version: 1, namespace: 'legacy-export', clients: [{ id: 'a', name: 'Client A' }, { id: 'b', name: 'Client B' }],
    partners: [{ id: 'partner-1', client_id: 'a', company: 'Partner Group', stage: 'reached_out' }],
    introductions: [{ id: 'intro-1', client_id: 'a', partner_id: 'partner-1', occurred_at: past(), notes: 'Historical introduction' }],
    suggested_leads: [{ id: 'lead-1', client_id: 'a', company: 'New Group', reason: 'ICP fit', source: 'Outlook', status: 'new' }],
    onboarding_submissions: [{ id: 'form-a', client_id: 'a', submitted_at: past(), answers: { icp: 'First ICP' } },
      { id: 'form-b', client_id: 'b', submitted_at: past(), answers: { icp: 'Second ICP' } }] };
  await f.admin('/api/admin/import/apply', input);
  const [a, b] = (await f.admin('/api/clients')).items;
  const card = await f.addCard(a);
  await f.admin(`/api/cards/${card.id}/drafts`, { subject: 'Hello', body: 'Draft body' });
  await f.admin(`/api/clients/${a.id}/form-link`, {});
  const job = await f.tokenFor(a);
  const { setup } = await f.admin('/api/admin/accounts', { name: 'Member', email: 'member@example.test', role: 'member' });
  const member = await f.activate(setup.path);
  await f.admin(`/api/clients/${a.id}`, { member_ids: [member.user.id] }, 'PATCH');
  await f.as(member.cookie)(`/api/clients/${a.id}`, {}, 'DELETE', 403);
  assert.deepEqual(await f.admin(`/api/clients/${a.id}`, {}, 'DELETE'), { deleted: a.id });
  await f.admin(`/api/clients/${a.id}`, undefined, 'GET', 404);
  assert.deepEqual((await f.admin('/api/clients')).items.map(row => row.id), [b.id]);
  assert.equal((await f.admin('/api/cards')).items.length, 0);
  assert.equal((await f.admin(`/api/clients/${b.id}/submissions`)).items.length, 1);
  assert.equal((await f.call(job, 'list_events', {})).items?.length ?? 0, 0);
  for (const table of ['cards', 'drafts', 'activity', 'suggestions', 'submissions', 'form_links', 'mcp_clients', 'client_members']) {
    assert.equal((await f.store.get(`SELECT count(*) AS n FROM ${table} WHERE ${table === 'drafts' ? 'true' : 'client_id=?'}`,
      ...(table === 'drafts' ? [] : [a.id]))).n, 0, table);
  }
  assert((await f.admin('/api/admin/audit')).items.some(row => row.action === 'client.deleted' && row.entity_id === a.id));
  assert.equal((await f.admin('/api/admin/import/apply', input)).counts.clients.added, 1);
});

test('tracker accounts: terms, next steps, follow-ups, contracts and import', async t => {
  const f = await fixture(t);
  const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const client = await f.addClient('Account Client');
  const updated = (await f.admin(`/api/clients/${client.id}`, { stage: 'current', deal_status: 'Active – Paying', agreement_status: 'Signed',
    monthly_fee: 10000, term_months: 6, contract_start: day(-160), contract_end: day(20), renewal_terms: '6-month term, renews automatically for 6 months.',
    contacts: [{ name: 'Matt Example', title: 'CEO', email: 'Matt@Example.test' }], next_step: 'Confirm the renewal', next_due: day(-2), next_owner: 'Daniel' }, 'PATCH')).client;
  assert.equal(updated.monthly_fee, 10000);
  assert.equal(updated.contacts[0].email, 'matt@example.test');
  await f.admin(`/api/clients/${client.id}`, { contract_end: day(-400) }, 'PATCH', 400);
  await f.admin(`/api/clients/${client.id}`, { deal_status: 'Made up' }, 'PATCH', 400);

  const { setup } = await f.admin('/api/admin/accounts', { name: 'Member', email: 'member@example.test', role: 'member' });
  const member = await f.activate(setup.path);
  await f.admin(`/api/clients/${client.id}`, { member_ids: [member.user.id] }, 'PATCH');
  const personal = f.as(member.cookie);
  await personal(`/api/clients/${client.id}`, { monthly_fee: 1 }, 'PATCH', 403);
  assert.equal((await personal(`/api/clients/${client.id}/next-step`, { next_step: 'Send the renewal deck', next_due: day(-3) })).client.next_step, 'Send the renewal deck');

  const quiet = await f.addCard(client, { stage: 'reached_out', intro_status: 'Awaiting Response', introduced_by: 'Schatzy' });
  await f.store.run('UPDATE cards SET entered_at=? WHERE id=?', new Date(Date.now() - 20 * 86400000).toISOString(), quiet.id);
  await f.addCard(client, { company: 'Fresh Intro', stage: 'reached_out' });
  const pipeline = await f.addClient('Prospect Co', { stage: 'pipeline' });
  assert.equal(pipeline.stage, 'pipeline');

  const due = await f.admin('/api/followups');
  assert.deepEqual(due.accounts.map(row => [row.name, row.bucket]), [['Account Client', 'overdue']]);
  assert.deepEqual(due.intros.map(row => [row.company, row.intro_status]), [['Sample Restaurant', 'Awaiting Response']]);
  assert.deepEqual(due.contracts.map(row => [row.name, row.flag, row.auto_renew]), [['Account Client', 'act', true]]);
  const terms = await f.admin('/api/contracts');
  assert.equal(terms.monthly_retainers, 10000);
  assert.equal(terms.items.length, 1);
  assert.deepEqual((await f.admin('/api/clients')).items.map(row => row.stage), ['current', 'pipeline']);
  assert.deepEqual((await f.admin('/api/clients?group=clients')).items.map(row => row.name), ['Account Client']);
  assert.deepEqual((await f.admin('/api/clients?group=prospects')).items.map(row => row.name), ['Prospect Co']);
  await f.admin('/api/clients?group=everyone', undefined, 'GET', 400);
  const detail = await f.admin(`/api/clients/${client.id}`);
  assert.equal(detail.intros.length, 2);

  const imported = await f.admin('/api/admin/import/apply', { version: 1, namespace: 'solutions-tracker',
    clients: [{ id: 'hang', name: 'Hang', stage: 'current', deal_status: 'Active – Paying', monthly_fee: 10000, contract_start: '2026-05-12',
      contract_end: '2026-11-11', referral_y1: 15, team: 'Schatzy, Julie', contacts: [{ name: 'Matt Smolin', email: 'matt@hang.example' }] }],
    partners: [{ id: 'hang-035', client_id: 'hang', company: 'Golden Corral', person: 'Dawn Gillis', stage: 'in_conversation',
      intro_status: 'Client Following Up', introduced_by: 'Schatzy', deal_value: 50000, created_at: '2026-08-03T12:00:00Z' }],
    introductions: [{ id: 'hang-035-intro', client_id: 'hang', partner_id: 'hang-035', occurred_at: '2026-08-03T12:00:00Z', status: 'Client Following Up', notes: 'Intro sent' }] });
  assert.equal(imported.counts.clients.added, 1);
  const hang = (await f.admin('/api/clients?q=Hang')).items[0];
  assert.equal(hang.referral_y1, 15);
  const card = (await f.admin(`/api/clients/${hang.id}`)).intros[0];
  assert.deepEqual([card.company, card.intro_status, card.deal_value, card.introduced_by], ['Golden Corral', 'Client Following Up', 50000, 'Schatzy']);
});

test('a sealed import applies once as the first admin and never twice', async t => {
  const f = await fixture(t);
  const key = randomBytes(32).toString('base64url');
  const input = { version: 1, namespace: 'sealed-check', clients: [{ id: 'a', name: 'Sealed Client', stage: 'current', monthly_fee: 5000 }],
    partners: [{ id: 'p1', client_id: 'a', company: 'Sealed Partner', stage: 'reached_out', intro_status: 'Awaiting Response' }] };
  const file = pathToFileURL(join(mkdtempSync(join(tmpdir(), 'sealed-')), 'import.sealed'));
  writeFileSync(file, seal(input, key));
  assert.equal(await applySealedImport(f.store, {}, file), null);
  await assert.rejects(applySealedImport(f.store, { TRACKER_IMPORT_KEY: randomBytes(32).toString('base64url') }, file));
  assert.equal((await applySealedImport(f.store, { TRACKER_IMPORT_KEY: key }, file)).counts.clients.added, 1);
  assert.equal(await applySealedImport(f.store, { TRACKER_IMPORT_KEY: key }, file), null);
  const clients = (await f.admin('/api/clients')).items;
  assert.deepEqual(clients.map(row => [row.name, row.monthly_fee]), [['Sealed Client', 5000]]);
  assert.equal((await f.admin('/api/cards')).items[0].intro_status, 'Awaiting Response');
});

test('client records: sections, keyed months, access rules, workspace issues and import', async t => {
  const f = await fixture(t);
  const client = await f.addClient('Records Client');
  const issue = (await f.admin(`/api/clients/${client.id}/records`, { kind: 'issues', data: { issue: 'SCA countersignature missing', priority: 'High', status: 'Open', owner: 'Daniel' } })).record;
  assert.equal(issue.data.priority, 'High');
  await f.admin(`/api/clients/${client.id}/records`, { kind: 'issues', data: { priority: 'High' } }, 'POST', 400);
  await f.admin(`/api/clients/${client.id}/records`, { kind: 'kpis', data: { month: '2026-11', posts: 3, meetings: 1 } });
  await f.admin(`/api/clients/${client.id}/records`, { kind: 'kpis', data: { month: '2026-11', posts: 1 } }, 'POST', 409);
  await f.admin(`/api/clients/${client.id}/records`, { kind: 'kpis', data: { month: '2026-13' } }, 'POST', 400);
  await f.admin(`/api/clients/${client.id}/records`, { kind: 'intel', data: { headline: 'Competitor raises', url: 'javascript:alert(1)' } }, 'POST', 400);
  await f.admin(`/api/clients/${client.id}/records`, { kind: 'billing', data: { invoice_no: '6292110', amount: 12500, status: 'Invoiced' } });
  await f.admin(`/api/records/${issue.id}`, { data: { issue: 'SCA countersignature missing', status: 'Resolved' } }, 'PATCH');
  const workspace = (await f.admin('/api/records', { kind: 'issues', data: { issue: 'Owners need to update the tracker weekly', status: 'Open' } })).record;
  await f.admin('/api/records', { kind: 'kpis', data: { month: '2026-11' } }, 'POST', 400);

  const detail = await f.admin(`/api/clients/${client.id}`);
  assert.deepEqual(Object.keys(detail.records), ['issues', 'onboarding', 'kpis', 'reports', 'billing', 'intel', 'briefs', 'wins']);
  assert.equal(detail.records.issues[0].data.status, 'Resolved');
  assert.equal(detail.records.kpis[0].data.posts, 3);
  assert.deepEqual((await f.admin('/api/issues')).items.map(row => row.id), [workspace.id]);

  const { setup } = await f.admin('/api/admin/accounts', { name: 'Member', email: 'member@example.test', role: 'member' });
  const member = await f.activate(setup.path);
  const personal = f.as(member.cookie);
  await personal(`/api/clients/${client.id}/records`, { kind: 'wins', data: { week: '2026-11-09', win: 'Featured' } }, 'POST', 404);
  await personal(`/api/records/${workspace.id}`, { data: { issue: 'x' } }, 'PATCH', 403);
  assert.deepEqual((await personal('/api/issues')).items, []);
  await f.admin(`/api/clients/${client.id}`, { member_ids: [member.user.id] }, 'PATCH');
  await personal(`/api/clients/${client.id}/records`, { kind: 'wins', data: { week: '2026-11-09', win: 'Featured in the newsletter' } });
  await personal(`/api/records/${issue.id}`, {}, 'DELETE');

  const result = await f.admin('/api/admin/import/apply', { version: 1, namespace: 'tracker-records', clients: [{ id: 'arc', name: 'ARC' }],
    client_records: [{ id: 'I-02', client_id: 'arc', kind: 'issues', data: { issue: 'Confirm term dates', priority: 'Medium', status: 'Open' } },
      { id: 'I-20', kind: 'issues', data: { issue: 'Workspace-wide data cleanup', status: 'In Progress' } },
      { id: 'arc-onb-1', client_id: 'arc', kind: 'onboarding', data: { no: 1, item: 'Company profile', status: 'Complete' } }] });
  assert.equal(result.counts.client_records.added, 3);
  assert.equal((await f.admin('/api/issues')).items.length, 3);
  const arc = (await f.admin('/api/clients?q=ARC')).items[0];
  assert.equal((await f.admin(`/api/clients/${arc.id}`)).records.onboarding[0].data.item, 'Company profile');
  await f.admin(`/api/clients/${arc.id}`, {}, 'DELETE');
  assert.equal((await f.admin('/api/issues')).items.length, 2);
});
