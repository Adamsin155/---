// End-to-end check that the protocol pages cope when the database shows each
// person only their own clients (supabase/migrations/20260930130000_assignment_rls.sql).
// Unlike the other suites, this fake of Supabase applies the same rule as the
// database: the office sees every client; an editor the clients she edits or has a
// task in; Nirel also every Natali client; Eli the clients with a shoot day from 7
// days ago to 30 days ahead; the vault needs the vault flag and, outside the office,
// an assigned client (her editing, or a task someone else opened for her). Hidden
// rows simply do not come back, and writes on them are refused as Postgres refuses them. (The rule itself is tested in a real Postgres:
// tests/sql/rls.test.mjs.) The page clock is Tuesday 20.10.2026 10:00 in Jerusalem.
// Run: npx http-server -p 8080 -s . &  then  node tests/rls-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applicableProcesses } from '../app/protocol-logic.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-10-20T07:00:00Z'); // Tuesday 10:00 in Jerusalem
const skew = NOW.getTime() - Date.now();      // the fake server follows the page clock
const serverNow = () => new Date(Date.now() + skew).toISOString();
const hoursAgo = (n) => new Date(NOW - n * 36e5).toISOString();
const DAY = 864e5;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const login = (email) => {
  const u = { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated' };
  return { user: u, jwt: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email, role: 'authenticated', exp: Math.floor(NOW / 1000) + 86400 })}.sig` };
};
const PEOPLE = { irit: true, nadia: false, yariv: false, nirel: true, eli: false };
const LOGINS = Object.keys(PEOPLE).map((p) => login(`${p}@astrateg.test`));
const loginOf = (headers) => LOGINS.find((l) => (headers.authorization || '').includes(l.jwt)) || null;

const db = {
  staff: Object.entries(PEOPLE).map(([person, vault]) => ({ email: `${person}@astrateg.test`, person, vault, phone: null }))
    .concat([{ email: 'lior@astrateg.test', person: 'lior', vault: true, phone: null }, { email: 'ofir@astrateg.test', person: 'ofir', vault: true, phone: null }]),
  quotes: [], clients: [], protocol_checks: [], protocol_log: [], client_tasks: [], office_reviews: [], client_status_notes: [],
  client_access: [], client_access_log: [],
};
const base = {
  business: null, phone: '050-7654321', package_name: null, shoot_type: 'dms', characterizer: 'ofir', has_logo: true, editor_name: null, editor: null,
  shoot_at: null, char_at: null, contract_end: '2027-10-01', status: 'active', notes: null, quote_id: null, address: null,
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: {}, rounds: [], verified_at: null, verified_by: null, closed_reason: null,
};
const client = (o) => { const c = { ...base, id: randomUUID(), created_at: o.deal_at, ...o }; db.clients.push(c); return c; };
const check = (c, key, when, by = 'ofir@astrateg.test') => {
  db.protocol_checks.push({ client_id: c.id, item_key: key, state: 'done', note: null, by_email: by, at: when });
  db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: c.id, item_key: key, action: 'done', note: null, by_email: by, at: when });
};
const doneThrough = (c, phases, when) => {
  for (const p of applicableProcesses(c)) if (phases.includes(p.phase)) for (const i of p.items) if (!i.optional) check(c, i.key, when);
};
const UP_TO_SHOOT = ['onboarding', 'parallel', 'prep', 'eve', 'shoot'];
const shotAndAssigned = (o) => {
  const c = client({ deal_at: hoursAgo(24 * 14), char_at: hoursAgo(24 * 13), shoot_at: hoursAgo(48), ...o });
  doneThrough(c, UP_TO_SHOOT, hoursAgo(26));
  for (const k of ['p22a.drive', 'p22a.load', 'p22a.assigned']) check(c, k, hoursAgo(25));
  return c;
};
// Nadia edits Ron; a task of hers is open in Cafe; Pizza is the office's only.
const ron = shotAndAssigned({ name: 'מספרת רון', editor: 'nadia', notes: 'הערה של המשרד: לקוח רגיש למחיר' });
const cafe = client({ name: 'קפה גליה', deal_at: hoursAgo(24 * 20) });
db.client_tasks.push({ id: randomUUID(), client_id: cafe.id, title: 'לקצר את סרטון 4', owner: 'nadia', due_on: '2026-10-21', done_at: null, done_by_email: null, created_by_email: 'ofir@astrateg.test', created_at: hoursAgo(3), source: null, brief: null, urgent: false });
const pizza = shotAndAssigned({ name: 'פיצה נאפולי', editor: 'anna' });
// Nirel edits one Natali client; another Natali client is not hers.
const natEdit = shotAndAssigned({ name: 'סטודיו נטלי', shoot_type: 'natali', editor: 'nirel' });
const natOther = shotAndAssigned({ name: 'בוטיק נטלי', shoot_type: 'natali', editor: null });
for (const c of [natEdit, natOther, pizza]) {
  const a = { id: randomUUID(), client_id: c.id, network: 'instagram', label: null, username: `user.${c.id.slice(0, 4)}`, has_secret: randomUUID(), status: 'ok', note: null, updated_by: 'irit@astrateg.test', updated_at: hoursAgo(100), created_at: hoursAgo(100) };
  db.client_access.push(a);
  db.client_access_log.push({ id: db.client_access_log.length + 1, access_id: a.id, client_id: c.id, network: 'instagram', action: 'create', by_email: 'irit@astrateg.test', at: hoursAgo(100) });
}
const secretOf = (a) => `pw-${a.client_id.slice(0, 4)}`;
// Eli: a shoot in two days; one 12 days ago is out of his window.
const soon = client({ name: 'מאפיית הכרמל', deal_at: hoursAgo(24 * 9), char_at: hoursAgo(24 * 8), shoot_at: new Date(NOW.getTime() + 2 * DAY + 3 * 36e5).toISOString(), address: 'הרצל 10, תל אביב' });
doneThrough(soon, ['onboarding', 'parallel'], hoursAgo(24 * 7));
const oldShoot = shotAndAssigned({ name: 'גלידה ישנה', shoot_at: hoursAgo(24 * 12), editor: 'anna' });

// ── The rule, as the database applies it ────
const OFFICE = new Set(['irit', 'lior', 'ofir', 'ilai']);
const staffOf = (u) => db.staff.find((s) => s.email === u?.email) || null;
const isOffice = (s) => !!s && (s.person === null || OFFICE.has(s.person));
// A task of theirs, open or finished in the last 30 days; for the vault, only one someone else opened for them.
const taskFor = (s, c, { byOthers = false } = {}) => db.client_tasks.some((t) => t.client_id === c.id && t.owner === s.person
  && (!byOthers || t.created_by_email !== s.email) && (!t.done_at || new Date(serverNow()) - new Date(t.done_at) < 30 * DAY));
const edits = (s, c) => c.editor === s.person || (c.rounds || []).some((r) => r.editor === s.person);
const assigned = (s, c) => !!s?.person && (edits(s, c) || taskFor(s, c, { byOthers: true }));
const inShootWindow = (c) => [c.shoot_at, ...(c.rounds || []).map((r) => r.shoot_at)].filter(Boolean)
  .some((at) => { const d = (new Date(at) - new Date(serverNow())) / DAY; return d >= -7.5 && d <= 30.5; });
const sees = (s, c) => isOffice(s) || assigned(s, c) || (!!s?.person && taskFor(s, c)) || (s?.person === 'nirel' && c.shoot_type === 'natali') || (s?.person === 'eli' && inShootWindow(c));
const vaultOf = (s, c) => !!s?.vault && (isOffice(s) || assigned(s, c));
const visibleRows = (s, table) => {
  const client = (id) => db.clients.find((c) => c.id === id);
  if (table === 'clients') return db.clients.filter((c) => sees(s, c));
  if (['protocol_checks', 'protocol_log', 'client_tasks'].includes(table)) return db[table].filter((r) => sees(s, client(r.client_id)));
  if (['client_access', 'client_access_log'].includes(table)) return db[table].filter((r) => vaultOf(s, client(r.client_id)));
  if (['client_status_notes', 'office_reviews'].includes(table)) return isOffice(s) ? db[table] : [];
  return db[table];
};
const seen = [];     // [who, table] of every read, to show that hidden rows were asked for and not given
const refused = [];  // writes the fake refused

function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith('neq.')) out = out.filter((r) => String(r[k]) !== v.slice(4));
    else if (v.startsWith('gte.')) out = out.filter((r) => String(r[k]) >= v.slice(4));
    else if (v.startsWith('in.(')) { const set = new Set(v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, ''))); out = out.filter((r) => set.has(String(r[k]))); }
    else if (v.startsWith('like.')) { const tail = v.slice(5).replace(/^%/, ''); out = out.filter((r) => String(r[k]).endsWith(tail)); }
    else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    else if (v === 'not.is.null') out = out.filter((r) => r[k] !== null && r[k] !== undefined);
  }
  return out;
}

// public.clients as the database answers it since 20260930210000_hardening.sql (tests/fake-clients.mjs).
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
  if (p === '/auth/v1/token') {
    const l = LOGINS.find((x) => x.user.email === body.email);
    if (!l || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: l.jwt, token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(NOW / 1000) + 86400, refresh_token: 'r', user: l.user });
  }
  const who = loginOf(headers)?.user || null;
  if (p === '/auth/v1/user') return who ? json(200, who) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  const me = staffOf(who);
  const now = serverNow();
  const rls = (table) => { refused.push([me?.person, table]); return json(403, { code: '42501', message: `new row violates row-level security policy for table "${table}"` }); };
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me);
  if (p === '/rest/v1/rpc/can_use_vault') return json(200, !!me?.vault);
  if (p === '/rest/v1/rpc/can_use_client_vault') return json(200, vaultOf(me, db.clients.find((c) => c.id === body.p_client) || {}));
  if (p === '/rest/v1/rpc/access_reveal') {
    const a = db.client_access.find((x) => x.id === body.p_id);
    if (!a) return json(400, { message: 'access not found' });
    if (!vaultOf(me, db.clients.find((c) => c.id === a.client_id))) return json(400, { code: 'P0001', message: 'not allowed' });
    db.client_access_log.push({ id: db.client_access_log.length + 1, access_id: a.id, client_id: a.client_id, network: a.network, action: 'reveal', by_email: me.email, at: now });
    return json(200, secretOf(a));
  }
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { message: 'not found' });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single
    ? (rows.length === 1 ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` }))
    : json(200, rows));
  const visibleClient = (id) => sees(me, db.clients.find((c) => c.id === id) || {});

  if (req.method() === 'GET') {
    seen.push([me.person, table]);
    let rows = applyFilters(visibleRows(me, table), url.searchParams);
    if (table === 'protocol_log' || table === 'client_access_log') rows = [...rows].reverse();
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    return reply(rows.slice(off, off + lim));
  }
  if (req.method() === 'POST' && table === 'protocol_checks') {
    const list = Array.isArray(body) ? body : [body];
    if (!list.every((r) => visibleClient(r.client_id))) return rls(table);
    const out = [];
    for (const r of list) {
      const row = { ...r, by_email: me.email, at: now };
      const i = db.protocol_checks.findIndex((x) => x.client_id === r.client_id && x.item_key === r.item_key);
      if (i >= 0) db.protocol_checks[i] = row; else db.protocol_checks.push(row);
      db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: r.state, note: r.note, by_email: me.email, at: now });
      out.push(row);
    }
    return reply(out);
  }
  if (req.method() === 'DELETE' && table === 'protocol_checks') {
    const rows = applyFilters(visibleRows(me, table), url.searchParams); // hidden rows: nothing deleted, no error
    db.protocol_checks = db.protocol_checks.filter((r) => !rows.includes(r));
    for (const r of rows) db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: 'clear', note: null, by_email: me.email, at: now });
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  if (req.method() === 'POST' && table === 'client_tasks') {
    if (!visibleClient(body.client_id)) return rls(table);
    const row = { due_on: null, done_at: null, done_by_email: null, source: null, brief: null, urgent: false, ...body, id: randomUUID(), created_by_email: me.email, created_at: now };
    db.client_tasks.push(row);
    return reply([row]);
  }
  if (req.method() === 'PATCH' && table === 'client_tasks') {
    const rows = applyFilters(visibleRows(me, table), url.searchParams);
    for (const r of rows) { r.done_at = body.done_at ? now : null; r.done_by_email = body.done_at ? me.email : null; }
    return reply(rows);
  }
  if (req.method() === 'PATCH' && table === 'clients') {
    const rows = isOffice(me) ? applyFilters(db.clients, url.searchParams) : []; // the office only
    for (const r of rows) Object.assign(r, body);
    return reply(rows);
  }
  return json(405, { message: 'not in this fake' });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newPage({ viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time: NOW });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  return page;
}
async function signIn(page, path, person) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${person}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app:not([hidden]), .state.no-access');
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const text = (page, sel) => page.locator(sel).innerText();
const toastHas = (page, s) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), s);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const NO_ACCESS = 'אין לך גישה ללקוח הזה.';
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) { console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}`); throw err; }
  assert.deepEqual(errors, [], `page errors in: ${name}`);
  passed += 1;
  console.log(`ok - ${name}`);
}

// ── An editor ───────────────────────────────
const nadia = await newPage();
await step('an editor\'s "מה עליי" and client list hold only her clients, from rows the database returned', async () => {
  await signIn(nadia, 'clients.html#mine', 'nadia'); // an editor's first screen is editor.html
  await nadia.waitForSelector('#view-mine:not([hidden]) .wproc');
  const mine = await text(nadia, '#mine-list');
  assert.match(mine, /מספרת רון[^]*עריכת הסרטונים/);
  assert.match(mine, /קפה גליה[^]*לקצר את סרטון 4/);
  assert.doesNotMatch(mine, /פיצה נאפולי|סטודיו נטלי|בוטיק נטלי|מאפיית הכרמל/);
  await nadia.click('#tab-clients');
  await nadia.waitForSelector('.crow');
  assert.deepEqual((await nadia.locator('.crow strong').allInnerTexts()).sort(), ['מספרת רון', 'קפה גליה']);
  assert.ok(seen.some(([p, t]) => p === 'nadia' && t === 'clients'));
});

await step('opening a client that is not hers: "אין לך גישה ללקוח הזה", a way back to "מה עליי", nothing of the client', async () => {
  await nadia.goto(`${BASE}client.html?id=${pizza.id}`);
  await nadia.waitForSelector('.state.no-access');
  assert.equal(await nadia.isHidden('#app'), true);
  const st = await text(nadia, '#state');
  assert.match(st, new RegExp(`^${NO_ACCESS}`));
  assert.match(st, /עריכה ששויכה אליך, יום צילום קרוב או משימה שלך/);
  assert.doesNotMatch(st, /פיצה נאפולי/);
  assert.equal(await nadia.getAttribute('#state a', 'href'), 'clients.html#mine');
  assert.equal(await nadia.getAttribute('#state', 'role'), 'status');
  assert.match(await nadia.title(), /אין גישה ללקוח/);
  await shot(nadia, 'rls-01-no-access');
});

await step('on a phone the notice fits the screen and its link is a full-size target', async () => {
  const phone = await newPage({ viewport: { width: 360, height: 740 } });
  await signIn(phone, `client.html?id=${pizza.id}`, 'nadia');
  await phone.waitForSelector('.state.no-access');
  assert.ok(await noHScroll(phone));
  const box = await phone.locator('#state a').boundingBox();
  assert.ok(box.height >= 44, `link height ${box.height}`);
  await phone.focus('#state a');
  assert.equal(await phone.evaluate(() => document.activeElement.textContent), '→ מה עליי');
  await shot(phone, 'rls-02-no-access-phone');
  await phone.context().close();
});

await step('her own client opens as before: a check is saved in her name, and pausing the edit tells Lior and Ofir', async () => {
  await nadia.goto(`${BASE}client.html?id=${ron.id}`);
  await nadia.waitForSelector('#i-p22-received');
  assert.equal(await nadia.isHidden('#access'), true); // no vault flag
  // The office's columns never reach her (20260930210000_hardening.sql): not the client's phone, not the notes.
  const card = await text(nadia, '#cc-head');
  assert.doesNotMatch(card, /050-7654321|הערה של המשרד/);
  await nadia.check('#i-p22-received');
  await nadia.waitForFunction(() => document.querySelector('#i-p22-received')?.closest('.item').classList.contains('is-done') && !document.querySelector('.is-busy'));
  assert.equal(db.protocol_checks.find((c) => c.client_id === ron.id && c.item_key === 'p22.received')?.by_email, 'nadia@astrateg.test');
  // Pausing the edit opens tasks for Lior and Ofir on her client: allowed.
  await nadia.evaluate(() => { document.querySelector('#p22')?.closest('details')?.setAttribute('open', ''); });
  await nadia.click('#p22 button:has-text("עצירת העריכה")');
  await nadia.waitForSelector('#dlg-pause[open]');
  await nadia.fill('#pause-stage', 'חיתוך ראשון');
  await nadia.fill('#pause-left', 'כתוביות');
  await nadia.fill('#pause-why', 'סרטון דחוף ללקוח אחר');
  await nadia.click('#pause-submit');
  await toastHas(nadia, 'ליאור ואופיר עודכנו');
  assert.deepEqual(db.client_tasks.filter((t) => t.client_id === ron.id && t.source === 'pause').map((t) => [t.owner, t.created_by_email]).sort(),
    [['lior', 'nadia@astrateg.test'], ['ofir', 'nadia@astrateg.test']]);
  await nadia.click('#p22 .pause-line button:has-text("חזרה לעריכה")');
  await nadia.waitForFunction(() => !document.querySelector('#p22 .pause-line') && !document.querySelector('.is-busy'));
  db.client_tasks = db.client_tasks.filter((t) => t.source !== 'pause');
});

await step('the editing moves to someone else while her card is open: the next check is refused kindly and undone; reopening says she has no access', async () => {
  ron.editor = 'anna'; // Ofir reassigns the editing
  await nadia.click('#i-p22-check-footage');
  await toastHas(nadia, 'הסימון לא נשמר ולכן בוטל. אין לך הרשאה לפעולה הזו. אם העבודה בלקוח הועברה למישהו אחר, רעננו את הדף.');
  await nadia.waitForFunction(() => !document.querySelector('#i-p22-check-footage').checked && !document.querySelector('.is-busy'));
  assert.ok(refused.some(([p, t]) => p === 'nadia' && t === 'protocol_checks'));
  assert.equal(db.protocol_checks.some((c) => c.client_id === ron.id && c.item_key === 'p22.check.footage'), false);
  await nadia.reload();
  await nadia.waitForSelector('.state.no-access');
  assert.match(await text(nadia, '#state'), new RegExp(`^${NO_ACCESS}`));
  // Her list now holds only the client with her task.
  await nadia.goto(`${BASE}clients.html#clients`);
  await nadia.waitForSelector('.crow');
  assert.deepEqual(await nadia.locator('.crow strong').allInnerTexts(), ['קפה גליה']);
  ron.editor = 'nadia';
});

