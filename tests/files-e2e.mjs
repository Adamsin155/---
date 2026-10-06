// End-to-end check of the client's files ("תיק לקוח") against an in-memory fake of
// Supabase (the database, Storage and the client-media function), with the
// browser's clock fixed on Tuesday 13.10.2026 at 11:40 in Israel:
//   - Irit, in the client card: counts per kind, uploads the logo and photos (a
//     preview loads only on screen, from a signed URL), a too-large photo is refused
//     in Hebrew before anything is sent, a custom addition needs its label, a video
//     of 13 MB goes up resumably in 6 MB chunks, graphics, the landing page as a
//     link, "עלה לרשתות בתאריך" saved, a photo deleted;
//   - Irit creates the client's view-only gallery link and copies the WhatsApp message;
//   - the client opens the gallery on a 360px phone: graphics, the video (played in
//     a viewer), the site, download links; no staff names, no internal file names;
//   - the client's status page shows the uploaded graphics next to the approval of
//     the first 9 graphics;
//   - Nadia (the client's editor) sees the files, may upload only videos, deletes
//     nothing of Irit's, and has no gallery link;
//   - Ofir, on the phone, uploads a photo from the characterization form: it lands in
//     the client's files and the form marks the photos as received;
//   - Irit revokes the gallery link and the client gets a friendly message.
// Run: npx http-server -p 8095 -s -c-1 . &  then  BASE_URL=http://localhost:8095/ node tests/files-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { withClientColumns } from './fake-clients.mjs';
import { uploadKinds, isManager, galleryMessage, KINDS, GALLERY_KINDS } from '../app/files-logic.js';

const BASE = process.env.BASE_URL || 'http://localhost:8095/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-10-13T11:40:00+03:00'); // Tuesday
const serverNow = () => new Date(NOW);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;
const SUPA = 'https://czncjzziqrqtezpwxxpz.supabase.co';
const MB = 1024 * 1024;

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
const canManageLinks = (u) => { const p = personOf(u); return p === null || ['irit', 'lior'].includes(p); };

// ── The client ────────────────────────────
const D = {
  id: 'dddddddd-0000-4000-8000-000000000001', name: 'דנה לוי', business: 'קפה דנה', address: 'הרצל 1, חיפה', phone: '050-1112222',
  package_name: 'Social', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, editor_name: null, editor: 'nadia',
  deal_at: '2026-10-01T09:00:00+03:00', char_at: '2026-10-13T10:00:00+03:00', shoot_at: '2026-10-20T11:00:00+03:00', contract_end: '2027-10-01',
  status: 'active', notes: 'הערה פנימית', quote_id: null, created_at: '2026-10-01T09:00:00+03:00', created_by_email: 'irit@astrateg.test',
  links: {}, deliverables: { videos: 20 }, rounds: [], verified_at: null, verified_by: null, closed_reason: null,
};
const check = (key, at = '2026-10-13T09:00:00+03:00') => ({ client_id: D.id, item_key: key, state: 'done', note: null, by_email: 'ilai@astrateg.test', at });
const db = {
  staff,
  clients: [D],
  protocol_checks: [check('p04.ended'), check('p07.sent')],
  client_tasks: [], protocol_log: [], client_access: [], client_access_log: [], client_status_notes: [], office_reviews: [], quotes: [],
  client_messages: [], message_templates: [], client_questions: [], client_date_changes: [], reminder_log: [], push_subscriptions: [],
  characterizations: [], content_briefs: [], client_status_links: [], client_status_views: [], client_approvals: [], client_surveys: [], client_consents: [],
  client_files: [], client_gallery_links: [],
};
const hash = (t) => createHash('sha256').update(t).digest('hex');
const vault = new Map(); // link id -> token
const objects = new Map(); // storage path -> { size, type, owner }
const tus = new Map(); // upload id -> { path, length, offset, type, owner }
const calls = [];
const visibleClient = (u, cid) => isOffice(u) || db.clients.some((c) => c.id === cid && c.editor === personOf(u));
const CLIENT_TABLES = new Set(['protocol_checks', 'protocol_log', 'client_tasks', 'characterizations', 'content_briefs', 'client_access', 'client_access_log', 'client_files']);
const OFFICE_TABLES = new Set(['client_status_links', 'client_status_views', 'client_approvals', 'client_surveys', 'client_consents', 'client_gallery_links']);

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
  const off = Number(params.get('offset') || 0);
  return out.slice(off, off + Number(params.get('limit') || 1e9));
}

