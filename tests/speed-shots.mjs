// Screens of the three slow pages (docs/ops.md, section 77), for comparing a site before and
// after a change that must not change them: the owner signed in, the office of
// tests/perf-pages.mjs (the big world, MARKS marks, LOG rows of history), at 390 and 1280,
// whole pages. Two runs (the old site and the new) and a byte comparison of the pictures:
//      BASE_URL=http://localhost:8396/ node tests/speed-shots.mjs <dir>/before
//      BASE_URL=http://localhost:8395/ node tests/speed-shots.mjs <dir>/after
//      node tests/speed-shots.mjs --compare <dir>/before <dir>/after
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { NOW, SUPA, emailOf, makeFake } from './roles-world.mjs';
import { buildBigWorld } from './perf-world.mjs';

if (process.argv[2] === '--compare') {
  const [a, b] = process.argv.slice(3);
  let same = 0;
  for (const f of readdirSync(a).filter((x) => x.endsWith('.png'))) {
    const eq = readFileSync(`${a}/${f}`).equals(readFileSync(`${b}/${f}`));
    same += eq ? 1 : 0;
    console.log(`${eq ? 'same     ' : 'DIFFERENT'} ${f}`);
  }
  process.exit(0);
}

const BASE = process.env.BASE_URL || 'http://localhost:8395/';
const OUT = process.argv[2] || 'shots';
const ROLE = process.env.ROLE || 'owner';
const MARKS = Number(process.env.MARKS || 6500);
const LOG = Number(process.env.LOG || 4500);
const PAGES = [['pass', 'pass.html'], ['owner-all', 'owner.html#all'], ['mine', 'clients.html#mine']];
mkdirSync(OUT, { recursive: true });

function liveSized() {
  const w = buildBigWorld();
  const ids = w.clients.map((c) => c.id);
  const iso = (ms) => `${new Date(ms).toISOString().slice(0, 19)}+00:00`;
  for (let i = 0; w.protocol_checks.length < MARKS; i += 1) {
    w.protocol_checks.push({ client_id: ids[i % ids.length], item_key: `zz.fill.${i}`, state: i % 9 ? 'done' : 'na', note: i % 4 ? 'ייבוא' : null, by_email: emailOf('irit'), at: iso(NOW.getTime() - (i % 50) * 864e5) });
  }
  let id = w.protocol_log.length + 1;
  for (let i = 0; i < LOG; i += 1) {
    w.protocol_log.push({ id: id++, client_id: ids[i % ids.length], item_key: `zz.fill.${i % 900}`, action: i % 7 ? 'done' : 'clear', note: null, by_email: emailOf('lior'), at: iso(NOW.getTime() - 5 * 864e5 - (i % 55) * 864e5 - i * 1000) });
  }
  return w;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h] of [[390, 844], [1280, 900]]) {
  const fake = makeFake(liveSized());
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500, locale: 'he-IL', timezoneId: 'Asia/Jerusalem', reducedMotion: 'reduce' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, (route) => fake.route(route));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}clients.html`, { waitUntil: 'domcontentloaded' });
  await page.fill('#lg-email', emailOf(ROLE));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForLoadState('networkidle');
  for (const [name, url] of PAGES) {
    await page.goto('about:blank');
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => { const m = document.querySelector('main'); return m && !('boot' in document.documentElement.dataset) && m.innerText.trim().length > 40; }, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
    console.log(`${OUT}/${name}-${w}.png`);
  }
  if (errors.length) console.log('errors:', errors);
  await ctx.close();
}
await browser.close();
