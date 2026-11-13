// Shared by the server and the browser: the Solutions tracker's account and introduction vocabularies.
export const clientStages = {
  current: { label: 'Current Client', tone: 'green', note: 'Paying' },
  referral: { label: 'Referral Partner', tone: 'violet', note: 'Not paying' },
  pipeline: { label: 'Pipeline', tone: 'blue', note: 'In discussion' },
  passed: { label: 'Passed', tone: 'neutral', note: 'Not moving forward' },
};

export const dealStatuses = ['Active – Paying', 'Referral – Agreement Pending', 'Active – Agreement Pending', 'SCA Sent',
  'Negotiating Terms', 'Follow-Up Needed', 'Early Conversations', 'On Hold', 'Passed'];

export const agreementStatuses = ['Signed', 'Partially Signed', 'Sent for Signature', 'Draft', 'Not Started', 'Missing – Need Copy'];

// Each introduction status implies a pipeline stage; closed statuses double as the closure outcome.
export const introStatuses = {
  'To Introduce': 'to_contact',
  'Intro Requested': 'to_contact',
  'Intro Sent': 'reached_out',
  'Awaiting Response': 'reached_out',
  'Follow-Up Needed': 'reached_out',
  'Client Following Up': 'in_conversation',
  'Meeting Scheduled': 'in_conversation',
  'In Discussion': 'in_conversation',
  Won: 'closed',
  'Not Interested': 'closed',
  'Went Cold': 'closed',
  'Declined / Not a Fit': 'closed',
};

// An open introduction with no touch for this many days needs a follow-up.
export const staleIntroDays = 14;
export const contractWarningDays = { act: 30, soon: 60 };
