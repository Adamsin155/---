// Supabase connection. The publishable key is safe to ship in the browser:
// access is enforced by row level security and the create-quote function.
import { createClient } from './vendor/supabase.js';

export const SUPABASE_URL = 'https://czncjzziqrqtezpwxxpz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_kf4V_lkjM658wkDiPVukWA_HoB5AH_e';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export async function currentStaff() {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  if (!session) return null;
  const { data: ok, error } = await supabase.rpc('is_staff');
  if (error) return null;
  return { email: session.user.email, isStaff: ok === true };
}

export const RESET_NEEDS_EMAIL = 'הזינו את כתובת האימייל שלכם, ואז לחצו על ״שכחתי סיסמה״.';
export const RESET_SENT = 'אם הכתובת רשומה במערכת, נשלח אליה קישור לבחירת סיסמה חדשה. הקישור תקף לזמן מוגבל.';
export const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

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
// Returns { type, tokenHash } | { type, accessToken, refreshToken } | { expired: true } | null.
export const LINK_TYPES = ['invite', 'recovery'];
export function readAuthLink() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!params.has('access_token') && !params.has('token_hash') && !params.has('error')) return null;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  const type = params.get('type');
  if (params.get('token_hash')) return LINK_TYPES.includes(type) ? { type, tokenHash: params.get('token_hash') } : { expired: true };
  if (params.get('access_token') && params.get('refresh_token')) {
    return { type, accessToken: params.get('access_token'), refreshToken: params.get('refresh_token') };
  }
  return { expired: true };
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
// the address bar. Returns 'recovery', 'expired' or null.
export async function consumeRecoveryLink() {
  const link = readAuthLink();
  if (!link) return null;
  if (link.expired || !LINK_TYPES.includes(link.type)) return 'expired';
  return (await verifyLink(link)) ? 'expired' : 'recovery';
}

export function quoteLink(token) {
  return new URL(`q.html?t=${encodeURIComponent(token)}`, window.location.href).href;
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
