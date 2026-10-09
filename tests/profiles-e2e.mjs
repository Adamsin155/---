// The two profiles and the money rule in the browser (the owner's request of 6.10.2026;
// docs/ops.md, section 35), against the roles world (tests/roles-world.mjs; Tuesday
// 20.10.2026, 10:00 in Israel):
//  - the owners, Ofir and Lior land on "המשימות שלי" with a short menu of their own daily
//    work; one button in the top bar of every page, "מבט מנהל", opens the manager profile,
//    which alone holds the management screens, with "חזרה למשימות שלי" in the same spot;
//  - a manager screen opened by its address opens in the manager profile; a person's own
//    daily screen opens in the personal one; a page of both keeps the last choice;
//  - the choice is remembered in the browser, and a sign-in starts in the personal profile;
//  - nothing that needs action is lost in the personal profile: the urgent cards, the
//    clocks and the person's own list are there; the whole team's list is one tap away;
//  - Irit has the same two profiles (7.10.2026; her switch in the menu is gone): her own
//    list without the "whose" chips, the daily control (process 32) one tap away, the
//    team's lists and the performance only behind the button; everyone else has neither;
//  - money: the amounts and their sum in "הצעות שנשלחו" are the owners'; Irit has the list
//    without them; everyone else gets "אין לך גישה לעמוד הזה"; the sellers' deals with what
//    was agreed are Irit's and the owners'; the price columns of the manager table are
//    the owners'; the payments app refuses whoever is not a payout owner;
//  - a phone at 360px: the button is 44px high, in the same place on every page, and
//    nothing scrolls sideways.
// With an output directory, it also saves the screenshots (390px and 1366px).
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/profiles-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from './roles-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const WIDE = { width: 1366, height: 900 };
const PHONE = { width: 390, height: 844 };
const NARROW = { width: 360, height: 740 };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];

// Sent quotes as the list reads them (app/dashboard.js): a signed one, one out for
// signing, and an exceptional contract that waits for a manager.
const quote = (n, fields) => ({
  id: `a0000000-0000-4000-8000-00000000000${n}`, token: `b0000000-0000-4000-8000-00000000000${n}`, number: `AST-2026-000${n}`, client_name: 'דנה לוי',
  monthly_gross_agorot: 500000 + n * 11700, term_gross_agorot: 6000000, created_at: `2026-10-1${n}T09:00:00+03:00`, created_by_email: emailOf('irit'), status: 'sent',
  first_viewed_at: null, signed_at: null, signer_name: null, tier: 'Social + TV all in one', influencer: 'סמיון, מישל ודניס', doc: 'הסכם התקשרות', signable: 'true',
  expires_at: '2026-10-25T09:00:00+03:00', phone: '050-1234567', approval: 'none', approval_by: null, approval_note: null, approval_at: null, term: '12', valid: '72', company: 'קפה דנה', email: null,
  exceptions: [], model: { docTitle: 'הסכם התקשרות', client: { name: 'דנה לוי' }, totals: {} }, ...fields,
});
function world() {
  const db = buildWorld();
  db.quotes = [
    quote(1, { status: 'signed', signed_at: '2026-10-12T10:00:00+03:00', signer_name: 'דנה לוי' }),
    quote(2, {}),
    quote(3, { approval: 'pending', expires_at: null }),
  ];
  db.payout_owners = [];
  return db;
}

