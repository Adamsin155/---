// Package 1 of the protocol audit (supabase/migrations/20261015100000_package1_handoffs.sql;
// docs/ops.md, section 37) in a real Postgres with every migration (tests/sql/pg.mjs),
// role by role: the owner, Irit, Lior, Ofir, Ilai, Nirel, an editor on a client that
// is theirs and on one that is not, Eli, a field agent and someone not signed in.
//   - Eli reads the scripts of his own shoot days through public.shoot_scripts, in
//     the window (yesterday to 30 days ahead, in Israel days), per shoot round; never
//     the table, never another client's, never to write;
//   - what the site's new screens stand on was already so in the database, and is
//     pinned here: Ilai reads the characterization and the files of every client;
//     Nirel those of the clients she sees; an editor uploads a finished video only
//     for a client whose editing is theirs, and reads the files of the clients they
//     see; the files and the characterization stay closed to a field agent and to
//     anyone not signed in;
//   - the migration changes no row (Ofir's Drive-folder tasks stay: the videos are in Drive);
//   - the migration holds no statement the deploy tool refuses.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';

const FILE = '20261015100000_package1_handoffs.sql';
let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nirel: 'nirel', nadia: 'nadia', yariv: 'yariv', eli: 'eli', stav: 'stav' };
const ALL = [...Object.keys(PEOPLE), 'anon'];
const day = (n, hour = 11) => `(((now() at time zone 'Asia/Jerusalem')::date + ${n})::timestamp + interval '${hour} hours') at time zone 'Asia/Jerusalem'`;
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  const add = async (name, sql) => {
    const { rows } = await db.query(`insert into public.clients (name, business, ${sql.cols}) values ($1, $2, ${sql.vals}) returning id`, [name, `עסק ${name}`]);
    ids[name] = rows[0].id;
  };
  // Shoot days: in three days (Nadia's client), yesterday, two days ago, in 31 days,
  // none; an extra round tomorrow on a client whose main shoot was long ago; a
  // client that ended, and one in the archive, both with a shoot tomorrow.
  await add('soon', { cols: 'shoot_at, editor, shoot_type', vals: `${day(3)}, 'nadia', 'dms'` });
  await add('yesterday', { cols: 'shoot_at', vals: day(-1) });
  await add('twoago', { cols: 'shoot_at', vals: day(-2) });
  await add('far', { cols: 'shoot_at', vals: day(31) });
  await add('noshoot', { cols: 'shoot_type', vals: "'natali'" });
  await add('round', { cols: 'shoot_at, rounds', vals: `${day(-60)}, jsonb_build_array(jsonb_build_object('n', 2, 'shoot_at', ${day(1)}), jsonb_build_object('n', 3, 'shoot_at', ${day(45)}))` });
  await add('ended', { cols: 'shoot_at, status', vals: `${day(1)}, 'ended'` });
  await add('archived', { cols: 'shoot_at', vals: day(1) });
  // Into the archive, as the owner (archived_at moves only through the function).
  await db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users.owner.id, email: users.owner.email, role: 'authenticated' })]);
    await tx.query('select public.archive_client($1)', [ids.archived]);
  });
  const script = (client, round, n, title, body, status = 'ready', links = []) => db.query(
    'insert into public.client_scripts (client_id, round, n, title, body, links, status) values ($1, $2, $3, $4, $5, $6, $7)',
    [ids[client], round, n, title, body, JSON.stringify(links), status]);
  await script('soon', 1, 1, 'פתיחה', 'דנה מגישה קפה', 'approved', ['https://www.instagram.com/reel/abc']);
  await script('soon', 1, 2, 'מבצע', 'שתיים במחיר אחת', 'draft');
  await script('soon', 1, 3, '', '', 'draft'); // an empty slot is not a script
  for (const c of ['yesterday', 'twoago', 'far', 'noshoot', 'ended', 'archived']) await script(c, 1, 1, `של ${c}`, 'טקסט');
  await script('round', 1, 1, 'מהצילום הראשון', 'ישן');
  await script('round', 2, 1, 'סבב שני', 'חדש');
  await script('round', 3, 1, 'סבב שלישי', 'רחוק');
  await db.query("insert into public.characterizations (client_id, fields) values ($1, $2), ($3, $2)", [ids.soon, JSON.stringify({ services: 'קפה ומאפים', audiences: 'משפחות', phone: '03-1234567' }), ids.noshoot]);
});

const run = (who, fn) => as(db, who === 'anon' ? null : users[who], fn);
const q = (who, sql, params = []) => run(who, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows };
});
const scriptsOf = async (who, client) => (await q(who, 'select public.shoot_scripts($1) as s', [ids[client]])).rows?.[0]?.s ?? null;

