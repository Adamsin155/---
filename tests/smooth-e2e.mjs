// The feel of an app on a phone, in a real browser against the PUBLISHED site
// (docs/ops.md, section 42). This suite builds the site itself
// (scripts/build-pages.mjs, into a temporary folder) and serves it from a small server
// of its own, because what it checks exists only in the published site: the preloads
// and the service worker's store. BASE_URL is not used. The office is the one of
// tests/roles-world.mjs behind the in-memory fake of Supabase; every answer of the fake
// waits a moment, so what arrives late still arrives late.
//  - a page opens whole: "המשימות שלי" and a client card do not jump (layout shift
//    under 0.1, where they measured 0.2 and 0.5), and no staff page is left waiting;
//  - the second time a screen opens, every file of the site comes from the device; the
//    database's answers never pass through the service worker and none is stored;
//  - a new publish reaches the device: the open page keeps its version, the next page
//    runs the new one, and the open page loads itself again when it goes to the background;
//  - controls answer the finger (no double-tap zoom, no selection), the next page is
//    fetched when the finger lands, and the policy of the pages refuses nothing.
// Run: node tests/smooth-e2e.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, published } from '../scripts/build-pages.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from './roles-world.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'smooth-e2e-'));
const MARK = '// publish two';

// ── Two publishes: the repository as it is, and the same with one script changed ──
const one = join(tmp, 'one');
build(one);
const src2 = join(tmp, 'src2');
for (const e of readdirSync(ROOT, { withFileTypes: true })) if (published(e.name, e.isDirectory())) cpSync(join(ROOT, e.name), join(src2, e.name), { recursive: true });
appendFileSync(join(src2, 'app', 'tz.js'), `\n${MARK}\n`);
const two = join(tmp, 'two');
build(two, { root: src2 });
appendFileSync(join(src2, 'app', 'tz.js'), '\n// publish three\n');
const three = join(tmp, 'three');
build(three, { root: src2 });
const buildOf = (dir) => JSON.parse(/^const BUILD = (\{.*\});$/m.exec(readFileSync(join(dir, 'sw.js'), 'utf8'))[1]);
const V1 = buildOf(one);
const V2 = buildOf(two);
const V3 = buildOf(three);
assert.equal(new Set([V1.version, V2.version, V3.version]).size, 3);

