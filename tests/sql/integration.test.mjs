// Stages 4–6 merged, in a real Postgres with every migration in order (PGlite):
// 20260930170000_client_status → 180000_whatsapp → 190000_year → 200000_calendar_feeds.
//  - client_tasks.source keeps every value any migration or the code uses, and the
//    migrations after the status page's add none of their own.
//  - The status page offers the scripts for approval to a client of any protocol
//    version: "numbered" (version 2) does not hold back a client who started before it.
//  - The clients' surveys are office-read: the owner's and Lior's insights load them.
//  - Client consent (the signing page) and staff consent (WhatsApp) stay apart.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationFiles } from './pg.mjs';
import { SURVEY_REPORT_COLS } from '../../app/surveys.js';

const SOURCES = ['client_fix', 'escalation', 'followup', 'p31', 'p33', 'pause', 'request', 'status', 'survey', 'tell'];
let db;
const users = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia' };

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, true)', [email, person]);
  }
});
const q = (who, sql, params = []) => as(db, who ? users[who] : null, async (tx) => (await tx.query(sql, params)).rows);

test('the stage 4–6 migrations come after the live ones, in this order', () => {
  const files = migrationFiles();
  const tail = files.slice(files.indexOf('20260930160000_intake.sql'));
  assert.deepEqual(tail, [
    '20260930160000_intake.sql', '20260930170000_client_status.sql', '20260930180000_whatsapp.sql',
    '20260930190000_year.sql', '20260930200000_calendar_feeds.sql', '20260930210000_hardening.sql',
  ]);
});

test('client_tasks.source: the union of every migration\'s values, rebuilt last by the status page\'s migration', async () => {
  const { rows } = await db.query("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'client_tasks_source_check'");
  const vals = [...rows[0].def.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(vals, SOURCES);
  // Which migrations rebuild it: the status page's is the last.
  const rebuilders = migrationFiles().filter((f) => /client_tasks_source_check/.test(readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8')));
  assert.equal(rebuilders.at(-1), '20260930170000_client_status.sql');
  // Every source the code and the functions write is allowed.
  const code = ['../../app/status-rules.js', '../../app/reminder-rules.js', '../../supabase/migrations/20260930180000_whatsapp.sql', '../../supabase/migrations/20260930170000_client_status.sql']
    .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  const used = [...code.matchAll(/\bsource\s*(?:={1,3}|:)\s*'([a-z_0-9]+)'/g)].map((m) => m[1]);
  assert.ok(used.includes('client_fix') && used.includes('escalation'), used.join());
  for (const m of used.map((x) => [null, x])) {
    if (['page', 'office'].includes(m[1])) continue; // client_surveys.source
    assert.ok(SOURCES.includes(m[1]), m[1]);
  }
  // A value outside the list is refused.
  const { rows: c } = await db.query("insert into public.clients (name) values ('src') returning id");
  await assert.rejects(db.query("insert into public.client_tasks (client_id, title, owner, source) values ($1, 'x', 'irit', 'whatever')", [c[0].id]), /client_tasks_source_check/);
  for (const s of SOURCES) {
    await db.query("insert into public.client_tasks (client_id, title, owner, source) values ($1, 'x', 'irit', $2)", [c[0].id, s]);
  }
});

test('the scripts wait for the client\'s approval in any protocol version (numbered only from version 2)', async () => {
  const add = async (name, v) => {
    const { rows } = await db.query("insert into public.clients (name, shoot_type) values ($1, 'dms') returning id", [name]);
    await db.query('update public.clients set protocol_version = $2 where id = $1', [rows[0].id, v]);
    for (const k of ['p12.scripts', 'p12.docs']) {
      await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done')", [rows[0].id, k]);
    }
    return rows[0].id;
  };
  const scripts = async (id) => (await db.query('select private.status_items($1) as s', [id])).rows[0].s.filter((i) => i.item === 'scripts');
  const v1 = await add('v1', 1);
  const v5 = await add('v5', 5);
  assert.equal((await db.query('select protocol_version from public.clients where id = $1', [v1])).rows[0].protocol_version, 1);
  assert.deepEqual((await scripts(v1)).map((i) => i.state), ['waiting']);
  assert.deepEqual(await scripts(v5), []);
  await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p12.numbered', 'na')", [v5]);
  assert.deepEqual((await scripts(v5)).map((i) => i.state), ['waiting']);
  // The same for an extra shoot round of a version 1 client.
  await db.query(`update public.clients set rounds = '[{"n": 2}]'::jsonb where id = $1`, [v1]);
  for (const k of ['r2.p12.scripts', 'r2.p12.docs']) await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done')", [v1, k]);
  assert.deepEqual((await scripts(v1)).map((i) => i.key), ['p13.approved', 'r2.p13.approved']);
});

test('the surveys: the office (the owner and Lior\'s insights, the renewals) reads the report\'s columns; nobody else, not anon', async () => {
  const { rows } = await db.query("insert into public.clients (name) values ('sv') returning id");
  await db.query("insert into public.client_surveys (client_id, kind, score, respondent, question, source) values ($1, 'nps', 9, 'דנה', 'q', 'office')", [rows[0].id]);
  for (const who of ['owner', 'lior', 'irit', 'ofir', 'ilai']) {
    const got = await q(who, `select ${SURVEY_REPORT_COLS} from public.client_surveys where client_id = $1`, [rows[0].id]);
    assert.equal(got.length, 1, who);
    assert.equal(got[0].kind, 'nps');
  }
  assert.deepEqual(await q('nadia', 'select 1 from public.client_surveys'), []);
  const anon = await as(db, null, async (tx) => tx.query('select 1 from public.client_surveys')).catch((e) => ({ error: e.message }));
  assert.ok(anon.error || anon.rows?.length === 0);
});

test('client consent and staff consent are separate tables', async () => {
  const tables = (await db.query("select table_name from information_schema.tables where table_schema = 'public' and table_name ~ 'consent' order by 1")).rows.map((r) => r.table_name);
  assert.ok(tables.includes('client_consents'), tables.join());
  const staff = tables.filter((t) => t !== 'client_consents');
  assert.ok(staff.length >= 1 && staff.every((t) => /^whatsapp_consent/.test(t)), tables.join());
  // The client's (a quote's signature) has no staff email; the staff's has no quote.
  const cols = async (t) => (await db.query('select column_name from information_schema.columns where table_schema = $1 and table_name = $2', ['public', t])).rows.map((r) => r.column_name);
  assert.ok((await cols('client_consents')).includes('quote_id'));
  for (const t of staff) assert.ok(!(await cols(t)).includes('quote_id'), t);
});

test('anon runs only the deliberate token functions: the quote, the signature and the status page', async () => {
  const { rows } = await db.query(`select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') order by 1`);
  assert.deepEqual(rows.map((r) => r.f), [
    'public.answer_survey', 'public.approve_item', 'public.get_quote', 'public.get_status', 'public.request_fix', 'public.sign_quote',
  ]);
  // And no table of stages 4–6 is open to anon.
  const t = await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname ~ '^(client_(status_links|status_views|approvals|surveys|consents|month_marks)|whatsapp_.*|calendar_feeds|app_settings)$'
      and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))`);
  assert.deepEqual(t.rows, []);
  // Every table has row level security.
  const open = await db.query("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity");
  assert.deepEqual(open.rows, []);
});
