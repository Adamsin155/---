// The photographer's monthly availability (his protocol, step 1; docs/ops.md, section
// 39), at fixed Israel moments (npm test runs this under UTC, New York and Jerusalem):
//   - which month is asked for and when (open from the 1st, highlighted from the 10th,
//     late from the 16th), across the end of a month and of a year;
//   - the reminder days: the 15th and the business day before it, moved back when the
//     15th falls on a weekend, with a holiday in the way;
//   - one day as the office sees it (free, taken, not free, not handed over) and what
//     it is asked to confirm;
//   - the limits as the database holds them: the lock after the 15th, taken days, the
//     unexpected change (once a calendar month, two consecutive dates);
//   - the rules (the block at the end of app/reminder-rules.js) through the engine: he
//     is told on the 10th and rings twice, the managers get one line a business day
//     from the 16th, an unexpected change rings them with the shoot days on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../app/availability-logic.js';
import { buildEnv, computeReminders, planDelivery, planDigests } from '../app/reminder-engine.js';
import { RULE_BY_ID, RULES } from '../app/reminder-rules.js';
import { PEOPLE } from '../app/protocol.js';
import { dateIL, partsIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0, s = 0) => dateIL(y, m, d, h, mi, s);
const at = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' }, { email: 'ofir@x', person: 'ofir' },
  { email: 'ilai@x', person: 'ilai' }, { email: 'nadia@x', person: 'nadia' }, { email: 'eli@x', person: 'eli' },
];
const OURS = new Set(['availability', 'availabilityMissing', 'availabilitySubmitted', 'availabilityChange']);
const world = (availability, extra = {}) => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, availability, ...extra });
const ours = (list) => list.filter((r) => OURS.has(r.rule));
const month = (key, days, o = {}) => ({ person: 'eli', month: `${key}-01`, days, none: false, submitted_at: IL(2026, 10, 7, 9).toISOString(), updated_at: IL(2026, 10, 7, 9).toISOString(), by_person: 'eli', ...o });
const client = (name, shootAt, o = {}) => ({ id: `c-${name}`, name, business: name, status: 'active', shoot_at: shootAt, rounds: [], deal_at: IL(2026, 6, 1).toISOString(), created_at: IL(2026, 6, 1).toISOString(), ...o });

test('the lists: one photographer, who reads, who is told, who enters it in his name', () => {
  assert.deepEqual(A.PHOTOGRAPHERS, ['eli']);
  for (const p of A.PHOTOGRAPHERS) assert.ok(PEOPLE[p], p);
  assert.deepEqual(A.READERS, ['owner', 'irit', 'lior', 'ofir']);
  assert.deepEqual(A.MANAGERS, ['irit', 'lior']);
  assert.deepEqual(A.ON_BEHALF, ['owner', 'irit', 'lior']);
  assert.deepEqual([A.DEADLINE_DAY, A.NUDGE_DAY, A.CHANGE_MAX_DAYS], [15, 10, 2]);
  // The four rules are in the engine's list, and in the map the digests name topics from.
  for (const id of OURS) { assert.ok(RULES.some((r) => r.id === id), id); assert.equal(RULE_BY_ID.get(id)?.id, id); }
});

test('months and days are Israel calendar ones, whatever the zone of the machine', () => {
  assert.equal(A.addMonths('2026-12', 1), '2027-01');
  assert.equal(A.addMonths('2026-01', -1), '2025-12');
  assert.equal(A.addMonths('2026-10', 14), '2027-12');
  assert.equal(A.monthDays('2028-02').length, 29);
  assert.deepEqual([A.monthDays('2026-11')[0], A.monthDays('2026-11').at(-1)], ['2026-11-01', '2026-11-30']);
  assert.equal(A.weekdayOfDay('2026-11-01'), 0); // Sunday
  assert.equal(A.weekdayOfDay('2026-10-10'), 6); // Saturday
  assert.equal(A.monthName('2026-11'), 'נובמבר');
  assert.equal(A.monthName('2027-01', IL(2026, 12, 3)), 'ינואר 2027');
  assert.equal(A.dayLong('2026-11-12'), 'יום ה׳ 12.11');
  assert.equal(A.daysWords(['2026-11-13', '2026-11-12']), '12.11–13.11');
  assert.equal(A.daysWords(['2026-11-12']), '12.11');
  // 23:30 on the 31st in Israel is still October (21:30 UTC, 17:30 in New York).
  assert.equal(A.monthKeyOf(IL(2026, 10, 31, 23, 30)), '2026-10');
  assert.equal(A.monthKeyOf(IL(2026, 11, 1, 0, 10)), '2026-11');
});

