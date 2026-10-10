// Protocol version 10 (the owner's approval of 10.10.2026 after the audit of the written
// protocols against the system; docs/ops.md, section 58): twelve gaps, each with its place
// in the reminders. Fixed Israel times; npm test runs this under UTC, New York and Jerusalem.
//   1. Ofir's fast ladder waits while he is in a characterization meeting.
// (The other items are added below, each under its own number.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders } from '../app/reminder-engine.js';
import { RULES } from '../app/reminder-rules.js';
import {
  PROCESSES, PROTOCOL_VERSION, FAST_LADDER, STATIONS, CRITICAL_MISTAKES, CRITICAL_TITLE, mistakeIssue, RENEWAL_DAYS, FINAL_CHECK, BRIEF_MUST, BRIEF_REQUIRED,
} from '../app/protocol.js';
import { clientState, openItemsFor, IMPORT_NOTE, fixDue, FIX_CUTOFF_HOUR, bulkEligible } from '../app/protocol-logic.js';
import { PROTOCOL_HISTORY, itemSince } from '../app/protocol-versions.js';
import { fastCases, ladderAt, ladderWords, pausesOf, addFastMinutesOutside, fastMsOutside, MEETING_WORDS } from '../app/fast-ladder.js';
import { lateItems, heldLate, fixTaskOf, fixNote } from '../app/late-chain.js';
import { daySummary, waitingText } from '../app/day-summary.js';
import { ofirMeetings, QA_KINDS, describeOfficeMark } from '../app/office-marks.js';
import { clocksFor, clockTime } from '../app/clocks.js';
import { importKeys } from '../app/client-open.js';
import { FIX_APPROVALS, fixSpecOf, mayRecordFix, awaitsClient, validateFix, FIX_RULE_TEXT } from '../app/fix-request.js';
import { waitingApprovals, waitLine, waitDays, CLIENT_WAITS } from '../app/client-waits.js';
import { contractsEnded, renewedEnd, validRenewal, CONTRACT_END } from '../app/contract-end.js';
import { FILES_KEY, RAW_MAX, TAKE_MAX, FILES_ROWS_MAX, filesOf, withFile, filesNote, fileRows, filesHint, fileLine, readyKeys } from '../app/production.js';
import { guardOf, guardVerdict } from '../app/mark-guards.js';
import { uploadKinds } from '../app/files-logic.js';
import { validateTask, needsBrief, NAG_BRIEF, briefLines } from '../app/staff-tasks-logic.js';
import { mayWrite } from '../scripts/protocol-writers.mjs';
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
const waiting = (w, now) => waitingApprovals({ clients: w.clients, checksOf: checksOf(w), stateOf: (c) => stateOf(w, c, now), tasks: w.tasks, now });
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

// ── Scenarios shared by the items below ─────────────────────────────────────
const drop = (w, c, ids) => { for (const id of ids) for (const i of PROCESSES.find((p) => p.id === id).items) delete w.checks[c.id][i.key]; };
// A client in the middle of the editing stage: shot on Thursday 15.10.2026, the editor assigned on Sunday 18.10 10:00.
function editing(w = world(), o = {}) {
  const c = client(w, { name: 'בטא', editor: 'nadia', char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 15, 10).toISOString(), deliverables: { videos: 12, graphics: 36 }, ...o });
  importTo(w, c, 'publish');
  drop(w, c, ['p22', 'p24', 'p25', 'p26', 'p27']);
  mark(w, c, 'p22a.assigned', IL(2026, 10, 18, 10));
  return { w, c };
}
// The same client with the videos sent to the client on Wednesday 21.10 at 10:00.
function sentVideos(w = world(), o = {}) {
  const { c } = editing(w, o);
  for (const id of ['p22', 'p24', 'p25']) marks(w, c, PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key), IL(2026, 10, 20, 16));
  mark(w, c, 'p26.sent', IL(2026, 10, 21, 10));
  return { w, c };
}
// A client whose first 9 graphics were sent to the client (Tuesday 6.10 12:20).
function sentGraphics(w = world(), o = {}) {
  const { c } = afterMeeting(w, o);
  marks(w, c, itemsOf('p07').filter((k) => k !== 'p07.approved'), IL(2026, 10, 6, 12, 20));
  marks(w, c, itemsOf('p07a'), IL(2026, 10, 6, 12, 25));
  return { w, c };
}
// A fix task as the database opens it (private.client_fix_open), for either way in.
const fixTask = (c, o = {}) => ({
  id: `fix-${c.id}-${o.item_key || 'p07.approved'}`, client_id: c.id, title: 'תיקון לבקשת הלקוח: 9 הגרפיקות הראשונות · סבב 1', owner: 'ilai', due_on: '2026-10-07', urgent: false,
  source: 'client_fix', created_at: IL(2026, 10, 7, 9).toISOString(), created_by_email: 'irit@x', done_at: null,
  ...o, brief: { problem: 'להחליף את הטלפון בגרפיקה 4', from: 'office', item: 'graphics9', item_key: 'p07.approved', round: 1, extra: false, notes_marked: false, by: 'irit', ...(o.brief || {}) },
});

// ── 2. "הלקוח ביקש תיקון", written down by the office ────────────────────────
test('2. where the action stands: next to an approval that waits for the client\'s answer, for whoever follows the approvals', () => {
  assert.deepEqual(Object.keys(FIX_APPROVALS), ['p07.approved', 'p23.approved', 'p27.approved']);
  // Each of them is Irit's item in the protocol (the scripts' approval is Lior's own: not here).
  for (const key of Object.keys(FIX_APPROVALS)) {
    const p = PROCESSES.find((x) => x.items.some((i) => i.key === key));
    assert.deepEqual(p.items.find((i) => i.key === key).owners, ['irit'], key);
  }
  assert.equal(fixSpecOf('r2.p27.approved').what, 'הסרטונים');
  assert.equal(fixSpecOf('p13.approved'), null);
  for (const [viewer, ok] of [[{ me: 'irit', scope: 'office' }, true], [{ me: null, scope: 'office' }, true], [{ me: 'lior', scope: 'office' }, true], [{ me: 'ofir', scope: 'office' }, true],
    [{ me: 'ilai', scope: 'own' }, false], [{ me: 'nadia', scope: 'own' }, false], [{ me: 'irit', scope: 'office', error: true }, false]]) assert.equal(mayRecordFix(viewer), ok, JSON.stringify(viewer));
  const { w, c } = sentGraphics();
  const cs = () => w.checks[c.id];
  // Sent and not answered: offered. Not sent yet, approved, or a fix already under way: not.
  assert.equal(awaitsClient('p07.approved', cs(), [], c.id), true);
  assert.equal(awaitsClient('p23.approved', cs(), [], c.id), false, 'the rest of the graphics was not sent');
  assert.equal(awaitsClient('p07.approved', cs(), [fixTask(c)], c.id), false, 'a fix is under way');
  assert.equal(awaitsClient('p07.approved', cs(), [fixTask(c, { done_at: IL(2026, 10, 7, 12).toISOString() })], c.id), true, 'fixed: it waits for the client again');
  mark(w, c, 'p07.approved', IL(2026, 10, 7, 13));
  assert.equal(awaitsClient('p07.approved', cs(), [], c.id), false);
  // The videos: notes the office already wrote down (or a fix in work) are a fix under way.
  const { w: w2, c: v } = sentVideos();
  assert.equal(awaitsClient('p27.approved', w2.checks[v.id], [], v.id), true);
  mark(w2, v, 'p27.notes', IL(2026, 10, 21, 11));
  assert.equal(awaitsClient('p27.approved', w2.checks[v.id], [], v.id), false);
  mark(w2, v, 'p27.fixes', IL(2026, 10, 21, 15));
  assert.equal(awaitsClient('p27.approved', w2.checks[v.id], [], v.id), true);
  // The text is required.
  assert.deepEqual([validateFix('').ok, validateFix(' x ').ok, validateFix('להחליף טלפון').ok, validateFix('א'.repeat(4001)).ok], [false, false, true, false]);
  assert.equal(validateFix('  להחליף\r\nטלפון ').note, 'להחליף\nטלפון');
  assert.match(FIX_RULE_TEXT, /עד 13:00 מתוקנת באותו יום; אחרי 13:00, עד סוף יום העסקים הבא/);
});

