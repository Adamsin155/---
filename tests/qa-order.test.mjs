// Ofir's lists in qa.html (the owner's review, 20.10.2026): what has a clock first, the late
// before the rest and then by due time; a client in landing ("בקליטה", no clock) last.
import test from 'node:test';
import assert from 'node:assert/strict';
import { byClock } from '../app/qa-logic.js';

test('qa.html: late first, then by due time; landing last (queue and waiting for an editor)', () => {
  const at = (h) => new Date(Date.UTC(2026, 9, 20, h));
  const list = [
    { key: 'landing-early', landing: true, late: false, dueAt: at(1) },
    { key: 'later', landing: false, late: false, dueAt: at(9) },
    { key: 'late', landing: false, late: true, dueAt: at(5) },
    { key: 'sooner', landing: false, late: false, dueAt: at(7) },
    { key: 'no-due', landing: false, late: false, dueAt: null },
    { key: 'fast', landing: false, late: false, dueAt: at(10), fast: { dueAt: at(6) } },
  ];
  assert.deepEqual([...list].sort(byClock).map((x) => x.key), ['late', 'fast', 'sooner', 'later', 'no-due', 'landing-early']);
  // awaitingEditor's items say late through their state when `late` is not given.
  const w = [{ key: 'a', dueAt: at(9), state: { status: 'open' } }, { key: 'b', dueAt: at(12), state: { status: 'overdue' } }];
  assert.deepEqual(w.sort(byClock).map((x) => x.key), ['b', 'a']);
});
