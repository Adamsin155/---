// Israel time and the office rules (docs/plan/decisions.md, decisions 1–3):
// deadlines do not depend on the machine's time zone, the move to winter time,
// erev chag closes at 13:00, waiting on the client stops the employee's clock,
// imported history is not counted, and the holiday list is kept up to date.
// `npm test` runs this file under UTC, America/New_York and Asia/Jerusalem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROCESSES } from '../app/protocol.js';
import {
  applicableProcesses, clientState, resolveTime, addBusinessDays, addWorkingMinutes, nextWorkMoment, workingMinutesBetween,
  isBusinessDay, bucketOf, businessDaysBetween, weekKey, parseDate, performanceReport, WAIT, WAITED, waitNote, waitedNote,
  waitedMinutes, endWaitNote, readWaited, isImported, IMPORT_NOTE, erevOn,
} from '../app/protocol-logic.js';
import { COVERAGE, coverageDaysLeft } from '../app/holidays.js';
import {
  partsIL, dateIL, dayKeyIL, addDaysIL, weekdayIL, startOfDayIL, daysBetweenIL, inputValueIL, fromInputIL,
} from '../app/tz.js';

const at = (s) => new Date(s);
const iso = (d) => (d ? d.toISOString() : null);
const base = { deal_at: '2026-10-01T09:00:00+03:00', status: 'active' };
const keysOf = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key);
const done = (keys, when, note = null) => Object.fromEntries(keys.map((k) => [k, { state: 'done', at: when, note }]));
const stateOf = (c, checks, now, id) => clientState(c, checks, at(now)).states.find((x) => x.proc.id === id);

test('tz: Israel wall clock on both sides of the move to winter time (25.10.2026)', () => {
  assert.equal(iso(dateIL(2026, 10, 24, 11, 0)), '2026-10-24T08:00:00.000Z'); // summer, +03:00
  assert.equal(iso(dateIL(2026, 10, 25, 11, 0)), '2026-10-25T09:00:00.000Z'); // winter, +02:00
  assert.equal(iso(dateIL(2026, 10, 25, 1, 30)), '2026-10-24T22:30:00.000Z'); // 01:30 happens twice: the first
  assert.equal(iso(dateIL(2027, 3, 26, 2, 30)), '2027-03-26T00:30:00.000Z'); // skipped hour in spring: 03:30
  assert.equal(iso(dateIL(2026, 10, 32, 9, 0)), '2026-11-01T07:00:00.000Z'); // rolls over like Date.UTC
  assert.deepEqual(partsIL(at('2026-10-25T21:59:00Z')), { year: 2026, month: 10, day: 25, hour: 23, minute: 59, second: 0, ms: 0, weekday: 0 });
  assert.equal(dayKeyIL(at('2026-10-25T22:00:00Z')), '2026-10-26'); // midnight in Israel, still the 25th in UTC
  assert.equal(weekdayIL(at('2026-10-31T22:30:00Z')), 0); // Sunday in Israel, Saturday in UTC
  assert.equal(iso(addDaysIL(at('2026-10-24T10:00:00+03:00'), 2)), iso(at('2026-10-26T10:00:00+02:00'))); // same wall-clock hour
  assert.equal(iso(startOfDayIL(at('2026-10-25T12:00:00+02:00'))), iso(at('2026-10-25T00:00:00+03:00')));
  assert.equal(daysBetweenIL(at('2026-10-24T23:00:00+03:00'), at('2026-10-26T00:10:00+02:00')), 2);
  assert.equal(inputValueIL('2026-10-01T07:00:00Z'), '2026-10-01T10:00');
  assert.equal(iso(fromInputIL('2026-10-26T10:00')), '2026-10-26T08:00:00.000Z');
  assert.equal(fromInputIL(''), null);
  assert.equal(iso(parseDate('2026-10-26')), iso(at('2026-10-26T00:00:00+02:00'))); // a bare day is an Israel day
});

