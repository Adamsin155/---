// Protocol version 9 in the browser (docs/ops.md, section 57), each role signed in as itself, on a phone
// (390px) and on a desktop (1280px), against the office of tests/flow-world.mjs (Tuesday 20.10.2026,
// 10:00 in Israel; invented names):
//   1  Ofir's "המשימות שלי": the countdown of the graphics he has to check ("נשארו 7:00") and of the editor
//      he has to assign ("נשארו 6:00"), each with a button straight to the place;
//   2  the assignment: the ring's address opens the dialog on that client with the editor "מומלץ לפי עומס"
//      already chosen; one tap on "שיוך" writes the editor and 22א's marks, closes Lior's "the drive came back"
//      (he confirmed it when he closed the shoot day), and the clock is gone;
//   3  Lior: no clock, no line and no button of the assignment (qa.html stays open to him, to look);
//      of 22א he has only his own item;
//   4  Ilai: the card of the graphics he handed over says where they are and how long Ofir has;
//   5  Ofir returns the first graphics for fixes from the review dialog: Ilai gets the list on his card,
//      and "תוקן" puts them back in Ofir's queue with a fresh ten minutes.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/fast-ladder-e2e.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { importKeys } from '../app/client-open.js';
import { PROCESSES } from '../app/protocol.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const SIZES = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 900 } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = async (target, name) => { if (SHOTS) await target.screenshot({ path: `${OUT}v9-${name}.png` }); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const at = (hhmm) => `2026-10-20T${hhmm}:00+03:00`;
const [GFX, SHOT, B1, B2, B3] = [61, 62, 63, 64, 65].map(cid);
const itemsOf = (...ids) => PROCESSES.filter((p) => ids.includes(p.id)).flatMap((p) => p.items.filter((i) => !i.optional).map((i) => i.key));

function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  for (const t of ['protocol_checks', 'client_tasks', 'deal_requests', 'client_gantt', 'client_scripts', 'client_access_links', 'client_status_links', 'client_status_views', 'client_approvals', 'client_surveys', 'client_consents']) db[t] = [];
  const mk = (id, fields) => ({
    ...base, id, editor: null, rounds: [], links: {}, landing: false, landed_at: null, landed_by: null, landing_slot: null, protocol_version: 9,
    shoot_type: 'dms', characterizer: 'ofir', has_logo: true, shoot_at: null, created_by_email: emailOf('irit'), ...fields,
  });
  const mark = (id, keys, when, note = null, by = 'irit') => { for (const k of [].concat(keys)) db.protocol_checks.push({ client_id: id, item_key: k, state: 'done', note, by_email: emailOf(by), at: when }); };
  const imported = (id, station, keep = () => true) => mark(id, importKeys(station).filter(keep), '2026-10-12T09:00:00+03:00', 'ייבוא');
  // GFX: the meeting was yesterday; Ilai handed the 9 graphics over three minutes ago (09:57).
  const gfx = mk(GFX, { name: 'גל אשכנזי', business: 'סטודיו גל', deal_at: '2026-10-15T09:00:00+03:00', char_at: '2026-10-19T10:00:00+03:00', shoot_at: '2026-11-03T10:00:00+02:00' });
  mark(GFX, itemsOf('p01', 'p02', 'p03', 'p11'), '2026-10-15T09:04:00+03:00');
  mark(GFX, itemsOf('p04', 'p05', 'p05b', 'p06', 'p08', 'p08b', 'p09', 'p10'), '2026-10-19T12:30:00+03:00', null, 'ofir');
  mark(GFX, 'p07.made', at('09:57'), null, 'ilai');
  // SHOT: shot yesterday; Lior closed the shoot day four minutes ago (09:56). No editor yet.
  const shotC = mk(SHOT, { name: 'נועם פרץ', business: 'פרץ נדל״ן', deal_at: '2026-10-01T09:00:00+03:00', char_at: '2026-10-05T10:00:00+03:00', shoot_at: '2026-10-19T10:00:00+03:00' });
  imported(SHOT, 'post', (k) => !/^p(19|22a|22|23|23b|24|25|26|27)\./.test(k));
  mark(SHOT, itemsOf('p19'), at('09:56'), null, 'lior');
  // Three clients in the middle of the editing: two with Nadia, one with Yariv. Anna has none.
  const busy = [[B1, 'nadia', 'עסק א'], [B2, 'nadia', 'עסק ב'], [B3, 'yariv', 'עסק ג']].map(([id, editor, business]) => {
    const c = mk(id, { name: business, business, editor, deal_at: '2026-09-20T09:00:00+03:00', char_at: '2026-09-22T10:00:00+03:00', shoot_at: '2026-10-14T10:00:00+03:00' });
    imported(id, 'post', (k) => !/^p(22|23|23b|24|25|26|27)\./.test(k));
    mark(id, itemsOf('p23', 'p23b'), '2026-10-15T12:00:00+03:00', 'ייבוא');
    mark(id, itemsOf('p22a'), '2026-10-19T11:00:00+03:00', null, 'ofir');
    return c;
  });
  db.clients = [gfx, shotC, ...busy];
  return db;
}

