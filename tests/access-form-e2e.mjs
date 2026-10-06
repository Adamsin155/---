// End-to-end check of the client's logins form (the owner's request of 6.10.2026)
// against an in-memory fake of Supabase that answers as the migration does
// (supabase/migrations/20261008100000_client_access_form.sql), with the browser's clock
// fixed on Sunday 11.10.2026 at 10:00 in Israel (a new client: the group was opened
// this morning, so the welcome message is today's):
//   - Irit (no vault flag) makes the link in the card's vault block, copies the ready
//     message; the welcome message in her queue carries the link by itself, and for a
//     client without a link the queue offers to make one right there; the record of a
//     sent message never keeps the token;
//   - the client opens the link on a 360px phone: the business name, the reassuring
//     words, three mandatory cards, "הוספת פלטפורמה", notes; the send button waits for
//     the three cards; inline Hebrew errors; the confirmation never shows a password;
//     after sending: thanks, and the link shows only "הפרטים התקבלו"; nothing is kept
//     in the browser, nothing is loaded from a third party, and over http:// the page
//     refuses to work;
//   - an expired, a revoked, a locked and a malformed link each get a plain message;
//   - the office: the card says "מולא" with the platforms, the choices and the client's
//     notes; Lior (vault) sees "התקבל מהלקוח, עוד לא נבדק" and opens the password; Ilai's
//     ring and Irit's quiet note are due; Ofir's "האפיון הסתיים" form shows what the
//     client already sent and asks only for the rest; a later form of the client does
//     not touch what it did not fill;
//   - two days later, with a link still waiting: the nudge is in Irit's queue.
// Run: npx http-server -p 8107 -s -c-1 . &  then  BASE_URL=http://localhost:8107/ node tests/access-form-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { payloadProblem, summaryOf, STATUS_OF, CLIENT_BY, MAX_ATTEMPTS, platformName, accessLine, ACCESS_FALLBACK } from '../app/access-logic.js';
import { nudgeRef } from '../app/access-nudge.js';
import { computeReminders } from '../app/reminder-engine.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
let NOW = new Date('2026-10-11T10:00:00+03:00'); // Sunday
const serverNow = () => new Date(NOW);
const iso = () => serverNow().toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;

// ── People: the vault flag is the owner's, Lior's and Ofir's ──
const people = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia' };
const VAULT = new Set(['owner', 'lior', 'ofir']);
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: VAULT.has(k), phone: null }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const rowOf = (u) => staff.find((r) => r.email === u?.email) || null;
const personOf = (u) => rowOf(u)?.person ?? undefined;
const isOffice = (u) => { const p = personOf(u); return p === null || ['irit', 'lior', 'ofir', 'ilai'].includes(p); };
const canManage = (u) => { const p = personOf(u); return p === null || ['irit', 'lior', 'ofir'].includes(p); };
const hasVault = (u) => !!rowOf(u)?.vault && isOffice(u);

// ── The clients: a deal closed this morning, the group just opened ──
const client = (id, name, business, extra = {}) => ({
  id, name, business, address: null, phone: '050-1112222', package_name: 'Social · דניס, מישל וסמיון', shoot_type: 'dms', characterizer: 'ofir',
  has_logo: null, editor_name: null, editor: null, deal_at: '2026-10-11T09:00:00+03:00', char_at: '2026-10-13T10:00:00+03:00', shoot_at: null,
  contract_end: '2027-10-11', status: 'active', notes: 'הערה פנימית: לקוחה רגישה למחיר', quote_id: null, created_at: '2026-10-11T09:00:00+03:00',
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: { videos: 25 }, rounds: [], verified_at: null, verified_by: null, closed_reason: null, protocol_version: 6, ...extra,
});
const D = client('dddddddd-0000-4000-8000-000000000001', 'דנה לוי', 'קפה דנה');
const E = client('eeeeeeee-0000-4000-8000-000000000002', 'רון כהן', 'רון נדל״ן');
const F = client('ffffffff-0000-4000-8000-000000000003', 'מיה בר', 'סטודיו מיה');
const check = (c, key, at = '2026-10-11T09:10:00+03:00', by = 'irit@astrateg.test', note = null) => ({ client_id: c.id, item_key: key, state: 'done', note, by_email: by, at });
const db = {
  staff,
  clients: [D, E, F],
  protocol_checks: [D, E, F].flatMap((c) => ['p01.prepared', 'p01.sent', 'p01.signed', 'p02.opened'].map((k) => check(c, k))),
  client_tasks: [], protocol_log: [], client_access: [], client_access_log: [], client_access_links: [], client_status_notes: [], office_reviews: [],
  quotes: [], client_messages: [], message_templates: [], client_questions: [], client_date_changes: [], reminder_log: [], push_subscriptions: [],
  characterizations: [], content_briefs: [], client_status_links: [], client_status_views: [], client_approvals: [], client_surveys: [], client_consents: [],
};
const hash = (t) => createHash('sha256').update(t).digest('hex');
const linkTokens = new Map(); // the fake's Vault: link id -> token
const secrets = new Map();    // the fake's Vault: secret id -> password
const clientOf = (id) => db.clients.find((c) => c.id === id);
const checkOf = (c, key) => db.protocol_checks.find((x) => x.client_id === c.id && x.item_key === key) || null;

