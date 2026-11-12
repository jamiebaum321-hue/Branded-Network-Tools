import { sections } from './intake-fields.mjs';
import { badge, brand, btn, currentDate, emptyState, field, formatDate, h, heading, hidden, icon, initials, link,
  localInput, outboundLink, pathId, pipelineTabs, select, stageBadge, stageDuration, stageOptions, stages, timeLabel } from './ui.mjs';

const names = rows => rows.map(row => ({ id: row.id, name: row.name }));
const fieldset = (content) => `<div class="form-grid">${content}</div>`;
const identity = row => `<div class="row-main"><strong>${h(row.person || row.company)}</strong>${row.person ? `<small>${h(row.company)}</small>` : ''}</div>`;
const navArrow = () => `<span class="row-chevron">${icon('chevron')}</span>`;
const sectionLabel = (title, glyph, tone = 'blue') => `<div class="section-label"><span class="section-icon ${h(tone)}">${icon(glyph)}</span><h2>${h(title)}</h2></div>`;
const disclosure = (title, glyph) => `<summary class="disclosure">${icon(glyph)}<span>${h(title)}</span><span class="disclosure-arrow">${icon('down')}</span></summary>`;
const toolbar = (tab, controls) => `<div class="workspace-toolbar">${pipelineTabs(tab)}${controls}</div>`;
const pageMore = (name, next) => next === null || next === undefined ? '' : `<div class="pagination">${btn('Load more', { action: name, endGlyph: 'down', data: `data-next="${h(next)}"` })}</div>`;
const statusName = status => ({ pending: 'Pending review', approved: 'Approved', dismissed: 'Dismissed', awaiting_review: 'Ready for review',
  needs_review: 'Review updated context', reviewed: 'Reviewed', sent: 'Sent', cancelled: 'Cancelled' })[status] ?? status;
const subjectForm = (type, id, inner) => `<form class="stack" data-form="${type}" ${id ? `data-id="${h(id)}"` : ''}>${inner}</form>`;

function illustratedState(art, title, detail, action = '') {
  return `<div class="illustrated-state"><div class="state-art">
    <img src="/assets/artwork/${h(art)}.webp" width="184" height="114" loading="lazy" decoding="async" alt=""></div>
    <div class="state-copy"><strong>${h(title)}</strong><p>${h(detail)}</p>${action}</div></div>`;
}

export function signInPage() {
  return `<div class="auth-page"><div class="auth-content">${brand()}${heading('Sign in', 'Use your Branded Network account.')}
    ${subjectForm('signin', '', `${field('Email', 'email', '', { type: 'email', autocomplete: 'username', required: true })}
    ${field('Password', 'password', '', { type: 'password', autocomplete: 'current-password', required: true, max: 256 })}
    ${btn('Sign in', { kind: 'primary', type: 'submit', endGlyph: 'arrow' })}`)}</div>
    <div class="auth-art" aria-hidden="true"><img src="/assets/artwork/signal-welcome.webp" width="540" height="540" alt="" decoding="async"></div></div>`;
}

export function setupPage(info, key) {
  return `<div class="form-page narrow">${brand()}${heading('Set your password', `${info.name} · ${info.email}`, '', { art: 'workspace-controls', compact: true })}
    <div class="panel">${subjectForm('setup', key, `${field('Password', 'password', '', { type: 'password', autocomplete: 'new-password', required: true, max: 256, hint: 'Use at least 12 characters.' })}
    ${field('Confirm password', 'confirmation', '', { type: 'password', autocomplete: 'new-password', required: true, max: 256 })}
    ${btn('Activate account', { kind: 'primary', type: 'submit', glyph: 'lock' })}`)}</div></div>`;
}

export function todayPage(data, zone) {
  const today = formatDate(new Date(), zone, { year: 'numeric' });
  const dueLabel = row => formatDate(row.at, zone, { year: 'numeric' }) === today
    ? badge('Due today', 'amber', 'clock') : badge(`Overdue · ${formatDate(row.at, zone)}`, 'red', 'clock');
  const panels = [
    { key: 'followups', title: 'Follow-ups due', glyph: 'today', tone: 'amber', empty: 'No follow-ups are due.', label: dueLabel },
    { key: 'drafts', title: 'Drafts awaiting review', glyph: 'draft', tone: 'violet', empty: 'You have no drafts to review.', label: row => row.extra === 'claude' ? badge('Claude draft', 'violet') : '' },
    { key: 'replies', title: 'Replies since last visit', glyph: 'reply', tone: 'green', empty: 'No new replies since your last visit.', label: row => badge(timeLabel(row.at, zone), 'green') },
    { key: 'leads', title: 'Suggested leads', glyph: 'shortlist', tone: 'blue', empty: 'No leads are waiting for your review.', label: row => badge(row.extra, 'blue') },
  ];
  const title = heading('Today', 'Follow-ups, drafts, and replies in one place.', '', { art: 'signal-today', date: currentDate(zone), signature: true });
  if (!data.more_replies && panels.every(panel => !data[panel.key].length)) {
    return `${title}<section class="panel flush">${illustratedState('today-caught-up', 'You’re caught up',
      'There are no follow-ups, drafts, replies, or leads waiting for you.', link('/pipeline', 'Open pipeline', 'arrow'))}</section>`;
  }
  return `${title}<div class="today-grid">${panels.map(panel => {
    const rows = data[panel.key];
    return `<section class="panel flush today-panel" aria-label="${h(panel.title)}" data-tone="${panel.tone}"><div class="panel-title"><span class="panel-icon ${panel.tone}">${icon(panel.glyph)}</span>
      <h2>${panel.title}</h2>${rows.length ? badge(`${rows.length}${panel.key === 'replies' && data.more_replies ? '+' : ''}`, panel.tone) : ''}</div>
      ${rows.length ? rows.map(row => `<a class="queue-row" href="${h(row.href)}"><div class="row-main"><strong>${h(row.person || row.company)}</strong>
        <small>${h(panel.key === 'drafts' ? row.description : row.person ? row.company : row.description || row.company)}</small></div>${panel.label(row)}${navArrow()}</a>`).join('') : emptyState(panel.empty)}
      ${panel.key === 'replies' && data.more_replies ? `<div class="pagination">${btn('Show remaining replies', { action: 'reload' })}</div>` : ''}</section>`;
  }).join('')}</div>`;
}

