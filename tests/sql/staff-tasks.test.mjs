// Tasks given on the spot in the database
// (supabase/migrations/20261011100000_staff_tasks.sql), on every migration in a real
// Postgres (PGlite): who gives a task (the same list as the app's), to whom, what the
// database stamps itself, who reads which task, that only the assignee marks it done
// and only the giver or the owner cancels it, that the browser cannot write the table
// directly, the reminder log taking a row per 10-minute slot once, the reminders'
// cron left as it was, and the migration running twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { GIVERS, ASSIGNEES, BODY_MAX } from '../../app/staff-tasks-logic.js';

const MIGRATION = '20261011100000_staff_tasks.sql';
// Yariv and Anna have no login here: a task cannot be given to them.
const PEOPLE = { owner: null, owner2: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nirel: 'nirel', nadia: 'nadia', eli: 'eli', stav: 'stav', amos: 'amos', old: 'editor' };
const DENIED = /not allowed|permission denied|row-level security/;
let db;
const users = {};
const ids = {};

// A call that stays (committed), as a signed-in user, anon (null) or the service role.
async function call(who, sql, params = []) {
  const user = who === 'anon' || who === 'service' ? null : users[who];
  const role = who === 'service' ? 'service_role' : user ? 'authenticated' : 'anon';
  const claims = user ? { sub: user.id, email: user.email, role, aud: 'authenticated' } : { role };
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (err) {
    return { error: err.message };
  }
}
// The same, rolled back.
const q = (who, sql, params = []) => as(db, who === 'anon' ? null : users[who], async (tx) => ({ rows: (await tx.query(sql, params)).rows }));
const give = async (who, assignee, body = 'להעלות את הסרטון לדרייב', client = null) => {
  const r = await call(who, 'select public.staff_task_create($1, $2, $3) as id', [assignee, body, client]);
  return r.error ? r : r.rows[0].id;
};
const row = async (id) => (await db.query('select * from public.staff_tasks where id = $1', [id])).rows[0];
const sees = async (who) => (await q(who, 'select id from public.staff_tasks order by created_at, id')).rows.map((r) => r.id);

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  // A login that is not on the staff list.
  const out = await db.query("insert into auth.users (email, email_confirmed_at) values ('stranger@else.test', now()) returning id");
  users.stranger = { id: out.rows[0].id, email: 'stranger@else.test' };
  ids.client = (await db.query("insert into public.clients (name, business, editor) values ('רון כהן', 'פיצה רון', 'nadia') returning id")).rows[0].id;
  ids.same = (await db.query("insert into public.clients (name, business) values ('קפה דנה', 'קפה דנה') returning id")).rows[0].id;
  // The migration, twice (safe to run again).
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
});

test('who gives a task: the owner and Irit, exactly the app\'s list; nobody else, and nobody unsigned', async () => {
  assert.deepEqual(GIVERS, ['owner', 'irit']);
  for (const who of Object.keys(PEOPLE)) {
    const person = PEOPLE[who] ?? 'owner';
    const can = (await q(who, 'select public.can_give_staff_tasks() as ok')).rows[0].ok;
    assert.equal(can, GIVERS.includes(person), who);
    const r = await q(who, "select public.staff_task_create('nadia', 'x') as id");
    if (GIVERS.includes(person)) assert.ok(r.rows[0].id, who);
    else assert.match(r.error, DENIED, who);
  }
  assert.match((await q('stranger', "select public.staff_task_create('nadia', 'x') as id")).error, DENIED);
  assert.match((await q('anon', "select public.staff_task_create('nadia', 'x') as id")).error, DENIED);
  assert.match((await q('anon', 'select public.can_give_staff_tasks()')).error, DENIED);
  // The list lives in one function of the migration.
  const sql = readFileSync(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/reminder_person\(\) in \('owner', 'irit'\)/g).length, 1);
});

