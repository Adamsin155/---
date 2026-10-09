// "Late" is one number per person (docs/ops.md, section 50): the "באיחור" tab of
// "המשימות שלי" counts with app/late-chain.js, as the owners' end-of-day table does, and
// the address of the tab is part of "המשימות שלי". Against the invented office of
// tests/late-world.mjs (Tuesday 20.10.2026, 10:00 in Israel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lateWorld, NOW, cid, SENT } from './late-world.mjs';
import { lateItems, heldLate, countsLate, dueAtCloseToday, lateKey, LATE_URL } from '../app/late-chain.js';
import { daySummary } from '../app/day-summary.js';
import { clientState } from '../app/protocol-logic.js';
import { STAFF_PEOPLE } from '../app/protocol.js';
import { isMineHash, profileOf, currentOf, menuOf, inMenu } from '../app/shell-rules.js';
import { RULES } from '../app/reminder-rules.js';
import { dateIL } from '../app/tz.js';

function officeAt(now = NOW) {
  const db = lateWorld();
  const checks = {};
  for (const r of db.protocol_checks) (checks[r.client_id] ||= {})[r.item_key] = r;
  const args = { clients: db.clients, checksOf: (c) => checks[c.id] || {}, stateOf: (c) => clientState(c, checks[c.id] || {}, now), tasks: db.client_tasks.filter((t) => !t.done_at), now };
  return { db, args, items: lateItems(args), sum: daySummary(args) };
}

test('the tab\'s count for every person is that person\'s row in the owners\' table', () => {
  const { items, sum } = officeAt();
  let some = 0;
  for (const p of STAFF_PEOPLE()) {
    const mine = heldLate(items, p.key, NOW);
    assert.equal(mine.length, sum.rows.find((r) => r.person === p.key)?.late || 0, p.key);
    some += mine.length;
    // Worst first: the oldest deadline leads.
    assert.deepEqual(mine.map((x) => +x.dueAt), mine.map((x) => +x.dueAt).sort((a, b) => a - b), p.key);
    assert.equal(new Set(mine.map(lateKey)).size, mine.length, `${p.key}: a key per item`);
  }
  assert.ok(some > 0, 'the world has late work');
});

test('the client\'s turn, a client in landing and a deadline at today\'s close are nobody\'s lateness', () => {
  const { items, db } = officeAt();
  const turn = items.find((x) => x.cid === SENT && x.procId === 'p07');
  assert.ok(turn?.clientTurn, 'the 9 graphics were sent and the client did not answer');
  assert.equal(countsLate(turn, NOW), false);
  assert.equal(STAFF_PEOPLE().some((p) => heldLate(items, p.key, NOW).includes(turn)), false);
  // The late task of a client in landing is not an item at all.
  assert.ok(db.client_tasks.some((t) => t.client_id === cid(31) && t.due_on < '2026-10-20'));
  assert.equal(items.some((x) => x.cid === cid(31)), false);
  // 18:30 of a day whose deadline was 18:00: "of today, not done" until tomorrow, on the tab as in the table.
  const evening = dateIL(2026, 10, 20, 18, 30);
  const later = officeAt(evening);
  for (const x of later.items.filter((i) => dueAtCloseToday(i, evening))) assert.equal(countsLate(x, evening), false);
  for (const p of STAFF_PEOPLE()) assert.equal(heldLate(later.items, p.key, evening).length, later.sum.rows.find((r) => r.person === p.key)?.late || 0, `${p.key} at 18:30`);
  const morning = dateIL(2026, 10, 21, 9, 30);
  const next = officeAt(morning);
  assert.ok(next.items.every((x) => !dueAtCloseToday(x, morning) || x.dueAt > dateIL(2026, 10, 21, 0, 0)));
});

test('the address of the tab (#late) is "המשימות שלי": the personal profile, the same menu entry', () => {
  assert.equal(LATE_URL, 'clients.html#late');
  for (const h of ['', '#mine', '#late']) assert.equal(isMineHash(h), true, h);
  for (const h of ['#clients', '#control', '#team', '#performance']) assert.equal(isMineHash(h), false, h);
  for (const me of ['irit', 'ofir', 'lior', null]) {
    const viewer = { me, scope: 'office', error: null };
    assert.equal(profileOf(viewer, '/clients.html', '#late', '', 'manager'), 'mine', String(me));
    assert.equal(currentOf(menuOf(viewer), '/clients.html', '#late').id, 'mine', String(me));
    assert.equal(inMenu(menuOf(viewer), '/clients.html', '#late'), true);
  }
  for (const me of ['ilai', 'nadia', 'eli']) assert.equal(currentOf(menuOf({ me, scope: 'own', error: null }), '/clients.html', '#late').id, 'mine', me);
});

test('the twice-a-day reminder about several late items opens the tab; about one, the item itself', () => {
  const nag = RULES.find((r) => r.id === 'lateNag');
  const item = (n) => ({ kind: 'proc', cid: `c${n}`, procId: 'p07', name: `לקוח ${n}`, what: '7 · הכנת 9 גרפיקות ראשונות', dueAt: dateIL(2026, 10, 19, 12) });
  const env = { now: NOW };
  const stepOf = (items) => nag.steps({ who: 'ilai', items, slot: { t: '09:00', at: dateIL(2026, 10, 20, 9) } }, env)[0];
  assert.equal(stepOf([item(1), item(2)]).url(), 'clients.html#late');
  assert.equal(stepOf([item(1)]).url(), 'client.html?id=c1#p07');
});
