// "מעקב לקוחות", the tab "משימות לעורכים ולגרפיקאי" (Irit, 10.11.2026): the tasks given to the
// editors and to the graphic designer, with two states only, "בתהליך" and "הושלם", the day each
// was put in, and a filter by who (editors / the graphic designer) and by state.
// Pure, no DOM (tests/tracking-tasks.test.mjs); the tab is app/tracking-tasks.js; docs/ops.md, section 122.
//
// The tasks come from the two places Irit gives a task today:
//   - "משימות לעובדים" (שליחת נודניק; public.staff_tasks, app/staff-tasks-ui.js): almost all of them.
//     On 10.11.2026 there were about 120 to the editors and Ilai there, against 5 in the client card.
//     A cancelled one ("ביטול הנודניק") is not a task any more and is not shown. No due day.
//   - the client card's tasks (public.client_tasks): owner, due_on, done_at.
// Who is who: the editors are EDITORS of app/protocol.js (Nadia, Yariv, Anna, Nirel) and the
// placeholder 'editor' ("העורך המשויך"); the graphic designer is Ilai.
import { PEOPLE, EDITORS, BRIEF_FIELDS } from './protocol.js';
import { clientLabel } from './protocol-logic.js';
import { partsIL, dayFromKeyIL } from './tz.js';

export const DESIGNER = 'ilai';
// The people of this tab, in the order the form offers them.
export const TASK_PEOPLE = [...EDITORS, DESIGNER];
// 'edit' (an editor), 'graphic' (the graphic designer) or null (anyone else: not in this tab).
export const kindOf = (person) => (person === DESIGNER ? 'graphic' : EDITORS.includes(person) || person === 'editor' ? 'edit' : null);
export const KIND_TEXT = { edit: 'עריכה', graphic: 'גרפיקה' };
export const STATE_TEXT = { open: 'בתהליך', done: 'הושלם' };
// The filter chips: [key, label].
export const KINDS = [['all', 'הכל'], ['edit', 'עורכים'], ['graphic', 'גרפיקאי']];
export const STATES = [['all', 'הכל'], ['open', 'פתוחות'], ['done', 'הושלמו']];
// A finished task stays in the list this many days (the list stays short).
export const DONE_DAYS = 30;
export const PAGE_SIZE = 30;

const DAY = 864e5;
const personName = (key) => (key === 'editor' ? PEOPLE.editor.name : PEOPLE[key]?.name || key || '');
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const shorten = (s, max = 110) => { const t = oneLine(s); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

// The brief under the task (a short second line): the first answer of the brief, in the brief's order.
export function briefText(brief) {
  if (!brief || typeof brief !== 'object') return typeof brief === 'string' ? shorten(brief) : '';
  for (const [k] of BRIEF_FIELDS) { const v = oneLine(brief[k]); if (v) return shorten(v); }
  return '';
}

// One row of the tab, from either table.
//   clients: { id: client row } (to name the client; the task's own client_name otherwise).
export function fromClientTask(t, clients = {}) {
  const kind = kindOf(t?.owner);
  if (!kind) return null;
  const c = clients[t.client_id];
  return {
    id: `c-${t.id}`, from: 'client', kind, person: t.owner, who: personName(t.owner),
    clientId: t.client_id || null, client: c ? clientLabel(c) : '',
    title: oneLine(t.title), brief: briefText(t.brief),
    createdAt: t.created_at || null, dueOn: t.due_on || null,
    state: t.done_at ? 'done' : 'open', doneAt: t.done_at || null,
  };
}
export function fromStaffTask(t, clients = {}) {
  const kind = kindOf(t?.assignee);
  if (!kind || t.status === 'cancelled') return null;
  const c = t.client_id ? clients[t.client_id] : null;
  // The task's text is the title; a long one is cut here (the whole text is in "משימות לעובדים").
  return {
    id: `s-${t.id}`, from: 'staff', kind, person: t.assignee, who: personName(t.assignee),
    clientId: c ? t.client_id : null, client: c ? clientLabel(c) : oneLine(t.client_name),
    title: shorten(t.body, 160), brief: briefText(t.brief),
    createdAt: t.created_at || null, dueOn: null,
    state: t.status === 'done' || t.done_at ? 'done' : 'open', doneAt: t.done_at || null,
  };
}

// The rows: the open ones by their due day, the oldest first (a task without a day after the
// dated ones, by when it was put in); then the ones done in the last DONE_DAYS days, the latest first.
export function taskRows({ clientTasks = [], staffTasks = [], clients = {} } = {}, now = new Date()) {
  const since = now.getTime() - DONE_DAYS * DAY;
  const rows = [...(clientTasks || []).map((t) => fromClientTask(t, clients)), ...(staffTasks || []).map((t) => fromStaffTask(t, clients))]
    .filter((r) => r && (r.state === 'open' || new Date(r.doneAt).getTime() >= since));
  const t = (v) => (v ? new Date(v).getTime() : 0);
  const open = rows.filter((r) => r.state === 'open').sort((a, b) => {
    if (a.dueOn && b.dueOn && a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1;
    if (!!a.dueOn !== !!b.dueOn) return a.dueOn ? -1 : 1;
    return t(a.createdAt) - t(b.createdAt);
  });
  const done = rows.filter((r) => r.state === 'done').sort((a, b) => t(b.doneAt) - t(a.doneAt));
  return [...open, ...done];
}

// The two filters. kind: 'all' | 'edit' | 'graphic'; state: 'all' | 'open' | 'done'.
export const filterTasks = (rows, { kind = 'all', state = 'all' } = {}) =>
  (rows || []).filter((r) => (kind === 'all' || r.kind === kind) && (state === 'all' || r.state === state));
// How many each chip would show (with the other filter as it is).
export function chipCounts(rows, { kind = 'all', state = 'all' } = {}) {
  return {
    kind: Object.fromEntries(KINDS.map(([k]) => [k, filterTasks(rows, { kind: k, state }).length])),
    state: Object.fromEntries(STATES.map(([s]) => [s, filterTasks(rows, { kind, state: s }).length])),
  };
}

// "10.11" (an Israel day), with the year when it is not this year: "28.12.25".
export function shortDay(v, now = new Date()) {
  if (!v) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? dayFromKeyIL(v) : new Date(v);
  if (!d || Number.isNaN(d.getTime())) return '';
  const p = partsIL(d);
  return p.year === partsIL(now).year ? `${p.day}.${p.month}` : `${p.day}.${p.month}.${String(p.year).slice(-2)}`;
}
// "12 משימות" / "משימה אחת".
export const tasksWord = (n) => (n === 1 ? 'משימה אחת' : `${n} משימות`);
// Which people the form offers for the chosen chip.
export const formPeople = (kind) => (kind === 'graphic' ? [DESIGNER] : kind === 'edit' ? [...EDITORS] : [...TASK_PEOPLE]);
