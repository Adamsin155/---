// The fixes the owner approved after the full-flow simulation (docs/ops.md, section 49;
// protocol version 8), in the browser, on a phone (390px), each role signed in as itself,
// starting from "המשימות שלי". The office is small and invented; the clock is Tuesday
// 20.10.2026, 10:00 in Israel (tests/flow-world.mjs).
//   5  Irit's two link steps (5ב, 7א) with "העתקת הקישור"; process 5 asks about the other
//      networks and "אין עוד" closes it;
//   6  the review of the 9 graphics is Irit's alone, with its own deadline; the daily
//      follow-up before the shoot day: one counted line, one row per client;
//   7  the guards: an empty Gantt, nothing scheduled, no script; the weekly call's row
//      leads to its dialog;
//   8  the shoot date in three taps from Irit's card, with the photographer's free days;
//   and a client in landing or with imported history shows none of it.
// Screenshots (390px) go to docs/design/full-flow/ with the prefix s49- when SHOTS=1.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/flow-fixes-e2e.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { importKeys } from '../app/client-open.js';
import { PROCESSES } from '../app/protocol.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS === '1';
// SHOTS_OUT=<folder>: the screenshots go there instead of over the recorded ones (as SIM_OUT does for the simulation).
const OUT = process.env.SHOTS_OUT ? `${process.env.SHOTS_OUT.replace(/[\\/]+$/, '')}/` : fileURLToPath(new URL('../docs/design/full-flow/', import.meta.url));
const PHONE = { width: 390, height: 844 };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = async (target, name) => { if (SHOTS) await target.screenshot({ path: `${OUT}s49-${name}.png` }); };

const [NEW, GFX, SOON, PUBLISH, SCRIPTS, ONGOING, LANDING, OLD] = [51, 52, 53, 54, 55, 56, 57, 58].map(cid);
const itemsOf = (...ids) => PROCESSES.filter((p) => ids.includes(p.id)).flatMap((p) => p.items.filter((i) => !i.optional).map((i) => i.key));

