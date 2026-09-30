// End-to-end check of the client's side (stage 4) against an in-memory fake of
// Supabase, with the browser's clock fixed on Tuesday 13.10.2026 at 11:40 in Israel
// (the shoot was yesterday; the videos went to the client this morning):
//   - Irit makes the client's status link in the card, copies the ready WhatsApp
//     message with it, and sees whether the client agreed to WhatsApp updates;
//   - the client opens the link on a 360px phone: the stations, the promised dates,
//     "מה אנחנו צריכים ממך", the team, the links, the response times, the privacy
//     note and the accessibility statement, and nothing internal;
//   - approves the first 9 graphics (the exact words shown are what is stored; the
//     protocol item is marked), asks for a fix on the videos (a task for the editor,
//     the protocol's notes marked), answers the shoot-day question with 2 (a task for
//     Lior; the reminder rules ring Lior and the owner, once);
//   - the card shows the views, the approvals and the score; Irit revokes the link and
//     the client gets a friendly message; so do an expired and a malformed link.
// Run: npx http-server -p 8131 -s . &  then  BASE_URL=http://localhost:8131/ node tests/status-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { importKeys } from '../app/client-open.js';
import { dayKeyIL } from '../app/tz.js';
import { wordingFor, QUESTIONS, lowScore, severeScore } from '../app/status-logic.js';
import { computeReminders } from '../app/reminder-engine.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-10-13T11:40:00+03:00'); // Tuesday
const serverNow = () => new Date(NOW);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;

// ── People ────────────────────────────────
const people = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', nadia: 'nadia' };
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: person !== 'nadia', phone: null }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => staff.find((r) => r.email === u?.email)?.person ?? undefined;
const isOffice = (u) => { const p = personOf(u); return p === null || ['irit', 'lior', 'ofir', 'ilai'].includes(p); };
const canManage = (u) => { const p = personOf(u); return p === null || ['irit', 'lior'].includes(p); };

// ── The client ────────────────────────────
const QUOTE = randomUUID();
const D = {
  id: 'dddddddd-0000-4000-8000-000000000001', name: 'דנה לוי', business: 'קפה דנה', address: 'הרצל 1, חיפה', phone: '050-1112222',
  package_name: 'Social · דניס, מישל וסמיון', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, editor_name: null, editor: 'nadia',
  deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-10-01T10:00:00+03:00', shoot_at: '2026-10-12T11:00:00+03:00', contract_end: '2027-10-01',
  status: 'active', notes: 'הערה פנימית: לקוחה רגישה למחיר', quote_id: QUOTE, created_at: '2026-09-01T09:00:00+03:00', created_by_email: 'irit@astrateg.test',
  links: { drive: 'https://drive.google.com/dana', metricool: 'https://app.metricool.com/dana', whatsapp: 'https://chat.whatsapp.com/xyz' },
  deliverables: { videos: 25 }, rounds: [], verified_at: null, verified_by: null, closed_reason: null,
};
const IMPORT_AT = '2026-10-01T09:00:00+03:00';
const check = (key, note = null, at = '2026-10-13T09:00:00+03:00', by = 'irit@astrateg.test') => ({ client_id: D.id, item_key: key, state: 'done', note, by_email: by, at });
const db = {
  staff,
  clients: [D],
  protocol_checks: [
    ...importKeys('post').filter((k) => k !== 'p07.approved').map((k) => check(k, 'ייבוא', IMPORT_AT)),
    check('p22a.assigned', null, '2026-10-12T15:00:00+03:00', 'ofir@astrateg.test'),
    check('p25.approved', null, '2026-10-13T08:30:00+03:00', 'ofir@astrateg.test'),
    check('p25.return.1', '{"issues":[{"text":"בעיה פנימית בסרטון 2"}]}', '2026-10-13T08:00:00+03:00', 'ofir@astrateg.test'),
    check('p26.sent'),
  ],
  client_tasks: [], protocol_log: [], client_access: [], client_access_log: [], client_status_notes: [], office_reviews: [],
  quotes: [{ id: QUOTE, number: 'AST-2026-0007', status: 'signed', client_name: 'דנה לוי', signed_at: '2026-09-01T09:00:00+03:00', model: { docTitle: 'הסכם' } }],
  client_messages: [{ id: randomUUID(), client_id: D.id, kind: 'thursday', template_key: 'thursday', ref: null, body: 'היי דנה, העדכון השבועי שלנו:\nמה עשינו השבוע: צילמנו.', sent_by_email: 'irit@astrateg.test', sent_at: '2026-10-08T12:00:00+03:00' }],
  message_templates: [], client_questions: [], client_date_changes: [], reminder_log: [], push_subscriptions: [], characterizations: [], content_briefs: [],
  client_status_links: [], client_status_views: [], client_approvals: [], client_surveys: [],
  client_consents: [{ quote_id: QUOTE, kind: 'whatsapp', given: true, at: '2026-09-01T09:00:00+03:00', phone: '050-1112222', version: 'whatsapp-v1-2026-09-30', revoked_at: null, revoked_via: null }],
};
const tokens = new Map(); // token hash -> link id (the fake's Vault: link id -> token)
const vault = new Map();
const hash = (t) => createHash('sha256').update(t).digest('hex');
const OFFICE_TABLES = new Set(['client_status_links', 'client_status_views', 'client_approvals', 'client_surveys', 'client_consents']);

