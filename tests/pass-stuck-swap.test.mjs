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
  // Editing assigned to Nadia on Sunday 11.10: due Wednesday 14.10, six business days ago.
  const c = client(w, { editor: 'nadia', char_at: IL(2026, 10, 1, 10).toISOString(), shoot_at: IL(2026, 10, 8, 10).toISOString() });
  all(w, c, UPTO_SHOOT, IL(2026, 10, 8, 18), IMPORT_NOTE);
  all(w, c, ['p22a'], IL(2026, 10, 11, 12));
  all(w, c, ['p23'], IL(2026, 10, 21, 12)); // the graphics closed yesterday: the editing is what blocks, and the client is not idle
  const s = clientState(c, w.checks[c.id], now);
  const late = stuckOf(c, s, { checks: w.checks[c.id] }, now).find((x) => x.code === 'late');
  assert.match(late.text, /^באיחור של יותר מיומיים: /);
  assert.equal(late.age, '22 · עריכת הסרטונים: פתוח 9 ימי עסקים, מהם 6 באיחור · אצל נדיה');
  assert.deepEqual([late.days, late.lateDays], [9, 6]);
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
  assert.deepEqual(STUCK_HOWS, ['task', 'lior', 'reason']);
  assert.deepEqual(closeHows(stuck), ['task', 'lior', 'reason']);
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
  // Assigned on Sunday: due Wednesday.
  const c = editing(w);
  const job = jobOf(w, c, now);
  assert.equal(job.editor, 'nadia');
  assert.equal(hhmm(job.dueAt), '21.10 23:59');
  let k = swapClock(job, now);
  assert.deepEqual([k.late, k.choice, hhmm(k.keepDue), hhmm(k.restartDue)], [false, 'restart', '21.10 23:59', '25.10 23:59']);
  // Marking 22א again (what "restart" does) moves the three deadlines; leaving it keeps them.
  const due = (id) => hhmm(clientState(c, w.checks[c.id], now).states.find((s) => s.proc.id === id).dueAt);
  assert.deepEqual(['p22', 'p24', 'p27'].map(due), ['21.10 23:59', '21.10 23:59', '22.10 23:59']);
  mark(w, c, 'p22a.assigned', now);
  assert.deepEqual(['p22', 'p24', 'p27'].map(due), ['25.10 23:59', '25.10 23:59', '26.10 23:59']);
  // A job assigned a week ago is late: the default keeps it late.
  const w2 = world();
  const l = editing(w2, {}, IL(2026, 10, 11, 12));
  const lateJob = jobOf(w2, l, now);
  k = swapClock(lateJob, now);
  assert.deepEqual([k.late, k.choice, hhmm(k.keepDue)], [true, 'keep', '14.10 23:59']);
  // The reason: the usual rules, and a late job restarted.
  assert.equal(swapReasonNeeded({ shootType: 'dms', editor: 'yariv', late: true, restart: false }), false);
  assert.equal(swapReasonNeeded({ shootType: 'dms', editor: 'yariv', late: true, restart: true }), true);
  assert.equal(swapReasonNeeded({ shootType: 'dms', editor: 'yariv', late: false, restart: true }), false);
  assert.equal(swapReasonNeeded({ shootType: 'natali', editor: 'nadia' }), true);
  assert.equal(swapReasonNeeded({ shootType: 'natali', editor: 'nirel' }), false);
  assert.equal(swapReasonNeeded({ shootType: 'natali', joint: true, editor: 'nirel' }), true);
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
