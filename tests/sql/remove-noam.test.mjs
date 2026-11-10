// Noam left the company (10.11.2026; docs/ops.md, section 124): supabase/migrations/20261209100000_remove_noam.sql
// in a real Postgres (PGlite) with every migration:
//   - the file only replaces functions and rewrites the writers' table, refuses nothing the deploy tool
//     refuses, its writers block is the one the app generates, and it runs twice;
//   - a 'noam' staff row (were one ever added again) gets none of her old rights: not the office, not
//     Metricool, not the Gantt, not the clients' links, not the items of 4, 5, 6, 8 and 8ב;
//   - nobody can give her a task;
//   - the client's form: a network to open is Ofir's task, for any characterizer;
//   - Ofir's meetings: his clients, her old ones and a client with nobody set;
//   - the history stays storable: an old row naming her (the checks keep 'noam').
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { buildPayload, emptyForm } from '../../app/access-logic.js';
import { sqlBlock, latestBlock } from '../../scripts/protocol-writers.mjs';

const FILE = '20261209100000_remove_noam.sql';
const PEOPLE = { owner: null, irit: 'irit', ofir: 'ofir', ilai: 'ilai', noam: 'noam' };
let db;
const users = {};
const ids = {};

const q = (who, sql, params = []) => as(db, users[who], async (tx) => (await tx.query(sql, params)).rows);
const addClient = async (name, characterizer) => (await db.query(
  "insert into public.clients (name, business, editor, status, characterizer) values ($1, $1, 'nadia', 'active', $2) returning id", [name, characterizer])).rows[0].id;
// As someone, committed (as() in pg.mjs rolls back): a link made here must be there for the client's form.
async function keep(u, sql, params = []) {
  const claims = u ? { sub: u.id, email: u.email, role: 'authenticated' } : { role: 'anon' };
  let out;
  await db.transaction(async (tx) => {
    await tx.query(`set local role ${u ? 'authenticated' : 'anon'}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    out = (await tx.query(sql, params)).rows;
  });
  return out;
}

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    // Her row is gone live; here it is kept to show that it would open nothing.
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, key !== 'ilai']);
  }
  ids.noam = await addClient('קפה נעמה', 'noam');
  ids.ofir = await addClient('מאפיית שחר', 'ofir');
  ids.shiel = await addClient('מספרת שיאל', 'shiel');
  ids.lior = await addClient('מספרת ליאור', 'lior');
});

test('the file: the newest, only replaces, the app\'s writers block, runs twice', async () => {
  assert.equal(migrationFiles().at(-1), FILE);
  const sql = migrationSql(FILE);
  assert.doesNotMatch(sql, /\b(drop|delete|truncate)\b/i);
  assert.deepEqual(sql.replace(/--[^\n]*/g, '').match(/create\s+(table|policy|trigger|index|type)/gi), null);
  assert.deepEqual([...sql.matchAll(/create\s+or\s+replace\s+function\s+([a-z_.]+)/gi)].map((m) => m[1]).sort(),
    ['private.task_gives_access', 'public.access_form_submit', 'public.can_connect_metricool', 'public.can_edit_gantt', 'public.can_manage_access_links', 'public.is_office', 'public.ofir_meetings', 'public.staff_task_create_brief']);
  assert.deepEqual([latestBlock().file, latestBlock().block === sqlBlock()], [FILE, true]);
  await db.exec(sql);
  await db.exec(sql);
});

test('her old rights are gone; Ofir, Ilai and the owner keep theirs', async () => {
  const ok = async (who, fn) => (await q(who, `select public.${fn}() as ok`))[0]?.ok ?? false;
  for (const fn of ['is_office', 'can_connect_metricool', 'can_edit_gantt', 'can_manage_access_links']) {
    assert.equal(await ok('noam', fn), false, `noam ${fn}`);
    assert.equal(await ok('ofir', fn), true, `ofir ${fn}`);
    assert.equal(await ok('owner', fn), true, `owner ${fn}`);
  }
  assert.equal(await ok('ilai', 'is_office'), true);
  assert.equal((await q('noam', 'select count(*)::int as n from public.clients'))[0]?.n ?? 0, 0, 'she sees no client');
  for (const key of ['p04.address', 'p05.access', 'p06.verified', 'p08.done', 'p08b.posted']) {
    const wrote = await as(db, users.noam, async (tx) => (await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done') returning item_key", [ids.noam, key])).rows.length).catch(() => 0);
    assert.equal(wrote === 1, false, key);
  }
  const persons = (await db.query("select array_agg(key order by key) as k from private.protocol_writers where 'noam' = any(persons)")).rows[0].k;
  assert.equal(persons, null, 'no writers\' row names her');
});

test('nobody can give her a task', async () => {
  const r = await q('owner', "select public.staff_task_create_brief('noam', 'משימה', null, null) as id");
  assert.match(String(r.error || ''), /unknown assignee/);
  const ofir = await q('owner', "select public.staff_task_create_brief('ofir', 'משימה', null, null) as id");
  assert.equal(ofir.error, undefined, String(ofir.error));
});

test('the client\'s form: a network to open is Ofir\'s, whoever characterized', async () => {
  const submit = async (cid) => {
    const link = (await keep(users.irit, 'select public.access_link_create($1) as l', [cid]))[0].l;
    const f = emptyForm();
    f.main.instagram = { choice: 'have', username: 'page_user', password: 'Insta-9!' };
    f.main.facebook = { choice: 'none', username: '', password: '' };
    f.main.tiktok = { choice: 'reset', username: 'page.tt', password: '' };
    assert.deepEqual((await keep(null, 'select public.access_form_submit($1, $2::jsonb) as r', [link.token, JSON.stringify(buildPayload(f))]))[0].r, { state: 'done' });
    return (await db.query('select owner from public.client_tasks where client_id = $1 and title like $2', [cid, 'לפתוח ללקוח %'])).rows.map((r) => r.owner);
  };
  for (const c of ['noam', 'ofir', 'shiel', 'lior']) assert.deepEqual(await submit(ids[c]), ['ofir'], c);
});

test('Ofir\'s meetings: his clients, her old ones and a client with nobody set; not Shiel\'s or Lior\'s', async () => {
  const at = new Date(Date.now() + 36e5).toISOString();
  const nobody = (await db.query("insert into public.clients (name, status) values ('לקוח בלי', 'active') returning id")).rows[0].id;
  await db.query('update public.clients set characterizer = null where id = $1', [nobody]);
  await db.query('update public.clients set char_at = $1', [at]);
  const meetings = await q('ofir', "select starts_at from public.ofir_meetings(now() - interval '1 day')");
  assert.equal(meetings.length, 3);
});

test('the history stays: a client set to her keeps her name (the checks still allow it)', async () => {
  await db.query("update public.clients set characterizer = 'noam' where id = $1", [ids.noam]);
  assert.equal((await db.query('select characterizer from public.clients where id = $1', [ids.noam])).rows[0].characterizer, 'noam');
});