// ── The database's functions, as the migration defines them ──
function linkReason(l) {
  if (!l) return 'invalid';
  if (l.revoked_at) return 'revoked';
  if (l.submitted_at) return 'done';
  if (l.attempts >= MAX_ATTEMPTS) return 'locked';
  if (new Date(l.expires_at) <= serverNow()) return 'expired';
  const c = clientOf(l.client_id);
  if (!c || !['active', 'ending'].includes(c.status)) return 'closed';
  return null;
}
const linkByToken = (t) => (/^[A-Za-z0-9_-]{43}$/.test(String(t || '')) ? db.client_access_links.find((x) => x.token_hash === hash(t)) || null : null);
function formInfo(token, me) {
  const l = linkByToken(token);
  const reason = linkReason(l);
  if (reason) return { state: reason };
  const c = clientOf(l.client_id);
  return { state: 'ok', business: c.business || c.name, preview: !!me };
}
function setCheckAs(c, key, note) {
  const old = checkOf(c, key);
  if (old?.state === 'done') return;
  db.protocol_checks = db.protocol_checks.filter((x) => x !== old);
  db.protocol_checks.push({ client_id: c.id, item_key: key, state: 'done', note, by_email: 'system', at: iso() });
}
function formSubmit(token, payload) {
  const l = linkByToken(token);
  const reason = linkReason(l);
  if (reason) return { state: reason };
  if (payloadProblem(payload) !== null) {
    l.attempts += 1;
    return { state: l.attempts >= MAX_ATTEMPTS ? 'locked' : 'refused', left: Math.max(0, MAX_ATTEMPTS - l.attempts) };
  }
  const c = clientOf(l.client_id);
  const names = [];
  const open = [];
  for (const e of payload.entries) {
    const label = String(e.label ?? '').trim() || null;
    const user = String(e.username ?? '').trim() || null;
    const status = STATUS_OF[e.choice];
    let a = db.client_access.find((x) => x.client_id === c.id && x.network === e.network && (e.network !== 'other' || String(x.label || '').trim().toLowerCase() === label.toLowerCase()));
    const fresh = !a;
    const was = a?.status;
    const note = e.choice === 'have' ? 'מהלקוח, בטופס פרטי הכניסה. עוד לא נבדק.' : e.choice === 'none' ? 'מהלקוח, בטופס פרטי הכניסה: אין כיום, צריך לפתוח.' : 'מהלקוח, בטופס פרטי הכניסה: יש, וצריך לחדש סיסמה.';
    if (fresh) {
      a = { id: randomUUID(), client_id: c.id, network: e.network, label, username: user, has_secret: null, status, note, updated_by: CLIENT_BY, updated_at: iso(), created_at: iso(), broken_since: null };
      db.client_access.push(a);
    } else {
      Object.assign(a, { username: e.choice === 'have' || (e.choice === 'reset' && user) ? user : a.username, status, note, updated_by: CLIENT_BY, updated_at: iso() });
    }
    a.broken_since = status === 'broken' ? (a.broken_since || iso()) : null;
    if (e.choice === 'have') {
      if (a.has_secret) secrets.delete(a.has_secret);
      a.has_secret = randomUUID();
      secrets.set(a.has_secret, e.password);
    }
    db.client_access_log.push({ id: db.client_access_log.length + 1, access_id: a.id, client_id: c.id, network: e.network, action: fresh ? 'create' : 'update', by_email: CLIENT_BY, at: iso() });
    names.push(platformName(e.network, label));
    if (e.choice === 'none' && (fresh || was !== 'missing')) open.push(platformName(e.network, label));
  }
  Object.assign(l, { submitted_at: iso(), summary: summaryOf(payload), client_note: String(payload.notes ?? '').trim() || null });
  linkTokens.delete(l.id);
  setCheckAs(c, 'p05.access', `מהלקוח, בטופס פרטי הכניסה: ${names.join(', ')}`);
  setCheckAs(c, 'p05.vault', 'נכנס לכספת מטופס פרטי הכניסה של הלקוח');
  if (open.length) {
    db.client_tasks.push({ id: randomUUID(), client_id: c.id, title: `לפתוח ללקוח ${open.join(', ')} ולהכניס את הגישה לכספת (הלקוח סימן בטופס: אין כיום)`, owner: 'ilai', urgent: true, due_on: null, done_at: null, done_by_email: null, source: null, brief: null, started_at: null, created_by_email: '', created_at: iso() });
  }
  return { state: 'done' };
}
function makeLink(clientId, by, at = iso()) {
  for (const l of db.client_access_links) if (l.client_id === clientId && !l.revoked_at && !l.submitted_at) { l.revoked_at = iso(); l.revoked_by = by; linkTokens.delete(l.id); }
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  const expires = new Date(new Date(at).getTime() + 14 * 864e5).toISOString();
  db.client_access_links.push({ id, client_id: clientId, token_hash: hash(token), created_at: at, created_by: by, expires_at: expires, revoked_at: null, revoked_by: null, submitted_at: null, attempts: 0, summary: null, client_note: null });
  linkTokens.set(id, token);
  return { id, token, expiresAt: expires };
}
const workStatuses = (ids) => db.client_access.filter((a) => !ids || ids.includes(a.client_id))
  .map((a) => ({ client_id: a.client_id, network: a.network, label: a.label, status: a.status, updated_at: a.updated_at, by_client: a.updated_by === CLIENT_BY }));

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
  const lim = Number(params.get('limit') || 1e9);
  return out.slice(Number(params.get('offset') || 0), Number(params.get('offset') || 0) + lim);
}

const rpcCalls = [];
const OFFICE_TABLES = new Set(['client_access_links', 'client_status_links', 'client_status_views', 'client_approvals', 'client_surveys', 'client_consents', 'client_messages', 'message_templates']);
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
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(p)?.[1];
  if (rpc) {
    rpcCalls.push({ name: rpc, body, anon: !me, url: req.url() });
    // The page's two functions: for anon (and a signed-in staff member only looks).
    if (rpc === 'access_form_info') return json(200, formInfo(body.p_token, me));
    if (rpc === 'access_form_submit') {
      if (me) return json(403, { code: '42501', message: 'staff cannot send the form for the client' });
      return json(200, formSubmit(body.p_token, body.p_payload));
    }
    if (rpc === 'is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
    if (!me) return json(401, { code: '42501', message: 'permission denied' });
    if (rpc === 'access_link_create') {
      if (!canManage(me)) return json(403, { code: '42501', message: 'not allowed' });
      return json(200, makeLink(body.p_client, me.email));
    }
    if (rpc === 'access_link_token') {
      if (!canManage(me)) return json(403, { code: '42501', message: 'not allowed' });
      const l = db.client_access_links.find((x) => x.id === body.p_id);
      return json(200, l && !linkReason(l) ? linkTokens.get(l.id) || null : null);
    }
    if (rpc === 'access_link_revoke') {
      if (!canManage(me)) return json(403, { code: '42501', message: 'not allowed' });
      const l = db.client_access_links.find((x) => x.id === body.p_id);
      if (l && !l.revoked_at && !l.submitted_at) { Object.assign(l, { revoked_at: iso(), revoked_by: me.email }); linkTokens.delete(l.id); }
      return json(200, null);
    }
    if (rpc === 'access_work_statuses') return json(200, isOffice(me) ? workStatuses(body?.p_clients || null) : []);
    if (rpc === 'can_use_vault' || rpc === 'can_use_client_vault') return json(200, hasVault(me));
    if (rpc === 'access_save') {
      if (!hasVault(me)) return json(400, { message: 'not allowed' });
      let a = db.client_access.find((x) => x.id === body.p_id);
      const fields = { network: body.p_network, label: body.p_label || null, username: body.p_username || null, status: body.p_status || 'ok', note: body.p_note || null, updated_by: me.email, updated_at: iso() };
      const fresh = !a;
      if (a) Object.assign(a, fields); else { a = { id: randomUUID(), client_id: body.p_client, has_secret: null, created_at: fields.updated_at, broken_since: null, ...fields }; db.client_access.push(a); }
      if (body.p_password) { a.has_secret ||= randomUUID(); secrets.set(a.has_secret, body.p_password); }
      db.client_access_log.push({ id: db.client_access_log.length + 1, access_id: a.id, client_id: a.client_id, network: a.network, action: fresh ? 'create' : 'update', by_email: me.email, at: iso() });
      return json(200, a.id);
    }
    if (rpc === 'access_reveal') {
      if (!hasVault(me)) return json(400, { message: 'not allowed' });
      const a = db.client_access.find((x) => x.id === body.p_id);
      db.client_access_log.push({ id: db.client_access_log.length + 1, access_id: a.id, client_id: a.client_id, network: a.network, action: 'reveal', by_email: me.email, at: iso() });
      return json(200, secrets.get(a.has_secret) ?? null);
    }
    return json(200, null);
  }
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${m?.[1]}'` });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' })) : json(200, rows));
  if (req.method() === 'GET') {
    let rows = applyFilters(db[table], url.searchParams);
    if (OFFICE_TABLES.has(table) && !isOffice(me)) rows = [];
    if ((table === 'client_access' || table === 'client_access_log') && !hasVault(me)) rows = [];
    if (table === 'client_access_links') rows = rows.map(({ token_hash, ...r }) => r);
    return reply(rows);
  }
  if (['client_access', 'client_access_log', 'client_access_links'].includes(table)) return json(403, { code: '42501', message: `permission denied for table ${table}` });
  if (req.method() === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const out = [];
    for (const r of rows) {
      if (table === 'protocol_checks') {
        const row = { client_id: r.client_id, item_key: r.item_key, state: r.state, note: r.note ?? null, by_email: me.email, at: iso() };
        db.protocol_checks = db.protocol_checks.filter((x) => !(x.client_id === r.client_id && x.item_key === r.item_key));
        db.protocol_checks.push(row);
        out.push(row);
      } else if (table === 'client_messages') {
        const row = { id: randomUUID(), client_id: r.client_id, kind: r.kind, template_key: r.template_key ?? null, ref: r.ref ?? null, body: r.body, sent_by_email: me.email, sent_at: iso() };
        db.client_messages.push(row);
        out.push(row);
      } else if (table === 'characterizations') {
        const row = { client_id: r.client_id, fields: r.fields, completed_at: r.completed_at ? iso() : null, completed_by: r.completed_at ? me.email : null, by_email: me.email, at: iso() };
        db.characterizations = db.characterizations.filter((x) => x.client_id !== r.client_id);
        db.characterizations.push(row);
        out.push(row);
      } else if (table === 'client_tasks') {
        const row = { due_on: null, done_at: null, done_by_email: null, source: null, brief: null, urgent: false, started_at: null, ...r, id: randomUUID(), created_by_email: me.email, created_at: iso() };
        db.client_tasks.push(row);
        out.push(row);
      } else return json(405, { message: `POST ${table} not in this fake` });
    }
    return reply(out);
  }
  if (req.method() === 'PATCH') {
    const rows = applyFilters(db[table], url.searchParams);
    for (const r of rows) Object.assign(r, body);
    return reply(rows);
  }
  if (req.method() === 'DELETE') {
    const gone = applyFilters(db[table], url.searchParams);
    db[table] = db[table].filter((r) => !gone.includes(r));
    return reply(gone);
  }
  return json(200, []);
}

