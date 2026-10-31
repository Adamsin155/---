// supabase/migrations/20261122100000_deal_pool.sql in a real Postgres with every migration
// (tests/sql/pg.mjs; docs/ops.md, section 85):
//   - the file is the newest, only adds, and runs twice;
//   - Ofir reads the deals; Lior, Ilai and the editors still do not;
//   - of Irit and Ofir whoever takes first holds it, also when both call deal_take; the other
//     can no longer move it, link it or take it over; nobody moves a deal that nobody took;
//   - the browser cannot write who took it or when; the seller cannot take his own deal;
//   - the owners hand it over, Irit and Ofir cannot; the client's signature always passes;
//   - the new columns are saved, "הנחה חריגה" above the old limit included.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql, migrationFiles } from './pg.mjs';

const FILE = '20261122100000_deal_pool.sql';
const SQL = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', stav: 'stav' };
let db;
const users = {};

// Committed calls, as PostgREST makes them.
async function call(who, sql, params = []) {
  const user = who === 'anon' ? null : users[who];
  const role = user ? 'authenticated' : 'anon';
  const claims = user ? { sub: user.id, email: user.email, role, aud: 'authenticated' } : { role };
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      const r = await tx.query(sql, params);
      return { rows: r.rows, affected: r.affectedRows };
    });
  } catch (err) {
    return { error: err.message };
  }
}
const newDeal = async (extra = '') => {
  const r = await call('stav', `insert into public.deal_requests (business_name, contact_name, phone, tier, influencer ${extra ? ', company_id, business_address, special_discount_agorot' : ''})
    values ('פיצה רון', 'רון', '050-7654321', 'social', 'natali' ${extra}) returning *`);
  assert.equal(r.error, undefined, r.error);
  return r.rows[0];
};
const take = (who, id) => call(who, 'select public.deal_take($1) as r', [id]);
const row = async (id) => (await db.query('select * from public.deal_requests where id = $1', [id])).rows[0];

before(async () => {
  db = await freshDatabase({ upTo: FILE });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
});

test('the file: the newest, only adds, and runs twice', async () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261123100000_old_income.sql']);
  assert.doesNotMatch(SQL, /\b(drop|delete|truncate)\b/i);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
});

test('Ofir reads the deals; Lior, Ilai and the editors still do not', async () => {
  const d = await newDeal();
  for (const who of ['owner', 'irit', 'ofir', 'stav']) {
    assert.ok((await call(who, 'select id from public.deal_requests where id = $1', [d.id])).rows.length, who);
  }
  for (const who of ['lior', 'ilai', 'nadia']) {
    assert.equal((await call(who, 'select id from public.deal_requests where id = $1', [d.id])).rows.length, 0, who);
  }
  assert.match((await call('anon', 'select id from public.deal_requests')).error, /permission denied/);
});

test('the first to take it holds it; the other can no longer take, move or link it', async () => {
  const d = await newDeal();
  assert.equal(d.taken_by, null);
  const first = (await take('ofir', d.id)).rows[0].r;
  assert.deepEqual([first.ok, first.taken_by], [true, 'ofir']);
  assert.ok((await row(d.id)).taken_at, 'the time comes from the database');
  // Taking it again changes nothing.
  assert.equal((await take('ofir', d.id)).rows[0].r.ok, true);
  const second = (await take('irit', d.id)).rows[0].r;
  assert.deepEqual([second.ok, second.taken_by], [false, 'ofir']);
  assert.equal((await row(d.id)).taken_by, 'ofir');
  // Not by another way either.
  assert.match((await call('irit', "update public.deal_requests set status = 'sent' where id = $1", [d.id])).error, /deal_taken/);
  assert.match((await call('irit', "update public.deal_requests set status = 'cancelled' where id = $1", [d.id])).error, /deal_taken/);
  assert.match((await call('irit', "update public.deal_requests set taken_by = 'irit' where id = $1", [d.id])).error, /deal_taken/);
  // The one who took it works as usual.
  const moved = await call('ofir', "update public.deal_requests set status = 'sent' where id = $1 returning status", [d.id]);
  assert.equal(moved.rows[0].status, 'sent');
});

test('two presses together: one wins', async () => {
  const d = await newDeal();
  const [a, b] = await Promise.all([take('irit', d.id), take('ofir', d.id)]);
  const results = [a.rows[0].r, b.rows[0].r];
  assert.equal(results.filter((r) => r.ok).length, 1);
  const holder = (await row(d.id)).taken_by;
  assert.ok(['irit', 'ofir'].includes(holder));
  assert.equal(results[0].taken_by, results[1].taken_by);
});

