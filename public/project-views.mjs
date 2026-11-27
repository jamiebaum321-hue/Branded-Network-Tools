import { btn, emptyState, field, h, hidden, icon, link, select } from './ui.mjs';
import { lines } from './business-lines.mjs';
import { milestoneStates, projectIcons } from './solution-model.mjs';

const frequencies={once:'One-time',week:'Weekly',month:'Monthly'};
const choices=names=>Object.entries(names).map(([id,name])=>({id,name}));
const button=(label,action,glyph,kind='')=>btn(label,{action,glyph,kind});
const form=(key,body)=>`<form class="stack" data-form="${key}">${body}</form>`;
const submit=label=>btn(label,{type:'submit',kind:'primary'});
const boardUrl=(id,date,client)=>'/projects?'+new URLSearchParams({board:id,...date&&{date},...client&&{client}});
const percent=(value,label)=>`<span class="progress-value"><progress max="100" value="${value}" aria-label="${h(label)}"></progress><b>${value}%</b></span>`;
const exportLink=(key,date)=>`<a class="button" href="/api/project-library${key?'/'+h(key):''}/export?date=${h(date)}" download>${icon('download')}Export CSV</a>`;
const art=['desk-bell','field-notes','room-key','correspondence'];
function projectArt(key) {
  return art.includes(key)?`<img src="/assets/artwork/${h(key)}.png" alt="" width="210" height="142">`:
    `<span class="project-glyph">${icon(Object.hasOwn(projectIcons,key)?key:'board')}</span>`;
}
function projectMenu(p) {
  if(!p.manage) return '';
  return `<details class="project-menu"><summary aria-label="More options for ${h(p.name)}" title="Project options"><span aria-hidden="true">•••</span></summary>
    <div><button type="button" data-action="project-edit" data-id="${h(p.id)}">${icon('edit')}Edit project</button>
    <button type="button" data-action="project-delete" data-id="${h(p.id)}">${icon('close')}Delete project</button></div></details>`;
}
function libraryView(result,sales) {
  const total=result.projects.reduce((v,p)=>v+p.total,0),done=result.projects.reduce((v,p)=>v+p.done,0);
  const open=sales.deals.filter(d=>!d.signed_at && !lines.solutions.delivery.includes(d.stage)),paused=open.filter(d=>['cold','dead'].includes(d.stage));
  return `<header class="studio-heading"><h1>Project management</h1>${percent(total?Math.round(100*done/total):0,'Overall project completion')}
    <div class="actions">${exportLink('',result.date)}${button('New project','project-new','plus','primary')}</div></header>
    <div class="project-library">${result.projects.map(p=>`<article class="project-wrap"><a class="project-tile tile-${Math.max(0,Object.keys(projectIcons).indexOf(p.icon))%4}" href="${boardUrl(p.id)}">
      <div class="tile-cover">${projectArt(p.icon)}</div>
      <div class="tile-body"><div class="tile-title"><h2>${h(p.name)}</h2>${icon('arrow')}</div>${p.description?`<p>${h(p.description)}</p>`:''}
      <small>${p.count} client${p.count===1?'':'s'} · ${p.stage_count} stages · ${frequencies[p.cadence]}</small>${percent(p.percent,p.name+' completion')}</div></a>${projectMenu(p)}</article>`).join('')}</div>
    ${open.length?`<details class="panel project-dispositions"><summary>Opportunity dispositions</summary>${paused.map(d=>`<p>${h(d.company)} · ${d.stage==='cold'?'Nurture':'Closed lost'} · ${h(d.details.due||d.details.outcome||'')}</p>`).join('')}${button('Manage opportunity disposition','sol-disposition','edit')}</details>`:''}`;
}
function shift(result,p,cadence,delta) {
  const date=new Date((cadence==='week'?result.week:result.month+'-01')+'T12:00:00Z');
  if(cadence==='week') date.setUTCDate(date.getUTCDate()+7*delta);
  else date.setUTCMonth(date.getUTCMonth()+delta);
  return boardUrl(p.id,date.toISOString().slice(0,10));
}
function boardView(result,query) {
  const p=result.projects[0],active=p.rows.find(c=>c.id===query.get('client'));
  const cadence=p.stages.some(t=>t.cadence==='week')?'week':p.stages.some(t=>t.cadence==='month')?'month':p.cadence;
  const cell=(c,t)=>{
    const v=c.steps[t.id]||{},state=v.status||'pending';
    return `<button class="step-cell state-${h(state)}" data-action="project-step" data-client="${h(c.id)}" data-step="${h(t.id)}" aria-label="${h([c.name,t.name,milestoneStates[state],v.notes].filter(Boolean).join(', '))}">
      <span class="status-pill"><i></i>${milestoneStates[state]}</span>${v.notes?`<span class="cell-note" title="${h(v.notes)}">${h(v.notes)}</span>`:''}${v.due?`<small>Due ${h(v.due)}</small>`:''}</button>`;
  };
  return `${link('/projects','Project management','back','back-link')}<header class="studio-heading"><h1>${h(p.name)}</h1>${percent(p.percent,p.name+' completion')}
    <div class="actions">${p.manage&&!p.all_clients?button('Add clients','project-enroll','team'):''}${p.manage?button('Add stage','project-stage','plus'):''}${exportLink(p.id,result.date)}${projectMenu(p)}</div></header>
    ${cadence!=='once'?`<nav class="period-nav" aria-label="Project period"><a href="${shift(result,p,cadence,-1)}" aria-label="Previous period">${icon('back')}</a>
      <span>${cadence==='week'?'Week of '+h(result.week):h(new Intl.DateTimeFormat('en',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(result.month+'-01T12:00:00Z')))}</span>
      <a href="${shift(result,p,cadence,1)}" aria-label="Next period">${icon('arrow')}</a></nav>`:''}
    <div class="project-layout${active?' with-sheet':''}"><section class="project-grid-wrap" tabindex="0" aria-label="Project milestones"><table class="project-grid">
    <thead><tr><th class="pinned">Client</th>${p.stages.map(t=>`<th class="phase-label" scope="col"><small>${h(t.phase)}</small>${h(t.name)}</th>`).join('')}</tr></thead><tbody>
    ${p.rows.map(c=>`<tr><th scope="row" class="pinned">${link(boardUrl(p.id,result.date,c.id),c.name)}<small>${h(c.owner)}</small>${percent(c.percent,c.name+' progress')}</th>
      ${p.stages.map(t=>`<td>${cell(c,t)}</td>`).join('')}</tr>`).join('')}</tbody></table>${p.rows.length?'':emptyState('No clients in this project yet.')}</section>
    ${active?`<aside class="project-sheet panel stack"><div class="section-toolbar"><h2>${h(active.name)}</h2>${link(boardUrl(p.id,result.date),'Close','close')}</div>${percent(active.percent,'Client completion')}
      <h3>Growth goals</h3><p class="multiline">${h(active.goals||'Awaiting goals')}</p><h3>Agreed deliverables</h3><p class="multiline">${h(active.deliverables||'Awaiting deliverables')}</p>
      <div class="actions">${btn('Edit project brief',{action:'sol-brief',data:`data-client="${h(active.id)}"`})}${link('/clients/'+active.id,'Open client','clients')}</div></aside>`:''}</div>`;
}
const picker=(clients,selected=[])=>`<fieldset class="client-picks"><legend>Clients</legend>${clients.map(c=>`<label class="check"><input type="checkbox" name="clients" value="${h(c.id)}"${selected.includes(c.id)?' checked':''}>${h(c.name)}</label>`).join('')||'<p>No available clients.</p>'}</fieldset>`;
const icons=selected=>`<fieldset class="project-icons"><legend>Project icon</legend><div>${Object.entries(projectIcons).map(([key,name])=>
  `<label title="${h(name)}"><input type="radio" name="icon" value="${key}"${key===selected?' checked':''}>${projectArt(key)}<span>${h(name)}</span></label>`).join('')}</div></fieldset>`;
