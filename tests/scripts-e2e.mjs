// End-to-end check of "כתיבת תסריטים" (scripts.html, scripts-view.html) against an
// in-memory fake of Supabase that answers as supabase/migrations/20261003120000_scripts.sql
// does, with the browser's clock fixed on Tuesday 13.10.2026 at 11:40 in Israel:
//   - Lior opens the scripts from his task for process 12 in "המשימות שלי": the
//     package's 25 slots, on a 360px phone;
//   - he writes, adds inspiration links, sets statuses; every change saves by itself
//     ("נשמר"), the network drops and comes back (the draft stays on the phone and is
//     saved again), he leaves mid-sentence offline and the draft is restored, and a
//     save from another device is never overwritten silently;
//   - all ready: process 12 is marked from the page; one script and all of them print
//     cleanly;
//   - the share link: created, sent in WhatsApp, made the client's scripts link (the
//     status page's approval), opened by an influencer read-only, revoked;
//   - access: Lior grants Nadia; she writes but cannot approve, and her card links to
//     the page; Ofir (office, no grant) is refused;
//   - the focus summary ("סיכום דגשים לקוח") from the page's header, back beside the writing,
//     and on the editor's card;
//   - the long-writing layout on a desktop.
// Run: npx http-server -p 8096 -s -c-1 . &  then  BASE_URL=http://localhost:8096/ node tests/scripts-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { importKeys } from '../app/client-open.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const NOW = new Date('2026-10-13T11:40:00+03:00'); // Tuesday
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;

// ── People ────────────────────────────────
const people = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', yariv: 'yariv' };
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: person !== 'nadia' && person !== 'yariv', phone: k === 'nadia' ? '0521234567' : null }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
// The owner's row has no person (null); someone not on the staff list: undefined.
const personOf = (u) => { const r = staff.find((x) => x.email === u?.email); return r ? r.person : undefined; };
const isOffice = (u) => { const p = personOf(u); return p === null || ['irit', 'lior', 'ofir', 'ilai'].includes(p); };
const isManager = (u) => { const p = personOf(u); return p === null || p === 'lior'; };

// ── Data ──────────────────────────────────
const client = (id, fields) => ({
  id, name: '', business: null, address: null, phone: null, package_name: null, shoot_type: 'dms', characterizer: 'ofir',
  has_logo: true, editor_name: null, editor: null, deal_at: '2026-10-01T09:00:00+03:00', char_at: null, shoot_at: null,
  contract_end: '2027-10-01', status: 'active', notes: null, quote_id: null, created_at: '2026-10-01T09:00:00+03:00',
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: { videos: 25 }, rounds: [], verified_at: null, verified_by: null, closed_reason: null, protocol_version: 4,
  ...fields,
});
// Characterized Thursday 8.10; the content stage (the scripts were due Monday); Nadia edits it.
const B = client('bbbbbbbb-0000-4000-8000-000000000002', { name: 'קפה גולן', business: 'קפה גולן בע״מ', phone: '052-3334444', notes: 'הערה פנימית של המשרד', address: 'הגליל 5, חיפה', char_at: '2026-10-08T10:00:00+03:00', shoot_at: '2026-10-15T11:00:00+03:00', editor: 'nadia' });
const at = '2026-10-12T09:00:00+03:00';
const imported = (c, station) => importKeys(station).map((k) => ({ client_id: c.id, item_key: k, state: 'done', note: 'ייבוא', by_email: 'irit@astrateg.test', at }));
// Scripts 4–25 were written yesterday (ready); 1–3 are Lior's now.
const seeded = Array.from({ length: 22 }, (_, i) => ({
  client_id: B.id, round: 1, n: i + 4, title: `רעיון ${i + 4}`, body: `סצנה ${i + 4}: סמיון בבית הקפה.`, links: [], status: 'ready', version: 1, by_email: 'lior@astrateg.test', at,
}));
const db = {
  staff,
  clients: [B],
  protocol_checks: [...imported(B, 'content'), { client_id: B.id, item_key: 'p12a.call', state: 'done', note: null, by_email: 'lior@astrateg.test', at }],
  characterizations: [], content_briefs: [], client_tasks: [], client_access: [], client_access_log: [], protocol_log: [], client_status_notes: [], office_reviews: [],
  quotes: [], client_messages: [], message_templates: [], client_questions: [], client_date_changes: [], reminder_log: [], push_subscriptions: [],
  client_scripts: seeded, script_grants: [], script_share_links: [],
};
const shareTokens = new Map(); // token -> link id

