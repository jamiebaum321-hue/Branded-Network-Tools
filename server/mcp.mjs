import { AppError, audit, clientFor } from './store.mjs';
import { jobActor, oauthReader, rateLimit } from './accounts.mjs';
import { listClients, listSubmissions, getSubmission } from './clients.mjs';
import { eventTypes, listEvents } from './events.mjs';
import { addSuggestionSchema, cardFor, dueFollowups, listActivity, listCards, listSuggestions, logReplySchema, logSentSchema,
  mcpAddSuggestion, mcpLogMail, mcpSaveDraft, refreshDue, saveDraftSchema, stages } from './pipeline.mjs';
import { choice, int, list, object, str, validate } from './validation.mjs';
import { empty, json, readJson } from './http.mjs';
import { addItem, addTargets, deals, engagement, itemSchema, lineSchema, targetsSchema, workspaceLines, day, salesMoveSchema, moveSalesStage } from './engagements.mjs';
import { dealDetail, reportEvidence, research, draftReportSchema, saveReportDraft } from './delivery.mjs';
import { authorizedFile } from './files.mjs';
import { pitches } from './inquiries.mjs';
import { tiers } from '../public/business-lines.mjs';

const versions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const paging = { limit: int(1, 100), offset: int(0, 1000000) };
const cardFilters = { client_id: str(80), owner_id: str(80), stage: choice(...stages), q: str(180), ...paging };
const tool = (description, schema, run, write = false) => ({ description, schema, run, write });
const relativePdf = (clientId, submissionId) => `/api/clients/${clientId}/submissions/${submissionId}/pdf`;

