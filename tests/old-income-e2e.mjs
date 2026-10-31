// End-to-end check of the tab "הכנסות ישנות" (owner.html#old-income; docs/ops.md, section 86) in the
// browser, against an in-memory fake of Supabase whose table answers as row level security does, with
// fake rows. On an iPhone 13 (WebKit) and on Chromium at 360 and 1280:
//   - the owner: the big total, the copy line, the months newest first, "בלי תאריך" last; a tap opens
//     the deals; real typing and deleting, key by key, in the filter box, Hebrew intact, cursor kept;
//   - Irit, Ofir and Lior: no tab, no read, even by the direct address;
//   - the table is missing: one short line; a failure: a retry that works;
//   - only reads reach the table; nothing scrolls sideways, targets 44px, no page errors, no CSP refusal.
// Run: npx http-server -p 8094 -s -c-1 . &  then  BASE_URL=http://localhost:8094/ node tests/old-income-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const NOW = new Date('2026-11-02T08:00:00Z');

const users = new Map();
for (const email of ['owner', 'irit', 'ofir', 'lior'].map((p) => `${p}@astrateg.test`)) {
  users.set(email, { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-01-01T00:00:00Z' });
}
const staff = [
  { email: 'owner@astrateg.test', person: null, vault: true },
  { email: 'irit@astrateg.test', person: 'irit', vault: true },
  { email: 'ofir@astrateg.test', person: 'ofir', vault: false },
  { email: 'lior@astrateg.test', person: 'lior', vault: false },
];
const deal = (old_id, deal_date, business, amount, o = {}) => ({ old_id, deal_date, business, amount, retainer: 0, package: null, payment_method: null, close_type: null, ...o });
const FAKE = [
  deal('d1', '2026-10-27', 'פיצה רון', 25000, { package: 'סושיאל פרימיום עם משפיען ומעטפת מלאה', retainer: 4900, payment_method: 'אשראי', close_type: 'טלפון' }),
  deal('d2', '2026-10-03', 'קפה דנה בע"מ', 18000, { package: 'סושיאל', payment_method: 'העברה' }),
  deal('d3', '2026-03-15', 'מרכז בריאות ואיכות חיים לכל המשפחה רחובות והסביבה בעמ', 1234567, { package: 'חבילה רחבה', retainer: 10000, payment_method: 'שיקים דחויים לתקופה ארוכה מאוד', close_type: 'פגישה במשרד אצל הלקוח' }),
  deal('d4', '2025-12-31', 'מוסך דוד', 21240),
  deal('d5', '2025-12-01', null, 30000, { package: 'בלי משפיען' }),
  deal('d6', null, 'פיצריה בלי תאריך', 40000),
];
const SUM = FAKE.reduce((s, d) => s + d.amount, 0);
const money = (n) => `${new Intl.NumberFormat('en-US').format(n)} ₪`;
const COPY = 'עותק מ־27.10.2026 · לצפייה בלבד · לא משפיע על התשלומים';

const EXP = Math.floor(NOW / 1000) + 8 * 3600;
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const sessionFor = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 8 * 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const staffOf = (u) => staff.find((s) => s.email === u?.email);
const personOf = (u) => staffOf(u)?.person;
const isOwner = (u) => !!staffOf(u) && staffOf(u).person === null;

// 'rows' | 'missing' | 'fail'
let tableMode = 'rows';
const tableCalls = [];

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const json = (status, data) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
  });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  const me = userOf(req.headers());
  if (p === '/auth/v1/token') {
    const u = users.get(String(body?.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
    return json(200, sessionFor(u));
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.slice('/rest/v1/rpc/'.length);
    if (name === 'is_staff') return json(200, !!staffOf(me));
    if (name === 'is_office') return json(200, !!staffOf(me));
    if (name === 'my_person') return json(200, personOf(me) ?? null);
    if (name === 'sees_money') return json(200, isOwner(me));
    return json(200, []);
  }
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  const many = (rows) => ((req.headers().accept || '').includes('vnd.pgrst.object') ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116' })) : json(200, rows));
  if (m[1] === 'old_income_deals') {
    tableCalls.push({ method: req.method(), by: me.email });
    if (req.method() !== 'GET') return json(403, { code: '42501', message: 'permission denied' });
    if (tableMode === 'missing') return json(404, { code: 'PGRST205', message: "Could not find the table 'public.old_income_deals' in the schema cache" });
    if (tableMode === 'fail') return json(500, { code: 'XX000', message: 'boom' });
    return json(200, isOwner(me) ? FAKE : []);
  }
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    return many(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff);
  }
  return many([]);
}

const errors = [];
async function newPage(engine) {
  const ctx = await engine.browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', serviceWorkers: 'block', ...engine.options });
  await ctx.clock.install({ time: NOW });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => [], staff: () => staff }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page);
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  return page;
}
async function signIn(page, who, path, ready) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.locator(ready).first().waitFor();
  await page.waitForFunction(() => !document.querySelector('#lg-email')?.offsetParent, null, { timeout: 15000 });
  await page.waitForTimeout(400);
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const nothingCutOff = (page) => page.evaluate(() => [...document.querySelectorAll('#view-old-income *')].filter((el) => {
  if (!el.offsetParent) return false;
  const r = el.getBoundingClientRect();
  return r.right > document.documentElement.clientWidth + 1 || r.left < -1;
}).map((el) => el.className || el.tagName));
const smallTargets = (page) => page.evaluate(() => [...document.querySelectorAll('#view-old-income button, #view-old-income input, #tab-old-income')].filter((el) => el.offsetParent && el.getBoundingClientRect().height < 43.5)
  .map((el) => `${el.id}:${Math.round(el.getBoundingClientRect().height)}`));
