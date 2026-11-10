// "מעקב לקוחות", the tab "משימות לעורכים ולגרפיקאי" (app/tracking-tasks.js; Irit, 10.11.2026) in
// the browser, against the office of tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in Israel;
// invented names), with these tasks:
//   client card (client_tasks)   Ilai, "באנר לחג", due 18.10, with a brief, open
//                                Anna, "סרטון פתיחה", due 25.10, open
//                                Nadia, "תיקון כתוביות", done yesterday
//                                Lior, not an editor: not here
//   "משימות לעובדים" (staff_tasks) Yariv, no client of the list (its name as given), open, put in 15.10
//                                Nadia, Pizza Roma, open, put in 19.10
//                                Ilai, done 1.9 (more than 30 days ago): not here
//                                Nirel, cancelled: not here
//   1  Irit on an iPhone 13 (WebKit): cards in the order (by when put in, the newest first,
//      then the done one), the chips (גרפיקאי, הושלמו, back to הכל), no sideways scroll; "משימה חדשה"
//      with גרפיקאי: the form of "משימות לעובדים" for Ilai alone, the task typed key by key and
//      deleted with Backspace, the client searched key by key; sent: the database is asked, the row
//      is in the list;
//   2  the same on Chromium at 390;
//   3  Irit at 1366: the table, its seven columns, one line a row, the client opens its card;
//      "משימה חדשה" with עורכים offers the four editors only; "ביטול" closes it;
//   4  Lior at 1366: he sees it too.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: npx http-server -p 8471 -s -c-1 . &  then  BASE_URL=http://localhost:8471/ node tests/tracking-tasks-e2e.mjs
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
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

const DANA = cid(101);
const AVI = cid(102);
const ROMA = cid(103);
const uid = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  for (const t of ['protocol_checks', 'client_tasks', 'client_gantt', 'client_scripts']) db[t] = [];
  const client = (id, fields) => ({ ...base, id, editor: null, rounds: [], links: {}, landing: false, status: 'active', ...fields });
  db.clients = [
    client(DANA, { name: 'דנה כהן', business: 'קפה דנה', editor: 'nadia', deliverables: { videos: 36, graphics: 36, shoot_days: 1 } }),
    client(AVI, { name: 'אבי לוי', business: 'מוסך אבי', editor: 'nadia', deliverables: { videos: 42 } }),
    client(ROMA, { name: 'רומן', business: 'Pizza Roma', deliverables: { videos: 25 } }),
  ];
  const ct = (n, fields) => ({ id: uid(n), client_id: DANA, title: '', owner: 'ilai', due_on: null, done_at: null, done_by_email: null, created_by_email: emailOf('irit'),
    created_at: '2026-10-14T09:00:00+03:00', source: null, brief: null, urgent: false, started_at: null, result: null, ...fields });
  db.client_tasks = [
    ct(1, { title: 'באנר לחג', owner: 'ilai', due_on: '2026-10-18', created_at: '2026-10-12T09:00:00+03:00', brief: { problem: 'הלוגו קטן מדי', change: 'להגדיל' } }),
    ct(2, { title: 'סרטון פתיחה', owner: 'anna', client_id: AVI, due_on: '2026-10-25', created_at: '2026-10-16T09:00:00+03:00' }),
    ct(3, { title: 'תיקון כתוביות', owner: 'nadia', client_id: AVI, done_at: '2026-10-19T15:00:00+03:00', created_at: '2026-10-17T09:00:00+03:00' }),
    ct(4, { title: 'בדיקת קמפיין', owner: 'lior' }),
  ];
  const st = (n, fields) => ({ id: uid(100 + n), created_at: '2026-10-15T09:00:00+03:00', created_by: 'irit', created_by_email: emailOf('irit'), assignee: 'yariv', body: '',
    client_id: null, client_name: null, status: 'open', done_at: null, done_by_email: null, cancelled_at: null, brief: null, claimed_at: null, ...fields });
  db.staff_tasks = [
    st(1, { assignee: 'yariv', body: 'לסיים את הרילס של סטודיו נוגה', client_id: cid(999), client_name: 'סטודיו נוגה', created_at: '2026-10-15T09:00:00+03:00' }),
    st(2, { assignee: 'nadia', body: 'לשלוח לאופיר את הגרסה השנייה', client_id: ROMA, client_name: 'Pizza Roma', created_at: '2026-10-19T09:00:00+03:00' }),
    st(3, { assignee: 'ilai', body: 'ישנה', status: 'done', done_at: '2026-09-01T12:00:00+03:00', created_at: '2026-08-30T09:00:00+03:00' }),
    st(4, { assignee: 'nirel', body: 'בוטלה', status: 'cancelled', cancelled_at: '2026-10-18T12:00:00+03:00' }),
  ];
  return db;
}
// The tasks by name, and the order of the list: by when they were put in, the newest first (the owner, 10.11.2026).
const IDS = ['c-' + uid(1), 'c-' + uid(2), 's-' + uid(101), 's-' + uid(102), 'c-' + uid(3)];
const ORDER = [IDS[3], IDS[4], IDS[1], IDS[2], IDS[0]];

