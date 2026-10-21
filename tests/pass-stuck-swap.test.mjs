// Ofir's pass: a stuck client leaves the check with a clear action (his protocol,
// stage 11), and how long what blocks it has been open (app/pass-logic.js).
// Ofir's screen: changing an assigned editor and what it does to the editing clocks
// (app/qa-logic.js). Israel time; npm test runs this under UTC, New York and Jerusalem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateIL, partsIL } from '../app/tz.js';
import { PROCESSES } from '../app/protocol.js';
import { clientState, IMPORT_NOTE } from '../app/protocol-logic.js';
import {
  stuckOf, passRows, passProgress, closesRow, closeHows, cleanReason, reasonOk, seenText, stuckTitle, STUCK_HOWS, REASON_MIN, REASON_MAX,
  rowLine, passGroups, groupTitle, dataHealth,
} from '../app/pass-logic.js';
import { editorLoad, swapClock, swapReasonNeeded, swapNote, reasonOf } from '../app/qa-logic.js';
import { autoReasonOf } from '../app/auto-assign.js';
import { REASON_KEY, describeOfficeMark } from '../app/office-marks.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
let seq = 0;
const world = () => ({ clients: [], checks: {}, tasks: [] });
function client(w, o = {}) {
  seq += 1;
  const c = {
    id: `c${seq}`, name: o.name || `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
    rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 9, 1, 10).toISOString(), created_at: IL(2026, 9, 1, 10).toISOString(), created_by_email: 'irit@x', ...o,
  };
  w.clients.push(c);
  return c;
}
const mark = (w, c, key, at, note = null) => { (w.checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state: 'done', note, at: at.toISOString(), by_email: 'x@x' }; };
const itemsOf = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key);
const all = (w, c, ids, at, note = null) => { for (const id of ids) for (const k of itemsOf(id)) mark(w, c, k, at, note); };
const UPTO_SHOOT = ['p01', 'p02', 'p03', 'p04', 'p05', 'p05b', 'p06', 'p07', 'p07a', 'p07b', 'p08', 'p08b', 'p09', 'p10', 'p11', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p21'];

// ── The stuck client ────────────────────────
test('stuck: how long what blocks the client has been open, and with whom', () => {
  const now = IL(2026, 10, 22, 10); // Thursday
  const w = world();
  // Editing assigned to Nadia on Sunday 11.10: due Tuesday 13.10 (two business days), seven business days ago.
  const c = client(w, { editor: 'nadia', char_at: IL(2026, 10, 1, 10).toISOString(), shoot_at: IL(2026, 10, 8, 10).toISOString() });
  all(w, c, UPTO_SHOOT, IL(2026, 10, 8, 18), IMPORT_NOTE);
  all(w, c, ['p22a'], IL(2026, 10, 11, 12));
  all(w, c, ['p23'], IL(2026, 10, 21, 12)); // the graphics closed yesterday: the editing is what blocks, and the client is not idle
  const s = clientState(c, w.checks[c.id], now);
  const late = stuckOf(c, s, { checks: w.checks[c.id] }, now).find((x) => x.code === 'late');
  assert.match(late.text, /^באיחור של יותר מיומיים: /);
  assert.equal(late.age, '22 · עריכת הסרטונים: פתוח 9 ימי עסקים, מהם 7 באיחור · אצל נדיה');
  // The same, in the parts of the pass's one line (20.10.2026).
  assert.deepEqual([late.what, late.who, late.when], ['22 · עריכת הסרטונים', 'nadia', 'פתוח 9 ימי עסקים, מהם 7 באיחור']);
  assert.deepEqual([late.days, late.lateDays], [9, 7]);
  // A wait on the client past its recheck date: how long we have been waiting.
  const w2 = world();
  const d = client(w2, { deal_at: IL(2026, 10, 14, 9).toISOString(), created_at: IL(2026, 10, 14, 9).toISOString() });
  mark(w2, d, 'p01.wait', IL(2026, 10, 15, 9, 30), JSON.stringify({ reason: 'חוזה', recheck: '2026-10-19' }));
  mark(w2, d, 'p01.prepared', IL(2026, 10, 21, 9));
  const got = stuckOf(d, clientState(d, w2.checks[d.id], now), { checks: w2.checks[d.id] }, now);
  assert.equal(got.find((x) => x.code === 'recheck').age, 'ממתין ללקוח 5 ימי עסקים');
  // A late process with no start of its own: only how late it is.
  assert.equal(got.find((x) => x.code === 'late').age, '2 · פתיחת קבוצת WhatsApp: באיחור 6 ימי עסקים · אצל עירית');
  // No activity: the text already says how long.
  const w3 = world();
  const e = client(w3, { deal_at: IL(2026, 10, 1, 10).toISOString(), created_at: IL(2026, 10, 1, 10).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString() });
  const idle = stuckOf(e, clientState(e, {}, now), { checks: {} }, now).find((x) => x.code === 'idle');
  assert.equal(idle.age, null);
  assert.match(idle.text, /^אין פעילות \d+ ימי עסקים$/);
});

test('a stuck client is not closed by "עברתי" alone: a task, an update to Lior, or a written reason', () => {
  const stuck = { client: { id: 's' }, stuck: [{ code: 'late', text: 'באיחור של יותר מיומיים: 22 · עריכת הסרטונים', age: 'פתוח 9 ימי עסקים' }] };
  const calm = { client: { id: 'g' }, stuck: [] };
  // 'own' (20.10.2026): "בטיפול שלי", offered on Ofir's own late work only.
  assert.deepEqual(STUCK_HOWS, ['task', 'lior', 'reason', 'own']);
  assert.deepEqual(closeHows(stuck), ['task', 'lior', 'reason', 'own']);
  assert.deepEqual(closeHows(calm), ['seen', 'task']);
  // A client that is not stuck: anything recorded closes it, as before.
  for (const how of ['seen', 'rest', 'task']) assert.equal(closesRow(calm, { how }), true);
  assert.equal(closesRow(calm, undefined), false);
  // A stuck one.
  assert.equal(closesRow(stuck, { how: 'seen' }), false);
  assert.equal(closesRow(stuck, { how: 'rest' }), false);
  assert.equal(closesRow(stuck, { how: 'task', task: 't1' }), true);
  assert.equal(closesRow(stuck, { how: 'lior', task: 't2' }), true);
  assert.equal(closesRow(stuck, { how: 'reason', reason: 'הלקוח בחו״ל עד יום ראשון' }), true);
  assert.equal(closesRow(stuck, { how: 'reason', reason: ' .  ' }), false);
  assert.equal(closesRow(stuck, { how: 'reason' }), false);
  // The reason: a few words, trimmed, at most 200 characters.
  assert.equal(REASON_MIN, 5);
  assert.equal(reasonOk('בסדר'), false);
  assert.equal(reasonOk('  מחכים  ללקוח '), true);
  assert.equal(cleanReason('  מחכים \n ללקוח '), 'מחכים ללקוח');
  assert.equal(cleanReason('א'.repeat(300)).length, REASON_MAX);
  // What the row says afterwards, and the title of the update to Lior.
  assert.equal(seenText({ how: 'task' }), 'נפתחה משימה');
  assert.equal(seenText({ how: 'lior' }), 'עודכן ליאור');
  assert.equal(seenText({ how: 'reason', reason: 'הלקוח בחו״ל עד יום ראשון' }), 'עברת · אין צורך בפעולה: ״הלקוח בחו״ל עד יום ראשון״');
  assert.equal(seenText({ how: 'seen' }), 'עברת');
  assert.equal(seenText({ how: 'own' }), 'בטיפול שלך');
  assert.equal(closesRow(stuck, { how: 'own' }), true);
  assert.equal(stuckTitle(stuck), 'לקוח תקוע: באיחור של יותר מיומיים: 22 · עריכת הסרטונים · פתוח 9 ימי עסקים');
});

test('the pass is complete only when every stuck client has its action', () => {
  const e = (id, color, codes = []) => ({ client: { id, name: id }, health: { color, reasons: codes.map((code) => ({ code, text: code })) }, station: { index: 1 } });
  const entries = [e('red', 'red', ['late']), e('stuck', 'yellow', ['waiting']), e('green', 'green')];
  const rows = passRows(entries, { prev: null, stuck: (x) => (x.client.id === 'stuck' ? [{ code: 'idle', text: 'אין פעילות 6 ימי עסקים' }] : []) });
  const seen = { red: { how: 'seen' }, green: { how: 'rest' }, stuck: { how: 'seen' } };
  let p = passProgress(rows, seen);
  assert.deepEqual([p.complete, p.handled, p.open.map((r) => r.client.id)], [false, 2, ['stuck']]);
  p = passProgress(rows, { ...seen, stuck: { how: 'reason', reason: 'הלקוח ביקש לחכות לחודש הבא' } });
  assert.deepEqual([p.complete, p.handled], [true, 3]);
  p = passProgress(rows, { ...seen, stuck: { how: 'lior', task: 't' } });
  assert.equal(p.complete, true);
});

// ── Changing an assigned editor ─────────────
function editing(w, o = {}, assignedAt = IL(2026, 10, 18, 12)) {
  const c = client(w, { editor: 'nadia', char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 18, 10).toISOString(), ...o });
  all(w, c, UPTO_SHOOT, IL(2026, 10, 18, 9), IMPORT_NOTE);
  all(w, c, ['p22a'], assignedAt);
  return c;
}
const jobOf = (w, c, now) => Object.values(editorLoad({ clients: w.clients, stateOf: (x) => clientState(x, w.checks[x.id] || {}, now), checks: w.checks, tasks: w.tasks, now }))
  .flatMap((l) => l.jobs.map((j) => ({ ...j, editor: l.editor }))).find((j) => j.client.id === c.id);

test('a swap and the editing clocks: on time the days start over, a late job keeps its deadlines unless Ofir says otherwise', () => {
  const now = IL(2026, 10, 20, 10); // Tuesday
  const w = world();
  // Assigned on Sunday: due Tuesday (two business days, protocol v11).
  const c = editing(w);
  const job = jobOf(w, c, now);
  assert.equal(job.editor, 'nadia');
  assert.equal(hhmm(job.dueAt), '20.10 18:00');
  let k = swapClock(job, now);
  assert.deepEqual([k.late, k.choice, hhmm(k.keepDue), hhmm(k.restartDue)], [false, 'restart', '20.10 18:00', '22.10 18:00']);
  // Marking 22א again (what "restart" does) moves the three deadlines; leaving it keeps them.
  const due = (id) => hhmm(clientState(c, w.checks[c.id], now).states.find((s) => s.proc.id === id).dueAt);
  assert.deepEqual(['p22', 'p24', 'p27'].map(due), ['20.10 18:00', '20.10 18:00', '22.10 18:00']);
  mark(w, c, 'p22a.assigned', now);
  assert.deepEqual(['p22', 'p24', 'p27'].map(due), ['22.10 18:00', '22.10 18:00', '26.10 18:00']);
  // A job assigned a week ago is late: the default keeps it late.
  const w2 = world();
  const l = editing(w2, {}, IL(2026, 10, 11, 12));
  const lateJob = jobOf(w2, l, now);
  k = swapClock(lateJob, now);
  assert.deepEqual([k.late, k.choice, hhmm(k.keepDue)], [true, 'keep', '13.10 18:00']);
  // The reason is required only for a late job restarted (the editor's reason is optional since 21.10.2026).
  assert.equal(swapReasonNeeded({ shootType: 'dms', editor: 'yariv', late: true, restart: false }), false);
  assert.equal(swapReasonNeeded({ shootType: 'dms', editor: 'yariv', late: true, restart: true }), true);
  assert.equal(swapReasonNeeded({ shootType: 'dms', editor: 'yariv', late: false, restart: true }), false);
  assert.equal(swapReasonNeeded({ shootType: 'natali', editor: 'nadia' }), false);
  assert.equal(swapReasonNeeded({ shootType: 'natali', editor: 'nirel' }), false);
  assert.equal(swapReasonNeeded({ shootType: 'natali', joint: true, editor: 'nirel' }), false);
  assert.equal(swapReasonNeeded({ shootType: 'dms', editor: null, late: true, restart: true }), false);
});

test('the reason mark of a swap: who, from whom, what happened to the clocks; it replaces the automatic assignment\'s mark', () => {
  const w = world();
  const c = editing(w);
  mark(w, c, REASON_KEY(''), IL(2026, 10, 18, 12), JSON.stringify({ editor: 'nadia', reason: 'שיוך אוטומטי בסיום יום הצילום, לפי העומס', preselected: null, joint: false, auto: true, kept: false }));
  assert.equal(autoReasonOf(w.checks[c.id]).editor, 'nadia');
  const note = swapNote({ editor: 'yariv', from: 'nadia', reason: 'נדיה בחופשה', restart: true, late: false, prev: IL(2026, 10, 18, 12) });
  assert.deepEqual(JSON.parse(note), {
    editor: 'yariv', reason: 'החלפת עורך: מנדיה ליריב · נדיה בחופשה · מועדי העריכה נספרים מחדש מהיום', preselected: null, joint: false,
    swap: true, from: 'nadia', restart: true, late: false, prev: IL(2026, 10, 18, 12).toISOString(),
  });
  mark(w, c, REASON_KEY(''), IL(2026, 10, 20, 10), note);
  assert.equal(autoReasonOf(w.checks[c.id]), null); // Ofir is not told "שויך אוטומטית" again
  assert.equal(reasonOf(w.checks[c.id]).from, 'nadia');
  // The client's history reads by itself.
  assert.equal(describeOfficeMark('p22a.reason', 'done', note),'נימק/ה את בחירת העורך (יריב): החלפת עורך: מנדיה ליריב · נדיה בחופשה · מועדי העריכה נספרים מחדש מהיום');
  // Without a reason, and a late job left late.
  assert.equal(JSON.parse(swapNote({ editor: 'anna', from: 'yariv', late: true })).reason, 'החלפת עורך: מיריב לאנה · המועדים לא השתנו, העריכה נשארת באיחור');
  assert.equal(JSON.parse(swapNote({ editor: 'anna', from: 'yariv' })).reason, 'החלפת עורך: מיריב לאנה · המועדים לא השתנו');
});

// ── One line, and the rows stuck at one person together (the owner, 20.10.2026) ──
const lateAt = (who, what = '12א · משהו', when = 'באיחור 4 ימי עסקים') => ({ code: 'late', text: 'באיחור של יותר מיומיים: x', age: 'x', what, who, when });
const row = (id, { stuck = [], reasons = [] } = {}) => ({ client: { id, name: `לקוח ${id}` }, stuck, reasons, color: 'red', changes: { texts: [] }, attention: true });

test('a row in one line: what, whose, how late; the viewer’s own work is "שלך"', () => {
  const lateReason = { code: 'late', text: 'באיחור 4 ימי עסקים', what: '12א · משהו', who: 'lior' };
  const r = row('a', { stuck: [lateAt('lior')], reasons: [lateReason, { code: 'access', text: 'גישה שבורה', what: 'Instagram', who: 'lior' }] });
  assert.deepEqual(rowLine(r, 'ofir'), { what: '12א · משהו', who: 'lior', mine: false, when: 'באיחור 4 ימי עסקים', more: 1 });
  assert.equal(rowLine(row('b', { stuck: [lateAt('ofir')] }), 'ofir').mine, true);
  // Not stuck: the first reason.
  assert.deepEqual(rowLine(row('c', { reasons: [{ code: 'shoot-risk', text: 'צילום בסיכון', what: 'אין אישור', who: 'lior' }] }), 'ofir'),
    { what: 'אין אישור', who: 'lior', mine: false, when: 'צילום בסיכון', more: 0 });
  // Only idle: its words.
  assert.deepEqual(rowLine(row('d', { stuck: [{ code: 'idle', text: 'אין פעילות 6 ימי עסקים', what: null, who: null, when: 'אין פעילות 6 ימי עסקים' }] })),
    { what: null, who: null, mine: false, when: 'אין פעילות 6 ימי עסקים', more: 0 });
  assert.equal(rowLine(row('e')), null);
});

test('rows stuck at one person stand together, with one update to Lior; the viewer’s own stay apart', () => {
  const rows = [row('1', { stuck: [lateAt('lior')] }), row('2', { reasons: [{ code: 'late', text: 'x' }] }), row('3', { stuck: [lateAt('lior')] }),
    row('4', { stuck: [lateAt('ofir')] }), row('5', { stuck: [lateAt('ofir')] }), row('6', { stuck: [lateAt('ilai', '7 · גרפיקות')] }), row('7', { stuck: [lateAt('lior', '13 · אחר')] })];
  const g = passGroups(rows, 'ofir');
  assert.deepEqual(g.map((x) => [x.who || null, x.what || null, x.rows.map((r) => r.client.id)]), [
    ['lior', null, ['1', '3', '7']], [null, null, ['2']], [null, null, ['4']], [null, null, ['5']], [null, null, ['6']],
  ]);
  // The same process for all: the group says it once.
  assert.equal(passGroups(rows.slice(0, 3), 'ofir')[0].what, '12א · משהו');
  assert.equal(groupTitle(g[0]), 'לקוחות תקועים אצל ליאור: לקוח 1 (12א · משהו, באיחור 4 ימי עסקים) · לקוח 3 (12א · משהו, באיחור 4 ימי עסקים) · לקוח 7 (13 · אחר, באיחור 4 ימי עסקים)');
  // The owner has no "own": Ofir's rows are a group too.
  assert.deepEqual(passGroups(rows, null).filter((x) => x.who).map((x) => x.who), ['lior', 'ofir']);
});

test('data health in the pass: only what Ofir fixes himself (20.10.2026)', () => {
  const c = { id: 'c1', name: 'x', status: 'active', landing: false };
  const tasks = [
    { id: 't1', client_id: 'c1', owner: 'irit', title: 'בלי מועד', done_at: null, due_on: null },
    { id: 't2', client_id: 'c1', owner: 'lior', title: 'דחוף', urgent: true, done_at: null, due_on: null },
    { id: 't3', client_id: 'c1', owner: 'ofir', title: 'דחוף שלי', urgent: true, done_at: null, due_on: null },
    { id: 't4', client_id: 'c1', owner: 'lior', title: 'חריגה', source: 'escalation', done_at: null, due_on: null },
  ];
  const h = dataHealth({ clients: [c], stateOf: () => ({ states: [] }), checks: {}, tasks, now: IL(2026, 10, 20, 10), me: 'ofir' });
  assert.deepEqual(h.noDue.map((x) => x.task.id), ['t1', 't3']);
  assert.equal(h.total, 2);
});