// ── The status page (only what this suite needs: the first 9 graphics are waiting) ──
function linkOf(table, token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ''))) return { reason: 'invalid' };
  const l = db[table].find((x) => x.token_hash === hash(token));
  if (!l) return { reason: 'invalid' };
  if (l.revoked_at) return { reason: 'revoked' };
  if (new Date(l.expires_at) <= serverNow()) return { reason: 'expired' };
  return { link: l };
}
const statusPayload = (l, preview) => ({
  state: 'ok', preview, expiresAt: l.expires_at,
  client: { name: D.name, business: D.business, status: D.status, shootType: D.shoot_type, charAt: D.char_at, shootAt: D.shoot_at, contractEnd: D.contract_end, rounds: [] },
  marks: Object.fromEntries(db.protocol_checks.filter((x) => /^(p04\.ended|p07\.(sent|approved))$/.test(x.item_key)).map((x) => [x.item_key, { s: x.state, at: x.at }])),
  links: {},
  items: db.protocol_checks.some((x) => x.item_key === 'p07.approved') ? [] : [{ item: 'graphics9', key: 'p07.approved', shootRound: 1, state: 'waiting', round: 1, included: 1, sentAt: '2026-10-13T09:00:00+03:00', approvedAt: null, link: null }],
  approvals: [], thursday: null, surveys: { due: [], answered: [] },
});

// ── The client-media function (as supabase/functions/client-media answers) ──
const signedOf = (path) => `${SUPA}/storage/v1/object/sign/client-files/${path}?token=signed`;
function media(body) {
  const scope = body?.scope;
  const got = linkOf(scope === 'gallery' ? 'client_gallery_links' : 'client_status_links', body?.t);
  if (got.reason) return { state: got.reason };
  const live = db.client_files.filter((f) => f.client_id === D.id && !f.deleted_at);
  if (scope === 'gallery') {
    got.link.open_count += 1;
    got.link.last_opened_at = serverNow().toISOString();
  }
  const cut = db.protocol_checks.find((x) => x.item_key === 'p07.approved')?.at || null;
  const files = (scope === 'gallery' ? live.filter((f) => GALLERY_KINDS.includes(f.kind)) : live.filter((f) => f.kind === 'deliverable_graphic'))
    .map((f, i) => ({
      id: f.id, kind: f.kind, label: f.label, mime: f.mime, size: f.size_bytes, postedOn: f.posted_on, link: f.link, at: f.created_at,
      ...(scope === 'status' ? { item: !cut || f.created_at <= cut ? 'graphics9' : 'graphics' } : {}),
      url: signedOf(f.storage_path), download: `${signedOf(f.storage_path)}&download=astrateg-${i}`, thumb: null,
    }));
  return { state: 'ok', scope, business: D.business, expiresAt: got.link.expires_at, ttl: 3600, files };
}

