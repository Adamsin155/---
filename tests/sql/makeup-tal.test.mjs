// Tal, Natali's makeup artist (supabase/migrations/20261213100000_makeup_tal.sql and
// supabase/pending/makeup_tal_checks.sql, the second waiting for the owner's approval; the owner's
// request of 15.11.2026; docs/ops.md, section 132), on every migration in a real Postgres (PGlite):
//   - the migration has none of the words the migration tool refuses, and runs twice; the pending file
//     only widens the two checks it adds again (and adds the function that takes her own marks off);
//   - before the pending file her row cannot be stored; after it, it can;
//   - she reads nothing of the clients: no client, mark, task, vault row, quote, answer table;
//   - her screen: only Natali's days (not Niro's), from today on, the business and the shoot time,
//     several clients on one day, a round's day; no id, address or phone;
//   - "מאשרת" needs an hour before the shoot, marks the items of every client of the day (a round's
//     with its prefix) with her hour, keeps a mark Lior made himself; a new hour updates her marks;
//   - "לא יכולה" takes her own marks off and leaves Lior's;
//   - nobody else outside the office may answer; the office reads the answers.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql } from './pg.mjs';

const FILE = '20261213100000_makeup_tal.sql';
const PENDING = new URL('../../supabase/pending/makeup_tal_checks.sql', import.meta.url);
const NOAM_CHECKS = new URL('../../supabase/pending/noam_checks.sql', import.meta.url);
const PEOPLE = { owner: null, lior: 'lior', nadia: 'nadia', eli: 'eli', tal: 'tal' };
let db;
const users = {};
const ids = {};

// Days ahead, in Israel, at a given hour: "YYYY-MM-DDTHH:MM:00+02:00" (winter time in the tests' dates).
const ahead = (days, hh = '10:00') => {
  const d = new Date(Date.now() + days * 864e5);
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
  return { key, at: new Date(new Date(`${key}T${hh}:00Z`).getTime() - offsetMinutes(key) * 60e3).toISOString() };
};
function offsetMinutes(key) {
  const probe = new Date(`${key}T12:00:00Z`);
  const local = new Date(probe.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const utc = new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local - utc) / 60e3);
}
const D1 = ahead(5, '10:00');
const D1b = { at: new Date(new Date(D1.at).getTime() + 3 * 3600e3).toISOString() }; // the same day, 13:00
const D2 = ahead(8, '11:00');

async function keep(sql, params = [], u = null) {
  const claims = u ? { sub: u.id, email: u.email, role: 'authenticated' } : null;
  let out;
  await db.transaction(async (tx) => {
    if (u) {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    }
    out = (await tx.query(sql, params)).rows;
  });
  return out;
}
const run = (who, sql, params = []) => as(db, users[who], async (tx) => (await tx.query(sql, params)).rows);
const answer = (day, a, hour = null) => keep('select public.makeup_answer($1::date, $2, $3) as r', [day, a, hour], users.tal);
const marks = async (cid) => Object.fromEntries((await keep('select item_key, note from public.protocol_checks where client_id = $1 and item_key like $2', [cid, '%makeup%']))
  .map((r) => [r.item_key, r.note]));

before(async () => {
  db = await freshDatabase();
  await db.exec(readFileSync(NOAM_CHECKS, 'utf8'));
  // Before the pending file her row cannot be stored.
  await db.query("insert into auth.users (email, email_confirmed_at) values ('tal-early@astrateg.test', now())");
  await assert.rejects(db.query("insert into public.staff (email, person) values ('tal-early@astrateg.test', 'tal')"), /staff_person_check/);
  await db.exec(readFileSync(PENDING, 'utf8'));
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, key === 'owner']);
  }
  const add = async (name, type, at, rounds = []) => (await db.query(
    "insert into public.clients (name, business, status, shoot_type, shoot_at, rounds, phone, address) values ($1, $2, 'active', $3, $4, $5::jsonb, '050-0000000', 'רחוב הדוגמה 1') returning id",
    [`איש ${name}`, name, type, at, JSON.stringify(rounds)])).rows[0].id;
  ids.a = await add('פרץ יוגה', 'natali', D1.at);
  ids.b = await add('חן קוסמטיקה', 'natali', D1b.at);
  ids.niro = await add('נירו בע״מ', 'niro', D1.at);
  ids.past = await add('עבר', 'natali', ahead(-3).at);
  // A round with Natali on another day (the client's own shoot passed).
  ids.round = await add('גולן מזגנים', 'natali', ahead(-20).at, [{ n: 2, shoot_at: D2.at }]);
  // A round without influencers (Eli) on D2: not Natali's.
  ids.solo = await add('סולו', 'natali', ahead(-30).at, [{ n: 2, shoot_at: D2.at, shoot_type: null, shoot_crew: 'eli' }]);
});

