// Process 6 passes to Ofir (supabase/migrations/20261111100000_p06_ofir.sql; the owner's decision
// of 28.10.2026: "להוריד מעילאי את כל עניין הגישות לרשתות, זה צריך לעבור לאופיר") on every
// migration in a real Postgres (PGlite):
//   - the file is the newest, has none of the words the deploy tool refuses, every UPDATE has a
//     WHERE, it creates nothing, and its writers block is the one the app generates;
//   - who writes process 6: the office (Ofir among them), Ilai no more; Lior's recovered logins
//     and Ilai's own items elsewhere (his new logo, the graphics) as before;
//   - the client's form: a network to open is an urgent task for Ofir;
//   - Ilai's open tasks to open a network pass to Ofir; a done one, or another task of his, stays;
//   - the vault as it was: Ilai still reads the statuses, and still cannot open a password
//     without his flag;
//   - the file runs twice and changes nothing more.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { PROCESSES } from '../../app/protocol.js';
import { buildPayload, emptyForm } from '../../app/access-logic.js';
import { sqlBlock, latestBlock, mayWrite } from '../../scripts/protocol-writers.mjs';

const FILE = '20261111100000_p06_ofir.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia' };
const OPEN_TITLE = 'לפתוח ללקוח TikTok ולהכניס את הגישה לכספת';
let db;
const users = {};
const ids = {};

async function people(d) {
  const out = {};
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await d.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    out[key] = { id: rows[0].id, email };
    // The vault flag as on the live site: the owner, Lior and Ofir; Ilai works without it.
    await d.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, ['owner', 'lior', 'ofir'].includes(key)]);
  }
  return out;
}
const addClient = async (d, name) => (await d.query("insert into public.clients (name, business, editor, status) values ($1, $1, 'nadia', 'active') returning id", [name])).rows[0].id;
// Committed calls (as() rolls back).
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

before(async () => {
  db = await freshDatabase();
  Object.assign(users, await people(db));
  ids.dana = await addClient(db, 'קפה דנה');
  ids.ron = await addClient(db, 'מספרת רון');
});

test('the file: the newest but three, none of the refused words, every UPDATE with a WHERE, nothing created, and the writers block the app generates', () => {
  // After it Niro and "הצל", the old documents in full and the monthly shoot day (28.10.2026).
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261112100000_new_influencers.sql', '20261112200000_legacy_contracts_full.sql', '20261113100000_client_details_month.sql', '20261114100000_ofir_deals.sql', '20261117100000_speed_pages.sql', '20261118100000_no_manager_approval.sql', '20261119100000_work_history.sql']);
  const sql = migrationSql(FILE);
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  assert.deepEqual(sql.replace(/--[^\n]*/g, '').match(/create\s+(table|policy|trigger|index|type)/gi), null);
  // Only the form's submission is replaced; no permission is granted or taken but its own.
  assert.deepEqual([...sql.matchAll(/create\s+or\s+replace\s+function\s+([a-z_.]+)/gi)].map((m) => m[1]), ['public.access_form_submit']);
  assert.deepEqual([latestBlock().file, latestBlock().block === sqlBlock()], [FILE, true]);
});

