// Phone screenshots of single sections for the role review (no assertions):
// the client card's "תיק לקוח" and "סיכום החוזה", the gallery, the scripts page.
// Run: BASE_URL=http://localhost:8099/ node tests/roles-audit-sections.mjs <outDir> [prefix]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { NOW, SUPA, emailOf, buildWorld, makeFake, GALLERY_TOKEN } from './roles-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || '.playwright-mcp/ux-review';
const PREFIX = process.argv[3] || 'before';
mkdirSync(OUT, { recursive: true });
const C12 = 'c0000000-0000-4000-8000-000000000012';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function as(role) {
  const fake = makeFake(buildWorld());
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`${role} error: ${e}`));
  await page.goto(`${BASE}clients.html#mine`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app:not([hidden])');
  return page;
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600); };
const part = async (page, sel, name) => {
  const el = page.locator(sel).first();
  if (!(await el.count())) { console.log(`missing ${sel}`); return; }
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  console.log(`${name}: ${sel} ${Math.round(box.width)}x${Math.round(box.height)}`);
  await el.screenshot({ path: `${OUT}/${PREFIX}-${name}.png` });
};
const hscroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const owner = await as('owner');
await owner.goto(`${BASE}client.html?id=${C12}`);
await settle(owner);
console.log('card ids:', await owner.evaluate(() => [...document.querySelectorAll('main section[id], main div[id], main header[id], main details[id]')].map((e) => e.id).slice(0, 60).join(' ')));
await part(owner, '#cc-head', 'card-head');
await part(owner, '#fl-slot', 'card-files');
await part(owner, '#cs-slot, .cs-box, #contract-summary', 'card-contract');
console.log('card hscroll', await hscroll(owner));
await owner.goto(`${BASE}gallery.html?t=${GALLERY_TOKEN}`);
await settle(owner);
await owner.screenshot({ path: `${OUT}/${PREFIX}-gallery.png`, fullPage: true });
console.log('gallery hscroll', await hscroll(owner), 'h', await owner.evaluate(() => document.documentElement.scrollHeight));
await browser.close();
