// The app shell of every staff page (the direction approved 5.10.2026): on a wide
// screen a floating side menu (the logo, the screens this person may open with a rail
// on the current one, and the phone card), on a phone a floating bottom bar with the
// role's three screens and "עוד" for the rest. The top bar keeps who is signed in
// (name and avatar) and the way out. Mounted once after sign-in by the shared session
// code (mountSession in app/protocol-ui.js) and by the quote pages; the rules are
// app/shell-rules.js, the styles app/styles/shell.css.
// The managers' switch, "המשימות שלי" / "מבט מנהל" (app/manager-rules.js), is the
// first two entries of the menu (#mode-bar, #mode-mine, #mode-manager): one place on
// every page, and on a phone the first two buttons of the bar.
// Also here: the small motion helpers (page entrance, numbers that count up once,
// view transitions for a filter), all off under prefers-reduced-motion.
import { supabase } from './supa.js';
import { h } from './quote-doc.js';
import { PEOPLE, scopeOf } from './protocol.js';
import { setMode } from './manager-rules.js';
import {
  menuOf, barOf, currentOf, inMenu, avatarFill, initialsOf, nameOf,
} from './shell-rules.js';

const WIDE = '(min-width: 1024px)';
const RAIL_KEY = 'astrateg.rail';

// Who is signed in, as viewerOf() in app/protocol-ui.js has it. Asked once per page.
const viewers = new Map();
export function viewerFor(email) {
  const key = String(email || '').toLowerCase();
  if (!viewers.has(key)) {
    viewers.set(key, (async () => {
      try {
        const { data, error } = await supabase.from('staff').select('person').eq('email', key).maybeSingle();
        if (error) return { me: null, scope: 'own', error };
        const person = data?.person || null;
        return { me: person && person !== 'editor' && PEOPLE[person] ? person : null, scope: scopeOf(person), error: null };
      } catch (error) { return { me: null, scope: 'own', error }; }
    })());
  }
  return viewers.get(key);
}

// ── Avatars ─────────────────────────────────
// A circle with the first two letters of the name on the person's pastel; the name is
// always next to it in text, or in its title when the circle stands alone.
export function avatar(person, { name = PEOPLE[person]?.name || '', size = '' } = {}) {
  return h('span', { class: `ds-av${size ? ` ds-av-${size}` : ''}`, style: `--av:${avatarFill(person)}`, title: name, 'aria-hidden': 'true' }, initialsOf(name));
}

// ── Motion ──────────────────────────────────
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; } };
// Under automation (the browser suites) nothing moves: a test reads a list right after
// its click and measures a button while a block would still be rising (a moving box
// measures a hair under its size). tests/shell-e2e.mjs turns the motion on and checks it.
const scripted = () => navigator.webdriver === true && !globalThis.__astrategMotion;
const motionOn = () => !reduced() && !scripted();
// The styles' switch for the motion that needs no script (the dialog's entrance).
document.documentElement.classList.toggle('ds-motion', motionOn());

// A change inside a page (a filter, a day of the calendar): what stays glides to its
// new place when the browser can (document.startViewTransition); otherwise it just changes.
export function glide(change) {
  if (!motionOn() || typeof document.startViewTransition !== 'function') { change(); return; }
  let ran = false;
  const run = () => { if (!ran) { ran = true; change(); } };
  try {
    // A transition the browser gives up on (two things with one name, a hidden tab) still applies the change.
    const t = document.startViewTransition(run);
    for (const p of [t.ready, t.finished, t.updateCallbackDone]) p?.catch?.(() => {});
  } catch { run(); }
}

// The entrance of a page, once: the blocks rise in order. Only what is on the screen
// when the page opens (and what the first load reveals within a second); a list that
// is built again later does not move. The resting state is the visible one.
const RISE = '.page-head, .tabs, .me-bar, .stats > .stat, .block, .phase, .summary, .start-card, .ds-tile, .ds-card';
let entered = false;
export function enterPage(root = document.querySelector('main')) {
  if (entered || !root || !motionOn()) return;
  entered = true;
  let i = 0;
  const mark = () => {
    for (const el of root.querySelectorAll(RISE)) {
      if (el.classList.contains('ds-rise') || el.closest('[hidden]') || el.parentElement?.closest('.ds-rise')) continue;
      el.style.setProperty('--i', String(Math.min(i, 8)));
      el.classList.add('ds-rise');
      i += 1;
    }
  };
  mark();
  const watch = new MutationObserver(mark);
  watch.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  setTimeout(() => {
    watch.disconnect();
    for (const el of root.querySelectorAll('.ds-rise')) { el.classList.remove('ds-rise'); el.style.removeProperty('--i'); }
  }, 1100);
}

