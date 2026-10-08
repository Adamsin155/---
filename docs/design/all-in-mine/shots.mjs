// The screenshots of docs/ops.md section 46 ("everything that waits for me is on
// המשימות שלי"): the top of "המשימות שלי" of Ofir, Irit, Lior and Ilai on a phone (390px),
// against tests/flow-world.mjs (no real client data), and Ofir's "בקרה ושיוך".
// Run: npx http-server -p 8080 -s -c-1 . &  then  node docs/design/all-in-mine/shots.mjs <before|after>
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake } from '../../../tests/flow-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const TAG = process.argv[2] || 'after';
const OUT = fileURLToPath(new URL('.', import.meta.url));
const PHONE = { width: 390, height: 844 };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600); };
for (const role of ['ofir', 'irit', 'lior', 'ilai']) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, makeFlowFake(flowWorld()).route);
  const page = await ctx.newPage();
  await page.goto(`${BASE}clients.html#mine`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#view-mine:not([hidden])');
  await settle(page);
  // The first screen, and the first screens' worth of the list (the page is long).
  await page.screenshot({ path: `${OUT}${TAG}-mine-${role}-390.png` });
  await page.screenshot({ path: `${OUT}${TAG}-mine-${role}-390-long.png`, clip: { x: 0, y: 0, width: 390, height: 2400 }, fullPage: true });
  if (role === 'ofir') {
    await page.goto(`${BASE}qa.html#assign-h`);
    await page.waitForSelector('#of-page:not([hidden]) #assign-list li');
    await settle(page);
    await page.screenshot({ path: `${OUT}${TAG}-qa-ofir-390.png` });
  }
  await ctx.close();
}
await browser.close();
console.log(`screenshots: ${OUT}${TAG}-*.png`);
