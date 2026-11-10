// "מעקב לקוחות", the tab "ימי צילום" (Irit, 10.11.2026): app/tracking-shoots-logic.js.
// Invented clients; the clock is Monday 9.11.2026, 12:00 in Israel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasShootDays, typeNames, benefitsOf, setHash, shootRow, shootRows, sortShoots, shootTiles, typeOptions, monthOptions,
  filterShoots, waitingLine, totalText, remainingText, dealText, monthLabel, MONTHLY_WORDS,
} from '../app/tracking-shoots-logic.js';

const NOW = new Date('2026-11-09T12:00:00+02:00');
const base = (over = {}) => ({
  id: 'c1', name: 'דנה כהן', business: 'קפה דנה', status: 'active', editor: null, rounds: [],
  shoot_type: 'natali', deal_at: '2026-08-01T09:00:00+03:00', shoot_at: null,
  deliverables: { videos: 36, graphics: 36, shoot_days: 1 }, ...over,
});

test('who is entitled: a number of shoot days (also photo days), or one every month', () => {
  assert.equal(hasShootDays(base()), true);
  assert.equal(hasShootDays(base({ deliverables: { shoot_days: 0, photo_days: 1 } })), true);
  assert.equal(hasShootDays(base({ deliverables: { videos: 10 } })), false);
  assert.equal(hasShootDays(base({ deliverables: { shoot_monthly: true } })), true);
  const rows = shootRows([base(), base({ id: 'c2', deliverables: { videos: 5 } }), base({ id: 'c3', status: 'ended' }), base({ id: 'c4', status: 'ending' })], {}, NOW);
  assert.deepEqual(rows.map((r) => r.id).sort(), ['c1', 'c4'], 'in work and entitled only');
});

test('nothing set: waiting, the button opens process 11 in the card', () => {
  const r = shootRow(base(), {}, NOW);
  assert.equal(r.total, 1);
  assert.equal(r.remaining, 1);
  assert.equal(r.status, 'waiting');
  assert.equal(r.statusText, 'ממתין לקביעה');
  assert.deepEqual(r.action, { text: 'קביעת יום צילום', href: 'client.html?id=c1#p11', set: true });
  assert.equal(r.dealMonth, '2026-08');
});

test('a shoot day ahead: set, with its date; the button only opens the card', () => {
  const r = shootRow(base({ shoot_at: '2026-11-20T10:00:00+02:00' }), {}, NOW);
  assert.equal(r.status, 'set');
  assert.equal(r.statusText, 'נקבע · 20.11');
  assert.equal(r.remaining, 1, 'not held yet');
  assert.deepEqual(r.action, { text: 'צפה בפרטים', href: 'client.html?id=c1', set: false });
});

test('two days, one held: waiting for the second, the button adds the next day', () => {
  const r = shootRow(base({ shoot_at: '2026-10-01T10:00:00+03:00', deliverables: { shoot_days: 2 } }), {}, NOW);
  assert.equal(r.total, 2);
  assert.equal(r.held, 1);
  assert.equal(r.remaining, 1);
  assert.equal(r.status, 'waiting');
  assert.equal(r.action.href, 'client.html?id=c1#add-round');
  // A round already added without a date: that round.
  const r2 = shootRow(base({ shoot_at: '2026-10-01T10:00:00+03:00', deliverables: { shoot_days: 2 }, rounds: [{ n: 2, shoot_at: null }] }), {}, NOW);
  assert.equal(r2.action.href, 'client.html?id=c1#round-2');
});

test('every day held: done, nothing to set', () => {
  const r = shootRow(base({ shoot_at: '2026-09-10T11:00:00+03:00' }), {}, NOW);
  assert.equal(r.remaining, 0);
  assert.equal(r.status, 'done');
  assert.equal(r.statusText, 'בוצעו כולם');
  assert.equal(r.action.text, 'צפה בפרטים');
});

test('every month: by the current month', () => {
  const m = (over) => base({ deliverables: { shoot_monthly: true }, shoot_at: '2026-09-15T11:00:00+03:00', ...over });
  const waiting = shootRow(m(), {}, NOW);
  assert.equal(waiting.monthly, true);
  assert.equal(waiting.status, 'waiting', 'nothing this month, nothing ahead');
  assert.equal(totalText(waiting), 'כל חודש');
  assert.equal(remainingText(waiting), '—');
  assert.equal(waiting.action.href, 'client.html?id=c1#add-round');
  // Shot earlier this month: set for this month.
  const shot = shootRow(m({ rounds: [{ n: 2, shoot_at: '2026-11-03T10:00:00+02:00' }] }), {}, NOW);
  assert.equal(shot.status, 'set');
  assert.equal(shot.statusText, 'צולם החודש · 3.11');
  // One ahead (next month): set.
  const ahead = shootRow(m({ rounds: [{ n: 2, shoot_at: '2026-12-03T10:00:00+02:00' }] }), {}, NOW);
  assert.equal(ahead.statusText, 'נקבע · 3.12');
  // A monthly editing round is not a shoot day.
  const edit = shootRow(m({ rounds: [{ n: 2, monthly: true, month: '2026-11', shoot_at: '2026-11-03T10:00:00+02:00' }] }), {}, NOW);
  assert.equal(edit.status, 'waiting');
  // With a number of days too: the number shows.
  assert.equal(totalText(shootRow(m({ deliverables: { shoot_monthly: true, shoot_days: 5 } }), {}, NOW)), '5');
});

