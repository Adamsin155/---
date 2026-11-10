// "הערות" on the client next to the phone, email and company number (Irit, 10.11.2026; app/client-card.js),
// against the office of tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in Israel; invented names).
//   1  WebKit as an iPhone 13: Irit opens a client with no notes: "הערות · לא הוזן" with "הוספה";
//      the button opens "עריכת פרטים" on the notes; real key-by-key typing and deleting; saved, shown in place.
//   2  Chromium at 1366: the note is in the facts, "עריכה" changes it, the page does not scroll sideways.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: node <a static server> . 8441 &  then  BASE_URL=http://localhost:8441/ node tests/client-notes-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8441/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${OUT}client-notes-${name}.png` }); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const ID = cid(12);

const db = flowWorld({ landing: false, queues: false });
const client = () => db.clients.find((c) => c.id === ID);
client().notes = null;

async function signedIn(engine, opts) {
  const fake = makeFlowFake(db);
  const ctx = await engine.newContext({ ...opts, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}client.html?id=${ID}`);
  await page.fill('#lg-email', emailOf('irit'));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#cc-head h1');
  await settle(page);
  return { page, ctx };
}
const notesFact = (page) => page.locator('.cc-facts .fact', { has: page.locator('dt', { hasText: 'הערות' }) });

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

await step('1  iPhone (WebKit): empty notes, "הוספה", key-by-key typing and deleting, saved in place', async () => {
  const wk = await webkit.launch();
  const { page, ctx } = await signedIn(wk, devices['iPhone 13']);
  const fact = notesFact(page);
  assert.match(await text(fact), /הערות.*לא הוזן.*הוספה/);
  // Next to the phone and the company number: right after ח.פ in the same list.
  const order = await page.locator('.cc-facts dt').allInnerTexts();
  assert.equal(order.indexOf('הערות'), order.indexOf('ח.פ / ת.ז') + 1);
  await shot(page, 'empty-390');
  await fact.locator('#btn-notes').tap();
  await page.waitForSelector('#dlg-edit[open]');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'ed-notes');
  await page.keyboard.type('לקוח רגיש למחיר', { delay: 30 });
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('זמן', { delay: 30 });
  assert.equal(await page.inputValue('#ed-notes'), 'לקוח רגיש לזמן');
  await page.locator('#ed-submit').tap();
  await page.waitForFunction(() => !document.querySelector('#dlg-edit')?.open);
  await settle(page);
  assert.equal(client().notes, 'לקוח רגיש לזמן');
  assert.match(await text(notesFact(page)), /לקוח רגיש לזמן.*עריכה/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll');
  await shot(page, 'saved-390');
  await ctx.close();
  await wk.close();
});

await step('2  Chromium 1366: the note in the facts, "עריכה" changes it', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const { page, ctx } = await signedIn(browser, { viewport: { width: 1366, height: 900 } });
  const fact = notesFact(page);
  assert.match(await text(fact), /לקוח רגיש לזמן/);
  await fact.locator('#btn-notes').click();
  await page.waitForSelector('#dlg-edit[open]');
  await page.keyboard.press('End');
  await page.keyboard.type('. מעדיף וואטסאפ', { delay: 20 });
  for (let i = 0; i < 7; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('שיחה', { delay: 20 });
  assert.equal(await page.inputValue('#ed-notes'), 'לקוח רגיש לזמן. מעדיף שיחה');
  await page.click('#ed-submit');
  await page.waitForFunction(() => !document.querySelector('#dlg-edit')?.open);
  await settle(page);
  assert.match(await text(notesFact(page)), /מעדיף שיחה/);
  assert.equal(await page.locator('p.cc-notes').count(), 0, 'not repeated at the foot of the card');
  await shot(page, 'saved-1366');
  await ctx.close();
  await browser.close();
});

assert.deepEqual(errors, [], 'page errors');
console.log(`\n${passed} passed`);
