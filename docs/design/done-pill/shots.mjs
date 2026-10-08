// The screenshots of docs/ops.md section 44 (the "סיימתי" pill): "המשימות שלי" and a client
// card, at 390px and 1280px, against the fake office of tests/roles-world.mjs (no real
// client data). One tick is held "saving" so the done state is in the frame.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node docs/design/done-pill/shots.mjs <before|after>
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from '../../../tests/roles-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const TAG = process.argv[2] || 'after';
const OUT = fileURLToPath(new URL('.', import.meta.url));
const SIZES = [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]];
const CARD = 'c0000000-0000-4000-8000-000000000004'; // "סטודיו גל": characterization, with late items

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function open(role, viewport, { full = false, mark = null } = {}) {
  const db = buildWorld();
  if (mark) mark(db);
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: viewport.width < 700, hasTouch: viewport.width < 700, deviceScaleFactor: 2 });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, makeFake(db).route);
  if (full) await ctx.addInitScript(() => { try { localStorage.setItem('astrateg.mine.full', 'on'); } catch { /* no storage */ } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}clients.html`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  return { page, ctx, db };
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500); };
// A save that does not come back while the picture is taken: the row stays "done".
const hold = (ctx) => ctx.route(`${SUPA}/rest/v1/protocol_checks*`, async (route) => {
  if (route.request().method() === 'GET') return route.fallback();
  await new Promise((r) => setTimeout(r, 6000));
  return route.fallback();
});
const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}${TAG}-${name}.png`, ...opts });

for (const [w, viewport] of SIZES) {
  // "המשימות שלי", the short view: late, today, and one item just marked.
  for (const full of [false, true]) {
    const { page, ctx } = await open('irit', viewport, { full });
    await page.waitForSelector('#view-mine:not([hidden]) .witem', { state: 'attached' });
    await settle(page);
    await hold(ctx);
    // The short view: the first card of several items opens its list.
    if (!full) await page.locator('#mine-list .wc-open').first().click();
    await page.locator(full ? '#mine-list .witem .cbx:visible:not(:disabled)' : '#mine-list .wc-panel .cbx:visible:not(:disabled)').nth(1).click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(350);
    const top = await page.locator('#mine-list .cbx:checked').first().evaluate((el) => el.getBoundingClientRect().top + scrollY - innerHeight * 0.62);
    await page.evaluate((y) => scrollTo(0, y), top);
    await page.waitForTimeout(200);
    await shot(page, `mine-${full ? 'full' : 'short'}-${w}`);
    await ctx.close();
  }
  // A client card: open, late, done, "לא רלוונטי", blocked.
  {
    // One item of the card is "לא רלוונטי" from the start, and one is marked here.
    const { page, ctx } = await open('irit', viewport, { mark: (db) => db.protocol_checks.push({ client_id: CARD, item_key: 'p05.vault', state: 'na', note: 'אין ללקוח רשתות', by_email: emailOf('irit'), at: '2026-10-19T10:00:00+03:00' }) });
    await page.waitForSelector('#view-mine:not([hidden])');
    await page.goto(`${BASE}client.html?id=${CARD}`);
    await page.waitForSelector('.item .cbx', { state: 'attached' });
    await settle(page);
    await page.locator('#p04 .item .cbx:visible:not(:disabled)').first().click();
    await page.waitForFunction(() => document.querySelector('#p04 .item.is-done') && !document.querySelector('.is-busy'));
    await page.mouse.move(0, 0);
    const y = await page.evaluate(() => document.querySelector('#p04 .item.is-done').getBoundingClientRect().top + scrollY - 110);
    await page.evaluate((t) => scrollTo(0, t), y);
    await page.waitForTimeout(300);
    await shot(page, `card-${w}`);
    await ctx.close();
  }
}
await browser.close();
console.log(`screenshots: ${OUT}${TAG}-*.png`);
