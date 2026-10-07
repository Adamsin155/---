// Taking in and activating the clients from the old system
// (20261018100000_clients_landing.sql + 20261020100000_landing_intake.sql; docs/ops.md,
// section 41) in a real Postgres (PGlite, every migration applied), per role: the
// owner, Irit, Lior, Ofir, Ilai, Nirel, an editor, the photographer, a sales agent, anon.
//   - a browser cannot change landing, landed_at, landed_by or landing_slot by itself;
//   - a person records answers only on a client they see, that is in landing, and only
//     on items they may mark; who and when are stamped by the database; an answer is
//     changed back with another call and touches no protocol mark;
//   - the client is activated when nobody is left to go over it, or by an owner; then
//     the answers become imported history and the four columns are stamped;
//   - only the owners activate and close a person's part;
//   - the file has none of the three words the production tool refuses, and runs twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { IMPORT_NOTE } from '../../app/protocol-logic.js';

const FILE = '20261020100000_landing_intake.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nirel: 'nirel', nadia: 'nadia', anna: 'anna', eli: 'eli', stav: 'stav' };
const DENIED = /row-level security|permission denied|not allowed/i;
let db;
const users = {};
const ids = {};

const run = (who, sql, params = []) => as(db, who ? users[who] : null, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows ?? r.rows.length };
});
async function keep(who, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users[who].id, email: users[who].email, role: 'authenticated' })]);
    return (await tx.query(sql, params)).rows;
  });
}
const flags = async (id) => (await db.query('select landing, landed_at is not null as stamped, landed_by, landing_slot from public.clients where id = $1', [id])).rows[0];
const QUIET = { landing: true, stamped: false, landed_by: null, landing_slot: null };
const take = (who, id, marks = {}, done = null, waiting = null) => run(who, 'select public.landing_take($1, $2::jsonb, $3, $4) as r', [id, JSON.stringify(marks), done, waiting]);
const takeKeep = (who, id, marks = {}, done = null, waiting = null) => keep(who, 'select public.landing_take($1, $2::jsonb, $3, $4) as r', [id, JSON.stringify(marks), done, waiting]);

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  const add = async (name, editor, landing, shoot = '2026-06-20 06:00+00', type = 'dms') => (await db.query(
    "insert into public.clients (name, business, shoot_type, editor, status, deal_at, shoot_at, contract_end, landing, created_by_email) values ($1, $1, $5, $2, 'active', '2026-05-10 07:00+00', $4, '2027-05-10', $3, 'system') returning id",
    [name, editor, landing, shoot, type])).rows[0].id;
  ids.a = await add('קפה דנה', 'nadia', true);
  ids.b = await add('מוסך הצפון', 'anna', true);
  ids.c = await add('מספרת רון', 'nadia', true);
  ids.d = await add('פיצה שלום', 'anna', true);
  ids.fresh = await add('לקוח חדש', 'nadia', false);
});

test('the file: none of the three words the production tool refuses, and no function of the hardening again', () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  assert.ok(!/create\s+or\s+replace\s+function\s+private\.(my_clients|protocol_write_ok)|function\s+public\.(is_staff|is_office|my_person|can_see_client)\b/i.test(sql));
});

test('the database owner (the import) puts a client in landing; a new client is never in it', async () => {
  assert.deepEqual(await flags(ids.a), QUIET);
  assert.deepEqual(await flags(ids.fresh), { landing: false, stamped: false, landed_by: null, landing_slot: null });
  // A client opened from the browser, whatever the form sends, is not in landing.
  const made = await run('irit', "insert into public.clients (name, shoot_type, landing, landed_at, landed_by, landing_slot) values ('מהדפדפן', 'dms', true, now(), 'x', 4) returning landing, landed_at, landed_by, landing_slot");
  assert.deepEqual(made.rows, [{ landing: false, landed_at: null, landed_by: null, landing_slot: null }]);
});

