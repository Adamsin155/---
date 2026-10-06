// The owner's decisions of 3.10.2026 in the database
// (supabase/migrations/20261003100000_sales_deals.sql), on every migration in a real
// Postgres (PGlite): Stav's deals (who reads, adds and moves them; who and when are
// stamped by the database; the quote linked makes it "sent", the quote signed makes it
// "signed"), Stav sees nothing of the clients, the protocol, the vault, the quotes or
// the payouts, the characterization defaults to Ofir, protocol version 6, graphics
// approved before it count as posted, and the migration runs twice safely.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { validateDeal } from '../../app/deal-logic.js';

const MIGRATION = '20261003100000_sales_deals.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', eli: 'eli', stav: 'stav' };
let db;
const users = {};
const ids = {};

before(async () => {
  // Before the migration, with graphics already approved for one client.
  db = await freshDatabase({ upTo: MIGRATION });
  const { rows } = await db.query("insert into public.clients (name, shoot_type) values ('approved', 'dms') returning id");
  ids.approved = rows[0].id;
  for (const k of ['p07.approved', 'p23.approved']) {
    await db.query("insert into public.protocol_checks (client_id, item_key, state, note) values ($1, $2, 'done', 'אושר')", [ids.approved, k]);
  }
  // The migration, twice (safe to run again).
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));

  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, true)', [email, person]);
  }
  // Something in every table Stav must not see.
  const c = await db.query("insert into public.clients (name, phone, notes, shoot_type, editor) values ('דנה', '050-1234567', 'פנימי', 'dms', 'nadia') returning id");
  ids.dana = c.rows[0].id;
  await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p01.signed', 'done')", [ids.dana]);
  await db.query("insert into public.client_tasks (client_id, title, owner, created_by_email) values ($1, 'משימה', 'irit', 'lior@astrateg.test')", [ids.dana]);
  await db.query("insert into public.client_access (client_id, network, username, secret_id) values ($1, 'instagram', 'dana_ig', vault.create_secret('pw'))", [ids.dana]);
  await db.query("insert into public.client_status_notes (client_id, week, current, missing, next) values ($1, '2026-10-04', 'א', 'ב', 'ג')", [ids.dana]).catch(() => {});
  const q = await db.query("insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot) values ($1, 'דנה', 100000, 1200000) returning id",
    [JSON.stringify({ client: { name: 'דנה', company: 'קפה דנה', phone: '050-1234567' }, package: { tierName: 'Social' }, selection: { influencer: 'simeon' }, totals: {}, signable: true })]);
  ids.quote = q.rows[0].id;
});

const run = (who, fn) => as(db, who === 'anon' ? null : users[who], fn);
const q = (who, sql, params = []) => run(who, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows };
});
const DEAL = validateDeal({ business_name: 'פיצה רון', contact_name: 'רון', phone: '050-7654321', tier: 'social', influencer: 'natali', paid: ['photographer'], discount: 100, notes: 'לחזור אחרי 17:00' }).row;
const insertDeal = (who, extra = {}) => q(who,
  `insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, paid, free, discount_agorot, notes ${Object.keys(extra).map((k) => `, ${k}`).join('')})
   values ($1, $2, $3, $4, $5, $6, $7, $8, $9 ${Object.keys(extra).map((_, i) => `, $${10 + i}`).join('')}) returning *`,
  [DEAL.business_name, DEAL.contact_name, DEAL.phone, DEAL.tier, DEAL.influencer, DEAL.paid, JSON.stringify(DEAL.free), DEAL.discount_agorot, DEAL.notes, ...Object.values(extra)]);

