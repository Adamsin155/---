// Supabase connection. The publishable key is safe to ship in the browser:
// access is enforced by row level security and the create-quote function.
import { createClient } from './vendor/supabase.js';
import { sessionCache, planOf, tokenUser, FRESH_FOR, CACHE_KEY } from './data-cache.js';
import { quietPage } from './feel.js';

export const SUPABASE_URL = 'https://czncjzziqrqtezpwxxpz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_kf4V_lkjM658wkDiPVukWA_HoB5AH_e';

// Every request of the page to the project is counted from its start until its answer
// has been read and used, so a page that is opening knows when nothing more is on its
// way (requestsIdle; docs/ops.md, section 42). No timer is involved in the count.
let inFlight = 0;
const idleWaiters = new Set();
// One turn of the event loop after everything that is already queued (the code that
// waited for an answer has run, and has asked for what it needs next).
const nextTurn = () => new Promise((done) => {
  if (typeof MessageChannel !== 'function') { setTimeout(done, 0); return; }
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); done(); };
  ch.port2.postMessage(0);
});
function settle() {
  inFlight -= 1;
  if (inFlight > 0) return;
  for (const w of [...idleWaiters]) w();
}
// `ask` is what answers: the server, or the session's store (below).
async function counted(ask, method) {
  inFlight += 1;
  let open = true;
  const close = () => { if (!open) return; open = false; nextTurn().then(settle); };
  try {
    const res = await ask();
    if (!res.body || method === 'HEAD' || [204, 205, 304].includes(res.status)) close();
    else {
      // Counted until the answer is read; an answer nobody reads is let go after a moment.
      for (const m of ['text', 'json', 'blob', 'arrayBuffer', 'formData']) {
        const read = res[m].bind(res);
        res[m] = () => read().finally(close);
      }
      setTimeout(close, 3000);
    }
    return res;
  } catch (err) {
    close();
    throw err;
  }
}
// Resolves when no request to the project is on its way and none follows right after.
export async function requestsIdle() {
  for (;;) {
    await nextTurn();
    if (inFlight <= 0) return;
    await new Promise((done) => { const w = () => { idleWaiters.delete(w); done(); }; idleWaiters.add(w); });
  }
}

