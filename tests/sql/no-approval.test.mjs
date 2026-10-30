// supabase/migrations/20261118100000_no_manager_approval.sql in a real Postgres with every migration
// (tests/sql/pg.mjs): no contract waits for a manager any more (the owner, 29.10.2026: "להוריד את
// חוזה חריג באישור מנהל"; docs/ops.md, section 79), and the field's free deal.
//   - the file is the newest, has none of the three words the production tool refuses, every update
//     has a where, and it runs twice;
//   - quotes made before it are left exactly as they were (no row changes); one still 'pending'
//     can now be opened and signed; one 'rejected' still cannot;
//   - a custom contract made after it is a regular quote at once: no approval, its signing window
//     from now, what it changed from the package kept; a corrected version is a regular quote;
//   - a contract "בלי משפיענים" opens its client with no influencers' shoot type;
//   - Stav's deal in his own words, with what Irit prepares (doc_type); the old shape stays valid.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { emptySelection, buildQuoteModel, validateSelection, exceptionOf, normalizeSelection } from '../../app/pricing.js';
import { packageDeliverables } from '../../app/protocol-logic.js';
import { validateDeal } from '../../app/deal-logic.js';

const FILE = '20261118100000_no_manager_approval.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', stav: 'stav' };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const CLIENT = { name: 'רות', company: 'שטיחי רות', phone: '050-1234567' };
let db;
const users = {};
const old = {};

const CUSTOM = normalizeSelection({ ...emptySelection(), docType: 'agreement', tier: 'social', influencer: 'natali', custom: { qty: { videos: 20 }, price: 350000, discount: 50000 } });
// The example of 29.10.2026 as an agreement: no influencer, 4,900 ₪, a monthly photographer inside the price, 2 landing pages.
const FREE = normalizeSelection({
  ...emptySelection(), docType: 'agreement', tier: 'social', influencer: 'simeon', paid: ['photographer'],
  custom: { noInfluencer: true, qty: { videos: 0, graphics: 0 }, price: 490000, addonsIncluded: true, lines: [{ label: 'דפי נחיתה', qty: 2 }], discount: 0 },
});

