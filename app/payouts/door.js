// The sign-in card of Astrateg Payment, in the look of the staff sign-in screen
// (docs/ops.md, sections 51 and 56): the night, the glass card, the floating labels, the
// eye, and the button with the figure and the door. The look is app/styles/login.css,
// unchanged; this file builds the same markup with the same class names.
//
// Why not app/login-ui.js itself: that module mounts once, at import, on a form that is
// already in the page's HTML, writes the staff heading and hint, and reads the logo from
// the site's root. This app builds its forms when it needs them (sign-in, a new password),
// keeps its own words, and lives one folder down. So the pieces are mirrored here.
//
// Nothing here signs anyone in. app/payouts/app.js asks the server and says what happened:
//   door.open(card)   a card is on the screen (the night comes up with it)
//   door.signing()    the request left: "מתחברים…", the door half open, the figure waits
//   door.failed()     the server refused: the door shuts, the card shakes once
//   door.won()        the server said yes: the figure walks in, the button turns green
//   door.lift()       the page behind is ready: the night fades off it
import { h } from './client.js';

const root = document.documentElement;
const SVG = 'http://www.w3.org/2000/svg';
const NIGHT = '#071433'; // --ds-navy: the colour of the phone's status bar while the night is on
export const DOOR_TEXT = { signing: 'מתחברים…', welcome: 'ברוכים השבים!', show: 'הצגת מה שהוקלד' };
// Milliseconds, as LOGIN_TIMES in app/login-ui.js (the pieces themselves are in login.css).
const TIMES = { welcomeAt: 340, beat: 900, lift: 320 };
// Under automation nothing waits for the walk (as the motion of app/shell.js); a test
// that wants to see it sets globalThis.__astrategMotion.
const scripted = () => navigator.webdriver === true && !globalThis.__astrategMotion;
const wait = (ms) => {
  if (scripted()) return Promise.resolve();
  try { return root.animate([], { duration: ms }).finished.then(() => {}, () => {}); } catch { return new Promise((done) => { setTimeout(done, ms); }); }
};

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}
// The far end of the button: a closed door and a small figure next to it (drawn for a
// right-to-left page: the door at the left end, the figure walks left).
const scene = () => svg('svg', { class: 'lg-scene', viewBox: '0 0 72 44', width: '72', height: '44', 'aria-hidden': 'true', focusable: 'false' },
  svg('defs', {},
    svg('radialGradient', { id: 'lg-glow-fill' },
      svg('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.95' }),
      svg('stop', { offset: '.45', 'stop-color': '#fff', 'stop-opacity': '.4' }),
      svg('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }))),
  svg('ellipse', { class: 'lg-glow', cx: '17', cy: '22', rx: '17', ry: '22', fill: 'url(#lg-glow-fill)' }),
  svg('rect', { class: 'lg-doorway', x: '8', y: '6', width: '18', height: '32', rx: '2' }),
  svg('g', { class: 'lg-leaf' },
    svg('rect', { x: '8', y: '6', width: '18', height: '32', rx: '2' }),
    svg('circle', { class: 'lg-knob', cx: '22', cy: '23', r: '1.4' })),
  svg('rect', { class: 'lg-frame', x: '8', y: '6', width: '18', height: '32', rx: '2' }),
  svg('g', { class: 'lg-figure' },
    svg('circle', { class: 'lg-head', cx: '47', cy: '14.5', r: '3.6' }),
    svg('path', { class: 'lg-body', d: 'M47 19.5V29M47 22l-3.6 5M47 22l3.6 5' }),
    svg('path', { class: 'lg-leg lg-leg-a', d: 'M47 29v9' }),
    svg('path', { class: 'lg-leg lg-leg-b', d: 'M47 29v9' })));
const check = () => svg('svg', { class: 'lg-check', viewBox: '0 0 24 24', width: '26', height: '26', 'aria-hidden': 'true', focusable: 'false' },
  svg('path', { d: 'M5 12.6l4.6 4.6L19 7.4' }));
const eyeIcon = () => svg('svg', { viewBox: '0 0 24 24', width: '22', height: '22', 'aria-hidden': 'true', focusable: 'false' },
  svg('path', { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z' }),
  svg('circle', { cx: '12', cy: '12', r: '3' }),
  svg('path', { class: 'lg-eye-off', d: 'M4.5 4.5l15 15' }));

// ── The pieces of a card ──
// The logo's mark on a white chip (the full logo has black letters: no use on the night).
export const brandRow = () => h('div', { class: 'lg-brand' },
  h('span', { class: 'lg-brand-chip' }, h('img', { src: '../app/assets/logo-mark.png', alt: '', width: '271', height: '186' })),
  h('span', { class: 'lg-brand-name', lang: 'en', dir: 'ltr' }, 'astrateg'));

// A field whose label sits inside it and moves up small when the field is in use or filled.
// `eye`: a button that shows what was typed (a password field).
export function floatField(label, input, { eye = false } = {}) {
  const box = h('div', { class: 'field lg-field' }, h('label', { for: input.id }, label), input);
  const filled = () => box.classList.toggle('is-filled', input.value !== '');
  for (const ev of ['input', 'change', 'blur']) input.addEventListener(ev, filled);
  filled();
  if (eye) {
    const btn = h('button', { type: 'button', class: 'lg-eye', 'aria-label': DOOR_TEXT.show, 'aria-pressed': 'false', 'aria-controls': input.id }, eyeIcon());
    // The press does not take the caret out of the field (the phone's keyboard stays up).
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => { const on = input.type === 'password'; input.type = on ? 'text' : 'password'; btn.setAttribute('aria-pressed', String(on)); });
    box.classList.add('lg-field-pass');
    box.append(btn);
  }
  return box;
}

// The button with the door: its word, the scene and the check of the green state.
export function doorButton(label) {
  return h('button', { type: 'submit', class: 'btn btn-primary lg-go', id: 'lg-submit' },
    h('span', { class: 'lg-btn-label' }, label), scene(), check());
}
// The line under the button: its room is kept, so nothing moves when it speaks.
export const statusLine = () => h('p', { class: 'lg-status', id: 'lg-status', role: 'status', 'aria-live': 'polite' });

// ── The screen: the night behind a card, and how it opens onto the page ──
const block = document.getElementById('login-block');
const theme = document.querySelector('meta[name="theme-color"]');
const dayTheme = theme?.getAttribute('content') || null;
const paint = (night) => { if (theme && dayTheme) theme.setAttribute('content', night ? NIGHT : dayTheme); };
let form = null;
let button = null;
let status = null;
let state = 'idle'; // idle | signing | won
let seen = Promise.resolve(); // resolves when the green button was on the screen long enough
let lifting = null;

const say = (text) => status?.replaceChildren(...(text ? [h('span', {}, text)] : []));
function set(next) {
  state = next;
  if (!form) return;
  form.dataset.door = next;
  button?.classList.toggle('is-signing', next === 'signing');
  button?.classList.toggle('is-won', next === 'won');
  if (next === 'signing') form.setAttribute('aria-busy', 'true'); else form.removeAttribute('aria-busy');
}

// With the phone's keyboard up, the fields and the button stay in what is left of the screen.
const view = window.visualViewport;
function fit() {
  if (!block || block.hidden) return;
  const tall = view ? view.height : window.innerHeight;
  const kb = tall < 480 || window.innerHeight - tall > 120;
  block.classList.toggle('lg-kb', kb);
  block.classList.toggle('lg-tight', kb && tall < 380);
  if (view) {
    block.style.setProperty('--lg-vh', `${Math.round(view.height)}px`);
    block.style.setProperty('--lg-top', `${Math.round(view.offsetTop)}px`);
  }
}
view?.addEventListener('resize', fit);
view?.addEventListener('scroll', fit);
window.addEventListener('resize', fit);
// A hidden tab draws nothing: the slow drift of the background stops with it.
const still = () => root.toggleAttribute('data-door-still', document.hidden);
document.addEventListener('visibilitychange', still);
still();

export const door = {
  // Puts a card on the screen. `card`: the <form>; `go`: its door button, `line`: its status line (both optional).
  open(card, { go = null, line = null } = {}) {
    if (!block) return;
    form = card; button = go; status = line; seen = Promise.resolve();
    form.classList.add('lg-card');
    form.addEventListener('animationend', (e) => { if (e.target === form) form.classList.remove('is-shaking'); });
    form.addEventListener('focusin', (e) => { if (e.target instanceof HTMLInputElement) { fit(); e.target.scrollIntoView({ block: 'nearest' }); } });
    // Once the person is in, a second Enter sends nothing.
    form.addEventListener('submit', (e) => { if (state === 'won') { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    set('idle');
    block.replaceChildren(form);
    block.hidden = false;
    // Over a page that was already drawn (signing out, a session that ended): the night fades in.
    if (root.dataset.door !== 'in') {
      if (!('door' in root.dataset)) root.dataset.doorLate = '';
      root.dataset.door = 'in';
    }
    paint(true);
    fit();
  },
  get isOpen() { return !!block && !block.hidden; },
  signing() {
    if (state === 'won' || !form) return;
    for (const eye of form.querySelectorAll('.lg-eye[aria-pressed="true"]')) eye.click(); // what is sent is a password field
    form.classList.remove('is-shaking');
    set('signing');
    say(DOOR_TEXT.signing);
  },
  failed() {
    if (!form) return;
    set('idle');
    say('');
    form.classList.add('is-shaking');
  },
  // The server said yes. The card stays for the green button while the page is built behind the night.
  won() {
    if (!form || state === 'won') return seen;
    set('won');
    root.dataset.door = 'through';
    const from = wait(TIMES.welcomeAt).then(() => { if (state === 'won') say(DOOR_TEXT.welcome); });
    seen = Promise.all([from, wait(TIMES.beat)]).then(() => {});
    return seen;
  },
  // The page is ready (or there is something to say on it): the night fades off.
  lift() {
    if (!block || block.hidden) {
      // No card is up (the gate drew the night and the page had something else to say): the night goes.
      delete root.dataset.door; delete root.dataset.doorLate; paint(false);
      return Promise.resolve();
    }
    if (lifting) return lifting;
    const mine = form;
    lifting = (async () => {
      await seen;
      if (form !== mine) return; // another card came up meanwhile (signed out again)
      root.dataset.door = 'out';
      await wait(TIMES.lift);
      if (form !== mine) { root.dataset.door = 'in'; return; }
      delete root.dataset.door;
      delete root.dataset.doorLate;
      paint(false);
      block.hidden = true;
      block.replaceChildren();
      block.classList.remove('lg-kb', 'lg-tight');
      form = null; button = null; status = null; state = 'idle';
    })().finally(() => { lifting = null; });
    return lifting;
  },
};
