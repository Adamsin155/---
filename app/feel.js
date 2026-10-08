// What makes the staff pages feel like an app on a phone, beyond the styles
// (app/styles/shell.css) and the way a page opens whole (mountSession in
// app/protocol-ui.js). Started once per page by the app shell (app/shell.js), for a
// signed-in member of staff. docs/ops.md, section 42.
//  - siteWorker(): the one registration of the site's service worker (sw.js). The
//    published worker keeps the site's own files on the device (never anything from the
//    database), so a screen opens without the network; here the page asks it to
//    complete its store, and hears when a newer publish is ready.
//  - A page still running an older publish loads itself again when that disturbs
//    nobody: when it goes to the background, with no dialog open and nothing typed.
//    (Every move between screens is a page load, so the next screen is new anyway.)
//  - The page a finger lands on (or a mouse rests on) is fetched before the tap ends.

// ── The service worker ────────────────────
let worker = null;
// Registered once, at the site root (sw.js controls every page); resolves with the
// registration when the worker is active, or null. The worker's own file is always
// checked with the server (updateViaCache), so a new publish is noticed on the next page.
export function siteWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  worker ||= navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).href, updateViaCache: 'none' })
    .then((reg) => (reg.active ? reg : new Promise((resolve) => {
      const sw = reg.installing || reg.waiting;
      if (!sw) { resolve(null); return; }
      sw.addEventListener('statechange', () => {
        if (sw.state === 'activated') resolve(reg);
        else if (sw.state === 'redundant') resolve(null);
      });
    })))
    .catch(() => null);
  return worker;
}

// ── A newer publish ───────────────────────
const TEXT_FIELDS = 'textarea, input:not([type=hidden], [type=checkbox], [type=radio], [type=button], [type=submit], [type=file], [type=range], [type=color])';
// Nothing of the person's would be lost by loading the page again.
export function quietPage(doc = document) {
  if (doc.querySelector('dialog[open]')) return false;
  return ![...doc.querySelectorAll(TEXT_FIELDS)].some((el) => el.value !== el.defaultValue);
}
let stale = false;
function refreshIfQuiet() {
  if (!stale || !document.hidden || !quietPage()) return;
  stale = false;
  location.reload();
}

// ── The next page, before the tap ends ────
const fetched = new Set();
// A page of this site next to this one (not this page itself, not a file to download).
export function nextPage(a, here = location) {
  if (!a || a.target || a.hasAttribute('download')) return null;
  let url = null;
  try { url = new URL(a.getAttribute('href'), here.href); } catch { return null; }
  if (url.origin !== here.origin || !/\.html$|\/$/.test(url.pathname)) return null;
  if (url.pathname === here.pathname) return null;
  return `${url.origin}${url.pathname}`;
}
function warm(e) {
  const href = nextPage(e.target?.closest?.('a[href]'));
  if (!href || fetched.has(href) || navigator.connection?.saveData) return;
  fetched.add(href);
  // The page's own file only (the address without its ?… and #…): nothing about a client leaves in it.
  // Read to its end: a response left unread stays open, and is not kept for the page load that follows.
  fetch(href, { credentials: 'same-origin' }).then((res) => res.arrayBuffer()).catch(() => {});
}

let started = false;
export function startFeel() {
  if (started) return;
  started = true;
  // A touch listener on the page is also what makes iOS show the pressed state (:active).
  document.addEventListener('touchstart', warm, { passive: true });
  document.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') warm(e); }, { passive: true });
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'astrateg-update') return;
    stale = true;
    refreshIfQuiet();
  });
  document.addEventListener('visibilitychange', refreshIfQuiet);
  // The worker is asked to complete its store a moment after the page is shown: the
  // first time, that is a few seconds of fetching, and the page comes first.
  const ask = () => setTimeout(() => { siteWorker().then((reg) => reg?.active?.postMessage({ type: 'astrateg-fill' })).catch(() => {}); }, 1200);
  const root = document.documentElement;
  if (!('boot' in root.dataset)) { ask(); return; }
  const shown = new MutationObserver(() => { if (!('boot' in root.dataset)) { shown.disconnect(); ask(); } });
  shown.observe(root, { attributes: true, attributeFilter: ['data-boot'] });
}
