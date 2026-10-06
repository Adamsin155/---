// Supabase loads pg-safeupdate for the API roles: a DELETE or UPDATE with no WHERE is
// refused there, even inside a security-definer function ("DELETE requires a WHERE
// clause"), while the test database accepts it. Found live on 6.10.2026 when the vault
// code could not be set. Statements inside function bodies are indented in the
// migrations; the top-level ones run as the database owner and are not affected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

test('no function in the migrations deletes or updates without a WHERE', () => {
  const bad = [];
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(DIR + f, 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/^[ \t]+(delete\s+from|update)\s+[a-z_."]+[^;]*;/gim)) {
      if (!/\bwhere\b/i.test(m[0])) bad.push(`${f}: ${m[0].trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(bad, []);
});
