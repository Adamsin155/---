// Protocol version 9 (the owner's decision of 10.10.2026; docs/ops.md, section 57): Ofir
// alone checks the graphics (the first 9: process 7; the rest: 23) and assigns the editor
// (22א), each on a fast ladder of its own: 10 minutes, 5 more, then Lior is told, then
// Ofir again every 10 minutes; counted and rung on working days until 21:00.
// Fixed Israel times; npm test runs this under UTC, New York and Jerusalem.
//   1. the numbers and the window are data, and the arithmetic of the window;
//   2. the ladder of the graphics (7 and 23): in time, ignored, returned for fixes;
//   3. the ladder of the assignment (22א), and a T0 at 20:55;
//   4. it replaces the ladder of a late item, and still counts as Ofir's lateness;
//   5. the sending hours do not hold it; Lior on a shoot day;
//   6. landing, imported history, a client activated out of landing;
//   7. the clients that were already there (version 8 and before), case by case;
//   8. the screens' answers: the clock, the words, Irit's line, Ilai's card, Lior's list;
//   9. who a finished process is counted for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders, buildEnv, planDelivery, candidates } from '../app/reminder-engine.js';
import { RULES, OWN_LATE, inSendHours, SEND_HOURS } from '../app/reminder-rules.js';
import { PROCESSES, PROTOCOL_VERSION, FAST_LADDER, WORK_HOURS } from '../app/protocol.js';
import {
  clientState, openItemsFor, IMPORT_NOTE, addFastMinutes, fastMsBetween, fastOpen, nextFastMoment, reviewClock, creditedTo, performanceReport,
} from '../app/protocol-logic.js';
import { PROTOCOL_HISTORY, itemSince } from '../app/protocol-versions.js';
import { fastCases, ladderAt, ladderWords, reviewUrl, assignUrl } from '../app/fast-ladder.js';
import { lateItems, heldLate } from '../app/late-chain.js';
import { daySummary } from '../app/day-summary.js';
import { QA_KINDS, qaState, returnKey, fixedKey, returnNote, QA_MARK, describeOfficeMark } from '../app/office-marks.js';
import { qaQueue, qaFixing } from '../app/qa-logic.js';
import { clocksFor } from '../app/clocks.js';
import { flowLines } from '../app/mine-flow.js';
import { ilaiWork } from '../app/ilai-logic.js';
import { importKeys } from '../app/client-open.js';
import { mayWrite, writerRows } from '../scripts/protocol-writers.mjs';
import { dateIL, partsIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0, s = 0) => dateIL(y, m, d, h, mi, s);
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' }, { email: 'nadia@x', person: 'nadia' },
  { email: 'yariv@x', person: 'yariv' }, { email: 'anna@x', person: 'anna' }, { email: 'eli@x', person: 'eli' },
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
const stateOf = (w, c, now) => clientState(c, w.checks[c.id] || {}, now);
const proc = (w, c, id, now) => stateOf(w, c, now).states.find((s) => s.proc.id === id);
const mine = (w, c, person, now) => openItemsFor(person, c, w.checks[c.id] || {}, stateOf(w, c, now), now).map((e) => e.item.key);
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const fastOf = (list) => list.filter((r) => r.rule === 'fast').map((r) => `${r.step}@${r.person}`).sort();
const casesAt = (w, now) => fastCases({ clients: w.clients, checksOf: (c) => w.checks[c.id] || {}, stateOf: (c) => stateOf(w, c, now) });
const lateAt = (w, now) => lateItems({ clients: w.clients, checksOf: (c) => w.checks[c.id] || {}, stateOf: (c) => stateOf(w, c, now), tasks: w.tasks, personOf: (e) => STAFF.find((s) => s.email === e)?.person ?? null, now });
// A ladder as the engine walks it: every minute from `from` to `to`, each step once (the log;
// pass the same one to go on with a walk after something was marked).
function walk(w, from, to, log = []) {
  const rows = [];
  for (let t = new Date(from); t <= to; t = new Date(t.getTime() + 6e4)) {
    const got = due(w, t, log);
    for (const r of got) { log.push({ key: r.key }); rows.push({ at: hhmm(t), rule: r.rule, step: r.step, person: r.person, level: r.level, title: r.title, body: r.body, ownHours: r.ownHours, noFold: r.noFold, url: r.url }); }
  }
  return rows;
}
const REVIEW_KEYS = (b) => PROCESSES.find((p) => p.id === b).items.filter((i) => /\.(r|q)\./.test(i.key) || i.key === `${b}.ofir`).map((i) => i.key);

// A client the day after its characterization (Monday 5.10.2026, ended 12:00): everything of
// the meeting day done but the 9 graphics, which Ilai hands over when the test says so.
function afterMeeting(w = world(), o = {}) {
  const c = client(w, { name: 'אלפא', char_at: IL(2026, 10, 5, 10).toISOString(), ...o });
  importTo(w, c, 'char');
  marks(w, c, itemsOf('p04'), IL(2026, 10, 5, 12));
  for (const id of ['p05', 'p05b', 'p06', 'p08', 'p08b', 'p09', 'p10', 'p12a', 'p12']) marks(w, c, itemsOf(id), IL(2026, 10, 5, 12, 30));
  return { w, c };
}
// A client whose shoot day (Thursday 15.10.2026) is about to be closed; everything before it is history.
function shot(w = world(), o = {}) {
  const c = client(w, { name: 'בטא', char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 15, 10).toISOString(), ...o });
  importTo(w, c, 'post');
  for (const id of ['p22a', 'p22', 'p23', 'p23b', 'p24', 'p25', 'p26', 'p27']) for (const i of PROCESSES.find((p) => p.id === id).items) delete w.checks[c.id][i.key];
  for (const k of itemsOf('p19')) delete w.checks[c.id][k];
  return { w, c };
}
const closeDay = (w, c, at) => marks(w, c, itemsOf('p19'), at);