function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  db.protocol_checks = [];
  db.client_tasks = [];
  db.deal_requests = [];
  db.client_gantt = [];
  db.client_scripts = [];
  db.client_access_links = [];
  db.client_status_links = [];
  db.client_status_views = [];
  db.client_approvals = [];
  db.client_surveys = [];
  db.client_consents = [];
  // Eli handed his October and November over.
  db.photographer_months = [
    { person: 'eli', month: '2026-10-01', days: ['2026-10-22', '2026-10-27', '2026-10-28'], none: false, submitted_at: '2026-09-14T10:00:00+03:00', updated_at: '2026-09-14T10:00:00+03:00', by_person: 'eli' },
    { person: 'eli', month: '2026-11-01', days: ['2026-11-03', '2026-11-04'], none: false, submitted_at: '2026-10-14T10:00:00+03:00', updated_at: '2026-10-14T10:00:00+03:00', by_person: 'eli' },
  ];
  const mk = (id, fields) => ({
    ...base, id, editor: null, rounds: [], links: {}, landing: false, landed_at: null, landed_by: null, landing_slot: null, protocol_version: 8,
    shoot_type: 'dms', characterizer: 'ofir', has_logo: true, shoot_at: null, created_by_email: emailOf('irit'), ...fields,
  });
  const mark = (id, keys, at, note = null, by = 'irit') => { for (const k of [].concat(keys)) db.protocol_checks.push({ client_id: id, item_key: k, state: 'done', note, by_email: emailOf(by), at }); };
  const imported = (id, station, keep = () => true) => mark(id, importKeys(station).filter(keep), '2026-10-12T09:00:00+03:00', 'ייבוא');

  // NEW: signed yesterday, the group and the meeting date set at once; the characterization
  // ended today at 09:30 with one login saved (Instagram). No shoot date yet.
  const fresh = mk(NEW, { name: 'רונית דקל', business: 'מאפיית הדקל', deal_at: '2026-10-19T09:00:00+03:00', char_at: '2026-10-20T08:00:00+03:00' });
  mark(NEW, itemsOf('p01', 'p02', 'p03'), '2026-10-19T09:04:00+03:00');
  mark(NEW, itemsOf('p04'), '2026-10-20T09:30:00+03:00', null, 'ofir');
  mark(NEW, 'p04.ended', '2026-10-20T09:30:00+03:00', 'האפיון הסתיים · לוגו: יש · Instagram: יש גישה תקינה', 'ofir');
  mark(NEW, 'p05.access', '2026-10-20T09:30:00+03:00', 'מסיום האפיון: Instagram', 'ofir');
  mark(NEW, ['p05.vault', 'p05.logo', 'p05.colors', 'p05.photos', 'p05.videos'], '2026-10-20T09:30:00+03:00', null, 'ofir');

  // GFX: the meeting was yesterday; Ilai handed the 9 graphics over twenty minutes ago.
  const gfx = mk(GFX, { name: 'גל אשכנזי', business: 'סטודיו גל', deal_at: '2026-10-15T09:00:00+03:00', char_at: '2026-10-19T10:00:00+03:00', shoot_at: '2026-11-03T10:00:00+02:00' });
  mark(GFX, itemsOf('p01', 'p02', 'p03', 'p11'), '2026-10-15T09:04:00+03:00');
  mark(GFX, itemsOf('p04', 'p05', 'p05b', 'p06', 'p08', 'p08b', 'p09', 'p10'), '2026-10-19T12:30:00+03:00', null, 'ofir');
  mark(GFX, 'p07.made', '2026-10-20T09:40:00+03:00', null, 'ilai');

  // SOON: shoots on Thursday; everything before the shoot is done.
  const soon = mk(SOON, { name: 'תומר לביא', business: 'לביא רכב', deal_at: '2026-10-08T09:00:00+03:00', char_at: '2026-10-11T10:00:00+03:00', shoot_at: '2026-10-22T10:00:00+03:00' });
  mark(SOON, itemsOf('p01', 'p02', 'p03', 'p11', 'p04', 'p05', 'p05b', 'p06', 'p07', 'p07a', 'p07b', 'p08', 'p08b', 'p09', 'p10', 'p12a', 'p12', 'p13'), '2026-10-13T12:00:00+03:00');

  // PUBLISH: the final versions are with Ilai: scheduling (28) and the Gantt (29) are his.
  const publish = mk(PUBLISH, { name: 'מיכל שגיא', business: 'שגיא אופטיקה', editor: 'nadia', deal_at: '2026-09-20T09:00:00+03:00', char_at: '2026-09-22T10:00:00+03:00', shoot_at: '2026-10-06T10:00:00+03:00', deliverables: { videos: 25, graphics: 35, shoot_days: 1 } });
  imported(PUBLISH, 'publish');

  // SCRIPTS: Lior wrote and numbered the scripts; "מסודרים בעמוד התסריטים" is left.
  const scripts = mk(SCRIPTS, { name: 'אורי בן דוד', business: 'בן דוד נגרות', deal_at: '2026-10-12T09:00:00+03:00', char_at: '2026-10-18T10:00:00+03:00', shoot_at: '2026-11-05T10:00:00+02:00' });
  imported(SCRIPTS, 'content');
  mark(SCRIPTS, [...itemsOf('p12a'), 'p12.scripts', 'p12.numbered'], '2026-10-19T15:00:00+03:00', null, 'lior');

  // ONGOING: a client in the weekly-call stage.
  const ongoing = mk(ONGOING, { name: 'שירן כהן', business: 'כהן נדל״ן', editor: 'anna', deal_at: '2026-08-01T09:00:00+03:00', char_at: '2026-08-03T10:00:00+03:00', shoot_at: '2026-08-18T10:00:00+03:00' });
  imported(ONGOING, 'ongoing');

  // LANDING: from the old system, still in landing; its meeting "ended" today all the same.
  const landing = mk(LANDING, { name: 'דנה קורן', business: 'קורן אדריכלות', landing: true, protocol_version: 7, created_by_email: 'system', deal_at: '2026-06-01T09:00:00+03:00', char_at: '2026-10-20T08:00:00+03:00', shoot_at: '2026-11-02T10:00:00+02:00' });
  mark(LANDING, itemsOf('p01', 'p02', 'p03', 'p04'), '2026-10-20T09:30:00+03:00');
  mark(LANDING, 'p07.made', '2026-10-20T09:40:00+03:00', null, 'ilai');

  // OLD: a client of version 7 that was imported in the middle of the editing, with no shoot date on record.
  const old = mk(OLD, { name: 'אבנר גולן', business: 'גולן מזגנים', editor: 'anna', protocol_version: 7, deal_at: '2026-06-01T09:00:00+03:00', char_at: '2026-06-03T10:00:00+03:00' });
  imported(OLD, 'post', (k) => !['p05b.sent', 'p05.allnets', 'p07a.sent'].includes(k));
  mark(OLD, ['p14.approvals', 'p14.scripts', 'p14.graphics'], '2026-10-12T09:00:00+03:00', 'ייבוא');

  db.clients = [fresh, gfx, soon, publish, scripts, ongoing, landing, old];
  return db;
}