async function signedIn(db, { person, width = 390, device = null, engine }) {
  const fake = makeFlowFake(db);
  const sent = [];
  const ctx = device
    ? await engine.newContext({ ...device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })
    : await engine.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width, height: width < 600 ? 800 : 900 }, isMobile: width < 600, hasTouch: width < 600 });
  await ctx.clock.install({ time: NOW });
  // public.staff_task_create (the form of "משימות לעובדים"): the row the database writes.
  await ctx.route(`${SUPA}/**`, async (r) => {
    const req = r.request();
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/rest/v1/rpc/staff_task_create') {
      const body = JSON.parse(req.postData() || '{}');
      sent.push(body);
      const c = db.clients.find((x) => x.id === body.p_client);
      const id = uid(200 + sent.length);
      db.staff_tasks.push({ id, created_at: new Date(NOW.getTime() + 60e3).toISOString(), created_by: person, created_by_email: emailOf(person), assignee: body.p_assignee, body: body.p_body,
        client_id: c?.id || null, client_name: c ? c.business : null, status: 'open', done_at: null, done_by_email: null, cancelled_at: null, brief: null, claimed_at: null });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(id), headers: CORS });
    }
    // public.staff_task_done (whoever gave it); public.staff_task_reopen is not in the database yet
    // (its migration waits for the owner): PostgREST answers PGRST202.
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST' && path === '/rest/v1/rpc/staff_task_done') {
      const t = db.staff_tasks.find((x) => x.id === JSON.parse(req.postData() || '{}').p_id);
      Object.assign(t, { status: 'done', done_at: new Date(NOW.getTime() + 120e3).toISOString(), done_by_email: emailOf(person) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(t), headers: CORS });
    }
    if (req.method() === 'POST' && path === '/rest/v1/rpc/staff_task_reopen') {
      return r.fulfill({ status: 404, contentType: 'application/json', headers: CORS,
        body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.staff_task_reopen(p_id) in the schema cache' }) });
    }
    return fake.route(r);
  });
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${person}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${person}: ${msg.text()}`); });
  await page.goto(`${BASE}tracking.html#tasks`);
  await page.fill('#lg-email', emailOf(person));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#tt-body tr[data-id]');
  await settle(page);
  if (SHOTS) await page.waitForTimeout(900);
  return { page, ctx, sent };
}
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page scrolls sideways');
const rowIds = (page) => page.locator('#tt-body tr[data-id]').evaluateAll((trs) => trs.map((tr) => tr.dataset.id));
const row = (page, id) => page.locator(`#tt-body tr[data-id="${id}"]`);
const chip = (page, key, v) => page.locator(`[data-tt="${key}"][data-v="${v}"]`);

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); if (errors.length) console.log(errors.join('\n')); throw e; }
}