// ── The session's data cache (docs/ops.md, section 60) ───────────────────
// A screen opens at once with what it showed last time in this tab, and is brought up
// to date behind that. The rules of what may be kept, where and for how long are
// app/data-cache.js (an explicit list of reads; this tab's sessionStorage; under the
// account's id; minutes). Here: every request of the page passes countedFetch, and
//  - a read on the list is answered from the store when the store has it, and asked of
//    the server at the same moment. When the server's answer is not what was shown,
//    the page is told (onFresh) and reads again; this time it is handed the server's
//    answers, with no second request;
//  - a page is shown what may be old only if it said how to draw again (onFresh). The
//    answers about who the person is are the exception: if one of those turns out to
//    have changed, the page loads again. So does a page that was shown something old
//    in a part its onFresh does not read again, once; from then on that kind of
//    question is asked of the server on that page (the store learns it);
//  - until the server has confirmed what is on the screen, <html data-stale> holds the
//    page's buttons and fields (shell.css): a tap acts on what the server said, never
//    on what was remembered. Links work. What anyone may read or change is decided by
//    the database, as always; the store only repeats what it already answered this
//    account in this tab;
//  - two identical reads at the same moment share one request;
//  - anything that may change the database empties the store (data-cache.js `wrote`).
const kept = sessionCache((() => { try { return globalThis.sessionStorage || null; } catch { return null; } })());
const PAGE = typeof location === 'undefined' ? '' : (location.pathname.split('/').pop() || 'index.html');
const flying = new Map();  // key -> the server's answer on its way
const shown = new Map();   // key -> what this page was shown from the store: { shape, body, identity, differs, done }
const redraws = new Set(); // how the page reads and draws again (onFresh)
const reasked = new Set();
const askedOnce = new Set();
let redrawing = false;
let checking = 0;
let lastUser = null;
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
  // Only the first time a page asks a question (its opening), and when it reads again
  // because it was told to (onFresh). Every later read of the page (a refresh, the
  // five-minute reload, a read after a save) is the server's.
  const first = !askedOnce.has(plan.key);
  askedOnce.add(plan.key);
  if (!first && !redrawing) return null;
  const entry = kept.get(uid, plan.key);
  if (!entry) return null;
  // The server said this a moment ago and nothing was written since: it is the answer.
  const fresh = Date.now() - entry.at <= FRESH_FOR && entry.at > kept.wroteAt(uid);
  if (!fresh) {
    if (!first) return null;
    const identity = kept.isIdentity(plan.path);
    if (!identity && (!redraws.size || kept.unsteady(uid, PAGE).includes(plan.shape))) return null;
    shown.set(plan.key, { shape: plan.shape, body: entry.body, identity, differs: null, done: false });
    checking += 1;
    setStale(true);
    askServer(plan, uid, input, init).then((res) => (res.status === 200 || res.status === 206 ? res.text() : null), () => undefined).then((body) => {
      // The server was not reached: what is on the screen stays, like a page left open with no network.
      shown.get(plan.key).differs = body === undefined ? false : body !== entry.body;
      checking -= 1;
      if (checking === 0) nextTurn().then(confirmShown);
    });
  }
  if (!kept.isIdentity(plan.path)) drawn = true;
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
        orphans = batch.filter(([key]) => !reasked.has(key));
        if (lastUser) kept.markUnsteady(lastUser, PAGE, orphans.filter(([, s]) => !s.identity).map(([, s]) => s.shape));
      }
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
    const [page, at] = String(sessionStorage.getItem(AGAIN) || '').split('|');
    if (page === PAGE && Date.now() - Number(at) < 15e3) return; // it just did
    const go = () => {
      if (!quietPage()) return false;
      sessionStorage.setItem(AGAIN, `${PAGE}|${Date.now()}`);
      location.reload();
      return true;
    };
    if (go()) return;
    const retry = setInterval(() => { if (go()) clearInterval(retry); }, 3000);
    setTimeout(() => clearInterval(retry), 120e3);
  } catch { /* no storage: the page stays as it is until it is opened again */ }
}
// A page says how it reads and draws again; from then on it may be shown what the
// store remembers (called at the top of the page's script, before its first request).
export function onFresh(draw) { redraws.add(draw); }
// Whether anything this page drew came from the store (and not only who the person is).
let drawn = false;
export const shownFromStore = () => drawn;
// Signing out: nothing of this account stays in the tab (also app/visit.js forgetPlace).
export function clearKept() { kept.clear(); try { sessionStorage.removeItem('astrateg.shell'); } catch { /* no storage */ } }

let asks = 0;
function countedFetch(input, init) {
  asks += 1;
  const method = String(init?.method || input?.method || 'GET').toUpperCase();
  let plan = { kind: 'other' };
  let uid = null;
  try {
    const headers = init?.headers ? new Headers(init.headers) : input?.headers || null;
    plan = planOf(SUPABASE_URL, { url: typeof input === 'string' ? input : input?.url || String(input), method, headers, body: init?.body ?? null });
    if (plan.kind !== 'other') uid = tokenUser(headers?.get?.('authorization'));
  } catch { plan = { kind: 'other' }; }
  if (uid) lastUser = uid;
  if (uid && plan.kind === 'write') {
    kept.wrote(uid, plan.path);
    const after = () => kept.wrote(uid, plan.path); // and what was read while it was on its way
    return counted(() => fetch(input, init).then((res) => { after(); return res; }, (err) => { after(); throw err; }), method);
  }
  if (uid && plan.kind === 'keep') {
    if (redrawing) reasked.add(plan.key);
    const hit = fromStore(plan, uid, input, init);
    if (hit) return counted(() => Promise.resolve(hit), method);
    return counted(() => askServer(plan, uid, input, init), method);
  }
  return counted(() => fetch(input, init), method);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: countedFetch },
});

