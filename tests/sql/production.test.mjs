// The production pages' database parts (supabase/migrations/20260930140000_production.sql)
// in a real Postgres with every migration (tests/sql/pg.mjs): how a brief task ended
// (client_tasks.result), who may record it, and the route of work that goes to the
// client: Ofir checks, then Irit sends (decision 19). Plus the new check keys.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as } from './pg.mjs';

let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', nirel: 'nirel', nadia: 'nadia', eli: 'eli' };

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  for (const [name, type, editor] of [['natali', 'natali', 'nirel'], ['other', 'dms', 'nadia']]) {
    const { rows } = await db.query('insert into public.clients (name, shoot_type, editor) values ($1, $2, $3) returning id', [name, type, editor]);
    ids[name] = rows[0].id;
  }
});

const run = (who, fn) => as(db, users[who], fn);
const q = (who, sql, params = []) => run(who, async (tx) => (await tx.query(sql, params)).rows);

test('the new marks of the production pages pass the key rule, in a round too', async () => {
  const keys = ['p22.missing', 'p25.return', 'p24.fixed', 'p27.fixed', 'p27.ilai', 'p16.brief', 'p17b.brollq', 'p18.shot', 'p18.quiet', 'r2.p22.missing', 'r3.p17b.brollq'];
  const out = await q('lior', `insert into public.protocol_checks (client_id, item_key, state, note)
    select $1, k, 'done', '{}' from unnest($2::text[]) k returning item_key`, [ids.other, keys]);
  assert.deepEqual(out.map((r) => r.item_key).sort(), [...keys].sort());
  const bad = await q('lior', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.Missing', 'done')", [ids.other]);
  assert.match(bad.error, /protocol_checks_item_key_check/);
});

test('a task\'s result: an object, written by its owner (or the office), with the RLS of the tasks', async () => {
  const out = await run('nirel', async (tx) => {
    const { rows: [t] } = await tx.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'באנר', 'nirel') returning id", [ids.natali]);
    const { rows: [r] } = await tx.query(`update public.client_tasks set result = '{"done":"בוצע","drive":"https://drive.google.com/x"}', done_at = now()
      where id = $1 returning result->>'done' as done, done_at is not null as closed, done_by_email`, [t.id]);
    return r;
  });
  assert.deepEqual(out, { done: 'בוצע', closed: true, done_by_email: 'nirel@astrateg.test' });
  // Not an object.
  const bad = await run('lior', async (tx) => {
    const { rows: [t] } = await tx.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'x', 'nirel') returning id", [ids.natali]);
    await tx.query("update public.client_tasks set result = '[1]' where id = $1", [t.id]);
  });
  assert.match(bad.error, /client_tasks_result_check/);
  // Someone else's task on a client they see: only its owner records how it ended.
  const { rows: [lt] } = await db.query("insert into public.client_tasks (client_id, title, owner, created_by_email) values ($1, 'task of lior', 'lior', 'ofir@astrateg.test') returning id", [ids.natali]);
  const other = await q('nirel', "update public.client_tasks set result = '{\"done\":\"x\"}' where id = $1", [lt.id]);
  assert.match(other.error, /only the task's owner records how it ended/);
  // A client Nadia does not see: nothing to update (row level security).
  const hidden = await q('nadia', "update public.client_tasks set result = '{\"done\":\"x\"}' where id = $1 returning id", [lt.id]);
  assert.deepEqual(hidden, []);
  const office = await q('lior', "update public.client_tasks set result = '{\"done\":\"בשם\"}' where id = $1 returning result->>'done' as d", [lt.id]);
  assert.deepEqual(office, [{ d: 'בשם' }]);
});

test('work that goes to the client: only the office closes Ofir\'s check, and closing it opens Irit\'s "send" once', async () => {
  const out = await run('nirel', async (tx) => {
    const { rows: [t] } = await tx.query(`insert into public.client_tasks (client_id, title, owner, due_on, brief)
      values ($1, 'לבדוק לפני שליחה ללקוח: באנר', 'ofir', current_date, '{"problem":"עבודה של ניראל","materials":"https://drive.google.com/x","route":"irit"}') returning id`, [ids.natali]);
    try {
      await tx.query('savepoint s');
      await tx.query('update public.client_tasks set done_at = now() where id = $1', [t.id]);
      return { closed: true };
    } catch (err) {
      await tx.query('rollback to savepoint s');
      return { closed: false, error: err.message, id: t.id };
    }
  });
  assert.equal(out.closed, false);
  assert.match(out.error, /the office checks this work/);
  // Ofir closes it: Irit gets the send task, with the Drive link; undo takes it back; again: one task.
  const flow = await run('ofir', async (tx) => {
    const { rows: [t] } = await tx.query(`insert into public.client_tasks (client_id, title, owner, due_on, brief)
      values ($1, 'לבדוק לפני שליחה ללקוח: באנר', 'ofir', current_date, '{"materials":"https://drive.google.com/x","route":"irit"}') returning id`, [ids.natali]);
    const irit = async () => (await tx.query("select title, owner, brief->>'materials' as m, created_by_email as by, done_at from public.client_tasks where brief->>'from_task' = $1", [t.id])).rows;
    await tx.query('update public.client_tasks set done_at = now() where id = $1', [t.id]);
    const first = await irit();
    await tx.query('update public.client_tasks set done_at = null where id = $1', [t.id]);
    const undone = await irit();
    await tx.query('update public.client_tasks set done_at = now() where id = $1', [t.id]);
    return { first, undone, again: await irit() };
  });
  assert.deepEqual(flow.first, [{ title: 'לשלוח ללקוח אחרי בדיקת אופיר: באנר', owner: 'irit', m: 'https://drive.google.com/x', by: 'ofir@astrateg.test', done_at: null }]);
  assert.deepEqual(flow.undone, []);
  assert.equal(flow.again.length, 1);
  // A task without a route opens nothing.
  const plain = await run('ofir', async (tx) => {
    const { rows: [t] } = await tx.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'רגילה', 'ofir') returning id", [ids.other]);
    await tx.query('update public.client_tasks set done_at = now() where id = $1', [t.id]);
    return (await tx.query("select count(*)::int as n from public.client_tasks where owner = 'irit'")).rows[0].n;
  });
  assert.equal(plain, 0);
});

test('the migration can run again', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../../supabase/migrations/20260930140000_production.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  const { rows } = await db.query("select count(*)::int as n from pg_trigger where tgname in ('client_tasks_route', 'client_tasks_route_guard')");
  assert.equal(rows[0].n, 2);
});
