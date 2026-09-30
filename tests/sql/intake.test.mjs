// The intake tables and rules (supabase/migrations/20260930160000_intake.sql) in a
// real Postgres with every migration (tests/sql/pg.mjs): who reads and writes the
// characterization and the focus call's answers, who and when are stamped by the
// session, a client request done opens "לעדכן את הלקוח" for Irit, and the client's
// approval of the scripts is never "not relevant".
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as } from './pg.mjs';

let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', anna: 'anna', nirel: 'nirel', eli: 'eli' };

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, !['nadia', 'anna', 'eli'].includes(key)]);
  }
  for (const [name, editor, type] of [['edited', 'nadia', 'dms'], ['other', null, 'dms'], ['natali', null, 'natali']]) {
    const { rows } = await db.query('insert into public.clients (name, editor, shoot_type) values ($1, $2, $3) returning id', [name, editor, type]);
    ids[name] = rows[0].id;
  }
  for (const name of ['edited', 'other', 'natali']) {
    await db.query("insert into public.characterizations (client_id, fields) values ($1, '{\"phone\": \"03-1234567\"}')", [ids[name]]);
    await db.query("insert into public.content_briefs (client_id, round, fields) values ($1, 1, '{\"messages\": \"חניה\"}')", [ids[name]]);
  }
});

const run = (who, fn) => as(db, users[who], fn);
const q = (who, sql, params = []) => run(who, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows };
});
const names = async (who, table) => {
  const r = await q(who, `select c.name from public.${table} t join public.clients c on c.id = t.client_id order by 1`);
  if (r.error) throw new Error(r.error);
  return r.rows.map((x) => x.name);
};

test('the characterization and the focus call: read by whoever sees the client, like the client itself', async () => {
  for (const table of ['characterizations', 'content_briefs']) {
    for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) assert.deepEqual(await names(who, table), ['edited', 'natali', 'other'], `${who} ${table}`);
    assert.deepEqual(await names('nadia', table), ['edited'], table); // her editing only
    assert.deepEqual(await names('anna', table), [], table);
    assert.deepEqual(await names('nirel', table), ['natali'], table); // every Natali client
    assert.deepEqual(await names('eli', table), [], table);
  }
  // anon reads nothing at all.
  const anon = await as(db, null, async (tx) => (await tx.query('select 1 from public.characterizations')).rows);
  assert.ok(anon.error || anon.length === 0);
});

test('only the office writes them; an editor who sees the client cannot change it', async () => {
  const up = "update public.characterizations set fields = '{\"phone\": \"050-0000000\"}' where client_id = $1";
  assert.equal((await q('ofir', up, [ids.edited])).affected, 1);
  assert.equal((await q('lior', "insert into public.content_briefs (client_id, round, fields) values ($1, 2, '{}')", [ids.other])).affected, 1);
  assert.equal((await q('nadia', up, [ids.edited])).affected, 0);
  assert.match((await q('nadia', "insert into public.content_briefs (client_id, round, fields) values ($1, 3, '{}')", [ids.edited])).error, /row-level security/);
  assert.match((await q('nirel', "insert into public.characterizations (client_id, fields) values ($1, '{}') on conflict (client_id) do update set fields = excluded.fields", [ids.natali])).error, /row-level security/);
  // Nobody deletes them from the browser.
  assert.match((await q('irit', 'delete from public.characterizations where client_id = $1', [ids.other])).error, /permission denied/);
  // Fields must be an object.
  assert.match((await q('ofir', "update public.characterizations set fields = '[]' where client_id = $1", [ids.other])).error, /check constraint/);
});

test('who saved and when come from the session; the first completion is kept', async () => {
  const out = await run('ofir', async (tx) => {
    await tx.query("update public.characterizations set by_email = 'someone@else', at = '2000-01-01', completed_at = '2000-01-01', completed_by = 'x' where client_id = $1", [ids.other]);
    const a = (await tx.query('select by_email, at, completed_at, completed_by from public.characterizations where client_id = $1', [ids.other])).rows[0];
    await tx.query("update public.characterizations set fields = '{\"a\": 1}' where client_id = $1", [ids.other]);
    const b = (await tx.query('select completed_at, completed_by from public.characterizations where client_id = $1', [ids.other])).rows[0];
    await tx.query('update public.characterizations set completed_at = null where client_id = $1', [ids.other]);
    const c = (await tx.query('select completed_at, completed_by from public.characterizations where client_id = $1', [ids.other])).rows[0];
    return { a, b, c };
  });
  assert.equal(out.a.by_email, 'ofir@astrateg.test');
  assert.ok(new Date(out.a.at).getFullYear() > 2000);
  assert.ok(new Date(out.a.completed_at).getFullYear() > 2000); // stamped now, not the browser's value
  assert.equal(out.a.completed_by, 'ofir@astrateg.test');
  assert.equal(out.b.completed_at.getTime(), out.a.completed_at.getTime()); // a later edit keeps the first completion
  assert.equal(out.c.completed_at, null);
  assert.equal(out.c.completed_by, null);
  const brief = await run('lior', async (tx) => (await tx.query("insert into public.content_briefs (client_id, round, fields, by_email) values ($1, 4, '{}', 'fake') returning by_email", [ids.other])).rows[0]);
  assert.equal(brief.by_email, 'lior@astrateg.test');
});

