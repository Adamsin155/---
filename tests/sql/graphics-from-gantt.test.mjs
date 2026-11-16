// 7ב and 23ב close by themselves from the content Gantt (supabase/migrations/
// 20261216100000_graphics_from_gantt.sql; the owner, 16.11.2026; docs/ops.md, section 138), on every
// migration in a real Postgres (PGlite):
//   - the file has none of the words the migration tool refuses, and runs twice;
//   - the clients already behind are closed by the file itself, only where the Gantt shows them up;
//   - 7ב: after the client's approval, the 9th graphic that turns "תוזמן" or "עלה" closes it (Ilai's
//     own change in the Gantt, as himself); a client with fewer than 9 graphics: all of them;
//   - graphics already up when the approval is marked: the approval closes it at once;
//   - a cancelled graphic is not counted, and before the approval nothing closes;
//   - the mark is the system's (by_email 'system') with the count in its note, and a mark that is
//     already there ("לא רלוונטי", or Ilai's own) is never touched;
//   - 23ב: only when every graphic of the Gantt is up.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, migrationSql } from './pg.mjs';

const FILE = '20261216100000_graphics_from_gantt.sql';
const PEOPLE = { owner: null, irit: 'irit', ilai: 'ilai' };
let db;
const users = {};
const ids = {};

async function keep(sql, params = [], u = null) {
  let out;
  await db.transaction(async (tx) => {
    if (u) {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated' })]);
    }
    out = (await tx.query(sql, params)).rows;
  });
  return out;
}
const addClient = async (name) => (await db.query(
  "insert into public.clients (name, business, status, shoot_type) values ($1, $1, 'active', 'natali') returning id", [name])).rows[0].id;
// n graphic rows, numbered from 1, all planned (or in the state given).
async function graphics(cid, n, state = 'planned') {
  for (let i = 1; i <= n; i += 1) {
    await db.query("insert into public.client_gantt (client_id, key, kind, title, day, state) values ($1, $2, 'graphic', $3, current_date + $4::int, $5)",
      [cid, `graphic.${i}`, `גרפיקה ${i}`, i, state]);
  }
}
const setState = (cid, nums, state, who = 'ilai') => keep(
  "update public.client_gantt set state = $3 where client_id = $1 and key = any ($2::text[]) returning id",
  [cid, nums.map((i) => `graphic.${i}`), state], users[who]);
const mark = (cid, key, who = 'irit', state = 'done') => keep(
  'insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, $3) on conflict (client_id, item_key) do update set state = excluded.state returning item_key',
  [cid, key, state], users[who]);
const check = async (cid, key) => (await db.query('select state, note, by_email from public.protocol_checks where client_id = $1 and item_key = $2', [cid, key])).rows[0] || null;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

before(async () => {
  db = await freshDatabase({ upTo: FILE });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
  // Before the file: a client behind (approved, 10 graphics up, no mark), and one whose graphics are
  // not in the Gantt (approved, nothing up).
  ids.behind = await addClient('מאחור');
  await graphics(ids.behind, 10, 'scheduled');
  await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p07.approved', 'done')", [ids.behind]);
  ids.empty = await addClient('בלי גאנט');
  await graphics(ids.empty, 12);
  await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p07.approved', 'done')", [ids.empty]);
});

test('the file: no word the migration tool refuses; runs twice; closes the clients already behind, only those', async () => {
  const sql = migrationSql(FILE);
  assert.equal(sql.match(/\b(drop|delete|truncate)\b/gi), null);
  await db.exec(sql);
  await db.exec(sql);
  const c = await check(ids.behind, 'p07b.posted');
  assert.equal(c?.state, 'done');
  assert.equal(c.by_email, 'system');
  assert.equal(c.note, 'נסגר לבד מהגאנט: 10 גרפיקות תוזמנו או עלו');
  assert.equal(await check(ids.empty, 'p07b.posted'), null);
});

