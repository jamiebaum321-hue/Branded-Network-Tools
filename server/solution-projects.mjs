import { AppError, audit, canAccessClient, clientFor, clientScope, iso } from './store.mjs';
import { day } from './engagements.mjs';
import { choice, int, object, str, validate } from './validation.mjs';
import { milestoneStates, stepNames } from '../public/solution-model.mjs';

const version = int(0,2147483647);
export function projectMonth(value) {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value || '')) throw new AppError(400,'Choose a month.');
  return value;
}

export function projectGrid(s, a, month, clientId) {
  projectMonth(month);
  const [scope,args]=clientScope(a,'c.id');
  if (clientId) clientFor(s,a,clientId);
  const where=`(${scope})${clientId?' AND c.id=?':''}`;
  if (clientId) args.push(clientId);
  const rows=s.all(`SELECT c.id,c.name,c.owner_id,u.name owner,e.id engagement_id,e.stage,e.signed_at,
    e.details, b.goals,b.deliverables,coalesce(b.version,0) version,
    (SELECT answers FROM submissions WHERE client_id=c.id ORDER BY version DESC LIMIT 1) intake,
    (SELECT min(submitted_at) FROM submissions WHERE client_id=c.id) intake_at,
    (SELECT count(*) FROM report_versions WHERE engagement_id=e.id AND status='sent') has_report,
    (SELECT min(sent_at) FROM report_versions WHERE engagement_id=e.id AND status='sent') report_at
    FROM clients c JOIN users u ON u.id=c.owner_id LEFT JOIN engagements e ON e.client_id=c.id
    LEFT JOIN project_briefs b ON b.client_id=c.id WHERE ${where} ORDER BY c.name COLLATE NOCASE,c.id`,...args);
  const stored=s.all(`SELECT m.* FROM project_steps m JOIN clients c ON c.id=m.client_id WHERE ${where} AND m.period IN ('',?)`,...args,month);
  const byClient=new Map(rows.map((row)=>[row.id,{}]));
  for (const step of stored) byClient.get(step.client_id)[step.step]=step;
  return rows.map((row)=>{
    const intake=JSON.parse(row.intake || '{}'), terms=JSON.parse(row.details || '{}'), steps=byClient.get(row.id);
    for (const [key,complete,at] of [['intake',row.intake_at,row.intake_at],['report',row.has_report,row.report_at]]) {
      if (complete) steps[key]={...steps[key], status:'done', evidence:true, completed_at:at, version:steps[key]?.version || 0};
    }
    return {id:row.id,name:row.name,owner:row.owner,owner_id:row.owner_id,engagement_id:row.engagement_id,
      goals:row.goals ?? intake.priorities ?? '',deliverables:row.deliverables ?? terms.package ?? '',
      version:row.version,steps,signed_at:row.signed_at};
  });
}

export const stepSchema=object({
  client_id:str(80), step:choice(...Object.keys(stepNames)), period:str(7,0), status:choice(...Object.keys(milestoneStates)),
  owner_id:str(80,0), due:str(10,0), notes:str(5000,0), version,
},['client_id','step','status','version']);
export function saveStep(s,a,input) {
  const d=validate(stepSchema,input);
  clientFor(s,a,d.client_id);
  const period=d.step==='monthly' ? projectMonth(d.period) : '';
  if (d.due) day(d.due);
  if (d.owner_id && !canAccessClient(s,d.owner_id,d.client_id)) throw new AppError(400,'Choose someone with access to this client.');
  return s.tx(()=>{
    const old=s.get('SELECT * FROM project_steps WHERE client_id=? AND step=? AND period=?',d.client_id,d.step,period);
    if ((old?.version || 0)!==d.version) throw new AppError(409,'This milestone changed. Reopen it before saving.');
    const evidence=d.step==='intake' ? s.get('SELECT 1 FROM submissions WHERE client_id=?',d.client_id)
      : d.step==='report' && s.get("SELECT 1 FROM report_versions r JOIN engagements e ON e.id=r.engagement_id WHERE e.client_id=? AND r.status='sent'",d.client_id);
    if (evidence && d.status!=='done') throw new AppError(409,'The recorded delivery has completed this milestone.');
    s.run(`INSERT INTO project_steps VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(client_id,step,period) DO UPDATE SET
      status=excluded.status,owner_id=excluded.owner_id,due=excluded.due,notes=excluded.notes,updated_at=excluded.updated_at,version=excluded.version`,
      d.client_id,d.step,period,d.status,d.owner_id || null,d.due || '',d.notes || '',iso(),d.version+1);
    audit(s,a,'project.milestone_updated','project',d.client_id,d.client_id,{step:d.step,period,status:d.status});
    return {version:d.version+1};
  });
}
export function saveBrief(s,a,client,input) {
  clientFor(s,a,client);
  const d=validate(object({goals:str(8000,0),deliverables:str(8000,0),version}),input);
  return s.tx(()=>{
    const old=s.get('SELECT version FROM project_briefs WHERE client_id=?',client);
    if ((old?.version || 0)!==d.version) throw new AppError(409,'This project changed. Reopen it before saving.');
    s.run(`INSERT INTO project_briefs VALUES(?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET goals=excluded.goals,deliverables=excluded.deliverables,version=excluded.version`,
      client,d.goals,d.deliverables,d.version+1);
    audit(s,a,'project.brief_updated','project',client,client);
    return {version:d.version+1};
  });
}
