// The employee journey on a phone, role by role, against an in-memory fake of Supabase
// with a realistic office (tests/roles-world.mjs: 21 open clients over the 8 stations,
// late items, a shoot tomorrow, Stav's new deals; Tuesday 20.10.2026, 10:00 in Israel).
// The review of 4.10.2026: every role signs in on a 375px phone and
//  - lands on its own first screen (the owner: "מה דורש אותי"; Irit: the now-bar, the
//    deals, her work; Lior: "החלטות"; Ofir: the quality-control queue; Ilai: his cards;
//    the editors and Nirel: their editing page; Eli: his shoot days; Stav: "עסקה חדשה");
//  - "המשימות שלי" is short: grouped by urgency, a short card per client and process with
//    ONE action, the checklist a tap away, five cards a group and "הצג עוד"; "תצוגה מלאה"
//    gives the whole list and is remembered; nothing is lost (marking works in both);
//  - the page head is tidy: no English eyebrow and only the page's own actions; the other
//    screens are the floating bottom bar (the role's three, with the managers' switch as its
//    first two) and "עוד" for the rest (the redesign of 5.10.2026, app/shell.js); 44px
//    targets, no sideways scroll (375px and 360px);
//  - nobody is offered a screen that is not theirs, and nothing says "מה עליי".
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/roles-phone-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from './roles-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const PHONE = { width: 375, height: 740 };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const worlds = [];
async function open(role, { viewport = PHONE, full = false, prepare = null, calendar = false } = {}) {
  const db = buildWorld();
  if (prepare) prepare(db);
  const fake = makeFake(db);
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: viewport.width < 700, hasTouch: viewport.width < 700 });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  // "היומן שלי" is offered, not connected yet (the fake has no such function otherwise).
  if (calendar) await ctx.route(`${SUPA}/rest/v1/rpc/calendar_feed_status`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: { 'access-control-allow-origin': '*' } }));
  if (full) await ctx.addInitScript(() => { try { localStorage.setItem('astrateg.mine.full', 'on'); } catch { /* no storage */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}clients.html`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  worlds.push(ctx);
  return { page, db, fake, ctx };
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const heightOf = (page) => page.evaluate(() => document.documentElement.scrollHeight);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const pageName = (page) => page.evaluate(() => `${location.pathname.split('/').pop()}${location.hash}`);

// What every screen must keep on a phone. `mineTargets`: also the controls of the short list.
// Ids used in a dialog or a form that appear more than once on the page (a label, a
// focus() or a value read then lands on the wrong control; found live in the weekly call).
const duplicateIds = (page) => page.evaluate(() => {
  const count = new Map();
  for (const el of document.querySelectorAll('[id]')) count.set(el.id, (count.get(el.id) || 0) + 1);
  return [...new Set([...document.querySelectorAll('dialog [id], form [id], dialog[id], form[id]')].map((el) => el.id))].filter((id) => count.get(id) > 1);
});
async function tidy(page, label) {
  assert.ok(await noHScroll(page), `${label}: sideways scroll`);
  assert.deepEqual(await duplicateIds(page), [], `${label}: duplicate ids in dialogs and forms`);
  const r = await page.evaluate(() => {
    const vis = (el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden'; };
    const size = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((el) => ({ t: (el.innerText || el.id).trim().slice(0, 30), h: Math.round(el.getBoundingClientRect().height) }));
    const head = document.querySelector('.page-head .head-actions');
    return {
      // The controls a thumb must hit: the top bar, the switch, the head, the tabs, the short list.
      small: size('header.topbar nav a, header.topbar nav button, #profile-switch, #app-side .side-link, .page-head .head-actions a, .page-head .head-actions button, .tabs [role=tab], #mine-list .wc-go, #mine-list .wc-more, #mine-list .wclient, .more-btn, .view-toggle button, .mine-more > summary, details.wgroup > summary')
        .filter((x) => x.h < 44),
      kicker: size('.kicker.latin').length,
      headRows: head && vis(head) ? Math.round(head.getBoundingClientRect().height) : 0,
      topLinks: size('header.topbar nav .navlink').map((x) => x.t),
      old: /מה עליי/.test(document.body.innerText),
      // The same destination is not offered twice in the head and the switch.
      modeBar: !!document.getElementById('profile-switch'),
      headMine: [...document.querySelectorAll('.page-head .head-actions a')].filter(vis).filter((a) => /clients\.html#mine$/.test(a.href)).length,
    };
  });
  assert.deepEqual(r.small, [], `${label}: targets under 44px`);
  assert.equal(r.kicker, 0, `${label}: the English eyebrow shows on a phone`);
  assert.ok(r.headRows <= 112, `${label}: the page head's buttons take ${r.headRows}px (more than two rows)`);
  assert.deepEqual(r.topLinks, [], `${label}: the top bar repeats the page's name`);
  assert.equal(r.old, false, `${label}: "מה עליי" is on the screen`);
  if (r.modeBar) assert.equal(r.headMine, 0, `${label}: "המשימות שלי" is in the switch and again in the head`);
}

// The short list: groups by urgency, at most five cards a group, one action a card.
async function shortList(page, label) {
  const r = await page.evaluate(() => {
    const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const groups = [...document.querySelectorAll('#mine-list .wgroup')].map((g) => ({
      cls: g.className.replace('wgroup', '').trim(),
      title: g.querySelector('.wgroup-h')?.childNodes[g.querySelector('.wgroup-h .sicon') ? 1 : 0]?.textContent.trim(),
      n: Number(g.querySelector('.wgroup-h .n')?.textContent || 0),
      shown: [...g.querySelectorAll(':scope > .wprocs > .wproc')].filter(vis).length,
      more: g.querySelector('.more-btn')?.innerText || null,
      folded: g.tagName === 'DETAILS' && !g.open,
    }));
    const cards = [...document.querySelectorAll('#mine-list .wproc.wc')].filter(vis).map((c) => ({
      client: c.querySelector('.wclient')?.innerText,
      when: c.querySelector('.wc-when')?.innerText || '',
      actions: [...c.querySelectorAll(':scope > .wc-go, :scope > .wlist .cbx, :scope > .task-start button')].filter(vis).length,
      boxes: [...c.querySelectorAll('.cbx')].filter(vis).length,
      h: Math.round(c.getBoundingClientRect().height),
    }));
    return { groups, cards };
  });
  for (const g of r.groups.filter((x) => /g-(urgent|escalation|overdue|today|tomorrow|week|later|client)/.test(x.cls))) {
    // Five and "הצג עוד"; a group of six shows all six (a button for one card is not worth it).
    assert.ok(g.shown <= 6, `${label}: the group "${g.title}" shows ${g.shown} cards`);
    if (g.n > 6 && !g.folded) assert.match(g.more || '', /^הצג עוד \(\d+\)$/, `${label}: "${g.title}" has no "הצג עוד"`);
  }
  assert.ok(r.cards.length > 0, `${label}: no cards`);
  for (const c of r.cards) {
    assert.equal(c.actions, 1, `${label}: the card of ${c.client} shows ${c.actions} actions`);
    assert.ok(c.boxes <= 1, `${label}: the card of ${c.client} shows its whole checklist`);
    assert.ok(c.h <= 230, `${label}: the card of ${c.client} is ${c.h}px tall`);
  }
  return r;
}

let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// ── Irit ──────────────────────────────────
await step('Irit lands on "המשימות שלי": the now-bar, Stav\'s deals, then her work, short', async () => {
  const { page, db, fake } = await open('irit');
  await page.waitForSelector('#mine-list .wproc.wc');
  await settle(page);
  assert.equal(await pageName(page), 'clients.html#mine');
  assert.equal(await page.getAttribute('#tab-mine', 'aria-selected'), 'true');
  assert.equal(await page.innerText('#tab-mine'), 'המשימות שלי');
  await tidy(page, 'irit');
  // The order of the first screen, and the now-bar inside the first screenful.
  const tops = await page.evaluate(() => ['now-bar', 'deals-card', 'mine-list'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top + scrollY)));
  assert.ok(tops[0] < tops[1] && tops[1] < tops[2], `order: ${tops}`);
  assert.ok(tops[0] < 740, `the now-bar starts at ${tops[0]}px`);
  // The design keeps pink for the screen's one main action: "לקוח חדש". The rows' own actions
  // ("להכנת החוזה", "חיבור ליומן") are the outlined style.
  const pink = await page.evaluate(() => [...document.querySelectorAll('#app .btn-primary')]
    .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && !el.closest('dialog'); }).map((el) => el.id || el.textContent.trim()));
  assert.deepEqual(pink.filter((x) => x !== 'btn-new'), [], `pink actions on Irit's work screen: ${pink}`);
  assert.equal(await page.locator('#deals-card a.btn', { hasText: 'להכנת החוזה' }).first().evaluate((el) => el.classList.contains('btn-primary')), false);
  assert.match(await page.innerText('#deals-card'), /עסקאות חדשות מהשטח \(2\)[^]*להכין חוזה ל־קפה הפינה[^]*להכין חוזה ל־מאפיית השכונה/);
  const list = await shortList(page, 'irit');
  assert.deepEqual(list.groups.filter((g) => /g-(overdue|today|tomorrow)/.test(g.cls)).map((g) => g.title), ['באיחור', 'היום', 'מחר']);
  assert.ok(list.cards.some((c) => /^באיחור \d+ ימי עסקים$/.test(c.when)), 'the deadline in words');
  assert.ok(list.cards.some((c) => /^היום עד \d\d:\d\d$/.test(c.when)));
  const h = await heightOf(page);
  assert.ok(h < 4500, `Irit's first screen is ${h}px tall (it was about 11,900)`);
  await shot(page, 'irit-01-mine-short');

  // One tap marks a single-item card.
  const single = page.locator('#mine-list .wproc.wc > .wlist .cbx').first();
  const key = (await single.getAttribute('id'));
  const before = db.protocol_checks.length;
  await single.click();
  await page.waitForFunction((id) => !document.getElementById(id), key);
  assert.equal(db.protocol_checks.length, before + 1);
  assert.equal(fake.calls.at(-1).table, 'protocol_checks');

  // A card of several items: the list opens with a tap, a mark keeps it open.
  const openBtn = page.locator('#mine-list .wc-open').first();
  const card = page.locator('#mine-list .wproc.wc', { has: page.locator('.wc-open') }).first();
  const cardKey = await card.getAttribute('data-key');
  const sel = `#mine-list .wproc[data-key="${cardKey}"]`;
  assert.equal(await openBtn.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator(`${sel} .wc-panel .cbx`).first().isVisible(), false);
  await openBtn.click();
  assert.equal(await page.getAttribute(`${sel} .wc-open`, 'aria-expanded'), 'true');
  const boxes = await page.locator(`${sel} .wc-panel .cbx`).count();
  assert.ok(boxes >= 2);
  assert.ok(await page.locator(`${sel} .wc-panel .cbx`).first().isVisible());
  assert.ok(await page.locator(`${sel} .wc-panel button:has-text("ממתין ללקוח")`).isVisible(), '"ממתין ללקוח" is in the details');
  await page.locator(`${sel} .wc-panel .cbx`).first().click();
  await page.waitForFunction(([s, n]) => document.querySelectorAll(`${s} .wc-panel .cbx`).length === n - 1, [sel, boxes]);
  assert.equal(await page.getAttribute(`${sel} .wc-open`, 'aria-expanded'), 'true', 'the list stayed open after a mark');
  assert.ok(await page.locator(`${sel} .wc-panel .cbx`).first().isVisible());
  await shot(page, 'irit-02-card-open');

  // "הצג עוד" shows the rest of the group, and a rebuild of the list keeps it.
  const more = page.locator('#mine-list .g-overdue .more-btn');
  const n = Number(/\((\d+)\)/.exec(await more.innerText())[1]);
  await more.click();
  assert.equal(await page.locator('#mine-list .g-overdue > .wprocs > .wproc:visible').count(), 5 + n);
  await page.click('#btn-refresh');
  await settle(page);
  assert.equal(await page.locator('#mine-list .g-overdue .more-btn').count(), 0);
  assert.ok(await noHScroll(page));

  // Her personal profile (7.10.2026): no chooser of whose list, the daily control (process 32) one tap away, no "ביצועים".
  assert.equal(await page.locator('#mine-people').isVisible(), false);
  assert.equal(await page.locator('#mine-select, #mine-people .chip').count(), 0);
  assert.deepEqual(await page.locator('.tabs [role=tab]:visible').allInnerTexts(), ['המשימות שלי', 'לקוחות', 'בקרה יומית']);
  // The other screens: the bottom bar with her daily ones, and the rest of them one tap away.
  assert.deepEqual(await page.locator('#side-list .side-link:visible').allInnerTexts(), ['המשימות שלי', 'לקוחות', 'לפני יום צילום', 'עוד']);
  assert.equal(await page.getAttribute('#side-mine', 'aria-current'), 'page');
  const bar = await page.locator('#app-side').boundingBox();
  assert.ok(bar.y + bar.height <= 740 && bar.y > 600, `the bar floats at the bottom: ${JSON.stringify(bar)}`);
  const toggle = page.locator('#side-more');
  assert.equal(await page.locator('#side-messages').isVisible(), false);
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await page.locator('#side-sheet .side-link:visible').allInnerTexts(), ['הודעות ללקוחות', 'הצעה חדשה והכנת חוזה', 'הצעות שנשלחו']);
  for (const id of ['side-prep', 'side-messages', 'side-quote', 'side-quotes']) {
    assert.ok(await page.locator(`#${id}`).isVisible(), id);
    assert.ok((await page.locator(`#${id}`).boundingBox()).height >= 44, id);
  }
  assert.equal(await page.locator('#side-insights, #side-qa, #side-pass, #side-decisions').count(), 0, 'screens that are not Irit\'s');
  assert.equal(await page.locator('#side-manager, #side-year, #side-shoot, #side-team, #side-gantt').count(), 0, 'the manager profile\'s screens wait behind the button');
  // Nothing of it is repeated in the page head; Escape closes the sheet.
  assert.deepEqual(await page.locator('.page-head .head-actions a:visible').allInnerTexts(), []);
  assert.equal(await page.locator('#cta-owner').isVisible(), false);
  assert.equal(await page.innerText('#profile-switch'), 'מבט מנהל');
  assert.equal(await page.locator('#mode-bar, #mode-manager').count(), 0, 'one switch only');
  await page.keyboard.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#side-messages').isVisible(), false);
  await toggle.click();
  assert.ok(await noHScroll(page));
  await shot(page, 'irit-03-screens-open');
});

