// "תשלומי לקוחות" (11.11.2026; supabase/migrations/20261212100000_client_payments.sql): the
// owners (Idan and Adam: two staff rows with no person) read and write; Ofir reads only; every
// other person on the staff sees no row and cannot write; nobody deletes from the browser. Who
// wrote a row, when, and its source are the table's. Ofir gets nothing of the payouts tables.
// Safe to run twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, migrationSql } from './pg.mjs';

const MIGRATION = '20261212100000_client_payments.sql';
const PEOPLE = { idan: null, adam: null, ofir: 'ofir', irit: 'irit', lior: 'lior', ilai: 'ilai', nadia: 'nadia', stav: 'stav' };
const CLIENT = 'c0000000-0000-4000-8000-000000000001';
let db;
const users = {};

async function call(who, sql, params = []) {
  const user = users[who];
  const claims = { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated' };
  try {
    return await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (err) {
    return { error: err.message };
  }
}
const add = (who, fields = {}) => {
  const f = { amount: 21240, retainer: 1500, method: 'payment', ...fields };
  return call(who, `insert into public.client_payments (client_id, amount, retainer, method, checks_count, first_check_date, deal_date, note)
    values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, by_email, source`,
  [CLIENT, f.amount, f.retainer, f.method, f.checks_count ?? null, f.first_check_date ?? null, f.deal_date ?? null, f.note ?? null]);
};
const seen = async (who) => (await call(who, 'select id from public.client_payments')).rows;

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2) on conflict (email) do update set person = excluded.person', [email, person]);
  }
  await db.query("insert into public.clients (id, name, business) values ($1, 'לקוח לדוגמה', 'עסק לדוגמה')", [CLIENT]);
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
});

test('both owners add a deal; who and the source are stamped by the table', async () => {
  for (const who of ['idan', 'adam']) {
    const r = await add(who);
    assert.ok(!r.error, `${who}: ${r.error}`);
    assert.equal(r.rows[0].by_email, `${who}@astrateg.test`);
    assert.equal(r.rows[0].source, 'manual');
  }
  // Not from the caller: the source, the old CRM id and who wrote it.
  assert.match((await call('idan', `insert into public.client_payments (client_id, source) values ('${CLIENT}', 'old_crm')`)).error, /permission denied/);
  assert.match((await call('idan', `insert into public.client_payments (client_id, by_email) values ('${CLIENT}', 'x@y')`)).error, /permission denied/);
});

test('the owners and Ofir read every row; nobody else sees any', async () => {
  const n = (await db.query('select count(*)::int as n from public.client_payments')).rows[0].n;
  assert.ok(n >= 2);
  for (const who of ['idan', 'adam', 'ofir']) assert.equal((await seen(who)).length, n, who);
  for (const who of ['irit', 'lior', 'ilai', 'nadia', 'stav']) assert.equal((await seen(who)).length, 0, who);
});

test('Ofir and the rest of the staff cannot add, correct or delete', async () => {
  const id = (await add('idan')).rows[0].id;
  for (const who of ['ofir', 'irit', 'lior', 'ilai', 'nadia']) {
    assert.match((await add(who)).error, /row-level security/, who);
    const up = await call(who, 'update public.client_payments set amount = 1 where id = $1 returning id', [id]);
    assert.ok(up.error || up.rows.length === 0, `${who} updated`);
    assert.match((await call(who, 'delete from public.client_payments where id = $1', [id])).error, /permission denied/, who);
  }
  assert.match((await call('idan', 'delete from public.client_payments where id = $1', [id])).error, /permission denied/, 'no delete for the owners either');
  const row = (await db.query('select amount from public.client_payments where id = $1', [id])).rows[0];
  assert.equal(Number(row.amount), 21240);
});

test('an owner corrects a row: stamped again; the source and the client stay', async () => {
  await db.query(`insert into public.client_payments (client_id, amount, method, source, old_crm_deal_id) values ($1, 100, 'payment', 'old_crm', 'old-1')`, [CLIENT]);
  const id = (await db.query("select id from public.client_payments where old_crm_deal_id = 'old-1'")).rows[0].id;
  const r = await call('adam', `update public.client_payments set amount = 200, method = 'checks', checks_count = 6, first_check_date = '2026-12-01'
    where id = $1 returning amount, source, old_crm_deal_id, by_email`, [id]);
  assert.ok(!r.error, r.error);
  assert.equal(Number(r.rows[0].amount), 200);
  assert.equal(r.rows[0].source, 'old_crm');
  assert.equal(r.rows[0].old_crm_deal_id, 'old-1');
  assert.equal(r.rows[0].by_email, 'adam@astrateg.test');
  assert.match((await call('adam', 'update public.client_payments set client_id = gen_random_uuid() where id = $1', [id])).error, /permission denied/);
});

test('the checks: only on a cheques deal; the numbers in range', async () => {
  assert.match((await add('idan', { method: 'payment', checks_count: 6 })).error, /client_payments_checks_only/);
  assert.match((await add('idan', { method: 'transfer', first_check_date: '2026-12-01' })).error, /client_payments_checks_only/);
  assert.ok(!(await add('idan', { method: 'checks', checks_count: 12, first_check_date: '2026-12-01' })).error);
  assert.match((await add('idan', { method: 'cash' })).error, /check constraint/);
  assert.match((await add('idan', { amount: -1 })).error, /check constraint/);
  assert.ok(!(await add('idan', { amount: null, retainer: null, method: null })).error, 'every field may be empty');
});

test('the anonymous visitor reads nothing; Ofir still reads no payouts table', async () => {
  const anon = await db.transaction(async (tx) => {
    await tx.query('set local role anon');
    try { return (await tx.query('select id from public.client_payments')).rows; } catch (e) { return { error: e.message }; }
  });
  assert.match(anon.error, /permission denied/);
  for (const t of ['payout_deals', 'payout_settings']) {
    const r = await call('ofir', `select count(*)::int as n from public.${t}`);
    assert.ok(r.error || r.rows[0].n === 0, t);
  }
  const fn = await call('ofir', 'select private.is_payout_owner() as yes');
  assert.ok(fn.error || fn.rows[0].yes === false);
});
