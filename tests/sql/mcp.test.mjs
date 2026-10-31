// supabase/migrations/20261121100000_mcp.sql in a real Postgres with every migration
// (tests/sql/pg.mjs): who is switched on for Claude accounts, and what is kept of their use.
//   - the file is the newest, only adds, and runs twice (a person switched off stays off);
//   - seeded on for the owners, Lior and Ofir, and nobody else; the people equal MCP_PEOPLE;
//   - the switch works at once; only an owner, and not with a connected app's token;
//   - the usage table has no room for arguments, only the service role writes, the owners read.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql, migrationFiles } from './pg.mjs';
import { MCP_PEOPLE } from '../../app/mcp-logic.js';

const FILE = '20261121100000_mcp.sql';
const SQL = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
let db;
const users = {};

async function addPerson(key, person) {
  const email = `${key}@astrateg.test`;
  const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
  users[key] = { id: rows[0].id, email };
  await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
}

before(async () => {
  db = await freshDatabase();
  // Everyone was on the staff before the file ran on the live database: the seed is what is under test.
  await db.query("delete from public.mcp_access");
  for (const [key, person] of Object.entries({ owner: null, owner2: null, lior: 'lior', ofir: 'ofir', irit: 'irit', anna: 'anna' })) await addPerson(key, person);
  await db.exec(migrationSql(FILE));
});

// As tests/sql/pg.mjs's `as`, but what it does stays (the switch has to last to the next call).
async function tryAs(who, sql, params = []) {
  const u = users[who];
  try {
    return await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated' })]);
      return (await tx.query(sql, params)).rows;
    });
  } catch (err) { return { error: err.message }; }
}
const allowed = async (who) => (await tryAs(who, 'select public.mcp_allowed() as ok'))[0].ok;

test('the file: the newest, only adds, and runs twice', async () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261122100000_deal_pool.sql']);
  assert.equal(SQL.match(/drop|delete|truncate/gi), null);
  await db.exec(migrationSql(FILE));
  const { rows } = await db.query('select count(*)::int as n from public.mcp_access');
  assert.equal(rows[0].n, 4);
});

test('the people in the file are app/mcp-logic.js\'s', () => {
  const lists = [...SQL.matchAll(/s\.person in \(([^)]*)\)/g)].map((m) => m[1].replace(/['\s]/g, '').split(','));
  assert.equal(lists.length, 4);
  for (const l of lists) assert.deepEqual(l, MCP_PEOPLE);
});

test('seeded on for the owners, Lior and Ofir; nobody else', async () => {
  for (const who of ['owner', 'owner2', 'lior', 'ofir']) assert.equal(await allowed(who), true, who);
  for (const who of ['irit', 'anna']) assert.equal(await allowed(who), false, who);
  const { rows } = await db.query('select email from public.mcp_access order by email');
  assert.deepEqual(rows.map((r) => r.email), ['lior', 'ofir', 'owner', 'owner2'].map((k) => `${k}@astrateg.test`).sort());
});

test('someone who left the staff is off, whatever the table says', async () => {
  await addPerson('gone', 'ofir');
  await db.query("insert into public.mcp_access (email, enabled) values ('gone@astrateg.test', true)");
  assert.equal(await allowed('gone'), true);
  await db.query("delete from public.staff where email = 'gone@astrateg.test'");
  assert.equal(await allowed('gone'), false);
  await db.query("delete from public.mcp_access where email = 'gone@astrateg.test'");
});

test('the switch: at once, by an owner; a person switched off stays off when the file runs again', async () => {
  const off = await tryAs('owner', 'select public.mcp_set_access($1, false)', [users.lior.email]);
  assert.equal(off.error, undefined);
  assert.equal(await allowed('lior'), false);
  const { rows } = await db.query('select updated_by from public.mcp_access where email = $1', [users.lior.email]);
  assert.equal(rows[0].updated_by, users.owner.email);
  await db.exec(migrationSql(FILE));
  assert.equal(await allowed('lior'), false, 'not turned on again');
  await tryAs('owner2', 'select public.mcp_set_access($1, true)', [users.lior.email]);
  assert.equal(await allowed('lior'), true);
});

test('the switch: nobody else, and only for the people of the switch', async () => {
  for (const who of ['lior', 'ofir', 'irit', 'anna']) {
    assert.match((await tryAs(who, 'select public.mcp_set_access($1, false)', [users.owner.email])).error, /not allowed/, who);
  }
  assert.match((await tryAs('owner', 'select public.mcp_set_access($1, true)', [users.irit.email])).error, /not one of the people/);
  assert.match((await tryAs('owner', "select public.mcp_set_access('nobody@astrateg.test', true)")).error, /not one of the people/);
  assert.equal(await allowed('irit'), false);
  // Nobody writes the table directly, not even an owner.
  assert.match((await tryAs('owner', 'update public.mcp_access set enabled = true returning email')).error, /permission denied/);
  assert.match((await tryAs('owner', "insert into public.mcp_access (email, enabled) values ('a@b.c', true)")).error, /permission denied/);
});

test('a connected app\'s token never moves the switch, even an owner\'s', async () => {
  const out = await db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users.owner.id, email: users.owner.email, role: 'authenticated', client_id: 'abc' })]);
    try { await tx.query('select public.mcp_set_access($1, false)', [users.lior.email]); return 'moved'; } catch (err) { return err.message; }
  });
  assert.match(out, /not allowed/);
  assert.equal(await allowed('lior'), true);
});

