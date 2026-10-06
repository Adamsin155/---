// Astrateg Payment's own Supabase client. It keeps its session under its own
// storage key, so signing in or out of the quote builder never signs anyone
// in or out of this app (and the other way round). Access to the data is
// enforced by row level security (payout_owners), not by this file.
import { createClient } from '../vendor/supabase.js';

const SUPABASE_URL = 'https://czncjzziqrqtezpwxxpz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kf4V_lkjM658wkDiPVukWA_HoB5AH_e';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'astrateg-payment-auth',
  },
});

export const RESET_NEEDS_EMAIL = 'הזינו את כתובת האימייל שלכם, ואז לחצו על ״שכחתי סיסמה״.';
export const RESET_SENT = 'אם הכתובת רשומה במערכת, נשלח אליה קישור לבחירת סיסמה חדשה. הקישור תקף לזמן מוגבל.';
export const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
// Invisible direction marks from a Hebrew keyboard make the server refuse the address.
export const cleanEmail = (v) => String(v ?? '')
  .normalize('NFKC')
  .replace(/[\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\s]/g, '')
  .toLowerCase();

// The reset link comes back to this app, which asks for the new password.
export async function sendPasswordReset(email, redirectTo) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

// The email inside an access token, or null (unverified: only to tell whose link this is).
export function tokenEmail(jwt) {
  try {
    const part = String(jwt || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
    const email = JSON.parse(new TextDecoder().decode(bytes)).email;
    return typeof email === 'string' && email ? email.toLowerCase() : null;
  } catch { return null; }
}
// What to ask before a reset link replaces the account signed in here (null: nothing).
// The same rule as linkQuestion in app/supa.js (security audit of 6.10.2026, ops.md 36).
export function linkQuestion(accessToken, current) {
  const mine = String(current || '').toLowerCase();
  if (!mine) return null;
  const theirs = tokenEmail(accessToken);
  if (theirs && theirs === mine) return null;
  const whose = theirs ? `הקישור שייך לחשבון אחר (${theirs}).` : 'זה קישור כניסה אישי, והוא עשוי להיות של חשבון אחר.';
  return `${whose}\nבמכשיר הזה מחובר כרגע ${mine}.\n\nאישור: לעבור לחשבון של הקישור.\nביטול: להישאר בחשבון המחובר (הקישור לא ינוצל).`;
}

// Signs in from a reset link (#access_token=…&type=recovery) and clears it
// from the address bar. Returns 'recovery', 'expired', 'kept' (another account is
// signed in here and the person chose to stay in it) or null.
export async function consumeRecoveryLink(ask = (text) => window.confirm(text)) {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!params.has('access_token') && !params.has('error')) return null;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (params.get('type') !== 'recovery' || !params.get('refresh_token')) return 'expired';
  let current = null;
  try { current = (await supabase.auth.getSession()).data?.session?.user?.email || null; } catch { /* no session */ }
  const question = linkQuestion(params.get('access_token'), current);
  if (question && !ask(question)) return 'kept';
  const { error } = await supabase.auth.setSession({
    access_token: params.get('access_token'),
    refresh_token: params.get('refresh_token'),
  });
  return error ? 'expired' : 'recovery';
}

// Builds DOM nodes; user text always goes into text nodes, never HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
