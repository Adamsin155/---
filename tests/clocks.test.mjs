// The "now" bar's clocks (app/clocks.js): the new deal's three 5-minute office
// clocks, "the client did not answer" after graphics and videos were sent, and
// deadlines within the hour. `npm test` runs this under UTC, New York and Jerusalem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { clocksFor, clockTime, clockDigits, DEAL_CLOCKS, ANSWER_CLOCKS, SOON_MINUTES } from '../app/clocks.js';
import { applicableProcesses, ANSWERED, WAIT, IMPORT_NOTE } from '../app/protocol-logic.js';

const at = (s) => new Date(s);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const done = (keys, when, note = null) => Object.fromEntries(keys.map((k) => [k, { state: 'done', at: when, note }]));
const P1 = ['p01.prepared', 'p01.sent', 'p01.signed'];
const P2 = ['p02.opened', 'p02.m.lior', 'p02.m.irit', 'p02.m.ofir', 'p02.m.ilai', 'p02.m.client', 'p02.intro', 'p02.deal', 'p02.team'];
const P3 = ['p03.who', 'p03.available', 'p03.scheduled', 'p03.calendar'];
const clocks = (person, client, checks, now, kind = null) => clocksFor(person, [client], { [client.id]: checks }, { now: at(now) })
  .filter((c) => !kind || c.kind === kind);
const brief = (list) => list.map((c) => [c.kind, c.proc.id, iso(c.deadline), c.state]);

// The contract has 10 office minutes (the owner's decision of 3.10.2026), the group and the meeting date 5.
test('new deal at 17:58 on Thursday: office clocks of 5, 5 and 10 minutes, due Sunday 09:03 and 09:08 (winter time)', () => {
  const c = { id: 'a', name: 'פיצה נאפולי', deal_at: '2026-10-22T17:58:00+03:00', status: 'active', phone: '050-0000000' };
  const due = iso(at('2026-10-25T09:03:00+02:00'));
  const now1 = clocks('irit', c, {}, '2026-10-22T17:59:00+03:00');
  assert.deepEqual(brief(now1), [['deal', 'p02', due, 'running'], ['deal', 'p03', due, 'running'], ['deal', 'p01', iso(at('2026-10-25T09:08:00+02:00')), 'running']]);
  assert.deepEqual(now1.map((x) => [x.what, x.minutes]), [['קבוצה', 5], ['מועד אפיון', 5], ['חוזה', 10]]);
  // One minute left on Thursday and three on Sunday; the clock runs.
  assert.deepEqual([now1[0].remaining, now1[0].paused, now1[0].office, now1[0].phone], [4 * 6e4, false, true, '050-0000000']);
  assert.deepEqual([now1[2].remaining, now1[2].people], [9 * 6e4, ['irit']]); // the contract: one minute on Thursday and eight on Sunday
  // After 18:00 the clock stops with three minutes left, until Sunday 09:00.
  const night = clockTime(now1[0], at('2026-10-22T20:00:00+03:00'));
  assert.deepEqual([night.state, night.remaining, night.paused, iso(night.resumeAt)], ['running', 3 * 6e4, true, iso(at('2026-10-25T09:00:00+02:00'))]);
  assert.deepEqual(brief(clocks('irit', c, {}, '2026-10-24T12:00:00+03:00')).map((x) => x[3]), ['running', 'running', 'running']); // Saturday
  const sunday = clockTime(now1[0], at('2026-10-25T09:02:00+02:00'));
  assert.deepEqual([sunday.remaining, sunday.paused], [6e4, false]);
  // Ran out at 09:03 (the contract at 09:08): red in the bar until the end of Sunday, gone on Monday (it is in "overdue").
  assert.deepEqual(brief(clocks('irit', c, {}, '2026-10-25T09:03:00+02:00')).map((x) => x[3]), ['expired', 'expired', 'running']);
  assert.deepEqual(brief(clocks('irit', c, {}, '2026-10-25T09:08:00+02:00')).map((x) => x[3]), ['expired', 'expired', 'expired']);
  assert.equal(clocks('irit', c, {}, '2026-10-25T23:30:00+02:00').length, 3);
  assert.equal(clocks('irit', c, {}, '2026-10-26T08:00:00+02:00').length, 0);
  // Whose: Irit's; Lior has items in process 2 only; Ilai none. The owner sees each with its people.
  assert.deepEqual(brief(clocks('lior', c, {}, '2026-10-22T17:59:00+03:00')).map((x) => x[1]), ['p02']);
  assert.equal(clocks('ilai', c, {}, '2026-10-22T17:59:00+03:00').length, 0);
  const all = clocks(null, c, {}, '2026-10-22T17:59:00+03:00');
  assert.deepEqual(all.map((x) => [x.proc.id, x.people]), [['p02', ['irit', 'lior']], ['p03', ['irit']], ['p01', ['irit']]]);
});

