// End-to-end check of the shoot-day table (owner.html#shoots, "טבלת ימי צילום") against
// an in-memory fake of Supabase (the browser's clock fixed on Tuesday 20.10.2026, 10:00
// in Israel):
//  - Lior, Ofir and the owner: the menu entry, the tab, a row per active client.
//  - The default order: the oldest last shoot day first (also for clients imported with
//    their shoot history), a client shot with no date after them, and "טרם צולמו" below
//    by the deal date. An ended client and an archived one are not in it.
//  - A click on a header sorts; the search; the link to the client's card.
//  - Read-only: the page sends no write at all.
//  - Irit has no entry and no tab; an editor and a sales agent get "אין לך גישה".
//  - 360px phones: cards, no sideways scroll (not in the page, not inside the table),
//    44px targets, the first 12 and "הצג עוד".
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/shoot-table-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { importKeys } from '../app/client-open.js';
import { packageDeliverables } from '../app/protocol-logic.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const NOW = new Date('2026-10-20T10:00:00+03:00'); // Tuesday
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;

// ── People ────────────────────────────────
const people = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', nadia: 'nadia', stav: 'stav' };
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: false, phone: null }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => { const r = staff.find((x) => x.email === u?.email); return r ? r.person : undefined; };
const isOffice = (u) => { const p = personOf(u); return p === null || ['irit', 'lior', 'ofir', 'ilai'].includes(p); };

