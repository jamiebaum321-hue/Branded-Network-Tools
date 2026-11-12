import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrap } from '../server/accounts.mjs';
import { createApp } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';

const adminEmail = 'admin@example.test';
const password = 'Example-Test-Password-24';
const past = () => new Date(Date.now() - 86400000).toISOString();
const future = () => new Date(Date.now() + 86400000).toISOString();

async function fixture(t) {
  const store = openStore(':memory:');
  const config = { production: false, demo: false, origin: new URL('http://127.0.0.1:1'), timeZone: 'America/New_York',
    linkSecret: 'disposable-test-link-secret-0123456789', oauth: null, mcpOrigins: new Set(),
    pdfPython: process.env.PDF_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), pdfFont: process.env.PDF_FONT_PATH };
  const server = createApp(store, config);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.origin = new URL(`http://127.0.0.1:${server.address().port}`);
  config.mcpOrigins.add(config.origin.origin);
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
    store.db.close();
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
  const setup = bootstrap(store, 'First Admin', adminEmail);
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
    ['add_report_entry', 'add_suggested_lead', 'log_reply', 'log_sent_email', 'save_draft', 'save_matches']);
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
      scope: bearer === 'missing-scope' ? '' : bearer === 'writer-token' ? 'pipeline:read pipeline:write' : 'pipeline:read', sub: 'approved-subject' }));
  });
  const discovery = await f.check('/.well-known/oauth-protected-resource/mcp', {});
  assert.equal(discovery.result.resource, resource);
  await f.rpc('wrong-audience', 'tools/list', {}, 401);
  await f.rpc('missing-scope', 'tools/list', {}, 403);
  assert((await f.rpc('reader-token', 'tools/list')).tools.every(tool => tool.annotations.readOnlyHint));
  assert.equal((await f.rpc('reader-token', 'tools/call', { name: 'log_reply' })).code, -32602);
  assert.equal((await f.call('reader-token', 'get_pipeline_card', { card_id: allowed.id })).card.id, allowed.id);
  assert.equal((await f.call('reader-token', 'get_pipeline_card', { card_id: denied.id })).status, 404);
  // A manager who grants Claude write scope may save matches and report entries, and nothing else.
  assert.deepEqual((await f.rpc('writer-token', 'tools/list')).tools.filter(tool => !tool.annotations.readOnlyHint).map(tool => tool.name).sort(),
    ['add_report_entry', 'save_matches']);
  assert.equal((await f.rpc('writer-token', 'tools/call', { name: 'log_reply' })).code, -32602);
  const match = { company: 'Signed-in Match', reason: 'Fits the profile', source: 'HubSpot' };
  assert.equal((await f.call('writer-token', 'save_matches', { client_id: allowed.client_id, matches: [match] })).saved, 1);
  assert.equal((await f.call('writer-token', 'save_matches', { client_id: denied.client_id, matches: [match] })).status, 404);
  assert.equal((await f.rpc('reader-token', 'tools/call', { name: 'save_matches', arguments: { client_id: allowed.client_id, matches: [match] } })).code, -32602);
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
    pitch: 'Loyalty for cafés', segments: ['Coffee & bakery'], intro_method: 'Either', minimum_locations: 0, priority_targets: [{ company: 'Named target' }], assets: [{ label: 'One-pager', link: 'https://example.com/folder' }] };
  await f.check(`${form}/draft`, { method: 'POST', body: answers });
  assert.equal((await f.check(form, {})).result.draft.company, client.name);
  const submitted = (await f.check(`${form}/submit`, { method: 'POST', body: answers })).result.submission;
  assert.deepEqual((await f.check(`${form}/submit`, { method: 'POST', body: answers })).result.submission, submitted);
  const saved = await f.call(job, 'get_onboarding_submission', { client_id: client.id });
  assert.equal(saved.submission.answers.contact_name, 'Josée Example');
  assert.equal(saved.submission.answers.minimum_locations, 0);
  assert.deepEqual(saved.submission.answers.segments, ['Coffee & bakery']);
  await f.check(`/api${(await f.admin(`/api/clients/${client.id}/form-link`, {})).path}/draft`, { method: 'POST', body: { segments: ['Not a segment'] } }, 400);
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
  assert.equal((await f.check(`/api${second.path}`, {})).result.draft.contact_name, 'Josée Example');
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

