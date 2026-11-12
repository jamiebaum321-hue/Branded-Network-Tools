import { stageInfo } from '../public/lifecycle.mjs';
import { actorName, audit, id, iso } from './store.mjs';

export function timeline(store, actor, clientId, entry, at = iso()) {
  const rowId = id();
  store.run(`INSERT INTO client_timeline(id,client_id,kind,from_stage,stage,body,actor,actor_id,at) VALUES(?,?,?,?,?,?,?,?,?)`,
    rowId, clientId, entry.kind, entry.from ?? null, entry.stage ?? null, entry.body ?? '', actorName(actor), actor.id ?? null, at);
  return rowId;
}

// Call inside a transaction. Returns true when the stage changed.
export function moveStage(store, actor, client, stage, note = '') {
  if (client.stage === stage) return false;
  const at = iso();
  store.run('UPDATE clients SET stage=?,stage_entered_at=?,updated_at=? WHERE id=?', stage, at, at, client.id);
  timeline(store, actor, client.id, { kind: 'stage', from: client.stage, stage, body: note }, at);
  audit(store, actor, 'client.stage_changed', 'client', client.id, client.id, { from: client.stage, to: stage });
  return true;
}

// Moves a client forward only when it is still in one of the expected stages.
export function advanceStage(store, actor, clientId, from, to, note) {
  const client = store.get('SELECT id,stage FROM clients WHERE id=?', clientId);
  return client && from.includes(client.stage) && stageInfo[to] ? moveStage(store, actor, client, to, note) : false;
}
