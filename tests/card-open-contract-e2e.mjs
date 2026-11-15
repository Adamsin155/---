// "פתיחת החוזה" in the card's "החוזה החתום" (the owner, 15.11.2026: "אין אופציה לראות"): a client opened
// from an agreement signed in the system gets a link to that agreement (q.html#t=…, where "הורדת PDF" is).
// Who cannot read the quote gets no token and no button. Office of tests/flow-world.mjs (invented names).
//   1  WebKit as an iPhone 13: the button, its link, no sideways scroll.
//   2  Chromium at 1366: the same; the quote's token taken away: no button.
// Run: node <a static server> . 8462 &  then  BASE_URL=http://localhost:8462/ node tests/card-open-contract-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8462/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\/]+$/, '')}/`;
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const ID = cid(12);
const QID = '7d2c5a10-1111-4222-8333-944455556666';
const TOKEN = 'b1e2c3d4-aaaa-4bbb-8ccc-0123456789ab';

const db = flowWorld({ landing: false, queues: false });
Object.assign(db.clients.find((c) => c.id === ID), { quote_id: QID });
db.quotes.push({ id: QID, number: 'AST-2026-0061', token: TOKEN, status: 'signed', signed_at: '2026-10-18T10:00:00+03:00', client_name: 'x' });

async function signedIn(engine, opts) {
  const fake = makeFlowFake(db);
  const ctx = await engine.newContext({ ...opts, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}client.html?id=${ID}`);
  await page.fill('#lg-email', emailOf('ofir'));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#cc-head h1');
  await settle(page);
  await page.locator('#fold-contract > summary').click();
  return { page, ctx };
}
let passed = 0;
async function step(name, fn) { try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; } }

await step('1  iPhone (WebKit): "פתיחת החוזה" opens the signed agreement', async () => {
  const wk = await webkit.launch();
  const { page, ctx } = await signedIn(wk, devices['iPhone 13']);
  const a = page.locator('#cd-quote-open');
  await a.waitFor();
  assert.equal(await a.innerText(), 'פתיחת החוזה');
  assert.match(await a.getAttribute('href'), new RegExp(`q\.html#t=${TOKEN}$`));
  assert.equal(await a.getAttribute('target'), '_blank');
  await a.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll');
  if (SHOTS) await page.locator('#contract-docs').screenshot({ path: `${OUT}card-open-contract-390.png` });
  await ctx.close(); await wk.close();
});

await step('2  Chromium 1366: the button; no token, no button', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  let { page, ctx } = await signedIn(browser, { viewport: { width: 1366, height: 900 } });
  await page.locator('#cd-quote-open').waitFor();
  if (SHOTS) await page.locator('#contract-docs').screenshot({ path: `${OUT}card-open-contract-1366.png` });
  await ctx.close();
  db.quotes[0].token = null;
  ({ page, ctx } = await signedIn(browser, { viewport: { width: 1366, height: 900 } }));
  await page.locator('#cd-quote').waitFor();
  assert.equal(await page.locator('#cd-quote-open').count(), 0);
  await ctx.close(); await browser.close();
});

assert.deepEqual(errors, [], 'page errors');
console.log(`\n${passed} passed`);
