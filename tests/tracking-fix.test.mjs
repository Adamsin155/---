// "מעקב לקוחות": a number fixed by hand (Irit, 10.11.2026): app/tracking-fix-logic.js, and how
// the rows of app/tracking-logic.js and app/tracking-shoots-logic.js show it. Invented clients;
// the clock is Monday 9.11.2026, 12:00 in Israel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCount, fixOf, withFix, changedOnly, applyCount, applyShootCount, fixLine, problemOf,
  canFix, canFixKind, canOpenTracking, onlyFirstTab, byKey,
} from '../app/tracking-fix-logic.js';
import { trackingRows } from '../app/tracking-logic.js';
import { shootRow } from '../app/tracking-shoots-logic.js';

const NOW = new Date('2026-11-09T12:00:00+02:00');
const AT = '2026-11-10T09:00:00+02:00';
const base = (over = {}) => ({
  id: 'c1', name: 'דנה כהן', business: 'קפה דנה', status: 'active', editor: 'nadia', editor2: null, rounds: [],
  shoot_type: 'natali', deal_at: '2026-08-01T09:00:00+03:00', shoot_at: '2026-09-10T11:00:00+03:00',
  deliverables: { videos: 36, graphics: 36, shoot_days: 2 }, ...over,
});
const V = (me, scope = 'office') => ({ me, scope, error: null });
const OWNER = { me: null, scope: 'office', error: null };

test('who fixes: Irit and the owners all; Ilai the graphics only; Lior and Ofir read', () => {
  assert.equal(canFix(V('irit')), true);
  assert.equal(canFix(OWNER), true);
  for (const p of ['lior', 'ofir', 'ilai', 'nadia']) assert.equal(canFix(V(p, p === 'nadia' ? 'own' : 'office')), false, p);
  assert.equal(canFixKind(V('ilai'), 'graphics'), true);
  assert.equal(canFixKind(V('ilai'), 'videos'), false);
  assert.equal(canFixKind(V('ilai'), 'shoots'), false);
  assert.equal(canFixKind(V('lior'), 'graphics'), false);
  assert.equal(canFixKind({ me: 'irit', error: 'x' }, 'graphics'), false, 'not identified');
  assert.equal(canOpenTracking(V('ilai')), true);
  assert.equal(onlyFirstTab(V('ilai')), true);
  assert.equal(onlyFirstTab(V('lior')), false);
  assert.equal(canOpenTracking(V('lior')), true);
  assert.equal(canOpenTracking(V('nadia', 'own')), false);
  assert.equal(byKey(OWNER), 'owner');
  assert.equal(byKey(V('irit')), 'irit');
});

test('a typed number: empty is none, digits only, up to 999', () => {
  assert.equal(parseCount(''), null);
  assert.equal(parseCount('  '), null);
  assert.equal(parseCount('15'), 15);
  assert.equal(parseCount(' 0 '), 0);
  assert.ok(Number.isNaN(parseCount('1.5')));
  assert.ok(Number.isNaN(parseCount('-3')));
  assert.ok(Number.isNaN(parseCount('abc')));
  assert.ok(Number.isNaN(parseCount('1000')));
});

