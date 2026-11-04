// A monthly client's editing round in the browser (the owner's decision of 4.11.2026; docs/ops.md,
// section 94), against the office of tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in Israel;
// invented names). The round is the one the reminders function writes (app/monthly-rounds.js
// monthlyRoundPlan, applied as the database would), for October, whose own number is 12:
//   1  Anna (editor.html) on an iPhone 13 (WebKit) and on Chromium at 360px: the month's card,
//      "אלאור בוטיק · אוקטובר 2026", "בעריכה", "12 סרטונים החודש", the counter "מתוך 12", and
//      "מוכן לבדיקה" straight away (no "קיבלתי את הכונן"); the hand-off with the folder's link typed
//      key by key (and corrected with Backspace) reaches Ofir: the round's p24.notify;
//   2  the same page at 1280px;
//   3  the client card (the owner, 390px and 1280px): the phase "עריכה חודשית · אוקטובר 2026", no shoot day
//      to set, the first stations done, the editing open with Anna; "ימי צילום" counts the real one.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: node <a static server> . 8431 &  then  BASE_URL=http://localhost:8431/ node tests/monthly-editing-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { importKeys } from '../app/client-open.js';
import { monthlyRoundPlan } from '../app/monthly-rounds.js';

const BASE = process.env.BASE_URL || 'http://localhost:8431/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = async (target, name, opts = {}) => { if (SHOTS) await target.screenshot({ path: `${OUT}${name}.png`, ...opts }); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const M = cid(91);
const CARD = `c-${M}-r2`;

function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  for (const t of ['protocol_checks', 'client_tasks', 'deal_requests', 'client_gantt', 'client_scripts', 'client_access_links', 'client_status_links', 'client_status_views', 'client_approvals', 'client_surveys', 'client_consents']) db[t] = [];
  db.editor_progress = [];
  db.editor_progress_month = [{ client_id: M, editor: 'anna', month: '2026-10', edited: 3, updated_at: '2026-10-19T12:00:00+03:00' }];
  const c = {
    ...base, id: M, name: 'ניב בן שימול', business: 'אלאור בוטיק', editor: 'anna', editor2: null, editor_split: null, rounds: [],
    links: { drive: 'https://drive.google.com/drive/folders/elior' }, landing: false, landed_at: null, landed_by: null, landing_slot: null, protocol_version: 12,
    shoot_type: 'dms', characterizer: 'ofir', has_logo: true, created_by_email: emailOf('irit'), deal_at: '2026-08-01T09:00:00+03:00', char_at: '2026-08-04T10:00:00+03:00',
    shoot_at: '2026-09-10T11:00:00+03:00', contract_end: '2027-08-01', status: 'active', updated_at: '2026-10-01T09:00:00+03:00',
    deliverables: { videos_month: 8, videos_month_except: { '2026-10': 12 }, shoot_monthly: true },
  };
  // Its first cycle is behind it; this month has no shoot round.
  const checks = Object.fromEntries(importKeys('ongoing').map((k) => [k, { client_id: M, item_key: k, state: 'done', note: 'ייבוא', by_email: emailOf('irit'), at: '2026-09-20T09:00:00+03:00' }]));
  // What the reminders function writes this morning.
  const plan = monthlyRoundPlan(c, checks, NOW);
  assert.ok(plan && plan.rounds, 'the month is opened');
  c.rounds = plan.rounds;
  db.protocol_checks.push(...Object.values(checks), ...plan.marks.map((m) => ({ client_id: M, ...m, by_email: 'system', at: NOW.toISOString() })));
  db.clients = [c];
  return db;
}

async function signedIn(db, { path, person, width = 360, device = null, engine }) {
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
  await page.fill('#lg-email', emailOf(person));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector(path.startsWith('editor') ? `#${CARD}` : '#cc-head h1');
  await settle(page);
  if (SHOTS) await page.waitForTimeout(900); // the sign-in screen has faded out
  return { page, ctx, fake };
}
const checkOf = (db, key) => db.protocol_checks.find((r) => r.client_id === M && r.item_key === key) || null;
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page scrolls sideways');
const tall = async (loc) => assert.ok((await loc.boundingBox()).height >= 44, 'a 44px target');
const type = async (loc, value) => { await loc.click(); await loc.press('End'); await loc.pressSequentially(value, { delay: 15 }); };
const backspace = async (loc, n) => { await loc.click(); await loc.press('End'); for (let i = 0; i < n; i += 1) await loc.press('Backspace'); };

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

