// Who may read and change which client, checked in a real Postgres (PGlite) with
// every migration applied (tests/sql/pg.mjs). Each person signs in as Supabase's
// `authenticated` role with their JWT email, exactly as the app does through
// PostgREST, and every write is rolled back afterwards.
// The rule is in supabase/migrations/20260930130000_assignment_rls.sql.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationFiles, migrationSql } from './pg.mjs';

const DAY = 864e5;
const at = (days) => new Date(Date.now() + days * DAY).toISOString();

let db;
const users = {};      // key -> { id, email }
const ids = {};        // client name -> id
const names = {};      // id -> client name
const taskIds = {};    // task title -> id
const accessIds = {};  // client name -> client_access id

// ── Seed (as the database owner, which bypasses row level security) ──
const PEOPLE = {
  owner: { person: null, vault: true },
  irit: { person: 'irit', vault: true },
  lior: { person: 'lior', vault: true },
  ofir: { person: 'ofir', vault: true },
  ilai: { person: 'ilai', vault: true },
  nirel: { person: 'nirel', vault: true },
  nadia: { person: 'nadia', vault: false },
  yariv: { person: 'yariv', vault: false },
  anna: { person: 'anna', vault: false },
  eli: { person: 'eli', vault: false },
};

// Each client and why it is there.
const CLIENTS = {
  ron: { shoot_type: 'dms', editor: 'nadia', shoot_at: at(-60) },                        // Nadia edits it; shot long ago
  roundTwo: { shoot_type: 'dms', editor: 'yariv', rounds: [{ n: 2, shoot_type: 'dms', editor: 'nadia', shoot_at: at(40) }] }, // Nadia edits round 2
  taskOpen: { shoot_type: 'dms' },                                                        // an open task of Nadia's
  taskRecent: { shoot_type: 'dms' },                                                      // Nadia's task finished 10 days ago
  taskOld: { shoot_type: 'dms' },                                                         // Nadia's task finished 45 days ago
  natEdit: { shoot_type: 'natali', editor: 'nirel' },                                     // Nirel edits it
  natOther: { shoot_type: 'natali', editor: null },                                       // a Natali client, not Nirel's
  dmsBrief: { shoot_type: 'dms' },                                                        // a task (brief) for Nirel
  shootSoon: { shoot_type: 'dms', shoot_at: at(3) },                                      // Eli: in 3 days
  shootPast: { shoot_type: 'dms', shoot_at: at(-5) },                                     // Eli: 5 days ago
  shootOld: { shoot_type: 'dms', shoot_at: at(-12) },                                     // Eli: out of the window
  shootFar: { shoot_type: 'dms', shoot_at: at(45) },                                      // Eli: out of the window
  roundSoon: { shoot_type: 'dms', rounds: [{ n: 2, shoot_type: 'dms', shoot_at: at(10) }] }, // Eli: a round in 10 days
  badRound: { shoot_type: 'dms', rounds: [{ n: 2, shoot_at: 'לא תאריך' }, { n: 3 }] },      // rounds without a real date
  plain: { shoot_type: 'dms' },                                                           // the office's only
  // Eli's window at its edges, in Israel days ([days from today in Israel, Israel clock time]).
  // The ones marked * fall on another day in UTC, so a rule on UTC days would get them wrong.
  edgeIn7: { shoot_type: 'dms', shootIL: [-7, '00:30'] },                                 // * UTC: 8 days ago
  edgeOut8: { shoot_type: 'dms', shootIL: [-8, '23:30'] },
  edgeIn30: { shoot_type: 'dms', shootIL: [30, '23:30'] },
  edgeOut31: { shoot_type: 'dms', shootIL: [31, '00:30'] },                               // * UTC: 30 days ahead
  roundEdgeIn: { shoot_type: 'dms', roundIL: [-7, '01:00'] },                             // * a round, as the app writes it (ISO, UTC)
  roundEdgeOut: { shoot_type: 'dms', roundIL: [31, '01:00'] },                            // *
};
const ALL = Object.keys(CLIENTS).sort();

// Tasks: [client, title, owner, days since it was finished (null = open)].
const TASKS = [
  ['taskOpen', 'task-open-nadia', 'nadia', null],
  ['taskRecent', 'task-recent-nadia', 'nadia', 10],
  ['taskOld', 'task-old-nadia', 'nadia', 45],
  ['dmsBrief', 'task-brief-nirel', 'nirel', null],
  ['plain', 'task-plain-lior', 'lior', null],
  ['ron', 'task-ron-lior', 'lior', null],
  ['ron', 'task-ron-old-nadia', 'nadia', 45],
  ['natOther', 'task-natother-lior', 'lior', null],
];