// ── The page's functions, as the migration defines them ──
const checkOf = (key) => db.protocol_checks.find((x) => x.client_id === D.id && x.item_key === key) || null;
const doneOf = (key) => ['done', 'na'].includes(checkOf(key)?.state);
function linkOf(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ''))) return { reason: 'invalid' };
  const l = db.client_status_links.find((x) => x.token_hash === hash(token));
  if (!l) return { reason: 'invalid' };
  if (l.revoked_at) return { reason: 'revoked' };
  if (new Date(l.expires_at) <= serverNow()) return { reason: 'expired' };
  if (!['active', 'ending'].includes(D.status)) return { reason: 'closed' };
  return { link: l };
}
const SPECS = [['graphics9', 'p07.sent', 'p07.approved'], ['scripts', null, 'p13.approved'], ['graphics', 'p23.sent', 'p23.approved'], ['videos', 'p26.sent', 'p27.approved']];
function items() {
  const out = [];
  for (const [item, sent, key] of SPECS) {
    const sentAt = sent ? (checkOf(sent)?.state === 'done' ? checkOf(sent).at : null)
      : (['p12.scripts', 'p12.numbered', 'p12.docs'].every(doneOf) ? checkOf('p12.docs').at : null);
    if (!doneOf(key) && !sentAt) continue;
    let used = db.client_approvals.filter((a) => a.item_key === key && a.decision === 'fix').length;
    let fixing = db.client_tasks.some((t) => t.source === 'client_fix' && !t.done_at && t.brief?.item_key === key);
    if (item === 'videos') {
      const notes = checkOf('p27.notes');
      const fixed = doneOf('p27.fixes') || checkOf('p27.final')?.state === 'done';
      if (notes && notes.note !== 'ייבוא' && !String(notes.note).includes('"via":"status"')) used += 1;
      fixing ||= !!notes && !fixed;
    }
    out.push({ item, key, shootRound: 1, state: doneOf(key) ? 'approved' : fixing ? 'fixing' : 'waiting', round: used + 1, included: 1, sentAt, approvedAt: null, link: item === 'scripts' ? null : D.links.drive, editor: D.editor });
  }
  return out;
}
const MARKS = /^(r[0-9]+\.)?(p02\.opened|p04\.(ended|saved)|p05\.(access|logo|colors|photos|videos)|p07\.(sent|approved)|p11\.(ok\.client|calendar)|p12\.(scripts|numbered|docs)|p13\.approved|p19\.(all|took)|p23\.(sent|approved)|p26\.sent|p27\.(notes|fixes|final|approved)|p28\.scheduled|p29\.sent|p30\.live|p34\.talk)$/;
function surveysDue() {
  const due = [];
  const today = dayKeyIL(serverNow());
  if (D.shoot_at && dayKeyIL(D.shoot_at) < today) due.push('shoot');
  return due.filter((k) => !db.client_surveys.some((s) => s.kind === k));
}
function statusPayload(l, preview) {
  if (!preview && !db.client_status_views.some((v) => v.link_id === l.id && serverNow() - new Date(v.at) < 5 * 60e3)) {
    db.client_status_views.push({ id: db.client_status_views.length + 1, link_id: l.id, client_id: D.id, at: serverNow().toISOString() });
  }
  return {
    state: 'ok', preview, expiresAt: l.expires_at,
    client: { name: D.name, business: D.business, status: D.status, shootType: D.shoot_type, charAt: D.char_at, shootAt: D.shoot_at, contractEnd: D.contract_end, rounds: [] },
    marks: Object.fromEntries(db.protocol_checks.filter((x) => x.client_id === D.id && MARKS.test(x.item_key)).map((x) => [x.item_key, { s: x.state, at: x.note === 'ייבוא' ? null : x.at }])),
    links: Object.fromEntries(['drive', 'scripts', 'gantt'].filter((k) => /^https:\/\//.test(D.links[k] || '')).map((k) => [k, D.links[k]])),
    items: items().map(({ editor, ...rest }) => rest),
    approvals: [...db.client_approvals].reverse().slice(0, 20).map((a) => ({ item: a.item, key: a.item_key, shootRound: a.shoot_round, decision: a.decision, round: a.round, name: a.signer_name, note: a.note, at: a.at })),
    thursday: (() => { const m = db.client_messages.filter((x) => x.kind === 'thursday').at(-1); return m ? { body: m.body, at: m.sent_at } : null; })(),
    surveys: { due: surveysDue(), answered: db.client_surveys.map((s) => ({ kind: s.kind, score: s.score, at: s.at })) },
  };
}
const err400 = (json, message) => json(400, { code: '22023', message });
function pageRpc(name, body, me, json) {
  const got = linkOf(body.p_token);
  if (name === 'get_status') return json(200, got.reason ? { state: got.reason } : statusPayload(got.link, !!me));
  if (me) return json(403, { code: '42501', message: 'staff cannot act for the client' });
  if (got.reason) return json(404, { code: 'P0002', message: `status link ${got.reason}` });
  const l = got.link;
  const name2 = String(body.p_name || '').trim().replace(/\s+/g, ' ');
  if (name2.length < 2) return err400(json, 'invalid name');
  const now = serverNow().toISOString();
  if (name === 'answer_survey') {
    if (!surveysDue().includes(body.p_kind)) return err400(json, 'survey not open');
    const s = { id: randomUUID(), client_id: D.id, kind: body.p_kind, score: body.p_score, respondent: name2, question: QUESTIONS[body.p_kind], source: 'page', recorded_by: 'client', at: now, task_id: null };
    if (lowScore(s.kind, s.score)) {
      s.task_id = randomUUID();
      db.client_tasks.push({ id: s.task_id, client_id: D.id, title: `להתקשר ללקוח: ציון ${s.score} מתוך 5 בשאלה על יום הצילום`, owner: 'lior', due_on: '2026-10-14', done_at: null, done_by_email: null, source: 'survey', brief: { survey: s.id, kind: s.kind, score: s.score, owner_alert: severeScore(s.kind, s.score) }, urgent: false, started_at: null, created_by_email: '', created_at: now });
    }
    db.client_surveys.push(s);
    return json(200, statusPayload(l, false));
  }
  const it = items().find((x) => x.key === body.p_key);
  if (!it || it.state !== 'waiting') return err400(json, 'not awaiting approval');
  const decision = name === 'approve_item' ? 'approve' : 'fix';
  const wording = wordingFor(decision, { name: body.p_name, business: D.business, item: it.item, shootRound: 1, round: it.round, included: 1 });
  if (body.p_wording !== wording) return err400(json, 'wording changed');
  const a = { id: randomUUID(), client_id: D.id, link_id: l.id, item: it.item, item_key: it.key, shoot_round: 1, decision, round: it.round, signer_name: name2, note: body.p_note || null, wording, file_ref: it.link, version: it.sentAt, at: now, task_id: null };
  if (decision === 'approve') {
    db.protocol_checks = db.protocol_checks.filter((x) => !(x.client_id === D.id && x.item_key === it.key));
    db.protocol_checks.push({ client_id: D.id, item_key: it.key, state: 'done', note: `אושר בדף המצב על ידי ${name2}`, by_email: 'system', at: now });
  } else {
    if (String(body.p_note || '').trim().length < 2) return err400(json, 'note required');
    const owner = it.round > 1 ? 'lior' : it.item === 'scripts' ? 'lior' : it.item === 'videos' ? (it.editor || 'ofir') : 'ilai';
    let marked = false;
    if (it.item === 'videos' && it.round === 1 && !checkOf('p27.notes')) {
      db.protocol_checks.push({ client_id: D.id, item_key: 'p27.notes', state: 'done', note: JSON.stringify({ text: body.p_note, via: 'status' }), by_email: 'system', at: now });
      marked = true;
    }
    a.task_id = randomUUID();
    db.client_tasks.push({ id: a.task_id, client_id: D.id, title: `תיקון לבקשת הלקוח: ${it.item} · סבב ${it.round}`, owner, due_on: '2026-10-13', done_at: null, done_by_email: null, source: 'client_fix', brief: { problem: body.p_note, item: it.item, item_key: it.key, round: it.round, notes_marked: marked }, urgent: false, started_at: null, created_by_email: '', created_at: now });
  }
  db.client_approvals.push(a);
  return json(200, statusPayload(l, false));
}

// ── The office's functions ─────────────────
function officeRpc(name, body, me, json) {
  if (name === 'status_link_create') {
    if (!canManage(me)) return json(403, { code: '42501', message: 'not allowed' });
    for (const l of db.client_status_links) if (l.client_id === body.p_client && !l.revoked_at) { l.revoked_at = serverNow().toISOString(); l.revoked_by = me.email; }
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const expires = new Date(serverNow().getTime() + 180 * 864e5).toISOString();
    db.client_status_links.push({ id, client_id: body.p_client, token_hash: hash(token), created_at: serverNow().toISOString(), created_by: me.email, expires_at: expires, revoked_at: null, revoked_by: null });
    vault.set(id, token);
    return json(200, { id, token, expiresAt: expires });
  }
  if (name === 'status_link_token') {
    if (!canManage(me)) return json(403, { code: '42501', message: 'not allowed' });
    const l = db.client_status_links.find((x) => x.id === body.p_id && !x.revoked_at);
    return json(200, l ? vault.get(l.id) : null);
  }
  if (name === 'status_link_revoke') {
    if (!canManage(me)) return json(403, { code: '42501', message: 'not allowed' });
    const l = db.client_status_links.find((x) => x.id === body.p_id);
    if (l && !l.revoked_at) Object.assign(l, { revoked_at: serverNow().toISOString(), revoked_by: me.email });
    return json(200, null);
  }
  return null;
}

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
    rpcCalls.push({ name: rpc, body, anon: !me });
    if (['get_status', 'approve_item', 'request_fix', 'answer_survey'].includes(rpc)) return pageRpc(rpc, body, me, json);
    if (rpc === 'is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
    if (!me) return json(401, { code: '42501', message: 'permission denied' });
    const office = officeRpc(rpc, body, me, json);
    if (office) return office;
    if (rpc === 'can_use_vault' || rpc === 'can_use_client_vault') return json(200, isOffice(me));
    return json(200, null);
  }
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${m?.[1]}'` });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  if (req.method() === 'GET') {
    let rows = applyFilters(db[table], url.searchParams);
    if (OFFICE_TABLES.has(table) && !isOffice(me)) rows = [];
    if (table === 'client_status_links') rows = rows.map(({ token_hash, ...r }) => r);
    if (single) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' });
    return json(200, rows);
  }
  if (OFFICE_TABLES.has(table)) return json(403, { code: '42501', message: `permission denied for table ${table}` });
  if (req.method() === 'POST' && table === 'protocol_checks') {
    const rows = Array.isArray(body) ? body : [body];
    for (const r of rows) {
      db.protocol_checks = db.protocol_checks.filter((x) => !(x.client_id === r.client_id && x.item_key === r.item_key));
      db.protocol_checks.push({ ...r, note: r.note ?? null, by_email: me.email, at: serverNow().toISOString() });
    }
    return json(200, rows);
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
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', fakeSupabase);
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>wa</title>' }));
  await ctx.route('https://drive.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>drive</title>' }));
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
const toastHas = (page, s) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), s);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const text = (page, sel) => page.locator(sel).first().innerText();
// Every field has a name a screen reader reads: a <label for>, or aria-label(ledby).
const unlabeled = (page) => page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), textarea, select')]
  .filter((el) => !el.closest('[hidden]') && !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.closest('label') && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
  .map((el) => el.id || el.name));
