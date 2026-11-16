// Gal, the office's bookkeeper (supabase/migrations/20261215100000_bookkeeper_gal.sql and
// supabase/pending/bookkeeper_gal_checks.sql, the second waiting for the owner's approval; the
// owner's request of 16.11.2026; docs/ops.md, section 137), on every migration in a real Postgres
// (PGlite). Invented names, numbers and addresses only.
//   - the migration has none of the words the migration tool refuses and runs twice; the pending
//     file only widens staff_person_check, keeping everyone allowed before;
//   - before the pending file her row cannot be stored; after it, it can;
//   - her screen, public.bookkeeper_clients(): the active and ending clients only (not archived,
//     not ended or cancelled), the invoice fields only, and the amount with VAT from the contract
//     (builder, uploaded, old system) or the payments row; nothing guessed;
//   - she and the owners may call it; the office, an editor, Eli, the sales, Tal and anon may not;
//   - she reads nothing else: no table of the clients, no other staff row, no old characterization,
//     and every function anyone signed in may call answers her with nothing.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { VAT_RATE_PERCENT } from '../../app/catalog.js';

const FILE = '20261215100000_bookkeeper_gal.sql';
const PENDING = new URL('../../supabase/pending/bookkeeper_gal_checks.sql', import.meta.url);
const TAL = new URL('../../supabase/pending/makeup_tal_checks.sql', import.meta.url);
const PEOPLE = { owner: null, gal: 'gal', irit: 'irit', lior: 'lior', ofir: 'ofir', nadia: 'nadia', eli: 'eli', stav: 'stav', tal: 'tal' };
let db;
const users = {};
const ids = {};

const run = (who, sql, params = []) => as(db, who ? users[who] : null, async (tx) => (await tx.query(sql, params)).rows);
const screen = async (who) => run(who, 'select * from public.bookkeeper_clients()');

before(async () => {
  db = await freshDatabase();
  await db.exec(readFileSync(TAL, 'utf8'));
  // Before the pending file her row cannot be stored.
  await db.query("insert into auth.users (email, email_confirmed_at) values ('gal-early@astrateg.test', now())");
  await assert.rejects(db.query("insert into public.staff (email, person) values ('gal-early@astrateg.test', 'gal')"), /staff_person_check/);
  await db.exec(readFileSync(PENDING, 'utf8'));
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, key === 'owner']);
  }
  const add = async (key, o) => {
    const { rows } = await db.query(
      `insert into public.clients (name, business, company_id, phone, contact_email, status, address, notes, archived_at)
       values ($1, $2, $3, $4, $5, $6, 'רחוב הדוגמה 1', 'הערה פנימית', null) returning id`,
      [o.name, o.business ?? null, o.hp ?? null, o.phone ?? null, o.email ?? null, o.status ?? 'active']);
    ids[key] = rows[0].id;
    // Archived as archive_client() does it (the guard keeps archived_at otherwise).
    if (o.archived) await db.exec(`begin; set local astrateg.archiving = 'on'; update public.clients set archived_at = now() where id = '${ids[key]}'; commit;`);
  };
  // The builder's signed contract: 5,900 a month with VAT, 70,800 for twelve months.
  await add('quote', { name: 'דנה כהן', business: 'אלף יוגה', hp: '512345678', phone: '050-1111111', email: 'alef@example.test' });
  const q = await db.query("insert into public.quotes (client_name, model, monthly_gross_agorot, term_gross_agorot, status) values ('אלף יוגה', '{\"termMonths\": 12}'::jsonb, 590000, 7080000, 'signed') returning id");
  await db.query('update public.clients set quote_id = $1 where id = $2', [q.rows[0].id, ids.quote]);
  // Uploaded by hand: 4,000 before VAT, six months; and one without the months.
  await add('manual', { name: 'רון לוי', business: 'בית הקפה של רון', status: 'ending' });
  await add('manualNoTerm', { name: 'מאיה', business: 'גן מאיה' });
  for (const [key, net, months] of [['manual', 400000, 6], ['manualNoTerm', 300000, null]]) {
    const f = await db.query("insert into public.client_files (client_id, kind, storage_path) values ($1::uuid, 'material_other', $1::text || '/material_other/' || gen_random_uuid() || '-contract.pdf') returning id", [ids[key]]);
    await db.query('insert into public.manual_contracts (client_id, file_id, monthly_net_agorot, term_months, signed_on) values ($1, $2, $3, $4, current_date)', [ids[key], f.rows[0].id, net, months]);
  }
  // The old system: 4,500 before VAT, its own total 63,720 with VAT (12 months); an older contract of the same client is not read.
  await add('legacy', { name: 'יוסי', business: 'מוסך יוסי', hp: '036666666' });
  await db.query("insert into public.legacy_contracts (id, client_id, doc_type, signed_at, total_amount, retainer, doc) values (91, $1, 'contract', '2026-08-01', 63720, 4500, '{\"months\": 12}'), (90, $1, 'contract', '2025-08-01', 30000, 2000, '{\"months\": 12}')", [ids.legacy]);
  // "תשלומי לקוחות": a consistent deal (3,000 + VAT × 12 = 42,480) and one whose amount is not (36,000).
  await add('pay', { name: 'שירן', business: 'שירן עיצובים' });
  await add('payOdd', { name: 'עומר', business: 'עומר הובלות' });
  await db.query("insert into public.client_payments (client_id, amount, retainer, deal_date) values ($1, 42480, 3000, '2026-09-01'), ($2, 36000, 3000, '2026-09-01')", [ids.pay, ids.payOdd]);
  // No amount anywhere.
  await add('none', { name: 'נועה', business: null });
  // Not active: archived, ended, cancelled.
  await add('archived', { name: 'ארכיון', business: 'בארכיון', archived: true });
  await add('ended', { name: 'הסתיים', business: 'הסתיים בע״מ', status: 'ended' });
  await add('cancelled', { name: 'בוטל', business: 'בוטל בע״מ', status: 'cancelled' });
});