const months = (page) => page.locator('#oi-months > li > button .oi-m-t strong').allInnerTexts();

let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

async function ownerSees(engine) {
  const L = engine.label;
  tableMode = 'rows';
  tableCalls.length = 0;
  const p = await newPage(engine);
  await signIn(p, 'owner', 'owner.html#old-income', '#oi-total:not([hidden])');

  await step(`${L}: the owner opens the tab by its address: the big total, the words, the months newest first, no date last`, async () => {
    assert.equal(p.url().endsWith('#old-income'), true);
    assert.equal(await p.locator('#tab-old-income').isVisible(), true);
    assert.equal(await p.locator('#tab-old-income').getAttribute('aria-selected'), 'true');
    assert.equal(await p.locator('#ow-title').innerText(), 'הכנסות ישנות');
    // The chosen tab is whole in its row, not cut at the edge.
    await p.waitForTimeout(600);
    const cut = await p.evaluate(() => {
      const t = document.getElementById('tab-old-income').getBoundingClientRect();
      const r = document.getElementById('ow-tabs').getBoundingClientRect();
      return { tab: [Math.round(t.left), Math.round(t.right)], row: [Math.round(r.left), Math.round(r.right)], whole: t.left >= r.left - 0.5 && t.right <= r.right + 0.5 };
    });
    assert.equal(cut.whole, true, JSON.stringify(cut));
    assert.equal(await p.locator('#oi-sum').innerText(), money(SUM));
    assert.equal(await p.locator('#oi-sum-label').innerText(), 'סכום כפי שנרשם במערכת הישנה');
    assert.equal(await p.locator('#oi-count').innerText(), '6 עסקאות');
    assert.equal(await p.locator('#oi-copy').innerText(), COPY);
    assert.deepEqual(await months(p), ['אוקטובר 2026', 'מרץ 2026', 'דצמבר 2025', 'בלי תאריך']);
    const first = await p.locator('#oi-m-2026-10').innerText();
    assert.match(first, /2 עסקאות/);
    assert.ok(first.includes(money(43000)));
    assert.match(await p.locator('#oi-m-2026-03').innerText(), /עסקה אחת/);
    assert.equal(await p.locator('.oi-deal').count(), 0, 'the months start closed');
    assert.equal(await noSideScroll(p), true);
    assert.deepEqual(await nothingCutOff(p), []);
    assert.deepEqual(await smallTargets(p), []);
    await shot(p, `01-months-${L}`);
  });

  await step(`${L}: a tap opens a month: date, business, amount, package, and the quiet line; a second tap closes it`, async () => {
    await p.locator('#oi-m-2026-10').click();
    assert.equal(await p.locator('#oi-m-2026-10').getAttribute('aria-expanded'), 'true');
    const rows = p.locator('#oi-m-2026-10-b .oi-deal');
    assert.equal(await rows.count(), 2);
    const t = await rows.first().innerText();
    for (const part of ['27.10.2026', 'פיצה רון', money(25000), 'סושיאל פרימיום', `ריטיינר ${money(4900)} · תשלום: אשראי · סגירה: טלפון`]) assert.ok(t.includes(part), part);
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'oi-m-2026-10', 'the focus stays on the month');
    await p.locator('#oi-m-2026-03').click();
    await p.locator('#oi-m-none').click();
    assert.match(await p.locator('#oi-m-none-b .oi-deal').innerText(), /בלי תאריך[\s\S]*פיצריה בלי תאריך/);
    await p.locator('#oi-m-2025-12').click();
    assert.match(await p.locator('#oi-m-2025-12-b .oi-deal').nth(1).innerText(), /בלי שם עסק/);
    assert.equal(await noSideScroll(p), true);
    assert.deepEqual(await nothingCutOff(p), []);
    await shot(p, `02-open-${L}`);
    await p.locator('#oi-m-2025-12').click();
    await p.locator('#oi-m-none').click();
    await p.locator('#oi-m-2026-03').click();
    await p.locator('#oi-m-2026-10').click();
    assert.equal(await p.locator('.oi-deal').count(), 0);
  });

  await step(`${L}: the filter box: real typing and deleting, key by key: Hebrew intact, the cursor stays, the list follows`, async () => {
    const box = p.locator('#oi-q');
    if (engine.options.isMobile) assert.equal(await box.evaluate((el) => getComputedStyle(el).fontSize), '16px', 'Safari does not zoom in');
    await box.click();
    const TEXT = 'פיצה רון';
    await box.pressSequentially(TEXT, { delay: 25 });
    assert.equal(await box.inputValue(), TEXT);
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'oi-q');
    assert.deepEqual(await p.locator('.oi-biz').allInnerTexts(), ['פיצה רון'], 'opened by itself');
    assert.equal(await p.locator('#oi-found').innerText(), `נמצאו עסקה אחת · ${money(25000)}`);
    assert.equal(await p.locator('#oi-sum').innerText(), money(SUM), 'the big total stays the whole copy');
    await shot(p, `03-filter-${L}`);
    for (let i = 0; i < 4; i += 1) await p.keyboard.press('Backspace');
    assert.equal(await box.inputValue(), 'פיצה');
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'oi-q');
    assert.deepEqual(await p.locator('.oi-biz').allInnerTexts(), ['פיצה רון']);
    await box.pressSequentially('ריה', { delay: 25 });
    assert.equal(await box.inputValue(), 'פיצהריה');
    assert.equal(await p.locator('#oi-found').innerText(), 'לא נמצא עסק בשם הזה');
    assert.equal(await p.locator('.oi-deal').count(), 0);
    assert.equal(await noSideScroll(p), true);
    await shot(p, `04-filter-none-${L}`);
    for (let i = 0; i < 7; i += 1) await p.keyboard.press('Backspace');
    assert.equal(await box.inputValue(), '');
    assert.equal(await p.locator('#oi-found').isVisible(), false);
    assert.equal(await p.locator('.oi-deal').count(), 0, 'closed again, as they were');
    assert.equal((await months(p)).length, 4);
    await box.pressSequentially('פיצ', { delay: 25 });
    assert.deepEqual(await p.locator('.oi-biz').allInnerTexts(), ['פיצה רון', 'פיצריה בלי תאריך']);
    assert.deepEqual(await smallTargets(p), []);
    await p.locator('#oi-m-none').click();
    assert.deepEqual(await p.locator('.oi-biz').allInnerTexts(), ['פיצה רון'], 'a month can be closed while filtering');
    assert.equal(await box.inputValue(), 'פיצ');
    await box.fill('');
  });

  await step(`${L}: going to another tab and back keeps it, with no second read; only reads reached the table`, async () => {
    const reads = tableCalls.length;
    assert.equal(reads, 1);
    await p.locator('#tab-now').click();
    assert.equal(await p.locator('#view-old-income').isVisible(), false);
    await p.locator('#tab-old-income').click();
    assert.equal(await p.locator('#oi-sum').innerText(), money(SUM));
    assert.equal(p.url().endsWith('#old-income'), true);
    assert.equal(tableCalls.length, reads);
    assert.deepEqual([...new Set(tableCalls.map((c) => c.method))], ['GET']);
  });
  await p.context().close();
}

