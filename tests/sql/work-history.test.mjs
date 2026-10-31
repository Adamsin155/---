// supabase/migrations/20261119100000_work_history.sql in a real Postgres with every migration
// (tests/sql/pg.mjs): the editors' daily log behind "עבודה לפי עובד".
//   - the file is the newest, only adds, and runs twice;
//   - every change of a total adds a row with its delta, both the shoot's and the monthly one;
//   - the office reads it, an editor does not, and nobody writes it directly.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';

const FILE = '20261119100000_work_history.sql';
let db;
const users = {};
let client;

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries({ owner: null, ofir: 'ofir', anna: 'anna' })) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
  const { rows } = await db.query("insert into public.clients (name, status, editor) values ('דנה', 'active', 'anna') returning id");
  client = rows[0].id;
});

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
const read = (who) => as(db, users[who], async (tx) => (await tx.query('select editor, round, month, delta, edited from public.editor_progress_log order by id')).rows);

test('the file: the newest, only adds, and runs twice', async () => {
  const files = migrationFiles();
  assert.equal(files.at(-1), '20261123100000_old_income.sql');
  assert.ok(files.includes(FILE));
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  await db.exec(migrationSql(FILE));
});

test('a change of the total adds its delta; the same number adds nothing; a correction is negative', async () => {
  await keep('anna', 'select public.editor_progress_set($1, 4)', [client]);
  await keep('anna', 'select public.editor_progress_set($1, 4)', [client]);
  await keep('anna', 'select public.editor_progress_set($1, 9)', [client]);
  await keep('anna', 'select public.editor_progress_set($1, 7)', [client]);
  const rows = await read('owner');
  assert.deepEqual(rows.map((r) => [r.editor, r.round, r.month, r.delta, r.edited]), [['anna', 1, null, 4, 4], ['anna', 1, null, 5, 9], ['anna', 1, null, -2, 7]]);
});

test('the monthly total is logged too, with its month', async () => {
  await db.query("insert into public.editor_progress_month (client_id, editor, month, edited) values ($1, 'anna', '2026-10', 3)", [client]);
  const rows = await read('owner');
  assert.deepEqual([rows.at(-1).round, rows.at(-1).month, rows.at(-1).delta], [null, '2026-10', 3]);
});

test('the day is Israel\'s', async () => {
  const { rows } = await db.query("select bool_and(day = (now() at time zone 'Asia/Jerusalem')::date) as ok from public.editor_progress_log");
  assert.equal(rows[0].ok, true);
});

test('who: the office reads, an editor reads nothing, nobody writes directly', async () => {
  assert.ok((await read('ofir')).length >= 4);
  assert.deepEqual(await read('anna'), []);
  const bad = await keep('owner', "insert into public.editor_progress_log (client_id, editor, delta, edited) values ($1, 'anna', 1, 1)", [client]);
  assert.match(bad.error, /permission denied/);
});
