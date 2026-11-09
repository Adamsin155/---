// Protocol version 12, Lior's four things (supabase/migrations/20261126100000_lior_four.sql; the
// owner's decision of 3.11.2026; docs/ops.md, section 92), in a real Postgres with every migration:
//   - the history of clients already past the two new items (the pre-shoot form, the scripts link),
//     written once, on the move to 12, and never over a mark that is there;
//   - the version and the column default;
//   - saving the Google Docs link with all the scripts closes p12.link (and that of a round that has
//     begun), for whoever saves it; a mark already done keeps its words; the same keys as the app's
//     scriptsKeysToClose;
//   - the new keys are allowed by the table's own check; the writers table is the app's;
//   - the file has none of the refused words, every UPDATE has a WHERE, and it runs twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { PROTOCOL_VERSION } from '../../app/protocol.js';
import { latestBlock, writerRows, mayWrite } from '../../scripts/protocol-writers.mjs';
import { scriptsKeysToClose } from '../../app/lior-four.js';

const FILE = '20261126100000_lior_four.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia' };
const DOC = 'https://docs.google.com/document/d/1AbC/edit';
let db;
const users = {};
const ids = {};

const marks = async (client) => Object.fromEntries((await db.query(
  'select item_key, state, note from public.protocol_checks where client_id = $1 order by item_key', [client])).rows.map((r) => [r.item_key, { state: r.state, note: r.note }]));
const addClient = async (name, fields = {}) => {
  const cols = ['name', 'business', 'status', ...Object.keys(fields)];
  const vals = [name, name, 'active', ...Object.values(fields)];
  return (await db.query(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals)).rows[0].id;
};
const mark = (client, key, state = 'done', note = null) => db.query(
  'insert into public.protocol_checks (client_id, item_key, state, note) values ($1, $2, $3, $4)', [client, key, state, note]);

before(async () => {
  db = await freshDatabase({ upTo: FILE });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  // Before the move to 12: a client whose shoot was last week, one whose shoot is next week, one
  // whose shoot day Lior closed (no date on record), one whose editor was assigned, one with the
  // scripts on the scripts page, one whose Zoom took place, one with a second round shot last week,
  // and one that already has a pre-shoot mark of its own.
  ids.past = await addClient('עבר', { shoot_at: new Date(Date.now() - 7 * 864e5).toISOString(), shoot_type: 'dms' });
  ids.future = await addClient('עתיד', { shoot_at: new Date(Date.now() + 7 * 864e5).toISOString(), shoot_type: 'dms' });
  ids.closed = await addClient('נסגר');
  await mark(ids.closed, 'p19.took');
  ids.assigned = await addClient('שויך');
  await mark(ids.assigned, 'p22a.assigned');
  ids.scripts = await addClient('תסריטים');
  await mark(ids.scripts, 'p12.docs');
  ids.zoom = await addClient('זום');
  await mark(ids.zoom, 'p13.zoom');
  ids.round = await addClient('סבב', {
    shoot_at: new Date(Date.now() + 30 * 864e5).toISOString(),
    rounds: JSON.stringify([{ n: 2, start_at: new Date(Date.now() - 20 * 864e5).toISOString(), shoot_at: new Date(Date.now() - 7 * 864e5).toISOString() }]),
  });
  await mark(ids.round, 'r2.p12.scripts');
  ids.own = await addClient('שלו', { shoot_at: new Date(Date.now() - 7 * 864e5).toISOString() });
  await mark(ids.own, 'p36.form', 'done', 'הטופס המקדים נשמר');
  await db.exec(migrationSql(FILE));
});

test('the file: the newest, none of the refused words, every UPDATE with a WHERE, no table or policy, a writers block', () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261128100000_managers_all.sql', '20261129100000_influencer_choice.sql', '20261130100000_manual_contracts.sql']); // Irit, Ofir and Lior get the owners' work (4.11.2026)
  const sql = migrationSql(FILE);
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  assert.deepEqual(sql.replace(/--[^\n]*/g, '').match(/create\s+(table|policy|index|type)/gi), null);
  assert.equal(latestBlock().file, FILE);
});

test('version 12: the function, the column default, a new client', async () => {
  assert.ok(PROTOCOL_VERSION >= 12); // 13 since 9.11.2026 (20261208120000_protocol_v13.sql)
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 12);
  const d = await db.query("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'protocol_version'");
  assert.equal(d.rows[0].column_default, '12');
  const fresh = await addClient('חדש');
  assert.equal((await db.query('select protocol_version from public.clients where id = $1', [fresh])).rows[0].protocol_version, 12);
});

test('the history: only clients already past the new items, as "ייבוא"; a mark of its own is kept', async () => {
  const hist = { state: 'done', note: 'ייבוא' };
  assert.deepEqual((await marks(ids.past))['p36.form'], hist);
  assert.equal((await marks(ids.future))['p36.form'], undefined);
  assert.deepEqual((await marks(ids.closed))['p36.form'], hist);
  assert.deepEqual((await marks(ids.assigned))['p36.form'], hist);
  assert.deepEqual((await marks(ids.scripts))['p12.link'], hist);
  assert.deepEqual((await marks(ids.zoom))['p12.link'], hist);
  assert.equal((await marks(ids.future))['p12.link'], undefined);
  const r = await marks(ids.round);
  assert.deepEqual(r['r2.p36.form'], hist, 'the round shot last week');
  assert.equal(r['p36.form'], undefined, 'its own shoot is next month');
  assert.deepEqual(r['r2.p12.link'], hist);
  assert.equal(r['p12.link'], undefined);
  assert.deepEqual((await marks(ids.own))['p36.form'], { state: 'done', note: 'הטופס המקדים נשמר' });
});

