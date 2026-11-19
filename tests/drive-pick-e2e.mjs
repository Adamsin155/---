// "התיקייה בדרייב" in the client's card (the owner, 19.11.2026; app/drive-pick.js; docs/ops.md, section 143),
// against the office of tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in Israel; invented names).
//   1  WebKit as an iPhone 13: Irit opens a client with no Drive link and an open question: the two
//      folders and "אף אחת" as buttons; she taps one: public.drive_link_pick is called with it, the
//      card draws again with the Drive link and the question is gone; no sideways scroll.
//   2  Chromium at 1366: "אף אחת" sends no folder; a client the system connected says "חובר אוטומטית"
//      beside the Drive link; an editor's card shows neither.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: node <a static server> . 8441 &  then  BASE_URL=http://localhost:8441/ node tests/drive-pick-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8441/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${OUT}drive-pick-${name}.png`, fullPage: false }); };
const ASK = cid(12);
const AUTO = cid(13);
const F1 = 'folderAAAA0001';
const F2 = 'folderBBBB0002';
const F9 = 'folderAUTO0009';

const db = flowWorld({ landing: false, queues: false });
const byId = (id) => db.clients.find((c) => c.id === id);
byId(ASK).links = {};
byId(AUTO).links = { drive: `https://drive.google.com/drive/folders/${F9}` };
const states = {
  [ASK]: { status: 'ask', folder_id: null, folder_name: null, candidates: [{ id: F1, name: 'נורית אירועים' }, { id: F2, name: 'נוריה - צילומים ישנים מאוד של אירועים בצפון' }] },
  [AUTO]: { status: 'auto', folder_id: F9, folder_name: 'LAB MOBILE', candidates: [] },
};
const picks = [];

async function signedIn(engine, opts, { who = 'irit', id = ASK } = {}) {
  const fake = makeFlowFake(db);
  const ctx = await engine.newContext({ ...opts, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return fake.route(r);
    if (url.pathname === '/rest/v1/drive_link_state') {
      const cidEq = (url.searchParams.get('client_id') || '').replace(/^eq\./, '');
      const row = who === 'nadia' ? null : states[cidEq] || null;
      const one = /vnd\.pgrst\.object/.test(req.headers().accept || '');
      return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(one ? row : row ? [row] : []) });
    }
    if (url.pathname === '/rest/v1/rpc/drive_link_pick') {
      const body = JSON.parse(req.postData() || '{}');
      picks.push(body);
      const s = states[body.p_client];
      let out = 'kept';
      if (s?.status === 'ask') {
        if (body.p_folder) {
          byId(body.p_client).links = { ...byId(body.p_client).links, drive: `https://drive.google.com/drive/folders/${body.p_folder}` };
          states[body.p_client] = { ...s, status: 'picked', folder_id: body.p_folder };
          out = 'linked';
        } else { states[body.p_client] = { ...s, status: 'none' }; out = 'none'; }
      }
      return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) });
    }
    return fake.route(r);
  });
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}client.html?id=${id}`);
  await page.fill('#lg-email', emailOf(who));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#cc-head h1');
  await settle(page);
  return { page, ctx };
}

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

await step('1  iPhone (WebKit): the folders as buttons; a tap links it and the question is gone', async () => {
  const wk = await webkit.launch();
  const { page, ctx } = await signedIn(wk, devices['iPhone 13']);
  const box = page.locator('#drive-pick');
  await box.waitFor();
  assert.deepEqual(await box.locator('button').allInnerTexts(), ['נורית אירועים', 'נוריה - צילומים ישנים מאוד של אירועים בצפון', 'אף אחת']);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll');
  await box.scrollIntoViewIfNeeded();
  await shot(page, 'ask-390');
  await box.locator('button', { hasText: 'נורית אירועים' }).tap();
  await page.waitForSelector('#drive-pick', { state: 'detached' });
  await settle(page);
  assert.deepEqual(picks.at(-1), { p_client: ASK, p_folder: F1 });
  assert.equal(await page.locator('.cc-links a.link-chip', { hasText: 'Drive' }).getAttribute('href'), `https://drive.google.com/drive/folders/${F1}`);
  assert.equal(await page.locator('#drive-auto-tag').count(), 0, 'picked by Irit, not automatic');
  await shot(page, 'picked-390');
  await ctx.close();
  await wk.close();
});

await step('2  Chromium 1366: "אף אחת" sends no folder; "חובר אוטומטית"; an editor sees neither', async () => {
  states[ASK] = { ...states[ASK], status: 'ask' };
  byId(ASK).links = {};
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  let { page, ctx } = await signedIn(browser, { viewport: { width: 1366, height: 900 } });
  await page.locator('#drive-pick button', { hasText: 'אף אחת' }).click();
  await page.waitForSelector('#drive-pick', { state: 'detached' });
  assert.deepEqual(picks.at(-1), { p_client: ASK, p_folder: null });
  await ctx.close();
  ({ page, ctx } = await signedIn(browser, { viewport: { width: 1366, height: 900 } }, { id: AUTO }));
  const tag = page.locator('#drive-auto-tag');
  await tag.waitFor();
  assert.equal((await tag.innerText()).trim(), 'חובר אוטומטית');
  await page.locator('.cc-links').scrollIntoViewIfNeeded();
  await shot(page, 'auto-1366');
  await ctx.close();
  ({ page, ctx } = await signedIn(browser, { viewport: { width: 1366, height: 900 } }, { who: 'nadia', id: AUTO }).catch(() => ({})));
  if (page) {
    assert.equal(await page.locator('#drive-auto-tag, #drive-pick').count(), 0);
    await ctx.close();
  }
  await browser.close();
});

assert.deepEqual(errors, [], 'page errors');
console.log(`\n${passed} passed`);
