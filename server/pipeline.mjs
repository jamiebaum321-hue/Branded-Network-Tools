import { AppError, actorName, audit, canAccessClient, clientFor, clientScope, decode, digest, encode, id, iso, requireHuman, system } from './store.mjs';
import { emit } from './events.mjs';
import { choice, email, int, list, num, object, str, time, validate } from './validation.mjs';

export const stages = ['to_contact', 'reached_out', 'in_conversation', 'closed'];
const stageSchema = choice(...stages);
const cardFields = {
  company: str(180), person: str(150, 0), title: str(160, 0), email: str(254, 0), owner_id: str(80),
  stage: stageSchema, next_step: str(300, 0), outcome: str(300, 0), due_at: str(40, 0), branded_relationship: str(600, 0),
};
const cardCreate = object({ client_id: str(80), ...cardFields }, ['client_id', 'company']);
const cardUpdate = object({ ...cardFields, version: int(1, 1000000000) }, ['version']);
const bodyText = str(12000, 0);
const draftFields = { subject: str(300), body: str(12000), recipient: str(254, 0) };
const staffActivity = object({ kind: choice('sent', 'reply', 'note'), subject: str(300, 0), body: bodyText,
  occurred_at: str(40), mailbox_scope: str(160), outlook_message_id: str(1000), draft_id: str(80) }, ['kind']);

export const mailToolFields = {
  card_id: str(80), mailbox_scope: str(160), outlook_message_id: str(1000), subject: str(300, 0),
  body: str(4000, 0), message_reference: str(600, 0),
};
export const logReplySchema = object({ ...mailToolFields, received_at: str(40) },
  ['card_id', 'mailbox_scope', 'outlook_message_id', 'received_at']);
export const logSentSchema = object({ ...mailToolFields, sent_at: str(40), draft_id: str(80) },
  ['card_id', 'mailbox_scope', 'outlook_message_id', 'sent_at']);
export const saveDraftSchema = object({ card_id: str(80), followup_id: str(80), draft_slot: str(160),
  mailbox_scope: str(160), outlook_message_id: str(1000), ...draftFields }, ['card_id', 'subject', 'body']);
export const evidenceSchema = list(object({ source: str(120), detail: str(1800), reference: str(600, 0) }, ['source', 'detail']), 20);
export const addSuggestionSchema = object({ client_id: str(80), company: str(180), person: str(150, 0),
  title: str(160, 0), email: str(254, 0), reason: str(2500), source: str(160), fit: str(120), evidence: evidenceSchema,
  branded_relationship: str(600), score: num(-1000000, 1000000), candidate_key: str(400), mailbox_scope: str(160),
  outlook_message_id: str(1000) }, ['client_id', 'company', 'reason', 'source', 'fit', 'evidence', 'branded_relationship', 'score', 'candidate_key']);

const cardFrom = `FROM cards p JOIN clients c ON c.id=p.client_id JOIN users u ON u.id=p.owner_id
  LEFT JOIN followups f ON f.card_id=p.id AND f.status='pending'`;
const cardSelect = `p.*,c.name AS client_name,u.name AS owner_name,f.due_at,f.id AS followup_id,
  (SELECT max(a.occurred_at) FROM activity a WHERE a.card_id=p.id AND a.kind='sent') AS last_touch,
  coalesce((SELECT d.status FROM drafts d WHERE d.card_id=p.id AND d.followup_id=f.id LIMIT 1),
    (SELECT d.status FROM drafts d WHERE d.card_id=p.id AND d.status IN ('awaiting_review','needs_review','reviewed')
      ORDER BY d.updated_at DESC,d.id LIMIT 1)) AS draft_status`;

export async function cardFor(store, actor, cardId) {
  const [scope, args] = clientScope(actor, 'p.client_id');
  const row = await store.get(`SELECT ${cardSelect} ${cardFrom} WHERE p.id=? AND (${scope})`, cardId, ...args);
  if (!row) throw new AppError(404, 'Card not found.');
  return row;
}

