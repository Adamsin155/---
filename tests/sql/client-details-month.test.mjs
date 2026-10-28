// supabase/migrations/20261113100000_client_details_month.sql in a real Postgres with every
// migration (tests/sql/pg.mjs): the client's email and company number (the owner, 28.10.2026).
//   - the file only adds (none of the three words the production tool refuses) and runs twice,
//     also onto a database with clients and agreements in it;
//   - the office writes and reads both (clients_contact()); an editor, Eli and a field agent
//     cannot read them, and an editor cannot write them;
//   - what is kept: 9 digits, an address in lower case; anything else is refused;
//   - from the signed agreement: copied once into an empty field, well formed only, and for a
//     new client opened from it;
//   - "יום צילום חודשי" is a key of deliverables: no check refuses it.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql } from './pg.mjs';

const FILE = '20261113100000_client_details_month.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', nadia: 'nadia', eli: 'eli', amos: 'amos' };
let db;
const users = {};
const ids = {};

async function people(d) {
  const out = {};
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await d.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    out[key] = { id: rows[0].id, email };
    try { await d.query('insert into public.staff (email, person) values ($1, $2)', [email, person]); } catch { /* a person the staff table does not know yet */ }
  }
  return out;
}
const quote = async (d, client) => (await d.query("insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot, status, signed_at) values ($1, 'x', 100000, 1200000, 'signed', now()) returning id",
  [JSON.stringify({ client, totals: {} })])).rows[0].id;
const run = (who, sql, params = []) => as(db, users[who], async (tx) => { const r = await tx.query(sql, params); return { rows: r.rows, affected: r.affectedRows }; });

before(async () => {
  // The database before the file, with a client opened from an agreement.
  db = await freshDatabase({ upTo: FILE });
  Object.assign(users, await people(db));
  const q1 = await quote(db, { name: 'רות', email: ' Ruth@Example.co.il ', companyId: '51-472-993-8', phone: '050-1' });
  const q2 = await quote(db, { name: 'חן', email: 'not an email', companyId: '12' });
  ids.q3 = await quote(db, { name: 'בראשית', email: 'b@b.io', companyId: '1234567 8' });
  ids.ruth = (await db.query("insert into public.clients (name, status, quote_id, editor) values ('שטיחי רות', 'active', $1, 'nadia') returning id", [q1])).rows[0].id;
  ids.chen = (await db.query("insert into public.clients (name, status, quote_id, editor) values ('נקודת חן', 'active', $1, 'nadia') returning id", [q2])).rows[0].id;
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
});

test('the file only adds, and runs twice', async () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+(\s+[a-z])?\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  assert.equal((await db.query("select count(*)::int as n from pg_constraint where conname in ('clients_contact_email_check', 'clients_company_id_check')")).rows[0].n, 2);
  // clients_private() is as it was (an older migration can still run again after this one).
  const priv = (await db.query("select pg_get_function_result(p.oid) as r from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'clients_private' and n.nspname = 'public'")).rows;
  assert.deepEqual(priv.map((r) => r.r), ['TABLE(id uuid, phone text, notes text, closed_reason text)']);
});

test('copied from the signed agreement: well formed only, into an empty field', async () => {
  const rows = (await db.query('select name, contact_email, company_id from public.clients where id = any($1) order by name', [[ids.ruth, ids.chen]])).rows;
  assert.deepEqual(rows, [
    { name: 'נקודת חן', contact_email: null, company_id: null },
    { name: 'שטיחי רות', contact_email: 'ruth@example.co.il', company_id: '514729938' },
  ]);
  // A new client opened from an agreement gets them as it is added (an 8-digit number gets its zero).
  // Irit opens it ("לקוח חדש" from a signed agreement; rolled back after).
  const r = await as(db, users.irit, async (tx) => {
    const id = (await tx.query("insert into public.clients (name, quote_id) values ('בראשית', $1) returning id", [ids.q3])).rows[0].id;
    return (await tx.query('select contact_email, company_id from public.clients_contact($1)', [[id]])).rows;
  });
  assert.deepEqual(r, [{ contact_email: 'b@b.io', company_id: '012345678' }]);
  // A field already filled is kept.
  const added = (await db.query("insert into public.clients (name, quote_id, contact_email) values ('בראשית', $1, 'own@x.io') returning contact_email, company_id", [ids.q3])).rows[0];
  assert.deepEqual(added, { contact_email: 'own@x.io', company_id: '012345678' });
});

test('the office writes and reads them; nobody else reads them, and an editor cannot write them', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir']) {
    const up = await as(db, users[who], async (tx) => {
      await tx.query("update public.clients set contact_email = 'office@x.co', company_id = '123456789' where id = $1", [ids.chen]);
      return (await tx.query('select contact_email, company_id from public.clients_contact($1)', [[ids.chen]])).rows;
    });
    assert.deepEqual(up, [{ contact_email: 'office@x.co', company_id: '123456789' }], who);
  }
  for (const who of ['nadia', 'eli', 'amos']) {
    for (const col of ['contact_email', 'company_id']) {
      assert.match((await run(who, `select ${col} from public.clients`)).error || '', /permission denied/, `${who} ${col}`);
    }
    assert.deepEqual((await run(who, 'select * from public.clients_contact()')).rows, [], who);
  }
  const ed = await run('nadia', "update public.clients set company_id = '111111111' where id = $1", [ids.ruth]);
  assert.ok(ed.error || ed.affected === 0, 'an editor does not write');
});

test('what is kept: 9 digits and an address; anything else is refused', async () => {
  for (const [col, v] of [['company_id', '12345678'], ['company_id', '12345678a'], ['company_id', '1234567890'], ['contact_email', 'Ruth@x.co'], ['contact_email', 'no-at.co'], ['contact_email', 'a b@x.co']]) {
    const r = await run('irit', `update public.clients set ${col} = $2 where id = $1`, [ids.chen, v]);
    assert.match(r.error || '', /check constraint/, `${col} ${v}`);
  }
});

test('"יום צילום חודשי" is a key of deliverables, saved by the office as it is', async () => {
  const r = await as(db, users.irit, async (tx) => {
    await tx.query("update public.clients set deliverables = deliverables || '{\"shoot_monthly\": true}'::jsonb where id = $1", [ids.ruth]);
    return (await tx.query("select deliverables -> 'shoot_monthly' as v from public.clients where id = $1", [ids.ruth])).rows[0].v;
  });
  assert.equal(r, true);
});
