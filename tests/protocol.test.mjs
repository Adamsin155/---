// Protocol engine: coverage of the written protocol, conditions, due dates and progress.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROCESSES, PEOPLE, PHASES } from '../app/protocol.js';
import {
  addBusinessDays, applicableProcesses, clientState, openItemsFor, resolveTime, missingFields,
  blockers, bucketOf, businessDaysBetween, addWorkingMinutes, phasesFor, WAIT, upcomingFor, involves, itemsOf,
} from '../app/protocol-logic.js';
import { dayKeyIL as day, weekdayIL } from '../app/tz.js';

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
  const all = [{}, { characterizer: 'ofir' }, { characterizer: 'lior' }];
  for (const c of all) for (const p of applicableProcesses({ ...c, shoot_type: 'natali', has_logo: false, status: 'ending' })) {
    for (const o of p.owners) assert.ok(PEOPLE[o], `${p.id} owner ${o}`);
    for (const i of p.items) for (const o of i.owners) assert.ok(PEOPLE[o], `${i.key} owner ${o}`);
  }
  for (const p of PROCESSES) assert.ok(PHASES.some((ph) => ph.key === p.phase));
});

test('whatsapp group and characterization checklists match the document', () => {
  const p2 = PROCESSES.find((p) => p.id === 'p02');
  for (const who of ['ליאור', 'עירית', 'אופיר', 'עילאי', 'הלקוח']) assert.ok(p2.items.some((i) => i.label.startsWith(who)), who);
  const p4 = PROCESSES.find((p) => p.id === 'p04');
  assert.equal(p4.items.filter((i) => !['p04.saved', 'p04.followup', 'p04.tasks'].includes(i.key)).length, 11);
  // Lists in the document are separate items, not one combined check.
  const count = (id, prefix) => PROCESSES.find((p) => p.id === id).items.filter((i) => i.key.startsWith(prefix)).length;
  assert.equal(count('p07', 'p07.r.'), 7);
  assert.equal(count('p09', 'p09.c.'), 7);
  assert.equal(count('p12a', 'p12a.t.'), 10); // Lior's content call: ten topics
  assert.equal(count('p15', 'p15.d.'), 4);
});

test('sequence rules: send only after the review, calendar only with shoot details', () => {
  const p7sent = PROCESSES.find((p) => p.id === 'p07').items.find((i) => i.key === 'p07.sent');
  assert.equal(blockers(p7sent, {}, {}).items.length, 7);
  const allReviewed = Object.fromEntries(p7sent.requires.map((k) => [k, { state: 'done', at: '2026-10-01T10:00:00+03:00' }]));
  assert.equal(blockers(p7sent, {}, allReviewed), null);
  const naReview = { ...allReviewed, 'p07.r.logo': { state: 'na', at: '2026-10-01T10:00:00+03:00' } };
  assert.equal(blockers(p7sent, {}, naReview), null); // a review item that does not apply does not hold sending
  const p26sent = PROCESSES.find((p) => p.id === 'p26').items.find((i) => i.key === 'p26.sent');
  assert.deepEqual(blockers(p26sent, {}, {}).items, ['p25.approved']);
  const cal = PROCESSES.find((p) => p.id === 'p11').items.find((i) => i.key === 'p11.calendar');
  assert.deepEqual(blockers(cal, { shoot_type: 'dms' }, {}).fields, ['shoot_at']);
  // Blocked items are not offered in "my work".
  const c = { ...base, id: 'c', char_at: '2026-10-01T08:00:00+03:00' };
  const now = at('2026-10-01T12:00:00+03:00');
  const irit = openItemsFor('irit', c, {}, clientState(c, {}, now), now).map((x) => x.item.key);
  assert.ok(irit.includes('p07.r.logo') && !irit.includes('p07.sent'));
});

