// The "Ask" assistant: a chat panel available on every signed-in page.
import { h, icon } from './ui.mjs';

const suggestions = [
  'What needs my attention this week?',
  'Which contracts end in the next 60 days?',
  'Where are we with Hang?',
  'Which intros have gone quiet?',
  'Draft a renewal check-in for ARC',
];
let conversation = [];
let busy = false;
let mounted = false;

// Minimal, safe Markdown: escape everything, then allow **bold**, bullet lines and links to pages inside the app.
function render(text) {
  const lines = h(text).split('\n');
  const html = [];
  let listOpen = false;
  for (const raw of lines) {
    let line = raw
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, (match, label, href) => /^\/(?!\/)[\w\-/?=&%.#]*$/.test(href) ? `<a href="${href}" class="text-link">${label}</a>` : label);
    const bullet = /^\s*[-*•]\s+/.test(line);
    if (bullet && !listOpen) { html.push('<ul>'); listOpen = true; }
    if (!bullet && listOpen) { html.push('</ul>'); listOpen = false; }
    if (bullet) html.push(`<li>${line.replace(/^\s*[-*•]\s+/, '')}</li>`);
    else if (line.trim()) html.push(`<p>${line}</p>`);
  }
  if (listOpen) html.push('</ul>');
  return html.join('');
}

function messagesHtml() {
  if (!conversation.length) {
    return `<div class="ask-empty"><p>Ask anything about clients, intros, contracts, approvals or follow-ups. I'll answer from the tracker and link you to the page.</p>
      <div class="ask-chips">${suggestions.map(text => `<button type="button" class="ask-chip" data-ask="${h(text)}">${h(text)}</button>`).join('')}</div></div>`;
  }
  return conversation.map(m => `<div class="ask-msg ${m.role === 'user' ? 'me' : m.error ? 'error' : 'bot'}">${m.role === 'user' ? `<p>${h(m.content)}</p>` : render(m.content)}</div>`).join('')
    + (busy ? '<div class="ask-msg bot thinking" role="status"><p>Looking it up…</p></div>' : '');
}

export function mountAssistant(api) {
  if (mounted) return;
  mounted = true;
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'ask-fab';
  fab.innerHTML = `${icon('reply')}<span>Ask</span>`;
  fab.setAttribute('aria-haspopup', 'dialog');
  const panel = document.createElement('section');
  panel.className = 'ask-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Ask the assistant');
  panel.innerHTML = `<header class="ask-head"><div><strong>Ask the tracker</strong><small>Answers come from your Branded Network records.</small></div>
    <div class="ask-head-actions"><button type="button" class="icon-button" data-ask-clear title="New conversation" aria-label="New conversation">${icon('history')}</button>
    <button type="button" class="icon-button" data-ask-close aria-label="Close">${icon('close')}</button></div></header>
    <div class="ask-messages" aria-live="polite"></div>
    <form class="ask-form"><label class="visually-hidden" for="ask-input">Your question</label>
      <textarea id="ask-input" rows="2" maxlength="2000" placeholder="Ask about a client, intro, contract…"></textarea>
      <button type="submit" class="button primary" aria-label="Send">${icon('arrow')}</button></form>
    <p class="ask-foot">The assistant reads the tracker; it can't change records or send email.</p>`;
  document.body.append(fab, panel);
  const list = panel.querySelector('.ask-messages');
  const input = panel.querySelector('textarea');
  const paint = () => { list.innerHTML = messagesHtml(); list.scrollTop = list.scrollHeight; };
  const open = () => { panel.hidden = false; fab.hidden = true; paint(); input.focus(); };
  const close = () => { panel.hidden = true; fab.hidden = false; fab.focus(); };

  async function ask(question) {
    const text = question.trim();
    if (!text || busy) return;
    conversation.push({ role: 'user', content: text });
    busy = true;
    paint();
    try {
      const history = conversation.filter(m => !m.error).slice(-12).map(({ role, content }) => ({ role, content: content.slice(0, 6000) }));
      const result = await api('/api/assistant', 'POST', { messages: history });
      conversation.push({ role: 'assistant', content: result.answer });
    } catch (error) {
      conversation.push({ role: 'assistant', content: error.message || 'Something went wrong. Try again.', error: true });
    } finally {
      busy = false;
      paint();
    }
  }

  fab.addEventListener('click', open);
  panel.querySelector('[data-ask-close]').addEventListener('click', close);
  panel.querySelector('[data-ask-clear]').addEventListener('click', () => { if (!busy) { conversation = []; paint(); input.focus(); } });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  panel.addEventListener('click', event => {
    const chip = event.target.closest('[data-ask]');
    if (chip) ask(chip.dataset.ask);
    // Following a link closes the panel on small screens so the page is visible.
    if (event.target.closest('a[href^="/"]') && window.innerWidth < 900) close();
  });
  panel.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const value = input.value;
    input.value = '';
    ask(value);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); panel.querySelector('form').requestSubmit(); }
  });
}

export function unmountAssistant() {
  document.querySelectorAll('.ask-fab, .ask-panel').forEach(el => el.remove());
  conversation = [];
  mounted = false;
}