test('Stav adds a deal: the database stamps who, when and "waiting for a contract", whatever the browser sends', async () => {
  const r = await insertDeal('stav', { status: 'signed', created_by_email: 'someone@else', quote_id: ids.quote });
  assert.equal(r.rows.length, 1, JSON.stringify(r));
  const d = r.rows[0];
  assert.equal(d.created_by_email, 'stav@astrateg.test');
  assert.equal(d.seller, 'stav');
  assert.equal(d.status, 'pending');
  assert.equal(d.quote_id, null);
  assert.equal(d.discount_agorot, 10000);
  assert.deepEqual(d.paid, ['photographer']);
  // A bad row is refused by the table itself.
  assert.match((await q('stav', "insert into public.deal_requests (business_name, contact_name, phone, tier, influencer) values ('x', 'y', '050', 'gold', 'natali')")).error, /check constraint/);
  // Only sales adds deals.
  for (const who of ['irit', 'nadia', 'eli', 'owner']) assert.match((await insertDeal(who)).error, /row-level security/, who);
  assert.match((await insertDeal('anon')).error, /permission denied/);
});

test('Stav reads only his own deals and never moves them; the office reads all and moves them', async () => {
  const own = (await db.query("insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, created_by_email, seller) values ('שלו', 'א', '0501234567', 'social', 'simeon', 'stav@astrateg.test', 'stav') returning id")).rows[0].id;
  const other = (await db.query("insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, created_by_email) values ('של אחר', 'ב', '0501234567', 'podcast', 'natali', 'old-seller@astrateg.test') returning id")).rows[0].id;
  const mine = (await q('stav', 'select id, business_name, status from public.deal_requests')).rows;
  assert.ok(mine.some((d) => d.id === own));
  assert.ok(!mine.some((d) => d.id === other));
  assert.equal((await q('stav', "update public.deal_requests set status = 'signed' where id = $1", [own])).affected, 0);
  const del = await q('stav', 'delete from public.deal_requests where id = $1', [own]);
  assert.ok(del.error || del.affected === 0, 'no deleting');
  for (const who of ['irit', 'lior', 'ofir', 'ilai', 'owner']) {
    const all = (await q(who, 'select id from public.deal_requests')).rows.map((r) => r.id);
    assert.ok(all.includes(own) && all.includes(other), who);
  }
  for (const who of ['nadia', 'eli']) assert.deepEqual((await q(who, 'select id from public.deal_requests')).rows, [], who);
  // Irit sends the contract: linking the quote makes it "sent", stamped.
  const sent = await run('irit', async (tx) => {
    await tx.query('update public.deal_requests set quote_id = $1 where id = $2', [ids.quote, own]);
    return (await tx.query('select status, sent_at, status_by_email, created_by_email, seller from public.deal_requests where id = $1', [own])).rows[0];
  });
  assert.equal(sent.status, 'sent');
  assert.ok(sent.sent_at);
  assert.equal(sent.status_by_email, 'irit@astrateg.test');
  // The seller and the time it came in never change.
  const keep = await run('irit', async (tx) => {
    await tx.query("update public.deal_requests set created_by_email = 'x@y', seller = null, status = 'cancelled' where id = $1", [other]);
    return (await tx.query('select status, created_by_email from public.deal_requests where id = $1', [other])).rows[0];
  });
  assert.deepEqual(keep, { status: 'cancelled', created_by_email: 'old-seller@astrateg.test' });
});

test('the quote of a deal signed: the deal is "signed" (and the client opens as before)', async () => {
  const deal = (await db.query("insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, created_by_email, seller) values ('קפה דנה', 'דנה', '0501234567', 'social', 'simeon', 'stav@astrateg.test', 'stav') returning id")).rows[0].id;
  await db.query('update public.deal_requests set quote_id = $1 where id = $2', [ids.quote, deal]);
  assert.equal((await db.query('select status from public.deal_requests where id = $1', [deal])).rows[0].status, 'sent');
  await db.query("update public.quotes set status = 'signed', signed_at = now(), signer_name = 'דנה' where id = $1", [ids.quote]);
  const d = (await db.query('select status, signed_at from public.deal_requests where id = $1', [deal])).rows[0];
  assert.equal(d.status, 'signed');
  assert.ok(d.signed_at);
  // open_client_on_signing still opened the client, with the characterization on Ofir by default.
  const c = (await db.query('select characterizer, protocol_version from public.clients where quote_id = $1', [ids.quote])).rows[0];
  assert.deepEqual(c, { characterizer: 'ofir', protocol_version: 6 }); // this database stops at this migration (version 6)
  // Stav sees it signed.
  assert.equal((await q('stav', 'select status from public.deal_requests where id = $1', [deal])).rows[0].status, 'signed');
});

