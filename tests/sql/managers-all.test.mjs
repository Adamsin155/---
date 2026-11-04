// Irit, Ofir and Lior get what the owners have, except security and the payments app
// (supabase/migrations/20261128100000_managers_all.sql; the owner's decision of 4.11.2026;
// docs/ops.md, section 96), on every migration in a real Postgres (PGlite). Every role:
// the two owners, Irit, Ofir, Lior, Ilai, Noam, an editor (Nadia), Eli, Stav, and anon.
//   - the file: the newest, none of the three refused words, runs twice, never replaces
//     public.sees_money() or public.purge_client();
//   - money: sees_income() and what reads through it (the quotes with their amounts, the
//     prices next to each client, the sellers' deals), for the owners and the three only;
//   - the deal: the three hand one between Irit and Ofir; the pool's rule still holds;
//   - the archive for the managers, the permanent purge for the owners (Ofir lost it);
//   - the work that was the owners' (approvals, links, scripts, the Gantt, Metricool,
//     availability, the team's notifications, landing) now the three's too;
//   - security stays the owners': the vault code, WhatsApp and Metricool on/off, the
//     Claude connector, landing sign-in links, calendar feeds, old-system imports, payouts;
//   - everyone else exactly as before.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { emptySelection, buildQuoteModel, validateSelection } from '../../app/pricing.js';

const FILE = '20261128100000_managers_all.sql';
const PEOPLE = { owner: null, owner2: null, irit: 'irit', ofir: 'ofir', lior: 'lior', ilai: 'ilai', noam: 'noam', nadia: 'nadia', eli: 'eli', stav: 'stav' };
const ROLES = Object.keys(PEOPLE);
const OWNERS = ['owner', 'owner2'];
const THREE = ['irit', 'ofir', 'lior'];
const MONEY = [...OWNERS, ...THREE];
const REST = ['ilai', 'noam', 'nadia', 'eli', 'stav'];
const DENIED = /not allowed|permission denied/;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const CLIENT = { name: 'דנה לוי', company: 'קפה דנה', phone: '050-1234567' };
let db;
const users = {};
const ids = {};
const baseline = {};

const sel = (extra = {}) => ({ ...emptySelection(), docType: 'agreement', tier: 'social', influencer: 'simeon', ...extra });
async function create(selection, who) {
  validateSelection(selection);
  const model = buildQuoteModel(selection, CLIENT);
  const { rows } = await db.query(
    'insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot, created_by, created_by_email) values ($1, $2, $3, $4, $5, $6) returning *',
    [JSON.stringify(model), CLIENT.name, model.totals.monthlyGross, model.totals.termGross, users[who].id, users[who].email]);
  return rows[0];
}
// Committed (as() rolls back).
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
// Rolled back.
const tryQ = (who, sql, params = []) => as(db, who === 'anon' ? null : users[who], async (tx) => ({ rows: (await tx.query(sql, params)).rows }));
const q = async (who, sql, params = []) => {
  const out = await tryQ(who, sql, params);
  assert.equal(out.error, undefined, `${who}: ${out.error}`);
  return out.rows;
};
const one = async (who, sql, params = []) => Object.values((await q(who, sql, params))[0])[0];
const count = async (who, sql, params = []) => (await q(who, sql, params)).length;
const newDeal = async () => {
  const d = await call('stav', "insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, discount_agorot) values ('עסק', 'איש קשר', '050-0000000', 'social', 'simeon', 20000) returning id");
  assert.equal(d.error, undefined, d.error);
  return d.rows[0].id;
};

// What every role answers, the same questions before and after the file.
const FLAGS = ['sees_money', 'sees_quote_money', 'is_manager', 'can_archive_clients', 'can_approve_quotes', 'can_manage_status_links',
  'can_manage_scripts', 'can_edit_gantt', 'can_connect_metricool', 'can_manage_availability', 'is_vault_owner', 'is_office'];
