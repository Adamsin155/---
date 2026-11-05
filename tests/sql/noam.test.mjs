// Noam (supabase/migrations/20261123100000_noam.sql and the checks that wait for the owner's
// approval, supabase/pending/noam_checks.sql; the owner's decision of 1.11.2026), on every
// migration in a real Postgres (PGlite):
//   - the migration is the newest, has none of the words the deploy tool refuses, its writers block
//     is the one the app generates, and it runs twice; the pending file takes away nothing but the
//     checks it adds again, wider, and runs twice;
//   - before the pending file Noam cannot be stored (the header says so); after it his row, a task
//     of his, a question to him, a staff task and a reminder are, and a new client is his;
//   - he sees every client and writes the characterization (as Ilai); he writes the items of 4, 6,
//     8 and 8ב and not the office's; he connects Metricool; the vault stays the owner's flag;
//   - Ofir keeps all of it: the same items, the vault, every client;
//   - the client's form: a network to open is a task for the client's characterizer;
//   - Ofir's meetings are only his clients'; nothing that existed changes hands.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { buildPayload, emptyForm } from '../../app/access-logic.js';
import { sqlBlock, latestBlock, mayWrite } from '../../scripts/protocol-writers.mjs';

const FILE = '20261123100000_noam.sql';
const PENDING = new URL('../../supabase/pending/noam_checks.sql', import.meta.url);
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', noam: 'noam' };
let db;
const users = {};
const ids = {};

async function addPeople(d) {
  const out = {};
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await d.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    out[key] = { id: rows[0].id, email };
    // The vault flag as the owner would set it: the owner, Lior, Ofir and Noam.
    await d.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, ['owner', 'lior', 'ofir', 'noam'].includes(key)]);
  }
  return out;
}
const addClient = async (d, name, characterizer) => (await d.query(
  `insert into public.clients (name, business, editor, status${characterizer === undefined ? '' : ', characterizer'}) values ($1, $1, 'nadia', 'active'${characterizer === undefined ? '' : ', $2'}) returning id`,
  characterizer === undefined ? [name] : [name, characterizer])).rows[0].id;