await step('"תצוגה מלאה" gives the whole list, is remembered, and "תצוגה קצרה" folds it again', async () => {
  const { page } = await open('irit');
  await page.waitForSelector('#mine-list .wproc.wc');
  const short = await heightOf(page);
  await page.click('#mine-view-on');
  await page.waitForSelector('#mine-list .wproc:not(.wc)');
  assert.equal(await page.locator('#mine-list .wproc.wc').count(), 0);
  assert.equal(await page.locator('#mine-list .more-btn').count(), 0);
  assert.ok(await page.locator('#mine-list .bulk-btn').first().isVisible());
  assert.ok(await page.locator('#mine-tools .wa-link').isVisible(), 'the morning summary is back in its place');
  const full = await heightOf(page);
  assert.ok(full > short * 2, `full ${full}px, short ${short}px`);
  assert.ok(await noHScroll(page));
  await page.reload();
  await page.waitForSelector('#mine-list .wproc:not(.wc)');
  assert.equal(await page.getAttribute('#mine-view-on', 'aria-pressed'), 'true');
  await page.click('#mine-view-off');
  await page.waitForSelector('#mine-list .wproc.wc');
  assert.equal(await page.locator('#mine-tools .wa-link').count(), 0);
  // The morning summary and the notifications are under the list, folded.
  await page.click('.mine-more > summary');
  assert.ok(await page.locator('#mine-foot .wa-link').isVisible());
});

