// The client's status page (app/status-logic.js) and its reminder rules
// (app/status-rules.js): the words above the buttons, the stations, the promised
// dates (never an internal target, never a passed one), what we need from the
// client, the WhatsApp checkbox wording on q.html, and the ladders of a fix request
// and a low score. `npm test` runs this under UTC, New York and Jerusalem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  wordingFor, itemText, cleanName, stationOf, nextMilestones, needsFromYou, MARKS, TOKEN, statusUrl, statusLinkMessage,
  WHATSAPP_CONSENT, QUESTIONS, lowScore, severeScore, team, receiptText, STATIONS_CLIENT, actionError,
} from '../app/status-logic.js';
import { STATIONS, PROCESSES } from '../app/protocol.js';
import { computeReminders } from '../app/reminder-engine.js';
import { RULES } from '../app/reminder-rules.js';
import { dateIL, partsIL } from '../app/tz.js';
import { importKeys } from '../app/client-open.js';
import { IMPORT_NOTE } from '../app/protocol-logic.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const marks = (obj) => Object.fromEntries(Object.entries(obj).map(([k, at]) => [k, { s: 'done', at: at ? at.toISOString() : null }]));
const data = (client, m = {}, extra = {}) => ({ client: { name: 'דנה', business: 'קפה דנה', status: 'active', rounds: [], ...client }, marks: m, items: [], surveys: { due: [], answered: [] }, ...extra });
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };

test('the words above the buttons: the legal drafts, filled in; another round is worded apart', () => {
  const base = { name: '  דנה   לוי ', business: 'קפה דנה בע״מ', item: 'videos', round: 1 };
  assert.equal(wordingFor('approve', base),
    'אני, דנה לוי, מאשר/ת בשם קפה דנה בע״מ את הסרטונים, סבב 1, כפי שהוא, כולל נכונות המידע שבו. אחרי האישור הפריט עובר לתזמון ולפרסום.');
  assert.equal(wordingFor('fix', base),
    'אני, דנה לוי, מבקש/ת תיקון לסרטונים. זה סבב 1 מתוך 1 הכלולים. כתבו כאן את כל ההערות בבת אחת. הפריט יחזור אלינו לתיקון.');
  assert.equal(wordingFor('fix', { ...base, item: 'graphics9', round: 2 }),
    'אני, דנה לוי, מבקש/ת תיקון נוסף ל־9 הגרפיקות הראשונות, מעבר לסבבים הכלולים בחבילה. כתבו כאן את כל ההערות בבת אחת. נחזור אליך לפני שמתחילים.');
  assert.match(wordingFor('approve', { ...base, item: 'scripts', shootRound: 2 }), /את התסריטים ליום הצילום \(סבב צילום 2\), סבב 1, .* עובר ליום הצילום\.$/);
  assert.equal(itemText('graphics', 1, 'lamed'), 'ליתרת הגרפיקות');
  assert.equal(cleanName('\t א  ב \n'), 'א ב');
  assert.match(receiptText({ decision: 'approve', item: 'videos', shootRound: 1, round: 1, name: 'דנה', at: '2026-10-13T09:05:00Z' }), /^התקבל: הסרטונים, סבב 1, אושר על ידי דנה ביום ג׳ 13\.10 בשעה 12:05\.$/);
  assert.match(receiptText({ decision: 'fix', item: 'graphics9', shootRound: 1, round: 1, name: 'דנה', at: '2026-10-13T09:05:00Z' }), /בקשת תיקון ל־9 הגרפיקות הראשונות/);
});

