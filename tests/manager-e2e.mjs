// End-to-end check of the manager's features against an in-memory fake of Supabase
// (the browser's clock fixed on Tuesday 20.10.2026, 10:00 in Israel):
//  - "המשימות שלי" / "מבט מנהל" at the top of the pages for the owner, Irit and Ofir:
//    the owner lands on the manager profile, Irit and Ofir on their own work until
//    they switch; the choice is remembered for the next sign-in; Lior and the editors
//    have no switch.
//  - The manager table (owner.html#table): a row per client, sorting, filters,
//    search, a sticky header, sideways scrolling inside the table on a phone, CSV.
//    The price columns for the owner, Irit and Ofir; never for Lior (not on screen,
//    not in the CSV).
//  - The contract summary in the client card: "בוצעו X מתוך Y שבחוזה", from the
//    protocol, the card's counter and uploaded files (client_files; without that
//    table the card still works).
//  - Archive (the owner and Ofir): from the card, hidden from every list, the archive
//    list, restore, and the permanent deletion with the business name typed again.
//  - 360px phones: no sideways page scroll, 44px targets.
// Run: npx http-server -p 8080 -s . &  then  node tests/manager-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { importKeys } from '../app/client-open.js';
import { packageDeliverables } from '../app/protocol-logic.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-10-20T10:00:00+03:00'); // Tuesday
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;

// ── People ────────────────────────────────
const people = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', nadia: 'nadia' };
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: person !== 'nadia', phone: null }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => { const r = staff.find((x) => x.email === u?.email); return r ? r.person : undefined; };
// As the migration (20261003140000_manager_features.sql) has it.
const isManager = (u) => { const p = personOf(u); return p === null || p === 'irit' || p === 'ofir'; };
const canArchive = (u) => { const p = personOf(u); return p === null || p === 'ofir'; };
const isOffice = (u) => { const p = personOf(u); return p === null || ['irit', 'lior', 'ofir', 'ilai'].includes(p); };

// ── Clients ───────────────────────────────
const client = (id, fields) => ({
  id, name: '', business: null, address: null, phone: null, package_name: 'Social + TV all in one · סמיון, מישל ודניס', shoot_type: 'dms', characterizer: 'ofir',
  has_logo: true, editor_name: null, editor: null, deal_at: '2026-10-11T09:00:00+03:00', char_at: '2026-10-12T10:00:00+03:00', shoot_at: null,
  contract_end: '2027-10-11', status: 'active', notes: null, quote_id: null, created_at: '2026-10-11T09:00:00+03:00',
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: {}, rounds: [], verified_at: null, verified_by: null, closed_reason: null,
  archived_at: null, archived_by: null,
  ...fields,
});
const checks = [];
const one = (c, key, at, note = null, by = 'irit@astrateg.test') => checks.push({ client_id: c.id, item_key: key, state: 'done', note, by_email: by, at });
const DELIV = packageDeliverables({ package: { id: 'social-tv-simeon' }, selection: { paid: ['simeon-day'], free: { graphics: 4 } } });
// Ron: everything up to publishing imported (all graphics approved), 20 videos counted on the card.
const A = client('aaaaaaaa-0000-4000-8000-000000000001', {
  name: 'רון כהן', business: 'מספרת רון', editor: 'nadia', shoot_at: '2026-10-05T10:00:00+03:00', contract_end: '2026-12-31', quote_id: 'q1',
  deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-09-02T10:00:00+03:00', deliverables: { ...DELIV, done: { videos: 20 } },
});
for (const k of importKeys('publish')) one(A, k, '2026-10-15T09:00:00+03:00', 'ייבוא');
// Galia: a new deal, its shoot ahead; Yariv edits.
const B = client('bbbbbbbb-0000-4000-8000-000000000002', {
  name: 'גליה', business: 'קפה גליה', editor: 'yariv', shoot_at: '2026-10-28T10:00:00+03:00', package_name: 'Social all in one · נטלי דדון', shoot_type: 'natali', quote_id: 'q2',
  deliverables: packageDeliverables({ package: { id: 'social-natali' }, selection: { paid: [], free: { simeonJoin: true } } }),
});
for (const k of importKeys('content')) one(B, k, '2026-10-14T09:00:00+03:00', 'ייבוא');
// Dana: no business name, no editor yet.
const C = client('cccccccc-0000-4000-8000-000000000003', { name: 'סטודיו דנה', deliverables: { videos: 25, graphics: 35, shoot_days: 1 } });
for (const k of importKeys('char')) one(C, k, '2026-10-12T12:00:00+03:00', 'ייבוא');
const F = client('ffffffff-0000-4000-8000-000000000006', { name: 'גן אירועים', business: 'גן אירועים', status: 'ended', contract_end: '2026-09-01' });

