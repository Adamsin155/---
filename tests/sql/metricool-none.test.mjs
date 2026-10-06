// "ללקוח אין מותג" (20261012100000_metricool_none.sql; docs/ops.md, section 33) in a real
// Postgres (PGlite, every migration applied):
//   - Ilai and the owner mark a client as one with no Metricool brand, and undo it;
//     nobody else does, and a direct write of the three columns from a browser changes
//     nothing, whoever sends it;
//   - who and when are stamped by the database; connecting the client to a brand
//     clears the mark, and a connected client cannot be marked;
//   - everyone who sees the client reads the mark;
//   - the database's own roles (the import of the old clients) set it as they like;
//   - the migration runs twice and leaves everything as it was.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { CONNECTORS, unconnected, withoutBrand } from '../../app/metricool-connect-logic.js';

const FILE = '20261012100000_metricool_none.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', anna: 'anna', stav: 'stav' };
const DENIED = /row-level security|violates|permission denied|not allowed/i;
let db;
const users = {};
const ids = {};

const run = (who, sql, params = []) => as(db, who ? users[who] : null, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows ?? r.rows.length };
});
// The same, kept (committed).
async function keep(who, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users[who].id, email: users[who].email, role: 'authenticated' })]);
    return (await tx.query(sql, params)).rows;
  });
}
const markOf = async (id) => (await db.query('select metricool_none as none, metricool_none_by as by, metricool_none_at is not null as stamped, metricool_blog_id as blog from public.clients where id = $1', [id])).rows[0];
const CLEAR = { none: false, by: null, stamped: false, blog: null };

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  const add = async (name, editor, deal) => (await db.query(
    "insert into public.clients (name, business, shoot_type, editor, status, deal_at, contract_end) values ($1, $1, 'dms', $2, 'active', $3, '2027-03-15') returning id", [name, editor, deal])).rows[0].id;
  ids.a = await add('מספרת רון', 'nadia', '2026-03-15 08:00+00');
  ids.b = await add('קפה נדיה', 'yariv', '2026-01-10 08:00+00');
  ids.c = await add('מוסך הצפון', 'yariv', '2026-05-01 08:00+00');
});

test('a new client carries no mark, and everyone who sees it reads the three columns', async () => {
  assert.deepEqual(await markOf(ids.a), CLEAR);
  for (const who of ['owner', 'ilai', 'irit', 'nadia']) {
    assert.deepEqual((await run(who, 'select metricool_none, metricool_none_by, metricool_none_at from public.clients where id = $1', [ids.a])).rows,
      [{ metricool_none: false, metricool_none_by: null, metricool_none_at: null }], who);
  }
  // Anna does not work on this client, and sales see no client at all.
  for (const who of ['anna', 'stav']) assert.deepEqual((await run(who, 'select metricool_none from public.clients where id = $1', [ids.a])).rows, [], who);
  assert.match((await run(null, 'select metricool_none from public.clients')).error, /permission denied/);
});

test('only Ilai and the owner mark and undo: the same two who connect a client to its brand', async () => {
  for (const [who, person] of Object.entries(PEOPLE)) {
    const can = (await run(who, 'select public.can_edit_gantt() as ok')).rows[0].ok;
    assert.equal(can, CONNECTORS.includes(person ?? 'owner'), who);
    const r = await run(who, 'select public.metricool_set_none($1, true) as r', [ids.a]);
    if (can) assert.deepEqual(r.rows[0].r, { none: true }, who);
    else assert.match(r.error, DENIED, who);
  }
  assert.match((await run(null, 'select public.metricool_set_none($1, true)', [ids.a])).error, /permission denied/);
  assert.match((await run('ilai', 'select public.metricool_set_none($1, true)', [crypto.randomUUID()])).error, /client not found/);
  assert.deepEqual(await markOf(ids.a), CLEAR, 'nothing was kept');
});

test('the mark is stamped with who and when; undoing clears it; marking twice keeps the first stamp', async () => {
  assert.deepEqual((await keep('ilai', 'select public.metricool_set_none($1, true) as r', [ids.a]))[0].r, { none: true });
  assert.deepEqual(await markOf(ids.a), { none: true, by: 'ilai@astrateg.test', stamped: true, blog: null });
  await keep('owner', 'select public.metricool_set_none($1, true)', [ids.a]);
  assert.equal((await markOf(ids.a)).by, 'ilai@astrateg.test');
  // The card's list, from the rows as the database holds them.
  const rows = (await db.query('select id, name, business, status, deal_at, archived_at, metricool_blog_id, metricool_none from public.clients')).rows;
  assert.deepEqual(unconnected(rows).map((c) => c.id), [ids.b, ids.c]);
  assert.deepEqual(withoutBrand(rows).map((c) => c.id), [ids.a]);
  assert.deepEqual((await keep('owner', 'select public.metricool_set_none($1, false) as r', [ids.a]))[0].r, { none: false });
  assert.deepEqual(await markOf(ids.a), CLEAR);
  await keep('owner', 'select public.metricool_set_none($1, null)', [ids.a]); // null: not marked
  assert.deepEqual(await markOf(ids.a), CLEAR);
});

