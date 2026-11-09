// Shiel (supabase/migrations/20261205100000_shiel.sql and 20261205100100_shiel_checks.sql, the second
// waiting for the owner's approval of its drop + add; the owner's decision of 9.11.2026; docs/ops.md,
// section 113), on every migration in a real Postgres (PGlite):
//   - the first file takes nothing away and only replaces functions; its writers block is the one the
//     app generates; the second only widens the two checks it adds again; both run twice;
//   - before the checks file he cannot be stored (his row, a client of his); after it he can, and
//     nothing else of his can (a reminder, a client task, a staff task: he gets nothing);
//   - he sees every client and writes the characterization (is_office), as Noam;
//   - he writes the items of 4 and 5 and not 6;
//   - the client's form: a network to open is a task for Noam on a client of Shiel's.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { buildPayload, emptyForm } from '../../app/access-logic.js';
import { sqlBlock, latestBlock, mayWrite } from '../../scripts/protocol-writers.mjs';

const FILE = '20261205100000_shiel.sql';
const CHECKS = '20261205100100_shiel_checks.sql';
// Live, Noam's checks ran by hand (supabase/pending/noam_checks.sql); here before ours.
const NOAM_CHECKS = new URL('../../supabase/pending/noam_checks.sql', import.meta.url);
const PEOPLE = { owner: null, irit: 'irit', ofir: 'ofir', noam: 'noam', shiel: 'shiel', nadia: 'nadia' };
let db;
const users = {};
const ids = {};

async function addPeople(d) {
  const out = {};
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await d.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    out[key] = { id: rows[0].id, email };
    await d.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, ['owner', 'ofir', 'noam', 'shiel'].includes(key)]);
  }
  return out;
}
const addClient = async (d, name, characterizer) => (await d.query(
  "insert into public.clients (name, business, editor, status, characterizer) values ($1, $1, 'nadia', 'active', $2) returning id", [name, characterizer])).rows[0].id;
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
  db = await freshDatabase({ upTo: FILE });
  await db.exec(readFileSync(NOAM_CHECKS, 'utf8'));
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(CHECKS));
  Object.assign(users, await addPeople(db));
  ids.shiel = await addClient(db, 'מספרת שיאל', 'shiel');
  ids.noam = await addClient(db, 'קפה נעמה', 'noam');
});

