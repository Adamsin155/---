// End-to-end check of the content Gantt (gantt.html) against an in-memory fake of
// Supabase. The browser's clock is fixed on Thursday 12.11.2026 at 10:00 in Israel.
//  - Ilai opens the Gantt of a client signed 15.3.2026 for a year: nothing yet, so he
//    creates it from the template; the calendar opens on November 2026 (month 8),
//    with the year at a glance, the legend and the stats.
//  - He marks a video as posted with its link and one of the client's files
//    (public.client_files, the shared contract), drags another video to a new day
//    (kept as "moved by hand"), and adds an entry of his own.
//  - "עדכון מהתבנית" after the package grew: new videos are added, the moved date
//    stays unless that is confirmed.
//  - The client's read-only link: created, opened without signing in, with no
//    internal entry or note; a bad token says so. The print view of a month.
//  - The editor of the client reads only; an editor without the client does not see it.
//  - Links from the client card and from Ilai's process 29 in "המשימות שלי".
//  - A 360px phone: the list by default, the grid with dots, no sideways scrolling.
// Run: npx http-server -p 8080 -s . &  then  node tests/gantt-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { dateIL } from '../app/tz.js';
import { generatePlan } from '../app/gantt-logic.js';
import { importKeys } from '../app/client-open.js';
import { withClientColumns } from './fake-clients.mjs';
import { planSync, parsePosts, windowOf, applyOps } from '../app/metricool-logic.js';
import { listBrands, checkAccount, mayCall } from '../supabase/functions/metricool/sync.js';

const refused = []; // writes the database refused (row level security)

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-11-12T10:00:00+02:00'); // Thursday
const t0 = Date.now();
const serverNow = () => new Date(NOW.getTime() + (Date.now() - t0)).toISOString();
const todayIL = '2026-11-12';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;
const IL = (y, m, d, h = 10, mi = 0) => dateIL(y, m, d, h, mi).toISOString();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ── People ────────────────────────────────
const people = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', anna: 'anna' };
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: false, phone: null }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => staff.find((x) => x.email === u?.email)?.person;
const isOffice = (u) => { const p = personOf(u); return p === null || ['irit', 'lior', 'ofir', 'ilai'].includes(p); };
// public.can_edit_gantt() (20261007100000): Ilai and the owner.
const canEditGantt = (u) => { const p = personOf(u); return p === null || p === 'ilai'; };
const isOwner = (u) => personOf(u) === null;

// ── Clients ───────────────────────────────
const client = (fields) => ({
  id: randomUUID(), name: '', business: null, address: null, phone: '050-0000000', package_name: 'Social + TV all in one · סמיון, מישל ודניס', shoot_type: 'dms', characterizer: 'ofir',
  has_logo: true, editor_name: null, editor: 'nadia', deal_at: IL(2026, 3, 15), char_at: IL(2026, 3, 16), shoot_at: IL(2026, 3, 25),
  contract_end: '2027-03-15', status: 'active', notes: 'הערה של המשרד', quote_id: null, created_at: '2026-09-29T18:00:00Z',
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: { videos: 42, graphics: 42, shoot_days: 2, collabs: 3, stories: 3, ch14: 1, monthly: 0 },
  rounds: [], verified_at: null, verified_by: null, closed_reason: null, protocol_version: 5,
  metricool_blog_id: null, metricool_brand: null,
  ...fields,
});
const A = client({ name: 'רון כהן', business: 'מספרת רון' });
const B = client({ name: 'קפה נדיה', editor: 'yariv' });
// A client that is all done (nothing open for anyone) and one that ended: the index
// lists the first (active, no Gantt yet), never the second.
const C = client({ name: 'דנה לוי', business: 'סטודיו דנה', editor: null, deal_at: IL(2026, 9, 1), contract_end: '2027-09-01', shoot_at: null });
const ENDED = client({ name: 'עסק שהסתיים', status: 'ended' });
const checks = [];
const done = (c, key, at) => checks.push({ client_id: c.id, item_key: key, state: 'done', note: 'ייבוא', by_email: 'irit@astrateg.test', at });
for (const k of importKeys('publish')) done(A, k, IL(2026, 4, 10, 9));

const files = [
  { id: randomUUID(), client_id: A.id, kind: 'deliverable_video', label: 'סרטון 29 · רילס תספורת', storage_path: `${A.id}/v29.mp4`, mime: 'video/mp4', size_bytes: 1000, posted_on: null, link: 'https://www.instagram.com/reel/ron29', uploaded_by: 'ilai@astrateg.test', created_at: '2026-11-01T10:00:00Z', deleted_at: null },
  { id: randomUUID(), client_id: A.id, kind: 'deliverable_graphic', label: 'גרפיקה מבצע חורף', storage_path: `${A.id}/g1.png`, mime: 'image/png', size_bytes: 1000, posted_on: null, link: null, uploaded_by: 'ilai@astrateg.test', created_at: '2026-11-01T10:00:00Z', deleted_at: null },
  // Uploaded without a label: named by its file name, not just "קובץ" (found live, 6.10.2026).
  { id: randomUUID(), client_id: A.id, kind: 'deliverable_video', label: null, storage_path: `${A.id}/deliverable_video/3f2b8c1e-7a41-4d2c-9b1f-0a1b2c3d4e5f-Reel-Final.mp4`, mime: 'video/mp4', size_bytes: 1000, posted_on: null, link: null, uploaded_by: 'ilai@astrateg.test', created_at: '2026-11-02T10:00:00Z', deleted_at: null },
  { id: randomUUID(), client_id: A.id, kind: 'logo', label: 'לוגו', storage_path: `${A.id}/logo.png`, mime: 'image/png', size_bytes: 1, posted_on: null, link: null, uploaded_by: 'irit@astrateg.test', created_at: '2026-03-20T10:00:00Z', deleted_at: null },
];

const db = {
  staff,
  clients: [A, B, C, ENDED],
  client_gantt_sync: [],
  protocol_checks: checks,
  protocol_log: [],
  client_tasks: [],
  office_reviews: [],
  client_status_notes: [],
  client_messages: [],
  client_access: [],
  client_access_log: [],
  client_date_changes: [],
  client_questions: [],
  client_month_marks: [],
  client_gantt: [],
  client_gantt_links: [],
  client_files: files,
};
const tokens = new Map(); // token -> link id
// Metricool, as the database and the edge function answer (20261007100100; nothing here
// ever leaves the machine): the switch, the two secrets as "present", the account's brands.
const metricool = { enabled: false, secrets: { user_token: true, user_id: true }, calls: [] };
const BRANDS = [
  { id: 101, label: 'מספרת רון', instagram: 'ron_hair', facebook: 'ron', ownerUsername: 'office@astrateg.test' },
  { id: 102, label: 'Cafe Nadia', tiktok: 'cafenadia', ownerUsername: 'office@astrateg.test' },
  { id: 105, label: 'סטודיו דנה', instagram: 'dana' },
];
const mcSettings = (u) => {
  const mapped = db.clients.filter((c) => c.metricool_blog_id && c.status === 'active');
  const syncs = db.client_gantt_sync.filter((s) => mapped.some((c) => c.id === s.client_id));
  return {
    enabled: metricool.enabled, owner: isOwner(u), canEdit: canEditGantt(u), secrets: metricool.secrets, mapped: mapped.length,
    synced: syncs.filter((s) => s.ok).length, failed: syncs.filter((s) => !s.ok).length,
    lastAt: syncs.map((s) => s.at).sort().at(-1) || null, lastError: syncs.filter((s) => !s.ok).at(-1)?.error || null,
  };
};
// One sync of a client, as the edge function does it (app/metricool-logic.js decides;
// public.gantt_sync_apply writes): `listing` is what Metricool would answer.
function syncClient(c, listing, now = serverNow()) {
  const mine = db.client_gantt.filter((r) => r.client_id === c.id);
  const plan = planSync({ rows: mine, posts: parsePosts(listing).posts, window: windowOf(new Date(now)), complete: true });
  const touched = new Set(plan.update.map((u) => u.id));
  const next = applyOps(mine, plan, { newId: () => randomUUID() })
    .map((r) => ({ client_id: c.id, template_version: 1, ...r, ...(touched.has(r.id) || !r.by_email ? { by_email: 'system', at: now } : {}) }));
  db.client_gantt = [...db.client_gantt.filter((r) => r.client_id !== c.id), ...next];
  db.client_gantt_sync = [...db.client_gantt_sync.filter((s) => s.client_id !== c.id), { client_id: c.id, at: now, ok: true, error: null, stats: plan.stats }];
  return plan;
}