before(async () => {
  db = await freshDatabase();
  for (const [key, p] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, p.person, p.vault]);
  }
  // A login that is not on the staff list, and a staff row whose email was never confirmed.
  for (const [key, confirmed] of [['stranger', true], ['unconfirmed', false]]) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query(`insert into auth.users (email, email_confirmed_at) values ($1, ${confirmed ? 'now()' : 'null'}) returning id`, [email]);
    users[key] = { id: rows[0].id, email };
  }
  await db.query("insert into public.staff (email, person, vault) values ('unconfirmed@astrateg.test', 'nadia', true)");

  // A time given as [days from today in Israel, Israel clock time], computed by the database.
  const IL = "((((now() at time zone 'Asia/Jerusalem')::date + $1::int) + $2::time) at time zone 'Asia/Jerusalem')";
  const israelTime = async ([days, time]) => (await db.query(`select to_char(${IL} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at`, [days, time])).rows[0].at;
  for (const [name, c] of Object.entries(CLIENTS)) {
    const shootAt = c.shootIL ? await israelTime(c.shootIL) : c.shoot_at || null;
    const rounds = c.roundIL ? [{ n: 2, shoot_type: 'dms', shoot_at: await israelTime(c.roundIL) }] : c.rounds || [];
    const { rows } = await db.query(
      'insert into public.clients (name, shoot_type, editor, shoot_at, rounds) values ($1, $2, $3, $4, $5) returning id',
      [name, c.shoot_type || null, c.editor || null, shootAt, JSON.stringify(rounds)],
    );
    ids[name] = rows[0].id;
    names[rows[0].id] = name;
    await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p01.signed', 'done')", [ids[name]]);
  }
  // Finished tasks keep the time they were finished (the stamping trigger would set now()).
  await db.exec('alter table public.client_tasks disable trigger client_tasks_stamp');
  for (const [client, title, owner, doneDaysAgo] of TASKS) {
    const { rows } = await db.query(
      "insert into public.client_tasks (client_id, title, owner, done_at, created_by_email) values ($1, $2, $3, $4, 'ofir@astrateg.test') returning id",
      [ids[client], title, owner, doneDaysAgo === null ? null : at(-doneDaysAgo)],
    );
    taskIds[title] = rows[0].id;
  }
  await db.exec('alter table public.client_tasks enable trigger client_tasks_stamp');
  for (const name of ['ron', 'natEdit', 'natOther', 'dmsBrief', 'plain']) {
    const { rows } = await db.query(
      "insert into public.client_access (client_id, network, username, secret_id) values ($1, 'instagram', $2, vault.create_secret($3)) returning id",
      [ids[name], `user-${name}`, `pw-${name}`],
    );
    accessIds[name] = rows[0].id;
    await db.query("insert into public.client_access_log (access_id, client_id, network, action, by_email) values ($1, $2, 'instagram', 'create', 'irit@astrateg.test')", [rows[0].id, ids[name]]);
  }
  await db.query("insert into public.client_status_notes (client_id, week, current) values ($1, '2026-09-27', 'בעריכה')", [ids.ron]);
  await db.query("insert into public.office_reviews (day, kind) values ('2026-09-29', 'p32')");
});

// ── Helpers ──────────────────────────────────
const sorted = (list) => [...list].sort();
const run = (who, fn) => as(db, who === 'anon' ? null : users[who], fn);
const rows = async (who, sql, params = []) => {
  const out = await run(who, async (tx) => (await tx.query(sql, params)).rows);
  if (out?.error) throw new Error(`${who}: ${out.error}`);
  return out;
};
const clientNames = async (who, table) => {
  const col = table === 'clients' ? 'id' : 'client_id';
  return sorted(new Set((await rows(who, `select ${col} as id from public.${table}`)).map((r) => names[r.id])));
};
// One statement's result: { rows, affected } or { error }.
const tryAs = (who, sql, params = []) => run(who, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows };
});
const RLS = /violates row-level security/;

const SEES = {
  nadia: ['ron', 'roundTwo', 'taskOpen', 'taskRecent'],
  yariv: ['roundTwo'],
  anna: [],
  nirel: ['dmsBrief', 'natEdit', 'natOther'],
  eli: ['edgeIn30', 'edgeIn7', 'roundEdgeIn', 'roundSoon', 'shootPast', 'shootSoon'],
};

// ── Reading ──────────────────────────────────
test('the office (owner, Irit, Lior, Ofir, Ilai) sees every client, check, task and history row', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) {
    assert.deepEqual(await clientNames(who, 'clients'), ALL, who);
    assert.deepEqual(await clientNames(who, 'protocol_checks'), ALL, who);
    assert.deepEqual(await clientNames(who, 'protocol_log'), ALL, who);
    assert.equal((await rows(who, 'select id from public.client_tasks')).length, TASKS.length, who);
    assert.deepEqual(await rows(who, 'select public.is_office() as o'), [{ o: true }], who);
  }
  assert.deepEqual(await rows('owner', 'select public.my_person() as p'), [{ p: null }]);
  assert.deepEqual(await rows('irit', 'select public.my_person() as p'), [{ p: 'irit' }]);
});

