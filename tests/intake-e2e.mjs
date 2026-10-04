// End-to-end check of the intake module against an in-memory fake of Supabase, with
// the browser's clock fixed on Tuesday 13.10.2026 at 11:40 in Israel:
//   - Ofir, on a 360px phone right after a meeting, taps "האפיון הסתיים" with the 4
//     short fields (the clocks start; the access goes to the vault), then fills the
//     full form, leaves, comes back to his draft restored, and saves it (process 4
//     checked, Irit's follow-up closed, missing material → a task for Irit, a
//     blocker → Lior);
//   - Lior fills the focus call (12א) and the scripts and Zoom (12, 13);
//   - an editor sees the focus call and the business phone on the card, read-only;
//   - Irit closes a shoot day with the coordinator (11), goes over the blockers (14),
//     does the day-before check (15) and takes a client's request (her section 17)
//     through to "לעדכן את הלקוח".
// Run: npx http-server -p 8123 -s . &  then  BASE_URL=http://localhost:8123/ node tests/intake-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { importKeys } from '../app/client-open.js';
import { PROCESSES } from '../app/protocol.js';
import { dayKeyIL } from '../app/tz.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-10-13T11:40:00+03:00'); // Tuesday
const serverNow = () => new Date(NOW); // the database's clock, the same moment
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;

// ── People ────────────────────────────────
const people = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia' };
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: person !== 'nadia', phone: null }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => staff.find((r) => r.email === u?.email)?.person ?? undefined;
const isOffice = (u) => { const p = personOf(u); return p === null || ['irit', 'lior', 'ofir', 'ilai'].includes(p); };

// ── Clients ───────────────────────────────
const client = (id, fields) => ({
  id, name: '', business: null, address: null, phone: null, package_name: null, shoot_type: 'dms', characterizer: 'ofir',
  has_logo: null, editor_name: null, editor: null, deal_at: '2026-10-01T09:00:00+03:00', char_at: null, shoot_at: null,
  contract_end: '2027-10-01', status: 'active', notes: null, quote_id: null, created_at: '2026-10-01T09:00:00+03:00',
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: { videos: 20 }, rounds: [], verified_at: null, verified_by: null, closed_reason: null,
  ...fields,
});
// A: the meeting is this morning (10:00), Ofir's; nothing after the meeting yet.
const A = client('aaaaaaaa-0000-4000-8000-000000000001', { name: 'מספרת רון', business: 'רון עיצוב שיער', phone: '050-1112222', char_at: '2026-10-13T10:00:00+03:00' });
// B: characterized Thursday 8.10; the content stage; the shoot on Thursday 15.10; Nadia will edit it.
const B = client('bbbbbbbb-0000-4000-8000-000000000002', { name: 'קפה גולן', business: 'קפה גולן בע״מ', phone: '052-3334444', address: 'הגליל 5, חיפה', char_at: '2026-10-08T10:00:00+03:00', shoot_at: '2026-10-15T11:00:00+03:00', editor: 'nadia', has_logo: true });
// C: the shoot is tomorrow (Wednesday 14.10): today is the day before.
const C = client('cccccccc-0000-4000-8000-000000000003', { name: 'מאפיית שי', phone: '054-5556666', address: 'הרצל 20, רמת גן', char_at: '2026-10-01T10:00:00+03:00', shoot_at: '2026-10-14T11:00:00+03:00', shoot_type: 'natali', has_logo: true });
// D: an ongoing client that sends a request.
const D = client('dddddddd-0000-4000-8000-000000000004', { name: 'גן ורד', phone: '053-7778888', char_at: '2026-08-01T10:00:00+03:00', shoot_at: '2026-08-10T11:00:00+03:00', has_logo: true });

const imported = (c, station) => importKeys(station).map((k) => ({ client_id: c.id, item_key: k, state: 'done', note: 'ייבוא', by_email: 'irit@astrateg.test', at: '2026-10-01T09:00:00+03:00' }));
const check = (c, key, note = null) => ({ client_id: c.id, item_key: key, state: 'done', note, by_email: 'lior@astrateg.test', at: '2026-10-13T09:00:00+03:00' });
const db = {
  staff,
  clients: [A, B, C, D],
  protocol_checks: [
    ...imported(A, 'char'),
    // B's shoot day (11) is still to be set (since protocol v6 it belongs to the first station, so the import would mark it).
    ...imported(B, 'content').filter((r) => !/^p11b?./.test(r.item_key)),
    ...imported(C, 'shoot'), check(C, 'p15.client'), check(C, 'p15.influencers'), check(C, 'p15.natali.makeup'), check(C, 'p15.natali.ride'),
    ...imported(D, 'ongoing'),
  ],
  characterizations: [{ client_id: B.id, fields: { phone: '03-7654321', logo_url: 'https://drive.google.com/golan-logo', services: 'קפה ומאפים', audiences: 'סטודנטים' }, completed_at: '2026-10-08T12:00:00+03:00', completed_by: 'ofir@astrateg.test', by_email: 'ofir@astrateg.test', at: '2026-10-08T12:00:00+03:00' }],
  content_briefs: [], client_tasks: [], client_access_log: [],
  // B's Instagram login stopped working yesterday: a shoot-day blocker.
  client_access: [{ id: 'acc-b-ig', client_id: B.id, network: 'instagram', label: null, username: 'golan.cafe', status: 'broken', note: null, updated_by: 'ilai@astrateg.test', updated_at: '2026-10-12T15:00:00+03:00', created_at: '2026-10-08T12:00:00+03:00', has_secret: null }], protocol_log: [], client_status_notes: [], office_reviews: [],
  quotes: [], client_messages: [], message_templates: [], client_questions: [], client_date_changes: [], reminder_log: [], push_subscriptions: [],
};
const secrets = new Map();

