// One videos number on "מעקב לקוחות" and on the client's card, and step 24 only when the Drive has
// the videos (the owner, 17.11.2026; docs/ops.md, section 140), against the office of
// tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in Israel; invented names):
//   ניקיון והיגיינה  48 videos, Yariv typed 31, the Drive has 31 edited (and 30 of footage): the row
//                    and the card both say 31 / 48. Its editing is done (22 marked): Yariv's "בוצע" and
//                    tick on 24 in the card are refused with the Drive's count, and nothing is written.
//   מוסך אבי         two editors and a second shoot; typed 15, Irit fixed it to 20: both screens say
//                    20 / 42 with "עודכן ביד · עירית", the card with each part under it, small.
//   פרחי הגליל       Yariv edits it now: "מוכן לבדיקה" on editor.html with 10 of 24 in the Drive is
//                    refused inside the dialog, and nothing of the hand-off is marked.
//   1  Irit on an iPhone 13 (WebKit) and at 1366 (Chromium): the row, the card;
//   2  Yariv on an iPhone 13 (WebKit) and at 1366 (Chromium): the card's refusals;
//   3  Yariv on editor.html (WebKit iPhone and Chromium 1366): the dialog's refusal.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: node <a static server> . 8481 &  then  BASE_URL=http://localhost:8481/ node tests/track-sync-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { importKeys } from '../app/client-open.js';
import { clientState } from '../app/protocol-logic.js';

const BASE = process.env.BASE_URL || 'http://localhost:8481/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = async (target, name, opts = {}) => { if (SHOTS) await target.screenshot({ path: `${OUT}${name}.png`, ...opts }); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const [N, AVI, M] = [301, 302, 303].map(cid);
const FOLDER = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQr';
const REFUSED = /בדרייב יש 31 סרטונים ערוכים מתוך 48\. אפשר לסמן רק אחרי שכולם עלו לדרייב\./;

const files = (n, path, at = '2026-10-18T10:00:00Z') => Array.from({ length: n }, (_, i) => ({
  name: `${i + 1}.mp4`, mimeType: 'video/mp4', createdTime: at, link: `https://drive.google.com/file/d/x${i}/view`, path,
}));
function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  for (const t of ['protocol_checks', 'client_tasks', 'deal_requests', 'client_gantt', 'client_scripts', 'client_access_links', 'client_status_links', 'client_status_views', 'client_approvals', 'client_surveys', 'client_consents']) db[t] = [];
  const mk = (id, name, business, fields = {}) => ({
    ...base, id, name, business, editor: 'yariv', editor2: null, editor_split: null, rounds: [], links: { drive: FOLDER }, landing: false, landed_at: null, landed_by: null, landing_slot: null,
    protocol_version: 13, shoot_type: 'dms', characterizer: 'ofir', has_logo: true, created_by_email: emailOf('irit'),
    deal_at: '2026-09-20T09:00:00+03:00', char_at: '2026-09-22T10:00:00+03:00', shoot_at: '2026-10-14T10:00:00+03:00', status: 'active', ...fields,
  });
  db.clients = [
    mk(N, 'רון שגב', 'ניקיון והיגיינה', { deliverables: { videos: 48, graphics: 20, shoot_days: 1 } }),
    mk(AVI, 'אבי לוי', 'מוסך אבי', {
      editor: 'nadia', editor2: 'yariv', editor_split: { nadia: 11, yariv: 10 }, rounds: [{ n: 2, shoot_at: '2026-10-16T10:00:00+03:00', start_at: '2026-10-15T09:00:00+03:00', editor: 'anna' }],
      deliverables: { videos: 42, graphics: 42, shoot_days: 2, tracking: { videos: { done: 20, by: 'irit', at: '2026-10-19T09:00:00+03:00', auto: { done: 15, of: 42 } } } },
    }),
    mk(M, 'גלית אור', 'פרחי הגליל', { deliverables: { videos: 24, graphics: 12, shoot_days: 1 } }),
  ];
  const mark = (id, keys, when, note = null, by = 'yariv') => { for (const k of [].concat(keys)) db.protocol_checks.push({ client_id: id, item_key: k, state: 'done', note, by_email: emailOf(by), at: when }); };
  for (const c of db.clients) {
    mark(c.id, importKeys('post').filter((k) => !/^p(22a|22|23|23b|24|25|26|27)\./.test(k)), '2026-10-01T09:00:00+03:00', 'ייבוא', 'irit');
    mark(c.id, 'p22a.assigned', '2026-10-15T11:00:00+03:00', null, 'ofir');
  }
  // ניקיון: the editing is done (every item of 22), 24 is open.
  const cs = Object.fromEntries(db.protocol_checks.filter((r) => r.client_id === N).map((r) => [r.item_key, r]));
  mark(N, clientState(db.clients[0], cs, NOW).states.find((s) => s.proc.id === 'p22').proc.items.map((i) => i.key), '2026-10-19T15:00:00+03:00');
  db.editor_progress = [
    { client_id: N, editor: 'yariv', round: 1, edited: 31, updated_at: '2026-10-19T12:00:00+03:00' },
    { client_id: AVI, editor: 'nadia', round: 1, edited: 8, updated_at: '2026-10-19T12:00:00+03:00' },
    { client_id: AVI, editor: 'yariv', round: 1, edited: 4, updated_at: '2026-10-19T12:00:00+03:00' },
    { client_id: AVI, editor: 'anna', round: 2, edited: 3, updated_at: '2026-10-19T12:00:00+03:00' },
  ];
  db.drive_daily = [
    { client_id: N, day: '2026-10-15', folder: 'סרטונים ערוכים', kind: 'video', files: 20 },
    { client_id: N, day: '2026-10-18', folder: 'סרטונים ערוכים', kind: 'video', files: 11 },
    { client_id: N, day: '2026-10-14', folder: 'גלם יום 1', kind: 'raw', files: 30 },
    { client_id: M, day: '2026-10-18', folder: 'סרטונים ערוכים', kind: 'video', files: 10 },
  ];
  // The folders as the drive function lists them now.
  db.drive_files = {
    [N]: [...files(31, 'סרטונים ערוכים'), ...files(30, 'גלם יום 1', '2026-10-14T12:00:00Z')],
    [M]: files(10, 'סרטונים ערוכים'),
  };
  return db;
}

