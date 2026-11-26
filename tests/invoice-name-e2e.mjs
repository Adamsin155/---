// "שם לחשבונית" in the client's card (26.11.2026; docs/ops.md, section 155): Irit types it in
// "עריכת פרטים" key by key (a mistake taken back with Backspace), saves, and the card shows it beside
// the company number; iPhone WebKit and a computer's Chromium; no sideways scroll; screenshots (SHOTS=1).
// Invented clients (tests/flow-world.mjs).
// Run: node <a static server> . 8481 &  then  BASE_URL=http://localhost:8481/ node tests/invoice-name-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8481/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const errors = [];
const ID = cid(12);

async function run(name, engine, opts) {
  const db = flowWorld({ landing: false, queues: false });
  const fake = makeFlowFake(db);
  const browser = await engine.launch();
  try {
    const ctx = opts.device
      ? await browser.newContext({ ...opts.device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })
      : await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: opts.width, height: 900 } });
    await ctx.clock.install({ time: NOW });
    await ctx.route(`${SUPA}/**`, fake.route);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    await page.goto(`${BASE}client.html?id=${ID}`);
    await page.fill('#lg-email', emailOf('irit'));
    await page.fill('#lg-pass', 'correct-horse');
    await page.click('#lg-submit');
    await page.waitForSelector('#btn-edit');
    await page.click('#btn-edit');
    await page.waitForSelector('#dlg-edit[open]');
    const box = page.locator('#ed-invoice');
    await box.scrollIntoViewIfNeeded();
    await box.click();
    await page.keyboard.type('מאפיית הדגמה בע״מX', { delay: 30 });
    await page.keyboard.press('Backspace');
    assert.equal(await box.inputValue(), 'מאפיית הדגמה בע״מ');
    assert.equal(await box.evaluate((el) => getComputedStyle(el).fontSize), '16px', 'no zoom on focus in iOS');
    assert.ok((await box.boundingBox()).height >= 44);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll');
    if (SHOTS) await page.screenshot({ path: `${OUT}invoice-dialog-${name}.png` });
    await page.click('#ed-submit');
    await page.waitForSelector('#dlg-edit', { state: 'hidden' });
    assert.equal(db.clients.find((c) => c.id === ID).invoice_name, 'מאפיית הדגמה בע״מ');
    const facts = (await page.locator('.cc-facts').innerText()).replace(/\s+/g, ' ');
    assert.match(facts, /שם לחשבונית מאפיית הדגמה בע״מ/);
    if (SHOTS) await page.locator('.cc-facts').screenshot({ path: `${OUT}invoice-card-${name}.png` });
    console.log(`ok - ${name}`);
  } finally { await browser.close(); }
}

await run('webkit-iphone13', webkit, { device: devices['iPhone 13'] });
await run('chromium-1366', chromium, { width: 1366 });
assert.deepEqual(errors, []);
console.log('2 passed');
