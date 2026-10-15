// The calendar page (calendar.html; the owner's request of 15.10.2026) in the browser,
// against the office of tests/roles-world.mjs (Tuesday 20.10.2026, 10:00 in Israel;
// invented names):
//  - Irit sees every meeting and shoot day of the week (the phone's first view) and of
//    the month; a tap on a day of the month shows its events; prev / next / today;
//  - a tap on an event opens the client's card;
//  - "שליחת זימון" opens Google Calendar with the right guests (the client when the
//    agreement has their email, the characterizer; Lior and Eli on a shoot day), the one
//    line about Google under the first one only, and only for the office;
//  - an editor sees only her own work, Eli his shoot days, the field sales no page;
//  - 390px and 1366px, no side scroll, 44px targets.
// Run: npx http-server -p 8080 -s -c-1 . &  then  BASE_URL=http://localhost:8080/ node tests/calendar-e2e.mjs [screenshot dir]
import { chromium } from 'playwright';
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
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const OFFICE = new Set(['owner', 'irit', 'lior', 'ofir', 'ilai']);

// Two clients came from signed agreements: one with the client's email, one without.
function office() {
  const db = buildWorld();
  db.clients.find((c) => c.id === cid(6)).quote_id = 'q0000000-0000-4000-8000-000000000006';
  db.clients.find((c) => c.id === cid(7)).quote_id = 'q0000000-0000-4000-8000-000000000007';
  db.clients.find((c) => c.id === cid(10)).quote_id = 'q0000000-0000-4000-8000-000000000010';
  db.quote_facts = [
    { id: 'q0000000-0000-4000-8000-000000000006', client: { company: 'שירה קונדיטוריה', email: 'Shira@Example.co.il' } },
    { id: 'q0000000-0000-4000-8000-000000000007', client: { company: 'דיין רהיטים', email: 'omer@dayan.co.il' } },
    { id: 'q0000000-0000-4000-8000-000000000010', client: { company: 'אורן פרחים', email: '' } },
  ];
  // A client in landing with its shoot day this week: shown like any other.
  Object.assign(db.clients.find((c) => c.id === cid(10)), { landing: true, landed_at: null });
  return db;
}
// public.quote_facts(p_ids): the office reads the agreements' client part (20261013100000).
function withFacts(db, fake) {
  return async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (req.method() !== 'OPTIONS' && p === '/rest/v1/rpc/quote_facts') {
      const token = /^Bearer (.+)$/.exec(req.headers().authorization || '')?.[1] || '';
      let email = null;
      try { email = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8')).email; } catch { /* none */ }
      const role = email ? email.split('@')[0] : null;
      const ids = new Set(JSON.parse(req.postData() || '{}').p_ids || []);
      const rows = OFFICE.has(role) ? db.quote_facts.filter((q) => ids.has(q.id)) : [];
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
    }
    return fake.route(route);
  };
}
async function signedIn(role, { viewport = PHONE, db = office(), path = 'calendar.html' } = {}) {
  const fake = makeFake(db);
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: viewport === PHONE, hasTouch: viewport === PHONE });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, withFacts(db, fake));
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await settle(page);
  return { page, ctx, db };
}
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const noSideScroll = async (page, who) => {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(sw <= cw, `${who}: the page scrolls sideways (${sw} > ${cw})`);
};
const tall = async (loc, who) => {
  for (const el of await loc.all()) {
    if (!(await el.isVisible())) continue;
    const box = await el.boundingBox();
    assert.ok(box.height >= 44 && box.width >= 44, `${who}: ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
};
// Once the sign-in screen has gone (its door closes in a moment) and the mouse is off the page.
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForSelector('#login-block', { state: 'hidden' }).catch(() => {});
  await page.mouse.move(1, 1);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
};
const kinds = async (page, kind) => page.locator(`#cp-view .cp-ev[data-kind="${kind}"]`).count();
const guestsOf = async (loc) => new URL(await loc.getAttribute('href')).searchParams.get('add');

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

try {
  await step('Irit, on a phone: the week of every meeting and shoot day, in Israel days', async () => {
    const { page, ctx } = await signedIn('irit');
    await page.waitForSelector('#cp-view .cp-week');
    assert.equal(await page.getAttribute('#cp-week', 'aria-pressed'), 'true', 'the phone opens on the week');
    assert.equal(await text(page.locator('#cp-title')), '18–24 באוקטובר 2026');
    assert.equal(await page.locator('.cp-day').count(), 7);
    assert.equal(await page.locator('.cp-day.is-today').getAttribute('data-day'), '2026-10-20');
    assert.equal(await kinds(page, 'char'), 2);
    assert.equal(await kinds(page, 'shoot'), 4);
    // Wednesday: the two shoot days, the earlier one first.
    const wed = page.locator('.cp-day[data-day="2026-10-21"] .cp-ev');
    assert.equal(await wed.count(), 2);
    assert.match(await text(wed.nth(0)), /יום צילום · עומר דיין/);
    assert.match(await text(wed.nth(0)), /09:00 עד 15:30/);
    assert.match(await text(wed.nth(1)), /טל אורן/);
    assert.match(await text(wed.nth(1)), /בקליטה/, 'a client in landing is shown, with its mark');
    // The meeting today at 13:00, with Ofir.
    assert.match(await text(page.locator('.cp-day[data-day="2026-10-20"] .cp-ev[data-kind="char"]')), /פגישת אפיון · שירה כץ.*13:00 עד 15:00 · עם אופיר/);
    // The ended client is nowhere.
    assert.equal(await page.locator('#cp-view').getByText('גן אירועים').count(), 0);
    await noSideScroll(page, 'irit 390 week');
    await tall(page.locator('.cp-view, .cp-arrow, #cp-today, .cp-invite, .cp-ev-main'), 'irit 390 week');
    await shot(page, 'irit-390-week');
    await ctx.close();
  });

  await step('Irit: "שליחת זימון" has the guests of the event; the line about Google is under the first one only', async () => {
    const { page, ctx } = await signedIn('irit');
    await page.waitForSelector('.cp-invite');
    const meet = page.locator('.cp-ev[data-kind="char"]').filter({ hasText: 'שירה כץ' }).locator('.cp-invite');
    assert.equal(await guestsOf(meet), `shira@example.co.il,${emailOf('ofir')}`);
    assert.equal(await meet.getAttribute('target'), '_blank');
    const url = new URL(await meet.getAttribute('href'));
    assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
    assert.equal(url.searchParams.get('text'), 'פגישת אפיון · שירה קונדיטוריה');
    assert.equal(url.searchParams.get('dates'), '20261020T100000Z/20261020T120000Z');
    assert.equal(url.searchParams.get('location'), 'הרצל 10, תל אביב');
    assert.match(url.searchParams.get('details'), new RegExp(`כרטיס הלקוח במערכת: ${BASE.replace(/[.?/]/g, '\\$&')}client\\.html\\?id=${cid(6)}`));
    assert.match(await text(page.locator('.cp-ev[data-kind="char"]').filter({ hasText: 'שירה כץ' }).locator('.cp-inv-who')), /מוזמנים: הלקוח ואופיר/);
    const shoot = page.locator('.cp-ev[data-kind="shoot"]').filter({ hasText: 'עומר דיין' }).locator('.cp-invite');
    assert.equal(await guestsOf(shoot), `omer@dayan.co.il,${emailOf('lior')},${emailOf('eli')}`);
    // An agreement with no email, and a client with no agreement: the staff alone, and it says so.
    const noMail = page.locator('.cp-ev[data-kind="shoot"]').filter({ hasText: 'טל אורן' });
    assert.equal(await guestsOf(noMail.locator('.cp-invite')), `${emailOf('lior')},${emailOf('eli')}`);
    assert.match(await text(noMail.locator('.cp-inv-who')), /מוזמנים: ליאור ואלי/);
    // A task has no invitation.
    assert.equal(await page.locator('.cp-ev[data-kind="task"] .cp-invite').count(), 0);
    assert.equal(await page.locator('.cp-hint').count(), 1);
    assert.match(await text(page.locator('.cp-hint')), /״שמירה״/);
    // Once an invitation was opened, the line is not shown again.
    const popup = page.waitForEvent('popup').catch(() => null);
    await ctx.route('https://calendar.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>google</p>' }));
    await meet.click();
    const tab = await popup;
    assert.ok(tab, 'a new tab');
    assert.match(tab.url(), /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
    await tab.close();
    await page.click('#cp-next');
    await page.click('#cp-prev');
    assert.equal(await page.locator('.cp-hint').count(), 0);
    await ctx.close();
  });

  await step('Irit: the month, a day of it, next, previous and today', async () => {
    const { page, ctx } = await signedIn('irit');
    await page.click('#cp-month');
    await page.waitForSelector('.cp-grid');
    assert.equal(await text(page.locator('#cp-title')), 'אוקטובר 2026');
    assert.equal(await page.locator('.cp-cell').count(), 35);
    assert.equal(await page.locator('.cp-cell.is-out').count(), 4, '27.9 to 30.9 belong to September');
    assert.equal(await page.locator('.cp-cell[aria-pressed="true"]').getAttribute('data-day'), '2026-10-20', 'today is open');
    const wed = page.locator('.cp-cell[data-day="2026-10-21"]');
    assert.match(await wed.getAttribute('aria-label'), /2 אירועים/);
    await wed.click();
    assert.equal(await page.locator('.cp-chosen .cp-ev').count(), 2);
    assert.match(await text(page.locator('#cp-chosen-h')), /21\.10/);
    // Every meeting and shoot day of the month is in the grid (a dot each).
    const counted = await page.locator('.cp-cell:not(.is-out)').evaluateAll((cells) => cells.reduce((n, c) => { const l = c.getAttribute('aria-label'); return n + (/אירוע אחד/.test(l) ? 1 : Number((/(\d+) אירועים/.exec(l) || [0, 0])[1])); }, 0));
    assert.ok(counted >= 15, `the month has ${counted} events`);
    await noSideScroll(page, 'irit 390 month');
    await tall(page.locator('.cp-cell:not(.is-out)'), 'irit 390 month');
    await shot(page, 'irit-390-month');
    await page.click('#cp-next');
    assert.equal(await text(page.locator('#cp-title')), 'נובמבר 2026');
    assert.equal(await page.getAttribute('#cp-today', 'disabled'), null);
    await page.click('#cp-prev');
    await page.click('#cp-prev');
    assert.equal(await text(page.locator('#cp-title')), 'ספטמבר 2026');
    await page.click('#cp-today');
    assert.equal(await text(page.locator('#cp-title')), 'אוקטובר 2026');
    assert.notEqual(await page.getAttribute('#cp-today', 'disabled'), null);
    // The choice is kept for the next opening, in this browser.
    await page.reload();
    await page.waitForSelector('.cp-grid');
    assert.equal(await page.getAttribute('#cp-month', 'aria-pressed'), 'true');
    await ctx.close();
  });

  await step('a tap on an event opens the client\'s card', async () => {
    const { page, ctx } = await signedIn('irit');
    await page.locator('.cp-ev[data-kind="char"]').filter({ hasText: 'שירה כץ' }).locator('.cp-ev-main').click();
    await page.waitForURL(/client\.html\?id=/);
    assert.equal(new URL(page.url()).searchParams.get('id'), cid(6));
    await ctx.close();
  });

  await step('the client card has "שליחת זימון" beside "הוספה ליומן", for the office only', async () => {
    const { page, ctx } = await signedIn('irit', { path: `client.html?id=${cid(6)}` });
    await page.waitForSelector('details.cal');
    await settle(page);
    const meet = page.locator('details.cal').first();
    await meet.locator('summary').click();
    const link = meet.locator('a[data-guests]');
    assert.equal(await text(link), 'שליחת זימון');
    assert.equal(await guestsOf(link), `shira@example.co.il,${emailOf('ofir')}`);
    assert.equal(await link.getAttribute('target'), '_blank');
    await tall(link, 'the invite on the card');
    await noSideScroll(page, 'the card with the calendar menu open');
    if (SHOTS) { await meet.scrollIntoViewIfNeeded(); await page.waitForTimeout(600); await page.screenshot({ path: join(SHOTS, 'irit-390-card-invite.png') }); }
    await ctx.close();
    const nadia = await signedIn('nadia', { path: `client.html?id=${cid(12)}` });
    await nadia.page.waitForSelector('details.cal');
    assert.equal(await nadia.page.locator('details.cal a[data-guests]').count(), 0);
    await nadia.ctx.close();
  });

  await step('"לפני יום צילום": the shoot day goes into everyone\'s calendar as an invitation', async () => {
    const { page, ctx } = await signedIn('irit', { path: `prep.html?id=${cid(7)}` });
    const link = page.locator('a[id^="inv-"][data-guests]').first();
    await link.waitFor({ state: 'attached' }); // under the coordination's fold once it is closed with everyone
    assert.equal((await link.textContent()).replace(/\s+/g, ' ').trim(), 'שליחת זימון (מוזמנים: הלקוח, ליאור ואלי. Google Calendar נפתח בחלון חדש)');
    assert.equal(await guestsOf(link), `omer@dayan.co.il,${emailOf('lior')},${emailOf('eli')}`);
    assert.equal(new URL(await link.getAttribute('href')).searchParams.get('dates'), '20261021T060000Z/20261021T123000Z');
    await noSideScroll(page, 'prep with the invitation');
    await ctx.close();
  });

  await step('Irit and the owner on a wide screen: the month first, with the events\' names in it', async () => {
    for (const role of ['irit', 'owner']) {
      const { page, ctx } = await signedIn(role, { viewport: DESK });
      await page.waitForSelector('.cp-grid');
      assert.equal(await page.getAttribute('#cp-month', 'aria-pressed'), 'true', `${role}: a wide screen opens on the month`);
      assert.ok(await page.locator('.cp-cell[data-day="2026-10-21"] .cp-mark-t').first().isVisible());
      assert.ok((await page.locator('.cp-chosen .cp-invite').count()) >= 1, `${role}: invites`);
      await noSideScroll(page, `${role} 1366 month`);
      await shot(page, `${role}-1366-month`);
      await page.click('#cp-week');
      await page.waitForSelector('.cp-week');
      await noSideScroll(page, `${role} 1366 week`);
      await shot(page, `${role}-1366-week`);
      await ctx.close();
    }
  });

  await step('Lior and Ofir invite too; the client\'s email reaches them through the agreement facts', async () => {
    for (const role of ['lior', 'ofir']) {
      const { page, ctx } = await signedIn(role);
      await page.waitForSelector('.cp-week');
      assert.equal(await kinds(page, 'char'), 2, role);
      assert.equal(await kinds(page, 'shoot'), 4, role);
      assert.equal(await guestsOf(page.locator('.cp-ev[data-kind="shoot"]').filter({ hasText: 'עומר דיין' }).locator('.cp-invite')), `omer@dayan.co.il,${emailOf('lior')},${emailOf('eli')}`, role);
      await ctx.close();
    }
  });

  await step('an editor sees only her own work, with no invitation; Eli his shoot days', async () => {
    const { page, ctx } = await signedIn('nadia');
    await page.waitForSelector('.cp-week');
    const evs = page.locator('#cp-view .cp-ev');
    assert.ok((await evs.count()) >= 1, 'her task of today');
    assert.equal(await kinds(page, 'char'), 0);
    assert.equal(await kinds(page, 'shoot'), 0);
    assert.equal(await page.locator('.cp-invite').count(), 0);
    for (const t of await evs.allInnerTexts()) assert.match(t, /מאיה חן|ערן פלד|אורית מור/, t);
    assert.match(await text(page.locator('.cp-day[data-day="2026-10-20"]')), /הלקוחה ביקשה להחליף מוזיקה בסרטון 3/);
    assert.match(await text(page.locator('#cp-lede')), /האירועים שלך/);
    await noSideScroll(page, 'nadia 390');
    await shot(page, 'nadia-390-week');
    await page.setViewportSize(DESK);
    await page.click('#cp-month');
    await settle(page);
    await noSideScroll(page, 'nadia 1366');
    await shot(page, 'nadia-1366-month');
    await ctx.close();
    const eli = await signedIn('eli');
    await eli.page.waitForSelector('.cp-week');
    assert.equal(await kinds(eli.page, 'shoot'), 4);
    assert.equal(await kinds(eli.page, 'char'), 0);
    assert.equal(await eli.page.locator('.cp-invite').count(), 0);
    await eli.ctx.close();
  });

  await step('the field sales have no calendar: not in the menu, and the page sends them home', async () => {
    const { page, ctx } = await signedIn('stav');
    await page.waitForURL(/deal\.html|calendar\.html/);
    await settle(page);
    if (/calendar\.html/.test(page.url())) {
      assert.equal(await page.locator('#app').isHidden(), true);
      assert.match(await text(page.locator('#state')), /אין לך גישה/);
    }
    assert.equal(await page.locator('a[href="calendar.html"]:visible').count(), 0);
    await ctx.close();
  });

  await step('the menu offers "יומן" to Irit, and marks it as the page', async () => {
    const { page, ctx } = await signedIn('irit', { viewport: DESK });
    await page.waitForSelector('.cp-grid');
    const item = page.locator('a[href="calendar.html"][aria-current="page"]:visible');
    assert.ok((await item.count()) >= 1, 'the side menu marks it');
    await ctx.close();
  });

  noCspViolations();
  assert.deepEqual(errors, [], `errors on the pages: ${errors.join(' | ')}`);
  console.log(`\ncalendar: ${passed} steps passed`);
} finally {
  await browser.close();
}