// ── 1. The data and the window ──────────────────────────────────────────────
test('version 9 as data: the numbers and the window in one place; the graphics and the assignment are Ofir\'s alone', () => {
  assert.ok(PROTOCOL_VERSION >= 9);
  // (`meeting`: version 10, the count waits while Ofir is in a characterization meeting; tests/audit-gaps-v10.test.mjs.)
  assert.deepEqual(FAST_LADDER, { who: 'ofir', manager: 'lior', window: { from: '08:30', until: '21:00' }, review: { minutes: 10, more: 5, every: 10 }, assign: { minutes: 10, more: 5, every: 10 }, meeting: { pause: true, capHours: 2 } });
  const byId = Object.fromEntries(PROCESSES.map((p) => [p.id, p]));
  const own = (id, key) => { const p = byId[id]; return p.items.find((i) => i.key === key).owners || p.owners; };
  // 7: Ilai makes; the seven checks and the approval are Ofir's; the sending and the client's answer are Irit's.
  for (const k of ['spelling', 'phone', 'address', 'logo', 'details', 'wording', 'design']) assert.deepEqual(own('p07', `p07.r.${k}`), ['ofir'], k);
  assert.deepEqual([own('p07', 'p07.made'), own('p07', 'p07.ofir'), own('p07', 'p07.sent'), own('p07', 'p07.call'), own('p07', 'p07.approved')], [['ilai'], ['ofir'], ['irit'], ['irit'], ['irit']]);
  assert.deepEqual(byId.p07.items.find((i) => i.key === 'p07.sent').requires, ['p07.ofir']);
  assert.equal(byId.p07.items.find((i) => i.key === 'p07.ofir').requires.length, 7);
  // 7 and 23 have the same shape: made, seven checks, Ofir's approval, sent, the client's answer.
  for (const id of ['p07', 'p23']) {
    const keys = byId[id].items.map((i) => i.key.replace(/\.[rq]\.\w+$/, '.check'));
    assert.deepEqual([...new Set(keys)], [`${id}.made`, `${id}.check`, `${id}.ofir`, `${id}.sent`, `${id}.call`, `${id}.approved`], id);
    assert.ok(byId[id].items.every((i) => !(i.owners || byId[id].owners).includes('lior')), `Lior has no item in ${id}`);
    assert.deepEqual(byId[id].due.afterMark[0], { key: `${id}.made`, fast: 'review', qa: id });
  }
  // 7א (Irit's link to the status page) opens with Ofir's approval.
  assert.deepEqual([byId.p07a.start, byId.p07a.due], [{ from: 'item:p07.ofir' }, { from: 'item:p07.ofir', minutes: 30 }]);
  // 22א: Ofir's; Lior keeps "the drive came back", Irit her verification.
  assert.deepEqual(byId.p22a.owners, ['ofir']);
  assert.deepEqual(byId.p22a.items.map((i) => [i.key, i.owners || byId.p22a.owners]), [['p22a.drive', ['lior']], ['p22a.load', ['ofir']], ['p22a.assigned', ['ofir']], ['p22a.irit', ['irit']]]);
  assert.deepEqual(byId.p22a.due, { from: 'p19', fast: 'assign' });
  // The editing clock still starts at the assignment.
  assert.deepEqual(byId.p22.due, { from: 'item:p22a.assigned', businessDays: 3 });
  // The history: nothing of version 9 is gated by the version. The approval is not "חדש בפרוטוקול" for
  // anybody (it is asked of every client that has not sent its graphics yet), and no deadline is listed
  // (so no client keeps the hour the check had).
  const v9 = PROTOCOL_HISTORY.at(-1);
  assert.deepEqual([v9.version, v9.items, v9.due, itemSince('p07.ofir')], [9, undefined, undefined, 1]);
  assert.equal(byId.p07.items.find((i) => i.key === 'p07.ofir').passedIf, 'p07.sent');
  // The first graphics return for fixes as the rest do.
  assert.deepEqual([QA_KINDS.graphics9.base, QA_KINDS.graphics9.ready, QA_KINDS.graphics9.approved, QA_KINDS.graphics9.checks.length, QA_KINDS.graphics9.fixer()], ['p07', 'p07.made', 'p07.ofir', 7, 'ilai']);
  assert.ok(QA_MARK.test('p07.return.1') && QA_MARK.test('p07.fixed.1.0') && QA_MARK.test('p23.return.2') && QA_MARK.test('r2.p25.fixed.1'));
  assert.equal(describeOfficeMark('p07.return.1', 'done', returnNote([{ ref: '2', text: 'x' }], null)), 'החזיר/ה לתיקון את 9 הגרפיקות הראשונות: סבב 1, בעיה אחת');
  // The old rules are gone; the new one is there.
  for (const id of ['assign', 'autoAssigned']) assert.ok(!RULES.some((r) => r.id === id), id);
  assert.ok(RULES.some((r) => r.id === 'fast'));
  assert.ok(!OWN_LATE.has('p22a'));
});

test('the window of the two ladders: working days 08:30–21:00, erev chag until the office closes; a count that reaches the close goes on the next working morning', () => {
  // Sunday 11.10.2026.
  assert.deepEqual([fastOpen(IL(2026, 10, 11, 8, 29)), fastOpen(IL(2026, 10, 11, 8, 30)), fastOpen(IL(2026, 10, 11, 20, 59)), fastOpen(IL(2026, 10, 11, 21, 0))], [false, true, true, false]);
  // Friday, Saturday and a holiday (Yom Kippur 21.9.2026): closed all day.
  for (const d of [IL(2026, 10, 9, 12), IL(2026, 10, 10, 12), IL(2026, 9, 21, 12)]) assert.equal(fastOpen(d), false, hhmm(d));
  // It is wider than the sending hours of every other reminder (08:30–19:00), which did not move.
  assert.deepEqual(SEND_HOURS, { from: 8 * 60 + 30, to: 19 * 60, erevTo: WORK_HOURS.erevEnd * 60 });
  assert.deepEqual([inSendHours(IL(2026, 10, 11, 19, 30)), fastOpen(IL(2026, 10, 11, 19, 30))], [false, true]);
  // Plain minutes inside the window, the office's own close (18:00) included.
  assert.equal(hhmm(addFastMinutes(IL(2026, 10, 11, 17, 55), 10)), '11.10 18:05');
  // 20:55: five minutes that evening, five the next working morning. Nothing is due at 21:00 itself.
  assert.equal(hhmm(addFastMinutes(IL(2026, 10, 11, 20, 55), 10)), '12.10 08:35');
  assert.equal(hhmm(addFastMinutes(IL(2026, 10, 11, 20, 50), 10)), '12.10 08:30');
  assert.equal(hhmm(addFastMinutes(IL(2026, 10, 11, 20, 55), 15)), '12.10 08:40');
  // Thursday evening goes on on Sunday; a T0 at night or on Saturday starts at the opening.
  assert.equal(hhmm(addFastMinutes(IL(2026, 10, 8, 20, 55), 10)), '11.10 08:35');
  assert.equal(hhmm(addFastMinutes(IL(2026, 10, 8, 23, 10), 10)), '11.10 08:40');
  assert.equal(hhmm(addFastMinutes(IL(2026, 10, 10, 14, 0), 10)), '11.10 08:40');
  assert.equal(hhmm(nextFastMoment(IL(2026, 10, 11, 7, 0))), '11.10 08:30');
  // Erev Pesach 2027 (Wednesday 21.4): the day ends at 13:00; Pesach and the weekend are closed.
  assert.deepEqual([fastOpen(IL(2027, 4, 21, 12, 59)), fastOpen(IL(2027, 4, 21, 13, 0)), fastOpen(IL(2027, 4, 22, 10))], [true, false, false]);
  assert.equal(hhmm(addFastMinutes(IL(2027, 4, 21, 12, 55), 10)), '25.4 08:35');
  // The same clock read backwards: the window's time between two moments.
  assert.equal(fastMsBetween(IL(2026, 10, 11, 20, 55), IL(2026, 10, 12, 8, 35)) / 6e4, 10);
  assert.equal(fastMsBetween(IL(2026, 10, 8, 20, 0), IL(2026, 10, 11, 9, 0)) / 6e4, 90);
});

// ── 2. The graphics ─────────────────────────────────────────────────────────
test('the first 9 graphics, approved in time: one ring to Ofir, no lateness ring, and Irit is told the minute he approved', () => {
  const { w, c } = afterMeeting();
  mark(w, c, 'p07.made', IL(2026, 10, 6, 10, 0)); // Tuesday 10:00
  const [f] = casesAt(w, IL(2026, 10, 6, 10, 1));
  assert.deepEqual([f.kind, f.qa, f.procId, hhmm(f.t0), hhmm(f.dueAt), hhmm(f.tellAt), f.url], ['review', 'graphics9', 'p07', '6.10 10:00', '6.10 10:10', '6.10 10:15', reviewUrl(c.id, 'p07')]);
  // His, and only his: the seven checks are on his list; Irit and Lior have nothing of 7.
  assert.equal(mine(w, c, 'ofir', IL(2026, 10, 6, 10, 1)).filter((k) => k.startsWith('p07.r.')).length, 7);
  for (const p of ['irit', 'lior']) assert.deepEqual(mine(w, c, p, IL(2026, 10, 6, 10, 1)).filter((k) => /^p07a?\./.test(k)), [], p);
  // He approves at 10:07.
  const log = [];
  const before = walk(w, IL(2026, 10, 6, 10, 0), IL(2026, 10, 6, 10, 6), log);
  marks(w, c, REVIEW_KEYS('p07'), IL(2026, 10, 6, 10, 7));
  const all = [...before, ...walk(w, IL(2026, 10, 6, 10, 7), IL(2026, 10, 6, 10, 40), log)];
  const rows = all.filter((r) => /גרפיקות|סטטוס/.test(r.title));
  assert.deepEqual(rows.map((r) => `${r.at} ${r.rule}.${r.step}@${r.person}:${r.level}`), [
    '6.10 10:00 fast.now@ofir:ring',
    '6.10 10:07 graphics9.irit@irit:ring',
    '6.10 10:07 clientLink.now@irit:ring',
  ]);
  assert.equal(rows[0].title, '9 הגרפיקות הראשונות מוכנות לבדיקה: אלפא');
  assert.equal(rows[0].body, '10 דקות לעבור עליהן ולאשר (או להחזיר לעילאי לתיקון), עד 10:10.');
  assert.equal(rows[0].url, `qa.html#review-${c.id}-p07`);
  assert.equal(rows[1].title, 'לשלוח ללקוח: 9 הגרפיקות · אלפא');
  assert.equal(rows[2].title, 'לשלוח ללקוח קישור לדף הסטטוס: אלפא');
  // Nothing was late: no note of any ladder, to anybody.
  assert.deepEqual(all.filter((r) => /^late/.test(r.rule) && / 7 · /.test(r.title)), []);
  assert.deepEqual(casesAt(w, IL(2026, 10, 6, 10, 8)), []);
  // The sending is Irit's now, with two office hours from his approval.
  assert.deepEqual(mine(w, c, 'irit', IL(2026, 10, 6, 10, 8)).filter((k) => /^p07a?\./.test(k)).sort(), ['p07.sent', 'p07a.sent']);
  assert.equal(hhmm(proc(w, c, 'p07', IL(2026, 10, 6, 10, 8)).dueAt), '6.10 12:07');
});

