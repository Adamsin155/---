// "קוד הכספת" (supabase/migrations/20261008100100_vault_code.sql) in a real Postgres
// with every migration: before a code exists the vault works as before; only the
// owner sets it; it is kept as a salted hash and no API reads it; weak codes are
// refused; a password is revealed only with a live unlock (10 minutes, per user, kept
// in the database); 5 wrong codes lock that user for 15 minutes; failures and
// lockouts are logged for the owner without the code; changing the code ends
// everyone's unlocks; saving a login and the statuses are never gated; and the
// migration runs again safely.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { weakCode } from '../../app/vault-code.js';

const FILE = migrationFiles().find((f) => f.endsWith('_vault_code.sql'));
let db;
const users = {};
const ids = {};
// The vault flag: the owner, Lior, Ilai and Nirel. Irit has none.
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ilai: 'ilai', nirel: 'nirel', nadia: 'nadia' };
const VAULT = ['owner', 'lior', 'ilai', 'nirel'];
const CODE = '483920';

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, VAULT.includes(key)]);
  }
  // A client of Natali's that Nirel edits: her vault flag covers it.
  const { rows } = await db.query("insert into public.clients (name, shoot_type, editor) values ('dana', 'natali', 'nirel') returning id");
  ids.dana = rows[0].id;
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
const unlock = async (who, code) => (await keep(who, 'select public.vault_unlock($1) as r', [code]))[0].r;
const status = async (who) => (await keep(who, 'select public.vault_code_status() as s'))[0].s;
const reveal = (who) => keep(who, 'select public.access_reveal($1) as p', [ids.access]).then((r) => r[0].p);
const all = async (sql, params = []) => (await db.query(sql, params)).rows;

test('before any code exists the vault works exactly as before, and the page is told so', async () => {
  const [{ id }] = await keep('lior', "select public.access_save($1, null, 'instagram', null, 'dana_ig', 'ig-pass', 'ok', null) as id", [ids.dana]);
  ids.access = id;
  for (const who of ['owner', 'lior', 'ilai', 'nirel']) assert.equal(await reveal(who), 'ig-pass', who);
  await assert.rejects(reveal('irit'), /not allowed/);
  const s = await status('ilai');
  assert.deepEqual([s.set, s.changedAt, s.owner, s.openUntil, s.lockedUntil, s.left], [false, null, false, null, null, 5]);
  assert.equal((await status('owner')).owner, true);
  assert.deepEqual(await unlock('ilai', '123123'), { state: 'none' });
});

test('only the owner sets the code; exactly 6 digits; trivially weak codes are refused, as on the page', async () => {
  for (const who of ['irit', 'lior', 'ilai', 'nirel', 'nadia']) assert.match((await q(who, 'select public.vault_code_set($1)', [CODE])).error, /owner only/, who);
  assert.match((await q('anon', 'select public.vault_code_set($1)', [CODE])).error, /permission denied/);
  for (const bad of ['', '12345', '1234567', '12a456', ' 48392', null]) assert.match((await q('owner', 'select public.vault_code_set($1)', [bad])).error, /6 digits/, String(bad));
  const cases = ['000000', '111111', '999999', '123456', '654321', '012345', '456789', '987654', '543210', '890123', '210987', '483920', '112233', '135790', '121212', '100000', '123457'];
  for (const c of cases) {
    const weak = (await all('select private.vault_code_weak($1) as w', [c]))[0].w;
    assert.equal(weak, weakCode(c), c);
    const r = await q('owner', 'select public.vault_code_set($1)', [c]);
    assert.equal(!!r.error, weak, c);
    if (weak) assert.match(r.error, /weak code/, c);
  }
  assert.equal((await all('select count(*)::int as n from private.vault_code'))[0].n, 0, 'nothing was kept (every call above was rolled back)');
});