async function signedIn(engine, role, db, { width = 390, device = null, path, wait }) {
  const fake = makeFlowFake(db);
  const phone = !device && width < 600;
  const ctx = device
    ? await engine.newContext({ ...device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })
    : await engine.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${role} ${path}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role} ${path}: ${msg.text()}`); });
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
const toastSays = (page, re) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector('#toast')?.textContent || ''), re.source, { timeout: 8000 });
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

const wk = await webkit.launch();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ENGINES = [['iphone', wk, { device: devices['iPhone 13'] }], ['1366', browser, { width: 1366 }]];

// ── 1. One number on both screens ──
for (const [name, engine, size] of ENGINES) {
  await step(`1  Irit (${name}): the row and the card say the same`, async () => {
    const db = office();
    const { page, ctx } = await signedIn(engine, 'irit', db, { ...size, path: 'tracking.html', wait: '#ct-body tr[data-id]' });
    const videos = (id) => page.locator(`#ct-${id} td[data-kind="videos"]`);
    assert.match(await text(videos(N)), /^31 \/ 48/);
    assert.equal(await videos(N).locator('.ct-ok').count(), 0, 'not complete');
    assert.match(await text(videos(AVI)), /20 \/ 42.*עודכן ביד · עירית · 19\.10/);
    assert.match(await text(videos(M)), /^10 \/ 24/);
    await noOverflow(page);
    await shot(page, `tracking-row-${name}`, { fullPage: true });
    // The totals above the table: the videos of the clients that had a shoot day, the graphics of all.
    const stats = async () => (await page.locator('#ct-stats li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    assert.deepEqual(await stats(), ['סרטונים נערכו 61 מתוך 114 3 לקוחות', 'גרפיקות הועלו 27 מתוך 74 3 לקוחות']);
    await page.locator('#ct-stats').scrollIntoViewIfNeeded();
    await shot(page, `tracking-totals-${name}`);
    // Yariv: his clients; מוסך אבי counts his own 4 of his 10.
    await page.selectOption('#ct-person', 'yariv');
    assert.deepEqual(await stats(), ['סרטונים נערכו · יריב 45 מתוך 82 3 לקוחות']);
    assert.equal(await page.locator('#ct-body tr[data-id]').count(), 3);
    await noOverflow(page);
    await shot(page, `tracking-filter-yariv-${name}`, { fullPage: true });
    // Nadia: only מוסך אבי, her 8 of 11.
    await page.selectOption('#ct-person', 'nadia');
    assert.deepEqual(await stats(), ['סרטונים נערכו · נדיה 8 מתוך 11 לקוח אחד']);
    assert.deepEqual(await page.locator('#ct-body tr[data-id]').evaluateAll((trs) => trs.map((t) => t.dataset.id)), [AVI]);
    // Ilai: every client, the graphics only.
    await page.selectOption('#ct-person', 'ilai');
    assert.deepEqual(await stats(), ['גרפיקות הועלו 27 מתוך 74 3 לקוחות']);
    assert.equal(await page.locator('#ct-body tr[data-id]').count(), 3);
    await shot(page, `tracking-filter-ilai-${name}`);
    await page.selectOption('#ct-person', '');
    assert.equal((await stats()).length, 2);
    for (const [id, want, more] of [[N, '31/48', null], [AVI, '20/42', /נדיה 8\/11 · יריב 4\/10 · סבב 2: 3\/21/]]) {
      const card = await signedIn(engine, 'irit', db, { ...size, path: `client.html?id=${id}`, wait: '#cc-edited' });
      const page = card.page;
      assert.equal(await text(page.locator('#cc-edited-n')), want);
      if (more) {
        assert.match(await text(page.locator('#cc-edited .cc-edited-fix')), /עודכן ביד · עירית · 19\.10/);
        assert.match(await text(page.locator('#cc-edited .cc-edited-more')), more);
      } else {
        assert.equal(await page.locator('#cc-edited .cc-edited-more, #cc-edited .cc-edited-fix').count(), 0, 'one part: the number alone');
      }
      await noOverflow(page);
      await page.locator('#cc-edited').scrollIntoViewIfNeeded();
      await shot(page, `card-edited-${id === N ? 'nikayon' : 'avi'}-${name}`);
      if (SHOTS) await page.locator('#cc-head .cc-facts').screenshot({ path: `${OUT}card-facts-${id === N ? 'nikayon' : 'avi'}-${name}.png` });
      await card.ctx.close();
    }
    await ctx.close();
  });
}