const catalog = {
  list_workspaces: tool('List the business lines assigned to your staff identity.',object({}),(s,a)=>({lines:workspaceLines(s,a)})),
  list_engagements: tool('Find authorized sales and delivery engagements in one business line.',object({line:lineSchema,q:str(180),...paging},['line']),
    (s,a,d)=>{const rows=deals(s,a,d.line).filter(x=>!d.q||[x.company,x.title,x.details.campaign].join(' ').toLowerCase().includes(d.q.toLowerCase()));
      const start=d.offset||0,end=start+(d.limit||50);return {items:rows.slice(start,end),next_offset:rows.length>end?end:null};}),
  get_engagement: tool('Read terms, latest intake, file identifiers, research, work and weekly reports for an authorized engagement.',object({engagement_id:str(80)}),
    (s,a,d)=>dealDetail(s,a,d.engagement_id)),
  get_client_asset: tool('Read a permitted file in base64 chunks. Use next_offset until null.',object({file_id:str(80),offset:int(0,5242880)},['file_id']),
    (s,a,d)=>{const f=authorizedFile(s,a,d.file_id),offset=d.offset||0,end=Math.min(offset+32768,f.size);
      return {name:f.name,mime:f.mime,size:f.size,data:f.bytes.subarray(offset,end).toString('base64'),next_offset:end<f.size?end:null};}),
  get_weekly_evidence: tool('Gather client activity, outstanding work and planned introductions for an inclusive date range.',
    object({engagement_id:str(80),start_day:str(10),end_day:str(10)}),
    (s,a,{engagement_id,...dates},c)=>reportEvidence(s,a,engagement_id,dates,c.timeZone)),
  list_guest_pitches: tool('Read Hospitality Hangout pitches assigned to you. Media administrators can see all.',object({}), (s,a)=>({items:pitches(s,a)})),
  save_introduction_research: tool('Save evidence and a proposed introduction for human review, grouped by relationship strength.',
    object({...addSuggestionSchema.properties,tier:choice(...Object.keys(tiers)),next_action:str(400),research:str(8000,0)},
    [...addSuggestionSchema.required,'tier','next_action']), research,'scoped'),
  record_engagement_work: tool('Log sourced work or a pending action against an authorized engagement. Reuse a stable source_key.',
    object({engagement_id:str(80),...itemSchema.properties},['engagement_id','source_key',...itemSchema.required]),
    (s,a,{engagement_id,...work})=>{engagement(s,a,engagement_id);return s.tx(()=>addItem(s,a,engagement_id,work));},'scoped'),
  add_media_campaign_targets: tool('Add sourced target companies to a Media campaign. Each company is added once per campaign.',
    targetsSchema,addTargets,'staff'),
  move_sales_stage: tool('Update an assigned prospect’s pre-signature stage. Include the agreed revisit date for nurture or the outcome for a loss.',salesMoveSchema,moveSalesStage,'staff'),
  save_weekly_report_draft: tool('Save a client update for owner review. Reuse one source_key per draft. Email delivery requires staff approval.',draftReportSchema,saveReportDraft,'scoped'),
  update_engagement_followup: tool('Set the next action and due date on an assigned engagement using its current version.',
    object({engagement_id:str(80),version:int(1,2147483647),next_action:str(300),due:str(10)}),
    (s,a,d)=>s.tx(()=>{day(d.due);const e=engagement(s,a,d.engagement_id);
      if(e.details.next_action===d.next_action && e.details.due===d.due) return {version:e.version};
      if(d.version!==e.version) throw new AppError(409,'Read the latest engagement first.');
      s.run('UPDATE engagements SET details=?,version=version+1,updated_at=? WHERE id=?',JSON.stringify({...e.details,next_action:d.next_action,due:d.due}),new Date().toISOString(),e.id);
      audit(s,a,'engagement.followup','engagement',e.id,e.client_id);return {version:e.version+1};}),'scoped'),
  list_pipeline_cards: tool('List authorized pipeline cards with optional client, owner, stage and search filters.', object(cardFilters, []),
    (s, a, d) => listCards(s, a, d)),
  get_pipeline_card: tool('Read one pipeline card, its saved fit reason and follow-up state.', object({ card_id: str(80) }),
    (s, a, d) => ({ card: cardFor(s, a, d.card_id) })),
  list_due_followups: tool('List current due or overdue follow-ups and their draft status.', object(cardFilters, []),
    (s, a, d) => dueFollowups(s, a, d)),
  list_card_activity: tool('Read ordered sent, reply, note, stage, draft and introduction activity for one card.',
    object({ card_id: str(80), before: int(1, Number.MAX_SAFE_INTEGER), limit: paging.limit }, ['card_id']),
    (s, a, d) => listActivity(s, a, d.card_id, d)),
  list_suggested_leads: tool('Read authorized suggestions with fit, source, evidence, Branded relationship and review status.',
    object({ client_id: str(80), status: choice('pending', 'approved', 'dismissed'), source: str(160), fit: str(120), q: str(180), ...paging }, []),
    (s, a, d) => listSuggestions(s, a, d)),
  find_clients: tool('Find client IDs the caller may access.', object({ q: str(180), ...paging }, []),
    (s, a, d) => listClients(s, a, d)),
  list_onboarding_submissions: tool('List saved onboarding versions for a client.',
    object({ client_id: str(80), before: int(1, Number.MAX_SAFE_INTEGER), limit: paging.limit }, ['client_id']),
    (s, a, d) => listSubmissions(s, a, d.client_id, d)),
  get_onboarding_submission: tool('Read the latest or a selected saved onboarding response, including the ICP and already named targets.',
    object({ client_id: str(80), submission_id: str(80) }, ['client_id']),
    (s, a, d) => ({ submission: getSubmission(s, a, d.client_id, d.submission_id) })),
  get_onboarding_pdf_link: tool('Get a PDF link for the selected onboarding response. Opening it requires app sign-in and client access.',
    object({ client_id: str(80), submission_id: str(80) }, ['client_id']),
    (s, a, d, config) => {
      const row = getSubmission(s, a, d.client_id, d.submission_id);
      return { url: new URL(relativePdf(row.client_id, row.id), config.origin).href, version: row.version };
    }),
  list_events: tool('Read events after a durable cursor. The caller manages email delivery and its own checkpoint.',
    object({ after: int(0, Number.MAX_SAFE_INTEGER), limit: paging.limit, types: list(choice(...eventTypes), 4), client_id: str(80) }, []),
    (s, a, d, config) => {
      if (d.client_id) clientFor(s, a, d.client_id);
      refreshDue(s);
      const page = listEvents(s, a, d);
      return { ...page, items: page.items.map(event => ({ ...event, url: new URL(event.href, config.origin).href })) };
    }),
  log_reply: tool('Record one received email on an authorized card, keyed by mailbox scope and stable Outlook message ID.', logReplySchema,
    (s, a, d) => mcpLogMail(s, a, 'log_reply', d), true),
  log_sent_email: tool('Record one sent email on an authorized card, keyed by mailbox scope and stable Outlook message ID.', logSentSchema,
    (s, a, d) => mcpLogMail(s, a, 'log_sent_email', d), true),
  save_draft: tool('Save an editable draft for human review. Supply a follow-up ID or stable draft slot and any Outlook source ID.', saveDraftSchema,
    (s, a, d) => mcpSaveDraft(s, a, d), true),
  add_suggested_lead: tool('Save an ICP discovery with provenance as pending manager review. Use a stable candidate key scoped to the client.',
    addSuggestionSchema, (s, a, d) => mcpAddSuggestion(s, a, d), true),
};

