// Screenshots of the client card per role, on the phone and on the desktop, from the
// late world's fixtures (invented names): the review of 20.10.2026 ("הצעד הבא שלך", the
// closed rows, the waiting rows in one line). Also prints the card's height per role.
// Run: npx http-server -p 8080 -s -c-1 . &  then  BASE_URL=http://localhost:8080/ node tests/card-shots.mjs <out dir> [role]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { NOW, SUPA, emailOf, lateWorld, makeFlowFake, cid } from './late-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2];
const ONLY = process.argv[3] || null;
if (!OUT) { console.error('usage: node tests/card-shots.mjs <out dir> [role]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const SIZES = { 390: { width: 390, height: 844 }, 1366: { width: 1366, height: 900 } };
const CARDS = { owner: [12], irit: [12, 4], lior: [7, 12], ofir: [12], ilai: [17], nadia: [12], eli: [7] };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
for (const [role, ids] of Object.entries(CARDS)) {
  if (ONLY && role !== ONLY) continue;
  for (const n of ids) {
    for (const w of [390, 1366]) {
      const phone = w < 600;
      const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: SIZES[w], isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, reducedMotion: 'reduce' });
      await ctx.clock.install({ time: NOW });
      const fake = makeFlowFake(lateWorld());
      await ctx.route(`${SUPA}/**`, fake.route);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${role} ${n} ${w}: ${e.message}`));
      await page.goto(`${BASE}client.html?id=${cid(n)}`);
      await page.fill('#lg-email', emailOf(role));
      await page.fill('#lg-pass', 'correct-horse');
      await page.click('#lg-submit');
      await page.waitForSelector('#phases .phase', { timeout: 30000 }).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(700);
      const info = await page.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        phasesTop: Math.round(document.getElementById('phases')?.getBoundingClientRect().top + scrollY),
        nextTop: document.getElementById('my-next')?.hidden ? null : Math.round(document.getElementById('my-next')?.getBoundingClientRect().top + scrollY),
        wide: document.documentElement.scrollWidth > innerWidth + 1,
      }));
      console.log(`${role} c${n} ${w}: height ${info.height}, my-next at ${info.nextTop}, protocol at ${info.phasesTop}${info.wide ? ' · SIDEWAYS SCROLL' : ''}`);
      await page.screenshot({ path: `${OUT}/${role}-c${n}-${w}.png`, fullPage: true });
      // The page in slices one can read (a full phone page is too tall to look at whole).
      const step = phone ? 1300 : 1100;
      for (let y = 0, i = 1; y < info.height; y += step, i += 1) {
        await page.screenshot({ path: `${OUT}/${role}-c${n}-${w}-s${i}.png`, fullPage: true, clip: { x: 0, y, width: SIZES[w].width, height: Math.min(step, info.height - y) } });
      }
      await ctx.close();
    }
  }
}
await browser.close();
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
