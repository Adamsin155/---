// "מעקב לקוחות" (tracking.html; the owner, 9.11.2026, for Irit) in the browser, against the office of
// tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in Israel; invented names), with six clients of
// its own:
//   קפה דנה       everything done: 36/36 videos (the editing finished before the counter),
//                 36/36 graphics (7ב and 23ב), 1/1 shoot day, "אחרון: 10.9"
//   מוסך אבי      two editors typing 8 and 4 (12/42), the first 9 graphics up (9/42), 1/2 shoot
//                 days, "אחרון: 1.10 · הבא: 5.11"
//   Pizza Roma    nothing yet, no editor: "—", 0/25, 0/20, 0/1, "הבא: טרם נקבע"
//   אלאור בוטיק   a monthly client: "3 / 8 החודש"; 2 graphics "עלה" in the Gantt (2/20)
//   a long name   wraps, never pushes the page sideways
//   an ended one  not in the list
// The tab "ימי צילום" (10.11.2026) on the same clients: Pizza Roma (no date, deal 15.6), אלאור בוטיק
// (every month, nothing in October) and the long name (3 days, 1 held) wait; מוסך אבי is set for
// 5.11; קפה דנה has held its only day. The tabs: #shoots and #tasks in the address; the last one kept on the device.
//   1  Irit on an iPhone 13 (WebKit): the cards, the numbers, ✓, the dates; the search typed key by
//      key and deleted with Backspace; no sideways scroll; the menu has "מעקב לקוחות";
//   2  the same on Chromium at 390;
//   3  Irit at 1366 (Chromium): the table, its five columns, the link to the client's card;
//   4  Lior at 1366: he sees it too (the manager profile); Nadia (an editor): "אין לך גישה".
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: npx http-server -p 8471 -s -c-1 . &  then  BASE_URL=http://localhost:8471/ node tests/tracking-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8471/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = async (target, name, opts = {}) => { if (SHOTS) await target.screenshot({ path: `${OUT}${name}.png`, ...opts }); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();

const DANA = cid(101);
const AVI = cid(102);
const ROMA = cid(103);
const ELIOR = cid(104);
const LONG = cid(105);
const ENDED = cid(106);
const LONG_NAME = 'המרכז הישראלי לשיקום ופיזיותרפיה מתקדמת בע״מ';

function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  for (const t of ['protocol_checks', 'client_tasks', 'client_gantt', 'client_scripts']) db[t] = [];
  const client = (id, fields) => ({
    ...base, id, editor: null, editor2: null, editor_split: null, rounds: [], links: {}, landing: false, landed_at: null, landed_by: null, landing_slot: null,
    protocol_version: 12, status: 'active', shoot_type: 'natali', deal_at: '2026-08-01T09:00:00+03:00', char_at: '2026-08-04T10:00:00+03:00', contract_end: '2027-08-01', ...fields,
  });
  db.clients = [
    client(DANA, { name: 'דנה כהן', business: 'קפה דנה', editor: 'nadia', shoot_at: '2026-09-10T11:00:00+03:00', deliverables: { videos: 36, graphics: 36, shoot_days: 1 } }),
    client(AVI, {
      name: 'אבי לוי', business: 'מוסך אבי', editor: 'nadia', editor2: 'yariv', editor_split: { nadia: 11, yariv: 10 }, shoot_at: '2026-10-01T10:00:00+03:00',
      rounds: [{ n: 2, shoot_at: '2026-11-05T10:00:00+02:00', start_at: '2026-10-15T09:00:00+03:00' }], deliverables: { videos: 42, graphics: 42, shoot_days: 2, ch14: 1 },
    }),
    client(ROMA, { name: 'רומן', business: 'Pizza Roma', shoot_at: null, deal_at: '2026-06-15T09:00:00+03:00', deliverables: { videos: 25, graphics: 20, shoot_days: 1 } }),
    client(ELIOR, { name: 'ניב בן שימול', business: 'אלאור בוטיק', editor: 'anna', shoot_at: '2026-09-15T11:00:00+03:00', deliverables: { videos_month: 8, graphics: 20, shoot_days: 1, shoot_monthly: true } }),
    client(LONG, { name: 'ד״ר אלכסנדרה ברקוביץ׳-שטרנברג', business: LONG_NAME, editor: 'yariv', shoot_at: '2026-10-12T10:00:00+03:00', deliverables: { videos: 36, graphics: 36, shoot_days: 3, ch14: 2, ch14_dates: [{ at: '2026-11-12T10:00:00+02:00', by: 'lior', set_at: '2026-10-19T09:00:00+03:00' }] } }),
    client(ENDED, { name: 'סגור', business: 'עסק שהסתיים', status: 'ended', deliverables: { videos: 10 } }),
  ];
  const mark = (id, key, note = null) => db.protocol_checks.push({ client_id: id, item_key: key, state: 'done', note, by_email: emailOf('ilai'), at: '2026-10-01T09:00:00+03:00' });
  mark(DANA, 'p24.drive', 'ייבוא');
  mark(DANA, 'p07b.posted', 'ייבוא');
  mark(DANA, 'p23b.posted');
  mark(AVI, 'p07b.posted');
  db.editor_progress = [
    { client_id: AVI, editor: 'nadia', round: 1, edited: 8, updated_at: '2026-10-19T12:00:00+03:00' },
    { client_id: AVI, editor: 'yariv', round: 1, edited: 4, updated_at: '2026-10-19T12:00:00+03:00' },
  ];
  db.editor_progress_month = [{ client_id: ELIOR, editor: 'anna', month: '2026-10', edited: 3, updated_at: '2026-10-19T12:00:00+03:00' }];
  db.client_gantt = [1, 2, 3].map((i) => ({
    id: `e0000000-0000-4000-8000-00000000000${i}`, client_id: ELIOR, key: `graphic-${i}`, kind: 'graphic', title: `גרפיקה ${i}`, day: `2026-10-0${i}`, time_il: '13:00',
    month: 3, num: i, internal: false, state: i < 3 ? 'posted' : 'planned', posted_on: null, file_id: null, link: null, note: null, edited: false, template_version: 1, by_email: emailOf('ilai'), at: '2026-10-01T09:00:00+03:00',
  }));
  return db;
}