test('a task is stamped by the database: who gave it, when, open; the client\'s name is kept with it', async () => {
  ids.a = await give('irit', 'nadia', '  להעלות את הסרטון של פיצה רון לדרייב  ', ids.client);
  const a = await row(ids.a);
  assert.deepEqual([a.created_by, a.created_by_email, a.assignee, a.body, a.status, a.client_id, a.client_name, a.done_at, a.cancelled_at],
    ['irit', 'irit@astrateg.test', 'nadia', 'להעלות את הסרטון של פיצה רון לדרייב', 'open', ids.client, 'פיצה רון · רון כהן', null, null]);
  assert.ok(Math.abs(Date.now() - new Date(a.created_at)) < 60e3);
  // The owner gives one to Irit, one to a sales agent and one to the other owner; a client whose business is its name.
  ids.b = await give('owner', 'irit', 'להתקשר לרואה החשבון', ids.same);
  ids.c = await give('owner', 'stav', 'לשלוח לי את רשימת הלידים');
  ids.d = await give('irit', 'owner', 'לאשר את ההצעה של קפה דנה');
  ids.e = await give('irit', 'eli', 'לטעון סוללות');
  assert.deepEqual([(await row(ids.b)).client_name, (await row(ids.b)).created_by, (await row(ids.c)).client_name, (await row(ids.d)).assignee], ['קפה דנה', 'owner', null, 'owner']);
});

test('to whom: everyone on the team with a login, and the owner; the text is required, up to 500 characters', async () => {
  // The database accepts exactly the people the form offers.
  const offered = ASSIGNEES().map((p) => p.key);
  const sql = readFileSync(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  const listed = /assignee text not null check \(assignee in \(([^)]+)\)\)/.exec(sql)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual([...listed].sort(), [...offered].sort());
  for (const p of ['yariv', 'anna']) assert.match((await give('irit', p)).error, /the assignee has no login/, p);
  for (const p of ['editor', 'nobody', '', null]) assert.match((await give('irit', p)).error, /unknown assignee/, String(p));
  for (const body of ['', '   ', null, 'א'.repeat(BODY_MAX + 1)]) assert.match((await give('irit', 'nadia', body)).error, /task text is required/);
  assert.ok(await give('irit', 'nadia', 'א'.repeat(BODY_MAX)));
  await db.query("delete from public.staff_tasks where length(body) = 500");
  assert.match((await give('irit', 'nadia', 'x', '99999999-9999-4999-8999-999999999999')).error, /client not found/);
  // Irit may give one to herself.
  const self = await give('irit', 'irit', 'לזכור להזמין קפה');
  assert.equal((await row(self)).assignee, 'irit');
  await db.query('delete from public.staff_tasks where id = $1', [self]);
});

test('the browser cannot write the table: no insert, update or delete, whoever asks', async () => {
  for (const who of ['owner', 'irit', 'nadia', 'stav']) {
    assert.match((await q(who, "insert into public.staff_tasks (created_by, created_by_email, assignee, body) values ('owner', 'owner@astrateg.test', 'nadia', 'x')")).error, DENIED, who);
    assert.match((await q(who, "update public.staff_tasks set status = 'done', done_at = now() where id = $1", [ids.a])).error, DENIED, who);
    assert.match((await q(who, "update public.staff_tasks set body = 'אחר' where id = $1", [ids.a])).error, DENIED, who);
    assert.match((await q(who, 'delete from public.staff_tasks where id = $1', [ids.a])).error, DENIED, who);
  }
  assert.match((await q('anon', 'select id from public.staff_tasks')).error, DENIED);
  assert.equal((await row(ids.a)).status, 'open');
  // The table itself holds a done task to its stamp.
  await assert.rejects(db.query("update public.staff_tasks set status = 'done' where id = $1", [ids.a]), /check/);
  await assert.rejects(db.query("update public.staff_tasks set status = 'cancelled', done_at = now(), cancelled_at = now() where id = $1", [ids.a]), /check/);
});

test('reading: the assignee, whoever gave it, and the owners; nobody else', async () => {
  const set = (list) => [...list].sort();
  assert.deepEqual(set(await sees('owner')), set([ids.a, ids.b, ids.c, ids.d, ids.e]));
  assert.deepEqual(set(await sees('owner2')), set([ids.a, ids.b, ids.c, ids.d, ids.e]));
  assert.deepEqual(set(await sees('irit')), set([ids.a, ids.b, ids.d, ids.e]), 'hers and the ones she gave; not the owner\'s task to Stav');
  assert.deepEqual(await sees('nadia'), [ids.a]);
  assert.deepEqual(await sees('stav'), [ids.c]);
  assert.deepEqual(await sees('eli'), [ids.e]);
  for (const who of ['lior', 'ofir', 'ilai', 'nirel', 'amos', 'old', 'stranger']) assert.deepEqual(await sees(who), [], who);
});

