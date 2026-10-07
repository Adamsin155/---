// End-to-end check of package 1 of the protocol audit (docs/ops.md, section 37)
// against an in-memory fake of Supabase (the database and Storage), with the
// browser's clock fixed on Tuesday 13.10.2026 at 11:40 in Israel:
//   - Nadia, on her own page: the upload area of the round's finished videos; "מוכן
//     לבדיקה" is locked, with why, until one is up; a failed upload says what to do
//     and opens nothing; two videos go up, the count against the package, the button
//     opens; the general lists point to her page instead of offering the mark;
//   - Ofir's quality-control dialog shows those videos, played in place, read-only;
//   - after the client's notes the final hand-off waits for a file uploaded since;
//   - Ilai: the graphics upload in his card with "מוכן לבדיקה (לעירית)" locked until
//     a graphic is up, the editor's final versions in his card, and the client's
//     characterization, read-only, one tap away; an editor still gets no such page;
//   - Eli: the scripts of his shoot day behind one button, read-only; and a plain
//     message while the database function is not there yet.
// Every screen at 390px and at 1366px, with no sideways scroll on the phone.
// Run: npx http-server -p 8421 -s -c-1 . &  then  BASE_URL=http://localhost:8421/ node tests/package1-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withClientColumns } from './fake-clients.mjs';
import { importKeys } from '../app/client-open.js';
import { PROCESSES } from '../app/protocol.js';
import { uploadKinds, isManager } from '../app/files-logic.js';
import { FORM_FIELDS } from '../app/characterization.js';

const BASE = process.env.BASE_URL || 'http://localhost:8421/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const T = (s) => new Date(`${s}+03:00`);
const NOW = T('2026-10-13T11:40:00'); // Tuesday
let serverTime = NOW.getTime(); // the database's clock: moved on by the steps
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;
const SUPA = 'https://czncjzziqrqtezpwxxpz.supabase.co';

