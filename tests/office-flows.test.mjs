// The office's flows (stage 3, part 2: Ofir, Lior and Ilai; system-plan section 3,
// decisions 7–24): quality-control rounds and Ofir's clock, the editor
// preselection and load, the pass over the clients (33) with the "stuck" flag and
// the Thursday draft, urgent tasks started or back with Lior, paused editing,
// Ilai's characterization day, the moved deadlines, and the reminder ladders that
// follow them. Israel time; npm test runs this under UTC, New York and Jerusalem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateIL, partsIL, dayKeyIL } from '../app/tz.js';
import { PROCESSES } from '../app/protocol.js';
import { clientState, IMPORT_NOTE } from '../app/protocol-logic.js';
import { computeReminders } from '../app/reminder-engine.js';
import {
  qaState, qaRounds, ofirMeetings, MEETING_DONE_KEYS, returnKey, fixedKey, fixedItemKey, returnNote, readReturn, fixDue, qaDue, qaWaited, meetingNow,
  describeOfficeMark, SHIFT_KEY, shiftNote, accessFixedKey, accessFixNote, QA_KINDS,
} from '../app/office-marks.js';
import {
  qaQueue, qaFixing, awaitingEditor, preselected, reasonNeeded, editorLoad, proposeEditor, folderDueOn, editingDay, dayText, loadText,
  jointFromSelection, charsToday,
} from '../app/qa-logic.js';
import {
  changesOf, stuckOf, passRows, passProgress, passDue, previousPass, dataHealth, summaryDraft, snapshotOf, thursdayTarget,
} from '../app/pass-logic.js';
import {
  urgentState, parseReport, exceptionPath, pausedSinceYesterday, campaignCheck, linkedTitle, withEditor,
} from '../app/decisions-logic.js';
import { accessChecked, charDay, ilaiWork, PAGE_KEYS, GANTT_KEYS } from '../app/ilai-logic.js';
import { clientHealth, station } from '../app/health.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' }, { email: 'nirel@x', person: 'nirel' },
  { email: 'nadia@x', person: 'nadia' }, { email: 'yariv@x', person: 'yariv' }, { email: 'anna@x', person: 'anna' }, { email: 'eli@x', person: 'eli' },
];
let seq = 0;
const world = () => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF });
function client(w, o = {}) {
  seq += 1;
  const c = {
    id: `c${seq}`, name: o.name || `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
    rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 9, 1, 10).toISOString(), created_by_email: 'irit@x', ...o,
  };
  w.clients.push(c);
  return c;
}
const mark = (w, c, key, at, note = null, state = 'done', by = 'x@x') => {
  (w.checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state, note, at: at.toISOString(), by_email: by };
};
const marks = (w, c, keys, at, note = null) => keys.forEach((k) => mark(w, c, k, at, note));
const itemsOf = (id, pre = '') => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => pre + i.key);
const stateOfW = (w, now) => (c) => clientState(c, w.checks[c.id] || {}, now);
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const pick = (list, rule, step, person = null) => list.filter((r) => r.rule === rule && r.step === step && (!person || r.person === person));
const one = (list, rule, step, person = null) => {
  const got = pick(list, rule, step, person);
  assert.equal(got.length, 1, `${rule}.${step}${person ? `@${person}` : ''}: ${JSON.stringify(list.filter((r) => r.rule === rule).map((r) => r.key))}`);
  return got[0];
};
const none = (list, rule, step = null) => assert.equal(list.filter((r) => r.rule === rule && (!step || r.step === step)).length, 0,
  `${rule}${step ? `.${step}` : ''} should not be due: ${JSON.stringify(list.filter((r) => r.rule === rule).map((r) => r.key))}`);

// A client whose editing is with Nadia: shot on Sunday 18.10, assigned Sunday 12:00.
function editingClient(w, o = {}) {
  const c = client(w, { editor: 'nadia', shoot_at: IL(2026, 10, 18, 10).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString(), ...o });
  for (const id of ['p01', 'p02', 'p03', 'p04', 'p05', 'p05b', 'p06', 'p07', 'p07a', 'p07b', 'p08', 'p08b', 'p09', 'p10', 'p11', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p21']) {
    marks(w, c, itemsOf(id), IL(2026, 10, 18, 9), IMPORT_NOTE);
  }
  marks(w, c, itemsOf('p22a'), IL(2026, 10, 18, 12));
  return c;
}

// ── Quality control rounds ──────────────────
test('QA rounds: ready → returned (round 1) → fixed → round 2 with Ofir → approved', () => {
  const w = world();
  const c = editingClient(w);
  const cs = () => w.checks[c.id];
  assert.equal(qaState(cs(), '', 'videos').stage, 'none');
  mark(w, c, 'p24.notify', IL(2026, 10, 20, 10));
  let q = qaState(cs(), '', 'videos');
  assert.equal(q.stage, 'ofir');
  assert.equal(q.round, 1);
  assert.equal(hhmm(q.readyAt), '20.10 10:00');
  // Ofir returns it with two issues, due 18:00 (notes before 13:00: the same day).
  const note = returnNote([{ ref: '3', text: 'הטלפון בסגיר שגוי' }, { ref: '7', text: 'כתוביות' }, { ref: '', text: '   ' }], fixDue(IL(2026, 10, 20, 10, 40)));
  mark(w, c, returnKey('', 'videos', 1), IL(2026, 10, 20, 10, 40), note);
  q = qaState(cs(), '', 'videos');
  assert.equal(q.stage, 'fixing');
  assert.equal(q.open.n, 1);
  assert.deepEqual(q.open.issues.map((x) => x.ref), ['3', '7']);
  assert.equal(hhmm(q.open.due), '20.10 18:00');
  // One issue fixed: still with the editor.
  mark(w, c, fixedItemKey('', 'videos', 1, 0), IL(2026, 10, 20, 11));
  q = qaState(cs(), '', 'videos');
  assert.equal(q.stage, 'fixing');
  assert.deepEqual([...q.open.fixed], [0]);
  // All fixed: back to Ofir for check 2.
  mark(w, c, fixedKey('', 'videos', 1), IL(2026, 10, 20, 12));
  q = qaState(cs(), '', 'videos');
  assert.equal(q.stage, 'ofir');
  assert.equal(q.round, 2);
  assert.equal(hhmm(q.readyAt), '20.10 12:00');
  // A second return, then the editor marks the videos ready again (p24.notify): that counts as fixed.
  mark(w, c, returnKey('', 'videos', 2), IL(2026, 10, 20, 13), returnNote([{ ref: '3', text: 'עדיין' }], null));
  assert.equal(qaState(cs(), '', 'videos').stage, 'fixing');
  mark(w, c, 'p24.notify', IL(2026, 10, 20, 14));
  q = qaState(cs(), '', 'videos');
  assert.equal(q.stage, 'ofir');
  assert.equal(q.round, 3);
  assert.equal(qaRounds(cs(), '', 'videos').length, 2);
  marks(w, c, [...QA_KINDS.videos.checks, 'p25.approved'], IL(2026, 10, 20, 15));
  assert.equal(qaState(cs(), '', 'videos').stage, 'approved');
  // Imported history is not an event: nothing waits for Ofir.
  const w2 = world();
  const d = client(w2);
  mark(w2, d, 'p24.notify', IL(2026, 10, 20, 10), IMPORT_NOTE);
  assert.equal(qaState(w2.checks[d.id], '', 'videos').stage, 'none');
});

test('return note: at most 30 issues of 200 characters (it fits a check\'s 8000); empty lines dropped; read back', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ ref: String(i + 1), text: 'x'.repeat(400) }));
  const v = readReturn({ state: 'done', note: returnNote(many, IL(2026, 10, 20, 18)), at: IL(2026, 10, 20, 10).toISOString(), by_email: 'ofir@x' });
  assert.equal(v.issues.length, 30);
  assert.equal(v.issues[0].text.length, 200);
  const heb = Array.from({ length: 60 }, () => ({ ref: 'סרטון 12345678901234', text: 'ש'.repeat(400) }));
  assert.ok(returnNote(heb, IL(2026, 10, 20, 18)).length <= 8000);
  assert.equal(v.by, 'ofir@x');
  assert.equal(readReturn({ state: 'done', note: 'not json', at: IL(2026, 10, 20).toISOString() }).issues.length, 0);
});

test('fix due (decisions 17, 18): by 13:00 the same day; later, the end of the next business day; Thursday → Sunday', () => {
  assert.equal(hhmm(fixDue(IL(2026, 10, 20, 12, 59))), '20.10 18:00');
  assert.equal(hhmm(fixDue(IL(2026, 10, 20, 13, 0))), '21.10 18:00');
  assert.equal(hhmm(fixDue(IL(2026, 10, 22, 15))), '25.10 18:00');
  assert.equal(hhmm(fixDue(IL(2026, 10, 23, 10))), '25.10 18:00'); // Friday
  // Erev Pesach 2027 (Wednesday 21.4) closes at 13:00.
  assert.equal(hhmm(fixDue(IL(2027, 4, 21, 10))), '21.4 13:00');
});

test('Ofir\'s one-hour clock stops while he is in a characterization (decision 11)', () => {
  const meetings = [[IL(2026, 10, 20, 10, 30).getTime(), IL(2026, 10, 20, 12, 0).getTime()]];
  const ready = IL(2026, 10, 20, 10);
  // 30 minutes before the meeting, 90 in it (not counted), then 30 more.
  assert.equal(hhmm(qaDue(meetings, ready, 60)), '20.10 12:30');
  assert.equal(qaWaited(meetings, ready, IL(2026, 10, 20, 11, 30)), 30);
  assert.equal(qaWaited(meetings, ready, IL(2026, 10, 20, 12, 15)), 45);
  assert.ok(meetingNow(meetings, IL(2026, 10, 20, 11)));
  assert.equal(meetingNow(meetings, IL(2026, 10, 20, 12, 1)), null);
  assert.equal(hhmm(qaDue([], IL(2026, 10, 20, 17, 30), 60)), '21.10 09:30'); // office hours only
  // His meetings: until he marks the characterization saved, or two hours; not Lior's.
  const w = world();
  const a = client(w, { char_at: IL(2026, 10, 20, 10).toISOString() });
  client(w, { char_at: IL(2026, 10, 20, 14).toISOString() });
  client(w, { char_at: IL(2026, 10, 20, 16).toISOString(), characterizer: 'lior' });
  mark(w, a, 'p04.saved', IL(2026, 10, 20, 11, 15));
  assert.deepEqual(ofirMeetings(w.clients, (c) => w.checks[c.id]).map(([x, y]) => `${hhmm(new Date(x))}-${hhmm(new Date(y)).slice(-5)}`), ['20.10 10:00-11:15', '20.10 14:00-16:00']);
  // Saved only the next morning: the meeting stops counting after four hours.
  mark(w, a, 'p04.saved', IL(2026, 10, 21, 9, 30));
  assert.equal(hhmm(new Date(ofirMeetings(w.clients, (c) => w.checks[c.id])[0][1])), '20.10 14:00');
  // "האפיון הסתיים" (p04.ended, decision 12) ends it too, before the full form is saved.
  assert.deepEqual(MEETING_DONE_KEYS, ['p04.ended', 'p04.saved']);
  mark(w, a, 'p04.ended', IL(2026, 10, 20, 10, 50));
  assert.equal(hhmm(new Date(ofirMeetings(w.clients, (c) => w.checks[c.id])[0][1])), '20.10 10:50');
});

test('the QA queue: first due first, with the round, the waiting time and the rounds of a second shoot', () => {
  const w = world();
  const now = IL(2026, 10, 20, 11);
  const a = editingClient(w, { name: 'א' });
  const b = editingClient(w, { name: 'ב', rounds: [{ n: 2, shoot_type: 'dms', editor: 'anna', shoot_at: IL(2026, 10, 18, 10).toISOString(), start_at: IL(2026, 10, 10, 10).toISOString() }] });
  mark(w, a, 'p24.notify', IL(2026, 10, 20, 10, 30));
  mark(w, b, 'r2.p24.notify', IL(2026, 10, 20, 9, 30));
  mark(w, b, 'p23.made', IL(2026, 10, 20, 10));
  mark(w, b, returnKey('', 'graphics', 1), IL(2026, 10, 20, 10, 10), returnNote([{ ref: '4', text: 'לוגו' }], IL(2026, 10, 20, 18)));
  mark(w, b, fixedKey('', 'graphics', 1), IL(2026, 10, 20, 10, 50));
  const q = qaQueue({ clients: w.clients, stateOf: stateOfW(w, now), checks: w.checks, now });
  assert.deepEqual(q.map((x) => [x.client.name, x.kind, x.pre, x.round]), [['ב', 'videos', 'r2.', 1], ['א', 'videos', '', 1], ['ב', 'graphics', '', 2]]);
  assert.equal(q[0].waited, 90);
  assert.equal(q[0].late, true);
  assert.equal(q[1].late, false);
  assert.equal(q[2].rounds.length, 1);
  // Returned work leaves the queue and shows as "at the fixer".
  mark(w, a, returnKey('', 'videos', 1), IL(2026, 10, 20, 10, 45), returnNote([{ ref: '1', text: 'x' }], null));
  const f = qaFixing({ clients: w.clients, stateOf: stateOfW(w, now), checks: w.checks });
  assert.deepEqual(f.map((x) => [x.client.name, x.who]), [['א', 'nadia']]);
  assert.equal(qaQueue({ clients: w.clients, stateOf: stateOfW(w, now), checks: w.checks, now }).length, 2);
});

// ── Assignment (22א) ────────────────────────
test('preselection: Nirel for Natali; another editor needs a reason; a joint day always needs one', () => {
  assert.equal(preselected('natali'), 'nirel');
  assert.equal(preselected('natali', true), null);
  assert.equal(preselected('dms'), null);
  assert.equal(reasonNeeded({ shootType: 'natali', editor: 'nirel' }), false);
  assert.equal(reasonNeeded({ shootType: 'natali', editor: 'nadia' }), true);
  assert.equal(reasonNeeded({ shootType: 'dms', editor: 'nadia' }), false);
  assert.equal(reasonNeeded({ shootType: 'natali', joint: true, editor: 'nirel' }), true);
  assert.equal(reasonNeeded({ shootType: 'natali', editor: null }), false);
  assert.equal(jointFromSelection({ free: { simeonJoin: true } }), true);
  assert.equal(jointFromSelection(null), false);
});

test('waiting for an editor: the client\'s shoot and a round\'s, once the shoot day is closed', () => {
  const w = world();
  const now = IL(2026, 10, 19, 10);
  const c = client(w, { shoot_at: IL(2026, 10, 18, 10).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString() });
  for (const id of ['p01', 'p02', 'p03', 'p04', 'p05', 'p05b', 'p06', 'p07', 'p07a', 'p07b', 'p08', 'p08b', 'p09', 'p10', 'p11', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19b', 'p21']) marks(w, c, itemsOf(id), IL(2026, 10, 18, 9), IMPORT_NOTE);
  assert.equal(awaitingEditor({ clients: w.clients, stateOf: stateOfW(w, now), checks: w.checks }).length, 0);
  marks(w, c, itemsOf('p19'), IL(2026, 10, 18, 16));
  const list = awaitingEditor({ clients: w.clients, stateOf: stateOfW(w, now), checks: w.checks });
  assert.deepEqual(list.map((x) => [x.pre, x.n]), [['', null]]);
});

test('editor load: "יום X מתוך 3", 4 once the videos are with Ofir; paused jobs; tasks; Ofir\'s proposal', () => {
  const w = world();
  const now = IL(2026, 10, 21, 10); // Wednesday: day 3 of an assignment on Sunday
  const a = editingClient(w, { name: 'א' });
  const b = editingClient(w, { name: 'ב', editor: 'yariv' });
  mark(w, b, 'p24.notify', IL(2026, 10, 20, 17));
  const c = editingClient(w, { name: 'ג', editor: 'yariv' });
  mark(w, c, 'p22.pause', IL(2026, 10, 20, 10), JSON.stringify({ stage: 'חצי', left: '5' }));
  w.tasks.push({ id: 't1', client_id: a.id, owner: 'anna', title: 'x', done_at: null });
  const load = editorLoad({ clients: w.clients, stateOf: stateOfW(w, now), checks: w.checks, tasks: w.tasks, now });
  assert.deepEqual(load.nadia.jobs.map((j) => [j.client.name, j.day, j.of]), [['א', 3, 3]]);
  assert.deepEqual(load.yariv.jobs.map((j) => [j.client.name, j.of, !!j.paused]).sort(), [['ב', 4, false], ['ג', 3, true]]);
  assert.equal(load.yariv.paused, 1);
  assert.equal(load.anna.tasks, 1);
  assert.equal(loadText(load.yariv), '2 לקוחות בעריכה · אחת עצורה');
  assert.equal(proposeEditor(load, 'dms', ['yariv']), 'anna');
  assert.equal(proposeEditor(load, 'natali', ['yariv']), 'nirel');
  assert.equal(dayText(0, 3), 'שויך היום');
  assert.equal(dayText(2, 3), 'יום 2 מתוך 3');
  assert.equal(editingDay(IL(2026, 10, 22, 15), IL(2026, 10, 25, 9)), 1); // Thursday → Sunday is day 1
  // The folder task (24): the end of editing day 1 (Thursday's assignment → Sunday).
  assert.equal(folderDueOn(IL(2026, 10, 22, 15)), '2026-10-25');
  assert.equal(folderDueOn(IL(2026, 10, 20, 11)), '2026-10-21');
});

test('Ofir\'s characterizations today, first first', () => {
  const w = world();
  const now = IL(2026, 10, 20, 8);
  client(w, { name: 'מאוחר', char_at: IL(2026, 10, 20, 14).toISOString() });
  client(w, { name: 'מוקדם', char_at: IL(2026, 10, 20, 9).toISOString() });
  client(w, { name: 'של ליאור', characterizer: 'lior', char_at: IL(2026, 10, 20, 11).toISOString() });
  client(w, { name: 'מחר', char_at: IL(2026, 10, 21, 9).toISOString() });
  assert.deepEqual(charsToday({ clients: w.clients, stateOf: stateOfW(w, now), now }).map((x) => x.client.name), ['מוקדם', 'מאוחר']);
});

// ── The deadlines Lior moves ────────────────
test('a shift mark moves the editing deadlines (22, 24, 27) by business days', () => {
  const w = world();
  const c = editingClient(w);
  const now = IL(2026, 10, 20, 10);
  const due = (id) => hhmm(clientState(c, w.checks[c.id], now).states.find((s) => s.proc.id === id).dueAt);
  assert.deepEqual(['p22', 'p24', 'p27'].map(due), ['21.10 18:00', '21.10 18:00', '22.10 18:00']);
  mark(w, c, SHIFT_KEY(''), IL(2026, 10, 20, 9), shiftNote(2, 'עצירה'));
  assert.deepEqual(['p22', 'p24', 'p27'].map(due), ['25.10 18:00', '25.10 18:00', '26.10 18:00']);
  mark(w, c, SHIFT_KEY(''), IL(2026, 10, 20, 9), JSON.stringify({ days: 99 }));
  assert.equal(due('p24'), '21.10 18:00');
});

// ── The pass over the clients (33) ──────────
test('stuck: late more than 2 business days, 5 business days idle, past the recheck date', () => {
  const w = world();
  const now = IL(2026, 10, 22, 10);
  const c = client(w, { deal_at: IL(2026, 10, 1, 10).toISOString(), created_at: IL(2026, 10, 1, 10).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString() });
  const s = clientState(c, w.checks[c.id] || {}, now);
  const got = stuckOf(c, s, { checks: {} }, now);
  assert.deepEqual(got.map((x) => x.code), ['late', 'idle']);
  const w2 = world();
  const d = client(w2, { deal_at: IL(2026, 10, 20, 9).toISOString(), created_at: IL(2026, 10, 20, 9).toISOString() });
  mark(w2, d, 'p01.wait', IL(2026, 10, 20, 9, 30), JSON.stringify({ reason: 'חוזה', recheck: '2026-10-21' }));
  const s2 = clientState(d, w2.checks[d.id], now);
  assert.deepEqual(stuckOf(d, s2, { checks: w2.checks[d.id] }, now).map((x) => x.code), ['recheck']);
  assert.deepEqual(stuckOf(d, s2, { checks: w2.checks[d.id] }, IL(2026, 10, 21, 10)).map((x) => x.code), []);
});

test('pass list: risk first, what changed since the last pass, attention only where needed, one button for the rest', () => {
  const e = (id, name, color, codes = [], index = 2) => ({
    client: { id, name }, health: { color, reasons: codes.map((code) => ({ code, text: `סיבה ${code}` })) }, station: { index },
  });
  const now = [e('a', 'אדום', 'red', ['late']), e('b', 'ירוק שהשתנה', 'green', [], 3), e('c', 'צהוב', 'yellow', ['waiting']), e('d', 'ירוק', 'green'), e('n', 'חדש', 'green')];
  const prev = snapshotOf([e('a', '', 'yellow', ['late-soon']), e('b', '', 'yellow', ['quiet'], 2), e('c', '', 'yellow', ['waiting']), e('d', '', 'green')]);
  assert.deepEqual(changesOf(prev.a, now[0]).texts, ['השתנה מצהוב לאדום', 'חדש: סיבה late', 'נפתר: איחור']);
  assert.deepEqual(changesOf(prev.b, now[1]).texts, ['השתנה מצהוב לירוק', 'נפתר: אין פעילות', 'עבר לתחנה: יום צילום']);
  assert.deepEqual(changesOf(undefined, now[4]), { isNew: true, texts: ['לקוח חדש מאז המעבר הקודם'] });
  assert.deepEqual(changesOf(undefined, now[4], false).texts, []);
  const rows = passRows(now, { prev, stuck: (x) => (x.client.id === 'c' ? [{ code: 'idle', text: 'x' }] : []) });
  assert.deepEqual(rows.map((r) => [r.client.id, r.attention]), [['a', true], ['c', true], ['n', true], ['b', true], ['d', false]]);
  const p = passProgress(rows, { a: { how: 'seen' } });
  assert.deepEqual([p.total, p.attention, p.handled, p.restOpen.length, p.complete], [5, 4, 1, 1, false]);
  // The stuck one ('c') is not closed by a bare "עברתי" (Ofir's stage 11; tests/pass-stuck-swap.test.mjs): it needs its action.
  const bare = passProgress(rows, Object.fromEntries(rows.map((r) => [r.client.id, { how: 'rest' }])));
  assert.deepEqual([bare.complete, bare.open.map((r) => r.client.id)], [false, ['c']]);
  const all = passProgress(rows, { ...Object.fromEntries(rows.map((r) => [r.client.id, { how: 'rest' }])), c: { how: 'task', task: 't' } });
  assert.equal(all.complete, true);
  // Without a previous pass, only red, yellow and stuck need action.
  assert.deepEqual(passRows(now, {}).filter((r) => r.attention).map((r) => r.client.id), ['a', 'c']);
});

test('pass due: at least every other business day, always on Thursday; the previous completed pass', () => {
  const r = (day) => ({ day, kind: 'p33' });
  assert.equal(passDue([r('2026-10-19')], IL(2026, 10, 20, 9)).due, false); // Tuesday after Monday
  assert.equal(passDue([r('2026-10-19')], IL(2026, 10, 21, 9)).due, true);  // two business days
  assert.equal(passDue([r('2026-10-21')], IL(2026, 10, 22, 9)).due, true);  // Thursday: the full pass
  assert.equal(passDue([r('2026-10-22')], IL(2026, 10, 22, 16)).doneToday, true);
  assert.equal(passDue([], IL(2026, 10, 20, 9)).due, true);
  assert.equal(passDue([], IL(2026, 10, 23, 9)).due, false); // Friday
  const passes = [{ day: '2026-10-19', completed_at: 'x', snapshot: { a: 1 } }, { day: '2026-10-20', completed_at: null, snapshot: {} }, { day: '2026-10-21', completed_at: 'x', snapshot: {} }];
  assert.equal(previousPass(passes, IL(2026, 10, 21, 12)).day, '2026-10-19');
  assert.equal(previousPass(passes, IL(2026, 10, 22, 12)).day, '2026-10-21');
  assert.equal(thursdayTarget(IL(2026, 10, 22, 12)).late, false);
  assert.equal(thursdayTarget(IL(2026, 10, 22, 13)).late, true);
  assert.equal(thursdayTarget(IL(2026, 10, 21, 12)), null);
});

test('data health: a shared process nobody took, a task without a due date, a shoot without an editor', () => {
  const w = world();
  const now = IL(2026, 10, 20, 16);
  // Shot yesterday, an editor chosen in the card but the assignment (22א, Ofir's or Lior's) not taken by anyone.
  const c = client(w, { editor: 'nadia', shoot_at: IL(2026, 10, 18, 10).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString() });
  for (const id of ['p01', 'p02', 'p03', 'p04', 'p05', 'p05b', 'p06', 'p07', 'p07a', 'p07b', 'p08', 'p08b', 'p09', 'p10', 'p11', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p21']) marks(w, c, itemsOf(id), IL(2026, 10, 18, 9), IMPORT_NOTE);
  w.tasks.push({ id: 't1', client_id: c.id, owner: 'irit', title: 'בלי מועד', done_at: null, due_on: null });
  const d = client(w, { shoot_at: IL(2026, 10, 18, 10).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString() });
  for (const id of ['p01', 'p02', 'p03', 'p04', 'p05', 'p05b', 'p06', 'p07', 'p07a', 'p07b', 'p08', 'p08b', 'p09', 'p10', 'p11', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p21']) marks(w, d, itemsOf(id), IL(2026, 10, 18, 9), IMPORT_NOTE);
  const h = dataHealth({ clients: w.clients, stateOf: stateOfW(w, now), checks: w.checks, tasks: w.tasks, now });
  assert.deepEqual(h.unowned.map((x) => [x.client.id, x.state.proc.id, x.owner]), [[c.id, 'p22a', 'ofir']]);
  assert.deepEqual(h.noDue.map((x) => x.task.id), ['t1']);
  assert.deepEqual(h.noEditor.map((x) => x.client.id), [d.id]);
  assert.equal(h.dueFix, '2026-10-21');
});

test('the Thursday summary, prefilled from the system: state, what is missing, owner, due, next action', () => {
  const w = world();
  const now = IL(2026, 10, 22, 10);
  const c = editingClient(w);
  marks(w, c, itemsOf('p23'), IL(2026, 10, 19, 12)); // the rest of the graphics are done
  const s = clientState(c, w.checks[c.id], now);
  const st = station(c, s, { now, checks: w.checks[c.id] });
  const d = summaryDraft(c, s, st, w.checks[c.id], [], now);
  assert.match(d.current, /^עריכה ובקרה · 22 · עריכת הסרטונים/);
  assert.match(d.missing, /באיחור: 22 · עריכת הסרטונים/);
  assert.equal(d.owner, 'nadia');
  assert.equal(d.due_on, '2026-10-21');
  assert.equal(d.next, '22 · עריכת הסרטונים');
});

// ── Lior: urgent tasks, exceptions, paused editing, the campaign check ──
test('urgent: "התחלתי" within 30 office minutes, or it is back with Lior (decision 9)', () => {
  const t = { created_at: IL(2026, 10, 20, 17, 45).toISOString(), started_at: null };
  assert.equal(hhmm(urgentState(t, IL(2026, 10, 20, 18)).deadline), '21.10 09:15'); // office time only
  assert.equal(urgentState(t, IL(2026, 10, 21, 9, 14)).returned, false);
  assert.equal(urgentState(t, IL(2026, 10, 21, 9, 15)).returned, true);
  assert.equal(urgentState({ ...t, started_at: IL(2026, 10, 21, 9, 20).toISOString() }, IL(2026, 10, 21, 10)).returned, false);
});

test('an exception\'s fixed path: reason → decision → next action (a linked task) → close', () => {
  assert.deepEqual(parseReport('לקוח מתלונן (תהליך 25 · בקרת איכות על הסרטונים): הלקוח כועס על הכתוביות'), { reason: 'לקוח מתלונן', proc: 'תהליך 25 · בקרת איכות על הסרטונים', details: 'הלקוח כועס על הכתוביות' });
  assert.deepEqual(parseReport('משהו אחר'), { reason: '', proc: '', details: 'משהו אחר' });
  const task = { id: 't', client_id: 'c', title: 'משימה תקועה: x', done_at: null };
  assert.equal(exceptionPath(task, null).step, 'reason');
  assert.equal(exceptionPath(task, { reason: 'x' }).step, 'decision');
  assert.equal(exceptionPath(task, { reason: 'x', decision: 'y' }).step, 'next');
  const ready = exceptionPath(task, { reason: 'x', decision: 'y', next_task_id: 'n' });
  assert.deepEqual([ready.step, ready.ready], ['close', true]);
  assert.equal(exceptionPath({ ...task, done_at: 'z' }, { reason: 'x', decision: 'y', next_task_id: 'n' }).step, null);
  assert.equal(linkedTitle('להתקשר ללקוח', task), 'להתקשר ללקוח (בעקבות חריגה: משימה תקועה)');
});

test('editing still paused the next morning: Lior decides; a round\'s editor changes in its rounds', () => {
  const w = world();
  const c = editingClient(w, { name: 'עצור' });
  mark(w, c, 'p22.pause', IL(2026, 10, 20, 15), JSON.stringify({ stage: 'x', left: 'y' }));
  const d = editingClient(w, { name: 'עצר היום' });
  mark(w, d, 'p22.pause', IL(2026, 10, 21, 8), JSON.stringify({ stage: 'x', left: 'y' }));
  const now = IL(2026, 10, 21, 9);
  const list = pausedSinceYesterday({ clients: w.clients, stateOf: stateOfW(w, now), checks: w.checks, now });
  assert.deepEqual(list.map((x) => [x.client.name, x.pre, x.editor, x.decidedToday]), [['עצור', '', 'nadia', false]]);
  mark(w, c, 'p22.decision', IL(2026, 10, 21, 9, 5), '{}');
  assert.equal(pausedSinceYesterday({ clients: w.clients, stateOf: stateOfW(w, now), checks: w.checks, now })[0].decidedToday, true);
  assert.deepEqual(withEditor({ rounds: [{ n: 2, editor: 'nadia' }, { n: 3, editor: 'anna' }] }, 2, 'yariv'), { rounds: [{ n: 2, editor: 'yariv' }, { n: 3, editor: 'anna' }] });
  assert.deepEqual(withEditor({}, null, 'yariv'), { editor: 'yariv' });
});

test('the weekly campaign check: from Tuesday until marked that week (decision 21)', () => {
  assert.equal(campaignCheck([], IL(2026, 10, 19, 10)).show, false);
  assert.deepEqual([campaignCheck([], IL(2026, 10, 20, 10)).show, campaignCheck([], IL(2026, 10, 20, 10)).late], [true, false]);
  assert.equal(campaignCheck([], IL(2026, 10, 21, 10)).late, true);
  assert.ok(campaignCheck([{ day: '2026-10-20', kind: 'campaigns' }], IL(2026, 10, 21, 10)).done);
  assert.equal(campaignCheck([{ day: '2026-10-13', kind: 'campaigns' }], IL(2026, 10, 21, 10)).done, null);
});

// ── Ilai ────────────────────────────────────
test('Ilai\'s characterization day: one line per client with the nearest due; the vault statuses check the access', () => {
  const w = world();
  const now = IL(2026, 10, 20, 12, 10);
  const c = client(w, { name: 'חדש', char_at: IL(2026, 10, 20, 10).toISOString(), has_logo: false });
  marks(w, c, [...itemsOf('p01'), ...itemsOf('p02'), ...itemsOf('p03')], IL(2026, 10, 19, 12));
  marks(w, c, itemsOf('p04'), IL(2026, 10, 20, 12));
  mark(w, c, 'p05.access', IL(2026, 10, 20, 12));
  const rows = [{ status: 'ok', updated_at: IL(2026, 10, 20, 12, 5).toISOString() }, { status: 'missing', updated_at: IL(2026, 10, 20, 12, 6).toISOString() }];
  assert.equal(accessChecked(rows, IL(2026, 10, 20, 12)), true);
  assert.equal(accessChecked([{ status: 'ok', updated_at: IL(2026, 10, 20, 11).toISOString() }], IL(2026, 10, 20, 12)), false);
  assert.equal(accessChecked([], IL(2026, 10, 20, 12)), false);
  const card = charDay({ clients: w.clients, stateOf: stateOfW(w, now), checks: w.checks, access: { [c.id]: rows }, now });
  // A day later what is still open is in his list as late, not in the day's card.
  assert.equal(charDay({ clients: w.clients, stateOf: stateOfW(w, IL(2026, 10, 21, 12, 30)), checks: w.checks, now: IL(2026, 10, 21, 12, 30) }).length, 0);
  assert.equal(card.length, 1);
  assert.deepEqual(card[0].lines.map((l) => l.key), ['access', 'page', 'graphics', 'gantt', 'logo']);
  assert.equal(card[0].next.key, 'gantt'); // 5 minutes after the meeting: the nearest
  assert.equal(hhmm(card[0].next.due), '20.10 12:05');
  assert.equal(card[0].lines[0].auto, true);
  // Everything done: the card is gone.
  marks(w, c, ['p06.verified', ...PAGE_KEYS, 'p06.metricool', 'p07.made', ...GANTT_KEYS, 'p05.newlogo'], IL(2026, 10, 20, 13));
  assert.equal(charDay({ clients: w.clients, stateOf: stateOfW(w, now), checks: w.checks, now }).length, 0);
});

test('Ilai after the day: the rest of the graphics, the final versions to receive, the Gantt to fill', () => {
  const w = world();
  const now = IL(2026, 10, 22, 10);
  const c = editingClient(w);
  mark(w, c, 'p27.final', IL(2026, 10, 22, 9));
  const got = ilaiWork({ clients: w.clients, stateOf: stateOfW(w, now), checks: w.checks });
  assert.deepEqual(got.finals.map((x) => x.client.id), [c.id]);
  assert.equal(got.rest.length, 1);
  assert.equal(got.rest[0].qa.stage, 'none');
});

test('history lines of the marks, in words', () => {
  assert.equal(describeOfficeMark('p25.return.2', 'done', returnNote([{ ref: '1', text: 'a' }, { ref: '2', text: 'b' }], null)), 'החזיר/ה לתיקון את הסרטונים: סבב 2, 2 בעיות');
  assert.equal(describeOfficeMark('p23.fixed.1', 'done', null), 'התיקונים מוכנים וחזרו לבדיקה של אופיר (יתרת הגרפיקות, סבב 1)');
  assert.equal(describeOfficeMark('p25.fixed.1.0', 'done', null), 'סימן/ה תיקון (הסרטונים, סבב 1, שורה 1)');
  assert.match(describeOfficeMark('p22a.reason', 'done', JSON.stringify({ editor: 'nadia', reason: 'ניראל עמוסה' })), /נדיה.*ניראל עמוסה/);
  assert.equal(describeOfficeMark('p06.fixed.instagram', 'done', accessFixNote({ partial: true, missing: 'אימות דו־שלבי' })), 'סגר/ה גישה שבורה כתוקנה חלקית (instagram). עדיין חסר: אימות דו־שלבי');
  assert.equal(describeOfficeMark('p05.access', 'done', null), null);
});

// ── The reminder ladders ────────────────────
test('QA ladder: the fixes ready start a new check for Ofir; a return rings the fixer, Lior after the due, the owner on round 2', () => {
  const w = world();
  const c = editingClient(w, { name: 'עריכה' });
  mark(w, c, 'p24.notify', IL(2026, 10, 20, 10));
  one(due(w, IL(2026, 10, 20, 10)), 'qa', 'now', 'ofir');
  mark(w, c, returnKey('', 'videos', 1), IL(2026, 10, 20, 10, 30), returnNote([{ ref: '2', text: 'חיתוך' }], IL(2026, 10, 20, 18)));
  let list = due(w, IL(2026, 10, 20, 10, 31));
  none(list, 'qa');
  const now = one(list, 'qaReturn', 'now', 'nadia');
  assert.equal(now.title, 'הוחזר לתיקון (סבב 1): עריכה');
  assert.match(now.body, /בעיה אחת מאופיר\. לתקן עד היום 18:00/);
  none(list, 'qaReturn', 'late');
  none(list, 'qaReturn', 'board');
  const late = one(due(w, IL(2026, 10, 20, 18)), 'qaReturn', 'late', 'lior');
  assert.equal(late.list, true);
  mark(w, c, fixedKey('', 'videos', 1), IL(2026, 10, 20, 12));
  list = due(w, IL(2026, 10, 20, 12, 1));
  none(list, 'qaReturn');
  const again = one(list, 'qa', 'now', 'ofir');
  assert.equal(again.title, 'התיקונים מוכנים לבדיקה (סבב 1): עריכה');
  mark(w, c, returnKey('', 'videos', 2), IL(2026, 10, 20, 12, 30), returnNote([{ ref: '2', text: 'עדיין' }], null));
  list = due(w, IL(2026, 10, 20, 12, 31));
  one(list, 'qaReturn', 'board', 'owner');
  none(list, 'qaReturn', 'late'); // no due date given
  // Graphics: returned to Ilai, fixed, back to Ofir.
  const g = editingClient(w, { name: 'גרפיקות' });
  mark(w, g, 'p23.made', IL(2026, 10, 20, 9));
  one(due(w, IL(2026, 10, 20, 9)), 'graphicsRest', 'ofir', 'ofir');
  mark(w, g, returnKey('', 'graphics', 1), IL(2026, 10, 20, 9, 30), returnNote([{ ref: '5', text: 'לוגו ישן' }], IL(2026, 10, 20, 18)));
  list = due(w, IL(2026, 10, 20, 9, 31)).filter((r) => r.clientId === g.id);
  none(list, 'graphicsRest');
  one(list, 'qaReturn', 'now', 'ilai');
  mark(w, g, fixedKey('', 'graphics', 1), IL(2026, 10, 20, 11));
  const back = one(due(w, IL(2026, 10, 20, 11, 1)).filter((r) => r.clientId === g.id), 'graphicsRest', 'ofir', 'ofir');
  assert.match(back.title, /^התיקונים מוכנים לבדיקה \(סבב 1\)/);
});

test('nobody to go to a characterization: Lior rings, Irit is told (quiet)', () => {
  const w = world();
  const c = client(w, { name: 'אפיון' });
  w.tasks.push({ id: 't1', client_id: c.id, owner: 'lior', title: 'אין מי שייצא לאפיון: ה׳ 22.10 10:00 · הרצל 1', urgent: false, source: 'escalation', done_at: null, created_at: IL(2026, 10, 20, 10).toISOString() });
  const list = due(w, IL(2026, 10, 20, 10));
  one(list, 'exception', 'nobody', 'lior');
  const irit = one(list, 'exception', 'nobodyIrit', 'irit');
  assert.equal(irit.level, 'quiet');
  none(list, 'exception', 'list');
});

test('the weekly campaign check stops once Lior marked it this week', () => {
  const w = world();
  const c = client(w, { name: 'קמפיין' });
  marks(w, c, itemsOf('p30'), IL(2026, 10, 1, 10), IMPORT_NOTE);
  one(due(w, IL(2026, 10, 20, 8, 30)), 'campaignCheck', 'tue', 'lior');
  w.reviews.push({ day: '2026-10-20', kind: 'campaigns' });
  none(due(w, IL(2026, 10, 20, 8, 30)), 'campaignCheck');
});

test('broken login: closed partly stops the rings to Lior (the owner still follows it); Irit and Ilai are told', () => {
  const w = world();
  const c = client(w, { name: 'גישה' });
  const at = IL(2026, 10, 20, 10);
  w.access.push({ id: 'a1', client_id: c.id, network: 'instagram', status: 'broken', updated_at: at.toISOString() });
  one(due(w, IL(2026, 10, 20, 10)), 'broken', 'now', 'lior');
  mark(w, c, accessFixedKey('instagram'), IL(2026, 10, 20, 10, 20), accessFixNote({ partial: true, missing: 'קוד אימות', access: 'a1' }));
  w.access[0].updated_at = IL(2026, 10, 20, 10, 19).toISOString();
  let list = due(w, IL(2026, 10, 20, 13));
  none(list, 'broken', 'now');
  none(list, 'broken', 'again');
  one(due(w, IL(2026, 10, 21, 10, 19)), 'broken', 'board', 'owner');
  list = due(w, IL(2026, 10, 20, 10, 21));
  const irit = one(list, 'accessClosed', 'irit', 'irit');
  assert.equal(irit.title, 'גישה תוקנה חלקית: גישה');
  assert.equal(irit.body, 'Instagram. עדיין חסר: קוד אימות');
  one(list, 'accessClosed', 'ilai', 'ilai');
});

test('the final versions: Ilai (quiet) at once; Lior\'s list if no "קיבלתי" by the end of that business day', () => {
  const w = world();
  const c = editingClient(w, { name: 'סופי' });
  mark(w, c, 'p27.final', IL(2026, 10, 22, 11));
  one(due(w, IL(2026, 10, 22, 11)), 'finalReady', 'ilai', 'ilai');
  none(due(w, IL(2026, 10, 22, 17, 59)), 'finalReady', 'lior');
  one(due(w, IL(2026, 10, 22, 18)), 'finalReady', 'lior', 'lior');
  mark(w, c, 'p27.toilai', IL(2026, 10, 22, 12));
  none(due(w, IL(2026, 10, 22, 18)), 'finalReady');
});

test('editing reminders follow the deadlines Lior moved', () => {
  const w = world();
  const c = editingClient(w, { name: 'הוזז' });
  one(due(w, IL(2026, 10, 21, 15)), 'editing', 'day3pm', 'nadia');
  mark(w, c, SHIFT_KEY(''), IL(2026, 10, 20, 9), shiftNote(1));
  none(due(w, IL(2026, 10, 21, 15)), 'editing', 'day3pm');
  one(due(w, IL(2026, 10, 22, 15)), 'editing', 'day3pm', 'nadia');
});

test('the colour rules still see a returned piece of work (health.js unchanged)', () => {
  const w = world();
  const c = editingClient(w);
  const now = IL(2026, 10, 20, 12);
  const s = clientState(c, w.checks[c.id], now);
  assert.ok(['green', 'yellow', 'red'].includes(clientHealth(c, s, { now, checks: w.checks[c.id] }).color));
  assert.equal(dayKeyIL(now), '2026-10-20');
});

test('the team screen counts Ofir\'s returns as returns to fix (once each), for the editor and for Ilai', async () => {
  const { reworkCounts, historyKeys } = await import('../app/health.js');
  const c = { id: 'c1', name: 'x', status: 'active', shoot_type: 'dms', editor: 'nadia', rounds: [{ n: 2, editor: 'anna', shoot_type: 'dms' }], has_logo: true };
  const row = (k, at, action = 'done') => ({ client_id: 'c1', item_key: k, action, note: null, by_email: 'x', at });
  const log = [
    row('p24.notify', '2026-10-20T07:00:00Z'), row('p25.return.1', '2026-10-20T07:30:00Z'),
    row('p24.notify', '2026-10-20T08:00:00Z'), // handed in again after the return: the same return
    row('p25.return.2', '2026-10-20T09:00:00Z'),
    row('r2.p24.notify', '2026-10-21T07:00:00Z'), row('r2.p25.return.1', '2026-10-21T08:00:00Z'),
    row('p23.made', '2026-10-20T07:00:00Z'), row('p23.return.1', '2026-10-20T08:00:00Z'),
  ];
  const got = reworkCounts([c], log);
  assert.equal(got.get('nadia'), 2);
  assert.equal(got.get('anna'), 1);
  assert.equal(got.get('ilai'), 1);
  const keys = historyKeys([c]);
  assert.ok(keys.includes('p25.return.1') && keys.includes('r2.p25.return.6') && keys.includes('p23.return.3'));
});

test('the folder task stands for item 24 of its shoot', async () => {
  const { folderItemOf, folderTitle } = await import('../app/qa-logic.js');
  assert.equal(folderItemOf({ title: folderTitle() }), 'p24.folder');
  assert.equal(folderItemOf({ title: folderTitle(2) }), 'r2.p24.folder');
  assert.equal(folderItemOf({ title: 'משהו אחר' }), null);
});
