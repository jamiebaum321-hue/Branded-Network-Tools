const prospectStages = [
  'outreach',
  'discovery',
  'first_engagement',
  'second_engagement',
  'first_meeting_scheduled',
  'discussion',
];

export const lines = {
  solutions: {
    name: 'Solutions',
    noun: 'Advisory engagements',
    live: ['outreach', 'discovery', 'first_engagement', 'second_engagement', 'agreement_sent'],
    delivery: ['signed', 'onboarding', 'active', 'complete'],
  },
  media: {
    name: 'Media',
    noun: 'Campaigns and sponsorships',
    live: [...prospectStages, 'pitch', 'agreement_sent'],
    delivery: ['signed', 'production', 'complete'],
  },
  capital: {
    name: 'Capital',
    noun: 'Fundraising engagements',
    live: [...prospectStages, 'mandate_sent'],
    delivery: ['signed', 'raising', 'complete'],
  },
};
export const salesStages = [...new Set(Object.values(lines).flatMap((line) => line.live))];
export const stages = {
  outreach: 'Outreach',
  discovery: 'Discovery',
  first_engagement: 'First engagement',
  second_engagement: 'Second engagement',
  first_meeting_scheduled: 'First meeting scheduled',
  discussion: 'In discussion',
  pitch: 'Pitch requested',
  agreement_sent: 'Agreement sent',
  mandate_sent: 'Mandate sent',
  signed: 'Signed',
  onboarding: 'Onboarding',
  active: 'Active advisory',
  production: 'In production',
  raising: 'Raising capital',
  complete: 'Completed',
  cold: 'Cold / nurture',
  dead: 'Closed lost',
};
export const tiers = {
  introduce: 'Introduce now',
  reengage: 'Reconnect first',
  develop: 'Build a relationship',
};
export const kinds = {
  introduction: 'Introduction',
  meeting: 'Meeting',
  sent: 'Email sent',
  reply: 'Reply received',
  newsletter: 'Newsletter',
  social: 'Social coverage',
  deliverable: 'Deliverable',
  note: 'Note',
  task: 'Task',
};
export const statuses = { planned: 'Planned', waiting: 'Awaiting reply', done: 'Done' };
export const billingStates = { pending: 'Pending', set_up: 'Set up in accounting', invoiced: 'Invoiced', paid: 'Paid' };
export const money = (cents) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(
    (cents || 0) / 100
  );
export const labels = {
  contact: 'Contact name',
  pipeline_note: 'Pipeline note',
  contact_email: 'Contact email',
  campaign: 'Campaign',
  agency: 'Agency',
  parent_agency: 'Parent agency',
  advertiser: 'Advertiser',
  source: 'Source',
  source_url: 'Source link',
  next_action: 'Next action',
  due: 'Follow-up date',
  first_meeting_day: 'First meeting date',
  term: 'Engagement term',
  fee_terms: 'Referral or success-fee terms',
  billing_name: 'Invoice recipient',
  billing_email: 'Accounts payable email',
  billing_terms: 'Billing terms',
  agreement_url: 'Agreement link',
  package: 'Promised deliverables',
  outcome: 'Outcome',
  report_email: 'Weekly report recipient',
  monthly: 'Monthly retainer',
  deal_value: 'Total contract value',
  project_fee: 'Project fee',
  target: 'Raise target',
  raised: 'Capital raised',
  fee_percent: 'Success fee (%)',
  open_signal: 'Email open signal',
  research_sources: 'Target research sources',
  billing_contacts: 'Additional accounts payable contacts',
  billing_state: 'Invoice setup',
  invoice_ref: 'Invoice or QuickBooks reference',
};