let passed = 0;
async function step(name, fn) { await fn(); passed += 1; console.log(`ok ${passed} - ${name}`); }

// ── Irit makes the link ───────────────────
const iritCtx = await newContext();
const irit = await newPage(iritCtx);
let token = null;

await step('the card: no link yet; the client agreed to WhatsApp updates when signing', async () => {
  await signIn(irit, `client.html?id=${D.id}`, 'irit@astrateg.test');
  await irit.waitForSelector('#status-block');
  assert.match(await text(irit, '#status-block'), /עוד לא נוצר קישור ללקוח/);
  assert.match(await text(irit, '#st-consent'), /^עדכוני WhatsApp: הלקוח הסכים בחתימה \(יום ג׳ 1\.9\)\.$/);
});

await step('Irit creates the link and copies a ready WhatsApp message with it', async () => {
  await irit.click('#st-create');
  await toastHas(irit, 'נוצר קישור חדש');
  await irit.waitForSelector('#st-copy-msg');
  const l = db.client_status_links[0];
  assert.equal(l.created_by, 'irit@astrateg.test');
  token = vault.get(l.id);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(await text(irit, '#status-block .st-state'), /קישור פעיל עד יום א׳ 11\.4 · עוד לא נפתח/);
  await irit.click('#st-copy-msg');
  await toastHas(irit, 'הועתק');
  const msg = await irit.evaluate(() => navigator.clipboard.readText());
  assert.match(msg, /^היי דנה לוי, זה דף המצב האישי שלכם אצלנו:\n/);
  assert.ok(msg.includes(`${BASE}status.html?t=${token}`), msg);
  assert.match(msg, /הקישור אישי: לא להעביר אותו/);
  // To the client's number (the card has one), with the same text.
  const wa = await irit.getAttribute('#st-wa', 'href');
  assert.ok(wa.startsWith('https://wa.me/972501112222?text='), wa);
  assert.equal(decodeURIComponent(wa.split('?text=')[1]), msg);
  await shot(irit, '01-card-link');
});

