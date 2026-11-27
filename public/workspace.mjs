import { btn, emptyState, field, formatDate, h, hidden, icon, link, outboundLink, select } from './ui.mjs';
import { billingStates, kinds, labels, lines, money, stages, statuses } from './business-lines.mjs';
import { pipelineEditor } from './pipeline-editor.mjs';
import { salesSummary } from './sales-summary.mjs';
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
const currencyKeys = ['monthly', 'project_fee', 'deal_value', 'target', 'raised'];
const workspaceKeys = {
  solutions: ['monthly', 'term', 'project_fee', 'deal_value', 'fee_percent', 'fee_terms', 'report_email'],
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
const longKeys = ['pipeline_note','package', 'billing_terms', 'fee_terms', 'research_sources'];
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
function boardCard(row) {
  const d=row.details, contact=d.contact || row.intake_contact || '', note=d.pipeline_note || row.card_note || d.next_action || '';
  return `<a class="deal-card" draggable="true" data-deal="${h(row.id)}" data-version="${row.version}" data-stage="${h(row.stage)}" href="${base(row.line,row.id)}" title="${h([row.title,contact,note].filter(Boolean).join(' · '))}">
    <strong>${h(row.company)}</strong>${contact?`<span class="lead-contact">${h(contact)}</span>`:''}${note?`<span class="lead-note">${h(note)}</span>`:''}</a>`;
}
const mailStatus = (k) =>
  ({
    queued: 'Queued',
    sending: 'Sending',
    accepted: 'Accepted by Microsoft 365',
    check_delivery: 'Verify delivery',
    failed: 'Failed',
  })[k] || '';
function boardView(data, query, admin) {
  const owner=query.get('owner') || '', search=(query.get('q') || '').trim().toLowerCase();
  const visible=data.deals.filter(row=>(!owner || row.owner_id===owner) &&
    [row.company,row.title,row.owner,row.details.contact,row.intake_contact].join(' ').toLowerCase().includes(search));
  const totals=salesSummary(data.deals), compact=localStorage.getItem('branded-card-density')==='compact';
  const definitions={won:'Total contract value of signed engagements',lost:'Total contract value of closed-lost opportunities',
    mrr:'Monthly recurring revenue from active signed retainers',arr:'Annual recurring revenue equals monthly recurring revenue multiplied by 12'};
  return `<section class="sales-screen"><header class="studio-heading pipeline-heading"><h1>Pipelines</h1>
    <dl class="sales-metrics">${['won','lost','arr','mrr'].map(key=>`<div title="${definitions[key]}"><dt>${{won:'Won',lost:'Lost',arr:'ARR',mrr:'MRR'}[key]}</dt><dd>${h(money(totals[key]).replace(/\.00$/,''))}</dd></div>`).join('')}</dl><img class="pipeline-illustration" src="/assets/artwork/correspondence.png" width="114" height="76" alt=""></header>
    <div class="sales-toolbar"><form class="compact-filter" data-form="filter">${field('Search pipeline','q',query.get('q')||'',{type:'search',placeholder:'Company or contact',glyph:'search'})}${select('Owner','owner',data.owners,owner,'All owners')}${btn('Apply',{type:'submit'})}${search||owner?link(base('solutions'),'Clear'):''}</form>
    <div class="actions">${admin?action('Edit stages','ws-columns','','settings'):''}<button type="button" class="density-switch" role="switch" aria-checked="${compact}" aria-label="Compact cards" data-action="ws-density"><i aria-hidden="true"></i>Compact cards</button>${action('New engagement','ws-new','solutions','plus','primary')}</div></div>
    <div class="board-scrollbar" hidden tabindex="0" role="region" aria-label="Scroll pipeline stages horizontally"><div></div></div>
    <div class="deal-board sales-board${compact?' compact-cards':''}" aria-label="Solutions sales stages">${data.stages.map(({id,name,color})=>{
      const rows=visible.filter(row=>(row.signed_at?'signed':row.stage)===id);
      return `<section class="deal-column tone-${color}" data-ws-stage="${h(id)}"><header><h2>${h(name)}</h2><span>${rows.length}</span></header>
        ${rows.map(r=>boardCard(r)).join('') || '<p class="quiet empty-stage">No engagements</p>'}</section>`;
    }).join('')}</div></section>`;
}

function unavailable(line) {
  return `<section class="construction-panel"><span class="construction-icon">${icon('building')}</span><h1>${h(lines[line].name)}</h1><p>Under construction</p></section>`;
}
const listTypes={priority_targets:'Priority target list',partnerships:'Strategic partner list',team:'Key team list'};
function fileList(files, download = true) {
  return files.length
    ? `<ul class="ws-files">${files.map((f) => `<li>${download ? `<a href="/api/files/${h(f.id)}" target="_blank" rel="noopener">${h(f.name)}</a>` : h(f.name)} <small>${h(listTypes[f.purpose] || f.purpose)}${f.list_note?' · '+h(f.list_note):''}${f.size ? ' · ' + Math.ceil(f.size / 1024) + ' KB' : ''}</small></li>`).join('')}</ul>`
    : '<p class="quiet">No files uploaded.</p>';
}
function uploadForm(id, external = false, purpose = external ? 'asset' : 'agreement') {
  return form(
    external ? 'ws-intake-file' : 'ws-file',
    grid(
      select(
        'File purpose',
        'purpose',
        choices(
          external
            ? { asset: 'Supporting asset', logo: 'Logo', ...listTypes }
            : {
                agreement: 'Executed agreement',
                collateral: 'Collateral',
                asset: 'Supporting asset',
                logo: 'Logo', ...listTypes,
              }
        ),purpose
      ) +
        `<label class="field"><span>Files · up to 25 MiB each</span><input required multiple type="file" name="file"></label>`
    ) + submit('Upload file'),
    id
  );
}
export function intakeAssets(info, token) {
  if (info.submitted) return '';
  return `<div class="form-page"><section class="panel stack"><h2>Logos and supporting files</h2><p class="quiet">Upload existing files in any format, including brand guidelines, decks, CRM exports and videos. Choose a target, partner or team list to add entries from a CSV or Excel workbook with column headers.</p><div id="intake-files">${fileList(info.files || [], false)}</div>${uploadForm(token, true)}</section></div>`;
}
export function overview(data, owners, user, zone) {
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
export function workView(data, owners, zone, formOnly=false) {
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
  if(formOnly) return controls;
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
export function profileView(data) {
  const e=data.deal,submission=data.latest;
  const files=[...new Map([...(submission?.files || []),...data.files].map(f=>[f.id,f])).values()];
  const latest=submission?link('/clients/'+e.client_id+'/submissions/'+submission.id,'View submission '+submission.version,'history'):'';
  return `<div class="intake-summary"><h2>Client intake</h2>${latest}</div>
    <section class="panel intake-files"><div class="section-toolbar"><h3>Uploaded files</h3><small>${files.length} file${files.length===1?'':'s'}</small></div>${fileList(files)}
    <details><summary>Add files</summary>${uploadForm(e.id,false,'asset')}</details></section>
    ${!submission?'':`<div class="intake-groups">${Object.entries(profileGroups).map(([name,keys])=>{
      const values=keys.filter(k=>submission.answers[k]!==undefined && submission.answers[k]!=='' && (!Array.isArray(submission.answers[k])||submission.answers[k].length));
      return `<section class="panel"><h3>${h(name)}</h3>${values.length?fields(values.map(k=>[fieldDefs[k]?.label||k,profileValue(k,submission.answers[k])])):'<p class="quiet">Not supplied.</p>'}</section>`;
    }).join('')}</div>`}`;
}

export function reportsView(report,clientId) {
  const period=new URLSearchParams({start_day:report.start_day,end_day:report.end_day,revision:report.revision});
  const downloads=(base,suffix='')=>[['pdf','Export PDF'],['xlsx','Export workbook']].map(([fmt,label])=>
    `<a class="button" href="${h(base+fmt+suffix)}" download>${icon('download')}${label}</a>`).join('');
  return `<section class="weekly-update"><header class="section-toolbar"><h2>Weekly update</h2><div class="actions">${downloads('/api/clients/'+encodeURIComponent(clientId)+'/weekly-update/','?'+period)}</div></header>
    <form class="report-period" data-form="filter">${hidden('tab','reports')}${field('Period starts','start_day',report.start_day,{type:'date',required:true})}
    ${field('Period ends','end_day',report.end_day,{type:'date',required:true})}${submit('Update preview')}</form>
    <article class="panel weekly-preview" aria-label="Weekly update preview"><h3>${h(report.client)} · Weekly update</h3><p>${h(report.start_day)} to ${h(report.end_day)}</p>
    ${report.sections.map(s=>`<section><h4>${h(s.title)}</h4>${s.items.length?`<ul>${s.items.map(item=>`<li class="multiline">${h(item)}</li>`).join('')}</ul>`:'<p>No items recorded.</p>'}</section>`).join('')}</article>
    ${report.saved.length?`<details class="panel"><summary>Previously saved updates</summary>${report.saved.map(r=>`<details><summary>${h(r.start_day)} to ${h(r.end_day)} · Revision ${r.version}</summary><p class="multiline">${h(r.body)}</p><div class="actions">${downloads('/api/engagements/'+encodeURIComponent(r.engagement_id)+'/reports/'+encodeURIComponent(r.id)+'/','?version='+r.version)}</div></details>`).join('')}</details>`:''}</section>`;
}
function detailView(columns, data, owners, user, query, zone) {
  const e = data.deal,
    path = base(e.line, e.id);
  const names = {
    overview: 'Overview',
    activity: 'Activity',
  };
  const selected = Object.hasOwn(names, query.get('tab')) ? query.get('tab') : 'overview';
  const board = history.state?.workBoard;
  const destination = typeof board === 'string' && board.split('?')[0] === base(e.line) ? board : base(e.line);
  return `${link(destination, 'Back to pipelines', 'back', 'back-link')}
    <header class="ws-head"><div><p>${h(e.title === e.company ? lines[e.line].noun : e.title)} · ${h(columns.find(c=>c.id===e.stage)?.name || stages[e.stage])}</p><h1>${h(e.company)}</h1></div><div class="actions">${e.client_id?link('/clients/'+e.client_id,'Client profile','user'):''}${action('Move stage', 'ws-stage', e.id, 'board')}${action('Edit engagement', 'ws-edit', e.id, 'edit', 'primary')}</div></header>
    ${tabs(
      Object.entries(names).map(([key, name]) => [key, name, urlWith(path, query, { tab: key })]),
      selected,
      'Engagement sections'
    )}
    ${{ overview: () => overview(data, owners, user, zone), activity: () => workView(data, owners, zone) }[selected]()}`;
}

export function operations(data) {
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
  const sources = data.sources.filter((source)=>source.line==='solutions')
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
  return `<div class="ws-detail-grid">
    ${panel('Team access', userAccess)}${panel('Inbound inquiry links', action('Create inquiry link', 'ws-source', '', 'plus', 'primary') + (sources || emptyState('No active inquiry links.')))}
    ${panel(
      'Microsoft 365',
      fields([
        [
          'Delivery configuration',
          h(data.demo ? 'Local demo' : data.connected ? 'Configured' : 'Awaiting configuration'),
        ],
        ['Accounting', h(data.accounting || 'Unassigned')],

      ])
    )}
    ${panel('Email delivery', dispatches || emptyState('No messages queued.'))}</div>`;
}
function editForm(e, users, user, context={}) {
  const key = e.id ? 'ws-save' : 'ws-create',
    d = e.details || {};
  return form(
    key,
    hidden('line', e.line) +
      (e.id ? hidden('version', e.version) : hidden('request_id',crypto.randomUUID())+hidden('client_mode',context.client?'existing':'new')) +
      grid(
        (e.id ? '' : context.client?hidden('client_id',context.client.id)+`<div class="chosen-client"><small>Existing client</small><strong>${h(context.client.name)}</strong></div>`:field('Client name', 'company', '', { required: true, max: 180 })) +
          field('Engagement name', 'title', e.title || '', { required: Boolean(e.id), max: 240 }) +
          (user.role === 'admin' ? select(!e.id&&!context.client?'Client owner':'Engagement owner', 'owner_id', users, e.owner_id || context.client?.owner_id || user.id) : '') +
          (!e.id && context.stages?select('Pipeline stage','stage',context.stages.filter(c=>c.id!=='signed'),'outreach'):'')+
          ['contact', 'contact_email', 'pipeline_note', 'next_action', 'due', 'source', 'source_url']
            .map((k) => formField(k, d))
            .join('')
      ) +
      (!e.id&&!context.client&&user.role==='admin'?'<details class="ws-fold"><summary>Additional client access</summary>'+users.map(u=>`<label class="check"><input type="checkbox" name="member_ids" value="${h(u.id)}">${h(u.name)}</label>`).join('')+'</details>':'')+
      `<details class="ws-fold"${e.line === 'media' ? ' open' : ''}><summary>Commercial terms${e.line === 'media' ? ' and campaign' : ''}</summary>${grid(workspaceKeys[e.line].map((k) => formField(k, d)).join(''))}</details>
    <details class="ws-fold"><summary>Agreement and billing</summary>${grid(billingKeys.map((k) => formField(k, d)).join(''))}</details>` +
      submit(e.id ? 'Save changes' : 'Create engagement'),
    e.id
  );
}
function stageForm(e, selected = e.stage, columns) {
  const def = lines[e.line],
    keys =
      e.line==='solutions' ? [...def.live,'signed'] : e.signed_at || def.delivery.includes(e.stage) ? def.delivery : [...def.live, 'signed', 'cold', 'dead'];
  return form(
    'ws-stage',
    hidden('version', e.version) +
      select('Stage', 'stage', e.line==='solutions' && columns ? columns : options(keys), selected) +
      grid(['first_meeting_day', 'due', 'outcome', 'agreement_url'].map((k) => formField(k, e.details)).join('')) +
      '<small class="quiet">Signing starts accounting handoff. Attach the executed copy under Overview or include its link here.</small>' +
      submit('Save stage'),
    e.id
  );
}
function fileData(file) {
  if (!file || !file.size || file.size > 25 * 1024 * 1024) throw new Error('Choose a file up to 25 MiB.');
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
  const stageEditor=pipelineEditor({api,showDialog,render,notify});
  const currentKey = () => document.querySelector('[data-engagement-context]')?.dataset.engagementContext || location.pathname.split('/')[3];
  const currentDeal = () => api('/api/engagements/' + encodeURIComponent(currentKey()));
  const eligible = async (line) => (await api('/api/workspaces/' + line)).owners;
  const close = () => document.querySelector('#dialog').close();
  const saved = async (message) => {
    close();
    await render();
    notify(message);
  };
async function uploadFiles(f,values,external) {
    const files=values.getAll('file'), key=f.dataset.id, input=f.querySelector('input[type=file]');
    const endpoint='/api/'+(external?'onboard':'engagements')+'/'+encodeURIComponent(key)+'/files';
    for(let index=0;index<files.length;index++) {
      const file=files[index];
      try {
        const result=await api(endpoint,'POST',{purpose:values.get('purpose'),name:file.name,data:await fileData(file)});
        if(external) {
          const list=onIntakeUpload(key,result);
          const container=document.getElementById('intake-files');
          if(container && list) container.innerHTML=fileList(list,false);
        }
      } catch(error) {
        const remaining=new DataTransfer();
        for(const next of files.slice(index)) remaining.items.add(next);
        input.files=remaining.files;
        throw new Error((index?index+' file(s) uploaded. ':'')+file.name+' · '+error.message);
      }
    }
    f.reset();
    const message=files.length===1?'File uploaded.':files.length+' files uploaded.';
    if(external) notify(message); else await saved(message);
  }
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
  async function engagementForm(clientId) {
    const [board,info]=await Promise.all([api('/api/workspaces/solutions'),clientId?api('/api/clients/'+encodeURIComponent(clientId)):null]);
    const owners=info?info.owners:board.owners;
    const previous=info?.engagement_id?await api('/api/engagements/'+encodeURIComponent(info.engagement_id)):null;
    const details={contact:previous?.latest?.answers?.contact_name || previous?.deal.details.contact || '',
      contact_email:previous?.latest?.answers?.contact_email || previous?.deal.details.contact_email || ''};
    showDialog(info?'New engagement for '+info.client.name:'New client and engagement',editForm({line:'solutions',details},owners,getUser(),{client:info?.client,stages:board.stages}));
  }
  let clientSearch=0;
  async function clientMatches(query,list) {
    if(!list) return;
    const sequence=++clientSearch;
    const data=await api('/api/clients?limit=20&q='+encodeURIComponent(query));
    if(sequence!==clientSearch||!list.isConnected) return;
    list.innerHTML=data.items.map(c=>`<button type="button" data-action="ws-use-client" data-id="${h(c.id)}"><strong>${h(c.name)}</strong><small>${h(c.owner_name)}</small>${icon('chevron')}</button>`).join('')||'<p>No matching clients.</p>';
    if(data.next_offset!=null) list.insertAdjacentHTML('beforeend','<small>Type more of the client name to narrow these results.</small>');
  }
  let searchTimer;
  document.addEventListener('input',e=>{
    if(!e.target.matches('[data-form="ws-client-search"] [name="q"]')) return;
    const field=e.target,list=field.form.querySelector('.client-match-list');clientSearch++;
    clearTimeout(searchTimer);searchTimer=setTimeout(()=>clientMatches(field.value.trim(),list).catch(err=>notify(err.message)),140);
  });
  async function page(path, q) {
    if (path.startsWith('/inquire/')) {
      const key = path.split('/').at(-1),
        info = await api('/api/inquire/' + encodeURIComponent(key));
      const request = history.state?.inquiryKey || crypto.randomUUID();
      history.replaceState({ ...history.state, inquiryKey: request }, '');
      return `<div class="form-page narrow"><header class="ws-head"><div><p>Branded ${h(lines[info.line].name)}</p><h1>${h(info.label)}</h1></div></header>${history.state?.inquirySent ? panel('Inquiry received', '<p>The team will follow up using the email you provided.</p>') : panel('Contact the team', form('ws-inquiry', hidden('request_id', request) + field('Company', 'company', '', { required: true, max: 180 }) + field('Your name', 'name', '', { required: true, max: 150 }) + field('Email', 'email', '', { type: 'email', required: true, max: 254 }) + field('What would you like to discuss?', 'message', '', { type: 'textarea', required: true, max: 2500 }) + submit('Send inquiry'), key))}</div>`;
    }
    const allowed = (await api('/api/workspaces')).lines;
    const [, , line, key] = path.split('/');
    if (line==='media' || line==='capital') return unavailable(line);
    if (!allowed.length)
      return panel(
        'Business workspaces',
        emptyState(
          'No workspace assigned.',
          'Your administrator can assign a business line in Workspace operations.'
        )
      );
    if (!line) {
      navigate(base(allowed.includes('solutions') ? 'solutions' : allowed[0]), { replace: true });
      return '';
    }
    if (line!=='solutions') throw new Error('Workspace not found.');
    const [board, detail] = await Promise.all([
      api('/api/workspaces/solutions'), key ? api('/api/engagements/'+encodeURIComponent(key)) : null,
    ]);
    if (detail && detail.deal.line !== line) throw new Error('This engagement belongs to another workspace.');
    if (detail?.deal.client_id && (detail.deal.signed_at || lines.solutions.delivery.includes(detail.deal.stage))) {
      const tab = {overview:'account',profile:'intake',research:'map',reports:'reports',activity:'notes'}[q.get('tab')] || 'intake';
      navigate('/clients/'+detail.deal.client_id+'?tab='+tab+'&engagement='+detail.deal.id,{replace:true});
      return '';
    }
    return detail ? detailView(board.stages, detail, board.owners, getUser(), q, getZone()) : boardView(board,q,getUser()?.role==='admin');
  }
  const actions = {
    ...stageEditor.actions,
    'ws-remove-column':async b=>{
      const {stages:columns,deals}=await api('/api/workspaces/solutions');
      const key=b.dataset.id,stage=columns.find(c=>c.id===key),remaining=deals.filter(d=>d.stage===key).length;
      if(!stage) throw new Error('Reopen the stage editor.');
      showDialog('Delete '+stage.name,form('ws-delete-column',`<p>${remaining?`${remaining} engagement${remaining===1?'':'s'} will move to the stage you select.`:'This stage is empty.'}</p>`+
        (remaining?select('Move engagements to','destination',columns.filter(c=>c.id!==key && c.id!=='signed')):'')+submit('Delete stage'),key));
    },
    'ws-density': async () => { localStorage.setItem('branded-card-density',localStorage.getItem('branded-card-density')==='compact'?'comfortable':'compact'); await render(); },
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
    'ws-new': async b=>{
      if(b.dataset.client) return engagementForm(b.dataset.client);
      showDialog('New engagement',`<div class="engagement-choices"><h3>Who is this engagement for?</h3>
        ${action('Existing client','ws-existing-client','','clients')}${action('New client','ws-new-client','','plus')}</div>`);
    },
    'ws-new-client':()=>engagementForm(),
    'ws-existing-client':async()=>{
      showDialog('Choose an existing client',form('ws-client-search',field('Search clients','q','',{type:'search',placeholder:'Client name',max:180})+'<div class="client-match-list" aria-live="polite"></div>'+submit('Search')));
      await clientMatches('',document.querySelector('.client-match-list'));
    },
    'ws-use-client':b=>engagementForm(b.dataset.id),
    'ws-edit': async () => {
      const { deal } = await currentDeal();
      showDialog('Edit engagement', editForm(deal, await eligible(deal.line), getUser()));
    },
    'ws-stage': async () => {const [record,board]=await Promise.all([currentDeal(),api('/api/workspaces/solutions')]);showDialog('Move stage',stageForm(record.deal,record.deal.stage,board.stages));},
    'ws-targets': () => showDialog('Add campaign targets', targetForm()),
    'ws-item': async (b) => {
      const record=b.dataset.engagement?await api('/api/engagements/'+encodeURIComponent(b.dataset.engagement)):await currentDeal(),
        w = record.work.find((x) => x.id === b.dataset.id);
      if (!w) throw new Error('Refresh to see the latest activity.');
      showDialog(
        'Update outcome',
        form(
          'ws-outcome',
          hidden('engagement_id',record.deal.id)+hidden('previous_at', w.recorded_at) +
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
    'ws-source': async () => {
      const { users } = await api('/api/admin/operations');
      showDialog(
        'Create inquiry link',
        form(
          'ws-source',
          select(
            'Business line',
            'line',
            [{id:'solutions', name:'Solutions'}]
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
    ...stageEditor.forms,
    async 'ws-delete-column'(f,v) {await api('/api/workspaces/solutions/stages/'+f.dataset.id,'DELETE',Object.fromEntries(v));await saved('Stage deleted.');},
    async 'ws-history'(f, v) {
      await api('/api/engagements/' + f.dataset.id + '/existing-agreement', 'POST', {
        version: Number(v.get('version')),
        signed_day: v.get('signed_day'),
        agreement_url: v.get('agreement_url'),
        notify_accounting: v.has('notify_accounting'),
      });
      await saved('Existing agreement recorded.');
    },
    async 'ws-client-search'(f,v){await clientMatches(v.get('q').trim(),f.querySelector('.client-match-list'));},
    async 'ws-create'(f, v) {
      const d = { details:splitDetails(v),client_mode:v.get('client_mode'),request_id:v.get('request_id'),stage:v.get('stage')||'outreach' };
      if(v.get('client_id')) d.client_id=v.get('client_id'); else {d.company=v.get('company');d.member_ids=v.getAll('member_ids');}
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
      const {engagement_id,...changes}=Object.fromEntries(v);
      await api('/api/engagements/'+encodeURIComponent(engagement_id)+'/work/'+f.dataset.id,'PATCH',changes);
      await saved('Outcome recorded.');
    },
    'ws-file': (f,v)=>uploadFiles(f,v,false),
    'ws-intake-file': (f,v)=>uploadFiles(f,v,true),
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
  let dragged, dropTarget;
  function clearTarget() { dropTarget?.classList.remove('drop-ready'); dropTarget=null; }
  document.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.deal-card');
    if (card) {
      dragged = card;
      card.classList.add('is-lifted');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.deal);
    }
  });
  document.addEventListener('dragover', (e) => {
    const column=e.target.closest('[data-ws-stage]');
    if (column!==dropTarget) clearTarget();
    if (dragged && column && column.dataset.wsStage!==dragged.dataset.stage) {
      e.preventDefault(); dropTarget=column; column.classList.add('drop-ready');
    }
  });
  document.addEventListener('dragend', () => {
    document.querySelector('.deal-card.is-lifted')?.classList.remove('is-lifted');
    dragged = null;
    clearTarget();
  });
  async function dropCard(card,stage) {
    card?.classList.remove('is-lifted');
    dragged = null;
    clearTarget();
    if (!card || !stage) return;
    if (stage === card.dataset.stage) return;
    try {
      if (stage === 'signed' || stage === 'first_meeting_scheduled') {
        const { deal } = await api('/api/engagements/' + card.dataset.deal);
        showDialog(stage === 'signed' ? 'Record signed agreement' : 'Schedule first meeting', stageForm(deal, stage,(await api('/api/workspaces/solutions')).stages));
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
}
  document.addEventListener('drop',e=>{
    if(!dragged) return;
    e.preventDefault();
    dropCard(dragged,e.target.closest('[data-ws-stage]')?.dataset.wsStage);
  });
  let touch, timer, suppressClick=false;
  const cancelTouch=()=>{clearTimeout(timer);touch?.card.classList.remove('is-lifted');touch=null;clearTarget();};
  document.addEventListener('touchstart',e=>{
    cancelTouch();
    const card=e.target.closest('.deal-card');
    if(!card || e.touches.length!==1) return;
    const pt=e.touches[0];
    touch={card,x:pt.clientX,y:pt.clientY,active:false};
    timer=setTimeout(()=>{if(touch){touch.active=true;card.classList.add('is-lifted');}},320);
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!touch) return;
    const pt=e.touches[0];
    if(!touch.active){if(Math.hypot(pt.clientX-touch.x,pt.clientY-touch.y)>9) cancelTouch();return;}
    e.preventDefault();
    const board=touch.card.closest('.deal-board'),box=board.getBoundingClientRect();
    if(pt.clientX<box.left+50) board.scrollLeft-=32;
    if(pt.clientX>box.right-50) board.scrollLeft+=32;
    const column=document.elementFromPoint(pt.clientX,pt.clientY)?.closest('[data-ws-stage]');
    clearTarget();
    if(column && column.dataset.wsStage!==touch.card.dataset.stage){dropTarget=column;column.classList.add('drop-ready');}
  },{passive:false});
  document.addEventListener('touchend',e=>{
    if(touch?.active){
      e.preventDefault();suppressClick=true;setTimeout(()=>{suppressClick=false;},350);
      const pt=e.changedTouches[0],stage=document.elementFromPoint(pt.clientX,pt.clientY)?.closest('[data-ws-stage]')?.dataset.wsStage;
      dropCard(touch.card,stage);
    }
    cancelTouch();
  },{passive:false});
  document.addEventListener('touchcancel',cancelTouch);
  document.addEventListener('contextmenu',e=>{if(touch?.active && touch.card.contains(e.target)) e.preventDefault();});
  document.addEventListener('click',e=>{if(suppressClick && e.target.closest('.deal-card')){e.preventDefault();e.stopImmediatePropagation();}},true);
  return { actions, forms, page };
}
