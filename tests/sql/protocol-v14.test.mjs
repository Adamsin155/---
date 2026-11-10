// Protocol version 14 (supabase/migrations/20261210100000_protocol_v14.sql; the owner's decision of
// 10.11.2026 after the editors' "סדר בסימונים"; docs/ops.md, section 126), in a real Postgres with
// every migration:
//   - the version and the column default;
//   - the writers table is the app's: the editor writes what is left of 22 and 24, and none of the
//     items the editors marked "מיותר"; the office still writes every key (history too);
//   - the file has none of the refused words, every UPDATE has a WHERE, and it runs twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { PROTOCOL_VERSION } from '../../app/protocol.js';
import { PROTOCOL_HISTORY } from '../../app/protocol-versions.js';
import { latestBlock } from '../../scripts/protocol-writers.mjs';

const FILE = '20261210100000_protocol_v14.sql';
const PEOPLE = { owner: null, irit: 'irit', nadia: 'nadia', yariv: 'yariv' };
const RETIRED = PROTOCOL_HISTORY.find((v) => v.version === 14).retired;
let db;
const users = {};

const addClient = async (name, fields = {}) => {
  const cols = ['name', 'business', 'status', ...Object.keys(fields)];
  const vals = [name, name, 'active', ...Object.values(fields)];
  return (await db.query(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals)).rows[0].id;
};
// A write as `who`: true when the database took it.
const writes = async (who, client, key) => {
  const r = await as(db, users[who], (tx) => tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done')", [client, key]));
  return !r?.error;
};

before(async () => {
  db = await freshDatabase({ upTo: FILE });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  await db.exec(migrationSql(FILE));
});

test('the file: none of the refused words, every UPDATE with a WHERE, no table or policy, the writers block', () => {
  const sql = migrationSql(FILE);
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  assert.deepEqual(sql.replace(/--[^\n]*/g, '').match(/create\s+(table|policy|index|type|trigger)/gi), null);
  assert.equal(latestBlock().file, FILE);
});

test('version 14: the function, the column default, a new client', async () => {
  assert.equal(PROTOCOL_VERSION, 14);
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 14);
  const d = await db.query("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'protocol_version'");
  assert.equal(d.rows[0].column_default, '14');
  const c = await addClient('חדש');
  assert.equal((await db.query('select protocol_version from public.clients where id = $1', [c])).rows[0].protocol_version, 14);
});

test('who writes: the editor what is left of 22 and 24, none of the retired items; the office everything', async () => {
  const c = await addClient('עריכה', { editor: 'nadia', rounds: JSON.stringify([{ n: 2, editor: 'nadia', start_at: new Date().toISOString() }]) });
  for (const k of ['p22.check.footage', 'p22.check.scripts', 'p22.self.spelling', 'p22.self.sound', 'p22.self.exposure', 'p24.folder', 'p24.drive', 'p24.notify', 'r2.p22.check.footage', 'r2.p24.notify']) {
    assert.equal(await writes('nadia', c, k), true, k);
  }
  for (const k of [...RETIRED, ...RETIRED.map((x) => `r2.${x}`)]) assert.equal(await writes('nadia', c, k), false, `${k}: retired, no longer hers`);
  assert.equal(await writes('yariv', c, 'p22.self.sound'), false, 'not his client');
  assert.equal(await writes('irit', c, 'p22.received'), true, 'the office writes every key, history too');
});

test('it runs twice', async () => {
  await db.exec(migrationSql(FILE));
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 14);
});