test('an editor sees the clients she edits (main shoot or a round) and those with a task of hers, open or finished in the last 30 days', async () => {
  assert.deepEqual(await clientNames('nadia', 'clients'), SEES.nadia);
  assert.deepEqual(await clientNames('yariv', 'clients'), SEES.yariv);
  assert.deepEqual(await clientNames('anna', 'clients'), []); // an editor with nothing assigned
  assert.deepEqual(await rows('nadia', 'select public.is_office() as o, public.my_person() as p'), [{ o: false, p: 'nadia' }]);
});

test('Nirel sees every Natali client and the clients with a task (brief) for her', async () => {
  assert.deepEqual(await clientNames('nirel', 'clients'), SEES.nirel);
});

test('Eli sees the clients with a shoot day from 7 days ago to 30 days ahead in Israel days, the main one or a round', async () => {
  assert.deepEqual(await clientNames('eli', 'clients'), SEES.eli);
});

test('checks, history and tasks follow the clients each person sees', async () => {
  for (const [who, list] of Object.entries(SEES)) {
    assert.deepEqual(await clientNames(who, 'protocol_checks'), list, `${who} checks`);
    assert.deepEqual(await clientNames(who, 'protocol_log'), list, `${who} history`);
    const taskClients = await clientNames(who, 'client_tasks');
    assert.ok(taskClients.every((n) => list.includes(n)), `${who} tasks: ${taskClients}`);
  }
  // Nadia sees the tasks on her clients (her own, and Lior's on a client she edits), not the others.
  assert.deepEqual(sorted((await rows('nadia', 'select title from public.client_tasks')).map((r) => r.title)),
    ['task-open-nadia', 'task-recent-nadia', 'task-ron-lior', 'task-ron-old-nadia']);
  assert.deepEqual(sorted((await rows('nirel', 'select title from public.client_tasks')).map((r) => r.title)), ['task-brief-nirel', 'task-natother-lior']);
});

test('can_see_client() gives the same answer as the policies, client by client', async () => {
  for (const who of ['owner', 'irit', 'ilai', 'nadia', 'yariv', 'anna', 'nirel', 'eli', 'stranger', 'unconfirmed']) {
    const got = await rows(who, 'select c.id, public.can_see_client(c.id) as ok from unnest($1::uuid[]) as c(id)', [Object.values(ids)]);
    const yes = sorted(got.filter((r) => r.ok).map((r) => names[r.id]));
    const expected = ['owner', 'irit', 'ilai'].includes(who) ? ALL : SEES[who] || [];
    assert.deepEqual(yes, expected, who);
  }
});

test('nobody else sees anything: a login not on the staff list, an unconfirmed staff email, anon', async () => {
  for (const who of ['stranger', 'unconfirmed']) {
    for (const t of ['clients', 'protocol_checks', 'protocol_log', 'client_tasks', 'client_access', 'client_status_notes', 'office_reviews']) {
      assert.deepEqual(await rows(who, `select 1 from public.${t}`), [], `${who} ${t}`);
    }
    assert.deepEqual(await rows(who, 'select public.my_person() as p, public.is_office() as o'), [{ p: null, o: false }], who);
  }
  // anon has no privilege on the clients at all (20260930210000_hardening.sql).
  assert.match((await tryAs('anon', 'select 1 from public.clients')).error, /permission denied/);
  assert.match((await tryAs('anon', 'select public.can_see_client($1)', [ids.plain])).error, /permission denied/);
  assert.match((await tryAs('anon', 'select public.is_office()')).error, /permission denied/);
});

test("Ofir's weekly summaries and the daily reviews are the office's only", async () => {
  assert.equal((await rows('ofir', 'select 1 from public.client_status_notes')).length, 1);
  assert.equal((await rows('ilai', 'select 1 from public.office_reviews')).length, 1);
  for (const who of ['nadia', 'nirel', 'eli']) {
    assert.deepEqual(await rows(who, 'select 1 from public.client_status_notes'), [], who); // even on a client Nadia edits
    assert.deepEqual(await rows(who, 'select 1 from public.office_reviews'), [], who);
    assert.match((await tryAs(who, "insert into public.client_status_notes (client_id, week, current) values ($1, '2026-10-04', 'x')", [ids.ron])).error, RLS, who);
    assert.match((await tryAs(who, "insert into public.office_reviews (day, kind) values ('2026-09-30', 'p33')")).error, RLS, who);
  }
  assert.equal((await tryAs('irit', "insert into public.client_status_notes (client_id, week, current) values ($1, '2026-10-04', 'x')", [ids.plain])).affected, 1);
});

