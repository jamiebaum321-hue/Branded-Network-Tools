import { sections } from './intake-fields.mjs';
import { recordKinds } from './record-kinds.mjs';
import { btn, emptyState, h, heading, icon, link, pathId, shell, stages } from './ui.mjs';
import { activityItems, adminPage, alertRows, auditRows, boardCard, boardPage, cardPage, clientForm, clientPage,
  clientRows, clientsPage, contractsPage, followupsPage, recordForm, createCardForm, intakePage, inviteForm, jobTokenForm, metricsPage, setupPage, signInPage,
  submissionPage, submissionRows, suggestionPage, suggestionRows, suggestionsPage, todayPage } from './views.mjs';

const main = document.querySelector('#main');
const chrome = document.querySelector('#shell');
const dialog = document.querySelector('#dialog');
const status = document.querySelector('#toast');
let user = null;
let zone = 'America/New_York';
let context = null;
// Records shown on the current page, so the edit dialog opens without another request.
const recordCache = new Map();
const remember = rows => { for (const row of rows) recordCache.set(row.id, row); };
let revision = 0;
let stage = 'to_contact';
let wizard = null;
let imported = null;
let seed = null;
let dragged = null;
let dropColumn = null;
let toastTimer;
let todayAcknowledgement = Promise.resolve();

class RequestError extends Error {
  constructor(code, payload) {
    super(payload.error || 'The request failed. Try again.');
    this.code = code;
    this.details = payload.details;
  }
}

async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RequestError(response.status, data);
  return data;
}

function notify(message) {
  clearTimeout(toastTimer);
  status.innerHTML = `${icon('info')}<span>${h(message)}</span>`;
  status.hidden = false;
  toastTimer = setTimeout(() => { status.hidden = true; }, 4200);
}

function showDialog(title, body, { flush = false, glyph = 'draft' } = {}) {
  const currentBody = dialog.querySelector('.dialog-body');
  if (dialog.open && currentBody && dialog.querySelector('#dialog-title')?.textContent === title) {
    currentBody.classList.toggle('flush', flush);
    currentBody.innerHTML = body;
    return;
  }
  dialog.innerHTML = `<div class="dialog-head"><span class="dialog-icon">${icon(glyph)}</span><h2 id="dialog-title">${h(title)}</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close">${icon('close')}</button></div>
    <div class="dialog-body ${flush ? 'flush' : ''}">${body}</div>`;
  if (!dialog.open) dialog.showModal();
}

dialog.addEventListener('close', () => { if (!dialog.open) dialog.replaceChildren(); });

async function clipboard(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    notify(message);
  } catch {
    showDialog('Copy text', `<label class="field"><span>Select and copy</span><textarea readonly rows="4">${h(value)}</textarea></label>`, { glyph: 'copy' });
    dialog.querySelector('textarea').select();
  }
}

function revealValue(title, value, detail) {
  showDialog(title, `<div class="stack"><p class="muted">${h(detail)}</p><label class="field"><span>${h(title)}</span><textarea rows="3" readonly>${h(value)}</textarea></label>
    <div>${btn('Copy', { kind: 'primary', action: 'copy-dialog-value', glyph: 'copy' })}</div></div>`, { glyph: 'copy' });
}

const queryPath = (path, query) => `${path}${query.size ? `?${query}` : ''}`;
const queryHere = () => new URLSearchParams(location.search);
const getContext = async () => ({ ...await api('/api/context'), user });

function suggestionQuery(query) {
  const result = new URLSearchParams(query);
  if (!result.has('status')) result.set('status', 'pending');
  if (result.get('status') === 'all') result.delete('status');
  return result;
}

function navigate(path, { replace = false } = {}) {
  const target = new URL(path, location.origin);
  if (target.origin !== location.origin) return;
  if (dialog.open) dialog.close();
  if (!target.pathname.startsWith('/onboard/')) wizard = null;
  if (target.pathname !== '/admin' || target.searchParams.get('tab') !== 'import') { seed = null; imported = null; }
  const url = `${target.pathname}${target.search}${target.hash}`;
  if (replace) history.replaceState(null, '', url);
  else if (url !== `${location.pathname}${location.search}${location.hash}`) history.pushState(null, '', url);
  void render({ focus: true });
}

