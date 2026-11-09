// "בוצע" by whoever gave the task (the owner, 9.11.2026;
// supabase/migrations/20261208110000_staff_task_giver_done.sql): the assignee as before, and the
// giver too; nobody else; only while it is open. The assignee's unread reminders are marked read,
// and the giver's own "<assignee> סימן/ה ״בוצע״" (rule nagDone) is written as handled, under the
// very key the reminders engine gives it, so it is never sent. Safe to run again.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, migrationSql } from './pg.mjs';
import { computeReminders } from '../../app/reminder-engine.js';

const MIGRATION = '20261208110000_staff_task_giver_done.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ilai: 'ilai', nadia: 'nadia' };
let db;
const users = {};

// Committed, as the signed-in person (the same as tests/sql/staff-task-claim.test.mjs).
async function call(who, sql, params = []) {
  const user = users[who];
  const claims = { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated' };
  try {
    return await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (err) {
    return { error: err.message };
  }
}
const give = async (who, to, body) => (await call(who, 'select public.staff_task_create($1, $2) as id', [to, body])).rows[0].id;
const rowOf = async (id) => (await db.query('select status, done_at, done_by_email from public.staff_tasks where id = $1', [id])).rows[0];
// A reminder of the task as the reminders function would log it (unread).
const nagRow = (id, person, n) => db.query(
  "insert into public.reminder_log (key, rule, person, level, channel, status, title) values ($1, 'nag', $2, 'ring', 'push', 'sent', 'תזכורת')",
  [`nag:-:${id}:2026-11-09.${n}@${person}`, person],
);

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2) on conflict (email) do update set person = excluded.person', [email, person]).catch(() => db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]));
  }
});

test('before the migration the giver is refused (what this migration changes)', async () => {
  const id = await give('irit', 'ilai', 'לבדוק את הגאנט של פיצה רון');
  assert.match((await call('irit', 'select public.staff_task_done($1)', [id])).error, /only the assignee marks a task done/);
  assert.equal((await rowOf(id)).status, 'open');
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION)); // safe to run again
});

test('Irit gave Ilai a task: she marks it done herself; it is stamped with her, his reminders are read, her own "done" ring is handled', async () => {
  const id = await give('irit', 'ilai', 'להעלות את הסרטונים של קפה דנה');
  await nagRow(id, 'ilai', 0);
  await nagRow(id, 'ilai', 1);
  const done = await call('irit', 'select (public.staff_task_done($1)).status as status', [id]);
  assert.equal(done.error, undefined);
  assert.equal(done.rows[0].status, 'done');
  const t = await rowOf(id);
  assert.deepEqual([t.status, !!t.done_at, t.done_by_email], ['done', true, 'irit@astrateg.test']);
  const nags = (await db.query("select read_at from public.reminder_log where rule = 'nag' and key like $1", [`nag:-:${id}:%`])).rows;
  assert.equal(nags.length, 2);
  assert.ok(nags.every((r) => r.read_at), 'the assignee\'s reminders of the task are read');
  // The key the engine gives Irit's "Ilai marked it done" is in the log already: the tick never sends it.
  const full = (await db.query('select * from public.staff_tasks where id = $1', [id])).rows[0];
  const task = { ...full, created_at: full.created_at.toISOString(), done_at: full.done_at.toISOString() };
  const staff = Object.entries(PEOPLE).map(([k, person]) => ({ email: `${k}@astrateg.test`, person }));
  const due = computeReminders({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff, deals: [], approvals: [], staffTasks: [task], now: new Date(full.done_at.getTime() + 60e3), log: [] })
    .filter((r) => r.rule === 'nagDone');
  assert.equal(due.length, 1);
  const logged = (await db.query('select person, level, status, read_at from public.reminder_log where key = $1', [due[0].key])).rows;
  assert.deepEqual(logged.map((r) => [r.person, r.level, r.status, !!r.read_at]), [['irit', 'quiet', 'suppressed', true]]);
  // The engine with that log: nothing for these tasks' rules (the nag stops on status, the giver is not told).
  const log = (await db.query('select key from public.reminder_log')).rows;
  const after = computeReminders({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff, deals: [], approvals: [], staffTasks: [task], now: new Date(full.done_at.getTime() + 60e3), log })
    .filter((r) => ['nag', 'nagDone'].includes(r.rule));
  assert.deepEqual(after, []);
  // Again: not open any more.
  assert.match((await call('irit', 'select public.staff_task_done($1)', [id])).error, /not open/);
  assert.match((await call('ilai', 'select public.staff_task_done($1)', [id])).error, /not open/);
});

test('the assignee marks done as before; the giver is then told (nothing is written for her)', async () => {
  const id = await give('irit', 'nadia', 'לשלוח את הקובץ הסופי');
  await nagRow(id, 'nadia', 0);
  assert.equal((await call('nadia', 'select public.staff_task_done($1)', [id])).error, undefined);
  assert.equal((await rowOf(id)).done_by_email, 'nadia@astrateg.test');
  assert.ok((await db.query("select read_at from public.reminder_log where key like $1 and rule = 'nag'", [`nag:-:${id}:%`])).rows[0].read_at);
  assert.equal((await db.query("select count(*)::int as n from public.reminder_log where rule = 'nagDone' and key like $1", [`nagDone:-:${id}:%`])).rows[0].n, 0);
});

test('nobody else: another giver, a stranger to the task, and the owner on a task Irit gave; cancel stays the giver\'s', async () => {
  const id = await give('irit', 'ilai', 'לעדכן את הלקוח');
  assert.match((await call('lior', 'select public.staff_task_done($1)', [id])).error, /task not found/);
  assert.match((await call('nadia', 'select public.staff_task_done($1)', [id])).error, /task not found/);
  assert.match((await call('owner', 'select public.staff_task_done($1)', [id])).error, /only the assignee or whoever gave it/);
  assert.equal((await rowOf(id)).status, 'open');
  // The owner marks his own.
  const own = await give('owner', 'ilai', 'להתקשר לספק');
  assert.equal((await call('owner', 'select public.staff_task_done($1)', [own])).error, undefined);
  assert.equal((await rowOf(own)).done_by_email, 'owner@astrateg.test');
  // Cancel is untouched: still the giver's, and a cancelled task cannot be marked done.
  assert.equal((await call('irit', 'select public.staff_task_cancel($1)', [id])).error, undefined);
  assert.match((await call('irit', 'select public.staff_task_done($1)', [id])).error, /not open/);
});

test('a giver who no longer gives tasks cannot mark one done (as cancel)', async () => {
  const id = await give('lior', 'ilai', 'לבדוק את הכונן');
  await db.query("create or replace function public.can_give_staff_tasks() returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(public.reminder_person() in ('owner', 'irit', 'ofir'), false) $$");
  try {
    assert.match((await call('lior', 'select public.staff_task_done($1)', [id])).error, /only the assignee or whoever gave it/);
  } finally {
    await db.exec(migrationSql('20261031090000_nudnik_givers.sql'));
  }
  assert.equal((await call('lior', 'select public.staff_task_done($1)', [id])).error, undefined);
});