test('who reads: the owners; the others nothing, only their own yes or no', async () => {
  for (const who of ['owner', 'owner2']) assert.equal((await tryAs(who, 'select * from public.mcp_access')).length, 4, who);
  for (const who of ['lior', 'ofir', 'irit', 'anna']) {
    assert.deepEqual(await tryAs(who, 'select * from public.mcp_access'), [], who);
    assert.deepEqual(await tryAs(who, 'select * from public.mcp_people()'), [], who);
  }
});

test('the usage table: only who, tool, code, when; only the service role writes; the owners read', async () => {
  const cols = await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'mcp_usage' order by ordinal_position");
  assert.deepEqual(cols.rows.map((r) => r.column_name), ['id', 'email', 'tool', 'code', 'at']);
  assert.match((await tryAs('owner', "insert into public.mcp_usage (email, tool, code) values ('a', 'b', 'c')")).error, /permission denied/);
  assert.match((await tryAs('owner', 'update public.mcp_usage set code = 1::text')).error, /permission denied/);
  await db.query("insert into public.mcp_usage (email, tool, code, at) values ($1, 'team', 'ok', '2026-10-30T08:00:00Z'), ($1, 'team', 'not_allowed', '2026-10-30T09:00:00Z')", [users.ofir.email]);
  await assert.rejects(db.query("insert into public.mcp_usage (email, tool, code) values ('a', 'b', $1)", ['x'.repeat(33)]));
  assert.equal((await tryAs('owner', 'select * from public.mcp_usage')).length, 2);
  assert.deepEqual(await tryAs('ofir', 'select * from public.mcp_usage'), [], 'not even their own');
});

test('the card: each person, on or off, and the last use that worked', async () => {
  const list = await tryAs('owner', 'select * from public.mcp_people()');
  assert.deepEqual(list.map((r) => r.email).sort(), ['lior', 'ofir', 'owner', 'owner2'].map((k) => `${k}@astrateg.test`).sort());
  const ofir = list.find((r) => r.person === 'ofir');
  assert.equal(ofir.enabled, true);
  assert.equal(new Date(ofir.last_used).toISOString(), '2026-10-30T08:00:00.000Z');
  assert.equal(list.find((r) => r.person === 'lior').last_used, null);
});

test('from outside: nothing', async () => {
  const anon = await db.transaction(async (tx) => {
    await tx.query('set local role anon');
    const out = [];
    for (const sql of ['select public.mcp_allowed()', 'select * from public.mcp_people()', 'select * from public.mcp_access', 'select * from public.mcp_usage']) {
      await tx.query('savepoint s');
      try { await tx.query(sql); out.push('open'); } catch (err) { out.push(err.message); await tx.query('rollback to s'); }
    }
    return out;
  });
  for (const r of anon) assert.match(r, /permission denied/);
});
