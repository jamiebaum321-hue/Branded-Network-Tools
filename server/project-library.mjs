import { AppError, audit, clientFor, id, requireHuman } from './store.mjs';
import { bool, choice, list, object, str, validate } from './validation.mjs';
import { checkLine, day, todayKey } from './engagements.mjs';
import { projectGrid, projectWeek } from './solution-projects.mjs';
import { milestoneStates } from '../public/solution-model.mjs';
import { sendFile } from './files.mjs';

const cadence=choice('once','week','month');
const clients=list(str(80),1000);
const canManage=(project,actor)=>actor.role==='admin'||project.creator===actor.id;
function management(s,actor,key) {
  checkLine(s,actor,'solutions');
  requireHuman(actor);
  const project=s.get('SELECT * FROM delivery_projects WHERE id=?',key);
  if(!project || !canManage(project,actor)) throw new AppError(403,'The project creator or an administrator can manage this project.');
  return project;
}
function addStage(s,project,name,phase,frequency) {
  if(s.get('SELECT 1 FROM delivery_stages WHERE project_id=? AND name=?',project,name))
    throw new AppError(409,'A stage already has this name.');
  const key=id();
  s.run('INSERT INTO delivery_stages SELECT ?,?,?,?,?,coalesce(max(position),0)+1 FROM delivery_stages WHERE project_id=?',
    key,project,name,phase,frequency,project);
  return key;
}
function enroll(s,actor,project,ids) {
  for(const client of new Set(ids)) {
    clientFor(s,actor,client);
    s.run('INSERT OR IGNORE INTO delivery_project_clients VALUES(?,?)',project,client);
  }
}
function createProject(s,actor,input) {
  checkLine(s,actor,'solutions');
  requireHuman(actor);
  const d=validate(object({name:str(100),description:str(500,0),cadence,stages:list(str(90),60),all_clients:bool,clients},['name','cadence','stages']),input);
  if(!d.stages.length) throw new AppError(400,'Add at least one stage.');
  if(d.all_clients && actor.role!=='admin') throw new AppError(403,'An administrator can assign a project to all clients.');
  const key=id();
  return s.tx(()=>{
    s.run('INSERT INTO delivery_projects SELECT ?,?,?,?,?,?,coalesce(max(position),0)+1 FROM delivery_projects',
      key,d.name,d.description||'',d.cadence,d.all_clients?1:0,actor.id);
    enroll(s,actor,key,d.clients||[]);
    for(const name of d.stages) addStage(s,key,name,'Milestones',d.cadence);
    audit(s,actor,'project.created','delivery_project',key);
    return {id:key};
  });
}

function library(s,actor,date,key,details=false) {
  checkLine(s,actor,'solutions');
  day(date);
  const month=date.slice(0,7),week=projectWeek(date);
  const clients=projectGrid(s,actor,month,null,week);
  const enrollments=s.all('SELECT project_id,client_id FROM delivery_project_clients');
  const stages=s.all('SELECT * FROM delivery_stages ORDER BY position,id');
  const ownerNames=new Map(s.all('SELECT id,name FROM users').map(u=>[u.id,u.name]));
  const projects=[];
  for(const p of s.all('SELECT * FROM delivery_projects ORDER BY position,id')) {
    if(key && p.id!==key) continue;
    const selected=new Set(enrollments.filter(x=>x.project_id===p.id).map(x=>x.client_id));
    const assigned=clients.filter(c=>p.all_clients || selected.has(c.id));
    if(!p.all_clients && !assigned.length && !canManage(p,actor)) continue;
    const columns=stages.filter(x=>x.project_id===p.id).map(stage=>({...stage,period:stage.cadence==='week'?week:stage.cadence==='month'?month:''}));
    let done=0;
    const rows=assigned.map(c=>{
      const steps={};
      let complete=0;
      for(const stage of columns) {
        const existing=c.steps[stage.id];
        if(existing) steps[stage.id]={...existing,owner:ownerNames.get(existing.owner_id)||''};
        if(existing?.status==='done') complete++;
      }
      done+=complete;
      return {...c,steps,complete,percent:columns.length?Math.round(100*complete/columns.length):0};
    });
    const total=assigned.length*columns.length;
    projects.push({...p,manage:canManage(p,actor),count:rows.length,stage_count:columns.length,done,total,
      percent:total?Math.round(100*done/total):0,...(details?{rows,stages:columns}:{})});
  }
  if(key && !projects.length) throw new AppError(404,'Project not found.');
  return {date,week,month,projects,clients:clients.map(({id,name})=>({id,name}))};
}

function exportCsv(res,result) {
  const quote=value=>{
    let text=String(value??'');
    if(/^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(text)) text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  const rows=[['Project','Client','Project owner','Client completion','Stage','Phase','Period','Status','Milestone owner','Due','Milestone notes']];
  for (const p of result.projects) for (const c of p.rows) for(const t of p.stages) {
    const step=c.steps[t.id]||{};
    rows.push([p.name,c.name,c.owner,c.percent+'%',t.name,t.phase,t.period,milestoneStates[step.status||'pending'],step.owner||'',step.due,step.notes]);
  }
  const label=result.projects.length===1?result.projects[0].name:'Project management';
  sendFile(res,{name:(label.replace(/[^a-z0-9 -]/gi,'').trim()||'Projects')+' '+result.date+'.csv',mime:'text/csv; charset=utf-8',
    bytes:Buffer.from('\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n')});
}
export function registerProjectLibrary(route,s,config) {
  const root='/api/project-library',key='/([\\w-]{1,80})';
  const date=url=>url.searchParams.get('date')||todayKey(config.timeZone);
  route('GET',root,({actor,url})=>library(s,actor,date(url)));
  route('POST',root,({actor,data})=>createProject(s,actor,data));
  route('GET',root+'/export',({actor,url,res})=>exportCsv(res,library(s,actor,date(url),null,true)));
  route('GET',root+key+'/export',({actor,url,ids,res})=>exportCsv(res,library(s,actor,date(url),ids[0],true)));
  route('GET',root+key,({actor,url,ids})=>library(s,actor,date(url),ids[0],true));
  route('POST',root+key+'/stages',({actor,ids,data})=>{
    const p=management(s,actor,ids[0]);
    const d=validate(object({name:str(90),phase:str(60),cadence},['name']),data);
    return s.tx(()=>{
      const key=addStage(s,p.id,d.name,d.phase||'Milestones',d.cadence||p.cadence);
      audit(s,actor,'project.stage_added','delivery_project',p.id);
      return {id:key};
    });
  });
  route('POST',root+key+'/clients',({actor,ids,data})=>{
    const p=management(s,actor,ids[0]),d=validate(object({clients}),data);
    return s.tx(()=>{enroll(s,actor,p.id,d.clients);audit(s,actor,'project.clients_added','delivery_project',p.id);return {ok:true};});
  });
}
