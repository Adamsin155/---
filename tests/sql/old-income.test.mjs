// supabase/migrations/20261123100000_old_income.sql in a real Postgres with every migration
// (tests/sql/pg.mjs; docs/ops.md, section 86), with fake rows:
//   - the file is the newest, only adds, has no rows, and runs twice;
//   - only the owners read; everyone else, Irit and Ofir included, and anon: nothing; nobody writes;
//   - a connected app's token is refused by the gate; the table is not in Realtime or in the tools;
//   - the owner's SQL (scripts/old-income-sql.mjs) runs twice, keeps odd text whole, adds no twin.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql, migrationFiles } from './pg.mjs';
import { TABLES } from '../../supabase/functions/ask/tools.js';
import { GATE_HEADER } from '../../supabase/functions/mcp/handler.js';
import { ownerSql, literal } from '../../scripts/old-income-sql.mjs';

const FILE = '20261123100000_old_income.sql';
const SQL = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
const PEOPLE = { owner: null, owner2: null, irit: 'irit', ofir: 'ofir', lior: 'lior', ilai: 'ilai', stav: 'stav', anna: 'anna' };
const OTHERS = ['irit', 'ofir', 'lior', 'ilai', 'stav', 'anna'];
const ODD = [
  { old_id: 'o1', deal_date: '2026-03-05', business: 'מסעדת ה\'שף של "דני" $$ $tag$ \\ ; -- בע״מ', amount: 1000, retainer: 500, package: 'סושיאל + ריטיינר', influencer_group: 'נטלי', payment_method: null, close_type: null, lead_source: null },
  { old_id: 'o2', deal_date: null, business: null, amount: 2000, retainer: 0, package: null, influencer_group: 'ללא', payment_method: 'אשראי', close_type: 'טלפון', lead_source: null },
];
let db;
const users = {};

async function tryAs(who, sql, params = []) {
  const user = who === 'anon' ? null : users[who];
  const role = user ? 'authenticated' : 'anon';
  const claims = user ? { sub: user.id, email: user.email, role, aud: 'authenticated' } : { role };
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      return (await tx.query(sql, params)).rows;
    });
  } catch (err) { return { error: err.message }; }
}

before(async () => {
  db = await freshDatabase();
  // Where the bookkeeping of the Supabase CLI lives on the live project.
  await db.exec('create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);');
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
});

test('the file: the newest, only adds, no rows in it, and runs twice', async () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), []);
  assert.equal(SQL.match(/drop|delete|truncate/gi), null);
  assert.doesNotMatch(SQL, /insert\s+into/i);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  const { rows } = await db.query("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'old_income_deals'");
  assert.equal(rows[0].n, 1);
});

test('the owner\'s SQL: runs twice; the text comes back exactly; nothing doubled; it says what to expect', async () => {
  const text = ownerSql(SQL, ODD);
  assert.ok(text.startsWith(SQL.trimEnd()), 'the migration first');
  assert.match(text, /on conflict \(old_id\) do nothing;/);
  assert.match(text, /insert into supabase_migrations\.schema_migrations \(version, name\) values \('20261123100000', 'old_income'\) on conflict \(version\) do nothing;/);
  assert.ok(text.includes('as "שורות (צריך 2)"'));
  assert.ok(text.includes('as "סכום (צריך 3,000)"'));
  assert.equal(text.charCodeAt(0) === 0xFEFF, false);
  await db.exec(text);
  // A second time, after someone corrected nothing: the same rows, and what is there is not overwritten.
  await db.exec(text);
  const { rows } = await db.query('select * from public.old_income_deals order by old_id');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].business, ODD[0].business);
  assert.equal(rows[0].package, ODD[0].package);
  assert.equal(rows[1].business, null);
  assert.equal(rows[1].deal_date, null);
  assert.deepEqual(rows.map((r) => r.amount), [1000, 2000]);
  const kept = await db.query("select name from supabase_migrations.schema_migrations where version = '20261123100000'");
  assert.deepEqual(kept.rows, [{ name: 'old_income' }]);
  const check = await db.query('select count(*)::int as n, sum(amount)::int as s from public.old_income_deals');
  assert.deepEqual(check.rows[0], { n: 2, s: 3000 });
});