function show(html, focus, hash) {
  main.innerHTML = html;
  // The content security policy forbids inline style attributes, so positions travel as data attributes.
  for (const element of main.querySelectorAll('[data-left]')) {
    element.style.left = `${element.dataset.left}%`;
    if (element.dataset.width) element.style.width = `${element.dataset.width}%`;
  }
  main.setAttribute('aria-busy', 'false');
  if (hash) {
    let target;
    try { target = document.getElementById(decodeURIComponent(hash.slice(1))); } catch { /* invalid anchor */ }
    if (target) {
      if (target.tagName === 'DETAILS') target.open = true;
      target.classList.add('targeted');
      target.scrollIntoView({ block: 'start' });
      if (target.matches('[tabindex]')) target.focus({ preventScroll: true });
      return;
    }
  }
  if (focus) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
}

function updateDot(data) {
  const dot = document.querySelector('#alert-dot');
  if (dot) dot.hidden = !data.unread;
}

function refreshAlertDot() {
  if (!user || document.hidden || !document.querySelector('#alert-dot')) return;
  const accountId = user.id;
  void api('/api/alerts').then(data => { if (user?.id === accountId) updateDot(data); }).catch(() => {});
}

function showError(error, focus = false) {
  if (error.code === 401 && user) {
    user = null;
    if (dialog.open) dialog.close();
    chrome.replaceChildren();
    show(signInPage(), true);
    return;
  }
  const title = error.code === 404 ? 'Page not found' : error.code === 403 ? 'Access required' : 'Couldn’t open this page';
  show(`<div class="form-page">${heading(title, error.message || 'Please try again.')}<div class="actions">${user ? link('/today', 'Back to Today', 'back') : btn('Try again', { action: 'reload' })}</div></div>`, focus);
}

async function render({ focus = false } = {}) {
  const current = ++revision;
  const path = location.pathname;
  const query = queryHere();
  const hash = location.hash;
  const publicRoute = path.startsWith('/setup/') || path.startsWith('/onboard/');
  chrome.innerHTML = publicRoute ? '' : shell(user, path);
  main.setAttribute('aria-busy', 'true');
  if (focus) main.innerHTML = '<p class="loading" role="status">Loading…</p>';
  try {
    let html;
    let todayResult;
    if (path.startsWith('/setup/')) {
      const key = path.split('/').at(-1);
      html = setupPage(await api(`/api/setup/${pathId(key)}`), key);
    } else if (path.startsWith('/onboard/')) {
      const key = path.split('/').at(-1);
      if (wizard?.key !== key) {
        const info = await api(`/api/onboard/${pathId(key)}`);
        if (current !== revision) return;
        wizard = { key, info, answers: info.draft, step: 0 };
      }
      html = intakePage(wizard.info, key, wizard.step, wizard.answers);
    } else if (!user) html = signInPage();
    else if (path === '/' || path === '/signin' || path === '/today') {
      if (path !== '/today') history.replaceState(null, '', '/today');
      todayResult = await api('/api/today');
      html = todayPage(todayResult, zone);
    } else if (path === '/pipeline') {
      const [data, ctx] = await Promise.all([api(queryPath('/api/board', query)), getContext()]);
      if (current !== revision) return;
      context = ctx;
      html = boardPage(data.groups, ctx, query, zone, stage);
    } else if (path === '/pipeline/metrics') {
      const [data, ctx] = await Promise.all([api(queryPath('/api/metrics', query)), getContext()]);
      html = metricsPage(data, ctx, query, zone);
    } else if (path === '/pipeline/suggestions') {
      const [data, ctx] = await Promise.all([api(queryPath('/api/suggestions', suggestionQuery(query))), getContext()]);
      html = suggestionsPage(data, ctx, query);
    } else if (path.startsWith('/pipeline/cards/')) {
      const cardId = path.split('/').at(-1);
      const activity = hash.startsWith('#activity-') ? `?activity_id=${pathId(hash.slice(10))}` : '';
      const data = await api(`/api/cards/${pathId(cardId)}${activity}`);
      const chosen = query.get('stage');
      html = cardPage(data, zone, Object.hasOwn(stages, chosen ?? '') ? chosen : '', hash);
    } else if (path.startsWith('/pipeline/suggestions/')) {
      html = suggestionPage((await api(`/api/suggestions/${pathId(path.split('/').at(-1))}`)).suggestion);
    } else if (path === '/clients') {
      const [data, ctx] = await Promise.all([api(queryPath('/api/clients', query)), getContext()]);
      if (current !== revision) return;
      context = ctx;
      html = clientsPage(data, query, user, zone);
    } else if (/^\/clients\/[\w-]+\/submissions\/[\w-]+$/.test(path)) {
      html = submissionPage((await api(`/api${path}`)).submission, zone);
    } else if (path.startsWith('/clients/')) {
      const [data, ctx] = await Promise.all([api(`/api${path}`), getContext()]);
      if (current !== revision) return;
      context = ctx;
      remember(Object.values(data.records ?? {}).flat());
      html = clientPage(data, ctx, zone);
    } else if (path === '/followups') {
      const [data, issues] = await Promise.all([api('/api/followups'), api('/api/issues')]);
      remember(issues.items);
      html = followupsPage({ ...data, issues: issues.items, admin: user.role === 'admin' });
    } else if (path === '/contracts') {
      html = contractsPage(await api('/api/contracts'));
    } else if (path === '/admin') {
      if (user.role !== 'admin') throw new RequestError(403, { error: 'Ask an admin for access.' });
      const tab = ['audit','import','mcp'].includes(query.get('tab')) ? query.get('tab') : 'accounts';
      const ctxPromise = getContext();
      let data;
      if (tab === 'audit') {
        const [page, accounts] = await Promise.all([api(queryPath('/api/admin/audit', query)), api('/api/admin/accounts')]);
        data = { ...page, users: accounts.items };
      } else data = tab === 'import' ? {} : await api(tab === 'mcp' ? '/api/admin/job-tokens' : '/api/admin/accounts');
      const ctx = await ctxPromise;
      if (current !== revision) return;
      context = ctx;
      html = adminPage(tab, data, ctx, query, zone, imported);
    } else throw new RequestError(404, { error: 'This page doesn’t exist.' });
    if (current !== revision) return;
    show(html, focus, hash);
    if (todayResult) todayAcknowledgement = api('/api/today/seen', 'POST', { reply_cursor: todayResult.reply_cursor }).catch(() => {});
    if (user && !publicRoute) refreshAlertDot();
  } catch (error) {
    if (current === revision) showError(error, focus);
  }
}

