// Protocol v13 in the browser (docs/ops.md, section 119): Irit's lines of 3 and 11 with no checkbox, "1 מתוך 2",
// the next day of a package, the shoot dialog without approvals, the card; screenshots at 1366 and 390.
// Run: npx http-server -p 8080 . &  then  node tests/protocol-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { STATIONS } from '../app/protocol.js';
import { clientState } from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';
import { withClientColumns } from './fake-clients.mjs';
// These steps turn the one signed-in account into another person of the team while its
// tab stays open. In the office a role changes with a new sign-in; here the tab forgets
// what it kept for the role before (the session's store and the frame; docs/ops.md,
// section 60), so that each step opens as that person from its first paint.
const newRole = (p) => p.evaluate(() => { for (const k of Object.keys(sessionStorage)) if (k === 'astrateg.shell' || k.startsWith('astrateg.cache')) sessionStorage.removeItem(k); }).catch(() => {});

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const USER = { id: randomUUID(), email: 'irit@astrateg.test', aud: 'authenticated', role: 'authenticated' };
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

const hoursAgo = (n) => new Date(Date.now() - n * 36e5).toISOString();
const daysFromNow = (n, h = 10) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const signedQuote = { id: randomUUID(), number: 'AST-2026-0042', client_name: 'דנה לוי', signed_at: hoursAgo(1), status: 'signed',
  company: 'סטודיו דנה', phone: '050-1234567', tier: 'Social all in one', influencer: 'נטלי דדון', package_id: 'social-natali', term_months: 12,
  selection: { tier: 'social', influencer: 'natali', paid: ['natali-story'], free: { graphics: 4, simeonStories: 0, simeonJoin: false, extraCh14: false } } };

const db = {
  staff: [{ email: USER.email, person: 'irit', vault: true }],
  quotes: [signedQuote],
  clients: [],
  protocol_checks: [],
  protocol_log: [],
  client_tasks: [],
  client_access: [],
  client_access_log: [],
  client_status_notes: [],
};
const secrets = new Map();
let failNextCheck = false;

// Seed (protocol v13): one signed client with no meeting date, one past its characterization with no shoot
// date and two shoot days in the package, one whose day 1 was last month (day 2 of 2 is open to set).
const day = (d, h = 10) => { const x = new Date(Date.now() + d * 864e5); x.setHours(h, 0, 0, 0); return x.toISOString(); };
const baseRow = { phone: '052-0000000', package_name: 'Social · דניס, מישל וסמיון', shoot_type: 'dms', characterizer: 'noam', has_logo: true, editor_name: null,
  contract_end: '2027-09-20', status: 'active', notes: null, quote_id: null, created_by_email: USER.email, address: 'הרצל 10, תל אביב', links: {},
  rounds: [], verified_at: null, verified_by: null, closed_reason: null };
const noMeet = { ...baseRow, id: randomUUID(), name: 'פיצה נאפולי', business: 'פיצה נאפולי', deal_at: hoursAgo(3), created_at: hoursAgo(3), char_at: null, shoot_at: null, deliverables: { videos: 12, graphics: 12, shoot_days: 1 } };
const noShoot = { ...baseRow, id: randomUUID(), name: 'מספרת רון', business: 'רון עיצוב שיער', deal_at: hoursAgo(80), created_at: hoursAgo(80), char_at: hoursAgo(50), shoot_at: null, deliverables: { videos: 24, graphics: 24, shoot_days: 2 } };
const dayTwo = { ...baseRow, id: randomUUID(), name: 'קפה גולן', business: 'קפה גולן', deal_at: day(-70), created_at: day(-70), char_at: day(-65), shoot_at: day(-40), deliverables: { videos: 24, graphics: 24, shoot_days: 2 } };
db.clients.push(noMeet, noShoot, dayTwo);
const mark = (c, k, at) => db.protocol_checks.push({ client_id: c.id, item_key: k, state: 'done', note: null, by_email: 'ofir@astrateg.test', at });
mark(noMeet, 'p01.signed', hoursAgo(2));
for (const k of ['p01.signed', 'p04.ended', 'p04.saved', 'p05.access', 'p05.logo', 'p05.colors', 'p05.photos', 'p05.videos']) mark(noShoot, k, hoursAgo(49));
for (const k of ['p01.signed', 'p04.ended', 'p22a.assigned']) mark(dayTwo, k, day(-39));

