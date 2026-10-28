// A monthly shoot day (the owner's request of 28.10.2026; docs/ops.md, section 71):
// the switch in the client's deliverables (app/monthly-shoot.js) and Irit's ring on the
// last business day of every Israel month at 10:00 (rule monthlyShoot in
// app/reminder-rules.js). npm test runs this under UTC, New York and Jerusalem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders } from '../app/reminder-engine.js';
import { RULES } from '../app/reminder-rules.js';
import { isShootMonthly, withShootMonthly, lastBusinessDay, onLastBusinessDay, nextMonthKey, monthName, hasShootIn } from '../app/monthly-shoot.js';
import { dateIL, partsIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const STAFF = [{ email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' }];
const day = (d) => { const p = partsIL(d); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
let seq = 0;
const client = (o = {}) => {
  seq += 1;
  return { id: `m${seq}`, name: o.name || `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 1, 1, 10).toISOString(), deliverables: { shoot_monthly: true }, ...o };
};
const world = (clients) => ({ clients, checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF });
const rings = (clients, now) => computeReminders({ ...world(clients), now, log: [] }).filter((r) => r.rule === 'monthlyShoot');

test('the switch lives in the deliverables, everything else kept', () => {
  assert.equal(isShootMonthly({ deliverables: { shoot_monthly: true } }), true);
  for (const d of [undefined, {}, { shoot_monthly: false }, { shoot_monthly: 'true' }, { shoot_monthly: 1 }]) assert.equal(isShootMonthly({ deliverables: d }), false, JSON.stringify(d));
  assert.deepEqual(withShootMonthly({ videos: 8, videos_month: 8 }, true), { videos: 8, videos_month: 8, shoot_monthly: true });
  assert.deepEqual(withShootMonthly({ videos: 8, shoot_monthly: true }, false), { videos: 8 });
  assert.deepEqual(withShootMonthly(null, false), {});
});

test('the last business day of a month: a weekday, a month ending on Friday/Saturday, February', () => {
  assert.equal(day(lastBusinessDay('2026-11')), '2026-11-30'); // Monday
  assert.equal(day(lastBusinessDay('2026-10')), '2026-10-29'); // the 30th is a Friday, the 31st a Saturday
  assert.equal(day(lastBusinessDay('2027-02')), '2027-02-28'); // Sunday
  assert.equal(day(lastBusinessDay('2026-12')), '2026-12-31'); // Thursday
  assert.equal(day(lastBusinessDay('2027-07')), '2027-07-29'); // the 30th Friday, the 31st Saturday
  assert.equal(onLastBusinessDay(IL(2026, 10, 29, 10)), true);
  assert.equal(onLastBusinessDay(IL(2026, 10, 30, 10)), false);
  assert.equal(onLastBusinessDay(IL(2026, 10, 31, 10)), false);
  // Late at night in Israel is still that Israel day, whatever the machine's zone.
  assert.equal(onLastBusinessDay(IL(2026, 11, 30, 23, 30)), true);
  assert.equal(onLastBusinessDay(IL(2026, 12, 1, 0, 30)), false);
});

test('the next month and its Hebrew name', () => {
  assert.equal(nextMonthKey(IL(2026, 10, 29, 10)), '2026-11');
  assert.equal(nextMonthKey(IL(2026, 12, 31, 10)), '2027-01');
  assert.deepEqual(['2026-11', '2027-01', '2027-03', '2026-12'].map(monthName), ['נובמבר', 'ינואר', 'מרץ', 'דצמבר']);
});

test('Irit rings at 10:00 on the last business day, once per client and month, with the next month by name', () => {
  const a = client({ name: 'שטיחי רות' });
  const b = client({ name: 'נקודת חן', business: 'נקודת חן בע״מ' });
  // The month ends on Saturday: the ring is on Thursday 29.10, not before 10:00 and not on Friday.
  assert.deepEqual(rings([a, b], IL(2026, 10, 29, 9, 59)), []);
  const got = rings([a, b], IL(2026, 10, 29, 10, 0));
  assert.equal(got.length, 2);
  const r = got.find((x) => x.clientId === a.id);
  assert.deepEqual([r.person, r.level, r.exempt, r.title, r.body, r.url], [
    'irit', 'ring', null, 'לקבוע יום צילום חודשי: שטיחי רות',
    'ללקוח יש יום צילום כל חודש. לקבוע איתו את יום הצילום של נובמבר.', `client.html?id=${a.id}`]);
  assert.equal(r.key, `monthlyShoot:${a.id}:${a.id}@2026-11:irit@irit`);
  assert.equal(+r.at, +IL(2026, 10, 29, 10));
  // Once: with it in the log nothing more is due that day.
  const log = got.map((x) => x.key);
  assert.equal(computeReminders({ ...world([a, b]), now: IL(2026, 10, 29, 15), log }).filter((x) => x.rule === 'monthlyShoot').length, 0);
  assert.deepEqual(rings([a], IL(2026, 10, 30, 10)), []);
  assert.deepEqual(rings([a], IL(2026, 10, 31, 10)), []);
  assert.deepEqual(rings([a], IL(2026, 10, 28, 10)), []);
  // Another month, another case (a key of its own), and the month's name.
  const nov = rings([a], IL(2026, 11, 30, 10));
  assert.deepEqual(nov.map((x) => [x.key, x.body]), [[`monthlyShoot:${a.id}:${a.id}@2026-12:irit@irit`, 'ללקוח יש יום צילום כל חודש. לקבוע איתו את יום הצילום של דצמבר.']]);
  assert.deepEqual(rings([a], IL(2026, 12, 31, 10)).map((x) => x.key), [`monthlyShoot:${a.id}:${a.id}@2027-01:irit@irit`]);
  // February: the 28th (Sunday), for March.
  const feb = rings([a], IL(2027, 2, 28, 10));
  assert.deepEqual(feb.map((x) => x.body), ['ללקוח יש יום צילום כל חודש. לקבוע איתו את יום הצילום של מרץ.']);
  assert.deepEqual(rings([a], IL(2027, 2, 26, 10)), []);
});

test('no ring: a client without the switch, an inactive client, in landing, or with next month\'s shoot day already set', () => {
  const now = IL(2026, 11, 30, 10);
  const plain = client({ deliverables: { videos: 8 } });
  const off = client({ deliverables: { shoot_monthly: false } });
  const ended = client({ status: 'ended' });
  const cancelled = client({ status: 'cancelled' });
  const landing = client({ landing: true });
  const set = client({ shoot_at: IL(2026, 12, 14, 11).toISOString() });
  const round = client({ shoot_at: IL(2026, 11, 10, 11).toISOString(), rounds: [{ n: 2, shoot_at: IL(2026, 12, 20, 11).toISOString() }] });
  const ending = client({ status: 'ending' });
  // This month's shoot does not count: next month's is still to set.
  const thisMonth = client({ shoot_at: IL(2026, 11, 12, 11).toISOString() });
  assert.deepEqual(rings([plain, off, ended, cancelled, landing, set, round, ending, thisMonth], now).map((r) => r.clientId).sort(), [ending.id, thisMonth.id].sort());
  assert.equal(hasShootIn(round, '2026-12'), true);
  assert.equal(hasShootIn(round, '2027-01'), false);
  // 1.12 00:30 Israel is already December (a moment in UTC still on 30.11).
  assert.equal(hasShootIn({ shoot_at: '2026-11-30T22:30:00Z' }, '2026-12'), true);
});

test('the rule is registered once', () => {
  assert.equal(RULES.filter((r) => r.id === 'monthlyShoot').length, 1);
});
