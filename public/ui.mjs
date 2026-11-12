import { stageInfo } from './lifecycle.mjs';

export const h = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

// Introduction pipeline stages (one card per person or company being introduced).
export const stages = {
  to_contact: { label: 'To Contact', tone: 'blue' },
  reached_out: { label: 'Reached Out', tone: 'amber' },
  in_conversation: { label: 'In Conversation', tone: 'violet' },
  closed: { label: 'Closed', tone: 'green' },
};

const icons = {
  today: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-13 5h2m4 0h2m-8 3h2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 21v-4h6v4M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01"/>',
  pipeline: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16"/>',
  clients: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  sparkles: '<path d="m12 3 1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="m19 15 .7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
  report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 18v-3m4 3v-6m4 6v-4"/>',
  admin: '<path d="M12 22s7-3 7-9V5l-7-3-7 3v8c0 6 7 9 7 9Z"/><path d="m9 12 2 2 4-4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>',
  draft: '<path d="M6 22h12a2 2 0 0 0 2-2V8l-6-6H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2Z"/><path d="M14 2v6h6m-12 5h8m-8 4h5"/>',
  reply: '<path d="m9 10-5 5 5 5m-5-5h10a6 6 0 0 0 0-12h-2"/>',
  leads: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m4-11v6m-3-3h6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  back: '<path d="M19 12H5m7 7-7-7 7-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  link: '<path d="M10 13a4 4 0 0 0 6 0l3-3a4 4 0 1 0-6-6l-1.5 1.5m2.5 5.5a4 4 0 0 0-6 0l-3 3a4 4 0 1 0 6 6l1.5-1.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  logout: '<path d="M10 4H5v16h5m4-4 4-4-4-4m-5 4h9"/>',
  handshake: '<circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><path d="M2 20v-1a5 5 0 0 1 10 0v1m0-1a5 5 0 0 1 10 0v1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l8 5V5L7 10H4a1 1 0 0 0-1 1Z"/><path d="M18.5 8.5a5 5 0 0 1 0 7"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v3"/>',
  send: '<path d="m21 3-9.5 18-2.5-8-8-2.5z"/><path d="m21 3-12 10"/>',
  ticket: '<path d="M3 9V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a3 3 0 0 0 0 6v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a3 3 0 0 0 0-6Z"/><path d="M14 8v2m0 4v2"/>',
  news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2zm13 4h3v8a2 2 0 0 1-2 2"/><path d="M8 9h5m-5 4h5m-5 3h3"/>',
  spark: '<path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m-9 0 1 13h8l1-13m-7 4v5m4-5v5"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flag: '<path d="M5 21V4m0 1h12l-2.5 4 2.5 4H5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
};

export function icon(name) {
  return `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? ''}</svg>`;
}

export const badge = (label, tone = 'neutral', dot = false) => `<span class="badge ${h(tone)}${dot ? ' dot' : ''}">${h(label)}</span>`;
export const stageBadge = key => badge(stages[key]?.label ?? key, stages[key]?.tone, true);
export const clientStageBadge = key => badge(stageInfo[key]?.label ?? key, stageInfo[key]?.tone, true);
export const pathId = value => encodeURIComponent(String(value));
export const initials = name => String(name ?? '').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
export const avatar = (name, extra = '') => `<span class="avatar ${extra}" aria-hidden="true">${h(initials(name))}</span>`;
export const formatDate = (value, zone, options = {}) => value ? new Intl.DateTimeFormat(undefined,
  { timeZone: zone, month: 'short', day: 'numeric', ...options }).format(new Date(value)) : '—';
export const timeLabel = (value, zone) => formatDate(value, zone, { hour: 'numeric', minute: '2-digit' });
export const currentDate = zone => new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
// A calendar date (YYYY-MM-DD) has no time zone, so it is formatted as written.
export const dayLabel = (value, options = {}) => value ? new Intl.DateTimeFormat(undefined,
  { timeZone: 'UTC', month: 'short', day: 'numeric', ...options }).format(new Date(`${value}T00:00:00Z`)) : '—';