test('the first 9 graphics, ignored: a ring at T0, lateness at 10 minutes, Lior at 15, then Ofir every 10 minutes until he approves; nobody else, and no other ladder', () => {
  const { w, c } = afterMeeting();
  mark(w, c, 'p07.made', IL(2026, 10, 6, 10, 0));
  const log = [];
  const all = walk(w, IL(2026, 10, 6, 10, 0), IL(2026, 10, 6, 11, 0), log);
  const rows = all.filter((r) => r.rule === 'fast');
  assert.deepEqual(rows.map((r) => `${r.at} ${r.step}@${r.person}:${r.level}`), [
    '6.10 10:00 now@ofir:ring',
    '6.10 10:10 late@ofir:ring',
    '6.10 10:15 lior@lior:ring',
    '6.10 10:25 again.1@ofir:ring',
    '6.10 10:35 again.2@ofir:ring',
    '6.10 10:45 again.3@ofir:ring',
    '6.10 10:55 again.4@ofir:ring',
  ]);
  assert.equal(rows[1].title, 'באיחור: לעבור על הגרפיקות של אלפא ולאשר — עוד 5 דקות');
  assert.equal(rows[1].body, '9 הגרפיקות הראשונות. היעד היה 10:10. אם זה לא נסגר עד 10:15, ליאור מקבל הודעה.');
  assert.equal(rows[2].title, 'אופיר באיחור בבדיקת הגרפיקות: אלפא');
  assert.equal(rows[2].body, '9 הגרפיקות הראשונות · מחכה מ־היום 10:00 (15 דקות). אופיר מקבל תזכורת כל 10 דקות עד שיאשר או יחזיר לתיקון.');
  assert.equal(rows[3].title, 'עדיין באיחור: לעבור על הגרפיקות של אלפא ולאשר');
  assert.equal(rows[3].body, '9 הגרפיקות הראשונות · מחכה 25 דקות. ליאור עודכן. תזכורת כל 10 דקות עד שיאשר או יחזיר לתיקון.');
  // Every step keeps the ladder's own hours and is never folded into the 08:30 digest.
  for (const r of rows) assert.deepEqual([r.ownHours, r.noFold, r.url], [true, true, `qa.html#review-${c.id}-p07`], r.step);
  // Irit hears nothing of the check; neither the generic ladder nor the note of the rule `late` adds a word.
  assert.deepEqual(all.filter((r) => r.person === 'irit' && /גרפיקות/.test(r.title)), []);
  assert.deepEqual(all.filter((r) => /^late/.test(r.rule) && / 7 · /.test(`${r.title} ${r.body}`)), []);
  // The next day: no 09:00 or 14:00 reminder about it, no "manager after a business day"; his ring goes on every 10 minutes.
  // (Wednesday morning; the evening before is walked too, so the log is what the engine's would be.)
  walk(w, IL(2026, 10, 6, 11, 1), IL(2026, 10, 7, 8, 29), log);
  const next = walk(w, IL(2026, 10, 7, 8, 30), IL(2026, 10, 7, 14, 5), log).filter((r) => / 7 · /.test(`${r.title} ${r.body}`) || r.rule === 'fast');
  assert.ok(next.every((r) => r.rule === 'fast' && r.person === 'ofir' && /^again\./.test(r.step)), JSON.stringify(next.filter((r) => r.rule !== 'fast').map((r) => `${r.at} ${r.rule}.${r.step}@${r.person}`)));
  assert.deepEqual(next.slice(0, 3).map((r) => r.at), ['7.10 08:35', '7.10 08:45', '7.10 08:55']);
  // He approves: everything stops.
  marks(w, c, REVIEW_KEYS('p07'), IL(2026, 10, 7, 9, 12));
  assert.deepEqual(fastOf(due(w, IL(2026, 10, 7, 9, 25))), []);
});

test('the rest of the graphics (23) are on the same ladder; returned for fixes it stops, and Ilai\'s hand-over after the fix opens a fresh 10 minutes', () => {
  const { w, c } = shot();
  closeDay(w, c, IL(2026, 10, 15, 17));
  for (const k of ['p22a.drive', 'p22a.load', 'p22a.assigned', 'p22a.irit']) mark(w, c, k, IL(2026, 10, 15, 17, 5));
  c.editor = 'nadia';
  mark(w, c, 'p23.made', IL(2026, 10, 18, 11, 0)); // Sunday 11:00
  const first = walk(w, IL(2026, 10, 18, 11, 0), IL(2026, 10, 18, 11, 16)).filter((r) => r.rule === 'fast');
  assert.deepEqual(first.map((r) => `${r.at} ${r.step}@${r.person}`), ['18.10 11:00 now@ofir', '18.10 11:10 late@ofir', '18.10 11:15 lior@lior']);
  assert.equal(first[0].title, 'יתרת הגרפיקות מוכנה לבדיקה: בטא');
  assert.equal(first[2].title, 'אופיר באיחור בבדיקת הגרפיקות: בטא');
  assert.match(first[2].body, /^יתרת הגרפיקות · מחכה מ־היום 11:00 \(15 דקות\)\./);
  // He returns it at 11:18 with one thing to fix: his ladder stops, Ilai is rung, and the deadline is the fix's own.
  mark(w, c, returnKey('', 'graphics', 1), IL(2026, 10, 18, 11, 18), returnNote([{ ref: '4', text: 'לוגו ישן' }], IL(2026, 10, 18, 18)));
  const back = due(w, IL(2026, 10, 18, 11, 19));
  assert.deepEqual(fastOf(back.filter((r) => r.step !== 'now' && r.step !== 'late' && r.step !== 'lior')), []);
  assert.deepEqual(casesAt(w, IL(2026, 10, 18, 11, 19)), []);
  assert.deepEqual(back.filter((r) => r.rule === 'qaReturn').map((r) => [r.step, r.person, r.title]), [['now', 'ilai', 'הוחזר לתיקון (סבב 1): בטא']]);
  assert.equal(hhmm(proc(w, c, 'p23', IL(2026, 10, 18, 11, 19)).dueAt), '18.10 18:00');
  assert.deepEqual(qaFixing({ clients: w.clients, stateOf: (x) => stateOf(w, x, IL(2026, 10, 18, 12)), checks: w.checks }).map((x) => [x.kind, x.who]), [['graphics', 'ilai']]);
  // While it is with Ilai nothing rings Ofir, and once the fix is late it is Ilai's lateness, not Ofir's.
  assert.deepEqual(fastOf(walk(w, IL(2026, 10, 18, 11, 20), IL(2026, 10, 18, 12, 0))), []);
  const lateFix = lateAt(w, IL(2026, 10, 19, 10)).find((x) => x.num === '23');
  assert.deepEqual([lateFix.holders, lateFix.waiters.includes('ofir'), lateFix.fast], [['ilai'], true, false]);
  // Ilai marks the fix at 14:30: a new check, a fresh 10 minutes, its own ring.
  mark(w, c, fixedKey('', 'graphics', 1), IL(2026, 10, 18, 14, 30));
  const [f] = casesAt(w, IL(2026, 10, 18, 14, 31));
  assert.deepEqual([hhmm(f.t0), hhmm(f.dueAt), f.round], ['18.10 14:30', '18.10 14:40', 2]);
  assert.equal(hhmm(proc(w, c, 'p23', IL(2026, 10, 18, 14, 31)).dueAt), '18.10 14:40');
  const again = walk(w, IL(2026, 10, 18, 14, 30), IL(2026, 10, 18, 14, 41)).filter((r) => r.rule === 'fast');
  assert.deepEqual(again.map((r) => `${r.at} ${r.step}@${r.person}`), ['18.10 14:30 now@ofir', '18.10 14:40 late@ofir']);
  assert.equal(again[0].title, 'התיקונים מוכנים לבדיקה (סבב 1): יתרת הגרפיקות · בטא');
  // He approves: Irit is rung to send, as before.
  marks(w, c, REVIEW_KEYS('p23'), IL(2026, 10, 18, 14, 45));
  const ok = due(w, IL(2026, 10, 18, 14, 45));
  assert.deepEqual(ok.filter((r) => r.rule === 'graphicsRest').map((r) => [r.step, r.person]), [['irit', 'irit']]);
  assert.deepEqual(casesAt(w, IL(2026, 10, 18, 14, 46)), []);
});

