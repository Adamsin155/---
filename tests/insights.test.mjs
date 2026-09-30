// The owner's monthly insights (app/insights.js): months in Israel time, on time
// per role and person, returns from quality control by editor and round, the
// shoot to the first delivery, client requests against decision 29, satisfaction
// only when the surveys table exists, the "not relevant" report that suggests
// removing an item, and each shoot day from the scripts to the scheduling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeInsights, monthRange, monthsUpTo, monthKeyIL, naReport, requestsReport, satisfactionReport, qaReport,
  deliveryReport, onTimeReport, canSeeInsights, canSeePayouts, ROLES, INSIGHT_PEOPLE, NA_MIN_CASES, pct,
} from '../app/insights.js';
import { closedProcesses } from '../app/health.js';
import { clientState, applicableProcesses } from '../app/protocol-logic.js';

const NOW = new Date('2026-10-20T10:00:00+03:00'); // Tuesday
const OCT = monthRange('2026-10');

test('months: Israel calendar months, the last six, labels in Hebrew', () => {
  assert.equal(OCT.start.toISOString(), '2026-09-30T21:00:00.000Z');
  assert.equal(OCT.end.toISOString(), '2026-10-31T22:00:00.000Z'); // winter time from 25.10
  assert.match(OCT.label, /אוקטובר/);
  assert.equal(monthKeyIL(new Date('2026-10-31T22:30:00Z')), '2026-11');
  assert.equal(monthKeyIL(new Date('2026-09-30T21:30:00Z')), '2026-10');
  assert.deepEqual(monthsUpTo('2026-02', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.throws(() => monthRange('10.2026'));
});

// ── The fixture ────────────────────────────
const client = (id, fields) => ({
  id, name: '', address: null, phone: null, shoot_type: 'dms', characterizer: 'ofir', editor: null, package_name: null,
  deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-09-02T10:00:00+03:00', shoot_at: null, contract_end: '2027-09-01', status: 'active',
  rounds: [], deliverables: {}, links: {}, created_at: '2026-09-01T09:00:00+03:00', ...fields,
});
const A = client('aaaaaaaa-0000-4000-8000-000000000001', { name: 'מספרת רון', editor: 'nadia', shoot_at: '2026-10-04T10:00:00+03:00' });
const B = client('bbbbbbbb-0000-4000-8000-000000000002', {
  name: 'קפה גליה', shoot_type: 'natali', editor: 'yariv', shoot_at: '2026-10-11T10:00:00+03:00',
  rounds: [{ n: 2, shoot_at: '2026-10-18T10:00:00+03:00', shoot_type: 'natali', editor: 'nadia' }],
});
const C = client('cccccccc-0000-4000-8000-000000000003', { name: 'חנות ישנה', shoot_at: '2026-10-05T10:00:00+03:00', editor: 'anna' });
const D = client('dddddddd-0000-4000-8000-000000000004', { name: 'גן אירועים', status: 'cancelled', shoot_at: '2026-10-06T10:00:00+03:00', editor: 'anna' });
const log = [];
const checks = {};
const mark = (c, key, at, { action = 'done', note = null, by = 'x@astrateg.test' } = {}) => {
  log.push({ client_id: c.id, item_key: key, action, note, by_email: by, at: new Date(at).toISOString() });
  if (action === 'clear') delete (checks[c.id] ||= {})[key];
  else (checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state: action, note, by_email: by, at: new Date(at).toISOString() };
};
const T = (d, h) => `2026-${d}T${h}:00+03:00`;
// Ron: scripts, shot, handed to Ofir, returned twice, approved, sent (day 4), closed on day 6, scheduled.
mark(A, 'p13.approved', T('10-01', '12:00'));
mark(A, 'p19.all', T('10-04', '18:00'));
mark(A, 'p24.notify', T('10-07', '12:00'));
mark(A, 'p25.return.1', T('10-07', '14:00'));
mark(A, 'p25.return.2', T('10-08', '11:00'));
mark(A, 'p25.approved', T('10-08', '15:00'));
mark(A, 'p26.sent', T('10-08', '16:00'));
mark(A, 'p27.approved', T('10-12', '12:00'));
mark(A, 'p28.scheduled', T('10-12', '15:00'));
mark(A, 'p23.return.1', T('10-06', '12:00')); // graphics, Ilai
// Galia: one return, sent on day 3, closed on day 4; her second round returned once (Nadia's).
mark(B, 'p25.return.1', T('10-13', '12:00'));
mark(B, 'p25.approved', T('10-14', '10:00'));
mark(B, 'p26.sent', T('10-14', '11:00'));
mark(B, 'p27.approved', T('10-15', '12:00'));
mark(B, 'r2.p25.return.1', T('10-19', '12:00'));
// An imported delivery never counts; a return in September is not October's.
mark(C, 'p26.sent', T('10-06', '09:00'), { note: 'ייבוא' });
mark(C, 'p25.return.1', '2026-09-20T12:00:00+03:00');
// A cancelled client is left out.
mark(D, 'p25.return.1', T('10-07', '12:00'));

test('returns from quality control: by the editor of that shoot and by round; graphics apart', () => {
  const r = qaReport([A, B, C], checks, null, OCT);
  const by = Object.fromEntries(r.editors.map((e) => [e.key, [e.returns, e.byRound, e.approved]]));
  assert.deepEqual(by, { nadia: [3, [2, 1, 0], 1], yariv: [1, [1, 0, 0], 1] });
  assert.deepEqual([r.graphics.returns, r.graphics.byRound], [1, [1, 0, 0]]);
  assert.equal(r.total, 4);
  // With the history: a return undone at once (same person, within 10 minutes) is not one.
  const undoLog = [...log, { client_id: B.id, item_key: 'p25.return.9', action: 'done', note: null, by_email: 'o@a', at: T('10-16', '10:00') },
    { client_id: B.id, item_key: 'p25.return.9', action: 'clear', note: null, by_email: 'o@a', at: T('10-16', '10:03') }];
  const logBy = new Map([[A.id, undoLog.filter((x) => x.client_id === A.id)], [B.id, undoLog.filter((x) => x.client_id === B.id)]]);
  assert.equal(qaReport([A, B], checks, logBy, OCT).total, 4);
});

test('from the shoot to the first delivery, and closed within the promise ה8', () => {
  const r = deliveryReport([A, B, C], checks, null, OCT);
  assert.deepEqual(r.first.map((x) => [x.client.name, x.days]), [['מספרת רון', 4], ['קפה גליה', 3]]);
  assert.equal(r.median, 3.5);
  assert.deepEqual(r.closed.map((x) => [x.client.name, x.days, x.within]), [['מספרת רון', 6, false], ['קפה גליה', 4, true]]);
  assert.equal(r.closedWithin, 1);
});

test('client requests against decision 29: a business day, urgent within an office hour', () => {
  const tasks = [
    { id: 'r1', source: 'request', urgent: false, created_at: T('10-12', '10:00'), done_at: T('10-13', '17:00') },
    { id: 'r2', source: 'request', urgent: false, created_at: T('10-14', '10:00'), done_at: T('10-19', '10:00') },
    { id: 'r3', source: 'request', urgent: true, created_at: T('10-15', '10:00'), done_at: T('10-15', '10:40') },
    { id: 'r4', source: 'request', urgent: false, created_at: T('10-19', '09:30'), done_at: null },
    { id: 'r5', source: 'request', urgent: false, created_at: '2026-09-20T10:00:00+03:00', done_at: '2026-09-21T10:00:00+03:00' },
    { id: 'x1', source: 'tell', urgent: false, created_at: T('10-12', '10:00'), done_at: null },
  ];
  const r = requestsReport(tasks, OCT, NOW);
  assert.deepEqual([r.total, r.handled, r.onTime, r.open, r.openLate, r.urgent, r.urgentOnTime], [4, 3, 2, 1, 0, 1, 1]);
  assert.equal(r.medianMin, 960); // 40, 960 and 1620 office minutes
  assert.equal(pct(r.rate), '67%');
  // An urgent one still open after an office hour is late.
  const late = requestsReport([{ source: 'request', urgent: true, created_at: T('10-20', '08:00'), done_at: null }], OCT, NOW);
  assert.equal(late.openLate, 0); // the office opened at 09:00: an hour has not passed
  assert.equal(requestsReport([{ source: 'request', urgent: true, created_at: T('10-19', '15:00'), done_at: null }], OCT, NOW).openLate, 1);
});

test('satisfaction: only with the surveys table; 1–5 scores and 0–10 recommendations apart', () => {
  assert.equal(satisfactionReport(null, OCT), null);
  const r = satisfactionReport([
    { score: 5, kind: 'shoot', answered_at: T('10-05', '10:00') },
    { score: 2, kind: 'delivery', created_at: T('10-10', '10:00') },
    { score: 9, kind: 'nps', answered_at: T('10-11', '10:00') },
    { score: 6, kind: 'recommend', answered_at: T('10-12', '10:00') },
    { score: 4, answered_at: '2026-09-20T10:00:00+03:00' },
    { score: null, kind: 'shoot', answered_at: T('10-12', '10:00') },
  ], OCT);
  assert.deepEqual([r.count, r.avg, r.low], [2, 3.5, 1]);
  assert.deepEqual(r.nps, { count: 2, score: 0 });
  assert.deepEqual(satisfactionReport([], OCT), { count: 0, avg: null, low: 0, nps: { count: 0, score: null } });
});

test('"not relevant": the month\'s final mark per client and item; more than half of at least 3 cases is suggested', () => {
  const cl = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const rows = [];
  const add = (c, key, action, at, note = null) => rows.push({ client_id: cl(c), item_key: key, action, note, by_email: 'x@a', at: T(at, '10:00') });
  // p10.c.ig: not relevant for 3 of 4 clients: suggested.
  add(1, 'p10.c.ig', 'na', '10-05'); add(2, 'p10.c.ig', 'na', '10-06'); add(3, 'p10.c.ig', 'na', '10-07'); add(4, 'p10.c.ig', 'done', '10-08');
  // p09.c.day: 1 of 3.
  add(1, 'p09.c.day', 'na', '10-05'); add(2, 'p09.c.day', 'done', '10-05'); add(3, 'p09.c.day', 'done', '10-05');
  // p06.metricool: 2 of 2: too few cases to suggest.
  add(1, 'p06.metricool', 'na', '10-05'); add(2, 'p06.metricool', 'na', '10-05');
  // A mark changed later in the month counts as its final state; a round's item is the same item.
  add(5, 'p14.team', 'na', '10-05'); add(5, 'p14.team', 'done', '10-09'); add(6, 'r2.p14.team', 'na', '10-09'); add(7, 'p14.team', 'done', '10-09');
  // Cleared at the end: not a case. Imported: not a case. Another month: not a case. A process mark: not an item.
  add(8, 'p10.c.ig', 'na', '10-05'); add(8, 'p10.c.ig', 'clear', '10-06');
  add(9, 'p10.c.ig', 'na', '10-05', 'ייבוא');
  add(10, 'p10.c.ig', 'done', '09-05'); rows.at(-1).at = '2026-09-05T10:00:00+03:00';
  add(11, 'p10.wait', 'na', '10-05');
  const r = naReport(rows, OCT);
  assert.deepEqual(r.map((x) => [x.key, x.na, x.cases, x.suggest]), [
    ['p10.c.ig', 3, 4, true], ['p06.metricool', 2, 2, false], ['p09.c.day', 1, 3, false], ['p14.team', 1, 3, false],
  ]);
  assert.equal(NA_MIN_CASES, 3);
  assert.match(r[0].label, /Instagram|IG|אינסטגרם/i);
  assert.match(r[0].proc, /^10 · /);
});

test('everything for a month: on time per person and role agrees with the closed processes; the pipeline per shoot day', () => {
  // Onboarding done for the three live clients, some late, some on time.
  const done = (c, ids, at) => {
    for (const p of applicableProcesses(c).filter((x) => ids.includes(x.id))) for (const i of p.items.filter((x) => !x.optional)) mark(c, i.key, at);
  };
  done(A, ['p01'], '2026-09-01T09:03:00+03:00');
  done(B, ['p01'], '2026-09-01T11:00:00+03:00');
  done(C, ['p08'], T('10-06', '10:00'));
  const all = [A, B, C, D];
  const r = computeInsights({ clients: all, checks, log, tasks: [], surveys: null, now: NOW, month: '2026-10' });
  assert.equal(r.month.key, '2026-10');
  assert.equal(r.months.length, 6);
  const states = new Map();
  const stateOf = (c) => states.get(c.id) || states.set(c.id, clientState(c, checks[c.id] || {}, NOW)).get(c.id);
  const rows = closedProcesses([A, B, C], { stateOf, checksByClient: checks, since: r.months[0].start, now: NOW, log });
  const oct = rows.filter((x) => x.completedAt >= OCT.start && x.completedAt < OCT.end);
  assert.equal(r.onTime.all.done, oct.length);
  assert.equal(r.onTime.all.onTime, oct.filter((x) => x.onTime).length);
  for (const p of r.onTime.people) {
    const mine = oct.filter((x) => x.people.includes(p.key));
    assert.deepEqual([p.done, p.onTime], [mine.length, mine.filter((x) => x.onTime).length], p.key);
    assert.equal(p.trend.length, 6);
  }
  for (const role of r.onTime.roles) {
    const mine = oct.filter((x) => x.people.some((k) => ROLES.find((y) => y.key === role.key).people.includes(k)));
    assert.equal(role.done, mine.length, role.key);
  }
  const sep = r.onTime.trend.find((m) => m.key === '2026-09');
  assert.ok(sep.done >= 2); // the two contracts (1): one on time, one late
  assert.deepEqual(INSIGHT_PEOPLE, ['irit', 'lior', 'ofir', 'ilai', 'nadia', 'yariv', 'anna', 'nirel', 'eli']);
  // The cancelled client is never counted.
  assert.ok(!JSON.stringify(r.qa).includes('anna'));
  assert.ok(!r.pipeline.some((x) => x.client.id === D.id));
  // The pipeline: Ron complete, 6 of 6; Galia's first round up to the client's approval; her second round shot.
  const ron = r.pipeline.find((x) => x.client.id === A.id);
  assert.deepEqual(ron.stages.map((s) => s.at && s.at.toISOString()), [
    '2026-10-01T09:00:00.000Z', '2026-10-04T15:00:00.000Z', '2026-10-07T09:00:00.000Z', '2026-10-08T12:00:00.000Z', '2026-10-12T09:00:00.000Z', '2026-10-12T12:00:00.000Z',
  ]);
  assert.equal(ron.done, 6);
  assert.equal(ron.next, null);
  assert.equal(ron.total, 6);
  assert.deepEqual(ron.stages.map((s) => s.days ?? null), [null, 1, 3, 1, 2, 0]);
  const galia = r.pipeline.find((x) => x.client.id === B.id && x.n === 1);
  assert.equal(galia.next.key, 'scheduled');
  assert.equal(galia.stages[1].at.toISOString(), '2026-10-11T07:00:00.000Z'); // shot: the day itself
  const round2 = r.pipeline.find((x) => x.client.id === B.id && x.n === 2);
  assert.equal(round2.editor, 'nadia');
  assert.equal(round2.next.key, 'edited');
  assert.equal(galia.stages[0].at, null); // the scripts were never marked: shown as missing
  // The same numbers as the parts.
  assert.deepEqual(r.delivery.first.map((x) => x.days), [4, 3]);
  assert.equal(r.qa.total, 4);
  assert.equal(r.satisfaction, null);
  assert.deepEqual(onTimeReport([], r.months).people.map((p) => p.rate), INSIGHT_PEOPLE.map(() => null));
});

test('who opens it: the owner and Lior; the payouts link only the owner', () => {
  const owner = { me: null, scope: 'office', error: null };
  const v = (me) => ({ me, scope: ['irit', 'lior', 'ofir'].includes(me) ? 'office' : 'own', error: null });
  assert.equal(canSeeInsights(owner), true);
  assert.equal(canSeeInsights(v('lior')), true);
  for (const p of ['irit', 'ofir', 'ilai', 'nadia', 'eli']) assert.equal(canSeeInsights(v(p)), false, p);
  assert.equal(canSeeInsights({ me: null, scope: 'own', error: new Error('x') }), false);
  assert.equal(canSeeInsights(null), false);
  assert.equal(canSeePayouts(owner), true);
  assert.equal(canSeePayouts(v('lior')), false);
});
