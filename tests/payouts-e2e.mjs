// End-to-end browser check of the payouts app against an in-memory fake of
// Supabase (auth + the PostgREST calls data.js makes). Made-up values only.
// Run: npx http-server -p 8080 . &  then  node tests/payouts-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { computeMonth, commissionStatement } from '../app/payouts/engine.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ils = (n) => Math.round(n * 100);

const OWNER = { id: randomUUID(), email: 'owner@astrateg.test', aud: 'authenticated', role: 'authenticated' };
const OTHER = { id: randomUUID(), email: 'seller@astrateg.test', aud: 'authenticated', role: 'authenticated' };
const EXP = Math.floor(Date.now() / 1000) + 3600;
const jwt = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const USERS = { 'owner@astrateg.test': OWNER, 'seller@astrateg.test': OTHER };

const SETTINGS = {
  payment: { realBp: 800, commissionBp: 1000 },
  commissionPeople: [
    { id: 'a', name: 'מוכרת בדיקה', rates: { simeon: 1000, natali: 2000 } },
    { id: 'b', name: 'מנהל בדיקה', rates: { simeon: 500, natali: 500 } },
  ],
  items: {
    'natali-story': { real: ils(1111), commission: ils(2222), per: 'unit' },
    'natali-reel': { real: null, commission: null, per: 'unit' },
    'simeon-story': { real: 0, commission: 0, per: 'unit' },
    'simeon-collab': { real: 0, commission: 0, per: 'unit' },
    'simeon-day': { real: ils(500), commission: ils(500), per: 'unit' },
    'simeon-join': { real: 0, commission: 0, per: 'deal' },
    ch14: { real: ils(2000), commission: ils(2000), per: 'unit' },
    'photographer-monthly': { real: ils(10000), commission: ils(10000), per: 'unit' },
    graphics: { real: ils(300), commission: ils(300), per: 'deal' },
  },
  production: {
    'social-simeon': { influencer: ils(5000), photographer: ils(100), makeup: 0 },
    'social-tv-simeon': { influencer: ils(5000), photographer: ils(100), makeup: 0 },
    'social-natali': { influencer: ils(4000), photographer: ils(100), makeup: ils(50) },
    'social-tv-natali': { influencer: ils(4000), photographer: ils(100), makeup: ils(50) },
    'podcast-simeon': { influencer: ils(3000), photographer: ils(100), makeup: 0 },
    'podcast-natali': { influencerPerDay: ils(9000), clientsPerDay: 3, makeupPerDay: ils(70), photographer: ils(100), makeup: 0 },
  },
  payees: { influencer: { simeon: 'משפיען ס', natali: 'משפיענית נ' }, photographer: 'צלם', makeup: 'מאפרת' },
  employees: [{ id: 'e1', name: 'עובד בדיקה', role: 'עורך', salary: ils(1000), payroll: true }],
  employerCostBp: 2000,
  perDealPeople: [{ id: 'c1', name: 'סוגר בדיקה', amount: ils(250) }],
  meetingRate: ils(40),
  meetingPayee: 'מוכרת בדיקה',
  expenses: [{ id: 'x1', name: 'פרסום בדיקה', amount: ils(500) }],
  partners: [
    { id: 'p1', name: 'שותף 1', weight: 1 },
    { id: 'p2', name: 'שותף 2', weight: 1 },
  ],
};

const tables = {
  payout_owners: [{ user_id: OWNER.id, email: OWNER.email }],
  payout_settings: [{ id: randomUUID(), effective_from: '2026-01-01', data: SETTINGS, note: 'בדיקה', created_at: new Date().toISOString() }],
  payout_deals: [], payout_incomes: [], payout_expenses: [], payout_locks: [],
};
const locked = (m) => tables.payout_locks.some((l) => l.month === m);
const monthOf = (t, r) => (t === 'payout_expenses' ? r.month : (r.deal_date || r.income_date || '').slice(0, 7));

