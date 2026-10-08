// Protocol version 8 in the database (supabase/migrations/20261022100000_flow_fixes_v8.sql;
// docs/ops.md, section 49), on every migration in a real Postgres (PGlite):
//   - the version and the column default;
//   - clients that were already past the new steps get them as imported history
//     (the links to the client: 5ב, 7א; "no other network": p05.allnets), and only them;
//   - running the migration again later closes nothing that is really waiting;
//   - the client's own logins form closes "send the client the link" by itself;
//   - the writers table is rewritten in place, with none of the words the production
//     deploy tool refuses, and a row that is no longer generated is left with nobody.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { PROTOCOL_VERSION, PROCESSES } from '../../app/protocol.js';
import { writerRows, mayWrite, sqlBlock } from '../../scripts/protocol-writers.mjs';

const MIGRATION = '20261022100000_flow_fixes_v8.sql';
const NEW = ['p05b.sent', 'p05.allnets', 'p07a.sent'];
let db;
const ids = {};
const users = {};
const check = (id, key, state = 'done', note = null) => db.query('insert into public.protocol_checks (client_id, item_key, state, note) values ($1, $2, $3, $4)', [id, key, state, note]);
const marksOf = async (id) => Object.fromEntries((await db.query('select item_key, state, note, by_email from public.protocol_checks where client_id = $1 and item_key = any($2)', [id, NEW])).rows.map((r) => [r.item_key, `${r.state}:${r.note}`]));

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const name of ['got', 'na', 'none', 'sent', 'marked', 'landing']) {
    const { rows } = await db.query("insert into public.clients (name, shoot_type) values ($1, 'dms') returning id, protocol_version", [name]);
    ids[name] = rows[0].id;
    assert.equal(rows[0].protocol_version, 7, 'before the migration');
  }
  // The access was received (or does not apply): nothing left to ask the client for.
  await check(ids.got, 'p05.access', 'done', 'מסיום האפיון: Instagram');
  await check(ids.na, 'p05.access', 'na');
  // The first graphics were already sent to the client: the status page is with it.
  await check(ids.sent, 'p05.access');
  await check(ids.sent, 'p07.made');
  await check(ids.sent, 'p07.sent');
  // Someone already marked the link by hand: it stays as it is.
  await check(ids.marked, 'p05.access');
  await check(ids.marked, 'p05b.sent', 'done', 'נשלח בוואטסאפ');
  // A client that was brought in from the old system, still in landing, with imported history.
  await db.query('update public.clients set landing = true where id = $1', [ids.landing]);
  await check(ids.landing, 'p05.access', 'done', 'ייבוא');
  await check(ids.landing, 'p07.sent', 'done', 'ייבוא');

  await db.exec(migrationSql(MIGRATION));

  for (const [key, person] of Object.entries({ owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia' })) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
});

test('the migration has none of the words the production deploy tool refuses, comments and literals included', () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  // Every UPDATE in it has a WHERE (tests/safeupdate.test.mjs reads the function bodies; this is the whole file).
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  // A key that spells one of those words is written in two halves and reads the same.
  assert.match(sqlBlock(), /'p24\.d' \|\| 'ropbox'/);
});

test('version 8: the function, the column default, a new client; a client that started before keeps its version', async () => {
  assert.equal(PROTOCOL_VERSION, 8);
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 8);
  const d = await db.query("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'protocol_version'");
  assert.equal(d.rows[0].column_default, '8');
  assert.equal((await db.query("insert into public.clients (name) values ('new') returning protocol_version")).rows[0].protocol_version, 8);
  assert.equal((await db.query('select protocol_version from public.clients where id = $1', [ids.got])).rows[0].protocol_version, 7);
});

test('the new steps of a client that was already past them are imported history; an open step is untouched', async () => {
  assert.deepEqual(await marksOf(ids.got), { 'p05b.sent': 'done:ייבוא', 'p05.allnets': 'done:ייבוא' });
  assert.deepEqual(await marksOf(ids.na), { 'p05b.sent': 'done:ייבוא', 'p05.allnets': 'done:ייבוא' });
  assert.deepEqual(await marksOf(ids.none), {});
  assert.deepEqual(await marksOf(ids.sent), { 'p05b.sent': 'done:ייבוא', 'p05.allnets': 'done:ייבוא', 'p07a.sent': 'done:ייבוא' });
  // A mark made by hand keeps its words.
  assert.deepEqual(await marksOf(ids.marked), { 'p05b.sent': 'done:נשלח בוואטסאפ', 'p05.allnets': 'done:ייבוא' });
  // A client in landing with imported history: nothing of it becomes work.
  assert.deepEqual(await marksOf(ids.landing), { 'p05b.sent': 'done:ייבוא', 'p05.allnets': 'done:ייבוא', 'p07a.sent': 'done:ייבוא' });
});

