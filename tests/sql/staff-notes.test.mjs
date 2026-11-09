// "הערה מיוחדת" for one employee (9.11.2026; supabase/migrations/20261206100000_staff_notes.sql):
// the writers (the owners, Irit, Lior, Ofir) insert, read every note and delete one (a soft
// delete); an employee reads only their own live notes, and cannot insert or delete. Who wrote
// it is stamped by the table. Safe to run twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, migrationSql } from './pg.mjs';

const MIGRATION = '20261206100000_staff_notes.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia' };
let db;
const users = {};

// Committed, as the signed-in person (as tests/sql/staff-task-claim.test.mjs).
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
const write = (who, person, body) => call(who, 'insert into public.staff_notes (person, body) values ($1, $2) returning id', [person, body]);
const visible = async (who) => (await call(who, 'select id, person, body from public.staff_notes order by created_at, id')).rows;

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

test('each writer inserts a note; who wrote it and when are stamped by the table', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir']) {
    const r = await write(who, 'nadia', `הערה מ${who}`);
    assert.ok(!r.error, `${who}: ${r.error}`);
  }
  const rows = (await db.query("select created_by, created_by_email, created_at, deleted_at from public.staff_notes where person = 'nadia' order by created_at")).rows;
  assert.deepEqual(rows.map((r) => r.created_by).sort(), ['irit', 'lior', 'ofir', 'owner']);
  assert.ok(rows.every((r) => r.created_by_email.endsWith('@astrateg.test') && r.created_at && !r.deleted_at));
  // Not from the caller: who wrote it cannot be set.
  assert.match((await call('lior', "insert into public.staff_notes (person, body, created_by) values ('ilai', 'x', 'owner')")).error, /permission denied/);
  assert.match((await call('lior', "insert into public.staff_notes (person, body, deleted_at) values ('ilai', 'x', now())")).error, /permission denied/);
});

test('an employee cannot write, change or delete a note', async () => {
  assert.match((await write('ilai', 'nadia', 'לא מורשה')).error, /row-level security|permission denied/);
  assert.match((await write('ilai', 'ilai', 'לעצמי')).error, /row-level security|permission denied/);
  const id = (await write('lior', 'ilai', 'לא לגעת בלקוח מסעדת בוכרה')).rows[0].id;
  assert.match((await call('ilai', 'select public.staff_note_delete($1)', [id])).error, /not allowed/);
  assert.match((await call('ilai', 'update public.staff_notes set body = $2 where id = $1', [id, 'x'])).error, /permission denied/);
  assert.match((await call('ilai', 'delete from public.staff_notes where id = $1', [id])).error, /permission denied/);
  assert.match((await call('lior', 'delete from public.staff_notes where id = $1', [id])).error, /permission denied/, 'deleting is the function only');
  await call('lior', 'select public.staff_note_delete($1)', [id]);
});

test('the text: 1 to 1000 characters', async () => {
  assert.match((await write('irit', 'ilai', '   ')).error, /check constraint/);
  assert.match((await write('irit', 'ilai', 'א'.repeat(1001))).error, /check constraint/);
  const ok = await write('irit', 'ilai', 'א'.repeat(1000));
  assert.ok(!ok.error);
  await call('irit', 'select public.staff_note_delete($1)', [ok.rows[0].id]);
});

test('an employee reads only their own live notes; the writers read all; a deleted note disappears for its person', async () => {
  const forIlai = (await write('lior', 'ilai', 'לא לגעת בלקוח מסעדת בוכרה')).rows[0].id;
  const forIlai2 = (await write('owner', 'ilai', 'להתקשר לאופיר לפני כל פרסום')).rows[0].id;
  const forNadia = (await write('irit', 'nadia', 'לנדיה בלבד')).rows[0].id;
  const ilaiSees = (await visible('ilai')).map((r) => r.id);
  assert.deepEqual(ilaiSees, [forIlai, forIlai2]);
  assert.ok(!(await visible('nadia')).some((r) => r.id === forIlai), 'Nadia does not read Ilai\'s notes');
  assert.ok((await visible('nadia')).some((r) => r.id === forNadia));
  for (const w of ['owner', 'irit', 'lior', 'ofir']) {
    const ids = (await visible(w)).map((r) => r.id);
    for (const id of [forIlai, forIlai2, forNadia]) assert.ok(ids.includes(id), `${w} reads ${id}`);
  }
  // Ofir deletes Lior's note (any writer may): gone for Ilai, kept as history for the writers.
  const del = await call('ofir', 'select (public.staff_note_delete($1)).deleted_at as at', [forIlai]);
  assert.ok(del.rows[0].at);
  assert.deepEqual((await visible('ilai')).map((r) => r.id), [forIlai2]);
  const row = (await call('lior', 'select deleted_at, deleted_by_email from public.staff_notes where id = $1', [forIlai])).rows[0];
  assert.ok(row.deleted_at);
  assert.equal(row.deleted_by_email, 'ofir@astrateg.test');
  // Deleting again changes nothing; an unknown id is refused.
  const again = await call('irit', 'select (public.staff_note_delete($1)).deleted_by_email as by', [forIlai]);
  assert.equal(again.rows[0].by, 'ofir@astrateg.test');
  assert.match((await call('irit', 'select public.staff_note_delete($1)', ['00000000-0000-4000-8000-000000000000'])).error, /note not found/);
});

test('deleting marks the note\'s unread notification read', async () => {
  const id = (await write('lior', 'nadia', 'הערה עם התראה')).rows[0].id;
  await db.query(`insert into public.reminder_log (key, rule, person, level, channel, status, title)
    values ($1, 'staffNote', 'nadia', 'ring', 'push', 'sent', 'הערה מיוחדת מליאור')`, [`staffNote:-:${id}:now@nadia`]);
  await call('lior', 'select public.staff_note_delete($1)', [id]);
  const log = (await db.query('select read_at from public.reminder_log where key = $1', [`staffNote:-:${id}:now@nadia`])).rows[0];
  assert.ok(log.read_at);
});

test('nobody signed in reads or writes anything', async () => {
  const anonRead = await db.transaction(async (tx) => {
    await tx.query('set local role anon');
    try { await tx.query('select 1 from public.staff_notes'); return 'read'; } catch (err) { return err.message; }
  });
  assert.match(anonRead, /permission denied/);
});
