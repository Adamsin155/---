// The landing of the clients that came from the old system (docs/ops.md, section 41):
// in landing nothing is late anywhere; taking in shows each person their own items
// with a proposal; after the activation the deadlines are counted from landed_at and
// recurring work is spread; the contract's real dates are never touched.
// Runs under three time zones (npm test): nothing here depends on the machine's zone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE, STATIONS } from '../app/protocol.js';
import {
  clientState, openItemsFor, performanceReport, inLanding, workFloor, freshDeadline, spreadStart, SPREAD_DAYS,
  IMPORT_NOTE, isBusinessDay, addBusinessDays, renewalDay, upcomingFor, involves,
} from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';
import {
  withIntake, intakeItems, intakeFor, intakeLeft, proposalFor, evidentStation, stationNow, waitingPeople, quietWork,
  stationPlan, landingBoard, canTake, shootSoon,
} from '../app/landing-logic.js';
import { clocksFor } from '../app/clocks.js';
import { clientHealth, lateNow, lastActivity, naCounts } from '../app/health.js';
import { controlTopics } from '../app/control-topics.js';
import { stuckOf, dataHealth } from '../app/pass-logic.js';
import { qaQueue, editorLoad } from '../app/qa-logic.js';
import { shootHistory } from '../app/shoot-table.js';
import { handoffsFor } from '../app/handoffs.js';
import { fastCases } from '../app/fast-ladder.js';
import { cycleFrom, openMonthItems, monthStart, termOf, monthOf, yearOf, renewalsDue } from '../app/year-logic.js';
import { contractSummary, renewalWindow } from '../app/contract-summary.js';
import { monthRange, contractEndKey, calendarMonths, generatePlan } from '../app/gantt-logic.js';
import { dayKeyIL, partsIL } from '../app/tz.js';

const IMPORTED = '2026-10-06T10:00:00Z';
const NOW = new Date('2026-10-20T08:00:00Z'); // Tuesday, 11:00 in Israel
const base = (over = {}) => ({
  id: 'c1', name: 'דנה', business: 'קפה דנה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  deal_at: '2026-05-10T07:00:00Z', char_at: '2026-05-14T08:00:00Z', shoot_at: '2026-06-20T06:00:00Z', contract_end: '2027-05-10',
  editor: 'nadia', rounds: [], deliverables: { videos: 20, graphics: 35, shoot_days: 1 }, protocol_version: 7,
  created_by_email: 'system', quote_id: null, created_at: IMPORTED, ...over,
});
const imported = (station, at = IMPORTED) => Object.fromEntries(importKeys(station).map((k) => [k, { state: 'done', note: IMPORT_NOTE, at, by_email: '' }]));
const TEAM = Object.keys(PEOPLE).filter((p) => p !== 'editor' && !PEOPLE[p].sales);

test('before landing existed, an imported client was weeks late on the day it arrived', () => {
  const c = base();
  const s = clientState(c, imported('shoot'), NOW);
  assert.ok(s.overdue >= 5, `overdue ${s.overdue}`);
  assert.ok(openItemsFor('lior', c, imported('shoot'), s, NOW).some((x) => x.status === 'overdue'));
});

test('in landing: no deadline, nothing late, nobody has it in a list, a clock or a count', () => {
  const c = base({ landing: true });
  const checks = imported('shoot');
  const s = clientState(c, checks, NOW);
  assert.equal(inLanding(c), true);
  assert.equal(s.landing, true);
  assert.equal(s.overdue, 0);
  assert.deepEqual(s.states.filter((x) => x.dueAt || x.baseDueAt || x.late).map((x) => x.proc.id), []);
  assert.deepEqual([...new Set(s.states.map((x) => x.status))].filter((st) => st === 'overdue' || st === 'today' || st === 'due'), []);
  for (const p of [...TEAM, null]) assert.deepEqual(openItemsFor(p, c, checks, s, NOW), [], String(p));
  assert.deepEqual(clocksFor(null, [c], { c1: checks }, { now: NOW }), []);
  assert.deepEqual(clientHealth(c, s, { checks, now: NOW, messages: [], statusNotes: [], tasks: [] }), { color: 'green', reasons: [], landing: true });
  assert.deepEqual(stuckOf(c, s, { checks }, NOW), []);
  assert.equal(lateNow([c], () => s, [], NOW), 0);
  const topics = controlTopics({ clients: [c], checks: { c1: checks }, stateOf: () => s, tasks: [], deals: [], work: [], now: NOW });
  assert.equal(topics.reduce((n, t) => n + t.count, 0), 0);
  const dh = dataHealth({ clients: [c], stateOf: () => s, checks: { c1: checks }, tasks: [], now: NOW });
  assert.deepEqual([dh.unowned.length, dh.noEditor.length], [0, 0]);
  assert.equal(shootHistory(c, checks, NOW, s).unclosed?.length || 0, 0);
  assert.deepEqual(performanceReport([c], { c1: checks }, { now: NOW }).people, []);
  // It is still a client of the people who work on it, and a shoot day ahead still shows.
  assert.equal(involves('lior', c, checks, s, NOW), true);
  const ahead = base({ landing: true, shoot_at: '2026-10-25T06:00:00Z' });
  const sa = clientState(ahead, imported('shoot'), NOW);
  assert.ok(upcomingFor('eli', ahead, sa, NOW).length > 0, 'the photographer sees the coming shoot day');
  assert.ok(shootSoon(ahead, NOW));
  assert.equal(shootSoon(c, NOW), null);
});

