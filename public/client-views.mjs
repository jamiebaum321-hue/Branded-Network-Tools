import { sections, isAnswered } from './intake-fields.mjs';
import { clientStages, journey, matchPrompt, metricLabels, reportKind, reportKinds, reportPrompt, stageInfo } from './lifecycle.mjs';
import { avatar, badge, btn, clientStageBadge, compactMoney, dayLabel, emptyState, field, formatDate, h, heading, hidden, icon, link, linkButton,
  money, number, outboundLink, pathId, select, stageBadge, stageDuration, stages, stat, tabs, timeLabel, todayIn } from './ui.mjs';

const names = rows => rows.map(row => ({ id: row.id, name: row.name }));
const grid = content => `<div class="form-grid">${content}</div>`;
const form = (type, id, inner, extra = '') => `<form class="stack" data-form="${type}" ${id ? `data-id="${h(id)}"` : ''} ${extra}>${inner}</form>`;
const arrow = () => `<span class="row-chevron">${icon('chevron')}</span>`;
const more = (name, next, data = '') => next === null || next === undefined ? '' : `<div class="pagination">${btn('Load more', { action: name, data: `data-next="${h(next)}" ${data}` })}</div>`;
const plural = (count, one, many = `${one}s`) => `${number(count)} ${count === 1 ? one : many}`;
const pages = { sales: { path: '/opportunities', title: 'Opportunities', detail: 'Every prospect from first conversation to signed client.', add: 'Add opportunity', first: 'prospect' },
  delivery: { path: '/clients', title: 'Clients', detail: 'Signed clients, from onboarding through delivery.', add: 'Add client', first: 'won' } };

const dueBadge = (row, today) => !row.next_step_at ? '' : row.next_step_at < today ? badge(`Overdue · ${dayLabel(row.next_step_at)}`, 'red')
  : row.next_step_at === today ? badge('Due today', 'amber') : badge(`Due ${dayLabel(row.next_step_at)}`);

export function accountCard(row, zone) {
  const today = todayIn(zone);
  const chips = [dueBadge(row, today), row.pending_matches ? badge(plural(row.pending_matches, 'match', 'matches') + ' to review', 'violet') : '',
    row.stage === 'onboarding' && !row.latest_submission ? badge('Waiting on form', 'amber') : '',
    row.open_cards ? badge(plural(row.open_cards, 'intro') + ' open', 'blue') : ''].join('');
  return `<a class="board-card" href="/clients/${pathId(row.id)}" draggable="true" data-client="${h(row.id)}" data-stage="${h(row.stage)}">
    <div class="card-head"><div class="row-main"><strong>${h(row.name)}</strong>${row.contact_name ? `<small>${h([row.contact_name, row.contact_title].filter(Boolean).join(' · '))}</small>` : ''}</div>
      ${row.monthly_value ? `<span class="card-value">${h(compactMoney(row.monthly_value))}/mo</span>` : ''}</div>
    ${row.next_step ? `<p class="small wrap">${h(row.next_step)}</p>` : ''}${chips ? `<div class="chips">${chips}</div>` : ''}
    <div class="card-foot"><span class="cell-user">${avatar(row.owner_name)}<span class="clip">${h(row.owner_name)}</span></span>
    <span>${h(stageDuration(row.stage_entered_at ?? row.created_at))}</span></div></a>`;
}

const accountHead = { sales: ['Company', 'Stage', 'Monthly value', 'Next step', 'Owner', 'In stage'],
  delivery: ['Client', 'Stage', 'Onboarding', 'Matches to review', 'Open introductions', 'Owner'] };

