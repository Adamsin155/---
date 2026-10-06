// Money for the two owners only (supabase/migrations/20261013100000_money_owners_only.sql;
// the owner's decision, 6.10.2026), on every migration in a real Postgres (PGlite).
// Per role, what each can and cannot read:
//  - before the migration the whole office read every quote, and Irit and Ofir the prices
//    next to each client (the baseline this closes);
//  - after it: the owners and Irit read the quotes; Ofir and Lior only a contract that
//    waits for approval; whoever made a quote reads it; nobody else reads any;
//  - quote versions and the sellers' deals follow the same people;
//  - the prices next to each client (manager_client_finance) answer the owners only;
//  - quote_facts() gives the office the agreements without their money, and nobody else anything;
//  - the payments tables stay the payout owners';
//  - nothing the work depends on broke: the client's link and signing, approving and
//    rejecting, a seller's own deals, Irit linking a contract to a deal;
//  - the migration runs twice and holds none of the words the deploy tool refuses.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { emptySelection, buildQuoteModel, validateSelection, exceptionOf } from '../../app/pricing.js';

const MIGRATION = '20261013100000_money_owners_only.sql';
const PEOPLE = { owner: null, owner2: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', eli: 'eli', stav: 'stav', amos: 'amos' };
const ROLES = Object.keys(PEOPLE);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const CLIENT = { name: 'דנה לוי', company: 'קפה דנה', phone: '050-1234567' };
const CUSTOM = { price: 420000, discount: 35000, termMonths: 6, lines: [{ label: 'אתר תדמית', qty: 1, monthly: 50000 }, { label: 'ניהול קהילה' }], terms: 'תנאי מיוחד.' };
let db;
const users = {};
const ids = {};
const before_ = {};

const sel = (custom, extra = {}) => ({ ...emptySelection(), docType: 'agreement', tier: 'social', influencer: 'simeon', ...extra, ...(custom ? { custom } : {}) });
async function create(selection, who) {
  validateSelection(selection);
  const model = buildQuoteModel(selection, CLIENT);
  const { rows } = await db.query(
    'insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot, created_by, created_by_email, exceptions) values ($1, $2, $3, $4, $5, $6, $7) returning *',
    [JSON.stringify(model), CLIENT.name, model.totals.monthlyGross, model.totals.termGross, users[who].id, users[who].email, JSON.stringify(exceptionOf(selection))]);
  return rows[0];
}
async function call(who, sql, params = []) {
  const user = who === 'anon' ? null : users[who];
  const role = user ? 'authenticated' : 'anon';
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
const q = async (who, sql, params = []) => {
  const out = await as(db, who === 'anon' ? null : users[who], async (tx) => ({ rows: (await tx.query(sql, params)).rows }));
  return out.rows || [];
};
const seen = async (who, table = 'quotes') => (await q(who, `select id from public.${table}`)).map((r) => r.id);
const names = (idList) => Object.entries(ids).filter(([, id]) => idList.includes(id)).map(([k]) => k).sort();

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  // A regular signed agreement with a discount (a client opens from it), a regular one
  // out for signing, an exceptional one that waits, an exceptional one signed, and a
  // quote Lior made himself.
  const signed = await create(sel(null, { discount: 20000 }), 'irit');
  ids.signed = signed.id;
  await call('anon', 'select public.sign_quote($1, $2, $3, true)', [signed.token, 'דנה לוי', PNG]);
  ids.client = (await db.query('select id from public.clients where quote_id = $1', [ids.signed])).rows[0].id;
  ids.sent = (await create(sel(null), 'irit')).id;
  const waiting = await create(sel(CUSTOM), 'irit');
  ids.waiting = waiting.id;
  ids.waitingToken = waiting.token;
  const done = await create(sel(CUSTOM), 'irit');
  ids.customSigned = done.id;
  assert.equal((await call('owner', 'select public.quote_approve($1)', [done.id])).error, undefined);
  await call('anon', 'select public.sign_quote($1, $2, $3, true)', [done.token, 'דנה לוי', PNG]);
  assert.equal((await db.query('select status from public.quotes where id = $1', [done.id])).rows[0].status, 'signed');
  ids.byLior = (await create(sel(null), 'lior')).id;
  // Two deals from the field: Stav's with a discount, Amos's "הצעה אחרת" with a price.
  const deal = (who, extra) => call(who, `insert into public.deal_requests (business_name, contact_name, phone, ${Object.keys(extra).join(', ')}) values ('עסק', 'איש קשר', '050-0000000', ${Object.keys(extra).map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(extra));
  const s = await deal('stav', { tier: 'social', influencer: 'simeon', discount_agorot: 20000 });
  assert.equal(s.error, undefined, s.error);
  ids.dealStav = s.rows[0].id;
  const a = await deal('amos', { tier: 'social', influencer: 'simeon', discount_agorot: 10000 });
  assert.equal(a.error, undefined, a.error);
  ids.dealAmos = a.rows[0].id;
  // The baseline, before the migration.
  for (const who of ROLES) {
    before_[who] = { quotes: (await seen(who)).length, finance: (await q(who, 'select * from public.manager_client_finance()')).length, deals: (await seen(who, 'deal_requests')).length };
  }
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION)); // safe to run again
});

test('the baseline this closes: before the migration the whole office read every quote', () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) assert.equal(before_[who].quotes, 5, who);
  for (const who of ['nadia', 'eli', 'stav', 'amos']) assert.equal(before_[who].quotes, 0, who);
  assert.deepEqual(['owner', 'irit', 'ofir', 'lior', 'ilai'].map((w) => before_[w].finance > 0), [true, true, true, false, false]);
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) assert.equal(before_[who].deals, 2, who);
});

test('who sees money: the two owners, and nobody else', async () => {
  for (const who of ROLES) {
    assert.equal((await q(who, 'select public.sees_money() as m'))[0].m, who === 'owner' || who === 'owner2', who);
  }
  assert.match((await call('anon', 'select public.sees_money()')).error, /permission denied/);
});

test('the quotes: the owners and Irit all of them; Ofir and Lior only what waits for approval; a quote\'s maker that quote; nobody else any', async () => {
  const all = ['byLior', 'customSigned', 'sent', 'signed', 'waiting'];
  for (const who of ['owner', 'owner2', 'irit']) assert.deepEqual(names(await seen(who)), all, who);
  assert.deepEqual(names(await seen('ofir')), ['waiting']);
  assert.deepEqual(names(await seen('lior')), ['byLior', 'waiting']);
  for (const who of ['ilai', 'nadia', 'eli', 'stav', 'amos']) assert.deepEqual(await seen(who), [], who);
  // No price by any column either.
  for (const who of ['ofir', 'lior', 'ilai', 'nadia', 'eli', 'stav']) {
    assert.deepEqual(await q(who, 'select monthly_gross_agorot, term_gross_agorot, model from public.quotes where id = $1', [ids.signed]), [], who);
    assert.deepEqual(await q(who, 'select sum(monthly_gross_agorot) as s from public.quotes where status = $1', ['signed']), [{ s: null }], who);
  }
  assert.equal(Number((await q('owner', "select sum(monthly_gross_agorot) as s from public.quotes where status = 'signed'"))[0].s) > 0, true);
});

test('an approver stops reading a contract once it is signed or cancelled', async () => {
  // The exceptional contract that was approved and signed is not Ofir's or Lior's to read.
  for (const who of ['ofir', 'lior']) assert.deepEqual(await q(who, 'select id from public.quotes where id = $1', [ids.customSigned]), [], who);
});

test('the versions of a quote follow the quote', async () => {
  const count = async (who, id) => (await q(who, 'select id from public.quote_versions where quote_id = $1', [id])).length;
  for (const who of ['owner', 'irit', 'ofir', 'lior']) assert.ok(await count(who, ids.waiting) > 0, who);
  for (const who of ['owner', 'irit']) assert.ok(await count(who, ids.customSigned) > 0, who);
  for (const who of ['ofir', 'lior', 'ilai', 'nadia', 'stav']) assert.equal(await count(who, ids.customSigned), 0, who);
  for (const who of ['ilai', 'nadia', 'eli', 'stav']) assert.equal(await count(who, ids.waiting), 0, who);
});

test('the prices next to each client: the owners only', async () => {
  for (const who of ['owner', 'owner2']) {
    const rows = await q(who, 'select * from public.manager_client_finance()');
    assert.ok(rows.some((r) => r.client_id === ids.client && r.monthly_gross_agorot > 0 && r.discount_agorot === 20000), who);
  }
  for (const who of ['irit', 'lior', 'ofir', 'ilai', 'nadia', 'eli', 'stav', 'amos']) {
    assert.deepEqual(await q(who, 'select * from public.manager_client_finance()'), [], who);
  }
  assert.match((await call('anon', 'select * from public.manager_client_finance()')).error, /permission denied/);
});

test('the sellers\' deals: the owners, Irit and the seller whose deal it is', async () => {
  for (const who of ['owner', 'owner2', 'irit']) assert.deepEqual(names(await seen(who, 'deal_requests')), ['dealAmos', 'dealStav'], who);
  assert.deepEqual(names(await seen('stav', 'deal_requests')), ['dealStav']);
  assert.deepEqual(names(await seen('amos', 'deal_requests')), ['dealAmos']);
  for (const who of ['lior', 'ofir', 'ilai', 'nadia', 'eli']) assert.deepEqual(await seen(who, 'deal_requests'), [], who);
});

test('quote_facts: the office gets the agreement without its money; the owners and Irit the selection whole', async () => {
  const MONEY = /discount|price|monthly|agorot|totals|gross|net/i;
  for (const who of ['lior', 'ofir', 'ilai']) {
    const rows = await q(who, 'select * from public.quote_facts($1)', [[ids.signed, ids.customSigned]]);
    assert.equal(rows.length, 2, who);
    for (const r of rows) {
      assert.equal(MONEY.test(JSON.stringify(r.selection)), false, `${who}: ${JSON.stringify(r.selection)}`);
      assert.equal(MONEY.test(Object.keys(r).join(' ')), false, who);
      assert.deepEqual(Object.keys(r).sort(), ['client', 'client_name', 'id', 'influencer', 'number', 'package_id', 'selection', 'signed_at', 'status', 'term_months', 'tier']);
    }
    const custom = rows.find((r) => r.id === ids.customSigned);
    // What the protocol counts from stays: the package, the term, the added lines by name, the special terms.
    assert.deepEqual([custom.selection.tier, custom.selection.influencer, custom.term_months, custom.selection.custom.termMonths], ['social', 'simeon', 6, 6], who);
    assert.deepEqual(custom.selection.custom.lines, [{ label: 'אתר תדמית', qty: 1 }, { label: 'ניהול קהילה' }], who);
    assert.equal(custom.selection.custom.terms, 'תנאי מיוחד.', who);
    assert.ok(custom.number && custom.signed_at && custom.client.company === 'קפה דנה', who);
    // With no list: every signed agreement, and only signed ones.
    assert.deepEqual(names((await q(who, 'select id from public.quote_facts()')).map((r) => r.id)), ['customSigned', 'signed'], who);
  }
  for (const who of ['owner', 'irit']) {
    const rows = await q(who, 'select * from public.quote_facts($1)', [[ids.signed, ids.customSigned]]);
    assert.equal(rows.find((r) => r.id === ids.signed).selection.discount, 20000, who);
    assert.equal(rows.find((r) => r.id === ids.customSigned).selection.custom.price, 420000, who);
  }
  for (const who of ['nadia', 'eli', 'stav', 'amos']) {
    assert.deepEqual(await q(who, 'select * from public.quote_facts($1)', [[ids.signed]]), [], who);
    assert.deepEqual(await q(who, 'select * from public.quote_facts()'), [], who);
  }
  assert.match((await call('anon', 'select * from public.quote_facts()')).error, /permission denied/);
});

test('the payments tables stay the payout owners\': a staff owner who is not one reads nothing', async () => {
  await db.query('insert into public.payout_owners (user_id, email) values ($1, $2) on conflict do nothing', [users.owner.id, users.owner.email]);
  await db.query("insert into public.payout_incomes (income_date, description, amount_agorot) values (current_date, 'x', 100000)").catch(async () => {
    // The column names of this table are the payments app's; whatever they are, a row is not needed for the check below.
  });
  for (const table of ['payout_settings', 'payout_deals', 'payout_incomes', 'payout_expenses', 'payout_locks', 'payout_performed']) {
    for (const who of ['owner2', 'irit', 'lior', 'ofir', 'ilai', 'nadia', 'stav']) {
      const out = await call(who, `select count(*)::int as n from public.${table}`);
      assert.ok(out.error ? /permission denied/.test(out.error) : out.rows[0].n === 0, `${who}: ${table}`);
    }
    assert.equal((await call('owner', `select count(*)::int as n from public.${table}`)).error, undefined, table);
    assert.match((await call('anon', `select count(*) from public.${table}`)).error, /permission denied/, table);
  }
  // A person sees only their own row of the list of payout owners, and nobody adds one from the app.
  assert.equal((await q('owner', 'select * from public.payout_owners')).length, 1);
  for (const who of ['owner2', 'irit', 'lior']) assert.equal((await q(who, 'select * from public.payout_owners')).length, 0, who);
  assert.match((await call('irit', 'insert into public.payout_owners (user_id, email) values ($1, $2)', [users.irit.id, users.irit.email])).error, /permission denied/);
});

test('nothing the work depends on broke', async () => {
  // The client's link: a regular quote opens for anyone holding it; one that waits does not.
  const sent = (await db.query('select token from public.quotes where id = $1', [ids.sent])).rows[0];
  assert.ok((await q('anon', 'select public.get_quote($1) as g', [sent.token]))[0].g);
  assert.equal((await q('anon', 'select public.get_quote($1) as g', [ids.waitingToken]))[0].g, null);
  // Lior decides on the contract that waits, with its prices in front of him.
  const row = (await q('lior', 'select monthly_gross_agorot, exceptions from public.quotes where id = $1', [ids.waiting]))[0];
  assert.ok(row.monthly_gross_agorot > 0 && row.exceptions.length > 0);
  assert.equal((await call('lior', 'select public.quote_reject($1, $2)', [ids.waiting, 'המחיר נמוך מדי'])).error, undefined);
  // Still his to read while it is sent back to Irit, who reads the note.
  assert.deepEqual(names(await seen('lior')), ['byLior', 'waiting']);
  assert.equal((await q('irit', 'select approval_note from public.quotes where id = $1', [ids.waiting]))[0].approval_note, 'המחיר נמוך מדי');
  // Irit links a contract to Stav's deal, and Stav sees it move.
  const linked = await call('irit', 'update public.deal_requests set quote_id = $1 where id = $2 returning status', [ids.sent, ids.dealStav]);
  assert.equal(linked.error, undefined, linked.error);
  assert.equal(linked.rows[0].status, 'sent');
  assert.equal((await q('stav', 'select status from public.deal_requests where id = $1', [ids.dealStav]))[0].status, 'sent');
  // Ofir and Lior cannot move a deal they do not read.
  assert.deepEqual((await call('ofir', "update public.deal_requests set status = 'cancelled' where id = $1 returning id", [ids.dealAmos])).rows, []);
  // A seller adds a deal and gets it back.
  const mine = await call('amos', "insert into public.deal_requests (business_name, contact_name, phone, tier, influencer) values ('חדש', 'מי', '050-1111111', 'social', 'simeon') returning id, status");
  assert.equal(mine.error, undefined, mine.error);
  assert.equal(mine.rows[0].status, 'pending');
  // A client still opens from a signature, whoever may read the quote.
  const fresh = await create(sel(null), 'irit');
  await call('anon', 'select public.sign_quote($1, $2, $3, true)', [fresh.token, 'דנה לוי', PNG]);
  assert.equal((await db.query('select count(*)::int as n from public.clients where quote_id = $1', [fresh.id])).rows[0].n, 1);
  // The office still reads the client itself (no money in it).
  for (const who of ['lior', 'ofir', 'ilai']) assert.equal((await q(who, 'select id from public.clients where id = $1', [ids.client])).length, 1, who);
});

test('the migration holds none of the words the deploy tool refuses, and one policy per table', async () => {
  assert.equal(/\b(drop|delete|truncate)\b/i.test(migrationSql(MIGRATION)), false);
  const { rows } = await db.query("select tablename, policyname, permissive, cmd from pg_policies where policyname like 'money:%' order by tablename");
  assert.deepEqual(rows.map((r) => [r.tablename, r.permissive, r.cmd]), [['deal_requests', 'RESTRICTIVE', 'SELECT'], ['quote_versions', 'RESTRICTIVE', 'SELECT'], ['quotes', 'RESTRICTIVE', 'SELECT']]);
});