async function snapshot(who) {
  const flags = {};
  for (const f of FLAGS) flags[f] = await one(who, `select public.${f}() as v`);
  return {
    flags,
    quotes: await count(who, 'select id from public.quotes'),
    finance: await count(who, 'select * from public.manager_client_finance()'),
    deals: await count(who, 'select id from public.deal_requests'),
    reminders: await count(who, 'select id from public.reminder_log'),
    archived: await count(who, 'select * from public.archived_clients()'),
    log: await count(who, 'select id from public.client_admin_log'),
    mcpPeople: await count(who, 'select * from public.mcp_people()'),
    feeds: await count(who, 'select * from public.calendar_feeds_team()'),
  };
}

before(async () => {
  db = await freshDatabase({ upTo: FILE });
  // The checks that allow Noam ran live by the owner's hand (supabase/pending/noam_checks.sql).
  await db.exec(readFileSync(new URL('../../supabase/pending/noam_checks.sql', import.meta.url), 'utf8'));
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  // A signed agreement (its client opens from it, with the prices next to it) and one out for signing.
  const signed = await create(sel({ discount: 20000 }), 'irit');
  ids.signed = signed.id;
  await call('anon', 'select public.sign_quote($1, $2, $3, true)', [signed.token, 'דנה לוי', PNG]);
  ids.client = (await db.query('select id from public.clients where quote_id = $1', [ids.signed])).rows[0].id;
  ids.sent = (await create(sel(), 'irit')).id;
  ids.deal = await newDeal();
  // A client already in the archive (the owner put it there), and two landing clients.
  ids.archived = (await db.query("insert into public.clients (name, business) values ('יוסי', 'מוסך יוסי') returning id")).rows[0].id;
  assert.equal((await call('owner', 'select public.archive_client($1)', [ids.archived])).error, undefined);
  ids.landing = (await db.query("insert into public.clients (name, business, landing) values ('רון', 'פיצה רון', true) returning id")).rows[0].id;
  // A notification for each of two people (the team's log).
  for (const person of ['ilai', 'nadia']) {
    await db.query("insert into public.reminder_log (key, rule, person, level, channel, status, title) values ($1, 'r', $2, 'ring', 'push', 'sent', 't')", [`k-${person}`, person]);
  }
  for (const who of ROLES) baseline[who] = await snapshot(who);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE)); // safe to run again
});

test('the file: the newest, none of the refused words, runs twice, leaves sees_money() and purge_client() alone', () => {
  const files = migrationFiles();
  assert.equal(files.at(-1), FILE);
  const sql = migrationSql(FILE);
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  const code = sql.replace(/--[^\n]*/g, '');
  const made = [...code.matchAll(/create\s+or\s+replace\s+function\s+([a-z_.]+)/gi)].map((m) => m[1]);
  assert.equal(made.includes('public.sees_money'), false);
  assert.equal(made.includes('public.purge_client'), false);
  for (const fn of ['public.payout_owners', 'public.vault_code_set', 'public.whatsapp_set_enabled', 'public.metricool_set_enabled', 'public.mcp_set_access', 'public.mcp_people', 'public.landing_link_make']) {
    assert.equal(made.includes(fn), false, fn);
  }
  assert.equal(/payout_/i.test(code), false);
});

test('who reads income: the owners and the three; sees_money() stays the two owners\'', async () => {
  for (const who of ROLES) {
    const r = (await q(who, 'select public.sees_income() as i, public.sees_money() as m, public.sees_quote_money() as qm, public.is_manager() as mg'))[0];
    assert.deepEqual(r, { i: MONEY.includes(who), m: OWNERS.includes(who), qm: MONEY.includes(who), mg: MONEY.includes(who) }, who);
  }
  for (const fn of ['sees_income', 'sees_money', 'sees_quote_money', 'is_manager']) {
    assert.match((await call('anon', `select public.${fn}()`)).error, /permission denied/, fn);
  }
});

