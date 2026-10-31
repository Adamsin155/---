// "הכנסות ישנות" (app/old-income-logic.js; docs/ops.md, section 86): the months, the filter, the words,
// and that no payment, commission, salary or profit-split code knows the table. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import {
  canSeeOldIncome, COPY_LINE, SUM_LABEL, shekels, countText, dateText, monthLabel, totalOf, monthsOf, filterByBusiness, quietLine, isMissingTable,
} from '../app/old-income-logic.js';

const deal = (old_id, deal_date, business, amount, extra = {}) => ({ old_id, deal_date, business, amount, retainer: 0, package: null, payment_method: null, close_type: null, ...extra });
const ROWS = [
  deal('a', '2026-03-05', 'פיצה רון', 1000),
  deal('b', '2026-10-27', 'קפה דנה בע"מ', 2500),
  deal('c', null, 'בלי תאריך בע״מ', 300),
  deal('d', '2026-10-01', null, 700),
  deal('e', '2025-12-31', 'מוסך דוד', 50),
  deal('f', '2026-10-27', 'אלף', 1),
];

test('the months: newest first, each with its count and sum; no date goes last, and nothing is lost', () => {
  const m = monthsOf(ROWS);
  assert.deepEqual(m.map((x) => [x.key, x.label, x.count, x.sum]), [
    ['2026-10', 'אוקטובר 2026', 3, 3201],
    ['2026-03', 'מרץ 2026', 1, 1000],
    ['2025-12', 'דצמבר 2025', 1, 50],
    ['none', 'בלי תאריך', 1, 300],
  ]);
  assert.deepEqual(m[0].deals.map((d) => d.old_id), ['b', 'f', 'd'], 'the newest deal first; same day in a stable order');
  assert.equal(m.reduce((s, x) => s + x.sum, 0), totalOf(ROWS).sum);
  assert.equal(m.reduce((s, x) => s + x.count, 0), ROWS.length);
});

test('a month edge stays in its month, in any time zone: no Date is involved', () => {
  const m = monthsOf([deal('x', '2026-01-01', 'א', 1), deal('y', '2025-12-31', 'ב', 1), deal('z', '2026-01-31', 'ג', 1)]);
  assert.deepEqual(m.map((x) => [x.key, x.count]), [['2026-01', 2], ['2025-12', 1]]);
  assert.equal(dateText('2026-01-01'), '01.01.2026');
});

test('a date the table cannot use goes under "בלי תאריך", not to a wrong month', () => {
  for (const bad of [null, undefined, '', 'x', '2026-13-01', '2026-00-10']) {
    assert.equal(monthsOf([deal('x', bad, 'א', 1)])[0].label, 'בלי תאריך', String(bad));
    assert.equal(dateText(bad), 'בלי תאריך');
  }
  assert.equal(monthLabel('2026-05'), 'מאי 2026');
});

test('nothing at all: no months, a total of zero', () => {
  assert.deepEqual(monthsOf([]), []);
  assert.deepEqual(totalOf([]), { count: 0, sum: 0 });
});

test('the original rows are not reordered', () => {
  const before = ROWS.map((r) => r.old_id);
  monthsOf(ROWS);
  assert.deepEqual(ROWS.map((r) => r.old_id), before);
});

test('the filter: by the business, any part, whatever the spaces and marks; no name is never found', () => {
  const ids = (q) => filterByBusiness(ROWS, q).map((r) => r.old_id);
  assert.equal(filterByBusiness(ROWS, '').length, ROWS.length);
  assert.equal(filterByBusiness(ROWS, '   ').length, ROWS.length);
  assert.deepEqual(ids('פיצה'), ['a']);
  assert.deepEqual(ids('  פיצה   רון '), ['a']);
  assert.deepEqual(ids('בע"מ'), ['b', 'c']);
  assert.deepEqual(ids('בע״מ'), ['b', 'c']);
  assert.deepEqual(ids('אין כזה'), []);
  assert.equal(ids('null').length, 0);
});

