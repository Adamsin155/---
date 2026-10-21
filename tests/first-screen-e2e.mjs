// docs/ops.md, section 59, in the browser: the first screen and the taps, on a phone,
// against the office at the size of the live one (tests/perf-world.mjs). These are the
// things that made the screen fast and could silently come back, or that the speed-up
// could silently break:
//   A  the marks of every client arrive whole, their pages asked for together (and page
//      after page, as before, from a database that does not say how many rows there are);
//   B  what does not wait for the clients is asked for with them, not in a round after them;
//   C  the first screen of Ilai is built a few times, not once per client's files;
//   D  the number on the "באיחור" tab is right when the page is shown, and is the number
//      of the group and of the opened tab;
//   E  a tab that was built is kept (the same nodes come back), and never past a change:
//      a mark made in one tab is not undone by going back to another;
//   F  the list of notifications opens before the database answers, and takes in what
//      the answer brings;
//   G  the search finds a client that the list has not shown yet.
// Speed itself is not asserted here (tests/perf-local.mjs prints it): only what causes it.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/first-screen-e2e.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, makeFake } from './roles-world.mjs';
import { buildBigWorld } from './perf-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { clientState } from '../app/protocol-logic.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(300); };
const tableOf = (url) => new URL(url).pathname.replace('/rest/v1/', '').replace('/auth/v1/', 'auth/');

// A phone, signed in. `slow`: { table: ms } an answer of that table waits; `count`: false
// for a database that does not say how many rows a query has. `log`: every request to
// the database, with when it left and when it was answered (ms since the sign-in tap).
async function signedIn(role, { db = buildBigWorld(), slow = {}, count = true, init = null } = {}) {
  const fake = makeFake(db);
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.clock.install({ time: NOW });
  const log = [];
  let t0 = Date.now();
  await ctx.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    const row = { table: tableOf(req.url()), method: req.method(), url: req.url(), start: Date.now() - t0, end: null };
    if (req.method() !== 'OPTIONS') log.push(row);
    if (slow[row.table]) await new Promise((done) => { setTimeout(done, slow[row.table]); });
    // Without `Prefer: count=exact` the fake answers as a database that gives no count.
    const plain = count ? route : {
      request: () => ({ url: () => req.url(), method: () => req.method(), postData: () => req.postData(), headers: () => { const h = { ...req.headers() }; delete h.prefer; return h; } }),
      fulfill: (o) => route.fulfill(o), continue: (...a) => route.continue(...a), abort: (...a) => route.abort(...a), fallback: (...a) => route.fallback(...a),
    };
    await fake.route(plain);
    row.end = Date.now() - t0;
  });
  const page = await ctx.newPage();
  watchCsp(page);
  if (init) await page.addInitScript(init);
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}clients.html#mine`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  t0 = Date.now();
  await page.click('#lg-submit');
  await page.waitForFunction(() => !('boot' in document.documentElement.dataset) && !document.getElementById('view-mine').hidden);
  // What the page showed at the moment it was shown, before anything else could run.
  const atShow = await page.evaluate(() => ({ late: document.getElementById('tab-late-n').textContent, lateHidden: document.getElementById('tab-late').hidden }));
  await settle(page);
  return { page, ctx, db, fake, log, slow, atShow };
}
const tabTo = async (page, t) => { await page.locator(`#tab-${t}`).tap(); await page.waitForFunction((v) => document.getElementById(`tab-${v}`).getAttribute('aria-selected') === 'true', t); };

// KEEP_GOING=1: every step runs and the failed ones are listed (to see what an older build fails).
let passed = 0;
const failed = [];
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) {
    console.log(`not ok - ${name}`);
    if (!process.env.KEEP_GOING) throw e;
    failed.push(name);
    console.log(`   ${String(e.message).split('\n')[0].slice(0, 200)}`);
  }
}