async function keep(d, u, sql, params = []) {
  const claims = u ? { sub: u.id, email: u.email, role: 'authenticated' } : { role: 'anon' };
  let out;
  await d.transaction(async (tx) => {
    await tx.query(`set local role ${u ? 'authenticated' : 'anon'}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    out = (await tx.query(sql, params)).rows;
  });
  return out;
}
const run = (who, sql, params = []) => as(db, users[who], async (tx) => (await tx.query(sql, params)).rows);

before(async () => {
  db = await freshDatabase();
  await db.exec(readFileSync(PENDING, 'utf8'));
  Object.assign(users, await addPeople(db));
  ids.noam = await addClient(db, 'קפה נעמה', 'noam');
  ids.ofir = await addClient(db, 'מאפיית שחר', 'ofir');
  ids.fresh = await addClient(db, 'פיצה חדשה');
});

test('the files: the migration is the newest and refuses nothing, its writers block is the app\'s; the pending file only widens; both run twice', async () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261124100000_p24_folder_editor.sql', '20261125100000_noam_access_link.sql', '20261126100000_lior_four.sql', '20261128100000_managers_all.sql', '20261129100000_influencer_choice.sql', '20261130100000_manual_contracts.sql']);
  const sql = migrationSql(FILE);
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  assert.deepEqual(sql.replace(/--[^\n]*/g, '').match(/create\s+(table|policy|trigger|index|type)/gi), null);
  assert.deepEqual([...sql.matchAll(/create\s+or\s+replace\s+function\s+([a-z_.]+)/gi)].map((m) => m[1]),
    ['public.staff_task_create_brief', 'public.is_office', 'private.task_gives_access', 'public.can_connect_metricool', 'public.can_edit_gantt', 'public.ofir_meetings', 'public.access_form_submit']);
  // Since 3.11.2026 the newest writers block is the folder's (20261124100000_p24_folder_editor.sql).
  assert.deepEqual([latestBlock().file, latestBlock().block === sqlBlock()], ['20261126100000_lior_four.sql', true]); // since 3.11.2026 (Lior's four things); 20261124100000_p24_folder_editor.sql before
  const pending = readFileSync(PENDING, 'utf8');
  const taken = pending.replace(/--[^\n]*/g, '').match(/\b(drop|delete|truncate)\b[^\n]*/gi);
  const added = [...pending.matchAll(/add constraint ([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(taken.map((t) => /constraint if exists ([a-z_]+);/.exec(t)[1]), added);
  assert.equal(added.length, 8);
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(pending);
});

test('before the pending file nothing of Noam is stored; after it, everything, and a new client is his', async () => {
  const old = await freshDatabase();
  await assert.rejects(old.query("insert into public.staff (email, person) values ('noam@x', 'noam')"), /staff_person_check/);
  const c = await addClient(old, 'לקוח ישן');
  assert.equal((await old.query('select characterizer from public.clients where id = $1', [c])).rows[0].characterizer, 'ofir', 'still Ofir by default');
  await old.exec(readFileSync(PENDING, 'utf8'));
  await old.query("insert into public.staff (email, person) values ('noam@x', 'noam')");
  assert.equal((await old.query('select characterizer from public.clients where id = $1', [c])).rows[0].characterizer, 'ofir', 'a client that exists keeps whom it has');
  assert.equal((await old.query('select characterizer from public.clients where id = $1', [await addClient(old, 'לקוח חדש')])).rows[0].characterizer, 'noam');
  await old.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'x', 'noam')", [c]);
  await old.query("insert into public.client_status_notes (client_id, owner, text) values ($1, 'noam', 'x')", [c]).catch((e) => assert.doesNotMatch(e.message, /owner_check/));
  await old.query("insert into public.client_questions (client_id, to_person, text) values ($1, 'noam', 'x')", [c]).catch((e) => assert.doesNotMatch(e.message, /to_person_check/));
  await old.query("insert into public.reminder_log (key, rule, person, level, channel, status, title) values ('k-noam', 'r', 'noam', 'ring', 'push', 'pending', 't')");
  await assert.rejects(old.query("update public.clients set characterizer = 'shirel' where id = $1", [c]), /characterizer_check/);
  await old.close();
});

test('Noam sees every client and writes the characterization, as Ilai; Ofir as before', async () => {
  for (const who of ['noam', 'ofir', 'ilai']) {
    assert.equal((await run(who, 'select public.is_office() as ok'))[0].ok, true, who);
    assert.equal((await run(who, 'select count(*)::int as n from public.clients'))[0].n, 3, who);
  }
  assert.equal((await run('nadia', 'select public.is_office() as ok'))[0].ok, false);
  const saved = await run('noam', "insert into public.characterizations (client_id, fields) values ($1, '{}'::jsonb) on conflict (client_id) do update set fields = excluded.fields returning client_id", [ids.noam]);
  assert.equal(saved.error, undefined, saved.error?.message);
  // The vault is the owner's flag on his row: with it he opens a password, as Ofir.
  for (const who of ['noam', 'ofir']) assert.equal((await run(who, 'select public.can_use_vault() as ok'))[0].ok, true, who);
  assert.equal((await run('ilai', 'select public.can_use_vault() as ok'))[0].ok, false);
});

test('who writes: Noam the items of 4, 5, 6, 8 and 8ב; Ofir all of them too; the database agrees with the app', async () => {
  const insert = (who, key) => as(db, users[who], async (tx) => (await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done') returning item_key", [ids.noam, key])).rows.length).catch(() => 0);
  const keys = ['p04.address', 'p04.saved', 'p04.followup', 'p05.access', 'p05.vault', 'p06.verified', 'p06.metricool', 'p06.recovered', 'p08.done', 'p08b.posted', 'p05.handoff.noam', 'p07.made', 'p07.ofir', 'p22a.assigned'];
  for (const key of keys) {
    for (const who of ['noam', 'ofir', 'ilai']) {
      const app = mayWrite({ person: PEOPLE[who], client: { editor: 'nadia' }, key });
      assert.equal((await insert(who, key)) === 1, app, `${who} ${key}`);
      await db.query('delete from public.protocol_checks where client_id = $1 and item_key = $2', [ids.noam, key]);
    }
    assert.equal(mayWrite({ person: 'ofir', client: {}, key }), true, `ofir ${key}`);
  }
  for (const key of ['p04.saved', 'p06.verified', 'p08.done', 'p08b.posted']) assert.equal(mayWrite({ person: 'noam', client: {}, key }), true, key);
  for (const key of ['p04.followup', 'p05.vault', 'p06.recovered', 'p07.ofir', 'p22a.assigned']) assert.equal(mayWrite({ person: 'noam', client: {}, key }), false, key);
});

test('Metricool: Noam connects a client\'s pages, as Ofir; Irit and the editors do not', async () => {
  for (const [who, ok] of [['noam', true], ['ofir', true], ['ilai', true], ['owner', true], ['irit', false], ['nadia', false]]) {
    assert.equal((await run(who, 'select public.can_connect_metricool() as ok'))[0]?.ok ?? false, ok, who);
  }
  const r = await run('noam', "select public.metricool_connect($1, '202', 'קפה נעמה') as b", [ids.noam]);
  assert.deepEqual(r[0].b, { blogId: '202', brand: 'קפה נעמה' });
});

test('the client\'s form: a network to open is a task for the client\'s characterizer', async () => {
  const submit = async (cid) => {
    const link = (await keep(db, users.irit, 'select public.access_link_create($1) as l', [cid]))[0].l;
    const f = emptyForm();
    f.main.instagram = { choice: 'have', username: 'page_user', password: 'Insta-9!' };
    f.main.facebook = { choice: 'none', username: '', password: '' };
    f.main.tiktok = { choice: 'reset', username: 'page.tt', password: '' };
    assert.deepEqual((await keep(db, null, 'select public.access_form_submit($1, $2::jsonb) as r', [link.token, JSON.stringify(buildPayload(f))]))[0].r, { state: 'done' });
    return (await db.query('select owner, urgent from public.client_tasks where client_id = $1 and title like $2', [cid, 'לפתוח ללקוח %'])).rows;
  };
  assert.deepEqual(await submit(ids.noam), [{ owner: 'noam', urgent: true }]);
  assert.deepEqual(await submit(ids.ofir), [{ owner: 'ofir', urgent: true }]);
  const lior = await addClient(db, 'מספרת ליאור', 'lior');
  assert.deepEqual(await submit(lior), [{ owner: 'ofir', urgent: true }], 'Lior ran the meeting: the pages stay Ofir\'s');
});

test('Ofir\'s meetings are only his clients\'; nothing that existed changed hands', async () => {
  const at = new Date(Date.now() + 36e5).toISOString();
  await db.query('update public.clients set char_at = $1 where id = any($2)', [at, [ids.noam, ids.ofir, ids.fresh]]);
  const meetings = await run('ofir', 'select starts_at from public.ofir_meetings(now() - interval \'1 day\')');
  assert.equal(meetings.length, 1);
  // Migrating an old database moves no client and no task.
  const old = await freshDatabase({ upTo: FILE });
  await addPeople(old).catch(() => null);
  const c = await addClient(old, 'לקוח של אופיר');
  await old.query("insert into public.client_tasks (client_id, title, owner, urgent) values ($1, 'לפתוח ללקוח TikTok ולהכניס את הגישה לכספת', 'ofir', true)", [c]);
  await old.exec(migrationSql(FILE));
  await old.exec(readFileSync(PENDING, 'utf8'));
  assert.equal((await old.query('select characterizer from public.clients where id = $1', [c])).rows[0].characterizer, 'ofir');
  assert.deepEqual((await old.query('select owner from public.client_tasks where client_id = $1', [c])).rows, [{ owner: 'ofir' }]);
  await old.close();
});
