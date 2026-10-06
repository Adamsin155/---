// Custom (exceptional) contracts in the database
// (supabase/migrations/20261010100000_custom_contracts.sql), on every migration in a
// real Postgres (PGlite): the approval states, who may approve or reject, the
// self-approval rule, the client's link while it waits or was refused, the signing
// window from the approval, versions and history, what the signed contract grants
// (the database and the app agree), Stav's "הצעה אחרת" and its statuses, and the
// migration running twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { emptySelection, buildQuoteModel, validateSelection, exceptionOf } from '../../app/pricing.js';
import { packageDeliverables } from '../../app/protocol-logic.js';
import { validateDeal } from '../../app/deal-logic.js';
import { PACKAGES } from '../../app/catalog.js';

const MIGRATION = '20261010100000_custom_contracts.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', stav: 'stav', amos: 'amos' };
const DENIED = /not allowed|permission denied|row-level security/;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const CLIENT = { name: 'דנה לוי', company: 'קפה דנה', phone: '050-1234567' };
let db;
const users = {};
const ids = {};

const sel = (custom, extra = {}) => ({ ...emptySelection(), docType: 'agreement', tier: 'social', influencer: 'simeon', ...extra, ...(custom ? { custom } : {}) });
const CUSTOM = { qty: { videos: 30, collabs: 0 }, discount: 35000, termMonths: 6, lines: [{ label: 'אתר תדמית', qty: 1, monthly: 50000 }, { label: 'ניהול קהילה' }], terms: 'הלקוח רשאי לסיים אחרי 3 חודשים.' };

