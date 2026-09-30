// End-to-end check of the production pages (editor.html, shoot.html) against an
// in-memory fake of Supabase that applies the same who-sees-what rule as the
// database (20260930130000_assignment_rls.sql), with the browser's clock fixed per
// scene in Israel time:
//   - Nadia on a 360px phone: lands on her page, sees only her client, day 1 of 3 and
//     both dates in words, the business phone (never the client's own), and walks
//     the four buttons: the drive with its 4 checks, a missing logo ("חסום" and
//     back), the self-check, Ofir's per-video fixes, the client's fixes, the final
//     versions to Ilai, and the card closes when Ilai marks "קיבלתי".
//   - Nirel: an urgent brief while editing asks "לעצור את העריכה?" prefilled, the
//     pause says "עצירה לבקשת ליאור", finishing the brief records what was done and
//     opens the follow-ups; resuming closes the pause notices.
//   - Lior sends the briefing with the drive label; Eli, the evening before: the
//     briefing's "קיבלתי" and the gear list; on the day: "הגעתי", the drive, the
//     B-roll "לא", the locked handoff; Lior's shoot-day mode: quiet mode, counter,
//     the closing lock, and the day closed.
// Run: npx http-server -p 8121 -s . &  then  BASE_URL=http://localhost:8121/ node tests/production-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { importKeys } from '../app/client-open.js';
import { PROCESSES } from '../app/protocol.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const T = (s) => new Date(`${s}+03:00`); // Israel summer time (October 2026)
let clockNow = T('2026-10-19T10:00:00'); // the scene's time; the database's clock follows it
let clockSetAt = Date.now();
const serverNow = () => new Date(clockNow.getTime() + (Date.now() - clockSetAt)).toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;

// ── People ────────────────────────────────
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nirel: 'nirel', nadia: 'nadia', yariv: 'yariv', eli: 'eli' };
const users = new Map(Object.keys(PEOPLE).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(PEOPLE).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: false, phone: k === 'eli' ? '972500000009' : null }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const staffOf = (u) => (u ? staff.find((s) => s.email === u.email) || null : null);
const isOffice = (s) => !!s && (s.person === null || ['irit', 'lior', 'ofir', 'ilai'].includes(s.person));

// ── Clients ───────────────────────────────
const client = (id, fields) => ({
  id, name: '', business: null, address: null, phone: null, package_name: null, shoot_type: 'dms', characterizer: 'ofir',
  has_logo: true, editor_name: null, editor: null, deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-10-05T10:00:00+03:00', shoot_at: null,
  contract_end: '2027-09-01', status: 'active', notes: 'הערה פנימית של המשרד', quote_id: null, created_at: '2026-09-01T09:00:00+03:00',
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: { videos: 4, shoot_days: 1 }, rounds: [], verified_at: null, verified_by: null, closed_reason: null,
  ...fields,
});
const A = client('aaaaaaaa-0000-4000-8000-000000000001', {
  name: 'מספרת רון', business: 'רון עיצוב שיער', address: 'הרצל 10, תל אביב', phone: '050-1234567', editor: 'nadia', shoot_at: '2026-10-15T11:00:00+03:00',
  links: { drive: 'https://drive.google.com/drive/a', scripts: 'https://docs.google.com/document/a', dropbox: 'https://www.dropbox.com/a' },
});
const B = client('bbbbbbbb-0000-4000-8000-000000000002', { name: 'קפה גולן', phone: '052-7654321', editor: 'yariv', shoot_at: '2026-10-14T11:00:00+03:00' });
const N = client('cccccccc-0000-4000-8000-000000000003', { name: 'סטודיו נטלי', shoot_type: 'natali', editor: 'nirel', shoot_at: '2026-10-15T11:00:00+03:00', phone: '053-0000000' });
const Tc = client('dddddddd-0000-4000-8000-000000000004', { name: 'פיצה נאפולי', phone: '054-1111111' });
const S = client('eeeeeeee-0000-4000-8000-000000000005', { name: 'מאפיית שי', address: 'הנביאים 5, חיפה', phone: '055-2222222', shoot_at: '2026-10-22T11:00:00+03:00' });

