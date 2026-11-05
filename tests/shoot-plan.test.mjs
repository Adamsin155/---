// "עם מי כל יום צילום" (5.11.2026): app/shoot-plan.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shootDays, planOf, withPlan, plannedFor } from '../app/shoot-plan.js';

const bestCar = { shoot_type: 'natali', shoot_at: null, rounds: [], deliverables: { videos: 36, shoot_days: 2, shoot_plan: { 2: 'dms' } } };

test('two days in the contract: one with Natali, one with Denis-Michel-Semion', () => {
  const d = shootDays(bestCar);
  assert.equal(d.length, 2);
  assert.equal(d[0].n, 1); assert.match(d[0].who, /נטלי/); assert.equal(d[0].added, true);
  assert.equal(d[1].n, 2); assert.match(d[1].who, /סמיון/); assert.equal(d[1].added, false);
  assert.equal(plannedFor(bestCar, 2), 'dms');
});

test('a day with nobody chosen yet says so, and one day is just day 1', () => {
  const d = shootDays({ ...bestCar, deliverables: { shoot_days: 3 } });
  assert.deepEqual(d.map((x) => x.who === ''), [false, true, true]);
  assert.equal(shootDays({ shoot_type: 'natali', deliverables: { shoot_days: 1 } }).length, 1);
  assert.equal(shootDays({ shoot_type: 'natali', deliverables: {} }).length, 1);
});

test('an added round is its own day, with its own influencer, and the plan fills the rest', () => {
  const c = { ...bestCar, deliverables: { shoot_days: 3, shoot_plan: { 3: 'dms' } }, rounds: [{ n: 2, shoot_type: 'dms', shoot_at: '2026-12-01T08:00:00Z' }] };
  const d = shootDays(c);
  assert.deepEqual(d.map((x) => [x.n, x.added]), [[1, true], [2, true], [3, false]]);
  assert.match(d[1].who, /סמיון/); assert.equal(d[1].at, '2026-12-01T08:00:00Z');
  assert.match(d[2].who, /סמיון/);
});

test('a monthly editing round is not a shoot day', () => {
  const c = { ...bestCar, rounds: [{ n: 2, monthly: true, month: '2026-11' }] };
  assert.equal(shootDays(c).filter((x) => x.added).length, 1);
});

test('withPlan keeps only known influencers on days 2..total, and drops an empty plan', () => {
  assert.deepEqual(withPlan({ shoot_days: 2 }, { 2: 'dms', 3: 'natali', 1: 'dms' }).shoot_plan, { 2: 'dms' });
  assert.equal('shoot_plan' in withPlan({ shoot_days: 2, shoot_plan: { 2: 'dms' } }, { 2: '' }), false);
  assert.equal('shoot_plan' in withPlan({ shoot_days: 2 }, { 2: 'nobody' }), false);
  assert.deepEqual(planOf({ deliverables: { shoot_plan: { 2: 'dms', 3: 'x', a: 'dms' } } }), { 2: 'dms' });
  assert.deepEqual(planOf({}), {});
});
