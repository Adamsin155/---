// The editor's hand-off to Ofir by itself (the owner, 9.11.2026; docs/ops.md, section 121;
// app/editor-auto.js), in the client card, against the office of tests/flow-world.mjs (Tuesday
// 20.10.2026, 10:00 in Israel; invented names). Nadia edited two clients: every item of 22 is marked.
//   1  WebKit as an iPhone 13: "בוצע" on 24 (the folder and the Drive, the way it was marked live).
//      "העורך עדכן את אופיר" was never in that button (noBulk) and an editor cannot tick it in the
//      card (it points to editor.html): now it is written at once, by her, with the automatic note,
//      the toast says the client went to Ofir, and 24 is complete. "ביטול" takes it back with them.
//   2  Chromium at 1366: the folder was marked yesterday; her tick on the Drive is the last one, and
//      the same happens. At 390 the card is drawn without sideways scroll.
//   3  Ofir on qa.html (390 and 1366): both clients are in "ממתינים לבקרה".
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: node <a static server> . 8441 &  then  BASE_URL=http://localhost:8441/ node tests/editor-auto-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { importKeys } from '../app/client-open.js';
import { clientState } from '../app/protocol-logic.js';
import { AUTO_NOTE } from '../app/editor-auto.js';

const BASE = process.env.BASE_URL || 'http://localhost:8441/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const SIZES = { 390: { width: 390, height: 844 }, 1366: { width: 1366, height: 900 } };
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = async (target, name) => { if (SHOTS) await target.screenshot({ path: `${OUT}editor-auto-${name}.png` }); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const [A, B] = [81, 82].map(cid);
const IMPORTED_AT = '2026-10-01T09:00:00+03:00';

function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  for (const t of ['protocol_checks', 'client_tasks', 'deal_requests', 'client_gantt', 'client_scripts', 'client_access_links', 'client_status_links', 'client_status_views', 'client_approvals', 'client_surveys', 'client_consents']) db[t] = [];
  const mk = (id, name, business) => ({
    ...base, id, name, business, editor: 'nadia', editor2: null, editor_split: null, rounds: [], links: {}, landing: false, landed_at: null, landed_by: null, landing_slot: null,
    protocol_version: 13, shoot_type: 'dms', characterizer: 'ofir', has_logo: true, created_by_email: emailOf('irit'),
    deal_at: '2026-09-20T09:00:00+03:00', char_at: '2026-09-22T10:00:00+03:00', shoot_at: '2026-10-14T10:00:00+03:00', status: 'active',
  });
  const mark = (id, keys, when, note = null, by = 'nadia') => { for (const k of [].concat(keys)) db.protocol_checks.push({ client_id: id, item_key: k, state: 'done', note, by_email: emailOf(by), at: when }); };
  db.clients = [mk(A, 'דנה כץ', 'כץ פרחים'), mk(B, 'יואב לוי', 'לוי אופניים')];
  for (const c of db.clients) {
    mark(c.id, importKeys('post').filter((k) => !/^p(22a|22|23|23b|24|25|26|27)\./.test(k)), IMPORTED_AT, 'ייבוא', 'irit');
    mark(c.id, 'p22a.assigned', '2026-10-15T11:00:00+03:00', null, 'ofir');
    const cs = Object.fromEntries(db.protocol_checks.filter((r) => r.client_id === c.id).map((r) => [r.item_key, r]));
    const p22 = clientState(c, cs, NOW).states.find((s) => s.proc.id === 'p22').proc;
    mark(c.id, p22.items.map((i) => i.key), '2026-10-19T15:00:00+03:00');
  }
  mark(B, 'p24.folder', '2026-10-19T16:00:00+03:00');
  return db;
}

async function signedIn(engine, role, db, { width = 390, device = null, path, wait }) {
  const fake = makeFlowFake(db);
  const phone = !device && width < 600;
  const ctx = device
    ? await engine.newContext({ ...device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })
    : await engine.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: SIZES[width], isMobile: phone, hasTouch: phone });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector(wait);
  await settle(page);
  if (SHOTS) await page.waitForTimeout(900); // the sign-in screen has faded out
  return { page, ctx };
}
const checkOf = (db, id, key) => db.protocol_checks.find((r) => r.client_id === id && r.item_key === key) || null;
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page scrolls sideways');
const toastSays = (page, re) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector('#toast')?.textContent || ''), re.source);
// The process 24 in view: its phase opened when it is folded.
async function show24(page) {
  const proc = page.locator('#p24');
  await proc.waitFor({ state: 'attached' });
  const phase = proc.locator('xpath=ancestor::details[contains(@class,"phase")][1]');
  if (await phase.count() && !(await phase.evaluate((d) => d.open))) await phase.locator('summary').first().click();
  await proc.scrollIntoViewIfNeeded();
  return proc;
}

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

