// supabase/migrations/20261207100000_mcp_write.sql in a real Postgres (tests/sql/pg.mjs): the gate lets an
// owner's connected-app token (with the mcp function's key) write what the write tools write, and nothing
// else; Lior's and Ofir's stay read-only; browser sessions are untouched; the lists are the code's own;
// the requests to the developer are the owners'. Safe to run twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql } from './pg.mjs';
import { TABLES } from '../../supabase/functions/ask/tools.js';
import { GATE_RPCS, GATE_FALLBACK_RPC, GATE_HEADER } from '../../supabase/functions/mcp/handler.js';
import { WRITE_GATE } from '../../supabase/functions/mcp/write-tools.js';

const MIGRATION = '20261207100000_mcp_write.sql';
const SQL = readFileSync(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
const PEOPLE = { owner: null, lior: 'lior', ofir: 'ofir', irit: 'irit' };
let db;
let KEY;
let CLIENT;
const users = {};
const claimsOf = (who, app = true) => ({ sub: users[who].id, email: users[who].email, role: 'authenticated', aud: 'authenticated', ...(app ? { client_id: 'claude-client' } : {}) });

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2) on conflict (email) do update set person = excluded.person', [email, person])
      .catch(() => db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]));
  }
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
  KEY = (await db.query('select public.mcp_gate_key() as k')).rows[0].k;
  CLIENT = (await db.query("insert into public.clients (name) values ('רון כהן') returning id")).rows[0].id;
});

// The gate as PostgREST calls it, and then (when it passes) the request's own statement, committed.
async function request({ who, app = true, method, path, key = true, sql = null, params = [] }) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      const set = (k, v) => tx.query('select set_config($1, $2, true)', [k, v]);
      await set('request.jwt.claims', JSON.stringify(claimsOf(who, app)));
      await set('request.method', method);
      await set('request.path', path);
      await set('request.headers', JSON.stringify(key ? { [GATE_HEADER]: KEY } : {}));
      await tx.query('select public.mcp_request_gate()');
      return { ok: true, rows: sql ? (await tx.query(sql, params)).rows : [] };
    });
  } catch (err) { return { error: err.message, code: err.code }; }
}
const passes = async (r) => { const out = await request(r); assert.equal(out.ok, true, `${JSON.stringify(r)}: ${out.error}`); return out; };
const refused = async (r) => { const out = await request(r); assert.equal(out.code, '42501', JSON.stringify(r)); assert.match(out.error, /connected app/); };

// The owner's part of the gate, as written: [method, paths].
const gateBody = () => /function public\.mcp_request_gate\(\)[\s\S]*?end \$\$;/.exec(SQL)[0];
const ownerPart = () => gateBody().split('-- An owner:')[1];
const basePart = () => gateBody().split('-- An owner:')[0];
const quoted = (s) => [...s.matchAll(/'\/([a-z_/]+)'/g)].map((m) => m[1]);
const ownerPaths = (method) => {
  const re = new RegExp(`method ${method === 'GET' ? "in \\('GET', 'HEAD'\\)" : `= '${method}'`} and path in \\(([^)]*)\\)`, 'g');
  return [...ownerPart().matchAll(re)].flatMap((m) => quoted(m[1]));
};

test('the lists in the gate are exactly the code\'s: the read tools\' for everyone, the write tools\' for an owner', () => {
  const base = quoted(basePart());
  assert.deepEqual(base.filter((q) => !q.startsWith('rpc/')).sort(), [...TABLES].sort());
  assert.deepEqual(base.filter((q) => q.startsWith('rpc/')).map((q) => q.slice(4)).sort(), [...GATE_RPCS, GATE_FALLBACK_RPC].sort());
  assert.deepEqual(ownerPaths('GET').sort(), [...WRITE_GATE.read].sort());
  assert.deepEqual(ownerPaths('POST').filter((q) => !q.startsWith('rpc/')).sort(), [...WRITE_GATE.insert].sort());
  assert.deepEqual(ownerPaths('POST').filter((q) => q.startsWith('rpc/')).map((q) => q.slice(4)).sort(), [...WRITE_GATE.rpcs].sort());
  assert.deepEqual(ownerPaths('PATCH').sort(), [...WRITE_GATE.update].sort());
  assert.deepEqual(ownerPaths('DELETE').sort(), [...WRITE_GATE.delete].sort());
  assert.match(ownerPart(), /owner := coalesce\(private\.is_owner\(\), false\);[\s\S]*if owner then\s+return;/);
  const body = gateBody();
  const first = body.indexOf('return;');
  assert.ok(first > 0 && !/\bfrom\b/.test(body.slice(0, first)), 'nothing is read before the first return: browser sessions are as before');
});

