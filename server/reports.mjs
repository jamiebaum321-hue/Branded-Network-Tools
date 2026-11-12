import { isPeriod, metricKeys, periodLabel, phaseStages, reportKind, reportKindIds, shiftPeriod } from '../public/lifecycle.mjs';
import { AppError, actorName, audit, clientFor, clientScope, decode, encode, id, iso, requireAssistant, requireHuman } from './store.mjs';
import { localDate, midnight } from './dashboard.mjs';
import { stages } from './pipeline.mjs';
import { choice, day, int, object, str, validate, webLink } from './validation.mjs';

const metricsSchema = object(Object.fromEntries(metricKeys.map(key => [key, int(0, 100000000000)])), []);
const entryFields = { kind: choice(...reportKindIds), occurred_on: str(10), title: str(300), detail: str(4000, 0), channel: str(160, 0),
  contact: str(300, 0), url: str(600, 0), metrics: metricsSchema };
const entryCreate = object(entryFields, ['kind', 'occurred_on', 'title']);
const entryUpdate = object(entryFields, []);
export const assistantEntrySchema = object({ client_id: str(80), source_key: str(300), ...entryFields },
  ['client_id', 'source_key', 'kind', 'occurred_on', 'title']);
const summaryFields = object({ headline: str(200, 0), summary: str(6000, 0), next_steps: str(4000, 0) }, []);

export const currentPeriod = (zone, now = new Date()) => localDate(now, zone).slice(0, 7);
const present = row => ({ ...row, metrics: decode(row.metrics) });

function clean(data) {
  const result = { ...data };
  if (result.occurred_on !== undefined) result.occurred_on = day(result.occurred_on);
  if (result.url !== undefined) result.url = webLink(result.url);
  if (result.metrics) {
    // Keep only the numbers that belong to this kind of entry.
    const allowed = reportKind[result.kind]?.metrics ?? metricKeys;
    result.metrics = Object.fromEntries(Object.entries(result.metrics).filter(([key]) => allowed.includes(key)));
  }
  return result;
}

