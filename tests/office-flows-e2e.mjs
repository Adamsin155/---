// End-to-end check of the office's flows (stage 3, part 2; system-plan section 3:
// Ofir, Lior and Ilai), against an in-memory fake of Supabase. The browser's clock
// is fixed on Tuesday 20.10.2026 at 10:00 in Israel (Thursday 22.10 for the summary).
//  - Ofir lands on his queue (qa.html): what waits for him against the one-hour
//    target; he returns the videos with two issues, the editor marks them fixed in
//    the client card ("תוקן"), they come back as a second check, he approves, and
//    the handoff to Irit is offered.
//  - The assignment: Nirel preselected for Natali; Nadia only with a reason; the
//    WhatsApp to the editor (no Drive folder task since package 1).
//  - Thursday: the pass over the clients ("עברתי", "עברתי על כל השאר", recorded as
//    the day's control), a data-health fix in one tap, the summary prefilled.
//  - Lior lands on "החלטות": an exception through reason → decision → next action
//    (a linked task) → close; "התחלתי"; an urgent task back with him; a login
//    closed as partly fixed; paused editing moved; the Tuesday campaign check; the
//    lists match the reminder engine.
//  - Ilai: the characterization day's card (the vault statuses check the access,
//    the page checks, Metricool, "מוכן לבדיקה" to Irit, the Gantt), and "קיבלתי".
//  - A 360px phone: no sideways scrolling, 44px targets.
// Run: npx http-server -p 8080 -s . &  then  node tests/office-flows-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applicableProcesses } from '../app/protocol-logic.js';
import { buildEnv, candidates } from '../app/reminder-engine.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const TUE = new Date('2026-10-20T10:00:00+03:00');
const THU = new Date('2026-10-22T10:00:00+03:00');
let clockNow = TUE;
const t0 = Date.now();
const serverNow = () => new Date(clockNow.getTime() + (Date.now() - t0)).toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;
const IL = (s) => new Date(`${s}+03:00`).toISOString();

// ── People ────────────────────────────────
const people = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', yariv: 'yariv', nirel: 'nirel' };
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: !['nadia', 'yariv', 'ilai'].includes(person), phone: null }));
// Ilai has no vault flag, as on the live site (6.10.2026): his card reads the statuses
// through access_status_for_work() and says plainly that the passwords are not his.
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};

// ── Clients ───────────────────────────────
const client = (fields) => ({
  id: randomUUID(), name: '', business: null, address: null, phone: null, package_name: null, shoot_type: 'dms', characterizer: 'ofir',
  has_logo: true, editor_name: null, editor: null, deal_at: IL('2026-10-01T09:00:00'), char_at: IL('2026-10-05T10:00:00'), shoot_at: null,
  contract_end: '2027-10-01', status: 'active', notes: null, quote_id: null, created_at: IL('2026-10-01T09:00:00'),
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: { videos: 25, graphics: 35, shoot_days: 1 }, rounds: [], verified_at: null, verified_by: null, closed_reason: null,
  ...fields,
});
const checks = [];
const keysOf = (c, ids) => applicableProcesses(c).filter((p) => ids.includes(p.id)).flatMap((p) => p.items.filter((i) => !i.optional).map((i) => i.key));
const one = (c, key, at, note = null, by = 'irit@astrateg.test') => {
  const i = checks.findIndex((x) => x.client_id === c.id && x.item_key === key);
  const row = { client_id: c.id, item_key: key, state: 'done', note, by_email: by, at };
  if (i >= 0) checks[i] = row; else checks.push(row);
};
const all = (c, ids, at, note = 'ייבוא') => { for (const k of keysOf(c, ids)) one(c, k, at, note); };
const UPTO_SHOOT = ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p07b', 'p08', 'p08b', 'p09', 'p10', 'p11', 'p11b', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19b', 'p20', 'p21'];

// Videos with Ofir since 09:30 (assigned to Nadia on Sunday).
const V = client({ name: 'מספרת רון', editor: 'nadia', shoot_at: IL('2026-10-18T10:00:00'), address: 'הרצל 10, תל אביב' });
all(V, [...UPTO_SHOOT, 'p19', 'p23'], IL('2026-10-18T09:00:00'));
all(V, ['p22a'], IL('2026-10-18T12:00:00'), null);
all(V, ['p22'], IL('2026-10-20T09:00:00'), null);
for (const k of ['p24.folder', 'p24.drive', 'p24.notify']) one(V, k, IL('2026-10-20T09:30:00'), null, 'nadia@astrateg.test');
// The rest of the graphics, ready for Ofir since 09:00.
const G = client({ name: 'קפה גליה', shoot_at: IL('2026-10-15T10:00:00') });
all(G, UPTO_SHOOT, IL('2026-10-15T09:00:00'));
one(G, 'p23.made', IL('2026-10-20T09:00:00'), null, 'ilai@astrateg.test');
// Natali's shoot yesterday: waiting for an editor (Nirel preselected).
const quoteN = { id: randomUUID(), selection: { paid: [], free: { simeonJoin: false } } };
const N = client({ name: 'סטודיו נטלי', shoot_type: 'natali', shoot_at: IL('2026-10-19T10:00:00'), quote_id: quoteN.id });
all(N, UPTO_SHOOT, IL('2026-10-19T09:00:00'));
all(N, ['p19'], IL('2026-10-19T15:00:00'), null);
// Ofir's characterization at 12:00 today.
const C = client({ name: 'גן ורד', char_at: IL('2026-10-20T12:00:00'), deal_at: IL('2026-10-19T09:00:00'), created_at: IL('2026-10-19T09:00:00'), address: 'ויצמן 5, רחובות' });
all(C, ['p01', 'p02', 'p03'], IL('2026-10-19T09:10:00'), null);
// Paused editing since yesterday afternoon (Yariv).
const P = client({ name: 'סטודיו פז', editor: 'yariv', shoot_at: IL('2026-10-15T10:00:00') });
all(P, [...UPTO_SHOOT, 'p19', 'p23'], IL('2026-10-15T09:00:00'));
all(P, ['p22a'], IL('2026-10-18T09:30:00'), null);
one(P, 'p22.pause', IL('2026-10-19T15:00:00'), JSON.stringify({ stage: 'חצי מהסרטונים', left: '12 סרטונים', why: 'משימה דחופה' }), 'yariv@astrateg.test');
// A campaign that is live (for Tuesday's check), imported.
const L = client({ name: 'חנות ותיקה', deal_at: IL('2026-03-01T09:00:00'), char_at: IL('2026-03-03T10:00:00'), shoot_at: IL('2026-03-10T10:00:00') });
all(L, [...UPTO_SHOOT, 'p19', 'p22a', 'p22', 'p23', 'p24', 'p25', 'p26', 'p27', 'p28', 'p29', 'p30'], IL('2026-10-01T09:00:00'));
one(L, 'p31.call', IL('2026-10-19T12:00:00'), null, 'lior@astrateg.test');
// Ilai's characterization day: the meeting at 08:00 ended at 08:55 with the access.
const I = client({ name: 'מאפיית שחר', char_at: IL('2026-10-20T08:00:00'), deal_at: IL('2026-10-19T09:00:00'), created_at: IL('2026-10-19T09:00:00'), has_logo: false });
all(I, ['p01', 'p02', 'p03'], IL('2026-10-19T09:10:00'), null);
all(I, ['p04'], IL('2026-10-20T08:55:00'), null);
one(I, 'p05.access', IL('2026-10-20T08:55:00'), null, 'ofir@astrateg.test');
// The final versions in the Drive, for Ilai's "קיבלתי".
const F = client({ name: 'גלידה שמש', editor: 'nadia', shoot_at: IL('2026-10-11T10:00:00') });
all(F, [...UPTO_SHOOT, 'p19', 'p22a', 'p22', 'p23', 'p24', 'p25', 'p26'], IL('2026-10-12T09:00:00'));
for (const k of ['p27.approved', 'p27.final']) one(F, k, IL('2026-10-20T09:15:00'), null, 'nadia@astrateg.test');

