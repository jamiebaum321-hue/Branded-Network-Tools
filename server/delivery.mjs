import { AppError, audit, clientFor, decode, id, iso, requireHuman } from './store.mjs';
import { engagement, day, queueMail } from './engagements.mjs';
import { kinds, tiers } from '../public/business-lines.mjs';
import { email, int, object, str, validate } from './validation.mjs';
import { getSubmission } from './clients.mjs';
import { filesFor } from './files.mjs';
import { midnight } from './dashboard.mjs';
import { addSuggestionSchema, insertSuggestion } from './pipeline.mjs';

export function research(s, a, input) {
  const { tier, next_action, research: notes = '', ...rest } = input;
  if (!Object.hasOwn(tiers, tier)) throw new AppError(400, 'Select a relationship group.');
  const data = validate(addSuggestionSchema, rest);
  validate(str(400), next_action);
  validate(str(8000, 0), notes);
  clientFor(s, a, data.client_id);
  return s.tx(() => {
    const r = insertSuggestion(s, a, data);
    if (r.existing) {
      const old = s.get('SELECT status FROM suggestions WHERE id=?', r.id);
      if (old.status !== 'pending') return { ...r, status: old.status };
      s.run(
        'UPDATE suggestions SET company=?,person=?,title=?,email=?,reason=?,source=?,evidence=?,fit=?,branded_relationship=?,score=? WHERE id=?',
        data.company,
        data.person || '',
        data.title || '',
        email(data.email, true),
        data.reason,
        data.source,
        JSON.stringify(data.evidence),
        data.fit,
        data.branded_relationship,
        data.score,
        r.id
      );
    }
    s.run(
      'INSERT INTO introduction_research VALUES(?,?,?,?) ON CONFLICT(suggestion_id) DO UPDATE SET tier=excluded.tier,next_action=excluded.next_action,research=excluded.research',
      r.id,
      tier,
      next_action,
      notes
    );
    audit(s, a, 'research.saved', 'suggestion', r.id, data.client_id);
    return r;
  });
}
export function dealDetail(s, a, key) {
  const e = engagement(s, a, key);
  const suggestions = e.client_id
    ? s
        .all(
          `SELECT s.id,s.company,s.person,s.reason,s.status,s.branded_relationship,s.evidence,
    r.tier,r.next_action,r.research,p.id card_id FROM suggestions s LEFT JOIN introduction_research r ON r.suggestion_id=s.id
    LEFT JOIN cards p ON p.suggestion_id=s.id WHERE s.client_id=? ORDER BY s.score DESC,s.created_at DESC`,
          e.client_id
        )
        .map((x) => ({ ...x, evidence: decode(x.evidence) }))
    : [];
  const latest = e.client_id
    ? s.get(
        'SELECT id FROM submissions WHERE client_id=? ORDER BY submitted_at DESC,version DESC LIMIT 1',
        e.client_id
      )
    : null;
  return {
    deal: e,
    files: filesFor(s, e),
    latest: latest ? getSubmission(s, a, e.client_id, latest.id) : null,
    suggestions,
    team: s
      .all(
        'SELECT user_id FROM engagement_members WHERE engagement_id=? UNION SELECT user_id FROM client_members WHERE client_id=?',
        key,
        e.client_id
      )
      .map((x) => x.user_id),
    work: s.all('SELECT * FROM work_items WHERE engagement_id=? ORDER BY recorded_at DESC,id', key),
    reports: s.all('SELECT * FROM report_versions WHERE engagement_id=? ORDER BY created_at DESC,id', key),
    dispatches: s.all(
      'SELECT id,kind,recipient,status,subject,detail,attempted_at,created_at FROM dispatches WHERE engagement_id=? ORDER BY created_at DESC',
      key
    ),
  };
}
const reportFields = { start_day: str(10), end_day: str(10) };
export function reportEvidence(s, a, key, input, zone = 'America/New_York') {
  const e = engagement(s, a, key);
  if (!e.client_id || e.line !== 'solutions') throw new AppError(400, 'A Solutions client is required.');
  const { start_day: start, end_day: end } = validate(object(reportFields), input);
  day(start);
  day(end);
  if (start > end || Date.parse(end) - Date.parse(start) > 31 * 86400000)
    throw new AppError(400, 'Choose a reporting period of up to 32 days.');
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const inWindow = (at) => {
    const d = fmt.format(new Date(at));
    return d >= start && d <= end;
  };
  const through = new Date(midnight(end, zone, 1)).toISOString();
  const work = s.all(
    `SELECT w.kind,w.title,CASE WHEN w.recorded_at<? THEN w.due ELSE '' END due,w.external_ref,
      CASE WHEN w.recorded_at<? THEN (SELECT name FROM users WHERE id=coalesce(w.owner_id,?)) ELSE '' END owner,
      h.at recorded_at,h.notes,h.status FROM work_items w JOIN work_history h ON h.seq=(
    SELECT seq FROM work_history WHERE item_id=w.id AND at<? ORDER BY at DESC,seq DESC LIMIT 1)
    WHERE w.engagement_id=? AND w.audience='client' ORDER BY h.at,w.id`,
    through,
    through,
    e.owner_id,
    through,
    key
  );
  const touches = s
    .all(
      `SELECT a.*,p.company,p.person FROM activity a JOIN cards p ON p.id=a.card_id
    WHERE a.client_id=? AND (a.kind IN ('sent','reply','introduction') OR (a.kind='stage' AND json_extract(a.detail,'$.to')='closed')) AND a.occurred_at>=? AND a.occurred_at<? ORDER BY a.occurred_at,a.seq`,
      e.client_id,
      new Date(Date.parse(start) - 86400000).toISOString(),
      new Date(Date.parse(end) + 2 * 86400000).toISOString()
    )
    .filter((x) => inWindow(x.occurred_at));
  const done = work
    .filter((x) => x.status === 'done' && inWindow(x.recorded_at))
    .map(
      (x) =>
        `${kinds[x.kind]} · ${x.title}${x.notes ? ' — ' + x.notes : ''}${x.external_ref ? ' · ' + x.external_ref : ''}`
    );
  for (const t of touches) {
    const outcome =
      t.kind === 'stage'
        ? decode(t.detail).outcome
        : t.kind === 'introduction'
          ? [t.body, decode(t.detail).outcome].filter(Boolean).join(' · ')
          : '';
    done.push(
      `${t.kind === 'stage' ? 'Outcome' : kinds[t.kind]} · ${[t.person, t.company].filter(Boolean).join(', ')}${outcome ? ' — ' + outcome : ''}`
    );
  }
  const next = work
    .filter((x) => x.status !== 'done')
    .map(
      (x) =>
        `${x.title}${x.owner ? ' · ' + x.owner : ''}${x.due ? ' · ' + x.due : ''}${x.notes ? ' — ' + x.notes : ''}`
    );
  const intros = s
    .all(
      `SELECT p.company,p.person,CASE WHEN p.updated_at<? THEN p.next_step ELSE '' END next_step
    FROM cards p JOIN card_states h ON h.seq=(SELECT seq FROM card_states WHERE card_id=p.id AND recorded_at<? ORDER BY recorded_at DESC,seq DESC LIMIT 1)
    WHERE p.client_id=? AND h.stage<>'closed' ORDER BY p.company,p.person`,
      through,
      through,
      e.client_id
    )
    .map((r) => [r.person, r.company, r.next_step].filter(Boolean).join(' · '));
  return {
    client: e.company,
    start_day: start,
    end_day: end,
    completed: done,
    outstanding: next,
    introductions: intros,
  };
}
export function newReport(s, a, key, input, zone) {
  requireHuman(a);
  return s.tx(() => {
    const evidence = reportEvidence(s, a, key, input, zone);
    const source = 'workspace:' + evidence.start_day + '/' + evidence.end_day;
    const existing = s.get(
      'SELECT id,status FROM report_versions WHERE engagement_id=? AND source_key=?',
      key,
      source
    );
    if (existing) return existing;
    const make = (heading, rows) =>
      heading + '\n' + (rows.length ? rows.map((v) => '• ' + v).join('\n') : 'No items recorded.');
    const body = [
      evidence.client + ' · Weekly update',
      evidence.start_day + ' to ' + evidence.end_day,
      make('Completed and outcomes', evidence.completed),
      make('Outstanding work', evidence.outstanding),
      make('Introductions and next steps', evidence.introductions),
    ].join('\n\n');
    const rid = id();
    s.run(
      'INSERT INTO report_versions(id,engagement_id,start_day,end_day,body,status,created_at,source_key) VALUES(?,?,?,?,?,?,?,?)',
      rid,
      key,
      evidence.start_day,
      evidence.end_day,
      body,
      'draft',
      iso(),
      source
    );
    return { id: rid };
  });
}
export const draftReportSchema = object({
  engagement_id: str(80),
  ...reportFields,
  body: str(100000),
  source_key: str(420),
});
export function saveReportDraft(s, a, input, config) {
  const { engagement_id: key, start_day, end_day, body, source_key } = validate(draftReportSchema, input);
  return s.tx(() => {
    reportEvidence(s, a, key, { start_day, end_day }, config.timeZone);
    const existing = s.get(
      'SELECT id,status FROM report_versions WHERE engagement_id=? AND source_key=?',
      key,
      source_key
    );
    if (existing) return { ...existing, existing: true };
    const rid = id();
    s.run(
      "INSERT INTO report_versions(id,engagement_id,start_day,end_day,body,source_key,status,created_at) VALUES(?,?,?,?,?,?,'draft',?)",
      rid,
      key,
      start_day,
      end_day,
      body,
      source_key,
      iso()
    );
    audit(s, a, 'report.drafted', 'report', rid, engagement(s, a, key).client_id);
    return { id: rid, status: 'draft', existing: false };
  });
}
export function updateReport(s, a, key, rid, input) {
  requireHuman(a);
  const d = validate(
    object(
      {
        body: str(100000),
        version: int(1, 2147483647),
        send_to: str(254, 0),
        manual_sent: { type: 'boolean' },
      },
      ['body', 'version']
    ),
    input
  );
  return s.tx(() => {
    const e = engagement(s, a, key);
    const r = s.get('SELECT * FROM report_versions WHERE id=? AND engagement_id=?', rid, key);
    if (!r) throw new AppError(404, 'Report not found.');
    if (r.status !== 'draft' || r.version !== d.version)
      throw new AppError(409, 'Open the latest editable draft.');
    let status = 'draft';
    if (d.send_to) {
      const to = email(d.send_to);
      queueMail(s, {
        key: 'report:' + rid,
        deal: key,
        report: rid,
        kind: 'weekly_report',
        to,
        subject: e.company + ' · Weekly update · ' + r.end_day,
        body: d.body,
      });
      status = 'queued';
    } else if (d.manual_sent) status = 'sent';
    s.run("UPDATE report_versions SET body=?,version=version+1,status=?,sent_at=CASE WHEN ?='sent' THEN ? ELSE sent_at END WHERE id=?", d.body, status, status, iso(), rid);
    audit(s, a, 'report.' + status, 'report', rid, e.client_id);
    return { id: rid, status };
  });
}
