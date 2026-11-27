import { salesSummary } from '../public/sales-summary.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrap } from '../server/accounts.mjs';
import { createApp } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';
import { classifyMessage, drainMail, pollFolder } from '../server/mail.mjs';
import { accountingFileUrl } from '../server/files.mjs';
import { todayKey } from '../server/engagements.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const adminEmail = 'admin@example.test';
const password = 'Example-Test-Password-24';
const past = () => new Date(Date.now() - 86400000).toISOString();
const future = () => new Date(Date.now() + 86400000).toISOString();

async function fixture(t) {
  const store = openStore(':memory:');
  const config = { production: false, demo: false, origin: new URL('http://127.0.0.1:1'), timeZone: 'America/New_York', mediaFollowupDays: 3,
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

test('custom sales stages move occupied deals atomically and revenue separates contract value from MRR',async t=>{
  const f=await fixture(t),root='/api/workspaces/solutions';
  const col=await f.admin(root+'/stages',{name:'Partner review',after:'discovery'});
  assert.equal((await f.admin(root)).stages[2].id,col.id);
  const lead=await f.admin(root+'/engagements',{company:'Example',details:{monthly:120050,term:'Six months',project_fee:30000}});
  await f.admin('/api/engagements/'+lead.id,{version:1,stage:col.id},'PATCH');
  await f.admin(root+'/stages/'+col.id,{},'DELETE',409);
  assert.equal((await f.admin('/api/engagements/'+lead.id)).deal.stage,col.id);
  assert.equal((await f.admin(root+'/stages/'+col.id,{destination:'discovery'},'DELETE')).moved,1);
  const e=(await f.admin('/api/engagements/'+lead.id)).deal;
  assert.equal(e.stage,'discovery'); assert.equal(e.version,3);
  await f.admin('/api/engagements/'+lead.id,{stage:col.id,version:3},'PATCH',400);
  await f.admin('/api/engagements/'+lead.id,{stage:'signed',version:3,details:{agreement_url:'https://example.test/agreement'}},'PATCH');
  const lost=await f.admin(root+'/engagements',{company:'Lost',details:{monthly:50000,term:'1 year',deal_value:525000}});
  await f.admin('/api/engagements/'+lost.id,{version:1,stage:'dead',details:{outcome:'Declined'}},'PATCH');
  assert.deepEqual(salesSummary((await f.admin(root)).deals),{won:750300,lost:525000,mrr:120050,arr:1440600});
  assert.deepEqual(salesSummary([{stage:'complete',signed_at:'2026-01-01',details:{monthly:90000,term:'annual'}}]),{won:1080000,lost:0,mrr:0,arr:0});
  await f.admin(root+'/stages/signed',{},'DELETE',400);
});

test('project boards preserve independent stages, authorized participants, weekly periods and percent in CSV',async t=>{
  const f=await fixture(t),a=await f.addClient('Shared A'),b=await f.addClient('Private B');
  const stageNames=Array.from({length:10},(_,i)=>'Stage '+(i+1));
  const root='/api/project-library';
  const p=await f.admin(root,{name:'Partner rollout',cadence:'week',stages:stageNames,clients:[a.id]});
  const path=root+'/'+p.id,week='2026-11-27';
  let board=(await f.admin(path+'?date='+week)).projects[0];
  assert.deepEqual(board.rows.map(r=>r.id),[a.id]); assert.equal(board.percent,0); assert.equal(board.stages[0].period,'2026-11-23');
  for(const stage of board.stages.slice(0,9)) await f.admin('/api/clients/'+a.id+'/milestones',{step:stage.id,period:week,status:'done',notes:'=approved, "yes"',version:0},'PUT');
  board=(await f.admin(path+'?date='+week)).projects[0];
  assert.equal(board.rows[0].percent,90);assert.equal(board.percent,90);
  const token=await f.tokenFor(a);
  const catalog=await f.call(token,'get_client_project',{client_id:a.id,month:'2026-11',week});
  assert.equal(catalog.boards.find(item=>item.id===p.id).stages[0].period,'2026-11-23');
  assert.equal(catalog.boards.find(item=>item.id===p.id).stages[0].name,'Stage 1');
  assert.equal((await f.admin(path+'?date=2026-12-01')).projects[0].percent,0);
  const r=await f.request(path+'/export?date='+week,{cookie:f.owner.cookie});
  assert.match(r.headers.get('Content-Type'),/text\/csv/);
  const csv=await r.text();assert.match(csv,/"90%"/);assert.match(csv,/"'=approved, ""yes"""/);assert(!csv.includes('Private B'));
  await f.admin('/api/clients/'+b.id+'/milestones',{step:board.stages[0].id,period:week,status:'done',version:0},'PUT',404);
  await f.admin(path+'/stages',{name:'Stage 1'},'POST',409);
  const {setup}=await f.admin('/api/admin/accounts',{name:'A member',email:'only-b@example.test',role:'member'});
  const member=await f.activate(setup.path),as=f.as(member.cookie);
  assert(!(await as(root)).projects.some(row=>row.id===p.id));
  await as(path+'/export',undefined,'GET',404);
  await as(path+'/clients',{clients:[b.id]},'POST',403);
  await f.admin(path+'/clients',{clients:[b.id]});
  assert.equal((await f.admin(path+'?date='+week)).projects[0].percent,45);
});

test('client timeline combines notes and archived intakes, and detects changed files with identical names and sizes',async t=>{
  const f=await fixture(t),c=await f.addClient('Linden'),root='/api/clients/'+c.id;
  async function intake(icp,bytes) {
    const form='/api'+(await f.admin(root+'/form-link',{})).path;
    await f.check(form+'/files',{method:'POST',body:{name:'deck.bin',purpose:'asset',data:Buffer.from(bytes).toString('base64')}});
    return (await f.check(form+'/submit',{method:'POST',body:{company:'Linden',contact_name:'Lee',contact_email:'lee@example.test',icp}})).result.submission;
  }
  const one=await intake('Hotels','AA'),two=await intake('Restaurants','BB');
  await f.admin(root+'/notes',{body:'Review the new targets.',source_key:'linden-visit'});
  const feed=await f.admin(root+'/timeline');
  assert.equal(feed.items.filter(r=>r.kind==='submission').length,2);
  assert(feed.items.some(r=>r.kind==='note' && r.body==='Review the new targets.'));
  const comparison=await f.admin(root+'/submissions/'+two.id+'?compare=1');
  assert.equal(comparison.previous.id,one.id);
  assert.equal(comparison.previous.answers.icp,'Hotels');
  assert.equal(comparison.submission.answers.icp,'Restaurants');
  assert.deepEqual(comparison.file_changes,{removed:[{name:'deck.bin',purpose:'asset'}],added:[{name:'deck.bin',purpose:'asset'}]});
  assert.equal((await f.admin(root+'/submissions/'+one.id+'?compare=1')).previous,undefined);
});

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
    ['add_suggested_lead','log_reply','log_sent_email','record_engagement_work','save_client_contact','save_client_note','save_draft','save_introduction_research','save_weekly_report_draft','update_client_connection','update_engagement_followup','update_project_milestone']);
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
      scope: bearer === 'missing-scope' ? '' : bearer==='writer-token'?'pipeline:read pipeline:write':'pipeline:read', sub: 'approved-subject' }));
  });
  const discovery = await f.check('/.well-known/oauth-protected-resource/mcp', {});
  assert.equal(discovery.result.resource, resource);
  await f.rpc('wrong-audience', 'tools/list', {}, 401);
  await f.rpc('missing-scope', 'tools/list', {}, 403);
  assert((await f.rpc('reader-token', 'tools/list')).tools.every(tool => tool.annotations.readOnlyHint));
  assert.equal((await f.rpc('reader-token', 'tools/call', { name: 'log_reply' })).code, -32602);
  assert.equal((await f.call('reader-token', 'get_pipeline_card', { card_id: allowed.id })).card.id, allowed.id);
  assert.equal((await f.call('reader-token', 'get_pipeline_card', { card_id: denied.id })).status, 404);
  assert((await f.rpc('writer-token','tools/list')).tools.some(x=>x.name==='move_sales_stage'));
  assert.equal((await f.rpc('writer-token','tools/call',{name:'log_reply'})).code,-32602);
  const lead=await f.admin('/api/workspaces/solutions/engagements',{company:'Prospect',owner_id:reader.user.id});
  assert.equal((await f.call('writer-token','move_sales_stage',{engagement_id:lead.id,version:1,stage:'cold',due:'2027-01-01'})).version,2);
  assert.equal((await f.call('writer-token','move_sales_stage',{engagement_id:lead.id,version:2,stage:'signed'})).status,400);
  const moved = await f.call('writer-token', 'move_sales_stage', {
    engagement_id: lead.id, version: 2, stage: 'first_engagement', first_meeting_day: '2027-01-04',
  });
  assert.equal(moved.version, 3);
  assert.equal((await f.admin('/api/engagements/'+lead.id)).deal.details.first_meeting_day, '2027-01-04');
  assert.equal((await f.call('writer-token','get_engagement',{engagement_id:denied.client_id})).status,404);
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