const accountText = ['stage', 'deal_status', 'agreement_status', 'sca_url', 'website', 'team', 'renewal_terms', 'about', 'wants', 'success'];
const accountNumbers = ['monthly_fee', 'term_months', 'referral_y1', 'referral_y2', 'referral_y3'];
const accountDates = ['contract_start', 'contract_end', 'sca_signed'];

function accountInput(data) {
  const value = {};
  for (const key of accountText) value[key] = String(data.get(key) ?? '');
  for (const key of accountNumbers) {
    const raw = String(data.get(key) ?? '').trim();
    value[key] = raw === '' ? null : Number(raw);
    if (value[key] !== null && !Number.isFinite(value[key])) throw new Error('Enter numbers for the fee, term and referral percentages.');
  }
  for (const key of accountDates) value[key] = data.get(key) || null;
  value.contacts = String(data.get('contacts') ?? '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [name, title = '', email = '', phone = '', ...notes] = line.split('|').map(part => part.trim());
    return { name, title, email, phone, notes: notes.join(' | ') };
  });
  return value;
}

function dateFromInput(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (!Number.isFinite(+parsed)) throw new Error('Enter a valid date and time.');
  return parsed.toISOString();
}

function readWizard(form) {
  const current = sections[wizard.step];
  const data = new FormData(form);
  for (const def of current.fields) {
    if (def.rows) {
      const rows = [];
      const prefix = `rows|${def.key}|`;
      for (const [name, value] of data) if (name.startsWith(prefix)) {
        const [index, child] = name.slice(prefix.length).split('|');
        (rows[Number(index)] ??= {})[child] = value;
      }
      wizard.answers[def.key] = rows.filter(Boolean);
    } else {
      const value = data.get(def.key);
      if (def.type === 'number' && value !== '') wizard.answers[def.key] = Number(value);
      else if (def.type === 'number') delete wizard.answers[def.key];
      else wizard.answers[def.key] = value;
    }
  }
}

async function advanceWizard(form, how) {
  readWizard(form);
  const path = `/api/onboard/${pathId(wizard.key)}`;
  if (how === 'next' && wizard.step === sections.length - 1) {
    await api(`${path}/submit`, 'POST', wizard.answers);
    wizard.info = { ...wizard.info, submitted: true };
    wizard.answers = {};
  } else {
    await api(`${path}/draft`, 'POST', wizard.answers);
    if (how === 'next') wizard.step++;
    if (how === 'back') wizard.step--;
    if (how === 'save') { notify('Draft saved.'); return; }
  }
  await render({ focus: true });
}

