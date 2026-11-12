import { AppError, audit, clientScope, iso, requireHuman } from './store.mjs';
import { refreshDue, stages } from './pipeline.mjs';

export async function today(store, actor) {
  requireHuman(actor);
  const now = iso();
  await refreshDue(store, now);
  const [scope, params] = clientScope(actor, 'c.id');
  const rows = await store.all(`WITH
    owner AS (SELECT ?::text AS id, ?::text AS now),
    accessible AS (SELECT c.id,c.name,c.owner_id FROM clients c WHERE ${scope}),
    bounds AS (SELECT (SELECT coalesce(max(seq),0) FROM activity) AS cutoff,
      (SELECT reply_cursor FROM today_visits WHERE user_id=owner.id) AS previous FROM owner),
    first_visit AS (SELECT min(seq)-1 AS cursor FROM (
      SELECT a.seq FROM activity a JOIN cards p ON p.id=a.card_id JOIN accessible c ON c.id=a.client_id, owner
      WHERE p.owner_id=owner.id AND a.kind='reply' AND (a.detail::jsonb->'imported') IS DISTINCT FROM 'true'::jsonb ORDER BY a.seq DESC LIMIT 40) recent),
    replies AS (SELECT a.seq,a.id,a.card_id,p.person,p.company,a.subject,a.logged_at
      FROM activity a JOIN cards p ON p.id=a.card_id JOIN accessible c ON c.id=a.client_id, owner, bounds, first_visit
      WHERE p.owner_id=owner.id AND a.kind='reply' AND (a.detail::jsonb->'imported') IS DISTINCT FROM 'true'::jsonb
        AND a.seq>coalesce(bounds.previous,first_visit.cursor,bounds.cutoff)
        AND a.seq<=bounds.cutoff ORDER BY a.seq LIMIT 41),
    shown_replies AS (SELECT * FROM replies ORDER BY seq LIMIT 40),
    due AS (SELECT f.id,p.id AS card_id,p.person,p.company,p.next_step,f.due_at
      FROM followups f JOIN cards p ON p.id=f.card_id JOIN accessible c ON c.id=p.client_id, owner
      WHERE p.owner_id=owner.id AND p.stage<>'closed' AND f.status='pending' AND f.due_at<=owner.now
      ORDER BY f.due_at,p.id LIMIT 40),
    ready AS (SELECT d.id,p.id AS card_id,p.person,p.company,d.subject,d.updated_at,d.source,d.status
      FROM drafts d JOIN cards p ON p.id=d.card_id JOIN accessible c ON c.id=p.client_id, owner
      WHERE p.owner_id=owner.id AND p.stage<>'closed' AND d.status IN ('awaiting_review','needs_review')
      ORDER BY d.updated_at DESC,d.id LIMIT 40),
    leads AS (SELECT s.id,s.person,s.company,s.reason,s.created_at,c.name,s.source
      FROM suggestions s JOIN accessible c ON c.id=s.client_id, owner
      WHERE s.status='pending' AND coalesce(s.reviewer_id,c.owner_id)=owner.id
      ORDER BY s.score DESC NULLS LAST,s.created_at,s.id LIMIT 40)
    SELECT 'meta' AS kind, NULL::text AS id, NULL::text AS card_id, NULL::text AS person,NULL::text AS company,NULL::text AS description,
      NULL::text AS at,NULL::text AS extra,NULL::text AS status,
      CASE WHEN (SELECT count(*) FROM replies)>40 THEN (SELECT max(seq) FROM shown_replies) ELSE cutoff END AS cursor,
      ((SELECT count(*) FROM replies)>40) AS more FROM bounds
    UNION ALL SELECT 'followups',id,card_id,person,company,next_step,due_at,NULL,NULL,NULL,NULL FROM due
    UNION ALL SELECT 'drafts',id,card_id,person,company,subject,updated_at,source,status,NULL,NULL FROM ready
    UNION ALL SELECT 'replies',id,card_id,person,company,subject,logged_at,NULL,NULL,NULL,NULL FROM shown_replies
    UNION ALL SELECT 'leads',id,NULL,person,company,reason,created_at,name,source,NULL,NULL FROM leads`, actor.id, now, ...params);
  const groups = { followups: [], drafts: [], replies: [], leads: [] };
  const [meta, ...items] = rows;
  for (const { kind, cursor, more, ...row } of items) {
    const href = kind === 'leads' ? `/pipeline/suggestions/${row.id}` : `/pipeline/cards/${row.card_id}${
      kind === 'drafts' ? `#draft-${row.id}` : kind === 'replies' ? `#activity-${row.id}` : '#draft'}`;
    groups[kind].push({ ...row, href });
  }
  await audit(store, actor, 'today.viewed', 'dashboard');
  return { ...groups, now, reply_cursor: meta.cursor, more_replies: Boolean(meta.more) };
}

