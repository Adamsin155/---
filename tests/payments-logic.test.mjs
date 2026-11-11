// "תשלומי לקוחות" (app/payments-logic.js; docs/ops.md, section 130): who sees and who writes,
// the latest deal per client, the summary, the filter and the form's parsing. Invented names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canSeePayments, canEditPayments, paymentRows, paymentSummary, filterPayments, NONE,
  parseMoney, parseCount, parseDay, dayText, moneyText, paymentProblem, paymentRecord, checksText, methodLabel,
} from '../app/payments-logic.js';

const owner = { me: null, scope: 'office', error: null };
const v = (me, scope = 'office') => ({ me, scope, error: null });

test('the owners see and write; Ofir sees only; nobody else', () => {
  assert.equal(canSeePayments(owner), true);
  assert.equal(canEditPayments(owner), true);
  assert.equal(canSeePayments(v('ofir')), true);
  assert.equal(canEditPayments(v('ofir')), false);
  for (const me of ['irit', 'lior', 'ilai', 'shiel', 'nadia', 'stav', 'eli']) {
    assert.equal(canSeePayments(v(me)), false, me);
    assert.equal(canEditPayments(v(me)), false, me);
  }
  assert.equal(canSeePayments(null), false);
  assert.equal(canSeePayments({ me: null, scope: 'own', error: null }), false, 'an unknown person is not an owner');
  assert.equal(canSeePayments({ me: null, scope: 'office', error: 'x' }), false);
});

const clients = [
  { id: 'a', name: 'דנה', business: 'אלון צמחים' },
  { id: 'b', name: 'משה', business: 'בית קפה' },
  { id: 'c', name: 'יעל', business: 'גולן מזגנים' },
  { id: 'd', name: 'רון', business: 'דפוס שלום' },
];
const pays = [
  { id: 1, client_id: 'a', amount: 21240, retainer: 1500, method: 'payment', deal_date: '2025-11-02', at: '2025-11-02T10:00:00Z' },
  { id: 2, client_id: 'a', amount: 28320, retainer: 2000, method: 'checks', checks_count: 12, first_check_date: '2026-11-01', deal_date: '2026-10-30', at: '2026-10-30T10:00:00Z' },
  { id: 3, client_id: 'b', amount: 49560, retainer: 3500, method: 'transfer', deal_date: '2026-03-01', at: '2026-03-01T10:00:00Z' },
  { id: 4, client_id: 'c', amount: 10000, retainer: null, method: null, deal_date: null, at: '2026-01-01T10:00:00Z' },
  { id: 5, client_id: 'zz', amount: 1, method: 'card', deal_date: '2026-01-01' }, // a client not in the list
];

test('a row per client: the latest deal on it, the older ones under it; clients with a deal first', () => {
  const rows = paymentRows(clients, pays);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c', 'd']);
  assert.equal(rows[0].latest.id, 2);
  assert.deepEqual(rows[0].older.map((p) => p.id), [1]);
  assert.equal(rows[0].method, 'checks');
  assert.equal(rows[2].method, NONE, 'a deal with no method is "לא הוזן"');
  assert.equal(rows[3].latest, null);
  assert.equal(rows[3].method, NONE);
  assert.equal(rows[0].label, 'אלון צמחים · דנה');
  // Same day: the one written last is the latest.
  const same = paymentRows([clients[0]], [
    { id: 'x', client_id: 'a', method: 'payment', deal_date: '2026-01-01', at: '2026-01-01T09:00:00Z' },
    { id: 'y', client_id: 'a', method: 'card', deal_date: '2026-01-01', at: '2026-01-02T09:00:00Z' }]);
  assert.equal(same[0].latest.id, 'y');
});

test('the summary: clients and sums per method, of the latest deal only', () => {
  const s = paymentSummary(paymentRows(clients, pays));
  assert.deepEqual(s.all, { key: '', label: 'כל הלקוחות', clients: 4, amount: 28320 + 49560 + 10000, retainer: 2000 + 3500 });
  const by = Object.fromEntries(s.methods.map((m) => [m.key, m]));
  assert.deepEqual(Object.keys(by), ['payment', 'checks', 'transfer', 'card', NONE]);
  assert.equal(by.payment.clients, 0, "the older פיימנט deal is not counted");
  assert.deepEqual([by.checks.clients, by.checks.amount, by.checks.retainer], [1, 28320, 2000]);
  assert.equal(by.transfer.clients, 1);
  assert.equal(by.card.clients, 0);
  assert.deepEqual([by[NONE].clients, by[NONE].amount, by[NONE].label], [2, 10000, 'לא הוזן']);
  assert.equal(paymentSummary([]).all.clients, 0);
});