// ── People ────────────────────────────────
const PEOPLE = { owner: null, irit: 'irit', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', yariv: 'yariv', eli: 'eli' };
const users = new Map(Object.keys(PEOPLE).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(PEOPLE).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: false, phone: null }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => staff.find((r) => r.email === u?.email)?.person ?? undefined;
const isOffice = (u) => { const p = personOf(u); return p === null || ['irit', 'lior', 'ofir', 'ilai'].includes(p); };

// ── Clients ───────────────────────────────
const client = (id, fields) => ({
  id, name: '', business: null, address: null, phone: null, package_name: 'Social', shoot_type: 'dms', characterizer: 'ofir',
  has_logo: true, editor_name: null, editor: null, deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-09-03T10:00:00+03:00', shoot_at: null,
  contract_end: '2027-09-01', status: 'active', notes: null, quote_id: null, created_at: '2026-09-01T09:00:00+03:00', created_by_email: 'irit@astrateg.test',
  links: {}, deliverables: { videos: 3, graphics: 12, shoot_days: 1 }, rounds: [], verified_at: null, verified_by: null, closed_reason: null, ...fields,
});
// D: in editing with Nadia since Monday. M: characterized this morning (Ilai's day).
// G: Eli's shoot day on Thursday. X: Yariv's client, not Nadia's.
const D = client('dddddddd-0000-4000-8000-000000000001', { name: 'קפה דנה', business: 'קפה דנה בע״מ', address: 'הרצל 1, חיפה', editor: 'nadia', shoot_at: '2026-10-08T11:00:00+03:00' });
const M = client('eeeeeeee-0000-4000-8000-000000000002', { name: 'מאפיית שחר', deal_at: '2026-10-12T09:00:00+03:00', created_at: '2026-10-12T09:00:00+03:00', char_at: '2026-10-13T08:00:00+03:00' });
const G = client('ffffffff-0000-4000-8000-000000000003', { name: 'סטודיו גל', address: 'הנביאים 5, חיפה', shoot_at: '2026-10-15T11:00:00+03:00' });
const X = client('aaaaaaaa-0000-4000-8000-000000000004', { name: 'חנות הים', editor: 'yariv', shoot_at: '2026-10-07T11:00:00+03:00' });

const itemsOf = (ids) => PROCESSES.filter((p) => ids.includes(p.id)).flatMap((p) => p.items.map((i) => i.key));
const EDITING = new Set(itemsOf(['p22a', 'p22', 'p23', 'p23b', 'p24', 'p25', 'p26', 'p27']));
const SHOOTDAY = new Set(itemsOf(['p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p20', 'p21']));
const imported = (c, station, skip = new Set()) => importKeys(station).filter((k) => !skip.has(k))
  .map((k) => ({ client_id: c.id, item_key: k, state: 'done', note: 'ייבוא', by_email: 'irit@astrateg.test', at: '2026-09-02T09:00:00+03:00' }));
const check = (c, key, at, note = null, by = 'ofir@astrateg.test') => ({ client_id: c.id, item_key: key, state: 'done', note, by_email: by, at: T(at).toISOString() });
const CHAR = {
  address: 'הרצל 1, חיפה', phone: '04-8123456', services: 'קפה, מאפים וארוחות בוקר', audiences: 'משפחות וסטודנטים מהשכונה', advantages: 'קלייה במקום',
  goals: 'יותר הזמנות בבוקר', offers: 'קפה ומאפה ב־19 ₪', content: 'סרטוני הכנה קצרים', graphics: 'פוסטים למבצעים, בצבעי המותג', campaigns: 'קמפיין פתיחה',
  special: 'לא להראות את המטבח האחורי', colors: 'חום קפה וקרם', logo_url: 'https://example.com/logo-dana.png', materials: { photos: 'got', videos: 'missing', menu: 'none' },
};
const db = {
  staff,
  clients: [D, M, G, X],
  protocol_checks: [
    ...imported(D, 'post', EDITING),
    check(D, 'p22a.assigned', '2026-10-12T10:00:00'), check(D, 'p22a.load', '2026-10-12T10:00:00'),
    ...['p22.received', 'p22.check.footage', 'p22.check.scripts', 'p22.check.logo', 'p22.check.phone'].map((k) => check(D, k, '2026-10-12T12:00:00', null, 'nadia@astrateg.test')),
    ...imported(M, 'char'),
    ...itemsOf(['p04']).map((k) => check(M, k, '2026-10-13T10:00:00')), check(M, 'p04.ended', '2026-10-13T09:50:00', 'האפיון הסתיים · לוגו: יש'), check(M, 'p05.access', '2026-10-13T09:50:00'),
    ...imported(G, 'shoot', SHOOTDAY),
    ...imported(X, 'post', EDITING), check(X, 'p22a.assigned', '2026-10-09T10:00:00'),
  ],
  characterizations: [
    { client_id: D.id, fields: CHAR, completed_at: '2026-09-03T12:00:00+03:00', completed_by: 'ofir@astrateg.test', by_email: 'ofir@astrateg.test', at: '2026-09-03T12:00:00+03:00' },
    { client_id: M.id, fields: { ...CHAR, address: 'העצמאות 9, עכו', services: 'לחמים ועוגות', special: '' }, completed_at: null, completed_by: null, by_email: 'ofir@astrateg.test', at: '2026-10-13T10:00:00+03:00' },
  ],
  client_files: [
    // The client's photo, from the characterization (a material: Ilai sees it, and may not add one).
    { id: randomUUID(), client_id: D.id, kind: 'image', label: null, storage_path: `${D.id}/image/11111111-1111-4111-8111-111111111111-front.jpg`, mime: 'image/jpeg', size_bytes: 3000, posted_on: null, link: null, uploaded_by: 'ofir@astrateg.test', created_at: '2026-09-03T11:00:00+03:00', deleted_at: null },
  ],
  client_tasks: [], protocol_log: [], content_briefs: [], client_access: [], client_access_log: [], client_status_notes: [], office_reviews: [], quotes: [],
  client_messages: [], message_templates: [], client_questions: [], client_date_changes: [], reminder_log: [], push_subscriptions: [], client_gallery_links: [],
  client_status_links: [], office_passes: [], task_decisions: [], change_requests: [],
};
const SCRIPTS = [
  { round: 1, n: 1, title: 'פתיחה', body: 'גל פותחת את הדלת ומזמינה פנימה.\nשוט רחב, ואז תקריב.', links: ['https://www.instagram.com/reel/abc'], status: 'approved' },
  { round: 1, n: 2, title: 'מבצע החודש', body: 'שתיים במחיר אחת, עד סוף החודש.', links: [], status: 'draft' },
];
const objects = new Map(); // storage path -> { type, owner }
for (const f of db.client_files) objects.set(f.storage_path, { type: f.mime, owner: f.uploaded_by });
const flags = { failUploads: 0, scriptsFunction: true };
const inShootWindow = (c) => { const d = (new Date(c.shoot_at) - NOW) / 864e5; return !!c.shoot_at && d >= -8 && d <= 31; };
const visibleClient = (u, cid) => {
  const c = db.clients.find((x) => x.id === cid);
  const p = personOf(u);
  return !!c && (isOffice(u) || c.editor === p || (p === 'eli' && inShootWindow(c)));
};
const CLIENT_TABLES = new Set(['protocol_checks', 'protocol_log', 'client_tasks', 'characterizations', 'content_briefs', 'client_access', 'client_access_log', 'client_files']);

function matches(r, k, v) {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('neq.')) return String(r[k]) !== v.slice(4);
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
  if (v.startsWith('gte.')) return r[k] !== null && r[k] !== undefined && String(r[k]) >= v.slice(4);
  if (v.startsWith('lte.')) return r[k] !== null && r[k] !== undefined && String(r[k]) <= v.slice(4);
  if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')); return set.includes(String(r[k])); }
  return true;
}
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns', 'or'].includes(k)) continue;
    out = out.filter((r) => matches(r, k, v));
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split(',')[0].split('.');
    out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  const off = Number(params.get('offset') || 0);
  return out.slice(off, off + Number(params.get('limit') || 1e9));
}

