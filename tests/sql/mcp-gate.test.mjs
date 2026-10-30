// The gate in supabase/migrations/20261121100000_mcp.sql, in a real Postgres (tests/sql/pg.mjs), with the
// request.* settings as PostgREST sets them before it calls a pre-request function (docs/ops.md, section 84):
//   - a browser session, the service role and anon pass, whatever else is in the request, reading no table;
//   - a connected app's token passes only with the function's key, and only for GET or HEAD on the listed
//     tables and POST on the listed rpcs; the lists are the code's own;
//   - it is what PostgREST is told to call, the way back is one line, and Storage has its own rule.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase } from './pg.mjs';
import { TABLES, NEVER } from '../../supabase/functions/ask/tools.js';
import { GATE_RPCS, GATE_HEADER } from '../../supabase/functions/mcp/handler.js';

const SQL = readFileSync(new URL('../../supabase/migrations/20261121100000_mcp.sql', import.meta.url), 'utf8');
let db;
let KEY;
const APP = { sub: 'u1', email: 'o@astrateg.test', role: 'authenticated', aud: 'authenticated', client_id: 'claude-client' };
const BROWSER = { sub: 'u1', email: 'o@astrateg.test', role: 'authenticated', aud: 'authenticated' };

before(async () => {
  db = await freshDatabase();
  KEY = (await db.query('select public.mcp_gate_key() as k')).rows[0].k;
});

// The gate as PostgREST calls it: as the request's role, with its settings. { ok } or { error }.
async function gate({ claims, method = 'GET', path = '/clients', headers, role = 'authenticated' }) {
  try {
    await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      const set = (k, v) => tx.query('select set_config($1, $2, true)', [k, v]);
      await set('request.jwt.claims', claims === undefined ? '' : typeof claims === 'string' ? claims : JSON.stringify(claims));
      await set('request.method', method);
      await set('request.path', path);
      await set('request.headers', headers === undefined ? JSON.stringify({ [GATE_HEADER]: KEY }) : typeof headers === 'string' ? headers : JSON.stringify(headers));
      await tx.query('select public.mcp_request_gate()');
    });
    return { ok: true };
  } catch (err) { return { error: err.message, code: err.code }; }
}
const passes = async (r) => assert.deepEqual(await gate(r), { ok: true }, JSON.stringify(r));
const refused = async (r) => {
  const out = await gate(r);
  assert.equal(out.code, '42501', JSON.stringify(r));
  assert.match(out.error, /connected app/);
};

test('browser sessions, the service role and anon pass, whatever they ask, with no key', async () => {
  for (const [method, path] of [['GET', '/client_access'], ['POST', '/clients'], ['PATCH', '/clients'], ['DELETE', '/staff'], ['POST', '/rpc/access_reveal'], ['GET', '/payout_deals'], ['GET', '/']]) {
    await passes({ claims: BROWSER, method, path, headers: '{}' });
    await passes({ claims: { role: 'service_role' }, method, path, headers: '{}', role: 'service_role' });
    await passes({ claims: { role: 'anon' }, method, path, headers: '{}', role: 'anon' });
  }
});

test('that path cannot break: empty, missing, odd or broken claims and headers', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const claims of [undefined, '', '{}', 'null', '[]', '5', 'not json', '{"client_id"', '{"client_id":null}', '{"client_id":""}', '{"client_id":5,"x"', '{"user_metadata":{"client_id":"x"}}', '{"app_metadata":{"client_id":"x"}}']) {
      await passes({ claims, method: 'POST', path: '/clients', headers: 'not json', role });
    }
  }
  // No setting at all (a connection that is not PostgREST's, or a test).
  await db.transaction(async (tx) => {
    await tx.query('select public.mcp_request_gate()');
  });
});

test('that path reads no table: it runs with the key table out of its reach', () => {
  const body = /function public\.mcp_request_gate\(\)[\s\S]*?end \$\$;/.exec(SQL)[0];
  const first = body.indexOf('return;');
  assert.ok(first > 0 && !/\bfrom\b/.test(body.slice(0, first)), 'nothing is read before the first return');
  assert.ok(body.indexOf('private.mcp_gate') > first);
});

test('a connected app with the key: every table of the tools, GET and HEAD', async () => {
  for (const t of TABLES) {
    await passes({ claims: APP, method: 'GET', path: `/${t}` });
    await passes({ claims: APP, method: 'HEAD', path: `/${t}` });
  }
  for (const fn of GATE_RPCS) await passes({ claims: APP, method: 'POST', path: `/rpc/${fn}` });
});

test('the lists in the gate are exactly the code\'s, and nothing the tools\' wall forbids', () => {
  const body = /function public\.mcp_request_gate\(\)[\s\S]*?end \$\$;/.exec(SQL)[0];
  const quoted = [...body.matchAll(/'\/([a-z_/]+)'/g)].map((m) => m[1]);
  const rpcs = quoted.filter((q) => q.startsWith('rpc/')).map((q) => q.slice(4));
  const tables = quoted.filter((q) => !q.startsWith('rpc/'));
  assert.deepEqual([...tables].sort(), [...TABLES].sort());
  assert.deepEqual([...rpcs].sort(), [...GATE_RPCS].sort());
  for (const t of tables) assert.ok(!NEVER.test(t), t);
  assert.equal(new RegExp(`'${GATE_HEADER}'`).test(body), true, 'the header the function sends');
});