test('a shared process taken by one owner leaves the other owner\'s list', () => {
  // Process 22א (assigning the editor) belongs to Ofir or Lior.
  const c = { ...base, id: 'c', char_at: '2026-10-01T08:00:00+03:00', shoot_type: 'dms', shoot_at: '2026-10-05T10:00:00+03:00' };
  const done = { state: 'done', at: '2026-10-05T16:00:00+03:00' };
  const p19 = applicableProcesses(c).find((p) => p.id === 'p19');
  const checks = Object.fromEntries(p19.items.map((i) => [i.key, done]));
  const now = at('2026-10-05T17:00:00+03:00');
  const before = (p) => openItemsFor(p, c, checks, clientState(c, checks, now), now).map((x) => x.item.key);
  assert.ok(before('ofir').includes('p22a.load') && before('lior').includes('p22a.load'));
  checks['p22a.claim'] = { state: 'done', note: 'ofir', at: '2026-10-05T16:30:00+03:00' };
  const s = clientState(c, checks, now);
  assert.equal(s.states.find((x) => x.proc.id === 'p22a').claim.person, 'ofir');
  const keys = (p) => openItemsFor(p, c, checks, s, now).map((x) => x.item.key);
  assert.ok(keys('ofir').includes('p22a.load'));
  assert.ok(!keys('lior').includes('p22a.load'));
  assert.ok(keys('lior').includes('p22a.drive')); // his own item stays
});

test('my-work buckets and business-day lateness', () => {
  const now = at('2026-10-01T10:00:00+03:00'); // Thursday
  assert.equal(bucketOf('overdue', at('2026-09-30T10:00:00+03:00'), now), 'overdue');
  assert.equal(bucketOf('today', at('2026-10-01T18:00:00+03:00'), now), 'today');
  assert.equal(bucketOf('open', at('2026-10-02T11:00:00+03:00'), now), 'tomorrow');
  assert.equal(bucketOf('open', at('2026-10-05T11:00:00+03:00'), now), 'week');
  assert.equal(bucketOf('open', at('2026-10-20T11:00:00+03:00'), now), 'later');
  assert.equal(bucketOf('open', null, now), 'later');
  // Thursday to Sunday is one business day, not three calendar days.
  assert.equal(businessDaysBetween(at('2026-10-01T10:00:00+03:00'), at('2026-10-04T10:00:00+03:00')), 1);
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
  assert.deepEqual(p5({}).owners, ['irit']); // no characterizer set: Irit takes the access from the client
  assert.deepEqual(p5({ characterizer: 'lior' }).owners, ['lior']);
  const p6 = applicableProcesses({}).find((p) => p.id === 'p06');
  assert.deepEqual(p6.items.find((i) => i.key === 'p06.recovered').owners, ['lior']);
  assert.deepEqual(p6.items.find((i) => i.key === 'p06.newpages').owners, ['ilai']);
  assert.deepEqual(applicableProcesses({ characterizer: 'lior' }).find((p) => p.id === 'p04').owners, ['lior']);
  assert.deepEqual(applicableProcesses({}).find((p) => p.id === 'p04').owners, ['ofir']); // Ofir characterizes by default
  assert.ok(p5({ has_logo: false }).items.some((i) => i.key === 'p05.newlogo' && i.owners[0] === 'ilai'));
  assert.ok(!p5({ has_logo: true }).items.some((i) => i.key === 'p05.newlogo'));
});

test('business days skip Friday and Saturday', () => {
  // Thursday + 3 business days -> Tuesday.
  assert.equal(day(addBusinessDays(at('2026-10-01T12:00:00+03:00'), 3)), '2026-10-06');
  // Wednesday shoot + 5, counting from the next business day -> next Wednesday.
  assert.equal(day(addBusinessDays(at('2026-10-07T10:00:00+03:00'), 5)), '2026-10-14');
});