// ── The client on the phone ───────────────
const clientCtx = await newContext(PHONE);
const cl = await newPage(clientCtx);

await step('the link opens on a 360px phone: where we are, the promised dates, what we need, the team, in 10 seconds', async () => {
  await cl.goto(`${BASE}status.html?t=${token}`);
  await cl.waitForSelector('#page:not([hidden])');
  assert.equal(await text(cl, '#hello-h'), 'שלום דנה לוי, ככה אנחנו עומדים');
  assert.match(await text(cl, '#where'), /שלב 5 מתוך 8\s+עריכה ובקרה: עורכים, בודקים ושולחים לאישורכם/);
  assert.equal(await cl.locator('#stations li[aria-current="step"]').textContent().then((t) => t.includes('עריכה ובקרה')), true);
  const next = await cl.locator('#next li').allInnerTexts();
  assert.deepEqual(next.map((t) => t.replace(/\s+/g, ' ')), ['עד יום ב׳ 19.10 הסרטונים סגורים, כולל סבב תיקונים', 'עד יום ב׳ 2.8 שיחה על התוצאות ועל ההמשך']);
  const needs = await cl.locator('#needs li').allInnerTexts();
  assert.deepEqual(needs, ['לאשר או לבקש תיקון: 9 הגרפיקות הראשונות', 'לאשר או לבקש תיקון: הסרטונים', 'שאלה קצרה אחת, לא חובה']);
  assert.deepEqual(await cl.locator('#team li strong').allInnerTexts(), ['ליאור', 'עירית', 'אופיר', 'עילאי']);
  assert.deepEqual(await cl.locator('#links a').evaluateAll((as) => as.map((a) => a.getAttribute('href'))), ['https://drive.google.com/dana']);
  assert.match(await text(cl, '#times'), /אישור שקיבלנו את הפנייה\s+תוך שעתיים/);
  assert.match(await text(cl, '#thu-body'), /מה עשינו השבוע: צילמנו\./);
  assert.match(await text(cl, '.sfoot'), /אנחנו רושמים כל כניסה לדף הזה ואת מועדה/);
  assert.match(await cl.locator('#a11y').textContent(), /ת״י 5568, ברמה AA/);
  assert.ok(await noHScroll(cl), 'no horizontal scroll at 360px');
  assert.deepEqual(await unlabeled(cl), []);
  assert.equal(await cl.getAttribute('html', 'lang'), 'he');
  // One view logged, time only.
  assert.equal(db.client_status_views.length, 1);
  assert.deepEqual(Object.keys(db.client_status_views[0]).sort(), ['at', 'client_id', 'id', 'link_id']);
  await shot(cl, '02-status-360');
});