async function signedIn(db, { person, width = 390, device = null, engine, path = 'tracking.html', wait = '#ct-body tr' }) {
  const fake = makeFlowFake(db);
  const ctx = device
    ? await engine.newContext({ ...device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })
    : await engine.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width, height: width < 600 ? 800 : 900 }, isMobile: width < 600, hasTouch: width < 600 });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${person} ${path}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${person} ${path}: ${msg.text()}`); });
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf(person));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector(wait);
  await settle(page);
  if (SHOTS) await page.waitForTimeout(900); // the sign-in screen has faded out
  return { page, ctx };
}
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page scrolls sideways');
const rowIds = (page) => page.locator('#ct-body tr[data-id]').evaluateAll((trs) => trs.map((tr) => tr.dataset.id));
const cell = (page, id, n) => page.locator(`#ct-${id} td`).nth(n);

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

// What every width shows: the rows, by name, and their numbers.
async function numbers(page) {
  const ids = await rowIds(page);
  assert.equal(ids.length, 5, 'five clients in work; the ended one is not here');
  assert.ok(!ids.includes(ENDED));
  assert.equal(await text(page.locator('#ct-count')), '5 לקוחות');
  // The order: by the client's name (Hebrew first, then Latin, as the clients list).
  const labels = await page.locator('#ct-body tr[data-id] td:first-child a').allInnerTexts();
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, 'he')));
  // קפה דנה: all done, three ✓.
  assert.equal(await page.locator(`#ct-${DANA} .ct-ok`).count(), 3);
  assert.match(await text(cell(page, DANA, 2)), /36 \/ 36/);
  assert.match(await text(cell(page, DANA, 3)), /36 \/ 36/);
  assert.match(await text(cell(page, DANA, 4)), /1 \/ 1.*אחרון: 10\.9/);
  assert.doesNotMatch(await text(cell(page, DANA, 4)), /הבא/);
  assert.equal(await cell(page, DANA, 2).locator('.num').getAttribute('dir'), 'ltr');
  // מוסך אבי: two editors, their typed numbers, the first nine graphics, a shoot day ahead.
  assert.match(await text(cell(page, AVI, 1)), /נדיה \+ יריב/);
  assert.match(await text(cell(page, AVI, 2)), /12 \/ 42/);
  assert.match(await text(cell(page, AVI, 3)), /9 \/ 42/);
  assert.match(await text(cell(page, AVI, 4)), /1 \/ 2.*אחרון: 1\.10.*הבא: 5\.11/);
  assert.equal(await page.locator(`#ct-${AVI} .ct-ok`).count(), 0);
  // Pizza Roma: nothing yet.
  assert.match(await text(cell(page, ROMA, 1)), /—/);
  assert.match(await text(cell(page, ROMA, 2)), /0 \/ 25/);
  assert.match(await text(cell(page, ROMA, 3)), /0 \/ 20/);
  assert.match(await text(cell(page, ROMA, 4)), /0 \/ 1.*הבא: טרם נקבע/);
  // אלאור בוטיק: this month's number; the Gantt's two "עלה".
  assert.match(await text(cell(page, ELIOR, 2)), /3 \/ 8 החודש/);
  assert.match(await text(cell(page, ELIOR, 3)), /2 \/ 20/);
  assert.match(await text(cell(page, ELIOR, 1)), /אנה/);
  // The client opens its card.
  assert.equal(await page.locator(`#ct-${DANA} td:first-child a`).getAttribute('href'), `client.html?id=${DANA}`);
}

