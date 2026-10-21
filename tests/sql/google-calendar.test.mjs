// Google Calendar → the system (20261029100000_google_calendar_sync.sql; the owner,
// 21.10.2026), in a real Postgres (PGlite, every migration applied):
//   - a member of staff saves their own secret address (Google's only); nobody, not even
//     they, reads it back: status only; anon nothing;
//   - each person reads their own events only, never another's; nobody writes them;
//   - the edge function's two helpers are the service role's only; a reading upserts,
//     marks what left the feed gone (hidden, kept), and keeps "לא קשור";
//   - disconnecting forgets the address and hides the events;
//   - the clock calls the function only while someone is connected and the secret is in Vault;
//   - the file has none of the three words the production tool refuses, and runs twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql } from './pg.mjs';

const FILE = '20261029100000_google_calendar_sync.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', nadia: 'nadia' };
const URL_IRIT = 'https://calendar.google.com/calendar/ical/irit%40gmail.com/private-0123456789abcdef0123456789abcdef/basic.ics';
const URL_LIOR = 'https://calendar.google.com/calendar/ical/lior%40gmail.com/private-fedcba9876543210/basic.ics';
let db;
const users = {};

const run = (who, sql, params = []) => as(db, who ? users[who] : null, async (tx) => (await tx.query(sql, params)).rows);
// As a signed-in person, kept (the row must outlive the call).
async function keep(who, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users[who].id, email: users[who].email, role: 'authenticated' })]);
    return (await tx.query(sql, params)).rows;
  });
}
async function service(sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query('set local role service_role');
    return (await tx.query(sql, params)).rows;
  });
}
const apply = (email, rows, ok = true, error = null) => service('select public.google_calendar_apply($1, $2::jsonb, $3, $4) as r', [email, JSON.stringify(rows), ok, error]).then((r) => r[0].r);
const row = (uid, fields = {}) => ({ uid, starts_at: '2026-11-05T08:00:00.000Z', ends_at: '2026-11-05T10:00:00.000Z', all_day: false, summary: `אירוע ${uid}`, location: '', client_id: null, kind_guess: null, ...fields });

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  users.stranger = { id: '00000000-0000-4000-8000-0000000000ff', email: 'stranger@example.com' };
});

test('the file: none of the three words the production tool refuses, and it runs twice', async () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  await db.exec(migrationSql(FILE));
});

test('connecting: my own address, Google\'s secret one only; status never returns it', async () => {
  for (const bad of ['https://evil.com/x.ics', 'http://calendar.google.com/calendar/ical/a%40b.com/private-12345678/basic.ics', `${URL_IRIT}?x`, '']) {
    assert.match((await run('irit', 'select public.google_calendar_connect($1)', [bad])).error || '', /bad_url/, bad);
  }
  const st = (await keep('irit', 'select public.google_calendar_connect($1) as s', [`  ${URL_IRIT} `]))[0].s;
  assert.equal(st.connected, true);
  assert.ok(st.since);
  assert.equal(st.readAt, null);
  assert.ok(!JSON.stringify(st).includes('private-'), 'the status has no address');
  await keep('lior', 'select public.google_calendar_connect($1)', [URL_LIOR]);
  assert.equal((await run('nadia', 'select public.google_calendar_status() as s'))[0].s.connected, false);
  // Nobody reads the table of addresses, the owner neither; anon and a stranger can do nothing.
  for (const who of ['irit', 'owner', 'nadia', null]) {
    assert.match((await run(who, 'select url from private.google_calendar_links')).error || '', /permission denied/, String(who));
  }
  assert.match((await run(null, 'select public.google_calendar_status()')).error || '', /permission denied/);
  assert.match((await run(null, 'select public.google_calendar_connect($1)', [URL_IRIT])).error || '', /permission denied/);
  assert.match((await run('stranger', 'select public.google_calendar_connect($1)', [URL_IRIT])).error || '', /not allowed/);
  assert.equal((await run('stranger', 'select public.google_calendar_status() as s'))[0].s, null);
  const stored = await db.query('select email, url from private.google_calendar_links order by email');
  assert.deepEqual(stored.rows, [{ email: 'irit@astrateg.test', url: URL_IRIT }, { email: 'lior@astrateg.test', url: URL_LIOR }]);
});

test('the edge function\'s helpers are the service role\'s only', async () => {
  for (const who of ['irit', 'owner', null]) {
    assert.match((await run(who, 'select * from public.google_calendar_feeds()')).error || '', /permission denied/, String(who));
    assert.match((await run(who, "select public.google_calendar_apply('irit@astrateg.test', '[]'::jsonb, true)")).error || '', /permission denied/, String(who));
    assert.match((await run(who, 'select public.google_calendar_tick()')).error || '', /permission denied/, String(who));
  }
  const feeds = await service('select * from public.google_calendar_feeds()');
  assert.deepEqual(feeds.map((f) => f.email).sort(), ['irit@astrateg.test', 'lior@astrateg.test']);
});