test('in landing: the weekly call, the monthly cycle, the QA hour, hand-overs and the automatic editor are off', () => {
  const c = base({ landing: true });
  const checks = imported('ongoing');
  const s = clientState(c, checks, NOW);
  const p31 = s.states.find((x) => x.proc.id === 'p31');
  assert.equal(p31.ready, false);
  assert.equal(p31.status, 'waiting');
  assert.equal(cycleFrom(c, s), null);
  assert.deepEqual(openMonthItems(null, c, s, checks, {}, NOW), []);
  assert.equal(yearOf(c, s, checks, {}, NOW).months.reduce((n, m) => n + m.late, 0), 0);
  // The same client outside landing has a cycle.
  assert.ok(cycleFrom(base(), clientState(base(), checks, NOW)) >= 2);
  // A video really waiting for Ofir is in his queue, with no hour counted.
  const post = { ...imported('post'), 'p22a.assigned': { state: 'done', at: '2026-10-08T07:00:00Z' }, 'p24.notify': { state: 'done', at: '2026-10-10T07:00:00Z' } };
  const sp = clientState(c, post, NOW);
  for (const q of qaQueue({ clients: [c], stateOf: () => sp, checks: { c1: post }, now: NOW })) assert.deepEqual([q.late, q.waited, q.landing], [false, 0, true]);
  for (const j of editorLoad({ clients: [c], stateOf: () => sp, checks: { c1: post }, now: NOW }).nadia.jobs) assert.equal(j.landing, true);
  assert.deepEqual(handoffsFor(c, post, 'p24.notify', { now: NOW }), []);
  const noEditor = base({ landing: true, editor: null });
  const shot = { ...imported('shoot'), 'p19.done': { state: 'done', at: '2026-10-19T07:00:00Z' } };
  const closed = Object.fromEntries(clientState(noEditor, shot, NOW).states.find((x) => x.proc.id === 'p19').proc.items.map((i) => [i.key, { state: 'done', at: '2026-10-19T07:00:00Z' }]));
  const all = { ...imported('shoot'), ...closed };
  // A shoot day closed on a client in landing: nothing is put on Ofir's ten-minute clock (protocol v9).
  assert.deepEqual(fastCases({ clients: [noEditor], stateOf: (x) => clientState(x, all, NOW), checksOf: () => all }), []);
});