test('nobody moves a deal that nobody took; only the person themselves takes it, and only while it waits', async () => {
  const d = await newDeal();
  assert.match((await call('irit', "update public.deal_requests set status = 'sent' where id = $1", [d.id])).error, /deal_not_taken/);
  assert.match((await call('ofir', "update public.deal_requests set status = 'cancelled' where id = $1", [d.id])).error, /deal_not_taken/);
  assert.match((await call('irit', "update public.deal_requests set taken_by = 'ofir' where id = $1", [d.id])).error, /deal_taken/);
  // The time cannot be written by hand.
  await take('irit', d.id);
  await call('irit', "update public.deal_requests set taken_at = '2020-01-01' where id = $1", [d.id]);
  assert.notEqual(new Date((await row(d.id)).taken_at).getFullYear(), 2020);
  // Those who do not prepare deals are refused.
  for (const who of ['lior', 'ilai', 'nadia', 'stav', 'anon']) {
    assert.match((await take(who, d.id)).error, /not allowed|permission denied/, who);
  }
});

test('a new deal is nobody\'s, whatever the browser sends', async () => {
  const r = await call('stav', "insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, taken_by, taken_at) values ('א', 'ב', '050-7654321', 'social', 'natali', 'irit', now()) returning taken_by, taken_at");
  assert.deepEqual(r.rows[0], { taken_by: null, taken_at: null });
});

test('the owners hand a deal over and the clock starts again; Irit and Ofir cannot', async () => {
  const d = await newDeal();
  await take('irit', d.id);
  const before = (await row(d.id)).taken_at;
  for (const who of ['irit', 'ofir', 'lior', 'stav']) {
    assert.match((await call(who, 'select public.deal_hand_over($1, $2)', [d.id, 'ofir'])).error, /not allowed/, who);
  }
  assert.match((await call('anon', 'select public.deal_hand_over($1, $2)', [d.id, 'ofir'])).error, /permission denied/);
  assert.match((await call('owner', 'select public.deal_hand_over($1, $2)', [d.id, 'lior'])).error, /invalid person/);
  const r = await call('owner', 'select public.deal_hand_over($1, $2) as r', [d.id, 'ofir']);
  assert.equal(r.rows[0].r.taken_by, 'ofir');
  const after = await row(d.id);
  assert.equal(after.taken_by, 'ofir');
  assert.ok(new Date(after.taken_at) >= new Date(before));
  // The former holder is now the other one.
  assert.match((await call('irit', "update public.deal_requests set status = 'sent' where id = $1", [d.id])).error, /deal_taken/);
  // An owner can do the work without taking it, and taking returns ok and leaves it as it is.
  const owner = (await take('owner', d.id)).rows[0].r;
  assert.deepEqual([owner.ok, owner.taken_by], [true, 'ofir']);
  assert.equal((await call('owner', "update public.deal_requests set status = 'cancelled' where id = $1 returning status", [d.id])).rows[0].status, 'cancelled');
  assert.match((await call('owner', 'select public.deal_hand_over($1, $2)', [d.id, 'irit'])).error, /deal not waiting/);
});

test('the system and the signature pass whoever holds the deal', async () => {
  const d = await newDeal();
  await take('ofir', d.id);
  const q = await db.query("insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot) values ('{}', 'x', 1, 1) returning id");
  await db.query('update public.deal_requests set quote_id = $1 where id = $2', [q.rows[0].id, d.id]);
  assert.equal((await row(d.id)).status, 'sent');
  // A staff member's session open in the browser while the client signs there: the signature passes.
  // (Row level security lets the office write; the rule steps aside for 'signed'.)
  const signed = await call('irit', "update public.deal_requests set status = 'signed' where id = $1 returning status", [d.id]);
  assert.equal(signed.error, undefined);
  assert.equal((await row(d.id)).taken_by, 'ofir');
});

test('the new details are saved; a special discount is not limited to the old 200 ₪', async () => {
  const d = await newDeal(", '514729938', 'הרצל 1, תל אביב', 150000");
  assert.deepEqual([d.company_id, d.business_address, d.special_discount_agorot, d.discount_agorot], ['514729938', 'הרצל 1, תל אביב', 150000, 0]);
  const tooLong = await call('stav', "insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, business_address) values ('א', 'ב', '050-7654321', 'social', 'natali', $1)", ['א'.repeat(201)]);
  assert.match(tooLong.error, /business_address_check/);
  const negative = await call('stav', "insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, special_discount_agorot) values ('א', 'ב', '050-7654321', 'social', 'natali', -1)");
  assert.match(negative.error, /special_discount_check/);
});
