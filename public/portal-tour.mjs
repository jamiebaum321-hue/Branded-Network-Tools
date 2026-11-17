// A short guided tour of the client portal. It spotlights one part of the page at a time and explains it in
// plain words. Steps whose section isn't on the page (for example no shared next step yet) are skipped.
import { h, icon } from './ui.mjs';

const steps = clientName => [
  { title: 'Welcome to your Branded Solutions portal',
    body: `This is where you can follow the introductions Branded is making for ${clientName}, see where each one stands, and check your agreement. The tour takes about a minute.` },
  { target: '[data-tour="numbers"]', title: 'Your numbers at a glance',
    body: 'How many introductions we’ve made so far, how many are in active discussion, the meetings that are set, and the brands we’re lining up next.' },
  { target: '[data-tour="intros"]', title: 'Every introduction we’ve made',
    body: 'Each restaurant or hospitality group we’ve introduced you to, who you were connected with, and when.',
    legend: [['Introduced', 'We’ve made the connection.'], ['In discussion', 'A conversation is underway.'],
      ['Meeting set', 'A meeting is on the calendar.'], ['Won', 'It turned into business.']] },
  { target: '[data-tour="next"]', title: 'What’s next',
    body: 'The next thing your Branded team is working on for you, with the date we’re aiming for.' },
  { target: '[data-tour="updates"]', title: 'Updates from Branded',
    body: 'Short notes from your team when something moves forward, newest first.' },
  { target: '[data-tour="agreement"]', title: 'Your agreement',
    body: 'Your agreement status, the term, when it renews, and the monthly fee.' },
  { target: '[data-tour="brands"]', title: 'Brands we’re working on',
    body: 'Brands on your target list that we’re lining up introductions to. Once an introduction is made, it moves into Introductions.' },
  { target: '[data-tour="account"]', title: 'Your account',
    body: 'Sign out from here. The portal is view-only, so nothing you click can change your account. Questions about anything you see? Reach out to your Branded team.' },
  { target: '[data-tour="replay"]', title: 'Come back anytime',
    body: 'Take the tour again whenever you like. That’s it, thanks for taking a look.' },
];

let active = null;

export function startTour({ clientName, onDone } = {}) {
  if (active) return;
  const list = steps(clientName || 'your company').filter(step => !step.target || document.querySelector(step.target));
  const opener = document.activeElement;
  const shade = document.createElement('div');
  shade.className = 'tour-shade';
  const ring = document.createElement('div');
  ring.className = 'tour-ring';
  ring.setAttribute('aria-hidden', 'true');
  const card = document.createElement('section');
  card.className = 'tour-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'tour-title');
  card.setAttribute('aria-describedby', 'tour-body');
  card.tabIndex = -1;
  document.body.append(shade, ring, card);
  document.body.classList.add('touring');
  let index = 0;

  const place = () => {
    const step = list[index];
    const target = step.target && document.querySelector(step.target);
    const narrow = window.innerWidth < 640;
    shade.hidden = Boolean(target);
    ring.hidden = !target;
    card.classList.toggle('centered', !target);
    card.classList.toggle('sheet', narrow && Boolean(target));
    if (!target) { card.style.top = ''; card.style.left = ''; return; }
    const box = target.getBoundingClientRect();
    const pad = 8;
    Object.assign(ring.style, { top: `${box.top - pad}px`, left: `${box.left - pad}px`, width: `${box.width + pad * 2}px`, height: `${box.height + pad * 2}px` });
    if (narrow) { card.style.top = ''; card.style.left = ''; return; }
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    // A section taller than most of the screen gets the card beside it, so it doesn't cover the content.
    const sideTop = Math.min(Math.max(12, box.top), window.innerHeight - height - 12);
    if (box.height > window.innerHeight * 0.55) {
      if (box.right + pad + 16 + width <= window.innerWidth - 12) { card.style.top = `${sideTop}px`; card.style.left = `${box.right + pad + 16}px`; return; }
      if (box.left - pad - 16 - width >= 12) { card.style.top = `${sideTop}px`; card.style.left = `${box.left - pad - 16 - width}px`; return; }
    }
    const below = box.bottom + pad + 14;
    const above = box.top - pad - 14 - height;
    const top = below + height <= window.innerHeight - 12 ? below : above >= 12 ? above : Math.max(12, window.innerHeight - height - 12);
    const left = Math.min(Math.max(12, box.left), window.innerWidth - width - 12);
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
  };

  const render = () => {
    const step = list[index];
    const last = index === list.length - 1;
    card.innerHTML = `<p class="tour-count">Step ${index + 1} of ${list.length}</p>
      <h2 id="tour-title">${h(step.title)}</h2><p id="tour-body">${h(step.body)}</p>
      ${step.legend ? `<dl class="tour-legend">${step.legend.map(([term, text]) => `<div><dt>${h(term)}</dt><dd>${h(text)}</dd></div>`).join('')}</dl>` : ''}
      <div class="tour-actions">${last ? '' : '<button type="button" class="button quiet" data-tour-skip>Skip tour</button>'}
        <span class="tour-nav">${index ? `<button type="button" class="button" data-tour-back>${icon('back')}<span>Back</span></button>` : ''}
        <button type="button" class="button primary" data-tour-next><span>${last ? 'Done' : index ? 'Next' : 'Show me around'}</span>${last ? '' : icon('arrow')}</button></span></div>`;
    const target = step.target && document.querySelector(step.target);
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (target) target.scrollIntoView({ block: window.innerWidth < 640 ? 'start' : 'center', behavior: smooth ? 'smooth' : 'auto' });
    place();
    setTimeout(place, smooth ? 380 : 0);
    // Focus the main button so Enter or Space moves the tour on.
    card.querySelector('[data-tour-next]').focus({ preventScroll: true });
  };

  const finish = () => {
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', keys, true);
    shade.remove(); ring.remove(); card.remove();
    document.body.classList.remove('touring');
    active = null;
    if (opener && document.contains(opener)) opener.focus();
    onDone?.();
  };
  const go = delta => {
    const next = index + delta;
    if (next >= list.length) return finish();
    index = Math.max(0, next);
    render();
  };
  const keys = event => {
    if (event.key === 'Escape') { event.preventDefault(); finish(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
    else if (event.key === 'Tab') {
      // Keep keyboard focus inside the tour card while it's open.
      const buttons = [...card.querySelectorAll('button')];
      if (!buttons.length) return;
      const first = buttons[0];
      const lastButton = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) { event.preventDefault(); lastButton.focus(); }
      else if (!event.shiftKey && document.activeElement === lastButton) { event.preventDefault(); first.focus(); }
    }
  };
  card.addEventListener('click', event => {
    if (event.target.closest('[data-tour-next]')) go(1);
    else if (event.target.closest('[data-tour-back]')) go(-1);
    else if (event.target.closest('[data-tour-skip]')) finish();
  });
  shade.addEventListener('click', finish);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  document.addEventListener('keydown', keys, true);
  active = { finish };
  render();
}

export function stopTour() { active?.finish(); }
