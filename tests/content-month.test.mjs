// The contents of each month against the contract (22.11.2026; app/content-month-logic.js,
// docs/ops.md section 144). Invented clients only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contentTotal, contractMonths, spread, targetOf, byClient, monthOfClient, cardLines, cardNote, shortList, monthTable,
  aheadDue, monthEndDue, summaryDue, noBrand, syncTrusted, summaryWords, monthEndWords, aheadWords, rangeOf,
  AHEAD_TO, MONTH_END_TO, NO_BRAND_TO, SUMMARY_TO,
} from '../app/content-month-logic.js';
import { dateIL } from '../app/tz.js';

const year = { id: 'c1', business: 'פיצה דוגמה', deal_at: '2026-09-10', contract_end: '2027-09-10', deliverables: { videos: 60, graphics: 12 } };
const odd = { id: 'c2', business: 'אופנה דוגמה', deal_at: '2026-09-10', contract_end: '2027-09-10', deliverables: { videos: 50 } };
const half = { id: 'c3', business: 'קליניקה דוגמה', deal_at: '2026-09-01', contract_end: '2027-03-01', deliverables: { videos: 12, graphics: 6 } };
const monthly = { id: 'c4', business: 'מסעדה דוגמה', deal_at: '2026-06-01', contract_end: '2027-06-01', deliverables: { videos_month: 8, videos_month_except: { '2026-12': 4 }, graphics: 24 } };
const nothing = { id: 'c5', business: 'בלי כמויות', deal_at: '2026-06-01', deliverables: {} };
const NOV = dateIL(2026, 11, 22, 12, 0); // a Sunday

test('the target: the contract total over its months, the extra ones first', () => {
  assert.equal(contentTotal(year), 72);
  assert.equal(contractMonths(year), 12);
  assert.equal(contractMonths(half), 6);
  assert.equal(contractMonths({ deal_at: '2026-01-01' }), 12, 'no end: 12');
  assert.equal(targetOf(year, '2026-10', '2026-10'), 6);
  assert.equal(targetOf(year, '2026-10', '2027-09'), 6);
  assert.equal(targetOf(year, '2026-10', '2027-10'), null, 'after the contract months');
  assert.equal(targetOf(year, '2026-10', '2026-09'), null, 'before the first content');
  assert.equal(targetOf(year, null, '2026-10'), null, 'no content yet: not counted');
  const parts = Array.from({ length: 12 }, (_, i) => spread(50, 12, i));
  assert.deepEqual(parts.slice(0, 3), [5, 5, 4]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 50);
  assert.equal(targetOf(half, '2026-11', '2026-11'), 3);
  assert.equal(targetOf(nothing, '2026-10', '2026-10'), null);
});

test('a monthly client: its month number of videos and the graphics spread', () => {
  assert.equal(targetOf(monthly, '2026-07', '2026-11'), 8 + 2);
  assert.equal(targetOf(monthly, '2026-07', '2026-12'), 4 + 2, 'a month with its own number');
});

const rows = [
  { client_id: 'c1', first_month: '2026-10', month: '2026-10', posted: 6, planned: 6 },
  { client_id: 'c1', first_month: '2026-10', month: '2026-11', posted: 4, planned: 5 },
  { client_id: 'c1', first_month: '2026-10', month: '2026-12', posted: 0, planned: 6 },
  { client_id: 'c2', first_month: '2026-10', month: '2026-11', posted: 1, planned: 1 },
  { client_id: 'c3', first_month: '2026-08', month: null, posted: 0, planned: 0 },
];

test('the rows of public.content_months, by client', () => {
  const map = byClient(rows);
  assert.equal(map.get('c1').first, '2026-10');
  assert.deepEqual(map.get('c1').months['2026-11'], { posted: 4, planned: 5 });
  assert.deepEqual(map.get('c3').months, {});
  assert.deepEqual(rangeOf(NOV), { from: '2026-10', cur: '2026-11', to: '2026-12' });
});