test('a mistake in the first 9 graphics goes back to Ilai by the same path as the rest (7 has it too)', () => {
  const { w, c } = afterMeeting();
  mark(w, c, 'p07.made', IL(2026, 10, 6, 10, 0));
  mark(w, c, returnKey('', 'graphics9', 1), IL(2026, 10, 6, 10, 6), returnNote([{ ref: '3', text: 'טלפון שגוי' }, { ref: '7', text: 'שגיאת כתיב' }], IL(2026, 10, 6, 13)));
  assert.equal(returnKey('', 'graphics9', 1), 'p07.return.1');
  const q = qaState(w.checks[c.id], '', 'graphics9');
  assert.deepEqual([q.stage, q.open.n, q.open.issues.length], ['fixing', 1, 2]);
  const at = due(w, IL(2026, 10, 6, 10, 7));
  const ring = at.find((r) => r.rule === 'qaReturn');
  assert.deepEqual([ring.person, ring.level, ring.title], ['ilai', 'ring', 'הוחזר לתיקון (סבב 1): אלפא']);
  assert.match(ring.body, /^9 הגרפיקות הראשונות: 2 בעיות מאופיר\. לתקן עד היום 13:00\.$/);
  // Returned inside his ten minutes: no lateness ring ever went out.
  assert.deepEqual(walk(w, IL(2026, 10, 6, 10, 7), IL(2026, 10, 6, 10, 30)).filter((r) => r.rule === 'fast'), []);
  // Ilai, who is not of the office, may mark "תוקן" on it and nothing else of the check (the writers table, v9).
  const ilai = (key) => mayWrite({ person: 'ilai', client: { editor: null, rounds: [] }, key });
  assert.deepEqual([ilai('p07.fixed.1'), ilai('p07.fixed.1.0'), ilai('p07.return.1'), ilai('p07.ofir'), ilai('p07.r.logo'), ilai('p07.made')], [true, true, false, false, false, true]);
  assert.deepEqual(writerRows().filter((r) => r.proc === 'p07').map((r) => [r.key, r.persons]), [['p07.made', ['ilai']], ['p07.@wait', ['ilai', 'irit', 'ofir']], ['p07.@part', ['ilai', 'irit', 'ofir']], ['p07.@qafixed', ['ilai']]]);
  // Fixed at 11:30: back with Ofir, a fresh 10 minutes.
  mark(w, c, fixedKey('', 'graphics9', 1), IL(2026, 10, 6, 11, 30));
  assert.deepEqual(casesAt(w, IL(2026, 10, 6, 11, 31)).map((f) => [hhmm(f.t0), hhmm(f.dueAt), f.round]), [['6.10 11:30', '6.10 11:40', 2]]);
  assert.deepEqual(reviewClock(w.checks[c.id], 'p07.made', 'p07'), { t0: IL(2026, 10, 6, 11, 30), fixing: null });
  assert.equal(due(w, IL(2026, 10, 6, 11, 30)).find((r) => r.rule === 'fast').title, 'התיקונים מוכנים לבדיקה (סבב 1): 9 הגרפיקות הראשונות · אלפא');
  // In his queue (qa.html) it is one more piece of work, with the ladder's ten minutes.
  const queue = qaQueue({ clients: w.clients, stateOf: (x) => stateOf(w, x, IL(2026, 10, 6, 11, 33)), checks: w.checks, now: IL(2026, 10, 6, 11, 33) });
  assert.deepEqual(queue.map((x) => [x.kind, x.round, x.target, x.waited, x.late, hhmm(x.dueAt)]), [['graphics9', 2, 10, 3, false, '6.10 11:40']]);
});

// ── 3. The assignment ───────────────────────────────────────────────────────
test('the editor\'s assignment, ignored: a ring when the shoot day is closed, lateness at 10 minutes, Lior at 15, then Ofir every 10 minutes until he assigns', () => {
  const { w, c } = shot();
  closeDay(w, c, IL(2026, 10, 15, 17, 0)); // Thursday 17:00
  const [f] = casesAt(w, IL(2026, 10, 15, 17, 1));
  assert.deepEqual([f.kind, f.procId, hhmm(f.t0), hhmm(f.dueAt), hhmm(f.tellAt), f.url], ['assign', 'p22a', '15.10 17:00', '15.10 17:10', '15.10 17:15', assignUrl(c.id)]);
  const all = walk(w, IL(2026, 10, 15, 17, 0), IL(2026, 10, 15, 17, 46));
  const rows = all.filter((r) => r.rule === 'fast');
  assert.deepEqual(rows.map((r) => `${r.at} ${r.step}@${r.person}:${r.level}`), [
    '15.10 17:00 now@ofir:ring',
    '15.10 17:10 late@ofir:ring',
    '15.10 17:15 lior@lior:ring',
    '15.10 17:25 again.1@ofir:ring',
    '15.10 17:35 again.2@ofir:ring',
    '15.10 17:45 again.3@ofir:ring',
  ]);
  assert.equal(rows[0].title, 'לשייך עורך: בטא');
  assert.equal(rows[0].body, 'יום הצילום נסגר. 10 דקות לשייך, עד 17:10. בחלון השיוך מסומן העורך המומלץ לפי העומס.');
  assert.equal(rows[1].title, 'באיחור: לשייך עורך לבטא — עוד 5 דקות');
  assert.equal(rows[2].title, 'אופיר באיחור בשיוך עורך: בטא');
  assert.equal(rows[2].body, 'שיוך עורך · מחכה מ־היום 17:00 (15 דקות). אופיר מקבל תזכורת כל 10 דקות עד שישייך.');
  assert.equal(rows[3].title, 'עדיין באיחור: לשייך עורך לבטא');
  for (const r of rows) assert.equal(r.url, `qa.html#assign-${c.id}`);
  // Nothing else about the assignment, to anybody: no digest line, no 12:00 "hard stop", no note of the rule `late`.
  assert.deepEqual(all.filter((r) => r.rule !== 'fast' && (/עורך/.test(r.title) || /22א/.test(r.title))), []);
  // He assigns at 17:50: the ladder stops, and the editing clock starts from that minute (three business days).
  c.editor = 'anna';
  for (const k of ['p22a.drive', 'p22a.load', 'p22a.assigned', 'p22a.irit']) mark(w, c, k, IL(2026, 10, 15, 17, 50));
  assert.deepEqual(fastOf(due(w, IL(2026, 10, 15, 17, 55))), []);
  assert.equal(hhmm(proc(w, c, 'p24', IL(2026, 10, 15, 17, 55)).dueAt), '20.10 18:00');
  assert.ok(due(w, IL(2026, 10, 15, 17, 50)).some((r) => r.rule === 'editing' && r.step === 'assigned' && r.person === 'anna'));
});