test('the contract clock stops when the contract was sent; a finished or waiting process has no clock', () => {
  const c = { id: 'a', name: 'פיצה נאפולי', deal_at: '2026-10-05T10:00:00+03:00', status: 'active' };
  const now = '2026-10-05T10:04:00+03:00';
  // Sent within its 10 minutes: the signature is the client's, with a clock of its own.
  const sent = done(['p01.prepared', 'p01.sent'], '2026-10-05T10:03:00+03:00');
  assert.deepEqual(clocks('irit', c, sent, now).map((x) => x.proc.id), ['p02', 'p03']);
  assert.deepEqual(DEAL_CLOCKS.p01.until, ['p01.prepared', 'p01.sent']);
  // Process 2 complete, process 3 waiting on the client.
  const checks = { ...sent, ...done(P2, '2026-10-05T10:02:00+03:00'), [WAIT({ id: 'p03' })]: { state: 'done', at: '2026-10-05T10:03:00+03:00', note: '{}' } };
  assert.deepEqual(clocks('irit', c, checks, now), []);
  // Imported or cancelled clients have no clocks.
  assert.deepEqual(clocks('irit', c, done([...P1, ...P2, ...P3], '2026-10-05T10:00:00+03:00', IMPORT_NOTE), now), []);
  assert.deepEqual(clocks('irit', { ...c, status: 'cancelled' }, {}, now), []);
  assert.deepEqual(clocks(null, { ...c, status: 'ended' }, {}, now), []);
});

test('erev chag: a deal at 12:58 on erev Yom Kippur is due Tuesday 09:03', () => {
  const c = { id: 'e', name: 'מאפה שקד', deal_at: '2026-09-20T12:58:00+03:00', status: 'active' };
  const list = clocks('irit', c, {}, '2026-09-20T12:59:00+03:00');
  assert.deepEqual(brief(list), [['p02', '09:03'], ['p03', '09:03'], ['p01', '09:08']].map(([p, t]) => ['deal', p, iso(at(`2026-09-22T${t}:00+03:00`)), 'running']));
  assert.equal(list[0].remaining, 4 * 6e4); // one minute before 13:00, three on Tuesday
  // The office closed at 13:00 and Monday is Yom Kippur: stopped until Tuesday 09:00.
  for (const when of ['2026-09-20T13:30:00+03:00', '2026-09-21T11:00:00+03:00']) {
    const t = clockTime(list[0], at(when));
    assert.deepEqual([t.state, t.remaining, t.paused, iso(t.resumeAt)], ['running', 3 * 6e4, true, iso(at('2026-09-22T09:00:00+03:00'))], when);
  }
});

