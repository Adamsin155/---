// supabase/migrations/20261112100000_new_influencers.sql and the checks that wait for the
// owner's approval (supabase/pending/new_influencers_checks.sql), in a real Postgres with
// every migration (tests/sql/pg.mjs): Niro Levi and "הצל" (Yoav Eliasi), 28.10.2026.
//   - the migration is the newest, only adds (none of the three words the production tool
//     refuses) and runs twice; the pending file takes away nothing but the three checks it
//     adds again, wider;
//   - before the pending file: a 'hatzel' client and a 'niro' deal are refused (as the header
//     says), and a signed Niro agreement keeps its signature;
//   - after it: a field deal with Niro and his add-ons is accepted, a client with 'hatzel' too,
//     and a signed agreement with "הצל" opens its client with that shoot type and Natali's
//     quantities; Nirel sees that client (and a Niro client), not a 'dms' one;
//   - the quantities of every new package, with the reel and the story, as the app counts them.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { PACKAGES, STARS } from '../../app/catalog.js';
import { packageDeliverables } from '../../app/protocol-logic.js';

const FILE = '20261112100000_new_influencers.sql';
const PENDING = new URL('../../supabase/pending/new_influencers_checks.sql', import.meta.url);
const PEOPLE = { owner: null, irit: 'irit', nirel: 'nirel', nadia: 'nadia', stav: 'stav' };
let db;
const users = {};

