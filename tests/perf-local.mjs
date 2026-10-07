// How the app FEELS on a mid-range phone, measured locally (docs/ops.md, section 42):
// the office of tests/roles-world.mjs behind an in-memory fake of Supabase, a 390px
// phone, the CPU slowed 4 times and a fast-4G network (Chrome DevTools throttling).
// Every answer of the fake waits LATENCY ms, as a real database does, so that what
// arrives late still arrives late. Nothing here touches the live site or the project.
// Not a pass/fail suite (tests/smooth-e2e.mjs pins the limits): it prints numbers.
// Per role: an open of "המשימות שלי" and of a client card, twice each (requests, how
// many of them reached the network, JS files, time to content and to idle, long tasks,
// layout shift), and for a tab switch, a block opened in the list, the notifications
// list and a block of the card: the time from the tap to the next paint (the browser's
// own Event Timing, what "did it answer" means) and to the last change of the page.
// "first": the same person on a device that has not kept the site yet (a new browser
// profile with the session only): every file comes from the network.
// Run against the PUBLISHED site (the preloads and the worker's store exist only there),
// served as GitHub Pages serves it (files kept by the browser for ten minutes):
//      node scripts/build-pages.mjs <dir>; npx http-server -p 8098 -s -c600 <dir> &
//      BASE_URL=http://localhost:8098/ node tests/perf-local.mjs [out.json] [role,role]
// The repository as it is (no preloads, the worker keeps nothing) runs the same way:
//      npx http-server -p 8097 -s -c600 . &
// LATENCY (ms per answer of the fake database, 150) and CPU (slowdown, 4): the throttling.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from './roles-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const ONLY = process.argv[3] ? process.argv[3].split(',') : ['irit', 'lior', 'ofir', 'ilai', 'owner', 'nadia'];
const LATENCY = Number(process.env.LATENCY || 150);
const CPU = Number(process.env.CPU || 4);
const CARD = 'c0000000-0000-4000-8000-000000000012';