async function open(role, { viewport = WIDE, path = 'clients.html', ctx = null } = {}) {
  if (!ctx) {
    const fake = makeFake(world());
    ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
    await ctx.clock.install({ time: NOW });
    await ctx.route(`${SUPA}/**`, fake.route);
  }
  const page = await ctx.newPage();
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}${path}`);
  if (await page.locator('#lg-email').isVisible().catch(() => false)) {
    await page.fill('#lg-email', emailOf(role));
    await page.fill('#lg-pass', 'correct-horse');
    await page.click('#lg-submit');
  }
  return { page, ctx };
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(350); };
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false }); };
const menu = (page) => page.evaluate(() => [...document.querySelectorAll('#side-list .side-link, #side-sheet .side-link')].filter((a) => a.id !== 'side-more').map((a) => a.textContent.trim()));
const sw = (page) => page.evaluate(() => { const a = document.getElementById('profile-switch'); return a ? [a.textContent, a.getAttribute('href'), a.dataset.to] : null; });
const headLinks = (page) => page.locator('.page-head .head-actions a:visible').allInnerTexts();
// The views of the role. The "באיחור" tab (docs/ops.md, section 50) is there only while something is late, with its number: tests/late-tab-e2e.mjs holds it.
const tabs = (page) => page.locator('.tabs [role=tab]:visible:not(#tab-late)').allInnerTexts();
const noSideScroll = async (page, what) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 1, `${what}: the page scrolls sideways by ${over}px`);
};

let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const PERSONAL = {
  owner: ['המשימות שלי', 'לקוחות', 'הצעה חדשה והכנת חוזה', 'הצעות שנשלחו'],
  lior: ['המשימות שלי', 'לקוחות', 'החלטות', 'הודעות ללקוחות', 'ימי צילום'],
  ofir: ['המשימות שלי', 'לקוחות', 'בקרה ושיוך', 'מעבר על הלקוחות'],
  irit: ['המשימות שלי', 'לקוחות', 'לפני יום צילום', 'הודעות ללקוחות', 'הצעה חדשה והכנת חוזה', 'הצעות שנשלחו'],
};
const MANAGER = {
  owner: ['מבט מנהל', 'לקוחות', 'החלטות', 'הודעות ללקוחות', 'גאנט תוכן', 'בקרה ושיוך', 'מעבר על הלקוחות', 'תובנות', 'שנת החבילה', 'לפני יום צילום', 'ימי צילום', 'טבלת ימי צילום', 'צוות', 'אסטרטג פיימנט'],
  lior: ['כל הלקוחות במבט', 'לקוחות', 'גאנט תוכן', 'בקרה ושיוך', 'תובנות', 'שנת החבילה', 'לפני יום צילום', 'טבלת ימי צילום', 'הצעה חדשה והכנת חוזה', 'צוות'],
  ofir: ['מבט מנהל', 'לקוחות', 'גאנט תוכן', 'החלטות', 'שנת החבילה', 'לפני יום צילום', 'ימי צילום', 'טבלת ימי צילום'],
  irit: ['מבט מנהל', 'לקוחות', 'גאנט תוכן', 'שנת החבילה', 'ימי צילום', 'צוות'],
};
const HOME = { owner: 'owner.html#now', lior: 'owner.html#all', ofir: 'owner.html#now', irit: 'owner.html#now' };
// The daily review stays with Ofir (process 33) and with Irit (process 32): their own work.
const MY_TABS = { owner: ['המשימות שלי', 'לקוחות'], lior: ['המשימות שלי', 'לקוחות'], ofir: ['המשימות שלי', 'לקוחות', 'בקרה יומית'], irit: ['המשימות שלי', 'לקוחות', 'בקרה יומית'] };

for (const role of ['owner', 'lior', 'ofir', 'irit']) {
  await step(`${role}: lands on "המשימות שלי" with the short menu; the button opens the manager profile and leads back`, async () => {
    const { page, ctx } = await open(role);
    await page.waitForSelector('#profile-switch');
    await page.waitForSelector('#view-mine:not([hidden])');
    await settle(page);
    // The personal profile: no first screen of one's own any more, the page stays here.
    assert.match(page.url(), /clients\.html(#mine)?$/, role);
    assert.deepEqual(await sw(page), ['מבט מנהל', HOME[role], 'manager'], role);
    assert.deepEqual(await menu(page), PERSONAL[role], role);
    assert.equal(await page.getAttribute('#side-mine', 'aria-current'), 'page');
    assert.equal(await page.locator('#mode-bar, .mode-opt, #mode-mine, #mode-manager').count(), 0, 'one switch only: the button');
    assert.equal(await page.locator('#profile-switch').count(), 1);
    assert.equal(await page.locator('#side-rest-h').count(), 0, 'a short menu has no second part');
    // No link in the page head to a screen of either profile (the menu and the button lead there).
    assert.deepEqual(await headLinks(page), [], role);
    // The team's work, the office's daily review and the performance wait in the manager
    // profile. Ofir keeps the daily review: process 33 and Thursday's summary are his own.
    assert.deepEqual(await tabs(page), MY_TABS[role], role);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.profile), 'mine');
    await shot(page, `${role}-personal-1366`);

    // The manager profile, one click away.
    await page.click('#profile-switch');
    await page.waitForURL(new RegExp(`${HOME[role].replace('.', '\\.')}$`));
    await page.waitForSelector('#profile-switch[data-to="mine"]');
    await page.waitForSelector(role === 'lior' ? '#view-all:not([hidden])' : '#view-now:not([hidden])');
    await settle(page);
    assert.deepEqual(await sw(page), ['חזרה למשימות שלי', 'clients.html#mine', 'mine'], role);
    assert.deepEqual(await menu(page), MANAGER[role], role);
    assert.equal(await page.locator('#side-mine').count(), 0, 'the way back is the button');
    assert.equal(await page.getAttribute(role === 'lior' ? '#side-overview' : '#side-manager', 'aria-current'), 'page');
    assert.deepEqual(await headLinks(page), [], role);
    await shot(page, `${role}-manager-1366`);

    // A page of both profiles keeps the choice: the clients list, with the manager's tabs.
    await page.click('#side-clients');
    await page.waitForSelector('#view-clients:not([hidden])');
    await settle(page);
    assert.equal((await sw(page))[2], 'mine', `${role}: still the manager profile on the clients list`);
    assert.deepEqual(await menu(page), MANAGER[role], role);
    assert.deepEqual(await tabs(page), ['עבודת הצוות', 'לקוחות', 'בקרה יומית', 'ביצועים'], role);
    // The team's work has its own address there, with the choice of whose list.
    await page.click('#tab-mine');
    await page.waitForSelector('#mine-people:visible');
    assert.equal(new URL(page.url()).hash, '#team');
    assert.equal((await sw(page))[2], 'mine', `${role}: the team's work is the manager profile`);
    assert.equal(await page.getAttribute('#side-clients', 'aria-current'), 'page');
    // The same button, back to the personal profile, without a page load.
    await page.click('#profile-switch');
    await page.waitForSelector('#profile-switch[data-to="manager"]');
    await page.waitForSelector('#view-mine:not([hidden])');
    assert.equal(new URL(page.url()).hash, '#mine');
    assert.deepEqual(await menu(page), PERSONAL[role], role);
    assert.deepEqual(await tabs(page), MY_TABS[role], role);
    assert.equal(await page.locator('#mine-people').isVisible(), false);
    await ctx.close();
  });
}

