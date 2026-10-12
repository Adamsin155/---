// Scratch: what the first paint of the next page holds (modules held back), per role.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from './roles-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:5402/';
const OUT = process.argv[2] || 'shots';
const ROLES = (process.argv[3] || 'irit').split(',');
const WIDTH = Number(process.env.WIDTH || 390);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const role of ROLES) {
  const fake = makeFake(buildWorld());
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 844 }, deviceScaleFactor: 1, isMobile: WIDTH < 800, hasTouch: WIDTH < 800, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, (route) => fake.route(route));
  let hold = false;
  await ctx.route(/\/app\/[^/]+\.js(\?.*)?$/, async (route) => {
    if (hold && !/(shell-gate|login-gate|frame-guard)\.js/.test(route.request().url())) await new Promise((done) => { setTimeout(done, 2500); });
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('ERROR', role, String(e).slice(0, 200)));
  await page.goto(`${BASE}clients.html`, { waitUntil: 'domcontentloaded' });
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForFunction(() => !('boot' in document.documentElement.dataset) && !document.querySelector('#lg-email')?.offsetParent, null, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${role}-${WIDTH}-0-home.png` });
  const bar = async () => page.evaluate(() => ({
    items: [...document.querySelectorAll('#app-side .side-list > *')].map((a) => `${a.textContent}${a.matches('[aria-current], .is-on') ? '*' : ''}`).join(' | '),
    who: document.querySelector('.topbar .who-name')?.textContent || '', sw: document.querySelector('#profile-switch')?.textContent || '',
    early: document.querySelectorAll('[data-early]').length,
  }));
  for (const [name, url] of [['card', 'client.html?id=c0000000-0000-4000-8000-000000000012'], ['clients', 'clients.html#clients'], ['owner', 'owner.html#now'], ['mine', 'clients.html#mine'], ['prep', 'prep.html']]) {
    hold = true;
    await page.goto('about:blank');
    await page.goto(`${BASE}${url}`, { waitUntil: 'commit' });
    await page.waitForTimeout(700);
    const early = await bar();
    await page.screenshot({ path: `${OUT}/${role}-${WIDTH}-${name}-1-early.png` });
    hold = false;
    await page.waitForFunction(() => !('boot' in document.documentElement.dataset), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(600);
    const late = await bar();
    await page.screenshot({ path: `${OUT}/${role}-${WIDTH}-${name}-2-late.png` });
    console.log(`${role} ${name}: ${early.items === late.items && early.who === late.who && early.sw === late.sw ? 'SAME' : 'DIFFERENT'}\n   early ${JSON.stringify(early)}\n   late  ${JSON.stringify(late)}`);
  }
  await ctx.close();
}
await browser.close();
