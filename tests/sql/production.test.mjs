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
  // (Returns for fixes are the office's marks, p25.return.N / p25.fixed.N.I, tested in office-flows.test.mjs.)
  const keys = ['p22.missing', 'p27.fixed', 'p16.brief', 'p17b.brollq', 'p18.shot', 'p18.quiet', 'r2.p22.missing', 'r3.p17b.brollq', 'r2.p25.fixed.1.0'];
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
  // Nor by taking the route out in the same update.
  const { rows: [check] } = await db.query(`insert into public.client_tasks (client_id, title, owner, due_on, brief, created_by_email)
    values ($1, 'לבדוק לפני שליחה ללקוח: באנר', 'ofir', current_date, '{"route":"irit"}', 'nirel@astrateg.test') returning id`, [ids.natali]);
  const sneak = await q('nirel', "update public.client_tasks set brief = brief - 'route', done_at = now() where id = $1", [check.id]);
  assert.match(sneak.error, /the office checks this work|only the office changes where checked work goes/);
  await db.query('delete from public.client_tasks where id = $1', [check.id]);
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

test('outside the office the route cannot be dodged: not in an earlier update, not by opening the task closed, not with someone else\'s result', async () => {
  const { rows: [check] } = await db.query(`insert into public.client_tasks (client_id, title, owner, due_on, brief, created_by_email)
    values ($1, 'לבדוק לפני שליחה ללקוח: באנר', 'ofir', current_date, '{"route":"irit"}', 'nirel@astrateg.test') returning id`, [ids.natali]);
  // Taking the route out first, then closing: refused at the first step.
  const twoSteps = await run('nirel', async (tx) => {
    await tx.query("update public.client_tasks set brief = brief - 'route' where id = $1", [check.id]);
    return (await tx.query('update public.client_tasks set done_at = now() where id = $1 returning id', [check.id])).rows;
  });
  assert.match(twoSteps.error, /only the office changes where checked work goes/);
  // Nor adding a route to someone's task. The other brief fields: since
  // 20261014100000_security_hardening.sql only the office changes what a task says
  // (no screen outside the office edits a brief), also for whoever opened the task.
  const add = await run('nirel', async (tx) => {
    const { rows: [t] } = await tx.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'x', 'ofir') returning id", [ids.natali]);
    await tx.query(`update public.client_tasks set brief = '{"route":"irit"}' where id = $1`, [t.id]);
  });
  assert.match(add.error, /only the office changes where checked work goes/);
  const edit = await q('nirel', "update public.client_tasks set brief = brief || '{\"materials\":\"https://drive.google.com/y\"}' where id = $1 returning brief->>'route' as r", [check.id]);
  assert.match(edit.error, /someone else's|only the office changes what a task says/);
  const office = await q('ofir', "update public.client_tasks set brief = brief || '{\"materials\":\"https://drive.google.com/y\"}' where id = $1 returning brief->>'route' as r", [check.id]);
  assert.deepEqual(office, [{ r: 'irit' }]);
  // Opening a routed task already closed.
  const closed = await q('nirel', `insert into public.client_tasks (client_id, title, owner, brief, done_at)
    values ($1, 'לבדוק', 'ofir', '{"route":"irit"}', now()) returning id`, [ids.natali]);
  assert.match(closed.error, /the office checks this work/);
  // Opening someone else's task with its result already written.
  const forged = await q('nadia', `insert into public.client_tasks (client_id, title, owner, result, done_at)
    values ($1, 'באנר', 'nirel', '{"done":"x"}', now()) returning id`, [ids.other]);
  assert.match(forged.error, /only the task's owner records how it ended/);
  // One's own is fine; the office's too.
  assert.equal((await q('nirel', `insert into public.client_tasks (client_id, title, owner, result) values ($1, 'x', 'nirel', '{"done":"x"}') returning id`, [ids.natali])).length, 1);
  assert.equal((await q('lior', `insert into public.client_tasks (client_id, title, owner, brief, done_at) values ($1, 'x', 'ofir', '{"route":"irit"}', now()) returning id`, [ids.natali])).length, 1);
  await db.query('delete from public.client_tasks where id = $1', [check.id]);
});

test('a task someone else opens with the same from_task neither stops Irit\'s "send" nor is taken back with it', async () => {
  const { rows: [check] } = await db.query(`insert into public.client_tasks (client_id, title, owner, brief)
    values ($1, 'לבדוק לפני שליחה ללקוח: באנר', 'ofir', '{"route":"irit"}') returning id`, [ids.natali]);
  // Nirel may open a task on her client (rolled back here; the same row is written below to stay).
  const decoy = await q('nirel', `insert into public.client_tasks (client_id, title, owner, brief)
    values ($1, 'משהו', 'nirel', jsonb_build_object('from_task', $2::text)) returning id`, [ids.natali, check.id]);
  assert.equal(decoy.length, 1);
  await db.query(`insert into public.client_tasks (client_id, title, owner, brief) values ($1, 'משהו', 'nirel', jsonb_build_object('from_task', $2::text))`, [ids.natali, check.id]);
  const out = await run('ofir', async (tx) => {
    const list = async () => (await tx.query("select owner from public.client_tasks where brief->>'from_task' = $1 order by owner", [check.id])).rows.map((r) => r.owner);
    await tx.query('update public.client_tasks set done_at = now() where id = $1', [check.id]);
    const closed = await list();
    await tx.query('update public.client_tasks set done_at = null where id = $1', [check.id]);
    return { closed, undone: await list() };
  });
  assert.deepEqual(out, { closed: ['irit', 'nirel'], undone: ['nirel'] });
  await db.query("delete from public.client_tasks where id = $1 or brief->>'from_task' = $1::text", [check.id]);
});

test('the migration can run again', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../../supabase/migrations/20260930140000_production.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  const { rows } = await db.query("select count(*)::int as n from pg_trigger where tgname in ('client_tasks_route', 'client_tasks_route_guard')");
  assert.equal(rows[0].n, 2);
});
