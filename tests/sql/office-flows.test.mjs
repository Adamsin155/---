// The office's flows in a real Postgres (PGlite, every migration applied):
// supabase/migrations/20260930150000_office_flows.sql. Who reads and writes the
// pass over the clients, Lior's decisions on exceptions and the change requests;
// that who and when come from the session; that nothing is deleted from the
// browser; the weekly campaign check; and a return's list of issues fits its check.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as } from './pg.mjs';

let db;
const users = {};
const ids = {};
const tasks = {};
const PEOPLE = {
  owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nirel: 'nirel', nadia: 'nadia', anna: 'anna', eli: 'eli',
};
const RLS = /row-level security|violates|permission denied/i;

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, true)', [email, person]);
  }
  for (const [name, editor] of [['edited', 'nadia'], ['other', null]]) {
    const { rows } = await db.query("insert into public.clients (name, shoot_type, editor) values ($1, 'dms', $2) returning id", [name, editor]);
    ids[name] = rows[0].id;
  }
  // An exception Nadia reported to Lior on her client, and one on another client.
  for (const [name, client] of [['exc', 'edited'], ['excOther', 'other'], ['next', 'edited'], ['nextOther', 'other']]) {
    const { rows } = await db.query(
      "insert into public.client_tasks (client_id, title, owner, source) values ($1, $2, 'lior', $3) returning id",
      [ids[client], name, name.startsWith('exc') ? 'escalation' : null],
    );
    tasks[name] = rows[0].id;
  }
});

const run = (who, sql, params = []) => as(db, users[who], async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows ?? r.rows.length };
});

test('the pass over the clients: the office only; who and when from the session; completed once', async () => {
  for (const who of ['ofir', 'lior', 'irit', 'ilai', 'owner']) {
    const r = await run(who, "insert into public.office_passes (day, seen, by_email, at) values ('2026-10-20', '{\"x\": {\"how\": \"seen\"}}', 'someone@else', '2000-01-01') returning by_email, at > now() - interval '1 minute' as fresh");
    assert.equal(r.rows?.[0]?.by_email, `${who}@astrateg.test`, who);
    assert.equal(r.rows[0].fresh, true, who);
  }
  for (const who of ['nadia', 'nirel', 'anna', 'eli']) {
    assert.match((await run(who, "insert into public.office_passes (day) values ('2026-10-20')")).error, RLS, who);
  }
  await db.query("insert into public.office_passes (day, seen) values ('2026-10-19', '{}')");
  for (const who of ['nadia', 'eli']) assert.deepEqual((await run(who, 'select * from public.office_passes')).rows, [], who);
  assert.equal((await run('ofir', 'select * from public.office_passes')).rows.length, 1);
  // Completing stamps the time; a later update neither moves nor clears it; nothing is deleted.
  const r = await as(db, users.ofir, async (tx) => {
    await tx.query("update public.office_passes set completed_at = '2000-01-01', snapshot = '{}' where day = '2026-10-19'");
    const a = (await tx.query("select completed_at, updated_by from public.office_passes where day = '2026-10-19'")).rows[0];
    await tx.query("update public.office_passes set completed_at = null where day = '2026-10-19'");
    const b = (await tx.query("select completed_at from public.office_passes where day = '2026-10-19'")).rows[0];
    return { a, b };
  });
  assert.ok(new Date(r.a.completed_at) > new Date('2020-01-01'));
  assert.equal(r.a.updated_by, 'ofir@astrateg.test');
  assert.deepEqual(r.b.completed_at, r.a.completed_at);
  assert.match((await run('ofir', "delete from public.office_passes where day = '2026-10-19'")).error, RLS);
});

test('decisions on exceptions: the office writes; read with the client; the client must match', async () => {
  const insert = "insert into public.task_decisions (task_id, client_id, reason, decision, next_task_id, by_email) values ($1, $2, 'סיבה', 'החלטה', $3, 'x@y') returning by_email";
  const r = await run('lior', insert, [tasks.exc, ids.edited, tasks.next]);
  assert.equal(r.rows?.[0]?.by_email, 'lior@astrateg.test');
  assert.equal((await run('ofir', insert, [tasks.exc, ids.edited, tasks.next])).rows.length, 1);
  for (const who of ['nadia', 'nirel', 'eli']) assert.match((await run(who, insert, [tasks.exc, ids.edited, tasks.next])).error, RLS, who);
  // A decision on another client's exception, or a next action on another client: refused.
  assert.match((await run('lior', insert, [tasks.exc, ids.other, null])).error, /different clients/);
  assert.match((await run('lior', insert, [tasks.exc, ids.edited, tasks.nextOther])).error, /another client/);
  // Nadia (who edits the client) reads what Lior decided there; not on a client she does not see.
  await db.query("insert into public.task_decisions (task_id, client_id, decision) values ($1, $2, 'ok'), ($3, $4, 'ok')", [tasks.exc, ids.edited, tasks.excOther, ids.other]);
  assert.deepEqual((await run('nadia', 'select task_id from public.task_decisions')).rows.map((x) => x.task_id), [tasks.exc]);
  assert.equal((await run('anna', 'select task_id from public.task_decisions')).rows.length, 0);
  assert.equal((await run('irit', 'select task_id from public.task_decisions')).rows.length, 2);
  assert.equal((await run('nadia', "update public.task_decisions set decision = 'x' where task_id = $1 returning 1", [tasks.exc])).rows.length, 0);
  assert.match((await run('lior', 'delete from public.task_decisions where task_id = $1', [tasks.exc])).error, RLS);
});

