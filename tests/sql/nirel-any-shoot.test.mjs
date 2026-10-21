// supabase/migrations/20261031120000_nirel_any_shoot.sql (the owner's decision of 21.10.2026,
// the statement approved on 22.10.2026): Nirel may edit any shoot. The file takes away exactly
// one thing, the Natali-only check on public.clients, by its name, and nothing else; the
// landing's write of a real editor lets her take any shoot too. Runs twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql } from './pg.mjs';
import { editorsFor, EDITORS } from '../../app/protocol.js';
import { preselected } from '../../app/qa-logic.js';

const FILE = '20261031120000_nirel_any_shoot.sql';
let db;
before(async () => { db = await freshDatabase(); });

test('the file: the one approved statement that takes something away, and nothing else of the kind', async () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  // The production tool's three words appear once, in that statement only.
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), ['drop']);
  assert.deepEqual(sql.match(/^[^-\n][^\n]*\b(drop|delete|truncate)\b[^\n]*$/gim), ['alter table public.clients drop constraint if exists clients_nirel_natali_check;']);
  await db.exec(migrationSql(FILE));
});

test('the check is gone: Nirel is the editor of a shoot that is not Natali\'s; everything else of the column holds', async () => {
  const cons = (await db.query("select conname from pg_constraint where conrelid = 'public.clients'::regclass")).rows.map((r) => r.conname);
  assert.ok(!cons.includes('clients_nirel_natali_check'));
  const { rows } = await db.query("insert into public.clients (name, shoot_type, editor) values ('דמס', 'dms', 'nirel') returning editor");
  assert.equal(rows[0].editor, 'nirel');
  await assert.rejects(db.query("insert into public.clients (name, shoot_type, editor) values ('x', 'dms', 'lior')"), /check/);
});

test('the app: every editor for every shoot; Nirel still preselected for Natali', () => {
  assert.deepEqual(editorsFor('dms'), EDITORS);
  assert.deepEqual(editorsFor('natali'), EDITORS);
  assert.equal(preselected('natali'), 'nirel');
  assert.equal(preselected('dms'), null);
});
