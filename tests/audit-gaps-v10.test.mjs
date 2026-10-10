// Protocol version 10 (the owner's approval of 10.10.2026 after the audit of the written
// protocols against the system; docs/ops.md, section 58): twelve gaps, each with its place
// in the reminders. Fixed Israel times; npm test runs this under UTC, New York and Jerusalem.
//   1. Ofir's fast ladder waits while he is in a characterization meeting.
// (The other items are added below, each under its own number.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders } from '../app/reminder-engine.js';
import { PROCESSES, PROTOCOL_VERSION, FAST_LADDER } from '../app/protocol.js';
import { clientState, openItemsFor, IMPORT_NOTE } from '../app/protocol-logic.js';
import { fastCases, ladderAt, ladderWords, pausesOf, addFastMinutesOutside, fastMsOutside, MEETING_WORDS } from '../app/fast-ladder.js';
import { lateItems, heldLate } from '../app/late-chain.js';
import { daySummary } from '../app/day-summary.js';
import { ofirMeetings } from '../app/office-marks.js';
import { clocksFor, clockTime } from '../app/clocks.js';
import { importKeys } from '../app/client-open.js';
import { dateIL, partsIL } from '../app/tz.js';

export const IL = (y, m, d, h = 0, mi = 0, s = 0) => dateIL(y, m, d, h, mi, s);
export const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' }, { email: 'nadia@x', person: 'nadia' },
  { email: 'yariv@x', person: 'yariv' }, { email: 'anna@x', person: 'anna' }, { email: 'eli@x', person: 'eli' }, { email: 'nirel@x', person: 'nirel' },
];
let seq = 0;
const world = () => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, deals: [] });
function client(w, o = {}) {
  seq += 1;
  const c = {
    id: `c${seq}`, name: o.name || `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, protocol_version: PROTOCOL_VERSION,
    rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 9, 1, 10).toISOString(), created_by_email: 'irit@x', ...o,
  };
  w.clients.push(c);
  return c;
}
const mark = (w, c, key, at, note = null, state = 'done') => { (w.checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state, note, at: at.toISOString(), by_email: 'x@x' }; };
const marks = (w, c, keys, at, note = null) => keys.forEach((k) => mark(w, c, k, at, note));
const itemsOf = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key);
const importTo = (w, c, station, at = IL(2026, 9, 1, 9)) => marks(w, c, importKeys(station), at, IMPORT_NOTE);
const checksOf = (w) => (c) => w.checks[c.id] || {};
const stateOf = (w, c, now) => clientState(c, w.checks[c.id] || {}, now);
const proc = (w, c, id, now) => stateOf(w, c, now).states.find((s) => s.proc.id === id);
const mine = (w, c, person, now) => openItemsFor(person, c, w.checks[c.id] || {}, stateOf(w, c, now), now).map((e) => e.item.key);
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const meetingsOf = (w) => ofirMeetings(w.clients, checksOf(w));
const personOf = (e) => STAFF.find((s) => s.email === e)?.person ?? null;
const lateAt = (w, now) => lateItems({ clients: w.clients, checksOf: checksOf(w), stateOf: (c) => stateOf(w, c, now), tasks: w.tasks, personOf, now, meetings: meetingsOf(w) });
// The engine, minute by minute: each step once (the log); pass the same log to go on after a mark.
function walk(w, from, to, log = []) {
  const rows = [];
  for (let t = new Date(from); t <= to; t = new Date(t.getTime() + 6e4)) {
    for (const r of due(w, t, log)) { log.push({ key: r.key }); rows.push({ at: hhmm(t), rule: r.rule, step: r.step, person: r.person, level: r.level, title: r.title, body: r.body, url: r.url }); }
  }
  return rows;
}
const of = (rows, rule) => rows.filter((r) => r.rule === rule).map((r) => `${r.at} ${r.step}@${r.person}`);

// A client the day after its characterization (Monday 5.10.2026, ended 12:00): everything of
// the meeting day done but the 9 graphics, which Ilai hands over when the test says so.
function afterMeeting(w = world(), o = {}) {
  const c = client(w, { name: 'אלפא', char_at: IL(2026, 10, 5, 10).toISOString(), ...o });
  importTo(w, c, 'char');
  marks(w, c, itemsOf('p04'), IL(2026, 10, 5, 12));
  for (const id of ['p05', 'p05b', 'p06', 'p08', 'p08b', 'p09', 'p10', 'p12a', 'p12']) marks(w, c, itemsOf(id), IL(2026, 10, 5, 12, 30));
  return { w, c };
}

// Another client of Ofir's whose characterization meeting is at `at` (everything before it is history).
function meeting(w, at, o = {}) {
  const c = client(w, { name: 'גמא', char_at: at.toISOString(), ...o });
  importTo(w, c, 'char');
  return c;
}

// ── 1. Ofir's fast ladder waits while he is in a characterization meeting ─────
test('1. the pause is data, and the arithmetic: minutes are not counted inside a meeting, and a meeting is never longer than its two-hour window', () => {
  assert.deepEqual(FAST_LADDER.meeting, { pause: true, capHours: 2 });
  const m = [[+IL(2026, 10, 6, 10), +IL(2026, 10, 6, 13, 30)]]; // marked "ended" late: 3.5 hours
  const p = pausesOf(m);
  assert.deepEqual(p.map(([a, b]) => [hhmm(new Date(a)), hhmm(new Date(b))]), [['6.10 10:00', '6.10 12:00']]);
  // T0 before the meeting, with time to spare: untouched.
  assert.equal(hhmm(addFastMinutesOutside(p, IL(2026, 10, 6, 9, 40), 10)), '6.10 09:50');
  // T0 five minutes before it: five minutes run, five more after it.
  assert.equal(hhmm(addFastMinutesOutside(p, IL(2026, 10, 6, 9, 55), 10)), '6.10 12:05');
  // T0 inside it: the ten minutes start when it ends.
  assert.equal(hhmm(addFastMinutesOutside(p, IL(2026, 10, 6, 10, 30), 10)), '6.10 12:10');
  assert.equal(hhmm(addFastMinutesOutside(p, IL(2026, 10, 6, 10, 30), 15)), '6.10 12:15');
  // After it: untouched. No meetings: the plain window.
  assert.equal(hhmm(addFastMinutesOutside(p, IL(2026, 10, 6, 12, 1), 10)), '6.10 12:11');
  assert.equal(hhmm(addFastMinutesOutside([], IL(2026, 10, 6, 10, 30), 10)), '6.10 10:40');
  // Two meetings back to back, and the window's close (21:00) still holds.
  const two = pausesOf([[+IL(2026, 10, 6, 10), +IL(2026, 10, 6, 12)], [+IL(2026, 10, 6, 12), +IL(2026, 10, 6, 14)]]);
  assert.equal(hhmm(addFastMinutesOutside(two, IL(2026, 10, 6, 10, 30), 10)), '6.10 14:10');
  const evening = pausesOf([[+IL(2026, 10, 6, 19), +IL(2026, 10, 6, 21)]]);
  assert.equal(hhmm(addFastMinutesOutside(evening, IL(2026, 10, 6, 19, 30), 10)), '7.10 08:40');
  assert.equal(fastMsOutside(p, IL(2026, 10, 6, 9, 55), IL(2026, 10, 6, 12, 5)) / 6e4, 10);
});

test('1. graphics that arrive while Ofir is in a meeting: the ring goes out at T0, nothing is late until the meeting ended and ten minutes passed, and Lior is not told for the meeting\'s time', () => {
  const { w, c } = afterMeeting();
  // Tuesday 6.10: Ofir characterizes another client 10:00–12:00 (he presses "האפיון הסתיים" at 11:20).
  const other = meeting(w, IL(2026, 10, 6, 10));
  mark(w, c, 'p07.made', IL(2026, 10, 6, 10, 30));
  const log = [];
  const first = walk(w, IL(2026, 10, 6, 10, 30), IL(2026, 10, 6, 11, 19), log);
  // The first ring at T0, saying that the count waits. Nothing else for fifty minutes.
  assert.deepEqual(of(first, 'fast'), ['6.10 10:30 now@ofir']);
  assert.match(first.find((r) => r.rule === 'fast').body, /הספירה ממתינה לסוף פגישת האפיון: 10 דקות מרגע ״האפיון הסתיים״ \(לכל המאוחר עד 12:10\)/);
  assert.deepEqual(first.filter((r) => ['late', 'lateOwn', 'lateNag'].includes(r.rule) && /אלפא|דברים באיחור/.test(r.title + r.body)), [], 'no lateness note to anybody meanwhile');
  // On every screen: not late, and the words say why.
  const at = IL(2026, 10, 6, 11, 0);
  const [f] = fastCases({ clients: w.clients, checksOf: checksOf(w), stateOf: (x) => stateOf(w, x, at), meetings: meetingsOf(w) });
  assert.deepEqual([hhmm(f.startAt), hhmm(f.dueAt), hhmm(f.tellAt)], ['6.10 10:30', '6.10 12:10', '6.10 12:15']);
  assert.equal(ladderAt(f, at).phase, 'run');
  assert.equal(ladderWords(f, at), `${MEETING_WORDS} · אחריה 10 דק׳`);
  assert.equal(ladderWords(f, at, { waiting: true }), 'אצל אופיר לבדיקה · אופיר בפגישת אפיון');
  assert.deepEqual(lateAt(w, at).filter((x) => x.cid === c.id), [], 'not in the late list');
  assert.equal(heldLate(lateAt(w, at), 'ofir', at).length, 0);
  const sum = daySummary({ clients: w.clients, checksOf: checksOf(w), stateOf: (x) => stateOf(w, x, at), tasks: [], personOf, now: at });
  assert.equal(sum.items.filter((x) => x.kind === 'late').length, 0, 'not in the owners\' table');
  const [clk] = clocksFor('ofir', w.clients, w.checks, { now: at, meetings: meetingsOf(w) }).filter((x) => x.kind === 'fast');
  assert.deepEqual([clk.phase, clk.paused, !!clk.meeting, Math.round(clk.remaining / 6e4)], ['run', true, true, 10]);
  // He presses "האפיון הסתיים" at 11:20: ten minutes from that moment.
  mark(w, other, 'p04.ended', IL(2026, 10, 6, 11, 20));
  const rest = walk(w, IL(2026, 10, 6, 11, 20), IL(2026, 10, 6, 11, 50), log);
  assert.deepEqual(of(rest, 'fast'), ['6.10 11:30 late@ofir', '6.10 11:35 lior@lior', '6.10 11:45 again.1@ofir']);
  assert.match(rest.find((r) => r.rule === 'fast' && r.step === 'lior').body, /\(15 דקות\)/, 'the waiting he is told of is without the meeting');
  const now = IL(2026, 10, 6, 11, 32);
  assert.deepEqual(heldLate(lateAt(w, now), 'ofir', now).filter((x) => x.cid === c.id).map((x) => [x.procId, hhmm(x.dueAt)]), [['p07', '6.10 11:30']]);
});

test('1. he never presses "האפיון הסתיים": the count goes on two hours after the meeting\'s time; the assignment of an editor waits the same way; a shoot day does not stop it', () => {
  const { w, c } = afterMeeting();
  meeting(w, IL(2026, 10, 6, 10));
  mark(w, c, 'p07.made', IL(2026, 10, 6, 9, 55)); // five minutes before the meeting
  const rows = walk(w, IL(2026, 10, 6, 9, 55), IL(2026, 10, 6, 12, 12));
  assert.deepEqual(of(rows, 'fast'), ['6.10 09:55 now@ofir', '6.10 12:05 late@ofir', '6.10 12:10 lior@lior']);
  assert.match(rows.find((r) => r.rule === 'fast').body, /10 דקות לעבור עליהן ולאשר/, 'the work came before the meeting: the usual words');
  // The assignment (22א): the shoot day is closed while he is in a meeting.
  const w2 = world();
  const s = client(w2, { name: 'בטא', char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 15, 10).toISOString() });
  importTo(w2, s, 'post');
  for (const id of ['p22a', 'p22', 'p23', 'p23b', 'p24', 'p25', 'p26', 'p27']) for (const i of PROCESSES.find((p) => p.id === id).items) delete w2.checks[s.id][i.key];
  marks(w2, s, itemsOf('p19'), IL(2026, 10, 15, 16, 30));
  meeting(w2, IL(2026, 10, 15, 16), { name: 'דלתא' });
  const got = walk(w2, IL(2026, 10, 15, 16, 30), IL(2026, 10, 15, 18, 20));
  assert.deepEqual(of(got, 'fast'), ['15.10 16:30 now@ofir', '15.10 18:10 late@ofir', '15.10 18:15 lior@lior']);
  // A shoot day is not a meeting: a client Ofir does not characterize, or a shoot, stops nothing.
  const w3 = world();
  const { c: c3 } = afterMeeting(w3);
  client(w3, { name: 'של ליאור', characterizer: 'lior', char_at: IL(2026, 10, 6, 10).toISOString() });
  client(w3, { name: 'יום צילום', char_at: IL(2026, 9, 20, 10).toISOString(), shoot_at: IL(2026, 10, 6, 10).toISOString() });
  mark(w3, c3, 'p07.made', IL(2026, 10, 6, 10, 30));
  assert.deepEqual(of(walk(w3, IL(2026, 10, 6, 10, 30), IL(2026, 10, 6, 10, 46)), 'fast'), ['6.10 10:30 now@ofir', '6.10 10:40 late@ofir', '6.10 10:45 lior@lior']);
});

test('1. the clock of "עכשיו" during the meeting: paused, with what he will have after it', () => {
  const { w, c } = afterMeeting();
  meeting(w, IL(2026, 10, 6, 10));
  mark(w, c, 'p07.made', IL(2026, 10, 6, 9, 57));
  const ms = meetingsOf(w);
  const clockAt = (now) => { const [x] = clocksFor('ofir', w.clients, w.checks, { now, meetings: ms }).filter((k) => k.kind === 'fast'); return clockTime(x, now); };
  assert.deepEqual([clockAt(IL(2026, 10, 6, 9, 58)).paused, Math.round(clockAt(IL(2026, 10, 6, 9, 58)).remaining / 6e4)], [false, 9]);
  const mid = clockAt(IL(2026, 10, 6, 11));
  assert.deepEqual([mid.phase, mid.paused, Math.round(mid.remaining / 6e4), hhmm(mid.meeting.to)], ['run', true, 7, '6.10 12:00']);
  assert.deepEqual([clockAt(IL(2026, 10, 6, 12, 3)).paused, Math.round(clockAt(IL(2026, 10, 6, 12, 3)).remaining / 6e4)], [false, 4]);
  // Nobody else gets a clock for it (as before).
  assert.equal(clocksFor('lior', w.clients, w.checks, { now: IL(2026, 10, 6, 11), meetings: ms }).filter((k) => k.kind === 'fast').length, 0);
  assert.ok(mine(w, c, 'ofir', IL(2026, 10, 6, 11)).includes('p07.r.spelling'));
  assert.ok(proc(w, c, 'p07', IL(2026, 10, 6, 11)));
});

// ── 11. Ilai's 30-minute access check: his own ring at the deadline ───────────
test('11. the access check (6): when its 30 minutes pass Ilai is rung himself, at the deadline, and Lior gets nothing new', () => {
  const { w, c } = afterMeeting();
  for (const k of PROCESSES.find((p) => p.id === 'p06').items.map((i) => i.key)) delete w.checks[c.id][k];
  mark(w, c, 'p05.access', IL(2026, 10, 5, 12, 30)); // a real mark, not history
  const rows = walk(w, IL(2026, 10, 5, 12, 30), IL(2026, 10, 5, 13, 40));
  assert.deepEqual(of(rows, 'access'), ['5.10 12:30 now@ilai', '5.10 13:00 ilai30@ilai', '5.10 13:00 lior@lior']);
  const own = rows.find((r) => r.step === 'ilai30');
  assert.deepEqual([own.level, own.title], ['ring', 'באיחור: לבדוק את הגישות של אלפא']);
  assert.match(own.body, /עברו 30 דקות מקבלת הגישות.*ליאור קיבל הודעה/);
  // No second "באיחור" ring to Ilai from the ladder of a late item that day (6 keeps its own ladder),
  // and to Lior exactly what he got before: his ring, and the note of every late item.
  assert.deepEqual(rows.filter((r) => r.person === 'ilai' && r.rule === 'lateOwn'), []);
  assert.deepEqual(rows.filter((r) => r.person === 'lior' && /6 · בדיקת הגישות|גישות לא נבדקו/.test(r.title)).map((r) => `${r.at} ${r.rule}.${r.step}`), ['5.10 13:00 access.lior', '5.10 13:15 late.lior']);
  // He checked the logins in time (what the ring is about): nobody is rung at the deadline, as before.
  const w2 = world();
  const { c: c2 } = afterMeeting(w2);
  for (const k of ['p06.name', 'p06.bio']) delete w2.checks[c2.id][k];
  mark(w2, c2, 'p05.access', IL(2026, 10, 5, 12, 30));
  assert.deepEqual(of(walk(w2, IL(2026, 10, 5, 12, 31), IL(2026, 10, 5, 13, 5)), 'access'), []);
  // Done in time: nobody hears. A client in landing and imported access: nothing at all.
  const w3 = world();
  const { c: c3 } = afterMeeting(w3);
  mark(w3, c3, 'p05.access', IL(2026, 10, 5, 12, 30));
  assert.deepEqual(of(walk(w3, IL(2026, 10, 5, 12, 31), IL(2026, 10, 5, 13, 5)), 'access'), []);
  // (A client in landing is not loaded by the reminders function at all: supabase/functions/reminders/index.ts.)
  const w5 = world();
  const { c: c5 } = afterMeeting(w5);
  for (const k of PROCESSES.find((p) => p.id === 'p06').items.map((i) => i.key)) delete w5.checks[c5.id][k];
  mark(w5, c5, 'p05.access', IL(2026, 10, 5, 12, 30), IMPORT_NOTE);
  assert.deepEqual(of(walk(w5, IL(2026, 10, 5, 12, 30), IL(2026, 10, 5, 13, 5)), 'access'), []);
});

// ── (more items are added above this line) ──
