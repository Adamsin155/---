// The session's data cache (app/data-cache.js; docs/ops.md, section 60): what may be
// kept is an explicit list of reads and nothing else; it is kept under the account's
// id, for minutes, within a bound; a write empties it; another account finds nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  planOf, tokenUser, sessionCache, KEPT_TABLES, KEPT_RPCS, READ_RPCS, CACHE_KEY, MAX_AGE, MAX_ENTRY, MAX_TOTAL,
} from '../app/data-cache.js';

const BASE = 'https://czncjzziqrqtezpwxxpz.supabase.co';
const rest = (path) => `${BASE}/rest/v1/${path}`;
const plan = (path, method = 'GET', body = null, headers = {}) => planOf(BASE, { url: rest(path), method, body, headers: new Headers(headers) });
const jwt = (sub) => `Bearer h.${Buffer.from(JSON.stringify({ sub, email: 'x@y.z' })).toString('base64url')}.s`;

// A sessionStorage for one tab.
function tab() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    map,
  };
}

test('only the listed reads are kept; the vault, money, links to clients and every write never are', () => {
  for (const table of KEPT_TABLES) assert.equal(plan(`${table}?select=id`).kind, 'keep', table);
  for (const fn of KEPT_RPCS) assert.equal(plan(`rpc/${fn}`, 'POST', '{}').kind, 'keep', fn);
  // The vault: its tables, its functions, its code, and even who may open it.
  for (const never of ['client_access?select=id,username', 'client_access_log?select=id', 'client_access_links?select=id', 'vault_codes?select=*']) {
    assert.notEqual(plan(never).kind, 'keep', never);
  }
  for (const fn of ['access_reveal', 'access_save', 'access_delete', 'access_link_token', 'access_link_create', 'access_work_statuses', 'access_status_overview',
    'access_status_for_work', 'access_link_notes', 'vault_unlock', 'vault_lock', 'vault_code_set', 'vault_code_status', 'can_use_vault', 'can_use_client_vault']) {
    assert.notEqual(plan(`rpc/${fn}`, 'POST', '{}').kind, 'keep', fn);
    assert.equal(KEPT_RPCS.has(fn), false, fn);
  }
  // Money, and the signing token of a quote; the payments app; the links given to clients; the old system's backup.
  for (const never of ['quotes?select=id,token,monthly_gross_agorot', 'deal_requests?select=id,paid', 'payout_months?select=*', 'payout_deals?select=*',
    'payout_settings?select=*', 'payout_owners?select=*', 'client_status_links?select=id', 'client_gallery_links?select=id', 'gantt_links?select=id',
    'script_shares?select=id', 'calendar_feeds?select=*', 'crm_backup?select=*']) {
    assert.equal(plan(never).kind, 'read', never);
  }
  for (const fn of ['manager_client_finance', 'status_link_token', 'gallery_link_token', 'gantt_link_token', 'scripts_share_token', 'calendar_feed_rotate', 'sign_quote', 'get_quote']) {
    assert.notEqual(plan(`rpc/${fn}`, 'POST', '{}').kind, 'keep', fn);
  }
  // Nothing in the list of kept names looks like any of those.
  for (const name of [...KEPT_TABLES, ...KEPT_RPCS]) assert.doesNotMatch(name, /access|vault|payout|quote(?!_facts)|deal|token|link|secret|backup|crm/, name);
  assert.ok(KEPT_TABLES.size <= 25 && KEPT_RPCS.size <= 8, 'the list stays short enough to read');
  // A write is never kept, to any table, listed or not; nor is anything a function may change.
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    assert.equal(plan('clients?id=eq.1', method, '{}').kind, 'write', method);
    assert.equal(plan('protocol_checks', method, '{}').kind, 'write', method);
  }
  for (const fn of ['landing_take', 'approve_item', 'reminders_mark_read', 'push_subscribe', 'some_new_function']) assert.equal(plan(`rpc/${fn}`, 'POST', '{}').kind, 'write', fn);
  // A read-only function that is never kept is not taken for a write (it must not empty the store).
  for (const fn of READ_RPCS) { assert.equal(plan(`rpc/${fn}`, 'POST', '{}').kind, 'read', fn); assert.equal(KEPT_RPCS.has(fn), false, fn); }
  // Not the database: sign-in, files, a function of the project, another host.
  assert.equal(planOf(BASE, { url: `${BASE}/auth/v1/token?grant_type=password`, method: 'POST' }).kind, 'other');
  assert.equal(planOf(BASE, { url: `${BASE}/storage/v1/object/sign/client-files/a.jpg`, method: 'POST' }).kind, 'other');
  assert.equal(planOf(BASE, { url: `${BASE}/functions/v1/staff-admin`, method: 'POST' }).kind, 'write');
  assert.equal(planOf(BASE, { url: 'https://example.com/rest/v1/clients?select=id', method: 'GET' }).kind, 'other');
  assert.equal(planOf(BASE, { url: 'not a url', method: 'GET' }).kind, 'other');
  // HEAD (a count) and a body that is not text name no question.
  assert.equal(plan('clients?select=id', 'HEAD').kind, 'read');
  assert.equal(planOf(BASE, { url: rest('rpc/is_staff'), method: 'POST', body: new Uint8Array(2) }).kind, 'read');
});