// A client midway: graphics (7) sent at 10:00, the rest of the graphics (23) at 11:00, videos (26) at 12:00.
const mid = { id: 'b', name: 'קפה גליה', phone: '050-0000001', deal_at: '2026-09-28T09:00:00+03:00', char_at: '2026-09-29T10:00:00+03:00', status: 'active', characterizer: 'ofir', shoot_type: 'dms', has_logo: true };
const early = done([...P1, ...P2, ...P3], '2026-09-28T09:03:00+03:00');
const sent = { ...early, ...done(['p07.sent'], '2026-10-05T10:00:00+03:00'), ...done(['p23.sent'], '2026-10-05T11:00:00+03:00'), ...done(['p26.sent'], '2026-10-05T12:00:00+03:00') };

test('"the client did not answer": 10, 10 and 5 office minutes from the sending', () => {
  const list = clocks('irit', mid, sent, '2026-10-05T12:01:00+03:00', 'answer');
  // What ran out first (longest ago), then what is still running.
  assert.deepEqual(brief(list), [
    ['answer', 'p07', iso(at('2026-10-05T10:10:00+03:00')), 'expired'],
    ['answer', 'p23', iso(at('2026-10-05T11:10:00+03:00')), 'expired'],
    ['answer', 'p26', iso(at('2026-10-05T12:05:00+03:00')), 'running'],
  ]);
  assert.deepEqual(list.map((x) => [x.minutes, x.what, x.people, x.phone]), [
    [10, ANSWER_CLOCKS.p07.what, ['irit'], '050-0000001'], [10, 'יתרת הגרפיקות', ['irit'], '050-0000001'], [5, 'הסרטונים', ['irit'], '050-0000001'],
  ]);
  assert.equal(list[2].remaining, 4 * 6e4);
  assert.equal(iso(list[0].sentAt), iso(at('2026-10-05T10:00:00+03:00')));
  assert.equal(list[0].id, `answer:b:p07:${iso(list[0].sentAt)}`);
  // Irit calls: they are hers, not Lior's (the owner sees them too).
  assert.equal(clocks('lior', mid, sent, '2026-10-05T12:01:00+03:00', 'answer').length, 0);
  assert.equal(clocks(null, mid, sent, '2026-10-05T12:01:00+03:00', 'answer').length, 3);
  // Sent at 17:55: five minutes today, five tomorrow from 09:00.
  const late = clocks('irit', mid, { ...early, ...done(['p07.sent'], '2026-10-05T17:55:00+03:00') }, '2026-10-05T17:56:00+03:00', 'answer');
  assert.equal(iso(late[0].deadline), iso(at('2026-10-06T09:05:00+03:00')));
  assert.equal(late[0].remaining, 9 * 6e4);
});

test('the answer (or a call, an approval, a wait) stops the clock; only after this sending', () => {
  const now = '2026-10-05T12:01:00+03:00';
  const p07 = applicableProcesses(mid).find((p) => p.id === 'p07');
  assert.equal(ANSWERED(p07), 'p07.answered');
  const procs = (checks) => clocks('irit', mid, checks, now, 'answer').map((x) => x.proc.id);
  assert.deepEqual(procs({ ...sent, ...done(['p07.answered'], '2026-10-05T10:06:00+03:00') }), ['p23', 'p26']);
  assert.deepEqual(procs({ ...sent, ...done(['p07.call'], '2026-10-05T10:12:00+03:00') }), ['p23', 'p26']);
  assert.deepEqual(procs({ ...sent, ...done(['p07.approved', 'p27.approved'], '2026-10-05T12:00:30+03:00') }), ['p23']);
  assert.deepEqual(procs({ ...sent, 'p23.wait': { state: 'done', at: '2026-10-05T11:20:00+03:00', note: '{}' } }), ['p07', 'p26']);
  // A wait that began before the sending (say, for the client's material) is not an answer to it.
  const waitFrom = (at, note = '{}') => ({ [WAIT(p07)]: { state: 'done', at, note } });
  assert.deepEqual(procs({ ...sent, ...waitFrom('2026-10-05T09:00:00+03:00') }), ['p07', 'p23', 'p26']);
  assert.deepEqual(procs({ ...sent, ...waitFrom('2026-10-05T10:05:00+03:00') }), ['p23', 'p26']);
  // Edited after the sending, the wait keeps its start (`since`): still from before.
  const edited = JSON.stringify({ reason: 'חומרים', recheck: null, since: '2026-10-05T09:00:00+03:00' });
  assert.deepEqual(procs({ ...sent, ...waitFrom('2026-10-05T10:05:00+03:00', edited) }), ['p07', 'p23', 'p26']);
  // An answer to an earlier sending does not stop the clock of the next one (sent again after a fix).
  const again = { ...sent, ...done(['p07.answered'], '2026-10-05T09:30:00+03:00') };
  assert.deepEqual(procs(again), ['p07', 'p23', 'p26']);
  // Imported history, or "not relevant", is not a sending.
  assert.deepEqual(procs({ ...sent, ...done(['p07.sent', 'p23.sent'], '2026-10-05T10:00:00+03:00', IMPORT_NOTE) }), ['p26']);
  assert.deepEqual(procs({ ...sent, 'p26.sent': { state: 'na', at: '2026-10-05T12:00:00+03:00' } }), ['p07', 'p23']);
  // An answered clock stays gone the next day too; an unanswered one leaves the bar at midnight.
  assert.equal(clocks('irit', mid, sent, '2026-10-06T09:00:00+03:00', 'answer').length, 0);
});