function filters(kind, query, context, expanded = Boolean(query.size)) {
  const val = key => query.get(key) ?? '';
  const search = `<div class="search">${field('Search', 'q', val('q'), { type: 'search', max: 180, placeholder: 'Name or company', glyph: 'search' })}</div>`;
  const client = select('Client', 'client_id', names(context.clients), val('client_id'), 'All clients');
  const owner = select('Owner', 'owner_id', names(context.owners), val('owner_id'), 'All owners');
  let content;
  if (kind === 'metrics') content = `${owner}${client}${field('From', 'from', val('from'), { type: 'date' })}${field('To', 'to', val('to'), { type: 'date' })}`;
  else if (kind === 'suggestions') content = `${search}${client}${select('Status', 'status', [
    { id: 'pending', name: 'Pending review' }, { id: 'approved', name: 'Approved' }, { id: 'dismissed', name: 'Dismissed' }, { id: 'all', name: 'All statuses' },
  ], val('status') || 'pending')}${field('Source', 'source', val('source'), { max: 160, placeholder: 'Any source' })}${field('Fit', 'fit', val('fit'), { max: 120, placeholder: 'Any rating' })}`;
  else content = `${search}${client}${owner}${select('Follow-ups', 'due', [
    { id: 'due', name: 'Due or overdue' }, { id: 'scheduled', name: 'Scheduled' },
  ], val('due'), 'All cards')}`;
  return `<details class="filter-panel" ${expanded ? 'open' : ''}>${disclosure(kind === 'metrics' ? 'Filters' : 'Search & filters', kind === 'metrics' ? 'settings' : 'search')}
    <form class="filters" data-form="filter">${content}<div class="wide actions">${btn('Apply filters', { type: 'submit' })}${query.size ? btn('Clear', { action: 'clear-filters', kind: 'quiet' }) : ''}</div></form></details>`;
}

export function boardCard(row, zone) {
  const due = row.due_at && new Date(row.due_at) <= new Date();
  return `<a class="board-card" href="/pipeline/cards/${pathId(row.id)}" draggable="true" data-card="${h(row.id)}" data-version="${row.version}" data-stage="${h(row.stage)}">
    <div class="board-identity"><span class="contact-avatar ${stages[row.stage].tone}" aria-hidden="true">${h(initials(row.person || row.company))}</span>${identity(row)}
    <span class="drag-grip">${icon('grip')}</span></div>
    <div class="chips">${due ? badge('Follow-up due', 'amber', 'clock') : row.suggestion_id ? badge('Approved lead', 'green', 'check') : row.outcome ? badge(row.outcome, 'green', 'check') : ''}</div>
    <dl><dt>${icon('user')}Owner</dt><dd>${h(row.owner_name)}</dd><dt>${icon('history')}Last touch</dt><dd>${h(formatDate(row.last_touch, zone))}</dd>
    <dt>${icon('flag')}Next step</dt><dd>${h(row.next_step || '—')}</dd><dt>${icon('clock')}In stage</dt><dd>${h(stageDuration(row.entered_at))}</dd>
    ${row.due_at ? `<dt>${icon('today')}Follow-up</dt><dd>${h(formatDate(row.due_at, zone))}</dd>` : ''}</dl></a>`;
}

export function boardPage(groups, context, query, zone, currentStage) {
  const addContact = btn('Add contact', { kind: 'primary', glyph: 'plus', action: 'add-card' });
  const emptyBoard = !context.clients.length || (!query.size && groups.every(group => group.total === 0));
  const top = `${heading('Partner pipeline', 'Track outreach and introductions.', emptyBoard ? '' : addContact, { art: 'signal-pipeline', signature: true })}
    ${toolbar('board', filters('board', query, context))}`;
  if (emptyBoard) {
    return `${top}<section class="panel flush">${context.clients.length
      ? illustratedState('pipeline-board', 'No contacts yet', 'Add a contact to start tracking introductions.', addContact)
      : illustratedState('pipeline-board', 'No clients yet', context.user.role === 'admin'
        ? 'Add a client before creating a pipeline card.' : 'Pipeline cards appear here when you have access to a client.',
      link('/clients', 'Open clients', 'arrow'))}</section>`;
  }
  return `${top}
    <div class="stage-picker" aria-label="Visible stage">${groups.map(group => `<button type="button" class="button" data-action="pick-stage"
      data-stage="${h(group.stage)}" aria-pressed="${group.stage === currentStage}"><span class="stage-label">${icon(stages[group.stage].glyph)}<span>${h(stages[group.stage].label)}</span></span>${badge(group.total)}</button>`).join('')}</div>
    <div class="board">${groups.map(group => `<section class="board-column ${group.stage === currentStage ? 'active' : ''}" data-column="${h(group.stage)}">
      <div class="column-heading"><span class="stage-icon ${stages[group.stage].tone}">${icon(stages[group.stage].glyph)}</span>
        <h2>${h(stages[group.stage].label)}</h2><span class="drop-hint" aria-hidden="true">${icon('arrow')} Drop here</span><span data-stage-count>${badge(group.total, stages[group.stage].tone)}</span></div>
      <div class="column-list">${group.items.length ? group.items.map(row => boardCard(row, zone)).join('') : emptyState('No contacts in this stage.')}</div>
      ${group.total > group.items.length ? `<div class="pagination">${btn('Load more', { action: 'more-cards', data: `data-stage="${h(group.stage)}" data-next="${group.items.length}"` })}</div>` : ''}
    </section>`).join('')}</div>`;
}

