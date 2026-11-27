import { primaryEngagement } from './client-links.mjs';
import { AppError, audit, canAccessClient, clientFor, clientScope, iso } from './store.mjs';
import { day, todayKey } from './engagements.mjs';
import { choice, int, object, str, validate } from './validation.mjs';
import { milestoneStates, stepNames } from '../public/solution-model.mjs';

const version = int(0,2147483647);
export function projectMonth(value) {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value || '')) throw new AppError(400,'Choose a month.');
  return value;
}

export function projectWeek(value) {
  if(!value) throw new AppError(400,'Choose a week.');
  day(value);
  const date=new Date(value+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
  return date.toISOString().slice(0,10);
}

export function projectGrid(s, a, month, clientId, week = '', includeProspects = false) {
  projectMonth(month);
  const [scope,args]=clientScope(a,'c.id');
  if (clientId) clientFor(s,a,clientId);
  const where=`(${scope})${clientId?' AND c.id=?':''}`;
  if (clientId) args.push(clientId);
  const rows=s.all(`SELECT c.id,c.name,c.owner_id,u.name owner,e.id engagement_id,e.stage,e.signed_at,
    e.details, b.goals,b.deliverables,coalesce(b.version,0) version,
    (SELECT answers FROM submissions WHERE client_id=c.id ORDER BY version DESC LIMIT 1) intake,
    (SELECT min(submitted_at) FROM submissions WHERE client_id=c.id) intake_at,
    (SELECT count(*) FROM report_versions r JOIN engagements re ON re.id=r.engagement_id WHERE re.client_id=c.id AND r.status='sent') has_report,
    (SELECT min(r.sent_at) FROM report_versions r JOIN engagements re ON re.id=r.engagement_id WHERE re.client_id=c.id AND r.status='sent') report_at
    FROM clients c JOIN users u ON u.id=c.owner_id LEFT JOIN engagements e ON e.id=(${primaryEngagement})
    LEFT JOIN project_briefs b ON b.client_id=c.id WHERE ${where} ORDER BY c.name COLLATE NOCASE,c.id`,...args);
  const stored=s.all(`SELECT m.* FROM project_steps m JOIN clients c ON c.id=m.client_id WHERE ${where} AND m.period IN ('',?,?)`,...args,month,week);
  const byClient=new Map(rows.map((row)=>[row.id,{}]));
  for (const step of stored) byClient.get(step.client_id)[step.step]=step;
  if(week){
    const last=new Date(week+'T12:00:00Z');last.setUTCDate(last.getUTCDate()+6);
    const delivered=s.all(`SELECT c.id,min(r.sent_at) at FROM report_versions r JOIN engagements e ON r.engagement_id=e.id
      JOIN clients c ON c.id=e.client_id WHERE ${where} AND r.status='sent' AND r.end_day BETWEEN ? AND ? GROUP BY c.id`,...args,week,last.toISOString().slice(0,10));
    for(const {id,at} of delivered) {
      const steps=byClient.get(id),old=steps.weekly_sent;
      steps.weekly_sent={...old,status:'done',evidence:true,completed_at:at,version:old?.version||0};
    }
  }
  return rows.filter(row=>includeProspects || clientId || row.signed_at || ['active','signed','onboarding','complete'].includes(row.stage)).map((row)=>{
    const intake=JSON.parse(row.intake || '{}'), terms=JSON.parse(row.details || '{}'), steps=byClient.get(row.id);
    for (const [key,complete,at] of [['intake',row.intake_at,row.intake_at],['report',row.has_report,row.report_at]]) {
      if (complete) steps[key]={...steps[key], status:'done', evidence:true, completed_at:at, version:steps[key]?.version || 0};
    }
    return {id:row.id,name:row.name,owner:row.owner,owner_id:row.owner_id,engagement_id:row.engagement_id,
      goals:row.goals ?? intake.priorities ?? '',deliverables:row.deliverables ?? terms.package ?? '',
      version:row.version,steps,signed_at:row.signed_at,delivery_ready:Boolean(row.signed_at || ['active','signed','onboarding','complete'].includes(row.stage))};
  });
}

export function clientProjectCatalog(s,actor,input,config) {
  const month=projectMonth(input.month), today=todayKey(config.timeZone);
  const week=projectWeek(input.week || (today.startsWith(month)?today:month+'-01'));
  const project=projectGrid(s,actor,month,input.client_id,week)[0];
  const stages=s.all(`SELECT p.id project_id,p.name project_name,t.id,t.name,t.cadence,t.phase
    FROM delivery_projects p JOIN delivery_stages t ON t.project_id=p.id WHERE p.deleted_at IS NULL AND t.archived=0 AND ((p.all_clients AND (p.creator IS NOT NULL OR ?))
    OR EXISTS (SELECT 1 FROM delivery_project_clients c WHERE c.project_id=p.id AND c.client_id=?))
    ORDER BY p.position,t.position,t.id`,Number(project.delivery_ready),input.client_id);
  const boards=new Map();
  for(const stage of stages) {
    if(!boards.has(stage.project_id)) boards.set(stage.project_id,{id:stage.project_id,name:stage.project_name,stages:[]});
    boards.get(stage.project_id).stages.push({id:stage.id,name:stage.name,phase:stage.phase,cadence:stage.cadence,
      period:stage.cadence==='week'?week:stage.cadence==='month'?month:''});
  }
  return {project,milestones:stepNames,boards:[...boards.values()]};
}

export const stepSchema=object({
  client_id:str(80), step:str(80), period:str(10,0), status:choice(...Object.keys(milestoneStates)),
  owner_id:str(80,0), due:str(10,0), notes:str(5000,0), version,
},['client_id','step','status','version']);
export function saveStep(s,a,input) {
  const d=validate(stepSchema,input);
  clientFor(s,a,d.client_id);
  const stage=s.get('SELECT t.cadence,p.all_clients,p.creator,p.id project FROM delivery_stages t JOIN delivery_projects p ON p.id=t.project_id WHERE t.id=? AND p.deleted_at IS NULL AND t.archived=0',d.step);
  const assignedDelivery=stage?.all_clients && !stage.creator?s.get(`SELECT 1 FROM engagements WHERE client_id=? AND line='solutions'
    AND (signed_at IS NOT NULL OR stage IN ('signed','onboarding','active','complete'))`,d.client_id):true;
  if(!stage || !assignedDelivery || (!stage.all_clients && !s.get('SELECT 1 FROM delivery_project_clients WHERE project_id=? AND client_id=?',stage.project,d.client_id)))
    throw new AppError(404,'This milestone is not assigned to the client.');
  const period=stage.cadence==='month'?projectMonth(d.period):stage.cadence==='week'?projectWeek(d.period):'';
  if (d.due) day(d.due);
  if (d.owner_id && !canAccessClient(s,d.owner_id,d.client_id)) throw new AppError(400,'Choose someone with access to this client.');
  return s.tx(()=>{
    const old=s.get('SELECT * FROM project_steps WHERE client_id=? AND step=? AND period=?',d.client_id,d.step,period);
    if ((old?.version || 0)!==d.version) throw new AppError(409,'This milestone changed. Reopen it before saving.');
    const evidence=d.step==='intake' ? s.get('SELECT 1 FROM submissions WHERE client_id=?',d.client_id)
      : d.step==='weekly_sent' ? s.get("SELECT 1 FROM report_versions r JOIN engagements e ON e.id=r.engagement_id WHERE e.client_id=? AND r.status='sent' AND r.end_day BETWEEN ? AND date(?,'+6 days')",d.client_id,period,period)
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
