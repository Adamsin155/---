// End-to-end check of "למי לשלוח את הדיווח?" (the owner, 29.10.2026): an editor reporting
// something missing chooses Irit (as before), Lior or Ofir, and only that one is rung, with
// the client's link. Three places: the start dialog ("קיבלתי את הכונן" with a "חסר"), the
// "חסר לוגו / טלפון / חומר" dialog while editing, and "לא התקבל" on the start-check rows
// of the client card (the owner's clarification: a third answer beside "סיימתי" and "לא
// רלוונטי"). Nadia (Chromium, 390 and 1280), Nirel on a Natali client, and Yariv on WebKit
// as an iPhone 13; the notes are typed key by key with deletes. The fake of Supabase and
// the scene helpers are those of tests/production-e2e.mjs; the rings are computed from the
// fake database with the reminder rules themselves (app/reminder-engine.js).
// Run: npx http-server -p 8394 -s -c-1 . &  then  BASE_URL=http://localhost:8394/ node tests/editor-report-to-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { importKeys } from '../app/client-open.js';
import { PROCESSES } from '../app/protocol.js';
import { returnNote } from '../app/office-marks.js';
import { withClientColumns } from './fake-clients.mjs';
import { computeReminders } from '../app/reminder-engine.js';

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
// Days without influencers on Tuesday 13.10 (25.10.2026): Eliel at 10:00, Eli at 13:00.
const SL = client('f0f0f0f0-0000-4000-8000-000000000006', { name: 'סלון ליה', address: 'הרצל 20, תל אביב', phone: '056-3333333', shoot_type: null, deliverables: { videos: 12, shoot_days: 12, shoot_crew: 'eliel' }, shoot_at: '2026-10-13T10:00:00+03:00' });
const SE = client('f1f1f1f1-0000-4000-8000-000000000007', { name: 'מוסך דני', address: 'התעשייה 3, חולון', phone: '057-4444444', shoot_type: null, deliverables: { videos: 12, shoot_days: 12, shoot_crew: 'eli' }, shoot_at: '2026-10-13T13:00:00+03:00' });