// A picture for each image, in the brand's colours (so the screenshots show real previews).
const COLORS = ['#5302DF', '#F82272', '#031432', '#A980EF', '#FF6B8B', '#3DD68C'];
function svgFor(path) {
  const c = COLORS[parseInt(hash(path).slice(0, 2), 16) % COLORS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="${c}"/><circle cx="160" cy="140" r="60" fill="#fff" opacity=".85"/><rect x="70" y="230" width="180" height="22" rx="11" fill="#fff" opacity=".7"/></svg>`;
}

// ── The fake ──────────────────────────────
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'location, upload-offset, tus-resumable' };
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
  const now = serverNow().toISOString();
  calls.push(`${req.method()} ${p}`);

  // ── Auth ──
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });

  // ── The edge function ──
  if (p === '/functions/v1/client-media') return json(200, media(body));

  // ── Storage ──
  const refuse = () => json(400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
  const mayUpload = (path) => {
    const [cid, kind] = path.split('/');
    const c = db.clients.find((x) => x.id === cid);
    return !!me && !!c && visibleClient(me, cid) && uploadKinds(personOf(me), c).includes(kind);
  };
  let m = /^\/storage\/v1\/object\/sign\/client-files\/(.+)$/.exec(p);
  if (m && req.method() === 'POST') {
    const path = decodeURIComponent(m[1]);
    const row = db.client_files.find((f) => f.storage_path === path);
    const owner = objects.get(path)?.owner === me?.email;
    if (!me || !(owner || (row && visibleClient(me, row.client_id) && (!row.deleted_at || isManager(personOf(me)))))) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    const transform = body?.transform ? 'render/image/sign' : 'object/sign';
    return json(200, { signedURL: `/${transform}/client-files/${path}?token=t${Date.now() % 1000}` });
  }
  if ((m = /^\/storage\/v1\/(object|render\/image)\/sign\/client-files\/(.+)$/.exec(p)) && req.method() === 'GET') {
    const path = decodeURIComponent(m[2]);
    const o = objects.get(path);
    if (!o) return route.fulfill({ status: 404, headers: CORS, body: '' });
    if (/^image\//.test(o.type)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: CORS, body: svgFor(path) });
    return route.fulfill({ status: 200, contentType: o.type || 'application/octet-stream', headers: CORS, body: Buffer.alloc(16) });
  }
  m = /^\/storage\/v1\/object\/client-files\/(.+)$/.exec(p);
  if (m && req.method() === 'POST') {
    const path = decodeURIComponent(m[1]);
    if (!mayUpload(path)) return refuse();
    if (objects.has(path)) return json(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    objects.set(path, { size: (req.postDataBuffer() || Buffer.alloc(0)).length, type: headers['content-type'], owner: me.email, via: 'standard' });
    return json(200, { Key: `client-files/${path}` });
  }
  if (p === '/storage/v1/object/client-files' && req.method() === 'DELETE') {
    for (const path of body?.prefixes || []) if (objects.get(path)?.owner === me?.email || isManager(personOf(me))) objects.delete(path);
    return json(200, []);
  }
  if (p === '/storage/v1/upload/resumable' && req.method() === 'POST') {
    const meta = Object.fromEntries(String(headers['upload-metadata'] || '').split(',').map((x) => { const [k, v] = x.split(' '); return [k, Buffer.from(v || '', 'base64').toString()]; }));
    if (meta.bucketName !== 'client-files' || !mayUpload(meta.objectName)) return refuse();
    const id = randomUUID();
    tus.set(id, { path: meta.objectName, length: Number(headers['upload-length']), offset: 0, type: meta.contentType, owner: me.email, chunks: 0 });
    return route.fulfill({ status: 201, headers: { ...CORS, location: `${SUPA}/storage/v1/upload/resumable/${id}`, 'tus-resumable': '1.0.0' }, body: '' });
  }
  m = /^\/storage\/v1\/upload\/resumable\/([\w-]+)$/.exec(p);
  if (m) {
    const u = tus.get(m[1]);
    if (!u) return route.fulfill({ status: 404, headers: CORS, body: '' });
    if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...CORS, 'upload-offset': String(u.offset), 'upload-length': String(u.length) }, body: '' });
    if (req.method() === 'PATCH') {
      if (Number(headers['upload-offset']) !== u.offset) return route.fulfill({ status: 409, headers: CORS, body: '' });
      u.offset += (req.postDataBuffer() || Buffer.alloc(0)).length;
      u.chunks += 1;
      if (u.offset >= u.length) objects.set(u.path, { size: u.length, type: u.type, owner: u.owner, via: 'resumable', chunks: u.chunks });
      return route.fulfill({ status: 204, headers: { ...CORS, 'upload-offset': String(u.offset), 'tus-resumable': '1.0.0' }, body: '' });
    }
  }

  // ── Functions in the database ──
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(p)?.[1];
  if (rpc) {
    if (rpc === 'get_status') { const got = linkOf('client_status_links', body.p_token); return json(200, got.reason ? { state: got.reason } : statusPayload(got.link, !!me)); }
    if (rpc === 'is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
    if (!me) return json(401, { code: '42501', message: 'permission denied' });
    if (rpc === 'can_use_vault' || rpc === 'can_use_client_vault') return json(200, isOffice(me) && personOf(me) !== 'nadia');
    const makeLink = (table, prefix, days) => {
      if (!canManageLinks(me)) return json(403, { code: '42501', message: 'not allowed' });
      for (const l of db[table]) if (l.client_id === body.p_client && !l.revoked_at) { l.revoked_at = now; l.revoked_by = me.email; }
      const token = randomBytes(32).toString('base64url');
      const id = randomUUID();
      const expires = new Date(serverNow().getTime() + days * 864e5).toISOString();
      db[table].push({ id, client_id: body.p_client, token_hash: hash(token), created_at: now, created_by: me.email, expires_at: expires, revoked_at: null, revoked_by: null, last_opened_at: null, open_count: 0 });
      vault.set(id, token);
      return json(200, { id, token, expiresAt: expires });
    };
    if (rpc === 'gallery_link_create') return makeLink('client_gallery_links', 'gallery', 365);
    if (rpc === 'status_link_create') return makeLink('client_status_links', 'status', 180);
    if (rpc === 'gallery_link_token' || rpc === 'status_link_token') {
      if (!canManageLinks(me)) return json(403, { code: '42501', message: 'not allowed' });
      const l = db[rpc === 'gallery_link_token' ? 'client_gallery_links' : 'client_status_links'].find((x) => x.id === body.p_id && !x.revoked_at);
      return json(200, l ? vault.get(l.id) : null);
    }
    if (rpc === 'gallery_link_revoke') {
      if (!canManageLinks(me)) return json(403, { code: '42501', message: 'not allowed' });
      const l = db.client_gallery_links.find((x) => x.id === body.p_id);
      if (l && !l.revoked_at) Object.assign(l, { revoked_at: now, revoked_by: me.email });
      vault.delete(body.p_id);
      return json(200, null);
    }
    return json(200, null);
  }

  // ── Tables ──
  const t = /^\/rest\/v1\/(\w+)$/.exec(p)?.[1];
  if (!t || !db[t]) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${t}'` });
  if (!me) return json(401, { message: 'permission denied' });
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' })) : json(200, rows));
  const seen = (rows) => (t === 'clients' ? rows.filter((r) => visibleClient(me, r.id))
    : CLIENT_TABLES.has(t) ? rows.filter((r) => visibleClient(me, r.client_id)) : OFFICE_TABLES.has(t) && !isOffice(me) ? [] : rows);
  if (req.method() === 'GET') {
    let rows = seen(applyFilters(db[t], url.searchParams));
    if (t === 'client_gallery_links' || t === 'client_status_links') rows = rows.map(({ token_hash, ...r }) => r);
    return reply(rows);
  }
  const rls = () => json(403, { code: '42501', message: `new row violates row-level security policy for table "${t}"` });
  if (t === 'client_files' && req.method() === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const out = [];
    for (const r of rows) {
      const c = db.clients.find((x) => x.id === r.client_id);
      if (!c || !visibleClient(me, c.id) || !uploadKinds(personOf(me), c).includes(r.kind)) return rls();
      if (!new RegExp(`^${r.client_id}/${r.kind}/[0-9a-f-]{36}-[^/]{1,180}$`).test(r.storage_path)) return json(400, { code: '23514', message: 'violates check constraint "client_files_path_shape"' });
      const row = { id: randomUUID(), label: null, mime: null, size_bytes: null, posted_on: null, link: null, ...r, uploaded_by: me.email, created_at: new Date(serverNow().getTime() + db.client_files.length * 1000).toISOString(), deleted_at: null };
      db.client_files.push(row);
      out.push(row);
    }
    return reply(out);
  }
  if (t === 'client_files' && req.method() === 'PATCH') {
    const rows = seen(applyFilters(db[t], url.searchParams));
    for (const r of rows) {
      const mine = r.uploaded_by === me.email;
      if ('deleted_at' in body && !(isManager(personOf(me)) || mine)) return json(403, { code: '42501', message: 'not allowed: only the office or the uploader deletes a file' });
      const may = isManager(personOf(me)) || mine || (personOf(me) === 'ilai' && KINDS[r.kind].group === 'deliverables') || uploadKinds(personOf(me), D).includes(r.kind);
      if (!may) return reply([]);
      Object.assign(r, body, 'deleted_at' in body && body.deleted_at ? { deleted_at: now } : {});
    }
    return reply(rows);
  }
  if (req.method() === 'POST' && t === 'protocol_checks') {
    const rows = Array.isArray(body) ? body : [body];
    for (const r of rows) {
      db.protocol_checks = db.protocol_checks.filter((x) => !(x.client_id === r.client_id && x.item_key === r.item_key));
      db.protocol_checks.push({ ...r, note: r.note ?? null, by_email: me.email, at: now });
    }
    return reply(rows);
  }
  if (req.method() === 'POST' && t === 'characterizations') {
    const r = Array.isArray(body) ? body[0] : body;
    const row = { client_id: r.client_id, fields: r.fields, completed_at: r.completed_at ? now : null, completed_by: r.completed_at ? me.email : null, by_email: me.email, at: now };
    db.characterizations = db.characterizations.filter((x) => x.client_id !== r.client_id).concat(row);
    return reply([row]);
  }
  if (req.method() === 'POST' && t === 'client_tasks') {
    const r = Array.isArray(body) ? body[0] : body;
    const row = { due_on: null, done_at: null, done_by_email: null, source: null, brief: null, urgent: false, started_at: null, ...r, id: randomUUID(), created_by_email: me.email, created_at: now };
    db.client_tasks.push(row);
    return reply([row]);
  }
  return json(200, []);
}