test('a signature opens one project, monthly follow-ups keep independent history and stale or out-of-scope writes fail',async t=>{
  const f=await fixture(t), deal=await f.admin('/api/workspaces/solutions/engagements',{company:'Juniper'});
  assert.equal((await f.admin('/api/projects')).projects.length,0);
  const path='/api/engagements/'+deal.id;
  await f.admin(path,{version:1,stage:'signed',details:{agreement_url:'https://example.test/signed',package:'Monthly advisory'}},'PATCH');
  await f.admin(path,{version:1,stage:'signed'},'PATCH',409);
  const project=(await f.admin('/api/projects?month=2027-01')).projects[0], base='/api/clients/'+project.id;
  assert.equal(project.deliverables,'Monthly advisory');
  await f.admin(base+'/project',{goals:'Find growth partners',deliverables:'Two introductions',version:0},'PUT');
  const job=await f.tokenFor(project), outside=await f.addClient('Outside');
  const step={client_id:project.id,step:'monthly',period:'2027-01',status:'done',owner_id:f.owner.user.id,due:'2027-01-29',notes:'Reviewed outcomes',version:0};
  assert.equal((await f.call(job,'update_project_milestone',step)).version,1);
  assert.equal((await f.call(job,'update_project_milestone',step)).status,409);
  const jan=await f.call(job,'get_client_project',{client_id:project.id,month:'2027-01'});
  assert.equal(jan.project.steps.monthly.notes,step.notes); assert.equal(Object.keys(jan.milestones).length,12);
  assert.equal(jan.project.goals,'Find growth partners');
  const feb=await f.call(job,'get_client_project',{client_id:project.id,month:'2027-02'});
  assert.equal(feb.project.steps.monthly,undefined);
  assert.equal((await f.call(job,'get_client_project',{client_id:outside.id,month:'2027-01'})).status,404);
  await f.admin(base+'/milestones',{...step,period:'2027-13'},'PUT',400);
  const other=await f.admin('/api/admin/accounts',{name:'Other',email:'other@example.test',role:'member'});
  await f.admin(base+'/milestones',{...step,period:'2027-02',owner_id:other.user.id},'PUT',400);
});