const visibleClient = (u, cid) => isOffice(u) || db.clients.some((c) => c.id === cid && c.editor === personOf(u)) || db.client_tasks.some((t) => t.client_id === cid && t.owner === personOf(u));
const canWrite = (u, cid) => !!u && (isManager(u) || db.script_grants.some((g) => g.client_id === cid && g.person === personOf(u)));
const CLIENT_TABLES = new Set(['protocol_checks', 'protocol_log', 'client_tasks', 'characterizations', 'content_briefs', 'client_access', 'client_access_log', 'client_status_notes', 'client_messages', 'client_date_changes']);
const OFFICE_WRITES = new Set(['characterizations', 'content_briefs', 'clients']);
let failScriptWrites = false; // the phone's network drops for the scripts' saves

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
    const keys = order.split(',').map((o) => o.split('.'));
    const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
    out = [...out].sort((a, b) => { for (const [col, dir] of keys) { const c = cmp(a[col], b[col]) * (dir === 'desc' ? -1 : 1); if (c) return c; } return 0; });
  }
  return out;
}
const linksOk = (links) => Array.isArray(links) && links.every((l) => typeof l === 'string' && /^https?:\/\/[^\s"<>]+$/.test(l));
const approvalChange = (old, row) => (row.status === 'approved' && old?.status !== 'approved') || (old?.status === 'approved' && row.status !== 'approved');

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
  const now = NOW.toISOString();
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
  // ── The scripts' functions ──
  if (p === '/rest/v1/rpc/scripts_client') {
    const c = db.clients.find((x) => x.id === body.p_client);
    if (!c || !canWrite(me, c.id)) return json(200, null);
    return json(200, { id: c.id, name: c.name, business: c.business || c.name, status: c.status, shootType: c.shoot_type, charAt: c.char_at, shootAt: c.shoot_at,
      videos: c.deliverables?.videos ?? null, rounds: (c.rounds || []).map((r) => r.n), manage: isManager(me) });
  }
  if (p === '/rest/v1/rpc/can_write_scripts') return json(200, canWrite(me, body.p_client));
  if (p === '/rest/v1/rpc/scripts_grant') {
    if (!me || !isManager(me)) return json(403, { code: '42501', message: 'not allowed' });
    db.script_grants = db.script_grants.filter((g) => !(g.client_id === body.p_client && g.person === body.p_person));
    if (body.p_on !== false) db.script_grants.push({ client_id: body.p_client, person: body.p_person, granted_by: me.email, at: now });
    return json(200, null);
  }
  if (p === '/rest/v1/rpc/scripts_share_create') {
    if (!me || !isManager(me)) return json(403, { code: '42501', message: 'not allowed' });
    for (const l of db.script_share_links) if (l.client_id === body.p_client && !l.revoked_at) { l.revoked_at = now; l.revoked_by = me.email; }
    const token = randomBytes(32).toString('base64url');
    const link = { id: randomUUID(), client_id: body.p_client, created_at: new Date(NOW.getTime() + db.script_share_links.length).toISOString(), created_by: me.email, expires_at: '2027-04-11T09:00:00Z', revoked_at: null, revoked_by: null };
    db.script_share_links.push(link);
    shareTokens.set(token, link.id);
    return json(200, { id: link.id, token, expiresAt: link.expires_at });
  }
  if (p === '/rest/v1/rpc/scripts_share_token') {
    if (!me || !isManager(me)) return json(403, { code: '42501', message: 'not allowed' });
    const l = db.script_share_links.find((x) => x.id === body.p_id && !x.revoked_at);
    return json(200, l ? [...shareTokens].find(([, v]) => v === l.id)?.[0] || null : null);
  }
  if (p === '/rest/v1/rpc/scripts_share_revoke') {
    if (!me || !isManager(me)) return json(403, { code: '42501', message: 'not allowed' });
    const l = db.script_share_links.find((x) => x.id === body.p_id);
    if (l && !l.revoked_at) { l.revoked_at = now; l.revoked_by = me.email; }
    return json(200, null);
  }
  if (p === '/rest/v1/rpc/get_scripts') {
    const l = db.script_share_links.find((x) => x.id === shareTokens.get(body.p_token));
    if (!l) return json(200, { state: 'invalid' });
    if (l.revoked_at) return json(200, { state: 'revoked' });
    const c = db.clients.find((x) => x.id === l.client_id);
    return json(200, {
      state: 'ok', preview: !!me, expiresAt: l.expires_at, client: { name: c.name, business: c.business || c.name },
      scripts: db.client_scripts.filter((s) => s.client_id === c.id && (s.title.trim() || s.body.trim())).sort((a, b) => a.round - b.round || a.n - b.n)
        .map((s) => ({ round: s.round, n: s.n, title: s.title, body: s.body, links: s.links, status: s.status, at: s.at })),
    });
  }
  if (p.startsWith('/rest/v1/rpc/')) return json(200, null);
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${m?.[1]}'` });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' })) : json(200, rows));
  const rls = () => json(403, { code: '42501', message: `new row violates row-level security policy for table "${table}"` });
  const seen = (rows) => {
    if (table === 'clients') return rows.filter((r) => visibleClient(me, r.id));
    if (table === 'client_scripts') return rows.filter((r) => canWrite(me, r.client_id));
    if (table === 'script_grants') return rows.filter((r) => isManager(me) || r.person === personOf(me));
    if (table === 'script_share_links') return isManager(me) ? rows : [];
    return CLIENT_TABLES.has(table) ? rows.filter((r) => visibleClient(me, r.client_id)) : rows;
  };
  if (req.method() === 'GET') {
    const rows = seen(applyFilters(db[table], url.searchParams));
    if (single && !rows.length) return json(406, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' });
    return reply(rows);
  }
  // ── client_scripts: the stamp trigger, the version, "approved" for managers ──
  if (table === 'client_scripts') {
    if (failScriptWrites) return route.abort('internetdisconnected');
    if (req.method() === 'POST') {
      const r = body;
      if (!canWrite(me, r.client_id)) return rls();
      if (!linksOk(r.links)) return json(400, { code: '22023', message: 'invalid inspiration link' });
      if (db.client_scripts.some((x) => x.client_id === r.client_id && x.round === r.round && x.n === r.n)) return json(409, { code: '23505', message: 'duplicate key value violates unique constraint "client_scripts_pkey"' });
      if (approvalChange(null, r) && !isManager(me)) return json(403, { code: '42501', message: 'only Lior or the owner approves a script' });
      const row = { title: '', body: '', links: [], status: 'draft', ...r, version: 1, by_email: me.email, at: now };
      db.client_scripts.push(row);
      return json(201, [row]);
    }
    if (req.method() === 'PATCH') {
      const rows = seen(applyFilters(db.client_scripts, url.searchParams));
      for (const r of rows) {
        if (approvalChange(r, { ...r, ...body }) && !isManager(me)) return json(403, { code: '42501', message: 'only Lior or the owner approves a script' });
        if (body.links && !linksOk(body.links)) return json(400, { code: '22023', message: 'invalid inspiration link' });
      }
      for (const r of rows) Object.assign(r, body, { version: r.version + 1, by_email: me.email, at: now });
      return json(200, rows);
    }
  }
  if (OFFICE_WRITES.has(table) && !isOffice(me)) return rls();
  if (req.method() === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const out = [];
    for (const r of rows) {
      if (CLIENT_TABLES.has(table) && !visibleClient(me, r.client_id)) return rls();
      if (table === 'protocol_checks') {
        const row = { client_id: r.client_id, item_key: r.item_key, state: r.state, note: r.note ?? null, by_email: me.email, at: now };
        const i = db.protocol_checks.findIndex((x) => x.client_id === r.client_id && x.item_key === r.item_key);
        if (i >= 0) db.protocol_checks[i] = row; else db.protocol_checks.push(row);
        db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: r.state, note: r.note ?? null, by_email: me.email, at: now });
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
    for (const r of rows) Object.assign(r, body, table === 'clients' ? { updated_at: now } : {});
    return reply(rows);
  }
  if (req.method() === 'DELETE') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
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
  await ctx.route('https://www.instagram.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>ig</title>' }));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(msg.text())) errors.push(msg.text()); });
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
const shotTop = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` }); };
const toastHas = (page, s) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), s);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const unlabeled = (page) => page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
  .filter((e) => e.offsetParent && !e.closest('.sr-only'))
  .filter((e) => ![...(e.labels || [])].some((l) => l.textContent.trim()) && !e.getAttribute('aria-label')?.trim()
    && !(e.getAttribute('aria-labelledby') || '').split(/\s+/).some((x) => document.getElementById(x)?.textContent.trim()) && !e.title?.trim())
  .map((e) => `${e.tagName}#${e.id}`));
