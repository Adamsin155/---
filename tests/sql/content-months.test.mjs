// The contents of each month against the contract (22.11.2026; supabase/migrations/20261221100000_content_months.sql)
// in a real Postgres with every migration (tests/sql/pg.mjs): what counts (Metricool's rows of a video,
// a graphic or the monthly photographer's; not a story, not a row nobody scheduled in Metricool, not a
// failed post), one content once (a post per network at the same minute), the first month, and who
// may call it (each person sees only the Gantt rows the table shows them). Invented people and clients.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql } from './pg.mjs';

const MIGRATION = '20261221100000_content_months.sql';
const PEOPLE = { owner: null, irit: 'irit', nadia: 'nadia' };
let db;
const users = {};
const ids = {};
let post = 1000;

async function call(who, sql, params = []) {
  const user = users[who];
  const claims = { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated' };
  try {
    return await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (err) { return { error: err.message }; }
}
async function service(sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query('set local role service_role');
    return { rows: (await tx.query(sql, params)).rows };
  });
}
// A Gantt row as the sync writes it (the trigger keeps the sync's columns only inside its flag).
async function row(client, { kind = 'video', day, time = '12:00', state = 'posted', nets = ['instagram', 'facebook'], mc = true }) {
  post += 1;
  await db.transaction(async (tx) => {
    await tx.query("select set_config('astrateg.gantt_sync', '1', true)");
    await tx.query(`insert into public.client_gantt (client_id, key, kind, title, day, time_il, state, source, mc_post_id, mc_status, mc_networks)
      values ($1, $2, $3, 'x', $4, $5, $6, 'metricool', $7, $8, $9)`,
    [client, `custom.${post}`, kind, day, time, state, mc ? String(post) : null, mc ? (state === 'posted' ? 'published' : state === 'error' ? 'error' : 'pending') : null, nets]);
  });
}

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
  for (const k of ['a', 'b', 'c']) {
    const { rows } = await db.query("insert into public.clients (name, business, status) values ($1, $1, 'active') returning id", [k]);
    ids[k] = rows[0].id;
  }
  await db.exec(migrationSql(MIGRATION));
  // Client a: October 2 videos went up; November: one content split per network (counts once),
  // two posts to Instagram at the same minute (two), a scheduled graphic, a failed post, a story,
  // and a planned row from Drive with no Metricool post (none of the last three count).
  await row(ids.a, { day: '2026-09-28', state: 'posted' });
  await row(ids.a, { day: '2026-10-05', state: 'posted' });
  await row(ids.a, { day: '2026-10-12', state: 'posted' });
  await row(ids.a, { day: '2026-11-03', nets: ['instagram', 'facebook'] });
  await row(ids.a, { day: '2026-11-03', nets: ['tiktok'] });
  await row(ids.a, { day: '2026-11-10', time: '18:00', nets: ['instagram'] });
  await row(ids.a, { day: '2026-11-10', time: '18:00', nets: ['instagram'] });
  await row(ids.a, { day: '2026-11-24', kind: 'graphic', state: 'scheduled' });
  await row(ids.a, { day: '2026-11-25', state: 'error' });
  await row(ids.a, { day: '2026-11-26', kind: 'story' });
  await row(ids.a, { day: '2026-11-27', state: 'planned', mc: false, nets: null });
  await row(ids.a, { day: '2026-12-01', kind: 'monthly', state: 'scheduled', nets: [] });
  // Client b: content only in August (outside the range): one row with no month.
  await row(ids.b, { day: '2026-08-10' });
});

test('the file only adds and runs again', async () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/\bdelete\b|\btruncate\b|drop table|drop function/gi), null);
  await db.exec(migrationSql(MIGRATION));
});

test('the count: one content once, only Metricool\'s posts of the counted kinds', async () => {
  const { rows } = await service("select * from public.content_months('2026-10', '2026-12')");
  const a = rows.filter((r) => r.client_id === ids.a).map((r) => [r.first_month, r.month, r.posted, r.planned]);
  assert.deepEqual(a, [
    ['2026-09', '2026-10', 2, 2],
    ['2026-09', '2026-11', 3, 4],
    ['2026-09', '2026-12', 0, 1],
  ]);
  const b = rows.filter((r) => r.client_id === ids.b).map((r) => [r.first_month, r.month, r.posted, r.planned]);
  assert.deepEqual(b, [['2026-08', null, 0, 0]]);
  assert.equal(rows.some((r) => r.client_id === ids.c), false, 'no content at all: no row');
});

test('one client only', async () => {
  const { rows } = await service("select * from public.content_months('2026-11', '2026-11', $1)", [ids.b]);
  assert.deepEqual(rows.map((r) => r.month), [null]);
});

test('from a page: the office counts; someone who sees no client\'s Gantt gets nothing; not anonymous', async () => {
  const office = await call('irit', "select * from public.content_months('2026-10', '2026-12')");
  assert.equal(office.rows.filter((r) => r.client_id === ids.a).length, 3);
  assert.deepEqual((await call('nadia', "select * from public.content_months('2026-10', '2026-12')")).rows, []);
  const anon = await db.transaction(async (tx) => {
    await tx.query('set local role anon');
    try { await tx.query("select * from public.content_months('2026-10', '2026-12')"); return null; } catch (e) { return e.message; }
  });
  assert.match(anon, /permission denied/);
});