// ── "Back" to a page the browser kept whole (docs/ops.md, section 60) ─────
// A browser keeps the page it leaves as it is (the back-forward cache) and shows it
// again on "back" without loading it: the list is where it was, at the same scroll.
//  - What stopped it here: the sign-in client listens to its other tabs on a
//    BroadcastChannel, and every page that opens says "signed in" on it; Chrome throws
//    a kept page away when a message reaches it. So the channel is closed while the
//    page is kept, and opened again when it is shown.
//  - A kept page is a picture of what one account saw. When it is shown again and that
//    account is no longer the one signed in on this device, nothing of it is shown:
//    the page is hidden and loads again (and then asks who is signed in, as always).
//  - A page that is shown again reads again, quietly (its onFresh), from the server.
function deviceUser() {
  try { return JSON.parse(localStorage.getItem(supabase.auth.storageKey) || 'null')?.user?.id || null; } catch { return null; }
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
    if (lastUser && deviceUser() !== lastUser) {
      document.documentElement.dataset.boot = '';
      document.documentElement.dataset.left = ''; // shell.css: nothing of the page is drawn
      location.reload();
      return;
    }
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

// The sign-in form asks "is this one of the staff" the moment the server says yes to the
// password (warmStaff), together with everything else the page needs; currentStaff() then
// takes that answer instead of asking after the rest.
let staffAsked = null;
export function warmStaff() { staffAsked = supabase.rpc('is_staff').then((answer) => answer, () => ({ data: null, error: new Error('no answer') })); }
export async function currentStaff() {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  if (!session) return null;
  const asked = staffAsked;
  staffAsked = null;
  const { data: ok, error } = await (asked || supabase.rpc('is_staff'));
  if (error) return null;
  return { email: session.user.email, isStaff: ok === true };
}

// The address of the session kept in this browser, with no request (null: nobody is
// signed in here). The page asks for what it needs first with this, at the same time
// as the server confirms the session (docs/ops.md, section 42).
export async function sessionEmail() {
  try { return (await supabase.auth.getSession()).data?.session?.user?.email || null; } catch { return null; }
}
// The account of that session: { id, email }, or null. What a tab keeps for a person
// (the app's frame, the session's data cache) is kept under this id.
export async function sessionUser() {
  try {
    const user = (await supabase.auth.getSession()).data?.session?.user;
    return user?.id ? { id: user.id, email: user.email || null } : null;
  } catch { return null; }
}

// What a page needs first, asked for as soon as its script runs (when someone is signed
// in on this device) instead of after the session is confirmed and the person looked up:
// the same requests, started earlier and side by side. warm() starts one under a name;
// taken() hands it over once (or starts it now when nothing was warmed), so every later
// load asks again. What a person may read is decided by the database either way.
// Nobody was signed in when the page's script ran (the sign-in screen): the same
// requests start the moment the server says yes to the form (warmNow), side by side with
// "who is this", instead of one after the other (docs/ops.md, section 60).
const warmed = new Map();
const unwarmed = new Map();
const begin = (name, start) => {
  if (warmed.has(name)) return;
  const asked = start();
  asked.catch(() => {});
  warmed.set(name, asked);
};
export function warm(name, start) {
  sessionEmail().then((email) => { if (email) begin(name, start); else if (!warmed.has(name)) unwarmed.set(name, start); });
}
export function warmNow() {
  for (const [name, start] of unwarmed) { try { begin(name, start); } catch { /* the page asks again itself */ } }
  unwarmed.clear();
}
export function taken(name, start) {
  const asked = warmed.get(name);
  warmed.set(name, null); // too late to warm it now
  unwarmed.delete(name);
  return asked || start();
}

// staff.person of an address: { person, error }. The page and the app menu both ask
// while a page opens; they share one request (the answer is kept for those few
// seconds only, and a failed lookup is never kept).
const personAsked = new Map();
export function staffPerson(email) {
  const key = String(email || '').toLowerCase();
  const kept = personAsked.get(key);
  if (kept && Date.now() - kept.at < 5000) return kept.answer;
  const answer = (async () => {
    try {
      const { data, error } = await supabase.from('staff').select('person').eq('email', key).maybeSingle();
      if (error) { personAsked.delete(key); return { person: null, error }; }
      return { person: data?.person || null, error: null };
    } catch (error) { personAsked.delete(key); return { person: null, error }; }
  })();
  personAsked.set(key, { at: Date.now(), answer });
  return answer;
}

export const RESET_NEEDS_EMAIL ='הזינו את כתובת האימייל שלכם, ואז לחצו על ״שכחתי סיסמה״.';
export const RESET_SENT = 'אם הכתובת רשומה במערכת, נשלח אליה קישור לבחירת סיסמה חדשה. הקישור תקף לזמן מוגבל.';
export const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
// An email as typed on a Hebrew page or phone keyboard can carry invisible direction
// marks (U+200E/U+200F and the like) and full-width characters; the server then
// refuses it ("invalid format"). Strip them, normalize, and lower-case.
export const cleanEmail = (v) => String(v ?? '')
  .normalize('NFKC')
  .replace(/[­؜​-‏‪-‮⁠-⁩﻿\s]/g, '')
  .toLowerCase();

// Sends a reset link. The link opens the quotes page, which asks for a new password.
// Resolved from this file, so it works from the site root and from payouts/.
// A page that handles the link itself (like the payouts app) passes its own address.
export async function sendPasswordReset(email, redirectTo = new URL('../quotes.html', import.meta.url).href) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

// Reads a sign-in link from the address bar and clears it from there. Two kinds:
//  - A personal link from the team screen (team.html): #type=invite|recovery&token_hash=…
//    Nothing is spent until the person chooses a password (verifyLink), so a
//    WhatsApp link preview that opens the address cannot use it up.
//  - Supabase's own redirect (the reset email): #access_token=…&refresh_token=…&type=…
// Returns { type, tokenHash } | { type: 'recovery', accessToken, refreshToken } | { expired: true } | null.
//
// A pair of tokens in the address is a whole session: whoever opens such an address
// is signed in as its account. So it is accepted only as what Supabase's reset mail
// sends (type=recovery, and the page then asks for a new password), never as a silent
// sign-in of any other type; and no link replaces an account that is already signed
// in on the device without asking (mayUseLink). Security audit of 6.10.2026, ops.md 36.
export const LINK_TYPES = ['invite', 'recovery'];
export function parseAuthLink(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if (!params.has('access_token') && !params.has('token_hash') && !params.has('error')) return null;
  const type = params.get('type');
  if (params.get('token_hash')) return LINK_TYPES.includes(type) ? { type, tokenHash: params.get('token_hash') } : { expired: true };
  if (params.get('access_token') && params.get('refresh_token') && type === 'recovery') {
    return { type, accessToken: params.get('access_token'), refreshToken: params.get('refresh_token') };
  }
  return { expired: true };
}
export function readAuthLink() {
  const link = parseAuthLink(window.location.hash);
  if (link) history.replaceState(null, '', window.location.pathname + window.location.search);
  return link;
}

// The email inside an access token, or null. Read without checking the signature: it
// only tells the person whose link this is; the server decides who is signed in.
export function tokenEmail(jwt) {
  try {
    const part = String(jwt || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
    const email = JSON.parse(new TextDecoder().decode(bytes)).email;
    return typeof email === 'string' && email ? email.toLowerCase() : null;
  } catch { return null; }
}
// What to ask before a link replaces the account that is signed in on this device
// (null: nothing to ask). `current`: the signed-in email, or null.
export function linkQuestion(link, current) {
  const mine = String(current || '').toLowerCase();
  if (!mine || !link || link.expired) return null;
  const theirs = link.accessToken ? tokenEmail(link.accessToken) : null;
  if (theirs && theirs === mine) return null;
  const whose = theirs ? `הקישור שייך לחשבון אחר (${theirs}).` : 'זה קישור כניסה אישי, והוא עשוי להיות של חשבון אחר.';
  return `${whose}\nבמכשיר הזה מחובר כרגע ${mine}.\n\nאישור: לעבור לחשבון של הקישור.\nביטול: להישאר בחשבון המחובר (הקישור לא ינוצל).`;
}
export const LINK_KEPT = 'נשארת בחשבון המחובר. הקישור לא נוצל.';
// May this link be used here? Yes when nobody is signed in, or the link is for the
// same account; otherwise the person chooses.
export async function mayUseLink(link, ask = (text) => window.confirm(text)) {
  let current = null;
  try { current = (await supabase.auth.getSession()).data?.session?.user?.email || null; } catch { /* no session */ }
  const question = linkQuestion(link, current);
  return question ? !!ask(question) : true;
}

// Signs in with a link read by readAuthLink. Returns the error, or null when it worked.
export async function verifyLink(link) {
  const { error } = link.tokenHash
    ? await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type })
    : await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
  return error || null;
}
// A failure to reach the server (worth a retry), not a used or expired link.
export const isOffline = (err) => /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(String(err?.message || err || '')) || err?.name === 'AuthRetryableFetchError';

