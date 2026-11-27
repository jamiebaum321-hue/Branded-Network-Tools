import { AppError, audit, canAccessClient, clientFor, id, requireHuman } from './store.mjs';
import { bool, choice, int, list, object, str, validate } from './validation.mjs';
import { checkLine, day, todayKey } from './engagements.mjs';
import { projectGrid, projectWeek } from './solution-projects.mjs';
import { milestoneStates, projectIcons } from '../public/solution-model.mjs';
import { sendFile } from './files.mjs';

const cadence=choice('once','week','month');
const clients=list(str(80),1000);
const canManage=(project,actor)=>actor.role==='admin'||project.creator===actor.id;
function management(s,actor,key) {
  checkLine(s,actor,'solutions');
  requireHuman(actor);
  const project=s.get('SELECT * FROM delivery_projects WHERE id=? AND deleted_at IS NULL',key);
  if(!project || !canManage(project,actor)) throw new AppError(403,'The project creator or an administrator can manage this project.');
  return project;
}
function addStage(s,project,name,phase,frequency) {
  const existing=s.get('SELECT id,archived FROM delivery_stages WHERE project_id=? AND name=?',project,name);
  if(existing && !existing.archived)
    throw new AppError(409,'A stage already has this name.');
  if(existing) {
    s.run('UPDATE delivery_stages SET archived=0,position=(SELECT max(position)+1 FROM delivery_stages WHERE project_id=?) WHERE id=?',project,existing.id);
    return existing.id;
  }
  const key=id();
  s.run('INSERT INTO delivery_stages(id,project_id,name,phase,cadence,position) SELECT ?,?,?,?,?,coalesce(max(position),0)+1 FROM delivery_stages WHERE project_id=?',
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
  const d=validate(object({name:str(100),description:str(500,0),icon:choice(...Object.keys(projectIcons)),cadence,stages:list(str(90),500),all_clients:bool,clients},['name','cadence','stages']),input);
  if(!d.stages.length) throw new AppError(400,'Add at least one stage.');
  if(d.all_clients && actor.role!=='admin') throw new AppError(403,'An administrator can assign a project to all clients.');
  const key=id();
  return s.tx(()=>{
    s.run('INSERT INTO delivery_projects(id,name,description,cadence,all_clients,creator,icon,position) SELECT ?,?,?,?,?,?,?,coalesce(max(position),0)+1 FROM delivery_projects',
      key,d.name,d.description||'',d.cadence,d.all_clients?1:0,actor.id,d.icon||'field-notes');
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
  const clients=projectGrid(s,actor,month,null,week,true);
  const enrollments=s.all('SELECT project_id,client_id FROM delivery_project_clients');
  const stages=s.all('SELECT * FROM delivery_stages WHERE archived=0 ORDER BY position,id');
  const ownerNames=new Map(s.all('SELECT id,name FROM users').map(u=>[u.id,u.name]));
  const projects=[];
  for(const p of s.all('SELECT * FROM delivery_projects WHERE deleted_at IS NULL ORDER BY position,id')) {
    if(key && p.id!==key) continue;
    const selected=new Set(enrollments.filter(x=>x.project_id===p.id).map(x=>x.client_id));
    const assigned=clients.filter(c=>p.all_clients ? Boolean(p.creator || c.delivery_ready) : selected.has(c.id));
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

function editProject(s,actor,key,input) {
  const stage=object({id:str(80),name:str(90)},['name']);
  const d=validate(object({name:str(100),description:str(500,0),icon:choice(...Object.keys(projectIcons)),cadence,
    stages:list(stage,500),clients,all_clients:bool,version:int(1,2147483647)}),input);
  return s.tx(()=>{
    const p=management(s,actor,key);
    if(p.version!==d.version) throw new AppError(409,'This project changed. Reopen it before saving.');
    if(!d.stages.length || new Set(d.stages.map(x=>x.name.toLowerCase())).size!==d.stages.length)
      throw new AppError(400,'Give each stage a distinct name.');
    if(d.all_clients!==Boolean(p.all_clients) && actor.role!=='admin') throw new AppError(403,'Only an administrator can change all-client access.');
    const previous=s.all('SELECT id,name FROM delivery_stages WHERE project_id=? AND archived=0',key);
    const keep=d.stages.filter(t=>t.id).map(t=>t.id);
    if(new Set(keep).size!==keep.length || keep.some(value=>!previous.some(t=>t.id===value))) throw new AppError(409,'The stage list changed.');
    // Temporary names allow two stages to exchange labels without violating the unique constraint.
    for(const t of previous) {
      if(keep.includes(t.id)) s.run('UPDATE delivery_stages SET name=? WHERE id=?','__editing_'+id(),t.id);
      else s.run('UPDATE delivery_stages SET archived=1 WHERE id=?',t.id);
    }
    for(const [index,t] of d.stages.entries()) {
      let stageId=t.id;
      if(stageId) {
        const archived=s.get('SELECT id FROM delivery_stages WHERE project_id=? AND archived=1 AND name=?',key,t.name);
        if(archived) s.run('UPDATE delivery_stages SET name=? WHERE id=?',t.name+' (removed '+archived.id+')',archived.id);
      } else stageId=addStage(s,key,t.name,'Milestones',d.cadence);
      s.run('UPDATE delivery_stages SET name=?,position=? WHERE id=?',t.name,index+1,stageId);
    }
    for(const entry of s.all('SELECT client_id FROM delivery_project_clients WHERE project_id=?',key)){
      if(d.clients.includes(entry.client_id)) continue;
      if(actor.role==='admin' || canAccessClient(s,actor.id,entry.client_id))
        s.run('DELETE FROM delivery_project_clients WHERE project_id=? AND client_id=?',key,entry.client_id);
    }
    enroll(s,actor,key,d.clients);
    s.run('UPDATE delivery_projects SET name=?,description=?,icon=?,cadence=?,all_clients=?,version=version+1 WHERE id=?',
      d.name,d.description,d.icon,d.cadence,d.all_clients?1:0,key);
    audit(s,actor,'project.updated','delivery_project',key);
    return {id:key,version:d.version+1};
  });
}
function deleteProject(s,actor,key,input) {
  const {version}=validate(object({version:int(1,2147483647)}),input);
  return s.tx(()=>{
    const p=management(s,actor,key);
    if(p.version!==version) throw new AppError(409,'This project changed. Reopen it before deleting.');
    s.run('UPDATE delivery_projects SET deleted_at=?,version=version+1 WHERE id=?',new Date().toISOString(),key);
    audit(s,actor,'project.deleted','delivery_project',key);
    return {ok:true};
  });
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
  route('PATCH',root+key,({actor,ids,data})=>editProject(s,actor,ids[0],data));
  route('DELETE',root+key,({actor,ids,data})=>deleteProject(s,actor,ids[0],data));
  route('POST',root+key+'/stages',({actor,ids,data})=>{
    const p=management(s,actor,ids[0]);
    const d=validate(object({name:str(90),phase:str(60),cadence},['name']),data);
    return s.tx(()=>{
      const key=addStage(s,p.id,d.name,d.phase||'Milestones',d.cadence||p.cadence);
      s.run('UPDATE delivery_projects SET version=version+1 WHERE id=?',p.id);
      audit(s,actor,'project.stage_added','delivery_project',p.id);
      return {id:key};
    });
  });
  route('POST',root+key+'/clients',({actor,ids,data})=>{
    const p=management(s,actor,ids[0]),d=validate(object({clients}),data);
    return s.tx(()=>{enroll(s,actor,p.id,d.clients);s.run('UPDATE delivery_projects SET version=version+1 WHERE id=?',p.id);audit(s,actor,'project.clients_added','delivery_project',p.id);return {ok:true};});
  });
}
