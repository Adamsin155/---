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
async function open(role, { viewport = PHONE, full = false } = {}) {
  const db = buildWorld();
  const fake = makeFake(db);
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: viewport.width < 700, hasTouch: viewport.width < 700 });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  if (full) await ctx.addInitScript(() => { try { localStorage.setItem('astrateg.mine.full', 'on'); } catch { /* no storage */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
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
async function tidy(page, label) {
  assert.ok(await noHScroll(page), `${label}: sideways scroll`);
  const r = await page.evaluate(() => {
    const vis = (el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden'; };
    const size = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((el) => ({ t: (el.innerText || el.id).trim().slice(0, 30), h: Math.round(el.getBoundingClientRect().height) }));
    const head = document.querySelector('.page-head .head-actions');
    return {
      // The controls a thumb must hit: the top bar, the switch, the head, the tabs, the short list.
      small: size('header.topbar nav a, header.topbar nav button, #mode-bar a, #app-side .side-link, .page-head .head-actions a, .page-head .head-actions button, .tabs [role=tab], #mine-list .wc-go, #mine-list .wc-more, #mine-list .wclient, .more-btn, .view-toggle button, .mine-more > summary, details.wgroup > summary')
        .filter((x) => x.h < 44),
      kicker: size('.kicker.latin').length,
      headRows: head && vis(head) ? Math.round(head.getBoundingClientRect().height) : 0,
      topLinks: size('header.topbar nav .navlink').map((x) => x.t),
      old: /מה עליי/.test(document.body.innerText),
      // The same destination is not offered twice in the head and the switch.
      modeBar: !!document.getElementById('mode-bar'),
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

  // The other screens: the bottom bar (her two profiles first), and the rest one tap away.
  assert.deepEqual(await page.locator('#side-list .side-link:visible').allInnerTexts(), ['המשימות שלי', 'מבט מנהל', 'לקוחות', 'עוד']);
  assert.equal(await page.getAttribute('#mode-mine', 'aria-current'), 'page');
  const bar = await page.locator('#app-side').boundingBox();
  assert.ok(bar.y + bar.height <= 740 && bar.y > 600, `the bar floats at the bottom: ${JSON.stringify(bar)}`);
  const toggle = page.locator('#side-more');
  assert.equal(await page.locator('#side-messages').isVisible(), false);
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  for (const id of ['side-messages', 'side-prep', 'side-year', 'side-shoot', 'side-quote', 'side-quotes', 'side-team']) {
    assert.ok(await page.locator(`#${id}`).isVisible(), id);
    assert.ok((await page.locator(`#${id}`).boundingBox()).height >= 44, id);
  }
  assert.equal(await page.locator('#side-insights, #side-qa, #side-pass, #side-decisions').count(), 0, 'screens that are not Irit\'s');
  // Nothing of it is repeated in the page head; Escape closes the sheet.
  assert.deepEqual(await page.locator('.page-head .head-actions a:visible').allInnerTexts(), []);
  assert.equal(await page.locator('#cta-owner').isVisible(), false);
  assert.ok(await page.locator('#mode-manager').isVisible());
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
await step('the owner lands on "מה דורש אותי": eight rows and "הצג עוד"; the team\'s work is short too', async () => {
  const { page } = await open('owner');
  await page.waitForURL(/owner\.html#now$/);
  await page.waitForSelector('#ow-rows > li');
  await settle(page);
  assert.equal(await page.innerText('h1'), 'מה דורש אותי');
  await tidy(page, 'owner');
  assert.equal(await page.locator('#ow-rows > li:not(.more-row):visible').count(), 8);
  assert.match(await page.innerText('#ow-rows .more-btn'), /^הצג עוד \(\d+\)$/);
  assert.ok(await heightOf(page) < 2900); // eight rows, the week's chart under them, and the room of the bottom bar
  await shot(page, 'owner-01-now');
  await page.click('#mode-mine');
  await page.waitForURL(/clients\.html#mine$/);
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
await step('Lior lands on "החלטות": his queues, each five long; his own work is short', async () => {
  const { page } = await open('lior');
  await page.waitForURL(/decisions\.html/);
  await page.waitForSelector('#ls-list > li');
  await settle(page);
  assert.equal(await page.innerText('h1'), 'החלטות');
  await tidy(page, 'lior');
  assert.equal(await page.locator('#mode-bar').count(), 0); // no manager switch for Lior
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
await step('Ofir lands on the quality-control queue; the switch is not repeated in the head; his pass is short', async () => {
  const { page } = await open('ofir');
  await page.waitForURL(/qa\.html/);
  await page.waitForSelector('#mode-bar');
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
  assert.ok(ph < 7500, `the pass is ${ph}px tall (it was about 10,300)`);
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
  await tidy(page, 'ilai');
  assert.deepEqual(await page.locator('.tabs [role=tab]:visible').allInnerTexts(), ['המשימות שלי', 'הלקוחות שלי', 'הנתונים שלי']);
  for (const id of ['btn-new', 'cta-owner', 'cta-messages', 'cta-prep', 'tab-control']) assert.equal(await page.locator(`#${id}`).isVisible(), false, id);
  // The draft monthly cycle waits folded; his cards are the first thing in the list.
  assert.equal(await page.locator('#my-months details.mc-fold').getAttribute('open'), null);
  assert.ok(await page.locator('#mine-list .g-ilai .il-list > li:visible').count() <= 6);
  assert.ok(await heightOf(page) < 3500);
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
    assert.deepEqual(await page.locator('#side-list .side-link:visible').allInnerTexts(), ['המשימות שלי', 'הלקוחות שלי', 'הלקוחות שלי בעריכה', 'עוד']);
    await page.click('#side-more');
    assert.deepEqual(await page.locator('#side-sheet .side-link:visible').allInnerTexts(), ['הצעה חדשה', 'הצעות שנשלחו']);
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
  assert.deepEqual(await page.locator('#side-list .side-link:visible').allInnerTexts(), ['המשימות שלי', 'הלקוחות שלי', 'ימי צילום', 'עוד']);
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
    ['המשימות שלי', 'מבט מנהל', 'לקוחות', 'שנת החבילה', 'לפני יום צילום', 'הודעות ללקוחות', 'ימי צילום', 'הצעה חדשה', 'הצעות שנשלחו', 'צוות']);
  for (const id of ['cta-messages', 'cta-prep', 'cta-year']) assert.equal(await page.locator(`#${id}`).isVisible(), false, `${id} is in the menu, not in the head`);
  // The side menu floats beside the page (on the right, RTL), and the rail marks "המשימות שלי".
  const side = await page.locator('#app-side').boundingBox();
  const main = await page.locator('main').boundingBox();
  assert.ok(side.x > main.x + main.width - 1 && side.width > 200, JSON.stringify([side, main]));
  const rail = await page.locator('#side-rail').boundingBox();
  const cur = await page.locator('#mode-mine').boundingBox();
  assert.ok(rail.y >= cur.y && rail.y + rail.height <= cur.y + cur.height + 1, 'the rail is on the current item');
  assert.equal(await page.locator('#who-name').innerText(), 'עירית');
  assert.ok(await page.locator('.kicker.latin').isVisible());
  await shortList(page, 'irit wide');
});

assert.deepEqual(errors, [], 'page errors');
await browser.close();
console.log(`roles on a phone e2e: ${passed} steps passed`);
