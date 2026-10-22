// How many videos each editor has edited (the owner's request of 22.10.2026): the editor's
// part (their share with two editors, else the package's videos), the number as typed, and
// the office's short line ("27/48", "נדיה 8/10 · יריב 12/15"). And a monthly client: a fixed
// number of videos every month, counted per Israel calendar month from 0 on the 1st.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  editTarget, editedValue, progressKey, progressMap, editedShort, editedLine,
  monthKey, addMonth, isMonthKey, monthLabel, monthTarget, monthBase, isMonthly, monthlyFor, monthVideosText, monthRowKey, monthMap, monthLine, withMonthly, exceptMonths,
} from '../app/edit-count.js';
import { roundContext } from '../app/protocol-logic.js';

const one = { id: 'c1', editor: 'anna', deliverables: { videos: 48 } };
const pair = { id: 'c2', editor: 'nadia', editor2: 'yariv', editor_split: { nadia: 10, yariv: 15 }, deliverables: { videos: 25 } };
const row = (client_id, editor, edited, round = 1) => ({ client_id, editor, edited, round });

test('the part: the share with two editors, else the package\'s videos, else unknown', () => {
  assert.equal(editTarget(one, 'anna'), 48);
  assert.equal(editTarget(pair, 'nadia'), 10);
  assert.equal(editTarget(pair, 'yariv'), 15);
  // Two editors without a split: the package's number, as the card says.
  assert.equal(editTarget({ ...pair, editor_split: null }, 'yariv'), 25);
  // Two shoot days: the videos of one day (videosPerDay).
  assert.equal(editTarget({ ...one, deliverables: { videos: 20, shoot_days: 2 } }, 'anna'), 10);
  assert.equal(editTarget({ id: 'x', editor: 'anna' }, 'anna'), null);
});

test('what is typed: a whole number 0..999, anything else waits', () => {
  for (const [v, n] of [['0', 0], ['8', 8], [' 12 ', 12], ['999', 999], [7, 7]]) assert.equal(editedValue(v), n, String(v));
  for (const v of ['', '-1', '1000', '2.5', 'abc', null, undefined, '٣']) assert.equal(editedValue(v), null, String(v));
});

test('the short form: "8/10", above the part as it is, "8" without a part', () => {
  assert.equal(editedShort(8, 10), '8/10');
  assert.equal(editedShort(12, 10), '12/10');
  assert.equal(editedShort(8, null), '8');
});

test('the office\'s line: one editor, two editors, rounds, nothing written', () => {
  const map = progressMap([row('c1', 'anna', 27), row('c2', 'nadia', 8), row('c2', 'yariv', 12), row('c1', 'yariv', 3, 2)]);
  assert.equal(map[progressKey('c2', null, 'nadia')].edited, 8);
  assert.equal(editedLine(one, map), '27/48');
  assert.equal(editedLine(pair, map), 'נדיה 8/10 · יריב 12/15');
  // Only one of the two wrote: the other is 0.
  assert.equal(editedLine(pair, progressMap([row('c2', 'yariv', 4)])), 'נדיה 0/10 · יריב 4/15');
  // A round reads its own row and its own editor.
  const r2 = roundContext({ ...one, rounds: [{ n: 2, editor: 'yariv' }] }, { n: 2, editor: 'yariv' });
  assert.equal(editedLine(r2, map), '3/48');
  assert.equal(editedLine(roundContext(one, { n: 3, editor: 'anna' }), map), null);
  assert.equal(editedLine(one, {}), null);
  assert.equal(editedLine(one, null), null);
  // Without a known part: just the number.
  assert.equal(editedLine({ id: 'c1', editor: 'anna' }, map), '27');
});

// ── A monthly client (22.10.2026): a fixed number of videos every month ──
const elor = { id: 'm1', editor: 'nadia', deliverables: { videos: 96, videos_month: 8, videos_month_except: { '2026-10': 12 } } };
const at = (iso) => new Date(iso);

