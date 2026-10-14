// The real editor of an old client already in editing, recorded while it is in landing
// (20261026100000_landing_editor.sql; the owner, 14.10.2026; docs/ops.md, the bullets of
// that day), in a real Postgres (PGlite, every migration applied):
//   - who may: Irit, Lior, Ofir and the owners; not Ilai, an editor, the photographer,
//     sales or anon;
//   - only on a client in landing, only an editor the dialog offers for that shoot (Nirel
//     only for Natali), only a round that exists, never over a real assignment;
//   - what it writes: the editor and the landing's own answers of 22א; nothing of the
//     protocol, no task; clearing turns its own answers back to 'open' and removes no row;
//   - the activation makes them imported history ('ייבוא'), and the reminders' log gets
//     nothing; running it twice is harmless; the file has none of the three words.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { IMPORT_NOTE } from '../../app/protocol-logic.js';

const FILE = '20261026100000_landing_editor.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nirel: 'nirel', nadia: 'nadia', anna: 'anna', eli: 'eli', stav: 'stav' };
const DENIED = /row-level security|permission denied|not allowed/i;
let db;
const users = {};
const ids = {};

const run = (who, sql, params = []) => as(db, who ? users[who] : null, async (tx) => (await tx.query(sql, params)).rows);
async function keep(who, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users[who].id, email: users[who].email, role: 'authenticated' })]);
    return (await tx.query(sql, params)).rows;
  });
}
const SET = 'select public.landing_set_editor($1, $2, $3) as r';
const set = (who, id, editor, round = null) => run(who, SET, [id, editor, round]);
const setKeep = (who, id, editor, round = null) => keep(who, SET, [id, editor, round]);
const marks = async (id) => Object.fromEntries((await db.query('select item_key, choice, person, by_email from public.client_landing_marks where client_id = $1 order by item_key', [id])).rows
  .map((r) => [r.item_key, `${r.choice}:${r.person}`]));
const editorOf = async (id) => (await db.query('select editor, rounds from public.clients where id = $1', [id])).rows[0];
const count = async (sql, params = []) => (await db.query(sql, params)).rows[0].n;

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  const add = async (name, { landing = true, type = 'dms', rounds = [] } = {}) => (await db.query(
    "insert into public.clients (name, business, shoot_type, editor, status, deal_at, shoot_at, contract_end, landing, rounds, created_by_email) values ($1, $1, $2, null, 'active', '2026-05-10 07:00+00', '2026-09-20 06:00+00', '2027-05-10', $3, $4::jsonb, 'system') returning id",
    [name, type, landing, JSON.stringify(rounds)])).rows[0].id;
  ids.a = await add('סטודיו מאיה');
  ids.natali = await add('קליניקה נטלי', { type: 'natali' });
  ids.round = await add('מוסך עם סבב', { rounds: [{ n: 2, shoot_type: 'natali', shoot_at: '2026-10-01T06:00:00Z', editor: null }] });
  ids.real = await add('כבר שויך');
  ids.active = await add('לקוח פעיל', { landing: false });
  // The import: everything before editing is history; Lior took the drive back (19).
  for (const id of [ids.a, ids.natali, ids.round, ids.real]) {
    await db.query("insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p19.took', 'done', $2), ($1, 'p19.done', 'done', $2)", [id, IMPORT_NOTE]);
  }
  await db.query("insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p22a.assigned', 'done', null)", [ids.real]);
});

test('the file: none of the three words the production tool refuses, and no function of the hardening again', () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  assert.ok(!/create\s+or\s+replace\s+function\s+(private\.(my_clients|protocol_write_ok|landing_release|is_owner)|public\.(is_staff|is_office|my_person|can_see_client|landing_take))\b/i.test(sql));
});

