// Amit (supabase/migrations/20261214100000_amit.sql and 20261214100100_amit_checks.sql, the second
// waiting for the owner's approval of the widened checks; the owner's decision of 15.11.2026; docs/ops.md,
// section 132), on every migration in a real Postgres (PGlite), as the live database stands (Noam's
// checks ran by hand, supabase/pending/noam_checks.sql, then Shiel's):
//   - the first file takes nothing away and only replaces functions (and writes Ofir as the default
//     characterizer); its writers block is the one the app generates; the second only widens the eight
//     checks it adds again; both run twice;
//   - before the checks nothing of hers can be stored; after them her row, her client, a reminder, a
//     client task, a question and a task given to her can; every value allowed before still is; a new
//     client is Ofir's;
//   - she sees every client and writes the characterization (is_office), connects Metricool, makes the
//     client's link to the logins form, and is given a task ("נודניק");
//   - she writes the items of 4, 5, 6 and 8, and the database agrees with the app;
//   - the client's form: a network to open is her task on a client of hers, Ofir's on Shiel's and Ofir's;
//   - Ofir's meetings leave hers out.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { buildPayload, emptyForm } from '../../app/access-logic.js';
import { sqlBlock, latestBlock, mayWrite } from '../../scripts/protocol-writers.mjs';

const FILE = '20261214100000_amit.sql';
const CHECKS = '20261214100100_amit_checks.sql';
const NOAM_CHECKS = new URL('../../supabase/pending/noam_checks.sql', import.meta.url);
const PEOPLE = { owner: null, irit: 'irit', ofir: 'ofir', ilai: 'ilai', amit: 'amit', shiel: 'shiel', nadia: 'nadia' };
let db;
const users = {};
const ids = {};

// The live database before these files: every migration, Noam's checks by hand, then Shiel's again.
async function liveBefore(upTo = FILE) {
  const d = await freshDatabase({ upTo });
  await d.exec(readFileSync(NOAM_CHECKS, 'utf8'));
  await d.exec(migrationSql('20261205100100_shiel_checks.sql'));
  return d;
}
async function addPeople(d) {
  const out = {};
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await d.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    out[key] = { id: rows[0].id, email };
    await d.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, ['owner', 'ofir', 'amit'].includes(key)]);
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
  db = await liveBefore();
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(CHECKS));
  Object.assign(users, await addPeople(db));
  ids.amit = await addClient(db, 'קונדיטוריית עמית', 'amit');
  ids.ofir = await addClient(db, 'מאפיית שחר', 'ofir');
  ids.shiel = await addClient(db, 'מספרת שיאל', 'shiel');
});