// The fake of the flow world, with the links' own functions (made once, read back by id).
function fakeOf(db) {
  const fake = makeFlowFake(db);
  const made = { access: 0, status: 0 };
  const route = async (r) => {
    const req = r.request();
    const p = new URL(req.url()).pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    const json = (data) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: CORS });
    if (req.method() === 'OPTIONS') return fake.route(r);
    if (p === '/rest/v1/rpc/access_link_create') {
      made.access += 1;
      const row = { id: randomUUID(), client_id: body.p_client, token: `A${String(made.access).padStart(42, '0')}`, created_at: NOW.toISOString(), created_by: emailOf('irit'), expires_at: '2026-11-03T10:00:00+02:00', revoked_at: null, revoked_by: null, submitted_at: null, attempts: 0, summary: null, client_note: null };
      db.client_access_links.unshift(row);
      return json({ id: row.id, token: row.token, expiresAt: row.expires_at });
    }
    if (p === '/rest/v1/rpc/access_link_token') return json(db.client_access_links.find((l) => l.id === body.p_id)?.token || null);
    if (p === '/rest/v1/rpc/access_link_notes') return json([]);
    if (p === '/rest/v1/rpc/status_link_create') {
      made.status += 1;
      db.client_status_links.unshift({ id: randomUUID(), client_id: body.p_client, token: `S${String(made.status).padStart(42, '0')}`, created_at: NOW.toISOString(), created_by: emailOf('irit'), expires_at: '2027-10-20T10:00:00+03:00', revoked_at: null, revoked_by: null });
      return json(null);
    }
    if (p === '/rest/v1/rpc/status_link_token') return json(db.client_status_links.find((l) => l.id === body.p_id)?.token || null);
    return fake.route(r);
  };
  return { ...fake, route, made };
}

async function signedIn(role, db, path = 'clients.html#mine') {
  const fake = fakeOf(db);
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: PHONE, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
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
  if (path.includes('#mine')) await page.waitForSelector('#view-mine:not([hidden])');
  await settle(page);
  return { page, ctx, db, fake };
}
const card = (page, id, proc) => page.locator(`#mine-list .wproc[data-key="${id}:${proc}"]`);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const toastText = async (page) => (await page.locator('#toast').innerText()).replace(/\s+/g, ' ').trim();
const checkOf = (db, id, key) => db.protocol_checks.find((r) => r.client_id === id && r.item_key === key) || null;
// A long group of the list shows its first cards and "הצג עוד": open them all.
async function showAll(page) {
  await page.evaluate(() => { for (const d of document.querySelectorAll('#mine-list details')) d.open = true; }); // the later groups are folded
  for (let i = 0; i < 10 && await page.locator('#mine-list .more-btn:visible').count(); i += 1) await page.locator('#mine-list .more-btn:visible').first().click();
}
// The pill of a card whose first action is a page of its own sits under "פירוט": open it, then press.
async function tick(c) {
  const pill = c.locator('.cbx').first();
  if (!await pill.isVisible()) await c.locator('[aria-controls]').first().click();
  await pill.check();
}
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page scrolls sideways');

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

