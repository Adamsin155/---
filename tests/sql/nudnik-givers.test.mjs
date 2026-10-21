// "שליחת נודניק" for Lior and Ofir too (supabase/migrations/20261031090000_nudnik_givers.sql,
// the owner, 21.10.2026), on every migration in a real Postgres (PGlite): the database's
// list is the app's GIVERS, a giver cancels only their own task, and the file runs twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { GIVERS } from '../../app/staff-tasks-logic.js';

const MIGRATION = '20261031090000_nudnik_givers.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', eli: 'eli', stav: 'stav' };
const DENIED = /not allowed|permission denied|row-level security/;
let db;
const users = {};

async function call(who, sql, params = []) {
  const user = who === 'anon' ? null : users[who];
  const role = user ? 'authenticated' : 'anon';
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
const q = (who, sql, params = []) => as(db, who === 'anon' ? null : users[who], async (tx) => ({ rows: (await tx.query(sql, params)).rows }));

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  await db.exec(migrationSql(MIGRATION));
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
});

test('who sends a nudnik: the owner, Irit, Lior and Ofir, exactly the app\'s list; nobody else', async () => {
  assert.deepEqual(GIVERS, ['owner', 'irit', 'lior', 'ofir']);
  for (const who of Object.keys(PEOPLE)) {
    const person = PEOPLE[who] ?? 'owner';
    assert.equal((await q(who, 'select public.can_give_staff_tasks() as ok')).rows[0].ok, GIVERS.includes(person), who);
    const r = await q(who, "select public.staff_task_create('nadia', 'x') as id");
    if (GIVERS.includes(person)) assert.ok(r.rows[0].id, who);
    else assert.match(r.error, DENIED, who);
  }
  assert.match((await q('anon', 'select public.can_give_staff_tasks()')).error, DENIED);
});

test('Lior cancels his own nudnik, not Ofir\'s; the file runs twice', async () => {
  const mine = (await call('lior', "select public.staff_task_create('nadia', 'להעלות את הסרטון') as id")).rows[0].id;
  const ofirs = (await call('ofir', "select public.staff_task_create('nadia', 'לבדוק את הגרפיקה') as id")).rows[0].id;
  assert.match((await call('lior', 'select public.staff_task_cancel($1)', [ofirs])).error || '', /not allowed|task not found/);
  assert.equal((await call('lior', 'select public.staff_task_cancel($1)', [mine])).error, undefined);
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
  assert.equal((await q('ofir', 'select public.can_give_staff_tasks() as ok')).rows[0].ok, true);
});