const imported = (c, station) => importKeys(station).map((k) => ({ client_id: c.id, item_key: k, state: 'done', note: 'ייבוא', by_email: 'irit@astrateg.test', at: '2026-09-02T09:00:00+03:00' }));
const itemsOf = (ids) => new Set(PROCESSES.filter((p) => ids.includes(p.id)).flatMap((p) => p.items.map((i) => i.key)));
const EDITING = itemsOf(['p22a', 'p22', 'p24', 'p25', 'p26', 'p27']);
const SHOOTDAY = itemsOf(['p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p20', 'p21']);
const check = (c, key, at, note = null, by = 'ofir@astrateg.test') => ({ client_id: c.id, item_key: key, state: 'done', note, by_email: by, at: T(at).toISOString() });
const db = {
  staff,
  clients: [A, B, N, Tc, S, SL, SE],
  protocol_checks: [
    ...imported(A, 'post').filter((r) => !EDITING.has(r.item_key)),
    check(A, 'p22a.assigned', '2026-10-18T10:00:00'),
    check(A, 'p19b.notes', '2026-10-15T16:00:00', 'בסרטון 2 יש שתי גרסאות. הסאונד בסרטון 3 מהמיקרופון השני.', 'eli@astrateg.test'),
    // Only an item checked: the words themselves are in the focus call's row (content_briefs).
    check(A, 'p12a.t.messages', '2026-10-06T10:00:00', null, 'lior@astrateg.test'),
    ...imported(B, 'post').filter((r) => !EDITING.has(r.item_key)), check(B, 'p22a.assigned', '2026-10-18T10:00:00'),
    ...imported(N, 'post').filter((r) => !EDITING.has(r.item_key)), check(N, 'p22a.assigned', '2026-10-18T10:00:00'),
    ...imported(Tc, 'ongoing'),
    ...imported(S, 'shoot').filter((r) => !SHOOTDAY.has(r.item_key)),
    ...imported(SL, 'shoot').filter((r) => !SHOOTDAY.has(r.item_key)),
    ...imported(SE, 'shoot').filter((r) => !SHOOTDAY.has(r.item_key)),
  ],
  client_tasks: [
    { id: randomUUID(), client_id: Tc.id, title: 'תיקון באנר לקמפיין', owner: 'nirel', due_on: '2026-10-19', done_at: null, done_by_email: null, created_by_email: 'lior@astrateg.test', created_at: T('2026-10-19T09:00:00').toISOString(), source: null, urgent: true, started_at: null, result: null, brief: { problem: 'הבאנר לא קריא', change: 'להגדיל כותרת', keep: 'הצבעים', result: 'באנר קריא בטלפון' } },
  ],
  // The intake's form (app/characterization.js): fields.phone is the business's, fields.logo_url its logo.
  characterizations: [{ client_id: A.id, fields: { address: 'הרצל 10, תל אביב', phone: '03-5551234', logo_url: 'https://drive.google.com/logo-a', services: 'תספורות' }, completed_at: null, completed_by: null, by_email: 'ofir@astrateg.test', at: '2026-10-05T12:00:00+03:00' }],
  content_briefs: [
    { client_id: A.id, round: 1, fields: { messages: 'להגיד שיש חניה חינם', dont: 'לא להזכיר מחירים', faq: 'כמה זמן לוקחת צביעה' }, by_email: 'lior@astrateg.test', at: '2026-10-06T10:00:00+03:00' },
    { client_id: B.id, round: 1, fields: { messages: 'מסר של קפה גולן' }, by_email: 'lior@astrateg.test', at: '2026-10-06T10:00:00+03:00' },
  ],
  protocol_log: [], push_subscriptions: [], reminder_log: [],
  // Found live (6.10.2026): the logo was uploaded as a FILE (client_files, kind 'logo'),
  // and the editor's page said "אין לוגו בכרטיס". B has only the file; N has nothing.
  client_files: [
    { id: randomUUID(), client_id: B.id, kind: 'logo', label: null, storage_path: `${B.id}/logo/11111111-1111-4111-8111-111111111111-Golan-Logo.png`, mime: 'image/png', size_bytes: 2008, created_at: '2026-10-05T12:00:00+03:00', deleted_at: null },
    { id: randomUUID(), client_id: B.id, kind: 'logo', label: null, storage_path: `${B.id}/logo/22222222-2222-4222-8222-222222222222-old.png`, mime: 'image/png', size_bytes: 10, created_at: '2026-10-04T12:00:00+03:00', deleted_at: '2026-10-05T11:00:00+03:00' },
    // Package 1: the hand-offs stand on the videos' Drive link (A has one in its card) or on
    // a video uploaded into the system. This suite is about the four buttons, so each
    // client also has one video up; the link and the upload themselves: tests/package1-e2e.mjs.
    ...[A, B, N].map((c, i) => ({ id: randomUUID(), client_id: c.id, kind: 'deliverable_video', label: null, storage_path: `${c.id}/deliverable_video/3333333${i}-3333-4333-8333-333333333333-final.mp4`, mime: 'video/mp4', size_bytes: 4096, posted_on: null, link: null, uploaded_by: `${c.editor}@astrateg.test`, created_at: '2026-12-01T12:00:00+02:00', deleted_at: null })),
  ],
};
const signRequests = []; // [person, path] of every signed link asked from Storage
const taskRefusals = []; // task changes the database refused (outside the office)

// Who sees which client (the database's rule, 20260930130000_assignment_rls.sql).
const inShootWindow = (c) => [c.shoot_at, ...(c.rounds || []).map((r) => r.shoot_at)].filter(Boolean)
  .some((at) => { const d = (new Date(at) - clockNow) / 864e5; return d >= -8 && d <= 31; });
