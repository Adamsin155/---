// The screenshots of docs/ops.md section 50 (the "באיחור" tab, the solid counted lines,
// the shared kit, and the two fixes on "לפני יום צילום"), against tests/late-world.mjs
// (an invented office: no real client data), at 390px and 1280px.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node docs/design/late-tab/shots.mjs <before|after>
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { NOW, SUPA, emailOf, lateWorld, makeFlowFake, cid } from '../../../tests/late-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const TAG = process.argv[2] || 'after';
const OUT = fileURLToPath(new URL('.', import.meta.url));
const SIZES = [[390, { width: 390, height: 844 }, true], [1280, { width: 1280, height: 900 }, false]];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600); };
async function open(role, w, viewport, phone, path, ready) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, makeFlowFake(lateWorld()).route);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector(ready);
  await settle(page);
  return { ctx, page };
}
const shot = (page, name, w, more = {}) => page.screenshot({ path: `${OUT}${TAG}-${name}-${w}.png`, ...more });
const long = (page, name, w, height = 2200) => page.screenshot({ path: `${OUT}${TAG}-${name}-${w}-long.png`, clip: { x: 0, y: 0, width: w, height }, fullPage: true });
// One element with a little air around it, wherever it is on the page.
async function around(page, sel, name, w, pad = 12) {
  const el = page.locator(sel).first();
  if (!(await el.count())) return false;
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const b = await el.boundingBox();
  if (!b) return false;
  const y = await page.evaluate(() => scrollY);
  await page.screenshot({ path: `${OUT}${TAG}-${name}-${w}.png`, fullPage: true, clip: { x: 0, y: Math.max(0, b.y + y - pad), width: w, height: Math.min(b.height + pad * 2, 2400) } });
  return true;
}

for (const [w, viewport, phone] of SIZES) {
  // "המשימות שלי" of four roles: the tab row, the counted lines, the cards.
  for (const role of ['irit', 'ofir', 'ilai', 'nadia', 'lior']) {
    const { ctx, page } = await open(role, w, viewport, phone, 'clients.html#mine', '#view-mine:not([hidden])');
    await shot(page, `mine-${role}`, w);
    await long(page, `mine-${role}`, w);
    // The counted lines by themselves: the one with a clock, and the ones of clients in landing.
    if (role === 'ofir' || role === 'irit') await around(page, '#land-line', `lines-landing-${role}`, w);
    if (role === 'irit' || role === 'lior') await around(page, '#mine-list .flow-card', `line-clock-${role}`, w);
    // The opened "באיחור" tab (after only).
    if (await page.locator('#tab-late:not([hidden])').count()) {
      await page.click('#tab-late');
      await settle(page);
      await page.evaluate(() => scrollTo(0, 0));
      await shot(page, `late-${role}`, w);
      await long(page, `late-${role}`, w, 1800);
    }
    await ctx.close();
  }
  // "לפני יום צילום": the approvals row, and "שמירת המועד" with no date.
  {
    const { ctx, page } = await open('irit', w, viewport, phone, 'prep.html', '#pp-shoots .pp-card');
    await around(page, '#pp-shoots .pp-card:has(.pp-form)', 'prep-chips', w);
    const save = page.locator('#pp-shoots [id^="sh-save-"]').first();
    if (await save.count()) {
      await page.locator('#pp-shoots [id^="sh-at-"]').first().fill('');
      await save.click();
      await page.waitForTimeout(500);
      await around(page, '#pp-shoots .pp-card:has(.pp-form)', 'prep-empty-date', w);
      await shot(page, 'prep-empty-date-screen', w);
    }
    await ctx.close();
  }
  // The shoot-date dialog on "המשימות שלי" (the same approvals as chips).
  {
    const { ctx, page } = await open('irit', w, viewport, phone, 'clients.html#mine', '#view-mine:not([hidden])');
    const b = page.locator('#mine-list [data-need*="shoot_at"] button').first();
    if (await b.count()) {
      await b.evaluate((el) => el.click());
      await page.waitForSelector('#dlg-shoot[open]');
      await settle(page);
      await shot(page, 'dlg-shoot', w);
    }
    await ctx.close();
  }
  // The client card: "דף המצב ללקוח" and "תיק לקוח" (they must look the same before and after).
  {
    const { ctx, page } = await open('irit', w, viewport, phone, `client.html?id=${cid(4)}`, '#fl-slot .fl-block');
    await around(page, '#st-slot', 'card-status', w);
    await around(page, '#fl-slot', 'card-files', w);
    await ctx.close();
  }
}
await browser.close();
console.log(`screenshots: ${OUT}${TAG}-*.png`);