test('the card: last month, this month and next month in words', () => {
  const map = byClient(rows);
  const lines = cardLines(year, map.get('c1'), NOV);
  assert.deepEqual(lines.map((l) => l.text), [
    'אוקטובר: עלו 6 מתוך 6',
    'נובמבר: עלו 4 מתוך 6 · עוד אחד מתוזמן',
    'דצמבר: מתוזמנים 6 מתוך 6',
  ]);
  assert.deepEqual(lines.map((l) => l.tone), ['ok', 'warn', 'ok']);
  assert.equal(cardNote(year, map.get('c1')), null);
  assert.match(cardNote(year, undefined), /עוד לא עלה/);
  assert.match(cardNote(year, undefined, { mapped: false }), /לא מחובר/);
  assert.match(cardNote(nothing, undefined), /לא הוזן/);
});

test('the list: the clients short this month, the biggest gap first', () => {
  const map = byClient(rows);
  const list = shortList([year, odd, half, nothing], map, NOV);
  assert.deepEqual(list.map((x) => [x.client.id, x.month.missing]), [['c2', 4], ['c3', 3], ['c1', 1]]);
  const table = monthTable([year, odd, nothing], map, '2026-12', NOV);
  assert.deepEqual(table.map((x) => [x.client.id, x.month.planned, x.month.target]), [['c2', 0, 4], ['c1', 6, 6]]);
});

test('a month that ended counts what went up; this month counts what is planned too', () => {
  const m = monthOfClient(year, { first: '2026-10', months: { '2026-10': { posted: 4, planned: 6 } } }, '2026-10', NOV);
  assert.equal(m.ended, true);
  assert.equal(m.missing, 2);
  assert.equal(m.short, true);
});

test('the alerts\' days: business days of their window only, with the month in the key', () => {
  assert.deepEqual(aheadDue(dateIL(2026, 12, 20, 12))?.key, '2027-01');
  assert.equal(aheadDue(NOV), null, 'not before 1.12.2026 (the owner, 22.11.2026)');
  assert.equal(aheadDue(dateIL(2026, 12, 17, 12)), null, 'before the 20th');
  assert.equal(aheadDue(dateIL(2026, 12, 26, 12)), null, 'Saturday');
  assert.equal(monthEndDue(NOV), null, 'not in the first week');
  assert.equal(monthEndDue(dateIL(2026, 12, 1, 12)), null, 'November is not told');
  assert.equal(monthEndDue(dateIL(2027, 1, 4, 12)).key, '2026-12');
  assert.equal(summaryDue(dateIL(2026, 12, 1, 12)).key, '2026-12');
  assert.equal(summaryDue(dateIL(2026, 12, 8, 12)), null);
  const at = summaryDue(dateIL(2026, 12, 1, 12)).at;
  assert.equal(at.toISOString(), dateIL(2026, 12, 1, 9, 0).toISOString());
});

test('who hears what (the owner, 22.11.2026)', () => {
  assert.deepEqual(AHEAD_TO, ['ilai', 'irit']);
  assert.deepEqual(NO_BRAND_TO, ['ilai', 'irit']);
  assert.deepEqual(MONTH_END_TO, ['ilai', 'irit', 'ofir', 'lior']);
  assert.deepEqual(SUMMARY_TO, ['ilai', 'irit', 'ofir', 'lior']);
});

test('no brand: a client with contents, 45 days after the deal, not connected and not marked', () => {
  assert.equal(noBrand({ ...year, metricool_blog_id: null }, NOV), true);
  assert.equal(noBrand({ ...year, metricool_blog_id: '123' }, NOV), false);
  assert.equal(noBrand({ ...year, metricool_none: true }, NOV), false);
  assert.equal(noBrand({ ...year, deal_at: '2026-11-01' }, NOV), false, 'too soon');
  assert.equal(noBrand(nothing, NOV), false);
});

test('a sync that read the whole listing is trusted for "scheduled"', () => {
  assert.equal(syncTrusted({ ok: true, stats: {} }), true);
  assert.equal(syncTrusted({ ok: true, stats: { partial: true } }), false);
  assert.equal(syncTrusted({ ok: false }), false);
  assert.equal(syncTrusted(null), false);
});

