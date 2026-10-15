// The personal link to the taking-in, with no sign-in (20261027100000_landing_links.sql;
// the owner, 15.10.2026), in a real Postgres (PGlite, every migration applied):
//   - only the owners make, list and take back links; never for sales or the owners;
//   - a link reads that person's screen only: their clients in landing, no phone, notes,
//     money, links or emails; a malformed, unknown, taken-back or expired token reads nothing;
//   - through a link one answers that person's items only, on their clients in landing,
//     stamped with that person's email; a newer link ends the older one;
//   - "סיימתי" through the link activates the client when nobody else is left, as landing_take;
//   - the file has none of the three words the production tool refuses, and runs twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql } from './pg.mjs';

const FILE = '20261027100000_landing_links.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ilai: 'ilai', nadia: 'nadia', anna: 'anna', stav: 'stav' };
const DENIED = /permission denied|not allowed|owner only/i;
let db;
const users = {};
const ids = {};

const run = (who, sql, params = []) => as(db, who ? users[who] : null, async (tx) => (await tx.query(sql, params)).rows);
// As the owner, kept (a link must outlive the call that made it).
async function make(person) {
  return db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users.owner.id, email: users.owner.email, role: 'authenticated' })]);
    return (await tx.query('select public.landing_link_make($1) as t', [person])).rows[0].t;
  });
}
const read = (token, who = null) => run(who, 'select public.landing_link_read($1) as r', [token]);
const take = (token, id, marks = {}, done = null, waiting = null) => run(null, 'select public.landing_link_take($1, $2, $3::jsonb, $4, $5) as r', [token, id, JSON.stringify(marks), done, waiting]);
async function takeKeep(token, id, marks = {}, done = null, waiting = null) {
  return db.transaction(async (tx) => {
    await tx.query('set local role anon');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'anon' })]);
    return (await tx.query('select public.landing_link_take($1, $2, $3::jsonb, $4, $5) as r', [token, id, JSON.stringify(marks), done, waiting])).rows[0].r;
  });
}

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  const add = async (name, editor, landing) => (await db.query(
    "insert into public.clients (name, business, shoot_type, editor, status, deal_at, shoot_at, contract_end, landing, phone, notes, created_by_email) values ($1, $1, 'dms', $2, 'active', '2026-05-10 07:00+00', '2026-06-20 06:00+00', '2027-05-10', $3, '050-0000000', 'סוד', 'system') returning id",
    [name, editor, landing])).rows[0].id;
  ids.a = await add('קפה דנה', 'nadia', true);
  ids.b = await add('מוסך הצפון', 'anna', true);
  ids.fresh = await add('לקוח פעיל', 'nadia', false);
});

test('the file: none of the three words the production tool refuses, and it runs twice', async () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  await db.exec(migrationSql(FILE));
});

test('only the owners make, list and take back links; never for sales, the owners or nobody', async () => {
  for (const who of ['irit', 'lior', 'nadia', 'stav', null]) {
    const r = await run(who, "select public.landing_link_make('lior')");
    assert.match(r.error || '', who ? DENIED : /permission denied/, String(who));
    assert.match((await run(who, 'select public.landing_links()')).error || '', who ? DENIED : /permission denied/, String(who));
    assert.match((await run(who, "select public.landing_link_revoke('lior')")).error || '', who ? DENIED : /permission denied/, String(who));
  }
  for (const p of ['stav', 'owner', 'nobody', null]) {
    const r = await run('owner', 'select public.landing_link_make($1)', [p]);
    assert.match(r.error || '', /no such person/, String(p));
  }
  const t = await make('lior');
  assert.match(t, /^[0-9a-f]{64}$/);
  const list = (await run('owner', 'select public.landing_links() as l'))[0].l;
  assert.deepEqual(list.map((l) => l.person), ['lior']);
  // Only the hash is kept, and nobody reads the table from the browser.
  assert.equal((await db.query('select count(*)::int as n from private.landing_links where token_hash = $1', [t])).rows[0].n, 0);
  for (const who of ['owner', 'irit', null]) assert.match((await run(who, 'select * from private.landing_links')).error || '', /permission denied/);
});

