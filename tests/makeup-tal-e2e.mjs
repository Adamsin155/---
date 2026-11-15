// Tal, Natali's makeup artist (the owner's request of 15.11.2026; docs/ops.md, section 132), in the
// browser. The office of tests/flow-world.mjs (invented names; Tuesday 20.10.2026, 10:00), with two
// shoot days with Natali: Wednesday 21.10 (two clients, 10:00 and 13:00) and Tuesday 27.10.
//   1  WebKit as an iPhone 13: Tal signs in and lands on her one screen (no bottom bar, one menu
//      entry); the two days, one card each; "מאשרת" with no hour, and with an hour after the shoot,
//      is refused next to the field; the hour typed key by key, a key deleted and typed again;
//      saved: "אישרת · מגיעה ב־07:30"; "שינוי שעה" and back; no sideways scroll.
//   2  Chromium 1366: the same screen; "לא יכולה" on the second day.
//   3  Lior on "לפני יום צילום" (Chromium 1366 and the iPhone): "טל אישרה, מגיעה ב־07:30" on both
//      clients of the 21st, "טל לא יכולה" on the 27th.
// Run: node <a static server> . 8463 &  then  BASE_URL=http://localhost:8463/ node tests/makeup-tal-e2e.mjs
// SHOTS=1 SHOTS_OUT=<dir> also saves makeup-tal-390.png, makeup-tal-1366.png, makeup-tal-lior-1366.png, makeup-tal-lior-390.png.
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp } from './csp-watch.mjs';
import { nataliCases, hourText, readHour, makeupKeys } from '../app/makeup-logic.js';
import { dayKeyIL } from '../app/tz.js';

const BASE = process.env.BASE_URL || 'http://localhost:8463/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\/]+$/, '')}/`;
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

const db = flowWorld({ landing: false, queues: false });
db.staff.push({ email: emailOf('tal'), person: 'tal', vault: false, phone: null });
for (const n of [7, 10]) db.clients.find((c) => c.id === cid(n)).shoot_type = 'natali'; // Wed 21.10, 10:00 and 13:00
db.makeup_answers = [];
const D1 = '2026-10-21';
const D2 = '2026-10-27';

// public.makeup_my_days() and public.makeup_answer() of the migration, on this world.
function makeupFake() {
  const fake = makeFlowFake(db);
  let nextId = 1;
  const route = async (r) => {
    const req = r.request();
    const p = new URL(req.url()).pathname;
    const json = (status, data) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: CORS });
    if (req.method() === 'OPTIONS' || !p.startsWith('/rest/v1/rpc/makeup_')) return fake.route(r);
    const token = /^Bearer (.+)$/.exec(req.headers().authorization || '')?.[1] || '';
    const email = JSON.parse(Buffer.from(token.split('.')[1] || 'e30', 'base64url').toString()).email;
    const person = db.staff.find((s) => s.email === email)?.person;
    if (person !== 'tal' && !(person === null || ['irit', 'lior', 'ofir'].includes(person))) return json(403, { code: '42501', message: 'not allowed' });
    const cases = nataliCases(db.clients.filter((c) => !c.archived_at && !c.landing));
    const today = dayKeyIL(NOW);
    if (p === '/rest/v1/rpc/makeup_my_days') {
      return json(200, {
        days: cases.filter((c) => dayKeyIL(c.shootAt) >= today).map((c) => ({ day: dayKeyIL(c.shootAt), shoot_at: c.shootAt.toISOString(), business: c.business, round: c.n })),
        answers: db.makeup_answers.filter((a) => a.day >= today),
      });
    }
    const body = JSON.parse(req.postData() || '{}');
    const ofDay = cases.filter((c) => dayKeyIL(c.shootAt) === body.p_day).sort((a, b) => a.shootAt - b.shootAt);
    if (!ofDay.length) return json(400, { code: '22023', message: 'no shoot day with Natali on that day' });
    const hour = body.p_answer === 'yes' ? body.p_arrive : null;
    if (body.p_answer === 'yes' && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(hour || '')) return json(400, { code: '22023', message: 'the hour of arrival is required (HH:MM)' });
    if (body.p_answer === 'yes' && hour >= hourText(ofDay[0].shootAt)) return json(400, { code: '22023', message: 'the hour of arrival is before the shoot' });
    const row = { id: nextId++, day: body.p_day, shoot_at: ofDay[0].shootAt.toISOString(), answer: body.p_answer, arrive_time: hour, at: new Date().toISOString(), person };
    db.makeup_answers.push(row);
    for (const c of ofDay) {
      for (const key of makeupKeys(c.pre)) {
        const i = db.protocol_checks.findIndex((x) => x.client_id === c.cid && x.item_key === key);
        if (body.p_answer === 'yes') {
          const mark = { client_id: c.cid, item_key: key, state: 'done', note: `מאפרת: מגיעה לנטלי ב־${hour}`, by_email: email, at: row.at };
          if (i < 0) db.protocol_checks.push(mark); else if (String(db.protocol_checks[i].note || '').startsWith('מאפרת:')) db.protocol_checks[i] = mark;
        } else if (i >= 0 && String(db.protocol_checks[i].note || '').startsWith('מאפרת:')) db.protocol_checks.splice(i, 1);
      }
    }
    return json(200, row);
  };
  return { route };
}

