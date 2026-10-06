// The content Gantt's date logic (app/gantt-logic.js, app/gantt-template.js): the one
// template turned into a client's dated plan in Israel time. Runs under UTC, New York
// and Jerusalem (npm test): no result may depend on the machine's zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePlan, planDiff, monthGrid, calendarMonths, monthRange, packageMonthOf, entryMoment, entryStatus,
  allowedDay, weekdayOf, addDays, share, pick, yearGlance, totals, contractEndKey, safeLink, isCustom,
} from '../app/gantt-logic.js';
import { GANTT_RULES, GANTT_KINDS, KIND_ORDER, POSTS_FROM } from '../app/gantt-template.js';
import { CYCLE_FROM, monthItems, SPREAD_ITEMS, spreadMonth } from '../app/year-logic.js';
import { HOLIDAYS, EREV } from '../app/holidays.js';
import { dateIL } from '../app/tz.js';
import {
  fileTitle, STATUS_TEXT, CLIENT_STATUS_TEXT, clientStatus, nextState, STATES, toSchedule, weekOf, clientSummary, bySummary, weekAgenda, nextPost,
} from '../app/gantt-logic.js';

const IL = (y, m, d, h = 10, mi = 0) => dateIL(y, m, d, h, mi).toISOString();
const FULL = { videos: 42, graphics: 42, shoot_days: 2, collabs: 3, stories: 3, ch14: 1, monthly: 96 };
const client = (fields = {}) => ({ deal_at: IL(2026, 3, 15), contract_end: '2027-03-15', deliverables: FULL, rounds: [], shoot_at: null, ...fields });
const count = (entries, kind) => entries.filter((e) => e.kind === kind).length;
const holidays = new Set(HOLIDAYS.map((h) => h.date));
const erevs = new Set(EREV.map((h) => h.date));

test('the template is relative only: no rule names a year or a date', () => {
  const src = JSON.stringify(GANTT_RULES, (k, v) => (typeof v === 'function' ? String(v) : v));
  assert.doesNotMatch(src, /20\d\d-\d\d|\b20[2-4]\d\b/);
  for (const r of GANTT_RULES) assert.ok(GANTT_KINDS[r.kind], r.key);
  for (const k of Object.keys(GANTT_KINDS)) assert.ok(KIND_ORDER.includes(k), k);
  assert.equal(POSTS_FROM, CYCLE_FROM, 'posts start with the monthly cycle');
});

test('a full package signed 15.3.2026 for a year: every unit of the package, from March 2026 to March 2027', () => {
  const p = generatePlan(client());
  assert.equal(p.error, null);
  assert.equal(p.of, 12);
  assert.equal(p.endKey, '2027-03-15');
  const e = p.entries;
  assert.deepEqual(
    Object.fromEntries(KIND_ORDER.map((k) => [k, count(e, k)]).filter(([, n]) => n)),
    { video: 42, graphic: 42, monthly: 88, highlight: 1, story: 3, collab: 3, ch14: 1, shoot: 2, photo: 11, report: 11, plan: 11, renewal: 1, end: 1 },
  );
  assert.equal(e[0].day >= '2026-03-15', true);
  assert.equal(e.at(-1).key, 'end');
  assert.equal(e.at(-1).day, '2027-03-15');
  // Keys are unique; videos and graphics are numbered 1..q in date order.
  assert.equal(new Set(e.map((x) => x.key)).size, e.length);
  for (const kind of ['video', 'graphic']) {
    const list = e.filter((x) => x.kind === kind);
    assert.deepEqual(list.map((x) => x.num), list.map((_, i) => i + 1), kind);
    assert.deepEqual(list.map((x) => x.key), list.map((_, i) => `${kind}.${i + 1}`), kind);
  }
  // Sorted by day and time.
  for (let i = 1; i < e.length; i += 1) assert.ok(`${e[i - 1].day} ${e[i - 1].time_il || '99'}` <= `${e[i].day} ${e[i].time_il || '99'}`, `${e[i - 1].key} ${e[i].key}`);
  // Only Ilai's plan and the renewal call are internal.
  assert.deepEqual([...new Set(e.filter((x) => x.internal).map((x) => x.kind))].sort(), ['plan', 'renewal']);
});

