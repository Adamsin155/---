// Two builds side by side, alternating, so that a noisy machine weighs on both alike
// (docs/ops.md, section 102). The owner on a phone (390px, CPU slowed CPU times, every answer of
// the fake database LATENCY ms later; tests/perf-world.mjs at CLIENTS clients):
//   page    from owner.html, the bar's "לקוחות" (a full page load in the same tab, its memory fresh)
//   reopen  clients.html#clients in a new tab (the app opened again: the tab's memory is empty)
// For each: the wall time until the list has rows, and the main thread's own time meanwhile
// (Chrome's TaskDuration, which a busy machine disturbs less). Medians of RUNS.
//      BASE_A=http://localhost:8098/ BASE_B=http://localhost:8099/ CLIENTS=91 node tests/perf-compare.mjs [runs]
import { chromium } from 'playwright';
import { NOW, SUPA, emailOf, makeFake } from './roles-world.mjs';
import { buildBigWorld } from './perf-world.mjs';

const BASES = { A: process.env.BASE_A || 'http://localhost:8098/', B: process.env.BASE_B || 'http://localhost:8099/' };
const RUNS = Number(process.argv[2] || 5);
const LATENCY = Number(process.env.LATENCY || 150);
const CPU = Number(process.env.CPU || 4);
const ROLE = process.env.ROLE || 'owner';
const ROWS = 'main a[href*="client.html?id="]';
const browser = await chromium.launch();
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' };

async function signedIn(base) {
  const fake = makeFake(buildBigWorld());
  const ctx = await browser.newContext(PHONE);
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, async (route) => { await new Promise((done) => { setTimeout(done, LATENCY); }); return fake.route(route); });
  const page = await ctx.newPage();
  await page.goto(`${base}clients.html`, { waitUntil: 'domcontentloaded' });
  await page.fill('#lg-email', emailOf(ROLE));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 120; i += 1) {
    const whole = await page.evaluate(async () => {
      if ((await (await fetch('sw.js')).text()).includes('const BUILD = null;')) return true;
      for (const n of await caches.keys()) if (await (await caches.open(n)).match(new URL('__whole__', location.href).href)) return true;
      return false;
    }).catch(() => false);
    if (whole) break;
    await page.waitForTimeout(500);
  }
  return { ctx, page };
}
async function tuned(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  return cdp;
}
const task = async (cdp) => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value * 1000;
const rows = (page) => page.waitForFunction((sel) => document.querySelectorAll(sel).length > 5, ROWS, { timeout: 60000, polling: 50 }).catch(() => null);

const results = { A: { page: [], reopen: [] }, B: { page: [], reopen: [] } };
for (let run = 0; run < RUNS; run += 1) {
  for (const key of ['A', 'B']) {
    const base = BASES[key];
    const { ctx, page } = await signedIn(base);
    // page: owner.html, then the bar's "לקוחות"; the memory was filled by a visit a minute before.
    const cdp = await tuned(ctx, page);
    await page.goto(`${base}clients.html#clients`, { waitUntil: 'domcontentloaded' });
    await rows(page);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800); // the squeezed answers are kept a moment after they arrive
    await ctx.clock.fastForward(60000);
    await page.goto(`${base}owner.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    const link = page.locator('#side-list a.side-link[href*="clients.html#clients"]').first();
    let t = Date.now();
    await Promise.all([page.waitForURL(/clients\.html#clients/, { waitUntil: 'commit', timeout: 30000 }).catch(() => {}), link.tap().catch(() => link.click())]);
    const cdp2 = await tuned(ctx, page).catch(() => cdp);
    const t0 = await task(cdp2).catch(() => 0);
    await rows(page);
    results[key].page.push({ wall: Date.now() - t, cpu: Math.round((await task(cdp2).catch(() => 0)) - t0) });
    // reopen: a new tab.
    const p2 = await ctx.newPage();
    const c2 = await tuned(ctx, p2);
    t = Date.now();
    await p2.goto(`${base}clients.html#clients`, { waitUntil: 'commit' });
    await rows(p2);
    results[key].reopen.push({ wall: Date.now() - t, cpu: Math.round(await task(c2)) });
    await ctx.close();
  }
  process.stdout.write(`run ${run + 1} done\n`);
}
await browser.close();
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
for (const key of ['A', 'B']) {
  for (const step of ['page', 'reopen']) {
    const r = results[key][step];
    console.log(`${key} ${BASES[key]} ${step.padEnd(6)} wall median ${med(r.map((x) => x.wall))} [${r.map((x) => x.wall).join(' ')}]  main-thread median ${med(r.map((x) => x.cpu))} [${r.map((x) => x.cpu).join(' ')}]`);
  }
}