test('the words', () => {
  const m = monthOfClient(year, { first: '2026-10', months: { '2026-11': { posted: 4, planned: 4 } } }, '2026-11', dateIL(2026, 12, 1, 12));
  assert.equal(monthEndWords(year, m).body, 'לקוח פיצה דוגמה: עלו 4 מתוך 6 בנובמבר. חסרים 2.');
  assert.match(aheadWords(year, { ...m, label: 'דצמבר', planned: 3, missing: 3 }).title, /^חסר בתזמון לדצמבר: פיצה דוגמה 3\/6$/);
  const map = byClient(rows);
  const s = summaryWords(monthTable([year, odd], map, '2026-12', NOV), '2026-12');
  assert.equal(s.title, 'התכנים של דצמבר: לקוח אחד חסר');
  assert.equal(s.body, 'מתוזמנים מול החוזה לדצמבר:\nאופנה דוגמה 0/4\nלקוח אחד מתוזמן במלואו.');
});

// ── The reminder rules (app/reminder-rules.js) through the engine ──
import { CONTENT_RULES } from '../app/reminder-rules.js';
import { buildEnv, computeReminders, lateBatches } from '../app/reminder-engine.js';

const STAFF = ['ilai', 'irit', 'ofir', 'lior', null].map((p) => ({ email: `${p || 'owner'}@x.test`, person: p }));
const live = (c, over = {}) => ({ status: 'active', archived_at: null, metricool_blog_id: '100', ...c, ...over });
const CL = [live(year), live(odd), live(half, { metricool_blog_id: null, deal_at: '2026-01-01' })];
const SYNC = [{ client_id: 'c1', ok: true, stats: {} }, { client_id: 'c2', ok: true, stats: { partial: true } }];
const MONTHS = (rows2) => ({ contentMonths: rows2, ganttSync: SYNC, staff: STAFF, clients: CL });
const due = (input, now) => computeReminders({ ...input, now, log: [] }).filter((r) => r.rule.startsWith('content'));

test('nothing is told before the counting function exists (contentMonths null)', () => {
  assert.deepEqual(due({ clients: CL, staff: STAFF, contentMonths: null }, dateIL(2026, 12, 1, 11)), []);
});

test('from the 20th: next month scheduled short → Ilai and Irit, only with a trusted sync, once a month', () => {
  const rowsDec = [
    { client_id: 'c1', first_month: '2026-10', month: '2027-01', posted: 0, planned: 5 },
    { client_id: 'c2', first_month: '2026-10', month: '2027-01', posted: 0, planned: 0 },
  ];
  const at10 = dateIL(2026, 12, 20, 10, 5);
  const r = due(MONTHS(rowsDec), at10).filter((x) => x.rule === CONTENT_RULES.ahead);
  assert.deepEqual(r.map((x) => [x.clientId, x.person]), [['c1', 'ilai'], ['c1', 'irit']], 'c2: its last sync was partial; c3: no brand');
  assert.equal(r[0].key, 'contentAhead:c1:2027-01:ahead@ilai');
  assert.equal(r[0].batch, true);
  assert.equal(r[0].title, 'חסר בתזמון לינואר: פיצה דוגמה 5/6');
  assert.equal(due(MONTHS(rowsDec), dateIL(2026, 12, 20, 9, 30)).filter((x) => x.rule === CONTENT_RULES.ahead).length, 0, 'not before 10:00');
  assert.equal(due(MONTHS(rowsDec), dateIL(2026, 12, 17, 12)).filter((x) => x.rule === CONTENT_RULES.ahead).length, 0, 'not before the 20th');
});

test('the first week: last month went up short → Ilai, Irit, Ofir and Lior', () => {
  const rowsNov = [{ client_id: 'c1', first_month: '2026-10', month: '2026-12', posted: 4, planned: 6 }];
  const r = due(MONTHS(rowsNov), dateIL(2027, 1, 4, 10, 1)).filter((x) => x.rule === CONTENT_RULES.monthEnd);
  assert.deepEqual(r.map((x) => x.person), ['ilai', 'irit', 'ofir', 'lior']);
  assert.equal(r[0].body, 'לקוח פיצה דוגמה: עלו 4 מתוך 6 בדצמבר. חסרים 2.');
  assert.equal(due(MONTHS(rowsNov), dateIL(2027, 1, 11, 10, 1)).filter((x) => x.rule === CONTENT_RULES.monthEnd).length, 0, 'after the first week');
});