// What every width shows.
async function list(page) {
  assert.deepEqual(await rowIds(page), ORDER);
  assert.equal(await text(page.locator('#tt-count')), '5 משימות');
  const ilai = row(page, IDS[0]);
  assert.match(await text(ilai), /קפה דנה/);
  assert.match(await text(ilai), /גרפיקה/);
  assert.match(await text(ilai), /באנר לחג/);
  assert.match(await text(ilai), /הלוגו קטן מדי/, 'the brief under the task');
  assert.match(await text(ilai), /12\.10/, 'put in');
  assert.match(await text(ilai), /18\.10/, 'due');
  assert.match(await text(ilai), /עילאי/);
  assert.match(await text(ilai), /בתהליך/);
  assert.doesNotMatch(await text(ilai), /באיחור|דחוף/, 'two states only');
  assert.equal(await ilai.locator('a.mt-name').getAttribute('href'), `client.html?id=${DANA}`);
  const yariv = row(page, IDS[2]);
  assert.match(await text(yariv), /סטודיו נוגה/, 'the client as named when given');
  assert.equal(await yariv.locator('a').count(), 0, 'no card to open');
  assert.match(await text(yariv), /עריכה/);
  assert.match(await text(yariv), /יריב/);
  assert.match(await text(row(page, IDS[4])), /הושלם/);
  assert.match(await text(row(page, IDS[4])), /נדיה/);
  assert.equal(await page.locator('#tt-body').getByText('בדיקת קמפיין').count(), 0, 'Lior is not an editor');
  assert.equal(await page.locator('#tt-body').getByText('בוטלה').count(), 0);
  assert.equal(await page.locator('#tt-body').getByText('ישנה').count(), 0);
}

async function chips(page) {
  await chip(page, 'kind', 'graphic').click();
  assert.equal(await chip(page, 'kind', 'graphic').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await rowIds(page), [IDS[0]]);
  assert.equal(await text(page.locator('#tt-count')), 'משימה אחת מתוך 5');
  await chip(page, 'kind', 'edit').click();
  assert.deepEqual(await rowIds(page), ORDER.slice(0, 4));
  await chip(page, 'status', 'done').click();
  assert.deepEqual(await rowIds(page), [IDS[4]]);
  await chip(page, 'kind', 'graphic').click();
  assert.equal(await page.locator('#tt-body tr[data-id]').count(), 0);
  assert.equal(await text(page.locator('#tt-body')), 'אין משימות בסינון הזה.');
  await chip(page, 'status', 'open').click();
  assert.deepEqual(await rowIds(page), [IDS[0]]);
  await chip(page, 'status', 'all').click();
  await chip(page, 'kind', 'all').click();
  assert.deepEqual(await rowIds(page), ORDER);
  assert.match(await text(chip(page, 'kind', 'edit')), /עורכים 4/);
  assert.match(await text(chip(page, 'status', 'open')), /פתוחות 4/);
}

// "משימה חדשה" with גרפיקאי: the form for Ilai alone; typed key by key and deleted; the client searched.
async function newTask(page, sent, name) {
  await chip(page, 'kind', 'graphic').click();
  await page.locator('#tt-new').click();
  const dlg = page.locator('#tt-dlg');
  await dlg.waitFor({ state: 'visible' });
  assert.deepEqual(await dlg.locator('#st-assignee option').allInnerTexts(), ['בחירת עובד/ת', 'עילאי']);
  assert.equal(await dlg.locator('#st-assignee').inputValue(), 'ilai');
  const body = dlg.locator('#st-body');
  await body.click();
  await body.pressSequentially('פוסט חדש', { delay: 30 });
  assert.equal(await body.inputValue(), 'פוסט חדש');
  for (let i = 0; i < 3; i += 1) await body.press('Backspace');
  assert.equal(await body.inputValue(), 'פוסט ');
  await body.pressSequentially('לסטורי', { delay: 30 });
  assert.equal(await body.inputValue(), 'פוסט לסטורי');
  assert.equal(await text(dlg.locator('#st-count')), '11/500');
  const q = dlg.locator('#st-client-q');
  await q.click();
  await q.pressSequentially('pizza', { delay: 30 });
  assert.equal(await q.inputValue(), 'pizza');
  assert.equal(await dlg.locator('#st-client').inputValue(), ROMA, 'one match: chosen');
  await q.press('Backspace');
  assert.equal(await q.inputValue(), 'pizz');
  assert.equal(await dlg.locator('#st-client').inputValue(), ROMA);
  for (let i = 0; i < 4; i += 1) await q.press('Backspace');
  assert.equal(await q.inputValue(), '');
  await q.pressSequentially('דנה', { delay: 30 });
  assert.equal(await dlg.locator('#st-client').inputValue(), DANA);
  await noOverflow(page);
  await shot(page, `tracking-tasks-new-${name}`);
  await dlg.locator('#st-send').click();
  await dlg.waitFor({ state: 'hidden' });
  assert.deepEqual(sent, [{ p_assignee: 'ilai', p_body: 'פוסט לסטורי', p_client: DANA }]);
  await page.locator('#tt-body').getByText('פוסט לסטורי').waitFor();
  const ids = await rowIds(page);
  assert.equal(ids.length, 2, 'Ilai: the two open ones');
  // The new one is the newest: first (the owner, 10.11.2026).
  assert.match(await text(row(page, ids[0])), /פוסט לסטורי.*עילאי.*בתהליך/);
  await chip(page, 'kind', 'all').click();
}