test('the month is the Israel calendar month, whatever the zone of the device', () => {
  // Summer time (UTC+3): the 1st of October starts at 21:00 UTC on 30 September.
  assert.equal(monthKey(at('2026-09-30T20:59:59Z')), '2026-09');
  assert.equal(monthKey(at('2026-09-30T21:00:00Z')), '2026-10');
  // Winter time since 25.10.2026 (UTC+2): the 1st of November starts at 22:00 UTC on 31 October.
  assert.equal(monthKey(at('2026-10-31T21:59:59Z')), '2026-10');
  assert.equal(monthKey(at('2026-10-31T22:00:00Z')), '2026-11');
  // New York's evening of 31 October is already November in Israel.
  assert.equal(monthKey(at('2026-10-31T19:30:00-04:00')), '2026-11');
  assert.equal(monthKey(at('2026-12-31T22:00:00Z')), '2027-01');
  assert.deepEqual([addMonth('2026-12', 1), addMonth('2027-01', -1), addMonth('2026-10', -2), addMonth('2026-10', 13)], ['2027-01', '2026-12', '2026-08', '2027-11']);
  assert.deepEqual([isMonthKey('2026-10'), isMonthKey('2026-13'), isMonthKey('2026-1'), isMonthKey('10/2026'), isMonthKey(null)], [true, false, false, false, false]);
  assert.equal(monthLabel('2026-10'), 'אוקטובר 2026');
});

test('the month\'s target: 8 a month, 12 in October 2026, from the 1st in Israel time; null for a client counted by the package', () => {
  assert.equal(monthTarget(elor, at('2026-10-22T10:00:00+03:00')), 12);
  assert.equal(monthTarget(elor, at('2026-10-01T00:00:00+03:00')), 12);
  assert.equal(monthTarget(elor, at('2026-09-30T23:59:00+03:00')), 8);
  // The last second of October in Israel is still 12; the first of November is 8 (and stays 8).
  assert.equal(monthTarget(elor, at('2026-10-31T21:59:59Z')), 12);
  assert.equal(monthTarget(elor, at('2026-10-31T22:00:00Z')), 8);
  assert.equal(monthTarget(elor, at('2026-12-15T12:00:00Z')), 8);
  assert.equal(monthTarget(elor, at('2027-10-15T12:00:00Z')), 8, 'the exception is October 2026 only');
  // Everyone else: no monthly target at all.
  assert.equal(monthTarget(one, at('2026-10-22T10:00:00Z')), null);
  assert.equal(monthTarget({ id: 'x', deliverables: { videos_month_except: { '2026-10': 12 } } }, at('2026-10-22T10:00:00Z')), null, 'an exception alone does not make a monthly client');
  for (const v of [0, -1, 1000, 2.5, 'abc', '', null]) assert.equal(monthTarget({ deliverables: { videos_month: v } }), null, String(v));
  // As typed into jsonb: a number in a string still counts; a broken exception is ignored.
  assert.equal(monthTarget({ deliverables: { videos_month: '8', videos_month_except: { '2026-10': '12' } } }, at('2026-10-22T10:00:00Z')), 12);
  assert.equal(monthTarget({ deliverables: { videos_month: 8, videos_month_except: { '2026-10': 'x', '2026-11': 1000 } } }, at('2026-10-22T10:00:00Z')), 8);
  assert.equal(monthTarget({ deliverables: { videos_month: 8, videos_month_except: [12] } }, at('2026-10-22T10:00:00Z')), 8);
  // A month off: 0.
  assert.equal(monthTarget({ deliverables: { videos_month: 8, videos_month_except: { '2026-12': 0 } } }, at('2026-12-10T10:00:00Z')), 0);
  assert.deepEqual([isMonthly(elor), isMonthly(one), monthBase(elor)], [true, false, 8]);
});

