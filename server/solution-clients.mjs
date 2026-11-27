import { AppError, actorName, audit, canAccessClient, clientFor, decode, digest, id, iso } from './store.mjs';
import { choice, email, int, object, str, validate } from './validation.mjs';
import { day } from './engagements.mjs';
import { departments, groups, healthStates, relationshipStages } from '../public/solution-model.mjs';

const clean = (value = '') => value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
const nodeKey = (company, person) => digest(JSON.stringify([clean(company), clean(person)]));
const text = (length) => str(length, 0);
const revision = int(0, 2147483647);
const category = choice(...Object.keys(groups));

export const noteSchema = object({
  client_id: str(80), body: str(8000), source_key: str(420), company: text(180), person: text(150), category,
}, ['client_id','body','source_key']);

export function saveClientNote(s, a, input) {
  const d = validate(noteSchema, input);
  clientFor(s, a, d.client_id);
  return s.tx(() => {
    const existing = s.get('SELECT id FROM client_notes WHERE client_id=? AND source_key=?', d.client_id, d.source_key);
    if (existing) return existing;
    const key = id();
    s.run('INSERT INTO client_notes VALUES(?,?,?,?,?,?,?,?,?)', key, d.client_id, d.body, actorName(a), iso(),
      d.company || '', d.person || '', d.category || 'other', d.source_key);
    audit(s, a, 'client.note_added', 'client_note', key, d.client_id);
    return {id:key};
  });
}

function mergeConnection(nodes, source, record) {
  const company = record.company?.trim() || '', person = record.person?.trim() || '';
  if (!company && !person) return;
  const key = nodeKey(company, person);
  let node = nodes.get(key);
  if (!node) {
    node = {key,company,person,category:'other',health:'unrated',stage:'identified',next_action:'',due:'',owner_id:null,notes:'',version:0,sources:[]};
    nodes.set(key, node);
  }
  if (record.category && (node.category === 'other' || record.category === 'priority')) node.category = record.category;
  if (source.at && (!node.added_at || source.at<node.added_at)) node.added_at=source.at;
  if (record.stage) node.stage = record.stage;
  for (const field of ['next_action','owner_id','due','card_id','suggestion_id']) if (record[field]) node[field] = record[field];
  if (!node.sources.some((row) => row.type === source.type && row.id === source.id && row.detail === source.detail)) node.sources.push(source);
}

function intakeRows(s, client) {
const submissions=s.all('SELECT id,version,answers,submitted_at FROM submissions WHERE client_id=? ORDER BY version DESC',client)
    .map(row=>({...row,answers:decode(row.answers)}));
  const lists=s.all(`SELECT f.id,f.name,f.purpose,f.created_at,l.rows FROM attachments f JOIN attachment_lists l ON l.file_id=f.id
    LEFT JOIN engagements e ON e.id=f.engagement_id
    WHERE (f.client_id=? AND f.submission_id IS NOT NULL) OR e.client_id=? ORDER BY f.created_at DESC,f.id`,client,client)
    .map(row=>({id:row.id,file:row.name,submitted_at:row.created_at,answers:{[row.purpose]:decode(row.rows)}}));
  return [...submissions,...lists];
}