// ── Browser ───────────────────────────────
const launch = (args = []) => chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args });
const browser = await launch();
const errors = [];
const requested = []; // every address a page of the client asked for
const PHONE = { width: 360, height: 740 };
async function newContext(viewport = { width: 1280, height: 900 }, b = browser) {
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, hasTouch: viewport.width < 500, isMobile: viewport.width < 500 });
  await ctx.clock.setFixedTime(NOW);
  if (b === browser) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>wa</title>' }));
  return ctx;
}
async function newPage(ctx, { track = false } = {}) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  if (track) page.on('request', (r) => requested.push(r.url()));
  return page;
}
async function signIn(page, path, email) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app:not([hidden])');
}
const shot = async (page, name) => { if (!OUT) return; await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const shotOf = async (page, sel, name) => { if (OUT) await page.locator(sel).first().screenshot({ path: `${OUT}/${name}.png` }); };
const toastHas = (page, s) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), s);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const text = (page, sel) => page.locator(sel).first().innerText();
const unlabeled = (page) => page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), textarea, select')]
  .filter((el) => !el.closest('[hidden]') && !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.closest('label') && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
  .map((el) => el.id || el.name));
// Every button and choice a finger has to hit is at least 44px tall.
const smallTargets = (page) => page.evaluate(() => [...document.querySelectorAll('#page button, #page .schoice span, #page input.sinput, #page select, #page textarea')]
  .filter((el) => !el.closest('[hidden]') && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 44).map((el) => el.id || el.textContent.trim()));
let passed = 0;
async function step(name, fn) { await fn(); passed += 1; console.log(`ok ${passed} - ${name}`); }
const world = () => ({ clients: db.clients, checks: db.protocol_checks, tasks: db.client_tasks, staff, access: db.client_access, accessLinks: db.client_access_links, reviews: [], statusNotes: [], messages: [], subscriptions: [] });

// ── Irit makes the link ───────────────────
const iritCtx = await newContext();
const irit = await newPage(iritCtx);
let token = null;
let link = null;

await step('the card: the vault block shows the form\'s link to Irit, who has no vault flag: not created yet', async () => {
  await signIn(irit, `client.html?id=${D.id}`, 'irit@astrateg.test');
  await irit.waitForSelector('#access-link');
  assert.ok(await irit.locator('#access').isVisible());
  assert.equal(await text(irit, '#al-h'), 'קישור ללקוח למילוי פרטי הכניסה');
  assert.match(await text(irit, '#al-state'), /^לא נוצר · עוד לא נוצר קישור\.$/);
  // Who opens the passwords does not change: no list, no "add", and it says why.
  assert.ok(await irit.locator('#access-novault').isVisible());
  assert.ok(await irit.locator('#access-list').isHidden());
  assert.ok(await irit.locator('#access-add').isHidden());
});

await step('Irit creates the link and copies a ready WhatsApp message with it: 14 days, waiting for the client', async () => {
  await irit.click('#al-create');
  await toastHas(irit, 'נוצר קישור');
  await irit.waitForSelector('#al-copy-msg');
  link = db.client_access_links[0];
  assert.equal(link.created_by, 'irit@astrateg.test');
  token = linkTokens.get(link.id);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await text(irit, '#al-state'), 'ממתין ללקוח · ממתין ללקוח מאז 11.10.2026 · הקישור תקף עד 25.10.2026.');
  await irit.click('#al-copy-msg');
  await toastHas(irit, 'הועתק');
  const msg = (await irit.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  assert.match(msg, /^היי דנה לוי, כדי שנוכל להתחיל לעבוד על הרשתות שלכם, מלאו בקישור המאובטח את פרטי הכניסה:\n/);
  assert.ok(msg.includes(`${BASE}access.html#t=${token}`), msg);
  assert.match(msg, /הקישור אישי ותקף ל־14 יום/);
  const wa = await irit.getAttribute('#al-wa', 'href');
  assert.ok(wa.startsWith('https://wa.me/972501112222?text='), wa);
  assert.equal(decodeURIComponent(wa.split('?text=')[1]), msg);
  // One pink action at most on the screen; the block's buttons are quiet ones.
  assert.equal(await irit.locator('#access-link .btn-primary').count(), 0);
  await shotOf(irit, '#access', '01-card-link-desktop');
});

