// Nobody has, on any page, something that is not theirs to do (the owner's rule of
// 8.10.2026; docs/ops.md, section 43), in the browser, against the roles world
// (tests/roles-world.mjs; Tuesday 20.10.2026, 10:00 in Israel), with Amos added to it:
//  - the builder of a quote and of the contract (index.html) is in the menu of the owners,
//    Irit, Lior and Ofir only, on a wide screen and in the phone's bar; for Ilai, Nirel,
//    the editors, Eli and the field sales the page answers "אין לך גישה לעמוד הזה" with the
//    way back to their own screen, shows no package and no price, and asks the server
//    for nothing; whoever is not signed in still gets the builder, as before;
//  - "החלטות" (decisions.html) and "בקרה ושיוך" (qa.html) refuse Irit, by their address
//    too; her own screens still open; Lior, Ofir and the owners get in as before;
//  - "קליטת לקוחות קיימים" (landing.html) refuses the field sales, and the owners' line is
//    shown to the owners only;
//  - "לקוחות שלא מחוברים ל־Metricool" is not on the owners' personal "המשימות שלי"; Ilai
//    has it as before, and the owners find it in the manager profile's "עבודת הצוות".
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/role-access-e2e.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from './roles-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const WIDE = { width: 1366, height: 900 };
const NARROW = { width: 360, height: 740 };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];

const QUOTE = 'הצעה חדשה והכנת חוזה';
const NO_ACCESS = 'אין לך גישה לעמוד הזה';
const EDITORS = ['nirel', 'nadia', 'yariv', 'anna'];
const SALES = ['stav', 'amos'];
const BUILDERS = ['owner', 'irit', 'lior', 'ofir'];
const NOT_BUILDERS = ['ilai', ...EDITORS, 'eli', ...SALES];

// The roles world, and the second field agent (the fake answers him as anyone outside the office).
function world() {
  const db = buildWorld();
  db.staff.push({ email: emailOf('amos'), person: 'amos', vault: false, phone: null });
  db.quotes = [];
  return db;
}