// ── Fake PostgREST ─────────────────────────
const unq = (s) => s.replace(/^"(.*)"$/, '$1');
function match(r, k, v) {
  if (v.startsWith('eq.')) return String(r[k]) === unq(v.slice(3));
  if (v.startsWith('neq.')) return String(r[k]) !== unq(v.slice(4));
  if (v.startsWith('gte.')) return String(r[k] ?? '') >= unq(v.slice(4));
  if (v.startsWith('lte.')) return String(r[k] ?? '') <= unq(v.slice(4));
  if (v.startsWith('in.(')) return new Set(v.slice(4, -1).split(',').map(unq)).has(String(r[k]));
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
  return true;
}
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    out = out.filter((r) => match(r, k, v));
  }
  return out;
}
const sees = (u, clientId) => isOffice(u) || db.clients.some((c) => c.id === clientId && c.editor === personOf(u));
// The database's rules for a Gantt row (client_gantt_rules, protocol_stamp).
function ganttRow(row, me, now, old = null) {
  const r = { state: 'planned', posted_on: null, file_id: null, link: null, note: null, edited: false, internal: false, num: null, month: null, time_il: null, template_version: 1, ...row };
  r.internal = !!r.internal || ['plan', 'renewal'].includes(r.kind);
  r.posted_on = r.state === 'posted' ? r.posted_on || todayIL : null;
  // A person's write: the state they change is theirs ('manual'); the sync's columns are not theirs to set.
  const mc = old || { mc_post_id: null, mc_status: null, mc_at: null, mc_networks: null, mc_error: null, mc_extra: false };
  r.source = old && old.state === r.state ? old.source || 'manual' : 'manual';
  for (const k of ['mc_post_id', 'mc_status', 'mc_at', 'mc_networks', 'mc_error', 'mc_extra']) r[k] = mc[k] ?? (k === 'mc_extra' ? false : null);
  if (r.time_il && r.time_il.length === 5) r.time_il = `${r.time_il}:00`;
  r.by_email = me.email;
  r.at = now;
  return r;
}
const CLIENT_SHAPE = { clients: () => db.clients, staff: () => db.staff };
async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const headers = req.headers();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: cors });
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
  // Storage: a signed link to a file of a client one sees, and the file itself.
  if (p.startsWith('/storage/v1/object/sign/client-files/')) {
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: cors });
    const path = decodeURIComponent(p.slice('/storage/v1/object/sign/client-files/'.length));
    const f = files.find((x) => x.storage_path === path);
    if (!me || !f || !sees(me, f.client_id)) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    return json(200, { signedURL: `/object/sign/client-files/${encodeURIComponent(path)}?token=t` });
  }
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
  // Metricool: the settings (the office), the brand of a client (Ilai and the owner), the switch (the owner).
  if (p === '/rest/v1/rpc/metricool_settings') return json(200, me && isOffice(me) ? mcSettings(me) : null);
  if (p === '/rest/v1/rpc/metricool_set_enabled') {
    if (!me || !isOwner(me)) return json(403, { code: '42501', message: 'not allowed: owner only' });
    if (body.p_on && !(metricool.secrets.user_token && metricool.secrets.user_id)) return json(400, { code: 'P0001', message: 'not_ready: Metricool secrets are missing in Vault' });
    metricool.enabled = !!body.p_on;
    return json(200, mcSettings(me));
  }
  if (p === '/rest/v1/rpc/gantt_set_brand') {
    if (!me || !canEditGantt(me)) return json(403, { code: '42501', message: 'not allowed' });
    const c = db.clients.find((x) => x.id === body.p_client);
    if (body.p_blog_id && db.clients.some((x) => x.metricool_blog_id === body.p_blog_id && x.id !== c.id)) return json(400, { code: 'P0001', message: 'brand_taken: this brand is connected to another client' });
    if ((c.metricool_blog_id || null) !== (body.p_blog_id || null)) {
      db.client_gantt = db.client_gantt.filter((r) => !(r.client_id === c.id && r.mc_extra && r.source === 'metricool'))
        .map((r) => (r.client_id !== c.id ? r : { ...r, state: r.source === 'metricool' && ['scheduled', 'error'].includes(r.state) ? 'planned' : r.state, mc_post_id: null, mc_status: null, mc_at: null, mc_networks: null, mc_error: null }));
      db.client_gantt_sync = db.client_gantt_sync.filter((s) => s.client_id !== c.id);
    }
    c.metricool_blog_id = body.p_blog_id || null;
    c.metricool_brand = body.p_blog_id ? body.p_brand || null : null;
    return json(200, { blogId: c.metricool_blog_id, brand: c.metricool_brand });
  }
  // "ללקוח אין מותג" (section 33): Ilai and the owner mark it and undo it.
  if (p === '/rest/v1/rpc/metricool_set_none') {
    if (!canEditGantt(me)) return json(403, { code: '42501', message: 'not allowed' });
    const c = db.clients.find((x) => x.id === body.p_client);
    if (!c) return json(400, { code: '22023', message: 'client not found' });
    c.metricool_none = !!body.p_on;
    return json(200, { none: c.metricool_none });
  }
  // The edge function `metricool` (supabase/functions/metricool/sync.js runs here against a faked Metricool).
  if (p === '/functions/v1/metricool') {
    metricool.calls.push({ action: body.action, by: me?.email || null });
    if (!me) return json(401, { error: 'not_signed_in' });
    if (!mayCall(body.action, staff.find((x) => x.email === me.email))) return json(403, { error: 'not_allowed' });
    const fetchMc = async () => (metricool.down ? { status: 429, json: async () => ({}) } : { status: 200, json: async () => BRANDS });
    const config = { enabled: metricool.enabled, user_token: 'TOKEN-0123456789-never-in-the-page', user_id: '4455' };
    const res = body.action === 'check' ? await checkAccount({ fetch: fetchMc, config }) : await listBrands({ fetch: fetchMc, config });
    return json(res.status, res.body);
  }
  if (p === '/rest/v1/rpc/gantt_link_create') {
    if (!me || !isOffice(me)) return json(403, { code: '42501', message: 'not allowed' });
    for (const l of db.client_gantt_links) if (l.client_id === body.p_client && !l.revoked_at) { l.revoked_at = now; l.revoked_by = me.email; }
    const token = randomBytes(32).toString('base64url');
    const link = { id: randomUUID(), client_id: body.p_client, created_at: now, created_by: me.email, expires_at: new Date(Date.parse(now) + 400 * 864e5).toISOString(), revoked_at: null, revoked_by: null };
    db.client_gantt_links.push(link);
    tokens.set(token, link.id);
    return json(200, { id: link.id, token, expiresAt: link.expires_at });
  }
  if (p === '/rest/v1/rpc/gantt_link_token') {
    if (!me || !isOffice(me)) return json(403, { code: '42501', message: 'not allowed' });
    const l = db.client_gantt_links.find((x) => x.id === body.p_id && !x.revoked_at);
    return json(200, l ? [...tokens].find(([, id]) => id === l.id)?.[0] || null : null);
  }
  if (p === '/rest/v1/rpc/gantt_link_revoke') {
    if (!me || !isOffice(me)) return json(403, { code: '42501', message: 'not allowed' });
    const l = db.client_gantt_links.find((x) => x.id === body.p_id);
    if (l) { l.revoked_at = now; l.revoked_by = me.email; }
    return json(200, null);
  }
  if (p === '/rest/v1/rpc/get_gantt') {
    // As public.get_gantt: no internal entry, no note, no file path.
    const id = tokens.get(body.p_token);
    const l = db.client_gantt_links.find((x) => x.id === id);
    if (!l) return json(200, { state: 'invalid' });
    if (l.revoked_at) return json(200, { state: 'revoked' });
    const c = db.clients.find((x) => x.id === l.client_id);
    const fileOf = (fid) => files.find((f) => f.id === fid && f.client_id === c.id);
    const entries = db.client_gantt.filter((g) => g.client_id === c.id && !g.internal && !['plan', 'renewal'].includes(g.kind))
      .sort((a, b) => `${a.day}${a.time_il || '99'}${a.key}`.localeCompare(`${b.day}${b.time_il || '99'}${b.key}`))
      .map((g) => {
        // As the function: a failure reads as planned, a scheduled post whose time has passed as posted.
        const past = `${g.day}T${(g.time_il || '12:00').slice(0, 5)}` <= `${todayIL}T10:00`;
        const shown = g.state === 'error' ? 'planned' : g.state === 'scheduled' && past ? 'posted' : g.state;
        return { key: g.key, kind: g.kind, title: g.title, day: g.day, time: g.time_il ? g.time_il.slice(0, 5) : null, num: g.num, state: shown, postedOn: shown === 'posted' ? g.posted_on || g.day : null, link: g.link || fileOf(g.file_id)?.link || null };
      });
    return json(200, { state: 'ok', preview: !!me, expiresAt: l.expires_at, client: { business: c.business || c.name, dealAt: c.deal_at, contractEnd: c.contract_end }, entries });
  }
  if (p.startsWith('/rest/v1/rpc/')) return json(404, { code: 'PGRST202', message: 'not found' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { code: '42P01', message: 'relation does not exist' });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  const denied = () => json(403, { code: '42501', message: `new row violates row-level security policy for table "${table}"` });
  if (req.method() === 'GET') {
    let rows = applyFilters(db[table], url.searchParams);
    if (['client_gantt', 'client_files', 'client_gantt_sync'].includes(table)) rows = rows.filter((r) => sees(me, r.client_id));
    if (table === 'client_gantt_links' && !isOffice(me)) rows = [];
    if (table === 'clients') rows = rows.filter((r) => sees(me, r.id));
    if (table === 'client_gantt') rows = [...rows].sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    return reply(rows.slice(off, off + lim));
  }
  // Row level security: only Ilai and the owner write the Gantt; nobody writes the sync's line.
  if (table === 'client_gantt' && !canEditGantt(me)) { refused.push(`${req.method()} ${me.email}`); return req.method() === 'DELETE' || req.method() === 'PATCH' ? reply([]) : denied(); }
  if (table === 'client_gantt_sync') return denied();
  if (req.method() === 'POST') {
    const out = [];
    for (const r of Array.isArray(body) ? body : [body]) {
      if (table === 'client_gantt') {
        const i = db.client_gantt.findIndex((x) => x.client_id === r.client_id && x.key === r.key);
        if (i >= 0 && !url.searchParams.has('on_conflict')) return json(409, { code: '23505', message: 'duplicate key' });
        const row = ganttRow(i >= 0 ? { ...db.client_gantt[i], ...r } : { id: randomUUID(), created_at: now, ...r }, me, now, i >= 0 ? db.client_gantt[i] : null);
        if (i >= 0) db.client_gantt[i] = row; else db.client_gantt.push(row);
        out.push(row);
      } else {
        const row = { ...r, by_email: me.email, at: now };
        db[table].push(row);
        out.push(row);
      }
    }
    return reply(out);
  }
  if (req.method() === 'DELETE') {
    const rows = applyFilters(db[table], url.searchParams);
    db[table] = db[table].filter((r) => !rows.includes(r));
    return route.fulfill({ status: 204, headers: cors });
  }
  if (req.method() === 'PATCH') {
    const rows = applyFilters(db[table], url.searchParams);
    const out = [];
    for (const r of rows) {
      const row = table === 'client_gantt' ? ganttRow({ ...r, ...body }, me, now, r) : Object.assign(r, body);
      if (table === 'client_gantt') db.client_gantt[db.client_gantt.indexOf(r)] = row;
      out.push(row);
    }
    return reply(out);
  }
  return json(405, { message: `unexpected ${req.method()} on ${table}` });
}