await step('the welcome message in Irit\'s queue carries the link by itself, in one line', async () => {
  await irit.goto(`${BASE}messages.html`);
  await irit.waitForSelector(`#msg-text-${D.id}`);
  await irit.waitForFunction((id) => document.getElementById(`msg-text-${id}`).value.includes('access.html#t='), D.id);
  const body = await irit.inputValue(`#msg-text-${D.id}`);
  assert.ok(body.includes(`את הגישות לרשתות לא שולחים בהודעה.\n${accessLine(`${BASE}access.html#t=${token}`)}\n\nבכל יום חמישי`), body);
  assert.equal(body.split('access.html').length, 2, 'the link once');
  assert.ok(await irit.locator(`#msg-fill-${D.id}`).isHidden(), 'nothing left to fill');
  assert.match(await text(irit, `#msg-access-${D.id}`), /ההודעה כוללת את הקישור לטופס פרטי הכניסה/);
  assert.equal(await irit.locator(`#msg-link-${D.id}`).count(), 0);
});

await step('a client without a link: the plain sentence, and "יצירת קישור" right there puts the link in the message', async () => {
  const before = await irit.inputValue(`#msg-text-${E.id}`);
  assert.ok(before.includes(`את הגישות לרשתות לא שולחים בהודעה.\n${ACCESS_FALLBACK}`), before);
  assert.ok(!before.includes('access.html'));
  assert.match(await text(irit, `#msg-access-${E.id}`), /אין עדיין קישור ללקוח למילוי פרטי הכניסה לרשתות\./);
  assert.ok((await irit.locator(`#msg-link-${E.id}`).boundingBox()).height >= 44);
  await irit.click(`#msg-link-${E.id}`);
  await toastHas(irit, 'נוצר קישור לטופס פרטי הכניסה של רון כהן');
  const l = db.client_access_links.find((x) => x.client_id === E.id);
  assert.ok(l && l.created_by === 'irit@astrateg.test');
  const after = await irit.inputValue(`#msg-text-${E.id}`);
  assert.ok(after.includes(accessLine(`${BASE}access.html#t=${linkTokens.get(l.id)}`)), after);
  assert.equal(await irit.locator(`#msg-link-${E.id}`).count(), 0);
  // Exactly one pink action per card of the queue (the send), as before.
  assert.equal(await irit.locator(`#msg-${E.id} .btn-primary`).count(), 1);
  await shotOf(irit, `#msg-${E.id}`, '02-queue-welcome-desktop');
});

await step('sending the welcome: WhatsApp gets the link; the record of the message keeps the words, never the token', async () => {
  const href = await irit.getAttribute(`#msg-send-${D.id}`, 'href');
  assert.ok(decodeURIComponent(href).includes(`access.html#t=${token}`));
  const [popup] = await Promise.all([iritCtx.waitForEvent('page'), irit.click(`#msg-send-${D.id}`)]);
  assert.ok(decodeURIComponent(popup.url()).includes(`access.html#t=${token}`), 'the client gets the real link');
  await popup.close();
  await irit.waitForFunction(() => document.querySelector('#toast.on')?.textContent.includes('נרשם: נשלחה הודעה לדנה לוי'));
  const m = db.client_messages.find((x) => x.client_id === D.id);
  assert.equal(m.template_key, 'welcome');
  assert.ok(!m.body.includes(token), 'no token in client_messages');
  assert.ok(m.body.includes('access.html#t=…'));
  assert.ok(!JSON.stringify(db.client_messages).includes(token));
  // Sending the welcome still checks process 2's intro, as before.
  for (let i = 0; i < 20 && !checkOf(D, 'p02.intro'); i += 1) await irit.waitForTimeout(100);
  assert.equal(checkOf(D, 'p02.intro')?.state, 'done');
});

// ── The client on the phone ───────────────
const clientCtx = await newContext(PHONE);
const cl = await newPage(clientCtx, { track: true });
const formUrl = () => `${BASE}access.html#t=${token}`;
const SECRET = 'Insta-סוד 9!';

await step('the link opens on a 360px phone: the business, why, how it is kept; three mandatory cards; the send button waits', async () => {
  await cl.goto(formUrl());
  await cl.waitForSelector('#page:not([hidden])');
  assert.equal(await text(cl, '#business'), 'קפה דנה');
  assert.equal(await text(cl, '#hello-h'), 'פרטי הכניסה לרשתות החברתיות');
  assert.match(await text(cl, '#why'), /אנחנו צריכים את שם המשתמש והסיסמה של כל רשת/);
  assert.deepEqual(await cl.locator('#points li').allInnerTexts(), [
    'הפרטים נשמרים מוצפנים.', 'רק אנשי הצוות שמטפלים בחשבון שלכם יכולים לפתוח אותם, וכל פתיחה נרשמת.', 'אחרי השליחה אי אפשר לקרוא את הפרטים מהדף הזה, גם לא עם הקישור.',
  ]);
  assert.deepEqual(await cl.locator('#cards .scard h2').evaluateAll((hs) => hs.map((h) => h.firstChild.textContent)), ['Instagram', 'Facebook', 'TikTok']);
  assert.deepEqual(await cl.locator('#card-instagram .schoice').allInnerTexts(), ['יש לי פרטי כניסה', 'אין כיום, צריך לפתוח', 'יש, וצריך לחדש סיסמה']);
  assert.equal(await cl.locator('#next').isDisabled(), true);
  assert.equal(await text(cl, '#wait'), 'כדי להמשיך חסר: Instagram, Facebook, TikTok.');
  assert.ok(await cl.locator('#preview').isHidden());
  assert.ok(await noHScroll(cl), 'no horizontal scroll at 360px');
  assert.deepEqual(await unlabeled(cl), []);
  assert.deepEqual(await smallTargets(cl), []);
  assert.equal(await cl.getAttribute('html', 'lang'), 'he');
  assert.equal(await cl.getAttribute('html', 'dir'), 'rtl');
  assert.equal(await cl.getAttribute('meta[name="referrer"]', 'content'), 'no-referrer');
  // Only what the page needs was asked from the database: the state and the business name.
  const info = rpcCalls.filter((c) => c.name === 'access_form_info').at(-1);
  assert.deepEqual([info.anon, Object.keys(info.body)], [true, ['p_token']]);
  assert.ok(!info.url.includes(token), 'the token is in the request body, never in an address');
  assert.deepEqual(formInfo(token, null), { state: 'ok', business: 'קפה דנה', preview: false });
  await shot(cl, '03-form-empty-360');
});

await step('nothing internal on the client\'s page: no staff name, no note, no phone', async () => {
  const all = await cl.evaluate(() => document.body.innerText);
  for (const bad of ['הערה פנימית', '050-1112222', 'עירית', 'ליאור', 'אופיר', 'עילאי', 'כספת', 'דנה לוי']) assert.ok(!all.includes(bad), bad);
});

await step('a login: user name and password are both required, with Hebrew messages; the password hides and shows', async () => {
  await cl.locator('label.schoice:has(#instagram-choice-have)').click();
  await cl.waitForSelector('#instagram-username');
  for (const [id, attr, want] of [
    ['instagram-password', 'type', 'password'], ['instagram-password', 'autocomplete', 'new-password'], ['instagram-password', 'dir', 'ltr'],
    ['instagram-username', 'autocomplete', 'off'], ['instagram-username', 'autocapitalize', 'none'], ['form', 'autocomplete', 'off'],
  ]) assert.equal(await cl.getAttribute(`#${id}`, attr), want, `${id}.${attr}`);
  // Left empty: the messages show once the fields were left, and the card is not done.
  await cl.focus('#instagram-username');
  await cl.focus('#instagram-password');
  await cl.focus('#notes');
  assert.equal(await text(cl, '#instagram-username-err'), 'חסר שם משתמש.');
  assert.equal(await text(cl, '#instagram-password-err'), 'חסרה סיסמה.');
  assert.equal(await cl.getAttribute('#instagram-username', 'aria-invalid'), 'true');
  assert.equal(await text(cl, '#instagram-need'), 'חובה');
  await cl.fill('#instagram-username', 'dana_cafe');
  await cl.fill('#instagram-password', SECRET);
  assert.ok(await cl.locator('#instagram-username-err').isHidden());
  assert.equal(await text(cl, '#instagram-need'), 'מולא ✓');
  // "הצגה" shows it, "הסתרה" hides it again; the button says which password it is.
  assert.equal(await cl.getAttribute('#instagram-password-show', 'aria-pressed'), 'false');
  assert.match(await cl.locator('#instagram-password-show').textContent(), /^הצגה של הסיסמה ל־Instagram$/);
  await cl.click('#instagram-password-show');
  assert.deepEqual([await cl.getAttribute('#instagram-password', 'type'), await cl.getAttribute('#instagram-password-show', 'aria-pressed')], ['text', 'true']);
  assert.equal(await cl.inputValue('#instagram-password'), SECRET);
  await cl.click('#instagram-password-show');
  assert.equal(await cl.getAttribute('#instagram-password', 'type'), 'password');
  assert.equal(await cl.locator('#next').isDisabled(), true);
  assert.equal(await text(cl, '#wait'), 'כדי להמשיך חסר: Facebook, TikTok.');
});

await step('"אין כיום, צריך לפתוח" and "יש, וצריך לחדש סיסמה" (the user name optional): the button is enabled', async () => {
  await cl.locator('label.schoice:has(#facebook-choice-none)').click();
  assert.match(await text(cl, '#facebook-detail'), /נפתח עבורכם עמוד Facebook חדש\./);
  assert.equal(await cl.locator('#facebook-password').count(), 0);
  await cl.locator('label.schoice:has(#tiktok-choice-reset)').click();
  await cl.waitForSelector('#tiktok-username');
  assert.equal(await cl.locator('#tiktok-password').count(), 0, 'no password is asked for a reset');
  assert.equal(await cl.locator('#next').isDisabled(), false, 'the three mandatory cards are complete');
  assert.equal(await text(cl, '#wait'), '');
  await cl.fill('#tiktok-username', 'dana.tt');
  assert.ok(await noHScroll(cl));
});

await step('"הוספת פלטפורמה": the suggestions, a free name, and its own messages before the form goes on', async () => {
  await cl.click('#add');
  await cl.waitForSelector('#x1-platform');
  assert.deepEqual(await cl.locator('#x1-platform option').allInnerTexts(), ['בחירה…', 'YouTube', 'Google Business', 'Meta Business', 'LinkedIn', 'אתר / דומיין', 'אחר']);
  assert.equal(await cl.evaluate(() => document.activeElement.id), 'x1-platform');
  // Not finished: the button stays enabled (the three are complete), and pressing it shows what is missing.
  await cl.click('#next');
  assert.ok(await cl.locator('#confirm').isHidden());
  assert.equal(await text(cl, '#form-err'), 'יש שדות שצריך להשלים או לתקן. הם מסומנים בטופס.');
  assert.equal(await text(cl, '#x1-platform-err'), 'בחרו פלטפורמה.');
  assert.equal(await text(cl, '#x1-password-err'), 'חסרה סיסמה.');
  assert.equal(await cl.evaluate(() => document.activeElement.id), 'x1-platform');
  await cl.selectOption('#x1-platform', 'custom');
  await cl.waitForSelector('#x1-label');
  await cl.fill('#x1-label', 'Pinterest');
  await cl.fill('#x1-username', 'dana@cafe.co.il');
  await cl.fill('#x1-password', 'Pin-123');
  // A second one, removed again.
  await cl.click('#add');
  await cl.waitForSelector('#x2-platform');
  await cl.selectOption('#x2-platform', 'youtube');
  await cl.click('#x2-remove');
  assert.equal(await cl.locator('#x2-platform').count(), 0);
  await cl.fill('#notes', 'קוד האימות מגיע לטלפון של דנה');
  assert.deepEqual(await unlabeled(cl), []);
  assert.deepEqual(await smallTargets(cl), []);
  assert.ok(await noHScroll(cl));
  await shot(cl, '04-form-filled-360');
});

await step('the confirmation lists the platforms and the choices, never a password', async () => {
  await cl.click('#next');
  await cl.waitForSelector('#confirm:not([hidden])');
  assert.equal(await cl.evaluate(() => document.activeElement.id), 'confirm');
  const lines = (await cl.locator('#review li').allInnerTexts()).map((t) => t.replace(/\s*\n\s*/g, ' | '));
  assert.deepEqual(lines, [
    'Instagram | יש לי פרטי כניסה | שם משתמש: dana_cafe | סיסמה: הוזנה (לא מוצגת)',
    'Facebook | אין כיום, צריך לפתוח',
    'TikTok | יש, וצריך לחדש סיסמה | שם משתמש: dana.tt',
    'Pinterest | יש לי פרטי כניסה | שם משתמש: dana@cafe.co.il | סיסמה: הוזנה (לא מוצגת)',
  ]);
  assert.equal(await text(cl, '#review-notes'), 'הערות: קוד האימות מגיע לטלפון של דנה');
  const shown = await cl.evaluate(() => document.getElementById('confirm').innerText);
  for (const secret of [SECRET, 'Pin-123']) assert.ok(!shown.includes(secret), secret);
  // One pink action on this step too: "שליחה".
  assert.equal(await cl.locator('#confirm .sbtn-ok').count(), 1);
  assert.ok(await cl.locator('#form').isHidden());
  assert.ok((await cl.locator('#send').boundingBox()).height >= 44);
  assert.ok(await noHScroll(cl));
  await shot(cl, '05-confirm-360');
  // "חזרה לעריכה" keeps everything as typed.
  await cl.click('#back');
  assert.equal(await cl.inputValue('#instagram-username'), 'dana_cafe');
  assert.equal(await cl.inputValue('#instagram-password'), SECRET);
  await cl.click('#next');
  await cl.waitForSelector('#confirm:not([hidden])');
});

await step('nothing typed is kept in the browser, and nothing is loaded from a third party', async () => {
  const stored = await cl.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]));
  for (const typed of [SECRET, 'Pin-123', 'dana_cafe', 'dana.tt', 'קוד האימות']) assert.ok(!stored.includes(typed), typed);
  const origins = [...new Set(requested.map((u) => new URL(u).origin))].sort();
  assert.deepEqual(origins, [new URL(BASE).origin, 'https://czncjzziqrqtezpwxxpz.supabase.co'].sort());
  for (const u of requested) assert.ok(!u.includes(token), `the token is never in a request's address: ${u.slice(0, 80)}`);
  // The same files as the status page loads, and the page's own: no protocol, no pricing.
  const scripts = requested.filter((u) => u.endsWith('.js')).map((u) => u.slice(BASE.length)).sort();
  assert.deepEqual(scripts, ['app/access-form.js', 'app/access-logic.js', 'app/supa.js', 'app/tz.js', 'app/vendor/supabase.js']);
});

