// "המשימות שלי" is the one place where a person sees everything that waits for them,
// whichever page it is done on (the owner's rule of 8.10.2026; docs/ops.md, section 46).
// Most work is a protocol item and is a card of the list already. What is not an item
// (a queue of another page), and the work on the clients that are still in landing
// (which the list leaves out: no clock, section 41), is one counted line here: what
// waits, how many, and a link straight to the place it is done in.
//
// Pure, no DOM and no network: app/clients.js draws the lines, and the unit tests
// (tests/mine-flow.test.mjs) and the browser suite (tests/all-in-mine-e2e.mjs) read the
// same answers. Each queue is counted with the function its own page counts with, so
// the number here and the number there cannot differ.
//
// A line: { id, bucket, n, text, cta, href, rule }.
//   bucket  where it sits in the list: 'urgent', 'escalation', 'overdue', 'today',
//           'tomorrow', 'week', 'later' (the groups of the list), or 'landing': a client
//           from the old system, no clock and no colour, next to the landing line;
//   href    a page this person may open (app/shell-rules.js menuOf), never another;
//   rule    the reminder rule that nags when it is not done (app/reminder-rules.js),
//           or null: nothing reminds of it (a client in landing sends no reminders).
// A queue with nothing in it gives no line.
import { PEOPLE } from './protocol.js';
import { inLanding, isBusinessDay } from './protocol-logic.js';
import { qaQueue, awaitingEditor } from './qa-logic.js';
import { ofirMeetings } from './office-marks.js';
import { pausedSinceYesterday, campaignCheck, urgentState } from './decisions-logic.js';
import { editingCases, editorState } from './production.js';
import { shootSoon, SHOOT_SOON_DAYS } from './landing-logic.js';
import {
  askOf, monthRow, monthName, missingForManagers, PHOTOGRAPHERS, MANAGERS as AVAILABILITY_MANAGERS, DEADLINE_DAY, AVAILABILITY_URL, OFFICE_URL,
} from './availability-logic.js';
import { dayKeyIL, daysBetweenIL } from './tz.js';
import { unsignedLine, UNSIGNED_URL } from './unsigned-logic.js';
import { followupRows, followupDue, followupLine, FOLLOWUP_URL } from './shoot-prep.js';
import { QUOTE_LIST_VIEWERS } from './manager-rules.js';

// The words every line of a client in landing ends with.
export const LANDING_WORDS = 'בקליטה, בלי שעון';
// The states of an editing job in which the next step is the editor's own (app/production.js editorState).
const EDITOR_ACTS = new Set(['editing', 'fixes', 'clientFixes', 'final']);
export const QUEUE_PAGES = {
  assign: 'qa.html#assign-h', qa: 'qa.html#qa-h',
  urgent: 'decisions.html#ur-h', exceptions: 'decisions.html#ex-h', access: 'decisions.html#ac-h', paused: 'decisions.html#pz-h',
  campaigns: 'decisions.html#cp-h', changes: 'decisions.html#cq-h',
  messages: 'messages.html', editor: 'editor.html', prep: 'prep.html', shoot: 'shoot.html',
};

const inWork = (c) => c?.status === 'active' || c?.status === 'ending';
// "לקוח אחד מחכה" / "3 לקוחות מחכים".
const words = (n, one, many) => (n === 1 ? one : `${n} ${many}`);
const landingText = (text) => `${text} · ${LANDING_WORDS}`;
// The group of a moment: late, today, tomorrow, this week.
function bucketAt(due, now) {
  if (!due) return 'today';
  if (due < now) return 'overdue';
  const days = daysBetweenIL(now, due);
  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? 'week' : 'later';
}