test('no browser changes the four columns by itself, whoever asks; the rest of the row is saved', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) {
    const r = await run(who, "update public.clients set landing = false, landed_at = now(), landed_by = 'me', landing_slot = 7, business = 'שם אחר' where id = $1 returning landing, landed_at, landed_by, landing_slot, business", [ids.a]);
    assert.deepEqual(r.rows, [{ landing: true, landed_at: null, landed_by: null, landing_slot: null, business: 'שם אחר' }], who);
    const back = await run(who, 'update public.clients set landing = true where id = $1 returning landing', [ids.fresh]);
    assert.deepEqual(back.rows, [{ landing: false }], who);
  }
  for (const who of ['nadia', 'nirel', 'eli', 'stav']) {
    const r = await run(who, 'update public.clients set landing = false where id = $1 returning landing', [ids.a]);
    assert.ok(r.error ? DENIED.test(r.error) : r.rows.length === 0 || r.rows[0].landing === true, `${who}: ${JSON.stringify(r)}`);
  }
  assert.match((await run(null, 'update public.clients set landing = false where id = $1', [ids.a])).error, /permission denied/);
  assert.deepEqual(await flags(ids.a), QUIET);
});

test('who may record an answer: only on a client they see, and only on an item they may mark', async () => {
  const cases = [
    // who, client, key, allowed
    ['irit', 'a', 'p11.calendar', true], ['lior', 'a', 'p18.scripts', true], ['ofir', 'a', 'p25.approved', true],
    ['ilai', 'a', 'p28.scheduled', true], ['ilai', 'a', 'p18.scripts', false],
    ['nadia', 'a', 'p22.missing', true], ['nadia', 'b', 'p22.missing', false], ['nadia', 'a', 'p28.scheduled', false],
    ['anna', 'a', 'p22.missing', false], ['anna', 'b', 'p22.missing', true],
    ['nirel', 'a', 'p22.missing', false], ['eli', 'a', 'p17b.brollq', false], ['stav', 'a', 'p01.sent', false], ['owner', 'a', 'p01.sent', false],
  ];
  for (const [who, client, key, ok] of cases) {
    const r = await take(who, ids[client], { [key]: 'done' });
    if (ok) assert.deepEqual(r.rows?.[0]?.r, { landing: true }, `${who} ${key}: ${r.error || ''}`);
    else assert.match(r.error || '', DENIED, `${who} ${client} ${key}`);
  }
  assert.match((await run(null, 'select public.landing_take($1)', [ids.a])).error, /permission denied/);
  // The photographer sees a client around its shoot day, and then marks his own items.
  await db.query("update public.clients set shoot_at = now() + interval '3 days' where id = $1", [ids.d]);
  assert.deepEqual((await take('eli', ids.d, { 'p17b.brollq': 'done' })).rows?.[0]?.r, { landing: true });
  assert.match((await take('eli', ids.d, { 'p18.scripts': 'done' })).error, DENIED);
  // Nirel on a client of Natali with no editor yet.
  await db.query("update public.clients set shoot_type = 'natali', editor = null where id = $1", [ids.d]);
  const n = await take('nirel', ids.d, { 'p22.missing': 'done' });
  assert.ok(n.rows ? n.rows[0].r.landing === true : DENIED.test(n.error), JSON.stringify(n));
  await db.query("update public.clients set shoot_type = 'dms', editor = 'anna', shoot_at = '2026-06-20 06:00+00' where id = $1", [ids.d]);
});

test('what is refused: a choice that is not one of three, a mark of the process itself, a client not in landing', async () => {
  assert.match((await take('lior', ids.a, { 'p18.scripts': 'maybe' })).error, /bad choice/);
  for (const key of ['p22.claim', 'p07.wait', 'p22.pause', 'p12.snooze', 'p04.ended', 'p22.handoff.editor', 'p25.fixed.1', 'not-a-key', 'p18']) {
    assert.match((await take('lior', ids.a, { [key]: 'done' })).error, /bad item/, key);
  }
  assert.match((await take('lior', ids.fresh, { 'p18.scripts': 'done' })).error, /not in landing/);
  assert.match((await take('lior', crypto.randomUUID(), {})).error, /not allowed|client not found/);
  assert.match((await run('lior', "select public.landing_take($1, '[1]'::jsonb)", [ids.a])).error, /bad marks/);
});