test('a reading: my events only, to me; what left the feed is hidden; "לא קשור" is kept', async () => {
  const client = (await db.query("insert into public.clients (name, business, shoot_type, status, deal_at, contract_end, created_by_email) values ('דנה', 'קפה דנה', 'dms', 'active', now(), '2027-10-01', 'system') returning id")).rows[0].id;
  let r = await apply('irit@astrateg.test', [row('a', { client_id: client, kind_guess: 'char', summary: 'פגישת אפיון קפה דנה' }), row('b'), row('b'), row('c', { client_id: 'not-a-uuid', kind_guess: 'zoom' })]);
  assert.deepEqual(r, { ok: true, events: 3, gone: 0 });
  await apply('lior@astrateg.test', [row('l1')]);
  const mine = await run('irit', 'select uid, client_id, kind_guess, summary from public.calendar_external_events order by uid');
  assert.deepEqual(mine.map((x) => x.uid), ['a', 'b', 'c']);
  assert.equal(mine[0].client_id, client);
  assert.equal(mine[2].client_id, null);
  assert.equal(mine[2].kind_guess, null);
  assert.deepEqual((await run('lior', 'select uid from public.calendar_external_events')).map((x) => x.uid), ['l1']);
  assert.deepEqual(await run('owner', 'select uid from public.calendar_external_events'), [], 'the owner sees nobody else\'s');
  assert.deepEqual(await run('nadia', 'select uid from public.calendar_external_events'), []);
  assert.match((await run(null, 'select uid from public.calendar_external_events')).error || '', /permission denied/);
  // Nobody writes from a browser.
  assert.match((await run('irit', "insert into public.calendar_external_events (email, uid, starts_at) values ('irit@astrateg.test', 'x', now())")).error || '', /permission denied/);
  assert.match((await run('irit', "update public.calendar_external_events set summary = 'x'")).error || '', /permission denied/);
  // "לא קשור": mine only.
  assert.equal((await keep('lior', "select public.google_calendar_dismiss('a') as ok"))[0].ok, false);
  assert.equal((await keep('irit', "select public.google_calendar_dismiss('a') as ok"))[0].ok, true);
  // The next reading: b left the feed (hidden, kept), a is still there and still dismissed.
  r = await apply('irit@astrateg.test', [row('a', { client_id: client, kind_guess: 'char', starts_at: '2026-11-06T08:00:00.000Z' }), row('c')]);
  assert.deepEqual(r, { ok: true, events: 2, gone: 1 });
  const now = await run('irit', 'select uid, starts_at, dismissed_at from public.calendar_external_events order by uid');
  assert.deepEqual(now.map((x) => x.uid), ['a', 'c']);
  assert.ok(now[0].dismissed_at);
  assert.equal(new Date(now[0].starts_at).toISOString(), '2026-11-06T08:00:00.000Z');
  assert.equal((await db.query("select count(*)::int as n from public.calendar_external_events where email = 'irit@astrateg.test'")).rows[0].n, 3);
  // b comes back: shown again.
  await apply('irit@astrateg.test', [row('a'), row('b'), row('c')]);
  assert.equal((await run('irit', 'select uid from public.calendar_external_events')).length, 3);
  // A failed reading keeps the rows and records a short code.
  assert.deepEqual(await apply('irit@astrateg.test', null, false, 'timeout'), { ok: false });
  const st = (await run('irit', 'select public.google_calendar_status() as s'))[0].s;
  assert.equal(st.error, 'timeout');
  assert.equal(st.events, 3);
  assert.equal((await run('irit', 'select uid from public.calendar_external_events')).length, 3);
  await apply('irit@astrateg.test', [row('a'), row('b'), row('c')]);
  const ok = (await run('irit', 'select public.google_calendar_status() as s'))[0].s;
  assert.equal(ok.error, null);
  assert.ok(ok.readAt);
  // Someone not connected: nothing is written.
  assert.deepEqual(await apply('nadia@astrateg.test', [row('n')]), { skipped: true });
});

test('disconnecting: the address is forgotten and my events are hidden; reconnecting shows them on the next reading', async () => {
  const st = (await keep('irit', 'select public.google_calendar_disconnect() as s'))[0].s;
  assert.deepEqual(st, { connected: false });
  assert.equal((await db.query("select url from private.google_calendar_links where email = 'irit@astrateg.test'")).rows[0].url, null);
  assert.deepEqual(await run('irit', 'select uid from public.calendar_external_events'), []);
  assert.deepEqual((await service('select email from public.google_calendar_feeds()')).map((f) => f.email), ['lior@astrateg.test']);
  assert.deepEqual(await apply('irit@astrateg.test', [row('a')]), { skipped: true });
  await keep('irit', 'select public.google_calendar_connect($1)', [URL_IRIT]);
  await apply('irit@astrateg.test', [row('a')]);
  const back = await run('irit', 'select uid, dismissed_at from public.calendar_external_events');
  assert.equal(back.length, 1);
  assert.ok(back[0].dismissed_at, '"לא קשור" is remembered');
});

test('the clock: every 15 minutes, the function with the cron secret, only while someone is connected', async () => {
  const job = (await db.query("select schedule, command from cron.job where jobname = 'google-calendar-sync'")).rows;
  assert.deepEqual(job, [{ schedule: '7,22,37,52 * * * *', command: 'select public.google_calendar_tick()' }]);
  // No secret in Vault: nothing is called.
  const before = (await db.query('select count(*)::int as n from net.calls')).rows[0].n;
  assert.equal((await db.query('select public.google_calendar_tick() as r')).rows[0].r, null);
  await db.query("select vault.create_secret('s3cret-cron', 'reminders_cron_secret')");
  const id = (await db.query('select public.google_calendar_tick() as r')).rows[0].r;
  assert.ok(id);
  const call = (await db.query('select url, body, headers from net.calls where id = $1', [id])).rows[0];
  assert.equal(call.url, 'https://czncjzziqrqtezpwxxpz.supabase.co/functions/v1/calendar');
  assert.deepEqual(call.body, { action: 'google' });
  assert.equal(call.headers['x-cron-secret'], 's3cret-cron');
  // Nobody connected: nothing.
  await keep('irit', 'select public.google_calendar_disconnect()');
  await keep('lior', 'select public.google_calendar_disconnect()');
  assert.equal((await db.query('select public.google_calendar_tick() as r')).rows[0].r, null);
  assert.equal((await db.query('select count(*)::int as n from net.calls')).rows[0].n, before + 1);
});
