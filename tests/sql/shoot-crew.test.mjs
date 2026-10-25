// supabase/migrations/20261107100000_shoot_crew.sql in a real Postgres with every migration
// (tests/sql/pg.mjs): a shoot day without influencers (the owner's decision of 25.10.2026),
// Lior and one photographer, kept with the shoot (clients.deliverables.shoot_crew, or a
// round's shoot_crew).
//   - the file is the newest, only adds or replaces (none of the three words the production
//     tool refuses) and runs twice;
//   - a day that Eliel films is not "taken" in Eli's month (public.photographer_taken), and
//     Eli may take that day off; every other shoot day counts as before (a shoot type always
//     wins over a crew); the app's own list (app/availability-logic.js takenFrom) agrees;
//     Eliel's own days (public.photographer_taken_by) are the days he films;
//   - Eliel (no account) has a month the office marks in his name: the owner, Irit and Lior,
//     stamped with who did it; Irit marks Eli's in his name the same way; nobody else;
//   - the client's message for the day before such a shoot is seeded, and an office's own
//     words are kept.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql, migrationFiles } from './pg.mjs';
import { addMonths, monthKeyOf, monthDays, takenFrom, PHOTOGRAPHERS } from '../../app/availability-logic.js';
import { DEFAULT_TEMPLATES } from '../../app/messages-logic.js';

const FILE = '20261107100000_shoot_crew.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', eli: 'eli', nadia: 'nadia' };
let db;
const users = {};
const FAR = addMonths(monthKeyOf(new Date()), 2);
const d = (n) => monthDays(FAR)[n - 1];

async function call(who, sql, params = []) {
  const user = who ? users[who] : null;
  const claims = user ? { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated' } : { role: 'anon' };
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`set local role ${user ? 'authenticated' : 'anon'}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (err) {
    return { error: err.message };
  }
}
const at = (day, time = '10:00') => `${day}T${time}:00+02:00`;
// The clients of the test, as the app holds them (for takenFrom) and as inserted.
const CLIENTS = [
  { name: 'עם נטלי', status: 'active', shoot_type: 'natali', shoot_at: at(d(5)) },
  { name: 'בלי משפיענים, אליאל', status: 'active', shoot_type: null, shoot_at: at(d(6)), deliverables: { videos: 8, shoot_crew: 'eliel' } },
  { name: 'בלי משפיענים, אלי', status: 'active', shoot_type: null, shoot_at: at(d(7)), deliverables: { shoot_crew: 'eli' } },
  // A type always wins: a crew left behind by an old dialog does not make it Eliel's.
  { name: 'סוג וצוות', status: 'active', shoot_type: 'dms', shoot_at: at(d(8)), deliverables: { shoot_crew: 'eliel' } },
  {
    name: 'סבבים', status: 'active', shoot_type: 'natali', shoot_at: null,
    rounds: [
      { n: 2, shoot_type: null, shoot_crew: 'eliel', shoot_at: at(d(9)) },
      { n: 3, shoot_type: null, shoot_crew: 'eli', shoot_at: at(d(10)) },
      { n: 4, shoot_type: 'dms', shoot_crew: 'eliel', shoot_at: at(d(11)) },
      { n: 5, shoot_at: at(d(12)) },
    ],
  },
];

before(async () => {
  db = await freshDatabase();
  for (const [k, person] of Object.entries(PEOPLE)) {
    const email = `${k}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[k] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  for (const c of CLIENTS) {
    await db.query('insert into public.clients (name, business, status, shoot_type, shoot_at, deliverables, rounds) values ($1, $1, $2, $3, $4, $5::jsonb, $6::jsonb)',
      [c.name, c.status, c.shoot_type, c.shoot_at, JSON.stringify(c.deliverables || {}), JSON.stringify(c.rounds || [])]);
  }
});

test('the file: the newest, only adds or replaces, and runs twice', async () => {
  assert.equal(migrationFiles().at(-1), FILE);
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  assert.equal((await db.query("select count(*)::int as n from public.message_templates where key = 'eve_solo'")).rows[0].n, 1);
});

test("Eli's taken days: not a day Eliel films; every other shoot day as before; the app agrees", async () => {
  const taken = (await call('eli', 'select day::text, n from public.photographer_taken($1::date, $2::date)', [`${FAR}-01`, d(28)])).rows;
  const want = [5, 7, 8, 10, 11, 12].map((n) => ({ day: d(n), n: 1 }));
  assert.deepEqual(taken, want);
  assert.deepEqual(takenFrom(CLIENTS), Object.fromEntries(want.map((r) => [r.day, r.n])));
  // The office reads the same.
  assert.deepEqual((await call('lior', 'select day::text, n from public.photographer_taken($1::date, $2::date)', [`${FAR}-01`, d(28)])).rows, want);
});

