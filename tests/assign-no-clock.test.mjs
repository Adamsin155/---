// No clock on the editor's assignment (the owner, 30.10.2026; docs/ops.md): 22א is never late
// and has no ring per client. Ofir hears once at 12:00 on a working day while clients wait, he
// chooses the editing time when he assigns, and the videos still missing (Ofir's sheet) are shown
// to him and to the editor. The owners see the queue in the 19:00 summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders, planDelivery } from '../app/reminder-engine.js';
import { PROCESSES, PROTOCOL_VERSION } from '../app/protocol.js';
import { clientState, IMPORT_NOTE, addBusinessDays } from '../app/protocol-logic.js';
import { awaitingEditor, editingChoices, editingShift, editingChoiceText } from '../app/qa-logic.js';
import { TODO_KEY, todoNote, readTodo, todoText, SHIFT_KEY, shiftNote, describeOfficeMark } from '../app/office-marks.js';
import { daySummary, assignText, pushLines, EMPTY_DAY } from '../app/day-summary.js';
import { importKeys } from '../app/client-open.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const STAFF = [{ email: 'ofir@x', person: 'ofir' }, { email: 'anna@x', person: 'anna' }, { email: 'irit@x', person: 'irit' }];
let seq = 0;
const world = () => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, deals: [] });
const mark = (w, c, key, at, note = null) => { (w.checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state: 'done', note, at: at.toISOString(), by_email: 'x@x' }; };
const itemsOf = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key);
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const stateOf = (w, c, now) => clientState(c, w.checks[c.id] || {}, now);
const proc = (w, c, id, now) => stateOf(w, c, now).states.find((s) => s.proc.id === id);
// Ofir's; Irit gets the same ring (5.11.2026), checked once below.
const rows = (w, now) => due(w, now).filter((r) => r.rule === 'assign12' && r.person === 'ofir');