test('the quotes with their amounts, the prices next to each client, the deals: the owners and the three', async () => {
  for (const who of MONEY) {
    assert.equal(await count(who, 'select id from public.quotes'), 2, who);
    const row = (await q(who, 'select term_gross_agorot, monthly_gross_agorot from public.quotes where id = $1', [ids.signed]))[0];
    assert.ok(row.term_gross_agorot > 0 && row.monthly_gross_agorot > 0, who);
    const fin = await q(who, 'select * from public.manager_client_finance()');
    assert.ok(fin.some((r) => r.client_id === ids.client && r.monthly_gross_agorot > 0 && r.discount_agorot === 20000), who);
    assert.equal(await count(who, 'select id from public.deal_requests'), 1, who);
    const facts = await q(who, 'select selection from public.quote_facts($1)', [[ids.signed]]);
    assert.equal(facts[0].selection.discount, 20000, who);
    assert.ok(await count(who, 'select id from public.quote_versions') >= 0, who);
  }
  for (const who of REST) {
    assert.deepEqual(await q(who, 'select term_gross_agorot from public.quotes'), [], who);
    assert.deepEqual(await q(who, 'select * from public.manager_client_finance()'), [], who);
    assert.equal(await count(who, 'select id from public.deal_requests'), who === 'stav' ? 1 : 0, who);
  }
  // The office without money still gets the agreement without it.
  for (const who of ['ilai', 'noam']) {
    const facts = await q(who, 'select selection from public.quote_facts($1)', [[ids.signed]]);
    assert.equal(facts.length, 1, who);
    assert.equal(facts[0].selection.discount, undefined, who);
  }
  assert.match((await call('anon', 'select * from public.manager_client_finance()')).error, /permission denied/);
});

test('handing a deal between Irit and Ofir: the owners and the three; the pool still holds', async () => {
  const d = await newDeal();
  // Irit takes it; Ofir cannot take it from her by any write of his own.
  assert.equal((await call('irit', 'select public.deal_take($1) as r', [d])).rows[0].r.ok, true);
  assert.equal((await call('ofir', 'select public.deal_take($1) as r', [d])).rows[0].r.ok, false);
  assert.match((await call('ofir', "update public.deal_requests set taken_by = 'ofir' where id = $1", [d])).error, /deal_taken/);
  assert.match((await call('ofir', "update public.deal_requests set notes = 'x' where id = $1", [d])).error, /deal_taken/);
  // Lior hands it to Ofir, Ofir to Irit, Irit to Ofir; the owner as before.
  for (const [who, to] of [['lior', 'ofir'], ['ofir', 'irit'], ['irit', 'ofir'], ['owner', 'irit']]) {
    const r = await call(who, 'select public.deal_hand_over($1, $2) as r', [d, to]);
    assert.equal(r.error, undefined, `${who}: ${r.error}`);
    assert.equal(r.rows[0].r.taken_by, to, who);
  }
  // Nobody else hands a deal; only to Irit or Ofir; only a waiting one.
  for (const who of REST) assert.match((await tryQ(who, 'select public.deal_hand_over($1, $2)', [d, 'ofir'])).error, DENIED, who);
  assert.match((await tryQ('anon', 'select public.deal_hand_over($1, $2)', [d, 'ofir'])).error, /permission denied/);
  assert.match((await tryQ('lior', 'select public.deal_hand_over($1, $2)', [d, 'lior'])).error, /invalid person/);
  assert.match((await tryQ('lior', 'select public.deal_hand_over($1, $2)', ['00000000-0000-0000-0000-000000000000', 'ofir'])).error, /deal not waiting/);
  // The hand-over flag after the function is off again: in the same transaction, Ofir's own write is refused.
  const same = await tryQ('ofir', "select public.deal_hand_over($1, 'ofir'); update public.deal_requests set taken_by = 'irit' where id = $1", [d]);
  assert.ok(same.error, 'a second write after a hand-over is checked again');
  // Lior takes no deal (the pool is Irit's and Ofir's), and a seller's own write still cannot take one.
  assert.match((await tryQ('lior', 'select public.deal_take($1)', [d])).error, DENIED);
  assert.match((await tryQ('stav', "update public.deal_requests set taken_by = 'irit' where id = $1", [d])).error || 'no row', /deal_taken|no row/);
});

