// Graphics tasks that close by themselves (17.11.2026; app/gfx-auto-logic.js; docs/ops.md, section
// 138): which words make a graphics task, what counts as new work in the Drive and the Gantt, the
// same day, the giver's kind and number, "לפתוח מחדש", and Claude's verdicts. Invented clients.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyText, kindOf, judged, judge, driveSince, ganttSince, progressText, gfxChoice, recentAuto, isAuto,
  aiVerdicts, aiOutcome, missingText, aiCloseNote, notesText, aiRequest, AI,
} from '../app/gfx-auto-logic.js';
import { GRAPHICS_PEOPLE, isGraphics } from '../app/protocol.js';

test('who gets graphics tasks: Ilai and Nirel', () => {
  assert.deepEqual(GRAPHICS_PEOPLE().sort(), ['ilai', 'nirel']);
  assert.equal(isGraphics('nadia'), false);
  assert.equal(isGraphics('owner'), false);
});

test('the words of a task, as the office writes them', () => {
  const cases = [
    ['להכין גרפיקות לפיצה הדגמה. יש לך בווטס טלפון לוגו וכתובת', 'make'],
    ['מוסך הדגמה- להכין עוד גרפיקות', 'make'],
    ['קפה הדגמה-להכיןנגרפיקות', 'make'],                              // a typo the office really makes
    ['יקב הדגמה-לדלל גרפיקות ולמספר ולהגיד לעירית שתשלח ללקוח', 'make'],
    ['שיש הדגמה- למספר גרפיקות', 'make'],
    ['אולם הדגמה- לעשות גרפיקות. למספר. לעשות יותר מעניין.', 'make'],
    ['אופנה הדגמה-גרפיקות. עם כל הכתובות וטלפונים. ולמספר.', 'make'],   // only "גרפיקות"
    ['טק הדגמה- ליצור קשר עם הלקוח ואז להכין את הגרפיקות', 'make'],
    ['מזל הדגמה- לתזמן גרפיקות הימורים', 'schedule'],
    ['לקוח אישר גרפיקות- לתזמן', 'schedule'],
    ['להעלות את הגרפיקות שאושרו לרשתות', 'schedule'],
    ['ממתקים הדגמה-לתקן גרפיקות לפי ההערות הבאות: צבעים יותר חיים', 'fix'],
    ['SGG לתקן גרפיקות שיראה פחות צ\'ט', 'fix'],
    ['צורף הדגמה תיקון גרפיקות: פחות צאט הוא רוצה 3 סרטונים 3 תמונות', 'fix'], // a fix with videos named: the AI tells what it can
    ['קליניקה הדגמה- להוסיף בגרפיקות שסימנה בקבוצה את ההערה', 'fix'],
    ['גרפיקות של רכב הדגמה- ניראל עשתה אבל אתה צריך לתקן...', 'fix'],
    ['להעלות ולתזמן סרטונים וגרפיקות. הלקוחה אישרה', null],              // also videos: not by graphics alone
    ['להעלות את הסרטונים ששלחו בקבוצה', null],
    ['לתזמן. אישרו סרטונים', null],
    ['לתזמן סרטון חנוכה ששלחתי בווטס', null],
    ['לבדוק את הגרפיקות של פיצה הדגמה', null],
    ['להתקשר ללקוח', null],
    ['', null],
  ];
  for (const [text, want] of cases) assert.equal(classifyText(text), want, text);
});

test('the giver\'s kind wins over the words; only an open task of a graphics person on a client is judged', () => {
  const base = { status: 'open', assignee: 'ilai', client_id: 'c1', body: 'להכין גרפיקות' };
  assert.equal(kindOf({ ...base, gfx_kind: 'schedule' }), 'schedule');
  assert.equal(kindOf({ ...base, body: 'בלי מילים מוכרות', gfx_kind: 'make' }), 'make');
  assert.equal(judged(base), true);
  assert.equal(judged({ ...base, assignee: 'nadia' }), false);
  assert.equal(judged({ ...base, client_id: null }), false);
  assert.equal(judged({ ...base, status: 'done' }), false);
  assert.equal(judged({ ...base, body: 'להתקשר ללקוח' }), false);
  assert.equal(judged({ ...base, body: 'להתקשר ללקוח', gfx_kind: 'make' }), true);
});

// A task given on 4.11 at 09:12 Israel time (07:12 UTC).
const GIVEN = '2026-11-04T07:12:00Z';
const d = (day, files, folder = 'גרפיקות', kind = 'graphic') => ({ day, folder, kind, files });

