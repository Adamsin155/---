// generated — edit app/ instead. Source: app/wa-logic.js. Regenerate: node scripts/sync-functions.mjs
// The staff WhatsApp channel's decisions (stage 4), pure so node tests them: who
// gets WhatsApp copies (waRecipients), whether one reminder goes out on WhatsApp
// now and with which template (waPlan), what a button reply does (replyPlan), the
// words that stop the messages ("הסר"), and the short answers the webhook sends
// back. The reminders function and the whatsapp-webhook function run these
// (copies in supabase/functions/_shared/app, made by scripts/sync-functions.mjs).
import { inSendHours, personName, OWNER } from './reminder-rules.js';
import { PROCESSES } from './protocol.js';
import { ownersOf, roundsOf, roundContext } from './protocol-logic.js';
import { TEMPLATES, templateFor, taskIdOf, simpleTask, TASK_RULES } from './wa-templates.js';

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
export function waPlan({ row, kind, now, recipient, task = null }) {
  if (kind !== 'ring' && kind !== 'digest') return { skip: 'kind' };
  if (kind === 'ring' && row.level !== 'ring' && row.level !== 'quiet') return { skip: 'kind' };
  if (kind === 'digest' && row.rule !== 'digest') return { skip: 'kind' };
  if (!recipient) return { skip: 'no_consent' };
  if (!inSendHours(now)) return { skip: 'quiet_hours' };
  return { template: templateFor(row, task), to: recipient.phone };
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
