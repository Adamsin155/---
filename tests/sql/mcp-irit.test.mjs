// supabase/migrations/20261218100000_mcp_irit.sql in a real Postgres with every migration
// (tests/sql/pg.mjs): Irit may be switched on for the Claude connector (17.11.2026), and nobody is
// switched on by the file itself.
//   - the people in the file equal MCP_PEOPLE (app/mcp-logic.js); it only replaces, and runs twice;
//   - Irit starts off; an owner switches her on, and then she is allowed; off again works at once;
//   - Ilai, Anna and the rest stay outside the switch; only an owner turns it.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql } from './pg.mjs';
import { MCP_PEOPLE } from '../../app/mcp-logic.js';

const FILE = '20261218100000_mcp_irit.sql';
const SQL = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
let db;
const users = {};

async function addPerson(key, person) {
  const email = `${key}@astrateg.test`;
  const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
  users[key] = { id: rows[0].id, email };
  await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
}

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

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries({ owner: null, lior: 'lior', ofir: 'ofir', irit: 'irit', ilai: 'ilai', anna: 'anna' })) await addPerson(key, person);
  // The owners, Lior and Ofir on, as the live database has them.
  for (const k of ['owner', 'lior', 'ofir']) await db.query('insert into public.mcp_access (email, enabled) values ($1, true) on conflict (email) do update set enabled = true', [users[k].email]);
});

test('the file: only replaces, the people are MCP_PEOPLE, runs twice', async () => {
  assert.equal(SQL.match(/\b(drop|delete|truncate|insert into public\.mcp_access \(email, enabled, updated_by\)\s+select)/gi), null);
  const lists = [...SQL.matchAll(/s\.person in \(([^)]*)\)/g)].map((m) => m[1].replace(/['\s]/g, '').split(','));
  assert.equal(lists.length, 3);
  for (const l of lists) assert.deepEqual(l, MCP_PEOPLE);
  await db.exec(migrationSql(FILE));
});

test('Irit starts off; an owner switches her on and off; the rest stay outside', async () => {
  for (const who of ['owner', 'lior', 'ofir']) assert.equal(await allowed(who), true, who);
  for (const who of ['irit', 'ilai', 'anna']) assert.equal(await allowed(who), false, who);
  // The owner's card lists her (off).
  const people = await tryAs('owner', 'select person, enabled from public.mcp_people()');
  assert.deepEqual(people.filter((p) => p.person === 'irit'), [{ person: 'irit', enabled: false }]);
  assert.ok(!people.some((p) => ['ilai', 'anna'].includes(p.person)));
  // Only an owner turns the switch; never for someone outside it.
  assert.match((await tryAs('lior', 'select public.mcp_set_access($1, true)', [users.irit.email])).error, /not allowed/);
  assert.match((await tryAs('owner', 'select public.mcp_set_access($1, true)', [users.ilai.email])).error, /not one of the people/);
  assert.ok(!(await tryAs('owner', 'select public.mcp_set_access($1, true)', [users.irit.email])).error);
  assert.equal(await allowed('irit'), true);
  assert.ok(!(await tryAs('owner', 'select public.mcp_set_access($1, false)', [users.irit.email])).error);
  assert.equal(await allowed('irit'), false);
});