test('the link: 43 base64url characters, next to the page; the message carries it', () => {
  assert.ok(TOKEN.test('a'.repeat(43)));
  assert.ok(!TOKEN.test('a'.repeat(42)) && !TOKEN.test(`${'a'.repeat(42)}=`) && !TOKEN.test(`${'a'.repeat(42)}+`));
  const url = statusUrl('https://adamsin155.github.io/---/client.html?id=x#tasks', `${'A'.repeat(42)}-`);
  assert.equal(url, `https://adamsin155.github.io/---/status.html?t=${'A'.repeat(42)}-`);
  const msg = statusLinkMessage({ name: 'דנה' }, url);
  assert.match(msg, /^היי דנה, זה דף המצב האישי שלכם אצלנו:\nhttps:/);
  assert.doesNotMatch(msg, /[{}[\]]/);
});

test('the marks the page reads are client-facing items of the protocol, never an internal mark', () => {
  const items = new Set(PROCESSES.flatMap((p) => p.items.map((i) => i.key)));
  for (const k of ['p07.sent', 'p07.approved', 'p13.approved', 'r2.p27.approved', 'p27.notes', 'p05.logo', 'p34.talk', 'p30.live']) assert.ok(MARKS.test(k), k);
  for (const k of ['p25.return.1', 'p22.missing', 'p22.pause', 'p27.wait', 'p13.zoom', 'p25.q.errors', 'p22a.assigned', 'p06.claim', 'p22a.shift', 'p04.followup']) assert.ok(!MARKS.test(k), k);
  // Every key it can match is a real item (or the approval mark of the rest of the graphics, or 4's "ended").
  const probe = ['p02.opened', 'p04.saved', 'p05.access', 'p05.colors', 'p05.photos', 'p05.videos', 'p11.ok.client', 'p11.calendar', 'p12.scripts', 'p12.numbered', 'p12.docs',
    'p19.all', 'p19.took', 'p23.sent', 'p26.sent', 'p27.fixes', 'p27.final', 'p28.scheduled', 'p29.sent'];
  for (const k of probe) { assert.ok(MARKS.test(k), k); assert.ok(items.has(k), k); }
  assert.ok(!items.has('p23.approved') && MARKS.test('p23.approved'));
});

test('stations: the same 8 as the office\'s bar, reached by the client\'s milestones', () => {
  assert.deepEqual(STATIONS_CLIENT.map((s) => [s.key, s.title]), STATIONS.map((s) => [s.key, s.title]));
  const now = IL(2026, 10, 13, 11); // Tuesday
  assert.equal(stationOf(data({}), now), 0);
  assert.equal(stationOf(data({ charAt: IL(2026, 10, 14, 10).toISOString() }), now), 0);
  assert.equal(stationOf(data({ charAt: IL(2026, 10, 13, 10).toISOString() }), now), 1);
  assert.equal(stationOf(data({ charAt: IL(2026, 10, 8, 10).toISOString() }, marks({ 'p12.scripts': now })), now), 2);
  // The business day before the shoot is already the shoot's station (Sunday's shoot: from Thursday).
  assert.equal(stationOf(data({ shootAt: IL(2026, 10, 18, 11).toISOString() }, marks({ 'p12.docs': now })), IL(2026, 10, 15, 9)), 3);
  assert.equal(stationOf(data({ shootAt: IL(2026, 10, 18, 11).toISOString() }, marks({ 'p12.docs': now })), IL(2026, 10, 14, 9)), 2);
  assert.equal(stationOf(data({ shootAt: IL(2026, 10, 12, 11).toISOString() }), now), 4);
  assert.equal(stationOf(data({ shootAt: IL(2026, 9, 1, 11).toISOString() }, marks({ 'p27.approved': null })), now), 5);
  assert.equal(stationOf(data({ shootAt: IL(2026, 9, 1, 11).toISOString() }, marks({ 'p27.approved': null, 'p28.scheduled': null, 'p29.sent': null, 'p30.live': null })), now), 6);
  assert.equal(stationOf(data({ contractEnd: '2026-12-01' }), now), 7);
  assert.equal(stationOf(data({ status: 'ending' }), now), 7);
  // An extra shoot round under way is shown by itself, from "content".
  const round = data({ shootAt: IL(2026, 5, 1, 11).toISOString(), rounds: [{ n: 2, startAt: IL(2026, 10, 1).toISOString(), shootAt: IL(2026, 10, 20, 11).toISOString() }] },
    marks({ 'p27.approved': null, 'p28.scheduled': null, 'p29.sent': null, 'p30.live': null }));
  assert.equal(stationOf(round, now), 2);
});