test('a question is named by what it asks: the address, the body, how the answer is wanted; a moment in it by its day', () => {
  const a = plan('clients?select=id,name&status=eq.active');
  assert.equal(a.key, plan('clients?select=id,name&status=eq.active').key);
  assert.notEqual(a.key, plan('clients?select=id,name&status=eq.ended').key);
  assert.notEqual(a.key, plan('clients?select=id&status=eq.active').key);
  assert.notEqual(a.key, plan('clients?select=id,name&status=eq.active', 'GET', null, { accept: 'application/vnd.pgrst.object+json' }).key);
  assert.notEqual(a.key, plan('clients?select=id,name&status=eq.active', 'GET', null, { prefer: 'count=exact' }).key);
  assert.equal(a.shape, 'GET clients id,name');
  assert.equal(plan('clients?select=id,name&id=eq.5').shape, a.shape, 'the kind of question: without the values');
  // "since 21 days ago", asked a second later, is the same question; a day later it is another.
  const since = (iso) => plan(`protocol_log?select=at&at=gte.${encodeURIComponent(iso)}`).key;
  assert.equal(since('2026-10-20T07:00:01.057Z'), since('2026-10-20T07:00:03.584Z'));
  assert.notEqual(since('2026-10-20T07:00:01.057Z'), since('2026-10-21T07:00:01.057Z'));
  const body = (iso) => plan('rpc/ofir_meetings', 'POST', JSON.stringify({ p_since: iso })).key;
  assert.equal(body('2026-10-19T07:00:01.057Z'), body('2026-10-19T07:00:01.992Z'));
  assert.notEqual(body('2026-10-19T07:00:01.057Z'), body('2026-10-18T07:00:01.057Z'));
  assert.notEqual(plan('rpc/clients_private', 'POST', '{}').key, plan('rpc/clients_private', 'POST', '{"p_ids":["a"]}').key);
});

test('the account of a request is read from its own token', () => {
  assert.equal(tokenUser(jwt('user-1')), 'user-1');
  assert.equal(tokenUser('Bearer sb_publishable_key'), null);
  assert.equal(tokenUser(''), null);
  assert.equal(tokenUser(null), null);
});

test('kept under the account: another account, or none, finds nothing and what was kept is removed', () => {
  const storage = tab();
  const cache = sessionCache(storage);
  const q = plan('clients?select=id,name');
  assert.equal(cache.put('user-1', q, { status: 200, type: 'application/json', body: '[{"id":1}]' }), true);
  assert.equal(cache.get('user-1', q.key).body, '[{"id":1}]');
  // Only under the cache's own name, in the storage it was given.
  assert.ok([...storage.map.keys()].every((k) => k === CACHE_KEY || k.startsWith(`${CACHE_KEY}.`)));
  // A second tab object over the same storage (the next page of the tab) reads it.
  assert.equal(sessionCache(storage).get('user-1', q.key).status, 200);
  // Someone else.
  const next = sessionCache(storage);
  assert.equal(next.get('user-2', q.key), null);
  assert.equal(storage.map.size, 0, 'the first account\'s answers left the tab');
  assert.equal(sessionCache(storage).get('user-1', q.key), null);
  // Nobody signed in: nothing is kept, nothing is read.
  assert.equal(cache.put(null, q, { status: 200, body: '[]' }), false);
  assert.equal(sessionCache(storage).get(null, q.key), null);
  // An entry that says another account (the index was tampered with) is not handed over.
  const c2 = sessionCache(storage);
  c2.put('user-1', q, { status: 200, body: '[1]' });
  const entry = [...storage.map.keys()].find((k) => k.startsWith(`${CACHE_KEY}.`));
  storage.setItem(entry, JSON.stringify({ ...JSON.parse(storage.getItem(entry)), uid: 'user-9' }));
  assert.equal(sessionCache(storage).get('user-1', q.key), null);
  // clear() leaves nothing; with no storage at all nothing breaks.
  c2.put('user-1', q, { status: 200, body: '[1]' });
  c2.clear();
  assert.equal(storage.map.size, 0);
  const none = sessionCache(null);
  assert.equal(none.put('user-1', q, { status: 200, body: '[]' }), false);
  assert.equal(none.get('user-1', q.key), null);
  none.clear();
});