test('identical deadlines under UTC, New York and Jerusalem', () => {
  // Times near midnight, a Sunday shoot just after midnight and the move to winter time.
  const c = {
    ...base, id: 'c', deal_at: '2026-10-22T17:58:00+03:00', char_at: '2026-10-25T23:30:00+02:00',
    shoot_at: '2026-11-01T00:30:00+02:00', shoot_type: 'dms', contract_end: '2027-10-20',
  };
  const checks = { 'p22a.assigned': { state: 'done', at: '2026-11-01T17:30:00+02:00' } };
  const nows = ['2026-10-22T23:30:00+03:00', '2026-10-25T00:30:00+03:00', '2026-10-29T23:45:00+02:00', '2026-11-01T00:45:00+02:00'];
  const snapshot = () => ({
    local: at(c.char_at).getHours(), // proves the zone really changed
    states: nows.map((n) => clientState(c, checks, at(n)).states.map((s) => [s.proc.id, iso(s.startAt), iso(s.dueAt), s.status, bucketOf(s.status, s.dueAt, at(n))])),
    weeks: nows.map((n) => weekKey(at(n))),
    open: nows.map((n) => iso(nextWorkMoment(at(n)))),
    late: businessDaysBetween(at('2026-10-22T23:30:00+03:00'), at('2026-11-01T00:30:00+02:00')),
    days: Array.from({ length: 96 }, (_, i) => isBusinessDay(new Date(at('2026-10-22T00:00:00+03:00').getTime() + i * 36e5))),
  });
  const was = process.env.TZ;
  const runs = ['UTC', 'America/New_York', 'Asia/Jerusalem'].map((tz) => { process.env.TZ = tz; return snapshot(); });
  if (was === undefined) delete process.env.TZ; else process.env.TZ = was;
  assert.deepEqual(runs.map((r) => r.local), [21, 17, 23]);
  for (const r of runs.slice(1)) {
    assert.deepEqual(r.states, runs[0].states);
    assert.deepEqual([r.weeks, r.open, r.late, r.days], [runs[0].weeks, runs[0].open, runs[0].late, runs[0].days]);
  }
  // And the values themselves are Israel's.
  const procs = applicableProcesses(c);
  const due = (id) => iso(resolveTime(procs.find((p) => p.id === id).due, c, procs, checks, at(nows[0])));
  assert.equal(due('p01'), iso(at('2026-10-25T09:08:00+02:00'))); // Thursday 17:58 + 10 office minutes (the contract)
  assert.equal(due('p15'), iso(at('2026-10-29T11:00:00+02:00'))); // Sunday shoot: Thursday 11:00
  assert.equal(due('p12'), iso(at('2026-10-27T18:00:00+02:00'))); // 2 business days from Sunday night (decision 14)
  assert.deepEqual(runs[0].weeks, ['2026-10-18', '2026-10-25', '2026-10-25', '2026-11-01']);
  assert.equal(runs[0].late, 6); // Thursday night to the Sunday a week later: 6 business days
  assert.deepEqual(runs[0].days.map((b, i) => (b ? '1' : '0')).join('').match(/1+|0+/g).map((s) => s.length), [24, 48, 24]); // Thu, Fri–Sat off, Sun
});

test('winter time (Sunday 25.10.2026): business days, office minutes and "at 11:00"', () => {
  // Two business days from Thursday 22.10: Sunday 25 and Monday 26, to the office's close on Monday (18:00) in winter time.
  assert.equal(iso(addBusinessDays(at('2026-10-22T10:00:00+03:00'), 2)), '2026-10-26T16:00:00.000Z');
  // Office minutes over the weekend and the clock change: Thursday 17:58 + 5 min = Sunday 09:03 (+02:00).
  assert.equal(iso(addWorkingMinutes(at('2026-10-22T17:58:00+03:00'), 5)), '2026-10-25T07:03:00.000Z');
  // The day before a Tuesday 27.10 shoot is Monday 26.10: the reminder is due at 11:00 winter time.
  const c = { ...base, deal_at: '2026-10-20T09:00:00+03:00', shoot_type: 'dms', shoot_at: '2026-10-27T10:00:00+02:00' };
  const procs = applicableProcesses(c);
  const p15 = procs.find((p) => p.id === 'p15');
  assert.equal(iso(resolveTime(p15.due, c, procs, {})), '2026-10-26T09:00:00.000Z');
  assert.equal(iso(resolveTime(p15.start, c, procs, {})), '2026-10-25T22:00:00.000Z'); // 00:00 on the 26th
  // A Monday 26.10 shoot: the day before is the Sunday of the change itself.
  const m = { ...c, shoot_at: '2026-10-26T10:00:00+02:00' };
  const mp = applicableProcesses(m);
  assert.equal(iso(resolveTime(mp.find((p) => p.id === 'p15').due, m, mp, {})), '2026-10-25T09:00:00.000Z');
  // Shoot-day processes on the real clock: due "by the end of the shoot day" in winter time.
  assert.equal(iso(resolveTime(procs.find((p) => p.id === 'p19').due, c, procs, {})), iso(at('2026-10-27T23:59:59+02:00')));
  // "Today" at 00:30 on the 26th in Israel is the 26th, although it is the 25th in UTC.
  const s = clientState(c, {}, at('2026-10-26T00:30:00+02:00'));
  assert.equal(s.states.find((x) => x.proc.id === 'p15').status, 'today');
});