export function accountRows(rows, phase, zone) {
  const today = todayIn(zone);
  const who = row => `<a class="cell-user primary-cell" href="/clients/${pathId(row.id)}">${avatar(row.name, 'square')}<span>${h(row.name)}${row.contact_name ? `<small>${h(row.contact_name)}</small>` : ''}</span></a>`;
  const cells = row => phase === 'sales' ? [who(row), clientStageBadge(row.stage), `<span class="num">${h(money(row.monthly_value))}</span>`,
    `${h(row.next_step || '—')} ${dueBadge(row, today)}`, h(row.owner_name), h(stageDuration(row.stage_entered_at ?? row.created_at))]
    : [who(row), clientStageBadge(row.stage), row.latest_submission ? `Completed ${h(formatDate(row.latest_submission, zone))}` : '<span class="muted">Not completed</span>',
      row.pending_matches ? badge(number(row.pending_matches), 'violet') : '<span class="muted">0</span>', number(row.open_cards), h(row.owner_name)];
  return rows.map(row => `<tr>${cells(row).map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('');
}

const accountTable = (rows, phase, zone) => `<div class="table-wrap"><table class="data-table"><thead><tr>${accountHead[phase].map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead>
  <tbody id="account-list">${accountRows(rows, phase, zone)}</tbody></table></div>`;

export function accountsPage(phase, data, context, query, zone, visible) {
  const page = pages[phase];
  const view = query.get('view') === 'list' ? 'list' : 'board';
  const closed = query.get('show') === 'closed';
  const here = extra => { const next = new URLSearchParams(query); for (const [key, value] of Object.entries(extra)) value ? next.set(key, value) : next.delete(key); return `${page.path}${next.size ? `?${next}` : ''}`; };
  const toggle = `<div class="segmented" role="group" aria-label="View">
    <a href="${h(here({ view: '', show: '' }))}"${view === 'board' ? ' aria-current="page"' : ''}>${icon('board')}Board</a>
    <a href="${h(here({ view: 'list' }))}"${view === 'list' ? ' aria-current="page"' : ''}>${icon('list')}List</a></div>`;
  const filters = `<form class="filters bare" data-form="filter">${view === 'list' ? hidden('view', 'list') : ''}
    <div class="search">${field('Search', 'q', query.get('q') ?? '', { type: 'search', max: 180, placeholder: 'Company name' })}</div>
    ${select('Owner', 'owner_id', names(context.owners), query.get('owner_id') ?? '', 'All owners')}
    ${view === 'list' ? select('Show', 'show', [{ id: 'closed', name: phase === 'sales' ? 'Lost' : 'Ended' }], closed ? 'closed' : '', phase === 'sales' ? 'Open opportunities' : 'Active clients') : ''}
    <div class="actions">${btn('Apply', { type: 'submit' })}${query.get('q') || query.get('owner_id') ? btn('Clear', { action: 'clear-filters', kind: 'quiet' }) : ''}</div></form>`;
  let body;
  if (view === 'list') body = `<section class="panel flush">${data.items.length ? accountTable(data.items, phase, zone) : emptyState(closed ? 'Nothing here.' : `No ${page.title.toLowerCase()} match.`)}
    ${more('more-accounts', data.next_offset, `data-phase="${phase}"`)}</section>`;
  else {
    const total = data.groups.reduce((sum, group) => sum + group.total, 0);
    body = `${total ? '' : `<div class="panel">${emptyState(phase === 'sales' ? 'No opportunities yet.' : 'No clients in delivery yet.',
      phase === 'sales' ? 'Add the first company you are talking to.' : 'Clients appear here once onboarding starts.', btn(page.add, { kind: 'primary', glyph: 'plus', action: 'add-account', data: `data-stage="${page.first}"` }))}</div>`}
    <div class="stage-picker" aria-label="Visible stage">${data.groups.map(group => `<button type="button" class="button" data-action="pick-stage"
      data-stage="${h(group.stage)}" aria-pressed="${group.stage === visible}">${h(stageInfo[group.stage].label)} ${badge(group.total)}</button>`).join('')}</div>
    <div class="board">${data.groups.map(group => `<section class="board-column dot-${stageInfo[group.stage].tone} ${group.stage === visible ? 'active' : ''}" data-column="${h(group.stage)}">
      <div class="column-heading"><h2 title="${h(stageInfo[group.stage].hint)}">${h(stageInfo[group.stage].label)}</h2><small>${number(group.total)}${group.value ? ` · ${h(compactMoney(group.value))}/mo` : ''}</small></div>
      <div class="column-list">${group.items.length ? group.items.map(row => accountCard(row, zone)).join('') : emptyState(stageInfo[group.stage].hint)}</div></section>`).join('')}</div>`;
  }
  return `${heading(page.title, page.detail, btn(page.add, { kind: 'primary', glyph: 'plus', action: 'add-account', data: `data-stage="${page.first}"` }))}
    <div class="spread gap-below">${toggle}</div>${filters}${body}`;
}

const stageChoices = clientStages.map(stage => ({ id: stage.id, name: stage.phase === 'closed' ? `${stage.label} (closed)` : stage.label }));

// Create (no client) or edit the details a manager maintains.
export function clientForm(context, client, stage = 'prospect') {
  const value = key => client?.[key] ?? '';
  const chosen = client?.stage ?? stage;
  return form(client ? 'client-edit' : 'client-create', client?.id, `${grid(`<div class="wide">${field('Company name', 'name', value('name'), { required: true, max: 180 })}</div>
    ${select('Stage', 'stage', stageChoices, chosen)}${field('Monthly value (USD)', 'monthly_value', value('monthly_value'), { type: 'number', min: 0, step: 1, placeholder: '15000' })}
    ${field('Primary contact', 'contact_name', value('contact_name'), { max: 150 })}${field('Contact title', 'contact_title', value('contact_title'), { max: 160 })}
    ${field('Contact email', 'contact_email', value('contact_email'), { type: 'email', max: 254 })}${field('Contact phone', 'contact_phone', value('contact_phone'), { type: 'tel', max: 70 })}
    ${field('Website', 'website', value('website'), { max: 600, placeholder: 'company.com' })}${field('How they found us', 'source', value('source'), { max: 200, placeholder: 'Referral, event, inbound' })}
    ${field('Next step', 'next_step', value('next_step'))}${field('Next step due', 'next_step_at', value('next_step_at'), { type: 'date' })}
    ${client ? field('Engagement start date', 'started_on', value('started_on'), { type: 'date' }) : ''}
    <div class="wide" data-closed ${stageInfo[chosen].phase === 'closed' ? '' : 'hidden'}>${field('Reason closed', 'closed_reason', value('closed_reason'), { max: 600 })}</div>`)}
    <div class="actions">${btn(client ? 'Save changes' : 'Add', { kind: 'primary', type: 'submit' })}</div>`);
}

export function accessForm(context, data) {
  const owners = context.owners.filter(row => row.enabled || row.id === data.client.owner_id);
  return form('client-access', data.client.id, `${select('Owner', 'owner_id', names(owners), data.client.owner_id)}
    <fieldset class="repeater"><legend>Also give access to</legend><div class="check-list">${owners.map(row =>
      `<label class="check"><input type="checkbox" name="member_ids" value="${h(row.id)}"${data.member_ids.includes(row.id) ? ' checked' : ''}>${h(row.name)}</label>`).join('')}</div></fieldset>
    <div>${btn('Save access', { kind: 'primary', type: 'submit' })}</div>`);
}

function stepper(stage) {
  const index = journey.indexOf(stage);
  return `<ol class="stepper" aria-label="Client journey">${journey.map((id, position) => {
    const state = index < 0 ? '' : position < index ? 'done' : position === index ? 'current' : '';
    return `<li class="${state}${id === 'onboarding' ? ' break' : ''}"${state === 'current' ? ' aria-current="step"' : ''} title="${h(stageInfo[id].hint)}">
      <span class="mark">${state === 'done' ? icon('check') : position + 1}</span>${h(stageInfo[id].label)}</li>`;
  }).join('')}</ol>`;
}

const clientData = (client, extra = '') => `data-id="${h(client.id)}" ${extra}`;

function headerActions(data) {
  const { client } = data;
  const next = journey[journey.indexOf(client.stage) + 1];
  let primary = '';
  if (stageInfo[client.stage].phase === 'closed') primary = '';
  else if (client.stage === 'won') primary = btn('Start onboarding', { kind: 'primary', glyph: 'send', action: 'start-onboarding', data: clientData(client) });
  else if (client.stage === 'onboarding') primary = btn('Copy onboarding link', { kind: 'primary', glyph: 'link', action: 'form-link', data: clientData(client) });
  else if (stageInfo[client.stage].phase === 'delivery') primary = btn('Find matches with Claude', { kind: 'primary', glyph: 'sparkles', action: 'match-prompt' });
  else if (next) primary = btn(next === 'won' ? 'Mark as won' : `Move to ${stageInfo[next].label}`, { kind: 'primary', glyph: next === 'won' ? 'check' : 'arrow', action: 'move-client', data: clientData(client, `data-stage="${next}"`) });
  return `${btn('Edit', { glyph: 'edit', action: 'edit-client' })}${primary}`;
}

function nextAction(data, zone) {
  const { client, link: active, profile, counts } = data;
  const contact = client.contact_name || 'the client';
  if (client.stage === 'lost' || client.stage === 'churned') return `<section class="panel stack"><h2>${client.stage === 'lost' ? 'Opportunity lost' : 'Engagement ended'}</h2>
    <p class="muted multiline">${h(client.closed_reason || 'No reason recorded.')}</p></section>`;
  if (client.stage === 'won') return `<section class="callout"><h2>Signed. Time to onboard ${h(client.name)}.</h2>
    <p>Starting onboarding creates a private link to the onboarding form. Send it to ${h(contact)} and their answers fill in this profile.</p>
    <div class="actions">${btn('Start onboarding', { kind: 'primary', glyph: 'send', action: 'start-onboarding', data: clientData(client) })}</div></section>`;
  if (client.stage === 'onboarding') return `<section class="callout"><h2>${active?.started ? `${h(contact)} has started the onboarding form.` : `Waiting on ${h(contact)} to complete onboarding.`}</h2>
    <p>${active ? `The link expires ${h(formatDate(active.expires_at, zone, { year: 'numeric' }))}. Their answers save as they go, and you are alerted when they submit.` : 'There is no active link. Create a new one to send.'}</p>
    <div class="actions">${btn(active ? 'Copy onboarding link' : 'Create onboarding link', { kind: 'primary', glyph: 'link', action: 'form-link', data: clientData(client) })}
    ${client.contact_email && active ? btn('Email the link', { glyph: 'mail', action: 'mail-link', data: clientData(client) }) : ''}</div></section>`;
  if (client.stage === 'matching' || client.stage === 'delivering') return `<section class="callout"><h2>${counts.matches_pending ? `${plural(counts.matches_pending, 'match', 'matches')} waiting for your review.`
    : counts.matches_total ? 'Ask Claude to look for more matches.' : `${h(client.name)}’s profile is ready. Find who to introduce.`}</h2>
    <p>${profile ? 'Claude reads this profile, searches your HubSpot, email and Teams for companies and people who fit, and saves them here for you to approve.'
      : 'This client has no onboarding answers yet, so Claude has nothing to match against. Send the onboarding link first.'}</p>
    <div class="actions">${counts.matches_pending ? linkButton(`/clients/${pathId(client.id)}?tab=matches`, 'Review matches', { kind: 'primary', glyph: 'arrow' }) : ''}
    ${btn('Find matches with Claude', { kind: counts.matches_pending ? '' : 'primary', glyph: 'sparkles', action: 'match-prompt' })}</div></section>`;
  return `<section class="panel stack"><div class="spread"><h2>Next step</h2>${dueBadge(client, todayIn(zone))}</div>
    <p class="${client.next_step ? '' : 'muted'}">${h(client.next_step || 'No next step set. Add one so this shows up on Today when it is due.')}</p>
    <div class="actions">${btn(client.next_step ? 'Update' : 'Set next step', { action: 'edit-client' })}</div></section>`;
}

export function timelineItems(rows, zone) {
  return rows.map(row => `<li class="is-${row.kind}"><span>${row.kind === 'note' ? `<span class="multiline">${h(row.body)}</span>`
    : `${row.from_stage ? `Moved to <strong>${h(stageInfo[row.stage]?.label ?? row.stage)}</strong>` : `Added as <strong>${h(stageInfo[row.stage]?.label ?? row.stage)}</strong>`}${row.body ? `. ${h(row.body)}` : ''}`}</span>
    <small>${h(row.actor)} · ${h(timeLabel(row.at, zone))}</small></li>`).join('');
}

function overview(data, zone) {
  const { client, counts, timeline, profile } = data;
  const base = `/clients/${pathId(client.id)}`;
  const details = [['Primary contact', [client.contact_name, client.contact_title].filter(Boolean).join(', ')], ['Email', client.contact_email ? `<a class="text-link external" href="mailto:${h(client.contact_email)}">${h(client.contact_email)}</a>` : '', true],
    ['Phone', client.contact_phone], ['Website', client.website ? outboundLink(client.website, client.website.replace(/^https?:\/\//, '').replace(/\/$/, '')) : '', true],
    ['Monthly value', client.monthly_value === null ? '' : money(client.monthly_value)], ['Source', client.source], ['Start date', client.started_on ? dayLabel(client.started_on, { year: 'numeric' }) : ''],
    ['Owner', client.owner_name], ['In this stage', stageDuration(client.stage_entered_at ?? client.created_at)]];
  return `<div class="detail-grid"><div class="stack">${nextAction(data, zone)}
    <div class="stat-grid four flat">${stat(number(counts.matches_pending), 'Matches to review', { href: `${base}?tab=matches` })}${stat(number(counts.cards_open), 'Open introductions', { href: `${base}?tab=introductions` })}
      ${stat(number(counts.in_conversation), 'In conversation', { href: `${base}?tab=introductions` })}${stat(profile ? `${profile.completeness}%` : '—', 'Profile complete', { href: `${base}?tab=profile` })}</div>
    <section class="panel"><div class="section-head"><h2>Details</h2>${btn('Edit', { kind: 'quiet sm', glyph: 'edit', action: 'edit-client' })}</div>
      <dl class="key-list">${details.map(([label, value, raw]) => `<div><dt>${label}</dt><dd>${value ? raw ? value : h(value) : '<span class="muted">—</span>'}</dd></div>`).join('')}</dl></section>
    ${data.isAdmin ? `<details class="panel"><summary>Team access</summary>${data.accessForm}</details>` : ''}</div>
    <section class="panel stack"><h2>Timeline</h2>${form('client-note', client.id, `${field('Add a note', 'body', '', { type: 'textarea', max: 4000, rows: 2, required: true, placeholder: 'Call notes, context, what was agreed' })}
      <div>${btn('Add note', { type: 'submit' })}</div>`)}
      <ol class="timeline" id="timeline-list">${timelineItems(timeline.items, zone)}</ol>
      ${timeline.next_cursor ? `<div>${btn('Show older', { kind: 'quiet sm', action: 'more-timeline', data: clientData(client, `data-next="${timeline.next_cursor}"`) })}</div>` : ''}</section></div>`;
}

function answerValue(value) {
  if (Array.isArray(value)) return `<div class="chips">${value.map(item => badge(item)).join('')}</div>`;
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return outboundLink(value);
  return `<span class="multiline">${h(value)}</span>`;
}

// The onboarding answers laid out as a profile. Unanswered fields stay visible so gaps are obvious.
export function profileSections(answers) {
  return `<div class="grid-two">${sections.map(section => `<section class="panel"><div class="section-head"><h2>${h(section.title)}</h2></div><dl>${section.fields.map(definition => {
    const answer = answers[definition.key];
    const filled = isAnswered(answer);
    const value = !filled ? 'Not provided' : definition.rows ? answer.map(item => `<div class="evidence">${definition.rows.filter(child => item[child.key]).map(child =>
      `<p><span class="muted">${h(child.label)}</span> · ${answerValue(item[child.key])}</p>`).join('')}</div>`).join('') : answerValue(answer);
    return `<div class="submission-field"><dt>${h(definition.label)}</dt><dd class="${filled ? '' : 'unset'}">${value}</dd></div>`;
  }).join('')}</dl></section>`).join('')}</div>`;
}

export function versionRows(rows, clientId, zone) {
  return rows.map(row => `<a class="list-row" href="/clients/${pathId(clientId)}/submissions/${pathId(row.id)}"><span class="panel-icon blue">${icon('draft')}</span>
    <div class="row-main"><strong>Version ${row.version}</strong><small>${h(timeLabel(row.submitted_at, zone))}${row.source_ref ? ` · ${h(/^Edited by /.test(row.source_ref) ? row.source_ref : 'Imported')}` : ' · Submitted by client'}</small></div>${arrow()}</a>`).join('');
}

function profileTab(data, zone) {
  const { client, profile, submissions, link: active } = data;
  const base = `/clients/${pathId(client.id)}`;
  const linkPanel = `<section class="panel stack"><h2>Onboarding link</h2><p class="muted">${active ? `Active until ${h(formatDate(active.expires_at, zone, { year: 'numeric' }))}.${active.started ? ' The client has started a draft.' : ''}`
    : profile ? 'Send a new link when the client needs to update their answers. It opens with their current answers filled in.' : 'Create a private link to the onboarding form and send it to the client.'}</p>
    <div class="actions">${btn(active ? 'Copy link' : 'Create link', { glyph: 'link', action: 'form-link', data: clientData(client) })}
    ${active ? btn('Revoke link', { kind: 'danger', action: 'revoke-form', data: clientData(client) }) : ''}</div></section>`;
  if (!profile) return `<div class="detail-grid"><section class="panel">${emptyState('No profile yet.', 'The profile fills in when the client completes the onboarding form. You can also enter it yourself.',
    `${btn(stageInfo[client.stage].phase === 'sales' ? 'Start onboarding' : 'Copy onboarding link', { kind: 'primary', glyph: 'send', action: stageInfo[client.stage].phase === 'sales' ? 'start-onboarding' : 'form-link', data: clientData(client) })}
    ${linkButton(`${base}?tab=profile&edit=1`, 'Enter it myself', { glyph: 'edit' })}`)}</section>${linkPanel}</div>`;
  return `<section class="panel gap-below"><div class="spread"><div class="meter grow"><div class="spread"><strong>Profile ${profile.completeness}% complete</strong>
      <span class="muted">Version ${profile.version} · ${h(formatDate(profile.submitted_at, zone, { year: 'numeric' }))}</span></div>
      <progress value="${profile.completeness}" max="100" aria-label="Profile completeness"></progress></div>
    <div class="actions">${linkButton(`${base}?tab=profile&edit=1`, 'Edit profile', { glyph: 'edit' })}
    <a class="button" href="/api${base}/submissions/${pathId(profile.id)}/pdf" download>${icon('download')}Export PDF</a></div></div></section>
    ${profileSections(profile.answers)}
    <div class="grid-two gap-above"><section class="panel flush"><div class="panel-title"><h2>Version history</h2></div><div id="submission-list">${versionRows(submissions.items, client.id, zone)}</div>
      ${submissions.next_cursor ? `<div class="pagination">${btn('Load older versions', { action: 'more-submissions', data: clientData(client, `data-next="${submissions.next_cursor}"`) })}</div>` : ''}</section>${linkPanel}</div>`;
}

function icpSummary(answers) {
  const a = answers ?? {};
  const list = (value, key) => (Array.isArray(value) ? value : []).map(row => row[key]).filter(Boolean);
  const size = [a.minimum_locations !== undefined ? `${number(a.minimum_locations)}+ locations` : '', a.ideal_locations !== undefined ? `ideal ${number(a.ideal_locations)}` : '',
    a.maximum_locations !== undefined ? `up to ${number(a.maximum_locations)}` : ''].filter(Boolean).join(', ');
  const excluded = [[list(a.current_customers, 'company').length, 'customer'], [list(a.sales_pipeline, 'company').length, 'deal in progress', 'deals in progress'],
    [list(a.competitors, 'company').length, 'competitor']].filter(([count]) => count).map(([count, one, many]) => plural(count, one, many)).join(', ');
  return [['Ideal customer', a.icp], ['Segments', [...(a.segments ?? []), a.segment].filter(Boolean).join(', ')], ['Ownership', (a.ownership ?? []).join(', ')],
    ['Geography', a.geography], ['Size', size], ['Other criteria', a.footprint], ['Buyers', list(a.personas, 'title').join(', ')], ['Good-fit signals', a.buying_triggers],
    ['Priority targets', list(a.priority_targets, 'company').join(', ')], ['Not a fit', a.disqualifiers], ['Excluded', [excluded, a.exclusions].filter(Boolean).join('. ')]].filter(([, value]) => value);
}

const matchStatus = { pending: ['Pending review', 'amber'], approved: ['Approved', 'green'], dismissed: ['Dismissed', 'neutral'] };
const fitTone = fit => /strong/i.test(fit) ? 'green' : /moderate|medium/i.test(fit) ? 'amber' : 'neutral';

export function matchRows(rows, { showClient = false, stay = false } = {}) {
  return rows.map(row => `<tr><td class="match-cell"><a class="primary-cell" href="/pipeline/suggestions/${pathId(row.id)}">${h(row.person || row.company)}<small>${h([row.title, row.person ? row.company : ''].filter(Boolean).join(', '))}</small></a></td>
    ${showClient ? `<td>${h(row.client_name)}</td>` : ''}
    <td><div class="chips nowrap">${badge(row.fit, fitTone(row.fit))}${row.score === null ? '' : `<span class="muted num">${h(row.score)}</span>`}</div></td>
    <td class="wrap reason-cell">${h(row.reason.length > 150 ? `${row.reason.slice(0, 147)}…` : row.reason)}<small class="block">Found in ${h(row.source)}${row.branded_relationship && row.branded_relationship !== 'Unknown' ? ` · ${h(row.branded_relationship)}` : ''}</small></td>
    <td class="row-actions">${row.status === 'pending' ? `${btn('Approve', { kind: 'primary sm', action: 'decide', data: `data-id="${h(row.id)}" data-decision="approved" ${stay ? 'data-stay' : ''}` })}
      ${btn('Dismiss', { kind: 'sm', action: 'decide', data: `data-id="${h(row.id)}" data-decision="dismissed" ${stay ? 'data-stay' : ''}` })}`
      : row.card_id ? linkButton(`/pipeline/cards/${pathId(row.card_id)}`, 'Open card', { kind: 'sm' }) : badge(...matchStatus[row.status])}</td></tr>`).join('');
}

export function matchTable(rows, options = {}) {
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Match</th>${options.showClient ? '<th scope="col">Client</th>' : ''}<th scope="col">Fit</th>
    <th scope="col">Why it fits</th><th scope="col"><span class="skip">Actions</span></th></tr></thead><tbody id="suggestion-list">${matchRows(rows, options)}</tbody></table></div>`;
}

function matchesTab(data, query) {
  const { client, profile, matches, matchCounts } = data;
  const base = `/clients/${pathId(client.id)}?tab=matches`;
  const status = ['approved', 'dismissed', 'all'].includes(query.get('status')) ? query.get('status') : 'pending';
  const summary = icpSummary(profile?.answers);
  const total = matchCounts.pending + matchCounts.approved + matchCounts.dismissed;
  return `<div class="detail-grid wide-left"><div class="stack"><section class="panel flush"><div class="panel-title"><h2>Matches</h2></div>
      <div class="tabs-inset">${tabs([[base, 'To review', 'pending', matchCounts.pending], [`${base}&status=approved`, 'Approved', 'approved', matchCounts.approved],
        [`${base}&status=dismissed`, 'Dismissed', 'dismissed', matchCounts.dismissed], [`${base}&status=all`, 'All', 'all', total]], status, 'Match status')}</div>
      ${matches.items.length ? matchTable(matches.items, { stay: true }) : emptyState(total ? 'Nothing in this list.' : 'No matches yet.',
        total ? '' : 'Ask Claude to search your HubSpot, email and Teams for companies and people who fit this client.', total ? '' : btn('Find matches with Claude', { kind: 'primary', glyph: 'sparkles', action: 'match-prompt' }))}
      ${more('more-suggestions', matches.next_offset, clientData(client, 'data-stay'))}</section></div>
    <div class="stack"><section class="callout"><h3>Find matches with Claude</h3><p>Claude searches your connected tools against this client’s profile and saves what it finds here for approval.</p>
      <div>${btn('Get the prompt', { kind: 'primary', glyph: 'sparkles', action: 'match-prompt' })}</div></section>
    <section class="panel"><div class="section-head"><h2>What we are matching against</h2>${profile ? link(`/clients/${pathId(client.id)}?tab=profile`, 'Full profile', 'arrow', 'small') : ''}</div>
      ${summary.length ? `<dl class="key-list">${summary.map(([label, value]) => `<div><dt>${label}</dt><dd class="multiline">${h(value)}</dd></div>`).join('')}</dl>`
        : emptyState('No ideal customer profile yet.', 'It comes from the onboarding form.')}</section></div></div>`;
}

function introductionsTab(data, zone) {
  const { client, cards } = data;
  const count = stage => cards.items.filter(row => row.stage === stage).length;
  return `<div class="stat-grid four">${Object.entries(stages).map(([id, info]) => stat(number(count(id)), info.label)).join('')}</div>
    <section class="panel flush"><div class="panel-title"><h2>People and companies being introduced</h2>${linkButton(`/pipeline?client_id=${pathId(client.id)}`, 'Open board', { kind: 'sm', glyph: 'pipeline' })}
      ${btn('Add contact', { kind: 'primary sm', glyph: 'plus', action: 'add-card', data: clientData(client) })}</div>
    ${cards.items.length ? `<div class="table-wrap"><table class="data-table"><thead><tr>${['Contact', 'Stage', 'Next step', 'Follow-up', 'Last email', 'Owner'].map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead>
      <tbody>${cards.items.map(row => `<tr><td><a class="primary-cell" href="/pipeline/cards/${pathId(row.id)}">${h(row.person || row.company)}${row.person ? `<small>${h(row.company)}</small>` : ''}</a></td>
        <td>${stageBadge(row.stage)}</td><td class="wrap">${h(row.stage === 'closed' ? row.outcome : row.next_step || '—')}</td><td>${row.due_at ? h(formatDate(row.due_at, zone)) : '—'}</td>
        <td>${h(formatDate(row.last_touch, zone))}</td><td>${h(row.owner_name)}</td></tr>`).join('')}</tbody></table></div>`
      : emptyState('No introductions in progress.', 'Approve a match or add a contact to start outreach for this client.')}
    ${cards.next_offset ? `<div class="pagination">${link(`/pipeline?client_id=${pathId(client.id)}`, 'See all on the board', 'arrow')}</div>` : ''}</section>`;
}

export function monthNav(report, href) {
  return `<div class="month-nav"><a class="button" href="${h(href(report.previous))}" aria-label="Previous month">${icon('left')}</a><strong>${h(report.label)}</strong>
    <a class="button" href="${h(href(report.next))}" aria-label="Next month">${icon('chevron')}</a>
    ${report.period !== report.current ? `<a class="button quiet" href="${h(href(report.current))}">This month</a>` : ''}</div>`;
}

const metricCells = entry => reportKind[entry.kind].metrics.filter(key => entry.metrics[key] !== undefined)
  .map(key => `<span class="metric"><strong>${h(number(entry.metrics[key]))}</strong> ${h(metricLabels[key].toLowerCase())}</span>`).join('');

function entryGroups(report) {
  return reportKinds.filter(kind => report.entries.some(entry => entry.kind === kind.id)).map(kind => {
    const rows = report.entries.filter(entry => entry.kind === kind.id);
    return `<div class="entry-group"><div class="entry-head"><span class="panel-icon blue">${icon(kind.glyph)}</span><h3>${h(kind.label)} <span class="muted">${rows.length}</span></h3>
      ${btn('Add', { kind: 'quiet sm', glyph: 'plus', action: 'add-entry', data: `data-kind="${kind.id}"` })}</div>
      <div class="table-wrap"><table class="data-table entry-table"><tbody>${rows.map(entry => `<tr><td class="date-cell">${h(dayLabel(entry.occurred_on))}</td>
        <td><span class="primary-cell">${entry.url ? outboundLink(entry.url, entry.title) : h(entry.title)}</span>
          <small class="wrap block">${h([entry.channel, entry.contact].filter(Boolean).join(' · '))}${entry.detail ? `${entry.channel || entry.contact ? ' · ' : ''}${h(entry.detail)}` : ''}</small></td>
        <td><div class="metrics">${metricCells(entry)}</div></td><td class="row-actions">${entry.source === 'claude' ? badge('Claude', 'violet') : ''}
          <button class="icon-button" data-action="edit-entry" data-id="${h(entry.id)}" aria-label="Edit ${h(entry.title)}" title="Edit">${icon('edit')}</button>
          <button class="icon-button" data-action="delete-entry" data-id="${h(entry.id)}" aria-label="Delete ${h(entry.title)}" title="Delete">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div></div>`;
  }).join('');
}

function pipelineWork(report) {
  const { pipeline } = report;
  const who = row => h([row.person, row.company].filter(Boolean).join(', '));
  const block = (title, rows, cells) => rows.length ? `<details ${rows.length <= 6 ? 'open' : ''}><summary>${title} · ${rows.length}</summary><table class="data-table plain"><tbody>${rows.map(row =>
    `<tr><td class="date-cell">${h(dayLabel(row.date))}</td>${cells(row).map(cell => `<td class="wrap">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></details>` : '';
  const content = [block('Introductions logged on cards', pipeline.introductions, row => [`<a class="primary-cell" href="/pipeline/cards/${pathId(row.card_id)}">${who(row)}</a>`, h(row.note || row.status)]),
    block('Conversations started', pipeline.conversations, row => [`<a class="primary-cell" href="/pipeline/cards/${pathId(row.card_id)}">${who(row)}</a>`]),
    block('Outcomes', pipeline.outcomes, row => [who(row), h(row.outcome)]),
    block('Emails sent and received', pipeline.emails, row => [badge(row.direction, row.direction === 'Sent' ? 'blue' : 'green'), who(row), h(row.subject || '(no subject)')])].join('');
  return `<section class="panel stack"><div><h2>From the introduction pipeline</h2><p class="muted">Included automatically from cards for this client. Nothing to enter here.</p></div>
    ${content || emptyState('No pipeline activity this month.')}</section>`;
}

function reportTab(data) {
  const { client, report } = data;
  const base = `/clients/${pathId(client.id)}?tab=report`;
  const t = report.totals;
  return `<div class="spread gap-below">${monthNav(report, period => `${base}&period=${period}`)}
    <div class="actions">${btn('Build with Claude', { glyph: 'sparkles', action: 'report-prompt' })}${btn('Add entry', { glyph: 'plus', action: 'add-entry' })}
    <a class="button primary" href="/api/clients/${pathId(client.id)}/reports/${h(report.period)}/pdf" download>${icon('download')}Export PDF</a></div></div>
    <div class="stat-grid six">${stat(number(t.introductions), 'Introductions made')}${stat(number(t.conversations), 'Conversations started')}${stat(number(t.emails), 'Emails exchanged')}
      ${stat(number(t.reach), 'Audience reached')}${stat(number(t.engagements), 'Social engagements')}${stat(number(t.matches_found), 'Matches identified')}</div>
    <div class="detail-grid"><div class="stack"><section class="panel flush"><div class="panel-title"><h2>Work logged this month</h2>${btn('Add entry', { kind: 'primary sm', glyph: 'plus', action: 'add-entry' })}</div>
      ${report.entries.length ? `<div>${entryGroups(report)}</div>` : emptyState('Nothing logged for this month yet.', 'Add each introduction, post, podcast mention, event and piece of press. Claude can also collect them for you.')}</section>
      ${pipelineWork(report)}</div>
    <section class="panel stack"><div><h2>Summary for the client</h2><p class="muted">Appears on the first page of the PDF.</p></div>
      ${form('report-summary', client.id, `${hidden('period', report.period)}${field('The month in one line', 'headline', report.summary.headline, { max: 200, placeholder: 'Six introductions and a podcast feature' })}
      ${field('Summary', 'summary', report.summary.summary, { type: 'textarea', max: 6000, rows: 7, placeholder: 'What we did, what happened and why it matters.' })}
      ${field('What comes next', 'next_steps', report.summary.next_steps, { type: 'textarea', max: 4000, rows: 4 })}
      <div class="actions">${btn('Save summary', { type: 'submit', kind: 'primary' })}${report.summary.updated_at ? `<span class="muted small">Saved by ${h(report.summary.updated_by ?? 'staff')}</span>` : ''}</div>`)}</section></div>`;
}

export function clientPage(data, context, zone, tab, query) {
  const { client, counts } = data;
  const base = `/clients/${pathId(client.id)}`;
  const phase = stageInfo[client.stage].phase;
  const back = phase === 'sales' || client.stage === 'lost' ? ['/opportunities', 'Opportunities'] : ['/clients', 'Clients'];
  const view = { ...data, isAdmin: context.user.role === 'admin', accessForm: context.user.role === 'admin' ? accessForm(context, data) : '' };
  const body = tab === 'profile' ? profileTab(view, zone) : tab === 'matches' ? matchesTab(view, query) : tab === 'introductions' ? introductionsTab(view, zone)
    : tab === 'report' ? reportTab(view) : overview(view, zone);
  return `${link(back[0], back[1], 'back', 'back-link')}
    <div class="profile-hero">${avatar(client.name, 'lg square')}<div class="heading"><div><h1>${h(client.name)}</h1>
      <p>${clientStageBadge(client.stage)} &nbsp;${h([client.contact_name, client.owner_name ? `Owner ${client.owner_name}` : ''].filter(Boolean).join(' · '))}</p></div>
      <div class="actions">${headerActions(data)}</div></div></div>
    ${stepper(client.stage)}
    ${tabs([[base, 'Overview', 'overview'], [`${base}?tab=profile`, 'Profile', 'profile'], [`${base}?tab=matches`, 'Matches', 'matches', counts.matches_pending],
      [`${base}?tab=introductions`, 'Introductions', 'introductions', counts.cards_open], [`${base}?tab=report`, 'Monthly report', 'report']], tab, 'Client sections')}${body}`;
}

export function promptDialog(intro, prompt) {
  return `<div class="stack"><p>${h(intro)}</p><div class="prompt-box" id="prompt-text">${h(prompt)}</div>
    <div class="actions">${btn('Copy prompt', { kind: 'primary', glyph: 'copy', action: 'copy-prompt' })}</div>
    <p class="muted small">This needs the Branded Network connector added in Claude, plus your HubSpot, email and Teams connectors. An admin sets up access under Admin, Claude access.</p></div>`;
}
export const matchDialog = client => promptDialog(`Paste this into Claude. It reads ${client.name}’s profile, searches your tools, and saves matches to this page for you to approve.`, matchPrompt(client));
export const reportDialog = (client, period) => promptDialog(`Paste this into Claude. It gathers the month’s posts, episodes, introductions and emails for ${client.name} and logs them here.`, reportPrompt(client, period));

export function entryForm(clientId, period, entry = {}, zone) {
  const kind = reportKind[entry.kind] ?? reportKinds[0];
  const today = todayIn(zone);
  const date = entry.occurred_on ?? (today.startsWith(period) ? today : `${period}-01`);
  return form('entry', entry.id ?? '', `${hidden('client_id', clientId)}<p class="muted">${h(kind.hint)}</p>
    ${grid(`${select('Type of work', 'kind', reportKinds.map(row => ({ id: row.id, name: row.one })), kind.id)}${field('Date', 'occurred_on', date, { type: 'date', required: true })}
    <div class="wide">${field(kind.title, 'title', entry.title, { required: true, max: 300 })}</div>
    ${kind.contact ? field(kind.contact, 'contact', entry.contact, { max: 300 }) : ''}${kind.channel ? field(kind.channel, 'channel', entry.channel, { max: 160 }) : ''}
    <div class="wide">${field('Link', 'url', entry.url, { max: 600, placeholder: 'https://' })}</div>
    ${kind.metrics.map(key => field(metricLabels[key], `metric_${key}`, entry.metrics?.[key] ?? '', { type: 'number', min: 0, step: 1 })).join('')}
    <div class="wide">${field('Notes', 'detail', entry.detail, { type: 'textarea', max: 4000, rows: 3 })}</div>`)}
    <div class="actions">${btn(entry.id ? 'Save entry' : 'Add to report', { kind: 'primary', type: 'submit' })}</div>`);
}

export function reportsPage(data) {
  const href = period => `/reports?period=${period}`;
  return `${heading('Monthly reports', 'Everything done for each client this month, ready to export as a PDF.')}
    <div class="spread gap-below">${monthNav(data, href)}</div>
    <section class="panel flush">${data.items.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Client</th><th scope="col">Stage</th><th scope="col" class="num">Entries logged</th>
      <th scope="col" class="num">Introductions</th><th scope="col" class="num">Emails</th><th scope="col" class="num">Audience reached</th><th scope="col">Summary</th><th scope="col"><span class="skip">Actions</span></th></tr></thead>
      <tbody>${data.items.map(row => `<tr><td><a class="cell-user primary-cell" href="/clients/${pathId(row.id)}?tab=report&amp;period=${h(data.period)}">${avatar(row.name, 'square')}<span>${h(row.name)}<small>${h(row.owner_name)}</small></span></a></td>
        <td>${clientStageBadge(row.stage)}</td><td class="num">${number(row.entries)}</td><td class="num">${number(row.introductions)}</td><td class="num">${number(row.emails)}</td><td class="num">${number(row.reach)}</td>
        <td>${row.summary_at ? badge('Written', 'green') : '<span class="muted">Not written</span>'}</td>
        <td class="row-actions">${linkButton(`/clients/${pathId(row.id)}?tab=report&period=${data.period}`, 'Open', { kind: 'sm' })}
          <a class="button sm" href="/api/clients/${pathId(row.id)}/reports/${h(data.period)}/pdf" download aria-label="Export ${h(row.name)} PDF" title="Export PDF">${icon('download')}</a></td></tr>`).join('')}</tbody></table></div>`
      : emptyState('No active clients yet.', 'Reports are available for clients in onboarding, matching or delivery.')}</section>`;
}
