// Amit reads the list of sent quotes with their amounts, as Irit (supabase/migrations/
// 20261220100000_amit_quotes.sql; the owner, 22.11.2026), on every migration in a real Postgres (PGlite):
//   - the file has none of the three words the production tool refuses, replaces only its one
//     function, and runs twice;
//   - before it Amit read only the quotes she made; after it every quote, with its amounts;
//   - public.sees_quote_money(): the owners, the managers and Amit; public.sees_income() and
//     public.sees_money() unchanged; the sellers' deals and the clients' prices stay closed to her;
//   - nobody else moved: Shiel and Ilai (the office too) still read no quote, Stav none.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { emptySelection, buildQuoteModel, validateSelection } from '../../app/pricing.js';

const FILE = '20261220100000_amit_quotes.sql';
const PEOPLE = { owner: null, irit: 'irit', amit: 'amit', shiel: 'shiel', ilai: 'ilai', stav: 'stav' };
const ROLES = Object.keys(PEOPLE);
const CLIENT = { name: 'דנה לוי', company: 'קפה דנה', phone: '050-1234567' };
let db;
const users = {};
const ids = {};
const beforeRun = {};

async function create(who) {
  const selection = { ...emptySelection(), docType: 'agreement', tier: 'social', influencer: 'simeon' };
  validateSelection(selection);
  const model = buildQuoteModel(selection, CLIENT);
  const { rows } = await db.query(
    'insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot, created_by, created_by_email) values ($1, $2, $3, $4, $5, $6) returning id',
    [JSON.stringify(model), CLIENT.name, model.totals.monthlyGross, model.totals.termGross, users[who].id, users[who].email]);
  return rows[0].id;
}
const q = async (who, sql, params = []) => {
  const out = await as(db, users[who], async (tx) => ({ rows: (await tx.query(sql, params)).rows }));
  assert.equal(out.error, undefined, `${who}: ${out.error}`);
  return out.rows;
};
const seen = async (who, table = 'quotes') => (await q(who, `select id from public.${table}`)).map((r) => r.id);
const names = (idList) => Object.entries(ids).filter(([, id]) => idList.includes(id)).map(([k]) => k).sort();

before(async () => {
  db = await freshDatabase({ upTo: FILE });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  ids.byIrit = await create('irit');
  ids.byOwner = await create('owner');
  ids.byAmit = await create('amit');
  for (const who of ROLES) beforeRun[who] = names(await seen(who));
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE)); // safe to run again
});

test('the file: none of the refused words, only its two functions, runs twice', () => {
  const sql = migrationSql(FILE);
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  const code = sql.replace(/--[^\n]*/g, '');
  assert.deepEqual([...code.matchAll(/create\s+or\s+replace\s+function\s+([a-z_.]+)/gi)].map((m) => m[1]), ['public.sees_quote_money', 'public.can_edit_quotes']);
});

test('before: Amit read only the quote she made', () => {
  assert.deepEqual(beforeRun.amit, ['byAmit']);
  assert.deepEqual(beforeRun.irit, ['byAmit', 'byIrit', 'byOwner']);
});

test('after: Amit reads every quote with its amounts and versions, as Irit', async () => {
  assert.deepEqual(names(await seen('amit')), ['byAmit', 'byIrit', 'byOwner']);
  const row = (await q('amit', 'select term_gross_agorot, monthly_gross_agorot from public.quotes where id = $1', [ids.byIrit]))[0];
  assert.ok(row.term_gross_agorot > 0 && row.monthly_gross_agorot > 0, JSON.stringify(row));
  const sums = async (who) => (await q(who, 'select sum(term_gross_agorot)::bigint as s from public.quotes'))[0];
  assert.deepEqual(await sums('amit'), await sums('irit'));
  const versions = async (who) => (await q(who, 'select id from public.quote_versions order by id')).map((r) => r.id);
  assert.deepEqual(await versions('amit'), await versions('irit'));
});

test('who sees the quotes with their amounts; the other money did not move', async () => {
  for (const who of ROLES) {
    const r = (await q(who, 'select public.sees_quote_money() as a, public.sees_income() as i, public.sees_money() as m'))[0];
    assert.deepEqual(r, { a: ['owner', 'irit', 'amit'].includes(who), i: ['owner', 'irit'].includes(who), m: who === 'owner' }, who);
  }
  assert.deepEqual(await q('amit', 'select * from public.manager_client_finance()'), []);
  assert.deepEqual(await seen('amit', 'deal_requests'), []);
  // The contracts signed elsewhere: she reads them as Irit (none yet; no error).
  assert.deepEqual(await seen('amit', 'manual_contracts'), []);
});

test('the price of one quote (create-quote asks public.can_edit_quotes()): the managers and Amit', async () => {
  for (const who of ROLES) {
    const r = (await q(who, 'select public.can_edit_quotes() as e, public.is_manager() as m'))[0];
    assert.deepEqual(r, { e: ['owner', 'irit', 'amit'].includes(who), m: ['owner', 'irit'].includes(who) }, who);
  }
});

test('nobody else moved', async () => {
  for (const who of ROLES.filter((w) => w !== 'amit')) assert.deepEqual(names(await seen(who)), beforeRun[who], who);
  for (const who of ['shiel', 'ilai', 'stav']) assert.deepEqual(await seen(who), [], who);
});