test('the files: no word the migration tool refuses; the pending file only widens staff_person_check; both run twice', async () => {
  const sql = migrationSql(FILE);
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  const pending = readFileSync(PENDING, 'utf8');
  assert.match(pending, /^-- WAITING FOR THE OWNER'S APPROVAL/);
  const code = pending.replace(/--[^\n]*/g, '');
  assert.deepEqual([...code.matchAll(/drop constraint if exists ([a-z_]+);/g)].map((m) => m[1]), ['staff_person_check']);
  assert.deepEqual([...code.matchAll(/add constraint ([a-z_]+)/g)].map((m) => m[1]), ['staff_person_check']);
  assert.equal((code.match(/\b(delete|truncate|drop table|drop function)\b/gi) || []).length, 0);
  // Everyone the latest check allowed is still allowed.
  const list = (s) => /add constraint staff_person_check\s+check \(person in \(([^)]*)\)\)/.exec(s)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  const amit = readFileSync(new URL('../../supabase/migrations/20261214100100_amit_checks.sql', import.meta.url), 'utf8');
  assert.deepEqual(list(pending).filter((p) => p !== 'gal').sort(), list(amit).sort());
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(pending);
  await db.exec(pending);
  // VAT in the function is the price list's.
  assert.equal(VAT_RATE_PERCENT, 18);
  assert.match(sql, /\* 1\.18\)/);
  assert.match(sql, /\* 118\)/);
});

test('her screen: the active and ending clients only, the invoice fields only, the amounts with VAT', async () => {
  const rows = await screen('gal');
  assert.equal(rows.error, undefined, rows.error);
  const by = Object.fromEntries(rows.map((r) => [r.contact_name, r]));
  assert.deepEqual(Object.keys(rows[0]).sort(), ['business', 'company_id', 'contact_name', 'email', 'monthly_agorot', 'months', 'phone', 'source', 'status', 'total_agorot', 'why']);
  assert.deepEqual(rows.map((r) => r.contact_name).sort(), ['דנה כהן', 'רון לוי', 'מאיה', 'יוסי', 'שירן', 'עומר', 'נועה'].sort());
  for (const gone of ['ארכיון', 'הסתיים', 'בוטל']) assert.equal(by[gone], undefined, gone);
  const pick = (r) => [r.monthly_agorot === null ? null : Number(r.monthly_agorot), r.total_agorot === null ? null : Number(r.total_agorot), r.months, r.source, r.why];
  assert.deepEqual(by['דנה כהן'], { ...by['דנה כהן'], business: 'אלף יוגה', company_id: '512345678', phone: '050-1111111', email: 'alef@example.test', status: 'active' });
  assert.deepEqual(pick(by['דנה כהן']), [590000, 7080000, 12, 'quote', null]);
  assert.equal(by['רון לוי'].status, 'ending');
  assert.deepEqual(pick(by['רון לוי']), [472000, 2832000, 6, 'manual', null]); // 4,000 + 18% = 4,720; × 6
  assert.deepEqual(pick(by['מאיה']), [354000, null, null, 'manual', 'no_term']);
  assert.deepEqual(pick(by['יוסי']), [531000, 6372000, 12, 'legacy', null]); // 4,500 + 18% = 5,310; the contract's own total
  assert.deepEqual(pick(by['שירן']), [354000, 4248000, 12, 'payments', null]);
  assert.deepEqual(pick(by['עומר']), [354000, null, null, 'payments', 'unclear']);
  assert.deepEqual(pick(by['נועה']), [null, null, null, null, 'none']);
  assert.equal(by['נועה'].business, null);
  // Nothing of the work: no id, address or note.
  const text = JSON.stringify(rows);
  assert.ok(!text.includes(ids.quote) && !/רחוב הדוגמה|הערה פנימית/.test(text));
});