async function othersDoNot(engine) {
  const L = engine.label;
  tableMode = 'rows';
  for (const who of ['irit', 'ofir', 'lior']) {
    tableCalls.length = 0;
    const p = await newPage(engine);
    await step(`${L}: ${who}: no tab, no read, also by the direct address`, async () => {
      await signIn(p, who, 'owner.html#old-income', '#ow-page:not([hidden])');
      assert.equal(await p.locator('#tab-old-income').isVisible(), false);
      assert.equal(await p.locator('#view-old-income').isVisible(), false);
      assert.equal(p.url().endsWith('#old-income'), false, 'moved to a tab they have');
      assert.deepEqual(tableCalls, []);
      assert.equal(await noSideScroll(p), true);
    });
    await p.context().close();
  }
}

async function missingAndFailed(engine) {
  const L = engine.label;
  tableMode = 'missing';
  const p = await newPage(engine);
  await step(`${L}: the table is not there: one short line, no box, no total`, async () => {
    await signIn(p, 'owner', 'owner.html#old-income', '#oi-msg-text');
    await p.waitForFunction(() => document.getElementById('oi-msg-text')?.textContent !== 'טוען…');
    assert.equal(await p.locator('#oi-msg-text').innerText(), 'ההכנסות הישנות עוד לא הועלו למערכת.');
    assert.equal(await p.locator('#oi-total').isVisible(), false);
    assert.equal(await p.locator('#oi-q').isVisible(), false);
    assert.equal(await noSideScroll(p), true);
    await shot(p, `05-missing-${L}`);
  });
  await p.context().close();

  tableMode = 'fail';
  const q = await newPage(engine);
  await step(`${L}: a failure says so with a retry, and the retry works`, async () => {
    await signIn(q, 'owner', 'owner.html#old-income', '#oi-retry');
    assert.equal(await q.locator('#oi-msg-text').innerText(), 'לא הצלחנו לטעון.');
    assert.deepEqual(await smallTargets(q), []);
    tableMode = 'rows';
    await q.locator('#oi-retry').click();
    await q.locator('#oi-total:not([hidden])').waitFor();
    assert.equal(await q.locator('#oi-sum').innerText(), money(SUM));
    assert.equal(await q.locator('#oi-retry').count(), 0);
  });
  await q.context().close();
}

const browsers = [];
let exitCode = 0;
try {
  const safari = await webkit.launch();
  const chrome = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  browsers.push(safari, chrome);
  const iphone = { label: 'iphone13-webkit', browser: safari, options: { ...devices['iPhone 13'] } };
  const narrow = { label: 'chromium-360', browser: chrome, options: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true } };
  const web = { label: 'chromium-1280', browser: chrome, options: { viewport: { width: 1280, height: 900 } } };
  for (const engine of [iphone, narrow, web]) {
    await ownerSees(engine);
    await othersDoNot(engine);
    await missingAndFailed(engine);
  }
  assert.deepEqual(errors, [], 'no page errors');
  noCspViolations();
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await Promise.all(browsers.map((b) => b.close()));
}
console.log(`\n${passed} passed${exitCode ? ', and then a failure' : ''}`);
process.exit(exitCode);
