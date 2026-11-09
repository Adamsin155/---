// "מעקב לקוחות" (tracking.html; the owner, 9.11.2026): the counting of app/tracking-logic.js.
// Invented clients; the clock is Monday 9.11.2026, 12:00 in Israel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inWork, editorText, videosOf, graphicsOf, shootDaysOf, complete, ratioText, shootDates, trackingRows, searchTracking, clientsWord, dayMonth,
} from '../app/tracking-logic.js';

const NOW = new Date('2026-11-09T12:00:00+02:00');
const done = (k) => ({ [k]: { item_key: k, state: 'done', note: null } });
const base = (over = {}) => ({
  id: 'c1', name: 'דנה כהן', business: 'קפה דנה', status: 'active', editor: 'nadia', editor2: null, rounds: [],
  shoot_type: 'natali', deal_at: '2026-08-01T09:00:00+03:00', shoot_at: '2026-09-10T11:00:00+03:00',
  deliverables: { videos: 36, graphics: 36, shoot_days: 1 }, ...over,
});

test('who is in the list: active and ending (also in landing), never ended', () => {
  assert.equal(inWork({ status: 'active' }), true);
  assert.equal(inWork({ status: 'ending' }), true);
  assert.equal(inWork({ status: 'active', landing: true }), true);
  assert.equal(inWork({ status: 'ended' }), false);
  const rows = trackingRows([base(), base({ id: 'c2', status: 'ended' }), base({ id: 'c3', business: 'אבי מוסך', name: 'אבי' })], {}, NOW);
  assert.deepEqual(rows.map((r) => r.id), ['c3', 'c1'], 'by name, ended out');
});

test('the editor: the latest shoot that has one; two editors together; none', () => {
  assert.equal(editorText(base()), 'נדיה');
  assert.equal(editorText(base({ editor2: 'yariv' })), 'נדיה + יריב');
  assert.equal(editorText(base({ rounds: [{ n: 2, shoot_at: '2026-11-01T10:00:00+02:00', editor: 'anna' }] })), 'אנה');
  assert.equal(editorText(base({ rounds: [{ n: 2, shoot_at: '2026-12-01T10:00:00+02:00' }] })), 'נדיה', 'a round not assigned yet: the one before');
  assert.equal(editorText(base({ editor: null })), '');
});

test('videos: the editors\' counter, summed over the shoots', () => {
  const c = base({ deliverables: { videos: 24, graphics: 20, shoot_days: 2 }, rounds: [{ n: 2, shoot_at: '2026-11-01T10:00:00+02:00', editor: 'anna' }] });
  const progress = [
    { client_id: 'c1', editor: 'nadia', round: 1, edited: 7 },
    { client_id: 'c1', editor: 'anna', round: 2, edited: 3 },
    { client_id: 'c2', editor: 'nadia', round: 1, edited: 9 },   // another client
    { client_id: 'c1', editor: 'yariv', round: 1, edited: 5 },   // not this shoot's editor any more
  ];
  assert.deepEqual(videosOf(c, {}, progress, [], NOW), { done: 10, of: 24, month: false });
  // Nothing typed: 0 out of the package.
  assert.deepEqual(videosOf(c, {}, [], [], NOW), { done: 0, of: 24, month: false });
  // The progress table not readable (null): 0, never an error.
  assert.deepEqual(videosOf(c, {}, null, null, NOW), { done: 0, of: 24, month: false });
});

test('videos: a shoot whose editing is finished (p24.drive) counts its part, never above the package', () => {
  const c = base({ deliverables: { videos: 25, shoot_days: 2 }, rounds: [{ n: 2, shoot_at: '2026-11-01T10:00:00+02:00', editor: 'anna' }] });
  // The first shoot finished before the counter: its part, 13 (25 over 2 days, rounded up).
  assert.equal(videosOf(c, done('p24.drive'), [], [], NOW).done, 13);
  // Both finished: 13 + 13 = 26, but the package is 25.
  assert.equal(videosOf(c, { ...done('p24.drive'), ...done('r2.p24.drive') }, [], [], NOW).done, 25);
  // An editor who typed more than the package: shown as typed.
  assert.equal(videosOf(c, done('p24.drive'), [{ client_id: 'c1', editor: 'nadia', round: 1, edited: 27 }], [], NOW).done, 27);
  // Finished with a counter above its part: the counter.
  assert.equal(videosOf(c, done('p24.drive'), [{ client_id: 'c1', editor: 'nadia', round: 1, edited: 15 }], [], NOW).done, 15);
  // "Not relevant" is not finished.
  assert.equal(videosOf(c, { 'p24.drive': { state: 'na' } }, [], [], NOW).done, 0);
  // Two editors with a split: the shoot's part is their total.
  const two = base({ editor2: 'yariv', editor_split: { nadia: 20, yariv: 16 } });
  assert.equal(videosOf(two, done('p24.drive'), [], [], NOW).done, 36);
});