test('intake, authored notes, CRM cards and edited contacts share a scoped, sourced client map',async t=>{
  const f=await fixture(t),c=await f.addClient('Branded client'),other=await f.addClient('Private client');
  const root='/api/clients/'+c.id, job=await f.tokenFor(c);
  const link=(await f.admin(root+'/form-link',{})).path;
  const body={company:c.name,contact_name:'Primary Contact',contact_email:'primary@example.test',
    priority_targets:[{company:'East Harbor'}],partnerships:[{company:'Channel Partner',contact:'Kit'}],
    team:[{first_name:'Pia',last_name:'Gray',department:'Marketing',email:'pia@example.test',phone:'212-555-0101',title:'Director',notes:'Launch owner'}]};
  const blob=Buffer.from([0,1,40,255]);
  const attached=(await f.check('/api'+link+'/files',{method:'POST',body:{name:'archive.custom',purpose:'asset',data:blob.toString('base64')}})).result;
  const submission=(await f.check('/api'+link+'/submit',{method:'POST',body})).result.submission;
  await f.addCard(c,{company:'East Harbor',person:'Jules'});
  const named={client_id:c.id,source_key:'meeting:17',body:'East Harbor can introduce us.\nTarget: New Operator | Alex\nPartner: Second Channel'};
  const note=await f.call(job,'save_client_note',named); assert.equal((await f.call(job,'save_client_note',named)).id,note.id);
  const work=await f.call(job,'get_client_workspace',{client_id:c.id});
  assert.equal(work.notes.length,1); assert.equal(work.connections.length,4);
  const east=work.connections.find(n=>n.company==='East Harbor');
  assert.equal(east.category,'priority'); assert.equal(east.person,'Jules'); assert.equal(east.health,'unrated');
  assert.deepEqual(east.sources.map(s=>s.type).sort(),['card','intake','note']);
  assert.equal(east.sources.find(s=>s.type==='intake').id,submission.id);
  assert.equal(work.connections.find(n=>n.company==='Second Channel').category,'strategic');
  const assessment={key:east.key,version:0,company:east.company,person:east.person,category:east.category,health:'yellow',stage:'planning',notes:'Check in after the conference'};
  await f.admin(root+'/connections',assessment,'PUT');
  await f.admin(root+'/connections',assessment,'PUT',409);
  const contact=work.people.find(p=>p.first_name==='Pia');
  const updated={client_id:c.id,key:contact.key,version:0,first_name:'Pia',last_name:'Gray',title:'VP',department:'Partnerships',email:'new-pia@example.test',notes:'Regional lead'};
  assert.equal((await f.call(job,'save_client_contact',updated)).version,1);
  const after=await f.admin(root+'/workspace');
  assert.equal(after.people.filter(p=>p.first_name==='Pia').length,1); assert.equal(after.people.find(p=>p.key===contact.key).email,updated.email);
  assert.equal(after.connections.find(n=>n.key===east.key).health,'yellow');
  await f.admin(root+'/milestones',{step:'intake',status:'working',version:0},'PUT',409);
  const res=await f.request('/api/files/'+attached.id+'?preview=1',{cookie:f.owner.cookie});
  assert.match(res.headers.get('content-disposition'),/^attachment/); assert.deepEqual(Buffer.from(await res.arrayBuffer()),blob);
  assert.equal((await f.call(job,'get_client_workspace',{client_id:other.id})).status,404);
  assert.equal((await f.call(job,'save_client_note',{...named,client_id:other.id})).status,404);
});

test('designated CSV and Excel attachments populate targets and client contacts on submission and retain their source files',async t=>{
  const f=await fixture(t), c=await f.addClient('File intake'), root='/api/clients/'+c.id;
  const intake='/api'+(await f.admin(root+'/form-link',{})).path;
  const targets={name:'export.csv',purpose:'priority_targets',data:Buffer.from('Account Name,Contact Name,Notes\r\n"Harbor, LLC",Jamie Park,"Met at conference"\r\n').toString('base64')};
  const first=(await f.check(intake+'/files',{method:'POST',body:targets})).result;
  assert.match(first.list_note,/1 rows? recognized/);
  const replay=(await f.check(intake+'/files',{method:'POST',body:targets})).result;
  assert.equal(replay.id,first.id); assert.equal(f.store.get('SELECT count(*) n FROM attachments').n,1);
  const bytes=execFileSync(f.config.pdfPython,['-c',[
    'import io,sys,xlsxwriter','out=io.BytesIO()','book=xlsxwriter.Workbook(out,{"in_memory":True})','ws=book.add_worksheet()',
    'ws.write_row(0,0,["First Name","Last Name","Email Address","Department","Job Title","Phone Number","Notes"])',
    'ws.write_row(1,0,["Morgan","Lee","morgan@example.test","Sales","Director","212-555-0181","Meet weekly"])',
    'book.close()','sys.stdout.buffer.write(out.getvalue())'].join('\n')]);
  const roster=(await f.check(intake+'/files',{method:'POST',body:{name:'roster.xlsx',purpose:'team',data:bytes.toString('base64')}})).result;
  assert.match(roster.list_note,/1 rows? recognized/);
  assert.equal((await f.admin(root+'/workspace')).connections.length,0);
  await f.check(intake+'/submit',{method:'POST',body:{company:c.name,contact_name:'Owner',contact_email:'owner@example.test'}});
  const data=await f.admin(root+'/workspace');
  assert.equal(data.connections[0].company,'Harbor, LLC');assert.equal(data.connections[0].person,'Jamie Park');
  assert.equal(data.connections[0].sources[0].id,first.id);assert.equal(data.connections[0].sources[0].type,'file');
  const person=data.people.find(p=>p.last_name==='Lee');
  assert.equal(person.department,'Sales');assert.equal(person.phone,'212-555-0181');assert.equal(person.source,'roster.xlsx');
});

