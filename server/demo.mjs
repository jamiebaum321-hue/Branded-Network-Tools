import { bootstrap, finishSetup, inviteAccount } from './accounts.mjs';
import { insertClient, insertSubmission } from './clients.mjs';
import { timeline } from './lifecycle.mjs';
import { appendActivity, insertCard, insertSuggestion, mcpSaveDraft, updateCard } from './pipeline.mjs';
import { addEntry, saveSummary } from './reports.mjs';
import { localDate } from './dashboard.mjs';

export const demoEmail = 'demo@branded.example';
export const demoPassword = 'Local-Demo-Pipeline-24';
const days = (delta, hour = 14) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + delta);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

const northlineProfile = {
  company: 'Northline', website: 'https://northline.example', headquarters: 'Austin, Texas', company_size: '51–200',
  contact_name: 'Jamie Example', contact_title: 'VP Partnerships', contact_email: 'intake@example.test', phone: '555 0100',
  executive_sponsor: 'Dana Whitfield, Chief Revenue Officer',
  pitch: 'Northline gives drive-thru brands live speed-of-service data, so operators cut wait times and lift throughput.',
  category: ['Data & analytics', 'Kitchen equipment & automation'],
  product: 'Drive-thru timing sensors and the Northline operations dashboard.',
  differentiators: 'Installs in a day, works with any POS, and benchmarks every store against the brand average.',
  proof_points: 'Example customers report 22 seconds faster average service time within 90 days.',
  pricing: 'Per-location subscription. Typical first deal covers 40 locations.', sales_cycle: '60–90 days',
  competitors: [{ company: 'Example Timer Co.', notes: 'Hardware only, no benchmarking.' }],
  icp: 'Multiunit quick service and fast casual brands with growing drive-thru footprints.',
  segments: ['Quick service (QSR)', 'Fast casual', 'Coffee & bakery'], ownership: ['Corporate-owned', 'Franchisee groups'],
  geography: 'United States, strongest in the South and Midwest', minimum_locations: 30, ideal_locations: 100,
  footprint: 'At least half of locations have a drive-thru.',
  tech_requirements: 'Any major restaurant POS. Open to adding hardware at the lane.',
  buying_triggers: 'New operations leadership, a remodel program, or a public speed-of-service goal.',
  disqualifiers: 'Single-location operators and brands without drive-thru.',
  personas: [{ title: 'VP Operations', department: 'Operations', role: 'Decision maker' },
    { title: 'Director of Technology', department: 'IT', role: 'Influencer' }],
  buyer_notes: 'Throughput at peak, labor per car, and consistent guest experience across franchisees.',
  qualified_intro: 'An operations or technology leader at a brand with 30 or more drive-thru locations who agrees to a 30-minute call.',
  current_customers: [{ company: 'Pinecrest QSR' }], priority_targets: [{ company: 'Windward Tacos', notes: 'Top of the list for this year.' }],
  sales_pipeline: [{ company: 'Lakeshore Coffee', status: 'Proposal out' }], exclusions: 'Do not contact Example Timer Co. customers.',
  current_integrations: 'Major restaurant POS systems', desired_integrations: 'Labor scheduling platforms',
  goals: 'Ten qualified conversations with multiunit drive-thru operators in the first six months.', intro_target: 4,
  success_metrics: 'Qualified meetings held and pipeline created.',
  key_messages: 'Speed is the new loyalty. You cannot fix what you cannot see.',
  topics: 'Drive-thru operations, franchisee benchmarking, operations data.',
  spokespeople: [{ name: 'Dana Whitfield', title: 'Chief Revenue Officer', topics: 'Operations data, franchise growth' }],
  assets: [{ label: 'One-page overview', link: 'https://northline.example/overview' }], linkedin: 'https://linkedin.example/company/northline',
  team: [{ first_name: 'Jamie', last_name: 'Example', email: 'intake@example.test', title: 'VP Partnerships' }],
  intro_method: 'Email introduction', report_recipients: 'Jamie Example and Dana Whitfield',
};

