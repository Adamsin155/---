// "מעקב לקוחות": the two totals above the table stay inside their tiles with four-digit numbers
// ("2140 מתוך 3417", the owner's phone 22.11.2026: the numbers spilled out of the tiles and over each
// other). 45 invented clients, ~76 videos and ~67 graphics each; Irit on the narrowest phones and
// on a computer: every part of each tile inside the tile, the tiles not over each other, and no
// sideways scroll. Screenshots (SHOTS=1) go to SHOTS_OUT.
// Run: node <a static server> . 8481 &  then  BASE_URL=http://localhost:8481/ node tests/tracking-totals-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8481/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const errors = [];

function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  db.clients = Array.from({ length: 45 }, (_, i) => ({
    ...base, id: cid(400 + i), name: `לקוח ${i + 1}`, business: `עסק לדוגמה מספר ${i + 1}`, editor: 'yariv', editor2: null, editor_split: null,
    rounds: [], landing: false, status: 'active', shoot_at: '2026-10-01T10:00:00+03:00',
    deliverables: {
      videos: 76, graphics: 67, shoot_days: 1,
      tracking: {
        videos: { done: 48, by: 'irit', at: '2026-10-19T09:00:00+03:00', auto: { done: 48, of: 76 } },
        graphics: { done: 30, by: 'irit', at: '2026-10-19T09:00:00+03:00', auto: { done: 30, of: 67 } },
      },
    },
  }));
  return db;
}

async function open(engine, opts) {
  const db = office();
  const fake = makeFlowFake(db);
  const ctx = opts.device
    ? await engine.newContext({ ...opts.device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })
    : await engine.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: opts.width, height: 844 }, isMobile: opts.width < 600, hasTouch: opts.width < 600 });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${opts.name}: ${e}`));
  await page.goto(`${BASE}tracking.html`);
  await page.fill('#lg-email', emailOf('irit'));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#ct-stats li .v');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(900);
  return { page, ctx };
}

// Every part of each tile inside the tile; the tiles side by side and not over each other.
async function fits(page) {
  return page.evaluate(() => {
    const out = [];
    const tiles = [...document.querySelectorAll('#ct-stats li')];
    const r = tiles.map((t) => t.getBoundingClientRect());
    tiles.forEach((t, i) => {
      for (const el of t.querySelectorAll('*')) {
        const e = el.getBoundingClientRect();
        if (!e.width) continue;
        if (e.left < r[i].left - 1 || e.right > r[i].right + 1) out.push(`tile ${i + 1}: "${el.textContent.trim().slice(0, 30)}" spills (${Math.round(e.left)}-${Math.round(e.right)} vs ${Math.round(r[i].left)}-${Math.round(r[i].right)})`);
      }
    });
    if (r.length === 2 && r[0].top === r[1].top && !(r[0].right <= r[1].left + 1 || r[1].right <= r[0].left + 1)) out.push('the tiles overlap');
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('the page scrolls sideways');
    return { out, texts: tiles.map((t) => t.innerText.replace(/\s+/g, ' ').trim()) };
  });
}

const RUNS = [
  { name: 'webkit-iphone-se', engine: webkit, device: devices['iPhone SE'] },
  { name: 'webkit-iphone13', engine: webkit, device: devices['iPhone 13'] },
  { name: 'chromium-360', engine: chromium, width: 360 },
  { name: 'chromium-390', engine: chromium, width: 390 },
  { name: 'chromium-768', engine: chromium, width: 768 },
  { name: 'chromium-1366', engine: chromium, width: 1366 },
];
let passed = 0;
for (const run of RUNS) {
  const browser = await run.engine.launch();
  try {
    const { page } = await open(browser, run);
    // The fake office gives 0 done; the owner's phone had 2140 / 1367 done: put those (and a worse
    // case) into the tiles as the page writes them, then measure.
    for (const [a, b, tag] of [['2140', '1367', 'owner'], ['99999', '99999', 'worst']]) {
      await page.evaluate(([x, y]) => { const d = document.querySelectorAll('#ct-stats .ct-done'); if (d[0]) d[0].textContent = x; if (d[1]) d[1].textContent = y; }, [a, b]);
      const { out, texts } = await fits(page);
      if (SHOTS) await page.locator('#ct-stats').screenshot({ path: `${OUT}tracking-totals-${run.name}-${tag}.png` });
      assert.match(texts[0], /\d{4,5} מתוך \d{4}/, `${run.name}: four-digit totals (${texts[0]})`);
      assert.deepEqual(out, [], `${run.name} ${tag}: ${out.join('; ')}`);
      console.log(`  ${run.name} ${tag}: ${texts.join(' | ')}`);
    }
    passed++;
  } finally { await browser.close(); }
}
assert.deepEqual(errors, []);
console.log(`\n${passed} passed`);