export function createCardForm(context) {
  return subjectForm('add-card', '', `${fieldset(`${select('Client', 'client_id', names(context.clients))}${field('Company', 'company', '', { required: true, max: 180 })}
    ${field('Contact name', 'person', '', { max: 150 })}${field('Email', 'email', '', { type: 'email', max: 254 })}
    ${field('Next step', 'next_step', '')}${field('Follow-up', 'due_at', '', { type: 'datetime-local' })}`)}
    <div class="actions">${btn('Add to To Contact', { kind: 'primary', type: 'submit', glyph: 'leads' })}</div>`);
}

function cardEdit(data, toStage) {
  const { card, owners } = data;
  const chosen = toStage || card.stage;
  return `<details class="panel" id="edit-card" ${toStage ? 'open' : ''}>${disclosure('Edit contact & stage', 'edit')}${subjectForm('card-edit', card.id,
    `${hidden('version', card.version)}${fieldset(`${field('Company', 'company', card.company, { required: true, max: 180 })}
    ${field('Contact name', 'person', card.person, { max: 150 })}${field('Job title', 'title', card.title, { max: 160 })}
    ${field('Email', 'email', card.email, { type: 'email', max: 254 })}${select('Owner', 'owner_id', names(owners), card.owner_id)}
    ${select('Stage', 'stage', stageOptions, chosen)}${field('Next step', 'next_step', card.next_step)}
    ${field('Follow-up (your local time)', 'due_at', localInput(card.due_at), { type: 'datetime-local' })}
    ${field('Branded relationship', 'branded_relationship', card.branded_relationship, { max: 600 })}
    <div data-outcome class="wide" ${chosen === 'closed' ? '' : 'hidden'}>${field('Closure outcome', 'outcome', card.outcome)}</div>`)}
    <div class="actions">${btn('Save changes', { kind: 'primary', type: 'submit' })}</div>`)}</details>`;
}

function draftForm(card, draft) {
  const current = draft ?? { id: '', subject: '', recipient: card.email, body: '', updated_at: '' };
  return subjectForm('draft', card.id, `${hidden('draft_id', current.id)}${hidden('updated_at', current.updated_at)}
    ${field('Recipient', 'recipient', current.recipient, { type: 'email', max: 254 })}${field('Subject', 'subject', current.subject, { required: true })}
    ${field('Email body', 'body', current.body, { type: 'textarea', max: 12000, required: true })}
    <div class="actions">${btn('Save draft', { type: 'submit', glyph: 'draft' })}${btn('Copy draft', { action: 'copy-draft', glyph: 'copy' })}
    ${btn('Open in email app', { action: 'mail-draft', glyph: 'mail', kind: 'primary' })}</div>`);
}

function cardDrafts(card, drafts, hash, zone) {
  const active = drafts.filter(row => !['sent', 'cancelled'].includes(row.status));
  const wanted = hash.startsWith('#draft-') ? hash.slice(7) : '';
  const draft = active.find(row => row.id === wanted) ?? active[0];
  if (card.stage === 'closed' || (!draft && wanted)) return `<section class="panel" id="draft">${emptyState(card.stage === 'closed' ? 'Card closed.' : 'That draft is no longer awaiting review.')}</section>`;
  if (!draft) return `<details class="panel" id="draft">${disclosure('Write a draft', 'draft')}${draftForm(card)}</details>`;
  return `<section class="panel stack" id="draft-${h(draft.id)}"><div id="draft" class="section-head">${sectionLabel('Follow-up draft', 'draft', 'violet')}<div class="chips">
    ${badge(statusName(draft.status), 'amber')}${badge(draft.source === 'claude' ? 'Claude draft' : draft.source === 'template' ? 'Template draft' : 'Staff draft', 'violet')}</div></div>
    ${draftForm(card, draft)}${draft.status !== 'reviewed' ? btn('Mark reviewed', { action: 'review-draft', kind: 'quiet', data: `data-card="${h(card.id)}" data-id="${h(draft.id)}" data-version="${h(draft.updated_at)}"` }) : ''}
    ${active.length > 1 ? `<details><summary>Other saved drafts</summary>${active.filter(row => row.id !== draft.id).map(row =>
      `<a class="list-row" href="/pipeline/cards/${pathId(card.id)}#draft-${pathId(row.id)}"><div class="row-main"><strong>${h(row.subject)}</strong><small>${h(formatDate(row.updated_at, zone))}</small></div>${navArrow()}</a>`).join('')}</details>` : ''}</section>`;
}