async function signedIn(engine, opts, who, path) {
  const ctx = await engine.newContext({ ...opts, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, makeupFake().route);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${who} ${page.url()}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf(who));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  return { page, ctx };
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
let passed = 0;
async function step(name, fn) { try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; } }

async function talScreen(page) {
  await page.locator(`#mk-${D1}`).waitFor();
  await settle(page);
  assert.equal(await page.locator('.mk-card').count(), 2, 'one card per day');
  assert.match(await page.locator(`#mk-${D1} .mk-when`).innerText(), /^יום ד׳ 21\.10\s+צילום ב־10:00$/);
  const who = await page.locator(`#mk-${D1} .mk-who`).innerText();
  assert.match(who, /דיין רהיטים · 10:00/);
  assert.match(who, /אורן פרחים · 13:00/);
  assert.equal(await page.locator(`#mk-st-${D1}`).innerText(), 'מחכה לתשובה שלך');
  // Nothing of the clients: no phone, no address.
  const text = await page.locator('#mk-list').innerText();
  assert.ok(!/05\d-?\d{7}|כתובת/.test(text), 'no phone or address');
}

await step('1  iPhone (WebKit): her one screen; the hour required, typed key by key; confirmed', async () => {
  const wk = await webkit.launch();
  const { page, ctx } = await signedIn(wk, devices['iPhone 13'], 'tal', 'clients.html');
  // From any page she lands on hers.
  await page.waitForURL(/makeup\.html/);
  await talScreen(page);
  // Her menu: one screen, no bottom bar.
  assert.equal(await page.evaluate(() => document.body.classList.contains('has-tabbar')), false, 'no bottom bar');
  assert.equal(await page.locator('a[href="clients.html#mine"]:visible, a[href="calendar.html"]:visible, a[href="ask.html"]:visible').count(), 0);
  // "מאשרת" with no hour.
  await page.locator(`#mk-yes-${D1}`).tap();
  assert.equal(await page.locator(`#mk-err-${D1}`).innerText(), 'צריך לכתוב באיזו שעה את מגיעה לנטלי');
  assert.equal(await page.locator(`#mk-hour-${D1}`).getAttribute('aria-invalid'), 'true');
  // Typed key by key: an hour after the shoot is refused.
  const field = page.locator(`#mk-hour-${D1}`);
  await field.tap();
  await page.keyboard.type('1100', { delay: 40 });
  assert.equal(await page.locator(`#mk-err-${D1}`).isHidden(), true, 'the error goes when she types');
  await page.locator(`#mk-yes-${D1}`).tap();
  assert.equal(await page.locator(`#mk-err-${D1}`).innerText(), 'השעה צריכה להיות לפני הצילום (10:00)');
  // Delete everything key by key, type 07:3, delete one, type 30.
  await field.tap();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('Backspace');
  assert.equal(await field.inputValue(), '');
  await page.keyboard.type('07:3', { delay: 40 });
  await page.keyboard.press('Backspace');
  assert.equal(await field.inputValue(), '07:');
  await page.keyboard.type('30', { delay: 40 });
  assert.equal(await field.inputValue(), '07:30');
  assert.equal(await field.evaluate((el) => getComputedStyle(el).fontSize), '18px', 'no zoom on focus');
  await page.locator(`#mk-yes-${D1}`).tap();
  await page.locator(`#mk-st-${D1}:has-text("אישרת")`).waitFor();
  assert.equal(await page.locator(`#mk-st-${D1}`).innerText(), 'אישרת · מגיעה ב־07:30');
  assert.equal(db.makeup_answers.at(-1).arrive_time, '07:30');
  // "שינוי שעה" opens the field with her hour; "ביטול" closes it.
  await page.locator(`#mk-change-${D1}`).tap();
  assert.equal(await page.locator(`#mk-hour-${D1}`).inputValue(), '07:30');
  await page.locator(`#mk-cancel-${D1}`).tap();
  await page.locator(`#mk-change-${D1}`).waitFor();
  assert.ok(await noSideScroll(page), 'no sideways scroll');
  if (SHOTS) await page.locator('#toast').evaluate((el) => { el.style.visibility = 'hidden'; });
  if (SHOTS) await page.screenshot({ path: `${OUT}makeup-tal-390.png`, fullPage: true });
  await ctx.close(); await wk.close();
});