await step('sending: thanks; the vault got the logins as the office saves them; process 5 and Ilai\'s task', async () => {
  await cl.click('#send');
  await cl.waitForSelector('#thanks:not([hidden])');
  assert.equal(await text(cl, '#thanks-h'), 'תודה! הפרטים התקבלו');
  assert.match(await text(cl, '#thanks-text'), /הפרטים נשמרו מוצפנים/);
  assert.equal(await cl.evaluate(() => document.activeElement.id), 'thanks');
  assert.ok(await cl.locator('#page').isHidden());
  // Nothing of what was typed is left in the page.
  const left = await cl.evaluate(() => document.documentElement.outerHTML + [...document.querySelectorAll('input, textarea')].map((e) => e.value).join('|'));
  for (const typed of [SECRET, 'Pin-123', 'dana_cafe']) assert.ok(!left.includes(typed), typed);
  const call = rpcCalls.filter((c) => c.name === 'access_form_submit').at(-1);
  assert.deepEqual([call.anon, Object.keys(call.body).sort()], [true, ['p_payload', 'p_token']]);
  assert.equal(payloadProblem(call.body.p_payload), null);
  const by = Object.fromEntries(db.client_access.filter((a) => a.client_id === D.id).map((a) => [a.network === 'other' ? a.label : a.network, a]));
  assert.deepEqual(Object.keys(by).sort(), ['Pinterest', 'facebook', 'instagram', 'tiktok']);
  assert.deepEqual([by.instagram.status, by.instagram.username, by.instagram.updated_by, secrets.get(by.instagram.has_secret)], ['new', 'dana_cafe', CLIENT_BY, SECRET]);
  assert.deepEqual([by.facebook.status, by.facebook.username, by.facebook.has_secret], ['missing', null, null]);
  assert.deepEqual([by.tiktok.status, by.tiktok.username, by.tiktok.has_secret], ['broken', 'dana.tt', null]);
  assert.deepEqual([by.Pinterest.status, by.Pinterest.network, secrets.get(by.Pinterest.has_secret)], ['new', 'other', 'Pin-123']);
  assert.ok(link.submitted_at && !linkTokens.has(link.id));
  assert.deepEqual(link.summary.map((s) => `${s.network}:${s.choice}`), ['instagram:have', 'facebook:none', 'tiktok:reset', 'other:have']);
  assert.equal(link.client_note, 'קוד האימות מגיע לטלפון של דנה');
  assert.ok(!JSON.stringify(link).includes(SECRET) && !JSON.stringify(link).includes('dana_cafe'));
  assert.deepEqual([checkOf(D, 'p05.access').by_email, checkOf(D, 'p05.vault').state], ['system', 'done']);
  assert.equal(checkOf(D, 'p05.access').note, 'מהלקוח, בטופס פרטי הכניסה: Instagram, Facebook, TikTok, Pinterest');
  const t = db.client_tasks.filter((x) => x.client_id === D.id);
  assert.deepEqual(t.map((x) => [x.title, x.owner, x.urgent]), [['לפתוח ללקוח Facebook ולהכניס את הגישה לכספת (הלקוח סימן בטופס: אין כיום)', 'ilai', true]]);
  await shot(cl, '06-thanks-360');
});

await step('opening the link again shows "הפרטים התקבלו" and nothing else', async () => {
  await cl.reload();
  await cl.waitForSelector('#state h1');
  assert.equal(await text(cl, '#state h1'), 'הפרטים התקבלו');
  const body = (await cl.evaluate(() => document.querySelector('main').innerText)).trim();
  assert.equal(body, 'הפרטים התקבלו');
  assert.equal(await cl.locator('input:visible, textarea:visible, button:visible').count(), 0);
  assert.deepEqual(formSubmit(token, { entries: [], notes: null }), { state: 'done' });
  assert.ok(await noHScroll(cl));
  await shot(cl, '07-received-360');
});