test('no brand: Ilai and Irit, once (the key has no month)', () => {
  const r = due(MONTHS([]), dateIL(2026, 12, 1, 10, 1)).filter((x) => x.rule === CONTENT_RULES.noBrand);
  assert.deepEqual(r.map((x) => [x.clientId, x.person]), [['c3', 'ilai'], ['c3', 'irit']]);
  assert.equal(r[0].key, 'contentNoBrand:c3:nobrand:brand@ilai');
  assert.match(r[0].url, /^gantt\.html\?id=c3$/);
});

test('the 1st at 09:00: one summary of the month to the four, short first; Ilai\'s opens his page', () => {
  const rowsDec = [
    { client_id: 'c1', first_month: '2026-10', month: '2026-12', posted: 0, planned: 6 },
    { client_id: 'c2', first_month: '2026-10', month: '2026-12', posted: 0, planned: 1 },
  ];
  const r = due(MONTHS(rowsDec), dateIL(2026, 12, 1, 9, 0)).filter((x) => x.rule === CONTENT_RULES.summary);
  assert.deepEqual(r.map((x) => x.person).sort(), ['ilai', 'irit', 'lior', 'ofir']);
  assert.equal(new Set(r.map((x) => x.key.split('@')[0].replace(/:(ilai|office)$/, ''))).size, 1, 'one case');
  assert.equal(r[0].title, 'התכנים של דצמבר: לקוח אחד חסר');
  assert.equal(r[0].body, 'מתוזמנים מול החוזה לדצמבר:\nאופנה דוגמה 1/4\nלקוח אחד מתוזמן במלואו.');
  assert.equal(r.find((x) => x.person === 'ilai').url, 'year.html#content');
  assert.equal(r.find((x) => x.person === 'irit').url, 'owner.html#content');
  assert.equal(r.every((x) => x.noFold), true, 'its own message, not folded into the morning digest');
  assert.equal(due(MONTHS(rowsDec), dateIL(2026, 12, 1, 8, 59)).filter((x) => x.rule === CONTENT_RULES.summary).length, 0);
  // 1.12.2026 is a Tuesday; on a Saturday the 1st waits for the first business day.
  assert.equal(due(MONTHS(rowsDec), dateIL(2027, 5, 1, 9, 5)).filter((x) => x.rule === CONTENT_RULES.summary).length, 0, 'Saturday 1.5.2027');
});

test('the per-client notes go out together: one push with all of them', () => {
  const rowsDec = [
    { client_id: 'c1', first_month: '2026-10', month: '2027-01', posted: 0, planned: 5 },
    { client_id: 'c9', first_month: '2026-10', month: '2027-01', posted: 0, planned: 2 },
  ];
  const env = buildEnv({ ...MONTHS(rowsDec), clients: [...CL, live({ ...year, id: 'c9', business: 'עוד עסק' })], ganttSync: [...SYNC, { client_id: 'c9', ok: true, stats: {} }], now: dateIL(2026, 12, 20, 10, 5) });
  const queued = computeReminders({ env, log: [] }).filter((x) => x.rule === CONTENT_RULES.ahead && x.person === 'ilai')
    .map((x, i) => ({ ...x, id: i + 1, status: 'queued', reason: 'batch', created_at: env.now.toISOString() }));
  const out = lateBatches({ env, log: queued });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'חסר בתזמון לינואר: 2 פריטים');
});

test('the alerts start on 1.12.2026; the first month-end alert is about December', async () => {
  const m = await import('../app/content-month-logic.js');
  const d = (s) => new Date(s);
  assert.equal(m.aheadDue(d('2026-11-23T08:00:00Z')), null);
  assert.equal(m.summaryDue(d('2026-11-23T08:00:00Z')), null);
  assert.equal(m.summaryDue(d('2026-12-01T08:00:00Z')).key, '2026-12');
  assert.equal(m.monthEndDue(d('2026-12-01T08:00:00Z')), null);
  assert.equal(m.aheadDue(d('2026-12-21T08:00:00Z')).key, '2027-01');
  assert.equal(m.monthEndDue(d('2027-01-04T08:00:00Z')).key, '2026-12');
});
