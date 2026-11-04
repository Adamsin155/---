// The editors' page (editor.html), the owner's requests of 4.11.2026 (docs/ops.md, section 97):
//   1  each card counts its own work: a monthly client's monthly round counts its own month; the
//      client's own first job, and a shoot round, count their own job, never the current month
//      (the bug: Anna's two cards of "אלאור בוטיק" wrote the same row, so one changed the other);
//   2  what already left the editor (with Ofir, the client or Ilai) goes into one fold at the end;
//   3  the list by the date of the assignment, oldest first or newest first, today's order the tie-breaker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jobCount, progressKey, monthRowKey } from '../app/edit-count.js';
import { roundContext } from '../app/protocol-logic.js';
import { editingCases } from '../app/production.js';
import { assignedTime, byAssigned, splitJobs, sinceOf, readSort, saveSort, SORT_KEY } from '../app/editor-order.js';

const NOV = new Date('2026-11-04T10:00:00+02:00');
const DEC = new Date('2026-12-02T10:00:00+02:00');
const elior = {
  id: 'm1', name: 'ניב בן שימול', business: 'אלאור בוטיק', status: 'active', editor: 'anna',
  deliverables: { videos_month: 8, videos_month_except: { '2026-11': 12 } },
  rounds: [{ n: 2, month: '2026-11', monthly: true, editor: 'anna', start_at: '2026-11-02T06:00:00.000Z' }],
};
const checks = {
  'p22a.assigned': { state: 'done', at: '2026-10-12T09:00:00+03:00' }, 'p22.received': { state: 'done', at: '2026-10-12T10:00:00+03:00' },
  'r2.p22a.assigned': { state: 'done', at: '2026-11-02T06:00:00.000Z' }, 'r2.p22.received': { state: 'done', at: '2026-11-02T06:00:00.000Z' },
};
const jobsOf = (c, ch, who = 'anna') => editingCases(c, ch, who, null);

test('the bug: the client\'s first job and its monthly round never count the same row', () => {
  const [first, round] = jobsOf(elior, checks);
  assert.equal(first.round, 1);
  assert.equal(round.round, 2);
  const a = jobCount(first, 'anna', checks, NOV);
  const b = jobCount(round, 'anna', checks, NOV);
  assert.notEqual(a.key, b.key, 'two cards, two rows');
  // The monthly round: its own month, in the month's table.
  assert.deepEqual({ key: b.key, month: b.month, of: b.of }, { key: monthRowKey('m1', '2026-11', 'anna'), month: '2026-11', of: 12 });
  // The first job: its own job (round 1), never the month.
  assert.equal(a.month, null);
  assert.equal(a.key, progressKey('m1', 1, 'anna'));
  // The same in December: nothing moves with the clock.
  assert.equal(jobCount(first, 'anna', checks, DEC).key, a.key);
  assert.equal(jobCount(round, 'anna', checks, DEC).key, b.key);
});

test('the first job\'s number from before stays readable: the month it was assigned, unless that month is a monthly round\'s', () => {
  const [first] = jobsOf(elior, checks);
  // Assigned in October: it typed into October's row until now.
  assert.equal(jobCount(first, 'anna', checks, NOV).from, monthRowKey('m1', '2026-10', 'anna'));
  // Assigned in November, and November is the monthly round's: that number is the round's.
  const nov = { ...checks, 'p22a.assigned': { state: 'done', at: '2026-11-01T09:00:00+02:00' } };
  assert.equal(jobCount(jobsOf(elior, nov)[0], 'anna', nov, NOV).from, null);
  // Not a monthly client: nothing from before.
  const plain = { ...elior, deliverables: { videos: 20 }, rounds: [] };
  const c = jobCount(jobsOf(plain, checks)[0], 'anna', checks, NOV);
  assert.deepEqual({ key: c.key, month: c.month, from: c.from, of: c.of }, { key: progressKey('m1', 1, 'anna'), month: null, from: null, of: 20 });
});

test('the first job\'s part: the package\'s videos, else the number of the month it was assigned', () => {
  const [first] = jobsOf(elior, checks);
  assert.equal(jobCount(first, 'anna', checks, NOV).of, 8, 'October: the regular 8');
  const both = { ...elior, deliverables: { ...elior.deliverables, videos: 30 } };
  assert.equal(jobCount(jobsOf(both, checks)[0], 'anna', checks, NOV).of, 30);
});

test('a shoot round of a monthly client counts its own round; a monthly round of another editor its own round too', () => {
  const shoot = { ...elior, rounds: [...elior.rounds, { n: 3, shoot_at: '2026-11-20T10:00:00+02:00', editor: 'anna', start_at: '2026-11-10T10:00:00+02:00' }] };
  const ch = { ...checks, 'r3.p22a.assigned': { state: 'done', at: '2026-11-21T09:00:00+02:00' } };
  const jobs = jobsOf(shoot, ch);
  const keys = jobs.map((j) => jobCount(j, 'anna', ch, NOV).key);
  assert.deepEqual(keys, [progressKey('m1', 1, 'anna'), monthRowKey('m1', '2026-11', 'anna'), progressKey('m1', 3, 'anna')]);
  assert.equal(new Set(keys).size, 3);
  // A monthly round left with an editor who is no longer the client's: the month's table is not theirs.
  const moved = { ...elior, editor: 'nadia', rounds: [{ ...elior.rounds[0], editor: 'anna' }] };
  const [r] = jobsOf(moved, checks);
  assert.equal(r.round, 2);
  assert.equal(jobCount(r, 'anna', checks, NOV).key, progressKey('m1', 2, 'anna'));
});

