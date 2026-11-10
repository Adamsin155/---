// Protocol version 13 (supabase/migrations/20261208120000_protocol_v13.sql; the owner's decisions of
// 9.11.2026; docs/ops.md, section 119), in a real Postgres with every migration:
//   - the version and the column default;
//   - the writers table is the app's: Eli writes his one drive check and his notes for the editor,
//     Ilai the system's scheduling mark (gantt.html), nobody outside the office a retired item;
//   - the system's scheduling mark, written as the reminders function writes it (insert, never over a
//     mark that exists), is written once;
//   - the file has none of the refused words, every UPDATE has a WHERE, and it runs twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { PROTOCOL_VERSION } from '../../app/protocol.js';
import { latestBlock } from '../../scripts/protocol-writers.mjs';

const FILE = '20261208120000_protocol_v13.sql';
const PEOPLE = { owner: null, irit: 'irit', ilai: 'ilai', eli: 'eli', nadia: 'nadia' };
let db;
const users = {};

const addClient = async (name, fields = {}) => {
  const cols = ['name', 'business', 'status', ...Object.keys(fields)];
  const vals = [name, name, 'active', ...Object.values(fields)];
  return (await db.query(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals)).rows[0].id;
};
// A write as `who`: true when the database took it.
const writes = async (who, client, key) => {
  const r = await as(db, users[who], (tx) => tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done')", [client, key]));
  return !r?.error;
};

before(async () => {
  db = await freshDatabase({ upTo: FILE });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  await db.exec(migrationSql(FILE));
});

test('the file: none of the refused words, every UPDATE with a WHERE, no table or policy, the writers block', () => {
  const sql = migrationSql(FILE);
  assert.deepEqual(sql.match(/\b(drop|delete|truncate)\b/gi), null);
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  assert.deepEqual(sql.replace(/--[^\n]*/g, '').match(/create\s+(table|policy|index|type|trigger)/gi), null);
  assert.equal(latestBlock().file, '20261209100000_remove_noam.sql'); // written again when Noam left (10.11.2026)
});

test('version 13: the function, the column default, a new client', async () => {
  assert.equal(PROTOCOL_VERSION, 13);
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 13);
  const d = await db.query("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'protocol_version'");
  assert.equal(d.rows[0].column_default, '13');
  const c = await addClient('חדש');
  assert.equal((await db.query('select protocol_version from public.clients where id = $1', [c])).rows[0].protocol_version, 13);
});

test('who writes: Eli his merged check and his notes, not a retired item; Ilai the scheduling mark; Irit everything', async () => {
  // Eli sees a client around its shoot day only (private.my_clients): the shoot is today.
  const c = await addClient('צילום', { shoot_type: 'dms', editor: 'nadia', shoot_at: new Date().toISOString(), rounds: JSON.stringify([{ n: 2, shoot_at: new Date().toISOString(), start_at: new Date().toISOString() }]) });
  assert.equal(await writes('eli', c, 'p19b.checked'), true);
  assert.equal(await writes('eli', c, 'r2.p19b.checked'), true);
  assert.equal(await writes('eli', c, 'p19b.notes'), true);
  assert.equal(await writes('eli', c, 'p17b.arrived'), false, 'retired: no longer his');
  assert.equal(await writes('eli', c, 'p19b.cards'), false, 'retired: no longer his');
  assert.equal(await writes('ilai', c, 'p28.auto'), true);
  assert.equal(await writes('ilai', c, 'p29.filled'), false, 'retired: no longer his');
  assert.equal(await writes('ilai', c, 'p09.c.name'), false, 'retired: no longer his');
  assert.equal(await writes('nadia', c, 'p28.auto'), false);
  assert.equal(await writes('irit', c, 'p11.date'), true);
  assert.equal(await writes('irit', c, 'p01.sent'), true, 'the office writes every key, history too');
});

test('the scheduling mark, as the reminders function writes it, is written once', async () => {
  const c = await addClient('גאנט');
  const put = () => db.query(`insert into public.protocol_checks (client_id, item_key, state, note)
    values ($1, 'p28.auto', 'done', 'נסגר אוטומטית: כל התכנים בגאנט תוזמנו') on conflict (client_id, item_key) do nothing`, [c]);
  await put();
  const first = (await db.query("select at from public.protocol_checks where client_id = $1 and item_key = 'p28.auto'", [c])).rows[0].at;
  await put();
  const rows = (await db.query("select at from public.protocol_checks where client_id = $1 and item_key = 'p28.auto'", [c])).rows;
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].at), String(first));
});

test('it runs twice', async () => {
  await db.exec(migrationSql(FILE));
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 13);
});