// The lines of one person.
//   viewer   { me, scope, error } of the signed-in person (app/protocol-ui.js viewerOf)
//   clients, checks ({ clientId: { key: row } }), stateOf(client), tasks (the open ones)
//   reviews  office_reviews rows of the last days, or null when not loaded
//   extra    what the home screen loads for these lines only, each null when it could not
//            be read: { access (client_access rows), requests (change_requests rows),
//            messages (client_messages rows of today), availability ({ months }),
//            unsigned (quotes rows still out for signature, app/unsigned-logic.js),
//            liorShoot (true while Lior is on a shoot day) }
export function flowLines({ viewer, clients = [], checks = {}, stateOf, tasks = [], reviews = null, extra = {}, now = new Date() }) {
  const me = viewer?.me || null;
  if (!me || viewer?.error || !PEOPLE[me]) return [];
  const out = [];
  const add = (line) => { if (line.n > 0) out.push(line); };
  const live = clients.filter(inWork);
  const clientOf = new Map(live.map((c) => [c.id, c]));
  const landed = live.filter(inLanding);
  const assigns = me === 'ofir' || me === 'lior'; // 22א is theirs: Ofir's, and Lior's when Ofir cannot

  // ── Ofir's queue (qa.html) ──────────────────
  // With a clock these are cards of the list (22א, 25, 23); in landing the list leaves them out.
  if (assigns) {
    const n = awaitingEditor({ clients: landed, stateOf, checks }).length;
    add({ id: 'landing-assign', bucket: 'landing', n, rule: null, href: QUEUE_PAGES.assign, cta: 'לשיוך עורך',
      text: landingText(words(n, 'לקוח אחד מחכה לשיוך עורך', 'לקוחות מחכים לשיוך עורך')) });
  }
  if (me === 'ofir') {
    const n = qaQueue({ clients: landed, stateOf, checks, meetings: ofirMeetings(live, (c) => checks[c.id] || {}), now }).length;
    add({ id: 'landing-qa', bucket: 'landing', n, rule: null, href: QUEUE_PAGES.qa, cta: 'לבקרת האיכות',
      text: landingText(words(n, 'עבודה אחת מחכה לבקרת האיכות שלך', 'עבודות מחכות לבקרת האיכות שלך')) });
    // Lior is on a shoot day: the exceptions reported to him pass to Ofir until the drive is handed over (decision 8).
    if (extra.liorShoot) {
      const n2 = tasks.filter((t) => t.source === 'escalation' && !t.done_at && clientOf.has(t.client_id)).length;
      add({ id: 'exceptions', bucket: 'escalation', n: n2, rule: 'exception', href: QUEUE_PAGES.exceptions, cta: 'להחלטות',
        text: `ליאור ביום צילום: ${words(n2, 'חריגה אחת עוברת', 'חריגות עוברות')} אליך` });
    }
  }

  // ── The editors (editor.html) ───────────────
  if (PEOPLE[me].editor) {
    const jobs = live.flatMap((c) => editingCases(c, checks[c.id] || {}, me, stateOf(c)).map((j) => ({ ...j, st: editorState(j, checks[c.id] || {}) })));
    // Returned by Ofir for fixes: marks of the quality control, not items of the list.
    const fixes = jobs.filter((j) => j.st.key === 'fixes' && !inLanding(j.client));
    const due = fixes.map((j) => j.st.ret?.due).filter(Boolean).sort((a, b) => a - b)[0] || null;
    add({ id: 'fixes', bucket: bucketAt(due, now), n: fixes.length, rule: 'qaReturn', cta: 'לתיקונים',
      href: fixes.length === 1 ? `editor.html#c-${encodeURIComponent(fixes[0].client.id)}` : QUEUE_PAGES.editor,
      text: words(fixes.length, 'לקוח אחד חזר מאופיר עם תיקונים', 'לקוחות חזרו מאופיר עם תיקונים') });
    const quiet = jobs.filter((j) => inLanding(j.client) && EDITOR_ACTS.has(j.st.key)).length;
    add({ id: 'landing-editing', bucket: 'landing', n: quiet, rule: null, href: QUEUE_PAGES.editor, cta: 'לעריכה',
      text: landingText(words(quiet, 'לקוח אחד בעריכה אצלך', 'לקוחות בעריכה אצלך')) });
  }

  // ── Lior's decisions (decisions.html) ───────
  if (me === 'lior') {
    // Urgent tasks of others that nobody started within 30 office minutes: back with him (decision 9).
    const back = tasks.filter((t) => t.urgent && t.source !== 'escalation' && !t.done_at && t.owner !== me && clientOf.has(t.client_id) && urgentState(t, now).returned).length;
    add({ id: 'urgent-back', bucket: 'urgent', n: back, rule: 'urgent', href: QUEUE_PAGES.urgent, cta: 'להחלטות',
      text: words(back, 'משימה דחופה אחת לא התחילה תוך 30 דקות', 'משימות דחופות לא התחילו תוך 30 דקות') });
    // Editing still paused the next morning: to move the deadlines or to reassign.
    const paused = pausedSinceYesterday({ clients: live, stateOf, checks, now }).filter((p) => !p.decidedToday);
    const clock = paused.filter((p) => !inLanding(p.client)).length;
    add({ id: 'paused', bucket: 'today', n: clock, rule: 'paused', href: QUEUE_PAGES.paused, cta: 'להחלטה',
      text: words(clock, 'עריכה אחת עצורה מאתמול ומחכה להחלטה שלך', 'עריכות עצורות מאתמול ומחכות להחלטה שלך') });
    add({ id: 'landing-paused', bucket: 'landing', n: paused.length - clock, rule: null, href: QUEUE_PAGES.paused, cta: 'להחלטה',
      text: landingText(words(paused.length - clock, 'עריכה אחת עצורה ומחכה להחלטה שלך', 'עריכות עצורות ומחכות להחלטה שלך')) });
    // Logins that do not work. Marked in the client's card they come with a task of his
    // (a card of the list); the others (the client's form, Ilai's check) are counted here.
    if (Array.isArray(extra.access)) {
      const mine = tasks.filter((t) => !t.done_at && t.owner === me && /הגישה ל־/.test(t.title || ''));
      const broken = extra.access.filter((a) => a.status === 'broken' && clientOf.has(a.client_id) && !mine.some((t) => t.client_id === a.client_id)).length;
      add({ id: 'access', bucket: 'today', n: broken, rule: 'broken', href: QUEUE_PAGES.access, cta: 'לגישות',
        text: words(broken, 'גישה שבורה אחת מחכה לתיקון', 'גישות שבורות מחכות לתיקון') });
    }
    if (Array.isArray(extra.requests)) {
      const open = extra.requests.filter((r) => !r.decided_at).length;
      add({ id: 'changes', bucket: 'today', n: open, rule: 'changeRequest', href: QUEUE_PAGES.changes, cta: 'לבקשות',
        text: words(open, 'בקשת שינוי אחת מחכה להחלטה שלך', 'בקשות שינוי מחכות להחלטה שלך') });
    }
    // The weekly campaign check: from Tuesday until it is marked that week (decision 21).
    if (reviews) {
      const cc = campaignCheck(reviews, now);
      add({ id: 'campaigns', bucket: cc.late ? 'overdue' : 'today', n: cc.show && !cc.done ? 1 : 0, rule: 'campaignCheck', href: QUEUE_PAGES.campaigns, cta: 'לבדיקה',
        text: 'בדיקת הקמפיינים השבועית עוד לא סומנה' });
    }
  }

  // ── Irit: the day's messages to the clients (messages.html) ──
  if (me === 'irit' && Array.isArray(extra.messages) && isBusinessDay(now)) {
    const today = dayKeyIL(now);
    const got = new Set(extra.messages.filter((m) => m.sent_at && dayKeyIL(new Date(m.sent_at)) === today).map((m) => m.client_id));
    const left = live.filter((c) => !got.has(c.id));
    const quiet = left.filter(inLanding).length;
    const clock = left.length - quiet;
    add({ id: 'messages', bucket: 'today', n: clock, rule: 'dailyMessages', href: QUEUE_PAGES.messages, cta: 'להודעות',
      text: `${words(clock, 'לקוח אחד עוד לא קיבל', 'לקוחות עוד לא קיבלו')} הודעה היום${quiet ? ` (ועוד ${quiet} בקליטה)` : ''}` });
    if (!clock) {
      add({ id: 'landing-messages', bucket: 'landing', n: quiet, rule: null, href: QUEUE_PAGES.messages, cta: 'להודעות',
        text: landingText(`${words(quiet, 'לקוח אחד עוד לא קיבל', 'לקוחות עוד לא קיבלו')} הודעה היום`) });
    }
  }

  // ── Irit: the daily follow-up before the shoot day (14, protocol v8; prep.html) ──
  // One line for all the clients, never a card of eight ticks per client: each client
  // is one row there, closed for the day in one tap.
  if (me === 'irit') {
    const due = followupDue(followupRows({ clients: live, checksOf: (c) => checks[c.id] || {}, stateOf, now })).length;
    add({ id: 'followup', bucket: 'today', n: due, rule: 'followup', href: FOLLOWUP_URL, cta: 'למעקב', text: followupLine(due) });
  }

  // ── Contracts sent for signature and not signed yet (quotes.html; section 47) ──
  // Until the client signs there is no client and no card: this line is where the
  // contract lives meanwhile, whoever built it (from a field deal or directly).
  if (QUOTE_LIST_VIEWERS.includes(me) && Array.isArray(extra.unsigned)) {
    const u = unsignedLine(extra.unsigned, now);
    if (u) add({ id: 'unsigned', bucket: 'today', n: u.n, rule: 'unsigned', href: UNSIGNED_URL, cta: 'למעקב', text: u.text });
  }

  // ── A shoot day close by, of a client in landing (prep.html, shoot.html) ──
  // The day itself is real; its items are not in the list until the client is activated.
  if (me === 'irit' || me === 'lior') {
    const soon = landed.filter((c) => shootSoon(c, now)).length;
    add({ id: 'landing-shoot', bucket: 'landing', n: soon, rule: null, href: me === 'irit' ? QUEUE_PAGES.prep : QUEUE_PAGES.shoot, cta: me === 'irit' ? 'לפני יום צילום' : 'לימי הצילום',
      text: landingText(words(soon, `לקוח אחד מצטלם ב־${SHOOT_SOON_DAYS} הימים הקרובים`, `לקוחות מצטלמים ב־${SHOOT_SOON_DAYS} הימים הקרובים`)) });
  }

  // ── The photographer's free dates of next month (section 39) ──
  if (extra.availability && Array.isArray(extra.availability.months)) {
    const ask = askOf(now);
    const month = monthName(ask.month, now);
    if (PHOTOGRAPHERS.includes(me) && !monthRow(extra.availability.months, me, ask.month)) {
      add({ id: 'availability', bucket: ask.phase === 'late' ? 'overdue' : bucketAt(ask.deadline, now), n: 1, rule: 'availability', href: AVAILABILITY_URL, cta: 'למסירת הזמינות',
        text: `עוד לא מסרת את הזמינות שלך ל${month} (עד ה־${DEADLINE_DAY} בחודש)` });
    }
    // From the 16th the managers see who did not hand it in, and can enter it in his name.
    if (AVAILABILITY_MANAGERS.includes(me) && missingForManagers(now)) {
      const missing = PHOTOGRAPHERS.filter((p) => !monthRow(extra.availability.months, p, ask.month));
      add({ id: 'availability-missing', bucket: 'overdue', n: missing.length, rule: 'availabilityMissing', href: OFFICE_URL, cta: 'לזמינות',
        text: `${missing.map((p) => PEOPLE[p]?.name || p).join(', ')} עוד לא מסר זמינות ל${month}` });
    }
  }
  return out;
}

// What the home screen has to read for the lines of this person, beyond what it reads
// anyway: the names of the loads (app/clients.js maps them to its loaders). Nobody is
// asked for a row that is not part of their own lines.
export function flowNeeds(viewer, now = new Date()) {
  const me = viewer?.me || null;
  if (!me || viewer?.error) return [];
  const needs = [];
  if (me === 'lior') needs.push('access', 'requests');
  if (me === 'irit') needs.push('messages');
  if (QUOTE_LIST_VIEWERS.includes(me)) needs.push('unsigned');
  if (me === 'ofir') needs.push('liorShoot');
  if (PHOTOGRAPHERS.includes(me) || (AVAILABILITY_MANAGERS.includes(me) && missingForManagers(now))) needs.push('availability');
  return needs;
}
