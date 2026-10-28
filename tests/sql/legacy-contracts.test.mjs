// supabase/migrations/20261105100000_legacy_contracts.sql in a real Postgres with every
// migration (tests/sql/pg.mjs): the signed documents of the old system (astrateg-crm), each
// in its client's card (the owner's request of 25.10.2026).
//   - the file is the newest but four, only adds (none of the three words the production tool refuses)
//     and runs twice;
//   - only the owner imports, through public.legacy_contract_import(); again on the same old
//     id changes the same row; the client must be there; the type and the signature are checked;
//   - the stored document has no IP, browser, phone or company number, even when sent, also
//     inside the signers and the signing history;
//   - the office reads (owner, Irit, Lior, Ofir, Ilai); an editor, the photographer and anyone
//     signed out do not; nobody writes the table directly.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';

const FILE = '20261105100000_legacy_contracts.sql';
let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', eli: 'eli', nadia: 'nadia' };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
  for (const name of ['ron', 'gil']) {
    const { rows } = await db.query("insert into public.clients (name, status) values ($1, 'active') returning id", [name]);
    ids[name] = rows[0].id;
  }
});

// An old record as the old system kept it.
const OLD = (fields = {}) => ({
  id: 1017, clientId: 44, clientName: 'רון כהן', business: 'מספרת רון', hp: '512345678', phone: '050-1234567',
  packageName: 'חבילת פרימיום', influencers: 2, months: 12, shootDays: 1, contentTotal: 40, reels: 25, graphics: 15,
  totalAmount: 60000, retainer: '5,000', paymentMethod: 'הוראת קבע', notes: 'הערה', createdAt: '2025-03-01T08:00:00.000Z',
  docNumber: 'AST-2025-017', validUntil: '2025-03-04T08:00:00.000Z', docHash: 'a'.repeat(64), docHashAt: '2025-03-01T08:00:00.000Z',
  signHistory: [{ at: '2025-03-02T09:00:00.000Z', event: 'signed', ip: '1.2.3.4', userAgent: 'Mozilla' }],
  signerName: 'רון כהן', signature: PNG, signedAt: '2025-03-02T09:00:00.000Z', signedIp: '1.2.3.4', signedUserAgent: 'Mozilla/5.0',
  firstViewedAt: '2025-03-01T10:00:00.000Z', customClauses: ['סעיף מיוחד', { title: 'בלעדיות', text: 'אין' }], packageBullets: ['25 סרטונים'],
  status: 'נחתם', docType: '', signers: [{ name: 'רון כהן', signature: PNG, signedAt: '2025-03-02T09:00:00.000Z', ip: '1.2.3.4', phone: '050' }],
  consentText: 'קראתי ואני מאשר', signatureHash: 'b'.repeat(64), catalog: { a: 1 },
  ...fields,
});

// Runs and keeps the change (the RPC writes); returns the result, or { error }.
async function keep(who, sql, params = []) {
  const u = users[who];
  let out;
  try {
    await db.transaction(async (tx) => {
      if (u) {
        await tx.query('set local role authenticated');
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated' })]);
      } else {
        await tx.query('set local role anon');
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'anon' })]);
      }
      out = (await tx.query(sql, params)).rows;
    });
  } catch (err) { out = { error: err.message }; }
  return out;
}
const imp = (who, client, doc) => keep(who, 'select public.legacy_contract_import($1, $2) as r', [client, JSON.stringify(doc)]).then((r) => (r.error ? r : r[0].r));
const read = (who) => as(db, who ? users[who] : null, async (tx) => (await tx.query('select id, client_id, doc_type, doc_number, signer_name from public.legacy_contracts order by id')).rows);
const stored = async (id) => (await db.query('select * from public.legacy_contracts where id = $1', [id])).rows[0];

test('the file: the newest but four, only adds, and runs twice', async () => {
  // After it only "הכנת חוזה עם AI" (20261106100000_contract_ai.sql) and a shoot day without influencers (20261107100000_shoot_crew.sql, 25.10.2026); the old system's characterizations (20261109100000_legacy_characterizations.sql, 26.10.2026).
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261106100000_contract_ai.sql', '20261107100000_shoot_crew.sql', '20261109100000_legacy_characterizations.sql', '20261110100000_batch_2710.sql', '20261111100000_p06_ofir.sql', '20261112100000_new_influencers.sql', '20261112200000_legacy_contracts_full.sql', '20261113100000_client_details_month.sql']);
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  // Back to the live order: the later file keeps the whole record (20261112200000_legacy_contracts_full.sql).
  await db.exec(migrationSql('20261112200000_legacy_contracts_full.sql'));
  assert.equal((await db.query("select count(*)::int as n from pg_policies where tablename = 'legacy_contracts'")).rows[0].n, 1);
  assert.equal((await db.query("select relrowsecurity as on from pg_class where oid = 'public.legacy_contracts'::regclass")).rows[0].on, true);
});