try {
  // ── FIX 5 ──
  await step('5: "לשלוח ללקוח קישור למילוי פרטי הכניסה" is a card of Irit with "העתקת הקישור"; one press makes and copies; "סיימתי" closes it', async () => {
    const { page, ctx, db, fake } = await signedIn('irit', office());
    const c = card(page, NEW, 'p05b');
    await c.waitFor();
    assert.match(await text(c), /5ב · קישור ללקוח למילוי פרטי הכניסה לרשתות/);
    assert.equal(await text(c.locator('.wlabel')), 'לשלוח ללקוח קישור למילוי פרטי הכניסה לרשתות');
    const btn = c.locator('.wlink button');
    assert.equal(await text(btn), 'העתקת הקישור');
    assert.ok((await btn.boundingBox()).height >= 44);
    await noOverflow(page);
    await shot(c, 'irit-access-link-card');
    await btn.click();
    await settle(page);
    assert.equal(fake.made.access, 1, 'the link is made by the press when there is none');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /access\.html#t=A0+1/);
    assert.match(copied, /רונית/);
    assert.match(await toastText(page), /נוצר קישור\. ההודעה עם הקישור הועתקה/);
    // A second press copies the same link: no second one is made.
    await card(page, NEW, 'p05b').locator('.wlink button').click();
    await settle(page);
    assert.equal(fake.made.access, 1);
    assert.match(await toastText(page), /^ההודעה עם הקישור הועתקה/);
    // "סיימתי": the step is closed and leaves her list.
    await card(page, NEW, 'p05b').locator('.cbx').check();
    await settle(page);
    assert.equal(checkOf(db, NEW, 'p05b.sent')?.state, 'done');
    assert.equal(await card(page, NEW, 'p05b').count(), 0);
    // Nobody else has the step; a client in landing and one with imported history do not have it at all.
    for (const id of [LANDING, OLD]) for (const p of ['p05b', 'p07a', 'p11']) assert.equal(await card(page, id, p).count(), 0, `${id} ${p}`);
    await ctx.close();
    for (const role of ['lior', 'ofir']) {
      const o = await signedIn(role, office());
      assert.equal(await card(o.page, NEW, 'p05b').count(), 0, role);
      assert.equal(await card(o.page, GFX, 'p07a').count(), 0, role);
      await o.ctx.close();
    }
  });

  // Protocol v9 (docs/ops.md, section 57): the 9 graphics go to Ofir's check first, on his fast ladder.
  await step('5: the 9 graphics are with Ofir first: Irit only sees where they are; once he approved, "לשלוח ללקוח קישור לדף הסטטוס" opens and the sending is hers', async () => {
    const { page, ctx, db, fake } = await signedIn('irit', office());
    // Ilai handed them over at 09:40; it is 10:00. Nothing of 7 is Irit's to do yet.
    assert.equal(await card(page, GFX, 'p07a').count(), 0);
    assert.equal(await card(page, GFX, 'p07').count(), 0);
    const waiting = page.locator(`#mine-list [data-flow="waiting-ofir-${GFX}"]`);
    await waiting.waitFor();
    assert.match(await text(waiting), /9 הגרפיקות של גל אשכנזי: מחכה לאישור של אופיר \(באיחור\)/);
    assert.ok((await waiting.boundingBox()).height >= 44);
    await noOverflow(page);
    await shot(waiting, 'irit-waiting-for-ofir');
    // Ofir checks and approves (on his own screen).
    for (const k of [...itemsOf('p07').filter((x) => x.startsWith('p07.r.')), 'p07.ofir']) db.protocol_checks.push({ client_id: GFX, item_key: k, state: 'done', note: null, by_email: emailOf('ofir'), at: NOW.toISOString() });
    await page.click('#btn-refresh');
    await settle(page);
    assert.equal(await page.locator(`#mine-list [data-flow="waiting-ofir-${GFX}"]`).count(), 0);
    const c = card(page, GFX, 'p07a');
    await c.waitFor();
    assert.equal(await text(c.locator('.wlabel')), 'לשלוח ללקוח קישור לדף הסטטוס');
    await shot(c, 'irit-status-link-card');
    await c.locator('.wlink button').click();
    await settle(page);
    assert.equal(fake.made.status, 1);
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /status\.html#t=S0+1/);
    await card(page, GFX, 'p07a').locator('.cbx').check();
    await settle(page);
    assert.equal(checkOf(db, GFX, 'p07a.sent')?.state, 'done');
    // The sending card: hers, due two office hours after his approval (10:00 → 12:00), not late.
    const send = card(page, GFX, 'p07');
    assert.equal(await send.count(), 1);
    assert.match(await text(send.locator('.wc-when')), /12:00/);
    assert.doesNotMatch(await text(send.locator('.wc-when')), /באיחור/);
    assert.equal(await text(send.locator('.wlabel')), 'נשלחו ללקוח לאישור');
    assert.equal(await send.locator('.cbx').count(), 1, 'the seven checks are not hers');
    await shot(send, 'irit-graphics-send-card');
    await ctx.close();
    // Ofir, before he approved: the card with his seven checks, late since 09:50, with a button straight
    // to that check; and the countdown in "עכשיו" (at 10:00: the extra five minutes are over too).
    const o = await signedIn('ofir', office());
    const review = card(o.page, GFX, 'p07');
    await review.waitFor();
    assert.match(await text(review.locator('.wc-when')), /באיחור/);
    const go = review.locator('a.ik-go');
    assert.deepEqual([await text(go), await go.getAttribute('href')], ['לבדיקת הגרפיקות', `qa.html#review-${GFX}-p07`]);
    const clock = o.page.locator('#now-bar .now-clock.k-fast').filter({ hasText: 'סטודיו גל' });
    await clock.waitFor();
    assert.equal(await clock.getAttribute('data-phase'), 'told');
    assert.match(await text(clock), /באיחור ליאור עודכן/);
    assert.match(await text(clock), /לבדוק ולאשר: 9 הגרפיקות הראשונות/);
    const btn = clock.locator('a.now-go');
    assert.deepEqual([await text(btn), await btn.getAttribute('href')], ['לבדיקה', `qa.html#review-${GFX}-p07`]);
    assert.ok((await btn.boundingBox()).height >= 44);
    await noOverflow(o.page);
    await shot(o.page.locator('#now-bar'), 'ofir-fast-clock');
    // The button opens his screen on that very check: the seven checks, "אישור" and "החזרה לתיקון".
    await btn.click();
    await o.page.waitForSelector('#dlg-qa[open]');
    assert.match(await text(o.page.locator('#qa-dlg-h')), /בקרת איכות · גל אשכנזי/);
    assert.match(await text(o.page.locator('#qa-meta')), /9 הגרפיקות הראשונות · בדיקה ראשונה · באיחור · ליאור עודכן · לאשר עד היום 09:50/);
    assert.equal(await o.page.locator('#qa-checks input').count(), 7);
    await shot(o.page.locator('#dlg-qa'), 'ofir-graphics9-review-dialog');
    await o.ctx.close();
    // Lior does not carry it; before the graphics are ready nobody has the check.
    const lior = await signedIn('lior', office());
    assert.equal(await card(lior.page, GFX, 'p07').count(), 0);
    assert.equal(await lior.page.locator('#now-bar .now-clock.k-fast').count(), 0);
    await lior.ctx.close();
    for (const role of ['irit', 'ofir']) {
      const x = await signedIn(role, office());
      assert.equal(await card(x.page, NEW, 'p07').count(), 0, `nothing to review before it arrives: ${role}`);
      await x.ctx.close();
    }
  });

  await step('5: process 5 does not close on one network: the card names what was saved and "אין עוד" closes it', async () => {
    const { page, ctx, db } = await signedIn('ofir', office());
    const c = card(page, NEW, 'p05');
    await c.waitFor();
    assert.equal(await text(c.locator('.wlabel')), 'נשמרה גישה ל־Instagram בלבד. יש עוד רשתות?');
    const pill = c.locator('.cbx');
    assert.match(await pill.evaluate((el) => getComputedStyle(el, '::after').content), /אין עוד/);
    await shot(c, 'ofir-access-other-networks');
    await pill.check();
    await settle(page);
    assert.equal(checkOf(db, NEW, 'p05.allnets')?.state, 'done');
    assert.equal(await card(page, NEW, 'p05').count(), 0);
    await ctx.close();
  });

  // ── FIX 8 ──
  await step('8: the shoot date is set from Irit\'s card in three taps, with the photographer\'s free days; a day he did not mark free is asked about', async () => {
    const { page, ctx, db } = await signedIn('irit', office());
    const c = card(page, NEW, 'p11');
    await c.waitFor();
    assert.equal(await text(c.locator('.wneed:not(.wlink) span')), 'עוד לא נקבע תאריך ליום הצילום.');
    const btn = c.locator('.wneed:not(.wlink) button');
    assert.equal(await text(btn), 'קביעת יום צילום');
    await shot(c, 'irit-shoot-date-card');
    await btn.click();                                                    // tap 1
    await page.waitForSelector('#dlg-shoot[open]');
    assert.equal(await page.locator('#shoot-type').inputValue(), 'dms', 'with whom: already known');
    await page.waitForSelector('#shoot-free .chip');
    assert.deepEqual(await page.locator('#shoot-free .chip').evaluateAll((els) => els.map((e) => e.dataset.day)), ['2026-10-22', '2026-10-27', '2026-10-28', '2026-11-03', '2026-11-04']);
    assert.equal(await page.locator('#shoot-oks .chip').count(), 6);
    await shot(page.locator('#dlg-shoot'), 'irit-shoot-date-dialog');
    // Nothing chosen: one sentence, nothing saved.
    await page.click('#shoot-submit');
    assert.equal(await text(page.locator('#shoot-err')), 'בחרו יום ושעה ליום הצילום.');
    // A day he did not mark free: asked, with a reason; "ביטול" keeps the dialog and saves nothing.
    await page.fill('#shoot-at', '2026-10-29T10:00');
    await page.waitForSelector('#shoot-avail:not([hidden])');
    assert.match(await text(page.locator('#shoot-avail')), /לא סימן את היום הזה כפנוי/);
    await page.click('#shoot-submit');
    await page.waitForSelector('#dlg-shoot-day[open]');
    await shot(page.locator('#dlg-shoot-day'), 'irit-shoot-date-not-free');
    await page.click('#av-reason-cancel');
    assert.equal(db.clients.find((x) => x.id === NEW).shoot_at, null);
    // A free day: one tap on it, and save.
    await page.locator('#shoot-free .chip[data-day="2026-10-28"]').click();  // tap 2
    assert.equal(await page.locator('#shoot-at').inputValue(), '2026-10-28T10:00');
    assert.match(await text(page.locator('#shoot-avail')), /סימן את היום הזה כפנוי/);
    await page.locator('#shoot-oks .chip[data-key="p11.ok.client"]').click();
    await shot(page.locator('#dlg-shoot'), 'irit-shoot-date-dialog-filled');
    await page.click('#shoot-submit');                                    // tap 3
    await page.waitForSelector('#dlg-shoot:not([open])', { state: 'attached' });
    await settle(page);
    const row = db.clients.find((x) => x.id === NEW);
    assert.equal(new Date(row.shoot_at).toISOString(), '2026-10-28T08:00:00.000Z');
    assert.equal(row.shoot_type, 'dms');
    assert.equal(checkOf(db, NEW, 'p11.ok.client')?.state, 'done');
    assert.match(await toastText(page), /^יום הצילום נשמר: .*28\.10.* סומנו אישור אחד\.$/);
    // The card stays for what is left of 11 (the other approvals), without the missing-date line.
    assert.equal(await card(page, NEW, 'p11').locator('.wneed:not(.wlink)').count(), 0);
    assert.equal(await card(page, NEW, 'p11').count(), 1);
    await noOverflow(page);
    await ctx.close();
  });

  // ── FIX 6: the daily follow-up ──
  await step('6: the daily follow-up is ONE counted line for Irit; on its list each client is one row: "הכול תקין" in one tap, or what is stuck (and Lior is told)', async () => {
    const { page, ctx, db } = await signedIn('irit', office());
    const line = page.locator('#mine-list a[href="prep.html#followup"]');
    await line.waitFor();
    // NEW (no shoot date yet), GFX (3.11), SOON (22.10) and SCRIPTS (5.11): four clients before their shoot day.
    assert.match(await text(line), /מעקב לפני צילום: 4 לקוחות/);
    assert.equal(await page.locator('#mine-list .wproc[data-key$=":p14"]').count(), 0, 'never a card of eight ticks per client');
    await shot(line, 'irit-followup-line');
    await line.click();
    await page.waitForSelector('#followup:not([hidden]) .pp-follow-row');
    await settle(page);
    assert.equal(await text(page.locator('#fu-h')), 'מעקב לפני צילום · 4 לקוחות להיום');
    const rows = page.locator('#pp-followup .pp-follow-row');
    assert.equal(await rows.count(), 4);
    assert.match(await text(rows.first()), /לביא רכב|תומר לביא/, 'the nearest shoot first');
    for (const id of [LANDING, OLD, PUBLISH, ONGOING]) assert.equal(await page.locator(`#fu-${id}-1`).count(), 0, id);
    await noOverflow(page);
    await shot(page.locator('#followup'), 'irit-followup-list');
    // One tap closes today's follow-up of a client.
    await page.click(`#fu-${SOON}-1-ok`);
    await settle(page);
    assert.deepEqual(JSON.parse(checkOf(db, SOON, 'p14.day').note), { ok: true });
    assert.match(await text(page.locator(`#fu-${SOON}-1`)), /הכול תקין/);
    assert.equal(await text(page.locator('#fu-h')), 'מעקב לפני צילום · 3 לקוחות להיום');
    // Something is stuck: the eight topics, a few words, and Lior is told.
    await page.click(`#fu-${GFX}-1-stuck`);
    assert.equal(await page.locator(`#fu-${GFX}-1 .pp-topics .chip`).count(), 8);
    assert.ok(await page.locator(`#fu-${GFX}-1-save`).isDisabled(), 'nothing chosen yet');
    await page.click(`#fu-${GFX}-1-t-graphics`);
    await page.fill(`#fu-${GFX}-1-note`, 'הלקוח לא עונה על הגרפיקות');
    await shot(page.locator(`#fu-${GFX}-1`), 'irit-followup-stuck');
    await page.click(`#fu-${GFX}-1-save`);
    await settle(page);
    assert.deepEqual(JSON.parse(checkOf(db, GFX, 'p14.day').note), { stuck: ['graphics'], note: 'הלקוח לא עונה על הגרפיקות' });
    const told = db.client_tasks.filter((t) => t.client_id === GFX && t.source === 'escalation');
    assert.equal(told.length, 1);
    assert.deepEqual([told[0].owner, told[0].brief.blocker], ['lior', 'followup:2026-10-20']);
    assert.match(told[0].title, /^תקוע לפני יום הצילום .*: גרפיקות · הלקוח לא עונה על הגרפיקות$/);
    assert.match(await text(page.locator(`#fu-${GFX}-1`)), /תקוע: גרפיקות · הלקוח לא עונה על הגרפיקות · ליאור קיבל הודעה/);
    await shot(page.locator('#followup'), 'irit-followup-list-after');
    // Back home: the line counts what is left.
    await page.goto(`${BASE}clients.html#mine`);
    await page.waitForSelector('#view-mine:not([hidden])');
    await settle(page);
    assert.match(await text(page.locator('#mine-list a[href="prep.html#followup"]')), /מעקב לפני צילום: 2 לקוחות/);
    await ctx.close();
    // Lior sees the exception on his own list, not the follow-up.
    const lior = await signedIn('lior', db);
    assert.equal(await lior.page.locator('#mine-list a[href="prep.html#followup"]').count(), 0);
    assert.match(await text(lior.page.locator('#mine-list')), /תקוע לפני יום הצילום/);
    await lior.ctx.close();
  });

  // ── FIX 7 ──
  await step('7: "הגאנט מלא" and "תוזמן" are refused, in one sentence, while the Gantt is empty or nothing is scheduled; with content they are taken', async () => {
    const { page, ctx, db } = await signedIn('ilai', office());
    const gantt = page.locator(`#mine-list .wproc[data-key="il-gantt:${PUBLISH}:"]`);
    await gantt.waitFor({ state: 'attached' });
    await showAll(page);
    await gantt.locator('button', { hasText: 'הגאנט מלא' }).click();
    await settle(page);
    assert.match(await toastText(page), /^הגאנט עדיין ריק\./);
    assert.equal(checkOf(db, PUBLISH, 'p29.filled'), null);
    await shot(page, 'ilai-gantt-empty-refused');
    await tick(card(page, PUBLISH, 'p28'));
    await settle(page);
    assert.match(await toastText(page), /^עוד שום תוכן לא סומן ״תוזמן״ בגאנט\./);
    assert.equal(checkOf(db, PUBLISH, 'p28.scheduled'), null);
    assert.equal(await card(page, PUBLISH, 'p28').locator('.cbx').isChecked(), false);
    // The Gantt gets rows, one of them scheduled: both marks are taken.
    db.client_gantt.push({ id: randomUUID(), client_id: PUBLISH, key: 'v1', kind: 'video', state: 'scheduled' }, { id: randomUUID(), client_id: PUBLISH, key: 'g1', kind: 'graphic', state: 'planned' });
    await tick(card(page, PUBLISH, 'p28'));
    await settle(page);
    assert.equal(checkOf(db, PUBLISH, 'p28.scheduled')?.state, 'done');
    await page.locator(`#mine-list .wproc[data-key="il-gantt:${PUBLISH}:"] button`, { hasText: 'הגאנט מלא' }).click();
    await settle(page);
    assert.equal(checkOf(db, PUBLISH, 'p29.filled')?.state, 'done');
    await ctx.close();
  });

  await step('7: the scripts mark waits for a script on the scripts page; the weekly call\'s row leads to its dialog, which asks for the summary', async () => {
    const { page, ctx, db } = await signedIn('lior', office());
    const c = card(page, SCRIPTS, 'p12');
    await c.waitFor({ state: 'attached' });
    await showAll(page);
    await tick(c);
    await settle(page);
    assert.match(await toastText(page), /^עוד אין תסריט בעמוד התסריטים\./);
    assert.equal(checkOf(db, SCRIPTS, 'p12.docs'), null);
    await shot(page, 'lior-scripts-refused');
    db.client_scripts.push({ client_id: SCRIPTS, round: 1, n: 1, content: 'פתיח', version: 1 });
    await tick(card(page, SCRIPTS, 'p12'));
    await settle(page);
    assert.equal(checkOf(db, SCRIPTS, 'p12.docs')?.state, 'done');
    // The weekly call: no pill that closes it with nothing written; one way, to its dialog.
    await showAll(page);
    const call = card(page, ONGOING, 'p31');
    assert.equal(await call.locator('.cbx').count(), 0);
    const go = call.locator('a.wcall');
    assert.match(await text(go), /^תיעוד שיחה/);
    await shot(call, 'lior-weekly-call-row');
    await go.click();
    await page.waitForSelector('#dlg-call[open]');
    await page.click('#call-submit');
    assert.match(await text(page.locator('#call-err')), /לא נכתב דבר בסיכום/);
    assert.equal(checkOf(db, ONGOING, 'p31.call'), null);
    await shot(page.locator('#dlg-call'), 'lior-weekly-call-dialog');
    // One line of summary: saved, and the call is marked.
    await page.fill('#call-topic-campaigns', 'הקמפיין רץ, 12 פניות השבוע');
    await page.click('#call-submit');
    await page.waitForFunction(() => !document.querySelector('#dlg-call[open]'));
    assert.match(JSON.parse(checkOf(db, ONGOING, 'p31.call').note).topics.campaigns, /12 פניות/);
    await ctx.close();
  });

  await step('7: the two other places that mark "the scripts are on the scripts page" keep the link and wait for a script too (the intake page)', async () => {
    const { page, ctx, db } = await signedIn('lior', office(), `intake.html?id=${SCRIPTS}#scripts`);
    await page.waitForSelector('#sc-link');
    await page.fill('#sc-link', 'https://app.astrateg.tech/scripts-view.html#t=abc');
    await page.click('#sc-save');
    await settle(page);
    assert.match(await toastText(page), /^הקישור נשמר\. עוד אין תסריט בעמוד התסריטים\./);
    assert.equal(db.clients.find((x) => x.id === SCRIPTS).links.scripts, 'https://app.astrateg.tech/scripts-view.html#t=abc', 'the link itself is kept');
    assert.equal(checkOf(db, SCRIPTS, 'p12.docs'), null);
    db.client_scripts.push({ client_id: SCRIPTS, round: 1, n: 1, content: 'פתיח', version: 1 });
    await page.click('#sc-save');
    await settle(page);
    assert.equal(checkOf(db, SCRIPTS, 'p12.docs')?.state, 'done');
    await ctx.close();
  });

  assert.deepEqual(errors, []);
  noCspViolations();
  console.log(`\n${passed} steps passed.`);
} finally {
  await browser.close();
}