async function create(selection, who = 'irit') {
  validateSelection(selection);
  const model = buildQuoteModel(selection, CLIENT);
  const exc = exceptionOf(selection);
  const cols = {
    model: JSON.stringify(model), client_name: CLIENT.name, monthly_gross_agorot: model.totals.monthlyGross, term_gross_agorot: model.totals.termGross,
    created_by: users[who].id, created_by_email: users[who].email, ...(exc.length ? { exceptions: JSON.stringify(exc) } : {}),
  };
  const keys = Object.keys(cols);
  const { rows } = await db.query(`insert into public.quotes (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(cols));
  return rows[0];
}
async function call(who, sql, params = []) {
  const user = who === 'anon' || who === 'service' ? null : users[who];
  const role = who === 'service' ? 'service_role' : user ? 'authenticated' : 'anon';
  const claims = user ? { sub: user.id, email: user.email, role, aud: 'authenticated' } : { role };
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (err) {
    return { error: err.message };
  }
}
const q = (who, sql, params = []) => as(db, who === 'anon' ? null : users[who], async (tx) => ({ rows: (await tx.query(sql, params)).rows }));
const row = async (id) => (await db.query('select * from public.quotes where id = $1', [id])).rows[0];
const comparable = (r) => JSON.stringify({ ...r, first_viewed_at: undefined });

before(async () => {
  // Before the migration: a contract waiting for a manager, one turned down, one approved.
  db = await freshDatabase({ upTo: FILE });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  old.pending = await create(CUSTOM);
  old.rejected = await create(CUSTOM);
  await call('lior', 'select public.quote_reject($1, $2)', [old.rejected.id, 'ההנחה גבוהה מדי']);
  old.revise = await create(CUSTOM);
  assert.deepEqual([old.pending.approval, old.revise.approval, (await row(old.rejected.id)).approval], ['pending', 'pending', 'rejected']);
  old.before = Object.fromEntries(await Promise.all(Object.entries(old).map(async ([k, v]) => [k, comparable(await row(v.id))])));
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
});

test('the file: the newest, none of the refused words, every update with a where, and it runs twice', async () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261119100000_work_history.sql', '20261120100000_drive_daily.sql']);
  const sql = migrationSql(FILE);
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  const { rows } = await db.query("select prosecdef from pg_proc where proname = 'quotes_set_hash'");
  assert.deepEqual(rows, [{ prosecdef: true }], 'the trigger still runs as its owner');
});

test('the quotes from before are left as they were; one still pending opens and signs; one turned down does not', async () => {
  for (const k of ['pending', 'rejected', 'revise']) assert.equal(comparable(await row(old[k].id)), old.before[k], k);
  const seen = (await q('anon', 'select public.get_quote($1) as g', [old.pending.token])).rows[0].g;
  assert.equal(seen.number, old.pending.number);
  const signed = (await call('anon', 'select public.sign_quote($1, $2, $3, true) as g', [old.pending.token, 'רות', PNG])).rows[0]?.g;
  assert.equal(signed?.status, 'signed');
  const r = await row(old.pending.id);
  assert.deepEqual([r.status, r.approval], ['signed', 'pending'], 'the approval column stays as history');
  assert.equal((await db.query('select count(*)::int as n from public.clients where quote_id = $1', [r.id])).rows[0].n, 1, 'the client opens');
  assert.equal((await q('anon', 'select public.get_quote($1) as g', [old.rejected.token])).rows[0].g, null);
  assert.match((await call('anon', 'select public.sign_quote($1, $2, $3, true)', [old.rejected.token, 'רות', PNG])).error, /quote not found/);
  assert.match((await db.query("update public.quotes set status = 'signed' where id = $1", [old.rejected.id]).catch((e) => ({ error: e.message }))).error, /not approved/);
});

test('a custom contract made now: a regular quote at once, its window from now, what it changed kept for the owners', async () => {
  const r = await create(CUSTOM);
  assert.deepEqual([r.approval, r.submitted_at, r.version], ['none', null, 1]);
  assert.deepEqual(r.exceptions.map((e) => e.kind), exceptionOf(CUSTOM).map((e) => e.kind));
  assert.ok(Math.abs(new Date(r.expires_at) - new Date(r.created_at) - 72 * 3600e3) < 1000);
  assert.equal(new Date(r.model.validUntil).getTime(), r.expires_at.getTime());
  assert.equal((await db.query("select doc_hash = encode(extensions.digest(model::text, 'sha256'), 'hex') as ok from public.quotes where id = $1", [r.id])).rows[0].ok, true);
  assert.deepEqual((await db.query('select event from public.quote_versions where quote_id = $1', [r.id])).rows, [], 'no approval history');
  assert.equal((await q('anon', 'select public.get_quote($1) as g', [r.token])).rows[0].g.number, r.number);
  // Whatever the caller sends, the database decides: never pending.
  const forced = await db.query(`insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot, approval) values ($1, 'x', 1, 1, 'pending') returning approval`, [JSON.stringify(buildQuoteModel(CUSTOM, CLIENT))]);
  assert.equal(forced.rows[0].approval, 'none');
  // A regular one keeps no exceptions, as before.
  assert.equal((await create({ ...emptySelection(), docType: 'agreement' })).exceptions, null);
});

test('a correction of a contract from before is a regular quote: the token, the window, what it changed', async () => {
  const model = buildQuoteModel(CUSTOM, CLIENT);
  const rev = (await call('service', 'select public.quote_revise($1, $2, $3, $4, $5, $6, $7) as r',
    [old.revise.id, JSON.stringify(model), CLIENT.name, model.totals.monthlyGross, model.totals.termGross, JSON.stringify(exceptionOf(CUSTOM)), users.irit.email])).rows[0].r;
  assert.deepEqual([rev.approval, rev.version, rev.token], ['none', 2, old.revise.token]);
  const r = await row(old.revise.id);
  assert.equal(r.exceptions.length, exceptionOf(CUSTOM).length);
  assert.ok(r.expires_at && r.model.validUntil);
  assert.equal((await q('anon', 'select public.get_quote($1) as g', [r.token])).rows[0].g.number, r.number);
  // Nobody calls the approval functions any more; a regular quote was never "for approval".
  assert.match((await call('lior', 'select public.quote_approve($1)', [r.id])).error, /not waiting for approval/);
});

test('"בלי משפיענים": signed, its client opens with no influencers\' shoot type and what was written', async () => {
  const r = await create(FREE);
  assert.equal(r.approval, 'none');
  const signed = (await call('anon', 'select public.sign_quote($1, $2, $3, true) as g', [r.token, 'רות', PNG])).rows[0].g;
  assert.equal(signed.status, 'signed');
  const c = (await db.query('select shoot_type, package_name, deliverables from public.clients where quote_id = $1', [r.id])).rows[0];
  assert.equal(c.shoot_type, null);
  assert.equal(c.package_name, 'Social all in one · בלי משפיענים');
  assert.deepEqual(c.deliverables, packageDeliverables(r.model));
  assert.equal(c.deliverables.monthly, 96);
  assert.equal(c.deliverables.shoot_days, 0);
  // With an influencer, as before.
  const n = await create(CUSTOM);
  await call('anon', 'select public.sign_quote($1, $2, $3, true)', [n.token, 'רות', PNG]);
  assert.equal((await db.query('select shoot_type from public.clients where quote_id = $1', [n.id])).rows[0].shoot_type, 'natali');
});

test('Stav\'s deal in his own words, with what Irit prepares; the old shape still goes in; the quote linked makes it "sent"', async () => {
  const add = (row) => {
    const keys = Object.keys(row);
    return call('stav', `insert into public.deal_requests (${keys.join(', ')}) values (${keys.map((k, i) => (['paid'].includes(k) ? `$${i + 1}::text[]` : `$${i + 1}`)).join(', ')}) returning *`,
      keys.map((k) => (k === 'custom' || k === 'free' ? JSON.stringify(row[k]) : row[k])));
  };
  const v = validateDeal({ kind: 'free', doc_type: 'quote', business_name: 'שטיחי רות', contact_name: 'רות', phone: '050-1234567', text: 'בלי משפיען 4,900 בחודש\nצילום כל חודש 8 תכנים' });
  const d = (await add(v.row)).rows?.[0];
  assert.ok(d, 'Stav adds it');
  assert.deepEqual([d.status, d.doc_type, d.custom, d.seller], ['pending', 'quote', { text: 'בלי משפיען 4,900 בחודש\nצילום כל חודש 8 תכנים' }, 'stav']);
  for (const bad of [{ doc_type: 'contract' }, { custom: { text: '  ' } }, { custom: { text: 'x', price: 5 } }, { custom: { text: 'א'.repeat(2001) } }]) {
    assert.match((await add({ ...v.row, ...bad })).error || '', /check constraint/, JSON.stringify(bad).slice(0, 40));
  }
  // The old "הצעה אחרת" and a package deal (an agreement, no doc_type) still go in.
  const legacy = validateDeal({ kind: 'custom', business_name: 'x', contact_name: 'y', phone: '050-7654321', description: 'משהו', price: '2500' });
  assert.ok((await add(legacy.row)).rows?.[0]);
  const pkg = validateDeal({ business_name: 'x', contact_name: 'y', phone: '050-7654321', tier: 'social', influencer: 'natali' });
  assert.equal((await add(pkg.row)).rows?.[0]?.doc_type, null);
  // Irit creates the quote and links it: no manager in between, the deal is "sent".
  const quote = await create(FREE);
  const linked = (await call('irit', 'update public.deal_requests set quote_id = $2 where id = $1 returning status', [d.id, quote.id])).rows?.[0];
  assert.equal(linked?.status, 'sent');
});
