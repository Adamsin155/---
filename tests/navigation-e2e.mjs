// From screen to screen (docs/ops.md, section 60), in the browser, against the roles
// world (tests/roles-world.mjs; Tuesday 20.10.2026, 10:00 in Israel):
//  - the app's frame (the bottom bar or the side menu, the name, the profile button) is
//    in the first paint of the next page, before any of its modules ran, and is exactly
//    the frame the modules then draw; a page that turns out to show the sign-in screen
//    has none;
//  - a screen opens with what it showed last time in this tab and is brought up to date
//    behind that: while the server has not answered, the page is shown and its buttons
//    wait; when the answer differs, the page changes without loading again;
//  - what the tab keeps is the listed reads only (never the vault, quotes, deals, links),
//    in sessionStorage only, and never more than the bound;
//  - signing out leaves nothing; the next person sees nothing of the one before, also
//    with "back", and lands on their own home;
//  - someone who is no longer one of the staff is not shown a remembered screen for long;
//  - "back" returns to the same place in the list and the same tab, whether the browser
//    kept the page whole or loaded it again; the page comes in from the side and leaves
//    the way it came;
//  - a sign-in asks for everything the first screen needs side by side.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/navigation-e2e.mjs
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from './roles-world.mjs';
import { KEPT_TABLES, KEPT_RPCS, MAX_TOTAL } from '../app/data-cache.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1280, height: 900 };
const CARD = 'c0000000-0000-4000-8000-000000000012';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];

