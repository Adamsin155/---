// supabase/migrations/20261101100000_editor_progress.sql in a real Postgres with every
// migration (tests/sql/pg.mjs): how many videos each editor has already edited per client
// (the owner's request of 22.10.2026).
//   - the file is the newest, only adds (none of the three words the production tool refuses)
//     and runs twice;
//   - an editor sets and reads only their own number, for a shoot they edit (main or second
//     editor, the client's own or a round's); never another's, never a client not theirs;
//   - the office (owner, Irit, Lior, Ofir) reads every number and may set one for an editor
//     of the shoot; nobody writes the table directly.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';

const FILE = '20261101100000_editor_progress.sql';
let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', eli: 'eli', nadia: 'nadia', yariv: 'yariv', anna: 'anna' };

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
  // dana: Nadia with Yariv (a split); gil: Anna alone, and a second round by Yariv.
  const rounds = JSON.stringify([{ n: 2, shoot_type: 'dms', editor: 'yariv' }]);
  for (const [name, fields] of [['dana', { editor: 'nadia', editor2: 'yariv', editor_split: '{"nadia": 10, "yariv": 5}' }], ['gil', { editor: 'anna', rounds }]]) {
    const cols = ['name', 'status', ...Object.keys(fields)];
    const { rows } = await db.query(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, [name, 'active', ...Object.values(fields)]);
    ids[name] = rows[0].id;
  }
});

// Runs and keeps the change (the RPC writes); returns the rows, or { error }.
async function keep(who, sql, params = []) {
  const u = users[who];
  let out;
  try {
    await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated' })]);
      out = (await tx.query(sql, params)).rows;
    });
  } catch (err) { out = { error: err.message }; }
  return out;
}
const set = (who, client, n, round = null, editor = null) => keep(who, 'select public.editor_progress_set($1, $2, $3, $4) as r', [client, n, round, editor]).then((r) => r.error ? r : r[0].r);
const read = (who) => as(db, users[who], async (tx) => (await tx.query('select client_id, editor, round, edited from public.editor_progress order by editor, round')).rows);

test('the file: the newest, only adds, and runs twice', async () => {
  const files = migrationFiles();
  // After it only Irit's Gantt (20261102100000_gantt_irit.sql, 22.10.2026) and the monthly count
  // (20261104100000_editor_progress_month.sql, 22.10.2026: tests/sql/editor-progress-month.test.mjs),
  // and the old system's signed documents (20261105100000_legacy_contracts.sql, 25.10.2026); a shoot day without influencers (20261107100000_shoot_crew.sql, 25.10.2026).
  assert.deepEqual(files.slice(files.indexOf(FILE) + 1), ['20261102100000_gantt_irit.sql', '20261104100000_editor_progress_month.sql', '20261105100000_legacy_contracts.sql', '20261107100000_shoot_crew.sql']);
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
});

test('an editor sets their own number for a shoot they edit, and changes it', async () => {
  let r = await set('nadia', ids.dana, 3);
  assert.deepEqual([r.editor, r.round, r.edited, r.updated_by], ['nadia', 1, 3, 'nadia@astrateg.test']);
  r = await set('nadia', ids.dana, 8);
  assert.equal(r.edited, 8);
  // The second editor keeps their own number, beside hers.
  assert.equal((await set('yariv', ids.dana, 12)).edited, 12); // above the share (5): kept as written
  // A round: its own editor.
  assert.equal((await set('yariv', ids.gil, 4, 2)).round, 2);
  assert.equal((await set('anna', ids.gil, 6)).edited, 6);
  const { rows } = await db.query('select count(*)::int as n from public.editor_progress');
  assert.equal(rows[0].n, 4);
});

test('an editor cannot set a shoot not theirs, nor another editor\'s number; the number is 0..999', async () => {
  for (const [who, client, round, editor] of [['anna', 'dana', null, null], ['nadia', 'gil', null, null], ['yariv', 'gil', null, null], ['anna', 'gil', 2, null], ['nadia', 'dana', null, 'yariv'], ['eli', 'dana', null, null], ['ilai', 'dana', null, 'nadia']]) {
    const r = await set(who, ids[client], 1, round, editor);
    assert.match(r.error || '', /not allowed/, `${who} ${client} ${round} ${editor}`);
  }
  for (const n of [-1, 1000]) assert.match((await set('nadia', ids.dana, n)).error || '', /between 0 and 999/);
  // Nobody writes the table directly.
  for (const who of ['nadia', 'owner']) {
    const r = await as(db, users[who], (tx) => tx.query("insert into public.editor_progress (client_id, editor, edited) values ($1, 'nadia', 1)", [ids.dana]));
    assert.match(r.error || '', /permission denied/);
    const u = await as(db, users[who], (tx) => tx.query('update public.editor_progress set edited = 99 where true'));
    assert.match(u.error || '', /permission denied/);
  }
});

test('reading: an editor their own rows of shoots they edit; the office all; others none', async () => {
  assert.deepEqual((await read('nadia')).map((r) => [r.editor, r.edited]), [['nadia', 8]]);
  assert.deepEqual((await read('yariv')).map((r) => [r.editor, r.round, r.edited]), [['yariv', 1, 12], ['yariv', 2, 4]]);
  assert.deepEqual((await read('anna')).map((r) => [r.editor, r.edited]), [['anna', 6]]);
  for (const who of ['owner', 'irit', 'lior', 'ofir']) assert.equal((await read(who)).length, 4, who);
  for (const who of ['ilai', 'eli']) assert.equal((await read(who)).length, 0, who);
  // Taken off the shoot: the number stays, but the editor no longer reads it.
  await db.query('update public.clients set editor2 = null where id = $1', [ids.dana]);
  assert.deepEqual((await read('yariv')).map((r) => r.round), [2]);
  assert.match((await set('yariv', ids.dana, 13)).error || '', /not allowed/);
  await db.query('update public.clients set editor2 = $2 where id = $1', [ids.dana, 'yariv']);
});

test('the office sets a number for an editor of the shoot, never for one who is not', async () => {
  const r = await set('ofir', ids.dana, 9, null, 'nadia');
  assert.deepEqual([r.editor, r.edited, r.updated_by], ['nadia', 9, 'ofir@astrateg.test']);
  assert.match((await set('lior', ids.dana, 1, null, 'anna')).error || '', /not allowed/);
  // The owner has no person: a number is always for a named editor.
  assert.match((await set('owner', ids.dana, 1)).error || '', /not allowed/);
});

test('a client in landing: its editor (clients.editor, as landing_set_editor records it) counts, and the owner enters numbers for her', async () => {
  const { rows } = await db.query("insert into public.clients (name, status, landing, editor) values ('ענת עיצובים', 'active', true, 'anna') returning id");
  const id = rows[0].id;
  const r = await set('owner', id, 31, null, 'anna');
  assert.deepEqual([r.editor, r.round, r.edited, r.updated_by], ['anna', 1, 31, 'owner@astrateg.test']);
  assert.equal((await set('anna', id, 32)).edited, 32);
  assert.deepEqual((await read('anna')).filter((x) => x.client_id === id).map((x) => x.edited), [32]);
  // Nobody else's, landing or not.
  assert.match((await set('nadia', id, 1)).error || '', /not allowed/);
  assert.match((await set('owner', id, 1, null, 'nadia')).error || '', /not allowed/);
});