test('staff invitations honor assigned lines, delivery readiness and replaced links, and profile changes protect active sessions',async t=>{
  const f=await fixture(t);
  const invite={name:'Morgan',email:'morgan@example.test',role:'member',workspaces:['solutions'],delivery:'email'};
  await f.admin('/api/admin/accounts',invite,'POST',409);
  f.config.mail={tenant:'mock',app:'mock',secret:'mock',sender:'staff@example.test'};
  const invited=await f.admin('/api/admin/accounts',invite);
  assert.equal(invited.delivery,'queued');
  const requests=[];
  const fake=async(url,opts)=>{requests.push(JSON.parse(opts.body));return new Response(null,{status:202});};
  await drainMail(f.store,f.config,'mock',fake); await drainMail(f.store,f.config,'mock',fake);
  assert.equal(requests.length,1); assert.equal(requests[0].message.toRecipients[0].emailAddress.address,invite.email);
  assert(requests[0].message.body.content.includes(invited.setup.path));
  const dbMessage=f.store.get("SELECT body FROM dispatches WHERE kind='team_invite'");
  assert(!dbMessage.body.includes(invited.setup.path));
  const another=await f.admin('/api/admin/accounts',{...invite,email:'replace@example.test',workspaces:[]});
  await f.admin('/api/admin/accounts/'+another.user.id+'/setup',{});
  await drainMail(f.store,f.config,'mock',fake); assert.equal(requests.length,1);
  await f.check('/api'+another.setup.path,{},410);
  const staff=await f.activate(invited.setup.path), personal=f.as(staff.cookie);
  assert.deepEqual((await personal('/api/workspaces')).lines,['solutions']);
  const second=await f.check('/api/session',{method:'POST',body:{email:invite.email,password}});
  const previous=f.as(second.res.headers.get('set-cookie').split(';')[0]);
  const d={name:'Morgan Lee',job_title:'Partnerships',phone:'212-555-0102',bio:'Regional team',onboarding_alerts:true,version:1};
  await personal('/api/profile',d,'PATCH'); await personal('/api/profile',d,'PATCH',409);
  await personal('/api/profile/password',{current:'incorrect',password:'Replacement-password-42'},'POST',400);
  await personal('/api/profile/password',{current:password,password:'Replacement-password-42'});
  assert.equal((await personal('/api/profile')).phone,d.phone); await previous('/api/profile',undefined,'GET',401);
  await f.check('/api/session',{method:'POST',body:{email:invite.email,password}},401);
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
      assert.equal(reopened.get('PRAGMA user_version').user_version, 4);
    } finally { reopened.db.close(); }
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
    rmdirSync(temp);
  }
});

test('version 2 prospect migration preserves meeting details and keeps the old stage in the history exactly once',()=>{
  const dir=mkdtempSync(join(tmpdir(),'branded-legacy-')),file=join(dir,'workspace.sqlite');
  let db;
  try {
    db=new DatabaseSync(file);
    for(const name of ['schema','workspaces']) db.exec(readFileSync(new URL('../server/'+name+'.sql',import.meta.url),'utf8'));
    db.exec(`PRAGMA user_version=2;
      INSERT INTO users(id,name,email,role,created_at) VALUES('u','Staff','staff@example.test','member','2026-01-01');
      INSERT INTO companies VALUES('co','Company','company');
      INSERT INTO engagements(id,company_id,line,owner_id,title,stage,details,created_at,updated_at) VALUES
      ('a','co','solutions','u','Pipeline','first_meeting_scheduled','{"first_meeting_day":"2026-12-10"}','2026-01-01','2026-11-10'),
      ('b','co','media','u','Media','discussion','{}','2026-01-01','2026-11-10'),
      ('c','co','solutions','u','Advisory','discussion','{}','2026-01-01','2026-11-10');`);
    db.close(); db=null;
    for(let n=0;n<2;n++) {
      const store=openStore(file); db=store.db;
      const first=store.get("SELECT * FROM engagements WHERE id='a'");
      assert.equal(first.stage,'first_engagement');assert.equal(first.owner_id,'u');assert.equal(first.signed_at,null);
      assert.equal(JSON.parse(first.details).first_meeting_day,'2026-12-10');
      assert.equal(store.get("SELECT stage FROM engagements WHERE id='b'").stage,'discussion');
      assert.equal(store.get("SELECT stage FROM engagements WHERE id='c'").stage,'first_engagement');
      assert.equal(store.get("SELECT count(*) n FROM work_items WHERE kind='note'").n,2);
      db.close();db=null;
    }
  } finally {db?.close();rmSync(file,{force:true});for(const suffix of ['-wal','-shm'])rmSync(file+suffix,{force:true});rmdirSync(dir);}
});

test('version 1 clients and recorded introductions migrate once with the same owners, identifiers and permission boundaries', () => {
  const folder=mkdtempSync(join(tmpdir(),'bnt-v1-')),path=join(folder,'v1.sqlite');
  let db;
  try {
    db=new DatabaseSync(path);
    db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
    db.exec(`PRAGMA user_version=1;
      INSERT INTO users(id,name,email,role,created_at) VALUES('owner','Owner','o@example.test','member','2024-01-01'),('peer','Peer','p@example.test','member','2024-01-02');
      INSERT INTO clients VALUES('original','Harbor Table','owner','2024-02-01'),('second','Harbor Table','owner','2024-03-01');
      INSERT INTO client_members VALUES('original','peer');
      INSERT INTO cards(id,client_id,owner_id,company,stage,entered_at,created_at,updated_at) VALUES('contact','original','peer','Local Diner','in_conversation','2024-04-01','2024-03-01','2024-04-01');
      INSERT INTO activity(id,card_id,client_id,owner_id,kind,actor,body,occurred_at,logged_at) VALUES('touch','contact','original','peer','introduction','Peer','Introduced the operator.','2024-04-01','2024-04-01');
      INSERT INTO submissions(id,client_id,version,form_version,answers,submitted_at) VALUES('submission','original',1,1,'{"company":"Harbor Table"}','2024-04-01');`);
    db.close();db=null;
    for(let i=0;i<2;i++){
      const s=openStore(path);db=s.db;
      assert.equal(s.get('SELECT count(*) n FROM companies').n,1);
      assert.equal(s.get('SELECT count(*) n FROM engagements').n,2);
      assert.deepEqual({...s.get("SELECT id,client_id,stage,owner_id,signed_at FROM engagements WHERE id='original'")},
        {id:'original',client_id:'original',stage:'active',owner_id:'owner',signed_at:null});
      assert.equal(s.get("SELECT line FROM workspace_members WHERE user_id='peer'").line,'solutions');
      assert.equal(s.get("SELECT count(*) n FROM engagement_members WHERE user_id='peer'").n,1);
      assert.equal(s.get("SELECT body FROM activity WHERE card_id='contact' AND client_id='original'").body,'Introduced the operator.');
      assert.equal(s.get("SELECT client_id FROM submissions WHERE id='submission'").client_id,'original');db.close();db=null;
    }
  } finally {if(db)db.close();for(const suffix of ['','-wal','-shm'])rmSync(path+suffix,{force:true});rmdirSync(folder);}
});