test('the filter: by method, "לא הוזן", and a part of the name', () => {
  const rows = paymentRows(clients, pays);
  assert.deepEqual(filterPayments(rows, {}).map((r) => r.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(filterPayments(rows, { method: 'checks' }).map((r) => r.id), ['a']);
  assert.deepEqual(filterPayments(rows, { method: NONE }).map((r) => r.id), ['c', 'd']);
  assert.deepEqual(filterPayments(rows, { method: 'card' }), []);
  assert.deepEqual(filterPayments(rows, { q: 'קפה' }).map((r) => r.id), ['b']);
  assert.deepEqual(filterPayments(rows, { q: ' יעל ', method: NONE }).map((r) => r.id), ['c']);
});

test('money, counts and days as typed', () => {
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('21,240'), 21240);
  assert.equal(parseMoney('₪ 1500.5'), 1500.5);
  assert.ok(Number.isNaN(parseMoney('אלף')));
  assert.ok(Number.isNaN(parseMoney('-5')));
  assert.equal(parseCount(' 12 '), 12);
  assert.equal(parseCount(''), null);
  assert.ok(Number.isNaN(parseCount('1.5')));
  assert.equal(parseDay('1.12.2026'), '2026-12-01');
  assert.equal(parseDay('01/12/26'), '2026-12-01');
  assert.equal(parseDay('15-11-2026'), '2026-11-15');
  assert.equal(parseDay(''), null);
  assert.ok(Number.isNaN(parseDay('31.2.2026')));
  assert.ok(Number.isNaN(parseDay('2026-12-01')));
  assert.equal(dayText('2026-12-01'), '1.12.2026');
  assert.equal(moneyText(null), 'לא הוזן');
  assert.match(moneyText(21240), /^21,240 ₪$/);
  assert.equal(methodLabel(null), 'לא הוזן');
  assert.equal(methodLabel('transfer'), 'העברה בנקאית');
});

test('the form: the problem to show, and the row it writes', () => {
  const f = { amount: '28,320', retainer: '2000', method: 'checks', checks_count: '12', first_check_date: '1.12.2026', deal_date: '30.10.2026', note: ' ' };
  assert.equal(paymentProblem(f), null);
  assert.deepEqual(paymentRecord(f), { amount: 28320, retainer: 2000, method: 'checks', checks_count: 12, first_check_date: '2026-12-01', deal_date: '2026-10-30', note: null });
  assert.match(paymentProblem({ ...f, amount: 'abc' }), /סכום העסקה/);
  assert.match(paymentProblem({ ...f, checks_count: '0' }), /מספר השיקים/);
  assert.match(paymentProblem({ ...f, first_check_date: '32.1.2026' }), /השיק הראשון/);
  assert.match(paymentProblem({ ...f, deal_date: 'אתמול' }), /תאריך העסקה/);
  // Not cheques: the cheques' fields are not checked and not written.
  const pay = { ...f, method: 'payment', checks_count: 'x', first_check_date: 'y' };
  assert.equal(paymentProblem(pay), null);
  assert.deepEqual([paymentRecord(pay).checks_count, paymentRecord(pay).first_check_date], [null, null]);
  // Everything empty is allowed ("לא הוזן").
  assert.equal(paymentProblem({}), null);
  assert.deepEqual(paymentRecord({}), { amount: null, retainer: null, method: null, checks_count: null, first_check_date: null, deal_date: null, note: null });
  assert.equal(checksText({ method: 'checks', checks_count: 12, first_check_date: '2026-12-01' }), '12 שיקים · הראשון ב־1.12.2026');
  assert.equal(checksText({ method: 'checks', checks_count: 1 }), 'שיק אחד');
  assert.equal(checksText({ method: 'payment', checks_count: 3 }), '');
});