test('Stav sees no client, item, task, vault, quote, payout or office table: every public table, as him', async () => {
  // What he may read: his deals, his own staff row and reminders, and a few settings.
  const OWN = new Set(['deal_requests', 'staff', 'reminder_log', 'push_subscriptions', 'whatsapp_consents', 'whatsapp_consent_log', 'whatsapp_messages', 'calendar_feeds']);
  const SETTINGS = new Set(['app_settings', 'whatsapp_consent_texts']);
  const tables = (await db.query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.tablename);
  assert.ok(tables.includes('clients') && tables.includes('quotes') && tables.includes('deal_requests'));
  const seen = [];
  for (const t of tables) {
    if (SETTINGS.has(t)) continue;
    const r = await q('stav', `select count(*)::int as n from public.${t}`);
    const n = r.error ? 0 : r.rows[0].n;
    if (OWN.has(t)) continue;
    if (n > 0) seen.push(`${t}: ${n}`);
  }
  assert.deepEqual(seen, [], 'Stav must not read these');
  // The office's sanity: the same tables are not empty for Irit (so the check above means something).
  for (const t of ['clients', 'protocol_checks', 'client_tasks', 'quotes']) assert.ok((await q('irit', `select count(*)::int as n from public.${t}`)).rows[0].n > 0, t);
  // (The staff list, names and emails of the team, stays readable to every staff login, as before.)
  // Nothing through the functions either.
  assert.equal((await q('stav', 'select public.is_office() as o')).rows[0].o, false);
  assert.equal((await q('stav', 'select public.can_see_client($1) as s', [ids.dana])).rows[0].s, false);
  assert.equal((await q('stav', 'select public.can_use_client_vault($1) as s', [ids.dana])).rows[0].s, false);
  assert.deepEqual((await q('stav', 'select * from public.clients_private()')).rows, []);
  // No writing either.
  assert.match((await q('stav', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p02.opened', 'done')", [ids.dana])).error, /row-level security/);
  assert.match((await q('stav', "insert into public.clients (name) values ('x')")).error, /row-level security/);
});

test('the rest of the migration: Stav in the reminders, Ofir by default, version 6, approved graphics posted', async () => {
  await db.query("insert into public.reminder_log (key, rule, person, level, channel, status, title) values ('dealSigned:-:x:seller@stav', 'dealSigned', 'stav', 'quiet', 'app', 'sent', 'פיצה רון חתם 🎉')");
  assert.equal((await q('stav', 'select title from public.reminder_log')).rows.map((r) => r.title).includes('פיצה רון חתם 🎉'), true);
  const c = (await db.query("insert into public.clients (name) values ('ברירת מחדל') returning characterizer, protocol_version")).rows[0];
  assert.deepEqual(c, { characterizer: 'ofir', protocol_version: 6 }); // this database stops at this migration (version 6)
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 6);
  // Approved before 7ב and 23ב existed: posted, as imported history (once, though the migration ran twice).
  const posted = (await db.query("select item_key, note from public.protocol_checks where client_id = $1 and item_key like 'p%b.posted' order by 1", [ids.approved])).rows;
  assert.deepEqual(posted, [{ item_key: 'p07b.posted', note: 'ייבוא' }, { item_key: 'p23b.posted', note: 'ייבוא' }]);
  // The station-change message is in the templates.
  assert.equal((await db.query("select kind from public.message_templates where key = 'station_change'")).rows[0].kind, 'milestone');
});
