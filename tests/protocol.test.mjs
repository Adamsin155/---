// Protocol engine: coverage of the written protocol, conditions, due dates and progress.
process.env.TZ = 'Asia/Jerusalem';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROCESSES, PEOPLE, PHASES } from '../app/protocol.js';
import {
  addBusinessDays, applicableProcesses, clientState, openItemsFor, resolveTime, missingFields,
} from '../app/protocol-logic.js';

const doc = readFileSync(new URL('../docs/protocols/general.md', import.meta.url), 'utf8');
const base = { deal_at: '2026-10-01T09:00:00+03:00', status: 'active' };
const at = (s) => new Date(s);
const iso = (d) => d.toISOString();
const done = (keys, when = '2026-10-01T10:00:00+03:00') => Object.fromEntries(keys.map((k) => [k, { state: 'done', at: when }]));
const keysOf = (procs) => procs.flatMap((p) => p.items.map((i) => i.key));

test('every numbered process in the written protocol exists, except the office-wide reviews', () => {
  const nums = [...doc.matchAll(/^### תהליך (\d+)( ב)?/gm)].map((m) => m[1] + (m[2] ? 'ב' : ''));
  assert.equal(nums.length, 36);
  const have = new Set(PROCESSES.map((p) => p.num));
  for (const n of nums) if (n !== '32' && n !== '33') assert.ok(have.has(n), `process ${n} missing`);
});

test('keys are unique and every owner is a known person', () => {
  const keys = PROCESSES.flatMap((p) => p.items.map((i) => i.key));
  assert.equal(new Set(keys).size, keys.length);
  const all = [{}, { characterizer: 'ofir' }, { characterizer: 'shirel' }];
  for (const c of all) for (const p of applicableProcesses({ ...c, shoot_type: 'natali', has_logo: false, status: 'ending' })) {
    for (const o of p.owners) assert.ok(PEOPLE[o], `${p.id} owner ${o}`);
    for (const i of p.items) for (const o of i.owners) assert.ok(PEOPLE[o], `${i.key} owner ${o}`);
  }
  for (const p of PROCESSES) assert.ok(PHASES.some((ph) => ph.key === p.phase));
});

test('whatsapp group and characterization checklists match the document', () => {
  const p2 = PROCESSES.find((p) => p.id === 'p02');
  for (const who of ['ליאור', 'עירית', 'אופיר', 'שיראל', 'עילאי', 'הלקוח']) assert.ok(p2.items.some((i) => i.label.startsWith(who)), who);
  const p4 = PROCESSES.find((p) => p.id === 'p04');
  assert.equal(p4.items.filter((i) => i.key !== 'p04.saved').length, 11);
});

test('shoot type decides which shoot-day processes apply', () => {
  const ids = (c) => applicableProcesses(c).map((p) => p.id);
  const n = ids({ ...base, shoot_type: 'natali' });
  assert.ok(n.includes('p11b') && n.includes('p20') && !n.includes('p21'));
  const d = ids({ ...base, shoot_type: 'dms' });
  assert.ok(d.includes('p21') && !d.includes('p11b') && !d.includes('p20'));
  const none = ids({ ...base });
  assert.ok(!none.includes('p20') && !none.includes('p21'));
  const natKeys = keysOf(applicableProcesses({ ...base, shoot_type: 'natali' }));
  assert.ok(natKeys.includes('p15.natali.makeup'));
  assert.ok(!keysOf(applicableProcesses({ ...base, shoot_type: 'dms' })).includes('p15.natali.makeup'));
  assert.deepEqual(missingFields(PROCESSES.find((p) => p.id === 'p11'), base), ['shoot_type', 'shoot_at']);
});

test('characterizer decides who takes the network access; no logo adds a logo task', () => {
  const p5 = (c) => applicableProcesses(c).find((p) => p.id === 'p05');
  assert.deepEqual(p5({ characterizer: 'ofir' }).owners, ['ofir']);
  assert.deepEqual(p5({ characterizer: 'shirel' }).owners, ['lior', 'irit']);
  assert.deepEqual(applicableProcesses({ characterizer: 'shirel' }).find((p) => p.id === 'p04').owners, ['shirel']);
  assert.ok(p5({ has_logo: false }).items.some((i) => i.key === 'p05.newlogo' && i.owners[0] === 'ilai'));
  assert.ok(!p5({ has_logo: true }).items.some((i) => i.key === 'p05.newlogo'));
});

test('business days skip Friday and Saturday', () => {
  // Thursday + 3 business days -> Tuesday.
  assert.equal(addBusinessDays(at('2026-10-01T12:00:00+03:00'), 3).toDateString(), at('2026-10-06T12:00:00+03:00').toDateString());
  // Wednesday shoot + 5, counting from the next business day -> next Wednesday.
  assert.equal(addBusinessDays(at('2026-10-07T10:00:00+03:00'), 5).toDateString(), at('2026-10-14T12:00:00+03:00').toDateString());
});

test('due dates follow the protocol anchors', () => {
  const c = { ...base, char_at: '2026-10-01T10:00:00+03:00', shoot_at: '2026-10-07T10:00:00+03:00', contract_end: '2027-10-01', shoot_type: 'natali' };
  const procs = applicableProcesses(c);
  const due = (id) => resolveTime(procs.find((p) => p.id === id).due, c, procs, {}, at('2026-10-01T09:00:00+03:00'));
  assert.equal(iso(due('p01')), iso(at('2026-10-01T09:05:00+03:00')));
  assert.equal(iso(due('p04')), iso(at('2026-10-01T12:00:00+03:00')));
  assert.equal(iso(due('p07')), iso(at('2026-10-01T14:00:00+03:00'))); // 2h after the meeting's window
  assert.equal(due('p12').toDateString(), at('2026-10-06T12:00:00+03:00').toDateString());
  assert.equal(iso(due('p15')), iso(at('2026-10-06T11:00:00+03:00')));
  assert.equal(iso(due('p16')), iso(at('2026-10-07T00:00:00+03:00')));
  // A Sunday shoot: the reminder goes out on Thursday, the previous business day.
  const sun = { ...c, shoot_at: '2026-10-11T10:00:00+03:00' };
  const sp = applicableProcesses(sun);
  assert.equal(iso(resolveTime(sp.find((p) => p.id === 'p15').due, sun, sp, {})), iso(at('2026-10-08T11:00:00+03:00')));
  assert.equal(due('p22').toDateString(), at('2026-10-14T12:00:00+03:00').toDateString());
  const p34 = procs.find((p) => p.id === 'p34');
  assert.equal(resolveTime(p34.start, c, procs, {}).toDateString(), at('2027-08-02T12:00:00+03:00').toDateString());
  // Missing anchors give no due date rather than a wrong one.
  const bare = { ...base };
  const bp = applicableProcesses(bare);
  assert.equal(resolveTime(bp.find((p) => p.id === 'p12').due, bare, bp, {}), null);
});

test('a finished characterization moves the parallel deadlines to its real end', () => {
  const c = { ...base, char_at: '2026-10-01T10:00:00+03:00' };
  const p4keys = PROCESSES.find((p) => p.id === 'p04').items.map((i) => i.key);
  const checks = done(p4keys, '2026-10-01T11:00:00+03:00');
  const s = clientState(c, checks, at('2026-10-01T11:30:00+03:00'));
  const p7 = s.states.find((x) => x.proc.id === 'p07');
  assert.equal(iso(p7.dueAt), iso(at('2026-10-01T13:00:00+03:00')));
  assert.equal(p7.ready, true);
});

test('status: overdue only for unfinished work past its due date', () => {
  const c = { ...base };
  const late = clientState(c, {}, at('2026-10-01T10:00:00+03:00'));
  assert.equal(late.states.find((x) => x.proc.id === 'p01').status, 'overdue');
  const p1 = PROCESSES.find((p) => p.id === 'p01').items.map((i) => i.key);
  const fin = clientState(c, done(p1, '2026-10-01T11:00:00+03:00'), at('2026-10-01T12:00:00+03:00'));
  assert.equal(fin.states.find((x) => x.proc.id === 'p01').status, 'done');
  // Shoot not scheduled: shoot-day processes wait instead of showing late.
  assert.equal(late.states.find((x) => x.proc.id === 'p17').status, 'waiting');
});

test('not relevant resolves a required item; optional items never block', () => {
  const c = { ...base };
  const p10 = { 'p10.checked': { state: 'done', at: '2026-10-01T10:00:00+03:00' }, 'p10.ready': { state: 'na', at: '2026-10-01T10:00:00+03:00' } };
  const s = clientState(c, p10, at('2026-10-01T10:30:00+03:00'));
  assert.equal(s.states.find((x) => x.proc.id === 'p10').complete, true);
});

test('open items per person follow owners and readiness', () => {
  const c = { ...base, id: 'c1', characterizer: 'shirel', char_at: '2026-10-01T10:00:00+03:00' };
  const now = at('2026-10-01T10:30:00+03:00');
  const s = clientState(c, {}, now);
  const irit = openItemsFor('irit', c, {}, s, now);
  assert.ok(irit.some((x) => x.item.key === 'p01.signed'));
  assert.ok(irit.some((x) => x.item.key === 'p05.access')); // Shirel characterizes, so Irit or Lior take access
  const shirel = openItemsFor('shirel', c, {}, s, now);
  assert.ok(shirel.some((x) => x.item.key === 'p04.address'));
  assert.ok(!shirel.some((x) => x.item.key === 'p17.place')); // shoot not scheduled yet
  assert.ok(!openItemsFor('ofir', c, {}, s, now).some((x) => x.item.key === 'p04.address'));
});

test('weekly call is due again seven days after the last one', () => {
  const c = { ...base };
  const checks = { 'p31.call': { state: 'done', at: '2026-10-01T10:00:00+03:00' } };
  // Force the process ready by having it touched.
  const s1 = clientState(c, checks, at('2026-10-05T10:00:00+03:00'));
  assert.equal(s1.states.find((x) => x.proc.id === 'p31').status, 'done');
  const s2 = clientState(c, checks, at('2026-10-09T10:00:00+03:00'));
  assert.equal(s2.states.find((x) => x.proc.id === 'p31').status, 'due');
});

test('renewal and ending processes', () => {
  const ids = (c) => applicableProcesses(c).map((p) => p.id);
  assert.ok(!ids({ ...base }).includes('p35'));
  assert.ok(ids({ ...base, status: 'ending' }).includes('p35'));
});