test('kept in deliverables.tracking; the rest of deliverables untouched; emptied: gone', () => {
  const d0 = { videos: 36, shoot_monthly: true };
  const d1 = withFix(d0, 'videos', { done: 15, of: 40 }, { by: 'irit', at: AT });
  assert.deepEqual(d1, { videos: 36, shoot_monthly: true, tracking: { videos: { done: 15, of: 40, by: 'irit', at: AT } } });
  assert.deepEqual(d0, { videos: 36, shoot_monthly: true }, 'not changed in place');
  const d2 = withFix(d1, 'graphics', { done: 9, of: null }, { by: 'ilai', at: AT });
  assert.deepEqual(d2.tracking.graphics, { done: 9, by: 'ilai', at: AT });
  assert.deepEqual(d2.tracking.videos, d1.tracking.videos);
  const d3 = withFix(d2, 'videos', null);
  assert.deepEqual(Object.keys(d3.tracking), ['graphics']);
  const d4 = withFix(d3, 'graphics', { done: null, of: null });
  assert.equal('tracking' in d4, false, 'nothing left: the key itself goes');
  assert.equal(d4.videos, 36);
  const s = withFix({}, 'shoots', { held: 1, agreed: 3, status: 'set' }, { by: 'owner', at: AT });
  assert.deepEqual(s.tracking.shoots, { held: 1, agreed: 3, status: 'set', by: 'owner', at: AT });
  assert.equal(withFix({}, 'shoots', { status: 'nonsense' }).tracking, undefined);
  const m = withFix({}, 'videos', { done: 5 }, { by: 'irit', at: AT, month: '2026-11' });
  assert.equal(m.tracking.videos.month, '2026-11');
});

test('fixOf reads it back, cleaned', () => {
  const c = base({ deliverables: { tracking: { videos: { done: 15, of: 'x', by: 'irit', at: AT }, shoots: { status: 'waiting', by: 'irit', at: AT } } } });
  assert.deepEqual(fixOf(c, 'videos'), { done: 15, by: 'irit', at: AT });
  assert.deepEqual(fixOf(c, 'shoots'), { status: 'waiting', by: 'irit', at: AT });
  assert.equal(fixOf(c, 'graphics'), null);
  assert.equal(fixOf(base(), 'videos'), null);
  assert.equal(fixOf(base({ deliverables: { tracking: { videos: { by: 'irit' } } } }), 'videos'), null, 'no number: no fix');
});

test('only what differs from the count is kept', () => {
  assert.deepEqual(changedOnly('videos', { done: 12, of: 40 }, { done: 12, of: 36 }), { done: null, of: 40 });
  assert.deepEqual(changedOnly('videos', { done: null, of: 36 }, { done: 12, of: 36 }), { done: null, of: null });
  assert.deepEqual(changedOnly('shoots', { held: 1, agreed: 2, status: 'set' }, { held: 1, agreed: 2, status: 'waiting' }), { held: null, agreed: null, status: 'set' });
});

test('the check: a number or empty; never more done than the package', () => {
  assert.equal(problemOf('videos', { done: 15, of: 40 }, { done: 12, of: 36 }), '');
  assert.match(problemOf('videos', { done: 41, of: 40 }, { done: 12, of: 36 }), /יותר ממה שבחבילה/);
  assert.match(problemOf('videos', { done: 37, of: null }, { done: 12, of: 36 }), /יותר/, 'against the count\'s "of"');
  assert.match(problemOf('graphics', { done: NaN, of: null }, { done: 0, of: 20 }), /מספר שלם/);
  assert.match(problemOf('shoots', { held: 3, agreed: 2 }, { held: 1, agreed: 2 }), /ימים/);
  assert.equal(problemOf('videos', { done: 5, of: null }, { done: 0, of: null }), '');
});

test('a fix stands in place of the count, with the count kept and who fixed it', () => {
  const x = applyCount({ done: 12, of: 36, month: false }, { done: 15, of: 40, by: 'irit', at: AT });
  assert.deepEqual(x, { done: 15, of: 40, month: false, auto: { done: 12, of: 36 }, fix: { by: 'irit', at: AT } });
  assert.deepEqual(applyCount({ done: 12, of: 36 }, { of: 40, by: 'irit', at: AT }).done, 12, 'a field not typed is the count\'s');
  assert.deepEqual(applyCount({ done: 2, of: 8, month: true }, null), { done: 2, of: 8, month: true });
  // A monthly client: a fix of another month is old.
  assert.equal(applyCount({ done: 2, of: 8 }, { done: 5, month: '2026-10', by: 'irit', at: AT }, { month: '2026-11' }).done, 2);
  assert.equal(applyCount({ done: 2, of: 8 }, { done: 5, month: '2026-11', by: 'irit', at: AT }, { month: '2026-11' }).done, 5);
  assert.equal(applyCount({ done: 2, of: 8 }, { done: 5, by: 'irit', at: AT }, { month: '2026-11' }).done, 2, 'kept without a month: not this month\'s');
  const s = applyShootCount({ done: 1, of: 2, last: null, next: null }, { held: 2, agreed: 3, by: 'irit', at: AT });
  assert.equal(s.done, 2);
  assert.equal(s.of, 3);
  assert.equal(applyShootCount({ done: 1, of: 2 }, { status: 'set', by: 'irit', at: AT }).fix, undefined, 'a status alone is not a count');
});

