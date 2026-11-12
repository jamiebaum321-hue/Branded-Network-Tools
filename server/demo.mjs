import { bootstrap, finishSetup, inviteAccount } from './accounts.mjs';
import { insertClient, insertSubmission } from './clients.mjs';
import { appendActivity, insertCard, insertSuggestion, mcpSaveDraft } from './pipeline.mjs';

export const demoEmail = 'demo@branded.example';
export const demoPassword = 'Local-Demo-Pipeline-24';
const days = (delta, hour = 14) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + delta);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

export async function loadDemo(store) {
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
      minimum_locations: 30, ideal_locations: 100, priority_targets: [{ company: 'Windward Tacos' }],
      current_integrations: 'Major restaurant POS systems' }, { submittedAt: days(-2) });
    return { user, cards };
  });
  mcpSaveDraft(store, job, { card_id: data.cards[1].id, followup_id: data.cards[1].followup_id,
    subject: 'Following up on Northline', body: 'Hi Morgan,\n\nI’m following up on my note about Northline. Would you be open to a quick conversation next week?\n\nThanks,\nTaylor' });
  return data;
}