test('the files: no word the migration tool refuses; the pending file widens two checks and adds one function; both run twice', async () => {
  const sql = migrationSql(FILE);
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  const pending = readFileSync(PENDING, 'utf8');
  assert.match(pending, /^-- WAITING FOR THE OWNER'S APPROVAL/);
  const code = pending.replace(/--[^\n]*/g, '');
  const taken = [...code.matchAll(/drop constraint if exists ([a-z_]+);/g)].map((m) => m[1]);
  const added = [...code.matchAll(/add constraint ([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(taken, ['staff_person_check', 'reminder_log_person_check']);
  assert.deepEqual(added, taken);
  assert.equal((code.match(/\bdelete\b/gi) || []).length, 1, 'one delete, inside makeup_unmark');
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(pending);
  await db.exec(pending);
  // A notification for her can be stored now.
  await db.query("insert into public.reminder_log (key, person, rule, level, channel, status, title) values ('makeupSet:-:x:set@tal', 'tal', 'makeupSet', 'ring', 'push', 'sent', 't')");
});

test('she reads nothing of the clients', async () => {
  for (const t of ['clients', 'protocol_checks', 'client_tasks', 'client_access', 'quotes', 'characterizations', 'makeup_answers']) {
    const r = await run('tal', `select count(*)::int as n from public.${t}`);
    assert.equal(r.error, undefined, t);
    assert.equal(r[0].n, 0, t);
  }
  assert.equal((await run('tal', 'select public.can_see_client($1) as ok', [ids.a]))[0].ok, false);
  assert.equal((await run('tal', 'select public.is_office() as ok'))[0].ok, false);
});

test('her screen: Natali only, from today, the business and the shoot time, nothing else', async () => {
  const r = (await run('tal', 'select public.makeup_my_days() as r'))[0].r;
  const days = r.days.map((d) => [d.day, d.business, d.round, new Date(d.shoot_at).toISOString()]);
  assert.deepEqual(days, [
    [D1.key, 'פרץ יוגה', 1, D1.at],
    [D1.key, 'חן קוסמטיקה', 1, D1b.at],
    [D2.key, 'גולן מזגנים', 2, D2.at],
  ]);
  assert.deepEqual(Object.keys(r.days[0]).sort(), ['business', 'day', 'round', 'shoot_at']);
  assert.deepEqual(r.answers, []);
  // An editor (no access) cannot call it; the office can.
  assert.match((await run('nadia', 'select public.makeup_my_days()')).error, /not allowed/);
  assert.equal((await run('lior', 'select public.makeup_my_days() as r'))[0].r.days.length, 3);
});

test('"מאשרת" needs an hour before the shoot; it marks every client of the day with her hour', async () => {
  for (const [hour, why] of [[null, /required/], ['7:30', /required/], ['25:00', /required/], ['10:00', /before the shoot/], ['11:30', /before the shoot/]]) {
    await assert.rejects(answer(D1.key, 'yes', hour), why, String(hour));
  }
  await assert.rejects(answer(ahead(-3).key, 'yes', '06:00'), /passed/);
  await assert.rejects(answer(ahead(30).key, 'yes', '06:00'), /no shoot day with Natali/);
  // Lior had marked the ride himself and the makeup of one client: his mark stays his.
  await keep("insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p15.natali.makeup', 'done', 'סידרתי בטלפון')", [ids.b], users.lior);
  const [{ r }] = await answer(D1.key, 'yes', '08:00');
  assert.equal(r.answer, 'yes');
  assert.equal(r.arrive_time, '08:00');
  assert.equal(new Date(r.shoot_at).toISOString(), D1.at);
  assert.equal(r.by_email, undefined);
  assert.deepEqual(await marks(ids.a), { 'p11b.makeup': 'מאפרת: מגיעה לנטלי ב־08:00', 'p15.natali.makeup': 'מאפרת: מגיעה לנטלי ב־08:00' });
  assert.deepEqual(await marks(ids.b), { 'p11b.makeup': 'מאפרת: מגיעה לנטלי ב־08:00', 'p15.natali.makeup': 'סידרתי בטלפון' });
  assert.deepEqual(await marks(ids.niro), {}, 'not Niro\'s day');
  // A round: its own keys.
  await answer(D2.key, 'yes', '09:15');
  assert.deepEqual(await marks(ids.round), { 'r2.p11b.makeup': 'מאפרת: מגיעה לנטלי ב־09:15', 'r2.p15.natali.makeup': 'מאפרת: מגיעה לנטלי ב־09:15' });
  assert.deepEqual(await marks(ids.solo), {});
  // Another hour: her marks take it.
  await answer(D1.key, 'yes', '07:45');
  assert.equal((await marks(ids.a))['p11b.makeup'], 'מאפרת: מגיעה לנטלי ב־07:45');
  // She sees her answers; the office reads the table.
  const mine = (await run('tal', 'select public.makeup_my_days() as r'))[0].r.answers;
  assert.deepEqual(mine.map((a) => [a.day, a.answer, a.arrive_time]), [[D1.key, 'yes', '08:00'], [D2.key, 'yes', '09:15'], [D1.key, 'yes', '07:45']]);
  assert.equal((await run('lior', 'select count(*)::int as n from public.makeup_answers'))[0].n, 3);
  assert.equal((await run('nadia', 'select count(*)::int as n from public.makeup_answers'))[0].n, 0);
});

test('"לא יכולה" takes her own marks off and keeps Lior\'s; nobody outside the office answers for her; the browser cannot write the table', async () => {
  const [{ r }] = await answer(D1.key, 'no', '07:00');
  assert.equal(r.arrive_time, null, 'no hour with "לא יכולה"');
  assert.deepEqual(await marks(ids.a), {});
  assert.deepEqual(await marks(ids.b), { 'p15.natali.makeup': 'סידרתי בטלפון' });
  assert.match((await run('nadia', "select public.makeup_answer($1::date, 'yes', '07:00')", [D1.key])).error, /not allowed/);
  assert.match((await run('eli', "select public.makeup_answer($1::date, 'no')", [D1.key])).error, /not allowed/);
  assert.ok((await run('tal', "insert into public.makeup_answers (day, shoot_at, answer, person) values (current_date, now(), 'no', 'tal')")).error);
  assert.ok((await run('lior', "insert into public.makeup_answers (day, shoot_at, answer, person) values (current_date, now(), 'no', 'tal')")).error);
  assert.match((await run('tal', 'select private.makeup_unmark(current_date)')).error, /permission denied/);
  // The office may answer in her name (after a call).
  const out = await run('lior', "select public.makeup_answer($1::date, 'yes', '07:30') as r", [D1.key]);
  assert.equal(out[0].r.person, 'lior');
});
