import { audit, canAccessClient, clientScope, decode, encode, id, iso } from './store.mjs';

export const eventTypes = ['follow_up_due', 'reply_logged', 'stage_changed', 'onboarding_submitted'];

export async function emit(store, event) {
  const eventId = id();
  const result = await store.run(`INSERT INTO events(id,type,client_id,dedupe_key,record_id,card_id,title,payload,occurred_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`, eventId, event.type, event.clientId,
  event.key, event.recordId, event.cardId ?? null, event.title, encode(event.payload ?? {}), event.at, iso());
  if (!result.changes) return (await store.get('SELECT id FROM events WHERE dedupe_key=?', event.key)).id;

  const client = await store.get('SELECT owner_id FROM clients WHERE id=?', event.clientId);
  const users = new Set((event.type === 'follow_up_due' ? [event.ownerId] : [client.owner_id, event.ownerId]).filter(Boolean));
  if (event.type === 'onboarding_submitted') {
    const team = await store.all('SELECT id FROM users WHERE enabled=1 AND onboarding_alerts=1');
    team.forEach(user => users.add(user.id));
    let reachable = false;
    for (const userId of users) if (await canAccessClient(store, userId, event.clientId)) { reachable = true; break; }
    if (!reachable) {
      (await store.all("SELECT id FROM users WHERE role='admin' AND enabled=1")).forEach(user => users.add(user.id));
    }
  }
  for (const userId of users) if (await canAccessClient(store, userId, event.clientId)) {
    await store.run('INSERT INTO event_recipients(event_id,user_id) VALUES(?,?)', eventId, userId);
  }
  return eventId;
}

function present(row) {
  const payload = decode(row.payload);
  const href = row.type === 'onboarding_submitted' ? `/clients/${row.client_id}/submissions/${row.record_id}`
    : `/pipeline/cards/${row.card_id}${row.type === 'reply_logged' ? `#activity-${row.record_id}` : row.type === 'follow_up_due' ? '#draft' : ''}`;
  return {
    id: row.id, seq: row.seq, type: row.type, title: row.title, client_id: row.client_id,
    client_name: row.client_name, record_id: row.record_id, card_id: row.card_id,
    occurred_at: row.occurred_at, created_at: row.created_at, payload, href,
    actionable: row.type !== 'follow_up_due' || row.followup_status === 'pending',
    ...(row.seen_at !== undefined ? { seen_at: row.seen_at } : {}),
  };
}

const joined = `FROM events e JOIN clients c ON c.id=e.client_id
  LEFT JOIN followups f ON e.type='follow_up_due' AND f.id=e.record_id`;

export async function listEvents(store, actor, { after = 0, limit = 50, types, client_id }) {
  const [scope, args] = clientScope(actor, 'e.client_id');
  const where = ['e.seq>?', `(${scope})`];
  const params = [after, ...args];
  if (client_id) { where.push('e.client_id=?'); params.push(client_id); }
  if (types?.length) {
    where.push(`e.type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }
  const rows = await store.all(`SELECT e.*,c.name AS client_name,f.status AS followup_status ${joined}
    WHERE ${where.join(' AND ')} ORDER BY e.seq LIMIT ?`, ...params, limit + 1);
  const items = [];
  for (const row of rows.slice(0, limit)) {
    const event = present(row);
    if (actor.kind === 'claude') {
      event.audience = [];
      for (const user of await store.all(`SELECT u.id,u.name,u.email FROM event_recipients r
        JOIN users u ON u.id=r.user_id WHERE r.event_id=? AND u.enabled=1 ORDER BY u.id`, row.id)) {
        if (await canAccessClient(store, user.id, row.client_id)) event.audience.push(user);
      }
    }
    items.push(event);
  }
  return { items, next_cursor: items.at(-1)?.seq ?? after, has_more: rows.length > limit };
}

export async function alerts(store, actor) {
  const [scope, args] = clientScope(actor, 'e.client_id');
  const filter = `r.user_id=? AND (${scope}) AND (e.type<>'follow_up_due' OR f.status='pending')`;
  const base = `${joined} JOIN event_recipients r ON r.event_id=e.id WHERE ${filter}`;
  return {
    items: (await store.all(`SELECT e.*,c.name AS client_name,f.status AS followup_status,r.seen_at ${base}
      ORDER BY e.seq DESC LIMIT 30`, actor.id, ...args)).map(present),
    unread: (await store.get(`SELECT count(*) AS n ${base} AND r.seen_at IS NULL`, actor.id, ...args)).n,
  };
}

export async function seeAlerts(store, actor, ids) {
  const [scope, args] = clientScope(actor, 'e.client_id');
  return store.tx(async () => {
    let changes = 0;
    for (const eventId of ids) changes += (await store.run(`UPDATE event_recipients SET seen_at=?
      WHERE user_id=? AND event_id=? AND seen_at IS NULL AND EXISTS (
        SELECT 1 FROM events e WHERE e.id=event_recipients.event_id AND (${scope}))`, iso(), actor.id, eventId, ...args)).changes;
    if (changes) await audit(store, actor, 'alerts.read', 'event', null, null, { count: changes });
    return { updated: changes };
  });
}
