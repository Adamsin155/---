// "משימות שנסגרו השבוע": the numbers behind the chart on the manager view (owner.html,
// screen 1). For each office day, Sunday to Thursday, of the current week in Israel:
//   closed  the protocol items marked done that day (a check whose state is 'done' and
//           whose note is not exactly 'ייבוא': an imported history is not this week's
//           work) and the tasks marked done that day;
//   open    the items still open whose deadline falls on that day: the open required
//           items of a process that is not complete, by the process's deadline as
//           clientState() has it (app/protocol-logic.js: the same deadline every screen
//           shows, with the time waited for the client), and the open tasks due that day.
// Days are Israel days (app/tz.js). Everything is counted from the rows the viewer
// already has, so it shows what that person may see. No DOM here: tests/week-chart.test.mjs.
import { IMPORT_NOTE, isResolved, parseDate } from './protocol-logic.js';
import { dayKeyIL, startOfDayIL, addDaysIL, weekdayIL } from './tz.js';

export const WEEK_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳'];
export const WEEK_DAY_NAMES = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי'];

// The five office days of the week `now` is in: [{ key: 'YYYY-MM-DD', short, name }].
// On Friday and Saturday it is still the week that just ended.
export function officeWeek(now = new Date()) {
  const sunday = addDaysIL(startOfDayIL(now), -weekdayIL(now));
  return WEEK_DAYS.map((short, i) => ({ key: dayKeyIL(addDaysIL(sunday, i)), short, name: WEEK_DAY_NAMES[i] }));
}

const live = (c) => c.status === 'active' || c.status === 'ending';

//   clients         the clients the viewer has (any status; cancelled ones are left out)
//   stateOf         (client) => clientState(client, checks, now)
//   checksByClient  { clientId: { itemKey: { state, note, at } } }
//   doneTasks       tasks with done_at (at least this week's)
//   openTasks       tasks without done_at
// Returns { days: [{ key, short, name, closed, open, today }], closed, open, max, todayIndex }.
export function weekClosings({ clients = [], stateOf, checksByClient = {}, doneTasks = [], openTasks = [], now = new Date() } = {}) {
  const week = officeWeek(now);
  const byKey = new Map(week.map((d, i) => [d.key, i]));
  const closed = week.map(() => 0);
  const open = week.map(() => 0);
  const dayOf = (v) => { const d = parseDate(v); return d ? byKey.get(dayKeyIL(d)) : undefined; };
  const ids = new Set();
  for (const c of clients) {
    if (c.status === 'cancelled') continue;
    ids.add(c.id);
    const checks = checksByClient[c.id] || {};
    for (const s of stateOf(c).states) {
      // Closed: the items of the protocol only (process marks such as "אני על זה" are not work closed).
      for (const item of s.proc.items) {
        const check = checks[item.key];
        if (check?.state !== 'done' || check.note === IMPORT_NOTE) continue;
        const i = dayOf(check.at);
        if (i !== undefined) closed[i] += 1;
      }
      // Open: what is left of a process whose deadline is one of these days.
      if (!live(c) || s.proc.recurring || s.complete || !s.dueAt) continue;
      const i = byKey.get(dayKeyIL(s.dueAt));
      if (i === undefined) continue;
      open[i] += s.proc.items.filter((item) => !item.optional && !isResolved(item, checks[item.key], now)).length;
    }
  }
  const liveIds = new Set(clients.filter(live).map((c) => c.id));
  for (const t of doneTasks) {
    if (!t.done_at || (t.client_id && !ids.has(t.client_id))) continue;
    const i = dayOf(t.done_at);
    if (i !== undefined) closed[i] += 1;
  }
  for (const t of openTasks) {
    if (t.done_at || !t.due_on || !liveIds.has(t.client_id)) continue;
    const i = byKey.get(String(t.due_on).slice(0, 10));
    if (i !== undefined) open[i] += 1;
  }
  const todayIndex = byKey.has(dayKeyIL(now)) ? byKey.get(dayKeyIL(now)) : -1;
  const days = week.map((d, i) => ({ ...d, closed: closed[i], open: open[i], today: i === todayIndex }));
  const sum = (list) => list.reduce((a, b) => a + b, 0);
  return { days, closed: sum(closed), open: sum(open), max: Math.max(0, ...days.map((d) => d.closed + d.open)), todayIndex };
}

// The one line above the bars, and the same numbers as a sentence for a screen reader.
export const weekSummary = (w) => ({
  lead: w.closed === 1 ? 'אחת נסגרה' : `${w.closed} נסגרו`,
  rest: ` עד עכשיו, ועוד ${w.open === 1 ? 'אחת פתוחה' : `${w.open} פתוחות`} עד יום חמישי`,
});
export const weekLabel = (w) => `משימות לפי יום: ${w.days.map((d) => `${d.name}${d.today ? ' (היום)' : ''} ${d.closed} נסגרו, ${d.open} פתוחות`).join('; ')}`;
