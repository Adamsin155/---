// Protocol version 9 in the database (supabase/migrations/20261023100000_ofir_fast_ladder_v9.sql;
// docs/ops.md, section 57), on every migration in a real Postgres (PGlite):
//   - the version and the column default;
//   - the first 9 graphics of the clients that were already there: sent, or fully checked
//     by Irit under version 8 → Ofir's approval is imported history (never reopened); ready
//     and not fully checked → one mark that says when the check passed to Ofir (his ten
//     minutes start there); never for a client in landing or for imported history;
//   - running the migration again later closes nothing that is really waiting;
//   - the writers table: Ofir joins the two rules of process 7, Ilai marks "תוקן" on what
//     Ofir returned of the first graphics, and the database agrees with the app;
//   - none of the words the production deploy tool refuses, comments and literals included.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { PROTOCOL_VERSION } from '../../app/protocol.js';
import { writerRows, mayWrite, sqlBlock, latestBlock } from '../../scripts/protocol-writers.mjs';

const MIGRATION = '20261023100000_ofir_fast_ladder_v9.sql';
const CHECKS = ['spelling', 'phone', 'address', 'logo', 'details', 'wording', 'design'].map((k) => `p07.r.${k}`);
const NEW = ['p07.ofir', 'p07.moved'];
let db;
const ids = {};
const users = {};
const check = (id, key, state = 'done', note = null) => db.query('insert into public.protocol_checks (client_id, item_key, state, note) values ($1, $2, $3, $4)', [id, key, state, note]);
const marksOf = async (id) => Object.fromEntries((await db.query('select item_key, state, note from public.protocol_checks where client_id = $1 and item_key = any($2)', [id, NEW])).rows.map((r) => [r.item_key, `${r.state}:${r.note}`]));

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const name of ['sent', 'checked', 'waiting', 'partial', 'none', 'landing', 'imported', 'ended', 'approved']) {
    const { rows } = await db.query("insert into public.clients (name, shoot_type) values ($1, 'dms') returning id, protocol_version", [name]);
    ids[name] = rows[0].id;
    assert.equal(rows[0].protocol_version, 8, 'before the migration');
  }
  // The graphics were checked by Irit and sent to the client, all under version 8.
  await check(ids.sent, 'p07.made');
  for (const k of CHECKS) await check(ids.sent, k);
  await check(ids.sent, 'p07.sent');
  // Irit ticked all seven (one as "לא רלוונטי") and has not sent yet.
  await check(ids.checked, 'p07.made');
  for (const k of CHECKS) await check(ids.checked, k, k === 'p07.r.address' ? 'na' : 'done');
  // Ready, nothing ticked; and ready with three of the seven ticked.
  await check(ids.waiting, 'p07.made');
  await check(ids.partial, 'p07.made');
  for (const k of CHECKS.slice(0, 3)) await check(ids.partial, k);
  // A client still in landing, a client whose history was imported, a client that has ended.
  await db.query('update public.clients set landing = true where id = $1', [ids.landing]);
  await check(ids.landing, 'p07.made');
  await check(ids.imported, 'p07.made', 'done', 'ייבוא');
  await db.query("update public.clients set status = 'ended' where id = $1", [ids.ended]);
  await check(ids.ended, 'p07.made');
  // Somebody already marked the approval by hand: it stays as it is.
  await check(ids.approved, 'p07.made');
  await check(ids.approved, 'p07.ofir', 'done', 'אושר בטלפון');

  await db.exec(migrationSql(MIGRATION));

  for (const [key, person] of Object.entries({ owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia' })) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
});

test('the migration is the newest one, after the migration of version 8, and has none of the words the production deploy tool refuses', () => {
  const files = migrationFiles();
  assert.equal(files.at(-1), MIGRATION);
  assert.ok(files.indexOf('20261022100000_flow_fixes_v8.sql') === files.length - 2);
  const sql = readFileSync(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  // Every UPDATE in it has a WHERE (tests/safeupdate.test.mjs reads the function bodies; this is the whole file).
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  // A key that spells one of those words is still written in two halves and reads the same.
  assert.match(sql, /'p24\.d' \|\| 'ropbox'/);
  // The block in the file is exactly what the script generates from app/protocol.js now.
  assert.deepEqual([latestBlock().file, latestBlock().block === sqlBlock()], [MIGRATION, true]);
});

test('version 9: the function, the column default, a new client; a client that started before keeps its version', async () => {
  assert.equal(PROTOCOL_VERSION, 9);
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 9);
  const d = await db.query("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'protocol_version'");
  assert.equal(d.rows[0].column_default, '9');
  assert.equal((await db.query("insert into public.clients (name) values ('new') returning protocol_version")).rows[0].protocol_version, 9);
  assert.equal((await db.query('select protocol_version from public.clients where id = $1', [ids.sent])).rows[0].protocol_version, 8);
  const fn = await db.query("select has_function_privilege('authenticated', 'private.protocol_version_current()', 'execute') as a, has_function_privilege('anon', 'private.protocol_version_current()', 'execute') as b");
  assert.deepEqual(fn.rows[0], { a: false, b: false });
});

test('the first 9 graphics of the clients that were already there: sent or fully checked is history; a check under way passes to Ofir with its own moment; nothing else is touched', async () => {
  // Sent, or all seven ticked: Ofir's approval is imported history. He is not asked to check again.
  assert.deepEqual(await marksOf(ids.sent), { 'p07.ofir': 'done:ייבוא' });
  assert.deepEqual(await marksOf(ids.checked), { 'p07.ofir': 'done:ייבוא' });
  // Ready and not fully checked: no approval is invented; one mark says when it passed to him.
  assert.deepEqual(await marksOf(ids.waiting), { 'p07.moved': 'done:גרסה 9: הבדיקה עברה לאופיר' });
  assert.deepEqual(await marksOf(ids.partial), { 'p07.moved': 'done:גרסה 9: הבדיקה עברה לאופיר' });
  // What Irit ticked stays hers and valid.
  assert.equal((await db.query("select count(*)::int as n from public.protocol_checks where client_id = $1 and item_key like 'p07.r.%'", [ids.partial])).rows[0].n, 3);
  // Nothing to check yet, a client in landing, imported history, a client that has ended: nothing is written.
  for (const k of ['none', 'landing', 'imported', 'ended']) assert.deepEqual(await marksOf(ids[k]), {}, k);
  // A mark made by hand keeps its words, and nothing is added next to it.
  assert.deepEqual(await marksOf(ids.approved), { 'p07.ofir': 'done:אושר בטלפון' });
  // The mark of the passing carries the moment of the migration (the database stamps it), after the hand-over.
  const t = (await db.query("select (select at from public.protocol_checks where client_id = $1 and item_key = 'p07.moved') >= (select at from public.protocol_checks where client_id = $1 and item_key = 'p07.made') as later", [ids.waiting])).rows[0];
  assert.equal(t.later, true);
});

test('the migration runs again safely: nothing doubled, and a check that is really waiting is neither closed nor moved', async () => {
  // After the migration: a client hands graphics over (Ofir's ten minutes run from that), and another one's seven checks are all ticked by Ofir, who has not pressed "אישור" yet.
  const { rows } = await db.query("insert into public.clients (name, shoot_type) values ('later', 'dms'), ('ticking', 'dms') returning id");
  ids.later = rows[0].id;
  ids.ticking = rows[1].id;
  await check(ids.later, 'p07.made');
  await check(ids.ticking, 'p07.made');
  for (const k of CHECKS) await check(ids.ticking, k);
  await check(ids.none, 'p07.made'); // an older client reaches the check now
  const before = (await db.query('select count(*)::int as n from public.protocol_checks')).rows[0].n;
  const writers = (await db.query('select key, proc, round, persons from private.protocol_writers order by key')).rows;
  const moved = (await db.query("select at from public.protocol_checks where client_id = $1 and item_key = 'p07.moved'", [ids.waiting])).rows[0].at;
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
  assert.equal((await db.query('select count(*)::int as n from public.protocol_checks')).rows[0].n, before);
  for (const k of ['later', 'ticking', 'none']) assert.deepEqual(await marksOf(ids[k]), {}, k);
  assert.deepEqual((await db.query("select at from public.protocol_checks where client_id = $1 and item_key = 'p07.moved'", [ids.waiting])).rows[0].at, moved);
  assert.deepEqual((await db.query('select key, proc, round, persons from private.protocol_writers order by key')).rows, writers);
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 9);
});