try {
  // ── A ──
  // The client whose marks are on the last page (the marks come ordered by client).
  const lastClient = (db) => db.clients.filter((c) => c.status === 'active').sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  const progressOf = (db, c) => {
    const checks = Object.fromEntries(db.protocol_checks.filter((r) => r.client_id === c.id).map((r) => [r.item_key, r]));
    const s = clientState(c, checks, NOW);
    return `${s.procsDone}/${s.procsTotal}`;
  };
  const shownProgress = async (page, c) => {
    await tabTo(page, 'clients');
    await page.fill('#client-search', c.business);
    await page.waitForFunction(() => document.querySelectorAll('#client-list .clist > li:not([hidden])').length === 1);
    return (await page.locator('#client-list .crow .cprog .num').innerText()).trim();
  };
  // Peak number of the pages that were on their way at the same moment.
  const peak = (rows) => Math.max(0, ...rows.map((r) => rows.filter((x) => x.start <= r.start && x.end > r.start).length));
  for (const count of [true, false]) {
    await step(`A: the marks of every client arrive whole, ${count ? 'their pages asked for together' : 'page after page from a database that gives no count'}`, async () => {
      const { page, ctx, db, log } = await signedIn('irit', { count, slow: { protocol_checks: 120 } });
      const total = db.protocol_checks.length;
      assert.ok(total > 3000, `the world is big enough to need several pages (${total} marks)`);
      const pages = log.filter((r) => r.table === 'protocol_checks' && r.method === 'GET' && !/client_id=eq\./.test(r.url) && /offset=/.test(r.url));
      // Every reader of the whole table (the list; a card that reads them for itself) asks for each page once.
      const readers = pages.filter((r) => /offset=0(&|$)/.test(r.url)).length;
      assert.equal(pages.length, readers * Math.ceil((total + 1) / 1000), 'each page is asked for once, and none twice');
      const c = lastClient(db);
      assert.equal(await shownProgress(page, c), progressOf(db, c), 'the client on the last page of marks shows all of its marks');
      const mine = pages.filter((r) => r.start <= pages.find((x) => /offset=0(&|$)/.test(x.url)).start + 5000);
      if (count) assert.ok(peak(mine) >= 3, `the pages after the first are on their way together (peak ${peak(mine)})`);
      await ctx.close();
    });
  }

  // ── B ──
  await step('B: the reviews, the summaries, the history, the questions and the cards do not wait for the marks', async () => {
    const { ctx, log } = await signedIn('irit', { slow: { protocol_checks: 500 } });
    const firstMarks = log.find((r) => r.table === 'protocol_checks' && /offset=0(&|$)/.test(r.url));
    for (const table of ['office_reviews', 'client_status_notes', 'protocol_log']) {
      const r = log.find((x) => x.table === table && x.method === 'GET');
      assert.ok(r, `${table} is asked for`);
      assert.ok(r.start < firstMarks.end, `${table} is asked for while the marks are on their way (${r.start} ms; the marks answered at ${firstMarks.end})`);
    }
    // The deals' card has just read its rows: the first load does not read them again.
    assert.equal(log.filter((r) => r.table === 'deal_requests' && /status=eq\.pending/.test(r.url)).length <= 1, true, 'the pending deals are read once while the page opens');
    await ctx.close();
  });

  // ── C ──
  await step('C: Ilai\'s first screen is built a few times, not once per client\'s files', async () => {
    const init = () => {
      window.__draws = 0;
      new MutationObserver((recs) => { if (recs.some((r) => r.target.id === 'mine-list' && r.addedNodes.length)) window.__draws += 1; })
        .observe(document, { childList: true, subtree: true });
    };
    const { page, ctx, log } = await signedIn('ilai', { init });
    const blocks = await page.locator('#mine-list .fl-work').count();
    const reads = log.filter((r) => r.table === 'client_files').length;
    assert.ok(blocks >= 8 && reads >= 8, `the world gives Ilai many file blocks (${blocks} blocks, ${reads} reads)`);
    const draws = await page.evaluate(() => window.__draws);
    console.log(`   (built ${draws} times; ${blocks} file blocks, ${reads} reads of files)`);
    assert.ok(draws <= 5, `the list was built ${draws} times while the page opened (it was once per client: ${reads} and more)`);
    // Each block shows its own files (none is left "loading").
    assert.equal(await page.locator('#mine-list .fl-work .fl-status:not([hidden])').count(), 0);
    await ctx.close();
  });

  // ── D ──
  for (const role of ['irit', 'lior', 'ofir']) {
    await step(`D: ${role}: the number of "באיחור" is right when the page is shown`, async () => {
      const { page, ctx, atShow } = await signedIn(role);
      assert.equal(atShow.lateHidden, false, 'the tab is there');
      const n = Number(atShow.late);
      assert.ok(n > 0, `something is late in this world (${atShow.late})`);
      assert.equal(await page.locator('#tab-late-n').innerText(), String(n), 'it did not change after the page was shown');
      // More than three: one line to the tab carries the number (the owner, 20.10.2026); else the group's heading.
      if (n > 3) assert.equal(await page.locator('#late-line .k-num').getAttribute('data-n'), String(n), 'the late line says the same number');
      else assert.equal(await page.locator('#mine-list .g-overdue .wgroup-h .n').innerText(), String(n), 'the group of the list says the same number');
      await tabTo(page, 'late');
      assert.match(await page.locator('#late-h').innerText(), new RegExp(n === 1 ? 'דבר אחד באיחור' : `^${n} דברים באיחור`));
      // Ofir's processes of one client, Lior's drives of one shoot day: one card listing them (the owner, 20.10.2026).
      const listed = await page.locator('#mine-list .late-list > li').evaluateAll((els) => els.reduce((k, el) => k + (el.matches('.wc-joined') ? el.querySelectorAll(':scope > .wc-subs > li').length : el.matches('.wc-drives') ? el.querySelectorAll('.wlist > li').length : 1), 0));
      assert.equal(listed, n, 'and the opened tab lists that many');
      await ctx.close();
    });
  }

  // ── E ──
  await step('E: a built tab is kept: the same nodes come back, and the pressed tab is marked at once', async () => {
    const { page, ctx } = await signedIn('irit');
    await page.evaluate(() => { window.__mine = document.querySelector('#mine-list .wproc'); window.__foot = document.querySelector('#mine-foot').firstElementChild; });
    await tabTo(page, 'clients');
    assert.equal(await page.locator('#view-mine').isHidden(), true);
    await page.evaluate(() => { window.__client = document.querySelector('#client-list .crow'); });
    await tabTo(page, 'mine');
    assert.equal(await page.evaluate(() => window.__mine.isConnected && document.querySelector('#mine-list .wproc') === window.__mine), true, '"המשימות שלי" was not built again');
    await tabTo(page, 'late');
    assert.equal(await page.evaluate(() => window.__mine.isConnected), false, '"באיחור" shows its own list in the same panel');
    await page.evaluate(() => { window.__late = document.querySelector('#mine-list .late-list > li'); });
    assert.equal(await page.locator('#mine-foot').evaluate((el) => el.children.length), 0, 'with the list alone');
    await tabTo(page, 'mine');
    assert.equal(await page.evaluate(() => window.__mine.isConnected && document.querySelector('#mine-list .wproc') === window.__mine && document.querySelector('#mine-foot').firstElementChild === window.__foot), true, 'the list that was put aside is put back, whole');
    assert.equal(await page.locator('#view-mine').evaluate((el) => el.classList.contains('is-late')), false);
    await tabTo(page, 'late');
    assert.equal(await page.evaluate(() => window.__late.isConnected && document.querySelector('#mine-list .late-list > li') === window.__late), true, 'and so is "באיחור"');
    await tabTo(page, 'clients');
    assert.equal(await page.evaluate(() => window.__client.isConnected), true, 'the clients were not built again');
    assert.equal(new URL(page.url()).hash, '#clients');
    await ctx.close();
  });

  await step('E: a mark made in one tab is not undone by a tab that was built before it', async () => {
    const { page, ctx, fake } = await signedIn('irit');
    const before = Number(await page.locator('#tab-late-n').innerText());
    await tabTo(page, 'late'); // "המשימות שלי" is put aside, built
    // A late item that is marked with one tap, right in the list.
    const box = page.locator('#mine-list .late-list .cbx:not(:disabled):visible').first();
    const id = await box.getAttribute('id');
    await box.tap();
    await page.waitForFunction(() => /סומן כבוצע/.test(document.getElementById('toast').textContent));
    assert.equal(fake.calls.some((c) => c.table === 'protocol_checks' && c.method === 'POST'), true, 'the mark was written');
    await page.waitForFunction((i) => !document.getElementById(i), id);
    await tabTo(page, 'mine');
    assert.equal(await page.locator(`#${id}`).count(), 0, 'the list that was put aside before the mark did not come back with the marked item');
    const after = await page.locator('#tab-late-n').innerText();
    assert.ok(Number(after || 0) <= before, 'the number on the tab did not go back up');
    // The group's heading, or (more than three, the owner's 20.10.2026) the one line to the tab.
    const groupN = await page.locator('#late-line').count() ? await page.locator('#late-line .k-num').getAttribute('data-n')
      : await page.locator('#mine-list .g-overdue .wgroup-h .n').count() ? await page.locator('#mine-list .g-overdue .wgroup-h .n').innerText() : '';
    assert.equal(groupN, after, "and the group says the tab's number");
    // The clients, built now, show the mark as well; and going back builds nothing stale.
    await tabTo(page, 'clients');
    await tabTo(page, 'mine');
    assert.equal(await page.locator(`#${id}`).count(), 0);
    await ctx.close();
  });

  await step('E: a refresh builds the tabs again from the new rows', async () => {
    const { page, ctx } = await signedIn('irit');
    await page.evaluate(() => { window.__mine = document.querySelector('#mine-list .wproc'); });
    await tabTo(page, 'clients');
    await page.locator('#btn-refresh').tap();
    await settle(page);
    await tabTo(page, 'mine');
    assert.equal(await page.evaluate(() => window.__mine.isConnected), false, 'after a refresh "המשימות שלי" is built from the new rows');
    await ctx.close();
  });

  // ── F ──
  await step('F: the list of notifications opens before the database answers, then takes in what the answer brings', async () => {
    const { page, ctx, db, slow } = await signedIn('irit');
    const shown = Number(await page.locator('#btn-inbox .n').innerText());
    assert.ok(shown > 0, 'there are new notifications in this world');
    // From now on the database is slow, and one more reminder has arrived meanwhile.
    slow.reminder_log = 1500;
    db.reminder_log.push({ ...db.reminder_log.find((r) => r.person === 'irit'), id: 9999, key: 'perf:new', title: 'חדש לגמרי: נכנס בזמן שהרשימה נפתחה', created_at: new Date(NOW.getTime() + 5000).toISOString(), read_at: null });
    const t = Date.now();
    await page.locator('#btn-inbox').tap();
    await page.waitForSelector('#dlg-inbox[open] .inbox-row', { timeout: 1000 });
    const took = Date.now() - t;
    assert.ok(took < 1000, `the list is open with its rows before the answer (${took} ms; the answer takes 1500)`);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'inbox-h');
    const rows = await page.locator('#inbox-list .inbox-row').count();
    assert.ok(rows >= shown);
    assert.equal(await page.locator('#inbox-list .inbox-title', { hasText: 'חדש לגמרי' }).count(), 0, 'the new one is not known yet');
    await page.waitForSelector('#inbox-list .inbox-title:has-text("חדש לגמרי")', { timeout: 5000 });
    assert.equal(await page.locator('#inbox-list .inbox-row').count(), rows + 1, 'the answer added the new reminder');
    assert.equal(await page.locator('#btn-inbox .n').innerText(), String(shown + 1));
    await ctx.close();
  });

  // ── G ──
  await step('G: the search finds a client that the list has not shown yet', async () => {
    const { page, ctx } = await signedIn('irit');
    await tabTo(page, 'clients');
    const hidden = page.locator('#client-list .clist > li[hidden]');
    assert.ok(await hidden.count() > 5, 'the long list shows its first rows and "הצג עוד"');
    const name = (await hidden.last().locator('.cname strong').textContent()).trim();
    await page.fill('#client-search', name.split(' · ')[0]);
    await page.waitForFunction((n) => [...document.querySelectorAll('#client-list .clist > li:not([hidden]) .cname strong')].some((e) => e.textContent.trim() === n), name);
    // And a filter counts every client, shown or not.
    await page.fill('#client-search', '');
    await page.locator('#client-filters .chip', { hasText: 'עם איחור' }).tap();
    await page.waitForFunction(() => document.querySelector('#client-filters .chip[aria-pressed="true"]')?.textContent.includes('עם איחור'));
    // Every client of "עם איחור", the ones behind "הצג עוד" too, has something late.
    await page.waitForFunction(() => { const rows = [...document.querySelectorAll('#client-list .clist > li:not(.more-row)')]; return rows.length > 12 && rows.every((li) => li.querySelector('.s-overdue')); });
    await ctx.close();
  });

  assert.deepEqual(failed, [], 'every step passed');
  assert.deepEqual(errors, [], 'no page errors');
  noCspViolations();
  console.log(`\nfirst-screen-e2e: ${passed} steps passed`);
} finally {
  await browser.close();
}
