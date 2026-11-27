export const projectPhases = [
  {name:'Onboarding', steps:[
    ['intake', 'Intake received'], ['goals', 'Growth goals agreed'], ['deliverables', 'Deliverables agreed'], ['kickoff', 'Kickoff email sent'],
  ]},
  {name:'Outreach and reporting', steps:[
    ['icp', 'Initial contact sent to ICPs'], ['report', 'First report delivered'],
  ]},
  {name:'Client follow-ups', steps:[
    ['follow_1', 'First follow-up'], ['follow_2', 'Second follow-up'], ['follow_3', 'Third follow-up'],
    ['follow_4', 'Fourth follow-up'], ['follow_5', 'Fifth follow-up'], ['monthly', 'Monthly follow-up'],
  ]},
];
export const stepNames = Object.fromEntries(projectPhases.flatMap((phase) => phase.steps));
export const milestoneStates = { pending:'Not started', working:'In progress', waiting:'Waiting', done:'Done' };
export const groups = {priority:'Priority targets', strategic:'Strategic and channel partners', other:'Other introductions'};
export const healthStates = {unrated:'Unrated', green:'Strong', yellow:'Developing', red:'At risk'};
export const relationshipStages = {identified:'Identified', planning:'Planning introduction', contacted:'Contacted', introduced:'Introduced', followup:'Following up', closed:'Closed'};
export const departments = ['Leadership','Sales','Business development','Marketing','Partnerships','Other'];
export const projectIcons={
  'desk-bell':'Service bell','field-notes':'Notebook','room-key':'Room key','correspondence':'Envelopes',
  'target':'Target','team':'Team','network':'Connections','flag':'Flag','clock':'Clock','board':'Board','draft':'Document','building':'Building',
};
export const fileLimitMiB = 25;
