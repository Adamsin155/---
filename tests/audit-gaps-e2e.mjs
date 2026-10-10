// Protocol version 10 in the browser (docs/ops.md, section 58), each role signed in as itself, on a
// phone (390px) and on a desktop (1280px), against the office of tests/flow-world.mjs (Tuesday
// 20.10.2026, 10:00 in Israel; invented names). Every new screen and dialog:
//   1  Irit: "הלקוח ביקש תיקון" next to an approval that waits for the client; the dialog asks what the
//      client asked; the task opens for Ilai, and her card reads "הלקוח ביקש תיקונים: לברר ולתעד";
//   2  Ofir is in a characterization meeting when graphics arrive: his clock says "ממתין לסוף פגישת
//      האפיון", nothing is red, and Ilai's card says where the graphics are;
//   3  Lior: a contract that ended today, with "נרשם חידוש" (the dialog of the new end date) and
//      "סיום התקשרות" (the status process 35 needs);
//   4  Lior: after the Zoom, "נשארו תיקונים" opens the item with its own deadline;
//   5  the shoot day: the raw material and the take per script, for Lior and for Eli (two short fields
//      a row, saved by themselves, each seeing the other's rows), and Eli's "קראתי את התסריטים";
//   6  the editor: the five critical mistakes in "מוכן לבדיקה", and the files of the shoot day to read;
//   7  Ofir's quality control: eleven checks, and a critical mistake that fails is one tap in the return;
//   8  Ilai: the final check as one card, "סימון הכול", then "העבודה שלי על הלקוח הושלמה";
//   9  Irit: a "נודניק" for Nirel asks for the four fields of her brief.
// Nothing may leave the screen sideways, and every tappable thing is at least 44px on the phone.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/audit-gaps-e2e.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { importKeys } from '../app/client-open.js';
import { PROCESSES, CRITICAL_MISTAKES, FINAL_CHECK } from '../app/protocol.js';
import { filesOf } from '../app/production.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const SIZES = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 900 } };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
// A picture for the eye (SHOTS=1): what it is about is brought to the middle of the screen, and
// the welcome that fades after the sign-in is over.
const shot = async (target, name, loc = null) => {
  if (!SHOTS) return;
  if (loc) await loc.first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
  await target.waitForTimeout(1800);
  await target.screenshot({ path: `${OUT}v10-${name}.png` });
};
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const at = (hhmm, day = 20) => `2026-10-${String(day).padStart(2, '0')}T${hhmm}:00+03:00`;
const [FIX, MEET, GFX, END, END2, ZOOM, SHOOT, READ, EDIT, QA, FINAL] = [71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81].map(cid);
const itemsOf = (...ids) => PROCESSES.filter((p) => ids.includes(p.id)).flatMap((p) => p.items.filter((i) => !i.optional).map((i) => i.key));
const FIVE22 = CRITICAL_MISTAKES.map(([k]) => `p22.self.${k}`);
const FIVE25 = CRITICAL_MISTAKES.map(([k]) => `p25.q.${k}`);

