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
  assert.deepEqual(aheadDue(NOV)?.key, '2026-12');
  assert.equal(aheadDue(dateIL(2026, 11, 19, 12)), null, 'before the 20th');
  assert.equal(aheadDue(dateIL(2026, 11, 21, 12)), null, 'Saturday');
  assert.equal(monthEndDue(NOV), null, 'not in the first week');
  assert.equal(monthEndDue(dateIL(2026, 12, 1, 12)).key, '2026-11');
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