test('an answer is stamped by the database, read by whoever sees the client, changed back with another tap, and touches no protocol mark', async () => {
  const [first] = await takeKeep('ilai', ids.a, { 'p28.scheduled': 'done', 'p29.filled': 'na' });
  assert.deepEqual(first.r, { landing: true });
  const rows = (await db.query("select item_key, choice, person, by_email, at > now() - interval '1 minute' as fresh from public.client_landing_marks where client_id = $1 order by item_key", [ids.a])).rows;
  assert.deepEqual(rows, [
    { item_key: 'p28.scheduled', choice: 'done', person: 'ilai', by_email: 'ilai@astrateg.test', fresh: true },
    { item_key: 'p29.filled', choice: 'na', person: 'ilai', by_email: 'ilai@astrateg.test', fresh: true },
  ]);
  assert.equal((await db.query('select count(*)::int as n from public.protocol_checks where client_id = $1', [ids.a])).rows[0].n, 0);
  // Readers: the office and the client's editor. Not another editor, sales or anon.
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai', 'nadia']) assert.equal((await run(who, 'select 1 from public.client_landing_marks where client_id = $1', [ids.a])).rows.length, 2, who);
  for (const who of ['anna', 'nirel', 'eli', 'stav']) assert.equal((await run(who, 'select 1 from public.client_landing_marks where client_id = $1', [ids.a])).rows.length, 0, who);
  assert.match((await run(null, 'select 1 from public.client_landing_marks')).error, /permission denied/);
  // Nobody writes the tables with a plain request, the owner included.
  for (const who of ['owner', 'irit', 'ilai', 'nadia']) {
    for (const sql of [
      "insert into public.client_landing_marks (client_id, item_key, choice, person, by_email) values ($1, 'p01.sent', 'done', 'irit', 'x')",
      "update public.client_landing_marks set choice = 'open' where client_id = $1",
      "insert into public.client_landing_done (client_id, person, by_email) values ($1, 'lior', 'x')",
      'update public.client_landing_done set done = true where client_id = $1',
    ]) assert.match((await run(who, sql, [ids.a])).error || '', /permission denied/, `${who}: ${sql}`);
  }
  // A wrong tap: the same call with another answer; "I finished" is taken back the same way.
  await takeKeep('ilai', ids.a, { 'p28.scheduled': 'open' }, true);
  assert.deepEqual((await db.query("select choice from public.client_landing_marks where client_id = $1 and item_key = 'p28.scheduled'", [ids.a])).rows, [{ choice: 'open' }]);
  assert.deepEqual((await db.query('select person, done, by_email from public.client_landing_done where client_id = $1', [ids.a])).rows, [{ person: 'ilai', done: true, by_email: 'ilai@astrateg.test' }]);
  await takeKeep('ilai', ids.a, {}, false);
  assert.deepEqual((await db.query('select done from public.client_landing_done where client_id = $1', [ids.a])).rows, [{ done: false }]);
  assert.deepEqual(await flags(ids.a), QUIET);
});