// 1–2. Anna's page.
async function editorPage(engine, { width = 360, device = null, name, handOff = true }) {
  const db = office();
  const { page, ctx } = await signedIn(db, { path: 'editor.html', person: 'anna', width, device, engine });
  const card = page.locator(`#${CARD}`);
  assert.equal(await page.locator('.ed-card').count(), 1, 'one card: the month\'s (the first cycle is closed)');
  assert.equal(await text(card.locator('h2')), 'ניב בן שימול · אוקטובר 2026 אלאור בוטיק');
  assert.equal(await text(card.locator('.ed-state')), 'בעריכה');
  assert.equal(await text(card.locator(`#${CARD}-month`)), '12 סרטונים החודש');
  assert.equal(await page.locator(`#${CARD}-edited`).inputValue(), '3');
  assert.match(await page.locator(`#${CARD}-edited`).getAttribute('aria-label'), /החודש מתוך 12/);
  const go = card.locator(`#${CARD}-go`);
  assert.equal(await text(go), 'מוכן לבדיקה');
  assert.equal(await card.getByText('קיבלתי את הכונן').count(), 0, 'no drive to receive');
  await tall(go);
  await noOverflow(page);
  await shot(page, `editor-${name}`, { fullPage: true });
  if (handOff) {
    await go.click();
    await page.waitForSelector('#dlg-ready[open]');
    const link = page.locator('#ready-link');
    await link.fill('');
    await type(link, 'https://drive.google.com/drive/folders/oct-xx');
    await backspace(link, 3);
    assert.equal(await link.inputValue(), 'https://drive.google.com/drive/folders/oct');
    await page.locator('#ready-all').check();
    await shot(page, `editor-ready-${name}`);
    await page.locator('#ready-submit').click();
    await page.waitForFunction((id) => document.querySelector(`#${id} .ed-state`)?.textContent.includes('אצל אופיר'), CARD);
    assert.equal(checkOf(db, 'r2.p24.notify')?.state, 'done');
    assert.equal(checkOf(db, 'r2.p24.drive')?.note, 'https://drive.google.com/drive/folders/oct');
    assert.equal(checkOf(db, 'p24.notify')?.note, 'ייבוא', 'the first cycle untouched');
    await shot(page, `editor-sent-${name}`, { fullPage: true });
  }
  await ctx.close();
}

// 3. The client card, as the owner (the whole protocol).
async function clientCard(engine, { width, name }) {
  const db = office();
  const { page, ctx } = await signedIn(db, { path: `client.html?id=${encodeURIComponent(M)}`, person: 'owner', width, engine });
  const phase = page.locator('details.phase.is-round');
  assert.equal(await phase.count(), 1);
  assert.equal(await text(phase.locator('h2')), 'עריכה חודשית · אוקטובר 2026');
  if (!(await phase.getAttribute('open') !== null)) await phase.locator('summary').click();
  const head = page.locator('#round-head-2');
  assert.match(await text(head), /נפתח לבד בתחילת החודש, ישר לעריכה אצל אנה\. בלי יום צילום\./);
  assert.equal(await head.getByText('עריכת הסבב').count(), 0);
  assert.equal(await phase.getByText('מועד יום הצילום טרם נקבע').count(), 0);
  assert.equal(await phase.locator('.ph-need').count(), 0, 'no missing shoot details');
  assert.equal(await phase.locator('#r2-p11').count(), 0, 'no shoot day to set: 11 is behind it');
  assert.ok(await phase.locator('#r2-p22').count() === 1, 'the editing is open');
  assert.match(await text(phase.locator('#r2-p22')), /אנה/);
  await phase.scrollIntoViewIfNeeded();
  await noOverflow(page);
  await shot(page, `card-${name}`, { fullPage: true });
  await shot(phase, `card-phase-${name}`);
  await ctx.close();
}

const engines = { chromium: await chromium.launch(), webkit: await webkit.launch() };
try {
  await step('Anna on an iPhone 13 (WebKit): the month\'s card, "מוכן לבדיקה", the hand-off to Ofir', () => editorPage(engines.webkit, { device: devices['iPhone 13'], name: 'iphone13' }));
  await step('Anna on Chromium 360: the same', () => editorPage(engines.chromium, { width: 360, name: 'chromium360' }));
  await step('Anna at 1280', () => editorPage(engines.chromium, { width: 1280, name: 'web1280', handOff: false }));
  await step('the client card (the owner, 390)', () => clientCard(engines.chromium, { width: 390, name: '390' }));
  await step('the client card (the owner, 1280)', () => clientCard(engines.chromium, { width: 1280, name: '1280' }));
  await step('no page errors and no CSP violations', () => { assert.deepEqual(errors, []); noCspViolations(); });
} finally {
  await engines.chromium.close();
  await engines.webkit.close();
}
console.log(`\n${passed} passed`);