test('the next three dates are the promised ones (section 4), in order; none passed, nothing internal', () => {
  const now = IL(2026, 10, 13, 11); // Tuesday
  // Characterized this morning: ה2 today, ה4 and ה5 by the third business day (Friday 16.10), and renewal far off.
  const d = data({ charAt: IL(2026, 10, 13, 10).toISOString(), contractEnd: '2027-10-13' });
  const list = nextMilestones(d, now);
  assert.deepEqual(list.map((m) => m.promise), ['ה2', 'ה4', 'ה5']);
  assert.equal(list[0].when, 'עד יום ג׳ 13.10');
  assert.equal(list[1].when, 'עד יום א׳ 18.10'); // 3 business days: Wednesday, Thursday, Sunday
  // The shoot is set: its day and time, then the videos closed within 5 business days from the day after.
  const s = data({ charAt: IL(2026, 10, 1, 10).toISOString(), shootAt: IL(2026, 10, 15, 11).toISOString(), contractEnd: '2027-10-01' }, marks({ 'p07.sent': null, 'p13.approved': null }));
  const l2 = nextMilestones(s, now);
  assert.deepEqual(l2.map((m) => m.key), ['shoot', 'videos', 'renewal']);
  assert.equal(l2[0].when, 'יום ה׳ 15.10 בשעה 11:00');
  assert.equal(l2[1].when, 'עד יום ה׳ 22.10');
  // The promise for the videos passed and they are not closed: not repeated to the client.
  const late = data({ shootAt: IL(2026, 9, 1, 11).toISOString(), contractEnd: '2027-09-01' }, marks({ 'p07.sent': null, 'p13.approved': null }));
  assert.deepEqual(nextMilestones(late, now).map((m) => m.key), ['renewal']);
  // Approved videos: the Gantt and the campaign within a business day.
  const pub = data({ shootAt: IL(2026, 10, 1, 11).toISOString() }, marks({ 'p27.approved': IL(2026, 10, 13, 9) }));
  assert.equal(nextMilestones(pub, now)[0].key, 'campaign');
  assert.equal(nextMilestones(pub, now)[0].when, 'עד יום ד׳ 14.10');
  for (const m of [...list, ...l2]) assert.doesNotMatch(m.label, /יעד|פנימי|באיחור/);
});

test('"מה אנחנו צריכים ממך": materials, access by a call, approvals, the shoot date, the survey', () => {
  const now = IL(2026, 10, 13, 11);
  const d = data({ shootAt: IL(2026, 10, 20, 11).toISOString() }, marks({ 'p04.ended': now, 'p05.logo': null }),
    { items: [{ item: 'graphics9', key: 'p07.approved', shootRound: 1, state: 'waiting', round: 1 }, { item: 'scripts', key: 'p13.approved', shootRound: 1, state: 'fixing', round: 2 }], surveys: { due: ['shoot'], answered: [] } });
  const needs = needsFromYou(d, now).map((n) => n.text);
  assert.deepEqual(needs, [
    'לשלוח לנו בוואטסאפ: צבעי המותג, תמונות, סרטונים שכבר יש לכם',
    'גישות לרשתות: נתאם איתכם שיחה קצרה. לא שולחים סיסמאות בהודעה',
    'לאשר או לבקש תיקון: 9 הגרפיקות הראשונות',
    'לאשר לנו בקבוצה את מועד יום הצילום: יום ג׳ 20.10 בשעה 11:00',
    'שאלה קצרה אחת, לא חובה',
  ]);
  assert.deepEqual(needsFromYou(data({}), now), []);
});