test('who may: Irit, Lior, Ofir and the owners; nobody else', async () => {
  for (const who of ['ilai', 'nadia', 'anna', 'nirel', 'eli', 'stav']) assert.match((await set(who, ids.a, 'nadia')).error || '', DENIED, who);
  assert.match((await set(null, ids.a, 'nadia')).error || '', /permission denied/);
  // Each allowed one, in a transaction that is rolled back: it works.
  for (const who of ['irit', 'lior', 'ofir', 'owner']) {
    const r = await set(who, ids.a, 'yariv');
    assert.deepEqual(r[0]?.r, { editor: 'yariv', round: null, changed: true }, `${who}: ${r.error || ''}`);
  }
  assert.equal((await editorOf(ids.a)).editor, null, 'all of that was rolled back');
  // Nobody writes the editor's answers with a plain request.
  for (const who of ['irit', 'owner']) {
    assert.match((await run(who, "insert into public.client_landing_marks (client_id, item_key, choice, person, by_email) values ($1, 'p22a.assigned', 'done', 'irit', 'x')", [ids.a])).error || '', /permission denied/, who);
  }
});

test('only in landing, only an editor the dialog offers, only a round that exists, never over a real assignment', async () => {
  assert.match((await set('irit', ids.active, 'nadia')).error, /not in landing/);
  assert.match((await set('irit', ids.a, 'nirel')).error, /editor not allowed/, 'Nirel only for Natali');
  assert.match((await set('irit', ids.a, 'lior')).error, /editor not allowed/);
  assert.match((await set('irit', ids.a, 'editor')).error, /editor not allowed/);
  assert.deepEqual((await set('irit', ids.natali, 'nirel'))[0].r.editor, 'nirel');
  assert.match((await set('irit', ids.a, 'nadia', 3)).error, /no such round/);
  assert.match((await set('irit', ids.a, 'nadia', 1)).error, /no such round/);
  assert.match((await set('irit', ids.real, 'nadia')).error, /already assigned/);
  assert.match((await set('irit', crypto.randomUUID(), 'nadia')).error, /client not found|not allowed/);
  // The round's own shoot type: round 2 is Natali's, the client's own is not.
  assert.deepEqual((await set('irit', ids.round, 'nirel', 2))[0].r, { editor: 'nirel', round: 2, changed: true });
  assert.match((await set('irit', ids.round, 'nirel')).error, /editor not allowed/);
});

test('set: the editor and the landing answers of 22א; nothing of the protocol, no task; changed with another tap', async () => {
  const checksBefore = await count('select count(*)::int as n from public.protocol_checks where client_id = $1', [ids.a]);
  assert.deepEqual((await setKeep('irit', ids.a, 'nadia'))[0].r, { editor: 'nadia', round: null, changed: true });
  assert.equal((await editorOf(ids.a)).editor, 'nadia');
  assert.deepEqual(await marks(ids.a), {
    'p22a.assigned': 'done:irit', 'p22a.drive': 'done:irit', 'p22a.irit': 'done:irit', 'p22a.load': 'done:irit',
  });
  assert.equal(await count('select count(*)::int as n from public.protocol_checks where client_id = $1', [ids.a]), checksBefore);
  assert.equal(await count('select count(*)::int as n from public.client_tasks where client_id = $1', [ids.a]), 0);
  assert.equal(await count('select count(*)::int as n from public.reminder_log'), 0);
  // The editor now sees the client and its answers (her own clients).
  assert.equal((await run('nadia', 'select 1 from public.clients where id = $1', [ids.a])).length, 1);
  assert.equal((await run('nadia', 'select 1 from public.client_landing_marks where client_id = $1', [ids.a])).length, 4);
  // Another editor, by Ofir: the same rows, his hand.
  await setKeep('ofir', ids.a, 'anna');
  assert.equal((await editorOf(ids.a)).editor, 'anna');
  assert.deepEqual(await marks(ids.a), {
    'p22a.assigned': 'done:ofir', 'p22a.drive': 'done:ofir', 'p22a.irit': 'done:ofir', 'p22a.load': 'done:ofir',
  });
  // An owner: the person is "owner".
  await setKeep('owner', ids.a, 'nadia');
  assert.equal((await marks(ids.a))['p22a.assigned'], 'done:owner');
});