const db = {
  staff,
  clients: [A, B, C, F],
  protocol_checks: checks,
  protocol_log: checks.map((c, i) => ({ id: i + 1, client_id: c.client_id, item_key: c.item_key, action: c.state, note: c.note, by_email: c.by_email, at: c.at })),
  client_tasks: [{ id: randomUUID(), client_id: A.id, title: 'לבדוק', owner: 'irit', due_on: null, done_at: null, created_at: '2026-10-19T09:00:00+03:00', created_by_email: 'owner@astrateg.test', source: null, urgent: false, started_at: null }],
  office_reviews: [], client_status_notes: [], client_messages: [], client_access: [], client_date_changes: [], client_questions: [], quotes: [],
  client_files: [
    { id: randomUUID(), client_id: A.id, kind: 'deliverable_graphic', deleted_at: null },
    { id: randomUUID(), client_id: A.id, kind: 'deliverable_graphic', deleted_at: null },
    { id: randomUUID(), client_id: A.id, kind: 'deliverable_graphic', deleted_at: '2026-10-18T10:00:00+03:00' },
    // Galia: 12 graphics uploaded, more than the 9 the protocol shows approved.
    ...Array.from({ length: 12 }, () => ({ id: randomUUID(), client_id: B.id, kind: 'deliverable_graphic', deleted_at: null })),
  ],
};
const FINANCE = [
  { client_id: A.id, quote_number: 'Q-2026-0101', signed_at: '2026-09-01T09:05:00+03:00', monthly_net_agorot: 490000, monthly_gross_agorot: 578200, term_gross_agorot: 6938400, discount_agorot: 0, term_months: 12 },
  { client_id: B.id, quote_number: 'Q-2026-0102', signed_at: '2026-10-11T09:05:00+03:00', monthly_net_agorot: 390000, monthly_gross_agorot: 460200, term_gross_agorot: 5522400, discount_agorot: 0, term_months: 12 },
];
const adminLog = [];
let filesTable = true; // false: public.client_files does not exist (another module's)

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
const label = (c) => (c.business || '').trim() || c.name;
const plain = (s) => String(s ?? '').replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

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
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
  if (p === '/rest/v1/rpc/can_use_vault') return json(200, !!me && !!staff.find((r) => r.email === me.email)?.vault);
  const denied = () => json(403, { code: '42501', message: 'not allowed' });
  if (p === '/rest/v1/rpc/manager_client_finance') {
    if (!me) return json(401, { message: 'permission denied' });
    const gone = archivedIds();
    return json(200, isManager(me) ? FINANCE.filter((f) => !gone.has(f.client_id)) : []);
  }
  if (p === '/rest/v1/rpc/archived_clients') {
    if (!me) return json(401, { message: 'permission denied' });
    return json(200, canArchive(me) ? db.clients.filter((c) => c.archived_at).map((c) => ({
      id: c.id, label: label(c), name: c.name, business: c.business, package_name: c.package_name, status: c.status, deal_at: c.deal_at,
      contract_end: c.contract_end, archived_at: c.archived_at, archived_by: c.archived_by,
    })) : []);
  }
  for (const fn of ['archive_client', 'restore_client', 'purge_client']) {
    if (p !== `/rest/v1/rpc/${fn}`) continue;
    if (!me || !canArchive(me)) return denied();
    const c = db.clients.find((x) => x.id === body.p_client);
    if (!c) return json(404, { code: 'P0002', message: 'client not found' });
    if (fn === 'archive_client') {
      if (!c.archived_at) { c.archived_at = new Date().toISOString(); c.archived_by = me.email; adminLog.push({ action: 'archive', client_id: c.id, business: label(c), by: me.email }); }
      return json(200, { id: c.id, archived_at: c.archived_at, archived_by: c.archived_by });
    }
    if (fn === 'restore_client') {
      if (c.archived_at) { c.archived_at = null; c.archived_by = null; adminLog.push({ action: 'restore', client_id: c.id, business: label(c), by: me.email }); }
      return json(200, { id: c.id, archived_at: null });
    }
    if (!c.archived_at) return json(400, { code: '22023', message: 'archive the client first' });
    if (plain(body.p_confirm) !== plain(label(c))) return json(400, { code: '22023', message: 'the name does not match' });
    for (const t of Object.keys(db)) if (Array.isArray(db[t]) && t !== 'clients') db[t] = db[t].filter((r) => r.client_id !== c.id);
    db.clients = db.clients.filter((x) => x.id !== c.id);
    adminLog.push({ action: 'purge', client_id: c.id, business: label(c), by: me.email });
    return json(200, { id: c.id, deleted: {} });
  }
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]] || (m[1] === 'client_files' && !filesTable)) return json(404, { code: '42P01', message: 'not found' });
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
    if (!isOffice(me) && table === 'clients') rows = rows.filter((r) => r.editor === personOf(me));
    if (table === 'client_messages' && !isOffice(me)) rows = [];
    if (table === 'quotes' && !isOffice(me)) rows = [];
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    return reply(rows.slice(off, off + lim));
  }
  return json(405, { message: `unexpected ${req.method()} on ${table}` });
}