function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
    else if (op === 'gte') out = out.filter((r) => r[k] >= val);
    else if (op === 'lte') out = out.filter((r) => r[k] <= val);
    else if (op === 'not' && val === 'is.null') out = out.filter((r) => r[k] !== null && r[k] !== undefined);
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split('.');
    out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  if (params.get('limit')) out = out.slice(0, Number(params.get('limit')));
  return out;
}

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers });
  if (process.env.DEBUG) console.log(req.method(), url.pathname + url.search, req.postData()?.slice(0, 200));
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  if (p === '/auth/v1/token') {
    const u = USERS[body.email];
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwt(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: u });
  }
  if (p === '/auth/v1/user') return json(200, OWNER);
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers });
  const m = p.match(/^\/rest\/v1\/(\w+)$/);
  if (!m) return json(404, { message: 'not found' });
  const t = m[1];
  const auth = req.headers().authorization || '';
  const who = [OWNER, OTHER].find((u) => auth.includes(jwt(u)));
  const owner = who && tables.payout_owners.some((o) => o.user_id === who.id);
  if (t === 'payout_owners') return json(200, applyFilters(tables.payout_owners, url.searchParams).filter((r) => r.user_id === who?.id));
  if (!owner) return json(200, []);
  const rows = tables[t];
  const guard = (r) => (t !== 'payout_settings' && t !== 'payout_locks' && locked(monthOf(t, r)));
  if (req.method() === 'GET') {
    const out = applyFilters(rows, url.searchParams);
    if ((req.headers().accept || '').includes('vnd.pgrst.object')) {
      return out.length ? json(200, out[0]) : json(406, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' });
    }
    return json(200, out);
  }
  if (req.method() === 'POST') {
    const list = Array.isArray(body) ? body : [body];
    for (const r of list) {
      if (guard(r)) return json(400, { code: 'P0001', message: 'month is locked' });
      if (t === 'payout_settings') {
        const last = tables.payout_locks.map((l) => l.month).sort().pop();
        if (last && r.effective_from.slice(0, 7) <= last) return json(400, { code: 'P0001', message: 'settings overlap a locked month' });
        const i = rows.findIndex((x) => x.effective_from === r.effective_from);
        const row = { id: randomUUID(), created_at: new Date().toISOString(), ...r };
        if (i >= 0) rows[i] = row; else rows.push(row);
        continue;
      }
      rows.push({ id: randomUUID(), created_at: new Date().toISOString(), locked_at: new Date().toISOString(), ...r });
    }
    return route.fulfill({ status: 201, headers });
  }
  if (req.method() === 'PATCH') {
    for (const r of applyFilters(rows, url.searchParams)) {
      if (guard(r) || guard({ ...r, ...body })) return json(400, { code: 'P0001', message: 'month is locked' });
      Object.assign(r, body);
    }
    return route.fulfill({ status: 204, headers });
  }
  if (req.method() === 'DELETE') {
    const del = applyFilters(rows, url.searchParams);
    if (del.some(guard)) return json(400, { code: 'P0001', message: 'month is locked' });
    tables[t] = rows.filter((r) => !del.includes(r));
    return route.fulfill({ status: 204, headers });
  }
  return json(405, {});
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', fakeSupabase);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function login(page, email) {
  await page.goto(`${BASE}payouts/#/month/2026-09`);
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה').fill('correct-horse');
  await page.getByRole('button', { name: 'כניסה' }).click();
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const noHScroll = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// 1. Non-owner is refused.
{
  const page = await newPage({ width: 390, height: 844 });
  await login(page, OTHER.email);
  await page.getByRole('heading', { name: 'אין לך גישה למערכת התשלומים' }).waitFor();
  assert.equal(await page.locator('#nav').isVisible(), false);
  await page.context().close();
  console.log('ok  non-owner refused');
}

// 2. Owner flow on a phone.
const page = await newPage({ width: 390, height: 844 });
await login(page, OWNER.email);
await page.getByRole('heading', { name: /ספטמבר 2026/ }).waitFor();
await shot(page, 'phone-month-empty');

await page.getByRole('button', { name: 'עסקה חדשה' }).first().click();
const dlg = page.getByRole('dialog');
await dlg.getByRole('heading', { name: 'עסקה חדשה' }).waitFor();
await dlg.getByRole('button', { name: 'שמירת העסקה' }).click();
await dlg.getByText('חסר שם לקוח.').first().waitFor();
assert.equal(await page.evaluate(() => document.activeElement.classList.contains('err-summary')), true, 'focus moves to error summary');
await dlg.getByLabel('שם הלקוח').fill('מסעדת <b>"הבדיקה"</b> & בנו');
await dlg.getByLabel('תאריך סגירה').fill('2026-09-14');
await dlg.getByRole('radio', { name: /Social \+ TV/ }).check();
await dlg.getByRole('radio', { name: 'נטלי דדון' }).check();
assert.equal(await page.evaluate(() => document.activeElement?.dataset?.key), 'influencer:natali', 'focus kept after redraw');
await dlg.getByRole('checkbox', { name: /צלם חודשי/ }).check();
await dlg.getByRole('button', { name: 'הוספת צ׳ופר' }).click();
await dlg.getByLabel('צ׳ופר 1', { exact: true }).selectOption('natali-story');
await dlg.getByLabel('הנחה חודשית (₪)').fill('100');
await dlg.getByLabel('הנחה חודשית (₪)').blur();
await shot(page, 'phone-deal-form');
await dlg.getByRole('button', { name: 'שמירת העסקה' }).click();
await page.getByRole('dialog').waitFor({ state: 'hidden' });

await page.getByRole('button', { name: 'עסקה חדשה' }).first().click();
await dlg.getByLabel('שם הלקוח').fill('לקוח שני');
await dlg.getByLabel('תאריך סגירה').fill('2026-09-30');
await dlg.getByRole('radio', { name: /Social all in one/ }).check();
await dlg.getByRole('radio', { name: 'סמיון, מישל ודניס' }).check();
await dlg.getByLabel('גרפיקות נוספות').selectOption('24');
await dlg.getByLabel('מי סגר').selectOption('סוגר בדיקה');
await dlg.getByText('סוגר בדיקה · עמלת סגירה').waitFor();
await dlg.getByRole('button', { name: 'שמירת העסקה' }).click();
await page.getByRole('dialog').waitFor({ state: 'hidden' });
assert.equal(tables.payout_deals.length, 2);
const saved = tables.payout_deals.find((d) => d.client.startsWith('מסעדת'));
assert.deepEqual(saved.selection.paid, ['photographer']);
assert.equal(saved.selection.discount, 10000);
assert.deepEqual(saved.perks, [{ id: 'natali-story', qty: 1 }]);
assert.equal(tables.payout_deals.find((d) => d.client === 'לקוח שני').seller, 'סוגר בדיקה');
console.log('ok  deals saved with the chosen package, add-ons, perk and discount');

// Screen numbers match the engine.
const expected = computeMonth({
  month: '2026-09',
  deals: tables.payout_deals.map((d) => ({ id: d.id, date: d.deal_date, client: d.client, selection: d.selection, perks: d.perks, seller: d.seller })),
  versions: [{ effectiveFrom: '2026-01-01', data: SETTINGS }],
});
await page.goto(`${BASE}payouts/#/deals/2026-09`);
await page.getByRole('heading', { name: '2 עסקאות' }).waitFor();
const dealsText = await page.locator('#view').innerText();
assert.ok(dealsText.includes('<b>"הבדיקה"</b>'), 'client name shown as text');
assert.equal(await page.locator('#view b').count(), 0, 'no HTML injected');
await shot(page, 'phone-deals');

await page.goto(`${BASE}payouts/#/month/2026-09`);
await page.getByRole('heading', { name: 'חלוקה לשותפים' }).waitFor();
const monthText = await page.locator('#view').innerText();
const fmt = (a) => `${new Intl.NumberFormat('he-IL', a % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 }).format(a / 100)} ₪`;
assert.ok(monthText.includes(fmt(expected.totals.revenue)), 'revenue on screen');
assert.ok(monthText.includes(fmt(expected.totals.profit)), 'profit on screen');
assert.ok(monthText.includes('לא הוגדרה עלות') === false);
assert.ok(await noHScroll(page), 'no horizontal scroll (phone month)');
await shot(page, 'phone-month');
console.log('ok  month totals match the engine');

// Extra income and one-off expense.
await page.getByRole('button', { name: 'הוספה' }).first().click();
await dlg.getByLabel('תיאור').fill('שיקים של לקוח ישן');
await dlg.getByLabel('סכום (₪, לפני מע״מ)').fill('1,234.50');
await dlg.getByRole('button', { name: 'שמירה' }).click();
await page.getByRole('dialog').waitFor({ state: 'hidden' });
assert.equal(tables.payout_incomes[0].amount_agorot, 123450);
await page.getByRole('button', { name: 'הוספה' }).nth(1).click();
await dlg.getByLabel('סוג').selectOption('other');
await dlg.getByLabel('למי').fill('ספק בדיקה');
await dlg.getByLabel('תיאור').fill('אירוע לקוחות');
await dlg.getByLabel('סכום (₪)').fill('750');
await dlg.getByRole('button', { name: 'שמירה' }).dblclick();
await page.getByRole('dialog').waitFor({ state: 'hidden' });
assert.equal(tables.payout_expenses.length, 1, 'double click saves once');
assert.equal(tables.payout_expenses[0].amount_agorot, 75000);
await page.getByRole('button', { name: 'הוספה' }).nth(1).click();
await dlg.getByLabel('סוג').selectOption('meetings');
assert.equal(await dlg.getByLabel('למי').inputValue(), 'מוכרת בדיקה', 'meetings default payee');
await dlg.getByLabel('מספר פגישות שתואמו').fill('5');
await dlg.getByRole('button', { name: 'שמירה' }).click();
await page.getByRole('dialog').waitFor({ state: 'hidden' });
const meet = tables.payout_expenses.find((e) => e.kind === 'meetings');
assert.equal(meet.qty, 5);
assert.equal(meet.amount_agorot, ils(200));
await page.getByRole('button', { name: 'הוספה' }).nth(1).click();
await dlg.getByLabel('למי').fill('עובד בדיקה');
await dlg.getByLabel('סכום (₪)').fill('320');
await dlg.getByRole('button', { name: 'שמירה' }).click();
await page.getByRole('dialog').waitFor({ state: 'hidden' });
assert.equal(tables.payout_expenses.find((e) => e.payee === 'עובד בדיקה').kind, 'fuel');
console.log('ok  extra income and one-off expense');

// Payouts and the commission statement.
await page.goto(`${BASE}payouts/#/pay/2026-09`);
await page.getByRole('heading', { name: /עמלות/ }).waitFor();
await page.getByRole('heading', { name: /פיימנט/ }).waitFor();
assert.ok(await noHScroll(page), 'no horizontal scroll (phone payouts)');
await shot(page, 'phone-pay');
await page.getByText('מוכרת בדיקה').click();
await page.getByRole('button', { name: 'דוח עמלה להצגה' }).first().click();
await dlg.getByText('סה״כ לחודש').waitFor();
const stText = await dlg.locator('.statement').innerText();
const full = computeMonth({
  month: '2026-09',
  deals: tables.payout_deals.map((d) => ({ id: d.id, date: d.deal_date, client: d.client, selection: d.selection, perks: d.perks, seller: d.seller })),
  expenses: tables.payout_expenses.map((e) => ({ id: e.id, month: e.month, kind: e.kind, label: e.label, payee: e.payee, qty: e.qty, amount: e.amount_agorot })),
  incomes: tables.payout_incomes.map((e) => ({ id: e.id, date: e.income_date, label: e.label, family: e.family, amount: e.amount_agorot })),
  versions: [{ effectiveFrom: '2026-01-01', data: SETTINGS }],
});
const st = commissionStatement(full, 'a');
assert.ok(stText.includes(fmt(st.total)), 'statement total');
// Worked by hand, not by the engine: (4,900 + 2,000 − 100) × 12 = 81,600; payment shown 10% = 8,160;
// deductions: Channel 14 in the package 2,000 + Natali story in the package 2,222 + monthly
// photographer 10,000 + Natali story perk 2,222 = 16,444; base 56,996; 20% = 11,399.20.
for (const v of ['81,600 ₪', '8,160 ₪', '56,996 ₪', '11,399.20 ₪']) assert.ok(stText.includes(v), `hand-computed ${v}`);
assert.ok(stText.includes(fmt(ils(2222))), 'shown deduction for the perk');
assert.ok(!stText.includes(fmt(ils(1111))), 'real perk cost hidden');
assert.ok(!stText.includes('מנהל בדיקה') && !stText.includes('עובד בדיקה'), 'no other people in statement');
await shot(page, 'phone-statement');
await dlg.getByRole('button', { name: 'סגירה' }).click();
console.log('ok  statement shows only commission-side values');

// Settings: change a rate from a date.
await page.goto(`${BASE}payouts/#/settings/2026-09`);
await page.getByRole('heading', { name: 'מקבלי עמלה' }).waitFor();
assert.ok(await noHScroll(page), 'no horizontal scroll (phone settings)');
await shot(page, 'phone-settings');
await page.getByLabel('בתוקף מתאריך').fill('2026-09-20');
await page.getByLabel('נטלי דדון (%)').first().fill('25');
await page.getByRole('button', { name: 'שמירת גרסה חדשה של ההגדרות' }).click();
await page.getByText('ההגדרות נשמרו.').waitFor();
assert.equal(tables.payout_settings.length, 2);
assert.equal(tables.payout_settings[1].data.commissionPeople[0].rates.natali, 2500);
assert.equal(tables.payout_settings[0].data.commissionPeople[0].rates.natali, 2000, 'old version unchanged');
for (const el of await page.getByLabel('חלקים').all()) await el.fill('0');
await page.getByRole('button', { name: 'שמירת גרסה חדשה של ההגדרות' }).click();
await page.getByText(/לפחות לשותף אחד/).first().waitFor();
console.log('ok  settings versioned; bad partner split rejected');

// Pay screen: employer cost and closing fee.
await page.goto(`${BASE}payouts/#/pay/2026-09`);
await page.getByText('עובד בדיקה').click();
await page.getByText('עלות מעסיק').waitFor();
assert.ok((await page.locator('#view').innerText()).includes(fmt(ils(1000 + 200 + 320))), 'salary + employer cost + fuel');
await page.getByText('סוגר בדיקה').click();
await page.getByText(/עמלת סגירה · לקוח שני/).waitFor();
console.log('ok  employer cost, fuel, meetings and closing fee on the pay screen');

// Cancel a September deal in October: clawback of 11/12 in October.
await page.goto(`${BASE}payouts/#/deals/2026-10`);
await page.getByRole('heading', { name: '0 עסקאות' }).waitFor();
await page.getByRole('button', { name: 'ביטול עסקה' }).click();
await dlg.getByLabel('העסקה').selectOption(tables.payout_deals.find((d) => d.client.startsWith('מסעדת')).id);
await dlg.getByLabel('תאריך הביטול').fill('2026-10-20');
await dlg.getByLabel('תאריך הביטול').dispatchEvent('change');
assert.equal(await dlg.getByLabel('כמה חודשים הלקוח שילם').inputValue(), '1');
await shot(page, 'phone-cancel');
await dlg.getByRole('button', { name: 'שמירת הביטול' }).click();
await page.getByRole('dialog').waitFor({ state: 'hidden' });
const cancelled = tables.payout_deals.find((d) => d.client.startsWith('מסעדת'));
assert.equal(cancelled.cancelled_on, '2026-10-20');
assert.equal(cancelled.paid_months, 1);
await page.getByRole('heading', { name: 'עסקאות שבוטלו החודש' }).waitFor();
// 11/12 of the hand-computed commissions (11,399.20 and 5% × 56,996 = 2,849.80), rounded per person.
const back = -(Math.round((ils(11399.20) * 11) / 12) + Math.round((ils(2849.80) * 11) / 12));
assert.ok((await page.locator('#view').innerText()).includes(fmt(-back)), `clawback ${fmt(-back)}`);
await page.goto(`${BASE}payouts/#/deals/2026-09`);
await page.getByText(/בוטלה 20 באוק/).waitFor();
console.log('ok  cancellation claws back the unpaid months in the cancellation month');

// Lock and unlock.
await page.goto(`${BASE}payouts/#/month/2026-09`);
await page.getByRole('button', { name: 'סגירת החודש' }).click();
await dlg.getByRole('button', { name: 'כן, לסגור את החודש' }).click();
await page.getByText('החודש נעול.').first().waitFor();
assert.equal(tables.payout_locks.length, 1);
await page.locator('#nav-add').click();
await page.getByText('החודש נעול. פתחו אותו כדי להוסיף עסקאות.').waitFor();
await page.goto(`${BASE}payouts/#/settings/2026-09`);
await page.getByLabel('בתוקף מתאריך').fill('2026-09-25');
await page.getByRole('button', { name: 'שמירת גרסה חדשה של ההגדרות' }).click();
await page.getByText(/התאריך חייב להיות 2026-10-01/).first().waitFor();
await page.goto(`${BASE}payouts/#/month/2026-09`);
await page.getByRole('button', { name: 'פתיחת החודש' }).click();
await dlg.getByRole('button', { name: 'כן, לפתוח' }).click();
await page.getByText('החודש נפתח.').waitFor();
assert.equal(tables.payout_locks.length, 0);
console.log('ok  lock blocks edits and earlier settings; unlock works');

// Narrowest phone and desktop.
await page.setViewportSize({ width: 320, height: 700 });
for (const r of ['month', 'deals', 'pay', 'settings']) {
  await page.goto(`${BASE}payouts/#/${r}/2026-09`);
  await page.waitForTimeout(250);
  assert.ok(await noHScroll(page), `no horizontal scroll at 320px (${r})`);
}
await page.setViewportSize({ width: 1280, height: 860 });
await page.goto(`${BASE}payouts/#/month/2026-09`);
await page.getByRole('heading', { name: 'חלוקה לשותפים' }).waitFor();
await shot(page, 'desktop-month');
await page.locator('#nav-add').click();
await dlg.getByLabel('שם הלקוח').fill('לקוח מחשב');
await shot(page, 'desktop-deal-form');
await dlg.getByRole('button', { name: 'ביטול' }).click();
await page.goto(`${BASE}payouts/#/pay/2026-09`);
await page.getByRole('heading', { name: /עמלות/ }).waitFor();
await shot(page, 'desktop-pay');

// Manifest is valid JSON with a scope that excludes the quote pages.
const manifest = await (await page.request.get(`${BASE}payouts/manifest.webmanifest`)).json();
assert.equal(manifest.scope, '/---/payouts/');
assert.equal(manifest.display, 'standalone');

await browser.close();
assert.deepEqual(errors, [], `browser errors: ${errors.join(' | ')}`);
console.log('all payouts e2e checks passed');
