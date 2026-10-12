// Where the time of a screen goes (docs/ops.md, section 59): the CPU profile of one open
// of a page, or of one tap on it, for one role of the big mock office (tests/perf-world.mjs),
// on the phone of tests/perf-local.mjs (390px, the CPU slowed 4 times). It prints the
// functions that held the main thread, by their own time and by the time under them.
//      npx http-server -p 5311 -s -c600 . &
//      BASE_URL=http://localhost:5311/ node tests/perf-profile.mjs irit [clients.html#mine] [selector to tap]
// Numbers are of the slowed CPU. Not a suite: it prints, and decides nothing.
import { chromium } from 'playwright';
import { NOW, SUPA, emailOf, makeFake } from './roles-world.mjs';
import { buildBigWorld } from './perf-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const ROLE = process.argv[2] || 'irit';
const PAGE = process.argv[3] || 'clients.html#mine';
const TAP = process.argv[4] || null;
const CPU = Number(process.env.CPU || 4);
const TOP = Number(process.env.TOP || 28);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const fake = makeFake(buildBigWorld());
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
await ctx.clock.install({ time: NOW });
await ctx.route(`${SUPA}/**`, async (route) => { await new Promise((done) => { setTimeout(done, Number(process.env.LATENCY || 150)); }); return fake.route(route); });
const page = await ctx.newPage();
const shown = () => page.waitForFunction(() => { const m = document.querySelector('main'); return m && !('boot' in document.documentElement.dataset) && m.innerText.trim().length > 40 && !document.querySelector('#lg-email')?.offsetParent; }, null, { timeout: 60000 });
await page.goto(`${BASE}clients.html`, { waitUntil: 'domcontentloaded' });
await page.fill('#lg-email', emailOf(ROLE));
await page.fill('#lg-pass', 'correct-horse');
await page.click('#lg-submit');
await shown();
await page.waitForLoadState('networkidle');

const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
if (TAP) {
  await page.goto('about:blank');
  await page.goto(`${BASE}${PAGE}`, { waitUntil: 'domcontentloaded' });
  await shown();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await cdp.send('Profiler.start');
  for (const sel of TAP.split('|')) { await page.locator(sel).first().tap(); await page.waitForTimeout(900); }
} else {
  await page.goto('about:blank');
  await cdp.send('Profiler.start');
  await page.goto(`${BASE}${PAGE}`, { waitUntil: 'domcontentloaded' });
  await shown();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}
const { profile } = await cdp.send('Profiler.stop');
// TRACE=1: the same open once more, as the browser's own timeline: every task of the main
// thread over 50 ms and what it was made of (script, compiling, style, layout, paint).
if (process.env.TRACE && !TAP) {
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => events.push(...d.value));
  await page.goto('about:blank');
  await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'disabled-by-default-v8.compile', 'loading', 'blink.user_timing'] } });
  await page.goto(`${BASE}${PAGE}`, { waitUntil: 'domcontentloaded' });
  await shown();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  const ended = new Promise((done) => { cdp.once('Tracing.tracingComplete', done); });
  await cdp.send('Tracing.end');
  await ended;
  // The page's main thread: the renderer thread that worked the most.
  const work = new Map();
  for (const e of events) if (e.ph === 'X' && e.name === 'RunTask') work.set(`${e.pid}:${e.tid}`, (work.get(`${e.pid}:${e.tid}`) || 0) + e.dur);
  const mains = events.filter((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain').sort((a, b) => (work.get(`${b.pid}:${b.tid}`) || 0) - (work.get(`${a.pid}:${a.tid}`) || 0));
  const main = mains[0];
  const mine = events.filter((e) => e.ph === 'X' && e.pid === main?.pid && e.tid === main?.tid);
  const tasks = mine.filter((e) => (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') && e.dur > 50e3).sort((a, b) => a.ts - b.ts);
  const start = Math.min(...mine.map((e) => e.ts));
  const KINDS = ['EvaluateScript', 'v8.compile', 'v8.compileModule', 'V8.CompileCode', 'FunctionCall', 'RunMicrotasks', 'TimerFire', 'EventDispatch', 'FireAnimationFrame', 'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'ParseHTML', 'ParseAuthorStyleSheet', 'MinorGC', 'MajorGC', 'V8.GC_MC_BACKGROUND_MARKING', 'HitTest', 'IntersectionObserverController::computeIntersections'];
  console.log(`\nlong tasks of the open (CPU x${CPU}), and what is inside each (ms; the parts nest, so they do not add up):`);
  for (const t of tasks) {
    const inside = mine.filter((e) => e.ts >= t.ts && e.ts + (e.dur || 0) <= t.ts + t.dur && e !== t);
    const sums = KINDS.map((k) => [k, inside.filter((e) => e.name === k).reduce((n, e) => n + e.dur, 0) / 1000]).filter(([, v]) => v >= 3);
    const fn = inside.filter((e) => e.name === 'FunctionCall' || e.name === 'EvaluateScript').sort((a, b) => b.dur - a.dur).slice(0, 3).map((e) => `${e.args?.data?.functionName || e.name} ${(e.args?.data?.url || '').split('/').pop()}:${e.args?.data?.lineNumber ?? ''} ${Math.round(e.dur / 1000)}`);
    console.log(`  at ${Math.round((t.ts - start) / 1000)} ms: ${Math.round(t.dur / 1000)} ms  ${sums.map(([k, v]) => `${k} ${Math.round(v)}`).join(', ')}\n      ${fn.join(' | ')}`);
  }
}
await browser.close();

// Own time per node from the samples; the time under a function is counted once per stack.
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const own = new Map();
profile.samples.forEach((id, i) => own.set(id, (own.get(id) || 0) + (profile.timeDeltas[i] || 0) / 1000));
const label = (n) => { const f = n.callFrame; const file = f.url.split('/').pop() || ''; return `${f.functionName || '(anonymous)'} ${file}${file ? `:${f.lineNumber + 1}` : ''}`; };
const self = new Map();
const under = new Map();
let busy = 0;
for (const [id, ms] of own) {
  const n = byId.get(id);
  const name = label(n);
  if (/^\((idle|program|root)\)/.test(name)) continue;
  busy += ms;
  self.set(name, (self.get(name) || 0) + ms);
  const seen = new Set();
  for (let at = id; at !== undefined; at = parent.get(at)) { const l = label(byId.get(at)); if (!seen.has(l)) { seen.add(l); under.set(l, (under.get(l) || 0) + ms); } }
}
const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([k, v]) => `  ${String(Math.round(v)).padStart(6)} ms  ${k}`).join('\n');
console.log(`${ROLE} · ${PAGE}${TAP ? ` · tap ${TAP}` : ''} · script time ${Math.round(busy)} ms (CPU x${CPU})`);
console.log(`\nown time:\n${top(self)}`);
console.log(`\ntime under (the app's own functions):\n${top(new Map([...under].filter(([k]) => /\.js:/.test(k) && !/supabase|vendor/.test(k))))}`);