test('a connected app: anything sensitive or unlisted is refused, even with the key', async () => {
  for (const path of [
    '/client_access', '/client_access_links', '/client_access_log', '/vault_code', '/vault_unlocks', '/staff', '/payout_deals', '/payout_owners',
    '/whatsapp_consents', '/whatsapp_settings', '/mcp_access', '/mcp_usage', '/editor_progress_log', '/', '', '/clients/', '/CLIENTS', '/clients/x', '/rpc',
  ]) {
    await refused({ claims: APP, method: 'GET', path });
  }
  for (const fn of ['access_reveal', 'vault_unlock', 'whatsapp_settings', 'mcp_set_access', 'mcp_people', 'mcp_gate_key', 'graphql', 'nope', 'is_office/x']) {
    await refused({ claims: APP, method: 'POST', path: `/rpc/${fn}` });
  }
});

test('a connected app: every write is refused, on the listed tables too', async () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    for (const t of TABLES) await refused({ claims: APP, method, path: `/${t}` });
  }
  for (const fn of GATE_RPCS) {
    await refused({ claims: APP, method: 'GET', path: `/rpc/${fn}` });
    await refused({ claims: APP, method: 'DELETE', path: `/rpc/${fn}` });
  }
  await refused({ claims: APP, method: '', path: '/clients' });
});

test('a connected app without the function\'s key: refused everywhere, also on a listed table', async () => {
  for (const headers of ['{}', '', 'not json', 'null', JSON.stringify({ [GATE_HEADER]: 'guess' }), JSON.stringify({ [GATE_HEADER]: '' }), JSON.stringify({ [GATE_HEADER]: `${KEY}x` }), JSON.stringify({ authorization: KEY })]) {
    await refused({ claims: APP, method: 'GET', path: '/clients', headers });
    await refused({ claims: APP, method: 'POST', path: '/rpc/is_office', headers });
  }
});

test('the key: for the service role alone, long, and stays the same when the file runs again', async () => {
  assert.ok(KEY.length >= 64);
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await tx.query('select public.mcp_gate_key()');
    }), /permission denied/, role);
    await assert.rejects(db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await tx.query('select * from private.mcp_gate');
    }), /permission denied/, role);
  }
  await db.exec(SQL);
  assert.equal((await db.query('select public.mcp_gate_key() as k')).rows[0].k, KEY);
  const n = (await db.query('select count(*)::int as n from private.mcp_gate')).rows[0].n;
  assert.equal(n, 1);
});

test('PostgREST is told to call it, and the way back is in the file and in the docs', async () => {
  const { rows } = await db.query("select unnest(s.setconfig) as c from pg_db_role_setting s join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator'");
  assert.ok(rows.some((r) => r.c === 'pgrst.db_pre_request=public.mcp_request_gate'), JSON.stringify(rows));
  assert.match(SQL, /notify pgrst, 'reload config';\s*$/);
  const back = "alter role authenticator reset pgrst.db_pre_request";
  assert.ok(SQL.includes(back));
  assert.ok(readFileSync(new URL('../../docs/ops.md', import.meta.url), 'utf8').includes(back));
  // It works, once.
  await db.exec(`${back}; notify pgrst, 'reload config';`);
  const after = await db.query("select count(*)::int as n from pg_db_role_setting s join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator'");
  assert.equal(after.rows[0].n, 0);
  await db.exec("alter role authenticator set pgrst.db_pre_request = 'public.mcp_request_gate'");
});

test('Storage: a connected app reads and writes no file; a browser session as before', async () => {
  await db.query("insert into storage.buckets (id, name) values ('gate-test', 'gate-test') on conflict (id) do nothing");
  await db.query("insert into storage.objects (bucket_id, name) values ('gate-test', 'a.png')");
  // A policy that would let everyone in, so that the restrictive rule is what is under test.
  await db.exec('create policy "test: everyone" on storage.objects for all to authenticated using (true) with check (true)');
  const asRole = async (claims, sql) => {
    let out;
    await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      try { out = await tx.query(sql); } catch (err) { out = { error: err.message }; }
      await tx.rollback();
    });
    return out;
  };
  const read = "select name from storage.objects where bucket_id = 'gate-test'";
  const write = "insert into storage.objects (bucket_id, name) values ('gate-test', 'b.png')";
  assert.equal((await asRole(BROWSER, read)).rows.length, 1);
  assert.equal((await asRole(BROWSER, write)).error, undefined);
  assert.equal((await asRole(APP, read)).rows.length, 0);
  assert.match((await asRole(APP, write)).error, /row-level security/);
  assert.equal((await asRole(APP, "delete from storage.objects where bucket_id = 'gate-test'")).affectedRows, 0);
  await db.exec('drop policy "test: everyone" on storage.objects');
});