// ── Browser ───────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const PHONE = { width: 360, height: 740 };
async function newContext(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, hasTouch: viewport.width < 500, isMobile: viewport.width < 500 });
  await ctx.clock.setFixedTime(NOW);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await ctx.route(`${SUPA}/**`, withClientColumns(fakeSupabase, CLIENT_SHAPE));
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>wa</title>' }));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
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
const shot = async (page, name, opts = {}) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, ...opts }); };
const toastHas = (page, s) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), s);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const text = (page, sel) => page.locator(sel).first().innerText();
const png = (n = 2000) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(n)]);
// A file that starts as an MP4 does (the ftyp box), n bytes in all: uploads are checked by their first bytes.
const mp4 = (n, fill = 0) => Buffer.concat([Buffer.from('000000186674797069736f6d', 'hex'), Buffer.alloc(n - 12, fill)]);
const input = (page, kind, scope = '#files-block') => page.locator(`${scope} [data-kind-btn="${kind}"] input[type=file]`);
const liveFiles = (kind) => db.client_files.filter((f) => f.kind === kind && !f.deleted_at);
// Every field has a name a screen reader reads.
const unlabeled = (page, scope) => page.evaluate((sc) => [...document.querySelectorAll(`${sc} input:not([type=hidden]):not([type=file]), ${sc} textarea, ${sc} select`)]
  .filter((el) => !el.closest('[hidden]') && !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.closest('label') && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
  .map((el) => el.id || el.name), scope);
let passed = 0;
async function step(name, fn) { await fn(); passed += 1; console.log(`ok ${passed} - ${name}`); }

// ── Irit, in the card ─────────────────────
const iritCtx = await newContext();
const irit = await newPage(iritCtx);
let galleryToken = null;

await step('the card has "תיק לקוח": two parts, counts per kind, nothing uploaded yet', async () => {
  await signIn(irit, `client.html?id=${D.id}`, 'irit@astrateg.test');
  await irit.waitForSelector('#files-block .fl-counts span[data-count="logo"]');
  assert.equal(await text(irit, '#files-block h2'), 'תיק לקוח');
  assert.deepEqual(await irit.locator('#files-block .fl-group > h3').allInnerTexts(), ['חומרים מהלקוח', 'תוצרים']);
  assert.equal(await text(irit, '#fl-materials .fl-counts'), 'לוגו 0 · תמונות 0 · סרטונים קיימים 0 · תוספת מותאמת אישית 0');
  assert.match(await text(irit, '#fl-materials'), /עוד לא הועלו חומרים/);
  // Irit uploads every kind.
  for (const k of Object.keys(KINDS)) assert.ok(await irit.locator(`#files-block [data-kind-btn="${k}"]`).isVisible(), k);
});

await step('the logo and two photos: uploaded, counted, previews from signed URLs, who and when', async () => {
  await input(irit, 'logo').setInputFiles({ name: 'Logo Dana.png', mimeType: 'image/png', buffer: png() });
  await toastHas(irit, 'הועלה: לוגו');
  await input(irit, 'image').setInputFiles([
    { name: 'חזית הקפה.jpg', mimeType: 'image/jpeg', buffer: png(3000) },
    { name: 'bar.jpg', mimeType: 'image/jpeg', buffer: png(4000) },
  ]);
  await irit.waitForFunction(() => document.querySelector('#fl-materials [data-count="image"]')?.textContent === 'תמונות 2');
  assert.equal(liveFiles('logo').length, 1);
  const logo = liveFiles('logo')[0];
  assert.match(logo.storage_path, new RegExp(`^${D.id}/logo/[0-9a-f-]{36}-Logo-Dana\\.png$`));
  assert.deepEqual([logo.uploaded_by, logo.mime, logo.size_bytes], ['irit@astrateg.test', 'image/png', 2008]);
  assert.match(liveFiles('image').map((f) => f.storage_path).join(), /-file\.jpg/); // the Hebrew name, made safe
  assert.equal(objects.get(logo.storage_path).via, 'standard');
  // Previews: a signed URL each, loaded once on screen.
  await irit.locator('#fl-materials .fl-item img').first().scrollIntoViewIfNeeded();
  await irit.waitForFunction(() => [...document.querySelectorAll('#fl-materials .fl-item img')].every((i) => i.complete && i.naturalWidth > 0));
  assert.match(await text(irit, '#fl-materials .fl-item .fl-sub'), /עירית/);
  assert.match(await text(irit, '#fl-materials .fl-item .fl-sub'), /יום ג׳, 13\.10 11:40/);
});

await step('a photo over 20MB is refused in Hebrew before anything is sent; a video is not a photo', async () => {
  const before = calls.length;
  await input(irit, 'image').setInputFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(21 * MB) });
  await irit.waitForSelector('#files-block .fl-errs .err');
  assert.equal(await text(irit, '#files-block .fl-errs .err'), '"huge.jpg" גדול מדי (21MB). אפשר להעלות תמונה עד 20MB.');
  await input(irit, 'image').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(100) });
  await irit.waitForFunction(() => /אינו תמונה/.test(document.querySelector('#files-block .fl-errs')?.textContent || ''));
  assert.ok(!calls.slice(before).some((c) => /storage\/v1\/(object\/client-files|upload)/.test(c)), 'nothing uploaded');
});

