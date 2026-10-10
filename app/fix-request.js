// "הלקוח ביקש תיקון", written down by the office (protocol v10; docs/ops.md, section 58).
// Until now only a fix the client wrote on the status page opened a task with a deadline;
// a fix asked for on WhatsApp or in a call hung on Irit's memory. Next to every approval
// of the client that Irit follows there is one action, "הלקוח ביקש תיקון": what the client
// asked (required), and the database opens exactly the task the status page opens
// (public.staff_request_fix and public.request_fix call one function: to the same person,
// with the same deadline rule, and so with the same reminders: the rule `clientFix` in
// app/status-rules.js, `clientFixes` for the videos' first notes).
// Pure: no DOM, no network. The dialog is app/fix-request-ui.js.
import { FIX_CUTOFF_HOUR } from './protocol-logic.js';

// The approvals the action stands next to, each with the mark that says the work was sent.
// (The scripts' approval is Lior's own, and he is the one who fixes them.)
export const FIX_APPROVALS = {
  'p07.approved': { sent: 'p07.sent', what: '9 הגרפיקות הראשונות', item: 'graphics9' },
  'p23.approved': { sent: 'p23.sent', what: 'יתרת הגרפיקות', item: 'graphics' },
  'p27.approved': { sent: 'p26.sent', what: 'הסרטונים', item: 'videos', notes: 'p27.notes', fixed: ['p27.fixes', 'p27.final'] },
};
const baseKey = (key) => String(key || '').replace(/^r\d+\./, '');
const preOf = (key) => String(key || '').slice(0, String(key || '').length - baseKey(key).length);
export const fixSpecOf = (key) => FIX_APPROVALS[baseKey(key)] || null;
export const FIX_ACTION = 'הלקוח ביקש תיקון';
export const NOTE_MIN = 2;
export const NOTE_MAX = 4000;

// Who may write a client's request down: whoever follows the client's approvals (the
// database decides the same: the owner, Irit, Lior, Ofir).
export const mayRecordFix = (viewer) => !!viewer && !viewer.error && viewer.scope === 'office' && (viewer.me === null || ['irit', 'lior', 'ofir'].includes(viewer.me));

// Whether the item waits for the client's answer now, as the database reads it
// (private.status_items: 'waiting'): it was sent, it is not approved, and no fix is under
// way (an open fix task; for the videos, notes that are still being fixed).
export function awaitsClient(key, checks = {}, tasks = [], clientId = null) {
  const spec = fixSpecOf(key);
  if (!spec) return false;
  const pre = preOf(key);
  const done = (k) => checks[`${pre}${k}`]?.state === 'done';
  const settled = (k) => ['done', 'na'].includes(checks[`${pre}${k}`]?.state);
  if (!done(spec.sent) || settled(baseKey(key))) return false;
  if ((tasks || []).some((t) => t.source === 'client_fix' && !t.done_at && (!clientId || t.client_id === clientId) && t.brief?.item_key === key)) return false;
  if (spec.notes && done(spec.notes) && !(settled('p27.fixes') || done('p27.final'))) return false;
  return true;
}

// The text, checked before it is sent (the database checks again).
export function validateFix(text) {
  const note = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (note.length < NOTE_MIN) return { ok: false, error: 'כותבים מה הלקוח ביקש לתקן.', note };
  if (note.length > NOTE_MAX) return { ok: false, error: `עד ${NOTE_MAX} תווים (עכשיו ${note.length}).`, note };
  return { ok: true, error: null, note };
}

// When the fix is due, in words, for the dialog: the rule the database applies
// (private.client_fix_open): asked by 13:00 on a working day, that same day; later, or
// on Friday and Saturday, the next working day. (Holidays are counted by the reminders.)
export const FIX_RULE_TEXT = `בקשה שנרשמת עד ${FIX_CUTOFF_HOUR}:00 מתוקנת באותו יום; אחרי ${FIX_CUTOFF_HOUR}:00, עד סוף יום העסקים הבא.`;