test('Eli reads the scripts of a shoot day of his: title, text, order, links, the status; no empty slot', async () => {
  const s = await scriptsOf('eli', 'soon');
  assert.deepEqual(s.client, { name: 'soon', business: 'עסק soon' });
  assert.deepEqual(s.rounds, [1]);
  assert.deepEqual(s.scripts, [
    { round: 1, n: 1, title: 'פתיחה', body: 'דנה מגישה קפה', links: ['https://www.instagram.com/reel/abc'], status: 'approved' },
    { round: 1, n: 2, title: 'מבצע', body: 'שתיים במחיר אחת', links: [], status: 'draft' },
  ]);
  // Nothing internal rides along: no phone, no notes, no who wrote it.
  assert.deepEqual(Object.keys(s).sort(), ['client', 'rounds', 'scripts']);
  assert.doesNotMatch(JSON.stringify(s), /by_email|phone|notes|@astrateg/);
});

test('the window: from yesterday to 30 days ahead, in Israel days; outside it, a closed client or one in the archive: nothing', async () => {
  assert.equal((await scriptsOf('eli', 'yesterday')).scripts.length, 1, 'the day after the shoot, for his closing checks');
  for (const c of ['twoago', 'far', 'noshoot', 'ended', 'archived']) assert.equal(await scriptsOf('eli', c), null, c);
  assert.equal(await scriptsOf('eli', null), null);
  assert.equal((await q('eli', 'select public.shoot_scripts($1) as s', [UUID(9)])).rows[0].s, null);
});

test('an extra shoot round: only the scripts of the round whose day is in the window', async () => {
  const s = await scriptsOf('eli', 'round');
  assert.deepEqual(s.rounds, [2]);
  assert.deepEqual(s.scripts.map((x) => [x.round, x.title]), [[2, 'סבב שני']]);
});

test('only Eli: the function answers nobody else, and anyone not signed in may not call it', async () => {
  for (const who of ['irit', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'stav', 'owner', 'lior']) {
    assert.equal(await scriptsOf(who, 'soon'), null, who);
  }
  assert.match((await q('anon', 'select public.shoot_scripts($1)', [ids.soon])).error, /permission denied/);
});

test('Eli still reads nothing from the scripts table and writes nothing; a grant is not made for him', async () => {
  assert.deepEqual((await q('eli', 'select n from public.client_scripts')).rows, []);
  assert.match((await q('eli', "insert into public.client_scripts (client_id, n, body) values ($1, 9, 'x')", [ids.soon])).error, /row-level security/);
  assert.equal((await q('eli', "update public.client_scripts set body = 'x' where client_id = $1", [ids.soon])).affected, 0);
  assert.equal((await q('eli', 'delete from public.client_scripts where client_id = $1', [ids.soon])).affected, 0);
  assert.equal((await q('eli', 'select public.can_write_scripts($1) as ok', [ids.soon])).rows[0].ok, false);
  assert.deepEqual((await q('eli', 'select person from public.script_grants')).rows, []);
  // Lior and the owner as before; the rest of the office and the editors, nothing.
  assert.equal((await q('lior', 'select n from public.client_scripts where client_id = $1', [ids.soon])).rows.length, 3);
  for (const who of ['irit', 'ofir', 'ilai', 'nirel', 'nadia', 'stav']) assert.deepEqual((await q(who, 'select n from public.client_scripts')).rows, [], who);
});

test('the characterization: Ilai reads every client\'s; Nirel and an editor only of the clients they see; a field agent and anon nothing', async () => {
  const read = async (who) => (await q(who, 'select client_id from public.characterizations order by 1')).rows?.map((r) => r.client_id).sort() ?? null;
  const both = [ids.soon, ids.noshoot].sort();
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) assert.deepEqual(await read(who), both, who);
  assert.deepEqual(await read('nirel'), [ids.noshoot], 'Nirel: the Natali client');
  assert.deepEqual(await read('nadia'), [ids.soon], 'the editor of the client');
  assert.deepEqual(await read('yariv'), [], 'an editor without the client');
  assert.deepEqual(await read('stav'), []);
  assert.match((await q('anon', 'select 1 from public.characterizations')).error, /permission denied/);
  // Outside the office nobody writes it (the view is read-only, and so is the database for them).
  for (const who of ['nirel', 'nadia', 'yariv', 'eli', 'stav']) {
    assert.equal((await q(who, "update public.characterizations set fields = '{}'::jsonb")).affected, 0, who);
    assert.match((await q(who, "insert into public.characterizations (client_id, fields) values ($1, '{}'::jsonb)", [ids.far])).error, /row-level security/, who);
  }
});

