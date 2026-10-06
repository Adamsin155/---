// "קוד הכספת" (the owner's decision of 6.10.2026; docs/ops.md, section 28) as pure
// logic: one shared code of exactly 6 digits that opens the passwords of the access
// vault. The owner sets it on the team page; whoever has the vault flag types it once
// and may see passwords for 10 minutes; 5 wrong codes lock that user for 15 minutes.
// Everything is decided in the database (supabase/migrations/
// 20261008100100_vault_code.sql): here are only the same checks before a code is
// sent, and the words. No DOM, no network.
export const CODE_LENGTH = 6;
export const UNLOCK_MINUTES = 10;
export const MAX_WRONG = 5;
export const LOCKOUT_MINUTES = 15;

export const isCode = (v) => /^[0-9]{6}$/.test(String(v ?? ''));
// One digit six times, or a run going up or down by one (wrapping 9→0): 000000,
// 123456, 654321, 012345, 890123. The same rule as private.vault_code_weak().
export function weakCode(v) {
  const s = String(v ?? '');
  if (!isCode(s)) return true;
  const d = [...s].map(Number);
  const all = (f) => d.slice(1).every((x, i) => f(d[i], x));
  return all((a, b) => b === a) || all((a, b) => b === (a + 1) % 10) || all((a, b) => b === (a + 9) % 10);
}
// What is wrong with a new code the owner typed (null: it may be saved).
export function newCodeProblem(code, again) {
  const s = String(code ?? '');
  if (!s) return 'הקלידו קוד של 6 ספרות.';
  if (!isCode(s)) return 'הקוד הוא בדיוק 6 ספרות.';
  if (weakCode(s)) return 'הקוד קל מדי לניחוש (אותה ספרה, או רצף כמו 123456). בחרו קוד אחר.';
  if (again !== undefined && String(again ?? '') !== s) return 'שני הקודים לא זהים.';
  return null;
}

const pad = (n) => String(n).padStart(2, '0');
// "09:59" until a moment (never below 00:00).
export function leftText(until, now = new Date()) {
  const s = Math.max(0, Math.ceil((new Date(until) - now) / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
export const isOpen = (status, now = new Date()) => !status?.set || (!!status.openUntil && new Date(status.openUntil) > now);
export const openText = (until, now = new Date()) => `הכספת פתוחה עוד ${leftText(until, now)}`;
const minutesLeft = (until, now) => Math.max(1, Math.ceil((new Date(until) - now) / 60e3));
// What the dialog says after the database answered ({ state, left, until }).
export function unlockMessage(res, now = new Date()) {
  if (res?.state === 'wrong') return `קוד שגוי. ${res.left === 1 ? 'נותר ניסיון אחד' : `נותרו ${res.left} ניסיונות`}.`;
  if (res?.state === 'locked') {
    const m = minutesLeft(res.until, now);
    return m >= LOCKOUT_MINUTES ? `ננעל ל־${LOCKOUT_MINUTES} דקות אחרי ${MAX_WRONG} קודים שגויים.` : `ננעל. אפשר לנסות שוב בעוד ${m === 1 ? 'דקה' : `${m} דקות`}.`;
  }
  return 'הקוד לא נבדק. נסו שוב.';
}
// The owner's card: whether a code exists and when it was last changed. Never the code.
export function codeStateText(status, dateWords) {
  if (!status?.set) return 'עוד לא הוגדר קוד. הכספת עובדת כמו עד היום: מי שמסומנת לו ״כספת״ רואה סיסמאות בלי קוד.';
  return `הוגדר קוד. שונה לאחרונה ב־${dateWords(status.changedAt)}.`;
}
// The database's refusal of a new code, in the owner's words.
export function setError(err) {
  const msg = String(err?.message || err || '');
  if (/weak code/.test(msg)) return 'הקוד קל מדי לניחוש. בחרו קוד אחר.';
  if (/6 digits/.test(msg)) return 'הקוד הוא בדיוק 6 ספרות.';
  if (/owner only|not allowed/.test(msg)) return 'רק בעל המשרד מגדיר את קוד הכספת.';
  return 'הקוד לא נשמר. נסו שוב.';
}
export const LOG_WORDS = { set: 'הגדיר/ה קוד', changed: 'החליף/ה את הקוד', unlocked: 'פתח/ה את הכספת', wrong: 'הקליד/ה קוד שגוי', lockout: 'ננעל/ה ל־15 דקות', locked: 'נעל/ה את הכספת' };
