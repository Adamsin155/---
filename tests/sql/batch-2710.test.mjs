// supabase/migrations/20261110100000_batch_2710.sql in a real Postgres with every migration
// (tests/sql/pg.mjs): the owner's requests of 27.10.2026.
//   - the file is the newest, only adds (none of the three words the production tool refuses)
//     and runs twice;
//   - the old system's documents in all three states: a row brought over before the file is
//     'signed'; 'ממתין לחתימה' and 'הצעת מחיר' are kept with no signature and no signing
//     time; an unknown state is refused; again on the same old id changes the same row;
//   - "לקוח חדש" for Lior and Ofir: they add a client (as the owner and Irit), and attach
//     the signed contract as a file ('material_other', "חוזה חתום"); Ilai's and an editor's
//     contract file is refused;
//   - the characterization at any time: Ofir, Lior and Irit save it for a client with no
//     meeting and no mark.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';

const FILE = '20261110100000_batch_2710.sql';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia' };
let db;
const users = {};
const ids = {};

const OLD = (fields = {}) => ({
  id: 3001, clientId: 9, clientName: 'דנה', docNumber: 'AST-2025-200', totalAmount: 24000, retainer: 2000, months: 12,
  signerName: 'דנה לוי', signature: PNG, signedAt: '2025-05-02T09:00:00.000Z', status: 'נחתם', phone: '050-1112222', ...fields,
});

async function keep(db, u, sql, params = []) {
  let out;
  try {
    await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated' })]);
      out = (await tx.query(sql, params)).rows;
    });
  } catch (err) { out = { error: err.message }; }
  return out;
}
const imp = (client, doc) => keep(db, users.owner, 'select public.legacy_contract_import($1, $2) as r', [client, JSON.stringify(doc)]).then((r) => (r.error ? r : r[0].r));
const stored = async (id) => (await db.query('select * from public.legacy_contracts where id = $1', [id])).rows[0];

async function people(d) {
  const out = {};
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await d.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    out[key] = { id: rows[0].id, email };
    await d.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
  return out;
}

before(async () => {
  db = await freshDatabase();
  Object.assign(users, await people(db));
  const { rows } = await db.query("insert into public.clients (name, status) values ('דנה', 'active') returning id");
  ids.dana = rows[0].id;
});

test('the file: the newest, only adds, and runs twice', async () => {
  // After it only Niro and "הצל" (20261112100000_new_influencers.sql, 28.10.2026).
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261112100000_new_influencers.sql']);
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  assert.equal((await db.query("select count(*)::int as n from pg_constraint where conname = 'legacy_contracts_status_check'")).rows[0].n, 1);
});

test('a document brought over before the file stays signed', async () => {
  const old = await freshDatabase({ upTo: FILE });
  const u = await people(old);
  const { rows } = await old.query("insert into public.clients (name, status) values ('x', 'active') returning id");
  const r = await keep(old, u.owner, 'select public.legacy_contract_import($1, $2) as r', [rows[0].id, JSON.stringify(OLD())]);
  assert.equal(r.error, undefined);
  await old.exec(migrationSql(FILE));
  const row = (await old.query('select status, signature, signed_at from public.legacy_contracts where id = 3001')).rows[0];
  assert.equal(row.status, 'signed');
  assert.equal(row.signature, PNG);
  assert.equal(row.signed_at.toISOString(), '2025-05-02T09:00:00.000Z');
  await old.close();
});

test('the three states: signed keeps its signature; waiting and a price offer keep none, and no signing time', async () => {
  assert.equal((await imp(ids.dana, OLD())).status, 'signed');
  const s = await stored(3001);
  assert.deepEqual([s.status, s.signature, s.signed_at.toISOString()], ['signed', PNG, '2025-05-02T09:00:00.000Z']);

  const p = await imp(ids.dana, OLD({ id: 3002, status: 'ממתין לחתימה', signerName: '', signature: PNG, signedAt: '2025-05-03T09:00:00.000Z' }));
  assert.equal(p.status, 'pending');
  const ps = await stored(3002);
  assert.deepEqual([ps.status, ps.signature, ps.signed_at, Number(ps.total_amount)], ['pending', null, null, 24000]);
  assert.equal(ps.doc.status, 'ממתין לחתימה', 'the old record is kept as it was');
  assert.ok(!('phone' in ps.doc));

  const q = await imp(ids.dana, OLD({ id: 3003, status: 'הצעת מחיר', signerName: undefined, signature: undefined, signedAt: undefined }));
  assert.equal(q.status, 'quote');
  assert.deepEqual([(await stored(3003)).status, (await stored(3003)).signature], ['quote', null]);

  // The English words, and no state at all (a signed one, as before).
  assert.equal((await imp(ids.dana, OLD({ id: 3004, status: 'pending' }))).status, 'pending');
  assert.equal((await imp(ids.dana, OLD({ id: 3005, status: undefined }))).status, 'signed');
  // An unknown state is refused; nothing is written.
  for (const status of ['בוטל', 'נשלח', 'x']) assert.match((await imp(ids.dana, OLD({ id: 3006, status }))).error || '', /an unknown state/, status);
  assert.equal(await stored(3006), undefined);
});