test('who writes process 6: the office (Ofir among them), Ilai no more; the rest of Ilai\'s as before', async () => {
  const insert = (who, key) => as(db, users[who], async (tx) => (await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done') returning item_key", [ids.ron, key])).rows.length).catch(() => 0);
  const p06 = PROCESSES.find((p) => p.id === 'p06');
  assert.deepEqual(p06.owners, ['ofir']);
  const keys = [...p06.items.map((i) => i.key), 'p06.claim', 'p06.wait', 'p06.handoff.ofir', 'p05.handoff.ofir', 'p05.newlogo', 'p07.made', 'p07b.posted'];
  const office = ['owner', 'irit', 'lior', 'ofir'];
  for (const key of keys) {
    for (const who of Object.keys(PEOPLE)) {
      const app = mayWrite({ person: PEOPLE[who], client: { editor: 'nadia' }, key });
      assert.equal((await insert(who, key)) === 1, app, `${who} ${key}`);
      if (key.startsWith('p06.')) assert.equal(app, office.includes(who), `${who} ${key}`);
    }
  }
  // Ilai keeps his own: the new logo (5), the graphics (7) and their upload (7ב).
  for (const key of ['p05.newlogo', 'p07.made', 'p07b.posted']) assert.equal(mayWrite({ person: 'ilai', client: {}, key }), true, key);
  const rows = (await db.query("select key, persons from private.protocol_writers where key like 'p06.%' order by key")).rows;
  assert.ok(rows.length > 0);
  for (const r of rows) assert.deepEqual(r.persons, [], r.key);
});

test('the client\'s form: a network to open is an urgent task for Ofir', async () => {
  const link = (await keep(db, users.irit, 'select public.access_link_create($1) as l', [ids.dana]))[0].l;
  const f = emptyForm();
  f.main.instagram = { choice: 'have', username: 'dana_cafe', password: 'Insta-9!' };
  f.main.facebook = { choice: 'none', username: '', password: '' };
  f.main.tiktok = { choice: 'reset', username: 'dana.tt', password: '' };
  const r = (await keep(db, null, 'select public.access_form_submit($1, $2::jsonb) as r', [link.token, JSON.stringify(buildPayload(f))]))[0].r;
  assert.deepEqual(r, { state: 'done' });
  const tasks = (await db.query('select title, owner, urgent, done_at from public.client_tasks where client_id = $1', [ids.dana])).rows;
  assert.deepEqual(tasks, [{ title: 'לפתוח ללקוח Facebook ולהכניס את הגישה לכספת (הלקוח סימן בטופס: אין כיום)', owner: 'ofir', urgent: true, done_at: null }]);
});

test('the vault as it was: Ilai still reads the statuses, and opens no password without his flag', async () => {
  const st = await as(db, users.ilai, async (tx) => (await tx.query('select * from public.access_work_statuses($1)', [[ids.dana]])).rows);
  assert.equal(st.error, undefined);
  assert.ok(st.length >= 2, JSON.stringify(st));
  const vault = await as(db, users.ilai, async (tx) => (await tx.query('select public.can_use_vault() as ok')).rows[0].ok);
  assert.equal(vault, false);
  assert.equal(await as(db, users.ofir, async (tx) => (await tx.query('select public.can_use_vault() as ok')).rows[0].ok), true);
});

test('Ilai\'s open tasks to open a network pass to Ofir; a done one, and his other tasks, stay; the file runs twice', async () => {
  const old = await freshDatabase({ upTo: FILE });
  await people(old);
  const c = await addClient(old, 'מאפיית שחר');
  const task = async (title, owner, done = false) => (await old.query(
    'insert into public.client_tasks (client_id, title, owner, urgent, done_at) values ($1, $2, $3, true, $4) returning id', [c, title, owner, done ? new Date().toISOString() : null])).rows[0].id;
  const t = {
    open: await task(OPEN_TITLE, 'ilai'),
    form: await task('לפתוח ללקוח Facebook ולהכניס את הגישה לכספת (הלקוח סימן בטופס: אין כיום)', 'ilai'),
    done: await task(OPEN_TITLE, 'ilai', true),
    other: await task('לתקן את הלוגו בגרפיקה 3', 'ilai'),
    lior: await task('לשחזר עם הלקוח את הגישה ל־Instagram ולהכניס לכספת', 'lior'),
  };
  const owners = async () => Object.fromEntries(await Promise.all(Object.entries(t).map(async ([k, id]) => [k, (await old.query('select owner from public.client_tasks where id = $1', [id])).rows[0].owner])));
  await old.exec(migrationSql(FILE));
  assert.deepEqual(await owners(), { open: 'ofir', form: 'ofir', done: 'ilai', other: 'ilai', lior: 'lior' });
  const writers = (await old.query('select key, proc, round, persons from private.protocol_writers order by key')).rows;
  await old.exec(migrationSql(FILE));
  assert.deepEqual(await owners(), { open: 'ofir', form: 'ofir', done: 'ilai', other: 'ilai', lior: 'lior' });
  assert.deepEqual((await old.query('select key, proc, round, persons from private.protocol_writers order by key')).rows, writers);
  await old.close();
});
