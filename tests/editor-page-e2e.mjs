// The editors' page in the browser, the owner's requests of 4.11.2026 (docs/ops.md, section 97),
// against the office of tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in Israel; invented names).
// Anna has five open jobs:
//   - "ניב בן שימול" (a monthly client): its own first editing, assigned 15.9 and still in editing,
//     and October's monthly round (app/monthly-rounds.js, opened this morning). Its numbers from
//     before: October's row 3 (both cards showed it until the fix; now the round's), September's
//     row 5 (where the first job kept its number in September);
//   - one more in editing (assigned 8.10), and three that wait for someone else: with Ofir
//     (assigned 1.10), with the client (5.10), with Ilai (20.9).
// On an iPhone 13 (WebKit), on Chromium at 360px and at 1280px:
//   1  each card counts its own work: typing key by key (and deleting) in one counter changes only
//      that card, and saves only its own row;
//   2  the three that wait are in one closed fold at the end, "מחכים לבדיקה (3)", 44px, that opens
//      on a tap; each a short line, its full card under it on a tap;
//   3  the toggle "מהישן לחדש" / "מהחדש לישן" flips both lists, and the page remembers it.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: node <a static server> . 8431 &  then  BASE_URL=http://localhost:8431/ node tests/editor-page-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { monthlyRoundPlan } from '../app/monthly-rounds.js';

const BASE = process.env.BASE_URL || 'http://localhost:8431/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const errors = [];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = async (target, name, opts = {}) => { if (SHOTS) await target.screenshot({ path: `${OUT}${name}.png`, ...opts }); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const M = cid(91);
const [QA, CL, IL, ED] = [cid(92), cid(93), cid(94), cid(95)];
const FIRST = `c-${M}`;
const ROUND = `c-${M}-r2`;

function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  for (const t of ['protocol_checks', 'client_tasks', 'deal_requests', 'client_gantt', 'client_scripts', 'client_access_links', 'client_status_links', 'client_status_views', 'client_approvals', 'client_surveys', 'client_consents']) db[t] = [];
  db.editor_progress = [];
  db.editor_progress_month = [
    { client_id: M, editor: 'anna', month: '2026-10', edited: 3, updated_at: '2026-10-19T12:00:00+03:00' },
    { client_id: M, editor: 'anna', month: '2026-09', edited: 5, updated_at: '2026-09-29T12:00:00+03:00' },
  ];
  const client = (id, name, business, extra = {}) => ({
    ...base, id, name, business, editor: 'anna', editor2: null, editor_split: null, rounds: [],
    links: { drive: `https://drive.google.com/drive/folders/${id.slice(-2)}` }, landing: false, landed_at: null, landed_by: null, landing_slot: null, protocol_version: 12,
    shoot_type: 'dms', characterizer: 'ofir', has_logo: true, created_by_email: emailOf('irit'), deal_at: '2026-08-01T09:00:00+03:00', char_at: '2026-08-04T10:00:00+03:00',
    shoot_at: '2026-09-10T11:00:00+03:00', contract_end: '2027-08-01', status: 'active', updated_at: '2026-10-01T09:00:00+03:00', ...extra,
  });
  const mark = (id, key, at, by = 'anna') => ({ client_id: id, item_key: key, state: 'done', note: null, by_email: emailOf(by), at });
  const m = client(M, 'ניב בן שימול', 'אלאור בוטיק', { deliverables: { videos_month: 8, videos_month_except: { '2026-10': 12 }, shoot_monthly: true } });
  const mChecks = { 'p22a.assigned': mark(M, 'p22a.assigned', '2026-09-15T09:00:00+03:00', 'ofir'), 'p22.received': mark(M, 'p22.received', '2026-09-15T11:00:00+03:00') };
  const plan = monthlyRoundPlan(m, mChecks, NOW);
  assert.ok(plan && plan.rounds, 'October is opened');
  m.rounds = plan.rounds;
  db.protocol_checks.push(...Object.values(mChecks), ...plan.marks.map((x) => ({ client_id: M, ...x, by_email: 'system', at: NOW.toISOString() })));
  const others = [
    [QA, 'רון אלון', 'אלון פרחים', '2026-10-01T09:00:00+03:00', [['p22.received', '2026-10-01T10:00:00+03:00'], ['p24.notify', '2026-10-19T14:00:00+03:00']]],
    [CL, 'שירה לוי', 'לוי קפה', '2026-10-05T09:00:00+03:00', [['p22.received', '2026-10-05T10:00:00+03:00'], ['p24.notify', '2026-10-07T14:00:00+03:00'], ['p25.approved', '2026-10-19T16:00:00+03:00', 'ofir']]],
    [IL, 'דן כהן', 'כהן מוסך', '2026-09-20T09:00:00+03:00', [['p22.received', '2026-09-20T10:00:00+03:00'], ['p24.notify', '2026-09-22T14:00:00+03:00'], ['p25.approved', '2026-09-23T16:00:00+03:00', 'ofir'], ['p27.approved', '2026-10-01T10:00:00+03:00', 'irit'], ['p27.final', '2026-10-20T09:00:00+03:00']]],
    [ED, 'מאיה בר', 'בר סטודיו', '2026-10-08T09:00:00+03:00', [['p22.received', '2026-10-08T10:00:00+03:00']]],
  ];
  db.clients = [m];
  for (const [id, name, business, assigned, marks] of others) {
    db.clients.push(client(id, name, business, { deliverables: { videos: 10 } }));
    db.protocol_checks.push(mark(id, 'p22a.assigned', assigned, 'ofir'), ...marks.map(([k, at, by]) => mark(id, k, at, by)));
  }
  return db;
}

