// The session's data cache at work, and "back" to a page the browser kept (docs/ops.md,
// section 60). Loaded by the staff pages only (app/protocol-ui.js, app/shell.js): it puts
// itself between the pages and the server (useFetchLayer in app/supa.js). The client's
// own pages and the payments app load app/supa.js without it, and nothing of theirs is
// ever kept or held.
//
// A screen opens at once with what it showed last time in this tab, and is brought up
// to date behind that. The rules of what may be kept, where and for how long are
// app/data-cache.js (an explicit list of reads; this tab's sessionStorage; under the
// account's id; minutes). Here: every request of the page passes `layer`, and
//  - a read on the list is answered from the store when the store has it, and asked of
//    the server at the same moment. When the server's answer is not what was shown,
//    the page is told (onFresh) and reads again; this time it is handed the server's
//    answers, with no second request;
//  - a page is shown what may be old only if it said how to draw again (onFresh). The
//    answers about who the person is are the exception: if one of those turns out to
//    have changed, the page loads again. So does a page that was shown something old
//    in a part its onFresh does not read again, once; from then on that kind of
//    question is asked of the server on that page (the store learns it);
//  - only the first time a page asks a question (its opening). Every later read of the
//    page (a refresh, the five-minute reload, a read after a save) is the server's;
//  - until the server has confirmed what is on the screen, <html data-stale> holds the
//    page's buttons and fields (shell.css): a tap acts on what the server said, never
//    on what was remembered. Links work. What anyone may read or change is decided by
//    the database, as always; the store only repeats what it already answered this
//    account in this tab;
//  - two identical reads at the same moment share one request;
//  - anything that may change the database empties the store (data-cache.js `wrote`);
//  - a page belongs to the account it was opened as. A request in another account's
//    name (someone else signed in on this device meanwhile) is not sent: the page is
//    hidden and loads again.
import { supabase, SUPABASE_URL, useFetchLayer, requestsIdle, redraws, clearKept, authStore } from './supa.js';
import { sessionCache, planOf, tokenUser, CACHE_KEY } from './data-cache.js';
import { quietPage } from './feel.js';