test('the files: the first only replaces functions and writes the app\'s writers block; the second only widens two checks; both run twice', async () => {
  const sql = migrationSql(FILE);
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  assert.deepEqual(sql.replace(/--[^\n]*/g, '').match(/create\s+(table|policy|trigger|index|type)/gi), null);
  assert.deepEqual([...sql.matchAll(/create\s+or\s+replace\s+function\s+([a-z_.]+)/gi)].map((m) => m[1]),
    ['public.is_office', 'private.task_gives_access', 'public.access_form_submit']);
  // The writers block was written again by 20261208120000_protocol_v13.sql (9.11.2026), the latest since.
  assert.deepEqual([latestBlock().file, latestBlock().block === sqlBlock()], ['20261208120000_protocol_v13.sql', true]);
  const checks = readFileSync(new URL(`../../supabase/migrations/${CHECKS}`, import.meta.url), 'utf8');
  assert.match(checks, /^-- WAITS FOR THE OWNER'S APPROVAL/);
  const taken = checks.replace(/--[^\n]*/g, '').match(/\b(drop|delete|truncate)\b[^\n]*/gi);
  const added = [...checks.matchAll(/add constraint ([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(taken.map((t) => /constraint if exists ([a-z_]+);/.exec(t)[1]), added);
  assert.deepEqual(added, ['staff_person_check', 'clients_characterizer_check']);
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(migrationSql(CHECKS));
  await db.exec(migrationSql(CHECKS));
});

test('before the checks nothing of Shiel is stored; after them his row and his client are, and nothing that would tell him something', async () => {
  const old = await freshDatabase({ upTo: CHECKS });
  await old.exec(readFileSync(NOAM_CHECKS, 'utf8'));
  await assert.rejects(old.query("insert into public.staff (email, person) values ('shiel@x', 'shiel')"), /staff_person_check/);
  await assert.rejects(addClient(old, 'לקוח', 'shiel'), /characterizer_check/);
  const c = await addClient(old, 'לקוח של נעם', 'noam');
  await old.exec(migrationSql(CHECKS));
  await old.query("insert into public.staff (email, person) values ('shiel@x', 'shiel')");
  await addClient(old, 'לקוח של שיאל', 'shiel');
  // Every value allowed before still is.
  for (const p of ['irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos']) await old.query('insert into public.staff (email, person) values ($1, $2)', [`${p}2@x`, p]);
  for (const ch of ['noam', 'ofir', 'lior']) await addClient(old, `לקוח ${ch}`, ch);
  // A new client is still Noam's.
  assert.equal((await old.query("insert into public.clients (name, business, status) values ('חדש', 'חדש', 'active') returning characterizer")).rows[0].characterizer, 'noam');
  // He gets nothing: no reminder, no client task, no staff task.
  await assert.rejects(old.query("insert into public.reminder_log (key, rule, person, level, channel, status, title) values ('k-shiel', 'r', 'shiel', 'ring', 'push', 'pending', 't')"), /check/);
  await assert.rejects(old.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'x', 'shiel')", [c]), /check/);
  await assert.rejects(old.query("insert into public.staff_tasks (created_by, created_by_email, assignee, body) values ('irit', 'irit@x', 'shiel', 'x')"), /check/);
  await old.close();
});

test('Shiel sees every client and writes the characterization, as Noam', async () => {
  for (const who of ['shiel', 'noam', 'ofir']) {
    assert.equal((await run(who, 'select public.is_office() as ok'))[0].ok, true, who);
    assert.equal((await run(who, 'select count(*)::int as n from public.clients'))[0].n, 2, who);
  }
  assert.equal((await run('nadia', 'select public.is_office() as ok'))[0].ok, false);
  const saved = await run('shiel', "insert into public.characterizations (client_id, fields) values ($1, '{}'::jsonb) on conflict (client_id) do update set fields = excluded.fields returning client_id", [ids.shiel]);
  assert.equal(saved.length, 1);
  // The vault is the owner's flag on his row.
  assert.equal((await run('shiel', 'select public.can_use_vault() as ok'))[0].ok, true);
  // Not Metricool, not the Gantt.
  assert.equal((await run('shiel', 'select public.can_connect_metricool() as ok'))[0]?.ok ?? false, false);
});

test('who writes: Shiel the items of 4 and 5, not 6; the database agrees with the app', async () => {
  const insert = (who, key) => as(db, users[who], async (tx) => (await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done') returning item_key", [ids.shiel, key])).rows.length).catch(() => 0);
  for (const key of ['p04.address', 'p04.saved', 'p05.access', 'p05.logo', 'p06.verified', 'p08.done', 'p05.vault', 'p04.followup']) {
    const app = mayWrite({ person: 'shiel', client: { editor: 'nadia' }, key });
    assert.equal((await insert('shiel', key)) === 1, app, key);
    await db.query('delete from public.protocol_checks where client_id = $1 and item_key = $2', [ids.shiel, key]);
  }
  assert.equal(mayWrite({ person: 'shiel', client: {}, key: 'p04.saved' }), true);
  assert.equal(mayWrite({ person: 'shiel', client: {}, key: 'p06.verified' }), false);
});

test('the client\'s form: a network to open is a task for Noam on a client of Shiel\'s', async () => {
  const submit = async (cid) => {
    const link = (await keep(db, users.irit, 'select public.access_link_create($1) as l', [cid]))[0].l;
    const f = emptyForm();
    f.main.instagram = { choice: 'have', username: 'page_user', password: 'Insta-9!' };
    f.main.facebook = { choice: 'none', username: '', password: '' };
    f.main.tiktok = { choice: 'reset', username: 'page.tt', password: '' };
    assert.deepEqual((await keep(db, null, 'select public.access_form_submit($1, $2::jsonb) as r', [link.token, JSON.stringify(buildPayload(f))]))[0].r, { state: 'done' });
    return (await db.query('select owner, urgent from public.client_tasks where client_id = $1 and title like $2', [cid, 'לפתוח ללקוח %'])).rows;
  };
  assert.deepEqual(await submit(ids.shiel), [{ owner: 'noam', urgent: true }]);
  assert.deepEqual(await submit(ids.noam), [{ owner: 'noam', urgent: true }]);
  const ofirs = await addClient(db, 'מאפיית שחר', 'ofir');
  assert.deepEqual(await submit(ofirs), [{ owner: 'ofir', urgent: true }]);
});
