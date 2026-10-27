// End-to-end check of the owner's requests of 27.10.2026, against an in-memory fake of
// Supabase (the database and Storage; the fake of tests/files-e2e.mjs, with the clients'
// insert and the agreements' facts), the browser's clock fixed on Tuesday 13.10.2026 11:40:
//   - "לקוח חדש" for Lior and Ofir (and still the owner and Irit; not Ilai): Ofir opens a
//     client by hand and attaches the signed contract's PDF, which lands in the client's
//     files as "חוזה חתום" and in the card under "החוזה והחבילה"; Lior opens one from an
//     agreement signed in the system (the file's field steps aside); a Word file is refused;
//     Irit adds a contract's file from the card;
//   - the characterization at any time: "אפיון חדש" (the client picked by words, in any
//     order), the form alone ("אפיון" / "עדכון אפיון" in the card), saved with no mark in the
//     protocol and no task; Ilai has neither;
//   - every new text field typed key by key, with deletions, in Chromium and in WebKit as an
//     iPhone 13; 390px screenshots of every changed screen, no sideways scrolling.
// Run: npx http-server -p 5515 -s -c-1 . &  then  BASE_URL=http://localhost:5515/ node tests/batch-2710-e2e.mjs [outDir]
import { openCardFolds } from './open-folds.mjs';
import { chromium, webkit, devices } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { withClientColumns } from './fake-clients.mjs';
import { uploadKinds, isManager, galleryMessage, KINDS, GALLERY_KINDS } from '../app/files-logic.js';

const BASE = process.env.BASE_URL || 'http://localhost:5515/';
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
    // The agreements' facts, without their money (public.quote_facts): the office.
    if (rpc === 'quote_facts') return isOffice(me) ? json(200, db.quotes.filter((q) => !body.p_ids || body.p_ids.includes(q.id))) : json(200, []);
    return json(200, null);
  }

  // ── Tables ──
  const t = /^\/rest\/v1\/(\w+)$/.exec(p)?.[1];
  if (t && !db[t]) db[t] = []; // the other tables of the lists' pages: empty
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
  // "office adds clients": the office adds a client (the database stamps who and when).
  if (t === 'clients' && req.method() === 'POST') {
    if (!isOffice(me)) return rls();
    const r = Array.isArray(body) ? body[0] : body;
    const row = {
      ...Object.fromEntries(Object.keys(D).map((k) => [k, null])), links: {}, deliverables: {}, rounds: [], characterizer: 'ofir', status: 'active',
      ...r, id: randomUUID(), created_at: now, created_by_email: me.email, deal_at: r.deal_at || now,
    };
    db.clients.push(row);
    return reply([row]);
  }
  if (req.method() === 'POST' && t === 'protocol_checks') {
    const rows = Array.isArray(body) ? body : [body];
    const out = [];
    for (const r of rows) {
      db.protocol_checks = db.protocol_checks.filter((x) => !(x.client_id === r.client_id && x.item_key === r.item_key));
      const row = { ...r, note: r.note ?? null, by_email: me.email, at: now };
      db.protocol_checks.push(row);
      out.push(row);
    }
    return single ? reply(out) : json(200, out);
  }
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
const PHONE_DEVICE = null;
const errors = [];
const PHONE = { width: 360, height: 740 };
// opts.browserType / opts.device: WebKit as an iPhone 13 (devices['iPhone 13']).
async function newContext(viewport = { width: 1280, height: 900 }, { browserType = browser, device = PHONE_DEVICE } = {}) {
  const ctx = await browserType.newContext(device ? { ...device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' }
    : { locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, hasTouch: viewport.width < 500, isMobile: viewport.width < 500 });
  await ctx.clock.setFixedTime(NOW);
  await openCardFolds(ctx); // the card's closed rows, opened (the owner, 20.10.2026)
  if (browserType === browser) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await ctx.route(`${SUPA}/**`, withClientColumns(fakeSupabase, CLIENT_SHAPE));
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>wa</title>' }));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  // WebKit reports a fetch cut short by closing or leaving the page as a CORS failure: the harness's, not the app's.
  page.on('pageerror', (e) => { if (!/due to access control checks/.test(String(e))) errors.push(String(e)); });
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource|due to access control checks/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, path, email) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app:not([hidden])');
  // The sign-in screen fades out before the screenshots.
  await page.waitForSelector('#login-block', { state: 'hidden' });
  if (OUT) await page.waitForTimeout(1200);
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


// ── This suite's world ────────────────────
// An agreement signed in the system and not opened yet (public.quote_facts answers the office).
const QUOTE = {
  id: 'eeeeeeee-0000-4000-8000-000000000050', number: 'AST-2026-050', status: 'signed', signed_at: '2026-10-12T15:00:00+03:00',
  client_name: 'יוסי מזרחי', client: { company: 'פיצה יוסי', phone: '052-3334444', email: null },
  package_id: 'social-natali', tier: 'Social', influencer: 'נטלי דדון', selection: null, term_months: 12,
};
db.quotes.push(QUOTE);
const pdf = (n = 3000) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(n)]);
const contractRows = (cid) => db.client_files.filter((f) => f.client_id === cid && f.kind === 'material_other' && f.label === 'חוזה חתום' && !f.deleted_at);

