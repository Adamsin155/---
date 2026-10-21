// supabase/migrations/20261031100000_access_and_editors.sql in a real Postgres with every
// migration (tests/sql/pg.mjs):
//   A. "שויך": a Facebook or Instagram page linked to Astrateg through Meta Business,
//      kept as status 'ok' with `linked` on (the old status check stays as it was), for
//      these two networks only (the database refuses any other); access_save() takes it
//      as a status, the office's functions answer it as 'linked', and the client's form
//      has it as a fourth choice, with no user name and no password and no task.
//   C. A second editor (clients.editor2, and editor2 in a round; editor_split, how the videos
//      are split between the two): sees the client, may mark
//      the editing steps (the database decides as the app's mayWrite does), and is on the
//      landing link's list; the main editor's rights are unchanged, nobody else gains any.
//   - the file has none of the three words the production tool refuses, and runs twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { payloadProblem, buildPayload, emptyForm } from '../../app/access-logic.js';
import { PROCESSES } from '../../app/protocol.js';
import { mayWrite } from '../../scripts/protocol-writers.mjs';

const FILE = '20261031100000_access_and_editors.sql';
let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', yariv: 'yariv', anna: 'anna' };

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, ['owner', 'lior', 'ofir'].includes(key)]);
  }
  for (const [name, fields] of [['dana', { business: 'קפה דנה', editor: 'nadia' }], ['gil', { business: 'גיל' }]]) {
    const cols = ['name', ...Object.keys(fields)];
    const { rows } = await db.query(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, [name, ...Object.values(fields)]);
    ids[name] = rows[0].id;
  }
});

