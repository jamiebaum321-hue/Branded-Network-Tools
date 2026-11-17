// The client portal: what a client login can see. Every query here names its fields explicitly and is
// limited to the login's own company, so nothing from the internal tracker can reach a client by accident.
import { AppError, audit } from './store.mjs';

export async function portalHome(store, actor) {
  if (actor?.kind !== 'user' || actor.role !== 'client' || !actor.portal_client_id) throw new AppError(403, 'The portal is for client logins.');
  const client = await store.get('SELECT id,name FROM clients WHERE id=?', actor.portal_client_id);
  if (!client) throw new AppError(404, 'Your company isn’t set up in the portal yet. Contact your Branded team.');
  await audit(store, actor, 'portal.viewed', 'client', client.id, client.id);
  return { user: { name: actor.name, email: actor.email }, client: { name: client.name } };
}