// Typed key by key (as a phone's keyboard sends it), a few keys taken back and typed again.
async function typeKeys(page, sel, value, back = 3) {
  const el = page.locator(sel);
  await el.click();
  await el.pressSequentially(value, { delay: 12 });
  for (let i = 0; i < back; i += 1) await page.keyboard.press('Backspace');
  assert.equal(await el.inputValue(), value.slice(0, -back), `${sel} after deleting`);
  await el.pressSequentially(value.slice(-back), { delay: 12 });
  assert.equal(await el.inputValue(), value, sel);
}
// Everything typed in a field, taken back key by key.
async function clearKeys(page, sel) {
  const el = page.locator(sel);
  const n = (await el.inputValue()).length;
  await el.focus();
  await page.keyboard.press('End');
  for (let i = 0; i < n; i += 1) await page.keyboard.press('Backspace');
  assert.equal(await el.inputValue(), '', `${sel} emptied`);
}
const PHONE390 = { width: 390, height: 844 };

// ── Ilai: neither ─────────────────────────
await step('Ilai: no "לקוח חדש" and no "אפיון חדש"; no "אפיון" in the card; the form alone is not his', async () => {
  const ctx = await newContext(PHONE390);
  const p = await newPage(ctx);
  await signIn(p, 'clients.html#clients', 'ilai@astrateg.test');
  await p.goto(`${BASE}clients.html#clients`);
  await p.waitForSelector('#app:not([hidden])');
  assert.equal(await p.isHidden('#btn-new'), true);
  assert.equal(await p.isHidden('#cta-char'), true);
  await p.goto(`${BASE}client.html?id=${D.id}`);
  await p.waitForSelector('#cc-head h1');
  await p.waitForSelector('#ik-sum-h');
  assert.equal(await p.locator('#ik-char-edit').count(), 0);
  await p.goto(`${BASE}intake.html?id=${D.id}&only=char`);
  await p.waitForFunction(() => /עדכון האפיון פתוח לבעלים, לעירית, לליאור ולאופיר/.test(document.getElementById('state')?.textContent || ''));
  await ctx.close();
});

