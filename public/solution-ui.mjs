import { btn, emptyState, field, h, hidden, icon, initials, link, outboundLink, select } from './ui.mjs';
import { clientForm, submissionRows } from './views.mjs';
import { overview, profileView, reportsView, workView } from './workspace.mjs';
import { departments, groups, healthStates, milestoneStates, projectPhases, relationshipStages, stepNames } from './solution-model.mjs';

const choices = (values) => Object.entries(values).map(([id,name])=>({id,name}));
const primary = (label) => btn(label,{type:'submit',kind:'primary'});
const action = (label,name,attrs='',glyph='') => btn(label,{action:name,data:attrs,glyph});
const form = (name,body) => '<form class="stack" data-form="'+name+'">'+body+'</form>';
const panel = (name,body) => '<section class="panel stack"><h2>'+h(name)+'</h2>'+body+'</section>';
const clientUrl = (id,tab) => '/clients/'+encodeURIComponent(id)+(tab?'?tab='+tab:'');
const projectUrl = (month,client) => '/projects?'+new URLSearchParams({month,...(client?{client}: {})});
const projectProgress = (project) => Object.keys(stepNames).filter((id)=>project.steps[id]?.status==='done').length;
const sourceLink = (client,source) => {
  if (source.type==='file') return `<a class="text-link" href="/api/files/${encodeURIComponent(source.id)}" target="_blank" rel="noopener">${h(source.label)}</a>`;
  if (source.type==='intake') return link(clientUrl(client)+'/submissions/'+encodeURIComponent(source.id),source.label,'intake');
  if (source.type==='research') return link('/pipeline/suggestions/'+encodeURIComponent(source.id),source.label,'shortlist');
  if (source.type==='card') return link('/pipeline/cards/'+encodeURIComponent(source.id),source.label,'network');
  return h(source.label);
};
function mapView(data,query) {
  const id=data.client.id, health=query.get('health') || '', search=(query.get('q')||'').trim().toLowerCase();
  const visible=data.connections.filter((n)=>(!health || n.health===health) && [n.company,n.person,n.next_action,n.notes].some((v)=>v?.toLowerCase().includes(search)));
  return `<div class="map-actions"><div class="actions">${action('Add connection','sol-connection','','plus')}${action('Add note','sol-note','','draft')}${action('Add research','ws-research','','shortlist')}</div>
    </div>
    <form class="ws-filter" data-form="filter">${hidden('tab','map')}${field('Find a connection','q',query.get('q') || '',{type:'search',placeholder:'Company, person or next action'})}${select('Relationship health','health',choices(healthStates),health,'All connections')}${btn('Apply',{type:'submit'})}${health||search?link(clientUrl(id,'map'),'Clear'):''}</form>
    <section class="relationship-map" aria-label="Client introduction map"><div class="map-root">${icon('network')}<strong>${h(data.client.name)}</strong><span>${data.connections.length} connections</span></div>
      <div class="map-branches">${Object.entries(groups).map(([key,label])=>{
        const children=visible.filter((node)=>node.category===key);
        return `<section class="map-branch"><header><h2>${h(label)}</h2><span>${children.length}</span></header>
          ${children.map((node)=>`<button type="button" class="map-node" data-action="sol-connection" data-key="${h(node.key)}"><span class="node-title">${h(node.company || node.person)}${icon('chevron')}</span>
          ${node.company && node.person?`<span>${h(node.person)}</span>`:''}<span class="node-state"><i class="health-dot health-${h(node.health)}"></i>${h(healthStates[node.health])} · ${h(relationshipStages[node.stage])}</span>
          ${node.next_action?`<small>${h(node.next_action)}</small>`:''}</button>`).join('') || '<p class="map-empty">No matching connections</p>'}</section>`;
      }).join('')}</div></section>`;
}