function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  for (const t of ['protocol_checks', 'client_tasks', 'deal_requests', 'client_gantt', 'client_scripts', 'client_access_links', 'client_status_links', 'client_status_views', 'client_approvals', 'client_surveys', 'client_consents', 'client_files', 'staff_tasks']) db[t] = [];
  const mk = (id, fields) => ({
    ...base, id, editor: null, rounds: [], links: {}, landing: false, landed_at: null, landed_by: null, landing_slot: null, protocol_version: 10,
    shoot_type: 'dms', characterizer: 'ofir', has_logo: true, shoot_at: null, contract_end: '2027-10-11', created_by_email: emailOf('irit'), deliverables: { videos: 6, graphics: 20, shoot_days: 1 }, ...fields,
  });
  const mark = (id, keys, when, note = null, by = 'irit', state = 'done') => { for (const k of [].concat(keys)) db.protocol_checks.push({ client_id: id, item_key: k, state, note, by_email: emailOf(by), at: when }); };
  const imported = (id, station, keep = () => true) => mark(id, importKeys(station).filter(keep), '2026-10-01T09:00:00+03:00', 'ייבוא');
  const clients = [];
  const add = (id, fields) => { const c = mk(id, fields); clients.push(c); return c; };
  // FIX: the first 9 graphics were sent to the client yesterday; Irit called; no answer yet.
  add(FIX, { name: 'דנה לוי', business: 'קפה דנה', char_at: at('10:00', 15), deal_at: at('09:00', 12) });
  imported(FIX, 'char');
  mark(FIX, itemsOf('p04', 'p05', 'p05b', 'p06', 'p08', 'p08b', 'p09', 'p10', 'p11', 'p12a', 'p12'), at('12:30', 15), null, 'ofir');
  mark(FIX, [...itemsOf('p07').filter((k) => k !== 'p07.approved'), 'p07.call', 'p07a.sent'], at('12:00', 19));
  // MEET: Ofir characterizes this client today from 09:30 (he has not pressed "האפיון הסתיים").
  add(MEET, { name: 'אורי בן דוד', business: 'בן דוד שיפוצים', char_at: at('09:30'), deal_at: at('09:00', 18) });
  imported(MEET, 'char');
  // GFX: the meeting was yesterday; Ilai handed the 9 graphics over at 09:57, while Ofir is in that meeting.
  add(GFX, { name: 'גל אשכנזי', business: 'סטודיו גל', char_at: at('10:00', 19), deal_at: at('09:00', 15), shoot_at: '2026-11-03T10:00:00+02:00' });
  imported(GFX, 'char');
  mark(GFX, itemsOf('p04', 'p05', 'p05b', 'p06', 'p08', 'p08b', 'p09', 'p10', 'p11', 'p12a', 'p12'), at('12:30', 19), null, 'ofir');
  mark(GFX, 'p07.made', at('09:57'), null, 'ilai');
  // END, END2: the contract ends today, the renewal talk (34) was done, and the client is still "active".
  for (const [id, name, business] of [[END, 'רון מזרחי', 'מזרחי רהיטים'], [END2, 'תמר שגיא', 'שגיא אופטיקה']]) {
    add(id, { name, business, contract_end: '2026-10-20', char_at: '2025-10-25T10:00:00+03:00', shoot_at: '2025-11-05T10:00:00+02:00', deal_at: '2025-10-20T09:00:00+03:00', editor: 'anna' });
    imported(id, 'renewal');
    mark(id, itemsOf('p34'), at('10:00', 6), null, 'lior');
    mark(id, 'p31.call', at('11:00', 14), 'שיחה שבועית', 'lior');
  }
  // ZOOM: the Zoom took place this morning; the client has not approved yet.
  add(ZOOM, { name: 'שי כהן', business: 'מאפיית שי', char_at: at('10:00', 14), deal_at: at('09:00', 12), shoot_at: '2026-11-04T10:00:00+02:00' });
  imported(ZOOM, 'content');
  mark(ZOOM, itemsOf('p12a', 'p12'), at('15:00', 15), null, 'lior');
  mark(ZOOM, 'p13.zoom', at('09:30'), null, 'lior');
  // SHOOT: the shoot day is today, from 09:00; Eli arrived, and two videos were shot.
  add(SHOOT, { name: 'נועם פרץ', business: 'פרץ נדל״ן', char_at: at('10:00', 5), deal_at: at('09:00', 1), shoot_at: at('09:00'), address: 'הנביאים 5, חיפה' });
  imported(SHOOT, 'shoot');
  mark(SHOOT, itemsOf('p15', 'p16'), at('17:30', 19), null, 'lior');
  mark(SHOOT, 'p16.brief', at('17:20', 19), JSON.stringify({ label: 'כונן 3', notes: '' }), 'lior');
  mark(SHOOT, ['p17b.arrived', 'p17b.drive'], at('08:05'), null, 'eli');
  mark(SHOOT, 'p18.shot', at('09:40'), JSON.stringify({ videos: [1, 2] }), 'lior');
  // READ: a shoot day tomorrow; Lior sent the briefing, and Eli has not read the scripts yet.
  add(READ, { name: 'מיכל דיין', business: 'דיין פרחים', char_at: at('10:00', 8), deal_at: at('09:00', 6), shoot_at: at('11:00', 21), address: 'רחוב הים 3, נתניה' });
  imported(READ, 'shoot');
  mark(READ, 'p16.brief', at('09:10'), JSON.stringify({ label: 'כונן 2', notes: 'להביא תאורה נוספת' }), 'lior');
  // EDIT: Nadia got the drive yesterday and is editing; the shoot day's files were written next to the scripts.
  add(EDIT, { name: 'עדי נוי', business: 'נוי מסגרות', editor: 'nadia', char_at: at('10:00', 1), deal_at: '2026-09-27T09:00:00+03:00', shoot_at: at('10:00', 15), links: { drive: 'https://drive.google.com/drive/folders/noy' } });
  imported(EDIT, 'post', (k) => !/^p(22|23|23b|24|25|26|27)\./.test(k));
  mark(EDIT, itemsOf('p23', 'p23b'), at('12:00', 16), 'ייבוא');
  mark(EDIT, itemsOf('p22a'), at('11:00', 18), null, 'ofir');
  mark(EDIT, ['p22.received', 'p22.check.footage', 'p22.check.scripts', 'p22.check.logo', 'p22.check.phone', 'p24.folder'], at('12:00', 18), null, 'nadia');
  mark(EDIT, 'p18b.files', at('14:00', 15), JSON.stringify({ v: 1, f: { 1: ['0123', '2'], 2: ['0131', ''], 4: ['', '3'] } }), 'eli');
  // QA: Yariv marked "מוכן לבדיקה" twenty minutes ago; the videos wait for Ofir's quality control.
  add(QA, { name: 'אבנר גולן', business: 'גולן מזגנים', editor: 'yariv', char_at: at('10:00', 1), deal_at: '2026-09-27T09:00:00+03:00', shoot_at: at('10:00', 12), links: { drive: 'https://drive.google.com/drive/folders/golan' } });
  imported(QA, 'post', (k) => !/^p(22|23|23b|24|25|26|27)\./.test(k));
  mark(QA, itemsOf('p23', 'p23b'), at('12:00', 13), 'ייבוא');
  mark(QA, itemsOf('p22a'), at('11:00', 13), null, 'ofir');
  mark(QA, [...itemsOf('p22'), 'p24.folder', 'p24.drive'], at('09:30'), null, 'yariv');
  mark(QA, 'p24.notify', at('09:40'), 'מוכן לבדיקה', 'yariv');
  // FINAL: the Gantt is full, and Irit sent it to the client half an hour ago.
  add(FINAL, { name: 'רותי אלון', business: 'אלון צמחים', editor: 'anna', char_at: at('10:00', 1), deal_at: '2026-09-27T09:00:00+03:00', shoot_at: at('10:00', 8) });
  imported(FINAL, 'publish');
  mark(FINAL, itemsOf('p28'), at('09:00'), null, 'ilai');
  mark(FINAL, 'p29.filled', at('09:10'), null, 'ilai');
  mark(FINAL, 'p29.sent', at('09:30'));
  mark(FINAL, itemsOf('p30'), at('12:00', 19), 'ייבוא');
  db.client_gantt = [{ id: randomUUID(), client_id: FINAL, kind: 'video', state: 'scheduled', day: '2026-10-25', n: 1 }];
  db.clients = clients;
  return db;
}