await step('a manager screen opened by its address opens in the manager profile; one\'s own daily screen in the personal one', async () => {
  // Ofir follows a link to the table: it opens, in the manager profile.
  const { page, ctx } = await open('ofir', { path: 'owner.html#table' });
  await page.waitForSelector('#view-table:not([hidden])');
  await page.waitForSelector('#profile-switch[data-to="mine"]');
  assert.deepEqual(await menu(page), MANAGER.ofir);
  // A notification about his queue, while in the manager profile: the page is his own, the menu follows.
  await page.goto(`${BASE}qa.html`);
  await page.waitForSelector('#profile-switch[data-to="manager"]');
  await page.waitForSelector('#side-qa[aria-current="page"]');
  assert.deepEqual(await menu(page), PERSONAL.ofir);
  // The daily review is his own work too (process 33): its address keeps the profile he is in.
  await page.goto(`${BASE}clients.html#control`);
  await page.waitForSelector('#view-control:not([hidden])');
  await page.waitForSelector('#profile-switch[data-to="manager"]');
  assert.deepEqual(await tabs(page), ['המשימות שלי', 'לקוחות', 'בקרה יומית']);
  // The performance by its address: the manager profile, with its tabs.
  await page.goto(`${BASE}clients.html#performance`);
  await page.waitForSelector('#view-performance:not([hidden])');
  await page.waitForSelector('#profile-switch[data-to="mine"]');
  assert.deepEqual(await tabs(page), ['עבודת הצוות', 'לקוחות', 'בקרה יומית', 'ביצועים']);
  await ctx.close();
  // For the owner and Lior the daily review is the manager profile's.
  for (const role of ['owner', 'lior']) {
    const x = await open(role, { path: 'clients.html#control' });
    await x.page.waitForSelector('#view-control:not([hidden])');
    await x.page.waitForSelector('#profile-switch[data-to="mine"]');
    await x.ctx.close();
  }
  // Lior: the insights and the shoot-day table are the manager's; "החלטות" is his own.
  const l = await open('lior', { path: 'insights.html' });
  await l.page.waitForSelector('#profile-switch[data-to="mine"]');
  assert.deepEqual(await menu(l.page), MANAGER.lior);
  await l.page.goto(`${BASE}owner.html#shoots`);
  await l.page.waitForSelector('#view-shoots:not([hidden])');
  await l.page.waitForSelector('#side-shoot-table[aria-current="page"]');
  await l.page.goto(`${BASE}decisions.html`);
  await l.page.waitForSelector('#side-decisions[aria-current="page"]');
  assert.deepEqual(await sw(l.page), ['מבט מנהל', 'owner.html#all', 'manager']);
  await l.ctx.close();
});