export async function acknowledgeToday(store, actor, cursor) {
  requireHuman(actor);
  const max = (await store.get('SELECT coalesce(max(seq),0) AS max FROM activity')).max;
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > max) throw new AppError(400, 'Invalid reply cursor.');
  await store.run(`INSERT INTO today_visits VALUES(?,?) ON CONFLICT(user_id)
    DO UPDATE SET reply_cursor=greatest(today_visits.reply_cursor,excluded.reply_cursor)`, actor.id, cursor);
  return { ok: true };
}

function parts(date, zone, withTime) {
  const fields = { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' };
  if (withTime) Object.assign(fields, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', fields).formatToParts(date).map(({ type, value }) => [type, value]));
}

function localDate(date, zone) {
  const p = parts(date, zone);
  return `${p.year}-${p.month}-${p.day}`;
}

function midnight(date, zone, addDays = 0) {
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) throw new AppError(400, 'Use a valid date.');
  const utc = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(+utc) || utc.toISOString().slice(0, 10) !== date) throw new AppError(400, 'Use a valid date.');
  const target = +utc + addDays * 86400000;
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = parts(new Date(guess), zone, true);
    const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    if (local === target) break;
    guess += target - local;
  }
  return guess;
}

function median(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const index = Math.floor(values.length / 2);
  return Math.round((values.length % 2 ? values[index] : (values[index - 1] + values[index]) / 2) * 10) / 10;
}

export async function metrics(store, actor, input, zone, now = new Date()) {
  const from = input.from || localDate(new Date(+now - 29 * 86400000), zone);
  const to = input.to || localDate(now, zone);
  const start = midnight(from, zone);
  const end = midnight(to, zone, 1);
  if (start >= end) throw new AppError(400, 'The start date must be before or equal to the end date.');
  const snapshotAt = new Date(Math.min(+now, end - 1)).toISOString();
  const [scope, params] = clientScope(actor, 'p.client_id');
  const rows = await store.all(`WITH snapshot AS (
    SELECT h.*,row_number() OVER(PARTITION BY h.card_id ORDER BY h.recorded_at DESC,h.seq DESC) AS rn
    FROM card_states h JOIN cards p ON p.id=h.card_id
    WHERE h.recorded_at<=? AND (${scope}) AND (?::text IS NULL OR p.client_id=?::text))
    SELECT stage,entered_at,due_at FROM snapshot WHERE rn=1 AND (?::text IS NULL OR owner_id=?::text)`,
  snapshotAt, ...params, input.client_id ?? null, input.client_id ?? null, input.owner_id ?? null, input.owner_id ?? null);
  const [activityScope, activityParams] = clientScope(actor, 'a.client_id');
  const counts = await store.all(`SELECT kind,count(*) AS n FROM activity a
    WHERE (${activityScope}) AND a.kind IN ('sent','reply') AND occurred_at>=? AND occurred_at<=?
      AND (?::text IS NULL OR client_id=?::text) AND (?::text IS NULL OR owner_id=?::text) GROUP BY kind`, ...activityParams,
  new Date(start).toISOString(), snapshotAt, input.client_id ?? null, input.client_id ?? null, input.owner_id ?? null, input.owner_id ?? null);
  return {
    from, to, snapshot_at: snapshotAt, contacts: rows.length,
    overdue: rows.filter(row => row.stage !== 'closed' && row.due_at && row.due_at < snapshotAt).length,
    sent: counts.find(row => row.kind === 'sent')?.n ?? 0, replies: counts.find(row => row.kind === 'reply')?.n ?? 0,
    stages: stages.map(stage => {
      const selected = rows.filter(row => row.stage === stage);
      return { stage, count: selected.length, median_days: median(selected.map(row => Math.max(0, (Date.parse(snapshotAt) - Date.parse(row.entered_at)) / 86400000))) };
    }),
  };
}