// Big numbers count up once (the first time a screen shows them). The element's text
// is never changed: the moving figure is drawn over it (shell.css), so anything that
// reads the page reads the real number from the first moment.
// `startedAt` (performance.now() of the first time) lets a screen that is built again
// within that moment carry on from where the figure was, instead of starting over.
const counted = new WeakSet();
const COUNT_MS = 700;
export function countUp(root, startedAt = performance.now()) {
  const elapsed = Math.max(0, performance.now() - startedAt);
  if (!root || !motionOn() || elapsed >= COUNT_MS) return;
  const els = root.matches?.('.ds-num') ? [root] : [...root.querySelectorAll('.ds-num')];
  for (const el of els) {
    const m = /^(\d{1,6})(%?)$/.exec(el.textContent.trim());
    if (counted.has(el) || !m || el.children.length) continue;
    counted.add(el);
    el.style.setProperty('--ds-count-color', getComputedStyle(el).color);
    el.style.setProperty('--ds-to', m[1]);
    el.style.setProperty('--ds-count-delay', `-${Math.round(elapsed)}ms`);
    el.dataset.suf = m[2];
    el.classList.add('ds-counting');
    const done = () => { el.classList.remove('ds-counting'); el.style.removeProperty('--ds-to'); el.style.removeProperty('--ds-count-delay'); el.style.removeProperty('--ds-count-color'); delete el.dataset.suf; };
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, 1200);
  }
}
// Bars and meters grow once: `.ds-grow` on their container while they do.
export function growOnce(root) {
  if (!root || !motionOn()) return;
  root.classList.add('ds-grow');
  setTimeout(() => root.classList.remove('ds-grow'), 1200);
}

// ── The menu ────────────────────────────────
function linkOf(item) {
  const a = h('a', {
    class: `side-link${item.mode ? ' mode-opt' : ''}`, id: item.mode ? `mode-${item.mode}` : `side-${item.id}`,
    href: item.href, 'data-menu': item.id,
  }, h('span', { class: 'side-t' }, item.label));
  if (item.mode) a.addEventListener('click', () => setMode(item.mode));
  return a;
}

function build(viewer, email) {
  const items = menuOf(viewer);
  const { bar, more } = barOf(items, viewer);
  const links = new Map(items.map((it) => [it.id, linkOf(it)]));
  const modes = items.filter((it) => it.mode);
  // The managers' switch keeps its own group and ids, as the first entries of the menu.
  const modeBar = modes.length === 2 ? h('div', { class: 'mode-bar', id: 'mode-bar', role: 'group', 'aria-label': 'החלפת תצוגה' }) : null;
  const rail = h('span', { class: 'side-rail', id: 'side-rail', 'aria-hidden': 'true' });
  const list = h('div', { class: 'side-list', id: 'side-list' });
  const sheet = h('div', { class: 'side-sheet', id: 'side-sheet', hidden: true });
  const moreBtn = h('button', { type: 'button', class: 'side-link side-more', id: 'side-more', 'aria-expanded': 'false', 'aria-controls': 'side-sheet' }, h('span', { class: 'side-t' }, 'עוד'));
  const standalone = (() => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; } })();
  const home = items[0].href;
  const promo = standalone ? null : h('a', { class: 'side-promo', id: 'side-promo', href: home },
    h('strong', {}, 'אסטרטג בטלפון'), h('small', {}, 'התראות על כל משימה, גם כשהאתר סגור'));
  const nav = h('nav', { class: 'side-nav', id: 'side-nav', 'aria-label': 'תפריט ראשי' }, rail, h('small', { class: 'side-k' }, 'תפריט'), list, sheet);
  const side = document.getElementById('app-side');
  side.replaceChildren(
    h('a', { class: 'side-logo', href: home, 'aria-label': 'astrateg' }, h('img', { src: 'app/assets/logo.png', alt: '', width: '403', height: '280' })),
    nav, ...(promo ? [promo] : []));

  const place = (parent, its) => {
    for (const it of its) (modeBar && it.mode ? modeBar : parent).append(links.get(it.id));
  };
  const setOpen = (open) => {
    sheet.hidden = !open;
    moreBtn.setAttribute('aria-expanded', String(open));
    side.classList.toggle('is-open', open);
  };
  // Wide: one list in the menu's order. Narrow: the bar, "עוד", and the rest in a sheet above it.
  const arrange = () => {
    const wide = matchMedia(WIDE).matches;
    setOpen(false);
    list.replaceChildren(...(modeBar ? [modeBar] : []));
    sheet.replaceChildren();
    modeBar?.replaceChildren();
    if (wide || !more.length) { place(list, items); moreBtn.remove(); } else { place(list, bar); list.append(moreBtn); place(sheet, more); }
    side.style.setProperty('--bar-n', String(wide ? 1 : Math.max(1, (more.length ? bar.length + 1 : items.length))));
    mark();
  };
  const mark = () => {
    const cur = currentOf(items, location.pathname, location.hash, location.search);
    for (const [id, a] of links) {
      if (id === cur.id) a.setAttribute('aria-current', cur.exact ? 'page' : 'true'); else a.removeAttribute('aria-current');
      a.classList.toggle('is-on', id === cur.id);
    }
    moreBtn.classList.toggle('is-on', more.some((it) => it.id === cur.id));
    moveRail(nav, rail);
  };
  moreBtn.addEventListener('click', () => {
    const open = moreBtn.getAttribute('aria-expanded') !== 'true';
    setOpen(open);
    if (open) sheet.querySelector('a')?.focus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) { setOpen(false); moreBtn.focus(); } });
  document.addEventListener('click', (e) => { if (!sheet.hidden && !side.contains(e.target)) setOpen(false); });
  matchMedia(WIDE).addEventListener('change', arrange);
  window.addEventListener('hashchange', mark);
  window.addEventListener('resize', () => moveRail(nav, rail));
  document.fonts?.ready.then(() => moveRail(nav, rail)).catch(() => {});
  arrange();

  document.body.classList.toggle('has-tabbar', items.length > 1);
  mountUser(viewer, email);
  hideRepeats(items);
}

