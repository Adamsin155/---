// The owner's complaint of 5.11.2026: "the app gets a bit stuck when I tap לקוחות, or just when I
// come in". Measured locally (docs/ops.md, section 102), as tests/perf-local.mjs does: the office of
// tests/perf-world.mjs (WORLD=big) behind the in-memory fake of Supabase, a 390px phone, the CPU
// slowed CPU times (4) and fast 4G; every answer of the fake waits LATENCY ms (150).
// Steps, as the owner (or ROLE):
//   tap      on another screen, the bottom bar's "לקוחות": from the finger until the list has rows;
//   again    the same a minute later (what the tab remembers is fresh);
//   stale    the same 11 minutes later (what the tab remembers is too old to be shown);
//   page     from another page (owner.html), a full page load in the same tab, the memory fresh; pageOld: 11 minutes on;
//   reopen   a new tab of the same device (the app was closed: the tab's memory is empty, the
//            worker still keeps the site's files): clients.html#clients until the list has rows;
//   resume   the tab hidden for 70 minutes (the session's token expired), shown again: until the
//            list is drawn again from the server.
// Each: ms to rows, requests (site files / of them from the network / database), long tasks.
// Run against the built site:  node scripts/build-pages.mjs <dir>; npx http-server -p 8098 -s -c600 <dir> &
//                              BASE_URL=http://localhost:8098/ WORLD=big node tests/perf-tap.mjs [runs]
import { chromium } from 'playwright';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from './roles-world.mjs';
import { buildBigWorld } from './perf-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8098/';
const ROLE = process.env.ROLE || 'owner';
const RUNS = Number(process.argv[2] || 3);
const LATENCY = Number(process.env.LATENCY || 150);
const CPU = Number(process.env.CPU || 4);

const observe = () => {
  window.__long = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch { /* none */ }
};
const browser = await chromium.launch();
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' };
const ROWS = 'main a[href*="client.html?id="]';

async function tune(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024 / 8) * 2.5, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const net = [];
  cdp.on('Network.responseReceived', (e) => net.push({ url: e.response.url, kept: !!e.response.fromServiceWorker || !!e.response.fromDiskCache || !!e.response.fromPrefetchCache }));
  return { cdp, net };
}
const count = (net) => {
  const site = net.filter((q) => q.url.startsWith(BASE));
  return { requests: net.length, site: site.length, siteNet: site.filter((q) => !q.kept).length, db: net.length - site.length, js: site.filter((q) => /\.js(\?|$)/.test(q.url)).length };
};
const longOf = (page) => page.evaluate(() => { const l = window.__long || []; return { longest: Math.max(0, ...l), blocked: l.reduce((n, d) => n + Math.max(0, d - 50), 0), n: l.length }; }).catch(() => ({}));
const rows = (page, min = 5) => page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n && !('stale' in document.documentElement.dataset), [ROWS, min], { timeout: 60000 }).catch(() => 'timeout');
const rowsShown = (page, min = 5) => page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n, [ROWS, min], { timeout: 60000 }).catch(() => 'timeout');

const all = [];
for (let run = 0; run < RUNS; run += 1) {
  const fake = makeFake(process.env.WORLD === 'big' ? buildBigWorld() : buildWorld());
  const ctx = await browser.newContext(PHONE);
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, async (route) => { await new Promise((done) => { setTimeout(done, LATENCY); }); return fake.route(route); });
  await ctx.addInitScript(observe);
  const page = await ctx.newPage();
  const { net } = await tune(ctx, page);
  const r = {};
  await page.goto(`${BASE}clients.html`, { waitUntil: 'domcontentloaded' });
  await page.fill('#lg-email', emailOf(ROLE));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  // The published site: wait for the worker to keep the whole site, as a phone that used the app has it.
  for (let i = 0; i < 120; i += 1) {
    const whole = await page.evaluate(async () => {
      if ((await (await fetch('sw.js')).text()).includes('const BUILD = null;')) return true;
      for (const n of await caches.keys()) if (await (await caches.open(n)).match(new URL('__whole__', location.href).href)) return true;
      return false;
    }).catch(() => false);
    if (whole) break;
    await page.waitForTimeout(500);
  }
  // From another screen of the bar, the tap on "לקוחות".
  const tapClients = async (from) => {
    await page.goto(from, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(300);
    net.length = 0;
    const link = page.locator('#side-list a.side-link[href*="clients.html#clients"]').first();
    const t = Date.now();
    await Promise.all([page.waitForURL(/clients\.html#clients/, { waitUntil: 'commit', timeout: 30000 }).catch(() => {}), link.tap().catch(() => link.click())]);
    const shown = await rowsShown(page);
    const tShown = Date.now() - t;
    const done = await rows(page);
    const tDone = Date.now() - t;
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    return { shown: shown === 'timeout' ? -1 : tShown, usable: done === 'timeout' ? -1 : tDone, ...count(net), ...(await longOf(page)) };
  };
  const FROM = `${BASE}clients.html#mine`;
  r.tap = await tapClients(FROM);
  await ctx.clock.fastForward(60000);
  r.again = await tapClients(FROM);
  await ctx.clock.fastForward(11 * 60000);
  r.stale = await tapClients(FROM);
  // From another page of the app (a full page load in the same tab): first with the tab's memory fresh, then too old.
  await tapClients(FROM);
  r.page = await tapClients(BASE + "owner.html");
  await ctx.clock.fastForward(11 * 60000);
  r.pageOld = await tapClients(BASE + "owner.html");
  // A new tab: the app closed and opened again.
  {
    const p2 = await ctx.newPage();
    const t2 = await tune(ctx, p2);
    const t = Date.now();
    await p2.goto(`${BASE}clients.html#clients`, { waitUntil: 'commit' });
    const shown = await rowsShown(p2);
    const tShown = Date.now() - t;
    await rows(p2);
    const tDone = Date.now() - t;
    await p2.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    r.reopen = { shown: shown === 'timeout' ? -1 : tShown, usable: tDone, ...count(t2.net), ...(await longOf(p2)) };
    await p2.close();
  }
  // Back from the background after 70 minutes (the token expired on the way).
  {
    await page.goto(`${BASE}clients.html#clients`, { waitUntil: 'domcontentloaded' });
    await rows(page);
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await ctx.clock.fastForward(70 * 60000);
    await page.evaluate(() => { window.__long = []; });
    net.length = 0;
    const t = Date.now();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    r.resume = { settled: Date.now() - t - 500, ...count(net), ...(await longOf(page)) };
  }
  all.push(r);
  await ctx.close();
  const line = (s) => (s ? `${s.shown !== undefined ? `shown ${s.shown} usable ${s.usable}` : `settled ${s.settled}`} | req ${s.requests} (site ${s.site}, net ${s.siteNet}, js ${s.js}; db ${s.db}) | long ${s.n}/${s.longest}ms blocked ${s.blocked}` : '-');
  console.log(`run ${run + 1} (${ROLE})`);
  for (const k of ['tap', 'again', 'stale', 'page', 'pageOld', 'reopen', 'resume']) console.log(`  ${k.padEnd(7)} ${line(r[k])}`);
}
await browser.close();