test('2. a fix the office wrote down is the same task: the same person, the same rings, Irit\'s card says so, and the client\'s wait stops', () => {
  const { w, c } = sentGraphics();
  // Wednesday 7.10 09:00: Irit presses "הלקוח ביקש תיקון" (the database opens the task: tests/sql/audit-gaps.test.mjs).
  w.tasks.push(fixTask(c));
  const rows = due(w, IL(2026, 10, 7, 9, 1)).filter((r) => r.rule === 'clientFix');
  // Ilai rings, as for a request written on the status page. Irit wrote it down herself: she is not told.
  assert.deepEqual(rows.map((r) => `${r.step}@${r.person}:${r.level}`), ['now@ilai:ring']);
  assert.equal(rows[0].title, 'הלקוח ביקש תיקון: אלפא');
  assert.match(rows[0].body, /^תיקון לבקשת הלקוח: 9 הגרפיקות הראשונות · סבב 1\. הערות: להחליף את הטלפון בגרפיקה 4 עד ד׳ 7\.10\.$/);
  // Written down by somebody else of the office (Lior): Irit, who follows the approval, hears who wrote it.
  const byLior = world();
  const { c: c2 } = sentGraphics(byLior);
  byLior.tasks.push(fixTask(c2, { brief: { by: 'lior' } }));
  const irit = due(byLior, IL(2026, 10, 7, 9, 1)).find((r) => r.rule === 'clientFix' && r.person === 'irit');
  assert.match(irit.body, /^הלקוח ביקש \(נרשם בידי ליאור\): ״להחליף את הטלפון בגרפיקה 4״\. לברר שההערות ברורות ולתעד\. עילאי מתקן\/ת עד ד׳ 7\.10\.$/);
  // Her card: "הלקוח ביקש תיקונים: לברר ולתעד", with what was asked and who fixes.
  assert.equal(fixTaskOf(w.tasks, c.id, 'p07.approved').id, w.tasks[0].id);
  assert.equal(fixNote(w.tasks[0], (p) => ({ ilai: 'עילאי' })[p]), 'הלקוח ביקש: ״להחליף את הטלפון בגרפיקה 4״. עילאי מתקן/ת. מסמנים כאן רק כשהלקוח מאשר אחרי התיקון.');
  assert.ok(mine(w, c, 'irit', IL(2026, 10, 7, 9, 5)).includes('p07.approved'), 'the item stays hers to tick when the client approves');
  // A request is an answer: no "the client did not answer" and no daily "עוד לא אישר" for it.
  assert.deepEqual(due(w, IL(2026, 10, 7, 10)).filter((r) => ['answer', 'clientWaits', 'clientWaitsLine'].includes(r.rule) && r.clientId === c.id), []);
  assert.deepEqual(waiting(w, IL(2026, 10, 7, 10)), []);
  // The fix is late (its due day passed): the ladder of every late item, on the task. Ilai rings; Irit, who waits, is told.
  const late = due(w, IL(2026, 10, 8, 9, 15), rows.map((r) => ({ key: r.key }))).filter((r) => r.rule === 'lateOwn');
  assert.deepEqual(late.map((r) => `${r.step}@${r.person}:${r.level}`).sort(), ['own@ilai:ring', 'wait@irit:quiet']);
});

test('2. the videos: the fix is due from the moment the request was recorded, the same day by 13:00 and the next business day after it, on both ways in', () => {
  assert.equal(FIX_CUTOFF_HOUR, 13);
  assert.deepEqual([hhmm(fixDue(IL(2026, 10, 21, 12, 59))), hhmm(fixDue(IL(2026, 10, 21, 13, 0))), hhmm(fixDue(IL(2026, 10, 22, 16))), hhmm(fixDue(IL(2026, 10, 23, 10)))],
    ['21.10 18:00', '22.10 18:00', '25.10 18:00', '25.10 18:00']);
  const p27 = PROCESSES.find((p) => p.id === 'p27');
  assert.deepEqual(p27.due, { from: 'item:p22a.assigned', businessDays: 4, afterMark: [{ key: 'p27.notes', fix: true }] });
  // Until notes are recorded: day 4 from the assignment (Thursday 22.10 18:00), as before.
  const { w, c } = sentVideos();
  const dueAt = (now) => hhmm(proc(w, c, 'p27', now).dueAt);
  assert.equal(dueAt(IL(2026, 10, 21, 11)), '22.10 18:00');
  // The request is recorded at 11:30 (the status page and the office's button both write p27.notes at that moment): today 18:00.
  mark(w, c, 'p27.notes', IL(2026, 10, 21, 11, 30), JSON.stringify({ text: 'סרטון 3: להחליף מוזיקה', via: 'office' }));
  assert.equal(dueAt(IL(2026, 10, 21, 12)), '21.10 18:00');
  // …and the editor is rung by the protocol's own ladder, exactly as for notes from the status page.
  w.tasks.push(fixTask(c, { owner: 'nadia', due_on: '2026-10-21', created_at: IL(2026, 10, 21, 11, 30).toISOString(), title: 'תיקון לבקשת הלקוח: הסרטונים · סבב 1', brief: { item: 'videos', item_key: 'p27.approved', notes_marked: true, problem: 'סרטון 3: להחליף מוזיקה' } }));
  const now = due(w, IL(2026, 10, 21, 11, 31));
  assert.deepEqual(now.filter((r) => r.rule === 'clientFixes').map((r) => `${r.person}:${r.level}`), ['nadia:ring']);
  assert.deepEqual(now.filter((r) => r.rule === 'clientFix').map((r) => r.step), [], 'the first notes ring the editor once, through the ladder of 27');
  // Recorded late in the day (15:00): the end of the next business day.
  mark(w, c, 'p27.notes', IL(2026, 10, 21, 15), JSON.stringify({ text: 'x', via: 'status' }));
  assert.equal(dueAt(IL(2026, 10, 21, 16)), '22.10 18:00');
  // Notes that came after day 4 (the client was slow): the deadline is still the fix's own, not a day that passed.
  mark(w, c, 'p27.notes', IL(2026, 10, 26, 10));
  assert.deepEqual([dueAt(IL(2026, 10, 26, 11)), proc(w, c, 'p27', IL(2026, 10, 26, 11)).status], ['26.10 18:00', 'today']);
  // A client that started before version 10 keeps the later of the two; imported notes set no deadline.
  const old = world();
  const { c: o } = sentVideos(old, { protocol_version: 9 });
  mark(old, o, 'p27.notes', IL(2026, 10, 21, 11, 30));
  assert.equal(hhmm(proc(old, o, 'p27', IL(2026, 10, 21, 12)).dueAt), '22.10 18:00');
  mark(old, o, 'p27.notes', IL(2026, 10, 26, 10));
  assert.equal(hhmm(proc(old, o, 'p27', IL(2026, 10, 26, 11)).dueAt), '26.10 18:00');
  const imp = world();
  const { c: i } = sentVideos(imp);
  mark(imp, i, 'p27.notes', IL(2026, 10, 21, 11, 30), IMPORT_NOTE);
  assert.equal(hhmm(proc(imp, i, 'p27', IL(2026, 10, 21, 12)).dueAt), '22.10 18:00');
});