test('the Drive: the days after the task count; the same day only above the count when it was given', () => {
  const rows = [d('2026-11-03', 5), d('2026-11-04', 7), d('2026-11-05', 2), d('2026-11-06', 3, 'גרפיקות/נובמבר'), d('2026-11-06', 9, 'היילייטס'), d('2026-11-06', 4, 'סרטונים', 'video')];
  assert.deepEqual(driveSince(rows, GIVEN, 7), { files: 5, last: '2026-11-06' }, 'the day itself had 7 when given: nothing new that day');
  assert.deepEqual(driveSince(rows, GIVEN, 4), { files: 8, last: '2026-11-06' }, '3 of the 7 came after it was given');
  assert.deepEqual(driveSince(rows, GIVEN, null), { files: 5, last: '2026-11-06' }, 'no count (an old task): the day itself is not counted');
  assert.deepEqual(driveSince([d('2026-11-04', 6)], GIVEN, 2), { files: 4, last: '2026-11-04' }, 'only the same day');
  // 23:30 UTC on 4.11 is already 5.11 in Israel.
  assert.deepEqual(driveSince([d('2026-11-05', 3)], '2026-11-04T23:30:00Z', 1), { files: 2, last: '2026-11-05' });
});

test('the Gantt: scheduled or posted after the task; a post scheduled before it and published after is old work', () => {
  const g = (state, live, created = '2026-10-20T10:00:00Z', kind = 'graphic') => ({ kind, state, live_at: live, created_at: created });
  const rows = [
    g('posted', null),                                    // scheduled 20.10, published after the task: not new
    g('scheduled', '2026-11-05T09:00:00Z'),               // went into Metricool after it
    g('posted', '2026-11-06T09:00:00Z'),
    g('scheduled', null, '2026-11-15T12:45:00Z'),          // a row the sync added (before live_at came): its creation
    g('planned', null, '2026-11-15T12:45:00Z'),
    g('scheduled', '2026-11-05T09:00:00Z', undefined, 'video'),
    g('scheduled', '2026-11-04T07:00:00Z'),               // just before the task
  ];
  assert.deepEqual(ganttSince(rows, GIVEN), { count: 3, last: '2026-11-15T12:45:00Z' });
});

test('judge: a make task closes on the Drive, a schedule task on the Gantt only, with the line', () => {
  const t = { id: 't', status: 'open', assignee: 'ilai', client_id: 'c', created_at: GIVEN, gfx_base: 0 };
  const drive = [d('2026-11-15', 9)];
  const gantt = [{ kind: 'graphic', state: 'scheduled', live_at: '2026-11-15T15:09:00Z', created_at: '2026-11-15T12:45:00Z' }];
  const make = judge({ ...t, body: 'להכין גרפיקות. אישר את הלוגו' }, { drive, gantt });
  assert.deepEqual([make.close, make.n, make.source, make.note], [true, 9, 'drive', 'נסגר אוטומטית: עלו 9 גרפיקות בדרייב ב־15.11']);
  const sched = judge({ ...t, body: 'לתזמן גרפיקות' }, { drive, gantt });
  assert.deepEqual([sched.close, sched.n, sched.note], [true, 1, 'נסגר אוטומטית: תוזמנו 1 גרפיקות בגאנט עד 15.11']);
  assert.equal(judge({ ...t, body: 'לתזמן גרפיקות' }, { drive }).close, false, 'files alone do not prove scheduling');
  // A make task with nothing in the Drive but graphics scheduled: they were surely made.
  assert.deepEqual(judge({ ...t, body: 'להכין גרפיקות' }, { gantt }).note, 'נסגר אוטומטית: תוזמנו 1 גרפיקות בגאנט עד 15.11');
  // Nothing new: stays open.
  const none = judge({ ...t, body: 'להכין גרפיקות' }, { drive: [d('2026-11-03', 4)] });
  assert.deepEqual([none.close, none.n, none.note], [false, 0, null]);
  // A fix task is never closed by a count (stage 3).
  assert.equal(judge({ ...t, body: 'לתקן גרפיקות לפי ההערות' }, { drive, gantt }).close, false);
});

test('a typed task closes when its number is reached, and shows "4 מתוך 10" until then', () => {
  const t = { status: 'open', assignee: 'ilai', client_id: 'c', created_at: GIVEN, gfx_base: 0, body: 'משימה', gfx_kind: 'make', gfx_count: 10 };
  const four = judge(t, { drive: [d('2026-11-05', 4)] });
  assert.deepEqual([four.close, four.n], [false, 4]);
  assert.equal(progressText({ ...t, gfx_done: four.n }), 'להכין · 4 מתוך 10');
  assert.equal(judge(t, { drive: [d('2026-11-05', 4), d('2026-11-06', 6)] }).close, true);
  assert.equal(progressText({ ...t, gfx_done: 14 }), 'להכין · 10 מתוך 10');
  assert.equal(progressText({ gfx_kind: 'fix' }), 'לתקן');
  assert.equal(progressText({ body: 'להכין גרפיקות' }), null);
});

