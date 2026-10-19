// The server of the demo link (app/demo/flag.js): it answers, in the browser, every
// request the app makes to Supabase, from the made-up office of app/demo/world.js. It
// is the in-memory fake of the browser suites (tests/roles-world.mjs, makeFake), with:
//  - the office moved to today: the world's clock is Tuesday 20.10.2026, 10:00, and
//    every date in it moves by the whole days since then (Israel's calendar), so its
//    hours stay office hours: "today" in the world is today;
//  - what the guest changes (a check, a task, a note) kept for this tab only
//    (sessionStorage), so moving between screens shows it; closing the tab forgets it;
//  - answers for the functions the screens ask (the rpc calls), so no screen fails;
//  - nothing uploaded, sent or paid: those answer "not in the demo".
// Who may read what follows the database's rules for the role the demo is seen as, as
// far as the suites' fake follows them; it is a demo, not the security of the app.
import { NOW, flowWorld, emailOf } from './world.js';
import { generatePlan } from '../gantt-logic.js';
import { TEMPLATE_VERSION } from '../gantt-template.js';
import { dayKeyIL } from '../tz.js';
import { DEMO_DB_KEY, DEMO_OWNER, demoEmail, demoUser, roleOfEmail } from './flag.js';

const OFFICE = new Set([null, 'irit', 'lior', 'ofir', 'ilai']);
const CLIENT_PRIVATE = ['phone', 'notes', 'closed_reason'];
const DAY = 86400000;
const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `de${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);
const now = () => new Date().toISOString();

// ── The office, moved to today ──────────────────
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const ilDay = (t) => Date.parse(`${new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })}T00:00:00Z`);
export function shiftWorld(db, to = Date.now()) {
  const days = Math.round((ilDay(to) - ilDay(NOW.getTime())) / DAY);
  const ms = days * DAY;
  const move = (v) => {
    if (typeof v === 'string') {
      if (STAMP.test(v)) { const t = Date.parse(v); return Number.isNaN(t) ? v : new Date(t + ms).toISOString(); }
      if (DATE.test(v)) { const t = Date.parse(`${v}T12:00:00Z`); return Number.isNaN(t) ? v : isoDay(t + days * DAY); }
      if (v.startsWith('{') && v.includes('"20')) { try { return JSON.stringify(move(JSON.parse(v))); } catch { return v; } }
      return v;
    }
    if (Array.isArray(v)) return v.map(move);
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = move(v[k]); return v; }
    return v;
  };
  for (const table of Object.keys(db)) db[table] = move(db[table]);
  return db;
}

// More of the office than the suites need, so every screen has something to show.
function dressWorld(db) {
  const c = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const owner = DEMO_OWNER;
  db.staff = db.staff.map((s) => ({ ...s, email: s.email === emailOf('owner') ? owner : s.email, phone: '050-0000000' }));
  for (const t of Object.values(db)) if (Array.isArray(t)) for (const r of t) for (const col of ['created_by_email', 'by_email', 'updated_by']) if (r && r[col] === emailOf('owner')) r[col] = owner;
  for (const x of db.clients) if (!x.phone) x.phone = '050-0000000';
  const quote = (n, fields, client, tier = 'Social + TV all in one', influencer = 'dms') => ({
    id: `q0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, token: `demo-quote-${n}`, number: 1040 + n, created_by_email: emailOf('irit'),
    first_viewed_at: null, signed_at: null, signer_name: null, expires_at: '2026-10-23T10:00:00+03:00',
    approval: 'none', approval_by: null, approval_note: null, approval_at: null, quote_id: null,
    model: { client: { company: client.company, phone: '050-0000000', email: null }, package: { id: 'social-tv', tierName: tier, influencer }, docTitle: 'הצעת מחיר', signable: true, termMonths: 12, validHours: 72, selection: {} },
    client_name: client.name, ...fields,
  });
  db.quotes = [
    quote(1, { created_at: '2026-10-19T16:10:00+03:00', status: 'sent', monthly_gross_agorot: 690000, first_viewed_at: '2026-10-19T18:00:00+03:00' }, { name: 'לילך', company: 'סלון יופי לילך' }, 'Social all in one', 'natali'),
    quote(2, { created_at: '2026-10-20T08:30:00+03:00', status: 'sent', monthly_gross_agorot: 890000 }, { name: 'דנה', company: 'קפה הפינה' }),
    quote(3, { created_at: '2026-10-11T09:00:00+03:00', status: 'signed', monthly_gross_agorot: 1190000, first_viewed_at: '2026-10-11T10:00:00+03:00', signed_at: '2026-10-11T12:30:00+03:00', signer_name: 'אבי לוי' }, { name: 'אבי לוי', company: 'פיצה נאפולי' }),
    quote(4, { created_at: '2026-10-08T09:00:00+03:00', status: 'signed', monthly_gross_agorot: 690000, first_viewed_at: '2026-10-08T11:00:00+03:00', signed_at: '2026-10-08T15:00:00+03:00', signer_name: 'נועה ברק' }, { name: 'נועה ברק', company: 'ברק עיצוב שיער' }, 'Social all in one', 'natali'),
    quote(5, { created_at: '2026-09-29T09:00:00+03:00', status: 'expired', monthly_gross_agorot: 890000, expires_at: '2026-10-02T09:00:00+03:00' }, { name: 'יגאל', company: 'יגאל הובלות' }),
  ];
  // A content plan (gantt.html) for every client past the shoot day: what is behind them
  // went up, this week is scheduled, the rest is planned.
  const today = dayKeyIL(new Date());
  const week = (() => { const t = new Date(`${today}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 7); return t.toISOString().slice(0, 10); })();
  db.client_gantt = [];
  for (const x of db.clients.filter((cl) => cl.shoot_at && cl.status === 'active' && cl.shoot_at < now())) {
    const plan = generatePlan(x);
    if (plan.error) continue;
    for (const e of plan.entries) {
      const state = e.day < today ? (Math.random() < 0.92 ? 'posted' : 'skipped') : e.day <= week ? 'scheduled' : 'planned';
      db.client_gantt.push({ id: uuid(), client_id: x.id, key: e.key, kind: e.kind, title: e.title, day: e.day, time_il: e.time_il ?? null, month: e.month ?? null, num: e.num ?? null,
        internal: !!e.internal, state, posted_on: state === 'posted' ? e.day : null, file_id: null, link: null, note: null, edited: false, template_version: TEMPLATE_VERSION,
        by_email: emailOf('ilai'), at: now(), metricool_id: null, synced_at: null, sync_error: null });
    }
  }
  db.reminder_log = [];
  db.staff_tasks = [];
  db.client_messages = db.client_messages || [];
  db.client_files = (db.client_files || []).map((f) => ({ ...f, client_id: f.client_id || c(12) }));
  return db;
}

let db = null;
function world() {
  if (db) return db;
  try { db = JSON.parse(sessionStorage.getItem(DEMO_DB_KEY) || 'null'); } catch { db = null; }
  if (!db || typeof db !== 'object' || !Array.isArray(db.clients)) {
    db = dressWorld(shiftWorld(flowWorld()));
    keep();
  }
  return db;
}
let keeping = false;
function keep() {
  if (keeping) return;
  keeping = true;
  queueMicrotask(() => {
    keeping = false;
    try { sessionStorage.setItem(DEMO_DB_KEY, JSON.stringify(db)); } catch { /* too big or no storage: the change lives until the page closes */ }
  });
}

// ── Answers ───────────────────────────────────
const JSON_HEAD = { 'content-type': 'application/json' };
const json = (status, data, extra = {}) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { ...JSON_HEAD, ...extra } });
const notInDemo = () => json(400, { code: 'P0001', message: 'לא זמין בהדגמה', error: 'not in the demo' });

function applyFilters(rows, params) {
  let out = rows;
  for (const [k, raw] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or' || k === 'and') continue; // the demo shows a little more rather than nothing
    const not = raw.startsWith('not.') && raw !== 'not.is.null';
    const v = not ? raw.slice(4) : raw;
    let keep = null;
    if (v.startsWith('eq.')) keep = (r) => String(r[k]) === v.slice(3);
    else if (v.startsWith('neq.')) keep = (r) => String(r[k]) !== v.slice(4);
    else if (v === 'is.null') keep = (r) => r[k] === null || r[k] === undefined;
    else if (v === 'not.is.null') keep = (r) => r[k] !== null && r[k] !== undefined;
    else if (v.startsWith('is.')) keep = (r) => String(r[k] ?? null) === v.slice(3);
    else if (v.startsWith('gte.')) keep = (r) => r[k] != null && String(r[k]) >= v.slice(4);
    else if (v.startsWith('gt.')) keep = (r) => r[k] != null && String(r[k]) > v.slice(3);
    else if (v.startsWith('lte.')) keep = (r) => r[k] != null && String(r[k]) <= v.slice(4);
    else if (v.startsWith('lt.')) keep = (r) => r[k] != null && String(r[k]) < v.slice(3);
    else if (v.startsWith('like.') || v.startsWith('ilike.')) {
      const pat = v.slice(v.indexOf('.') + 1);
      const re = new RegExp(`^${pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*')}$`, v.startsWith('i') ? 'i' : '');
      keep = (r) => re.test(String(r[k] ?? ''));
    } else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')); keep = (r) => set.includes(String(r[k])); }
    if (keep) out = out.filter(not ? (r) => !keep(r) : keep);
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split(',')[0].split('.');
    out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  return out;
}
// The columns a select asks for, as the database gives them: "a, b", "alias:col",
// "alias:col->key->>key" (a value inside a json column). A select with "*" or with a
// joined table ("other(cols)") is answered with the whole rows.
function columnsOf(select) {
  if (!select || select.includes('*') || select.includes('(')) return null;
  return select.split(',').map((s) => s.trim()).filter(Boolean).map((item) => {
    const [alias, path] = item.includes(':') ? item.split(':') : [null, item];
    const [col, ...keys] = path.split(/->>?/).map((x) => x.trim());
    return { name: alias || keys[keys.length - 1] || col, col, keys };
  });
}
function project(rows, select) {
  const cols = columnsOf(select);
  if (!cols) return rows;
  return rows.map((r) => Object.fromEntries(cols.map(({ name, col, keys }) => {
    let v = r[col];
    for (const key of keys) v = v && typeof v === 'object' ? v[key] : undefined;
    if (keys.length && v !== undefined && v !== null && typeof v !== 'object' && select.includes(`->>${keys[keys.length - 1]}`)) v = String(v);
    return [name, v === undefined ? null : v];
  })));
}
const publicClient = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !CLIENT_PRIVATE.includes(k)));