test("Eliel's own days: the days he films; the office reads them, nobody else", async () => {
  const range = [`${FAR}-01`, d(28)];
  const want = [6, 9].map((n) => ({ day: d(n), n: 1 }));
  assert.deepEqual((await call('irit', 'select day::text, n from public.photographer_taken_by($1, $2::date, $3::date)', ['eliel', ...range])).rows, want);
  assert.deepEqual(takenFrom(CLIENTS, 'eliel'), Object.fromEntries(want.map((r) => [r.day, r.n])));
  // Eli's through it are the same as public.photographer_taken.
  assert.deepEqual((await call('lior', 'select day::text, n from public.photographer_taken_by($1, $2::date, $3::date)', ['eli', ...range])).rows,
    (await call('lior', 'select day::text, n from public.photographer_taken($1::date, $2::date)', range)).rows);
  assert.match((await call('irit', 'select * from public.photographer_taken_by($1, $2::date, $3::date)', ['nadia', ...range])).error, /unknown photographer/);
  assert.match((await call('nadia', 'select * from public.photographer_taken_by($1, $2::date, $3::date)', ['eliel', ...range])).error, /not allowed/);
  assert.match((await call(null, 'select * from public.photographer_taken_by($1, $2::date, $3::date)', ['eliel', ...range])).error, /not allowed|permission denied/);
});

test("Eliel's month: the office marks it in his name, stamped with who did it; Irit marks Eli's the same way", async () => {
  assert.deepEqual((await db.query('select public.photographer_people() as p')).rows[0].p, PHOTOGRAPHERS);
  const submit = (who, person, days, none = false) => call(who, 'select person, by_person, array(select x::text from unnest(days) x) as days from public.photographer_submit($1::date, $2::date[], $3, $4)', [`${FAR}-01`, days, none, person]);
  for (const who of ['owner', 'irit', 'lior']) {
    const r = await submit(who, 'eliel', [d(3), d(4)]);
    assert.deepEqual(r.rows?.[0], { person: 'eliel', by_person: PEOPLE[who] ?? 'owner', days: [d(3), d(4)] }, who);
  }
  // Ofir reads, and does not mark; Eli marks only his own; nobody else.
  for (const who of ['ofir', 'eli', 'nadia']) assert.match((await submit(who, 'eliel', [d(5)])).error, /not allowed/, who);
  assert.equal((await call('ofir', "select count(*)::int as n from public.photographer_months where person = 'eliel'")).rows[0].n, 1);
  // A day off with a shoot of his on it: the office is not held by it (he called).
  assert.equal((await submit('irit', 'eliel', [d(20)])).error, undefined);
  // Irit marks Eli's month in his name: his, stamped "irit".
  const eli = await submit('irit', 'eli', [d(21)]);
  assert.deepEqual(eli.rows[0], { person: 'eli', by_person: 'irit', days: [d(21)] });
});

test("Eli takes off a day Eliel films; a day he films is still held", async () => {
  const submit = (days) => call('eli', 'select * from public.photographer_submit($1::date, $2::date[], $3, $4)', [`${FAR}-01`, days, false, null]);
  assert.equal((await submit([d(6), d(7), d(9), d(20)])).error, undefined);
  // The 6th and the 9th are Eliel's: they come off. The 7th is his own solo day: held.
  assert.equal((await submit([d(7), d(20)])).error, undefined);
  assert.match((await submit([d(20)])).error, /availability_taken/);
});

test("the day-before message of a day without influencers: seeded with the app's words; an office's own words stay", async () => {
  const want = DEFAULT_TEMPLATES.find((t) => t.key === 'eve_solo');
  const row = (await db.query("select title, kind, station, body, updated_by from public.message_templates where key = 'eve_solo'")).rows[0];
  assert.deepEqual([row.title, row.kind, row.station, row.body], [want.title, 'milestone', null, want.body]);
  await db.query("update public.message_templates set body = 'הנוסח של המשרד' where key = 'eve_solo'");
  await db.exec(migrationSql(FILE));
  assert.equal((await db.query("select body from public.message_templates where key = 'eve_solo'")).rows[0].body, 'הנוסח של המשרד');
});
