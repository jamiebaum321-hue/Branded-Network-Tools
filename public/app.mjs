import { sections } from './intake-fields.mjs';
import { isPeriod, stageInfo } from './lifecycle.mjs';
import { btn, formatDate, h, heading, icon, link, pathId, shell, stages, todayIn } from './ui.mjs';
import { accountRows, accountsPage, clientForm, clientPage, entryForm, matchDialog, matchRows, reportDialog, reportsPage,
  timelineItems, versionRows } from './client-views.mjs';
import { activityItems, adminPage, alertRows, auditRows, boardCard, boardPage, cardPage, createCardForm, intakePage, inviteForm,
  jobTokenForm, metricsPage, setupPage, signInPage, submissionPage, suggestionPage, suggestionsPage, todayPage } from './views.mjs';

const main = document.querySelector('#main');
const chrome = document.querySelector('#shell');
const dialog = document.querySelector('#dialog');
const status = document.querySelector('#toast');
let user = null;
let demo = false;
let zone = 'America/New_York';
let context = null;
let revision = 0;
// The column shown on a phone, per board.
const boardStage = { pipeline: 'to_contact', sales: 'prospect', delivery: 'onboarding' };
// Data behind the current page, for dialogs opened from it.
let page = {};
let wizard = null;
let imported = null;
let seed = null;
let dragged = null;
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
  status.textContent = message;
  status.hidden = false;
  toastTimer = setTimeout(() => { status.hidden = true; }, 4200);
}