// Found live (6.10.2026): a 2 KB text file named .mp4 went up as a video and showed in the gallery.
await step('a text file named .mp4 is refused by its content, in Hebrew, before anything is sent; so is a fake .png', async () => {
  const before = calls.length;
  const videos = liveFiles('deliverable_video').length;
  await input(irit, 'deliverable_video').setInputFiles({ name: 'not-a-video.mp4', mimeType: 'video/mp4', buffer: Buffer.from('this is plain text, not a video\n'.repeat(64)) });
  await irit.waitForFunction(() => /אינו סרטון/.test(document.querySelector('#files-block .fl-errs')?.textContent || ''));
  assert.equal(await text(irit, '#files-block .fl-errs .err'), '"not-a-video.mp4" אינו סרטון: התוכן שלו לא תואם לסוג הקובץ. אפשר להעלות MP4, MOV, WebM או M4V.');
  await input(irit, 'deliverable_graphic').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<html>not an image</html>') });
  await irit.waitForFunction(() => /אינו תמונה: התוכן/.test(document.querySelector('#files-block .fl-errs')?.textContent || ''));
  assert.ok(!calls.slice(before).some((c) => /storage\/v1\/(object\/client-files|upload)/.test(c)), 'nothing uploaded');
  assert.equal(liveFiles('deliverable_video').length, videos);
  assert.ok(await noHScroll(irit));
});