// ── The fake ──────────────────────────────
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'location, upload-offset, tus-resumable, content-range' };
const CLIENT_SHAPE = { clients: () => db.clients, staff: () => db.staff };
async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const headers = req.headers();
  const isJson = /json/.test(headers['content-type'] || '') || req.method() === 'GET';
  let body = null;
  if (isJson && req.postData()) { try { body = JSON.parse(req.postData()); } catch { body = null; } }
  const json = (status, data, extra = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { ...CORS, ...extra } });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS, body: '' });
  const p = url.pathname;
  const me = userOf(headers);
  const now = new Date(serverTime).toISOString();

  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });

  // ── Storage: as the bucket's policies (20261003110000_client_files.sql) ──
  const mayUpload = (path) => {
    const [cid, kind] = path.split('/');
    const c = db.clients.find((x) => x.id === cid);
    return !!me && !!c && visibleClient(me, cid) && uploadKinds(personOf(me), c).includes(kind);
  };
  let m = /^\/storage\/v1\/object\/sign\/client-files\/(.+)$/.exec(p);
  if (m && req.method() === 'POST') {
    const path = decodeURIComponent(m[1]);
    const row = db.client_files.find((f) => f.storage_path === path);
    if (!me || !row || !visibleClient(me, row.client_id) || row.deleted_at) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    return json(200, { signedURL: `/${body?.transform ? 'render/image/sign' : 'object/sign'}/client-files/${path}?token=signed` });
  }
  if ((m = /^\/storage\/v1\/(object|render\/image)\/sign\/client-files\/(.+)$/.exec(p)) && req.method() === 'GET') {
    const o = objects.get(decodeURIComponent(m[2]));
    if (!o) return route.fulfill({ status: 404, headers: CORS, body: '' });
    if (/^image\//.test(o.type)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: CORS, body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="#5302DF"/><circle cx="160" cy="140" r="60" fill="#fff" opacity=".85"/></svg>' });
    return route.fulfill({ status: 200, contentType: o.type || 'application/octet-stream', headers: CORS, body: Buffer.alloc(16) });
  }
  m = /^\/storage\/v1\/object\/client-files\/(.+)$/.exec(p);
  if (m && req.method() === 'POST') {
    const path = decodeURIComponent(m[1]);
    if (flags.failUploads > 0) { flags.failUploads -= 1; return json(500, { statusCode: '500', error: 'Internal', message: 'storage is down' }); }
    if (!mayUpload(path)) return json(400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    objects.set(path, { type: headers['content-type'], owner: me.email });
    return json(200, { Key: `client-files/${path}` });
  }
  if (p === '/storage/v1/object/client-files' && req.method() === 'DELETE') return json(200, []);

  // ── Functions in the database ──
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(p)?.[1];
  if (rpc) {
    if (rpc === 'is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
    if (!me) return json(401, { code: '42501', message: 'permission denied' });
    if (rpc === 'can_use_vault' || rpc === 'can_use_client_vault') return json(200, false);
    if (rpc === 'access_status_for_work') return json(200, []);
    // public.shoot_scripts: Eli alone, and only a client of a shoot day of his.
    if (rpc === 'shoot_scripts') {
      if (!flags.scriptsFunction) return json(404, { code: 'PGRST202', message: 'Could not find the function public.shoot_scripts' });
      const c = db.clients.find((x) => x.id === body.p_client);
      if (personOf(me) !== 'eli' || !c || !inShootWindow(c)) return json(200, null);
      return json(200, { client: { name: c.name, business: c.business || c.name }, rounds: [1], scripts: c.id === G.id ? SCRIPTS : [] });
    }
    return json(404, { code: 'PGRST202', message: 'not found' });
  }

  // ── Tables ──
  const t = /^\/rest\/v1\/(\w+)$/.exec(p)?.[1];
  if (!t || !db[t]) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${t}'` });
  if (!me) return json(401, { message: 'permission denied' });
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' })) : json(200, rows));
  const seen = (rows) => (t === 'clients' ? rows.filter((r) => visibleClient(me, r.id)) : CLIENT_TABLES.has(t) ? rows.filter((r) => visibleClient(me, r.client_id)) : rows);
  if (req.method() === 'GET') return reply(seen(applyFilters(db[t], url.searchParams)));
  const rls = () => json(403, { code: '42501', message: `new row violates row-level security policy for table "${t}"` });
  if (t === 'client_files' && req.method() === 'POST') {
    const out = [];
    for (const r of Array.isArray(body) ? body : [body]) {
      const c = db.clients.find((x) => x.id === r.client_id);
      if (!c || !visibleClient(me, c.id) || !uploadKinds(personOf(me), c).includes(r.kind)) return rls();
      const row = { id: randomUUID(), label: null, mime: null, size_bytes: null, posted_on: null, link: null, ...r, uploaded_by: me.email, created_at: new Date(serverTime + db.client_files.length * 1000).toISOString(), deleted_at: null };
      db.client_files.push(row);
      out.push(row);
    }
    return reply(out);
  }
  if (t === 'client_files' && req.method() === 'PATCH') {
    const rows = seen(applyFilters(db[t], url.searchParams));
    for (const r of rows) {
      if (!(isManager(personOf(me)) || r.uploaded_by === me.email)) return json(403, { code: '42501', message: 'not allowed: only the office or the uploader' });
      Object.assign(r, body, body.deleted_at ? { deleted_at: now } : {});
    }
    return reply(rows);
  }
  if (t === 'protocol_checks' && req.method() === 'POST') {
    const out = [];
    for (const r of Array.isArray(body) ? body : [body]) {
      if (!visibleClient(me, r.client_id)) return rls();
      db.protocol_checks = db.protocol_checks.filter((x) => !(x.client_id === r.client_id && x.item_key === r.item_key));
      const row = { ...r, note: r.note ?? null, by_email: me.email, at: now };
      db.protocol_checks.push(row);
      out.push(row);
    }
    return reply(out);
  }
  if (req.method() === 'POST' && ['characterizations', 'client_tasks'].includes(t)) return rls(); // nothing in this suite writes them
  return json(200, []);
}

// ── Browser ───────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1366, height: 900 };
async function newContext(viewport = PHONE) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, hasTouch: viewport.width < 500, isMobile: viewport.width < 500 });
  await ctx.clock.setFixedTime(NOW);
  await ctx.route(`${SUPA}/**`, withClientColumns(fakeSupabase, CLIENT_SHAPE));
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>wa</title>' }));
  await ctx.route('https://example.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>x</title>' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}
