// Lior's four things in the browser (protocol v12; the owner's decision of 3.11.2026; docs/ops.md,
// section 92), Lior signed in as himself, against the office of tests/flow-world.mjs (Tuesday
// 20.10.2026, 10:00 in Israel; invented names):
//   1  "המשימות שלי": his cards are the scripts (12), the pre-shoot form (11ג) and the campaign (30),
//      nothing of what left (2, 10, 12א, 15–21, 31); the campaign's tick leads to its card;
//   2  the client card: the scripts' Google Docs link typed key by key, a wrong address refused,
//      deleted with Backspace, the right one saved: the scripts item closes by itself;
//   3  the pre-shoot form: the address typed and corrected with Backspace, influencers yes (which)
//      or no (who films), saved to the shoot's own fields; its item closes;
//   4  the campaign: the daily budget typed and corrected, the date, "הקמפיין עלה": its note.
// Each on Chromium at 360px (a phone) and on WebKit as an iPhone 13; the screens also at 1280px.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: node <a static server> . 8419 &  then  BASE_URL=http://localhost:8419/ node tests/lior-four-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { importKeys } from '../app/client-open.js';
import { SCRIPTS_AUTO_NOTE, PRESHOOT_NOTE } from '../app/lior-four.js';

const BASE = process.env.BASE_URL || 'http://localhost:8419/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = async (target, name, opts = {}) => { if (SHOTS) await target.screenshot({ path: `${OUT}${name}.png`, ...opts }); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const [A, B] = [81, 82].map(cid);
const IMPORTED_AT = '2026-10-19T12:00:00+03:00';

function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  for (const t of ['protocol_checks', 'client_tasks', 'deal_requests', 'client_gantt', 'client_scripts', 'client_access_links', 'client_status_links', 'client_status_views', 'client_approvals', 'client_surveys', 'client_consents']) db[t] = [];
  const mk = (id, fields) => ({
    ...base, id, editor: null, editor2: null, editor_split: null, rounds: [], links: {}, landing: false, landed_at: null, landed_by: null, landing_slot: null, protocol_version: 11,
    shoot_type: null, characterizer: 'noam', has_logo: true, created_by_email: emailOf('irit'), deliverables: { videos: 8, graphics: 12 }, ...fields,
  });
  const mark = (id, keys, when, note = 'ייבוא', by = 'irit') => { for (const k of [].concat(keys)) db.protocol_checks.push({ client_id: id, item_key: k, state: 'done', note, by_email: emailOf(by), at: when }); };
  // A: the meeting was yesterday; the scripts, the Zoom and the pre-shoot form are ahead. A client from
  // before v12 (version 11): the new items are its work all the same.
  const a = mk(A, { name: 'שירן לוי', business: 'סטודיו שירן', address: null, deal_at: '2026-10-15T09:00:00+03:00', char_at: '2026-10-19T10:00:00+03:00', shoot_at: '2026-10-28T11:00:00+02:00' });
  mark(A, importKeys('content'), IMPORTED_AT);
  mark(A, 'p04.ended', '2026-10-19T11:30:00+03:00', null, 'noam');
  // B: the videos passed Ofir's check yesterday: the campaign is Lior's.
  const b = mk(B, { name: 'מור כהן', business: 'קפה מור', editor: 'nadia', address: 'הנביאים 5, חיפה', deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-09-03T10:00:00+03:00', shoot_at: '2026-10-08T10:00:00+03:00', shoot_type: 'dms' });
  mark(B, importKeys('publish'), '2026-10-19T09:00:00+03:00');
  db.clients = [a, b];
  return db;
}

async function signedIn(db, { path, width = 360, device = null, engine }) {
  const fake = makeFlowFake(db);
  const ctx = device
    ? await engine.newContext({ ...device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })
    : await engine.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width, height: width < 600 ? 780 : 900 }, isMobile: width < 600, hasTouch: width < 600 });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${path}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${path}: ${msg.text()}`); });
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf('lior'));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector(path.startsWith('clients') ? '#view-mine:not([hidden])' : '#cc-head h1');
  await settle(page);
  if (SHOTS) await page.waitForTimeout(900); // the sign-in screen has faded out
  return { page, ctx, fake };
}
const checkOf = (db, id, key) => db.protocol_checks.find((r) => r.client_id === id && r.item_key === key) || null;
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page scrolls sideways');
const tall = async (loc) => assert.ok((await loc.boundingBox()).height >= 44, 'a 44px target');
// Real typing: one key at a time, as a phone's keyboard sends them.
const type = async (loc, value) => { await loc.click(); await loc.press('End'); await loc.pressSequentially(value, { delay: 15 }); };
const backspace = async (loc, n) => { await loc.click(); await loc.press('End'); for (let i = 0; i < n; i += 1) await loc.press('Backspace'); };
const toastSays = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#toast')?.textContent || ''), re.source);

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

// 1. Lior's list.
async function mine(engine, { width = 360, device = null, name }) {
  const db = office();
  const { page, ctx } = await signedIn(db, { path: 'clients.html#mine', width, device, engine });
  const keys = (await page.$$eval('#mine-list .wproc[data-key]', (xs) => xs.map((x) => x.getAttribute('data-key')))).filter((k) => /:(r\d+-)?p\d/.test(k));
  const procs = keys.map((k) => k.split(':').at(-1));
  for (const want of [`${A}:p12`, `${A}:p36`, `${B}:p30`]) assert.ok(keys.includes(want), `${want} in ${keys.join()}`);
  for (const p of procs) assert.ok(['p12', 'p13', 'p36', 'p30', 'p34', 'p35'].includes(p), `nothing else of Lior's: ${p}`);
  await shot(page, `mine-lior-${name}`, { fullPage: true });
  assert.match(await page.locator(`#mine-list .wproc[data-key="${A}:p36"]`).textContent(), /טופס מקדים ליום צילום/);
  await noOverflow(page);
  await shot(page, `mine-lior-${name}`, { fullPage: true });
  await ctx.close();
  return db;
}

