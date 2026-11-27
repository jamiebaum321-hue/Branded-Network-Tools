import { AppError, audit, id, iso, requireAdmin, requireHuman, system } from './store.mjs';
import { checkLine, insertDeal, lineSchema, queueMail, workspaceAccounts } from './engagements.mjs';
import { choice, email, object, str, validate } from './validation.mjs';

export function createSource(s, a, input) {
  requireAdmin(a);
  const d = validate(object({ line: lineSchema, label: str(180), owner_id: str(80) }), input);
  if (!workspaceAccounts(s, a, d.line).some((x) => x.id === d.owner_id))
    throw new AppError(400, 'Choose a workspace owner.');
  const key = id();
  s.run(
    'INSERT INTO inquiry_sources(id,line,label,owner_id,created_at) VALUES(?,?,?,?,?)',
    key,
    d.line,
    d.label,
    d.owner_id,
    iso()
  );
  return { id: key, path: '/inquire/' + key };
}
export function source(s, key) {
  const x = s.get(
    `SELECT s.line,s.label,s.owner_id FROM inquiry_sources s JOIN users u ON u.id=s.owner_id
    WHERE s.id=? AND s.active=1 AND u.enabled=1 AND (u.role='admin' OR EXISTS(
    SELECT 1 FROM workspace_members w WHERE w.user_id=u.id AND w.line=s.line))`,
    key
  );
  if (!x) throw new AppError(404, 'This inquiry link is unavailable.');
  return x;
}
export function submitInquiry(s, key, input) {
  const src = source(s, key);
  const d = validate(
    object({ request_id: str(80), company: str(180), name: str(150), email: str(254), message: str(2500) }),
    input
  );
  return s.tx(() => {
    if (!s.get('SELECT 1 FROM inquiry_entries WHERE source_id=? AND request_id=?', key, d.request_id)) {
      const deal = insertDeal(
        s,
        system,
        src.line,
        {
          company: d.company,
          details: {
            source: src.label,
            contact: d.name,
            contact_email: email(d.email),
            next_action: 'Respond to inquiry',
          },
        },
        src.owner_id
      );
      s.run('INSERT INTO inquiry_entries VALUES(?,?,?)', key, d.request_id, deal.id);
      s.run(
        'INSERT INTO work_items(id,engagement_id,kind,title,notes,status,recorded_at,actor) VALUES(?,?,?,?,?,?,?,?)',
        id(),
        deal.id,
        'reply',
        'New inquiry',
        d.message,
        'waiting',
        iso(),
        d.name
      );
    }
    return { received: true };
  });
}
export const pitchStates = ['review', 'new', 'in_progress', 'closed', 'dismissed'];
export function pitches(s, a) {
  checkLine(s, a, 'media');
  return s.all(
    `SELECT p.*,d.status AS ack_status FROM guest_pitches p LEFT JOIN dispatches d ON d.pitch_id=p.id
    WHERE (?='admin' OR p.owner_id=?) ORDER BY p.received_at DESC`,
    a.role,
    a.id
  );
}
function ack(s, p) {
  queueMail(s, {
    key: 'guest_ack:' + p.id,
    pitch: p.id,
    kind: 'guest_ack',
    to: p.sender,
    subject: 'Your Hospitality Hangout guest idea',
    body: 'Thanks for thinking of Hospitality Hangout and sending us your guest idea. Our team will review your pitch and follow up with you.\n\nThe Hospitality Hangout team',
  });
}
export function ingestPitch(
  s,
  { thread, sender, subject, body, url = '', at = iso(), confirmed = false, messageId = '' },
  config
) {
  return s.tx(() => {
    const old = s.get('SELECT id FROM guest_pitches WHERE thread_key=?', thread);
    if (old) return { id: old.id, existing: true };
    const owner =
      s.get(
        `SELECT u.id FROM users u WHERE u.email=? COLLATE NOCASE AND u.enabled=1 AND
      (u.role='admin' OR EXISTS(SELECT 1 FROM workspace_members w WHERE w.user_id=u.id AND w.line='media'))`,
        config.podcastOwner || ''
      )?.id ?? null;
    const key = id(),
      address = email(sender);
    s.run(
      'INSERT INTO guest_pitches VALUES(?,?,?,?,?,?,?,?,?,?)',
      key,
      thread,
      address,
      subject.slice(0, 400),
      body.slice(0, 5000),
      owner,
      confirmed ? 'new' : 'review',
      at,
      url,
      messageId
    );
    if (confirmed) ack(s, { id: key, sender: address });
    return { id: key };
  });
}
export function changePitch(s, a, key, input) {
  requireHuman(a);
  checkLine(s, a, 'media');
  const d = validate(object({ status: choice(...pitchStates), owner_id: str(80, 0) }, ['status']), input);
  return s.tx(() => {
    const p = s.get('SELECT * FROM guest_pitches WHERE id=?', key);
    if (!p || (a.role !== 'admin' && p.owner_id !== a.id)) throw new AppError(404, 'Pitch not found.');
    const owner = d.owner_id || p.owner_id;
    if (
      d.owner_id &&
      d.owner_id !== p.owner_id &&
      (a.role !== 'admin' || !workspaceAccounts(s, a, 'media').some((u) => u.id === owner))
    )
      throw new AppError(403, 'Choose an assigned Media owner.');
    s.run('UPDATE guest_pitches SET status=?,owner_id=? WHERE id=?', d.status, owner, key);
    if (p.status === 'review' && ['new', 'in_progress'].includes(d.status)) ack(s, p);
    audit(s, a, 'pitch.updated', 'pitch', key, null, { status: d.status });
    return { ok: true };
  });
}