await step('only client-safe content: no internal notes, deadlines, lateness, phone, editor or other links', async () => {
  const all = await cl.evaluate(() => document.body.innerText);
  for (const bad of ['הערה פנימית', 'בעיה פנימית', '050-1112222', 'נדיה', 'metricool', 'chat.whatsapp', 'באיחור', 'יעד פנימי', 'איחור']) assert.ok(!all.includes(bad), bad);
  const payload = JSON.stringify(rpcCalls.length && statusPayload(db.client_status_links[0], true));
  for (const bad of ['הערה פנימית', 'בעיה פנימית', '050-1112222', 'nadia', 'metricool', 'p25.return', 'p22a.assigned', 'irit@']) assert.ok(!payload.includes(bad), bad);
});

await step('approving the first 9 graphics: the exact words are stored, the protocol item is marked', async () => {
  const id = 'p07-approved';
  await cl.fill(`#n-${id}`, 'דנה   לוי');
  assert.equal(await text(cl, `#wa-${id}`), 'אני, דנה לוי, מאשר/ת בשם קפה דנה את 9 הגרפיקות הראשונות, סבב 1, כפי שהוא, כולל נכונות המידע שבו. אחרי האישור הפריט עובר לפרסום בעמוד.');
  assert.ok((await cl.locator(`#ok-${id}`).boundingBox()).height >= 44);
  await cl.click(`#ok-${id}`);
  await cl.waitForFunction(() => !document.getElementById('receipt').hidden);
  assert.match(await text(cl, '#receipt'), /^התקבל: 9 הגרפיקות הראשונות, סבב 1, אושר על ידי דנה לוי ביום ג׳ 13\.10 בשעה 11:40\.$/);
  assert.equal(await cl.evaluate(() => document.activeElement.id), 'receipt');
  const a = db.client_approvals.find((x) => x.item_key === 'p07.approved');
  assert.equal(a.wording, 'אני, דנה לוי, מאשר/ת בשם קפה דנה את 9 הגרפיקות הראשונות, סבב 1, כפי שהוא, כולל נכונות המידע שבו. אחרי האישור הפריט עובר לפרסום בעמוד.');
  assert.deepEqual([checkOf('p07.approved').state, checkOf('p07.approved').by_email], ['done', 'system']);
  assert.equal(await cl.locator(`#item-${id}`).count(), 0);
  assert.match(await text(cl, '#history'), /אושר · 9 הגרפיקות הראשונות · סבב 1 · דנה לוי/);
});