test('the files: the first only replaces functions and writes the app\'s writers block; the second only widens eight checks; both run twice', async () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE)), [FILE, CHECKS]);
  const sql = migrationSql(FILE);
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  assert.deepEqual(sql.replace(/--[^\n]*/g, '').match(/create\s+(table|policy|trigger|index|type)/gi), null);
  assert.deepEqual([...sql.matchAll(/create\s+or\s+replace\s+function\s+([a-z_.]+)/gi)].map((m) => m[1]),
    ['public.staff_task_create_brief', 'public.is_office', 'private.task_gives_access', 'public.can_connect_metricool', 'public.can_edit_gantt', 'public.can_manage_access_links', 'public.access_form_submit']);
  assert.deepEqual(sql.replace(/--[^\n]*/g, '').match(/alter table[^;]*;/gi), ["alter table public.clients alter column characterizer set default 'ofir';"]);
  assert.deepEqual([latestBlock().file, latestBlock().block === sqlBlock()], [FILE, true]);
  const checks = readFileSync(new URL(`../../supabase/migrations/${CHECKS}`, import.meta.url), 'utf8');
  assert.match(checks, /^-- WAITS FOR THE OWNER'S APPROVAL/);
  const taken = checks.replace(/--[^\n]*/g, '').match(/\b(drop|delete|truncate)\b[^\n]*/gi);
  const added = [...checks.matchAll(/add constraint ([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(taken.map((t) => /constraint if exists ([a-z_]+);/.exec(t)[1]), added);
  assert.deepEqual(added, ['staff_person_check', 'reminder_log_person_check', 'client_tasks_owner_check', 'client_status_notes_owner_check',
    'client_questions_to_person_check', 'staff_tasks_created_by_check', 'staff_tasks_assignee_check', 'clients_characterizer_check']);
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(migrationSql(CHECKS));
  await db.exec(migrationSql(CHECKS));
});

test('before the checks nothing of Amit is stored; after them everything of hers is, every value before still is, and a new client is Ofir\'s', async () => {
  const old = await liveBefore(CHECKS);
  await old.exec(migrationSql(FILE));
  await assert.rejects(old.query("insert into public.staff (email, person) values ('amit@x', 'amit')"), /staff_person_check/);
  await assert.rejects(addClient(old, 'לקוח', 'amit'), /characterizer_check/);
  const c = await addClient(old, 'לקוח קיים', 'ofir');
  await assert.rejects(old.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'x', 'amit')", [c]), /owner_check/);
  await old.exec(migrationSql(CHECKS));
  await old.query("insert into public.staff (email, person) values ('amit@x', 'amit')");
  await addClient(old, 'לקוח של עמית', 'amit');
  await old.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'x', 'amit')", [c]);
  await old.query("insert into public.client_status_notes (client_id, owner, text) values ($1, 'amit', 'x')", [c]).catch((e) => assert.doesNotMatch(e.message, /owner_check/));
  await old.query("insert into public.client_questions (client_id, to_person, text) values ($1, 'amit', 'x')", [c]).catch((e) => assert.doesNotMatch(e.message, /to_person_check/));
  await old.query("insert into public.reminder_log (key, rule, person, level, channel, status, title) values ('k-amit', 'r', 'amit', 'ring', 'push', 'pending', 't')");
  await old.query("insert into public.staff_tasks (created_by, created_by_email, assignee, body) values ('irit', 'irit@x', 'amit', 'x')");
  await old.query("insert into public.staff_tasks (created_by, created_by_email, assignee, body) values ('amit', 'amit@x', 'ofir', 'x')");
  // Every value allowed before still is (Noam's history, Shiel).
  for (const p of ['irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos', 'shiel']) await old.query('insert into public.staff (email, person) values ($1, $2)', [`${p}2@x`, p]);
  for (const ch of ['noam', 'ofir', 'lior', 'shiel']) await addClient(old, `לקוח ${ch}`, ch);
  await old.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'x', 'noam')", [c]);
  // Shiel still gets nothing (he is silent): no task, no reminder.
  await assert.rejects(old.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'x', 'shiel')", [c]), /check/);
  await assert.rejects(old.query("insert into public.reminder_log (key, rule, person, level, channel, status, title) values ('k-shiel', 'r', 'shiel', 'ring', 'push', 'pending', 't')"), /check/);
  await assert.rejects(old.query("update public.clients set characterizer = 'nadia' where id = $1", [c]), /characterizer_check/);
  // A new client: Ofir's (live it was 'noam' since Noam's checks).
  assert.equal((await old.query("insert into public.clients (name, business, status) values ('חדש', 'חדש', 'active') returning characterizer")).rows[0].characterizer, 'ofir');
  // A client that existed keeps whom it has.
  assert.equal((await old.query('select characterizer from public.clients where id = $1', [c])).rows[0].characterizer, 'ofir');
  await old.close();
});

test('Amit sees every client, writes the characterization, and opens the vault with the owner\'s flag', async () => {
  for (const who of ['amit', 'shiel', 'ofir', 'ilai']) {
    assert.equal((await run(who, 'select public.is_office() as ok'))[0].ok, true, who);
    assert.equal((await run(who, 'select count(*)::int as n from public.clients'))[0].n, 3, who);
  }
  assert.equal((await run('nadia', 'select public.is_office() as ok'))[0].ok, false);
  const saved = await run('amit', "insert into public.characterizations (client_id, fields) values ($1, '{}'::jsonb) on conflict (client_id) do update set fields = excluded.fields returning client_id", [ids.amit]);
  assert.equal(saved.error, undefined, saved.error);
  assert.equal(saved.length, 1);
  assert.equal((await run('amit', 'select public.can_use_vault() as ok'))[0].ok, true);
  assert.equal((await run('ilai', 'select public.can_use_vault() as ok'))[0].ok, false);
});

test('Metricool: Amit connects a client\'s pages (the Gantt only through the connection); Shiel and the editors do not', async () => {
  for (const [who, ok] of [['amit', true], ['ofir', true], ['ilai', true], ['owner', true], ['irit', true], ['shiel', false], ['nadia', false]]) {
    assert.equal((await run(who, 'select public.can_connect_metricool() as ok'))[0]?.ok ?? false, ok, who);
  }
  assert.equal((await run('amit', 'select public.can_edit_gantt() as ok'))[0].ok, false, 'not the Gantt itself');
  const r = await run('amit', "select public.metricool_connect($1, '303', 'קונדיטוריית עמית') as b", [ids.amit]);
  assert.equal(r.error, undefined, r.error);
  assert.deepEqual(r[0].b, { blogId: '303', brand: 'קונדיטוריית עמית' });
});

test('the client\'s link to the logins form: Amit makes one, as Noam did; Shiel does not', async () => {
  assert.equal((await run('amit', 'select public.can_manage_access_links() as ok'))[0].ok, true);
  assert.equal((await run('shiel', 'select public.can_manage_access_links() as ok'))[0].ok, false);
  const made = await run('amit', 'select public.access_link_create($1) as l', [ids.amit]);
  assert.equal(made.error, undefined, made.error);
  assert.match(made[0].l.token, /^[A-Za-z0-9_-]{43}$/);
  const refused = await run('shiel', 'select public.access_link_create($1) as l', [ids.shiel]);
  assert.ok(refused.error, 'Shiel is refused');
});

test('a task given to her ("נודניק"): Irit gives one; one that names nobody known is refused', async () => {
  const r = await run('irit', "select public.staff_task_create_brief('amit', 'לבדוק את העמוד', $1) as id", [ids.amit]);
  assert.equal(r.error, undefined, r.error);
  assert.ok(r[0].id);
  const no = await run('irit', "select public.staff_task_create_brief('shiel', 'x') as id");
  assert.match(no.error, /unknown assignee/);
});

test('who writes: Amit the items of 4, 5, 6 and 8, not the office\'s; the database agrees with the app', async () => {
  const insert = (who, key) => as(db, users[who], async (tx) => (await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done') returning item_key", [ids.amit, key])).rows.length).catch(() => 0);
  const keys = ['p04.address', 'p04.saved', 'p05.got', 'p05.access', 'p05.logo', 'p06.ok', 'p08.ok', 'p05.handoff.amit', 'p04.followup', 'p05.vault', 'p07.made', 'p07.ofir', 'p22a.assigned'];
  for (const key of keys) {
    for (const who of ['amit', 'ofir', 'shiel']) {
      const app = mayWrite({ person: PEOPLE[who], client: { editor: 'nadia', characterizer: 'amit' }, key });
      const got = await insert(who, key);
      assert.equal(got === 1, app, `${who} ${key}`);
      await db.query('delete from public.protocol_checks where client_id = $1 and item_key = $2', [ids.amit, key]);
    }
  }
  for (const key of ['p04.saved', 'p05.got', 'p06.ok', 'p08.ok']) assert.equal(mayWrite({ person: 'amit', client: {}, key }), true, key);
  for (const key of ['p04.followup', 'p05.vault', 'p07.ofir', 'p22a.assigned']) assert.equal(mayWrite({ person: 'amit', client: {}, key }), false, key);
});

test('the client\'s form: a network to open is Amit\'s task on a client of hers; Ofir\'s on Shiel\'s and Ofir\'s', async () => {
  const submit = async (cid) => {
    const link = (await keep(db, users.irit, 'select public.access_link_create($1) as l', [cid]))[0].l;
    const f = emptyForm();
    f.main.instagram = { choice: 'have', username: 'page_user', password: 'Insta-9!' };
    f.main.facebook = { choice: 'none', username: '', password: '' };
    f.main.tiktok = { choice: 'reset', username: 'page.tt', password: '' };
    assert.deepEqual((await keep(db, null, 'select public.access_form_submit($1, $2::jsonb) as r', [link.token, JSON.stringify(buildPayload(f))]))[0].r, { state: 'done' });
    return (await db.query('select owner, urgent from public.client_tasks where client_id = $1 and title like $2', [cid, 'לפתוח ללקוח %'])).rows;
  };
  assert.deepEqual(await submit(ids.amit), [{ owner: 'amit', urgent: true }]);
  assert.deepEqual(await submit(ids.shiel), [{ owner: 'ofir', urgent: true }]);
  assert.deepEqual(await submit(ids.ofir), [{ owner: 'ofir', urgent: true }]);
});

test('Ofir\'s meetings leave hers out', async () => {
  const at = new Date(Date.now() + 36e5).toISOString();
  await db.query('update public.clients set char_at = $1 where id = any($2)', [at, [ids.amit, ids.ofir, ids.shiel]]);
  const meetings = await run('ofir', 'select starts_at from public.ofir_meetings(now() - interval \'1 day\')');
  assert.equal(meetings.length, 1);
});