// ── Clients ───────────────────────────────
const DELIV = packageDeliverables({ package: { id: 'social-tv-simeon' }, selection: { paid: ['simeon-day'], free: {} } }); // 3 shoot days
let seq = 0;
const client = (fields) => ({
  id: `${String(seq += 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
  name: '', business: null, address: null, phone: null, package_name: 'Social + TV all in one · סמיון, מישל ודניס', shoot_type: 'dms', characterizer: 'ofir',
  has_logo: true, editor_name: null, editor: null, deal_at: '2026-01-10T09:00:00+02:00', char_at: '2026-01-12T10:00:00+02:00', shoot_at: null,
  contract_end: '2027-01-10', status: 'active', notes: null, quote_id: null, created_at: '2026-10-06T09:00:00+03:00',
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: DELIV, rounds: [], verified_at: null, verified_by: null, closed_reason: null,
  archived_at: null, archived_by: null,
  ...fields,
});
const checks = [];
const one = (c, key, at, note = null, by = 'irit@astrateg.test') => checks.push({ client_id: c.id, item_key: key, state: 'done', note, by_email: by, at });
// What the import by station writes (the note "ייבוא"), for the first shoot or for a round.
const imported = (c, stationKey, pre = '') => { for (const k of importKeys(stationKey)) one(c, pre + k, '2026-10-06T09:00:00+03:00', 'ייבוא'); };
const P19 = ['p19.all', 'p19.testimonial', 'p19.drive', 'p19.took'];

// Ron: shot on 5.10 and closed by Lior on the day; round 2 is set for 12.11. Nadia edits.
const RON = client({ name: 'רון כהן', business: 'מספרת רון', editor: 'nadia', shoot_at: '2026-10-05T10:00:00+03:00', rounds: [{ n: 2, shoot_at: '2026-11-12T10:00:00+02:00', start_at: '2026-10-19T09:00:00+03:00' }] });
imported(RON, 'shoot');
for (const k of P19) one(RON, k, '2026-10-05T15:00:00+03:00', null, 'lior@astrateg.test');
// Galia: imported from the old CRM in the ongoing station, shot on 10.3 and on 14.7 (round 2).
const GAL = client({ name: 'גליה', business: 'קפה גליה', editor: 'yariv', shoot_type: 'natali', package_name: 'Social all in one · נטלי דדון', shoot_at: '2026-03-10T10:00:00+02:00', rounds: [{ n: 2, shoot_at: '2026-07-14T10:00:00+03:00' }] });
imported(GAL, 'ongoing');
imported(GAL, 'ongoing', 'r2.');
// Avi: imported, shot on 2.2 and never since. The oldest: the head of the table.
const AVI = client({ name: 'אבי', business: 'אבי מוסך', editor_name: 'עורך חיצוני', shoot_at: '2026-02-02T10:00:00+02:00' });
imported(AVI, 'ongoing');
// Tal: imported after its shoot, with no shoot date typed.
const TAL = client({ name: 'טל', business: 'טל פרחים' });
imported(TAL, 'ongoing');
// Ten more imported clients, shot on 1.4 to 10.4 (a long list for the phone).
const MORE = Array.from({ length: 10 }, (_, i) => {
  const c = client({ name: `בעלים ${i + 1}`, business: `עסק ${String(i + 1).padStart(2, '0')}`, shoot_at: `2026-04-${String(i + 1).padStart(2, '0')}T10:00:00+03:00` });
  imported(c, 'ongoing');
  return c;
});
// Never shot. Dan: the deal of 1.9, a shoot set for 28.10. Noa: the older deal (1.8); her date passed and was never closed.
const DAN = client({ name: 'דן', business: 'דן נדל״ן', deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-09-03T10:00:00+03:00', shoot_at: '2026-10-28T10:00:00+03:00' });
imported(DAN, 'content');
const NOA = client({ name: 'נועה', business: 'נועה קוסמטיקה', deal_at: '2026-08-01T09:00:00+03:00', char_at: '2026-08-03T10:00:00+03:00', shoot_at: '2026-10-12T10:00:00+03:00' });
imported(NOA, 'content');
// Not in the table: an ended client (shot long ago) and an archived one.
const ENDED = client({ name: 'גן אירועים', business: 'גן אירועים', status: 'ended', shoot_at: '2025-11-01T10:00:00+02:00', contract_end: '2026-09-01' });
imported(ENDED, 'ongoing');
const ARCHIVED = client({ name: 'בארכיון', business: 'לקוח בארכיון', shoot_at: '2025-12-01T10:00:00+02:00', archived_at: '2026-10-10T09:00:00+03:00', archived_by: 'owner@astrateg.test' });
imported(ARCHIVED, 'ongoing');

const db = {
  staff,
  clients: [RON, GAL, AVI, TAL, ...MORE, DAN, NOA, ENDED, ARCHIVED],
  protocol_checks: checks,
  protocol_log: [], client_tasks: [], office_reviews: [], client_status_notes: [], client_messages: [], client_access: [],
  client_date_changes: [], client_questions: [], quotes: [], client_files: [],
};
const SHOT_ORDER = ['אבי מוסך', ...MORE.map((c) => c.business), 'קפה גליה', 'מספרת רון', 'טל פרחים'];
const NEVER_ORDER = ['נועה קוסמטיקה', 'דן נדל״ן'];
const writes = []; // every request that is not a read: the page must send none

// ── Fake PostgREST ─────────────────────────
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith('neq.')) out = out.filter((r) => String(r[k]) !== v.slice(4));
    else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    else if (v === 'not.is.null') out = out.filter((r) => r[k] !== null && r[k] !== undefined);
    else if (v.startsWith('gte.')) out = out.filter((r) => String(r[k]) >= v.slice(4));
    else if (v.startsWith('like.')) { const re = new RegExp(`^${v.slice(5).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*')}$`); out = out.filter((r) => re.test(String(r[k] ?? ''))); }
    else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')); out = out.filter((r) => set.includes(String(r[k]))); }
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split(',')[0].split('.');
    out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  return out;
}
const archivedIds = () => new Set(db.clients.filter((c) => c.archived_at).map((c) => c.id));
// The functions the pages call only to read (the shell and owner.html ask them for every viewer).
const READ_RPC = new Set(['is_staff', 'can_use_vault', 'manager_client_finance', 'archived_clients', 'clients_private', 'whatsapp_my_consent', 'calendar_feed_status', 'access_status_overview']);

const CLIENT_SHAPE = { clients: () => db.clients, staff: () => db.staff };
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
  const me = userOf(headers);
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p.startsWith('/auth/v1/')) return json(200, {});
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(p)?.[1];
  if (rpc && !READ_RPC.has(rpc)) writes.push(`rpc ${rpc} by ${me?.email}`);
  if (rpc === 'is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
  if (rpc === 'can_use_vault') return json(200, false);
  if (rpc === 'manager_client_finance') return me ? json(200, []) : json(401, { message: 'permission denied' });
  if (rpc === 'archived_clients') {
    return json(200, me && (personOf(me) === null || personOf(me) === 'ofir') ? db.clients.filter((c) => c.archived_at).map((c) => ({
      id: c.id, label: c.business || c.name, name: c.name, business: c.business, package_name: c.package_name, status: c.status, deal_at: c.deal_at,
      contract_end: c.contract_end, archived_at: c.archived_at, archived_by: c.archived_by,
    })) : []);
  }
  if (rpc) return json(404, { code: 'PGRST202', message: `no function ${rpc}` });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { code: '42P01', message: 'not found' });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  if (req.method() === 'GET') {
    let rows = applyFilters(db[table], url.searchParams);
    // The restrictive policy: nothing of an archived client, for anyone.
    const gone = archivedIds();
    if (table === 'clients') rows = rows.filter((r) => !r.archived_at);
    else if (rows.length && 'client_id' in rows[0]) rows = rows.filter((r) => !gone.has(r.client_id));
    // Outside the office: an editor reads only the clients whose editing is theirs; a sales agent none.
    if (!isOffice(me) && table === 'clients') rows = rows.filter((r) => r.editor === personOf(me));
    if (!isOffice(me) && table === 'protocol_checks') { const mine = new Set(db.clients.filter((c) => c.editor === personOf(me)).map((c) => c.id)); rows = rows.filter((r) => mine.has(r.client_id)); }
    if (!isOffice(me) && ['client_messages', 'quotes'].includes(table)) rows = [];
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    return reply(rows.slice(off, off + lim));
  }
  writes.push(`${req.method()} ${table} by ${me.email}`);
  return json(405, { message: `unexpected ${req.method()} on ${table}` });
}