test('erev chag: a business day until 13:00; Chol HaMoed is a normal day', () => {
  // Sunday 20.9.2026 is erev Yom Kippur: 12:58 + 5 office minutes skips Yom Kippur to Tuesday 09:03.
  assert.ok(erevOn(at('2026-09-20T10:00:00+03:00')));
  assert.equal(isBusinessDay(at('2026-09-20T10:00:00+03:00')), true);
  assert.equal(iso(addWorkingMinutes(at('2026-09-20T12:58:00+03:00'), 5)), iso(at('2026-09-22T09:03:00+03:00')));
  assert.equal(iso(nextWorkMoment(at('2026-09-20T13:00:00+03:00'))), iso(at('2026-09-22T09:00:00+03:00')));
  assert.equal(iso(nextWorkMoment(at('2026-09-20T12:59:00+03:00'))), iso(at('2026-09-20T12:59:00+03:00')));
  assert.equal(workingMinutesBetween(at('2026-09-20T08:00:00+03:00'), at('2026-09-20T20:00:00+03:00')), 240);
  // The same deal on the client card: due Tuesday 09:03, and not late in the afternoon of the erev.
  const c = { ...base, deal_at: '2026-09-20T12:58:00+03:00' };
  const p1 = stateOf(c, {}, '2026-09-20T16:00:00+03:00', 'p01');
  assert.equal(iso(p1.dueAt), iso(at('2026-09-22T09:08:00+03:00'))); // the contract: 10 office minutes
  assert.notEqual(p1.status, 'overdue');
  // Chol HaMoed Sukkot (Tuesday 29.9.2026) closes at 18:00 like any day.
  assert.equal(erevOn(at('2026-09-29T10:00:00+03:00')), null);
  assert.equal(iso(addWorkingMinutes(at('2026-09-29T12:58:00+03:00'), 5)), iso(at('2026-09-29T13:03:00+03:00')));
  assert.equal(iso(addWorkingMinutes(at('2026-09-29T17:58:00+03:00'), 5)), iso(at('2026-09-30T09:03:00+03:00')));
  // Erev Shvi'i shel Pesach that is also Chol HaMoed (7.4.2026): the erev rule wins.
  assert.equal(iso(addWorkingMinutes(at('2026-04-07T12:30:00+03:00'), 60)), iso(at('2026-04-09T09:30:00+03:00')));
  // Two office hours from 11:30 on erev Shavuot (Thursday 21.5.2026): 1.5 h that day, the rest on Sunday.
  assert.equal(iso(addWorkingMinutes(at('2026-05-21T11:30:00+03:00'), 120)), iso(at('2026-05-24T09:30:00+03:00')));
});