await step('an expired, a revoked, a malformed and a locked link each get a plain message', async () => {
  const exp = makeLink(F.id, 'irit@astrateg.test');
  db.client_access_links.find((l) => l.id === exp.id).expires_at = new Date(serverNow().getTime() - 60e3).toISOString();
  await cl.goto(`${BASE}access.html#t=${exp.token}`);
  await cl.reload();
  await cl.waitForSelector('#state h1');
  assert.equal(await text(cl, '#state h1'), 'תוקף הקישור הסתיים');
  assert.match(await text(cl, '#state p'), /הקישור תקף ל־14 יום\. בקשו מאיתנו קישור חדש/);
  const rev = makeLink(F.id, 'irit@astrateg.test'); // a new link revokes the one before it
  const fresh = makeLink(F.id, 'irit@astrateg.test');
  assert.ok(db.client_access_links.find((l) => l.id === rev.id).revoked_at);
  const open = async (t) => { await cl.goto(`${BASE}access.html#t=${t}`); await cl.reload(); await cl.waitForSelector('#state h1, #page:not([hidden])'); };
  await open(rev.token);
  assert.equal(await text(cl, '#state h1'), 'הקישור הזה כבר לא פעיל');
  for (const bad of ['abc', 'A'.repeat(43)]) {
    await open(bad);
    assert.equal(await text(cl, '#state h1'), 'הקישור אינו תקין', bad);
  }
  await cl.goto(`${BASE}access.html`);
  await cl.reload();
  await cl.waitForSelector('#state h1');
  assert.equal(await text(cl, '#state h1'), 'הקישור אינו תקין');
  // An address with ?t= (an older way of writing the link) opens too.
  await cl.goto(`${BASE}access.html?t=${fresh.token}`);
  await cl.waitForSelector('#page:not([hidden])');
  assert.equal(await text(cl, '#business'), 'סטודיו מיה');
  // Five refused submissions lock the link.
  db.client_access_links.find((l) => l.id === fresh.id).attempts = MAX_ATTEMPTS;
  await open(fresh.token);
  assert.equal(await text(cl, '#state h1'), 'הקישור ננעל');
  assert.ok(await noHScroll(cl));
  await shot(cl, '08-closed-360');
});

await step('the database refuses a form (a rule broken): the client is told, in Hebrew, and nothing is saved', async () => {
  const l = makeLink(F.id, 'irit@astrateg.test');
  await cl.goto(`${BASE}access.html#t=${l.token}`);
  await cl.reload();
  await cl.waitForSelector('#page:not([hidden])');
  for (const n of ['instagram', 'facebook', 'tiktok']) await cl.locator(`label.schoice:has(#${n}-choice-none)`).click();
  await cl.click('#next');
  await cl.waitForSelector('#confirm:not([hidden])');
  // The answer a tampered page would get.
  await clientCtx.route('**/rest/v1/rpc/access_form_submit', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ state: 'refused', left: 3 }) }), { times: 1 });
  await cl.click('#send');
  await cl.waitForSelector('#form:not([hidden])');
  assert.equal(await text(cl, '#form-err'), 'חלק מהפרטים לא התקבלו. בדקו את השדות המסומנים ונסו שוב. אפשר לנסות עוד 3 פעמים.');
  // No network: the form stays as it was filled, and says so.
  await cl.click('#next');
  await clientCtx.route('**/rest/v1/rpc/access_form_submit', (r) => r.abort(), { times: 1 });
  await cl.click('#send');
  await cl.waitForSelector('#send-err:not([hidden])');
  assert.match(await text(cl, '#send-err'), /השליחה לא הצליחה\. בדקו את החיבור לאינטרנט ונסו שוב\. מה שמילאתם נשאר בדף\./);
  assert.equal(db.client_access.filter((a) => a.client_id === F.id).length, 0);
  // And then it goes through.
  await cl.click('#send');
  await cl.waitForSelector('#thanks:not([hidden])');
  assert.deepEqual(db.client_access.filter((a) => a.client_id === F.id).map((a) => a.status), ['missing', 'missing', 'missing']);
  assert.match(db.client_tasks.find((t) => t.client_id === F.id).title, /^לפתוח ללקוח Instagram, Facebook, TikTok ולהכניס/);
});