test('taking in: each person sees only their own items, and the answers are kept apart from the protocol', () => {
  const c = base({ landing: true });
  const checks = imported('shoot');
  const by = Object.fromEntries(TEAM.map((p) => [p, intakeItems(p, c, checks, {}, NOW)]));
  assert.ok(by.lior.length > 0 && by.irit.length >= 0);
  for (const p of TEAM) {
    for (const i of by[p]) {
      const owners = i.proc.items.find((x) => x.key === i.key).owners;
      assert.ok(owners.includes(p), `${p} was shown ${i.key}`);
      assert.equal(checks[i.key], undefined);
    }
  }
  // The weekly call is never asked about; sales, the owner and a made-up person get nothing.
  assert.ok(!Object.values(by).flat().some((i) => i.key === 'p31.call'));
  for (const p of ['stav', 'amos', 'editor', null, 'nobody']) assert.deepEqual(intakeItems(p, c, checks, {}, NOW), [], String(p));
  // An editor who does not edit this client, and the photographer long after the shoot, are not asked.
  assert.equal(canTake('anna', c, NOW), false);
  assert.equal(canTake('nadia', c, NOW), true);
  assert.equal(canTake('eli', c, NOW), false);
  assert.equal(canTake('eli', base({ shoot_at: '2026-10-25T06:00:00Z' }), NOW), true);
  assert.equal(canTake('nirel', base({ shoot_type: 'natali', editor: null }), NOW), true);
  // Not in landing (a new client): nobody takes anything in.
  assert.deepEqual(intakeItems('lior', base(), checks, {}, NOW), []);

  // An answer stays in the list with its choice, and counts as history only through withIntake.
  const key = by.lior[0].key;
  const marks = { [key]: { choice: 'done', person: 'lior', at: NOW.toISOString(), by_email: 'lior@x' } };
  assert.equal(intakeItems('lior', c, checks, marks, NOW).find((i) => i.key === key).choice, 'done');
  assert.deepEqual(withIntake(checks, marks)[key], { state: 'done', note: IMPORT_NOTE, at: NOW.toISOString(), by_email: 'lior@x', staged: true });
  assert.equal(withIntake(checks, { [key]: { choice: 'open' } })[key], undefined);
  assert.equal(withIntake({ [key]: { state: 'done', at: 'x' } }, { [key]: { choice: 'na' } })[key].at, 'x', 'a real mark wins');
  assert.equal(withIntake(checks, { [key]: { choice: 'na', at: 'y' } })[key].state, 'na');
});

test('the proposal: what is behind the evident station is proposed as done, shown and never applied by itself', () => {
  // The old system said "not shot yet", and the shoot day was four months ago.
  const c = base({ landing: true });
  const checks = imported('shoot');
  assert.equal(STATIONS[stationNow(c, checks, NOW)].key, 'shoot');
  const ev = evidentStation(c, checks, NOW);
  assert.equal(STATIONS[ev.index].key, 'post');
  assert.match(ev.why, /יום הצילום כבר היה \(20\.6\)/);
  const p = proposalFor('lior', c, checks, {}, NOW);
  assert.ok(p.done.length > 0);
  assert.ok(p.done.every((k) => /^p(15|16|17|18|19|20|21)\./.test(k)), p.done.join());
  assert.ok(p.open.every((k) => !/^p(15|16|17|18|19)\./.test(k)));
  // Nothing was applied: every item is still unanswered.
  assert.ok(intakeItems('lior', c, checks, {}, NOW).every((i) => i.choice === null));
  // No sign beyond the import's guess: no proposal.
  const future = base({ landing: true, shoot_at: '2026-11-20T06:00:00Z' });
  assert.equal(evidentStation(future, checks, NOW).why, null);
  assert.equal(proposalFor('lior', future, checks, {}, NOW), null);
  // Real work marked in a later station is a sign too.
  const worked = { ...imported('char'), 'p12.written': { state: 'done', at: '2026-10-10T07:00:00Z' } };
  const key = Object.keys(clientState(base(), {}, NOW).states.find((x) => x.proc.id === 'p12').proc.items.reduce((o, i) => ({ ...o, [i.key]: 1 }), {}))[0];
  const ev2 = evidentStation(base({ landing: true, shoot_at: null }), { ...imported('char'), [key]: { state: 'done', at: '2026-10-10T07:00:00Z' } }, NOW);
  assert.equal(STATIONS[ev2.index].key, 'content');
  assert.ok(worked);
});