test('posts: videos Sun/Tue/Thu 19:00, graphics Mon/Wed 13:00, never on Shabbat, a holiday or erev chag', () => {
  const { entries } = generatePlan(client());
  for (const v of entries.filter((x) => x.kind === 'video')) {
    assert.ok([0, 2, 4].includes(weekdayOf(v.day)), v.day);
    assert.equal(v.time_il, '19:00');
  }
  for (const g of entries.filter((x) => x.kind === 'graphic')) {
    assert.ok([1, 3].includes(weekdayOf(g.day)), g.day);
    assert.equal(g.time_il, '13:00');
  }
  for (const x of entries.filter((y) => GANTT_KINDS[y.kind].post)) {
    assert.ok(![5, 6].includes(weekdayOf(x.day)), `${x.key} on Shabbat ${x.day}`);
    assert.ok(!holidays.has(x.day), `${x.key} on a holiday ${x.day}`);
    assert.ok(!erevs.has(x.day), `${x.key} on erev chag ${x.day}`);
  }
  // Nothing posted before the cycle's month; spread evenly: 42 over 11 months is 4 or 3 a month.
  const m2 = monthRange(client(), POSTS_FROM);
  assert.ok(entries.filter((x) => GANTT_KINDS[x.kind].post).every((x) => x.day >= m2.from));
  const perMonth = [];
  for (let n = POSTS_FROM; n <= 12; n += 1) perMonth.push(entries.filter((x) => x.kind === 'video' && x.month === n).length);
  assert.deepEqual(perMonth, [4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3]);
  // Yom HaAtzma'ut 22.4.2026 is a Wednesday (a graphics day): nothing that day.
  assert.equal(entries.some((x) => x.day === '2026-04-22'), false);
});

test('every entry sits in its package month; the cycle\'s items match the package year\'s', () => {
  const c = client();
  const { entries } = generatePlan(c);
  for (const e of entries) {
    if (e.kind === 'end') continue;
    assert.equal(packageMonthOf(c, e.day), e.month, `${e.key} ${e.day}`);
  }
  // Report on business day 3 and Ilai's plan the business day before the month: the
  // same days as the monthly cycle's due dates (app/year-logic.js).
  for (let n = CYCLE_FROM; n <= 12; n += 1) {
    const items = monthItems(c, n);
    const due = (k) => items.find((i) => i.key === k).dueAt;
    const day = (d) => d.toISOString() && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
    assert.equal(entries.find((e) => e.key === `report.${n}`).day, day(due('report')), `report ${n}`);
    assert.equal(entries.find((e) => e.key === `plan.${n}`).day, day(due('plan')), `plan ${n}`);
  }
  // Stories, collabs, channel 14 and the second shoot day in the cycle's months for them.
  const months = (kind) => entries.filter((e) => e.kind === kind).map((e) => e.month);
  for (const it of SPREAD_ITEMS.filter((i) => ['story', 'collab', 'ch14'].includes(i.key))) {
    const q = it.qty(FULL);
    assert.deepEqual(months(it.key), Array.from({ length: q }, (_, k) => spreadMonth(k + 1, q, CYCLE_FROM, 12)), it.key);
  }
  assert.deepEqual(months('shoot'), [1, spreadMonth(1, 1, CYCLE_FROM, 12)]);
});