test('7ב: the 9th graphic up after the approval closes it, as the system, whoever changed the Gantt', async () => {
  ids.a = await addClient('א');
  await graphics(ids.a, 20);
  await setState(ids.a, range(1, 9), 'scheduled');
  assert.equal(await check(ids.a, 'p07b.posted'), null, 'before the approval nothing closes');
  await setState(ids.a, range(1, 9), 'planned');
  await mark(ids.a, 'p07.approved');
  assert.equal(await check(ids.a, 'p07b.posted'), null);
  await setState(ids.a, range(1, 5), 'scheduled');
  await setState(ids.a, [6, 7], 'posted');
  await setState(ids.a, [8], 'skipped');
  assert.equal(await check(ids.a, 'p07b.posted'), null, '7 up and one cancelled is not 9');
  await setState(ids.a, [9], 'scheduled');
  assert.equal(await check(ids.a, 'p07b.posted'), null);
  await setState(ids.a, [10], 'posted');
  const c = await check(ids.a, 'p07b.posted');
  assert.deepEqual([c?.state, c?.by_email], ['done', 'system']);
  assert.match(c.note, /^נסגר לבד מהגאנט: 9 גרפיקות/);
  // The log has it, as the system's.
  const log = (await db.query("select action, by_email from public.protocol_log where client_id = $1 and item_key = 'p07b.posted'", [ids.a])).rows;
  assert.deepEqual(log, [{ action: 'done', by_email: 'system' }]);
  // Ilai's own Gantt change is still his.
  const row = (await db.query("select by_email from public.client_gantt where client_id = $1 and key = 'graphic.10'", [ids.a])).rows[0];
  assert.equal(row.by_email, users.ilai.email);
});

test('7ב: graphics already up when the approval is marked: closed at once; fewer than 9 graphics: all of them', async () => {
  ids.b = await addClient('ב');
  await graphics(ids.b, 12, 'scheduled');
  await mark(ids.b, 'p07.approved');
  assert.equal((await check(ids.b, 'p07b.posted'))?.by_email, 'system');
  // Irit's own approval stays hers.
  assert.equal((await check(ids.b, 'p07.approved'))?.by_email, users.irit.email);

  ids.c = await addClient('ג');
  await graphics(ids.c, 5);
  await mark(ids.c, 'p07.approved');
  await setState(ids.c, range(1, 4), 'posted');
  assert.equal(await check(ids.c, 'p07b.posted'), null);
  await setState(ids.c, [5], 'posted');
  assert.equal((await check(ids.c, 'p07b.posted'))?.state, 'done');
});

test('a mark already there is never touched; nothing is cleared when a graphic goes back', async () => {
  ids.d = await addClient('ד');
  await graphics(ids.d, 10);
  await mark(ids.d, 'p07.approved');
  await mark(ids.d, 'p07b.posted', 'ilai', 'na');
  await setState(ids.d, range(1, 10), 'posted');
  const c = await check(ids.d, 'p07b.posted');
  assert.deepEqual([c.state, c.by_email], ['na', users.ilai.email]);

  await setState(ids.a, range(1, 10), 'planned');
  assert.equal((await check(ids.a, 'p07b.posted'))?.state, 'done');
});

test('23ב: only when every graphic of the Gantt is up (a cancelled one does not count)', async () => {
  ids.e = await addClient('ה');
  await graphics(ids.e, 15);
  await mark(ids.e, 'p23.approved');
  await setState(ids.e, range(1, 13), 'scheduled');
  assert.equal(await check(ids.e, 'p23b.posted'), null);
  await setState(ids.e, [14], 'skipped');
  assert.equal(await check(ids.e, 'p23b.posted'), null);
  await setState(ids.e, [15], 'posted');
  const c = await check(ids.e, 'p23b.posted');
  assert.deepEqual([c?.state, c?.by_email], ['done', 'system']);
  assert.equal(c.note, 'נסגר לבד מהגאנט: כל 14 הגרפיקות בגאנט תוזמנו או עלו');
  // 23ב's approval alone did not close 7ב.
  assert.equal(await check(ids.e, 'p07b.posted'), null);
});

test('not for a client that is not active or ending', async () => {
  ids.f = await addClient('ו');
  await graphics(ids.f, 9, 'scheduled');
  await db.query("update public.clients set status = 'ended' where id = $1", [ids.f]);
  await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p07.approved', 'done')", [ids.f]);
  assert.equal(await check(ids.f, 'p07b.posted'), null);
});