// The campaign's tick leads to its card (the form is there).
async function campaignTick(engine) {
  const db = office();
  const { page, ctx } = await signedIn(db, { path: 'clients.html#mine', width: 360, engine });
  const card = page.locator(`#mine-list .wproc[data-key="${B}:p30"]`);
  const tick = card.locator('.cbx').first();
  if (!(await tick.isVisible())) await card.locator('button[aria-expanded]').first().click();
  await tick.click();
  await page.waitForURL(/client\.html\?id=.*#p30$/);
  await page.waitForSelector('#p30 .lf-campaign');
  assert.equal(checkOf(db, B, 'p30.live'), null, 'nothing was marked on the way');
  await ctx.close();
}

// 2–3. The scripts' link and the pre-shoot form, on client A.
async function cardA(engine, { width = 360, device = null, name, solo = false }) {
  const db = office();
  const { page, ctx } = await signedIn(db, { path: `client.html?id=${encodeURIComponent(A)}`, width, device, engine });
  const S = `lf-s-${A}`;
  const url = page.locator(`#${S}-url`);
  await url.scrollIntoViewIfNeeded();
  await tall(url);
  await tall(page.locator(`#${S}-save`));
  await noOverflow(page);
  await shot(page.locator('#p12'), `card-scripts-empty-${name}`);
  // A Drive link, typed key by key: refused, in one sentence, the field marked.
  await type(url, 'https://drive.google.com/x');
  assert.equal(await url.inputValue(), 'https://drive.google.com/x');
  await page.locator(`#${S}-save`).click();
  assert.match(await text(page.locator(`#${S}-err`)), /זה לא קישור של Google Docs/);
  assert.equal(await url.getAttribute('aria-invalid'), 'true');
  assert.equal(db.clients.find((c) => c.id === A).links.scripts_doc, undefined);
  // Deleted with Backspace, key by key, and the right one typed.
  await backspace(url, 'https://drive.google.com/x'.length);
  assert.equal(await url.inputValue(), '');
  const DOC = 'https://docs.google.com/document/d/1AbC/edit';
  await type(url, DOC);
  assert.equal(await url.inputValue(), DOC);
  await page.locator(`#${S}-save`).click();
  await toastSays(page, /הקישור נשמר, ופריט התסריטים נסגר/);
  await settle(page);
  assert.equal(db.clients.find((c) => c.id === A).links.scripts_doc, DOC);
  const c12 = checkOf(db, A, 'p12.link');
  assert.deepEqual([c12?.state, c12?.note], ['done', SCRIPTS_AUTO_NOTE]);
  // The card: 12 is done, so it folds with the done ones ("1 תהליכים הושלמו (12)"); opened, it keeps
  // its one line: the link to open the file, and "החלפת הקישור".
  assert.equal(await page.locator('#p12').count(), 0, '12 folded away with the done ones');
  await page.locator('button.done-row', { hasText: '(12' }).click();
  await page.waitForSelector('#p12 .lf-scripts');
  assert.match(await text(page.locator('#p12 .lf-scripts')), /פתיחת קובץ התסריטים/);
  assert.equal(await page.locator(`#${S}-open`).getAttribute('href'), DOC);
  await page.locator('#p12').scrollIntoViewIfNeeded();
  await shot(page.locator('#p12'), `card-scripts-closed-${name}`);

  // The pre-shoot form.
  const P = 'lf-p-p36-form';
  const addr = page.locator(`#${P}-address`);
  await addr.scrollIntoViewIfNeeded();
  for (const sel of [`#${P}-at`, `#${P}-address`, `#${P}-save`, `label[for="${P}-inf-yes"]`]) await tall(page.locator(sel));
  assert.equal(await page.locator(`#${P}-at`).inputValue(), '2026-10-28T11:00');
  assert.equal(await page.locator(`#${P}-photographer`).inputValue(), 'eli', 'Eli by default');
  await shot(page.locator('#p36'), `card-preshoot-empty-${name}`);
  // Saving with nothing chosen: the first missing thing, in words.
  await page.locator(`#${P}-save`).click();
  assert.match(await text(page.locator(`#${P}-err`)), /חסרה הכתובת/);
  await type(addr, 'הרצל 12, חיפהה');
  await backspace(addr, 1);
  assert.equal(await addr.inputValue(), 'הרצל 12, חיפה');
  if (!solo) {
    await page.locator(`label[for="${P}-inf-yes"]`).click();
    assert.equal(await page.locator(`#${P}-photographer`).isDisabled(), true, 'with influencers Eli films');
    await page.locator(`#${P}-save`).click();
    assert.match(await text(page.locator(`#${P}-err`)), /אילו משפיענים/);
    await page.selectOption(`#${P}-influencer`, 'natali');
  } else {
    await page.locator(`label[for="${P}-inf-no"]`).click();
    assert.equal(await page.locator(`#${P}-photographer`).isDisabled(), false);
    await page.selectOption(`#${P}-photographer`, 'eliel');
  }
  await shot(page.locator('#p36'), `card-preshoot-filled-${name}`);
  await page.locator(`#${P}-save`).click();
  await toastSays(page, /הטופס המקדים נשמר/);
  await settle(page);
  const a = db.clients.find((c) => c.id === A);
  assert.equal(a.address, 'הרצל 12, חיפה');
  assert.equal(new Date(a.shoot_at).toISOString(), new Date('2026-10-28T11:00:00+02:00').toISOString());
  if (!solo) assert.deepEqual([a.shoot_type, a.deliverables?.shoot_crew], ['natali', undefined]);
  else assert.deepEqual([a.shoot_type, a.deliverables?.shoot_crew, a.deliverables?.videos], [null, 'eliel', 8]);
  const c36 = checkOf(db, A, 'p36.form');
  assert.deepEqual([c36?.state, c36?.note], ['done', PRESHOOT_NOTE]);
  assert.match(await text(page.locator('#p36 .lf-saved')), solo ? /הרצל 12, חיפה · בלי משפיענים · אליאל/ : /הרצל 12, חיפה · נטלי דדון/);
  await page.locator('#p36').scrollIntoViewIfNeeded();
  await shot(page.locator('#p36'), `card-preshoot-saved-${name}`);
  await noOverflow(page);
  await shot(page, `card-A-${name}`, { fullPage: true });
  await ctx.close();
}

// 4. The campaign, on client B.
async function cardB(engine, { width = 360, device = null, name }) {
  const db = office();
  const { page, ctx } = await signedIn(db, { path: `client.html?id=${encodeURIComponent(B)}#p30`, width, device, engine });
  const C = 'lf-c-p30-live';
  const budget = page.locator(`#${C}-budget`);
  await budget.scrollIntoViewIfNeeded();
  for (const sel of [`#${C}-start`, `#${C}-budget`, `#${C}-save`]) await tall(page.locator(sel));
  await noOverflow(page);
  await shot(page.locator('#p30'), `card-campaign-empty-${name}`);
  await page.locator(`#${C}-save`).click();
  assert.match(await text(page.locator(`#${C}-err`)), /חסר תאריך ההתחלה/);
  await page.fill(`#${C}-start`, '2026-10-22');
  await page.locator(`#${C}-save`).click();
  assert.match(await text(page.locator(`#${C}-err`)), /חסר התקציב היומי/);
  assert.equal(await budget.getAttribute('aria-invalid'), 'true');
  await type(budget, '15000');
  await backspace(budget, 2);
  assert.equal(await budget.inputValue(), '150');
  await shot(page.locator('#p30'), `card-campaign-filled-${name}`);
  await page.locator(`#${C}-save`).click();
  await toastSays(page, /נשמר: התחלה: 22\.10\.2026 · 150 ₪ ליום/);
  await settle(page);
  const c30 = checkOf(db, B, 'p30.live');
  assert.deepEqual([c30?.state, c30?.note], ['done', '{"start":"2026-10-22","budget":150}']);
  assert.match(await text(page.locator('#p30 .lf-saved')), /התחלה: 22\.10\.2026 · 150 ₪ ליום/);
  // "עריכה" opens the fields with the saved values; a change keeps the mark and its new note.
  await page.locator(`#${C}-edit`).click();
  assert.equal(await page.locator(`#${C}-budget`).inputValue(), '150');
  await backspace(page.locator(`#${C}-budget`), 1);
  await type(page.locator(`#${C}-budget`), '5');
  assert.equal(await page.locator(`#${C}-budget`).inputValue(), '155');
  await page.locator(`#${C}-save`).click();
  await toastSays(page, /155 ₪ ליום/);
  assert.equal(checkOf(db, B, 'p30.live').note, '{"start":"2026-10-22","budget":155}');
  await page.locator('#p30').scrollIntoViewIfNeeded();
  await shot(page.locator('#p30'), `card-campaign-saved-${name}`);
  await shot(page, `card-B-${name}`, { fullPage: true });
  await ctx.close();
}

const chrome = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const wk = await webkit.launch();
try {
  await step('1 Lior\'s list (Chromium 360): 12, 11ג and 30, nothing that left', () => mine(chrome, { width: 360, name: 'phone' }));
  await step('1 Lior\'s list (Chromium 1280)', () => mine(chrome, { width: 1280, name: 'web' }));
  await step('1 Lior\'s list (WebKit, iPhone 13)', () => mine(wk, { device: devices['iPhone 13'], name: 'iphone' }));
  await step('1 the campaign\'s tick leads to its card', () => campaignTick(chrome));
  await step('2–3 scripts link and pre-shoot form, typed key by key (Chromium 360, with influencers)', () => cardA(chrome, { width: 360, name: 'phone' }));
  await step('2–3 the same on a desktop (Chromium 1280, without influencers: Eliel)', () => cardA(chrome, { width: 1280, name: 'web', solo: true }));
  await step('2–3 the same on WebKit as an iPhone 13 (without influencers)', () => cardA(wk, { device: devices['iPhone 13'], name: 'iphone', solo: true }));
  await step('4 the campaign, typed key by key (Chromium 360)', () => cardB(chrome, { width: 360, name: 'phone' }));
  await step('4 the campaign (Chromium 1280)', () => cardB(chrome, { width: 1280, name: 'web' }));
  await step('4 the campaign (WebKit, iPhone 13)', () => cardB(wk, { device: devices['iPhone 13'], name: 'iphone' }));
  await step('no page error and no CSP violation', async () => { assert.deepEqual(errors, []); noCspViolations(); });
  console.log(`\n${passed} passed`);
} finally {
  await chrome.close();
  await wk.close();
}
