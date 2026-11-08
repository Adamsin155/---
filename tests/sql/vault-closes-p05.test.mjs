// A working access in the vault closes "התקבלה גישה" and "הגישות בכספת" by itself (the owner,
// 8.11.2026; supabase/migrations/20261204100000_vault_closes_p05.sql). Safe to run again.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, migrationSql } from './pg.mjs';

const MIGRATION = '20261204100000_vault_closes_p05.sql';
let db;
const client = async (name) => (await db.query('insert into public.clients (name) values ($1) returning id', [name])).rows[0].id;
const marks = async (id) => Object.fromEntries((await db.query("select item_key, state, note from public.protocol_checks where client_id = $1 and item_key in ('p05.access', 'p05.vault')", [id])).rows.map((r) => [r.item_key, r]));
const access = (id, network, status) => db.query('insert into public.client_access (client_id, network, status) values ($1, $2, $3) returning id', [id, network, status]);

let before1;
before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  // Already in the vault before the migration: closed by the one-time step.
  before1 = await client('לקוח ותיק');
  await access(before1, 'instagram', 'ok');
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
});

test('what was in the vault already is closed once', async () => {
  const m = await marks(before1);
  assert.deepEqual([m['p05.access']?.state, m['p05.vault']?.state], ['done', 'done']);
  assert.match(m['p05.access'].note, /כבר הייתה בכספת \(instagram\)/);
});

test('a working access closes both; broken or missing closes nothing; a mark already there is kept', async () => {
  const a = await client('א');
  await access(a, 'tiktok', 'broken');
  await access(a, 'facebook', 'missing');
  assert.deepEqual(await marks(a), {});
  // Fixed later: the status turns to 'ok'.
  await db.query("update public.client_access set status = 'ok' where client_id = $1 and network = 'tiktok'", [a]);
  const m = await marks(a);
  assert.deepEqual([m['p05.access']?.state, m['p05.vault']?.state], ['done', 'done']);
  assert.match(m['p05.access'].note, /גישה תקינה נכנסה לכספת \(tiktok\)/);
  // "לא רלוונטי" set by a person stays.
  const b = await client('ב');
  await db.query("insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p05.access', 'na', 'ידני')", [b]);
  await access(b, 'instagram', 'ok');
  const mb = await marks(b);
  assert.deepEqual([mb['p05.access'].state, mb['p05.access'].note, mb['p05.vault']?.state], ['na', 'ידני', 'done']);
});
