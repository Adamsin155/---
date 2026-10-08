// The fixes the owner approved after the full-flow simulation (8.10.2026; docs/ops.md,
// section 49; protocol version 8). Fixed Israel times; npm test runs this under UTC, New
// York and Jerusalem.
//   5  the two links only Irit sends are steps of her list (5ב, 7א); process 5 does not
//      close on one network; each new step rings when it opens and is then a late item
//      like any other;
//   6  a review has its own clock from the moment the work arrives; the review of the 9
//      graphics is Irit's alone; 14 is a daily follow-up, one answer per client; the end
//      of a business day is 18:00;
//   7  a mark with nothing behind it is refused only when the system knows it is empty;
//   8  process 11 stays open while the shoot day has no date; the photographer's free days.
// And, for every new step: a client in landing stays quiet, and history that was brought
// in by an import (the note "ייבוא") is never opened again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders } from '../app/reminder-engine.js';
import { RULES } from '../app/reminder-rules.js';
import { lateItems } from '../app/late-chain.js';
import { PROCESSES, PROTOCOL_VERSION, STATIONS, NETWORKS } from '../app/protocol.js';
import {
  clientState, openItemsFor, bulkEligible, addBusinessDays, endOfBusinessDay, isDayEnd, IMPORT_NOTE, isResolved, stagesOf, fieldGap, applicableProcesses,
} from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';
import {
  followupRows, followupDue, followupLine, followupNote, readFollowup, followupText, followupTask, FOLLOWUP_KEY, FOLLOWUP_URL, TOPICS, shootPrep,
} from '../app/shoot-prep.js';
import { flowLines } from '../app/mine-flow.js';
import { guardVerdict, guardOf, ganttFacts, graphicsAsk, roundOfKey, REFUSALS } from '../app/mark-guards.js';
import { accessGapQuestion } from '../app/access-logic.js';
import { freeAhead } from '../app/availability-logic.js';
import { dateIL, partsIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' }, { email: 'nadia@x', person: 'nadia' }, { email: 'eli@x', person: 'eli' },
];
let seq = 0;
const world = () => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, deals: [] });
function client(w, o = {}) {
  seq += 1;
  const c = {
    id: `c${seq}`, name: o.name || `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
    rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 10, 4, 9).toISOString(), created_by_email: 'irit@x', ...o,
  };
  w.clients.push(c);
  return c;
}
const mark = (w, c, key, at, note = null, state = 'done') => { (w.checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state, note, at: at.toISOString(), by_email: 'x@x' }; };
const marks = (w, c, keys, at, note = null) => keys.forEach((k) => mark(w, c, k, at, note));
const itemsOf = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key);
const importTo = (w, c, station, at = IL(2026, 9, 1, 9)) => marks(w, c, importKeys(station), at, IMPORT_NOTE);
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const of = (list, rule, person = null) => list.filter((r) => r.rule === rule && (!person || r.person === person));
const stateOf = (w, c, now) => clientState(c, w.checks[c.id] || {}, now);
const proc = (w, c, id, now) => stateOf(w, c, now).states.find((s) => s.proc.id === id);
const mine = (w, c, person, now) => openItemsFor(person, c, w.checks[c.id] || {}, stateOf(w, c, now), now).map((e) => e.item.key);
const lateOf = (w, now) => lateItems({ clients: w.clients, checksOf: (c) => w.checks[c.id] || {}, stateOf: (c) => stateOf(w, c, now), tasks: w.tasks, personOf: (e) => STAFF.find((s) => s.email === e)?.person ?? null, now });

// A new client: the deal on Sunday 4.10.2026, the characterization on Monday 5.10 at 10:00,
// "the characterization ended" at 12:00. Everything before the meeting is done.
function afterMeeting(w = world(), o = {}) {
  const c = client(w, { name: 'אלפא', char_at: IL(2026, 10, 5, 10).toISOString(), ...o });
  for (const id of ['p01', 'p02', 'p03']) marks(w, c, itemsOf(id), IL(2026, 10, 4, 9, 3));
  marks(w, c, itemsOf('p04'), IL(2026, 10, 5, 12));
  return { w, c };
}

// ── The protocol itself ─────────────────────────────────────────────────────
test('version 8 as data: the two link steps are Irit\'s, in "אפיון"; the review of the first graphics is hers alone', () => {
  assert.equal(PROTOCOL_VERSION, 8);
  const byId = Object.fromEntries(PROCESSES.map((p) => [p.id, p]));
  assert.deepEqual([byId.p05b.owners, byId.p05b.link, byId.p05b.items.map((i) => i.key)], [['irit'], 'access', ['p05b.sent']]);
  assert.deepEqual([byId.p07a.owners, byId.p07a.link, byId.p07a.items.map((i) => i.key)], [['irit'], 'status', ['p07a.sent']]);
  const char = STATIONS.find((s) => s.key === 'char').procs;
  assert.deepEqual([char[char.indexOf('p05') + 1], char[char.indexOf('p07') + 1]], ['p05b', 'p07a']);
  // Every process id still fits the shape the database's writers table reads (pNN, pNNa, pNNb).
  for (const p of PROCESSES) assert.match(p.id, /^p\d+[ab]?$/, p.id);
  // One owner for the review; Lior owns nothing of process 7.
  for (const i of byId.p07.items) assert.ok(!(i.owners || byId.p07.owners).includes('lior'), i.key);
  for (const k of ['p07.r.spelling', 'p07.r.design', 'p07.sent', 'p07.approved']) assert.deepEqual(byId.p07.items.find((i) => i.key === k).owners, ['irit'], k);
  // The old keys are all there: nothing was renamed, the eight topics of 14 included.
  for (const t of TOPICS) assert.ok(byId.p14.items.some((i) => i.key === `p14.${t.key}` && i.optional && i.topic), t.key);
  assert.deepEqual([byId.p14.recurring, byId.p14.until, byId.p14.items[0].key], ['daily', 'shoot', 'p14.day']);
});

// ── FIX 5: the two links, and process 5 ─────────────────────────────────────
test('5ב opens for Irit when the characterization ends, with 30 office minutes; 7א when the 9 graphics are ready; each is marked by her', () => {
  const { w, c } = afterMeeting();
  // Before the meeting ended there is nothing of it.
  const before = world();
  const cb = client(before, { char_at: IL(2026, 10, 5, 10).toISOString() });
  assert.ok(!mine(before, cb, 'irit', IL(2026, 10, 5, 9)).includes('p05b.sent'));
  // From 12:00 it is on Irit's list, and nobody else's.
  const noon = IL(2026, 10, 5, 12, 1);
  assert.ok(mine(w, c, 'irit', noon).includes('p05b.sent'));
  for (const p of ['lior', 'ofir', 'ilai']) assert.ok(!mine(w, c, p, noon).includes('p05b.sent'), p);
  const s = proc(w, c, 'p05b', noon);
  assert.deepEqual([hhmm(s.startAt), hhmm(s.dueAt), s.status], ['5.10 12:00', '5.10 12:30', 'today']);
  // 7א: not before the graphics are ready; from that minute, 30 office minutes.
  assert.ok(!mine(w, c, 'irit', noon).includes('p07a.sent'));
  mark(w, c, 'p07.made', IL(2026, 10, 5, 13, 30));
  const s7 = proc(w, c, 'p07a', IL(2026, 10, 5, 13, 31));
  assert.deepEqual([hhmm(s7.startAt), hhmm(s7.dueAt)], ['5.10 13:30', '5.10 14:00']);
  assert.ok(mine(w, c, 'irit', IL(2026, 10, 5, 13, 31)).includes('p07a.sent'));
  // "סיימתי" closes each.
  mark(w, c, 'p05b.sent', IL(2026, 10, 5, 12, 10));
  mark(w, c, 'p07a.sent', IL(2026, 10, 5, 13, 40));
  assert.deepEqual([proc(w, c, 'p05b', IL(2026, 10, 5, 14)).complete, proc(w, c, 'p07a', IL(2026, 10, 5, 14)).complete], [true, true]);
});

test('each new step rings Irit when it opens, and from its deadline it is on the ladder of every late item', () => {
  const { w, c } = afterMeeting();
  assert.ok(RULES.some((r) => r.id === 'clientLink'));
  const open = of(due(w, IL(2026, 10, 5, 12, 0)), 'clientLink');
  assert.deepEqual(open.map((r) => [r.person, r.level, r.step]), [['irit', 'ring', 'now']]);
  assert.equal(open[0].title, 'לשלוח ללקוח קישור למילוי פרטי הכניסה לרשתות: אלפא');
  assert.match(open[0].body, /^מעתיקים את הקישור מהכרטיס ב״המשימות שלי״, שולחים ללקוח ומסמנים\. יעד היום 12:30\.$/);
  assert.equal(open[0].url, 'clients.html#mine');
  // Once only: the same step is not sent again.
  const log = open.map((r) => ({ key: r.key }));
  assert.deepEqual(of(due(w, IL(2026, 10, 5, 12, 5), log), 'clientLink'), []);
  // Past the deadline and the grace (12:30 + 15 office minutes): "באיחור" to Irit, the note to Ofir and Lior.
  const late = due(w, IL(2026, 10, 5, 12, 45)).filter((r) => / 5ב · /.test(r.title));
  assert.deepEqual(late.filter((r) => r.rule === 'lateOwn').map((r) => `${r.step}@${r.person}:${r.level}`), ['own@irit:ring']);
  assert.deepEqual(late.filter((r) => r.rule === 'late').map((r) => r.person).sort(), ['lior', 'ofir']);
  // And the reminder of the next morning, until it is marked.
  const nine = due(w, IL(2026, 10, 6, 9, 0)).filter((r) => r.rule === 'lateNag' && r.person === 'irit');
  assert.equal(nine.length, 1);
  assert.match(`${nine[0].title} ${nine[0].body}`, /5ב · קישור ללקוח למילוי פרטי הכניסה לרשתות/);
  mark(w, c, 'p05b.sent', IL(2026, 10, 6, 9, 30));
  assert.ok(!due(w, IL(2026, 10, 6, 14, 0)).some((r) => /5ב/.test(`${r.title} ${r.body}`)));
  // The status link: the same, from the minute the graphics are ready.
  mark(w, c, 'p07.made', IL(2026, 10, 6, 10));
  const st = of(due(w, IL(2026, 10, 6, 10)), 'clientLink');
  assert.deepEqual(st.map((r) => [r.person, r.title]), [['irit', 'לשלוח ללקוח קישור לדף הסטטוס: אלפא']]);
  assert.ok(due(w, IL(2026, 10, 6, 10, 45)).some((r) => r.rule === 'lateOwn' && r.person === 'irit' && / 7א · /.test(r.title)));
});

test('process 5 does not close on one network: it asks, names what was saved, and "אין עוד" closes it', () => {
  const { w, c } = afterMeeting();
  const noon = IL(2026, 10, 5, 12, 1);
  // The end of the characterization saved one login and marked "access received".
  mark(w, c, 'p05.access', IL(2026, 10, 5, 12), 'מסיום האפיון: Instagram');
  mark(w, c, 'p05.vault', IL(2026, 10, 5, 12), 'נכנס לכספת בסיום האפיון');
  for (const k of ['p05.logo', 'p05.colors', 'p05.photos', 'p05.videos']) mark(w, c, k, IL(2026, 10, 5, 12));
  const p5 = proc(w, c, 'p05', noon);
  assert.equal(p5.complete, false);
  assert.ok(mine(w, c, 'ofir', noon).includes('p05.allnets'), 'whoever took the access is asked');
  assert.equal(accessGapQuestion(w.checks[c.id]['p05.access']), 'נשמרה גישה ל־Instagram בלבד. יש עוד רשתות?');
  assert.equal(accessGapQuestion({ note: 'מהלקוח, בטופס פרטי הכניסה: Instagram, Facebook' }), 'נשמרה גישה ל־Instagram, Facebook. יש עוד רשתות?');
  assert.equal(accessGapQuestion({ note: null }), 'יש ללקוח עוד רשתות שחסרה להן גישה?');
  assert.equal(accessGapQuestion(undefined), 'יש ללקוח עוד רשתות שחסרה להן גישה?');
  const item = PROCESSES.find((p) => p.id === 'p05').items.find((i) => i.key === 'p05.allnets');
  assert.deepEqual([item.word, item.noBulk, item.requires], ['אין עוד', true, ['p05.access']]);
  // Not asked before any access was received (it needs that mark first).
  const none = afterMeeting();
  assert.ok(!mine(none.w, none.c, 'ofir', noon).includes('p05.allnets'));
  // Ilai's check of what did arrive starts all the same (6 hangs on "access received").
  assert.equal(proc(w, c, 'p06', noon).ready, true);
  mark(w, c, 'p05.allnets', IL(2026, 10, 5, 12, 5));
  assert.equal(proc(w, c, 'p05', IL(2026, 10, 5, 12, 6)).complete, true);
  // The system has no list of the client's networks: the names come from the mark's own note.
  assert.ok(NETWORKS.some(([, name]) => name === 'Instagram'));
});

// ── Landing and imported history ────────────────────────────────────────────
test('a client in landing stays quiet: none of the new steps is on a list, rings, or is counted', () => {
  const w = world();
  const c = client(w, { name: 'קליטה', landing: true, protocol_version: 7, char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 20, 10).toISOString() });
  marks(w, c, itemsOf('p04'), IL(2026, 10, 5, 12));
  mark(w, c, 'p07.made', IL(2026, 10, 5, 13));
  for (const now of [IL(2026, 10, 5, 12, 1), IL(2026, 10, 6, 9, 0), IL(2026, 10, 6, 12, 0), IL(2026, 10, 7, 14, 0)]) {
    for (const p of ['irit', 'lior', 'ofir', 'ilai']) assert.deepEqual(mine(w, c, p, now), [], `${p} ${hhmm(now)}`);
    assert.deepEqual(due(w, now).filter((r) => ['clientLink', 'followup', 'lateOwn', 'lateNag', 'late', 'shootDate'].includes(r.rule)), [], hhmm(now));
    assert.deepEqual(lateOf(w, now), []);
    assert.deepEqual(followupRows({ clients: w.clients, checksOf: (x) => w.checks[x.id] || {}, stateOf: (x) => stateOf(w, x, now), now }), []);
  }
  // Nor a line on "המשימות שלי".
  const now = IL(2026, 10, 6, 10);
  const lines = flowLines({ viewer: { me: 'irit', scope: 'office' }, clients: w.clients, checks: w.checks, stateOf: (x) => stateOf(w, x, now), tasks: [], now });
  assert.ok(!lines.some((l) => l.id === 'followup'));
});

test('history brought in by an import is not opened again by a new step, in landing, after the activation, or on a client of the old version', () => {
  // A client of version 7 that was imported at "עריכה ובקרה": everything before it carries "ייבוא".
  const v7keys = importKeys('post').filter((k) => !['p05b.sent', 'p05.allnets', 'p07a.sent'].includes(k)); // what an import of version 7 wrote
  const topics = TOPICS.map((t) => `p14.${t.key}`); // and the eight topics of 14, which were items then
  for (const landed of [null, IL(2026, 10, 5, 9)]) {
    const w = world();
    const c = client(w, {
      name: 'ותיק', protocol_version: 7, deal_at: IL(2026, 6, 1, 9).toISOString(), char_at: IL(2026, 6, 3, 10).toISOString(),
      shoot_at: IL(2026, 6, 20, 10).toISOString(), editor: 'nadia', ...(landed ? { landing: false, landed_at: landed.toISOString(), landing_slot: 0 } : {}),
    });
    marks(w, c, [...v7keys, ...topics], IL(2026, 9, 1, 9), IMPORT_NOTE);
    for (const now of [IL(2026, 10, 5, 10), IL(2026, 10, 6, 9, 0), IL(2026, 10, 7, 14, 0)]) {
      const st = stateOf(w, c, now);
      const open = (id) => st.states.find((s) => s.proc.id === id);
      // The new steps are not asked: 5ב and 7א count as complete, 5 is not held open by "אין עוד", 14 is over.
      assert.deepEqual([open('p05b').complete, open('p07a').complete, open('p05').complete, open('p11').complete], [true, true, true, true], hhmm(now));
      assert.deepEqual([open('p14').status, open('p14').ready], ['done', false]);
      for (const p of ['irit', 'lior', 'ofir', 'ilai']) {
        const keys = mine(w, c, p, now);
        for (const k of ['p05b.sent', 'p05.allnets', 'p07a.sent', 'p14.day', 'p11.calendar']) assert.ok(!keys.includes(k), `${p} ${k} ${hhmm(now)}`);
      }
      assert.deepEqual(due(w, now).filter((r) => ['clientLink', 'followup'].includes(r.rule)), []);
      assert.ok(!lateOf(w, now).some((x) => ['5', '5ב', '7', '7א', '11', '14'].includes(x.num)), hhmm(now));
      // In the card they read "אם רלוונטי", not as work.
      assert.equal(open('p05b').proc.items[0].optional, true);
    }
  }
  // The shoot day itself is history although no date is on record (an old client): 14 is not asked either.
  const w2 = world();
  const old = client(w2, { name: 'בלי תאריך', protocol_version: 7, deal_at: IL(2026, 6, 1, 9).toISOString(), char_at: IL(2026, 6, 3, 10).toISOString(), editor: 'nadia' });
  marks(w2, old, importKeys('post').filter((k) => !/^p14\./.test(k)), IL(2026, 9, 1, 9), IMPORT_NOTE);
  const p14 = proc(w2, old, 'p14', IL(2026, 10, 6, 10));
  assert.deepEqual([p14.status, p14.ready], ['done', false]);
  // A client imported under version 8 gets the new steps with its history.
  for (const k of ['p05b.sent', 'p05.allnets', 'p07a.sent']) assert.ok(importKeys('content').includes(k), k);
  assert.ok(!importKeys('ongoing').includes('p14.day'), 'the daily follow-up is never a mark of history');
});

test('a client of the old version that is still working through the step gets it as work that is never late', () => {
  const { w, c } = afterMeeting(world(), { protocol_version: 7 });
  const tue = IL(2026, 10, 6, 10);
  assert.ok(mine(w, c, 'irit', tue).includes('p05b.sent'));
  const s = proc(w, c, 'p05b', tue);
  assert.deepEqual([s.status === 'overdue', s.proc.items[0].fresh], [false, 8]);
  assert.ok(!lateOf(w, tue).some((x) => x.num === '5ב'));
});

// ── FIX 6: a review has its own clock ───────────────────────────────────────
test('the review of the 9 graphics is not on Irit\'s list before they arrive, and is due two office hours after', () => {
  const { w, c } = afterMeeting();
  const p7 = () => PROCESSES.find((p) => p.id === 'p07');
  assert.deepEqual(stagesOf(p7().due), [{ key: 'p07.made', minutes: 120, office: true }]);
  // Until Ilai delivers: the making's own deadline, and it is Ilai's alone.
  assert.equal(hhmm(proc(w, c, 'p07', IL(2026, 10, 5, 13)).dueAt), '5.10 14:00');
  assert.deepEqual(mine(w, c, 'irit', IL(2026, 10, 5, 13)).filter((k) => k.startsWith('p07.')), []);
  assert.deepEqual(mine(w, c, 'lior', IL(2026, 10, 5, 13)).filter((k) => k.startsWith('p07.')), []);
  assert.deepEqual(mine(w, c, 'ilai', IL(2026, 10, 5, 13)).filter((k) => k.startsWith('p07.')), ['p07.made']);
  // He delivers a day late, at 09:45 on Tuesday: her seven checks open, due at 11:45, not "late 21 hours".
  mark(w, c, 'p07.made', IL(2026, 10, 6, 9, 45));
  const s = proc(w, c, 'p07', IL(2026, 10, 6, 9, 56));
  assert.deepEqual([hhmm(s.dueAt), s.status], ['6.10 11:45', 'today']);
  assert.equal(mine(w, c, 'irit', IL(2026, 10, 6, 9, 56)).filter((k) => k.startsWith('p07.r.')).length, 7);
  assert.deepEqual(mine(w, c, 'lior', IL(2026, 10, 6, 9, 56)).filter((k) => k.startsWith('p07.')), [], 'Lior does not carry the card');
  assert.equal(proc(w, c, 'p07', IL(2026, 10, 6, 11, 46)).status, 'overdue');
  // Office time: delivered at 17:30, the two hours end at 10:30 the next working morning.
  const eve = afterMeeting();
  mark(eve.w, eve.c, 'p07.made', IL(2026, 10, 5, 17, 30));
  assert.equal(hhmm(proc(eve.w, eve.c, 'p07', IL(2026, 10, 5, 17, 31)).dueAt), '6.10 10:30');
  // A client that started before version 8 keeps the later of the two deadlines.
  const old = afterMeeting(world(), { protocol_version: 7 });
  mark(old.w, old.c, 'p07.made', IL(2026, 10, 5, 12, 30));
  assert.equal(hhmm(proc(old.w, old.c, 'p07', IL(2026, 10, 5, 12, 31)).dueAt), '5.10 14:30');
});

test('the rest of the graphics (23): Ilai by the business day, then Ofir\'s hour from the hand-over, then Irit\'s business day from his approval', () => {
  const { w, c } = afterMeeting(world(), { shoot_at: IL(2026, 10, 13, 10).toISOString(), editor: 'nadia' });
  const p23 = PROCESSES.find((p) => p.id === 'p23');
  assert.deepEqual(stagesOf(p23.due), [{ key: 'p23.made', minutes: 60, office: true }, { key: 'p23.ofir', businessDays: 1 }]);
  // Made: by the close of the business day after the shoot (Wednesday 14.10, 18:00).
  assert.equal(hhmm(proc(w, c, 'p23', IL(2026, 10, 13, 12)).dueAt), '14.10 18:00');
  assert.deepEqual(mine(w, c, 'ofir', IL(2026, 10, 13, 12)).filter((k) => k.startsWith('p23.')), [], 'nothing to check before it is uploaded');
  // Handed to Ofir at 16:30 on Wednesday: his hour, in office time, ends at 17:30.
  mark(w, c, 'p23.made', IL(2026, 10, 14, 16, 30));
  assert.equal(hhmm(proc(w, c, 'p23', IL(2026, 10, 14, 16, 31)).dueAt), '14.10 17:30');
  assert.equal(mine(w, c, 'ofir', IL(2026, 10, 14, 16, 31)).filter((k) => k.startsWith('p23.q.')).length, 7);
  // He approves on Thursday at 10:00: Irit sends by the close of the next business day (Sunday 18.10).
  for (const i of p23.items.filter((x) => x.key.startsWith('p23.q.') || x.key === 'p23.ofir')) mark(w, c, i.key, IL(2026, 10, 15, 10));
  assert.equal(hhmm(proc(w, c, 'p23', IL(2026, 10, 15, 10, 1)).dueAt), '18.10 18:00');
  assert.deepEqual(mine(w, c, 'irit', IL(2026, 10, 15, 10, 1)).filter((k) => k.startsWith('p23.')), ['p23.sent']);
  // The quality control of the videos (25) already had its own hour from the hand-over (24): unchanged.
  const p25 = PROCESSES.find((p) => p.id === 'p25');
  assert.deepEqual([p25.start, p25.due], [{ from: 'p24' }, { from: 'p24', hours: 1 }]);
});

test('"the end of a business day" is 18:00 everywhere (13:00 on erev chag): the deadline shown is the moment lateness starts', () => {
  assert.equal(hhmm(addBusinessDays(IL(2026, 10, 5, 10), 1)), '6.10 18:00');
  assert.equal(hhmm(addBusinessDays(IL(2026, 10, 8, 10), 1)), '11.10 18:00'); // Thursday: Sunday
  assert.equal(hhmm(addBusinessDays(IL(2026, 9, 17, 10), 1)), '20.9 13:00'); // erev Yom Kippur
  assert.equal(hhmm(endOfBusinessDay(IL(2026, 10, 6, 9))), '6.10 18:00');
  assert.deepEqual([isDayEnd(IL(2026, 10, 6, 18)), isDayEnd(IL(2026, 10, 6, 23, 59)), isDayEnd(IL(2026, 10, 6, 17, 59)), isDayEnd(IL(2026, 9, 20, 13))], [true, true, false, true]);
  // 11: due the close of the business day after the group; late at 18:01, not at midnight.
  const w = world();
  const c = client(w, {});
  for (const id of ['p01', 'p02', 'p03']) marks(w, c, itemsOf(id), IL(2026, 10, 4, 9, 3));
  assert.equal(hhmm(proc(w, c, 'p11', IL(2026, 10, 4, 10)).dueAt), '5.10 18:00');
  assert.deepEqual([proc(w, c, 'p11', IL(2026, 10, 5, 17, 59)).status, proc(w, c, 'p11', IL(2026, 10, 5, 18, 1)).status], ['today', 'overdue']);
  // The editing: three business days from the assignment, at 18:00 (what the editor's page always said).
  const e = client(w, { editor: 'nadia', shoot_at: IL(2026, 10, 13, 10).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString() });
  importTo(w, e, 'post');
  for (const k of itemsOf('p22a')) mark(w, e, k, IL(2026, 10, 18, 10));
  for (const k of [...itemsOf('p22'), ...itemsOf('p24')]) delete w.checks[e.id][k];
  assert.equal(hhmm(proc(w, e, 'p22', IL(2026, 10, 18, 11)).dueAt), '21.10 18:00');
  // A shoot day still ends with the day (23:59): it is not an office day.
  assert.equal(PROCESSES.find((p) => p.id === 'p18').due.at, '23:59');
  assert.equal(PROCESSES.find((p) => p.id === 'p34').due.at, '18:00');
});

// ── FIX 6: process 14, daily and light ──────────────────────────────────────
test('14 is asked once every working day from the end of the characterization until the shoot day, one answer per client', () => {
  const { w, c } = afterMeeting(world(), { shoot_at: IL(2026, 10, 13, 10).toISOString() });
  const rows = (now) => followupRows({ clients: w.clients, checksOf: (x) => w.checks[x.id] || {}, stateOf: (x) => stateOf(w, x, now), now });
  const st = (now) => proc(w, c, 'p14', now).status;
  assert.deepEqual(rows(IL(2026, 10, 5, 11)), [], 'not before the meeting ended');
  assert.equal(st(IL(2026, 10, 5, 12, 1)), 'due');
  assert.deepEqual(rows(IL(2026, 10, 5, 12, 1)).map((r) => [r.client.id, r.status, r.n, r.pre, hhmm(r.shootAt)]), [[c.id, 'due', 1, '', '13.10 10:00']]);
  // It is never a card on a list, never late, and never part of the progress count.
  for (const p of ['irit', 'lior', 'ofir']) assert.ok(!mine(w, c, p, IL(2026, 10, 6, 10)).some((k) => k.startsWith('p14.')), p);
  assert.ok(!lateOf(w, IL(2026, 10, 8, 10)).some((x) => x.num === '14'));
  assert.ok(stateOf(w, c, IL(2026, 10, 8, 10)).phases.find((ph) => ph.key === 'prep').states.every((s) => s.proc.id !== 'p14' || !s.late));
  // "הכול תקין": one mark closes today, and tomorrow it is asked again.
  mark(w, c, FOLLOWUP_KEY(), IL(2026, 10, 6, 9, 30), followupNote({}));
  assert.equal(followupNote({}), '{"ok":true}');
  assert.deepEqual([st(IL(2026, 10, 6, 9, 31)), rows(IL(2026, 10, 6, 9, 31))[0].status, rows(IL(2026, 10, 6, 9, 31))[0].answer.ok], ['done', 'done', true]);
  assert.deepEqual([st(IL(2026, 10, 7, 9)), rows(IL(2026, 10, 7, 9))[0].status, rows(IL(2026, 10, 7, 9))[0].answer], ['due', 'due', null]);
  // Not on Friday or Saturday; again on Sunday; not on the shoot day itself, nor after it.
  assert.deepEqual([st(IL(2026, 10, 9, 10)), st(IL(2026, 10, 10, 10)), st(IL(2026, 10, 11, 10)), st(IL(2026, 10, 12, 10))], ['waiting', 'waiting', 'due', 'due']);
  assert.deepEqual([rows(IL(2026, 10, 9, 10)), rows(IL(2026, 10, 13, 8)), rows(IL(2026, 10, 14, 10))], [[], [], []]);
  assert.deepEqual([st(IL(2026, 10, 13, 8)), st(IL(2026, 10, 14, 10))], ['done', 'done']);
  // The item counts for its own Israel day only.
  const item = PROCESSES.find((p) => p.id === 'p14').items[0];
  const check = { state: 'done', at: IL(2026, 10, 6, 23, 30).toISOString() };
  assert.deepEqual([isResolved(item, check, IL(2026, 10, 6, 23, 45)), isResolved(item, check, IL(2026, 10, 7, 0, 5))], [true, false]);
  // Without a shoot date it is asked until one is set and comes.
  const open = afterMeeting();
  assert.equal(proc(open.w, open.c, 'p14', IL(2026, 10, 20, 10)).status, 'due');
});

test('something is stuck: which of the eight topics, a short note, and Lior is told; the row says so', () => {
  const { w, c } = afterMeeting(world(), { shoot_at: IL(2026, 10, 13, 10).toISOString() });
  const now = IL(2026, 10, 8, 10);
  const note = followupNote({ stuck: ['scripts', 'access', 'nonsense', 'scripts'], note: `  הלקוח לא עונה  ${'x'.repeat(400)}` });
  const v = JSON.parse(note);
  assert.deepEqual(v.stuck, ['scripts', 'access']);
  assert.equal(v.note.length, 200);
  mark(w, c, FOLLOWUP_KEY(), now, followupNote({ stuck: ['scripts', 'access'], note: 'הלקוח לא עונה' }));
  const [row] = followupRows({ clients: w.clients, checksOf: (x) => w.checks[x.id] || {}, stateOf: (x) => stateOf(w, x, now), now });
  assert.deepEqual([row.status, row.answer.ok, row.answer.stuck], ['done', false, ['scripts', 'access']]);
  assert.equal(followupText(row.answer), 'תקוע: תסריטים, גישות · הלקוח לא עונה');
  assert.equal(followupText(readFollowup({ state: 'done', at: now.toISOString(), note: '{"ok":true}' })), 'הכול תקין');
  assert.equal(readFollowup({ state: 'done', at: now.toISOString(), note: 'טקסט חופשי' }).ok, true);
  assert.equal(readFollowup(null), null);
  // The message to Lior is an exception, urgent when the shoot is two business days away or less.
  const t = followupTask(c, row, { stuck: ['scripts', 'access'], note: 'הלקוח לא עונה' }, now);
  assert.deepEqual([t.owner, t.source, t.urgent, t.client_id, t.due_on], ['lior', 'escalation', false, c.id, null]);
  assert.match(t.title, /^תקוע לפני יום הצילום \(.*13\.10.*\): תסריטים, גישות · הלקוח לא עונה$/);
  assert.equal(t.brief.blocker, 'followup:2026-10-08');
  assert.equal(followupTask(c, row, { stuck: ['scripts'] }, IL(2026, 10, 11, 10)).urgent, true);
  // He is rung by the rule that already rings him for every exception.
  w.tasks.push({ id: 't1', ...t, created_at: now.toISOString(), created_by_email: 'irit@x', done_at: null });
  assert.ok(due(w, now).some((r) => r.person === 'lior' && /תקוע לפני יום הצילום/.test(`${r.title} ${r.body}`)));
  // And it is not counted again as a blocker of the page's own list of blockers.
  const [p] = shootPrep(c, w.checks[c.id], stateOf(w, c, now), { tasks: w.tasks, now });
  assert.ok(!p.blockers.some((b) => /תקוע לפני יום הצילום/.test(b.text)));
  // The next day it is asked again, and the row remembers what was stuck.
  const next = followupRows({ clients: w.clients, checksOf: (x) => w.checks[x.id] || {}, stateOf: (x) => stateOf(w, x, IL(2026, 10, 11, 9)), now: IL(2026, 10, 11, 9) })[0];
  assert.deepEqual([next.status, next.answer, next.last.stuck], ['due', null, ['scripts', 'access']]);
});

test('Irit gets ONE counted line for all the clients, a line in her morning digest and one ring at 12:00 while a client is unanswered', () => {
  const w = world();
  const cs = [1, 2, 3].map((n) => afterMeeting(w, { name: `לקוח ${n}`, shoot_at: IL(2026, 10, 13 + n, 10).toISOString() }).c);
  for (const c of cs) for (const id of ['p05', 'p05b', 'p06', 'p07', 'p07a', 'p07b', 'p08', 'p08b', 'p09', 'p10', 'p11']) marks(w, c, itemsOf(id), IL(2026, 10, 5, 12, 20));
  const now = IL(2026, 10, 6, 10);
  const lines = (me, t = now) => flowLines({ viewer: { me, scope: 'office' }, clients: w.clients, checks: w.checks, stateOf: (x) => stateOf(w, x, t), tasks: [], now: t });
  const line = lines('irit').find((l) => l.id === 'followup');
  assert.deepEqual([line.text, line.n, line.href, line.bucket, line.rule, line.cta], ['מעקב לפני צילום: 3 לקוחות', 3, 'prep.html#followup', 'today', 'followup', 'למעקב']);
  assert.equal(FOLLOWUP_URL, 'prep.html#followup');
  assert.deepEqual([followupLine(1), followupLine(2)], ['מעקב לפני צילום: לקוח אחד', 'מעקב לפני צילום: 2 לקוחות']);
  for (const me of ['lior', 'ofir', 'ilai']) assert.ok(!lines(me).some((l) => l.id === 'followup'), me);
  // The reminders: the digest line at 08:30, one ring at 12:00; none when all were answered.
  const rule = RULES.find((r) => r.id === 'followup');
  assert.ok(rule);
  const morning = of(due(w, IL(2026, 10, 6, 8, 30)), 'followup');
  assert.deepEqual(morning.map((r) => [r.person, r.level, r.title]), [['irit', 'digest', 'מעקב לפני צילום: 3 לקוחות']]);
  mark(w, cs[0], FOLLOWUP_KEY(), IL(2026, 10, 6, 9), followupNote({}));
  mark(w, cs[1], FOLLOWUP_KEY(), IL(2026, 10, 6, 9, 1), followupNote({}));
  assert.equal(lines('irit', IL(2026, 10, 6, 11)).find((l) => l.id === 'followup').text, 'מעקב לפני צילום: לקוח אחד');
  const noon = of(due(w, IL(2026, 10, 6, 12, 0)), 'followup').filter((r) => r.step === '1200');
  assert.deepEqual(noon.map((r) => [r.person, r.level, r.title]), [['irit', 'ring', 'מעקב לפני צילום: לקוח אחד עוד לא נבדק היום']]);
  mark(w, cs[2], FOLLOWUP_KEY(), IL(2026, 10, 6, 12, 5), followupNote({}));
  assert.deepEqual(of(due(w, IL(2026, 10, 6, 12, 10)), 'followup'), []);
  assert.equal(lines('irit', IL(2026, 10, 6, 12, 10)).find((l) => l.id === 'followup'), undefined);
  // Nobody else is ever told of it, and nothing of it on a weekend.
  assert.deepEqual(of(due(w, IL(2026, 10, 7, 12, 0)), 'followup').map((r) => `${r.step}@${r.person}`), ['list@irit', '1200@irit']);
  assert.deepEqual(of(due(w, IL(2026, 10, 9, 12, 0)), 'followup'), []);
});

// ── FIX 8: the shoot day has a date ─────────────────────────────────────────
test('process 11 cannot be closed without a shoot date: it stays on Irit\'s list with the detail to set, and is a late item like any other', () => {
  const w = world();
  const c = client(w, { name: 'בלי תאריך', shoot_type: 'dms' });
  for (const id of ['p01', 'p02', 'p03']) marks(w, c, itemsOf(id), IL(2026, 10, 4, 9, 3));
  const p11 = PROCESSES.find((p) => p.id === 'p11');
  assert.deepEqual(p11.items.find((i) => i.key === 'p11.calendar').setHere, { unless: 'p19', keep: ['shoot_at'] });
  const now = IL(2026, 10, 4, 10);
  // The date is missing: the calendar item is an entry with `fields`, not a tick.
  const entry = openItemsFor('irit', c, w.checks[c.id], stateOf(w, c, now), now).find((e) => e.item.key === 'p11.calendar');
  assert.deepEqual(entry.fields, ['shoot_at']);
  // Everything that can be ticked is ticked (the five items shown): the process is still open.
  marks(w, c, itemsOf('p11').filter((k) => k !== 'p11.calendar'), IL(2026, 10, 4, 11));
  const s = proc(w, c, 'p11', IL(2026, 10, 4, 12));
  assert.deepEqual([s.complete, s.gap.fields, mine(w, c, 'irit', IL(2026, 10, 4, 12)).filter((k) => k.startsWith('p11.'))], [false, ['shoot_at'], ['p11.calendar']]);
  // Even with "in everyone's calendar" forced in: no date, no closed shoot day.
  mark(w, c, 'p11.calendar', IL(2026, 10, 4, 12));
  assert.equal(proc(w, c, 'p11', IL(2026, 10, 4, 13)).complete, false);
  // Past its deadline it is late, held by Irit, and on the ladder (not left out as process 3's own ring is).
  const late = lateOf(w, IL(2026, 10, 6, 10)).find((x) => x.num === '11');
  assert.deepEqual([late.holders, late.gap], [['irit'], false]);
  assert.ok(due(w, IL(2026, 10, 6, 14, 0)).some((r) => r.rule === 'lateNag' && r.person === 'irit' && /11 · קביעת יום צילום/.test(`${r.title} ${r.body}`)));
  // The date is set: closed.
  const dated = { ...c, shoot_at: IL(2026, 10, 20, 10).toISOString() };
  assert.equal(clientState(dated, w.checks[c.id], IL(2026, 10, 6, 10)).states.find((x) => x.proc.id === 'p11').complete, true);
  // Without "with whom" as well, both are asked for before the tick.
  const untyped = { ...c, shoot_type: null };
  assert.deepEqual(fieldGap({ ...p11, items: p11.items }, untyped, {}, applicableProcesses(untyped)).fields, ['shoot_type', 'shoot_at']);
});

test('the shoot date is not asked of a client in landing, of imported history, or once the shoot day is behind the client; a second round asks for its own', () => {
  const p11 = (c, checks, now) => clientState(c, checks, now).states.find((s) => s.proc.id === 'p11');
  const now = IL(2026, 10, 6, 10);
  const base = { id: 'x', name: 'x', status: 'active', shoot_type: 'dms', characterizer: 'ofir', rounds: [], deal_at: IL(2026, 9, 1, 9).toISOString(), char_at: IL(2026, 9, 2, 10).toISOString() };
  const ticked = Object.fromEntries(itemsOf('p11').map((k) => [k, { state: 'done', at: IL(2026, 9, 3, 10).toISOString(), note: null }]));
  assert.equal(p11(base, ticked, now).complete, false);
  // Landing: nothing is asked.
  assert.equal(p11({ ...base, landing: true }, ticked, now).gap, null);
  // Imported history (the note "ייבוא"), also after the activation.
  const imported = Object.fromEntries(Object.entries(ticked).map(([k, v]) => [k, { ...v, note: IMPORT_NOTE }]));
  assert.deepEqual([p11(base, imported, now).complete, p11({ ...base, landing: false, landed_at: IL(2026, 10, 1, 9).toISOString() }, imported, now).complete], [true, true]);
  // The shoot day was closed (19) with no date typed: behind the client.
  const closed = { ...ticked, ...Object.fromEntries(itemsOf('p19').map((k) => [k, { state: 'done', at: IL(2026, 9, 20, 18).toISOString(), note: null }])) };
  assert.equal(p11(base, closed, now).complete, true);
  // A second round: its own date, whatever the first round's.
  const two = { ...base, shoot_at: IL(2026, 9, 20, 10).toISOString(), rounds: [{ n: 2, shoot_type: 'dms', shoot_at: null, start_at: IL(2026, 10, 1, 10).toISOString() }] };
  const r2 = Object.fromEntries(itemsOf('p11').map((k) => [`r2.${k}`, { state: 'done', at: IL(2026, 10, 2, 10).toISOString(), note: null }]));
  const st = clientState(two, { ...closed, ...r2 }, now).states.find((s) => s.proc.id === 'r2-p11');
  assert.deepEqual([st.complete, st.gap.fields], [false, ['shoot_at']]);
  const withDate = { ...two, rounds: [{ ...two.rounds[0], shoot_at: IL(2026, 11, 1, 10).toISOString() }] };
  assert.equal(clientState(withDate, { ...closed, ...r2 }, now).states.find((s) => s.proc.id === 'r2-p11').complete, true);
});

test('the photographer\'s next free days: what he marked, from tomorrow, without the days a shoot is already set on', () => {
  const now = IL(2026, 10, 6, 10);
  const months = [{ person: 'eli', month: '2026-10-01', days: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-12', '2026-10-13', '2026-10-20'] }, { person: 'eli', month: '2026-11-01', days: ['2026-11-03'] }];
  assert.deepEqual(freeAhead({ months, taken: { '2026-10-12': 1 }, now }), ['2026-10-07', '2026-10-13', '2026-10-20', '2026-11-03']);
  assert.deepEqual(freeAhead({ months, taken: {}, now, limit: 2 }), ['2026-10-07', '2026-10-12']);
  // Nothing handed over: nothing is known (null), which is not "no free days" ([]).
  assert.equal(freeAhead({ months: [], now }), null);
  assert.deepEqual(freeAhead({ months: [{ person: 'eli', month: '2026-10-01', days: ['2026-10-01'] }], now }), []);
});

// ── FIX 7: marks with nothing behind them ───────────────────────────────────
test('a guarded mark is refused only when the system knows it is empty, in one sentence; unknown lets it through', () => {
  assert.deepEqual(['p29.filled', 'r2.p29.filled', 'p28.scheduled', 'p12.docs', 'r3.p12.docs', 'p23.made', 'p31.call', 'p07.made', 'p05b.sent'].map(guardOf),
    ['gantt', 'gantt', 'scheduled', 'scripts', 'scripts', 'graphicsCount', 'callSummary', null, null]);
  assert.deepEqual([roundOfKey('p12.docs'), roundOfKey('r3.p12.docs')], [1, 3]);
  // The Gantt: content rows only; the frame is not content.
  const isPost = (kind) => kind !== 'end';
  assert.deepEqual(ganttFacts([{ kind: 'end', state: 'planned' }], isPost), { posts: 0, scheduled: 0 });
  assert.deepEqual(ganttFacts([{ kind: 'video', state: 'planned' }, { kind: 'video', state: 'scheduled' }, { kind: 'graphic', state: 'posted' }, { kind: 'end', state: 'scheduled' }], isPost), { posts: 3, scheduled: 2 });
  assert.deepEqual(guardVerdict('gantt', { posts: 0, scheduled: 0 }), { refuse: REFUSALS.gantt });
  assert.equal(guardVerdict('gantt', { posts: 1, scheduled: 0 }), null);
  assert.deepEqual(guardVerdict('scheduled', { posts: 4, scheduled: 0 }), { refuse: REFUSALS.scheduled });
  assert.equal(guardVerdict('scheduled', { posts: 4, scheduled: 1 }), null);
  assert.deepEqual(guardVerdict('scripts', { scripts: 0 }), { refuse: REFUSALS.scripts });
  assert.equal(guardVerdict('scripts', { scripts: 3 }), null);
  // Not known (the read failed, the table is not there): nothing is refused.
  for (const g of ['gantt', 'scheduled', 'scripts', 'graphicsCount']) assert.equal(guardVerdict(g, null), null, g);
  assert.equal(guardVerdict(null, { posts: 0 }), null);
  // Each refusal is one short sentence that says why and what to do.
  assert.match(REFUSALS.gantt, /^הגאנט עדיין ריק\./);
  for (const s of Object.values(REFUSALS)) assert.ok(s.length < 70 && !/\n/.test(s), s);
  // Fewer graphics than the package: asked, never refused.
  assert.deepEqual(guardVerdict('graphicsCount', { count: 1, total: 26 }), { ask: 'הועלתה 1 מתוך 26. לשלוח בכל זאת?' });
  assert.equal(graphicsAsk(5, 26), 'הועלו 5 מתוך 26. לשלוח בכל זאת?');
  assert.equal(guardVerdict('graphicsCount', { count: 26, total: 26 }), null);
  assert.equal(guardVerdict('graphicsCount', { count: 3, total: null }), null, 'a package with no number of graphics: nothing to ask');
  // The weekly call is recorded in its own dialog, which asks for the summary.
  assert.deepEqual(guardVerdict('callSummary', null), { via: 'call' });
  // No guard asks for a video to be uploaded: the finished videos stay in the client's Drive.
  for (const p of PROCESSES) for (const i of p.items) if (i.guard) assert.ok(!/^p(22|24|25|26|27)\./.test(i.key), i.key);
});

test('a guarded item is never closed with "mark the whole process"', () => {
  const { w, c } = afterMeeting();
  marks(w, c, itemsOf('p12a'), IL(2026, 10, 5, 15));
  const now = IL(2026, 10, 5, 16);
  const s = proc(w, c, 'p12', now);
  const keys = bulkEligible(s, 'lior', c, w.checks[c.id], now).map((i) => i.key);
  assert.deepEqual(keys, ['p12.scripts', 'p12.numbered']);
  assert.ok(mine(w, c, 'lior', now).includes('p12.docs'), 'it is still his to tick, by itself');
});