// The few answers of the server this suite needs beyond the shared fake: Ofir's meetings (times only,
// for whoever does not see his clients) and a task on the spot with a brief.
function withServer(db, fake) {
  const route = async (r) => {
    const req = r.request();
    const p = new URL(req.url()).pathname;
    const json = (status, data) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: CORS });
    if (req.method() === 'OPTIONS') return fake.route(r);
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    if (p === '/rest/v1/rpc/ofir_meetings') {
      return json(200, db.clients.filter((c) => c.char_at && (c.characterizer || 'ofir') === 'ofir').map((c) => {
        const ended = db.protocol_checks.find((k) => k.client_id === c.id && ['p04.ended', 'p04.saved'].includes(k.item_key) && k.state === 'done' && k.at > c.char_at);
        return { starts_at: c.char_at, ends_at: ended ? ended.at : new Date(new Date(c.char_at).getTime() + 2 * 36e5).toISOString() };
      }));
    }
    if (p === '/rest/v1/rpc/staff_task_create_brief' || p === '/rest/v1/rpc/staff_task_create') {
      const need = ['problem', 'change', 'keep', 'result'];
      if (body.p_assignee === 'nirel' && need.some((k) => !String(body.p_brief?.[k] || '').trim())) return json(400, { code: '22023', message: 'a task for Nirel needs the full brief' });
      const row = { id: randomUUID(), created_at: NOW.toISOString(), created_by: 'irit', assignee: body.p_assignee, body: body.p_body, client_id: body.p_client || null, client_name: null, status: 'open', done_at: null, cancelled_at: null, brief: body.p_brief || null };
      db.staff_tasks.push(row);
      return json(200, row.id);
    }
    return fake.route(r);
  };
  return { ...fake, route };
}

async function signedIn(role, db, { path = 'clients.html#mine', width = 390, wait = null } = {}) {
  const fake = withServer(db, makeFlowFake(db));
  const phone = width < 600;
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: SIZES[width], isMobile: phone, hasTouch: phone });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  if (path.includes('#mine')) await page.waitForSelector('#view-mine:not([hidden])');
  if (wait) await page.waitForSelector(wait);
  await settle(page);
  return { page, ctx, db };
}
const card = (page, id, proc) => page.locator(`#mine-list .wproc[data-key="${id}:${proc}"]`);
const checkOf = (db, id, key) => db.protocol_checks.find((r) => r.client_id === id && r.item_key === key) || null;
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page scrolls sideways');
const inside = async (page, loc, what = '') => { const b = await loc.boundingBox(); const w = await page.evaluate(() => window.innerWidth); assert.ok(b && b.x >= 0 && b.x + b.width <= w + 1, `outside the screen ${what}: ${JSON.stringify(b)}`); };
const tall = async (loc, what) => { const b = await loc.boundingBox(); assert.ok(b && b.height >= 44, `${what}: ${b?.height}px high, less than 44`); };
// An open dialog stays inside the screen, and so does everything in it.
async function dialogFits(page, sel) {
  const d = page.locator(`${sel}[open]`);
  await inside(page, d, sel);
  const over = await d.evaluate((el) => [...el.querySelectorAll('input, textarea, select, button, label, p, h2, h3, legend')].filter((x) => x.getClientRects().length).map((x) => { const r = x.getBoundingClientRect(); const o = el.getBoundingClientRect(); return r.left < o.left - 1 || r.right > o.right + 1 ? `${x.tagName}#${x.id}` : null; }).filter(Boolean));
  assert.deepEqual(over, [], `${sel}: outside the dialog`);
}

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}
// A step at both widths, each on its own fresh office.
const both = (name, fn) => step(name, async () => { for (const width of [390, 1280]) await fn(width, office()); });

