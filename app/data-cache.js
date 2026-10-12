// The session's data cache: the rules and the store (docs/ops.md, section 60). A screen
// opens at once with what it showed last time in this tab, and the real answers,
// which are asked for at the same moment, replace it. app/supa.js does the asking;
// this file only says WHAT may be kept, under which name, and keeps it.
//
// What may be kept is an explicit list, and nothing else ever is:
//  - reads (GET) of the tables in KEPT_TABLES, and calls of the read-only functions
//    in KEPT_RPCS: the lists behind "המשימות שלי", a client's card, the team's names,
//    "who am I";
//  - never: the passwords vault (client_access*, access_*, the vault's code and even
//    the yes/no of who may open it), quotes and deals (prices, and the signing token
//    of a quote), the payments app, the links given to clients (status, gallery,
//    logins, scripts, Gantt), anything a write returns, files, sign-in. They are not
//    on the list, so they always go to the server.
// Where: this tab's sessionStorage only ("astrateg.cache" and "astrateg.cache.<n>"),
// never localStorage, IndexedDB or the service worker. It dies with the tab.
// Whose: kept under the id of the signed-in account (read from the request's own
// token). Another id, or signing out, removes all of it (also app/shell-gate.js, before
// anything is drawn, and forgetPlace in app/visit.js).
// How long: an answer older than MAX_AGE is not shown and is removed; the whole store
// is bounded (MAX_ENTRY, MAX_TOTAL; the oldest go first).
// A write removes what was kept before it (the next screen then asks the server, as
// before), except the two answers about who the person is.
// No DOM and no network here, so node can test it (tests/data-cache.test.mjs).

export const CACHE_KEY = 'astrateg.cache';
export const MAX_AGE = 10 * 60e3;     // older than this is never shown
export const FRESH_FOR = 5e3;         // an answer the server gave this long ago needs no second asking
export const MAX_ENTRY = 400_000;     // characters of one answer
export const MAX_TOTAL = 1_500_000;   // characters of all of them

export const KEPT_TABLES = new Set([
  'clients', 'protocol_checks', 'client_tasks', 'staff', 'client_month_marks', 'client_messages', 'client_status_notes',
  'office_reviews', 'photographer_months', 'protocol_log', 'client_questions', 'staff_tasks', 'reminder_log',
  'push_subscriptions', 'change_requests', 'characterizations', 'content_briefs', 'client_approvals', 'client_date_changes',
  'client_surveys', 'client_files', 'client_status_views',
]);
export const KEPT_RPCS = new Set([
  'is_staff', 'clients_private', 'whatsapp_my_consent', 'calendar_feed_status', 'quote_facts', 'ofir_meetings', 'can_write_scripts',
]);
// Functions that only read but are never kept (the vault's, the money's, the settings').
// Listed so that calling one is not taken for a write; any function on neither list is.
export const READ_RPCS = new Set([
  'can_use_vault', 'can_use_client_vault', 'vault_code_status', 'push_status', 'access_work_statuses', 'access_status_overview',
  'access_status_for_work', 'whatsapp_settings', 'whatsapp_team_status', 'metricool_settings', 'manager_client_finance',
  'calendar_feeds_team', 'photographer_taken', 'shoot_scripts', 'scripts_client',
]);
// Who the person is: shown from the store on every page (a page needs no way to draw
// again for these), and they outlive a write to anything but the team itself.
const IDENTITY = (path) => path === 'rpc/is_staff' || path === 'staff';

// A moment inside an address or a body ("since 21 days ago", to the millisecond) names
// the same question a second later: the day stays, the time of day does not.
const MOMENT = /(\d{4}-\d{2}-\d{2})T\d{2}(?::|%3A)\d{2}(?::|%3A)\d{2}(?:\.\d+)?(?:Z|(?:\+|-|%2B)\d{2}(?::|%3A)?\d{2})?/gi;
const steady = (text) => String(text || '').replace(MOMENT, '$1T');

// The account a request is made as: the `sub` of its own token (not checked here: the
// server checks it; this only names the drawer the answer is kept in).
export function tokenUser(authorization) {
  try {
    const jwt = String(authorization || '').replace(/^Bearer\s+/i, '');
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const sub = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '='))).sub;
    return typeof sub === 'string' && sub ? sub : null;
  } catch { return null; }
}

// What a request is. { kind, key, shape, path }:
//   'keep'   a read on the list: `key` names the question, `shape` the kind of question
//            (the table and its columns, without the values asked for)
//   'read'   any other read: never kept, changes nothing
//   'write'  anything that may change the database: what was kept before it goes
//   'other'  not the database (sign-in, a file): left alone
export function planOf(base, { url, method = 'GET', headers = null, body = null } = {}) {
  const none = { kind: 'other', key: null, shape: null, path: null };
  let u = null;
  try { u = new URL(url); } catch { return none; }
  if (u.origin !== new URL(base).origin) return none;
  const m = String(method || 'GET').toUpperCase();
  if (u.pathname.startsWith('/functions/v1/')) return { ...none, kind: 'write', path: 'functions' };
  if (!u.pathname.startsWith('/rest/v1/')) return none;
  const path = u.pathname.slice('/rest/v1/'.length);
  const head = (name) => { try { return headers?.get ? headers.get(name) || '' : headers?.[name] || ''; } catch { return ''; } };
  const rpc = path.startsWith('rpc/') ? path.slice(4) : null;
  if (rpc) {
    if (!KEPT_RPCS.has(rpc)) return { ...none, kind: READ_RPCS.has(rpc) ? 'read' : 'write', path };
    if (m !== 'POST' && m !== 'GET') return { ...none, kind: 'write', path };
  } else {
    if (m !== 'GET' && m !== 'HEAD') return { ...none, kind: 'write', path };
    if (m !== 'GET' || !KEPT_TABLES.has(path)) return { ...none, kind: 'read', path };
  }
  const text = typeof body === 'string' ? body : '';
  if (body != null && typeof body !== 'string') return { ...none, kind: 'read', path }; // a body that cannot be read as text names no question
  const how = `${head('accept')}|${head('prefer')}|${head('range')}|${head('accept-profile')}`;
  const select = u.searchParams.get('select') || '';
  return {
    kind: 'keep', path,
    key: `${m} ${path}${steady(u.search)} [${how}] ${steady(text)}`,
    shape: `${m} ${path} ${select}`,
  };
}