function filtersFor(actor, input, { withStage = true, now = iso() } = {}) {
  const [scope, args] = clientScope(actor, 'p.client_id');
  const where = [`(${scope})`];
  const params = [...args];
  for (const key of ['client_id', 'owner_id', ...(withStage ? ['stage'] : [])]) {
    if (input[key]) { where.push(`p.${key}=?`); params.push(input[key]); }
  }
  if (input.q) {
    where.push('(strpos(lower(p.person),lower(?::text))>0 OR strpos(lower(p.company),lower(?::text))>0)');
    params.push(input.q, input.q);
  }
  if (input.due === 'due') { where.push('f.due_at<=?'); params.push(now); }
  if (input.due === 'scheduled') { where.push('f.due_at>?'); params.push(now); }
  return [where.join(' AND '), params];
}

export async function listCards(store, actor, input) {
  const [where, params] = filtersFor(actor, input);
  const limit = input.limit ?? 40;
  const offset = input.offset ?? 0;
  const rows = await store.all(`SELECT ${cardSelect} ${cardFrom} WHERE ${where}
    ORDER BY p.updated_at DESC,p.id LIMIT ? OFFSET ?`, ...params, limit + 1, offset);
  return { items: rows.slice(0, limit), next_offset: rows.length > limit ? offset + limit : null };
}

export async function board(store, actor, input) {
  const [where, params] = filtersFor(actor, input, { withStage: false });
  const rows = await store.all(`WITH listed AS (
    SELECT ${cardSelect},row_number() OVER(PARTITION BY p.stage ORDER BY p.updated_at DESC,p.id) AS rn,
      count(*) OVER(PARTITION BY p.stage) AS total ${cardFrom} WHERE ${where}
    ) SELECT * FROM listed WHERE rn<=30 ORDER BY stage,rn`, ...params);
  return stages.map(stage => {
    const selected = rows.filter(row => row.stage === stage);
    return { stage, total: selected[0]?.total ?? 0, items: selected.map(({ total, rn, ...row }) => row) };
  });
}

export async function cardDetail(store, actor, cardId, activityId) {
  const card = await cardFor(store, actor, cardId);
  const drafts = await store.all('SELECT * FROM drafts WHERE card_id=? ORDER BY updated_at DESC,id LIMIT 40', cardId);
  const history = await listActivity(store, actor, cardId, {});
  if (activityId && !history.items.some(row => row.id === activityId)) {
    const row = await store.get('SELECT * FROM activity WHERE card_id=? AND id=?', cardId, activityId);
    if (row) history.items.unshift(presentActivity(row));
  }
  const owners = await store.all(`SELECT id,name FROM users WHERE enabled=1 AND (role='admin' OR id IN (
    SELECT owner_id FROM clients WHERE id=? UNION SELECT user_id FROM client_members WHERE client_id=?)) ORDER BY name`, card.client_id, card.client_id);
  return { card, drafts, history, owners };
}

async function assertOwner(store, ownerId, clientId) {
  if (!await canAccessClient(store, ownerId, clientId)) throw new AppError(400, 'Choose an active owner who can access this client.');
}

async function resolveFollowup(store, cardId, status = 'cancelled', at = iso()) {
  const followup = await store.get("SELECT id FROM followups WHERE card_id=? AND status='pending'", cardId);
  if (!followup) return;
  await store.run('UPDATE followups SET status=?,resolved_at=? WHERE id=?', status, at, followup.id);
  await store.run(`UPDATE drafts SET status='cancelled',updated_at=? WHERE followup_id=? AND status IN ('awaiting_review','needs_review','reviewed')`, at, followup.id);
}

async function schedule(store, cardId, dueAt, at) {
  await resolveFollowup(store, cardId, 'cancelled', at);
  if (dueAt) await store.run(`INSERT INTO followups(id,card_id,due_at,status,created_at) VALUES(?,?,?,'pending',?)`, id(), cardId, dueAt, at);
}