// ── The host: static files, kept by browsers for ten minutes as GitHub Pages says ──
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };
let serving = one;
const server = http.createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(serving, path));
  if (!file.startsWith(serving + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': path === '/sw.js' ? 'max-age=0' : 'max-age=600' });
  res.end(readFileSync(file));
});
await new Promise((ok) => { server.listen(0, '127.0.0.1', ok); });
const BASE = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const LATENCY = 120;
const CARD = 'c0000000-0000-4000-8000-000000000012';
const observe = () => {
  window.__cls = 0;
  window.__updates = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { /* not supported */ }
  try { navigator.serviceWorker?.addEventListener('message', (e) => window.__updates.push(e.data)); } catch { /* no worker */ }
};
async function open(role, viewport = { width: 390, height: 844 }) {
  const fake = makeFake(buildWorld());
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: viewport.width < 700, hasTouch: viewport.width < 700 });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, async (route) => { await new Promise((done) => { setTimeout(done, LATENCY); }); return fake.route(route); });
  await ctx.addInitScript(observe);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  watchCsp(page);
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}clients.html`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await shown(page);
  return { page, ctx, fake };
}
// The page is shown (the wait of mountSession is over) and nothing more is on its way.
const shown = async (page) => {
  await page.waitForFunction(() => !('boot' in document.documentElement.dataset) && !document.getElementById('app')?.hidden, null, { timeout: 20000 });
  await page.waitForLoadState('networkidle').catch(() => {});
};
const fresh = async (page, path) => { await page.goto('about:blank'); await page.goto(`${BASE}${path}`); await shown(page); await page.waitForTimeout(700); };
const cls = (page) => page.evaluate(() => Math.round(window.__cls * 1000) / 1000);
const storeOf = (page, version) => page.evaluate(async (v) => {
  const name = `astrateg-site-${v}`;
  if (!(await caches.has(name))) return null;
  const cache = await caches.open(name);
  return { whole: !!(await cache.match(new URL('__whole__', location.href).href)), keys: (await cache.keys()).map((r) => r.url) };
}, version);
const whole = async (page, version) => {
  for (let i = 0; i < 100; i += 1) {
    if ((await storeOf(page, version))?.whole) return;
    await page.waitForTimeout(200);
  }
  assert.fail(`the store of version ${version} was not completed`);
};

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

try {
  const { page, ctx } = await open('irit');

  await step('a page opens whole: "המשימות שלי" and the client card do not jump', async () => {
    await fresh(page, 'clients.html#mine');
    assert.ok((await page.locator('#mine-list').innerText()).length > 40, 'the list is there');
    const mine = await cls(page);
    assert.ok(mine < 0.1, `"המשימות שלי" shifted by ${mine}`);
    // The placeholder is gone, the bar is in its place, the head and the cards above the list are final.
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('app')).opacity), '1');
    assert.equal(await page.locator('#side-list a.side-link').first().isVisible(), true);
    await fresh(page, `client.html?id=${CARD}`);
    assert.ok((await page.locator('#cc-head').innerText()).includes('חן קוסמטיקה'));
    const card = await cls(page);
    assert.ok(card < 0.1, `the client card shifted by ${card}`);
  });

  await step('while a page is built it is out of sight, with the placeholder and the bar\'s place; a tap cannot land on it', async () => {
    // The answers are held: the page stays in its wait.
    let release;
    const held = new Promise((r) => { release = r; });
    await ctx.route(`${SUPA}/rest/v1/clients*`, async (route) => { await held; return route.fallback(); });
    await page.goto('about:blank');
    await page.goto(`${BASE}clients.html#mine`);
    await page.waitForFunction(() => 'boot' in document.documentElement.dataset && !document.getElementById('app').hidden);
    const during = await page.evaluate(() => {
      const app = getComputedStyle(document.getElementById('app'));
      const main = document.querySelector('main');
      return { opacity: app.opacity, taps: app.pointerEvents, placeholder: getComputedStyle(main, '::before').content, height: main.getBoundingClientRect().height, bar: getComputedStyle(document.body, '::after').position };
    });
    assert.deepEqual([during.opacity, during.taps, during.bar], ['0', 'none', 'fixed']);
    assert.notEqual(during.placeholder, 'none');
    assert.ok(during.height > 300, `the panel is ${during.height}px high while it waits`);
    release();
    await shown(page);
    await ctx.unroute(`${SUPA}/rest/v1/clients*`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body, '::after').content), 'none');
  });

  await step('the second time, every file of the site comes from the device; the database never passes through the worker', async () => {
    await whole(page, V1.version);
    const seen = [];
    const listen = (res) => seen.push({ url: res.url(), sw: res.fromServiceWorker(), method: res.request().method() });
    page.on('response', listen);
    await fresh(page, 'clients.html#mine');
    await fresh(page, `client.html?id=${CARD}`);
    page.off('response', listen);
    const site = seen.filter((r) => r.url.startsWith(BASE) && !r.url.endsWith('/sw.js'));
    const api = seen.filter((r) => r.url.startsWith(SUPA));
    assert.ok(site.length > 150, `${site.length} files of the site`);
    assert.deepEqual(site.filter((r) => !r.sw).map((r) => r.url), [], 'files of the site that went to the network');
    assert.ok(api.length > 40, `${api.length} requests to the database`);
    assert.deepEqual(api.filter((r) => r.sw).map((r) => r.url), [], 'requests to the database that the worker answered');
    // The store: the published files and the mark that it is whole. Nothing else, on any store.
    const store = await storeOf(page, V1.version);
    const expected = [...Object.keys(V1.files).map((p) => new URL(p, BASE).href), `${BASE}__whole__`].sort();
    assert.deepEqual([...store.keys].sort(), expected);
    const all = await page.evaluate(async () => { const out = []; for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(`${n} ${r.url}`); return out; });
    for (const line of all) {
      assert.match(line, /^astrateg-site-[0-9a-f]{16} /, line);
      assert.ok(line.split(' ')[1].startsWith(BASE), line);
      assert.doesNotMatch(line, /supabase\.co|rest\/v1|auth\/v1|storage\/v1|functions\/v1|\?/, line);
    }
    // What a stored page holds is the published file, byte for byte (no name, no row of anyone).
    const kept = await page.evaluate(async (v) => (await (await (await caches.open(`astrateg-site-${v}`)).match(new URL('clients.html', location.href).href)).text()), V1.version);
    assert.equal(kept, readFileSync(join(one, 'clients.html'), 'utf8'));
  });

  await step('controls answer the finger: no double-tap zoom, no selection, their own pressed state; the next page is fetched when the finger lands', async () => {
    await fresh(page, 'clients.html#mine');
    const feel = await page.evaluate(() => {
      const of = (sel) => { const el = document.querySelector(sel); const s = getComputedStyle(el); return [s.touchAction, s.userSelect || s.webkitUserSelect]; };
      return { tab: of('#tab-clients'), bar: of('#side-list a.side-link'), button: of('#btn-refresh'), flash: getComputedStyle(document.documentElement).webkitTapHighlightColor, fit: document.querySelector('meta[name=viewport]').content };
    });
    assert.deepEqual([feel.tab, feel.bar, feel.button], [['manipulation', 'none'], ['manipulation', 'none'], ['manipulation', 'none']]);
    assert.equal(feel.flash, 'rgba(0, 0, 0, 0)');
    assert.match(feel.fit, /viewport-fit=cover/);
    // The bar's link to another screen: its page is asked for on touchstart, once, without the address's own ?… and #….
    const link = page.locator('#side-list a.side-link:not([href*="clients.html"])').first();
    const target = new URL(await link.getAttribute('href'), BASE);
    const asked = [];
    const listen = (req) => { if (req.url().startsWith(`${BASE}${target.pathname.slice(1)}`)) asked.push(req.url()); };
    page.on('request', listen);
    await link.dispatchEvent('touchstart');
    await link.dispatchEvent('touchstart');
    await page.waitForTimeout(400);
    page.off('request', listen);
    assert.deepEqual(asked, [`${BASE}${target.pathname.slice(1)}`]);
  });

  await step('no staff page is left waiting: each one a role opens is shown, from the device', async () => {
    const tours = {
      irit: ['clients.html#clients', 'clients.html#control', 'owner.html#now', 'messages.html', 'prep.html', 'quotes.html', 'index.html', 'landing.html', 'year.html', 'shoot.html', `intake.html?id=${CARD}`, `gantt.html?id=${CARD}`],
      owner: ['owner.html#all', 'decisions.html', 'qa.html', 'pass.html', 'team.html', 'insights.html', `scripts.html?id=c0000000-0000-4000-8000-000000000007`, 'deal.html'],
      nadia: ['editor.html', `client.html?id=${CARD}`, 'clients.html#mine'],
      stav: ['deal.html'],
    };
    for (const [role, pages] of Object.entries(tours)) {
      const who = role === 'irit' ? { page } : await open(role);
      for (const path of pages) {
        await who.page.goto(`${BASE}${path}`);
        await who.page.waitForFunction(() => !('boot' in document.documentElement.dataset), null, { timeout: 15000 }).catch(() => assert.fail(`${role}: ${path} is still waiting`));
        await who.page.waitForLoadState('networkidle').catch(() => {});
        assert.equal(await who.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, `${role}: ${path} scrolls sideways`);
      }
      if (who.ctx) await who.ctx.close();
    }
  });

  await step('a new publish reaches the device: the open page keeps its version, the next page runs the new one, the open page loads itself again in the background', async () => {
    const tz = (p) => p.evaluate(async () => (await (await fetch('app/tz.js')).text()));
    await fresh(page, 'clients.html#mine');
    assert.ok(!(await tz(page)).includes('// publish two'));
    // The office publishes. The page that is open now was opened with version one.
    serving = two;
    const other = await ctx.newPage();
    watchCsp(other);
    other.on('pageerror', (e) => errors.push(`second tab: ${e}`));
    // Opening a page is what makes the browser look at sw.js again; it is answered with version one, whole.
    await other.goto(`${BASE}owner.html#now`);
    await shown(other);
    await whole(other, V2.version);
    // The page that stayed open: still version one for whatever it asks, and told that a newer one is ready.
    await page.waitForFunction(() => window.__updates.some((m) => m?.type === 'astrateg-update'), null, { timeout: 15000 });
    assert.ok(!(await tz(page)).includes('// publish two'), 'the open page still gets the files it opened with');
    // The next page that opens runs version two, from the device.
    const seen = [];
    const listen = (res) => { if (res.url().startsWith(BASE) && !res.url().endsWith('/sw.js')) seen.push({ url: res.url(), sw: res.fromServiceWorker() }); };
    other.on('response', listen);
    await fresh(other, 'clients.html#mine');
    other.off('response', listen);
    assert.ok((await tz(other)).includes('// publish two'));
    assert.deepEqual(seen.filter((r) => !r.sw).map((r) => r.url), []);
    const store = await storeOf(other, V2.version);
    assert.equal(store.keys.length, Object.keys(V2.files).length + 1);
    // The open page goes to the background with nothing typed: it loads itself again, on version two.
    await page.evaluate(() => { window.__before = true; });
    await page.fill('#client-search', 'חן').catch(() => {}); // hidden on this tab: nothing is typed
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => window.__before === undefined && !('boot' in document.documentElement.dataset), null, { timeout: 20000 });
    assert.ok((await tz(page)).includes('// publish two'));
    await other.close();
  });

  await step('something typed, or a dialog open: the page is not loaded again under the person', async () => {
    serving = three; // the office publishes again
    const other = await ctx.newPage();
    await other.goto(`${BASE}owner.html#now`);
    await shown(other);
    await whole(other, V3.version);
    await page.waitForFunction(() => window.__updates.some((m) => m?.type === 'astrateg-update'), null, { timeout: 15000 });
    await page.evaluate(() => { window.__before = true; });
    await page.click('#btn-new');
    await page.fill('#new-name', 'לקוח שמוקלד עכשיו');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => window.__before), true, 'the page was loaded again while a dialog was open');
    assert.equal(await page.inputValue('#new-name'), 'לקוח שמוקלד עכשיו');
    await other.close();
  });

  await step('signing out leaves the device with the site\'s files only', async () => {
    await page.evaluate(() => document.querySelector('dialog[open]')?.close());
    await fresh(page, 'clients.html#mine');
    await page.evaluate(() => document.getElementById('btn-logout').click());
    await page.waitForSelector('#lg-email:visible');
    const left = await page.evaluate(async () => {
      const out = [];
      for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(r.url);
      return { cached: out, session: Object.keys(localStorage).filter((k) => /^sb-.*-auth-token$/.test(k)) };
    });
    assert.deepEqual(left.session, []);
    assert.ok(left.cached.length > 150);
    for (const url of left.cached) assert.ok(url.startsWith(BASE) && !/supabase\.co|\?/.test(url), url);
  });

  assert.deepEqual(errors, []);
  noCspViolations();
  console.log(`\nsmooth e2e: ${passed} steps passed`);
} finally {
  await browser.close();
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