// ── Browser ────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newContext(viewport = { width: 1360, height: 960 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time: NOW });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msgx) => { if (msgx.type() === 'error' && !/Failed to load resource/.test(msgx.text())) errors.push(msgx.text()); });
  page.on('dialog', (d) => d.accept());
  open.add(page);
  page.on('close', () => open.delete(page));
  return page;
}
async function signIn(page, path, email) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
}
const shot = async (page, name, fullPage = true) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const toastHas = (page, t) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), t);
const hideToast = (page) => page.evaluate(() => document.getElementById('toast').classList.remove('on'));
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} button, ${s} a.btn, ${s} summary`)]
  .filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden').map((el) => [el.textContent.trim().slice(0, 30), Math.round(el.getBoundingClientRect().height)])
  .filter(([, hgt]) => hgt < 44), sel);
let passed = 0;
const open = new Set();
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    // A failure leaves a picture of every page still open, when there is an out dir.
    if (OUT) for (const [i, pg] of [...open].entries()) await pg.screenshot({ path: `${OUT}/failed-${i}.png`, fullPage: true }).catch(() => {});
    console.log(`not ok - ${name}\n# toast: ${await [...open].at(-1)?.evaluate(() => document.getElementById('toast')?.textContent).catch(() => '')}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}
const gantt = (c) => db.client_gantt.filter((r) => r.client_id === c.id);
const row = (c, key) => gantt(c).find((r) => r.key === key);

// The plan the template makes for Ron, to pick entries the steps use.
const plan = generatePlan(A).entries;
const novVideos = plan.filter((e) => e.kind === 'video' && e.day.startsWith('2026-11'));
const perDay = (d) => plan.filter((e) => e.day === d).length;
const posted = novVideos.find((e) => e.day < todayIL && perDay(e.day) <= 3);
const moved = novVideos.find((e) => e.day > todayIL && perDay(e.day) <= 3);
const target = '2026-11-26';
assert.ok(posted && moved, 'November has videos before and after the 12th');

// ── Ilai ──────────────────────────────────
const ictx = await newContext();
const ilai = await newPage(ictx);

await step('Ilai: no Gantt yet; the template\'s preview; he creates it, and it opens on November 2026 (month 8)', async () => {
  await signIn(ilai, `gantt.html?id=${A.id}`, 'ilai@astrateg.test');
  await ilai.waitForSelector('#gt-empty:not([hidden])');
  assert.match(await ilai.innerText('#ge-text'), new RegExp(`התבנית תיצור ${plan.length} פריטים, מהם \\d+ פרסומים, מ־25\\.3\\.2026 עד 15\\.3\\.2027`));
  assert.match(await ilai.innerText('#gt-sub'), /חוזה מ־15\.3\.2026 עד 15\.3\.2027 · חודש 8 מתוך 12/);
  await shot(ilai, 'gantt-01-empty');
  await ilai.click('#btn-create');
  await toastHas(ilai, `הגאנט נוצר: ${plan.length} פריטים`);
  assert.equal(gantt(A).length, plan.length);
  assert.equal(gantt(A).every((r) => r.by_email === 'ilai@astrateg.test' && r.edited === false), true);
  assert.equal(row(A, 'plan.9').internal, true);
  await ilai.waitForSelector('#gt-cal:not([hidden]) .gt-grid');
  assert.equal(await ilai.innerText('#gm-h'), 'נובמבר 2026');
  assert.equal(await ilai.innerText('#gm-pkg'), 'חודשים 8–9 בחבילה');
  assert.equal(await ilai.locator('#gm-pills .gt-pill').count(), 13);
  assert.equal(await ilai.locator('td.is-today').getAttribute('data-day'), todayIL);
  // The grid: Ron's November, the start of package month 9 on the 15th.
  assert.match(await ilai.innerText('td[data-day="2026-11-15"] .gt-pm'), /חודש 9/);
  const novCount = plan.filter((e) => e.day.startsWith('2026-11')).length;
  const chips = await ilai.locator('#gm-grid .gt-chip').count();
  const more = await ilai.locator('#gm-grid .gt-more').count();
  assert.ok(chips >= novCount - more * 3 && chips <= novCount, `${chips} chips of ${novCount}`);
  // Glance: a row per kind, 12 months, the current one marked.
  assert.equal(await ilai.locator('#gg-table thead th').count(), 13);
  assert.equal(await ilai.locator('#gg-table thead th.is-now').innerText(), '8\nאוק׳'); // month 8 starts 15.10
  assert.match(await ilai.innerText('#gg-table tbody'), /סרטונים[^]*גרפיקות/);
  // Stats: the posts of the year, none up or scheduled yet; everything whose time has
  // passed is "חסר" (the alert colour, since there are some). The old "עברו ולא סומנו" is gone.
  assert.match(await ilai.innerText('.st-posts'), /פרסומים בשנה\s*\d+/);
  assert.match(await ilai.innerText('.st-sched'), /תוזמנו\s*0/);
  assert.match(await ilai.innerText('.st-missing.is-missing'), /חסרים\s*[1-9]\d*/);
  assert.doesNotMatch(await ilai.innerText('#app'), /עברו ולא סומנו|עוד לא סומן/);
  assert.match(await ilai.innerText('#gt-legend'), /סרטון[^]*גרפיקה[^]*תוזמן[^]*עלה[^]*חסר/);
  // A chip of a missing post carries "!", one that is still ahead nothing.
  assert.equal(await ilai.locator(`#gm-grid .gt-chip.s-missing[data-key="${posted.key}"] .gt-warn`).count(), 1);
  assert.equal(await ilai.locator(`#gm-grid .gt-chip.s-planned[data-key="${moved.key}"] .gt-warn, #gm-grid .gt-chip[data-key="${moved.key}"] .gt-tick`).count(), 0);
  // One pink action on the screen: "סימון כתוזמנו".
  assert.deepEqual(await ilai.locator('#app .btn-primary:visible').allInnerTexts(), ['סימון כתוזמנו']);
  await shot(ilai, 'gantt-02-month');
});