async function snapshot(store, cardId, at) {
  await store.run(`INSERT INTO card_states(card_id,owner_id,stage,entered_at,due_at,recorded_at)
    SELECT p.id,p.owner_id,p.stage,p.entered_at,f.due_at,?::text FROM cards p
    LEFT JOIN followups f ON p.id=f.card_id AND f.status='pending' WHERE p.id=?`, at, cardId);
}

// Used inside an existing transaction, including approval and seed import.
export async function insertCard(store, actor, input, { suggestionId = null, reason = '', createdAt, enteredAt } = {}) {
  const client = await clientFor(store, actor, input.client_id);
  const owner = input.owner_id ?? (actor.kind === 'user' ? actor.id : client.owner_id);
  await assertOwner(store, owner, client.id);
  const stage = input.stage ?? 'to_contact';
  const due = time(input.due_at, true);
  if (stage === 'closed' && due) throw new AppError(400, 'Reopen the card before setting a follow-up.');
  if (stage === 'closed' && !input.outcome) throw new AppError(400, 'Enter a closure outcome.');
  const cardId = id();
  const at = iso();
  const created = createdAt ?? at;
  await store.run(`INSERT INTO cards(id,client_id,owner_id,company,person,title,email,stage,next_step,outcome,fit_reason,
    branded_relationship,suggestion_id,entered_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, cardId, client.id, owner,
  input.company, input.person ?? '', input.title ?? '', email(input.email, true), stage, input.next_step ?? '', input.outcome ?? '',
  reason, input.branded_relationship ?? '', suggestionId, enteredAt ?? created, created, at);
  if (due) await schedule(store, cardId, due, at);
  await snapshot(store, cardId, enteredAt ?? created);
  await audit(store, actor, 'card.created', 'card', cardId, client.id, { stage, owner_id: owner, suggestion_id: suggestionId });
  return await cardFor(store, actor, cardId);
}

export async function createCard(store, actor, input) {
  requireHuman(actor);
  const data = validate(cardCreate, input);
  return store.tx(async () => await insertCard(store, actor, data));
}

export async function updateCard(store, actor, cardId, input) {
  requireHuman(actor);
  const data = validate(cardUpdate, input);
  return store.tx(async () => {
    const previous = await cardFor(store, actor, cardId);
    if (previous.version !== data.version) throw new AppError(409, 'This card changed. Reload it before saving.');
    const next = { ...previous, ...data };
    await assertOwner(store, next.owner_id, previous.client_id);
    next.email = email(next.email, true);
    if (next.stage === 'closed' && !next.outcome) throw new AppError(400, 'Enter a closure outcome.');
    const due = next.stage === 'closed' ? null : time(next.due_at, true);
    const changedStage = previous.stage !== next.stage;
    const at = iso();
    const changed = Object.keys(cardFields).filter(field => field !== 'due_at' && previous[field] !== next[field]);
    if (due !== previous.due_at) changed.push('due_at');
    if (!changed.length) return previous;
    await store.run(`UPDATE cards SET owner_id=?,company=?,person=?,title=?,email=?,stage=?,next_step=?,outcome=?,branded_relationship=?,entered_at=?,
      updated_at=?,version=version+1 WHERE id=?`, next.owner_id, next.company, next.person, next.title, next.email,
    next.stage, next.next_step, next.outcome, next.branded_relationship, changedStage ? at : previous.entered_at, at, cardId);
    if (due !== previous.due_at) await schedule(store, cardId, due, at);
    if (changedStage || due !== previous.due_at || previous.owner_id !== next.owner_id) await snapshot(store, cardId, at);
    if (changedStage) {
      const activity = await appendActivity(store, actor, next, { kind: 'stage', occurred_at: at,
        detail: { from: previous.stage, to: next.stage, entered_at: previous.entered_at, outcome: next.outcome } });
      await emit(store, { type: 'stage_changed', key: `stage:${activity.id}`, clientId: previous.client_id, ownerId: next.owner_id,
        cardId, recordId: activity.id, title: `${next.person || next.company} moved stages`, at,
        payload: { from: previous.stage, to: next.stage, actor: actorName(actor) } });
    }
    await audit(store, actor, changedStage ? 'card.stage_changed' : 'card.updated', 'card', cardId, previous.client_id,
      { fields: changed, ...(changedStage ? { from: previous.stage, to: next.stage } : {}) });
    return await cardFor(store, actor, cardId);
  });
}

export async function completeFollowup(store, actor, cardId, followupId) {
  requireHuman(actor);
  return store.tx(async () => {
    const card = await cardFor(store, actor, cardId);
    if (card.followup_id !== followupId) throw new AppError(409, 'The current follow-up has changed.');
    const at = iso();
    await resolveFollowup(store, cardId, 'done', at);
    await store.run('UPDATE cards SET version=version+1,updated_at=? WHERE id=?', at, cardId);
    await snapshot(store, cardId, at);
    await audit(store, actor, 'followup.completed', 'card', cardId, card.client_id, { followup_id: followupId });
    return await cardFor(store, actor, cardId);
  });
}

const presentActivity = row => ({ ...row, detail: decode(row.detail) });

export async function listActivity(store, actor, cardId, { before, limit = 35 }) {
  await cardFor(store, actor, cardId);
  const rows = await store.all(`SELECT * FROM activity WHERE card_id=? AND (?::bigint IS NULL OR seq<?::bigint)
    ORDER BY seq DESC LIMIT ?`, cardId, before ?? null, before ?? null, limit + 1);
  const items = rows.slice(0, limit).map(presentActivity);
  return { items, next_cursor: rows.length > limit ? items.at(-1).seq : null };
}

export async function appendActivity(store, actor, card, data, { emitReply = true } = {}) {
  const rowId = id();
  const at = iso();
  const occurred = data.occurred_at ?? at;
  const eventOwner = (await store.get('SELECT owner_id FROM card_states WHERE card_id=? AND recorded_at<=? ORDER BY recorded_at DESC,seq DESC LIMIT 1',
    card.id, occurred))?.owner_id ?? card.owner_id;
  await store.run(`INSERT INTO activity(id,card_id,client_id,owner_id,kind,actor,actor_id,subject,body,detail,
    mailbox_scope,outlook_message_id,occurred_at,logged_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, rowId, card.id,
  card.client_id, eventOwner, data.kind, actorName(actor), actor.id, data.subject ?? '', data.body ?? '',
  encode(data.detail ?? {}), data.mailbox_scope ?? null, data.outlook_message_id ?? null, occurred, at);
  if (data.kind === 'reply' && emitReply) {
    await store.run(`UPDATE drafts SET status='needs_review',updated_at=? WHERE card_id=? AND status IN ('awaiting_review','reviewed')`, at, card.id);
    await emit(store, { type: 'reply_logged', key: `reply:${rowId}`, clientId: card.client_id, ownerId: card.owner_id,
      cardId: card.id, recordId: rowId, title: `Reply logged for ${card.person || card.company}`, at: data.occurred_at ?? at,
      payload: { actor: actorName(actor), logged_at: at } });
  }
  if (data.kind === 'sent' && data.draft_id) {
    const result = await store.run(`UPDATE drafts SET status='sent',updated_at=? WHERE id=? AND card_id=? AND status<>'cancelled'`, at, data.draft_id, card.id);
    if (!result.changes) throw new AppError(400, 'Choose a draft on this card.');
  }
  await audit(store, actor, `activity.${data.kind}`, 'activity', rowId, card.client_id, { card_id: card.id });
  return presentActivity(await store.get('SELECT * FROM activity WHERE id=?', rowId));
}

function checkMailKey(data) {
  if (Boolean(data.mailbox_scope) !== Boolean(data.outlook_message_id)) {
    throw new AppError(400, 'Include both mailbox scope and Outlook message ID.');
  }
}

async function findMail(store, card, data) {
  if (!data.outlook_message_id) return null;
  const found = await store.get('SELECT * FROM activity WHERE kind=? AND mailbox_scope=? AND outlook_message_id=?',
    data.kind, data.mailbox_scope, data.outlook_message_id);
  if (found && found.card_id !== card.id) throw new AppError(409, 'That message is already linked to another card.');
  return found ? presentActivity(found) : null;
}

export async function importOutreach(store, actor, card, data) {
  checkMailKey(data);
  return await findMail(store, card, data) ?? await appendActivity(store, actor, card, {
    ...data, detail: { imported: true, message_reference: data.message_reference ?? '' },
  }, { emitReply: false });
}

export async function manualActivity(store, actor, cardId, input) {
  requireHuman(actor);
  const data = validate(staffActivity, input);
  checkMailKey(data);
  if (data.kind === 'note' && (!data.body || data.outlook_message_id || data.draft_id)) throw new AppError(400, 'Enter a note.');
  if (data.draft_id && data.kind !== 'sent') throw new AppError(400, 'Link drafts to sent activity.');
  data.occurred_at = data.occurred_at ? time(data.occurred_at) : iso();
  return store.tx(async () => {
    const card = await cardFor(store, actor, cardId);
    return await findMail(store, card, data) ?? await appendActivity(store, actor, card, data);
  });
}

export async function attachMailId(store, actor, cardId, activityId, input) {
  requireHuman(actor);
  const data = validate(object({ mailbox_scope: str(160), outlook_message_id: str(1000) }), input);
  return store.tx(async () => {
    const card = await cardFor(store, actor, cardId);
    const row = await store.get("SELECT * FROM activity WHERE id=? AND card_id=? AND kind IN ('sent','reply')", activityId, card.id);
    if (!row) throw new AppError(404, 'Email activity not found.');
    if (row.outlook_message_id && (row.outlook_message_id !== data.outlook_message_id || row.mailbox_scope !== data.mailbox_scope)) {
      throw new AppError(409, 'This activity already has a different message ID.');
    }
    const found = await findMail(store, card, { ...data, kind: row.kind });
    if (found && found.id !== activityId) throw new AppError(409, 'This message is already logged.');
    if (!found) {
      await store.run('UPDATE activity SET mailbox_scope=?,outlook_message_id=? WHERE id=?', data.mailbox_scope, data.outlook_message_id, activityId);
      await audit(store, actor, 'activity.message_linked', 'activity', activityId, card.client_id, { card_id: card.id });
    }
    return { ok: true };
  });
}

async function mcpWrite(store, actor, operation, key, clientId, target, work) {
  if (actor.kind !== 'claude') throw new AppError(403, 'The Claude job credential is required.');
  const hashed = digest(encode([operation, ...key]));
  const stored = await store.get('SELECT client_id,target,result FROM mcp_writes WHERE key=?', hashed);
  if (stored) {
    if (stored.client_id !== clientId || stored.target !== target) throw new AppError(409, 'This source key already belongs to a different record.');
    return { ...decode(stored.result), replayed: true };
  }
  const result = await work();
  await store.run('INSERT INTO mcp_writes VALUES(?,?,?,?,?,?)', hashed, operation, clientId, target, encode(result), iso());
  return { ...result, replayed: false };
}

export async function mcpLogMail(store, actor, operation, input) {
  const reply = operation === 'log_reply';
  const data = validate(reply ? logReplySchema : logSentSchema, input);
  data.kind = reply ? 'reply' : 'sent';
  data.occurred_at = time(reply ? data.received_at : data.sent_at);
  data.detail = data.message_reference ? { message_reference: data.message_reference } : {};
  return store.tx(async () => {
    const card = await cardFor(store, actor, data.card_id);
    return await mcpWrite(store, actor, operation, [data.mailbox_scope, data.outlook_message_id], card.client_id, card.id, async () => {
      const same = await findMail(store, card, data);
      if (same) return { activity_id: same.id, card_id: card.id, existing: true };
      const match = await store.get(`SELECT id FROM activity WHERE card_id=? AND kind=? AND outlook_message_id IS NULL
        AND substr(occurred_at,1,16)=substr(?::text,1,16) AND (subject='' OR lower(subject)=lower(?::text) OR ?::text='') LIMIT 1`,
      card.id, data.kind, data.occurred_at, data.subject ?? '', data.subject ?? '');
      if (match) throw new AppError(409, 'Possible matching staff activity. Ask the manager to link the Outlook message ID.', { activity_id: match.id });
      const activity = await appendActivity(store, actor, card, data);
      return { activity_id: activity.id, card_id: card.id, actor: activity.actor };
    });
  });
}

async function insertDraft(store, card, data, slot, followup, source, at) {
  const draftId = id();
  await store.run(`INSERT INTO drafts(id,card_id,followup_id,slot,subject,body,recipient,source,status,edited_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,'awaiting_review',?,?,?)`, draftId, card.id, followup ?? null, slot, data.subject, data.body,
  email(data.recipient ?? card.email, true), source, source === 'staff' ? at : null, at, at);
  return await store.get('SELECT * FROM drafts WHERE id=?', draftId);
}

export async function mcpSaveDraft(store, actor, input) {
  const data = validate(saveDraftSchema, input);
  checkMailKey(data);
  if (!data.followup_id && !data.draft_slot) throw new AppError(400, 'Provide a follow-up ID or stable draft slot.');
  if (data.followup_id && data.draft_slot) throw new AppError(400, 'Choose either a follow-up ID or a draft slot.');
  return store.tx(async () => {
    const card = await cardFor(store, actor, data.card_id);
    const slot = data.followup_id ? `followup:${data.followup_id}` : `request:${data.draft_slot}`;
    const key = data.outlook_message_id ? [data.mailbox_scope, data.outlook_message_id, card.id, slot] : [card.id, slot];
    return await mcpWrite(store, actor, 'save_draft', key, card.client_id, `${card.id}:${slot}`, async () => {
      if (card.stage === 'closed' || (data.followup_id && card.followup_id !== data.followup_id)) {
        throw new AppError(409, 'The card or follow-up is no longer open.');
      }
      const previous = await store.get('SELECT * FROM drafts WHERE card_id=? AND slot=?', card.id, slot);
      if (previous && (previous.edited_at || ['sent', 'cancelled', 'reviewed'].includes(previous.status))) {
        return { draft_id: previous.id, card_id: card.id, preserved: true };
      }
      const at = iso();
      let draft;
      if (previous) {
        await store.run(`UPDATE drafts SET subject=?,body=?,recipient=?,source='claude',status='awaiting_review',updated_at=? WHERE id=?`,
          data.subject, data.body, email(data.recipient ?? card.email, true), at, previous.id);
        draft = previous;
      } else draft = await insertDraft(store, card, data, slot, data.followup_id, 'claude', at);
      await appendActivity(store, actor, card, { kind: 'draft', detail: { draft_id: draft.id, source: 'claude',
        outlook_message_id: data.outlook_message_id ?? null } });
      return { draft_id: draft.id, card_id: card.id, actor: 'claude' };
    });
  });
}

export async function staffDraft(store, actor, cardId, input) {
  requireHuman(actor);
  const data = validate(object({ ...draftFields, draft_id: str(80), updated_at: str(40) }, ['subject', 'body']), input);
  return store.tx(async () => {
    const card = await cardFor(store, actor, cardId);
    if (card.stage === 'closed') throw new AppError(409, 'Reopen the card to edit drafts.');
    const previous = data.draft_id ? await store.get('SELECT * FROM drafts WHERE id=? AND card_id=?', data.draft_id, cardId) : null;
    if (data.draft_id && (!previous || previous.updated_at !== data.updated_at || ['sent','cancelled'].includes(previous.status))) {
      throw new AppError(409, 'The draft changed. Reopen it before saving.');
    }
    const at = iso();
    const slot = card.followup_id ? `followup:${card.followup_id}` : `staff:${id()}`;
    let draft;
    if (previous) {
      await store.run(`UPDATE drafts SET subject=?,body=?,recipient=?,status='awaiting_review',edited_at=?,updated_at=? WHERE id=?`,
        data.subject, data.body, email(data.recipient ?? card.email, true), at, at, previous.id);
      draft = await store.get('SELECT * FROM drafts WHERE id=?', previous.id);
    } else {
      if (await store.get('SELECT 1 FROM drafts WHERE card_id=? AND slot=?', cardId, slot)) throw new AppError(409, 'A draft already exists for this follow-up.');
      draft = await insertDraft(store, card, data, slot, card.followup_id, 'staff', at);
    }
    await appendActivity(store, actor, card, { kind: 'draft', detail: { draft_id: draft.id, source: 'staff' } });
    return draft;
  });
}

export async function reviewDraft(store, actor, cardId, draftId, updatedAt) {
  requireHuman(actor);
  return store.tx(async () => {
    const card = await cardFor(store, actor, cardId);
    const result = await store.run(`UPDATE drafts SET status='reviewed',updated_at=? WHERE id=? AND card_id=? AND updated_at=?
      AND status IN ('awaiting_review','needs_review')`, iso(), draftId, cardId, updatedAt);
    if (!result.changes) throw new AppError(409, 'The draft changed. Reopen it before reviewing.');
    await audit(store, actor, 'draft.reviewed', 'draft', draftId, card.client_id, { card_id: card.id });
    return { ok: true };
  });
}

const dueRows = `SELECT ${cardSelect} ${cardFrom}
  WHERE p.stage<>'closed' AND f.due_at<=? AND NOT EXISTS (SELECT 1 FROM events WHERE dedupe_key='due:'||f.id)`;

export async function refreshDue(store, now = iso()) {
  if (!await store.get(`${dueRows} LIMIT 1`, now)) return;
  await store.tx(async () => {
    for (const card of await store.all(dueRows, now)) {
      const slot = `followup:${card.followup_id}`;
      if (!await store.get('SELECT 1 FROM drafts WHERE card_id=? AND slot=?', card.id, slot)) {
        const initial = card.stage === 'to_contact';
        const greeting = card.person ? `Hi ${card.person.split(/\s+/)[0]},` : 'Hello,';
        const data = { subject: `${initial ? 'An introduction to' : 'Following up on'} ${card.client_name}`,
          body: `${greeting}\n\n${initial ? 'Would you be open to a quick introduction to' : 'I wanted to follow up about'} ${card.client_name}${initial ? '?' : '.'} Please let me know what timing works for you.\n\nThanks` };
        await insertDraft(store, card, data, slot, card.followup_id, 'template', now);
        await audit(store, system, 'draft.template_created', 'card', card.id, card.client_id);
      }
      await emit(store, { type: 'follow_up_due', key: `due:${card.followup_id}`, clientId: card.client_id, ownerId: card.owner_id,
        cardId: card.id, recordId: card.followup_id, title: `Follow-up due for ${card.person || card.company}`, at: card.due_at });
    }
  });
}

export async function dueFollowups(store, actor, input) {
  await refreshDue(store);
  const [where, params] = filtersFor(actor, { ...input, due: 'due' });
  const limit = input.limit ?? 40;
  const offset = input.offset ?? 0;
  const rows = await store.all(`SELECT ${cardSelect},d.id AS draft_id ${cardFrom}
    LEFT JOIN drafts d ON d.card_id=p.id AND d.followup_id=f.id WHERE ${where} AND p.stage<>'closed'
    ORDER BY f.due_at,p.id LIMIT ? OFFSET ?`, ...params, limit + 1, offset);
  return { items: rows.slice(0, limit), next_offset: rows.length > limit ? offset + limit : null };
}

const presentSuggestion = row => ({ ...row, evidence: decode(row.evidence) });

export async function suggestionFor(store, actor, suggestionId) {
  const [scope, args] = clientScope(actor, 's.client_id');
  const row = await store.get(`SELECT s.*,c.name AS client_name,p.id AS card_id FROM suggestions s
    JOIN clients c ON c.id=s.client_id LEFT JOIN cards p ON p.suggestion_id=s.id
    WHERE s.id=? AND (${scope})`, suggestionId, ...args);
  if (!row) throw new AppError(404, 'Suggestion not found.');
  return presentSuggestion(row);
}

export async function listSuggestions(store, actor, input) {
  const [scope, args] = clientScope(actor, 's.client_id');
  const where = [`(${scope})`];
  const params = [...args];
  for (const key of ['client_id', 'status', 'source', 'fit']) {
    if (input[key]) { where.push(`s.${key}=?`); params.push(input[key]); }
  }
  if (input.q) {
    where.push('(strpos(lower(s.person),lower(?::text))>0 OR strpos(lower(s.company),lower(?::text))>0)');
    params.push(input.q, input.q);
  }
  const limit = input.limit ?? 35;
  const offset = input.offset ?? 0;
  const rows = await store.all(`SELECT s.*,c.name AS client_name,p.id AS card_id FROM suggestions s
    JOIN clients c ON c.id=s.client_id LEFT JOIN cards p ON p.suggestion_id=s.id WHERE ${where.join(' AND ')}
    ORDER BY s.score DESC NULLS LAST,s.created_at DESC,s.id LIMIT ? OFFSET ?`, ...params, limit + 1, offset);
  return { items: rows.slice(0, limit).map(presentSuggestion), next_offset: rows.length > limit ? offset + limit : null };
}

// Called by MCP and one-time import inside a transaction.
export async function insertSuggestion(store, actor, data, createdAt = iso()) {
  const previous = await store.get('SELECT id FROM suggestions WHERE client_id=? AND candidate_key=?', data.client_id, data.candidate_key);
  if (previous) return { id: previous.id, existing: true };
  const suggestionId = id();
  await store.run(`INSERT INTO suggestions(id,client_id,reviewer_id,company,person,title,email,reason,source,candidate_key,evidence,
    fit,branded_relationship,score,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, suggestionId, data.client_id,
  data.reviewer_id ?? null, data.company, data.person ?? '', data.title ?? '', email(data.email, true), data.reason,
  data.source, data.candidate_key, encode(data.evidence), data.fit, data.branded_relationship, data.score ?? null, createdAt);
  await audit(store, actor, 'suggestion.created', 'suggestion', suggestionId, data.client_id, { source: data.source });
  return { id: suggestionId, existing: false };
}

export async function mcpAddSuggestion(store, actor, input) {
  const data = validate(addSuggestionSchema, input);
  checkMailKey(data);
  return store.tx(async () => {
    await clientFor(store, actor, data.client_id);
    const identity = [data.client_id, data.candidate_key];
    const key = data.outlook_message_id ? [...identity, data.mailbox_scope, data.outlook_message_id] : identity;
    return await mcpWrite(store, actor, 'add_suggested_lead', key, data.client_id, data.candidate_key, async () => {
      const result = await insertSuggestion(store, actor, data);
      const suggestion = await suggestionFor(store, actor, result.id);
      return { suggestion_id: result.id, status: suggestion.status, existing: result.existing };
    });
  });
}

export async function decideSuggestion(store, actor, suggestionId, decision) {
  requireHuman(actor);
  if (!['approved', 'dismissed'].includes(decision)) throw new AppError(400, 'Choose Approve or Dismiss.');
  return store.tx(async () => {
    const row = await suggestionFor(store, actor, suggestionId);
    if (row.status === decision) return row;
    if (row.status !== 'pending') throw new AppError(409, 'This suggestion was already reviewed.');
    const at = iso();
    await store.run('UPDATE suggestions SET status=?,decision_at=?,decision_by=? WHERE id=?', decision, at, actor.id, row.id);
    if (decision === 'approved') await insertCard(store, actor, { client_id: row.client_id, company: row.company, person: row.person,
      title: row.title, email: row.email, branded_relationship: row.branded_relationship,
      next_step: row.person && row.email ? 'Draft first outreach' : row.person ? 'Verify contact details' : 'Find the right contact' },
    { suggestionId: row.id, reason: row.reason });
    await audit(store, actor, `suggestion.${decision}`, 'suggestion', row.id, row.client_id);
    return await suggestionFor(store, actor, suggestionId);
  });
}