// ── 3. A client who does not answer ─────────────────────────────────────────
test('3. an approval that waits on the client: from the next day, a line in Irit\'s morning digest and one ring at 10:00, every working day until the client answers', () => {
  assert.deepEqual(CLIENT_WAITS, { who: 'irit', lineAt: '08:30', ringAt: '10:00', listMax: 6 });
  const { w, c } = sentGraphics(); // sent Tuesday 6.10 12:20
  const log = [];
  const day = (d, from = [8, 0], to = [18, 0]) => walk(w, IL(2026, 10, d, ...from), IL(2026, 10, d, ...to), log).filter((r) => ['answer', 'clientWaits', 'clientWaitsLine'].includes(r.rule));
  const brief = (rows) => rows.map((r) => `${r.at} ${r.rule}@${r.person}:${r.level}`);
  // The day of the sending: only the one ring of the ten minutes ("להתקשר").
  assert.deepEqual(brief(day(6, [12, 20])), ['6.10 12:30 answer@irit:ring']);
  // Wednesday and Thursday: a digest line at 08:30 and one ring at 10:00, each day once.
  const wed = day(7);
  assert.deepEqual(brief(wed), ['7.10 08:30 clientWaitsLine@irit:digest', '7.10 10:00 clientWaits@irit:ring']);
  assert.deepEqual(wed.map((r) => r.title), ['הלקוח עוד לא אישר: 9 הגרפיקות הראשונות · אלפא · מחכה יום', 'הלקוח עוד לא אישר: 9 הגרפיקות הראשונות · אלפא · מחכה יום']);
  assert.equal(wed[1].body, 'נשלח אתמול 12:20. להתקשר ללקוח. תזכורת בכל בוקר עד שהוא מאשר או מבקש תיקון.');
  assert.equal(wed[1].url, `client.html?id=${c.id}#p07`);
  assert.deepEqual(brief(day(8)), ['8.10 08:30 clientWaitsLine@irit:digest', '8.10 10:00 clientWaits@irit:ring']);
  // Friday and Saturday: nothing. Sunday: again, and the wait is counted in calendar days.
  assert.deepEqual([...day(9), ...day(10)], []);
  const sun = day(11);
  assert.deepEqual(sun.map((r) => r.title), Array(2).fill('הלקוח עוד לא אישר: 9 הגרפיקות הראשונות · אלפא · מחכה 5 ימים'));
  // It is nobody's lateness: no "באיחור" to anybody about it, and nothing to Ofir, Lior or the owners.
  const others = walk(w, IL(2026, 10, 12, 8), IL(2026, 10, 12, 18), log).filter((r) => /9 גרפיקות ראשונות|7 · הכנת/.test(r.title + r.body) && ['late', 'lateOwn', 'lateNag'].includes(r.rule));
  assert.deepEqual(others, []);
  // "הלקוח ענה" or "התקשרתי" stop the one ring of the minutes, not this: the approval is still missing.
  mark(w, c, 'p07.call', IL(2026, 10, 12, 10, 30));
  assert.equal(day(13).length, 2);
  // The client approves (Tuesday 13.10 12:00): it stops.
  mark(w, c, 'p07.approved', IL(2026, 10, 13, 12));
  assert.deepEqual(day(14), []);
});

test('3. several clients are one ring; a fix request, "ממתין ללקוח", landing and imported history are not a wait; the owners\' table says how many wait and the longest', () => {
  const w = world();
  const { c: a } = sentGraphics(w, { name: 'אלפא' });       // graphics, sent Tuesday 6.10
  const { c: b } = sentVideos(w, { name: 'בטא' });          // videos, sent Wednesday 21.10
  const { c: g } = sentGraphics(w, { name: 'גמא' });
  w.tasks.push(fixTask(g, { created_at: IL(2026, 10, 7, 9).toISOString() })); // the client asked for a fix: an answer
  const { c: d } = sentGraphics(w, { name: 'דלתא' });
  mark(w, d, 'p07.wait', IL(2026, 10, 7, 9), JSON.stringify({ reason: 'בחו״ל עד יום ראשון', recheck: '2026-10-25' })); // parked by Irit
  sentGraphics(w, { name: 'קליטה', landing: true });
  const { c: imp } = afterMeeting(w, { name: 'ייבוא' });
  marks(w, imp, itemsOf('p07').filter((k) => k !== 'p07.approved'), IL(2026, 10, 6, 12, 20), IMPORT_NOTE);
  const now = IL(2026, 10, 22, 10);
  assert.deepEqual(waiting(w, now).map((x) => [x.name, x.what, x.days, x.approval]), [['אלפא', '9 הגרפיקות הראשונות', 16, 'p07.approved'], ['בטא', 'הסרטונים', 1, 'p27.approved']]);
  assert.deepEqual([waitLine(waiting(w, now)[0]), waitDays(1), waitDays(2), waitDays(7)], ['הלקוח עוד לא אישר: 9 הגרפיקות הראשונות · אלפא · מחכה 16 ימים', 'יום', 'יומיים', '7 ימים']);
  const rows = due(w, now).filter((r) => r.rule === 'clientWaits' || r.rule === 'clientWaitsLine');
  assert.deepEqual(rows.map((r) => `${r.rule}:${r.level}:${r.title}`).sort(), [
    'clientWaits:ring:2 לקוחות עוד לא אישרו',
    'clientWaitsLine:digest:הלקוח עוד לא אישר: 9 הגרפיקות הראשונות · אלפא · מחכה 16 ימים',
    'clientWaitsLine:digest:הלקוח עוד לא אישר: הסרטונים · בטא · מחכה יום',
  ]);
  const ring = rows.find((r) => r.rule === 'clientWaits');
  assert.deepEqual([ring.person, ring.url, ring.noFold], ['irit', 'clients.html#mine', true]);
  assert.equal(ring.body, 'אלפא · 9 הגרפיקות הראשונות · מחכה 16 ימים\nבטא · הסרטונים · מחכה יום\nלהתקשר ללקוחות. תזכורת בכל בוקר עד שהם מאשרים או מבקשים תיקון.');
  assert.ok(!/₪|מחיר/.test(JSON.stringify(rows)));
  // The owners' table at 19:00: counted for nobody, with how many wait and the longest wait.
  const sum = daySummary({ clients: w.clients, checksOf: checksOf(w), stateOf: (x) => stateOf(w, x, now), tasks: w.tasks, personOf, now });
  assert.deepEqual(sum.waiting.filter((x) => ['אלפא', 'בטא'].includes(x.name)).map((x) => [x.name, x.days]), [['אלפא', 16]]);
  assert.deepEqual(sum.waitingLongest, { days: 16, name: 'אלפא', words: '16 ימים' });
  assert.match(waitingText(sum), /מחכים לתשובת הלקוח, ולכן לא נספר לאף עובד: אלפא \(7 · הכנת 9 גרפיקות ראשונות\).*\. ההמתנה הארוכה: 16 ימים \(אלפא\)\.$/);
  assert.equal(sum.rows.some((r) => r.person === 'irit' && r.late && /אלפא/.test(JSON.stringify(sum.items.filter((x) => x.who.includes('irit'))))), false);
  assert.equal(waitingText({ waiting: [], waitingLongest: null }), '');
});

// ── 4. The five critical mistakes of editing ────────────────────────────────
test('4. the five critical mistakes are five ticks of the editor\'s self-check and five of Ofir\'s quality control, in the written protocol\'s order', () => {
  assert.deepEqual(CRITICAL_MISTAKES.map(([k, name]) => [k, name]), [['sound', 'סאונד'], ['exposure', 'חשיפה'], ['stable', 'ייצוב'], ['angles', 'זוויות'], ['export', 'הגדרות ייצוא']]);
  const p22 = PROCESSES.find((p) => p.id === 'p22');
  const p25 = PROCESSES.find((p) => p.id === 'p25');
  const five = (p, pre) => p.items.filter((i) => CRITICAL_MISTAKES.some(([k]) => i.key === `${pre}${k}`));
  assert.deepEqual(five(p22, 'p22.self.').map((i) => i.label), [
    'בדיקה עצמית: אין בעיות סאונד, והמוזיקה לא עוברת את המינוס 20 dB',
    'בדיקה עצמית: התוכן מאוזן: לא שרוף, לא מואר מדי ולא חשוך מדי',
    'בדיקה עצמית: אין רעידות מצלמה (Warp Stabilizer, לרוב בבי־רולים)',
    'בדיקה עצמית: נעשה שימוש בכל זוויות המצלמה שצולמו, לא רק בזווית אחת',
    'בדיקה עצמית: הסרטונים יצאו רק בהגדרות שהוגדרו מראש, בלי בעיית פיקסלים',
  ]);
  assert.deepEqual(five(p25, 'p25.q.').map((i) => [i.label.startsWith('נבדק: '), i.mistake, i.passedIf]), CRITICAL_MISTAKES.map(([k]) => [true, k, 'p25.approved']));
  assert.ok(five(p22, 'p22.self.').every((i) => i.passedIf === 'p24.notify' && !i.optional));
  // Ofir approves only with all eleven; "מוכן לבדיקה" of the editor marks all of his.
  assert.equal(p25.items.find((i) => i.key === 'p25.approved').requires.length, 11);
  assert.equal(QA_KINDS.videos.checks.length, 11);
  assert.deepEqual(readyKeys(false).filter((k) => /sound|exposure|stable|angles|export/.test(k)), CRITICAL_MISTAKES.map(([k]) => `p22.self.${k}`));
  // One that fails goes back to the editor named.
  assert.equal(mistakeIssue('sound'), 'טעות קריטית · סאונד: בעיית סאונד, או מוזיקה שעוברת את המינוס 20 dB');
  assert.equal(mistakeIssue('export'), 'טעות קריטית · הגדרות ייצוא: הסרטון לא יצא בהגדרות שהוגדרו מראש (בעיית פיקסלים)');
  assert.equal(mistakeIssue('nope'), '');
  assert.match(CRITICAL_TITLE, /חמש הטעויות הקריטיות/);
  assert.equal(itemSince('p22.self.sound'), 10);
  assert.equal(itemSince('p25.q.export'), 10);
});

