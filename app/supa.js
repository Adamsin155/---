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

export function quoteLink(token) {
  return new URL(`q.html?t=${encodeURIComponent(token)}`, window.location.href).href;
}

// Human-readable Hebrew message for common failures.
export function explainError(err) {
  const msg = String(err?.message || err || '');
  if (/Invalid login credentials/i.test(msg)) return 'האימייל או הסיסמה שגויים.';
  if (/Email not confirmed/i.test(msg)) return 'יש לאשר את כתובת האימייל לפני הכניסה.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.';
  if (/not staff/i.test(msg)) return 'המשתמש מחובר אך אינו מורשה ליצור הצעות. יש לבקש הרשאה ממנהל המערכת.';
  if (/not signed in/i.test(msg)) return 'יש להתחבר מחדש.';
  if (/client name required/i.test(msg)) return 'חסר שם לקוח.';
  return 'הפעולה לא הושלמה. נסו שוב בעוד רגע.';
}