test('second shoot round: the videos clock and its answer mark carry the round', () => {
  const c = { ...mid, id: 'r', rounds: [{ n: 2, shoot_type: 'dms', shoot_at: '2026-10-01T10:00:00+03:00', start_at: '2026-09-30T09:00:00+03:00' }] };
  const r2 = applicableProcesses(c).find((p) => p.id === 'r2-p26');
  assert.equal(ANSWERED(r2), 'r2.p26.answered');
  const checks = { ...early, ...done(['r2.p26.sent'], '2026-10-05T12:00:00+03:00') };
  const list = clocks('irit', c, checks, '2026-10-05T12:01:00+03:00', 'answer');
  assert.deepEqual(brief(list), [['answer', 'r2-p26', iso(at('2026-10-05T12:05:00+03:00')), 'running']]);
  assert.equal(clocks('irit', c, { ...checks, ...done(['r2.p26.answered'], '2026-10-05T12:02:00+03:00') }, '2026-10-05T12:03:00+03:00', 'answer').length, 0);
  assert.equal(clocks('irit', c, { ...checks, ...done(['r2.p27.approved'], '2026-10-05T12:02:00+03:00') }, '2026-10-05T12:03:00+03:00', 'answer').length, 0);
  // The first round's approval is not the second round's.
  assert.equal(clocks('irit', c, { ...checks, ...done(['p27.approved'], '2026-10-05T12:02:00+03:00') }, '2026-10-05T12:03:00+03:00', 'answer').length, 1);
});

