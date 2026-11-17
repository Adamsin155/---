// "מעקב לקוחות" (tracking.html; the owner, 9.11.2026): the counting of app/tracking-logic.js.
// Invented clients; the clock is Monday 9.11.2026, 12:00 in Israel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inWork, editorText, videosOf, graphicsOf, shootDaysOf, complete, ratioText, shootDates, trackingRows, searchTracking, clientsWord, dayMonth,
  sharedVideos, driveCountOf, dealDayOf,
} from '../app/tracking-logic.js';
import { withFix } from '../app/tracking-fix-logic.js';

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

// A day of the client's Drive (public.drive_daily).
const day = (d, files, kind = 'video', folder = 'סרטונים', id = 'c1') => ({ client_id: id, day: d, folder, kind, files });
const v = (x) => ({ done: x.done, of: x.of, month: x.month });

test('videos: the editors\' counter, summed over the shoots', () => {
  const c = base({ deliverables: { videos: 24, graphics: 20, shoot_days: 2 }, rounds: [{ n: 2, shoot_at: '2026-11-01T10:00:00+02:00', editor: 'anna' }] });
  const progress = [
    { client_id: 'c1', editor: 'nadia', round: 1, edited: 7 },
    { client_id: 'c1', editor: 'anna', round: 2, edited: 3 },
    { client_id: 'c2', editor: 'nadia', round: 1, edited: 9 },   // another client
    { client_id: 'c1', editor: 'yariv', round: 1, edited: 5 },   // not this shoot's editor any more
  ];
  assert.deepEqual(videosOf(c, { progress }, NOW), { done: 10, of: 24, month: false, typed: 10, drive: 0 });
  // Nothing typed: 0 out of the package.
  assert.deepEqual(v(videosOf(c, {}, NOW)), { done: 0, of: 24, month: false });
  // The tables not readable (null): 0, never an error.
  assert.deepEqual(v(videosOf(c, { progress: null, months: null, drive: null }, NOW)), { done: 0, of: 24, month: false });
});

test('videos: "כל הסרטונים הועלו לדרייב" (p24.drive) adds nothing any more (the owner, 17.11.2026)', () => {
  const c = base({ deliverables: { videos: 48, shoot_days: 1 }, editor: 'yariv' });
  const progress = [{ client_id: 'c1', editor: 'yariv', round: 1, edited: 31 }];
  const checks = { ...done('p24.drive'), ...done('r2.p24.drive') };
  // ניקיון והיגיינה: the step was marked, the editor typed 31, the Drive has 31: 31 / 48, not 48 / 48.
  const rows = trackingRows([c], { checks: { c1: checks }, progress, drive: [day('2026-10-20', 20), day('2026-11-04', 11)] }, NOW);
  assert.equal(rows[0].videos.done, 31);
  assert.equal(rows[0].videos.of, 48);
  assert.equal(complete(rows[0].videos), false);
  // Marked, and nothing typed or in the Drive: 0.
  assert.equal(trackingRows([c], { checks: { c1: checks } }, NOW)[0].videos.done, 0);
  // A monthly round's mark adds nothing either.
  const m = base({ deliverables: { videos_month: 8 }, rounds: [{ n: 2, month: '2026-11', monthly: true, editor: 'nadia' }] });
  assert.equal(trackingRows([m], { checks: { c1: done('r2.p24.drive') } }, NOW)[0].videos.done, 0);
});

