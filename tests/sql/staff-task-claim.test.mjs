// "אני על זה" on a task given on the spot (the owner, 8.11.2026;
// supabase/migrations/20261203100000_staff_task_claim.sql): only the assignee, only while it
// is open; the first moment is kept; whoever gave it reads it. Safe to run again.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, migrationSql } from './pg.mjs';

const MIGRATION = '20261203100000_staff_task_claim.sql';
const PEOPLE = { owner: null, irit: 'irit', nadia: 'nadia', ilai: 'ilai' };
let db;
const users = {};

// Committed, as the signed-in person (the same as tests/sql/staff-tasks.test.mjs).
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

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2) on conflict (email) do update set person = excluded.person', [email, person]).catch(() => db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]));
  }
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
});

test('only the assignee takes it, while it is open; pressing again keeps the first moment; the giver reads it', async () => {
  const id = (await call('irit', "select public.staff_task_create('nadia', 'לערוך עוד 43 סרטונים') as id")).rows[0].id;
  assert.match((await call('irit', 'select public.staff_task_claim($1)', [id])).error, /only the assignee takes a task/);
  assert.match((await call('ilai', 'select public.staff_task_claim($1)', [id])).error, /task not found/);
  const first = (await call('nadia', 'select (public.staff_task_claim($1)).claimed_at as at', [id])).rows[0].at;
  assert.ok(first);
  const again = (await call('nadia', 'select (public.staff_task_claim($1)).claimed_at as at', [id])).rows[0].at;
  assert.equal(+new Date(again), +new Date(first));
  const seen = (await call('irit', 'select claimed_at, status from public.staff_tasks where id = $1', [id])).rows[0];
  assert.deepEqual([!!seen.claimed_at, seen.status], [true, 'open']);
  // Done: it can no longer be taken.
  await call('nadia', 'select public.staff_task_done($1)', [id]);
  assert.match((await call('nadia', 'select public.staff_task_claim($1)', [id])).error, /not open/);
});