test('which month is asked for, and when: open from the 1st, highlighted from the 10th, late from the 16th', () => {
  const ask = (y, m, d, h = 12, mi = 0) => { const a = A.askOf(IL(y, m, d, h, mi)); return [a.month, a.phase, a.daysLeft]; };
  assert.deepEqual(ask(2026, 10, 1, 0, 0), ['2026-11', 'open', 14]);
  assert.deepEqual(ask(2026, 10, 9, 23, 59), ['2026-11', 'open', 6]);
  assert.deepEqual(ask(2026, 10, 10, 0, 0), ['2026-11', 'soon', 5]);
  assert.deepEqual(ask(2026, 10, 15, 23, 59), ['2026-11', 'soon', 0]);
  assert.deepEqual(ask(2026, 10, 16, 0, 0), ['2026-11', 'late', -1]);
  assert.deepEqual(ask(2026, 10, 31, 23, 30), ['2026-11', 'late', -16]);
  // A minute into November he is asked for December; in December, for January of next year.
  assert.deepEqual(ask(2026, 11, 1, 0, 1), ['2026-12', 'open', 14]);
  assert.deepEqual(ask(2026, 12, 12), ['2027-01', 'soon', 3]);
  const a = A.askOf(IL(2026, 10, 7, 10));
  assert.deepEqual([a.current, a.deadlineDay, at(a.deadline)], ['2026-10', '2026-10-15', '15.10 23:59']);
  assert.equal(A.missingForManagers(IL(2026, 10, 15, 23, 59)), false);
  assert.equal(A.missingForManagers(IL(2026, 10, 16, 0, 0)), true);
});

test('the reminder days: the 15th and the business day before it, at 10:00; a closed 15th moves both back', () => {
  const times = (y, m) => { const t = A.remindTimes(IL(y, m, 3, 12)); return [t.quiet && at(t.quiet), at(t.first), at(t.last)]; };
  // October 2026: the 15th is a Thursday; the 10th is a Saturday, so the quiet one is on Thursday the 8th.
  assert.deepEqual(times(2026, 10), ['8.10 10:00', '14.10 10:00', '15.10 10:00']);
  // November 2026: the 15th is a Sunday, so the day before it is Thursday the 12th.
  assert.deepEqual(times(2026, 11), ['10.11 10:00', '12.11 10:00', '15.11 10:00']);
  // August 2026: the 15th is a Saturday: Thursday the 13th, and Wednesday the 12th before it.
  assert.deepEqual(times(2026, 8), ['10.8 10:00', '12.8 10:00', '13.8 10:00']);
  // May 2027: the 15th is a Saturday and the 12th is Yom HaAtzma'ut: Thursday the 13th and Tuesday the 11th.
  assert.deepEqual(times(2027, 5), ['10.5 10:00', '11.5 10:00', '13.5 10:00']);
  // The same answer from any moment of the month, the last night included.
  assert.deepEqual(A.remindTimes(IL(2026, 10, 31, 23, 59)).last, A.remindTimes(IL(2026, 10, 1, 0, 0)).last);
});