const imported = (c, station) => importKeys(station).map((k) => ({ client_id: c.id, item_key: k, state: 'done', note: 'ייבוא', by_email: 'irit@astrateg.test', at: '2026-09-02T09:00:00+03:00' }));
const itemsOf = (ids) => new Set(PROCESSES.filter((p) => ids.includes(p.id)).flatMap((p) => p.items.map((i) => i.key)));
const EDITING = itemsOf(['p22a', 'p22', 'p24', 'p25', 'p26', 'p27']);
const SHOOTDAY = itemsOf(['p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p20', 'p21']);
const check = (c, key, at, note = null, by = 'ofir@astrateg.test') => ({ client_id: c.id, item_key: key, state: 'done', note, by_email: by, at: T(at).toISOString() });
const db = {
  staff,
  clients: [A, B, N, Tc, S],
  protocol_checks: [
    ...imported(A, 'post').filter((r) => !EDITING.has(r.item_key)),
    check(A, 'p22a.assigned', '2026-10-18T10:00:00'),
    check(A, 'p19b.notes', '2026-10-15T16:00:00', 'בסרטון 2 יש שתי גרסאות. הסאונד בסרטון 3 מהמיקרופון השני.', 'eli@astrateg.test'),
    check(A, 'p12a.t.messages', '2026-10-06T10:00:00', 'להגיד שיש חניה חינם', 'lior@astrateg.test'),
    check(A, 'p12a.t.dont', '2026-10-06T10:00:00', 'לא להזכיר מחירים', 'lior@astrateg.test'),
    ...imported(B, 'post').filter((r) => !EDITING.has(r.item_key)), check(B, 'p22a.assigned', '2026-10-18T10:00:00'),
    ...imported(N, 'post').filter((r) => !EDITING.has(r.item_key)), check(N, 'p22a.assigned', '2026-10-18T10:00:00'),
    ...imported(Tc, 'ongoing'),
    ...imported(S, 'shoot').filter((r) => !SHOOTDAY.has(r.item_key)),
  ],
  client_tasks: [
    { id: randomUUID(), client_id: Tc.id, title: 'תיקון באנר לקמפיין', owner: 'nirel', due_on: '2026-10-19', done_at: null, done_by_email: null, created_by_email: 'lior@astrateg.test', created_at: T('2026-10-19T09:00:00').toISOString(), source: null, urgent: true, started_at: null, result: null, brief: { problem: 'הבאנר לא קריא', change: 'להגדיל כותרת', keep: 'הצבעים', result: 'באנר קריא בטלפון' } },
  ],
  characterizations: [{ client_id: A.id, fields: { business_phone: '03-5551234', logo_link: 'https://drive.google.com/logo-a' } }],
  protocol_log: [], push_subscriptions: [], reminder_log: [],
};

// Who sees which client (the database's rule, 20260930130000_assignment_rls.sql).
const inShootWindow = (c) => [c.shoot_at, ...(c.rounds || []).map((r) => r.shoot_at)].filter(Boolean)
  .some((at) => { const d = (new Date(at) - clockNow) / 864e5; return d >= -8 && d <= 31; });
function sees(me, c) {
  if (!me || !c) return false;
  if (isOffice(me)) return true;
  const p = me.person;
  if (c.editor === p || (c.rounds || []).some((r) => r.editor === p)) return true;
  if (db.client_tasks.some((t) => t.client_id === c.id && t.owner === p && (!t.done_at || clockNow - new Date(t.done_at) < 30 * 864e5))) return true;
  if (p === 'nirel' && c.shoot_type === 'natali') return true;
  return p === 'eli' && inShootWindow(c);
}
function visibleRows(me, table) {
  const rows = db[table];
  if (table === 'clients') return rows.filter((c) => sees(me, c));
  if (['protocol_checks', 'protocol_log', 'client_tasks', 'characterizations'].includes(table)) return rows.filter((r) => sees(me, db.clients.find((c) => c.id === r.client_id)));
  if (table === 'push_subscriptions' || table === 'reminder_log') return [];
  return rows;
}

function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith('neq.')) out = out.filter((r) => String(r[k]) !== v.slice(4));
    else if (v.startsWith('gte.')) out = out.filter((r) => String(r[k]) >= v.slice(4));
    else if (v.startsWith('in.(')) { const set = new Set(v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, ''))); out = out.filter((r) => set.has(String(r[k]))); }
    else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    else if (v === 'not.is.null') out = out.filter((r) => r[k] !== null && r[k] !== undefined);
  }
  return out;
}
// Only the columns asked for (so a page that never asks for the client's phone never gets it).
function project(rows, select) {
  if (!select || select === '*') return rows;
  const cols = select.split(',').map((s) => s.trim()).filter(Boolean);
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
}
const clientReads = []; // [person, the columns asked for]

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const headers = req.headers();
  const json = (status, data) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
  });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
  }
  const who = userOf(headers);
  if (p === '/auth/v1/user') return who ? json(200, who) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  const me = staffOf(who);
  const now = serverNow();
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me);
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { message: 'not found' });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length === 1 ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })) : json(200, rows));
  const rls = () => json(403, { code: '42501', message: `new row violates row-level security policy for table "${table}"` });
  const visibleClient = (id) => sees(me, db.clients.find((c) => c.id === id));
  if (req.method() === 'GET') {
    if (table === 'clients') clientReads.push([me.person, url.searchParams.get('select')]);
    let rows = applyFilters(visibleRows(me, table), url.searchParams);
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    rows = rows.slice(off, off + lim);
    return reply(table === 'clients' ? project(rows, url.searchParams.get('select')) : rows);
  }
  if (req.method() === 'POST' && table === 'protocol_checks') {
    const list = Array.isArray(body) ? body : [body];
    if (!list.every((r) => visibleClient(r.client_id))) return rls();
    const out = [];
    for (const r of list) {
      const row = { client_id: r.client_id, item_key: r.item_key, state: r.state, note: r.note ?? null, by_email: me.email, at: now };
      const i = db.protocol_checks.findIndex((x) => x.client_id === r.client_id && x.item_key === r.item_key);
      if (i >= 0) db.protocol_checks[i] = row; else db.protocol_checks.push(row);
      db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: r.state, note: row.note, by_email: me.email, at: now });
      out.push(row);
    }
    return reply(out);
  }
  if (req.method() === 'DELETE' && table === 'protocol_checks') {
    const rows = applyFilters(visibleRows(me, table), url.searchParams);
    db.protocol_checks = db.protocol_checks.filter((r) => !rows.includes(r));
    for (const r of rows) db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: 'clear', note: null, by_email: me.email, at: now });
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  if (req.method() === 'POST' && table === 'client_tasks') {
    const list = Array.isArray(body) ? body : [body];
    if (!list.every((r) => visibleClient(r.client_id))) return rls();
    const out = list.map((b) => ({ due_on: null, done_at: null, done_by_email: null, source: null, brief: null, urgent: false, started_at: null, result: null, ...b, id: randomUUID(), created_by_email: me.email, created_at: now }));
    db.client_tasks.push(...out);
    return reply(out);
  }
  if (req.method() === 'PATCH' && table === 'client_tasks') {
    const rows = applyFilters(visibleRows(me, table), url.searchParams);
    for (const r of rows) {
      // Only its owner (or the office) records how a task ended (20260930140000_production.sql).
      if ('result' in body && r.owner !== me.person && !isOffice(me)) return json(400, { code: 'P0001', message: "not allowed: only the task's owner records how it ended" });
      if ('done_at' in body) { r.done_at = body.done_at ? (r.done_at || now) : null; r.done_by_email = body.done_at ? me.email : null; }
      if ('started_at' in body) r.started_at = body.started_at ? now : null;
      if ('result' in body) r.result = body.result;
    }
    return reply(rows);
  }
  return json(405, { message: 'not in this fake' });
}