// ── 2. The card: 24 is refused while the Drive has 31 of 48 ──
for (const [name, engine, size] of ENGINES) {
  await step(`2  Yariv (${name}): the tick and "בוצע" on 24 are refused with the Drive's count; nothing is written`, async () => {
    const db = office();
    const { page, ctx } = await signedIn(engine, 'yariv', db, { ...size, path: `client.html?id=${N}`, wait: '#cc-head h1' });
    await (await show24(page)).locator('#p24-bulk').click();
    await toastSays(page, /אף פריט לא סומן\. בדרייב יש 31 סרטונים ערוכים מתוך 48/);
    for (const k of ['p24.folder', 'p24.drive', 'p24.notify']) assert.equal(checkOf(db, N, k), null, k);
    await page.waitForTimeout(250);
    await noOverflow(page);
    await shot(page, `card-refused-bulk-${name}`);
    // The single tick in the checklist: refused before the box is ticked.
    const open = async () => { const p24 = await show24(page); const fold = p24.locator('details.chk-fold'); if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').click(); return p24; };
    await (await open()).locator('#i-p24-drive').click();
    await toastSays(page, /^(?![^]*אף פריט)[^]*בדרייב יש 31 סרטונים ערוכים מתוך 48/);
    await page.waitForTimeout(300);
    assert.equal(checkOf(db, N, 'p24.drive'), null);
    assert.equal(await page.locator('#i-p24-drive').isChecked(), false, 'the box stays empty');
    await page.waitForTimeout(250);
    await shot(page, `card-refused-tick-${name}`);
    // The Drive gets the rest: the same tick is taken.
    db.drive_files[N] = [...db.drive_files[N], ...files(17, 'סרטונים ערוכים')];
    await (await open()).locator('#i-p24-drive').click();
    await page.waitForFunction(() => document.querySelector('#i-p24-drive')?.checked === true, null, { timeout: 8000 });
    await settle(page);
    assert.ok(checkOf(db, N, 'p24.drive'), 'taken once the Drive has 48');
    await ctx.close();
  });
}

// ── 3. editor.html: "מוכן לבדיקה" with 10 of 24 in the Drive ──
for (const [name, engine, size] of ENGINES) {
  await step(`3  Yariv on editor.html (${name}): "מוכן לבדיקה" is refused in the dialog; nothing of the hand-off is marked`, async () => {
    const db = office();
    const before = db.protocol_checks.length;
    const { page, ctx } = await signedIn(engine, 'yariv', db, { ...size, path: 'editor.html', wait: `#c-${M}-go` });
    await page.locator(`#c-${M}-go`).click();
    await page.waitForSelector('#dlg-ready[open]');
    await page.fill('#ready-link', FOLDER);
    await page.click('label[for="ready-all"]');
    await page.click('#ready-submit');
    await page.waitForFunction(() => /בדרייב יש 10 סרטונים ערוכים מתוך 24/.test(document.getElementById('ready-err')?.textContent || ''), null, { timeout: 8000 });
    assert.equal(await text(page.locator('#ready-err')), 'בדרייב יש 10 סרטונים ערוכים מתוך 24. אפשר לסמן רק אחרי שכולם עלו לדרייב.');
    assert.equal(await page.locator('#dlg-ready').evaluate((d) => d.open), true, 'the dialog stays open');
    assert.equal(await page.locator('#ready-submit').isDisabled(), false);
    assert.equal(db.protocol_checks.length, before, 'nothing written');
    for (const k of ['p24.folder', 'p24.drive', 'p24.notify', 'p22.check.footage']) assert.equal(checkOf(db, M, k), null, k);
    await page.waitForTimeout(250);
    await shot(page, `editor-ready-refused-${name}`);
    await ctx.close();
  });
}

await wk.close();
await browser.close();
noCspViolations();
assert.deepEqual(errors, []);
console.log(`\n${passed} passed`);