test('a T0 at 20:55: one ring that evening, nothing after 21:00, at night or on the weekend; the count goes on the next working morning', () => {
  // The assignment: the shoot day is closed on Thursday 15.10 at 20:55.
  const { w, c } = shot();
  closeDay(w, c, IL(2026, 10, 15, 20, 55));
  const [f] = casesAt(w, IL(2026, 10, 15, 20, 56));
  assert.deepEqual([hhmm(f.dueAt), hhmm(f.tellAt)], ['18.10 08:35', '18.10 08:40']);
  const rows = walk(w, IL(2026, 10, 15, 20, 55), IL(2026, 10, 18, 9, 5)).filter((r) => r.rule === 'fast');
  assert.deepEqual(rows.map((r) => `${r.at} ${r.step}@${r.person}`), [
    '15.10 20:55 now@ofir',
    '18.10 08:35 late@ofir',
    '18.10 08:40 lior@lior',
    '18.10 08:50 again.1@ofir',
    '18.10 09:00 again.2@ofir',
  ]);
  // The countdown says so: paused at 21:00 with five minutes left, until Sunday 08:30.
  const night = ladderAt(f, IL(2026, 10, 15, 22, 0));
  assert.deepEqual([night.phase, night.remaining / 6e4, night.paused, hhmm(night.resumeAt)], ['run', 5, true, '18.10 08:30']);
  // It is not late on Friday, Saturday or before the count ends on Sunday; from 08:35 it is.
  for (const t of [IL(2026, 10, 16, 10), IL(2026, 10, 17, 22), IL(2026, 10, 18, 8, 34)]) assert.notEqual(proc(w, c, 'p22a', t).status, 'overdue', hhmm(t));
  assert.equal(proc(w, c, 'p22a', IL(2026, 10, 18, 8, 36)).status, 'overdue');
  // The graphics the same: handed over on Monday 12.10 at 20:55.
  const g = afterMeeting();
  mark(g.w, g.c, 'p07.made', IL(2026, 10, 12, 20, 55));
  const gr = walk(g.w, IL(2026, 10, 12, 20, 55), IL(2026, 10, 13, 8, 51)).filter((r) => r.rule === 'fast');
  assert.deepEqual(gr.map((r) => `${r.at} ${r.step}@${r.person}`), ['12.10 20:55 now@ofir', '13.10 08:35 late@ofir', '13.10 08:40 lior@lior', '13.10 08:50 again.1@ofir']);
  // Handed over at 23:00 (Ilai worked late): the first ring is at 08:30, and the ten minutes start there.
  const n = afterMeeting();
  mark(n.w, n.c, 'p07.made', IL(2026, 10, 12, 23, 0));
  const nr = walk(n.w, IL(2026, 10, 12, 23, 0), IL(2026, 10, 13, 8, 46)).filter((r) => r.rule === 'fast');
  assert.deepEqual(nr.map((r) => `${r.at} ${r.step}@${r.person}`), ['13.10 08:30 now@ofir', '13.10 08:40 late@ofir', '13.10 08:45 lior@lior']);
});

// ── 4. Instead of the ladder of a late item ─────────────────────────────────
test('it counts as Ofir\'s lateness from T0 + 10 (the "באיחור" tab and the owners\' 19:00 table), and no other ladder rings for it', () => {
  const { w, c } = afterMeeting();
  mark(w, c, 'p07.made', IL(2026, 10, 6, 10, 0));
  const b = shot(w);
  closeDay(w, b.c, IL(2026, 10, 6, 10, 0));
  const seven = (now) => lateAt(w, now).find((x) => x.cid === c.id && x.num === '7');
  const assign = (now) => lateAt(w, now).find((x) => x.cid === b.c.id && x.num === '22א');
  // Before the ten minutes passed: not late.
  assert.deepEqual([seven(IL(2026, 10, 6, 10, 9)), assign(IL(2026, 10, 6, 10, 9))], [undefined, undefined]);
  // From 10:10: his, and his alone. Lior's "the drive came back" is not Lior's lateness on Ofir's ten minutes.
  for (const x of [seven(IL(2026, 10, 6, 10, 11)), assign(IL(2026, 10, 6, 10, 11))]) assert.deepEqual([x.holders, x.fast, x.ownLadder, hhmm(x.dueAt)], [['ofir'], true, true, '6.10 10:10']);
  assert.ok(assign(IL(2026, 10, 6, 10, 11)).waiters.includes('lior'));
  const now = IL(2026, 10, 6, 19, 0);
  const held = heldLate(lateAt(w, now), 'ofir', now).map((x) => x.num).sort();
  assert.deepEqual(held, ['22א', '7']);
  for (const p of ['irit', 'lior', 'ilai']) assert.deepEqual(heldLate(lateAt(w, now), p, now).filter((x) => ['7', '22א'].includes(x.num)), [], p);
  const sum = daySummary({ clients: w.clients, checksOf: (x) => w.checks[x.id] || {}, stateOf: (x) => stateOf(w, x, now), tasks: [], personOf: () => null, now });
  assert.equal(JSON.stringify(sum).includes('"ofir"'), true);
  // The whole day and the next: nothing of lateOwn, lateNag or late about these two.
  const about = (r) => (r.clientId === c.id && / 7 · /.test(`${r.title} ${r.body}`)) || (r.clientId === b.c.id && /22א/.test(`${r.title} ${r.body}`));
  const env = buildEnv({ ...w, now: IL(2026, 10, 7, 14, 0) });
  assert.deepEqual(candidates(env).filter((r) => /^late/.test(r.rule) && (about(r) || (r.rule === 'lateNag' && r.person === 'ofir' && /(אלפא · 7 ·|22א)/.test(`${r.title} ${r.body}`)))), []);
});

// ── 5. The sending hours, and Lior on a shoot day ───────────────────────────
test('the general 19:00 end of the sending hours does not hold these rings; after 21:00 there is no step at all', () => {
  const { w, c } = shot();
  closeDay(w, c, IL(2026, 10, 15, 19, 30)); // after the sending hours of every other rule
  const at = (now) => planDelivery({ reminders: due(w, now).filter((r) => r.clientId === c.id), now, liorShoot: buildEnv({ ...w, now }).liorShoot });
  const first = at(IL(2026, 10, 15, 19, 30)).filter((r) => r.rule === 'fast');
  assert.deepEqual(first.map((r) => [r.step, r.person, r.channel, r.status, r.reason]), [['now', 'ofir', 'push', 'sent', null]]);
  const late = at(IL(2026, 10, 15, 19, 45)).filter((r) => r.rule === 'fast');
  assert.deepEqual(late.map((r) => [r.step, r.person, r.channel]), [['now', 'ofir', 'push'], ['late', 'ofir', 'push'], ['lior', 'lior', 'push']]);
  // A ring of any other rule at that hour waits for the morning, as before.
  const other = planDelivery({ reminders: [{ key: 'x', rule: 'graphicsRest', step: 'irit', person: 'irit', level: 'ring', at: IL(2026, 10, 15, 19, 30), ownHours: false }], now: IL(2026, 10, 15, 19, 30) });
  assert.deepEqual([other[0].channel, other[0].status, other[0].reason], ['digest', 'queued', 'quiet_hours']);
  // 21:00 and on, Friday, Saturday: the rule gives no step, so nothing can go out (not even late).
  for (const t of [IL(2026, 10, 15, 21, 0), IL(2026, 10, 15, 23, 30), IL(2026, 10, 16, 11), IL(2026, 10, 17, 20)]) assert.deepEqual(fastOf(due(w, t)), [], hhmm(t));
  // Erev chag: until the office closes (13:00), not until 21:00.
  const e = shot();
  e.c.shoot_at = IL(2027, 4, 21, 9).toISOString();
  closeDay(e.w, e.c, IL(2027, 4, 21, 12, 40));
  assert.deepEqual(fastOf(due(e.w, IL(2027, 4, 21, 12, 56))), ['late@ofir', 'lior@lior', 'now@ofir']);
  assert.deepEqual(fastOf(due(e.w, IL(2027, 4, 21, 13, 0))), []);
  assert.deepEqual(fastOf(due(e.w, IL(2027, 4, 21, 15, 0))), []);
});