// The two ways to write a number (20261101100000_editor_progress.sql, 20261104100000_editor_progress_month.sql),
// as the database checks them, for Anna (the only one signed in here): the editor of that shoot
// (round 1: the client's; a round: the round's), and a month only this one or the one before.
function withProgress(db, fake) {
  const route = async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const name = req.method() === 'POST' && ['/rest/v1/rpc/editor_progress_set', '/rest/v1/rpc/editor_progress_month_set'].includes(p) ? p.slice('/rest/v1/rpc/'.length) : null;
    if (!name) return fake.route(r);
    const json = (status, data) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: CORS });
    const body = JSON.parse(req.postData() || '{}');
    const c = db.clients.find((x) => x.id === body.p_client);
    const round = body.p_round || 1;
    const editor = round === 1 ? c?.editor : c?.rounds.find((x) => x.n === round)?.editor;
    if (!c || editor !== 'anna' || (name === 'editor_progress_month_set' && (c.editor !== 'anna' || !['2026-10', '2026-09'].includes(body.p_month)))) return json(403, { code: '42501', message: 'not allowed' });
    const table = name === 'editor_progress_set' ? db.editor_progress : db.editor_progress_month;
    const match = name === 'editor_progress_set' ? (x) => x.round === round : (x) => x.month === body.p_month;
    let row = table.find((x) => x.client_id === c.id && x.editor === 'anna' && match(x));
    if (!row) table.push(row = { client_id: c.id, editor: 'anna', ...(name === 'editor_progress_set' ? { round } : { month: body.p_month }) });
    Object.assign(row, { edited: body.p_edited, updated_at: new Date().toISOString(), updated_by: emailOf('anna') });
    return json(200, row);
  };
  return { ...fake, route };
}

async function signedIn(db, { width = 360, device = null, engine, sort = null }) {
  const fake = withProgress(db, makeFlowFake(db));
  const ctx = device
    ? await engine.newContext({ ...device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })
    : await engine.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width, height: width < 600 ? 780 : 900 }, isMobile: width < 600, hasTouch: width < 600 });
  await ctx.clock.install({ time: NOW });
  if (sort) await ctx.addInitScript((v) => { try { localStorage.setItem('astrateg.editor.sort', v); } catch { /* none */ } }, sort);
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`editor: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`editor: ${msg.text()}`); });
  await page.goto(`${BASE}editor.html`);
  await page.fill('#lg-email', emailOf('anna'));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector(`#${ROUND}`);
  await settle(page);
  if (SHOTS) await page.waitForTimeout(900); // the sign-in screen has faded out
  return { page, ctx };
}
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page scrolls sideways');
const tall = async (loc) => assert.ok((await loc.boundingBox()).height >= 44, 'a 44px target');
const openOrder = (page) => page.$$eval('#ed-list > .ed-card', (els) => els.map((e) => e.id));
const foldOrder = (page) => page.$$eval('#ed-waits .ed-wline', (els) => els.map((e) => e.id.replace(/-w$/, '')));
const monthRow = (db, month) => db.editor_progress_month.find((r) => r.client_id === M && r.editor === 'anna' && r.month === month) || null;
const jobRow = (db, round) => db.editor_progress.find((r) => r.client_id === M && r.editor === 'anna' && r.round === round) || null;

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

