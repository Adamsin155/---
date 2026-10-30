// "שיוך עורך" from the client card (the owner, 29.10.2026; app/card-assign-logic.js,
// app/assign-dialog.js), each role signed in as itself, against the office of
// tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in Israel; invented names):
//   1  Ofir, on a phone (390) and a desktop (1280): a client the import marked "שויך" at a later
//      station, with no editor: "אין עורך · שיוך עורך" (44px), qa.html's dialog, Nadia; the card
//      shows her, 22א's mark and every deadline stay, the reason mark says who recorded it, no
//      folder task, and the WhatsApp to Nadia is offered;
//   2  the same card on a client whose 22א is open: the dialog is qa.html's first assignment
//      (the suggestion chosen, the folder task, Lior's drive item closed), and the ring
//      "לקוח חדש בעריכה אצלך" is due for the editor;
//   3  Irit and Lior see the button and Irit records an editor; Ilai sees no button;
//      "שינוי" beside an editor written;
//   4  WebKit as an iPhone 13: Ofir, the imported client, tapped through.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: npx http-server -p 8419 -s -c-1 . &  then  BASE_URL=http://localhost:8419/ node tests/card-assign-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { importKeys } from '../app/client-open.js';
import { PROCESSES } from '../app/protocol.js';
import { computeReminders } from '../app/reminder-engine.js';

const BASE = process.env.BASE_URL || 'http://localhost:8419/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const SIZES = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 900 } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = async (target, name) => { if (SHOTS) await target.screenshot({ path: `${OUT}card-assign-${name}.png` }); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const [IMP, SHOT, B1, B2, B3] = [71, 72, 73, 74, 75].map(cid);
const IMPORTED_AT = '2026-10-12T09:00:00+03:00';
const itemsOf = (...ids) => PROCESSES.filter((p) => ids.includes(p.id)).flatMap((p) => p.items.filter((i) => !i.optional).map((i) => i.key));

function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  for (const t of ['protocol_checks', 'client_tasks', 'deal_requests', 'client_gantt', 'client_scripts', 'client_access_links', 'client_status_links', 'client_status_views', 'client_approvals', 'client_surveys', 'client_consents']) db[t] = [];
  const mk = (id, fields) => ({
    ...base, id, editor: null, editor2: null, editor_split: null, rounds: [], links: {}, landing: false, landed_at: null, landed_by: null, landing_slot: null, protocol_version: 9,
    shoot_type: 'dms', characterizer: 'ofir', has_logo: true, shoot_at: null, created_by_email: emailOf('irit'), ...fields,
  });
  const mark = (id, keys, when, note = null, by = 'irit') => { for (const k of [].concat(keys)) db.protocol_checks.push({ client_id: id, item_key: k, state: 'done', note, by_email: emailOf(by), at: when }); };
  // IMP: an old client the import put at "פרסום": everything before it marked by the system, 22א included, no editor.
  const imp = mk(IMP, { name: 'רוני אלמוג', business: 'אלמוג עיצובים', deal_at: '2026-08-01T09:00:00+03:00', char_at: '2026-08-05T10:00:00+03:00', shoot_at: '2026-09-01T10:00:00+03:00', created_by_email: 'system' });
  mark(IMP, importKeys('publish'), IMPORTED_AT, 'ייבוא', 'irit');
  // SHOT: shot yesterday; Lior closed the shoot day four minutes ago. 22א open.
  const shotC = mk(SHOT, { name: 'נועם פרץ', business: 'פרץ נדל״ן', deal_at: '2026-10-01T09:00:00+03:00', char_at: '2026-10-05T10:00:00+03:00', shoot_at: '2026-10-19T10:00:00+03:00' });
  mark(SHOT, importKeys('post').filter((k) => !/^p(19|22a|22|23|23b|24|25|26|27)\./.test(k)), IMPORTED_AT, 'ייבוא');
  mark(SHOT, itemsOf('p19'), '2026-10-20T09:56:00+03:00', null, 'lior');
  // Three clients in the middle of the editing: two with Nadia, one with Yariv. Anna has none.
  const busy = [[B1, 'nadia', 'עסק א'], [B2, 'nadia', 'עסק ב'], [B3, 'yariv', 'עסק ג']].map(([id, editor, business]) => {
    const c = mk(id, { name: business, business, editor, deal_at: '2026-09-20T09:00:00+03:00', char_at: '2026-09-22T10:00:00+03:00', shoot_at: '2026-10-14T10:00:00+03:00' });
    mark(id, importKeys('post').filter((k) => !/^p(22|23|23b|24|25|26|27)\./.test(k)), IMPORTED_AT, 'ייבוא');
    mark(id, itemsOf('p22a'), '2026-10-19T11:00:00+03:00', null, 'ofir');
    return c;
  });
  db.clients = [imp, shotC, ...busy];
  return db;
}

