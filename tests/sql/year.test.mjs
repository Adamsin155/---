// The package year in a real Postgres (PGlite, every migration applied):
// supabase/migrations/20260930190000_year.sql.
//  - The protocol version a client started under: stamped at insert, kept on
//    update, the database's current version is app/protocol.js's, and the clients
//    that existed before the migration read as the version of their day (≤ 4).
//  - The monthly cycle's marks: the office only; who and when from the session;
//    the key shape; unmarking.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { PROTOCOL_VERSION } from '../../app/protocol.js';
import { MARK_ITEM, MONTH_ITEMS, SPREAD_ITEMS } from '../../app/year-logic.js';

const MIGRATION = '20260930190000_year.sql';
let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nirel: 'nirel', nadia: 'nadia', eli: 'eli' };
const RLS = /row-level security|violates|permission denied/i;

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, true)', [email, person]);
  }
  const { rows } = await db.query("insert into public.clients (name, shoot_type, editor) values ('edited', 'dms', 'nadia') returning id, protocol_version");
  ids.edited = rows[0].id;
  assert.equal(rows[0].protocol_version, PROTOCOL_VERSION);
});

const run = (who, sql, params = []) => as(db, who ? users[who] : null, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows ?? r.rows.length };
});

test('the database\'s current protocol version is app/protocol.js\'s', async () => {
  const { rows } = await db.query('select private.protocol_version_current() as v');
  assert.equal(rows[0].v, PROTOCOL_VERSION, 'raise private.protocol_version_current() in a migration with PROTOCOL_VERSION');
  const d = await db.query("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'protocol_version'");
  assert.equal(d.rows[0].column_default, String(PROTOCOL_VERSION), 'and the column default of clients.protocol_version');
  // Without a session (the service role) and without a value: the current version.
  const r = await db.query("insert into public.clients (name) values ('service') returning protocol_version");
  assert.equal(r.rows[0].protocol_version, PROTOCOL_VERSION);
});

test('a client starts under the current version; the browser never sets or changes it', async () => {
  const r = await run('irit', "insert into public.clients (name, protocol_version) values ('x', 2) returning protocol_version");
  assert.equal(r.rows[0].protocol_version, PROTOCOL_VERSION);
  const u = await as(db, users.lior, async (tx) => {
    await tx.query('update public.clients set protocol_version = 1 where id = $1', [ids.edited]);
    return (await tx.query('select protocol_version from public.clients where id = $1', [ids.edited])).rows[0];
  });
  assert.equal(u.protocol_version, PROTOCOL_VERSION);
  // Without a session (the SQL editor, the service role) it can be set by hand.
  await db.query('update public.clients set protocol_version = 3 where id = $1', [ids.edited]);
  assert.equal((await db.query('select protocol_version from public.clients where id = $1', [ids.edited])).rows[0].protocol_version, 3);
  await db.query('update public.clients set protocol_version = $2 where id = $1', [ids.edited, PROTOCOL_VERSION]);
  const bad = await db.query('update public.clients set protocol_version = 0 where id = $1', [ids.edited]).catch((e) => e);
  assert.match(String(bad?.message), /protocol_version_check/);
});

test('clients from before the migration read as the version of the day they were opened, never the current one', async () => {
  const old = await freshDatabase({ upTo: MIGRATION });
  await old.exec('alter table public.clients disable trigger clients_touch');
  const at = {
    v1: '2026-09-29 12:00:00+00', v2: '2026-09-29 13:40:00+00', v3: '2026-09-29 15:00:00+00',
    v4: '2026-09-29 18:00:00+00', v4late: '2026-10-04 09:00:00+00',
  };
  for (const [name, created] of Object.entries(at)) await old.query('insert into public.clients (name, created_at) values ($1, $2)', [name, created]);
  await old.query("insert into public.clients (name, created_at, protocol_version) values ('byhand', '2026-09-29 12:00:00+00', 3)");
  await old.exec('alter table public.clients enable trigger clients_touch');
  await old.exec(migrationSql(MIGRATION));
  const read = async () => Object.fromEntries((await old.query('select name, protocol_version from public.clients')).rows.map((r) => [r.name, r.protocol_version]));
  const want = { v1: 1, v2: 2, v3: 3, v4: 4, v4late: 4, byhand: 3 };
  assert.deepEqual(await read(), want);
  // Safe to run again; the migrations after it still load.
  await old.exec(migrationSql(MIGRATION));
  assert.deepEqual(await read(), want);
  for (const f of migrationFiles().filter((x) => x > MIGRATION)) await old.exec(migrationSql(f));
  await old.close();
});

test('month marks: the office reads and writes them, stamped by the session; nobody else sees them', async () => {
  const insert = "insert into public.client_month_marks (client_id, month, item, state, by_email, at) values ($1, 3, 'plan', 'done', 'x@y', '2000-01-01') returning by_email, at > now() - interval '1 minute' as fresh";
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) {
    const r = await run(who, insert, [ids.edited]);
    assert.equal(r.rows?.[0]?.by_email, `${who}@astrateg.test`, who);
    assert.equal(r.rows[0].fresh, true, who);
  }
  for (const who of ['nadia', 'nirel', 'eli']) assert.match((await run(who, insert, [ids.edited])).error, RLS, who);
  assert.match((await run(null, insert, [ids.edited])).error, RLS);
  await db.query("insert into public.client_month_marks (client_id, month, item, state) values ($1, 4, 'report', 'done')", [ids.edited]);
  for (const who of ['nadia', 'eli']) assert.deepEqual((await run(who, 'select * from public.client_month_marks')).rows, [], who);
  assert.equal((await run('ilai', 'select * from public.client_month_marks')).rows.length, 1);
  // Unmarking deletes it (the office); the table is never emptied from the browser.
  assert.equal((await run('ofir', "delete from public.client_month_marks where month = 4 and item = 'report'")).affected, 1);
  assert.equal((await run('nadia', "delete from public.client_month_marks where month = 4 and item = 'report'")).affected, 0);
  assert.match((await run('irit', 'truncate public.client_month_marks')).error, RLS);
});

test('month marks: the item and month shapes the app uses, and nothing else', async () => {
  const keys = [...MONTH_ITEMS.map((i) => i.key), ...SPREAD_ITEMS.flatMap((i) => [`${i.key}.1`, `${i.key}.12`])];
  for (const k of keys) {
    assert.ok(MARK_ITEM.test(k), k);
    const r = await run('irit', "insert into public.client_month_marks (client_id, month, item, state) values ($1, 2, $2, 'na') returning item", [ids.edited, k]);
    assert.equal(r.rows?.[0]?.item, k, k);
  }
  for (const k of ['Plan', 'plan.x', 'ch14.123', '1plan', 'plan..1', 'p34.state; drop']) {
    assert.ok(!MARK_ITEM.test(k), k);
    assert.match((await run('irit', "insert into public.client_month_marks (client_id, month, item, state) values ($1, 2, $2, 'done')", [ids.edited, k])).error, /check constraint/, k);
  }
  for (const m of [0, 121]) {
    assert.match((await run('irit', "insert into public.client_month_marks (client_id, month, item, state) values ($1, $2, 'plan', 'done')", [ids.edited, m])).error, /check constraint/, String(m));
  }
  assert.match((await run('irit', "insert into public.client_month_marks (client_id, month, item, state) values ($1, 2, 'plan', 'maybe')", [ids.edited])).error, /check constraint/);
});