test('reopened after the system closed it: never the same evidence again, only something newer', () => {
  const t = {
    status: 'open', assignee: 'ilai', client_id: 'c', created_at: GIVEN, gfx_base: 0, body: 'להכין גרפיקות',
    auto_reopened_at: '2026-11-10T08:00:00Z', auto_reopen_base: 2,
  };
  const before = [d('2026-11-05', 4), d('2026-11-10', 2)];
  assert.equal(judge(t, { drive: before }).close, false, 'the 6 files that closed it do not close it again');
  assert.equal(judge(t, { drive: [...before.slice(0, 1), d('2026-11-10', 3)] }).close, true, 'one more that day, after the reopening');
  assert.equal(judge(t, { drive: [...before, d('2026-11-11', 1)] }).close, true);
  assert.equal(judge(t, { drive: before, gantt: [{ kind: 'graphic', state: 'scheduled', live_at: '2026-11-11T08:00:00Z' }] }).close, true);
});

test('the card: an auto-closed task, shown to its assignee for three days', () => {
  const now = new Date('2026-11-17T10:00:00Z');
  const t = { status: 'done', done_by_email: 'system:auto', done_at: '2026-11-15T10:00:00Z' };
  assert.equal(isAuto(t), true);
  assert.equal(recentAuto(t, now), true);
  assert.equal(recentAuto({ ...t, done_at: '2026-11-13T10:00:00Z' }, now), false);
  assert.equal(recentAuto({ ...t, done_by_email: 'ilai@x.test' }, now), false);
});

test('the giver\'s choice in the form: optional, only for a graphics person on a client', () => {
  assert.deepEqual(gfxChoice({ assignee: 'ilai', clientId: 'c', kind: 'make', count: '10' }), { ok: true, errors: {}, value: { gfx_kind: 'make', gfx_count: 10 } });
  assert.deepEqual(gfxChoice({ assignee: 'ilai', clientId: 'c', kind: '', count: '' }).value, {});
  assert.deepEqual(gfxChoice({ assignee: 'ilai', clientId: 'c', count: '3' }).value, { gfx_kind: 'make', gfx_count: 3 });
  assert.deepEqual(gfxChoice({ assignee: 'ilai', clientId: 'c', kind: 'fix', count: '3' }).value, { gfx_kind: 'fix' });
  assert.deepEqual(gfxChoice({ assignee: 'nadia', clientId: 'c', kind: 'make', count: '3' }).value, {}, 'not a graphics person: nothing sent');
  assert.deepEqual(gfxChoice({ assignee: 'ilai', clientId: '', kind: 'make' }).value, {}, 'no client: nothing sent');
  for (const bad of ['0', '201', '1.5', 'abc', '-2', '1000']) assert.equal(gfxChoice({ assignee: 'ilai', clientId: 'c', count: bad }).errors.gfxCount, 'מספר בין 1 ל־200.', bad);
  assert.equal(gfxChoice({ assignee: 'ilai', clientId: 'c', count: ' 12 ' }).value.gfx_count, 12);
});

test('Claude\'s verdicts: checked, the outcome, the lines', () => {
  const v = aiVerdicts({ notes: [
    { note: 'צבעים חיים כמו הלוגו', verdict: 'done', why: 'הצבעים כתום וירוק כמו בלוגו' },
    { note: 'להוסיף את קוקה קולה', verdict: 'not_done', why: 'אין לוגו של קוקה קולה' },
    { note: 'הערות מהווטסאפ', verdict: 'maybe', why: '' },
    { note: '   ', verdict: 'done', why: '' },
  ] });
  assert.deepEqual(v.map((x) => x.verdict), ['done', 'not_done', 'cant_tell']);
  assert.equal(aiOutcome(v), 'missing');
  assert.equal(missingText(v), 'עוד לא תוקן: להוסיף את קוקה קולה');
  assert.equal(aiOutcome([v[0]]), 'done');
  assert.equal(aiOutcome([v[0], v[2]]), 'unclear');
  assert.equal(aiOutcome([]), 'unclear');
  assert.equal(aiOutcome(aiVerdicts(null)), 'unclear');
  assert.equal(aiCloseNote(6), 'נסגר אוטומטית: ה־AI בדק 6 גרפיקות מול ההערות');
  assert.ok(missingText(Array.from({ length: 30 }, () => ({ note: 'הערה ארוכה מאוד מאוד', verdict: 'not_done' }))).length <= 200);
});

