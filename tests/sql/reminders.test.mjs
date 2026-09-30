// The reminder engine's database (supabase/migrations/20260930110000_reminders.sql
// and 20260930110002_reminders_cron.sql) in a real Postgres (PGlite, tests/sql/pg.mjs):
// the function's helpers are for the service role only, each person reads and
// changes only their own devices and reminders (a confirmed staff login), devices
// only at the browsers' push services, one tick at a time, pushes a stopped tick
// left pending are taken again once, and broken access keeps the moment it broke.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as } from './pg.mjs';

let db;
const users = {};

// Runs fn(tx) as one of Supabase's roles without a user (service_role, anon), rolled back.
async function asRole(role, fn) {
  let out;
  await db.transaction(async (tx) => {
    await tx.query(`set local role ${role}`);
    try { out = await fn(tx); } catch (err) { out = { error: err.message }; }
    await tx.rollback();
  });
  return out;
}
const q = (who, sql, params = []) => as(db, users[who], async (tx) => (await tx.query(sql, params)).rows);

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const P256 = `B${'A'.repeat(86)}`;
const AUTH = 'A'.repeat(22);

before(async () => {
  db = await freshDatabase();
  for (const [key, person, confirmed] of [['owner', null, true], ['irit', 'irit', true], ['lior', 'lior', true], ['nadia', 'nadia', true], ['unconfirmed', 'nadia', false]]) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query(`insert into auth.users (email, email_confirmed_at) values ($1, ${confirmed ? 'now()' : 'null'}) returning id`, [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
  for (const [key, person] of [['k-n1', 'nadia'], ['k-i1', 'irit'], ['k-l1', 'lior']]) {
    await db.query("insert into public.reminder_log (key, rule, person, level, channel, status, title) values ($1, 'deal', $2, 'ring', 'push', 'sent', 't')", [key, person]);
  }
});

test('the function\'s helpers and the cron call are for the service role only', async () => {
  const calls = [
    'select public.reminders_known(array[\'x\'])', "select public.reminders_check_secret('x')", 'select * from public.reminders_vapid()',
    'select public.reminders_begin()', "select public.reminders_end(1, true, '{}', null)", 'select * from public.reminders_reclaim(now())',
    'select public.reminders_tick()',
  ];
  for (const sql of calls) {
    assert.match((await q('irit', sql)).error || '', /permission denied/, sql);
    assert.match((await as(db, null, async (tx) => (await tx.query(sql)).rows)).error || '', /permission denied/, sql);
  }
  for (const sql of calls.slice(0, 6)) assert.ok(!(await asRole('service_role', async (tx) => (await tx.query(sql)).rows)).error, sql);
  assert.match((await asRole('service_role', async (tx) => (await tx.query(calls[6])).rows)).error || '', /permission denied/);
  // The runs are the function's own; devices are written only through the functions.
  assert.match((await q('owner', 'select * from public.reminder_runs')).error || '', /permission denied/);
  assert.match((await q('irit', "insert into public.push_subscriptions (email, endpoint, p256dh, auth) values ('irit@astrateg.test', 'https://fcm.googleapis.com/x', 'a', 'b')")).error || '', /permission denied/);
  // Every function of the migration pins its search path.
  const loose = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'reminder%' or p.proname like 'push\\_%' or p.proname = 'client_access_broken_since')
      and not ('search_path=""' = any(coalesce(p.proconfig, '{}')))`)).rows;
  assert.deepEqual(loose, []);
});

test('the log: everyone reads their own, the owner and Lior all, and only a confirmed staff login', async () => {
  const keys = async (who) => (await q(who, 'select key from public.reminder_log order by key')).map((r) => r.key);
  assert.deepEqual(await keys('nadia'), ['k-n1']);
  assert.deepEqual(await keys('irit'), ['k-i1']);
  assert.deepEqual(await keys('lior'), ['k-i1', 'k-l1', 'k-n1']);
  assert.deepEqual(await keys('owner'), ['k-i1', 'k-l1', 'k-n1']);
  // A staff email whose login was never confirmed reads nothing and marks nothing.
  assert.deepEqual(await keys('unconfirmed'), []);
  assert.deepEqual(await q('unconfirmed', 'select public.reminder_person() as p'), [{ p: null }]);
  assert.match((await q('unconfirmed', 'select public.reminders_mark_read(null)')).error || '', /not allowed/);
  assert.deepEqual(await q('nadia', 'select public.reminders_mark_read(null) as n'), [{ n: 1 }]);
  // Nobody writes the log directly.
  assert.match((await q('lior', "update public.reminder_log set status = 'failed'")).error || '', /permission denied/);
});

test('devices: one\'s own only, at a browser\'s push service only, and a device goes to whoever connected it last', async () => {
  const mine = await as(db, users.irit, async (tx) => {
    await tx.query('select public.push_subscribe($1, $2, $3)', [ENDPOINT, P256, AUTH]);
    return (await tx.query('select endpoint from public.push_subscriptions')).rows.length;
  });
  assert.equal(mine, 1);
  const bad = await q('irit', 'select public.push_subscribe($1, $2, $3)', ['https://evil.example/fcm.googleapis.com/', P256, AUTH]);
  assert.match(bad.error || '', /check constraint/);
  await db.query("insert into public.push_subscriptions (email, endpoint, p256dh, auth) values ('nadia@astrateg.test', $1, $2, $3)", [ENDPOINT, P256, AUTH]);
  // A login whose email was never confirmed cannot connect a device, nor confirm or
  // disconnect one recorded under that email.
  const OTHER = 'https://updates.push.services.mozilla.com/wpush/v2/x';
  await db.query("insert into public.push_subscriptions (email, endpoint, p256dh, auth) values ('unconfirmed@astrateg.test', $1, $2, $3)", [OTHER, P256, AUTH]);
  assert.match((await q('unconfirmed', 'select public.push_subscribe($1, $2, $3)', [ENDPOINT, P256, AUTH])).error || '', /not allowed/);
  assert.deepEqual(await q('unconfirmed', 'select public.push_confirm($1) as ok', [OTHER]), [{ ok: false }]);
  assert.deepEqual(await q('unconfirmed', 'select public.push_unsubscribe($1) as ok', [OTHER]), [{ ok: false }]);
  // Nadia sees hers; Irit does not; Irit connecting that phone takes it over.
  assert.equal((await q('nadia', 'select endpoint from public.push_subscriptions')).length, 1);
  assert.equal((await q('irit', 'select endpoint from public.push_subscriptions')).length, 0);
  const moved = await as(db, users.irit, async (tx) => {
    await tx.query('select public.push_subscribe($1, $2, $3)', [ENDPOINT, P256, AUTH]);
    await tx.query('set local role postgres');
    return (await tx.query('select email from public.push_subscriptions where endpoint = $1', [ENDPOINT])).rows.map((r) => r.email);
  });
  assert.deepEqual(moved, ['irit@astrateg.test']);
  await db.query('delete from public.push_subscriptions');
});

test('one tick at a time; the cron secret is checked inside the database', async () => {
  const out = await asRole('service_role', async (tx) => {
    const a = (await tx.query('select public.reminders_begin() as id')).rows[0].id;
    const b = (await tx.query('select public.reminders_begin() as id')).rows[0].id;
    await tx.query("select public.reminders_end($1, true, '{}', null)", [a]);
    const c = (await tx.query('select public.reminders_begin() as id')).rows[0].id;
    return { a: !!a, b, c: !!c };
  });
  assert.deepEqual(out, { a: true, b: null, c: true });
  const secret = 's'.repeat(40);
  await db.query("select vault.create_secret($1, 'reminders_cron_secret')", [secret]);
  const check = (s) => asRole('service_role', async (tx) => (await tx.query('select public.reminders_check_secret($1) as ok', [s])).rows[0].ok);
  assert.equal(await check(secret), true);
  assert.equal(await check(`${secret}x`), false);
  assert.equal(await check(null), false);
  // The cron call posts to the function with the secret in a header, never in the body.
  const id = (await db.query('select public.reminders_tick() as id')).rows[0].id;
  const call = (await db.query('select url, body, headers from net.calls where id = $1', [id])).rows[0];
  assert.equal(call.url, 'https://czncjzziqrqtezpwxxpz.supabase.co/functions/v1/reminders');
  assert.deepEqual(call.body, { action: 'tick' });
  assert.equal(call.headers['x-cron-secret'], secret);
  assert.deepEqual((await db.query("select jobname, schedule from cron.job where jobname = 'reminders-tick'")).rows, [{ jobname: 'reminders-tick', schedule: '* * * * *' }]);
  await db.query("delete from vault.secrets where name = 'reminders_cron_secret'");
  assert.deepEqual((await db.query('select public.reminders_tick() as id')).rows, [{ id: null }]);
});

test('pushes a stopped tick left pending are taken again once, and only when old enough', async () => {
  await db.query(`insert into public.reminder_log (key, rule, person, level, channel, status, title, claimed_at) values
    ('p-old', 'deal', 'irit', 'ring', 'push', 'pending', 't', now() - interval '11 minutes'),
    ('p-new', 'deal', 'irit', 'ring', 'push', 'pending', 't', now() - interval '1 minute'),
    ('p-sent', 'deal', 'irit', 'ring', 'push', 'sent', 't', now() - interval '11 minutes')`);
  const take = () => asRole('service_role', async (tx) => {
    const first = (await tx.query("select key, attempts from public.reminders_reclaim(now() - interval '10 minutes')")).rows;
    const second = (await tx.query("select key from public.reminders_reclaim(now() - interval '10 minutes')")).rows;
    return { first, second };
  });
  assert.deepEqual(await take(), { first: [{ key: 'p-old', attempts: 1 }], second: [] });
  await db.query("delete from public.reminder_log where key like 'p-%'");
});

test('broken access keeps the moment it broke while it is edited, and forgets it once fixed', async () => {
  const { rows: [c] } = await db.query("insert into public.clients (name) values ('x') returning id");
  const { rows: [a] } = await db.query("insert into public.client_access (client_id, network, status, broken_since) values ($1, 'instagram', 'ok', now()) returning id, broken_since", [c.id]);
  assert.equal(a.broken_since, null); // never written by the app
  await db.query("update public.client_access set status = 'broken', broken_since = null where id = $1", [a.id]);
  const since = (await db.query('select broken_since from public.client_access where id = $1', [a.id])).rows[0].broken_since;
  assert.ok(since);
  await db.query("update public.client_access set note = 'עדיין לא', updated_at = now() + interval '1 hour', broken_since = now() + interval '1 day' where id = $1", [a.id]);
  assert.deepEqual((await db.query('select broken_since from public.client_access where id = $1', [a.id])).rows[0].broken_since, since);
  await db.query("update public.client_access set status = 'ok' where id = $1", [a.id]);
  assert.equal((await db.query('select broken_since from public.client_access where id = $1', [a.id])).rows[0].broken_since, null);
  const { rows: [b] } = await db.query("insert into public.client_access (client_id, network, status) values ($1, 'tiktok', 'broken') returning broken_since", [c.id]);
  assert.ok(b.broken_since);
});