// ── The owner ─────────────────────────────
// Since 6.10.2026 the owner lands on "המשימות שלי" (it was "מה דורש אותי"): four screens in the
// bar and no "עוד"; the manager view is the button at the top; the team's work is at #team.
await step('the owner lands on "המשימות שלי", the team\'s work closed in one line; "מבט מנהל" opens "מה דורש אותי": eight rows and "הצג עוד"; the team\'s work is short too', async () => {
  const { page } = await open('owner');
  await page.waitForSelector('#profile-switch[data-to="manager"]');
  await page.waitForSelector('#team-fold');
  await settle(page);
  assert.match(page.url(), /clients\.html(#mine)?$/);
  await tidy(page, 'owner personal');
  assert.deepEqual(await page.locator('#side-list .side-link:visible').allInnerTexts(), ['המשימות שלי', 'לקוחות', 'הצעה וחוזה', 'הצעות שנשלחו']); // the builder's short name in the bar
  assert.equal(await page.locator('#side-more').count(), 0, 'four screens need no "עוד"');
  assert.equal(await page.locator('#mine-list .wproc').count(), 0, 'the team\'s list is closed');
  const personal = await heightOf(page);
  assert.ok(personal < 3000, `the owner's "המשימות שלי" is ${personal}px tall`);
  await shot(page, 'owner-00-personal');
  await page.click('#profile-switch');
  await page.waitForURL(/owner\.html#now$/);
  await page.waitForSelector('#ow-rows > li');
  await settle(page);
  assert.equal(await page.innerText('h1'), 'מה דורש אותי');
  await tidy(page, 'owner');
  assert.equal(await page.locator('#ow-rows > li:not(.more-row):visible').count(), 8);
  assert.match(await page.innerText('#ow-rows .more-btn'), /^הצג עוד \(\d+\)$/);
  assert.ok(await heightOf(page) < 2900); // eight rows, the week's chart under them, and the room of the bottom bar
  await shot(page, 'owner-01-now');
  assert.equal(await page.innerText('#profile-switch'), 'חזרה למשימות שלי');
  await page.goto(`${BASE}clients.html#team`);
  await page.waitForSelector('#mine-list .wproc.wc');
  await settle(page);
  assert.equal(await page.innerText('#tab-mine'), 'עבודת הצוות');
  await tidy(page, 'owner team work');
  await shortList(page, 'owner team work');
  const h = await heightOf(page);
  assert.ok(h < 6500, `the team's work is ${h}px tall (it was about 34,000)`);
  await shot(page, 'owner-02-team-work-short');
});

// ── Lior ──────────────────────────────────
// Since 6.10.2026 Lior lands on "המשימות שלי" (it was "החלטות"), with "החלטות" in his bar.
await step('Lior lands on "המשימות שלי"; "החלטות" is in his bar: his queues, each five long; his own work is short', async () => {
  const { page } = await open('lior');
  await page.waitForSelector('#profile-switch[data-to="manager"]');
  await page.waitForSelector('#mine-list .wproc.wc');
  assert.match(page.url(), /clients\.html(#mine)?$/);
  assert.deepEqual(await page.locator('#side-list .side-link:visible').allInnerTexts(), ['המשימות שלי', 'לקוחות', 'החלטות', 'עוד']);
  await page.click('#side-decisions');
  await page.waitForURL(/decisions\.html/);
  await page.waitForSelector('#ls-list > li');
  await settle(page);
  assert.equal(await page.innerText('h1'), 'החלטות');
  await tidy(page, 'lior');
  assert.equal(await page.locator('#mode-bar').count(), 0); // his switch is the button at the top
  assert.equal(await page.innerText('#profile-switch'), 'מבט מנהל');
  assert.equal(await page.locator('#ls-list > li:not(.more-row):visible').count(), 5);
  assert.match(await page.innerText('#ls-list .more-btn'), /^הצג עוד \(\d+\)$/);
  assert.ok(Number(await page.innerText('#ls-n')) > 6, 'the count stays whole');
  const h = await heightOf(page);
  assert.ok(h < 4500, `"החלטות" is ${h}px tall (it was about 9,900)`);
  await shot(page, 'lior-01-decisions');
  await page.goto(`${BASE}clients.html#mine`);
  await page.waitForSelector('#mine-list .wproc.wc');
  await settle(page);
  await tidy(page, 'lior mine');
  const list = await shortList(page, 'lior mine');
  assert.deepEqual(list.groups.slice(0, 2).map((g) => g.title), ['דחוף', 'חריגות שדווחו']);
  assert.ok(await heightOf(page) < 5500);
  // An urgent task: "התחלתי" is the one action.
  assert.ok(await page.locator('#mine-list .g-urgent .wproc.wc > .task-start button:has-text("התחלתי")').isVisible());
  await shot(page, 'lior-02-mine-short');
});

// ── Ofir ──────────────────────────────────
// Since 6.10.2026 Ofir lands on "המשימות שלי" (it was the queue), with the queue and the pass in his bar.
await step('Ofir lands on "המשימות שלי"; the quality-control queue is in his bar; nothing is repeated in the head; his pass is short', async () => {
  const { page } = await open('ofir');
  await page.waitForSelector('#profile-switch[data-to="manager"]');
  await page.waitForSelector('#mine-list .wproc.wc');
  assert.match(page.url(), /clients\.html(#mine)?$/);
  assert.deepEqual(await page.locator('#side-list .side-link:visible').allInnerTexts(), ['המשימות שלי', 'לקוחות', 'בקרה ושיוך', 'מעבר על הלקוחות']);
  await page.click('#side-qa');
  await page.waitForURL(/qa\.html/);
  await page.waitForSelector('#profile-switch');
  await settle(page);
  assert.equal(await page.innerText('h1'), 'בקרה ושיוך');
  await tidy(page, 'ofir');
  await shot(page, 'ofir-01-qa');
  await page.goto(`${BASE}pass.html`);
  await page.waitForSelector('#ps-list > li');
  await settle(page);
  await tidy(page, 'ofir pass');
  assert.equal(await page.locator('#ps-list > li:not(.more-row):visible').count(), 6);
  const ph = await heightOf(page);
  // (A client is named "business · contact" since 6.10.2026: long names wrap to a second line.)
  // (7.10.2026: a stuck client shows how long it has been open and three ways out instead of two buttons, tests/office-flows-e2e.mjs: 8,200 became 8,400.)
  assert.ok(ph < 8400, `the pass is ${ph}px tall (it was about 10,300)`);
  await page.goto(`${BASE}clients.html#mine`);
  await page.waitForSelector('#mine-list .wproc.wc');
  await settle(page);
  await tidy(page, 'ofir mine');
  await shortList(page, 'ofir mine');
  assert.ok(await heightOf(page) < 4000);
  await shot(page, 'ofir-02-mine-short');
});

// ── Ilai ──────────────────────────────────
await step('Ilai stays on "המשימות שלי": his cards first, the draft month folded, only his screens', async () => {
  const { page } = await open('ilai');
  await page.waitForSelector('#mine-list .g-ilai');
  await settle(page);
  assert.equal(await pageName(page), 'clients.html#mine');
  assert.equal(await page.innerText('h1'), 'שלום עילאי');
  assert.equal(await page.innerText('#mine-list .g-soon .wgroup-h'), 'בקרוב · עוד אין מה לסמן\n' + await page.innerText('#mine-list .g-soon .wgroup-h .n'));
  await tidy(page, 'ilai');
  assert.deepEqual(await page.locator('.tabs [role=tab]:visible').allInnerTexts(), ['המשימות שלי', 'הלקוחות שלי', 'הנתונים שלי']);
  for (const id of ['btn-new', 'cta-owner', 'cta-messages', 'cta-prep', 'tab-control']) assert.equal(await page.locator(`#${id}`).isVisible(), false, id);
  // The draft monthly cycle waits folded; his cards are the first thing in the list.
  assert.equal(await page.locator('#my-months details.mc-fold').getAttribute('open'), null);
  assert.ok(await page.locator('#mine-list .g-ilai .il-list > li:visible').count() <= 6);
  // "לקוחות שלא מחוברים ל־Metricool" (section 33): none of this office's 21 clients has a brand
  // yet, so the card shows its first eight (about 650px, gone once they are connected).
  // One line until opened: the rows are not on the page, and his work stays first.
  assert.equal(await page.locator('#metricool-card .mcn-row').count(), 0);
  assert.equal(await page.getAttribute('#mcn-toggle', 'aria-expanded'), 'false');
  const tall = await heightOf(page);
  assert.ok(tall < 4300, `Ilai's page is ${tall}px tall (3,500 before the Metricool card)`);
  await shot(page, 'ilai-01-mine-short');
});

// ── The editors and Nirel ─────────────────
for (const [role, title] of [['nadia', 'הלקוחות שלי בעריכה'], ['nirel', 'העריכה והבריפים שלי']]) {
  await step(`${role} lands on the editing page and is offered only her own screens`, async () => {
    const { page } = await open(role);
    await page.waitForURL(/editor\.html/);
    await settle(page);
    assert.equal(await page.innerText('h1'), title);
    await tidy(page, role);
    await shot(page, `${role}-01-editor`);
    await page.goto(`${BASE}clients.html#mine`);
    await page.waitForSelector('#view-mine:not([hidden])');
    await settle(page);
    await tidy(page, `${role} mine`);
    assert.deepEqual(await page.locator('.tabs [role=tab]:visible').allInnerTexts(), ['המשימות שלי', 'הלקוחות שלי', 'הנתונים שלי']);
    // Her screens are the bar; the head does not repeat them.
    assert.deepEqual(await page.locator('.page-head .head-actions a:visible').allInnerTexts(), []);
    // (Four screens all fit since 6.10.2026: "הצעות שנשלחו" is the owners' and Irit's, so there is no "עוד".)
    assert.deepEqual(await page.locator('#side-list .side-link:visible').allInnerTexts(), ['המשימות שלי', 'הלקוחות שלי', 'הלקוחות שלי בעריכה', 'הצעה וחוזה']);
    assert.equal(await page.locator('#side-more, #side-quotes').count(), 0);
    assert.ok(await heightOf(page) < 1500);
  });
}

// ── Eli ───────────────────────────────────
await step('Eli lands on "ימי הצילום שלי", with tomorrow\'s shoots', async () => {
  const { page } = await open('eli');
  await page.waitForURL(/shoot\.html/);
  await settle(page);
  assert.equal(await page.innerText('h1'), 'ימי הצילום שלי');
  await tidy(page, 'eli');
  assert.match(await page.innerText('main'), /עומר דיין[^]*טל אורן|טל אורן[^]*עומר דיין/);
  await shot(page, 'eli-01-shoot-days');
  await page.goto(`${BASE}clients.html#mine`);
  await page.waitForSelector('#view-mine:not([hidden])');
  await settle(page);
  await tidy(page, 'eli mine');
  assert.deepEqual(await page.locator('.page-head .head-actions a:visible').allInnerTexts(), []);
  // (Four screens all fit since 6.10.2026: no "הצעות שנשלחו" for Eli, so no "עוד".)
  assert.deepEqual(await page.locator('#side-list .side-link:visible').allInnerTexts(), ['המשימות שלי', 'הלקוחות שלי', 'ימי צילום', 'הצעה וחוזה']);
});

// ── Stav ──────────────────────────────────
await step('Stav lands on "עסקה חדשה", sees his deals, and is offered no other screen', async () => {
  const { page } = await open('stav');
  await page.waitForURL(/deal\.html/);
  await settle(page);
  assert.equal(await page.innerText('h1'), 'עסקה חדשה');
  await tidy(page, 'stav');
  assert.match(await page.innerText('main'), /העסקאות שלי[^]*מאפיית השכונה[^]*ממתין לחוזה[^]*סלון יופי לילך[^]*חוזה נשלח/);
  assert.equal(await page.locator('.page-head .head-actions a:visible, header.topbar nav a:visible').count(), 0);
  // One screen needs no bar.
  assert.equal(await page.locator('#app-side').isVisible(), false);
  assert.equal(await page.locator('#app-side .side-link').count(), 1);
  assert.ok((await page.locator('#deal-submit, .deal-submit').first().boundingBox()).height >= 44);
  await shot(page, 'stav-01-deal');
  await page.goto(`${BASE}clients.html#mine`);
  await page.waitForURL(/deal\.html/);
});

// ── The first screen is the work (the simplicity pass of 6.10.2026) ──
// Found on the live site with 39 imported clients: on a phone the person's work began
// a full screen down, under the giver's card, "ההתראות חסומות", "היומן שלי" and a box
// of 41 notes about clients the system itself had imported.
const firstTop = (page, sel) => page.evaluate((s) => { const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().height > 0); return el ? Math.round(el.getBoundingClientRect().top + scrollY) : null; }, sel);
const boxOf = async (page, sel) => { const b = await page.locator(sel).boundingBox(); return b ? Math.round(b.height) : 0; };
// A batch import: written by the system itself, no agreement, the history marked "ייבוא".
const imported = (db) => { for (const c of db.clients) { c.created_by_email = 'system'; c.quote_id = null; } };

await step('Irit: imported clients are not news, the setup cards are one line each, and one plain heading', async () => {
  const { page } = await open('irit', { viewport: { width: 390, height: 844 }, prepare: imported, calendar: true });
  await page.waitForSelector('#mine-list .wproc.wc');
  await page.waitForSelector('#cal-card:not([hidden])');
  await settle(page);
  assert.equal(await page.innerText('h1'), 'שלום עירית');
  // No "לקוח חדש נפתח אוטומטית … ועוד 38", and no "חדש" tag on an imported client, here or in the list.
  assert.equal(await page.locator('.auto-banner').count(), 0);
  assert.equal(await page.locator('#mine-list .auto-tag').count(), 0);
  assert.doesNotMatch(await page.innerText('#view-mine'), /נפתח אוטומטית/);
  // The giver's card: one row with "שליחת נודניק"; the form opens on demand.
  assert.ok(await boxOf(page, '#staff-tasks-card') <= 84, `the giver's card is ${await boxOf(page, '#staff-tasks-card')}px`);
  assert.equal(await page.innerText('#st-new'), 'שליחת נודניק');
  assert.equal(await page.locator('#st-form').count(), 0);
  // Blocked notifications (the test browser blocks them) and the calendar: a line each, the text a tap away.
  assert.equal(await page.getAttribute('#push-card', 'data-state'), 'blocked');
  assert.ok(await boxOf(page, '#push-card') <= 56, `the notifications card is ${await boxOf(page, '#push-card')}px`);
  assert.ok(await boxOf(page, '#cal-card') <= 56, `the calendar card is ${await boxOf(page, '#cal-card')}px`);
  assert.equal(await page.locator('#push-card p:visible, #cal-card p:visible, #cal-make:visible').count(), 0);
  for (const sel of ['#push-card summary', '#cal-card summary']) assert.ok(await boxOf(page, sel) >= 44, sel);
  await page.click('#push-card summary');
  assert.match(await page.innerText('#push-card'), /ההתראות חסומות[^]*לאפשר/);
  await page.click('#cal-card summary');
  assert.ok(await page.locator('#cal-make').isVisible());
  assert.ok((await page.locator('#cal-make').boundingBox()).height >= 44);
  await page.click('#push-card summary');
  await page.click('#cal-card summary');
  // The three cards together take less room than one of them did.
  const used = await boxOf(page, '#staff-tasks-card') + await boxOf(page, '#push-card') + await boxOf(page, '#cal-card');
  assert.ok(used <= 190, `the giver's row and the two setup lines take ${used}px`);
  await tidy(page, 'irit first screen');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#view-mine a, #view-mine button, #view-mine summary, #view-mine select')]
    .filter((el) => { const b = el.getBoundingClientRect(); return b.height > 0 && b.height < 43.5; }).map((el) => `${el.innerText.trim().slice(0, 20)}:${Math.round(el.getBoundingClientRect().height)}`)), [], 'targets under 44px in "המשימות שלי"');
  await shot(page, 'irit-03-first-screen');
  // The clients list: no "חדש · נפתח אוטומטית מהסכם" on an imported client, and a 44px search box.
  await page.click('#tab-clients');
  await page.waitForSelector('#client-list .crow');
  assert.equal(await page.locator('#client-list .auto-tag').count(), 0);
  assert.ok(await boxOf(page, '#client-search') >= 44);
});

await step('Ilai and an editor: the first card of work is on the first screen of a phone', async () => {
  const ilai = await open('ilai', { viewport: { width: 390, height: 844 }, calendar: true });
  await ilai.page.waitForSelector('#mine-list .g-ilai');
  await ilai.page.waitForSelector('#cal-card:not([hidden])');
  await settle(ilai.page);
  const top = await firstTop(ilai.page, '#mine-list .il-list > li');
  assert.ok(top !== null && top < 560, `Ilai's first card starts at ${top}px (it was about 690)`);
  assert.match(await ilai.page.innerText('#mine-list .il-list > li >> nth=0'), /מוכן לבדיקה/);
  const nadia = await open('nadia', { viewport: { width: 390, height: 844 }, calendar: true });
  await nadia.page.goto(`${BASE}clients.html#mine`);
  await nadia.page.waitForSelector('#mine-list .wproc');
  await nadia.page.waitForSelector('#cal-card:not([hidden])');
  await settle(nadia.page);
  assert.equal(await nadia.page.innerText('h1'), 'שלום נדיה');
  const ntop = await firstTop(nadia.page, '#mine-list .wproc');
  assert.ok(ntop !== null && ntop < 560, `Nadia's first card starts at ${ntop}px (it was about 660)`);
  // She gives no tasks and has none: no card at all.
  assert.equal(await nadia.page.locator('#staff-tasks-card').isVisible(), false);
});

await step('Lior, Ofir and the owner: the same heading rule, and a list of several items opens with "הצגת הפריטים"', async () => {
  for (const [role, title] of [['lior', 'שלום ליאור'], ['ofir', 'שלום אופיר'], ['owner', 'לקוחות ומשימות']]) {
    const { page } = await open(role);
    await page.goto(`${BASE}clients.html#mine`);
    // (The owner's "המשימות שלי" holds the team's work closed in one line since 6.10.2026.)
    await page.waitForSelector(role === 'owner' ? '#team-fold' : '#mine-list .wproc.wc');
    await settle(page);
    assert.equal(await page.innerText('h1'), title, role);
    assert.doesNotMatch(await page.innerText('#view-mine'), /פתיחת הרשימה|עוד לא לסימון/, role);
    if (role === 'lior') assert.match(await page.locator('#mine-list .wc-open').first().innerText(), /^הצגת הפריטים \(\d+\)$/);
  }
});

// ── 360px and a wide screen ───────────────
await step('at 360px nothing scrolls sideways, on Irit\'s list and with a card open', async () => {
  const { page } = await open('irit', { viewport: { width: 360, height: 720 } });
  await page.waitForSelector('#mine-list .wproc.wc');
  await settle(page);
  await tidy(page, 'irit 360');
  await page.locator('#mine-list .wc-open').first().click();
  await page.click('#side-more');
  assert.ok(await noHScroll(page));
});

await step('on a wide screen the screens are the side menu, with a rail on the current one, and the list is short as well', async () => {
  const { page } = await open('irit', { viewport: { width: 1280, height: 900 } });
  await page.waitForSelector('#mine-list .wproc.wc');
  await settle(page);
  assert.equal(await page.locator('#side-more').isVisible(), false);
  assert.deepEqual(await page.locator('#side-list .side-link:visible').allInnerTexts(),
    // Her personal profile: her six daily screens (PERSONAL in app/shell-rules.js, 7.10.2026).
    ['המשימות שלי', 'לקוחות', 'לפני יום צילום', 'הודעות ללקוחות', 'הצעה חדשה והכנת חוזה', 'הצעות שנשלחו']);
  assert.equal(await page.locator('#mine-people').isVisible(), false);
  for (const id of ['cta-messages', 'cta-prep', 'cta-year']) assert.equal(await page.locator(`#${id}`).isVisible(), false, `${id} is in the menu, not in the head`);
  // The side menu floats beside the page (on the right, RTL), and the rail marks "המשימות שלי".
  const side = await page.locator('#app-side').boundingBox();
  const main = await page.locator('main').boundingBox();
  assert.ok(side.x > main.x + main.width - 1 && side.width > 200, JSON.stringify([side, main]));
  const rail = await page.locator('#side-rail').boundingBox();
  const cur = await page.locator('#side-mine').boundingBox();
  assert.ok(rail.y >= cur.y && rail.y + rail.height <= cur.y + cur.height + 1, 'the rail is on the current item');
  assert.equal(await page.locator('#who-name').innerText(), 'עירית');
  assert.ok(await page.locator('.kicker.latin').isVisible());
  await shortList(page, 'irit wide');
});

assert.deepEqual(errors, [], 'page errors');
await browser.close();
noCspViolations();
console.log(`roles on a phone e2e: ${passed} steps passed`);
