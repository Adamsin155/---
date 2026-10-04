// The manager's features (supabase/migrations/20261003140000_manager_features.sql;
// docs/ops.md, section 19) in a real Postgres with every migration (PGlite):
//   - the managers (the owner, Irit, Ofir) and who archives (the owner, Ofir);
//   - screen 1 for Irit and Ofir: the login statuses without the vault flag;
//   - the prices for the managers only, never Lior (nor Ilai, nor an editor);
//   - archive: hidden from everyone, everywhere (the client, its checks, history,
//     tasks, questions, the vault, the office's columns, the status page), the
//     archive columns move only through the functions, restore brings it all back;
//   - permanent deletion: only an archived client, only with its name typed again,
//     removes everything with its client_id and its Vault secrets, and the log keeps
//     who, when and the business name only;
//   - what a signed agreement grants: the database's package_deliverables() is the
//     app's packageDeliverables() for every package and add-on, a podcast agreement
//     stores its photographer's shoot day, and the backfill keeps what is there;
//   - the migration runs twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { packageDeliverables } from '../../app/protocol-logic.js';
import { PACKAGES, PAID_ADDONS, TIERS, INFLUENCERS } from '../../app/catalog.js';

const MIGRATION = '20261003140000_manager_features.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia' };
const DENIED = /not allowed|permission denied|row-level security/;
let db;
const users = {};
const ids = {};

const model = (id, selection = {}, extra = {}) => {
  const p = PACKAGES[id];
  return {
    signable: true, termMonths: 12, client: { name: 'רונית', company: 'מספרת רון', phone: '050-1111111' },
    package: { id, tierName: TIERS.find((t) => t.id === p.tier).name, influencer: INFLUENCERS[p.influencer].name },
    selection: { tier: p.tier, influencer: p.influencer, paid: [], free: {}, ...selection },
    totals: { monthlyNet: p.price, discount: 0 },
    ...extra,
  };
};
async function sign(m, name = 'רונית') {
  const { rows } = await db.query("insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot, status) values ($1, $2, 460200, 5522400, 'sent') returning id",
    [JSON.stringify(m), name]);
  await db.query("update public.quotes set status = 'signed', signed_at = now() where id = $1", [rows[0].id]);
  return (await db.query('select * from public.clients where quote_id = $1', [rows[0].id])).rows[0];
}

before(async () => {
  // The database as it is live before this migration, with an agreement already signed.
  db = await freshDatabase({ upTo: MIGRATION });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    // Irit and Ofir without the vault flag: screen 1 must not depend on it.
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, key === 'owner' || key === 'lior']);
  }
  const old = await sign(model('podcast-natali', { free: { simeonJoin: true } }), 'פודקאסט ישן');
  ids.old = old.id;
  await db.query("update public.clients set deliverables = deliverables || '{\"videos\": 18}' where id = $1", [old.id]); // the office changed a number
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION)); // safe to run again

  const signed = await sign(model('social-tv-simeon', { paid: ['simeon-day'], free: { graphics: 4 } }));
  ids.dana = signed.id;
  await db.query("update public.clients set business = 'קפה דנה', name = 'דנה', phone = '050-1234567', notes = 'פנימי', editor = 'nadia', shoot_type = 'dms' where id = $1", [ids.dana]);
  ids.other = (await db.query("insert into public.clients (name, business, editor) values ('יוסי', 'מוסך יוסי', 'nadia') returning id")).rows[0].id;
  const c = ids.dana;
  await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p02.opened', 'done'), ($1, 'p04.address', 'done')", [c]);
  await db.query("insert into public.client_tasks (client_id, title, owner) values ($1, 'משימה', 'nadia')", [c]);
  await db.query("insert into public.client_questions (client_id, to_person, question) values ($1, 'irit', 'מה המצב?')", [c]);
  const sec = (await db.query("select vault.create_secret('pw', 'client_access:x', 'x') as id")).rows[0].id;
  await db.query("insert into public.client_access (client_id, network, username, status, secret_id) values ($1, 'instagram', 'dana_ig', 'broken', $2)", [c, sec]);
  await db.query("insert into public.reminder_log (key, rule, person, level, channel, status, title, client_id) values ('k:dana', 'test', 'irit', 'quiet', 'app', 'sent', 'קפה דנה: תזכורת', $1)", [c]);
  await db.query("insert into public.change_requests (client_id, problem, why, proposal) values ($1, 'בעיה', 'למה', 'הצעה')", [c]);
  await db.query("insert into public.client_access (client_id, network, status) values ($1, 'facebook', 'ok')", [ids.other]);
});