// A tab of one person. `gate`: what the test holds back or changes on the way:
//   gate.modules  true: the page's modules do not arrive (the gates in <head> still do)
//   gate.server   a promise: the answers to the reads the tab may keep wait for it
//                 (with gate.holdAll, every answer of the database)
//   gate.notStaff true: the server says this person is not one of the staff
async function open(role, { viewport = PHONE, on = browser, path = 'clients.html', init = null } = {}) {
  const db = buildWorld();
  const fake = makeFake(db);
  const ctx = await on.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: viewport.width < 800, hasTouch: viewport.width < 800 });
  await ctx.clock.install({ time: NOW });
  const gate = { modules: false, server: null, notStaff: false, asked: [] };
  await ctx.route(`${SUPA}/**`, async (route) => {
    const u = new URL(route.request().url());
    const name = `${route.request().method()} ${u.pathname.replace('/rest/v1/', '')}`;
    const call = { name, start: Date.now(), end: 0 };
    gate.asked.push(call);
    // (The reads that are never kept answer at once: a page always waits for those, as before.)
    const table = u.pathname.replace('/rest/v1/', '');
    const listed = KEPT_TABLES.has(table) || KEPT_RPCS.has(table.replace(/^rpc\//, ''));
    if (gate.server && (listed || gate.holdAll)) await gate.server;
    if (gate.notStaff && u.pathname === '/rest/v1/rpc/is_staff') {
      call.end = Date.now();
      return route.fulfill({ status: 200, contentType: 'application/json', body: 'false', headers: { 'access-control-allow-origin': '*' } });
    }
    await fake.route(route);
    call.end = Date.now();
    return null;
  });
  let release = [];
  await ctx.route(/\/app\/[^/]+\.js(\?.*)?$/, async (route) => {
    if (gate.modules && !/\/(shell-gate|login-gate|frame-guard)\.js/.test(route.request().url())) await new Promise((done) => { release.push(done); });
    return route.continue().catch(() => {});
  });
  gate.letModules = () => { gate.modules = false; for (const done of release) done(); release = []; };
  // The test server says "no-store" for every file (-c-1), and a browser keeps no such
  // page whole. The published site is served with ten minutes (GitHub Pages): the pages
  // of the full browser get that header, so that what is tested is the page itself.
  if (on !== browser) {
    await ctx.route(/\.html(\?.*)?$/, async (route) => {
      const res = await route.fetch();
      return route.fulfill({ response: res, headers: { ...res.headers(), 'cache-control': 'max-age=600' } });
    });
  }
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  watchCsp(page);
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}${path}`);
  await signIn(page, role);
  return { page, ctx, db, gate };
}
async function signIn(page, role) {
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await shown(page);
}
// The page is shown (built, and not the sign-in screen), and nothing more is on its way.
const shown = (page) => page.waitForFunction(() => !('boot' in document.documentElement.dataset) && document.getElementById('app') && !document.getElementById('app').hidden
  && !document.querySelector('#lg-email')?.offsetParent, null, { timeout: 30000 });
const settle = async (page) => { await shown(page); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const confirmed = (page) => page.waitForFunction(() => !document.documentElement.hasAttribute('data-stale'), null, { timeout: 15000 });
const frame = (page) => page.evaluate(() => ({
  menus: document.querySelectorAll('#app-side').length,
  items: [...document.querySelectorAll('#app-side .side-list > *')].map((a) => `${a.textContent.trim()}${a.matches('[aria-current]') ? '*' : ''}${a.classList.contains('is-on') ? '+' : ''}${a.tagName === 'A' ? `→${a.getAttribute('href')}` : ''}`),
  shownBar: (() => { const s = document.querySelector('#app-side'); return !!s && s.getBoundingClientRect().height > 0; })(),
  who: [...document.querySelectorAll('.topbar .who-name')].map((n) => n.textContent),
  avatars: [...document.querySelectorAll('.topbar .ds-av')].map((n) => n.textContent),
  sw: [...document.querySelectorAll('#profile-switch')].map((a) => `${a.textContent}→${a.getAttribute('href')}`),
  profile: document.documentElement.dataset.profile ?? null,
  tabbar: document.body.classList.contains('has-tabbar'), shell: document.body.classList.contains('has-shell'),
  logout: !document.getElementById('btn-logout')?.hidden,
}));
const keptKeys = (page) => page.evaluate(() => Object.keys(sessionStorage).filter((k) => k === 'astrateg.shell' || k === 'astrateg.cache' || k.startsWith('astrateg.cache.')));
const keptEntries = (page) => page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('astrateg.cache.') && !/\.(sizes|again)$/.test(k))
  .map((k) => { const e = JSON.parse(sessionStorage.getItem(k)); return { key: e.key, uid: e.uid, size: e.body.length, body: e.body }; }));

let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

await step('the frame is in the first paint of the next page, before its modules, and is the frame the modules draw', async () => {
  const PAGES = [`client.html?id=${CARD}`, 'clients.html#clients', 'owner.html#now', 'clients.html#mine', 'prep.html', 'gantt.html', 'qa.html', 'shoot.html', 'quotes.html', 'editor.html'];
  for (const [role, viewport] of [['irit', PHONE], ['owner', PHONE], ['lior', PHONE], ['nadia', PHONE], ['eli', PHONE], ['irit', WIDE], ['ilai', WIDE]]) {
    const { page, ctx, gate } = await open(role, { viewport });
    await settle(page);
    for (const path of PAGES) {
      gate.modules = true;
      await page.goto('about:blank');
      await page.goto(`${BASE}${path}`, { waitUntil: 'commit' });
      await page.waitForFunction(() => document.readyState !== 'loading' || !!document.querySelector('main'), null, { timeout: 15000 });
      await page.waitForTimeout(250);
      const early = await frame(page);
      const where = `${role} ${viewport.width} ${path}`;
      // No module ran: whatever is there was drawn by the gate.
      assert.equal(await page.evaluate(() => document.querySelectorAll('[data-early]').length > 0), true, `${where}: drawn early`);
      assert.equal(early.menus, 1, where);
      assert.ok(early.items.length >= 1, where);
      assert.equal(early.shownBar, viewport.width >= 1024 || early.tabbar, `${where}: the bar is on the screen`);
      assert.equal(early.who.length, 1, where);
      assert.equal(early.logout, true, `${where}: the way out is in its place`);
      gate.letModules();
      await page.waitForFunction(() => !document.querySelector('[data-early]') && document.querySelector('#app-side .side-link'), null, { timeout: 30000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(300);
      const late = await frame(page);
      // A page that is not this person's still has their frame; the comparison is the point.
      assert.deepEqual(early, late, `${where}: the early frame is the real one`);
      assert.equal(late.avatars.length, 1, `${where}: one avatar`);
      assert.ok(late.sw.length <= 1, `${where}: one profile button at most`);
    }
    await ctx.close();
  }
});

await step('nothing is kept before sign-in or on a client\'s page; a first visit draws no frame early', async () => {
  const fake = makeFake(buildWorld());
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: PHONE });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`anon: ${e}`));
  watchCsp(page);
  // Something a previous visitor of this tab could have left: it goes before anything is drawn.
  await page.goto(`${BASE}clients.html`);
  await page.evaluate(() => {
    sessionStorage.setItem('astrateg.shell', JSON.stringify({ v: 1, uid: 'someone', home: 'clients.html#mine', menus: {}, pages: {}, who: ['מישהו', 'מי', '#fff'] }));
    sessionStorage.setItem('astrateg.cache', JSON.stringify({ uid: 'someone', e: { a: [1, 1, 0] }, ns: {} }));
    sessionStorage.setItem('astrateg.cache.a', JSON.stringify({ uid: 'someone', key: 'GET clients', body: '[{"name":"לקוח של מישהו אחר"}]' }));
  });
  await page.reload();
  await page.waitForSelector('#login-form');
  await page.waitForTimeout(300);
  assert.deepEqual(await keptKeys(page), []);
  assert.equal(await page.locator('#app-side').count(), 0);
  assert.equal(await page.evaluate(() => document.body.innerText.includes('מישהו')), false);
  await ctx.close();
});

await step('a screen opens with what it showed last time; its buttons wait for the server; a changed answer redraws the page in place', async () => {
  const { page, ctx, db, gate } = await open('irit');
  await page.goto(`${BASE}clients.html#clients`);
  await settle(page);
  const first = db.clients.find((c) => c.status === 'active');
  const oldName = first.name;
  assert.ok((await page.innerText('#client-list')).includes(oldName));
  // Someone renamed a client meanwhile, and the server is slow to say so.
  first.name = 'שם שהשתנה בינתיים';
  let answer;
  gate.server = new Promise((done) => { answer = done; });
  await page.goto('about:blank');
  await page.goto(`${BASE}clients.html#clients`);
  await shown(page); // shown although the server has answered nothing
  await page.evaluate(() => { window.__same = true; });
  const list = await page.innerText('#client-list');
  assert.ok(list.includes(oldName), 'what the tab remembered is on the screen');
  assert.ok(!list.includes('שם שהשתנה בינתיים'));
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-stale')), true);
  // A button waits; a link, a tab and what only opens do not.
  const taps = await page.evaluate(() => {
    const pe = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).pointerEvents : null; };
    return { create: pe('#btn-new'), refresh: pe('#btn-refresh'), search: pe('#client-search'), tab: pe('#tab-mine'), link: pe('#client-list a[href*="client.html"]'), bar: pe('#app-side .side-link') };
  });
  assert.deepEqual(taps, { create: 'none', refresh: 'none', search: 'none', tab: 'auto', link: 'auto', bar: 'auto' });
  answer();
  gate.server = null;
  await page.waitForFunction((name) => document.getElementById('client-list').innerText.includes(name), 'שם שהשתנה בינתיים', { timeout: 15000 });
  await confirmed(page);
  assert.equal(await page.evaluate(() => window.__same === true), true, 'the page did not load again');
  assert.ok(!(await page.innerText('#client-list')).includes(oldName));
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#btn-new')).pointerEvents), 'auto');
  // The same, unchanged: confirmed without a redraw, and the buttons are let go.
  gate.server = new Promise((done) => { answer = done; });
  await page.goto('about:blank');
  await page.goto(`${BASE}clients.html#clients`);
  await shown(page);
  assert.ok((await page.innerText('#client-list')).includes('שם שהשתנה בינתיים'));
  answer();
  gate.server = null;
  await confirmed(page);
  // With no network the remembered screen stays, like a page left open.
  await ctx.route(`${SUPA}/rest/**`, (route) => route.abort());
  await page.goto('about:blank');
  await page.goto(`${BASE}clients.html#clients`);
  await shown(page);
  assert.ok((await page.innerText('#client-list')).includes('שם שהשתנה בינתיים'));
  await confirmed(page);
  await ctx.close();
});