test('one company can have private sales in three lines, with scoped sharing, nurture reminders, lost reasons and optimistic concurrency',async t=>{
  const f=await fixture(t);
  const member=await f.activate((await f.admin('/api/admin/accounts',{name:'Media owner',email:'media@example.test',role:'member'})).setup.path);
  const personal=f.as(member.cookie);
  await f.admin('/api/admin/accounts/'+member.user.id+'/workspaces',{workspaces:['media']},'PUT');
  assert.deepEqual((await personal('/api/workspaces')).lines,['media']);
  const keys={};
  for(const line of ['media','capital','solutions'])keys[line]=(await f.admin('/api/workspaces/'+line+'/engagements',{company:'Harbor Foods'})).id;
  assert.equal(f.store.get('SELECT count(*) n FROM companies').n,1);
  await personal('/api/workspaces/capital',undefined,'GET',403);
  await personal('/api/engagements/'+keys.media,undefined,'GET',404);
  await f.admin('/api/engagements/'+keys.media+'/team',{users:[member.user.id]},'PUT');
  const path='/api/engagements/'+keys.media;
  await personal(path,{version:1,stage:'cold'},'PATCH',400);
  await personal(path,{version:1,stage:'cold',details:{due:'2024-01-01',next_action:'Confirm next season'}},'PATCH');
  await personal(path,{version:1,stage:'outreach'},'PATCH',409);
  assert.equal((await personal('/api/work-due')).items[0].id,keys.media);
  await personal(path,{version:2,stage:'discussion'},'PATCH');
  await personal(path,{version:3,stage:'dead'},'PATCH',400);
  await personal(path,{version:3,stage:'dead',details:{outcome:'Budget withdrawn'}},'PATCH');
  assert.equal((await personal('/api/work-due')).items.length,0);
  assert.equal((await personal(path)).work.length,3);
  await f.admin('/api/admin/accounts/'+member.user.id+'/workspaces',{workspaces:[]},'PUT');
  await personal(path,undefined,'GET',404);
});

test('spoken sales checkpoints, line-specific delivery and inquiry counts stay consistent in each workspace', async t => {
  const f = await fixture(t);
  const shared = ['discovery', 'first_engagement', 'second_engagement'];
  const workflows = {
    solutions: { sales: ['agreement_sent'], delivery: [] },
    media: { sales: ['first_meeting_scheduled','discussion','pitch', 'agreement_sent'], delivery: ['production', 'complete'] },
    capital: { sales: ['first_meeting_scheduled','discussion','mandate_sent'], delivery: ['raising', 'complete'] },
  };
  for (const [line, workflow] of Object.entries(workflows)) {
    const source = await f.admin('/api/admin/inquiry-sources', { line, label: line, owner_id: f.owner.user.id });
    await f.check('/api'+source.path, { method: 'POST', body: {
      request_id: 'request', company: 'North Harbor', name: 'Morgan', email: 'morgan@example.test', message: 'Please follow up.',
    } });
    const [deal] = (await f.admin('/api/workspaces/'+line)).deals;
    const path = '/api/engagements/'+deal.id;
    const sourceTotals = async () => (await f.admin('/api/admin/operations')).sources.find(row => row.id === source.id);
    let version = deal.version;
    assert.equal(deal.stage, 'outreach');
    assert.equal((await sourceTotals()).in_discussion, 0);
    for (const stage of [...shared, ...workflow.sales]) {
      const details = stage === 'first_engagement' ? {first_meeting_day: '2027-02-09'} : {};
      await f.admin(path, {version: version++, stage, details}, 'PATCH');
      assert.equal((await f.admin(path)).deal.stage, stage);
      assert.equal((await sourceTotals()).in_discussion, 1);
    }
    assert.equal((await f.admin(path)).dispatches.length, 0);
    await f.admin(path, {version, stage: workflow.delivery[0] || 'active'}, 'PATCH', 400);
    await f.admin(path, {version, stage: line === 'capital' ? 'agreement_sent' : 'mandate_sent'}, 'PATCH', 400);
    await f.admin(path, {version: version++, stage: 'signed', details: {agreement_url:'https://example.test/executed'}}, 'PATCH');
    if (line==='solutions') {
      for (const stage of ['discussion','first_meeting_scheduled','onboarding','active','complete']) await f.admin(path,{version,stage},'PATCH',400);
    }
    for (const stage of workflow.delivery) {
      await f.admin(path, {version: version++, stage}, 'PATCH');
      assert.equal((await f.admin(path)).deal.stage, stage);
    }
    const closed = await f.admin(path);
    assert.equal((await sourceTotals()).signed, 1);
    assert.equal((await sourceTotals()).in_discussion, 0);
    assert.equal(closed.deal.details.first_meeting_day, '2027-02-09');
    assert.equal(closed.dispatches.filter(row => row.kind === 'agreement_signed').length, 1);
    assert.equal(Boolean(closed.deal.client_id), line === 'solutions');
  }
});