test('Lior on a shoot day: "אופיר באיחור" goes to the owners at that moment; Lior hears after the shoot only if it is still open', () => {
  const { w, c } = afterMeeting();
  // Another client is being shot today (Tuesday 6.10), and Eli marked "הגעתי": Lior is on the shoot.
  const s = client(w, { name: 'מצטלם', shoot_at: IL(2026, 10, 6, 10).toISOString(), char_at: IL(2026, 9, 20, 10).toISOString() });
  importTo(w, s, 'shoot');
  for (const id of ['p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p21']) for (const i of PROCESSES.find((p) => p.id === id).items) delete w.checks[s.id][i.key];
  mark(w, s, 'p17b.arrived', IL(2026, 10, 6, 9, 30));
  mark(w, c, 'p07.made', IL(2026, 10, 6, 11, 0));
  assert.equal(buildEnv({ ...w, now: IL(2026, 10, 6, 11, 15) }).liorShoot.active, true);
  const told = due(w, IL(2026, 10, 6, 11, 15)).filter((r) => r.rule === 'fast' && r.step === 'lior');
  assert.deepEqual(told.map((r) => [r.person, r.level, r.title]), [['owner', 'ring', 'אופיר באיחור בבדיקת הגרפיקות: אלפא']]);
  // It is pushed to the owners (not held for Lior's summary, not sent to Ofir about himself).
  const [sent] = planDelivery({ reminders: told, now: IL(2026, 10, 6, 11, 15), liorShoot: buildEnv({ ...w, now: IL(2026, 10, 6, 11, 15) }).liorShoot });
  assert.deepEqual([sent.person, sent.channel, sent.status], ['owner', 'push', 'sent']);
  // Ofir keeps getting his own rings meanwhile.
  assert.deepEqual(fastOf(due(w, IL(2026, 10, 6, 11, 25))).filter((x) => x.endsWith('@ofir')), ['again.1@ofir', 'late@ofir', 'now@ofir']);
  // The shoot day is closed at 12:00 and the graphics are still not approved: Lior is told now.
  const log = told.map((r) => ({ key: r.key }));
  marks(w, s, itemsOf('p19'), IL(2026, 10, 6, 12, 0));
  const after = due(w, IL(2026, 10, 6, 12, 1), log).filter((r) => r.rule === 'fast' && r.step === 'lior');
  assert.deepEqual(after.map((r) => r.person), ['lior']);
  // Approved before the shoot ended: nothing more to anybody.
  marks(w, c, REVIEW_KEYS('p07'), IL(2026, 10, 6, 11, 50));
  assert.deepEqual(due(w, IL(2026, 10, 6, 12, 1), log).filter((r) => r.rule === 'fast' && r.clientId === c.id), []);
});

// ── 6. Landing, imported history, activation ────────────────────────────────
test('a client in landing: its check and its assignment are never on the ladder, never rung and never counted', () => {
  const w = world();
  const c = client(w, { name: 'קליטה', landing: true, protocol_version: 7, char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 12, 10).toISOString() });
  marks(w, c, itemsOf('p04'), IL(2026, 10, 5, 12));
  mark(w, c, 'p07.made', IL(2026, 10, 6, 10));
  marks(w, c, itemsOf('p19'), IL(2026, 10, 12, 17));
  mark(w, c, 'p23.made', IL(2026, 10, 13, 10));
  for (const now of [IL(2026, 10, 6, 10, 0), IL(2026, 10, 6, 10, 15), IL(2026, 10, 12, 17, 15), IL(2026, 10, 13, 10, 20), IL(2026, 10, 14, 9, 0)]) {
    assert.deepEqual(casesAt(w, now), [], hhmm(now));
    // (The server does not even load a client in landing; here the rules themselves are asked.)
    assert.deepEqual(due(w, now).filter((r) => r.clientId === c.id && ['fast', 'graphics9', 'graphicsRest', 'clientLink', 'qaReturn', 'late', 'lateOwn', 'lateNag', 'editing'].includes(r.rule)), [], hhmm(now));
    assert.deepEqual(lateAt(w, now), []);
    assert.deepEqual(clocksFor('ofir', w.clients, w.checks, { now }), []);
    for (const p of ['ofir', 'irit', 'lior', 'ilai']) assert.deepEqual(mine(w, c, p, now), [], p);
  }
  // It stays what it was: a quiet counted line on Ofir's list, to his queue.
  const now = IL(2026, 10, 13, 11);
  const lines = (me) => flowLines({ viewer: { me, scope: 'office' }, clients: w.clients, checks: w.checks, stateOf: (x) => stateOf(w, x, now), tasks: [], now }).map((l) => [l.id, l.bucket, l.rule]);
  assert.deepEqual(lines('ofir'), [['landing-assign', 'landing', null], ['landing-qa', 'landing', null]]);
  assert.deepEqual(lines('lior').filter(([id]) => /assign|qa/.test(id)), []);
});

test('imported history starts no ladder and reopens nothing: graphics that came in as made, a shoot day that came in as closed', () => {
  // Imported at "עריכה ובקרה": 7 and 19 carry "ייבוא"; the rest of the graphics and the assignment are open work.
  const w = world();
  const c = client(w, { name: 'מיובא', shoot_at: IL(2026, 9, 20, 10).toISOString(), char_at: IL(2026, 9, 10, 10).toISOString() });
  importTo(w, c, 'post');
  for (const now of [IL(2026, 10, 6, 10), IL(2026, 10, 6, 14), IL(2026, 10, 7, 9)]) {
    assert.deepEqual(casesAt(w, now), [], hhmm(now));
    assert.deepEqual(fastOf(due(w, now)), [], hhmm(now));
    const p07 = proc(w, c, 'p07', now);
    assert.deepEqual([p07.complete, mine(w, c, 'ofir', now).filter((k) => k.startsWith('p07.'))], [true, []]);
  }
  // A client of version 8 that was imported before the new item existed: its history has no "p07.ofir" mark,
  // and nobody is asked for one (the item is "אם רלוונטי" there, as every new item of imported history).
  const old = client(w, { name: 'מיובא ישן', protocol_version: 8, shoot_at: IL(2026, 9, 20, 10).toISOString(), char_at: IL(2026, 9, 10, 10).toISOString() });
  marks(w, old, importKeys('post').filter((k) => k !== 'p07.ofir'), IL(2026, 9, 1, 9), IMPORT_NOTE);
  const now = IL(2026, 10, 6, 10);
  const p07 = proc(w, old, 'p07', now);
  assert.deepEqual([p07.complete, p07.proc.items.find((i) => i.key === 'p07.ofir').optional, p07.proc.items.find((i) => i.key === 'p07.ofir').history], [true, true, true]);
  assert.deepEqual(mine(w, old, 'ofir', now).filter((k) => k.startsWith('p07.')), []);
  assert.deepEqual(casesAt(w, now).filter((f) => f.cid === old.id && f.procId === 'p07'), []);
  // A new import (version 9) writes the new item with the rest of the history.
  assert.ok(importKeys('content').includes('p07.ofir'));
});