test('waiting on the client stops the clock and moves the deadline on', () => {
  const c = { ...base, id: 'w' }; // deal Thursday 1.10.2026 09:00: process 1 (the contract, 10 minutes) is due at 09:10
  const p1 = applicableProcesses(c).find((p) => p.id === 'p01');
  // Office minutes of a wait: the night and the weekend do not count.
  assert.equal(workingMinutesBetween(at('2026-10-01T17:00:00+03:00'), at('2026-10-04T10:00:00+03:00')), 120);
  // While waiting: status "client", and the deadline follows the time waited so far.
  const waiting = { [WAIT(p1)]: { state: 'done', note: waitNote('לא עונה', null), at: '2026-10-01T09:02:00+03:00' } };
  const w = stateOf(c, waiting, '2026-10-01T09:32:00+03:00', 'p01');
  assert.equal(w.status, 'client');
  assert.deepEqual([w.waited, w.extended], [30, 30]);
  assert.equal(iso(w.baseDueAt), iso(at('2026-10-01T09:10:00+03:00')));
  assert.equal(iso(w.dueAt), iso(at('2026-10-01T09:40:00+03:00')));
  // Ending the wait at 10:02 keeps its 60 office minutes; an earlier wait of 15 adds up.
  assert.equal(endWaitNote(c, p1, waiting, at('2026-10-01T10:02:00+03:00')), '{"min":60,"ext":60}');
  assert.equal(WAITED(p1), 'p01.waited');
  const earlier = { ...waiting, [WAITED(p1)]: { state: 'done', note: waitedNote(15), at: '2026-10-01T09:01:00+03:00' } };
  assert.deepEqual(waitedMinutes(p1, earlier, at('2026-10-01T10:02:00+03:00'), at('2026-10-01T09:05:00+03:00')), { min: 75, ext: 75 });
  // After the wait: the due time is 60 office minutes later (10:10), so 10:03 is not late and 10:11 is.
  const after = { [WAITED(p1)]: { state: 'done', note: waitedNote(60), at: '2026-10-01T10:02:00+03:00' } };
  assert.equal(iso(stateOf(c, after, '2026-10-01T10:03:00+03:00', 'p01').dueAt), iso(at('2026-10-01T10:10:00+03:00')));
  assert.notEqual(stateOf(c, after, '2026-10-01T10:03:00+03:00', 'p01').status, 'overdue');
  assert.equal(stateOf(c, after, '2026-10-01T10:11:00+03:00', 'p01').status, 'overdue');
  // The extension runs on office time: 60 minutes from 17:35 end at 09:35 on Sunday.
  const late = { ...c, deal_at: '2026-10-01T17:25:00+03:00' };
  assert.equal(iso(stateOf(late, after, '2026-10-01T17:40:00+03:00', 'p01').dueAt), iso(at('2026-10-04T09:35:00+03:00')));
  // A process finished while the wait was still marked: the wait counts until the finish only.
  const finished = { ...waiting, ...done(keysOf('p01'), '2026-10-01T09:50:00+03:00') };
  const f = stateOf(c, finished, '2026-10-02T12:00:00+03:00', 'p01');
  assert.equal(f.status, 'done');
  assert.equal(f.waited, 48);
  assert.ok(f.completedAt <= f.dueAt);
  assert.equal(endWaitNote(c, p1, finished, at('2026-10-02T12:00:00+03:00')), '{"min":48,"ext":48}');
  // Garbage in the mark is ignored; a note without `ext` moved the deadline by all of it.
  assert.deepEqual(waitedMinutes(p1, { [WAITED(p1)]: { state: 'done', note: 'x', at: '2026-10-01T10:00:00+03:00' } }), { min: 0, ext: 0 });
  assert.deepEqual(readWaited('{"min":40}'), { min: 40, ext: 40 });
  assert.deepEqual(readWaited('{"min":40,"ext":90}'), { min: 40, ext: 40 });
  assert.deepEqual(readWaited(null), { min: 0, ext: 0 });
});

