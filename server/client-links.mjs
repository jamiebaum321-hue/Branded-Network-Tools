// Prefer an active signed agreement, then a historical delivery record, then the newest prospect.
export const primaryEngagement = `SELECT e2.id FROM engagements e2 WHERE e2.client_id=c.id AND e2.line='solutions'
  ORDER BY CASE WHEN e2.signed_at IS NOT NULL AND e2.stage<>'complete' THEN 0
    WHEN e2.stage IN ('signed','onboarding','active','complete') THEN 1 ELSE 2 END,
    e2.signed_at DESC,e2.created_at DESC,e2.id LIMIT 1`;

// Keep pre-existing access boundaries when linking a historical sales record to a client.
export function linkLegacySales(store,makeId) {
  const deals=store.all(`SELECT e.id,e.owner_id,e.created_at,co.name FROM engagements e JOIN companies co ON co.id=e.company_id
    WHERE e.line='solutions' AND e.client_id IS NULL ORDER BY e.created_at,e.id`);
  for(const deal of deals) {
    const members=store.all('SELECT user_id FROM engagement_members WHERE engagement_id=? AND user_id<>? ORDER BY user_id',deal.id,deal.owner_id).map(r=>r.user_id);
    const candidates=store.all('SELECT id FROM clients WHERE lower(trim(name))=lower(trim(?)) AND owner_id=?',deal.name,deal.owner_id);
    const matching=candidates.filter(c=>{
      const roster=store.all('SELECT user_id FROM client_members WHERE client_id=? AND user_id<>? ORDER BY user_id',c.id,deal.owner_id).map(r=>r.user_id);
      return JSON.stringify(roster)===JSON.stringify(members);
    });
    const client=matching.length===1?matching[0].id:makeId();
    if(matching.length!==1) {
      store.run('INSERT INTO clients(id,name,owner_id,created_at) VALUES(?,?,?,?)',client,deal.name,deal.owner_id,deal.created_at);
      for(const person of members) store.run('INSERT INTO client_members VALUES(?,?)',client,person);
    }
    store.run('UPDATE engagements SET client_id=? WHERE id=?',client,deal.id);
  }
}