test('the deal on the 31st: each month starts on its last day when it is shorter; no gaps, no overlaps', () => {
  const c = client({ deal_at: IL(2026, 1, 31), contract_end: '2027-01-31' });
  const starts = [];
  for (let n = 1; n <= 13; n += 1) starts.push(monthRange(c, n)?.from);
  assert.deepEqual(starts, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31',
    '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']);
  for (let n = 1; n <= 12; n += 1) assert.equal(monthRange(c, n).to, monthRange(c, n + 1).from);
  const { entries } = generatePlan(c);
  assert.equal(count(entries, 'video'), 42);
  for (const e of entries.filter((x) => x.kind !== 'end')) {
    const r = monthRange(c, e.month);
    assert.ok(e.day >= r.from && e.day < r.to, `${e.key} ${e.day} not in month ${e.month}`);
  }
  // February 2026 (28 days) still gets its share.
  assert.ok(entries.some((e) => e.kind === 'video' && e.month === 2));
});

test('a deal late at night is the Israel day it was signed, in any zone of the machine', () => {
  // 23:30 in Israel on 14.3 is 21:30 UTC: the package starts on the 14th.
  const c = client({ deal_at: IL(2026, 3, 14, 23, 30) });
  assert.equal(monthRange(c, 1).from, '2026-03-14');
  assert.equal(monthRange(c, 2).from, '2026-04-14');
  // Deterministic: the same input gives the same plan.
  assert.deepEqual(generatePlan(c), generatePlan(structuredClone(c)));
});

test('a holiday or erev chag moves a dated item to the next allowed day in its month', () => {
  // Deal 1.9.2026: month 1 is 1.9–30.9. The third Monday is 21.9, Yom Kippur; the
  // third Sunday is 20.9, erev Yom Kippur. Both land on Tuesday 22.9.
  const c = client({ deal_at: IL(2026, 9, 1), contract_end: '2027-09-01', deliverables: { shoot_days: 1 } });
  const rule = (weekday) => ({ key: 'shoot', kind: 'shoot', place: 'nthWeekday', qty: () => 1, firstMonth: 1, week: 3, weekday, time: '10:00', avoid: ['holiday', 'erev'], title: () => 't' });
  assert.equal(generatePlan(c, [rule(1)]).entries[0].day, '2026-09-22');
  assert.equal(generatePlan(c, [rule(0)]).entries[0].day, '2026-09-22');
  // Without erev in the rule, erev stays.
  assert.equal(generatePlan(c, [{ ...rule(0), avoid: ['holiday'] }]).entries[0].day, '2026-09-20');
  // A fifth Thursday asked of a month with four: the last one.
  assert.equal(generatePlan(c, [{ ...rule(4), week: 5 }]).entries[0].day, '2026-09-24');
  assert.equal(allowedDay('2026-09-21', ['holiday']), false);
  assert.equal(allowedDay('2026-09-20', ['holiday']), true);
  assert.equal(allowedDay('2026-09-20', ['erev']), false);
  assert.equal(allowedDay('2026-09-25', []), false, 'Friday');
  assert.equal(allowedDay('2026-09-26', []), false, 'Saturday');
});