export function activityItems(rows, zone) {
  const kind = { sent: 'Sent email', reply: 'Reply', note: 'Note', stage: 'Stage change', draft: 'Draft saved', introduction: 'Introduction' };
  const glyph = { sent: 'mail', reply: 'reply', note: 'edit', stage: 'board', draft: 'draft', introduction: 'team' };
  return rows.map(row => `<article class="activity" id="activity-${h(row.id)}" tabindex="-1">
    <div class="line-title"><span class="activity-icon">${icon(glyph[row.kind] ?? 'history')}</span><strong>${h(kind[row.kind] ?? row.kind)}</strong>${row.actor === 'claude' ? badge('Claude', 'violet') : ''}</div>
    <div class="muted">${h(timeLabel(row.occurred_at, zone))}${row.actor !== 'claude' ? ` · ${h(row.actor)}` : ''}</div>
    ${row.subject ? `<p><strong>${h(row.subject)}</strong></p>` : ''}${row.body ? `<p class="multiline">${h(row.body)}</p>` : ''}
    ${row.kind === 'stage' ? `<p class="muted">${h(stages[row.detail.from]?.label)} → ${h(stages[row.detail.to]?.label)}${row.detail.entered_at ? ` · ${h(stageDuration(row.detail.entered_at, row.occurred_at))} in ${h(stages[row.detail.from]?.label)}` : ''}</p>` : ''}
    ${row.kind === 'introduction' && row.detail.status ? `<p class="muted">${h(row.detail.status)}</p>` : ''}
    ${['sent','reply'].includes(row.kind) && !row.outlook_message_id ? `<details><summary class="small">Link Outlook message ID</summary>${subjectForm('link-mail', row.id,
      `${hidden('card_id', row.card_id)}${field('Mailbox scope', 'mailbox_scope', '', { required: true, max: 160 })}${field('Message ID', 'outlook_message_id', '', { required: true, max: 1000 })}
      <div>${btn('Link message', { type: 'submit' })}</div>`)}</details>` : ''}
  </article>`).join('');
}

function logForm(card, drafts) {
  return `<details>${disclosure('Log activity', 'plus')}${subjectForm('activity', card.id, `${select('Activity', 'kind', [{ id: 'note', name: 'Note' }, { id: 'sent', name: 'Sent email' }, { id: 'reply', name: 'Reply' }], 'note')}
    <div class="stack" data-mail-fields hidden>${field('Occurred (your local time)', 'occurred_at', localInput(new Date()), { type: 'datetime-local' })}
    ${field('Subject', 'subject', '')}<div data-sent-field hidden>${select('Matching draft', 'draft_id', drafts.filter(row => !['sent', 'cancelled'].includes(row.status)).map(row => ({ id: row.id, name: row.subject })), '', 'None selected')}</div>
    <details><summary class="small">Outlook message ID (optional)</summary>${fieldset(`${field('Mailbox scope', 'mailbox_scope', '', { max: 160 })}${field('Message ID', 'outlook_message_id', '', { max: 1000 })}`)}</details></div>
    ${field('Notes or excerpt', 'body', '', { type: 'textarea', max: 12000 })}<div>${btn('Record activity', { type: 'submit', kind: 'primary' })}</div>`)}</details>`;
}

export function cardPage(data, zone, toStage, hash) {
  const { card, drafts, history } = data;
  const fields = [['Client', card.client_name], ['Owner', card.owner_name], ['Next step', card.next_step || '—'], ['Time in stage', stageDuration(card.entered_at)],
    ['Last touch', timeLabel(card.last_touch, zone)], ['Follow-up', timeLabel(card.due_at, zone)], ['Closure outcome', card.outcome || '—']];
  return `${link('/pipeline', 'Back to pipeline', 'back', 'back-link')}${heading(card.person || card.company, card.person ? card.company : '',
    stageBadge(card.stage), { art: 'contact-profile', compact: true })}
    <div class="detail-grid"><div class="stack"><section class="panel stack"><dl class="summary-grid">${fields.filter(([key]) => key !== 'Closure outcome' || card.stage === 'closed').map(([label, value]) =>
      `<div><dt>${h(label)}</dt><dd>${h(value)}</dd></div>`).join('')}</dl>
      ${card.fit_reason ? `<div><h3>Why it fit</h3><p class="muted multiline">${h(card.fit_reason)}</p>
        ${card.suggestion_id ? link(`/pipeline/suggestions/${pathId(card.suggestion_id)}`, 'View lead evidence', 'arrow', 'small') : ''}</div>` : ''}
      ${card.branded_relationship ? `<div><h3>Branded relationship</h3><p class="muted multiline">${h(card.branded_relationship)}</p></div>` : ''}
      ${card.followup_id ? `<div>${btn('Complete follow-up', { action: 'complete-followup', glyph: 'check', data: `data-card="${h(card.id)}" data-id="${h(card.followup_id)}"` })}</div>` : ''}</section>
      ${cardEdit(data, toStage)}${cardDrafts(card, drafts, hash, zone)}</div>
      <section class="panel"><div class="section-head">${sectionLabel('Activity', 'history')}</div>${logForm(card, drafts)}
      <div id="activity-list">${history.items.length ? activityItems(history.items, zone) : emptyState('No activity recorded yet.')}</div>
      ${history.next_cursor ? `<div class="pagination">${btn('Load older activity', { action: 'more-activity', data: `data-id="${h(card.id)}" data-next="${history.next_cursor}"` })}</div>` : ''}</section></div>`;
}