test('one day as the office sees it: free, taken, not free, not handed over; the saved date of the same shoot is not "taken"', () => {
  const months = [month('2026-11', ['2026-11-03', '2026-11-12'])];
  const changes = [{ id: 'x', person: 'eli', reported_at: IL(2026, 10, 20, 9).toISOString(), reported_month: '2026-10-01', days: ['2026-11-20'], shoot_days: [], note: null }];
  const taken = { '2026-11-12': 1, '2026-11-18': 2 };
  const st = (day, own = null) => A.dayStatus({ day, person: 'eli', months, changes, taken, own });
  assert.deepEqual([st('2026-11-03').status, st('2026-11-04').status, st('2026-12-04').status], ['free', 'busy', 'unknown']);
  assert.deepEqual([st('2026-11-12').status, st('2026-11-12').base], ['taken', 'free']);
  // The shoot being edited sits on the 12th itself: not taken by itself; two shoots on the 18th: still one other.
  assert.equal(st('2026-11-12', '2026-11-12').status, 'free');
  assert.equal(st('2026-11-18', '2026-11-18').status, 'taken');
  assert.deepEqual([st('2026-11-20').status, st('2026-11-20').changed], ['busy', true]);

  assert.equal(A.dayHintText(st('2026-11-03')), 'אלי סימן את היום הזה כפנוי.');
  assert.equal(A.dayHintText(st('2026-11-04')), 'אלי לא סימן את היום הזה כפנוי.');
  assert.equal(A.dayHintText(st('2026-11-20')), 'אלי דיווח בלת״ם על היום הזה: הוא לא פנוי.');
  assert.equal(A.dayHintText(st('2026-12-04'), IL(2026, 10, 7)), 'אלי עוד לא מסר זמינות לדצמבר. לוודא איתו לפני שסוגרים.');
  assert.equal(A.dayHintText(st('2026-11-12')), 'ביום הזה כבר קבוע יום צילום אחר (אלי סימן אותו כפנוי).');
  assert.deepEqual([A.dayShortNote(st('2026-11-03')), A.dayShortNote(st('2026-11-04')), A.dayShortNote(st('2026-12-04')), A.dayShortNote(st('2026-11-20'))],
    ['סימן את היום כפנוי', 'לא סימן את היום כפנוי', 'עוד לא מסר זמינות לחודש הזה', 'דיווח בלת״ם על היום הזה']);

  // What the office confirms with a reason: a day he did not mark free in a month he handed over, and a taken day.
  const concerns = (day, own = null) => A.availabilityConcerns({ day, months, changes, taken, own });
  assert.deepEqual(concerns('2026-11-03'), []);
  assert.deepEqual(concerns('2026-12-04'), []); // not handed over: said in the hint only
  assert.deepEqual(concerns('2026-11-04'), ['אלי לא סימן את היום הזה כפנוי.']);
  assert.deepEqual(concerns('2026-11-12'), ['ביום הזה כבר קבוע יום צילום אחר.']);
  assert.deepEqual(concerns('2026-11-12', '2026-11-12'), []);
  assert.deepEqual(concerns('2026-11-18'), ['ביום הזה כבר קבוע יום צילום אחר.', 'אלי לא סימן את היום הזה כפנוי.']);
  assert.equal(A.exceptionNote(concerns('2026-11-04'), '  הלקוח יכול רק אז '), 'אושר למרות: אלי לא סימן את היום הזה כפנוי. סיבה: הלקוח יכול רק אז');
  assert.ok(A.exceptionNote(['x'.repeat(600)], 'y').length <= 500);
  assert.equal(A.freeSummary(months[0]), '2 ימים פנויים');
  assert.equal(A.freeSummary(month('2026-11', ['2026-11-03'])), 'יום פנוי אחד');
  assert.equal(A.freeSummary(month('2026-11', [], { none: true })), 'אין ימים פנויים');
});