// ── Writing ──────────────────────────────────
test('checks: written and cleared only on a client one can see; the stamp is the session', async () => {
  const ok = await tryAs('nadia', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.received', 'done') returning by_email", [ids.ron]);
  assert.deepEqual(ok.rows, [{ by_email: 'nadia@astrateg.test' }]);
  // Upsert, as the app sends it (an item of hers: 20260930210000_hardening.sql limits the rest).
  const up = await tryAs('nadia', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.edited', 'na') on conflict (client_id, item_key) do update set state = excluded.state returning state", [ids.ron]);
  assert.deepEqual(up.rows, [{ state: 'na' }]);
  assert.match((await tryAs('nadia', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.received', 'done')", [ids.plain])).error, RLS);
  assert.match((await tryAs('nadia', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.edited', 'na') on conflict (client_id, item_key) do update set state = excluded.state", [ids.plain])).error, RLS);
  assert.equal((await tryAs('nadia', "update public.protocol_checks set state = 'na' where client_id = $1", [ids.plain])).affected, 0);
  assert.equal((await tryAs('nadia', 'delete from public.protocol_checks where client_id = $1', [ids.plain])).affected, 0);
  // On her own client she clears her own items; Irit's "signed" (p01.signed) is not hers to clear.
  assert.equal((await tryAs('nadia', 'delete from public.protocol_checks where client_id = $1', [ids.ron])).affected, 0);
  assert.equal((await run('nadia', async (tx) => {
    await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.received', 'done')", [ids.ron]);
    return (await tx.query('delete from public.protocol_checks where client_id = $1', [ids.ron])).affectedRows;
  })), 1);
  // Moving a check to a client she cannot see is refused too.
  assert.match((await run('nadia', async (tx) => {
    await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.received', 'done')", [ids.ron]);
    return tx.query("update public.protocol_checks set client_id = $2 where client_id = $1 and item_key = 'p22.received'", [ids.ron, ids.plain]);
  })).error, RLS);
  // Eli checks his shoot-day items on a client with a shoot in the window.
  assert.equal((await tryAs('eli', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p17b.arrived', 'done')", [ids.shootSoon])).affected, 1);
  assert.match((await tryAs('eli', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p17b.arrived', 'done')", [ids.shootOld])).error, RLS);
  // The history row is written by the trigger, with who did it.
  const log = await run('nadia', async (tx) => {
    await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.received', 'done')", [ids.ron]);
    return (await tx.query("select action, by_email from public.protocol_log where client_id = $1 and item_key = 'p22.received'", [ids.ron])).rows;
  });
  assert.deepEqual(log, [{ action: 'done', by_email: 'nadia@astrateg.test' }]);
});

test('tasks: on a visible client, also for someone else (an exception to Lior); never on a client one cannot see', async () => {
  const esc = await tryAs('nadia', "insert into public.client_tasks (client_id, title, owner, source, urgent) values ($1, 'חסר לוגו', 'lior', 'escalation', true) returning owner, created_by_email", [ids.ron]);
  assert.deepEqual(esc.rows, [{ owner: 'lior', created_by_email: 'nadia@astrateg.test' }]);
  assert.match((await tryAs('nadia', "insert into public.client_tasks (client_id, title, owner) values ($1, 'x', 'lior')", [ids.plain])).error, RLS);
  assert.equal((await tryAs('nadia', 'update public.client_tasks set done_at = now() where id = $1', [taskIds['task-plain-lior']])).affected, 0);
  // (refused by the task guard before the policy gets to it)
  assert.match((await tryAs('nadia', 'update public.client_tasks set client_id = $2 where id = $1', [taskIds['task-open-nadia'], ids.plain])).error, /violates row-level security|not allowed/);
  // Finishing her own task: stamped, and the client stays hers for 30 days.
  const done = await run('nadia', async (tx) => {
    const r = await tx.query('update public.client_tasks set done_at = now() where id = $1 returning done_by_email', [taskIds['task-open-nadia']]);
    const still = await tx.query('select public.can_see_client($1) as ok', [ids.taskOpen]);
    return [r.rows[0].done_by_email, still.rows[0].ok];
  });
  assert.deepEqual(done, ['nadia@astrateg.test', true]);
  // The office opens a task for Nadia on any client, and from then on she sees that client.
  const handed = await run('lior', async (tx) => {
    await tx.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'לקצר סרטון', 'nadia')", [ids.plain]);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: users.nadia.id, email: users.nadia.email, role: 'authenticated' })]);
    return (await tx.query('select name from public.clients')).rows.map((r) => r.name).sort();
  });
  assert.deepEqual(handed, sorted([...SEES.nadia, 'plain']));
  assert.equal((await tryAs('nadia', 'delete from public.client_tasks where id = $1', [taskIds['task-open-nadia']])).error?.includes('permission denied'), true); // tasks are never deleted
});

test('client details: added and changed by the office only', async () => {
  assert.equal((await tryAs('nadia', "update public.clients set notes = 'x' where id = $1", [ids.ron])).affected, 0);
  assert.equal((await tryAs('eli', 'update public.clients set shoot_at = now() where id = $1', [ids.shootOld])).affected, 0);
  assert.equal((await tryAs('nirel', "update public.clients set editor = 'nirel' where id = $1", [ids.natOther])).affected, 0);
  assert.match((await tryAs('nadia', "insert into public.clients (name) values ('לקוח חדש')")).error, RLS);
  assert.equal((await tryAs('irit', "update public.clients set editor = 'anna' where id = $1", [ids.ron])).affected, 1);
  assert.equal((await tryAs('ilai', "update public.clients set notes = 'x' where id = $1", [ids.plain])).affected, 1);
  const added = await tryAs('owner', "insert into public.clients (name) values ('לקוח חדש') returning created_by_email");
  assert.deepEqual(added.rows, [{ created_by_email: 'owner@astrateg.test' }]);
  // After Irit moves the editing to Anna, Nadia no longer sees the client or its checks.
  const moved = await run('irit', async (tx) => {
    await tx.query("update public.clients set editor = 'anna' where id = $1", [ids.ron]);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: users.nadia.id, email: users.nadia.email, role: 'authenticated' })]);
    return [(await tx.query('select 1 from public.clients where id = $1', [ids.ron])).rows.length, (await tx.query('select 1 from public.protocol_checks where client_id = $1', [ids.ron])).rows.length];
  });
  // Lior's open task on Ron does not keep it: only a task of hers would.
  assert.deepEqual(moved, [0, 0]);
});

// ── The access vault ─────────────────────────
test('vault rows and their log: the vault flag and an assigned client (the office: every client)', async () => {
  const vault = async (who, table = 'client_access') => clientNames(who, table);
  for (const who of ['owner', 'irit', 'ilai']) assert.deepEqual(await vault(who), ['dmsBrief', 'natEdit', 'natOther', 'plain', 'ron'], who);
  // Nirel sees the Natali client she does not edit, but not its logins.
  assert.deepEqual(await vault('nirel'), ['dmsBrief', 'natEdit']);
  assert.deepEqual(await vault('nirel', 'client_access_log'), ['dmsBrief', 'natEdit']);
  // Editors and Eli have no vault flag: nothing, even on their own clients.
  for (const who of ['nadia', 'eli']) {
    assert.deepEqual(await vault(who), [], who);
    assert.deepEqual(await vault(who, 'client_access_log'), [], who);
  }
  const check = async (who, name) => (await rows(who, 'select public.can_use_client_vault($1) as ok', [ids[name]]))[0].ok;
  assert.equal(await check('nirel', 'natEdit'), true);
  assert.equal(await check('nirel', 'dmsBrief'), true);
  assert.equal(await check('nirel', 'natOther'), false);
  assert.equal(await check('nadia', 'ron'), false);
  assert.equal(await check('irit', 'plain'), true);
});

test('access_reveal / access_save / access_delete: only on a client whose vault one may use; every reveal is logged', async () => {
  const reveal = (who, name) => tryAs(who, 'select public.access_reveal($1) as pw', [accessIds[name]]);
  assert.deepEqual((await reveal('irit', 'plain')).rows, [{ pw: 'pw-plain' }]);
  assert.deepEqual((await reveal('nirel', 'natEdit')).rows, [{ pw: 'pw-natEdit' }]);
  assert.match((await reveal('nirel', 'natOther')).error, /not allowed/);
  assert.match((await reveal('nirel', 'plain')).error, /not allowed/);
  assert.match((await reveal('nadia', 'ron')).error, /not allowed/);
  assert.match((await reveal('stranger', 'ron')).error, /not allowed/);
  const logged = await run('nirel', async (tx) => {
    await tx.query('select public.access_reveal($1)', [accessIds.natEdit]);
    return (await tx.query("select by_email from public.client_access_log where access_id = $1 and action = 'reveal'", [accessIds.natEdit])).rows;
  });
  assert.deepEqual(logged, [{ by_email: 'nirel@astrateg.test' }]);

  const save = (who, name, id = null) => tryAs(who, "select public.access_save($1, $2, 'facebook', null, 'u', 'secret', 'ok', null) as id", [ids[name], id]);
  assert.ok((await save('nirel', 'dmsBrief')).rows[0].id);
  assert.match((await save('nirel', 'natOther')).error, /not allowed/);
  // An access row of a hidden client cannot be edited through a visible one.
  assert.match((await save('nirel', 'natEdit', accessIds.natOther)).error, /access not found/);
  assert.ok((await save('lior', 'natOther')).rows[0].id);

  assert.match((await tryAs('nirel', 'select public.access_delete($1)', [accessIds.natOther])).error, /not allowed/);
  const gone = await run('nirel', async (tx) => {
    await tx.query('select public.access_delete($1)', [accessIds.natEdit]);
    return (await tx.query('select 1 from public.client_access where id = $1', [accessIds.natEdit])).rows.length;
  });
  assert.equal(gone, 0);
  // The table itself is never written from the browser.
  assert.match((await tryAs('irit', "update public.client_access set username = 'x' where id = $1", [accessIds.plain])).error, /permission denied/);
});

test('a task one opens for oneself does not open the vault: Nirel sees every Natali client, not its logins', async () => {
  const vaultAfter = (who, owner) => run(who, async (tx) => {
    await tx.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'גרפיקה', $2)", [ids.natOther, owner]);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users.nirel.id, email: users.nirel.email, role: 'authenticated' })]);
    const ok = (await tx.query('select public.can_use_client_vault($1) as ok', [ids.natOther])).rows[0].ok;
    const rowsSeen = (await tx.query('select 1 from public.client_access where client_id = $1', [ids.natOther])).rows.length;
    let reveal;
    try { reveal = (await tx.query('select public.access_reveal($1) as pw', [accessIds.natOther])).rows[0].pw; } catch (err) { reveal = err.message; }
    return { ok, rowsSeen, reveal };
  });
  // Her own task on it: still no logins.
  assert.deepEqual(await vaultAfter('nirel', 'nirel'), { ok: false, rowsSeen: 0, reveal: 'not allowed' });
  // A brief the office opened for her: the client is assigned to her, and its logins open.
  assert.deepEqual(await vaultAfter('ofir', 'nirel'), { ok: true, rowsSeen: 1, reveal: 'pw-natOther' });
  // Her own task still counts for seeing a client (the rule for tasks), just not for the vault.
  const seen = await run('nirel', async (tx) => {
    await tx.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'x', 'nirel')", [ids.natOther]);
    return (await tx.query('select public.can_see_client($1) as ok', [ids.natOther])).rows[0].ok;
  });
  assert.equal(seen, true);
});

test('a task stays with its person and client: only the office moves it, or reopens one finished long ago', async () => {
  const NOT = /not allowed/;
  // Taking over Lior's task on a Natali client she sees (it would count as a task opened for her by someone else).
  assert.match((await tryAs('nirel', "update public.client_tasks set owner = 'nirel' where id = $1", [taskIds['task-natother-lior']])).error, NOT);
  // Moving her brief to another client she sees.
  assert.match((await tryAs('nirel', 'update public.client_tasks set client_id = $2 where id = $1', [taskIds['task-brief-nirel'], ids.natOther])).error, NOT);
  // Reopening her task finished 45 days ago (on a client she still edits); 10 days ago is fine (a mistaken tap).
  assert.match((await tryAs('nadia', 'update public.client_tasks set done_at = null where id = $1', [taskIds['task-ron-old-nadia']])).error, NOT);
  assert.equal((await tryAs('nadia', 'update public.client_tasks set done_at = null where id = $1', [taskIds['task-recent-nadia']])).affected, 1);
  // Since 20261014100000_security_hardening.sql a visible task of someone else is no
  // longer hers to finish or rewrite (it was: "stay open to her"); her own she finishes,
  // and what it says is the office's (tests/sql/security-hardening.test.mjs has the rest).
  assert.match((await tryAs('nadia', "update public.client_tasks set title = 'y', due_on = '2026-12-01', done_at = now() where id = $1", [taskIds['task-ron-lior']])).error, /someone else's/);
  assert.match((await tryAs('nadia', 'update public.client_tasks set done_at = now() where id = $1', [taskIds['task-ron-lior']])).error, /someone else's/);
  assert.equal((await tryAs('nadia', 'update public.client_tasks set done_at = now() where id = $1', [taskIds['task-open-nadia']])).affected, 1);
  assert.match((await tryAs('nadia', "update public.client_tasks set title = 'y' where id = $1", [taskIds['task-open-nadia']])).error, /only the office changes what a task says/);
  // The office reassigns and moves tasks.
  assert.equal((await tryAs('lior', "update public.client_tasks set owner = 'anna', client_id = $2 where id = $1", [taskIds['task-natother-lior'], ids.plain])).affected, 1);
  assert.equal((await tryAs('ofir', 'update public.client_tasks set done_at = null where id = $1', [taskIds['task-old-nadia']])).affected, 1);
  // The database's own jobs (service role: no email in the token) are not limited.
  const job = await db.transaction(async (tx) => {
    await tx.query('set local role service_role');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'service_role' })]);
    const r = await tx.query("update public.client_tasks set owner = 'irit' where id = $1", [taskIds['task-plain-lior']]);
    await tx.rollback();
    return r.affectedRows;
  });
  assert.equal(job, 1);
});

test('the one-client checks agree with the policies, the vault too', async () => {
  for (const who of ['owner', 'irit', 'nirel', 'nadia', 'eli', 'stranger']) {
    const got = await rows(who, 'select c.id, public.can_use_client_vault(c.id) as ok from unnest($1::uuid[]) as c(id)', [Object.keys(accessIds).map((n) => ids[n])]);
    const byFn = sorted(got.filter((r) => r.ok).map((r) => names[r.id]));
    assert.deepEqual(byFn, await clientNames(who, 'client_access'), who);
  }
});

test('the one-client checks stay cheap when a query calls them for every row', async () => {
  // 1500 more clients and tasks, rolled back. Computing the whole set once per row
  // (the first version) took minutes here; a few index lookups per row take well under a second.
  const out = await run('eli', async (tx) => {
    await tx.query('reset role');
    await tx.query(`insert into public.clients (name, shoot_type, shoot_at, rounds)
      select 'bulk' || g, 'dms', now() + (g % 60 - 20) * interval '1 day',
             jsonb_build_array(jsonb_build_object('n', 2, 'editor', 'anna', 'shoot_at', (now() + (g % 90) * interval '1 day')::text))
      from generate_series(1, 1500) g`);
    await tx.query("insert into public.client_tasks (client_id, title, owner) select id, 't', 'eli' from public.clients where name like 'bulk%' and random() < 0.2");
    await tx.query('set local role authenticated');
    const t0 = performance.now();
    const perRow = (await tx.query('select count(*)::int as n from public.clients where public.can_see_client(id)')).rows[0].n;
    const ms = performance.now() - t0;
    const policy = (await tx.query('select count(*)::int as n from public.clients')).rows[0].n;
    const vault = (await tx.query('select count(*)::int as n from public.clients where public.can_use_client_vault(id)')).rows[0].n;
    return { perRow, policy, ms, vault };
  });
  assert.equal(out.perRow, out.policy);
  assert.equal(out.vault, 0); // no vault flag
  assert.ok(out.ms < 5000, `can_see_client over ${out.policy}+ rows took ${Math.round(out.ms)} ms`);
});

// ── Unchanged ────────────────────────────────
test('signing an agreement still opens its client by itself (anon signs; the office sees it, editors do not)', async () => {
  const model = { signable: true, docType: 'agreement', termMonths: 12, client: { name: 'חתימה חדשה', phone: '050' },
    package: { id: 'social-natali', tierName: 'Social', influencer: 'נטלי דדון' }, selection: { influencer: 'natali', paid: [], free: {} },
    totals: { monthlyNet: 100000, monthlyGross: 118000, termGross: 1416000 } };
  const { rows: [q] } = await db.query("insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot) values ($1, 'חתימה חדשה', 118000, 1416000) returning token", [JSON.stringify(model)]);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  // One transaction, rolled back: the client signs (anon), then each person looks.
  const seen = await run('anon', async (tx) => {
    const status = (await tx.query("select public.sign_quote($1, $2, $3, true) ->> 'status' as s", [q.token, 'דנה לוי', png])).rows[0].s;
    const out = { status };
    for (const who of ['irit', 'nirel', 'nadia']) {
      await tx.query('reset role');
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users[who].id, email: users[who].email, role: 'authenticated' })]);
      const c = (await tx.query("select id, created_by_email from public.clients where name = 'חתימה חדשה'")).rows;
      const checks = c.length ? (await tx.query('select item_key from public.protocol_checks where client_id = $1', [c[0].id])).rows.length : 0;
      out[who] = { clients: c.length, by: c[0]?.created_by_email || null, checks };
    }
    return out;
  });
  assert.deepEqual(seen, {
    status: 'signed',
    irit: { clients: 1, by: 'system', checks: 3 },
    nirel: { clients: 1, by: 'system', checks: 3 }, // a new Natali client
    nadia: { clients: 0, by: null, checks: 0 },
  });
});

test('quotes are the office\'s (20260930210000_hardening.sql: the agreement carries the client\'s phone); payouts are for payout owners', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) assert.ok((await rows(who, 'select 1 from public.quotes')).length >= 1, who);
  for (const who of ['nadia', 'nirel', 'eli']) assert.deepEqual(await rows(who, 'select 1 from public.quotes'), [], who);
  assert.deepEqual(await rows('irit', 'select 1 from public.payout_deals'), []);
});