const run = (who, fn) => as(db, who === 'anon' ? null : users[who], fn);
const q = (who, sql, params = []) => run(who, async (tx) => (await tx.query(sql, params)).rows);
// Committed (as() rolls back).
async function keep(who, sql, params = []) {
  const u = who === 'anon' ? null : users[who];
  let out;
  try {
    await db.transaction(async (tx) => {
      await tx.query(`set local role ${u ? 'authenticated' : 'anon'}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(u ? { sub: u.id, email: u.email, role: 'authenticated' } : { role: 'anon' })]);
      out = (await tx.query(sql, params)).rows;
    });
  } catch (err) {
    return { error: err.message };
  }
  return out;
}

test('the managers are the owner, Irit and Ofir; the owner and Ofir archive', async () => {
  for (const [who, manager, archiver] of [['owner', true, true], ['irit', true, false], ['ofir', true, true], ['lior', false, false], ['ilai', false, false], ['nadia', false, false]]) {
    const [r] = await q(who, 'select public.is_manager() as m, public.can_archive_clients() as a');
    assert.deepEqual([r.m, r.a], [manager, archiver], who);
  }
  assert.match((await q('anon', 'select public.is_manager()')).error, /permission denied/);
});

test('screen 1 for Irit and Ofir: the login statuses without the vault flag, never a user name', async () => {
  for (const who of ['owner', 'irit', 'ofir']) {
    const rows = await q(who, 'select * from public.access_status_overview()');
    assert.equal(rows.length, 2, who);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['client_id', 'network', 'status', 'updated_at']);
  }
  for (const who of ['lior', 'ilai', 'nadia']) assert.deepEqual(await q(who, 'select * from public.access_status_overview()'), [], who);
  // Without the flag Irit still cannot read the vault's rows themselves.
  assert.deepEqual(await q('irit', 'select username from public.client_access'), []);
});

test('the prices: the managers only, never Lior', async () => {
  for (const who of ['owner', 'irit', 'ofir']) {
    const rows = await q(who, 'select * from public.manager_client_finance() where client_id = $1', [ids.dana]);
    assert.equal(rows.length, 1, who);
    assert.equal(rows[0].monthly_gross_agorot, 460200);
    assert.equal(rows[0].term_gross_agorot, 5522400);
    assert.equal(rows[0].monthly_net_agorot, PACKAGES['social-tv-simeon'].price);
    assert.equal(rows[0].term_months, 12);
  }
  for (const who of ['lior', 'ilai', 'nadia']) assert.deepEqual(await q(who, 'select * from public.manager_client_finance()'), [], who);
});

test('archiving: only the owner and Ofir', async () => {
  for (const who of ['irit', 'lior', 'ilai', 'nadia']) assert.match((await q(who, 'select public.archive_client($1)', [ids.dana])).error, DENIED, who);
  assert.match((await q('anon', 'select public.archive_client($1)', [ids.dana])).error, /permission denied/);
  // Not by writing the column either: the office's update keeps it as it was.
  await keep('irit', "update public.clients set archived_at = now(), archived_by = 'irit@astrateg.test' where id = $1", [ids.dana]);
  assert.equal((await db.query('select archived_at from public.clients where id = $1', [ids.dana])).rows[0].archived_at, null);
  assert.equal((await q('irit', "select public.archived_clients()")).length, 0);
});

test('an archived client is hidden from everyone, on every table, and its status link and vault close', async () => {
  const c = ids.dana;
  const [{ l }] = await keep('irit', 'select public.status_link_create($1) as l', [c]);
  assert.ok(Array.isArray((await keep('anon', 'select public.get_status($1) as s', [l.token]))[0].s.items));
  const before = {
    client: await q('owner', 'select id from public.clients where id = $1', [c]),
    checks: await q('irit', 'select 1 from public.protocol_checks where client_id = $1', [c]),
    editor: await q('nadia', 'select id from public.clients where id = $1', [c]),
  };
  assert.equal(before.client.length, 1);
  assert.equal(before.checks.length, 5); // 2 and the 3 the signature marked
  assert.equal(before.editor.length, 1);

  const [{ a }] = await keep('ofir', 'select public.archive_client($1) as a', [c]);
  assert.ok(a.archived_at);
  assert.equal(a.archived_by, 'ofir@astrateg.test');
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai', 'nadia']) {
    assert.deepEqual(await q(who, 'select id from public.clients where id = $1', [c]), [], `${who}: the client`);
    for (const t of ['protocol_checks', 'protocol_log', 'client_tasks', 'client_questions', 'client_access', 'client_status_links', 'reminder_log', 'change_requests']) {
      assert.deepEqual(await q(who, `select 1 from public.${t} where client_id = $1`, [c]), [], `${who}: ${t}`);
    }
    const [r] = await q(who, 'select public.can_see_client($1) as s, public.can_use_client_vault($1) as v', [c]);
    assert.deepEqual([r.s, r.v], [false, false], who);
  }
  assert.deepEqual(await q('owner', 'select * from public.clients_private(array[$1]::uuid[])', [c]), []);
  assert.deepEqual(await q('owner', 'select * from public.manager_client_finance() where client_id = $1', [c]), []);
  assert.equal((await q('owner', 'select * from public.access_status_overview()')).length, 1); // the other client's only
  // Nothing can be written on it, even by the office.
  assert.match((await q('irit', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p03.call', 'done')", [c])).error, /row-level security/);
  assert.match((await q('owner', "insert into public.client_tasks (client_id, title, owner) values ($1, 'x', 'irit')", [c])).error, /row-level security/);
  assert.equal((await q('irit', "update public.clients set name = 'x' where id = $1 returning id", [c])).length, 0);
  // The client's status page answers "closed", and the vault cannot be opened.
  const s = (await keep('anon', 'select public.get_status($1) as s', [l.token]))[0].s;
  assert.equal(s.items, undefined);
  assert.equal(s.state, 'closed');
  const accessId = (await db.query("select id from public.client_access where client_id = $1 and network = 'instagram'", [c])).rows[0].id;
  assert.match((await q('owner', 'select public.access_reveal($1)', [accessId])).error, /not allowed/);
  // The archive: the owner and Ofir, with the business name.
  const list = await q('owner', 'select * from public.archived_clients()');
  assert.deepEqual(list.map((r) => [r.id, r.label, r.archived_by]), [[c, 'קפה דנה', 'ofir@astrateg.test']]);
  assert.equal((await q('ofir', 'select * from public.archived_clients()')).length, 1);
  for (const who of ['irit', 'lior', 'nadia']) assert.deepEqual(await q(who, 'select * from public.archived_clients()'), [], who);
  // Archiving again changes nothing; the other client stays in every list.
  const again = (await keep('owner', 'select public.archive_client($1) as a', [c]))[0].a;
  assert.equal(again.archived_by, 'ofir@astrateg.test');
  assert.equal((await q('irit', 'select id from public.clients where id = $1', [ids.other])).length, 1);
  // Restore: everything is back, for everyone who saw it.
  assert.match((await q('irit', 'select public.restore_client($1)', [c])).error, DENIED);
  await keep('owner', 'select public.restore_client($1)', [c]);
  assert.equal((await q('irit', 'select 1 from public.protocol_checks where client_id = $1', [c])).length, 5);
  assert.equal((await q('nadia', 'select id from public.clients where id = $1', [c])).length, 1);
  assert.ok(Array.isArray((await keep('anon', 'select public.get_status($1) as s', [l.token]))[0].s.items));
  const log = await q('owner', 'select action, business, by_email, by_person from public.client_admin_log where client_id = $1 order by id', [c]);
  assert.deepEqual(log.map((r) => [r.action, r.business, r.by_email, r.by_person]), [
    ['archive', 'קפה דנה', 'ofir@astrateg.test', 'ofir'], ['restore', 'קפה דנה', 'owner@astrateg.test', null],
  ]);
});

test('permanent deletion: archived first, the name typed again, everything of the client goes, the log stays', async () => {
  const c = ids.dana;
  // Not before it is archived, not by Irit, and not with another name.
  assert.match((await keep('owner', 'select public.purge_client($1, $2)', [c, 'קפה דנה'])).error, /archive the client first/);
  await keep('owner', 'select public.archive_client($1)', [c]);
  assert.match((await keep('irit', 'select public.purge_client($1, $2)', [c, 'קפה דנה'])).error, /not allowed/);
  assert.match((await keep('owner', 'select public.purge_client($1, $2)', [c, 'קפה'])).error, /does not match/);
  assert.match((await keep('owner', 'select public.purge_client($1, $2)', [c, ''])).error, /does not match/);
  const secrets = (await db.query('select count(*)::int as n from vault.secrets')).rows[0].n;
  // Typed with a direction mark and extra spaces, as a phone may send it.
  const [{ r }] = await keep('ofir', 'select public.purge_client($1, $2) as r', [c, '‏קפה   דנה ']);
  assert.equal(r.deleted.protocol_checks, 5); // 2 and the 3 the signature marked
  assert.equal(r.deleted.vault_secrets, 2); // the login and the status-page token
  assert.equal((await db.query('select count(*)::int as n from vault.secrets')).rows[0].n, secrets - 2);
  const tables = (await db.query("select table_name from information_schema.columns where table_schema = 'public' and column_name = 'client_id' and table_name <> 'client_admin_log'")).rows.map((x) => x.table_name);
  for (const t of tables) assert.equal((await db.query(`select count(*)::int as n from public.${t} where client_id = $1`, [c])).rows[0].n, 0, t);
  assert.equal((await db.query('select count(*)::int as n from public.clients where id = $1', [c])).rows[0].n, 0);
  // The signed agreement stays (the sales record), and nothing else was touched.
  assert.equal((await db.query("select count(*)::int as n from public.quotes where status = 'signed'")).rows[0].n, 2);
  assert.equal((await db.query("select count(*)::int as n from public.client_access where client_id = $1", [ids.other])).rows[0].n, 1);
  // The log outlives the client: who and when, the business name and counts only.
  const log = (await q('owner', "select * from public.client_admin_log where client_id = $1 and action = 'purge'", [c]))[0];
  assert.deepEqual([log.business, log.by_email, log.by_person], ['קפה דנה', 'ofir@astrateg.test', 'ofir']);
  assert.doesNotMatch(JSON.stringify(log), /050|1234567|דנה_|dana_ig|פנימי/);
  assert.ok(Object.values(log.detail).every((v) => Number.isInteger(v)));
  for (const who of ['irit', 'lior', 'nadia']) assert.deepEqual(await q(who, 'select 1 from public.client_admin_log'), [], who);
  assert.match((await q('owner', "insert into public.client_admin_log (client_id, business, action, by_email) values (gen_random_uuid(), 'x', 'purge', 'x')")).error, /permission denied/);
  assert.match((await q('owner', 'delete from public.client_admin_log')).error, /permission denied/);
  // Gone means gone: a second call finds nothing.
  assert.match((await keep('owner', 'select public.purge_client($1, $2)', [c, 'קפה דנה'])).error, /client not found/);
});

test('a signed agreement stores everything it grants: the database and the app agree', async () => {
  const sels = [
    {}, { paid: ['photographer'] }, { paid: ['natali-reel', 'natali-story'] }, { paid: ['simeon-day'], free: { graphics: 24, simeonStories: 3, extraCh14: true } },
    { free: { simeonJoin: true } },
  ];
  for (const id of Object.keys(PACKAGES)) {
    for (const s of sels) {
      const m = model(id, s);
      const [{ d }] = (await db.query('select public.package_deliverables($1) as d', [JSON.stringify(m)])).rows;
      assert.deepEqual(d, packageDeliverables(m), `${id} ${JSON.stringify(s)}`);
    }
  }
  // A podcast: its shoot day with a photographer; Natali with Simeon joining.
  const p = await sign(model('podcast-simeon'));
  assert.equal(p.deliverables.photo_days, 1);
  assert.equal(p.deliverables.shoot_days, 0);
  const n = await sign(model('social-natali', { free: { simeonJoin: true }, paid: ['photographer'] }));
  assert.deepEqual([n.deliverables.simeon_join, n.deliverables.monthly, n.deliverables.photo_days], [1, 96, undefined]);
  // The agreement's term drives the monthly photographer's count.
  assert.equal((await db.query('select public.package_deliverables($1) as d', [JSON.stringify(model('social-natali', { paid: ['photographer'] }, { termMonths: 6 }))])).rows[0].d.monthly, 48);
  for (const x of PAID_ADDONS) assert.ok(x.id); // every paid add-on is one of the selections above
});

test('the backfill: a client opened before the migration got the two new keys, and kept what the office typed', async () => {
  const [c] = (await db.query('select deliverables from public.clients where id = $1', [ids.old])).rows;
  assert.equal(c.deliverables.photo_days, 1);
  assert.equal(c.deliverables.simeon_join, 1);
  assert.equal(c.deliverables.videos, 18);
});