function relationshipMap(s, client, intakes, notes) {
  const nodes = new Map();
  for (const intake of intakes) {
    for (const [field, group] of [['priority_targets','priority'],['partnerships','strategic']]) {
      for (const item of intake.answers[field] || []) {
        mergeConnection(nodes, {type:intake.file?'file':'intake', id:intake.id, at:intake.submitted_at, label:intake.file || 'Intake '+intake.version,
          detail:[item.relationship,item.notes].filter(Boolean).join(' · '), link:item.link || ''},
        {company:item.company,person:item.contact,category:group});
      }
    }
  }
  for (const item of s.all('SELECT s.*,r.tier,r.next_action FROM suggestions s LEFT JOIN introduction_research r ON r.suggestion_id=s.id WHERE s.client_id=? AND s.status<>?', client, 'dismissed')) {
    const evidence = decode(item.evidence).map((row) => row.detail).filter(Boolean).join(' · ');
    mergeConnection(nodes, {type:'research',id:item.id,at:item.created_at,label:item.source || 'Research',detail:[item.reason,evidence].filter(Boolean).join(' · ')},
      {...item, suggestion_id:item.id});
  }
  const progress = {to_contact:'planning',reached_out:'contacted',in_conversation:'followup',closed:'closed'};
  for (const card of s.all("SELECT p.*,EXISTS(SELECT 1 FROM activity x WHERE x.card_id=p.id AND x.kind='introduction') introduced FROM cards p WHERE p.client_id=?", client)) {
    mergeConnection(nodes, {type:'card',id:card.id,at:card.created_at,label:'Introduction activity',detail:card.outcome || card.fit_reason},
      {...card,stage:card.introduced && card.stage!=='closed'?'introduced':progress[card.stage],next_action:card.next_step,due:card.due_at?.slice(0,10),card_id:card.id});
  }
for (const note of notes) {
    const source={type:'note',id:note.id,at:note.created_at,label:note.author+' · Note',detail:note.body};
    if (note.company || note.person) mergeConnection(nodes,source,note);
    for (const line of note.body.split(/\r?\n/)) {
      const match=/^\s*(?:[-*]\s*)?(target|partner|channel|introduction)\s*:\s*([^|]+?)(?:\s*\|\s*(.+))?\s*$/i.exec(line);
      if (!match || match[2].length>180 || (match[3]?.length||0)>150) continue;
      const type=match[1].toLowerCase();
      mergeConnection(nodes,source,{company:match[2],person:match[3],category:type==='target'?'priority':type==='introduction'?'other':'strategic'});
    }
  }
  for (const saved of s.all('SELECT * FROM client_connections WHERE client_id=?',client)) {
    const node = nodes.get(saved.node_key) || {key:saved.node_key,sources:[]};
    const added=[node.added_at,saved.added_at].filter(Boolean).sort()[0] || '';
    Object.assign(node,saved,{added_at:added});
    nodes.set(node.key,node);
  }
const byCompany=new Map();
  for (const node of nodes.values()) {
    if (!node.company || !node.person) continue;
    const key=clean(node.company);
    const people=byCompany.get(key) || [];
    people.push(node);
    byCompany.set(key,people);
  }
  for (const node of nodes.values()) {
    if (node.person || node.version || node.card_id || node.suggestion_id) continue;
    const matches=byCompany.get(clean(node.company));
    if (matches?.length!==1) continue;
    const person=matches[0];
    for (const source of node.sources) mergeConnection(nodes,source,{company:person.company,person:person.person,category:person.version?person.category:node.category});
    nodes.delete(node.key);
  }
  const words = (v) => ' '+clean(v).replace(/[^\p{L}\p{N}]+/gu,' ').trim()+' ';
  for (const note of notes) {
    const body = words(note.body);
    for (const node of nodes.values()) {
      if (node.sources.some((x) => x.type==='note' && x.id===note.id)) continue;
      if ([node.company,node.person].some((v) => v && v.trim().length>=3 && body.includes(words(v))))
        node.sources.push({type:'note',id:note.id,at:note.created_at,label:note.author+' · Note',detail:note.body});
    }
  }
  return [...nodes.values()].sort((a,b) => (a.company || a.person).localeCompare(b.company || b.person) || a.person.localeCompare(b.person));
}

const personFields = {
  first_name:text(100), last_name:text(100), email:text(254), phone:text(70), title:text(150),
  department:choice(...departments), notes:text(2500),
};

function directory(s, client, intakes) {
  const people = new Map(), byName = new Map(), byEmail = new Map();
  function add(person, source, explicitKey) {
    const address = clean(person.email), name = clean([person.first_name,person.last_name].filter(Boolean).join(' '));
    if (!address && !name) return;
    const matched = byName.get(name);
    const sameName = matched && (!address || !people.get(matched)?.email || clean(people.get(matched).email)===address);
    const natural = digest(address || name);
    const key = explicitKey || byEmail.get(address) || (people.has(natural) && natural) || (sameName && matched) || natural;
    const previous = people.get(key) || {key,version:0,first_name:'',last_name:'',email:'',phone:'',title:'',department:'',notes:'',source};
    for (const field of Object.keys(personFields)) if (explicitKey || (!previous.version && !previous[field] && person[field])) previous[field] = person[field] || '';
    if (previous.department) previous.department=departments.find((d)=>clean(d)===clean(previous.department)) || 'Other';
    if (explicitKey) {previous.version = person.version; previous.source = source;}
    if (address) byEmail.set(address,key);
    if (name) byName.set(name,key);
    people.set(key,previous);
  }
  // Curated identities take precedence, including when a later intake changes the email.
  for (const row of s.all('SELECT * FROM client_people WHERE client_id=?',client)) add(row,'Client group',row.person_key);
  for (const intake of intakes) {
    for (const row of intake.answers.team || []) add(row,intake.file || 'Intake '+intake.version);
    const a=intake.answers;
    if (a.contact_name || a.contact_email) {
      const [first_name='',...tail]=(a.contact_name || '').trim().split(/\s+/);
      add({first_name,last_name:tail.join(' '),email:a.contact_email,phone:a.phone},'Intake '+intake.version);
    }
  }
  return [...people.values()].sort((a,b) => (a.last_name+' '+a.first_name).localeCompare(b.last_name+' '+b.first_name));
}

