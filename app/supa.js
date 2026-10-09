// Supabase connection. The publishable key is safe to ship in the browser:
// access is enforced by row level security and the create-quote function.
import { createClient } from './vendor/supabase.js';

import { forgetPlace } from './visit.js';
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
async function countedFetch(input, init) {
  inFlight += 1;
  let open = true;
  const close = () => { if (!open) return; open = false; nextTurn().then(settle); };
  try {
    const res = await fetch(input, init);
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
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

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: countedFetch },
});

export async function currentStaff() {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  if (!session) return null;
  const { data: ok, error } = await supabase.rpc('is_staff');
  if (error) return null;
  return { email: session.user.email, isStaff: ok === true };
}

// The address of the session kept in this browser, with no request (null: nobody is
// signed in here). The page asks for what it needs first with this, at the same time
// as the server confirms the session (docs/ops.md, section 42).
export async function sessionEmail() {
  try { return (await supabase.auth.getSession()).data?.session?.user?.email || null; } catch { return null; }
}

// What a page needs first, asked for as soon as its script runs (when someone is signed
// in on this device) instead of after the session is confirmed and the person looked up:
// the same requests, started earlier and side by side. warm() starts one under a name;
// taken() hands it over once (or starts it now when nothing was warmed), so every later
// load asks again. What a person may read is decided by the database either way.
const warmed = new Map();
export function warm(name, start) {
  sessionEmail().then((email) => {
    if (!email || warmed.has(name)) return;
    const asked = start();
    asked.catch(() => {});
    warmed.set(name, asked);
  });
}
export function taken(name, start) {
  const asked = warmed.get(name);
  warmed.set(name, null); // too late to warm it now
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
//  - where that person stood: the profile ("מבט מנהל"), "תצוגה מלאה", the filters, and
//    the visit's claim on this page (app/visit.js; the owner's rule of 9.10.2026).
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
  forgetPlace(); // the profile, the view and the filters of whoever signs out (app/visit.js)
  await supabase.auth.signOut();
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
