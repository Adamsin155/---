// The staff sign-in screen: one place for how it looks and moves (docs/ops.md, section 51).
// Every staff page keeps a small form shell in its HTML (#login-form: the two inputs with
// their labels, #lg-err, #lg-msg, #lg-submit, #lg-forgot), so the browser's saved passwords
// meet real inputs from the first paint and the form works even if this file fails to load.
// This module builds the rest around it: the logo, the heading and the hint, the floating
// labels, the eye button, the figure and the door on the button, and the line under it.
// The look is app/styles/login.css; the first paint is decided by app/login-gate.js.
//
// Nothing here signs anyone in. The pages' own handlers (app/protocol-ui.js,
// app/dashboard.js, app/builder.js) ask the server and say what happened:
//   loginDoor.signing()  the request left: "מתחברים…", the door half open, the figure waits.
//                        It holds for as long as the request runs.
//   loginDoor.failed()   the server refused, or the person may not come in: the door shuts,
//                        the card shakes once. The handler shows its own text in #lg-err.
//   loginDoor.success()  only where the form sits in a dialog (index.html): the walk and the
//                        green button; resolves when they were seen.
// On a page, success needs no call: the page hides #login-block once the server said who is
// signed in, and that is when the figure walks in. The dark screen then stays over the page
// that is being built (<html data-boot>, section 42) and opens onto it when it is whole.
const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const SVG = 'http://www.w3.org/2000/svg';

export const LOGIN_TEXT = {
  heading: 'ברוכים השבים',
  hint: 'נכנסים עם האימייל והסיסמה של הצוות.',
  signing: 'מתחברים…',
  welcome: 'ברוכים השבים!',
  show: 'הצגת הסיסמה',
};
// Milliseconds. The pieces themselves are CSS (login.css keeps the same numbers).
export const LOGIN_TIMES = {
  welcomeAt: 340, // from the server's yes: the figure reached the door, the button turns green
  beat: 900, // from the server's yes: the green button was seen; the screen may open
  lift: 320, // the dark screen fades off the page
  dialogBeat: 760, // in a dialog: from the yes until the dialog may close
};
const NOTE = 'astrateg.door'; // read by app/login-gate.js on the next page of this tab
const NIGHT = '#071433';

