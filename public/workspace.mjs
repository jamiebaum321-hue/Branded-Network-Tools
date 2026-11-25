import { btn, emptyState, field, formatDate, h, hidden, icon, link, outboundLink, select } from './ui.mjs';
import { billingStates, kinds, labels, lines, money, stages, statuses, tiers } from './business-lines.mjs';
import { sections } from './intake-fields.mjs';

const choices = (values) => Object.entries(values).map(([id, name]) => ({ id, name }));
const options = (keys) => keys.map((id) => ({ id, name: stages[id] }));
const base = (line, id = '') => '/work/' + line + (id ? '/' + encodeURIComponent(id) : '');
const submit = (label) => btn(label, { kind: 'primary', type: 'submit' });
const form = (name, contents, id = '') =>
  `<form class="stack" data-form="${h(name)}" data-id="${h(id)}">${contents}</form>`;
const action = (label, name, id = '', glyph = '', kind = '') =>
  btn(label, { action: name, glyph, kind, data: `data-id="${h(id)}"` });
const panel = (title, contents, extra = '') =>
  `<section class="panel stack ${extra}"><h2>${h(title)}</h2>${contents}</section>`;
const skillLink = (name, label) =>
  `<a class="text-link" target="_blank" rel="noopener" href="/api/skills/branded-${name}">${icon('download')}${h(label)}</a>`;
const grid = (children) => `<div class="form-grid">${children}</div>`;
const fields = (values) =>
  `<dl class="deal-facts">${values.map(([k, v]) => `<div><dt>${h(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const tabs = (items, active, label) =>
  `<nav aria-label="${h(label)}" class="ws-tabs">${items.map(([id, name, url]) => `<a href="${h(url)}"${id === active ? ' aria-current="page"' : ''}>${h(name)}</a>`).join('')}</nav>`;
const urlWith = (path, query, change) => {
  const q = new URLSearchParams(query);
  for (const [k, v] of Object.entries(change))
    if (v) q.set(k, v);
    else q.delete(k);
  return path + (q.size ? '?' + q : '');
};
const date = (at, zone) => (at ? h(formatDate(at, zone)) : '—');
const followupDate = (row) => row.details.due || row.reply_followup?.due || '';
const stamp = (row) => {
  const due = followupDate(row);
  return due ? `<time datetime="${h(due)}">${h(due)}</time>` : '';
};
const currencyKeys = ['monthly', 'project_fee', 'target', 'raised'];
const workspaceKeys = {
  solutions: ['monthly', 'term', 'fee_percent', 'fee_terms', 'report_email'],
  media: [
    'campaign',
    'research_sources',
    'agency',
    'parent_agency',
    'advertiser',
    'open_signal',
    'project_fee',
    'package',
    'term',
  ],
  capital: ['target', 'raised', 'monthly', 'term', 'fee_percent', 'fee_terms'],
};
const billingKeys = [
  'billing_name',
  'billing_email',
  'billing_contacts',
  'billing_terms',
  'billing_state',
  'invoice_ref',
  'agreement_url',
];
const emailKeys = ['contact_email', 'billing_email', 'report_email'];
const longKeys = ['package', 'billing_terms', 'fee_terms', 'research_sources'];
const formField = (key, d = {}) => {
  if (key === 'billing_state')
    return select(
      labels[key],
      key,
      choices(billingStates),
      d[key] || 'pending'
    );
  if (key === 'open_signal')
    return select(
      labels[key],
      key,
      choices({ unknown: 'Unknown', observed: 'Observed in sending platform' }),
      d[key] || 'unknown'
    );
  if (currencyKeys.includes(key) || key === 'fee_percent')
    return `<label class="field"><span>${h(labels[key])}${currencyKeys.includes(key) ? ' (USD)' : ''}</span><input type="number" step="0.01" min="0" ${key === 'fee_percent' ? 'max="100"' : ''} name="${key}" value="${d[key] == null ? '' : h(currencyKeys.includes(key) ? d[key] / 100 : d[key])}"></label>`;
  return field(labels[key], key, d[key] || '', {
    type: emailKeys.includes(key)
      ? 'email'
      : key === 'due' || key === 'first_meeting_day'
        ? 'date'
        : key.endsWith('_url')
          ? 'url'
          : longKeys.includes(key)
            ? 'textarea'
            : 'text',
    max:
      {
        package: 4000,
        billing_terms: 1500,
        fee_terms: 2500,
        research_sources: 3000,
        agreement_url: 1200,
        source_url: 1200,
      }[key] || 300,
  });
};
function detailValue(key, value) {
  if (key === 'open_signal') return value === 'observed' ? 'Observed' : 'Unknown';
  if (key === 'billing_state') return h(billingStates[value || 'pending']);
  if (value === undefined || value === '') return '—';
  if (currencyKeys.includes(key)) return h(money(value));
  if (key === 'fee_percent') return h(value) + '%';
  if (key.endsWith('_url')) return outboundLink(value);
  return h(value);
}
function lineBar(allowed, line) {
  return `<nav class="line-bar" aria-label="Business line">${allowed.map((key) => `<a class="line-choice line-${h(key)}" href="${base(key)}" ${key === line ? 'aria-current="page"' : ''}><i aria-hidden="true"></i>${h(lines[key].name)}</a>`).join('')}</nav>`;
}
function boardCard(row, today) {
  const d = row.details;
  const next = d.next_action || row.reply_followup?.title;
  const due = followupDate(row);
  return `<a class="deal-card" draggable="true" data-deal="${h(row.id)}" data-version="${row.version}" data-stage="${h(row.stage)}" href="${base(row.line, row.id)}">
    <strong>${h(row.company)}</strong>${row.title !== row.company ? `<span>${h(row.title)}</span>` : ''}
    ${d.campaign || d.contact ? `<span class="quiet">${h([d.campaign, d.contact].filter(Boolean).join(' · '))}</span>` : ''}
    ${row.stage === 'first_meeting_scheduled' && d.first_meeting_day ? `<span>Meeting · <time datetime="${h(d.first_meeting_day)}">${h(d.first_meeting_day)}</time></span>` : ''}
    ${next ? `<span class="next-action">${h(next)}</span>` : ''}<small><span>${h(row.owner)}</span><span class="${due && due <= today ? 'ws-due' : ''}">${stamp(row)}</span></small></a>`;
}
function conversationRows(rows, zone) {
  if (!rows.length) return emptyState('No matching conversations.');
  return `<div class="ws-scroll"><table class="ws-table"><thead><tr>${['Company / campaign', 'Agency / advertiser', 'Last sent', 'Last reply', 'Last call or meeting', 'Open', 'Owner / next action'].map((t) => `<th>${t}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => {
      const d = r.details;
      const followup = r.reply_followup;
      return `<tr><td>${link(base(r.line, r.id), r.company)}<small>${h(d.campaign)}</small></td><td>${h([d.agency, d.parent_agency, d.advertiser].filter(Boolean).join(' · ') || '—')}</td><td>${date(r.last_sent, zone)}</td><td>${date(r.last_reply, zone)}<small>${h(r.last_reply_subject)}</small></td><td>${h(r.last_meeting || '—')}</td><td>${d.open_signal === 'observed' ? 'Observed' : 'Unknown'}</td><td>${h(r.owner)}<small>${h([d.next_action, d.due].filter(Boolean).join(' · '))}</small>${followup ? `<small>${h(followup.title)} · ${h(followup.due)}</small>` : ''}</td></tr>`;
    })
    .join('')}</tbody></table></div>`;
}
function milestones(rows, zone) {
  if (!rows.length) return emptyState('No clients in delivery.');
  return `<div class="ws-scroll"><table class="ws-table"><thead><tr><th>Client</th><th>Stage</th><th>Accounting handoff</th><th>Intake received</th><th>Last weekly update</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${link(base(r.line, r.id), r.company)}</td><td>${h(stages[r.stage])}</td><td>${h(mailStatus(r.billing_status) || '—')}</td><td>${date(r.intake_received, zone)}</td><td>${h(r.last_report || '—')}</td></tr>`).join('')}</tbody></table></div>`;
}
function projectBilling(rows) {
  if (!rows.length) return emptyState('No projects in delivery.');
  const body = rows.map((row) => `<tr>
    <td>${link(base(row.line, row.id), row.title)}${row.company !== row.title ? `<small>${h(row.company)}</small>` : ''}</td>
    <td>${h(stages[row.stage])}</td><td>${detailValue('billing_state', row.details.billing_state)}</td>
    <td>${h(row.details.invoice_ref || '—')}</td><td>${h(row.details.package || '—')}</td></tr>`);
  return `<div class="ws-scroll"><table class="ws-table"><thead><tr><th>Project</th><th>Delivery stage</th>
    <th>Invoice status</th><th>Invoice reference</th><th>Promised deliverables</th></tr></thead>
    <tbody>${body.join('')}</tbody></table></div>`;
}
const mailStatus = (k) =>
  ({
    queued: 'Queued',
    sending: 'Sending',
    accepted: 'Accepted by Microsoft 365',
    check_delivery: 'Verify delivery',
    failed: 'Failed',
  })[k] || '';