await step('asking for a fix on the videos: the note is required; the editor gets the notes and a task', async () => {
  const id = 'p27-approved';
  assert.equal(await cl.inputValue(`#n-${id}`), 'דנה   לוי'); // the name typed before, offered again
  await cl.click(`#fx-${id}`);
  assert.ok(await cl.locator(`#f-${id}-err`).isVisible());
  assert.equal(await cl.evaluate(() => document.activeElement.id), `f-${id}`);
  assert.equal(await cl.getAttribute(`#f-${id}`, 'aria-invalid'), 'true');
  assert.match(await text(cl, `#wf-${id}`), /^אני, דנה לוי, מבקש\/ת תיקון לסרטונים\. זה סבב 1 מתוך 1 הכלולים\./);
  await cl.fill(`#f-${id}`, 'סרטון 3: להחליף את המוזיקה. סרטון 7: לתקן את הטלפון בסוף.');
  await cl.click(`#fx-${id}`);
  await cl.waitForFunction(() => /בקשת תיקון לסרטונים/.test(document.getElementById('receipt').textContent));
  const t = db.client_tasks.find((x) => x.source === 'client_fix');
  assert.deepEqual([t.owner, t.brief.item_key, t.brief.notes_marked], ['nadia', 'p27.approved', true]);
  assert.match(t.brief.problem, /סרטון 3/);
  assert.deepEqual(JSON.parse(checkOf('p27.notes').note), { text: 'סרטון 3: להחליף את המוזיקה. סרטון 7: לתקן את הטלפון בסוף.', via: 'status' });
  assert.match(await text(cl, `#item-${id}`), /אצלנו בתיקון/);
  assert.equal(await cl.locator(`#fx-${id}`).count(), 0);
  // The ladders: the editor rings once, through the protocol's own rule; nothing twice.
  const w = { clients: db.clients, checks: db.protocol_checks, tasks: db.client_tasks, staff, access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [] };
  const rings = computeReminders({ ...w, now: serverNow() }).filter((r) => r.person === 'nadia' && r.level === 'ring' && /^clientFix/.test(r.rule)).map((r) => `${r.rule}.${r.step}`);
  assert.deepEqual(rings, ['clientFixes.editor']);
});