export function clientWorkspace(s, a, client) {
  const customer = clientFor(s,a,client);
  const intakes = intakeRows(s,client);
  const notes = s.all('SELECT id,body,author,created_at,company,person,category FROM client_notes WHERE client_id=? ORDER BY created_at DESC,id',client);
  return {client:customer, notes, connections:relationshipMap(s,client,intakes,notes), people:directory(s,client,intakes)};
}

export const connectionSchema = object({
  client_id:str(80), key:text(64), version:revision, company:text(180), person:text(150), category,
  health:choice(...Object.keys(healthStates)), stage:choice(...Object.keys(relationshipStages)), next_action:text(400),
  due:text(10), owner_id:text(80), notes:text(4000),
}, ['client_id','version','company','person','category','health','stage']);

export function saveConnection(s,a,input) {
  const d=validate(connectionSchema,input);
  clientFor(s,a,d.client_id);
  if (!d.company && !d.person) throw new AppError(400,'Enter a company or a person.');
  const key=nodeKey(d.company,d.person);
  if (d.key && d.key!==key) throw new AppError(400,'Use the original connection name.');
  if (d.due) day(d.due);
  if (d.owner_id && !canAccessClient(s,d.owner_id,d.client_id)) throw new AppError(400,'Choose a client team member.');
  return s.tx(() => {
    const old=s.get('SELECT version FROM client_connections WHERE client_id=? AND node_key=?',d.client_id,key);
    if ((old?.version || 0)!==d.version) throw new AppError(409,'This connection changed. Reopen it to see the latest version.');
    s.run(`INSERT INTO client_connections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(client_id,node_key) DO UPDATE SET
      category=excluded.category,health=excluded.health,stage=excluded.stage,next_action=excluded.next_action,due=excluded.due,
      owner_id=excluded.owner_id,notes=excluded.notes,version=excluded.version`,
      d.client_id,key,d.company,d.person,d.category,d.health,d.stage,d.next_action || '',d.due || '',d.owner_id || null,d.notes || '',d.version+1,iso());
    audit(s,a,'connection.saved','connection',key,d.client_id);
    return {key,version:d.version+1};
  });
}

export const contactSchema = object({client_id:str(80),key:text(64),version:revision,...personFields}, ['client_id','version','first_name','last_name']);
export function savePerson(s,a,input) {
  const d=validate(contactSchema,input);
  clientFor(s,a,d.client_id);
  if (!d.first_name && !d.last_name && !d.email) throw new AppError(400,'Enter a name or an email address.');
  if (d.email) d.email=email(d.email);
  return s.tx(() => {
    const people=directory(s,d.client_id,intakeRows(s,d.client_id));
    const existing=d.key ? people.find((row)=>row.key===d.key) : null;
    if (d.key && !existing) throw new AppError(404,'Contact not found.');
    const duplicate = d.email && people.find((row)=>row.email && clean(row.email)===clean(d.email) && row.key!==d.key);
    if (duplicate) throw new AppError(409,'This email already belongs to a contact in this client group.');
    const key=d.key || digest(clean(d.email || [d.first_name,d.last_name].filter(Boolean).join(' ')));
    if ((!d.key && people.some((row)=>row.key===key)) || (existing?.version || 0)!==d.version)
      throw new AppError(409,'Reopen the existing contact before saving changes.');
    s.run(`INSERT INTO client_people VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(client_id,person_key) DO UPDATE SET
      first_name=excluded.first_name,last_name=excluded.last_name,email=excluded.email,phone=excluded.phone,title=excluded.title,
      department=excluded.department,notes=excluded.notes,version=excluded.version`,
      d.client_id,key,d.first_name,d.last_name,d.email || '',d.phone || '', d.title || '',d.department || 'Other',d.notes || '',d.version+1);
    audit(s,a,'client.contact_saved','client_person',key,d.client_id);
    return {key,version:d.version+1};
  });
}