await step('2  Chromium 1366: the same screen; "לא יכולה" on the 27th', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const { page, ctx } = await signedIn(browser, { viewport: { width: 1366, height: 900 } }, 'tal', 'makeup.html');
  await page.locator(`#mk-${D2}`).waitFor();
  await settle(page);
  assert.equal(await page.locator(`#mk-st-${D1}`).innerText(), 'אישרת · מגיעה ב־07:30');
  // Key by key in Chrome, deleted, then "לא יכולה" anyway.
  await page.locator(`#mk-hour-${D2}`).click();
  await page.keyboard.type('0815', { delay: 30 });
  assert.equal(readHour(await page.locator(`#mk-hour-${D2}`).inputValue()), '08:15');
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('Backspace');
  assert.equal(await page.locator(`#mk-hour-${D2}`).inputValue(), '');
  await page.locator(`#mk-no-${D2}`).click();
  await page.locator(`#mk-st-${D2}:has-text("אמרת שלא תוכלי")`).waitFor();
  assert.equal(db.makeup_answers.at(-1).answer, 'no');
  // The menu: one screen.
  const items = await page.locator('nav a[href$=".html"], nav a[href*=".html#"]').evaluateAll((as) => [...new Set(as.filter((a) => a.offsetParent).map((a) => a.getAttribute('href')))]);
  assert.ok(items.every((h) => h === 'makeup.html'), JSON.stringify(items));
  assert.ok(await noSideScroll(page));
  if (SHOTS) await page.locator('#toast').evaluate((el) => { el.style.visibility = 'hidden'; });
  if (SHOTS) await page.screenshot({ path: `${OUT}makeup-tal-1366.png`, fullPage: true });
  await ctx.close(); await browser.close();
});

await step('3  Lior on "לפני יום צילום": her hour on both clients of the 21st, "לא יכולה" on the 27th', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const [opts, name] of [[{ viewport: { width: 1366, height: 900 } }, 'makeup-tal-lior-1366.png'], [devices['iPhone 13'], 'makeup-tal-lior-390.png']]) {
    const { page, ctx } = await signedIn(name.includes('390') ? await webkit.launch() : browser, opts, 'lior', 'prep.html');
    await page.locator('[id^="mk-answer-"]').first().waitFor({ timeout: 15000 });
    await settle(page);
    const said = await page.locator('[id^="mk-answer-"]').allInnerTexts();
    assert.deepEqual(said.sort(), ['טל אישרה, מגיעה ב־07:30', 'טל אישרה, מגיעה ב־07:30', 'טל לא יכולה · לסדר מאפרת אחרת'].sort());
    // The confirmed ones are pressed; the one she cannot is open.
    for (const n of [7, 10]) assert.equal(await page.locator(`#mk-answer-${cid(n)}-1`).locator('xpath=ancestor::button').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator(`#mk-answer-${cid(8)}-1`).locator('xpath=ancestor::button').getAttribute('aria-pressed'), 'false');
    assert.ok(await noSideScroll(page));
    if (SHOTS) {
      const card = page.locator(`#mk-answer-${cid(7)}-1`).locator('xpath=ancestor::li[contains(@class,"pp-card")]');
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: `${OUT}${name}` });
      const no = page.locator(`#mk-answer-${cid(8)}-1`).locator('xpath=ancestor::li[contains(@class,"pp-card")]');
      await no.screenshot({ path: `${OUT}${name.replace('.png', '-no.png')}` });
    }
    await ctx.close();
  }
  await browser.close();
});

// Under automation app/shell-gate.js skips the move between pages (skipTransition), and WebKit reports
// the skipped transition's promise as unhandled when clients.html sends her on to makeup.html. Not a page error.
const real = errors.filter((e) => !/Skipping view transition because skipTransition\(\) was called/.test(e));
assert.deepEqual(real, [], 'page errors');
console.log(`\n${passed} passed`);
