// The client portal: what a client login can see. Every query here names its fields explicitly and is
// limited to one company, so nothing from the internal tracker can reach a client by accident.
import { AppError, audit, requireAdmin } from './store.mjs';

// Internal intro statuses, collapsed into wording a client sees. Anything not listed is never shown.
const introLabel = {
  'Intro Sent': 'Introduced', 'Awaiting Response': 'Introduced',
  'Follow-Up Needed': 'In discussion', 'Client Following Up': 'In discussion', 'In Discussion': 'In discussion',
  'Meeting Scheduled': 'Meeting set', Won: 'Won',
};
const stageLabel = { reached_out: 'Introduced', in_conversation: 'In discussion' };
const targetLabel = { 'To Introduce': 'Planned', 'Intro Requested': 'Intro requested' };
const order = ['Meeting set', 'In discussion', 'Introduced', 'Won'];

export async function portalView(store, clientId) {
  const client = await store.get(`SELECT id,name,agreement_status,contract_start,contract_end,monthly_fee,
    CASE WHEN next_step_shared=1 THEN next_step END AS shared_step, CASE WHEN next_step_shared=1 THEN next_due END AS shared_due
    FROM clients WHERE id=?`, clientId);
  if (!client) throw new AppError(404, 'Your company isn’t set up in the portal yet. Contact your Branded team.');
  // Intros: open ones, plus closed ones only when won. Notes, next steps, owners and lost intros never leave.
  const cards = await store.all(`SELECT company,person,stage,intro_status,created_at FROM cards
    WHERE client_id=? AND portal_hidden=0 AND (stage IN ('reached_out','in_conversation') OR (stage='closed' AND intro_status='Won'))
    ORDER BY created_at DESC, company`, clientId);
  const intros = cards.map(row => ({ company: row.company, contact: row.person || '', introduced_on: String(row.created_at).slice(0, 10),
    status: introLabel[row.intro_status] ?? stageLabel[row.stage] ?? (row.stage === 'closed' ? 'Won' : 'Introduced') }))
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.introduced_on.localeCompare(a.introduced_on));
  // Targets in progress: company and status only (contacts and the "why" are internal research).
  const targets = (await store.all(`SELECT company,intro_status FROM cards WHERE client_id=? AND stage='to_contact' AND portal_hidden=0 ORDER BY lower(company)`, clientId))
    .map(row => ({ company: row.company, status: targetLabel[row.intro_status] ?? 'Planned' }));
  // Only updates someone chose to share; never the source line, message IDs or who logged it.
  const updates = await store.all(`SELECT at,text FROM activity_log WHERE client_id=? AND shared=1 ORDER BY at DESC,id DESC LIMIT 12`, clientId);
  const count = status => intros.filter(row => row.status === status).length;
  return {
    client: { name: client.name },
    agreement: { status: client.agreement_status || '', start: client.contract_start || null, end: client.contract_end || null,
      monthly_fee: client.monthly_fee ?? null },
    summary: { intros: intros.length, in_discussion: count('In discussion'), meetings: count('Meeting set'), won: count('Won'), targets: targets.length },
    next_step: client.shared_step ? { text: client.shared_step, due: client.shared_due || null } : null,
    updates: updates.map(row => ({ on: String(row.at).slice(0, 10), text: row.text })),
    intros, targets,
  };
}

export async function portalHome(store, actor) {
  if (actor?.kind !== 'user' || actor.role !== 'client' || !actor.portal_client_id) throw new AppError(403, 'The portal is for client logins.');
  const view = await portalView(store, actor.portal_client_id);
  await audit(store, actor, 'portal.viewed', 'client', actor.portal_client_id, actor.portal_client_id);
  return { user: { name: actor.name, email: actor.email }, ...view };
}

// Admins see exactly what that client's logins see, without creating a login.
export async function portalPreview(store, actor, clientId) {
  requireAdmin(actor);
  return { preview: true, user: { name: actor.name, email: actor.email }, ...(await portalView(store, clientId)) };
}