test('who may call it: her and the owners; not the office, an editor, Eli, the sales, Tal or anyone signed out', async () => {
  assert.equal((await screen('owner')).length, 7);
  for (const who of ['irit', 'lior', 'ofir', 'nadia', 'eli', 'stav', 'tal']) assert.match((await screen(who)).error || '', /not allowed/, who);
  assert.match((await run(null, 'select * from public.bookkeeper_clients()')).error || '', /permission denied/);
  assert.match((await run('gal', "select * from private.bookkeeper_amounts(gen_random_uuid(), null)")).error || '', /permission denied/);
});

test('she reads nothing else: no client table, no other staff row, no old characterization', async () => {
  await db.query("insert into public.legacy_characterizations (client_id) values ($1)", [ids.legacy]).catch(() => {});
  for (const t of ['clients', 'protocol_checks', 'client_tasks', 'client_access', 'client_files', 'client_gantt', 'quotes', 'manual_contracts',
    'legacy_contracts', 'client_payments', 'characterizations', 'legacy_characterizations', 'deal_requests', 'staff_tasks', 'staff_notes',
    'client_messages', 'client_questions', 'makeup_answers', 'payout_deals', 'reminder_log', 'task_decisions', 'content_briefs']) {
    const r = await run('gal', `select count(*)::int as n from public.${t}`);
    assert.ok(r.error || r[0].n === 0, `${t}: ${JSON.stringify(r)}`);
  }
  // Someone who is not her still reads the old characterizations as before.
  assert.ok((await run('nadia', 'select count(*)::int as n from public.legacy_characterizations'))[0].n >= 1);
  // The team list: only her own row; everyone else reads it whole.
  assert.deepEqual(await run('gal', 'select email, person from public.staff'), [{ email: 'gal@astrateg.test', person: 'gal' }]);
  const all = (await db.query('select count(*)::int as n from public.staff')).rows[0].n;
  for (const who of ['lior', 'nadia', 'tal']) {
    const n = (await run(who, 'select count(*)::int as n from public.staff'))[0].n;
    assert.equal(n, who === 'tal' ? 1 : all, who);
  }
  assert.deepEqual((await run('gal', 'select public.is_staff() as s, public.is_office() as o, public.my_person() as p'))[0], { s: true, o: false, p: 'gal' });
  assert.equal((await run('gal', 'select public.can_see_client($1) as ok', [ids.quote]))[0].ok, false);
});

test('every function anyone signed in may call answers her with nothing', async () => {
  const { rows } = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.pronargs = 0 and has_function_privilege('authenticated', p.oid, 'execute')
      and p.prorettype <> 'trigger'::regtype order by 1`);
  // About herself only (who she is, her own devices, consent and calendar link), or a fixed list of names.
  const HERS = new Set(['bookkeeper_clients', 'is_staff', 'my_person', 'reminder_person', 'photographer_people', 'whatsapp_my_consent', 'whatsapp_settings',
    'calendar_feed_status', 'calendar_feed_rotate', 'calendar_feed_revoke', 'google_calendar_status', 'google_calendar_disconnect', 'vault_lock', 'vault_code_status', 'mcp_request_gate']);
  const empty = (v) => v === null || v === false || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v && Object.values(v).every(empty));
  const open = [];
  for (const { proname } of rows) {
    if (HERS.has(proname)) continue;
    const r = await run('gal', `select * from public.${proname}()`);
    if (r.error) continue;
    if (r.every((row) => Object.values(row).every(empty))) continue;
    open.push(`${proname}: ${JSON.stringify(r).slice(0, 160)}`);
  }
  assert.deepEqual(open, []);
});