// A browser with this role signed in: through the sign-in form of the clients page (the
// builder has none until a link is created). `requests` collects what the page asked the server.
async function signedIn(role, { viewport = WIDE } = {}) {
  const fake = makeFake(world());
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time: NOW });
  const requests = [];
  await ctx.route(`${SUPA}/**`, (route) => { requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`); return fake.route(route); });
  const page = await ctx.newPage();
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}clients.html#clients`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  // The field sales are sent to their own page; everyone else stays.
  await page.waitForSelector('#app-side', { state: 'attached' });
  await settle(page);
  return { page, ctx, requests, calls: fake.calls };
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(350); };
const menu = (page) => page.evaluate(() => [...document.querySelectorAll('#side-list .side-link, #side-sheet .side-link')].filter((a) => a.id !== 'side-more').map((a) => (a.getAttribute('aria-label') || a.textContent).trim()));
const visible = (page, sel) => page.locator(sel).first().isVisible();

let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// ── 1. The builder: the menus ───────────────
const MENU = {
  ilai: ['המשימות שלי', 'הלקוחות שלי', 'גאנט תוכן', 'שנת החבילה'],
  ...Object.fromEntries(EDITORS.map((e) => [e, ['המשימות שלי', 'הלקוחות שלי', 'הלקוחות שלי בעריכה']])),
  eli: ['המשימות שלי', 'הלקוחות שלי', 'ימי צילום'],
  stav: ['עסקה חדשה'],
  amos: ['עסקה חדשה'],
};

await step('the menus of Ilai, Nirel, the editors, Eli and the field sales have no builder, on a wide screen and in the phone\'s bar', async () => {
  for (const role of NOT_BUILDERS) {
    for (const viewport of [WIDE, NARROW]) {
      const { page, ctx } = await signedIn(role, { viewport });
      const what = `${role} at ${viewport.width}px`;
      assert.deepEqual(await menu(page), MENU[role], what);
      assert.equal(await page.locator('#side-quote').count(), 0, what);
      assert.equal(await page.locator('#app-side, #side-sheet').locator(`text=${QUOTE}`).count(), 0, what);
      assert.equal(await page.locator('#app-side, #side-sheet').locator('text=הצעה וחוזה').count(), 0, what);
      assert.equal(await page.locator('#app-side a.side-link[href="index.html"], #app-side a.side-link[href="./"]').count(), 0, what);
      // Three or four screens: all in the bar, no "עוד".
      if (viewport === NARROW) assert.equal(await page.locator('#side-more').count(), 0, what);
      await ctx.close();
    }
  }
});

await step('the owners and Irit keep the builder in the personal menu, Lior and Ofir in the manager profile', async () => {
  for (const role of BUILDERS) {
    const { page, ctx } = await signedIn(role);
    const personal = await menu(page);
    const inPersonal = role === 'owner' || role === 'irit';
    assert.equal(personal.includes(QUOTE), inPersonal, `${role}: the personal menu is ${personal}`);
    await page.click('#profile-switch');
    await page.waitForSelector('#profile-switch[data-to="mine"]');
    await settle(page);
    const manager = await menu(page);
    assert.equal(manager.includes(QUOTE), !inPersonal, `${role}: the manager menu is ${manager}`);
    await ctx.close();
  }
});

// ── 2. The builder: the page ────────────────
const BUILDER_PARTS = ['#start', '.page-head', '.stepnav', '.work', '#summary', '#mobilebar', '#tiers', '#btn-link'];

await step('index.html answers Ilai, Nirel, the editors, Eli and the field sales "אין לך גישה לעמוד הזה": no package, no price, the way back to their own screen', async () => {
  for (const role of NOT_BUILDERS) {
    for (const path of ['index.html', './', 'index.html?deal=e0000000-0000-4000-8000-000000000001']) {
      const { page, ctx, requests, calls } = await signedIn(role, { viewport: role === 'nadia' ? NARROW : WIDE });
      requests.length = 0;
      await page.goto(`${BASE}${path}`);
      await page.waitForSelector('#no-access:not([hidden])');
      await settle(page);
      const what = `${role} on ${path}`;
      assert.equal(await page.innerText('#na-h'), NO_ACCESS, what);
      for (const sel of BUILDER_PARTS) assert.equal(await visible(page, sel), false, `${what}: ${sel} is shown`);
      assert.equal(/₪/.test(await page.innerText('body')), false, `${what}: a price is on the page`);
      assert.equal(await page.locator('dialog[open]').count(), 0, what);
      // Their own home: the deals page for the field sales, "המשימות שלי" for everyone else.
      const home = SALES.includes(role) ? ['deal.html', 'מעבר לעסקה חדשה'] : ['clients.html#mine', 'מעבר להמשימות שלי'];
      assert.deepEqual([await page.getAttribute('#na-home', 'href'), (await page.innerText('#na-home')).trim()], home, what);
      assert.ok((await page.locator('#na-home').boundingBox()).height >= 44, `${what}: the way back is a small target`);
      // The server was asked who this is, and nothing about quotes or deals.
      assert.deepEqual(requests.filter((r) => /create-quote|\/quotes|deal_requests|quote_/.test(r)), [], what);
      assert.deepEqual(calls, [], what);
      assert.equal(await page.locator('#side-quote').count(), 0, what);
      if (path === 'index.html') {
        await page.click('#na-home');
        await page.waitForURL(SALES.includes(role) ? /deal\.html/ : /(clients|editor|shoot)\.html/);
      }
      await ctx.close();
    }
  }
});

await step('index.html opens as before for the owners, Irit, Lior and Ofir, and for whoever is not signed in', async () => {
  for (const role of BUILDERS) {
    const { page, ctx } = await signedIn(role);
    await page.goto(`${BASE}index.html`);
    await page.waitForSelector('#side-list .side-link');
    await settle(page);
    assert.equal(await visible(page, '#no-access'), false, role);
    assert.equal(await visible(page, '#start'), true, role);
    await page.click('#start-agreement');
    await page.waitForSelector('#tiers :is(button, label, input)');
    assert.equal(await visible(page, '#summary'), true, role);
    assert.match(await page.innerText('#summary'), /₪/, role);
    assert.equal(await visible(page, '#btn-link'), true, role);
    // "חוזה מותאם אישית" is still the office's.
    assert.equal(await page.locator('#custom-group').count(), 1, role);
    await ctx.close();
  }
  // Not signed in: the builder itself, with its sign-in only when a link is created.
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: WIDE });
  await ctx.route(`${SUPA}/**`, makeFake(world()).route);
  const page = await ctx.newPage();
  watchCsp(page);
  await page.goto(`${BASE}index.html`);
  await page.waitForSelector('#start:visible');
  await settle(page);
  assert.equal(await visible(page, '#no-access'), false);
  await ctx.close();
});