// The search, typed key by key and deleted with Backspace.
async function search(page, name) {
  const box = page.locator('#ct-q');
  await box.click();
  await box.pressSequentially('pizza', { delay: 40 });
  assert.equal(await box.inputValue(), 'pizza');
  assert.deepEqual(await rowIds(page), [ROMA]);
  assert.equal(await text(page.locator('#ct-count')), 'לקוח אחד מתוך 5');
  await shot(page, `tracking-search-${name}`);
  for (let i = 0; i < 5; i += 1) await box.press('Backspace');
  assert.equal(await box.inputValue(), '');
  assert.equal((await rowIds(page)).length, 5);
  await box.pressSequentially('דנה', { delay: 40 });
  assert.deepEqual(await rowIds(page), [DANA]);
  await box.press('Backspace');
  assert.equal(await box.inputValue(), 'דנ');
  assert.deepEqual(await rowIds(page), [DANA]);
  await box.pressSequentially('ז', { delay: 40 });
  assert.equal(await page.locator('#ct-body tr[data-id]').count(), 0);
  assert.equal(await text(page.locator('#ct-body')), 'אין לקוח בשם הזה.');
  await box.press('Backspace');
  await box.press('Backspace');
  await box.press('Backspace');
  assert.equal(await box.inputValue(), '');
  assert.equal((await rowIds(page)).length, 5);
}

async function phone(engine, { device = null, width = 390, name }) {
  const db = office();
  const { page, ctx } = await signedIn(db, { person: 'irit', device, width, engine });
  await numbers(page);
  // A card, not a table: the header row is out of sight, and nothing scrolls sideways.
  assert.equal(await page.locator('#ct thead').evaluate((el) => el.getBoundingClientRect().height <= 1), true);
  const card = await page.locator(`#ct-${AVI}`).boundingBox();
  const vw = await page.evaluate(() => window.innerWidth);
  assert.ok(card.width <= vw, 'the card fits');
  assert.ok((await page.locator(`#ct-${DANA} td:first-child a`).boundingBox()).height >= 44, 'a 44px target');
  await noOverflow(page);
  await shot(page, `tracking-${name}`, { fullPage: true });
  await search(page, name);
  await noOverflow(page);
  await shootsTab(page, name, { phone: true });
  await noOverflow(page);
  await shootFixes(page, db, name, { phone: true });
  await ch14(page, db, name, { phone: true });
  await countFixes(page, db, name, { phone: true });
  // Irit's menu has it ("עוד" on a phone): the entry is there.
  assert.ok(await page.locator('a[href="tracking.html"]').count() >= 1, 'in her menu');
  await ctx.close();
}

async function desktop(engine, { person = 'irit', width = 1366, name }) {
  const db = office();
  const { page, ctx } = await signedIn(db, { person, width, engine });
  await numbers(page);
  assert.deepEqual((await page.locator('#ct thead th').allInnerTexts()).map((t) => t.trim()), ['לקוח', 'עורך', 'סרטונים נערכו', 'גרפיקות הועלו', 'ימי צילום']);
  if (person === 'lior') {
    // Lior reads: no number to tap, no editor link; he does set the Channel 14 dates.
    assert.equal(await page.locator('#ct .ct-fix').count(), 0, 'no fix on the first tab');
    assert.equal(await page.locator('#ct .ct-ed-change').count(), 0);
  } else {
    assert.equal(await page.locator(`#ct-${AVI} .ct-ed-change`).getAttribute('href'), `client.html?id=${AVI}#assign`);
  }
  // A table: the five cells of a row side by side, on one line.
  const tops = await page.locator(`#ct-${AVI} td`).evaluateAll((tds) => tds.map((td) => Math.round(td.getBoundingClientRect().top)));
  assert.equal(new Set(tops).size, 1, 'one line');
  assert.ok(await page.locator('a[href="tracking.html"]').count() >= 1, 'in the menu');
  await noOverflow(page);
  await shot(page, `tracking-${name}`, { fullPage: true });
  await search(page, name);
  await shootsTab(page, name, { phone: false });
  if (person === 'lior') {
    assert.equal(await page.locator('#sh .ct-fix').count(), 0, 'no fix on "ימי צילום"');
    assert.ok(await page.locator('#sh .sh-14-set').count() >= 2, 'Lior sets the Channel 14 dates');
  } else {
    // All eight columns in sight at 1366, with the Channel 14 one.
    const fit = await page.locator('#sh-wrap').evaluate((el) => [el.scrollWidth, el.clientWidth]);
    await shot(page, 'tracking-shoots-before-fix-1366', { fullPage: true });
    assert.ok(fit[0] <= fit[1] + 1, `the table fits: ${fit}`);
    await shootFixes(page, db, name, { phone: false });
    await ch14(page, db, name, { phone: false });
    await countFixes(page, db, name, { phone: false });
    await page.locator('#tab-shoots').click();
  }
  await page.locator(`#sh-${ROMA} .sh-act a`).click();
  await page.waitForURL(/client\.html\?id=/);
  await ctx.close();
}