test('the words: whole shekels with commas; the quiet line says only what is there', () => {
  assert.equal(shekels(5712097), '5,712,097 ₪');
  assert.equal(shekels(0), '0 ₪');
  assert.equal(countText(1), 'עסקה אחת');
  assert.equal(countText(114), '114 עסקאות');
  assert.equal(quietLine(deal('x', null, 'א', 1)), '');
  assert.equal(quietLine(deal('x', null, 'א', 1, { retainer: 4900, payment_method: 'אשראי', close_type: 'טלפון' })), 'ריטיינר 4,900 ₪ · תשלום: אשראי · סגירה: טלפון');
  assert.equal(quietLine(deal('x', null, 'א', 1, { retainer: 0, close_type: 'טלפון' })), 'סגירה: טלפון');
});

test('the screen\'s words: as of the copy, view only; it makes no claim about VAT', () => {
  assert.equal(COPY_LINE, 'עותק מ־27.10.2026 · לצפייה בלבד · לא משפיע על התשלומים');
  assert.equal(SUM_LABEL, 'סכום כפי שנרשם במערכת הישנה');
  const src = ['app/old-income-logic.js', 'app/old-income-ui.js'].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, /מע״מ|מע"מ|מעמ/);
});

test('who: only the owners', () => {
  assert.equal(canSeeOldIncome({ scope: 'office', me: null }), true);
  for (const me of ['irit', 'ofir', 'lior', 'ilai']) assert.equal(canSeeOldIncome({ scope: 'office', me }), false, me);
  assert.equal(canSeeOldIncome(null), false);
  assert.equal(canSeeOldIncome({ error: 'x', scope: 'office' }), false);
});

test('the table not being there is told from a real failure', () => {
  for (const e of [{ code: '42P01' }, { code: 'PGRST205' }, { message: 'relation "public.old_income_deals" does not exist' }, { message: "Could not find the table 'public.old_income_deals' in the schema cache" }]) {
    assert.equal(isMissingTable(e), true, JSON.stringify(e));
  }
  for (const e of [null, {}, { code: '42501', message: 'permission denied' }, { message: 'Failed to fetch' }]) assert.equal(isMissingTable(e), false, JSON.stringify(e));
});

// Every file under a folder, as text.
function* filesIn(dir) {
  for (const name of readdirSync(dir)) {
    const url = new URL(`${name}`, dir);
    if (statSync(url).isDirectory()) yield* filesIn(new URL(`${name}/`, dir));
    else if (/\.(js|mjs|ts|html)$/.test(name)) yield url;
  }
}
test('nothing but the tab reads the table: no payment, commission, salary or profit-split code, no function', () => {
  const root = new URL('../', import.meta.url);
  const readers = [];
  for (const dir of ['app/', 'payouts/', 'supabase/functions/']) {
    for (const url of filesIn(new URL(dir, root))) {
      if (/old_income/.test(readFileSync(url, 'utf8'))) readers.push(url.href.slice(root.href.length));
    }
  }
  assert.deepEqual(readers, ['app/old-income-data.js']);
  const data = readFileSync(new URL('app/old-income-data.js', root), 'utf8');
  assert.doesNotMatch(data, /\.(insert|update|upsert|delete)\(/, 'the app only reads');
  for (const page of ['payouts/index.html']) assert.doesNotMatch(readFileSync(new URL(page, root), 'utf8'), /old-income/);
});

test('owner.html has the tab and the panel, and the tab starts hidden', () => {
  const html = readFileSync(new URL('../owner.html', import.meta.url), 'utf8');
  assert.match(html, /id="tab-old-income" aria-controls="view-old-income" hidden>הכנסות ישנות</);
  assert.match(html, /id="view-old-income" role="tabpanel" aria-labelledby="tab-old-income" hidden/);
});