test('a wait that began before the deadline stops the clock; one after it gives nothing back', () => {
  const c = { ...base, id: 'w' }; // process 1 is due Thursday 1.10.2026 09:10
  const p1 = applicableProcesses(c).find((p) => p.id === 'p01');
  const wait = (since) => ({ [WAIT(p1)]: { state: 'done', note: waitNote('לא עונה', null), at: since } });
  // Marked at 09:04, six minutes left: the whole wait (to 11:04) moves the deadline, and those minutes are still there after it.
  const inTime = wait('2026-10-01T09:04:00+03:00');
  assert.equal(endWaitNote(c, p1, inTime, at('2026-10-01T11:04:00+03:00')), '{"min":120,"ext":120}');
  const afterIn = { [WAITED(p1)]: { state: 'done', note: waitedNote(120), at: '2026-10-01T11:04:00+03:00' } };
  assert.equal(iso(stateOf(c, afterIn, '2026-10-01T11:04:30+03:00', 'p01').dueAt), iso(at('2026-10-01T11:10:00+03:00')));
  // Nobody acted; on Sunday 12:00 the process is marked as waiting, and the wait ends on Monday 12:00.
  const lateWait = wait('2026-10-04T12:00:00+03:00');
  const during = stateOf(c, lateWait, '2026-10-05T11:00:00+03:00', 'p01');
  assert.equal(during.status, 'client'); // stuck on the client now
  assert.deepEqual([during.waited, during.extended], [480, 0]);
  assert.equal(iso(during.dueAt), iso(at('2026-10-01T09:10:00+03:00')));
  const note = endWaitNote(c, p1, lateWait, at('2026-10-05T12:00:00+03:00'));
  assert.equal(note, '{"min":540,"ext":0}');
  const afterLate = { [WAITED(p1)]: { state: 'done', note, at: '2026-10-05T12:00:00+03:00' } };
  const x = stateOf(c, afterLate, '2026-10-05T12:10:00+03:00', 'p01');
  assert.equal(iso(x.dueAt), iso(at('2026-10-01T09:10:00+03:00')));
  assert.equal(x.status, 'overdue'); // still late: the time overrun is not given back
  // Closed on Monday 12:30: late in the report, and the wait is still not counted as work.
  const closed = { ...afterLate, ...done(keysOf('p01'), '2026-10-05T12:30:00+03:00') };
  const r = performanceReport([c], { w: closed }, { days: 30, now: at('2026-10-06T10:00:00+03:00') }).processes.find((y) => y.key === 'p01');
  assert.deepEqual([r.done, r.onTime, r.late, r.medianMinutes], [1, 0, 1, 1290 - 540]); // Thu 540 + Sun 540 + Mon 210 office minutes, less the wait
  // Two waits: the first in time moves the deadline to 09:40; the second begins at 10:00, after it, and moves nothing.
  const two = { ...wait('2026-10-01T10:00:00+03:00'), [WAITED(p1)]: { state: 'done', note: waitedNote(30), at: '2026-10-01T09:32:00+03:00' } };
  assert.equal(endWaitNote(c, p1, two, at('2026-10-01T11:00:00+03:00')), '{"min":90,"ext":30}');
  assert.equal(iso(stateOf(c, two, '2026-10-01T10:30:00+03:00', 'p01').dueAt), iso(at('2026-10-01T09:40:00+03:00')));
});

test('performance report: waited time excluded, imported history ignored', () => {
  const p1 = keysOf('p01');
  const now = at('2026-10-05T10:00:00+03:00');
  // a: waited 55 office minutes, finished at 09:58 — on time (due 09:05 + 55), and 3 minutes of work.
  const a = { ...base, id: 'a' };
  const aChecks = { ...done(p1, '2026-10-01T09:58:00+03:00'), 'p01.waited': { state: 'done', note: waitedNote(55), at: '2026-10-01T09:56:00+03:00' } };
  // b: imported history, closed "late": not counted at all.
  const b = { ...base, id: 'b' };
  const bChecks = done(p1, '2026-10-03T12:00:00+03:00', IMPORT_NOTE);
  // c: one imported check is enough to leave the process out; other processes still count.
  const c = { ...base, id: 'c' };
  const cChecks = { ...done(p1, '2026-10-01T09:04:00+03:00'), 'p01.signed': { state: 'done', at: '2026-10-01T09:04:00+03:00', note: IMPORT_NOTE }, ...done(keysOf('p02'), '2026-10-01T09:04:00+03:00') };
  const procOf = (id) => applicableProcesses(base).find((p) => p.id === id);
  assert.equal(isImported(procOf('p01'), bChecks), true);
  assert.equal(isImported(procOf('p01'), cChecks), true);
  assert.equal(isImported(procOf('p02'), cChecks), false);
  assert.equal(isImported(procOf('p01'), done(p1, '2026-10-01T09:04:00+03:00', 'ייבוא ישן')), false); // exactly "ייבוא" only
  const r = performanceReport([a, b, c], { a: aChecks, b: bChecks, c: cChecks }, { days: 30, now });
  const p = r.processes.find((x) => x.key === 'p01');
  assert.deepEqual([p.done, p.onTime, p.late, p.medianMinutes], [1, 1, 0, 3]);
  assert.equal(r.processes.find((x) => x.key === 'p02').done, 1);
  assert.equal(r.people.find((x) => x.key === 'irit').rate, 1);
});