test('due dates follow the protocol anchors', () => {
  const c = { ...base, char_at: '2026-10-01T10:00:00+03:00', shoot_at: '2026-10-07T10:00:00+03:00', contract_end: '2027-10-01', shoot_type: 'natali' };
  const procs = applicableProcesses(c);
  const due = (id) => resolveTime(procs.find((p) => p.id === id).due, c, procs, {}, at('2026-10-01T09:00:00+03:00'));
  assert.equal(iso(due('p01')), iso(at('2026-10-01T09:10:00+03:00'))); // the contract: 10 office minutes
  assert.equal(iso(due('p02')), iso(at('2026-10-01T09:05:00+03:00')));
  assert.equal(iso(due('p04')), iso(at('2026-10-01T12:00:00+03:00')));
  assert.equal(iso(due('p07')), iso(at('2026-10-01T14:00:00+03:00'))); // 2h after the meeting's window
  assert.equal(day(due('p12')), '2026-10-05'); // end of business day 2 (decision 14)
  assert.equal(day(due('p13')), '2026-10-06'); // the Zoom on day 3
  assert.equal(iso(due('p15')), iso(at('2026-10-06T11:00:00+03:00')));
  assert.equal(iso(due('p16')), iso(at('2026-10-07T00:00:00+03:00')));
  // A Sunday shoot: the reminder goes out on Thursday, the previous business day.
  const sun = { ...c, shoot_at: '2026-10-11T10:00:00+03:00' };
  const sp = applicableProcesses(sun);
  assert.equal(iso(resolveTime(sp.find((p) => p.id === 'p15').due, sun, sp, {})), iso(at('2026-10-08T11:00:00+03:00')));
  assert.equal(due('p22'), null); // editing counts from the editor assignment, not the shoot
  // Assigned on Wednesday: videos with Ofir by Monday (3 business days), client closed by Tuesday (4).
  const assigned = { 'p22a.assigned': { state: 'done', at: '2026-10-07T15:00:00+03:00' } };
  const due2 = (id) => resolveTime(procs.find((p) => p.id === id).due, c, procs, assigned, at('2026-10-07T16:00:00+03:00'));
  assert.equal(day(due2('p22')), '2026-10-12');
  assert.equal(day(due2('p24')), '2026-10-12');
  assert.equal(day(due2('p27')), '2026-10-13');
  const p34 = procs.find((p) => p.id === 'p34');
  assert.equal(day(resolveTime(p34.start, c, procs, {})), '2027-08-02');
  // Missing anchors give no due date rather than a wrong one.
  const bare = { ...base };
  const bp = applicableProcesses(bare);
  assert.equal(resolveTime(bp.find((p) => p.id === 'p12').due, bare, bp, {}), null);
});

test('short deadlines run on office hours', () => {
  const c = { ...base, deal_at: '2026-10-08T18:30:00+03:00' }; // Thursday evening
  const procs = applicableProcesses(c);
  const due = resolveTime(procs.find((p) => p.id === 'p01').due, c, procs, {});
  assert.equal(iso(due), iso(at('2026-10-11T09:10:00+03:00'))); // Sunday 09:10 (the contract: 10 office minutes)
  // Not late on Sunday morning before the office opens.
  const s = clientState(c, {}, at('2026-10-11T08:30:00+03:00'));
  assert.notEqual(s.states.find((x) => x.proc.id === 'p01').status, 'overdue');
  // Two hours from 17:00 carry over to the next working morning.
  assert.equal(iso(addWorkingMinutes(at('2026-10-07T17:00:00+03:00'), 120)), iso(at('2026-10-08T10:00:00+03:00')));
  // A meeting on the real clock is not shifted.
  const m = { ...base, char_at: '2026-10-07T19:00:00+03:00' };
  const mp = applicableProcesses(m);
  assert.equal(iso(resolveTime(mp.find((p) => p.id === 'p04').due, m, mp, {})), iso(at('2026-10-07T21:00:00+03:00')));
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
  const p10 = Object.fromEntries(PROCESSES.find((p) => p.id === 'p10').items.filter((i) => !i.optional)
    .map((i) => [i.key, { state: i.key === 'p10.ready' ? 'na' : 'done', at: '2026-10-01T10:00:00+03:00' }]));
  const s = clientState(c, p10, at('2026-10-01T10:30:00+03:00'));
  assert.equal(s.states.find((x) => x.proc.id === 'p10').complete, true);
});

test('open items per person follow owners and readiness', () => {
  const c = { ...base, id: 'c1', characterizer: 'lior', char_at: '2026-10-01T10:00:00+03:00' };
  const now = at('2026-10-01T10:30:00+03:00');
  const s = clientState(c, {}, now);
  const irit = openItemsFor('irit', c, {}, s, now);
  assert.ok(irit.some((x) => x.item.key === 'p01.signed'));
  assert.ok(!irit.some((x) => x.item.key === 'p05.access')); // Lior characterizes, so he takes the access
  const lior = openItemsFor('lior', c, {}, s, now);
  assert.ok(lior.some((x) => x.item.key === 'p04.address'));
  assert.ok(lior.some((x) => x.item.key === 'p05.access'));
  assert.ok(!lior.some((x) => x.item.key === 'p17.place')); // shoot not scheduled yet
  assert.ok(!openItemsFor('ofir', c, {}, s, now).some((x) => x.item.key === 'p04.address'));
});

