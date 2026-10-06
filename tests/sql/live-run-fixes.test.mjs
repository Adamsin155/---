// What the live end-to-end run of 6.10.2026 found, in a real Postgres with every
// migration (tests/sql/pg.mjs):
//   - access_status_for_work(): the office (Ilai too, without the vault flag) reads
//     each login's client, network, label and status; never a user name, a note or
//     a password; nobody outside the office, and no archived client. The vault flag
//     itself is untouched (20261006100000_access_status_for_work.sql);
//   - the assigned editor reads the logo file the office uploaded (client_files kind
//     'logo', the table and the bucket), and no other client's;
//   - the migrations of this batch run twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { objectPath, BUCKET } from '../../app/files-logic.js';

let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', yariv: 'yariv', eli: 'eli', stav: 'stav' };
const BATCH = () => migrationFiles().filter((f) => f >= '20261006100000' && f < '20261006110000');

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    // As on the live site: only the owner and Lior hold the vault flag.
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, key === 'owner' || key === 'lior']);
  }
  const add = async (name, fields = {}) => {
    const cols = ['name', ...Object.keys(fields)];
    const vals = [name, ...Object.values(fields)];
    const { rows } = await db.query(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals);
    ids[name] = rows[0].id;
  };
  await add('dana', { business: 'קפה דנה', editor: 'nadia', shoot_type: 'dms' });
  await add('ron', { editor: 'yariv', shoot_type: 'dms' });
  await add('gone', { editor: 'nadia', shoot_type: 'dms' });
  const sec = (await db.query("select vault.create_secret('pw', 'client_access:x', 'x') as id")).rows[0].id;
  await db.query("insert into public.client_access (client_id, network, label, username, status, note, secret_id) values ($1, 'instagram', 'העמוד הראשי', 'dana_ig', 'ok', 'הערה פנימית', $2)", [ids.dana, sec]);
  await db.query("insert into public.client_access (client_id, network, status) values ($1, 'tiktok', 'missing'), ($2, 'facebook', 'broken'), ($3, 'facebook', 'ok')", [ids.dana, ids.ron, ids.gone]);
});

const q = (who, sql, params = []) => as(db, who === 'anon' ? null : users[who], async (tx) => (await tx.query(sql, params)).rows);
async function keep(who, sql, params = []) {
  const u = users[who];
  let out;
  await db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated' })]);
    out = (await tx.query(sql, params)).rows;
  });
  return out;
}

test('this batch of migrations is safe to run again', async () => {
  assert.ok(BATCH().length >= 1);
  for (const f of BATCH()) await db.exec(migrationSql(f));
});

test('the login statuses for the office\'s work: Ilai without the vault flag; never a user name or a password', async () => {
  await keep('owner', 'select public.archive_client($1)', [ids.gone]);
  // Ilai has no vault flag, and the vault's own rows stay closed to him.
  assert.deepEqual(await q('ilai', 'select public.can_use_vault() as v'), [{ v: false }]);
  assert.deepEqual(await q('ilai', 'select * from public.client_access'), []);
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) {
    const rows = await q(who, 'select * from public.access_status_for_work()');
    assert.equal(rows.length, 3, who); // dana's two and ron's; the archived client's is left out
    assert.deepEqual(Object.keys(rows[0]).sort(), ['client_id', 'label', 'network', 'status', 'updated_at'], who);
  }
  const mine = await q('ilai', 'select network, label, status from public.access_status_for_work($1)', [[ids.dana]]);
  assert.deepEqual(mine, [{ network: 'instagram', label: 'העמוד הראשי', status: 'ok' }, { network: 'tiktok', label: null, status: 'missing' }]);
  assert.ok(!JSON.stringify(await q('ilai', 'select * from public.access_status_for_work()')).match(/dana_ig|הערה פנימית|secret/));
  // Outside the office: nothing, also for an assigned editor; a salesman; anon cannot call it.
  for (const who of ['nadia', 'yariv', 'eli', 'stav']) assert.deepEqual(await q(who, 'select * from public.access_status_for_work()'), [], who);
  assert.match((await q('anon', 'select * from public.access_status_for_work()')).error, /permission denied/);
  // The function grants nothing else: he still cannot reveal or save a password.
  const id = (await db.query("select id from public.client_access where username = 'dana_ig'")).rows[0].id;
  assert.match((await q('ilai', 'select public.access_reveal($1)', [id])).error, /not allowed/);
  assert.equal((await db.query("select vault from public.staff where person = 'ilai'")).rows[0].vault, false);
});