test('again on the same old id: the same row, now signed', async () => {
  const n = (await db.query('select count(*)::int as n from public.legacy_contracts')).rows[0].n;
  await imp(ids.dana, OLD({ id: 3002, status: 'נחתם', signedAt: '2025-06-01T09:00:00.000Z' }));
  assert.equal((await db.query('select count(*)::int as n from public.legacy_contracts')).rows[0].n, n);
  const row = await stored(3002);
  assert.deepEqual([row.status, row.signature, row.signed_at.toISOString()], ['signed', PNG, '2025-06-01T09:00:00.000Z']);
  // And back: waiting again takes the signature out.
  await imp(ids.dana, OLD({ id: 3002, status: 'ממתין לחתימה' }));
  assert.deepEqual([(await stored(3002)).status, (await stored(3002)).signature, (await stored(3002)).signed_at], ['pending', null, null]);
});

test('the office reads the state; only the owner imports', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) {
    const rows = await as(db, users[who], async (tx) => (await tx.query('select id, status from public.legacy_contracts where id in (3001, 3002, 3003) order by id')).rows);
    assert.deepEqual(rows.map((r) => r.status), ['signed', 'pending', 'quote'], who);
  }
  assert.deepEqual(await as(db, users.nadia, async (tx) => (await tx.query('select id from public.legacy_contracts')).rows), []);
  for (const who of ['irit', 'lior', 'ofir']) {
    const r = await keep(db, users[who], 'select public.legacy_contract_import($1, $2) as r', [ids.dana, JSON.stringify(OLD({ id: 3010, status: 'הצעת מחיר' }))]);
    assert.match(r.error || '', /not allowed/, who);
  }
  const r = await as(db, users.owner, (tx) => tx.query("select private.legacy_status('{}'::jsonb)"));
  assert.match(r.error || '', /permission denied/);
});

test('"לקוח חדש": Lior and Ofir add a client as the owner and Irit do; the contract goes in as a file', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir']) {
    const r = await as(db, users[who], async (tx) => {
      const c = (await tx.query("insert into public.clients (name, business, deliverables) values ($1, 'עסק', '{\"videos\": 8}'::jsonb) returning id, name", [`חדש ${who}`])).rows[0];
      const path = `${c.id}/material_other/00000000-0000-4000-8000-000000000001-contract.pdf`;
      const f = (await tx.query("insert into public.client_files (client_id, kind, label, storage_path, mime, size_bytes) values ($1, 'material_other', 'חוזה חתום', $2, 'application/pdf', 1000) returning kind, label",
        [c.id, path])).rows[0];
      return { c, f };
    });
    assert.equal(r.error, undefined, `${who}: ${r.error}`);
    assert.equal(r.c.name, `חדש ${who}`);
    assert.deepEqual(r.f, { kind: 'material_other', label: 'חוזה חתום' });
  }
  // Ilai and an editor: no contract file on a client.
  for (const who of ['ilai', 'nadia']) {
    const r = await as(db, users[who], (tx) => tx.query("insert into public.client_files (client_id, kind, label, storage_path, mime, size_bytes) values ($1, 'material_other', 'חוזה חתום', $2, 'application/pdf', 1000)",
      [ids.dana, `${ids.dana}/material_other/00000000-0000-4000-8000-000000000002-contract.pdf`]));
    assert.match(r.error || '', /row-level security|permission denied/, who);
  }
});

test('the characterization at any time: Ofir, Lior and Irit save it with no meeting and no mark', async () => {
  for (const who of ['ofir', 'lior', 'irit', 'owner']) {
    const r = await as(db, users[who], async (tx) => {
      await tx.query("insert into public.characterizations (client_id, fields) values ($1, '{\"services\": \"תספורות\"}'::jsonb) on conflict (client_id) do update set fields = excluded.fields", [ids.dana]);
      const checks = (await tx.query('select count(*)::int as n from public.protocol_checks where client_id = $1', [ids.dana])).rows[0].n;
      return { fields: (await tx.query('select fields, completed_at from public.characterizations where client_id = $1', [ids.dana])).rows[0], checks };
    });
    assert.equal(r.error, undefined, `${who}: ${r.error}`);
    assert.equal(r.fields.fields.services, 'תספורות');
    assert.equal(r.fields.completed_at, null);
    assert.equal(r.checks, 0, 'no mark');
  }
});