test('the team: first names and roles only', () => {
  const t = team();
  assert.deepEqual(t.map((p) => p.name), ['ליאור', 'עירית', 'אופיר', 'עילאי']);
  for (const p of t) assert.doesNotMatch(`${p.name} ${p.role}`, /@|\d{3}/);
});

test('scores: 3 or less of 5 (6 of 10) is a call; 2 or less (4 of 10) the owner too', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((s) => [lowScore('shoot', s), severeScore('shoot', s)]), [[true, true], [true, true], [true, false], [false, false], [false, false]]);
  assert.deepEqual([4, 5, 6, 7].map((s) => [lowScore('nps', s), severeScore('nps', s)]), [[true, true], [true, false], [true, false], [false, false]]);
  assert.match(QUESTIONS.nps, /מ־0 עד 10/);
});

test('q.html shows the WhatsApp checkbox wording exactly, unchecked, apart from the signing consent', () => {
  const html = readFileSync(new URL('../q.html', import.meta.url), 'utf8');
  const label = /<span id="wa-label">([^<]+)<\/span>/.exec(html)?.[1];
  const more = /<p class="wa-more" id="wa-more"[^>]*>([^<]+)<\/p>/.exec(html)?.[1];
  const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  assert.equal(unescape(label), WHATSAPP_CONSENT.label);
  assert.equal(unescape(more), WHATSAPP_CONSENT.more);
  assert.match(html, /<input type="checkbox" id="s-whatsapp"(?![^>]*checked)[^>]*>/);
  assert.doesNotMatch(html, /לתיעוד החתימה בלבד/);
  assert.match(html, /ואם סימנת את התיבה, גם לעדכוני שירות ב־WhatsApp/);
  // The same words the database stores with the signature.
  const sql = readFileSync(new URL('../supabase/migrations/20260930170000_client_status.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes(`'${WHATSAPP_CONSENT.label}'`));
  assert.ok(sql.includes(`'${WHATSAPP_CONSENT.more}'`));
});

test('the database\'s refusals in the client\'s words', () => {
  assert.match(actionError(new Error('staff cannot act for the client')), /אנשי צוות/);
  assert.match(actionError(new Error('wording changed')), /רעננו/);
  assert.match(actionError(new Error('Failed to fetch')), /נשאר בעמוד/);
});

// ── The ladders ──────────────────────────────
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' }, { email: 'nadia@x', person: 'nadia' },
];
function world() {
  const c = { id: 'c1', name: 'קפה דנה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 9, 1, 10).toISOString(), editor: 'nadia', shoot_at: IL(2026, 10, 1, 11).toISOString() };
  const checks = { c1: Object.fromEntries(importKeys('post').map((k) => [k, { client_id: 'c1', item_key: k, state: 'done', note: IMPORT_NOTE, at: IL(2026, 9, 1, 9).toISOString() }])) };
  return { clients: [c], checks, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF };
}
const task = (o) => ({ id: `t${Math.random()}`, client_id: 'c1', title: 'x', owner: 'ilai', due_on: '2026-10-13', done_at: null, created_by_email: '', created_at: IL(2026, 10, 13, 10).toISOString(), urgent: false, started_at: null, ...o });
const of = (list, rule) => list.filter((r) => r.rule === rule).map((r) => `${r.step}@${r.person}:${r.level}`).sort();

test('rules: both are in the matrix, with their own ids', () => {
  assert.ok(RULES.some((r) => r.id === 'clientFix') && RULES.some((r) => r.id === 'clientScore'));
});

test('a fix request rings whoever fixes, once; the ordinary task rule leaves it alone; late: the owner and Lior\'s list', () => {
  const w = world();
  w.tasks.push(task({ source: 'client_fix', title: 'תיקון לבקשת הלקוח: 9 הגרפיקות הראשונות · סבב 1', brief: { item: 'graphics9', item_key: 'p07.approved', problem: 'הלוגו קטן מדי', round: 1 } }));
  const now = IL(2026, 10, 13, 10, 1);
  const got = computeReminders({ ...w, now });
  assert.deepEqual(of(got, 'clientFix'), ['now@ilai:ring']);
  assert.match(got.find((r) => r.rule === 'clientFix').body, /הלוגו קטן מדי/);
  assert.deepEqual(of(got, 'task'), []);
  // Logged: not again.
  assert.deepEqual(of(computeReminders({ ...w, now: IL(2026, 10, 13, 12), log: got.map((r) => ({ key: r.key })) }), 'clientFix'), []);
  // The due day passes (Tuesday): Wednesday 08:30, Ilai in the app and Lior's list.
  const late = computeReminders({ ...w, now: IL(2026, 10, 14, 8, 31), log: got.map((r) => ({ key: r.key })) });
  assert.deepEqual(of(late, 'clientFix'), ['late@ilai:quiet', 'lior@lior:digest']);
  // Done: nothing more.
  w.tasks[0].done_at = IL(2026, 10, 13, 15).toISOString();
  assert.deepEqual(of(computeReminders({ ...w, now: IL(2026, 10, 14, 8, 31) }), 'clientFix'), []);
});

test('the videos\' first round rings the editor once, through the protocol\'s own ladder (p27.notes)', () => {
  const w = world();
  for (const k of ['p26.sent']) w.checks.c1[k] = { client_id: 'c1', item_key: k, state: 'done', note: null, at: IL(2026, 10, 12, 10).toISOString() };
  for (const k of ['p27.approved', 'p27.final', 'p27.fixes', 'p27.toilai', 'p27.notes']) delete w.checks.c1[k];
  w.checks.c1['p27.notes'] = { client_id: 'c1', item_key: 'p27.notes', state: 'done', note: JSON.stringify({ text: 'סרטון 3: להחליף מוזיקה', via: 'status' }), at: IL(2026, 10, 13, 10).toISOString() };
  w.tasks.push(task({ owner: 'nadia', source: 'client_fix', brief: { item: 'videos', item_key: 'p27.approved', notes_marked: true, round: 1 } }));
  const got = computeReminders({ ...w, now: IL(2026, 10, 13, 10, 1) });
  const rings = got.filter((r) => r.person === 'nadia' && r.level === 'ring').map((r) => `${r.rule}.${r.step}`);
  assert.deepEqual(rings, ['clientFixes.editor']);
});

test('a low score: Lior rings once to call; 2 or less rings the owner too; not called a day after the due day: the owner\'s screen', () => {
  const w = world();
  w.tasks.push(task({ id: 't3', owner: 'lior', source: 'survey', title: 'להתקשר ללקוח: ציון 3 מתוך 5', due_on: '2026-10-14', brief: { kind: 'shoot', score: 3, owner_alert: false } }));
  w.tasks.push(task({ id: 't2', owner: 'lior', source: 'survey', title: 'להתקשר ללקוח: ציון 2 מתוך 5', due_on: '2026-10-14', brief: { kind: 'delivery', score: 2, owner_alert: true } }));
  const now = IL(2026, 10, 13, 10, 1);
  const got = computeReminders({ ...w, now });
  assert.deepEqual(of(got, 'clientScore'), ['now@lior:ring', 'now@lior:ring', 'owner@owner:ring']);
  assert.match(got.find((r) => r.rule === 'clientScore' && r.person === 'owner').title, /ציון 2 מתוך 5/);
  assert.match(got.find((r) => r.rule === 'clientScore' && r.person === 'lior').body, /להתקשר ללקוח עד ד׳ 14\.10/);
  assert.deepEqual(of(got, 'task'), []);
  const later = computeReminders({ ...w, now: IL(2026, 10, 15, 8, 31), log: got.map((r) => ({ key: r.key })) });
  assert.deepEqual(of(later, 'clientScore'), ['board@owner:board', 'board@owner:board']);
  assert.equal(hhmm(later.find((r) => r.rule === 'clientScore').at), '15.10 08:30');
});