const stageRow=(stage,index)=>`<div class="project-stage-row" data-stage-id="${h(stage.id||'')}"><label class="field"><span>Stage ${index+1}</span>
  <input name="stage_name" value="${h(stage.name||'')}" required maxlength="90"></label><button type="button" class="icon-button" data-action="project-remove-row" aria-label="Remove stage ${index+1}">${icon('close')}</button></div>`;
function numberStages(list) {
  const rows=[...list.children];
  rows.forEach((row,i)=>{
    row.querySelector('label span').textContent='Stage '+(i+1);
    const remove=row.querySelector('button');remove.disabled=rows.length===1;remove.setAttribute('aria-label','Remove stage '+(i+1));
  });
}
export function projectController({api,getUser,showDialog,render,navigate,notify}) {
  let current;
  const board=()=>current.projects[0];
  const close=()=>document.querySelector('#dialog').close();
  const saved=async message=>{close();await render();notify(message);};
  function editProject(result,p) {
    const existing=Boolean(p),stages=p?.stages||[{}];
    const allClients=p?.all_clients?true:false;
    showDialog(existing?'Edit project':'New project',form('project-save',(existing?hidden('id',p.id)+hidden('version',p.version):'')+
      field('Project name','name',p?.name,{required:true,max:100})+icons(p?.icon||'field-notes')+
      field('Description','description',p?.description,{max:500})+select(existing?'Schedule for new stages':'Schedule','cadence',choices(frequencies),p?.cadence||'once')+
      `<fieldset class="project-stages"><legend>Stages</legend><div class="stage-inputs">${stages.map(stageRow).join('')}</div>${button('Add another stage','project-row','plus')}</fieldset>`+
      (getUser().role==='admin'?`<label class="check"><input type="checkbox" name="all_clients"${allClients?' checked':''}> Include all current and future clients</label>`:allClients?hidden('all_clients','on'):'')+
      picker(result.clients,allClients?[]:(p?.rows||[]).map(c=>c.id))+submit(existing?'Save project':'Create project')));
    numberStages(document.querySelector('.stage-inputs'));
  }
  const actions={
    'project-new':()=>editProject(current,null),
    'project-edit':async b=>{
      const result=await api('/api/project-library/'+encodeURIComponent(b.dataset.id));
      editProject(result,result.projects[0]);
    },
    'project-delete':async b=>{
      const result=await api('/api/project-library/'+encodeURIComponent(b.dataset.id)),p=result.projects[0];
      showDialog('Delete project',form('project-delete',hidden('id',p.id)+hidden('version',p.version)+
        `<p>Remove <strong>${h(p.name)}</strong> from project management? Its clients will stay in the client directory.</p>`+submit('Delete project')));
    },
    'project-row':b=>{
      const list=b.closest('fieldset').querySelector('.stage-inputs');
      list.insertAdjacentHTML('beforeend',stageRow({},list.children.length));numberStages(list);list.lastElementChild.querySelector('input').focus();
    },
    'project-remove-row':b=>{
      const row=b.closest('.project-stage-row'),list=row.parentElement,focus=row.nextElementSibling||row.previousElementSibling;
      if(list.children.length<2) return;
      row.remove();numberStages(list);focus.querySelector('input').focus();
    },
    'project-stage':()=>showDialog('Add project stage',form('project-stage',field('Stage name','name','',{required:true,max:90})+
      field('Phase','phase','Milestones',{required:true,max:60})+select('Schedule','cadence',choices(frequencies),board().cadence)+submit('Add stage'))),
    'project-enroll':()=>showDialog('Add clients',form('project-enroll',picker(current.clients.filter(c=>!board().rows.some(r=>r.id===c.id)))+submit('Add clients'))),
    'project-step':async b=>{
      const c=board().rows.find(r=>r.id===b.dataset.client),t=board().stages.find(s=>s.id===b.dataset.step);
      const step=c.steps[t.id]||{}, owners=(await api('/api/clients/'+c.id)).owners;
      showDialog(t.name,form('sol-step',hidden('client',c.id)+hidden('step',t.id)+hidden('period',t.period)+hidden('version',step.version||0)+
        `<p>${h(c.name)}${t.period?' · '+h(t.period):''}</p>`+select('Status','status',choices(step.evidence?{done:'Done'}:milestoneStates),step.status||'pending')+
        select('Owner','owner_id',owners,step.owner_id||c.owner_id,'Unassigned')+field('Due date','due',step.due,{type:'date'})+
        field('Milestone notes','notes',step.notes,{type:'textarea',max:5000})+submit('Save milestone')));
    },
  };
  const forms={
    'project-save':async(f,v)=>{
      const key=v.get('id'),rows=[...f.querySelectorAll('.project-stage-row')].map(row=>({
        ...(row.dataset.stageId?{id:row.dataset.stageId}:{}),name:row.querySelector('input').value.trim()}));
      const payload={name:v.get('name'),description:v.get('description'),cadence:v.get('cadence'),icon:v.get('icon'),
        stages:key?rows:rows.map(t=>t.name),all_clients:v.has('all_clients'),clients:v.getAll('clients')};
      if(key) payload.version=Number(v.get('version'));
      const result=await api('/api/project-library'+(key?'/'+encodeURIComponent(key):''),key?'PATCH':'POST',payload);
      close();
      if(key) await render();else navigate(boardUrl(result.id));
      notify(key?'Project updated.':'Project created.');
    },
    'project-delete':async(f,v)=>{
      const key=v.get('id');
      await api('/api/project-library/'+encodeURIComponent(key),'DELETE',{version:Number(v.get('version'))});
      close();if(new URLSearchParams(location.search).get('board')===key) navigate('/projects');else await render();
      notify('Project deleted.');
    },
    'project-stage':async(f,v)=>{await api('/api/project-library/'+board().id+'/stages','POST',Object.fromEntries(v));await saved('Stage added.');},
    'project-enroll':async(f,v)=>{await api('/api/project-library/'+board().id+'/clients','POST',{clients:v.getAll('clients')});await saved('Client list updated.');},
  };
  async function page(query,sales) {
    const id=query.get('board')||(query.get('client')?'onboarding':''), date=query.get('date');
    current=await api('/api/project-library'+(id?'/'+encodeURIComponent(id):'')+(date?'?date='+encodeURIComponent(date):''));
    return id?boardView(current,query):libraryView(current,sales);
  }
  return {page,actions,forms};
}