await step('a member of staff who signs in from the builder\'s own dialog and is not a builder gets the same answer, and no quote is asked for', async () => {
  const fake = makeFake(world());
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: WIDE });
  await ctx.clock.install({ time: NOW });
  const requests = [];
  await ctx.route(`${SUPA}/**`, (route) => { requests.push(new URL(route.request().url()).pathname); return fake.route(route); });
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`dialog: ${e}`));
  await page.goto(`${BASE}index.html`);
  await page.click('#start-agreement');
  await page.fill('#c-name', 'דנה לוי');
  await page.click('#btn-link');
  await page.waitForSelector('#dlg-login[open]');
  await page.fill('#lg-email', emailOf('nadia'));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#no-access:not([hidden])');
  await settle(page);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await visible(page, '#summary'), false);
  assert.equal(/₪/.test(await page.innerText('body')), false);
  assert.deepEqual(requests.filter((r) => /create-quote/.test(r)), []);
  await ctx.close();
});

// ── 3. "החלטות" and "בקרה ושיוך" ───────────
await step('decisions.html and qa.html refuse Irit, by their address too: no list and no button', async () => {
  const { page, ctx, calls } = await signedIn('irit');
  for (const [path, inner] of [['decisions.html', '#dc-page'], ['qa.html', '#of-page'], ['qa.html#assign-c0000000-0000-4000-8000-000000000015', '#of-page']]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForSelector('#no-access:not([hidden])');
    await settle(page);
    assert.equal(await page.innerText('#na-h'), NO_ACCESS, path);
    assert.equal(await visible(page, inner), false, path);
    assert.equal(await page.locator('main button:visible').count(), 0, `${path}: a button is shown`);
    assert.equal(await page.locator('main').locator('text=שיוך עורך').locator('visible=true').count(), 0, path);
    assert.equal(await page.locator('dialog[open]').count(), 0, path);
    assert.equal(await page.getAttribute('#no-access a', 'href'), 'clients.html#mine', path);
    // Neither screen is in her menu, in either profile.
    assert.equal(await page.locator('#side-decisions, #side-qa').count(), 0, path);
  }
  assert.deepEqual(calls, [], 'nothing was written');
  await ctx.close();
});

await step('Irit\'s own screens still open: the daily control, before a shoot day, the messages, the pass over the clients, the sent quotes', async () => {
  const { page, ctx } = await signedIn('irit');
  await page.goto(`${BASE}clients.html#control`);
  await page.waitForSelector('#view-control:not([hidden])');
  await page.waitForSelector('#ctl-people');
  assert.ok(await page.locator('#view-control .ctable tbody tr').count() > 3);
  for (const path of ['prep.html', 'messages.html', 'pass.html', 'quotes.html']) {
    await page.goto(`${BASE}${path}`);
    await page.waitForSelector('#side-list .side-link');
    await settle(page);
    assert.equal(await page.locator('#no-access:visible').count(), 0, path);
    assert.equal(await visible(page, path === 'quotes.html' ? '#list-block' : '#app'), true, path);
  }
  await ctx.close();
});

await step('decisions.html and qa.html open as before for Lior, Ofir and the owners; everyone outside the office is refused as before', async () => {
  for (const role of ['lior', 'ofir', 'owner']) {
    const { page, ctx } = await signedIn(role);
    for (const [path, inner] of [['decisions.html', '#dc-page'], ['qa.html', '#of-page']]) {
      await page.goto(`${BASE}${path}`);
      await page.waitForSelector(`${inner}:not([hidden])`);
      assert.equal(await visible(page, '#no-access'), false, `${role}: ${path}`);
    }
    await ctx.close();
  }
  for (const role of ['ilai', 'nadia', 'eli']) {
    const { page, ctx } = await signedIn(role);
    for (const [path, inner] of [['decisions.html', '#dc-page'], ['qa.html', '#of-page']]) {
      await page.goto(`${BASE}${path}`);
      await page.waitForSelector('#no-access:not([hidden])');
      assert.equal(await visible(page, inner), false, `${role}: ${path}`);
    }
    await ctx.close();
  }
});

// ── 4. "קליטת לקוחות קיימים" ───────────────
const OWNERS_LINE = /לבעלים אין פריטים לקלוט/;