// ── Guard for future migrations ──────────────
test('every client table has row level security, and no policy on it lets every staff member through', async () => {
  const tables = (await db.query(`
    select c.relname as t, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (c.relname = 'clients' or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'client_id' and not a.attisdropped))
    order by 1`)).rows;
  assert.ok(tables.length >= 8, tables.map((t) => t.t).join());
  for (const t of tables) assert.equal(t.rls, true, `${t.t}: row level security is off`);
  const policies = (await db.query(`
    select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
    from pg_policies where schemaname = 'public' and tablename = any($1) and permissive = 'PERMISSIVE'`, [tables.map((t) => t.t)])).rows;
  // A restrictive policy only takes away (AND): the one that hides an archived client
  // (20261003140000_manager_features.sql). Nothing else may be restrictive here.
  const restrictive = (await db.query("select distinct policyname from pg_policies where schemaname = 'public' and tablename = any($1) and permissive <> 'PERMISSIVE'", [tables.map((t) => t.t)])).rows.map((r) => r.policyname);
  assert.ok(restrictive.every((n) => n === 'archived clients are hidden'), restrictive.join());
  // (month_write_ok: is_office, and Ilai only his own items of the monthly cycle.)
  // (can_edit_gantt: Ilai and the owner, the only ones who change the content Gantt; 20261007100000.)
  const RULES = /is_office|my_clients|my_assigned_clients|can_see_client|can_message_clients|can_use_client_vault|month_write_ok|can_edit_gantt/;
  // Tables with a rule of their own, and why.
  const OWN_RULE = {
    // The owner's questions (20260930120000_owner_screens.sql): the office asks; the person
    // asked reads and answers their own, even about a client they no longer see.
    client_questions: /can_ask_questions|is_my_question/,
    // The reminder log (20260930110000_reminders.sql): each row is a notification
    // addressed to one person; the owner and Lior read the whole log (decision 22).
    reminder_log: /reminder_person\(\)/,
    // The scripts (20261003120000_scripts.sql): Lior and the owner, and the people they
    // granted the client to; not the rest of the office (tests/sql/scripts.test.mjs).
    client_scripts: /can_manage_scripts\(\)/,
    script_grants: /can_manage_scripts\(\)/,
    script_share_links: /can_manage_scripts\(\)/,
    // Who archived or deleted a client (20261003140000_manager_features.sql): the owner and
    // Ofir; the row outlives the client, so no client rule can apply.
    client_admin_log: /can_archive_clients/,
    // The tasks given on the spot (20261011100000_staff_tasks.sql): each row is addressed
    // to one person; only the assignee, whoever gave it and the owner read it. The client
    // is an optional note on the task (tests/sql/staff-tasks.test.mjs).
    staff_tasks: /assignee = reminder_person\(\)/,
  };
  for (const p of policies) {
    assert.match(p.expr, OWN_RULE[p.tablename] || RULES, `${p.tablename} / "${p.policyname}" does not check who the client belongs to: ${p.expr}`);
  }
});