async function editorPage(engine, { width = 360, device = null, name }) {
  const db = office();
  const { page, ctx } = await signedIn(db, { width, device, engine });
  const first = page.locator(`#${FIRST}-edited`);
  const round = page.locator(`#${ROUND}-edited`);

  // 1. Two cards of the same monthly client, each its own number.
  assert.equal(await text(page.locator(`#${FIRST} h2`)), 'ניב בן שימול אלאור בוטיק');
  assert.equal(await text(page.locator(`#${ROUND} h2`)), 'ניב בן שימול · אוקטובר 2026 אלאור בוטיק');
  assert.equal(await round.inputValue(), '3', 'October\'s number is the round\'s');
  assert.equal(await first.inputValue(), '5', 'the first job keeps the number of the month it was assigned in');
  assert.equal(await text(page.locator(`#${ROUND}-month`)), '12 סרטונים החודש');
  assert.equal(await text(page.locator(`#${FIRST}-month`)), '8 סרטונים · ספטמבר 2026', 'the first job: its own month, as its counter');
  // Key by key in the round's counter, with deletes: the first card never moves.
  await round.click();
  await round.press('End');
  const seen = [];
  for (const key of ['Backspace', '1', '1', 'Backspace', '2']) {
    await round.press(key);
    seen.push(await round.inputValue());
    assert.equal(await first.inputValue(), '5', `the first card after "${key}"`);
  }
  assert.deepEqual(seen, ['', '1', '11', '1', '12']);
  await page.waitForFunction((id) => document.getElementById(`${id}-edited-s`)?.textContent === 'נשמר', ROUND);
  assert.equal(monthRow(db, '2026-10')?.edited, 12, 'October saved');
  assert.equal(jobRow(db, 1), null, 'nothing written for the first job');
  assert.equal(await first.inputValue(), '5');
  // And the other way: the first card's counter writes its own job only.
  await first.click();
  await first.press('End');
  await first.press('Backspace');
  assert.equal(await round.inputValue(), '12');
  await first.pressSequentially('7', { delay: 30 });
  assert.equal(await round.inputValue(), '12');
  await page.waitForFunction((id) => document.getElementById(`${id}-edited-s`)?.textContent === 'נשמר', FIRST);
  assert.equal(jobRow(db, 1)?.edited, 7, 'the first job: its own row');
  assert.equal(monthRow(db, '2026-10')?.edited, 12, 'October untouched');
  assert.equal(monthRow(db, '2026-09')?.edited, 5, 'September untouched');
  assert.equal(await round.inputValue(), '12');
  await page.locator('#ed-sort').focus(); // away from the counters

  // 2. The fold: closed, at the end, the right count, 44px.
  const fold = page.locator('#ed-waits');
  assert.equal(await fold.count(), 1);
  assert.equal(await fold.evaluate((d) => d.open), false, 'closed by default');
  assert.equal(await fold.evaluate((d) => d === d.parentElement.lastElementChild), true, 'at the end of the list');
  assert.equal(await text(page.locator('#ed-waits-s')), 'מחכים לבדיקה (3)');
  await tall(page.locator('#ed-waits-s'));
  assert.equal(await page.locator(`#c-${QA}`).isVisible(), false, 'its cards are not on the page while closed');
  // 3. The open cards, oldest assignment first.
  assert.deepEqual(await openOrder(page), [FIRST, `c-${ED}`, ROUND]);
  assert.equal(await text(page.locator('#ed-sort')), 'מהישן לחדש');
  await tall(page.locator('#ed-sort'));
  await noOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, `${name}-old-fold-closed`, { fullPage: true });
  await page.locator('#ed-sort').scrollIntoViewIfNeeded();
  await shot(page, `${name}-old-top`);
  await fold.evaluate((d) => d.scrollIntoView({ block: 'center' }));
  await shot(page, `${name}-old-fold-closed-view`);

  await page.locator('#ed-waits-s').click();
  assert.equal(await fold.evaluate((d) => d.open), true, 'opens on a tap');
  assert.deepEqual(await foldOrder(page), [`c-${IL}`, `c-${QA}`, `c-${CL}`], 'oldest first inside too');
  const line = page.locator(`#c-${QA}-w > summary`);
  assert.match(await text(line), /^רון אלון אצל אופיר לבקרה מאז אתמול 14:00$/);
  assert.match(await text(page.locator(`#c-${CL}-w > summary`)), /^שירה לוי אצל הלקוח לאישור מאז אתמול 16:00$/);
  assert.match(await text(page.locator(`#c-${IL}-w > summary`)), /^דן כהן אצל עילאי מאז היום 09:00$/);
  for (const id of [QA, CL, IL]) await tall(page.locator(`#c-${id}-w > summary`));
  assert.equal(await page.locator(`#c-${QA}`).isVisible(), false, 'the card waits under its line');
  await line.click();
  assert.equal(await page.locator(`#c-${QA}`).isVisible(), true, 'the full card on a tap');
  assert.match(await text(page.locator(`#c-${QA} .ed-wait`)), /אצל אופיר מאז אתמול 14:00/);
  await noOverflow(page);
  await fold.scrollIntoViewIfNeeded();
  await shot(page, `${name}-old-fold-open`, { fullPage: true });
  await page.locator('#ed-waits-s').evaluate((d) => d.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -90));
  await shot(page, `${name}-old-fold-open-view`);

  // 3. The toggle flips both lists, and stays flipped after a reload.
  await page.locator('#ed-sort').click();
  assert.equal(await text(page.locator('#ed-sort')), 'מהחדש לישן');
  assert.deepEqual(await openOrder(page), [ROUND, `c-${ED}`, FIRST]);
  assert.deepEqual(await foldOrder(page), [`c-${CL}`, `c-${QA}`, `c-${IL}`]);
  assert.equal(await fold.evaluate((d) => d.open), true, 'the fold stays as it was');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'ed-sort', 'the focus stays on the toggle');
  assert.equal(await page.evaluate(() => localStorage.getItem('astrateg.editor.sort')), 'new');
  await noOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, `${name}-new-fold-open`, { fullPage: true });
  await shot(page, `${name}-new-top`);
  // Closed again, in the new order.
  await page.locator('#ed-waits-s').click();
  assert.equal(await fold.evaluate((d) => d.open), false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, `${name}-new-fold-closed`, { fullPage: true });
  await page.locator('#ed-sort').click();
  assert.equal(await text(page.locator('#ed-sort')), 'מהישן לחדש');
  assert.deepEqual(await openOrder(page), [FIRST, `c-${ED}`, ROUND]);
  assert.equal(await page.evaluate(() => localStorage.getItem('astrateg.editor.sort')), 'old');
  await ctx.close();
}

