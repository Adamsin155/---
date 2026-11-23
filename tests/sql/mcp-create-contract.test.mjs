// supabase/migrations/20261223100000_mcp_create_contract.sql in a real Postgres (tests/sql/pg.mjs):
// create_contract (23.11.2026; docs/ops.md, section 149). create-quote asks public.can_edit_quotes() when
// the deal sets the price; a connected app's token (with the mcp function's key) may now ask it, as
// anyone switched on may ask is_office or my_person. Nothing else opens: a non-owner still writes nothing.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql } from './pg.mjs';
import { GATE_HEADER } from '../../supabase/functions/mcp/handler.js';

const FILE = '20261223100000_mcp_create_contract.sql';
let db;
let KEY;
const APP = { sub: '00000000-0000-4000-8000-000000000001', email: 'x@astrateg.test', role: 'authenticated', aud: 'authenticated', client_id: 'claude-client' };

before(async () => {
  db = await freshDatabase();
  await db.exec(migrationSql(FILE)); // runs again safely
  KEY = (await db.query('select public.mcp_gate_key() as k')).rows[0].k;
});

async function gate({ method, path, key = true }) {
  try {
    await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      const set = (k, v) => tx.query('select set_config($1, $2, true)', [k, v]);
      await set('request.jwt.claims', JSON.stringify(APP));
      await set('request.method', method);
      await set('request.path', path);
      await set('request.headers', JSON.stringify(key ? { [GATE_HEADER]: KEY } : {}));
      await tx.query('select public.mcp_request_gate()');
    });
    return 'ok';
  } catch (err) { return err.code; }
}

test('can_edit_quotes: asked with the key; refused without it; nothing else opened', async () => {
  assert.equal(await gate({ method: 'POST', path: '/rpc/can_edit_quotes' }), 'ok');
  assert.equal(await gate({ method: 'POST', path: '/rpc/can_edit_quotes', key: false }), '42501');
  for (const p of ['/rpc/is_office', '/rpc/my_person', '/rpc/mcp_allowed']) assert.equal(await gate({ method: 'POST', path: p }), 'ok', p);
  for (const [method, path] of [['POST', '/quotes'], ['PATCH', '/clients'], ['POST', '/protocol_checks'], ['POST', '/rpc/deal_take'], ['POST', '/rpc/clients_private'], ['GET', '/client_access'], ['POST', '/rpc/access_reveal']]) {
    assert.equal(await gate({ method, path }), '42501', `${method} ${path}`);
  }
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/\bdrop\s|\bdelete\s+from\b|\btruncate\b/gi), null);
});