const db = office();

await step('1  iPhone (WebKit): "בוצע" on 24 hands the client to Ofir at once; "ביטול" takes it back', async () => {
  const wk = await webkit.launch();
  const { page, ctx } = await signedIn(wk, 'nadia', db, { device: devices['iPhone 13'], path: `client.html?id=${A}`, wait: '#cc-head h1' });
  const proc = await show24(page);
  await shot(page, 'card-before-390');
  // The row "העורך עדכן את אופיר" stays, and points to editor.html (an editor does not tick it here).
  assert.match(await text(page.locator('#i-p24-notify-u')), /הלקוחות שלי בעריכה/);
  await proc.locator('#p24-bulk').tap();
  await toastSays(page, /הלקוח עבר לאופיר לבקרה/);
  const n = checkOf(db, A, 'p24.notify');
  assert.ok(n, 'p24.notify written');
  assert.equal(n.note, AUTO_NOTE);
  assert.equal(n.by_email, emailOf('nadia'));
  assert.ok(checkOf(db, A, 'p24.folder') && checkOf(db, A, 'p24.drive'));
  await settle(page);
  // 24 is complete: off her list. The WhatsApp hand-off "הסרטונים מוכנים לבקרה · אופיר" is offered.
  assert.equal(await page.locator('#p24').count(), 0);
  assert.match(await text(page.locator('body')), /הסרטונים מוכנים לבקרה · אופיר/);
  await noOverflow(page);
  await shot(page, 'card-after-390');
  // "ביטול" on the toast: the folder, the Drive and the hand-off go back together.
  await page.locator('#toast button').tap();
  await toastSays(page, /הסימון של 2 הפריטים בוטל/);
  assert.equal(checkOf(db, A, 'p24.notify'), null);
  assert.equal(checkOf(db, A, 'p24.drive'), null);
  // And again, for the rest of the run.
  await (await show24(page)).locator('#p24-bulk').tap();
  await toastSays(page, /הלקוח עבר לאופיר לבקרה/);
  assert.ok(checkOf(db, A, 'p24.notify'));
  await ctx.close();
  await wk.close();
});

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

await step('2  Chromium 1366: the tick on the Drive is the last one: written once, by her', async () => {
  const { page, ctx } = await signedIn(browser, 'nadia', db, { width: 1366, path: `client.html?id=${B}`, wait: '#cc-head h1' });
  await show24(page);
  await shot(page, 'card-before-1366');
  await page.locator('#i-p24-drive').click();
  await toastSays(page, /הלקוח עבר לאופיר לבקרה/);
  const n = db.protocol_checks.filter((r) => r.client_id === B && r.item_key === 'p24.notify');
  assert.equal(n.length, 1);
  assert.equal(n[0].note, AUTO_NOTE);
  await settle(page);
  assert.equal(await page.locator('#p24').count(), 0, '24 is off her list');
  await shot(page, 'card-after-1366');
  await ctx.close();
  // At 390 (Chromium) the same card opened again: 24 is done, nothing scrolls sideways.
  const phone = await signedIn(browser, 'nadia', db, { width: 390, path: `client.html?id=${B}`, wait: '#cc-head h1' });
  assert.equal(await phone.page.locator('#p24').count(), 0);
  await noOverflow(phone.page);
  await shot(phone.page, 'card-done-390');
  await phone.ctx.close();
});

await step('3  Ofir on qa.html: both clients wait for his check', async () => {
  for (const width of [390, 1366]) {
    const { page, ctx } = await signedIn(browser, 'ofir', db, { width, path: 'qa.html', wait: 'main' });
    await page.waitForFunction(() => /כץ פרחים|דנה כץ/.test(document.body.innerText) && /לוי אופניים|יואב לוי/.test(document.body.innerText));
    await noOverflow(page);
    await shot(page, `qa-${width}`);
    await ctx.close();
  }
});

await browser.close();
noCspViolations();
assert.deepEqual(errors, []);
console.log(`\n${passed} passed`);