test('a client activated out of landing with a check or an assignment already waiting: the gentle deadline of the activation and the usual ladder, never the ten minutes', () => {
  const w = world();
  const landed = IL(2026, 10, 12, 9, 0); // activated on Monday 12.10 at 09:00
  const c = client(w, { name: 'הופעל', protocol_version: 7, landing: false, landed_at: landed.toISOString(), landing_slot: 0, char_at: IL(2026, 9, 10, 10).toISOString(), shoot_at: IL(2026, 10, 1, 10).toISOString() });
  importTo(w, c, 'char');
  marks(w, c, itemsOf('p04'), IL(2026, 9, 10, 12), IMPORT_NOTE);
  mark(w, c, 'p07.made', IL(2026, 10, 8, 10)); // handed over while the client was still in landing
  const now = IL(2026, 10, 12, 9, 5);
  assert.deepEqual(casesAt(w, now), []);
  assert.deepEqual(fastOf(due(w, now)), []);
  // The work is Ofir's (the owner of the check is not a matter of version), due by the end of the next business day.
  assert.equal(mine(w, c, 'ofir', now).filter((k) => k.startsWith('p07.r.')).length, 7);
  assert.equal(hhmm(proc(w, c, 'p07', now).dueAt), '13.10 18:00');
  // Work that reaches him after the activation is on the ladder like any other client's.
  mark(w, c, returnKey('', 'graphics9', 1), IL(2026, 10, 12, 10), returnNote([{ ref: '1', text: 'x' }], IL(2026, 10, 12, 16)));
  mark(w, c, fixedKey('', 'graphics9', 1), IL(2026, 10, 12, 11));
  assert.deepEqual(casesAt(w, IL(2026, 10, 12, 11, 1)).map((f) => [hhmm(f.t0), hhmm(f.dueAt)]), [['12.10 11:00', '12.10 11:10']]);
});

// ── 7. The clients that were already there ──────────────────────────────────
test('existing clients, case by case: what was sent or fully checked is not reopened; a check under way passes to Ofir with a fresh clock; the owners do not depend on the version', () => {
  const at = IL(2026, 10, 11, 10, 0); // the migration runs on Sunday 11.10 at 10:00
  const now = IL(2026, 10, 11, 10, 1);
  const base = (name, v = 8) => { const { w, c } = afterMeeting(world(), { name, protocol_version: v }); return { w, c }; };

  // a. The graphics were already sent to the client (before the approval item existed). Even with no mark
  //    from the migration the item is not asked: it stands before a step that was already taken.
  const a = base('נשלח');
  mark(a.w, a.c, 'p07.made', IL(2026, 10, 6, 10));
  marks(a.w, a.c, itemsOf('p07').filter((k) => k.startsWith('p07.r.')), IL(2026, 10, 6, 11));
  mark(a.w, a.c, 'p07.sent', IL(2026, 10, 6, 11, 5));
  mark(a.w, a.c, 'p07.approved', IL(2026, 10, 6, 15));
  assert.equal(proc(a.w, a.c, 'p07', now).complete, true);
  assert.deepEqual([casesAt(a.w, now), mine(a.w, a.c, 'ofir', now).filter((k) => k.startsWith('p07.'))], [[], []]);
  // And with the migration's mark (history): the same.
  mark(a.w, a.c, 'p07.ofir', at, IMPORT_NOTE);
  assert.equal(proc(a.w, a.c, 'p07', now).complete, true);
  assert.deepEqual(due(a.w, now).filter((r) => r.clientId === a.c.id && ['fast', 'graphics9', 'clientLink'].includes(r.rule)), []);

  // b. Irit ticked all seven under version 8 and has not sent yet: the migration writes the approval as
  //    history. Ofir is not asked to check again; the sending is on her list, with two office hours from now.
  const b = base('נבדק');
  mark(b.w, b.c, 'p07.made', IL(2026, 10, 8, 16));
  marks(b.w, b.c, itemsOf('p07').filter((k) => k.startsWith('p07.r.')), IL(2026, 10, 8, 17));
  mark(b.w, b.c, 'p07a.sent', IL(2026, 10, 8, 16, 10)); // she sent the status link when it opened, under version 8
  mark(b.w, b.c, 'p07.ofir', at, IMPORT_NOTE);
  assert.deepEqual([casesAt(b.w, now), mine(b.w, b.c, 'ofir', now).filter((k) => k.startsWith('p07.'))], [[], []]);
  assert.deepEqual(mine(b.w, b.c, 'irit', now).filter((k) => k.startsWith('p07.')), ['p07.sent']);
  assert.equal(hhmm(proc(b.w, b.c, 'p07', now).dueAt), '11.10 12:00');
  // No ring pretends that Ofir approved something just now.
  assert.deepEqual(due(b.w, now).filter((r) => r.clientId === b.c.id && ['fast', 'graphics9', 'clientLink'].includes(r.rule)), []);

  // c. Ready, and nothing ticked: it passes to Ofir, and the migration's mark gives him ten minutes from
  //    that moment, not from Thursday afternoon.
  const c3 = base('מחכה');
  mark(c3.w, c3.c, 'p07.made', IL(2026, 10, 8, 16));
  mark(c3.w, c3.c, 'p07.moved', at, 'גרסה 9: הבדיקה עברה לאופיר');
  assert.deepEqual(casesAt(c3.w, now).map((f) => [hhmm(f.t0), hhmm(f.dueAt)]), [['11.10 10:00', '11.10 10:10']]);
  assert.equal(hhmm(proc(c3.w, c3.c, 'p07', now).dueAt), '11.10 10:10');
  assert.deepEqual(fastOf(due(c3.w, now)), ['now@ofir']);
  assert.deepEqual(mine(c3.w, c3.c, 'irit', now).filter((k) => k.startsWith('p07.')), []);
  assert.equal(mine(c3.w, c3.c, 'ofir', now).filter((k) => k.startsWith('p07.r.')).length, 7);
  // (Without that mark he would have been "late since Thursday" in his first minute: that is what it is for.)
  delete c3.w.checks[c3.c.id]['p07.moved'];
  assert.equal(hhmm(casesAt(c3.w, now)[0].dueAt), '8.10 16:10');

  // d. Some of the seven ticked by Irit: what she ticked stays, the rest and the approval are Ofir's, with the same fresh clock.
  const d = base('חלקי');
  mark(d.w, d.c, 'p07.made', IL(2026, 10, 8, 16));
  marks(d.w, d.c, ['p07.r.spelling', 'p07.r.phone', 'p07.r.address'], IL(2026, 10, 8, 16, 30));
  mark(d.w, d.c, 'p07.moved', at, 'גרסה 9: הבדיקה עברה לאופיר');
  assert.deepEqual(mine(d.w, d.c, 'ofir', now).filter((k) => k.startsWith('p07.')).sort(), ['p07.r.design', 'p07.r.details', 'p07.r.logo', 'p07.r.wording']);
  assert.equal(hhmm(casesAt(d.w, now)[0].dueAt), '11.10 10:10');

  // e. A client of an older version that reaches the check after the change: the approval is asked of it as
  //    of everybody (it is not "חדש בפרוטוקול"), on the same ladder, with the same ten minutes.
  const e = base('ישן', 7);
  mark(e.w, e.c, 'p07.made', IL(2026, 10, 12, 10));
  const s = proc(e.w, e.c, 'p07', IL(2026, 10, 12, 10, 1));
  const ok = s.proc.items.find((i) => i.key === 'p07.ofir');
  assert.deepEqual([ok.fresh, ok.optional, hhmm(s.dueAt)], [undefined, undefined, '12.10 10:10']);
  assert.equal(proc(e.w, e.c, 'p07', IL(2026, 10, 12, 10, 11)).status, 'overdue');
  assert.deepEqual(fastOf(due(e.w, IL(2026, 10, 12, 10, 15))), ['late@ofir', 'lior@lior', 'now@ofir']);

  // f. An assignment the server made before the change stays as it is: 22א is complete, nothing rings.
  const f = shot(world(), { name: 'שויך', protocol_version: 8, editor: 'nadia' });
  closeDay(f.w, f.c, IL(2026, 10, 8, 17));
  for (const k of ['p22a.drive', 'p22a.load', 'p22a.assigned', 'p22a.irit']) mark(f.w, f.c, k, IL(2026, 10, 8, 17, 1), 'שויך אוטומטית בסיום יום הצילום');
  assert.equal(proc(f.w, f.c, 'p22a', now).complete, true);
  assert.deepEqual(fastOf(due(f.w, now)), []);
  // g. An assignment Lior had taken ("אני על זה") and not made yet: it is Ofir's now, on the ladder.
  const g = shot(world(), { name: 'נלקח', protocol_version: 8 });
  closeDay(g.w, g.c, IL(2026, 10, 11, 9, 55));
  mark(g.w, g.c, 'p22a.claim', IL(2026, 10, 11, 9, 56), 'lior');
  assert.deepEqual(mine(g.w, g.c, 'lior', now).filter((k) => k.startsWith('p22a.')), ['p22a.drive']);
  assert.ok(mine(g.w, g.c, 'ofir', now).includes('p22a.load'));
  assert.deepEqual(casesAt(g.w, now).map((x) => [x.kind, hhmm(x.dueAt)]), [['assign', '11.10 10:05']]);
});