await step('one tap on a state moves it on (planned → scheduled → posted → planned), with an undo; a scheduled post ahead shows a clock', async () => {
  await ilai.click('#view-list');
  await ilai.waitForSelector('#gm-list:not([hidden]) .gt-aday');
  const btn = (key) => ilai.locator(`#gm-list .gt-state-btn[data-key="${key}"]`);
  // A post still ahead: planned → "תוזמן" (a clock), kept as a manual mark.
  assert.match(await btn(moved.key).innerText(), /מתוכנן/);
  await btn(moved.key).click();
  await toastHas(ilai, `סומן שתוזמן: ${moved.title}`);
  assert.deepEqual([row(A, moved.key).state, row(A, moved.key).source], ['scheduled', 'manual']);
  assert.match(await btn(moved.key).innerText(), /תוזמן/);
  assert.equal(await btn(moved.key).locator('.gt-clock').count(), 1);
  assert.match(await ilai.innerText('.st-sched'), /תוזמנו\s*1/);
  // Undo puts it back.
  await ilai.click('#toast .toast-act');
  await toastHas(ilai, 'חזר ל״מתוכנן״');
  assert.equal(row(A, moved.key).state, 'planned');
  // A post whose time has passed: "חסר" → scheduled (it went up by itself, so it reads "עלה") → posted → planned.
  const missingBefore = Number((await ilai.innerText('.st-missing .gt-stat-v')).trim());
  assert.match(await btn(posted.key).innerText(), /חסר/);
  await btn(posted.key).click();
  await toastHas(ilai, `סומן שתוזמן: ${posted.title}`);
  assert.equal(row(A, posted.key).state, 'scheduled');          // the stored fact: it was scheduled
  assert.match(await btn(posted.key).innerText(), /עלה/);        // shown: its time has passed, so it is up
  assert.equal(Number((await ilai.innerText('.st-missing .gt-stat-v')).trim()), missingBefore - 1);
  assert.match(await ilai.innerText('.st-up'), /עלו\s*1/);
  await btn(posted.key).click();
  await toastHas(ilai, `סומן שעלה: ${posted.title}`);
  assert.equal(row(A, posted.key).state, 'posted');
  await btn(posted.key).click();
  await toastHas(ilai, `חזר ל״מתוכנן״: ${posted.title}`);
  assert.equal(row(A, posted.key).state, 'planned');
  assert.equal(await ilai.evaluate(() => document.activeElement?.classList.contains('gt-state-btn')), true, 'focus stays on the state');
  await hideToast(ilai);
  await ilai.click('#view-grid');
});

await step('"סימון כתוזמנו" for the chosen day, its week or the whole month: only what is still planned, with an undo', async () => {
  const nov = plan.filter((e) => e.day.startsWith('2026-11') && ['video', 'graphic', 'story', 'collab', 'highlight', 'monthly'].includes(e.kind));
  const dayPick = nov.find((e) => e.day > todayIL).day;
  const inDay = nov.filter((e) => e.day === dayPick).length;
  await ilai.click(`td[data-day="${dayPick}"] .gt-daynum`);
  await ilai.waitForSelector('#gm-day:not([hidden])');
  await ilai.click('#btn-bulk');
  await ilai.waitForSelector('#bulk-dlg[open]');
  const text = await ilai.innerText('#bk-body');
  assert.match(text, /היום שנבחר/);
  assert.match(await ilai.innerText('#bk-day'), new RegExp(inDay === 1 ? 'פרסום אחד' : `${inDay} פרסומים`));
  assert.match(await ilai.innerText('#bk-month'), new RegExp(`כל נובמבר 2026\\s*${nov.length} פרסומים`));
  await shot(ilai, 'gantt-02b-bulk', false);
  await ilai.click('#bk-day');
  await toastHas(ilai, inDay === 1 ? 'פרסום אחד סומן ״תוזמן״' : `${inDay} פרסומים סומנו ״תוזמן״`);
  assert.equal(gantt(A).filter((r) => r.state === 'scheduled').length, inDay);
  assert.equal(gantt(A).filter((r) => r.state === 'scheduled').every((r) => r.day === dayPick && r.source === 'manual'), true);
  // The whole month: the rest of November; the day already scheduled is not counted again.
  await ilai.click('#btn-bulk');
  await ilai.waitForSelector('#bulk-dlg[open]');
  assert.match(await ilai.innerText('#bk-month'), new RegExp(`${nov.length - inDay} פרסומים`));
  assert.equal(await ilai.locator('#bk-day').isDisabled(), true);
  await ilai.click('#bk-month');
  await toastHas(ilai, `${nov.length - inDay} פרסומים סומנו ״תוזמן״`);
  assert.equal(gantt(A).filter((r) => r.state === 'scheduled').length, nov.length);
  // Scheduled and past: up. Nothing of November is missing now, and nothing else was touched.
  assert.equal(gantt(A).filter((r) => r.state !== 'planned' && !r.day.startsWith('2026-11')).length, 0);
  assert.equal(gantt(A).filter((r) => ['report', 'plan', 'shoot'].includes(r.kind) && r.state !== 'planned').length, 0);
  await ilai.waitForSelector(`#gm-grid .gt-chip.s-posted[data-key="${posted.key}"] .gt-tick`);
  await ilai.waitForSelector(`#gm-grid .gt-chip.s-scheduled[data-key="${moved.key}"] .gt-clock`);
  // The year at a glance: the month's bar is hatched for what is scheduled.
  assert.ok(await ilai.locator('#gg-table .gg-sched').count() > 0);
  await shot(ilai, 'gantt-02c-scheduled');
  // Undo: the month's marks go back, the day's stay.
  await ilai.click('#toast .toast-act');
  await toastHas(ilai, 'חזרו ל״מתוכנן״');
  assert.equal(gantt(A).filter((r) => r.state === 'scheduled').length, inDay);
  // Back to a clean month for the next steps.
  for (const r of gantt(A)) { r.state = 'planned'; r.posted_on = null; }
  await ilai.reload();
  await ilai.waitForSelector('#gt-cal:not([hidden]) .gt-grid');
});

await step('he marks a video as posted, with its link and the client\'s file; it shows a tick', async () => {
  await ilai.click(`#gm-grid .gt-chip[data-key="${posted.key}"]`);
  await ilai.waitForSelector('#entry-dlg[open]');
  assert.equal(await ilai.innerText('#ed-h'), posted.title);
  // The files offered fit a video: not the logo, not the graphic.
  const options = await ilai.locator('#ed-file option').allInnerTexts();
  assert.deepEqual([options[0], ...options.slice(1).sort()], ['בלי קובץ', 'Reel-Final.mp4', 'סרטון 29 · רילס תספורת']);
  assert.ok(!options.includes('קובץ'));
  await ilai.locator('label.gt-seg-opt:has(input[value="posted"])').click();
  await ilai.fill('#ed-posted', posted.day);
  await ilai.selectOption('#ed-file', files[0].id);
  await ilai.fill('#ed-link', 'http://not-secure.example');
  await ilai.click('#ed-save');
  assert.match(await ilai.innerText('#ed-err'), /https/);
  await ilai.fill('#ed-link', '');
  await ilai.fill('#ed-note', 'עלה עם שיר טרנדי');
  await shot(ilai, 'gantt-03-dialog', false);
  await ilai.click('#ed-save');
  await toastHas(ilai, `סומן שעלה: ${posted.title}`);
  const r = row(A, posted.key);
  assert.deepEqual([r.state, r.posted_on, r.file_id, r.link, r.note, r.edited], ['posted', posted.day, files[0].id, null, 'עלה עם שיר טרנדי', false]);
  await ilai.waitForSelector(`#gm-grid .gt-chip.s-posted[data-key="${posted.key}"] .gt-tick`);
  assert.match(await ilai.innerText('.st-up'), /עלו\s*1/);
});

// Both days on screen first: a drag that has to scroll is dropped by the browser.
const bothInView = (page) => page.evaluate(() => document.querySelector('td[data-day="2026-11-22"]').scrollIntoView({ block: 'center' }));
await step('he drags another video to the 26th: the same time, that day, kept as moved by hand (with an undo)', async () => {
  await hideToast(ilai); // the last toast sits over the grid
  await bothInView(ilai);
  await ilai.dragAndDrop(`#gm-grid .gt-chip[data-key="${moved.key}"]`, `td[data-day="${target}"]`);
  await toastHas(ilai, `${moved.title} הוזז ל`);
  let r = row(A, moved.key);
  assert.deepEqual([r.day, r.time_il, r.edited], [target, '19:00:00', true]);
  await ilai.waitForSelector(`td[data-day="${target}"] .gt-chip[data-key="${moved.key}"]`);
  await ilai.click('#toast .toast-act');
  await toastHas(ilai, 'ההזזה בוטלה');
  r = row(A, moved.key);
  assert.deepEqual([r.day, r.edited], [moved.day, false]);
  await bothInView(ilai);
  await ilai.dragAndDrop(`#gm-grid .gt-chip[data-key="${moved.key}"]`, `td[data-day="${target}"]`);
  await toastHas(ilai, `${moved.title} הוזז ל`);
  assert.equal(row(A, moved.key).day, target);
});

