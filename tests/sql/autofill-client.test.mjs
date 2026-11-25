// The client's details fill themselves (25.11.2026; supabase/migrations/20261225100000_autofill_client.sql;
// docs/ops.md, section 153): Ofir saves the characterization form, or a contract uploaded by hand is
// kept, and the card gets the phone, the address, the email, the company id and the characterization
// call's date, only where it is empty. Invented people and clients only.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql } from './pg.mjs';

const FILE = '20261225100000_autofill_client.sql';
let db;
const users = {};

async function as(who, sql, params = []) {
  const u = users[who];
  try {
    return await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated' })]);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (err) { return { error: err.message }; }
}
const clientRow = async (id) => (await db.query('select phone, address, contact_email, company_id, char_at from public.clients where id = $1', [id])).rows[0];
const newClient = async (extra = '') => (await db.query(`insert into public.clients (name, status, shoot_type${extra ? ', phone, address' : ''}) values ('מאפיית הדגמה', 'active', 'natali'${extra}) returning id`)).rows[0].id;

before(async () => {
  db = await freshDatabase();
  await db.exec(migrationSql(FILE)); // runs again safely
  for (const [key, person] of Object.entries({ owner: null, ofir: 'ofir', irit: 'irit' })) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false) on conflict (email) do update set person = excluded.person', [email, person]);
  }
});

test('the characterization form: the phone, the address and the call\'s date fill the empty card', async () => {
  const id = await newClient();
  const r = await as('ofir', "insert into public.characterizations (client_id, fields) values ($1, $2) returning client_id", [id, JSON.stringify({ phone: '050-1234567', address: ' הרצל  12, חיפה', services: 'לחם' })]);
  assert.equal(r.error, undefined, r.error);
  const c = await clientRow(id);
  assert.deepEqual([c.phone, c.address], ['050-1234567', 'הרצל 12, חיפה']);
  assert.ok(c.char_at, 'the call\'s date is the moment the form was saved');
  // Saved again with other values: nothing already filled changes, the date neither.
  const first = c.char_at;
  await as('ofir', "update public.characterizations set fields = $2 where client_id = $1", [id, JSON.stringify({ phone: '03-9999999', address: 'אחר 1, תל אביב', services: 'לחם' })]);
  const again = await clientRow(id);
  assert.deepEqual([again.phone, again.address, String(again.char_at)], ['050-1234567', 'הרצל 12, חיפה', String(first)]);
});

test('a card already filled by hand is never overwritten; an empty form changes nothing', async () => {
  const id = await newClient(", '052-0000000', 'הכתובת של עירית 5'");
  await db.query("update public.clients set char_at = '2026-11-20T10:00:00+02:00' where id = $1", [id]);
  await as('ofir', "insert into public.characterizations (client_id, fields) values ($1, $2)", [id, JSON.stringify({ phone: '050-1234567', address: 'הרצל 12, חיפה' })]);
  const c = await clientRow(id);
  assert.deepEqual([c.phone, c.address, new Date(c.char_at).toISOString()], ['052-0000000', 'הכתובת של עירית 5', '2026-11-20T08:00:00.000Z']);
  const empty = await newClient();
  await as('ofir', "insert into public.characterizations (client_id, fields) values ($1, $2)", [empty, JSON.stringify({ phone: ' ', services: '' })]);
  const e = await clientRow(empty);
  assert.deepEqual([e.phone, e.address, e.char_at], [null, null, null]);
});

test('a contract uploaded by hand: the company id, email, phone and address fill the empty card; bad ones are skipped', async () => {
  const id = await newClient();
  const fid = (await db.query("insert into public.client_files (client_id, kind, label, storage_path) values ($1, 'material_other', 'חוזה חתום', $2) returning id", [id, `${id}/material_other/${crypto.randomUUID()}-x.pdf`])).rows[0].id;
  const r = await as('ofir', "insert into public.manual_contracts (client_id, file_id, business, company_id, phone, email, address, read_by_ai) values ($1, $2, 'מאפיית הדגמה', '515151515', '050-7654321', 'Dana@Example.co.il', 'הרצל 12, חיפה', true) returning id", [id, fid]);
  assert.equal(r.error, undefined, r.error);
  const c = await clientRow(id);
  assert.deepEqual([c.company_id, c.contact_email, c.phone, c.address], ['515151515', 'dana@example.co.il', '050-7654321', 'הרצל 12, חיפה']);
  // A correction later does not overwrite what the card already has.
  await as('ofir', "update public.manual_contracts set phone = '03-1111111', email = 'other@x.co' where id = $1", [r.rows[0].id]);
  const again = await clientRow(id);
  assert.deepEqual([again.contact_email, again.phone], ['dana@example.co.il', '050-7654321']);
  // A phone that is not a phone is not put in the card.
  const id2 = await newClient();
  const fid2 = (await db.query("insert into public.client_files (client_id, kind, label, storage_path) values ($1, 'material_other', 'חוזה חתום', $2) returning id", [id2, `${id2}/material_other/${crypto.randomUUID()}-x.pdf`])).rows[0].id;
  await as('ofir', "insert into public.manual_contracts (client_id, file_id, business, phone, email, read_by_ai) values ($1, $2, 'מוסך', 'אין', 'no-mail', true)", [id2, fid2]);
  const c2 = await clientRow(id2);
  assert.deepEqual([c2.phone, c2.contact_email], [null, null]);
});

test('the file only adds: nothing dropped or deleted', () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/\bdrop\s+(table|column|function)|\bdelete\s+from\b|\btruncate\b/gi), null);
});