// Visible buttons and links in the writing area smaller than 44px tall.
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} button, ${s} a, ${s} .ik-opt span`)]
  .filter((e) => e.offsetParent && !e.closest('.sr-only'))
  .filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => `${e.tagName}#${e.id}.${e.className}:${e.textContent.trim().slice(0, 20)}`), sel);
const scriptRow = (n) => db.client_scripts.find((s) => s.client_id === B.id && s.round === 1 && s.n === n) || null;
const checkOf = (key) => db.protocol_checks.find((x) => x.client_id === B.id && x.item_key === key) || null;
const savedLine = (page, n) => page.waitForFunction((k) => document.getElementById(`s-${k}-save`)?.classList.contains('is-saved'), n);
let passed = 0;
async function step(name, fn) { await fn(); passed += 1; console.log(`ok ${passed} - ${name}`); }

// ── Lior, on his phone ────────────────────
const liorCtx = await newContext(PHONE);
let lior = await newPage(liorCtx);

await step('"המשימות שלי": Lior\'s task for process 12 opens the scripts page', async () => {
  await signIn(lior, 'clients.html#mine', 'lior@astrateg.test');
  const link = lior.locator(`.wproc:has(a.wclient:text("${B.name}")) a.ik-go:text("כתיבת תסריטים")`).first();
  await link.waitFor();
  assert.match(await link.getAttribute('href'), /^scripts\.html\?id=bbbbbbbb-/);
  await link.click();
  await lior.waitForSelector('#sc-list');
  assert.match(lior.url(), /scripts\.html\?id=bbbbbbbb-0000-4000-8000-000000000002$/);
});