test('signed agreement starts two onboarding tracks, attaches real files and issues one accounting packet and one billing supplement',async t=>{
  const f=await fixture(t);f.config.accountingEmail='ap@example.test';f.config.mail={sender:'staff@example.test'};
  const deal=await f.admin('/api/workspaces/solutions/engagements',{company:'Cedar Labs',details:{monthly:250000,term:'Six months',fee_percent:5,fee_terms:'Three years of referred sales'}});
  const path='/api/engagements/'+deal.id;
  await f.admin(path,{version:1,stage:'signed'},'PATCH',400);
  const bytes=Buffer.from('%PDF-1.7\nExecuted test agreement');
  const file=await f.admin(path+'/files',{name:'signed.pdf',purpose:'agreement',data:bytes.toString('base64')});
  await f.admin(path,{version:1,stage:'signed'},'PATCH');await f.admin(path,{version:1,stage:'signed'},'PATCH',409);
  let detail=await f.admin(path);assert(detail.deal.signed_at);assert.equal(detail.dispatches.length,1);assert.equal(detail.work.filter(x=>x.status==='planned').length,2);
  const cid=detail.deal.client_id;
  const grant=await f.tokenFor({id:cid});
  assert.equal((await f.call(grant,'find_clients',{})).items[0].engagement_id,deal.id);
  assert.deepEqual((await f.call(grant,'list_engagements',{line:'solutions'})).items.map(r=>r.id),[deal.id]);
  assert.equal((await f.call(grant,'list_engagements',{line:'capital'})).status,403);
  const onboard='/api'+(await f.admin('/api/clients/'+cid+'/form-link',{})).path;
  const blob=Buffer.from('company,segment\nHarbor,restaurants');
  const uploaded=(await f.check(onboard+'/files',{method:'POST',body:{name:'targets.csv',purpose:'asset',data:blob.toString('base64')}})).result;
  await f.admin('/api/files/'+uploaded.id,undefined,'GET',404);
  const answers={company:'Cedar Labs',contact_name:'Evie',contact_email:'evie@example.test',icp:'Restaurant operators',priorities:'Operator introductions',kpis:'Meetings booked',billing_email:'finance@example.test'};
  const first=(await f.check(onboard+'/submit',{method:'POST',body:answers})).result.submission;
  assert.equal((await f.check(onboard+'/submit',{method:'POST',body:answers})).result.submission.id,first.id);
  await f.check(onboard+'/files',{method:'POST',body:{name:'targets.csv',purpose:'asset',data:blob.toString('base64')}},409);
  detail=await f.admin(path);assert.equal(detail.dispatches.length,2);assert.equal(detail.latest.files[0].id,uploaded.id);assert.equal(detail.deal.details.billing_email,answers.billing_email);
  assert.equal((await f.request('/api/files/'+uploaded.id)).status,401);
  assert.deepEqual(Buffer.from(await (await f.request('/api/files/'+uploaded.id,{cookie:f.owner.cookie})).arrayBuffer()),blob);
  const signedLink=accountingFileUrl(f.config,file.id);assert.deepEqual(Buffer.from(await (await f.request(signedLink)).arrayBuffer()),bytes);
  assert.equal((await f.request(accountingFileUrl(f.config,file.id,Date.now()-16*86400000))).status,404);
  const packets=[];await drainMail(f.store,f.config,'test',async(url,options)=>{packets.push(JSON.parse(options.body));return new Response(null,{status:202});});
  assert.equal(packets.length,2);assert.equal(packets[0].message.attachments[0].contentBytes,bytes.toString('base64'));
  assert(packets.every(x=>x.message.toRecipients[0].emailAddress.address==='ap@example.test'));assert.match(packets.at(-1).message.body.content,/finance@example.test/);
  assert((await f.admin(path)).dispatches.every(x=>x.status==='accepted'));
});

test('client research, file reads, explicit weekly activity and a reviewed report are isolated and replay-safe',async t=>{
  const f=await fixture(t),c=await f.addClient('Evergreen'),outside=await f.addClient('Other'),job=await f.tokenFor(c);
  const path='/api/engagements/'+c.id,today=todayKey(f.config.timeZone);
  const find={client_id:c.id,company:'Harbor',person:'Casey',candidate_key:'hubspot:18',reason:'Operator footprint',source:'HubSpot',
    evidence:[{source:'CRM',detail:'Relationship owner confirmed the contact'}],fit:'Strong',branded_relationship:'Known connection',score:90,tier:'introduce',next_action:'Ask for an introduction'};
  const proposal=await f.call(job,'save_introduction_research',find);
  assert.equal((await f.call(job,'save_introduction_research',{...find,reason:'Updated match'})).id,proposal.id);
  assert.equal((await f.call(job,'save_introduction_research',{...find,client_id:outside.id})).status,404);
  await f.admin('/api/suggestions/'+proposal.id+'/decision',{decision:'approved'});
  const detail=await f.admin(path);assert.equal(detail.suggestions.length,1);assert.equal(detail.suggestions[0].tier,'introduce');assert.equal(detail.suggestions[0].reason,'Updated match');
  await f.admin('/api/cards/'+detail.suggestions[0].card_id+'/activity',{kind:'introduction',body:'Connected Casey and the operator.'});
  const row={engagement_id:c.id,kind:'newsletter',title:'Newsletter placement published',status:'done',source_key:'newsletter:10',audience:'client'};
  const first=await f.call(job,'record_engagement_work',row);
  assert.equal((await f.call(job,'record_engagement_work',row)).id,first.id);
  await f.admin(path+'/work',{kind:'note',title:'Internal budget margin',status:'done',audience:'internal'});
  await f.admin(path+'/work',{kind:'task',title:'Arrange next meeting',status:'planned',audience:'client'});
  assert.equal((await f.call(job,'record_engagement_work',{...row,engagement_id:outside.id})).status,404);
  const dates={start_day:today,end_day:today};
  const newR=await f.admin(path+'/reports',dates);
  let r=(await f.admin(path)).reports.find(x=>x.id===newR.id);
  assert.match(r.body,/Newsletter placement/);assert.match(r.body,/Connected Casey/);assert.match(r.body,/Arrange next meeting/);assert.doesNotMatch(r.body,/Internal budget/);
  await f.admin(path+'/reports/'+r.id,{version:r.version,body:r.body+'\nReviewed.'},'PATCH');
  await f.admin(path+'/reports/'+r.id,{version:r.version,body:'stale'},'PATCH',409);
  r=(await f.admin(path)).reports[0];
  const exportPath = path+'/reports/'+r.id;
  assert.equal((await f.request(exportPath+'/xlsx')).status, 401);
  const otherStaff = await f.activate((await f.admin('/api/admin/accounts', {
    name: 'Other advisor', email: 'other@example.test', role: 'member',
  })).setup.path);
  assert.equal((await f.request(exportPath+'/pdf', {cookie: otherStaff.cookie})).status, 404);
  await f.admin('/api/engagements/'+outside.id+'/reports/'+r.id+'/xlsx', undefined, 'GET', 404);
  await f.admin(exportPath+'/xlsx?version=1', undefined, 'GET', 409);
  const pdf = await f.request(exportPath+'/pdf?version='+r.version,{cookie:f.owner.cookie});
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /Evergreen-weekly-update-.+-v2\.pdf/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(), '%PDF-');
  const book = await f.request(exportPath+'/xlsx?version='+r.version,{cookie:f.owner.cookie});
  assert.equal(book.status, 200);
  assert.match(book.headers.get('content-type'), /spreadsheetml.sheet/);
  const xml = execFileSync(f.config.pdfPython, ['-c', [
    'import io,sys,zipfile',
    'z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))',
    'assert z.testzip() is None',
    'sys.stdout.buffer.write(z.read("xl/sharedStrings.xml"))',
  ].join('\n')], {input: Buffer.from(await book.arrayBuffer()), windowsHide:true, encoding:'utf8'});
  assert.match(xml, /Reviewed\./);
  assert.match(xml, /Newsletter placement/);
  assert.doesNotMatch(xml, /Internal budget/);
  await f.admin(path+'/reports/'+r.id,{version:r.version,body:r.body,send_to:'owner@example.test'},'PATCH');
  f.config.mail={sender:'team@example.test'};await drainMail(f.store,f.config,'test',async()=>{throw new Error('Unknown transport result');});
  const event=(await f.admin(path)).dispatches[0];assert.equal(event.status,'check_delivery');
  let retries=0;await drainMail(f.store,f.config,'test',async()=>{retries++;return new Response(null,{status:202});});assert.equal(retries,0);
  await f.admin('/api/admin/dispatches/'+event.id,{decision:'confirmed_sent'});
  assert.equal((await f.admin(path)).reports[0].status,'sent');
  const asset=await f.admin(path+'/files',{name:'notes.csv',purpose:'asset',data:Buffer.from('one,two').toString('base64')});
  assert.equal((await f.call(job,'get_client_asset',{file_id:asset.id})).data,Buffer.from('one,two').toString('base64'));
  assert.equal((await f.call(await f.tokenFor(outside),'get_client_asset',{file_id:asset.id})).status,404);
  const aiDraft={...dates,engagement_id:c.id,source_key:'weekly:pilot:1',body:'Reviewed sources from this week.'};
  const savedDraft=await f.call(job,'save_weekly_report_draft',aiDraft);
  assert.equal((await f.call(job,'save_weekly_report_draft',{...aiDraft,body:'A retry'})).id,savedDraft.id);
  assert.equal((await f.admin(path)).reports.find(x=>x.id===savedDraft.id).body,aiDraft.body);
  const zipUrl='/api/skills/branded-introductions';
  const history='/api/engagements/'+outside.id+'/existing-agreement';
  await f.admin(history,{version:1,signed_day:'2024-01-03',agreement_url:'https://example.test/old-sca',notify_accounting:false});
  const historical=await f.admin('/api/engagements/'+outside.id);
  assert.equal(historical.deal.stage,'active');assert.match(historical.deal.signed_at,/^2024-01-03/);assert.equal(historical.dispatches.length,0);
  assert.equal((await f.request(zipUrl)).status,401);
  const zip=Buffer.from(await(await f.request(zipUrl,{cookie:f.owner.cookie})).arrayBuffer());
  assert.equal(zip.readUInt32LE(0),0x04034b50);
  assert.match(zip.toString('utf8'),/branded-introductions\/SKILL.md/);
});