// A client whose shoot day was closed on Thursday 15.10.2026 at 17:00, waiting for an editor.
function waiting(w, o = {}) {
  seq += 1;
  const c = {
    id: `c${seq}`, name: `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, protocol_version: PROTOCOL_VERSION, rounds: [], contract_end: '2027-12-31',
    deal_at: IL(2026, 9, 1, 10).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 15, 10).toISOString(), created_by_email: 'irit@x', ...o,
  };
  w.clients.push(c);
  for (const k of importKeys('post')) mark(w, c, k, IL(2026, 9, 1, 9), IMPORT_NOTE);
  for (const id of ['p22a', 'p22', 'p23', 'p23b', 'p24', 'p25', 'p26', 'p27']) for (const i of PROCESSES.find((p) => p.id === id).items) delete w.checks[c.id][i.key];
  for (const k of itemsOf('p19')) mark(w, c, k, IL(2026, 10, 15, 17));
  return c;
}
const assign = (w, c, editor, at) => { c.editor = editor; for (const k of itemsOf('p22a')) mark(w, c, k, at); };

test('22א has no due and is never late, however long it waits', () => {
  const w = world();
  const c = waiting(w);
  const s = proc(w, c, 'p22a', IL(2027, 1, 10, 10));
  assert.equal(s.dueAt, null);
  assert.equal(s.ready, true);
  assert.notEqual(s.status, 'overdue');
  assert.deepEqual(due(w, IL(2026, 10, 15, 17, 1)).filter((r) => r.rule === 'fast'), []);
});

test('12:00: one ring to Ofir (and one to Irit) on a working day with the count; none on the weekend, none with an empty queue', () => {
  const w = world();
  assert.deepEqual(rows(w, IL(2026, 10, 18, 12)), [], 'nobody waits');
  waiting(w);
  const sunday = IL(2026, 10, 18, 12);
  assert.deepEqual(rows(w, IL(2026, 10, 18, 11, 59)), []);
  const [r] = rows(w, sunday);
  assert.deepEqual([r.person, r.level, r.title, r.url, r.clientId ?? null], ['ofir', 'ring', 'לקוח אחד מחכה לשיוך עורך', 'qa.html#assign-h', null]);
  assert.equal(rows(w, sunday).length, 1);
  assert.deepEqual(due(w, sunday).filter((x) => x.rule === 'assign12').map((x) => x.person).sort(), ['irit', 'ofir'], 'Irit too');
  // Friday and Saturday: nothing.
  for (const t of [IL(2026, 10, 16, 12), IL(2026, 10, 17, 12)]) assert.deepEqual(rows(w, t), []);
  // Several clients are one ring, and it is said once a day.
  waiting(w);
  const [two] = rows(w, sunday);
  assert.equal(two.title, '2 לקוחות מחכים לשיוך עורך');
  assert.deepEqual(due(w, IL(2026, 10, 18, 12, 1), [{ key: two.key }]).filter((x) => x.rule === 'assign12' && x.person === 'ofir'), []);
  assert.equal(rows(w, IL(2026, 10, 19, 12)).length, 1, 'the next working day again');
  // All assigned: nothing.
  for (const c of w.clients) assign(w, c, 'anna', IL(2026, 10, 18, 11));
  assert.deepEqual(rows(w, sunday), []);
});

test('12:00: a client in landing does not count; a queue that fills in the afternoon does not ring at 17:00', () => {
  const w = world();
  waiting(w, { landing: true });
  assert.deepEqual(rows(w, IL(2026, 10, 18, 12)), []);
  waiting(w);
  assert.equal(rows(w, IL(2026, 10, 18, 12))[0].title, 'לקוח אחד מחכה לשיוך עורך');
  // Sent at 12:00. After the noon window the step is gone: the next ring is tomorrow's.
  const now = IL(2026, 10, 18, 12);
  assert.equal(planDelivery({ reminders: rows(w, now), now })[0].status, 'sent');
  assert.equal(rows(w, IL(2026, 10, 18, 12, 29)).length, 1, 'a tick that was missed at 12:00');
  for (const t of [IL(2026, 10, 18, 12, 30), IL(2026, 10, 18, 17)]) assert.deepEqual(rows(w, t), []);
});

test('the editing time: a client of protocol v11 from 2 days, an older one from 3; the days above its own are the shift', () => {
  const now = { protocol_version: PROTOCOL_VERSION };
  const old = { protocol_version: 10 };
  assert.deepEqual(editingChoices(now), [2, 3, 5, 7, 10]);
  assert.deepEqual(editingChoices(old), [3, 5, 7, 10]);
  assert.deepEqual([2, 3, 5, 10].map((d) => editingShift(now, d)), [0, 1, 3, 8]);
  assert.deepEqual([3, 5, 10].map((d) => editingShift(old, d)), [0, 2, 7]);
  assert.equal(editingShift(now, null), 0);
  assert.equal(editingShift(old, 2), 0);
  assert.equal(editingChoiceText(5), '5 ימי עסקים');
});

test('the shift of the chosen time moves the deadlines of 22, 24 and 27 together', () => {
  const w = world();
  const c = waiting(w);
  const at = IL(2026, 10, 18, 10); // Sunday
  assign(w, c, 'anna', at);
  const now = IL(2026, 10, 18, 11);
  const before = Object.fromEntries(['p22', 'p24', 'p27'].map((id) => [id, proc(w, c, id, now).dueAt]));
  mark(w, c, SHIFT_KEY(), at, shiftNote(editingShift(c, 5), 'זמן העריכה שנבחר בשיוך'));
  for (const id of ['p22', 'p24', 'p27']) assert.equal(+proc(w, c, id, now).dueAt, +addBusinessDays(before[id], 3), id);
});

test('the queue: on the same shoot day the most videos left first, a client in landing last', () => {
  const w = world();
  waiting(w, { name: 'בלי כמות' });
  const few = waiting(w, { name: 'מעט' });
  const many = waiting(w, { name: 'הרבה' });
  const land = waiting(w, { name: 'בקליטה', landing: true });
  const at = IL(2026, 10, 18, 10);
  mark(w, few, TODO_KEY(), at, todoNote(5));
  mark(w, many, TODO_KEY(), at, todoNote(43));
  mark(w, land, TODO_KEY(), at, todoNote(100));
  const list = awaitingEditor({ clients: w.clients, stateOf: (c) => stateOf(w, c, at), checks: w.checks });
  assert.deepEqual(list.map((a) => [a.client.name, a.todo]), [['הרבה', 43], ['מעט', 5], ['בלי כמות', 0], ['בקליטה', 100]]);
});

test('the missing videos: read from the mark, in words, in the history', () => {
  assert.equal(readTodo({ state: 'done', note: todoNote(43) }), 43);
  assert.equal(readTodo({ state: 'na', note: todoNote(43) }), 0);
  assert.equal(readTodo({ state: 'done', note: 'לא JSON' }), 0);
  assert.equal(readTodo(undefined), 0);
  assert.equal(todoText(43), 'חסרים 43 סרטונים');
  assert.equal(todoText(1), 'חסר סרטון אחד');
  assert.equal(TODO_KEY('r2.'), 'r2.p22a.todo');
  assert.equal(describeOfficeMark('p22a.todo', 'done', todoNote(43)), 'רשם/ה כמה סרטונים חסרים: 43');
});

test('the editor\'s first ring says how many videos are missing, and only when it is known', () => {
  const w = world();
  const at = IL(2026, 10, 18, 10);
  const c = waiting(w);
  mark(w, c, TODO_KEY(), at, todoNote(43));
  assign(w, c, 'anna', at);
  const plain = waiting(w);
  assign(w, plain, 'anna', at);
  const ring = (x) => due(w, at).find((r) => r.rule === 'editing' && r.step === 'assigned' && r.clientId === x.id);
  assert.match(ring(c).body, /חסרים 43 סרטונים/);
  assert.doesNotMatch(ring(plain).body, /חסר/);
});

test('the 19:00 summary: how many wait and the oldest, also on a day with nothing else; none when nobody waits', () => {
  const w = world();
  const sum = (now) => daySummary({ clients: w.clients, checksOf: (c) => w.checks[c.id] || {}, stateOf: (c) => stateOf(w, c, now), tasks: [], personOf: () => null, now, meetings: [] });
  const now = IL(2026, 10, 20, 19);
  const empty = sum(now);
  assert.equal(empty.assign, null);
  assert.equal(assignText(empty), '');
  assert.deepEqual(pushLines(empty), [EMPTY_DAY]);
  const c = waiting(w, { name: 'ותיק' });
  const s = sum(now);
  assert.equal(s.assign.n, 1);
  assert.equal(s.assign.name, 'ותיק');
  assert.equal(s.assign.days, 5);
  assert.equal(assignText(s), 'מחכים לשיוך עורך: 1, הכי ותיק 5 ימים (ותיק)');
  assert.ok(pushLines(s).includes(assignText(s)));
  assert.equal(pushLines(s).at(-1), assignText(s));
  // On the day itself no "הכי ותיק" is said; assigned: gone.
  assert.equal(assignText({ assign: { n: 2, days: 0, name: 'x' } }), 'מחכים לשיוך עורך: 2');
  assert.equal(assignText({ assign: { n: 2, days: 1, name: 'x' } }), 'מחכים לשיוך עורך: 2, הכי ותיק יום אחד (x)');
  assign(w, c, 'anna', now);
  assert.equal(sum(now).assign, null);
});

test('the queue: the oldest shoot first (the owner, 9.11.2026), a shoot with no date after the dated, landing last', () => {
  const w = world();
  const late = waiting(w, { name: 'צילום אחרון', shoot_at: IL(2026, 10, 15, 10).toISOString() });
  const early = waiting(w, { name: 'צילום ראשון', shoot_at: IL(2026, 10, 12, 10).toISOString() });
  waiting(w, { name: 'בקליטה', landing: true, shoot_at: IL(2026, 10, 1, 10).toISOString() });
  const at = IL(2026, 10, 18, 10);
  mark(w, late, TODO_KEY(), at, todoNote(43)); // more videos left does not jump an older shoot
  const list = awaitingEditor({ clients: w.clients, stateOf: (c) => stateOf(w, c, at), checks: w.checks });
  assert.deepEqual(list.map((a) => a.client.name), ['צילום ראשון', 'צילום אחרון', 'בקליטה']);
  void early;
  // A shoot with no date goes after the dated ones (a stub state: 22א open and ready).
  const one = (id, shootAt) => ({ id, name: id, status: 'active', shoot_at: shootAt });
  const ready = (c) => ({ states: [{ proc: { id: 'p22a', keyBase: 'p22a', ctx: c }, ready: true, complete: false }] });
  const undated = awaitingEditor({ clients: [one('בלי תאריך', null), one('15.10', IL(2026, 10, 15).toISOString()), one('1.10', IL(2026, 10, 1).toISOString())], stateOf: ready, checks: {} });
  assert.deepEqual(undated.map((a) => a.client.name), ['1.10', '15.10', 'בלי תאריך']);
});

test('a client with two shoot days: back in the queue after the second shoot, until its round is assigned', () => {
  const w = world();
  const c = waiting(w, { name: 'שני ימי צילום', rounds: [{ n: 2, shoot_at: IL(2026, 10, 22, 10).toISOString(), shoot_type: 'dms' }] });
  assign(w, c, 'anna', IL(2026, 10, 18, 10));
  const q = (now) => awaitingEditor({ clients: w.clients, stateOf: (x) => stateOf(w, x, now), checks: w.checks });
  assert.deepEqual(q(IL(2026, 10, 20, 10)), [], 'the first shoot is assigned, the second is ahead');
  const after = q(IL(2026, 10, 22, 19));
  assert.deepEqual(after.map((a) => [a.client.name, a.n, a.pre, a.proc.id]), [['שני ימי צילום', 2, 'r2.', 'r2-p22a']]);
  assert.equal(after[0].ctx.shoot_at, IL(2026, 10, 22, 10).toISOString(), 'ordered by the round\'s own shoot day');
  // Assigned: gone again.
  for (const k of itemsOf('p22a')) mark(w, c, `r2.${k}`, IL(2026, 10, 23, 10));
  assert.deepEqual(q(IL(2026, 10, 23, 11)), []);
  // Only r2.p22a.assigned (Ofir's or Irit's dialog writes load + assigned) is enough to leave the list.
  const d = waiting(w, { name: 'עוד אחד', rounds: [{ n: 2, shoot_at: IL(2026, 10, 22, 10).toISOString(), shoot_type: 'dms' }] });
  assign(w, d, 'anna', IL(2026, 10, 18, 10));
  mark(w, d, 'r2.p22a.assigned', IL(2026, 10, 23, 10));
  assert.deepEqual(q(IL(2026, 10, 23, 11)).map((a) => a.client.name), []);
});
