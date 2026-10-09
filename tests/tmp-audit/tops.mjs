import { chromium } from 'playwright';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from '../roles-world.mjs';
const browser = await chromium.launch();
for (const base of ['http://localhost:8432/', 'http://localhost:8431/']) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, makeFake(buildWorld()).route);
  const page = await ctx.newPage();
  await page.goto(`${base}clients.html#mine`);
  await page.fill('#lg-email', emailOf(process.argv[2] || 'ilai')); await page.fill('#lg-pass', 'correct-horse'); await page.click('#lg-submit');
  await page.waitForSelector('#view-mine:not([hidden])'); await page.waitForTimeout(1500);
  console.log(base, JSON.stringify(await page.evaluate(() => ['.page-head', '#me-bar', '.tabs', '#land-line', '#view-mine', '#now-bar', '#metricool-card', '#push-card', '#cal-card', '#my-months', '#mine-list', '#il-h', '#mine-list .il-list > li'].map((s) => { const e = document.querySelector(s); const r = e?.getBoundingClientRect(); return [s, r && r.height ? `${Math.round(r.top + scrollY)}+${Math.round(r.height)}` : '-']; }))));
  await ctx.close();
}
await browser.close();