// A new visit on a device that chose "מהחדש לישן": the page opens in that order, the fold closed.
async function remembered(engine) {
  const db = office();
  const { page, ctx } = await signedIn(db, { width: 360, engine, sort: 'new' });
  assert.equal(await text(page.locator('#ed-sort')), 'מהחדש לישן');
  assert.deepEqual(await openOrder(page), [ROUND, `c-${ED}`, FIRST]);
  assert.equal(await page.locator('#ed-waits').evaluate((d) => d.open), false);
  await ctx.close();
}

// A link to a card in the fold (#c-<id>) opens the fold and its line.
async function linkIntoFold(engine) {
  const db = office();
  const { page, ctx } = await signedIn(db, { width: 1280, engine });
  await page.evaluate((id) => { location.hash = `c-${id}`; }, CL);
  await page.waitForFunction(() => document.getElementById('ed-waits')?.open === true);
  assert.equal(await page.locator(`#c-${CL}`).isVisible(), true);
  await ctx.close();
}

const engines = { chromium: await chromium.launch(), webkit: await webkit.launch() };
try {
  await step('iPhone 13 (WebKit): own counters, the fold, the order', () => editorPage(engines.webkit, { device: devices['iPhone 13'], name: 'iphone13' }));
  await step('Chromium 360: the same', () => editorPage(engines.chromium, { width: 360, name: 'chromium360' }));
  await step('Chromium 1280: the same', () => editorPage(engines.chromium, { width: 1280, name: 'web1280' }));
  await step('the order is remembered on the device', () => remembered(engines.chromium));
  await step('a link to a card in the fold opens it', () => linkIntoFold(engines.chromium));
  await step('no page errors and no CSP violations', () => { assert.deepEqual(errors, []); noCspViolations(); });
} finally {
  await engines.chromium.close();
  await engines.webkit.close();
}
console.log(`\n${passed} passed`);