await step('he adds an entry of his own from a day: a custom key, moved by hand', async () => {
  await ilai.click('td[data-day="2026-11-24"] .gt-daynum');
  await ilai.waitForSelector('#gm-day:not([hidden])');
  await ilai.click('#gm-day button:has-text("הוספת פריט ביום הזה")');
  await ilai.waitForSelector('#entry-dlg[open]');
  assert.equal(await ilai.inputValue('#ed-day'), '2026-11-24');
  assert.doesNotMatch(await ilai.innerText('#entry-dlg'), /\bnull\b|undefined/);
  await ilai.selectOption('#ed-kindsel', 'graphic');
  await ilai.fill('#ed-title', 'גרפיקת בלאק פריידיי');
  await ilai.fill('#ed-time', '11:30');
  await ilai.click('#ed-save');
  await toastHas(ilai, 'נוסף: גרפיקת בלאק פריידיי');
  const r = gantt(A).find((x) => x.title === 'גרפיקת בלאק פריידיי');
  assert.match(r.key, /^custom\.\d+$/);
  assert.deepEqual([r.kind, r.day, r.time_il, r.edited, r.month], ['graphic', '2026-11-24', '11:30:00', true, 9]);
  await ilai.waitForSelector('#gm-day .gt-row:has-text("גרפיקת בלאק פריידיי")');
});

await step('"עדכון מהתבנית" after the package grew: 2 more videos, the moved date kept; confirmed, it goes back', async () => {
  A.deliverables = { ...A.deliverables, videos: 44 };
  await ilai.reload();
  await ilai.waitForSelector('#btn-regen');
  await ilai.click('#btn-regen');
  await ilai.waitForSelector('#regen-dlg[open]');
  const text = await ilai.innerText('#rg-body');
  assert.match(text, /יתווספו 2 פריטים/);
  assert.match(text, /פריט אחד הוזז ידנית, והוא|פריט אחד הוזז ידנית/);
  assert.match(text, /מה שעלה, קישורים, קבצים והערות לא משתנים/);
  await shot(ilai, 'gantt-04-regen', false);
  await ilai.click('#rg-go');
  await toastHas(ilai, 'הגאנט עודכן מהתבנית');
  assert.equal(gantt(A).filter((r) => r.kind === 'video').length, 44);
  assert.equal(row(A, moved.key).day === target || row(A, moved.key).edited, true, 'the moved date stays');
  assert.equal(row(A, posted.key).state, 'posted');
  assert.equal(gantt(A).some((r) => r.title === 'גרפיקת בלאק פריידיי'), true);
  const movedNow = row(A, moved.key);
  if (movedNow.edited) {
    await ilai.click('#btn-regen');
    await ilai.waitForSelector('#regen-dlg[open]');
    await ilai.check('#rg-overwrite');
    await ilai.click('#rg-go');
    await toastHas(ilai, 'הגאנט עודכן מהתבנית');
    const back = row(A, moved.key);
    const want = generatePlan(A).entries.find((e) => e.key === moved.key);
    assert.deepEqual([back.day, back.edited], [want.day, false]);
  }
  assert.equal(row(A, posted.key).note, 'עלה עם שיר טרנדי');
});