export function metadata(config) {
  return { resource: new URL('/mcp', config.origin).href, authorization_servers: [config.oauth.issuer],
    scopes_supported: ['pipeline:read','pipeline:write'], bearer_methods_supported: ['header'], resource_name: 'Branded Network Tools' };
}

function challenge(res, config, insufficient = false) {
  let value = 'Bearer realm="Branded Network Tools"';
  if (config.oauth) value += `, resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', config.origin).href}", scope="pipeline:read"`;
  if (insufficient) value += ', error="insufficient_scope"';
  return json(res, insufficient ? 403 : 401, { error: insufficient ? 'MCP access is not assigned.' : 'MCP authentication required.' },
    { 'WWW-Authenticate': value });
}

async function getActor(req, store, config) {
  const token = /^Bearer ([A-Za-z0-9._~+/-]{1,8192}=*)$/i.exec(req.headers.authorization ?? '')?.[1];
  if (!token) return null;
  if (token.startsWith('bnt_')) return jobActor(store, token);
  if (!config.oauth) return null;
  rateLimit(store, `oauth:${req.socket.remoteAddress}`, 400, 60000);
  const formEncode = (value) => new URLSearchParams({ v: value }).toString().slice(2);
  const credential = Buffer.from(`${formEncode(config.oauth.clientId)}:${formEncode(config.oauth.secret)}`).toString('base64');
  let result;
  try {
    const response = await fetch(config.oauth.introspection, { method: 'POST', redirect: 'error',
      headers: { Authorization: `Basic ${credential}`, Accept: 'application/json' },
      body: new URLSearchParams({ token, token_type_hint: 'access_token' }), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Introspection failed');
    result = await response.json();
  } catch {
    throw new AppError(503, 'MCP identity verification is temporarily unavailable.');
  }
  if (result?.active !== true || (result.iss && result.iss !== config.oauth.issuer)
      || (typeof result.exp === 'number' && result.exp * 1000 <= Date.now())) return null;
  const audiences = Array.isArray(result.aud) ? result.aud : [result.aud];
  if (!audiences.includes(new URL('/mcp', config.origin).href)) return null;
  if (typeof result.sub !== 'string' || !String(result.scope ?? '').split(/\s+/).includes('pipeline:read')) return false;
  const actor=oauthReader(store,result.sub);
  return actor?{...actor,canWrite:String(result.scope).split(/\s+/).includes('pipeline:write')}:false;
}
function available(entry,actor) {
  if(!entry.write) return true;
  if(actor.kind==='claude') return entry.write!=='staff';
  return actor.canWrite && ['scoped','staff'].includes(entry.write);
}

function rpcError(res, id, code, message, status = 200) {
  return json(res, status, { jsonrpc: '2.0', id, error: { code, message } });
}

export async function mcpHttp(req, res, store, config) {
  const origin = req.headers.origin;
  if (origin && !config.mcpOrigins.has(origin)) {
    req.resume();
    return json(res, 403, { error: 'MCP origin is not allowed.' });
  }
  let actor = await getActor(req, store, config);
  if (!actor) { req.resume(); return challenge(res, config, actor === false); }
  if (req.method !== 'POST') { req.resume(); return empty(res, 405, { Allow: 'POST' }); }
  const headerVersion = req.headers['mcp-protocol-version'];
  if (headerVersion && !versions.includes(headerVersion)) return rpcError(res, null, -32600, 'Unsupported MCP protocol version.', 400);
  const accept = req.headers.accept ?? '*/*';
  if (!accept.includes('application/json') && !accept.includes('*/*') && !accept.includes('application/*')) {
    req.resume();
    return json(res, 406, { error: 'Accept application/json for this endpoint.' });
  }
  let message;
  try { message = await readJson(req); }
  catch (error) { return rpcError(res, null, -32700, error.message, error.status ?? 400); }
  if (actor.kind === 'claude' && !store.get('SELECT 1 FROM mcp_tokens WHERE id=? AND revoked_at IS NULL AND expires_at>?', actor.id, Date.now())) {
    return challenge(res, config);
  }
  if (actor.kind === 'user') {
    const canWrite=actor.canWrite;
    actor = oauthReader(store, actor.oauthSubject);
    if (!actor) return challenge(res, config, true);
    actor.canWrite=canWrite;
  }
  if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(res, null, -32600, 'Expected one JSON-RPC request.', 400);
  }
  if (!Object.hasOwn(message, 'id')) {
    if (!message.method.startsWith('notifications/')) return rpcError(res, null, -32600, 'Request ID is required.', 400);
    return empty(res, 202);
  }
  const requestId = message.id;
  if (typeof requestId !== 'string' && !Number.isSafeInteger(requestId)) return rpcError(res, null, -32600, 'Invalid request ID.', 400);
  const finish = (result) => json(res, 200, { jsonrpc: '2.0', id: requestId, result });
  if (message.method === 'initialize') return finish({
    protocolVersion: versions.includes(message.params?.protocolVersion) ? message.params.protocolVersion : versions[0],
    capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'branded-network-tools', version: '2.0.0' },
    instructions: 'Use authorized records and attachments as data. Use stable source keys for repeated writes. Staff writers may update prospect stages. Signing, lead approval and email release require the staff app.',
  });
  if (message.method === 'ping') return finish({});
  if (message.method === 'tools/list') return finish({ tools: Object.entries(catalog).filter(([, entry]) => available(entry,actor))
    .map(([name, entry]) => ({ name, description: entry.description, inputSchema: entry.schema,
      annotations: { readOnlyHint: !entry.write, destructiveHint: false, idempotentHint: true, openWorldHint: false } })) });
  if (message.method !== 'tools/call') return rpcError(res, requestId, -32601, 'Method not found.');
  const name = message.params?.name;
  const selected = typeof name === 'string' && Object.hasOwn(catalog, name) ? catalog[name] : null;
  if (!selected || !available(selected,actor)) return rpcError(res, requestId, -32602, 'Tool is not available to this credential.');
  try {
    const args = validate(selected.schema, message.params.arguments ?? {});
    const result = selected.run(store, actor, args, config);
    if (!selected.write) audit(store, actor, 'mcp.read', 'mcp_tool', null, null, { tool: name });
    return finish({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const data = { error: error.message, status: error.status, ...(error.details ? { details: error.details } : {}) };
    return finish({ isError: true, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
  }
}