async function signedIn(role, db, { path = 'clients.html#mine', width = 390 } = {}) {
  const fake = makeFlowFake(db);
  const phone = width < 600;
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: SIZES[width], isMobile: phone, hasTouch: phone });
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
  return { page, ctx, db };
}
const card = (page, id, proc) => page.locator(`#mine-list .wproc[data-key="${id}:${proc}"]`);
const checkOf = (db, id, key) => db.protocol_checks.find((r) => r.client_id === id && r.item_key === key) || null;
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page scrolls sideways');
const inside = async (page, loc) => { const b = await loc.boundingBox(); const w = await page.evaluate(() => window.innerWidth); assert.ok(b && b.x >= 0 && b.x + b.width <= w + 1, `outside the screen: ${JSON.stringify(b)}`); };

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

try {
  for (const width of [390, 1280]) {
    await step(`${width}px · Ofir's "עכשיו": the graphics to check and the editor to assign, each counting down, each with its button`, async () => {
      const { page, ctx } = await signedIn('ofir', office(), { width });
      const clocks = page.locator('#now-bar .now-clock.k-fast');
      await clocks.first().waitFor();
      assert.equal(await clocks.count(), 2);
      const assign = clocks.filter({ hasText: 'פרץ נדל״ן' });
      const review = clocks.filter({ hasText: 'סטודיו גל' });
      // 09:56 + 10 minutes = 10:06 (six minutes left at 10:00, less the seconds the page took to open); 09:57 + 10 = 10:07.
      assert.match(await text(assign), /^נשארו (6:00|5:5\d) .*לשייך עורך .*תהליך 22א · הגיע היום 09:56 · יעד היום 10:06 שיוך עורך$/);
      assert.match(await text(review), /^נשארו (7:00|6:5\d) .*לבדוק ולאשר: 9 הגרפיקות הראשונות .*תהליך 7 · הגיע היום 09:57 · יעד היום 10:07 לבדיקה$/);
      assert.deepEqual([await assign.getAttribute('data-phase'), await review.getAttribute('data-phase')], ['run', 'run']);
      assert.equal(await assign.locator('a.now-go').getAttribute('href'), `qa.html#assign-${SHOT}`);
      assert.equal(await review.locator('a.now-go').getAttribute('href'), `qa.html#review-${GFX}-p07`);
      for (const c of [assign, review]) { assert.ok((await c.locator('a.now-go').boundingBox()).height >= 44); await inside(page, c.locator('a.now-go')); await inside(page, c.locator('.now-left')); }
      // The clock runs: a minute later it reads a minute less.
      await page.clock.fastForward(60_000);
      await page.waitForFunction(() => [...document.querySelectorAll('#now-bar .now-clock.k-fast .now-left')].some((e) => /^(5:00|4:5\d)$/.test(e.textContent.trim())));
      // The card of 22א carries the same door; the plain "soon" clock of that process is not there twice.
      assert.equal(await card(page, SHOT, 'p22a').locator('a.ik-go').getAttribute('href'), `qa.html#assign-${SHOT}`);
      assert.equal(await page.locator('#now-bar .now-clock.k-soon').filter({ hasText: 'פרץ נדל״ן' }).count(), 0);
      await noOverflow(page);
      await shot(page, `ofir-mine-${width}`);
      // Past the ten minutes and the extra five: "באיחור · ליאור עודכן", in words that fit the column.
      await page.clock.fastForward(16 * 60_000);
      await page.waitForFunction(() => document.querySelectorAll('#now-bar .now-clock.k-fast[data-phase="told"]').length === 2);
      assert.match(await text(clocks.first()), /^באיחור ליאור עודכן /);
      await inside(page, clocks.first().locator('.now-left'));
      await noOverflow(page);
      await shot(page.locator('#now-bar'), `ofir-clocks-told-${width}`);
      await ctx.close();
    });

    await step(`${width}px · the assignment: the dialog opens on the client with the suggested editor chosen; one tap assigns, closes Lior's drive item, and the clock is gone`, async () => {
      const { page, ctx, db } = await signedIn('ofir', office(), { path: `qa.html#assign-${SHOT}`, width });
      await page.waitForSelector('#dlg-assign[open]');
      assert.match(await text(page.locator('#as-h')), /שיוך עורך · נועם פרץ/);
      assert.match(await text(page.locator('#as-meta')), /נשארו 6 דק׳ · לשייך עד היום 10:06/);
      // Nadia has two jobs and Yariv one: Anna is suggested, marked, and already chosen.
      assert.equal(await page.locator('#as-editors input:checked').getAttribute('value'), 'anna');
      assert.equal(await text(page.locator('#as-suggested')), 'מומלץ לפי עומס');
      assert.match(await text(page.locator('#as-editors label[for="as-e-anna"]')), /אנה מומלץ לפי עומס אין לקוחות בעריכה/);
      assert.equal(await page.locator('#as-editors .as-suggested').count(), 1);
      await inside(page, page.locator('#as-submit'));
      await shot(page.locator('#dlg-assign'), `assign-dialog-${width}`);
      await page.click('#as-submit');
      await page.waitForSelector('#dlg-assign:not([open])', { state: 'attached' });
      await settle(page);
      assert.equal(db.clients.find((c) => c.id === SHOT).editor, 'anna');
      for (const k of ['p22a.load', 'p22a.assigned', 'p22a.irit']) assert.equal(checkOf(db, SHOT, k)?.state, 'done', k);
      assert.equal(checkOf(db, SHOT, 'p22a.drive')?.note, 'נסגר לבד: ליאור אישר בסגירת יום הצילום שהכונן חזר');
      assert.ok(db.client_tasks.some((t) => t.client_id === SHOT && t.owner === 'ofir' && /פתיחת תיקייה מסודרת בדרייב לעריכה \(24\)/.test(t.title)));
      assert.equal(await page.locator(`#assign-list [data-key="${SHOT}:p22a"]`).count(), 0);
      await ctx.close();
      // Back on his list: no clock and no card of the assignment.
      const again = await signedIn('ofir', db, { width });
      assert.equal(await again.page.locator('#now-bar .now-clock.k-fast').filter({ hasText: 'פרץ נדל״ן' }).count(), 0);
      assert.equal(await card(again.page, SHOT, 'p22a').count(), 0);
      await again.ctx.close();
    });
  }

  await step('Lior: no clock, no line and no button of the assignment; of 22א only "ליאור החזיר את הכונן"; qa.html is his to look at', async () => {
    const { page, ctx } = await signedIn('lior', office());
    assert.equal(await page.locator('#now-bar .now-clock.k-fast').count(), 0);
    assert.equal(await page.locator('#mine-list [data-flow*="assign"]').count(), 0);
    assert.equal(await card(page, GFX, 'p07').count(), 0);
    const mine = card(page, SHOT, 'p22a');
    await mine.waitFor();
    assert.equal(await text(mine.locator('.wlabel')), 'ליאור החזיר את הכונן');
    assert.equal(await mine.locator('.cbx').count(), 1);
    assert.equal(await mine.locator('a.ik-go').count(), 0);
    await shot(page, 'lior-mine-390');
    await page.goto(`${BASE}qa.html#assign-${SHOT}`);
    await page.waitForSelector(`#assign-list [data-key="${SHOT}:p22a"]`);
    await settle(page);
    assert.equal(await page.locator('#dlg-assign[open]').count(), 0, 'the ring\'s address opens no dialog for him');
    const row = page.locator(`#assign-list [data-key="${SHOT}:p22a"]`);
    assert.match(await text(row), /נשארו 6 דק׳ · לשייך עד היום 10:06 אופיר משייך את העורך\.$/);
    assert.equal(await row.locator('button').count(), 0);
    // The graphics waiting for Ofir's check are there for him to see, without "לבדיקה"; and the ring's address opens no dialog.
    const gfx = page.locator(`#qa-list [data-key="${GFX}:p07"]`);
    assert.match(await text(gfx), /9 הגרפיקות הראשונות נשארו 7 דק׳ .*אופיר בודק את הגרפיקות\.$/);
    assert.equal(await gfx.locator('button').count(), 0);
    await page.goto(`${BASE}qa.html#review-${GFX}-p07`);
    await page.reload();
    await page.waitForSelector(`#qa-list [data-key="${GFX}:p07"]`);
    await settle(page);
    assert.equal(await page.locator('#dlg-qa[open]').count(), 0);
    await noOverflow(page);
    await shot(page, 'lior-qa-390');
    await ctx.close();
  });

  await step('Ilai: the card of the graphics he handed over says "אצל אופיר לבדיקה · נשארו 7 דק׳"; before that the button reads "מוכן לבדיקה (לאופיר)"', async () => {
    const { page, ctx } = await signedIn('ilai', office());
    const il = page.locator('#mine-list .il-card').filter({ hasText: 'סטודיו גל' });
    await il.first().waitFor();
    if (await il.locator('details:not([open]) > summary').count()) await il.locator('summary').first().click();
    assert.equal(await text(il.locator('.il-with-ofir')), 'אצל אופיר לבדיקה · נשארו 7 דק׳');
    assert.equal(await il.locator('button.il-ready').filter({ hasText: 'מוכן לבדיקה' }).count(), 0, 'nothing to press while it is with Ofir');
    await noOverflow(page);
    await shot(il.first(), 'ilai-card-with-ofir-390');
    await ctx.close();
  });

  await step('a mistake in the first 9 graphics: Ofir returns them from the review dialog; Ilai gets the list and marks "תוקן"; they are back in Ofir\'s queue with a fresh ten minutes', async () => {
    const db = office();
    const o = await signedIn('ofir', db, { path: `qa.html#review-${GFX}-p07` });
    await o.page.waitForSelector('#dlg-qa[open]');
    assert.match(await text(o.page.locator('#qa-meta')), /9 הגרפיקות הראשונות · בדיקה ראשונה · נשארו 7 דק׳ · לאשר עד היום 10:07/);
    assert.equal(await o.page.locator('#qa-checks input').count(), 7);
    await shot(o.page.locator('#dlg-qa'), 'review-dialog-390');
    await o.page.click('#qa-to-return');
    assert.match(await text(o.page.locator('#qa-return-hint')), /הרשימה עוברת לעילאי מיד/);
    await o.page.fill('#qa-ref-1', '3');
    await o.page.fill('#qa-text-1', 'מספר הטלפון שגוי');
    await o.page.click('#qa-send-return');
    await o.page.waitForSelector('#dlg-qa:not([open])', { state: 'attached' });
    await settle(o.page);
    const ret = checkOf(db, GFX, 'p07.return.1');
    assert.deepEqual(JSON.parse(ret.note).issues, [{ ref: '3', text: 'מספר הטלפון שגוי' }]);
    assert.equal(await o.page.locator(`#qa-list [data-key="${GFX}:p07"]`).count(), 0, 'out of his queue while it is being fixed');
    assert.match(await text(o.page.locator('#qa-fixing')), /הוחזרו לתיקון ועוד לא חזרו \(1\)/);
    await o.ctx.close();
    // His clock is gone meanwhile.
    const o2 = await signedIn('ofir', db);
    assert.equal(await o2.page.locator('#now-bar .now-clock.k-fast').filter({ hasText: 'סטודיו גל' }).count(), 0);
    await o2.ctx.close();
    // Ilai: the list on his card, "תוקן".
    const i = await signedIn('ilai', db);
    const il = i.page.locator('#mine-list .il-card').filter({ hasText: 'סטודיו גל' });
    await il.first().waitFor();
    if (await il.locator('details:not([open]) > summary').count()) await il.locator('summary').first().click();
    const fix = il.locator('.fix-list');
    assert.match(await text(fix), /הוחזר לתיקון · סבב 1 .*גרפיקה 3: מספר הטלפון שגוי/);
    await shot(il.first(), 'ilai-card-fixes-390');
    await fix.locator('button.fix-btn').click();
    await settle(i.page);
    assert.equal(checkOf(db, GFX, 'p07.fixed.1')?.state, 'done');
    assert.match(await text(il.locator('.il-with-ofir')), /^אצל אופיר לבדיקה · נשארו 10 דק׳$/);
    await i.ctx.close();
    // Back in Ofir's queue as the second check.
    const o3 = await signedIn('ofir', db, { path: 'qa.html' });
    const row = o3.page.locator(`#qa-list [data-key="${GFX}:p07"]`);
    await row.waitFor();
    assert.match(await text(row), /9 הגרפיקות הראשונות בדיקה 2 · אחרי תיקון נשארו 10 דק׳ · הגיע היום 10:00 · לאשר עד היום 10:10/);
    await shot(o3.page, 'ofir-qa-390');
    await o3.ctx.close();
  });

  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  noCspViolations();
  console.log(`\nfast-ladder: ${passed} steps passed`);
} finally {
  await browser.close();
}