test('"עודכן ביד · עירית · 10.11"; the owners as "הבעלים"', () => {
  assert.equal(fixLine({ by: 'irit', at: AT }), 'עודכן ביד · עירית · 10.11');
  assert.equal(fixLine({ by: 'owner', at: AT }), 'עודכן ביד · הבעלים · 10.11');
  assert.equal(fixLine({ by: 'ilai', at: '' }), 'עודכן ביד · עילאי');
  assert.equal(fixLine(null), '');
});

test('the first tab: the fixed numbers in the rows; emptied, the count again', () => {
  const fixed = base({ deliverables: { videos: 36, graphics: 36, shoot_days: 2, tracking: {
    videos: { done: 15, of: 40, by: 'irit', at: AT }, graphics: { done: 20, by: 'ilai', at: AT }, shoots: { held: 2, by: 'irit', at: AT } } } });
  const [r] = trackingRows([fixed], {}, NOW);
  assert.equal(r.videos.done, 15);
  assert.equal(r.videos.of, 40);
  assert.deepEqual(r.videos.auto, { done: 0, of: 36 });
  assert.equal(r.graphics.done, 20);
  assert.equal(r.graphics.of, 36);
  assert.equal(r.shoots.done, 2);
  assert.equal(r.shoots.of, 2);
  const [plain] = trackingRows([{ ...fixed, deliverables: withFix(withFix(withFix(fixed.deliverables, 'videos', null), 'graphics', null), 'shoots', null) }], {}, NOW);
  assert.equal(plain.videos.done, 0);
  assert.equal(plain.videos.of, 36);
  assert.equal(plain.videos.fix, undefined);
  assert.equal(plain.shoots.done, 1);
});

test('the tab "ימי צילום": total, remaining and status fixed; the count kept beside', () => {
  const c = base({ deliverables: { shoot_days: 2, tracking: { shoots: { agreed: 3, held: 1, status: 'set', by: 'irit', at: AT } } } });
  const r = shootRow(c, {}, NOW);
  assert.equal(r.total, 3);
  assert.equal(r.held, 1);
  assert.equal(r.remaining, 2);
  assert.equal(r.status, 'set');
  assert.equal(r.statusText, 'נקבע', 'set by hand, no date');
  assert.equal(r.action.text, 'צפה בפרטים');
  assert.deepEqual(r.auto, { held: 1, agreed: 2, status: 'waiting' });
  assert.equal(r.fix.by, 'irit');
  const w = shootRow(base({ shoot_at: '2026-11-20T10:00:00+02:00', deliverables: { shoot_days: 2, tracking: { shoots: { status: 'waiting', by: 'irit', at: AT } } } }), {}, NOW);
  assert.equal(w.status, 'waiting');
  assert.equal(w.statusText, 'ממתין לקביעה');
  assert.equal(w.action.text, 'קביעת יום צילום');
  const done = shootRow(base({ deliverables: { shoot_days: 2, tracking: { shoots: { held: 2, by: 'irit', at: AT } } } }), {}, NOW);
  assert.equal(done.remaining, 0);
  assert.equal(done.status, 'done', 'every day held, by hand');
  const none = shootRow(base({ deliverables: { shoot_days: 2 } }), {}, NOW);
  assert.equal(none.fix, null);
  assert.equal(none.total, 2);
});
