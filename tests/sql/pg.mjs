// A real Postgres for the SQL tests: PGlite (Postgres compiled to WebAssembly, in
// process, no server), with a stand-in for what Supabase provides
// (supabase-stub.sql), then every migration in supabase/migrations in name order,
// exactly as written, except for the statements in SKIP (extensions PGlite does
// not have; the stub provides their schemas instead).
//
// PGlite 0.5 is Postgres 18 and the project runs 17; the migrations use nothing that
// differs between them (pg_input_is_valid, for one, exists since 16). The database
// owner here is a superuser, as the migrations' owner (postgres) owns every table in
// Supabase: security definer functions and triggers bypass row level security in both.
//
// A migration that fails to load fails the tests with its file name. If a new
// migration needs something from Supabase that the stub lacks (another extension,
// a vault or cron function), add it to supabase-stub.sql or SKIP, with a line on why.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);

// Statements replaced by a comment before a migration runs.
export const SKIP = [
  // pg_net and pg_cron are not built into PGlite; the stub has net.* and cron.*.
  /^\s*create extension (if not exists )?(pg_net|pg_cron)\b[^;]*;/gim,
];

export const migrationFiles = () => readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();

export function migrationSql(file) {
  let sql = readFileSync(new URL(file, MIGRATIONS), 'utf8');
  for (const re of SKIP) sql = sql.replace(re, (m) => `-- skipped in tests: ${m.trim().replace(/\s+/g, ' ')}`);
  return sql;
}

// A fresh database with every migration applied. `upTo` stops before that file (for
// comparing before and after a migration).
export async function freshDatabase({ upTo = null } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.waitReady;
  await db.exec("set timezone = 'UTC'"); // Supabase's database runs in UTC
  await db.exec(readFileSync(new URL('./supabase-stub.sql', import.meta.url), 'utf8'));
  for (const file of migrationFiles()) {
    if (upTo && file >= upTo) break;
    try {
      await db.exec(migrationSql(file));
    } catch (err) {
      throw new Error(`migration ${file} did not load: ${err.message}`);
    }
  }
  return db;
}

// Runs fn(tx) as a signed-in user (role authenticated, JWT claims with sub and email),
// or as anon when email is null, inside a transaction that is always rolled back.
// Returns fn's result, or { error } with the database's message when it throws.
export async function as(db, user, fn) {
  const claims = user ? { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated' } : { role: 'anon' };
  let out;
  await db.transaction(async (tx) => {
    await tx.query(`set local role ${user ? 'authenticated' : 'anon'}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    try {
      out = await fn(tx);
    } catch (err) {
      out = { error: err.message };
    }
    await tx.rollback();
  });
  return out;
}
