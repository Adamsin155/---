// Irit's daily control (process 32; her protocol, step 19): the eleven topics and
// what counts as open in each (app/control-topics.js), and the rule of the tick
// "הבקרה היומית בוצעה". Israel time; npm test runs this under UTC, New York and Jerusalem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateIL } from '../app/tz.js';
import { PROCESSES, REVIEW_TOPICS } from '../app/protocol.js';
import { clientState, IMPORT_NOTE } from '../app/protocol-logic.js';
import {
  controlTopics, TOPIC_KEYS, topicLabel, ageText, unseenTopics, topicsRecord, recordText,
} from '../app/control-topics.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const NOW = IL(2026, 10, 20, 10); // Tuesday
let seq = 0;
const world = () => ({ clients: [], checks: {}, tasks: [], deals: [], work: [] });
function client(w, o = {}) {
  seq += 1;
  const c = {
    id: `c${seq}`, name: o.name || `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
    rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 10, 19, 9).toISOString(), created_by_email: 'irit@x', ...o,
  };
  w.clients.push(c);
  return c;
}
const mark = (w, c, key, at, note = null, state = 'done') => {
  (w.checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state, note, at: at.toISOString(), by_email: 'x@x' };
};
const itemsOf = (id, pre = '') => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => pre + i.key);
const all = (w, c, ids, at, note = null) => { for (const id of ids) for (const k of itemsOf(id)) mark(w, c, k, at, note); };
const topics = (w, now = NOW) => {
  const got = controlTopics({ ...w, stateOf: (c) => clientState(c, w.checks[c.id] || {}, now), now });
  return Object.fromEntries(got.map((t) => [t.key, t]));
};
const rows = (t) => t.items.map((x) => [x.client?.name || x.title, x.text, x.late]);
const UPTO_CHAR = ['p01', 'p02', 'p03', 'p04', 'p05', 'p06'];
const UPTO_SHOOT = [...UPTO_CHAR, 'p07', 'p07b', 'p08', 'p08b', 'p09', 'p10', 'p11', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p21'];

test('the eleven topics, in the protocol\'s order and with the protocol\'s own words', () => {
  const got = controlTopics({ clients: [], stateOf: () => ({ states: [] }), now: NOW });
  assert.deepEqual(got.map((t) => t.key), TOPIC_KEYS);
  assert.equal(got.length, 11);
  // Step 19 of Irit's protocol: the first eleven of process 32's list (the twelfth, the daily messages, has its own page).
  assert.deepEqual(got.map((t) => t.label), REVIEW_TOPICS.p32.slice(0, 11));
  assert.deepEqual(got.map((t) => t.label), ['חוזים', 'חתימות', 'קבוצות WhatsApp', 'הודעות פתיחה', 'פגישות אפיון', 'ימי צילום', 'משימות פתוחות', 'אישורי לקוחות', 'תיקונים', 'עובדים שטרם סיימו משימות', 'לקוחות שצריך לחזור אליהם']);
  assert.ok(got.every((t) => t.count === 0 && t.late === 0 && t.items.length === 0));
  assert.equal(topicLabel('fixes'), 'תיקונים');
});

test('contracts and signatures: Stav\'s deals before there is a client, and process 1 in a client opened by hand', () => {
  const w = world();
  const a = client(w, { name: 'חדש' });
  const b = client(w, { name: 'נשלח' });
  mark(w, b, 'p01.prepared', IL(2026, 10, 15, 9));
  mark(w, b, 'p01.sent', IL(2026, 10, 15, 9, 5));
  const p = client(w, { name: 'הוכן' });
  mark(w, p, 'p01.prepared', IL(2026, 10, 20, 9, 30));
  const done = client(w, { name: 'חתום' });
  all(w, done, ['p01'], IL(2026, 10, 19, 9, 3));
  client(w, { name: 'מבוטל', status: 'cancelled' });
  w.deals = [
    { id: 'd1', business_name: 'פיצה רמי', status: 'pending', created_at: IL(2026, 10, 20, 9).toISOString() },
    { id: 'd2', business_name: 'מוסך דוד', status: 'sent', created_at: IL(2026, 10, 19, 9).toISOString(), sent_at: IL(2026, 10, 19, 9, 8).toISOString(), signed_at: null },
    { id: 'd3', business_name: 'נחתם כבר', status: 'signed', created_at: IL(2026, 10, 12, 9).toISOString(), sent_at: IL(2026, 10, 12, 9, 8).toISOString(), signed_at: IL(2026, 10, 12, 12).toISOString() },
    { id: 'd4', business_name: 'בוטל', status: 'cancelled', created_at: IL(2026, 10, 12, 9).toISOString() },
    { id: 'd5', business_name: 'חריג', status: 'approval', created_at: IL(2026, 10, 20, 9, 40).toISOString() },
  ];
  const t = topics(w);
  // Late first, then the oldest.
  assert.deepEqual(rows(t.contracts), [
    ['חדש', 'החוזה לא הוכן', true],
    ['פיצה רמי', 'עסקה מהשטח: להכין חוזה', true], // the 10 office minutes ran out at 09:10
    ['הוכן', 'החוזה הוכן ולא נשלח', true],
    ['חריג', 'חוזה חריג: ממתין לאישור מנהל', false],
  ]);
  assert.equal(t.contracts.items[1].href, 'index.html?deal=d1');
  assert.equal(t.contracts.items[0].hash, 'p01');
  assert.equal(t.contracts.late, 3);
  assert.deepEqual(rows(t.signatures), [
    ['נשלח', 'החוזה נשלח ולא נחתם', true],   // sent on Thursday: three business days
    ['מוסך דוד', 'החוזה נשלח ולא נחתם', false], // sent yesterday
  ]);
  assert.equal(ageText(t.signatures.items[0].since, NOW), '3 ימי עסקים');
  assert.equal(ageText(t.signatures.items[1].since, NOW), 'מאתמול');
  assert.equal(t.signatures.items[1].href, 'quotes.html');
  // Without the deals (a viewer who may not read them): the clients' own process 1 only.
  assert.deepEqual(rows(topics({ ...w, deals: null }).contracts).map((x) => x[0]), ['חדש', 'הוכן']);
});

test('the WhatsApp group and the intro message: a client with no group is not listed twice', () => {
  const w = world();
  client(w, { name: 'בלי קבוצה' });
  const g = client(w, { name: 'בלי הודעה' });
  mark(w, g, 'p02.opened', IL(2026, 10, 19, 9, 4));
  const ok = client(w, { name: 'הכול' });
  all(w, ok, ['p02'], IL(2026, 10, 19, 9, 4));
  const t = topics(w);
  assert.deepEqual(rows(t.groups), [['בלי קבוצה', 'הקבוצה לא נפתחה', true]]);
  assert.deepEqual(rows(t.intro), [['בלי הודעה', 'לא נשלחה הודעת היכרות', true]]);
  assert.equal(t.intro.items[0].hash, 'p02');
  assert.equal(ageText(t.intro.items[0].since, NOW), 'מאתמול');
});

test('characterization meetings: today and the next business day, none set, and a meeting that passed without being saved', () => {
  const w = world();
  client(w, { name: 'לא נקבעה' });
  client(w, { name: 'היום', char_at: IL(2026, 10, 20, 14).toISOString() });
  client(w, { name: 'מחר', char_at: IL(2026, 10, 21, 9).toISOString(), characterizer: 'lior' });
  client(w, { name: 'בשבוע הבא', char_at: IL(2026, 10, 27, 9).toISOString() });
  client(w, { name: 'עברה', char_at: IL(2026, 10, 18, 10).toISOString() });
  const saved = client(w, { name: 'נשמר', char_at: IL(2026, 10, 18, 10).toISOString() });
  all(w, saved, ['p04'], IL(2026, 10, 18, 12));
  const t = topics(w);
  assert.deepEqual(rows(t.chars), [
    ['היום', 'פגישת אפיון · אופיר', false],
    ['מחר', 'פגישת אפיון · ליאור', false],
    ['עברה', 'הפגישה עברה והאפיון לא נשמר · אופיר', true],
    ['לא נקבעה', 'לא נקבעה פגישת אפיון', true],
  ]);
  assert.deepEqual(t.chars.items.map((x) => [x.info, x.hash]), [[true, 'p04'], [true, 'p04'], [false, 'p04'], [false, 'p03']]);
  // On Thursday the next business day is Sunday.
  const thu = topics(world_with((x) => { client(x, { name: 'ראשון', char_at: IL(2026, 10, 25, 9).toISOString() }); }), IL(2026, 10, 22, 10));
  assert.deepEqual(rows(thu.chars).map((x) => x[0]), ['ראשון']);
});
function world_with(fn) { const w = world(); fn(w); return w; }

test('shoot days: the coming week, and a client whose day should have been set', () => {
  const w = world();
  const soon = client(w, { name: 'ביום חמישי', shoot_at: IL(2026, 10, 22, 10).toISOString(), char_at: IL(2026, 10, 12, 10).toISOString() });
  all(w, soon, [...UPTO_CHAR, 'p11'], IL(2026, 10, 13, 9), IMPORT_NOTE);
  const open = client(w, { name: 'לא סגור', shoot_at: IL(2026, 10, 26, 10).toISOString() });
  mark(w, open, 'p02.opened', IL(2026, 10, 19, 9, 4));
  const far = client(w, { name: 'רחוק', shoot_at: IL(2026, 11, 20, 10).toISOString() });
  mark(w, far, 'p02.opened', IL(2026, 10, 19, 9, 4));
  const none = client(w, { name: 'לא נקבע', deal_at: IL(2026, 10, 13, 9).toISOString() });
  mark(w, none, 'p02.opened', IL(2026, 10, 13, 9, 4));
  client(w, { name: 'אין קבוצה עדיין' }); // 11 starts when the group is opened: this one is in "קבוצות"
  const t = topics(w);
  assert.deepEqual(rows(t.shoots), [
    ['ביום חמישי', 'יום צילום', false],
    ['לא סגור', 'יום צילום · עוד לא סגור מול כולם', false],
    ['לא נקבע', 'לא נקבע יום צילום', true], // due the business day after the group: a week ago
  ]);
  assert.deepEqual(t.shoots.items.map((x) => x.info), [true, false, false]);
  // An extra round's shoot day is a shoot day too.
  const r = client(w, { name: 'סבב', char_at: IL(2026, 9, 1, 10).toISOString(), shoot_at: IL(2026, 9, 10, 10).toISOString(), rounds: [{ n: 2, shoot_type: 'dms', shoot_at: IL(2026, 10, 21, 10).toISOString(), start_at: IL(2026, 10, 12, 10).toISOString(), editor: null }] });
  all(w, r, UPTO_SHOOT, IL(2026, 9, 10, 18), IMPORT_NOTE);
  assert.deepEqual(rows(topics(w).shoots)[0], ['סבב', 'יום צילום · סבב 2 · עוד לא סגור מול כולם', true]);
  assert.equal(topics(w).shoots.items[0].hash, 'r2-p11');
});

test('open tasks, late first; corrections the client asked for; client approvals', () => {
  const w = world();
  const g = client(w, { name: 'גרפיקות', char_at: IL(2026, 10, 12, 10).toISOString() });
  all(w, g, UPTO_CHAR, IL(2026, 10, 12, 13), IMPORT_NOTE);
  for (const k of itemsOf('p07').filter((x) => x !== 'p07.approved')) mark(w, g, k, IL(2026, 10, 14, 15));
  const v = client(w, { name: 'סרטונים', editor: 'nadia', char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 11, 10).toISOString() });
  all(w, v, [...UPTO_SHOOT, 'p22a', 'p22', 'p23', 'p24', 'p25', 'p26'], IL(2026, 10, 15, 9));
  const n = client(w, { name: 'הערות', editor: 'yariv', char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 11, 10).toISOString() });
  all(w, n, [...UPTO_SHOOT, 'p22a', 'p22', 'p23', 'p24', 'p25', 'p26'], IL(2026, 10, 15, 9));
  mark(w, n, 'p27.notes', IL(2026, 10, 19, 11));
  for (const c of [v, n]) mark(w, c, 'p23.approved', IL(2026, 10, 15, 12));
  // An imported client: its history says "sent", and nothing is waiting for an approval.
  const old = client(w, { name: 'ייבוא', editor: 'anna', char_at: IL(2026, 6, 5, 10).toISOString(), shoot_at: IL(2026, 6, 11, 10).toISOString() });
  all(w, old, [...UPTO_SHOOT, 'p22a', 'p22', 'p23', 'p24', 'p25', 'p26'], IL(2026, 10, 6, 9), IMPORT_NOTE);
  const ended = client(w, { name: 'הסתיים', status: 'ended' });
  w.tasks = [
    { id: 't1', client_id: g.id, title: 'לשלוח לוגו מעודכן', owner: 'ilai', due_on: '2026-10-22', created_at: IL(2026, 10, 19, 9).toISOString(), done_at: null },
    { id: 't2', client_id: v.id, title: 'לבדוק כתוביות', owner: 'nadia', due_on: '2026-10-19', created_at: IL(2026, 10, 16, 9).toISOString(), done_at: null },
    { id: 't3', client_id: g.id, title: 'להחליף צבע בגרפיקה 3', owner: 'ilai', due_on: '2026-10-21', created_at: IL(2026, 10, 19, 15).toISOString(), done_at: null, source: 'client_fix', brief: { notes_marked: false } },
    { id: 't4', client_id: g.id, title: 'בלי תאריך', owner: 'irit', due_on: null, created_at: IL(2026, 10, 20, 9).toISOString(), done_at: null },
    { id: 't5', client_id: ended.id, title: 'של לקוח שהסתיים', owner: 'irit', due_on: '2026-10-01', created_at: IL(2026, 10, 1, 9).toISOString(), done_at: null },
  ];
  const t = topics(w);
  assert.deepEqual(rows(t.tasks), [
    ['סרטונים', 'לבדוק כתוביות · נדיה', true],
    ['גרפיקות', 'להחליף צבע בגרפיקה 3 · עילאי', false],
    ['גרפיקות', 'לשלוח לוגו מעודכן · עילאי', false],
    ['גרפיקות', 'בלי תאריך · עירית · בלי מועד', false],
  ]);
  assert.equal(t.tasks.late, 1);
  assert.ok(t.tasks.items.every((x) => x.hash === 'tasks'));
  // The graphics were sent on Wednesday and are not approved; the videos were sent on Thursday.
  assert.deepEqual(rows(t.approvals), [
    ['גרפיקות', '9 הגרפיקות הראשונות: ממתין לאישור הלקוח', true],
    ['סרטונים', 'הסרטונים: ממתין לאישור הלקוח', true],
  ]);
  assert.deepEqual(t.approvals.items.map((x) => x.hash), ['p07', 'p27']);
  // The client's notes arrived: a correction with the editor, not an approval we wait for.
  assert.deepEqual(rows(t.fixes), [
    ['הערות', 'תיקוני הלקוח בסרטונים · יריב', false],
    ['גרפיקות', 'להחליף צבע בגרפיקה 3 · עילאי', false],
  ]);
  assert.equal(ageText(t.fixes.items[0].since, NOW), 'מאתמול');
  // The status page marks the notes and opens the task together: one row.
  w.tasks.push({ id: 't6', client_id: n.id, title: 'תיקוני סרטונים: 3, 7', owner: 'yariv', due_on: '2026-10-20', created_at: IL(2026, 10, 19, 11).toISOString(), done_at: null, source: 'client_fix', brief: { notes_marked: true } });
  assert.deepEqual(rows(topics(w).fixes).map((x) => x[1]), ['תיקוני סרטונים: 3, 7 · יריב', 'להחליף צבע בגרפיקה 3 · עילאי']);
  // Once the client approved, nothing waits.
  mark(w, v, 'p27.approved', IL(2026, 10, 20, 9));
  assert.deepEqual(rows(topics(w).approvals).map((x) => x[0]), ['גרפיקות']);
});

test('employees who have not finished, and the clients to get back to', () => {
  const w = world();
  w.work = [{ key: 'irit', late: 0, urgent: 0, today: 2, open: 3 }, { key: 'nadia', late: 2, urgent: 0, today: 0, open: 5 }, { key: 'ilai', late: 0, urgent: 1, today: 1, open: 2 }, { key: 'yariv', late: 4, urgent: 1, today: 0, open: 6 }];
  const a = client(w, { name: 'הגיע מועד' });
  mark(w, a, 'p01.wait', IL(2026, 10, 19, 16), JSON.stringify({ reason: 'חוזר מחו״ל', recheck: '2026-10-20' }));
  const b = client(w, { name: 'מזמן' });
  mark(w, b, 'p01.wait', IL(2026, 10, 14, 9), JSON.stringify({ reason: 'לא עונה', recheck: '2026-10-25' }));
  mark(w, b, 'p02.wait', IL(2026, 10, 15, 9), JSON.stringify({ reason: '', recheck: null }));
  const c = client(w, { name: 'מאתמול' });
  mark(w, c, 'p01.wait', IL(2026, 10, 19, 9, 30), JSON.stringify({ reason: 'חוזה אצל השותף', recheck: '2026-10-22' }));
  client(w, { name: 'לא ממתין' });
  const t = topics(w);
  assert.deepEqual(rows(t.staff), [['יריב', 'באיחור 4 · דחוף 1 · פתוחים 6', true], ['נדיה', 'באיחור 2 · פתוחים 5', true], ['עילאי', 'דחוף 1 · פתוחים 2', false]]);
  assert.deepEqual(t.staff.items.map((x) => x.person), ['yariv', 'nadia', 'ilai']);
  assert.deepEqual(rows(t.back), [
    ['הגיע מועד', 'הגיע מועד הבדיקה · ממתין ללקוח: הכנת חוזה · ״חוזר מחו״ל״', true],
    ['מזמן', 'ממתין ללקוח ב־2 תהליכים · ״לא עונה״', true],
    ['מאתמול', 'ממתין ללקוח: הכנת חוזה · ״חוזה אצל השותף״', false],
  ]);
  assert.equal(ageText(t.back.items[1].since, NOW), '4 ימי עסקים');
});

test('"הבקרה היומית בוצעה": which topics with something in them were not opened, and what the record keeps', () => {
  const t = (key, count) => ({ key, label: topicLabel(key), count, late: 0, items: [] });
  const list = [t('contracts', 2), t('signatures', 0), t('fixes', 1), t('back', 3)];
  assert.deepEqual(unseenTopics(list, []).map((x) => x.key), ['contracts', 'fixes', 'back']);
  assert.deepEqual(unseenTopics(list, ['contracts', 'signatures']).map((x) => x.key), ['fixes', 'back']);
  assert.deepEqual(unseenTopics(list, ['contracts', 'fixes', 'back']), []);
  // A topic with nothing open never has to be opened.
  assert.deepEqual(unseenTopics([t('contracts', 0), t('tasks', 0)], []), []);
  const rec = topicsRecord(list, ['contracts']);
  assert.deepEqual(rec, { open: { contracts: 2, fixes: 1, back: 3 }, unseen: ['fixes', 'back'] });
  assert.equal(recordText(rec), 'חוזים 2 · תיקונים 1 · לקוחות שצריך לחזור אליהם 3');
  assert.equal(recordText({ open: {} }), '');
  // It fits the review's note (2,000 characters) with room for the notes.
  const full = topicsRecord(TOPIC_KEYS.map((k) => t(k, 999)), []);
  assert.ok(JSON.stringify({ general: '', clients: {}, ...full }).length < 500);
});

test('how long: today, since yesterday, business days', () => {
  assert.equal(ageText(IL(2026, 10, 20, 8), NOW), 'מהיום');
  assert.equal(ageText(IL(2026, 10, 19, 23), NOW), 'מאתמול');
  assert.equal(ageText(IL(2026, 10, 18, 9), NOW), '2 ימי עסקים');
  assert.equal(ageText(IL(2026, 10, 16, 9), NOW), '3 ימי עסקים'); // since Friday: Sunday, Monday and today
  assert.equal(ageText(IL(2026, 10, 15, 9), IL(2026, 10, 18, 9)), 'יום עסקים אחד'); // Thursday to Sunday
  assert.equal(ageText(null, NOW), '');
});