try {
  await both('1. Irit: "הלקוח ביקש תיקון" opens the same fix task for Ilai, and her card says what there is to do', async (width, db) => {
    const { page, ctx } = await signedIn('irit', db, { width });
    const c = card(page, FIX, 'p07');
    await c.waitFor();
    assert.match(await text(c), /הלקוח אישר את הגרפיקות/);
    const ask = c.locator('.fix-ask');
    assert.equal(await text(ask), 'הלקוח ביקש תיקון');
    if (width === 390) await tall(ask, 'the action');
    await inside(page, ask, 'the action');
    await shot(page, `1-irit-card-${width}`, c);
    await ask.click();
    await page.waitForSelector('#dlg-fix[open]');
    assert.equal(await text(page.locator('#fix-ctx')), 'קפה דנה · דנה לוי · 9 הגרפיקות הראשונות');
    assert.match(await text(page.locator('#fix-hint')), /אותה משימת תיקון כמו בקשה שהלקוח כותב בדף הסטטוס.*עד 13:00 מתוקנת באותו יום/);
    await dialogFits(page, '#dlg-fix');
    // What the client asked is required.
    await page.click('#fix-submit');
    assert.equal(await text(page.locator('#fix-err')), 'כותבים מה הלקוח ביקש לתקן.');
    assert.equal(db.client_tasks.length, 0);
    await page.fill('#fix-note', 'להחליף את הטלפון בגרפיקה 4');
    await shot(page, `1-irit-dialog-${width}`);
    await page.click('#fix-submit');
    await page.waitForSelector('#dlg-fix:not([open])', { state: 'attached' });
    await settle(page);
    // The task: Ilai's, from the office, due today (it is 10:00, before 13:00).
    assert.equal(db.client_tasks.length, 1);
    const t = db.client_tasks[0];
    assert.deepEqual([t.owner, t.source, t.due_on, t.brief.from, t.brief.by, t.brief.item_key, t.brief.problem], ['ilai', 'client_fix', '2026-10-20', 'office', 'irit', 'p07.approved', 'להחליף את הטלפון בגרפיקה 4']);
    // Her card now says what there is to do, with what the client asked; the action is gone (a fix is under way).
    assert.match(await text(c), /הלקוח ביקש תיקונים: לברר ולתעד/);
    assert.match(await text(c.locator('.fix-note')), /הלקוח ביקש: ״להחליף את הטלפון בגרפיקה 4״\. עילאי מתקן\/ת\./);
    assert.equal(await c.locator('.fix-ask').count(), 0);
    await noOverflow(page);
    await shot(page, `1-irit-after-${width}`, c);
    await ctx.close();
    // Ilai: the task is on his list.
    const ilai = await signedIn('ilai', db, { width });
    assert.match(await text(ilai.page.locator('#mine-list')), /תיקון לבקשת הלקוח: 9 הגרפיקות הראשונות · סבב 1/);
    await ilai.ctx.close();
  });

  await both('2. Ofir is in a characterization meeting when graphics arrive: the clock waits, nothing is red; Ilai sees where they are', async (width, db) => {
    const { page, ctx } = await signedIn('ofir', db, { width });
    const row = page.locator('#now-bar .now-clock.k-fast').first();
    await row.waitFor();
    assert.match(await text(row.locator('.now-state')), /^ממתין לסוף פגישת האפיון$/);
    assert.equal(await text(row.locator('.now-left')), '10:00', 'the ten minutes he will have when the meeting ends');
    assert.equal(await row.getAttribute('data-state'), 'running');
    assert.ok((await row.getAttribute('class')).includes('is-paused'));
    await inside(page, row, 'the clock');
    const c = card(page, GFX, 'p07');
    assert.equal(await text(c.locator('.wc-when')), 'ממתין לסוף פגישת האפיון');
    assert.ok(!(await c.getAttribute('class')).includes('s-overdue'));
    assert.equal(await page.locator('#tab-late:not([hidden])').count(), 0, 'no "באיחור" tab for it');
    await noOverflow(page);
    await shot(page, `2-ofir-meeting-${width}`, row);
    await ctx.close();
    const ilai = await signedIn('ilai', db, { width });
    await ilai.page.waitForSelector('.il-with-ofir');
    assert.equal(await text(ilai.page.locator('.il-with-ofir').first()), 'אצל אופיר לבדיקה · אופיר בפגישת אפיון');
    await shot(ilai.page, `2-ilai-waits-${width}`, ilai.page.locator('.il-with-ofir'));
    await ilai.ctx.close();
    // He presses "האפיון הסתיים" at 09:58: the ten minutes run from then (eight are left at 10:00).
    db.protocol_checks.push({ client_id: MEET, item_key: 'p04.ended', state: 'done', note: null, by_email: emailOf('ofir'), at: at('09:58') });
    const after = await signedIn('ofir', db, { width });
    const r2 = after.page.locator('#now-bar .now-clock.k-fast').first();
    await r2.waitFor();
    assert.equal(await text(r2.locator('.now-state')), 'נשארו');
    assert.match(await text(r2.locator('.now-left')), /^[78]:\d\d$/);
    await after.ctx.close();
  });

  await both('3. Lior: a contract that ended today, with "נרשם חידוש" and "סיום התקשרות"; nothing changes until he chooses', async (width, db) => {
    const { page, ctx } = await signedIn('lior', db, { width });
    const c = page.locator(`#mine-list .contract-end[data-contract="${END}"]`);
    await c.waitFor();
    assert.match(await text(c), /מזרחי רהיטים · רון מזרחי.*היום.*החוזה הסתיים היום: חידוש או סיום התקשרות\?/);
    const [renew, end] = [c.locator('button', { hasText: 'נרשם חידוש' }), c.locator('button', { hasText: 'סיום התקשרות' })];
    for (const b of [renew, end]) { await inside(page, b, 'a contract action'); if (width === 390) await tall(b, 'a contract action'); }
    const [a, b2] = [await renew.boundingBox(), await end.boundingBox()];
    assert.ok(Math.abs(a.y - b2.y) < 2 && Math.abs(a.height - b2.height) < 2, 'the two actions sit on one line, the same height');
    await noOverflow(page);
    await shot(page, `3-lior-contract-${width}`, c);
    assert.equal(db.clients.find((x) => x.id === END).status, 'active');
    // "נרשם חידוש": the dialog offers a year after the old end; a past date is refused.
    await renew.click();
    await page.waitForSelector('#dlg-renew[open]');
    assert.equal(await page.inputValue('#renew-end'), '2027-10-20');
    assert.match(await text(page.locator('#renew-ctx')), /מזרחי רהיטים · רון מזרחי · החוזה הסתיים ב־20/);
    await dialogFits(page, '#dlg-renew');
    await shot(page, `3-lior-renew-dialog-${width}`);
    await page.fill('#renew-end', '2026-10-01');
    await page.click('#renew-submit');
    assert.equal(await text(page.locator('#renew-err')), 'בוחרים תאריך סיום עתידי לחוזה החדש.');
    await page.fill('#renew-end', '2027-10-20');
    await page.click('#renew-submit');
    await page.waitForSelector('#dlg-renew:not([open])', { state: 'attached' });
    await settle(page);
    assert.deepEqual([db.clients.find((x) => x.id === END).contract_end, db.clients.find((x) => x.id === END).status], ['2027-10-20', 'active']);
    assert.equal(await page.locator(`#mine-list .contract-end[data-contract="${END}"]`).count(), 0);
    // "סיום התקשרות" on the other client: the status process 35 needs, and its card appears.
    const c2 = page.locator(`#mine-list .contract-end[data-contract="${END2}"]`);
    await c2.locator('button', { hasText: 'סיום התקשרות' }).click();
    await card(page, END2, 'p35').waitFor({ state: 'attached' }); // (on his list; further down than the first cards shown)
    assert.equal(db.clients.find((x) => x.id === END2).status, 'ending');
    assert.equal(await page.locator('#mine-list .contract-end').count(), 0);
    await shot(page, `3-lior-ending-${width}`);
    await ctx.close();
    // Irit does not get the card (it is Lior's to decide).
    const irit = await signedIn('irit', office(), { width });
    assert.equal(await irit.page.locator('#mine-list .contract-end').count(), 0);
    await irit.ctx.close();
  });

  await both('4. Lior: after the Zoom, "נשארו תיקונים" opens the item with its own deadline; "אין תיקונים" closes it', async (width, db) => {
    const { page, ctx } = await signedIn('lior', db, { width });
    const c = card(page, ZOOM, 'p13');
    await c.waitFor();
    const q = c.locator('.zoom-fixes');
    assert.match(await text(q), /^נשארו תיקונים אחרי הזום\? נשארו תיקונים אין תיקונים$/);
    for (const b of await q.locator('button').all()) { await inside(page, b, 'an answer'); if (width === 390) await tall(b, 'an answer'); }
    await noOverflow(page);
    await shot(page, `4-lior-zoom-${width}`, c);
    await q.locator('button', { hasText: 'נשארו תיקונים' }).click();
    await settle(page);
    assert.equal(checkOf(db, ZOOM, 'p13.left')?.state, 'done');
    assert.equal(await c.locator('.zoom-fixes').count(), 0);
    // The item is his now, due at the end of the next business day.
    assert.match(await text(c), /מחר עד 18:00/);
    await c.locator('button.wc-open, button.wc-more').first().click().catch(() => {});
    assert.match(await text(c), /תיקונים שנשארו אחרי הזום בוצעו ועודכנו בעמוד התסריטים/);
    await shot(page, `4-lior-zoom-left-${width}`, c);
    await ctx.close();
    // "אין תיקונים": the item is "לא נדרש", and nothing more is asked.
    const db2 = office();
    const none = await signedIn('lior', db2, { width });
    await card(none.page, ZOOM, 'p13').locator('.zoom-fixes button', { hasText: 'אין תיקונים' }).click();
    await settle(none.page);
    assert.deepEqual([checkOf(db2, ZOOM, 'p13.fixes')?.state, checkOf(db2, ZOOM, 'p13.left')], ['na', null]);
    assert.equal(await card(none.page, ZOOM, 'p13').locator('.zoom-fixes').count(), 0);
    await none.ctx.close();
  });

  await both('5. the shoot day: the file and the take per script, typed by Lior and by Eli into the same list; Eli ticks "קראתי את התסריטים"', async (width, db) => {
    const sid = `s-${SHOOT}`;
    const lior = await signedIn('lior', db, { path: `shoot.html?id=${SHOOT}`, width, wait: `#${sid}` });
    const box = lior.page.locator(`#${sid}-files`);
    assert.match(await text(box.locator('summary')), /^חומר גלם וטייק לכל תסריט · 0 מתוך 6 תסריטים עם קובץ$/);
    await box.locator('summary').click();
    assert.equal(await box.locator('.sh-file-row').count(), 6);
    const raw1 = lior.page.locator(`#${sid}-f1-raw`);
    assert.deepEqual([await raw1.getAttribute('inputmode'), await raw1.getAttribute('aria-label')], ['numeric', 'מספר הקובץ, סרטון 1']);
    for (const f of ['raw', 'take']) { const el = lior.page.locator(`#${sid}-f1-${f}`); await inside(lior.page, el, f); if (width === 390) await tall(el, f); }
    // The three cells of a row sit on one line.
    const cells = await box.locator('.sh-file-row').first().locator('> *').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)));
    assert.ok(Math.max(...cells) - Math.min(...cells) <= 2, `a row is one line: ${cells}`);
    await raw1.fill('0123');
    await raw1.press('Tab');
    await lior.page.locator(`#${sid}-f1-take`).fill('2');
    await lior.page.locator(`#${sid}-f1-take`).press('Tab');
    await lior.page.waitForFunction((id) => /1 מתוך 6/.test(document.getElementById(id)?.textContent || ''), `${sid}-files-n`);
    await settle(lior.page); // (the two fields are saved one after the other)
    assert.deepEqual([...filesOf({ 'p18b.files': checkOf(db, SHOOT, 'p18b.files') }, '')], [[1, { raw: '0123', take: '2' }]]);
    assert.equal(await lior.page.evaluate(() => document.activeElement.id), `${sid}-f2-raw`, 'the next row is typed at once');
    await noOverflow(lior.page);
    await shot(lior.page, `5-lior-files-${width}`, box);
    await lior.ctx.close();
    // Eli sees Lior's row, and adds his own: both rows are kept.
    const eli = await signedIn('eli', db, { path: `shoot.html?id=${SHOOT}`, width, wait: `#${sid}` });
    const ebox = eli.page.locator(`#${sid}-files`);
    await ebox.locator('summary').click();
    assert.deepEqual([await eli.page.inputValue(`#${sid}-f1-raw`), await eli.page.inputValue(`#${sid}-f1-take`)], ['0123', '2']);
    await eli.page.locator(`#${sid}-f3-raw`).fill('0140');
    await eli.page.locator(`#${sid}-f3-raw`).press('Tab');
    await eli.page.waitForFunction((id) => /2 מתוך 6/.test(document.getElementById(id)?.textContent || ''), `${sid}-files-n`);
    assert.deepEqual([...filesOf({ 'p18b.files': checkOf(db, SHOOT, 'p18b.files') }, '').keys()], [1, 3]);
    // The hint next to the handoff ("לכל חומר ברור לאיזה מספר סרטון הוא שייך").
    assert.equal(await text(eli.page.locator(`#${sid}-numbered`)), '2 מתוך 6 תסריטים עם קובץ.');
    await noOverflow(eli.page);
    await shot(eli.page, `5-eli-files-${width}`, ebox);
    // Tomorrow's shoot day: "קראתי את התסריטים", one tap; Lior's briefing card says so.
    const rid = `s-${READ}`;
    const read = eli.page.locator(`#${rid}-read`);
    assert.equal(await text(read), 'קראתי את התסריטים');
    if (width === 390) await tall(read, 'the tick');
    await read.scrollIntoViewIfNeeded();
    await shot(eli.page, `5-eli-read-${width}`, read);
    await read.click();
    await eli.page.waitForSelector(`#${rid}-read-ok`);
    assert.match(await text(eli.page.locator(`#${rid}-read-ok`)), /^קראת את התסריטים .*ליאור רואה\.$/);
    assert.equal(checkOf(db, READ, 'p16.read')?.state, 'done');
    await eli.ctx.close();
    const l2 = await signedIn('lior', db, { path: 'shoot.html', width, wait: `#b-${READ}` });
    assert.match(await text(l2.page.locator(`#b-${READ}-read`)), /^אלי קרא את התסריטים/);
    await l2.ctx.close();
  });

  await both('6. the editor: the files of the shoot day to read, and the five critical mistakes in "מוכן לבדיקה"', async (width, db) => {
    const { page, ctx } = await signedIn('nadia', db, { path: 'editor.html', width, wait: `#c-${EDIT}` });
    const c = page.locator(`#c-${EDIT}`);
    assert.match(await text(c.locator('.ed-files')), /חומר גלם וטייק לכל תסריט \(3\) סרטון 1 · קובץ 0123 · טייק 2 סרטון 2 · קובץ 0131 סרטון 4 · טייק 3/);
    assert.equal(await c.locator('.ed-files input').count(), 0, 'to read only');
    await shot(page, `6-editor-files-${width}`, c.locator('.ed-files'));
    await page.click(`#c-${EDIT}-go`);
    await page.waitForSelector('#dlg-ready[open]');
    assert.equal(await page.locator('#ready-list .prod-check').count(), 10);
    assert.equal(await text(page.locator('#ready-critical')), 'חמש הטעויות הקריטיות של העריכה');
    const labels = await page.locator('#ready-list .prod-check').allInnerTexts();
    assert.deepEqual(labels.slice(5).map((s) => s.trim()), CRITICAL_MISTAKES.map(([, , l]) => l));
    await dialogFits(page, '#dlg-ready');
    await page.locator('#ready-critical').scrollIntoViewIfNeeded();
    await shot(page, `6-editor-ready-${width}`);
    // Each is one tap, and all are required.
    for (let i = 0; i < 9; i += 1) await page.click(`#ready-${i}`);
    await page.fill('#ready-link', 'https://drive.google.com/drive/folders/noy');
    await page.click('#ready-submit');
    assert.match(await text(page.locator('#ready-err')), /עוד לא סומן: ״הסרטונים יצאו רק בהגדרות שהוגדרו מראש, בלי בעיית פיקסלים״/);
    await page.click('#ready-9');
    await page.click('#ready-submit');
    await page.waitForSelector('#dlg-ready:not([open])', { state: 'attached' });
    for (const k of [...FIVE22, 'p22.edited', 'p24.notify']) assert.equal(checkOf(db, EDIT, k)?.state, 'done', k);
    await ctx.close();
  });

  await both('7. Ofir\'s quality control: eleven checks, the five critical ones under their own line; one that fails is one tap in the return', async (width, db) => {
    const { page, ctx } = await signedIn('ofir', db, { path: `qa.html#review-${QA}-p25`, width, wait: '#dlg-qa[open]' });
    assert.equal(await text(page.locator('#qa-checks-legend')), '11 הבדיקות (סרטונים)');
    assert.equal(await page.locator('#qa-checks input').count(), 11);
    assert.equal(await text(page.locator('#qa-critical')), 'חמש הטעויות הקריטיות של העריכה');
    const labels = (await page.locator('#qa-checks label').allInnerTexts()).map((s) => s.trim());
    assert.deepEqual(labels.slice(6), CRITICAL_MISTAKES.map(([, , , l]) => l));
    await dialogFits(page, '#dlg-qa');
    await page.locator('#qa-critical').scrollIntoViewIfNeeded();
    await shot(page, `7-ofir-qa-${width}`);
    // Approval needs all eleven.
    for (const i of [0, 1, 2, 3, 4, 5]) await page.locator('#qa-checks input').nth(i).check();
    await page.click('#qa-approve');
    assert.match(await text(page.locator('#qa-err')), /כדי לאשר צריך לסמן את כל 11 הבדיקות \(חסרות 5\)/);
    // The sound fails: "החזרה לתיקון", one tap on the mistake, the video's number, send.
    await page.click('#qa-to-return');
    const chips = page.locator('#qa-mistakes .of-mistake');
    assert.deepEqual((await chips.allInnerTexts()).map((s) => s.trim()), CRITICAL_MISTAKES.map(([, name]) => name));
    for (const b of await chips.all()) await inside(page, b, 'a mistake');
    await page.click('#qa-m-sound');
    assert.equal(await page.inputValue('#qa-text-1'), 'טעות קריטית · סאונד: בעיית סאונד, או מוזיקה שעוברת את המינוס 20 dB');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'qa-ref-1');
    await page.fill('#qa-ref-1', '3');
    await page.click('#qa-m-export');
    assert.equal(await page.inputValue('#qa-text-2'), 'טעות קריטית · הגדרות ייצוא: הסרטון לא יצא בהגדרות שהוגדרו מראש (בעיית פיקסלים)');
    await page.click('#qa-m-sound'); // twice: not doubled
    assert.equal(await page.locator('#qa-issues > li').count(), 2);
    await dialogFits(page, '#dlg-qa');
    await shot(page, `7-ofir-return-${width}`);
    await page.click('#qa-send-return');
    await page.waitForSelector('#dlg-qa:not([open])', { state: 'attached' });
    const ret = JSON.parse(checkOf(db, QA, 'p25.return.1').note);
    assert.deepEqual(ret.issues, [{ ref: '3', text: 'טעות קריטית · סאונד: בעיית סאונד, או מוזיקה שעוברת את המינוס 20 dB' }, { ref: '', text: 'טעות קריטית · הגדרות ייצוא: הסרטון לא יצא בהגדרות שהוגדרו מראש (בעיית פיקסלים)' }]);
    assert.equal(FIVE25.filter((k) => checkOf(db, QA, k)).length, 0);
    await ctx.close();
  });

  await both('8. Ilai: the final check is one card; "סימון הכול" ticks the 13, and then "העבודה שלי על הלקוח הושלמה"', async (width, db) => {
    const { page, ctx } = await signedIn('ilai', db, { width });
    const c = card(page, FINAL, 'p29b');
    await c.waitFor();
    assert.match(await text(c), /אלון צמחים · רותי אלון.*29ב · בדיקה סופית של כל העבודה · 13 פריטים לסימון/);
    assert.match(await text(c.locator('.wc-when')), /מחר עד 18:00/);
    await shot(page, `8-ilai-card-${width}`, c);
    await c.locator('.wc-open').click();
    assert.equal(await c.locator('.wlist .witem').count(), 13);
    const all = c.locator('.bulk-btn');
    assert.equal(await text(all), 'סימון הכול (13)');
    await inside(page, all, 'סימון הכול');
    if (width === 390) await tall(all, 'סימון הכול');
    await noOverflow(page);
    await shot(page, `8-ilai-open-${width}`, c);
    await all.click();
    await settle(page);
    for (const [k] of FINAL_CHECK) assert.equal(checkOf(db, FINAL, `p29b.c.${k}`)?.state, 'done', k);
    // What is left is the last one, as a single pill.
    assert.match(await text(c), /העבודה שלי על הלקוח הושלמה/);
    const pill = c.locator('input.cbx.fin');
    assert.equal(await pill.count(), 1);
    assert.equal(await pill.getAttribute('data-word'), 'הושלמה');
    await shot(page, `8-ilai-last-${width}`, c);
    await pill.check();
    await settle(page);
    assert.equal(checkOf(db, FINAL, 'p29b.done')?.state, 'done');
    assert.equal(await card(page, FINAL, 'p29b').count(), 0);
    await ctx.close();
  });

  await both('9. Irit: a "נודניק" for Nirel asks for the four fields of her brief, and is not sent without them', async (width, db) => {
    const { page, ctx } = await signedIn('irit', db, { width, wait: '#st-new' });
    await page.click('#st-new');
    await page.waitForSelector('#st-form');
    assert.equal(await page.locator('#st-brief').isHidden(), true, 'no brief until Nirel is chosen');
    await page.selectOption('#st-assignee', 'nadia');
    assert.equal(await page.locator('#st-brief').isHidden(), true);
    await page.selectOption('#st-assignee', 'nirel');
    assert.equal(await page.locator('#st-brief').isVisible(), true);
    assert.deepEqual((await page.locator('#st-brief label').allInnerTexts()).map((s) => s.trim()), ['מה הבעיה המדויקת', 'מה בדיוק צריך לשנות', 'מה צריך להישאר כמו שהוא', 'מה התוצאה הרצויה']);
    for (const k of ['problem', 'change', 'keep', 'result']) { const el = page.locator(`#st-brief-${k}`); await inside(page, el, k); }
    await page.fill('#st-body', 'לתקן את הסגיר של סרטון 4');
    await page.click('#st-send');
    assert.equal(await text(page.locator('#st-brief-problem-err')), 'חובה במשימה לניראל.');
    assert.equal(await page.locator('#st-brief .err:not([hidden])').count(), 4);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'st-brief-problem');
    assert.equal(db.staff_tasks.length, 0);
    await page.locator('#st-brief').scrollIntoViewIfNeeded();
    await noOverflow(page);
    await shot(page, `9-irit-nudnik-${width}`);
    await page.fill('#st-brief-problem', 'הלוגו בסגיר ישן');
    await page.fill('#st-brief-change', 'להחליף ללוגו החדש');
    await page.fill('#st-brief-keep', 'המוזיקה והטקסט');
    await page.fill('#st-brief-result', 'סגיר נקי עם הלוגו החדש');
    await page.click('#st-send');
    await page.waitForFunction(() => !document.getElementById('st-form'));
    assert.deepEqual([db.staff_tasks.length, db.staff_tasks[0].assignee, db.staff_tasks[0].brief], [1, 'nirel', { problem: 'הלוגו בסגיר ישן', change: 'להחליף ללוגו החדש', keep: 'המוזיקה והטקסט', result: 'סגיר נקי עם הלוגו החדש' }]);
    await ctx.close();
    // Nirel reads the brief on the task.
    const nirel = await signedIn('nirel', db, { width, wait: '.st-item.is-mine' });
    assert.match(await text(nirel.page.locator('.st-item.is-mine .st-brief')), /מה הבעיה המדויקת הלוגו בסגיר ישן מה בדיוק צריך לשנות להחליף ללוגו החדש/);
    await noOverflow(nirel.page);
    await shot(nirel.page, `9-nirel-task-${width}`, nirel.page.locator('.st-item.is-mine'));
    await nirel.ctx.close();
  });

  assert.deepEqual(errors, [], 'no page errors');
  noCspViolations();
  console.log(`\n${passed} steps passed.`);
} finally {
  await browser.close();
}