test('the type: who comes on each day, each name once; the plan of a day not added yet', () => {
  assert.deepEqual(typeNames(base()), ['נטלי דדון']);
  assert.deepEqual(typeNames(base({ deliverables: { shoot_days: 2, shoot_plan: { 2: 'dms' } } })), ['נטלי דדון', 'דניס, מישל וסמיון']);
  assert.deepEqual(typeNames(base({ deliverables: { shoot_days: 2 } })), ['נטלי דדון']);
  assert.deepEqual(typeNames(base({ shoot_type: null })), []);
});

test('the benefit: Semion joins, and the lines added by hand', () => {
  assert.deepEqual(benefitsOf(base()), []);
  const b = benefitsOf(base({ deliverables: { shoot_days: 1, simeon_join: 1, extra: [{ label: 'צילומי מוצר', qty: 2 }, { label: '  ' }, { label: 'מתנה' }] } }));
  assert.equal(b.length, 3);
  assert.match(b[0], /סמיון/);
  assert.deepEqual(b.slice(1), ['צילומי מוצר × 2', 'מתנה']);
});

test('the order: waiting first, the oldest deal first; then set, then done', () => {
  const rows = [
    { id: 'a', status: 'set', dealAt: new Date('2026-01-01'), label: 'א' },
    { id: 'b', status: 'waiting', dealAt: new Date('2026-09-01'), label: 'ב' },
    { id: 'c', status: 'waiting', dealAt: new Date('2026-03-01'), label: 'ג' },
    { id: 'd', status: 'waiting', dealAt: null, label: 'ד' },
    { id: 'e', status: 'done', dealAt: new Date('2025-01-01'), label: 'ה' },
  ];
  assert.deepEqual(sortShoots(rows).map((r) => r.id), ['c', 'b', 'd', 'a', 'e']);
});

const sample = () => shootRows([
  base({ id: 'w1', business: 'Pizza Roma', deal_at: '2026-06-01T09:00:00+03:00' }),
  base({ id: 's2', business: 'מוסך אבי', shoot_at: '2026-10-01T10:00:00+03:00', rounds: [{ n: 2, shoot_at: '2026-11-20T10:00:00+02:00' }], deliverables: { shoot_days: 2 } }),
  base({ id: 'w3', business: 'גלידה', deal_at: '2026-09-01T09:00:00+03:00', shoot_type: 'dms', deliverables: { shoot_days: 3 } }),
  base({ id: 'm4', business: 'אלאור בוטיק', shoot_at: '2026-11-03T10:00:00+02:00', deliverables: { shoot_monthly: true, shoot_days: 2 } }),
  base({ id: 'd5', business: 'קפה דנה', shoot_at: '2026-09-10T11:00:00+03:00' }),
], {}, NOW);

test('the tiles, the line under the table', () => {
  const rows = sample();
  assert.deepEqual(rows.map((r) => r.id), ['w1', 'w3', 'm4', 's2', 'd5']);
  assert.deepEqual(shootTiles(rows), { waiting: 2, two: 2, three: 1, monthly: 1 });
  assert.equal(waitingLine(rows), 'סה״כ: 2 לקוחות שטרם נקבע להם יום צילום');
  assert.equal(waitingLine(rows.slice(0, 1)), 'סה״כ: לקוח אחד שטרם נקבע לו יום צילום');
  assert.equal(waitingLine([]), 'אין כאן לקוחות שממתינים לקביעת יום צילום');
});

test('the filters: status, type, deal month, name', () => {
  const rows = sample();
  const ids = (f) => filterShoots(rows, f).map((r) => r.id);
  assert.equal(ids({}).length, 5);
  assert.deepEqual(ids({ status: 'waiting' }), ['w1', 'w3']);
  assert.deepEqual(ids({ status: 'set' }), ['m4', 's2']);
  assert.deepEqual(ids({ type: 'monthly' }), ['m4']);
  assert.deepEqual(ids({ type: 'דניס, מישל וסמיון' }), ['w3']);
  assert.deepEqual(ids({ month: '2026-06' }), ['w1']);
  assert.deepEqual(ids({ q: '  PIZZA ' }), ['w1']);
  assert.deepEqual(ids({ q: 'פיצה' }), []);
  assert.deepEqual(typeOptions(rows), [
    { value: 'דניס, מישל וסמיון', label: 'דניס, מישל וסמיון' },
    { value: 'נטלי דדון', label: 'נטלי דדון' },
    { value: 'monthly', label: MONTHLY_WORDS },
  ]);
  assert.deepEqual(monthOptions(rows), [{ value: '2026-09', label: 'ספטמבר 2026' }, { value: '2026-08', label: 'אוגוסט 2026' }, { value: '2026-06', label: 'יוני 2026' }]);
});

test('the words', () => {
  assert.equal(monthLabel('2026-11'), 'נובמבר 2026');
  assert.equal(monthLabel(''), '');
  assert.equal(dealText(new Date('2026-08-01T09:00:00+03:00')), '1.8.2026');
  assert.equal(dealText(null), '—');
  assert.equal(setHash(base()), '#p11');
});