// ── Browser ────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newContext(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, acceptDownloads: true });
  await ctx.clock.install({ time: NOW });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
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
const toastHas = (page, t) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), t);
const heads = (page) => page.locator('#mt-head th').allInnerTexts();
const names = (page) => page.locator('#mt-body tr td:first-child .mt-name').allInnerTexts();
let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const octx = await newContext();
const owner = await newPage(octx);

await step('the owner lands on the manager profile, with the switch at the top, and can switch to "המשימות שלי" and back', async () => {
  await signIn(owner, 'clients.html', 'owner@astrateg.test');
  await owner.waitForURL(/owner\.html#now$/);
  await owner.waitForSelector('#mode-bar');
  assert.deepEqual(await owner.locator('#mode-bar .mode-opt').allInnerTexts(), ['המשימות שלי', 'מבט מנהל']);
  assert.equal(await owner.getAttribute('#mode-manager', 'aria-current'), 'page');
  assert.equal(await owner.getAttribute('#mode-mine', 'aria-current'), null);
  // The switch is the first entry of the app menu, on every page.
  assert.equal(await owner.evaluate(() => document.querySelector('#app-side #side-list').firstElementChild.id), 'mode-bar');
  for (const t of ['now', 'all', 'table', 'archive']) assert.equal(await owner.isHidden(`#tab-${t}`), false, t);
  await shot(owner, 'manager-01-owner-screen1-switch');
  await owner.click('#mode-mine');
  await owner.waitForURL(/clients\.html#mine$/);
  await owner.waitForSelector('#mode-bar');
  assert.equal(await owner.getAttribute('#mode-mine', 'aria-current'), 'page');
  // The next sign-in (a new tab) lands on "המשימות שלי", as chosen.
  const again = await newPage(octx);
  await again.goto(`${BASE}clients.html`);
  await again.waitForSelector('#view-mine:not([hidden])');
  await again.waitForTimeout(300);
  assert.match(again.url(), /clients\.html/);
  await again.click('#mode-manager');
  await again.waitForURL(/owner\.html#now$/);
  await again.close();
});

await step('the manager table: a row per open client, the contract and the summary, the prices, a sticky header', async () => {
  await owner.goto(`${BASE}owner.html#table`);
  await owner.waitForSelector('#view-table:not([hidden]) #mt-body tr');
  assert.equal(await text(owner, '#ow-title'), 'כל הלקוחות בטבלה');
  assert.deepEqual(await heads(owner), ['עסק', 'חבילה', 'נחתם', 'סיום חוזה', 'חודשי כולל מע״מ', 'סה״כ חוזה', 'תחנה', 'מצב', 'הצעד הבא', 'עורך', 'יום צילום', 'סרטונים', 'גרפיקות', 'חלון חידוש']);
  // Active and ending by default; the ended client only with "כולם".
  assert.equal((await names(owner)).length, 3);
  const ron = owner.locator(`#mt-body tr[data-id="${A.id}"]`);
  const cells = await ron.locator('td').allInnerTexts();
  assert.match(cells[0], /מספרת רון[^]*רון כהן/);
  assert.match(cells[2], /01\.09\.26/);
  assert.match(cells[3], /31\.12\.26/);
  assert.match(cells[4], /5,782 ₪[^]*Q-2026-0101/);
  assert.match(cells[5], /69,384 ₪/);
  assert.equal(cells[9], 'נדיה');
  assert.match(cells[11], /^20\/42/); // the card's counter
  assert.match(cells[12], /^46\/46/); // all approved in the protocol
  assert.match(await owner.locator(`#mt-body tr[data-id="${B.id}"] td`).nth(12).innerText(), /^12\/35/); // 9 approved, 12 uploaded
  assert.match(cells[13], /חלון החידוש פתוח · עוד 72 ימים/);
  assert.match(await owner.locator(`#mt-body tr[data-id="${C.id}"] td`).nth(9).innerText(), /—/);
  assert.equal(await owner.locator('#mt thead th').first().evaluate((e) => getComputedStyle(e).position), 'sticky');
  assert.equal(await owner.isHidden('#mt-money-note'), false);
  await shot(owner, 'manager-02-table-owner');
});

await step('sorting by any column, filters by station, colour, editor and status, and search', async () => {
  await owner.click('#mt-sort-name');
  assert.equal(await owner.getAttribute('#mt-head th:nth-child(1)', 'aria-sort'), 'ascending');
  const asc = await names(owner);
  assert.deepEqual(asc, [...asc].sort((a, b) => a.localeCompare(b, 'he')));
  await owner.click('#mt-sort-name');
  assert.equal(await owner.getAttribute('#mt-head th:nth-child(1)', 'aria-sort'), 'descending');
  assert.deepEqual(await names(owner), [...asc].reverse());
  assert.equal(await owner.evaluate(() => document.activeElement.id), 'mt-sort-name');
  await owner.click('#mt-sort-end');
  assert.equal((await names(owner))[0], 'מספרת רון');
  await owner.selectOption('#mt-editor', 'yariv');
  assert.deepEqual(await names(owner), ['קפה גליה']);
  await owner.selectOption('#mt-editor', '');
  await owner.selectOption('#mt-status', 'all');
  assert.equal((await names(owner)).length, 4);
  await owner.selectOption('#mt-status', 'ended');
  assert.deepEqual(await names(owner), ['גן אירועים']);
  await owner.selectOption('#mt-status', 'open');
  const station = await owner.locator(`#mt-body tr[data-id="${C.id}"] td`).nth(6).innerText();
  assert.match(station, /^\d · /);
  const key = await owner.evaluate((t) => [...document.querySelectorAll('#mt-station option')].find((o) => t.endsWith(o.textContent))?.value, station);
  await owner.selectOption('#mt-station', key);
  assert.ok((await names(owner)).includes('סטודיו דנה'));
  await owner.selectOption('#mt-station', '');
  await owner.fill('#mt-q', 'גליה');
  assert.deepEqual(await names(owner), ['קפה גליה']);
  assert.match(await text(owner, '#mt-count'), /^לקוח אחד בטבלה · 3 פעילים ומסיימים בסך הכול$/);
  await owner.fill('#mt-q', 'אין כזה');
  assert.equal(await text(owner, '#mt-body'), 'אין לקוחות בסינון הזה.');
  await owner.fill('#mt-q', '');
  const colours = await owner.locator('#mt-color option').allInnerTexts();
  assert.deepEqual(colours, ['כל הצבעים', 'אדום', 'צהוב', 'ירוק']);
});

await step('the CSV: what the table shows, in Hebrew, with the prices for the owner', async () => {
  await owner.click('#mt-sort-name');
  const [download] = await Promise.all([owner.waitForEvent('download'), owner.click('#mt-csv')]);
  assert.equal(download.suggestedFilename(), 'astrateg-clients-2026-10-20.csv');
  const csv = readFileSync(await download.path(), 'utf8');
  assert.ok(csv.startsWith('﻿עסק,חבילה,נחתם,סיום חוזה,חודשי כולל מע״מ'));
  assert.match(csv, /מספרת רון/);
  assert.match(csv, /"5,782 ₪"/);
  assert.equal(csv.trim().split('\r\n').length, 4);
  await toastHas(owner, 'יוצא קובץ CSV עם 3 לקוחות, כולל המחירים');
});

await step('the contract summary in the client card: "בוצעו X מתוך Y שבחוזה", with uploaded files counted', async () => {
  await owner.goto(`${BASE}client.html?id=${A.id}`);
  await owner.waitForSelector('#contract-summary');
  assert.equal(await text(owner, '#cs-h'), 'סיכום החוזה');
  assert.equal(await text(owner, '#cs-videos .cs-t'), 'בוצעו 20 סרטונים מתוך 42 שבחוזה');
  assert.equal(await text(owner, '#cs-graphics .cs-t'), 'בוצעו 46 גרפיקות מתוך 46 שבחוזה');
  assert.equal(await text(owner, '#cs-shoot_days .cs-t'), 'בוצע יום צילום אחד מתוך 3 שבחוזה');
  assert.match(await text(owner, '#contract-summary'), /חודש 2 מתוך 3 · סיום החוזה 31.12.2026[^]*חלון החידוש פתוח · עוד 72 ימים/);
  assert.match(await text(owner, '#contract-summary'), /והקבצים שהועלו/);
  assert.equal(await owner.isVisible('#btn-archive'), true);
  await shot(owner, 'manager-03-card-summary');
  // Galia: 12 graphics uploaded (the protocol shows the first 9 approved); Simeon joining is in the agreement.
  await owner.goto(`${BASE}client.html?id=${B.id}`);
  await owner.waitForSelector('#contract-summary');
  assert.equal(await text(owner, '#cs-graphics .cs-t'), 'בוצעו 12 גרפיקות מתוך 35 שבחוזה');
  assert.match(await text(owner, '#contract-summary'), /כלול גם: סמיון מצטרף ליום הצילום עם נטלי/);
  // Without the files table the card works, and says nothing about files.
  filesTable = false;
  await owner.reload();
  await owner.waitForSelector('#contract-summary');
  assert.doesNotMatch(await text(owner, '#contract-summary'), /הקבצים/);
  assert.equal(await text(owner, '#cs-graphics .cs-t'), 'בוצעו 9 גרפיקות מתוך 35 שבחוזה');
  filesTable = true;
});

await step('Lior: the table without any price, the summary in the card, no switch, no archive', async () => {
  const lctx = await newContext();
  const lior = await newPage(lctx);
  await signIn(lior, 'owner.html#table', 'lior@astrateg.test');
  await lior.waitForSelector('#view-table:not([hidden]) #mt-body tr');
  const h = await heads(lior);
  assert.ok(!h.some((x) => /חודשי|סה״כ|מחיר/.test(x)), h.join());
  assert.equal(h.length, 12);
  assert.doesNotMatch(await text(lior, '#mt'), /₪|Q-2026/);
  assert.equal(await lior.isHidden('#mt-money-note'), true);
  assert.equal(await lior.isHidden('#tab-archive'), true);
  assert.equal(await lior.isHidden('#tab-now'), true);
  assert.equal(await lior.locator('#mode-bar').count(), 0);
  const [download] = await Promise.all([lior.waitForEvent('download'), lior.click('#mt-csv')]);
  assert.doesNotMatch(readFileSync(await download.path(), 'utf8'), /₪|חודשי|סה״כ/);
  await lior.goto(`${BASE}client.html?id=${A.id}`);
  await lior.waitForSelector('#contract-summary');
  assert.equal(await lior.locator('#btn-archive').count(), 0);
  await lctx.close();
});

await step('Irit: the switch, screen 1, the table with prices, no archive; her own work until she switches', async () => {
  const ictx = await newContext();
  const irit = await newPage(ictx);
  await signIn(irit, 'clients.html', 'irit@astrateg.test');
  await irit.waitForSelector('#view-mine:not([hidden])');
  await irit.waitForSelector('#mode-bar');
  assert.equal(await irit.getAttribute('#mode-mine', 'aria-current'), 'page');
  await irit.click('#mode-manager');
  await irit.waitForSelector('#view-now:not([hidden])');
  assert.equal(await irit.isHidden('#tab-archive'), true);
  await irit.click('#tab-table');
  await irit.waitForSelector('#mt-body tr');
  assert.ok((await heads(irit)).includes('חודשי כולל מע״מ'));
  await irit.goto(`${BASE}client.html?id=${A.id}`);
  await irit.waitForSelector('#contract-summary');
  assert.equal(await irit.locator('#btn-archive').count(), 0);
  await ictx.close();
  // An editor: no switch.
  const nctx = await newContext();
  const nadia = await newPage(nctx);
  await signIn(nadia, 'clients.html#mine', 'nadia@astrateg.test');
  await nadia.waitForSelector('#view-mine:not([hidden])');
  await nadia.waitForTimeout(400);
  assert.equal(await nadia.locator('#mode-bar').count(), 0);
  await nctx.close();
});

await step('Ofir archives a client from its card: gone from every list, in the archive, restored as it was', async () => {
  const fctx = await newContext();
  const ofir = await newPage(fctx);
  await signIn(ofir, `client.html?id=${C.id}`, 'ofir@astrateg.test');
  await ofir.waitForSelector('#btn-archive');
  ofir.once('dialog', (d) => { assert.match(d.message(), /להעביר את סטודיו דנה לארכיון\?/); d.accept(); });
  await ofir.click('#btn-archive');
  await ofir.waitForURL(/owner\.html#archive$/);
  await ofir.waitForSelector('#ar-list .ar-item');
  assert.match(await text(ofir, '#ar-list'), /סטודיו דנה[^]*בארכיון מ־/);
  assert.ok(C.archived_at);
  assert.equal(C.archived_by, 'ofir@astrateg.test');
  await shot(ofir, 'manager-04-archive');
  // Gone from the table, from the list, and its card does not open.
  await ofir.click('#tab-table');
  await ofir.waitForSelector('#mt-body tr');
  assert.ok(!(await names(ofir)).includes('סטודיו דנה'));
  await ofir.goto(`${BASE}client.html?id=${C.id}`);
  await ofir.waitForSelector('#state.no-access');
  assert.match(await text(ofir, '#state'), /הלקוח לא נמצא[^]*הועבר לארכיון/);
  // Restore.
  await ofir.goto(`${BASE}owner.html#archive`);
  await ofir.waitForSelector(`#ar-restore-${C.id}`);
  await ofir.click(`#ar-restore-${C.id}`);
  await toastHas(ofir, 'סטודיו דנה שוחזר/ה');
  assert.equal(C.archived_at, null);
  assert.equal(await text(ofir, '#ar-list'), 'אין לקוחות בארכיון.');
  await ofir.click('#tab-table');
  await ofir.waitForFunction(() => [...document.querySelectorAll('#mt-body .mt-name')].some((a) => a.textContent === 'סטודיו דנה'));
  await fctx.close();
});

await step('permanent deletion: only from the archive, with the business name typed again and the box ticked', async () => {
  C.archived_at = '2026-10-20T09:00:00+03:00';
  C.archived_by = 'owner@astrateg.test';
  await owner.goto(`${BASE}owner.html#archive`);
  await owner.waitForSelector(`#ar-purge-${C.id}`);
  await owner.click(`#ar-purge-${C.id}`);
  await owner.waitForSelector('#dlg-purge[open]');
  assert.equal(await text(owner, '#purge-name'), 'סטודיו דנה');
  assert.equal(await owner.evaluate(() => document.activeElement.id), 'purge-text');
  assert.equal(await owner.isDisabled('#purge-submit'), true);
  await owner.fill('#purge-text', 'סטודיו');
  await owner.check('#purge-sure');
  assert.equal(await owner.isDisabled('#purge-submit'), true);
  await owner.fill('#purge-text', ' סטודיו   דנה ');
  assert.equal(await owner.isDisabled('#purge-submit'), false);
  await owner.uncheck('#purge-sure');
  assert.equal(await owner.isDisabled('#purge-submit'), true);
  await owner.check('#purge-sure');
  await shot(owner, 'manager-05-purge-dialog');
  await owner.click('#purge-submit');
  await toastHas(owner, 'סטודיו דנה נמחק/ה לצמיתות');
  assert.equal(db.clients.some((c) => c.id === C.id), false);
  assert.equal(db.protocol_checks.some((c) => c.client_id === C.id), false);
  assert.deepEqual(adminLog.map((x) => x.action), ['archive', 'restore', 'purge']);
  assert.deepEqual(adminLog.at(-1), { action: 'purge', client_id: C.id, business: 'סטודיו דנה', by: 'owner@astrateg.test' });
  assert.equal(await owner.locator('#dlg-purge[open]').count(), 0);
});

await step('360px phones: the switch, the table scrolls sideways inside itself only, 44px targets; the card and the archive', async () => {
  const pctx = await newContext({ width: 360, height: 780 });
  const phone = await newPage(pctx);
  await signIn(phone, 'owner.html#table', 'owner@astrateg.test');
  await phone.waitForSelector('#mt-body tr');
  assert.ok(await noHScroll(phone), 'the table page scrolls sideways at 360px');
  const wrap = await phone.locator('#mt-wrap').evaluate((e) => [e.scrollWidth > e.clientWidth, getComputedStyle(e).overflowX]);
  assert.deepEqual(wrap, [true, 'auto']);
  // The business column stays in view when the table scrolls.
  await phone.locator('#mt-wrap').evaluate((e) => { e.scrollLeft = -600; });
  const first = await phone.locator('#mt-body tr:first-child td:first-child').boundingBox();
  assert.ok(first.x >= 0 && first.x + first.width <= 361, JSON.stringify(first));
  const sizes = await phone.locator('#mode-bar .mode-opt, #mt-tools .input, #mt-csv, #mt-head th button, #tab-table').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  assert.ok(sizes.length >= 10 && sizes.every((x) => x >= 44), JSON.stringify(sizes));
  await shot(phone, 'manager-06-phone-table');
  await phone.goto(`${BASE}client.html?id=${A.id}`);
  await phone.waitForSelector('#contract-summary');
  assert.ok(await noHScroll(phone), 'the card scrolls sideways at 360px');
  await shot(phone, 'manager-07-phone-card');
  await phone.goto(`${BASE}owner.html#archive`);
  await phone.waitForSelector('#ar-list li');
  assert.ok(await noHScroll(phone), 'the archive scrolls sideways at 360px');
  await phone.goto(`${BASE}clients.html#mine`);
  await phone.waitForSelector('#mode-bar');
  assert.ok(await noHScroll(phone), 'clients.html scrolls sideways at 360px with the switch');
  await shot(phone, 'manager-08-phone-switch');
  await pctx.close();
});

assert.deepEqual(errors, []);
await browser.close();
console.log(`manager-e2e: ${passed} passed`);