await step('after a save, the next screen is the server\'s and not a remembered one', async () => {
  const { page, ctx, gate } = await open('irit');
  await settle(page);
  await page.goto(`${BASE}client.html?id=${CARD}`);
  await settle(page);
  await confirmed(page);
  assert.ok((await keptEntries(page)).some((e) => / clients\?/.test(e.key)));
  // Any write: here, as the page itself would send it.
  await page.evaluate(async () => {
    const { supabase } = await import('./app/supa.js');
    await supabase.from('client_tasks').update({ urgent: false }).eq('id', '00000000-0000-4000-8000-000000000000');
  });
  const after = await keptEntries(page);
  assert.deepEqual(after.filter((e) => !/ (rpc\/is_staff|staff)[? ]/.test(e.key)).map((e) => e.key), [], 'only who the person is stays');
  let answer;
  gate.server = new Promise((done) => { answer = done; });
  gate.holdAll = true;
  await page.goto(`${BASE}clients.html#clients`);
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => 'boot' in document.documentElement.dataset), true, 'nothing remembered is shown: the page waits for the server');
  answer();
  gate.server = null;
  await settle(page);
  await ctx.close();
});

await step('the tab keeps the listed reads only, for this account, in sessionStorage only, within the bound', async () => {
  for (const role of ['irit', 'owner', 'ofir', 'nadia']) {
    const { page, ctx } = await open(role);
    await settle(page);
    for (const path of [`client.html?id=${CARD}`, 'clients.html#clients', 'owner.html#now', 'quotes.html', 'clients.html#mine', `client.html?id=${CARD}`]) {
      await page.goto(`${BASE}${path}`);
      // (Not every one of these is every role's page: a page that says "אין לך גישה" counts as opened.)
      await page.waitForFunction(() => !('boot' in document.documentElement.dataset), null, { timeout: 30000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(400);
    }
    const uid = await page.evaluate(() => JSON.parse(sessionStorage.getItem('astrateg.cache')).uid);
    const entries = await keptEntries(page);
    assert.ok(entries.length >= 8, `${role}: ${entries.length} answers kept`);
    for (const e of entries) {
      const m = /^(GET|POST) (rpc\/)?([a-z_0-9]+)[? ]/.exec(e.key);
      assert.ok(m, `${role}: ${e.key.slice(0, 80)}`);
      assert.ok(m[2] ? KEPT_RPCS.has(m[3]) : m[1] === 'GET' && KEPT_TABLES.has(m[3]), `${role}: not on the list: ${e.key.slice(0, 80)}`);
      assert.equal(e.uid, uid, `${role}: kept under the account`);
      assert.ok(!/client_access|vault|quotes|deal_requests|payout|_links|token/.test(e.key.split('?')[0]), e.key.slice(0, 80));
    }
    assert.ok(entries.reduce((n, e) => n + e.size, 0) <= MAX_TOTAL, `${role}: within the bound`);
    // Nothing of it anywhere that outlives the tab.
    const outside = await page.evaluate(async () => ({
      local: Object.keys(localStorage).filter((k) => /astrateg\.(cache|shell)/.test(k)),
      stores: (await caches.keys()).length,
      dbs: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [],
    }));
    assert.deepEqual(outside, { local: [], stores: 0, dbs: [] }, role);
    // The frame that is kept: names of screens and the person's name.
    const shell = await page.evaluate(() => JSON.parse(sessionStorage.getItem('astrateg.shell')));
    assert.equal(shell.uid, uid);
    assert.deepEqual(Object.keys(shell).sort(), ['home', 'menus', 'pages', 'uid', 'v', 'who']);
    await ctx.close();
  }
});

await step('signing out leaves nothing; the next person sees nothing of the one before and lands on their home', async () => {
  const { page, ctx, gate } = await open('irit');
  await settle(page);
  await page.goto(`${BASE}client.html?id=${CARD}`);
  await settle(page);
  await page.goto(`${BASE}clients.html#clients`);
  await settle(page);
  assert.ok((await keptKeys(page)).length > 5);
  await page.click('#btn-logout');
  await page.waitForSelector('#lg-email:visible');
  await page.waitForTimeout(300);
  assert.deepEqual(await keptKeys(page), [], 'nothing of the account stays in the tab');
  assert.equal(await page.locator('#app-side').count(), 0);
  // Nadia, an editor, on the same tab. Her first page has no frame drawn early (nothing was kept)...
  gate.modules = true;
  await page.fill('#lg-email', emailOf('nadia')).catch(() => {});
  gate.letModules();
  await signIn(page, 'nadia');
  await settle(page);
  assert.equal(await page.evaluate(() => `${location.pathname.split('/').pop()}${location.hash}`), 'clients.html#mine');
  assert.equal(await page.innerText('#who-name'), 'נדיה');
  const mine = await page.evaluate(() => JSON.parse(sessionStorage.getItem('astrateg.cache')).uid);
  for (const e of await keptEntries(page)) assert.equal(e.uid, mine);
  // ...and the next one has hers, not Irit's (who had a profile button and "לפני צילום").
  gate.modules = true;
  await page.goto('about:blank');
  await page.goto(`${BASE}clients.html#clients`, { waitUntil: 'commit' });
  await page.waitForFunction(() => !!document.querySelector('#app-side[data-early]'), null, { timeout: 15000 });
  const early = await frame(page);
  assert.deepEqual(early.who, ['נדיה']);
  assert.deepEqual(early.sw, []);
  assert.ok(!early.items.join(' ').includes('לפני צילום'));
  gate.letModules();
  await settle(page);
  // Her list holds her clients only, from the first moment it is shown.
  const names = await page.evaluate(() => [...document.querySelectorAll('#client-list a[href*="client.html"]')].length);
  assert.ok(names >= 1 && names < 22, `${names} clients`);
  await ctx.close();
});

await step('someone who is no longer one of the staff is taken off the remembered screen', async () => {
  const { page, ctx, gate } = await open('nadia');
  await settle(page);
  await page.goto(`${BASE}clients.html#clients`);
  await settle(page);
  gate.notStaff = true;
  await page.goto('about:blank');
  await page.goto(`${BASE}clients.html#clients`);
  // The remembered answer says "staff"; the server says no: the page loads again and shows the sign-in screen.
  await page.waitForSelector('#lg-email:visible', { timeout: 20000 });
  await page.waitForFunction(() => !document.getElementById('lg-err').hidden, null, { timeout: 10000 });
  assert.equal(await page.locator('#app-side').count(), 0, 'no frame around the sign-in screen');
  assert.equal(await page.evaluate(() => document.getElementById('app').hidden), true);
  assert.deepEqual((await keptEntries(page)).filter((e) => !/ (rpc\/is_staff|staff)[? ]/.test(e.key) ? false : /is_staff/.test(e.key)).map((e) => e.body), ['false']);
  await ctx.close();
});

// "Back". The headless shell never keeps a page whole, so the first run is the page that
// loads again; the full browser (when this machine has it) keeps it.
async function backAndForth(on, label) {
  const recorder = () => {
    window.__astrategMotion = true; // under automation the pages do not move unless asked (app/shell-gate.js)
    window.addEventListener('pageshow', (e) => { window.__kept = e.persisted; });
    // Every time the gate says which way a page comes in (<html data-nav>).
    new MutationObserver(() => {
      const way = document.documentElement?.dataset.nav;
      if (way) { try { sessionStorage.setItem('test.way', `${sessionStorage.getItem('test.way') || ''}${way},`); } catch { /* no storage */ } }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-nav'] });
  };
  const { page, ctx } = await open('irit', { on, init: recorder });
  await settle(page);
  await page.goto(`${BASE}clients.html#clients`);
  await settle(page);
  const row = page.locator('#client-list a[href*="client.html?id="]').nth(9);
  await row.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 140));
  await page.waitForTimeout(300);
  const was = await page.evaluate(() => ({ y: Math.round(window.scrollY), hash: location.hash, rows: document.querySelectorAll('#client-list a[href*="client.html?id="]').length }));
  assert.ok(was.y > 400, `${label}: the list was scrolled (${was.y})`);
  await page.evaluate(() => sessionStorage.removeItem('test.way'));
  await Promise.all([page.waitForURL(/client\.html/), row.click()]);
  await settle(page);
  await page.goBack({ waitUntil: 'commit' }); // (a page that is kept whole fires no "load")
  await shown(page);
  await page.waitForFunction((n) => document.querySelectorAll('#client-list a[href*="client.html?id="]').length === n, was.rows, { timeout: 20000 });
  await page.waitForTimeout(500);
  const now = await page.evaluate(() => ({ y: Math.round(window.scrollY), hash: location.hash, kept: window.__kept === true, way: sessionStorage.getItem('test.way') || '' }));
  assert.ok(Math.abs(now.y - was.y) <= 4, `${label}: back at the same place (${was.y} → ${now.y})`);
  assert.equal(now.hash, was.hash, `${label}: the same tab`);
  assert.equal(await page.getAttribute('#tab-clients', 'aria-selected'), 'true');
  // The way the pages came in: the browser really moved them (the move was being dropped
  // on every followed link until the rule that turns it on came first in the <head>).
  assert.equal(now.way, 'forward,back,', `${label}: in from the side, and back the way it came`);
  await confirmed(page);
  // A screen of the bar is not a step in or out: it fades.
  await page.evaluate(() => sessionStorage.removeItem('test.way'));
  await Promise.all([page.waitForURL(/prep\.html/), page.click('#side-prep')]);
  await settle(page);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('test.way')), 'fade,', `${label}: a screen of the bar`);
  // And the frame was there, drawn, from the first frame of each of them (the first step holds the modules back to prove it).
  assert.equal(await page.locator('#app-side .side-link[aria-current]').innerText(), 'לפני צילום');
  await ctx.close();
  return now;
}
await step('"back" to a page that loaded again: the same place in the list, the same tab', async () => {
  const now = await backAndForth(browser, 'loaded again');
  assert.equal(now.kept, false);
});