// Signs in from a reset link (#access_token=…&type=recovery) and clears it from
// the address bar. Returns 'recovery', 'expired', 'kept' (another account is signed
// in and the person chose to stay in it) or null.
export async function consumeRecoveryLink() {
  const link = readAuthLink();
  if (!link) return null;
  if (link.expired || !LINK_TYPES.includes(link.type)) return 'expired';
  if (!(await mayUseLink(link))) return 'kept';
  return (await verifyLink(link)) ? 'expired' : 'recovery';
}

// ── Signing out ──────────────────────────────
// What stays on a shared device after "התנתקות" should not be the last person's:
//  - this device's push subscription (the reminders of that person would keep
//    arriving on it): removed from the database and from the browser;
//  - drafts kept in the browser: unsaved text of the characterization form, the focus
//    call and the scripts (localStorage, "astrateg.<form>.<client>…"), and the quote
//    draft with its prices (sessionStorage "astrateg-draft").
//  - where that person stood (the profile, "תצוגה מלאה", the filters): forgotten by the
//    pages' own sign-out buttons (forgetPlace in app/visit.js; the owner's rule of 9.10.2026).
//    Not from here: this file is also loaded by the client's passwords form (section 36).
// Other preferences of the device stay (the notifications switch, what was seen). Each
// step is best effort and none holds the sign-out for long.
export const DRAFT_PREFIXES = ['astrateg.charform.', 'astrateg.brief.', 'astrateg.scripts.'];
export const SESSION_DRAFTS = ['astrateg-draft'];
export function clearDeviceDrafts(local = globalThis.localStorage, session = globalThis.sessionStorage) {
  try {
    const keys = [];
    for (let i = 0; i < local.length; i += 1) keys.push(local.key(i));
    for (const k of keys) if (DRAFT_PREFIXES.some((p) => String(k).startsWith(p))) local.removeItem(k);
  } catch { /* no storage */ }
  try { for (const k of SESSION_DRAFTS) session.removeItem(k); } catch { /* no storage */ }
}
async function forgetPushDevice() {
  const reg = await navigator.serviceWorker?.getRegistration(new URL('../', import.meta.url).href);
  const sub = await reg?.pushManager?.getSubscription();
  if (!sub) return;
  await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint }).then(() => {}, () => {});
  await sub.unsubscribe().catch(() => {});
}
export async function signOutHere() {
  await Promise.race([forgetPushDevice().catch(() => {}), new Promise((done) => { setTimeout(done, 3000); })]);
  clearDeviceDrafts();
  clearKept(); // what this tab kept of the account's lists, and its menu (docs/ops.md, section 60)
  await supabase.auth.signOut();
  clearKept(); // and whatever an answer on its way put back meanwhile
}

export function quoteLink(token) {
  // The token rides in the fragment (app/link-token.js): it reaches no log of the host.
  return `${new URL('q.html', window.location.href).href}#t=${encodeURIComponent(token)}`;
}

// Human-readable Hebrew message for common failures.
export function explainError(err) {
  const msg = String(err?.message || err || '');
  if (/Invalid login credentials/i.test(msg)) return 'האימייל או הסיסמה שגויים.';
  if (/rate limit|security purposes|only request this/i.test(msg)) return 'נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות.';
  if (/Email not confirmed/i.test(msg)) return 'יש לאשר את כתובת האימייל לפני הכניסה.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.';
  if (/not staff/i.test(msg)) return 'המשתמש מחובר אך אינו מורשה ליצור הצעות. יש לבקש הרשאה ממנהל המערכת.';
  if (/not signed in/i.test(msg)) return 'יש להתחבר מחדש.';
  if (/client name required/i.test(msg)) return 'חסר שם לקוח.';
  return 'הפעולה לא הושלמה. נסו שוב בעוד רגע.';
}
