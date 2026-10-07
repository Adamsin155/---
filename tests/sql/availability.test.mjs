// The photographer's monthly availability in the database
// (supabase/migrations/20261016100000_photographer_availability.sql), on every
// migration in a real Postgres (PGlite): who hands it over and who reads it (Eli, Irit,
// Lior, Ofir, the owner; not Ilai, an editor, a sales agent, a stranger or anon), what
// the database stamps itself, that the browser cannot write the tables, the explicit
// "no free day", the lock after the 15th, the days a shoot day sits on, the unexpected
// change (once a calendar month, two consecutive dates at most), entering it in his
// name, the same lists as the app's, and the migration running twice without any of
// the words the production deploy tool refuses.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { PHOTOGRAPHERS, READERS, ON_BEHALF, addMonths, monthKeyOf, monthDays, NOTE_MAX } from '../../app/availability-logic.js';
import { dayKeyIL } from '../../app/tz.js';

const MIGRATION = '20261016100000_photographer_availability.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', eli: 'eli', stav: 'stav' };
const DENIED = /not allowed|permission denied|row-level security/;
let db;
const users = {};

// Months relative to the real clock (the database's now()): the current one is always
// past its 15th-of-the-month-before, and the one two months ahead never is.
const NOW = new Date();
const THIS = monthKeyOf(NOW);
const FAR = addMonths(THIS, 2);
const TODAY = dayKeyIL(NOW);
const d = (month, n) => monthDays(month)[n - 1];
const first = (month) => `${month}-01`;