test('an owner\'s connected app with the key: every write the tools make passes the gate', async () => {
  for (const t of WRITE_GATE.read) { await passes({ who: 'owner', method: 'GET', path: `/${t}` }); await passes({ who: 'owner', method: 'HEAD', path: `/${t}` }); }
  for (const t of WRITE_GATE.insert) await passes({ who: 'owner', method: 'POST', path: `/${t}` });
  for (const t of WRITE_GATE.update) await passes({ who: 'owner', method: 'PATCH', path: `/${t}` });
  for (const t of WRITE_GATE.delete) await passes({ who: 'owner', method: 'DELETE', path: `/${t}` });
  for (const fn of WRITE_GATE.rpcs) await passes({ who: 'owner', method: 'POST', path: `/rpc/${fn}` });
  // And the reads, as before.
  for (const t of TABLES) await passes({ who: 'owner', method: 'GET', path: `/${t}` });
});

test('Lior and Ofir: the reads as before, and every write refused', async () => {
  for (const who of ['lior', 'ofir']) {
    for (const t of TABLES) await passes({ who, method: 'GET', path: `/${t}` });
    for (const fn of GATE_RPCS) await passes({ who, method: 'POST', path: `/rpc/${fn}` });
    for (const t of WRITE_GATE.read) await refused({ who, method: 'GET', path: `/${t}` });
    for (const t of WRITE_GATE.insert) await refused({ who, method: 'POST', path: `/${t}` });
    for (const t of WRITE_GATE.update) await refused({ who, method: 'PATCH', path: `/${t}` });
    for (const t of WRITE_GATE.delete) await refused({ who, method: 'DELETE', path: `/${t}` });
    for (const fn of WRITE_GATE.rpcs) await refused({ who, method: 'POST', path: `/rpc/${fn}` });
  }
});

test('an owner: anything else is refused, and without the key nothing', async () => {
  for (const [method, path] of [
    ['DELETE', '/clients'], ['POST', '/clients'], ['PUT', '/clients'], ['DELETE', '/client_tasks'], ['DELETE', '/staff_tasks'], ['PATCH', '/staff_tasks'],
    ['POST', '/quotes'], ['PATCH', '/quotes'], ['DELETE', '/staff_notes'], ['PATCH', '/staff_notes'], ['DELETE', '/system_requests'], ['PATCH', '/system_requests'],
    ['GET', '/client_access'], ['GET', '/staff'], ['PATCH', '/staff'], ['GET', '/payout_deals'], ['POST', '/payout_deals'], ['GET', '/mcp_access'],
    ['POST', '/rpc/access_reveal'], ['POST', '/rpc/vault_unlock'], ['POST', '/rpc/mcp_set_access'], ['POST', '/rpc/mcp_gate_key'], ['POST', '/rpc/quote_cancel'],
    ['GET', '/rpc/staff_task_create'], ['PATCH', '/protocol_checks'], ['DELETE', '/deal_requests'], ['GET', '/system_requests'],
  ]) await refused({ who: 'owner', method, path });
  for (const [method, path] of [['POST', '/protocol_checks'], ['PATCH', '/clients'], ['POST', '/rpc/staff_task_create'], ['GET', '/clients']]) {
    await refused({ who: 'owner', method, path, key: false });
  }
});

test('an odd token on a write path (a sub that is not a uuid, no email): refused as any other, never another error', async () => {
  for (const claims of [{ sub: 'u1', email: 'owner@astrateg.test', role: 'authenticated', client_id: 'c' }, { sub: users.owner.id, role: 'authenticated', client_id: 'c' }]) {
    let code = null;
    await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      const set = (k, v) => tx.query('select set_config($1, $2, true)', [k, v]);
      await set('request.jwt.claims', JSON.stringify(claims));
      await set('request.method', 'POST');
      await set('request.path', '/protocol_checks');
      await set('request.headers', JSON.stringify({ [GATE_HEADER]: KEY }));
      try { await tx.query('select public.mcp_request_gate()'); } catch (err) { code = err.code; }
      await tx.rollback();
    }).catch(() => {});
    assert.equal(code, '42501', JSON.stringify(claims));
  }
});