// Rows each person reads (row level security, as in the migrations): the office
// everything; an editor the clients she edits (and ones with a task of hers).
const visibleClient = (u, cid) => isOffice(u) || db.clients.some((c) => c.id === cid && c.editor === personOf(u)) || db.client_tasks.some((t) => t.client_id === cid && t.owner === personOf(u));
const CLIENT_TABLES = new Set(['protocol_checks', 'protocol_log', 'client_tasks', 'characterizations', 'content_briefs', 'client_access', 'client_access_log', 'client_status_notes', 'client_messages', 'client_date_changes']);
const OFFICE_WRITES = new Set(['characterizations', 'content_briefs', 'clients']);

function matches(r, k, v) {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('neq.')) return String(r[k]) !== v.slice(4);
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
  if (v.startsWith('gte.')) return r[k] !== null && r[k] !== undefined && String(r[k]) >= v.slice(4);
  if (v.startsWith('lte.')) return r[k] !== null && r[k] !== undefined && String(r[k]) <= v.slice(4);
  if (v.startsWith('like.')) { const re = new RegExp(`^${v.slice(5).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`); return re.test(String(r[k])); }
  if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')); return set.includes(String(r[k])); }
  return true;
}
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or') {
      const parts = v.slice(1, -1).split(',').map((s) => { const [col, ...rest] = s.split('.'); return [col, rest.join('.')]; });
      out = out.filter((r) => parts.some(([col, cond]) => matches(r, col, cond)));
    } else out = out.filter((r) => matches(r, k, v));
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split(',')[0].split('.');
    out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  return out;
}

// The database trigger client_requests_tell: a request done opens Irit's "tell" task.
function requestsTell(t, by) {
  if (t.source !== 'request' || !t.done_at) return;
  if (db.client_tasks.some((x) => x.source === 'tell' && !x.done_at && x.brief?.of === t.id)) return;
  db.client_tasks.push({
    id: randomUUID(), client_id: t.client_id, title: `לעדכן את הלקוח: ${t.title}`.slice(0, 500), owner: 'irit', due_on: dayKeyIL(serverNow()), done_at: null, done_by_email: null,
    source: 'tell', brief: { of: t.id, request: t.title, owner: t.owner, done_by: by }, urgent: false, started_at: null, created_by_email: by, created_at: serverNow().toISOString(),
  });
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
  const me = userOf(headers);
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
  const vault = !!me && staff.find((r) => r.email === me.email)?.vault;
  if (p === '/rest/v1/rpc/can_use_vault') return json(200, vault);
  if (p === '/rest/v1/rpc/can_use_client_vault') return json(200, vault && isOffice(me));
  if (p === '/rest/v1/rpc/access_save') {
    if (!vault || !isOffice(me)) return json(400, { message: 'not allowed' });
    let a = db.client_access.find((x) => x.id === body.p_id);
    const fields = { network: body.p_network, label: body.p_label || null, username: body.p_username || null, status: body.p_status || 'ok', note: body.p_note || null, updated_by: me.email, updated_at: serverNow().toISOString() };
    if (a) Object.assign(a, fields); else { a = { id: randomUUID(), client_id: body.p_client, has_secret: null, created_at: fields.updated_at, ...fields }; db.client_access.push(a); }
    if (body.p_password) { secrets.set(a.id, body.p_password); a.has_secret = randomUUID(); }
    return json(200, a.id);
  }
  if (p.startsWith('/rest/v1/rpc/')) return json(200, null);
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${m?.[1]}'` });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' })) : json(200, rows));
  const seen = (rows) => (table === 'clients' ? rows.filter((r) => visibleClient(me, r.id)) : CLIENT_TABLES.has(table) ? rows.filter((r) => visibleClient(me, r.client_id)) : rows);
  const now = serverNow().toISOString();
  const rls = () => json(403, { code: '42501', message: `new row violates row-level security policy for table "${table}"` });
  if (req.method() === 'GET') {
    let rows = seen(applyFilters(db[table], url.searchParams));
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    rows = rows.slice(off, off + lim);
    // maybeSingle(): an empty result is null.
    if (single && !rows.length && (headers.accept || '').includes('vnd.pgrst.object')) return json(406, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' });
    return reply(rows);
  }
  if (OFFICE_WRITES.has(table) && !isOffice(me)) return rls();
  if (req.method() === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const out = [];
    for (const r of rows) {
      if (CLIENT_TABLES.has(table) && !visibleClient(me, r.client_id)) return rls();
      if (table === 'protocol_checks') {
        if (r.state === 'na' && /^(r\d+\.)?p13\.approved$/.test(r.item_key)) return json(400, { code: '23514', message: 'new row for relation "protocol_checks" violates check constraint "protocol_checks_scripts_approval_real"' });
        const row = { client_id: r.client_id, item_key: r.item_key, state: r.state, note: r.note ?? null, by_email: me.email, at: now };
        const i = db.protocol_checks.findIndex((x) => x.client_id === r.client_id && x.item_key === r.item_key);
        if (i >= 0) db.protocol_checks[i] = row; else db.protocol_checks.push(row);
        db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: r.state, note: r.note ?? null, by_email: me.email, at: now });
        out.push(row);
      } else if (table === 'client_tasks') {
        const row = { due_on: null, done_at: null, done_by_email: null, source: null, brief: null, urgent: false, started_at: null, ...r, id: randomUUID(), created_by_email: me.email, created_at: now };
        db.client_tasks.push(row);
        out.push(row);
      } else if (table === 'characterizations') {
        const i = db.characterizations.findIndex((x) => x.client_id === r.client_id);
        const old = db.characterizations[i] || null;
        const completed = r.completed_at ? (old?.completed_at || now) : null;
        const row = { client_id: r.client_id, fields: r.fields, completed_at: completed, completed_by: completed ? (old?.completed_by || me.email) : null, by_email: me.email, at: now };
        if (i >= 0) db.characterizations[i] = row; else db.characterizations.push(row);
        out.push(row);
      } else if (table === 'content_briefs') {
        const i = db.content_briefs.findIndex((x) => x.client_id === r.client_id && x.round === r.round);
        const row = { client_id: r.client_id, round: r.round, fields: r.fields, by_email: me.email, at: now };
        if (i >= 0) db.content_briefs[i] = row; else db.content_briefs.push(row);
        out.push(row);
      } else return json(405, { message: `POST ${table} not in this fake` });
    }
    return reply(out);
  }
  if (req.method() === 'PATCH') {
    const rows = seen(applyFilters(db[table], url.searchParams));
    for (const r of rows) {
      const wasDone = !!r.done_at;
      Object.assign(r, body);
      if (table === 'clients') r.updated_at = now;
      if (table === 'client_tasks') {
        if (r.done_at && !wasDone) { r.done_at = now; r.done_by_email = me.email; requestsTell(r, me.email); }
        if (!r.done_at) r.done_by_email = null;
      }
    }
    return reply(rows);
  }
  if (req.method() === 'DELETE') {
    const rows = seen(applyFilters(db[table], url.searchParams));
    db[table] = db[table].filter((r) => !rows.includes(r));
    if (table === 'protocol_checks') for (const r of rows) db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: 'clear', note: null, by_email: me.email, at: now });
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  return json(405, {});
}