test('the editor card\'s words, and who counts by the month', () => {
  assert.equal(monthVideosText(elor, at('2026-10-22T10:00:00+03:00')), '12 סרטונים החודש');
  assert.equal(monthVideosText(elor, at('2026-11-02T10:00:00+02:00')), '8 סרטונים בחודש');
  assert.equal(monthVideosText({ deliverables: { videos_month: 1 } }, at('2026-11-02T10:00:00Z')), 'סרטון אחד בחודש');
  assert.equal(monthVideosText(one, at('2026-11-02T10:00:00Z')), null);
  const two = { ...elor, editor2: 'yariv' };
  assert.deepEqual(['nadia', 'yariv', 'anna'].map((p) => monthlyFor(two, p)), [true, true, false]);
  assert.equal(monthlyFor(one, 'anna'), false);
});

test('the office\'s line: this month only (a new month starts from nothing), one editor or two together', () => {
  const rows = [
    { client_id: 'm1', editor: 'nadia', month: '2026-10', edited: 5 },
    { client_id: 'm1', editor: 'nadia', month: '2026-09', edited: 8 },
    { client_id: 'm2', editor: 'yariv', month: '2026-10', edited: 2 },
    { client_id: 'm2', editor: 'nadia', month: '2026-10', edited: 3 },
  ];
  const map = monthMap(rows);
  assert.equal(map[monthRowKey('m1', '2026-09', 'nadia')].edited, 8);
  const oct = at('2026-10-22T10:00:00+03:00');
  assert.equal(monthLine(elor, map, oct), '5/12 החודש');
  assert.equal(monthLine(elor, map, at('2026-09-20T10:00:00+03:00')), '8/8 החודש');
  // On the 1st of November nothing was written yet: no line (the office sees nothing, the editor 0).
  assert.equal(monthLine(elor, map, at('2026-10-31T22:00:00Z')), null);
  const pair2 = { id: 'm2', editor: 'nadia', editor2: 'yariv', deliverables: { videos_month: 8 } };
  assert.equal(monthLine(pair2, map, oct), 'נדיה 3 · יריב 2 · 5/8 החודש');
  assert.equal(monthLine(pair2, monthMap([rows[2]]), oct), 'נדיה 0 · יריב 2 · 2/8 החודש');
  assert.equal(monthLine(one, map, oct), null);
  assert.equal(monthLine(elor, null, oct), null);
});

test('the office\'s fields: the number a month, a month that differs, and back to the package', () => {
  const d0 = { videos: 96, graphics: 10, done: { videos: 3 } };
  let r = withMonthly(d0, { base: '8', month: '2026-10', except: '12' });
  assert.deepEqual(r.deliverables, { videos: 96, graphics: 10, done: { videos: 3 }, videos_month: 8, videos_month_except: { '2026-10': 12 } });
  // Another month added, the first one kept.
  r = withMonthly(r.deliverables, { base: '8', month: '2026-12', except: '0' });
  assert.deepEqual(r.deliverables.videos_month_except, { '2026-10': 12, '2026-12': 0 });
  // A month with an empty number goes back to the regular one.
  r = withMonthly(r.deliverables, { base: '8', month: '2026-12', except: '' });
  assert.deepEqual(r.deliverables.videos_month_except, { '2026-10': 12 });
  r = withMonthly(r.deliverables, { base: '8', month: '2026-10', except: ' ' });
  assert.equal('videos_month_except' in r.deliverables, false);
  // Empty: counted by the package again; the rest as it was.
  r = withMonthly(r.deliverables, { base: '', month: '2026-10', except: '' });
  assert.deepEqual(r.deliverables, d0);
  assert.deepEqual(withMonthly(d0, {}).deliverables, d0);
  for (const [fields, field] of [[{ base: '0' }, 'base'], [{ base: '2.5' }, 'base'], [{ base: '1000' }, 'base'], [{ base: '8', month: '2026-10', except: '-1' }, 'except'], [{ base: '8', month: '', except: '12' }, 'month']]) {
    assert.equal(withMonthly(d0, fields).field, field, JSON.stringify(fields));
  }
  // The months offered: last month, this one and eleven more, and any month that has a number of its own.
  const list = exceptMonths({ deliverables: { videos_month: 8, videos_month_except: { '2026-01': 4 } } }, at('2026-10-22T10:00:00+03:00'));
  assert.deepEqual([list[0], list[1], list.at(-1), list.length], ['2026-01', '2026-09', '2027-09', 14]);
});