test('who still has to go over a client, the line of each person, and what stays in the quiet list', () => {
  const c = base({ landing: true });
  const other = base({ id: 'c2', business: 'מוסך', landing: true, shoot_at: '2026-11-20T06:00:00Z' });
  const fresh = base({ id: 'c3', business: 'חדש' }); // signed today: never in landing
  const checksBy = { c1: imported('shoot'), c2: imported('content'), c3: {} };
  const waiting = waitingPeople(c, checksBy.c1, {}, {}, NOW);
  assert.ok(waiting.includes('lior'));
  assert.ok(waiting.every((p) => intakeItems(p, c, checksBy.c1, {}, NOW).length > 0));
  const list = intakeFor('lior', [c, other, fresh], checksBy, {}, {}, NOW);
  assert.deepEqual(list.map((x) => x.client.id).sort(), ['c1', 'c2']);
  assert.equal(intakeLeft(list), 2);
  // Lior finished c1 and left one item open.
  const items = intakeItems('lior', c, checksBy.c1, {}, NOW);
  const marks = { c1: Object.fromEntries(items.map((i, n) => [i.key, { choice: n === 0 ? 'open' : 'done', person: 'lior', at: NOW.toISOString() }])) };
  const done = { c1: { lior: { done: true } } };
  const after = intakeFor('lior', [c, other, fresh], checksBy, marks, done, NOW);
  assert.equal(intakeLeft(after), 1);
  assert.equal(after.at(-1).client.id, 'c1', 'finished clients go last');
  assert.ok(!waitingPeople(c, checksBy.c1, marks.c1, done.c1, NOW).includes('lior'));
  const quiet = quietWork('lior', [c, other, fresh], checksBy, marks, done, NOW);
  // What he left open, and what his answers opened next (the shoot day done: the hand-over to editing).
  assert.deepEqual(quiet.map((x) => x.client.id), ['c1']);
  assert.ok(quiet[0].items.some((i) => i.key === items[0].key));
  assert.ok(quiet[0].items.every((i) => i.choice !== 'done' && i.choice !== 'na'));
  assert.ok(quiet[0].items.filter((i) => i.key !== items[0].key).every((i) => !items.some((x) => x.key === i.key)));
  // Taking "I finished" back: the client is in the line again.
  assert.equal(intakeLeft(intakeFor('lior', [c], checksBy, marks, { c1: { lior: { done: false } } }, NOW)), 1);

  const b = landingBoard([c, other, fresh], checksBy, marks, done, NOW);
  assert.equal(b.total, 2);
  const lior = b.people.find((r) => r.key === 'lior');
  assert.deepEqual([lior.total, lior.finished, lior.left.map((x) => x.id)], [2, 1, ['c2']]);
  assert.deepEqual(b.soon.map((x) => x.id), []);
  // Everyone finished c1: it is ready for the one tap.
  const everyone = { c1: Object.fromEntries(TEAM.map((p) => [p, { done: true }])) };
  assert.deepEqual(landingBoard([c, other], checksBy, marks, everyone, NOW).ready.map((x) => x.id), ['c1']);
  // A client with only recurring work has nothing to take in and is ready at once.
  const ongoing = base({ id: 'c4', landing: true });
  assert.deepEqual(landingBoard([ongoing], { c4: { ...imported('ongoing') } }, {}, {}, NOW).ready.map((x) => x.id), ['c4']);
});

test('correcting the station marks what is before it as imported, and takes back imported marks from it on', () => {
  const c = base({ landing: true });
  const checks = { ...imported('shoot'), 'p22a.assigned': { state: 'done', at: '2026-10-08T07:00:00Z', note: null } };
  const fwd = stationPlan(c, checks, 'post');
  assert.deepEqual(fwd.clear, []);
  assert.deepEqual(fwd.set.sort(), importKeys('post').filter((k) => !checks[k]).sort());
  assert.ok(fwd.set.includes('p19.done') || fwd.set.some((k) => k.startsWith('p19.')));
  const back = stationPlan(c, checks, 'content');
  assert.deepEqual(back.set, []);
  assert.ok(back.clear.length > 0 && back.clear.every((k) => checks[k].note === IMPORT_NOTE && !importKeys('content').includes(k)));
  assert.ok(!back.clear.includes('p22a.assigned'), 'a real mark is never touched');
  assert.deepEqual(stationPlan(c, checks, 'shoot'), { set: [], clear: [] });
  assert.equal(stationPlan(c, checks, 'nowhere'), null);
});