// ── Browser ───────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const PHONE = { width: 360, height: 740 };
async function newContext(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, hasTouch: viewport.width < 500, isMobile: viewport.width < 500 });
  await ctx.clock.setFixedTime(NOW);
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>wa</title>' }));
  await ctx.route('https://calendar.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>cal</title>' }));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, path, email) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app:not([hidden])');
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const shotOf = async (page, sel, name) => { if (OUT) await page.locator(sel).first().screenshot({ path: `${OUT}/${name}.png` }); };
const toastHas = (page, s) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), s);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
// Visible form controls without a name a screen reader can say (a <label>, aria-label(ledby) or title).
const unlabeled = (page) => page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
  .filter((e) => e.offsetParent && !e.closest('.sr-only'))
  .filter((e) => ![...(e.labels || [])].some((l) => l.textContent.trim()) && !e.getAttribute('aria-label')?.trim()
    && !(e.getAttribute('aria-labelledby') || '').split(/\s+/).some((id) => document.getElementById(id)?.textContent.trim()) && !e.title?.trim())
  .map((e) => `${e.tagName}#${e.id}.${e.className}`));
const checkOf = (c, key) => db.protocol_checks.find((x) => x.client_id === c.id && x.item_key === key) || null;
const heightOf = async (page, sel) => (await page.locator(sel).first().boundingBox())?.height || 0;
let passed = 0;
async function step(name, fn) { await fn(); passed += 1; console.log(`ok ${passed} - ${name}`); }

// ── Ofir on his phone ─────────────────────
const ofirCtx = await newContext(PHONE);
const ofir = await newPage(ofirCtx);