await step('over http:// the page refuses to work: "פתחו את הקישור בכתובת מאובטחת", and it sends the visitor to https', async () => {
  const b = await launch(['--host-resolver-rules=MAP access.test 127.0.0.1']);
  const ctx = await newContext(PHONE, b);
  const went = [];
  await ctx.route('https://access.test:*/**', (r) => { went.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>secure</title><h1 id="secure">secure</h1>' }); });
  const page = await newPage(ctx);
  const port = new URL(BASE).port;
  const calls = rpcCalls.length;
  const l = makeLink(E.id, 'irit@astrateg.test');
  await page.goto(`http://access.test:${port}/access.html#t=${l.token}`);
  await page.waitForSelector('#state h1');
  assert.equal(await text(page, '#state h1'), 'פתחו את הקישור בכתובת מאובטחת');
  assert.ok(await page.locator('#page').isHidden());
  assert.equal(await page.getAttribute('#secure-link', 'href'), `https://access.test:${port}/access.html#t=${l.token}`);
  if (OUT) await page.screenshot({ path: `${OUT}/09-insecure-360.png`, fullPage: true });
  await page.waitForSelector('#secure');
  assert.equal(new URL(went[0]).protocol, 'https:');
  assert.equal(rpcCalls.length, calls, 'nothing was asked from the database over http');
  await b.close();
});

// ── Back in the office ────────────────────
await step('Irit\'s card: "מולא", the platforms and the choices, the client\'s notes with their date; never a login', async () => {
  await irit.goto(`${BASE}client.html?id=${D.id}`);
  await irit.waitForSelector('#access-link #al-summary');
  assert.equal(await text(irit, '#al-state'), 'מולא · מולא ב־11.10.2026 בשעה 10:00.');
  assert.equal(await text(irit, '#al-summary'), 'Instagram, Pinterest: התקבלו פרטי כניסה · Facebook: אין כיום, צריך לפתוח · TikTok: צריך לחדש סיסמה');
  assert.equal(await text(irit, '#al-note'), 'הערת הלקוח (11.10.2026): קוד האימות מגיע לטלפון של דנה');
  const all = await irit.evaluate(() => document.getElementById('access').innerText);
  for (const hidden of [SECRET, 'dana_cafe', 'dana.tt']) assert.ok(!all.includes(hidden), hidden);
  assert.ok(await irit.locator('#access-list').isHidden());
  await shotOf(irit, '#access', '10-card-filled-desktop');
});

await step('Irit hears quietly, Ilai is rung "קיבלת גישות" with 30 office minutes, Lior the broken login: each once', async () => {
  const first = computeReminders({ ...world(), now: new Date(serverNow().getTime() + 60e3) });
  const of = (rule, cid = D.id) => first.filter((r) => r.rule === rule && r.clientId === cid).map((r) => `${r.step}@${r.person}:${r.level}`).sort();
  assert.deepEqual(of('accessForm'), ['irit@irit:quiet']);
  assert.equal(first.find((r) => r.rule === 'accessForm' && r.clientId === D.id).title, 'הלקוח מילא את פרטי הכניסה לרשתות: קפה דנה · דנה לוי');
  assert.deepEqual(of('access'), ['now@ilai:ring']);
  assert.match(first.find((r) => r.rule === 'access' && r.clientId === D.id).body, /יש לך 30 דקות לבדוק אותן מהכספת.*יעד היום 10:30/);
  assert.deepEqual(of('broken'), ['now@lior:ring']);
  assert.ok(first.some((r) => r.rule === 'urgent' && r.person === 'ilai' && r.clientId === D.id), 'the task to open Facebook rings Ilai');
  const again = computeReminders({ ...world(), now: new Date(serverNow().getTime() + 5 * 60e3), log: first.map((r) => ({ key: r.key })) });
  assert.deepEqual(again.filter((r) => ['accessForm', 'access', 'broken'].includes(r.rule) && r.clientId === D.id), []);
  const dump = JSON.stringify(first);
  for (const hidden of [SECRET, 'Pin-123', token, 'dana_cafe']) assert.ok(!dump.includes(hidden), hidden);
});

await step('Ilai (no vault flag) sees the client\'s form in his work and in the card: statuses only', async () => {
  const ctx = await newContext(PHONE);
  const page = await newPage(ctx);
  await signIn(page, 'clients.html#mine', 'ilai@astrateg.test');
  await page.waitForFunction((name) => document.getElementById('app').innerText.includes(name), 'קפה דנה');
  const mine = await page.evaluate(() => document.getElementById('app').innerText);
  assert.match(mine, /לפתוח ללקוח Facebook ולהכניס את הגישה לכספת/);
  assert.match(mine, /בדיקת הגישות וסידור הרשתות/);
  assert.ok(await noHScroll(page));
  await shot(page, '11-ilai-mine-360');
  await page.goto(`${BASE}client.html?id=${D.id}`);
  await page.waitForSelector('#access-link #al-summary');
  assert.match(await text(page, '#al-state'), /^מולא · /);
  assert.equal(await page.locator('#al-create').count(), 0, 'Ilai does not make links');
  assert.ok(await page.locator('#access-novault').isVisible());
  // The automatic "הגישות סומנו כנבדקו" did not fire on what the client set.
  await page.waitForTimeout(400);
  assert.equal(checkOf(D, 'p06.verified'), null);
  assert.ok(await noHScroll(page));
  await ctx.close();
});

await step('Lior (vault) sees "התקבל מהלקוח, עוד לא נבדק", who set it, and opens the password; checking it is his status', async () => {
  const ctx = await newContext();
  const page = await newPage(ctx);
  await signIn(page, `client.html?id=${D.id}`, 'lior@astrateg.test');
  await page.waitForSelector('#access-list .access-row');
  const rows = (await page.locator('#access-list .access-row').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  assert.equal(rows.length, 4);
  assert.match(rows[0], /^Instagram dana_cafe התקבל מהלקוח, עוד לא נבדק עודכן · הלקוח \(בטופס\) · .*מהלקוח, בטופס פרטי הכניסה\. עוד לא נבדק\./);
  assert.match(rows[1], /^Facebook אין שם משתמש אין רשת/);
  assert.match(rows[2], /^TikTok dana\.tt לא עובדת/);
  assert.match(rows[3], /^Pinterest dana@cafe\.co\.il התקבל מהלקוח, עוד לא נבדק/);
  assert.ok(await page.locator('#access-list .access-row.a-new').first().isVisible());
  assert.equal(checkOf(D, 'p06.verified'), null, 'a status the client gave is not a check');
  // The one place a password is opened: "הצגת סיסמה" (app/protocol-data.js, revealAccess).
  await page.locator('#access-list .access-row').first().getByRole('button', { name: 'הצגת סיסמה' }).click();
  await page.waitForFunction((s) => document.querySelector('#access-list .secret')?.textContent.includes(s), SECRET);
  assert.equal(db.client_access_log.at(-1).action, 'reveal');
  await page.locator('#access-log-box summary').click();
  assert.match(await text(page, '#access-log'), /הלקוח \(בטופס\) הוסיף\/ה Instagram/);
  await shotOf(page, '#access', '12-card-vault-desktop');
  // Editing a login from the client: "עוד לא נבדק" stays selected until Lior decides.
  await page.locator('#access-list .access-row').first().getByRole('button', { name: 'עריכה' }).click();
  assert.equal(await page.inputValue('#acc-status'), 'new');
  await page.selectOption('#acc-status', 'ok');
  await page.click('#acc-submit');
  await toastHas(page, 'הגישה נשמרה בכספת');
  const insta = db.client_access.find((a) => a.client_id === D.id && a.network === 'instagram');
  assert.deepEqual([insta.status, insta.updated_by, secrets.get(insta.has_secret)], ['ok', 'lior@astrateg.test', SECRET]);
  // A new login is never offered "עוד לא נבדק".
  await page.click('#access-add');
  assert.ok(await page.locator('#acc-status-new').isHidden());
  await ctx.close();
});

await step('Ofir\'s "האפיון הסתיים" form: what the client already sent, per network, status only; he is asked only for the rest', async () => {
  const ctx = await newContext(PHONE);
  const page = await newPage(ctx);
  await signIn(page, `intake.html?id=${D.id}#end`, 'ofir@astrateg.test');
  await page.waitForSelector('#end-form');
  // Lior checked Instagram meanwhile: it is the vault's own status now. Facebook and TikTok are still the client's word.
  assert.match(await text(page, '#end-net-facebook-got'), /Facebook\s*הלקוח כבר מילא: אין רשת/);
  assert.match(await text(page, '#end-net-tiktok-got'), /TikTok\s*הלקוח כבר מילא: לא עובדת/);
  assert.equal(await page.locator('#end-net-instagram-got').count(), 0);
  assert.match(await page.locator('.ik-net:has(#end-net-instagram-none)').innerText(), /Instagram\s*כבר בכספת: תקינה/);
  assert.match(await text(page, '#end-networks-client'), /מה שהלקוח כבר מילא בטופס פרטי הכניסה מסומן כאן/);
  const shownAll = await page.evaluate(() => document.getElementById('end-form').innerText);
  for (const hidden of [SECRET, 'dana.tt', 'dana_cafe']) assert.ok(!shownAll.includes(hidden), hidden);
  assert.ok(await noHScroll(page));
  await shot(page, '13-ofir-end-360');
  // He fills the three short fields and nothing about the networks: accepted, since the client already sent them.
  await page.fill('#end-address', 'הרצל 1, חיפה');
  await page.fill('#end-phone', '04-8112233');
  await page.locator('label.ik-opt:has(#end-has_logo-yes)').click();
  const before = JSON.stringify(db.client_access.filter((a) => a.client_id === D.id));
  const accessAt = checkOf(D, 'p05.access').at;
  await page.click('#end-submit');
  await toastHas(page, 'האפיון הסתיים');
  assert.equal(JSON.stringify(db.client_access.filter((a) => a.client_id === D.id)), before, 'nothing of the client\'s is overwritten');
  assert.match(checkOf(D, 'p04.ended').note, /מהטופס של הלקוח: Facebook: אין רשת, TikTok: לא עובדת/);
  assert.equal(checkOf(D, 'p05.access').at, accessAt, '5 keeps the time of the client\'s submission');
  assert.equal(checkOf(D, 'p05.access').by_email, 'system');
  await ctx.close();
});

await step('"לשנות" lets Ofir set a network the client filled; a later form of the client touches only what it fills', async () => {
  // A client whose form came first, then the meeting.
  const ctx = await newContext(PHONE);
  const page = await newPage(ctx);
  await signIn(page, `intake.html?id=${F.id}#end`, 'ofir@astrateg.test');
  await page.waitForSelector('#end-net-tiktok-got');
  await page.click('#end-net-tiktok-change');
  await page.locator('label.ik-opt:has(#end-net-tiktok-ok)').click();
  await page.fill('#end-net-tiktok-user', 'mia.tt');
  await page.fill('#end-net-tiktok-pass', 'tt-by-ofir');
  // And YouTube, which the client's form did not mention.
  await page.selectOption('#end-more', 'youtube');
  await page.locator('label.ik-opt:has(#end-net-youtube-ok)').click();
  await page.fill('#end-net-youtube-user', 'mia_yt');
  await page.fill('#end-net-youtube-pass', 'yt-by-ofir');
  await page.fill('#end-address', 'הנמל 3, תל אביב');
  await page.fill('#end-phone', '03-5112233');
  await page.locator('label.ik-opt:has(#end-has_logo-no)').click();
  await page.click('#end-submit');
  await toastHas(page, 'האפיון הסתיים');
  const row = (n) => db.client_access.find((a) => a.client_id === F.id && a.network === n);
  assert.deepEqual([row('tiktok').status, row('tiktok').username, row('tiktok').updated_by, secrets.get(row('tiktok').has_secret)], ['ok', 'mia.tt', 'ofir@astrateg.test', 'tt-by-ofir']);
  assert.deepEqual([row('youtube').status, row('youtube').updated_by], ['ok', 'ofir@astrateg.test']);
  assert.deepEqual([row('instagram').status, row('instagram').updated_by], ['missing', CLIENT_BY], 'what he did not touch stays the client\'s');
  await ctx.close();
  // Later the client fills a new link: the three it fills are the client's again; YouTube is not touched.
  const again = makeLink(F.id, 'ofir@astrateg.test');
  const ytBefore = JSON.stringify(row('youtube'));
  const ttId = row('tiktok').id;
  assert.deepEqual(formSubmit(again.token, { entries: [
    { network: 'instagram', label: null, choice: 'none', username: null, password: null },
    { network: 'facebook', label: null, choice: 'none', username: null, password: null },
    { network: 'tiktok', label: null, choice: 'have', username: 'mia.new', password: 'tt-by-client' },
  ], notes: null }), { state: 'done' });
  assert.equal(JSON.stringify(row('youtube')), ytBefore);
  assert.deepEqual([row('tiktok').id, row('tiktok').status, row('tiktok').username, secrets.get(row('tiktok').has_secret)], [ttId, 'new', 'mia.new', 'tt-by-client']);
  assert.ok(![...secrets.values()].includes('tt-by-ofir'), 'the password before it left the vault');
  assert.equal(db.client_access.filter((a) => a.client_id === F.id).length, 4, 'no row is duplicated');
  assert.deepEqual(db.client_access_log.filter((x) => x.client_id === F.id && x.network === 'tiktok').map((x) => `${x.action}:${x.by_email}`),
    [`create:${CLIENT_BY}`, 'update:ofir@astrateg.test', `update:${CLIENT_BY}`], 'the history says who set what, in order');
});

await step('a link still waiting two days later: Irit is reminded quietly, and the nudge with the link is in her queue', async () => {
  const waiting = db.client_access_links.find((l) => l.client_id === E.id && !l.revoked_at && !l.submitted_at);
  const etoken = linkTokens.get(waiting.id);
  // The end of Monday 12.10 (the business day after the link was made), and once more on Wednesday.
  const due = (at, log = []) => computeReminders({ ...world(), now: new Date(at), log }).filter((r) => r.rule === 'accessLink' && r.clientId === E.id);
  assert.deepEqual(due('2026-10-12T17:59:00+03:00'), []);
  const first = due('2026-10-12T18:00:00+03:00');
  assert.deepEqual(first.map((r) => `${r.step}@${r.person}:${r.level}`), ['nudge1@irit:quiet']);
  assert.equal(first[0].title, 'הלקוח עוד לא מילא את פרטי הכניסה: רון נדל״ן · רון כהן');
  assert.ok(!JSON.stringify(first).includes(etoken), 'a reminder never carries the link');
  assert.deepEqual(due('2026-10-14T18:00:00+03:00', first.map((r) => ({ key: r.key }))).map((r) => r.step), ['nudge2']);
  // Tuesday morning in her queue (the welcome itself went out on Sunday).
  db.client_messages.push({ id: randomUUID(), client_id: E.id, kind: 'milestone', template_key: 'welcome', ref: 'welcome', body: 'היי רון כהן, ברוכים הבאים…', sent_by_email: 'irit@astrateg.test', sent_at: '2026-10-11T10:20:00+03:00' });
  NOW = new Date('2026-10-13T09:30:00+03:00');
  const ctx = await newContext();
  const page = await newPage(ctx);
  await signIn(page, 'messages.html', 'irit@astrateg.test');
  await page.waitForSelector(`#msg-text-${E.id}`);
  await page.waitForFunction((id) => document.getElementById(`msg-text-${id}`).value.includes('access.html#t='), E.id);
  const body = await page.inputValue(`#msg-text-${E.id}`);
  assert.match(body, /^היי רון כהן, תזכורת קטנה: כדי שנוכל להתחיל לעבוד על הרשתות שלכם חסרים לנו פרטי הכניסה\./);
  assert.ok(body.includes(`${BASE}access.html#t=${etoken}`));
  assert.match(await text(page, `#msg-${E.id} .msg-why`), /הלקוח עוד לא מילא את פרטי הכניסה לרשתות/);
  await shotOf(page, `#msg-${E.id}`, '14-queue-nudge-desktop');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click(`#msg-send-${E.id}`)]);
  await popup.close();
  await page.waitForFunction(() => document.querySelector('#toast.on')?.textContent.includes('נרשם: נשלחה הודעה'));
  const m = db.client_messages.find((x) => x.client_id === E.id && x.template_key === 'access_nudge');
  assert.deepEqual([m.template_key, m.ref], ['access_nudge', nudgeRef(waiting, 1)]);
  assert.ok(!m.body.includes(etoken));
  await ctx.close();
});

// ── Screenshots: a 375px phone and a desktop, of the client's page ──
await step('the client\'s page on a 375px phone and on a desktop', async () => {
  NOW = new Date('2026-10-13T09:30:00+03:00');
  const l = makeLink(D.id, 'irit@astrateg.test');
  for (const [name, viewport] of [['375', { width: 375, height: 812 }], ['desktop', { width: 1280, height: 900 }]]) {
    const ctx = await newContext(viewport);
    const page = await newPage(ctx);
    await page.goto(`${BASE}access.html#t=${l.token}`);
    await page.waitForSelector('#page:not([hidden])');
    assert.ok(await noHScroll(page), name);
    await shot(page, `20-form-empty-${name}`);
    await page.locator('label.schoice:has(#instagram-choice-have)').click();
    await page.fill('#instagram-username', 'dana_cafe');
    await page.fill('#instagram-password', 'x-שלום-1');
    await page.locator('label.schoice:has(#facebook-choice-none)').click();
    await page.locator('label.schoice:has(#tiktok-choice-reset)').click();
    await page.click('#add');
    await page.selectOption('#x1-platform', 'google');
    await page.focus('#notes');
    await page.fill('#notes', 'קוד האימות מגיע לטלפון של דנה');
    assert.ok(await noHScroll(page), name);
    assert.deepEqual(await smallTargets(page), [], name);
    await shot(page, `21-form-filled-${name}`);
    await page.fill('#x1-username', 'dana@cafe.co.il');
    await page.fill('#x1-password', 'G-1');
    await page.click('#next');
    await page.waitForSelector('#confirm:not([hidden])');
    assert.ok(await noHScroll(page), name);
    await shot(page, `22-confirm-${name}`);
    // A staff member's preview cannot send; here the client is anonymous and the button works.
    assert.equal(await page.locator('#send').isDisabled(), false);
    await ctx.close();
  }
  // The same link as a signed-in staff member sees it: a preview that cannot be sent.
  const ctx = await newContext();
  const page = await newPage(ctx);
  await signIn(page, `client.html?id=${D.id}`, 'irit@astrateg.test');
  await page.goto(`${BASE}access.html#t=${l.token}`);
  await page.reload();
  await page.waitForSelector('#page:not([hidden])');
  assert.ok(await page.locator('#preview').isVisible());
  for (const n of ['instagram', 'facebook', 'tiktok']) await page.locator(`label.schoice:has(#${n}-choice-none)`).click();
  await page.click('#next');
  await page.waitForSelector('#confirm:not([hidden])');
  assert.equal(await page.locator('#send').isDisabled(), true);
  assert.match(await text(page, '#send-err'), /אתם מחוברים כאנשי צוות/);
  await ctx.close();
});

await clientCtx.close();
await iritCtx.close();
await browser.close();
assert.deepEqual(errors, [], errors.join('\n'));
console.log(`access form e2e: ${passed} steps passed`);
