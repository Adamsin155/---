// "משימות שנסגרו השבוע" on the manager view (app/week-chart.js): the office week in
// Israel, what counts as closed (a done check of a protocol item that is not an
// import, a task marked done), what counts as still open on a day (the open items of
// a process by its deadline, an open task by its day), and the sentences read out.
// `npm test` runs this under UTC, America/New_York and Jerusalem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applicableProcesses, clientState, CLAIM, IMPORT_NOTE } from '../app/protocol-logic.js';
import { dayKeyIL } from '../app/tz.js';
import { officeWeek, weekClosings, weekSummary, weekLabel, WEEK_DAYS } from '../app/week-chart.js';

const at = (s) => new Date(s);
// Sunday 11.10.2026: the deal. Monday 12.10 10:00: the characterization.
const base = {
  id: 'c1', name: 'דנה', business: 'סטודיו דנה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  deal_at: '2026-10-11T09:00:00+03:00', char_at: '2026-10-12T10:00:00+03:00', created_at: '2026-10-11T09:00:00+03:00',
  contract_end: '2027-10-11', deliverables: {}, rounds: [], protocol_version: 5,
};
const procOf = (c, id) => applicableProcesses(c).find((p) => p.id === id);
const keysFor = (c, ids) => applicableProcesses(c).filter((p) => ids.includes(p.id)).flatMap((p) => p.items.filter((i) => !i.optional).map((i) => i.key));
const done = (c, ids, when, note = null) => Object.fromEntries(keysFor(c, ids).map((k) => [k, { state: 'done', at: when, note, by_email: 'irit@x.test' }]));
const JOIN = ['p01', 'p02', 'p03'];
const TUESDAY = at('2026-10-13T12:00:00+03:00');
const week = (clients, checksByClient, extra = {}, now = TUESDAY) => weekClosings({
  clients, checksByClient, now, stateOf: (c) => clientState(c, checksByClient[c.id] || {}, now), ...extra,
});

test('the office week: Sunday to Thursday of the Israel week, also on Friday and Saturday', () => {
  const keys = ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];
  assert.deepEqual(officeWeek(TUESDAY).map((d) => d.key), keys);
  assert.deepEqual(officeWeek(TUESDAY).map((d) => d.short), WEEK_DAYS);
  assert.deepEqual(officeWeek(at('2026-10-11T00:05:00+03:00')).map((d) => d.key), keys); // Sunday, just after midnight in Israel
  assert.deepEqual(officeWeek(at('2026-10-17T23:50:00+03:00')).map((d) => d.key), keys); // Saturday night
  assert.equal(officeWeek(at('2026-10-18T00:10:00+03:00'))[0].key, '2026-10-18');        // the next Sunday
  // The clock change (25.10.2026) does not move a day.
  assert.deepEqual(officeWeek(at('2026-10-27T09:00:00+02:00')).map((d) => d.key), ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']);
});

test('closed: done checks of protocol items by Israel day; never an import, a process mark or another week', () => {
  const join = done(base, JOIN, '2026-10-11T09:03:00+03:00');
  const n = Object.keys(join).length;
  assert.ok(n >= 3);
  const [k1, k2, k3, k4] = keysFor(base, ['p04', 'p05', 'p05b', 'p06', 'p07']);
  const checks = {
    ...join,
    [k1]: { state: 'done', at: '2026-10-12T23:30:00+03:00', note: null },            // Monday, late evening in Israel
    [k2]: { state: 'done', at: '2026-10-12T21:30:00Z', note: null },                 // 00:30 on Tuesday in Israel
    [k3]: { state: 'done', at: '2026-10-12T11:00:00+03:00', note: IMPORT_NOTE },     // imported history
    [k4]: { state: 'na', at: '2026-10-12T11:00:00+03:00', note: null },              // not relevant is not closed work
    [CLAIM(procOf(base, 'p04'))]: { state: 'done', at: '2026-10-12T11:00:00+03:00', note: 'ofir' }, // "אני על זה"
  };
  const w = week([base], { c1: checks });
  assert.deepEqual(w.days.map((d) => d.closed), [n, 1, 1, 0, 0]);
  assert.equal(w.closed, n + 2);
  assert.equal(w.todayIndex, 2);
  assert.deepEqual(w.days.map((d) => d.today), [false, false, true, false, false]);
  // The same checks a week later are not this week's.
  assert.equal(week([base], { c1: checks }, {}, at('2026-10-20T12:00:00+03:00')).closed, 0);
  // A note that only contains the word is not an import.
  const noted = { ...checks, [k3]: { state: 'done', at: '2026-10-12T11:00:00+03:00', note: 'ייבוא חלקי' } };
  assert.equal(week([base], { c1: noted }).days[1].closed, 2);
  // A cancelled client is left out; an ended one keeps what was closed.
  assert.equal(week([{ ...base, status: 'cancelled' }], { c1: checks }).closed, 0);
  assert.equal(week([{ ...base, status: 'ended' }], { c1: checks }).closed, n + 2);
});