// ── An editor with nothing yet ──────────────
await step('an editor with no clients: friendly empty lists, no errors', async () => {
  const yariv = await newPage();
  await signIn(yariv, 'clients.html#mine', 'yariv');
  await yariv.waitForSelector('#mine-list .empty');
  assert.equal(await text(yariv, '#mine-list'), 'אין כרגע משהו פתוח אצלך.');
  await yariv.click('#tab-clients');
  await yariv.waitForSelector('#client-list .empty');
  assert.equal(await text(yariv, '#client-list'), 'אין כרגע לקוחות עם עבודה שלך.');
  await shot(yariv, 'rls-03-empty');
  await yariv.context().close();
});

// ── Nirel and the vault ─────────────────────
await step('Nirel opens a Natali client she does not edit, without its logins; her own client shows them; a task she opens for herself does not, a brief from Ofir does', async () => {
  const nirel = await newPage();
  await signIn(nirel, `client.html?id=${natOther.id}`, 'nirel');
  await nirel.waitForSelector('#cc-head h1, #cc-head .cc-name, #phases');
  assert.match(await text(nirel, '#cc-head'), /בוטיק נטלי/);
  assert.equal(await nirel.isHidden('#access'), true);
  await nirel.goto(`${BASE}client.html?id=${natEdit.id}`);
  await nirel.waitForSelector('#access:not([hidden]) .access-row');
  assert.equal(await nirel.locator('#access .access-row').count(), 1);
  await nirel.click('#access .access-row button:has-text("הצגת סיסמה")');
  await toastHas(nirel, 'הצפייה נרשמה');
  assert.match(await text(nirel, '#access .secret'), new RegExp(`pw-${natEdit.id.slice(0, 4)}`));
  // A client of neither kind.
  await nirel.goto(`${BASE}client.html?id=${pizza.id}`);
  await nirel.waitForSelector('.state.no-access');
  // A task she opened for herself on the other Natali client: her task shows, the logins do not.
  const task = (by) => ({ id: randomUUID(), client_id: natOther.id, title: `גרפיקה לסטורי (${by})`, owner: 'nirel', due_on: '2026-10-22', done_at: null, done_by_email: null, created_by_email: `${by}@astrateg.test`, created_at: hoursAgo(1), source: null, brief: null, urgent: false });
  db.client_tasks.push(task('nirel'));
  await nirel.goto(`${BASE}client.html?id=${natOther.id}`);
  await nirel.waitForFunction(() => /גרפיקה לסטורי \(nirel\)/.test(document.querySelector('#tasks:not([hidden])')?.textContent || ''));
  assert.equal(await nirel.isHidden('#access'), true);
  // A brief Ofir opened for her there: now the client is assigned to her, and its logins show.
  db.client_tasks.push(task('ofir'));
  await nirel.reload();
  await nirel.waitForSelector('#access:not([hidden]) .access-row');
  db.client_tasks = db.client_tasks.filter((t) => t.client_id !== natOther.id);
  await nirel.context().close();
});