test('a direct write from a browser changes nothing, for Irit and for Ilai alike; the rest of the row is written', async () => {
  await keep('owner', 'select public.metricool_set_none($1, true)', [ids.b]);
  for (const who of ['irit', 'lior', 'ilai', 'owner']) {
    await keep(who, "update public.clients set metricool_none = true, metricool_none_by = 'x@x', metricool_none_at = now(), address = $2 where id = $1", [ids.a, `רחוב ${who}`]);
    assert.deepEqual(await markOf(ids.a), CLEAR, who);
    assert.equal((await db.query('select address from public.clients where id = $1', [ids.a])).rows[0].address, `רחוב ${who}`, who);
    await keep(who, "update public.clients set metricool_none = false, metricool_none_by = 'x@x' where id = $1", [ids.b]);
    assert.deepEqual(await markOf(ids.b), { none: true, by: 'owner@astrateg.test', stamped: true, blog: null }, who);
  }
  // An editor cannot change a client at all, as before.
  assert.equal((await run('nadia', 'update public.clients set metricool_none = true where id = $1', [ids.a])).affected, 0);
  // A client opened from a browser with the mark set: opened without it.
  const made = await keep('irit', "insert into public.clients (name, business, shoot_type, status, deal_at, metricool_none, metricool_none_by) values ('חדש', 'חדש', 'dms', 'active', now(), true, 'x@x') returning id");
  assert.deepEqual(await markOf(made[0].id), CLEAR);
  await db.query("update public.clients set status = 'ended' where id = $1", [made[0].id]);
});

test('connecting the client to a brand clears the mark; a connected client cannot be marked', async () => {
  assert.equal((await markOf(ids.b)).none, true);
  await keep('ilai', "select public.gantt_set_brand($1, '202', 'Cafe Nadia')", [ids.b]);
  assert.deepEqual(await markOf(ids.b), { none: false, by: null, stamped: false, blog: '202' });
  assert.match((await run('ilai', 'select public.metricool_set_none($1, true)', [ids.b])).error, /connected:/);
  // Undoing a mark that is not there is not an error.
  assert.deepEqual((await run('ilai', 'select public.metricool_set_none($1, false) as r', [ids.b])).rows[0].r, { none: false });
  // The brand taken away: back in the list, with no mark.
  await keep('owner', 'select public.gantt_set_brand($1, null)', [ids.b]);
  assert.deepEqual(await markOf(ids.b), CLEAR);
});

test('an archived client cannot be marked', async () => {
  await keep('owner', 'select public.archive_client($1)', [ids.c]);
  assert.match((await run('ilai', 'select public.metricool_set_none($1, true)', [ids.c])).error, /client not found/);
  await keep('owner', 'select public.restore_client($1)', [ids.c]);
  assert.deepEqual((await run('ilai', 'select public.metricool_set_none($1, true) as r', [ids.c])).rows[0].r, { none: true });
});

test('the import of the old clients (the database owner, the service role) sets the mark itself; a mark with a brand is never kept', async () => {
  await db.query("update public.clients set metricool_none = true, metricool_none_by = 'import', metricool_none_at = now() where id = $1", [ids.c]);
  assert.deepEqual(await markOf(ids.c), { none: true, by: 'import', stamped: true, blog: null });
  await db.transaction(async (tx) => {
    await tx.query('set local role service_role');
    await tx.query("insert into public.clients (name, business, shoot_type, status, deal_at, metricool_none, metricool_none_by) values ('מיובא', 'מיובא', 'dms', 'active', now(), true, 'import')");
    await tx.query("insert into public.clients (name, business, shoot_type, status, deal_at, metricool_none, metricool_blog_id) values ('מיובא ומחובר', 'מיובא ומחובר', 'dms', 'active', now(), true, '909')");
  });
  const rows = (await db.query("select business, metricool_none as none, metricool_none_by as by, metricool_blog_id as blog from public.clients where business like 'מיובא%' order by business")).rows;
  assert.deepEqual(rows, [{ business: 'מיובא', none: true, by: 'import', blog: null }, { business: 'מיובא ומחובר', none: false, by: null, blog: '909' }]);
  await db.query('update public.clients set metricool_none = false where id = $1', [ids.c]);
  assert.deepEqual(await markOf(ids.c), CLEAR);
});

test('the migration runs twice: the marks, the grants and the single trigger stay', async () => {
  await keep('ilai', 'select public.metricool_set_none($1, true)', [ids.a]);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  assert.deepEqual(await markOf(ids.a), { none: true, by: 'ilai@astrateg.test', stamped: true, blog: null });
  const trg = (await db.query("select tgname from pg_trigger where tgrelid = 'public.clients'::regclass and not tgisinternal and tgname like '%metricool%'")).rows;
  assert.deepEqual(trg, [{ tgname: 'clients_metricool_none_guard' }]);
  assert.match((await run('irit', 'select public.metricool_set_none($1, false)', [ids.a])).error, DENIED);
  assert.deepEqual((await run('nadia', 'select metricool_none from public.clients where id = $1', [ids.a])).rows, [{ metricool_none: true }]);
  // The trigger function is nobody's to call.
  assert.match((await run('ilai', 'select public.clients_metricool_none_guard()')).error, /permission denied|trigger/i);
  await keep('ilai', 'select public.metricool_set_none($1, false)', [ids.a]);
});