// ── Browser ───────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function scene(at, viewport = { width: 360, height: 780 }) {
  clockNow = T(at);
  clockSetAt = Date.now();
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, hasTouch: viewport.width < 500 });
  await ctx.clock.install({ time: clockNow });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', fakeSupabase);
  for (const host of ['https://wa.me/**', 'https://waze.com/**', 'https://www.google.com/**', 'https://drive.google.com/**', 'https://docs.google.com/**', 'https://www.dropbox.com/**']) {
    await ctx.route(host, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>x</title>' }));
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  return { ctx, page };
}
async function signIn(page, path, person) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${person}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const text = (page, sel) => page.locator(sel).innerText();
const toastHas = (page, s) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), s);
const checkOf = (c, key) => db.protocol_checks.find((x) => x.client_id === c.id && x.item_key === key) || null;
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const height = (page, sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().height);
const set = (c, key, note = null, by = 'ofir@astrateg.test') => {
  const row = { client_id: c.id, item_key: key, state: 'done', note, by_email: by, at: serverNow() };
  const i = db.protocol_checks.findIndex((x) => x.client_id === c.id && x.item_key === key);
  if (i >= 0) db.protocol_checks[i] = row; else db.protocol_checks.push(row);
  db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: c.id, item_key: key, action: 'done', note, by_email: by, at: row.at });
};
const reload = async (page) => { await page.click('#btn-refresh'); await page.waitForTimeout(150); };

let passed = 0;
let nirelPage;
let eliPage;
async function step(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}\n${err.stack}`);
    await browser.close();
    process.exit(1);
  }
}

// ── Nadia, an editor, on her phone ────────
const nadia = await scene('2026-10-19T10:00:00');
const card = '#c-aaaaaaaa-0000-4000-8000-000000000001';
const A_ID = 'c-aaaaaaaa-0000-4000-8000-000000000001';

await step('an editor lands on "הלקוחות שלי בעריכה" and sees only her client, day 1 of 3 and both dates in words', async () => {
  const { page } = nadia;
  await signIn(page, 'clients.html', 'nadia');
  await page.waitForURL(/editor\.html/);
  await page.waitForSelector(card);
  assert.equal(await text(page, 'h1'), 'הלקוחות שלי בעריכה');
  assert.equal(await page.locator('.ed-card').count(), 1); // not Yariv's client
  assert.match(await text(page, `${card} .ed-day`), /^יום 1 מתוך 3$/);
  assert.equal(await text(page, `${card} .ed-dates`), 'אצל אופיר עד רביעי 18:00 · סגירה עד חמישי');
  assert.match(await text(page, `${card} .ed-facts`), /4 סרטונים לפי החבילה/);
  assert.match(await text(page, `${card} .ed-facts`), /צריך גם Dropbox/);
  assert.equal(await page.locator(`${card} .ed-links a`).count(), 3);
  assert.equal(await page.locator(`${card} a:has-text("לוגו להורדה")`).getAttribute('href'), 'https://drive.google.com/logo-a');
  assert.match(await text(page, `${card} .ed-phone`), /03-5551234/);
  assert.match(await text(page, `${card} .ed-closing`), /לפרטים נוספים התקשרו: 03-5551234/);
  assert.match(await text(page, card), /בסרטון 2 יש שתי גרסאות/); // Eli's notes
  assert.match(await text(page, card), /להגיד שיש חניה חינם/);
  assert.match(await text(page, card), /לא להזכיר מחירים/);
  assert.equal(await text(page, `${card} .ed-state`), 'ממתין לכונן');
  // Never the client's own phone, nor the office's notes: not on the page and not even asked for.
  const html = await page.content();
  assert.ok(!html.includes('050-1234567') && !html.includes('הערה פנימית'), 'no private phone or office notes');
  assert.ok(clientReads.filter(([p]) => p === 'nadia').every(([, cols]) => cols && !/\bphone\b/.test(cols.replace('business_phone', '')) && !/\bnotes\b/.test(cols)), JSON.stringify(clientReads));
  await page.click(`#${A_ID}-cp-closing`);
  await toastHas(page, 'נוסח הסגיר הועתק');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'לפרטים נוספים התקשרו: 03-5551234');
  assert.ok(await noHScroll(page), 'no horizontal scroll at 360px');
  assert.ok(await height(page, `#${A_ID}-go`) >= 44);
  await shot(page, 'editor-360');
});