function peopleView(data) {
  return `<div class="section-toolbar"><h2>Client group</h2>${action('Add contact','sol-person','','plus')}</div>
    <div class="people-grid">${[...departments,'Unassigned'].map((dep)=>{
      const people=data.people.filter((p)=>(p.department || 'Unassigned')===dep);
      if(!people.length) return '';
      return panel(dep,people.map((p)=>`<article class="person-row"><span class="avatar">${h(initials(p.first_name+' '+p.last_name))}</span>
        <div><strong>${h([p.first_name,p.last_name].filter(Boolean).join(' ') || p.email)}</strong><small>${h(p.title)}</small>
        ${p.email?`<a href="mailto:${h(p.email)}">${h(p.email)}</a>`:''}${p.phone?`<small>${h(p.phone)}</small>`:''}${p.notes?`<p class="multiline">${h(p.notes)}</p>`:''}</div>
        ${action('Edit','sol-person',`data-key="${h(p.key)}"`,'edit')}</article>`).join(''));
    }).join('') || emptyState('No client contacts yet.','Add a contact or collect the client’s intake.')}</div>`;
}

function notesView(data) {
  return `<div class="section-toolbar"><h2>Working notes</h2>${action('Add note','sol-note','','plus')}</div>
    <div class="stack">${data.notes.map((n)=>`<article class="panel client-note"><strong>${h(n.author)}</strong> <time>${h(n.created_at.slice(0,10))}</time>
      <p class="multiline">${h(n.body)}</p>${n.company || n.person?`<small>${h([n.company,n.person].filter(Boolean).join(' · '))}</small>`:''}</article>`).join('') || emptyState('No working notes yet.')}</div>`;
}

function projectPage(result,board,query) {
  const {month,projects}=result, search=(query.get('q')||'').trim().toLowerCase(), owner=query.get('owner')||'';
  const rows=projects.filter((p)=>p.name.toLowerCase().includes(search) && (!owner || p.owner_id===owner));
  const active=projects.find((p)=>p.id===query.get('client'));
  const currentPhase=(p)=>projectPhases.find((phase)=>phase.steps.some(([key])=>p.steps[key]?.status!=='done'))?.name || 'Complete';
  const cell=(p,key)=>{const step=p.steps[key],state=step?.status || 'pending';
    return `<button class="step-cell state-${state}" data-action="sol-step" data-client="${h(p.id)}" data-step="${key}" data-month="${month}" aria-label="${h(p.name+', '+stepNames[key]+', '+milestoneStates[state])}">
      <span class="status-pill"><i></i>${h(milestoneStates[state])}</span>${step?.due?`<small>${h(step.due)}</small>`:''}</button>`;};
  const managed=board.deals.filter((d)=>!d.client_id && !d.signed_at);
  const paused=managed.filter((d)=>['cold','dead'].includes(d.stage));
  return `<header class="section-title"><div><h1>Project management</h1><p>${projects.length} advisory projects <span>·</span> ${h(month)} follow-ups</p></div></header>
    <form class="ws-filter" data-form="filter">${field('Find a client','q',query.get('q') || '',{type:'search',placeholder:'Client name'})}${select('Owner','owner',board.owners,owner,'All owners')}${field('Follow-up month','month',month,{type:'month',required:true})}${btn('Apply',{type:'submit'})}</form>
    <div class="project-layout${active?' with-sheet':''}"><section class="project-grid-wrap" tabindex="0" aria-label="Client milestone grid"><table class="project-grid"><thead><tr><th class="pinned" rowspan="2" scope="col">Client</th><th rowspan="2" scope="col">Current phase</th>
    ${projectPhases.map((phase,i)=>`<th class="phase-band band-${i}" scope="colgroup" colspan="${phase.steps.length}">${h(phase.name)}</th>`).join('')}</tr><tr>
    ${projectPhases.flatMap((phase,i)=>phase.steps.map(([key,label])=>`<th scope="col" class="phase-label band-${i}">${h(label)}${key==='monthly'?`<small>${h(month)}</small>`:''}</th>`)).join('')}</tr></thead><tbody>
    ${rows.map((p)=>`<tr><th class="pinned" scope="row">${link(projectUrl(month,p.id),p.name)}<small>${h(p.owner)}</small><progress value="${projectProgress(p)}" max="${Object.keys(stepNames).length}" aria-label="${h(p.name)} progress"></progress></th><td>${h(currentPhase(p))}</td>
    ${projectPhases.flatMap((phase)=>phase.steps.map(([key])=>'<td>'+cell(p,key)+'</td>')).join('')}</tr>`).join('')}</tbody></table>${rows.length?'':emptyState('No matching projects.','Signing a Solutions engagement creates its project.')}</section>
    ${active?`<aside class="project-sheet panel stack" aria-label="Project details"><div class="section-toolbar"><h2>${h(active.name)}</h2>${link(projectUrl(month),'Close','close')}</div>
      <p>${h(active.owner)} · ${projectProgress(active)}/${Object.keys(stepNames).length} milestones completed</p>
      <h3>Growth goals</h3><p class="multiline">${h(active.goals||'Awaiting goals')}</p><h3>Agreed deliverables</h3><p class="multiline">${h(active.deliverables||'Awaiting deliverables')}</p>
      <div class="actions">${action('Edit project brief','sol-brief',`data-client="${h(active.id)}"`,'edit')}${link(clientUrl(active.id),'Open client','clients')}</div>
      ${projectPhases.map((phase)=>`<div class="journey-group"><h3>${h(phase.name)}</h3>${phase.steps.map(([key,label])=>`<div><span>${h(label)}</span>${cell(active,key)}</div>`).join('')}</div>`).join('')}</aside>`:''}</div>
    <details class="panel project-dispositions"><summary>Paused and closed opportunities · ${paused.length}</summary>${paused.map((d)=>`<p>${h(d.company)} · ${d.stage==='cold'?'Nurture':'Closed lost'} · ${h(d.details.due||d.details.outcome||'')}</p>`).join('')}
    ${managed.length?action('Manage opportunity disposition','sol-disposition','','edit'):''}</details>`;
}