test('performance report: a wait over the night and the weekend is not work', () => {
  const p1 = keysOf('p01');
  const now = at('2026-10-06T10:00:00+03:00');
  const median = (c, checks) => performanceReport([c], { [c.id]: checks }, { days: 30, now }).processes.find((x) => x.key === 'p01');
  // Deal Thursday 1.10 16:00 (due 16:10); waiting from 16:02 to Sunday 10:00 (178 office minutes); closed Sunday 10:03.
  const d = { ...base, id: 'd', deal_at: '2026-10-01T16:00:00+03:00' };
  const dp = applicableProcesses(d).find((p) => p.id === 'p01');
  const dWait = { [WAIT(dp)]: { state: 'done', note: waitNote('לא עונה', null), at: '2026-10-01T16:02:00+03:00' } };
  const dNote = endWaitNote(d, dp, dWait, at('2026-10-04T10:00:00+03:00'));
  assert.equal(dNote, '{"min":178,"ext":178}');
  const dChecks = { [WAITED(dp)]: { state: 'done', note: dNote, at: '2026-10-04T10:00:00+03:00' }, ...done(p1, '2026-10-04T10:03:00+03:00') };
  assert.equal(iso(stateOf(d, dChecks, '2026-10-04T10:03:00+03:00', 'p01').dueAt), iso(at('2026-10-04T10:08:00+03:00')));
  const dr = median(d, dChecks);
  assert.deepEqual([dr.onTime, dr.medianMinutes], [1, 5]);
  // Deal Thursday 09:00; waiting from 09:02 to Sunday 09:02 (540 office minutes); closed Sunday 09:04: 4 minutes of work.
  const e = { ...base, id: 'e' };
  const eChecks = { [WAITED(dp)]: { state: 'done', note: waitedNote(540), at: '2026-10-04T09:02:00+03:00' }, ...done(p1, '2026-10-04T09:04:00+03:00') };
  const er = median(e, eChecks);
  assert.deepEqual([er.onTime, er.medianMinutes], [1, 4]);
});

// The holiday list ends at COVERAGE.to; business-day math beyond it would count
// holidays as working days. The build fails 90 days before that.
const MARGIN_DAYS = 90;
const coverageOk = (now) => coverageDaysLeft(now) >= MARGIN_DAYS;

test('holiday coverage rule on a fixed clock', () => {
  assert.equal(COVERAGE.to, '2028-12-31');
  assert.equal(coverageDaysLeft(at('2026-09-29T12:00:00+03:00')), 824);
  assert.equal(coverageOk(at('2028-10-02T23:30:00+03:00')), true); // exactly 90 days left
  assert.equal(coverageOk(at('2028-10-03T00:30:00+03:00')), false); // 89 (still the 2nd in UTC)
  assert.equal(coverageOk(at('2029-01-05T12:00:00+02:00')), false);
});

test('holiday list covers at least the next 90 days (update app/holidays.js)', () => {
  const left = coverageDaysLeft(new Date());
  assert.ok(coverageOk(new Date()),
    `לעדכן holidays.js: לוח החגים מכסה עד ${COVERAGE.to}, נשארו ${left} ימים. להפיק את השנה הבאה (הסקריפט ב־docs/protocols/research-implementation.md), להוסיף ל־HOLIDAYS, EREV ו־CHOL_HAMOED ולהזיז את COVERAGE.to.`);
});