test('handing over and updating: an empty month must be said; after the 15th a free day does not come off; a taken day never does', () => {
  const row = month('2026-11', ['2026-11-03', '2026-11-12', '2026-11-20']);
  const taken = { '2026-11-12': 1 };
  const p = (o) => A.submitProblem({ month: '2026-11', row: null, taken, now: IL(2026, 10, 7, 10), ...o })?.code || null;
  assert.equal(p({ days: [] }), 'empty');
  assert.equal(p({ days: [], none: true }), null);
  assert.equal(p({ days: ['2026-11-03'], none: true }), 'empty');
  assert.equal(p({ days: ['2026-12-03'] }), 'month');
  assert.equal(p({ days: ['2026-11-03'] }), null);
  // An update before the 15th: a free day comes off, a taken one does not.
  assert.equal(p({ row, days: ['2026-11-12', '2026-11-20'] }), null);
  assert.equal(p({ row, days: ['2026-11-03', '2026-11-20'] }), 'taken');
  assert.match(A.submitProblem({ month: '2026-11', row, taken, days: ['2026-11-03'], now: IL(2026, 10, 7) }).text, /12\.11.*להתקשר לליאור/);
  // The lock: until the end of the 15th in Israel, not a minute later.
  assert.equal(A.removalLocked('2026-11', IL(2026, 10, 15, 23, 59)), false);
  assert.equal(A.removalLocked('2026-11', IL(2026, 10, 16, 0, 0)), true);
  assert.equal(A.removalLocked('2026-10', IL(2026, 10, 1, 0, 0)), true); // the month that already began
  assert.equal(A.removalLocked('2027-01', IL(2026, 12, 15, 12)), false);
  assert.equal(p({ row, days: ['2026-11-12', '2026-11-20'], now: IL(2026, 10, 16, 8) }), 'locked');
  assert.equal(p({ row, days: [], none: true, taken: {}, now: IL(2026, 10, 16, 8) }), 'locked');
  assert.equal(p({ row, days: [], none: true, now: IL(2026, 10, 16, 8) }), 'taken'); // the shoot day on the 12th is said first
  // Adding stays open, and whoever enters it in his name is not held.
  assert.equal(p({ row, days: [...row.days, '2026-11-25'], now: IL(2026, 10, 16, 8) }), null);
  assert.equal(p({ row, days: ['2026-11-25'], now: IL(2026, 10, 16, 8), onBehalf: true }), null);
});

test('the unexpected change: once a calendar month, one date or two consecutive ones, from today on, free or with a shoot day', () => {
  const months = [month('2026-10', ['2026-10-28', '2026-10-31']), month('2026-11', ['2026-11-01', '2026-11-03', '2026-11-04', '2026-11-05'])];
  const taken = { '2026-11-04': 1, '2026-11-18': 1 };
  const now = IL(2026, 10, 20, 9);
  const p = (days, o = {}) => A.changeProblem({ days, person: 'eli', months, changes: [], taken, now, ...o })?.code || null;
  assert.equal(p([]), 'pick');
  assert.equal(p(['2026-11-03']), null);
  assert.equal(p(['2026-11-04', '2026-11-03']), null);
  assert.equal(p(['2026-10-31', '2026-11-01']), null); // across the end of the month
  assert.equal(p(['2026-11-03', '2026-11-05']), 'span');
  assert.equal(p(['2026-11-03', '2026-11-04', '2026-11-05']), 'span');
  assert.equal(p(['2026-10-19']), 'past');
  assert.equal(p(['2026-11-10']), 'notFree');
  assert.equal(p(['2026-11-18']), null); // a shoot day he never marked free
  // Once a month, by the Israel month it was reported in.
  const reported = { id: 'c1', person: 'eli', reported_at: IL(2026, 10, 2, 9).toISOString(), reported_month: '2026-10-01', days: ['2026-10-12'], shoot_days: [], note: null };
  assert.equal(p(['2026-11-03'], { changes: [reported] }), 'used');
  assert.match(A.changeProblem({ days: ['2026-11-03'], person: 'eli', months, changes: [reported], taken, now }).text, /כבר דיווחת על בלת״ם החודש \(12\.10\).*להתקשר לליאור/);
  assert.equal(p(['2026-11-03'], { changes: [reported], now: IL(2026, 11, 1, 0, 5) }), null);
  assert.equal(A.changeThisMonth([{ ...reported, reported_month: null, reported_at: IL(2026, 10, 31, 23, 50).toISOString() }], 'eli', IL(2026, 10, 31, 23, 55))?.id, 'c1');
  assert.equal(A.changeThisMonth([{ ...reported, reported_month: null, reported_at: IL(2026, 10, 31, 23, 50).toISOString() }], 'eli', IL(2026, 11, 1, 0, 5)), null);

  // What he is told before it goes: a shoot day on it, and less than a week ahead.
  assert.deepEqual(A.changeWarnings({ days: ['2026-11-03'], taken, now }), []);
  assert.equal(A.changeWarnings({ days: ['2026-11-04'], taken, now }).length, 1);
  assert.match(A.changeWarnings({ days: ['2026-11-04'], taken, now })[0], /ב־4\.11 קבוע יום צילום/);
  assert.match(A.changeWarnings({ days: ['2026-10-26'], taken, now })[0], /פחות משבוע מראש/);
  assert.deepEqual(A.changeWarnings({ days: ['2026-10-27'], taken, now }), []);
  // The days he can name: from today to the end of next month, free or with a shoot day.
  assert.deepEqual(A.changeChoices({ person: 'eli', months, taken, now }).map((c) => `${c.day.slice(5)}${c.taken ? '*' : ''}`),
    ['10-28', '10-31', '11-01', '11-03', '11-04*', '11-05', '11-18*']);
  assert.deepEqual(A.changeChoices({ person: 'eli', months, taken, now: IL(2026, 10, 29, 9) }).map((c) => c.day)[0], '2026-10-31');
});