async function call(who, sql, params = []) {
  const user = who === 'anon' || who === 'service' ? null : users[who];
  const role = who === 'service' ? 'service_role' : user ? 'authenticated' : 'anon';
  const claims = user ? { sub: user.id, email: user.email, role, aud: 'authenticated' } : { role };
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (err) {
    return { error: err.message };
  }
}
const q = (who, sql, params = []) => as(db, who === 'anon' ? null : users[who], async (tx) => ({ rows: (await tx.query(sql, params)).rows }));
const submit = (who, month, days, none = false, person = null) => call(who, 'select * from public.photographer_submit($1::date, $2::date[], $3, $4)', [first(month), days, none, person]);
const change = (who, days, note = null) => call(who, 'select * from public.photographer_change($1::date[], $2)', [days, note]);
const monthRow = async (month, person = 'eli') => {
  const r = (await db.query("select person, month::text, array(select x::text from unnest(days) x) as days, none, by_person, by_email, submitted_at, updated_at from public.photographer_months where person = $1 and month = $2::date", [person, first(month)])).rows[0];
  return r || null;
};
const wipe = () => db.exec('delete from public.photographer_changes where true; delete from public.photographer_months where true; delete from public.clients where true;');
const shootOn = (day, name = 'פיצה רון') => db.query("insert into public.clients (name, business, status, shoot_at) values ($1, $1, 'active', ($2 || ' 10:00 Asia/Jerusalem')::timestamptz) returning id", [name, day]);

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const [k, person] of Object.entries(PEOPLE)) {
    const email = `${k}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[k] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  const out = await db.query("insert into auth.users (email, email_confirmed_at) values ('stranger@else.test', now()) returning id");
  users.stranger = { id: out.rows[0].id, email: 'stranger@else.test' };
  // The migration, twice (safe to run again).
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
});

test('the migration has none of the words the production deploy tool refuses, and no policy is made twice', async () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  const policies = (await db.query("select tablename, policyname, cmd, qual from pg_policies where tablename in ('photographer_months', 'photographer_changes') order by 1")).rows;
  assert.deepEqual(policies.map((p) => [p.tablename, p.policyname, p.cmd]), [
    ['photographer_changes', 'availability change readers', 'SELECT'], ['photographer_months', 'availability readers', 'SELECT'],
  ]);
  for (const p of policies) assert.match(p.qual, /can_read_availability\(person\)/);
});

test('the lists are the app\'s: who is a photographer, who reads, who enters it in his name', async () => {
  assert.deepEqual((await db.query('select public.photographer_people() as p')).rows[0].p, PHOTOGRAPHERS);
  for (const who of Object.keys(PEOPLE)) {
    const person = PEOPLE[who] ?? 'owner';
    const r = (await q(who, "select public.can_read_availability('eli') as reads, public.can_manage_availability() as manages")).rows[0];
    assert.equal(r.reads, READERS.includes(person) || PHOTOGRAPHERS.includes(person), `${who} reads`);
    assert.equal(r.manages, ON_BEHALF.includes(person), `${who} manages`);
  }
  assert.equal((await q('stranger', "select public.can_read_availability('eli') as ok")).rows[0].ok, false);
  assert.match((await q('anon', "select public.can_read_availability('eli')")).error, DENIED);
});

test('Eli hands a month over: stamped by the database; an empty month must be said', async () => {
  await wipe();
  // Nothing marked and nothing said: refused.
  assert.match((await submit('eli', FAR, [])).error, /availability_empty/);
  assert.match((await submit('eli', FAR, [d(FAR, 3)], true)).error, /availability_none/);
  // A day of another month, a month that is not the first of one, a month that passed.
  assert.match((await submit('eli', FAR, [d(addMonths(FAR, 1), 1)])).error, /availability_month/);
  assert.match((await call('eli', 'select public.photographer_submit($1::date, $2::date[])', [d(FAR, 2), [d(FAR, 3)]])).error, /availability_month/);
  assert.match((await submit('eli', addMonths(THIS, -1), [d(addMonths(THIS, -1), 3)])).error, /availability_month/);
  assert.match((await submit('eli', addMonths(THIS, 4), [d(addMonths(THIS, 4), 3)])).error, /availability_month/);
  assert.equal(await monthRow(FAR), null);

  const r = await submit('eli', FAR, [d(FAR, 12), d(FAR, 3), d(FAR, 3), d(FAR, 4)]);
  assert.equal(r.error, undefined);
  const row = await monthRow(FAR);
  assert.deepEqual(row.days, [d(FAR, 3), d(FAR, 4), d(FAR, 12)]); // sorted, once each
  assert.equal(row.none, false);
  assert.equal(row.by_person, 'eli');
  assert.equal(row.by_email, 'eli@astrateg.test');
  assert.ok(Math.abs(new Date(row.submitted_at) - Date.now()) < 60e3);

  // "אין לי ימים פנויים": a row with no days, said.
  const other = addMonths(THIS, 3);
  assert.equal((await submit('eli', other, [], true)).error, undefined);
  const none = await monthRow(other);
  assert.deepEqual([none.days, none.none], [[], true]);
});

test('who writes: only the photographer for himself; the owner, Irit and Lior in his name; nobody writes the tables directly', async () => {
  await wipe();
  for (const who of ['ofir', 'ilai', 'nadia', 'stav', 'stranger', 'anon']) {
    assert.match((await submit(who, FAR, [d(FAR, 3)], false, 'eli')).error, DENIED, `${who} in his name`);
    assert.match((await submit(who, FAR, [d(FAR, 3)])).error, DENIED, `${who} for themselves`);
    assert.match((await change(who, [d(FAR, 3)])).error, DENIED, `${who} change`);
  }
  // A manager has no availability of their own, and cannot report his unexpected change.
  assert.match((await submit('irit', FAR, [d(FAR, 3)])).error, /unknown photographer/);
  assert.match((await submit('irit', FAR, [d(FAR, 3)], false, 'nadia')).error, /unknown photographer/);
  assert.match((await change('lior', [d(FAR, 3)])).error, DENIED);
  assert.equal(await monthRow(FAR), null);
  // Direct writes: refused for everyone signed in, the photographer too.
  for (const who of ['eli', 'irit', 'owner', 'anon']) {
    assert.match((await call(who, "insert into public.photographer_months (person, month, days, by_person, by_email) values ('eli', $1::date, '{}', 'eli', 'x@x')", [first(FAR)])).error, DENIED, who);
    assert.match((await call(who, "insert into public.photographer_changes (person, reported_month, days, by_email) values ('eli', $1::date, array[$2::date], 'x@x')", [first(THIS), d(FAR, 3)])).error, DENIED, who);
  }
  await submit('eli', FAR, [d(FAR, 3), d(FAR, 4)]);
  for (const who of ['eli', 'irit', 'owner']) {
    const u = await call(who, "update public.photographer_months set days = '{}' where person = 'eli' returning person");
    assert.ok(u.error ? DENIED.test(u.error) : u.rows.length === 0, who);
    const x = await call(who, "delete from public.photographer_months where person = 'eli' returning person");
    assert.ok(x.error ? DENIED.test(x.error) : x.rows.length === 0, who);
  }
  assert.deepEqual((await monthRow(FAR)).days, [d(FAR, 3), d(FAR, 4)]);

  // In his name, after he called: Irit, Lior and the owner; stamped as who did it.
  for (const who of ['irit', 'lior', 'owner']) {
    assert.equal((await submit(who, FAR, [d(FAR, 20)], false, 'eli')).error, undefined, who);
    const row = await monthRow(FAR);
    assert.deepEqual([row.days, row.by_person, row.by_email], [[d(FAR, 20)], PEOPLE[who] ?? 'owner', `${who}@astrateg.test`]);
  }
});

test('who reads: Eli his own, the owner, Irit, Lior and Ofir all; Ilai, an editor, a sales agent, a stranger and anon nothing', async () => {
  await wipe();
  await submit('eli', FAR, [d(FAR, 3), d(FAR, 4)]);
  await shootOn(d(FAR, 9));
  for (const who of [...Object.keys(PEOPLE), 'stranger']) {
    const person = PEOPLE[who] ?? (who === 'stranger' ? null : 'owner');
    const reads = !!person && (READERS.includes(person) || PHOTOGRAPHERS.includes(person));
    assert.equal((await q(who, 'select person from public.photographer_months')).rows.length, reads ? 1 : 0, `${who} months`);
    const taken = await q(who, 'select day::text, n from public.photographer_taken($1::date, $2::date)', [first(FAR), d(FAR, 28)]);
    if (reads) assert.deepEqual(taken.rows, [{ day: d(FAR, 9), n: 1 }], `${who} taken`);
    else assert.match(taken.error, DENIED, `${who} taken`);
  }
  assert.match((await q('anon', 'select person from public.photographer_months')).error, DENIED);
  assert.match((await q('anon', 'select person from public.photographer_changes')).error, DENIED);
  assert.match((await q('anon', 'select * from public.photographer_taken($1::date, $2::date)', [first(FAR), d(FAR, 28)])).error, DENIED);
  // The reminders' server reads both tables.
  assert.equal((await call('service', 'select person from public.photographer_months')).rows.length, 1);
  assert.equal((await call('service', 'select person from public.photographer_changes')).rows.length, 0);
});

test('the days a shoot day sits on: counted per Israel day, rounds too; not archived or ended clients; they never come off through an update', async () => {
  await wipe();
  await shootOn(d(FAR, 9));
  // A round of another client on the same day, and one late in the evening (still that Israel day).
  await db.query("insert into public.clients (name, business, status, rounds) values ('קפה דנה', 'קפה דנה', 'active', $1::jsonb)",
    [JSON.stringify([{ n: 2, shoot_at: `${d(FAR, 9)}T12:00:00+02:00` }, { n: 3, shoot_at: 'not a date' }])]);
  await db.query("insert into public.clients (name, business, status, shoot_at) values ('לילה', 'לילה', 'active', ($1 || ' 23:30 Asia/Jerusalem')::timestamptz)", [d(FAR, 10)]);
  const gone = (await shootOn(d(FAR, 11), 'ארכיון')).rows[0].id;
  assert.ok((await call('owner', 'select public.archive_client($1) as a', [gone])).rows[0].a.archived_at);
  await db.query("insert into public.clients (name, business, status, shoot_at) values ('הסתיים', 'הסתיים', 'ended', ($1 || ' 10:00 Asia/Jerusalem')::timestamptz)", [d(FAR, 12)]);
  const taken = (await q('eli', 'select day::text, n from public.photographer_taken($1::date, $2::date)', [first(FAR), d(FAR, 28)])).rows;
  assert.deepEqual(taken, [{ day: d(FAR, 9), n: 2 }, { day: d(FAR, 10), n: 1 }]);
  assert.match((await q('eli', 'select * from public.photographer_taken($1::date, $2::date)', [first(THIS), d(addMonths(THIS, 6), 1)])).error, /four months/);

  await submit('eli', FAR, [d(FAR, 8), d(FAR, 9), d(FAR, 10)]);
  // Before the 15th a free day comes off freely; a taken one does not.
  assert.equal((await submit('eli', FAR, [d(FAR, 9), d(FAR, 10)])).error, undefined);
  assert.match((await submit('eli', FAR, [d(FAR, 10), d(FAR, 20)])).error, /availability_taken/);
  assert.match((await submit('eli', FAR, [], true)).error, /availability_taken/);
  assert.deepEqual((await monthRow(FAR)).days, [d(FAR, 9), d(FAR, 10)]);
  // Adding is always possible.
  assert.equal((await submit('eli', FAR, [d(FAR, 9), d(FAR, 10), d(FAR, 20)])).error, undefined);
  // In his name the manager is not held (he called; they decide).
  assert.equal((await submit('lior', FAR, [d(FAR, 20)], false, 'eli')).error, undefined);
  assert.deepEqual((await monthRow(FAR)).days, [d(FAR, 20)]);
});

test('after the 15th of the month before, a free day comes off only as an unexpected change; adding stays open', async () => {
  await wipe();
  const all = monthDays(THIS);
  const [a, b, c] = [all.at(-1), all.at(-2), all.at(-3)];
  // A late first hand-over is taken as it is.
  assert.equal((await submit('eli', THIS, [a, b])).error, undefined);
  assert.match((await submit('eli', THIS, [a])).error, /availability_locked/);
  assert.match((await submit('eli', THIS, [], true)).error, /availability_locked/);
  assert.equal((await submit('eli', THIS, [a, b, c])).error, undefined);
  assert.deepEqual((await monthRow(THIS)).days, [c, b, a]);
  // Two months ahead the 15th has not come: it comes off.
  await submit('eli', FAR, [d(FAR, 3), d(FAR, 4)]);
  assert.equal((await submit('eli', FAR, [d(FAR, 4)])).error, undefined);
  assert.deepEqual((await monthRow(FAR)).days, [d(FAR, 4)]);
});

test('the unexpected change: one or two consecutive dates from today on, free or with a shoot day; once a calendar month', async () => {
  await wipe();
  await submit('eli', FAR, [d(FAR, 3), d(FAR, 4), d(FAR, 5), d(FAR, 12), d(FAR, 28)]);
  await shootOn(d(FAR, 4));
  await shootOn(d(FAR, 20));
  // More than 48 hours, or two dates that are not consecutive.
  assert.match((await change('eli', [d(FAR, 3), d(FAR, 4), d(FAR, 5)])).error, /availability_change_span/);
  assert.match((await change('eli', [d(FAR, 3), d(FAR, 5)])).error, /availability_change_span/);
  assert.match((await change('eli', [])).error, /availability_change_span/);
  assert.match((await change('eli', null)).error, /availability_change_span/);
  // A date that passed; a date that is neither free nor has a shoot day; a long note.
  const yesterday = dayKeyIL(new Date(NOW.getTime() - 864e5));
  assert.match((await change('eli', [yesterday])).error, /availability_change_past/);
  assert.match((await change('eli', [d(FAR, 15)])).error, /availability_change_not_free/);
  assert.match((await change('eli', [d(FAR, 12), d(FAR, 13)])).error, /availability_change_not_free/);
  assert.match((await change('eli', [d(FAR, 3)], 'x'.repeat(NOTE_MAX + 1))).error, /300 characters/);
  assert.equal((await db.query('select count(*)::int as n from public.photographer_changes')).rows[0].n, 0);

  // Two consecutive dates, one of them with a shoot day: recorded, and off his free dates.
  const r = await change('eli', [d(FAR, 4), d(FAR, 3)], '  חתונה במשפחה  ');
  assert.equal(r.error, undefined);
  const row = (await db.query('select person, reported_month::text, array(select x::text from unnest(days) x) as days, array(select x::text from unnest(shoot_days) x) as shoot_days, note, by_email, reported_at from public.photographer_changes')).rows[0];
  assert.deepEqual([row.person, row.reported_month, row.days, row.shoot_days, row.note, row.by_email],
    ['eli', first(THIS), [d(FAR, 3), d(FAR, 4)], [d(FAR, 4)], 'חתונה במשפחה', 'eli@astrateg.test']);
  assert.ok(Math.abs(new Date(row.reported_at) - Date.now()) < 60e3);
  assert.deepEqual((await monthRow(FAR)).days, [d(FAR, 5), d(FAR, 12), d(FAR, 28)]);
  // The shoot day itself is not touched: the office moves it.
  assert.deepEqual((await q('lior', 'select day::text, n from public.photographer_taken($1::date, $2::date)', [d(FAR, 4), d(FAR, 4)])).rows, [{ day: d(FAR, 4), n: 1 }]);

  // Once a month: the second one is refused, whatever it names.
  assert.match((await change('eli', [d(FAR, 12)])).error, /availability_change_used/);
  assert.match((await change('eli', [d(FAR, 20)])).error, /availability_change_used/);
  assert.deepEqual((await monthRow(FAR)).days, [d(FAR, 5), d(FAR, 12), d(FAR, 28)]);
  // A new calendar month opens it again (the row of last month stays).
  await db.query("update public.photographer_changes set reported_month = (reported_month - interval '1 month')::date, reported_at = reported_at - interval '31 days' where true");
  // A day with a shoot day that he never marked free can be reported too.
  assert.equal((await change('eli', [d(FAR, 20)])).error, undefined);
  assert.equal((await db.query('select count(*)::int as n from public.photographer_changes')).rows[0].n, 2);
  // He can mark a day free again later (adding is always open), and the managers still see what he reported.
  assert.equal((await submit('eli', FAR, [d(FAR, 3), d(FAR, 5), d(FAR, 12), d(FAR, 28)])).error, undefined);
  assert.equal((await q('irit', 'select id from public.photographer_changes')).rows.length, 2);
  assert.equal((await q('eli', 'select id from public.photographer_changes')).rows.length, 2);
  assert.equal((await q('ilai', 'select id from public.photographer_changes')).rows.length, 0);
});

test('a change across the end of a month takes each date off its own month', async () => {
  await wipe();
  const next = addMonths(FAR, 1);
  const last = monthDays(FAR).at(-1);
  await submit('eli', FAR, [last, d(FAR, 2)]);
  await submit('eli', next, [d(next, 1), d(next, 2)]);
  assert.equal((await change('eli', [last, d(next, 1)])).error, undefined);
  assert.deepEqual((await monthRow(FAR)).days, [d(FAR, 2)]);
  assert.deepEqual((await monthRow(next)).days, [d(next, 2)]);
  assert.ok(TODAY <= last);
});
