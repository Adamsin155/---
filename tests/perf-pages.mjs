// The three slow pages of the owner (docs/ops.md, section 77): "מעבר על הלקוחות"
// (pass.html), "כל הלקוחות במבט" (owner.html#all) and "המשימות שלי" (clients.html#mine),
// opened by a signed-in person on a phone (390px), against the in-memory fake of Supabase
// (tests/roles-world.mjs) filled to the size of the live office: the big world of
// tests/perf-world.mjs, and as many marks and as much history as the live database holds
// (MARKS marks in all, LOG rows of history over the last 60 days; filler keys that no
// process reads, so the screens stay those of the big world). Every answer waits LATENCY ms
// and then as long as its size takes at KBPS kilobytes a second: a page of a thousand rows
// costs what it costs live. Prints, per page, the requests to the database, the rows they
// carried, the time to the content and to network idle. Not a suite: it decides nothing.
//      npx http-server -p 8395 -s -c-1 . &
//      BASE_URL=http://localhost:8395/ node tests/perf-pages.mjs [role] [out.json]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { NOW, SUPA, emailOf, makeFake } from './roles-world.mjs';
import { buildBigWorld } from './perf-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8395/';
const ROLE = process.argv[2] || 'owner';
const OUT = process.argv[3] || null;
const LATENCY = Number(process.env.LATENCY || 150);
const KBPS = Number(process.env.KBPS || 1500);
const MARKS = Number(process.env.MARKS || 6500);
const LOG = Number(process.env.LOG || 4500);
const ROUNDS = Number(process.env.ROUNDS || 3);
const PAGES = (process.env.PAGES || 'pass.html,owner.html#all,clients.html#mine').split(',');

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
const fake = makeFake(liveSized());
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
await ctx.clock.install({ time: NOW });
let log = [];
await ctx.route(`${SUPA}/**`, async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  const entry = { what: `${req.method()} ${u.pathname.replace('/rest/v1/', '')}${u.searchParams.get('offset') ? `@${u.searchParams.get('offset')}` : ''}`, rows: null, bytes: 0 };
  if (req.method() !== 'OPTIONS') log.push(entry);
  const slow = {
    request: () => req,
    fallback: (...a) => route.fallback(...a), continue: (...a) => route.continue(...a), abort: (...a) => route.abort(...a),
    fulfill: async (o = {}) => {
      const body = o.body ?? (o.json !== undefined ? JSON.stringify(o.json) : '');
      entry.bytes = Buffer.byteLength(String(body || ''));
      try { const v = JSON.parse(body); entry.rows = Array.isArray(v) ? v.length : 1; } catch { /* not json */ }
      await new Promise((done) => { setTimeout(done, LATENCY + entry.bytes / KBPS); });
      return route.fulfill(o);
    },
  };
  return fake.route(slow);
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
const content = () => page.waitForFunction(() => { const m = document.querySelector('main'); return m && !('boot' in document.documentElement.dataset) && m.innerText.trim().length > 40 && !document.querySelector('#lg-email')?.offsetParent && !/טוען…/.test(document.querySelector('#state')?.textContent || ''); }, null, { timeout: 60000 }).catch(() => {});
await page.goto(`${BASE}clients.html`, { waitUntil: 'domcontentloaded' });
await page.fill('#lg-email', emailOf(ROLE));
await page.fill('#lg-pass', 'correct-horse');
await page.click('#lg-submit');
await content();
await page.waitForLoadState('networkidle');

const out = { role: ROLE, latency: LATENCY, kbps: KBPS, marks: MARKS, log: LOG, pages: {} };
for (const p of PAGES) {
  const runs = [];
  for (let r = 0; r < ROUNDS; r += 1) {
    await page.goto('about:blank');
    await ctx.clock.fastForward(11 * 60e3); // past what the tab may show from its store (app/data-cache.js MAX_AGE)
    log = [];
    const t = Date.now();
    await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
    await content();
    const toContent = Date.now() - t;
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    const toIdle = Date.now() - t - 500;
    runs.push({ toContent, toIdle, requests: log.length, kb: Math.round(log.reduce((n, e) => n + e.bytes, 0) / 1024), calls: log.map((e) => `${e.what} ${e.rows ?? ''}`) });
  }
  const med = (k) => runs.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
  out.pages[p] = { requests: med('requests'), kb: med('kb'), toContent: med('toContent'), toIdle: med('toIdle'), calls: runs.at(-1).calls };
  console.log(`${p.padEnd(20)} requests ${String(med('requests')).padStart(3)}  ${String(med('kb')).padStart(5)} KB  content ${String(med('toContent')).padStart(5)} ms  idle ${String(med('toIdle')).padStart(5)} ms`);
}
if (errors.length) console.log('errors:', errors);
if (process.env.CALLS) for (const [p, r] of Object.entries(out.pages)) console.log(p, '\n  ' + r.calls.join('\n  '));
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
await browser.close();