function profilePage(p,user) {
  return `<header class="section-title"><div><h1>My profile</h1><p>${h(p.email)} · ${p.role==='admin'?'Administrator':'Team member'}</p></div></header>
    <div class="profile-layout">${panel('Profile',form('sol-profile',hidden('version',p.profile_version)+field('Full name','name',p.name,{required:true,max:100})+
    field('Job title','job_title',p.job_title,{max:150})+field('Phone number','phone',p.phone,{type:'tel',max:70})+field('About','bio',p.bio,{type:'textarea',max:1500})+
    '<label class="check"><input type="checkbox" name="onboarding_alerts" '+(p.onboarding_alerts?'checked':'')+'> Receive onboarding alerts</label>'+primary('Save profile')))}
    <div class="stack">${panel('Workspace access','<p>'+h((user.workspaces || []).map((v)=>v[0].toUpperCase()+v.slice(1)).join(' · ') || 'No workspaces assigned')+'</p>')}
    ${panel('Password',form('sol-password',field('Current password','current','',{type:'password',autocomplete:'current-password',required:true,max:256})+
      field('New password','password','',{type:'password',autocomplete:'new-password',hint:'At least 12 characters',required:true,max:256})+
      field('Confirm new password','confirm','',{type:'password',autocomplete:'new-password',required:true,max:256})+primary('Change password')))}</div></div>`;
}