await step('(1) the drive arrived: the 4 checks are required; "קיבלתי את הכונן והתחלתי"', async () => {
  const { page } = nadia;
  await page.click(`#${A_ID}-go`);
  await page.waitForSelector('#dlg-start[open]');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'start-0');
  await page.click('#start-0');
  await page.click('#start-submit');
  assert.match(await text(page, '#start-err'), /סמנו את ארבע הבדיקות/);
  for (const i of [1, 2, 3]) await page.click(`#start-${i}`);
  await page.click('#start-submit');
  await toastHas(page, 'התחלת');
  for (const k of ['p22.received', 'p22.check.footage', 'p22.check.scripts', 'p22.check.logo', 'p22.check.phone']) assert.ok(checkOf(A, k), k);
  assert.equal(await text(page, `${card} .ed-state`), 'בעריכה');
  assert.equal(await page.evaluate(() => document.activeElement.id), `${'c-aaaaaaaa-0000-4000-8000-000000000001'}-go`);
});

await step('"חסר לוגו / טלפון / חומר": Irit is told, the deadline shows "חסום"; "הגיע, ממשיכים" ends it and moves the dates', async () => {
  const { page } = nadia;
  await page.click(`#${A_ID}-missing`);
  await page.waitForSelector('#dlg-missing[open]');
  await page.click('#miss-submit');
  assert.match(await text(page, '#miss-err'), /סמנו מה חסר/);
  await page.click('#miss-logo');
  await page.fill('#miss-note', 'הלוגו בכרטיס מטושטש');
  await page.click('#miss-submit');
  await toastHas(page, 'עירית קיבלה הודעה');
  assert.deepEqual(JSON.parse(checkOf(A, 'p22.missing').note), { what: ['logo'], note: 'הלוגו בכרטיס מטושטש' });
  for (const k of ['p22.wait', 'p24.wait', 'p27.wait']) assert.match(JSON.parse(checkOf(A, k).note).reason, /^חסר לעורך: לוגו$/, k);
  assert.equal(await text(page, `${card} .ed-state`), 'חסום');
  assert.match(await text(page, `${card} .ed-dates`), /^חסום · חסר לוגו/);
  await shot(page, 'editor-blocked');
  // Two office hours later the logo came.
  clockNow = new Date(clockNow.getTime() + 2 * 36e5);
  clockSetAt = Date.now();
  await page.click(`#${A_ID}-unblock`);
  await toastHas(page, 'ממשיכים');
  for (const k of ['p22.wait', 'p24.wait', 'p27.wait', 'p22.missing']) assert.equal(checkOf(A, k), null, k);
  for (const k of ['p22.waited', 'p24.waited']) assert.ok(checkOf(A, k), k);
  assert.equal(await text(page, `${card} .ed-state`), 'בעריכה');
});

await step('(2) "מוכן לבדיקה": the self-check (with Dropbox), then Ofir is told and his clock starts', async () => {
  const { page } = nadia;
  await page.click(`#${A_ID}-go`);
  await page.waitForSelector('#dlg-ready[open]');
  assert.equal(await page.locator('#ready-list .prod-check').count(), 6);
  assert.match(await text(page, '#ready-list'), /Dropbox/);
  await page.click('#ready-0');
  await page.click('#ready-submit');
  assert.match(await text(page, '#ready-err'), /עוד לא סומן/);
  for (const i of [1, 2, 3, 4, 5]) await page.click(`#ready-${i}`);
  await page.click('#ready-submit');
  await toastHas(page, 'נשלח לאופיר');
  for (const k of ['p22.edited', 'p22.self.spelling', 'p22.self.closing', 'p22.self.broll', 'p22.self.complete', 'p24.drive', 'p24.dropbox', 'p24.notify']) assert.ok(checkOf(A, k), k);
  assert.equal(await text(page, `${card} .ed-state`), 'אצל אופיר לבקרה');
  await page.waitForSelector('#handoff:not([hidden])');
  assert.match(await text(page, '#handoff'), /אופיר/);
});