test('change requests: Ofir writes, Lior decides (stamped); the request stays as written; nobody else', async () => {
  const r = await as(db, users.ofir, async (tx) => {
    const a = (await tx.query("insert into public.change_requests (problem, why, proposal, created_by_email, decision) values ('אין שדה', 'מאט', 'להוסיף', 'x@y', null) returning id, created_by_email")).rows[0];
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users.lior.id, email: users.lior.email, role: 'authenticated' })]);
    await tx.query("update public.change_requests set decision = 'מאשר', problem = 'שונה' where id = $1", [a.id]);
    return { a, b: (await tx.query('select problem, decision, decided_by_email, decided_at is not null as stamped from public.change_requests where id = $1', [a.id])).rows[0] };
  });
  assert.equal(r.a.created_by_email, 'ofir@astrateg.test');
  assert.deepEqual(r.b, { problem: 'אין שדה', decision: 'מאשר', decided_by_email: 'lior@astrateg.test', stamped: true });
  for (const who of ['nadia', 'nirel', 'eli']) {
    assert.match((await run(who, "insert into public.change_requests (problem, why, proposal) values ('a', 'b', 'c')")).error, RLS, who);
  }
  await db.query("insert into public.change_requests (problem, why, proposal) values ('a', 'b', 'c')");
  assert.equal((await run('nadia', 'select 1 from public.change_requests')).rows.length, 0);
  assert.equal((await run('lior', 'select 1 from public.change_requests')).rows.length, 1);
  assert.match((await run('ofir', "insert into public.change_requests (problem, why, proposal) values ('', 'b', 'c')")).error, /check/);
  assert.match((await run('lior', 'delete from public.change_requests')).error, RLS);
});

test('the weekly campaign check is an office review; a return of 30 issues fits its check', async () => {
  assert.equal((await run('lior', "insert into public.office_reviews (day, kind) values ('2026-10-20', 'campaigns')")).affected, 1);
  assert.match((await run('lior', "insert into public.office_reviews (day, kind) values ('2026-10-20', 'other')")).error, /check/);
  assert.match((await run('nadia', "insert into public.office_reviews (day, kind) values ('2026-10-20', 'campaigns')")).error, RLS);
  const note = JSON.stringify({ v: 1, issues: Array.from({ length: 30 }, () => ({ ref: 'סרטון 12', text: 'ש'.repeat(200) })), due: null });
  assert.ok(note.length > 2000 && note.length <= 8000);
  assert.equal((await run('ofir', "insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p25.return.1', 'done', $2)", [ids.edited, note])).affected, 1);
  assert.equal((await run('nadia', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p25.fixed.1.0', 'done')", [ids.edited])).affected, 1);
  assert.match((await run('ofir', "insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p25.return.2', 'done', $2)", [ids.edited, 'x'.repeat(8001)])).error, /check/);
});

test('Ofir\'s meetings for those waiting for his check: times only, until he saved the characterization or two hours', async () => {
  const { rows } = await db.query(
    "insert into public.clients (name, characterizer, char_at) values ('meeting', 'ofir', now() - interval '30 minutes'), ('lior meeting', 'lior', now() - interval '10 minutes') returning id",
  );
  const r = await run('nadia', 'select * from public.ofir_meetings(now())');
  assert.equal(r.rows.length, 1);
  assert.deepEqual(Object.keys(r.rows[0]).sort(), ['ends_at', 'starts_at']);
  assert.equal(new Date(r.rows[0].ends_at) - new Date(r.rows[0].starts_at), 2 * 36e5);
  await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p04.saved', 'done')", [rows[0].id]);
  const saved = await run('nadia', 'select * from public.ofir_meetings(now())');
  assert.ok(new Date(saved.rows[0].ends_at) - new Date(saved.rows[0].starts_at) < 36e5);
  // "האפיון הסתיים" (p04.ended, decision 12) ends the meeting as well, like app/office-marks.js MEETING_DONE_KEYS.
  const [{ id: ended }] = (await db.query("insert into public.clients (name, characterizer, char_at) values ('ended', 'ofir', now() - interval '40 minutes') returning id")).rows;
  const before = (await run('nadia', 'select * from public.ofir_meetings(now()) order by starts_at')).rows[0];
  assert.equal(new Date(before.ends_at) - new Date(before.starts_at), 2 * 36e5);
  await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p04.ended', 'done')", [ended]);
  const tapped = (await run('nadia', 'select * from public.ofir_meetings(now()) order by starts_at')).rows[0];
  assert.ok(new Date(tapped.ends_at) - new Date(tapped.starts_at) < 36e5);
  // Not for anyone outside the staff.
  assert.match((await as(db, null, (tx) => tx.query('select * from public.ofir_meetings(now())'))).error, /permission denied/);
  // Nor the new tables: nothing granted to anon at all (as the intake's tables).
  for (const t of ['office_passes', 'task_decisions', 'change_requests']) {
    assert.match((await as(db, null, (tx) => tx.query(`select 1 from public.${t}`))).error, /permission denied/, t);
  }
});