async function signIn(page, path, who) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app:not([hidden])');
}
const toastHas = (page, s) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), s);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const text = (page, sel) => page.locator(sel).first().innerText();
// The same screen on the phone and on a desktop (the page is drawn once, then resized).
async function shots(page, name, { scrollTo = null } = {}) {
  if (!OUT) return;
  for (const [tag, vp] of [['390', PHONE], ['1366', DESK]]) {
    await page.setViewportSize(vp);
    if (scrollTo) await page.locator(scrollTo).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
  }
  await page.setViewportSize(PHONE);
}
const png = (n = 2000) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(n)]);
const mp4 = (n = 4000) => Buffer.concat([Buffer.from('000000186674797069736f6d', 'hex'), Buffer.alloc(n - 12)]);
const checkOf = (c, key) => db.protocol_checks.find((x) => x.client_id === c.id && x.item_key === key && x.state === 'done');
const set = (c, key, by, note = null) => { db.protocol_checks = db.protocol_checks.filter((x) => !(x.client_id === c.id && x.item_key === key)); db.protocol_checks.push({ client_id: c.id, item_key: key, state: 'done', note, by_email: `${by}@astrateg.test`, at: new Date(serverTime).toISOString() }); };
const liveVideos = () => db.client_files.filter((f) => f.client_id === D.id && f.kind === 'deliverable_video' && !f.deleted_at);
let passed = 0;
async function step(name, fn) { await fn(); passed += 1; console.log(`ok ${passed} - ${name}`); }

// ── Nadia: the finished videos, uploaded on her own page ──
const card = `#c-${D.id}`;
const nadia = (await newContext()).page;
await step('the editor\'s card has the upload area; "מוכן לבדיקה" is locked, with why, until a video is up', async () => {
  await signIn(nadia, 'editor.html', 'nadia');
  await nadia.waitForSelector(`${card}-v-files .fl-work-h`);
  await nadia.waitForFunction((s) => /עוד לא הועלה כלום/.test(document.querySelector(s)?.textContent || ''), `${card}-v-files .fl-work-h`);
  assert.equal(await text(nadia, `${card}-v-files .fl-work-h`), 'הסרטונים הסופיים · עוד לא הועלה כלום');
  assert.equal(await text(nadia, `${card}-v-add`), '+ העלאת סרטונים');
  assert.equal(await nadia.locator(`${card}-go`).isDisabled(), true);
  assert.equal(await text(nadia, `${card}-go`), 'מוכן לבדיקה');
  assert.equal(await text(nadia, `${card}-lock`), 'נפתח אחרי שמעלים כאן לפחות סרטון סופי אחד.');
  assert.equal(await nadia.getAttribute(`${card}-go`, 'aria-describedby'), `c-${D.id}-lock`);
  // Only her client; nothing says Drive.
  assert.equal(await nadia.locator('.ed-card').count(), 1);
  assert.doesNotMatch(await text(nadia, '#ed-list'), /דרייב|Drive/);
  const box = await nadia.locator(`${card}-v-add`).boundingBox();
  assert.ok(box.height >= 44, JSON.stringify(box));
  assert.ok(await noHScroll(nadia));
  await shots(nadia, 'editor-locked', { scrollTo: `${card}-go` });
});

