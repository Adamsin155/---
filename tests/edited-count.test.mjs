// How many videos each editor has edited (the owner's request of 22.10.2026): the editor's
// part (their share with two editors, else the package's videos), the number as typed, and
// the office's short line ("27/48", "נדיה 8/10 · יריב 12/15").
import test from 'node:test';
import assert from 'node:assert/strict';
import { editTarget, editedValue, progressKey, progressMap, editedShort, editedLine } from '../app/edit-count.js';
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