test('videos: a monthly client is this month\'s number', () => {
  const c = base({ deliverables: { videos_month: 8, videos_month_except: { '2026-11': 12 } } });
  const months = [
    { client_id: 'c1', editor: 'nadia', month: '2026-11', edited: 4 },
    { client_id: 'c1', editor: 'yariv', month: '2026-11', edited: 1 },
    { client_id: 'c1', editor: 'nadia', month: '2026-10', edited: 8 },
  ];
  assert.deepEqual(videosOf(c, {}, [], months, NOW), { done: 5, of: 12, month: true });
  const round = base({ deliverables: { videos_month: 8 }, rounds: [{ n: 2, month: '2026-11', monthly: true, editor: 'nadia' }] });
  assert.deepEqual(videosOf(round, done('r2.p24.drive'), [], months, NOW), { done: 8, of: 8, month: true });
});

test('graphics: 7ב is the first 9, 23ב all of them, the Gantt\'s "עלה" rows when more', () => {
  const c = base({ deliverables: { graphics: 36 } });
  assert.deepEqual(graphicsOf(c, {}, 0), { done: 0, of: 36 });
  assert.deepEqual(graphicsOf(c, done('p07b.posted'), 0), { done: 9, of: 36 });
  assert.deepEqual(graphicsOf(c, { ...done('p07b.posted'), ...done('p23b.posted') }, 0), { done: 36, of: 36 });
  assert.deepEqual(graphicsOf(c, done('p07b.posted'), 14), { done: 14, of: 36 });
  assert.deepEqual(graphicsOf(c, {}, 50), { done: 36, of: 36 }, 'never above the package');
  // A package with fewer than 9.
  assert.deepEqual(graphicsOf(base({ deliverables: { graphics: 6 } }), done('p07b.posted'), 0), { done: 6, of: 6 });
  // No number in the package.
  assert.deepEqual(graphicsOf(base({ deliverables: {} }), done('p07b.posted'), 0), { done: 9, of: null });
  assert.deepEqual(graphicsOf(base({ deliverables: {} }), {}, 0), { done: 0, of: null });
  // The round's own marks do not exist for graphics: an r2. mark does not count.
  assert.deepEqual(graphicsOf(c, done('r2.p23b.posted'), 0), { done: 0, of: 36 });
});

test('shoot days: took place by date, out of the package, with the last and the next', () => {
  const c = base({ deliverables: { videos: 42, shoot_days: 2, photo_days: 1 }, rounds: [{ n: 2, shoot_at: '2026-11-20T10:00:00+02:00' }] });
  const s = shootDaysOf(c, {}, NOW);
  assert.equal(s.done, 1);
  assert.equal(s.of, 3, 'shoot days + photo days');
  assert.equal(dayMonth(s.last), '10.9');
  assert.equal(dayMonth(s.next), '20.11');
  assert.deepEqual(shootDates(s), ['אחרון: 10.9', 'הבא: 20.11']);
  // Today's shoot day is the next one until the day is over (the shoot table's rule).
  const today = shootDaysOf(base({ shoot_at: '2026-11-09T15:00:00+02:00' }), {}, NOW);
  assert.equal(today.done, 0);
  assert.deepEqual(shootDates(today), ['הבא: 9.11']);
  // Days remain and none set: "טרם נקבע"; all done: no "הבא".
  assert.deepEqual(shootDates({ done: 1, of: 2, last: new Date('2026-10-10T10:00:00+03:00'), next: null }), ['אחרון: 10.10', 'הבא: טרם נקבע']);
  assert.deepEqual(shootDates({ done: 1, of: 1, last: new Date('2026-10-10T10:00:00+03:00'), next: null }), ['אחרון: 10.10']);
  assert.deepEqual(shootDates({ done: 0, of: null, last: null, next: null }), []);
  // A monthly editing round is not a shoot day.
  const monthly = base({ rounds: [{ n: 2, month: '2026-11', monthly: true, editor: 'nadia', start_at: '2026-11-01T09:00:00+02:00' }] });
  assert.equal(shootDaysOf(monthly, {}, NOW).done, 1);
  // No number in the package.
  assert.equal(shootDaysOf(base({ deliverables: {} }), {}, NOW).of, null);
});

test('the words: done, ratio, count', () => {
  assert.equal(complete({ done: 36, of: 36 }), true);
  assert.equal(complete({ done: 40, of: 36 }), true);
  assert.equal(complete({ done: 3, of: 36 }), false);
  assert.equal(complete({ done: 3, of: null }), false);
  assert.equal(ratioText({ done: 7, of: 25 }), '7 / 25');
  assert.equal(ratioText({ done: 9, of: null }), '9');
  assert.equal(ratioText({ done: 0, of: null }), '—');
  assert.equal(clientsWord(1), 'לקוח אחד');
  assert.equal(clientsWord(12), '12 לקוחות');
});

test('the search: any part of the business or the contact', () => {
  const rows = trackingRows([base(), base({ id: 'c2', business: 'Pizza Roma', name: 'רומן' }), base({ id: 'c3', business: '', name: 'אבי לוי' })], {}, NOW);
  assert.deepEqual(searchTracking(rows, 'קפה').map((r) => r.id), ['c1']);
  assert.deepEqual(searchTracking(rows, 'דנה').map((r) => r.id), ['c1'], 'the contact');
  assert.deepEqual(searchTracking(rows, '  pizza ').map((r) => r.id), ['c2'], 'Latin, any case, spaces');
  assert.deepEqual(searchTracking(rows, '').length, 3);
  assert.deepEqual(searchTracking(rows, 'אין כזה'), []);
});