test('"בוצע": only the assignee, once; it stamps who and when and marks the task\'s reminders read', async () => {
  // Three reminders of this task rang Nadia, one of another task, and one ordinary reminder.
  const log = (key, rule, person) => db.query("insert into public.reminder_log (key, rule, person, level, channel, status, title, exempt) values ($1, $2, $3, 'ring', 'push', 'sent', 't', true)", [key, rule, person]);
  for (const n of [0, 1, 2]) await log(`nag:-:${ids.a}:2026-10-06.${n}@nadia`, 'nag', 'nadia');
  await log(`nag:-:${ids.e}:2026-10-06.0@eli`, 'nag', 'eli');
  await log('task:c1:t1:created@nadia', 'task', 'nadia');
  // Whoever gave it cannot mark it done for her; nor the owner; someone else does not even learn it exists.
  assert.match((await call('irit', 'select public.staff_task_done($1)', [ids.a])).error, /only the assignee marks a task done/);
  assert.match((await call('owner', 'select public.staff_task_done($1)', [ids.a])).error, /only the assignee marks a task done/);
  for (const who of ['lior', 'stav', 'eli', 'old']) assert.match((await call(who, 'select public.staff_task_done($1)', [ids.a])).error, /task not found/, who);
  for (const who of ['stranger', 'anon']) assert.match((await call(who, 'select public.staff_task_done($1)', [ids.a])).error, DENIED, who);
  assert.equal((await row(ids.a)).status, 'open');
  const r = await call('nadia', 'select (public.staff_task_done($1)).status as status', [ids.a]);
  assert.equal(r.rows[0].status, 'done');
  const a = await row(ids.a);
  assert.deepEqual([a.status, a.done_by_email, a.cancelled_at], ['done', 'nadia@astrateg.test', null]);
  assert.ok(Math.abs(Date.now() - new Date(a.done_at)) < 60e3);
  const read = Object.fromEntries((await db.query("select key, read_at is not null as read from public.reminder_log where rule in ('nag', 'task')")).rows.map((x) => [x.key, x.read]));
  assert.deepEqual(read, {
    [`nag:-:${ids.a}:2026-10-06.0@nadia`]: true, [`nag:-:${ids.a}:2026-10-06.1@nadia`]: true, [`nag:-:${ids.a}:2026-10-06.2@nadia`]: true,
    [`nag:-:${ids.e}:2026-10-06.0@eli`]: false, 'task:c1:t1:created@nadia': false,
  });
  // Twice, or after it was closed: refused, nothing changes.
  assert.match((await call('nadia', 'select public.staff_task_done($1)', [ids.a])).error, /this task is not open/);
  assert.match((await call('irit', 'select public.staff_task_cancel($1)', [ids.a])).error, /this task is not open/);
  assert.equal((await row(ids.a)).done_at.toISOString(), a.done_at.toISOString());
  // The owner as an assignee: either owner login marks it.
  assert.equal((await call('owner2', 'select (public.staff_task_done($1)).status as status', [ids.d])).rows[0].status, 'done');
  // A sales agent marks his own.
  assert.equal((await call('stav', 'select (public.staff_task_done($1)).status as status', [ids.c])).rows[0].status, 'done');
});

test('cancelling: whoever gave it, or the owner; never the assignee; kept as cancelled, not done', async () => {
  assert.match((await call('eli', 'select public.staff_task_cancel($1)', [ids.e])).error, DENIED);
  for (const who of ['lior', 'nadia', 'stav']) assert.match((await call(who, 'select public.staff_task_cancel($1)', [ids.e])).error, /task not found/, who);
  // Irit cannot cancel a task the owner gave her (she can mark it done).
  assert.match((await call('irit', 'select public.staff_task_cancel($1)', [ids.b])).error, DENIED);
  const r = await call('irit', 'select (public.staff_task_cancel($1)).status as status', [ids.e]);
  assert.equal(r.rows[0].status, 'cancelled');
  const e = await row(ids.e);
  assert.deepEqual([e.status, e.done_at, e.cancelled_by_email], ['cancelled', null, 'irit@astrateg.test']);
  assert.equal((await db.query("select read_at is not null as read from public.reminder_log where key like 'nag:-:' || $1 || ':%'", [ids.e])).rows[0].read, true);
  assert.match((await call('eli', 'select public.staff_task_done($1)', [ids.e])).error, /this task is not open/);
  // The owner cancels one Irit gave.
  const f = await give('irit', 'ilai', 'x');
  assert.equal((await call('owner', 'select (public.staff_task_cancel($1)).status as status', [f])).rows[0].status, 'cancelled');
  assert.equal((await call('irit', 'select (public.staff_task_done($1)).status as status', [ids.b])).rows[0].status, 'done');
});