test('clear: its own answers become "open" again, the editor goes, no row is removed; answers of others stay', async () => {
  const rows = await count('select count(*)::int as n from public.client_landing_marks');
  assert.deepEqual((await setKeep('irit', ids.a, null))[0].r, { editor: null, round: null, changed: true });
  assert.equal((await editorOf(ids.a)).editor, null);
  assert.deepEqual(await marks(ids.a), {
    'p22a.assigned': 'open:irit', 'p22a.drive': 'open:irit', 'p22a.irit': 'open:irit', 'p22a.load': 'open:irit',
  });
  assert.equal(await count('select count(*)::int as n from public.client_landing_marks'), rows);
  // Clearing what is not set: nothing changes.
  assert.deepEqual((await setKeep('irit', ids.a, null))[0].r, { editor: null, round: null, changed: false });
  // Set again: its own "open" answers become done again.
  await setKeep('irit', ids.a, 'yariv');
  assert.deepEqual(await marks(ids.a), {
    'p22a.assigned': 'done:irit', 'p22a.drive': 'done:irit', 'p22a.irit': 'done:irit', 'p22a.load': 'done:irit',
  });
  // Lior answers his drive himself, "לא רלוונטי": a clear leaves his answer, a set does not touch it.
  await keep('lior', 'select public.landing_take($1, $2::jsonb)', [ids.a, JSON.stringify({ 'p22a.drive': 'na' })]);
  await setKeep('irit', ids.a, null);
  assert.equal((await marks(ids.a))['p22a.drive'], 'na:lior');
  await setKeep('irit', ids.a, 'yariv');
  assert.equal((await marks(ids.a))['p22a.drive'], 'na:lior');
  assert.equal((await marks(ids.a))['p22a.irit'], 'done:irit');
});

test('a round: the round\'s editor in clients.rounds, its own keys; the client\'s own shoot is untouched', async () => {
  await setKeep('lior', ids.round, 'nirel', 2);
  const row = await editorOf(ids.round);
  assert.equal(row.editor, null);
  assert.deepEqual(row.rounds, [{ n: 2, shoot_type: 'natali', shoot_at: '2026-10-01T06:00:00Z', editor: 'nirel' }]);
  // No drive answer: Lior has not taken back the round's drive (r2.p19.took).
  assert.deepEqual(await marks(ids.round), { 'r2.p22a.assigned': 'done:lior', 'r2.p22a.irit': 'done:lior', 'r2.p22a.load': 'done:lior' });
  await setKeep('lior', ids.round, null, 2);
  assert.equal((await editorOf(ids.round)).rounds[0].editor, null);
});

test('activation: the answers become imported history ("ייבוא"), and nothing is put in the reminders\' log', async () => {
  assert.equal((await editorOf(ids.a)).editor, 'yariv');
  assert.equal((await keep('owner', 'select public.landing_activate($1) as n', [[ids.a]]))[0].n, 1);
  const got = (await db.query("select item_key, state, note from public.protocol_checks where client_id = $1 and item_key like 'p22a.%' order by item_key", [ids.a])).rows;
  assert.deepEqual(got, [
    { item_key: 'p22a.assigned', state: 'done', note: IMPORT_NOTE },
    { item_key: 'p22a.drive', state: 'na', note: IMPORT_NOTE }, // Lior's own answer
    { item_key: 'p22a.irit', state: 'done', note: IMPORT_NOTE },
    { item_key: 'p22a.load', state: 'done', note: IMPORT_NOTE },
  ]);
  assert.equal(await count('select count(*)::int as n from public.reminder_log'), 0);
  assert.equal(await count('select count(*)::int as n from public.client_tasks where client_id = $1', [ids.a]), 0);
  // Activated: not this function's any more (a change goes through Ofir).
  assert.match((await set('irit', ids.a, 'nadia')).error, /not in landing/);
  assert.match((await set('irit', ids.a, null)).error, /not in landing/);
});

test('the migration runs again and leaves everything as it was', async () => {
  const snap = async () => ({
    marks: (await db.query('select * from public.client_landing_marks order by client_id, item_key')).rows,
    clients: (await db.query('select id, editor, rounds, landing from public.clients order by id')).rows,
    grants: (await db.query("select grantee, privilege_type from information_schema.routine_privileges where routine_name = 'landing_set_editor' order by 1, 2")).rows,
  });
  const beforeRun = await snap();
  await db.exec(migrationSql(FILE));
  assert.deepEqual(await snap(), beforeRun);
  assert.ok(!beforeRun.grants.some((g) => g.grantee === 'anon' || g.grantee === 'PUBLIC'));
});
