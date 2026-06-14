/* ============================================================
   NGL Admin — Lightweight Guided Tour / Walkthrough
   ------------------------------------------------------------
   A dependency-free, page-agnostic onboarding walkthrough.
   Spotlights elements on the page and steps the user through
   them with a tooltip (Back / Next / Done + skip).

   Usage:
     import { startTour, maybeAutoStartTour } from './tour.js';

     const steps = [
       { title: 'Welcome', body: 'Intro text…' },            // centered (no target)
       { target: '#some-id', title: 'Do this', body: '…' },  // spotlighted
     ];

     startTour(steps);                       // run immediately
     maybeAutoStartTour(steps, 'my_key');    // run once, then remember
   ============================================================ */

let els = null;        // cached DOM refs for the tour chrome
let steps = [];        // active step list
let index = 0;         // current step
let finishKey = null;  // localStorage key to set on completion

/* Build the tour chrome (overlay + spotlight + tooltip) once. */
function ensureChrome() {
  if (els) return els;

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.id = 'tour-overlay';

  const spotlight = document.createElement('div');
  spotlight.className = 'tour-spotlight';

  const tooltip = document.createElement('div');
  tooltip.className = 'tour-tooltip';
  tooltip.setAttribute('role', 'dialog');
  tooltip.setAttribute('aria-modal', 'true');
  tooltip.innerHTML = `
    <button class="tour-close" aria-label="Close walkthrough">
      <span class="material-symbols-outlined">close</span>
    </button>
    <div class="tour-step-count"></div>
    <h3 class="tour-title"></h3>
    <p class="tour-body"></p>
    <div class="tour-progress"><span class="tour-progress-fill"></span></div>
    <div class="tour-actions">
      <button class="tour-btn tour-skip" type="button">Skip</button>
      <div class="tour-nav">
        <button class="tour-btn tour-back" type="button">Back</button>
        <button class="tour-btn tour-next" type="button">Next</button>
      </div>
    </div>
  `;

  overlay.appendChild(spotlight);
  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);

  els = {
    overlay,
    spotlight,
    tooltip,
    count: tooltip.querySelector('.tour-step-count'),
    title: tooltip.querySelector('.tour-title'),
    body: tooltip.querySelector('.tour-body'),
    progressFill: tooltip.querySelector('.tour-progress-fill'),
    back: tooltip.querySelector('.tour-back'),
    next: tooltip.querySelector('.tour-next'),
    skip: tooltip.querySelector('.tour-skip'),
    close: tooltip.querySelector('.tour-close'),
  };

  // Wiring
  els.next.addEventListener('click', () => go(index + 1));
  els.back.addEventListener('click', () => go(index - 1));
  els.skip.addEventListener('click', endTour);
  els.close.addEventListener('click', endTour);
  // Clicking the dim backdrop (but not the tooltip) ends the tour.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === els.spotlight) endTour();
  });

  return els;
}

function onKeydown(e) {
  if (e.key === 'Escape') { endTour(); }
  else if (e.key === 'ArrowRight') { go(index + 1); }
  else if (e.key === 'ArrowLeft') { go(index - 1); }
}

/* Position the spotlight + tooltip for the current step. */
function position() {
  const step = steps[index];
  const { overlay, spotlight, tooltip } = els;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 8;          // gap between target and spotlight edge
  const gap = 14;         // gap between spotlight and tooltip

  const target = step.target ? document.querySelector(step.target) : null;

  if (!target) {
    // Centered step — dim the whole screen, hide the spotlight.
    overlay.classList.add('tour-overlay--dim');
    spotlight.style.opacity = '0';
    spotlight.style.width = '0px';
    spotlight.style.height = '0px';
    tooltip.style.left = `${Math.max(16, (vw - tooltip.offsetWidth) / 2)}px`;
    tooltip.style.top = `${Math.max(16, (vh - tooltip.offsetHeight) / 2)}px`;
    return;
  }

  overlay.classList.remove('tour-overlay--dim');
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  const r = target.getBoundingClientRect();
  const top = r.top - pad;
  const left = r.left - pad;
  const width = r.width + pad * 2;
  const height = r.height + pad * 2;

  spotlight.style.opacity = '1';
  spotlight.style.top = `${top}px`;
  spotlight.style.left = `${left}px`;
  spotlight.style.width = `${width}px`;
  spotlight.style.height = `${height}px`;

  // Place tooltip below the target, or above if it would overflow.
  const tt = tooltip;
  const ttW = tt.offsetWidth;
  const ttH = tt.offsetHeight;

  let ttTop = top + height + gap;
  if (ttTop + ttH > vh - 12) {
    // Not enough room below — try above.
    const above = top - gap - ttH;
    ttTop = above > 12 ? above : Math.max(12, (vh - ttH) / 2);
  }

  let ttLeft = left + width / 2 - ttW / 2;
  ttLeft = Math.max(12, Math.min(ttLeft, vw - ttW - 12));

  tt.style.top = `${ttTop}px`;
  tt.style.left = `${ttLeft}px`;
}

/* Render + move to a given step index. */
function go(to) {
  if (to < 0) return;
  if (to >= steps.length) { endTour(); return; }

  index = to;
  const step = steps[index];
  const { count, title, body, back, next, progressFill } = els;

  count.textContent = `Step ${index + 1} of ${steps.length}`;
  title.textContent = step.title || '';
  body.innerHTML = step.body || '';
  progressFill.style.width = `${((index + 1) / steps.length) * 100}%`;

  back.style.visibility = index === 0 ? 'hidden' : 'visible';
  next.textContent = index === steps.length - 1 ? 'Done' : 'Next';

  // Replay the staggered content reveal for this step (reduced-motion
  // is handled in CSS, which neutralises the animation).
  const tip = els.tooltip;
  tip.classList.remove('tour-animate-in');
  void tip.offsetWidth;        // force reflow so the animation restarts
  tip.classList.add('tour-animate-in');

  position();
  // Reposition after layout settles (fonts/scroll/reflow).
  requestAnimationFrame(position);
  els.next.focus();
}

/* Public: start the walkthrough. */
export function startTour(stepList, { finishKey: key = null } = {}) {
  if (!stepList || !stepList.length) return;
  steps = stepList;
  finishKey = key;
  index = 0;

  ensureChrome();
  document.body.classList.add('tour-running');
  els.overlay.classList.add('open');

  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  document.addEventListener('keydown', onKeydown);

  go(0);
}

/* Public: end / dismiss the walkthrough. */
export function endTour() {
  if (!els) return;
  els.overlay.classList.remove('open');
  document.body.classList.remove('tour-running');

  window.removeEventListener('resize', position);
  window.removeEventListener('scroll', position, true);
  document.removeEventListener('keydown', onKeydown);

  if (finishKey) {
    try { localStorage.setItem(finishKey, '1'); } catch (_) { /* ignore */ }
  }
}

/* Public: run the tour only the first time for this key. */
export function maybeAutoStartTour(stepList, key) {
  let seen = false;
  try { seen = !!localStorage.getItem(key); } catch (_) { /* ignore */ }
  if (!seen) {
    // Defer slightly so the page (sidebar, cards) has rendered first.
    setTimeout(() => startTour(stepList, { finishKey: key }), 600);
  }
}