await step('landing.html refuses the field sales; the owners\' line is shown to the owners only', async () => {
  for (const role of SALES) {
    const { page, ctx, calls } = await signedIn(role);
    await page.goto(`${BASE}landing.html`);
    await page.waitForSelector('#no-access:not([hidden])');
    await settle(page);
    assert.equal(await page.innerText('#na-h'), NO_ACCESS, role);
    assert.equal(await visible(page, '#land-page'), false, role);
    assert.equal(OWNERS_LINE.test(await page.innerText('body')), false, `${role}: the owners' line`);
    assert.equal(/מבט מנהל/.test(await page.innerText('main')), false, role);
    assert.deepEqual([await page.getAttribute('#na-home', 'href'), (await page.innerText('#na-home')).trim()], ['deal.html', 'מעבר לעסקה חדשה'], role);
    assert.deepEqual(calls, [], role);
    await ctx.close();
  }
  // The owners: their line, with the way to the manager view.
  const o = await signedIn('owner');
  await o.page.goto(`${BASE}landing.html`);
  await o.page.waitForSelector('#land-progress p');
  assert.match(await o.page.innerText('#land-progress'), OWNERS_LINE);
  assert.equal(await o.page.getAttribute('#land-progress a', 'href'), 'owner.html#landing');
  assert.equal(await visible(o.page, '#no-access'), false);
  await o.ctx.close();
  // Everyone with client work: the screen itself, and never the owners' line.
  for (const role of ['irit', 'lior', 'ofir', 'ilai', 'nadia', 'nirel', 'eli']) {
    const x = await signedIn(role);
    await x.page.goto(`${BASE}landing.html`);
    await x.page.waitForSelector('#land-progress p');
    assert.equal(await visible(x.page, '#no-access'), false, role);
    assert.equal(await visible(x.page, '#land-page'), true, role);
    assert.equal(OWNERS_LINE.test(await x.page.innerText('main')), false, `${role}: the owners' line`);
    await x.ctx.close();
  }
});

// ── 5. "לקוחות שלא מחוברים ל־Metricool" ────
const CARD = '#metricool-card';

await step('the Metricool card: not on the owners\' personal "המשימות שלי"; Ilai has it; the owners find it in "עבודת הצוות"', async () => {
  const ilai = await signedIn('ilai');
  await ilai.page.goto(`${BASE}clients.html#mine`);
  await ilai.page.waitForSelector(`${CARD}:not([hidden]) h2`);
  assert.match(await ilai.page.innerText(`${CARD} h2`), /^לקוחות שלא מחוברים ל־Metricool \(\d+\)$/);
  assert.equal(await visible(ilai.page, '#mcn-toggle'), true);
  await ilai.ctx.close();

  for (const viewport of [WIDE, NARROW]) {
    const { page, ctx } = await signedIn('owner', { viewport });
    await page.goto(`${BASE}clients.html#mine`);
    await page.waitForSelector('#view-mine:not([hidden])');
    await page.waitForSelector('#team-fold');
    await settle(page);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.profile), 'mine');
    assert.equal(await visible(page, CARD), false, 'the owners\' personal tasks show the Metricool card');
    assert.equal(/Metricool/.test(await page.innerText('#view-mine')), false);
    // What is theirs stays: the clocks, the sellers' deals, giving a task on the spot.
    assert.equal(await visible(page, '#deals-card'), true);
    assert.equal(await visible(page, '#staff-tasks-card'), true);
    // The manager profile's "עבודת הצוות": the card, as it was.
    await page.click('#team-open');
    await page.waitForSelector('#profile-switch[data-to="mine"]');
    await page.waitForSelector(`${CARD}:not([hidden]) h2`);
    assert.match(await page.innerText(`${CARD} h2`), /^לקוחות שלא מחוברים ל־Metricool \(\d+\)$/);
    // Back to the personal profile with the button, without a page load: gone again.
    await page.click('#profile-switch');
    await page.waitForSelector('#profile-switch[data-to="manager"]');
    await page.waitForSelector(`${CARD}`, { state: 'hidden' });
    assert.equal(await visible(page, CARD), false);
    await ctx.close();
  }
  // Nobody else has it, in either profile.
  for (const role of ['irit', 'lior', 'ofir', 'nadia']) {
    const { page, ctx } = await signedIn(role);
    await page.goto(`${BASE}clients.html#mine`);
    await page.waitForSelector('#view-mine:not([hidden])');
    await settle(page);
    assert.equal(await visible(page, CARD), false, role);
    await ctx.close();
  }
});

await browser.close();
assert.deepEqual(errors, [], `page errors:\n${errors.join('\n')}`);
noCspViolations();
console.log(`\n${passed} steps passed`);