test('the database\'s refusals are said in words, with what to do', () => {
  const used = { id: 'c1', person: 'eli', reported_at: IL(2026, 10, 2, 9).toISOString(), reported_month: '2026-10-01', days: ['2026-10-12', '2026-10-13'] };
  const t = (message, o) => A.refusalText({ message }, o);
  assert.match(t('availability_change_used: one unexpected change a month', { changes: [used], person: 'eli', now: IL(2026, 10, 20) }), /\(12\.10–13\.10\).*פעם אחת בחודש.*להתקשר לליאור/);
  assert.match(t('duplicate key value violates unique constraint "photographer_changes_person_reported_month_key"'), /פעם אחת בחודש/);
  assert.match(t('availability_change_span: one date or two consecutive dates (48 hours)'), /עד 48 שעות.*להתקשר לליאור/);
  assert.match(t('availability_locked: after the 15th'), /יורד רק כבלת״ם/);
  assert.match(t('availability_taken: a shoot day is set'), /כבר קבוע יום צילום.*להתקשר לליאור/);
  assert.match(t('availability_empty: mark the free days'), /אין לי ימים פנויים בחודש הזה/);
  assert.equal(t('something else'), null);
});

test('shoot days by Israel day: the first one and every round, late at night too', () => {
  const clients = [
    client('פיצה רון', IL(2026, 11, 12, 10).toISOString(), { rounds: [{ n: 2, shoot_at: IL(2026, 11, 30, 23, 30).toISOString() }, { n: 3, shoot_at: null }, { n: 4, shoot_at: 'soon' }] }),
    client('קפה דנה', IL(2026, 11, 12, 0, 10).toISOString()),
    client('בלי מועד', null),
  ];
  const by = A.shootsByDay(clients);
  assert.deepEqual([...by.keys()].sort(), ['2026-11-12', '2026-11-30']);
  assert.deepEqual(by.get('2026-11-12'), ['פיצה רון', 'קפה דנה']);
  assert.deepEqual(A.takenFrom(clients), { '2026-11-12': 2, '2026-11-30': 1 });
});

// ── The rules, through the engine ───────────
// The steps of our rules that come due at each of these moments, in order, with a log.
function walk(w, moments, log = new Set()) {
  const out = [];
  for (const now of moments) {
    for (const r of computeReminders({ ...(typeof w === 'function' ? w(now) : w), now, log })) { log.add(r.key); if (OURS.has(r.rule)) out.push({ ...r, now }); }
  }
  return out;
}