await step('the shoot-day question: 2 → a task for Lior to call, and the owner hears (rings once each)', async () => {
  await cl.waitForSelector('#survey:not([hidden])');
  assert.match(await text(cl, '#survey legend'), /מ־1 עד 5, איך היה יום הצילום בשבילכם\?/);
  assert.match(await text(cl, '#survey'), /התשובה נשמרת עם השם שלך/);
  await cl.click('#sv-send');
  assert.equal(await text(cl, '#sv-err'), 'בחרו מספר.');
  await cl.locator('label.sscore:has(#sv-2)').click();
  await cl.click('#sv-send');
  await cl.waitForFunction(() => /תודה! קיבלנו/.test(document.getElementById('receipt').textContent));
  assert.ok(await cl.locator('#survey').isHidden());
  const s = db.client_surveys[0];
  assert.deepEqual([s.kind, s.score, s.respondent], ['shoot', 2, 'דנה לוי']);
  const t = db.client_tasks.find((x) => x.source === 'survey');
  assert.deepEqual([t.owner, t.brief.owner_alert], ['lior', true]);
  const w = { clients: db.clients, checks: db.protocol_checks, tasks: db.client_tasks, staff, access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [] };
  const first = computeReminders({ ...w, now: serverNow() });
  const score = first.filter((r) => r.rule === 'clientScore').map((r) => `${r.step}@${r.person}:${r.level}`).sort();
  assert.deepEqual(score, ['now@lior:ring', 'owner@owner:ring']);
  const again = computeReminders({ ...w, now: new Date(serverNow().getTime() + 5 * 60e3), log: first.map((r) => ({ key: r.key })) });
  assert.deepEqual(again.filter((r) => r.rule === 'clientScore'), [], 'rings once');
  assert.ok(await noHScroll(cl));
  await shot(cl, '03-status-after-360');
});

