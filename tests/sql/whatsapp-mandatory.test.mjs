// WhatsApp as a required work channel (supabase/migrations/20261030100000_whatsapp_mandatory.sql;
// the owner, 21.10.2026) in a real Postgres with every migration (tests/sql/pg.mjs): the
// newest wording says it is required (version 2), whoever is not connected is asked on
// every visit (also after choosing push only before, or after "הסר"), "push only" is no
// longer accepted, the app cannot stop the messages any more, "הסר" on WhatsApp still
// does (Meta's policy) and the reminders function reads who did, for the owners.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';

const FILE = '20261030100000_whatsapp_mandatory.sql';
let db;
const users = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir' };
const PHONES = { irit: '972501111111', ofir: '972503333333' };

async function asRole(role, fn) {
  let out;
  await db.transaction(async (tx) => {
    await tx.query(`set local role ${role}`);
    try { out = await fn(tx); } catch (err) { out = { error: err.message }; }
    await tx.rollback();
  });
  return out;
}
const q = (who, sql, params = []) => as(db, who ? users[who] : null, async (tx) => (await tx.query(sql, params)).rows);
const one = async (who, sql, params) => { const r = await q(who, sql, params); return r.error ? r : r[0]; };
const svc = (sql, params = []) => asRole('service_role', async (tx) => (await tx.query(sql, params)).rows);
// As a signed-in user, and kept. → the first row, or { error }.
async function keep(who, sql, params = []) {
  const u = users[who];
  try {
    let out;
    await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated' })]);
      out = (await tx.query(sql, params)).rows[0];
    });
    return out;
  } catch (err) {
    return { error: err.message };
  }
}
const mine = async (who) => (await one(who, 'select public.whatsapp_my_consent() s')).s;

before(async () => {
  // Up to the migration first: Ofir chose "push only" while it was a free choice.
  db = await freshDatabase({ upTo: FILE });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault, phone) values ($1, $2, false, $3)', [email, person, PHONES[key] || null]);
  }
  await db.query("update public.app_settings set value = 'true' where key = 'whatsapp_enabled'");
  assert.equal((await keep('ofir', "select public.whatsapp_decide('push', 1) s")).s.status, 'declined');
  await db.exec(migrationSql(FILE));
});