function pitchList(items, owners, user, zone) {
  const stateNames = {
    review: 'Needs classification',
    new: 'New',
    in_progress: 'In progress',
    closed: 'Closed',
    dismissed: 'Dismissed',
  };
  if (!items.length) return emptyState('No pitches in this queue.');
  return `<div class="stack">${items
    .map(
      (
        row
      ) => `<details class="panel"><summary><strong>${h(row.subject || 'Guest pitch')}</strong> · ${h(stateNames[row.status])}</summary><div class="stack">
    <p>${h(row.sender)} · ${date(row.received_at, zone)} · ${h(owners.find((u) => u.id === row.owner_id)?.name || 'Unassigned')}</p><p class="multiline">${h(row.body)}</p>
    ${row.source_url ? outboundLink(row.source_url) : ''}<p>Guest acknowledgement · ${h(mailStatus(row.ack_status) || 'Awaiting classification')}</p>
    ${form('ws-pitch', grid(select('Status', 'status', choices(stateNames), row.status) + (user.role === 'admin' ? select('Owner', 'owner_id', owners, row.owner_id, 'Unassigned') : '')) + submit('Update pitch'), row.id)}</div></details>`
    )
    .join('')}</div>`;
}
function boardView(allowed, line, data, query, user, zone, pitchData) {
  const def = lines[line],
    path = base(line),
    all = data.deals;
  const views = {
    sales: 'Sales pipeline',
    delivery: 'Delivery',
    cold: 'Nurture',
    dead: 'Closed lost',
    ...(line === 'media' ? { conversations: 'Conversations', podcast: 'Guest pitches' } : {}),
  };
  const view = Object.hasOwn(views, query.get('view')) ? query.get('view') : 'sales';
  const stageKeys =
    view === 'delivery' ? def.delivery : view === 'cold' || view === 'dead' ? [view] : [...def.live, 'signed'];
  const group = query.get('campaign') || '',
    owner = query.get('owner') || '',
    q = (query.get('q') || '').toLowerCase();
  const groups = [...new Set(all.map((x) => x.details.campaign).filter(Boolean))].sort();
  const rows = all.filter(
    (r) =>
      (!owner || r.owner_id === owner) &&
      (!group || r.details.campaign === group) &&
      (!q || [r.company, r.title, r.owner, ...Object.values(r.details)].join(' ').toLowerCase().includes(q))
  );
  const allSigned = all.filter((r) => r.signed_at),
    signed = allSigned.filter((r) => r.stage !== 'complete'),
    live = all.filter((r) => def.live.includes(r.stage));
  const sum = (items, key) => money(items.reduce((total, r) => total + (r.details[key] || 0), 0));
  const metrics = [
    ['Active opportunities', live.length],
    line === 'media'
      ? ['Signed project value', sum(allSigned, 'project_fee')]
      : ['Signed monthly retainers', sum(signed, 'monthly')],
    line === 'capital'
      ? ['Active raise targets', sum(signed, 'target')]
      : [
          'Follow-ups due',
          all.filter(
            (r) => followupDate(r) && followupDate(r) <= data.today && !['complete', 'dead'].includes(r.stage)
          ).length,
        ],
  ];
  if (line === 'capital') metrics.push(['Capital raised', sum(allSigned, 'raised')]);
  const stage = stageKeys.includes(query.get('stage')) ? query.get('stage') : stageKeys[0];
  const stageChoices = stageKeys.map((id) => ({
    id, cards: rows.filter((row) => row.stage === id),
  }));
  const stageOptions = stageChoices.map(({id, cards}) => ({id, name: `${stages[id]} (${cards.length})`}));
  const filtersOpen = q || owner || group || !window.matchMedia('(max-width: 760px)').matches;
  const content =
    view === 'podcast'
      ? pitchList(pitchData?.items || [], data.owners, user, zone)
      : view === 'conversations'
        ? conversationRows(rows, zone)
        : `${stageKeys.length > 1 ? `<div class="board-stage-picker">${select('Jump to stage', 'board_stage', stageOptions, stage)}</div>` : ''}
    <div class="deal-board">${stageChoices
      .map(({id: key, cards}, i) => {
        return `<section class="deal-column tone-${i % 4}${key === stage ? ' chosen' : ''}" data-ws-stage="${key}"><header><h2>${h(stages[key])}</h2><span>${cards.length}</span></header>${cards.map((r) => boardCard(r, data.today)).join('') || '<p class="quiet">No engagements</p>'}</section>`;
      })
      .join('')}</div>${
      view === 'delivery' && line === 'solutions'
        ? panel(
            'Client milestones',
            milestones(
              rows.filter((r) => def.delivery.includes(r.stage)),
              zone
            )
          )
        : view === 'delivery' && line === 'media'
          ? panel('Project billing', projectBilling(rows.filter((r) => def.delivery.includes(r.stage))))
          : ''
    }`;
  return `${lineBar(allowed, line)}<header class="ws-head"><div><p>${h(def.noun)}</p><h1>${h(def.name)}</h1></div><div class="actions">${line === 'media' ? action('Add targets', 'ws-targets', '', 'shortlist') : ''}${action('New engagement', 'ws-new', line, 'plus', 'primary')}</div></header>
    <div class="ws-metrics">${metrics.map(([k, v]) => `<div><span>${h(k)}</span><strong>${h(v)}</strong></div>`).join('')}</div>
    ${tabs(
      Object.entries(views).map(([id, name]) => [id, name, urlWith(path, query, { view: id, stage: '' })]),
      view,
      'Workspace views'
    )}${view === 'conversations' ? skillLink('media-tracker', 'Download Media research skill') : ''}
    ${
      view === 'podcast'
        ? ''
        : `<details class="board-filters"${filtersOpen ? ' open' : ''}><summary>Filters</summary>
          <form class="ws-filter" data-form="filter">${hidden('view', view)}${hidden('stage', query.get('stage') || '')}${field('Search', 'q', query.get('q') || '', { type: 'search', placeholder: 'Company or contact', glyph: 'search' })}${select('Owner', 'owner', data.owners, owner, 'All owners')}${
            line === 'media'
              ? select(
                  'Campaign',
                  'campaign',
                  groups.map((id) => ({ id, name: id })),
                  group,
                  'All campaigns'
                )
              : ''
          }${btn('Apply', { type: 'submit' })}${q || owner || group ? link(urlWith(path, query, { q: '', owner: '', campaign: '' }), 'Clear') : ''}</form></details>`
    }${content}`;
}

