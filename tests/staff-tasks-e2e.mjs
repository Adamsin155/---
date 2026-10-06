// End-to-end check of the tasks given on the spot in the browser (the owner's request
// of 6.10.2026), against an in-memory fake of Supabase that answers as the database
// does (who may give, mark done, cancel and read: tests/sql/staff-tasks.test.mjs holds
// the real rules; the 10-minute reminders themselves: tests/staff-tasks.test.mjs):
//   - Irit has "משימות מיידיות" right under the "now" bar: "משימה חדשה" (to whom, what,
//     an optional client), the checks of the form, and what the database is asked;
//   - Nadia, on a 360px phone, sees "משימות שקיבלת (1)" with "בוצע", when the next
//     reminder comes, no way to give a task; "בוצע" closes it, and Irit sees it done,
//     by whom and when;
//   - Stav (sales) gets his on deal.html, with the phone's notifications card;
//   - Irit cancels a task: shown as cancelled, not done, and gone from the assignee;
//   - the owner sees everyone's; Lior, who neither gives nor got one, has no card;
//   - an assignee with no login is refused in words; before the migration the card
//     is simply not there.
// Run: npx http-server -p 8137 -s -c-1 . &  then
//      BASE_URL=http://localhost:8137/ node tests/staff-tasks-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { withClientColumns } from './fake-clients.mjs';
import { GIVERS, ASSIGNEES, BODY_MAX } from '../app/staff-tasks-logic.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Monday 5.10.2026, 10:00 in Jerusalem: an office day, inside the reminders' window.
const NOW = new Date('2026-10-05T07:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();
const minutesAgo = (n) => new Date(NOW - n * 6e4).toISOString();

// Yariv and Anna have no login: a task cannot reach them.
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', nadia: 'nadia', eli: 'eli', stav: 'stav' };
const users = new Map();
const staff = [];
for (const [k, person] of Object.entries(PEOPLE)) {
  const email = `${k}@astrateg.test`;
  users.set(email, { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: minutesAgo(9000) });
  staff.push({ email, person, vault: false });
}
const OFFICE = new Set(['irit', 'lior', 'ofir', 'ilai', null]);
const EXP = Math.floor(NOW / 1000) + 3 * 3600;
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const sessionFor = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 3 * 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
// public.reminder_person(): the person key, 'owner' for the owner's row, null for a stranger.
const personOf = (u) => { const s = staff.find((x) => x.email === u?.email); return s ? s.person ?? 'owner' : null; };
const isOffice = (u) => !!u && staff.some((s) => s.email === u.email) && OFFICE.has(staff.find((s) => s.email === u.email).person);

const client = (name, business) => ({
  id: randomUUID(), name, business, address: null, phone: '050-1234567', package_name: 'סושיאל', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  editor_name: null, editor: null, deal_at: minutesAgo(60 * 24 * 200), char_at: null, shoot_at: null, contract_end: '2027-12-31', status: 'active', notes: null, quote_id: null,
  created_at: minutesAgo(60 * 24 * 200), created_by_email: null, links: {}, deliverables: {}, rounds: [], verified_at: minutesAgo(60 * 24 * 199), verified_by: 'irit@astrateg.test',
  closed_reason: null, archived_at: null, archived_by: null, protocol_version: 7,
});
const tables = { clients: [client('רון כהן', 'פיצה רון'), client('קפה דנה', 'קפה דנה')], protocol_checks: [], client_tasks: [], office_reviews: [], client_status_notes: [], protocol_log: [] };
const tasks = [];
const calls = [];
let tableMissing = false;

const visible = (t, me) => { const p = personOf(me); return !!p && (t.assignee === p || t.created_by === p || p === 'owner'); };
function rpc(name, body, me, json) {
  if (name === 'is_staff') return json(200, !!me && staff.some((s) => s.email === me.email));
  if (name === 'is_office') return json(200, isOffice(me));
  if (name.startsWith('staff_task_')) {
    calls.push({ [name]: body, by: me?.email });
    const p = personOf(me);
    if (tableMissing) return json(404, { code: 'PGRST202', message: 'function not found' });
    if (!p) return json(403, { code: '42501', message: 'not allowed' });
    if (name === 'staff_task_create') {
      if (!GIVERS.includes(p)) return json(403, { code: '42501', message: 'not allowed' });
      if (!ASSIGNEES().some((a) => a.key === body.p_assignee)) return json(400, { code: '22023', message: 'unknown assignee' });
      if (!staff.some((s) => (s.person ?? 'owner') === body.p_assignee)) return json(400, { code: '22023', message: 'the assignee has no login' });
      const text = String(body.p_body || '').trim();
      if (!text || text.length > BODY_MAX) return json(400, { code: '22023', message: 'the task text is required (up to 500 characters)' });
      const c = body.p_client ? tables.clients.find((x) => x.id === body.p_client) : null;
      if (body.p_client && !c) return json(404, { code: 'P0002', message: 'client not found' });
      const t = {
        id: randomUUID(), created_at: serverNow(), created_by: p, created_by_email: me.email, assignee: body.p_assignee, body: text,
        client_id: c?.id || null, client_name: c ? (c.business && c.business !== c.name ? `${c.business} · ${c.name}` : c.name) : null,
        status: 'open', done_at: null, done_by_email: null, cancelled_at: null, cancelled_by_email: null,
      };
      tasks.push(t);
      return json(200, t.id);
    }
    const t = tasks.find((x) => x.id === body.p_id);
    if (!t || !visible(t, me)) return json(404, { code: 'P0002', message: 'task not found' });
    if (name === 'staff_task_done') {
      if (t.assignee !== p) return json(403, { code: '42501', message: 'only the assignee marks a task done' });
      if (t.status !== 'open') return json(400, { code: '22023', message: 'this task is not open' });
      Object.assign(t, { status: 'done', done_at: serverNow(), done_by_email: me.email });
    } else {
      if (!(p === 'owner' || (t.created_by === p && GIVERS.includes(p)))) return json(403, { code: '42501', message: 'not allowed' });
      if (t.status !== 'open') return json(400, { code: '22023', message: 'this task is not open' });
      Object.assign(t, { status: 'cancelled', cancelled_at: serverNow(), cancelled_by_email: me.email });
    }
    return json(200, t);
  }
  return json(200, []);
}

const filtersOf = (url) => [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k));
const matcher = (filters) => (row) => filters.every(([k, v]) => {
  if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
  if (v.startsWith('neq.')) return String(row[k]) !== v.slice(4);
  if (v.startsWith('in.')) return v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(row[k]));
  return true;
});
const answer = (req, json) => (rows) => ((req.headers().accept || '').includes('vnd.pgrst.object')
  ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' })) : json(200, rows));

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const json = (status, data) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
  });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  const me = userOf(req.headers());
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
    return json(200, sessionFor(u));
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p.startsWith('/rest/v1/rpc/')) return rpc(p.slice('/rest/v1/rpc/'.length), body || {}, me, json);
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  if (m[1] === 'staff_tasks') {
    if (tableMissing) return json(404, { code: 'PGRST205', message: "Could not find the table 'public.staff_tasks' in the schema cache" });
    // No direct writes: only the three functions.
    if (req.method() !== 'GET') { calls.push({ directWrite: req.method(), by: me.email }); return json(403, { code: '42501', message: 'permission denied for table staff_tasks' }); }
    return answer(req, json)(tasks.filter((t) => visible(t, me)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
  }
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    return answer(req, json)(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff);
  }
  if (m[1] === 'clients') {
    // Row level security: the office reads every client; here nobody else has one.
    const rows = isOffice(me) ? tables.clients.filter(matcher(filtersOf(url))) : [];
    return answer(req, json)(rows);
  }
  if (m[1] === 'reminder_log' || m[1] === 'deal_requests' || m[1] === 'quotes') return json(200, []);
  const rows = (tables[m[1]] || []).filter(matcher(filtersOf(url).filter(([k]) => k === 'id' || k === 'client_id')));
  return answer(req, json)(rows);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time: new Date(serverNow()) });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => tables.clients, staff: () => staff }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, path, who) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.locator('#app:not([hidden])').waitFor();
}
const CARD = '#staff-tasks-card';
const shot = async (page, name, fullPage = false) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage }); };
const text = (page, sel) => page.locator(sel).first().innerText();
const texts = (page, sel) => page.locator(sel).allInnerTexts();
const toastOf = (page) => page.locator('#toast.on').innerText();
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.offsetParent && el.getBoundingClientRect().height < 43.5)
  .map((el) => `${el.textContent.trim().slice(0, 20)}:${Math.round(el.getBoundingClientRect().height)}`), sel);