// ── Browser ────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newContext(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, reducedMotion: 'reduce' });
  await ctx.clock.install({ time: NOW });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  return page;
}
async function signIn(page, path, email) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
}
const text = (page, sel) => page.locator(sel).innerText();
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const heads = (page) => page.locator('#sd-head th').allInnerTexts();
const names = (page, group = '') => page.locator(`#sd tbody${group ? `[data-group="${group}"]` : ''} tr[data-id]:not([hidden]) .mt-name`).allInnerTexts();
const cellsOf = (page, c) => page.locator(`#sd tr[data-id="${c.id}"] td`).allInnerTexts();
const ready = (page) => page.waitForSelector('#view-shoots:not([hidden]) #sd tbody tr[data-id]');
let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const lctx = await newContext();
const lior = await newPage(lctx);

await step('Lior: "טבלת ימי צילום" in the menu and as a tab; every active client, the oldest last shoot day on top, "טרם צולמו" below', async () => {
  await signIn(lior, 'owner.html#shoots', 'lior@astrateg.test');
  await ready(lior);
  assert.equal(await text(lior, '#ow-title'), 'טבלת ימי צילום');
  assert.equal(await lior.title(), 'טבלת ימי צילום · astrateg');
  assert.deepEqual(await heads(lior), ['לקוח', 'משפיענים', 'יום צילום אחרון', 'בוצעו', 'יום הצילום הבא', 'תחנה', 'עורך']);
  assert.equal(await lior.getAttribute('#sd-head th:nth-child(3)', 'aria-sort'), 'ascending');
  assert.deepEqual(await names(lior, 'shot'), SHOT_ORDER);
  assert.deepEqual(await names(lior, 'never'), NEVER_ORDER);
  assert.equal(await text(lior, '#sd tbody[data-group="never"] .sd-group'), 'טרם צולמו (2)');
  assert.equal(await lior.locator('#sd tbody[data-group="shot"] .sd-group').count(), 0);
  // The ended client and the archived one are not in it.
  assert.doesNotMatch(await text(lior, '#sd'), /גן אירועים|בארכיון/);
  assert.equal(await text(lior, '#sd-count'), '16 לקוחות · 14 צולמו · 2 טרם צולמו');
  // The menu: its own entry, marked as the page; "כל הלקוחות במבט" is not.
  await lior.waitForSelector('#side-shoot-table[aria-current="page"]');
  assert.equal(await text(lior, '#side-shoot-table'), 'טבלת ימי צילום');
  assert.equal(await lior.getAttribute('#side-overview', 'aria-current'), null);
  assert.equal(await lior.getAttribute('#tab-shoots', 'aria-selected'), 'true');
  assert.equal(await lior.isHidden('#tab-now'), true);
  await shot(lior, 'shoot-table-01-desktop-lior');
});