test('next month is not handed over: he is told quietly on the 10th and rings on the 14th and the 15th at 10:00; handing it over stops it', () => {
  const none = { months: [], changes: [] };
  const sent = walk(world(none), [IL(2026, 10, 1, 9), IL(2026, 10, 8, 9, 59), IL(2026, 10, 8, 10, 0), IL(2026, 10, 12, 10), IL(2026, 10, 14, 9, 59), IL(2026, 10, 14, 10, 0), IL(2026, 10, 15, 9, 59), IL(2026, 10, 15, 10, 0), IL(2026, 10, 15, 14)]);
  assert.deepEqual(sent.map((r) => [r.step, r.person, r.level, at(r.now)]), [
    ['d10', 'eli', 'quiet', '8.10 10:00'], ['d14', 'eli', 'ring', '14.10 10:00'], ['d15', 'eli', 'ring', '15.10 10:00'],
  ]);
  assert.deepEqual(sent.map((r) => r.title), ['עוד לא מסרת זמינות לנובמבר', 'זמינות לנובמבר: למסור עד ה־15 בחודש', 'היום המועד האחרון: זמינות לנובמבר']);
  assert.ok(sent.every((r) => r.url === 'shoot.html#availability' && r.key.startsWith('availability:-:eli:2026-11:')));
  // The rings go to his phone at once (inside the sending hours) and are not counted in the daily cap.
  for (const r of sent.slice(1)) {
    const [d] = planDelivery({ reminders: [r], now: r.now });
    assert.deepEqual([d.channel, d.status, d.exempt], ['push', 'sent', 'clock']);
  }
  // Handed over on the 12th: nothing more, to anyone.
  const handed = { months: [month('2026-11', ['2026-11-03'], { submitted_at: IL(2026, 10, 12, 9).toISOString() })], changes: [] };
  const after = walk(world(handed), [IL(2026, 10, 14, 10), IL(2026, 10, 15, 10), IL(2026, 10, 18, 8, 30)]);
  assert.deepEqual(after.filter((r) => r.rule !== 'availabilitySubmitted'), []);
  // "No free day" said is handed over too.
  assert.deepEqual(walk(world({ months: [month('2026-11', [], { none: true, submitted_at: IL(2026, 10, 1).toISOString() })], changes: [] }), [IL(2026, 10, 15, 10)]), []);
  // Last month's row does not count for this month's question.
  // (A log that starts on the 15th also meets the two earlier steps: they are recorded as stale, never sent late.)
  const late = walk(world({ months: [month('2026-10', ['2026-10-20'], { submitted_at: IL(2026, 9, 10).toISOString() })], changes: [] }), [IL(2026, 10, 15, 10)]);
  assert.deepEqual(planDelivery({ reminders: late, now: IL(2026, 10, 15, 10) }).map((r) => [r.step, r.status, r.reason]), [['d10', 'suppressed', 'stale'], ['d14', 'suppressed', 'stale'], ['d15', 'sent', null]]);
  // Nobody on the staff list is a photographer: nothing.
  assert.deepEqual(walk({ ...world(none), staff: STAFF.filter((s) => s.person !== 'eli') }, [IL(2026, 10, 15, 10), IL(2026, 10, 18, 8, 30)]), []);
  // The engine before the data is loaded (an older function): no case, no crash.
  const bare = world(none); delete bare.availability;
  assert.equal(ours(computeReminders({ ...bare, now: IL(2026, 10, 1, 9) })).length, 0);
});