test('open: what is left of a process, on the day of its deadline as clientState has it', () => {
  const checks = done(base, JOIN, '2026-10-11T09:03:00+03:00');
  const state = clientState(base, checks, TUESDAY);
  const keys = new Set(officeWeek(TUESDAY).map((d) => d.key));
  const due = state.states.filter((s) => !s.proc.recurring && !s.complete && s.dueAt && keys.has(dayKeyIL(s.dueAt)));
  assert.ok(due.length > 0, 'the fixture has deadlines this week');
  const w = week([base], { c1: checks });
  const expected = [0, 0, 0, 0, 0];
  for (const s of due) expected[[...keys].indexOf(dayKeyIL(s.dueAt))] += s.proc.items.filter((i) => !i.optional).length;
  assert.deepEqual(w.days.map((d) => d.open), expected);
  assert.equal(w.open, expected.reduce((a, b) => a + b, 0));
  assert.equal(w.max, Math.max(...w.days.map((d) => d.closed + d.open)));

  // Closing one of those processes today moves its items from "open" on its day to "closed" today.
  const s = due[0];
  const day = [...keys].indexOf(dayKeyIL(s.dueAt));
  const items = s.proc.items.filter((i) => !i.optional);
  const closedNow = { ...checks, ...Object.fromEntries(items.map((i) => [i.key, { state: 'done', at: TUESDAY.toISOString(), note: null }])) };
  const after = week([base], { c1: closedNow });
  assert.equal(after.days[2].closed, w.days[2].closed + items.length);
  assert.ok(after.days[day].open <= w.days[day].open - items.length);
  // One item of it marked: one less is open.
  const one = { ...checks, [items[0].key]: { state: 'done', at: TUESDAY.toISOString(), note: null } };
  if (items.length > 1) assert.equal(week([base], { c1: one }).days[day].open, w.days[day].open - 1);
  // An ended client has nothing open.
  assert.equal(week([{ ...base, status: 'ended' }], { c1: checks }).open, 0);
});

test('tasks: done by the day they were marked, open by the day they are due; only the viewer\'s clients', () => {
  const doneTasks = [
    { id: 't1', client_id: 'c1', done_at: '2026-10-12T15:00:00+03:00' },
    { id: 't2', client_id: 'c1', done_at: '2026-10-08T15:00:00+03:00' },   // last week
    { id: 't3', client_id: 'zz', done_at: '2026-10-12T15:00:00+03:00' },   // a client this person does not have
    { id: 't4', client_id: null, done_at: '2026-10-13T09:00:00+03:00' },   // an office task with no client
  ];
  const openTasks = [
    { id: 't5', client_id: 'c1', due_on: '2026-10-15', done_at: null },
    { id: 't6', client_id: 'c1', due_on: '2026-10-19', done_at: null },    // next week
    { id: 't7', client_id: 'c1', due_on: null, done_at: null },
    { id: 't8', client_id: 'zz', due_on: '2026-10-15', done_at: null },
  ];
  const none = week([base], { c1: {} });
  const w = week([base], { c1: {} }, { doneTasks, openTasks });
  assert.deepEqual(w.days.map((d) => d.closed), [0, 1, 1, 0, 0]);
  assert.deepEqual(w.days.map((d, i) => d.open - none.days[i].open), [0, 0, 0, 0, 1]);
});

test('the sentences: the summary line and the chart read out, with singulars', () => {
  const w = { closed: 23, open: 30, days: [
    { name: 'יום ראשון', closed: 14, open: 0, today: false }, { name: 'יום שני', closed: 9, open: 6, today: true },
    { name: 'יום שלישי', closed: 0, open: 8, today: false }, { name: 'יום רביעי', closed: 0, open: 11, today: false }, { name: 'יום חמישי', closed: 0, open: 5, today: false }] };
  const s = weekSummary(w);
  assert.equal(`${s.lead}${s.rest}`, '23 נסגרו עד עכשיו, ועוד 30 פתוחות עד יום חמישי');
  assert.equal(weekLabel(w), 'משימות לפי יום: יום ראשון 14 נסגרו, 0 פתוחות; יום שני (היום) 9 נסגרו, 6 פתוחות; יום שלישי 0 נסגרו, 8 פתוחות; יום רביעי 0 נסגרו, 11 פתוחות; יום חמישי 0 נסגרו, 5 פתוחות');
  const one = weekSummary({ closed: 1, open: 1 });
  assert.equal(`${one.lead}${one.rest}`, 'אחת נסגרה עד עכשיו, ועוד אחת פתוחה עד יום חמישי');
  assert.equal(weekSummary({ closed: 0, open: 0 }).lead, '0 נסגרו');
});
