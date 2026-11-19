// The clients' Drive folders found by themselves (19.11.2026; supabase/migrations/20261219100000_drive_autolink.sql)
// in a real Postgres with every migration (tests/sql/pg.mjs): the setting's key, the state table (the
// office reads, nobody writes from a page), the service role's link (into an empty link only), the
// office's pick (one of the kept folders, or none; never over a link; not a folder of another
// client), and the cron job. Invented people and clients only.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql } from './pg.mjs';

const MIGRATION = '20261219100000_drive_autolink.sql';
const PEOPLE = { owner: null, irit: 'irit', nadia: 'nadia' };
const F1 = 'folderAAAA0001';
const F2 = 'folderBBBB0002';
const F3 = 'folderCCCC0003';
let db;
const users = {};
const ids = {};

async function call(who, sql, params = []) {
  const user = users[who];
  const claims = { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated' };
  try {
    return await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (err) { return { error: err.message }; }
}
async function service(sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query('set local role service_role');
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (err) { return { error: err.message }; }
}
const drive = async (id) => (await db.query("select links ->> 'drive' as d from public.clients where id = $1", [id])).rows[0].d;
const state = async (id) => (await db.query('select * from public.drive_link_state where client_id = $1', [id])).rows[0];
const ask = (id, candidates) => db.query("insert into public.drive_link_state (client_id, status, candidates, ask_key) values ($1, 'ask', $2, $3)",
  [id, JSON.stringify(candidates), candidates.map((c) => c.id).sort().join(',')]);

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
  for (const [k, links] of Object.entries({ empty: {}, linked: { drive: 'https://drive.google.com/drive/folders/folderOLD00001' }, other: { drive: `https://drive.google.com/drive/folders/${F3}` }, pick: {}, pick2: {} })) {
    const { rows } = await db.query("insert into public.clients (name, business, status, links) values ($1, $1, 'active', $2) returning id", [k, JSON.stringify(links)]);
    ids[k] = rows[0].id;
  }
});

test('the file only adds and runs again; the setting\'s key is allowed; the folder id is not in it', async () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  assert.equal(sql.replace(/on delete cascade/g, '').match(/\bdelete\b|\btruncate\b|drop table|drop function/gi), null);
  assert.doesNotMatch(sql, /1-lg/);
  await db.exec(migrationSql(MIGRATION));
  await db.query(`insert into public.app_settings (key, value) values ('drive_clients_folder', '{"folder":"mainfolder0001"}') on conflict (key) do update set value = excluded.value`);
  await assert.rejects(db.query("insert into public.app_settings (key, value) values ('something_else', 'true')"));
});

test('the service role links into an empty link only, and notes it as automatic', async () => {
  assert.deepEqual((await service('select public.drive_link_auto($1, $2, $3) as ok', [ids.empty, F1, 'קפה'])).rows, [{ ok: true }]);
  assert.equal(await drive(ids.empty), `https://drive.google.com/drive/folders/${F1}`);
  assert.equal((await state(ids.empty)).status, 'auto');
  assert.deepEqual((await service('select public.drive_link_auto($1, $2, $3) as ok', [ids.linked, F2, 'x'])).rows, [{ ok: false }]);
  assert.equal(await drive(ids.linked), 'https://drive.google.com/drive/folders/folderOLD00001', 'never over a link');
  assert.equal(await state(ids.linked), undefined);
  assert.deepEqual((await service('select public.drive_link_auto($1, $2, $3) as ok', [ids.pick, 'bad id!', 'x'])).rows, [{ ok: false }]);
});

test('from a page: the office reads the state, an editor does not; nobody writes or links by hand', async () => {
  assert.equal((await call('irit', 'select * from public.drive_link_state')).rows.length, 1);
  assert.equal((await call('owner', 'select * from public.drive_link_state')).rows.length, 1);
  assert.deepEqual((await call('nadia', 'select * from public.drive_link_state')).rows, []);
  assert.match((await call('owner', "insert into public.drive_link_state (client_id, status) values ($1, 'auto')", [ids.pick])).error, /permission denied/);
  assert.match((await call('owner', 'select public.drive_link_auto($1, $2, $3)', [ids.pick, F2, 'x'])).error, /permission denied/);
});

test('the pick: one of the kept folders, by the office only; "אף אחת"; never over a link; not another client\'s folder', async () => {
  await ask(ids.pick, [{ id: F1, name: 'א' }, { id: F2, name: 'ב' }, { id: F3, name: 'ג' }]);
  assert.match((await call('nadia', 'select public.drive_link_pick($1, $2)', [ids.pick, F2])).error, /not allowed/);
  assert.match((await call('irit', 'select public.drive_link_pick($1, $2)', [ids.pick, 'folderZZZZ9999'])).error, /not one of the folders/);
  assert.deepEqual((await call('irit', 'select public.drive_link_pick($1, $2) as r', [ids.pick, F3])).rows, [{ r: 'taken' }]);
  assert.deepEqual((await call('irit', 'select public.drive_link_pick($1, $2) as r', [ids.pick, F2])).rows, [{ r: 'linked' }]);
  // call() rolls back: do it for real to see the result.
  await db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users.irit.id, email: users.irit.email, role: 'authenticated' })]);
    await tx.query('select public.drive_link_pick($1, $2)', [ids.pick, F2]);
  });
  assert.equal(await drive(ids.pick), `https://drive.google.com/drive/folders/${F2}`);
  const s = await state(ids.pick);
  assert.deepEqual([s.status, s.folder_id, s.folder_name, s.by_email], ['picked', F2, 'ב', 'irit@astrateg.test']);
  assert.deepEqual((await call('irit', 'select public.drive_link_pick($1, $2) as r', [ids.pick, F1])).rows, [{ r: 'kept' }], 'answered already');

  await ask(ids.pick2, [{ id: F1, name: 'א' }]);
  await db.query("update public.clients set links = jsonb_build_object('drive', 'https://drive.google.com/drive/folders/folderPUT00001') where id = $1", [ids.pick2]);
  assert.deepEqual((await call('owner', 'select public.drive_link_pick($1, $2) as r', [ids.pick2, F1])).rows, [{ r: 'kept' }], 'a link put meanwhile stays');
  await db.query("update public.clients set links = '{}' where id = $1", [ids.pick2]);
  await db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users.owner.id, email: users.owner.email, role: 'authenticated' })]);
    await tx.query('select public.drive_link_pick($1, null)', [ids.pick2]);
  });
  assert.equal((await state(ids.pick2)).status, 'none');
  assert.equal(await drive(ids.pick2), null);
});

test('the cron job calls the tick, and the tick is not callable from a session', async () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  assert.match(sql, /cron\.schedule\('drive-link', '17 5,8,11,14,17 \* \* \*', 'select public\.drive_link_tick\(\)'\)/);
  assert.match((await call('owner', 'select public.drive_link_tick()')).error, /permission denied/);
});
