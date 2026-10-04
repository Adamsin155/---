// The calendar edge function itself (supabase/functions/calendar/index.ts), run in
// node: its TypeScript types stripped, Deno and the Supabase client replaced by
// stand-ins. A current token gets that person's iCalendar with short caching;
// anything else gets 404 before any data is read; only GET and HEAD; a failure is
// a bare 500 with no detail. The feed never carries a client's phone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as nodeModule from 'node:module';

const TOKEN = 'c0ffee'.repeat(10) + 'abcd';
const client = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'מספרת רון', address: 'הרצל 10', phone: '050-7654321', shoot_type: 'dms', characterizer: 'ofir',
  editor: null, has_logo: true, deal_at: new Date(Date.now() - 5 * 864e5).toISOString(), char_at: null,
  shoot_at: new Date(Date.now() + 3 * 864e5).toISOString(), contract_end: '2027-10-01', status: 'active', rounds: [],
  created_at: new Date(Date.now() - 5 * 864e5).toISOString(), updated_at: new Date().toISOString(),
};
const state = { calls: [], fail: false, owner: 'lior' };

// A small stand-in for supabase-js: from(table).select().in().eq().is().or().order().range() and rpc().
const mock = `
const state = globalThis.__calState;
function query(table) {
  const q = { table, filters: [] };
  const chain = {
    select() { return chain; }, order() { return chain; }, or() { return chain; },
    in(col, vals) { q.filters.push((r) => vals.includes(r[col])); return chain; },
    eq(col, v) { q.filters.push((r) => r[col] === v); return chain; },
    is(col, v) { q.filters.push((r) => (r[col] ?? null) === v); return chain; },
    range(from, to) {
      state.calls.push('from:' + table);
      const rows = (state.tables[table] || []).filter((r) => q.filters.every((f) => f(r)));
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
  return chain;
}
export function createClient() {
  return {
    from: query,
    async rpc(name, args) {
      state.calls.push('rpc:' + name);
      if (state.fail) return { data: null, error: { code: 'XX000', message: 'secret detail' } };
      if (name === 'calendar_feed_check') return { data: args.p_token === state.token ? [{ email: 'x@astrateg.test', person: state.owner }] : [], error: null };
      return { data: null, error: { message: 'unknown' } };
    },
  };
}`;

let dir;
let handler;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'calfn-'));
  writeFileSync(join(dir, 'supabase-mock.mjs'), mock);
  const shared = new URL('../supabase/functions/_shared/app/', import.meta.url).href;
  let src = nodeModule.stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/calendar/index.ts', import.meta.url), 'utf8'));
  src = src.replace("'npm:@supabase/supabase-js@2'", `'${pathToFileURL(join(dir, 'supabase-mock.mjs')).href}'`).replaceAll("'../_shared/app/", `'${shared}`);
  writeFileSync(join(dir, 'index.mjs'), src);
  globalThis.__calState = Object.assign(state, {
    token: TOKEN,
    tables: {
      clients: [client],
      protocol_checks: [],
      client_tasks: [{ id: 't1', client_id: client.id, owner: 'lior', title: 'להתקשר', due_on: new Date(Date.now() + 864e5).toISOString().slice(0, 10), done_at: null, created_at: new Date().toISOString() }],
    },
  });
  globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'x' })[k] }, serve: (h) => { handler = h; } };
  const origError = console.error;
  console.error = () => {};
  await import(pathToFileURL(join(dir, 'index.mjs')).href);
  console.error = origError;
});
after(() => { rmSync(dir, { recursive: true, force: true }); delete globalThis.Deno; });

const get = (path, method = 'GET') => handler(new Request(`https://example.supabase.co/functions/v1/calendar${path}`, { method }));

test('a current token: that person\'s iCalendar, cached briefly, no client phone', async () => {
  state.calls = [];
  const res = await get(`?t=${TOKEN}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/calendar; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'private, max-age=300');
  const body = await res.text();
  assert.match(body, /^BEGIN:VCALENDAR\r\n/);
  assert.match(body, /X-WR-CALNAME:אסטרטג · ליאור/);
  assert.match(body.replace(/\r\n /g, ''), /SUMMARY:יום צילום · מספרת רון/);
  assert.match(body.replace(/\r\n /g, ''), /SUMMARY:משימה: להתקשר · מספרת רון/);
  assert.ok(!body.includes('050-7654321'));
  assert.equal(state.calls[0], 'rpc:calendar_feed_check');
  // The path form works too; HEAD has no body.
  assert.equal((await get(`/${TOKEN}.ics`)).status, 200);
  const head = await get(`?t=${TOKEN}`, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('anything else: 404 (a malformed token reads nothing at all), 405, and a bare 500', async () => {
  state.calls = [];
  for (const p of ['', '?t=abc', `?t=${TOKEN}0`, '/../../x']) assert.equal((await get(p)).status, 404, p);
  assert.deepEqual(state.calls, []);
  const wrong = await get(`?t=${'0'.repeat(64)}`);
  assert.equal(wrong.status, 404);
  assert.deepEqual(state.calls, ['rpc:calendar_feed_check']);
  assert.equal((await get(`?t=${TOKEN}`, 'POST')).status, 405);
  state.fail = true;
  const origError = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  const res = await get(`?t=${TOKEN}`);
  console.error = origError;
  state.fail = false;
  assert.equal(res.status, 500);
  assert.equal(await res.text(), 'server error');
  assert.ok(!logged.join(' ').includes('secret detail'));
});

test('the owner\'s feed: the overview, without the address', async () => {
  state.owner = null;
  const body = (await (await get(`?t=${TOKEN}`)).text()).replace(/\r\n /g, '');
  state.owner = 'lior';
  assert.match(body, /X-WR-CALNAME:אסטרטג · הבעלים/);
  assert.match(body, /SUMMARY:יום צילום · מספרת רון/);
  assert.ok(!body.includes('LOCATION:הרצל'));
});