test('4. existing clients: mid-editing the five are work that is never late; an editing already handed over, and videos already approved, are never asked', () => {
  const FIVE22 = CRITICAL_MISTAKES.map(([k]) => `p22.self.${k}`);
  const FIVE25 = CRITICAL_MISTAKES.map(([k]) => `p25.q.${k}`);
  const old22 = PROCESSES.find((p) => p.id === 'p22').items.map((i) => i.key).filter((k) => !FIVE22.includes(k));
  // A version 9 client whose editor is in the middle of the editing: the five are his, shown as new, and do not make 22 late.
  const { w, c } = editing(world(), { protocol_version: 9 });
  marks(w, c, old22, IL(2026, 10, 20, 12));
  const late = IL(2026, 10, 25, 10); // past day 3
  const s22 = proc(w, c, 'p22', late);
  assert.deepEqual([s22.complete, s22.status], [false, 'open']);
  assert.deepEqual(mine(w, c, 'nadia', late).filter((k) => k.startsWith('p22.')), FIVE22);
  assert.ok(s22.proc.items.filter((i) => FIVE22.includes(i.key)).every((i) => i.fresh === 10));
  // A client of version 10 in the same place: required like the rest, and late with them.
  const { w: wn, c: cn } = editing();
  marks(wn, cn, old22, IL(2026, 10, 20, 12));
  assert.equal(proc(wn, cn, 'p22', late).status, 'overdue');
  // The editor already handed the videos to Ofir ("מוכן לבדיקה") before the five existed: history, 22 is complete.
  const { w: w2, c: c2 } = editing(world(), { protocol_version: 9 });
  marks(w2, c2, old22, IL(2026, 10, 20, 12));
  marks(w2, c2, ['p24.folder', 'p24.drive', 'p24.notify'], IL(2026, 10, 20, 15));
  const done22 = proc(w2, c2, 'p22', late);
  assert.equal(done22.complete, true);
  assert.ok(done22.proc.items.filter((i) => FIVE22.includes(i.key)).every((i) => i.optional && i.history));
  assert.deepEqual(mine(w2, c2, 'nadia', late).filter((k) => FIVE22.includes(k)), []);
  // …and Ofir's quality control on them is asked for his five too (the videos are with him now): work, never late.
  const s25 = proc(w2, c2, 'p25', late);
  assert.ok(FIVE25.every((k) => mine(w2, c2, 'ofir', late).includes(k)));
  assert.ok(s25.proc.items.filter((i) => FIVE25.includes(i.key)).every((i) => i.fresh === 10));
  // Ofir approved before the five existed: history. 25 is complete and what hangs on it goes on (the sending to the client).
  const { w: w3, c: c3 } = sentVideos(world(), { protocol_version: 9 });
  for (const k of [...FIVE22, ...FIVE25]) delete w3.checks[c3.id][k];
  const st = stateOf(w3, c3, late);
  assert.deepEqual(['p22', 'p25', 'p26'].map((id) => st.states.find((s) => s.proc.id === id).complete), [true, true, true]);
  assert.deepEqual(mine(w3, c3, 'ofir', late).filter((k) => FIVE25.includes(k)), []);
  assert.ok(mine(w3, c3, 'irit', late).includes('p27.approved'), 'nothing is blocked further along');
  // Imported history: not asked (the import of version 10 marks them with the station; an older import has `passedIf`).
  const imp = world();
  const ci = client(imp, { name: 'ייבוא', protocol_version: 7, editor: 'nadia', shoot_at: IL(2026, 9, 1, 10).toISOString() });
  importTo(imp, ci, 'ongoing');
  for (const k of [...FIVE22, ...FIVE25]) delete imp.checks[ci.id][k];
  assert.deepEqual(['nadia', 'ofir'].flatMap((p) => mine(imp, ci, p, late)).filter((k) => [...FIVE22, ...FIVE25].includes(k)), []);
});

// ── 5. The renewal's deadline, and a contract that ended ─────────────────────
test('5. the renewal (34) is due 14 days after it opens; a client that started before keeps the later (the new one)', () => {
  assert.equal(RENEWAL_DAYS, 14);
  const p34 = PROCESSES.find((p) => p.id === 'p34');
  assert.deepEqual([p34.start, p34.due], [{ from: 'contractEnd', days: -60 }, { from: 'contractEnd', days: -46, at: '18:00' }]);
  const w = world();
  const c = client(w, { name: 'חידוש', contract_end: '2027-03-15', char_at: IL(2026, 3, 20, 10).toISOString(), shoot_at: IL(2026, 4, 1, 10).toISOString() });
  importTo(w, c, 'renewal');
  const at = (now) => proc(w, c, 'p34', now);
  // 60 days before the end is Thursday 14.1.2027: it opens. Due Thursday 28.1 at 18:00.
  assert.deepEqual([hhmm(at(IL(2027, 1, 14, 9)).startAt), hhmm(at(IL(2027, 1, 14, 9)).dueAt)], ['14.1 00:00', '28.1 18:00']);
  assert.deepEqual([at(IL(2027, 1, 13, 12)).ready, at(IL(2027, 1, 14, 9)).ready, at(IL(2027, 1, 14, 19)).status, at(IL(2027, 1, 28, 12)).status, at(IL(2027, 1, 28, 18, 1)).status], [false, true, 'open', 'today', 'overdue']);
  // The ring to Lior on the day it opens (the existing one), now with the deadline; then the ladder of a late item.
  const open = due(w, IL(2027, 1, 14, 12)).find((r) => r.rule === 'renewalList' && r.step === 'start');
  assert.deepEqual([open.person, open.level], ['lior', 'ring']);
  assert.match(open.body, /להתחיל לדבר על ההמשך, עד 28\.1\.2027\./);
  assert.deepEqual(due(w, IL(2027, 1, 20, 14)).filter((r) => ['late', 'lateOwn', 'lateNag'].includes(r.rule)), [], 'not late inside its 14 days');
  const after = walk(w, IL(2027, 1, 28, 18), IL(2027, 1, 31, 9, 20)).filter((r) => ['late', 'lateOwn'].includes(r.rule));
  // (Lior hears of his own late process once, through the note of every late item, as Ofir does: docs/ops.md, section 48.)
  assert.deepEqual(after.map((r) => `${r.at} ${r.rule}.${r.step}@${r.person}`).sort(), ['31.1 09:15 late.lior@lior', '31.1 09:15 late.ofir@ofir']);
  assert.deepEqual(lateAt(w, IL(2027, 1, 31, 9, 20)).find((x) => x.procId === 'p34').holders, ['lior']);
  const nag = due(w, IL(2027, 1, 31, 14)).find((r) => r.rule === 'lateNag' && r.person === 'lior');
  assert.match(nag.title, /עדיין באיחור: חידוש · 34 · חידוש חוזה/);
  // A client of version 9: the same (the new deadline is the later one).
  c.protocol_version = 9;
  assert.equal(hhmm(at(IL(2027, 1, 14, 9)).dueAt), '28.1 18:00');
  // In landing: nothing.
  c.landing = true;
  assert.equal(at(IL(2027, 1, 29, 9)).dueAt, null);
});