test('the browser\'s own sessions are untouched: any request passes the gate, with no key', async () => {
  for (const who of ['owner', 'lior', 'irit']) {
    for (const [method, path] of [['POST', '/clients'], ['DELETE', '/protocol_checks'], ['GET', '/client_access'], ['POST', '/rpc/access_reveal']]) {
      await passes({ who, app: false, method, path, key: false });
    }
  }
});

test('through the gate, as the owner: the writes land with the owner\'s stamps (row level security as in the app)', async () => {
  await passes({ who: 'owner', method: 'POST', path: '/protocol_checks', sql: "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p03.who', 'done') on conflict (client_id, item_key) do update set state = excluded.state", params: [CLIENT] });
  const mark = (await db.query("select by_email from public.protocol_checks where client_id = $1 and item_key = 'p03.who'", [CLIENT])).rows[0];
  assert.equal(mark.by_email, 'owner@astrateg.test');
  await passes({ who: 'owner', method: 'DELETE', path: '/protocol_checks', sql: "delete from public.protocol_checks where client_id = $1 and item_key = 'p03.who'", params: [CLIENT] });
  assert.equal((await db.query("select count(*)::int as n from public.protocol_checks where client_id = $1 and item_key = 'p03.who'", [CLIENT])).rows[0].n, 0);
  await passes({ who: 'owner', method: 'PATCH', path: '/clients', sql: "update public.clients set package_name = 'Podcast' where id = $1", params: [CLIENT] });
  assert.equal((await db.query('select package_name from public.clients where id = $1', [CLIENT])).rows[0].package_name, 'Podcast');
  const task = await passes({ who: 'owner', method: 'POST', path: '/rpc/staff_task_create', sql: "select public.staff_task_create('irit', 'לבדוק את החוזה') as id" });
  const row = (await db.query('select created_by, created_by_email from public.staff_tasks where id = $1', [task.rows[0].id])).rows[0];
  assert.deepEqual(row, { created_by: 'owner', created_by_email: 'owner@astrateg.test' });
  await passes({ who: 'owner', method: 'POST', path: '/system_requests', sql: "insert into public.system_requests (body) values ('להוסיף כפתור הדפסה')" });
  const req = (await db.query('select created_by_email, source, handled_at from public.system_requests')).rows;
  assert.deepEqual(req, [{ created_by_email: 'owner@astrateg.test', source: 'claude', handled_at: null }]);
});

test('the requests to the developer: the owners write and read them; nobody else, and nothing is deleted or forged', async () => {
  const as = async (who, sql, params = []) => {
    try {
      return await db.transaction(async (tx) => {
        await tx.query('set local role authenticated');
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claimsOf(who, false))]);
        return { rows: (await tx.query(sql, params)).rows };
      });
    } catch (err) { return { error: err.message }; }
  };
  assert.match((await as('lior', "insert into public.system_requests (body) values ('x')")).error, /row-level security|permission/);
  assert.match((await as('irit', "insert into public.system_requests (body) values ('x')")).error, /row-level security|permission/);
  assert.deepEqual((await as('lior', 'select id from public.system_requests')).rows, []);
  assert.ok((await as('owner', 'select id from public.system_requests')).rows.length >= 1);
  assert.match((await as('owner', "insert into public.system_requests (body, created_by_email) values ('x', 'someone@else.test')")).error, /permission/);
  assert.match((await as('owner', 'delete from public.system_requests')).error, /permission/);
  assert.match((await as('owner', "update public.system_requests set body = 'y'")).error, /permission/);
  assert.match((await as('owner', "insert into public.system_requests (body) values ('   ')")).error, /check/);
});

test('the migration only adds and replaces functions, and leaves PostgREST calling the gate', () => {
  assert.doesNotMatch(SQL.replace(/--.*$/gm, ''), /\bdrop\s|\bdelete\s+from\b|\btruncate\b/i);
  assert.match(SQL, /alter role authenticator set pgrst\.db_pre_request = 'public\.mcp_request_gate';/);
  assert.match(SQL, /create table if not exists public\.system_requests/);
});