await step('the top: the package\'s 25 scripts, the progress, the focus summary one tap away; a phone fits', async () => {
  assert.equal(await lior.locator('#sc-count').innerText(), '25 תסריטים לפי החבילה (25 סרטונים)');
  assert.equal(await lior.locator('.sc-slot').count(), 25);
  assert.deepEqual(await lior.locator('.sc-slot-h h2').evaluateAll((els) => els.slice(0, 3).map((e) => e.textContent)), ['תסריט 1', 'תסריט 2', 'תסריט 3']);
  assert.equal(await lior.locator('#sc-progress').innerText(), 'מוכנים 22 מתוך 25');
  assert.match(await lior.getAttribute('#sc-focus-form', 'href'), /intake\.html\?id=.*&from=scripts#focus$/);
  assert.ok(await noHScroll(lior));
  assert.deepEqual(await unlabeled(lior), []);
  assert.deepEqual(await smallTargets(lior, '#s-1'), []);
  await shotTop(lior, '01-scripts-top-360');
});

await step('writing: the title and text save by themselves, with a visible "נשמר"', async () => {
  await lior.fill('#s-1-title', 'פתיחה: הקפה של גולן');
  await lior.locator('#s-1-body').pressSequentially('סמיון נכנס לבית הקפה ושואל מה הכי טעים.');
  await savedLine(lior, 1);
  assert.match(await lior.locator('#s-1-save').innerText(), /^נשמר · 11:40$/);
  const row = scriptRow(1);
  assert.equal(row.title, 'פתיחה: הקפה של גולן');
  assert.equal(row.body, 'סמיון נכנס לבית הקפה ושואל מה הכי טעים.');
  assert.equal(row.by_email, 'lior@astrateg.test');
  assert.equal(await lior.locator('#sc-sync').innerText(), 'כל השינויים נשמרו.');
  // The draft on the phone is gone once the database has it.
  assert.equal(await lior.evaluate((k) => localStorage.getItem(k), `astrateg.scripts.${B.id}.1.1`), '');
});

await step('"קישור להשראה": short or several at once, shown as links; something that is not a link is refused', async () => {
  await lior.fill('#s-1-link', 'נסו את זה');
  await lior.click('#s-1-link-add');
  assert.equal(await lior.locator('#s-1-link-err').isVisible(), true);
  assert.equal(await lior.getAttribute('#s-1-link', 'aria-invalid'), 'true');
  await lior.fill('#s-1-link', 'www.instagram.com/reel/golan1 https://www.tiktok.com/@cafe/video/2');
  await lior.press('#s-1-link', 'Enter');
  await lior.waitForSelector('#s-1-linklist a >> nth=1');
  assert.deepEqual(await lior.locator('#s-1-linklist a').evaluateAll((els) => els.map((e) => e.getAttribute('href'))),
    ['https://www.instagram.com/reel/golan1', 'https://www.tiktok.com/@cafe/video/2']);
  assert.equal(await lior.getAttribute('#s-1-linklist a >> nth=0', 'target'), '_blank');
  await savedLine(lior, 1);
  assert.deepEqual(scriptRow(1).links, ['https://www.instagram.com/reel/golan1', 'https://www.tiktok.com/@cafe/video/2']);
  // Removing one.
  await lior.click('#s-1-linklist li:nth-child(2) .sc-unlink');
  await lior.waitForFunction(() => document.querySelectorAll('#s-1-linklist a').length === 1);
  await savedLine(lior, 1);
  assert.deepEqual(scriptRow(1).links, ['https://www.instagram.com/reel/golan1']);
});

await step('status: "מוכן" right away, in the chip, the jump list and the progress', async () => {
  await lior.check('#s-1-status-ready');
  await lior.waitForFunction(() => document.getElementById('s-1-chip').textContent === 'מוכן');
  await savedLine(lior, 1);
  assert.equal(scriptRow(1).status, 'ready');
  assert.equal(await lior.locator('#sc-progress').innerText(), 'מוכנים 23 מתוך 25');
  assert.match(await lior.getAttribute('#j-1', 'class'), /is-ready/);
  await shot(lior, '02-script-saved-360');
});

await step('the network drops: the text stays on the phone, the page says so, and it saves when the network is back', async () => {
  failScriptWrites = true;
  await lior.fill('#s-2-title', 'טעימות');
  await lior.locator('#s-2-body').pressSequentially('מישל טועמת שלוש עוגות.');
  await lior.waitForFunction(() => document.getElementById('s-2-save').classList.contains('is-offline'));
  assert.match(await lior.locator('#sc-sync').innerText(), /אין חיבור\. מה שכתבת נשמר בטלפון/);
  assert.equal(scriptRow(2), null);
  const draft = JSON.parse(await lior.evaluate((k) => localStorage.getItem(k), `astrateg.scripts.${B.id}.1.2`));
  assert.equal(draft.body, 'מישל טועמת שלוש עוגות.');
  await shotTop(lior, '03-offline-360');
  failScriptWrites = false;
  await lior.evaluate(() => window.dispatchEvent(new Event('online')));
  await savedLine(lior, 2);
  assert.equal(scriptRow(2).body, 'מישל טועמת שלוש עוגות.');
  assert.equal(await lior.locator('#sc-sync').innerText(), 'כל השינויים נשמרו.');
});

await step('leaving mid-sentence while offline: the draft comes back and is saved', async () => {
  failScriptWrites = true;
  await lior.locator('#s-3-body').pressSequentially('דניס מגיש קפה הפוך');
  await lior.waitForFunction(() => document.getElementById('s-3-save').classList.contains('is-offline'));
  lior.removeAllListeners('dialog');
  await lior.close({ runBeforeUnload: false });
  failScriptWrites = false;
  lior = await newPage(liorCtx);
  await lior.goto(`${BASE}scripts.html?id=${B.id}`);
  await lior.waitForSelector('#s-3-body');
  assert.equal(await lior.inputValue('#s-3-body'), 'דניס מגיש קפה הפוך');
  await lior.waitForSelector('#s-3 .ik-draft');
  await savedLine(lior, 3);
  assert.equal(scriptRow(3).body, 'דניס מגיש קפה הפוך');
});

await step('another device saved meanwhile: nothing is overwritten without asking', async () => {
  const row = scriptRow(3);
  Object.assign(row, { body: 'דניס מגיש קפה הפוך (מהמחשב)', version: row.version + 1, by_email: 'owner@astrateg.test' });
  await lior.locator('#s-3-body').pressSequentially(' עם עוגה');
  await lior.waitForSelector('#s-3-conflict:not([hidden])');
  assert.match(await lior.locator('#s-3-conflict').innerText(), /התסריט נשמר בינתיים ממקום אחר/);
  assert.equal(scriptRow(3).body, 'דניס מגיש קפה הפוך (מהמחשב)');
  assert.match(await lior.locator('#sc-sync').innerText(), /תסריט אחד לא נשמר/);
  await shot(lior, '04-conflict-360');
  await lior.click('#s-3-keep');
  await savedLine(lior, 3);
  assert.equal(scriptRow(3).body, 'דניס מגיש קפה הפוך עם עוגה');
});

await step('all 25 ready: process 12 is marked from the page', async () => {
  await lior.check('#s-2-status-ready');
  await savedLine(lior, 2);
  assert.equal(await lior.locator('#sc-offer').count(), 0);
  await lior.check('#s-3-status-ready');
  await lior.waitForSelector('#sc-mark12');
  assert.match(await lior.locator('#sc-offer').innerText(), /כל 25 התסריטים מוכנים/);
  await savedLine(lior, 3);
  await lior.click('#sc-mark12');
  await toastHas(lior, 'סומן בתהליך 12');
  assert.equal(checkOf('p12.scripts').state, 'done');
  assert.equal(checkOf('p12.numbered').state, 'done');
  await lior.waitForSelector('#sc-marked');
});

await step('print: one script, and all of them, on a clean page', async () => {
  await lior.evaluate(() => { window.print = () => { window.__printed = document.getElementById('sc-print').innerText; }; });
  await lior.click('#s-1-print');
  const one = await lior.evaluate(() => window.__printed);
  assert.match(one, /קפה גולן בע״מ/);
  assert.match(one, /תסריט 1: פתיחה: הקפה של גולן/);
  assert.match(one, /סמיון נכנס לבית הקפה/);
  assert.match(one, /https:\/\/www\.instagram\.com\/reel\/golan1/);
  assert.ok(!/תסריט 2/.test(one));
  await lior.click('#sc-print-all');
  const all = await lior.evaluate(() => window.__printed);
  assert.equal((all.match(/תסריט \d+/g) || []).length, 25);
  assert.match(all, /תסריטים ליום הצילום · 25/);
  if (OUT) {
    await lior.emulateMedia({ media: 'print' });
    await lior.screenshot({ path: `${OUT}/05-print-all.png`, fullPage: true });
    await lior.emulateMedia({ media: 'screen' });
  }
  await lior.evaluate(() => document.body.classList.remove('is-printing'));
});

let shareLink = null;
await step('the share link: created, copied for WhatsApp, made the client\'s scripts link', async () => {
  await lior.click('a[href="#sc-share"]');
  await lior.click('#sh-create');
  await toastHas(lior, 'נוצר קישור');
  shareLink = await lior.getAttribute('#sh-open', 'href');
  assert.match(shareLink, /\/scripts-view\.html#t=[A-Za-z0-9_-]{43}$/); // after #: it reaches no log of the host (ops.md 36)
  const wa = await lior.getAttribute('#sh-wa', 'href');
  assert.match(wa, /^https:\/\/wa\.me\/\?text=/);
  assert.ok(decodeURIComponent(wa).includes(shareLink));
  assert.ok(decodeURIComponent(wa).includes('קפה גולן בע״מ'));
  await lior.click('#sh-as-client');
  await toastHas(lior, 'נשמר כקישור התסריטים של הלקוח');
  assert.equal(db.clients[0].links.scripts, shareLink);
  assert.equal(checkOf('p12.docs').note, shareLink);
  await lior.waitForSelector('#sh-is-client');
  assert.ok(await noHScroll(lior));
  await shot(lior, '06-share-360');
});

await step('the influencer\'s page: read-only, the scripts with text and their links, nothing internal', async () => {
  const ctx = await newContext(PHONE);
  const page = await newPage(ctx);
  await page.goto(shareLink);
  await page.waitForSelector('#page:not([hidden])');
  assert.equal(await page.locator('#hello-h').innerText(), 'התסריטים ליום הצילום של קפה גולן בע״מ');
  assert.equal(await page.locator('.vscript').count(), 25);
  assert.match(await page.locator('#t-1-1').innerText(), /תסריט 1[\s\S]*פתיחה: הקפה של גולן[\s\S]*סמיון נכנס/);
  assert.equal(await page.getAttribute('#t-1-1 .vlinks a', 'href'), 'https://www.instagram.com/reel/golan1');
  const text = await page.locator('body').innerText();
  for (const secret of ['052-3334444', 'הערה פנימית', '@astrateg.test', 'נדיה']) assert.ok(!text.includes(secret), secret);
  assert.equal(await page.locator('input, textarea').count(), 0, 'read-only');
  assert.equal(await page.locator('#preview').isHidden(), true);
  assert.ok(await noHScroll(page));
  await shot(page, '07-share-page-360');
  // Revoked: the page says so.
  await lior.click('#sh-revoke');
  await toastHas(lior, 'הקישור בוטל');
  await page.reload();
  await page.waitForSelector('#state h1');
  assert.equal(await page.locator('#state h1').innerText(), 'הקישור הזה כבר לא פעיל');
  await ctx.close();
});

await step('access: Lior grants Nadia this client, with a WhatsApp message to her', async () => {
  await lior.click('a[href="#sc-access"]');
  await lior.selectOption('#ac-person', 'nadia');
  await lior.click('#ac-add');
  await toastHas(lior, 'לנדיה יש עכשיו גישה');
  assert.deepEqual(db.script_grants.map((g) => `${g.client_id}:${g.person}`), [`${B.id}:nadia`]);
  const wa = await lior.locator('.sc-grants a').getAttribute('href');
  assert.match(wa, /^https:\/\/wa\.me\/972521234567\?text=/);
  assert.ok(decodeURIComponent(wa).includes(`scripts.html?id=${B.id}`));
  assert.deepEqual(await unlabeled(lior), []);
});

await step('the focus summary from the page\'s header: filled during the Zoom, back beside the writing', async () => {
  await lior.click('#sc-focus-form');
  await lior.waitForSelector('#focus-form');
  assert.match(await lior.locator('#back').innerText(), /לכתיבת התסריטים של קפה גולן/);
  await lior.fill('#focus-summary', 'הלקוח רוצה להדגיש את ארוחות הבוקר ואת החניה החינמית.');
  await lior.click('#focus-save');
  await toastHas(lior, 'נשמר');
  assert.equal(db.content_briefs[0].fields.summary, 'הלקוח רוצה להדגיש את ארוחות הבוקר ואת החניה החינמית.');
  await lior.click('#back');
  await lior.waitForSelector('#sc-focus');
  await lior.click('#sc-focus > summary');
  assert.match(await lior.locator('#sc-focus').innerText(), /סיכום דגשים[\s\S]*ארוחות הבוקר ואת החניה/);
});
await liorCtx.close();

await step('Nadia (granted) writes but does not approve; her client card links to the page', async () => {
  const ctx = await newContext(PHONE);
  const page = await newPage(ctx);
  await signIn(page, `client.html?id=${B.id}`, 'nadia@astrateg.test');
  await page.waitForSelector('#ik-scripts');
  // The focus summary reaches the editor's card too.
  assert.match(await page.locator('#ik-slot').innerText(), /סיכום דגשים[\s\S]*ארוחות הבוקר/);
  await page.click('#ik-scripts');
  await page.waitForSelector('#sc-list');
  assert.equal(await page.locator('#sc-focus-form').count(), 0, 'the focus form is the office\'s');
  assert.equal(await page.locator('#sc-share').count(), 0);
  assert.equal(await page.locator('#sc-access').count(), 0);
  assert.equal(await page.isDisabled('#s-5-status-approved'), true);
  await page.fill('#s-5-title', 'רעיון 5 · גרסה של נדיה');
  await savedLine(page, 5);
  assert.equal(scriptRow(5).by_email, 'nadia@astrateg.test');
  assert.equal(await page.locator('#back').innerText(), '→ המשימות שלי');
  await ctx.close();
});

await step('Ofir (office, no grant) does not see the scripts', async () => {
  const ctx = await newContext(PHONE);
  const page = await newPage(ctx);
  await page.goto(`${BASE}scripts.html?id=${B.id}`);
  await page.fill('#lg-email', 'ofir@astrateg.test');
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForFunction(() => /אין לך גישה לתסריטים/.test(document.getElementById('state').textContent));
  assert.equal(await page.locator('#app').isHidden(), true);
  await ctx.close();
});

await step('desktop: a readable writing column with the focus points beside it', async () => {
  const ctx = await newContext({ width: 1366, height: 900 });
  const page = await newPage(ctx);
  await signIn(page, `scripts.html?id=${B.id}`, 'owner@astrateg.test');
  await page.waitForSelector('#sc-list');
  const main = await page.locator('#sc-main').boundingBox();
  const side = await page.locator('#sc-side').boundingBox();
  assert.ok(main.width <= 770 && main.width >= 600, `writing column ${main.width}`);
  assert.ok(side.x + side.width <= main.x + 1, 'the side panel sits beside the writing (to its left in RTL)');
  assert.equal(await page.locator('#sc-focus').getAttribute('open'), '');
  assert.ok(await noHScroll(page));
  await shotTop(page, '08-desktop');
  await ctx.close();
});

await browser.close();
noCspViolations();
assert.deepEqual(errors, [], 'no page errors');
console.log(`scripts e2e: ${passed} steps passed`);