// The tabs, and "ימי צילום".
const shIds = (page) => page.locator('#sh-body tr[data-id]').evaluateAll((trs) => trs.map((tr) => tr.dataset.id));
const shCell = (page, id, n) => page.locator(`#sh-${id} td`).nth(n);
async function shootsTab(page, name, { phone }) {
  // Three tabs; the first is open.
  assert.deepEqual((await page.locator('#ct-tabs [role=tab]').allInnerTexts()).map((t) => t.trim()), ['סרטונים וגרפיקות', 'ימי צילום', 'משימות לעורכים ולגרפיקאי']);
  assert.equal(await page.locator('#tab-videos').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#view-shoots').isVisible(), false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, `tracking-tabs-${name}`);
  await page.locator('#tab-shoots').click();
  assert.ok(page.url().endsWith('#shoots'));
  assert.equal(await page.locator('#ct-view').isVisible(), false);
  assert.equal(await page.locator('#tab-shoots').getAttribute('aria-selected'), 'true');
  // The order: waiting first, the oldest deal first; then the set; then the done.
  assert.deepEqual(await shIds(page), [ROMA, ELIOR, LONG, AVI, DANA]);
  assert.deepEqual((await page.locator('#sh-stats .v').allInnerTexts()).map((t) => t.trim()), ['3', '1', '1', '1', '2']);
  assert.equal(await text(page.locator('#sh-stats .sh-stat-sub')), '0 נקבעו מתוך 2');
  // Channel 14: מוסך אבי waits; the long name has two items, the first set.
  assert.match(await text(shCell(page, AVI, 6)), /ממתין לקביעה/);
  assert.match(await text(shCell(page, LONG, 6)), /נקבע · 12.11.*ממתין לקביעה/);
  assert.equal(await shCell(page, DANA, 6).getAttribute('class'), 'sh-14 is-none');
  assert.equal(await text(page.locator('#sh-foot')), 'סה״כ: 3 לקוחות שטרם נקבע להם יום צילום');
  assert.equal(await text(page.locator('#sh-count')), '5 לקוחות');
  // The cells.
  assert.match(await text(shCell(page, ROMA, 1)), /15\.6\.2026/);
  assert.match(await text(shCell(page, ROMA, 5)), /ממתין לקביעה/);
  assert.equal(await page.locator(`#sh-${ROMA} .sh-act a`).getAttribute('href'), `client.html?id=${ROMA}#p11`);
  assert.equal(await text(page.locator(`#sh-${ROMA} .sh-act a`)), 'קביעת יום צילום');
  assert.match(await text(shCell(page, AVI, 2)), /2/);
  assert.match(await text(shCell(page, AVI, 3)), /1/);
  assert.match(await text(shCell(page, AVI, 5)), /נקבע · 5\.11/);
  assert.equal(await text(page.locator(`#sh-${AVI} .sh-act a`)), 'צפה בפרטים');
  assert.match(await text(shCell(page, ELIOR, 2)), /1/);
  assert.match(await text(shCell(page, ELIOR, 4)), /יום צילום כל חודש/);
  assert.equal(await page.locator(`#sh-${ELIOR} .sh-act a`).getAttribute('href'), `client.html?id=${ELIOR}#add-round`);
  assert.match(await text(shCell(page, LONG, 2)), /3/);
  assert.match(await text(shCell(page, LONG, 3)), /2/);
  assert.match(await text(shCell(page, LONG, 4)), /נטלי/);
  assert.match(await text(shCell(page, DANA, 5)), /בוצעו כולם/);
  if (phone) {
    assert.equal(await page.locator('#sh thead').evaluate((el) => el.getBoundingClientRect().height <= 1), true);
    assert.ok((await page.locator(`#sh-${ROMA} .sh-act a`).boundingBox()).height >= 44, 'a 44px button');
  } else {
    const tops = await page.locator(`#sh-${AVI} td`).evaluateAll((tds) => tds.map((td) => Math.round(td.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size, 1, 'one line');
  }
  await noOverflow(page);
  if (!phone) {
    // All seven columns in sight at 1366: the table does not scroll sideways.
    const fit = await page.locator('#sh-wrap').evaluate((el) => [el.scrollWidth, el.clientWidth]);
    if (fit[0] > fit[1] + 1) await shot(page, `tracking-shoots-wide-${name}`, { fullPage: true });
    if (fit[0] > fit[1] + 1) console.log(await page.locator('#sh thead th').evaluateAll((ths) => ths.map((t) => Math.round(t.getBoundingClientRect().width))));
    assert.ok(fit[0] <= fit[1] + 1, `the table fits: ${fit}`);
  }
  await page.waitForTimeout(300); // the tab's colour has settled
  await shot(page, `tracking-shoots-${name}`, { fullPage: true });
  // The filters.
  await page.selectOption('#sh-status', 'set');
  assert.deepEqual(await shIds(page), [AVI]);
  assert.equal(await text(page.locator('#sh-count')), 'לקוח אחד מתוך 5');
  assert.equal(await text(page.locator('#sh-foot')), 'אין כאן לקוחות שממתינים לקביעת יום צילום');
  await page.selectOption('#sh-status', '');
  await page.selectOption('#sh-type', 'monthly');
  assert.deepEqual(await shIds(page), [ELIOR]);
  await page.selectOption('#sh-type', '');
  await page.selectOption('#sh-month', '2026-06');
  assert.deepEqual(await shIds(page), [ROMA]);
  assert.equal(await text(page.locator('#sh-foot')), 'סה״כ: לקוח אחד שטרם נקבע לו יום צילום');
  await page.selectOption('#sh-month', '');
  // The search, typed key by key and deleted.
  const box = page.locator('#sh-q');
  await box.click();
  await box.pressSequentially('pizza', { delay: 40 });
  assert.equal(await box.inputValue(), 'pizza');
  assert.deepEqual(await shIds(page), [ROMA]);
  for (let i = 0; i < 5; i += 1) await box.press('Backspace');
  assert.equal(await box.inputValue(), '');
  assert.equal((await shIds(page)).length, 5);
  await box.pressSequentially('מוסך', { delay: 40 });
  assert.deepEqual(await shIds(page), [AVI]);
  await box.press('Backspace');
  assert.equal(await box.inputValue(), 'מוס');
  assert.deepEqual(await shIds(page), [AVI]);
  await box.pressSequentially('ז', { delay: 40 });
  assert.equal(await page.locator('#sh-body tr[data-id]').count(), 0);
  assert.equal(await text(page.locator('#sh-body')), 'אין לקוח שמתאים לסינון.');
  for (let i = 0; i < 4; i += 1) await box.press('Backspace');
  assert.equal(await box.inputValue(), '');
  assert.equal((await shIds(page)).length, 5);
  // The third tab: its own module.
  await page.locator('#tab-tasks').click();
  assert.ok(page.url().endsWith('#tasks'));
  await page.waitForFunction(() => document.getElementById('view-tasks').textContent.trim().length > 0);
  assert.equal(await page.locator('#view-shoots').isVisible(), false);
  await noOverflow(page);
  await page.waitForTimeout(300);
  await shot(page, `tracking-tasks-${name}`, { fullPage: true });
  // Back to the first tab with the keyboard (Home); then "ימי צילום" again.
  await page.locator('#tab-tasks').focus();
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#tab-videos').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#ct-view').isVisible(), true);
  assert.ok(!page.url().includes('#'));
  await page.locator('#tab-shoots').click();
  await page.waitForSelector('#sh-body tr[data-id]');
}

// ── Fixed by hand (10.11.2026) ──
const dlg = (page) => page.locator('#fx-dlg');
const fld = (page, id) => page.locator(`#fx-dlg #${id}`);
// Emptied with Backspace, key by key, then typed key by key.
async function retype(box, value) {
  await box.click();
  await box.press('End');
  const n = (await box.inputValue()).length;
  for (let i = 0; i < n; i += 1) await box.press('Backspace');
  assert.equal(await box.inputValue(), '');
  if (value) await box.pressSequentially(value, { delay: 40 });
  assert.equal(await box.inputValue(), value);
}
async function save(page) {
  await fld(page, 'fx-save').click();
  await dlg(page).waitFor({ state: 'hidden' });
  await settle(page);
}
const avi = (db) => db.clients.find((c) => c.id === AVI);
const dialogFits = async (page) => {
  const box = await dlg(page).boundingBox();
  const vw = await page.evaluate(() => window.innerWidth);
  assert.ok(box.x >= 0 && box.x + box.width <= vw + 1, 'the dialog fits the screen');
};

// Tab 1: "סרטונים נערכו" 12/42 → 15/40; the graphics refused above the package, then 10; both back to the count.
async function countFixes(page, db, name, { phone }) {
  await page.locator('#tab-videos').click();
  await page.locator(`#ct-${AVI} [data-fix="videos"]`).click();
  await dlg(page).waitFor({ state: 'visible' });
  assert.match(await text(page.locator('#fx-h')), /סרטונים נערכו · מוסך אבי/);
  assert.match(await text(page.locator('#fx-auto')), /12 \/ 42/);
  assert.equal(await fld(page, 'fx-a').inputValue(), '12');
  assert.equal(await fld(page, 'fx-b').inputValue(), '42');
  assert.equal(await fld(page, 'fx-reset').count(), 0, 'nothing fixed yet: no way back to show');
  await retype(fld(page, 'fx-a'), '15');
  await retype(fld(page, 'fx-b'), '400');
  await fld(page, 'fx-b').press('Backspace');
  assert.equal(await fld(page, 'fx-b').inputValue(), '40');
  await dialogFits(page);
  await shot(page, `tracking-fix-dialog-${name}`);
  await save(page);
  assert.match(await text(cell(page, AVI, 2)), /15 \/ 40/);
  assert.match(await text(cell(page, AVI, 2)), /עודכן ביד · עירית · 20\.10/);
  assert.equal(avi(db).deliverables.tracking.videos.done, 15);
  assert.equal(avi(db).deliverables.tracking.videos.of, 40);
  assert.equal(avi(db).deliverables.tracking.videos.by, 'irit');
  assert.equal(avi(db).deliverables.videos, 42, 'the package itself is not touched');
  assert.equal(avi(db).deliverables.ch14, 1, 'the rest of the deliverables kept');
  // The graphics: more than the package is refused; then 10.
  await page.locator(`#ct-${AVI} [data-fix="graphics"]`).click();
  await dlg(page).waitFor({ state: 'visible' });
  await retype(fld(page, 'fx-a'), '50');
  await fld(page, 'fx-save').click();
  assert.equal(await text(fld(page, 'fx-err')), 'אי אפשר יותר ממה שבחבילה.');
  assert.equal(await dlg(page).isVisible(), true);
  await retype(fld(page, 'fx-a'), '10');
  await save(page);
  assert.match(await text(cell(page, AVI, 3)), /10 \/ 42.*עודכן ביד · עירית/);
  await noOverflow(page);
  await page.locator(`#ct-${AVI}`).scrollIntoViewIfNeeded();
  await shot(page, `tracking-fixed-${name}`, { fullPage: !phone });
  // Back to the count: the fields emptied (videos), and the button (graphics).
  await page.locator(`#ct-${AVI} [data-fix="videos"]`).click();
  await dlg(page).waitFor({ state: 'visible' });
  assert.match(await text(page.locator('#fx-dlg .fx-by')), /עודכן ביד · עירית · 20\.10/);
  await retype(fld(page, 'fx-a'), '');
  await retype(fld(page, 'fx-b'), '');
  await save(page);
  assert.match(await text(cell(page, AVI, 2)), /12 \/ 42/);
  assert.equal(await cell(page, AVI, 2).locator('.ct-by').count(), 0);
  assert.equal(avi(db).deliverables.tracking.videos, undefined);
  await page.locator(`#ct-${AVI} [data-fix="graphics"]`).click();
  await dlg(page).waitFor({ state: 'visible' });
  await fld(page, 'fx-reset').click();
  await dlg(page).waitFor({ state: 'hidden' });
  await settle(page);
  assert.match(await text(cell(page, AVI, 3)), /9 \/ 42/);
  assert.equal(avi(db).deliverables.tracking, undefined, 'nothing fixed: the key itself is gone');
}

// Tab 2: מוסך אבי from 2 days (1 left, set for 5.11) to 3 days, 2 left, "ממתין לקביעה", every month.
async function shootFixes(page, db, name, { phone }) {
  await page.locator('#tab-shoots').click();
  await page.locator(`#sh-${AVI} .sh-total .ct-fix`).click();
  await dlg(page).waitFor({ state: 'visible' });
  assert.equal(await fld(page, 'fx-a').inputValue(), '2');
  assert.equal(await fld(page, 'fx-b').inputValue(), '1');
  await retype(fld(page, 'fx-a'), '3');
  await retype(fld(page, 'fx-b'), '2');
  await fld(page, 'fx-status').selectOption('waiting');
  await fld(page, 'fx-monthly').check();
  await dialogFits(page);
  await shot(page, `tracking-shoots-fix-dialog-${name}`);
  await save(page);
  assert.match(await text(shCell(page, AVI, 2)), /^3/);
  assert.match(await text(shCell(page, AVI, 3)), /^2/);
  assert.match(await text(shCell(page, AVI, 5)), /ממתין לקביעה/);
  assert.match(await text(shCell(page, AVI, 4)), /יום צילום כל חודש/);
  assert.match(await text(shCell(page, AVI, 0)), /עודכן ביד · עירית · 20\.10/);
  assert.deepEqual({ ...avi(db).deliverables.tracking.shoots, at: 'x' }, { agreed: 3, status: 'waiting', by: 'irit', at: 'x' }, 'held = 3 − 2 = the count: not kept');
  assert.equal(avi(db).deliverables.shoot_monthly, true);
  assert.deepEqual((await page.locator('#sh-stats .v').allInnerTexts()).map((t) => t.trim()), ['4', '0', '2', '2', '2'], 'now 3 days, waiting, every month');
  await noOverflow(page);
  await page.locator(`#sh-${AVI}`).scrollIntoViewIfNeeded();
  await shot(page, `tracking-shoots-fixed-${name}`, { fullPage: !phone });
  // Back: the count again, and not every month.
  await page.locator(`#sh-${AVI} .sh-fix-status`).click();
  await dlg(page).waitFor({ state: 'visible' });
  assert.equal(await fld(page, 'fx-status').inputValue(), 'waiting');
  await fld(page, 'fx-monthly').uncheck();
  await fld(page, 'fx-reset').click();
  await dlg(page).waitFor({ state: 'hidden' });
  await settle(page);
  assert.match(await text(shCell(page, AVI, 5)), /נקבע · 5\.11/);
  assert.equal(avi(db).deliverables.tracking, undefined);
  // "חזרה לספירה" takes the fix away only; the switch is set from the same dialog's "שמירה".
  assert.equal(avi(db).deliverables.shoot_monthly, true);
  await page.locator(`#sh-${AVI} .sh-total .ct-fix`).click();
  await dlg(page).waitFor({ state: 'visible' });
  await fld(page, 'fx-monthly').uncheck();
  await save(page);
  assert.equal(avi(db).deliverables.shoot_monthly, undefined);
  assert.equal(avi(db).deliverables.tracking, undefined);
}

// Tab 2: Channel 14 for מוסך אבי, the date and the time typed key by key (a wrong day first).
async function ch14(page, db, name, { phone }) {
  await page.locator('#tab-shoots').click();
  await page.locator(`#sh-${AVI} .sh-14-set`).click();
  await dlg(page).waitFor({ state: 'visible' });
  assert.match(await text(page.locator('#fx-h')), /ערוץ 14 · מוסך אבי/);
  const day = fld(page, 'fx-d0');
  const time = fld(page, 'fx-t0');
  await retype(day, '32.11');
  await retype(time, '1030');
  await fld(page, 'fx-save').click();
  assert.equal(await text(fld(page, 'fx-err')), 'אין תאריך כזה.');
  await day.press('End');
  for (let i = 0; i < 5; i += 1) await day.press('Backspace');
  await day.pressSequentially('25.111', { delay: 40 });
  await day.press('Backspace');
  assert.equal(await day.inputValue(), '25.11');
  await retype(time, '10:30');
  await dialogFits(page);
  await shot(page, `tracking-ch14-dialog-${name}`);
  await save(page);
  assert.match(await text(shCell(page, AVI, 6)), /נקבע · 25\.11/);
  assert.equal(await text(page.locator('#sh-stats .sh-stat-sub')), '1 נקבעו מתוך 2');
  const kept = avi(db).deliverables.ch14_dates;
  assert.equal(kept.length, 1);
  assert.equal(new Date(kept[0].at).toISOString(), '2026-11-25T08:30:00.000Z', '10:30 in Israel');
  assert.equal(kept[0].by, 'irit');
  // The filter.
  await page.selectOption('#sh-ch14', 'yes');
  assert.deepEqual((await shIds(page)).sort(), [AVI, LONG].sort());
  await page.selectOption('#sh-ch14', 'waiting');
  assert.deepEqual(await shIds(page), [LONG]);
  await page.locator('#sh-wrap').scrollIntoViewIfNeeded();
  await shot(page, `tracking-ch14-filter-${name}`, { fullPage: !phone });
  // Two items: one date each.
  await page.locator(`#sh-${LONG} .sh-14-set`).click();
  await dlg(page).waitFor({ state: 'visible' });
  assert.equal(await page.locator('#fx-dlg .fx-item').count(), 2);
  assert.equal(await fld(page, 'fx-d0').inputValue(), '12.11.2026');
  assert.equal(await fld(page, 'fx-t0').inputValue(), '10:00');
  assert.equal(await fld(page, 'fx-d1').inputValue(), '');
  await dialogFits(page);
  await shot(page, `tracking-ch14-two-${name}`);
  await page.locator('#fx-dlg .dlg-foot .btn-ghost').click();
  await dlg(page).waitFor({ state: 'hidden' });
  await page.selectOption('#sh-ch14', '');
  assert.equal((await shIds(page)).length, 5);
  // Taken away: the date emptied.
  await page.locator(`#sh-${AVI} .sh-14-set`).click();
  await dlg(page).waitFor({ state: 'visible' });
  await retype(fld(page, 'fx-d0'), '');
  await save(page);
  assert.match(await text(shCell(page, AVI, 6)), /ממתין לקביעה/);
  assert.equal(avi(db).deliverables.ch14_dates, undefined);
}

// Ilai: the first tab only; he fixes the graphics, nothing else.
async function ilai(engine, { device = null, width = 390, name }) {
  const db = office();
  const { page, ctx } = await signedIn(db, { person: 'ilai', device, width, engine });
  assert.equal(await page.locator('#ct-tabs').isVisible(), false, 'no tabs: the first one only');
  assert.equal(await page.locator('#view-shoots').isVisible(), false);
  const kinds = await page.locator('#ct .ct-fix').evaluateAll((els) => els.map((el) => el.dataset.fix));
  assert.equal(kinds.length, 5);
  assert.ok(kinds.every((k) => k === 'graphics'), 'graphics only');
  assert.equal(await page.locator('#ct .ct-ed-change').count(), 0);
  await page.locator(`#ct-${AVI} [data-fix="graphics"]`).click();
  await dlg(page).waitFor({ state: 'visible' });
  await retype(fld(page, 'fx-a'), '12');
  await save(page);
  assert.match(await text(cell(page, AVI, 3)), /12 \/ 42.*עודכן ביד · עילאי · 20\.10/);
  assert.equal(avi(db).deliverables.tracking.graphics.by, 'ilai');
  assert.ok(await page.locator('a[href="tracking.html"]').count() >= 1, 'in his menu');
  await noOverflow(page);
  await shot(page, `tracking-ilai-${name}`, { fullPage: true });
  await ctx.close();
}

// The open tab is kept: in the address (#shoots), and on this device for a plain visit.
async function remembered(engine) {
  const a = await signedIn(office(), { person: 'irit', width: 1366, engine, path: 'tracking.html#shoots', wait: '#sh-body tr[data-id]' });
  assert.equal(await a.page.locator('#tab-shoots').getAttribute('aria-selected'), 'true');
  assert.equal(await a.page.locator('#ct-view').isVisible(), false);
  await a.ctx.close();
  const fake = makeFlowFake(office());
  const ctx = await engine.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 1366, height: 900 } });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  await ctx.addInitScript(() => { try { localStorage.setItem('tracking-tab', 'tasks'); } catch { /* none */ } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}tracking.html`);
  await page.fill('#lg-email', emailOf('irit'));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForFunction(() => document.getElementById('view-tasks').textContent.trim().length > 0);
  assert.equal(await page.locator('#tab-tasks').getAttribute('aria-selected'), 'true');
  assert.ok(page.url().endsWith('#tasks'));
  await ctx.close();
}

// An editor who opens the address is refused, and (signed in on this page) taken to her own tasks.
async function noAccess(engine) {
  const { page, ctx } = await signedIn(office(), { person: 'nadia', width: 390, engine, wait: 'body' });
  await page.waitForURL(/clients\.html#mine/);
  await settle(page);
  assert.equal(await page.locator('#ct-body tr[data-id]').count(), 0);
  assert.equal(await page.locator('a[href="tracking.html"]').count(), 0, 'not in her menu');
  await ctx.close();
}

const engines = { chromium: await chromium.launch(), webkit: await webkit.launch() };
try {
  if (process.env.ONLY !== 'desktop') await step('Irit on an iPhone 13 (WebKit): the cards, the numbers, the dates, the search key by key', () => phone(engines.webkit, { device: devices['iPhone 13'], name: 'iphone13' }));
  if (process.env.ONLY !== 'desktop') await step('Irit on Chromium 390: the same', () => phone(engines.chromium, { width: 390, name: 'chromium390' }));
  await step('Irit at 1366: the table, five columns; the tab "ימי צילום"; its button opens the card', () => desktop(engines.chromium, { name: 'irit-1366' }));
  await step('Lior at 1366: he sees it too', () => desktop(engines.chromium, { person: 'lior', name: 'lior-1366' }));
  await step('Ilai on an iPhone 13 (WebKit): the first tab only, he fixes the graphics', () => ilai(engines.webkit, { device: devices['iPhone 13'], name: 'iphone13' }));
  await step('Ilai at 1366: the same', () => ilai(engines.chromium, { width: 1366, name: '1366' }));
  await step('the open tab is kept: #shoots in the address, the last tab on this device', () => remembered(engines.chromium));
  await step('Nadia (an editor): refused, back to her tasks, not in her menu', () => noAccess(engines.chromium));
  await step('no page errors and no CSP violations', () => { assert.deepEqual(errors, []); noCspViolations(); });
} finally {
  await engines.chromium.close();
  await engines.webkit.close();
}
console.log(`\n${passed} passed`);