// ── Ofir: "לקוח חדש" with the contract's file ──
let avi = null;
await step('Ofir opens a client by hand on the phone and attaches the signed contract\'s PDF (a Word file is refused); it lands in the files and in the card', async () => {
  const ctx = await newContext(PHONE390);
  const p = await newPage(ctx);
  await signIn(p, 'clients.html#clients', 'ofir@astrateg.test');
  await p.goto(`${BASE}clients.html#clients`);
  await p.waitForSelector('#app:not([hidden])');
  assert.equal(await p.isVisible('#btn-new'), true, '"לקוח חדש" is Ofir\'s too');
  assert.equal(await p.isVisible('#cta-char'), true, '"אפיון חדש"');
  assert.ok(await noHScroll(p));
  await shot(p, 'b01-clients-head-ofir-390', { fullPage: false });
  await p.click('#btn-new');
  await p.waitForSelector('#from-quote-field:not([hidden])');
  assert.equal(await p.innerText('#new-file-label'), 'או קובץ חוזה חתום (PDF או תמונה)');
  await typeKeys(p, '#new-name', 'אבי כהן');
  await typeKeys(p, '#new-business', 'מספרת אבי');
  await typeKeys(p, '#new-phone', '0501234567', 2);
  await p.selectOption('#new-shoot-type', 'natali');
  // A Word file is not the contract: said before anything is opened.
  await p.setInputFiles('#new-contract-file', { name: 'contract.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.alloc(500) });
  assert.match(await p.innerText('#new-file-hint'), /PDF או תמונה בלבד/);
  const before = db.clients.length;
  await p.click('#new-submit');
  await p.waitForSelector('#new-err:not([hidden])');
  assert.match(await p.innerText('#new-err'), /PDF או תמונה בלבד/);
  assert.equal(db.clients.length, before, 'no client opened');
  await p.setInputFiles('#new-contract-file', { name: 'חוזה אבי.pdf', mimeType: 'application/pdf', buffer: pdf() });
  assert.match(await p.innerText('#new-file-hint'), /נבחר: חוזה אבי\.pdf/);
  assert.equal(await p.isHidden('#new-err'), true);
  assert.deepEqual(await unlabeled(p, '#dlg-new'), []);
  assert.ok(await noHScroll(p));
  await shot(p, 'b02-new-client-contract-390');
  await p.click('#new-submit');
  await p.waitForURL(/client\.html\?id=/);
  avi = db.clients.find((c) => c.name === 'אבי כהן');
  assert.ok(avi, 'the client opened');
  assert.deepEqual([avi.business, avi.created_by_email, avi.quote_id ?? null], ['מספרת אבי', 'ofir@astrateg.test', null]);
  const files = contractRows(avi.id);
  assert.equal(files.length, 1);
  assert.equal(files[0].uploaded_by, 'ofir@astrateg.test');
  assert.match(files[0].storage_path, new RegExp(`^${avi.id}/material_other/[0-9a-f-]{36}-`));
  assert.ok(objects.has(files[0].storage_path), 'the object is in the bucket');
  // The card: "החוזה החתום" under "החוזה והחבילה", with the file.
  await p.waitForSelector('#cd-h');
  await p.waitForSelector('#contract-docs .cd-row');
  assert.match(await p.innerText('#contract-docs'), /קובץ חוזה חתום[^]*\.pdf[^]*הועלה 13\.10\.2026/);
  assert.equal(await p.isVisible('#cd-add'), true);
  assert.ok(await noHScroll(p));
  const small = await p.locator('#contract-docs button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
  assert.equal(small, 0, '44px targets');
  await p.locator('#fold-contract').scrollIntoViewIfNeeded();
  if (OUT) await p.locator('#fold-contract').screenshot({ path: `${OUT}/b03-card-contract-file-390.png` });
  // "הורדה": a signed address of the file.
  const signs = () => calls.filter((c) => c.startsWith('POST /storage/v1/object/sign/client-files/')).length;
  const before2 = signs();
  await p.click('#contract-docs .cd-get');
  for (let i = 0; i < 50 && signs() === before2; i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.equal(signs(), before2 + 1, 'the download asks for a signed address');
  await ctx.close();
});

// ── Lior: "לקוח חדש" from an agreement signed in the system ──
await step('Lior opens a client from an agreement signed in the system: the file\'s field steps aside; the card names the agreement', async () => {
  const ctx = await newContext(PHONE390);
  const p = await newPage(ctx);
  await signIn(p, 'clients.html#clients', 'lior@astrateg.test');
  await p.goto(`${BASE}clients.html#clients`);
  await p.waitForSelector('#app:not([hidden])');
  assert.equal(await p.isVisible('#btn-new'), true, '"לקוח חדש" is Lior\'s too');
  await p.click('#btn-new');
  await p.waitForSelector('#from-quote-field:not([hidden])');
  await p.selectOption('#new-quote', QUOTE.id);
  assert.equal(await p.inputValue('#new-name'), 'יוסי מזרחי');
  assert.equal(await p.isHidden('#new-file-field'), true, 'an agreement in the system is the contract');
  await shot(p, 'b04-new-client-quote-390');
  // Back to no agreement: the file's field again.
  await p.selectOption('#new-quote', '');
  assert.equal(await p.isVisible('#new-file-field'), true);
  await p.selectOption('#new-quote', QUOTE.id);
  await p.click('#new-submit');
  await p.waitForURL(/client\.html\?id=/);
  const yossi = db.clients.find((c) => c.name === 'יוסי מזרחי');
  assert.equal(yossi.quote_id, QUOTE.id);
  assert.equal(yossi.created_by_email, 'lior@astrateg.test');
  assert.deepEqual(db.protocol_checks.filter((x) => x.client_id === yossi.id).map((x) => x.item_key).sort(), ['p01.prepared', 'p01.sent', 'p01.signed']);
  assert.equal(contractRows(yossi.id).length, 0);
  await p.waitForSelector('#cd-quote');
  assert.match(await p.innerText('#cd-quote'), /הסכם שנחתם במערכת[^]*AST-2026-050[^]*נחתם 12\.10\.2026/);
  await p.locator('#fold-contract').scrollIntoViewIfNeeded();
  if (OUT) await p.locator('#fold-contract').screenshot({ path: `${OUT}/b05-card-contract-quote-390.png` });
  await ctx.close();
});

// ── Irit: a contract's file from the card ──
await step('Irit adds a contract\'s picture from the card; it is in the client\'s files as well', async () => {
  const ctx = await newContext(PHONE390);
  const p = await newPage(ctx);
  await signIn(p, `client.html?id=${D.id}`, 'irit@astrateg.test');
  await p.waitForSelector('#contract-docs');
  await p.waitForSelector('#cd-none');
  assert.equal(await p.innerText('#cd-none'), 'לא צורף חוזה חתום ללקוח.');
  await p.setInputFiles('#cd-file', { name: 'scan.jpg', mimeType: 'image/jpeg', buffer: png(3000) });
  await toastHas(p, 'קובץ החוזה נשמר');
  await p.waitForSelector('#contract-docs .cd-row');
  assert.equal(contractRows(D.id).length, 1);
  assert.equal(contractRows(D.id)[0].uploaded_by, 'irit@astrateg.test');
  assert.equal(await p.innerText('#cd-add'), 'העלאת קובץ חוזה נוסף');
  // And in "תיק לקוח", among the materials (a custom addition named "חוזה חתום").
  await p.waitForFunction(() => /חוזה חתום/.test(document.querySelector('#fl-materials')?.textContent || ''));
  await ctx.close();
});

// ── Ofir: "אפיון חדש" and the form alone ──
await step('"אפיון חדש": Ofir finds the client by two words in any order (typed and taken back key by key), and fills the form alone: saved, no mark, no task', async () => {
  const ctx = await newContext(PHONE390);
  const p = await newPage(ctx);
  await signIn(p, 'clients.html#clients', 'ofir@astrateg.test');
  await p.goto(`${BASE}clients.html#clients`);
  await p.waitForSelector('#cta-char:not([hidden])');
  await p.click('#cta-char');
  await p.waitForURL(/intake\.html$/);
  await p.waitForSelector('#pk-list li');
  assert.equal(await p.isHidden('#ik-tabs'), true);
  const all = await p.locator('#pk-list li').count();
  assert.ok(all >= 3, `${all} clients`);
  await typeKeys(p, '#pk-search', 'דנה קפה', 2);
  await p.waitForFunction(() => document.querySelectorAll('#pk-list li').length === 1);
  assert.match(await p.innerText('#pk-list'), /קפה דנה · דנה לוי[^]*אפיון חדש/);
  assert.equal(await p.innerText('#pk-count'), 'לקוח אחד.');
  assert.ok(await noHScroll(p));
  await shot(p, 'b06-char-pick-390');
  await clearKeys(p, '#pk-search');
  await p.waitForFunction((n) => document.querySelectorAll('#pk-list li').length === n, all);
  await typeKeys(p, '#pk-search', 'אין כזה', 2);
  await p.waitForFunction(() => document.getElementById('pk-count')?.textContent === 'אין לקוח בשם הזה.');
  await clearKeys(p, '#pk-search');
  await typeKeys(p, '#pk-search', 'לוי', 1);
  await p.click(`#pk-${D.id}`);
  await p.waitForURL(new RegExp(`intake\\.html\\?id=${D.id}&only=char$`));
  await p.waitForSelector('#form-form');
  assert.equal(await p.innerText('#form-h'), 'אפיון');
  assert.equal(await p.isHidden('#ik-tabs'), true, 'no tabs: the form alone');
  assert.equal(await p.locator('#form-blocking').count(), 0, 'nothing rings');
  assert.match(await p.innerText('#form-only'), /בלי שעונים ובלי סימונים בפרוטוקול/);
  const checksBefore = db.protocol_checks.length;
  await typeKeys(p, '#form-services', 'תספורות גברים וזקן');
  await typeKeys(p, '#form-colors', 'שחור וזהב', 2);
  assert.ok(await noHScroll(p));
  await shot(p, 'b07-char-only-390');
  await p.click('#form-save');
  await toastHas(p, 'האפיון נשמר בתיק הלקוח');
  const row = db.characterizations.find((x) => x.client_id === D.id);
  assert.equal(row.fields.services, 'תספורות גברים וזקן');
  assert.equal(row.fields.colors, 'שחור וזהב');
  assert.equal(row.by_email, 'ofir@astrateg.test');
  assert.equal(db.protocol_checks.length, checksBefore, 'no mark in the protocol');
  assert.equal(db.client_tasks.length, 0, 'no task');
  await p.waitForFunction(() => document.getElementById('form-h')?.textContent === 'עדכון אפיון');
  // The card: "עדכון אפיון", back to the same form.
  await p.goto(`${BASE}client.html?id=${D.id}`);
  await p.waitForSelector('#ik-char-edit');
  assert.equal(await p.innerText('#ik-char-edit'), 'עדכון אפיון');
  assert.equal(await p.getAttribute('#ik-char-edit', 'href'), `intake.html?id=${D.id}&only=char`);
  await p.locator('#ik-char-edit').scrollIntoViewIfNeeded();
  if (OUT) await p.locator('.ik-summary').screenshot({ path: `${OUT}/b08-card-char-button-390.png` });
  // Back on "אפיון חדש": the client now has one.
  await p.goto(`${BASE}intake.html`);
  await p.waitForSelector(`#pk-${D.id}`);
  assert.match(await p.innerText(`#pk-${D.id}`), /עדכון אפיון/);
  await ctx.close();
});

// ── WebKit, as an iPhone 13: the new fields, key by key ──
// Each screen in a context of its own, signed in before the page opens (the session kept as the
// app keeps it): the fake answers WebKit's CORS checks per context, and WebKit remembers one cut
// short by leaving a page (the harness's matter; the live site's CORS is Supabase's).
async function iphone(wk, who, path) {
  const ctx = await newContext(null, { browserType: wk, device: devices['iPhone 13'] });
  const u = users.get(who);
  const session = { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u };
  await ctx.addInitScript((s) => { try { if (!localStorage.getItem('sb-czncjzziqrqtezpwxxpz-auth-token')) localStorage.setItem('sb-czncjzziqrqtezpwxxpz-auth-token', s); } catch { /* none */ } }, JSON.stringify(session));
  const p = await newPage(ctx);
  await p.goto(`${BASE}${path}`);
  await p.waitForSelector('#app:not([hidden])');
  if (OUT) await p.waitForTimeout(800);
  return { ctx, p };
}
await step('WebKit (iPhone 13): "לקוח חדש", the client search and the form alone take typing and deleting key by key', async () => {
  const wk = await webkit.launch();
  // "לקוח חדש": the name, the business (all of it taken back and typed again), the contract's file.
  {
    const { ctx, p } = await iphone(wk, 'ofir@astrateg.test', 'clients.html#clients');
    await p.waitForSelector('#btn-new:not([hidden])');
    await p.click('#btn-new');
    await p.waitForSelector('#dlg-new[open]');
    await typeKeys(p, '#new-name', 'שרית לוי');
    await typeKeys(p, '#new-business', 'סטודיו שרית');
    await clearKeys(p, '#new-business');
    await typeKeys(p, '#new-business', 'סטודיו שרית', 2);
    await p.setInputFiles('#new-contract-file', { name: 'contract.pdf', mimeType: 'application/pdf', buffer: pdf() });
    assert.match(await p.innerText('#new-file-hint'), /נבחר: contract\.pdf/);
    assert.ok(await noHScroll(p));
    await shot(p, 'b09-webkit-new-client');
    await ctx.close();
  }
  // "אפיון חדש": two words in any order.
  {
    const { ctx, p } = await iphone(wk, 'ofir@astrateg.test', 'intake.html');
    await p.waitForSelector('#pk-list li');
    await typeKeys(p, '#pk-search', 'אבי מספרת', 2);
    await p.waitForFunction(() => document.querySelectorAll('#pk-list li').length === 1);
    assert.equal(await p.getAttribute('#pk-list a', 'href'), `intake.html?id=${avi.id}&only=char`);
    await clearKeys(p, '#pk-search');
    await p.waitForFunction(() => document.querySelectorAll('#pk-list li').length > 1);
    await typeKeys(p, '#pk-search', 'אבי מספרת', 2);
    await shot(p, 'b10-webkit-char-pick');
    await ctx.close();
  }
  // The form alone.
  {
    const { ctx, p } = await iphone(wk, 'ofir@astrateg.test', `intake.html?id=${avi.id}&only=char`);
    await p.waitForSelector('#form-form');
    await typeKeys(p, '#form-services', 'עיצוב שיער');
    await clearKeys(p, '#form-services');
    await typeKeys(p, '#form-services', 'עיצוב שיער וצבע', 2);
    assert.ok(await noHScroll(p));
    await shot(p, 'b11-webkit-char-only');
    await p.click('#form-save');
    await toastHas(p, 'האפיון נשמר בתיק הלקוח');
    assert.equal(db.characterizations.find((x) => x.client_id === avi.id)?.fields.services, 'עיצוב שיער וצבע');
    await ctx.close();
  }
  await wk.close();
});

await browser.close();
noCspViolations();
assert.deepEqual(errors, [], errors.join('\n'));
console.log(`batch-2710 e2e: ${passed} steps passed`);