// ── Eli ─────────────────────────────────────
await step('Eli sees the shoot coming up; a shoot from 12 days ago is no longer his', async () => {
  const eli = await newPage();
  await signIn(eli, 'clients.html#mine', 'eli'); // Eli's first screen is shoot.html
  await eli.waitForSelector('#view-mine:not([hidden]) .g-soon');
  assert.match(await text(eli, '#mine-list'), /מאפיית הכרמל/);
  assert.doesNotMatch(await text(eli, '#mine-list'), /גלידה ישנה/);
  await eli.goto(`${BASE}client.html?id=${oldShoot.id}`);
  await eli.waitForSelector('.state.no-access');
  await eli.goto(`${BASE}client.html?id=${soon.id}`);
  await eli.waitForSelector('#p17b', { state: 'attached' });
  await eli.context().close();
});

// ── The office ──────────────────────────────
await step('the office sees every client and its vault; a wrong link says "הלקוח לא נמצא" with a way back to the list', async () => {
  const irit = await newPage();
  await signIn(irit, 'clients.html#clients', 'irit');
  await irit.waitForSelector('.crow');
  assert.equal(await irit.locator('.crow').count(), db.clients.filter((c) => c.status === 'active').length);
  await irit.goto(`${BASE}client.html?id=${ron.id}`);
  await irit.waitForSelector('.cc-notes');
  assert.match(await text(irit, '#cc-head'), /050-7654321[^]*הערה של המשרד: לקוח רגיש למחיר/);
  await irit.goto(`${BASE}client.html?id=${pizza.id}`);
  await irit.waitForSelector('#access:not([hidden]) .access-row');
  await irit.goto(`${BASE}client.html?id=${randomUUID()}`);
  await irit.waitForSelector('.state.no-access');
  const st = await text(irit, '#state');
  assert.match(st, /^הלקוח לא נמצא\./);
  assert.doesNotMatch(st, /אין לך גישה/);
  assert.equal(await irit.getAttribute('#state a', 'href'), 'clients.html#clients');
  await irit.context().close();
});

await browser.close();
console.log(`\n${passed} steps passed`);