test('the literals: only whole numbers; a quote doubled; no NUL; no rows, no file', () => {
  assert.equal(literal(null), 'null');
  assert.equal(literal(5), '5');
  assert.equal(literal("a'b"), "'a''b'");
  assert.throws(() => literal(1.5));
  assert.throws(() => literal('a\0b'));
  assert.throws(() => ownerSql(SQL, []));
  assert.throws(() => ownerSql(SQL, [{ ...ODD[0], amount: '1000' }]));
});

test('who reads: the two owners, every row', async () => {
  for (const who of ['owner', 'owner2']) assert.equal((await tryAs(who, 'select * from public.old_income_deals')).length, 2, who);
});

test('everyone else: nothing, Irit and Ofir included; from outside, not even the table', async () => {
  for (const who of OTHERS) assert.deepEqual(await tryAs(who, 'select * from public.old_income_deals'), [], who);
  assert.match((await tryAs('anon', 'select * from public.old_income_deals')).error, /permission denied/);
});

test('nobody writes, not even an owner', async () => {
  for (const who of ['owner', ...OTHERS, 'anon']) {
    assert.match((await tryAs(who, "insert into public.old_income_deals (old_id, amount) values ('new', 1)")).error, /permission denied/, who);
    assert.match((await tryAs(who, 'update public.old_income_deals set amount = 0')).error, /permission denied/, who);
    assert.match((await tryAs(who, 'delete from public.old_income_deals')).error, /permission denied/, who);
    assert.match((await tryAs(who, 'truncate public.old_income_deals')).error, /permission denied/, who);
  }
  const { rows } = await db.query('select count(*)::int as n, sum(amount)::int as s from public.old_income_deals');
  assert.deepEqual(rows[0], { n: 2, s: 3000 });
});

test('the privileges: select, and for no one else anything more; row level security is on', async () => {
  const { rows } = await db.query(`select grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'old_income_deals' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC') order by 1, 2`);
  assert.deepEqual(rows, [{ grantee: 'authenticated', privilege_type: 'SELECT' }, { grantee: 'service_role', privilege_type: 'SELECT' }]);
  const rls = await db.query("select relrowsecurity as on from pg_class where oid = 'public.old_income_deals'::regclass");
  assert.equal(rls.rows[0].on, true);
});

test('a connected app\'s token is refused by the gate, with the function\'s key too, even an owner\'s', async () => {
  const KEY = (await db.query('select public.mcp_gate_key() as k')).rows[0].k;
  const gate = (method, headers) => db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    const set = (k, v) => tx.query('select set_config($1, $2, true)', [k, v]);
    await set('request.jwt.claims', JSON.stringify({ sub: users.owner.id, email: users.owner.email, role: 'authenticated', aud: 'authenticated', client_id: 'claude-client' }));
    await set('request.method', method);
    await set('request.path', '/old_income_deals');
    await set('request.headers', JSON.stringify(headers));
    await tx.query('select public.mcp_request_gate()');
  });
  for (const method of ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']) {
    await assert.rejects(gate(method, { [GATE_HEADER]: KEY }), /connected app/, method);
    await assert.rejects(gate(method, {}), /connected app/, method);
  }
});

test('not on the gate\'s list, not in the tools of `ask`, not in Realtime', async () => {
  const gateSql = readFileSync(new URL('../../supabase/migrations/20261121100000_mcp.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(gateSql, /old_income/);
  assert.equal(TABLES.includes('old_income_deals'), false);
  assert.doesNotMatch(readFileSync(new URL('../../supabase/functions/ask/tools.js', import.meta.url), 'utf8'), /old_income/);
  assert.doesNotMatch(SQL.replace(/^--.*$/gm, ''), /realtime|publication/i);
  const { rows } = await db.query("select count(*)::int as n from pg_publication_tables where tablename = 'old_income_deals'");
  assert.equal(rows[0].n, 0);
});

test('nothing hangs on it: no trigger, no foreign key to or from it, no function names it', async () => {
  const triggers = await db.query("select count(*)::int as n from pg_trigger where tgrelid = 'public.old_income_deals'::regclass and not tgisinternal");
  assert.equal(triggers.rows[0].n, 0);
  const keys = await db.query("select count(*)::int as n from pg_constraint where contype = 'f' and (conrelid = 'public.old_income_deals'::regclass or confrelid = 'public.old_income_deals'::regclass)");
  assert.equal(keys.rows[0].n, 0);
  const fns = await db.query("select count(*)::int as n from pg_proc where strpos(prosrc, 'old_income') > 0");
  assert.equal(fns.rows[0].n, 0);
});
