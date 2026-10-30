// Ofir reads the list of sent quotes with their amounts (supabase/migrations/20261114100000_ofir_deals.sql;
// the owner's decision of 29.10.2026: "לאופיר את העסקאות של חודש ... כמו שאתה רואה") on every
// migration in a real Postgres (PGlite):
//   - the file is the newest, has none of the three words the production tool refuses, creates
//     only its one function, and runs twice;
//   - before it Ofir read only the contract that waits for approval; after it every quote, with
//     term_gross_agorot and monthly_gross_agorot (the month's two sums of quotes.html);
//   - public.sees_quote_money(): the owners and Ofir; public.sees_money() stays the owners';
//   - nothing else of the money moved to Ofir: the prices next to each client
//     (manager_client_finance), the sellers' deals (deal_requests);
//   - Irit as before (every quote), Lior as before (what waits for approval and his own),
//     Ilai, the editors and the field sales nothing.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { emptySelection, buildQuoteModel, validateSelection, exceptionOf } from '../../app/pricing.js';

const FILE = '20261114100000_ofir_deals.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', stav: 'stav' };
const ROLES = Object.keys(PEOPLE);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const CLIENT = { name: 'דנה לוי', company: 'קפה דנה', phone: '050-1234567' };
const CUSTOM = { price: 420000, discount: 35000, termMonths: 6, lines: [{ label: 'אתר תדמית', qty: 1, monthly: 50000 }], terms: 'תנאי מיוחד.' };
let db;
const users = {};
const ids = {};
const beforeRun = {};

const sel = (custom, extra = {}) => ({ ...emptySelection(), docType: 'agreement', tier: 'social', influencer: 'simeon', ...extra, ...(custom ? { custom } : {}) });
async function create(selection, who) {
  validateSelection(selection);
  const model = buildQuoteModel(selection, CLIENT);
  const { rows } = await db.query(
    'insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot, created_by, created_by_email, exceptions) values ($1, $2, $3, $4, $5, $6, $7) returning *',
    [JSON.stringify(model), CLIENT.name, model.totals.monthlyGross, model.totals.termGross, users[who].id, users[who].email, JSON.stringify(exceptionOf(selection))]);
  return rows[0];
}
// Committed calls (as() rolls back).
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
  const out = await as(db, users[who], async (tx) => ({ rows: (await tx.query(sql, params)).rows }));
  assert.equal(out.error, undefined, `${who}: ${out.error}`);
  return out.rows;
};
const seen = async (who, table = 'quotes') => (await q(who, `select id from public.${table}`)).map((r) => r.id);
const names = (idList) => Object.entries(ids).filter(([, id]) => idList.includes(id)).map(([k]) => k).sort();
const ALL = ['byLior', 'byOfir', 'sent', 'signed', 'waiting'];

before(async () => {
  db = await freshDatabase({ upTo: FILE });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  // A signed agreement (a client opens from it), one out for signing, an exceptional one
  // that waits for a manager, one Lior made and one Ofir made.
  const signed = await create(sel(null, { discount: 20000 }), 'irit');
  ids.signed = signed.id;
  await call('anon', 'select public.sign_quote($1, $2, $3, true)', [signed.token, 'דנה לוי', PNG]);
  ids.sent = (await create(sel(null), 'irit')).id;
  ids.waiting = (await create(sel(CUSTOM), 'irit')).id;
  ids.byLior = (await create(sel(null), 'lior')).id;
  ids.byOfir = (await create(sel(null), 'ofir')).id;
  const deal = await call('stav', "insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, discount_agorot) values ('עסק', 'איש קשר', '050-0000000', 'social', 'simeon', 20000) returning id");
  assert.equal(deal.error, undefined, deal.error);
  ids.deal = deal.rows[0].id;
  for (const who of ROLES) beforeRun[who] = names(await seen(who));
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE)); // safe to run again
});

test('the file: the newest, none of the refused words, only its one function, runs twice', () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261117100000_speed_pages.sql', '20261118100000_no_manager_approval.sql', '20261119100000_work_history.sql']);
  const sql = migrationSql(FILE);
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  const code = sql.replace(/--[^\n]*/g, '');
  assert.deepEqual([...code.matchAll(/create\s+or\s+replace\s+function\s+([a-z_.]+)/gi)].map((m) => m[1]), ['public.sees_quote_money']);
  // public.sees_money() is not touched: every other sum of income stays the owners'.
  assert.equal(/sees_money\(\)\s+returns/i.test(code), false);
  assert.equal(/quote_reader\(\)\s+returns/i.test(code), false);
});

test('before: Ofir read only the contract that waits for approval and his own', () => {
  assert.deepEqual(beforeRun.ofir, ['byOfir', 'waiting']);
  assert.deepEqual(beforeRun.irit, ALL);
  assert.deepEqual(beforeRun.owner, ALL);
});

test('after: Ofir reads every quote with its amounts, as the owners do', async () => {
  assert.deepEqual(names(await seen('ofir')), ALL);
  const row = (await q('ofir', 'select term_gross_agorot, monthly_gross_agorot from public.quotes where id = $1', [ids.signed]))[0];
  assert.ok(row.term_gross_agorot > 0 && row.monthly_gross_agorot > 0, JSON.stringify(row));
  // The month's sums of quotes.html add up the same for him as for the owners.
  const sums = async (who) => (await q(who, "select sum(term_gross_agorot)::bigint as sent, sum(term_gross_agorot) filter (where status = 'signed')::bigint as signed from public.quotes where status <> 'cancelled'"))[0];
  assert.deepEqual(await sums('ofir'), await sums('owner'));
  // The versions follow the quotes: the same ones as the owners'.
  const versions = async (who) => (await q(who, 'select id from public.quote_versions order by id')).map((r) => r.id);
  assert.ok((await versions('owner')).length > 0);
  assert.deepEqual(await versions('ofir'), await versions('owner'));
});

test('who sees the quotes with their amounts: the owners and Ofir; money in general still the owners\'', async () => {
  for (const who of ROLES) {
    const r = (await q(who, 'select public.sees_quote_money() as a, public.sees_money() as m'))[0];
    assert.deepEqual(r, { a: ['owner', 'ofir'].includes(who), m: who === 'owner' }, who);
  }
  assert.match((await call('anon', 'select public.sees_quote_money()')).error, /permission denied/);
});

test('nothing else of the money moved to Ofir: the prices next to each client, the sellers\' deals', async () => {
  assert.ok((await q('owner', 'select * from public.manager_client_finance()')).length > 0);
  assert.deepEqual(await q('ofir', 'select * from public.manager_client_finance()'), []);
  assert.deepEqual(await seen('ofir', 'deal_requests'), []);
  assert.deepEqual(names(await seen('irit', 'deal_requests')), ['deal']);
});

test('everyone else as before: Irit every quote, Lior what waits and his own, the rest nothing', async () => {
  for (const who of ROLES.filter((w) => w !== 'ofir')) assert.deepEqual(names(await seen(who)), beforeRun[who], who);
  assert.deepEqual(names(await seen('irit')), ALL);
  assert.deepEqual(names(await seen('lior')), ['byLior', 'waiting']);
  for (const who of ['ilai', 'nadia', 'stav']) assert.deepEqual(await seen(who), [], who);
  for (const who of ['lior', 'ilai', 'nadia', 'stav']) {
    assert.deepEqual(await q(who, 'select term_gross_agorot from public.quotes where id = $1', [ids.signed]), [], who);
  }
});
