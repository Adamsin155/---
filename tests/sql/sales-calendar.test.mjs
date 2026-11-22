// supabase/migrations/20261222100000_sales_shoot_days.sql in a real Postgres with every
// migration (tests/sql/pg.mjs): the field sales of SALES_CALENDAR (Stav) see which days are
// taken by shoot days, as dates and a count, and nothing of a client (Lior's request, approved
// by the owner on 22.11.2026; docs/ops.md, section 146).
//   - the file only adds (none of the three words the production tool refuses) and runs twice;
//   - every shoot of an active or ending client counts once, its main one and every round's,
//     whoever films it; two on one day count 2; an archived or an ended client's does not;
//   - Stav and the owners get it; Amos (not in the list), an editor, Eli and anon do not;
//   - Stav still reads no client row, no name, through the API; the answer has no name in it;
//   - the app's list is the database's.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql } from './pg.mjs';
import { SALES_CALENDAR } from '../../app/protocol.js';

const FILE = '20261222100000_sales_shoot_days.sql';
const PEOPLE = { owner: null, irit: 'irit', stav: 'stav', amos: 'amos', nadia: 'nadia', eli: 'eli' };
let db;
const users = {};

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
// A month far enough ahead, in Israel days.
const Y = new Date().getUTCFullYear() + 1;
const d = (n) => `${Y}-03-${String(n).padStart(2, '0')}`;
const at = (day, time = '10:00') => `${day}T${time}:00+02:00`;
const CLIENTS = [
  { name: 'לקוח עם נטלי', status: 'active', shoot_type: 'natali', shoot_at: at(d(3)) },
  { name: 'עוד לקוח עם נטלי', status: 'active', shoot_type: 'natali', shoot_at: at(d(3), '13:00') },
  { name: 'בלי משפיענים, אליאל', status: 'ending', shoot_type: null, shoot_at: at(d(4)), deliverables: { shoot_crew: 'eliel' } },
  { name: 'סבבים', status: 'active', shoot_type: 'dms', shoot_at: null,
    rounds: [{ n: 2, shoot_at: at(d(9)) }, { n: 3, shoot_type: null, shoot_crew: 'eliel', shoot_at: at(d(10)) }] },
  // Late in the evening is still that Israel day (21:30 on the 11th is the 11th, not the 12th in UTC terms).
  { name: 'ערב', status: 'active', shoot_type: 'dms', shoot_at: `${d(11)}T21:30:00+02:00` },
  { name: 'בארכיון', status: 'active', shoot_type: 'natali', shoot_at: at(d(16)), archived: true },
  { name: 'הסתיים', status: 'ended', shoot_type: 'natali', shoot_at: at(d(17)) },
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
    await db.query(`insert into public.clients (name, business, status, shoot_type, shoot_at, deliverables, rounds)
      values ($1, $1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [c.name, c.status, c.shoot_type, c.shoot_at, JSON.stringify(c.deliverables || {}), JSON.stringify(c.rounds || [])]);
    // Archived the way archive_client() does it (its flag lets the guard trigger through).
    if (c.archived) {
      await db.transaction(async (tx) => {
        await tx.query("select set_config('astrateg.archiving', 'on', true)");
        await tx.query('update public.clients set archived_at = now() where name = $1', [c.name]);
      });
    }
  }
});

const MONTH = [d(1), d(31)];
const days = (who, range = MONTH) => call(who, 'select day::text, n from public.sales_shoot_days($1::date, $2::date)', range);

test('the file only adds, and runs twice', async () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
});

test("Stav: every shoot day once, whoever films it; two on a day are 2; no archived or ended client's", async () => {
  const r = await days('stav');
  assert.equal(r.error, undefined);
  assert.deepEqual(r.rows, [
    { day: d(3), n: 2 }, { day: d(4), n: 1 }, { day: d(9), n: 1 }, { day: d(10), n: 1 }, { day: d(11), n: 1 },
  ]);
  // The owners read the same.
  assert.deepEqual((await days('owner')).rows, r.rows);
});

test('the answer is dates and a count only: no name, no hour, no client', async () => {
  const cols = await call('stav', 'select * from public.sales_shoot_days($1::date, $2::date)', MONTH);
  assert.deepEqual(Object.keys(cols.rows[0]).sort(), ['day', 'n']);
  const r = await days('stav');
  const text = JSON.stringify(r.rows);
  for (const c of CLIENTS) assert.ok(!text.includes(c.name), c.name);
  assert.ok(!/10:00|13:00|21:30|T\d\d:/.test(text));
});

test('nobody else: Amos (not in the list), an editor, Eli, Irit and anon are refused', async () => {
  for (const who of ['amos', 'nadia', 'eli', 'irit']) assert.match((await days(who)).error || '', /not allowed/, who);
  assert.match((await days(null)).error || '', /not allowed|permission denied/);
});

test('up to four months at a time', async () => {
  assert.match((await days('stav', [`${Y}-01-01`, `${Y}-06-30`])).error || '', /four months/);
  assert.match((await days('stav', [d(20), d(1)])).error || '', /four months/);
});

test('Stav still reads no client through the API: no row, no name', async () => {
  for (const sql of ['select name, business from public.clients', 'select id from public.clients where shoot_at is not null']) {
    const r = await call('stav', sql);
    assert.ok(r.error || r.rows.length === 0, sql);
  }
  // The availability functions of the office stay closed to her.
  assert.match((await call('stav', 'select * from public.photographer_taken($1::date, $2::date)', MONTH)).error || '', /not allowed/);
});

test("the app's list is the database's", async () => {
  assert.deepEqual((await db.query('select public.sales_calendar_people() as p')).rows[0].p, SALES_CALENDAR);
});