test('the client is activated when the last person finishes; the answers become imported history', async () => {
  // A real mark made meanwhile, and answers of three people.
  await keep('nadia', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.missing', 'done')", [ids.a]);
  await takeKeep('nadia', ids.a, { 'p22.missing': 'na', 'p27.fixed': 'done' });
  await takeKeep('lior', ids.a, { 'p18.scripts': 'done', 'p19.drive': 'open', 'p13.approved': 'na', 'p12.lior': 'na' });
  await takeKeep('ilai', ids.a, { 'p28.scheduled': 'done' });
  // Nadia finishes while Ilai and Lior have not: still in landing.
  assert.deepEqual((await takeKeep('nadia', ids.a, {}, true, ['ilai', 'lior']))[0].r, { landing: true });
  assert.deepEqual((await takeKeep('ilai', ids.a, {}, true, ['nadia', 'lior']))[0].r, { landing: true });
  assert.deepEqual(await flags(ids.a), QUIET);
  // Finishing without saying who else is left never activates.
  assert.deepEqual((await takeKeep('lior', ids.a, {}, true, null))[0].r, { landing: true });
  await takeKeep('lior', ids.a, {}, false);
  // Lior, the last one.
  assert.deepEqual((await takeKeep('lior', ids.a, {}, true, ['nadia', 'ilai']))[0].r, { landing: false });
  const f = await flags(ids.a);
  assert.deepEqual([f.landing, f.stamped, f.landed_by], [false, true, 'lior@astrateg.test']);
  assert.ok(Number.isInteger(f.landing_slot) && f.landing_slot >= 0 && f.landing_slot < 10);
  const checks = (await db.query('select item_key, state, note from public.protocol_checks where client_id = $1 order by item_key', [ids.a])).rows;
  assert.deepEqual(checks, [
    { item_key: 'p12.lior', state: 'na', note: IMPORT_NOTE },
    { item_key: 'p18.scripts', state: 'done', note: IMPORT_NOTE },
    { item_key: 'p22.missing', state: 'done', note: null },        // the real mark stayed
    { item_key: 'p27.fixed', state: 'done', note: IMPORT_NOTE },
    { item_key: 'p28.scheduled', state: 'done', note: IMPORT_NOTE },
    { item_key: 'p29.filled', state: 'na', note: IMPORT_NOTE },     // Ilai's "לא רלוונטי" from before
  ]); // p19.drive stayed open; "not relevant" is not an answer to the client's approval (p13.approved)
  // Once active, there is nothing more to take in.
  assert.match((await take('lior', ids.a, { 'p19.drive': 'done' })).error, /not in landing/);
  // The reminders load it again: it is no longer filtered out.
  assert.equal((await db.query('select count(*)::int as n from public.clients where landing = false and id = $1', [ids.a])).rows[0].n, 1);
});

test('only the owners activate and close a person\'s part', async () => {
  for (const who of ['irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'eli', 'stav']) {
    assert.match((await run(who, 'select public.landing_activate($1)', [[ids.b]])).error, DENIED, who);
    assert.match((await run(who, "select public.landing_done_for('lior', $1)", [[ids.b]])).error, DENIED, who);
  }
  assert.match((await run(null, 'select public.landing_activate($1)', [[ids.b]])).error, /permission denied/);
  assert.match((await run(null, "select public.landing_done_for('lior', $1)", [[ids.b]])).error, /permission denied/);
  assert.match((await run('owner', "select public.landing_done_for('nobody', $1)", [[ids.b]])).error, /no such person/);
  // The owner closes Lior's part on two clients (one of them is not in landing: skipped).
  assert.equal((await keep('owner', "select public.landing_done_for('lior', $1) as n", [[ids.b, ids.c, ids.fresh]]))[0].n, 2);
  assert.deepEqual((await db.query("select person, done, by_email from public.client_landing_done where client_id = $1", [ids.b])).rows, [{ person: 'lior', done: true, by_email: 'owner@astrateg.test' }]);
  assert.deepEqual(await flags(ids.b), QUIET, 'closing a part does not activate by itself');
  // Anna answered on b; the owner activates b and c together: each gets its own turn.
  await takeKeep('anna', ids.b, { 'p22.missing': 'done' });
  assert.equal((await keep('owner', 'select public.landing_activate($1) as n', [[ids.b, ids.c, ids.fresh, ids.a]]))[0].n, 2);
  const [fb, fc] = [await flags(ids.b), await flags(ids.c)];
  assert.deepEqual([fb.landing, fb.stamped, fb.landed_by], [false, true, 'owner@astrateg.test']);
  assert.notEqual(fb.landing_slot, fc.landing_slot);
  assert.deepEqual((await db.query('select item_key, state, note from public.protocol_checks where client_id = $1', [ids.b])).rows, [{ item_key: 'p22.missing', state: 'done', note: IMPORT_NOTE }]);
  assert.equal((await keep('owner', 'select public.landing_activate($1) as n', [[ids.b, ids.c]]))[0].n, 0, 'activating again does nothing');
  assert.deepEqual(await flags(ids.fresh), { landing: false, stamped: false, landed_by: null, landing_slot: null });
});

test('the turns are given round: ten clients activated together get ten different slots', async () => {
  const made = [];
  for (let i = 0; i < 10; i += 1) {
    made.push((await db.query("insert into public.clients (name, shoot_type, status, landing) values ($1, 'dms', 'active', true) returning id", [`ישן ${i}`])).rows[0].id);
  }
  assert.equal((await keep('owner', 'select public.landing_activate($1) as n', [made]))[0].n, 10);
  const slots = (await db.query('select landing_slot from public.clients where id = any($1)', [made])).rows.map((r) => r.landing_slot).sort((a, b) => a - b);
  assert.deepEqual(slots, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('the migration runs again and leaves everything as it was', async () => {
  const snap = async () => ({
    flags: (await db.query('select id, landing, landed_at, landed_by, landing_slot from public.clients order by id')).rows,
    marks: (await db.query('select * from public.client_landing_marks order by client_id, item_key')).rows,
    done: (await db.query('select * from public.client_landing_done order by client_id, person')).rows,
    policies: (await db.query("select tablename, policyname, qual from pg_policies where tablename like 'client_landing%' order by 1, 2")).rows,
  });
  const beforeRun = await snap();
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql('20261018100000_clients_landing.sql'));
  assert.deepEqual(await snap(), beforeRun);
  assert.equal(beforeRun.policies.length, 2);
});