test('the assigned editor reads the uploaded logo file (the row and the object), not another client\'s', async () => {
  const up = async (client, kind) => {
    const path = objectPath(client, kind, randomUUID(), 'logo.png');
    await keep('irit', 'insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)', [BUCKET, path, users.irit.id]);
    await keep('irit', "insert into public.client_files (client_id, kind, storage_path, label, mime, size_bytes) values ($1, $2, $3, 'logo.png', 'image/png', 1000)", [client, kind, path]);
    return path;
  };
  const mineP = await up(ids.dana, 'logo');
  const otherP = await up(ids.ron, 'logo');
  const rows = await q('nadia', "select storage_path from public.client_files where kind = 'logo'");
  assert.deepEqual(rows.map((r) => r.storage_path), [mineP]);
  const objs = await q('nadia', 'select name from storage.objects where bucket_id = $1', [BUCKET]);
  assert.deepEqual(objs.map((r) => r.name), [mineP]);
  assert.ok(!objs.some((r) => r.name === otherP));
});

test('the confirmation of an unusual shoot date is kept in the date-change history: on the change\'s row, or a row of its own for a first setting', async () => {
  const hist = async () => (await db.query("select field, round, old_value is null as first, new_value, by_email, note from public.client_date_changes where client_id = $1 order by id", [ids.dana])).rows;
  // A first setting makes no row by itself; the note adds one, with no old value.
  await keep('irit', "update public.clients set char_at = '2026-10-08T07:00:00Z', shoot_at = '2026-10-08T16:00:00Z' where id = $1", [ids.dana]);
  assert.deepEqual(await hist(), []);
  await keep('irit', "select public.date_change_note($1, 'shoot_at', null, '2026-10-08T16:00:00+00:00', 'אושר למרות: פחות מ־3 ימי עסקים אחרי פגישת האפיון')", [ids.dana]);
  assert.deepEqual(await hist(), [{ field: 'shoot_at', round: null, first: true, new_value: '2026-10-08T16:00:00+00:00', by_email: 'irit@astrateg.test', note: 'אושר למרות: פחות מ־3 ימי עסקים אחרי פגישת האפיון' }]);
  // A change makes its row (the trigger); the note lands on that row, not on a new one.
  await keep('lior', "update public.clients set shoot_at = '2026-10-07T08:00:00Z' where id = $1", [ids.dana]);
  await keep('lior', "select public.date_change_note($1, 'shoot_at', null, '2026-10-07T08:00:00+00:00', 'אושר למרות: יום הצילום לפני פגישת האפיון')", [ids.dana]);
  const rows = await hist();
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[1].first, rows[1].by_email, rows[1].note], [false, 'lior@astrateg.test', 'אושר למרות: יום הצילום לפני פגישת האפיון']);
  // Someone else's change is not annotated by me: Irit's note on Lior's change is a row of hers.
  await keep('irit', "select public.date_change_note($1, 'shoot_at', null, '2026-10-07T08:00:00+00:00', 'הערה של עירית')", [ids.dana]);
  assert.equal((await hist()).length, 3);
  // Who may: the office, on a client it sees. Not an editor (even assigned), not sales, not anon; a real note, a known field.
  for (const who of ['nadia', 'eli', 'stav']) assert.match((await q(who, "select public.date_change_note($1, 'shoot_at', null, 'x', 'y')", [ids.dana])).error, /not allowed/, who);
  assert.match((await q('anon', "select public.date_change_note($1, 'shoot_at', null, 'x', 'y')", [ids.dana])).error, /permission denied/);
  assert.match((await q('irit', "select public.date_change_note($1, 'deal_at', null, 'x', 'y')", [ids.dana])).error, /unknown field/);
  assert.match((await q('irit', "select public.date_change_note($1, 'shoot_at', null, 'x', '  ')", [ids.dana])).error, /note/);
  assert.match((await q('irit', "select public.date_change_note($1, 'shoot_at', null, 'x', 'y')", [ids.gone])).error, /not allowed/); // archived
  // Nobody writes the history directly, as before.
  assert.ok((await q('irit', "insert into public.client_date_changes (client_id, field, by_email, note) values ($1, 'shoot_at', 'x', 'y')", [ids.dana])).error);
});
