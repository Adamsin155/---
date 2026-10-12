// generated — edit app/ instead. Source: app/wa-logic.js. Regenerate: node scripts/sync-functions.mjs
// The staff WhatsApp channel's decisions (stage 4), pure so node tests them: who
// gets WhatsApp copies (waRecipients), whether one reminder goes out on WhatsApp
// now and with which template (waPlan), what a button reply does (replyPlan), the
// words that stop the messages ("הסר"), and the short answers the webhook sends
// back. The reminders function and the whatsapp-webhook function run these
// (copies in supabase/functions/_shared/app, made by scripts/sync-functions.mjs).
import { inSendHours, personName, OWNER, NAG } from './reminder-rules.js';
import { PROCESSES } from './protocol.js';
import { ownersOf, roundsOf, roundContext } from './protocol-logic.js';
import { TEMPLATES, JAKO_TEMPLATES, JAKO_BUTTONS, templateFor, taskIdOf, caseOfKey, simpleTask, TASK_RULES } from './wa-templates.js';

// An Israeli mobile number as the database keeps it (972 5X XXX XXXX).
export const WA_PHONE = /^9725\d{8}$/;

// Who gets WhatsApp copies, from public.whatsapp_recipients(): { person → { email,
// phone } }. Only people who agreed, and only while the number is the one they
// agreed to: the office changing someone's number (staff.phone) stops the messages
// until that person agrees again for the new number. The owner keeps no number on
// the staff list; theirs is the one on their own consent.
export function waRecipients(rows = []) {
  const out = new Map();
  for (const r of rows) {
    if (r.status !== 'granted' || !WA_PHONE.test(r.consent_phone || '')) continue;
    if (r.person !== OWNER && r.staff_phone !== r.consent_phone) continue;
    if (!out.has(r.person)) out.set(r.person, { email: String(r.email).toLowerCase(), phone: r.consent_phone });
  }
  return out;
}

// Whether a log row the tick is sending goes out on WhatsApp too, now: a ring, an
// update (level 'quiet': since the owner's rule of 7.10.2026 it is pushed like a
// ring, so it is copied like one, with the templates rings already use) or a digest
// (a batch of lateness notes is one; never a test), within the sending hours only
// (the consent says Sunday–Thursday 08:30–19:00, erev chag until 13:00: a shoot-day
// ring outside them goes by push alone), to someone who agreed. The sending hours and
// the dedupe of the push channel already chose the rows; WhatsApp adds none.
// → { template, to } or { skip: reason }.
// `pick`: which template a row takes; Meta's nine by default, Jako's three with
// jakoTemplateFor (the choice of rows is the same for both).
export function waPlan({ row, kind, now, recipient, task = null, pick = templateFor }) {
  if (kind !== 'ring' && kind !== 'digest') return { skip: 'kind' };
  if (kind === 'ring' && row.level !== 'ring' && row.level !== 'quiet') return { skip: 'kind' };
  if (kind === 'digest' && row.rule !== 'digest') return { skip: 'kind' };
  if (!recipient) return { skip: 'no_consent' };
  if (!inSendHours(now)) return { skip: 'quiet_hours' };
  return { template: pick(row, task), to: recipient.phone };
}