test('the owner imports: the columns from the record, the type, the amounts and the time', async () => {
  const r = await imp('owner', ids.ron, OLD());
  assert.equal(r.id, 1017);
  assert.equal(r.client_id, ids.ron);
  assert.equal(r.doc_type, 'contract');
  assert.equal(r.doc, undefined, 'the document is not sent back');
  assert.equal(r.signature, undefined);
  const row = await stored(1017);
  assert.deepEqual([row.doc_number, row.signer_name, row.signed_at.toISOString(), Number(row.total_amount), Number(row.retainer), row.imported_by],
    ['AST-2025-017', 'רון כהן', '2025-03-02T09:00:00.000Z', 60000, 5000, 'owner@astrateg.test']);
  assert.equal(row.signature, PNG);
  // The other two types; the time as milliseconds; the signer from the signers when no name.
  assert.equal((await imp('owner', ids.ron, OLD({ id: 1018, docType: 'termination', signedAt: Date.parse('2025-09-01T10:00:00Z'), signerName: '', parentContractId: 1017 }))).doc_type, 'termination');
  const t = await stored(1018);
  assert.equal(t.signed_at.toISOString(), '2025-09-01T10:00:00.000Z');
  assert.equal(t.signer_name, 'רון כהן');
  assert.equal((await imp('owner', ids.gil, OLD({ id: 1019, docType: 'addendum', totalAmount: 'לא ידוע', signature: '' }))).doc_type, 'addendum');
  const a = await stored(1019);
  assert.equal(a.total_amount, null);
  assert.equal(a.signature, null);
});

test('the stored document: everything of it, the company number, the phone and the device of the signing too (the owner, 28.10.2026)', async () => {
  // Until 20261112200000_legacy_contracts_full.sql these were taken out; now the record is kept whole.
  const { doc } = await stored(1017);
  assert.deepEqual([doc.hp, doc.phone, doc.signedIp, doc.signedUserAgent], ['512345678', '050-1234567', '1.2.3.4', 'Mozilla/5.0']);
  assert.deepEqual(doc.signHistory, [{ at: '2025-03-02T09:00:00.000Z', event: 'signed', ip: '1.2.3.4', userAgent: 'Mozilla' }]);
  assert.deepEqual(Object.keys(doc.signers[0]).sort(), ['ip', 'name', 'phone', 'signature', 'signedAt']);
  // What is needed to read it is kept as it was.
  assert.deepEqual(doc.customClauses, ['סעיף מיוחד', { title: 'בלעדיות', text: 'אין' }]);
  assert.equal(doc.docHash, 'a'.repeat(64));
  assert.equal(doc.status, 'נחתם');
  assert.deepEqual(doc.catalog, { a: 1 });
});

test('again on the same old id: the same row, changed', async () => {
  const before = (await db.query('select count(*)::int as n from public.legacy_contracts')).rows[0].n;
  await imp('owner', ids.ron, OLD({ signerName: 'רון כ.', notes: 'עודכן' }));
  await imp('owner', ids.ron, OLD({ signerName: 'רון כ.', notes: 'עודכן' }));
  assert.equal((await db.query('select count(*)::int as n from public.legacy_contracts')).rows[0].n, before);
  const row = await stored(1017);
  assert.equal(row.signer_name, 'רון כ.');
  assert.equal(row.doc.notes, 'עודכן');
});

test('only the owner imports; the client must be there; the record is checked', async () => {
  for (const who of ['irit', 'lior', 'ofir', 'ilai', 'eli', 'nadia', null]) {
    const r = await imp(who, ids.ron, OLD({ id: 2000 }));
    assert.match(r.error || '', who ? /not allowed/ : /not allowed|permission denied/, String(who));
  }
  assert.equal(await stored(2000), undefined);
  assert.match((await imp('owner', '00000000-0000-4000-8000-000000000000', OLD({ id: 2001 }))).error || '', /no such client/);
  assert.match((await imp('owner', ids.ron, OLD({ id: 'abc' }))).error || '', /the old id/);
  assert.match((await imp('owner', ids.ron, OLD({ id: 2002, docType: 'quote' }))).error || '', /unknown document type/);
  for (const sig of ['data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)', `data:image/png;base64,${'A'.repeat(400000)}`]) {
    assert.match((await imp('owner', ids.ron, OLD({ id: 2003, signature: sig }))).error || '', /a PNG picture/);
  }
  assert.equal((await db.query('select count(*)::int as n from public.legacy_contracts where id >= 2000')).rows[0].n, 0);
});

test('reading: the office; not an editor, the photographer or anyone signed out; nobody writes directly', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) assert.deepEqual((await read(who)).map((r) => r.id), [1017, 1018, 1019], who);
  for (const who of ['nadia', 'eli']) assert.deepEqual(await read(who), [], who);
  assert.match((await read(null)).error || '', /permission denied/);
  for (const who of ['owner', 'irit', 'nadia']) {
    const ins = await as(db, users[who], (tx) => tx.query("insert into public.legacy_contracts (id, client_id, doc) values (5, $1, '{}')", [ids.ron]));
    assert.match(ins.error || '', /permission denied/, who);
    const upd = await as(db, users[who], (tx) => tx.query("update public.legacy_contracts set signer_name = 'x' where true"));
    assert.match(upd.error || '', /permission denied/, who);
  }
  // The helpers are not the API's.
  for (const fn of ['private.legacy_scrub(\'{}\'::jsonb)', 'private.legacy_number(\'1\'::jsonb)', 'private.legacy_time(\'1\'::jsonb)']) {
    const r = await as(db, users.owner, (tx) => tx.query(`select ${fn}`));
    assert.match(r.error || '', /permission denied/, fn);
  }
});