test('saving the scripts link closes p12.link, for whoever saves it; the rounds that began too; the app agrees', async () => {
  // Lior saves it (the office edits the client card).
  const saved = await as(db, users.lior, async (tx) => {
    await tx.query("update public.clients set links = links || jsonb_build_object('scripts_doc', $2::text) where id = $1", [ids.future, DOC]);
    return (await tx.query("select state, note, by_email from public.protocol_checks where client_id = $1 and item_key = 'p12.link'", [ids.future])).rows[0];
  });
  assert.deepEqual(saved, { state: 'done', note: 'נסגר לבד: נשמר הקישור לקובץ התסריטים', by_email: 'lior@astrateg.test' });
  // For real (outside the rolled-back transaction), on a client with a round that has begun and one that has not.
  const twoRounds = await addClient('שני סבבים', {
    rounds: JSON.stringify([
      { n: 2, start_at: new Date(Date.now() - 864e5).toISOString() },
      { n: 3, start_at: new Date(Date.now() + 10 * 864e5).toISOString() },
    ]),
  });
  const before = { id: twoRounds, links: { [ 'scripts_doc']: DOC }, rounds: [{ n: 2, start_at: new Date(Date.now() - 864e5).toISOString() }, { n: 3, start_at: new Date(Date.now() + 10 * 864e5).toISOString() }] };
  await db.query("update public.clients set links = jsonb_build_object('scripts_doc', $2::text) where id = $1", [twoRounds, DOC]);
  const m = await marks(twoRounds);
  assert.deepEqual(Object.keys(m).filter((k) => k.endsWith('p12.link')).sort(), ['p12.link', 'r2.p12.link']);
  assert.deepEqual(scriptsKeysToClose(before, {}).sort(), ['p12.link', 'r2.p12.link'], 'the app closes the same keys');
  // A mark already done keeps its words; another address closes nothing new; an empty one closes nothing.
  await db.query("update public.protocol_checks set note = 'סומן ביד' where client_id = $1 and item_key = 'p12.link'", [twoRounds]);
  await db.query("update public.clients set links = jsonb_build_object('scripts_doc', $2::text) where id = $1", [twoRounds, `${DOC}?usp=sharing`]);
  assert.equal((await marks(twoRounds))['p12.link'].note, 'סומן ביד');
  const empty = await addClient('ריק');
  await db.query("update public.clients set links = jsonb_build_object('drive', 'https://drive.google.com/x') where id = $1", [empty]);
  assert.equal((await marks(empty))['p12.link'], undefined);
  // A client created with the link closes it at once.
  const born = await addClient('נולד עם קישור', { links: JSON.stringify({ scripts_doc: DOC }) });
  assert.equal((await marks(born))['p12.link']?.state, 'done');
});

test('the new keys pass the table\'s own check; the writers table is the app\'s; the trigger function is not an API', async () => {
  for (const key of ['p36.form', 'r2.p36.form', 'p12.link', 'r3.p12.link']) {
    const c = await addClient(`מפתח ${key}`);
    await mark(c, key);
  }
  // Lior (the office) writes them; Ilai and an editor do not.
  for (const [who, ok] of [['lior', true], ['irit', true], ['ilai', false], ['nadia', false]]) {
    const c = await addClient(`כותב ${who}`);
    const r = await as(db, users[who], async (tx) => (await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p30.live', 'done') returning item_key", [c])).rows.length);
    assert.equal(r === 1, ok, who);
    assert.equal(mayWrite({ person: who, client: {}, key: 'p36.form' }), ok, `${who} p36.form`);
  }
  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const rows = (await db.query('select key, proc, round, persons from private.protocol_writers')).rows.sort(byKey);
  // Shiel (9.11.2026) joined the table later, in 20261205100000_shiel.sql: the app's table without him.
  // Version 13 (20261208120000_protocol_v13.sql) changed the table again: the rows it did not touch are the app's.
  const V13P = new Set(['p04', 'p05', 'p09', 'p17b', 'p19b', 'p28', 'p29', 'p29b']); // the processes v13 changed
  const v13 = (r) => V13P.has(r.proc) || V13P.has(String(r.key).split('.')[0]);
  const app = writerRows().filter((r) => !v13(r)).map((r) => ({ ...r, persons: r.persons.filter((p) => p !== 'shiel') })).sort(byKey);
  assert.deepEqual(rows.filter((r) => r.persons.length && !v13(r)), app);
  assert.deepEqual(rows.find((r) => r.key === 'p06.@part').persons, ['noam', 'ofir']);
  const call = await as(db, users.lior, async (tx) => (await tx.query('select public.clients_scripts_doc_saved()')).rows);
  assert.match(call.error, /permission denied|trigger/i);
});

test('runs twice: nothing more is written, the version stays', async () => {
  const count = async () => (await db.query('select count(*)::int as n from public.protocol_checks')).rows[0].n;
  const n = await count();
  const writers = (await db.query('select key, proc, round, persons from private.protocol_writers order by key')).rows;
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  assert.equal(await count(), n);
  assert.deepEqual((await db.query('select key, proc, round, persons from private.protocol_writers order by key')).rows, writers);
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 12);
});