const modelOf = (id, paid = [], extra = {}) => ({
  signable: true, termMonths: 12,
  client: { name: 'רונית', company: 'קפה רונית', phone: '050-1234567' },
  package: { id, tierName: 'Social + TV all in one', influencer: PACKAGES[id].influencer === 'hatzel' ? 'הצל (יואב אליאסי)' : 'נירו לוי' },
  selection: { tier: PACKAGES[id].tier, influencer: PACKAGES[id].influencer, paid, free: { graphics: 0, simeonStories: 0, simeonJoin: false, extraCh14: false } },
  ...extra,
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

test('the migration: the newest, only adds, runs twice', async () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261112200000_legacy_contracts_full.sql', '20261113100000_client_details_month.sql', '20261114100000_ofir_deals.sql', '20261117100000_speed_pages.sql', '20261118100000_no_manager_approval.sql', '20261119100000_work_history.sql', '20261120100000_drive_daily.sql', '20261121100000_mcp.sql', '20261122100000_deal_pool.sql', '20261123100000_old_income.sql']);
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
});

test('the pending file: only the four checks, each taken away by name and added again wider', () => {
  const sql = readFileSync(PENDING, 'utf8');
  assert.deepEqual(sql.replace(/--[^\n]*/g, '').match(/\b(drop|delete|truncate)\b[^\n]*/gi), [
    'drop constraint if exists clients_shoot_type_check;',
    'drop constraint if exists deal_requests_influencer_check;',
    'drop constraint if exists deal_requests_discount_agorot_check;',
    'drop constraint if exists deal_requests_paid_check;',
  ]);
  assert.equal((sql.replace(/--[^\n]*/g, '').match(/add constraint/g) || []).length, 4);
});

test('before the approval: Niro and "הצל" are refused where a check lists the values; a signature is kept', async () => {
  await assert.rejects(db.query("insert into public.clients (name, shoot_type) values ('x', 'hatzel')"), /check/);
  await assert.rejects(deal('niro', []), /check/);
  const { quote, client } = await sign(modelOf('social-niro', ['niro-reel']));
  assert.equal(quote.status, 'signed');
  // The client opens anyway, with its package and quantities, and no shoot type yet.
  assert.equal(client.shoot_type, null);
  assert.equal(client.package_name, 'Social + TV all in one · נירו לוי');
  assert.equal(client.deliverables.collabs, 1);
});

test('after the approval: the deal, the client and the signing; runs twice', async () => {
  const sql = readFileSync(PENDING, 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  const d = (await deal('niro', ['niro-reel', 'niro-story'])).rows[0];
  assert.deepEqual([d.influencer, d.paid], ['niro', ['niro-reel', 'niro-story']]);
  assert.equal((await deal('hatzel', ['hatzel-story', 'photographer'])).rows[0].influencer, 'hatzel');
  await assert.rejects(deal('niro', ['other-reel']), /check/);
  await assert.rejects(db.query("insert into public.clients (name, shoot_type) values ('x', 'nobody')"), /check/);
  const { client } = await sign(modelOf('social-tv-hatzel', ['hatzel-reel', 'hatzel-story']));
  assert.equal(client.shoot_type, 'hatzel');
  assert.equal(client.package_name, 'Social + TV all in one · הצל (יואב אליאסי)');
  assert.deepEqual(client.deliverables, { videos: 36, graphics: 36, shoot_days: 1, collabs: 1, stories: 1, ch14: 1, monthly: 0 });
});

test('Nirel sees the clients of every star day, not a day with Denis, Michel and Semion', async () => {
  const add = async (name, type) => (await db.query('insert into public.clients (name, status, shoot_type) values ($1, \'active\', $2) returning id', [name, type])).rows[0].id;
  const niro = await add('של נירו', 'niro');
  const hatzel = await add('של הצל', 'hatzel');
  const natali = await add('של נטלי', 'natali');
  const dms = await add('של דמס', 'dms');
  const names = (await seen('nirel', 'select name from public.clients order by name')).map((r) => r.name);
  for (const n of ['של נירו', 'של הצל', 'של נטלי']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('של דמס'));
  const can = async (id) => (await seen('nirel', 'select public.can_see_client($1) as ok', [id]))[0].ok;
  assert.deepEqual([await can(niro), await can(hatzel), await can(natali), await can(dms)], [true, true, true, false]);
  // Nadia (an editor of none of them) sees none.
  assert.deepEqual(await seen('nadia', 'select name from public.clients where id = any($1)', [[niro, hatzel]]), []);
  // The landing's personal link: the same clients, while in landing.
  await db.query('update public.clients set landing = true where id = any($1)', [[niro, dms]]);
  const linked = (await db.query("select x as id from private.landing_link_clients('nirel') as x")).rows.map((r) => r.id);
  assert.ok(linked.includes(niro));
  assert.ok(!linked.includes(dms));
});

test('the quantities of every star package, with and without the reel and the story, as the app counts them', async () => {
  for (const inf of STARS) {
    for (const id of Object.keys(PACKAGES).filter((k) => PACKAGES[k].influencer === inf)) {
      for (const paid of [[], [`${inf}-reel`], [`${inf}-reel`, `${inf}-story`, 'photographer']]) {
        const m = modelOf(id, paid);
        const sqlOut = (await db.query('select public.package_deliverables($1) as d', [JSON.stringify(m)])).rows[0].d;
        assert.deepEqual(sqlOut, packageDeliverables(m), `${id} ${paid.join(',')}`);
      }
    }
  }
  // A contract changed by hand on a new package, as on Natali's (custom quantities and lines).
  const custom = modelOf('social-tv-hatzel', ['hatzel-reel']);
  custom.selection.custom = { qty: { videos: 30, collabs: 2, shootDays: 2 }, termMonths: 6, lines: [{ label: 'אתר', qty: 1 }] };
  assert.deepEqual((await db.query('select public.package_deliverables($1) as d', [JSON.stringify(custom)])).rows[0].d, packageDeliverables(custom));
  const tv = (await db.query('select public.package_deliverables($1) as d', [JSON.stringify(modelOf('social-tv-niro'))])).rows[0].d;
  assert.deepEqual(tv, { videos: 36, graphics: 36, shoot_days: 1, collabs: 0, stories: 0, ch14: 1, monthly: 0 }); // 36 and 36 since 28.10.2026
});