test('persistent store keeps accounts across restarts and only runs migrations once', () => {
  const temp = mkdtempSync(join(tmpdir(), 'branded-network-test-'));
  const file = join(temp, 'test.sqlite');
  try {
    const first = openStore(file);
    bootstrap(first, 'Persistent Admin', adminEmail);
    first.db.close();
    const reopened = openStore(file);
    try {
      assert.equal(reopened.get('SELECT email FROM users').email, adminEmail);
      assert.equal(reopened.get('PRAGMA user_version').user_version, 2);
    } finally { reopened.db.close(); }
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
    rmdirSync(temp);
  }
});

test('a version 1 database upgrades in place and keeps its clients', () => {
  const temp = mkdtempSync(join(tmpdir(), 'branded-network-test-'));
  const file = join(temp, 'legacy.sqlite');
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
    legacy.exec(`INSERT INTO users(id,name,email,role,created_at) VALUES('u1','Owner','owner@example.test','admin','2026-01-01T00:00:00.000Z');
      INSERT INTO clients VALUES('c1','Legacy client','u1','2026-01-02T00:00:00.000Z'); PRAGMA user_version=1;`);
    legacy.close();
    const upgraded = openStore(file);
    try {
      assert.equal(upgraded.get('PRAGMA user_version').user_version, 2);
      const client = upgraded.get("SELECT stage,stage_entered_at,monthly_value FROM clients WHERE id='c1'");
      assert.deepEqual({ ...client }, { stage: 'delivering', stage_entered_at: '2026-01-02T00:00:00.000Z', monthly_value: null });
      assert.equal(upgraded.get("SELECT count(*) AS n FROM client_timeline WHERE client_id='c1' AND kind='stage'").n, 1);
    } finally { upgraded.db.close(); }
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
    rmdirSync(temp);
  }
});