await step('a custom addition needs its label', async () => {
  await irit.click('#fl-add-material_other');
  const form = irit.locator('[data-kind-btn="material_other"]');
  await form.locator('.btn-primary').click();
  assert.equal(await form.locator('.err').innerText(), 'כתבו מה זה, כדי שכולם יבינו.');
  await form.locator('input.input').first().fill('תפריט');
  await form.locator('input[type=file]').setInputFiles({ name: 'menu.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5000, 1) });
  await form.locator('.btn-primary').click();
  await toastHas(irit, 'הועלה: תוספת');
  assert.deepEqual(liveFiles('material_other').map((f) => [f.label, f.mime]), [['תפריט', 'application/pdf']]);
});

await step('a 13MB video goes up resumably in 6MB chunks, with progress', async () => {
  const p = input(irit, 'deliverable_video').setInputFiles({ name: 'reel final.mp4', mimeType: 'video/mp4', buffer: mp4(13 * MB, 7) });
  await p;
  await irit.waitForFunction(() => document.querySelector('#fl-deliverables [data-count="deliverable_video"]')?.textContent === 'סרטונים 1', null, { timeout: 30000 });
  const v = liveFiles('deliverable_video')[0];
  assert.deepEqual([objects.get(v.storage_path).via, objects.get(v.storage_path).chunks, v.size_bytes], ['resumable', 3, 13 * MB]);
  // Played on demand from a signed URL.
  await irit.click(`#fl-deliverables [data-kind="deliverable_video"] .fl-play`);
  await irit.waitForSelector('#fl-deliverables video[src*="token="]');
});

await step('graphics and the landing page (a link); "עלה לרשתות בתאריך" is saved', async () => {
  await input(irit, 'deliverable_graphic').setInputFiles([1, 2, 3].map((n) => ({ name: `post-${n}.png`, mimeType: 'image/png', buffer: png(1000 + n) })));
  await irit.waitForFunction(() => document.querySelector('#fl-deliverables [data-count="deliverable_graphic"]')?.textContent === 'גרפיקות 3');
  await irit.click('#fl-add-deliverable_site');
  const site = irit.locator('[data-kind-btn="deliverable_site"]');
  await site.locator('input[type=url]').fill('http://dana.co.il');
  await site.locator('.btn-primary').click();
  assert.equal(await site.locator('.err').innerText(), 'הקישור צריך להתחיל ב־https://');
  await site.locator('input[type=url]').fill('https://dana.co.il/landing');
  await site.locator('.btn-primary').click();
  await toastHas(irit, 'הועלה: אתר / דף נחיתה');
  assert.deepEqual(liveFiles('deliverable_site').map((f) => [f.link, f.mime]), [['https://dana.co.il/landing', 'text/uri-list']]);
  // The day a graphic went up on the networks.
  const g = liveFiles('deliverable_graphic')[0];
  const item = irit.locator(`.fl-item[data-id="${g.id}"]`);
  await item.locator('.fl-post summary').click();
  await item.locator('input[type=date]').fill('2026-10-12');
  await toastHas(irit, 'נשמר: עלה לרשתות');
  assert.equal(g.posted_on, '2026-10-12');
  assert.equal(await text(irit, '#fl-deliverables .fl-counts'), 'גרפיקות 3 · סרטונים 1 · Highlights 0 · אתר / דף נחיתה 1 · אחר 0');
  assert.deepEqual(await unlabeled(irit, '#files-block'), []);
});

await step('deleting a photo (soft): gone from the card and the counts', async () => {
  const f = liveFiles('image')[0];
  await irit.locator(`.fl-item[data-id="${f.id}"] .fl-del`).click();
  await toastHas(irit, 'נמחק');
  assert.ok(f.deleted_at);
  assert.equal(await text(irit, '#fl-materials [data-count="image"]'), 'תמונות 1');
  await irit.locator('#files-block .fl-item img').last().scrollIntoViewIfNeeded();
  await irit.waitForFunction(() => [...document.querySelectorAll('#files-block .fl-item img')].every((i) => i.complete && i.naturalWidth > 0));
  if (OUT) await irit.locator('#files-block').screenshot({ path: `${OUT}/01-card-files.png` });
});

await step('the client\'s gallery link: Irit creates it and copies a ready WhatsApp message', async () => {
  await irit.click('#fl-gal-create');
  await toastHas(irit, 'נוצר קישור לגלריה');
  await irit.waitForSelector('#fl-gal-copy-msg');
  const l = db.client_gallery_links[0];
  galleryToken = vault.get(l.id);
  // A year ahead: the date carries its year (found live: "עד יום ג׳ 5.10" meant 2027).
  assert.match(await text(irit, '#fl-gal-state'), /קישור פעיל עד יום [א-ש]׳ \d{1,2}\.\d{1,2}\.2027 · עוד לא נפתח/);
  await irit.click('#fl-gal-copy-msg');
  await toastHas(irit, 'הועתק');
  // (Windows' clipboard gives the lines back with \r\n.)
  const msg = (await irit.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  assert.equal(msg, galleryMessage(D, `${BASE}gallery.html#t=${galleryToken}`)); // after #: it reaches no log of the host (ops.md 36)
  const wa = await irit.getAttribute('#fl-gal-wa', 'href');
  assert.ok(wa.startsWith('https://wa.me/972501112222?text='), wa);
  await shot(irit, '02-card-gallery-link', { fullPage: false, clip: await irit.locator('.fl-gallery').boundingBox() });
});

// ── The client ────────────────────────────
const clientCtx = await newContext(PHONE);
const cl = await newPage(clientCtx);

await step('the client opens the gallery on a 360px phone: the deliverables, nothing internal', async () => {
  await cl.goto(`${BASE}gallery.html#t=${galleryToken}`); // the link as it is made now; a ?t= link sent before still opens (the revoked one, below)
  await cl.waitForSelector('#page:not([hidden])');
  assert.equal(await text(cl, '#hello-h'), 'התוצרים של קפה דנה');
  assert.deepEqual(await cl.locator('.gsec h2').allInnerTexts(), ['גרפיקות (3)', 'סרטונים (1)', 'אתר / דף נחיתה (1)']);
  const all = await cl.evaluate(() => document.body.innerText);
  for (const bad of ['עירית', 'irit@', 'נדיה', 'הערה פנימית', 'post-1', 'reel', 'Logo', 'תפריט']) assert.ok(!all.includes(bad), bad);
  assert.match(all, /עלה לרשתות יום ב׳ 12\.10/);
  assert.equal(await cl.getAttribute('.grow .gopen', 'href'), 'https://dana.co.il/landing');
  assert.equal(await cl.locator('.gsec .gdl').count(), 4); // 3 graphics and the video; the site link has no file
  await cl.waitForFunction(() => [...document.querySelectorAll('.gthumb img')].every((i) => i.complete && i.naturalWidth > 0));
  assert.ok(await noHScroll(cl), 'no sideways scroll at 360px');
  for (const b of await cl.locator('.gthumb, .gdl, .gchip').all()) assert.ok((await b.boundingBox()).height >= 44);
  assert.equal(db.client_gallery_links[0].open_count, 1);
  await shot(cl, '03-gallery-360');
  await cl.click('.gvideo');
  await cl.waitForSelector('#viewer[open] video[src*="token="]');
  await shot(cl, '04-gallery-video-360', { fullPage: false });
  await cl.click('#viewer-close');
});

await step('the status page shows the graphics next to the approval of the first 9', async () => {
  // Irit makes the status link in the card (stage 4); the client opens it.
  await irit.click('#st-create');
  await irit.waitForSelector('#st-copy-msg');
  const l = db.client_status_links.at(-1);
  await cl.goto(`${BASE}status.html?t=${vault.get(l.id)}`);
  await cl.waitForSelector('#page:not([hidden])');
  await cl.waitForSelector('#item-p07-approved .sgfx:not([hidden]) img');
  assert.equal(await cl.locator('#item-p07-approved .sgfx img').count(), 3);
  assert.match(await text(cl, '#item-p07-approved .sgfx-h'), /^הגרפיקות \(3\)/);
  assert.equal(await cl.getAttribute('#item-p07-approved .sgfx img >> nth=0', 'alt'), 'גרפיקה 1 מתוך 3');
  await cl.waitForFunction(() => [...document.querySelectorAll('.sgfx img')].every((i) => i.complete && i.naturalWidth > 0));
  assert.ok(await noHScroll(cl));
  await shot(cl, '05-status-graphics-360');
});

// ── Nadia, the editor ─────────────────────
await step('Nadia (the editor): sees the files, uploads only videos, deletes nothing of Irit\'s, no gallery link', async () => {
  const ctx = await newContext(PHONE);
  const n = await newPage(ctx);
  await signIn(n, `client.html?id=${D.id}`, 'nadia@astrateg.test');
  await n.waitForSelector('#files-block .fl-item');
  const visible = [];
  for (const k of Object.keys(KINDS)) if (await n.locator(`#files-block [data-kind-btn="${k}"]`).isVisible()) visible.push(k);
  assert.deepEqual(visible, ['deliverable_video']);
  assert.equal(await n.locator('#files-block .fl-del').count(), 0);
  assert.equal(await n.locator('.fl-gallery > *').count(), 0);
  // Found live: the word "null" under a file she cannot edit (a graphic with no posting day).
  assert.ok(await n.locator('#files-block .fl-item[data-id]').count() >= 3);
  assert.doesNotMatch(await text(n, '#files-block'), /null|undefined/);
  await input(n, 'deliverable_video').setInputFiles({ name: 'v2.mp4', mimeType: 'video/mp4', buffer: mp4(2 * MB, 1) });
  await n.waitForFunction(() => document.querySelector('#fl-deliverables [data-count="deliverable_video"]')?.textContent === 'סרטונים 2');
  assert.equal(liveFiles('deliverable_video').at(-1).uploaded_by, 'nadia@astrateg.test');
  // Her own video: she may delete it.
  assert.equal(await n.locator('#files-block .fl-del').count(), 1);
  assert.ok(await noHScroll(n));
  if (OUT) await n.locator('#files-block').screenshot({ path: `${OUT}/06-card-editor-360.png` });
  await ctx.close();
});

// ── Ofir, at the meeting ──────────────────
await step('Ofir uploads a photo from the characterization form on the phone: in the files, photos marked received', async () => {
  const ctx = await newContext(PHONE);
  const o = await newPage(ctx);
  await signIn(o, `intake.html?id=${D.id}#form`, 'ofir@astrateg.test');
  await o.waitForSelector('#files-materials [data-kind-btn="image"]:not([hidden])');
  assert.equal(await o.locator('#files-materials [data-kind-btn^="deliverable"]').count(), 0);
  await o.locator('#files-materials [data-kind-btn="image"] input[type=file]').setInputFiles({ name: 'IMG_0042.HEIC', mimeType: 'image/heic', buffer: png(5000) });
  await o.waitForFunction(() => document.querySelector('#files-materials [data-count="image"]')?.textContent === 'תמונות 2');
  assert.equal(liveFiles('image').at(-1).uploaded_by, 'ofir@astrateg.test');
  await o.waitForFunction(() => document.querySelector('input[name="form-mat-photos"][value="got"]')?.checked === true);
  assert.ok(await noHScroll(o));
  assert.deepEqual(await unlabeled(o, '#files-materials'), []);
  await o.locator('#files-materials').scrollIntoViewIfNeeded();
  await shot(o, '07-intake-materials-360');
  await ctx.close();
});

// ── Revoked ───────────────────────────────
await step('Irit revokes the gallery link: the client gets a friendly message', async () => {
  await irit.click('#fl-gal-revoke');
  await toastHas(irit, 'קישור הגלריה בוטל');
  await irit.waitForSelector('#fl-gal-create');
  await cl.goto(`${BASE}gallery.html?t=${galleryToken}`);
  await cl.waitForSelector('#state h1');
  assert.equal(await text(cl, '#state h1'), 'הקישור הזה כבר לא פעיל');
  await cl.goto(`${BASE}gallery.html?t=abc`);
  await cl.waitForSelector('#state h1');
  assert.equal(await text(cl, '#state h1'), 'הקישור אינו תקין');
  assert.ok(await noHScroll(cl));
});

await clientCtx.close();
await iritCtx.close();
await browser.close();
noCspViolations();
assert.deepEqual(errors, [], errors.join('\n'));
console.log(`files e2e: ${passed} steps passed`);