function insertEntry(store, actor, clientId, data, source, sourceKey = null) {
  const entryId = id();
  const at = iso();
  store.run(`INSERT INTO report_entries(id,client_id,kind,occurred_on,title,detail,channel,contact,url,metrics,source,source_key,actor,actor_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, entryId, clientId, data.kind, data.occurred_on, data.title, data.detail ?? '', data.channel ?? '',
  data.contact ?? '', data.url ?? '', encode(data.metrics ?? {}), source, sourceKey, actorName(actor), actor.id ?? null, at, at);
  audit(store, actor, 'report.entry_added', 'report_entry', entryId, clientId, { kind: data.kind, source });
  return present(store.get('SELECT * FROM report_entries WHERE id=?', entryId));
}

export function addEntry(store, actor, clientId, input) {
  requireHuman(actor);
  const data = clean(validate(entryCreate, input));
  return store.tx(() => {
    clientFor(store, actor, clientId);
    return insertEntry(store, actor, clientId, data, 'staff');
  });
}

function entryFor(store, actor, entryId) {
  const [scope, args] = clientScope(actor, 'e.client_id');
  const row = store.get(`SELECT e.* FROM report_entries e WHERE e.id=? AND (${scope})`, entryId, ...args);
  if (!row) throw new AppError(404, 'Report entry not found.');
  return row;
}

function writeEntry(store, previous, data, source) {
  const next = clean({ ...present(previous), ...data });
  store.run(`UPDATE report_entries SET kind=?,occurred_on=?,title=?,detail=?,channel=?,contact=?,url=?,metrics=?,source=?,updated_at=? WHERE id=?`,
    next.kind, next.occurred_on, next.title, next.detail, next.channel, next.contact, next.url, encode(next.metrics), source, iso(), previous.id);
  return present(store.get('SELECT * FROM report_entries WHERE id=?', previous.id));
}

export function updateEntry(store, actor, entryId, input) {
  requireHuman(actor);
  const data = validate(entryUpdate, input);
  return store.tx(() => {
    const previous = entryFor(store, actor, entryId);
    // A manager's edit takes ownership, so a later Claude run does not overwrite it.
    const entry = writeEntry(store, previous, data, 'staff');
    audit(store, actor, 'report.entry_updated', 'report_entry', entryId, previous.client_id);
    return entry;
  });
}

export function deleteEntry(store, actor, entryId) {
  requireHuman(actor);
  return store.tx(() => {
    const previous = entryFor(store, actor, entryId);
    store.run('DELETE FROM report_entries WHERE id=?', entryId);
    audit(store, actor, 'report.entry_deleted', 'report_entry', entryId, previous.client_id, { kind: previous.kind, title: previous.title });
    return { ok: true };
  });
}

// Saving the same source_key again refreshes the numbers instead of adding a duplicate.
export function assistantEntry(store, actor, input) {
  requireAssistant(actor);
  const { client_id: clientId, source_key: sourceKey, ...fields } = validate(assistantEntrySchema, input);
  const data = clean(fields);
  return store.tx(() => {
    clientFor(store, actor, clientId);
    const previous = store.get('SELECT * FROM report_entries WHERE client_id=? AND source_key=?', clientId, sourceKey);
    if (!previous) return { entry_id: insertEntry(store, actor, clientId, data, 'claude', sourceKey).id, result: 'saved' };
    if (previous.source === 'staff') return { entry_id: previous.id, result: 'kept_manager_edit' };
    writeEntry(store, previous, data, 'claude');
    audit(store, actor, 'report.entry_updated', 'report_entry', previous.id, clientId);
    return { entry_id: previous.id, result: 'updated' };
  });
}

export function saveSummary(store, actor, clientId, period, input) {
  requireHuman(actor);
  if (!isPeriod(period)) throw new AppError(400, 'Use a month such as 2026-11.');
  const data = validate(summaryFields, input);
  return store.tx(() => {
    clientFor(store, actor, clientId);
    const previous = store.get('SELECT * FROM reports WHERE client_id=? AND period=?', clientId, period) ?? { headline: '', summary: '', next_steps: '' };
    const next = { ...previous, ...data };
    store.run(`INSERT INTO reports(client_id,period,headline,summary,next_steps,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(client_id,period) DO UPDATE SET headline=excluded.headline,summary=excluded.summary,next_steps=excluded.next_steps,
        updated_by=excluded.updated_by,updated_at=excluded.updated_at`, clientId, period, next.headline, next.summary, next.next_steps, actor.name, iso());
    audit(store, actor, 'report.summary_saved', 'report', null, clientId, { period });
    return { ok: true };
  });
}

function bounds(period, zone) {
  if (!isPeriod(period)) throw new AppError(400, 'Use a month such as 2026-11.');
  const from = `${period}-01`;
  const to = `${shiftPeriod(period, 1)}-01`;
  return { from, to, start: new Date(midnight(from, zone)).toISOString(), end: new Date(midnight(to, zone)).toISOString() };
}

function totalsFor(entries, pipeline, matches) {
  const sum = key => entries.reduce((total, entry) => total + (entry.metrics[key] ?? 0), 0);
  const count = kind => entries.filter(entry => entry.kind === kind).length;
  const sent = pipeline.emails.filter(row => row.direction === 'Sent').length;
  return {
    introductions: count('introduction') + pipeline.introductions.length, conversations: pipeline.conversations.length,
    meetings: count('meeting') + pipeline.outcomes.length, emails_sent: sent, replies: pipeline.emails.length - sent,
    emails: pipeline.emails.length + count('email'), posts: count('social'),
    impressions: sum('impressions'), engagements: sum('likes') + sum('comments') + sum('shares'), clicks: sum('clicks'),
    listeners: sum('listeners'), reach: sum('impressions') + sum('listeners') + sum('recipients') + sum('attendees'),
    matches_found: matches,
  };
}

// The month's report: what staff and Claude logged, plus what the pipeline already knows.
export function monthlyReport(store, actor, clientId, period, zone) {
  const client = clientFor(store, actor, clientId);
  const range = bounds(period, zone);
  const entries = store.all(`SELECT * FROM report_entries WHERE client_id=? AND occurred_on>=? AND occurred_on<?
    ORDER BY occurred_on,created_at`, clientId, range.from, range.to).map(present);
  const activity = store.all(`SELECT a.id,a.kind,a.subject,a.body,a.detail,a.occurred_at,p.id AS card_id,p.company,p.person,p.title
    FROM activity a JOIN cards p ON p.id=a.card_id WHERE a.client_id=? AND a.kind IN ('sent','reply','introduction','stage')
      AND a.occurred_at>=? AND a.occurred_at<? ORDER BY a.occurred_at,a.seq`, clientId, range.start, range.end);
  const pipeline = { emails: [], introductions: [], conversations: [], outcomes: [] };
  for (const row of activity) {
    const detail = decode(row.detail);
    const base = { id: row.id, card_id: row.card_id, date: localDate(new Date(row.occurred_at), zone), company: row.company, person: row.person, title: row.title };
    if (row.kind === 'sent' || row.kind === 'reply') pipeline.emails.push({ ...base, direction: row.kind === 'sent' ? 'Sent' : 'Reply', subject: row.subject });
    else if (row.kind === 'introduction') pipeline.introductions.push({ ...base, note: row.body, status: detail.status ?? '' });
    else if (detail.to === 'in_conversation') pipeline.conversations.push(base);
    else if (detail.to === 'closed' && detail.outcome) pipeline.outcomes.push({ ...base, outcome: detail.outcome });
  }
  const matches = store.get('SELECT count(*) AS n FROM suggestions WHERE client_id=? AND created_at>=? AND created_at<?', clientId, range.start, range.end).n;
  const stageCounts = store.all('SELECT stage,count(*) AS n FROM cards WHERE client_id=? GROUP BY stage', clientId);
  const saved = store.get('SELECT headline,summary,next_steps,updated_by,updated_at FROM reports WHERE client_id=? AND period=?', clientId, period);
  return {
    client: { id: client.id, name: client.name, stage: client.stage, owner_name: client.owner_name }, period, label: periodLabel(period),
    previous: shiftPeriod(period, -1), next: shiftPeriod(period, 1), current: currentPeriod(zone),
    summary: saved ?? { headline: '', summary: '', next_steps: '', updated_by: null, updated_at: null },
    totals: totalsFor(entries, pipeline, matches), entries, pipeline,
    stages: stages.map(stage => ({ stage, count: stageCounts.find(row => row.stage === stage)?.n ?? 0 })),
  };
}

// One row per active client for the chosen month.
export function reportsOverview(store, actor, period, zone) {
  const range = bounds(period, zone);
  const [scope, args] = clientScope(actor, 'c.id');
  const selected = phaseStages('delivery');
  const rows = store.all(`SELECT c.id,c.name,c.stage,u.name AS owner_name,
    (SELECT count(*) FROM report_entries e WHERE e.client_id=c.id AND e.occurred_on>=? AND e.occurred_on<?) AS entries,
    (SELECT count(*) FROM report_entries e WHERE e.client_id=c.id AND e.kind='introduction' AND e.occurred_on>=? AND e.occurred_on<?)
      + (SELECT count(*) FROM activity a WHERE a.client_id=c.id AND a.kind='introduction' AND a.occurred_at>=? AND a.occurred_at<?) AS introductions,
    (SELECT count(*) FROM activity a WHERE a.client_id=c.id AND a.kind IN ('sent','reply') AND a.occurred_at>=? AND a.occurred_at<?) AS emails,
    (SELECT coalesce(sum(coalesce(json_extract(e.metrics,'$.impressions'),0)+coalesce(json_extract(e.metrics,'$.listeners'),0)
      +coalesce(json_extract(e.metrics,'$.recipients'),0)+coalesce(json_extract(e.metrics,'$.attendees'),0)),0)
      FROM report_entries e WHERE e.client_id=c.id AND e.occurred_on>=? AND e.occurred_on<?) AS reach,
    (SELECT r.updated_at FROM reports r WHERE r.client_id=c.id AND r.period=? AND (r.headline<>'' OR r.summary<>'')) AS summary_at
    FROM clients c JOIN users u ON u.id=c.owner_id WHERE (${scope}) AND c.stage IN (${selected.map(() => '?').join(',')})
    ORDER BY c.name COLLATE NOCASE,c.id LIMIT 300`, range.from, range.to, range.from, range.to, range.start, range.end,
  range.start, range.end, range.from, range.to, period, ...args, ...selected);
  return { period, label: periodLabel(period), previous: shiftPeriod(period, -1), next: shiftPeriod(period, 1), current: currentPeriod(zone), items: rows };
}

const number = value => new Intl.NumberFormat('en-US').format(value);
const shortDate = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
const who = row => [row.person, row.company].filter(Boolean).join(', ');

// Shapes a compiled report for the PDF renderer: headline numbers, then one table per kind of work.
export function reportDocument(report) {
  const { totals: t, entries, pipeline } = report;
  const of = kind => entries.filter(entry => entry.kind === kind);
  const cell = entry => entry.url ? { text: entry.title, link: entry.url } : entry.title;
  const sections = [];
  const add = (title, columns, rows, note = '') => { if (rows.length) sections.push({ title, columns, rows, note }); };
  add('Introductions made', [['Date', 12], ['Introduced to', 34], ['Notes', 54]], [
    ...pipeline.introductions.map(row => ({ date: row.date, cells: [shortDate(row.date), who(row) + (row.title ? ` (${row.title})` : ''), row.note || row.status]})),
    ...of('introduction').map(entry => ({ date: entry.occurred_on, cells: [shortDate(entry.occurred_on), entry.contact || cell(entry), entry.contact ? [entry.title, entry.detail].filter(Boolean).join('. ') : entry.detail] })),
  ].sort((a, b) => a.date.localeCompare(b.date)).map(row => row.cells));
  add('Conversations started', [['Date', 12], ['Company', 44], ['Contact', 44]],
    pipeline.conversations.map(row => [shortDate(row.date), row.company, [row.person, row.title].filter(Boolean).join(', ')]));
  add('Meetings and outcomes', [['Date', 12], ['With', 34], ['Detail', 54]], [
    ...of('meeting').map(entry => ({ date: entry.occurred_on, cells: [shortDate(entry.occurred_on), entry.contact || '', [entry.title, entry.detail].filter(Boolean).join('. ')] })),
    ...pipeline.outcomes.map(row => ({ date: row.date, cells: [shortDate(row.date), who(row), row.outcome] })),
  ].sort((a, b) => a.date.localeCompare(b.date)).map(row => row.cells));
  const metricTable = (kind, title, lead) => {
    const keys = reportKind[kind].metrics;
    const rows = of(kind);
    const metricWidth = key => Math.max(9, key.length * 1.25);
    const width = Math.max(26, 88 - lead.length * 17 - keys.reduce((total, key) => total + metricWidth(key), 0));
    add(title, [['Date', 12], ...lead.map(([label]) => [label, 17]), [reportKind[kind].title, width],
      ...keys.map(key => [key[0].toUpperCase() + key.slice(1), metricWidth(key), 'right'])],
      rows.map(entry => [shortDate(entry.occurred_on), ...lead.map(([, key]) => entry[key]), cell(entry), ...keys.map(key => entry.metrics[key] === undefined ? '–' : number(entry.metrics[key]))]),
      rows.some(entry => entry.detail) ? rows.filter(entry => entry.detail).map(entry => `${entry.title}: ${entry.detail}`).join('\n') : '');
  };
  metricTable('social', 'Social posts', [['Platform', 'channel']]);
  metricTable('podcast', 'Podcast and video', [['Show', 'channel']]);
  metricTable('newsletter', 'Newsletters', [['Newsletter', 'channel']]);
  metricTable('press', 'Press and mentions', [['Outlet', 'channel']]);
  metricTable('event', 'Events', [['Location', 'channel']]);
  add('Emails on your behalf', [['Date', 12], ['', 10], ['With', 34], ['Subject', 44]], [
    ...pipeline.emails.map(row => ({ date: row.date, cells: [shortDate(row.date), row.direction, who(row), row.subject || '(no subject)'] })),
    ...of('email').map(entry => ({ date: entry.occurred_on, cells: [shortDate(entry.occurred_on), 'Email', entry.contact, cell(entry)] })),
  ].sort((a, b) => a.date.localeCompare(b.date)).map(row => row.cells));
  add('Other work', [['Date', 12], ['What we did', 34], ['Notes', 54]],
    of('other').map(entry => [shortDate(entry.occurred_on), cell(entry), entry.detail]));
  return {
    type: 'report', client: report.client.name, period: report.label, prepared_by: report.client.owner_name,
    headline: report.summary.headline, summary: report.summary.summary, next_steps: report.summary.next_steps,
    tiles: [['Introductions made', t.introductions], ['Conversations started', t.conversations], ['Emails exchanged', t.emails],
      ['Audience reached', t.reach], ['Social engagements', t.engagements], ['New matches identified', t.matches_found]]
      .map(([label, value]) => ({ label, value: number(value) })),
    pipeline: report.stages.map(row => ({ label: { to_contact: 'To contact', reached_out: 'Reached out', in_conversation: 'In conversation', closed: 'Closed' }[row.stage], value: number(row.count) })),
    sections,
  };
}