test('a 15th on a weekend: the rings move to the business days before it, and the words say so', () => {
  const sent = walk(world({ months: [], changes: [] }), [IL(2026, 8, 10, 10), IL(2026, 8, 12, 10), IL(2026, 8, 13, 10), IL(2026, 8, 14, 10), IL(2026, 8, 15, 10)]);
  assert.deepEqual(sent.map((r) => [r.step, at(r.now)]), [['d10', '10.8 10:00'], ['d14', '12.8 10:00'], ['d15', '13.8 10:00']]);
  assert.equal(sent[2].title, 'המועד האחרון ב־15 בחודש: למסור היום זמינות לספטמבר');
  // With Yom HaAtzma'ut on the 12th (May 2027): Tuesday the 11th and Thursday the 13th.
  const may = walk(world({ months: [], changes: [] }), [IL(2027, 5, 11, 10), IL(2027, 5, 12, 10), IL(2027, 5, 13, 10)]);
  assert.deepEqual(may.filter((r) => r.level === 'ring').map((r) => [r.step, at(r.now)]), [['d14', '11.5 10:00'], ['d15', '13.5 10:00']]);
});

test('from the 16th the work manager and whoever sets shoot days get one line a business day, in the morning digest, until it is handed over', () => {
  const none = { months: [], changes: [] };
  // The 16th of October 2026 is a Friday: the first line is on Sunday the 18th.
  const moments = [IL(2026, 10, 15, 18), IL(2026, 10, 16, 8, 30), IL(2026, 10, 17, 8, 30), IL(2026, 10, 18, 8, 29), IL(2026, 10, 18, 8, 30), IL(2026, 10, 18, 8, 31), IL(2026, 10, 18, 15), IL(2026, 10, 19, 8, 30), IL(2026, 10, 19, 12)];
  const sent = walk(world(none), moments).filter((r) => r.rule === 'availabilityMissing');
  assert.deepEqual(sent.map((r) => [r.person, r.level, at(r.now)]), [
    ['irit', 'digest', '18.10 08:30'], ['lior', 'digest', '18.10 08:30'], ['irit', 'digest', '19.10 08:30'], ['lior', 'digest', '19.10 08:30'],
  ]);
  assert.equal(sent[0].title, 'אלי עוד לא מסר זמינות לנובמבר (המועד היה ה־15 בחודש)');
  assert.equal(sent[0].url, 'prep.html#availability');
  // It is queued for the digest of its morning, which carries it as a line.
  const now = IL(2026, 10, 18, 8, 30);
  const env = buildEnv({ ...world(none), now });
  const fresh = computeReminders({ env }).filter((r) => r.rule === 'availabilityMissing');
  const queued = planDelivery({ reminders: fresh, now }).map((r, i) => ({ ...r, id: i + 1, created_at: now.toISOString() }));
  assert.ok(queued.every((r) => r.channel === 'digest' && r.status === 'queued'));
  const digests = planDigests({ env, log: queued, active: new Set(fresh.map((r) => r.key)) }).filter((d) => d.key);
  for (const who of ['irit', 'lior']) {
    const d = digests.find((x) => x.person === who && x.kind === 'morning');
    assert.ok(d.lines.includes('אלי עוד לא מסר זמינות לנובמבר (המועד היה ה־15 בחודש)'), who);
  }
  assert.equal(digests.some((d) => d.person === 'eli' && d.lines.join(' ').includes('זמינות')), false);
  // Handed over a minute before the digest: the queued line is no longer true, and is left out.
  const later = planDigests({ env, log: queued, active: new Set() });
  assert.ok(later.every((d) => !d.key || !d.lines.join(' ').includes('זמינות')));
  // The month ended without it: from the 1st the question is about the next month, and the line starts again on its 16th.
  assert.deepEqual(walk(world(none), [IL(2026, 11, 1, 8, 30), IL(2026, 11, 2, 8, 30)]).filter((r) => r.rule === 'availabilityMissing'), []);
});