const observe = () => {
  window.__p = { long: [], cls: 0, shifts: [], events: [] };
  const watch = (type, fn, extra = {}) => { try { new PerformanceObserver((l) => { for (const e of l.getEntries()) fn(e); }).observe({ type, buffered: true, ...extra }); } catch { /* not supported */ } };
  watch('longtask', (e) => window.__p.long.push(Math.round(e.duration)));
  watch('event', (e) => { if (/^(pointerdown|pointerup|touchstart|touchend|mousedown|mouseup|click)$/.test(e.name)) window.__p.events.push(Math.round(e.duration)); }, { durationThreshold: 16 });
  watch('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    window.__p.cls += e.value;
    const name = (n) => (n && n.nodeType === 1 ? `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}${n.className && typeof n.className === 'string' ? `.${n.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}` : '?');
    window.__p.shifts.push({ v: Math.round(e.value * 1000) / 1000, who: (e.sources || []).slice(0, 4).map((s) => name(s.node)) });
  });
};
// Requests are counted from outside the page: the fake clock of the suites replaces `performance`.
const stats = (page) => page.evaluate(() => {
  const long = window.__p?.long || [];
  return {
    longTasks: long.length, longest: Math.max(0, ...long), blocked: long.reduce((n, d) => n + Math.max(0, d - 50), 0),
    cls: Math.round((window.__p?.cls || 0) * 1000) / 1000,
    shifts: (window.__p?.shifts || []).filter((s) => s.v >= 0.01),
  };
});
// A tap: `paint` is the time until the browser drew the answer (the longest Event Timing
// entry of the tap; 0 when under 16 ms), `last` the last change of the page within 1.5 s.
const tap = async (page, locator) => {
  const el = page.locator(locator).first();
  if (!(await el.count()) || !(await el.isVisible().catch(() => false))) return null;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.__p.events = [];
    window.__t = { last: 0, n: 0 };
    window.__mo = new MutationObserver(() => { window.__t.last = performance.now(); window.__t.n += 1; });
    window.__mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    window.__t0 = performance.now();
  });
  await el.tap().catch(() => el.click());
  await page.waitForTimeout(1500);
  return page.evaluate(() => { window.__mo.disconnect(); return { paint: Math.max(0, ...window.__p.events), last: window.__t.n ? Math.max(0, Math.round(window.__t.last - window.__t0)) : -1 }; });
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const out = {};
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' };
// A phone on the throttled network and CPU, and how a page of it is opened and measured.
async function phone(fake, options = {}) {
  const ctx = await browser.newContext({ ...PHONE, ...options });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, async (route) => { await new Promise((done) => { setTimeout(done, LATENCY); }); return fake.route(route); });
  await ctx.addInitScript(observe);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024 / 8) * 2.5, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const errors = [];
  let net = [];
  // From the device: answered by the service worker, or kept by the browser (its ten-minute cache).
  cdp.on('Network.responseReceived', (e) => net.push({ url: e.response.url, sw: !!e.response.fromServiceWorker || !!e.response.fromDiskCache || !!e.response.fromPrefetchCache }));
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  // Content: the page shows its text (a page that is still built out of sight does not count).
  const content = (min) => page.waitForFunction((n) => { const m = document.querySelector('main'); return m && !('boot' in document.documentElement.dataset) && m.innerText.trim().length > n && !document.querySelector('#lg-email')?.offsetParent; }, min, { timeout: 60000 }).catch(() => {});
  const idle = (timeout = 60000) => page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  // toIdle: until the page asks for nothing more (null when the worker is still fetching its store in the background).
  const open = async (url, min, { waitIdle = true } = {}) => {
    await page.goto('about:blank'); // a change of the #part alone would not load the page again
    net = [];
    const t = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await content(min);
    const toContent = Date.now() - t;
    if (waitIdle) await idle(); else await page.waitForTimeout(2500);
    const toIdle = waitIdle ? Date.now() - t - 500 : null; // "networkidle" is 500 ms after the last request
    await page.waitForTimeout(600); // late shifts
    const own = net.filter((q) => q.url.startsWith(BASE));
    const files = (re) => own.filter((q) => re.test(q.url.split(/[?#]/)[0])).length;
    return { toContent, toIdle, requests: net.length, site: own.length, siteNet: own.filter((q) => !q.sw).length, api: net.length - own.length, jsFiles: files(/\.js$/), cssFiles: files(/\.css$/), ...(await stats(page)) };
  };
  return { ctx, page, errors, content, idle, open };
}
for (const role of ONLY) {
  const fake = makeFake(buildWorld());
  const { ctx, page, errors, content, idle, open } = await phone(fake);
  const r = { errors };
  try {
    await page.goto(`${BASE}clients.html`, { waitUntil: 'domcontentloaded' });
    await page.fill('#lg-email', emailOf(role));
    await page.fill('#lg-pass', 'correct-horse');
    await page.click('#lg-submit');
    await content(40);
    await idle();
    // The published site: the worker completes its store after the first page is shown.
    for (let i = 0; i < 120; i += 1) {
      const whole = await page.evaluate(async () => {
        if ((await (await fetch('sw.js')).text()).includes('const BUILD = null;')) return true;
        for (const n of await caches.keys()) if (await (await caches.open(n)).match(new URL('__whole__', location.href).href)) return true;
        return false;
      }).catch(() => false); // the page was moving to its first screen: asked again
      if (whole) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(500);
    r.landed = await page.evaluate(() => `${location.pathname.split('/').pop()}${location.hash}`);
    // "המשימות שלי", as when the app icon is tapped, twice.
    r.mine = await open(`${BASE}clients.html#mine`, 40);
    r.mineAgain = await open(`${BASE}clients.html#mine`, 40);
    r.taps = {};
    r.taps.tab2 = await tap(page, '.tabs [role="tab"]:not([hidden]):nth-child(2)');
    r.taps.tab1 = await tap(page, '.tabs [role="tab"]:not([hidden]):nth-child(1)');
    r.taps.expand = await tap(page, 'main details:not([open]) > summary, main button[aria-expanded="false"]');
    r.taps.inbox = await tap(page, '#btn-inbox');
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => document.querySelector('dialog[open]')?.close());
    // The bottom bar: a move to another screen.
    const bar = page.locator('#side-list a.side-link:not([href*="clients.html"])').first();
    if (await bar.count() && await bar.isVisible().catch(() => false)) {
      const t = Date.now();
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}), bar.tap().catch(() => bar.click())]);
      await content(40);
      r.barNav = { to: await page.evaluate(() => `${location.pathname.split('/').pop()}${location.hash}`), toContent: Date.now() - t };
      await idle();
    }
    // A client card.
    r.card = await open(`${BASE}client.html?id=${CARD}`, 200);
    r.cardAgain = await open(`${BASE}client.html?id=${CARD}`, 200);
    r.taps.cardItems = await tap(page, 'main button[id$="-items"][aria-expanded="false"]');
    r.taps.cardPhase = await tap(page, 'main details.phase:not([open]) > summary');
    r.taps.cardExpand = await tap(page, 'main details:not([open]) > summary, main button[aria-expanded="false"]');
    // A device that has not kept the site yet: the session only.
    const first = await phone(fake, { storageState: await ctx.storageState() });
    r.firstMine = await first.open(`${BASE}clients.html#mine`, 40, { waitIdle: false });
    await first.ctx.close();
    const firstCard = await phone(fake, { storageState: await ctx.storageState() });
    r.firstCard = await firstCard.open(`${BASE}client.html?id=${CARD}`, 200, { waitIdle: false });
    await firstCard.ctx.close();
  } catch (e) { r.error = String(e).slice(0, 300); }
  out[role] = r;
  await ctx.close();
  const line = (s) => (s ? `req ${s.requests} (site ${s.site}, of them from the network ${s.siteNet}; js ${s.jsFiles}, css ${s.cssFiles}; api ${s.api}) content ${s.toContent} idle ${s.toIdle ?? '-'} long ${s.longTasks}/${s.longest}ms blocked ${s.blocked} CLS ${s.cls}` : '-');
  const t = (x) => (x ? `${x.paint}/${x.last}` : '-');
  console.log(`\n${role} (landed ${r.landed})${r.error ? ` ERROR ${r.error}` : ''}${r.errors.length ? ` pageerrors ${r.errors.length}: ${r.errors[0]}` : ''}`);
  console.log(`  mine        ${line(r.mine)}`);
  console.log(`  mine again  ${line(r.mineAgain)}`);
  console.log(`  card        ${line(r.card)}`);
  console.log(`  card again  ${line(r.cardAgain)}`);
  console.log(`  first mine  ${line(r.firstMine)}`);
  console.log(`  first card  ${line(r.firstCard)}`);
  console.log(`  taps paint/last ms: tab2 ${t(r.taps?.tab2)} tab1 ${t(r.taps?.tab1)} expand ${t(r.taps?.expand)} inbox ${t(r.taps?.inbox)} cardItems ${t(r.taps?.cardItems)} cardPhase ${t(r.taps?.cardPhase)} cardExpand ${t(r.taps?.cardExpand)} barNav ${r.barNav ? `${r.barNav.to} ${r.barNav.toContent}` : '-'}`);
  for (const [k, s] of [['mine', r.mine], ['card', r.card]]) for (const sh of (s?.shifts || []).slice(0, 8)) console.log(`    shift ${k} ${sh.v} ${sh.who.join(', ')}`);
}
await browser.close();
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
