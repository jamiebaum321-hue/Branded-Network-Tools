import {
  AppError,
  actorName,
  audit,
  clientFor,
  clientScope,
  decode,
  encode,
  id,
  iso,
  requireAdmin,
  requireHuman,
} from './store.mjs';
import { insertClient } from './clients.mjs';
import { choice, email, int, list, num, object, str, validate } from './validation.mjs';
import { salesColumns } from './sales-stages.mjs';
import { billingStates, kinds, labels, lines, money, stages, statuses } from '../public/business-lines.mjs';

export const lineSchema = choice(...Object.keys(lines));
const small = str(300, 0);
const amounts = ['monthly', 'project_fee', 'deal_value', 'target', 'raised'];
const detailFields = Object.fromEntries(Object.keys(labels).map((key) => [key, small]));
Object.assign(detailFields, {
  ...Object.fromEntries(amounts.map((k) => [k, int(0, 100000000000000)])),
  fee_percent: num(0, 100),
  fee_terms: str(2500, 0),
  package: str(4000, 0),
  research_sources: str(3000, 0),
  billing_terms: str(1500, 0),
  agreement_url: str(1200, 0),
  source_url: str(1200, 0),
  open_signal: choice('unknown', 'observed'),
  billing_state: choice(...Object.keys(billingStates)),
});
const detailsSchema = object(detailFields, []);
const editorFields = {
  title: str(240),
  owner_id: str(80),
  stage: str(80),
  details: detailsSchema,
  clear: list(choice(...amounts, 'fee_percent'), 6),
  version: int(1, 2147483647),
};
export const todayKey = (zone = 'America/New_York', at = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
export function day(value) {
  if (
    !/^\d{4}-\d\d-\d\d$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new AppError(400, 'Choose a valid calendar date.');
  return value;
}
export function httpLink(value) {
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(400, 'Enter a valid web link.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new AppError(400, 'Use an HTTP or HTTPS link.');
  return value;
}
export function workspaceLines(s, a) {
  if (a.role === 'admin' && a.kind === 'user') return Object.keys(lines);
  if (a.kind === 'claude')
    return a.all_clients || s.get('SELECT 1 FROM mcp_clients WHERE token_id=? LIMIT 1', a.id)
      ? ['solutions']
      : [];
  if (a.kind !== 'user') return [];
  return s.all('SELECT line FROM workspace_members WHERE user_id=? ORDER BY line', a.id).map((r) => r.line);
}
export function checkLine(s, a, line) {
  if (!Object.hasOwn(lines, line) || !workspaceLines(s, a).includes(line))
    throw new AppError(403, 'This workspace is not assigned to you.');
}
export function workspaceAccounts(s, a, line) {
  checkLine(s, a, line);
  return s.all(
    "SELECT id,name,role='admin' admin FROM users WHERE enabled=1 AND (role='admin' OR id IN(SELECT user_id FROM workspace_members WHERE line=?)) ORDER BY name",
    line
  );
}
export function setMembership(s, a, userId, input) {
  requireAdmin(a);
  const { workspaces } = validate(object({ workspaces: list(lineSchema, 3) }), input);
  if (!s.get('SELECT 1 FROM users WHERE id=?', userId)) throw new AppError(404, 'Account not found.');
  return s.tx(() => {
    s.run('DELETE FROM workspace_members WHERE user_id=?', userId);
    for (const line of new Set(workspaces)) s.run('INSERT INTO workspace_members VALUES(?,?)', userId, line);
    audit(s, a, 'workspace.access', 'user', userId, null, { workspaces });
    return { workspaces };
  });
}
export function companyId(s, name) {
  s.run('INSERT INTO companies VALUES(?,?,lower(trim(?))) ON CONFLICT(name_key) DO NOTHING', id(), name, name);
  return s.get('SELECT id FROM companies WHERE name_key=lower(trim(?))', name).id;
}
export function provisionClient(s, client, link = true) {
  const co = companyId(s, client.name);
  if (link)
    s.run(
      "INSERT INTO engagements(id,company_id,line,owner_id,title,stage,client_id,created_at,updated_at) VALUES(?,?,'solutions',?,?,'active',?,?,?)",
      client.id,
      co,
      client.owner_id,
      client.name,
      client.id,
      client.created_at,
      client.created_at
    );
}
const from = 'FROM engagements e JOIN companies c ON c.id=e.company_id JOIN users u ON u.id=e.owner_id';
const cols = 'e.*,c.name AS company,u.name AS owner';
function scope(a) {
  if (a.kind === 'user' && a.role === 'admin') return ['1=1', []];
  const [cx, args] = clientScope(a, 'e.client_id');
  if (a.kind === 'claude') return ['e.client_id IS NOT NULL AND (' + cx + ')', args];
  return [
    `EXISTS(SELECT 1 FROM workspace_members w WHERE w.line=e.line AND w.user_id=?) AND
    (e.owner_id=? OR EXISTS(SELECT 1 FROM engagement_members m WHERE m.engagement_id=e.id AND m.user_id=?) OR (e.client_id IS NOT NULL AND (${cx})))`,
    [a.id, a.id, a.id, ...args],
  ];
}
export function engagement(s, a, key) {
  const [filter, args] = scope(a);
  const row = s.get(`SELECT ${cols} ${from} WHERE e.id=? AND (${filter})`, key, ...args);
  if (!row) throw new AppError(404, 'Engagement not found.');
  return { ...row, details: decode(row.details) };
}
// Use the time a contact happened. Later edits to its notes update work_items.recorded_at.
const contactTimes = `SELECT w.id,w.engagement_id,w.kind,w.title,
  (SELECT h.at FROM work_history h WHERE h.item_id=w.id AND h.status<>'planned'
    AND (w.kind<>'meeting' OR h.status='done') ORDER BY h.seq LIMIT 1) at
  FROM work_items w WHERE w.kind IN ('sent','reply','meeting')
    AND w.status<>'planned' AND (w.kind<>'meeting' OR w.status='done')`;

function unansweredMedia(s, a, config) {
  const [filter, args] = scope(a);
  const rows = s.all(
    `WITH touches AS (${contactTimes})
      SELECT e.id,c.name company,max(CASE WHEN t.kind='sent' THEN unixepoch(t.at,'subsec') END) last_sent,
        max(CASE WHEN t.kind<>'sent' THEN unixepoch(t.at,'subsec') END) last_response
      ${from} JOIN touches t ON t.engagement_id=e.id
      WHERE e.line='media' AND e.stage IN (SELECT value FROM json_each(?))
        AND coalesce(json_extract(e.details,'$.due'),'')=''
        AND (e.stage<>'first_meeting_scheduled' OR coalesce(json_extract(e.details,'$.first_meeting_day'),'')<?)
        AND (${filter})
        AND NOT EXISTS (SELECT 1 FROM work_items p WHERE p.engagement_id=e.id AND p.status<>'done'
          AND p.due<>'' AND p.kind IN ('task','sent','reply','meeting'))
      GROUP BY e.id
      HAVING last_sent IS NOT NULL AND (last_response IS NULL OR last_response<last_sent)`,
    JSON.stringify(lines.media.live), todayKey(config.timeZone), ...args
  );
  return rows.map(({id, company, last_sent}) => {
    const localDay = todayKey(config.timeZone, new Date(last_sent * 1000));
    const due = new Date(localDay + 'T00:00:00Z');
    due.setUTCDate(due.getUTCDate() + config.mediaFollowupDays);
    return {id, line:'media', company, title:'Follow up on unanswered outreach', due:due.toISOString().slice(0, 10)};
  });
}

export function deals(s, a, line, config) {
  checkLine(s, a, line);
  const [filter, args] = scope(a);
  const reminders = line === 'media'
    ? new Map(unansweredMedia(s, a, config).map((item) => [item.id, item]))
    : new Map();
  return s
    .all(
      `WITH touches AS (${contactTimes}) SELECT ${cols},
    (SELECT at FROM touches WHERE engagement_id=e.id AND kind='sent' ORDER BY julianday(at) DESC,id LIMIT 1) last_sent,
    (SELECT at FROM touches WHERE engagement_id=e.id AND kind='reply' ORDER BY julianday(at) DESC,id LIMIT 1) last_reply,
    (SELECT title FROM touches WHERE engagement_id=e.id AND kind='reply' ORDER BY julianday(at) DESC,id LIMIT 1) last_reply_subject,
    (SELECT title FROM touches WHERE engagement_id=e.id AND kind='meeting' ORDER BY julianday(at) DESC,id LIMIT 1) last_meeting,
    (SELECT max(submitted_at) FROM submissions WHERE client_id=e.client_id) intake_received,
    (SELECT max(end_day) FROM report_versions WHERE engagement_id=e.id AND status='sent') last_report,
    (SELECT status FROM dispatches WHERE engagement_id=e.id AND kind IN ('agreement_signed','billing_completed') ORDER BY created_at DESC LIMIT 1) billing_status
    ${from} WHERE e.line=? AND (${filter}) ORDER BY e.updated_at DESC,e.id`,
      line,
      ...args
    )
    .map((row) => ({ ...row, details: decode(row.details), reply_followup: reminders.get(row.id) || null }));
}
export function dueWork(s, a, config) {
  const [filter, args] = scope(a),
    today = todayKey(config.timeZone);
  const followups = s.all(
    `SELECT e.id,e.line,c.name company,json_extract(e.details,'$.due') due,
    coalesce(nullif(json_extract(e.details,'$.next_action'),''),'Revisit opportunity') title
    ${from} WHERE (${filter}) AND e.stage NOT IN ('dead','complete') AND json_extract(e.details,'$.due') BETWEEN '0001' AND ?
    ORDER BY due,c.name`,
    ...args,
    today
  );
  const tasks = s.all(
    `SELECT e.id,e.line,c.name company,w.title,w.due ${from} JOIN work_items w ON w.engagement_id=e.id
    WHERE (${filter}) AND e.stage NOT IN ('dead','complete','cold') AND w.status<>'done'
      AND w.due BETWEEN '0001' AND ? AND (coalesce(w.owner_id,e.owner_id)=? OR ?='admin')
    ORDER BY w.due,c.name`,
    ...args,
    today,
    a.id,
    a.role
  );
  const unanswered = unansweredMedia(s, a, config).filter((row) => row.due <= today);
  return [...followups, ...tasks, ...unanswered].sort((x, y) => x.due.localeCompare(y.due));
}
export const targetsSchema = object({
  campaign: str(180),
  source: str(180),
  targets: list(
    object({ company: str(180), contact: str(150, 0), contact_email: str(254, 0), source_url: str(1200, 0) }, [
      'company',
    ]),
    100
  ),
});
export function addTargets(s, a, input) {
  checkLine(s, a, 'media');
  const { campaign, source, targets } = validate(targetsSchema, input);
  if (!targets.length) throw new AppError(400, 'Enter at least one target.');
  return s.tx(() => {
    let added = 0;
    for (const entry of targets) {
      const co = companyId(s, entry.company),
        name = campaign.toLowerCase().trim();
      if (
        s.get('SELECT 1 FROM campaign_targets WHERE line=? AND campaign=? AND company_id=?', 'media', name, co)
      )
        continue;
      const { company, ...contact } = entry;
      const deal = insertDeal(
        s,
        a,
        'media',
        { company, title: company, details: { ...contact, campaign, source } },
        a.id
      );
      s.run('INSERT INTO campaign_targets VALUES(?,?,?,?)', 'media', name, co, deal.id);
      added++;
    }
    return { added, skipped: targets.length - added };
  });
}
function validateDetails(data) {
  for (const key of ['contact_email', 'billing_email', 'report_email'])
    if (data[key]) data[key] = email(data[key]);
  for (const key of ['agreement_url', 'source_url']) if (data[key]) httpLink(data[key]);
  for (const key of ['due', 'first_meeting_day']) if (data[key]) day(data[key]);
  return data;
}
export function createDeal(s, a, line, input) {
  requireHuman(a);
  checkLine(s, a, line);
  const data = validate(
    object({ company: str(180), title: str(240), owner_id: str(80), details: detailsSchema }, ['company']),
    input
  );
  const owner = data.owner_id || a.id;
  if ((owner !== a.id && a.role !== 'admin') || !workspaceAccounts(s, a, line).some((u) => u.id === owner))
    throw new AppError(403, 'Choose an assigned owner.');
  return s.tx(() => insertDeal(s, a, line, data, owner));
}
export function insertDeal(s, a, line, data, owner) {
  const key = id(),
    at = iso();
  s.run(
    'INSERT INTO engagements(id,company_id,line,owner_id,title,stage,details,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    key,
    companyId(s, data.company),
    line,
    owner,
    data.title || data.company,
    'outreach',
    encode(validateDetails(data.details || {})),
    at,
    at
  );
  audit(s, a, 'engagement.created', 'engagement', key, null, { line });
  return { id: key };
}
export function queueMail(s, { key, deal = null, pitch = null, report = null, kind, to = '', subject, body }) {
  s.run(
    'INSERT INTO dispatches(id,dedupe_key,engagement_id,pitch_id,report_id,kind,recipient,subject,body,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING',
    id(),
    key,
    deal,
    pitch,
    report,
    kind,
    to,
    subject,
    body,
    iso()
  );
}
function accounting(s, deal, kind, config) {
  const d = deal.details;
  const body = [
    deal.company,
    deal.title,
    lines[deal.line].name,
    ...['billing_name', 'billing_email', 'billing_contacts', 'billing_terms', 'term', 'fee_terms', 'package']
      .filter((k) => d[k])
      .map((k) => labels[k] + ': ' + d[k]),
    ...amounts.filter((k) => d[k] !== undefined).map((k) => labels[k] + ': ' + money(d[k])),
    d.fee_percent !== undefined ? 'Success fee: ' + d.fee_percent + '%' : '',
    d.agreement_url ? 'Agreement: ' + d.agreement_url : '',
    !d.billing_email ? 'Accounts payable contact is outstanding.' : '',
    'Engagement: ' + new URL('/work/' + deal.line + '/' + deal.id, config.origin).href,
  ]
    .filter(Boolean)
    .join('\n');
  queueMail(s, {
    key: kind + ':' + deal.id,
    deal: deal.id,
    kind,
    to: config.accountingEmail || '',
    subject: 'Signed engagement · ' + deal.company,
    body,
  });
}
export function changeDeal(s, a, key, input, config) {
  requireHuman(a);
  return applyDealChange(s, a, key, input, config);
}
export const salesMoveSchema = object(
  {
    engagement_id: str(80),
    stage: str(80),
    version: int(1, 2147483647),
    next_action: str(300),
    due: str(10),
    first_meeting_day: str(10),
    outcome: str(300),
  },
  ['engagement_id', 'stage', 'version']
);
export function moveSalesStage(s, a, input, config) {
  const { engagement_id: key, version, stage, ...details } = validate(salesMoveSchema, input);
  const e = engagement(s, a, key);
  const open=e.line==='solutions'?salesColumns(s).filter(c=>c.id!=='signed').map(c=>c.id):lines[e.line].live;
  if (![...open,'cold','dead'].includes(stage)) throw new AppError(400,'Choose an open sales stage or disposition.');
  if (e.signed_at || lines[e.line].delivery.includes(e.stage))
    throw new AppError(409, 'This engagement is already in delivery.');
  if (e.stage === stage && Object.entries(details).every(([k, v]) => e.details[k] === v))
    return { id: key, version: e.version };
  return applyDealChange(s, a, key, { version, stage, details }, config);
}
function applyDealChange(s, a, key, input, config) {
  const data = validate(object(editorFields, ['version']), input);
  return s.tx(() => {
    const row = engagement(s, a, key),
      def = lines[row.line],
      next = data.stage || row.stage;
    if (row.version !== data.version)
      throw new AppError(409, 'This engagement changed. Refresh before saving.');
    if (row.line==='solutions' && next!==row.stage && def.delivery.includes(next) && next!=='signed')
      throw new AppError(400, 'Manage delivery milestones in Project management.');
    const columns=row.line==='solutions'?salesColumns(s):def.live.map(id=>({id,name:stages[id]}));
    const names={...stages,...Object.fromEntries(columns.map(c=>[c.id,c.name]))};
    if (![...columns.map(c=>c.id), ...def.delivery, 'cold', 'dead'].includes(next))
      throw new AppError(400, 'Choose a stage from this workspace.');
    if (
      data.owner_id &&
      data.owner_id !== row.owner_id &&
      (a.role !== 'admin' || !workspaceAccounts(s, a, row.line).some((u) => u.id === data.owner_id))
    )
      throw new AppError(403, 'An admin must assign an eligible owner.');
    const d = validateDetails({ ...row.details, ...data.details });
    for (const field of data.clear || []) delete d[field];
    if (next === 'cold' && !d.due) throw new AppError(400, 'Set a date to revisit this opportunity.');
    if (next === 'dead' && !d.outcome) throw new AppError(400, 'Record why this opportunity closed.');
    const won =
      !row.client_id && !row.signed_at && !def.delivery.includes(row.stage) && def.delivery.includes(next);
    if (won && next !== 'signed')
      throw new AppError(400, 'Record the signed agreement before starting delivery.');
    if (
      won &&
      !d.agreement_url &&
      !s.get("SELECT id FROM attachments WHERE engagement_id=? AND purpose='agreement'", key)
    )
      throw new AppError(400, 'Attach the signed agreement or enter its link.');
    if ((row.signed_at || def.delivery.includes(row.stage)) && !def.delivery.includes(next))
      throw new AppError(400, 'Use Completed to close a signed engagement.');
    let client = row.client_id;
    const owner = data.owner_id || row.owner_id;
    if (won && row.line === 'solutions') {
      client = insertClient(
        s,
        a,
        {
          name: row.company,
          owner_id: owner,
          member_ids: s
            .all('SELECT user_id FROM engagement_members WHERE engagement_id=?', key)
            .map((x) => x.user_id),
        },
        iso(),
        false
      ).id;
    }
    if (client && owner !== row.owner_id) {
      if (
        s.get(
          "SELECT 1 FROM cards WHERE client_id=? AND owner_id=? AND stage<>'closed'",
          client,
          row.owner_id
        ) &&
        s.get('SELECT role FROM users WHERE id=?', row.owner_id)?.role !== 'admin'
      ) {
        s.run('INSERT OR IGNORE INTO client_members VALUES(?,?)', client, row.owner_id);
        s.run('INSERT OR IGNORE INTO engagement_members VALUES(?,?)', key, row.owner_id);
      }
      s.run('UPDATE clients SET owner_id=? WHERE id=?', owner, client);
    }
    const at = iso();
    s.run(
      'UPDATE engagements SET title=?,owner_id=?,stage=?,client_id=?,signed_at=?,details=?,updated_at=?,version=version+1 WHERE id=?',
      data.title || row.title,
      owner,
      next,
      client,
      won ? at : row.signed_at,
      encode(d),
      at,
      key
    );
    if (next !== row.stage)
      addItem(
        s,
        a,
        key,
        {
          kind: 'note',
          title: names[row.stage] + ' → ' + names[next],
          status: 'done',
          notes: next === 'dead' ? d.outcome : next === 'cold' ? 'Revisit ' + d.due : '',
        },
        at
      );
    const updated = { ...row, details: d, title: data.title || row.title };
    if (won) {
      accounting(s, updated, 'agreement_signed', config);
      if (!d.billing_email)
        addItem(s, a, key, {
          kind: 'task',
          status: 'planned',
          title: 'Collect accounts payable contact',
          source_key: 'billing-contact',
        });
      if (row.line === 'solutions')
        addItem(s, a, key, {
          kind: 'task',
          status: 'planned',
          title: 'Send advisory onboarding form',
          source_key: 'advisory-intake',
        });
    }
    if (d.billing_email && !row.details.billing_email)
      s.run(
        "UPDATE work_items SET status='done',recorded_at=? WHERE engagement_id=? AND source_key='billing-contact'",
        at,
        key
      );
    if (row.signed_at && !row.details.billing_email && d.billing_email && hasAccountingHandoff(s, key))
      accounting(s, updated, 'billing_completed', config);
    audit(s, a, 'engagement.updated', 'engagement', key, client, { stage: next });
    return { id: key, version: row.version + 1 };
  });
}
function hasAccountingHandoff(s, key) {
  return Boolean(s.get("SELECT 1 FROM dispatches WHERE engagement_id=? AND kind='agreement_signed'", key));
}
export function recordHistoricalAgreement(s, a, key, input, config) {
  requireHuman(a);
  const d = validate(
    object({
      version: int(1, 2147483647),
      signed_day: str(10),
      agreement_url: str(1200, 0),
      notify_accounting: { type: 'boolean' },
    }),
    input
  );
  if (day(d.signed_day) > todayKey(config.timeZone))
    throw new AppError(400, 'Choose a past or current signature date.');
  return s.tx(() => {
    const e = engagement(s, a, key);
    if (e.signed_at || e.version !== d.version || !e.client_id)
      throw new AppError(409, 'Refresh the existing advisory client before recording its agreement.');
    const url = httpLink(d.agreement_url) || e.details.agreement_url || '';
    if (!url && !s.get("SELECT 1 FROM attachments WHERE engagement_id=? AND purpose='agreement'", key))
      throw new AppError(400, 'Attach the executed agreement or enter its link.');
    const details = { ...e.details, agreement_url: url };
    s.run(
      'UPDATE engagements SET signed_at=?,details=?,updated_at=?,version=version+1 WHERE id=?',
      d.signed_day + 'T17:00:00.000Z',
      encode(details),
      iso(),
      key
    );
    if (d.notify_accounting) accounting(s, { ...e, details }, 'agreement_signed', config);
    audit(s, a, 'agreement.historical', 'engagement', key, e.client_id, {
      signed_day: d.signed_day,
      notified: d.notify_accounting,
    });
    return { id: key };
  });
}
export function applyIntakeBilling(s, client, answers, config) {
  const e = s.get(
    'SELECT *, (SELECT name FROM companies WHERE companies.id=engagements.company_id) company FROM engagements WHERE client_id=?',
    client
  );
  if (!e || !config) return;
  const d = decode(e.details),
    previous = d.billing_email;
  d.billing_email ||= answers.billing_email || '';
  d.billing_name ||= answers.billing_name || '';
  d.billing_terms ||= answers.billing_instructions || '';
  s.run('UPDATE engagements SET details=?,version=version+1,updated_at=? WHERE id=?', encode(d), iso(), e.id);
  if (d.billing_email)
    s.run(
      "UPDATE work_items SET status='done',recorded_at=? WHERE engagement_id=? AND source_key='billing-contact'",
      iso(),
      e.id
    );
  s.run(
    "UPDATE work_items SET status='done',recorded_at=? WHERE engagement_id=? AND source_key='advisory-intake'",
    iso(),
    e.id
  );
  if (e.signed_at && d.billing_email && !previous && hasAccountingHandoff(s, e.id))
    accounting(s, { ...e, details: d }, 'billing_completed', config);
}
export function shareDeal(s, a, key, input) {
  requireAdmin(a);
  const { users } = validate(object({ users: list(str(80), 200) }), input);
  return s.tx(() => {
    const row = engagement(s, a, key),
      allowed = new Set(workspaceAccounts(s, a, row.line).map((x) => x.id));
    if (users.some((v) => !allowed.has(v))) throw new AppError(400, 'Choose active workspace members.');
    s.run('DELETE FROM engagement_members WHERE engagement_id=?', key);
    if (row.client_id) {
      const active = s.all(
        "SELECT DISTINCT owner_id FROM cards WHERE client_id=? AND stage<>'closed'",
        row.client_id
      );
      if (
        active.some(
          (v) =>
            v.owner_id !== row.owner_id &&
            !users.includes(v.owner_id) &&
            s.get('SELECT role FROM users WHERE id=?', v.owner_id)?.role !== 'admin'
        )
      )
        throw new AppError(409, 'Reassign open introductions first.');
      s.run('DELETE FROM client_members WHERE client_id=?', row.client_id);
    }
    for (const person of new Set(users)) {
      s.run('INSERT INTO engagement_members VALUES(?,?)', key, person);
      if (row.client_id) s.run('INSERT OR IGNORE INTO client_members VALUES(?,?)', row.client_id, person);
    }
    audit(s, a, 'engagement.shared', 'engagement', key, row.client_id);
    return { ok: true };
  });
}
export const itemSchema = object(
  {
    kind: choice(...Object.keys(kinds)),
    title: str(400),
    notes: str(5000, 0),
    status: choice(...Object.keys(statuses)),
    due: str(10, 0),
    external_ref: str(1200, 0),
    source_key: str(420),
    owner_id: str(80),
    occurred_day: str(10),
    audience: choice('internal', 'client'),
  },
  ['kind', 'title', 'status']
);
function validateWorkOwner(s, key, owner) {
  if (
    owner &&
    !s.get(
      `SELECT 1 FROM users u JOIN engagements e ON e.id=? WHERE u.id=? AND u.enabled=1 AND
    (u.role='admin' OR (EXISTS(SELECT 1 FROM workspace_members w WHERE w.user_id=u.id AND w.line=e.line) AND
    (e.owner_id=u.id OR EXISTS(SELECT 1 FROM engagement_members em WHERE em.engagement_id=e.id AND em.user_id=u.id)
    OR EXISTS(SELECT 1 FROM client_members cm WHERE cm.client_id=e.client_id AND cm.user_id=u.id))))`,
      key,
      owner
    )
  )
    throw new AppError(400, 'Choose someone with access to this engagement.');
}
export function addItem(s, a, key, input, at = iso()) {
  const data = validate(itemSchema, input);
  if (data.due) day(data.due);
  if (data.external_ref) httpLink(data.external_ref);
  if (data.occurred_day) at = day(data.occurred_day) + 'T17:00:00.000Z';
  validateWorkOwner(s, key, data.owner_id);
  const itemId = id();
  s.run(
    'INSERT INTO work_items(id,engagement_id,kind,title,notes,status,due,recorded_at,actor,source_key,external_ref,owner_id,audience) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(engagement_id,source_key) DO NOTHING',
    itemId,
    key,
    data.kind,
    data.title,
    data.notes || '',
    data.status,
    data.due || '',
    at,
    actorName(a),
    data.source_key ?? null,
    data.external_ref || '',
    data.owner_id || null,
    data.audience || 'internal'
  );
  return {
    id: data.source_key
      ? s.get('SELECT id FROM work_items WHERE engagement_id=? AND source_key=?', key, data.source_key).id
      : itemId,
  };
}
export function recordItem(s, a, key, input) {
  engagement(s, a, key);
  requireHuman(a);
  return s.tx(() => addItem(s, a, key, input));
}
export function finishItem(s, a, key, item, input) {
  engagement(s, a, key);
  requireHuman(a);
  const { status, notes, due, owner_id, previous_at } = validate(
    object(
      {
        status: choice(...Object.keys(statuses)),
        notes: str(5000, 0),
        due: str(10, 0),
        owner_id: str(80),
        previous_at: str(40),
      },
      ['status']
    ),
    input
  );
  return s.tx(() => {
    const previous = s.get('SELECT * FROM work_items WHERE engagement_id=? AND id=?', key, item);
    if (!previous) throw new AppError(404, 'Activity not found.');
    if (previous_at && previous_at !== previous.recorded_at)
      throw new AppError(409, 'Refresh before updating this action.');
    if (due) day(due);
    if (owner_id && owner_id !== previous.owner_id) validateWorkOwner(s, key, owner_id);
    const nextDue = due ?? previous.due,
      nextOwner = owner_id ?? previous.owner_id;
    if (
      previous.status !== status ||
      (notes !== undefined && notes !== previous.notes) ||
      nextDue !== previous.due ||
      nextOwner !== previous.owner_id
    ) {
      s.run(
        'UPDATE work_items SET status=?,notes=?,due=?,owner_id=?,recorded_at=? WHERE id=?',
        status,
        notes ?? previous.notes,
        nextDue,
        nextOwner,
        iso(),
        item
      );
      audit(s, a, 'activity.updated', 'work_item', item, null, { status });
    }
    return { ok: true };
  });
}