export function solutionController({api,navigate,render,showDialog,notify,getUser,getZone,setUser}) {
  let board;
  const currentClient=()=>location.pathname.split('/')[2];
  const close=()=>document.querySelector('#dialog').close();
  const latest=async()=>api('/api/clients/'+encodeURIComponent(currentClient())+'/workspace');
  const saved=async(message)=>{close();await render();notify(message);};
  const members=async(client)=>(await api('/api/clients/'+client)).owners;
  const readProject=(client,month)=>api('/api/clients/'+encodeURIComponent(client)+'/project'+(month?'?month='+encodeURIComponent(month):''));
  async function page(path,query) {
    if(path==='/profile') return profilePage(await api('/api/profile'),getUser());
    const [projectData,projectBoard]=await Promise.all([api('/api/projects'+(query.get('month')?'?month='+encodeURIComponent(query.get('month')):'')), api('/api/workspaces/solutions')]);
    board=projectBoard;
    return projectPage(projectData,projectBoard,query);
  }
  async function client(info,ctx,query,zone) {
    const c=info.client;
    const [data,detail]=await Promise.all([api('/api/clients/'+c.id+'/workspace'),info.engagement_id?api('/api/engagements/'+info.engagement_id):null]);
    const tabs={map:'Introduction map',people:'Client group',notes:'Notes',intake:'Advisory intake',history:'Submission history',activity:'Activity',reports:'Weekly updates',account:'Engagement'};
    const tab=Object.hasOwn(tabs,query.get('tab'))?query.get('tab'):'map';
    const owners=ctx.owners, logo=detail?.files.find((file)=>file.purpose==='logo' && file.mime.startsWith('image/'));
    const views={
      map:()=>mapView(data,query),people:()=>peopleView(data),notes:()=>notesView(data),
      intake:()=>detail?profileView(detail):'',activity:()=>detail?workView(detail,owners,zone):'',
      reports:()=>detail?reportsView(detail,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())):'',
      history:()=>panel('Submission history',`<div id="submission-list">${info.submissions.items.length?submissionRows(info.submissions.items,c.id,zone):emptyState('No submissions yet.')}</div>
        ${info.submissions.next_cursor?action('Load older submissions','more-submissions',`data-id="${h(c.id)}" data-next="${h(info.submissions.next_cursor)}"`):''}
        ${info.link?`<p>Intake link expires ${h(new Date(info.link.expires_at).toLocaleDateString())}.</p>${action('Revoke active link','revoke-form',`data-id="${h(c.id)}"`,'lock')}`:''}`),
      account:()=>`${detail?`<div class="actions">${action('Edit engagement','ws-edit','','edit')}${!detail.deal.signed_at?action('Record existing agreement','ws-history'):''}</div>${overview(detail,owners,getUser(),zone)}`:''}
        ${getUser().role==='admin'?panel('Client access',clientForm(ctx,info)):''}`,
    };
    return `<section data-engagement-context="${h(info.engagement_id||'')}">${link('/clients','All clients','back','back-link')}
      <header class="section-title client-head"><div class="client-identity">${logo?`<img src="/api/files/${h(logo.id)}?preview=1" alt="${h(c.name)} logo">`:`<span class="client-monogram">${h(initials(c.name))}</span>`}<div><h1>${h(c.name)}</h1><p>Solutions client · ${h(c.owner_name)}</p></div></div>
      <div class="actions">${action('Work with Claude','sol-claude','','draft')}${link('/projects?client='+c.id,'View project','stack')}${action('Copy intake link','form-link',`data-id="${h(c.id)}"`,'link')}</div></header>
      <nav class="client-tabs" aria-label="Client sections">${Object.entries(tabs).map(([id,label])=>`<a href="${clientUrl(c.id,id)}"${id===tab?' aria-current="page"':''}>${label}</a>`).join('')}</nav>${views[tab]()}</section>`;
  }

  const actions={
    'sol-connection':async(b)=>{
      const data=await latest(), c=data.client.id, n=b.dataset.key?data.connections.find((v)=>v.key===b.dataset.key):{};
      if(!n) throw new Error('This connection has changed. Refresh the map.');
      const who=await members(c);
      const identity=n.key?hidden('key',n.key)+hidden('company',n.company)+hidden('person',n.person)+`<h3>${h([n.company,n.person].filter(Boolean).join(' · '))}</h3>`:
        field('Company','company','',{max:180})+field('Person','person','',{max:150});
      const evidence=(n.sources||[]).map((v)=>`<li>${sourceLink(c,v)}${v.detail?`<p>${h(v.detail)}</p>`:''}${v.link?outboundLink(v.link):''}</li>`).join('');
      showDialog(n.key?'Connection details':'Add connection',form('sol-connection',hidden('version',n.version||0)+identity+
        select('Map branch','category',choices(groups),n.category||'priority')+select('Relationship health','health',choices(healthStates),n.health||'unrated')+
        select('Introduction status','stage',choices(relationshipStages),n.stage||'identified')+select('Relationship owner','owner_id',who,n.owner_id,'Unassigned')+
        field('Next action','next_action',n.next_action,{max:400})+field('Follow-up date','due',n.due,{type:'date'})+
        field('Connection notes','notes',n.notes,{type:'textarea',max:4000})+primary('Save connection'))+
        (evidence?`<section class="evidence"><h3>Sources</h3><ul>${evidence}</ul></section>`:''));
    },
    'sol-person':async(b)=>{
      const data=await latest(),p=b.dataset.key?data.people.find((v)=>v.key===b.dataset.key):{};
      if(!p) throw new Error('This contact has changed. Reopen the client group.');
      showDialog(p.key?'Edit client contact':'Add client contact',form('sol-person',hidden('version',p.version||0)+hidden('key',p.key||'')+
        field('First name','first_name',p.first_name,{max:100})+field('Last name','last_name',p.last_name,{max:100})+
        field('Email','email',p.email,{type:'email',max:254})+field('Phone number','phone',p.phone,{type:'tel',max:70})+
        field('Title','title',p.title,{max:150})+select('Function','department',departments.map((id)=>({id,name:id})),p.department||'Other')+
        field('Contact notes','notes',p.notes,{type:'textarea',max:2500})+primary('Save contact')));
    },
    'sol-note':()=>showDialog('Add client note',form('sol-note',hidden('source_key',crypto.randomUUID())+field('Working note','body','',{type:'textarea',required:true,max:8000})+
      '<p class="muted">Existing names link to their map cards. For new connections, use a line like <b>Target: Harbor Kitchens | Morgan Lee</b> or <b>Partner: Channel Collective</b>, or enter a name below.</p><details class="ws-fold"><summary>Link or create an introduction target</summary>'+field('Target company','company','',{max:180})+field('Target person','person','',{max:150})+
      select('Map branch','category',choices(groups),'priority')+'</details>'+primary('Save note'))),
    'sol-claude':async()=>{
      const data=await latest();
      const brief=`Work with me on ${data.client.name} (Branded client ID ${data.client.id}). Read get_client_workspace for the relationship map, working notes and client group, and get_client_project for this month’s delivery milestones. Read the latest get_onboarding_submission and relevant files. Check priority targets and strategic channels against the sources I can access. Show evidence and a suggested next action. Use save_introduction_research for new research and save_client_note for new notes with a stable source key. Preserve staff relationship assessments.`;
showDialog('Work with Claude',`<div class="stack"><p>Open Claude with your Branded connection and paste the client brief. Working notes and research saved through that connection appear on ${h(data.client.name)}’s record.</p>
        <label class="field"><span>Client brief</span><textarea id="claude-client-brief" readonly rows="5">${h(brief)}</textarea></label>
        <div class="actions">${action('Copy client brief','sol-copy-brief','','copy')}<a class="button primary" target="_blank" rel="noopener" href="https://claude.ai/">Open Claude</a></div>
        <a class="text-link" href="/api/skills/branded-introductions" target="_blank" rel="noopener">Download introductions skill</a></div>`);
    },
    'sol-copy-brief':async()=>{
      const input=document.querySelector('#claude-client-brief');
      try { await navigator.clipboard.writeText(input.value); notify('Client brief copied.'); }
      catch { input.focus(); input.select(); notify('Client brief selected for copying.'); }
    },
    'sol-step':async(b)=>{
      const [p,owners]=await Promise.all([readProject(b.dataset.client,b.dataset.month),members(b.dataset.client)]);
      const key=b.dataset.step, v=p.steps[key] || {};
      showDialog(stepNames[key],form('sol-step',hidden('client',p.id)+hidden('step',key)+hidden('period',key==='monthly'?b.dataset.month:'')+hidden('version',v.version||0)+
        `<p>${h(p.name)}${key==='monthly'?' · '+h(b.dataset.month):''}</p>`+
        select('Status','status',choices(v.evidence?{done:'Done'}:milestoneStates),v.status||'pending')+select('Owner','owner_id',owners,v.owner_id||p.owner_id,'Unassigned')+
        field('Due date','due',v.due,{type:'date'})+field('Milestone notes','notes',v.notes,{type:'textarea',max:5000})+
        (v.evidence?`<small>Recorded delivery${v.completed_at?' · '+h(v.completed_at.slice(0,10)):''}</small>`:'')+primary('Save milestone')));
    },
    'sol-brief':async(b)=>{
      const p=await readProject(b.dataset.client);
      showDialog('Project brief',form('sol-brief',hidden('client',p.id)+hidden('version',p.version)+field('Growth goals','goals',p.goals,{type:'textarea',max:8000})+
        field('Agreed deliverables','deliverables',p.deliverables,{type:'textarea',max:8000})+primary('Save project brief')));
    },
    'sol-disposition':()=>{
      const available=board.deals.filter((d)=>!d.signed_at && !d.client_id);
      showDialog('Opportunity disposition',form('sol-disposition',select('Opportunity','deal',available.map((d)=>({id:d.id,name:d.company+' · '+d.title})))+
        select('Disposition','stage',[{id:'cold',name:'Nurture'},{id:'dead',name:'Closed lost'},{id:'outreach',name:'Resume outreach'}])+
        field('Revisit date','due','',{type:'date'})+field('Outcome','outcome','',{max:300})+primary('Save disposition')));
    },
  };
  const forms={};
  for(const [name,resource,method] of [['sol-connection','connections','PUT'],['sol-person','people','PUT'],['sol-note','notes','POST'],['sol-step','milestones','PUT'],['sol-brief','project','PUT']]){
    forms[name]=async(f,values)=>{
      const d=Object.fromEntries(values), client=d.client || currentClient();
      delete d.client;
      if('version' in d) d.version=Number(d.version);
      await api('/api/clients/'+client+'/'+resource,method,d);
      await saved({connections:'Connection saved.',people:'Contact saved.',notes:'Note saved.',milestones:'Milestone saved.',project:'Project brief saved.'}[resource]);
    };
  }
  forms['sol-profile']=async(f,values)=>{
    const d=Object.fromEntries(values);d.version=Number(d.version);d.onboarding_alerts=values.has('onboarding_alerts');
    await api('/api/profile','PATCH',d);setUser((await api('/api/session')).user);await render();notify('Profile saved.');
  };
  forms['sol-password']=async(f,v)=>{
    if(v.get('password')!==v.get('confirm')) throw new Error('The new passwords do not match.');
    await api('/api/profile/password','POST',{current:v.get('current'),password:v.get('password')});f.reset();notify('Password changed.');
  };
  forms['sol-disposition']=async(f,v)=>{
    const d=board.deals.find((r)=>r.id===v.get('deal'));
    await api('/api/engagements/'+d.id,'PATCH',{version:d.version,stage:v.get('stage'),details:{due:v.get('due'),outcome:v.get('outcome')}});
    await saved('Opportunity updated.');
  };
  return {actions,forms,page,client};
}