test('before this migration every staff member saw every client (what the migration closes)', async () => {
  const old = await freshDatabase({ upTo: '20260930130000' });
  const { rows: [u] } = await old.query("insert into auth.users (email, email_confirmed_at) values ('nadia@astrateg.test', now()) returning id");
  await old.query("insert into public.staff (email, person, vault) values ('nadia@astrateg.test', 'nadia', false)");
  await old.query("insert into public.clients (name) values ('a'), ('b')");
  const seen = await as(old, { id: u.id, email: 'nadia@astrateg.test' }, async (tx) => (await tx.query('select name from public.clients')).rows.length);
  assert.equal(seen, 2);
  await old.close();
});

test("the owner screens' history of date changes follows the clients one sees (either order of merging)", async () => {
  // Before this migration; then, when the owner screens' migration is not in this
  // tree yet, its table as it creates it (every staff member reads it); then this
  // migration and everything after it.
  const RLS_FILE = migrationFiles().find((f) => f.endsWith('_assignment_rls.sql'));
  const odb = await freshDatabase({ upTo: RLS_FILE });
  const hasOwner = (await odb.query("select to_regclass('public.client_date_changes') is not null as ok")).rows[0].ok;
  if (!hasOwner) {
    await odb.exec(`
      create table public.client_date_changes (
        id bigint generated always as identity primary key,
        client_id uuid not null references public.clients (id) on delete cascade,
        field text not null, old_value text, new_value text, by_email text not null,
        at timestamptz not null default now());
      alter table public.client_date_changes enable row level security;
      create policy "staff read date changes" on public.client_date_changes
        for select to authenticated using ((select public.is_staff()));
      revoke all on public.client_date_changes from anon, authenticated;
      grant select on public.client_date_changes to authenticated;`);
  }
  for (const f of migrationFiles().filter((x) => x >= RLS_FILE)) await odb.exec(migrationSql(f));
  const u = {};
  for (const [key, person] of [['irit', 'irit'], ['nadia', 'nadia']]) {
    const { rows: [r] } = await odb.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [`${key}@astrateg.test`]);
    u[key] = { id: r.id, email: `${key}@astrateg.test` };
    await odb.query('insert into public.staff (email, person) values ($1, $2)', [u[key].email, person]);
  }
  const { rows: [mine] } = await odb.query("insert into public.clients (name, editor) values ('mine', 'nadia') returning id");
  const { rows: [other] } = await odb.query("insert into public.clients (name, editor) values ('other', 'anna') returning id");
  await odb.query("insert into public.client_date_changes (client_id, field, old_value, new_value, by_email) values ($1, 'shoot_at', 'a', 'b', 'irit@astrateg.test'), ($2, 'shoot_at', 'a', 'b', 'irit@astrateg.test')", [mine.id, other.id]);
  // Nadia's own changes: one on her client, one on a client she no longer sees.
  await odb.query("insert into public.client_date_changes (client_id, field, old_value, new_value, by_email) values ($1, 'shoot_at', 'a', 'b', 'nadia@astrateg.test'), ($2, 'shoot_at', 'a', 'b', 'nadia@astrateg.test')", [mine.id, other.id]);
  const seen = async (who) => as(odb, u[who], async (tx) => (await tx.query('select client_id from public.client_date_changes')).rows.map((r) => (r.client_id === mine.id ? 'mine' : 'other')).sort());
  // The office reads every change; anyone else only their own, on clients they still see.
  assert.deepEqual(await seen('irit'), ['mine', 'mine', 'other', 'other']);
  assert.deepEqual(await seen('nadia'), ['mine']);
  // Running this migration again changes nothing (it is safe to repeat after the owner screens' one).
  await odb.exec(migrationSql(RLS_FILE));
  assert.deepEqual(await seen('nadia'), ['mine']);
  await odb.close();
});
