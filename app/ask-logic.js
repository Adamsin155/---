// "שאלו את המערכת" (the owner's request of 29.10.2026; docs/ops.md, section 75): a chat box where
// everyone on the staff asks about anything in the system ("כמה לקוחות פעילים יש?", "כמה
// סרטונים מגיע ל<לקוח> החודש?", "מה עלה לדרייב של <לקוח>?") and the ask edge function answers
// with Claude, reading the database as the person who asked (their own rights, RLS) through a
// small set of read-only tools (supabase/functions/ask/tools.js). This module is the plain part
// that the page (ask.html, app/ask-page.js) and the function share (a copy runs on the server:
// supabase/functions/_shared/app/, node scripts/sync-functions.mjs):
//   who may ask   every staff member (the owners, a staff row with no person, and every person:
//                 the office, Ilai, the editors, Eli and the field sales; "תוסיף כבר לכולם וזהו",
//                 29.10.2026), each reading with their own rights; nobody who is not staff. The
//                 function decides (public.is_office() and public.my_person()); the menu only
//                 follows;
//   how-to        "איפה…" / "איך…" about the asker's own screens: app/ask-guide.js;
//   the words     the question and the short history the page sends, cleaned and capped;
//   the errors    the function's short codes, in plain Hebrew for the page.
// Never passwords: no tool reads the vault or the clients' logins (public.client_access and
// everything around it), not even their statuses. Money (prices, quote amounts, income) only for
// the two owners, as everywhere in the app (public.sees_money(), seesFinance in manager-rules.js).
import { isOwnerView } from './team-rules.js';
import { PEOPLE } from './protocol.js';

// Who asks besides the owners: first "לאופיר, אדם, ליאור ועידן", then Irit and Ilai, and on the
// same day (29.10.2026) "תוסיף כבר לכולם וזהו": every person of the staff. The generic 'editor'
// account is not a person (viewerOf() gives it no `me`), so it does not ask.
export const ASK_PEOPLE = Object.keys(PEOPLE).filter((k) => k !== 'editor');
const known = (v) => !!v && !v.error;
// The menu and the page (viewerOf() in protocol-ui.js).
export const canAsk = (v) => isOwnerView(v) || (known(v) && ASK_PEOPLE.includes(v.me));
// The function: { office } from public.is_office(), { person } from public.my_person() (null
// for an owner, and for anyone who is not staff). Anything unclear is a no.
export const mayAsk = ({ office, person } = {}) => (office === true && person === null)
  || (typeof person === 'string' && ASK_PEOPLE.includes(person));

// The longest question, and how much of the conversation goes back with a new one.
export const QUESTION_MAX = 500;
export const HISTORY_TURNS = 4;
export const HISTORY_TEXT_MAX = 1200;

const BIDI = /[‎‏‪-‮⁦-⁩]/g;
const clean = (v, max) => String(v ?? '').replace(BIDI, '').replace(/\r\n?/g, '\n').trim().slice(0, max);

// The question: { text } or { error: 'question_required' | 'question_too_long' }.
export function cleanQuestion(v) {
  if (typeof v !== 'string') return { error: 'question_required' };
  const text = v.replace(BIDI, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { error: 'question_required' };
  if (text.length > QUESTION_MAX) return { error: 'question_too_long' };
  return { text };
}
// The conversation so far, as the page keeps it: [{ q, a }], the last HISTORY_TURNS only, each
// text capped. Anything else is dropped quietly (an old page, a changed shape).
export function cleanHistory(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((t) => t && typeof t.q === 'string' && typeof t.a === 'string' && t.q.trim() && t.a.trim())
    .slice(-HISTORY_TURNS)
    .map((t) => ({ q: clean(t.q, QUESTION_MAX), a: clean(t.a, HISTORY_TEXT_MAX) }));
}

// The chips under the box: tapping one puts its words in the box (a "<לקוח>" is left for the
// person to fill, with the cursor on it).
export const CLIENT_SLOT = '<לקוח>';
export const EXAMPLES = [
  'כמה לקוחות פעילים יש?',
  `כמה סרטונים מגיע ל${CLIENT_SLOT} החודש?`,
  `מה עלה לדרייב של ${CLIENT_SLOT}?`,
  'מה ימי הצילום השבוע?',
  'אילו משימות באיחור?',
];
// Where the slot starts and ends in a chip's words, for the selection: [start, end] or null.
export function slotRange(text) {
  const i = String(text).indexOf(CLIENT_SLOT);
  return i < 0 ? null : [i, i + CLIENT_SLOT.length];
}

// The function's answers that are not an answer, in the page's words.
export const ERRORS = {
  ai_not_configured: 'החיבור ל־AI עוד לא הוגדר. אחרי שהבעלים יוסיף את המפתח, זה יעבוד.',
  ai_timeout: 'לקח יותר מדי זמן. נסו שוב, אולי בשאלה קצרה יותר.',
  ai_busy: 'יש עומס כרגע. נסו שוב בעוד דקה.',
  ai_unreachable: 'אין חיבור לשירות ה־AI כרגע. נסו שוב בעוד רגע.',
  ai_refused: 'על השאלה הזאת אין לי תשובה. נסו לנסח אחרת.',
  ai_failed: 'משהו השתבש בתשובה. נסו שוב.',
  ai_incomplete: 'התשובה יצאה ארוכה מדי. נסו לשאול על משהו מצומצם יותר.',
  rate_limited: 'הרבה שאלות בדקה האחרונה. חכו רגע ונסו שוב.',
  question_required: 'כתבו שאלה ואז ״שאלו״.',
  question_too_long: `שאלה עד ${QUESTION_MAX} תווים.`,
  not_allowed: 'השאלות פתוחות לצוות המשרד בלבד.',
  not_signed_in: 'צריך להתחבר מחדש.',
};
export const errorWords = (code) => ERRORS[code] || ERRORS.ai_failed;