await step('a row: the last shoot day and how long ago, held out of the contract, the next one or "לא נקבע", station, editor, a link to the card', async () => {
  const ron = await cellsOf(lior, RON);
  assert.match(ron[0], /מספרת רון[^]*רון כהן/);
  assert.equal(ron[1], 'דניס, מישל וסמיון');
  assert.match(ron[2], /^05\.10\.26\s+לפני 15 ימים$/);
  assert.equal(ron[3], '1 מתוך 3');
  assert.match(ron[4], /^12\.11\.26\s+בעוד 23 ימים$/);
  assert.match(ron[5], /^\d · \S/);
  assert.equal(ron[6], 'נדיה');
  assert.equal(await lior.getAttribute(`#sd tr[data-id="${RON.id}"] .mt-name`, 'href'), `client.html?id=${RON.id}`);
  // Imported with its history: two shoot days, the last of them on 14.7; nothing set ahead.
  const gal = await cellsOf(lior, GAL);
  assert.deepEqual([gal[1], gal[3], gal[4], gal[6]], ['נטלי דדון', '2 מתוך 3', 'לא נקבע', 'יריב']);
  assert.match(gal[2], /^14\.07\.26\s+לפני 98 ימים$/);
  assert.match((await cellsOf(lior, AVI))[2], /^02\.02\.26\s+לפני 260 ימים$/);
  assert.equal((await cellsOf(lior, AVI))[6], 'עורך חיצוני');
  // Shot, no date on record.
  assert.deepEqual((await cellsOf(lior, TAL)).slice(2, 5), ['צולם, התאריך לא הוזן', '1 מתוך 3', 'לא נקבע']);
  // Never shot: a shoot set ahead; a date that passed and was never closed is said, and is not a shoot that took place.
  const dan = await cellsOf(lior, DAN);
  assert.equal(dan[2], 'טרם צולם');
  assert.equal(dan[3], '0 מתוך 3');
  assert.match(dan[4], /^28\.10\.26\s+בעוד 8 ימים$/);
  assert.match((await cellsOf(lior, NOA))[2], /^טרם צולם\s+12\.10\.26 עבר ולא נסגר$/);
  // No money here, and no primary (pink) action: the screen only shows.
  assert.doesNotMatch(await text(lior, '#view-shoots'), /₪/);
  assert.equal(await lior.locator('#view-shoots .btn-primary, #view-shoots button:not([id^="sd-sort-"])').count(), 0);
});

await step('a click on a header sorts by it (one list), a second click turns it over; back to the last shoot day brings the two groups back', async () => {
  await lior.click('#sd-sort-name');
  assert.equal(await lior.getAttribute('#sd-head th:nth-child(1)', 'aria-sort'), 'ascending');
  assert.equal(await lior.getAttribute('#sd-head th:nth-child(3)', 'aria-sort'), null);
  assert.equal(await lior.locator('#sd .sd-group').count(), 0);
  const asc = await names(lior);
  assert.equal(asc.length, 16);
  assert.deepEqual(asc, [...asc].sort((a, b) => a.localeCompare(b, 'he')));
  assert.equal(await lior.evaluate(() => document.activeElement.id), 'sd-sort-name');
  await lior.click('#sd-sort-name');
  assert.equal(await lior.getAttribute('#sd-head th:nth-child(1)', 'aria-sort'), 'descending');
  assert.deepEqual(await names(lior), [...asc].reverse());
  // The next shoot day: the nearest first, then everyone with none set.
  await lior.click('#sd-sort-next');
  assert.deepEqual((await names(lior)).slice(0, 2), ['דן נדל״ן', 'מספרת רון']);
  await lior.click('#sd-sort-last');
  assert.deepEqual(await names(lior, 'shot'), SHOT_ORDER);
  assert.deepEqual(await names(lior, 'never'), NEVER_ORDER);
  // Turned over: the latest shoot first; "טרם צולמו" stays below.
  await lior.click('#sd-sort-last');
  assert.equal(await lior.getAttribute('#sd-head th:nth-child(3)', 'aria-sort'), 'descending');
  assert.deepEqual((await names(lior, 'shot')).slice(0, 2), ['מספרת רון', 'קפה גליה']);
  assert.deepEqual(await names(lior, 'never'), NEVER_ORDER);
  await lior.click('#sd-sort-last');
});