await step('keyboard: the approval controls are reachable and named', async () => {
  await cl.reload();
  await cl.waitForSelector('#page:not([hidden])');
  // Skip link first, then the page.
  await cl.keyboard.press('Tab');
  assert.equal(await cl.evaluate(() => document.activeElement.className), 'skip');
  const names = await cl.locator('button').evaluateAll((bs) => bs.map((b) => b.textContent.trim()).filter((t) => !t));
  assert.deepEqual(names, [], 'every button has a name');
});

// ── Back in the card ──────────────────────
await step('the card shows the views, the approvals with their words, and the score', async () => {
  await irit.reload();
  await irit.waitForSelector('#status-block');
  const blk = await text(irit, '#status-block');
  assert.match(blk, /נפתח פעם אחת, לאחרונה יום ג׳ 13\.10 11:40/);
  assert.match(blk, /אישר\/ה · 9 הגרפיקות הראשונות · סבב 1 · דנה לוי/);
  assert.match(blk, /ביקש\/ה תיקון · הסרטונים · סבב 1 · דנה לוי/);
  assert.match(blk, /יום הצילום: 2 מתוך 5 · נמוך מאוד: ליאור והבעלים · דנה לוי/);
  assert.match(await irit.locator('#status-block').textContent(), /אני, דנה לוי, מאשר\/ת בשם קפה דנה את 9 הגרפיקות הראשונות/);
  await shot(irit, '04-card-after');
});

await step('Irit revokes the link: the client gets a friendly message, and nothing can be done', async () => {
  await irit.click('#st-revoke');
  await toastHas(irit, 'הקישור בוטל');
  await irit.waitForSelector('#st-create');
  assert.match(await text(irit, '#status-block'), /הקישור האחרון בוטל/);
  await cl.reload();
  await cl.waitForSelector('#state h1');
  assert.equal(await text(cl, '#state h1'), 'הקישור הזה כבר לא פעיל');
  assert.match(await text(cl, '#state p'), /בקשו מאיתנו בקבוצה את הקישור העדכני/);
  assert.ok(await cl.locator('#page').isHidden());
  assert.ok(await noHScroll(cl));
});

await step('an expired link and a malformed one: friendly messages', async () => {
  await irit.click('#st-create');
  await irit.waitForSelector('#st-copy-msg');
  const l = db.client_status_links.find((x) => !x.revoked_at);
  l.expires_at = new Date(serverNow().getTime() - 60e3).toISOString();
  await cl.goto(`${BASE}status.html?t=${vault.get(l.id)}`);
  await cl.waitForSelector('#state h1');
  assert.equal(await text(cl, '#state h1'), 'תוקף הקישור הסתיים');
  await cl.goto(`${BASE}status.html?t=abc`);
  await cl.waitForSelector('#state h1');
  assert.equal(await text(cl, '#state h1'), 'הקישור אינו תקין');
  await cl.goto(`${BASE}status.html?t=${'A'.repeat(43)}`);
  await cl.waitForSelector('#state h1');
  assert.equal(await text(cl, '#state h1'), 'הקישור אינו תקין');
  await shot(cl, '05-invalid-360');
});

await step('Ofir sees the block but cannot make links; an editor sees none of it', async () => {
  const ctx = await newContext(PHONE);
  const o = await newPage(ctx);
  await signIn(o, `client.html?id=${D.id}`, 'ofir@astrateg.test');
  await o.waitForSelector('#status-block');
  assert.equal(await o.locator('#st-create').count(), 0);
  assert.match(await text(o, '#status-block'), /עירית, ליאור או הבעלים יוצרים את הקישור|קישור פעיל/);
  assert.ok(await noHScroll(o));
  await ctx.close();
  const ctx2 = await newContext();
  const n = await newPage(ctx2);
  await signIn(n, `client.html?id=${D.id}`, 'nadia@astrateg.test');
  await n.waitForTimeout(300);
  assert.equal(await n.locator('#status-block').count(), 0);
  await ctx2.close();
});

await clientCtx.close();
await iritCtx.close();
await browser.close();
assert.deepEqual(errors, [], errors.join('\n'));
console.log(`status e2e: ${passed} steps passed`);