test('a client request done opens "לעדכן את הלקוח" for Irit, once, whoever closes it', async () => {
  const out = await run('irit', async (tx) => {
    const { rows: [t] } = await tx.query("insert into public.client_tasks (client_id, title, owner, source, due_on) values ($1, 'להוסיף מבצע לסטורי', 'nadia', 'request', current_date) returning id", [ids.edited]);
    return t.id;
  });
  assert.equal(typeof out, 'string');
  // Nadia (who sees the client, since the task is hers) finishes it; the trigger opens Irit's task.
  const res = await run('nadia', async (tx) => {
    const { rows: [t] } = await tx.query("insert into public.client_tasks (client_id, title, owner, source) values ($1, 'לתקן לוגו', 'nadia', 'request') returning id", [ids.edited]);
    await tx.query('update public.client_tasks set done_at = now() where id = $1', [t.id]);
    await tx.query('update public.client_tasks set done_at = null where id = $1', [t.id]);
    await tx.query('update public.client_tasks set done_at = now() where id = $1', [t.id]);
    const tells = (await tx.query("select title, owner, source, brief, created_by_email, due_on from public.client_tasks where source = 'tell'")).rows;
    return { id: t.id, tells };
  });
  assert.equal(res.tells.length, 1, JSON.stringify(res.tells)); // reopened and closed again: still one open
  const tell = res.tells[0];
  assert.equal(tell.title, 'לעדכן את הלקוח: לתקן לוגו');
  assert.equal(tell.owner, 'irit');
  assert.deepEqual([tell.brief.of, tell.brief.request, tell.brief.done_by], [res.id, 'לתקן לוגו', 'nadia@astrateg.test']);
  assert.equal(tell.created_by_email, 'nadia@astrateg.test');
  // An ordinary task opens nothing.
  const plain = await run('irit', async (tx) => {
    const { rows: [t] } = await tx.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'רגילה', 'irit') returning id", [ids.other]);
    await tx.query('update public.client_tasks set done_at = now() where id = $1', [t.id]);
    return (await tx.query("select count(*)::int as n from public.client_tasks where source = 'tell'")).rows[0].n;
  });
  assert.equal(plain, 0);
});

test('task sources: the old ones stay, the new ones are allowed, anything else is refused', async () => {
  for (const s of ['p31', 'p33', 'escalation', 'status', 'request', 'tell']) {
    const r = await q('irit', 'insert into public.client_tasks (client_id, title, owner, source) values ($1, $2, $3, $4)', [ids.other, `t-${s}`, 'lior', s]);
    assert.equal(r.affected, 1, `${s}: ${r.error}`);
  }
  assert.match((await q('irit', "insert into public.client_tasks (client_id, title, owner, source) values ($1, 'x', 'lior', 'whatever')", [ids.other])).error, /client_tasks_source_check/);
});

test('the client\'s approval of the scripts is never "not relevant", in any round; other items still can be', async () => {
  for (const key of ['p13.approved', 'r2.p13.approved']) {
    assert.match((await q('lior', "insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'na')", [ids.other, key])).error, /protocol_checks_scripts_approval_real/, key);
    assert.equal((await q('lior', "insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done')", [ids.other, key])).affected, 1, key);
  }
  assert.equal((await q('lior', "insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p13.fixes', 'na', 'אין תיקונים')", [ids.other])).affected, 1);
  // The new marks fit the key format.
  for (const key of ['p04.ended', 'p14.seen', 'r2.p14.seen', 'p13.zoomat', 'r3.p13.zoomat']) {
    assert.equal((await q('ofir', "insert into public.protocol_checks (client_id, item_key, state, note) values ($1, $2, 'done', 'x')", [ids.other, key])).affected, 1, key);
  }
});