test('the archive for the managers; the permanent purge for the owners only (Ofir lost it)', async () => {
  for (const who of ROLES) assert.equal(await one(who, 'select public.can_archive_clients() as v'), OWNERS.includes(who), who);
  for (const who of THREE) {
    assert.equal(await count(who, 'select * from public.archived_clients()'), 1, who);
    assert.ok(await count(who, 'select id from public.client_admin_log') >= 1, who);
    const a = await tryQ(who, 'select public.archive_client($1) as r', [ids.client]);
    assert.equal(a.error, undefined, `${who}: ${a.error}`);
    const r = await tryQ(who, 'select public.restore_client($1) as r', [ids.archived]);
    assert.equal(r.error, undefined, `${who}: ${r.error}`);
    assert.match((await tryQ(who, 'select public.purge_client($1, $2)', [ids.archived, 'מוסך יוסי'])).error, /not allowed/, who);
  }
  for (const who of REST) {
    assert.match((await tryQ(who, 'select public.archive_client($1)', [ids.client])).error, DENIED, who);
    assert.match((await tryQ(who, 'select public.restore_client($1)', [ids.archived])).error, DENIED, who);
    assert.match((await tryQ(who, 'select public.purge_client($1, $2)', [ids.archived, 'מוסך יוסי'])).error, DENIED, who);
    assert.equal(await count(who, 'select * from public.archived_clients()'), 0, who);
    assert.equal(await count(who, 'select id from public.client_admin_log'), 0, who);
  }
  assert.match((await tryQ('anon', 'select public.purge_client($1, $2)', [ids.archived, 'מוסך יוסי'])).error, /permission denied/);
  // The owner still purges (rolled back here).
  const p = await tryQ('owner', 'select public.purge_client($1, $2) as r', [ids.archived, 'מוסך יוסי']);
  assert.equal(p.error, undefined, p.error);
  assert.equal(p.rows[0].r.id, ids.archived);
});

test('the work that was the owners\' is the three\'s too', async () => {
  const want = {
    can_approve_quotes: [...MONEY],
    can_manage_status_links: [...MONEY],
    can_manage_scripts: [...MONEY],
    can_edit_gantt: [...MONEY, 'ilai'],
    can_connect_metricool: [...MONEY, 'ilai', 'noam'],
    can_manage_availability: [...MONEY],
  };
  for (const [fn, who] of Object.entries(want)) {
    for (const r of ROLES) assert.equal(await one(r, `select public.${fn}() as v`), who.includes(r), `${fn}: ${r}`);
  }
  // The team's notifications: the owners, Lior (as before), Irit and Ofir.
  for (const who of MONEY) assert.equal(await count(who, 'select id from public.reminder_log'), 2, who);
  for (const who of ['ilai', 'nadia']) assert.equal(await count(who, 'select id from public.reminder_log'), 1, who);
  for (const who of ['noam', 'eli', 'stav']) assert.equal(await count(who, 'select id from public.reminder_log'), 0, who);
  // Landing: closing a person's part and activating clients.
  for (const who of [...OWNERS, ...THREE]) {
    assert.equal((await tryQ(who, 'select public.landing_done_for($1, $2) as n', ['ilai', [ids.landing]])).error, undefined, who);
    const act = await tryQ(who, 'select public.landing_activate($1) as n', [[ids.landing]]);
    assert.equal(act.error, undefined, `${who}: ${act.error}`);
    assert.equal(act.rows[0].n, 1, who);
  }
  for (const who of REST) {
    assert.match((await tryQ(who, 'select public.landing_done_for($1, $2)', ['ilai', [ids.landing]])).error, DENIED, who);
    assert.match((await tryQ(who, 'select public.landing_activate($1)', [[ids.landing]])).error, DENIED, who);
  }
  // Irit approves an exceptional contract, never one she prepared.
  const custom = { price: 420000, discount: 35000, termMonths: 6, lines: [{ label: 'אתר', qty: 1, monthly: 50000 }], terms: 'תנאי.' };
  const mine = await create(sel({ custom }), 'irit');
  const byLior = await create(sel({ custom }), 'lior');
  if (mine.approval === 'pending') {
    assert.match((await tryQ('irit', 'select public.quote_approve($1)', [mine.id])).error, /cannot approve a contract you prepared/);
    assert.equal((await tryQ('irit', 'select public.quote_approve($1)', [byLior.id])).error, undefined);
  }
});