export const todayIn = zone => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const number = value => new Intl.NumberFormat().format(value ?? 0);
export const money = value => value === null || value === undefined ? '—'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
export const compactMoney = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value ?? 0);

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

const labelText = (label, required) => `${h(label)}${required ? '<span class="required" aria-hidden="true"> *</span>' : ''}`;

// One form control. type: text, textarea, select (options), multi (checkbox chips), or any input type.
export function field(label, key, value = '', { type = 'text', required = false, max = 300, placeholder = '', min, hint, autocomplete, options = [], rows = 4, step } = {}) {
  const note = hint ? `<small>${h(hint)}</small>` : '';
  if (type === 'multi') {
    const chosen = Array.isArray(value) ? value : [];
    return `<fieldset class="choice-group"><legend>${labelText(label, required)}</legend>${note}<div class="chip-list">${options.map(option =>
      `<label class="chip"><input type="checkbox" name="${h(key)}" value="${h(option)}"${chosen.includes(option) ? ' checked' : ''}>${h(option)}</label>`).join('')}</div></fieldset>`;
  }
  let control;
  if (type === 'textarea') control = `<textarea name="${h(key)}" rows="${rows}" maxlength="${max}" ${required ? 'required' : ''} placeholder="${h(placeholder)}">${h(value)}</textarea>`;
  else if (type === 'select') control = `<select name="${h(key)}" ${required ? 'required' : ''}><option value="">Select…</option>${options.map(option =>
    `<option value="${h(option)}"${option === value ? ' selected' : ''}>${h(option)}</option>`).join('')}</select>`;
  else control = `<input name="${h(key)}" type="${h(type)}" value="${h(value)}" ${type === 'number' || type === 'date' ? '' : `maxlength="${max}"`} ${required ? 'required' : ''}
    ${min !== undefined ? `min="${min}"` : ''} ${step !== undefined ? `step="${step}"` : ''} ${autocomplete ? `autocomplete="${h(autocomplete)}"` : ''} placeholder="${h(placeholder)}">`;
  return `<label class="field"><span>${labelText(label, required)}</span>${control}${note}</label>`;
}

export function select(label, key, rows, selected = '', emptyLabel) {
  const choices = [...(emptyLabel ? [{ id: '', name: emptyLabel }] : []), ...rows];
  return `<label class="field"><span>${h(label)}</span><select name="${h(key)}">${choices.map(row =>
    `<option value="${h(row.id)}"${String(row.id) === String(selected ?? '') ? ' selected' : ''}>${h(row.name)}</option>`).join('')}</select></label>`;
}

export const stageOptions = Object.entries(stages).map(([id, info]) => ({ id, name: info.label }));
export const hidden = (name, value) => `<input type="hidden" name="${h(name)}" value="${h(value)}">`;
export const btn = (label, { kind = '', action, data = '', glyph, type = 'button', title } = {}) =>
  `<button type="${type}" class="button ${h(kind)}"${action ? ` data-action="${h(action)}"` : ''}${title ? ` title="${h(title)}" aria-label="${h(title)}"` : ''}${data ? ` ${data}` : ''}>${glyph ? icon(glyph) : ''}${h(label)}</button>`;
export const link = (href, label, glyph, extra = '') => `<a href="${h(href)}" class="text-link ${h(extra)}">${glyph ? icon(glyph) : ''}${h(label)}</a>`;
export const linkButton = (href, label, { kind = '', glyph, extra = '' } = {}) =>
  `<a href="${h(href)}" class="button ${h(kind)}" ${extra}>${glyph ? icon(glyph) : ''}${h(label)}</a>`;
