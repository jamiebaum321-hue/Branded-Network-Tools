import { projectController } from './project-views.mjs';
import { btn, emptyState, field, formatDate, h, hidden, icon, initials, link, outboundLink, select } from './ui.mjs';
import { clientForm } from './views.mjs';
import { overview, profileView, reportsView, workView } from './workspace.mjs';
import { departments, groups, healthStates, relationshipStages } from './solution-model.mjs';

const choices = (values) => Object.entries(values).map(([id,name])=>({id,name}));
const primary = (label) => btn(label,{type:'submit',kind:'primary'});
const action = (label,name,attrs='',glyph='') => btn(label,{action:name,data:attrs,glyph});
const form = (name,body) => '<form class="stack" data-form="'+name+'">'+body+'</form>';
const panel = (name,body) => '<section class="panel stack"><h2>'+h(name)+'</h2>'+body+'</section>';
const clientUrl = (id,tab) => '/clients/'+encodeURIComponent(id)+(tab?'?tab='+tab:'');
const sourceLink = (client,source) => {
  if (source.type==='file') return `<a class="text-link" href="/api/files/${encodeURIComponent(source.id)}" target="_blank" rel="noopener">${h(source.label)}</a>`;
  if (source.type==='intake') return link(clientUrl(client)+'/submissions/'+encodeURIComponent(source.id),source.label,'intake');
  if (source.type==='research') return link('/pipeline/suggestions/'+encodeURIComponent(source.id),source.label,'shortlist');
  if (source.type==='card') return link('/pipeline/cards/'+encodeURIComponent(source.id),source.label,'network');
  return h(source.label);
};
function mapView(data,query) {
  const id=data.client.id,health=query.get('health')||'',sort=query.get('sort')||'latest',since=query.get('since')||'',until=query.get('until')||'';
  const visible=data.connections.filter(n=>{
    const date=n.added_at?.slice(0,10)||'';
    return (!health||n.health===health)&&(!since||date>=since)&&(!until||(date && date<=until));
  }).sort((a,b)=>sort==='name'?(a.company||a.person).localeCompare(b.company||b.person):
    (sort==='oldest'?1:-1)*(a.added_at||'').localeCompare(b.added_at||'')||a.key.localeCompare(b.key));
  const filtered=health||since||until||sort!=='latest';
  return `<div class="map-toolbar"><h2>Introduction map</h2><details class="map-filter"><summary>${icon('settings')}Filter${filtered?' · Active':''}</summary>
    <form class="stack" data-form="filter">${hidden('tab','map')}${select('Relationship health','health',choices(healthStates),health,'All connections')}
    ${select('Sort by','sort',[{id:'latest',name:'Latest added'},{id:'oldest',name:'Oldest added'},{id:'name',name:'Name A–Z'}],sort)}
    ${field('Added from','since',since,{type:'date'})}${field('Added through','until',until,{type:'date'})}<div class="actions">${primary('Apply filters')}${link(clientUrl(id,'map'),'Reset')}</div></form></details></div>
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

function notesView(feed,client,zone,detail,owners) {
  return `<div class="section-toolbar"><h2>Notes &amp; activity</h2></div>${detail?`<details class="panel feed-composer"><summary>Record activity</summary>${workView(detail,owners,zone,true)}</details>`:''}
    <div class="client-feed">${feed.items.map(item=>{
      const title=item.kind==='submission'?'Intake submitted · Version '+item.version:item.title;
      const glyph={submission:'intake',note:'draft',work:'flag',activity:'history',milestone:'check'}[item.kind];
      return `<article class="feed-entry"><span class="feed-icon">${icon(glyph)}</span><div><small>${h(item.author)} · <time datetime="${h(item.at)}">${h(formatDate(item.at,zone))}</time></small>
        <h3>${h(title)}</h3>${item.body?`<p class="multiline">${h(item.body)}</p>`:''}${item.detail?`<small>${h(item.detail)}</small>`:''}
        ${item.kind==='submission'?link('/clients/'+client+'/submissions/'+item.id,item.version>1?'View submission and changes':'View submission','history'):''}
        ${item.kind==='work'?action('Update outcome','ws-item',`data-id="${h(item.id)}"`):''}</div></article>`;
    }).join('')||emptyState('No notes or activity yet.')}</div>
    ${feed.next?link(clientUrl(client,'notes')+'&before='+encodeURIComponent(feed.next),'Older activity','down'):''}`;
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
  const projects=projectController({api,getUser,showDialog,render,navigate,notify});
  const currentClient=()=>location.pathname.split('/')[2];
  const close=()=>document.querySelector('#dialog').close();
  const latest=async()=>api('/api/clients/'+encodeURIComponent(currentClient())+'/workspace');
  const saved=async(message)=>{close();await render();notify(message);};
  const members=async(client)=>(await api('/api/clients/'+client)).owners;
  const readProject=(client,month)=>api('/api/clients/'+encodeURIComponent(client)+'/project'+(month?'?month='+encodeURIComponent(month):''));
  async function page(path,query) {
    if(path==='/profile') return profilePage(await api('/api/profile'),getUser());
    board=await api('/api/workspaces/solutions');
    return projects.page(query,board);
  }
  async function client(info,ctx,query,zone) {
    const c=info.client;
    const tabs={intake:'Client intake',map:'Introduction map',people:'Client group',notes:'Notes & activity',reports:'Weekly updates',account:'Engagement'};
    const requested=query.get('tab'),tab=['activity','history'].includes(requested)?'notes':Object.hasOwn(tabs,requested)?requested:'intake';
    const [data,detail,feed]=await Promise.all([
      ['map','people'].includes(tab)?api('/api/clients/'+c.id+'/workspace'):null,
      info.engagement_id?api('/api/engagements/'+info.engagement_id):null,
      tab==='notes'?api('/api/clients/'+c.id+'/timeline'+(query.get('before')?'?before='+encodeURIComponent(query.get('before')):'')):null,
    ]);
    const owners=info.owners || ctx.owners,logo=detail?.files.find(file=>file.purpose==='logo' && file.mime?.startsWith('image/'));
    const views={
      map:()=>mapView(data,query),people:()=>peopleView(data),notes:()=>notesView(feed,c.id,zone,detail,owners),
      intake:()=>`${detail?profileView(detail):emptyState('Awaiting client intake.')}
        <details class="panel intake-options"><summary>Intake options</summary><div class="actions">${action('Copy intake link','form-link',`data-id="${h(c.id)}"`,'link')}
        ${info.link?action('Revoke active link','revoke-form',`data-id="${h(c.id)}"`,'lock'):''}</div></details>`,
      reports:()=>detail?reportsView(detail,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())):'',
      account:()=>`${detail?`<div class="actions">${action('Edit engagement','ws-edit','','edit')}${!detail.deal.signed_at?action('Record existing agreement','ws-history'):''}</div>${overview(detail,owners,getUser(),zone)}`:''}
        ${getUser().role==='admin'?panel('Client access',clientForm(ctx,info)):''}`,
    };
    return `<section data-engagement-context="${h(info.engagement_id||'')}">${link('/clients','All clients','back','back-link')}
      <header class="section-title client-head"><div class="client-identity">${logo?`<img src="/api/files/${h(logo.id)}?preview=1" alt="${h(c.name)} logo">`:`<span class="client-monogram">${h(initials(c.name))}</span>`}<div><h1>${h(c.name)}</h1><p>Solutions client · ${h(c.owner_name)}</p></div></div>
      <div class="actions">${action('Add connection','sol-connection','','plus')}${action('Add note','sol-note','','draft')}</div></header>
      <nav class="client-tabs" aria-label="Client sections">${Object.entries(tabs).map(([id,label])=>`<a href="${clientUrl(c.id,id)}"${id===tab?' aria-current="page"':''}>${label}</a>`).join('')}</nav>${views[tab]()}</section>`;
  }

  const actions={
    ...projects.actions,
    'sol-connection':async(b)=>{
      const data=await latest(), c=data.client.id, n=b.dataset.key?data.connections.find((v)=>v.key===b.dataset.key):{};
      if(!n) throw new Error('This connection has changed. Refresh the map.');
      const who=await members(c);
      const identity=n.key?hidden('key',n.key)+hidden('company',n.company)+hidden('person',n.person)+`<h3>${h([n.company,n.person].filter(Boolean).join(' · '))}</h3>${n.added_at?`<small>Added ${h(formatDate(n.added_at,getZone()))}</small>`:''}`:
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
  const forms={...projects.forms};
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