const kept = sessionCache((() => { try { return globalThis.sessionStorage || null; } catch { return null; } })());
const PAGE = typeof location === 'undefined' ? '' : (location.pathname.split('/').pop() || 'index.html');
const flying = new Map();  // key -> the server's answer on its way
const shown = new Map();   // key -> what this page was shown from the store: { shape, identity, differs, done, now: the server's answer }
const reasked = new Set();
const askedOnce = new Set();
let redrawing = false;
let checking = 0;
let drawn = false;
let asks = 0;
let pageUser = null; // the account this page was opened as: the first request that carried a token
// One turn of the event loop after everything that is already queued.
const nextTurn = () => new Promise((done) => {
  if (typeof MessageChannel !== 'function') { setTimeout(done, 0); return; }
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); done(); };
  ch.port2.postMessage(0);
});
const setStale = (on) => { try { document.documentElement.toggleAttribute('data-stale', on); } catch { /* no page */ } };
const answerOf = (entry) => new Response(entry.body, {
  status: entry.status, headers: { 'content-type': entry.type || 'application/json', ...(entry.range ? { 'content-range': entry.range } : {}) },
});
// The server's answer to a question on the list: kept when it is a plain yes, and
// shared by whoever asks the same thing while it is on its way.
function askServer(plan, uid, input, init) {
  let asked = flying.get(plan.key);
  if (!asked) {
    asked = fetch(input, init).then((res) => {
      if (res.status === 200 || res.status === 206) {
        res.clone().text().then((body) => kept.put(uid, plan, { status: res.status, type: res.headers.get('content-type'), range: res.headers.get('content-range'), body })).catch(() => {});
      } else kept.forget(uid, plan.key);
      return res;
    });
    flying.set(plan.key, asked);
    const landed = () => { if (flying.get(plan.key) === asked) flying.delete(plan.key); };
    asked.then(landed, landed);
  }
  return asked.then((res) => res.clone());
}
function fromStore(plan, uid, input, init) {
  const first = !askedOnce.has(plan.key);
  askedOnce.add(plan.key);
  if (!first) {
    // Reading again because the server's answer differed: that answer, which just arrived.
    const again = redrawing ? shown.get(plan.key)?.now : null;
    return again ? answerOf(again) : null;
  }
  const entry = kept.get(uid, plan.key);
  if (!entry) return null;
  const identity = kept.isIdentity(plan.path);
  if (!identity && (!redraws.size || kept.unsteady(uid, PAGE).includes(plan.shape))) return null;
  const mark = { shape: plan.shape, identity, differs: null, done: false, now: null };
  shown.set(plan.key, mark);
  checking += 1;
  setStale(true);
  askServer(plan, uid, input, init).then(async (res) => ({
    ok: res.status === 200 || res.status === 206, status: res.status, type: res.headers.get('content-type'), range: res.headers.get('content-range'), body: await res.text(),
  })).catch(() => null).then((got) => {
    // The server was not reached: what is on the screen stays, like a page left open with no network.
    mark.differs = !!got && (!got.ok || got.body !== entry.body);
    mark.now = got?.ok ? got : null;
    checking -= 1;
    if (checking === 0) nextTurn().then(confirmShown);
  });
  if (!identity) drawn = true;
  return answerOf(entry);
}
let confirming = false;
async function confirmShown() {
  if (confirming || checking > 0) return;
  confirming = true;
  try {
    const batch = [...shown].filter(([, s]) => s.differs !== null && !s.done);
    for (const [, s] of batch) s.done = true;
    if (batch.some(([, s]) => s.differs)) {
      let orphans = batch; // with no way to draw again, all of them
      if (redraws.size) {
        reasked.clear();
        redrawing = true;
        await Promise.allSettled([...redraws].map(async (draw) => draw()));
        await Promise.race([requestsIdle(), new Promise((done) => { setTimeout(done, 3000); })]);
        redrawing = false;
        for (const [, s] of batch) s.now = null;
        orphans = batch.filter(([key]) => !reasked.has(key));
        if (pageUser) kept.markUnsteady(pageUser, PAGE, orphans.filter(([, s]) => !s.identity).map(([, s]) => s.shape));
      }
      // Who the person is has changed (their role, or they left the team): nothing that was
      // kept for who they were is shown again, not the lists and not the frame.
      if (orphans.some(([, s]) => s.differs && s.identity)) clearKept();
      if (orphans.some(([, s]) => s.differs)) loadAgain();
    }
  } finally {
    confirming = false;
    if (checking === 0 && [...shown.values()].every((s) => s.done)) setStale(false);
    else if (checking === 0) nextTurn().then(confirmShown);
  }
}
// The page shows something old that it cannot draw again by itself: it loads again
// (the store now holds the server's answers), once, and when that loses nobody's typing.
const AGAIN = `${CACHE_KEY}.again`;
function loadAgain() {
  try {
    // Never in a circle: an answer that is different every time it is asked would load the page for ever.
    const [page, at, times] = String(sessionStorage.getItem(AGAIN) || '').split('|');
    const recent = page === PAGE && Math.abs(Date.now() - Number(at)) < 15e3 ? Number(times) || 0 : 0;
    if (recent >= 3) return;
    const go = () => {
      if (!quietPage()) return false;
      sessionStorage.setItem(AGAIN, `${PAGE}|${Date.now()}|${recent + 1}`);
      location.reload();
      return true;
    };
    if (go()) return;
    const retry = setInterval(() => { if (go()) clearInterval(retry); }, 3000);
    setTimeout(() => clearInterval(retry), 120e3);
  } catch { /* no storage: the page stays as it is until it is opened again */ }
}
// Whether anything this page drew came from the store (and not only who the person is).
export const shownFromStore = () => drawn;

// Nothing of the page is drawn any more (shell.css, <html data-left>), and it loads again:
// it then asks who is signed in, as every page does.
let leaving = false;
function leavePage() {
  if (leaving) return;
  leaving = true;
  try { document.documentElement.dataset.left = ''; } catch { /* no page */ }
  try { location.reload(); } catch { /* no page */ }
}