await step('the search by client name; the order survives the minute\'s refresh', async () => {
  await lior.fill('#sd-q', 'קפה');
  assert.deepEqual(await names(lior), ['קפה גליה']);
  assert.equal(await text(lior, '#sd-count'), 'לקוח אחד · 1 צולמו · 0 טרם צולמו');
  await lior.fill('#sd-q', 'נועה');
  assert.deepEqual(await names(lior, 'never'), ['נועה קוסמטיקה']);
  await lior.fill('#sd-q', 'אין כזה');
  assert.equal(await text(lior, '#sd tbody'), 'אין לקוחות בחיפוש הזה.');
  await lior.fill('#sd-q', '');
  assert.deepEqual(await names(lior, 'shot'), SHOT_ORDER);
  await lior.click('#sd-sort-name');
  await lior.clock.runFor(61e3);
  assert.equal(await lior.getAttribute('#sd-head th:nth-child(1)', 'aria-sort'), 'ascending');
  assert.equal((await names(lior)).length, 16);
  await lior.click('#sd-sort-last');
  // The other tabs of owner.html are "כל הלקוחות במבט" in the menu, as before.
  await lior.click('#tab-all');
  await lior.waitForSelector('#side-overview[aria-current="page"]');
  assert.equal(await lior.getAttribute('#side-shoot-table', 'aria-current'), null);
  await lior.click('#tab-shoots');
  await lior.waitForSelector('#side-shoot-table[aria-current="page"]');
  await lctx.close();
});