// A pause that is not a timer: it runs on the document's animation clock, so it ends at
// the same moment as the CSS pieces it waits for (and a page whose timers are held, as
// in the browser tests, still opens).
const wait = (ms) => {
  try { return root.animate([], { duration: ms }).finished.then(() => {}, () => {}); } catch { return new Promise((done) => { setTimeout(done, ms); }); }
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

// The far end of the button: a closed door and a small figure standing next to it.
// Drawn for a right-to-left page: the door is at the left end, the figure walks left.
function scene() {
  return svg('svg', { class: 'lg-scene', viewBox: '0 0 72 44', width: '72', height: '44', 'aria-hidden': 'true', focusable: 'false' },
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
}
const check = () => svg('svg', { class: 'lg-check', viewBox: '0 0 24 24', width: '26', height: '26', 'aria-hidden': 'true', focusable: 'false' },
  svg('path', { d: 'M5 12.6l4.6 4.6L19 7.4' }));
const eyeIcon = () => svg('svg', { viewBox: '0 0 24 24', width: '22', height: '22', 'aria-hidden': 'true', focusable: 'false' },
  svg('path', { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z' }),
  svg('circle', { cx: '12', cy: '12', r: '3' }),
  svg('path', { class: 'lg-eye-off', d: 'M4.5 4.5l15 15' }));

const NOTHING = { signing() {}, failed() {}, success: () => Promise.resolve() };

function mountLogin() {
  const form = $('login-form');
  const email = $('lg-email');
  const pass = $('lg-pass');
  const button = $('lg-submit');
  if (!form || !email || !pass || !button || form.dataset.door) return NOTHING;
  form.dataset.door = 'idle';
  const block = $('login-block'); // the screen; absent where the form sits in a dialog
  const dialog = form.closest('dialog');
  const forgot = $('lg-forgot');
  const err = $('lg-err');
  const msg = $('lg-msg');
  let state = 'idle'; // idle | signing | won
  let seen = Promise.resolve(); // resolves when the green button was on the screen long enough

  // ── The card ──
  form.classList.add('lg-card');
  (dialog || block)?.classList.add(dialog ? 'lg-dialog' : 'lg-screen');
  const fields = [email, pass].map((input) => {
    const field = input.closest('.field') || input.parentElement;
    field.classList.add('lg-field');
    field.removeAttribute('style');
    const filled = () => field.classList.toggle('is-filled', input.value !== '');
    for (const ev of ['input', 'change', 'blur']) input.addEventListener(ev, filled);
    filled();
    return field;
  });
  const eye = el('button', { type: 'button', class: 'lg-eye', 'aria-label': LOGIN_TEXT.show, 'aria-pressed': 'false', 'aria-controls': 'lg-pass' }, eyeIcon());
  const showPass = (on) => { pass.type = on ? 'text' : 'password'; eye.setAttribute('aria-pressed', String(on)); };
  // The press does not take the caret out of the field (the phone's keyboard stays up).
  eye.addEventListener('mousedown', (e) => e.preventDefault());
  eye.addEventListener('click', () => showPass(pass.type === 'password'));
  fields[1].classList.add('lg-field-pass');
  fields[1].append(eye);

  if (forgot) {
    forgot.removeAttribute('style');
    fields[1].after(el('div', { class: 'lg-row' }, forgot));
  }
  const status = el('p', { class: 'lg-status', id: 'lg-status', role: 'status', 'aria-live': 'polite' });
  const say = (text) => status.replaceChildren(...(text ? [el('span', {}, text)] : []));
  const label = el('span', { class: 'lg-btn-label' }, button.textContent.trim() || 'כניסה');
  button.classList.add('lg-go');
  button.replaceChildren(label, scene(), check());
  if (dialog) form.append(status);
  else {
    // The messages sit between the fields and the button, the status line under the button.
    if (err) button.before(err);
    if (msg) button.before(msg);
    button.after(status);
    const heading = $('lg-h');
    if (heading) heading.textContent = LOGIN_TEXT.heading;
    const brand = el('div', { class: 'lg-brand' },
      el('span', { class: 'lg-brand-chip' }, el('img', { src: 'app/assets/logo-mark.png', alt: '', width: '271', height: '186' })),
      el('span', { class: 'lg-brand-name', lang: 'en', dir: 'ltr' }, 'astrateg'));
    form.prepend(brand);
    (heading || brand).after(el('p', { class: 'lg-hint' }, LOGIN_TEXT.hint));
  }

  // ── The button's three states ──
  const set = (next) => {
    state = next;
    form.dataset.door = next;
    button.classList.toggle('is-signing', next === 'signing');
    button.classList.toggle('is-won', next === 'won');
    if (next === 'signing') form.setAttribute('aria-busy', 'true'); else form.removeAttribute('aria-busy');
  };
  const reset = () => { set('idle'); say(''); form.classList.remove('is-shaking'); };
  form.addEventListener('animationend', (e) => { if (e.target === form) form.classList.remove('is-shaking'); });
  // Once the person is in, a second Enter sends nothing.
  form.addEventListener('submit', (e) => { if (state === 'won') { e.preventDefault(); e.stopImmediatePropagation(); } }, true);

  function signing() {
    if (state === 'won') return;
    showPass(false); // what is sent, and what the browser offers to save, is a password field
    form.classList.remove('is-shaking');
    set('signing');
    say(LOGIN_TEXT.signing);
  }
  function failed() {
    if (state !== 'signing') return;
    set('idle');
    say('');
    form.classList.add('is-shaking');
  }
  function won(beat) {
    if (state === 'won') return seen;
    set('won');
    const from = wait(LOGIN_TIMES.welcomeAt).then(() => { if (state === 'won') say(LOGIN_TEXT.welcome); });
    seen = Promise.all([from, wait(beat)]).then(() => {});
    return seen;
  }

  if (dialog) {
    dialog.addEventListener('close', reset);
    return { signing, failed, success: () => won(LOGIN_TIMES.dialogBeat) };
  }
  if (!block) return { signing, failed, success: () => won(LOGIN_TIMES.beat) };

  // ── The screen: the night behind the card, and how it opens onto the page ──
  const app = $('app');
  const logout = $('btn-logout');
  const theme = document.querySelector('meta[name="theme-color"]');
  const dayTheme = theme?.getAttribute('content') || null;
  const paint = (night) => { if (theme && dayTheme) theme.setAttribute('content', night ? NIGHT : dayTheme); };
  const note = (on) => { try { if (on) sessionStorage.setItem(NOTE, '1'); else sessionStorage.removeItem(NOTE); } catch { /* no storage */ } };
  let lifting = false;

  async function lift() {
    if (lifting) return;
    lifting = true;
    await seen;
    root.dataset.door = 'out';
    await wait(LOGIN_TIMES.lift);
    delete root.dataset.door;
    block.classList.remove('lg-won');
    note(false);
    paint(false);
    reset();
    lifting = false;
    look(); // signed out again meanwhile: the screen comes back
  }

  // Called whenever the page changes what it shows: the form, the app, the building of the page.
  function look() {
    if (lifting) return;
    if (!block.hidden) {
      // The sign-in screen is on (also for a session that ended, or a page with no gate).
      if (state === 'won') { block.classList.remove('lg-won'); reset(); }
      if (root.dataset.door !== 'in') { root.dataset.door = 'in'; paint(true); }
      fit();
      return;
    }
    // The form was put away while the request ran: the server said who this is. Now the
    // figure walks in; the card stays for the green button although the page hid it.
    if (state === 'signing') {
      block.classList.add('lg-won');
      root.dataset.door = 'through';
      note(true); // a page that sends the person on to their first screen: the next page opens the door
      won(LOGIN_TIMES.beat);
    }
    if (!('door' in root.dataset)) return;
    paint(true);
    const decided = state === 'won' || root.dataset.door === 'through' || (logout && !logout.hidden);
    const ready = !('boot' in root.dataset) && (!app || !app.hidden);
    if (decided && ready) lift();
  }

  // With the phone's keyboard up, the fields and the button stay in what is left of the screen.
  const view = window.visualViewport;
  function fit() {
    if (block.hidden && !block.classList.contains('lg-won')) return;
    const tall = view ? view.height : window.innerHeight;
    block.classList.toggle('lg-kb', tall < 480 || window.innerHeight - tall > 120);
    if (view) {
      block.style.setProperty('--lg-vh', `${Math.round(view.height)}px`);
      block.style.setProperty('--lg-top', `${Math.round(view.offsetTop)}px`);
    }
  }
  view?.addEventListener('resize', fit);
  view?.addEventListener('scroll', fit);
  window.addEventListener('resize', fit);
  form.addEventListener('focusin', (e) => { if (e.target instanceof HTMLInputElement) { fit(); e.target.scrollIntoView({ block: 'nearest' }); } });

  const watch = new MutationObserver(look);
  watch.observe(root, { attributes: true, attributeFilter: ['data-boot'] });
  for (const node of [block, app, logout]) if (node) watch.observe(node, { attributes: true, attributeFilter: ['hidden'] });
  // A hidden tab draws nothing: the slow drift of the background stops with it.
  const still = () => root.toggleAttribute('data-door-still', document.hidden);
  document.addEventListener('visibilitychange', still);
  still();
  // Back to a page the browser kept as it was left (after signing in on it).
  window.addEventListener('pageshow', (e) => { if (e.persisted) look(); });
  look();
  return { signing, failed, success: () => won(LOGIN_TIMES.beat) };
}

export const loginDoor = mountLogin();
