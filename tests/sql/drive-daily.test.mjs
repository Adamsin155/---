// supabase/migrations/20261120100000_drive_daily.sql in a real Postgres with every migration
// (tests/sql/pg.mjs): the Drive counts behind "עבודה לפי עובד".
//   - the file is the newest, only adds, and runs twice;
//   - the office reads, an editor does not, and nobody but the service role writes;
//   - the cron job is there, and its function is not callable from outside.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';

const FILE = '20261120100000_drive_daily.sql';
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
  const { rows } = await db.query("insert into public.clients (name, status) values ('דנה', 'active') returning id");
  client = rows[0].id;
  await db.query("insert into public.drive_daily (client_id, day, folder, kind, files) values ($1, '2026-10-30', 'גרפיקות', 'graphic', 9)", [client]);
  await db.query('insert into public.drive_scan_state (client_id) values ($1)', [client]);
});

async function tryAs(who, sql, params = []) {
  const u = users[who];
  try {
    return await as(db, u, async (tx) => (await tx.query(sql, params)).rows);
  } catch (err) { return { error: err.message }; }
}

test('the file: the newest but the Claude connection, only adds, and runs twice', async () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261121100000_mcp.sql', '20261122100000_deal_pool.sql', '20261123100000_old_income.sql']);
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  await db.exec(migrationSql(FILE));
  const { rows } = await db.query('select files from public.drive_daily');
  assert.deepEqual(rows.map((r) => r.files), [9]);
});

test('who reads: the office; an editor reads nothing', async () => {
  for (const who of ['owner', 'ofir']) {
    assert.equal((await tryAs(who, 'select * from public.drive_daily')).length, 1, who);
    assert.equal((await tryAs(who, 'select * from public.drive_scan_state')).length, 1, who);
  }
  assert.deepEqual(await tryAs('anna', 'select * from public.drive_daily'), []);
  assert.deepEqual(await tryAs('anna', 'select * from public.drive_scan_state'), []);
});

test('nobody writes from the page, not even the owner', async () => {
  const add = await tryAs('owner', "insert into public.drive_daily (client_id, day, kind, files) values ($1, '2026-10-29', 'video', 1) returning files", [client]);
  assert.match(add.error, /permission denied/);
  assert.match((await tryAs('owner', 'update public.drive_scan_state set files = 1 returning files')).error, /permission denied/);
});

test('a kind the table does not know is refused', async () => {
  await assert.rejects(db.query("insert into public.drive_daily (client_id, day, kind) values ($1, '2026-10-29', 'x')", [client]));
});

test('the cron job calls the tick, and the tick is not callable from a session', async () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.match(sql, /cron\.schedule\('drive-scan', '3,13,23,33,43,53 5-20 \* \* \*', 'select public\.drive_scan_tick\(\)'\)/);
  assert.match((await tryAs('owner', 'select public.drive_scan_tick()')).error, /permission denied/);
});