test('bounded in age and in size; a full tab keeps nothing rather than something broken', () => {
  let clock = 1_000_000;
  const storage = tab();
  const cache = sessionCache(storage, { now: () => clock });
  const q = plan('clients?select=id');
  cache.put('u', q, { status: 200, body: '[]' });
  clock += MAX_AGE - 1;
  assert.ok(cache.get('u', q.key));
  clock += 2;
  assert.equal(cache.get('u', q.key), null, 'older than the limit: not shown');
  assert.equal(storage.map.size, 1, 'and removed (the index stays)');
  // One answer too large is not kept (and an older copy of it goes).
  cache.put('u', q, { status: 200, body: '[]' });
  assert.equal(cache.put('u', q, { status: 200, body: 'x'.repeat(MAX_ENTRY + 1) }), false);
  assert.equal(cache.get('u', q.key), null);
  // The whole store: the oldest answers go first.
  const big = 'y'.repeat(Math.floor(MAX_ENTRY * 0.9));
  const qs = Array.from({ length: 8 }, (_, i) => plan(`clients?select=id&n=eq.${i}`));
  for (const one of qs) { clock += 1000; cache.put('u', one, { status: 200, body: big }); }
  const total = [...storage.map.entries()].filter(([k]) => k !== CACHE_KEY).reduce((n, [, v]) => n + JSON.parse(v).body.length, 0);
  assert.ok(total <= MAX_TOTAL, `kept ${total}`);
  assert.equal(cache.get('u', qs[0].key), null, 'the oldest went');
  assert.ok(cache.get('u', qs.at(-1).key), 'the newest stayed');
  // The tab's storage refuses (it is full): everything of the cache goes.
  const full = tab();
  const real = full.setItem;
  const c3 = sessionCache(full);
  c3.put('u', q, { status: 200, body: '[]' });
  full.setItem = (k, v) => { if (String(v).length > 500) throw new Error('QuotaExceededError'); real(k, v); };
  assert.equal(c3.put('u', qs[0], { status: 200, body: 'z'.repeat(2000) }), false);
  assert.equal(full.map.size, 0);
});

test('a write empties the store, except who the person is; a write to the team empties that too', () => {
  const storage = tab();
  const cache = sessionCache(storage);
  const clients = plan('clients?select=id');
  const staff = plan('staff?select=person&email=eq.a%40b.c');
  const isStaff = plan('rpc/is_staff', 'POST', '{}');
  const fill = () => { for (const q of [clients, staff, isStaff]) cache.put('u', q, { status: 200, body: 'true' }); };
  fill();
  cache.wrote('u', 'protocol_checks');
  assert.equal(cache.get('u', clients.key), null);
  assert.ok(cache.get('u', staff.key) && cache.get('u', isStaff.key));
  fill();
  cache.wrote('u', 'staff');
  assert.deepEqual([cache.get('u', clients.key), cache.get('u', staff.key), cache.get('u', isStaff.key)], [null, null, null]);
  fill();
  cache.wrote('u', 'functions');
  assert.deepEqual([cache.get('u', clients.key), cache.get('u', staff.key), cache.get('u', isStaff.key)], [null, null, null]);
  // What a page cannot draw again by itself is remembered per page, by the kind of question.
  cache.markUnsteady('u', 'client.html', [clients.shape, clients.shape]);
  assert.deepEqual(cache.unsteady('u', 'client.html'), [clients.shape]);
  assert.deepEqual(cache.unsteady('u', 'clients.html'), []);
});

test('the store is the tab\'s sessionStorage and nothing else; signing out and the gate remove it', () => {
  const supa = readFileSync(new URL('../app/supa.js', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../app/data-cache.js', import.meta.url), 'utf8');
  const layer = readFileSync(new URL('../app/session-store.js', import.meta.url), 'utf8');
  assert.match(layer, /sessionCache\(\(\(\) => \{ try \{ return globalThis\.sessionStorage \|\| null; \} catch \{ return null; \} \}\)\(\)\)/);
  // What keeps and hands out answers, and the rules: nowhere but the tab. (The one read of
  // localStorage is of the sign-in client's own session: whose device this is now.)
  for (const [name, src] of [['session-store.js', layer.replace('localStorage.getItem(supabase.auth.storageKey)', '')], ['data-cache.js', rules]]) {
    const code = src.replace(/\/\/.*$/gm, '');
    assert.ok(!/localStorage|indexedDB|caches\.|CacheStorage|document\.cookie/.test(code), `${name}: nowhere but the tab`);
  }
  // The shared connection module loads nothing for it: the client's passwords form and the
  // payments app load that module too, and nothing of theirs passes through the cache.
  assert.deepEqual(supa.match(/^import .*$/gm), ["import { createClient } from './vendor/supabase.js';"]);
  for (const other of ['app/access-form.js', 'app/payouts/app.js', 'app/client.js', 'app/status.js', 'app/gallery.js']) {
    assert.ok(!/session-store|data-cache|protocol-ui|shell\.js/.test(readFileSync(new URL(`../${other}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')), other);
  }
  assert.match(supa, /clearKept\(\);[^\n]*\n\s*await supabase\.auth\.signOut\(\);\n\s*clearKept\(\);/, 'signing out empties it, before and after');
  // The service worker still keeps the site's own files only (tests/smooth.test.mjs holds the rest).
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sw, /astrateg\.cache|sessionStorage/);
  assert.match(sw, /if \(url\.origin !== self\.location\.origin\) return;/);
  const gate = readFileSync(new URL('../app/shell-gate.js', import.meta.url), 'utf8');
  assert.match(gate, /if \(!uid \|\| \(shell && shell\.uid !== uid\) \|\| \(owner && owner !== uid\)\) \{ forget\(\); shell = null; \}/);
});
