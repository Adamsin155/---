// The personal calendar feeds (supabase/migrations/20260930200000_calendar_feeds.sql)
// in a real Postgres (PGlite, tests/sql/pg.mjs): a link is made and replaced only by
// its own confirmed staff login, the database keeps only the token's SHA-256, the
// check is the service role's alone and knows a token only while it is current,
// the owner alone sees who connected (never a token), and removing someone from
// the staff removes their link.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { freshDatabase, as } from './pg.mjs';

let db;
const users = {};
const q = (who, sql, params = []) => as(db, users[who], async (tx) => (await tx.query(sql, params)).rows);
async function asRole(role, fn) {
  let out;
  await db.transaction(async (tx) => {
    await tx.query(`set local role ${role}`);
    try { out = await fn(tx); } catch (err) { out = { error: err.message }; }
    await tx.rollback();
  });
  return out;
}
// Committed (the helpers above roll back): makes a link as someone.
async function rotate(who) {
  await db.query('set role authenticated');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: users[who].id, email: users[who].email, role: 'authenticated' })]);
  try {
    return (await db.query('select public.calendar_feed_rotate() as t')).rows[0].t;
  } finally {
    await db.query('reset role');
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}
const check = (token) => asRole('service_role', async (tx) => (await tx.query('select * from public.calendar_feed_check($1)', [token])).rows);
const sha = (t) => createHash('sha256').update(t).digest('hex');

before(async () => {
  db = await freshDatabase();
  for (const [key, person, confirmed] of [['owner', null, true], ['lior', 'lior', true], ['nadia', 'nadia', true], ['eli', 'eli', true], ['unconfirmed', 'yariv', false]]) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query(`insert into auth.users (email, email_confirmed_at) values ($1, ${confirmed ? 'now()' : 'null'}) returning id`, [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
  users.stranger = { id: '00000000-0000-4000-8000-00000000abcd', email: 'stranger@example.com' };
});

test('a link is made by its own confirmed staff login; the database keeps only its SHA-256', async () => {
  const token = await rotate('nadia');
  assert.match(token, /^[0-9a-f]{64}$/);
  const [row] = (await db.query("select * from public.calendar_feeds where email = 'nadia@astrateg.test'")).rows;
  assert.equal(row.token_hash, sha(token));
  assert.ok(!JSON.stringify(row).includes(token));
  // Not staff, not confirmed, or not signed in: no link.
  for (const who of ['stranger', 'unconfirmed']) assert.match((await q(who, 'select public.calendar_feed_rotate()')).error || '', /not allowed/, who);
  assert.match((await as(db, null, async (tx) => (await tx.query('select public.calendar_feed_rotate()')).rows)).error || '', /permission denied/);
  // My status: connected, with no token or hash in it.
  const [st] = await q('nadia', 'select * from public.calendar_feed_status()');
  assert.equal(st.connected, true);
  assert.deepEqual(Object.keys(st).sort(), ['connected', 'created_at', 'fetch_count', 'last_fetch_at']);
  assert.deepEqual(await q('lior', 'select * from public.calendar_feed_status()'), []);
});

test('nobody reads or writes the table directly', async () => {
  for (const who of ['owner', 'nadia']) {
    assert.match((await q(who, 'select * from public.calendar_feeds')).error || '', /permission denied/, who);
    assert.match((await q(who, "update public.calendar_feeds set token_hash = repeat('0', 64)")).error || '', /permission denied/, who);
  }
  assert.match((await as(db, null, async (tx) => (await tx.query('select * from public.calendar_feeds')).rows)).error || '', /permission denied/);
  // Every function of the migration pins its search path.
  const loose = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'calendar\\_feed%' and not ('search_path=""' = any(coalesce(p.proconfig, '{}')))`)).rows;
  assert.deepEqual(loose, []);
});

test('the check: service role only; a current token opens its owner\'s feed, a replaced or wrong one nothing', async () => {
  const first = await rotate('eli');
  for (const who of ['owner', 'eli']) assert.match((await q(who, 'select * from public.calendar_feed_check($1)', [first])).error || '', /permission denied/, who);
  assert.match((await as(db, null, async (tx) => (await tx.query('select * from public.calendar_feed_check($1)', [first])).rows)).error || '', /permission denied/);
  assert.deepEqual(await check(first), [{ email: 'eli@astrateg.test', person: 'eli' }]);
  // Upper case, too short, not hex, empty: nothing.
  for (const bad of [first.toUpperCase(), first.slice(1), `${first.slice(1)}g`, '', null]) assert.deepEqual(await check(bad), [], String(bad));
  // A new link: the old one stops at once.
  const second = await rotate('eli');
  assert.notEqual(second, first);
  assert.deepEqual(await check(first), []);
  assert.deepEqual(await check(second), [{ email: 'eli@astrateg.test', person: 'eli' }]);
  // The owner's feed is the owner's (no person).
  const own = await rotate('owner');
  assert.deepEqual(await check(own), [{ email: 'owner@astrateg.test', person: null }]);
});

test('the check records the last read, at most once a minute', async () => {
  const token = await rotate('lior');
  await db.query('set role service_role');
  try {
    await db.query('select * from public.calendar_feed_check($1)', [token]);
    await db.query('select * from public.calendar_feed_check($1)', [token]);
  } finally { await db.query('reset role'); }
  const [row] = (await db.query("select last_fetch_at, fetch_count from public.calendar_feeds where email = 'lior@astrateg.test'")).rows;
  assert.ok(row.last_fetch_at);
  assert.equal(row.fetch_count, 1);
});

test('disconnect, and the owner\'s view of who connected (never a token)', async () => {
  const token = await rotate('nadia');
  const team = await q('owner', 'select * from public.calendar_feeds_team()');
  assert.deepEqual(team.map((r) => r.email).sort(), ['eli@astrateg.test', 'lior@astrateg.test', 'nadia@astrateg.test', 'owner@astrateg.test']);
  assert.deepEqual(Object.keys(team[0]).sort(), ['created_at', 'email', 'last_fetch_at', 'person']);
  assert.ok(!JSON.stringify(team).includes(token) && !JSON.stringify(team).includes(sha(token)));
  // Lior and an editor see nobody's.
  assert.deepEqual(await q('lior', 'select * from public.calendar_feeds_team()'), []);
  assert.deepEqual(await q('nadia', 'select * from public.calendar_feeds_team()'), []);
  // Disconnecting (committed here) stops the link.
  await db.query('set role authenticated');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: users.nadia.id, email: users.nadia.email, role: 'authenticated' })]);
  try {
    assert.equal((await db.query('select public.calendar_feed_revoke() as ok')).rows[0].ok, true);
  } finally {
    await db.query('reset role');
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
  assert.deepEqual(await check(token), []);
  assert.deepEqual(await q('nadia', 'select * from public.calendar_feed_status()'), []);
});

test('removing someone from the staff removes their link', async () => {
  const token = await rotate('eli');
  assert.equal((await check(token)).length, 1);
  await db.query("delete from public.staff where email = 'eli@astrateg.test'");
  assert.deepEqual(await check(token), []);
  assert.equal((await db.query("select count(*)::int as n from public.calendar_feeds where email = 'eli@astrateg.test'")).rows[0].n, 0);
});