test('the request to Claude: the notes with the brief, the images first, strict JSON', () => {
  const task = { body: 'לתקן גרפיקות', brief: { problem: 'חיוור', change: 'צבעי הלוגו', keep: 'הטקסט', result: 'חי' } };
  assert.equal(notesText(task), 'לתקן גרפיקות\nהבעיה: חיוור\nמה לשנות: צבעי הלוגו\nמה נשאר: הטקסט\nהתוצאה: חי');
  const r = aiRequest(task, [{ mime: 'image/png', base64: 'AAA' }, { mime: 'image/jpeg', base64: 'BBB' }]);
  assert.equal(r.model, 'claude-sonnet-5-5');
  assert.deepEqual(r.messages[0].content.map((c) => c.type), ['image', 'image', 'text']);
  assert.equal(r.output_config.format.type, 'json_schema');
  assert.equal(r.fallbacks, 'default');
  assert.equal(AI.maxImages, 12);
});

// ── The notices (app/reminder-rules.js gfxAuto, gfxFix; nagDone not for the system's closing) ──
import { computeReminders } from '../app/reminder-engine.js';
const STAFF = ['irit', 'ilai', 'nirel'].map((p) => ({ email: `${p}@astrateg.test`, person: p }));
const due = (input) => computeReminders({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, deals: [], approvals: [], log: [], ...input });

test('closed by the system: the assignee and the giver hear the line, once per closing; no "סימן בוצע"', () => {
  const t = { id: 't1', created_at: '2026-11-04T07:12:00Z', created_by: 'irit', assignee: 'ilai', body: 'יוסי הדגמה- להכין גרפיקות', client_name: 'יוסי הדגמה', status: 'done', done_at: '2026-11-17T07:25:00Z', done_by_email: 'system:auto', auto_note: 'נסגר אוטומטית: עלו 9 גרפיקות בדרייב ב־15.11' };
  const now = new Date('2026-11-17T07:26:00Z');
  const r = due({ staffTasks: [t], now }).filter((x) => ['gfxAuto', 'nagDone', 'nag'].includes(x.rule));
  assert.deepEqual(r.map((x) => [x.rule, x.person]).sort(), [['gfxAuto', 'ilai'], ['gfxAuto', 'irit']]);
  const mine = r.find((x) => x.person === 'ilai');
  assert.match(mine.title, /^נסגר אוטומטית: עלו 9 גרפיקות בדרייב ב־15\.11: /);
  assert.match(mine.body, /לפתוח מחדש/);
  assert.match(r.find((x) => x.person === 'irit').title, /^עילאי: נסגר אוטומטית/);
  // Reopened and closed again later: a new notice (the step names the closing).
  const again = due({ staffTasks: [{ ...t, done_at: '2026-11-18T07:25:00Z' }], now: new Date('2026-11-18T07:26:00Z'), log: r.map((x) => ({ key: x.key })) }).filter((x) => x.rule === 'gfxAuto');
  assert.equal(again.length, 2);
  assert.notEqual(again[0].key, r[0].key);
  // Marked done by the assignee: as before (nagDone), nothing from gfxAuto.
  const byHand = due({ staffTasks: [{ ...t, done_by_email: 'ilai@astrateg.test', auto_note: null }], now }).filter((x) => ['gfxAuto', 'nagDone'].includes(x.rule));
  assert.deepEqual(byHand.map((x) => [x.rule, x.person]), [['nagDone', 'irit']]);
});

test('Claude found a note not fixed: the assignee hears "עוד לא תוקן", once, only while the task is open', () => {
  const t = { id: 't2', created_at: '2026-11-15T07:00:00Z', created_by: 'irit', assignee: 'ilai', body: 'לתקן גרפיקות לפי ההערות', client_name: 'ממתקים הדגמה', status: 'open', claimed_at: null };
  const check = { id: 'k1', task_id: 't2', created_at: '2026-11-17T07:25:00Z', status: 'missing', result: [{ note: 'הלוגו של קוקה קולה', verdict: 'not_done', why: '' }, { note: 'צבעים', verdict: 'done', why: '' }] };
  const now = new Date('2026-11-17T07:26:00Z');
  const r = due({ staffTasks: [t], gfxChecks: [check], now }).filter((x) => x.rule === 'gfxFix');
  assert.deepEqual(r.map((x) => [x.person, x.title]), [['ilai', 'עוד לא תוקן: הלוגו של קוקה קולה']]);
  assert.equal(due({ staffTasks: [t], gfxChecks: [check], now, log: r.map((x) => ({ key: x.key })) }).filter((x) => x.rule === 'gfxFix').length, 0);
  assert.equal(due({ staffTasks: [{ ...t, status: 'done', done_at: '2026-11-17T07:20:00Z' }], gfxChecks: [check], now }).filter((x) => x.rule === 'gfxFix').length, 0);
});