const lastCall = (name) => calls.filter((c) => c[name]).at(-1);
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last calls: ${JSON.stringify(calls.slice(-3)).slice(0, 900)}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

let exitCode = 0;
try {
  const irit = await newPage();
  await signIn(irit, 'clients.html#mine', 'irit');

  await step('Irit: "משימות מיידיות" right under the "now" bar, with "משימה חדשה" and nothing open yet', async () => {
    await irit.locator(`${CARD}:not([hidden])`).waitFor();
    assert.deepEqual(await irit.evaluate(() => [...document.querySelectorAll('#view-mine > *')].slice(0, 3).map((e) => e.id)), ['now-bar', 'staff-tasks-card', 'deals-card']);
    assert.equal(await text(irit, `${CARD} h2`), 'משימות מיידיות');
    assert.equal(await text(irit, '#st-new'), 'משימה חדשה');
    assert.match(await text(irit, CARD), /אין משימות פתוחות שנתת\./);
    assert.equal(await irit.locator(`${CARD} .st-item`).count(), 0);
    // No pink button in the card: the page keeps it for its one main action.
    assert.equal(await irit.locator(`${CARD} .btn-primary`).count(), 0);
    await shot(irit, '01-irit-empty');
  });

  await step('the form: everyone on the team and the owner, the client is optional, an empty form is refused in words', async () => {
    await irit.click('#st-new');
    await irit.locator('#st-form').waitFor();
    assert.equal(await irit.evaluate(() => document.activeElement.id), 'st-assignee');
    assert.deepEqual(await texts(irit, '#st-assignee option'), ['בחירת עובד/ת', 'עירית', 'ליאור', 'אופיר', 'עילאי', 'ניראל', 'נדיה', 'יריב', 'אנה', 'אלי', 'סתיו', 'עמוס', 'הבעלים']);
    assert.deepEqual(await texts(irit, '#st-client option'), ['בלי לקוח', 'פיצה רון · רון כהן', 'קפה דנה']);
    assert.equal(await irit.getAttribute('#st-body', 'maxlength'), String(BODY_MAX));
    assert.match(await text(irit, '#st-form .hint'), /התראה מיד, ואז כל 10 דקות עד ״בוצע״, בימי עבודה 09:00–20:00/);
    const before = calls.length;
    await irit.click('#st-send');
    assert.equal(await text(irit, '#st-assignee-err'), 'בוחרים למי המשימה.');
    assert.equal(await text(irit, '#st-body-err'), 'כותבים מה צריך לעשות.');
    assert.equal(await irit.getAttribute('#st-assignee', 'aria-invalid'), 'true');
    assert.equal(calls.length, before, 'nothing was sent');
    // A corrected field loses its error at once.
    await irit.selectOption('#st-assignee', 'nadia');
    assert.ok(await irit.locator('#st-assignee-err').isHidden());
    assert.equal(await irit.getAttribute('#st-assignee', 'aria-invalid'), 'false');
    await irit.click('#st-send');
    assert.equal(await text(irit, '#st-body-err'), 'כותבים מה צריך לעשות.');
    await irit.fill('#st-body', 'להעלות את הסרטון של פיצה רון לדרייב');
    assert.ok(await irit.locator('#st-body-err').isHidden());
    assert.equal(await text(irit, '#st-count'), `35/${BODY_MAX}`);
    await shot(irit, '02-irit-form');
  });

  let first;
  await step('sending: the database is asked with who, what and the client; the task is in "פתוחות" with the assignee', async () => {
    await irit.selectOption('#st-client', { label: 'פיצה רון · רון כהן' });
    await irit.click('#st-send');
    await irit.locator(`${CARD} .st-item`).waitFor();
    assert.deepEqual(lastCall('staff_task_create').staff_task_create, { p_assignee: 'nadia', p_body: 'להעלות את הסרטון של פיצה רון לדרייב', p_client: tables.clients[0].id });
    assert.equal(await toastOf(irit), 'המשימה נשלחה לנדיה. תזכורת כל 10 דקות עד ״בוצע״.');
    first = tasks.at(-1);
    assert.deepEqual([first.created_by, first.assignee, first.status, first.client_name], ['irit', 'nadia', 'open', 'פיצה רון · רון כהן']);
    assert.ok(await irit.locator('#st-form').count() === 0);
    assert.equal(await text(irit, '#st-open-h'), 'פתוחות (1)');
    const item = irit.locator(`${CARD} .st-item`);
    assert.match(await item.innerText(), /נדיה\s*פתוחה\s*להעלות את הסרטון של פיצה רון לדרייב\s*נשלחה היום 10:0\d · לקוח: פיצה רון · רון כהן/);
    // The office opens the client from the task.
    assert.equal(await item.locator('.st-meta a').getAttribute('href'), `client.html?id=${tables.clients[0].id}`);
    assert.equal(await text(irit, `${CARD} [data-act="cancel"]`), 'ביטול המשימה');
    // The giver has no "בוצע" on a task of someone else.
    assert.equal(await irit.locator(`${CARD} [data-act="done"]`).count(), 0);
    assert.equal(calls.filter((c) => c.directWrite).length, 0);
    await shot(irit, '03-irit-open');
  });

  // The simplicity pass of 6.10.2026: the giver's card stood, a screen tall, before her own work.
  await step('on entering, the giver\'s part is one row: "משימה חדשה" and "פתוחות (1)", and the list opens on demand', async () => {
    await irit.reload();
    await irit.locator('#st-open-toggle').waitFor();
    assert.equal(await text(irit, `${CARD} h2`), 'משימות מיידיות');
    assert.equal(await text(irit, '#st-open-h'), 'פתוחות (1)');
    assert.equal(await irit.getAttribute('#st-open-toggle', 'aria-expanded'), 'false');
    assert.equal(await irit.locator(`${CARD} .st-item`).count(), 0);
    assert.equal(await irit.locator('#st-form').count(), 0);
    const box = await irit.locator(CARD).boundingBox();
    assert.ok(box.height <= 130, `the folded card is ${Math.round(box.height)}px tall`);
    assert.deepEqual(await smallTargets(irit, `${CARD} .btn, ${CARD} .btn-text`), []);
    await shot(irit, '03b-irit-folded');
    await irit.click('#st-open-toggle');
    assert.equal(await irit.getAttribute('#st-open-toggle', 'aria-expanded'), 'true');
    assert.equal(await irit.evaluate(() => document.activeElement.id), 'st-open-toggle');
    assert.match(await irit.locator(`${CARD} .st-item`).innerText(), /נדיה\s*פתוחה\s*להעלות את הסרטון/);
    assert.equal(await text(irit, `${CARD} [data-act="cancel"]`), 'ביטול המשימה');
  });

  const nadia = await newPage({ width: 360, height: 760 });
  await step('Nadia on a 360px phone: "משימות שקיבלת (1)", who gave it and when, the next reminder, and "בוצע"', async () => {
    await signIn(nadia, 'clients.html#mine', 'nadia');
    await nadia.locator(`${CARD}:not([hidden])`).waitFor();
    assert.equal(await text(nadia, `${CARD} h2`), 'משימות שקיבלת (1)');
    const item = nadia.locator(`${CARD} .st-item.is-mine`);
    assert.match(await item.innerText(), /להעלות את הסרטון של פיצה רון לדרייב\s*מעירית · היום 10:0\d · לקוח: פיצה רון · רון כהן\s*תזכורת כל 10 דקות עד שמסמנים ״בוצע״\. הבאה: היום 10:1\d\.\s*בוצע/);
    // Not her client to open: its name is text, not a link.
    assert.equal(await item.locator('a').count(), 0);
    // She gives no tasks: no form, no list of given ones.
    assert.equal(await nadia.locator('#st-new').count(), 0);
    assert.equal(await nadia.locator(`${CARD} .st-sub`).count(), 0);
    assert.equal(await noSideScroll(nadia), true);
    assert.deepEqual(await smallTargets(nadia, `${CARD} .btn, ${CARD} .btn-text`), []);
    const box = await nadia.locator(`${CARD} [data-act="done"]`).boundingBox();
    assert.ok(box.height >= 44 && box.width >= 200, `the "בוצע" button is ${Math.round(box.width)}×${Math.round(box.height)}`);
    await shot(nadia, '04-nadia-phone');
  });

  await step('"בוצע": only this stops it; the card goes, and Irit sees it done, by whom and when', async () => {
    await nadia.click(`${CARD} [data-act="done"]`);
    await nadia.locator(CARD).waitFor({ state: 'hidden' });
    assert.deepEqual(lastCall('staff_task_done'), { staff_task_done: { p_id: first.id }, by: 'nadia@astrateg.test' });
    assert.equal(await toastOf(nadia), 'סומן ״בוצע״. התזכורות נעצרו.');
    assert.deepEqual([first.status, first.done_by_email], ['done', 'nadia@astrateg.test']);
    await irit.reload();
    await irit.locator('#st-closed-toggle').waitFor();
    assert.match(await text(irit, CARD), /אין משימות פתוחות שנתת\./);
    assert.equal(await text(irit, '#st-closed-toggle'), 'מה שנסגר בשבוע האחרון (1)');
    assert.equal(await irit.getAttribute('#st-closed-toggle', 'aria-expanded'), 'false');
    await irit.click('#st-closed-toggle');
    assert.equal(await irit.getAttribute('#st-closed-toggle', 'aria-expanded'), 'true');
    assert.match(await irit.locator(`${CARD} .st-item`).innerText(), /נדיה\s*בוצעה\s*להעלות את הסרטון של פיצה רון לדרייב\s*נשלחה היום 10:0\d · בוצעה היום 10:0\d/);
    assert.equal(await irit.locator(`${CARD} [data-act="cancel"]`).count(), 0);
    await shot(irit, '05-irit-done');
  });

  const give = async (page, who, body) => {
    await page.click('#st-new');
    await page.selectOption('#st-assignee', who);
    await page.fill('#st-body', body);
    await page.click('#st-send');
  };

  await step('an assignee with no login is refused in words, and the form stays', async () => {
    await give(irit, 'yariv', 'לסיים את העריכה');
    await irit.locator('#toast.on').waitFor();
    assert.match(await toastOf(irit), /לעובד הזה עוד אין כניסה למערכת/);
    assert.equal(await irit.inputValue('#st-body'), 'לסיים את העריכה');
    assert.equal(tasks.length, 1);
    await irit.locator('#st-form .btn-ghost').click();
    assert.equal(await irit.locator('#st-form').count(), 0);
  });

  const stav = await newPage({ width: 390, height: 844 });
  await step('Stav (sales) gets his on deal.html, with the phone\'s notifications card, and marks it done', async () => {
    await give(irit, 'stav', 'לשלוח לי את רשימת הלידים של השבוע');
    await irit.locator(`${CARD} .st-item [data-act="cancel"]`).waitFor();
    await signIn(stav, 'deal.html', 'stav');
    await stav.locator(`${CARD}:not([hidden])`).waitFor();
    assert.equal(await text(stav, `${CARD} h2`), 'משימות שקיבלת (1)');
    assert.match(await text(stav, `${CARD} .st-item`), /לשלוח לי את רשימת הלידים של השבוע\s*מעירית · היום/);
    assert.equal(await stav.locator('#st-new').count(), 0);
    // The card comes before his form, and the notifications card is offered to him too.
    assert.ok(await stav.evaluate(() => !!(document.querySelector('#staff-tasks-card').compareDocumentPosition(document.querySelector('#deal-form')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    assert.ok(await stav.locator('#push-card').count() === 1);
    assert.equal(await noSideScroll(stav), true);
    await shot(stav, '06-stav-deal');
    await stav.click(`${CARD} [data-act="done"]`);
    await stav.locator(CARD).waitFor({ state: 'hidden' });
    assert.equal(tasks.at(-1).status, 'done');
    await stav.context().close();
  });

  await step('Irit cancels a task: kept as cancelled, not done, and gone from the assignee', async () => {
    await irit.reload();
    await irit.locator('#st-new').waitFor();
    await give(irit, 'eli', 'לטעון סוללות למחר');
    await irit.locator(`${CARD} [data-act="cancel"]`).waitFor();
    const eliTask = tasks.at(-1);
    const eli = await newPage({ width: 390, height: 844 });
    await signIn(eli, 'clients.html#mine', 'eli');
    await eli.locator(`${CARD}:not([hidden])`).waitFor();
    // The assignee has no way to cancel.
    assert.equal(await eli.locator(`${CARD} [data-act="cancel"]`).count(), 0);
    await irit.click(`${CARD} [data-act="cancel"]`); // the confirm dialog is accepted
    await irit.locator(`${CARD} [data-act="cancel"]`).waitFor({ state: 'detached' });
    assert.deepEqual(lastCall('staff_task_cancel'), { staff_task_cancel: { p_id: eliTask.id }, by: 'irit@astrateg.test' });
    assert.equal(await toastOf(irit), 'המשימה בוטלה. התזכורות נעצרו.');
    assert.deepEqual([eliTask.status, eliTask.done_at], ['cancelled', null]);
    await irit.click('#st-closed-toggle');
    assert.deepEqual(await texts(irit, `${CARD} .st-state`), ['בוטלה', 'בוצעה', 'בוצעה']);
    await eli.reload();
    await eli.locator('#mine-list').waitFor();
    await eli.waitForLoadState('networkidle');
    assert.ok(await eli.locator(CARD).isHidden());
    await eli.context().close();
  });

  await step('a task cancelled while the assignee looks at it: "בוצע" is refused in words and the card refreshes', async () => {
    await give(irit, 'nadia', 'לשלוח לי את הקובץ הסופי');
    await irit.locator(`${CARD} [data-act="cancel"]`).waitFor();
    await nadia.reload();
    await nadia.locator(`${CARD} [data-act="done"]`).waitFor();
    Object.assign(tasks.at(-1), { status: 'cancelled', cancelled_at: serverNow(), cancelled_by_email: 'irit@astrateg.test' });
    await nadia.click(`${CARD} [data-act="done"]`);
    await nadia.locator(CARD).waitFor({ state: 'hidden' });
    assert.equal(await toastOf(nadia), 'המשימה כבר נסגרה. הרשימה רועננה.');
    assert.equal(tasks.at(-1).status, 'cancelled');
  });

  await step('the owner sees everyone\'s and gives too; Lior, who neither gives nor got one, has no card', async () => {
    const owner = await newPage();
    await signIn(owner, 'clients.html#mine', 'owner');
    await owner.locator(`${CARD}:not([hidden])`).waitFor();
    assert.equal(await text(owner, '#st-new'), 'משימה חדשה');
    await give(owner, 'irit', 'להתקשר לרואה החשבון');
    await owner.locator(`${CARD} [data-act="cancel"]`).waitFor();
    assert.equal(tasks.at(-1).created_by, 'owner');
    await owner.click('#st-closed-toggle');
    // Irit's tasks are in his list, named as hers.
    assert.equal(await owner.locator(`${CARD} .st-item`).count(), 5);
    assert.match(await owner.locator(`${CARD} .st-item`).nth(1).innerText(), /נתן\/ה עירית · נשלחה/);
    await shot(owner, '07-owner');
    await owner.context().close();
    // Irit got one from the owner: hers to mark done, not hers to cancel.
    await irit.reload();
    await irit.locator(`${CARD} .st-item.is-mine`).waitFor();
    assert.equal(await text(irit, `${CARD} h2`), 'משימות שקיבלת (1)');
    assert.match(await text(irit, `${CARD} .st-item.is-mine`), /להתקשר לרואה החשבון\s*מהבעלים · היום/);
    assert.equal(await irit.locator(`${CARD} .st-item.is-mine [data-act="cancel"]`).count(), 0);
    assert.equal(await text(irit, `${CARD} .st-sub`), 'משימות שנתת');
    await shot(irit, '08-irit-both', true);
    const lior = await newPage();
    await signIn(lior, 'clients.html#mine', 'lior');
    await lior.locator('#mine-list').waitFor();
    await lior.waitForLoadState('networkidle');
    assert.ok(await lior.locator(CARD).isHidden());
    await lior.context().close();
  });

  await step('before the migration: the card is not there, for Irit too, and the page is whole', async () => {
    tableMissing = true;
    const early = await newPage();
    await signIn(early, 'clients.html#mine', 'irit');
    await early.locator('#mine-list').waitFor();
    await early.waitForLoadState('networkidle');
    assert.ok(await early.locator(CARD).isHidden());
    assert.equal(await early.locator(`${CARD} *`).count(), 0);
    await early.context().close();
    tableMissing = false;
  });

  assert.equal(calls.filter((c) => c.directWrite).length, 0, 'the pages never write the table directly');
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`\n${passed} steps passed`);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await browser.close();
  noCspViolations();
}
process.exit(exitCode);