// Fixed by hand (10.11.2026): the status toggled both ways, the due day typed key by key.
const toastHas = (page, s) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), s);
const ct = (db, n) => db.client_tasks.find((t) => t.id === uid(n));
async function fixes(page, db, name) {
  // A card's task: בתהליך → הושלם → בתהליך.
  const banner = row(page, IDS[0]);
  assert.match(await text(banner.locator('.tt-toggle')), /בתהליך/);
  await banner.locator('.tt-toggle').click();
  await toastHas(page, 'סומן ״הושלם״');
  await page.waitForFunction((id) => document.querySelector(`#tt-body tr[data-id="${id}"]`)?.dataset.state === 'done', IDS[0]);
  assert.ok(ct(db, 1).done_at, 'done in the database');
  assert.match(await text(row(page, IDS[0]).locator('.tt-s')), /הושלם/);
  await row(page, IDS[0]).locator('.tt-toggle').click();
  await toastHas(page, 'הוחזר ל״בתהליך״');
  await page.waitForFunction((id) => document.querySelector(`#tt-body tr[data-id="${id}"]`)?.dataset.state === 'open', IDS[0]);
  assert.equal(ct(db, 1).done_at, null);
  // A task of "משימות לעובדים": done after a confirm; back is not there until its migration.
  page.once('dialog', (d) => d.accept());
  await row(page, IDS[2]).locator('.tt-toggle').click();
  await toastHas(page, 'סומן ״הושלם״');
  await page.waitForFunction((id) => document.querySelector(`#tt-body tr[data-id="${id}"]`)?.dataset.state === 'done', IDS[2]);
  assert.equal(db.staff_tasks.find((t) => t.id === uid(101)).status, 'done');
  await row(page, IDS[2]).locator('.tt-toggle').click();
  await toastHas(page, 'staff_task_reopen');
  assert.equal(await row(page, IDS[2]).getAttribute('data-state'), 'done', 'stays done');
  // The due day of a card's task: 25.10 → 27.10, typed key by key; a staff task has none to change.
  assert.equal(await row(page, IDS[2]).locator('.tt-due-fix').count(), 0);
  const due = row(page, IDS[1]).locator('.tt-due-fix');
  assert.match(await text(due), /25\.10/);
  await due.click();
  const dlg = page.locator('#fx-dlg');
  await dlg.waitFor({ state: 'visible' });
  const box = dlg.locator('#fx-due');
  assert.equal(await box.inputValue(), '25.10.2026');
  await box.click();
  await box.press('End');
  for (let i = 0; i < 10; i += 1) await box.press('Backspace');
  assert.equal(await box.inputValue(), '');
  await box.pressSequentially('27.100', { delay: 40 });
  await box.press('Backspace');
  assert.equal(await box.inputValue(), '27.10');
  await noOverflow(page);
  await shot(page, `tracking-tasks-due-dialog-${name}`);
  await dlg.locator('#fx-save').click();
  await dlg.waitFor({ state: 'hidden' });
  await toastHas(page, 'תאריך היעד עודכן');
  assert.equal(ct(db, 2).due_on, '2026-10-27');
  await page.waitForFunction((id) => /27\.10/.test(document.querySelector(`#tt-body tr[data-id="${id}"] .tt-due`)?.textContent || ''), IDS[1]);
  await noOverflow(page);
  await page.locator('#view-tasks').scrollIntoViewIfNeeded();
  await shot(page, `tracking-tasks-fixed-${name}`, { fullPage: true });
}

