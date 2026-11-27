import { bootstrap, finishSetup, inviteAccount } from './accounts.mjs';
import { insertClient, insertSubmission } from './clients.mjs';
import { appendActivity, insertCard, insertSuggestion, mcpSaveDraft } from './pipeline.mjs';
import { addItem, changeDeal, createDeal, setMembership } from './engagements.mjs';
import { createSource, ingestPitch } from './inquiries.mjs';
import { research } from './delivery.mjs';
import { saveClientNote, saveConnection } from './solution-clients.mjs';
import { saveStep, saveBrief } from './solution-projects.mjs';

export const demoEmail = 'demo@branded.example';
export const demoPassword = 'Local-Demo-Pipeline-24';
const days = (delta, hour = 14) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + delta);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

export async function loadDemo(store,config={origin:new URL('http://127.0.0.1:3000'),accountingEmail:'accounts@example.test',podcastOwner:demoEmail}) {
  const setup = bootstrap(store, 'Taylor Reed', demoEmail);
  const { user } = await finishSetup(store, setup.path.split('/').at(-1), demoPassword, 'demo');
  const { user: member } = inviteAccount(store, user, { name: 'Sam Rivera', email: 'sam@branded.example', role: 'member' });
  const job = { id: null, kind: 'claude', name: 'claude', all_clients: true };
  const data = store.tx(() => {
    const northline = insertClient(store, user, { name: 'Northline', member_ids: [member.id] }, days(-30));
    const grove = insertClient(store, user, { name: 'Grove Kitchen' }, days(-21));
    const records = [
      [northline, 'Rory Bennett', 'Harborbird Chicken', 'to_contact', 'Draft first outreach', 1, user.id],
      [northline, 'Morgan Ellis', 'BrightFork Burgers', 'reached_out', 'Send follow-up', -1, user.id],
      [northline, 'Riley Carter', 'Maple Row QSR', 'in_conversation', 'Confirm next steps', 2, user.id],
      [northline, 'Avery Kim', 'Pinecrest QSR', 'closed', '', null, user.id],
      [grove, 'Harper Hayes', 'Elm Street Eats', 'reached_out', 'Share partnership overview', -3, user.id],
      [northline, 'Jordan Park', 'Cedarline Restaurants', 'in_conversation', 'Confirm demo', 4, member.id],
      [grove, '', 'Rivermere BBQ', 'to_contact', 'Identify operations contact', null, user.id],
      [grove, 'Devon Miles', 'Oakridge Burgers', 'closed', '', null, user.id],
    ];
    const cards = records.map(([client, person, company, stage, next_step, due, owner_id], index) =>
      insertCard(store, user, { client_id: client.id, person, company, stage, next_step, owner_id,
        email: person ? `${person.split(' ')[0].toLowerCase()}@example.test` : '', due_at: due === null ? undefined : days(due),
        outcome: stage === 'closed' ? 'Meeting booked' : '' }, { createdAt: days(-24), enteredAt: days(-index - 2),
        reason: index < 3 ? 'Multiunit operator with a growing drive-thru footprint.' : '' }));
    appendActivity(store, job, cards[1], { kind: 'sent', subject: 'Introducing Northline', occurred_at: days(-5),
      mailbox_scope: 'demo', outlook_message_id: 'demo-outbound-01' });
    appendActivity(store, job, cards[2], { kind: 'reply', subject: 'Re: Partnership follow-up',
      body: 'Thanks for reaching out. I can talk next week.', occurred_at: days(-1), mailbox_scope: 'demo', outlook_message_id: 'demo-reply-01' });
    for (const [index, person, company, source, score, relationship] of [
      [1, 'Avery Lane', 'Summit Bun Co.', 'HubSpot', 91, 'Prior conversation'],
      [2, 'Casey Morgan', 'Cedarline Restaurants', 'Apollo', 86, 'Unknown'],
      [3, '', 'Meadow Grill Group', 'Outlook', 78, 'Known by the team'],
    ]) insertSuggestion(store, job, { client_id: northline.id, candidate_key: `demo:${index}`, person, company, source, score,
      fit: score > 80 ? 'Strong' : 'Moderate', branded_relationship: relationship,
      reason: 'The company has a growing multi-location footprint that fits the client’s ideal customer profile.',
      evidence: [{ source, detail: 'Example records describe an expanding restaurant group.' }] }, days(-1));
    insertSubmission(store, user, northline.id, { company: northline.name, contact_name: 'Jamie Example',
      contact_email: 'intake@example.test', icp: 'Multiunit quick service and fast casual brands with growing drive-thru footprints.',
      minimum_locations: 30, ideal_locations: 100, priority_targets: [{company:'Windward Tacos',contact:'Ari Cruz'},{company:'BrightFork Burgers',contact:'Morgan Ellis'}],
      partnerships:[{company:'Harbor Distribution',contact:'Drew Hayes',relationship:'Distribution partner in the Northeast'}],
      priorities:'Reach multiunit operators in the Northeast and find two distribution partners.',
      team:[{first_name:'Jamie',last_name:'Example',department:'Leadership',title:'Founder',email:'intake@example.test'},
        {first_name:'Lee',last_name:'Wells',department:'Partnerships',title:'Head of partnerships',email:'lee@northline.example',phone:'212-555-0141',notes:'Coordinates operator introductions.'}],
      current_integrations: 'Major restaurant POS systems' }, { submittedAt: days(-2) });
    return { user, cards };
  });
  mcpSaveDraft(store, job, { card_id: data.cards[1].id, followup_id: data.cards[1].followup_id,
    subject: 'Following up on Northline', body: 'Hi Morgan,\n\nI’m following up on my note about Northline. Would you be open to a quick conversation next week?\n\nThanks,\nTaylor' });
  setMembership(store,user,member.id,{workspaces:['solutions','media']});
  const future=days(3).slice(0,10),due=days(-1).slice(0,10);
  for(const [line,company,title,stage,details] of [
    ['solutions','Cinder Hospitality','Operator introductions','first_engagement',{contact:'Ellis Reed',next_action:'Meet the operating team',due:future,monthly:550000}],
    ['solutions','Kite Kitchen','Market entry advisory','outreach',{contact:'Casey Park',next_action:'Confirm priority markets',due}],
    ['solutions','Marrow Market','Strategic collaboration','agreement_sent',{monthly:350000,term:'Six months',next_action:'Review returned SCA'}],
    ['solutions','Harbor Table','Advisory retainer','signed',{monthly:450000,term:'Six months',billing_email:'ap@example.test',report_email:'team@example.test',agreement_url:'https://example.test/executed-sca'}],
    ['media','Meridian Creative','Hospitality brand series','pitch',{campaign:'Hospitality partners',agency:'Meridian Creative',parent_agency:'Elm Collective',advertiser:'Beacon Air',contact:'Alex Rowe',contact_email:'alex@example.test',next_action:'Send sponsorship deck',due}],
    ['media','Palisade Foods','Newsletter placement','outreach',{campaign:'Hospitality partners',next_action:'Confirm advertiser contact',due:future}],
    ['media','Marrow Market','Event sponsorship','discussion',{campaign:'Live events',project_fee:2000000,next_action:'Review venue availability'}],
    ['media','Harbor Table','Four-episode sponsorship','signed',{project_fee:1250000,package:'Four podcast episodes and two newsletter placements',billing_email:'ap@example.test',agreement_url:'https://example.test/media-contract'}],
    ['media','Blue Elm','Seasonal partnership','cold',{due:days(180).slice(0,10),next_action:'Reconnect for the next campaign'}],
    ['capital','Ridgeway Foods','Growth round','discussion',{target:300000000,next_action:'Review investor materials',due:future}],
    ['capital','Harbor Table','Expansion financing','signed',{target:500000000,raised:100000000,monthly:600000,fee_percent:3,term:'Six months',billing_email:'ap@example.test',agreement_url:'https://example.test/mandate'}],
  ]) {
    const d=createDeal(store,user,line,{company,title,details});
    if(stage!=='outreach')changeDeal(store,user,d.id,{version:1,stage},config);
    if(line==='media' && stage==='pitch'){
      for(const [kind,summary] of [['sent','Shared initial program overview'],['reply','Sponsor requested the deck'],['meeting','Discussed the advertiser’s timing']])
        addItem(store,user,d.id,{kind,title:summary,status:'done'},days(-2));
    }
    if(line==='media'&&stage==='signed')addItem(store,user,d.id,{kind:'deliverable',title:'Produce first sponsored episode',status:'planned',due:future});
  }
  const client=data.cards[0].client_id;
saveBrief(store,user,client,{version:0,goals:'Reach multiunit operators in the Northeast and find two distribution partners.',deliverables:'A prioritized introduction list, partner outreach and a weekly activity report.'});
  for(const [step,status] of [['goals','done'],['deliverables','done'],['kickoff','done'],['icp','working'],['follow_1','waiting']])
    saveStep(store,user,{client_id:client,step,status,version:0,owner_id:user.id,due:step==='follow_1'?future:''});
  for(const [company,person,category,health,stage,next_action] of [
    ['Windward Tacos','Ari Cruz','priority','green','planning','Confirm the right operator introduction.'],
    ['BrightFork Burgers','Morgan Ellis','priority','yellow','contacted','Follow up on the proposed meeting.'],
    ['Harbor Distribution','Drew Hayes','strategic','red','followup','Reconfirm the regional partnership owner.'],
  ]) saveConnection(store,user,{client_id:client,company,person,category,health,stage,next_action,version:0,owner_id:user.id});
  saveClientNote(store,user,{client_id:client,source_key:'demo-kickoff',body:'Northline confirmed Windward Tacos as its first priority. Harbor Distribution is reviewing a change in ownership.'});
  research(store,user,{client_id:client,person:'Avery Lane',company:'Summit Bun Co.',candidate_key:'demo:1',source:'HubSpot',score:91,
    fit:'Strong',reason:'Growing multi-location operator in the client’s target segment.',branded_relationship:'Prior conversation with the operator.',
    evidence:[{source:'HubSpot',detail:'Illustrative relationship note from the team.'}],tier:'introduce',next_action:'Ask the relationship owner for a warm introduction.'});
  addItem(store,user,client,{kind:'newsletter',title:'Featured the client in the operator newsletter',status:'done',audience:'client'},days(-1));
  createSource(store,user,{line:'media',label:'Sponsorship inquiries',owner_id:user.id});
  ingestPitch(store,{thread:'demo-guest-idea',sender:'guest@example.test',subject:'Guest idea for Hospitality Hangout',body:'A restaurant operator would like to discuss opening a second location.',confirmed:true},config);
  return data;
}
