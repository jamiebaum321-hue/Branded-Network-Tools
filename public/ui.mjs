export const h = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export const stages = {
  to_contact: { label: 'To Contact', tone: 'blue', glyph: 'leads' },
  reached_out: { label: 'Reached Out', tone: 'amber', glyph: 'mail' },
  in_conversation: { label: 'In Conversation', tone: 'violet', glyph: 'reply' },
  closed: { label: 'Closed', tone: 'green', glyph: 'check' },
};

const icons = {
  today: '<rect x="3" y="5" width="18" height="16" rx="3" fill="currentColor" fill-opacity=".07"/><path d="M8 3v4m8-4v4M3 10h18m-13 6 2.5 2 5-4"/>',
  draft: '<path d="M6 22h12a2 2 0 0 0 2-2V8l-6-6H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2Z"/><path d="M14 2v6h6m-12 5h8m-8 4h5"/>',
  reply: '<path d="m9 10-5 5 5 5m-5-5h10a6 6 0 0 0 0-12h-2"/>',
  leads: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m4-11v6m-3-3h6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="M19 12H5m7 7-7-7 7-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  link: '<path d="M10 13a4 4 0 0 0 6 0l3-3a4 4 0 1 0-6-6l-1.5 1.5m2.5 5.5a4 4 0 0 0-6 0l-3 3a4 4 0 1 0 6 6l1.5-1.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  logout: '<path d="M10 4H5v16h5m4-4 4-4-4-4m-5 4h9"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m1-15a3 3 0 0 1 0 6m2 3a4 4 0 0 1 3 4v2"/>',
  building: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 21v-4h6v4M8 8h2m4 0h2m-8 4h2m4 0h2"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="3" fill="currentColor" fill-opacity=".07"/><path d="M9 4v16m6-16v16M5.5 8h1m5 0h1m5 0h1m-13 4h1m5 3h1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flag: '<path d="M5 21V4m0 1c4-3 7 3 14 0v9c-7 3-10-3-14 0"/>',
  grip: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 5a1 1 0 0 0-1-1H6a2 2 0 0 0-2 2v8a1 1 0 0 0 1 1"/>',
  history: '<path d="M3 8h4V4m-4 4a9 9 0 1 1 0 8m9-9v5l3 2"/>',
  edit: '<path d="M13 20H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h7m3-1 4 4m-9 7-1 .2.2-4L17 4a2 2 0 0 1 3 3l-8 8Z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  stack: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="white"/><circle cx="15" cy="12" r="2" fill="white"/><circle cx="10" cy="18" r="2" fill="white"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 5-2 6-2 8h16c0-2-2-3-2-8m-8 11a2 2 0 0 0 4 0"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>',
  clients: '<path d="M15 19H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v2" fill="currentColor" fill-opacity=".07"/><path d="M7 8h7M7 12h4"/><rect x="12" y="11" width="9" height="10" rx="2.4" fill="currentColor" fill-opacity=".1"/><path d="M15 16h3m-1.5-1.5v3"/>',
  shield: '<path d="M12 2.8c2.5 2 5 2.8 8 3.2v5.3c0 5.3-3.1 8.3-8 10-4.9-1.7-8-4.7-8-10V6c3-.4 5.5-1.2 8-3.2Z" fill="currentColor" fill-opacity=".07"/><path d="m8.5 12 2.2 2.3 4.8-5"/>',
  metrics: '<path d="M4 4v14a2 2 0 0 0 2 2h14"/><path d="M8 16v-4m5 4V8m5 8V5" stroke-width="2.2"/>',
  shortlist: '<path d="M12 21H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h7m-5 5h3m-3 4h4"/><path d="M17.6 8.7 19 12l3.3 1.4L19 15l-1.4 3.3L16 15l-3.3-1.6L16 12l1.6-3.3Z" fill="currentColor" fill-opacity=".14"/><path d="M19 4v3m-1.5-1.5h3"/>',
  network: '<path d="M6 17c2.1-.7 3.5-3 6-8 2.4 4.9 3.8 7.3 6 8M6 17a15 15 0 0 0 12 0"/><circle cx="12" cy="7.5" r="2.6" fill="currentColor" fill-opacity=".25"/><circle cx="5" cy="17" r="2.4" fill="currentColor" fill-opacity=".25"/><circle cx="19" cy="17" r="2.4" fill="currentColor" fill-opacity=".25"/>',
  intake: '<path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" fill="currentColor" fill-opacity=".06"/><rect x="8" y="3" width="8" height="4" rx="1.5"/><path d="m8 12 1.4 1.6L12 11m2 2h2m-8 4h8"/>',
};