test('times are Israel wall clock across the clock changes (27.3.2026 and 25.10.2026)', () => {
  const at = (day, time_il) => entryMoment({ day, time_il }).toISOString();
  assert.equal(at('2026-03-26', '19:00'), '2026-03-26T17:00:00.000Z'); // winter, +02
  assert.equal(at('2026-03-29', '19:00'), '2026-03-29T16:00:00.000Z'); // summer, +03
  assert.equal(at('2026-10-22', '19:00'), '2026-10-22T16:00:00.000Z');
  assert.equal(at('2026-10-25', '19:00'), '2026-10-25T17:00:00.000Z');
  assert.equal(at('2026-10-25', null), '2026-10-25T10:00:00.000Z'); // no time: noon
  // Adding days never slips across the change.
  assert.equal(addDays('2026-03-26', 1), '2026-03-27');
  assert.equal(addDays('2026-03-27', 1), '2026-03-28');
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(addDays('2026-10-25', -1), '2026-10-24');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('the calendar: weeks Sunday first, month lengths, and the months of the contract', () => {
  const feb = monthGrid(2026, 2); // 1.2.2026 is a Sunday, 28 days
  assert.equal(feb.length, 4);
  assert.deepEqual([feb[0][0].key, feb[3][6].key], ['2026-02-01', '2026-02-28']);
  const mar = monthGrid(2026, 3);
  assert.equal(mar.length, 5);
  assert.equal(mar[4].filter((d) => d.inMonth).map((d) => d.key).at(-1), '2026-03-31');
  const may = monthGrid(2026, 5); // 1.5.2026 is a Friday: 6 weeks
  assert.equal(may.length, 6);
  assert.deepEqual([may[0][0].key, may[0][5].key], ['2026-04-26', '2026-05-01']);
  assert.equal(may[0][0].inMonth, false);
  const feb28 = monthGrid(2028, 2); // a leap year
  assert.equal(feb28.flat().filter((d) => d.inMonth).length, 29);
  const months = calendarMonths(client());
  assert.equal(months.length, 13);
  assert.deepEqual([months[0].key, months.at(-1).key], ['2026-03', '2027-03']);
  assert.deepEqual(calendarMonths({ deal_at: null }), []);
});

test('a shorter contract: the quantities fit inside it, nothing after its end', () => {
  const c = client({ contract_end: '2026-09-15' });
  const { entries, of, endKey } = generatePlan(c);
  assert.equal(of, 6);
  assert.equal(endKey, '2026-09-15');
  assert.equal(count(entries, 'video'), 42);
  assert.ok(entries.every((e) => e.day <= '2026-09-15'));
  assert.equal(entries.find((e) => e.kind === 'renewal').day, '2026-07-16'); // 60 days before, a Thursday
  // Without a contract end: the catalog's term (12 months).
  assert.equal(contractEndKey(client({ contract_end: null })), '2027-03-15');
});

test('shoot days already in the card are the dates; without a deal there is no plan', () => {
  const c = client({ shoot_at: IL(2026, 3, 29, 9, 30), rounds: [{ n: 2, shoot_at: IL(2026, 10, 6, 11, 0) }] });
  const shoots = generatePlan(c).entries.filter((e) => e.kind === 'shoot');
  assert.deepEqual(shoots.map((s) => [s.key, s.day, s.time_il, s.month]), [['shoot.1', '2026-03-29', '09:30', 1], ['shoot.2', '2026-10-06', '11:00', 7]]);
  assert.deepEqual(generatePlan({ deal_at: null }), { error: 'no-deal', entries: [] });
  // A package without the photographer, stories or collabs: none of them.
  const small = generatePlan(client({ deliverables: { videos: 25, graphics: 35, shoot_days: 1 } })).entries;
  assert.deepEqual([count(small, 'monthly'), count(small, 'photo'), count(small, 'story'), count(small, 'collab'), count(small, 'ch14')], [0, 0, 0, 0, 0]);
  assert.equal(count(small, 'shoot'), 1);
});

test('spreading: share gives the remainder to the earlier months; pick spaces evenly', () => {
  assert.deepEqual(share(25, 11), [3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual(share(3, 11).reduce((a, b) => a + b, 0), 3);
  assert.deepEqual(share(0, 4), [0, 0, 0, 0]);
  // Each unit in the middle of its share of the slots.
  assert.deepEqual(pick(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 4), ['b', 'd', 'f', 'h']);
  assert.deepEqual(pick(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], 3), ['b', 'e', 'h']);
  assert.deepEqual(pick(['a', 'b'], 3), ['a', 'b', 'b']);
  assert.deepEqual(pick([], 2), []);
});

test('"עדכון מהתבנית": new entries added, unchanged ones left, dates moved by hand kept unless confirmed', () => {
  const gen = generatePlan(client()).entries;
  const row = (e, extra = {}) => ({ id: `id-${e.key}`, state: 'planned', link: null, file_id: null, note: null, edited: false, ...e, ...extra });
  const [v1, v2, v3] = gen.filter((e) => e.kind === 'video');
  const rows = [
    row(v1),                                                     // as made
    row(v2, { day: '2026-04-30', edited: true }),                // moved by hand
    row(v3, { day: '2026-01-01', state: 'posted', link: 'https://x.y/1' }), // posted, the template moved it
    { id: 'id-old', key: 'video.99', kind: 'video', title: 'סרטון 99', day: '2026-05-01', state: 'planned', edited: false },  // no longer made
    { id: 'id-oldp', key: 'video.98', kind: 'video', title: 'סרטון 98', day: '2026-05-01', state: 'posted', edited: false },  // no longer made, but posted
    { id: 'id-c', key: 'custom.1', kind: 'custom', title: 'השקה', day: '2026-06-01', state: 'planned', edited: true },
  ];
  const d = planDiff(rows, gen);
  assert.equal(d.insert.length, gen.length - 3);
  assert.equal(d.insert.every((x) => x.edited === false), true);
  assert.deepEqual(d.update, [{ id: `id-${v3.key}`, key: v3.key, fields: { day: v3.day } }]);
  assert.deepEqual(d.keptEdited.map((r) => r.key), [v2.key]);
  assert.deepEqual(d.remove, ['id-old']);
  assert.deepEqual(d.orphans.map((r) => r.key), ['video.98']);
  // Confirmed: the moved date goes back to the template's, and is no longer "moved by hand".
  const o = planDiff(rows, gen, { overwrite: true });
  assert.deepEqual(o.update.find((u) => u.key === v2.key).fields, { day: v2.day, edited: false });
  assert.deepEqual(o.keptEdited, []);
  // Never touched: state, link, file, note; custom rows.
  for (const u of [...d.update, ...o.update]) for (const f of ['state', 'link', 'file_id', 'note', 'posted_on']) assert.ok(!(f in u.fields), f);
  assert.ok(![...d.update, ...o.update].some((u) => u.key === 'custom.1'));
  assert.equal(isCustom(rows.at(-1)), true);
  // A second run with nothing changed does nothing.
  const same = gen.map((e) => row(e, { time_il: e.time_il ? `${e.time_il}:00` : null }));
  assert.deepEqual(planDiff(same, gen), { insert: [], update: [], remove: [], keptEdited: [], orphans: [] });
});

test('status, totals and the year at a glance', () => {
  const now = new Date(IL(2026, 5, 5, 20, 0));
  const e = (day, time_il, kind = 'video', state = 'planned') => ({ day, time_il, kind, state });
  // "חסר": a post whose time has passed and that is neither scheduled nor up. The only problem state.
  assert.equal(entryStatus(e('2026-05-05', '19:00'), now), 'missing');
  assert.equal(entryStatus(e('2026-05-04', '19:00'), now), 'missing');
  assert.equal(entryStatus(e('2026-05-05', '21:00'), now), 'today');
  assert.equal(entryStatus(e('2026-05-04', '19:00', 'video', 'posted'), now), 'posted');
  assert.equal(entryStatus(e('2026-05-04', '19:00', 'report'), now), 'past');
  assert.equal(entryStatus(e('2026-05-06', '19:00'), now), 'planned');
  assert.equal(entryStatus(e('2026-05-01', '19:00', 'video', 'skipped'), now), 'skipped');
  // "תוזמן": in the planner, its time ahead. Once the time has passed it went up by
  // itself and counts as up; the stored state stays 'scheduled'.
  assert.equal(entryStatus(e('2026-05-06', '19:00', 'video', 'scheduled'), now), 'scheduled');
  assert.equal(entryStatus(e('2026-05-05', '21:00', 'video', 'scheduled'), now), 'scheduled');
  assert.equal(entryStatus(e('2026-05-05', '20:00', 'video', 'scheduled'), now), 'posted');
  assert.equal(entryStatus(e('2026-05-04', '19:00', 'video', 'scheduled'), now), 'posted');
  assert.equal(entryStatus(e('2026-05-04', null, 'video', 'scheduled'), now), 'posted');
  assert.equal(entryStatus(e('2026-05-04', '19:00', 'video', 'error'), now), 'error');
  assert.equal(entryStatus(e('2026-05-09', '19:00', 'video', 'error'), now), 'error');
  const c = client();
  const list = [
    e('2026-04-19', '19:00', 'video', 'posted'), e('2026-04-26', '19:00'), e('2026-04-28', '19:00', 'video', 'scheduled'), e('2026-05-07', '19:00', 'video', 'scheduled'),
    e('2026-05-03', '19:00', 'video', 'error'), e('2026-05-10', '13:00', 'graphic'), e('2026-04-20', '12:00', 'report'), e('2026-04-21', '19:00', 'video', 'skipped'),
  ];
  assert.deepEqual(totals(list, now), { posts: 6, posted: 2, scheduled: 1, missing: 1, errors: 1 });
  const g = yearGlance(c, list, now);
  assert.deepEqual(g.map((r) => r.kind), ['video', 'graphic', 'report']);
  assert.deepEqual(g[0].months[1], { n: 2, planned: 5, posted: 2, scheduled: 1, missing: 2 });
  assert.deepEqual(g[1].months[1], { n: 2, planned: 1, posted: 0, scheduled: 0, missing: 0 });
  assert.deepEqual(g[2].months[1], { n: 2, planned: 1, posted: 0, scheduled: 0, missing: 0 }, 'a report is never missing');
  assert.equal(g[0].months.length, 12);
});

test('the words: the team sees חסר and שגיאה, the client only מתוכנן / תוזמן / עלה', () => {
  assert.deepEqual([STATUS_TEXT.scheduled, STATUS_TEXT.missing, STATUS_TEXT.posted, STATUS_TEXT.error], ['תוזמן', 'חסר', 'עלה', 'שגיאה']);
  assert.deepEqual([clientStatus('missing'), clientStatus('error'), clientStatus('scheduled'), clientStatus('posted')], ['planned', 'planned', 'scheduled', 'posted']);
  for (const s of Object.keys(STATUS_TEXT)) assert.ok(!['חסר', 'שגיאה'].includes(CLIENT_STATUS_TEXT[s]), s);
  assert.doesNotMatch(JSON.stringify(STATUS_TEXT), /עברו ולא|עוד לא סומן/);
});

test('one tap: planned → scheduled → posted → planned; "סימון כתוזמנו" takes only the planned posts of the range', () => {
  assert.deepEqual(['planned', 'scheduled', 'posted', 'error', 'skipped'].map(nextState), ['scheduled', 'posted', 'planned', 'scheduled', 'planned']);
  assert.deepEqual(STATES, ['planned', 'scheduled', 'posted', 'error', 'skipped']);
  const e = (key, day, kind = 'video', state = 'planned') => ({ key, day, time_il: '19:00', kind, state });
  const list = [e('a', '2026-05-03'), e('b', '2026-05-04', 'graphic'), e('c', '2026-05-05', 'video', 'posted'), e('d', '2026-05-06', 'report'), e('f', '2026-05-07', 'video', 'scheduled'), e('g', '2026-05-10'), e('h', '2026-05-08', 'video', 'skipped')];
  assert.deepEqual(toSchedule(list, '2026-05-03', '2026-05-09').map((x) => x.key), ['a', 'b']);
  assert.deepEqual(toSchedule(list, '2026-05-04', '2026-05-04').map((x) => x.key), ['b']);
  assert.deepEqual(weekOf('2026-05-06'), { from: '2026-05-03', to: '2026-05-09', days: ['2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09'] });
  assert.equal(weekOf('2026-05-03').from, '2026-05-03'); // Sunday
  assert.equal(weekOf('2026-05-09').from, '2026-05-03'); // Saturday
});

test('the index: a client\'s line (package month, the month\'s counts, the next post), "missing first", and the week across clients', () => {
  const now = new Date(IL(2026, 5, 5, 20, 0)); // Tuesday; package month 2 is 15.4–14.5
  const e = (key, day, time_il, kind = 'video', state = 'planned') => ({ key, day, time_il, kind, state });
  const a = { id: 'a', name: 'רון', business: 'מספרת רון', deal_at: IL(2026, 3, 15), contract_end: '2027-03-15', deliverables: FULL };
  const b = { id: 'b', name: 'דנה', business: 'אולפן דנה', deal_at: IL(2026, 4, 1), contract_end: '2027-04-01', deliverables: FULL };
  const z = { id: 'z', name: 'זיו', business: 'זיו נדל״ן', deal_at: IL(2026, 4, 20), contract_end: '2027-04-20', deliverables: FULL };
  const rowsA = [e('v1', '2026-04-19', '19:00', 'video', 'posted'), e('v2', '2026-05-03', '19:00'), e('v3', '2026-05-04', '19:00', 'video', 'scheduled'), e('v4', '2026-05-07', '19:00', 'video', 'scheduled'),
    e('g1', '2026-05-06', '13:00', 'graphic'), e('r', '2026-05-06', '12:00', 'report'), e('v9', '2026-05-17', '19:00'), e('old', '2026-04-10', '19:00')];
  const sa = clientSummary(a, rowsA, now);
  assert.deepEqual([sa.has, sa.month, sa.of, sa.posts, sa.posted, sa.scheduled, sa.missing, sa.errors], [true, 2, 12, 5, 2, 1, 1, 0]);
  assert.equal(sa.next.key, 'g1');
  const sb = clientSummary(b, [e('x', '2026-05-06', '19:00', 'video', 'scheduled')], now);
  assert.deepEqual([sb.month, sb.missing, sb.scheduled, sb.next.key], [2, 0, 1, 'x']);
  const sz = clientSummary(z, null, now);
  assert.deepEqual([sz.has, sz.month, sz.posts, sz.next], [false, 1, 0, null]);
  assert.equal(clientSummary({ id: 'n', name: 'x', deal_at: null }, null, now).month, 0);
  // Missing first, then the ones with a Gantt by their next post, then the ones without.
  assert.deepEqual([sz, sb, sa].sort((p, q) => bySummary(p, q)).map((s) => s.client.id), ['a', 'b', 'z']);
  assert.deepEqual([sz, sb, sa].sort((p, q) => bySummary(p, q, 'name')).map((s) => s.client.id), ['b', 'z', 'a']);
  // The week (Sunday 3.5 to Saturday 9.5): posts only, by day and time, with their status.
  const week = weekAgenda([a, b, z], new Map([['a', rowsA], ['b', [e('x', '2026-05-06', '19:00', 'video', 'scheduled')]]]), now);
  assert.deepEqual(week.map((d) => [d.day, d.items.map((i) => `${i.client.id}:${i.entry.key}:${i.status}`)]), [
    ['2026-05-03', ['a:v2:missing']],
    ['2026-05-04', ['a:v3:posted']],
    ['2026-05-06', ['a:g1:planned', 'b:x:scheduled']],
    ['2026-05-07', ['a:v4:scheduled']],
  ]);
  assert.equal(nextPost(rowsA, now).key, 'g1');
});

test('links: only https is shown or opened', () => {
  assert.equal(safeLink('https://instagram.com/reel/x'), 'https://instagram.com/reel/x');
  for (const v of ['http://x.y', 'javascript:alert(1)', 'https://a b', '', null]) assert.equal(safeLink(v), null, String(v));
});

// Found live (6.10.2026): the item editor listed an uploaded file as "קובץ".
test('a client file in the item editor: its label, else its own file name, else its kind', () => {
  assert.equal(fileTitle({ label: ' גרפיקה מבצע חורף ', storage_path: 'c/deliverable_graphic/x.png' }), 'גרפיקה מבצע חורף');
  assert.equal(fileTitle({ label: null, kind: 'deliverable_video', storage_path: 'c1/deliverable_video/3f2b8c1e-7a41-4d2c-9b1f-0a1b2c3d4e5f-Reel-Final.mp4' }), 'Reel-Final.mp4');
  assert.equal(fileTitle({ label: '', kind: 'deliverable_graphic' }), 'גרפיקה'); // the client's view has no path
  assert.equal(fileTitle({}), 'קובץ');
});