function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith('neq.')) out = out.filter((r) => String(r[k]) !== v.slice(4));
    else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    else if (v === 'not.is.null') out = out.filter((r) => r[k] !== null && r[k] !== undefined);
    else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')); out = out.filter((r) => set.includes(String(r[k]))); }
    else if (v.startsWith('gte.')) out = out.filter((r) => String(r[k]) >= v.slice(4));
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
    if (body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: USER });
  }
  if (p === '/auth/v1/user') return json(200, USER);
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  const authed = (headers.authorization || '').includes(JWT);
  if (p === '/rest/v1/rpc/is_staff') return json(200, authed);
  // Access vault: the password never sits on the row, only in the secret store.
  const vaultOk = authed && db.staff[0].vault; // an admin-set flag, not the self-chosen person
  const logAccess = (a, action) => db.client_access_log.push({ id: db.client_access_log.length + 1, access_id: a.id, client_id: a.client_id, network: a.network, action, by_email: USER.email, at: new Date().toISOString() });
  if (p === '/rest/v1/rpc/can_use_vault') return json(200, vaultOk);
  // The note on a date change (20261006100100_date_change_note.sql).
  if (p === '/rest/v1/rpc/date_change_note') { dateNotes.push(body); return json(200, dateNotes.length); }
  if (p.startsWith('/rest/v1/rpc/access_') && !vaultOk) return json(400, { message: 'not allowed' });
  if (p === '/rest/v1/rpc/access_save') {
    let a = db.client_access.find((x) => x.id === body.p_id);
    const fields = { network: body.p_network, label: body.p_label || null, username: body.p_username || null, status: body.p_status || 'ok', note: body.p_note || null, updated_by: USER.email, updated_at: new Date().toISOString() };
    if (a) Object.assign(a, fields); else { a = { id: randomUUID(), client_id: body.p_client, has_secret: null, created_at: fields.updated_at, ...fields }; db.client_access.push(a); }
    if (body.p_password) { secrets.set(a.id, body.p_password); a.has_secret = randomUUID(); }
    logAccess(a, body.p_id ? 'update' : 'create');
    return json(200, a.id);
  }
  if (p === '/rest/v1/rpc/access_reveal') {
    const a = db.client_access.find((x) => x.id === body.p_id);
    if (!a) return json(400, { message: 'access not found' });
    logAccess(a, 'reveal');
    return json(200, secrets.get(a.id) ?? null);
  }
  if (p === '/rest/v1/rpc/access_delete') {
    const a = db.client_access.find((x) => x.id === body.p_id);
    if (a) { db.client_access = db.client_access.filter((x) => x !== a); secrets.delete(a.id); logAccess(a, 'delete'); }
    return json(200, null);
  }
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { message: 'not found' });
  if (!authed) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  const now = new Date().toISOString();

  if (req.method() === 'GET') {
    let rows = applyFilters(db[table], url.searchParams);
    if (table === 'protocol_log' || table === 'client_access_log') rows = [...rows].reverse();
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    return reply(rows.slice(off, off + lim));
  }
  if (req.method() === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const out = [];
    for (const r of rows) {
      if (table === 'protocol_checks') {
        if (failNextCheck) { failNextCheck = false; return json(500, { message: 'Failed to fetch' }); }
        const row = { ...r, by_email: USER.email, at: now };
        const i = db.protocol_checks.findIndex((x) => x.client_id === r.client_id && x.item_key === r.item_key);
        if (i >= 0) db.protocol_checks[i] = row; else db.protocol_checks.push(row);
        db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: r.state, note: r.note, by_email: USER.email, at: now });
        out.push(row);
      } else if (table === 'clients') {
        const row = { address: null, links: {}, deliverables: {}, rounds: [], verified_at: null, verified_by: null, closed_reason: null, business: null, phone: null, package_name: null, shoot_type: null, characterizer: null, has_logo: null, editor_name: null, char_at: null, shoot_at: null, contract_end: null, status: 'active', notes: null, quote_id: null, deal_at: now, ...r, id: randomUUID(), created_at: now, created_by_email: USER.email };
        db.clients.push(row);
        out.push(row);
      } else if (table === 'client_tasks') {
        const row = { due_on: null, done_at: null, done_by_email: null, source: null, brief: null, urgent: false, ...r, id: randomUUID(), created_by_email: USER.email, created_at: now };
        db.client_tasks.push(row);
        out.push(row);
      } else if (table === 'client_status_notes') {
        const row = { ...r, by_email: USER.email, at: now };
        const i = db.client_status_notes.findIndex((x) => x.client_id === r.client_id && x.week === r.week);
        if (i >= 0) db.client_status_notes[i] = row; else db.client_status_notes.push(row);
        out.push(row);
      }
    }
    return reply(out);
  }
  if (req.method() === 'PATCH') {
    const rows = applyFilters(db[table], url.searchParams);
    for (const r of rows) {
      Object.assign(r, body);
      if (table === 'client_tasks') r.done_by_email = r.done_at ? USER.email : null;
    }
    return reply(rows);
  }
  if (req.method() === 'DELETE') {
    const rows = applyFilters(db[table], url.searchParams);
    db[table] = db[table].filter((r) => !rows.includes(r));
    if (table === 'protocol_checks') for (const r of rows) db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: 'clear', note: null, by_email: USER.email, at: now });
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  return json(405, {});
}

