// Amos is a field sales agent like Stav (supabase/migrations/20261005100000_sales_amos.sql):
// he adds deals stamped as his, reads only his own, and sees no client. Stav does not
// read Amos's deals. The migration runs twice safely.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { PEOPLE, SCOPE } from '../../app/protocol.js';

const MIGRATION = '20261005100000_sales_amos.sql';
let db;
const users = {};

before(async () => {
  db = await freshDatabase();
  await db.exec(migrationSql(MIGRATION));
  for (const [key, person] of Object.entries({ irit: 'irit', stav: 'stav', amos: 'amos' })) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
  await db.query("insert into public.clients (name, shoot_type) values ('דנה', 'dms')");
  // Kept deals, one of each seller (the table owner writes them; `as` rolls back what a user adds).
  for (const who of ['amos', 'stav']) {
    await db.query(
      "insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, created_by_email, seller) values ($1, 'א', '050-1234567', 'social', 'natali', $2, $3)",
      [`deal of ${who}`, `${who}@astrateg.test`, who],
    );
  }
});

const q = (who, sql, params = []) => as(db, users[who], async (tx) => (await tx.query(sql, params)).rows);
const DEAL = "insert into public.deal_requests (business_name, contact_name, phone, tier, influencer) values ($1, 'א', '050-1234567', 'social', 'natali') returning seller, created_by_email, status";

test('Amos is sales in the app as in the database', () => {
  assert.equal(PEOPLE.amos.sales, true);
  assert.equal(SCOPE.amos, 'sales');
});

test('Amos adds a deal stamped as his; he and Stav each read only their own; the office reads both', async () => {
  const mine = await as(db, users.amos, async (tx) => {
    const added = (await tx.query(DEAL, ['new of amos'])).rows[0];
    const seen = (await tx.query('select business_name from public.deal_requests')).rows.map((r) => r.business_name);
    return { added, seen };
  });
  assert.deepEqual(mine.added, { seller: 'amos', created_by_email: 'amos@astrateg.test', status: 'pending' });
  assert.deepEqual(mine.seen.sort(), ['deal of amos', 'new of amos']);
  assert.deepEqual((await q('stav', 'select business_name from public.deal_requests')).map((r) => r.business_name), ['deal of stav']);
  assert.equal((await q('irit', 'select 1 from public.deal_requests')).length, 2);
});

test('Amos sees no client', async () => {
  assert.equal((await q('amos', 'select id from public.clients')).length, 0);
});