test('the answer mark fits the database check on item keys', () => {
  // The latest migration that sets protocol_checks_item_key_check.
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  const all = [...sql.matchAll(/protocol_checks_item_key_check\s+check \(item_key ~ '([^']+)'\)/g)];
  assert.ok(all.length, 'constraint found');
  const re = new RegExp(all.at(-1)[1]);
  for (const k of ['p07.answered', 'p23.answered', 'p26.answered', 'r2.p26.answered']) assert.match(k, re);
  assert.doesNotMatch('p07.Answered', re); // the check is real
});

test('deadlines within the hour join the bar; end-of-day deadlines and waits do not', () => {
  // Ofir's meeting at 10:00 is due at 12:00 (the real clock: a meeting).
  const c = { ...mid, id: 'c', name: 'מספרת רון', char_at: '2026-10-05T10:00:00+03:00' };
  const soon = (person, now, checks = early) => clocks(person, c, checks, now, 'soon');
  assert.equal(soon('ofir', '2026-10-05T10:59:00+03:00').filter((x) => x.proc.id === 'p04').length, 0); // 61 minutes
  assert.equal(soon('ofir', '2026-10-05T11:00:00+03:00').filter((x) => x.proc.id === 'p04').length, 1); // 60
  const list = soon('ofir', '2026-10-05T11:05:00+03:00');
  const p04 = list.find((x) => x.proc.id === 'p04');
  assert.deepEqual([iso(p04.deadline), p04.state, p04.remaining, p04.office, p04.people, p04.what], [iso(at('2026-10-05T12:00:00+03:00')), 'running', 55 * 6e4, false, ['ofir'], 'ביצוע פגישת אפיון']);
  assert.ok(list.every((x) => x.people.includes('ofir')));
  assert.equal(soon('ilai', '2026-10-05T11:05:00+03:00').length, 0);
  // Ran out at 12:00: an hour in the bar, then only in "overdue".
  assert.equal(soon('ofir', '2026-10-05T12:30:00+03:00').find((x) => x.proc.id === 'p04')?.state, 'expired');
  assert.equal(soon('ofir', '2026-10-05T13:01:00+03:00').filter((x) => x.proc.id === 'p04').length, 0);
  // Waiting on the client stops it.
  assert.equal(soon('ofir', '2026-10-05T11:05:00+03:00', { ...early, [WAIT({ id: 'p04' })]: { state: 'done', at: '2026-10-05T10:30:00+03:00', note: '{}' } }).filter((x) => x.proc.id === 'p04').length, 0);
  // Lior's call is due by the end of Tuesday: a date, not a clock.
  assert.equal(soon('lior', '2026-10-06T23:30:00+03:00').filter((x) => x.proc.id === 'p12a').length, 0);
  assert.equal(SOON_MINUTES, 60);
});

test('an office-time deadline within the hour is stopped before 09:00', () => {
  // Access arrived at 17:50: Ilai's 30 office minutes end Tuesday 09:20.
  const c = { ...mid, id: 'd', char_at: '2026-10-05T10:00:00+03:00' };
  const checks = { ...early, ...done(['p05.access'], '2026-10-05T17:50:00+03:00') };
  assert.equal(clocks('ilai', c, checks, '2026-10-05T17:55:00+03:00', 'soon').filter((x) => x.proc.id === 'p06').length, 0);
  const p06 = clocks('ilai', c, checks, '2026-10-06T08:30:00+03:00', 'soon').find((x) => x.proc.id === 'p06');
  assert.deepEqual([iso(p06.deadline), p06.office, p06.paused, p06.remaining, iso(p06.resumeAt)],
    [iso(at('2026-10-06T09:20:00+03:00')), true, true, 20 * 6e4, iso(at('2026-10-06T09:00:00+03:00'))]);
});

test('most urgent first across clients: ran out, then least time left', () => {
  const deal = { id: 'n', name: 'פיצה נאפולי', deal_at: '2026-10-05T11:59:00+03:00', status: 'active' };
  const list = clocksFor('irit', [deal, mid], { b: sent }, { now: at('2026-10-05T12:01:00+03:00') });
  assert.deepEqual(list.map((x) => [x.kind, x.proc.id, x.state]), [
    ['answer', 'p07', 'expired'], ['answer', 'p23', 'expired'],
    ['deal', 'p02', 'running'], ['deal', 'p03', 'running'], // 3 minutes left
    ['answer', 'p26', 'running'], // 4 minutes left
    ['deal', 'p01', 'running'], // the contract: 8 minutes left
  ]);
});

test('countdown text', () => {
  assert.equal(clockDigits(272_000), '4:32');
  assert.equal(clockDigits(271_001), '4:32'); // rounded up to the second
  assert.equal(clockDigits(999), '0:01');
  assert.equal(clockDigits(0), '0:00');
  assert.equal(clockDigits(-5000), '0:00');
  assert.equal(clockDigits(3_600_000), '1:00:00');
  assert.equal(clockDigits(3_725_000), '1:02:05');
});
