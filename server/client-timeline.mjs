import { AppError, clientFor } from './store.mjs';

export function timeline(s,actor,client,cursor) {
  clientFor(s,actor,client);
  let at=null, key='';
  if(cursor) {
    try {
      [at,key]=JSON.parse(Buffer.from(cursor,'base64url').toString());
      if(typeof at!=='string'||at.length>40||typeof key!=='string'||key.length>200) throw Error();
    } catch {throw new AppError(400,'Invalid activity cursor.');}
  }
  const items=s.all(`WITH feed AS (
    SELECT 'note:'||n.id key,'note' kind,n.id,n.created_at at,n.author,'Working note' title,n.body,
      trim(coalesce(n.company,'')||' '||coalesce(n.person,'')) detail,0 version,NULL engagement_id FROM client_notes n WHERE n.client_id=?
    UNION ALL SELECT 'submission:'||s.id,'submission',s.id,s.submitted_at,'Client intake','Intake submitted','', '',s.version,NULL
      FROM submissions s WHERE s.client_id=?
    UNION ALL SELECT 'work:'||w.id,'work',w.id,w.recorded_at,w.actor,w.title,w.notes,w.status,0,w.engagement_id
      FROM work_items w JOIN engagements e ON e.id=w.engagement_id WHERE e.client_id=?
    UNION ALL SELECT 'activity:'||a.id,'activity',a.id,a.occurred_at,a.actor,coalesce(nullif(a.subject,''),a.kind),a.body,a.kind,0,NULL
      FROM activity a WHERE a.client_id=?
    UNION ALL SELECT 'step:'||m.step||':'||m.period,'milestone',m.step,m.updated_at,coalesce(u.name,''),t.name,m.notes,p.name,0,NULL
      FROM project_steps m JOIN delivery_stages t ON t.id=m.step JOIN delivery_projects p ON p.id=t.project_id
      LEFT JOIN users u ON u.id=m.owner_id WHERE m.client_id=? AND m.notes<>''
    ) SELECT * FROM feed WHERE ? IS NULL OR at<? OR (at=? AND key<?) ORDER BY at DESC,key DESC LIMIT 41`,
    client,client,client,client,client,at,at,at,key);
  const more=items.length>40;
  if(more) items.pop();
  const last=items.at(-1);
  return {items,next:more?Buffer.from(JSON.stringify([last.at,last.key])).toString('base64url'):null};
}
