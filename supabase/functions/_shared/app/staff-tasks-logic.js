// generated — edit app/ instead. Source: app/staff-tasks-logic.js. Regenerate: node scripts/sync-functions.mjs
// "משימה מיידית" (the owner's request of 6.10.2026): Irit (and the owner) gives a
// task to anyone on the team, on the spot. From that moment the assignee is rung
// every 10 minutes until they mark "בוצע" themselves, between 09:00 and 20:00 Israel
// time on working days; a task still open at 20:00 resumes at 09:00 of the next
// working day. Cancelling (the giver or the owner) stops the reminders.
// Pure, no DOM and no network: the card (app/staff-tasks-ui.js), the reminder rules
// (app/reminder-rules.js `nag`, `nagDone`; a copy runs in the reminders function) and
// the unit tests read the same rules. The database decides who may do what
// (supabase/migrations/20261011100000_staff_tasks.sql).
import { PEOPLE, TEAM_PEOPLE, WORK_HOURS, isSales, BRIEF_REQUIRED, BRIEF_MUST, BRIEF_FIELDS } from './protocol.js';
import { isBusinessDay, erevOn } from './protocol-logic.js';
import { atTimeIL, dayKeyIL, addDaysIL } from './tz.js';

const OWNER = 'owner';
const MIN = 6e4;

// ── Who ───────────────────────────────────
// Who gives these tasks. To let Ofir or Lior give them too, add them here and in
// private.can_give_staff_tasks() (the migration): one line in each.
export const GIVERS = [OWNER, 'irit'];
// The viewer as a person key ('owner' for the owner's row), or null when unknown.
export const personOfViewer = (viewer) => {
  if (!viewer || viewer.error) return null;
  if (viewer.me) return viewer.me;
  return viewer.scope === 'office' ? OWNER : null;
};
export const canGive = (viewer) => GIVERS.includes(personOfViewer(viewer));
// Whom a task can be given to: everyone on the team (editors, the photographer and
// the sales agents too), then the owner.
export const ASSIGNEES = () => [...TEAM_PEOPLE().map((p) => ({ key: p.key, name: p.name })), { key: OWNER, name: 'הבעלים' }];
export const personName = (key) => (key === OWNER ? 'הבעלים' : PEOPLE[key]?.name || key || '');
// Where a person does their work: sales have only deal.html.
export const homeUrl = (person) => (isSales(person) ? 'deal.html' : 'clients.html#mine');

// ── What ──────────────────────────────────
export const BODY_MAX = 500;
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
// The form, checked before it is sent (the database checks again).
// → { ok, errors: { assignee?, body? }, args } with the arguments of public.staff_task_create.
// Protocol v10 (docs/ops.md, section 58): a task for Nirel carries her mandatory brief here
// too, the same four fields a task in the client card must have for her (BRIEF_REQUIRED and
// BRIEF_MUST in app/protocol.js: the problem, what to change, what stays, the result). The
// database refuses one without it (public.staff_task_create_brief).
export const needsBrief = (assignee) => BRIEF_REQUIRED.has(assignee);
export const BRIEF_MAX = 500;
// The four fields of the form, in the brief's order: [key, label].
export const NAG_BRIEF = BRIEF_FIELDS.filter(([k]) => BRIEF_MUST.includes(k));
// → { ok, errors: { assignee?, body?, 'brief.<key>'? }, rpc, args }: the function to call and its arguments.
export function validateTask({ assignee = '', body = '', clientId = '', brief = {} } = {}) {
  const errors = {};
  const text = String(body).replace(/\r\n?/g, '\n').trim();
  if (!ASSIGNEES().some((p) => p.key === assignee)) errors.assignee = 'בוחרים למי המשימה.';
  if (!text) errors.body = 'כותבים מה צריך לעשות.';
  else if (text.length > BODY_MAX) errors.body = `עד ${BODY_MAX} תווים (עכשיו ${text.length}).`;
  const args = { p_assignee: assignee, p_body: text, p_client: isUuid(clientId) ? clientId : null };
  if (!needsBrief(assignee)) return { ok: !Object.keys(errors).length, errors, rpc: 'staff_task_create', args };
  const clean = {};
  for (const [k] of NAG_BRIEF) {
    const v = String(brief?.[k] ?? '').replace(/\r\n?/g, '\n').trim();
    if (!v) errors[`brief.${k}`] = `חובה במשימה ל${personName(assignee)}.`;
    else if (v.length > BRIEF_MAX) errors[`brief.${k}`] = `עד ${BRIEF_MAX} תווים (עכשיו ${v.length}).`;
    else clean[k] = v;
  }
  return { ok: !Object.keys(errors).length, errors, rpc: 'staff_task_create_brief', args: { ...args, p_brief: clean } };
}
// The brief of a task as lines to show: [[label, text], …] (none: an ordinary task).
export const briefLines = (task) => NAG_BRIEF.map(([k, l]) => [l, String(task?.brief?.[k] ?? '').trim()]).filter(([, v]) => v);
// One line of a task's text, for a notification's title.
export const shortBody = (text, max = 90) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