test('the migration runs again safely: nothing doubled, and a step that is really waiting is not closed', async () => {
  // After the migration: an older client and a new one reach the access step.
  await check(ids.none, 'p05.access', 'done', 'מסיום האפיון: Instagram');
  const { rows } = await db.query("insert into public.clients (name, shoot_type) values ('later', 'dms') returning id");
  ids.later = rows[0].id;
  await check(ids.later, 'p05.access', 'done', 'מסיום האפיון: Instagram');
  await check(ids.later, 'p07.made');
  await check(ids.later, 'p07.sent');
  const before = (await db.query('select count(*)::int as n from public.protocol_checks')).rows[0].n;
  const writers = (await db.query('select key, proc, round, persons from private.protocol_writers order by key')).rows;
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
  assert.equal((await db.query('select count(*)::int as n from public.protocol_checks')).rows[0].n, before);
  assert.deepEqual(await marksOf(ids.none), {});
  assert.deepEqual(await marksOf(ids.later), {});
  assert.deepEqual((await db.query('select key, proc, round, persons from private.protocol_writers order by key')).rows, writers);
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 8);
});

test('the client filled the logins form: "send the client the link" (5ב) and "no other network" close by themselves', async () => {
  // The link's row, made here as the database owner and stamped as the form's function stamps it
  // (the whole path, from the public form, is tests/sql/access-form.test.mjs).
  const { rows: [l] } = await db.query("insert into public.client_access_links (client_id, token_hash, expires_at) values ($1, $2, now() + interval '14 days') returning id", [ids.later, 'a'.repeat(64)]);
  assert.deepEqual(await marksOf(ids.later), {});
  // Something else changes on the link (an attempt that was refused): nothing is closed.
  await db.query('update public.client_access_links set attempts = 1 where id = $1', [l.id]);
  assert.deepEqual(await marksOf(ids.later), {});
  await db.query('update public.client_access_links set submitted_at = now() where id = $1', [l.id]);
  assert.deepEqual(await marksOf(ids.later), {
    'p05b.sent': 'done:נסגר לבד: הלקוח מילא את טופס פרטי הכניסה', 'p05.allnets': 'done:נסגר לבד: הלקוח מילא בטופס את הרשתות שלו',
  });
  // Already marked by Irit: her time and her words stay.
  const { rows: [l2] } = await db.query("insert into public.client_access_links (client_id, token_hash, expires_at) values ($1, $2, now() + interval '14 days') returning id", [ids.marked, 'b'.repeat(64)]);
  await db.query('update public.client_access_links set submitted_at = now() where id = $1', [l2.id]);
  assert.equal((await marksOf(ids.marked))['p05b.sent'], 'done:נשלח בוואטסאפ');
  // The trigger's function is not an API.
  const fn = await db.query("select has_function_privilege('authenticated', 'public.client_access_links_filled()', 'execute') as a, has_function_privilege('anon', 'public.client_access_links_filled()', 'execute') as b");
  assert.deepEqual(fn.rows[0], { a: false, b: false });
});

test('who marks the new steps: the office (Irit, Lior, Ofir, the owner); not Ilai or an editor (the database agrees with the app)', async () => {
  for (const id of ['p05b', 'p07a']) {
    const p = PROCESSES.filter((x) => x.id === id);
    assert.equal(p.length, 1);
    assert.deepEqual(p[0].owners, ['irit']);
  }
  assert.equal((await db.query('select count(*)::int as n from private.protocol_writers')).rows[0].n, writerRows().length);
  // Lior left the review of the first graphics: he is out of the two rules of process 7.
  const p07 = (await db.query("select key, persons from private.protocol_writers where key in ('p07.@wait', 'p07.@part') order by key")).rows;
  assert.deepEqual(p07.map((r) => [r.key, r.persons]), [['p07.@part', ['ilai', 'irit']], ['p07.@wait', ['ilai', 'irit']]]);
  assert.equal((await db.query("select count(*)::int as n from private.protocol_writers where key = 'p24.dropbox'")).rows[0].n, 1);
  for (const key of ['p05b.sent', 'p07a.sent', 'p05.allnets', 'p14.day', 'p07.r.logo']) {
    for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai', 'nadia']) {
      const person = who === 'owner' ? null : who;
      const app = mayWrite({ person, client: { editor: 'nadia', rounds: [] }, key });
      const r = await as(db, users[who], async (tx) => (await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done') returning item_key", [ids.none, key])).rows.length);
      assert.equal(r === 1, app, `${who} ${key}: ${JSON.stringify(r)}`);
      assert.equal(app, ['owner', 'irit', 'lior', 'ofir'].includes(who), `${who} ${key}`);
    }
  }
});

test('a key the generator no longer writes is left with nobody (the same as no row), by the block itself', async () => {
  await db.query("insert into private.protocol_writers (key, proc, round, persons) values ('p99.old', 'p99', false, array['ilai'])");
  await db.exec(migrationSql(MIGRATION));
  assert.deepEqual((await db.query("select persons from private.protocol_writers where key = 'p99.old'")).rows[0].persons, []);
  assert.deepEqual((await db.query("select persons from private.protocol_writers where key = '@office'")).rows[0].persons, ['irit', 'lior', 'ofir']);
});