await step('(3) Ofir\'s fixes, per video: "תוקן" and then the rest; it goes back to Ofir', async () => {
  const { page } = nadia;
  clockNow = new Date(clockNow.getTime() + 36e5);
  clockSetAt = Date.now();
  set(A, 'p25.return', JSON.stringify({ round: 1, due: T('2026-10-19T17:00:00').toISOString(), videos: [{ n: 2, text: 'שגיאת כתיב בכתובית' }, { n: 3, text: 'הסגיר בלי טלפון' }] }));
  await reload(page);
  assert.equal(await text(page, `${card} .ed-state`), 'תיקונים מאופיר');
  assert.match(await text(page, `${card} .ed-fixes-h`), /אופיר החזיר לתיקון · סבב 1 · עד היום 17:00/);
  await page.click(`#${A_ID}-fix-2`);
  await toastHas(page, 'סרטון 2 תוקן');
  assert.deepEqual(JSON.parse(checkOf(A, 'p24.fixed').note), { round: 1, videos: [2] });
  assert.equal(await text(page, `#${A_ID}-go`), 'סמן את השאר תוקן (1)');
  const before = checkOf(A, 'p24.notify').at;
  await page.click(`#${A_ID}-go`);
  await toastHas(page, 'חזרו לאופיר');
  assert.notEqual(checkOf(A, 'p24.notify').at, before);
  assert.equal(await text(page, `${card} .ed-state`), 'אצל אופיר לבקרה');
});

await step('the client\'s fixes, then (4) the final versions go to Ilai; the card closes when he marks "קיבלתי"', async () => {
  const { page } = nadia;
  set(A, 'p25.approved');
  set(A, 'p26.sent', null, 'irit@astrateg.test');
  await reload(page);
  assert.equal(await text(page, `${card} .ed-state`), 'אצל הלקוח לאישור');
  assert.equal(await page.locator(`#${A_ID}-go`).count(), 0); // button 4 not before the client
  set(A, 'p27.notes', JSON.stringify({ videos: [{ n: 1, text: 'להחליף את השיר' }] }), 'irit@astrateg.test');
  await reload(page);
  assert.equal(await text(page, `${card} .ed-state`), 'תיקוני הלקוח');
  await page.click(`#${A_ID}-go`);
  await toastHas(page, 'כל תיקוני הלקוח סומנו');
  assert.ok(checkOf(A, 'p27.fixes'));
  assert.equal(await text(page, `#${A_ID}-go`), 'תיקונים הושלמו, הגרסאות הסופיות בדרייב');
  await page.click(`#${A_ID}-go`);
  await toastHas(page, 'עברו לעילאי');
  assert.ok(checkOf(A, 'p27.final') && checkOf(A, 'p27.toilai'));
  assert.equal(await text(page, `${card} .ed-state`), 'אצל עילאי');
  // Ilai marks "קיבלתי" in the client card: on his own process 28 (his view shows only his).
  const ilai = await scene('2026-10-19T15:00:00', { width: 1280, height: 900 });
  await signIn(ilai.page, `client.html?id=${A.id}#p28`, 'ilai');
  await ilai.page.waitForSelector('#p28-ilai');
  assert.match(await text(ilai.page, '#p28'), /הגרסאות הסופיות עברו לעילאי/);
  await ilai.page.click('#p28-ilai');
  await ilai.page.waitForFunction(() => /עילאי קיבל את הגרסאות הסופיות/.test(document.getElementById('p28')?.textContent || ''));
  assert.equal(checkOf(A, 'p27.ilai').by_email, 'ilai@astrateg.test');
  await ilai.ctx.close();
  await reload(page);
  assert.equal(await page.locator('.ed-card').count(), 0);
  assert.match(await text(page, '#ed-list'), /אין כרגע לקוח בעריכה אצלך/);
  assert.match(await text(page, '#ed-stats'), /הנתונים שלי/);
  assert.match(await text(page, '#ed-stats'), /עברו בקרה בפעם הראשונה/);
  assert.match(await text(page, '#ed-stats'), /2 מתוך 4 סרטונים/); // videos 2 and 3 came back the first time
  assert.doesNotMatch(await text(page, '#ed-stats'), /יריב|נדיה/); // her own numbers, no ranking
  await nadia.ctx.close();
});