async function phone(engine, { device = null, width = 390, name }) {
  const db = office();
  const { page, ctx, sent } = await signedIn(db, { person: 'irit', device, width, engine });
  await list(page);
  // Cards: the header row out of sight, every card within the screen.
  assert.equal(await page.locator('.tt thead').evaluate((el) => el.getBoundingClientRect().height <= 1), true);
  const vw = await page.evaluate(() => window.innerWidth);
  for (const id of ORDER) assert.ok((await row(page, id).boundingBox()).width <= vw, 'the card fits');
  assert.ok((await chip(page, 'kind', 'edit').boundingBox()).height >= 40, 'a chip big enough to tap');
  assert.ok((await page.locator('#tt-new').boundingBox()).height >= 44);
  await noOverflow(page);
  await page.locator('#view-tasks').scrollIntoViewIfNeeded();
  await shot(page, `tracking-tasks-${name}`, { fullPage: true });
  await chips(page);
  await newTask(page, sent, name);
  await fixes(page, db, name);
  await noOverflow(page);
  await ctx.close();
}

async function desktop(engine, { person = 'irit', width = 1366, name }) {
  const db = office();
  const { page, ctx, sent } = await signedIn(db, { person, width, engine });
  await list(page);
  assert.deepEqual((await page.locator('.tt thead th').allInnerTexts()).map((t) => t.trim()), ['לקוח', 'סוג', 'תיאור המשימה', 'תאריך הכנסה', 'תאריך יעד', 'אחראי/ת', 'סטטוס']);
  for (const id of ORDER) {
    const tops = await row(page, id).locator('td').evaluateAll((tds) => tds.map((td) => Math.round(td.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size, 1, 'one row');
  }
  await noOverflow(page);
  await page.locator('#view-tasks').scrollIntoViewIfNeeded();
  await shot(page, `tracking-tasks-${name}`, { fullPage: true });
  // עורכים: the form offers the four editors; "ביטול" puts it away and nothing is sent.
  await chip(page, 'kind', 'edit').click();
  await page.locator('#tt-new').click();
  const dlg = page.locator('#tt-dlg');
  await dlg.waitFor({ state: 'visible' });
  assert.deepEqual(await dlg.locator('#st-assignee option').allInnerTexts(), ['בחירת עובד/ת', 'ניראל', 'נדיה', 'יריב', 'אנה']);
  assert.equal(await dlg.locator('#st-assignee').inputValue(), '');
  await shot(page, `tracking-tasks-new-${name}`);
  await dlg.getByRole('button', { name: 'ביטול' }).click();
  await dlg.waitFor({ state: 'hidden' });
  assert.deepEqual(sent, []);
  await chip(page, 'kind', 'all').click();
  if (person === 'lior') {
    assert.equal(await page.locator('.tt-toggle, .tt-due-fix').count(), 0, 'Lior reads: nothing to tap');
  } else {
    await fixes(page, db, name);
  }
  await row(page, IDS[0]).locator('a.mt-name').click();
  await page.waitForURL(/client\.html\?id=/);
  await ctx.close();
}

const engines = { chromium: await chromium.launch(), webkit: await webkit.launch() };
try {
  if (process.env.ONLY !== 'chromium') await step('Irit on an iPhone 13 (WebKit): cards, order, chips, a new task typed key by key', () => phone(engines.webkit, { device: devices['iPhone 13'], name: 'iphone13' }));
  await step('Irit on Chromium 390: the same', () => phone(engines.chromium, { width: 390, name: 'chromium390' }));
  await step('Irit at 1366: the table, seven columns, the editors in the form, a client opens its card', () => desktop(engines.chromium, { name: 'irit-1366' }));
  await step('Lior at 1366: he sees it too', () => desktop(engines.chromium, { person: 'lior', name: 'lior-1366' }));
  await step('no page errors and no CSP violations', () => { assert.deepEqual(errors, []); noCspViolations(); });
} finally {
  await engines.chromium.close();
  await engines.webkit.close();
}
console.log(`\n${passed} passed`);