const task = (c, fields) => ({
  id: randomUUID(), client_id: c.id, title: '', owner: 'lior', due_on: null, done_at: null, done_by_email: null,
  created_by_email: 'ofir@astrateg.test', created_at: IL('2026-10-20T09:00:00'), source: null, brief: null, urgent: false, started_at: null, ...fields,
});
const tEsc = task(V, { title: 'לקוח מתלונן (תהליך 25 · בקרת איכות על הסרטונים): הלקוח כועס על הכתוביות בסרטונים הקודמים', source: 'escalation', urgent: true, created_by_email: 'irit@astrateg.test' });
const tUrgent = task(G, { title: 'לפתוח ללקוח TikTok ולהכניס את הגישה לכספת', owner: 'ilai', urgent: true, created_by_email: 'irit@astrateg.test' });
const tNoDue = task(G, { title: 'לבדוק את הצבעים בגרפיקות', owner: 'irit', created_by_email: 'ofir@astrateg.test', created_at: IL('2026-10-19T11:00:00') });
const accessRows = [
  { id: randomUUID(), client_id: G.id, network: 'instagram', label: null, username: 'galia', status: 'broken', note: null, updated_by: 'irit@astrateg.test', updated_at: IL('2026-10-19T11:00:00'), created_at: IL('2026-10-01T09:00:00'), secret_id: 'x' },
  { id: randomUUID(), client_id: I.id, network: 'instagram', label: null, username: 'shahar', status: 'ok', note: null, updated_by: 'ilai@astrateg.test', updated_at: IL('2026-10-20T09:50:00'), created_at: IL('2026-10-20T09:40:00'), secret_id: 'y' },
  { id: randomUUID(), client_id: I.id, network: 'tiktok', label: null, username: null, status: 'missing', note: null, updated_by: 'ilai@astrateg.test', updated_at: IL('2026-10-20T09:52:00'), created_at: IL('2026-10-20T09:40:00'), secret_id: null },
];

const db = {
  staff,
  clients: [V, G, N, C, P, L, I, F],
  protocol_checks: checks,
  protocol_log: checks.map((c, i) => ({ id: i + 1, client_id: c.client_id, item_key: c.item_key, action: c.state, note: c.note, by_email: c.by_email, at: c.at })),
  client_tasks: [tEsc, tUrgent, tNoDue],
  office_reviews: [{ day: '2026-10-18', kind: 'p33', note: null, by_email: 'ofir@astrateg.test', at: IL('2026-10-18T15:00:00'), note_by: null, note_at: null }],
  client_status_notes: [],
  client_messages: [],
  client_access: accessRows,
  client_access_log: [],
  client_date_changes: [],
  client_questions: [],
  quotes: [{ id: quoteN.id, number: 'AST-1', model: { selection: quoteN.selection } }],
  // Package 1: "מוכן לבדיקה" opens only once a graphic of the batch is in the client's
  // files. Ilai's first graphic for מאפיית שחר is already up (the upload itself and
  // the lock: tests/package1-e2e.mjs).
  client_files: [{ id: 'f0000000-0000-4000-8000-000000000001', client_id: I.id, kind: 'deliverable_graphic', label: null, storage_path: `${I.id}/deliverable_graphic/f0000000-0000-4000-8000-000000000001-post-1.png`, mime: 'image/png', size_bytes: 2048, posted_on: null, link: null, uploaded_by: 'ilai@astrateg.test', created_at: IL('2026-10-20T09:40:00'), deleted_at: null }],
  office_passes: [],
  task_decisions: [],
  change_requests: [],
};

// ── Fake PostgREST ─────────────────────────
const unq = (s) => s.replace(/^"(.*)"$/, '$1');
function match(r, k, v) {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('neq.')) return String(r[k]) !== v.slice(4);
  if (v.startsWith('gte.')) return String(r[k] ?? '') >= unq(v.slice(4));
  if (v.startsWith('in.(')) return new Set(v.slice(4, -1).split(',').map(unq)).has(String(r[k]));
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
  if (v.startsWith('like.')) { const pat = v.slice(5).replace(/\*/g, '%'); return new RegExp(`^${pat.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(String(r[k])); }
  return true;
}
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or') {
      const parts = v.slice(1, -1).split(',').map((x) => { const [col, ...rest] = x.split('.'); return [col, rest.join('.')]; });
      out = out.filter((r) => parts.some(([col, cond]) => match(r, col, cond)));
      continue;
    }
    out = out.filter((r) => match(r, k, v));
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split(',')[0].split('.');
    out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  return out;
}
const KEYS = { protocol_checks: ['client_id', 'item_key'], office_reviews: ['day', 'kind'], client_status_notes: ['client_id', 'week'], office_passes: ['day'], task_decisions: ['task_id'] };

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
  const now = serverNow();
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
  const vault = !!me && !!staff.find((r) => r.email === me.email)?.vault;
  if (p === '/rest/v1/rpc/can_use_vault' || p === '/rest/v1/rpc/can_use_client_vault') return json(200, vault);
  if (p === '/rest/v1/rpc/access_status_for_work') {
    const person = staff.find((r) => r.email === me?.email)?.person;
    const office = !!me && (person === null || ['irit', 'lior', 'ofir', 'ilai'].includes(person));
    const ids = body?.p_clients ? new Set(body.p_clients) : null;
    return json(200, !office ? [] : db.client_access.filter((a) => !ids || ids.has(a.client_id))
      .map((a) => ({ client_id: a.client_id, network: a.network, label: a.label, status: a.status, updated_at: a.updated_at })));
  }
  if (p === '/rest/v1/rpc/access_save') {
    const a = db.client_access.find((x) => x.id === body.p_id);
    Object.assign(a, { status: body.p_status, note: body.p_note, updated_by: me.email, updated_at: now });
    return json(200, a.id);
  }
  if (p === '/rest/v1/rpc/ofir_meetings') {
    return json(200, db.clients.filter((c) => c.char_at && (c.characterizer || 'ofir') === 'ofir').map((c) => {
      const saved = db.protocol_checks.find((x) => x.client_id === c.id && x.item_key === 'p04.saved' && x.at > c.char_at);
      return { starts_at: c.char_at, ends_at: saved ? saved.at : new Date(new Date(c.char_at).getTime() + 2 * 36e5).toISOString() };
    }));
  }
  if (p.startsWith('/rest/v1/rpc/')) return json(404, { code: 'PGRST202', message: 'not found' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { code: '42P01', message: 'relation does not exist' });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  if (req.method() === 'GET') {
    let rows = applyFilters(db[table], url.searchParams);
    if (table === 'quotes') rows = rows.map((q) => ({ id: q.id, number: q.number, selection: q.model.selection }));
    if (table === 'client_access') rows = vault ? rows : [];
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    return reply(rows.slice(off, off + lim));
  }
  if (req.method() === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const out = [];
    for (const r of rows) {
      let row;
      if (table === 'protocol_checks') {
        row = { note: null, ...r, by_email: me.email, at: now };
        db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: r.state, note: r.note ?? null, by_email: me.email, at: now });
      } else if (table === 'client_tasks') {
        row = { done_at: null, done_by_email: null, source: null, brief: null, urgent: false, due_on: null, started_at: null, ...r, id: randomUUID(), created_at: now, created_by_email: me.email };
      } else if (table === 'office_passes') {
        const prev = db.office_passes.find((x) => x.day === r.day);
        row = { snapshot: null, completed_at: null, ...(prev || {}), ...r, by_email: prev?.by_email || me.email, at: prev?.at || now };
        if (r.completed_at && !prev?.completed_at) row.completed_at = now;
      } else if (table === 'change_requests') {
        row = { decision: null, decided_by_email: null, decided_at: null, client_id: null, ...r, id: randomUUID(), created_by_email: me.email, created_at: now };
      } else {
        row = { ...r, by_email: me.email, at: now };
      }
      const key = KEYS[table];
      const i = key ? db[table].findIndex((x) => key.every((k) => x[k] === row[k])) : -1;
      if (i >= 0) db[table][i] = row; else db[table].push(row);
      out.push(row);
    }
    return reply(out);
  }
  if (req.method() === 'PATCH') {
    const rows = applyFilters(db[table], url.searchParams);
    for (const r of rows) {
      Object.assign(r, body);
      if (table === 'client_tasks' && 'done_at' in body) { r.done_at = body.done_at ? now : null; r.done_by_email = body.done_at ? me.email : null; }
      if (table === 'client_tasks' && 'started_at' in body) r.started_at = body.started_at ? now : null;
      if (table === 'change_requests' && 'decision' in body) { r.decided_by_email = me.email; r.decided_at = now; }
    }
    return reply(rows);
  }
  if (req.method() === 'DELETE') {
    const rows = applyFilters(db[table], url.searchParams);
    db[table] = db[table].filter((r) => !rows.includes(r));
    if (table === 'protocol_checks') for (const r of rows) db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: 'clear', note: null, by_email: me.email, at: now });
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  return json(405, { message: `unexpected ${req.method()} on ${table}` });
}
const checkOf = (c, key) => db.protocol_checks.find((x) => x.client_id === c.id && x.item_key === key) || null;

// ── Browser ────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newContext(time = TUE, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>wa</p>' }));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return page;
}
async function signIn(page, path, who) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
// Visible form controls without a name a screen reader can say (a <label>, aria-label(ledby) or title).
const unlabeled = (page, root = 'body') => page.evaluate((r) => [...document.querySelectorAll(`${r} input:not([type=hidden]), ${r} select, ${r} textarea`)]
  .filter((e) => e.offsetParent && !e.closest('.sr-only'))
  .filter((e) => ![...(e.labels || [])].some((l) => l.textContent.trim()) && !e.getAttribute('aria-label')?.trim()
    && !(e.getAttribute('aria-labelledby') || '').split(/\s+/).some((id) => document.getElementById(id)?.textContent.trim()) && !e.title?.trim())
  .map((e) => `${e.tagName}#${e.id}.${e.className}`), root);
const toastHas = (page, t) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), t);
let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const octx = await newContext();
const ofir = await newPage(octx);