// What answers a request instead of a plain fetch, or null (app/supa.js counts either).
function layer(input, init, method) {
  asks += 1;
  let plan = { kind: 'other' };
  let uid = null;
  try {
    const headers = init?.headers ? new Headers(init.headers) : input?.headers || null;
    plan = planOf(SUPABASE_URL, { url: typeof input === 'string' ? input : input?.url || String(input), method, headers, body: init?.body ?? null });
    if (plan.kind !== 'other') uid = tokenUser(headers?.get?.('authorization'));
  } catch { plan = { kind: 'other' }; }
  if (!uid) return null;
  if (!pageUser) pageUser = uid;
  // Another account signed in on this device while the page stood open (or was kept for
  // "back"): nothing more is asked or shown in its name; the page loads again.
  // (While the sign-in form is up the page shows nothing of anyone: whoever signs in on
  // it is the page's person from then on, and the form's own code sends them home.)
  if (uid !== pageUser) {
    let form = null;
    try { form = document.getElementById('login-form'); } catch { form = null; }
    if (form && form.offsetParent !== null) pageUser = uid;
    else { leavePage(); return () => new Promise(() => {}); }
  }
  if (plan.kind === 'write') {
    kept.wrote(uid, plan.path);
    flying.clear(); // a read after this one is not handed an answer that left before it
    const after = () => kept.wrote(uid, plan.path); // and what was read while it was on its way
    return () => fetch(input, init).then((res) => { after(); return res; }, (err) => { after(); throw err; });
  }
  if (plan.kind !== 'keep') return null;
  if (redrawing) reasked.add(plan.key);
  const hit = fromStore(plan, uid, input, init);
  return hit ? () => Promise.resolve(hit) : () => askServer(plan, uid, input, init);
}
useFetchLayer(layer);

// ── "Back" to a page the browser kept whole ─────
// A browser keeps the page it leaves as it is (the back-forward cache) and shows it
// again on "back" without loading it: the list is where it was, at the same scroll.
//  - What stopped it here: the sign-in client listens to its other tabs on a
//    BroadcastChannel, and every page that opens says "signed in" on it; Chrome throws
//    a kept page away when a message reaches it. So the channel is closed while the
//    page is kept, and opened again when it is shown.
//  - A kept page is a picture of what one account saw. When it is shown again and that
//    account is no longer the one signed in on this device, nothing of it is shown:
//    the page is hidden and loads again.
//  - A page that is shown again reads again, quietly, from the server.
function deviceUser() {
  try { return JSON.parse(authStore.getItem(supabase.auth.storageKey) || 'null')?.user?.id || null; } catch { return null; }
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const auth = supabase.auth;
  let closed = false;
  window.addEventListener('pagehide', (e) => {
    if (!e.persisted || !auth.broadcastChannel) return;
    try { auth.broadcastChannel.close(); auth.broadcastChannel = null; closed = true; } catch { /* the page is then simply not kept */ }
  });
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    if (pageUser && deviceUser() !== pageUser) { leavePage(); return; }
    if (closed && typeof BroadcastChannel === 'function' && auth.storageKey) {
      closed = false;
      try {
        const channel = new BroadcastChannel(auth.storageKey);
        channel.addEventListener('message', (m) => { Promise.resolve(auth._notifyAllSubscribers?.(m.data?.event, m.data?.session, false)).catch(() => {}); });
        auth.broadcastChannel = channel;
      } catch { /* other tabs are then not heard, as in a browser without the channel */ }
    }
    // The pages read again by themselves when they become visible; where a browser does
    // not say so for a kept page (nothing was asked for a moment later), it is done here.
    // Not under an open dialog or over typed text: the page's own five-minute reload follows there.
    const before = asks;
    setTimeout(() => { if (asks === before && quietPage()) for (const draw of redraws) Promise.resolve().then(draw).catch(() => {}); }, 400);
  });
}