// Who is asking: the demo's token carries the address (app/demo/flag.js, demoToken).
function emailOfToken(headers) {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1] || '';
  try { return JSON.parse(decodeURIComponent(escape(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))))?.email || null; } catch { return null; }
}
function headersOf(input, init) {
  const out = {};
  const add = (h) => {
    if (!h) return;
    if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => { out[k.toLowerCase()] = v; });
    else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  };
  add(input?.headers);
  add(init?.headers);
  return out;
}
async function bodyOf(input, init) {
  let b = init?.body;
  if (b == null && input && typeof input.text === 'function') { try { b = await input.clone().text(); } catch { b = null; } }
  if (b == null || b === '') return null;
  if (typeof b !== 'string') return null;
  try { return JSON.parse(b); } catch { return null; }
}

// The functions the screens ask for, by name. `me`: the staff row of the guest's role.
const RPC = {
  is_staff: ({ me }) => !!me,
  can_use_vault: ({ me }) => OFFICE.has(me?.person),
  can_use_client_vault: ({ me }) => OFFICE.has(me?.person),
  can_write_scripts: ({ me }) => me?.person === null || me?.person === 'lior',
  vault_code_status: () => ({ set: true, open: false }),
  vault_unlock: () => false,
  manager_client_finance: () => [],
  archived_clients: () => [],
  push_status: () => [],
  push_subscribe: () => null,
  push_unsubscribe: () => null,
  push_confirm: () => null,
  photographer_taken: () => [],
  reminders_mark_read: () => null,
  calendar_feed_status: () => [],
  calendar_feeds_team: () => [],
  whatsapp_settings: () => null, // the team screen then shows no WhatsApp card (as before it is set up)
  whatsapp_my_consent: () => null,
  whatsapp_team_status: () => [],
  metricool_settings: () => ({ enabled: false }),
  ofir_meetings: () => [],
  access_status_overview: () => [],
  access_work_statuses: () => [],
  access_status_for_work: () => [],
  access_link_notes: () => [],
  landing_links: () => [],
  quote_facts: () => [],
  clients_private: ({ me, body }) => {
    if (!OFFICE.has(me?.person)) return [];
    const ids = Array.isArray(body?.p_ids) ? new Set(body.p_ids) : null;
    return world().clients.filter((c) => !ids || ids.has(c.id)).map((c) => ({ id: c.id, phone: c.phone ?? null, notes: c.notes ?? null, closed_reason: c.closed_reason ?? null }));
  },
  scripts_client: ({ me, body }) => {
    const c = world().clients.find((x) => x.id === body?.p_client);
    if (!c || !(me?.person === null || me?.person === 'lior')) return null;
    return { id: c.id, name: c.name, business: c.business || c.name, status: c.status, shootType: c.shoot_type, charAt: c.char_at, shootAt: c.shoot_at, videos: c.deliverables?.videos ?? null, rounds: (c.rounds || []).map((r) => r.n), manage: true };
  },
};