export function metricsPage(data, context, query, zone) {
  const applied = new URLSearchParams(query);
  if (!applied.has('from')) applied.set('from', data.from);
  if (!applied.has('to')) applied.set('to', data.to);
  const noActivity = data.contacts === 0 && data.sent === 0 && data.replies === 0;
  const top = `${heading('Pipeline metrics', 'See outreach, replies, and time in each stage.', '', { art: 'pipeline-insights' })}${toolbar('metrics', filters('metrics', applied, context, Boolean(query.size)))}
    <div class="stat-grid">${[
      ['Contacts', data.contacts, 'blue', icon('clients')], ['Overdue follow-ups', data.overdue, 'amber', icon('today')],
      ['Sends logged', data.sent, 'violet', icon('mail')], ['Replies logged', data.replies, 'green', icon('reply')],
    ].map(([label, value, tone, glyph]) => `<div class="panel stat"><span class="panel-icon ${tone}">${glyph}</span><div><strong>${value}</strong><span class="stat-label">${label}</span></div></div>`).join('')}</div>`;
  if (noActivity) {
    return `${top}<section class="panel flush">${illustratedState('pipeline-insights', 'No activity in this view',
      context.clients.length ? 'Change the filters to see other dates, clients, or owners.' : 'Track contacts and outreach to see metrics here.')}</section>`;
  }
  return `${top}
    <div class="grid-two"><section class="panel"><div class="section-head">${sectionLabel('Contacts by stage', 'board')}</div>
      ${data.stages.map(row => `<div class="metric-row" data-stage="${h(row.stage)}"><span class="stage-label">${icon(stages[row.stage].glyph)}<span>${h(stages[row.stage].label)}</span></span><progress aria-label="${h(stages[row.stage].label)}" max="${Math.max(1, ...data.stages.map(s => s.count))}" value="${row.count}"></progress><strong>${row.count}</strong></div>`).join('')}</section>
      <section class="panel"><div class="section-head">${sectionLabel('Time in stage', 'clock', 'violet')}</div><table class="data-table"><thead><tr><th scope="col">Stage</th><th scope="col">Median days</th></tr></thead>
      <tbody>${data.stages.map(row => `<tr><td>${h(stages[row.stage].label)}</td><td>${row.median_days ?? '—'}</td></tr>`).join('')}</tbody></table></section></div>
    <p class="muted small">Stage snapshot ${h(timeLabel(data.snapshot_at, zone))}. Outreach totals use logged mail dates.</p>`;
}

export function suggestionRows(rows) {
  return rows.map(row => `<a href="/pipeline/suggestions/${pathId(row.id)}" class="list-row suggestion-row"><div class="suggestion-identity"><span class="panel-icon violet">${icon('shortlist')}</span>${identity(row)}</div>
    <div class="suggestion-source"><small>Source</small>${badge(row.source, 'blue')}</div>
    <div class="chips">${badge(row.fit)}${row.score === null ? '' : badge(`Score ${row.score}`, 'violet')}
    ${row.status !== 'pending' ? badge(statusName(row.status), row.status === 'approved' ? 'green' : 'neutral') : ''}</div>${navArrow()}</a>`).join('');
}

export function suggestionsPage(data, context, query) {
  const empty = query.size ? emptyState('No matching suggestions.')
    : illustratedState('suggested-connections', 'No suggestions to review', 'New leads will appear here when they’re ready for review.');
  return `${heading('Suggested leads', 'Review the fit and source before adding a contact to the pipeline.', '',
    { art: 'signal-leads' })}${toolbar('suggestions', filters('suggestions', query, context))}
    <section class="panel flush"><div id="suggestion-list">${data.items.length ? suggestionRows(data.items) : empty}</div>${pageMore('more-suggestions', data.next_offset)}</section>`;
}

