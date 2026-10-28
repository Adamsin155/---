// supabase/migrations/20261104100000_editor_progress_month.sql in a real Postgres with every
// migration (tests/sql/pg.mjs): a monthly client's count per month (the owner's request of
// 22.10.2026: a fixed number of videos every month, the counter from 0 on the 1st).
//   - the file is the newest, only adds (none of the three words the production tool refuses)
//     and runs twice;
//   - the month by default is the Israel calendar month (the same as app/edit-count.js monthKey);
//   - an editor of the client (main or second, also while in landing) sets and reads only their
//     own number, this month or the one before; never another's, never a client not theirs,
//     never as only a round's editor;
//   - the office (owner, Irit, Lior, Ofir) reads every number and may set one for an editor of
//     the client, any month; nobody writes the table directly.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { monthKey, addMonth } from '../../app/edit-count.js';

const FILE = '20261104100000_editor_progress_month.sql';
let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', eli: 'eli', nadia: 'nadia', yariv: 'yariv', anna: 'anna' };
const NOW = monthKey(new Date());
const LAST = addMonth(NOW, -1);

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
  // elor: a monthly client of Nadia's, with Yariv as the second editor; gil: Anna's, and a
  // second round by Yariv alone.
  const monthly = JSON.stringify({ videos: 96, videos_month: 8, videos_month_except: { '2026-10': 12 } });
  const rounds = JSON.stringify([{ n: 2, shoot_type: 'dms', editor: 'yariv' }]);
  for (const [name, fields] of [['elor', { editor: 'nadia', editor2: 'yariv', deliverables: monthly }], ['gil', { editor: 'anna', rounds }]]) {
    const cols = ['name', 'status', ...Object.keys(fields)];
    const { rows } = await db.query(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, [name, 'active', ...Object.values(fields)]);
    ids[name] = rows[0].id;
  }
});

// Runs and keeps the change (the RPC writes); returns the rows, or { error }.
async function keep(who, sql, params = []) {
  const u = users[who];
  let out;
  try {
    await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated' })]);
      out = (await tx.query(sql, params)).rows;
    });
  } catch (err) { out = { error: err.message }; }
  return out;
}
const set = (who, client, n, month = null, editor = null) => keep(who, 'select public.editor_progress_month_set($1, $2, $3, $4) as r', [client, n, month, editor]).then((r) => r.error ? r : r[0].r);
const read = (who) => as(db, users[who], async (tx) => (await tx.query('select client_id, editor, month, edited from public.editor_progress_month order by editor, month')).rows);

test("the file: the newest but one (the old documents' after it), only adds, and runs twice", async () => {
  // After it only the old system's signed documents (20261105100000_legacy_contracts.sql, 25.10.2026); "הכנת חוזה עם AI" (20261106100000_contract_ai.sql) and a shoot day without influencers (20261107100000_shoot_crew.sql, 25.10.2026); the old system's characterizations (20261109100000_legacy_characterizations.sql, 26.10.2026).
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261105100000_legacy_contracts.sql', '20261106100000_contract_ai.sql', '20261107100000_shoot_crew.sql', '20261109100000_legacy_characterizations.sql', '20261110100000_batch_2710.sql', '20261112100000_new_influencers.sql', '20261113100000_client_details_month.sql']);
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  // Every UPDATE in it has a WHERE (an upsert's "do update set" is not one).
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  assert.equal((await db.query("select count(*)::int as n from pg_policies where tablename = 'editor_progress_month'")).rows[0].n, 1);
});

test('the month by default is the Israel calendar month, as the app counts it', async () => {
  const { rows } = await db.query("select to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM') as m");
  assert.equal(rows[0].m, NOW);
  const r = await set('nadia', ids.elor, 3);
  assert.deepEqual([r.editor, r.month, r.edited, r.updated_by], ['nadia', NOW, 3, 'nadia@astrateg.test']);
  // The same month again changes the same row.
  assert.equal((await set('nadia', ids.elor, 5, NOW)).edited, 5);
  assert.equal((await db.query('select count(*)::int as n from public.editor_progress_month')).rows[0].n, 1);
});

test('an editor: this month or the one before, never another month; the second editor keeps their own number', async () => {
  // The month before (a page left open over the night of the 1st, a correction on the 1st).
  assert.deepEqual([(await set('nadia', ids.elor, 8, LAST)).month, (await set('nadia', ids.elor, 8, LAST)).edited], [LAST, 8]);
  for (const m of [addMonth(NOW, -2), addMonth(NOW, 1), '2025-01']) {
    assert.match((await set('nadia', ids.elor, 1, m)).error || '', /only this month or the one before/, m);
  }
  // Yariv, the second editor: his own, beside hers; above the month's number is kept as written.
  assert.equal((await set('yariv', ids.elor, 14)).edited, 14);
  const { rows } = await db.query('select editor, month, edited from public.editor_progress_month order by editor, month');
  assert.deepEqual(rows.map((r) => [r.editor, r.month, r.edited]), [['nadia', LAST, 8], ['nadia', NOW, 5], ['yariv', NOW, 14]]);
});