// ── 8. What the screens read ────────────────────────────────────────────────
test('the countdown on Ofir\'s "המשימות שלי": "נשארו", then "באיחור · עוד", then "באיחור · ליאור עודכן"; a button to the place; nobody else gets the clock', () => {
  const { w, c } = afterMeeting();
  mark(w, c, 'p07.made', IL(2026, 10, 6, 10, 0));
  const b = shot(w);
  closeDay(w, b.c, IL(2026, 10, 6, 10, 2));
  const clocks = (person, now) => clocksFor(person, w.clients, w.checks, { now }).filter((k) => ['p07', 'p22a'].includes(k.proc.id));
  const run = clocks('ofir', IL(2026, 10, 6, 10, 2, 48));
  assert.deepEqual(run.map((k) => [k.kind, k.proc.id, k.state, k.phase, Math.round(k.remaining / 1000), k.url]), [
    ['fast', 'p07', 'running', 'run', 432, `qa.html#review-${c.id}-p07`], // 7:12 left
    ['fast', 'p22a', 'running', 'run', 552, `qa.html#assign-${b.c.id}`],
  ]);
  const [f7] = casesAt(w, IL(2026, 10, 6, 10, 3)).filter((f) => f.procId === 'p07');
  assert.equal(ladderWords(f7, IL(2026, 10, 6, 10, 2, 48)), 'נשארו 8 דק׳');
  const late = clocks('ofir', IL(2026, 10, 6, 10, 10, 50)).find((k) => k.proc.id === 'p07');
  assert.deepEqual([late.state, late.phase, Math.round(late.more / 1000)], ['expired', 'late', 250]); // 4:10 of the extra five
  assert.equal(ladderWords(f7, IL(2026, 10, 6, 10, 10, 50)), 'באיחור · עוד 5 דק׳');
  const told = clocks('ofir', IL(2026, 10, 6, 10, 20)).find((k) => k.proc.id === 'p07');
  assert.deepEqual([told.state, told.phase], ['expired', 'told']);
  assert.equal(ladderWords(f7, IL(2026, 10, 6, 10, 20)), 'באיחור · ליאור עודכן');
  // Late ones first; the row stays until it is done (also the next day).
  assert.deepEqual(clocks('ofir', IL(2026, 10, 7, 12)).map((k) => k.phase), ['told', 'told']);
  // Nobody else has these clocks: not Lior (whose only item of 22א is the drive), not Irit, not Ilai.
  for (const p of ['lior', 'irit', 'ilai']) assert.deepEqual(clocks(p, IL(2026, 10, 6, 10, 3)), [], p);
  // The owners' view of the team shows them, with whose they are.
  assert.deepEqual(clocks(null, IL(2026, 10, 6, 10, 3)).map((k) => [k.kind, k.people]), [['fast', ['ofir']], ['fast', ['ofir']]]);
  // Approved, assigned: gone.
  marks(w, c, REVIEW_KEYS('p07'), IL(2026, 10, 6, 10, 25));
  b.c.editor = 'yariv';
  for (const k of ['p22a.load', 'p22a.assigned']) mark(w, b.c, k, IL(2026, 10, 6, 10, 25));
  assert.deepEqual(clocks('ofir', IL(2026, 10, 6, 10, 26)), []);
});

test('who waits sees where it is: Ilai\'s card ("אצל אופיר לבדיקה · נשארו N דק׳") and one plain line for Irit ("מחכה לאישור של אופיר"); Lior has no line about the assignment', () => {
  const { w, c } = afterMeeting();
  mark(w, c, 'p07.made', IL(2026, 10, 7, 10, 0)); // two days after the meeting: Ilai's day card is gone
  const now = IL(2026, 10, 7, 10, 3);
  const st = (x) => stateOf(w, x, now);
  const [f] = casesAt(w, now);
  assert.equal(ladderWords(f, now, { waiting: true }), 'אצל אופיר לבדיקה · נשארו 7 דק׳');
  assert.equal(ladderWords(f, IL(2026, 10, 7, 10, 12), { waiting: true }), 'אצל אופיר לבדיקה · באיחור');
  // Ilai: the card of the first 9 stays while they are with Ofir.
  assert.deepEqual(ilaiWork({ clients: w.clients, stateOf: st, checks: w.checks, now }).first.map((x) => [x.client.id, x.qa.stage]), [[c.id, 'ofir']]);
  // Irit: one line, plain, with no reminder behind it, to the client's card.
  const irit = flowLines({ viewer: { me: 'irit', scope: 'office' }, clients: w.clients, checks: w.checks, stateOf: st, tasks: [], now }).filter((l) => l.waiting);
  assert.deepEqual(irit.map((l) => [l.id, l.text, l.tone, l.rule, l.href]), [[`waiting-ofir-${c.id}`, '9 הגרפיקות של אלפא: מחכה לאישור של אופיר (נשארו 7 דק׳)', 'plain', null, `client.html?id=${c.id}#p07`]]);
  // Nobody else gets that line, and it goes when he approved.
  for (const me of ['ofir', 'lior', 'ilai']) assert.deepEqual(flowLines({ viewer: { me, scope: 'office' }, clients: w.clients, checks: w.checks, stateOf: st, tasks: [], now }).filter((l) => l.waiting), [], me);
  marks(w, c, REVIEW_KEYS('p07'), IL(2026, 10, 7, 10, 5));
  const later = IL(2026, 10, 7, 10, 6);
  assert.deepEqual(flowLines({ viewer: { me: 'irit', scope: 'office' }, clients: w.clients, checks: w.checks, stateOf: (x) => stateOf(w, x, later), tasks: [], now: later }).filter((l) => l.waiting), []);
  assert.deepEqual(ilaiWork({ clients: w.clients, stateOf: (x) => stateOf(w, x, later), checks: w.checks, now: later }).first, []);
});

// ── 9. The numbers ──────────────────────────────────────────────────────────
test('performance: an assignment Lior took and closed before the change stays his; from now on 22א is Ofir\'s; the graphics\' returns of 7 count for Ilai', () => {
  const p22a = { ...PROCESSES.find((p) => p.id === 'p22a'), keyBase: 'p22a' };
  assert.deepEqual(creditedTo(p22a, {}), ['ofir']);
  assert.deepEqual(creditedTo(p22a, { 'p22a.claim': { state: 'done', note: 'lior', at: '2026-10-01T10:00:00Z' } }), ['lior']);
  const { w, c } = shot(world(), { protocol_version: 8, editor: 'nadia' });
  closeDay(w, c, IL(2026, 10, 5, 17));
  mark(w, c, 'p22a.claim', IL(2026, 10, 5, 17, 1), 'lior');
  for (const k of ['p22a.drive', 'p22a.load', 'p22a.assigned', 'p22a.irit']) mark(w, c, k, IL(2026, 10, 5, 17, 5));
  const rep = performanceReport(w.clients, w.checks, { days: 30, now: IL(2026, 10, 11, 12) });
  const who = (p) => rep.people.find((x) => x.key === p)?.done || 0;
  // (Lior also closed the shoot day itself, 19, in that window: two of his, none of Ofir's.)
  assert.equal(rep.processes.find((x) => x.key === 'p22a').done, 1);
  assert.deepEqual([who('lior'), who('ofir')], [2, 0]);
  // The same assignment with no claim on it is the owner's of 22א today: Ofir's.
  delete w.checks[c.id]['p22a.claim'];
  const rep2 = performanceReport(w.clients, w.checks, { days: 30, now: IL(2026, 10, 11, 12) });
  assert.deepEqual(['lior', 'ofir'].map((p) => rep2.people.find((x) => x.key === p)?.done || 0), [1, 1]);
});