export function icon(name) {
  return `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name] ?? ''}</svg>`;
}

export const badge = (label, tone = 'neutral', glyph) => `<span class="badge ${h(tone)}">${glyph ? icon(glyph) : ''}${h(label)}</span>`;
export const stageBadge = key => badge(stages[key]?.label ?? key, stages[key]?.tone, stages[key]?.glyph);
export const pathId = value => encodeURIComponent(String(value));
export const initials = name => String(name ?? '').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
export const formatDate = (value, zone, options = {}) => value ? new Intl.DateTimeFormat(undefined,
  { timeZone: zone, month: 'short', day: 'numeric', ...options }).format(new Date(value)) : '—';
export const timeLabel = (value, zone) => formatDate(value, zone, { hour: 'numeric', minute: '2-digit' });
export const currentDate = zone => new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

export function stageDuration(start, end = Date.now()) {
  const hours = Math.max(0, Math.floor((new Date(end) - new Date(start)) / 3600000));
  if (hours < 1) return 'Under 1 hour';
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export function localInput(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function field(label, key, value = '', { type = 'text', required = false, max = 300, placeholder = '', min, hint, autocomplete, glyph, step } = {}) {
  const input = type === 'textarea'
    ? `<textarea name="${h(key)}" rows="4" maxlength="${max}" ${required ? 'required' : ''} placeholder="${h(placeholder)}">${h(value)}</textarea>`
    : `<input name="${h(key)}" type="${h(type)}" value="${h(value)}" maxlength="${max}" ${required ? 'required' : ''}
      ${min !== undefined ? `min="${min}"` : ''} ${step ? `step="${h(step)}"` : ''} ${autocomplete ? `autocomplete="${h(autocomplete)}"` : ''} placeholder="${h(placeholder)}">`;
  return `<label class="field"><span>${h(label)}${required ? '<span class="required" aria-hidden="true"> *</span>' : ''}</span>
    ${glyph ? `<span class="field-control">${icon(glyph)}${input}</span>` : input}${hint ? `<small>${h(hint)}</small>` : ''}</label>`;
}

export function select(label, key, rows, selected = '', emptyLabel) {
  const choices = [...(emptyLabel ? [{ id: '', name: emptyLabel }] : []), ...rows];
  return `<label class="field"><span>${h(label)}</span><select name="${h(key)}">${choices.map(row =>
    `<option value="${h(row.id)}"${String(row.id) === String(selected ?? '') ? ' selected' : ''}>${h(row.name)}</option>`).join('')}</select></label>`;
}

export const stageOptions = Object.entries(stages).map(([id, info]) => ({ id, name: info.label }));
export const hidden = (name, value) => `<input type="hidden" name="${h(name)}" value="${h(value)}">`;
export const btn = (label, { kind = '', action, data = '', glyph, endGlyph, type = 'button' } = {}) =>
  `<button type="${type}" class="button ${h(kind)}"${action ? ` data-action="${h(action)}"` : ''}${data ? ` ${data}` : ''}>${glyph ? icon(glyph) : ''}${h(label)}${endGlyph ? `<span class="button-end">${icon(endGlyph)}</span>` : ''}</button>`;
export const link = (href, label, glyph, extra = '') => `<a href="${h(href)}" class="text-link ${h(extra)}">${glyph ? icon(glyph) : ''}${h(label)}</a>`;
export const emptyState = (title, detail = '') => `<div class="empty"><strong>${h(title)}</strong>${detail ? `<p>${h(detail)}</p>` : ''}</div>`;
export function heading(title, detail = '', action = '', { art, date, compact = false, signature = false } = {}) {
  const copy = `${date ? `<span class="date-label">${h(date)}</span>` : ''}<h1>${h(title)}</h1>${detail ? `<p>${h(detail)}</p>` : ''}`;
  if (!art) return `<div class="heading"><div>${copy}</div>${action}</div>`;
  return `<div class="heading page-hero${compact ? ' compact' : ''}${signature ? ' signature' : ''}" data-art="${h(art)}">
    <div class="hero-copy">${copy}${action ? `<div class="hero-actions">${action}</div>` : ''}</div>
    <div class="hero-visual" aria-hidden="true"><img src="/assets/artwork/${h(art)}.webp" width="240" height="136" alt="" decoding="async"></div></div>`;
}
export const brand = () => '<a class="brand" href="/today"><img width="39" height="39" src="/assets/brand/network-mark.svg" alt=""><span>Branded Network<small>Solutions Pipeline</small></span></a>';

export function outboundLink(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return h(value);
    return `<a class="text-link external" href="${h(url.href)}" target="_blank" rel="noopener noreferrer">${h(value)}</a>`;
  } catch { return h(value); }
}

export function shell(user, location) {
  if (!user) return '';
  const sections = [
    ['/today', 'Today', 'today', location === '/' || location === '/today'],
    ['/pipeline', 'Pipeline', 'board', location.startsWith('/pipeline')],
    ['/clients', 'Clients', 'clients', location.startsWith('/clients')],
    ['/followups', 'Follow-ups', 'flag', location === '/followups'],
    ['/contracts', 'Contracts', 'draft', location === '/contracts'],
  ];
  if (user.role === 'admin') sections.push(['/admin', 'Admin', 'shield', location === '/admin']);
  const current = sections.find(section => section[3]);
  const nav = sections.map(([url, label, glyph, active]) => `<a href="${url}"${active ? ' aria-current="page"' : ''}><span class="nav-icon">${icon(glyph)}</span><span>${label}</span></a>`).join('');
  return `<header class="app-header"><div class="bar"><div class="bar-brand">${brand()}</div>
    <div class="workspace-context" aria-hidden="true">${icon('network')}<span>Workspace</span>${icon('chevron')}<strong>${h(current?.[1] ?? 'Today')}</strong></div>
    <div class="app-rail"><div class="rail-brand">${brand()}</div><span class="rail-caption" aria-hidden="true">Workspace</span><nav class="main-nav" aria-label="Main">${nav}</nav></div>
    <div class="account-actions"><button class="icon-button" data-action="alerts" aria-label="Alerts" title="Alerts">${icon('bell')}<span id="alert-dot" class="alert-dot" hidden></span></button>
    <button class="account-button" data-action="account" aria-label="Account menu for ${h(user.name)}" title="${h(user.name)}"><span class="avatar" aria-hidden="true">${h(initials(user.name))}</span><span class="account-name" aria-hidden="true">${h(user.name)}${icon('down')}</span></button></div></div></header>`;
}

export function pipelineTabs(selected) {
  return `<nav class="subnav" aria-label="Pipeline">${[
    ['/pipeline', 'Board', 'board', 'board'],
    ['/pipeline/metrics', 'Metrics', 'metrics', 'metrics'],
    ['/pipeline/suggestions', 'Suggested leads', 'suggestions', 'shortlist'],
  ].map(([url, title, key, glyph]) => `<a href="${url}"${key === selected ? ' aria-current="page"' : ''}>${icon(glyph)}${title}</a>`).join('')}</nav>`;
}

// Calendar dates (YYYY-MM-DD) carry no time zone; show them as written.
export function dayLabel(value, withYear = true) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) })
    .format(new Date(`${value}T12:00:00Z`));
}

export const money = value => value === null || value === undefined || value === '' ? '—'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