await step('"המשימות שלי": the characterization links straight to "האפיון הסתיים"', async () => {
  await signIn(ofir, 'clients.html#mine', 'ofir@astrateg.test');
  await ofir.waitForSelector('.wproc');
  const link = ofir.locator(`.wproc:has(a.wclient:text("${A.name}")) a.ik-go`).first();
  assert.equal(await link.innerText(), 'האפיון הסתיים');
  assert.ok(await heightOf(ofir, `.wproc:has(a.wclient:text("${A.name}")) a.ik-go`) >= 38);
  await link.click();
  await ofir.waitForSelector('#end-form');
  assert.match(ofir.url(), /intake\.html\?id=aaaaaaaa-0000-4000-8000-000000000001#end$/);
});

await step('"האפיון הסתיים" asks for the 4 short fields, in plain Hebrew, and marks what is missing', async () => {
  assert.ok(await noHScroll(ofir));
  assert.deepEqual(await unlabeled(ofir), [], 'form controls without a label');
  await ofir.click('#end-submit');
  await toastHas(ofir, 'חסרים פרטים');
  assert.equal(await ofir.getAttribute('#end-address', 'aria-invalid'), 'true');
  assert.equal(await ofir.evaluate(() => document.activeElement.id), 'end-address');
  assert.match(await ofir.locator('#end-phone-err').innerText(), /חסר טלפון העסק/);
  assert.match(await ofir.locator('#end-networks-err').innerText(), /לפחות רשת אחת/);
  assert.equal(checkOf(A, 'p04.ended'), null);
  // A wrong phone number is caught too.
  await ofir.fill('#end-address', 'הרצל 12, תל אביב');
  await ofir.fill('#end-phone', '123');
  await ofir.click('#end-submit');
  await ofir.waitForFunction(() => /לא נראה תקין/.test(document.getElementById('end-phone-err').textContent));
  assert.equal(await ofir.evaluate(() => document.activeElement.id), 'end-phone');
  await shot(ofir, '01-end-errors-360');
});

await step('with the 4 fields: the mark, the vault per network, process 5 and the client\'s details, at once', async () => {
  await ofir.fill('#end-phone', '03-5551234');
  await ofir.check('#end-has_logo-no');
  await ofir.check('#end-net-instagram-ok');
  await ofir.fill('#end-net-instagram-user', 'ron.hair');
  await ofir.fill('#end-net-instagram-pass', 'Secret-123');
  await ofir.check('#end-net-facebook-broken');
  await ofir.check('#end-net-tiktok-missing');
  assert.ok(await heightOf(ofir, '#end-submit') >= 44);
  await ofir.click('#end-submit');
  await toastHas(ofir, 'השעונים של עילאי, אופיר וליאור התחילו');
  await ofir.waitForSelector('#form-form');
  const ended = checkOf(A, 'p04.ended');
  assert.equal(ended.by_email, 'ofir@astrateg.test');
  assert.match(ended.note, /^האפיון הסתיים · לוגו: אין · Instagram: יש גישה תקינה, Facebook: יש גישה, לא עובדת, TikTok: אין רשת$/);
  assert.equal(checkOf(A, 'p05.access').state, 'done');
  assert.equal(checkOf(A, 'p05.vault').state, 'done');
  assert.equal(checkOf(A, 'p05.logo').state, 'na');
  const acc = db.client_access.filter((a) => a.client_id === A.id).map((a) => `${a.network}:${a.status}`).sort();
  assert.deepEqual(acc, ['facebook:broken', 'instagram:ok', 'tiktok:missing']);
  assert.equal(secrets.get(db.client_access.find((a) => a.client_id === A.id && a.network === 'instagram').id), 'Secret-123');
  assert.equal(db.clients.find((c) => c.id === A.id).address, 'הרצל 12, תל אביב');
  assert.equal(db.clients.find((c) => c.id === A.id).has_logo, false);
  assert.equal(db.characterizations.find((r) => r.client_id === A.id).fields.phone, '03-5551234');
  // The full form opens with the first empty field in focus, the address and phone carried over.
  assert.equal(await ofir.evaluate(() => document.activeElement.id), 'form-services');
  assert.equal(await ofir.inputValue('#form-address'), 'הרצל 12, תל אביב');
  assert.equal(await ofir.inputValue('#form-phone'), '03-5551234');
  assert.match(await ofir.locator('#form-progress').innerText(), /מולאו 2 מתוך 11/);
  assert.ok(await noHScroll(ofir));
  assert.deepEqual(await unlabeled(ofir), [], 'form controls without a label');
  await shot(ofir, '02-form-360');
});

await step('the full form keeps a draft on the phone: leaving and coming back restores it', async () => {
  await ofir.fill('#form-services', 'תספורות גברים ונשים, צבע');
  await ofir.fill('#form-audiences', 'גברים 25–45 בתל אביב');
  await ofir.waitForFunction(() => /טיוטה נשמרה בטלפון/.test(document.getElementById('form-draft').textContent));
  assert.match(await ofir.locator('#form-progress').innerText(), /מולאו 4 מתוך 11/);
  // Away to "המשימות שלי" (say, a call came in), and back from the link there.
  await ofir.goto(`${BASE}clients.html#mine`);
  await ofir.waitForSelector('.wproc');
  const back = ofir.locator(`.wproc:has(a.wclient:text("${A.name}")) a.ik-go`).first();
  assert.equal(await back.innerText(), 'לטופס האפיון');
  await back.click();
  await ofir.waitForSelector('#form-form');
  await ofir.waitForSelector('.ik-draft');
  assert.match(await ofir.locator('.ik-draft').innerText(), /שוחזרה טיוטה מהטלפון/);
  assert.equal(await ofir.inputValue('#form-services'), 'תספורות גברים ונשים, צבע');
  assert.equal(await ofir.inputValue('#form-audiences'), 'גברים 25–45 בתל אביב');
});

await step('saving the complete form checks process 4, closes Irit\'s follow-up, and asks for what is missing', async () => {
  const fill = { advantages: 'ספר עם 20 שנות ניסיון', goals: 'יותר תורים באמצע השבוע', offers: 'תספורת 80 ש״ח', content: 'לפני ואחרי',
    graphics: 'מחירון ושעות פתיחה', campaigns: 'לידים לתורים', special: 'לא לצלם לקוחות בלי אישור' };
  for (const [k, v] of Object.entries(fill)) await ofir.fill(`#form-${k}`, v);
  await ofir.fill('#form-colors', 'שחור וזהב');
  await ofir.check('#form-mat-photos-got');
  await ofir.check('#form-mat-videos-missing');
  await ofir.check('#form-mat-menu-none');
  await ofir.check('#form-blocking');
  await ofir.fill('#form-blocking_what', 'אין תמונות של המקום לגרפיקות של היום');
  assert.equal(await ofir.locator('#form-save').innerText(), 'שמירת טופס האפיון');
  await ofir.click('#form-save');
  await toastHas(ofir, 'טופס האפיון נשמר במלואו. המעקב של עירית נסגר.');
  const row = db.characterizations.find((r) => r.client_id === A.id);
  assert.ok(row.completed_at);
  assert.equal(row.fields.special, 'לא לצלם לקוחות בלי אישור');
  for (const k of ['p04.address', 'p04.phone', 'p04.services', 'p04.special', 'p04.saved']) assert.equal(checkOf(A, k)?.state, 'done', k);
  assert.equal(checkOf(A, 'p04.followup').note, 'נסגר אוטומטית מטופס האפיון');
  assert.equal(checkOf(A, 'p05.photos').state, 'done');
  assert.equal(checkOf(A, 'p05.menu').state, 'na');
  assert.equal(checkOf(A, 'p05.colors').state, 'done');
  const irit = db.client_tasks.find((t) => t.client_id === A.id && t.owner === 'irit');
  assert.equal(irit.title, 'להשלים מהלקוח: סרטונים קיימים'); // no logo: Ilai makes one, so it is not asked for
  assert.equal(irit.due_on, '2026-10-14');
  const lior = db.client_tasks.find((t) => t.client_id === A.id && t.owner === 'lior');
  assert.deepEqual([lior.source, lior.title], ['escalation', 'חסר מידע שחוסם עבודה היום: אין תמונות של המקום לגרפיקות של היום']);
  // The draft is gone; saving again opens no second task.
  assert.equal(await ofir.evaluate(() => localStorage.getItem('astrateg.charform.aaaaaaaa-0000-4000-8000-000000000001')), '');
  await ofir.click('#form-save');
  await toastHas(ofir, 'נשמר');
  assert.equal(db.client_tasks.filter((t) => t.client_id === A.id).length, 2);
  await shot(ofir, '03-form-saved-360');
});

await step('"האפיון הסתיים" shows what started, and the card shows the business phone, not a form to refill', async () => {
  await ofir.click('#tab-end');
  await ofir.waitForSelector('.ik-done');
  assert.match(await ofir.locator('.ik-done').innerText(), /השעונים התחילו: עילאי/);
  assert.match(await ofir.locator('.ik-done').innerText(), /טופס האפיון המלא נשמר/);
  await ofir.goto(`${BASE}client.html?id=${A.id}`);
  await ofir.waitForSelector('.ik-summary');
  assert.match(await ofir.locator('.ik-summary').innerText(), /03-5551234/);
  assert.ok(await noHScroll(ofir));
  assert.deepEqual(await unlabeled(ofir), [], 'form controls without a label');
  // The history names the mark in words.
  await ofir.waitForFunction(() => /סימן\/ה שהאפיון הסתיים/.test(document.getElementById('hist-list')?.textContent || ''));
});
await ofirCtx.close();

// ── Lior: the focus call, scripts and Zoom ─
const liorCtx = await newContext(PHONE);
const lior = await newPage(liorCtx);

await step('Lior\'s focus call (12א): the 10 topics, the two that matter to the editors first', async () => {
  await signIn(lior, `intake.html?id=${B.id}#focus`, 'lior@astrateg.test');
  await lior.waitForSelector('#focus-form');
  const labels = await lior.locator('#focus-form .ik-field label').allInnerTexts();
  // The free-text "סיכום דגשים" (also during the Zoom) first, then the 10 topics.
  assert.equal(labels.length, 11);
  assert.match(labels[0], /^סיכום דגשים$/);
  assert.match(labels[1], /אילו מסרים חייבים להופיע \(חייבים להגיד\)/);
  assert.match(labels[2], /דברים שאסור להגיד \(אסור להגיד\)/);
  // What the characterization said is at hand.
  await lior.click('.ik-context summary');
  assert.match(await lior.locator('.ik-context').innerText(), /קפה ומאפים/);
  await lior.fill('#focus-messages', 'יש חניה חינם מאחורי הקפה');
  await lior.fill('#focus-dont', 'לא להזכיר את הסניף שנסגר');
  await lior.fill('#focus-services', 'ארוחות בוקר');
  await lior.check('#focus-read');
  assert.ok(await noHScroll(lior));
  assert.deepEqual(await unlabeled(lior), [], 'form controls without a label');
  await lior.click('#focus-done');
  await toastHas(lior, 'שיחת הדגשים נשמרה והסתיימה');
  const brief = db.content_briefs.find((b) => b.client_id === B.id && b.round === 1);
  assert.deepEqual(brief.fields, { services: 'ארוחות בוקר', messages: 'יש חניה חינם מאחורי הקפה', dont: 'לא להזכיר את הסניף שנסגר' });
  assert.equal(checkOf(B, 'p12a.call').state, 'done');
  assert.equal(checkOf(B, 'p12a.read').state, 'done');
  assert.equal(checkOf(B, 'p12a.t.messages').state, 'done');
  assert.deepEqual([checkOf(B, 'p12a.t.faq').state, checkOf(B, 'p12a.t.faq').note], ['na', 'לא עלה בשיחה']);
  await shot(lior, '04-focus-360');
});

await step('scripts and Zoom (12, 13): the link to the client\'s links, the Zoom time, its recording, then the approval', async () => {
  await lior.click('#tab-scripts');
  await lior.waitForSelector('#sc-link');
  // Decision 14: the scripts were due at the end of business day 2 (yesterday, Monday 12.10).
  assert.match(await lior.locator('#sc-h + p').innerText(), /^באיחור: היעד היה אתמול\. היעד: סוף יום העסקים השני/);
  assert.match(await lior.locator('#zm-h + p').innerText(), /^עד היום\.$/); // the Zoom: day 3
  await lior.fill('#sc-link', 'https://docs.google.com/document/d/golan');
  await lior.click('#sc-save');
  await toastHas(lior, 'עכשיו לתאם זום');
  assert.equal(db.clients.find((c) => c.id === B.id).links.scripts, 'https://docs.google.com/document/d/golan');
  assert.equal(checkOf(B, 'p12.docs').note, 'https://docs.google.com/document/d/golan');
  await lior.check('#chk-p12-scripts');
  await lior.waitForFunction(() => document.getElementById('chk-p12-scripts')?.checked);
  await lior.check('#chk-p12-numbered');
  await lior.waitForFunction(() => document.getElementById('chk-p12-numbered')?.checked);
  // The approval waits for the Zoom's recording; it is never "not relevant".
  assert.equal(await lior.isDisabled('#zm-approved'), true);
  assert.equal(await lior.locator('text=לא רלוונטי').count(), 0);
  await lior.fill('#zm-at', '2026-10-13T16:00');
  await lior.click('#zm-save');
  await toastHas(lior, 'הזום נקבע');
  assert.equal(checkOf(B, 'p13.zoomat').note, new Date('2026-10-13T16:00:00+03:00').toISOString());
  assert.equal(await lior.locator('a:has-text("הוספה ליומן")').count(), 1);
  await lior.fill('#zm-rec', 'https://zoom.us/rec/share/golan');
  await lior.click('#zm-rec-save');
  await toastHas(lior, 'ההקלטה נשמרה');
  await lior.waitForSelector('#zm-approved:not([disabled])');
  await lior.click('#zm-approved');
  await lior.waitForSelector('.ik-approve .ok-line');
  assert.equal(checkOf(B, 'p13.approved').state, 'done');
  assert.ok(await noHScroll(lior));
  assert.deepEqual(await unlabeled(lior), [], 'form controls without a label');
  await shot(lior, '05-scripts-360');
});
await liorCtx.close();

// ── Nadia, the editor: read-only on the card ─
await step('the editor sees what must and must not be said, and the business phone, never the client\'s private phone', async () => {
  const ctx = await newContext(PHONE);
  const page = await newPage(ctx);
  await signIn(page, `client.html?id=${B.id}`, 'nadia@astrateg.test');
  await page.waitForSelector('.ik-summary .brief-view');
  const text = await page.locator('.ik-summary').innerText();
  assert.match(text, /חייבים להגיד\s*יש חניה חינם מאחורי הקפה/);
  assert.match(text, /אסור להגיד\s*לא להזכיר את הסניף שנסגר/);
  assert.match(text, /03-7654321/);
  assert.match(text, /הורדת הלוגו/);
  assert.doesNotMatch(await page.locator('#app').innerText(), /052-3334444/);
  // Nothing to fill for her: no forms, no links to the office's pages.
  assert.equal(await page.locator('.ik-summary a[href^="intake.html"], .ik-summary a[href^="prep.html"]').count(), 0);
  assert.ok(await noHScroll(page));
  assert.deepEqual(await unlabeled(page), [], 'form controls without a label');
  await shot(page, '06-editor-card-360');
  // The intake page itself is the office's.
  await page.goto(`${BASE}intake.html?id=${B.id}#focus`);
  await page.waitForFunction(() => /פתוחים לצוות המשרד/.test(document.getElementById('state').textContent));
  await ctx.close();
});

// ── Irit before the shoot day ─────────────
const iritCtx = await newContext(PHONE);
const irit = await newPage(iritCtx);

await step('the coordinator (11): a separate approval for each side; the day is closed only with all four and the calendar', async () => {
  await signIn(irit, 'prep.html', 'irit@astrateg.test');
  const card = `#shoot-${B.id.replace(/[^\w-]/g, '_')}-1`;
  await irit.waitForSelector(card);
  assert.match(await irit.locator(`${card} .pp-status`).first().innerText(), /עוד לא סגור · חסר: אישור לקוח, אישור משפיענים, אישור ליאור, אישור אלי/);
  const btn = (k) => `${card} #pty-${B.id.replace(/[^\w-]/g, '_')}-1-${k.replace(/\./g, '-')}`;
  for (const k of ['p11.ok.client', 'p11.ok.influencers', 'p11.ok.lior', 'p11.ok.photographer', 'p11.influencers']) {
    await irit.click(btn(k));
    await irit.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-pressed') === 'true' && !document.querySelector(sel).disabled, btn(k));
    assert.equal(checkOf(B, k)?.state, 'done', k);
  }
  assert.match(await irit.locator(`${card} .pp-status`).first().innerText(), /חסר: הכנסה ליומן/);
  assert.match(await irit.locator(btn('p11.ok.client')).innerText(), /אושר היום 11:40/);
  assert.ok(await heightOf(irit, btn('p11.ok.client')) >= 44);
  await irit.click(`#cal-${B.id.replace(/[^\w-]/g, '_')}-1`);
  await irit.waitForFunction((sel) => /היום סגור/.test(document.querySelector(sel)?.textContent || ''), `${card} .pp-status`);
  assert.equal(checkOf(B, 'p11.calendar').state, 'done');
  // Closed with everyone: folded to one line, the approvals a tap away.
  assert.equal(await irit.locator(`${card} details.pp-sub summary`).count(), 1);
  assert.ok(await noHScroll(irit));
  assert.deepEqual(await unlabeled(irit), [], 'form controls without a label');
  await shot(irit, '07-coordinator-360');
});

await step('the blockers (14): computed from what the system knows; "עברתי" for today, "דווח לליאור" opens an exception at once', async () => {
  const card = `#shoot-${B.id.replace(/[^\w-]/g, '_')}-1`;
  const list = await irit.locator(`${card} .pp-blocker`).allInnerTexts();
  assert.deepEqual(list.length, 1, list.join(' | '));
  assert.match(list[0], /גישות · ליאור\s*גישה לא עובדת: Instagram/);
  const row = `${card} .pp-blocker`;
  await irit.click(`${row} button:has-text("עברתי")`);
  await irit.waitForFunction((sel) => document.querySelector(sel)?.classList.contains('is-seen'), row);
  assert.deepEqual(JSON.parse(checkOf(B, 'p14.seen').note), { day: '2026-10-13', ids: ['access:acc-b-ig'] });
  await irit.click(`${row} button:has-text("דווח לליאור")`);
  await toastHas(irit, 'דווח לליאור');
  const esc = db.client_tasks.find((t) => t.client_id === B.id && t.brief?.blocker === 'access:acc-b-ig');
  assert.deepEqual([esc.owner, esc.source, esc.urgent], ['lior', 'escalation', true]); // the shoot is two business days away
  assert.equal(esc.title, 'חוסם ליום הצילום (יום ה׳ 15.10): גישה לא עובדת: Instagram');
  await irit.waitForFunction((sel) => /דווח לליאור .*נשאר כאן עד שהחריגה תיסגר/.test(document.querySelector(sel)?.textContent || ''), `${card} .pp-blocker.is-reported`);
  // Topics that are clear closed their item by themselves (the graphics were imported done).
  assert.equal(checkOf(B, 'p14.graphics')?.note, 'נסגר אוטומטית: אין חוסם');
  await shot(irit, '08-blockers-360');
  await shotOf(irit, card, '08b-card-B-360');
  // A has no card here, rightly: since protocol v6 the shoot-date process (11) belongs to the
  // first station, so A's import at the characterization station marked it done, and A has no
  // shoot ahead (prep.js entries()). A screenshot of that card used to wait here until it timed out.
  assert.equal(await irit.locator(`#shoot-${A.id.replace(/[^\w-]/g, '_')}-1`).count(), 0);
});

await step('the day-before check (15): what the system knows is filled in, Irit answers the rest, a failure goes to Lior', async () => {
  const k = `${C.id.replace(/[^\w-]/g, '_')}-1`;
  await irit.waitForSelector(`#db-done-${k}`);
  const items = await irit.locator(`#shoot-${k} .pp-check`).allInnerTexts();
  assert.ok(items.some((t) => /הלקוח אישר את התוכן\s*✓ המערכת יודעת/.test(t)), items.join(' | '));
  assert.ok(items.some((t) => /הצלם והצוות עודכנו\s*✗ לא בוצע/.test(t)));
  assert.ok(items.some((t) => /המאפרת וההסעה של נטלי אישרו\s*✓/.test(t)));
  assert.equal(await irit.isDisabled(`#db-done-${k}`), true); // two things only she can know
  await irit.check(`#db-${k}-address-ok`);
  await irit.check(`#db-${k}-remembers-ok`);
  await irit.waitForSelector(`#db-done-${k}:not([disabled])`);
  assert.match(await irit.locator(`#db-done-${k}`).innerText(), /שליחה לליאור \(1\)/);
  await irit.click(`#db-done-${k}`);
  await toastHas(irit, 'עברו לליאור');
  const note = JSON.parse(checkOf(C, 'p15.irit').note);
  assert.deepEqual(note.failed, ['crew']);
  const t = db.client_tasks.find((x) => x.client_id === C.id && x.owner === 'lior');
  assert.deepEqual([t.source, t.urgent], ['escalation', true]);
  assert.match(t.title, /^בדיקת יום לפני הצילום \(יום ד׳ 14\.10\) נכשלה: הצלם והצוות עודכנו$/);
  await irit.waitForFunction((sel) => /נכשלו ועברו לליאור: הצלם והצוות עודכנו/.test(document.querySelector(sel)?.textContent || ''), `#shoot-${k}`);
  // Its exception is Lior's now; it is not offered to her again as a blocker.
  assert.doesNotMatch(await irit.locator(`#shoot-${k}`).innerText(), /משימה דחופה: בדיקת יום לפני/);
  await shot(irit, '09-day-before-360');
  await shotOf(irit, `#shoot-${k}`, '09b-card-C-360');
});

await step('a client\'s request: one tap opens a task with an owner and a due day, with a ready "we got it"', async () => {
  await irit.goto(`${BASE}prep.html?id=${D.id}#requests`);
  await irit.waitForSelector('#rq-form');
  assert.equal(await irit.inputValue('#rq-client'), D.id);
  assert.equal(await irit.inputValue('#rq-due'), '2026-10-14'); // a business day (decision 29)
  await irit.click('#rq-submit');
  await irit.waitForSelector('#rq-text-err');
  assert.equal(await irit.getAttribute('#rq-text', 'aria-invalid'), 'true');
  await irit.fill('#rq-text', 'להעלות סטורי על מבצע החגים');
  await irit.selectOption('#rq-owner', 'ilai');
  await irit.click('#rq-submit');
  await toastHas(irit, 'נפתחה משימה לעילאי');
  const t = db.client_tasks.find((x) => x.client_id === D.id && x.source === 'request');
  assert.deepEqual([t.owner, t.due_on, t.title, t.urgent], ['ilai', '2026-10-14', 'להעלות סטורי על מבצע החגים', false]);
  const wa = await irit.getAttribute('#rq-ack-wa', 'href');
  assert.match(wa, /^https:\/\/wa\.me\/972537778888\?text=/);
  assert.match(decodeURIComponent(wa.split('?text=')[1]), /קיבלנו את הבקשה: "להעלות סטורי על מבצע החגים"\. הבקשה אצל עילאי, ונחזור אליכם עד יום ד׳ 14\.10\./);
  assert.match(await irit.locator('#requests').innerText(), /בקשות בטיפול \(1\)/);
  assert.ok(await noHScroll(irit));
  assert.deepEqual(await unlabeled(irit), [], 'form controls without a label');
  await shot(irit, '10-request-360');
  await shotOf(irit, '#requests', '10b-requests-360');
});

await step('when the request is done, Irit gets "לעדכן את הלקוח" with a ready message', async () => {
  // Ilai finishes it from his list (the database's trigger opens Irit's task).
  const ctx = await newContext();
  const ilai = await newPage(ctx);
  await signIn(ilai, 'clients.html#mine', 'ilai@astrateg.test');
  const item = ilai.locator('.witem:has-text("להעלות סטורי על מבצע החגים")');
  await item.locator('.cbx').waitFor();
  // The cards above the list (notifications, calendar, questions) load after it; the
  // list stays put once the page is quiet.
  await ilai.waitForLoadState('networkidle');
  // click(), not check(): the finished task leaves the list as soon as it is saved, and
  // check() then looks for the checkbox again to see it checked, until its timeout.
  await item.locator('.cbx').click();
  await toastHas(ilai, 'סומן כבוצע: להעלות סטורי על מבצע החגים');
  await item.waitFor({ state: 'detached' });
  await ctx.close();
  assert.ok(db.client_tasks.find((x) => x.client_id === D.id && x.source === 'request')?.done_at, 'the request is done');
  const tell = db.client_tasks.find((x) => x.source === 'tell' && x.client_id === D.id);
  assert.ok(tell, 'the tell task opened');
  await irit.click('#btn-refresh');
  await irit.waitForSelector('#tell-h');
  const row = irit.locator('.pp-request:has-text("לעדכן"), li[id^="tell-"]').first();
  assert.match(await row.innerText(), /טופל ע״י עילאי/);
  assert.match(await row.innerText(), /היי גן ורד, עדכון על הבקשה שלכם: "להעלות סטורי על מבצע החגים"\. טיפלנו בזה\./);
  await row.locator('button:has-text("עדכנתי את הלקוח")').click();
  await toastHas(irit, 'עודכן');
  assert.ok(db.client_tasks.find((x) => x.id === tell.id).done_at);
  assert.equal(await irit.locator('#tell-h').count(), 0);
});

await step('Irit\'s card for a client: the request and the shoot-day screens are one tap away', async () => {
  await irit.goto(`${BASE}client.html?id=${B.id}`);
  await irit.waitForSelector('#ik-request');
  assert.match(await irit.getAttribute('#ik-request', 'href'), /^prep\.html\?id=.*#requests$/);
  // Process 14 (still open) links to the blockers.
  await irit.waitForSelector('#p14 a.ik-go');
  assert.equal(await irit.locator('#p14 a.ik-go').innerText(), 'חוסמי יום צילום');
  assert.match(await irit.getAttribute('#p14 a.ik-go', 'href'), /^prep\.html\?id=/);
  // The client's approval of the scripts has no "not relevant" button.
  assert.equal(await irit.locator('#i-p13-approved-na').count(), 0);
  assert.ok(await noHScroll(irit));
  assert.deepEqual(await unlabeled(irit), [], 'form controls without a label');
});
await iritCtx.close();

await browser.close();
assert.deepEqual(errors, [], errors.join('\n'));
console.log(`intake e2e: ${passed} steps passed`);
