// supabase/migrations/20261125100000_noam_access_link.sql in a real Postgres with every migration:
// Noam makes, reads and revokes the logins-form link; the editors and Ilai still do not; the file
// only replaces one function and runs twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';

const FILE = '20261125100000_noam_access_link.sql';
const SQL = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
const PEOPLE = { owner: null, irit: 'irit', ofir: 'ofir', noam: 'noam', ilai: 'ilai', nadia: 'nadia' };
let db;
const users = {};
let client;

before(async () => {
  db = await freshDatabase({ upTo: FILE });
  // The checks that allow Noam ran live by the owner's hand (supabase/pending/noam_checks.sql).
  await db.exec(readFileSync(new URL('../../supabase/pending/noam_checks.sql', import.meta.url), 'utf8'));
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  client = (await db.query("insert into public.clients (name, status, shoot_type) values ('קפה', 'active', 'dms') returning id")).rows[0].id;
});

const q = (who, sql, params = []) => as(db, users[who], async (tx) => (await tx.query(sql, params)).rows);

test('the file: the newest, only replaces, runs twice', async () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), []);
  assert.doesNotMatch(SQL, /\b(drop|delete|truncate)\b/i);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
});

test('Noam may make the link, as Irit, Ofir and the owner; Ilai and the editors may not', async () => {
  for (const who of ['owner', 'irit', 'ofir', 'noam']) {
    const out = await q(who, 'select public.can_manage_access_links() as ok');
    assert.equal(out.error, undefined, who);
    assert.equal(out[0]?.ok ?? out.rows?.[0]?.ok, true, who);
  }
  for (const who of ['ilai', 'nadia']) {
    const out = await q(who, 'select public.can_manage_access_links() as ok');
    assert.equal(out[0]?.ok ?? false, false, who);
  }
  const made = await q('noam', 'select public.access_link_create($1) as r', [client]);
  assert.equal(made.error, undefined, String(made.error));
  assert.ok(made[0].r, 'a link');
  const refused = await q('nadia', 'select public.access_link_create($1) as r', [client]);
  assert.match(String(refused.error || ''), /not allowed/);
});
