// Screenshots of the client and owner screens for docs/design/kit-client (docs/ops.md,
// section 53), from the suites' fixtures (invented names; no real client data).
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/kit-client-shots.mjs before|after [staff]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { NOW, SUPA, emailOf, lateWorld, makeFlowFake, cid } from './late-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const STAGE = process.argv[2] || 'after';
const ONLY = process.argv[3] || null;
const OUT = new URL('../docs/design/kit-client/', import.meta.url);
const SIZES = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 900 } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const file = (name, w) => fileURLToPath(new URL(`${STAGE}-${name}-${w}.png`, OUT));
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500); };

async function staff(role, path, width, db = lateWorld()) {
  const fake = makeFlowFake(db);
  const phone = width < 600;
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: SIZES[width], isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  ! ${role} ${path}: ${e}`));
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await settle(page);
  return { page, ctx };
}
const full = async (page, name, w) => { await page.screenshot({ path: file(name, w), fullPage: true }); console.log(`  ${STAGE}-${name}-${w}.png`); };
// One part of a page, at most `max` pixels of its height (a long list is cut, not shrunk).
const part = async (page, sel, name, w, max = 1500) => {
  const l = page.locator(sel).first();
  if (!(await l.count()) || !(await l.isVisible())) { console.log(`  (no ${sel} for ${name})`); return; }
  await l.scrollIntoViewIfNeeded();
  const box = await l.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; });
  if (!box.width || !box.height) { console.log(`  (empty ${sel} for ${name})`); return; }
  await page.screenshot({ path: file(name, w), fullPage: true, clip: { ...box, height: Math.min(box.height, max) } });
  console.log(`  ${STAGE}-${name}-${w}.png`);
};

const SHOTS = {
  async card() {
    for (const w of [390, 1280]) {
      const { page, ctx } = await staff('irit', `client.html?id=${cid(4)}`, w);
      await page.waitForSelector('#fl-slot .fl-block').catch(() => {});
      await settle(page);
      await part(page, '#st-slot', 'card-status', w);
      await part(page, '#fl-slot', 'card-files', w);
      await part(page, '#access', 'card-access', w);
      await part(page, '#tasks', 'card-tasks', w);
      await part(page, '#cc-head', 'card-head', w);
      await part(page, '#ik-slot', 'card-intake', w);
      await part(page, '#qa-block', 'card-qa', w);
      await part(page, '#phases', 'card-phases', w, 1300);
      await part(page, '#mc-slot', 'card-month', w);
      await part(page, '#tl-slot', 'card-timeline', w, 900);
      await part(page, '#history', 'card-history', w, 700);
      await page.evaluate(() => scrollTo(0, 0));
      if (await page.locator('#cc-head button:has-text("עריכת פרטים"), #cc-head button:has-text("עריכה")').count()) { await page.locator('#cc-head button:has-text("עריכת פרטים"), #cc-head button:has-text("עריכה")').first().click(); await page.waitForTimeout(300); await page.screenshot({ path: file('card-dlg-edit', w) }); console.log(`  ${STAGE}-card-dlg-edit-${w}.png`); await page.keyboard.press('Escape'); }
      await ctx.close();
    }
    for (const role of ['owner', 'nadia']) {
      const { page, ctx } = await staff(role, `client.html?id=${cid(12)}`, 390);
      await page.waitForSelector('#fl-slot .fl-block').catch(() => {});
      await settle(page);
      await page.screenshot({ path: file(`card-${role}`, 390) });
      await part(page, '#phases', `card-${role}-phases`, 390, 1300);
      await ctx.close();
    }
  },
  async owner() {
    for (const w of [390, 1280]) {
      const { page, ctx } = await staff('owner', 'owner.html', w);
      await full(page, 'owner', w);
      for (const tab of await page.locator('[role=tab]').all()) {
        if (!(await tab.isVisible())) continue;
        const id = (await tab.getAttribute('id')) || (await tab.innerText()).trim();
        await tab.click(); await settle(page);
        await full(page, `owner-${id.replace(/[^a-z0-9-]/gi, '')}`, w);
      }
      await ctx.close();
    }
  },
};
for (const [name, run] of Object.entries(SHOTS)) {
  if (ONLY && ONLY !== name) continue;
  console.log(name);
  await run();
}
await browser.close();