test('the owner sets the code: a salted hash, never the code; no API reads it', async () => {
  await keep('owner', 'select public.vault_code_set($1)', [CODE]);
  const row = (await all('select * from private.vault_code'))[0];
  assert.match(row.code_hash, /^\$2[aby]\$10\$/);
  assert.ok(!row.code_hash.includes(CODE));
  assert.equal(row.set_by, 'owner@astrateg.test');
  // The same code hashed again gives another hash (a salt each time).
  const again = (await all("select extensions.crypt($1, extensions.gen_salt('bf', 10)) as h", [CODE]))[0].h;
  assert.notEqual(again, row.code_hash);
  // Nobody reads the tables of the code through the API: not the owner, not anon.
  for (const who of ['owner', 'lior', 'anon']) {
    for (const t of ['private.vault_code', 'private.vault_unlocks']) assert.match((await q(who, `select * from ${t}`)).error, /permission denied/, `${who} ${t}`);
  }
  // What the functions return holds neither the code nor its hash.
  const s = await status('owner');
  assert.deepEqual(Object.keys(s).sort(), ['changedAt', 'left', 'lockedUntil', 'openUntil', 'owner', 'set']);
  assert.equal(s.set, true);
  assert.ok(!JSON.stringify(s).includes(CODE) && !JSON.stringify(s).includes('$2'));
  // No function in the API returns it: the only functions that read private.vault_code are these.
  const readers = await all("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc ~ 'private\\.vault_code\\M' order by 1");
  assert.deepEqual(readers.map((r) => r.proname), ['vault_code_set', 'vault_code_status', 'vault_open', 'vault_unlock']);
  assert.deepEqual((await all("select email, event from public.vault_code_log order by id")), [{ email: 'owner@astrateg.test', event: 'set' }]);
});

test('once a code exists a password needs an unlock; everything else in the vault does not', async () => {
  for (const who of ['owner', 'lior', 'ilai', 'nirel']) await assert.rejects(reveal(who), /vault locked/, who);
  assert.equal((await all("select count(*)::int as n from public.client_access_log where action = 'reveal'"))[0].n, 4, 'only the reveals from before the code');
  // Saving a login, the list, the statuses and the log are not gated.
  const [{ id }] = await keep('ilai', "select public.access_save($1, null, 'tiktok', null, 'dana_tt', 'tt-pass', 'ok', null) as id", [ids.dana]);
  assert.ok(id);
  assert.equal((await q('ilai', 'select id, username, status from public.client_access where client_id = $1', [ids.dana])).length, 2);
  assert.equal((await q('ilai', 'select * from public.access_work_statuses($1)', [[ids.dana]])).length, 2);
  assert.ok((await q('ilai', 'select id from public.client_access_log where client_id = $1', [ids.dana])).length >= 2);
  assert.deepEqual((await q('ilai', 'select public.can_use_client_vault($1) as v', [ids.dana])), [{ v: true }]);
});

test('the right code opens the passwords for that user for 10 minutes; then the code is asked again', async () => {
  const r = await unlock('ilai', CODE);
  assert.equal(r.state, 'open');
  assert.ok(Math.abs(new Date(r.until) - Date.now() - 10 * 60e3) < 30e3, '10 minutes');
  assert.equal(await reveal('ilai'), 'ig-pass');
  assert.equal(new Date((await status('ilai')).openUntil).getTime(), new Date(r.until).getTime());
  // Per user: Lior did not type it.
  await assert.rejects(reveal('lior'), /vault locked/);
  // The unlock is a row in the database: when its time passed, the code is needed again.
  await db.query("update private.vault_unlocks set unlocked_until = now() - interval '1 second' where email = 'ilai@astrateg.test'");
  await assert.rejects(reveal('ilai'), /vault locked/);
  assert.equal((await status('ilai')).openUntil, null);
  // "נעילה עכשיו".
  await unlock('ilai', CODE);
  assert.equal(await reveal('ilai'), 'ig-pass');
  await keep('ilai', 'select public.vault_lock()');
  await assert.rejects(reveal('ilai'), /vault locked/);
  // Who has no vault flag cannot even try the code.
  assert.match((await q('irit', 'select public.vault_unlock($1)', [CODE])).error, /not allowed/);
  assert.match((await q('anon', 'select public.vault_unlock($1)', [CODE])).error, /permission denied/);
});