// ── Nirel: her Natali client and the briefs ──
await step('Nirel: an urgent brief while editing asks to pause, prefilled; the pause says "עצירה לבקשת ליאור"', async () => {
  const { page, ctx } = await scene('2026-10-19T11:00:00');
  await signIn(page, 'editor.html', 'nirel');
  await page.waitForSelector('#c-cccccccc-0000-4000-8000-000000000003');
  assert.equal(await text(page, 'h1'), 'העריכה והבריפים שלי');
  assert.equal(await page.locator('.ed-card').count(), 1);
  assert.match(await text(page, '#ed-briefs'), /בריפים/);
  assert.match(await text(page, '#ed-briefs'), /תיקון באנר לקמפיין/);
  assert.match(await text(page, '#ed-briefs'), /ביקש\/ה: ליאור/);
  // Imported history is not Eli's notes nor a 12א point.
  assert.doesNotMatch(await page.locator('#c-cccccccc-0000-4000-8000-000000000003').textContent(), /ייבוא/);
  assert.match(await page.locator('#c-cccccccc-0000-4000-8000-000000000003').textContent(), /עוד לא נרשמו דגשים/); // folded
  const nc = 'c-cccccccc-0000-4000-8000-000000000003';
  // Start the editing first (all four checks).
  await page.click(`#${nc}-go`);
  for (const i of [0, 1, 2, 3]) await page.click(`#start-${i}`);
  await page.click('#start-submit');
  await toastHas(page, 'התחלת');
  const t = db.client_tasks[0];
  await page.click(`#t-${t.id}-start`);
  await page.waitForSelector('#dlg-urgent[open]');
  assert.match(await text(page, '#urg-ctx'), /לעצור את העריכה של סטודיו נטלי\?/);
  assert.equal(await page.inputValue('#urg-0-stage'), 'בעריכה · יום 1 מתוך 3');
  assert.equal(await page.inputValue('#urg-0-left'), '4 סרטונים, אצל אופיר עד רביעי 18:00');
  await shot(page, 'nirel-urgent');
  await page.click('#urg-submit');
  await toastHas(page, 'העריכה נעצרה לבקשת ליאור');
  const pause = JSON.parse(checkOf(N, 'p22.pause').note);
  assert.deepEqual([pause.for, pause.task, pause.why], ['lior', t.id, t.title]);
  assert.ok(t.started_at, 'the task is started');
  const notices = db.client_tasks.filter((x) => x.source === 'pause' && x.client_id === N.id);
  assert.deepEqual(notices.map((x) => x.owner).sort(), ['lior', 'ofir']);
  assert.match(notices[0].title, /\(לבקשת ליאור\)$/);
  assert.match(await text(page, `#${nc} .ed-pause`), /^עצירה לבקשת ליאור/);
  assert.ok(await noHScroll(page));
  nirelPage = { page, ctx, nc, t };
});
await step('Nirel finishes the brief: done, left and the Drive link; the requester\'s follow-up and Ofir\'s check open', async () => {
  const { page, t } = nirelPage;
  await page.click(`#t-${t.id}-done`);
  await page.waitForSelector('#dlg-done[open]');
  assert.equal(await page.isChecked('#done-client'), true);
  await page.click('#done-submit');
  assert.match(await text(page, '#done-done-err'), /מה בוצע/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'done-done');
  await page.fill('#done-done', 'הכותרת הוגדלה');
  await page.fill('#done-left', 'גרסה לסטורי');
  await page.fill('#done-drive', 'drive.google.com/x');
  await page.click('#done-submit');
  assert.match(await text(page, '#done-drive-err'), /https/);
  await page.fill('#done-drive', 'https://drive.google.com/drive/banner');
  await page.click('#done-submit');
  await toastHas(page, 'ליאור מקבל/ת הודעה ומשימת המשך; אופיר בודק ועירית שולחת');
  assert.ok(t.done_at);
  assert.deepEqual([t.result.done, t.result.left, t.result.drive, t.result.client], ['הכותרת הוגדלה', 'גרסה לסטורי', 'https://drive.google.com/drive/banner', true]);
  const follow = db.client_tasks.find((x) => x.owner === 'lior' && x.title.startsWith('המשך אחרי ניראל'));
  assert.equal(follow.due_on, '2026-10-20');
  const check = db.client_tasks.find((x) => x.owner === 'ofir' && x.title.startsWith('לבדוק לפני שליחה ללקוח'));
  assert.deepEqual([check.brief.route, check.brief.materials], ['irit', 'https://drive.google.com/drive/banner']);
  assert.match(await text(page, '#ed-briefs'), /אין בריפים פתוחים/);
});

await step('resuming the editing closes the pause notices by themselves', async () => {
  const { page, ctx, nc } = nirelPage;
  await page.click(`#${nc}-resume`);
  await toastHas(page, 'חזרת לעריכה');
  assert.equal(checkOf(N, 'p22.pause'), null);
  assert.ok(db.client_tasks.filter((x) => x.source === 'pause').every((x) => x.done_at));
  assert.equal(await text(page, `#${nc} .ed-state`), 'בעריכה');
  await ctx.close();
});