async function signedIn(role, db, { id = IMP, width = 390, device = null, engine = browser } = {}) {
  const fake = makeFlowFake(db);
  const phone = width < 600;
  const ctx = device
    ? await engine.newContext({ ...device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })
    : await engine.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: SIZES[width], isMobile: phone, hasTouch: phone });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}client.html?id=${encodeURIComponent(id)}`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#cc-head h1');
  await settle(page);
  if (SHOTS) await page.waitForTimeout(900); // the sign-in screen has faded out
  return { page, ctx, db };
}
const checkOf = (db, id, key) => db.protocol_checks.find((r) => r.client_id === id && r.item_key === key) || null;
const editorFact = (page) => page.locator('#cc-head .cc-facts .fact:has(#cc-assign)');
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page scrolls sideways');
const inside = async (page, loc) => { const b = await loc.boundingBox(); const w = await page.evaluate(() => window.innerWidth); assert.ok(b && b.x >= 0 && b.x + b.width <= w + 1, `outside the screen: ${JSON.stringify(b)}`); };
const tall = async (loc) => assert.ok((await loc.boundingBox()).height >= 44, 'a 44px target');
const checksBy = (db) => db.protocol_checks.reduce((m, r) => { (m[r.client_id] ||= {})[r.item_key] = r; return m; }, {});
const ringsAt = (db, now) => computeReminders({ clients: db.clients, checks: checksBy(db), tasks: db.client_tasks, staff: db.staff, now, log: [] });
const imported22a = (db) => itemsOf('p22a').map((k) => [k, checkOf(db, IMP, k)?.at, checkOf(db, IMP, k)?.note]);

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

// The imported client, tapped or clicked through. `tap`: WebKit's touch.
async function recordImported(page, db, { width, tap = false, name }) {
  const press = (sel) => (tap ? page.locator(sel).tap() : page.click(sel));
  const before = imported22a(db);
  const tasksBefore = db.client_tasks.length;
  const fact = editorFact(page);
  const btn = page.locator('#cc-assign');
  await btn.waitFor();
  assert.equal(await text(fact), 'עורך אין עורך שיוך עורך');
  assert.equal(await btn.getAttribute('data-mode'), 'record');
  await tall(btn);
  await inside(page, btn);
  await noOverflow(page);
  await shot(fact, `fact-none-${name}`);
  await shot(page, `card-none-${name}`);
  await press('#cc-assign');
  await page.waitForSelector('#dlg-assign[open]');
  assert.match(await text(page.locator('#as-h')), /^שיוך עורך · רוני אלמוג$/);
  assert.match(await text(page.locator('#as-meta')), /22א כבר מסומן/);
  assert.match(await text(page.locator('#as-after')), /הסימון ומועדי העריכה נשארים כמו שהם/);
  assert.equal(await page.locator('#as-clock-wrap').isHidden(), true);
  // qa.html's list of editors, each with its load; the least loaded (Anna) is suggested.
  assert.deepEqual(await page.locator('#as-editors input').evaluateAll((xs) => xs.map((x) => x.value)), ['nadia', 'yariv', 'anna', 'nirel']);
  assert.equal(await page.locator('#as-editors input:checked').getAttribute('value'), 'anna');
  assert.match(await text(page.locator('#as-editors label[for="as-e-nadia"]')), /נדיה .*2 לקוחות בעריכה/);
  await inside(page, page.locator('#as-submit'));
  await shot(page.locator('#dlg-assign'), `dialog-record-${name}`);
  await press('label[for="as-e-nadia"]');
  assert.equal(await page.isChecked('#as-e-nadia'), true);
  await press('#as-submit');
  await page.waitForSelector('#dlg-assign:not([open])', { state: 'attached' });
  await page.waitForFunction(() => /שויך לנדיה/.test(document.querySelector('#toast')?.textContent || ''));
  assert.match(await text(page.locator('#toast')), /רוני אלמוג שויך לנדיה\. 22א והמועדים נשארו כמו שהם\./);
  await settle(page);
  // The card: Nadia, and "שינוי" for the people who assign.
  const c = db.clients.find((x) => x.id === IMP);
  assert.equal(c.editor, 'nadia');
  assert.match(await text(editorFact(page)), /^עורך נדיה ?שינוי$/);
  assert.equal(await page.locator('#cc-assign').getAttribute('data-mode'), 'change');
  await tall(page.locator('#cc-assign'));
  // 22א as the import left it (time, note), no folder task; the reason mark says who recorded it.
  assert.deepEqual(imported22a(db), before);
  assert.equal(db.client_tasks.length, tasksBefore, 'no folder task');
  const reason = JSON.parse(checkOf(db, IMP, 'p22a.reason').note);
  assert.deepEqual([reason.editor, reason.card, reason.kept], ['nadia', true, true]);
  assert.match(reason.reason, /העורך נרשם מתוך תיק הלקוח: נדיה · המועדים לא השתנו/);
  // The editing is history (the import closed 22–27): no ring and no WhatsApp about its dates, nothing restarted.
  assert.deepEqual(ringsAt(db, new Date(NOW.getTime() + 60e3)).filter((r) => r.clientId === IMP && ['editing', 'fast'].includes(r.rule)), []);
  assert.equal(await page.locator('#handoff:not([hidden])').count(), 0);
  await noOverflow(page);
  await shot(page, `card-after-${name}`);
  await shot(editorFact(page), `fact-after-${name}`);
  await page.click('#handoff-close').catch(() => {});
  void width;
}

try {
  for (const width of [390, 1280]) {
    await step(`${width}px · Ofir, an imported client marked "שויך" with no editor: "שיוך עורך" records Nadia, 22א and the clocks stay`, async () => {
      const { page, ctx, db } = await signedIn('ofir', office(), { width });
      await recordImported(page, db, { width, name: `ofir-${width}` });
      // Opened again, the card reads Nadia from the database.
      await page.reload();
      await page.waitForSelector('#cc-assign');
      assert.match(await text(editorFact(page)), /^עורך נדיה ?שינוי$/);
      await ctx.close();
    });

    await step(`${width}px · Ofir, a client whose 22א is open: the card's dialog is qa.html's first assignment, and Anna is rung`, async () => {
      const { page, ctx, db } = await signedIn('ofir', office(), { id: SHOT, width });
      const btn = page.locator('#cc-assign');
      await btn.waitFor();
      assert.equal(await btn.getAttribute('data-mode'), 'first');
      assert.equal(await text(editorFact(page)), 'עורך אין עורך שיוך עורך');
      assert.deepEqual(ringsAt(db, new Date(NOW)).filter((r) => r.rule === 'editing' && r.clientId === SHOT), []);
      await btn.click();
      await page.waitForSelector('#dlg-assign[open]');
      assert.match(await text(page.locator('#as-h')), /^שיוך עורך · נועם פרץ$/);
      assert.doesNotMatch(await text(page.locator('#as-meta')), /לשייך עד/);
      assert.equal(await page.locator('#as-days-wrap').isVisible(), true);
      assert.match(await text(page.locator('#as-after')), /השיוך מסמן את 22א/);
      assert.equal(await page.locator('#as-editors input:checked').getAttribute('value'), 'anna');
      assert.equal(await text(page.locator('#as-suggested')), 'מומלץ לפי עומס');
      assert.equal(await page.locator('#as-editor2-add').isVisible(), true, 'the second editor is offered as in qa.html');
      await shot(page.locator('#dlg-assign'), `dialog-first-${width}`);
      await page.click('#as-submit');
      await page.waitForSelector('#dlg-assign:not([open])', { state: 'attached' });
      await settle(page);
      assert.equal(db.clients.find((c) => c.id === SHOT).editor, 'anna');
      for (const k of ['p22a.load', 'p22a.assigned', 'p22a.irit']) assert.equal(checkOf(db, SHOT, k)?.state, 'done', k);
      assert.equal(checkOf(db, SHOT, 'p22a.drive')?.note, 'נסגר לבד: ליאור אישר בסגירת יום הצילום שהכונן חזר');
      assert.ok(db.client_tasks.some((t) => t.client_id === SHOT && t.owner === 'ofir' && /פתיחת תיקייה מסודרת בדרייב לעריכה \(24\)/.test(t.title)));
      assert.match(await text(page.locator('#toast')), /נועם פרץ שויך לאנה\. נפתחה לאופיר משימת תיקייה \(24\)/);
      assert.match(await text(editorFact(page)), /^עורך אנה ?שינוי$/);
      // The editor's ring is due now, as after qa.html's assignment.
      const rung = ringsAt(db, new Date(NOW.getTime() + 60e3)).filter((r) => r.rule === 'editing' && r.step === 'assigned' && r.clientId === SHOT);
      assert.deepEqual(rung.map((r) => [r.person, r.level, r.title]), [['anna', 'ring', 'לקוח חדש בעריכה אצלך: פרץ נדל״ן · נועם פרץ']]);
      await page.waitForSelector('#handoff:not([hidden])');
      assert.match(await text(page.locator('#handoff')), /לאנה/);
      await noOverflow(page);
      await shot(page, `card-first-after-${width}`);
      // "שינוי" now is qa.html's swap (the editing is on), with its clocks.
      await page.click('#handoff-close').catch(() => {});
      await page.click('#cc-assign');
      await page.waitForSelector('#dlg-assign[open]');
      assert.match(await text(page.locator('#as-h')), /^החלפת עורך · נועם פרץ$/);
      assert.equal(await page.locator('#as-clock-wrap').isVisible(), true);
      assert.equal(await page.isDisabled('#as-e-anna'), true);
      await shot(page.locator('#dlg-assign'), `dialog-swap-${width}`);
      await page.click('#dlg-assign [data-close].btn');
      await page.waitForSelector('#dlg-assign:not([open])', { state: 'attached' });
      await ctx.close();
    });
  }

  await step('390px · Irit and Lior see "שיוך עורך"; Irit records Yariv on the imported client; Ilai sees no button', async () => {
    const db = office();
    const lior = await signedIn('lior', db, { width: 390 });
    assert.equal(await lior.page.locator('#cc-assign').getAttribute('data-mode'), 'record');
    await lior.ctx.close();
    const irit = await signedIn('irit', db, { width: 390 });
    const { page } = irit;
    await page.click('#cc-assign');
    await page.waitForSelector('#dlg-assign[open]');
    await page.click('label[for="as-e-yariv"]');
    await page.click('#as-reason');
    await page.keyboard.type('ממשיךך', { delay: 30 });
    await page.keyboard.press('Backspace');
    assert.equal(await page.inputValue('#as-reason'), 'ממשיך');
    await page.click('#as-submit');
    await page.waitForSelector('#dlg-assign:not([open])', { state: 'attached' });
    await settle(page);
    assert.equal(db.clients.find((c) => c.id === IMP).editor, 'yariv');
    assert.match(JSON.parse(checkOf(db, IMP, 'p22a.reason').note).reason, /יריב · ממשיך · המועדים לא השתנו/);
    assert.equal(checkOf(db, IMP, 'p22a.reason').by_email, emailOf('irit'));
    assert.match(await text(editorFact(page)), /^עורך יריב ?שינוי$/);
    await shot(page, 'card-irit-390');
    // "שינוי" with no editing on: only the editor is rewritten, the clocks stay.
    await page.click('#handoff-close').catch(() => {});
    await page.click('#cc-assign');
    await page.waitForSelector('#dlg-assign[open]');
    assert.match(await text(page.locator('#as-h')), /^החלפת עורך · רוני אלמוג$/);
    assert.equal(await page.isDisabled('#as-e-yariv'), true);
    assert.equal(await page.locator('#as-clock-wrap').isHidden(), true);
    await page.click('label[for="as-e-anna"]');
    await page.click('#as-submit');
    await page.waitForSelector('#dlg-assign:not([open])', { state: 'attached' });
    await settle(page);
    assert.equal(db.clients.find((c) => c.id === IMP).editor, 'anna');
    assert.match(JSON.parse(checkOf(db, IMP, 'p22a.reason').note).reason, /מיריב לאנה · המועדים לא השתנו/);
    assert.equal(checkOf(db, IMP, 'p22a.assigned').at, IMPORTED_AT);
    await irit.ctx.close();
    const ilai = await signedIn('ilai', office(), { width: 390 });
    assert.equal(await ilai.page.locator('#cc-assign').count(), 0);
    await ilai.ctx.close();
  });

  await step('WebKit (iPhone 13), Ofir: the imported client, tapped through', async () => {
    const wk = await webkit.launch();
    try {
      const { page, ctx, db } = await signedIn('ofir', office(), { device: devices['iPhone 13'], engine: wk });
      await recordImported(page, db, { width: 390, tap: true, name: 'webkit-iphone13' });
      await ctx.close();
    } finally {
      await wk.close();
    }
  });

  noCspViolations();
  assert.deepEqual(errors, []);
  console.log(`\n${passed} steps passed.`);
} finally {
  await browser.close();
}