const idOf = (key) => {
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < key.length; i += 1) { const c = key.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = (Math.imul(b, 33) + c) | 0; }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}${key.length.toString(36)}`;
};

// The store of one tab. `storage` is the tab's sessionStorage (or anything with its
// methods); with none, nothing is kept and every question goes to the server.
export function sessionCache(storage, { now = () => Date.now() } = {}) {
  let index = null; // { uid, wrote, e: { id: [at, size, identity] }, ns: { page: [shape] } }
  const blank = (uid) => ({ uid, wrote: 0, e: {}, ns: {} });
  const save = () => { try { storage.setItem(CACHE_KEY, JSON.stringify(index)); return true; } catch { return false; } };
  const drop = (id) => { try { storage.removeItem(`${CACHE_KEY}.${id}`); } catch { /* no storage */ } delete index?.e[id]; };
  function clear() {
    try {
      const gone = [];
      for (let i = 0; i < storage.length; i += 1) { const k = storage.key(i) || ''; if (k === CACHE_KEY || k.startsWith(`${CACHE_KEY}.`)) gone.push(k); }
      for (const k of gone) storage.removeItem(k);
    } catch { /* no storage */ }
    index = null;
  }
  // Opens the store for this account; what another account left is removed first.
  function open(uid) {
    if (!storage || !uid) { index = null; return false; }
    if (index?.uid === uid) return true;
    let kept = null;
    try { kept = JSON.parse(storage.getItem(CACHE_KEY) || 'null'); } catch { kept = null; }
    if (!kept || kept.uid !== uid || typeof kept.e !== 'object' || !kept.e) { clear(); kept = blank(uid); }
    index = { ...blank(uid), ...kept };
    return true;
  }
  // The kept answer to a question: { at, status, type, range, body }, or null.
  function get(uid, key) {
    if (!open(uid)) return null;
    const id = idOf(key);
    const meta = index.e[id];
    if (!meta) return null;
    if (now() - meta[0] > MAX_AGE) { drop(id); save(); return null; }
    try {
      const entry = JSON.parse(storage.getItem(`${CACHE_KEY}.${id}`) || 'null');
      if (!entry || entry.uid !== uid || entry.key !== key) { drop(id); save(); return null; }
      return entry;
    } catch { drop(id); save(); return null; }
  }
  function put(uid, plan, answer) {
    if (!open(uid) || plan.kind !== 'keep') return false;
    const id = idOf(plan.key);
    const body = String(answer.body ?? '');
    if (body.length > MAX_ENTRY) { drop(id); save(); return false; }
    const at = now();
    for (const [old, meta] of Object.entries(index.e)) if (at - meta[0] > MAX_AGE) drop(old);
    let total = Object.entries(index.e).reduce((n, [k, meta]) => n + (k === id ? 0 : meta[1]), 0) + body.length;
    for (const [old] of Object.entries(index.e).sort((a, b) => a[1][0] - b[1][0])) {
      if (total <= MAX_TOTAL) break;
      if (old === id) continue;
      total -= index.e[old][1];
      drop(old);
    }
    try {
      storage.setItem(`${CACHE_KEY}.${id}`, JSON.stringify({ uid, key: plan.key, at, status: answer.status, type: answer.type || '', range: answer.range || '', body }));
    } catch { clear(); return false; } // the tab's storage is full: nothing is kept
    index.e[id] = [at, body.length, IDENTITY(plan.path) ? 1 : 0];
    if (!save()) { clear(); return false; }
    return true;
  }
  // Something was written: what was kept before it may be old. Who the person is stays,
  // unless the write was to the team itself (or went through a function).
  function wrote(uid, path = '') {
    if (!open(uid)) return;
    const all = path === 'staff' || path === 'functions';
    for (const [id, meta] of Object.entries(index.e)) if (all || !meta[2]) drop(id);
    index.wrote = now();
    save();
  }
  const forget = (uid, key) => { if (open(uid)) { drop(idOf(key)); save(); } };
  // Kinds of question a page cannot draw again by itself (app/supa.js learns them): they
  // are not shown from the store on that page.
  const unsteady = (uid, page) => (open(uid) ? index.ns[page] || [] : []);
  function markUnsteady(uid, page, shapes) {
    if (!open(uid) || !shapes.length) return;
    index.ns[page] = [...new Set([...(index.ns[page] || []), ...shapes])].slice(-80);
    save();
  }
  const wroteAt = (uid) => (open(uid) ? index.wrote || 0 : 0);
  const keys = () => { try { return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k) => k === CACHE_KEY || String(k).startsWith(`${CACHE_KEY}.`)); } catch { return []; } };
  return { get, put, wrote, wroteAt, forget, clear, unsteady, markUnsteady, keys, isIdentity: IDENTITY };
}
