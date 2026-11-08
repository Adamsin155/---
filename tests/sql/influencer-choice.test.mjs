// supabase/migrations/20261129100000_influencer_choice.sql in a real Postgres with every
// migration (tests/sql/pg.mjs): "משפיען לבחירה" (the owner, 5.11.2026).
//   - the migration is the newest, runs twice, and takes away only the deal's influencer check,
//     added again at once, wider;
//   - Stav's deal may name 'choice' (and Niro and "הצל"), not an unknown one;
//   - a signed 'choice' agreement keeps its signature and opens its client with no shoot type,
//     the package's name, and Natali's quantities, as the app counts them;
//   - the quantities of every package, old and new, as the app counts them.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql, migrationFiles } from './pg.mjs';
import { PACKAGES } from '../../app/catalog.js';
import { buildQuoteModel, emptySelection } from '../../app/pricing.js';
import { packageDeliverables } from '../../app/protocol-logic.js';
import { influencerToChoose } from '../../app/client-open.js';

const FILE = '20261129100000_influencer_choice.sql';
const SQL = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
let db;

const modelOf = (tier, paid = []) => buildQuoteModel({ ...emptySelection(), docType: 'agreement', tier, influencer: 'choice', paid },
  { name: 'רונית', company: 'קפה רונית', phone: '050-1234567' });
async function sign(m) {
  const { rows } = await db.query("insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot, status) values ($1, 'רונית', 460200, 5522400, 'sent') returning id",
    [JSON.stringify(m)]);
  await db.query("update public.quotes set status = 'signed', signed_at = now() where id = $1", [rows[0].id]);
  const quote = (await db.query('select status from public.quotes where id = $1', [rows[0].id])).rows[0];
  const client = (await db.query('select * from public.clients where quote_id = $1', [rows[0].id])).rows[0] || null;
  return { quote, client };
}
const deal = (influencer) => db.query(
  "insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, created_by_email, seller) values ('עסק', 'א', '0501234567', 'social', $1, 'stav@astrateg.test', 'stav') returning influencer",
  [influencer]);

before(async () => {
  db = await freshDatabase();
});

test('the migration: the newest, runs twice, takes away only the deal check it adds again', async () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261130100000_manual_contracts.sql', '20261201100000_hidden_quotes.sql', '20261202100000_influencer_arik.sql']); // the manual contracts, the hidden quotes (5.11.2026) and Arik Mishali (8.11.2026) after it
  assert.deepEqual(SQL.replace(/--[^\n]*/g, '').match(/\b(drop|delete|truncate)\b[^\n]*/gi), ['drop constraint if exists deal_requests_influencer_check;']);
  assert.equal((SQL.replace(/--[^\n]*/g, '').match(/add constraint/g) || []).length, 1);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  // Back to the newest definitions (Arik Mishali's packages and checks, 8.11.2026).
  await db.exec(migrationSql('20261202100000_influencer_arik.sql'));
});

test('Stav\'s deal may leave the influencer to be chosen; an unknown one is refused', async () => {
  for (const inf of ['choice', 'natali', 'simeon', 'niro', 'hatzel']) assert.equal((await deal(inf)).rows[0].influencer, inf);
  await assert.rejects(deal('nobody'), /check/);
});

test('a signed "משפיען לבחירה" agreement: no shoot type, the package\'s name, Natali\'s quantities', async () => {
  const m = modelOf('social', ['photographer']);
  assert.equal(m.package.id, 'social-choice');
  const { quote, client } = await sign(m);
  assert.equal(quote.status, 'signed');
  assert.equal(client.shoot_type, null);
  assert.equal(client.package_name, 'Social all in one · משפיען לבחירה מרשימת המשפיענים של אסטרטג');
  assert.deepEqual(client.deliverables, { videos: 36, graphics: 36, shoot_days: 1, collabs: 0, stories: 0, ch14: 0, monthly: 96 });
  assert.equal(influencerToChoose(client), true, 'the card says "עוד לא נבחר"');
  assert.equal(influencerToChoose({ ...client, shoot_type: 'natali' }), false);
});

test('every package\'s quantities, as the app counts them', async () => {
  for (const id of Object.keys(PACKAGES)) {
    const model = { package: { id }, selection: { paid: [], free: {} } };
    const { rows } = await db.query('select public.package_deliverables($1) as d', [JSON.stringify(model)]);
    const app = packageDeliverables(model);
    for (const k of ['videos', 'graphics', 'shoot_days', 'collabs', 'stories', 'ch14']) assert.equal(rows[0].d[k] ?? 0, app[k] ?? 0, `${id} ${k}`);
  }
});