await step('the choice is remembered in the browser; a sign-in starts in the personal profile', async () => {
  const { page, ctx } = await open('owner');
  await page.waitForSelector('#profile-switch');
  await page.click('#profile-switch');
  await page.waitForURL(/owner\.html#now$/);
  // A new tab of the same browser (the installed app starting): the profile last chosen.
  const again = await ctx.newPage();
  await again.goto(`${BASE}clients.html`);
  await again.waitForURL(/owner\.html$/);
  await again.waitForSelector('#profile-switch[data-to="mine"]');
  // A client's card keeps it too.
  await again.goto(`${BASE}clients.html#clients`);
  await again.locator('#client-list a.crow').first().click();
  await again.waitForURL(/client\.html\?id=/);
  await again.waitForSelector('#profile-switch[data-to="mine"]');
  assert.equal(await again.getAttribute('#side-clients', 'aria-current'), 'true');
  // Signing out and in again: the personal profile, on "המשימות שלי".
  await again.goto(`${BASE}clients.html#clients`);
  await again.waitForSelector('#btn-logout:visible');
  await again.click('#btn-logout');
  await again.waitForSelector('#login-form:visible');
  assert.equal(await again.evaluate(() => localStorage.getItem('astrateg.profile')), null);
  await again.goto(`${BASE}clients.html`);
  await again.fill('#lg-email', emailOf('owner'));
  await again.fill('#lg-pass', 'correct-horse');
  await again.click('#lg-submit');
  await again.waitForSelector('#profile-switch[data-to="manager"]');
  await again.waitForSelector('#view-mine:not([hidden])');
  assert.match(again.url(), /clients\.html(#mine)?$/);
  assert.deepEqual(await menu(again), PERSONAL.owner);
  // What a browser remembered under the old key does not open the manager view.
  await again.evaluate(() => { localStorage.removeItem('astrateg.profile'); localStorage.setItem('astrateg.mode', 'manager'); sessionStorage.clear(); });
  await again.goto(`${BASE}clients.html`);
  await again.waitForSelector('#profile-switch[data-to="manager"]');
  await again.waitForTimeout(400);
  assert.match(again.url(), /clients\.html(#mine)?$/);
  await ctx.close();
});

await step('nothing that needs action is lost in the personal profile: the cards, the clocks, one\'s own list; the team\'s list one tap away', async () => {
  // The owner: the urgent cards and the clocks are there; the whole team's list is closed in one line.
  const { page, ctx } = await open('owner');
  await page.waitForSelector('#team-fold');
  await settle(page);
  assert.equal(await page.locator('#now-bar').isVisible(), true, 'the clocks');
  assert.equal(await page.locator('#deals-card').isVisible(), true, 'the sellers\' deals that wait for a contract');
  assert.equal(await page.locator('#staff-tasks-card').isVisible(), true, 'giving a task on the spot');
  assert.equal(await page.locator('#btn-inbox').count(), 1);
  assert.equal(await page.locator('#mine-people').isVisible(), false);
  assert.match(await page.innerText('#team-fold'), /עבודת הצוות: \d+ פתוחים\./);
  assert.match(await page.innerText('#me-bar'), /המשימות שלי:/);
  await page.click('#team-open');
  await page.waitForSelector('#mine-list .wproc');
  assert.equal(await page.locator('#mine-people').isVisible(), true);
  assert.equal(await page.locator('#team-fold').count(), 0);
  // The team's work is the manager profile's: the button now leads back.
  assert.equal(new URL(page.url()).hash, '#team');
  assert.equal(await page.innerText('#profile-switch'), 'חזרה למשימות שלי');
  assert.equal(await page.innerText('#tab-mine'), 'עבודת הצוות');
  await ctx.close();
  // Ofir: his own list, with what waits for his check; the others' lists are one tap away.
  const o = await open('ofir');
  await o.page.waitForSelector('#mine-list .wproc');
  await settle(o.page);
  assert.equal(await o.page.locator('#mine-people').isVisible(), false);
  assert.equal(await o.page.innerText('h1'), 'שלום אופיר');
  const mine = await o.page.locator('#mine-list .wproc').count();
  assert.ok(mine > 0);
  // His queue is one tap away in the personal menu.
  assert.equal(await o.page.getAttribute('#side-qa', 'href'), 'qa.html');
  // His morning summary is still next to his own list.
  assert.ok(await o.page.locator('#mine-tools .wa-link, #mine-foot .wa-link').count() >= 1, 'the morning summary');
  await o.page.click('#team-open');
  await o.page.waitForSelector('#mine-people:visible');
  assert.ok(await o.page.locator('#mine-people .chip').count() > 3);
  assert.equal(new URL(o.page.url()).hash, '#team');
  assert.equal(await o.page.innerText('#profile-switch'), 'חזרה למשימות שלי');
  await o.ctx.close();
  // Lior: his decisions and the clients' messages are one tap away, and no seller's deal (it carries a price).
  const l = await open('lior');
  await l.page.waitForSelector('#profile-switch');
  await l.page.waitForSelector('#view-mine:not([hidden])');
  await settle(l.page);
  assert.equal(await l.page.getAttribute('#side-decisions', 'href'), 'decisions.html');
  assert.equal(await l.page.locator('#deals-card').isVisible(), false);
  await l.ctx.close();
});

// The owner's complaint of 7.10.2026: on "המשימות שלי" Irit had a chip per member of staff
// (and "כל הצוות"), "ביצועים" and a menu of 11 entries, also outside the manager view.
await step('Irit, personal profile: only her own work, no chip or list of anyone else; the daily control one tap away; the team only behind the button', async () => {
  const { page, ctx } = await open('irit');
  await page.waitForSelector('#profile-switch');
  await page.waitForSelector('#mine-list .wproc');
  await settle(page);
  assert.match(page.url(), /clients\.html(#mine)?$/);
  assert.equal(await page.innerText('h1'), 'שלום עירית');
  assert.deepEqual(await sw(page), ['מבט מנהל', 'owner.html#now', 'manager']);
  assert.deepEqual(await menu(page), PERSONAL.irit);
  assert.deepEqual(await tabs(page), ['המשימות שלי', 'לקוחות', 'בקרה יומית']);
  // No chooser of whose list, as chips or as the phone's select.
  assert.equal(await page.locator('#mine-people').isVisible(), false);
  assert.equal(await page.locator('#mine-people .chip, #mine-people select, #mine-select').count(), 0);
  assert.equal(await page.locator('#team-fold').count(), 0);
  assert.match(await page.innerText('#me-bar'), /^אני:\s*עירית/);
  const mine = await page.locator('#mine-list .wproc').count();
  assert.ok(mine > 0);
  // What needs her stays: the clocks, the sellers' deals (she prepares the contract), giving a task on the spot, the inbox, a new client.
  assert.equal(await page.locator('#now-bar').isVisible(), true, 'the clocks');
  assert.equal(await page.locator('#deals-card').isVisible(), true, 'the sellers\' deals');
  assert.equal(await page.locator('#staff-tasks-card').isVisible(), true, 'giving a task on the spot');
  assert.equal(await page.locator('#btn-inbox').count(), 1);
  assert.equal(await page.locator('#btn-new').isVisible(), true);
  assert.ok(await page.locator('#mine-tools .wa-link, #mine-foot .wa-link').count() >= 1, 'her morning summary');
  await shot(page, 'irit-personal-1366');
  // The daily control (process 32, her own): one tap, still the personal profile.
  await page.click('#tab-control');
  await page.waitForSelector('#view-control:not([hidden])');
  await page.waitForSelector('#ctl-people');
  await settle(page);
  assert.equal(new URL(page.url()).hash, '#control');
  assert.deepEqual(await sw(page), ['מבט מנהל', 'owner.html#now', 'manager']);
  assert.deepEqual(await menu(page), PERSONAL.irit);
  assert.deepEqual(await tabs(page), ['המשימות שלי', 'לקוחות', 'בקרה יומית']);
  assert.ok(await page.locator('#view-control .ctable tbody tr').count() > 3, 'the control itself shows every member of staff');
  await shot(page, 'irit-control-1366');
  // A person's list from the control opens in the manager profile (#team), on that person, and the button leads back.
  await page.locator('#view-control .ctable .row-acts button', { hasText: 'הרשימה של ליאור' }).click();
  await page.waitForSelector('#mine-people:visible');
  assert.equal(new URL(page.url()).hash, '#team');
  assert.match(await page.locator('#mine-people .chip[aria-pressed="true"]').innerText(), /^ליאור/);
  assert.equal(await page.innerText('#profile-switch'), 'חזרה למשימות שלי');
  await page.click('#profile-switch');
  await page.waitForSelector('#profile-switch[data-to="manager"]');
  assert.equal(await page.locator('#mine-people').isVisible(), false);
  // The performance and the team's lists open the manager profile.
  await page.goto(`${BASE}clients.html#performance`);
  await page.waitForSelector('#view-performance:not([hidden])');
  await page.waitForSelector('#profile-switch[data-to="mine"]');
  assert.deepEqual(await tabs(page), ['עבודת הצוות', 'לקוחות', 'בקרה יומית', 'ביצועים']);
  assert.deepEqual(await menu(page), MANAGER.irit);
  await page.click('#tab-mine');
  await page.waitForSelector('#mine-people:visible');
  assert.equal(new URL(page.url()).hash, '#team');
  assert.ok(await page.locator('#mine-people .chip').count() > 3, 'the team chooser is the manager profile\'s');
  assert.equal(await page.innerText('#profile-switch'), 'חזרה למשימות שלי');
  await settle(page);
  await shot(page, 'irit-team-1366');
  // Back with the same button: her own list again, the chooser gone.
  await page.click('#profile-switch');
  await page.waitForSelector('#profile-switch[data-to="manager"]');
  await page.waitForSelector('#view-mine:not([hidden])');
  assert.equal(new URL(page.url()).hash, '#mine');
  assert.equal(await page.locator('#mine-people').isVisible(), false);
  assert.equal(await page.locator('#mine-list .wproc').count(), mine);
  // A manager page by its address opens the manager profile; her own daily pages the personal one.
  await page.goto(`${BASE}owner.html#all`);
  await page.waitForSelector('#view-all:not([hidden])');
  await page.waitForSelector('#profile-switch[data-to="mine"]');
  assert.deepEqual(await menu(page), MANAGER.irit);
  await settle(page);
  await shot(page, 'irit-manager-1366');
  for (const [path, id] of [['prep.html', 'prep'], ['messages.html', 'messages'], ['quotes.html', 'quotes']]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForSelector(`#side-${id}[aria-current="page"]`);
    assert.deepEqual(await sw(page), ['מבט מנהל', 'owner.html#now', 'manager'], path);
  }
  for (const [path, id] of [['team.html', 'team'], ['year.html', 'year'], ['shoot.html', 'shoot']]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForSelector(`#side-${id}[aria-current="page"]`);
    assert.equal((await sw(page))[2], 'mine', path);
  }
  await ctx.close();
});

await step('nobody without profiles has a button or a switch', async () => {
  for (const role of ['ilai', 'nadia', 'eli']) {
    const x = await open(role);
    await x.page.waitForSelector('#side-list .side-link');
    await settle(x.page);
    assert.equal(await x.page.locator('#profile-switch, #mode-bar, .mode-opt').count(), 0, role);
    assert.equal(await x.page.locator('#side-quotes').count(), 0, `${role}: no list of sent quotes`);
    await x.ctx.close();
  }
});

await step('money: the amounts in "הצעות שנשלחו" are the owners\'; Irit has the list without them; the rest have no access', async () => {
  const MONEY = /₪/;
  const { page, ctx } = await open('owner', { path: 'quotes.html' });
  await page.waitForSelector('#rows tr');
  await settle(page);
  assert.equal(await page.locator('#rows tr').count(), 3);
  assert.equal(await page.locator('#th-amt').isVisible(), true);
  assert.equal(await page.locator('#rows td.amt').count(), 3);
  assert.match(await page.innerText('#stats'), /חודשי בהצעות חתומות/);
  assert.match(await page.innerText('#stats'), MONEY);
  await shot(page, 'quotes-owner-1366');
  await ctx.close();

  const i = await open('irit', { path: 'quotes.html' });
  await i.page.waitForSelector('#rows tr');
  await settle(i.page);
  assert.equal(await i.page.locator('#rows tr').count(), 3, 'Irit has every quote: she sends, corrects and cancels them');
  assert.equal(await i.page.locator('#th-amt').isVisible(), false);
  assert.equal(await i.page.locator('#rows td.amt').count(), 0);
  assert.equal(MONEY.test(await i.page.innerText('main')), false, 'no amount anywhere on Irit\'s list');
  assert.equal(/חודשי בהצעות חתומות/.test(await i.page.innerText('#stats')), false);
  assert.ok(await i.page.locator('#rows [data-act="edit"], #rows button').count() > 0, 'her actions are there');
  assert.equal(await i.page.locator('#no-access').isVisible(), false);
  await shot(i.page, 'quotes-irit-1366');
  await i.ctx.close();

  for (const role of ['lior', 'ofir', 'ilai', 'nadia', 'eli']) {
    const x = await open(role, { path: 'quotes.html' });
    await x.page.waitForSelector('#no-access:not([hidden])');
    await settle(x.page);
    assert.equal(await x.page.innerText('#na-h'), 'אין לך גישה לעמוד הזה', role);
    assert.equal(await x.page.locator('#list-block').isVisible(), false, role);
    assert.equal(await x.page.locator('#stats').isVisible(), false, role);
    assert.equal(await x.page.locator('#rows tr').count(), 0, role);
    assert.equal(MONEY.test(await x.page.innerText('body')), false, role);
    assert.equal(await x.page.getAttribute('#no-access a', 'href'), 'clients.html#mine');
    if (role === 'lior') { await shot(x.page, 'quotes-lior-no-access-1366'); await x.page.setViewportSize(PHONE); await x.page.waitForTimeout(200); await shot(x.page, 'quotes-lior-no-access-390'); }
    await x.ctx.close();
  }
});

await step('money: the price columns of the manager table are the owners\'; the sellers\' deals are Irit\'s and the owners\'', async () => {
  const heads = async (role) => {
    const x = await open(role, { path: 'owner.html#table' });
    await x.page.waitForSelector('#mt-head th');
    await settle(x.page);
    const out = await x.page.locator('#mt-head th').allInnerTexts();
    await x.ctx.close();
    return out.map((t) => t.trim());
  };
  const owner = await heads('owner');
  assert.ok(owner.some((t) => /חודשי/.test(t)) && owner.some((t) => /סה״כ חוזה/.test(t)), `the owner's columns: ${owner}`);
  for (const role of ['irit', 'ofir', 'lior']) {
    const cols = await heads(role);
    assert.equal(cols.some((t) => /חודשי|סה״כ חוזה|מע״מ/.test(t)), false, `${role}: ${cols}`);
    assert.ok(cols.length < owner.length, role);
  }
  // The deals card with the discount or the price that was agreed.
  for (const [role, sees] of [['owner', true], ['irit', true], ['lior', false], ['ofir', false], ['ilai', false]]) {
    const x = await open(role, { path: 'clients.html#mine' });
    await x.page.waitForSelector('#view-mine:not([hidden])');
    await settle(x.page);
    assert.equal(await x.page.locator('#deals-card').isVisible(), sees, role);
    await x.ctx.close();
  }
});

await step('the payments app refuses whoever is not a payout owner', async () => {
  for (const [role, viewport, name] of [['lior', WIDE, 'payouts-lior-no-access-1366'], ['lior', PHONE, 'payouts-lior-no-access-390'], ['irit', WIDE, null]]) {
    const fake = makeFake(world());
    const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
    await ctx.route(`${SUPA}/**`, fake.route);
    const page = await ctx.newPage();
    await page.goto(`${BASE}payouts/`);
    await page.getByLabel('אימייל').fill(emailOf(role));
    await page.getByLabel('סיסמה').fill('correct-horse');
    await page.getByRole('button', { name: 'כניסה' }).click();
    await page.waitForSelector('text=אין לך גישה לאסטרטג פיימנט');
    assert.equal(/₪/.test(await page.innerText('#view')), false, role);
    if (name) await shot(page, name);
    await ctx.close();
  }
});

await step('a phone: the button is 44px high and in the same place on every page; nothing scrolls sideways at 360px', async () => {
  for (const role of ['owner', 'lior', 'ofir', 'irit']) {
    const { page, ctx } = await open(role, { viewport: NARROW });
    await page.waitForSelector('#profile-switch');
    await page.waitForSelector('#view-mine:not([hidden])');
    await settle(page);
    const box = async () => page.locator('#profile-switch').boundingBox();
    const a = await box();
    assert.ok(a.height >= 44, `${role}: the button is ${a.height}px high`);
    assert.ok(a.x >= 0 && a.x + a.width <= NARROW.width, `${role}: the button is inside the screen (${JSON.stringify(a)})`);
    assert.ok(a.y < 80, `${role}: the button is at the top`);
    await noSideScroll(page, `${role} personal`);
    // The bar: the personal screens; the owners and Ofir need no "עוד".
    const bar = await page.locator('#side-list > .side-link:visible').allInnerTexts();
    // The builder's long name is short in the bar ("הצעה וחוזה"); the link keeps the full name for a screen reader.
    const BAR = { owner: ['המשימות שלי', 'לקוחות', 'הצעה וחוזה', 'הצעות שנשלחו'], lior: ['המשימות שלי', 'לקוחות', 'החלטות', 'עוד'], ofir: PERSONAL.ofir, irit: ['המשימות שלי', 'לקוחות', 'לפני יום צילום', 'עוד'] };
    assert.deepEqual(bar.map((t) => t.trim()), BAR[role], role);
    if (role === 'owner') assert.equal(await page.getAttribute('#side-quote', 'aria-label'), 'הצעה חדשה והכנת חוזה');
    for (const lines of await page.locator('#side-list > .side-link:visible .side-t').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))))) assert.ok(lines <= 2, `${role}: a bar entry runs ${lines} lines`);
    for (const h of await page.locator('#side-list > .side-link:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) assert.ok(h >= 44, `${role}: a bar entry is ${h}px`);
    if (role === 'lior') {
      await page.click('#side-more');
      assert.deepEqual((await page.locator('#side-sheet .side-link:visible').allInnerTexts()).map((t) => t.trim()), ['הודעות ללקוחות', 'ימי צילום']);
      await page.keyboard.press('Escape');
    }
    if (role === 'irit') {
      // Her personal profile on a phone: no chooser, the daily control one tap away, the builder's full name in the sheet.
      assert.equal(await page.locator('#mine-people').isVisible(), false);
      assert.equal(await page.locator('#mine-select').count(), 0);
      assert.deepEqual(await tabs(page), ['המשימות שלי', 'לקוחות', 'בקרה יומית']);
      for (const h of await page.locator('.tabs [role=tab]:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) assert.ok(h >= 44, `a tab is ${h}px`);
      await page.click('#side-more');
      assert.deepEqual((await page.locator('#side-sheet .side-link:visible').allInnerTexts()).map((t) => t.trim()), ['הודעות ללקוחות', 'הצעה חדשה והכנת חוזה', 'הצעות שנשלחו']);
      await page.keyboard.press('Escape');
      await page.click('#tab-control');
      await page.waitForSelector('#view-control:not([hidden])');
      await page.waitForSelector('#ctl-people');
      assert.equal((await sw(page))[2], 'manager', 'the daily control is her personal profile');
      await noSideScroll(page, 'irit control');
      await page.setViewportSize(PHONE);
      await page.waitForTimeout(200);
      await shot(page, 'irit-control-390');
      await page.setViewportSize(NARROW);
      await page.click('#tab-mine');
      await page.waitForSelector('#view-mine:not([hidden])');
    }
    await page.setViewportSize(PHONE);
    await page.waitForTimeout(200);
    await shot(page, `${role}-personal-390`);
    await page.setViewportSize(NARROW);
    // The manager profile: the same spot, the way back.
    await page.click('#profile-switch');
    await page.waitForSelector('#profile-switch[data-to="mine"]');
    await page.waitForSelector('#ow-page:not([hidden])');
    await settle(page);
    const b = await box();
    assert.ok(b.height >= 44, `${role}: the way back is ${b.height}px high`);
    assert.ok(b.x >= 0 && b.x + b.width <= NARROW.width, `${role}: the way back is inside the screen (${JSON.stringify(b)})`);
    assert.ok(Math.abs(b.y - a.y) <= 2 && Math.abs((b.x + b.width / 2) - (a.x + a.width / 2)) <= 60, `${role}: the button moved between the profiles (${JSON.stringify([a, b])})`);
    assert.equal(await page.innerText('#profile-switch'), 'חזרה למשימות שלי');
    await noSideScroll(page, `${role} manager`);
    assert.equal((await page.locator('#side-list > .side-link:visible').allInnerTexts()).at(-1).trim(), 'עוד');
    if (role === 'irit') {
      // The team's lists on a phone: the select of whose, in the manager profile only.
      await page.goto(`${BASE}clients.html#team`);
      await page.waitForSelector('#mine-select:visible');
      assert.equal(await page.innerText('#profile-switch'), 'חזרה למשימות שלי');
      await noSideScroll(page, 'irit team');
      await page.goto(`${BASE}owner.html#now`);
      await page.waitForSelector('#ow-page:not([hidden])');
      await settle(page);
    }
    await page.setViewportSize(PHONE);
    await page.waitForTimeout(200);
    await shot(page, `${role}-manager-390`);
    await page.setViewportSize(NARROW);
    // Another page of the personal profile: the same spot again.
    await page.goto(`${BASE}clients.html#clients`);
    await page.waitForSelector('#view-clients:not([hidden])');
    await page.waitForSelector('#profile-switch');
    const c = await box();
    assert.ok(Math.abs(c.y - a.y) <= 2, `${role}: the button is elsewhere on the clients list`);
    await noSideScroll(page, `${role} clients`);
    // The keyboard reaches it, with a visible focus.
    await page.focus('#profile-switch');
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, parseFloat(s.outlineWidth)]; });
    assert.ok(ring[0] !== 'none' && ring[1] >= 2, `${role}: focus ring ${ring}`);
    await ctx.close();
  }
});

await browser.close();
assert.deepEqual(errors, [], `page errors:\n${errors.join('\n')}`);
noCspViolations();
console.log(`\n${passed} steps passed`);