// ── When: the reminders' own window ───────
// 09:00–20:00 Israel time on the system's working days (Sunday–Thursday, no
// holidays). On erev chag the office closes at 13:00, and so do these. This window
// belongs to these tasks only: WORK_HOURS (09:00–18:00) and the sending hours of the
// other reminders (08:30–19:00) are not changed by it.
export const NAG_HOURS = { start: 9, end: 20 };
export const NAG_EVERY = 10; // minutes
const openAt = (d) => atTimeIL(d, NAG_HOURS.start);
const closeAt = (d) => atTimeIL(d, erevOn(d) ? WORK_HOURS.erevEnd : NAG_HOURS.end);
export const nagOpen = (d) => isBusinessDay(d) && d >= openAt(d) && d < closeAt(d);
// The first moment at or after `d` when the window is open.
export function nextNagMoment(d) {
  let t = new Date(d);
  for (let i = 0; i < 40; i += 1) {
    if (isBusinessDay(t) && t < closeAt(t)) return t < openAt(t) ? openAt(t) : t;
    t = openAt(addDaysIL(atTimeIL(t, 12), 1));
  }
  return t;
}
// The reminder slot `now` falls in, for a task given at `createdAt`: on the day it
// was given the slots run from that moment (so the first one is at once), on every
// later day from 09:00, each NAG_EVERY minutes long. Outside the window there is
// none. → { id, at, n, first } or null; `id` names the slot ('2026-10-06.3'), and is
// what makes one send per slot and never two (the reminder log's unique key);
// `first`: the task's very first reminder.
export function nagSlot(createdAt, now) {
  const created = createdAt ? new Date(createdAt) : null;
  if (!created || Number.isNaN(+created) || now < created || !nagOpen(now)) return null;
  const open = openAt(now);
  const from = created > open ? created : open;
  const n = Math.floor((now - from) / (NAG_EVERY * MIN));
  const at = new Date(from.getTime() + n * NAG_EVERY * MIN);
  return { id: `${dayKeyIL(now)}.${n}`, at, n, first: at.getTime() === nextNagMoment(created).getTime() };
}
// When the next reminder goes out, for the card ("התזכורת הבאה ב־…").
export function nextNagAt(createdAt, now) {
  const slot = nagSlot(createdAt, now);
  if (slot) {
    const next = new Date(slot.at.getTime() + NAG_EVERY * MIN);
    return nagOpen(next) ? next : nextNagMoment(next);
  }
  const created = createdAt ? new Date(createdAt) : now;
  return nextNagMoment(created > now ? created : now);
}

// ── The lists of the card ─────────────────
const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);
// How long a finished or cancelled task stays in the giver's list.
export const KEEP_DAYS = 7;
// → { mine: the open tasks given to this viewer (oldest first: the one that rings
//      longest on top), given: { open, closed } of the tasks this viewer gave (the
//      owner: everyone's), newest first; closed ones for KEEP_DAYS }.
export function taskLists(tasks = [], viewer = null, now = new Date()) {
  const me = personOfViewer(viewer);
  if (!me) return { mine: [], given: { open: [], closed: [] } };
  const mine = tasks.filter((t) => t.assignee === me && t.status === 'open').sort((a, b) => byNewest(b, a));
  const gave = canGive(viewer) ? tasks.filter((t) => me === OWNER || t.created_by === me) : [];
  const since = now.getTime() - KEEP_DAYS * 864e5;
  return {
    mine,
    given: {
      open: gave.filter((t) => t.status === 'open').sort(byNewest),
      closed: gave.filter((t) => t.status !== 'open' && new Date(t.done_at || t.cancelled_at || t.created_at) >= since)
        .sort((a, b) => new Date(b.done_at || b.cancelled_at) - new Date(a.done_at || a.cancelled_at)),
    },
  };
}
export const STATUS_TEXT = { open: 'פתוחה', done: 'בוצעה', cancelled: 'בוטלה' };
