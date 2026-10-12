// A timeline of one move between screens on the throttled phone of tests/perf-local.mjs
// (docs/ops.md, section 60): when the first frame came, when each request to the
// database left and was answered, and when the page was shown. Prints; no pass/fail.
//      BASE_URL=http://localhost:5401/ node tests/nav-probe.mjs [role] [list|card|mine]
// BFCACHE=1 also prints why the browser did not keep the page whole on "back".
import { chromium } from 'playwright';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from './roles-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const ROLE = process.argv[2] || 'irit';
const WHAT = process.argv[3] || 'card';
const LATENCY = Number(process.env.LATENCY || 150);
const CPU = Number(process.env.CPU || 4);
const CARD = 'c0000000-0000-4000-8000-000000000012';

const browser = await chromium.launch({ channel: process.env.CHANNEL || undefined, ignoreDefaultArgs: ['--disable-back-forward-cache'] });
const fake = makeFake(buildWorld());
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
await ctx.clock.install({ time: NOW });
let t0 = Date.now();
const log = [];
const at = () => String(Date.now() - t0).padStart(5);
await ctx.route(`${SUPA}/**`, async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  const name = `${req.method()} ${u.pathname.replace('/rest/v1/', '')}${u.search.length > 60 ? `${u.search.slice(0, 60)}…` : u.search}`;
  const started = Date.now() - t0;
  await new Promise((done) => { setTimeout(done, LATENCY); });
  await fake.route(route);
  log.push(`${String(started).padStart(5)} → ${at()}  ${name}`);
});
await ctx.addInitScript(() => {
  const doc = Math.random().toString(36).slice(2, 5); // which document says it (a load makes a new one)
  const mark = (what) => console.log(`@@${Date.now()}@[${doc}] ${what}`);
  requestAnimationFrame(() => mark(`first frame (bar ${document.querySelectorAll('#app-side .side-link').length}, boot ${'boot' in document.documentElement.dataset})`));
  mark(`document ${location.pathname.split('/').pop()}${location.hash}`);
  // The root element is not there yet when this runs: watched from the document down.
  let was = null;
  new MutationObserver(() => {
    const root = document.documentElement;
    if (!root) return;
    const now = `${'boot' in root.dataset ? 'building' : 'shown'}${root.dataset.door ? ` door=${root.dataset.door}` : ''}`;
    if (now !== was) { was = now; mark(now); }
  }).observe(document, { attributes: true, subtree: true, childList: true, attributeFilter: ['data-boot', 'data-door'] });
  window.addEventListener('pageshow', (e) => mark(`pageshow persisted=${e.persisted}`));
  document.addEventListener('DOMContentLoaded', () => mark('DOMContentLoaded'));
});
const page = await ctx.newPage();
// The page stamps its own marks (they arrive late and out of order); its clock is the suite's fake one.
let skew = 0;
page.on('console', (m) => { const hit = /^@@(\d+)@(.*)$/.exec(m.text()); if (hit) log.push(`${String(Number(hit[1]) - skew - t0).padStart(5)}          ${hit[2]}`); });
page.on('framenavigated', (f) => log.push(`${at()}          NAVIGATED ${f === page.mainFrame() ? '' : '(frame) '}${f.url().replace(BASE, '')}`));
page.on('pageerror', (e) => log.push(`${at()}          ERROR ${String(e).slice(0, 200)}`));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Page.enable');
if (process.env.BFCACHE) cdp.on('Page.backForwardCacheNotUsed', (e) => { console.log('NOT KEPT:', JSON.stringify(e.notRestoredExplanations.map((x) => `${x.type}:${x.reason}`))); });
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024 / 8) * 2.5, uploadThroughput: (750 * 1024) / 8 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
const content = (min) => page.waitForFunction((n) => { const m = document.querySelector('main'); return m && !('boot' in document.documentElement.dataset) && m.innerText.trim().length > n && !document.querySelector('#lg-email')?.offsetParent; }, min, { timeout: 60000 }).catch(() => {});
const idle = () => page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
const show = (title) => { console.log(`\n== ${title}`); for (const l of log.splice(0).sort()) console.log(l); };

await page.goto(`${BASE}clients.html`, { waitUntil: 'domcontentloaded' });
skew = (await page.evaluate(() => Date.now())) - Date.now();
await page.fill('#lg-email', emailOf(ROLE));
await page.fill('#lg-pass', 'correct-horse');
t0 = Date.now();
await page.click('#lg-submit');
await content(40);
log.push(`${at()}          CONTENT`);
await idle();
// The published site: the worker completes its store after the first page is shown.
for (let i = 0; i < 120; i += 1) {
  const whole = await page.evaluate(async () => {
    if ((await (await fetch('sw.js')).text()).includes('const BUILD = null;')) return true;
    for (const n of await caches.keys()) if (await (await caches.open(n)).match(new URL('__whole__', location.href).href)) return true;
    return false;
  }).catch(() => false);
  if (whole) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(500);
show('sign-in');

if (WHAT === 'mine') {
  await page.goto('about:blank');
  t0 = Date.now();
  await page.goto(`${BASE}clients.html#mine`, { waitUntil: 'commit' });
  await content(40);
  log.push(`${at()}          CONTENT`);
  await idle();
  show('open clients.html#mine');
} else {
  await page.goto('about:blank');
  await page.goto(`${BASE}clients.html#clients`, { waitUntil: 'domcontentloaded' });
  await content(40);
  await idle();
  await page.waitForTimeout(500);
  log.splice(0);
  const row = page.locator(`main a[href*="client.html?id=${WHAT === 'card' ? '' : CARD}"]:visible`).nth(6);
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  t0 = Date.now();
  await row.tap();
  await page.waitForURL(/client\.html/, { waitUntil: 'commit' });
  log.push(`${at()}          COMMIT`);
  await content(200);
  log.push(`${at()}          CONTENT`);
  await idle();
  show('row → card');
  await page.waitForTimeout(500);
  t0 = Date.now();
  await page.goBack({ waitUntil: 'commit' });
  await content(40);
  log.push(`${at()}          CONTENT`);
  await idle();
  await page.waitForTimeout(500);
  show('back');
}
await browser.close();