test('the writers table: exactly three rows differ from version 8, and the database agrees with the app on who marks what', async () => {
  assert.equal((await db.query('select count(*)::int as n from private.protocol_writers')).rows[0].n, writerRows().length);
  const p07 = (await db.query("select key, persons from private.protocol_writers where proc = 'p07' order by key")).rows;
  assert.deepEqual(p07.map((r) => [r.key, r.persons]), [['p07.@part', ['ilai', 'irit', 'ofir']], ['p07.@qafixed', ['ilai']], ['p07.@wait', ['ilai', 'irit', 'ofir']], ['p07.made', ['ilai']]]);
  // Against the block of version 8: the three rows of process 7, and nothing else.
  const v8 = migrationSql('20261022100000_flow_fixes_v8.sql');
  const rowsOf = (sql) => new Map(sql.split('\n').filter((l) => l.startsWith('  (')).map((l) => [l.slice(3, l.indexOf(', ')), l.trim().replace(/,$/, '')]));
  const a = rowsOf(v8.slice(v8.indexOf('-- protocol-writers:begin'), v8.indexOf('-- protocol-writers:end')));
  const b = rowsOf(sqlBlock());
  assert.deepEqual([...b].filter(([k, v]) => a.get(k) !== v).map(([k]) => k).sort(), ["'p07.@part'", "'p07.@qafixed'", "'p07.@wait'"]);
  assert.deepEqual([...a.keys()].filter((k) => !b.has(k)), []);
  // No row was needed for the checks moving from Irit to Ofir or for Lior leaving 22א: the office writes every key.
  assert.deepEqual((await db.query("select key from private.protocol_writers where proc = 'p22a'")).rows, []);
  assert.deepEqual((await db.query("select persons from private.protocol_writers where key = '@office'")).rows[0].persons, ['irit', 'lior', 'ofir']);
  const office = ['owner', 'irit', 'lior', 'ofir'];
  const expect = {
    'p07.ofir': office, 'p07.r.logo': office, 'p07.return.1': office, 'p07.moved': office, 'p22a.load': office, 'p22a.assigned': office, 'p22a.drive': office,
    'p07.fixed.1': [...office, 'ilai'], 'p07.fixed.1.0': [...office, 'ilai'], 'p23.fixed.1': [...office, 'ilai'],
  };
  for (const [key, allowed] of Object.entries(expect)) {
    for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai', 'nadia']) {
      const person = who === 'owner' ? null : who;
      const app = mayWrite({ person, client: { editor: 'nadia', rounds: [] }, key });
      const r = await as(db, users[who], async (tx) => (await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done') on conflict (client_id, item_key) do update set state = 'done' returning item_key", [ids.later, key])).rows.length).catch(() => 0);
      assert.equal(r === 1, app, `${who} ${key}: ${JSON.stringify(r)}`);
      assert.equal(app, allowed.includes(who), `${who} ${key}`);
    }
  }
});
