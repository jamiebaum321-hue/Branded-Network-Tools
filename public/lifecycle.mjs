// Shared by the server and the browser. Keep this file free of DOM and Node APIs.

export const clientStages = [
  { id: 'prospect', label: 'Prospect', phase: 'sales', tone: 'neutral', hint: 'Identified, not yet in conversation.' },
  { id: 'discovery', label: 'Discovery', phase: 'sales', tone: 'blue', hint: 'Learning their goals and fit.' },
  { id: 'proposal', label: 'Proposal', phase: 'sales', tone: 'violet', hint: 'Proposal or pricing shared.' },
  { id: 'contract', label: 'Contract', phase: 'sales', tone: 'amber', hint: 'Agreement out for signature.' },
  { id: 'won', label: 'Won', phase: 'sales', tone: 'green', hint: 'Signed. Ready to start onboarding.' },
  { id: 'onboarding', label: 'Onboarding', phase: 'delivery', tone: 'blue', hint: 'Waiting on the onboarding form.' },
  { id: 'matching', label: 'ICP matching', phase: 'delivery', tone: 'violet', hint: 'Profile ready. Finding who to introduce.' },
  { id: 'delivering', label: 'Delivering', phase: 'delivery', tone: 'green', hint: 'Introductions and reporting under way.' },
  { id: 'lost', label: 'Lost', phase: 'closed', tone: 'red', hint: 'Did not become a client.' },
  { id: 'churned', label: 'Ended', phase: 'closed', tone: 'neutral', hint: 'Engagement has ended.' },
];
export const stageIds = clientStages.map(stage => stage.id);
export const stageInfo = Object.fromEntries(clientStages.map(stage => [stage.id, stage]));
export const journey = clientStages.filter(stage => stage.phase !== 'closed').map(stage => stage.id);
export const phaseStages = phase => clientStages.filter(stage => stage.phase === phase).map(stage => stage.id);
export const phases = { sales: 'Opportunities', delivery: 'Clients', closed: 'Closed' };

export const metricLabels = {
  impressions: 'Impressions', likes: 'Likes', comments: 'Comments', shares: 'Shares', clicks: 'Clicks',
  listeners: 'Listeners', recipients: 'Recipients', opens: 'Opens', attendees: 'Attendees',
};
export const metricKeys = Object.keys(metricLabels);

// Each kind is one section of the monthly client report.
export const reportKinds = [
  { id: 'introduction', label: 'Introductions', one: 'Introduction', glyph: 'handshake', metrics: [],
    title: 'Who was introduced', contact: 'Introduced to', hint: 'A person or company you connected the client with.' },
  { id: 'meeting', label: 'Meetings', one: 'Meeting', glyph: 'calendar', metrics: ['attendees'],
    title: 'Meeting', contact: 'With', hint: 'A call or meeting held on the client’s behalf.' },
  { id: 'social', label: 'Social posts', one: 'Social post', glyph: 'megaphone', metrics: ['impressions', 'likes', 'comments', 'shares', 'clicks'],
    title: 'Post', contact: 'Tagged or mentioned', channel: 'Platform', hint: 'A post that mentioned or featured the client.' },
  { id: 'podcast', label: 'Podcast & video', one: 'Podcast or video', glyph: 'mic', metrics: ['listeners'],
    title: 'Episode', contact: 'Guest or mention', channel: 'Show', hint: 'An episode where the client appeared or was discussed.' },
  { id: 'newsletter', label: 'Newsletters', one: 'Newsletter', glyph: 'mail', metrics: ['recipients', 'opens', 'clicks'],
    title: 'Issue', channel: 'Newsletter', hint: 'A newsletter that featured the client.' },
  { id: 'email', label: 'Emails', one: 'Email', glyph: 'send', metrics: [],
    title: 'Subject', contact: 'To or from', hint: 'Correspondence about the client that is not logged on a pipeline card.' },
  { id: 'event', label: 'Events', one: 'Event', glyph: 'ticket', metrics: ['attendees'],
    title: 'Event', contact: 'People met', channel: 'Location', hint: 'A trade show, dinner or panel where the client was represented.' },
  { id: 'press', label: 'Press & mentions', one: 'Press mention', glyph: 'news', metrics: ['impressions'],
    title: 'Headline', channel: 'Outlet', hint: 'Coverage or a third-party mention.' },
  { id: 'other', label: 'Other work', one: 'Other', glyph: 'spark', metrics: [],
    title: 'What was done', hint: 'Anything else done for the client this month.' },
];
export const reportKindIds = reportKinds.map(kind => kind.id);
export const reportKind = Object.fromEntries(reportKinds.map(kind => [kind.id, kind]));

export const isPeriod = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? '');
export function shiftPeriod(period, months) {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
export const periodLabel = period => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${period}-01T00:00:00Z`));

export function matchPrompt(client) {
  return `Find introduction matches for our client ${client.name} using the Branded Network connector.

1. Call get_matching_brief with client_id "${client.id}". It returns their ideal customer profile, who to exclude, and everyone already matched.
2. Search my HubSpot, my inbox and sent mail, and my Teams chats for companies and people who fit that profile. Skip anyone the brief says to exclude.
3. Save the best fits with save_matches. For each one include the company, the person and title if known, why they fit, where you found them, how we know them, and a 0–100 score.

When you finish, tell me how many you saved and list anyone you were unsure about.`;
}

export function reportPrompt(client, period) {
  return `Help me build the ${periodLabel(period)} report for our client ${client.name} using the Branded Network connector.

1. Call get_monthly_report with client_id "${client.id}" and period "${period}" to see what is already logged.
2. Look through my social posts, podcast episodes, newsletters, calendar and email for ${periodLabel(period)} and find everything that mentioned or helped ${client.name}.
3. Save each item with add_report_entry, including its date, link and numbers (impressions, likes, comments, shares, listeners). Use a stable source_key so nothing is added twice.

When you finish, summarize what you added and what you could not find numbers for.`;
}