test('renewal talk is late once the 60-day mark passes', () => {
  const c = { ...base, contract_end: '2026-12-31' };
  const s = clientState(c, {}, at('2026-11-15T10:00:00+02:00'));
  assert.equal(s.states.find((x) => x.proc.id === 'p34').status, 'overdue');
});

test('a not-relevant weekly call is not a call', () => {
  const c = { ...base };
  const s = clientState(c, { 'p31.call': { state: 'na', at: '2026-10-01T10:00:00+03:00' } }, at('2026-10-02T10:00:00+03:00'));
  assert.equal(s.states.find((x) => x.proc.id === 'p31').status, 'due');
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

test('an extra shoot round repeats the shoot processes with their own keys and dates', () => {
  const c = { ...base, id: 'c', shoot_type: 'dms', char_at: '2026-10-01T10:00:00+03:00', shoot_at: '2026-10-07T10:00:00+03:00',
    rounds: [{ n: 2, start_at: '2027-03-01T09:00:00+02:00', shoot_at: '2027-03-10T10:00:00+02:00', shoot_type: 'natali' }] };
  const procs = applicableProcesses(c);
  const r2 = procs.filter((p) => p.phase === 'round-2');
  assert.ok(r2.some((p) => p.id === 'r2-p11b'), 'Natali round gets 11b even in a DMS client');
  assert.ok(!r2.some((p) => p.id === 'r2-p21'));
  assert.ok(!r2.some((p) => p.id === 'r2-p04' || p.id === 'r2-p23'));
  assert.ok(r2.every((p) => p.items.every((i) => i.key.startsWith('r2.'))));
  assert.deepEqual(r2.find((p) => p.id === 'r2-p26').items.find((i) => i.key === 'r2.p26.sent').requires, ['r2.p25.approved']);
  assert.deepEqual(phasesFor(c).map((p) => p.key).slice(-4), ['publish', 'round-2', 'ongoing', 'renewal']);
  const s = clientState(c, {}, at('2027-03-02T10:00:00+02:00'));
  const sa = clientState(c, { 'r2.p22a.assigned': { state: 'done', at: '2027-03-10T15:00:00+02:00' } }, at('2027-03-11T10:00:00+02:00'));
  const r2p22 = sa.states.find((x) => x.proc.id === 'r2-p22');
  assert.equal(day(r2p22.dueAt), '2027-03-15'); // 3 business days from the round's own assignment
  assert.equal(sa.states.find((x) => x.proc.id === 'p22').dueAt, null); // round 1 is not assigned yet
  const r2p12 = s.states.find((x) => x.proc.id === 'r2-p12');
  assert.equal(day(r2p12.dueAt), '2027-03-03'); // 2 business days from the round start (decision 14)
  // Round 1 progress is unaffected by round 2 checks and vice versa.
  const checks = { 'r2.p11.influencers': { state: 'done', at: '2027-03-01T10:00:00+02:00' } };
  const s2 = clientState(c, checks, at('2027-03-02T10:00:00+02:00'));
  assert.equal(s2.states.find((x) => x.proc.id === 'p11').resolved, 0);
  assert.equal(s2.states.find((x) => x.proc.id === 'r2-p11').resolved, 1);
});

test('waiting on the client is shown apart from our own delays', () => {
  const c = { ...base, id: 'c' };
  const p1 = applicableProcesses(c).find((p) => p.id === 'p01');
  const checks = { [WAIT(p1)]: { state: 'done', note: 'הלקוח לא חתם עדיין', at: '2026-10-01T09:10:00+03:00' } };
  const s = clientState(c, checks, at('2026-10-01T12:00:00+03:00'));
  const x = s.states.find((y) => y.proc.id === 'p01');
  assert.equal(x.status, 'client');
  assert.equal(x.late, true);
  assert.equal(s.overdue, 2); // processes 2 and 3 are late on us; process 1 is not
  assert.equal(s.waitingOnClient, 1);
  assert.equal(bucketOf('client', x.dueAt), 'client');
});

test('completion time is kept for the performance report', () => {
  const c = { ...base };
  const keys = PROCESSES.find((p) => p.id === 'p01').items.map((i) => i.key);
  const s = clientState(c, done(keys, '2026-10-01T09:04:00+03:00'), at('2026-10-01T12:00:00+03:00'));
  const x = s.states.find((y) => y.proc.id === 'p01');
  assert.equal(iso(x.completedAt), iso(at('2026-10-01T09:04:00+03:00')));
  assert.ok(x.completedAt <= x.dueAt);
});

test('package quantities in the database match the catalog', async () => {
  const { SPECS } = await import('../app/catalog.js');
  const sql = readFileSync(new URL('../supabase/migrations/20260929160000_client_protocol_batch2.sql', import.meta.url), 'utf8');
  const rows = Object.fromEntries([...sql.matchAll(/\('([a-z-]+)', (\d+), (\d+), (\d+), (\d+), (\d+), (\d+)\)/g)].map((m) => [m[1], m.slice(2).map(Number)]));
  assert.deepEqual(Object.keys(rows).sort(), Object.keys(SPECS).sort());
  for (const [id, s] of Object.entries(SPECS)) assert.deepEqual(rows[id], [s.videos, s.graphics, s.shootDays, s.collabs, s.stories, s.ch14], id);
});

test('calendar: Google link and a valid .ics with Hebrew text', async () => {
  const { googleCalendarUrl, icsText } = await import('../app/calendar.js');
  const ev = { uid: 'c1-shoot@astrateg', title: 'יום צילום: מספרת רון, דניס', start: '2026-10-07T10:00:00+03:00', minutes: 300, details: 'שורה 1\nשורה 2; עם, פסיקים', location: 'הבונים 5, רמת גן' };
  const url = new URL(googleCalendarUrl(ev));
  assert.equal(url.searchParams.get('dates'), '20261007T070000Z/20261007T120000Z');
  assert.equal(url.searchParams.get('text'), ev.title);
  const ics = icsText(ev);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261007T070000Z\r\n/);
  assert.match(ics, /DTEND:20261007T120000Z\r\n/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('DESCRIPTION:שורה 1\\nשורה 2\\; עם\\, פסיקים\r\n'));
  assert.ok(unfolded.includes('SUMMARY:יום צילום: מספרת רון\\, דניס\r\n'));
});

test('performance report: on-time rate and median time per process and person', async () => {
  const { performanceReport } = await import('../app/protocol-logic.js');
  const p1 = PROCESSES.find((p) => p.id === 'p01').items.map((i) => i.key);
  const a = { ...base, id: 'a', deal_at: '2026-10-01T09:00:00+03:00' };
  const b = { ...base, id: 'b', deal_at: '2026-10-01T10:00:00+03:00' };
  const checks = { a: done(p1, '2026-10-01T09:03:00+03:00'), b: done(p1, '2026-10-01T11:00:00+03:00') };
  const r = performanceReport([a, b], checks, { days: 30, now: at('2026-10-05T10:00:00+03:00') });
  const p = r.processes.find((x) => x.key === 'p01');
  assert.deepEqual([p.done, p.onTime, p.late], [2, 1, 1]);
  assert.equal(r.people.find((x) => x.key === 'irit').rate, 0.5);
});

test('holidays: Yom Kippur and Pesach are not business days', () => {
  // Characterization on Thursday 17.9.2026: Sun 20 (1), Yom Kippur Mon 21 skipped, Tue 22 (2), Wed 23 (3).
  assert.equal(day(addBusinessDays(at('2026-09-17T10:00:00+03:00'), 3)), '2026-09-23');
  // A deal on erev Pesach 2027 evening is due after the holiday.
  assert.equal(addWorkingMinutes(at('2027-04-21T19:00:00+03:00'), 5).toISOString(), at('2027-04-25T09:05:00+03:00').toISOString());
});

test('bulk marking never marks a confirmation by the client or others', async () => {
  const { bulkEligible } = await import('../app/protocol-logic.js');
  const c = { ...base, id: 'c', char_at: '2026-10-01T08:00:00+03:00' };
  const now = at('2026-10-01T12:00:00+03:00');
  const s = clientState(c, {}, now);
  const p7 = s.states.find((x) => x.proc.id === 'p07');
  const keys = bulkEligible(p7, 'irit', c, {}, now).map((i) => i.key);
  assert.ok(keys.includes('p07.r.logo'));
  assert.ok(!keys.includes('p07.approved') && !keys.includes('p07.sent'));
  const p13 = s.states.find((x) => x.proc.id === 'p13');
  assert.ok(!bulkEligible(p13, 'lior', c, {}, now).some((i) => i.key === 'p13.approved'));
});

test('process 6 starts when access arrives, not when all brand materials are in', () => {
  const c = { ...base };
  const checks = { 'p05.access': { state: 'done', at: '2026-10-20T11:00:00+03:00' } };
  const s = clientState(c, checks, at('2026-10-27T10:00:00+02:00'));
  const p6 = s.states.find((x) => x.proc.id === 'p06');
  assert.equal(p6.dueAt.toISOString(), at('2026-10-20T11:30:00+03:00').toISOString());
  assert.equal(p6.status, 'overdue');
});

test('a not-relevant review item unblocks sending; a not-relevant approval does not', () => {
  const allNa = Object.fromEntries(['spelling', 'phone', 'address', 'logo', 'details', 'wording', 'design'].map((k) => [`p07.r.${k}`, { state: 'na', at: '2026-10-01T10:00:00+03:00' }]));
  const sent = PROCESSES.find((p) => p.id === 'p07').items.find((i) => i.key === 'p07.sent');
  assert.equal(blockers(sent, {}, allNa), null);
  const p26 = PROCESSES.find((p) => p.id === 'p26').items.find((i) => i.key === 'p26.sent');
  assert.deepEqual(blockers(p26, {}, { 'p25.approved': { state: 'na', at: '2026-10-01T10:00:00+03:00' } }).items, ['p25.approved']);
});

test('package quantities include add-ons', async () => {
  const { packageDeliverables } = await import('../app/protocol-logic.js');
  const d = packageDeliverables({ package: { id: 'social-tv-simeon' }, selection: { paid: ['simeon-day', 'photographer'], free: { graphics: 5, simeonStories: 2, extraCh14: true } } });
  assert.deepEqual(d, { videos: 42, graphics: 47, shoot_days: 3, collabs: 3, stories: 5, ch14: 2, monthly: 96 });
  const n = packageDeliverables({ package: { id: 'social-natali' }, selection: { paid: ['natali-reel', 'natali-story'], free: {} } });
  assert.equal(n.collabs, 1);
  assert.equal(n.stories, 1);
});

test('renewal deadline never falls on a day off', () => {
  const c = { ...base, contract_end: '2027-09-29' };
  const procs = applicableProcesses(c);
  const d = resolveTime(procs.find((p) => p.id === 'p34').due, c, procs, {});
  assert.ok(weekdayIL(d) !== 5 && weekdayIL(d) !== 6, d.toISOString());
});

test('employee protocol details: who assigns the editor, Irit checks, Nirel brief', async () => {
  const { BRIEF_FIELDS, BRIEF_MUST } = await import('../app/protocol.js');
  const p22a = PROCESSES.find((p) => p.id === 'p22a');
  assert.deepEqual(p22a.owners, ['ofir', 'lior']); // Ofir or Lior assigns the editor
  assert.deepEqual(p22a.items.find((i) => i.key === 'p22a.irit').owners, ['irit']);
  const keys = PROCESSES.flatMap((p) => p.items.map((i) => i.key));
  for (const k of ['p02.team', 'p04.tasks', 'p17.plan']) assert.ok(keys.includes(k), k);
  assert.deepEqual(BRIEF_MUST, ['problem', 'change', 'keep', 'result']);
  assert.ok(BRIEF_FIELDS.some(([k]) => k === 'disliked'));
  for (const k of BRIEF_MUST) assert.ok(BRIEF_FIELDS.some(([f]) => f === k), k);
});

test('photographer: his own shoot-day processes, due around the shoot, in every round', () => {
  const c = { ...base, id: 'c', shoot_type: 'natali', shoot_at: '2026-10-05T10:00:00+03:00' };
  const mine = applicableProcesses(c).filter((p) => p.owners.includes('eli')).map((p) => p.id);
  assert.deepEqual(mine, ['p17b', 'p18b', 'p19b']);
  const p19b = PROCESSES.find((p) => p.id === 'p19b');
  assert.equal(p19b.items.find((i) => i.key === 'p19b.handed').noBulk, true); // handing the drive is confirmed one by one
  // Arrival is due when the influencers arrive; he starts an hour earlier.
  const now = at('2026-10-05T09:30:00+03:00');
  const s = clientState(c, {}, now).states.find((x) => x.proc.id === 'p17b');
  assert.equal(s.dueAt.toISOString(), new Date('2026-10-05T10:00:00+03:00').toISOString());
  assert.equal(s.startAt.toISOString(), new Date('2026-10-05T09:00:00+03:00').toISOString());
  assert.ok(openItemsFor('eli', c, {}, clientState(c, {}, now), now).some((x) => x.item.key === 'p17b.broll'));
  assert.ok(!openItemsFor('eli', c, {}, clientState(c, {}, now), now).some((x) => x.item.key.startsWith('p17.')));
  assert.equal(PEOPLE.eli.name, 'אלי');
  const r2 = { ...c, rounds: [{ n: 2, shoot_type: 'dms', shoot_at: '2026-11-05T10:00:00+02:00' }] };
  assert.deepEqual(applicableProcesses(r2).filter((p) => p.owners.includes('eli')).map((p) => p.id), ['p17b', 'p18b', 'p19b', 'r2-p17b', 'r2-p18b', 'r2-p19b']);
});

test('role views: coming shoot days, "my clients", items of a taken shared process', async () => {
  const { SCOPE, scopeOf } = await import('../app/protocol.js');
  assert.equal(scopeOf(null), 'office'); // the owner
  for (const p of ['irit', 'lior', 'ofir']) assert.equal(scopeOf(p), 'office', p);
  for (const p of ['ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli']) assert.equal(scopeOf(p), 'own', p);
  assert.equal(scopeOf('someone-new'), 'own'); // unknown people see only their own work
  assert.ok(Object.keys(SCOPE).every((k) => PEOPLE[k]));

  const c = { ...base, id: 'c', shoot_type: 'dms', characterizer: 'ofir', char_at: '2026-10-01T12:00:00+03:00', shoot_at: '2026-10-12T10:00:00+03:00' };
  const now = at('2026-10-05T12:00:00+03:00');
  const st = clientState(c, {}, now);
  // The photographer: nothing to check yet, but the shoot day is coming, with the three processes of that day.
  assert.deepEqual(openItemsFor('eli', c, {}, st, now), []);
  assert.deepEqual(upcomingFor('eli', c, st, now).map((s) => s.proc.id), ['p17b', 'p18b', 'p19b']);
  assert.deepEqual(upcomingFor('eli', c, st, now, 5), []); // beyond the window
  assert.equal(involves('eli', c, {}, st, now), true);
  // No shoot date: not his client yet.
  const noShoot = { ...c, shoot_at: null };
  assert.equal(involves('eli', noShoot, {}, clientState(noShoot, {}, now), now), false);
  // Editors: the client is theirs once assigned, not before.
  assert.equal(involves('nadia', c, {}, st, now), false);
  const edited = { ...c, editor: 'nadia' };
  assert.equal(involves('nadia', edited, {}, clientState(edited, {}, now), now), true);
  assert.equal(involves('yariv', edited, {}, clientState(edited, {}, now), now), false);
  const cancelled = { ...edited, status: 'cancelled' };
  assert.equal(involves('nadia', cancelled, {}, clientState(cancelled, {}, now), now), false);
  // Ilai works on a client whose processes of his have started, until his items there are done.
  assert.equal(involves('ilai', c, {}, st, now), true);
  const ilaiKeys = st.states.filter((s) => s.ready || s.startAt).flatMap((s) => itemsOf('ilai', s)).filter((i) => !i.optional).map((i) => i.key);
  const allDone = done(ilaiKeys, '2026-10-02T10:00:00+03:00');
  assert.equal(involves('ilai', c, allDone, clientState(c, allDone, now), now), false);
  // A shared process taken by Lior (22א, Ofir or Lior): its shared items are no longer Ofir's.
  const p22a = (checks) => clientState(c, checks, now).states.find((s) => s.proc.id === 'p22a');
  assert.deepEqual(itemsOf('ofir', p22a({})).map((i) => i.key), ['p22a.load', 'p22a.assigned']);
  const claimed = { 'p22a.claim': { state: 'done', note: 'lior', at: '2026-10-02T10:00:00+03:00' } };
  assert.deepEqual(itemsOf('ofir', p22a(claimed)), []);
  assert.deepEqual(itemsOf('lior', p22a(claimed)).map((i) => i.key), ['p22a.drive', 'p22a.load', 'p22a.assigned']);
  assert.deepEqual(itemsOf(null, p22a({})), []);
});