// ── The briefing, the evening before ──────
const sCard = '#s-eeeeeeee-0000-4000-8000-000000000005';
const S_ID = 's-eeeeeeee-0000-4000-8000-000000000005';
await step('Lior sends the 17:00 briefing to Eli with the drive label', async () => {
  const { page, ctx } = await scene('2026-10-21T16:50:00');
  await signIn(page, 'shoot.html', 'lior');
  const b = '#b-eeeeeeee-0000-4000-8000-000000000005';
  await page.waitForSelector(b);
  assert.equal(await text(page, 'h1'), 'מצב יום צילום');
  assert.match(await text(page, b), /יום חמישי 22\.10: מאפיית שי · הגעה 10:00 \(המשפיענים 11:00\) · הנביאים 5, חיפה · 4 תסריטים/);
  await page.click(`${b}-send`);
  assert.match(await text(page, `${b}-err`), /תווית הכונן/);
  await page.fill(`${b}-label`, 'כונן 3');
  await page.fill(`${b}-notes`, 'חניה מאחורי המאפייה');
  await page.click(`${b}-send`);
  await toastHas(page, 'התדריך נשלח לאלי');
  assert.deepEqual(JSON.parse(checkOf(S, 'p16.brief').note), { label: 'כונן 3', notes: 'חניה מאחורי המאפייה' });
  assert.ok(checkOf(S, 'p16.drive') && checkOf(S, 'p16.early'));
  assert.match(await text(page, b), /אלי עוד לא אישר/);
  assert.match(await page.locator(`${b} a:has-text("גם בוואטסאפ")`).getAttribute('href'), /^https:\/\/wa\.me\/972500000009\?text=/);
  assert.ok(await noHScroll(page));
  await ctx.close();
});

await step('Eli lands on "ימי הצילום שלי": his arrival, the scripts, the label, navigation; "קיבלתי" and the gear list', async () => {
  const { page, ctx } = await scene('2026-10-21T17:10:00');
  await signIn(page, 'clients.html', 'eli');
  await page.waitForURL(/shoot\.html/);
  await page.waitForSelector(sCard);
  assert.equal(await text(page, 'h1'), 'ימי הצילום שלי');
  assert.equal(await page.locator('.sh-card').count(), 1);
  const facts = await text(page, `${sCard} .sh-facts`);
  assert.match(facts, /10:00 · שעה לפני המשפיענים \(11:00\)/);
  assert.match(facts, /4 סרטונים/);
  assert.match(facts, /כונן 3/);
  assert.match(await page.locator(`${sCard} a:has-text("Waze")`).getAttribute('href'), /^https:\/\/waze\.com\/ul\?q=/);
  assert.ok(!(await page.content()).includes('055-2222222'), 'no client phone for Eli');
  assert.match(await text(page, `${sCard} .sh-brief`), /חניה מאחורי המאפייה/);
  await page.click(`#${S_ID}-ack`);
  await page.waitForSelector(`${sCard} .sh-brief .note-ok`);
  assert.ok(checkOf(S, 'p16.photographer'));
  // The gear list: all four, then one mark.
  for (const g of ['batteries', 'cards', 'mics']) await page.click(`#${S_ID}-gear-${g}`);
  assert.equal(checkOf(S, 'p17b.gear'), null);
  await page.click(`#${S_ID}-gear-lights`);
  await toastHas(page, 'הציוד מוכן');
  assert.ok(checkOf(S, 'p17b.gear'));
  assert.ok(await noHScroll(page));
  await shot(page, 'eli-eve');
  await ctx.close();
});

