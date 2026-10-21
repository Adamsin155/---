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
//  - 390px and 1366px, no side scroll, 44px targets;
//  - her own Google Calendar (the owner, 21.10.2026): its events in grey with a "Google"
//    tag, "לקבוע במערכת…?" under a matched meeting or shoot day (saved as the "קביעת מועד"
//    dialogs save), "לא קשור" remembered; connecting with the secret address (checked,
//    never shown back); an editor gets her events but no question;
//  - "פגישה חדשה" (the owner, 21.10.2026): the office and the owners; a meeting or a shoot
//    day saved on the client as "קביעת מועד" saves it, then Google opens with the invitation;
//    "פגישה אחרת" only opens the invitation; a held-back tab gets a link to tap.
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
// Irit's Google Calendar, as the server read it (20261029100000_google_calendar_sync.sql).
const GURL = 'https://calendar.google.com/calendar/ical/irit.astrateg%40gmail.com/private-0123456789abcdef0123456789abcdef/basic.ics';
function withGoogle(db) {
  const ev = (uid, starts_at, ends_at, summary, client_id = null, kind_guess = null, extra = {}) => ({
    email: emailOf('irit'), uid, starts_at, ends_at, all_day: false, summary, location: '', client_id, kind_guess, dismissed_at: null, gone_at: null, ...extra });
  db.calendar_external_events = [
    ev('m1@google.com', '2026-10-22T08:00:00.000Z', '2026-10-22T10:00:00.000Z', 'פגישת אפיון - פיצה נאפולי', cid(1), 'char'),
    ev('s1@google.com', '2026-10-23T06:00:00.000Z', '2026-10-23T12:00:00.000Z', 'יום צילום מוסך אדרי', cid(3), 'shoot', { location: 'החרושת 4, חולון' }),
    ev('d1@google.com', '2026-10-21T14:00:00.000Z', '2026-10-21T14:30:00.000Z', 'רופא שיניים'),
    ev('h1@google.com', '2026-10-23T21:00:00.000Z', '2026-10-24T21:00:00.000Z', 'יום חופש', null, null, { all_day: true }),
    ev('x1@google.com', '2026-10-22T13:00:00.000Z', null, 'זום עם קליניקת שחר', cid(2), null),
    ev('n1@google.com', '2026-11-03T08:00:00.000Z', '2026-11-03T10:00:00.000Z', 'אפיון קליניקת שחר', cid(2), 'char'),
    ev('gone@google.com', '2026-10-22T05:00:00.000Z', null, 'נמחק ביומן', null, null, { gone_at: '2026-10-20T06:00:00Z' }),
    { ...ev('nd1@google.com', '2026-10-21T09:00:00.000Z', '2026-10-21T10:00:00.000Z', 'צילום חן קוסמטיקה', cid(12), 'shoot'), email: emailOf('nadia') },
  ];
  db.google = {
    [emailOf('irit')]: { connected: true, since: '2026-10-19T08:00:00Z', readAt: '2026-10-20T06:52:00Z', error: null, events: 6 },
    [emailOf('nadia')]: { connected: true, since: '2026-10-19T08:00:00Z', readAt: '2026-10-20T06:52:00Z', error: null, events: 1 },
  };
  db.googleCalls = [];
  return db;
}
const GOOGLE_RPC = /^\/rest\/v1\/rpc\/(google_calendar_status|google_calendar_connect|google_calendar_disconnect|google_calendar_dismiss)$/;
function googleRpc(db, route, name, email, body) {
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(data) });
  if (!db.google) return json(404, { code: 'PGRST202', message: 'not found' });
  db.googleCalls.push({ name, email, body });
  if (name === 'google_calendar_status') return json(200, db.google[email] || { connected: false });
  if (name === 'google_calendar_connect') {
    if (!/^https:\/\/calendar\.google\.com\/calendar\/ical\/[^/]+\/private-[A-Za-z0-9]+\/basic\.ics$/.test(body.p_url)) return json(400, { code: '22023', message: 'bad_url: the secret iCal address of a Google calendar is expected' });
    db.google[email] = { connected: true, since: '2026-10-20T07:00:00Z', readAt: null, error: null, events: 0 };
    return json(200, db.google[email]);
  }
  if (name === 'google_calendar_disconnect') { db.google[email] = { connected: false }; return json(200, db.google[email]); }
  const row = db.calendar_external_events.find((r) => r.email === email && r.uid === body.p_uid);
  if (row) row.dismissed_at = '2026-10-20T07:00:00Z';
  return json(200, !!row);
}
const emailInToken = (req) => {
  const token = /^Bearer (.+)$/.exec(req.headers().authorization || '')?.[1] || '';
  try { return JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8')).email; } catch { return null; }
};
// public.quote_facts(p_ids): the office reads the agreements' client part (20261013100000).
function withFacts(db, fake) {
  return async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const g = GOOGLE_RPC.exec(p);
    if (req.method() !== 'OPTIONS' && g) return googleRpc(db, route, g[1], emailInToken(req), JSON.parse(req.postData() || '{}'));

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
  page.on('dialog', (d) => d.accept()); // "a shoot day before the meeting?" and "לנתק?": yes
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await settle(page);
  return { page, ctx, db, fake };
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
    await page.waitForSelector('#cp-view .cp-weekwrap');
    assert.equal(await page.getAttribute('#cp-week', 'aria-pressed'), 'true', 'the phone opens on the week');
    assert.equal(await text(page.locator('#cp-title')), '18–24 באוקטובר 2026');
    // Only the days with events, from today on; the days that passed this week are folded
    // above (the owner, 20.10.2026). It was seven days, empty ones too.
    const shownDays = await page.locator('#cp-view > .cp-weekwrap > .cp-week > .cp-day').evaluateAll((els) => els.map((e) => e.dataset.day));
    assert.ok(shownDays.length >= 2 && shownDays.length < 7, JSON.stringify(shownDays));
    assert.ok(shownDays.every((d) => d >= '2026-10-20'), JSON.stringify(shownDays));
    assert.equal(await page.locator('.cp-day:not(:has(.cp-ev))').count(), 0, 'no empty day');
    assert.equal(await page.locator('.cp-day.is-today').getAttribute('data-day'), '2026-10-20');
    const pastDays = await page.locator('.cp-past .cp-day').evaluateAll((els) => els.map((e) => e.dataset.day));
    assert.ok(pastDays.every((d) => d < '2026-10-20'), JSON.stringify(pastDays));
    if (pastDays.length) assert.equal(await page.locator('.cp-past').getAttribute('open'), null, 'the days that passed are folded');
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
    await page.waitForSelector('.cp-invite >> visible=true');
    // The line about Google is under the first invitation in sight, not in the folded days that passed.
    assert.equal(await page.locator('.cp-hint').isVisible(), true);
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
      await page.waitForSelector('.cp-weekwrap');
      await noSideScroll(page, `${role} 1366 week`);
      await shot(page, `${role}-1366-week`);
      await ctx.close();
    }
  });

  // Lior and Ofir see only what they take part in (the owner, 16.10.2026). Since 20.10.2026
  // (the owner) only Irit and the owners send invitations: Lior and Ofir read their week.
  await step('Lior sees the shoot days and Ofir his own meetings; neither has "שליחת זימון"', async () => {
    const lior = await signedIn('lior');
    await lior.page.waitForSelector('.cp-weekwrap');
    assert.equal(await kinds(lior.page, 'char'), 0, 'lior: the meetings are Ofir\'s');
    assert.equal(await kinds(lior.page, 'shoot'), 4, 'lior');
    assert.equal(await lior.page.locator('.cp-invite').count(), 0, 'lior');
    await shot(lior.page, 'lior-390-week');
    await lior.ctx.close();
    const ofir = await signedIn('ofir');
    await ofir.page.waitForSelector('.cp-weekwrap');
    assert.equal(await kinds(ofir.page, 'char'), 2, 'ofir');
    assert.equal(await kinds(ofir.page, 'shoot'), 0, 'ofir: the shoot days are Lior\'s and Eli\'s');
    assert.equal(await ofir.page.locator('.cp-invite').count(), 0, 'ofir');
    await shot(ofir.page, 'ofir-390-week');
    await ofir.ctx.close();
  });

  await step('an editor sees only her own work, with no invitation; Eli his shoot days', async () => {
    const { page, ctx } = await signedIn('nadia');
    await page.waitForSelector('.cp-weekwrap');
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
    await eli.page.waitForSelector('.cp-weekwrap');
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

  await step('Irit\'s own Google Calendar: grey events with a "Google" tag, and the question under a matched meeting', async () => {
    const { page, ctx, fake } = await signedIn('irit', { db: withGoogle(office()) });
    await page.waitForSelector('.gc-ev');
    assert.equal(await kinds(page, 'google'), 5, 'the week\'s five (not the one that left the calendar, not November\'s)');
    const thu = page.locator('.cp-day[data-day="2026-10-22"]');
    const meet = thu.locator('.gc-ev').filter({ hasText: 'פיצה נאפולי' });
    assert.match(await text(meet), /Google פגישת אפיון - פיצה נאפולי/);
    assert.match(await text(meet), /11:00 עד 13:00 · פיצה נאפולי/);
    assert.equal(await meet.locator('a.cp-ev-main').getAttribute('href'), `client.html?id=${cid(1)}`);
    assert.match(await text(meet.locator('.gc-q')), /^לקבוע במערכת כפגישת אפיון של פיצה נאפולי\? עם אופיר$/);
    // A Google event of no client: no link, no question; a whole day; a Zoom with a client: no question.
    const dent = page.locator('.cp-day[data-day="2026-10-21"] .gc-ev').filter({ hasText: 'רופא שיניים' });
    assert.equal(await dent.locator('a').count(), 0);
    assert.equal(await dent.locator('.gc-sug').count(), 0);
    assert.match(await text(page.locator('.cp-day[data-day="2026-10-24"] .gc-ev')), /יום חופש.*כל היום/);
    assert.equal(await thu.locator('.gc-ev').filter({ hasText: 'זום' }).locator('.gc-sug').count(), 0);
    // The shoot day: with whom, the client's own team chosen already.
    const shoot = page.locator('.cp-day[data-day="2026-10-23"] .gc-ev').filter({ hasText: 'מוסך אדרי' });
    assert.match(await text(shoot.locator('.gc-q')), /לקבוע במערכת כיום צילום של מוסך אדרי\?/);
    assert.equal(await shoot.locator('.chip[aria-pressed="true"]').getAttribute('data-type'), 'dms');
    assert.match(await text(page.locator('#cp-google')), /מחובר/);
    await noSideScroll(page, 'irit 390 google');
    await tall(page.locator('.gc-yes, .gc-no, .gc-types .chip'), 'irit 390 google');
    if (SHOTS) { await meet.scrollIntoViewIfNeeded(); await page.waitForTimeout(800); await page.screenshot({ path: join(SHOTS, 'irit-390-google-week.png') }); }
    await shot(page, 'irit-390-google-week-full');
    // "לקבוע": the meeting is the client's now, written as the dialog writes it, and "נקבעה פגישה" is marked.
    await meet.locator('.gc-yes').click();
    await page.waitForSelector('.cp-day[data-day="2026-10-22"] .cp-ev[data-kind="char"]');
    const patch = fake.calls.find((c) => c.method === 'PATCH' && c.table === 'clients');
    assert.deepEqual(patch.body, { char_at: '2026-10-22T08:00:00.000Z', characterizer: 'ofir' });
    assert.ok(fake.calls.some((c) => c.table === 'protocol_checks' && JSON.stringify(c.body).includes('p03.scheduled')), 'נקבעה פגישה');
    assert.equal(await meet.locator('.gc-sug').count(), 0, 'asked once');
    assert.match(await text(page.locator('#toast')), /פגישת האפיון של פיצה נאפולי נקבע/);
    // The shoot day: another team chosen, then saved with it.
    await shoot.locator('.chip[data-type="natali"]').click();
    await shoot.locator('.gc-yes').click();
    await page.waitForFunction(() => !document.querySelector('.cp-day[data-day="2026-10-23"] .gc-sug'));
    const patch2 = fake.calls.filter((c) => c.method === 'PATCH' && c.table === 'clients').at(-1);
    assert.deepEqual(patch2.body, { shoot_at: '2026-10-23T06:00:00.000Z', shoot_type: 'natali' });
    await ctx.close();
  });

  await step('"לא קשור" is remembered; the month and a wide screen show the Google events too', async () => {
    const { page, ctx, db } = await signedIn('irit', { db: withGoogle(office()), viewport: DESK });
    await page.waitForSelector('.cp-grid');
    await page.click('#cp-next');
    await page.click('.cp-cell[data-day="2026-11-03"]');
    const nov = page.locator('.cp-chosen .gc-ev');
    assert.match(await text(nov), /אפיון קליניקת שחר/);
    assert.match(await text(nov.locator('.gc-q')), /כפגישת אפיון של קליניקת שחר/);
    await noSideScroll(page, 'irit 1366 google month');
    await shot(page, 'irit-1366-google-month');
    await nov.locator('.gc-no').click();
    await page.waitForFunction(() => !document.querySelector('.cp-chosen .gc-sug'));
    assert.deepEqual(db.googleCalls.filter((c) => c.name === 'google_calendar_dismiss').map((c) => c.body), [{ p_uid: 'n1@google.com' }]);
    await page.click('#cp-today');
    await page.click('#cp-week');
    await page.waitForSelector('.cp-week .gc-ev');
    await noSideScroll(page, 'irit 1366 google week');
    await shot(page, 'irit-1366-google-week');
    await page.reload();
    await page.waitForSelector('.gc-ev');
    await page.click('#cp-month');
    await page.click('#cp-next');
    await page.click('.cp-cell[data-day="2026-11-03"]');
    assert.equal(await page.locator('.cp-chosen .gc-sug').count(), 0, 'not asked again');
    await ctx.close();
  });

  await step('connecting: the secret address is checked, sent once and never shown back; disconnecting', async () => {
    const { page, ctx, db } = await signedIn('ofir', { db: withGoogle(office()) });
    await page.waitForSelector('#cp-google:not([hidden])');
    const card = page.locator('#cp-google');
    assert.match(await text(card.locator('summary')), /היומן שלי ב־Google\s*לא מחובר/);
    assert.equal(await card.locator('details').getAttribute('open'), '', 'open while not connected');
    assert.match(await text(card), /כתובת סודית בפורמט iCal/);
    await card.scrollIntoViewIfNeeded();
    await shot(page, 'ofir-390-google-connect');
    await page.fill('#gc-url', 'https://calendar.google.com/calendar/embed?src=ofir%40gmail.com');
    await page.click('#gc-save');
    assert.match(await text(page.locator('#gc-err')), /זו לא הכתובת הסודית של Google/);
    assert.equal(db.googleCalls.filter((c) => c.name === 'google_calendar_connect').length, 0, 'nothing sent');
    const url = GURL.replace('irit.astrateg', 'ofir');
    await page.fill('#gc-url', ` ${url} `);
    await page.click('#gc-save');
    await page.waitForSelector('#gc-replace');
    assert.deepEqual(db.googleCalls.filter((c) => c.name === 'google_calendar_connect').map((c) => [c.email, c.body.p_url]), [[emailOf('ofir'), url]]);
    assert.match(await text(card), /מחובר מאז .* · הקריאה הראשונה תוך רבע שעה/);
    assert.equal(await page.locator('#gc-url').count(), 0);
    { const html = await page.content(); const at = html.indexOf('private-0123456789abcdef'); assert.ok(at < 0, `the address is nowhere on the page: ${html.slice(Math.max(0, at - 300), at + 50)}`); }
    await tall(page.locator('#gc-replace, #gc-off'), 'the card');
    await noSideScroll(page, 'ofir 390 google card');
    await shot(page, 'ofir-390-google-connected');
    await page.click('#gc-off');
    await page.waitForSelector('#gc-url');
    assert.deepEqual(db.google[emailOf('ofir')], { connected: false });
    await ctx.close();
  });

  await step('an editor sees her Google events but is asked nothing; before the migration there is no card', async () => {
    const { page, ctx } = await signedIn('nadia', { db: withGoogle(office()) });
    await page.waitForSelector('.gc-ev');
    assert.equal(await page.locator('.gc-ev').count(), 1, 'hers only');
    assert.equal(await page.locator('.gc-sug').count(), 0);
    await ctx.close();
    const before = await signedIn('irit');
    await before.page.waitForSelector('.cp-week');
    assert.equal(await before.page.locator('#cp-google').isHidden(), true);
    assert.equal(await before.page.locator('.gc-ev').count(), 0);
    await before.ctx.close();
  });

  // "פגישה חדשה" (the owner, 21.10.2026): from inside the app, saved as "קביעת מועד" saves, then the invitation.
  const googleTab = async (page, ctx, click) => {
    await ctx.route('https://calendar.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>google</p>' }));
    const popup = page.waitForEvent('popup', { timeout: 10000 });
    await click();
    const tab = await popup;
    const url = new URL(tab.url());
    await tab.close();
    return url.searchParams;
  };
  const patches = (fake) => fake.calls.filter((c) => c.method === 'PATCH' && c.table === 'clients').map((c) => c.body);

  await step('"פגישה חדשה": the office and the owners only', async () => {
    for (const role of ['nadia', 'ilai', 'eli']) {
      const { page, ctx } = await signedIn(role);
      await page.waitForSelector('.cp-week');
      assert.equal(await page.locator('#cp-new').isHidden(), true, role);
      await ctx.close();
    }
    const { page, ctx } = await signedIn('owner', { viewport: DESK });
    await page.waitForSelector('.cp-grid');
    assert.equal(await page.locator('#cp-new').isVisible(), true, 'owner');
    await ctx.close();
  });

  await step('"פגישה חדשה", a characterization meeting: a client found by a word, saved on the client, Google opened with the guests', async () => {
    const { page, ctx, fake } = await signedIn('irit');
    await page.waitForSelector('.cp-week');
    await page.click('#cp-new');
    await page.waitForSelector('#dlg-new-meeting[open]');
    await page.fill('#nm-client', 'שיר');
    assert.match(await text(page.locator('#nm-results')), /שירה קונדיטוריה · שירה כץ/);
    await page.fill('#nm-client', 'נאפ');
    await page.click('.nm-pick');
    assert.match(await text(page.locator('#nm-picked')), /פיצה נאפולי · אבי לוי/);
    assert.equal(await page.inputValue('#nm-who'), 'ofir');
    await page.click('#nm-save');
    assert.equal(await text(page.locator('#nm-err')), 'בוחרים יום ושעה לפגישה.');
    await page.fill('#nm-at', '2026-10-26T11:00');
    assert.match(await text(page.locator('#nm-guests')), /בזימון: אופיר/);
    await noSideScroll(page, 'irit 390 new meeting');
    await tall(page.locator('#dlg-new-meeting .nm-kind span, #nm-save, #nm-change'), 'the new meeting dialog');
    if (SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: join(SHOTS, 'irit-390-new-meeting.png') }); }
    const q = await googleTab(page, ctx, () => page.click('#nm-save'));
    assert.equal(q.get('text'), 'פגישת אפיון · פיצה נאפולי');
    assert.equal(q.get('dates'), '20261026T090000Z/20261026T110000Z', 'winter time, two hours');
    assert.equal(q.get('add'), emailOf('ofir'));
    assert.deepEqual(patches(fake), [{ char_at: '2026-10-26T09:00:00.000Z', characterizer: 'ofir' }]);
    assert.ok(fake.calls.some((c) => c.table === 'protocol_checks' && JSON.stringify(c.body).includes('p03.scheduled')), 'נקבעה פגישה');
    await page.waitForSelector('#dlg-new-meeting:not([open])', { state: 'attached' });
    assert.match(await text(page.locator('#toast')), /פגישת אפיון של פיצה נאפולי נשמר/);
    // It is on the calendar now.
    await page.click('#cp-next');
    assert.match(await text(page.locator('.cp-day[data-day="2026-10-26"]')), /פגישת אפיון · אבי לוי/);
    await ctx.close();
  });

  await step('"פגישה חדשה", a shoot day: with whom, the questions of a shoot day, saved, Lior and Eli invited', async () => {
    const { page, ctx, fake } = await signedIn('lior');
    await page.waitForSelector('.cp-week');
    await page.click('#cp-new');
    await page.waitForSelector('#dlg-new-meeting[open]');
    await page.check('input[name="nm-kind"][value="shoot"]');
    assert.equal(await text(page.locator('label[for="nm-at"]')), 'מתי מגיעים המשפיענים?');
    await page.fill('#nm-client', 'אדרי');
    await page.click('.nm-pick');
    assert.equal(await page.inputValue('#nm-type'), 'dms', 'the client\'s own team');
    await page.fill('#nm-at', '2026-10-29T10:00');
    // A day the photographer did not hand over: asked, with a reason (app/availability-ui.js), when known here.
    const reason = page.locator('#av-reason');
    const q = await googleTab(page, ctx, async () => {
      await page.click('#nm-save');
      if (await reason.isVisible({ timeout: 1500 }).catch(() => false)) { await reason.fill('הלקוח ביקש'); await page.click('#av-reason-ok'); }
    });
    assert.equal(q.get('text'), 'יום צילום · מוסך אדרי');
    assert.equal(q.get('dates').slice(0, 16), '20261029T070000Z', 'the team an hour before 10:00');
    assert.equal(q.get('add'), `${emailOf('lior')},${emailOf('eli')}`);
    assert.deepEqual(patches(fake), [{ shoot_at: '2026-10-29T08:00:00.000Z', shoot_type: 'dms' }]);
    await ctx.close();
  });

  await step('"פגישה אחרת": nothing is saved, only the invitation; a held-back tab gets a link to tap', async () => {
    const { page, ctx, fake } = await signedIn('irit', { viewport: DESK });
    await page.waitForSelector('.cp-grid');
    await page.click('#cp-new');
    await page.waitForSelector('#dlg-new-meeting[open]');
    await page.check('input[name="nm-kind"][value="other"]');
    assert.equal(await text(page.locator('#nm-save')), 'פתיחת הזימון ב־Google');
    await page.fill('#nm-title', 'ישיבת צוות');
    await page.fill('#nm-at', '2026-10-27T09:30');
    if (SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: join(SHOTS, 'irit-1366-new-meeting-other.png') }); }
    const q = await googleTab(page, ctx, () => page.click('#nm-save'));
    assert.equal(q.get('text'), 'ישיבת צוות');
    assert.equal(q.get('dates'), '20261027T073000Z/20261027T083000Z');
    assert.deepEqual(patches(fake), []);
    // The browser holds the tab back: the dialog offers the link.
    await page.evaluate(() => { window.open = () => null; });
    await page.click('#cp-new');
    await page.waitForSelector('#dlg-new-meeting[open]');
    await page.check('input[name="nm-kind"][value="other"]');
    await page.fill('#nm-client', 'שחר');
    await page.click('.nm-pick');
    await page.fill('#nm-title', 'שיחת היכרות');
    await page.fill('#nm-at', '2026-10-28T12:00');
    await page.click('#nm-save');
    const link = page.locator('#nm-open');
    await link.waitFor();
    const href = new URL(await link.getAttribute('href')).searchParams;
    assert.equal(href.get('text'), 'שיחת היכרות · קליניקת שחר');
    assert.equal(await link.getAttribute('target'), '_blank');
    await noSideScroll(page, 'irit 1366 new meeting link');
    if (SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: join(SHOTS, 'irit-1366-new-meeting-link.png') }); }
    await ctx.close();
  });

  noCspViolations();
  assert.deepEqual(errors, [], `errors on the pages: ${errors.join(' | ')}`);
  console.log(`\ncalendar: ${passed} steps passed`);
} finally {
  await browser.close();
}