test('the reminder log takes one row per 10-minute slot of a task, for every assignee, and never the same slot twice', async () => {
  const add = (key, person) => call('service', "insert into public.reminder_log (key, rule, person, level, channel, status, title, exempt, url) values ($1, 'nag', $2, 'ring', 'push', 'pending', 'משימה מעירית: x', true, $3) on conflict (key) do nothing returning id",
    [key, person, person === 'stav' || person === 'amos' ? 'deal.html' : 'clients.html#mine']);
  for (const p of ASSIGNEES().map((x) => x.key)) {
    const key = `nag:-:${ids.a}:2026-10-06.3@${p}`;
    assert.equal((await add(key, p)).rows.length, 1, p);
    assert.equal((await add(key, p)).rows.length, 0, `${p}: the same slot again`);
    assert.equal((await add(`nag:-:${ids.a}:2026-10-06.4@${p}`, p)).rows.length, 1, `${p}: the next slot`);
  }
  // The engine's dedupe reads them back.
  const known = await call('service', 'select key from public.reminders_known($1)', [[`nag:-:${ids.a}:2026-10-06.3@stav`, `nag:-:${ids.a}:2026-10-06.9@stav`]]);
  assert.deepEqual(known.rows.map((r) => r.key), [`nag:-:${ids.a}:2026-10-06.3@stav`]);
  // Each person reads their own in "התראות".
  assert.equal((await q('amos', "select count(*)::int as n from public.reminder_log where rule = 'nag'")).rows[0].n, 2);
  await db.query("delete from public.reminder_log where key like '%2026-10-06.3@%' or key like '%2026-10-06.4@%'");
});

test('the service role (the reminders function) reads every task; a deleted client leaves the task with its name', async () => {
  const r = await call('service', "select id, created_at, created_by, assignee, body, client_id, client_name, status, done_at from public.staff_tasks where status = 'open' or done_at >= now() - interval '2 days' order by id");
  assert.ok(r.rows.length >= 4, JSON.stringify(r));
  await db.query('delete from public.clients where id = $1', [ids.client]);
  const a = await row(ids.a);
  assert.deepEqual([a.client_id, a.client_name], [null, 'פיצה רון · רון כהן']);
});

test('the reminders\' cron is as it was (every minute), and the migration runs again over live rows', async () => {
  assert.deepEqual((await db.query("select jobname, schedule from cron.job where jobname = 'reminders-tick'")).rows, [{ jobname: 'reminders-tick', schedule: '* * * * *' }]);
  const sql = migrationSql(MIGRATION);
  assert.ok(!/cron\.schedule|cron\.unschedule/.test(sql.replace(/^\s*--.*$/gm, '')));
  // Nothing destructive: no table, column or row is dropped or deleted (the table's own policy is recreated).
  const code = sql.replace(/^\s*--.*$/gm, '');
  assert.deepEqual(code.match(/^[ \t]*(drop|delete|truncate|alter table [^;]*\bdrop)\b[^;]*;/gim), ['drop policy if exists "staff read their tasks" on public.staff_tasks;']);
  const before = (await db.query('select id, status, done_at, body from public.staff_tasks order by id')).rows;
  await db.exec(sql);
  assert.deepEqual((await db.query('select id, status, done_at, body from public.staff_tasks order by id')).rows, before);
  assert.deepEqual(await sees('nadia'), [ids.a]);
  assert.match((await q('lior', "select public.staff_task_create('nadia', 'x')")).error, DENIED);
});
