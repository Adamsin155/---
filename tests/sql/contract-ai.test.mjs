// supabase/migrations/20261106100000_contract_ai.sql in a real Postgres with every migration
// (tests/sql/pg.mjs): "הכנת חוזה עם AI" (the owner's decisions of 25.10.2026).
//   - the file is the newest, only adds (none of the three words the production tool refuses)
//     and runs twice;
//   - a contract by hand that differs from the package waits for a manager's approval as before,
//     also when the caller claims an AI preparation it does not have (no run, someone else's run,
//     a failed run, a run older than 24 hours);
//   - a contract prepared with AI goes to the client at once, even with a discount above 200 ₪
//     and other changes: the link works, it signs, the client opens with what it grants, and
//     what it changed stays stored for the owners; a run prepares one contract only;
//   - who prepared a quote is fixed at its creation; a corrected version keeps the approval;
//   - the runs: the owners and Irit read them all, everyone else of the office only their own,
//     an editor and anyone signed out none; nobody writes them but the server.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { emptySelection, buildQuoteModel, validateSelection, exceptionOf, normalizeSelection } from '../../app/pricing.js';
import { packageDeliverables } from '../../app/protocol-logic.js';

const FILE = '20261106100000_contract_ai.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', nadia: 'nadia' };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const CLIENT = { name: 'דנה לוי', company: 'קפה דנה', phone: '050-1234567' };
let db;
const users = {};

// The deal of the owner's example: "חבילה נטלי 3500, 20 סרטונים במקום 25, בלי Highlights,
// 12 חודשים, 2 ימי צילום", and a discount of 500 ₪ (above the 200 ₪ a seller may give).
const AI_SEL = normalizeSelection({
  ...emptySelection(), docType: 'agreement', tier: 'social', influencer: 'natali', discount: 0,
  custom: { qty: { videos: 20, shootDays: 2 }, price: 350000, discount: 50000, terms: 'ללא Highlights' },
});
const REGULAR = { ...emptySelection(), docType: 'agreement', tier: 'social', influencer: 'natali' };