const run = (who, sql, params = []) => as(db, who === 'anon' ? null : users[who], async (tx) => (await tx.query(sql, params)).rows);
async function keep(who, sql, params = []) {
  const u = who === 'anon' ? null : users[who];
  const claims = u ? { sub: u.id, email: u.email, role: 'authenticated' } : { role: 'anon' };
  let out;
  await db.transaction(async (tx) => {
    await tx.query(`set local role ${u ? 'authenticated' : 'anon'}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    out = (await tx.query(sql, params)).rows;
  });
  return out;
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const save = (who, client, a) => keep(who, 'select public.access_save($1, $2, $3, $4, $5, $6, $7, $8) as id',
  [client, a.id || null, a.network, a.label || null, a.username || null, a.password || null, a.status ?? null, a.note || null]).then((r) => r[0].id);

test('the file: none of the three words the production tool refuses, and it runs twice', async () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  // The old status check is still there, untouched; the new one beside it.
  const checks = (await all("select conname from pg_constraint where conrelid = 'public.client_access'::regclass and contype = 'c' order by 1")).map((r) => r.conname);
  assert.ok(checks.includes('client_access_status_check'));
  assert.ok(checks.includes('client_access_linked_check'));
});

test('A: the staff save "שויך" for Facebook and Instagram, with no user name and no password', async () => {
  const fb = await save('lior', ids.dana, { network: 'facebook', status: 'linked' });
  let row = await one('select status, linked, username, secret_id from public.client_access where id = $1', [fb]);
  assert.deepEqual([row.status, row.linked, row.username, row.secret_id], ['ok', true, null, null]);
  const ig = await save('ofir', ids.dana, { network: 'instagram', status: 'linked', username: 'dana_cafe' });
  assert.equal((await one('select linked from public.client_access where id = $1', [ig])).linked, true);
  // Never for another network: the function says so, and the table refuses it too.
  for (const network of ['tiktok', 'youtube', 'google', 'meta', 'other']) {
    const r = await as(db, users.lior, (tx) => tx.query("select public.access_save($1, null, $2, 'x', null, null, 'linked', null)", [ids.dana, network]));
    assert.match(r.error || '', /facebook or instagram only/, network);
  }
  await assert.rejects(db.query("insert into public.client_access (client_id, network, status, linked) values ($1, 'tiktok', 'ok', true)", [ids.dana]), /client_access_linked_check/);
  await assert.rejects(db.query("insert into public.client_access (client_id, network, status, linked) values ($1, 'facebook', 'broken', true)", [ids.dana]), /client_access_linked_check/);
  // The status column itself still holds only its four values.
  await assert.rejects(db.query("insert into public.client_access (client_id, network, status) values ($1, 'facebook', 'linked')", [ids.dana]), /client_access_status_check/);
  // A row moved to a network that cannot be linked, keeping its status: refused.
  const r = await as(db, users.lior, (tx) => tx.query("select public.access_save($1, $2, 'tiktok', null, null, null, null, null)", [ids.dana, fb]));
  assert.match(r.error || '', /facebook or instagram only/);
  // Saved again with no status (the status is left as it is): still linked.
  await save('lior', ids.dana, { id: fb, network: 'facebook', note: 'נבדק במנהל העסקים' });
  assert.equal((await one('select linked from public.client_access where id = $1', [fb])).linked, true);
  // Another status: no longer linked. And back.
  await save('lior', ids.dana, { id: fb, network: 'facebook', status: 'broken' });
  row = await one('select status, linked, broken_since from public.client_access where id = $1', [fb]);
  assert.deepEqual([row.status, row.linked, !!row.broken_since], ['broken', false, true]);
  await save('lior', ids.dana, { id: fb, network: 'facebook', status: 'linked' });
  row = await one('select status, linked, broken_since from public.client_access where id = $1', [fb]);
  assert.deepEqual([row.status, row.linked, row.broken_since], ['ok', true, null]);
  // Only whoever may use the vault saves, as before.
  const no = await as(db, users.irit, (tx) => tx.query("select public.access_save($1, null, 'facebook', null, null, null, 'linked', null)", [ids.dana]));
  assert.match(no.error || '', /not allowed/);
});

test('A: the office reads "linked" as a status of its own', async () => {
  const want = (rows) => rows.filter((r) => r.client_id === ids.dana).map((r) => `${r.network}:${r.status}`).sort();
  assert.deepEqual(want(await keep('irit', 'select * from public.access_status_overview()')), ['facebook:linked', 'instagram:linked']);
  assert.deepEqual(want(await keep('ilai', 'select * from public.access_status_for_work($1)', [[ids.dana]])), ['facebook:linked', 'instagram:linked']);
  assert.deepEqual(want(await keep('ilai', 'select * from public.access_work_statuses($1)', [[ids.dana]])), ['facebook:linked', 'instagram:linked']);
  // The editors read none of it, as before.
  assert.equal((await keep('nadia', 'select * from public.access_work_statuses(null)')).length, 0);
});

test('A: the client\'s form, a fourth choice for Facebook and Instagram; the same rules on the page and in the database', async () => {
  const f = emptyForm();
  f.main.instagram = { choice: 'linked', username: 'typed', password: 'typed' };
  f.main.facebook = { choice: 'linked', username: '', password: '' };
  f.main.tiktok = { choice: 'none', username: '', password: '' };
  const ok = buildPayload(f);
  assert.deepEqual(ok.entries.slice(0, 2).map((e) => [e.choice, e.username, e.password]), [['linked', null, null], ['linked', null, null]]);
  const e = (i, patch) => ({ ...ok, entries: ok.entries.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const cases = [
    ['linked for Instagram and Facebook', ok, null],
    ['linked for TikTok', e(2, { choice: 'linked' }), 'choice'],
    ['linked for an added platform', { ...ok, entries: [...ok.entries, { network: 'youtube', label: null, choice: 'linked', username: null, password: null }] }, 'choice'],
    ['linked with a user name', e(0, { username: 'x' }), 'username'],
    ['linked with a password', e(0, { password: 'x' }), 'password'],
  ];
  for (const [name, payload, want] of cases) {
    assert.equal(payloadProblem(payload), want, `page: ${name}`);
    assert.equal((await one('select private.access_form_problem($1::jsonb) as p', [JSON.stringify(payload)])).p, want, `database: ${name}`);
  }
  const link = (await keep('irit', 'select public.access_link_create($1) as l', [ids.gil]))[0].l;
  const r = (await keep('anon', 'select public.access_form_submit($1, $2::jsonb) as r', [link.token, JSON.stringify(ok)]))[0].r;
  assert.deepEqual(r, { state: 'done' });
  const rows = await all('select network, status, linked, username, secret_id, note from public.client_access where client_id = $1 order by network', [ids.gil]);
  assert.deepEqual(rows.map((x) => [x.network, x.status, x.linked, x.username, x.secret_id]),
    [['facebook', 'ok', true, null, null], ['instagram', 'ok', true, null, null], ['tiktok', 'missing', false, null, null]]);
  assert.match(rows[0].note, /שויך לאסטרטג דרך מנהל העסקים/);
  // Ilai is asked to open TikTok only; nothing for the linked pages.
  const tasks = await all("select title from public.client_tasks where client_id = $1 and owner = 'ilai'", [ids.gil]);
  assert.equal(tasks.length, 1);
  assert.doesNotMatch(tasks[0].title, /Facebook|Instagram/);
  assert.match(tasks[0].title, /TikTok/);
  // The office reads them as linked.
  const st = (await keep('ilai', 'select * from public.access_work_statuses($1)', [[ids.gil]])).map((x) => `${x.network}:${x.status}:${x.by_client}`).sort();
  assert.deepEqual(st, ['facebook:linked:true', 'instagram:linked:true', 'tiktok:missing:true']);
  const summary = (await one('select summary from public.client_access_links where id = $1', [link.id])).summary;
  assert.deepEqual(summary.map((s) => `${s.network}:${s.choice}`), ['instagram:linked', 'facebook:linked', 'tiktok:none']);
});

test('A: a second form updates the client\'s own linked row, never a second one', async () => {
  const f = emptyForm();
  f.main.instagram = { choice: 'have', username: 'gil_ig', password: 'Secret 1' };
  f.main.facebook = { choice: 'linked', username: '', password: '' };
  f.main.tiktok = { choice: 'none', username: '', password: '' };
  const link = (await keep('irit', 'select public.access_link_create($1) as l', [ids.gil]))[0].l;
  assert.deepEqual((await keep('anon', 'select public.access_form_submit($1, $2::jsonb) as r', [link.token, JSON.stringify(buildPayload(f))]))[0].r, { state: 'done' });
  const rows = await all('select network, status, linked, username from public.client_access where client_id = $1 order by network', [ids.gil]);
  assert.deepEqual(rows.map((x) => [x.network, x.status, x.linked, x.username]),
    [['facebook', 'ok', true, null], ['instagram', 'new', false, 'gil_ig'], ['tiktok', 'missing', false, null]]);
});

// ── C. The second editor ──
test('C: the column takes an editor of the team, or nothing', async () => {
  await assert.rejects(db.query("update public.clients set editor2 = 'lior' where id = $1", [ids.dana]), /clients_editor2_check/);
  await db.query("update public.clients set editor2 = 'yariv', rounds = $2::jsonb where id = $1",
    [ids.dana, JSON.stringify([{ n: 2, shoot_type: 'dms', editor: 'yariv', editor2: 'anna' }])]);
  assert.equal((await one('select editor2 from public.clients where id = $1', [ids.dana])).editor2, 'yariv');
  // The office writes it with a plain update, as it writes `editor`; the editors read it.
  const up = await as(db, users.irit, (tx) => tx.query("update public.clients set editor2 = 'anna' where id = $1 returning editor2", [ids.gil]));
  assert.equal(up.error, undefined);
  assert.equal((await run('yariv', 'select editor2 from public.clients where id = $1', [ids.dana]))[0].editor2, 'yariv');
  await db.query('update public.clients set editor2 = null where id = $1', [ids.gil]);
  // The split of the videos: an object, kept as given; readable by the editors.
  await db.query(`update public.clients set editor_split = '{"nadia": 8, "yariv": 4}' where id = $1`, [ids.dana]);
  assert.deepEqual((await run('yariv', 'select editor_split from public.clients where id = $1', [ids.dana]))[0].editor_split, { nadia: 8, yariv: 4 });
  await assert.rejects(db.query(`update public.clients set editor_split = '[1, 2]' where id = $1`, [ids.dana]), /clients_editor_split_check/);
});

test('C: the second editor sees the client like the main one; another editor does not', async () => {
  const sees = async (who) => (await run(who, 'select id from public.clients where id = $1', [ids.dana])).length === 1;
  assert.equal(await sees('nadia'), true, 'the main editor, as before');
  assert.equal(await sees('yariv'), true, 'the second editor');
  assert.equal(await sees('anna'), true, 'the second editor of round 2');
  assert.equal(await sees('ilai'), true, 'the office');
  // Gil has no editor: none of them.
  for (const who of ['nadia', 'yariv', 'anna']) assert.equal((await run(who, 'select id from public.clients where id = $1', [ids.gil])).length, 0, who);
  // The card's rows follow (protocol checks of a client one sees).
  assert.equal((await run('yariv', 'select private.is_assigned($1) as a', [ids.dana]))[0].a, true);
  assert.equal((await run('anna', 'select private.is_assigned($1) as a', [ids.gil]))[0].a, false);
});

test('C: the database decides who marks as the app does, with two editors, for every key', async () => {
  const client = (await one('select editor, editor2, rounds from public.clients where id = $1', [ids.dana]));
  const keys = PROCESSES.flatMap((p) => p.items.map((i) => i.key));
  const all = [...keys, ...keys.map((k) => `r2.${k}`), 'p22.pause', 'r2.p22.pause', 'p25.fixed.1', 'r2.p25.fixed.1.0'];
  const cases = [];
  for (const who of ['nadia', 'yariv', 'anna', 'ilai']) {
    const got = await run(who, 'select k, private.protocol_write_ok($1, k, null) as ok from unnest($2::text[]) k', [ids.dana, all]);
    for (const r of got) {
      const want = mayWrite({ person: who, client, key: r.k });
      if (r.ok !== want) cases.push(`${who} ${r.k}: db ${r.ok}, app ${want}`);
    }
  }
  assert.deepEqual(cases, []);
  const ok = async (who, key) => (await run(who, 'select private.protocol_write_ok($1, $2, null) as ok', [ids.dana, key]))[0].ok;
  // The editing steps: both editors of that shoot; never another editor.
  assert.equal(await ok('nadia', 'p22.received'), true);
  assert.equal(await ok('yariv', 'p22.received'), true);
  assert.equal(await ok('anna', 'p22.received'), false);
  assert.equal(await ok('anna', 'r2.p22.received'), true);
  assert.equal(await ok('yariv', 'r2.p22.received'), true);
  assert.equal(await ok('nadia', 'r2.p22.received'), false);
  // A mark itself, through the table's policy.
  const r = await as(db, users.yariv, (tx) => tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.received', 'done')", [ids.dana]));
  assert.equal(r.error, undefined);
  const no = await as(db, users.anna, (tx) => tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.received', 'done')", [ids.dana]));
  assert.match(no.error || '', /row-level security|permission denied/);
  // In someone's name (the landing link, WhatsApp): the same rule.
  assert.equal((await one("select private.protocol_write_as('yariv', $1, 'p22.received') as ok", [ids.dana])).ok, true);
  assert.equal((await one("select private.protocol_write_as('anna', $1, 'p22.received') as ok", [ids.dana])).ok, false);
});

test('C: the landing link lists a client in landing for its second editor too', async () => {
  await db.query('update public.clients set landing = true where id = $1', [ids.dana]);
  const of = async (p) => (await all('select private.landing_link_clients($1) as id', [p])).map((x) => x.id);
  assert.ok((await of('yariv')).includes(ids.dana));
  assert.ok((await of('anna')).includes(ids.dana));
  assert.ok(!(await of('anna')).includes(ids.gil));
  await db.query('update public.clients set landing = false where id = $1', [ids.dana]);
});

// ── D. Editing in two business days; the editors read their clients' scripts ──
test('D: protocol version 11 (editing in two business days) is the database\'s current one', async () => {
  assert.equal((await one('select private.protocol_version_current() as v')).v, 11);
  const { rows } = await db.query("insert into public.clients (name) values ('חדש') returning protocol_version");
  assert.equal(rows[0].protocol_version, 11);
});

test('D: the scripts of a shoot, for its editors (main and second) and the office; nobody else; read only', async () => {
  await db.query(`insert into public.client_scripts (client_id, round, n, title, body) values
    ($1, 1, 1, 'פתיח', 'שלום'), ($1, 1, 2, 'מוצר', 'טקסט'), ($1, 1, 3, '', ''), ($1, 2, 1, 'סבב 2', 'טקסט'),
    ($2, 1, 1, 'של גיל', 'טקסט')`, [ids.dana, ids.gil]);
  const got = async (who) => (await run(who, 'select client_id, round, n from public.work_scripts(null) order by client_id, round, n'))
    .map((r) => `${r.client_id === ids.dana ? 'dana' : 'gil'}:${r.round}.${r.n}`).sort();
  // Nadia edits Dana's own shoot (round 1); Yariv is its second editor and round 2's main one; Anna is round 2's second.
  assert.deepEqual(await got('nadia'), ['dana:1.1', 'dana:1.2']);
  assert.deepEqual(await got('yariv'), ['dana:1.1', 'dana:1.2', 'dana:2.1']);
  assert.deepEqual(await got('anna'), ['dana:2.1']);
  // The office: every client in work (the empty script is never sent).
  assert.deepEqual(await got('ofir'), ['dana:1.1', 'dana:1.2', 'dana:2.1', 'gil:1.1']);
  // The counts, for the same people.
  const counts = await run('yariv', 'select round, scripts from public.work_script_counts($1) order by round', [[ids.dana]]);
  assert.deepEqual(counts.map((r) => [r.round, r.scripts]), [[1, 2], [2, 1]]);
  // The table itself stays closed to the editors (no grant): reading and writing.
  assert.deepEqual(await run('nadia', 'select 1 from public.client_scripts'), []);
  await as(db, users.nadia, (tx) => tx.query("update public.client_scripts set body = 'x' where client_id = $1", [ids.dana]));
  assert.equal((await one("select count(*)::int as n from public.client_scripts where body = 'x'")).n, 0);
  // Anon: nothing at all.
  const a = await as(db, null, (tx) => tx.query('select * from public.work_scripts(null)'));
  assert.match(a.error || '', /permission denied/);
});