let shareLink = null;
await step('the client\'s link: created, copied again after a reload', async () => {
  await ilai.waitForSelector('#gs-create');
  await ilai.click('#gs-create');
  await toastHas(ilai, 'נוצר קישור ללקוח');
  shareLink = await ilai.inputValue('#gs-url');
  assert.match(shareLink, /gantt\.html#t=[A-Za-z0-9_-]{43}$/); // after #: it reaches no log of the host (ops.md 36)
  await ilai.reload();
  await ilai.waitForSelector('#gs-url');
  assert.equal(await ilai.inputValue('#gs-url'), shareLink);
  await shot(ilai, 'gantt-05-desktop-full');
});

await step('the list view and the year at a glance take you to a month', async () => {
  await ilai.click('#view-list');
  await ilai.waitForSelector('#gm-list:not([hidden]) .gt-aday');
  const first = ilai.locator(`#gm-list .gt-row[data-key="${posted.key}"]`);
  assert.match(await first.innerText(), /עלה/);
  assert.equal(await first.locator('a.gt-open').getAttribute('href'), 'https://www.instagram.com/reel/ron29');
  await ilai.click('#gg-table thead th:nth-child(3) .gg-month'); // month 2
  await ilai.waitForFunction(() => document.getElementById('gm-h').textContent === 'אפריל 2026');
  await ilai.click('#view-grid');
});

await step('the print view: the month on one page, every chip, without the page around it', async () => {
  await ilai.click('#gm-pills .gt-pill[aria-label="נובמבר 2026"]');
  await ilai.emulateMedia({ media: 'print' });
  await ilai.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  assert.equal(await ilai.isVisible('.gt-print-head'), true);
  assert.equal(await ilai.isVisible('.gt-hero'), false);
  assert.equal(await ilai.locator('#gm-grid .gt-more').count(), 0);
  await shot(ilai, 'gantt-06-print');
  await ilai.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await ilai.emulateMedia({ media: 'screen' });
});
await ictx.close();

// ── The client ────────────────────────────
// For the client's view: one post scheduled ahead, one that failed, and the rest of the past ones missing.
const ahead = () => gantt(A).filter((r) => r.kind === 'video' && r.day > todayIL && r.day.startsWith('2026-11') && perDay(r.day) <= 3)[0];
const failed = () => gantt(A).filter((r) => r.kind === 'graphic' && r.day < todayIL && r.day.startsWith('2026-11') && perDay(r.day) <= 3)[0];
await step('the client opens the link without signing in: dates, what is scheduled, what went up and its link; nothing internal, never "חסר" or "שגיאה"', async () => {
  Object.assign(ahead(), { state: 'scheduled', source: 'manual' });
  Object.assign(failed(), { state: 'error', source: 'metricool', mc_status: 'error', mc_error: 'Media not valid', mc_post_id: '900' });
  const cctx = await newContext();
  const page = await newPage(cctx);
  await page.goto(shareLink);
  await page.waitForSelector('#gt-cal:not([hidden]) .gt-grid');
  await page.waitForSelector(`#gm-grid .gt-chip.s-scheduled[data-key="${ahead().key}"] .gt-clock`);
  assert.equal(await page.locator(`#gm-grid .gt-chip.s-planned[data-key="${failed().key}"]`).count(), 1);
  assert.equal(await page.isVisible('#staff-nav'), false);
  assert.equal(await page.isVisible('#login-block'), false);
  assert.equal(await page.innerText('#gt-title'), 'גאנט התוכן · מספרת רון'); // the business, not the contact
  const all = await page.innerText('body');
  // The client sees מתוכנן / תוזמן / עלה only: never "חסר", never "שגיאה", nothing of Metricool or of the team's tools.
  for (const secret of ['תכנון חודש', 'שיחת חידוש', 'עלה עם שיר טרנדי', 'הערה של המשרד', 'עדכון מהתבנית', 'הוספת פריט', 'עברו ולא סומנו', 'חסר', 'שגיאה', 'סימון כתוזמנו', 'Metricool', 'רון כהן', 'כל הגאנטים']) assert.ok(!all.includes(secret), secret);
  assert.doesNotMatch(all, /\bnull\b|undefined/);
  assert.equal(await page.locator('#btn-regen, #btn-add, #gt-share:not([hidden]), #btn-bulk:not([hidden]), .gt-state-btn, .gt-warn, #gt-mc:not([hidden])').count(), 0);
  assert.equal(await page.locator('.gt-chip.s-missing, .gt-chip.s-error, .st-missing').count(), 0);
  assert.match(await page.innerText('#gt-stats'), /תוזמנו/);
  assert.match(await page.innerText('#gt-legend'), /תוזמן[^]*עלה/);
  await page.click(`#gm-grid .gt-chip[data-key="${posted.key}"]`);
  await page.waitForSelector('#entry-dlg[open]');
  assert.equal(await page.getAttribute('#entry-dlg a.gt-open-big', 'href'), 'https://www.instagram.com/reel/ron29');
  assert.equal(await page.locator('#entry-dlg input, #entry-dlg select').count(), 0);
  await page.click('#ed-close');
  await shot(page, 'gantt-07-client-desktop');
  await cctx.close();
  // On a phone.
  const pctx = await newContext({ width: 360, height: 780 });
  const ph = await newPage(pctx);
  await ph.goto(shareLink);
  await ph.waitForSelector('#gm-list:not([hidden]) .gt-aday');
  assert.equal(await noHScroll(ph), true);
  await shot(ph, 'gantt-08-client-360');
  await ph.goto(`${BASE}gantt.html?t=not-a-token`);
  await ph.waitForSelector('#closed:not([hidden])');
  assert.match(await ph.innerText('#closed'), /הקישור לא תקין/);
  await pctx.close();
});

// ── Nadia, Anna ───────────────────────────
await step('the client\'s editor reads the Gantt and nothing more; an editor without the client has no access', async () => {
  const nctx = await newContext();
  const nadia = await newPage(nctx);
  await signIn(nadia, `gantt.html?id=${A.id}`, 'nadia@astrateg.test');
  await nadia.waitForSelector('#gt-cal:not([hidden]) .gt-grid');
  assert.equal(await nadia.locator('#btn-regen, #btn-add').count(), 0);
  assert.equal(await nadia.isVisible('#gt-share'), false);
  assert.equal(await nadia.locator('.gt-chip[draggable="true"]').count(), 0);
  await nadia.click(`#gm-grid .gt-chip[data-key="${posted.key}"]`);
  await nadia.waitForSelector('#entry-dlg[open]');
  await nadia.click('#ed-close');
  await nadia.click(`td[data-day="${posted.day}"] .gt-daynum`);
  await nadia.waitForSelector('#gm-day:not([hidden])');
  assert.doesNotMatch(await nadia.innerText('#app'), /\bnull\b|undefined/);
  await nadia.click(`#gm-grid .gt-chip[data-key="${posted.key}"]`);
  await nadia.waitForSelector('#entry-dlg[open]');
  assert.equal(await nadia.locator('#entry-dlg input').count(), 0);
  assert.match(await nadia.innerText('#entry-dlg'), /עלה עם שיר טרנדי/); // the team sees the internal note
  await nctx.close();
  const actx = await newContext();
  const anna = await newPage(actx);
  // Signed in on her home, then the Gantt by its address (a sign-in ON a page that is not hers
  // takes her home instead of showing the refusal: docs/ops.md, section 54).
  await signIn(anna, 'clients.html', 'anna@astrateg.test');
  await anna.waitForSelector('#view-mine:not([hidden])');
  await anna.goto(`${BASE}gantt.html?id=${A.id}`);
  await anna.waitForSelector('#no-access:not([hidden])');
  await actx.close();
});

// ── Irit, Lior, Ofir: view only, and the client's link ──
const SHOTS = OUT ? [['desktop', { width: 1440, height: 900 }], ['phone', { width: 375, height: 780 }]] : [];
await step('Irit, Lior and Ofir read the Gantt and nothing more: no editing control, but the client\'s link and the print are theirs', async () => {
  for (const who of ['irit', 'lior', 'ofir']) {
    const ctx = await newContext();
    const page = await newPage(ctx);
    await signIn(page, `gantt.html?id=${A.id}`, `${who}@astrateg.test`);
    await page.waitForSelector('#gt-cal:not([hidden]) .gt-grid');
    assert.equal(await page.innerText('#gt-title'), 'גאנט התוכן · מספרת רון · רון כהן', who);
    assert.equal(await page.locator('#btn-regen, #btn-add, .gt-state-btn, #btn-brand, .gt-chip[draggable="true"]').count(), 0, who);
    assert.equal(await page.isVisible('#btn-bulk'), false, who);
    assert.match(await page.innerText('#gt-readonly'), /צפייה בלבד: את הגאנט מעדכנים עילאי ובעל המשרד/, who);
    assert.deepEqual(await page.locator('#gt-actions .btn').allInnerTexts(), ['כל הגאנטים', 'לכרטיס הלקוח', 'הדפסת החודש'], who);
    // The team still sees what needs someone: the failed post and the missing ones.
    assert.match(await page.innerText('.st-missing.is-missing'), /חסרים\s*[1-9]\d*\s*מהם שגיאת פרסום אחת/, who);
    // An entry opens read-only (with the team's note and what Metricool said), no field to change.
    await page.click(`#gm-grid .gt-chip[data-key="${failed().key}"]`);
    await page.waitForSelector('#entry-dlg[open]');
    assert.equal(await page.locator('#entry-dlg input, #entry-dlg select, #entry-dlg textarea, #ed-save, #ed-del').count(), 0, who);
    assert.match(await page.innerText('#entry-dlg'), /שגיאה[^]*הפרסום נכשל ב־Metricool \(Media not valid\)/, who);
    await page.click('#ed-close');
    // Dropping on a day does nothing, and nothing was sent to the database.
    await page.click('td[data-day="2026-11-24"] .gt-daynum');
    await page.waitForSelector('#gm-day:not([hidden])');
    assert.equal(await page.locator('#gm-day button:has-text("הוספת פריט")').count(), 0, who);
    // The client's link: theirs to copy, renew and revoke; it is their one pink action.
    await page.waitForSelector('#gs-url');
    assert.equal(await page.inputValue('#gs-url'), shareLink, who);
    assert.deepEqual(await page.locator('#app .btn-primary:visible').allInnerTexts(), ['העתקה'], who);
    assert.equal(await page.locator('#gt-share .btn-text').count(), 2, who);
    if (who === 'irit') {
      await shot(page, 'gantt-13-irit-view-only');
      for (const [name, viewport] of SHOTS) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${OUT}/client-irit-${name}.png`, fullPage: true });
      }
    }
    await ctx.close();
  }
  assert.deepEqual(refused, [], 'no write was even tried');
});

// ── The index ─────────────────────────────
await step('"גאנט תוכן" in the menu opens the index: the week across clients and every active client, also when nobody has open work', async () => {
  // Nothing open for Ilai anywhere: his clients list would be empty, the menu still takes him in.
  const ctx = await newContext({ width: 1440, height: 900 });
  const page = await newPage(ctx);
  await signIn(page, 'clients.html#mine', 'ilai@astrateg.test');
  await page.waitForSelector('#side-gantt');
  assert.equal(await page.innerText('#side-gantt'), 'גאנט תוכן');
  assert.equal(await page.locator('#side-list a:has-text("המשימות שלי")').count(), 1, 'once in the menu');
  const labels = await page.locator('#side-list a').allInnerTexts();
  assert.equal(new Set(labels).size, labels.length, `no entry twice: ${labels.join(', ')}`);
  await page.click('#side-gantt');
  await page.waitForSelector('#gx:not([hidden]) #gx-list .gx-client');
  assert.equal(await page.getAttribute('#side-gantt', 'aria-current'), 'page');
  assert.equal(await page.innerText('#gx-h'), 'גאנט תוכן');
  assert.equal(await page.innerText('#gx-sub'), '3 לקוחות פעילים · ל־1 יש גאנט');
  // The clients: Ron first (things are missing), with his package month, counts and next post; the others have no Gantt yet.
  const cards = page.locator('#gx-list .gx-client');
  assert.equal(await cards.count(), 3);
  const first = await cards.first().innerText();
  assert.match(first, /מספרת רון · רון כהן[^]*חודש 8 מתוך 12[^]*עלו[^]*תוזמנו[^]*חסרים[^]*הבא: \d+\.11/);
  assert.equal(await cards.first().getAttribute('class'), 'gx-client has-missing');
  assert.doesNotMatch(await page.innerText('#gx'), /עסק שהסתיים|\bnull\b|undefined/);
  // Ilai (and the owner) can start a Gantt from here; the way in is the client's own page.
  const make = page.locator(`#gx-list .gx-client[data-client="${C.id}"] .gx-create`);
  assert.match(await make.innerText(), /^יצירת הגאנט מהתבנית/);
  assert.equal(await make.getAttribute('href'), `gantt.html?id=${C.id}`);
  assert.equal(await page.locator('#gx .btn-primary:visible').count(), 0);
  // The week (Sunday 8.11 to Saturday 14.11): Ron's posts by day, each with its time, client, kind and state.
  const inWeek = gantt(A).filter((r) => r.day >= '2026-11-08' && r.day <= '2026-11-14' && !['report', 'plan', 'shoot', 'renewal', 'end', 'photo'].includes(r.kind) && r.state !== 'skipped');
  assert.equal(await page.locator('#gxw-body .gx-row').count(), inWeek.length);
  assert.match(await page.innerText('#gxw-sub'), new RegExp(`8\\.11–14\\.11 · ${inWeek.length} פרסומים בכל הלקוחות`));
  const row0 = page.locator('#gxw-body .gx-row').first();
  assert.match(await row0.innerText(), /\d\d:\d\d[^]*מספרת רון · רון כהן[^]*(סרטון|גרפיקה)[^]*(חסר|עלה|תוזמן|מתוכנן|שגיאה|היום)/);
  assert.equal(await page.locator('#gxw-body .gt-aday.is-today').count() <= 1, true);
  // Search and sort.
  await page.fill('#gx-q', 'דנה');
  assert.deepEqual(await page.locator('#gx-list .gx-name').allInnerTexts(), ['סטודיו דנה · דנה לוי']);
  await page.fill('#gx-q', 'אין כזה');
  assert.match(await page.innerText('#gx-none'), /אין לקוח בשם הזה/);
  await page.fill('#gx-q', '');
  await page.click('#gx-sort-name');
  assert.deepEqual(await page.locator('#gx-list .gx-name').allInnerTexts(), ['מספרת רון · רון כהן', 'סטודיו דנה · דנה לוי', 'קפה נדיה']);
  await page.click('#gx-sort-missing');
  assert.equal((await page.locator('#gx-list .gx-name').allInnerTexts())[0], 'מספרת רון · רון כהן');
  await shot(page, 'gantt-14-index');
  if (OUT) await page.screenshot({ path: `${OUT}/index-ilai-desktop.png`, fullPage: true });
  // A row of the week opens that client's Gantt on that day.
  const target = inWeek.sort((a, b) => a.day.localeCompare(b.day))[0];
  await page.click(`#gxw-body a.gt-row-main[data-key="${target.key}"]`);
  await page.waitForSelector('#gt-cal:not([hidden]) .gt-grid');
  assert.match(page.url(), new RegExp(`gantt\\.html\\?id=${A.id}&m=2026-11&d=${target.day}$`));
  await page.waitForSelector(`#gm-day:not([hidden]) .gt-row[data-key="${target.key}"]`);
  assert.equal(await page.getAttribute('#side-gantt', 'aria-current'), 'true'); // a page under the index
  // And back.
  await page.click('#to-index');
  await page.waitForSelector('#gx:not([hidden]) #gx-list .gx-client');
  // Starting the Gantt of a client that has none, from the index.
  await page.click(`#gx-list .gx-client[data-client="${C.id}"] .gx-create`);
  await page.waitForSelector('#btn-create');
  await ctx.close();
});

await step('the index for the owner, Irit, Lior and Ofir (reading; no "יצירת הגאנט" but for the owner); an editor has no index; on a phone it is in Ilai\'s bar', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir']) {
    const ctx = await newContext();
    const page = await newPage(ctx);
    await signIn(page, 'gantt.html', `${who}@astrateg.test`);
    await page.waitForSelector('#gx:not([hidden]) #gx-list .gx-client');
    assert.equal(await page.locator('#side-gantt').count(), 1, who);
    assert.equal(await page.locator('#gx-list .gx-client').count(), 3, who);
    assert.equal(await page.locator('#gx-list .gx-create').count(), who === 'owner' ? 2 : 0, who);
    if (who === 'irit' && OUT) {
      for (const [name, viewport] of SHOTS) { await page.setViewportSize(viewport); await page.waitForTimeout(150); await page.screenshot({ path: `${OUT}/index-irit-${name}.png`, fullPage: true }); }
    }
    await ctx.close();
  }
  const nctx = await newContext();
  const nadia = await newPage(nctx);
  await signIn(nadia, 'gantt.html', 'nadia@astrateg.test');
  await nadia.waitForFunction(() => /לא נבחר לקוח/.test(document.getElementById('state').textContent));
  assert.equal(await nadia.isVisible('#gx'), false);
  assert.equal(await nadia.locator('#side-gantt').count(), 0);
  await nctx.close();
  // Ilai's phone: the Gantt is in the bar, with his three other screens (no builder since 8.10.2026, so no "עוד"); the index fits 375px with 44px targets.
  const pctx = await newContext({ width: 375, height: 780 });
  const ph = await newPage(pctx);
  await signIn(ph, 'clients.html#mine', 'ilai@astrateg.test');
  await ph.waitForSelector('#side-list #side-gantt');
  assert.deepEqual(await ph.locator('#side-list > a, #side-list > button').allInnerTexts(), ['המשימות שלי', 'הלקוחות שלי', 'גאנט תוכן', 'שנת החבילה']);
  await ph.click('#side-gantt');
  await ph.waitForSelector('#gx:not([hidden]) #gx-list .gx-client');
  assert.equal(await noHScroll(ph), true);
  assert.deepEqual(await smallTargets(ph, '#gx'), []);
  assert.deepEqual(await ph.evaluate(() => [...document.querySelectorAll('#gx a.gx-main, #gx a.gt-row-main, #gx-q')].filter((el) => el.getBoundingClientRect().height < 44).map((el) => el.textContent.trim().slice(0, 20))), []);
  await shot(ph, 'gantt-15-index-phone');
  if (OUT) await ph.screenshot({ path: `${OUT}/index-ilai-phone.png`, fullPage: true });
  await pctx.close();
});

// ── Metricool ─────────────────────────────
await step('Metricool, while the switch is off: a line says so; Ilai connects the client to its brand (suggested by name), through the function', async () => {
  const ctx = await newContext({ width: 1440, height: 900 });
  const page = await newPage(ctx);
  const direct = [];
  page.on('request', (r) => { if (/metricool\.com/.test(r.url())) direct.push(r.url()); });
  await signIn(page, `gantt.html?id=${A.id}`, 'ilai@astrateg.test');
  await page.waitForSelector('#gt-mc:not([hidden])');
  assert.match(await page.innerText('#gt-mc'), /הלקוח לא מחובר למותג ב־Metricool\. הסימון ידני\./);
  assert.equal(metricool.calls.length, 0, 'opening a Gantt calls nothing');
  await page.click('#btn-brand');
  await page.waitForSelector('#brand-dlg[open] #bd-list .gt-brand');
  assert.deepEqual(metricool.calls, [{ action: 'brands', by: 'ilai@astrateg.test' }]);
  assert.deepEqual(await page.locator('#bd-list .gt-brand bdi').allInnerTexts(), ['מספרת רון', 'סטודיו דנה', 'Cafe Nadia']);
  // The brand of the same name is suggested and already chosen.
  assert.match(await page.locator('#bd-list .gt-brand:has(input:checked)').innerText(), /מספרת רון[^]*instagram · facebook · הצעה לפי השם/);
  assert.doesNotMatch(await page.innerText('#brand-dlg'), /TOKEN|4455|\bnull\b|undefined/);
  await shot(page, 'gantt-16-brand-dialog', false);
  await page.click('#bd-save');
  await toastHas(page, 'הלקוח חובר למותג ״מספרת רון״');
  assert.deepEqual([A.metricool_blog_id, A.metricool_brand], ['101', 'מספרת רון']);
  // The line changes together with the message (not a request later, as it did).
  assert.match(await page.innerText('#gt-mc'), /מחובר ל״מספרת רון״ ב־Metricool\. הסנכרון כבוי, והסימון ידני\./);
  assert.equal(await page.innerText('#btn-brand'), 'החלפת מותג');
  // The same brand cannot be given to another client.
  await page.goto(`${BASE}gantt.html?id=${C.id}`);
  await page.waitForSelector('#btn-create');
  assert.equal(await page.isVisible('#gt-mc'), true);
  await page.click('#btn-brand');
  await page.waitForSelector('#brand-dlg[open] #bd-list .gt-brand');
  assert.equal(await page.locator('#bd-list .gt-brand.is-taken input').isDisabled(), true);
  assert.match(await page.locator('#bd-list .gt-brand.is-taken').innerText(), /מספרת רון[^]*מחובר ללקוח אחר/);
  assert.match(await page.locator('#bd-list .gt-brand:has(input:checked)').innerText(), /סטודיו דנה/);
  await page.click('#bd-close');
  // A client marked "ללקוח אין מותג" in the card of "המשימות שלי" (section 33): the line
  // says so, and Ilai takes the mark back from here (the card is gone when its list is empty).
  C.metricool_none = true;
  await page.reload();
  await page.waitForSelector('#btn-brand-back');
  assert.match(await page.innerText('#gt-mc'), /סומן שללקוח אין מותג ב־Metricool\. הסימון ידני\.\s*ביטול הסימון\s*חיבור למותג ב־Metricool/);
  await page.click('#btn-brand-back');
  await toastHas(page, 'הלקוח חזר לרשימת ״לקוחות שלא מחוברים ל־Metricool״.');
  assert.equal(C.metricool_none, false);
  assert.match(await page.innerText('#gt-mc'), /הלקוח לא מחובר למותג ב־Metricool\. הסימון ידני\./);
  assert.equal(await page.locator('#btn-brand-back').count(), 0);
  // When Metricool does not answer, the dialog says so in Hebrew.
  metricool.down = true;
  await page.click('#btn-brand');
  await page.waitForSelector('#bd-err');
  assert.match(await page.innerText('#bd-err'), /לא הצלחנו לקבל את רשימת המותגים\. Metricool ביקש להאט/);
  metricool.down = false;
  await page.click('#bd-close');
  assert.deepEqual(direct, [], 'the browser never talks to Metricool itself');
  await ctx.close();
});

await step('with the switch on, a sync marks the Gantt: scheduled with a clock, posted with its link, a failure, and a post no entry fits; the line says when', async () => {
  metricool.enabled = true;
  for (const r of gantt(A)) Object.assign(r, { state: r.key === posted.key ? 'posted' : 'planned', source: 'manual', mc_status: null, mc_error: null, mc_post_id: null });
  const shownInGrid = (r) => gantt(A).filter((x) => x.day === r.day).length <= 2; // with the extra row's day free, every chip is on the grid
  const future = gantt(A).filter((r) => r.kind === 'video' && r.day > todayIL && r.day.startsWith('2026-11') && shownInGrid(r))[0];
  const past = gantt(A).filter((r) => r.kind === 'graphic' && r.day < todayIL && r.day.startsWith('2026-11') && shownInGrid(r))[0];
  const bad = gantt(A).filter((r) => r.kind === 'video' && r.day < todayIL && r.day.startsWith('2026-11') && r.key !== posted.key && shownInGrid(r))[0];
  assert.ok(future && past && bad, 'November has what the step needs');
  const mcPost = (id, day, time, status, extra = {}, type = 'REEL') => ({ id, publicationDate: { dateTime: `${day}T${time}:00`, timezone: 'Asia/Jerusalem' }, text: `פוסט ${id}`, media: [type === 'REEL' ? 'https://x/v.mp4' : 'https://x/a.jpg'], instagramData: { type }, providers: [{ network: 'instagram', status, ...extra }] });
  const listing = { data: [
    mcPost(1, future.day, '20:15', 'PENDING'),
    mcPost(2, past.day, '13:00', 'PUBLISHED', { publicUrl: 'https://www.instagram.com/p/from-metricool' }, 'POST'),
    mcPost(3, bad.day, '19:00', 'ERROR', { detailedStatus: 'Token expired' }),
    mcPost(4, '2026-11-27', '09:30', 'PENDING'), // a Friday: the template never posts then, so no entry fits
  ] };
  // Four minutes before the clock of the page that opens below. A page's clock starts at
  // NOW when its context opens, while serverNow() has been running since the suite began:
  // measured from serverNow(), the line read "3 דקות" whenever the suite had been running
  // for a minute or more (every time the browser suites ran side by side).
  const planned = syncClient(A, listing, new Date(NOW.getTime() - 4 * 60e3).toISOString());
  assert.deepEqual([planned.stats.matched, planned.stats.extras, planned.failed.length], [3, 1, 1]);
  const ctx = await newContext({ width: 1440, height: 900 });
  const page = await newPage(ctx);
  await signIn(page, `gantt.html?id=${A.id}`, 'ilai@astrateg.test');
  await page.waitForSelector('#gt-mc.is-ok');
  assert.match(await page.innerText('#gt-mc'), /סונכרן מ־Metricool לפני 4 דקות/);
  await page.waitForSelector(`#gm-grid .gt-chip.s-scheduled[data-key="${future.key}"] .gt-clock`);
  await page.waitForSelector(`#gm-grid .gt-chip.s-posted[data-key="${past.key}"] .gt-tick`);
  await page.waitForSelector(`#gm-grid .gt-chip.s-error[data-key="${bad.key}"] .gt-warn`);
  assert.equal(await page.locator(`#gm-grid .gt-chip[data-key="${future.key}"] .gt-chip-time`).innerText(), '20:15'); // the real time
  assert.equal(await page.locator('#gm-grid .gt-chip[data-key="mc.4"]').count(), 1);
  // The entry says where its state came from; the extra row says it came from Metricool and has no "מחיקה".
  await page.click(`#gm-grid .gt-chip[data-key="${past.key}"]`);
  await page.waitForSelector('#entry-dlg[open]');
  assert.equal(await page.inputValue('#ed-link'), 'https://www.instagram.com/p/from-metricool');
  assert.match(await page.innerText('#entry-dlg .gt-meta'), /המצב סומן לפי Metricool[^]*עודכן לאחרונה: הסנכרון מ־Metricool/);
  await page.click('#ed-close');
  await page.click('#gm-grid .gt-chip[data-key="mc.4"]');
  await page.waitForSelector('#entry-dlg[open]');
  assert.match(await page.innerText('#entry-dlg .gt-meta'), /הפריט הגיע מהתזמון ב־Metricool ולא מהתבנית/);
  assert.equal(await page.locator('#ed-del').count(), 0);
  await page.click('#ed-close');
  await page.click(`#gm-grid .gt-chip[data-key="${bad.key}"]`);
  await page.waitForSelector('#entry-dlg[open]');
  assert.match(await page.innerText('#entry-dlg'), /שגיאה[^]*הפרסום נכשל ב־Metricool \(Token expired\)/);
  await page.click('#ed-close');
  assert.match(await page.innerText('.st-missing.is-missing'), /מהם שגיאת פרסום אחת/);
  if (OUT) {
    await page.screenshot({ path: `${OUT}/client-ilai-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 375, height: 780 });
    await page.waitForTimeout(200);
    await page.click('#view-list');
    await page.screenshot({ path: `${OUT}/client-ilai-phone.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('#view-grid');
  }
  // Ilai marks the failed one by hand: his mark stays when the next sync still reports the failure.
  await page.click(`td[data-day="${bad.day}"] .gt-daynum`);
  await page.waitForSelector(`#gm-day .gt-state-btn[data-key="${bad.key}"]`);
  await page.click(`#gm-day .gt-state-btn[data-key="${bad.key}"]`);
  await toastHas(page, 'סומן שתוזמן');
  assert.deepEqual([row(A, bad.key).state, row(A, bad.key).source, row(A, bad.key).mc_post_id], ['scheduled', 'manual', '3']);
  const again = syncClient(A, listing);
  assert.deepEqual([again.update.length, again.insert.length, again.remove.length], [0, 0, 0], 'a second sync changes nothing');
  assert.equal(row(A, bad.key).state, 'scheduled');
  // The post leaves Metricool: only what the sync set goes back to planned; the extra row leaves; Ilai's mark stays.
  syncClient(A, { data: [listing.data[1], listing.data[2]] });
  assert.deepEqual([row(A, future.key).state, row(A, past.key).state, row(A, bad.key).state, gantt(A).some((r) => r.key === 'mc.4')], ['planned', 'posted', 'scheduled', false]);
  // The index's line for the office.
  await page.goto(`${BASE}gantt.html`);
  await page.waitForSelector('#gx-mc.is-ok');
  assert.match(await page.innerText('#gx-mc'), /Metricool פועל: לקוח אחד מחובר\. הסנכרון האחרון עכשיו|Metricool פועל: לקוח אחד מחובר\. הסנכרון האחרון לפני/);
  await ctx.close();
  metricool.enabled = false;
});

// ── The links to the page ─────────────────
await step('the client card links to the Gantt, and so do processes 9, 28 and 29', async () => {
  const octx = await newContext();
  const irit = await newPage(octx);
  await signIn(irit, `client.html?id=${A.id}`, 'irit@astrateg.test');
  await irit.waitForSelector('#cc-gantt');
  assert.equal(await irit.getAttribute('#cc-gantt', 'href'), `gantt.html?id=${A.id}`);
  assert.equal(await irit.getAttribute('#p29 a.gantt-go', 'href'), `gantt.html?id=${A.id}`);
  await irit.click('#cc-gantt');
  await irit.waitForSelector('#gt-cal:not([hidden])');
  await octx.close();
  // Ilai's "הגאנט מלא" card in "המשימות שלי" (process 29).
  const ictx2 = await newContext();
  const il = await newPage(ictx2);
  await signIn(il, 'clients.html#mine', 'ilai@astrateg.test');
  await il.waitForSelector(`.il-card[data-key^="il-gantt:${A.id}"] a.gantt-go`);
  assert.equal(await il.getAttribute(`.il-card[data-key^="il-gantt:${A.id}"] a.gantt-go`, 'href'), `gantt.html?id=${A.id}`);
  await shot(il, 'gantt-12-ilai-mine', false);
  await ictx2.close();
});

// ── Phones ────────────────────────────────
await step('a 360px phone: the list first, the grid with dots, a tapped day below; no sideways scrolling, 44px targets', async () => {
  const pctx = await newContext({ width: 360, height: 780 });
  const ph = await newPage(pctx);
  await signIn(ph, `gantt.html?id=${A.id}`, 'ilai@astrateg.test');
  await ph.waitForSelector('#gm-list:not([hidden]) .gt-aday');
  assert.equal(await noHScroll(ph), true);
  assert.deepEqual(await smallTargets(ph, '#gm-list'), []);
  assert.deepEqual(await smallTargets(ph, '.gt-monthbar'), []);
  assert.deepEqual(await smallTargets(ph, '#gt-actions'), []);
  await shot(ph, 'gantt-09-phone-list');
  await ph.click('#view-grid');
  await ph.waitForSelector('#gm-grid:not([hidden]) .gt-dot');
  assert.equal(await noHScroll(ph), true);
  assert.equal(await ph.isVisible('#gm-grid .gt-chip'), false);
  await ph.click(`td[data-day="${posted.day}"] .gt-daynum`);
  await ph.waitForSelector(`#gm-day .gt-row[data-key="${posted.key}"]`);
  await shot(ph, 'gantt-10-phone-grid');
  await ph.click(`#gm-day .gt-row[data-key="${posted.key}"] .gt-row-main`);
  await ph.waitForSelector('#entry-dlg[open]');
  assert.equal(await noHScroll(ph), true);
  await shot(ph, 'gantt-11-phone-dialog', false);
  await pctx.close();
});

await browser.close();
noCspViolations();
assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`);
console.log(`\n${passed} passed`);
