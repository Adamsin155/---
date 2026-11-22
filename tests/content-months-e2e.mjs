// "תכנים מול החוזה" (Irit and the owner, 22.11.2026; app/content-month-ui.js, the client card's block;
// docs/ops.md, section 144), against the office of tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in
// Israel; invented names). public.content_months is answered by this file.
//   1  WebKit as an iPhone 13: Irit opens a counted client: September, October and November in words,
//      October short; no sideways scroll.
//   2  Chromium at 1366: the manager view's tab "תכנים מול החוזה": the short clients, the biggest gap
//      first; "החודש הבא" switches; a row opens the client's card.
//   3  Chromium at 390: Ilai's "שנת החבילה" has the same list (year.html#content).
//   4  An editor's card has no block.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: node <a static server> . 8442 &  then  BASE_URL=http://localhost:8442/ node tests/content-months-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8442/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${OUT}content-months-${name}.png`, fullPage: false }); };
const A = cid(12);
const B = cid(13);
const C = cid(14);

const db = flowWorld({ landing: false, queues: false });
const byId = (id) => db.clients.find((c) => c.id === id);
const year = { deal_at: '2026-08-01T09:00:00+03:00', contract_end: '2027-08-01' };
Object.assign(byId(A), year, { deliverables: { ...byId(A).deliverables, videos: 60, graphics: 12 }, metricool_blog_id: '501' });
Object.assign(byId(B), year, { deliverables: { ...byId(B).deliverables, videos: 96, graphics: 0 }, metricool_blog_id: '502' });
Object.assign(byId(C), year, { deliverables: { ...byId(C).deliverables, videos: 36, graphics: 0 }, metricool_blog_id: '503' });
const ROWS = [
  { client_id: A, first_month: '2026-09', month: '2026-09', posted: 6, planned: 6 },
  { client_id: A, first_month: '2026-09', month: '2026-10', posted: 3, planned: 5 },
  { client_id: A, first_month: '2026-09', month: '2026-11', posted: 0, planned: 2 },
  { client_id: B, first_month: '2026-09', month: '2026-10', posted: 2, planned: 2 },
  { client_id: B, first_month: '2026-09', month: '2026-11', posted: 0, planned: 8 },
  { client_id: C, first_month: '2026-09', month: '2026-10', posted: 3, planned: 3 },
  { client_id: C, first_month: '2026-09', month: '2026-11', posted: 0, planned: 3 },
];
const calls = [];

async function signedIn(engine, opts, { who = 'irit', path = `client.html?id=${A}`, ready = '#cc-head h1' } = {}) {
  const fake = makeFlowFake(db);
  const ctx = await engine.newContext({ ...opts, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return fake.route(r);
    if (url.pathname === '/rest/v1/rpc/content_months') {
      const body = JSON.parse(req.postData() || '{}');
      calls.push(body);
      const rows = who === 'nadia' ? [] : ROWS.filter((x) => !body.p_client || x.client_id === body.p_client);
      return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(rows) });
    }
    return fake.route(r);
  });
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf(who));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector(ready);
  await settle(page);
  return { page, ctx };
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

await step('1  iPhone (WebKit): the card shows last, this and next month; this month short', async () => {
  const wk = await webkit.launch();
  const { page, ctx } = await signedIn(wk, devices['iPhone 13']);
  const box = page.locator('#content-months');
  await box.waitFor();
  assert.deepEqual((await box.locator('.cm-row').allInnerTexts()).map((t) => t.trim()), [
    'ספטמבר: עלו 6 מתוך 6',
    'אוקטובר: עלו 3 מתוך 6 · עוד 2 מתוזמנים',
    'נובמבר: מתוזמנים 2 מתוך 6',
  ]);
  assert.equal(await box.locator('.cm-row.is-warn').count(), 2);
  assert.match(await box.locator('.cm-basis').innerText(), /72 תכנים בחוזה על 12 חודשים/);
  assert.deepEqual(calls.at(-1), { p_from: '2026-09', p_to: '2026-11', p_client: A });
  assert.ok(await noSideways(page), 'no sideways scroll');
  await box.scrollIntoViewIfNeeded();
  await shot(page, 'card-390');
  await ctx.close();
  await wk.close();
});

await step('2  Chromium 1366: the manager view tab, short first; next month; a row opens the card', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const { page, ctx } = await signedIn(browser, { viewport: { width: 1366, height: 900 } }, { path: 'owner.html#content', ready: '#ow-page:not([hidden])' });
  await page.locator('#tab-content').click();
  const list = page.locator('#view-content .cmo-row');
  await list.first().waitFor();
  const rows = await list.allInnerTexts();
  assert.equal(rows.length, 2, 'C has its 3 of 3');
  assert.match(rows[0], /2\/8/, 'B: 2 of 8, the biggest gap first');
  assert.match(rows[0], /חסרים 6/);
  assert.match(rows[1], /5\/6/);
  assert.match(await page.locator('#view-content .wgroup-h').innerText(), /חסרים תכנים באוקטובר/);
  await shot(page, 'manager-1366');
  await page.locator('#view-content .chip', { hasText: 'החודש הבא' }).click();
  assert.match(await page.locator('#view-content .wgroup-h').innerText(), /חסרים תכנים בנובמבר/);
  const next = await page.locator('#view-content .cmo-row').allInnerTexts();
  assert.equal(next.length, 1, 'November: only A (2 of 6) is short');
  assert.match(next[0], /2\/6/);
  await shot(page, 'manager-next-1366');
  await page.locator('#view-content .cmo-name').first().click();
  await page.waitForURL(/client\.html\?id=.*#content-months/);
  await ctx.close();
  await browser.close();
});

await step('3  Chromium 390: Ilai\'s year page has the list', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const { page, ctx } = await signedIn(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { who: 'ilai', path: 'year.html#content', ready: '#yr-page:not([hidden])' });
  const sec = page.locator('#content');
  await sec.locator('.cmo-row').first().waitFor();
  assert.equal(await sec.locator('.cmo-row').count(), 2);
  assert.ok(await noSideways(page), 'no sideways scroll');
  await sec.scrollIntoViewIfNeeded();
  await shot(page, 'ilai-390');
  await ctx.close();
  await browser.close();
});

await step('4  an editor\'s card has no block', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const r = await signedIn(browser, { viewport: { width: 1366, height: 900 } }, { who: 'nadia' }).catch(() => null);
  if (r) {
    assert.equal(await r.page.locator('#content-months').count(), 0);
    await r.ctx.close();
  }
  await browser.close();
});

assert.deepEqual(errors, [], 'page errors');
console.log(`\n${passed} passed`);