// ── Replies ───────────────────────────────
// Whether `person` owns the process of a log row's ref ('p22', 'r2.p11') for this
// client (`client`: its row, for the processes whose owner is the client's editor,
// or the round's): only an owner may say "אני על זה" on it, as in the app.
export function ownsProcess(ref, person, client = null) {
  const m = /^(?:r(\d+)\.)?(p\d+[ab]?)$/.exec(String(ref || ''));
  const proc = m && PROCESSES.find((p) => p.id === m[2]);
  if (!proc) return false;
  if (typeof proc.owners !== 'function') return (proc.owners || []).includes(person);
  if (!client) return false;
  const round = m[1] ? roundsOf(client).find((r) => String(r.n) === m[1]) : null;
  if (m[1] && !round) return false;
  return ownersOf(proc, round ? roundContext(client, round) : client).includes(person);
}
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// What a button does, for the reminder it answers. `log`: its reminder_log row;
// `message`: its whatsapp_messages row (the template it went out with); `task`:
// the task of a task rule (client_tasks); `client`: the client of a process
// reminder. → a plan for public.whatsapp_apply.
export function replyPlan({ action, log, message, task = null, client = null }) {
  if (!log || !message) return { op: 'none', why: 'unknown' };
  const t = TEMPLATES[message.template];
  // Only a button the message had (approvals and quality control have none).
  if (!t || !t.replies.includes(action)) return { op: 'none', why: 'no_button' };
  return planOf({ action, log, task, client });
}
// What a button does to the item its reminder is about (the same for both providers).
function planOf({ action, log, task, client }) {
  const person = log.person;
  const taskId = taskIdOf(log);
  if (action === 'onit') {
    if (TASK_RULES.has(log.rule)) {
      return task && task.id === taskId && task.owner === person && !task.done_at ? { op: 'task_start', task: task.id } : { op: 'none', why: 'not_owner' };
    }
    if (log.ref && log.client_id) return ownsProcess(log.ref, person, client) ? { op: 'claim', item: `${log.ref}.claim` } : { op: 'none', why: 'not_owner' };
    return { op: 'none', why: 'no_target' };
  }
  if (action === 'help') {
    if (!log.client_id) return { op: 'none', why: 'no_client' };
    return { op: 'help', title: clip(`צריך עזרה (${personName(person)}): ${log.title}`, 500) };
  }
  if (action === 'done') {
    const ok = task && task.id === taskId && task.owner === person && !task.done_at && simpleTask(task);
    return ok ? { op: 'task_done', task: task.id } : { op: 'none', why: 'not_simple' };
  }
  return { op: 'none', why: 'no_button' };
}

// ── Replies through Jako ───────────────────
// With Jako a button does not come back with its message: a sub flow in Jako calls
// our endpoint with who pressed and which button (docs/ops.md, section 63). The
// owner's rule of 13.10.2026: a reply counts for the task of the LAST message sent to
// that person that had that button (jakoReply in the whatsapp-webhook function), and
// the answer names the task, so a press on an older message is seen at once.
export const MINE_LINK = 'https://app.astrateg.tech/clients.html#mine';

// The number a sub flow sends, as the database keeps numbers: digits only, a leading
// 0 as 972 (050… → 97250…). null when it is not a number.
export function hookPhone(value) {
  let s = String(value ?? '').replace(/\D/g, '');
  if (/^0\d{8,10}$/.test(s)) s = `972${s.slice(1)}`;
  return /^\d{8,15}$/.test(s) ? s : null;
}
// The button: 'done' | 'onit', as the word or as the text on the button.
export function hookAction(value) {
  const s = String(value ?? '').trim();
  if (s === 'done' || s === 'onit') return s;
  return Object.entries(JAKO_BUTTONS).find(([, text]) => text === s)?.[0] || null;
}

// The nagging task of a `nag` reminder (public.staff_tasks.id).
export const nagIdOf = (log) => (log?.rule === NAG ? caseOfKey(log.key) : null);

// Whether the item of a message is still open (not done, not cancelled). `task`: its
// client task; `nag`: its nagging task. A process reminder stays open for "אני על זה".
export function jakoOpen({ action, log, task = null, nag = null }) {
  if (log.rule === NAG) return !!nag && nag.status === 'open' && nag.assignee === log.person;
  if (TASK_RULES.has(log.rule)) return !!task && !task.done_at;
  return action === 'onit';
}
// The task's name in the answer: the nagging task's own words, else the reminder's title.
export const jakoTitle = ({ log, nag = null }) => clip(String(nag?.body || log?.title || 'המשימה').replace(/\s+/g, ' ').trim(), 80);