test("a link reads that person's screen only, with nothing private", async () => {
  const nadia = await make('nadia');
  const [{ r }] = await read(nadia);
  assert.equal(r.person, 'nadia');
  assert.deepEqual(r.clients.map((c) => c.business), ['קפה דנה']); // her client in landing; not Anna's, not the active one
  const keys = Object.keys(r.clients[0]);
  for (const k of ['phone', 'notes', 'address', 'links', 'quote_id', 'created_by_email', 'closed_reason']) assert.ok(!keys.includes(k), k);
  assert.ok(JSON.stringify(r).indexOf('050-0000000') < 0 && JSON.stringify(r).indexOf('סוד') < 0);
  // The office sees every client in landing.
  const lior = await make('lior');
  assert.deepEqual((await read(lior))[0].r.clients.map((c) => c.business).sort(), ['מוסך הצפון', 'קפה דנה']);
  // Signed in or not, the token decides.
  assert.equal((await read(nadia, 'stav'))[0].r.person, 'nadia');
});

test('a malformed, unknown, taken-back or expired token reads and writes nothing; a newer link ends the older', async () => {
  for (const bad of [null, '', 'x', 'g'.repeat(64), '0'.repeat(64), `${'a'.repeat(63)}'`]) {
    assert.match((await read(bad)).error || '', /link not valid/, String(bad));
    assert.match((await take(bad, ids.a, { 'p22.missing': 'done' })).error || '', /link not valid/, String(bad));
  }
  const old = await make('anna');
  const fresh = await make('anna');
  assert.match((await read(old)).error || '', /link not valid/);
  assert.equal((await read(fresh))[0].r.person, 'anna');
  await run('owner', "select public.landing_link_revoke('anna')").then(() => db.query("update private.landing_links set revoked_at = now() where person = 'anna'"));
  assert.match((await read(fresh)).error || '', /link not valid/);
  const late = await make('ilai');
  await db.query("update private.landing_links set expires_at = now() - interval '1 minute' where person = 'ilai' and revoked_at is null");
  assert.match((await read(late)).error || '', /link not valid/);
});

test("through a link: that person's items only, on their clients in landing, stamped with their email", async () => {
  const nadia = await make('nadia');
  assert.deepEqual((await take(nadia, ids.a, { 'p22.missing': 'done' }))[0].r, { landing: true });
  assert.match((await take(nadia, ids.a, { 'p28.scheduled': 'done' })).error || '', /not your item/); // Ilai's
  assert.match((await take(nadia, ids.b, { 'p22.missing': 'done' })).error || '', /not allowed/); // Anna's client
  assert.match((await take(nadia, ids.fresh, { 'p22.missing': 'done' })).error || '', /not in landing/);
  assert.match((await take(nadia, ids.a, { 'p22.missing': 'maybe' })).error || '', /bad choice/);
  for (const key of ['p22.claim', 'p07.wait', 'not-a-key']) assert.match((await take(nadia, ids.a, { [key]: 'done' })).error || '', /bad item/, key);
  await takeKeep(nadia, ids.a, { 'p22.missing': 'done' });
  const row = (await db.query("select choice, person, by_email from public.client_landing_marks where client_id = $1 and item_key = 'p22.missing'", [ids.a])).rows[0];
  assert.deepEqual(row, { choice: 'done', person: 'nadia', by_email: 'nadia@astrateg.test' });
  // No protocol mark is written by the taking-in.
  assert.equal((await db.query("select count(*)::int as n from public.protocol_checks where client_id = $1 and item_key = 'p22.missing'", [ids.a])).rows[0].n, 0);
  const used = (await db.query("select uses, last_used_at is not null as seen from private.landing_links where person = 'nadia' and revoked_at is null")).rows[0];
  assert.ok(used.seen && used.uses >= 1);
});

test('"סיימתי" through the link activates the client when nobody else is left', async () => {
  const anna = await make('anna');
  const r = await takeKeep(anna, ids.b, {}, true, []);
  assert.deepEqual(r, { landing: false });
  assert.equal((await db.query('select landing from public.clients where id = $1', [ids.b])).rows[0].landing, false);
  assert.equal((await db.query("select done from public.client_landing_done where client_id = $1 and person = 'anna'", [ids.b])).rows[0].done, true);
  // After the activation the link has nothing more there.
  assert.deepEqual((await read(anna))[0].r.clients, []);
});