test('security stays the owners\': the vault code, WhatsApp, Metricool, the Claude connector, landing links, feeds, imports', async () => {
  const OWNER_ONLY = [
    ['select public.vault_code_set($1)', ['123456']],
    ['select public.whatsapp_set_enabled(false)', []],
    ['select public.whatsapp_set_provider($1)', ['jako']],
    ['select public.metricool_set_enabled(false)', []],
    ['select public.mcp_set_access($1, true)', ['lior@astrateg.test']],
    ['select public.landing_link_make($1)', ['ilai']],
    ['select public.landing_link_revoke($1)', ['ilai']],
    ['select public.landing_links()', []],
    ['select public.legacy_contract_import($1, $2)', [null, { id: '1' }]],
    ['select public.legacy_characterization_import($1, $2)', [null, {}]],
  ];
  for (const who of [...THREE, ...REST]) {
    for (const [sql, params] of OWNER_ONLY) assert.match((await tryQ(who, sql, params)).error || 'answered', /not allowed|owner only/, `${who}: ${sql}`);
    assert.equal(await one(who, 'select public.is_vault_owner() as v'), false, who);
    assert.equal(await count(who, 'select * from public.mcp_people()'), 0, who);
    assert.equal(await count(who, 'select * from public.calendar_feeds_team()'), 0, who);
    assert.equal(await count(who, 'select * from public.mcp_access'), 0, who);
  }
  // The owner still may (each rolled back).
  assert.equal((await tryQ('owner', 'select public.landing_link_make($1)', ['ilai'])).error, undefined);
  assert.equal((await tryQ('owner', 'select public.mcp_set_access($1, true)', ['lior@astrateg.test'])).error, undefined);
  assert.ok(await count('owner', 'select * from public.mcp_people()') > 0);
});

test('the payments app is untouched: the three read none of it and add nobody', async () => {
  await db.query('insert into public.payout_owners (user_id, email) values ($1, $2) on conflict do nothing', [users.owner.id, users.owner.email]);
  for (const table of ['payout_settings', 'payout_deals', 'payout_incomes', 'payout_expenses', 'payout_locks', 'payout_performed']) {
    for (const who of ['owner2', ...THREE, ...REST]) {
      const out = await call(who, `select count(*)::int as n from public.${table}`);
      assert.ok(out.error ? /permission denied/.test(out.error) : out.rows[0].n === 0, `${who}: ${table}`);
    }
    assert.equal((await call('owner', `select count(*)::int as n from public.${table}`)).error, undefined, table);
    assert.match((await call('anon', `select count(*) from public.${table}`)).error, /permission denied/, table);
  }
  for (const who of THREE) {
    assert.equal(await count(who, 'select * from public.payout_owners'), 0, who);
    assert.match((await call(who, 'insert into public.payout_owners (user_id, email) values ($1, $2)', [users[who].id, users[who].email])).error, /permission denied/, who);
  }
});

test('everyone else exactly as before; the owners as before', async () => {
  for (const who of [...REST, ...OWNERS]) {
    const now = await snapshot(who);
    // The tests above added quotes and deals (and moved the archive inside rolled-back
    // calls): those numbers are checked there; every flag and every other number here.
    const same = (s) => ({ ...s, archived: 0, log: 0, quotes: 0, deals: 0 });
    assert.deepEqual(same(now), same(baseline[who]), who);
  }
  // Before the file the three had less: the record of what changed for them.
  assert.deepEqual(THREE.map((w) => baseline[w].finance > 0), [false, false, false]);
  assert.deepEqual(THREE.map((w) => baseline[w].deals), [1, 1, 0]);
  assert.deepEqual(THREE.map((w) => baseline[w].flags.can_archive_clients), [false, true, false]);
  assert.deepEqual(THREE.map((w) => baseline[w].flags.is_manager), [true, true, false]);
});

test('a connected app may ask sees_income (the mcp function\'s money), and nothing else new', async () => {
  const { rows } = await db.query("select prosrc from pg_proc where proname = 'mcp_request_gate'");
  assert.match(rows[0].prosrc, /'\/rpc\/sees_income'/);
  assert.match(rows[0].prosrc, /'\/rpc\/is_office', '\/rpc\/my_person', '\/rpc\/mcp_allowed', '\/rpc\/sees_money', '\/rpc\/sees_income'\)/);
  // A browser session still passes the gate without a key.
  assert.equal((await tryQ('irit', 'select public.mcp_request_gate()')).error, undefined);
});