await step('a failed upload says what to do (again, then "חסר…" to Irit and Lior) and opens nothing', async () => {
  flags.failUploads = 1;
  await nadia.locator(`${card}-v-in`).setInputFiles({ name: 'video-1.mp4', mimeType: 'video/mp4', buffer: mp4() });
  await nadia.waitForSelector(`${card}-v-files .fl-errs .err`);
  assert.equal(await text(nadia, `${card}-v-files .fl-errs .err`), 'video-1.mp4: ההעלאה לא הצליחה. נסו שוב. אם זה חוזר: ״חסר לוגו / טלפון / חומר״, לסמן ״העלאה למערכת״. עירית מקבלת מיד, וליאור אחריה.');
  assert.equal(liveVideos().length, 0);
  assert.equal(await nadia.locator(`${card}-go`).isDisabled(), true);
  // The report path is there, with the new option.
  await nadia.click(`${card}-missing`);
  await nadia.waitForSelector('#dlg-missing[open]');
  assert.match(await text(nadia, '#miss-list'), /העלאה למערכת \(לא עובדת\)/);
  await nadia.click('#dlg-missing [data-close]');
  // A file that is not a video is refused before anything is sent.
  await nadia.locator(`${card}-v-in`).setInputFiles({ name: 'notes.mp4', mimeType: 'video/mp4', buffer: Buffer.from('just text, renamed') });
  await nadia.waitForFunction((s) => /אינו סרטון/.test(document.querySelector(s)?.textContent || ''), `${card}-v-files .fl-errs`);
  assert.equal(liveVideos().length, 0);
});

await step('two videos go up: the count against the package, and "מוכן לבדיקה" opens', async () => {
  await nadia.locator(`${card}-v-in`).setInputFiles([
    { name: 'video-1.mp4', mimeType: 'video/mp4', buffer: mp4() },
    { name: 'סרטון 2 סופי.mp4', mimeType: 'video/mp4', buffer: mp4(5000) },
  ]);
  await nadia.waitForFunction((s) => /הועלו 2 מתוך 3/.test(document.querySelector(s)?.textContent || ''), `${card}-v-files .fl-work-h`);
  assert.equal(liveVideos().length, 2);
  assert.ok(liveVideos().every((f) => f.uploaded_by === 'nadia@astrateg.test' && f.storage_path.startsWith(`${D.id}/deliverable_video/`)));
  assert.equal(await nadia.locator(`${card}-v-files .fl-item`).count(), 2);
  await nadia.waitForFunction((s) => !document.querySelector(s).disabled, `${card}-go`);
  assert.equal(await nadia.locator(`${card}-lock`).count(), 0);
  // Her own uploads can be taken out (to replace a version); no "עלה לרשתות" fields here.
  assert.equal(await nadia.locator(`${card}-v-files .fl-del`).count(), 2);
  assert.equal(await nadia.locator(`${card}-v-files .fl-post`).count(), 0);
  assert.ok(await noHScroll(nadia));
  await shots(nadia, 'editor-unlocked', { scrollTo: `${card}-go` });
});

await step('"מוכן לבדיקה": the self-check names the client\'s files, and Ofir is told', async () => {
  await nadia.click(`${card}-go`);
  await nadia.waitForSelector('#dlg-ready[open]');
  assert.equal(await text(nadia, '#ready-ctx'), 'קפה דנה · הועלו 2 מתוך 3 סרטונים');
  assert.match(await text(nadia, '#ready-list'), /כל הסרטונים הועלו לתיק הלקוח ונפתחים/);
  assert.doesNotMatch(await text(nadia, '#ready-list'), /דרייב/);
  for (const i of [0, 1, 2, 3, 4]) await nadia.check(`#ready-${i}`);
  await nadia.click('#ready-submit');
  await toastHas(nadia, 'נשלח לאופיר');
  assert.ok(checkOf(D, 'p24.notify') && checkOf(D, 'p24.drive') && checkOf(D, 'p22.edited'));
  assert.equal(checkOf(D, 'p24.folder'), undefined, 'nobody marks a Drive folder');
  await nadia.click('#handoff-close').catch(() => {});
});

