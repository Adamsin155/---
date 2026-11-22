// The field sales' "יומן" (Lior's request, approved by the owner on 22.11.2026; docs/ops.md,
// section 146) in the browser, against the office of tests/roles-world.mjs (Tuesday
// 20.10.2026, 10:00 in Israel; invented names):
//  - Stav has "יומן" in her menu (and in the phone's bar); the page opens on the month, with
//    no week / month choice, no "פגישה חדשה" and no Google card;
//  - each day says "יום צילום" / "2 צילומים" (pink) or "פנוי" (green); Friday, Saturday and
//    holidays quiet; a tap on a day writes what it is under the grid;
//  - the page asks only public.sales_shoot_days (dates and a count): never a client table,
//    and no client name is anywhere on it;
//  - next / previous month asks again for that month; "היום" comes back;
//  - 390px and 1366px, no side scroll, 44px targets; Irit's calendar is as before.
// Run: node <static server> . 8094 &  then  BASE_URL=http://localhost:8094/ node tests/sales-calendar-e2e.mjs [screenshot dir]
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from './roles-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const SHOTS = process.argv[2] || null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1366, height: 900 };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const dayIL = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(iso));

// public.sales_shoot_days as the database answers it: every shoot of an active or ending,
// unarchived client, its main one and every round's, counted by Israel day.
function salesDays(db, from, to) {
  const n = {};
  for (const c of db.clients) {
    if (!['active', 'ending'].includes(c.status) || c.archived_at) continue;
    for (const at of [c.shoot_at, ...(c.rounds || []).map((r) => r.shoot_at)]) {
      if (!at) continue;
      const d = dayIL(at);
      if (d >= from && d <= to) n[d] = (n[d] || 0) + 1;
    }
  }
  return Object.keys(n).sort().map((day) => ({ day, n: n[day] }));
}
// Two more shoots on the 27th, so the page shows a count.
function world() {
  const db = buildWorld();
  const [a, b] = db.clients.filter((c) => c.status === 'active' && !c.shoot_at);
  a.shoot_at = '2026-10-27T10:00:00+02:00';
  b.shoot_at = '2026-10-27T13:00:00+02:00';
  return db;
}