test('videos: the edited videos in the Drive since the deal day, when more than typed; never above the package', () => {
  const c = base({ deliverables: { videos: 36, shoot_days: 1 } }); // deal 1.8.2026
  const drive = [
    day('2026-07-31', 9),                        // before the deal: another package
    day('2026-08-01', 4),                        // the deal day itself counts
    day('2026-10-02', 10, 'video', 'ערוכים'),
    day('2026-10-02', 30, 'raw', 'גלם יום 1'),   // footage
    day('2026-10-03', 5, 'graphic', 'גרפיקות'),  // graphics
    day('2026-10-04', 7, 'video', 'סרטונים', 'c2'), // another client
  ];
  assert.equal(dealDayOf(c), '2026-08-01');
  assert.equal(driveCountOf(c, drive, 'video'), 14);
  assert.deepEqual(videosOf(c, { drive }, NOW), { done: 14, of: 36, month: false, typed: 0, drive: 14 });
  // Typed more than the Drive: the typed number.
  assert.equal(videosOf(c, { drive, progress: [{ client_id: 'c1', editor: 'nadia', round: 1, edited: 20 }] }, NOW).done, 20);
  // More in the Drive than the package (versions): the package.
  assert.equal(videosOf(c, { drive: [day('2026-09-01', 50)] }, NOW).done, 36);
  // An editor who typed more than the package: shown as typed.
  assert.equal(videosOf(c, { progress: [{ client_id: 'c1', editor: 'nadia', round: 1, edited: 40 }] }, NOW).done, 40);
  // No package number: the Drive as it is.
  assert.equal(videosOf(base({ deliverables: {} }), { drive: [day('2026-09-01', 50)] }, NOW).done, 50);
  // Without a deal time: from the day the client was opened (Israel day).
  const opened = base({ deal_at: null, created_at: '2026-09-30T22:30:00Z' }); // 1.10 in Israel
  assert.equal(dealDayOf(opened), '2026-10-01');
  assert.equal(driveCountOf(opened, [day('2026-09-30', 3), day('2026-10-01', 2)], 'video'), 2);
});

test('videos: a monthly client is this month\'s number, the typed one or this month\'s Drive videos', () => {
  const c = base({ deliverables: { videos_month: 8, videos_month_except: { '2026-11': 12 } } });
  const months = [
    { client_id: 'c1', editor: 'nadia', month: '2026-11', edited: 4 },
    { client_id: 'c1', editor: 'yariv', month: '2026-11', edited: 1 },
    { client_id: 'c1', editor: 'nadia', month: '2026-10', edited: 8 },
  ];
  assert.deepEqual(v(videosOf(c, { months }, NOW)), { done: 5, of: 12, month: true });
  // This month's Drive videos only (October's do not count in November).
  const drive = [day('2026-10-20', 8), day('2026-11-02', 4), day('2026-11-05', 3)];
  assert.deepEqual(v(videosOf(c, { months, drive }, NOW)), { done: 7, of: 12, month: true });
  assert.equal(videosOf(c, { months: [], drive: [day('2026-11-02', 40)] }, NOW).done, 12, 'never above the month');
});

test('videos: one shared number with a fix by hand, the same on the tracking row and the card', () => {
  const c = base({ deliverables: { videos: 48, shoot_days: 1 }, editor: 'yariv' });
  const data = { progress: [{ client_id: 'c1', editor: 'yariv', round: 1, edited: 31 }], drive: [day('2026-11-04', 31)] };
  // The count as the page shows it now, kept with the fix (it stands while the count stays so).
  const fixed = { ...c, deliverables: withFix(c.deliverables, 'videos', { done: 33, of: null }, { by: 'irit', at: '2026-11-09T09:00:00+02:00', auto: { done: 31, of: 48 } }) };
  const card = sharedVideos(fixed, data, NOW);
  const row = trackingRows([fixed], data, NOW)[0].videos;
  assert.equal(card.done, 33);
  assert.equal(card.of, 48);
  assert.deepEqual(card.fix, { by: 'irit', at: '2026-11-09T09:00:00+02:00' });
  assert.deepEqual({ done: row.done, of: row.of, fix: row.fix }, { done: card.done, of: card.of, fix: card.fix });
  // Once the count moves (a new video in the Drive), the fix stops on both.
  const moved = { ...data, drive: [day('2026-11-04', 32)] };
  assert.equal(sharedVideos(fixed, moved, NOW).done, 32);
  assert.equal(sharedVideos(fixed, moved, NOW).fix, undefined);
  assert.equal(trackingRows([fixed], moved, NOW)[0].videos.done, 32);
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
  // The graphics in the Drive since the deal day, when more (the highlight covers are not the package's).
  const drive = [day('2026-09-01', 12, 'graphic', 'גרפיקות'), day('2026-09-01', 6, 'graphic', 'היילייטס'), day('2026-07-01', 5, 'graphic', 'גרפיקות')];
  assert.deepEqual(graphicsOf(c, done('p07b.posted'), 0, drive), { done: 12, of: 36 });
  assert.deepEqual(graphicsOf(c, done('p07b.posted'), 0, [day('2026-09-01', 99, 'graphic', 'גרפיקות')]), { done: 36, of: 36 });
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
