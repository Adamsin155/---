// The app shell and its motion in the browser (app/shell.js, app/styles/shell.css),
// against the roles world (tests/roles-world.mjs; Tuesday 20.10.2026, 10:00 in Israel):
//  - nobody sees the shell before signing in, and the client's pages never have it;
//  - on a wide screen the side menu holds the person's screens, the rail follows the
//    current one (also between the two halves of clients.html), the keyboard reaches
//    every entry with a visible focus, and the top bar says who is signed in;
//  - the week's chart on the manager view: five office days, today marked, the numbers
//    above the bars and the whole chart as one sentence;
//  - the motion, switched on here (the other suites run with it off, see `scripted` in
//    app/shell.js): the entrance ends with everything visible and nothing left moving,
//    a number that counts up never changes the page's text, a filter goes through the
//    browser's view transition and gives the same list;
//  - with prefers-reduced-motion nothing moves at all.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/shell-e2e.mjs
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { NOW, SUPA, GALLERY_TOKEN, emailOf, buildWorld, makeFake } from './roles-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const WIDE = { width: 1280, height: 900 };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];

async function open(role, { viewport = WIDE, motion = false, reduced = false, path = 'clients.html', signIn = true } = {}) {
  const fake = makeFake(buildWorld());
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  if (motion) {
    await ctx.addInitScript(() => {
      window.__astrategMotion = true;
      window.__transitions = 0;
      const real = document.startViewTransition?.bind(document);
      if (real) document.startViewTransition = (cb) => { window.__transitions += 1; return real(cb); };
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}${path}`);
  if (signIn) {
    await page.fill('#lg-email', emailOf(role));
    await page.fill('#lg-pass', 'correct-horse');
    await page.click('#lg-submit');
  }
  return { page, ctx };
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(300); };

let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

await step('before sign-in there is no menu; the client\'s pages never have one and take the fonts', async () => {
  const { page, ctx } = await open('irit', { signIn: false });
  await page.waitForSelector('#login-form');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#app-side').count(), 0);
  assert.equal(await page.locator('header.topbar .navlink:visible').count(), 0);
  assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /Heebo/);
  await ctx.close();
  const g = await open('irit', { path: `gallery.html?t=${GALLERY_TOKEN}`, signIn: false });
  await settle(g.page);
  assert.equal(await g.page.locator('#app-side, .side').count(), 0);
  assert.match(await g.page.evaluate(() => getComputedStyle(document.body).fontFamily), /Heebo/);
  assert.equal(await g.page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(238, 240, 244)');
  await g.ctx.close();
});

await step('a wide screen: the side menu, the rail on the current screen, the name in the top bar', async () => {
  const { page, ctx } = await open('irit');
  await page.waitForSelector('#mine-list .wproc');
  await page.waitForSelector('#side-list .side-link');
  await settle(page);
  assert.equal(await page.getAttribute('#side-nav', 'aria-label'), 'תפריט ראשי');
  assert.equal(await page.getAttribute('#side-mine', 'aria-current'), 'page');
  assert.equal(await page.locator('#side-list [aria-current]').count(), 1);
  assert.equal(await page.innerText('#who-name'), 'עירית');
  assert.equal(await page.innerText('.topbar .ds-av'), 'עי');
  assert.match(await page.evaluate(() => document.getElementById('session-who').textContent), /irit@astrateg\.test/);
  assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontFamily), /Varela Round/);
  const railOn = async (sel) => {
    await page.waitForTimeout(600); // the rail's slide
    const rail = await page.locator('#side-rail').boundingBox();
    const cur = await page.locator(sel).boundingBox();
    assert.ok(rail.y >= cur.y - 1 && rail.y + rail.height <= cur.y + cur.height + 1, `the rail is not on ${sel}: ${JSON.stringify([rail, cur])}`);
  };
  await railOn('#side-mine');
  // Irit's personal profile (7.10.2026): her six daily screens in one list, no switch inside the menu.
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#side-list .side-link, #side-list .side-k')].map((e) => e.textContent.trim())),
    ['המשימות שלי', 'לקוחות', 'לפני יום צילום', 'הודעות ללקוחות', 'הצעה חדשה והכנת חוזה', 'הצעות שנשלחו']);
  assert.equal(await page.locator('#side-list .side-link:visible').count(), 6);
  assert.equal(await page.locator('#mode-bar, .mode-opt').count(), 0);
  assert.equal(await page.innerText('#profile-switch'), 'מבט מנהל');
  // The lists of clients.html are the "לקוחות" entry: the rail slides there without a page load.
  await page.click('#side-clients');
  await page.waitForSelector('#view-clients:not([hidden])');
  assert.equal(await page.getAttribute('#side-clients', 'aria-current'), 'page');
  assert.equal(await page.getAttribute('#side-mine', 'aria-current'), null);
  await railOn('#side-clients');
  // A client's card is under "לקוחות" (marked, but not "the page").
  await page.locator('#client-list a.crow').first().click();
  await page.waitForURL(/client\.html\?id=/);
  await page.waitForSelector('#side-clients');
  assert.equal(await page.getAttribute('#side-clients', 'aria-current'), 'true');
  // Another screen: its entry is the page, and the head offers no second way to the same screens.
  await page.click('#side-messages');
  await page.waitForURL(/messages\.html$/);
  await page.waitForSelector('#side-messages[aria-current="page"]');
  await railOn('#side-messages');
  assert.equal(await page.locator('.head-actions a.in-menu:visible').count(), 0);
  // The keyboard: every entry is a link in the menu's order, and focus is visible.
  await page.focus('#side-mine');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'side-clients');
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, parseFloat(s.outlineWidth)]; });
  assert.ok(ring[0] !== 'none' && ring[1] >= 2, `focus ring: ${ring}`);
  // The quote pages have the same shell.
  await page.click('#side-quotes');
  await page.waitForURL(/quotes\.html$/);
  await page.waitForSelector('#side-quotes[aria-current="page"]');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(238, 240, 244)');
  await page.click('#side-quote');
  await page.waitForSelector('#side-quote[aria-current="page"]');
  assert.equal(await page.locator('#start-quote').isVisible(), true);
  await ctx.close();
});

await step('the manager view: the week\'s chart, five office days, today marked, read out as one sentence', async () => {
  // (Since 6.10.2026 the owner lands on "המשימות שלי"; the manager view is the button at the top.)
  const { page, ctx } = await open('owner');
  await page.waitForSelector('#profile-switch[data-to="manager"]');
  await page.click('#profile-switch');
  await page.waitForURL(/owner\.html#now$/);
  await page.waitForSelector('#wk-card:not([hidden]) .wk-col');
  assert.equal(await page.innerText('#wk-h'), 'משימות שנסגרו השבוע');
  const cols = await page.locator('#wk-bars .wk-col').evaluateAll((els) => els.map((e) => ({
    day: e.dataset.day, today: e.classList.contains('is-today'), n: e.querySelector('.wk-n').textContent, title: e.title,
    done: e.querySelectorAll('.wk-seg.is-done').length, open: e.querySelectorAll('.wk-seg.is-open').length,
  })));
  assert.deepEqual(cols.map((c) => c.day), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']);
  assert.deepEqual(cols.map((c) => c.today), [false, false, true, false, false]);
  assert.deepEqual(await page.locator('.wk-days span').allInnerTexts(), ['א׳', 'ב׳', 'ג׳ · היום', 'ד׳', 'ה׳']);
  const label = await page.getAttribute('#wk-bars', 'aria-label');
  assert.equal(await page.getAttribute('#wk-bars', 'role'), 'img');
  assert.match(label, /^משימות לפי יום: יום ראשון \d+ נסגרו, \d+ פתוחות; יום שני \d+ נסגרו, \d+ פתוחות; יום שלישי \(היום\) \d+ נסגרו, \d+ פתוחות; יום רביעי \d+ נסגרו, \d+ פתוחות; יום חמישי \d+ נסגרו, \d+ פתוחות$/);
  // The numbers above the bars, the bars and the sentence agree.
  const days = [...label.matchAll(/(\d+) נסגרו, (\d+) פתוחות/g)].map((m) => [Number(m[1]), Number(m[2])]);
  cols.forEach((c, i) => {
    const [closed, open] = days[i];
    assert.equal(c.n, `${closed || open}${closed && open ? ` +${open}` : ''}`, c.day);
    assert.deepEqual([c.done, c.open], [closed ? 1 : 0, open ? 1 : 0], c.day);
    assert.match(c.title, new RegExp(`: ${closed} נסגרו, ${open} פתוחות$`));
  });
  const sum = (i) => days.reduce((a, d) => a + d[i], 0);
  assert.equal(await page.innerText('#wk-sum'), `${sum(0) === 1 ? 'אחת נסגרה' : `${sum(0)} נסגרו`} עד עכשיו, ועוד ${sum(1) === 1 ? 'אחת פתוחה' : `${sum(1)} פתוחות`} עד יום חמישי`);
  assert.ok(sum(1) > 0, 'the world has open work due this week');
  // Lior has no screen 1: no chart for him.
  await ctx.close();
  const l = await open('lior', { path: 'owner.html' });
  await l.page.waitForSelector('#view-all:not([hidden])');
  assert.equal(await l.page.locator('#wk-card').isVisible(), false);
  await l.ctx.close();
});

await step('the motion: the entrance ends with everything visible; a counting number keeps the page\'s text', async () => {
  // (The manager view by its address: since 6.10.2026 the owner lands on "המשימות שלי".)
  const { page, ctx } = await open('owner', { motion: true, path: 'owner.html' });
  await page.waitForURL(/owner\.html#now$/);
  await page.waitForSelector('#ow-stats .v');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ds-motion')), true);
  // While a figure counts up, the text of the page is already the real number.
  const first = await page.evaluate(() => [...document.querySelectorAll('#ow-stats .v')].map((e) => [e.textContent, e.classList.contains('ds-counting')]));
  assert.ok(first.some(([, counting]) => counting), 'no figure counts up on the first render');
  for (const [text] of first) assert.match(text, /^(\d+%?|—)$/);
  await page.waitForTimeout(1600);
  const rest = await page.evaluate(() => ({
    rising: document.querySelectorAll('.ds-rise').length,
    counting: document.querySelectorAll('.ds-counting').length,
    growing: document.querySelectorAll('.ds-grow').length,
    hidden: [...document.querySelectorAll('main .page-head, main .tabs, main .ow-stat, main .ds-card, main .ow-row')]
      .filter((e) => e.getClientRects().length && (getComputedStyle(e).opacity !== '1' || getComputedStyle(e).transform !== 'none')).length,
    texts: [...document.querySelectorAll('#ow-stats .v')].map((e) => e.textContent),
  }));
  assert.deepEqual([rest.rising, rest.counting, rest.growing, rest.hidden], [0, 0, 0, 0]);
  assert.deepEqual(rest.texts, first.map(([t]) => t));
  // A rebuild of the screen (the refresh button) does not play it again.
  await page.click('#btn-refresh');
  await settle(page);
  assert.equal(await page.locator('.ds-rise, .ds-counting, .ds-grow').count(), 0);

  // A filter goes through the browser's view transition and gives the list it should.
  await page.click('#tab-all');
  await page.waitForSelector('#ga-list .ga-item');
  const all = await page.locator('#ga-list .ga-item').count();
  const reds = await page.locator('#ga-list .ga-item.h-red').count();
  assert.ok(reds > 0 && reds < all);
  const before = await page.evaluate(() => window.__transitions);
  await page.click('#gaf-red');
  await page.waitForFunction((n) => document.querySelectorAll('#ga-list .ga-item').length === n, reds);
  assert.equal(await page.locator('#ga-list .ga-item:not(.h-red)').count(), 0);
  assert.equal(await page.getAttribute('#gaf-red', 'aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.__transitions), before + 1);
  // The page answers right after: the next click lands.
  await page.click('#gaf-all');
  await page.waitForFunction((n) => document.querySelectorAll('#ga-list .ga-item').length === n, all);
  await ctx.close();
});

await step('prefers-reduced-motion: nothing rises, counts or glides', async () => {
  const { page, ctx } = await open('owner', { motion: true, reduced: true, path: 'owner.html' });
  await page.waitForURL(/owner\.html#now$/);
  await page.waitForSelector('#ow-stats .v');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ds-motion')), false);
  assert.equal(await page.locator('.ds-rise, .ds-counting, .ds-grow').count(), 0);
  await page.click('#tab-all');
  await page.waitForSelector('#ga-list .ga-item');
  const reds = await page.locator('#ga-list .ga-item.h-red').count();
  await page.click('#gaf-red');
  assert.equal(await page.locator('#ga-list .ga-item').count(), reds); // at once
  assert.equal(await page.evaluate(() => window.__transitions), 0);
  // A dialog opens without an entrance.
  await page.click('#tab-now');
  await page.waitForSelector('#ow-rows .ask-btn');
  await page.locator('#ow-rows .ask-btn').first().click();
  await page.waitForSelector('#dlg-ask[open]');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('dlg-ask')).animationName), 'none');
  await ctx.close();
});

await step('a phone: the bar is the menu; the sheet of "עוד" takes focus and gives it back', async () => {
  // (Since 6.10.2026 Lior lands on "המשימות שלי" with his personal menu: five screens, two behind "עוד".)
  const { page, ctx } = await open('lior', { viewport: { width: 375, height: 740 } });
  await page.waitForSelector('#profile-switch[data-to="manager"]');
  await page.waitForSelector('#side-list .side-link');
  await settle(page);
  assert.match(page.url(), /clients\.html(#mine)?$/);
  assert.deepEqual(await page.locator('#side-list .side-link:visible').allInnerTexts(), ['המשימות שלי', 'לקוחות', 'החלטות', 'עוד']);
  assert.equal(await page.getAttribute('#side-mine', 'aria-current'), 'page');
  assert.equal(await page.locator('#side-rail').isVisible(), false);
  assert.equal(await page.locator('#side-promo, .side-logo').first().isVisible(), false);
  await page.click('#side-more');
  assert.equal(await page.evaluate(() => document.activeElement.closest('#side-sheet') !== null), true);
  assert.deepEqual(await page.locator('#side-sheet .side-link').allInnerTexts(), ['הודעות ללקוחות', 'ימי צילום']);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'side-more');
  // The manager profile's bar: the manager view first, and the rest behind "עוד".
  await page.click('#profile-switch');
  await page.waitForSelector('#profile-switch[data-to="mine"]');
  await page.waitForSelector('#view-all:not([hidden])');
  assert.deepEqual(await page.locator('#side-list .side-link:visible').allInnerTexts(), ['כל הלקוחות במבט', 'לקוחות', 'גאנט תוכן', 'עוד']);
  await page.click('#side-more');
  assert.deepEqual(await page.locator('#side-sheet .side-link').allInnerTexts(),
    ['בקרה ושיוך', 'תובנות', 'שנת החבילה', 'לפני יום צילום', 'טבלת ימי צילום', 'הצעה חדשה והכנת חוזה', 'צוות']);
  // A screen behind "עוד" marks "עוד" as where you are.
  await page.click('#side-year');
  await page.waitForURL(/year\.html$/);
  await page.waitForSelector('#side-more.is-on');
  assert.equal(await page.innerText('#profile-switch'), 'חזרה למשימות שלי');
  // The page's last content clears the bar.
  const room = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
  assert.ok(room >= 90, `room under the page: ${room}px`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
  await ctx.close();
});

assert.deepEqual(errors, [], 'page errors');
await browser.close();
noCspViolations();
console.log(`shell e2e: ${passed} steps passed`);