const taskGivesAccess = (t) => { const by = staff.find((s) => s.email === t.created_by_email); return !by || isOffice(by); };
function sees(me, c) {
  if (!me || !c) return false;
  if (isOffice(me)) return true;
  const p = me.person;
  if (c.editor === p || (c.rounds || []).some((r) => r.editor === p)) return true;
  // A task counts only when the office or the system opened it (private.task_gives_access).
  if (db.client_tasks.some((t) => t.client_id === c.id && t.owner === p && taskGivesAccess(t) && (!t.done_at || clockNow - new Date(t.done_at) < 30 * 864e5))) return true;
  if (p === 'nirel' && c.shoot_type === 'natali') return true;
  return p === 'eli' && inShootWindow(c);
}
function visibleRows(me, table) {
  const rows = db[table];
  if (table === 'clients') return rows.filter((c) => sees(me, c));
  if (['protocol_checks', 'protocol_log', 'client_tasks', 'characterizations', 'content_briefs', 'client_files'].includes(table)) return rows.filter((r) => sees(me, db.clients.find((c) => c.id === r.client_id)));
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
  // Storage: a signed link only for a file of a client this person sees (the bucket's read policy).
  const sign = /^\/storage\/v1\/object\/sign\/client-files\/(.+)$/.exec(p);
  if (sign) {
    const path = decodeURIComponent(sign[1]);
    const row = db.client_files.find((f) => f.storage_path === path && !f.deleted_at);
    if (!me || !row || !sees(me, db.clients.find((c) => c.id === row.client_id))) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    signRequests.push([me.person, path]);
    return json(200, { signedURL: `/object/sign/client-files/${path}?token=signed` });
  }
  if (p.startsWith('/storage/v1/object/sign/')) return json(400, { message: 'not found' });
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
    // Outside the office: only one's own task or one that one opened, and only "done",
    // "started" and how it ended (client_tasks_scope_guard, 20261014100000_security_hardening.sql).
    if (!isOffice(me)) {
      for (const r of rows) {
        taskRefusals.push({ by: me.person, task: r.title, keys: Object.keys(body) });
        if (r.owner !== me.person && r.created_by_email !== me.email) return json(403, { code: '42501', message: "not allowed: this task is someone else's" });
        if (Object.keys(body).some((k) => !['done_at', 'started_at', 'result'].includes(k))) return json(403, { code: '42501', message: 'not allowed: only the office changes what a task says' });
        taskRefusals.pop();
      }
    }
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
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  for (const host of ['https://wa.me/**', 'https://waze.com/**', 'https://www.google.com/**', 'https://drive.google.com/**', 'https://docs.google.com/**', 'https://www.dropbox.com/**']) {
    await ctx.route(host, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>x</title>' }));
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
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
// Visible form controls without a name a screen reader can say (a <label>, aria-label(ledby) or title).
const unlabeled = (page) => page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
  .filter((e) => e.offsetParent && !e.closest('.sr-only'))
  .filter((e) => ![...(e.labels || [])].some((l) => l.textContent.trim()) && !e.getAttribute('aria-label')?.trim()
    && !(e.getAttribute('aria-labelledby') || '').split(/\s+/).some((id) => document.getElementById(id)?.textContent.trim()) && !e.title?.trim())
  .map((e) => `${e.tagName}#${e.id}.${e.className}`));
const height = (page, sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().height);
const set = (c, key, note = null, by = 'ofir@astrateg.test') => {
  const row = { client_id: c.id, item_key: key, state: 'done', note, by_email: by, at: serverNow() };
  const i = db.protocol_checks.findIndex((x) => x.client_id === c.id && x.item_key === key);
  if (i >= 0) db.protocol_checks[i] = row; else db.protocol_checks.push(row);
  db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: c.id, item_key: key, action: 'done', note, by_email: by, at: row.at });
};
const reload = async (page) => { await page.click('#btn-refresh'); await page.waitForTimeout(150); };

let passed = 0;
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

const A_ID = 'c-aaaaaaaa-0000-4000-8000-000000000001';

// ── "למי לשלוח את הדיווח?" ─────────────────
const STAFF_ROWS = Object.entries(PEOPLE).map(([k, person]) => ({ email: `${k}@astrateg.test`, person }));
// The reminders due now from the fake database, as the reminders function computes them.
function ringsNow(rule = 'editorMissing') {
  const checks = {};
  for (const r of db.protocol_checks) (checks[r.client_id] ||= {})[r.item_key] = r;
  const list = computeReminders({
    clients: db.clients, checks, tasks: db.client_tasks, access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [],
    staff: STAFF_ROWS, now: new Date(serverNow()), log: [],
  });
  return list.filter((r) => r.rule === rule).map((r) => ({ person: r.person, clientId: r.clientId, url: r.url, level: r.level, body: r.body }));
}
const noteOf = (c) => JSON.parse(checkOf(c, 'p22.missing').note);
// Key by key, then two deleted and typed again (the owner's rule: real typing).
async function typeKeys(page, sel, words, fix) {
  await page.locator(sel).click();
  await page.keyboard.type(words, { delay: 25 });
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(fix, { delay: 25 });
}
async function shots(page, name, top = null) {
  if (!OUT) return;
  for (const [w, hgt] of [[390, 844], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: hgt });
    await page.evaluate((sel) => {
      document.querySelector('#toast')?.classList.remove('on');
      if (sel) document.querySelector(sel)?.scrollIntoView({ block: 'center' });
    }, top);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${name}-${w}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}