test('5. a contract that ended while the client is still active: Lior rings once that morning, and two actions wait on his list; nothing changes by itself', () => {
  assert.deepEqual(CONTRACT_END, { who: 'lior', ringAt: '09:45', renewMonths: 12 });
  const w = world();
  const c = client(w, { name: 'מסתיים', contract_end: '2027-03-15', char_at: IL(2026, 3, 20, 10).toISOString(), shoot_at: IL(2026, 4, 1, 10).toISOString() });
  importTo(w, c, 'renewal');
  marks(w, c, itemsOf('p34'), IL(2027, 2, 1, 10));
  client(w, { name: 'בקליטה', contract_end: '2027-03-01', landing: true });
  client(w, { name: 'מסיים', contract_end: '2027-03-01', status: 'ending' });
  client(w, { name: 'בלי תאריך', contract_end: null });
  const ended = (now) => contractsEnded(w.clients, now).map((x) => [x.name, x.today, x.days]);
  assert.deepEqual(ended(IL(2027, 3, 14, 23)), []);
  assert.deepEqual(ended(IL(2027, 3, 15, 0, 5)), [['מסתיים', true, 0]]);
  // Monday 15.3.2027: one ring at 09:45, to Lior only.
  const log = [];
  const rows = walk(w, IL(2027, 3, 15, 8), IL(2027, 3, 15, 19), log).filter((r) => r.rule === 'contractEnd');
  assert.deepEqual(rows.map((r) => `${r.at} ${r.step}@${r.person}:${r.level}`), ['15.3 09:45 day@lior:ring']);
  assert.equal(rows[0].title, 'החוזה של מסתיים הסתיים היום: חידוש או סיום התקשרות?');
  assert.match(rows[0].body, /״נרשם חידוש״ עם תאריך הסיום החדש, או ״סיום התקשרות״, שפותח את תהליך 35\. הלקוח נשאר ״פעיל״ עד שבוחרים\./);
  assert.equal(rows[0].url, 'clients.html#mine');
  // The days after: no second ring, and the client is still on his list (and still "active": nothing was changed).
  assert.deepEqual(walk(w, IL(2027, 3, 16, 8), IL(2027, 3, 17, 19), log).filter((r) => r.rule === 'contractEnd'), []);
  assert.deepEqual([ended(IL(2027, 3, 17, 10)), c.status], [[['מסתיים', false, 2]], 'active']);
  // "סיום התקשרות": the status the existing process 35 needs. It appears on Lior's list, and the card is gone.
  assert.equal(proc(w, c, 'p35', IL(2027, 3, 17, 10)), undefined);
  c.status = 'ending';
  assert.deepEqual(ended(IL(2027, 3, 17, 10)), []);
  assert.ok(mine(w, c, 'lior', IL(2027, 3, 17, 10)).includes('p35.campaigns'));
  // "נרשם חידוש": the new end date. The card is gone, and the next renewal is counted from the new date.
  c.status = 'active';
  assert.equal(renewedEnd('2027-03-15'), '2028-03-15');
  assert.deepEqual([renewedEnd('2028-02-29'), renewedEnd('2027-01-31', 1), renewedEnd(null)], ['2029-02-28', '2027-02-28', '']);
  c.contract_end = renewedEnd(c.contract_end);
  assert.deepEqual(ended(IL(2027, 3, 17, 10)), []);
  const now = IL(2027, 3, 17, 10);
  assert.deepEqual([validRenewal('2028-03-15', now), validRenewal('2027-03-17', now), validRenewal('2027-03-10', now), validRenewal('', now), validRenewal('15.3.2028', now)], [true, false, false, false, false]);
  // A contract that ended on a Saturday: the ring waits for Sunday morning, and says the date.
  const sat = world();
  const s = client(sat, { name: 'שבת', contract_end: '2027-03-13' });
  importTo(sat, s, 'renewal');
  marks(sat, s, itemsOf('p34'), IL(2027, 2, 1, 10));
  const satRows = walk(sat, IL(2027, 3, 13, 8), IL(2027, 3, 14, 12)).filter((r) => r.rule === 'contractEnd');
  assert.deepEqual(satRows.map((r) => [r.at, r.title]), [['14.3 08:30', 'החוזה של שבת הסתיים ב־ש׳ 13.3.2027: חידוש או סיום התקשרות?']]);
});

// ── 6. The raw material and the take, per script ────────────────────────────
test('6. the raw material and the chosen take per script: one mark per shoot round, optional, read by whoever sees the client', () => {
  assert.deepEqual([FILES_KEY, RAW_MAX, TAKE_MAX, FILES_ROWS_MAX], ['p18b.files', 16, 6, 50]);
  let files = filesOf({}, '');
  assert.equal(files.size, 0);
  files = withFile(files, 3, ' 0123 ', '2');
  files = withFile(files, 1, 'C0007', '');
  files = withFile(files, 2, '', '4');
  assert.deepEqual([...files], [[1, { raw: 'C0007', take: '' }], [2, { raw: '', take: '4' }], [3, { raw: '0123', take: '2' }]]);
  const note = filesNote(files);
  assert.equal(note, '{"v":1,"f":{"1":["C0007",""],"2":["","4"],"3":["0123","2"]}}');
  // As a mark of the round (and of a second shoot round, under its own key).
  const checks = { 'p18b.files': { state: 'done', note, at: IL(2026, 10, 15, 12).toISOString() }, 'r2.p18b.files': { state: 'done', note: filesNote(withFile(new Map(), 5, '88', '1')) } };
  assert.deepEqual([...filesOf(checks, '')], [...files]);
  assert.deepEqual([...filesOf(checks, 'r2.')], [[5, { raw: '88', take: '1' }]]);
  // Both fields emptied: the row is taken out; nothing left: no note (the mark is cleared).
  assert.equal(filesNote(withFile(withFile(new Map(), 5, '88', '1'), 5, '', '')), '');
  // The rows the screen offers: every script of the day, and never fewer than what was shot or filled in.
  assert.deepEqual(fileRows(files, 4, [1, 2]).map((r) => [r.n, r.raw, r.take]), [[1, 'C0007', ''], [2, '', '4'], [3, '0123', '2'], [4, '', '']]);
  assert.equal(fileRows(new Map(), null, []).length, 1);
  assert.equal(fileRows(new Map(), null, [1, 2, 3, 4, 5, 6]).length, 6);
  assert.equal(fileRows(new Map(), 500, []).length, 50);
  // The hint next to "לכל חומר ברור לאיזה מספר סרטון הוא שייך", and the line the editor reads.
  assert.deepEqual([filesHint(files, 12), filesHint(new Map(), 12), filesHint(files, null)], ['2 מתוך 12 תסריטים עם קובץ', '0 מתוך 12 תסריטים עם קובץ', '2 תסריטים עם קובץ']);
  assert.deepEqual([fileLine(3, files.get(3)), fileLine(1, files.get(1)), fileLine(2, files.get(2))], ['סרטון 3 · קובץ 0123 · טייק 2', 'סרטון 1 · קובץ C0007', 'סרטון 2 · טייק 4']);
  // What is typed is cut to its length and kept as plain text; a broken note reads as nothing.
  assert.deepEqual(withFile(new Map(), 1, 'א"\\'.repeat(20), '1234567890').get(1), { raw: 'אאאאאאאאאאאאאאאא', take: '123456' });
  assert.equal(filesOf({ 'p18b.files': { state: 'done', note: '<script>' } }, '').size, 0);
  // A full day of 50 scripts with the longest values stays inside the 2,000 characters a mark holds.
  let full = new Map();
  for (let n = 1; n <= 60; n += 1) full = withFile(full, n, '9'.repeat(30), '8'.repeat(30));
  assert.equal(full.size, 50);
  assert.ok(filesNote(full).length <= 2000, String(filesNote(full).length));
  // It is a mark, not an item: it holds nothing open (the closing of the shoot day does not ask for it).
  assert.ok(!PROCESSES.some((p) => p.items.some((i) => i.key === FILES_KEY)));
  // Who writes it: Eli (and the office, Lior); the editor only reads.
  const dana = { editor: 'nadia', rounds: [{ n: 2, editor: 'yariv' }] };
  assert.deepEqual(['eli', 'lior', 'nadia', 'ilai'].map((p) => mayWrite({ person: p, client: dana, key: 'p18b.files', note })), [true, true, false, false]);
  assert.equal(mayWrite({ person: 'eli', client: dana, key: 'r2.p18b.files', note }), true);
  assert.equal(describeOfficeMark('p18b.files', 'done', note), 'עודכנו חומרי הגלם והטייקים שנבחרו ליד התסריטים');
});