// ── The shoot day ─────────────────────────
await step('Eli on the day: "הגעתי", the drive, "הבי־רול לא גמור"; the handoff is locked until the list is done', async () => {
  const { page, ctx } = await scene('2026-10-22T09:55:00');
  await signIn(page, 'shoot.html', 'eli');
  await page.waitForSelector(`#${S_ID}-arrived`);
  assert.ok(await height(page, `#${S_ID}-arrived`) >= 48);
  await page.click(`#${S_ID}-arrived`);
  await page.waitForSelector(`#${S_ID}-drive`);
  assert.equal(await text(page, `#${S_ID}-drive`), 'קיבלתי כונן 3');
  assert.ok(checkOf(S, 'p17b.arrived'));
  await page.click(`#${S_ID}-drive`);
  await page.waitForSelector(`#${S_ID}-no`);
  assert.equal(checkOf(S, 'p17b.drive').note, 'כונן 3');
  await page.click(`#${S_ID}-no`);
  await toastHas(page, 'ליאור קיבל הודעה');
  assert.equal(checkOf(S, 'p17b.brollq').note, 'no');
  assert.equal(checkOf(S, 'p17b.broll'), null);
  // The finish list and the locked handoff.
  assert.equal(await page.isDisabled(`#${S_ID}-handed`), true);
  for (const i of [0, 1, 2]) { await page.click(`#${S_ID}-fin-${i}`); await page.waitForTimeout(80); }
  assert.equal(await page.isDisabled(`#${S_ID}-handed`), true);
  assert.match(await text(page, `#${S_ID}-lock`), /נפתח אחרי הפריט שנשאר/);
  await page.click(`#${S_ID}-fin-3`);
  await page.waitForFunction((id) => !document.getElementById(id).disabled, `${S_ID}-handed`);
  await page.fill(`#${S_ID}-notes`, 'בסרטון 4 שתי גרסאות');
  await page.click(`#${S_ID}-notes-save`);
  await toastHas(page, 'ההערות נשמרו לעורך');
  assert.equal(checkOf(S, 'p19b.notes').note, 'בסרטון 4 שתי גרסאות');
  clockNow = T('2026-10-22T15:40:00');
  clockSetAt = Date.now();
  await page.click(`#${S_ID}-handed`);
  await page.waitForSelector(`${sCard} .sh-finish .ed-wait`);
  assert.match(await text(page, `${sCard} .sh-finish`), /ממתין שליאור יאשר שקיבל/);
  for (const k of ['p19b.handed', 'p18b.order', 'p18b.quality', 'p18b.numbered']) assert.ok(checkOf(S, k), k);
  assert.ok(await noHScroll(page));
  await shot(page, 'eli-day');
  eliPage = { page, ctx };
});
await step('Lior\'s shoot-day mode: quiet mode from Eli\'s arrival, the timeline, the counter and the closing lock', async () => {
  const { page, ctx } = await scene('2026-10-22T15:45:00');
  await signIn(page, 'shoot.html', 'lior');
  await page.waitForSelector(sCard);
  assert.match(await text(page, `${sCard} .sh-quiet`), /^מצב שקט מאז 09:55 \(אלי הגיע\)/);
  assert.match(await text(page, `${sCard} .sh-timeline`), /10:00\s*אלי מגיע/);
  assert.match(await text(page, `${sCard} .sh-timeline`), /16:30\s*סוף החלון/);
  assert.match(await text(page, `${sCard} .sh-fixed`), /להחזיק את הראיונות על המסר/);
  assert.match(await text(page, `${sCard} .sh-facts`), /בי־רול\s*לא גמור/);
  assert.equal(await text(page, `#${S_ID}-count`), 'צולמו 0 מתוך 4');
  assert.equal(await page.isDisabled(`#${S_ID}-close`), true);
  assert.match(await text(page, `#${S_ID}-lock`), /סרטון המלצה · עוד 4 סרטונים/);
  for (let n = 1; n <= 4; n += 1) {
    assert.equal(await text(page, `#${S_ID}-plus`), `+1 · סרטון ${n}`);
    await page.click(`#${S_ID}-plus`);
    await page.waitForFunction(([id, x]) => document.getElementById(`${id}-count`)?.textContent === `צולמו ${x} מתוך 4`, [S_ID, n]);
  }
  assert.deepEqual(JSON.parse(checkOf(S, 'p18.shot').note), { videos: [1, 2, 3, 4] });
  await page.click(`#${S_ID}-testimonial`);
  await page.waitForFunction((id) => document.getElementById(`${id}-lock`)?.textContent === 'עוד חסר: לא אישרת שהכונן חזר אליך', S_ID);
  assert.ok(checkOf(S, 'p19.testimonial'));
  assert.equal(await text(page, `#${S_ID}-took`), 'אלי מסר את הכונן · קיבלתי');
  await page.click(`#${S_ID}-took`);
  await page.waitForFunction((id) => !document.getElementById(`${id}-close`)?.disabled, S_ID);
  assert.ok(await noHScroll(page));
  await shot(page, 'lior-shoot');
  await page.click(`#${S_ID}-close`);
  await toastHas(page, 'יום הצילום נסגר');
  for (const k of ['p18.order', 'p18.all', 'p19.all', 'p19.drive', 'p19.took', 'p19.testimonial']) assert.ok(checkOf(S, k), k);
  assert.match(await text(page, sCard), /יום הצילום נסגר/);
  await ctx.close();
  // Eli sees the handoff confirmed and may format the cards.
  await reload(eliPage.page);
  assert.match(await text(eliPage.page, `${sCard} .sh-finish`), /המסירה אושרה\. אפשר לפרמט את הכרטיסים של מאפיית שי, כונן 3/);
  await eliPage.ctx.close();
});

await step('who sees what: the office watches the shoot without buttons; an editor has no shoot page; Eli no editor page', async () => {
  const irit = await scene('2026-10-22T12:00:00', { width: 1280, height: 900 });
  await signIn(irit.page, 'shoot.html', 'irit');
  await irit.page.waitForSelector(sCard);
  assert.equal(await irit.page.isDisabled(`#${S_ID}-plus`), true);
  assert.match(await text(irit.page, '#sh-sub'), /לצפייה/);
  await irit.ctx.close();
  const yariv = await scene('2026-10-22T12:00:00');
  await signIn(yariv.page, 'shoot.html', 'yariv');
  await yariv.page.waitForSelector('#no-access:not([hidden])');
  await yariv.ctx.close();
  const eli = await scene('2026-10-22T12:00:00');
  await signIn(eli.page, 'editor.html', 'eli');
  await eli.page.waitForSelector('#no-access:not([hidden])');
  // "מה עליי" stays one tap away, without a loop back.
  await eli.page.goto(`${BASE}clients.html#mine`);
  await eli.page.waitForSelector('#app:not([hidden])');
  assert.match(eli.page.url(), /clients\.html#mine$/);
  await eli.ctx.close();
});

await browser.close();
assert.deepEqual(errors, []);
console.log(`\n${passed} production checks passed.`);