const chipsOk = async (page, prefix) => {
  assert.deepEqual(await page.locator(`#${prefix}-to-chips label`).allInnerTexts(), ['עירית', 'ליאור', 'אופיר']);
  for (const k of ['irit', 'lior', 'ofir']) assert.ok(await height(page, `label[for="${prefix}-to-${k}"]`) >= 44, `${prefix}-to-${k}`);
};

const nadia = await scene('2026-10-19T10:00:00', { width: 390, height: 844 });
const card = `#${A_ID}`;
await step('Nadia starts with the logo "חסר": "למי לשלוח את הדיווח?" appears with עירית chosen; she picks אופיר, types the words key by key; Ofir is rung, nobody else', async () => {
  const { page } = nadia;
  await signIn(page, 'editor.html', 'nadia');
  await page.waitForSelector(`${card}-go`);
  await page.click(`${card}-go`);
  await page.waitForSelector('#dlg-start[open]');
  assert.equal(await page.locator('#start-to').isHidden(), true, 'nothing missing yet: no question');
  for (const i of [0, 1, 3]) await page.click(`label[for="start-${i}-yes"]`);
  await page.click('label[for="start-2-no"]'); // the logo
  await page.waitForSelector('#start-to:not([hidden])');
  assert.equal(await text(page, '#start-to legend'), 'למי לשלוח את הדיווח?');
  await chipsOk(page, 'start');
  assert.equal(await page.isChecked('#start-to-irit'), true, 'Irit, as before');
  await page.click('label[for="start-to-ofir"]');
  await typeKeys(page, '#start-logo-note', 'הלוגו מטושטשxx', '!');
  assert.equal(await page.inputValue('#start-logo-note'), 'הלוגו מטושטש!');
  assert.ok(await noHScroll(page));
  assert.deepEqual(await unlabeled(page), []);
  await shots(page, 'start-to-ofir', '#start-to');
  await page.click('#start-submit');
  await toastHas(page, 'אופיר קיבל הודעה על מה שחסר');
  assert.deepEqual(noteOf(A), { what: ['logo'], note: '', notes: { logo: 'הלוגו מטושטש!' }, going: true, to: 'ofir' });
  const rings = ringsNow();
  assert.deepEqual(rings.map((r) => [r.person, r.clientId, r.level]), [['ofir', A.id, 'ring']]);
  assert.match(rings[0].url, new RegExp(`client\\.html\\?id=${A.id}`));
  assert.match(rings[0].body, /^נדיה: חסר לוגו \(הלוגו מטושטש!\)\. העריכה ממשיכה\.$/);
  assert.match(await text(page, `${card}-report`), /אופיר קיבל הודעה .*העריכה ממשיכה\./);
  await shots(page, 'card-reported-ofir', `${card}-report`);
});

await step('mid-editing, "חסר לוגו / טלפון / חומר": the chip comes on whom it went to (אופיר); she picks ליאור and reports the phone too; Lior is rung; "הגיע הכול" closes it', async () => {
  const { page } = nadia;
  await page.click(`${card}-missing`);
  await page.waitForSelector('#dlg-missing[open]');
  await chipsOk(page, 'miss');
  assert.equal(await page.isChecked('#miss-to-ofir'), true);
  await page.click('label[for="miss-to-lior"]');
  await page.click('label[for="miss-phone"]');
  await typeKeys(page, '#miss-phone-note', 'לא עונהה', 'ה');
  assert.equal(await page.inputValue('#miss-phone-note'), 'לא עונה');
  assert.equal(await text(page, '#miss-hint'), 'ההודעה יוצאת עכשיו למי שבחרת. לעצור רק כשאי אפשר להמשיך בלי זה: אז המועד מסומן ״חסום״ עד שזה מגיע.');
  assert.ok(await noHScroll(page));
  assert.deepEqual(await unlabeled(page), []);
  await shots(page, 'missing-to-lior', '#miss-to');
  await page.click('#miss-go');
  await toastHas(page, 'ליאור קיבל הודעה: חסר');
  assert.equal(noteOf(A).to, 'lior');
  assert.deepEqual(noteOf(A).what, ['logo', 'phone']);
  assert.deepEqual(ringsNow().map((r) => r.person), ['lior']);
  assert.match(await text(page, `${card}-report`), /ליאור קיבל הודעה/);
  await page.click(`${card}-arrived`);
  await toastHas(page, 'סומן שהכול הגיע');
  assert.equal(checkOf(A, 'p22.missing'), null);
  assert.deepEqual(ringsNow(), []);
  await nadia.ctx.close();
});