export const emptyState = (title, detail = '', action = '') => `<div class="empty"><strong>${h(title)}</strong>${detail ? `<p>${h(detail)}</p>` : ''}${action ? `<div class="actions">${action}</div>` : ''}</div>`;
export const heading = (title, detail = '', action = '', eyebrow = '') => `<div class="heading"><div>${eyebrow ? `<span class="eyebrow">${h(eyebrow)}</span>` : ''}<h1>${h(title)}</h1>${detail ? `<p>${h(detail)}</p>` : ''}</div>${action ? `<div class="actions">${action}</div>` : ''}</div>`;
export const brand = () => '<a class="brand" href="/today"><img width="34" height="34" src="/favicon.svg" alt=""><span>Branded Network<small>Partner workspace</small></span></a>';
export const stat = (value, label, { href, note } = {}) => {
  const body = `<strong>${h(value)}</strong><span>${h(label)}</span>${note ? `<small>${h(note)}</small>` : ''}`;
  return href ? `<a class="panel stat" href="${h(href)}">${body}</a>` : `<div class="panel stat">${body}</div>`;
};
// tabs: [[href, label, key, count?]]
export const tabs = (items, selected, label = 'Sections') => `<nav class="subnav" aria-label="${h(label)}">${items.map(([href, title, key, count]) =>
  `<a href="${h(href)}"${key === selected ? ' aria-current="page"' : ''}>${h(title)}${count ? badge(count, key === selected ? 'blue' : 'neutral') : ''}</a>`).join('')}</nav>`;

export function outboundLink(value, label) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return h(label ?? value);
    return `<a class="text-link external" href="${h(url.href)}" target="_blank" rel="noopener noreferrer">${h(label ?? value)}</a>`;
  } catch { return h(label ?? value); }
}

// section: which sidebar item to highlight. Client pages pass it once they know the client's phase.
export function shell(user, location, section) {
  if (!user) return '';
  const active = section ?? (location === '/' || location === '/today' ? 'today'
    : location.startsWith('/opportunities') ? 'opportunities'
      : location.startsWith('/clients') ? 'clients'
        : location.startsWith('/pipeline/suggestions') ? 'matches'
          : location.startsWith('/pipeline') ? 'pipeline'
            : location.startsWith('/reports') ? 'reports' : location === '/admin' ? 'admin' : '');
  const item = (key, url, label, glyph, extra = false, count = '') => `<a href="${url}"${key === active ? ' aria-current="page"' : ''}${extra ? ' class="nav-extra"' : ''}>${icon(glyph)}<span>${label}</span>${count}</a>`;
  return `<header class="sidebar">${brand()}<nav class="main-nav" aria-label="Main">
    <p class="nav-label">Workspace</p>${item('today', '/today', 'Today', 'today')}${item('opportunities', '/opportunities', 'Opportunities', 'target')}${item('clients', '/clients', 'Clients', 'building')}
    <p class="nav-label">Delivery</p>${item('pipeline', '/pipeline', 'Introductions', 'pipeline')}${item('matches', '/pipeline/suggestions', 'Matches', 'sparkles', true, '<span id="nav-matches" class="nav-count badge blue" hidden></span>')}${item('reports', '/reports', 'Reports', 'report')}
    ${user.role === 'admin' ? `<p class="nav-label">Settings</p>${item('admin', '/admin', 'Admin', 'admin', true)}` : ''}</nav>
    <div class="sidebar-foot"><button class="user-chip" data-action="account" aria-label="Account menu for ${h(user.name)}">${avatar(user.name)}<span class="user-name">${h(user.name)}<small>${user.role === 'admin' ? 'Admin' : 'Manager'}</small></span></button>
    <button class="icon-button" data-action="alerts" aria-label="Alerts" title="Alerts">${icon('bell')}<span id="alert-dot" class="alert-dot" hidden></span></button></div></header>`;
}

export function pipelineTabs(selected) {
  return tabs([['/pipeline', 'Board', 'board'], ['/pipeline/metrics', 'Metrics', 'metrics'], ['/pipeline/suggestions', 'Matches', 'suggestions']], selected, 'Introductions');
}