// As the create-quote function stores a quote (service role), by `who`.
async function create(selection, who = 'irit', extra = {}) {
  validateSelection(selection);
  const model = buildQuoteModel(selection, CLIENT);
  const cols = { model: JSON.stringify(model), client_name: CLIENT.name, monthly_gross_agorot: model.totals.monthlyGross, term_gross_agorot: model.totals.termGross,
    created_by: users[who].id, created_by_email: users[who].email, exceptions: JSON.stringify(exceptionOf(selection)), ...extra };
  const keys = Object.keys(cols);
  const { rows } = await db.query(`insert into public.quotes (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(cols));
  return rows[0];
}
const row = async (id) => (await db.query('select * from public.quotes where id = $1', [id])).rows[0];
// A call that stays (committed), as a signed-in user, anon (null) or the service role.
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
const revise = (id, selection, who = 'irit') => {
  const model = buildQuoteModel(selection, CLIENT);
  return call('service', 'select public.quote_revise($1, $2, $3, $4, $5, $6, $7) as r',
    [id, JSON.stringify(model), CLIENT.name, model.totals.monthlyGross, model.totals.termGross, JSON.stringify(exceptionOf(selection)), users[who].email]);
};
const history = async (id) => (await db.query('select version, event, by_email, by_person, note, approval from public.quote_versions where quote_id = $1 order by id', [id])).rows;

before(async () => {
  // The database as it is live before this migration, with a regular quote out.
  db = await freshDatabase({ upTo: MIGRATION });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  const m = buildQuoteModel(sel(null, { discount: 20000 }), CLIENT);
  const old = await db.query("insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot, created_by_email) values ($1, 'ישן', $2, $3, 'irit@astrateg.test') returning id, token, doc_hash, expires_at",
    [JSON.stringify(m), m.totals.monthlyGross, m.totals.termGross]);
  ids.old = old.rows[0];
  // The migration, twice (safe to run again).
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
});

test('regular quotes are untouched: no approval, the same deadline and hash, the link works and signs', async () => {
  const old = await row(ids.old.id);
  assert.deepEqual([old.approval, old.version, old.doc_hash, old.expires_at.toISOString()], ['none', 1, ids.old.doc_hash, ids.old.expires_at.toISOString()]);
  // A new regular quote, even when the caller claims an approval state.
  const r = await create(sel(null, { discount: 20000 }), 'irit', { approval: 'pending', approval_note: 'x', version: 7 });
  assert.deepEqual([r.approval, r.approval_note, r.version, r.exceptions, r.submitted_at], ['none', null, 1, null, null]);
  assert.ok(Math.abs(new Date(r.expires_at) - new Date(r.created_at) - 72 * 3600e3) < 1000);
  // The same instant: Postgres drops trailing zeros of the fraction ("…18.52+00:00"), JS always writes three digits.
  assert.equal(new Date(r.model.validUntil).getTime(), r.expires_at.getTime());
  assert.deepEqual(await history(r.id), []);
  const seen = (await q('anon', 'select public.get_quote($1) as g', [r.token])).rows[0].g;
  assert.equal(seen.number, r.number);
  const signed = (await call('anon', 'select public.sign_quote($1, $2, $3, true) as g', [r.token, 'דנה לוי', PNG])).rows[0].g;
  assert.equal(signed.status, 'signed');
  const c = (await db.query('select deliverables from public.clients where quote_id = $1', [r.id])).rows[0];
  assert.deepEqual(c.deliverables, packageDeliverables(r.model));
});

test('an exceptional quote is pending whatever the caller says, with no deadline and a first history row', async () => {
  const r = await create(sel(CUSTOM), 'irit', { approval: 'approved', approval_by: 'owner', expires_at: new Date(Date.now() + 9e8).toISOString() });
  ids.a = r.id;
  ids.aToken = r.token;
  assert.deepEqual([r.approval, r.approval_by, r.expires_at, r.version, r.submitted_by_email], ['pending', null, null, 1, 'irit@astrateg.test']);
  assert.ok(!('validUntil' in r.model));
  assert.ok(r.submitted_at);
  assert.equal(r.exceptions.length, exceptionOf(sel(CUSTOM)).length);
  assert.equal((await db.query("select doc_hash = encode(extensions.digest(model::text, 'sha256'), 'hex') as ok from public.quotes where id = $1", [r.id])).rows[0].ok, true);
  assert.deepEqual(await history(r.id), [{ version: 1, event: 'submitted', by_email: 'irit@astrateg.test', by_person: null, note: null, approval: 'pending' }]);
});

test('while it waits, the client cannot read it or sign it: to anon it does not exist', async () => {
  for (const who of ['anon', 'irit', 'owner', 'stav']) assert.equal((await q(who, 'select public.get_quote($1) as g', [ids.aToken])).rows[0].g, null, who);
  assert.match((await call('anon', 'select public.sign_quote($1, $2, $3, true)', [ids.aToken, 'דנה לוי', PNG])).error, /quote not found/);
  // Nor by going around the function.
  await assert.rejects(db.query("update public.quotes set status = 'signed', signed_at = now() where id = $1", [ids.a]), /awaits a manager/);
  assert.equal((await row(ids.a)).status, 'sent');
  assert.equal((await db.query('select count(*)::int as n from public.clients where quote_id = $1', [ids.a])).rows[0].n, 0);
});

test('only the owner, Ofir and Lior decide; nothing moves the approval except the functions', async () => {
  for (const who of ['irit', 'ilai', 'nadia', 'stav', 'amos']) {
    assert.match((await call(who, 'select public.quote_approve($1)', [ids.a])).error, DENIED, who);
    assert.match((await call(who, 'select public.quote_reject($1, $2)', [ids.a, 'לא'])).error, DENIED, who);
    assert.equal((await q(who, 'select public.can_approve_quotes() as c')).rows[0].c, false, who);
  }
  for (const who of ['owner', 'ofir', 'lior']) assert.equal((await q(who, 'select public.can_approve_quotes() as c')).rows[0].c, true, who);
  assert.match((await call('anon', 'select public.quote_approve($1)', [ids.a])).error, /permission denied/);
  assert.match((await call('anon', 'select public.quote_reject($1, $2)', [ids.a, 'x'])).error, /permission denied/);
  // The table itself: no writing for anyone signed in, and not even the database owner by mistake.
  for (const who of ['irit', 'lior', 'owner']) assert.match((await call(who, "update public.quotes set approval = 'approved' where id = $1", [ids.a])).error, /permission denied/, who);
  await assert.rejects(db.query("update public.quotes set approval = 'approved' where id = $1", [ids.a]), /only through its functions/);
  await assert.rejects(db.query("update public.quotes set expires_at = now() + interval '1 day' where id = $1", [ids.a]), /immutable/);
  await assert.rejects(db.query("update public.quotes set model = model || '{\"x\": 1}' where id = $1", [ids.a]), /immutable/);
  // quote_revise is the edge function's (service role) only.
  for (const who of ['irit', 'owner', 'anon']) {
    assert.match((await call(who, 'select public.quote_revise($1, $2, $3, 1, 1, $4, $5)', [ids.a, '{}', 'x', '[]', 'x'])).error, /permission denied/, who);
  }
  assert.equal((await row(ids.a)).approval, 'pending');
});

test('a rejection needs a note; it goes back with the note, and the link stays dead', async () => {
  for (const note of ['', '   ', null, 'א'.repeat(1001)]) assert.match((await call('lior', 'select public.quote_reject($1, $2)', [ids.a, note])).error, /note is required/);
  const r = (await call('lior', 'select public.quote_reject($1, $2) as r', [ids.a, '  ההנחה גבוהה מדי, עד 300 ₪.  '])).rows[0].r;
  assert.deepEqual([r.approval, 'token' in r], ['rejected', false]);
  const a = await row(ids.a);
  assert.deepEqual([a.approval, a.approval_by, a.approval_by_email, a.approval_note, a.expires_at], ['rejected', 'lior', 'lior@astrateg.test', 'ההנחה גבוהה מדי, עד 300 ₪.', null]);
  assert.ok(a.approval_at);
  assert.equal((await q('anon', 'select public.get_quote($1) as g', [ids.aToken])).rows[0].g, null);
  assert.match((await call('anon', 'select public.sign_quote($1, $2, $3, true)', [ids.aToken, 'דנה לוי', PNG])).error, /quote not found/);
  // Decided: a second decision has nothing to decide.
  assert.match((await call('ofir', 'select public.quote_approve($1)', [ids.a])).error, /not waiting for approval/);
  assert.match((await call('owner', 'select public.quote_reject($1, $2)', [ids.a, 'שוב'])).error, /not waiting for approval/);
});

test('Irit fixes and resubmits: a new version of the same quote, pending again, the history kept', async () => {
  const before = await row(ids.a);
  const fixed = sel({ ...CUSTOM, discount: 30000 });
  const r = (await revise(ids.a, fixed)).rows[0].r;
  assert.deepEqual([r.approval, r.version, r.token, r.number], ['pending', 2, null, before.number]);
  const a = await row(ids.a);
  assert.deepEqual([a.approval, a.version, a.approval_note, a.approval_by, a.token, a.number, a.expires_at], ['pending', 2, null, null, before.token, before.number, null]);
  assert.equal(a.model.totals.discount, 30000);
  assert.equal(a.model.number, before.number);
  assert.equal(a.model.createdAt, before.model.createdAt);
  assert.notEqual(a.doc_hash, before.doc_hash);
  assert.ok(a.exceptions.some((e) => /הנחה חודשית 300 ₪/.test(e.text)));
  assert.equal(a.monthly_gross_agorot, a.model.totals.monthlyGross);
  assert.deepEqual((await history(ids.a)).map((h) => [h.version, h.event, h.by_person, h.note, h.approval]), [
    [1, 'submitted', null, null, 'pending'],
    [1, 'rejected', 'lior', 'ההנחה גבוהה מדי, עד 300 ₪.', 'rejected'],
    [2, 'revised', null, null, 'pending'],
  ]);
  // Each row keeps the document of its version.
  const kept = (await db.query("select model -> 'totals' ->> 'discount' as d from public.quote_versions where quote_id = $1 order by id", [ids.a])).rows.map((x) => x.d);
  assert.deepEqual(kept, ['35000', '35000', '30000']);
});

test('one approval is enough; the 72 hours start at the approval; the client signs and opens with the custom quantities', async () => {
  // Prepared five days ago: a window counted from the creation would be long over.
  await db.query("select set_config('astrateg.quote_flow', 'on', false)");
  await db.query("update public.quotes set submitted_at = now() - interval '5 days' where id = $1", [ids.a]);
  await db.query("select set_config('astrateg.quote_flow', '', false)");
  const before = await row(ids.a);
  const r = (await call('ofir', 'select public.quote_approve($1) as r', [ids.a])).rows[0].r;
  assert.deepEqual([r.approval, r.token], ['approved', ids.aToken]);
  const a = await row(ids.a);
  assert.deepEqual([a.approval, a.approval_by, a.approval_by_email], ['approved', 'ofir', 'ofir@astrateg.test']);
  assert.ok(Math.abs(new Date(a.expires_at) - Date.now() - 72 * 3600e3) < 60e3, 'the window starts at the approval');
  assert.equal(new Date(a.model.validUntil).getTime(), new Date(a.expires_at).getTime());
  assert.notEqual(a.doc_hash, before.doc_hash);
  assert.equal((await db.query("select doc_hash = encode(extensions.digest(model::text, 'sha256'), 'hex') as ok from public.quotes where id = $1", [ids.a])).rows[0].ok, true);
  // Approved once: Lior and the owner have nothing left to press.
  assert.match((await call('lior', 'select public.quote_approve($1)', [ids.a])).error, /not waiting for approval/);
  // Now the link is there, with the frozen document and the consent naming the custom totals.
  const seen = (await q('anon', 'select public.get_quote($1) as g', [ids.aToken])).rows[0].g;
  assert.deepEqual([seen.status, seen.expired, seen.docHash], ['sent', false, a.doc_hash]);
  assert.equal(seen.model.legal.at(-1).title, 'תנאים מיוחדים');
  assert.match(seen.consentText, /בהתחייבות ל־6 חודשים/);
  assert.ok(!('approval' in seen) && !('exceptions' in seen));
  const signed = (await call('anon', 'select public.sign_quote($1, $2, $3, true) as g', [ids.aToken, 'דנה לוי', PNG])).rows[0].g;
  assert.equal(signed.status, 'signed');
  const c = (await db.query('select deliverables, deal_at, contract_end, package_name from public.clients where quote_id = $1', [ids.a])).rows[0];
  assert.deepEqual(c.deliverables, packageDeliverables(a.model));
  assert.deepEqual([c.deliverables.videos, c.deliverables.collabs, c.deliverables.extra], [30, 0, [{ label: 'אתר תדמית', qty: 1 }, { label: 'ניהול קהילה', qty: null }]]);
  // Six months, not twelve.
  const months = (new Date(c.contract_end) - new Date(c.deal_at)) / 864e5;
  assert.ok(months > 175 && months < 190, String(months));
  // Signed: frozen for good, also for the approval functions.
  assert.match((await revise(ids.a, sel(CUSTOM))).error, /quote not found/);
  assert.match((await call('owner', 'select public.quote_reject($1, $2)', [ids.a, 'מאוחר'])).error, /quote not found/);
  assert.equal((await history(ids.a)).at(-1).event, 'approved');
});

test('nobody approves a contract they prepared, except the owner', async () => {
  const byOfir = await create(sel({ termMonths: 3 }), 'ofir');
  assert.match((await call('ofir', 'select public.quote_approve($1)', [byOfir.id])).error, /cannot approve a contract you prepared/);
  assert.equal((await row(byOfir.id)).approval, 'pending');
  assert.ok((await call('lior', 'select public.quote_approve($1)', [byOfir.id])).rows);
  const byLior = await create(sel({ termMonths: 3 }), 'lior');
  assert.match((await call('lior', 'select public.quote_approve($1)', [byLior.id])).error, /cannot approve a contract you prepared/);
  // He may send his own back (it only stops it), and whoever revises it becomes its preparer.
  assert.ok((await call('lior', 'select public.quote_reject($1, $2)', [byLior.id, 'טעות שלי'])).rows);
  await revise(byLior.id, sel({ termMonths: 4 }), 'irit');
  assert.ok((await call('lior', 'select public.quote_approve($1)', [byLior.id])).rows, 'Irit prepared this version');
  // Irit prepared it, Ofir revised it: now it is his, and he cannot approve it.
  const byIrit = await create(sel({ termMonths: 3 }), 'irit');
  await revise(byIrit.id, sel({ termMonths: 5 }), 'ofir');
  assert.match((await call('ofir', 'select public.quote_approve($1)', [byIrit.id])).error, /cannot approve a contract you prepared/);
  // The owner approves his own.
  const byOwner = await create(sel({ price: 300000 }), 'owner');
  const r = (await call('owner', 'select public.quote_approve($1) as r', [byOwner.id])).rows[0].r;
  assert.equal(r.approval, 'approved');
  assert.equal((await row(byOwner.id)).approval_by, 'owner');
});

test('any edit after the approval returns it to pending; an edit that leaves nothing exceptional makes it regular', async () => {
  const x = await create(sel({ qty: { graphics: 50 } }), 'irit');
  await call('owner', 'select public.quote_approve($1)', [x.id]);
  assert.ok((await q('anon', 'select public.get_quote($1) as g', [x.token])).rows[0].g);
  const again = (await revise(x.id, sel({ qty: { graphics: 60 } }))).rows[0].r;
  assert.deepEqual([again.approval, again.version, again.token], ['pending', 2, null]);
  assert.equal((await q('anon', 'select public.get_quote($1) as g', [x.token])).rows[0].g, null);
  assert.deepEqual([(await row(x.id)).expires_at, (await row(x.id)).approval_by], [null, null]);
  // Back to the package as it is: a regular quote, valid from now, the link returned.
  const regular = (await revise(x.id, sel(null))).rows[0].r;
  assert.deepEqual([regular.approval, regular.version, regular.token], ['none', 3, x.token]);
  const r = await row(x.id);
  assert.deepEqual([r.approval, r.exceptions, r.submitted_at], ['none', null, null]);
  assert.ok(Math.abs(new Date(r.expires_at) - Date.now() - 72 * 3600e3) < 60e3);
  assert.ok((await q('anon', 'select public.get_quote($1) as g', [x.token])).rows[0].g);
  // A quote that never went for approval is not revised (a regular quote never changes).
  assert.match((await revise(ids.old.id, sel(CUSTOM))).error, /only a contract that went for approval/);
  // A cancelled one is gone for the approvers too.
  const gone = await create(sel({ termMonths: 2 }), 'irit');
  await call('irit', 'select public.cancel_quote($1)', [gone.id]);
  assert.match((await call('owner', 'select public.quote_approve($1)', [gone.id])).error, /quote not found/);
});

test('the history is the office\'s: sales and editors read nothing, nobody writes', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir']) assert.ok((await q(who, 'select count(*)::int as n from public.quote_versions')).rows[0].n > 5, who);
  for (const who of ['stav', 'amos', 'nadia']) {
    assert.equal((await q(who, 'select count(*)::int as n from public.quote_versions')).rows[0].n, 0, who);
    assert.equal((await q(who, 'select count(*)::int as n from public.quotes')).rows[0].n, 0, who);
  }
  const anon = await q('anon', 'select count(*)::int as n from public.quote_versions');
  assert.match(anon.error, /permission denied/);
  for (const who of ['owner', 'irit']) {
    assert.match((await q(who, 'delete from public.quote_versions')).error, /permission denied/, who);
    assert.match((await q(who, "update public.quote_versions set note = 'x'")).error, /permission denied/, who);
  }
});

test('what a signed contract grants: the database and the app agree, custom or not', async () => {
  const customs = [
    null,
    { qty: { videos: 0, graphics: 300, shootDays: 12, photoDays: 3, collabs: 24, stories: 60, ch14: 12 } },
    { qty: { photoDays: 0 }, termMonths: 36 },
    { termMonths: 1, lines: [{ label: 'אתר', qty: 2 }, { label: 'ליווי', monthly: 10000 }] },
    { price: 100, terms: 'תנאי' },
  ];
  for (const id of Object.keys(PACKAGES)) {
    const { tier, influencer } = PACKAGES[id];
    for (const c of customs) {
      for (const withPhotographer of [false, true]) {
        const custom = c && withPhotographer ? { ...c, qty: { ...c.qty, monthly: 5 } } : c;
        const s = { ...emptySelection(), docType: 'agreement', tier, influencer, paid: withPhotographer ? ['photographer'] : [], free: { ...emptySelection().free, graphics: 3, extraCh14: true }, ...(custom ? { custom } : {}) };
        validateSelection(s);
        const m = buildQuoteModel(s, CLIENT);
        const [{ d }] = (await db.query('select public.package_deliverables($1) as d', [JSON.stringify(m)])).rows;
        assert.deepEqual(d, packageDeliverables(m), `${id} ${JSON.stringify(custom)}`);
      }
    }
  }
  // Without the model's term (a client opened by hand from a quote), the custom term counts.
  const m = buildQuoteModel(sel({ termMonths: 6, qty: { monthly: 10 } }, { paid: ['photographer'] }), CLIENT);
  delete m.termMonths;
  const [{ d }] = (await db.query('select public.package_deliverables($1) as d', [JSON.stringify(m)])).rows;
  assert.equal(d.monthly, 60);
  assert.deepEqual(d, packageDeliverables(m));
});

test('Stav writes another offer: validated by the table, and its status follows the approval', async () => {
  const v = validateDeal({ kind: 'custom', business_name: 'פיצה רון', contact_name: 'רון', phone: '050-7654321', description: '15 סרטונים ו־10 גרפיקות, בלי משפיענים', videos: 15, graphics: 10, shoot_days: '', price: 2500, term_months: 6, notes: 'דחוף' });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const ins = (row) => call('stav', 'insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, custom, notes) values ($1, $2, $3, $4, $5, $6, $7) returning *',
    [row.business_name, row.contact_name, row.phone, row.tier, row.influencer, row.custom === null ? null : JSON.stringify(row.custom), row.notes]);
  const d = (await ins(v.row)).rows[0];
  assert.deepEqual([d.status, d.seller, d.tier, d.influencer, d.discount_agorot], ['pending', 'stav', null, null, 0]);
  assert.deepEqual(d.custom, { description: '15 סרטונים ו־10 גרפיקות, בלי משפיענים', videos: 15, graphics: 10, price_agorot: 250000, term_months: 6 });
  // The table refuses what the form would never send.
  const bad = [
    { description: '' }, { description: 'x', price_agorot: 250000 }, { description: 'x', price_agorot: 250000, term_months: 37 },
    { description: 'x', price_agorot: -100, term_months: 12 }, { description: 'x', price_agorot: 250000.5, term_months: 12 },
    { description: 'x', price_agorot: 250000, term_months: 12, videos: 201 }, { description: 'x', price_agorot: 250000, term_months: 12, videos: 1.5 },
    { description: 'x', price_agorot: 250000, term_months: 12, payout: 1 }, { description: 'א'.repeat(2001), price_agorot: 250000, term_months: 12 },
    'text', [],
  ];
  for (const c of bad) assert.match((await ins({ ...v.row, custom: c })).error, /deal_requests_custom_check/, JSON.stringify(c));
  // Neither a package nor another offer: refused. A built-in deal still works.
  assert.match((await ins({ ...v.row, custom: null })).error, /deal_requests_kind_check/);
  assert.equal((await ins({ ...v.row, custom: null, tier: 'social', influencer: 'natali' })).rows[0].status, 'pending');

  // Irit prepares the contract from it: exceptional, so the deal waits for a manager.
  const quote = await create(sel({ qty: { videos: 15, graphics: 10, shootDays: 0 }, price: 250000, termMonths: 6, terms: d.custom.description }), 'irit');
  const status = async () => (await q('stav', 'select status, sent_at from public.deal_requests where id = $1', [d.id])).rows[0];
  await call('irit', 'update public.deal_requests set quote_id = $1 where id = $2', [quote.id, d.id]);
  assert.deepEqual(await status(), { status: 'approval', sent_at: null });
  await call('lior', 'select public.quote_reject($1, $2)', [quote.id, 'המחיר נמוך מדי']);
  assert.equal((await status()).status, 'rejected');
  await revise(quote.id, sel({ qty: { videos: 15, graphics: 10, shootDays: 0 }, price: 290000, termMonths: 6, terms: d.custom.description }));
  assert.equal((await status()).status, 'approval');
  await call('owner', 'select public.quote_approve($1)', [quote.id]);
  const sent = await status();
  assert.equal(sent.status, 'sent');
  assert.ok(sent.sent_at);
  await call('anon', 'select public.sign_quote($1, $2, $3, true)', [quote.token, 'רון', PNG]);
  assert.equal((await status()).status, 'signed');
  // A regular contract linked to a deal is "sent" at once, as before.
  const d2 = (await ins({ ...v.row, custom: null, tier: 'social', influencer: 'simeon' })).rows[0];
  const regular = await create(sel(null), 'irit');
  await call('irit', 'update public.deal_requests set quote_id = $1 where id = $2', [regular.id, d2.id]);
  assert.equal((await db.query('select status from public.deal_requests where id = $1', [d2.id])).rows[0].status, 'sent');
  // Amos sees none of Stav's deals; Stav sees no quote and no history.
  assert.equal((await q('amos', 'select count(*)::int as n from public.deal_requests')).rows[0].n, 0);
  assert.equal((await q('stav', 'select count(*)::int as n from public.quotes')).rows[0].n, 0);
});

test('the migration runs again over live data and changes nothing', async () => {
  const snap = async () => JSON.stringify((await db.query('select id, approval, version, doc_hash, expires_at, approval_note, status from public.quotes order by created_at, id')).rows)
    + JSON.stringify((await db.query('select id, status, custom from public.deal_requests order by created_at, id')).rows)
    + (await db.query('select count(*)::int as n from public.quote_versions')).rows[0].n;
  const before = await snap();
  await db.exec(migrationSql(MIGRATION));
  assert.equal(await snap(), before);
});