// The owner's clarification (29.10.2026): the rows of the client card ("סיימתי" / "לא רלוונטי")
// get a third answer, "לא התקבל": to whom, and in a few words what; the row stays open.
const N_ID = N.id;
const nirel = await scene('2026-10-19T11:00:00', { width: 390, height: 844 });
await step('Nirel (a Natali client), on the client card: "לא התקבל" on the logo row → ליאור, words key by key; the row shows it, Lior is rung; again → אופיר; "סיימתי" closes the report', async () => {
  const { page } = nirel;
  await signIn(page, `client.html?id=${N_ID}#p22`, 'nirel');
  const row = 'i-p22-check-logo';
  await page.waitForSelector(`#${row}-notgot`);
  // Only the four start checks have it.
  assert.deepEqual((await page.locator('.notgot-btn').evaluateAll((l) => l.map((e) => e.id))).sort(),
    ['i-p22-check-footage-notgot', 'i-p22-check-logo-notgot', 'i-p22-check-phone-notgot', 'i-p22-check-scripts-notgot']);
  assert.equal(await text(page, `#${row}-notgot`), 'לא התקבל');
  assert.ok(await height(page, `#${row}-notgot`) >= 44);
  await shots(page, 'row-notgot', `#${row}-notgot`);
  await page.click(`#${row}-notgot`);
  await page.waitForSelector('#dlg-notgot[open]');
  assert.equal(await text(page, '#notgot-item'), 'יש לוגו תקין של העסק');
  await chipsOk(page, 'notgot');
  assert.equal(await page.isChecked('#notgot-to-irit'), true);
  await page.click('label[for="notgot-to-lior"]');
  await typeKeys(page, '#notgot-note', 'אין לוגו בדרייבב', 'ב');
  assert.equal(await page.inputValue('#notgot-note'), 'אין לוגו בדרייב');
  assert.ok(await noHScroll(page));
  assert.deepEqual(await unlabeled(page), []);
  await shots(page, 'row-notgot-dialog');
  await page.click('#notgot-submit');
  await toastHas(page, 'נשלח לליאור');
  assert.deepEqual(noteOf(N), { what: ['logo'], note: '', notes: { logo: 'אין לוגו בדרייב' }, going: true, to: 'lior' });
  assert.equal(checkOf(N, 'p22.check.logo'), null, 'not done');
  assert.equal(checkOf(N, 'p22.missing').by_email, 'nirel@astrateg.test');
  const rings = ringsNow();
  assert.deepEqual(rings.map((r) => [r.person, r.clientId]), [['lior', N.id]]);
  assert.match(rings[0].body, /^ניראל: חסר לוגו \(אין לוגו בדרייב\)\. העריכה ממשיכה\.$/);
  await page.waitForSelector(`#${row}-r`);
  assert.match(await text(page, `#${row}-r`), /^לא התקבל · דווח לליאור · .* · ״אין לוגו בדרייב״$/);
  assert.equal(await text(page, `#${row}-notgot`), 'לשלוח שוב');
  assert.ok(await noHScroll(page));
  await shots(page, 'row-reported-lior', `#${row}-notgot`);
  // Again, to Ofir: the words stay.
  await page.click(`#${row}-notgot`);
  await page.waitForSelector('#dlg-notgot[open]');
  assert.equal(await page.isChecked('#notgot-to-lior'), true);
  assert.equal(await page.inputValue('#notgot-note'), 'אין לוגו בדרייב');
  await page.click('label[for="notgot-to-ofir"]');
  await page.click('#notgot-submit');
  await toastHas(page, 'נשלח לאופיר');
  assert.equal(noteOf(N).to, 'ofir');
  assert.deepEqual(ringsNow().map((r) => r.person), ['ofir']);
  // It arrived: "סיימתי" on the row, and the report closes by itself.
  await page.locator(`#${row}`).check();
  for (let i = 0; i < 50 && checkOf(N, 'p22.missing'); i += 1) await page.waitForTimeout(100);
  assert.ok(checkOf(N, 'p22.check.logo'));
  assert.equal(checkOf(N, 'p22.missing'), null);
  assert.deepEqual(ringsNow(), []);
  await page.waitForFunction((id) => !document.getElementById(`${id}-r`), row);
  await shots(page, 'row-arrived', `#${row}`);
  await nirel.ctx.close();
});

