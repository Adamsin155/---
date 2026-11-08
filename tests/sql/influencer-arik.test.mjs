// supabase/migrations/20261202100000_influencer_arik.sql in a real Postgres with every
// migration (tests/sql/pg.mjs): Arik Mishali ('arik'), the owner, 8.11.2026, exactly as Niro
// and "הצל" (tests/sql/new-influencers.test.mjs).
//   - the migration is the newest, runs twice, and takes away nothing but the three checks it
//     adds again at once, wider (each still refuses an unknown value);
//   - a field deal with Arik and his add-ons, and a client with his shoot type, are accepted;
//   - a signed agreement with Arik opens its client with 'arik' and Natali's quantities;
//   - Nirel sees his clients (and the landing link), Nadia does not;
//   - the quantities of his packages, with the reel and the story, as the app counts them.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { PACKAGES } from '../../app/catalog.js';
import { packageDeliverables } from '../../app/protocol-logic.js';

const FILE = '20261202100000_influencer_arik.sql';
const SQL = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
const PEOPLE = { owner: null, nirel: 'nirel', nadia: 'nadia' };
let db;
const users = {};

const modelOf = (id, paid = []) => ({
  signable: true, termMonths: 12,
  client: { name: 'רונית', company: 'קפה רונית', phone: '050-1234567' },
  package: { id, tierName: 'Social + TV all in one', influencer: 'אריק משעלי' },
  selection: { tier: PACKAGES[id].tier, influencer: 'arik', paid, free: { graphics: 0, simeonStories: 0, simeonJoin: false, extraCh14: false } },
});
async function sign(m) {
  const { rows } = await db.query("insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot, status) values ($1, 'רונית', 460200, 5522400, 'sent') returning id",
    [JSON.stringify(m)]);
  await db.query("update public.quotes set status = 'signed', signed_at = now() where id = $1", [rows[0].id]);
  const quote = (await db.query('select status from public.quotes where id = $1', [rows[0].id])).rows[0];
  const client = (await db.query('select * from public.clients where quote_id = $1', [rows[0].id])).rows[0] || null;
  return { quote, client };
}
const seen = (who, sql, params = []) => as(db, users[who], async (tx) => (await tx.query(sql, params)).rows);
const deal = (influencer, paid) => db.query(
  "insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, paid, created_by_email, seller) values ('עסק', 'א', '0501234567', 'social', $1, $2, 'stav@astrateg.test', 'stav') returning influencer, paid",
  [influencer, paid]);

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
});

test('the migration: the newest, runs twice, takes away only the three checks it adds again', async () => {
  assert.equal(migrationFiles().at(-1), FILE);
  const code = SQL.replace(/--[^\n]*/g, '');
  assert.deepEqual(code.match(/\b(drop|delete|truncate)\b[^\n]*/gi), [
    'drop constraint if exists clients_shoot_type_check;',
    'drop constraint if exists deal_requests_influencer_check;',
    'drop constraint if exists deal_requests_paid_check;',
  ]);
  assert.equal((code.match(/add constraint/g) || []).length, 3);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
});

test('the deal and the client take Arik; the checks still refuse an unknown value', async () => {
  const d = (await deal('arik', ['arik-reel', 'arik-story', 'photographer'])).rows[0];
  assert.deepEqual([d.influencer, d.paid], ['arik', ['arik-reel', 'arik-story', 'photographer']]);
  for (const inf of ['natali', 'simeon', 'niro', 'hatzel', 'choice']) assert.equal((await deal(inf, [])).rows[0].influencer, inf);
  await assert.rejects(deal('nobody', []), /check/);
  await assert.rejects(deal('arik', ['other-reel']), /check/);
  for (const t of ['natali', 'niro', 'hatzel', 'arik', 'dms']) await db.query("insert into public.clients (name, shoot_type) values ('x', $1)", [t]);
  await assert.rejects(db.query("insert into public.clients (name, shoot_type) values ('x', 'nobody')"), /check/);
});

test('a signed agreement with Arik opens its client with his shoot type and Natali\'s quantities', async () => {
  const { quote, client } = await sign(modelOf('social-tv-arik', ['arik-reel', 'arik-story']));
  assert.equal(quote.status, 'signed');
  assert.equal(client.shoot_type, 'arik');
  assert.equal(client.package_name, 'Social + TV all in one · אריק משעלי');
  assert.deepEqual(client.deliverables, { videos: 36, graphics: 36, shoot_days: 1, collabs: 1, stories: 1, ch14: 1, monthly: 0 });
});

test('Nirel sees Arik\'s clients and his landing link; Nadia does not', async () => {
  const arik = (await db.query("insert into public.clients (name, status, shoot_type, landing) values ('של אריק', 'active', 'arik', true) returning id")).rows[0].id;
  const can = (who) => seen(who, 'select public.can_see_client($1) as ok', [arik]);
  assert.equal((await can('nirel'))[0].ok, true);
  assert.equal((await can('nadia'))[0].ok, false);
  assert.ok((await seen('nirel', 'select name from public.clients')).some((r) => r.name === 'של אריק'));
  const linked = (await db.query("select x as id from private.landing_link_clients('nirel') as x")).rows.map((r) => r.id);
  assert.ok(linked.includes(arik));
});

test('the quantities of Arik\'s packages, with and without the reel and the story, as the app counts them', async () => {
  const ids = Object.keys(PACKAGES).filter((k) => PACKAGES[k].influencer === 'arik');
  assert.deepEqual(ids, ['podcast-arik', 'social-arik', 'social-tv-arik']);
  for (const id of ids) {
    for (const paid of [[], ['arik-reel'], ['arik-reel', 'arik-story', 'photographer']]) {
      const m = modelOf(id, paid);
      const sqlOut = (await db.query('select public.package_deliverables($1) as d', [JSON.stringify(m)])).rows[0].d;
      assert.deepEqual(sqlOut, packageDeliverables(m), `${id} ${paid.join(',')}`);
    }
  }
});