// Writes the demo does not pretend to do: they would leave the browser in the real app.
const NOT_IN_DEMO = new Set(['functions/v1/create-quote', 'functions/v1/metricool']);
// The team screen (team.html) reads its list from the staff-admin function: the same
// rows (supabase/functions/staff-admin/rules.js, summarize), everyone signed in lately.
// Adding, removing or sending a link is not done in the demo.
function staffAdmin(me, body) {
  if (body?.action !== 'list') return notInDemo();
  const owner = me?.person === null || me?.person === undefined;
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  return json(200, {
    caller: { email: me?.email, person: me?.person ?? null, owner, vault: !!me?.vault },
    rows: world().staff.map((r, i) => ({ email: r.email, person: r.person ?? null, vault: !!r.vault, phone: r.phone ?? null, created_at: '2026-09-01T09:00:00+03:00',
      has_login: true, confirmed: true, last_sign_in_at: ago(2 + i * 5), invited_at: '2026-09-01T09:00:00+03:00', last_link_at: null, last_link_by: null })),
  });
}

export async function answer(input, init, method) {
  const url = new URL(typeof input === 'string' ? input : input?.url || String(input));
  const p = url.pathname;
  const headers = headersOf(input, init);
  const body = method === 'GET' || method === 'HEAD' ? null : await bodyOf(input, init);
  const w = world();
  const email = emailOfToken(headers);
  const me = email ? w.staff.find((s) => s.email === email) : undefined;
  const person = me?.person;

  // ── Sign-in ──
  if (p === '/auth/v1/user') return me ? json(200, demoUser(roleOfEmail(email))) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return json(204, null);
  if (p === '/auth/v1/token') {
    // The sign-in form of the demo: any address of the made-up office, any password.
    const asked = String(body?.email || '').toLowerCase();
    const row = w.staff.find((s) => s.email === asked) || w.staff.find((s) => s.email === demoEmail('owner'));
    return json(400, { error: 'invalid_grant', msg: `בהדגמה אין צורך להתחבר (${row.email})`, code: 'invalid_credentials' });
  }
  if (p.startsWith('/auth/v1/')) return json(200, {});

  // ── Functions ──
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.slice('/rest/v1/rpc/'.length);
    const fn = RPC[name];
    if (fn) { const out = fn({ me, body, url }); return json(200, out === undefined ? null : out); }
    // Not taught to the demo yet: an empty answer rather than a failure on the screen.
    if (globalThis.console) console.info(`[demo] no answer for rpc ${name}`);
    return json(200, null);
  }
  if (p.startsWith('/functions/v1/')) {
    if (NOT_IN_DEMO.has(p.slice(1))) return notInDemo();
    if (p === '/functions/v1/staff-admin') return staffAdmin(me, body);
    return json(200, {});
  }

  // ── Files ──
  if (p.startsWith('/storage/v1/object/sign/')) {
    if (method === 'POST') {
      const paths = Array.isArray(body?.paths) ? body.paths : null;
      const signed = (path) => `/object/sign/${path}?token=demo`;
      return paths ? json(200, paths.map((x) => ({ path: x, signedURL: signed(x), error: null }))) : json(200, { signedURL: signed(p.slice('/storage/v1/object/sign/'.length)) });
    }
  }
  if (p.startsWith('/storage/v1/')) return notInDemo();

  // ── Tables ──
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { code: '42P01', message: 'not found' });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const rowsOf = () => (w[table] ||= []);
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const clean = (rows) => project(table === 'clients' ? rows.map(publicClient) : rows, url.searchParams.get('select'));
  const reply = (rows) => (single ? (rows.length ? json(200, clean(rows)[0]) : json(406, { code: 'PGRST116', message: 'no rows' })) : json(200, clean(rows)));

  if (method === 'GET' || method === 'HEAD') {
    let rows = applyFilters(rowsOf(), url.searchParams);
    if (table === 'clients') {
      rows = rows.filter((r) => !r.archived_at);
      if (person === 'stav') rows = [];
      else if (person === 'eli') rows = rows.filter((r) => r.shoot_at);
      else if (!OFFICE.has(person)) rows = rows.filter((r) => r.editor === person);
    }
    if (person === 'stav' && !['deal_requests', 'staff', 'reminder_log'].includes(table)) rows = [];
    const readsAll = person === null || person === 'irit';
    if (table === 'deal_requests' && !readsAll) rows = rows.filter((r) => r.seller === person);
    if (table === 'quotes' && !readsAll) rows = rows.filter((r) => r.created_by_email === email);
    if (['client_messages', 'client_access'].includes(table) && !OFFICE.has(person)) rows = [];
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    const page = rows.slice(off, off + lim);
    if (!single && /count=/.test(headers.prefer || '')) {
      return json(200, clean(page), { 'content-range': `${page.length ? `${off}-${off + page.length - 1}` : '*'}/${rows.length}` });
    }
    return reply(page);
  }
  const keys = url.searchParams.get('on_conflict')?.split(',') || (table === 'protocol_checks' ? ['client_id', 'item_key'] : null);
  if (method === 'POST') {
    const list = Array.isArray(body) ? body : [body || {}];
    const out = list.map((r) => {
      const row = { id: uuid(), created_at: now(), at: now(), by_email: email, created_by_email: email, ...r };
      const old = keys && rowsOf().find((x) => keys.every((k) => String(x[k]) === String(row[k])));
      if (old) { Object.assign(old, r, { at: now(), by_email: email }); return old; }
      rowsOf().push(row);
      return row;
    });
    keep();
    return single ? json(201, clean(out)[0]) : json(201, clean(out));
  }
  if (method === 'PATCH') {
    const rows = applyFilters(rowsOf(), url.searchParams);
    for (const r of rows) Object.assign(r, body || {});
    keep();
    return reply(rows);
  }
  if (method === 'DELETE') {
    const gone = new Set(applyFilters(rowsOf(), url.searchParams));
    w[table] = rowsOf().filter((r) => !gone.has(r));
    keep();
    return reply([...gone]);
  }
  return json(405, { message: 'unexpected' });
}