test('he handed it over: the two hear quietly, once; an entry in his name tells nobody', () => {
  const w = world({ months: [month('2026-11', ['2026-11-03', '2026-11-04'], { submitted_at: IL(2026, 10, 7, 9, 2).toISOString() })], changes: [] });
  const sent = walk(w, [IL(2026, 10, 7, 9, 2), IL(2026, 10, 7, 9, 3), IL(2026, 10, 8, 9)]);
  assert.deepEqual(sent.map((r) => [r.rule, r.person, r.level, r.title]), [
    ['availabilitySubmitted', 'irit', 'quiet', 'אלי מסר זמינות לנובמבר: 2 ימים פנויים'],
    ['availabilitySubmitted', 'lior', 'quiet', 'אלי מסר זמינות לנובמבר: 2 ימים פנויים'],
  ]);
  const byLior = world({ months: [month('2026-11', ['2026-11-03'], { by_person: 'lior' })], changes: [] });
  assert.deepEqual(walk(byLior, [IL(2026, 10, 7, 9, 5)]), []);
});

test('an unexpected change rings Irit and Lior at once, with the dates and the shoot days that sit on them', () => {
  const change = { id: 'ch-1', person: 'eli', reported_at: IL(2026, 10, 20, 11, 0).toISOString(), reported_month: '2026-10-01', days: ['2026-11-13', '2026-11-12'], shoot_days: ['2026-11-12'], note: 'חתונה במשפחה' };
  const w = world({ months: [month('2026-11', ['2026-11-03'], { submitted_at: IL(2026, 10, 1).toISOString() })], changes: [change] },
    { clients: [client('פיצה רון', IL(2026, 11, 12, 10).toISOString()), client('קפה דנה', IL(2026, 11, 20, 10).toISOString())] });
  const sent = walk(w, [IL(2026, 10, 20, 11, 0), IL(2026, 10, 20, 11, 1), IL(2026, 10, 21, 9)]);
  assert.deepEqual(sent.map((r) => [r.rule, r.person, r.level, r.exempt, r.exception]), [
    ['availabilityChange', 'irit', 'ring', 'urgent', true], ['availabilityChange', 'lior', 'ring', 'urgent', true],
  ]);
  assert.equal(sent[0].title, 'בלת״ם של אלי: 12.11–13.11 · קבוע יום צילום');
  assert.equal(sent[0].body, 'קבוע יום צילום ב־12.11: פיצה רון. לתאם מחדש מול הלקוח והמשפיענים. הסיבה: חתונה במשפחה');
  assert.equal(sent[0].url, 'prep.html#availability');
  assert.deepEqual(planDelivery({ reminders: sent, now: IL(2026, 10, 20, 11, 0) }).map((r) => [r.channel, r.status]), [['push', 'sent'], ['push', 'sent']]);
  // No shoot day on the dates: said so.
  const free = walk(world({ months: [], changes: [{ ...change, id: 'ch-2', days: ['2026-11-25'], shoot_days: [], note: null }] }), [IL(2026, 10, 20, 11, 0)]).filter((r) => r.rule === 'availabilityChange');
  assert.equal(free[0].title, 'בלת״ם של אלי: 25.11');
  assert.equal(free[0].body, 'אין יום צילום קבוע בתאריכים האלה. הם ירדו מהימים הפנויים שלו.');
  // Reported at night about a date weeks ahead: it waits for the sending hours (the morning digest).
  const night = { ...change, id: 'ch-3', reported_at: IL(2026, 10, 20, 22, 0).toISOString() };
  const far = walk(world({ months: [], changes: [night] }), [IL(2026, 10, 20, 22, 0)]).filter((r) => r.rule === 'availabilityChange');
  assert.deepEqual(planDelivery({ reminders: far, now: IL(2026, 10, 20, 22, 0) }).map((r) => [r.channel, r.reason]), [['digest', 'quiet_hours'], ['digest', 'quiet_hours']]);
  // About tomorrow: it rings now, at night too.
  const soon = { ...change, id: 'ch-4', reported_at: IL(2026, 10, 20, 22, 0).toISOString(), days: ['2026-10-21'] };
  const near = walk(world({ months: [], changes: [soon] }), [IL(2026, 10, 20, 22, 0)]).filter((r) => r.rule === 'availabilityChange');
  assert.deepEqual(planDelivery({ reminders: near, now: IL(2026, 10, 20, 22, 0) }).map((r) => [r.channel, r.status]), [['push', 'sent'], ['push', 'sent']]);
});