test('activation: what stayed open is counted from landed_at, and nothing is born late', () => {
  const landed = '2026-10-20T08:00:00Z';
  const c = base({ landing: false, landed_at: landed, landing_slot: 0 });
  // Lior said the shoot day was done; editing is really still open.
  const checks = imported('post', landed);
  for (const k of Object.keys(checks)) if (/^p(22|23|24|25|26|27)/.test(k)) delete checks[k];
  const floor = workFloor(c);
  assert.equal(floor.toISOString(), new Date(landed).toISOString());
  const at = clientState(c, checks, new Date(landed));
  assert.equal(at.overdue, 0);
  const open = at.states.filter((s) => !s.complete && !s.proc.recurring && s.dueAt && s.proc.due?.from !== 'contractEnd');
  assert.ok(open.length > 0);
  for (const s of open) assert.ok(s.dueAt >= freshDeadline(floor) || s.dueAt > floor, `${s.proc.id} due ${s.dueAt.toISOString()}`);
  // The same checks without the activation: late from months ago.
  assert.ok(clientState(base(), checks, new Date(landed)).overdue > 0);
  // A day later it is still not late; a week later, what was not done is.
  assert.equal(clientState(c, checks, new Date('2026-10-21T08:00:00Z')).overdue, 0);
  assert.ok(clientState(c, checks, new Date('2026-11-05T08:00:00Z')).overdue > 0);
  // Work finished before the activation is not measured; after it, it is, on its fresh deadline.
  const doneKeys = at.states.find((s) => s.proc.id === 'p22a').proc.items.map((i) => i.key);
  const finished = { ...checks, ...Object.fromEntries(doneKeys.map((k) => [k, { state: 'done', at: '2026-10-20T10:00:00Z' }])) };
  const rep = performanceReport([c], { c1: finished }, { now: new Date('2026-10-22T08:00:00Z') });
  assert.deepEqual(rep.processes.filter((p) => p.key === 'p22a').map((p) => [p.done, p.onTime]), [[1, 1]]);
  const early = { ...checks, ...Object.fromEntries(doneKeys.map((k) => [k, { state: 'done', at: '2026-10-15T10:00:00Z' }])) };
  assert.deepEqual(performanceReport([c], { c1: early }, { now: new Date('2026-10-22T08:00:00Z') }).processes.filter((p) => p.key === 'p22a'), []);
  // "How long" elsewhere is counted from the activation too.
  assert.ok(lastActivity(c, { checks: {} }) >= floor);
  assert.equal(clientHealth(c, at, { checks, now: new Date(landed), messages: [], statusNotes: [], tasks: [] }).reasons.filter((r) => ['quiet', 'stuck', 'no-contact', 'late'].includes(r.code)).length, 0);
});

test('activation never moves the contract: its end, the package year, the renewal and the Gantt read the real dates', () => {
  const plain = base();
  const active = base({ landing: false, landed_at: '2026-10-20T08:00:00Z', landed_by: 'owner@x', landing_slot: 3 });
  const quiet = base({ landing: true });
  const checks = imported('ongoing');
  for (const c of [active, quiet]) {
    assert.equal(c.deal_at, plain.deal_at);
    assert.equal(c.contract_end, plain.contract_end);
    assert.equal(termOf(c), termOf(plain));
    for (const n of [1, 2, 6, 12]) assert.equal(+monthStart(c, n), +monthStart(plain, n));
    const { n, of, start } = monthOf(c, NOW);
    assert.deepEqual([n, of, +start], [monthOf(plain, NOW).n, monthOf(plain, NOW).of, +monthOf(plain, NOW).start]);
    assert.deepEqual(renewalWindow(c, NOW), renewalWindow(plain, NOW));
    assert.equal(contractEndKey(c), contractEndKey(plain));
    assert.deepEqual(calendarMonths(c), calendarMonths(plain));
    assert.deepEqual(monthRange(c, 6), monthRange(plain, 6));
    assert.deepEqual(generatePlan(c), generatePlan(plain));
    const cs = contractSummary(c, clientState(c, checks, NOW), checks, { now: NOW });
    const ps = contractSummary(plain, clientState(plain, checks, NOW), checks, { now: NOW });
    assert.deepEqual([cs.month, cs.renewal], [ps.month, ps.renewal]);
    assert.deepEqual(renewalsDue([c], new Date('2027-03-01T08:00:00Z')).map((x) => x.daysLeft), renewalsDue([plain], new Date('2027-03-01T08:00:00Z')).map((x) => x.daysLeft));
  }
  // Process 34 is due 60 days before the real end, activated or not, and is quiet only in landing.
  const p34 = (c, now) => clientState(c, checks, now).states.find((s) => s.proc.id === 'p34');
  const day = new Date('2027-03-20T08:00:00Z');
  assert.equal(+p34(active, day).dueAt, +p34(plain, day).dueAt);
  assert.equal(dayKeyIL(p34(active, day).dueAt), dayKeyIL(renewalDay(plain.contract_end)));
  assert.equal(p34(active, day).status, 'overdue');
  assert.equal(p34(quiet, day).dueAt, null);
  // A client activated inside the renewal window is told the truth: the renewal is late.
  const lateEnd = base({ contract_end: '2026-11-15', landing: false, landed_at: '2026-10-20T08:00:00Z' });
  assert.equal(clientState(lateEnd, checks, NOW).states.find((s) => s.proc.id === 'p34').status, 'overdue');
});

