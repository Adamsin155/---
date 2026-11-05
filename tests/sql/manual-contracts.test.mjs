// supabase/migrations/20261130100000_manual_contracts.sql in a real Postgres with every migration
// (tests/sql/pg.mjs; docs/ops.md, section 104):
//   - the file is the newest, only adds, and runs twice;
//   - the owners, Irit, Ofir and Lior read and add; Noam, Ilai, the editors and Stav do not;
//   - only a signed contract file ("חוזה חתום") of the same client; one row per file;
//   - who and when come from the session; the client and the file never change; nothing is deleted.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql, migrationFiles } from './pg.mjs';

const FILE = '20261130100000_manual_contracts.sql';
const SQL = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
const PEOPLE = { owner: null, irit: 'irit', ofir: 'ofir', lior: 'lior', noam: 'noam', ilai: 'ilai', nadia: 'nadia', stav: 'stav' };
let db;
const users = {};
let client;
let other;
let contract;
let logo;
let otherContract;

async function call(who, sql, params = []) {
  const user = who === 'anon' ? null : users[who];
  const role = user ? 'authenticated' : 'anon';
  const claims = user ? { sub: user.id, email: user.email, role, aud: 'authenticated' } : { role };
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      const r = await tx.query(sql, params);
      return { rows: r.rows, affected: r.affectedRows };
    });
  } catch (err) {
    return { error: err.message };
  }
}
const file = async (cid, kind, label) => (await db.query(
  "insert into public.client_files (client_id, kind, label, storage_path) values ($1, $2, $3, $4) returning id",
  [cid, kind, label, `${cid}/${kind}/${crypto.randomUUID()}-x.pdf`])).rows[0].id;
const add = (who, cid, fid, extra = {}) => call(who,
  'insert into public.manual_contracts (client_id, file_id, business, company_id, package_id, package_name, monthly_net_agorot, term_months, signed_on, read_by_ai, created_by_email) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10) returning *',
  [cid, fid, extra.business ?? 'בסט קאר', extra.company_id ?? '515151515', 'social-choice', 'Social all in one · משפיען לבחירה', extra.monthly ?? 390000, extra.term ?? 12, '2026-11-04', extra.by ?? 'fake@x']);

before(async () => {
  db = await freshDatabase({ upTo: FILE });
  // The checks that allow Noam and the field ran live by the owner's hand.
  await db.exec(readFileSync(new URL('../../supabase/pending/noam_checks.sql', import.meta.url), 'utf8'));
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  client = (await db.query("insert into public.clients (name, status, shoot_type) values ('בסט קאר', 'active', 'natali') returning id")).rows[0].id;
  other = (await db.query("insert into public.clients (name, status, shoot_type) values ('קפה', 'active', 'dms') returning id")).rows[0].id;
  contract = await file(client, 'material_other', 'חוזה חתום');
  logo = await file(client, 'logo', null);
  otherContract = await file(other, 'material_other', 'חוזה חתום');
});

test('the file: the newest, only adds, and runs twice', async () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), []);
  assert.doesNotMatch(SQL, /\b(drop|delete|truncate)\b/i);
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
});

test('only those who see the quotes\' money add one, for a signed contract file of the same client', async () => {
  for (const who of ['noam', 'ilai', 'nadia', 'stav']) {
    assert.ok((await add(who, client, contract)).error, who);
  }
  assert.match((await add('anon', client, contract)).error, /permission denied/);
  // Not a logo, not another client's contract.
  assert.ok((await add('irit', client, logo)).error, 'a logo is not a contract');
  assert.ok((await add('irit', client, otherContract)).error, 'another client\'s file');
  const ok = await add('ofir', client, contract);
  assert.equal(ok.error, undefined, ok.error);
  const row = ok.rows[0];
  // Who and when from the session, not from the browser.
  assert.equal(row.created_by_email, 'ofir@astrateg.test');
  assert.deepEqual([row.monthly_net_agorot, row.term_months, row.package_id], [390000, 12, 'social-choice']);
  // One row per file.
  assert.match((await add('irit', client, contract)).error, /duplicate|unique/);
});

test('the owners, Irit, Ofir and Lior read it; the others do not', async () => {
  for (const who of ['owner', 'irit', 'ofir', 'lior']) {
    assert.equal((await call(who, 'select id from public.manual_contracts')).rows.length, 1, who);
  }
  for (const who of ['noam', 'ilai', 'nadia', 'stav']) {
    assert.equal((await call(who, 'select id from public.manual_contracts')).rows?.length ?? 0, 0, who);
  }
  assert.match((await call('anon', 'select id from public.manual_contracts')).error, /permission denied/);
});

test('a correction: the details change, the client, the file and who made it do not; nothing is deleted', async () => {
  // The client, the file and who made it are not the browser's to write at all.
  for (const col of ['client_id', 'file_id', 'created_by_email']) {
    assert.match((await call('lior', `update public.manual_contracts set ${col} = ${col}`)).error, /permission denied/, col);
  }
  const r = await call('lior', 'update public.manual_contracts set monthly_net_agorot = 350000 returning *');
  assert.equal(r.error, undefined, r.error);
  assert.deepEqual([r.rows[0].monthly_net_agorot, r.rows[0].client_id, r.rows[0].created_by_email, r.rows[0].updated_by_email], [350000, client, 'ofir@astrateg.test', 'lior@astrateg.test']);
  assert.equal((await call('ilai', 'update public.manual_contracts set term_months = 1')).affected ?? 0, 0);
  assert.match((await call('owner', 'delete from public.manual_contracts')).error, /permission denied/); // nobody removes one
  // The checks: a bad company id, a price out of range.
  assert.match((await call('irit', "update public.manual_contracts set company_id = '123'")).error, /company_id_check/);
  assert.match((await call('irit', 'update public.manual_contracts set monthly_net_agorot = 1')).error, /monthly_net_agorot_check/);
});