function showDialog(title, body, flush = false, wide = false) {
  dialog.classList.toggle('wide', wide);
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${h(title)}</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close">${icon('close')}</button></div>
    <div class="dialog-body ${flush ? 'flush' : ''}">${body}</div>`;
  if (!dialog.open) dialog.showModal();
}

dialog.addEventListener('close', () => { if (!dialog.open) dialog.replaceChildren(); });

async function clipboard(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    notify(message);
  } catch {
    showDialog('Copy text', `<label class="field"><span>Select and copy</span><textarea readonly rows="4">${h(value)}</textarea></label>`);
    dialog.querySelector('textarea').select();
  }
}

function revealValue(title, value, detail) {
  showDialog(title, `<div class="stack"><p class="muted">${h(detail)}</p><label class="field"><span>${h(title)}</span><textarea rows="3" readonly>${h(value)}</textarea></label>
    <div>${btn('Copy', { kind: 'primary', action: 'copy-dialog-value' })}</div></div>`);
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
  if (!target.pathname.startsWith('/onboard/') && target.searchParams.get('edit') !== '1') wizard = null;
  if (target.pathname !== '/admin' || target.searchParams.get('tab') !== 'import') { seed = null; imported = null; }
  const url = `${target.pathname}${target.search}${target.hash}`;
  if (replace) history.replaceState(null, '', url);
  else if (url !== `${location.pathname}${location.search}${location.hash}`) history.pushState(null, '', url);
  void render({ focus: true });
}

function show(html, focus, hash) {
  main.innerHTML = html;
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
  // On a phone the journey scrolls sideways, so bring the current stage into view.
  const current = main.querySelector('.stepper .current');
  if (current) current.parentElement.scrollLeft = current.offsetLeft - current.parentElement.offsetLeft - 40;
}

function updateDot(data) {
  const dot = document.querySelector('#alert-dot');
  if (dot) dot.hidden = !data.unread;
}

function refreshAlertDot() {
  if (!user || document.hidden || !document.querySelector('#alert-dot')) return;
  const accountId = user.id;
  void api('/api/alerts').then(data => { if (user?.id === accountId) updateDot(data); }).catch(() => {});
  void api('/api/suggestion-counts').then(data => {
    const count = document.querySelector('#nav-matches');
    if (!count || user?.id !== accountId) return;
    count.textContent = data.pending;
    count.hidden = !data.pending;
  }).catch(() => {});
}

function showError(error, focus = false) {
  if (error.code === 401 && user) {
    user = null;
    if (dialog.open) dialog.close();
    chrome.replaceChildren();
    document.body.classList.remove('app');
    show(signInPage(demo), true);
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
  chrome.innerHTML = publicRoute ? '' : shell(user, path, path.startsWith('/clients/') ? page.section : undefined);
  document.body.classList.toggle('app', Boolean(user) && !publicRoute);
  main.setAttribute('aria-busy', 'true');
  let section;
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
    } else if (!user) html = signInPage(demo);
    else if (path === '/opportunities' || path === '/clients') {
      const phase = path === '/clients' ? 'delivery' : 'sales';
      const list = query.get('view') === 'list';
      const filters = new URLSearchParams([...query].filter(([key]) => ['q', 'owner_id'].includes(key)));
      if (list && query.get('show') === 'closed') filters.set('stage', phase === 'sales' ? 'lost' : 'churned');
      else filters.set('phase', phase);
      const [data, ctx] = await Promise.all([api(queryPath(list ? '/api/clients' : '/api/client-board', filters)), getContext()]);
      if (current !== revision) return;
      context = ctx;
      page = { filters, phase };
      html = accountsPage(phase, data, ctx, query, zone, boardStage[phase]);
    } else if (path === '/reports') {
      const period = isPeriod(query.get('period')) ? query.get('period') : '';
      html = reportsPage(await api(`/api/reports${period ? `?period=${period}` : ''}`));
    }
    else if (path === '/' || path === '/signin' || path === '/today') {
      if (path !== '/today') history.replaceState(null, '', '/today');
      todayResult = await api('/api/today');
      html = todayPage(todayResult, zone, user);
    } else if (path === '/pipeline') {
      const [data, ctx] = await Promise.all([api(queryPath('/api/board', query)), getContext()]);
      if (current !== revision) return;
      context = ctx;
      html = boardPage(data.groups, ctx, query, zone, boardStage.pipeline);
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
    } else if (/^\/clients\/[\w-]+\/submissions\/[\w-]+$/.test(path)) {
      html = submissionPage((await api(`/api${path}`)).submission, zone);
    } else if (path.startsWith('/clients/')) {
      const clientId = pathId(path.split('/')[2]);
      const tab = ['profile', 'matches', 'introductions', 'report'].includes(query.get('tab')) ? query.get('tab') : 'overview';
      const status = ['approved', 'dismissed'].includes(query.get('status')) ? `&status=${query.get('status')}` : query.get('status') === 'all' ? '' : '&status=pending';
      const period = isPeriod(query.get('period')) ? query.get('period') : todayIn(zone).slice(0, 7);
      const extra = tab === 'matches' ? Promise.all([api(`/api/suggestions?client_id=${clientId}${status}`), api(`/api/suggestion-counts?client_id=${clientId}`)])
        : tab === 'introductions' ? api(`/api/cards?client_id=${clientId}&limit=100`)
          : tab === 'report' ? api(`/api/clients/${clientId}/reports/${period}`) : null;
      const [data, ctx, loaded] = await Promise.all([api(`/api/clients/${clientId}`), getContext(), extra]);
      if (current !== revision) return;
      context = ctx;
      section = stageInfo[data.client.stage].phase === 'sales' || data.client.stage === 'lost' ? 'opportunities' : 'clients';
      page = { client: data.client, report: tab === 'report' ? loaded : null, section };
      if (tab === 'profile' && query.get('edit') === '1') {
        if (wizard?.key !== data.client.id || !wizard.staff) wizard = { key: data.client.id, staff: true, step: 0,
          info: { client_name: data.client.name, submitted: false }, answers: structuredClone(data.profile?.answers ?? { company: data.client.name }) };
        html = intakePage(wizard.info, wizard.key, wizard.step, wizard.answers, true);
      } else html = clientPage({ ...data, ...(tab === 'matches' ? { matches: loaded[0], matchCounts: loaded[1] } : {}),
        cards: tab === 'introductions' ? loaded : null, report: tab === 'report' ? loaded : null }, ctx, zone, tab, query);
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
    if (!path.startsWith('/clients/')) page = { ...page, section: undefined, client: undefined, report: undefined };
    else if (section) chrome.innerHTML = shell(user, path, section);
    show(html, focus, hash);
    if (todayResult) todayAcknowledgement = api('/api/today/seen', 'POST', { reply_cursor: todayResult.reply_cursor }).catch(() => {});
    if (user && !publicRoute) refreshAlertDot();
  } catch (error) {
    if (current === revision) showError(error, focus);
  }
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
    } else if (def.type === 'multi') wizard.answers[def.key] = data.getAll(def.key);
    else {
      const value = data.get(def.key);
      if (def.type === 'number' && value !== '') wizard.answers[def.key] = Number(value);
      else if (def.type === 'number') delete wizard.answers[def.key];
      else wizard.answers[def.key] = value;
    }
  }
}

async function advanceWizard(form, how, step) {
  readWizard(form);
  if (how === 'jump') {
    if (!wizard.staff) await api(`/api/onboard/${pathId(wizard.key)}/draft`, 'POST', wizard.answers);
    wizard.step = step;
    await render({ focus: true });
    return;
  }
  if (wizard.staff) {
    // A manager's edit is kept in memory between steps and saved once, as a new profile version.
    if (how === 'save' || (how === 'next' && wizard.step === sections.length - 1)) {
      const target = `/clients/${pathId(wizard.key)}?tab=profile`;
      await api(`/api/clients/${pathId(wizard.key)}/profile`, 'POST', wizard.answers);
      wizard = null;
      notify('Profile saved.');
      navigate(target, { replace: true });
      return;
    }
    wizard.step += how === 'next' ? 1 : -1;
    await render({ focus: true });
    return;
  }
  const path = `/api/onboard/${pathId(wizard.key)}`;
  if (how === 'next' && wizard.step === sections.length - 1) {
    await api(`${path}/submit`, 'POST', wizard.answers);
    wizard.info = { ...wizard.info, submitted: true };
    wizard.answers = {};
  } else {
    await api(`${path}/draft`, 'POST', wizard.answers);
    if (how === 'next') wizard.step++;
    if (how === 'back') wizard.step--;
    if (how === 'save') { notify('Saved. You can come back to this link any time.'); return; }
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
    await api(`/api/cards/${pathId(form.dataset.id)}`, 'PATCH', value);
    notify('Card saved.');
    navigate(location.pathname, { replace: true });
  },
  async activity(form, data) {
    const value = Object.fromEntries(data);
    const input = { kind: value.kind, body: value.body };
    if (value.kind === 'introduction' && value.occurred_at) input.occurred_at = dateFromInput(value.occurred_at);
    if (['sent', 'reply'].includes(value.kind)) {
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
  async 'client-create'(form, data) {
    const { client } = await api('/api/clients', 'POST', clientInput(data));
    notify(`${client.name} added.`);
    navigate(`/clients/${pathId(client.id)}`);
  },
  async 'client-edit'(form, data) {
    await api(`/api/clients/${pathId(form.dataset.id)}`, 'PATCH', { ...clientInput(data), started_on: data.get('started_on') || null });
    notify('Changes saved.');
    dialog.close();
    await render();
  },
  async 'client-access'(form, data) {
    await api(`/api/clients/${pathId(form.dataset.id)}`, 'PATCH', { owner_id: data.get('owner_id'), member_ids: data.getAll('member_ids') });
    notify('Access saved.');
    await render();
  },
  async 'client-note'(form, data) {
    await api(`/api/clients/${pathId(form.dataset.id)}/notes`, 'POST', { body: data.get('body') });
    notify('Note added.');
    await render();
  },
  async 'report-summary'(form, data) {
    await api(`/api/clients/${pathId(form.dataset.id)}/reports/${pathId(data.get('period'))}`, 'POST',
      { headline: data.get('headline'), summary: data.get('summary'), next_steps: data.get('next_steps') });
    notify('Summary saved.');
    await render();
  },
  async entry(form, data) {
    const { clientId, input } = entryInput(data);
    if (form.dataset.id) await api(`/api/report-entries/${pathId(form.dataset.id)}`, 'PATCH', input);
    else await api(`/api/clients/${pathId(clientId)}/report-entries`, 'POST', input);
    notify(form.dataset.id ? 'Entry saved.' : 'Added to the report.');
    navigate(`/clients/${pathId(clientId)}?tab=report&period=${input.occurred_on.slice(0, 7)}`, { replace: true });
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

function clientInput(data) {
  const value = Object.fromEntries(data);
  return { name: value.name, stage: value.stage, website: value.website, contact_name: value.contact_name, contact_title: value.contact_title,
    contact_email: value.contact_email, contact_phone: value.contact_phone, source: value.source, next_step: value.next_step,
    closed_reason: stageInfo[value.stage]?.phase === 'closed' ? value.closed_reason : '',
    monthly_value: value.monthly_value === '' ? null : Number(value.monthly_value), next_step_at: value.next_step_at || null };
}

function entryInput(data) {
  const value = Object.fromEntries(data);
  const metrics = Object.fromEntries([...data].filter(([key, amount]) => key.startsWith('metric_') && amount !== '').map(([key, amount]) => [key.slice(7), Number(amount)]));
  return { clientId: value.client_id, input: { kind: value.kind, occurred_on: value.occurred_on, title: value.title, detail: value.detail ?? '',
    channel: value.channel ?? '', contact: value.contact ?? '', url: value.url ?? '', metrics } };
}

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
  showDialog('Alerts', '<p class="loading">Loading alerts…</p>');
  const data = await api('/api/alerts');
  if (!dialog.open || dialog.querySelector('#dialog-title')?.textContent !== 'Alerts') return;
  const unseen = data.items.filter(item => !item.seen_at).map(item => item.id);
  showDialog('Alerts', `${alertRows(data, zone)}${unseen.length ? `<div class="pagination">${btn('Mark these as read', { action: 'mark-alerts', data: `data-ids="${h(unseen.join(','))}"` })}</div>` : ''}`, true);
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
    const onClient = button.dataset.id;
    const filters = onClient ? new URLSearchParams({ client_id: onClient, status: q.get('status') ?? 'pending' }) : q;
    filters.set('offset', next);
    result = await api(queryPath('/api/suggestions', suggestionQuery(filters)));
    target = document.querySelector('#suggestion-list');
    html = matchRows(result.items, { showClient: !onClient, stay: true });
    cursor = result.next_offset;
  } else if (type === 'accounts') {
    const filters = new URLSearchParams(page.filters);
    filters.set('offset', next);
    result = await api(queryPath('/api/clients', filters));
    target = document.querySelector('#account-list');
    html = accountRows(result.items, button.dataset.phase, zone);
    cursor = result.next_offset;
  } else if (type === 'timeline') {
    result = await api(`/api/clients/${pathId(button.dataset.id)}/timeline?before=${pathId(next)}`);
    target = document.querySelector('#timeline-list');
    html = timelineItems(result.items, zone);
    cursor = result.next_cursor;
  } else if (type === 'submissions') {
    result = await api(`/api/clients/${pathId(button.dataset.id)}/submissions?before=${pathId(next)}`);
    target = document.querySelector('#submission-list');
    html = versionRows(result.items, button.dataset.id, zone);
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
  if (cursor === null) (button.closest('.pagination') ?? button.parentElement).remove();
  else button.dataset.next = String(cursor);
}

function pickStage(value) {
  if (!document.querySelector(`[data-column="${CSS.escape(value)}"]`)) return;
  boardStage[location.pathname === '/pipeline' ? 'pipeline' : page.phase ?? 'sales'] = value;
  document.querySelectorAll('[data-action="pick-stage"]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.stage === value)));
  document.querySelectorAll('[data-column]').forEach(column => column.classList.toggle('active', column.dataset.column === value));
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
  show(intakePage(wizard.info, wizard.key, wizard.step, wizard.answers, wizard.staff));
  const entry = remove ? null : main.querySelector(`[name^="rows|${button.dataset.key}|${rows.length - 1}|"]`);
  (entry ?? main.querySelector(`[data-action="add-row"][data-key="${button.dataset.key}"]`))?.focus();
}

const actions = {
  reload: async () => { await todayAcknowledgement; await render({ focus: true }); },
  alerts: showAlerts,
  'mark-alerts': async button => { await api('/api/alerts/seen', 'POST', { ids: button.dataset.ids.split(',') }); await showAlerts(); },
  account: () => showDialog('Account', `<div class="stack"><div><strong>${h(user.name)}</strong><p class="muted">${h(user.email)}</p></div>
    <div class="actions">${link('/pipeline/suggestions', 'Matches', 'sparkles')}${user.role === 'admin' ? link('/admin', 'Admin', 'admin') : ''}</div>
    <div>${btn('Sign out', { action: 'logout', glyph: 'logout' })}</div></div>`),
  logout: async () => { await api('/api/session/logout', 'POST'); user = null; context = null; navigate('/signin', { replace: true }); },
  'close-dialog': () => dialog.close(),
  'clear-filters': () => navigate(location.pathname),
  'pick-stage': button => pickStage(button.dataset.stage),
  'add-card': button => showDialog('Add contact', createCardForm(context, button.dataset.id)),
  'add-account': button => showDialog(button.dataset.stage === 'won' ? 'Add client' : 'Add opportunity', clientForm(context, null, button.dataset.stage), false, true),
  'edit-client': () => showDialog(`Edit ${page.client.name}`, clientForm(context, page.client), false, true),
  'move-client': async button => {
    await api(`/api/clients/${pathId(button.dataset.id)}`, 'PATCH', { stage: button.dataset.stage });
    notify(`Moved to ${stageInfo[button.dataset.stage].label}.`); await render();
  },
  'start-onboarding': async button => {
    const value = await api(`/api/clients/${pathId(button.dataset.id)}/onboarding`, 'POST');
    await render();
    revealValue('Onboarding link', new URL(value.path, location.origin).href,
      `Send this private link to ${value.client.contact_name || 'your contact'} at ${value.client.name}. Their answers fill in the profile. It expires ${formatDate(value.expires_at, zone, { year: 'numeric' })}.`);
  },
  'mail-link': async button => {
    const value = await api(`/api/clients/${pathId(button.dataset.id)}/form-link`, 'POST');
    const client = page.client;
    const body = `Hi ${client.contact_name.split(/\s+/)[0] || 'there'},\r\n\r\nWelcome aboard. To get started, please fill in our onboarding form. It saves as you go, so you can come back to it:\r\n\r\n${new URL(value.path, location.origin).href}\r\n\r\nThe link is private to you and expires ${formatDate(value.expires_at, zone)}.\r\n\r\nThanks,\r\n${user.name}`;
    location.href = `mailto:${encodeURIComponent(client.contact_email).replaceAll('%40', '@')}?subject=${encodeURIComponent('Your Branded Network onboarding')}&body=${encodeURIComponent(body)}`;
  },
  'match-prompt': () => showDialog('Find matches with Claude', matchDialog(page.client), false, true),
  'report-prompt': () => showDialog('Build this report with Claude', reportDialog(page.client, page.report.period), false, true),
  'copy-prompt': () => clipboard(dialog.querySelector('#prompt-text').textContent, 'Prompt copied. Paste it into Claude.'),
  'add-entry': button => showDialog('Add to report', entryForm(page.client.id, page.report.period, { kind: button.dataset.kind }, zone), false, true),
  'edit-entry': button => showDialog('Edit entry', entryForm(page.client.id, page.report.period, page.report.entries.find(entry => entry.id === button.dataset.id), zone), false, true),
  'delete-entry': async button => {
    if (!confirm('Remove this entry from the report?')) return;
    await api(`/api/report-entries/${pathId(button.dataset.id)}/delete`, 'POST');
    notify('Entry removed.'); await render();
  },
  'invite-account': () => showDialog('Invite user', inviteForm()),
  'new-job': () => showDialog('Create Claude job credential', jobTokenForm(context)),
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
    notify(data.suggestion.card_id ? 'Approved. Added to introductions.' : 'Match dismissed.');
    if (button.hasAttribute('data-stay')) await render();
    else if (data.suggestion.card_id) navigate(`/pipeline/cards/${pathId(data.suggestion.card_id)}`);
    else navigate(`/clients/${pathId(data.suggestion.client_id)}?tab=matches`);
  },
  'form-link': async button => {
    const value = await api(`/api/clients/${pathId(button.dataset.id)}/form-link`, 'POST');
    await render();
    await clipboard(new URL(value.path, location.origin).href, 'Onboarding link copied.');
  },
  'revoke-form': async button => {
    if (!confirm('Revoke the active link? Any unfinished answers on it are discarded.')) return;
    await api(`/api/clients/${pathId(button.dataset.id)}/form-link/revoke`, 'POST');
    notify('Link revoked.'); await render();
  },
  'setup-link': async button => {
    const result = await api(`/api/admin/accounts/${pathId(button.dataset.id)}/setup`, 'POST');
    revealValue('One-time setup link', new URL(result.setup.path, location.origin).href, 'Share this link with the user. It expires in 24 hours.');
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
  'intake-step': button => advanceWizard(main.querySelector('form[data-form="intake"]'), 'jump', Number(button.dataset.step)),
  'add-row': button => changeRepeater(button, false),
  'remove-row': button => changeRepeater(button, true),
  'more-cards': button => moreRows(button, 'cards'),
  'more-suggestions': button => moreRows(button, 'suggestions'),
  'more-accounts': button => moreRows(button, 'accounts'),
  'more-timeline': button => moreRows(button, 'timeline'),
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
  download.download = response.headers.get('content-disposition')?.match(/filename="([a-zA-Z0-9.-]+)"/)?.[1] || 'export.pdf';
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
    form.querySelector('[data-when-field]').hidden = event.target.value === 'note';
    form.querySelector('[data-mail-fields]').hidden = !['sent', 'reply'].includes(event.target.value);
    form.querySelector('[data-sent-field]').hidden = event.target.value !== 'sent';
  }
  if (['client-create', 'client-edit'].includes(form.dataset.form) && event.target.name === 'stage') {
    form.querySelector('[data-closed]').hidden = stageInfo[event.target.value].phase !== 'closed';
  }
  if (form.dataset.form === 'entry' && event.target.name === 'kind') {
    // Each kind of work has its own labels and numbers, so redraw the form and keep what was typed.
    const { clientId, input } = entryInput(new FormData(form));
    form.outerHTML = entryForm(clientId, page.report.period, { ...input, id: form.dataset.id || undefined }, zone);
    dialog.querySelector('[name="title"]')?.focus();
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

document.addEventListener('dragstart', event => {
  const card = event.target.closest('.board-card');
  if (!card || !matchMedia('(min-width: 900px) and (pointer: fine)').matches) { if (card) event.preventDefault(); return; }
  dragged = card.dataset.client ? { client: card.dataset.client, stage: card.dataset.stage }
    : { id: card.dataset.card, version: Number(card.dataset.version), stage: card.dataset.stage };
  event.dataTransfer.setData('text/plain', card.dataset.client ?? card.dataset.card);
  event.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', event => {
  const column = event.target.closest('[data-column]');
  if (!column || !dragged) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.drag-over').forEach(item => { if (item !== column) item.classList.remove('drag-over'); });
  column.classList.add('drag-over');
});
document.addEventListener('dragend', () => { dragged = null; document.querySelectorAll('.drag-over').forEach(item => item.classList.remove('drag-over')); });
document.addEventListener('drop', async event => {
  const column = event.target.closest('[data-column]');
  const card = dragged;
  if (!card || !column) return;
  event.preventDefault();
  const target = column.dataset.column;
  column.classList.remove('drag-over');
  dragged = null;
  if (card.stage === target) return;
  if (card.client) {
    try {
      await api(`/api/clients/${pathId(card.client)}`, 'PATCH', { stage: target });
      notify(`Moved to ${stageInfo[target].label}.`);
      await render();
    } catch (error) { notify(error.message); }
    return;
  }
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
  demo = session.demo;
  await render();
} catch (error) { showError(error, true); }