await step('Ofir: the entry in the menu from his own work, the same table and order', async () => {
  const ctx = await newContext();
  const ofir = await newPage(ctx);
  await signIn(ofir, 'clients.html#mine', 'ofir@astrateg.test');
  await ofir.waitForSelector('#side-shoot-table');
  await ofir.click('#side-shoot-table');
  await ofir.waitForURL(/owner\.html#shoots$/);
  await ready(ofir);
  assert.deepEqual(await names(ofir, 'shot'), SHOT_ORDER);
  assert.deepEqual(await names(ofir, 'never'), NEVER_ORDER);
  await ofir.waitForSelector('#side-shoot-table[aria-current="page"]');
  assert.equal(await ofir.getAttribute('#mode-manager', 'aria-current'), null);
  // From another tab of the page, the menu entry opens the table without a reload.
  await ofir.click('#tab-table');
  await ofir.waitForSelector('#mode-manager[aria-current="page"]');
  await ofir.click('#side-shoot-table');
  await ready(ofir);
  assert.equal(await ofir.getAttribute('#tab-shoots', 'aria-selected'), 'true');
  await shot(ofir, 'shoot-table-02-desktop-ofir');
  await ctx.close();
});

await step('the owner: a tab next to the manager table, the same rows', async () => {
  const ctx = await newContext();
  const owner = await newPage(ctx);
  await signIn(owner, 'owner.html', 'owner@astrateg.test');
  await owner.waitForSelector('#view-now:not([hidden])');
  assert.deepEqual(await owner.locator('#ow-tabs [role=tab]:visible').allInnerTexts(), ['מה דורש אותי', 'כל הלקוחות במבט', 'טבלה', 'ימי צילום', 'ארכיון']);
  assert.equal(await text(owner, '#side-shoot-table'), 'טבלת ימי צילום');
  await owner.click('#tab-shoots');
  await ready(owner);
  assert.match(owner.url(), /owner\.html#shoots$/);
  assert.deepEqual(await names(owner, 'shot'), SHOT_ORDER);
  // The arrow keys move over the tabs, this one included.
  await owner.keyboard.press('ArrowRight');
  assert.equal(await owner.getAttribute('#tab-table', 'aria-selected'), 'true');
  await owner.keyboard.press('ArrowLeft');
  assert.equal(await owner.getAttribute('#tab-shoots', 'aria-selected'), 'true');
  await ctx.close();
});

await step('who does not get it: Irit (no entry, no tab), an editor and a sales agent ("אין לך גישה"); nothing was written by anyone', async () => {
  const ictx = await newContext();
  const irit = await newPage(ictx);
  await signIn(irit, 'owner.html#shoots', 'irit@astrateg.test');
  await irit.waitForSelector('#view-now:not([hidden])');
  assert.equal(await irit.isHidden('#tab-shoots'), true);
  assert.equal(await irit.isHidden('#view-shoots'), true);
  assert.equal(await irit.locator('#side-shoot-table').count(), 0);
  await ictx.close();
  for (const who of ['nadia', 'stav']) {
    const ctx = await newContext();
    const page = await newPage(ctx);
    await signIn(page, 'owner.html#shoots', `${who}@astrateg.test`);
    await page.waitForSelector('#no-access:not([hidden])');
    assert.equal(await page.isHidden('#ow-page'), true, who);
    assert.equal(await page.locator('#sd tbody tr').count(), 0, who);
    await page.waitForSelector('#app-side .side-link');
    assert.equal(await page.locator('#side-shoot-table').count(), 0, who);
    assert.doesNotMatch(await text(page, 'body'), /מספרת רון|קפה גליה/, who);
    await ctx.close();
  }
  assert.deepEqual(writes, []);
});

await step('360px phones: a card per client, no sideways scroll anywhere, 44px targets, the first 12 and "הצג עוד", the entry behind "עוד"', async () => {
  const pctx = await newContext({ width: 360, height: 780 });
  const phone = await newPage(pctx);
  await signIn(phone, 'owner.html#shoots', 'lior@astrateg.test');
  await ready(phone);
  assert.ok(await noHScroll(phone), 'the page scrolls sideways at 360px');
  // Not inside the table either: the rows are cards, as wide as the screen.
  const wrap = await phone.locator('#sd-wrap').evaluate((e) => [e.scrollWidth <= e.clientWidth + 1, getComputedStyle(e).overflowX]);
  assert.deepEqual(wrap, [true, 'visible']);
  assert.equal(await phone.locator(`#sd tr[data-id="${AVI.id}"]`).evaluate((e) => getComputedStyle(e).display), 'grid');
  const boxes = await phone.locator('#sd tr[data-id]:not([hidden]), #sd-head th').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }));
  assert.ok(boxes.every(([l, r]) => l >= 0 && r <= 360.5), JSON.stringify(boxes));
  // Each fact carries its column's name.
  assert.equal(await phone.locator(`#sd tr[data-id="${AVI.id}"] td:nth-child(3)`).evaluate((e) => getComputedStyle(e, '::before').content), '"יום צילום אחרון"');
  // The first 12 of the 14, in the same order, and one button for the rest.
  assert.deepEqual(await names(phone, 'shot'), SHOT_ORDER.slice(0, 12));
  assert.deepEqual(await names(phone, 'never'), NEVER_ORDER);
  assert.equal(await text(phone, '#sd tbody[data-group="shot"] .more-btn'), 'הצג עוד (2)');
  const sizes = await phone.locator('#sd-q, #sd-head th button, #sd tr[data-id]:not([hidden]) .mt-name, #sd .more-btn, #tab-shoots').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  assert.ok(sizes.length >= 20 && sizes.every((x) => x >= 44), JSON.stringify(sizes));
  await shot(phone, 'shoot-table-03-phone-lior');
  if (OUT) await phone.screenshot({ path: `${OUT}/shoot-table-03b-phone-top.png` });
  await phone.click('#sd tbody[data-group="shot"] .more-btn');
  assert.deepEqual(await names(phone, 'shot'), SHOT_ORDER);
  // The headers are the sort buttons here too.
  await phone.click('#sd-sort-name');
  assert.equal(await phone.getAttribute('#sd-head th:nth-child(1)', 'aria-sort'), 'ascending');
  assert.ok(await noHScroll(phone), 'the page scrolls sideways at 360px after a sort');
  await phone.click('#sd-sort-last');
  // The bottom bar: the table is behind "עוד", and "עוד" is marked while it is open.
  await phone.waitForSelector('#side-more.is-on');
  await phone.click('#side-more');
  assert.ok((await phone.locator('#side-sheet .side-link').allInnerTexts()).includes('טבלת ימי צילום'));
  await shot(phone, 'shoot-table-04-phone-menu');
  await pctx.close();
});

assert.deepEqual(errors, []);
await browser.close();
noCspViolations();
console.log(`shoot-table-e2e: ${passed} passed`);