async function signedIn(browser, role, { viewport = PHONE } = {}) {
  const db = world();
  const fake = makeFake(db);
  const asked = { sales: [], tables: [] };
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: viewport === PHONE && browser.browserType().name() === 'chromium', hasTouch: viewport === PHONE });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (req.method() !== 'OPTIONS' && p === '/rest/v1/rpc/sales_shoot_days') {
      const body = JSON.parse(req.postData() || '{}');
      asked.sales.push(body);
      const ok = role === 'stav';
      return route.fulfill({ status: ok ? 200 : 403, contentType: 'application/json', headers: CORS,
        body: JSON.stringify(ok ? salesDays(db, body.p_from, body.p_to) : { code: '42501', message: 'not allowed' }) });
    }
    if (req.method() === 'GET' && /^\/rest\/v1\/(clients|protocol_checks|client_tasks|quote_facts)\b/.test(p)) asked.tables.push(p);
    return fake.route(route);
  });
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}calendar.html`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await settle(page);
  return { page, ctx, db, asked };
}
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const noSideScroll = async (page, who) => {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(sw <= cw, `${who}: the page scrolls sideways (${sw} > ${cw})`);
};
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForSelector('#login-block', { state: 'hidden' }).catch(() => {});
  await page.mouse.move(1, 1);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
};
let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

const chrome = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const safari = await webkit.launch();
try {
  for (const [browser, label] of [[chrome, 'chrome'], [safari, 'webkit']]) {
    for (const [viewport, w] of [[PHONE, 390], [DESK, 1366]]) {
      await step(`${label} ${w}: Stav sees the month of taken and free days, and nothing of a client`, async () => {
        const { page, ctx, db, asked } = await signedIn(browser, 'stav', { viewport });
        await page.waitForSelector('#cp-view .cp-sales .cp-grid');
        // Her page: the month, no week, no meeting, no Google.
        assert.equal(await text(page.locator('#cp-title')), 'אוקטובר 2026');
        assert.equal(await page.locator('.cp-views').isHidden(), true);
        assert.equal(await page.locator('#cp-new').isHidden(), true);
        assert.equal(await page.locator('#cp-google').isHidden(), true);
        assert.equal(await page.locator('.cp-ev, .cp-invite').count(), 0);
        // The days.
        const st = (d) => page.locator(`.cp-scell[data-day="${d}"]`).getAttribute('data-state');
        assert.equal(await st('2026-10-27'), 'taken');
        assert.equal(await st('2026-10-28'), salesDays(db, '2026-10-28', '2026-10-28').length ? 'taken' : 'free');
        assert.equal(await st('2026-10-24'), 'closed', 'Saturday');
        assert.equal(await st('2026-10-23'), salesDays(db, '2026-10-23', '2026-10-23').length ? 'taken' : 'closed', 'Friday');
        assert.equal(await st('2026-10-19'), 'past');
        const n27 = salesDays(db, '2026-10-27', '2026-10-27')[0].n;
        assert.ok(n27 >= 2);
        const two = await text(page.locator('.cp-scell[data-day="2026-10-27"]'));
        assert.match(two, new RegExp(w === 390 ? `צילום ×${n27}` : `${n27} צילומים`));
        assert.match(await text(page.locator('.cp-scell[data-day="2026-10-29"]')), salesDays(db, '2026-10-29', '2026-10-29').length ? /צילום/ : /פנוי/);
        assert.match(await text(page.locator('#cp-view .cp-count')), /תפוס.* · .*פנויים/);
        // A tap on a day: what it is, in words.
        await page.click('.cp-scell[data-day="2026-10-27"]');
        assert.equal(await text(page.locator('.cp-sday-t')), `יש ${n27} צילומים ביום הזה.`);
        await page.click('.cp-scell[data-day="2026-10-24"]');
        assert.match(await text(page.locator('.cp-sday-t')), /סוף שבוע או חג/);
        // Nothing of a client: no table asked, no name anywhere on the page.
        assert.deepEqual(asked.tables, []);
        const body = await page.locator('body').innerText();
        for (const c of db.clients) if (c.name) assert.ok(!body.includes(c.name), `a client's name on Stav's page: ${c.name}`);
        // The menu: "יומן", marked as this page.
        assert.ok(await page.locator('a[href="calendar.html"]').count() >= 1);
        if (w === 390) assert.deepEqual((await page.locator('#side-list .side-link:visible').allInnerTexts()).map((t) => t.trim()), ['עסקה חדשה', 'יומן', 'שאלו']);
        // 44px targets, no side scroll.
        for (const el of await page.locator('.cp-arrow, .cp-today, .cp-scell:not(.is-out)').all()) {
          const box = await el.boundingBox();
          if (box) assert.ok(box.height >= 44 && box.width >= 40, `${Math.round(box.width)}x${Math.round(box.height)}`);
        }
        await noSideScroll(page, `stav ${w}`);
        await shot(page, `sales-calendar-${label}-${w}`);
        // The next month asks for it; "היום" comes back.
        await page.click('#cp-next');
        await page.waitForSelector('.cp-scell[data-day="2026-11-15"]');
        assert.equal(await text(page.locator('#cp-title')), 'נובמבר 2026');
        assert.ok(asked.sales.some((b) => b.p_from <= '2026-11-01' && b.p_to >= '2026-11-30'), JSON.stringify(asked.sales));
        assert.ok(asked.sales.every((b) => (new Date(b.p_to) - new Date(b.p_from)) / 864e5 <= 124));
        await page.click('#cp-today');
        assert.equal(await text(page.locator('#cp-title')), 'אוקטובר 2026');
        await noCspViolations(page);
        await ctx.close();
      });
    }
  }

  await step("Irit's calendar is as before: events of the clients, the week and month choice, never sales_shoot_days", async () => {
    const { page, ctx, asked } = await signedIn(chrome, 'irit', { viewport: DESK });
    await page.waitForSelector('#cp-view .cp-ev');
    assert.equal(await page.locator('.cp-views').isVisible(), true);
    assert.equal(await page.locator('.cp-sales').count(), 0);
    assert.deepEqual(asked.sales, []);
    await ctx.close();
  });

  assert.deepEqual(errors, []);
  console.log(`\n${passed} passed`);
} finally {
  await chrome.close();
  await safari.close();
}