const accepted = '.xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.svg,.webp';
function fileList(files, download = true) {
  return files.length
    ? `<ul class="ws-files">${files.map((f) => `<li>${download ? `<a href="/api/files/${h(f.id)}" target="_blank" rel="noopener">${h(f.name)}</a>` : h(f.name)} <small>${h(f.purpose)}${f.size ? ' · ' + Math.ceil(f.size / 1024) + ' KB' : ''}</small></li>`).join('')}</ul>`
    : '<p class="quiet">No files uploaded.</p>';
}
function uploadForm(id, external = false) {
  return form(
    external ? 'ws-intake-file' : 'ws-file',
    grid(
      select(
        'File purpose',
        'purpose',
        choices(
          external
            ? { asset: 'Supporting asset', logo: 'Logo' }
            : {
                agreement: 'Executed agreement',
                collateral: 'Collateral',
                asset: 'Supporting asset',
                logo: 'Logo',
              }
        )
      ) +
        `<label class="field"><span>File · up to 5 MiB</span><input required type="file" name="file" accept="${accepted}"></label>`
    ) + submit('Upload file'),
    id
  );
}
export function intakeAssets(info, token) {
  if (info.submitted) return '';
  return `<div class="form-page"><section class="panel stack"><h2>Logos and supporting files</h2><p class="quiet">Upload spreadsheets, PDFs or images with your answers.</p><div id="intake-files">${fileList(info.files || [], false)}</div>${uploadForm(token, true)}</section></div>`;
}
function overview(data, owners, user, zone) {
  const e = data.deal,
    d = e.details;
  const business = workspaceKeys[e.line].map((k) => [labels[k], detailValue(k, d[k])]);
  if (e.line === 'capital' && d.raised != null && d.fee_percent != null)
    business.push(['Indicative fee on capital raised', h(money(Math.round((d.raised * d.fee_percent) / 100)))]);
  return `<div class="ws-detail-grid">${panel(
    'Engagement',
    fields([
      ['Owner', h(e.owner)],
      ['Contact', h([d.contact, d.contact_email].filter(Boolean).join(' · ') || '—')],
      ['Next action', h(d.next_action || '—')],
      ['Follow-up date', stamp(e) || '—'],
      ...(d.first_meeting_day ? [[labels.first_meeting_day, h(d.first_meeting_day)]] : []),
      ['Source', h(d.source || '—')],
      ['Source link', detailValue('source_url', d.source_url)],
      ['Outcome', h(d.outcome || '—')],
      ['Signed', date(e.signed_at, zone)],
    ])
  )}${panel('Commercial terms', fields(business))}
    ${panel(
      'Accounting handoff',
      fields(billingKeys.map((k) => [labels[k], detailValue(k, d[k])])) +
        data.dispatches
          .filter((x) => x.kind !== 'weekly_report')
          .map(
            (x) =>
              `<p>${h(x.subject)} · ${h(x.recipient || 'Accounting recipient pending')} · ${h(mailStatus(x.status))}</p>`
          )
          .join('')
    )}
    ${panel('Agreement and files', fileList(data.files) + uploadForm(e.id))}
    ${
      user.role === 'admin'
        ? panel(
            'Engagement team',
            form(
              'ws-team',
              `<div class="check-list">${owners
                .filter((u) => u.id !== e.owner_id)
                .map(
                  (u) =>
                    `<label class="check"><input type="checkbox" name="users" value="${h(u.id)}" ${data.team.includes(u.id) ? 'checked' : ''}>${h(u.name)}</label>`
                )
                .join('')}</div>` + submit('Save team'),
              e.id
            )
          )
        : ''
    }</div>`;
}
function workView(data, owners, zone) {
  const e = data.deal;
  const people = owners.filter((u) => u.id === e.owner_id || data.team.includes(u.id) || u.admin);
  const controls = form(
    'ws-work',
    grid(
      select('Activity', 'kind', choices(kinds), 'task') +
        select('Status', 'status', choices(statuses), 'planned') +
        field('Action, introduction or outcome', 'title', '', { required: true, max: 400 }) +
        select('Responsible owner', 'owner_id', people, e.owner_id) +
        field('Activity date', 'occurred_day', '', { type: 'date' }) +
        field('Due date', 'due', '', { type: 'date' }) +
        field('Source link', 'external_ref', '', { type: 'url', max: 1200 }) +
        (e.client_id
          ? select(
              'Weekly client report',
              'audience',
              choices({ client: 'Include in draft', internal: 'Internal only' }),
              'client'
            )
          : '')
    ) +
      field('Details', 'notes', '', { type: 'textarea', max: 5000 }) +
      submit('Record activity'),
    e.id
  );
  return `<div class="ws-detail-grid">${panel('Record work', controls)}${panel(
    'Activity and next actions',
    data.work.length
      ? data.work
          .map(
            (w) => `<article class="ws-entry">
    <small>${h(kinds[w.kind])} · ${date(w.recorded_at, zone)} · ${h(statuses[w.status])}</small><h3>${h(w.title)}</h3>
    <p class="multiline">${h(w.notes)}</p><small>${h(owners.find((u) => u.id === (w.owner_id || e.owner_id))?.name || e.owner)}${w.due ? ' · Due ' + h(w.due) : ''}</small>
    ${w.external_ref ? outboundLink(w.external_ref) : ''}${action('Update outcome', 'ws-item', w.id, 'edit')}</article>`
          )
          .join('')
      : emptyState('No work recorded yet.')
  )}</div>`;
}
const profileGroups = {
  'Ideal customer': [
    'icp',
    'segment',
    'geography',
    'minimum_locations',
    'ideal_locations',
    'footprint',
    'exclusions',
  ],
  'Current customers': ['current_customers'],
  'Priority targets': ['priority_targets'],
  'Current sales pipeline': ['sales_pipeline'],
  'Channel and strategic partners': ['partnerships'],
  'Technology and integrations': ['current_integrations', 'desired_integrations'],
  'Sales, marketing and media assets': ['assets', 'linkedin', 'x'],
  'Engagement priorities': ['priorities', 'kpis'],
  'Key team members': ['contact_name', 'contact_email', 'phone', 'team'],
};
const fieldDefs = Object.fromEntries(sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
function profileValue(key, v) {
  if (Array.isArray(v))
    return v
      .map(
        (row) =>
          `<div>${Object.entries(row)
            .filter(([, v]) => v !== '' && v != null)
            .map(([k, v]) => (/^https?:\/\//i.test(v) ? outboundLink(v) : h(v)))
            .join(' · ')}</div>`
      )
      .join('');
  return typeof v === 'string' && /^https?:\/\//i.test(v) ? outboundLink(v) : h(v);
}
function profileView(data) {
  const e = data.deal,
    s = data.latest,
    files = s?.files || [],
    logo = files.find((x) => x.purpose === 'logo') || data.files.find((x) => x.purpose === 'logo');
  return `<div class="actions">${action('Copy intake link', 'form-link', e.client_id, 'link', 'primary')}${link('/clients/' + e.client_id, 'Submission history', 'history')}</div>
    ${
      !s
        ? emptyState('Awaiting advisory intake.')
        : `
    <div class="profile-heading">${logo ? `<img src="/api/files/${h(logo.id)}?preview=1" alt="${h(e.company)} logo">` : ''}<div><h2>${h(e.company)}</h2><p>Advisory intake · Version ${s.version}</p></div></div>
    <div class="ws-detail-grid">${Object.entries(profileGroups)
      .map(([name, keys]) => {
        const values = keys.filter(
          (k) =>
            s.answers[k] !== undefined &&
            s.answers[k] !== '' &&
            (!Array.isArray(s.answers[k]) || s.answers[k].length)
        );
        return panel(
          name,
          values.length
            ? fields(values.map((k) => [fieldDefs[k]?.label || k, profileValue(k, s.answers[k])]))
            : '<p class="quiet">Not supplied.</p>'
        );
      })
      .join('')}${panel('Submission files', fileList(files))}</div>`
    }`;
}
function researchView(data) {
  const client = data.deal.client_id;
  return `<div class="actions">${link('/pipeline?client_id=' + client, 'Introduction board', 'board')}${link('/pipeline/suggestions?client_id=' + client, 'Review suggested leads', 'shortlist')}${action('Add research', 'ws-research', data.deal.id, 'plus')}${skillLink('introductions', 'Download introductions skill')}</div>
    <div class="research-grid">${Object.entries({ ...tiers, ungraded: 'Awaiting classification' })
      .map(([tier, name]) => {
        const rows = data.suggestions.filter((s) => (s.tier || 'ungraded') === tier);
        if (!rows.length && tier === 'ungraded') return '';
        return panel(
          name,
          rows.length
            ? rows
                .map(
                  (
                    s
                  ) => `<article class="ws-entry"><small>${h(s.status)}</small><h3>${h([s.person, s.company].filter(Boolean).join(' · '))}</h3><p>${h(s.reason)}</p><p>${h(s.branded_relationship)}</p>
        ${s.next_action ? `<strong>${h(s.next_action)}</strong>` : ''}${s.research ? `<p class="multiline">${h(s.research)}</p>` : ''}${(s.evidence || []).map((v) => `<small>${h(v.source)} · ${h(v.detail)} ${v.reference ? outboundLink(v.reference) : ''}</small>`).join('')}
        ${link(s.card_id ? '/pipeline/cards/' + s.card_id : '/pipeline/suggestions/' + s.id, s.card_id ? 'Open introduction' : 'Review finding')}</article>`
                )
                .join('')
            : emptyState('No findings in this group.')
        );
      })
      .join('')}</div>`;
}
function reportsView(data, today) {
  const end = new Date(today + 'T12:00:00Z'),
    start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return `${skillLink('weekly-update', 'Download weekly reporting skill')}${panel(
    'Draft a weekly update',
    form(
      'ws-report',
      grid(
        field('Period starts', 'start_day', start.toISOString().slice(0, 10), {
          type: 'date',
          required: true,
        }) + field('Period ends', 'end_day', today, { type: 'date', required: true })
      ) + submit('Generate draft'),
      data.deal.id
    )
  )}
    <div class="stack">${
      data.reports
        .map((r) =>
          panel(
            r.start_day + ' to ' + r.end_day,
            `<p class="quiet">${h(r.status)} · Revision ${r.version}</p>` +
              (r.status === 'draft'
                ? form(
                    'ws-report-edit',
                    hidden('version', r.version) +
                      field('Client update', 'body', r.body, {
                        type: 'textarea',
                        required: true,
                        max: 100000,
                      }) +
                      grid(
                        select(
                          'Action',
                          'decision',
                          choices({
                            save: 'Save draft',
                            send: 'Send by email',
                            manual: 'Record sent separately',
                          })
                        ) +
                          field('Recipient for email', 'send_to', data.deal.details.report_email || '', {
                            type: 'email',
                            max: 254,
                          })
                      ) +
                      submit('Apply to report'),
                    r.id
                  )
                : `<div class="multiline">${h(r.body)}</div>`) +
              `<div class="actions">${[['pdf', 'Download saved PDF'], ['xlsx', 'Download saved workbook']].map(([format, label]) => `<a class="text-link" download="weekly-update.${format}" href="/api/engagements/${h(data.deal.id)}/reports/${h(r.id)}/${format}?version=${r.version}">${icon('download')}${label}</a>`).join('')}</div>`
          )
        )
        .join('') || emptyState('No weekly updates yet.')
    }</div>`;
}
function detailView(allowed, data, owners, user, query, zone, today) {
  const e = data.deal,
    path = base(e.line, e.id);
  const names = {
    overview: 'Overview',
    activity: 'Activity',
    ...(e.client_id
      ? { profile: 'Advisory intake', research: 'Introductions', reports: 'Weekly updates' }
      : {}),
  };
  const selected = Object.hasOwn(names, query.get('tab')) ? query.get('tab') : 'overview';
  const board = history.state?.workBoard;
  const destination = typeof board === 'string' && board.split('?')[0] === base(e.line) ? board : base(e.line);
  return `${lineBar(allowed, e.line)}${link(destination, 'Back to ' + lines[e.line].name, 'back', 'back-link')}
    <header class="ws-head"><div><p>${h(e.title === e.company ? lines[e.line].noun : e.title)} · ${h(stages[e.stage])}</p><h1>${h(e.company)}</h1></div><div class="actions">${e.client_id && !e.signed_at ? action('Record existing agreement', 'ws-history', e.id) : ''}${action('Move stage', 'ws-stage', e.id, 'board')}${action('Edit engagement', 'ws-edit', e.id, 'edit', 'primary')}</div></header>
    ${tabs(
      Object.entries(names).map(([key, name]) => [key, name, urlWith(path, query, { tab: key })]),
      selected,
      'Engagement sections'
    )}
    ${{ overview: () => overview(data, owners, user, zone), activity: () => workView(data, owners, zone), profile: () => profileView(data), research: () => researchView(data), reports: () => reportsView(data, today) }[selected]()}`;
}

function operations(data) {
  const names = Object.keys(lines);
  const userAccess = data.users
    .map(
      (u) =>
        `<details><summary>${h(u.name)} · ${h(u.role)}</summary>${
          u.role === 'admin'
            ? '<p>Access to all business lines.</p>'
            : form(
                'ws-access',
                `<div class="check-list">${names.map((k) => `<label class="check"><input type="checkbox" name="workspaces" value="${k}" ${u.workspaces.includes(k) ? 'checked' : ''}>${lines[k].name}</label>`).join('')}</div>` +
                  submit('Update access'),
                u.id
              )
        }</details>`
    )
    .join('');
  const sources = data.sources
    .map(
      (s) =>
        `<article class="ws-entry"><strong>${h(s.label)}</strong><small>${h(lines[s.line].name)} · ${h(s.owner)} · ${s.active ? 'Active' : 'Disabled'}</small><small>${s.inquiries} inquiries · ${s.in_discussion} in active sales discussions · ${s.signed} signed</small>${s.active ? `<div class="actions">${action('Copy inquiry link', 'ws-source-link', s.id, 'link')}${action('Disable link', 'ws-source-disable', s.id)}</div>` : ''}</article>`
    )
    .join('');
  const dispatches = data.mail
    .map(
      (m) =>
        `<article class="ws-entry"><strong>${h(m.subject)}</strong><small>${h(m.recipient || 'Waiting for accounting address')} · ${h(mailStatus(m.status))}</small>${m.detail ? `<p>${h(m.detail)}</p>` : ''}${['failed', 'check_delivery'].includes(m.status) ? form('ws-reconcile', select('After checking Sent Items', 'decision', choices({ confirmed_sent: 'Confirm sent', retry: 'Retry delivery' })) + submit('Record decision'), m.id) : ''}</article>`
    )
    .join('');
  const matches = data.unmatched
    .map(
      (m) =>
        `<article class="ws-entry"><strong>${h(m.subject)}</strong><p>${h(m.notes)}</p>${m.ref ? outboundLink(m.ref) : ''}${form('ws-match', select('Matching campaign engagement', 'engagement_id', m.choices, '', 'Dismiss without linking') + submit('Resolve match'), m.id)}</article>`
    )
    .join('');
  return `${link('/admin', 'Team administration', 'back')}<header class="ws-head"><div><p>Administration</p><h1>Workspace operations</h1></div></header><div class="ws-detail-grid">
    ${panel('Team access', userAccess)}${panel('Inbound inquiry links', action('Create inquiry link', 'ws-source', '', 'plus', 'primary') + (sources || emptyState('No active inquiry links.')))}
    ${panel(
      'Microsoft 365',
      fields([
        [
          'Delivery configuration',
          h(data.demo ? 'Local demo' : data.connected ? 'Configured' : 'Awaiting configuration'),
        ],
        ['Accounting', h(data.accounting || 'Unassigned')],
        ['Media mailbox', h(data.media || 'Unassigned')],
        ['Podcast mailbox', h(data.podcast || 'Unassigned')],
      ])
    )}
    ${panel('Email delivery', dispatches || emptyState('No messages queued.'))}${panel('Media messages to match', matches || emptyState('No ambiguous campaign conversations.'))}</div>`;
}
export function dueSection(items) {
  if (!items.length) return '';
  return panel(
    'Engagement follow-ups',
    items
      .map(
        (r) =>
          `<a class="list-row" href="${base(r.line, r.id)}?tab=activity"><div class="row-main"><strong>${h(r.title)}</strong><small>${h(r.company)} · ${h(lines[r.line].name)} · ${h(r.due)}</small></div></a>`
      )
      .join('')
  );
}
function editForm(e, users, user) {
  const key = e.id ? 'ws-save' : 'ws-create',
    d = e.details || {};
  return form(
    key,
    hidden('line', e.line) +
      (e.id ? hidden('version', e.version) : '') +
      grid(
        (e.id ? '' : field('Company', 'company', '', { required: true, max: 180 })) +
          field('Engagement name', 'title', e.title || '', { required: Boolean(e.id), max: 240 }) +
          (user.role === 'admin' ? select('Engagement owner', 'owner_id', users, e.owner_id || user.id) : '') +
          ['contact', 'contact_email', 'next_action', 'due', 'first_meeting_day', 'source', 'source_url']
            .map((k) => formField(k, d))
            .join('')
      ) +
      `<details class="ws-fold"${e.line === 'media' ? ' open' : ''}><summary>Commercial terms${e.line === 'media' ? ' and campaign' : ''}</summary>${grid(workspaceKeys[e.line].map((k) => formField(k, d)).join(''))}</details>
    <details class="ws-fold"><summary>Agreement and billing</summary>${grid(billingKeys.map((k) => formField(k, d)).join(''))}</details>` +
      submit(e.id ? 'Save changes' : 'Create engagement'),
    e.id
  );
}
function stageForm(e, selected = e.stage) {
  const def = lines[e.line],
    keys =
      e.signed_at || def.delivery.includes(e.stage) ? def.delivery : [...def.live, 'signed', 'cold', 'dead'];
  return form(
    'ws-stage',
    hidden('version', e.version) +
      select('Stage', 'stage', options(keys), selected) +
      grid(['first_meeting_day', 'due', 'outcome', 'agreement_url'].map((k) => formField(k, e.details)).join('')) +
      '<small class="quiet">Signing starts accounting handoff. Attach the executed copy under Overview or include its link here.</small>' +
      submit('Save stage'),
    e.id
  );
}
function fileData(file) {
  if (!file || !file.size || file.size > 5 * 1024 * 1024) throw new Error('Choose a file up to 5 MiB.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('This file could not be read.'));
    reader.readAsDataURL(file);
  });
}
const splitDetails = (data) => {
  const details = {};
  for (const [k, v] of data)
    if (Object.hasOwn(labels, k)) {
      if (currencyKeys.includes(k) || k === 'fee_percent') {
        if (v !== '') details[k] = currencyKeys.includes(k) ? Math.round(Number(v) * 100) : Number(v);
      } else details[k] = String(v).trim();
    }
  return details;
};
function researchForm(client) {
  return form(
    'ws-finding',
    hidden('client_id', client) +
      grid(
        field('Company', 'company', '', { required: true, max: 180 }) +
          field('Person', 'person', '', { max: 150 }) +
          select('Relationship group', 'tier', choices(tiers)) +
          field('Source', 'source', '', { required: true, max: 120 }) +
          field('Evidence link', 'reference', '', { type: 'url', max: 600 }) +
          field('Relationship with Branded', 'branded_relationship', '', { required: true, max: 600 })
      ) +
      field('Why this contact fits', 'reason', '', { type: 'textarea', required: true, max: 2500 }) +
      field('Evidence', 'detail', '', { type: 'textarea', required: true, max: 1800 }) +
      field('Suggested next action', 'next_action', '', { required: true, max: 400 }) +
      submit('Save finding')
  );
}
export function workspaceController({
  api,
  navigate,
  render,
  showDialog,
  notify,
  clipboard,
  getUser,
  getZone,
  onIntakeUpload,
}) {
  const currentKey = () => location.pathname.split('/')[3];
  const currentDeal = () => api('/api/engagements/' + encodeURIComponent(currentKey()));
  const eligible = async (line) => (await api('/api/workspaces/' + line)).owners;
  const close = () => document.querySelector('#dialog').close();
  const saved = async (message) => {
    close();
    await render();
    notify(message);
  };
  const targetForm = () =>
    form(
      'ws-target-list',
      field('Campaign', 'campaign', '', { required: true, max: 180 }) +
        field('Research source', 'source', '', { required: true, max: 180 }) +
        field('Target companies', 'companies', '', {
          type: 'textarea',
          required: true,
          max: 18000,
          hint: 'Enter one company per line, up to 100.',
        }) +
        submit('Add campaign targets')
    );
  async function page(path, q) {
    if (path.startsWith('/inquire/')) {
      const key = path.split('/').at(-1),
        info = await api('/api/inquire/' + encodeURIComponent(key));
      const request = history.state?.inquiryKey || crypto.randomUUID();
      history.replaceState({ ...history.state, inquiryKey: request }, '');
      return `<div class="form-page narrow"><header class="ws-head"><div><p>Branded ${h(lines[info.line].name)}</p><h1>${h(info.label)}</h1></div></header>${history.state?.inquirySent ? panel('Inquiry received', '<p>The team will follow up using the email you provided.</p>') : panel('Contact the team', form('ws-inquiry', hidden('request_id', request) + field('Company', 'company', '', { required: true, max: 180 }) + field('Your name', 'name', '', { required: true, max: 150 }) + field('Email', 'email', '', { type: 'email', required: true, max: 254 }) + field('What would you like to discuss?', 'message', '', { type: 'textarea', required: true, max: 2500 }) + submit('Send inquiry'), key))}</div>`;
    }
    if (path === '/operations') return operations(await api('/api/admin/operations'));
    const allowed = (await api('/api/workspaces')).lines;
    if (!allowed.length)
      return panel(
        'Business workspaces',
        emptyState(
          'No workspace assigned.',
          'Your administrator can assign a business line in Workspace operations.'
        )
      );
    const [, , line, key] = path.split('/');
    if (!line) {
      navigate(base(allowed.includes('solutions') ? 'solutions' : allowed[0]), { replace: true });
      return '';
    }
    const [board, detail, podcast] = await Promise.all([
      api('/api/workspaces/' + line),
      key ? api('/api/engagements/' + encodeURIComponent(key)) : null,
      line === 'media' && q.get('view') === 'podcast' ? api('/api/podcast') : null,
    ]);
    if (detail && detail.deal.line !== line)
      throw new Error('This engagement belongs to a different workspace.');
    return key
      ? detailView(allowed, detail, board.owners, getUser(), q, getZone(), board.today)
      : boardView(allowed, line, board, q, getUser(), getZone(), podcast);
  }
  const actions = {
    'ws-history': async () => {
      const { deal } = await currentDeal();
      showDialog(
        'Record existing agreement',
        form(
          'ws-history',
          hidden('version', deal.version) +
            field('Original signature date', 'signed_day', '', { type: 'date', required: true }) +
            formField('agreement_url', deal.details) +
            '<label class="check"><input type="checkbox" name="notify_accounting"> Send this existing agreement to accounting</label>' +
            submit('Record agreement'),
          deal.id
        )
      );
    },
    'ws-new': async (b) => {
      const line = b.dataset.id;
      showDialog(
        'New ' + lines[line].name + ' engagement',
        editForm({ line }, await eligible(line), getUser())
      );
    },
    'ws-edit': async () => {
      const { deal } = await currentDeal();
      showDialog('Edit engagement', editForm(deal, await eligible(deal.line), getUser()));
    },
    'ws-stage': async () => showDialog('Move stage', stageForm((await currentDeal()).deal)),
    'ws-targets': () => showDialog('Add campaign targets', targetForm()),
    'ws-item': async (b) => {
      const record = await currentDeal(),
        w = record.work.find((x) => x.id === b.dataset.id);
      if (!w) throw new Error('Refresh to see the latest activity.');
      showDialog(
        'Update outcome',
        form(
          'ws-outcome',
          hidden('previous_at', w.recorded_at) +
            select('Status', 'status', choices(statuses), w.status) +
            select(
              'Responsible owner',
              'owner_id',
              (await eligible(record.deal.line)).filter(
                (u) => u.admin || u.id === record.deal.owner_id || record.team.includes(u.id)
              ),
              w.owner_id || record.deal.owner_id
            ) +
            field('Due date', 'due', w.due, { type: 'date' }) +
            field('Details or outcome', 'notes', w.notes, { type: 'textarea', max: 5000 }) +
            submit('Save outcome'),
          w.id
        )
      );
    },
    'ws-research': async () =>
      showDialog('Add introduction research', researchForm((await currentDeal()).deal.client_id)),
    'ws-source': async () => {
      const { users } = await api('/api/admin/operations');
      showDialog(
        'Create inquiry link',
        form(
          'ws-source',
          select(
            'Business line',
            'line',
            Object.entries(lines).map(([id, l]) => ({ id, name: l.name }))
          ) +
            field('Public form title / source', 'label', '', { required: true, max: 180 }) +
            select(
              'Assigned owner',
              'owner_id',
              users.filter((u) => u.enabled)
            ) +
            submit('Create link')
        )
      );
    },
    'ws-source-link': (b) => clipboard(location.origin + '/inquire/' + b.dataset.id, 'Inquiry link copied.'),
    'ws-source-disable': (b) =>
      showDialog(
        'Disable inquiry link',
        form(
          'ws-disable-source',
          '<p>Visitors using this link will see that it is unavailable.</p>' + submit('Disable link'),
          b.dataset.id
        )
      ),
  };
  const forms = {
    async 'ws-history'(f, v) {
      await api('/api/engagements/' + f.dataset.id + '/existing-agreement', 'POST', {
        version: Number(v.get('version')),
        signed_day: v.get('signed_day'),
        agreement_url: v.get('agreement_url'),
        notify_accounting: v.has('notify_accounting'),
      });
      await saved('Existing agreement recorded.');
    },
    async 'ws-create'(f, v) {
      const d = { company: v.get('company'), details: splitDetails(v) };
      for (const k of ['title', 'owner_id']) if (v.get(k)) d[k] = v.get(k);
      const line = v.get('line'),
        r = await api('/api/workspaces/' + line + '/engagements', 'POST', d);
      navigate(base(line, r.id));
      notify('Engagement created.');
    },
    async 'ws-save'(f, v) {
      const data = {
        title: v.get('title'),
        version: Number(v.get('version')),
        details: splitDetails(v),
        clear: [...currencyKeys, 'fee_percent'].filter((k) => v.has(k) && v.get(k) === ''),
      };
      if (v.has('owner_id')) data.owner_id = v.get('owner_id');
      await api('/api/engagements/' + f.dataset.id, 'PATCH', data);
      await saved('Engagement saved.');
    },
    async 'ws-stage'(f, v) {
      await api('/api/engagements/' + f.dataset.id, 'PATCH', {
        stage: v.get('stage'),
        version: Number(v.get('version')),
        details: splitDetails(v),
      });
      await saved('Stage updated.');
    },
    async 'ws-team'(f, v) {
      await api('/api/engagements/' + f.dataset.id + '/team', 'PUT', { users: v.getAll('users') });
      await saved('Team updated.');
    },
    async 'ws-work'(f, v) {
      const d = Object.fromEntries([...v].filter(([, v]) => v !== ''));
      await api('/api/engagements/' + f.dataset.id + '/work', 'POST', d);
      await saved('Activity recorded.');
    },
    async 'ws-outcome'(f, v) {
      await api('/api/engagements/' + currentKey() + '/work/' + f.dataset.id, 'PATCH', Object.fromEntries(v));
      await saved('Outcome recorded.');
    },
    async 'ws-file'(f, v) {
      const file = v.get('file');
      await api('/api/engagements/' + f.dataset.id + '/files', 'POST', {
        purpose: v.get('purpose'),
        name: file.name,
        data: await fileData(file),
      });
      await saved('File uploaded.');
    },
    async 'ws-intake-file'(f, v) {
      const file = v.get('file'),
        key = f.dataset.id;
      const result = await api('/api/onboard/' + key + '/files', 'POST', {
        purpose: v.get('purpose'),
        name: file.name,
        data: await fileData(file),
      });
      const files = onIntakeUpload(key, result);
      if (files && document.getElementById('intake-files'))
        document.getElementById('intake-files').innerHTML = fileList(files, false);
      f.reset();
      notify('File attached to this intake.');
    },
    async 'ws-report'(f, v) {
      await api('/api/engagements/' + f.dataset.id + '/reports', 'POST', Object.fromEntries(v));
      await saved('Weekly draft ready.');
    },
    async 'ws-report-edit'(f, v) {
      const d = { body: v.get('body'), version: Number(v.get('version')) };
      if (v.get('decision') === 'send') {
        if (!v.get('send_to')) throw new Error('Enter the client’s email before sending.');
        d.send_to = v.get('send_to');
      }
      if (v.get('decision') === 'manual') d.manual_sent = true;
      await api('/api/engagements/' + currentKey() + '/reports/' + f.dataset.id, 'PATCH', d);
      await saved(d.send_to ? 'Report queued for delivery.' : 'Report saved.');
    },
    async 'ws-target-list'(f, v) {
      const r = await api('/api/workspaces/media/targets', 'POST', {
        campaign: v.get('campaign'),
        source: v.get('source'),
        targets: String(v.get('companies'))
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((company) => ({ company })),
      });
      await saved(`${r.added} targets added. ${r.skipped} already in this campaign.`);
    },
    async 'ws-finding'(f, v) {
      const { detail, reference, ...d } = Object.fromEntries(v);
      d.evidence = [{ source: d.source, detail, reference }];
      d.fit = 'Owner reviewed';
      d.score = 0;
      d.candidate_key = 'staff:' + d.company.toLowerCase().trim() + ':' + d.person.toLowerCase().trim();
      await api('/api/engagements/' + currentKey() + '/research', 'POST', d);
      await saved('Research saved for review.');
    },
    async 'ws-pitch'(f, v) {
      await api('/api/podcast/' + f.dataset.id, 'PATCH', Object.fromEntries(v));
      await saved('Pitch updated.');
    },
    async 'ws-inquiry'(f, v) {
      await api('/api/inquire/' + f.dataset.id, 'POST', Object.fromEntries(v));
      history.replaceState({ ...history.state, inquirySent: true }, '');
      await render();
    },
    async 'ws-source'(f, v) {
      const result = await api('/api/admin/inquiry-sources', 'POST', Object.fromEntries(v));
      await saved('Inquiry link created.');
      await clipboard(location.origin + result.path, 'Inquiry link copied.');
    },
    async 'ws-disable-source'(f) {
      await api('/api/admin/inquiry-sources/' + f.dataset.id + '/disable', 'POST');
      await saved('Inquiry link disabled.');
    },
    async 'ws-access'(f, v) {
      await api('/api/admin/accounts/' + f.dataset.id + '/workspaces', 'PUT', {
        workspaces: v.getAll('workspaces'),
      });
      await saved('Workspace assignments updated.');
    },
    async 'ws-reconcile'(f, v) {
      await api('/api/admin/dispatches/' + f.dataset.id, 'POST', Object.fromEntries(v));
      await saved('Delivery decision saved.');
    },
    async 'ws-match'(f, v) {
      await api('/api/admin/media-matches/' + f.dataset.id, 'POST', Object.fromEntries(v));
      await saved('Mail match resolved.');
    },
  };
  document.addEventListener('change', (event) => {
    if (event.target.name !== 'board_stage') return;
    const board = document.querySelector('.deal-board');
    const column = [...board.children].find((item) => item.dataset.wsStage === event.target.value);
    if (!column) return;
    board.querySelector('.chosen')?.classList.remove('chosen');
    column.classList.add('chosen');
    board.scrollLeft = column.offsetLeft;
    document.querySelector('.board-filters [name="stage"]').value = column.dataset.wsStage;
    const url = new URL(location.href);
    url.searchParams.set('stage', column.dataset.wsStage);
    history.replaceState(history.state, '', url);
  });

  let dragged;
  document.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.deal-card');
    if (card) {
      dragged = card;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.deal);
    }
  });
  document.addEventListener('dragover', (e) => {
    if (dragged && e.target.closest('[data-ws-stage]')) e.preventDefault();
  });
  document.addEventListener('dragend', () => {
    dragged = null;
  });
  document.addEventListener('drop', async (e) => {
    const stage = e.target.closest('[data-ws-stage]')?.dataset.wsStage,
      card = dragged;
    dragged = null;
    if (!card || !stage) return;
    e.preventDefault();
    if (stage === card.dataset.stage) return;
    try {
      if (stage === 'signed' || stage === 'first_meeting_scheduled') {
        const { deal } = await api('/api/engagements/' + card.dataset.deal);
        showDialog(stage === 'signed' ? 'Record signed agreement' : 'Schedule first meeting', stageForm(deal, stage));
        return;
      }
      await api('/api/engagements/' + card.dataset.deal, 'PATCH', {
        stage,
        version: Number(card.dataset.version),
      });
      await render();
      notify('Stage updated.');
    } catch (err) {
      notify(err.message);
    }
  });
  return { actions, forms, page };
}