test('the migration only adds, is the newest, has none of the words the deploy tool refuses, and running it again changes nothing', async () => {
  const whole = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.deepEqual(whole.match(/drop|delete|truncate/gi), null);
  for (const m of whole.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  assert.equal(migrationFiles().at(-1), FILE, 'the newest migration');
  assert.match(whole, /AWAITS THE LAWYER'S OK/);
  await db.exec(migrationSql(FILE));
  assert.deepEqual((await db.query('select version from public.whatsapp_consent_texts order by version')).rows, [{ version: 1 }, { version: 2 }]);
  // Version 1 is kept as it was: the log of who agreed to it still points at its words.
  assert.match((await db.query('select body from public.whatsapp_consent_texts where version = 1')).rows[0].body, /זו בחירה שלך/);
});

test('version 2 says it is required: both channels, the hours, what is sent, the dedicated number, the privacy notice', async () => {
  const s = await mine('irit');
  assert.equal(s.text.version, 2);
  assert.equal(s.text.title, 'חובה: גם WhatsApp וגם התראות באפליקציה');
  assert.equal(s.required, true);
  const body = s.text.body;
  assert.match(body, /שניהם חובה לכל הצוות/);
  assert.match(body, /המספר העסקי הייעודי של אסטרטג, למספר 050-111-1111/);
  assert.match(body, /התראות של האפליקציה בטלפון/);
  assert.match(body, /מה יישלח: סיכום יומי/);
  assert.match(body, /א׳–ה׳ בין 08:30 ל־19:00, ובערב חג עד 13:00/);
  assert.match(body, /״הסר״[\s\S]*הבעלים יקבלו/);
  assert.match(body, /הודעת הפרטיות לעובדים/);
  assert.doesNotMatch(body, /בחירה שלך|אם לא תסכים|אפשר להפסיק/);
  assert.equal(s.text.yes, 'חיבור WhatsApp');
});

test('asked on every visit until connected: never chose, chose push only before; not without a number (but the owner types his)', async () => {
  assert.deepEqual([(await mine('irit')).prompt, (await mine('irit')).active], [true, false]);
  const ofir = await mine('ofir');
  assert.deepEqual([ofir.status, ofir.prompt], ['declined', true], 'push only is no longer enough');
  assert.equal((await mine('lior')).prompt, false, 'no number: the office adds one');
  assert.equal((await mine('owner')).prompt, true);
});

test('only WhatsApp is accepted, for the newest wording; then nobody is asked again', async () => {
  assert.match((await keep('irit', "select public.whatsapp_decide('push', 2)")).error, /required/);
  assert.match((await keep('irit', "select public.whatsapp_decide('maybe', 2)")).error, /bad_choice/);
  assert.match((await keep('irit', "select public.whatsapp_decide('whatsapp', 1)")).error, /stale_text/);
  assert.match((await keep('lior', "select public.whatsapp_decide('whatsapp', 2)")).error, /no_phone/);
  assert.match((await keep('owner', "select public.whatsapp_decide('whatsapp', 2, '03-1234567')")).error, /no_phone/);
  const s = (await keep('irit', "select public.whatsapp_decide('whatsapp', 2, null, 'UA') s")).s;
  assert.deepEqual([s.status, s.active, s.prompt, s.version], ['granted', true, false, 2]);
  const o = (await keep('owner', "select public.whatsapp_decide('whatsapp', 2, '050-222-2222') s")).s;
  assert.deepEqual([o.active, o.prompt, o.phone], [true, false, '972502222222']);
  const [log] = (await db.query("select action, via, text_version, answer, wording from public.whatsapp_consent_log where email = 'irit@astrateg.test' order by id desc limit 1")).rows;
  assert.deepEqual([log.action, log.via, log.text_version, log.answer], ['granted', 'app', 2, 'חיבור WhatsApp']);
  assert.match(log.wording, /^חובה: גם WhatsApp וגם התראות באפליקציה\n\n[\s\S]*050-111-1111/);
});

test('the app cannot stop the messages any more', async () => {
  for (const who of ['irit', 'owner']) assert.match((await q(who, "select public.whatsapp_withdraw('UA')")).error, /permission denied/, who);
  assert.equal((await mine('irit')).active, true);
});

test('"הסר" on WhatsApp still stops them; that person is asked again, and the reminders function reads who did it', async () => {
  const out = await asRole('service_role', async (tx) => (await tx.query("select public.whatsapp_apply('wamid.stop.1', null, '972501111111', '{\"op\":\"withdraw\"}') r")).rows[0].r);
  assert.equal(out, 'withdrawn');
  // (asRole rolls back: applied again, kept.)
  await db.transaction(async (tx) => {
    await tx.query('set local role service_role');
    await tx.query("select public.whatsapp_apply('wamid.stop.1', null, '972501111111', '{\"op\":\"withdraw\"}')");
  });
  const s = await mine('irit');
  assert.deepEqual([s.status, s.via, s.active, s.prompt], ['withdrawn', 'whatsapp', false, true]);
  const rows = await svc('select email, person from public.whatsapp_removed_since(now() - interval \'1 hour\')');
  assert.deepEqual(rows, [{ email: 'irit@astrateg.test', person: 'irit' }]);
  assert.deepEqual(await svc("select email from public.whatsapp_removed_since(now() + interval '1 minute')"), []);
  // The service role's only.
  for (const who of ['irit', 'owner', null]) assert.match((await q(who, 'select * from public.whatsapp_removed_since(now())')).error, /permission denied/, String(who));
  // Connecting again from the screen.
  const again = (await keep('irit', "select public.whatsapp_decide('whatsapp', 2) s")).s;
  assert.deepEqual([again.active, again.prompt, again.via], [true, false, null]);
});

test('every function of the migration pins its search path', async () => {
  const { rows } = await db.query(`select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('whatsapp_my_consent', 'whatsapp_decide', 'whatsapp_removed_since') order by p.proname`);
  assert.equal(rows.length, 3);
  for (const r of rows) assert.deepEqual(r.proconfig, ['search_path=""'], r.proname);
});