test('a monthly round older than last month takes no number any more', () => {
  const [, round] = jobsOf(elior, checks);
  assert.equal(jobCount(round, 'anna', checks, new Date('2026-12-20T10:00:00+02:00')).month, '2026-11', 'last month: still');
  assert.equal(jobCount(round, 'anna', checks, new Date('2027-01-05T10:00:00+02:00')), null);
});

// ── The order ──
const job = (id, at, key = 'editing', extra = {}) => ({ id, pre: '', client: { id }, ctx: { id }, st: { key }, at, ...extra });
const chk = (j) => ({ 'p22a.assigned': j.at ? { state: 'done', at: j.at } : undefined });

test('the date of the assignment: p22a.assigned of the job\'s prefix; a monthly round, its start', () => {
  assert.equal(assignedTime(job('a', '2026-10-01T09:00:00Z'), chk(job('a', '2026-10-01T09:00:00Z'))), Date.parse('2026-10-01T09:00:00Z'));
  const r = { pre: 'r2.', client: { id: 'm' }, ctx: { monthly: true, month: '2026-11', char_at: '2026-11-02T06:00:00.000Z' } };
  assert.equal(assignedTime(r, { 'r2.p22a.assigned': { state: 'done', at: '2026-11-03T06:00:00Z' } }), Date.parse('2026-11-02T06:00:00.000Z'));
  assert.equal(assignedTime({ pre: 'r3.', ctx: {} }, { 'p22a.assigned': { at: '2026-10-01T09:00:00Z' } }), null, 'its own prefix only');
  assert.equal(assignedTime(job('x', null), {}), null);
});

test('oldest first, newest first; today\'s order breaks a tie; no date at the end', () => {
  const list = [job('b', '2026-10-05T09:00:00Z'), job('none', null), job('a', '2026-10-01T09:00:00Z'), job('c', '2026-10-09T09:00:00Z'), job('a2', '2026-10-01T09:00:00Z')];
  assert.deepEqual(byAssigned(list, chk, 'old').map((j) => j.id), ['a', 'a2', 'b', 'c', 'none']);
  assert.deepEqual(byAssigned(list, chk, 'new').map((j) => j.id), ['c', 'b', 'a', 'a2', 'none']);
  assert.deepEqual(byAssigned(list, chk).map((j) => j.id), ['a', 'a2', 'b', 'c', 'none'], 'oldest first by default');
  assert.deepEqual(list.map((j) => j.id), ['b', 'none', 'a', 'c', 'a2'], 'the list itself untouched');
});

test('what left the editor goes to the fold: with Ofir, the client or Ilai', () => {
  const list = ['editing', 'qa', 'waiting', 'client', 'fixes', 'ilai', 'clientFixes', 'final'].map((k) => job(k, null, k));
  const { mine, waiting } = splitJobs(list);
  assert.deepEqual(mine.map((j) => j.id), ['editing', 'waiting', 'fixes', 'clientFixes', 'final']);
  assert.deepEqual(waiting.map((j) => j.id), ['qa', 'client', 'ilai']);
});

test('since when it waits: the hand-off to Ofir, his approval, the final versions', () => {
  const ch = { 'p25.approved': { state: 'done', at: '2026-11-02T10:00:00Z' }, 'r2.p27.final': { state: 'done', at: '2026-11-03T10:00:00Z' } };
  assert.equal(sinceOf({ pre: '', st: { key: 'qa', since: '2026-11-01T10:00:00Z' } }, ch), '2026-11-01T10:00:00Z');
  assert.equal(sinceOf({ pre: '', st: { key: 'client' } }, ch), '2026-11-02T10:00:00Z');
  assert.equal(sinceOf({ pre: 'r2.', st: { key: 'ilai' } }, ch), '2026-11-03T10:00:00Z');
  assert.equal(sinceOf({ pre: 'r2.', st: { key: 'client' } }, ch), null);
});

test('the order is remembered on the device, and a storage that throws changes nothing', () => {
  const box = new Map();
  const storage = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => box.set(k, v) };
  assert.equal(readSort(storage), 'old');
  saveSort('new', storage);
  assert.equal(box.get(SORT_KEY), 'new');
  assert.equal(readSort(storage), 'new');
  box.set(SORT_KEY, 'junk');
  assert.equal(readSort(storage), 'old');
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(readSort(broken), 'old');
  assert.doesNotThrow(() => saveSort('new', broken));
  assert.equal(readSort(null), 'old');
});