// As the create-quote function stores a quote (the server's role), by `who`.
async function create(selection, who = 'irit', extra = {}) {
  validateSelection(selection);
  const model = buildQuoteModel(selection, CLIENT);
  const exc = exceptionOf(selection);
  const cols = {
    model: JSON.stringify(model), client_name: CLIENT.name, monthly_gross_agorot: model.totals.monthlyGross, term_gross_agorot: model.totals.termGross,
    created_by: users[who].id, created_by_email: users[who].email, ...(exc.length ? { exceptions: JSON.stringify(exc) } : {}), ...extra,
  };
  const keys = Object.keys(cols);
  const { rows } = await db.query(`insert into public.quotes (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(cols));
  return rows[0];
}
// A preparation, as the contract-ai function keeps it.
async function run(who = 'irit', { status = 'ok', ago = 0 } = {}) {
  const { rows } = await db.query(
    `insert into public.contract_ai_runs (user_id, by_email, status, deal_text, result, left_out, model, created_at)
     values ($1, $2, $3, $4, $5, '[]', 'claude-sonnet-5-5', now() - make_interval(mins => $6)) returning id`,
    [users[who].id, users[who].email, status, 'חבילה נטלי 3500, 20 סרטונים במקום 25', JSON.stringify({ package: 'social-natali' }), ago]);
  return rows[0].id;
}
const ai = (runId) => ({ prepared_by: 'ai', ai_run_id: runId });
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

// The database as this file left it: since 20261118100000_no_manager_approval.sql nothing waits for a
// manager (tests/sql/no-approval.test.mjs tests that); here, the rules of 25.10.2026 as they were.
before(async () => {
  db = await freshDatabase({ upTo: '20261118100000_no_manager_approval.sql' });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
});

test('the file: newest but two (only the shoot crew and the old characterizations after it), only adds, and runs twice', async () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261107100000_shoot_crew.sql', '20261109100000_legacy_characterizations.sql', '20261110100000_batch_2710.sql', '20261111100000_p06_ofir.sql', '20261112100000_new_influencers.sql', '20261112200000_legacy_contracts_full.sql', '20261113100000_client_details_month.sql', '20261114100000_ofir_deals.sql', '20261117100000_speed_pages.sql', '20261118100000_no_manager_approval.sql', '20261119100000_work_history.sql', '20261120100000_drive_daily.sql', '20261121100000_mcp.sql']);
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  // The trigger still runs as its owner (20261028100000_quotes_insert_fix.sql).
  const { rows } = await db.query("select prosecdef from pg_proc where proname = 'quotes_set_hash'");
  assert.deepEqual(rows, [{ prosecdef: true }]);
});

test('by hand: a contract that differs from the package waits for a manager, as before', async () => {
  const r = await create(AI_SEL);
  assert.deepEqual([r.approval, r.prepared_by, r.ai_run_id, r.expires_at], ['pending', null, null, null]);
  assert.equal(r.exceptions.length, exceptionOf(AI_SEL).length);
  assert.equal((await q('anon', 'select public.get_quote($1) as g', [r.token])).rows[0].g, null);
  // A regular contract by hand: no approval, as always.
  const plain = await create(REGULAR);
  assert.deepEqual([plain.approval, plain.prepared_by, plain.exceptions], ['none', null, null]);
});

test('a claimed AI preparation the caller does not have is a contract by hand', async () => {
  const cases = {
    'no run': { prepared_by: 'ai' },
    'a run that does not exist': null,
    "someone else's run": ai(await run('lior')),
    'a failed run': ai(await run('irit', { status: 'error' })),
    'a run older than 24 hours': ai(await run('irit', { ago: 24 * 60 + 5 })),
    'a run without the flag': { ai_run_id: await run('irit') },
  };
  for (const [label, extra] of Object.entries(cases)) {
    if (extra === null) {
      // An id no run has: the foreign key refuses it outright... unless the trigger cleared it first.
      const r = await create(AI_SEL, 'irit', ai('00000000-0000-4000-8000-000000000000'));
      assert.deepEqual([r.approval, r.prepared_by, r.ai_run_id], ['pending', null, null], label);
      continue;
    }
    const r = await create(AI_SEL, 'irit', extra);
    assert.deepEqual([r.approval, r.prepared_by, r.ai_run_id], ['pending', null, null], label);
  }
});

let aiQuote;
test('prepared with AI: no approval even with a discount above 200 ₪; the link works, it signs, the client opens with it', async () => {
  const runId = await run('irit');
  const r = await create(AI_SEL, 'irit', { ...ai(runId), approval: 'pending' });
  aiQuote = r;
  assert.deepEqual([r.approval, r.prepared_by, r.ai_run_id, r.submitted_at], ['none', 'ai', runId, null]);
  // What it changed stays stored, for the owners.
  assert.deepEqual(r.exceptions.map((e) => e.kind), exceptionOf(AI_SEL).map((e) => e.kind));
  assert.ok(exceptionOf(AI_SEL).some((e) => e.kind === 'discount'), 'the example carries a discount above 200 ₪');
  // The signing window starts now, as for a regular contract.
  assert.ok(Math.abs(new Date(r.expires_at) - new Date(r.created_at) - 72 * 3600e3) < 1000);
  assert.equal(new Date(r.model.validUntil).getTime(), r.expires_at.getTime());
  assert.equal((await db.query("select doc_hash = encode(extensions.digest(model::text, 'sha256'), 'hex') as ok from public.quotes where id = $1", [r.id])).rows[0].ok, true);
  // No history of an approval: it never went to one.
  assert.deepEqual((await db.query('select event from public.quote_versions where quote_id = $1', [r.id])).rows, []);
  const seen = (await q('anon', 'select public.get_quote($1) as g', [r.token])).rows[0].g;
  assert.equal(seen.number, r.number);
  assert.equal(seen.model.selection.custom.price, 350000);
  const signed = (await call('anon', 'select public.sign_quote($1, $2, $3, true) as g', [r.token, 'דנה לוי', PNG])).rows[0].g;
  assert.equal(signed.status, 'signed');
  const c = (await db.query('select deliverables from public.clients where quote_id = $1', [r.id])).rows[0];
  assert.deepEqual(c.deliverables, packageDeliverables(r.model));
  assert.equal(c.deliverables.videos, 20);
  // Not on the managers' list: Ofir and Lior read a contract only while it waits for them.
  // (Ofir reads every quote since 20261114100000_ofir_deals.sql; Lior still only what waits for approval.)
  for (const who of ['lior']) assert.deepEqual((await q(who, 'select id from public.quotes where id = $1', [r.id])).rows, [], who);
  for (const who of ['owner', 'irit']) assert.equal((await q(who, 'select prepared_by from public.quotes where id = $1', [r.id])).rows[0].prepared_by, 'ai', who);
});

test('a run prepares one contract only; a regular contract prepared with AI is marked too', async () => {
  await assert.rejects(create(AI_SEL, 'irit', ai(aiQuote.ai_run_id)), /quotes_ai_run_once|duplicate key/);
  const r = await create(REGULAR, 'irit', ai(await run('irit')));
  assert.deepEqual([r.approval, r.prepared_by, r.exceptions], ['none', 'ai', null]);
});

test('who prepared a quote is fixed at its creation; a corrected version keeps the approval', async () => {
  const hand = await create(AI_SEL);
  await assert.rejects(db.query("update public.quotes set prepared_by = 'ai' where id = $1", [hand.id]), /fixed at its creation/);
  const runId = await run('irit');
  await assert.rejects(db.query('update public.quotes set ai_run_id = $2 where id = $1', [hand.id, runId]), /fixed at its creation/);
  for (const who of ['irit', 'owner']) assert.match((await call(who, "update public.quotes set prepared_by = 'ai' where id = $1", [hand.id])).error, /permission denied/, who);
  // A contract that went for approval, corrected: still for the managers.
  const model = buildQuoteModel(AI_SEL, CLIENT);
  const rev = (await call('service', 'select public.quote_revise($1, $2, $3, $4, $5, $6, $7) as r',
    [hand.id, JSON.stringify(model), CLIENT.name, model.totals.monthlyGross, model.totals.termGross, JSON.stringify(exceptionOf(AI_SEL)), users.irit.email])).rows[0].r;
  assert.equal(rev.approval, 'pending');
  const row = (await db.query('select prepared_by, approval from public.quotes where id = $1', [hand.id])).rows[0];
  assert.deepEqual(row, { prepared_by: null, approval: 'pending' });
});

test('the runs: the owners and Irit read all, the rest of the office their own, nobody writes but the server', async () => {
  const mine = await run('lior');
  const all = (await db.query('select count(*)::int as n from public.contract_ai_runs')).rows[0].n;
  for (const who of ['owner', 'irit']) assert.equal((await q(who, 'select id from public.contract_ai_runs')).rows.length, all, who);
  const lior = (await q('lior', 'select id, user_id from public.contract_ai_runs')).rows;
  assert.ok(lior.length >= 1 && lior.every((x) => x.user_id === users.lior.id) && lior.some((x) => x.id === mine));
  assert.deepEqual((await q('ofir', 'select id from public.contract_ai_runs')).rows, []);
  assert.deepEqual((await q('nadia', 'select id from public.contract_ai_runs')).rows, []);
  assert.match((await q('anon', 'select id from public.contract_ai_runs')).error, /permission denied/);
  for (const who of ['irit', 'owner']) {
    assert.match((await call(who, "insert into public.contract_ai_runs (user_id, status, deal_text) values ($1, 'ok', 'x')", [users[who].id])).error, /permission denied/, who);
    assert.match((await call(who, "update public.contract_ai_runs set status = 'ok' where id = $1", [mine])).error, /permission denied/, who);
  }
  const s = await call('service', "insert into public.contract_ai_runs (user_id, status, deal_text) values ($1, 'ok', 'x') returning id", [users.irit.id]);
  assert.ok(s.rows?.[0]?.id, JSON.stringify(s));
  // The words are bounded and the status is one of two.
  await assert.rejects(db.query("insert into public.contract_ai_runs (user_id, status, deal_text) values ($1, 'ok', '')", [users.irit.id]), /contract_ai_runs_text_check/);
  await assert.rejects(db.query("insert into public.contract_ai_runs (user_id, status, deal_text) values ($1, 'ok', $2)", [users.irit.id, 'א'.repeat(2001)]), /contract_ai_runs_text_check/);
  await assert.rejects(db.query("insert into public.contract_ai_runs (user_id, status, deal_text) values ($1, 'maybe', 'x')", [users.irit.id]), /contract_ai_runs_status_check/);
});