// The rail slides to the current item; arriving from another page it starts where it was.
function moveRail(nav, rail) {
  const cur = nav.querySelector('.side-list [aria-current]');
  if (!cur || !matchMedia(WIDE).matches) { rail.style.opacity = '0'; return; }
  const y = Math.round(cur.offsetTop + (cur.offsetHeight - rail.offsetHeight) / 2);
  let from = null;
  try { from = sessionStorage.getItem(RAIL_KEY); sessionStorage.setItem(RAIL_KEY, String(y)); } catch { /* no storage */ }
  if (!rail.dataset.placed && from !== null && Number(from) !== y && motionOn()) {
    rail.style.transition = 'none';
    rail.style.transform = `translateY(${Number(from)}px)`;
    rail.style.opacity = '1';
    rail.getBoundingClientRect(); // the starting place is taken before the move
    rail.style.transition = '';
  }
  rail.dataset.placed = '1';
  rail.style.opacity = '1';
  rail.style.transform = `translateY(${y}px)`;
}

// The top bar: the person's name and avatar next to the sign-in state.
function mountUser(viewer, email) {
  const session = document.querySelector('.topbar .session');
  if (!session || session.querySelector('.ds-av')) return;
  const name = nameOf(viewer, email);
  session.append(h('span', { class: 'who-name', id: 'who-name' }, name), avatar(viewer?.me || null, { name }));
  session.title = email || '';
}

// A link in a page head to a screen the menu offers is not shown twice (.in-menu,
// protocol.css). Pages add their links after sign-in, so the head is watched.
function hideRepeats(items) {
  const sweep = () => {
    for (const a of document.querySelectorAll('.head-actions a[href]')) {
      let url = null;
      try { url = new URL(a.getAttribute('href'), location.href); } catch { /* not a link */ }
      // A page of this app, next to this one (payouts/ is another app and stays a link).
      const dir = (p) => p.slice(0, p.lastIndexOf('/') + 1);
      const same = !!url && url.origin === location.origin && dir(url.pathname) === dir(location.pathname) && !a.target && !a.hasAttribute('download');
      a.classList.toggle('in-menu', same && inMenu(items, url.pathname, url.hash));
    }
  };
  sweep();
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; sweep(); });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
}

// Mounts the shell for a signed-in member of staff. The frame (the room for the menu)
// is there at once, so the page does not jump when the answer about who it is arrives.
export async function mountShell(email) {
  if (document.getElementById('app-side')) return;
  const side = h('aside', { class: 'side', id: 'app-side' });
  (document.querySelector('header.topbar') || document.body.firstElementChild).before(side);
  document.body.classList.add('has-shell');
  enterPage();
  const viewer = await viewerFor(email);
  build(viewer, email);
}