let full = null;
try { full = await chromium.launch({ channel: 'chromium', ignoreDefaultArgs: ['--disable-back-forward-cache'] }); } catch { full = null; }
if (full) {
  await step('"back" to a page the browser kept whole: shown as it was; and never to another account', async () => {
    const now = await backAndForth(full, 'kept whole');
    assert.equal(now.kept, true, 'the browser kept the page (nothing in it stops that)');
    // Irit leaves a list behind, signs out on the card; Nadia signs in; "back" must not show Irit's list.
    const { page, ctx } = await open('irit', { on: full, init: () => {
      // When a kept page is shown again: is a client list about to be drawn, and how long is it?
      // (Looked at when the browser is about to draw, after every listener of the page has run.)
      const look = () => {
        const rows = document.querySelectorAll('#client-list a[href*="client.html?id="]').length;
        const drawn = rows && getComputedStyle(document.body).visibility !== 'hidden' && !('boot' in document.documentElement.dataset) && !document.getElementById('app')?.hidden;
        if (drawn) { try { sessionStorage.setItem('test.rows', `${sessionStorage.getItem('test.rows') || ''}${rows},`); } catch { /* no storage */ } }
      };
      window.addEventListener('pageshow', (e) => { if (e.persisted) { Promise.resolve().then(look); setTimeout(look, 0); setTimeout(look, 60); } });
    } });
    await settle(page);
    await page.goto(`${BASE}clients.html#clients`);
    await settle(page);
    const iritRows = await page.locator('#client-list a[href*="client.html?id="]').count();
    await Promise.all([page.waitForURL(/client\.html/), page.locator('#client-list a[href*="client.html?id="]').first().click()]);
    await settle(page);
    await page.click('#btn-logout');
    await page.waitForSelector('#lg-email:visible');
    await signIn(page, 'nadia');
    await settle(page);
    await page.evaluate(() => sessionStorage.removeItem('test.rows'));
    await page.goBack({ waitUntil: 'commit' }); // (a page that is kept whole fires no "load")
    await settle(page);
    assert.equal(await page.innerText('#who-name'), 'נדיה');
    const rows = await page.locator('#client-list a[href*="client.html?id="]').count();
    assert.ok(rows < iritRows, `the list is Nadia's (${rows} of ${iritRows})`);
    const seen = (await page.evaluate(() => sessionStorage.getItem('test.rows') || '')).split(',').filter(Boolean).map(Number);
    assert.ok(seen.every((n) => n < iritRows), `no frame showed the list of the one before (${seen.join(' ')})`);
    await ctx.close();
  });
  await full.close();
} else {
  console.log('skipped - the full browser is not installed here: "back" to a page kept whole was not run');
}