test('spreading: forty first weekly calls fall four a day over ten working days, then each keeps its week', () => {
  const landed = '2026-10-20T08:00:00Z';
  const checks = imported('ongoing');
  const clients = Array.from({ length: 40 }, (_, i) => base({ id: `c${i}`, landing: false, landed_at: landed, landing_slot: i % SPREAD_DAYS }));
  const days = new Map();
  for (const c of clients) {
    const first = spreadStart(c);
    assert.ok(isBusinessDay(first) && first > workFloor(c));
    assert.equal(partsIL(first).hour, 9);
    days.set(dayKeyIL(first), (days.get(dayKeyIL(first)) || 0) + 1);
  }
  assert.equal(days.size, SPREAD_DAYS);
  assert.deepEqual([...new Set(days.values())], [4]);
  assert.ok([...days.keys()].sort().at(-1) <= dayKeyIL(addBusinessDays(new Date(landed), SPREAD_DAYS)));
  // On the day of the activation no call is asked for; each comes up on its own day.
  const due = (now) => clients.filter((c) => clientState(c, checks, now).states.find((s) => s.proc.id === 'p31').status === 'due').length;
  assert.equal(due(new Date(landed)), 0);
  assert.equal(due(new Date('2026-10-21T08:00:00Z')), 4);
  assert.equal(due(new Date('2026-10-22T08:00:00Z')), 8);
  assert.equal(due(new Date('2026-11-05T08:00:00Z')), 40);
  // A call recorded since the activation: done for its week, and due again seven days later.
  const c = clients[9];
  const called = { ...checks, 'p31.call': { state: 'done', at: '2026-10-21T09:00:00Z' } };
  const p31 = (now) => clientState(c, called, now).states.find((s) => s.proc.id === 'p31');
  assert.equal(p31(new Date('2026-10-22T08:00:00Z')).status, 'done');
  assert.equal(p31(new Date('2026-10-29T08:00:00Z')).status, 'due');
  // No slot (a client activated before the column existed): the next business day.
  assert.equal(dayKeyIL(spreadStart(base({ landing: false, landed_at: landed }))), '2026-10-21');
  // The monthly cycle starts the month after the activation, on the client's own month day.
  const s = clientState(clients[0], checks, NOW);
  const from = cycleFrom(clients[0], s);
  assert.ok(monthStart(clients[0], from) > workFloor(clients[0]));
  assert.ok(monthStart(clients[0], from - 1) <= workFloor(clients[0]));
  assert.deepEqual(openMonthItems(null, clients[0], s, checks, {}, new Date(landed)).filter((i) => i.status === 'overdue'), []);
});

test('a client signed today is untouched by any of this', () => {
  const now = new Date('2026-10-20T08:00:00Z');
  const fresh = base({ deal_at: '2026-10-20T07:30:00Z', char_at: null, shoot_at: null, created_at: '2026-10-20T07:30:00Z', quote_id: 'q1' });
  const withCols = { ...fresh, landing: false, landed_at: null, landed_by: null, landing_slot: null };
  const a = clientState(fresh, {}, now);
  const b = clientState(withCols, {}, now);
  assert.equal(workFloor(withCols), null);
  assert.equal(spreadStart(withCols), null);
  assert.deepEqual(b.states.map((s) => [s.proc.id, s.status, s.dueAt && +s.dueAt, s.ready]), a.states.map((s) => [s.proc.id, s.status, s.dueAt && +s.dueAt, s.ready]));
  assert.ok(a.overdue > 0, 'its five-minute clocks run as always');
  assert.ok(openItemsFor('irit', withCols, {}, b, now).length > 0);
  assert.ok(clocksFor('irit', [withCols], {}, { now: new Date('2026-10-20T07:32:00Z') }).length > 0);
});

test('"לא רלוונטי" said while taking in is not counted as skipping work', () => {
  const log = [
    { action: 'na', item_key: 'p05.access', note: IMPORT_NOTE, by_email: 'a@x', at: NOW.toISOString() },
    { action: 'na', item_key: 'p05.access', note: 'אין רשתות', by_email: 'a@x', at: NOW.toISOString() },
  ];
  const n = naCounts(log, { 'a@x': 'lior' });
  assert.ok((n.get('lior') || 0) <= 1);
});