const forms = {
  filter(form, data) {
    const query = new URLSearchParams([...data].filter(([, value]) => String(value).trim()).map(([key, value]) => [key, String(value).trim()]));
    navigate(queryPath(location.pathname, query));
  },
  async signin(form, data) {
    user = (await api('/api/session', 'POST', Object.fromEntries(data))).user;
    if (['/', '/signin'].includes(location.pathname)) navigate('/today', { replace: true });
    else await render({ focus: true });
  },
  async setup(form, data) {
    if (data.get('password') !== data.get('confirmation')) throw new Error('The passwords do not match.');
    user = (await api(`/api/setup/${pathId(form.dataset.id)}`, 'POST', { password: data.get('password') })).user;
    navigate('/today', { replace: true });
  },
  async 'add-card'(form, data) {
    const value = Object.fromEntries(data);
    value.due_at = dateFromInput(value.due_at);
    const { card } = await api('/api/cards', 'POST', value);
    notify('Contact added.');
    navigate(`/pipeline/cards/${pathId(card.id)}`);
  },
  async 'card-edit'(form, data) {
    const value = Object.fromEntries(data);
    value.version = Number(value.version);
    value.due_at = dateFromInput(value.due_at);
    value.deal_value = value.deal_value === '' || value.deal_value === undefined ? null : Number(value.deal_value);
    await api(`/api/cards/${pathId(form.dataset.id)}`, 'PATCH', value);
    notify('Card saved.');
    navigate(location.pathname, { replace: true });
  },
  async activity(form, data) {
    const value = Object.fromEntries(data);
    const input = { kind: value.kind, body: value.body };
    if (value.kind !== 'note') {
      input.subject = value.subject;
      if (value.occurred_at) input.occurred_at = dateFromInput(value.occurred_at);
      if (value.mailbox_scope) input.mailbox_scope = value.mailbox_scope;
      if (value.outlook_message_id) input.outlook_message_id = value.outlook_message_id;
      if (value.kind === 'sent' && value.draft_id) input.draft_id = value.draft_id;
    }
    const result = await api(`/api/cards/${pathId(form.dataset.id)}/activity`, 'POST', input);
    notify('Activity recorded.');
    navigate(`${location.pathname}#activity-${pathId(result.activity.id)}`);
  },
  async 'link-mail'(form, data) {
    const input = Object.fromEntries(data);
    const cardId = input.card_id;
    delete input.card_id;
    await api(`/api/cards/${pathId(cardId)}/activity/${pathId(form.dataset.id)}/source`, 'POST', input);
    notify('Message ID linked.');
    await render();
  },
  async draft(form, data) {
    const input = Object.fromEntries(data);
    if (!input.draft_id) { delete input.draft_id; delete input.updated_at; }
    const { draft } = await api(`/api/cards/${pathId(form.dataset.id)}/drafts`, 'POST', input);
    notify('Draft saved.');
    navigate(`${location.pathname}#draft-${pathId(draft.id)}`, { replace: true });
  },
  async 'add-client'(form, data) {
    const { client } = await api('/api/clients', 'POST', { name: data.get('name'), owner_id: data.get('owner_id'), member_ids: data.getAll('member_ids'),
      stage: data.get('stage') || 'pipeline' });
    notify('Client added.');
    navigate(`/clients/${pathId(client.id)}`);
  },
  async 'client-edit'(form, data) {
    await api(`/api/clients/${pathId(form.dataset.id)}`, 'PATCH', { name: data.get('name'), owner_id: data.get('owner_id'),
      member_ids: data.getAll('member_ids'), ...accountInput(data) });
    notify('Client settings saved.');
    await render();
  },
  async record(form, data) {
    const kind = form.dataset.kind;
    const value = {};
    for (const def of recordKinds[kind].fields) {
      const raw = String(data.get(def.key) ?? '').trim();
      if (['int', 'number'].includes(def.type)) {
        value[def.key] = raw === '' ? null : Number(raw);
        if (value[def.key] !== null && !Number.isFinite(value[def.key])) throw new Error(`Enter a number for ${def.label}.`);
      } else value[def.key] = ['date', 'month'].includes(def.type) && !raw ? null : raw;
    }
    if (form.dataset.id) await api(`/api/records/${pathId(form.dataset.id)}`, 'PATCH', { data: value });
    else await api(form.dataset.client ? `/api/clients/${pathId(form.dataset.client)}/records` : '/api/records', 'POST', { kind, data: value });
    dialog.close();
    notify('Saved.');
    await render();
  },
  async 'next-step'(form, data) {
    await api(`/api/clients/${pathId(form.dataset.id)}/next-step`, 'POST', { next_step: data.get('next_step'), next_due: data.get('next_due') || null,
      next_owner: data.get('next_owner'), latest: data.get('latest') });
    notify('Next step saved.');
    await render();
  },
  async intake(form) { await advanceWizard(form, 'next'); },
  async 'invite-account'(form, data) {
    const result = await api('/api/admin/accounts', 'POST', Object.fromEntries(data));
    await render();
    revealValue('One-time setup link', new URL(result.setup.path, location.origin).href, 'Share this link with the invited user. It expires in 24 hours.');
  },
  async 'edit-account'(form, data) {
    const value = Object.fromEntries(data);
    value.enabled = value.enabled === 'true';
    value.onboarding_alerts = data.has('onboarding_alerts');
    await api(`/api/admin/accounts/${pathId(form.dataset.id)}`, 'PATCH', value);
    notify('Account saved.');
    await render();
  },
  async 'new-job'(form, data) {
    const result = await api('/api/admin/job-tokens', 'POST', { label: data.get('label'), days: Number(data.get('days')),
      all_clients: data.has('all_clients'), client_ids: data.getAll('client_ids') });
    await render();
    revealValue('Claude job credential', result.token, 'Copy this value into the team job’s secret store. This is the only time it’s displayed.');
  },
  async 'preview-import'(form, data) {
    const file = data.get('file');
    if (!file?.size || file.size > 5 * 1024 * 1024) throw new Error('Choose a JSON export up to 5 MB.');
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid JSON.'); }
    const result = await api('/api/admin/import/preview', 'POST', parsed);
    imported = result;
    seed = result.errors.length ? null : parsed;
    await render();
  },
};