test('unanswered Media outreach gets one dated reminder until a reply, hand-set follow-up, meeting or disposition', async t => {
  const f = await fixture(t);
  const deal = await f.admin('/api/workspaces/media/engagements', {company:'Agency', details:{contact_email:'buyer@example.test'}});
  const path = '/api/engagements/' + deal.id;
  const board = async () => (await f.admin('/api/workspaces/media')).deals[0];
  const due = async () => (await f.admin('/api/work-due')).items;
  const send = {
    id:'sent-1', conversationId:'agency-pitch', subject:'Campaign pitch', sentDateTime:'2024-03-09T04:30:00Z',
    from:{emailAddress:{address:'media@example.test'}}, toRecipients:[{emailAddress:{address:'buyer@example.test'}}],
  };
  const folder = {stream:'media', box:'media@example.test', folder:'sentitems'};
  await f.admin(path+'/work', {kind:'sent', title:'Draft follow-up', status:'planned'});
  assert.equal((await board()).last_sent, null);
  for (let i=0; i<2; i++) classifyMessage(f.store, f.config, folder, send);
  const first = (await board()).reply_followup;
  assert.equal(first.due, '2024-03-11');
  assert.deepEqual(await due(), [first]);
  const outsider = await f.activate((await f.admin('/api/admin/accounts', {
    name:'Another owner', email:'peer@example.test', role:'member',
  })).setup.path);
  await f.admin('/api/admin/accounts/'+outsider.user.id+'/workspaces',{workspaces:['media']},'PUT');
  assert.deepEqual((await f.as(outsider.cookie)('/api/work-due')).items, []);
  const sent = (await f.admin(path)).work.find(row => row.title === 'Campaign pitch');
  await f.admin(path+'/work/'+sent.id, {status:'done', notes:'Corrected the internal note.'}, 'PATCH');
  assert.equal((await board()).last_sent, send.sentDateTime);
  f.config.mediaFollowupDays = 7;
  assert.equal((await board()).reply_followup.due, '2024-03-15');
  await f.admin(path, {version:1, details:{due:'2024-04-01', next_action:'Call buyer'}}, 'PATCH');
  assert.equal((await board()).reply_followup, null);
  assert.equal((await due())[0].title, 'Call buyer');
  await f.admin(path, {version:2, details:{due:''}}, 'PATCH');
  const reply = {id:'reply-1', conversationId:'agency-pitch', subject:'Please send a deck',
    from:{emailAddress:{address:'buyer@example.test'}}, receivedDateTime:'2024-03-12T15:00:00Z'};
  classifyMessage(f.store, f.config, {...folder,folder:'inbox'}, reply);
  assert.deepEqual(await due(), []);
  classifyMessage(f.store, f.config, folder, {...send,id:'sent-older',sentDateTime:'2024-03-09T14:00:00Z'});
  assert.equal((await board()).reply_followup, null);
  classifyMessage(f.store, f.config, folder, {...send,id:'sent-deck',sentDateTime:'2024-03-13T14:00:00Z'});
  assert.equal((await due())[0].due, '2024-03-20');
  await f.admin(path+'/work', {kind:'meeting', title:'Discussed the deck', status:'done', occurred_day:'2024-03-15'});
  assert.deepEqual(await due(), []);
  classifyMessage(f.store, f.config, folder, {...send,id:'sent-revised',sentDateTime:'2024-03-18T14:00:00Z'});
  const task = await f.admin(path+'/work', {kind:'task', title:'Review package', status:'planned', due:'2024-03-25'});
  assert.equal((await board()).reply_followup, null);
  assert.deepEqual((await due()).map(row=>row.title), ['Review package']);
  await f.admin(path+'/work/'+task.id, {status:'done'}, 'PATCH');
  await f.admin(path, {version:3, stage:'first_meeting_scheduled', details:{first_meeting_day:'2090-01-02'}}, 'PATCH');
  assert.deepEqual(await due(), []);
  await f.admin(path, {version:4, stage:'discussion'}, 'PATCH');
  assert.equal((await board()).reply_followup.due, '2024-03-25');
  await f.admin(path, {version:5, stage:'cold', details:{due:'2090-06-01'}}, 'PATCH');
  assert.deepEqual(await due(), []);
  await f.admin(path, {version:6, stage:'dead', details:{outcome:'Campaign cancelled', due:''}}, 'PATCH');
  assert.equal((await board()).reply_followup, null);
});