test('an opportunity moves from prospect through onboarding and matching to delivery', async t => {
  const f = await fixture(t);
  const { setup } = await f.admin('/api/admin/accounts', { name: 'Manager', email: 'manager@example.test', role: 'member' });
  const manager = await f.activate(setup.path);
  const mine = f.as(manager.cookie);
  // A manager opens their own opportunity. Giving other people access stays with admins.
  await mine('/api/clients', { name: 'Not allowed', owner_id: f.owner.user.id }, 'POST', 403);
  const { client } = await mine('/api/clients', { name: 'Harbor Tech', monthly_value: 15000, contact_name: 'Kai Example',
    next_step: 'Discovery call', next_step_at: '2020-01-01', website: 'harbor.example' });
  assert.equal(client.stage, 'prospect');
  assert.equal(client.owner_id, manager.user.id);
  assert.equal(client.website, 'https://harbor.example/');
  const hidden = await f.addClient('Someone else’s account');
  await mine(`/api/clients/${hidden.id}`, undefined, 'GET', 404);
  const sales = (await mine('/api/client-board?phase=sales')).groups;
  assert.deepEqual(sales.map(group => group.stage), ['prospect', 'discovery', 'proposal', 'contract', 'won']);
  assert.deepEqual(sales[0].items.map(row => row.id), [client.id]);
  assert.equal(sales[0].value, 15000);
  assert.equal((await mine('/api/today')).accounts[0].description, 'Discovery call');
  const path = `/api/clients/${client.id}`;
  await mine(path, { stage: 'lost' }, 'PATCH', 400);
  await mine(path, { stage: 'contract', next_step: '', next_step_at: null }, 'PATCH');
  assert.equal((await mine(path, { stage: 'won' }, 'PATCH')).client.stage, 'won');
  assert.equal((await mine('/api/today')).accounts[0].description, 'Start onboarding');

  // Starting onboarding moves the client into delivery and returns the link to send.
  const started = await mine(`${path}/onboarding`, {});
  assert.equal(started.client.stage, 'onboarding');
  assert.equal((await mine(`${path}/form-link`, {})).path, started.path);
  assert.deepEqual((await mine('/api/client-board?phase=delivery')).groups[0].items.map(row => row.id), [client.id]);
  const answers = { company: 'Harbor Tech', contact_name: 'Kai Example', contact_title: 'CEO', contact_email: 'kai@example.test',
    pitch: 'Kitchen display software', icp: 'Fast casual groups with 20 or more locations', segments: ['Fast casual'], minimum_locations: 20,
    personas: [{ title: 'VP Operations', role: 'Decision maker' }], current_customers: [{ company: 'Existing Customer' }],
    competitors: [{ company: 'Rival Screens' }], exclusions: 'No stadiums' };
  await f.check(`/api${started.path}/submit`, { method: 'POST', body: answers });
  let detail = await mine(path);
  assert.equal(detail.client.stage, 'matching');
  assert.equal(detail.client.contact_email, 'kai@example.test');
  assert.equal(detail.client.contact_name, 'Kai Example');
  assert.equal(detail.profile.answers.icp, answers.icp);
  assert(detail.profile.completeness > 0 && detail.profile.completeness < 100);
  assert.match((await mine('/api/today')).accounts[0].description, /Find matches/);

  // Claude reads the brief, then saves matches to the client's profile.
  const job = await f.tokenFor(client);
  const brief = await f.call(job, 'get_matching_brief', { client_id: client.id });
  assert.equal(brief.ideal_customer.description, answers.icp);
  assert.deepEqual(brief.buyers.people_to_reach, [{ title: 'VP Operations', role: 'Decision maker' }]);
  assert.deepEqual(brief.exclude.competitors, ['Rival Screens']);
  assert.equal(brief.exclude.current_customers[0].company, 'Existing Customer');
  const matches = [{ company: 'Lakeside Bowls', person: 'Ari Example', title: 'VP Operations', email: 'ari@example.test',
    reason: '45 fast casual locations', source: 'HubSpot', score: 92, relationship: 'Met at the spring summit' },
  { company: 'Corner Grill Group', reason: 'Growing franchise group', source: 'Teams' }];
  const saved = await f.call(job, 'save_matches', { client_id: client.id, matches });
  assert.equal(saved.saved, 2);
  assert.match(saved.review_url, /tab=matches$/);
  assert.equal((await f.call(job, 'save_matches', { client_id: client.id, matches })).already_saved, 2);
  assert.equal((await f.call(job, 'save_matches', { client_id: client.id, matches: [{ ...matches[1], email: 'not-an-email' }] })).status, 400);
  assert.deepEqual(await mine(`/api/suggestion-counts?client_id=${client.id}`), { pending: 2, approved: 0, dismissed: 0 });
  const listed = (await mine(`/api/suggestions?client_id=${client.id}&status=pending`)).items;
  assert.deepEqual(listed.map(row => [row.company, row.fit, row.score]), [['Lakeside Bowls', 'Strong', 92], ['Corner Grill Group', 'Unrated', null]]);
  assert.equal((await f.call(job, 'get_matching_brief', { client_id: client.id })).exclude.already_matched.length, 2);

  // Approving the first match starts delivery. A match already in the pipeline is not saved again.
  const approved = await mine(`/api/suggestions/${listed[0].id}/decision`, { decision: 'approved' });
  assert.equal((await mine(path)).client.stage, 'delivering');
  assert.equal((await f.call(job, 'save_matches', { client_id: client.id, matches: [{ company: 'lakeside bowls', person: 'Ari Example',
    reason: 'Found again', source: 'Outlook', candidate_key: 'another-key' }] })).already_in_pipeline, 1);
  assert.equal((await f.admin(`/api/cards/${approved.suggestion.card_id}`)).card.company, 'Lakeside Bowls');

  // A manager's profile edit becomes a new version and does not raise a second submission alert.
  const edited = await mine(`${path}/profile`, { ...answers, geography: 'Southeast' });
  assert.equal(edited.submission.version, 2);
  await mine(`${path}/notes`, { body: 'Kickoff call held.' });
  detail = await mine(path);
  assert.equal(detail.profile.answers.geography, 'Southeast');
  assert.deepEqual(detail.timeline.items.map(row => row.stage ?? row.kind), ['note', 'delivering', 'matching', 'onboarding', 'won', 'contract', 'prospect']);
  assert.equal((await f.call(job, 'list_events', { types: ['onboarding_submitted'] })).items.length, 1);
  assert.equal((await f.call(job, 'get_client_profile', { client_id: client.id })).profile.version, 2);

  const prompts = (await f.rpc(job, 'prompts/list')).prompts.map(prompt => prompt.name);
  assert.deepEqual(prompts, ['find_matches', 'build_monthly_report']);
  const prompt = await f.rpc(job, 'prompts/get', { name: 'find_matches', arguments: { client: 'harbor tech' } });
  assert.match(prompt.messages[0].content.text, new RegExp(client.id));
  assert.equal((await f.rpc(job, 'prompts/get', { name: 'find_matches', arguments: { client: 'No such client' } })).code, -32602);
  assert.equal((await mine(path, { stage: 'churned', closed_reason: 'Contract ended' }, 'PATCH')).client.stage, 'churned');
});