function formError(form, message) {
  let error = form.querySelector('[data-form-error]');
  if (!error) {
    error = document.createElement('p');
    error.className = 'error';
    error.dataset.formError = '';
    error.setAttribute('role', 'alert');
    form.append(error);
  }
  error.textContent = message;
}

document.addEventListener('submit', async event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const handler = forms[form.dataset.form];
  if (!handler || form.dataset.busy) return;
  const data = new FormData(form);
  const controls = [...form.querySelectorAll('button')].filter(button => !button.disabled);
  form.dataset.busy = 'true';
  controls.forEach(button => { button.disabled = true; });
  form.querySelector('[data-form-error]')?.remove();
  try { await handler(form, data); }
  catch (error) {
    if (error.code === 401 && form.dataset.form !== 'signin') showError(error);
    else formError(form, error.message);
  } finally {
    delete form.dataset.busy;
    controls.forEach(button => { button.disabled = false; });
  }
});

async function showAlerts() {
  showDialog('Alerts', '<p class="loading">Loading alerts…</p>', { glyph: 'bell' });
  const data = await api('/api/alerts');
  if (!dialog.open || dialog.querySelector('#dialog-title')?.textContent !== 'Alerts') return;
  const unseen = data.items.filter(item => !item.seen_at).map(item => item.id);
  showDialog('Alerts', `${alertRows(data, zone)}${unseen.length ? `<div class="pagination">${btn('Mark these as read', { action: 'mark-alerts', glyph: 'check', data: `data-ids="${h(unseen.join(','))}"` })}</div>` : ''}`, { flush: true, glyph: 'bell' });
  updateDot(data);
}

