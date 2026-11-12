export const h = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export const stages = {
  to_contact: { label: 'To Contact', tone: 'blue' },
  reached_out: { label: 'Reached Out', tone: 'amber' },
  in_conversation: { label: 'In Conversation', tone: 'violet' },
  closed: { label: 'Closed', tone: 'green' },
};

const icons = {
  today: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-13 5h2m4 0h2m-8 3h2"/>',
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
};

export function icon(name) {
  return `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? ''}</svg>`;
}

export const kitIcon = (name, active = false) =>
  `<img class="icon" src="/assets/icons/${h(name)}-${active ? 'iris' : 'ink'}.png" width="20" height="20" alt="">`;

export const badge = (label, tone = 'neutral') => `<span class="badge ${h(tone)}">${h(label)}</span>`;
export const stageBadge = key => badge(stages[key]?.label ?? key, stages[key]?.tone);
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

export const field = (label, key, value = '', { type = 'text', required = false, max = 300, placeholder = '', min, hint, autocomplete } = {}) =>
  `<label class="field"><span>${h(label)}${required ? '<span class="required" aria-hidden="true"> *</span>' : ''}</span>${type === 'textarea'
    ? `<textarea name="${h(key)}" rows="4" maxlength="${max}" ${required ? 'required' : ''} placeholder="${h(placeholder)}">${h(value)}</textarea>`
    : `<input name="${h(key)}" type="${h(type)}" value="${h(value)}" maxlength="${max}" ${required ? 'required' : ''}
      ${min !== undefined ? `min="${min}"` : ''} ${autocomplete ? `autocomplete="${h(autocomplete)}"` : ''} placeholder="${h(placeholder)}">`}${hint ? `<small>${h(hint)}</small>` : ''}</label>`;

export function select(label, key, rows, selected = '', emptyLabel) {
  const choices = [...(emptyLabel ? [{ id: '', name: emptyLabel }] : []), ...rows];
  return `<label class="field"><span>${h(label)}</span><select name="${h(key)}">${choices.map(row =>
    `<option value="${h(row.id)}"${String(row.id) === String(selected ?? '') ? ' selected' : ''}>${h(row.name)}</option>`).join('')}</select></label>`;
}

export const stageOptions = Object.entries(stages).map(([id, info]) => ({ id, name: info.label }));
export const hidden = (name, value) => `<input type="hidden" name="${h(name)}" value="${h(value)}">`;
export const btn = (label, { kind = '', action, data = '', glyph, type = 'button' } = {}) =>
  `<button type="${type}" class="button ${h(kind)}"${action ? ` data-action="${h(action)}"` : ''}${data ? ` ${data}` : ''}>${glyph ? icon(glyph) : ''}${h(label)}</button>`;
export const link = (href, label, glyph, extra = '') => `<a href="${h(href)}" class="text-link ${h(extra)}">${glyph ? icon(glyph) : ''}${h(label)}</a>`;
export const emptyState = (title, detail = '') => `<div class="empty"><strong>${h(title)}</strong>${detail ? `<p>${h(detail)}</p>` : ''}</div>`;
export const heading = (title, detail = '', action = '') => `<div class="heading"><div><h1>${h(title)}</h1>${detail ? `<p>${h(detail)}</p>` : ''}</div>${action}</div>`;
export const brand = () => '<a class="brand" href="/today"><img width="36" height="36" src="/assets/brand/favicon-48.png" alt=""><span>Branded Network<small>Solutions Pipeline</small></span></a>';

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
    ['/pipeline', 'Pipeline', 'pipeline', location.startsWith('/pipeline')],
    ['/clients', 'Clients', 'clients', location.startsWith('/clients')],
  ];
  if (user.role === 'admin') sections.push(['/admin', 'Admin', 'settings', location === '/admin']);
  const nav = sections.map(([url, label, glyph, active]) => `<a href="${url}"${active ? ' aria-current="page"' : ''}>${kitIcon(glyph, active)}<span>${label}</span></a>`).join('');
  return `<header class="app-header"><div class="bar">${brand()}<nav class="main-nav" aria-label="Main">${nav}</nav>
    <div class="account-actions"><button class="icon-button" data-action="alerts" aria-label="Alerts" title="Alerts">${kitIcon('alerts')}<span id="alert-dot" class="alert-dot" hidden></span></button>
    <button class="avatar" data-action="account" aria-label="Account menu for ${h(user.name)}" title="${h(user.name)}">${h(initials(user.name))}</button></div></div></header>`;
}

export function pipelineTabs(selected) {
  return `<nav class="subnav" aria-label="Pipeline">${[
    ['/pipeline', 'Board', 'board', 'pipeline'],
    ['/pipeline/metrics', 'Metrics', 'metrics', 'metrics'],
    ['/pipeline/suggestions', 'Suggested leads', 'suggestions', 'suggested-leads'],
  ].map(([url, title, key, glyph]) => `<a href="${url}"${key === selected ? ' aria-current="page"' : ''}>${kitIcon(glyph, key === selected)}${title}</a>`).join('')}</nav>`;
}