test('an editor cannot set a client not theirs, another editor\'s number, or as only a round\'s editor; the number and the month are checked', async () => {
  for (const [who, client, editor] of [['anna', 'elor', null], ['nadia', 'gil', null], ['yariv', 'gil', null], ['nadia', 'elor', 'yariv'], ['eli', 'elor', null], ['ilai', 'elor', 'nadia']]) {
    const r = await set(who, ids[client], 1, null, editor);
    assert.match(r.error || '', /not allowed/, `${who} ${client} ${editor}`);
  }
  for (const n of [-1, 1000]) assert.match((await set('nadia', ids.elor, n)).error || '', /between 0 and 999/);
  for (const m of ['2026-13', '2026-1', '10/2026', 'אוקטובר']) assert.match((await set('nadia', ids.elor, 1, m)).error || '', /a month as YYYY-MM/, m);
  // Nobody writes the table directly.
  for (const who of ['nadia', 'owner']) {
    const r = await as(db, users[who], (tx) => tx.query("insert into public.editor_progress_month (client_id, editor, month, edited) values ($1, 'nadia', '2026-10', 1)", [ids.elor]));
    assert.match(r.error || '', /permission denied/);
    const u = await as(db, users[who], (tx) => tx.query('update public.editor_progress_month set edited = 99 where true'));
    assert.match(u.error || '', /permission denied/);
  }
  // Nor through the per-shoot table's function: that one is per shoot round, not per month.
  assert.equal((await db.query('select count(*)::int as n from public.editor_progress')).rows[0].n, 0);
});

test('reading: an editor their own rows of a client they edit; the office all; others none', async () => {
  assert.deepEqual((await read('nadia')).map((r) => [r.editor, r.month, r.edited]), [['nadia', LAST, 8], ['nadia', NOW, 5]]);
  assert.deepEqual((await read('yariv')).map((r) => [r.editor, r.edited]), [['yariv', 14]]);
  for (const who of ['owner', 'irit', 'lior', 'ofir']) assert.equal((await read(who)).length, 3, who);
  for (const who of ['anna', 'ilai', 'eli']) assert.equal((await read(who)).length, 0, who);
  // Taken off the client: the number stays, but the editor no longer reads or writes it.
  await db.query('update public.clients set editor2 = null where id = $1', [ids.elor]);
  assert.deepEqual(await read('yariv'), []);
  assert.match((await set('yariv', ids.elor, 15)).error || '', /not allowed/);
  await db.query('update public.clients set editor2 = $2 where id = $1', [ids.elor, 'yariv']);
});

test('the office sets a number for an editor of the client, any month; never for one who is not', async () => {
  const r = await set('ofir', ids.elor, 9, '2026-10', 'nadia');
  assert.deepEqual([r.editor, r.month, r.edited, r.updated_by], ['nadia', '2026-10', 9, 'ofir@astrateg.test']);
  assert.equal((await set('irit', ids.elor, 7, '2026-01', 'yariv')).month, '2026-01');
  assert.match((await set('lior', ids.elor, 1, null, 'anna')).error || '', /not allowed/);
  // The owner has no person: a number is always for a named editor.
  assert.match((await set('owner', ids.elor, 1)).error || '', /not allowed/);
});

test('a client in landing: its editor (clients.editor, as landing_set_editor records it) counts by the month, and the owner enters numbers for her', async () => {
  const { rows } = await db.query("insert into public.clients (name, status, landing, editor, deliverables) values ('בוטיק בקליטה', 'active', true, 'anna', '{\"videos_month\": 8}') returning id");
  const id = rows[0].id;
  const r = await set('owner', id, 4, null, 'anna');
  assert.deepEqual([r.editor, r.month, r.edited, r.updated_by], ['anna', NOW, 4, 'owner@astrateg.test']);
  assert.equal((await set('anna', id, 6)).edited, 6);
  assert.deepEqual((await read('anna')).filter((x) => x.client_id === id).map((x) => x.edited), [6]);
  // Nobody else's, landing or not.
  assert.match((await set('nadia', id, 1)).error || '', /not allowed/);
  assert.match((await set('owner', id, 1, null, 'nadia')).error || '', /not allowed/);
});