function mailDraft(form) {
  const data = new FormData(form);
  const recipient = String(data.get('recipient') || '').trim();
  const subject = String(data.get('subject') || '').replace(/[\r\n]+/g, ' ').trim();
  const body = String(data.get('body') || '').replace(/\r?\n/g, '\r\n');
  if (!subject || !body.trim()) throw new Error('Enter a subject and email body first.');
  if (recipient && !form.elements.recipient.checkValidity()) throw new Error('Check the recipient email.');
  const uri = `mailto:${encodeURIComponent(recipient).replaceAll('%40', '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if (uri.length > 2000) { notify('This draft is too long for the email app link. Use Copy draft.'); return; }
  location.href = uri;
}

async function moreRows(button, type) {
  const q = queryHere();
  const next = button.dataset.next;
  let result, target, html, cursor;
  if (type === 'cards') {
    q.set('offset', next);
    q.set('stage', button.dataset.stage);
    result = await api(queryPath('/api/cards', q));
    target = button.closest('.board-column').querySelector('.column-list');
    html = result.items.map(row => boardCard(row, zone)).join('');
    cursor = result.next_offset;
  } else if (type === 'suggestions') {
    q.set('offset', next);
    result = await api(queryPath('/api/suggestions', suggestionQuery(q)));
    target = document.querySelector('#suggestion-list');
    html = suggestionRows(result.items);
    cursor = result.next_offset;
  } else if (type === 'clients') {
    q.set('offset', next);
    result = await api(queryPath('/api/clients', q));
    target = document.querySelector('#client-list');
    html = `<div class="client-grid">${clientRows(result.items, zone)}</div>`;
    cursor = result.next_offset;
  } else if (type === 'submissions') {
    result = await api(`/api/clients/${pathId(button.dataset.id)}/submissions?before=${pathId(next)}`);
    target = document.querySelector('#submission-list');
    html = submissionRows(result.items, button.dataset.id, zone);
    cursor = result.next_cursor;
  } else if (type === 'activity') {
    result = await api(`/api/cards/${pathId(button.dataset.id)}/activity?before=${pathId(next)}`);
    target = document.querySelector('#activity-list');
    html = activityItems(result.items.filter(row => !document.getElementById(`activity-${row.id}`)), zone);
    cursor = result.next_cursor;
  } else {
    q.set('after', next);
    result = await api(queryPath('/api/admin/audit', q));
    target = document.querySelector('#audit-list');
    html = auditRows(result.items, zone);
    cursor = result.next;
  }
  if (!button.isConnected || !target) return;
  target.insertAdjacentHTML('beforeend', html);
  if (cursor === null) button.closest('.pagination').remove();
  else button.dataset.next = String(cursor);
}

function pickStage(value) {
  if (!Object.hasOwn(stages, value)) return;
  stage = value;
  document.querySelectorAll('[data-action="pick-stage"]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.stage === stage)));
  document.querySelectorAll('[data-column]').forEach(column => column.classList.toggle('active', column.dataset.column === stage));
}

function changeRepeater(button, remove) {
  const form = button.closest('form');
  readWizard(form);
  const rows = wizard.answers[button.dataset.key] ??= [];
  if (remove) rows.splice(Number(button.dataset.index), 1);
  else {
    if (rows.length >= 40) throw new Error('Use a list link for more than 40 entries.');
    rows.push({});
  }
  show(intakePage(wizard.info, wizard.key, wizard.step, wizard.answers));
  const entry = remove ? null : main.querySelector(`[name^="rows|${button.dataset.key}|${rows.length - 1}|"]`);
  (entry ?? main.querySelector(`[data-action="add-row"][data-key="${button.dataset.key}"]`))?.focus();
}

const actions = {
  reload: async () => { await todayAcknowledgement; await render({ focus: true }); },
  alerts: showAlerts,
  'mark-alerts': async button => { await api('/api/alerts/seen', 'POST', { ids: button.dataset.ids.split(',') }); await showAlerts(); },
  account: () => showDialog('Account', `<div class="stack"><div><strong>${h(user.name)}</strong><p class="muted">${h(user.email)}</p></div>
    <div>${btn('Sign out', { action: 'logout', glyph: 'logout' })}</div></div>`, { glyph: 'user' }),
  logout: async () => { await api('/api/session/logout', 'POST'); user = null; context = null; navigate('/signin', { replace: true }); },
  'close-dialog': () => dialog.close(),
  'clear-filters': () => navigate(location.pathname),
  'pick-stage': button => pickStage(button.dataset.stage),
  'add-card': button => showDialog('Add contact', createCardForm(context, button.dataset.client), { glyph: 'leads' }),
  'add-client': () => showDialog('Add client', clientForm(context), { glyph: 'building' }),
  'invite-account': () => showDialog('Invite user', inviteForm(), { glyph: 'team' }),
  'new-job': () => showDialog('Create Claude job credential', jobTokenForm(context), { glyph: 'lock' }),
  'copy-dialog-value': () => clipboard(dialog.querySelector('textarea').value, 'Copied.'),
  'copy-draft': button => {
    const data = new FormData(button.closest('form'));
    const subject = String(data.get('subject') || '').trim();
    const body = String(data.get('body') || '').trim();
    if (!subject && !body) throw new Error('Add draft content first.');
    return clipboard(`${subject ? `Subject: ${subject}\n\n` : ''}${body}`, 'Draft copied.');
  },
  'mail-draft': button => mailDraft(button.closest('form')),
  'complete-followup': async button => {
    await api(`/api/cards/${pathId(button.dataset.card)}/followups/${pathId(button.dataset.id)}/complete`, 'POST');
    notify('Follow-up completed.'); await render();
  },
  'review-draft': async button => {
    await api(`/api/cards/${pathId(button.dataset.card)}/drafts/${pathId(button.dataset.id)}/review`, 'POST', { updated_at: button.dataset.version });
    notify('Draft marked reviewed.'); await render();
  },
  decide: async button => {
    const data = await api(`/api/suggestions/${pathId(button.dataset.id)}/decision`, 'POST', { decision: button.dataset.decision });
    notify(data.suggestion.card_id ? 'Added to To Contact.' : 'Suggestion dismissed.');
    if (data.suggestion.card_id) navigate(`/pipeline/cards/${pathId(data.suggestion.card_id)}`);
    else navigate('/pipeline/suggestions');
  },
  'form-link': async button => {
    const value = await api(`/api/clients/${pathId(button.dataset.id)}/form-link`, 'POST');
    await render();
    await clipboard(new URL(value.path, location.origin).href, 'Form link copied.');
  },
  'revoke-form': async button => {
    if (!confirm('Revoke the active link and discard its unfinished draft?')) return;
    await api(`/api/clients/${pathId(button.dataset.id)}/form-link/revoke`, 'POST');
    notify('Form link revoked.'); await render();
  },
  'setup-link': async button => {
    const result = await api(`/api/admin/accounts/${pathId(button.dataset.id)}/setup`, 'POST');
    revealValue('One-time setup link', new URL(result.setup.path, location.origin).href, 'Share this link with the user. It expires in 24 hours.');
  },
  'add-record': button => showDialog(`Add ${recordKinds[button.dataset.kind].singular}`, recordForm(button.dataset.kind, null, button.dataset.client),
    { glyph: recordKinds[button.dataset.kind].glyph }),
  'edit-record': button => {
    const record = recordCache.get(button.dataset.id);
    if (!record) return render();
    return showDialog(recordKinds[record.kind].label, recordForm(record.kind, record, record.client_id), { glyph: recordKinds[record.kind].glyph });
  },
  'delete-record': async button => {
    if (!confirm('Delete this record? This cannot be undone.')) return;
    await api(`/api/records/${pathId(button.dataset.id)}`, 'DELETE');
    dialog.close();
    notify('Deleted.');
    await render();
  },
  'delete-client': async button => {
    if (!confirm(`Permanently delete ${button.dataset.name} and all of its contacts, drafts, activity and onboarding submissions? This cannot be undone.`)) return;
    await api(`/api/clients/${pathId(button.dataset.id)}`, 'DELETE');
    context = null;
    notify('Client deleted.'); navigate('/clients');
  },
  'revoke-job': async button => {
    if (!confirm('Revoke this Claude job credential?')) return;
    await api(`/api/admin/job-tokens/${pathId(button.dataset.id)}/revoke`, 'POST');
    notify('Credential revoked.'); await render();
  },
  'apply-import': async () => {
    if (!seed) throw new Error('Preview a valid export first.');
    const result = await api('/api/admin/import/apply', 'POST', seed);
    seed = null;
    imported = { ...result, applied: true };
    await render();
  },
  'intake-back': button => advanceWizard(button.closest('form'), 'back'),
  'intake-save': button => advanceWizard(button.closest('form'), 'save'),
  'add-row': button => changeRepeater(button, false),
  'remove-row': button => changeRepeater(button, true),
  'more-cards': button => moreRows(button, 'cards'),
  'more-suggestions': button => moreRows(button, 'suggestions'),
  'more-clients': button => moreRows(button, 'clients'),
  'more-submissions': button => moreRows(button, 'submissions'),
  'more-activity': button => moreRows(button, 'activity'),
  'more-audit': button => moreRows(button, 'audit'),
};

async function exportPdf(anchor) {
  const response = await fetch(anchor.href, { credentials: 'same-origin' });
  if (!response.ok) throw new RequestError(response.status, await response.json().catch(() => ({})));
  const objectUrl = URL.createObjectURL(await response.blob());
  const download = document.createElement('a');
  download.href = objectUrl;
  download.download = response.headers.get('content-disposition')?.match(/filename="([a-zA-Z0-9.-]+)"/)?.[1] || 'onboarding.pdf';
  document.body.append(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (button) {
    const action = actions[button.dataset.action];
    if (!action || button.disabled) return;
    button.disabled = true;
    try { await action(button); }
    catch (error) { if (error.code === 401) showError(error); else notify(error.message); }
    finally { button.disabled = false; }
    return;
  }
  const anchor = event.target.closest('a[href]');
  if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || anchor.target) return;
  if (anchor.hasAttribute('download') && anchor.origin === location.origin && anchor.pathname.startsWith('/api/')) {
    event.preventDefault();
    try { await exportPdf(anchor); } catch (error) { notify(error.message); }
    return;
  }
  if (!['http:', 'https:'].includes(anchor.protocol) || anchor.origin !== location.origin || anchor.getAttribute('href').startsWith('#')) return;
  event.preventDefault();
  if (anchor.dataset.eventId) void api('/api/alerts/seen', 'POST', { ids: [anchor.dataset.eventId] }).catch(() => {});
  navigate(anchor.href);
});

document.addEventListener('change', event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  if (form.dataset.form === 'card-edit' && event.target.name === 'stage') form.querySelector('[data-outcome]').hidden = event.target.value !== 'closed';
  if (form.dataset.form === 'activity' && event.target.name === 'kind') {
    form.querySelector('[data-mail-fields]').hidden = event.target.value === 'note';
    form.querySelector('[data-sent-field]').hidden = event.target.value !== 'sent';
  }
  if (form.dataset.form === 'preview-import' && event.target.name === 'file') {
    imported = null;
    seed = null;
    document.querySelector('[data-action="apply-import"]')?.remove();
  }
  if (form.dataset.form === 'new-job' && event.target.name === 'all_clients') {
    form.querySelectorAll('[name="client_ids"]').forEach(input => { input.disabled = event.target.checked; });
  }
});

function highlightDrop(column = null) {
  if (dropColumn === column) return;
  dropColumn?.classList.remove('drag-over');
  dropColumn = column;
  dropColumn?.classList.add('drag-over');
}

function finishDrag() {
  dragged?.element.classList.remove('is-dragging');
  dragged = null;
  highlightDrop();
}

document.addEventListener('dragstart', event => {
  const card = event.target.closest('.board-card');
  if (!card || !matchMedia('(min-width: 900px) and (pointer: fine)').matches) { if (card) event.preventDefault(); return; }
  dragged = { id: card.dataset.card, version: Number(card.dataset.version), stage: card.dataset.stage, element: card };
  event.dataTransfer.setData('text/plain', card.dataset.card);
  event.dataTransfer.effectAllowed = 'move';
  card.classList.add('is-dragging');
});
document.addEventListener('dragover', event => {
  if (!dragged) return;
  const column = event.target.closest('[data-column]');
  if (!column || column.dataset.column === dragged.stage) { highlightDrop(); return; }
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  highlightDrop(column);
});
document.addEventListener('dragend', finishDrag);
document.addEventListener('drop', async event => {
  const column = event.target.closest('[data-column]');
  const card = dragged;
  if (!card || !column) return;
  event.preventDefault();
  const target = column.dataset.column;
  finishDrag();
  if (card.stage === target) return;
  if (target === 'closed') { navigate(`/pipeline/cards/${pathId(card.id)}?stage=closed#edit-card`); return; }
  try {
    await api(`/api/cards/${pathId(card.id)}`, 'PATCH', { stage: target, version: card.version });
    notify(`Moved to ${stages[target].label}.`);
    await render();
  } catch (error) { notify(error.message); }
});

window.addEventListener('popstate', () => { if (dialog.open) dialog.close(); void render({ focus: true }); });
document.addEventListener('visibilitychange', refreshAlertDot);
setInterval(refreshAlertDot, 60000);

try {
  const session = await api('/api/session');
  user = session.user;
  zone = session.time_zone;
  await render();
} catch (error) { showError(error, true); }