// Since 6.10.2026 Ofir lands on "המשימות שלי" (it was his queue), and the queue is one tap away in his personal menu.
await step('Ofir\'s queue, one tap from "המשימות שלי": what waits for his check against the one-hour target, first due first', async () => {
  await signIn(ofir, 'clients.html', 'ofir');
  await ofir.waitForSelector('#profile-switch[data-to="manager"]');
  await ofir.waitForSelector('#view-mine:not([hidden])');
  assert.match(ofir.url(), /clients\.html(#mine)?$/);
  await ofir.click('#side-qa');
  await ofir.waitForURL(/qa\.html$/);
  await ofir.waitForSelector('#qa-list .of-card');
  const cards = await ofir.locator('#qa-list > li.of-card').evaluateAll((els) => els.map((e) => [e.querySelector('.wclient').textContent, e.querySelector('.wtitle').textContent, e.querySelector('.of-line').textContent]));
  assert.deepEqual(cards.map((x) => x.slice(0, 2)), [['קפה גליה', 'יתרת הגרפיקות'], ['מספרת רון', 'סרטונים']]);
  assert.match(cards[0][2], /^מחכה שעה מתוך שעה · בקרה עד היום 10:00/);
  assert.match(cards[1][2], /^מחכה 30 דק׳ מתוך שעה · בקרה עד היום 10:30/);
  assert.equal(await ofir.locator('#qa-list > li').first().locator('.s-overdue').count(), 1);
  // Today's characterization, with navigation; the Natali shoot waiting for an editor, Nirel preselected.
  assert.match(await ofir.locator('#char-list').innerText(), /12:00[^]*גן ורד[^]*ויצמן 5, רחובות/);
  assert.match(await ofir.getAttribute('#char-list a[href^="https://waze.com"]', 'href'), /waze\.com\/ul\?q=/);
  assert.match(await ofir.locator('#assign-list').innerText(), /סטודיו נטלי[^]*ניראל מסומנת מראש/);
  // Nadia: Ron's videos are with Ofir (day 2 of 4, closing); Shemesh is late (day 6 of 4). Yariv's paused job.
  assert.match(await ofir.locator('#load-list').innerText(), /נדיה\s*2 לקוחות בעריכה[^]*גלידה שמש · יום 6 מתוך 4[^]*מספרת רון · יום 2 מתוך 4 · תיקונים וסגירה/);
  assert.match(await ofir.locator('#load-list').innerText(), /יריב\s*לקוח אחד בעריכה · אחת עצורה\s*סטודיו פז · יום 2 מתוך 3 עצורה/);
  await shot(ofir, 'office-01-qa');
});

await step('return for fixes: approving needs all six checks; two issues, due today 18:00, round 1', async () => {
  await ofir.click('#qa-list > li:nth-child(2) button');
  await ofir.waitForSelector('#dlg-qa[open]');
  assert.equal(await ofir.locator('#qa-checks input').count(), 6);
  await ofir.locator('#qa-checks input').first().check();
  await ofir.waitForFunction(() => !document.querySelector('#qa-checks input').disabled);
  await ofir.click('#qa-approve');
  assert.match(await ofir.locator('#qa-err').innerText(), /כל 6 הבדיקות \(חסרות 5\)/);
  await ofir.click('#qa-to-return');
  assert.equal(await ofir.locator('#qa-return-h').innerText(), 'החזרה לתיקון · סבב 1');
  assert.equal(await ofir.inputValue('#qa-due'), '2026-10-20T18:00');
  await ofir.fill('#qa-ref-1', '3');
  await ofir.fill('#qa-text-1', 'הטלפון בסגיר שגוי');
  await ofir.click('#qa-add');
  await ofir.fill('#qa-ref-2', '7');
  await ofir.fill('#qa-text-2', 'כתוביות חתוכות');
  await ofir.click('#qa-send-return');
  await toastHas(ofir, 'הוחזר לתיקון (סבב 1). הרשימה עוברת ל'); // not "<שם> מקבל/ת את הרשימה"
  assert.doesNotMatch(await ofir.locator('#toast').innerText(), /מקבל\/ת/);
  const r = checkOf(V, 'p25.return.1');
  assert.deepEqual(JSON.parse(r.note).issues, [{ ref: '3', text: 'הטלפון בסגיר שגוי' }, { ref: '7', text: 'כתוביות חתוכות' }]);
  assert.equal(JSON.parse(r.note).due, '2026-10-20T15:00:00.000Z');
  // The check he ticked is of the old version: cleared.
  assert.equal(checkOf(V, 'p25.q.editing'), null);
  await ofir.waitForFunction(() => document.querySelectorAll('#qa-list > li.of-card').length === 1);
  assert.match(await ofir.locator('#qa-fixing').innerText(), /הוחזרו לתיקון ועוד לא חזרו \(1\)/);
});

await step('the editor sees the list in the client card and marks each "תוקן"; the last one sends it back to Ofir', async () => {
  const nctx = await newContext();
  const nadia = await newPage(nctx);
  await signIn(nadia, `client.html?id=${V.id}#p24`, 'nadia');
  await nadia.waitForSelector('.fix-list');
  assert.match(await nadia.locator('.fix-list').innerText(), /הוחזר לתיקון · סבב 1[^]*לתקן עד היום 18:00[^]*סרטון 3: הטלפון בסגיר שגוי[^]*סרטון 7: כתוביות חתוכות/);
  await nadia.locator('.fix-list .fix-btn').first().click();
  await toastHas(nadia, 'סומן שתוקן.');
  assert.ok(checkOf(V, 'p25.fixed.1.0'));
  await nadia.waitForFunction(() => document.querySelectorAll('.fix-list .fix-btn').length === 1);
  await nadia.locator('.fix-list .fix-btn').click();
  await toastHas(nadia, 'חזרה לבדיקה של אופיר');
  assert.ok(checkOf(V, 'p25.fixed.1'));
  await nadia.waitForSelector('.qa-now');
  assert.match(await nadia.locator('.qa-now').innerText(), /אצל אופיר לבדיקה חוזרת \(אחרי סבב 1\)/);
  await shot(nadia, 'office-02-editor-fixed');
  await nctx.close();
});

await step('the re-check: back in the queue as check 2 with what was returned; all six checks, approved, handoff to Irit', async () => {
  await ofir.click('#btn-refresh');
  await ofir.waitForFunction(() => document.querySelectorAll('#qa-list > li.of-card').length === 2);
  const v = ofir.locator('#qa-list > li', { hasText: 'מספרת רון' });
  assert.match(await v.innerText(), /בדיקה 2 · אחרי תיקון/);
  await v.locator('button').click();
  await ofir.waitForSelector('#dlg-qa[open]');
  assert.match(await ofir.locator('#qa-prev').innerText(), /מה הוחזר בסבב 1[^]*סרטון 3: הטלפון בסגיר שגוי/);
  for (const box of await ofir.locator('#qa-checks input').all()) { await box.check(); await ofir.waitForFunction((el) => !el.disabled, await box.elementHandle()); }
  await ofir.click('#qa-approve');
  await toastHas(ofir, 'אושר. עירית מקבלת');
  assert.ok(checkOf(V, 'p25.approved'));
  await ofir.waitForSelector('#handoff:not([hidden])');
  assert.match(await ofir.locator('#handoff').innerText(), /לשלוח לעירית בוואטסאפ[^]*לשלוח לליאור בוואטסאפ/);
  await ofir.click('#handoff-close');
});

await step('assignment: Nirel preselected for Natali; Nadia needs a reason; the WhatsApp to the editor, and no Drive folder task', async () => {
  await ofir.click('#assign-list button');
  await ofir.waitForSelector('#dlg-assign[open]');
  assert.equal(await ofir.isChecked('#as-e-nirel'), true);
  assert.equal(await ofir.isVisible('#as-joint'), true);
  assert.deepEqual(await ofir.locator('#as-editors input').evaluateAll((els) => els.map((e) => e.value)), ['nadia', 'yariv', 'anna', 'nirel']);
  await ofir.check('#as-e-nadia');
  assert.equal(await ofir.innerText('#as-reason-label'), 'סיבה (חובה)');
  await ofir.click('#as-submit');
  assert.match(await ofir.innerText('#as-err'), /ניראל מסומנת מראש בצילום של נטלי\. כתבו למה נדיה/);
  assert.equal(await ofir.evaluate(() => document.activeElement.id), 'as-reason');
  await ofir.fill('#as-reason', 'ניראל עמוסה השבוע בבריפים');
  await ofir.click('#as-submit');
  await toastHas(ofir, 'סטודיו נטלי שויך לנדיה');
  assert.equal(db.clients.find((c) => c.id === N.id).editor, 'nadia');
  assert.ok(checkOf(N, 'p22a.assigned') && checkOf(N, 'p22a.load'));
  assert.equal(checkOf(N, 'p22a.irit').note, 'נסגר לבד: השיוך נרשם במערכת');
  assert.deepEqual(JSON.parse(checkOf(N, 'p22a.reason').note), { editor: 'nadia', reason: 'ניראל עמוסה השבוע בבריפים', preselected: 'nirel', joint: false });
  // Package 1: the videos go up into the client's files, so nobody is asked for a Drive folder.
  assert.equal(db.client_tasks.find((t) => t.client_id === N.id && t.owner === 'ofir'), undefined);
  assert.equal(await ofir.locator('#as-after').innerText(), 'השיוך מסמן את 22א ומכין וואטסאפ לעורך עם שני המועדים.');
  await ofir.waitForSelector('#handoff:not([hidden])');
  assert.match(await ofir.locator('#handoff').innerText(), /עורך שויך · נדיה[^]*לשלוח לנדיה בוואטסאפ/);
  const text = new URL(await ofir.getAttribute('.handoff-wa', 'href')).searchParams.get('text');
  assert.match(text, /סטודיו נטלי עובר לעריכה אצלך[^]*בתיק הלקוח במערכת ואצל אופיר לבקרה: [^]*סגירה, כולל תיקוני הלקוח: /);
  await ofir.click('#handoff-close');
  assert.match(await ofir.locator('#assign-list').innerText(), /אין לקוחות שמחכים לשיוך עורך/);
  await shot(ofir, 'office-03-assigned');
  await ofir.goto(`${BASE}qa.html`);
  await ofir.waitForSelector('#qa-list .of-card');
});

await step('"החלפת עורך" from the load list: the same dialog and rules; on time the editing days start over, and the new editor is told', async () => {
  // Natali's shoot, assigned to Nadia a moment ago: back to Nirel.
  const before = checkOf(N, 'p22a.assigned').at;
  const nadiaCard = ofir.locator('#load-list .of-editor', { hasText: 'נדיה' });
  assert.match(await nadiaCard.innerText(), /סטודיו נטלי · שויך היום[^]*החלפת עורך/);
  await ofir.click(`#sw-${N.id}`);
  await ofir.waitForSelector('#dlg-assign[open]');
  assert.equal(await ofir.innerText('#as-h'), 'החלפת עורך · סטודיו נטלי');
  assert.match(await ofir.innerText('#as-meta'), /עכשיו אצל נדיה · שויך היום/);
  assert.equal(await ofir.innerText('#as-submit'), 'החלפה');
  // The one who has it now cannot be chosen; Nirel is preselected for Natali, with each editor's load.
  assert.equal(await ofir.isDisabled('#as-e-nadia'), true);
  assert.match(await ofir.locator('label[for="as-e-nadia"]').innerText(), /העורך הנוכחי/);
  assert.equal(await ofir.isChecked('#as-e-nirel'), true);
  assert.match(await ofir.locator('label[for="as-e-yariv"]').innerText(), /לקוח אחד בעריכה/);
  // The clocks: not late, so the days are counted again from today (as the first assignment does), and it says until when.
  assert.equal(await ofir.isVisible('#as-clock-wrap'), true);
  assert.equal(await ofir.isChecked('#as-clock-restart'), true);
  assert.equal(await ofir.isHidden('#as-clock-late'), true);
  assert.match(await ofir.innerText('#as-clock-restart-label'), /^לספור מחדש מהיום: יעד /);
  assert.match(await ofir.innerText('#as-clock-keep-label'), /^להשאיר את המועד: יעד /);
  // Another editor for Natali still needs the written reason.
  await ofir.check('#as-e-yariv');
  assert.equal(await ofir.innerText('#as-reason-label'), 'סיבה (חובה)');
  await ofir.click('#as-submit');
  assert.match(await ofir.innerText('#as-err'), /ניראל מסומנת מראש בצילום של נטלי\. כתבו למה יריב/);
  await ofir.check('#as-e-nirel');
  assert.equal(await ofir.innerText('#as-reason-label'), 'סיבה (לא חובה)');
  await ofir.waitForTimeout(1100); // a later second, so the new stamp differs
  await ofir.click('#as-submit');
  await toastHas(ofir, 'סטודיו נטלי עבר מנדיה לניראל. מועדי העריכה נספרים מהיום');
  assert.equal(db.clients.find((c) => c.id === N.id).editor, 'nirel');
  assert.ok(checkOf(N, 'p22a.assigned').at > before, 'the assignment is stamped again');
  const why = JSON.parse(checkOf(N, 'p22a.reason').note);
  assert.deepEqual([why.editor, why.from, why.swap, why.restart, why.late, why.prev], ['nirel', 'nadia', true, true, false, before]);
  assert.equal(why.reason, 'החלפת עורך: מנדיה לניראל · מועדי העריכה נספרים מחדש מהיום');
  // As after the first assignment: the WhatsApp to the (new) editor; no second folder task.
  await ofir.waitForSelector('#handoff:not([hidden])');
  assert.match(await ofir.locator('#handoff').innerText(), /עורך שויך · ניראל[^]*לשלוח לניראל בוואטסאפ/);
  await ofir.click('#handoff-close');
  assert.equal(db.client_tasks.filter((t) => t.client_id === N.id && t.title.startsWith('פתיחת תיקייה')).length, 0);
  assert.match(await ofir.locator('#load-list .of-editor', { hasText: 'ניראל' }).innerText(), /סטודיו נטלי · שויך היום/);
  // The reminder engine: the notice "לקוח חדש בעריכה אצלך" is now Nirel's, not Nadia's.
  const byClient = {};
  for (const r of db.protocol_checks) (byClient[r.client_id] ||= {})[r.item_key] = r;
  const env = buildEnv({ clients: db.clients, checks: byClient, tasks: db.client_tasks.filter((t) => !t.done_at), staff: db.staff, access: [], reviews: db.office_reviews, statusNotes: [], now: new Date(new Date(serverNow()).getTime() + 60e3) });
  const told = candidates(env).filter((r) => r.rule === 'editing' && r.step === 'assigned' && r.clientId === N.id).map((r) => r.person);
  if (process.env.DEBUG_SWAP) console.log(candidates(env).filter((r) => r.rule === 'editing').map((r) => r.key));
  assert.deepEqual(told, ['nirel']);
});

await step('a swap never resets a late job silently: the deadlines stay unless Ofir chooses to count again and writes why', async () => {
  // Shemesh is with Nadia on day 6 of 4.
  const stamp = checkOf(F, 'p22a.assigned').at;
  await ofir.click(`#sw-${F.id}`);
  await ofir.waitForSelector('#dlg-assign[open]');
  assert.equal(await ofir.isChecked('#as-clock-keep'), true);
  assert.match(await ofir.innerText('#as-clock-late'), /העריכה כבר באיחור\. ההחלפה לא מאפסת את האיחור/);
  assert.match(await ofir.innerText('#as-clock-keep-label'), /\(באיחור\)$/);
  assert.equal(await ofir.isHidden('#as-joint-wrap'), true);
  assert.deepEqual(await ofir.locator('#as-editors input').evaluateAll((els) => els.map((e) => e.value)), ['nadia', 'yariv', 'anna']); // Nirel edits Natali only
  await ofir.check('#as-e-anna');
  assert.equal(await ofir.innerText('#as-reason-label'), 'סיבה (לא חובה)');
  // Counting again is his explicit choice, with a reason.
  await ofir.check('#as-clock-restart');
  assert.equal(await ofir.innerText('#as-reason-label'), 'סיבה (חובה)');
  await ofir.click('#as-submit');
  assert.match(await ofir.innerText('#as-err'), /העריכה כבר באיחור\. כדי לספור את המועדים מחדש כתבו למה\./);
  assert.equal(db.clients.find((c) => c.id === F.id).editor, 'nadia');
  await shot(ofir, 'office-03b-swap-late');
  // Left as it is: the job moves and stays late.
  await ofir.check('#as-clock-keep');
  await ofir.click('#as-submit');
  await toastHas(ofir, 'גלידה שמש עבר מנדיה לאנה. המועדים לא השתנו: העריכה נשארת באיחור.');
  assert.equal(db.clients.find((c) => c.id === F.id).editor, 'anna');
  assert.equal(checkOf(F, 'p22a.assigned').at, stamp, 'the assignment mark is untouched: the clocks did not move');
  const why = JSON.parse(checkOf(F, 'p22a.reason').note);
  assert.deepEqual([why.editor, why.from, why.restart, why.late, why.reason], ['anna', 'nadia', false, true, 'החלפת עורך: מנדיה לאנה · המועדים לא השתנו, העריכה נשארת באיחור']);
  // No WhatsApp is offered here: the handoff of an assignment (app/handoffs.js) is for an editing that has not reached Ofir yet.
  await ofir.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.equal(await ofir.isHidden('#handoff'), true);
  assert.match(await ofir.locator('#load-list .of-editor', { hasText: 'אנה' }).innerText(), /גלידה שמש · יום 6 מתוך 4/);
  assert.equal(await ofir.locator('#load-list .of-editor', { hasText: 'אנה' }).locator('.late').count(), 1);
  await shot(ofir, 'office-03c-swapped');
});

// Since 6.10.2026 Lior lands on "המשימות שלי" (it was "החלטות"), and "החלטות" is one tap away in his personal menu.
await step('Lior\'s "החלטות", one tap from "המשימות שלי": an exception through reason → decision → next action → close, and "התחלתי"', async () => {
  const lctx = await newContext();
  const lior = await newPage(lctx);
  await signIn(lior, 'clients.html', 'lior');
  await lior.waitForSelector('#profile-switch[data-to="manager"]');
  await lior.waitForSelector('#view-mine:not([hidden])');
  assert.match(lior.url(), /clients\.html(#mine)?$/);
  await lior.click('#side-decisions');
  await lior.waitForURL(/decisions\.html$/);
  await lior.waitForSelector('#ex-list .dc-card');
  const card = lior.locator('#ex-list .dc-card');
  assert.match(await card.innerText(), /מספרת רון[^]*לקוח מתלונן[^]*הלקוח כועס על הכתוביות/);
  assert.deepEqual(await card.locator('.dc-path li').evaluateAll((els) => els.map((e) => e.className)), ['is-now', '', '', '']);
  await card.locator('.start-btn').click();
  await toastHas(lior, 'נרשם שהתחלת');
  assert.ok(db.client_tasks.find((t) => t.id === tEsc.id).started_at);
  await lior.click(`#ex-${tEsc.id}-s`);
  await lior.fill(`#ex-${tEsc.id}-reason`, 'העורך לא בדק כתוביות');
  await lior.click(`#ex-${tEsc.id}-close`);
  assert.match(await lior.innerText(`#ex-${tEsc.id}-err`), /ואז ההחלטה/);
  await lior.fill(`#ex-${tEsc.id}-decision`, 'שיחה עם הלקוח ובדיקה חוזרת של כל הכתוביות');
  await lior.click(`#ex-${tEsc.id}-save`);
  await toastHas(lior, 'נשמר.');
  assert.deepEqual(await card.locator('.dc-path li').evaluateAll((els) => els.map((e) => e.className)), ['is-done', 'is-done', 'is-now', '']);
  await lior.fill(`#ex-${tEsc.id}-next`, 'להתקשר ללקוח ולהסביר');
  await lior.selectOption(`#ex-${tEsc.id}-owner`, 'irit');
  await lior.click(`#ex-${tEsc.id}-close`);
  await toastHas(lior, 'החריגה נסגרה. הפעולה הבאה אצל עירית.');
  const linked = db.client_tasks.find((t) => t.title === 'להתקשר ללקוח ולהסביר (בעקבות חריגה: לקוח מתלונן)');
  assert.equal(linked.owner, 'irit');
  assert.equal(linked.due_on, '2026-10-21');
  assert.deepEqual(db.task_decisions.map((d) => [d.task_id, d.reason, d.next_task_id]), [[tEsc.id, 'העורך לא בדק כתוביות', linked.id]]);
  assert.ok(db.client_tasks.find((t) => t.id === tEsc.id).done_at);
  assert.match(await lior.locator('#ex-list').innerText(), /אין חריגות פתוחות/);
  globalThis.lior = lior;
  globalThis.lctx = lctx;
});

await step('an urgent task not started in 30 office minutes is back with Lior; a login closed as partly fixed; paused editing moved', async () => {
  const lior = globalThis.lior;
  const ur = lior.locator('#ur-list .of-card');
  assert.match(await ur.innerText(), /קפה גליה[^]*עילאי[^]*חזרה אליך[^]*לא נלחץ ״התחלתי״ עד 09:30/);
  // Broken login: "תוקן חלקית" keeps it red and records what is missing.
  const acc = lior.locator('#ac-list .of-card');
  assert.match(await acc.innerText(), /קפה גליה[^]*Instagram/);
  await acc.locator('.dc-inline button').click();
  await toastHas(lior, 'כתבו מה עדיין חסר.');
  await acc.locator('input').fill('קוד אימות מהלקוח');
  await acc.locator('.dc-inline button').click();
  await toastHas(lior, 'נשמר כתוקן חלקית');
  const a = db.client_access.find((x) => x.client_id === G.id);
  assert.deepEqual([a.status, a.note], ['broken', 'תוקן חלקית, עדיין חסר: קוד אימות מהלקוח']);
  assert.deepEqual(JSON.parse(checkOf(G, 'p06.fixed.instagram').note), { partial: true, missing: 'קוד אימות מהלקוח', access: a.id });
  // Editing paused since yesterday: Ofir's proposal by load, and the deadlines moved by a day.
  const pz = lior.locator('#pz-list .of-card');
  // Nadia, not Anna: the two swaps above left Nadia with one job and gave Anna the late one, and the fewest open tasks decide.
  assert.match(await pz.innerText(), /סטודיו פז[^]*יריב[^]*עצורה מאז[^]*הצעת אופיר לפי העומס: נדיה/);
  await pz.locator('input[type=number]').fill('1');
  await pz.locator('button[type=submit]').click();
  await toastHas(lior, 'המועדים של סטודיו פז הוזזו ב־1 ימי עסקים');
  assert.deepEqual(JSON.parse(checkOf(P, 'p22a.shift').note), { days: 1, why: 'עריכה עצורה' });
  assert.equal(JSON.parse(checkOf(P, 'p22.decision').note).choice, 'move');
});

await step('the Tuesday campaign check, and the lists: the same items the reminder engine puts in them', async () => {
  const lior = globalThis.lior;
  assert.match(await lior.locator('#cp-body').innerText(), /חנות ותיקה/);
  await lior.click('#cp-done');
  await toastHas(lior, 'בדיקת הקמפיינים השבועית נרשמה.');
  assert.ok(db.office_reviews.some((r) => r.kind === 'campaigns' && r.day === '2026-10-20'));
  // What the engine lists for Lior now (the page's own clock), without the exceptions and paused editing.
  const byClient = {};
  for (const r of db.protocol_checks) (byClient[r.client_id] ||= {})[r.item_key] = r;
  const at = new Date(await lior.evaluate(() => Date.now()));
  const env = buildEnv({ clients: db.clients, checks: byClient, tasks: db.client_tasks.filter((t) => !t.done_at), staff: db.staff, access: db.client_access.filter((x) => x.status === 'broken'), reviews: db.office_reviews, statusNotes: db.client_status_notes, now: at });
  const expected = [...new Set(candidates(env).filter((r) => r.person === 'lior' && r.list && !['exception', 'paused'].includes(r.rule)).map((r) => r.title))];
  await lior.click('#btn-refresh');
  await lior.waitForFunction((n) => document.querySelectorAll('#ls-list .of-card').length === n, expected.length);
  const shown = await lior.locator('#ls-list .wclient').allInnerTexts();
  assert.deepEqual([...shown].sort(), [...expected].sort());
  assert.ok(expected.length >= 1, 'something should be on the lists');
  await shot(lior, 'office-04-decisions');
  await globalThis.lctx.close();
});

await step('Ilai: the characterization day card; the vault statuses check the access; page, Metricool, graphics to Irit, the Gantt; "קיבלתי"', async () => {
  const ictx = await newContext();
  const ilai = await newPage(ictx);
  await signIn(ilai, 'clients.html#mine', 'ilai');
  await ilai.waitForSelector('.g-ilai .il-card');
  assert.equal(await ilai.innerText('#il-h').then((t) => t.split('\n')[0]), 'יום אפיון: שעתיים');
  const card = ilai.locator('.il-card', { hasText: 'מאפיית שחר' }).first();
  assert.match(await card.locator('summary').innerText(), /מאפיית שחר[^]*הבא: /);
  await toastHas(ilai, 'הגישות של מאפיית שחר סומנו כנבדקו, לפי הסטטוסים בכספת.');
  assert.equal(checkOf(I, 'p06.verified').note, 'נסגר לבד: כל הרשתות בכספת קיבלו סטטוס');
  await card.locator('summary').click();
  assert.match(await card.innerText(), /Instagram: תקינה[^]*TikTok: אין רשת/);
  // No vault flag: the statuses are there, the passwords are not his, and the card says so.
  assert.equal(staff.find((r) => r.person === 'ilai').vault, false);
  assert.match(await card.innerText(), /אין לך גישה לסיסמאות בכספת. בעל המשרד מפעיל אותה בעמוד הצוות./);
  assert.doesNotMatch(await card.innerText(), /אין עדיין רשתות בכספת/);
  assert.equal(await card.locator('a', { hasText: 'לכספת' }).count(), 0);
  await card.locator('label', { hasText: 'שם העמוד' }).locator('input').check();
  await ilai.waitForFunction(() => true);
  await card.locator('input[type=url]').fill('https://app.metricool.com/shahar');
  await card.locator('form button').click();
  await toastHas(ilai, 'Metricool סומן כמחובר');
  assert.equal(db.clients.find((c) => c.id === I.id).links.metricool, 'https://app.metricool.com/shahar');
  assert.ok(checkOf(I, 'p06.metricool') && checkOf(I, 'p06.name'));
  await ilai.locator('.il-card', { hasText: 'מאפיית שחר' }).locator('button', { hasText: 'מוכן לבדיקה (לעירית)' }).click();
  await toastHas(ilai, '9 הגרפיקות עברו לבדיקה של עירית.');
  assert.ok(checkOf(I, 'p07.made'));
  await ilai.waitForSelector('#handoff:not([hidden])');
  assert.match(await ilai.locator('#handoff').innerText(), /לשלוח לעירית בוואטסאפ/);
  await ilai.click('#handoff-close');
  await ilai.locator('.il-card', { hasText: 'מאפיית שחר' }).locator('label', { hasText: 'גאנט התוכן נפתח במערכת' }).locator('input').check();
  await toastHas(ilai, 'שלד הגאנט סומן.');
  assert.ok(checkOf(I, 'p09.file') && checkOf(I, 'p09.c.time'));
  // The card covers these processes: they are not listed again below it.
  assert.equal(await ilai.locator('#mine-list .wproc[data-key$=":p07"]', { hasText: 'מאפיית שחר' }).count(), 0);
  // "קיבלתי" on the final versions closes the editing.
  await ilai.locator('.il-card', { hasText: 'גלידה שמש' }).locator('button', { hasText: 'קיבלתי' }).click();
  await toastHas(ilai, 'העריכה נסגרה.');
  assert.ok(checkOf(F, 'p27.toilai'));
  await shot(ilai, 'office-05-ilai');
  globalThis.ictx = ictx;
});

await step('Thursday: the pass (עברתי, one tap for the rest, the day\'s control), a data fix in one tap, the summary prefilled', async () => {
  clockNow = THU;
  const tctx = await newContext(THU);
  const o = await newPage(tctx);
  await signIn(o, 'pass.html', 'ofir');
  await o.waitForSelector('#ps-list .ps-row');
  assert.match(await o.innerText('#ps-status'), /היום חמישי: מעבר מלא, והוא נחשב גם כבקרה של היום/);
  const attention = await o.locator('#ps-list .ps-row .wclient').allInnerTexts();
  assert.ok(attention.length >= 2, JSON.stringify(attention));
  // Every attention row: "עברתי" (the first one "פתח משימה" with an owner and a due date).
  await o.locator('#ps-list .ps-row').first().locator('button', { hasText: 'פתח משימה' }).click();
  await o.waitForSelector('#dlg-task[open]');
  await o.fill('#tk-title', 'לבדוק מול העורך מה חסר');
  await o.selectOption('#tk-owner', 'lior');
  await o.click('#tk-submit');
  await toastHas(o, 'נפתחה משימה לליאור');
  assert.ok(db.client_tasks.some((t) => t.source === 'p33' && t.title === 'לבדוק מול העורך מה חסר' && t.due_on === '2026-10-25'));
  // The list shows its first six clients; the rest are behind "הצג עוד".
  if (await o.locator('#ps-list .more-btn').count()) await o.click('#ps-list .more-btn');
  // A stuck client (Ofir's stage 11) is not closed by "עברתי" alone: it says how long it
  // has been open, and offers a task, an update to Lior, or a written reason.
  const stuckIds = await o.locator('#ps-list .ps-row:not(.is-seen):has(.ps-stuck-acts)').evaluateAll((els) => els.map((e) => e.id));
  assert.ok(stuckIds.length >= 2, `stuck rows: ${stuckIds.length}`);
  for (const id of stuckIds) {
    const row = o.locator(`#${id}`);
    assert.equal(await row.locator('button', { hasText: /^עברתי$/ }).count(), 0, 'no bare "עברתי" on a stuck client');
    assert.deepEqual(await row.locator('.of-acts button').allInnerTexts(), ['פתח משימה', 'עדכון לליאור', 'אין צורך בפעולה']);
    assert.match(await row.innerText(), /לקוח תקוע[^]*תקוע: /);
  }
  assert.ok(await o.locator('#ps-list .ps-age').count() >= 1);
  assert.match(await o.locator('#ps-list .ps-age').first().innerText(), /(פתוח|באיחור|ממתין ללקוח) .*ימי עסקים|יום עסקים אחד/);
  await shot(o, 'office-06a-pass-stuck');
  // (1) A written reason: a dot is not one.
  const [s1, s2, ...sRest] = stuckIds;
  await o.click(`#${s1}-why-open`);
  await o.waitForSelector(`#${s1}-why-text`);
  assert.equal(await o.evaluate(() => document.activeElement.id), `${s1}-why-text`);
  await o.fill(`#${s1}-why-text`, ' . ');
  await o.click(`#${s1}-why-save`);
  assert.match(await o.innerText(`#${s1}-why-err`), /כתבו בכמה מילים למה לא נדרשת פעולה, או פתחו משימה\./);
  assert.ok(!db.office_passes.find((x) => x.day === '2026-10-22')?.seen?.[s1.slice(3)]);
  await o.fill(`#${s1}-why-text`, 'הלקוח בחו״ל עד יום ראשון, סוכם איתו');
  await o.click(`#${s1}-why-save`);
  await o.waitForSelector(`#${s1}.is-seen`);
  assert.match(await o.locator(`#${s1} .ps-seen`).innerText(), /^עברת · אין צורך בפעולה: ״הלקוח בחו״ל עד יום ראשון, סוכם איתו״ · \d\d:\d\d$/);
  const kept = db.office_passes.find((x) => x.day === '2026-10-22').seen[s1.slice(3)];
  assert.deepEqual([kept.how, kept.reason], ['reason', 'הלקוח בחו״ל עד יום ראשון, סוכם איתו']);
  // (2) An update to Lior: the existing exception path (a task for him, source 'escalation').
  await o.click(`#${s2}-lior`);
  await o.waitForSelector('#dlg-task[open]');
  assert.match(await o.innerText('#tk-h'), /^עדכון לליאור · /);
  assert.match(await o.inputValue('#tk-title'), /^לקוח תקוע: /);
  assert.equal(await o.inputValue('#tk-owner'), 'lior');
  assert.equal(await o.isDisabled('#tk-owner'), true);
  assert.equal(await o.innerText('#tk-submit'), 'שליחה לליאור');
  await o.click('#tk-submit');
  await toastHas(o, 'נשלח לליאור: לקוח תקוע: ');
  const esc = db.client_tasks.find((t) => t.client_id === s2.slice(3) && t.source === 'escalation' && t.title.startsWith('לקוח תקוע: '));
  assert.deepEqual([esc.owner, esc.due_on], ['lior', '2026-10-25']);
  assert.match(await o.locator(`#${s2} .ps-seen`).innerText(), /^עודכן ליאור · /);
  assert.deepEqual(db.office_passes.find((x) => x.day === '2026-10-22').seen[s2.slice(3)].task, esc.id);
  // The task dialog is back to itself for the next ordinary task.
  for (const id of sRest) {
    await o.click(`#${id}-why-open`);
    await o.fill(`#${id}-why-text`, 'נבדק מול העורך, מסתדר היום');
    await o.click(`#${id}-why-save`);
    await o.waitForSelector(`#${id}.is-seen`);
  }
  while (await o.locator('#ps-list .ps-row:not(.is-seen) button', { hasText: 'עברתי' }).count()) {
    const n = await o.locator('#ps-list .ps-row:not(.is-seen)').count();
    await o.locator('#ps-list .ps-row:not(.is-seen) button', { hasText: 'עברתי' }).first().click();
    await o.waitForFunction((k) => document.querySelectorAll('#ps-list .ps-row:not(.is-seen)').length === k - 1, n);
  }
  const rest = o.locator('#ps-rest-btn');
  if (await rest.count()) {
    assert.match(await rest.innerText(), /^עברתי על כל השאר \(\d+ לקוחות\)$/);
    await rest.click();
  }
  await toastHas(o, 'המעבר הושלם ונרשם כבקרת הלקוחות של היום (33).');
  assert.ok(db.office_reviews.some((r) => r.kind === 'p33' && r.day === '2026-10-22'));
  const pass = db.office_passes.find((x) => x.day === '2026-10-22');
  assert.ok(pass.completed_at && pass.snapshot && Object.keys(pass.snapshot).length === db.clients.filter((c) => c.status === 'active').length);
  // Data health: the task without a due date gets the next business day in one tap.
  await o.click(`#hl-due-${tNoDue.id}`);
  await toastHas(o, 'נקבע מועד למשימה');
  assert.equal(db.client_tasks.find((t) => t.id === tNoDue.id).due_on, '2026-10-25');
  // The summary: prefilled from the system, saved as is.
  assert.match(await o.innerText('#th-body'), /יעד: היום 13:00/);
  const row = o.locator(`#th-${V.id}`);
  await row.locator('summary').click();
  assert.match(await o.inputValue(`#th-${V.id}-current`), /^עריכה ובקרה/);
  assert.ok((await o.inputValue(`#th-${V.id}-next`)).length > 0);
  await row.locator('button', { hasText: 'שמירה' }).first().click();
  await toastHas(o, 'סיכום המצב של מספרת רון נשמר.');
  const note = db.client_status_notes.find((n) => n.client_id === V.id);
  assert.equal(note.week, '2026-10-18');
  assert.match(note.current, /^עריכה ובקרה/);
  // "בקשת שינוי": three fields, to Lior.
  await o.fill('#cr-problem', 'אין מקום לרשום את מספר הסרטון בתיקון');
  await o.fill('#cr-why', 'העורך מנחש איזה סרטון');
  await o.fill('#cr-proposal', 'שדה מספר בכל שורה');
  await o.click('#cr-submit');
  await toastHas(o, 'בקשת השינוי נשלחה לליאור');
  assert.equal(db.change_requests.length, 1);
  // "אין מי שייצא לאפיון": a structured message to Lior.
  await o.selectOption('#nb-client', C.id);
  await o.fill('#nb-info', 'הלקוח מבקש פגישה בבוקר');
  await o.click('#nb-submit');
  await toastHas(o, 'נשלח לליאור: אין מי שייצא לאפיון של גן ורד.');
  const nb = db.client_tasks.find((t) => t.title.startsWith('אין מי שייצא לאפיון'));
  assert.equal(nb.source, 'escalation');
  assert.match(nb.title, /ויצמן 5, רחובות · הלקוח מבקש פגישה בבוקר$/);
  await shot(o, 'office-06-pass');
  globalThis.tctx = tctx;
});

await step('a 360px phone: no sideways scrolling and 44px targets on the three screens and Ilai\'s card', async () => {
  // Ilai's card on Tuesday, the day of the characterization (a day later it is gone).
  for (const [path, who, sel, root, time] of [['qa.html', 'ofir', '#qa-h', '#app', THU], ['pass.html', 'ofir', '#ps-list', '#app', THU], ['decisions.html', 'lior', '#ex-h', '#app', THU], ['clients.html#mine', 'ilai', '.g-ilai summary', '.g-ilai', TUE]]) {
    const pctx = await newContext(time, { width: 360, height: 780 });
    const page = await newPage(pctx);
    await signIn(page, path, who);
    await page.waitForSelector(sel);
    await page.waitForTimeout(300);
    assert.ok(await noHScroll(page), `${path} scrolls sideways at 360px`);
    if (root === '.g-ilai') await page.locator('.g-ilai summary').first().click();
    const small = await page.evaluate((r) => [...document.querySelectorAll(['button', 'a.btn', 'summary', '.chip', 'select', 'input:not([type=checkbox]):not([type=radio])', '.of-card a'].map((x) => `${r} ${x}`).join(', '))]
      .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44 && !e.closest('.topbar, .sr-only, #now-bar, .now-bar, #push-card'))
      .map((e) => `${e.tagName}.${e.className}:${e.textContent.trim().slice(0, 20)}:${Math.round(e.getBoundingClientRect().height)}`), root);
    assert.deepEqual(small, [], `${path}: targets under 44px`);
    await page.evaluate((r) => document.querySelectorAll(`${r} details`).forEach((d) => { d.open = true; }), root);
    assert.deepEqual(await unlabeled(page, root), [], `${path}: form controls without a label`);
    await shot(page, `office-07-phone-${path.split('.')[0]}`);
    if (OUT && process.env.PHONE_PAGES) {
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0, i = 0; y < h && i < 8; y += 760, i += 1) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.screenshot({ path: `${OUT}/office-phone-${path.split('.')[0]}-${i}.png` }); }
    }
    await pctx.close();
  }
});

await step('a 390px phone: the stuck row (three ways out, the reason field) and "החלפת עורך" fit, with 44px targets', async () => {
  db.office_passes = db.office_passes.filter((x) => x.day !== '2026-10-22'); // Thursday's pass is open again
  const pctx = await newContext(THU, { width: 390, height: 844 });
  const page = await newPage(pctx);
  await signIn(page, 'pass.html', 'ofir');
  await page.waitForSelector('#ps-list .ps-row');
  if (await page.locator('#ps-list .more-btn').count()) await page.click('#ps-list .more-btn');
  const row = page.locator('#ps-list .ps-row:has(.ps-stuck-acts)').first();
  const id = await row.getAttribute('id');
  await page.click(`#${id}-why-open`);
  await page.waitForSelector(`#${id}-why-text`);
  assert.ok(await noHScroll(page), 'the stuck row scrolls sideways at 390px');
  for (const el of await row.locator('button, input').all()) assert.ok((await el.boundingBox()).height >= 44, 'a 44px target in the stuck row');
  assert.deepEqual(await unlabeled(page, `#${id}`), []);
  if (OUT) await row.screenshot({ path: `${OUT}/office-08-phone-390-stuck-row.png` });
  await page.goto(`${BASE}qa.html`);
  await page.waitForSelector('#load-list .sw-btn');
  await page.locator('#load-list .sw-btn').first().click();
  await page.waitForSelector('#dlg-assign[open]');
  assert.ok(await noHScroll(page), 'the swap dialog scrolls sideways at 390px');
  for (const el of await page.locator('#dlg-assign .wrow, #dlg-assign .dlg-foot .btn').all()) if (await el.isVisible()) assert.ok((await el.boundingBox()).height >= 44, 'a 44px target in the swap dialog');
  assert.deepEqual(await unlabeled(page, '#dlg-assign'), []);
  if (OUT) await page.screenshot({ path: `${OUT}/office-09-phone-390-swap.png` });
  await pctx.close();
});

assert.deepEqual(errors, []);
await browser.close();
noCspViolations();
console.log(`\n${passed} steps passed`);