await step('a sign-in asks for who the person is and for the first rows side by side', async () => {
  const fake = makeFake(buildWorld());
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: PHONE });
  await ctx.clock.install({ time: NOW });
  const calls = [];
  await ctx.route(`${SUPA}/**`, async (route) => {
    const u = new URL(route.request().url());
    const call = { name: `${u.pathname.replace('/rest/v1/', '')}${u.search.slice(0, 30)}`, start: Date.now(), end: 0 };
    calls.push(call);
    await new Promise((done) => { setTimeout(done, 250); });
    await fake.route(route);
    call.end = Date.now();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`sign-in: ${e}`));
  watchCsp(page);
  await page.goto(`${BASE}clients.html`);
  await signIn(page, 'ofir');
  await settle(page);
  const of = (re) => calls.find((c) => re.test(c.name));
  const yes = of(/^\/auth\/v1\/token/);
  const staff = of(/^rpc\/is_staff/);
  const person = of(/^staff\?select=person/);
  const rows = of(/^clients\?select=id%2Cname/);
  // The marks: one answer since 20261117100000_speed_pages.sql (docs/ops.md, section 77), the table's pages before it.
  const checks = of(/^(rpc\/protocol_checks_compact|protocol_checks)/);
  for (const c of [staff, person, rows, checks]) {
    assert.ok(c.start >= yes.end - 5, `${c.name} after the server said yes`);
    assert.ok(c.start < staff.end && c.start < person.end, `${c.name} left before "who is this" came back`);
  }
  assert.equal(calls.filter((c) => /^rpc\/is_staff/.test(c.name)).length, 1, 'asked once');
  await ctx.close();
});

assert.deepEqual(errors, [], 'page errors');
await browser.close();
noCspViolations();
console.log(`navigation e2e: ${passed} steps passed`);