await step('the client card points to her page for the final hand-off instead of offering the mark', async () => {
  await nadia.goto(`${BASE}client.html?id=${D.id}#p27`);
  await nadia.waitForSelector('#i-p27-final');
  assert.equal(await nadia.locator('#i-p27-final').isDisabled(), true);
  assert.match(await text(nadia, '#i-p27-final-u'), /מסמנים ב״הלקוחות שלי בעריכה״, אחרי שמעלים שם את הגרסאות הסופיות\./);
  assert.equal(await nadia.getAttribute('#i-p27-final-u a', 'href'), `editor.html#c-${D.id}`);
  // No Drive folder item anywhere in the card, and nothing in it says Drive.
  assert.equal(await nadia.locator('#i-p24-folder').count(), 0);
  assert.doesNotMatch(await text(nadia, '#app'), /דרייב|Google Docs|Excel/);
  // An editor still has no characterization page.
  await nadia.goto(`${BASE}intake.html?id=${D.id}`);
  await nadia.waitForFunction(() => /פתוחים לצוות המשרד/.test(document.querySelector('#state')?.textContent || ''));
  assert.equal(await nadia.locator('#rd-fields').count(), 0);
});

// ── Ofir: the videos, in the quality-control dialog ──
const ofir = (await newContext(DESK)).page;
await step('Ofir\'s quality-control dialog shows the uploaded videos, played in place, with nothing to change', async () => {
  await signIn(ofir, 'qa.html', 'ofir');
  await ofir.waitForSelector('#qa-list .of-card');
  await ofir.locator('#qa-list .of-card', { hasText: 'קפה דנה' }).locator('button', { hasText: 'לבדיקה' }).click();
  await ofir.waitForSelector('#dlg-qa[open] #qa-f-files .fl-item');
  assert.equal(await text(ofir, '#qa-f-files .fl-work-h'), 'הסרטונים לבדיקה · הועלו 2 מתוך 3');
  assert.equal(await ofir.locator('#qa-f-files .fl-item').count(), 2);
  assert.equal(await ofir.locator('#qa-f-files .fl-add:visible').count(), 0, 'no upload from the dialog');
  assert.equal(await ofir.locator('#qa-f-files .fl-del').count(), 0, 'nothing is taken out from the dialog');
  // The files come before the checks.
  assert.ok(await ofir.evaluate(() => !!(document.querySelector('#qa-files').compareDocumentPosition(document.querySelector('#qa-checks-box')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  await ofir.locator('#qa-f-files .fl-play').first().click();
  await ofir.waitForSelector('#qa-f-files video[src*="/storage/v1/object/sign/client-files/"]');
  assert.equal(await ofir.locator('#qa-f-files video').count(), 1);
  await shots(ofir, 'qa-dialog-videos');
  await ofir.setViewportSize(PHONE);
  assert.ok(await noHScroll(ofir));
  await ofir.setViewportSize(DESK);
  await ofir.click('#dlg-qa .dlg-head [data-close]');
});

// ── After the client's notes: a fixed version, uploaded since ──
await step('the final hand-off after the client\'s notes waits for a file uploaded since; then it goes to Ilai', async () => {
  serverTime += 3600e3; // an hour later: Ofir approved, Irit sent, the client's notes came
  for (const k of PROCESSES.find((p) => p.id === 'p25').items.map((i) => i.key)) set(D, k, 'ofir');
  set(D, 'p26.sent', 'irit');
  set(D, 'p27.notes', 'irit', JSON.stringify({ videos: [{ n: 1, text: 'להחליף את השיר' }] }));
  await nadia.goto(`${BASE}editor.html`);
  await nadia.waitForSelector(`${card} .ed-fix-list`);
  assert.equal(await text(nadia, `${card} .ed-state`), 'תיקוני הלקוח');
  await nadia.click(`${card}-go`); // "סמן הכול תוקן"
  await toastHas(nadia, 'הגרסאות הסופיות בתיק הלקוח');
  await nadia.waitForFunction((s) => /תיקונים הושלמו/.test(document.querySelector(s)?.textContent || ''), `${card}-go`);
  assert.equal(await text(nadia, `${card}-go`), 'תיקונים הושלמו, הגרסאות הסופיות בתיק הלקוח');
  assert.equal(await nadia.locator(`${card}-go`).isDisabled(), true);
  assert.equal(await text(nadia, `${card}-lock`), 'נפתח אחרי שמעלים את הגרסה המתוקנת: קובץ שעלה אחרי הערות הלקוח.');
  serverTime += 600e3;
  await nadia.locator(`${card}-v-in`).setInputFiles({ name: 'video-1-fixed.mp4', mimeType: 'video/mp4', buffer: mp4(4500) });
  await nadia.waitForFunction((s) => /הועלו 3 מתוך 3/.test(document.querySelector(s)?.textContent || ''), `${card}-v-files .fl-work-h`);
  await nadia.waitForFunction((s) => !document.querySelector(s).disabled, `${card}-go`);
  await nadia.click(`${card}-go`);
  await toastHas(nadia, 'עברו לעילאי');
  assert.ok(checkOf(D, 'p27.final'));
  await nadia.click('#handoff-close').catch(() => {});
});

// ── Ilai: the graphics, the final versions, the characterization ──
const ilai = (await newContext()).page;
const day = `#il-${M.id}`;
await step('Ilai\'s card: the graphics upload, "מוכן לבדיקה (לעירית)" locked until a graphic is up', async () => {
  await signIn(ilai, 'clients.html#mine', 'ilai');
  await ilai.waitForSelector('.g-ilai .il-card');
  await ilai.locator(`${day}-s`).click();
  await ilai.waitForFunction((s) => /עוד לא הועלה כלום/.test(document.querySelector(s)?.textContent || ''), `${day}-g9-files .fl-work-h`);
  assert.equal(await text(ilai, `${day}-g9-files .fl-work-h`), '9 הגרפיקות הראשונות · עוד לא הועלה כלום');
  assert.equal(await ilai.locator(`${day}-gfx`).isDisabled(), true);
  assert.equal(await text(ilai, `${day}-gfx-lock`), 'נפתח אחרי שמעלים כאן לפחות גרפיקה אחת.');
  assert.equal(await text(ilai, `${day}-g9-add`), '+ העלאת גרפיקות');
  // The Gantt is the system's, not a yearly file.
  assert.match(await text(ilai, `${day}-d`), /גאנט התוכן נפתח במערכת, עם כל העמודות/);
  assert.doesNotMatch(await text(ilai, '.g-ilai'), /הקובץ השנתי|דרייב/);
  await ilai.locator(`${day}-g9-in`).setInputFiles([{ name: 'post-1.png', mimeType: 'image/png', buffer: png() }, { name: 'post-2.png', mimeType: 'image/png', buffer: png(2500) }]);
  await ilai.waitForFunction((s) => /הועלו 2 מתוך 9/.test(document.querySelector(s)?.textContent || ''), `${day}-g9-files .fl-work-h`);
  await ilai.waitForFunction((s) => !document.querySelector(s).disabled, `${day}-gfx`);
  // A preview loads when it comes on screen, from a signed URL.
  await ilai.locator(`${day}-g9-files .fl-item`).first().scrollIntoViewIfNeeded();
  await ilai.waitForSelector(`${day}-g9-files .fl-item img[src]`);
  assert.equal(db.client_files.filter((f) => f.client_id === M.id && f.kind === 'deliverable_graphic').length, 2);
  assert.ok(await noHScroll(ilai));
  await shots(ilai, 'ilai-graphics-upload', { scrollTo: `${day}-gfx` });
  await ilai.click(`${day}-gfx`);
  await toastHas(ilai, '9 הגרפיקות עברו לבדיקה של עירית.');
  assert.ok(checkOf(M, 'p07.made'));
  await ilai.click('#handoff-close').catch(() => {});
});

await step('the rest of the graphics is locked the same way; the editor\'s final versions are in his card', async () => {
  const rest = `#il-r-${D.id}`;
  await ilai.waitForSelector(`${rest}-ready`);
  assert.equal(await ilai.locator(`${rest}-ready`).isDisabled(), true);
  assert.equal(await text(ilai, `${rest}-g-files .fl-work-h`), 'יתרת הגרפיקות · עוד לא הועלה כלום');
  const fin = `#il-f-${D.id}--v-files`;
  await ilai.waitForSelector(`${fin} .fl-item`);
  assert.equal(await text(ilai, `${fin} .fl-work-h`), 'הסרטונים הסופיים · הועלו 3 מתוך 3');
  assert.equal(await ilai.locator(`${fin} .fl-add:visible`).count(), 0);
  assert.match(await text(ilai, `.il-card[data-key="il-final:${D.id}:"]`), /גרסאות סופיות/);
  assert.doesNotMatch(await text(ilai, `.il-card[data-key="il-final:${D.id}:"]`), /דרייב/);
});

await step('one tap from the graphics card: the client\'s characterization, read-only', async () => {
  const link = ilai.locator(`.il-card[data-key="il-rest:${D.id}"] a.il-char`);
  assert.equal(await link.textContent(), 'האפיון של הלקוח: קפה דנה');
  await link.click();
  await ilai.waitForSelector('#rd-fields');
  assert.equal(await text(ilai, '#ik-head h1'), 'קפה דנה');
  assert.match(await text(ilai, '#ik-head .kicker'), /לקריאה/);
  const labels = await ilai.locator('#rd-fields dt').allInnerTexts();
  assert.deepEqual(labels, FORM_FIELDS.map((f) => f.label));
  const body = await text(ilai, '#ik-body');
  for (const v of ['קפה, מאפים וארוחות בוקר', 'משפחות וסטודנטים מהשכונה', 'קלייה במקום', 'יותר הזמנות בבוקר', 'קפה ומאפה ב־19 ₪', 'פוסטים למבצעים, בצבעי המותג', 'קמפיין פתיחה', 'לא להראות את המטבח האחורי', 'הרצל 1, חיפה', '04-8123456', 'חום קפה וקרם']) assert.ok(body.includes(v), v);
  assert.match(await text(ilai, '#rd-brand'), /תמונות\s*התקבל[^]*סרטונים קיימים\s*חסר[^]*תפריט או מחירון\s*אין \/ לא רלוונטי/);
  // Nothing to fill, no tabs, no upload; the client's materials are listed.
  assert.equal(await ilai.locator('#ik-body :is(input:not([type=file]), textarea, select, button.btn-primary):visible').count(), 0);
  assert.equal(await ilai.locator('#ik-tabs').isHidden(), true);
  await ilai.waitForSelector('#files-block .fl-item');
  assert.equal(await ilai.locator('#files-block .fl-add:visible').count(), 0, 'Ilai adds no materials');
  assert.equal(await ilai.locator('#files-block .fl-del').count(), 0);
  assert.match(await text(ilai, '#files-block'), /תמונות \(1\)/);
  assert.equal(await ilai.getAttribute('#back', 'href'), 'clients.html#mine');
  assert.ok(await noHScroll(ilai));
  await shots(ilai, 'ilai-characterization');
  // From the client card too.
  await ilai.goto(`${BASE}client.html?id=${D.id}`);
  await ilai.waitForSelector('#ik-char');
  assert.equal(await ilai.getAttribute('#ik-char', 'href'), `intake.html?id=${D.id}`);
  // A characterization not saved yet says so.
  await ilai.goto(`${BASE}intake.html?id=${G.id}`);
  await ilai.waitForSelector('#rd-none');
  assert.match(await text(ilai, '#rd-none'), /האפיון עוד לא נשמר במערכת/);
});

// ── Eli: the scripts of his shoot day ──
const eli = (await newContext()).page;
await step('Eli reads the scripts of his shoot day behind one button; nothing to change', async () => {
  await signIn(eli, 'shoot.html', 'eli');
  const btn = `#s-${G.id}-scripts`;
  await eli.waitForSelector(btn);
  assert.equal(await text(eli, btn), 'לקרוא את התסריטים');
  assert.ok((await eli.locator(btn).boundingBox()).height >= 44);
  await eli.click(btn);
  await eli.waitForSelector('#dlg-scripts[open] .sh-script');
  assert.equal(await text(eli, '#scr-h'), 'התסריטים · סטודיו גל');
  assert.equal(await text(eli, '#scr-sum'), '2 תסריטים, לפי סדר הצילום. לקריאה בלבד.');
  assert.deepEqual(await eli.locator('.sh-script h3').allInnerTexts().then((x) => x.map((s) => s.replace(/\s+/g, ' '))), ['תסריט 1 · פתיחה', 'תסריט 2 · מבצע החודש טיוטה: עוד יכול להשתנות']);
  assert.match(await text(eli, '.sh-script'), /גל פותחת את הדלת ומזמינה פנימה\.\nשוט רחב, ואז תקריב\./);
  assert.equal(await eli.getAttribute('.sh-script-links a', 'href'), 'https://www.instagram.com/reel/abc');
  assert.equal(await eli.locator('#dlg-scripts input, #dlg-scripts textarea, #dlg-scripts button:not(.close)').count(), 0);
  assert.ok(await noHScroll(eli));
  await shots(eli, 'eli-scripts');
  await eli.click('#dlg-scripts .close');
  assert.equal(await eli.evaluate(() => document.activeElement.id), `s-${G.id}-scripts`);
  // Before the migration: a plain message, and the page goes on.
  flags.scriptsFunction = false;
  await eli.click(btn);
  await eli.waitForFunction(() => /לא נטענו/.test(document.querySelector('#scr-sum')?.textContent || ''));
  assert.equal(await text(eli, '#scr-sum'), 'התסריטים לא נטענו. נסו שוב; אם זה חוזר, לבקש מליאור.');
  flags.scriptsFunction = true;
});

await browser.close();
noCspViolations();
assert.deepEqual(errors, [], errors.join('\n'));
console.log(`package 1 e2e: ${passed} steps passed`);