// ── 7. Ilai's final check ───────────────────────────────────────────────────
// A client whose editing was closed and whose Gantt Ilai filled: Irit is about to send it.
function publishing(w = world(), o = {}) {
  const c = client(w, { name: 'גאנט', editor: 'nadia', char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 15, 10).toISOString(), ...o });
  importTo(w, c, 'publish');
  marks(w, c, itemsOf('p28'), IL(2026, 10, 26, 10));
  mark(w, c, 'p29.filled', IL(2026, 10, 26, 11));
  return { w, c };
}
test('7. Ilai\'s final check (29ב): it opens when the Gantt was sent, 13 points and "העבודה שלי על הלקוח הושלמה", due at the end of the next business day; Irit hears when he is done', () => {
  const p = PROCESSES.find((x) => x.id === 'p29b');
  assert.deepEqual([p.num, p.owners, p.round, p.phase, p.start, p.due, p.bulkWord], ['29ב', ['ilai'], true, 'publish', { from: 'p29' }, { from: 'p29', businessDays: 1 }, 'סימון הכול']);
  assert.deepEqual(p.items.map((i) => i.label), [
    'כל הרשתות קיימות', 'כל הגישות נמצאות במערכת', 'כל הרשתות מחוברות ל־Metricool', 'הנראות של כל העמודים מסודרת', 'הלוגו מסודר', 'כל הגרפיקות לפי החבילה מוכנות',
    'כל הגרפיקות נמצאות בתיק הלקוח במערכת', 'הסרטונים נמצאים בדרייב של הלקוח', 'הסרטונים תוזמנו', 'הגרפיקות תוזמנו', 'כל התוכן נמצא בגאנט', 'הגאנט תואם לתזמון', 'כל הפעולות שביצעתי עודכנו במערכת',
    'העבודה שלי על הלקוח הושלמה',
  ]);
  assert.equal(FINAL_CHECK.length, 13);
  assert.deepEqual([p.items.at(-1).requires.length, p.items.at(-1).noBulk, p.items.at(-1).word], [13, true, 'הושלמה']);
  const publish = STATIONS.find((s) => s.key === 'publish').procs;
  assert.deepEqual(publish, ['p28', 'p29', 'p29b', 'p30']);
  const { w, c } = publishing();
  const ilai = (now) => mine(w, c, 'ilai', now).filter((k) => k.startsWith('p29b.'));
  // Before Irit sent the Gantt: not on his list.
  assert.deepEqual(ilai(IL(2026, 10, 26, 11, 5)), []);
  // She sends it on Monday 26.10 at 11:20: it opens, and he is rung. Due Tuesday 18:00.
  mark(w, c, 'p29.sent', IL(2026, 10, 26, 11, 20));
  const log = [];
  const open = walk(w, IL(2026, 10, 26, 11, 20), IL(2026, 10, 26, 11, 22), log).filter((r) => r.rule === 'finalCheck');
  assert.deepEqual(open.map((r) => `${r.step}@${r.person}:${r.level}`), ['open@ilai:ring']);
  assert.deepEqual([open[0].title, open[0].body], ['בדיקה סופית: גאנט', 'הגאנט נשלח ללקוח. 13 סעיפים, ואז ״העבודה שלי על הלקוח הושלמה״. יעד מחר 18:00.']);
  const s = proc(w, c, 'p29b', IL(2026, 10, 26, 12));
  assert.deepEqual([hhmm(s.startAt), hhmm(s.dueAt), s.status], ['26.10 11:20', '27.10 18:00', 'open']);
  // One card: the 13 points (all of them in one press: "סימון הכול"); the last item waits for them.
  assert.equal(ilai(IL(2026, 10, 26, 12)).length, 13);
  assert.equal(bulkEligible(s, 'ilai', c, w.checks[c.id], IL(2026, 10, 26, 12)).length, 13);
  marks(w, c, FINAL_CHECK.map(([k]) => `p29b.c.${k}`), IL(2026, 10, 26, 14));
  assert.deepEqual(ilai(IL(2026, 10, 26, 14, 1)), ['p29b.done']);
  // "העבודה שלי על הלקוח הושלמה": the process is complete, and Irit hears.
  mark(w, c, 'p29b.done', IL(2026, 10, 26, 14, 5));
  assert.equal(proc(w, c, 'p29b', IL(2026, 10, 26, 14, 6)).complete, true);
  const done = walk(w, IL(2026, 10, 26, 14, 5), IL(2026, 10, 26, 14, 7), log).filter((r) => r.rule === 'finalCheck');
  assert.deepEqual(done.map((r) => `${r.step}@${r.person}:${r.level}`), ['irit@irit:quiet']);
  assert.deepEqual([done[0].title, done[0].body], ['עילאי סיים את העבודה על גאנט', 'הרשתות, הגרפיקות, התזמון והגאנט נבדקו (13 סעיפים).']);
  // Not done by the deadline: the ladder of every late item (he rings; Ofir and Lior get the note).
  const lw = world();
  const { c: lc } = publishing(lw);
  mark(lw, lc, 'p29.sent', IL(2026, 10, 26, 11, 20));
  const late = walk(lw, IL(2026, 10, 27, 18), IL(2026, 10, 28, 9, 20)).filter((r) => ['lateOwn', 'late'].includes(r.rule) && /29ב/.test(r.title));
  assert.deepEqual(late.map((r) => `${r.at} ${r.rule}.${r.step}@${r.person}`).sort(), ['28.10 09:15 late.lior@lior', '28.10 09:15 late.ofir@ofir', '28.10 09:15 lateOwn.own@ilai']);
});

test('7. existing clients: the final check is never late for a client that started before; history that was brought in, and a Gantt sent before version 10, are never asked', () => {
  const ALL = PROCESSES.find((x) => x.id === 'p29b').items.map((i) => i.key);
  // A version 9 client that reaches the step after version 10: work for Ilai, never late.
  const { w, c } = publishing(world(), { protocol_version: 9 });
  mark(w, c, 'p29.sent', IL(2026, 10, 26, 11, 20));
  const week = IL(2026, 11, 2, 10);
  const s = proc(w, c, 'p29b', week);
  assert.deepEqual([s.status, s.late, mine(w, c, 'ilai', week).filter((k) => k.startsWith('p29b.')).length], ['open', false, 13]);
  assert.deepEqual(due(w, week).filter((r) => ['late', 'lateOwn', 'lateNag'].includes(r.rule) && /29ב/.test(r.title + r.body)), []);
  // Imported history (a client brought in beyond "פרסום" under an older version, with no mark of 29ב): not asked.
  const imp = world();
  const ci = client(imp, { name: 'ייבוא', protocol_version: 7, shoot_at: IL(2026, 9, 1, 10).toISOString() });
  importTo(imp, ci, 'ongoing');
  for (const k of ALL) delete imp.checks[ci.id][k];
  assert.deepEqual(mine(imp, ci, 'ilai', week).filter((k) => k.startsWith('p29b.')), []);
  assert.ok(proc(imp, ci, 'p29b', week).proc.items.every((i) => i.optional && i.history));
  // An import made under version 10 marks the check with its station.
  assert.ok(ALL.every((k) => importKeys('ongoing').includes(k)));
  // The Gantt was sent before version 10 (a real mark): the migration writes the check as history, and it stays closed.
  const { w: wm, c: cm } = publishing(world(), { protocol_version: 9 });
  mark(wm, cm, 'p29.sent', IL(2026, 10, 9, 11));
  marks(wm, cm, ALL, IL(2026, 10, 10, 20), IMPORT_NOTE);
  assert.equal(proc(wm, cm, 'p29b', week).complete, true);
  assert.deepEqual(due(wm, week).filter((r) => r.rule === 'finalCheck'), [], 'history is not an event: no ring, and Irit is not told');
  // In landing: nothing.
  const { w: wl, c: cl } = publishing(world(), { landing: true });
  mark(wl, cl, 'p29.sent', IL(2026, 10, 26, 11, 20));
  assert.deepEqual(mine(wl, cl, 'ilai', week), []);
});