test('monthly report combines logged work with pipeline activity and exports a PDF', async t => {
  const f = await fixture(t);
  const client = await f.addClient('Report Client', { stage: 'delivering' });
  const other = await f.addClient('Other Client', { stage: 'delivering' });
  const job = await f.tokenFor(client);
  const period = new Intl.DateTimeFormat('en-CA', { timeZone: f.config.timeZone, year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const on = `${period}-01`;
  const entries = `/api/clients/${client.id}/report-entries`;
  await f.admin(entries, { kind: 'social', occurred_on: '2026-02-30', title: 'Bad date' }, 'POST', 400);
  const { entry: post } = await f.admin(entries, { kind: 'social', occurred_on: on, title: 'Launch post', channel: 'LinkedIn', url: 'linkedin.example/p/1',
    metrics: { impressions: 1000, likes: 40, comments: 5, shares: 3, listeners: 999 } });
  assert.deepEqual(post.metrics, { impressions: 1000, likes: 40, comments: 5, shares: 3 });
  assert.equal(post.url, 'https://linkedin.example/p/1');
  await f.admin(entries, { kind: 'podcast', occurred_on: on, title: 'Episode 12', metrics: { listeners: 2500 } });
  await f.admin(entries, { kind: 'introduction', occurred_on: on, title: 'Email introduction', contact: 'Sam Example, Bistro Group' });
  const { entry: stray } = await f.admin(entries, { kind: 'other', occurred_on: on, title: 'Remove me' });
  await f.admin(`/api/report-entries/${stray.id}/delete`, {});
  await f.admin(`/api/report-entries/${post.id}`, { metrics: { impressions: 1200, likes: 40, comments: 5, shares: 3 } }, 'PATCH');

  // Pipeline activity for the client is included without being re-entered.
  const card = await f.addCard(client, { stage: 'reached_out' });
  await f.call(job, 'log_sent_email', { card_id: card.id, mailbox_scope: 'team', outlook_message_id: 'report-1', sent_at: new Date().toISOString(), subject: 'Intro' });
  await f.admin(`/api/cards/${card.id}/activity`, { kind: 'introduction', body: 'Introduced by email.' });
  await f.admin(`/api/cards/${card.id}`, { version: card.version, stage: 'in_conversation' }, 'PATCH');

  // Claude can log report work. The same source key updates in place until a manager edits the entry.
  const fromClaude = { client_id: client.id, source_key: 'https://example.com/post/9', kind: 'social', occurred_on: on, title: 'Second post', metrics: { impressions: 300 } };
  const first = await f.call(job, 'add_report_entry', fromClaude);
  assert.equal(first.result, 'saved');
  assert.deepEqual(await f.call(job, 'add_report_entry', { ...fromClaude, metrics: { impressions: 500 } }), { entry_id: first.entry_id, result: 'updated' });
  await f.admin(`/api/report-entries/${first.entry_id}`, { title: 'Second post, edited' }, 'PATCH');
  assert.equal((await f.call(job, 'add_report_entry', { ...fromClaude, metrics: { impressions: 9 } })).result, 'kept_manager_edit');
  assert.equal((await f.call(job, 'add_report_entry', { ...fromClaude, client_id: other.id })).status, 404);

  const path = `/api/clients/${client.id}/reports/${period}`;
  await f.admin(path, { headline: 'A strong month', summary: 'Two introductions made.' });
  const report = await f.admin(path);
  assert.equal(report.summary.headline, 'A strong month');
  assert.equal(report.entries.length, 4);
  assert.deepEqual({ introductions: report.totals.introductions, conversations: report.totals.conversations, emails: report.totals.emails,
    reach: report.totals.reach, engagements: report.totals.engagements, posts: report.totals.posts },
  { introductions: 2, conversations: 1, emails: 1, reach: 1200 + 500 + 2500, engagements: 48, posts: 2 });
  assert.equal(report.pipeline.emails[0].subject, 'Intro');
  assert.equal((await f.call(job, 'get_monthly_report', { client_id: client.id })).totals.reach, report.totals.reach);
  assert.deepEqual((await f.admin(`/api/reports?period=${period}`)).items.map(row => [row.name, row.entries, row.introductions, row.emails]),
    [['Other Client', 0, 0, 0], ['Report Client', 4, 2, 1]]);
  assert.equal((await f.admin(`/api/clients/${client.id}/reports/${report.previous}`)).entries.length, 0);

  assert.equal((await f.request(`${path}/pdf`)).status, 401);
  const pdf = await f.request(`${path}/pdf`, { cookie: f.owner.cookie });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-disposition'), new RegExp(`Report-Client-report-${period}\\.pdf`));
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  const { setup } = await f.admin('/api/admin/accounts', { name: 'Outsider', email: 'outsider@example.test', role: 'member' });
  const outsider = f.as((await f.activate(setup.path)).cookie);
  await outsider(path, undefined, 'GET', 404);
  await outsider(`/api/report-entries/${post.id}`, { title: 'Nope' }, 'PATCH', 404);
});