export async function loadDemo(store, zone = 'America/New_York') {
  const setup = bootstrap(store, 'Taylor Reed', demoEmail);
  const { user } = await finishSetup(store, setup.path.split('/').at(-1), demoPassword, 'demo');
  const { user: member } = inviteAccount(store, user, { name: 'Sam Rivera', email: 'sam@branded.example', role: 'member' });
  const job = { id: null, kind: 'claude', name: 'claude', all_clients: true };
  const day = delta => localDate(new Date(days(delta)), zone);
  const month = day(0).slice(0, 7);
  // Report entries for the demo stay inside the current month so the report always has content.
  const thisMonth = offset => `${month}-${String(Math.max(1, Number(day(0).slice(8)) - offset)).padStart(2, '0')}`;
  const data = store.tx(() => {
    const account = (name, stage, age, extra = {}) => insertClient(store, user, { name, stage, ...extra }, days(-age));
    const northline = account('Northline', 'delivering', 60, { member_ids: [member.id], website: 'northline.example', monthly_value: 15000,
      contact_name: 'Jamie Example', contact_title: 'VP Partnerships', contact_email: 'intake@example.test', started_on: day(-45), source: 'Referral' });
    const grove = account('Grove Kitchen', 'matching', 30, { monthly_value: 12000, contact_name: 'Priya Example', contact_title: 'Head of Growth',
      contact_email: 'priya@example.test', website: 'grovekitchen.example', started_on: day(-12) });
    account('Copperleaf Loyalty', 'onboarding', 16, { monthly_value: 15000, contact_name: 'Marcus Example', contact_title: 'CEO',
      contact_email: 'marcus@example.test', website: 'copperleaf.example', started_on: day(-3) });
    account('Tidewater Payments', 'won', 21, { monthly_value: 18000, contact_name: 'Elena Example', contact_title: 'CMO', contact_email: 'elena@example.test', source: 'Conference' });
    account('Bright Harvest Supply', 'contract', 26, { monthly_value: 15000, contact_name: 'Noah Example', contact_title: 'VP Sales',
      next_step: 'Chase signature on the agreement', next_step_at: day(-1), source: 'Inbound' });
    account('Kettle & Crate', 'proposal', 18, { monthly_value: 10000, contact_name: 'Ines Example', contact_title: 'Founder',
      next_step: 'Walk through the proposal', next_step_at: day(3), source: 'Referral' });
    account('Ovenline Robotics', 'discovery', 9, { monthly_value: 20000, contact_name: 'Theo Example', contact_title: 'Head of Partnerships',
      next_step: 'Second discovery call with their CRO', next_step_at: day(0), source: 'Podcast guest' });
    account('Saltmarsh Analytics', 'prospect', 4, { contact_name: 'Wren Example', next_step: 'Send intro deck', next_step_at: day(5), source: 'Event' });
    account('Fennel POS', 'prospect', 2, { source: 'Inbound' });
    account('Marrow & Rye', 'lost', 50, { closed_reason: 'Chose to build partnerships in-house this year.', source: 'Referral' });
    timeline(store, user, northline.id, { kind: 'note', body: 'Kickoff call held. Jamie wants operations leaders first, technology second.' }, days(-40));

    const records = [
      [northline, 'Rory Bennett', 'VP Operations', 'Harborbird Chicken', 'to_contact', 'Draft first outreach', 1, user.id],
      [northline, 'Morgan Ellis', 'Director of Technology', 'BrightFork Burgers', 'reached_out', 'Send follow-up', -1, user.id],
      [northline, 'Riley Carter', 'COO', 'Maple Row QSR', 'in_conversation', 'Confirm next steps', 2, user.id],
      [northline, 'Avery Kim', 'VP Operations', 'Pinecrest QSR', 'closed', '', null, user.id],
      [grove, 'Harper Hayes', 'Head of Culinary', 'Elm Street Eats', 'reached_out', 'Share partnership overview', -3, user.id],
      [northline, 'Jordan Park', 'SVP Operations', 'Cedarline Restaurants', 'reached_out', 'Confirm demo', 4, member.id],
      [grove, '', '', 'Rivermere BBQ', 'to_contact', 'Identify operations contact', null, user.id],
      [grove, 'Devon Miles', 'CEO', 'Oakridge Burgers', 'closed', '', null, user.id],
    ];
    const cards = records.map(([client, person, title, company, stage, next_step, due, owner_id], index) =>
      insertCard(store, user, { client_id: client.id, person, title, company, stage, next_step, owner_id,
        email: person ? `${person.split(' ')[0].toLowerCase()}@example.test` : '', due_at: due === null ? undefined : days(due),
        outcome: stage === 'closed' ? 'Meeting booked' : '' }, { createdAt: days(-24), enteredAt: days(-index - 2),
        reason: index < 3 ? 'Multiunit operator with a growing drive-thru footprint.' : '' }));
    appendActivity(store, job, cards[1], { kind: 'sent', subject: 'Introducing Northline', occurred_at: days(-5),
      mailbox_scope: 'demo', outlook_message_id: 'demo-outbound-01' });
    appendActivity(store, job, cards[2], { kind: 'sent', subject: 'Northline and Maple Row', occurred_at: days(-4),
      mailbox_scope: 'demo', outlook_message_id: 'demo-outbound-02' });
    appendActivity(store, job, cards[2], { kind: 'reply', subject: 'Re: Northline and Maple Row',
      body: 'Thanks for reaching out. I can talk next week.', occurred_at: days(-1), mailbox_scope: 'demo', outlook_message_id: 'demo-reply-01' });
    appendActivity(store, user, cards[2], { kind: 'introduction', body: 'Introduced Riley to Jamie by email. Call set for next week.',
      occurred_at: days(-1), detail: { status: 'Introduced' } });
    appendActivity(store, user, cards[5], { kind: 'introduction', body: 'Warm introduction at the operators dinner.', occurred_at: days(-2), detail: { status: 'Introduced' } });
    for (const [index, person, title, company, source, score, relationship] of [
      [1, 'Avery Lane', 'VP Operations', 'Summit Bun Co.', 'HubSpot', 91, 'Spoke at our spring summit'],
      [2, 'Casey Morgan', 'Chief Operating Officer', 'Windward Tacos', 'Outlook', 88, 'Emailed with Taylor in March'],
      [3, 'Quinn Alvarez', 'Director of Technology', 'Juniper Coffee', 'Teams', 82, 'In our operators group chat'],
      [4, '', '', 'Meadow Grill Group', 'HubSpot', 71, 'Known by the team'],
    ]) insertSuggestion(store, job, { client_id: northline.id, candidate_key: `demo:${index}`, person, title, company, source, score,
      fit: score > 80 ? 'Strong' : 'Moderate', branded_relationship: relationship,
      reason: 'A growing multi-location drive-thru footprint that fits the ideal customer profile.',
      evidence: [{ source, detail: 'Example records describe an expanding restaurant group with new operations leadership.' }] }, days(-1));
    insertSubmission(store, user, northline.id, northlineProfile, { submittedAt: days(-44) });
    insertSubmission(store, user, grove.id, { company: 'Grove Kitchen', contact_name: 'Priya Example', contact_email: 'priya@example.test',
      pitch: 'Grove Kitchen supplies ready-to-finish plant-forward menu items to restaurant groups.',
      icp: 'Regional fast casual and casual dining groups adding plant-forward items.', segments: ['Fast casual', 'Casual dining'],
      geography: 'Northeast United States', minimum_locations: 10, ideal_locations: 40 }, { submittedAt: days(-2) });
    return { user, cards, northline };
  });
  // Moving a card through the app records the stage change, which the monthly report counts as a conversation started.
  updateCard(store, data.user, data.cards[5].id, { version: data.cards[5].version, stage: 'in_conversation' });
  mcpSaveDraft(store, job, { card_id: data.cards[1].id, followup_id: data.cards[1].followup_id,
    subject: 'Following up on Northline', body: 'Hi Morgan,\n\nI’m following up on my note about Northline. Would you be open to a quick conversation next week?\n\nThanks,\nTaylor' });
  const entries = [
    { kind: 'social', occurred_on: thisMonth(6), title: 'Why drive-thru speed is the new loyalty program', channel: 'LinkedIn', contact: 'Northline',
      url: 'https://linkedin.example/posts/drive-thru-speed', metrics: { impressions: 12400, likes: 310, comments: 42, shares: 28, clicks: 190 } },
    { kind: 'social', occurred_on: thisMonth(3), title: 'Three operators on what they measure at the lane', channel: 'LinkedIn', contact: 'Northline, Maple Row QSR',
      url: 'https://linkedin.example/posts/lane-metrics', metrics: { impressions: 8650, likes: 204, comments: 31, shares: 17, clicks: 122 } },
    { kind: 'social', occurred_on: thisMonth(2), title: 'Clip: Dana Whitfield on franchisee benchmarking', channel: 'Instagram',
      url: 'https://instagram.example/p/benchmarking', metrics: { impressions: 5320, likes: 412, comments: 19, shares: 36 } },
    { kind: 'podcast', occurred_on: thisMonth(5), title: 'Episode 84: The drive-thru data gap', channel: 'Branded Hospitality Podcast', contact: 'Dana Whitfield, Northline',
      url: 'https://podcast.example/84', detail: 'Dana joined as the featured guest.', metrics: { listeners: 18400 } },
    { kind: 'newsletter', occurred_on: thisMonth(4), title: 'Partner spotlight: Northline', channel: 'The Branded Brief', metrics: { recipients: 9200, opens: 4310, clicks: 388 } },
    { kind: 'event', occurred_on: thisMonth(2), title: 'Operators dinner, Atlanta', channel: 'Atlanta', contact: 'Jordan Park, Cedarline Restaurants', metrics: { attendees: 34 },
      detail: 'Northline was the featured partner. Two operators asked for follow-up calls.' },
    { kind: 'introduction', occurred_on: thisMonth(1), title: 'Email introduction', contact: 'Sasha Reyes, Director of Operations, Bluebonnet Burger' },
    { kind: 'press', occurred_on: thisMonth(3), title: 'Operators turn to lane data to cut wait times', channel: 'Restaurant Tech Weekly', url: 'https://press.example/lane-data', metrics: { impressions: 21000 } },
  ];
  for (const entry of entries) addEntry(store, data.user, data.northline.id, entry);
  saveSummary(store, data.user, data.northline.id, month, {
    headline: 'Three new introductions, a podcast feature and 75,000 people reached.',
    summary: 'We focused this month on operations leaders at multiunit drive-thru brands in the South.\n\nRiley Carter at Maple Row QSR and Jordan Park at Cedarline Restaurants are both in active conversation, and Dana’s podcast episode became our most-played of the quarter.',
    next_steps: 'Confirm the Cedarline demo.\nIntroduce Avery Lane at Summit Bun Co. once the match is approved.\nShare the podcast clip series across LinkedIn.' });
  return data;
}