test('wrong codes count down; the fifth locks that user for 15 minutes; the owner sees who and when, never what was typed', async () => {
  // Nirel has the vault flag and was not given the code.
  for (let left = 4; left >= 1; left -= 1) assert.deepEqual(await unlock('nirel', '11223' + left), { state: 'wrong', left });
  assert.equal((await status('nirel')).left, 1);
  const fifth = await unlock('nirel', '556677');
  assert.equal(fifth.state, 'locked');
  assert.ok(Math.abs(new Date(fifth.until) - Date.now() - 15 * 60e3) < 30e3, '15 minutes');
  // Locked: even the right code is not checked.
  assert.equal((await unlock('nirel', CODE)).state, 'locked');
  await assert.rejects(reveal('nirel'), /vault locked/);
  const s = await status('nirel');
  assert.deepEqual([s.left, !!s.lockedUntil, s.openUntil], [0, true, null]);
  // A malformed code counts as a wrong one too; Lior's count is his own.
  assert.deepEqual(await unlock('lior', 'abc'), { state: 'wrong', left: 4 });
  assert.equal((await unlock('lior', CODE)).state, 'open');
  assert.equal((await status('lior')).left, 5, 'a right code clears the count');
  // The log: for the owner only; who and when.
  const log = await q('owner', "select email, event from public.vault_code_log where event in ('wrong', 'lockout') order by id");
  assert.deepEqual(log.map((r) => `${r.email.split('@')[0]}:${r.event}`), ['nirel:wrong', 'nirel:wrong', 'nirel:wrong', 'nirel:wrong', 'nirel:wrong', 'nirel:lockout', 'lior:wrong']);
  const cols = (await all("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'vault_code_log' order by 1")).map((r) => r.column_name);
  assert.deepEqual(cols, ['at', 'email', 'event', 'id']);
  for (const who of ['lior', 'ilai', 'nirel', 'irit']) assert.deepEqual(await q(who, 'select * from public.vault_code_log'), [], who);
  assert.match((await q('anon', 'select * from public.vault_code_log')).error, /permission denied/);
  assert.match((await q('owner', "insert into public.vault_code_log (email, event) values ('x', 'wrong')")).error, /permission denied/);
  // The lockout ends by itself: five new attempts.
  await db.query("update private.vault_unlocks set locked_until = now() - interval '1 second' where email = 'nirel@astrateg.test'");
  assert.deepEqual(await unlock('nirel', '000001'), { state: 'wrong', left: 4 });
});

test('changing the code ends everyone\'s unlocks and lockouts; the old code no longer opens', async () => {
  assert.equal(await reveal('lior'), 'ig-pass');
  await keep('owner', 'select public.vault_code_set($1)', ['772910']);
  await assert.rejects(reveal('lior'), /vault locked/);
  assert.equal((await all('select count(*)::int as n from private.vault_unlocks'))[0].n, 0);
  assert.deepEqual(await unlock('lior', CODE), { state: 'wrong', left: 4 });
  assert.equal((await unlock('lior', '772910')).state, 'open');
  assert.equal(await reveal('lior'), 'ig-pass');
  assert.equal((await all("select event from public.vault_code_log where email = 'owner@astrateg.test' order by id desc limit 1"))[0].event, 'changed');
  // The owner too opens with the code.
  await assert.rejects(reveal('owner'), /vault locked/);
  assert.equal((await unlock('owner', '772910')).state, 'open');
  assert.equal(await reveal('owner'), 'ig-pass');
});

test('anon runs none of it; the migration runs again safely and the code stays', async () => {
  const fns = await all(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname ~ 'vault_(code|unlock|lock|open|owner)' and has_function_privilege('anon', p.oid, 'execute')`);
  assert.deepEqual(fns, []);
  const snap = async () => JSON.stringify([await all('select * from private.vault_code'), await all('select * from private.vault_unlocks order by email'), await all('select * from public.vault_code_log order by id')]);
  const before = await snap();
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  assert.equal(await snap(), before);
  assert.equal(await reveal('lior'), 'ig-pass');
  await assert.rejects(reveal('ilai'), /vault locked/);
  assert.equal((await all("select relrowsecurity from pg_class where oid = 'public.vault_code_log'::regclass"))[0].relrowsecurity, true);
});