// WebKit as an iPhone 13: Yariv, the start dialog and the row, typed key by key.
await step('WebKit (iPhone 13), Yariv: the start dialog → ליאור, and "לא התקבל" on the phone row → אופיר, typed key by key', async () => {
  const wk = await webkit.launch();
  clockNow = T('2026-10-19T12:00:00');
  clockSetAt = Date.now();
  const ctx = await wk.newContext({ ...devices['iPhone 13'], locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.clock.install({ time: clockNow });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`webkit: ${e}`));
  const B_ID = `c-${B.id}`;
  await signIn(page, 'editor.html', 'yariv');
  await page.waitForSelector(`#${B_ID}-go`);
  await page.locator(`#${B_ID}-go`).tap();
  await page.waitForSelector('#dlg-start[open]');
  for (const i of [0, 1, 3]) await page.locator(`label[for="start-${i}-yes"]`).tap();
  await page.locator('label[for="start-2-no"]').tap();
  await page.waitForSelector('#start-to:not([hidden])');
  await page.locator('label[for="start-to-lior"]').tap();
  await page.locator('#start-logo-note').tap();
  await page.keyboard.type('קובץ פגוםם', { delay: 40 });
  await page.keyboard.press('Backspace');
  assert.equal(await page.inputValue('#start-logo-note'), 'קובץ פגום');
  if (OUT) await page.screenshot({ path: `${OUT}/webkit-start-to-lior.png` });
  await page.locator('#start-submit').tap();
  await page.waitForFunction(() => /ליאור קיבל הודעה/.test(document.querySelector('#toast')?.textContent || ''));
  assert.deepEqual(noteOf(B), { what: ['logo'], note: '', notes: { logo: 'קובץ פגום' }, going: true, to: 'lior' });
  assert.deepEqual(ringsNow().map((r) => [r.person, r.clientId]), [['lior', B.id]]);
  // "הגיע הכול", then the client card's row.
  await page.locator(`#${B_ID}-arrived`).tap();
  await page.waitForFunction(() => /סומן שהכול הגיע/.test(document.querySelector('#toast')?.textContent || ''));
  await page.goto(`${BASE}client.html?id=${B.id}#p22`);
  await page.waitForSelector('#i-p22-check-phone-notgot');
  await page.locator('#i-p22-check-phone-notgot').tap();
  await page.waitForSelector('#dlg-notgot[open]');
  await page.locator('label[for="notgot-to-ofir"]').tap();
  await page.locator('#notgot-note').tap();
  await page.keyboard.type('המספר שגויי', { delay: 40 });
  await page.keyboard.press('Backspace');
  assert.equal(await page.inputValue('#notgot-note'), 'המספר שגוי');
  if (OUT) await page.screenshot({ path: `${OUT}/webkit-row-dialog-ofir.png` });
  await page.locator('#notgot-submit').tap();
  await page.waitForFunction(() => /נשלח לאופיר/.test(document.querySelector('#toast')?.textContent || ''));
  assert.deepEqual(noteOf(B), { what: ['phone'], note: '', notes: { phone: 'המספר שגוי' }, going: true, to: 'ofir' });
  assert.deepEqual(ringsNow().map((r) => [r.person, r.clientId]), [['ofir', B.id]]);
  await page.waitForSelector('#i-p22-check-phone-r');
  await page.evaluate(() => { document.querySelector('#toast')?.classList.remove('on'); document.querySelector('#i-p22-check-phone-r')?.scrollIntoView({ block: 'center' }); });
  if (OUT) await page.screenshot({ path: `${OUT}/webkit-row-reported.png` });
  await ctx.close();
  await wk.close();
});

await browser.close();
noCspViolations();
assert.deepEqual(errors, []);
console.log(`\n${passed} editor report-to checks passed.`);