test('7. "עילאי הכין לוגו חדש" is not ticked while the client\'s files hold no logo, and he may upload the one he made', () => {
  assert.equal(guardOf('p05.newlogo'), 'logoFile');
  assert.deepEqual(guardVerdict('logoFile', { logos: 0 }), { refuse: 'עוד אין קובץ לוגו בתיק הלקוח. מעלים אותו שם, ואז מסמנים.' });
  assert.equal(guardVerdict('logoFile', { logos: 1 }), null);
  assert.equal(guardVerdict('logoFile', null), null, 'not known: the mark is taken');
  assert.ok(uploadKinds('ilai', {}).includes('logo'));
  // It is pressed by itself, never with "mark the whole process".
  const w = world();
  const c = client(w, { has_logo: false, char_at: IL(2026, 10, 5, 10).toISOString() });
  importTo(w, c, 'char');
  marks(w, c, itemsOf('p04'), IL(2026, 10, 5, 12));
  const s = proc(w, c, 'p05', IL(2026, 10, 5, 12, 30));
  assert.ok(!bulkEligible(s, 'ilai', c, w.checks[c.id], IL(2026, 10, 5, 12, 30)).some((i) => i.key === 'p05.newlogo'));
});

// ── 8. Fixes that remained after the Zoom ───────────────────────────────────
test('8. fixes after the Zoom (13): once Lior says they remained, the item is asked for, due at the end of the next business day, on the usual ladder; "אין תיקונים" closes it', () => {
  const p13 = PROCESSES.find((p) => p.id === 'p13');
  assert.deepEqual(p13.due, { from: 'char', businessDays: 3, afterMark: [{ key: 'p13.left', businessDays: 1 }] });
  assert.deepEqual([p13.items.find((i) => i.key === 'p13.fixes').optional, p13.items.find((i) => i.key === 'p13.fixes').neededIf], [true, 'p13.left']);
  const { w, c } = afterMeeting(); // the meeting: Monday 5.10
  marks(w, c, itemsOf('p07'), IL(2026, 10, 5, 14));
  marks(w, c, itemsOf('p07a'), IL(2026, 10, 5, 14));
  const lior = (now) => mine(w, c, 'lior', now).filter((k) => k.startsWith('p13.'));
  // The Zoom took place and the client approved (Wednesday 7.10 11:00). Nobody answered about fixes: closed, as before.
  marks(w, c, ['p13.zoom', 'p13.approved'], IL(2026, 10, 7, 11));
  assert.deepEqual([proc(w, c, 'p13', IL(2026, 10, 7, 11, 5)).complete, lior(IL(2026, 10, 7, 11, 5))], [true, []]);
  // "נשארו תיקונים" (11:10): the item is his, due Thursday 8.10 at 18:00.
  mark(w, c, 'p13.left', IL(2026, 10, 7, 11, 10));
  const s = proc(w, c, 'p13', IL(2026, 10, 7, 12));
  assert.deepEqual([s.complete, hhmm(s.dueAt), s.status, lior(IL(2026, 10, 7, 12))], [false, '8.10 18:00', 'open', ['p13.fixes']]);
  assert.equal(describeOfficeMark('p13.left', 'done', null), 'נשארו תיקונים אחרי הזום: נפתח פריט עם יעד');
  // Not done by then: the usual ladder. Lior rings "באיחור" (Sunday 09:15, 15 office minutes past the deadline); it is not "the client's turn".
  const late = lateAt(w, IL(2026, 10, 11, 9, 20)).find((x) => x.procId === 'p13');
  assert.deepEqual([late.clientTurn, late.holders], [false, ['lior']]);
  const rows = walk(w, IL(2026, 10, 8, 18), IL(2026, 10, 11, 9, 20)).filter((r) => ['lateOwn', 'late'].includes(r.rule) && /13 · /.test(r.title));
  assert.deepEqual(rows.map((r) => `${r.at} ${r.rule}.${r.step}@${r.person}`).sort(), ['11.10 09:15 late.lior@lior', '11.10 09:15 late.ofir@ofir']);
  // He marks the fixes done: the process is complete.
  mark(w, c, 'p13.fixes', IL(2026, 10, 11, 10));
  assert.equal(proc(w, c, 'p13', IL(2026, 10, 11, 10, 5)).complete, true);
  // "אין תיקונים": p13.fixes is "לא נדרש", and nothing was ever asked.
  const { w: w2, c: c2 } = afterMeeting();
  marks(w2, c2, ['p13.zoom', 'p13.approved'], IL(2026, 10, 7, 11));
  mark(w2, c2, 'p13.fixes', IL(2026, 10, 7, 11, 10), 'אין תיקונים אחרי הזום', 'na');
  assert.deepEqual([proc(w2, c2, 'p13', IL(2026, 10, 8, 9)).complete, mine(w2, c2, 'lior', IL(2026, 10, 8, 9)).filter((k) => k.startsWith('p13.'))], [true, []]);
  // Fixes remained and the client did not approve yet: the fixes are Lior's (his deadline), not the client's turn.
  const { w: w3, c: c3 } = afterMeeting();
  mark(w3, c3, 'p13.zoom', IL(2026, 10, 7, 11));
  mark(w3, c3, 'p13.left', IL(2026, 10, 7, 11, 10));
  const l3 = lateAt(w3, IL(2026, 10, 11, 9, 20)).find((x) => x.procId === 'p13');
  assert.deepEqual([l3.clientTurn, l3.holders], [false, ['lior']]);
  mark(w3, c3, 'p13.fixes', IL(2026, 10, 11, 10));
  assert.equal(lateAt(w3, IL(2026, 10, 11, 11)).find((x) => x.procId === 'p13').clientTurn, true, 'fixed: it waits for the client\'s approval again');
  // A second shoot round: its own marks.
  const { w: w4, c: c4 } = afterMeeting();
  c4.rounds = [{ n: 2, start_at: IL(2026, 11, 1, 10).toISOString(), shoot_at: IL(2026, 11, 15, 10).toISOString(), shoot_type: 'dms' }];
  mark(w4, c4, 'r2.p13.left', IL(2026, 11, 4, 11));
  const r2 = proc(w4, c4, 'r2-p13', IL(2026, 11, 4, 12));
  assert.deepEqual([r2.proc.items.find((i) => i.key === 'r2.p13.fixes').optional, hhmm(r2.dueAt)], [false, '5.11 18:00']);
});

