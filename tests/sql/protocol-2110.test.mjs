// Protocol version 11 (supabase/migrations/20261031110000_protocol_2110.sql; the owner's
// decisions of 21.10.2026) on every migration in a real Postgres (PGlite):
//   - the version, the column default and a new client;
//   - Ofir connects a client to its Metricool brand and marks "ללקוח אין מותג", as Ilai and
//     the owner do (public.can_connect_metricool() is the app's CONNECTORS); he still does not
//     edit the Gantt, and the old function stays closed to him;
//   - the writers table is the app's (p06.metricool: the office, Ofir among them; Ilai no more);
//   - the file is the newest, has none of the words the deploy tool refuses, and runs twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { PROTOCOL_VERSION } from '../../app/protocol.js';
import { CONNECTORS } from '../../app/metricool-connect-logic.js';
import { sqlBlock, latestBlock, mayWrite } from '../../scripts/protocol-writers.mjs';

const MIGRATION = '20261031110000_protocol_2110.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', stav: 'stav' };
const DENIED = /row-level security|violates|permission denied|not allowed/i;
let db;
const users = {};
const ids = {};

const run = (who, sql, params = []) => as(db, who ? users[who] : null, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows ?? r.rows.length };
});

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  await db.exec(migrationSql(MIGRATION));
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  const add = async (name) => (await db.query(
    "insert into public.clients (name, business, shoot_type, editor, status, deal_at, contract_end) values ($1, $1, 'dms', 'nadia', 'active', now(), '2027-03-15') returning id", [name])).rows[0].id;
  ids.a = await add('מספרת רון');
  ids.b = await add('קפה נדיה');
});

test('the file: the newest, none of the refused words, every UPDATE with a WHERE, and the writers block the app generates', () => {
  const files = migrationFiles();
  assert.equal(files.at(-1), MIGRATION);
  const sql = migrationSql(MIGRATION);
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  assert.deepEqual(sql.replace(/--[^\n]*/g, '').match(/create\s+(table|policy|trigger|index|type)/gi), null);
  assert.deepEqual([latestBlock().file, latestBlock().block === sqlBlock()], [MIGRATION, true]);
});

test('version 11: the function, the column default, a new client', async () => {
  assert.equal(PROTOCOL_VERSION, 11);
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 11);
  const d = await db.query("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'protocol_version'");
  assert.equal(d.rows[0].column_default, '11');
  assert.equal((await db.query('select protocol_version from public.clients where id = $1', [ids.a])).rows[0].protocol_version, 11);
});

test('who connects to Metricool: Ofir, Ilai and the owner (the app\'s CONNECTORS); Ofir does not edit the Gantt', async () => {
  assert.deepEqual(CONNECTORS, ['owner', 'ofir', 'ilai']);
  for (const [who, person] of Object.entries(PEOPLE)) {
    const can = (await run(who, 'select public.can_connect_metricool() as ok')).rows[0].ok;
    assert.equal(can, CONNECTORS.includes(person ?? 'owner'), who);
    const r = await run(who, "select public.metricool_connect($1, '101', 'מספרת רון') as b", [ids.a]);
    if (can) assert.deepEqual(r.rows[0].b, { blogId: '101', brand: 'מספרת רון' }, who);
    else assert.match(r.error, DENIED, who);
    const n = await run(who, 'select public.metricool_set_none($1, true) as r', [ids.b]);
    if (can) assert.deepEqual(n.rows[0].r, { none: true }, who);
    else assert.match(n.error, DENIED, who);
  }
  assert.match((await run(null, "select public.metricool_connect($1, '101')", [ids.a])).error, /permission denied/);
  // Who edits the Gantt did not change: Ilai and the owner. Ofir cannot call the old function nor write an entry.
  const edits = async (who) => (await run(who, 'select public.can_edit_gantt() as ok')).rows[0].ok;
  assert.deepEqual(await Promise.all(Object.keys(PEOPLE).map(edits)), [true, false, false, false, true, false, false]);
  assert.match((await run('ofir', "select public.gantt_set_brand($1, '101')", [ids.a])).error, DENIED);
  const INS = "insert into public.client_gantt (client_id, key, kind, title, day, time_il) values ($1, 'video.1', 'video', 'סרטון', '2026-11-15', '19:00') returning key";
  assert.match((await run('ofir', INS, [ids.a])).error, DENIED);
  // Inside the one call the flag is set, and after it the Gantt is closed to him again.
  const after = await as(db, users.ofir, async (tx) => {
    await tx.query("select public.metricool_connect($1, '101', 'x')", [ids.a]);
    return (await tx.query('select public.can_edit_gantt() as ok')).rows[0].ok;
  });
  assert.equal(after, false);
  // Kept: one brand, one client, as before.
  const keep = await db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users.ofir.id, email: users.ofir.email, role: 'authenticated' })]);
    return (await tx.query("select public.metricool_connect($1, '201', 'Cafe') as b", [ids.b])).rows[0].b;
  });
  assert.deepEqual(keep, { blogId: '201', brand: 'Cafe' });
  assert.match((await run('ilai', "select public.metricool_connect($1, '201', 'x')", [ids.a])).error, /brand_taken/);
  assert.deepEqual((await db.query('select metricool_blog_id as b, metricool_none as n from public.clients where id = $1', [ids.b])).rows[0], { b: '201', n: false });
});

test('p06.metricool: the office writes it (Ofir among them), Ilai no more; the file runs twice', async () => {
  const insert = (who, key) => as(db, users[who], async (tx) => (await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done') returning item_key", [ids.a, key])).rows.length).catch(() => 0);
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai', 'nadia']) {
    for (const key of ['p06.metricool', 'p06.name']) {
      const app = mayWrite({ person: who === 'owner' ? null : who, client: { editor: 'nadia' }, key });
      assert.equal((await insert(who, key)) === 1, app, `${who} ${key}`);
    }
  }
  assert.equal(mayWrite({ person: 'ofir', client: {}, key: 'p06.metricool' }), true);
  assert.equal(mayWrite({ person: 'ilai', client: {}, key: 'p06.metricool' }), false);
  assert.equal(mayWrite({ person: 'ilai', client: {}, key: 'p06.name' }), true);
  const writers = (await db.query('select key, proc, round, persons from private.protocol_writers order by key')).rows;
  assert.deepEqual(writers.find((r) => r.key === 'p06.metricool')?.persons ?? [], []);
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
  assert.deepEqual((await db.query('select key, proc, round, persons from private.protocol_writers order by key')).rows, writers);
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 11);
});