test('campaign imports, public inquiries and podcast mailbox routing keep independent, deduplicated records',async t=>{
  const f=await fixture(t),owner=f.owner.user.id;
  const source=await f.admin('/api/admin/inquiry-sources',{line:'media',label:'Sponsor inquiries',owner_id:owner});
  assert.deepEqual((await f.check('/api'+source.path,{})).result,{line:'media',label:'Sponsor inquiries'});
  const lead={request_id:'submission-01',company:'Sponsor',name:'Jordan',email:'jordan@example.test',message:'Please send rates.'};
  for(let i=0;i<2;i++)await f.check('/api'+source.path,{method:'POST',body:lead});
  const campaign={campaign:'Forbes',source:'Client target list',targets:[{company:'Sponsor',contact_email:'campaign@example.test'}]};
  assert.deepEqual(await f.admin('/api/workspaces/media/targets',campaign),{added:1,skipped:0});
  assert.deepEqual(await f.admin('/api/workspaces/media/targets',campaign),{added:0,skipped:1});
  const rows=(await f.admin('/api/workspaces/media')).deals;assert.equal(rows.length,2);
  const target=rows.find(r=>r.details.campaign),box='podcast@example.test';
  f.config.mail={sender:'staff@example.test',podcast:box};f.config.podcastOwner=adminEmail;
  const m={id:'immutable-1',internetMessageId:'mail-1',subject:'Guest pitch for Hospitality Hangout',from:{emailAddress:{address:'campaign@example.test'}},
    bodyPreview:'An operator for your podcast.',conversationId:'thread-1',receivedDateTime:new Date().toISOString(),internetMessageHeaders:[]};
  for(let i=0;i<2;i++)classifyMessage(f.store,f.config,{stream:'media',box:'media@example.test',folder:'inbox'},m);
  assert.equal((await f.admin('/api/engagements/'+target.id)).work.length,1);
  const second=await f.admin('/api/workspaces/media/engagements',{company:'Another campaign',details:{contact_email:'campaign@example.test'}});
  const ambiguous={...m,id:'immutable-2',internetMessageId:'both-campaigns'};
  classifyMessage(f.store,f.config,{stream:'media',box:'media@example.test',folder:'inbox'},ambiguous);
  const missed=(await f.admin('/api/admin/operations')).unmatched;
  assert.equal((await f.admin('/api/admin/operations')).sources[0].inquiries,1);
  assert.equal(missed.length,1);assert.equal(missed[0].choices.length,2);
  await f.admin('/api/admin/media-matches/'+missed[0].id,{engagement_id:second.id});
  classifyMessage(f.store,f.config,{stream:'media',box:'media@example.test',folder:'inbox'},ambiguous);
  assert.equal((await f.admin('/api/engagements/'+second.id)).work.length,1);
  for(let i=0;i<2;i++)classifyMessage(f.store,f.config,{stream:'podcast',box,folder:'inbox'},m);
  classifyMessage(f.store,f.config,{stream:'podcast',box,folder:'inbox'},{...m,id:'reply',conversationId:'other-thread',subject:'Re: Guest pitch'});
  classifyMessage(f.store,f.config,{stream:'podcast',box,folder:'inbox'},{...m,id:'unclear',conversationId:'other',subject:'Hello',bodyPreview:'Hello there'});
  const queue=(await f.admin('/api/podcast')).items;assert.equal(queue.length,2);assert.equal(queue.filter(p=>p.ack_status==='queued').length,1);
  const unclear=queue.find(p=>p.status==='review');await f.admin('/api/podcast/'+unclear.id,{status:'dismissed'},'PATCH');
  const paths=[];await drainMail(f.store,f.config,'test',async(path)=>{paths.push(path);return new Response(null,{status:202});});
  assert.equal(paths.length,1);assert.match(paths[0],/immutable-1\/reply$/);
  await f.admin('/api/admin/inquiry-sources/'+source.id+'/disable',{});await f.check('/api'+source.path,{},404);
});

test('mailbox activation, failed reads, page replay and expired cursors preserve the activation window',async t=>{
  const f=await fixture(t),box='podcast@example.test';
  const requests=[],delta='https://graph.microsoft.com/v1.0/users/test/delta?track=1';
  const poll=(response)=>pollFolder(f.store,f.config,'mock','podcast',box,'inbox',async u=>{requests.push(u);return response;});
  await assert.rejects(poll(new Response(null,{status:503})),/503/);
  await poll(Response.json({value:[],'@odata.deltaLink':delta}));
  assert.equal(requests[0],requests[1]);assert.match(new URL(requests[0]).searchParams.get('$filter'),/^receivedDateTime ge /);
  await poll(new Response(null,{status:410}));assert.equal(requests[2],delta);
  await poll(Response.json({value:[],'@odata.deltaLink':delta}));assert.equal(requests[3],requests[0]);
});