// ── 9. Nirel's mandatory brief on a task given on the spot ──────────────────
test('9. a task on the spot ("נודניק") for Nirel carries the four fields of her brief; for anyone else nothing changed', () => {
  assert.deepEqual(NAG_BRIEF.map(([k]) => k), BRIEF_MUST);
  assert.deepEqual(NAG_BRIEF.map(([, l]) => l), ['מה הבעיה המדויקת', 'מה בדיוק צריך לשנות', 'מה צריך להישאר כמו שהוא', 'מה התוצאה הרצויה']);
  assert.deepEqual([needsBrief('nirel'), needsBrief('nadia'), needsBrief('ilai'), needsBrief('owner')], [true, false, false, false]);
  assert.ok([...BRIEF_REQUIRED].every(needsBrief));
  // Somebody else: the function and the arguments are as they were.
  const plain = validateTask({ assignee: 'nadia', body: 'להעלות את סרטון 4' });
  assert.deepEqual([plain.ok, plain.rpc, plain.args], [true, 'staff_task_create', { p_assignee: 'nadia', p_body: 'להעלות את סרטון 4', p_client: null }]);
  // Nirel with no brief: each of the four is asked for, by name.
  const none = validateTask({ assignee: 'nirel', body: 'לתקן את הסגיר' });
  assert.equal(none.ok, false);
  assert.deepEqual(Object.keys(none.errors), ['brief.problem', 'brief.change', 'brief.keep', 'brief.result']);
  assert.equal(none.errors['brief.problem'], 'חובה במשימה לניראל.');
  const partial = validateTask({ assignee: 'nirel', body: 'לתקן את הסגיר', brief: { problem: 'הלוגו ישן', change: 'להחליף ללוגו החדש', keep: '  ', result: 'x'.repeat(501) } });
  assert.deepEqual(Object.keys(partial.errors), ['brief.keep', 'brief.result']);
  // Full: the function that keeps the brief, with only its four fields, trimmed.
  const full = validateTask({ assignee: 'nirel', body: 'לתקן את הסגיר', clientId: 'not-a-uuid', brief: { problem: ' הלוגו ישן ', change: 'להחליף ללוגו החדש', keep: 'המוזיקה והטקסט', result: 'סגיר נקי', other: 'x' } });
  assert.deepEqual([full.ok, full.rpc], [true, 'staff_task_create_brief']);
  assert.deepEqual(full.args, { p_assignee: 'nirel', p_body: 'לתקן את הסגיר', p_client: null, p_brief: { problem: 'הלוגו ישן', change: 'להחליף ללוגו החדש', keep: 'המוזיקה והטקסט', result: 'סגיר נקי' } });
  assert.deepEqual(briefLines({ brief: full.args.p_brief }).map(([l]) => l), NAG_BRIEF.map(([, l]) => l));
  assert.deepEqual(briefLines({ brief: null }), []);
});

// ── 10. Eli read the scripts ────────────────────────────────────────────────
test('10. "קראתי את התסריטים" is Eli\'s own mark (the database lets him write it, and his "קיבלתי"); it holds nothing open', () => {
  const dana = { editor: 'nadia', rounds: [{ n: 2 }] };
  assert.deepEqual(['p16.read', 'r2.p16.read', 'p16.photographer'].map((k) => mayWrite({ person: 'eli', client: dana, key: k, note: 'x' })), [true, true, true]);
  assert.deepEqual(['nadia', 'ilai'].map((p) => mayWrite({ person: p, client: dana, key: 'p16.read', note: 'x' })), [false, false]);
  assert.ok(!PROCESSES.some((p) => p.items.some((i) => i.key === 'p16.read')), 'a mark, not an item');
  assert.equal(describeOfficeMark('p16.read', 'done', null), 'הצלם קרא את התסריטים של יום הצילום');
  // (The 20:00 line to Lior: tests/reminder-engine.test.mjs, "photographer briefing (16)".)
});

// ── 12. Irit's own clock for sending the Gantt ──────────────────────────────
test('12. sending the Gantt (29): Irit\'s 30 office minutes start when Ilai marks the Gantt full', () => {
  const p29 = PROCESSES.find((p) => p.id === 'p29');
  assert.deepEqual(p29.due, { from: 'p27', hours: 2, afterMark: [{ key: 'p29.filled', minutes: 30, office: true }] });
  const w = world();
  const c = client(w, { name: 'גאנט', editor: 'nadia', char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 15, 10).toISOString() });
  importTo(w, c, 'publish');
  drop(w, c, ['p27']);
  marks(w, c, PROCESSES.find((p) => p.id === 'p27').items.filter((i) => !i.optional).map((i) => i.key), IL(2026, 10, 26, 9, 30));
  // Until Ilai fills it: his two hours from the closing of the editing (as before).
  assert.equal(hhmm(proc(w, c, 'p29', IL(2026, 10, 26, 10)).dueAt), '26.10 11:30');
  // He marks it full at 17:50: Irit has 30 office minutes, 10 today and 20 tomorrow morning.
  mark(w, c, 'p29.filled', IL(2026, 10, 26, 17, 50));
  assert.equal(hhmm(proc(w, c, 'p29', IL(2026, 10, 26, 17, 55)).dueAt), '27.10 09:20');
  const ring = due(w, IL(2026, 10, 26, 17, 51)).find((r) => r.rule === 'publish' && r.step === 'gantt');
  assert.deepEqual([ring.person, ring.level, ring.title, ring.body], ['irit', 'ring', 'לשלוח גאנט: גאנט', 'עילאי סיים למלא את הגאנט. יעד מחר 09:20.']);
  assert.deepEqual(mine(w, c, 'irit', IL(2026, 10, 26, 17, 55)).filter((k) => k.startsWith('p29.')), ['p29.sent']);
  // Not sent by then: she holds it, and the usual ladder rings her (15 office minutes past the deadline).
  const rows = walk(w, IL(2026, 10, 27, 9, 0), IL(2026, 10, 27, 9, 40)).filter((r) => ['lateOwn', 'late'].includes(r.rule) && /29 · /.test(r.title));
  // (Ilai waits for it: his final check, 29ב, opens when she sends. He is told once whose work holds his card.)
  assert.deepEqual(rows.map((r) => `${r.at} ${r.rule}.${r.step}@${r.person}`).sort(), ['27.10 09:35 late.lior@lior', '27.10 09:35 late.ofir@ofir', '27.10 09:35 lateOwn.own@irit', '27.10 09:35 lateOwn.wait@ilai']);
  assert.deepEqual(lateAt(w, IL(2026, 10, 27, 9, 40)).find((x) => x.procId === 'p29').holders, ['irit']);
  // Filled early: a client that started before version 10 keeps the later of the two (the two hours it had).
  const old = world();
  const o = client(old, { name: 'ישן', protocol_version: 9, editor: 'nadia', char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 15, 10).toISOString() });
  importTo(old, o, 'publish');
  drop(old, o, ['p27']);
  marks(old, o, PROCESSES.find((p) => p.id === 'p27').items.filter((i) => !i.optional).map((i) => i.key), IL(2026, 10, 26, 9, 30));
  mark(old, o, 'p29.filled', IL(2026, 10, 26, 10));
  assert.equal(hhmm(proc(old, o, 'p29', IL(2026, 10, 26, 10, 5)).dueAt), '26.10 11:30');
  c.protocol_version = PROTOCOL_VERSION;
  mark(w, c, 'p29.filled', IL(2026, 10, 26, 10));
  assert.equal(hhmm(proc(w, c, 'p29', IL(2026, 10, 26, 10, 5)).dueAt), '26.10 10:30');
});

// ── Version 10 as data ──────────────────────────────────────────────────────
test('version 10: the history records every new item, the deadlines it changed, and nothing of it is asked of a client in landing', () => {
  assert.equal(PROTOCOL_VERSION, 10);
  const v10 = PROTOCOL_HISTORY.at(-1);
  assert.equal(v10.version, 10);
  assert.equal(v10.items.length, 24);
  assert.deepEqual(Object.keys(v10.due), ['p13', 'p27', 'p29', 'p34']);
  // Every new required item has its answer for a client that is already past it.
  const added = PROCESSES.flatMap((p) => p.items.filter((i) => v10.items.includes(i.key)).map((i) => [p.id, i]));
  assert.equal(added.length, 24);
  for (const [pid, i] of added) assert.ok(pid === 'p29b' || i.passedIf, `${i.key}: passedIf, or the migration's history (29ב)`);
  // New rules, each with its people.
  for (const id of ['clientWaits', 'clientWaitsLine', 'contractEnd', 'finalCheck']) assert.ok(RULES.some((r) => r.id === id), id);
  // No price in any text of the new rules' data.
  assert.ok(!/₪|מחיר|שקל/.test(JSON.stringify([CLIENT_WAITS, CONTRACT_END, FINAL_CHECK, CRITICAL_MISTAKES])));
});