export function suggestionPage(row) {
  return `${link('/pipeline/suggestions', 'Back to suggested leads', 'back', 'back-link')}
    ${heading(row.person || row.company, row.person ? [row.title, row.company].filter(Boolean).join(' · ') : row.client_name,
      badge(statusName(row.status), row.status === 'approved' ? 'green' : 'blue'), { art: 'contact-profile', compact: true })}
    <div class="detail-grid"><section class="panel stack"><div>${sectionLabel('Why it fits', 'target', 'violet')}<p class="multiline section-copy">${h(row.reason)}</p></div>
    <dl class="summary-grid">${[['Client', row.client_name], ['Source', row.source], ['Fit', row.fit], ['Score', row.score ?? '—'], ['Branded relationship', row.branded_relationship]]
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${h(value)}</dd></div>`).join('')}</dl>
    ${row.status === 'pending' ? `<div class="actions">${btn('Approve to pipeline', { action: 'decide', kind: 'primary', glyph: 'check', data: `data-id="${h(row.id)}" data-decision="approved"` })}
      ${btn('Dismiss', { action: 'decide', data: `data-id="${h(row.id)}" data-decision="dismissed"` })}</div>` : row.card_id ? link(`/pipeline/cards/${pathId(row.card_id)}`, 'Open pipeline card', 'arrow') : ''}
    </section><section class="panel"><div class="section-head">${sectionLabel('Evidence', 'stack')}</div>${row.evidence.length ? row.evidence.map(item => `<div class="evidence"><strong>${h(item.source)}</strong>
      <p class="muted multiline">${h(item.detail)}</p>${item.reference ? `<p class="small wrap">${outboundLink(item.reference)}</p>` : ''}</div>`).join('') : emptyState('No evidence was included.')}</section></div>`;
}

export function clientRows(rows, zone) {
  const accents = ['iris', 'sky', 'rose', 'mint'];
  return rows.map(row => {
    const shade = [...row.name].reduce((hash, char) => (hash * 31 + char.codePointAt(0)) >>> 0, 0) % accents.length;
    return `<a class="client-card" data-accent="${accents[shade]}" href="/clients/${pathId(row.id)}">
      <span class="client-watermark">${icon('building')}</span>
      <div class="client-card-top"><span class="client-mark" aria-hidden="true">${h(initials(row.name))}</span>
        <div class="row-main"><strong>${h(row.name)}</strong><small>${icon('user')}<span>${h(row.owner_name)}</span></small></div>
        <span class="client-open">${icon('arrow')}</span></div>
      <div class="client-facts"><span class="client-count">${icon('board')}${row.open_cards} open ${row.open_cards === 1 ? 'card' : 'cards'}</span>
        ${row.latest_submission ? badge(`Intake ${formatDate(row.latest_submission, zone)}`, 'green', 'check') : badge('No intake yet', 'neutral', 'draft')}</div></a>`;
  }).join('');
}

export function clientsPage(data, query, user, zone) {
  return `${heading('Clients', 'Manage onboarding and see each client’s open contacts.', user.role === 'admin' ? btn('Add client', { action: 'add-client', glyph: 'plus', kind: 'primary' }) : '',
    { art: 'signal-clients', signature: true })}
    <form class="client-search" data-form="filter">${field('Search clients', 'q', query.get('q'), { type: 'search', placeholder: 'Client name', max: 180, glyph: 'search' })}
    <div class="actions">${btn('Search', { type: 'submit' })}${query.size ? btn('Clear', { action: 'clear-filters', kind: 'quiet' }) : ''}</div></form>
    <section aria-label="Client directory"><div class="client-grid" id="client-list">${data.items.length ? clientRows(data.items, zone) : `<div class="panel">${emptyState('No matching clients.')}</div>`}</div>${pageMore('more-clients', data.next_offset)}</section>`;
}

const checkboxes = (label, key, rows, selected = []) => `<fieldset class="repeater"><legend>${h(label)}</legend><div class="check-list">${rows.map(row =>
  `<label class="check"><input type="checkbox" name="${h(key)}" value="${h(row.id)}"${selected.includes(row.id) ? ' checked' : ''}>${h(row.name)}</label>`).join('')}</div></fieldset>`;

export function clientForm(context, data) {
  const client = data?.client;
  const owners = context.owners.filter(row => row.enabled || row.id === client?.owner_id);
  return subjectForm(client ? 'client-edit' : 'add-client', client?.id, `${field('Client name', 'name', client?.name, { required: true, max: 180 })}
    ${select('Client owner', 'owner_id', names(owners), client?.owner_id ?? context.user.id)}${checkboxes('Additional client access', 'member_ids', owners, data?.member_ids)}
    <div>${btn(client ? 'Save client' : 'Add client', { kind: 'primary', type: 'submit' })}</div>`);
}

export function submissionRows(rows, clientId, zone) {
  return rows.map(row => `<a class="list-row" href="/clients/${pathId(clientId)}/submissions/${pathId(row.id)}"><span class="panel-icon blue">${icon('intake')}</span>
    <div class="row-main"><strong>Submission ${row.version}</strong><small>${h(timeLabel(row.submitted_at, zone))}${row.source_ref ? ' · Imported' : ''}</small></div>${navArrow()}</a>`).join('');
}

export function clientPage(data, context, zone) {
  const { client, submissions, link: active } = data;
  return `${link('/clients', 'Back to clients', 'back', 'back-link')}${heading(client.name, `Owner · ${client.owner_name}`, '', { art: 'signal-clients', compact: true })}
    <div class="grid-two"><section class="panel stack"><div class="onboarding-entry"><div>${sectionLabel('Solutions Partner Onboarding', 'link')}<p class="muted section-copy">Share a form link so the client can enter their answers.</p></div>
    <img src="/assets/artwork/signal-intake.webp" width="96" height="64" loading="lazy" decoding="async" alt=""></div>
    <div class="actions">${btn('Copy form link', { action: 'form-link', glyph: 'link', kind: 'primary', data: `data-id="${h(client.id)}"` })}</div>
    ${active ? `<div class="muted">Active link expires ${h(formatDate(active.expires_at, zone))}.</div><details>${disclosure('Link settings', 'settings')}
      ${btn('Revoke active link', { action: 'revoke-form', kind: 'danger', data: `data-id="${h(client.id)}"` })}</details>` : ''}</section>
    <section class="panel flush"><div class="panel-title"><span class="panel-icon violet">${icon('history')}</span><h2>Submission history</h2></div><div id="submission-list">
    ${submissions.items.length ? submissionRows(submissions.items, client.id, zone)
      : illustratedState('client-onboarding', 'No submissions yet', 'Completed forms will appear here.')}</div>
    ${submissions.next_cursor ? `<div class="pagination">${btn('Load older submissions', { action: 'more-submissions', data: `data-id="${h(client.id)}" data-next="${submissions.next_cursor}"` })}</div>` : ''}</section></div>
    ${context.user.role === 'admin' ? `<details class="panel">${disclosure('Client settings', 'settings')}${clientForm(context, data)}
      <div class="actions">${btn('Delete client', { action: 'delete-client', kind: 'danger', glyph: 'close', data: `data-id="${h(client.id)}" data-name="${h(client.name)}"` })}</div></details>` : ''}`;
}

function answerValue(value) {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return outboundLink(value);
  return `<span class="multiline">${h(value === '' || value === undefined ? 'Not provided' : value)}</span>`;
}

export function submissionPage(row, zone) {
  const clientPath = `/clients/${pathId(row.client_id)}`;
  return `${link(clientPath, 'Back to client', 'back', 'back-link')}${heading(`${row.client_name} onboarding`,
    `Submission ${row.version} · ${timeLabel(row.submitted_at, zone)}`, `<a class="button" href="/api${clientPath}/submissions/${pathId(row.id)}/pdf" download>${icon('download')}Export PDF</a>`,
    { art: 'signal-intake', compact: true })}
    <div class="grid-two">${sections.map(section => `<section class="panel submission-section"><h2>${h(section.title)}</h2><dl>${section.fields.map(field => {
      const answer = row.answers[field.key];
      const value = field.rows && Array.isArray(answer) && answer.length ? answer.map(item => `<div class="evidence">${field.rows.filter(child => item[child.key]).map(child =>
        `<p>${h(child.label)} · ${answerValue(item[child.key])}</p>`).join('')}</div>`).join('') : answerValue(answer);
      return `<div class="submission-field"><dt>${h(field.label)}</dt><dd>${value}</dd></div>`;
    }).join('')}</dl></section>`).join('')}</div>`;
}

function repeatField(definition, rows) {
  return `<fieldset class="repeater"><legend>${h(definition.label)}</legend>${rows.map((item, index) => `<div class="repeat-row stack">
    ${fieldset(definition.rows.map(child => field(child.label, `rows|${definition.key}|${index}|${child.key}`, item[child.key], child)).join(''))}
    <div>${btn('Remove', { action: 'remove-row', kind: 'quiet', glyph: 'close', data: `data-key="${h(definition.key)}" data-index="${index}" aria-label="Remove ${h(definition.label)} entry ${index + 1}"` })}</div></div>`).join('')}
    ${btn(definition.add, { action: 'add-row', glyph: 'plus', data: `data-key="${h(definition.key)}"` })}</fieldset>`;
}

export function intakePage(info, key, step, answers) {
  if (info.submitted) return `<div class="form-page">${brand()}${heading('Response submitted', info.client_name)}
    <section class="panel flush">${illustratedState('client-onboarding', 'Thank you', 'Your responses have been saved and shared with the Solutions team.')}</section></div>`;
  const section = sections[step];
  const stepGlyph = ['building', 'target', 'leads', 'board', 'stack', 'team'][step];
  return `<div class="form-page">${brand()}${heading('Solutions Partner Onboarding', info.client_name, '', { art: 'signal-intake', compact: true })}<div class="step-bar"><span class="step-label"><span class="step-icon">${icon('intake')}</span>Step ${step + 1} of ${sections.length}</span>
    <progress class="visually-hidden" value="${step + 1}" max="${sections.length}" aria-label="Onboarding progress"></progress>
    <div class="step-segments" aria-hidden="true">${sections.map((_, i) => `<span${i <= step ? ` class="${i === step ? 'current' : 'complete'}"` : ''}></span>`).join('')}</div></div>
    <section class="panel"><div class="section-head">${sectionLabel(section.title, stepGlyph)}</div>${subjectForm('intake', key, `${fieldset(section.fields.map(definition =>
      definition.rows ? `<div class="wide">${repeatField(definition, answers[definition.key] ?? [])}</div>` :
        `<div class="${definition.type === 'textarea' ? 'wide' : ''}">${field(definition.label, definition.key, answers[definition.key], { ...definition, min: definition.type === 'number' ? 0 : undefined })}</div>`).join(''))}
      ${step === sections.length - 1 ? '<p class="muted">Review earlier sections with Back, then submit your answers.</p>' : ''}
      <div class="wizard-footer"><div class="actions">${step ? btn('Back', { action: 'intake-back', glyph: 'back' }) : ''}${btn('Save draft', { action: 'intake-save', kind: 'quiet', glyph: 'draft' })}</div>
      ${btn(step < sections.length - 1 ? 'Save and continue' : 'Submit answers', { type: 'submit', kind: 'primary', endGlyph: step < sections.length - 1 ? 'arrow' : 'check' })}</div>`)}</section></div>`;
}

export function alertRows(data, zone) {
  return data.items.length ? data.items.map(row => `<a class="list-row" href="${h(row.href)}" data-event-id="${h(row.id)}">
    <span class="panel-icon ${row.seen_at ? 'neutral' : 'blue'}">${icon(row.type === 'reply_logged' ? 'reply' : row.type === 'onboarding_submitted' ? 'draft' : 'today')}</span>
    <div class="row-main"><strong>${h(row.title)}</strong><small>${h(row.client_name)} · ${h(timeLabel(row.occurred_at, zone))}</small></div>${row.seen_at ? '' : badge('New', 'blue')}${navArrow()}</a>`).join('') : emptyState('You’re caught up.');
}

const adminSections = [['accounts', 'Accounts', 'team'], ['audit', 'Audit log', 'history'], ['import', 'Import JSON', 'upload'], ['mcp', 'MCP access', 'lock']];
const roleOptions = [{ id: 'member', name: 'Member' }, { id: 'admin', name: 'Admin' }];

function accountList(rows) {
  return `<div class="panel flush admin-list">${rows.map(user => `<details><summary><strong>${h(user.name)}</strong><small>${h(user.role === 'admin' ? 'Admin' : 'Member')} · ${user.enabled ? user.has_password ? 'Active' : 'Invited' : 'Disabled'}</small></summary>
    <p class="muted wrap">${h(user.email)}</p>${subjectForm('edit-account', user.id, `${fieldset(`${field('Name', 'name', user.name, { max: 100, required: true })}
    ${select('Role', 'role', roleOptions, user.role)}${select('Status', 'enabled', [{ id: 'true', name: 'Enabled' }, { id: 'false', name: 'Disabled' }], user.enabled ? 'true' : 'false')}
    ${field('Read-only MCP subject', 'oauth_subject', user.oauth_subject, { max: 300 })}`)}
    <label class="check"><input type="checkbox" name="onboarding_alerts" ${user.onboarding_alerts ? 'checked' : ''}>Receive onboarding alerts</label>
    <div class="actions">${btn('Save account', { type: 'submit', kind: 'primary' })}${user.enabled ? btn('Copy setup link', { action: 'setup-link', data: `data-id="${h(user.id)}"` }) : ''}</div>`)}</details>`).join('')}</div>`;
}

export function inviteForm() {
  return subjectForm('invite-account', '', `${field('Name', 'name', '', { required: true, max: 100 })}${field('Email', 'email', '', { type: 'email', required: true, max: 254 })}
    ${select('Role', 'role', roleOptions, 'member')}<div>${btn('Create setup link', { type: 'submit', kind: 'primary' })}</div>`);
}

export function auditRows(rows, zone) {
  return rows.map(row => `<article class="admin-row"><strong>${h(row.action.replaceAll('.', ' · ').replaceAll('_', ' '))}</strong>
    <span class="muted">${h(row.actor === 'claude' ? 'Claude' : row.actor)} · ${h(timeLabel(row.at, zone))}</span>
    <small>${h(row.entity)}${row.entity_id ? ` · ${h(row.entity_id)}` : ''}</small>
    ${Object.keys(row.details).length ? `<details><summary class="small">Details</summary><code class="multiline">${h(JSON.stringify(row.details, null, 2))}</code></details>` : ''}</article>`).join('');
}

export function importPreview(result) {
  if (!result) return '';
  const labels = { clients: 'Clients', partners: 'Partner records', introductions: 'Introductions', outreach_activity: 'Outreach history',
    suggested_leads: 'Open suggestions', onboarding_submissions: 'Onboarding submissions' };
  return `<section class="panel stack"><h2>${result.applied ? 'Import complete' : 'Import preview'}</h2><table class="data-table"><thead><tr>
    <th scope="col">Records</th><th scope="col">Add</th><th scope="col">Skip</th><th scope="col">Errors</th></tr></thead><tbody>${Object.entries(result.counts).map(([key, count]) =>
      `<tr><td>${h(labels[key] ?? key)}</td><td>${count.added}</td><td>${count.skipped}</td><td>${count.invalid}</td></tr>`).join('')}</tbody></table>
    ${result.errors.length ? `<div class="error" role="alert"><strong>Resolve these rows before importing.</strong><ul>${result.errors.map(error =>
      `<li>${h(error.set)} row ${error.row}: ${h(error.message)}</li>`).join('')}</ul></div>` : !result.applied ? `<div>${btn('Apply import', { action: 'apply-import', kind: 'primary' })}</div>` : ''}</section>`;
}

function tokenList(rows, context, zone) {
  return rows.length ? rows.map(row => `<div class="admin-row"><strong>${h(row.label)}</strong>
    <span class="muted">${row.all_clients ? 'All clients' : h(row.client_ids.map(id => context.clients.find(client => client.id === id)?.name ?? 'Client').join(', '))} · ${row.revoked_at ? 'Revoked' : `Expires ${h(formatDate(row.expires_at, zone))}`}</span>
    ${!row.revoked_at ? `<div>${btn('Revoke credential', { action: 'revoke-job', kind: 'danger', data: `data-id="${h(row.id)}"` })}</div>` : ''}</div>`).join('') : emptyState('No Claude job credentials.');
}

export function jobTokenForm(context) {
  return subjectForm('new-job', '', `${field('Credential label', 'label', 'Claude scheduled job', { required: true, max: 100 })}
    ${field('Expires in days', 'days', 90, { type: 'number', min: 1, required: true })}
    <label class="check"><input type="checkbox" name="all_clients">All clients, including future clients</label>
    ${checkboxes('Or choose specific clients', 'client_ids', context.clients)}<div>${btn('Create credential', { kind: 'primary', type: 'submit' })}</div>`);
}

export function adminPage(tab, data, context, query, zone, preview) {
  const nav = `<nav class="subnav admin-tabs" aria-label="Admin sections">${adminSections.map(([key, label, glyph]) => `<a href="/admin?tab=${key}"${key === tab ? ' aria-current="page"' : ''}>${icon(glyph)}${label}</a>`).join('')}</nav>`;
  let content;
  if (tab === 'audit') content = `<form class="filters" data-form="filter">${hidden('tab', 'audit')}
    ${select('User', 'user_id', names(data.users), query.get('user_id'), 'All actors')}${field('Action', 'action', query.get('action'), { placeholder: 'e.g. card.stage_changed', max: 100 })}
    <div class="actions">${btn('Apply filters', { type: 'submit' })}</div></form>
    <section class="panel flush"><div id="audit-list">${data.items.length ? auditRows(data.items, zone) : emptyState('No matching audit events.')}</div>${pageMore('more-audit', data.next)}</section>`;
  else if (tab === 'import') content = `<div class="stack"><section class="panel stack"><div><h2>Seed existing records</h2><p class="muted">Preview a version 1 JSON export, review its counts, then apply it.</p></div>
    ${subjectForm('preview-import', '', `<label class="field"><span>JSON export</span><input type="file" name="file" accept=".json,application/json" required></label><div>${btn('Preview import', { kind: 'primary', type: 'submit', glyph: 'upload' })}</div>`)}</section>${importPreview(preview)}</div>`;
  else if (tab === 'mcp') content = `<div class="stack"><section class="panel stack"><div class="section-head">${sectionLabel('Claude job credentials', 'lock')}${btn('Create credential', { action: 'new-job', kind: 'primary', glyph: 'plus' })}</div>
    <p class="muted wrap">Endpoint · <code>${h(location.origin)}/mcp</code></p></section><div class="panel flush">${tokenList(data.items, context, zone)}</div></div>`;
  else content = `<div class="stack"><div class="section-head">${sectionLabel('Team accounts', 'team')}${btn('Invite user', { action: 'invite-account', glyph: 'plus', kind: 'primary' })}</div>${accountList(data.items)}</div>`;
  return `${heading('Admin', 'Manage accounts, activity, and workspace access.', '', { art: 'workspace-controls' })}${nav}${content}`;
}