test('finished videos: an editor uploads only for a client whose editing is theirs, and reads the files of the clients they see', async () => {
  const path = (client, kind, n) => `${ids[client]}/${kind}/${UUID(n)}-final.mp4`;
  const insert = (who, client, kind, n) => q(who,
    'insert into public.client_files (client_id, kind, storage_path, mime, size_bytes) values ($1, $2, $3, $4, 1000) returning id', [ids[client], kind, path(client, kind, n), kind === 'deliverable_graphic' ? 'image/png' : 'video/mp4']);
  assert.equal((await insert('nadia', 'soon', 'deliverable_video', 1)).rows.length, 1, 'her client');
  assert.match((await insert('nadia', 'far', 'deliverable_video', 2)).error, /row-level security/, 'not her client');
  assert.match((await insert('yariv', 'soon', 'deliverable_video', 3)).error, /row-level security/, 'another editor');
  assert.match((await insert('nadia', 'soon', 'deliverable_graphic', 4)).error, /row-level security/, 'an editor uploads videos only');
  assert.match((await insert('nirel', 'noshoot', 'deliverable_video', 5)).error, /row-level security/, 'Nirel sees the Natali client, and edits it only once assigned');
  // Ilai: graphics on any client; a video is not his to upload.
  assert.equal((await insert('ilai', 'far', 'deliverable_graphic', 6)).rows.length, 1);
  assert.match((await insert('ilai', 'far', 'deliverable_video', 7)).error, /row-level security/);
  for (const who of ['eli', 'stav']) assert.match((await insert(who, 'soon', 'deliverable_video', 8)).error, /row-level security/, who);
  assert.match((await insert('anon', 'soon', 'deliverable_video', 9)).error, /permission denied/);
  // The same in the bucket: the object's folder decides.
  const may = async (who, client, kind) => (await q(who, 'select public.can_upload_client_file($1, $2) as ok', [ids[client], kind])).rows[0].ok;
  assert.deepEqual([await may('nadia', 'soon', 'deliverable_video'), await may('nadia', 'far', 'deliverable_video'), await may('yariv', 'soon', 'deliverable_video'), await may('ofir', 'soon', 'deliverable_video')],
    [true, false, false, true]);

  // Reading: a file of each client, put there by the database's owner.
  await db.query('insert into public.client_files (client_id, kind, storage_path, mime, size_bytes, uploaded_by) values ($1, $2, $3, $4, 1000, $5), ($6, $2, $7, $4, 1000, $5)',
    [ids.soon, 'deliverable_video', path('soon', 'deliverable_video', 21), 'video/mp4', 'nadia@astrateg.test', ids.far, path('far', 'deliverable_video', 22)]);
  const seen = async (who) => (await q(who, 'select client_id from public.client_files order by 1')).rows?.map((r) => r.client_id).sort() ?? null;
  const two = [ids.soon, ids.far].sort();
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) assert.deepEqual(await seen(who), two, who);
  assert.deepEqual(await seen('nadia'), [ids.soon]);
  assert.deepEqual(await seen('yariv'), []);
  assert.deepEqual(await seen('nirel'), []);
  assert.deepEqual(await seen('stav'), []);
  assert.deepEqual(await seen('eli'), [ids.soon], 'Eli sees the clients of his shoot days, as before');
  assert.match((await q('anon', 'select 1 from public.client_files')).error, /permission denied/);
  await db.query('delete from public.client_files where true');
});

test('the migration touches no row: an open Drive-folder task of Ofir stays open, also on a second run', async () => {
  const { rows } = await db.query('insert into public.client_tasks (client_id, title, owner) values ($1, $2, $3) returning id', [ids.soon, 'פתיחת תיקייה מסודרת בדרייב לעריכה (24)', 'ofir']);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  assert.equal((await db.query('select done_at from public.client_tasks where id = $1', [rows[0].id])).rows[0].done_at, null);
  await db.query('delete from public.client_tasks where id = $1', [rows[0].id]);
});

test('the migration holds nothing the deploy tool refuses, and no UPDATE at all', () => {
  const sql = migrationSql(FILE);
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null, 'the production tool refuses these three words, also in a comment or a name');
  // Nothing the security hardening (20261014100000) set is defined again here.
  assert.deepEqual([...sql.matchAll(/create or replace function ([a-z_.]+)/g)].map((m) => m[1]), ['public.shoot_scripts']);
  assert.doesNotMatch(sql, /create policy|alter policy|alter table/i);
  assert.doesNotMatch(sql, /^\s*(update|insert)\s/im);
});

test('who is not signed in still runs exactly the ten public functions', async () => {
  const { rows } = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
  assert.deepEqual(rows.map((r) => r.proname), ['access_form_info', 'access_form_submit', 'answer_survey', 'approve_item', 'get_gantt', 'get_quote', 'get_scripts', 'get_status', 'request_fix', 'sign_quote']);
  assert.ok(ALL.length);
});