// What the button does to that item. → a plan for public.whatsapp_jako_reply.
//   "המשימה בוצעה" closes only what a reply may close: a nagging task (by its assignee)
//   or a simple task; anything else is marked in the app.
//   "אני על זה" records what the app's own "אני על זה" records for that kind of item,
//   and nothing more: a nagging task has no such state (it is acknowledged and keeps
//   ringing until "בוצע"), a process keeps its reminders as after a claim in the app.
export function jakoReplyPlan({ action, log, message, task = null, client = null, nag = null }) {
  if (!log || !message) return { op: 'none', why: 'unknown' };
  if (!JAKO_TEMPLATES[message.template]?.replies.includes(action)) return { op: 'none', why: 'no_button' };
  if (log.rule === NAG) {
    if (action === 'onit') return { op: 'none', why: 'noted' };
    return nag && nag.status === 'open' && nag.assignee === log.person ? { op: 'nag_done', task: nag.id } : { op: 'none', why: 'not_open' };
  }
  return planOf({ action, log, task, client });
}

// The sentence the sub flow sends back to the person: it names the task it acted on
// (`title`), in words that suit everyone. → { ok, text }.
export function hookAnswer(result, title = '') {
  const t = title ? `: ${title}` : '';
  switch (result) {
    case 'done': return { ok: true, text: `סומן בוצע${t}. אם זו לא המשימה הנכונה, אפשר לבטל במערכת.` };
    case 'started': case 'claimed': case 'noted': return { ok: true, text: `קיבלתי, נרשם ״אני על זה״${t}. התזכורות ימשיכו עד שיסומן בוצע.` };
    case 'unchanged': return { ok: true, text: `כבר רשום במערכת${t}.` };
    case 'duplicate': return { ok: true, text: 'כבר סומן.' };
    case 'taken': return { ok: false, text: `מישהו אחר כבר לקח את זה${t}. הפרטים במערכת.` };
    case 'closed': return { ok: false, text: 'המשימה הזאת כבר סגורה.' };
    case 'nothing': return { ok: false, text: `לא מצאתי משימה פתוחה. אפשר לסמן במערכת: ${MINE_LINK}` };
    case 'bad': return { ok: false, text: `לא הצלחתי להבין את התשובה. אפשר לסמן במערכת: ${MINE_LINK}` };
    case 'error': return { ok: false, text: `לא נרשם כרגע. אפשר לסמן במערכת: ${MINE_LINK}` };
    // Not something a reply may close (a task with a brief, an approval, a process): marked in the app.
    default: return { ok: false, text: `את זה מסמנים במערכת${t}: ${MINE_LINK}` };
  }
}

// "הסר" and friends (the legal draft: "הסר", "הסירו", "עצור", STOP) stop the messages.
const STOP = new Set(['הסר', 'הסירו', 'הסרה', 'עצור', 'stop', 'unsubscribe']);
export const isStop = (text) => STOP.has(String(text || '').trim().toLowerCase().replace(/[\s.!״"'׳]+/g, ''));

// The short answer after a reply (sent as text: the person just wrote, so Meta's
// 24-hour window is open). None for a reply that was already handled.
export function ackText(result) {
  switch (result) {
    case 'started': return 'נרשם ״אני על זה״. בהצלחה.';
    case 'claimed': return 'נרשם ״אני על זה״: התהליך אצלך.';
    case 'taken': return 'מישהו אחר כבר לקח את זה. הפרטים במערכת.';
    case 'done': return 'נרשם ״בוצע״. תודה.';
    case 'help': return 'נרשם. ליאור יקבל את הבקשה לעזרה ברשימה הבאה שלו.';
    case 'withdrawn': return 'הודעות העבודה ב־WhatsApp הופסקו. ההתראות באפליקציה ממשיכות. אפשר להפעיל שוב ב״המשימות שלי״.';
    case 'duplicate': case 'not_found': return null;
    default: return 'לא נרשם שינוי. להמשך, פתחו את המערכת.';
  }
}
