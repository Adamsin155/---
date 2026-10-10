// Protocol version 7 in the database (supabase/migrations/20261009100000_highlights_upload.sql),
// on every migration in a real Postgres (PGlite): the version and the column default,
// Highlights that were ready before 8ב existed count as uploaded (imported history,
// only where process 8 is complete), running the migration again later closes nothing
// that is really waiting, and who writes the new item (Ofir and the office; not Ilai).
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { PROTOCOL_VERSION, PROCESSES } from '../../app/protocol.js';
import { writerRows, mayWrite } from '../../scripts/protocol-writers.mjs';

const MIGRATION = '20261009100000_highlights_upload.sql';
const KEY = 'p08b.posted';
let db;
const ids = {};
const users = {};
const check = (id, key, state = 'done', note = null) => db.query('insert into public.protocol_checks (client_id, item_key, state, note) values ($1, $2, $3, $4)', [id, key, state, note]);
const posted = async (id) => (await db.query('select state, note from public.protocol_checks where client_id = $1 and item_key = $2', [id, KEY])).rows;

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const name of ['ready', 'na', 'half', 'none', 'marked']) {
    const { rows } = await db.query("insert into public.clients (name, shoot_type) values ($1, 'dms') returning id, protocol_version", [name]);
    ids[name] = rows[0].id;
    assert.equal(rows[0].protocol_version, 6, 'before the migration');
  }
  // Process 8 complete: both items done; or one done and one "לא רלוונטי".
  await check(ids.ready, 'p08.done');
  await check(ids.ready, 'p08.saved');
  await check(ids.na, 'p08.done');
  await check(ids.na, 'p08.saved', 'na');
  // Not complete: one item only.
  await check(ids.half, 'p08.done');
  // Someone already marked the upload by hand: it stays as it is.
  await check(ids.marked, 'p08.done');
  await check(ids.marked, 'p08.saved');
  await check(ids.marked, KEY, 'done', 'הועלו');

  await db.exec(migrationSql(MIGRATION));

  for (const [key, person] of Object.entries({ owner: null, irit: 'irit', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia' })) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
});

test('the process exists once, Ofir\'s, with the one new key', () => {
  const p = PROCESSES.filter((x) => x.id === 'p08b');
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].items.map((i) => i.key), [KEY]);
  assert.deepEqual(p[0].owners, ['ofir']);
});

test('version 7: the function, the column default, a new client', async () => {
  // (This database stops at that migration; the protocol itself has moved on since.)
  assert.ok(PROTOCOL_VERSION >= 7);
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 7);
  const d = await db.query("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'protocol_version'");
  assert.equal(d.rows[0].column_default, '7');
  assert.equal((await db.query("insert into public.clients (name) values ('new') returning protocol_version")).rows[0].protocol_version, 7);
  // Clients that started before keep their version (the new item is "חדש בפרוטוקול" for them).
  assert.equal((await db.query('select protocol_version from public.clients where id = $1', [ids.half])).rows[0].protocol_version, 6);
});

test('Highlights ready before 8ב existed: uploaded, as imported history; an open process 8 is untouched', async () => {
  assert.deepEqual(await posted(ids.ready), [{ state: 'done', note: 'ייבוא' }]);
  assert.deepEqual(await posted(ids.na), [{ state: 'done', note: 'ייבוא' }]);
  assert.deepEqual(await posted(ids.half), []);
  assert.deepEqual(await posted(ids.none), []);
  assert.deepEqual(await posted(ids.marked), [{ state: 'done', note: 'הועלו' }]);
});

test('the migration runs again safely: nothing doubled, and an upload that is really waiting is not closed', async () => {
  // After the migration: the Highlights of two clients became ready (an older client and a new one).
  await check(ids.half, 'p08.saved');
  const { rows } = await db.query("insert into public.clients (name, shoot_type) values ('later', 'dms') returning id");
  ids.later = rows[0].id;
  await check(ids.later, 'p08.done');
  await check(ids.later, 'p08.saved');
  const before = (await db.query('select count(*)::int as n from public.protocol_checks')).rows[0].n;
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
  assert.equal((await db.query('select count(*)::int as n from public.protocol_checks')).rows[0].n, before);
  assert.deepEqual(await posted(ids.half), []);
  assert.deepEqual(await posted(ids.later), []);
  assert.deepEqual(await posted(ids.ready), [{ state: 'done', note: 'ייבוא' }]);
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 7);
});

test('who marks it: Ofir and the office; not Ilai or an editor (the database agrees with the app)', async () => {
  // No row of its own in the writers table: the office's alone.
  assert.deepEqual((await db.query("select key from private.protocol_writers where proc = 'p08b'")).rows, []);
  // The table as it stood at this migration: 86 rows (protocol v9 added one, p07.@qafixed: tests/sql/fast-ladder.test.mjs).
  assert.equal((await db.query('select count(*)::int as n from private.protocol_writers')).rows[0].n, 86);
  assert.ok(writerRows().length >= 86);
  for (const who of ['owner', 'irit', 'ofir', 'ilai', 'nadia']) {
    const person = who === 'owner' ? null : who;
    const app = mayWrite({ person, client: { editor: 'nadia', rounds: [] }, key: KEY });
    const r = await as(db, users[who], async (tx) => (await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done') returning item_key", [ids.later, KEY])).rows.length);
    assert.equal(r === 1, app, `${who}: ${JSON.stringify(r)}`);
    assert.equal(app, ['owner', 'irit', 'ofir'].includes(who), who);
  }
});