const dateNotes = []; // what the card asked to keep in the date-change history
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
// Ids used in a dialog or a form that appear more than once on the page.
const duplicateIds = (pg) => pg.evaluate(() => {
  const count = new Map();
  for (const el of document.querySelectorAll('[id]')) count.set(el.id, (count.get(el.id) || 0) + 1);
  return [...new Set([...document.querySelectorAll('dialog [id], form [id], dialog[id], form[id]')].map((el) => el.id))].filter((id) => count.get(id) > 1);
});
const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 1280, height: 900 } });
// These checks walk the whole list of "המשימות שלי" ("תצוגה מלאה"); the short one is tests/roles-phone-e2e.mjs.
await ctx.addInitScript(() => { try { sessionStorage.setItem('astrateg.mine.full', 'on'); } catch { /* no storage */ } });
await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const shot = async (name, pg = page) => { if (OUT) await pg.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const noHScroll = async (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

const signIn = async () => {
  await page.goto(`${BASE}clients.html`);
  await page.fill('#lg-email', USER.email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForSelector('#view-mine:not([hidden]) .wproc');
  await page.waitForSelector('#login-block', { state: 'hidden' }).catch(() => {});
  await page.waitForTimeout(1500); // the door's fade
};
await signIn();
const mine = await page.locator('#mine-list').innerText();
// 3: one line, no checkbox. 11: one line with "1 מתוך 2". The next day of a package: its own line.
assert.match(mine, /לקבוע אפיון לפיצה נאפולי/);
assert.match(mine, /לקבוע לרון עיצוב שיער · מספרת רון יום צילום 1 מתוך 2/);
assert.match(mine, /לקבוע לקפה גולן יום צילום 2 מתוך 2/);
for (const gone of ['פתיחת קבוצת WhatsApp', 'הלקוח אישר את המועד', 'נבדקה זמינות מבצע האפיון', 'החוזה נשלח ללקוח', 'מעקב לפני צילום']) assert.doesNotMatch(mine, new RegExp(gone), gone);
assert.equal(await page.locator('.wproc:has-text("פיצה נאפולי") .cbx').count(), 0, 'nothing to tick on the meeting line');
for (const w of [1366, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(300);
  assert.ok(await noHScroll(page), `no sideways scroll at ${w}`);
  await shot(`v13-irit-mine-${w}`);
}
// The shoot dialog: when and with whom, no approvals.
await page.setViewportSize({ width: 1366, height: 900 });
await page.locator('.wproc:has-text("מספרת רון") button:has-text("קביעת יום צילום")').first().click();
await page.waitForSelector('#dlg-shoot[open]');
assert.equal(await page.locator('#dlg-shoot .chip[data-key^="p11."]').count(), 0, 'no approval chips');
await shot('v13-shoot-dialog-1366');
await page.fill('#shoot-at', day(5).slice(0, 16));
await page.selectOption('#shoot-type', 'dms');
await page.click('#shoot-submit');
await page.waitForFunction(() => document.querySelector('#toast.on')?.textContent.includes('יום הצילום נשמר'));
assert.ok(db.clients.find((c) => c.id === noShoot.id).shoot_at, 'the date is saved');
assert.ok(!db.protocol_checks.some((c) => c.client_id === noShoot.id && /^p11\./.test(c.item_key)), 'nothing marked');
assert.doesNotMatch(await page.locator('#mine-list').innerText(), /לקבוע לרון עיצוב שיער/, 'the line closed by itself');
// The client card of the client with two shoot days.
for (const w of [1366, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(`${BASE}client.html?id=${noShoot.id}`);
  await page.waitForSelector('#phases .proc, .phase');
  await page.waitForTimeout(400);
  assert.ok(await noHScroll(page), `card: no sideways scroll at ${w}`);
  if (OUT) await page.screenshot({ path: `${OUT}/v13-client-card-${w}.png` });
  await page.locator('#p11').scrollIntoViewIfNeeded().catch(() => {});
  if (OUT) await page.screenshot({ path: `${OUT}/v13-client-card-p11-${w}.png` });
}
// "לקבוע יום צילום 2 מתוך 2" opens the round's dialog in the card.
await page.setViewportSize({ width: 1366, height: 900 });
await page.goto(`${BASE}client.html?id=${dayTwo.id}#add-round`);
await page.waitForSelector('#dlg-round[open]');
await shot('v13-add-round-1366');
assert.deepEqual(errors, []);
noCspViolations();
await browser.close();
console.log('protocol-v13-e2e: all checks passed');
