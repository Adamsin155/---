// The staff WhatsApp channel's database (supabase/migrations/20260930180000_whatsapp.sql)
// in a real Postgres with every migration (tests/sql/pg.mjs): the switch is the
// owner's and needs the Vault secrets; each person reads and changes only their own
// consent (with the words, the number and the time recorded), the office sees who
// agreed but no numbers; the functions' helpers are for the service role; delivery
// only moves forward; a reply is applied once, as the person, and only from the
// number the message went to.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as } from './pg.mjs';

let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', nadia: 'nadia' };
const PHONES = { irit: '972501111111', ofir: '972503333333', nadia: '972504444444' };

async function asRole(role, fn) {
  let out;
  await db.transaction(async (tx) => {
    await tx.query(`set local role ${role}`);
    try { out = await fn(tx); } catch (err) { out = { error: err.message }; }
    await tx.rollback();
  });
  return out;
}
const run = (who, fn) => as(db, users[who], fn);
const q = (who, sql, params = []) => run(who, async (tx) => (await tx.query(sql, params)).rows);
const svc = (sql, params = []) => asRole('service_role', async (tx) => (await tx.query(sql, params)).rows);
const one = async (who, sql, params) => { const r = await q(who, sql, params); return r.error ? r : r[0]; };
// As a signed-in user, and kept (the consent tests build on each other).
async function keep(who, sql, params = []) {
  const u = users[who];
  let out;
  await db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated' })]);
    out = (await tx.query(sql, params)).rows[0];
  });
  return out;
}
const SECRETS = [['whatsapp_access_token', 'EAAG-token-for-tests-0123456789'], ['whatsapp_phone_number_id', '1234567890'], ['whatsapp_app_secret', 'app-secret-0123456789'], ['whatsapp_verify_token', 'verify-token-0123456789']];

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault, phone) values ($1, $2, false, $3)', [email, person, PHONES[key] || null]);
  }
  const { rows: [c] } = await db.query("insert into public.clients (name, shoot_type, editor) values ('פיצה', 'dms', 'nadia') returning id");
  ids.client = c.id;
});

test('the helpers of the functions are for the service role only, and every function pins its search path', async () => {
  const calls = [
    'select * from public.whatsapp_config()', 'select * from public.whatsapp_webhook_secrets()', 'select * from public.whatsapp_recipients()',
    "select public.whatsapp_status('x', 'read', now(), null)", "select public.whatsapp_apply('x', null, '972501111111', '{\"op\":\"none\"}')",
  ];
  for (const sql of calls) {
    assert.match((await q('owner', sql)).error || '', /permission denied/, sql);
    assert.match((await as(db, null, async (tx) => (await tx.query(sql)).rows)).error || '', /permission denied/, sql);
    assert.ok(!(await svc(sql)).error, sql);
  }
  for (const sql of ['select public.whatsapp_my_consent()', 'select public.whatsapp_settings()', "select public.whatsapp_decide('push', 1)"]) {
    assert.match((await as(db, null, async (tx) => (await tx.query(sql)).rows)).error || '', /permission denied/, sql);
  }
  // Nothing written straight from the browser.
  assert.match((await q('irit', "insert into public.whatsapp_consents (email, person, status, text_version) values ('irit@astrateg.test', 'irit', 'granted', 1)")).error || '', /permission denied/);
  assert.match((await q('owner', "update public.app_settings set value = 'true'")).error || '', /permission denied/);
  assert.match((await q('owner', 'select * from public.whatsapp_inbound')).error || '', /permission denied/);
  const loose = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and (p.proname like 'whatsapp%' or p.proname in ('is_owner', 'phone_text'))
      and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=""%', false)`)).rows;
  assert.deepEqual(loose, []);
});

test('the switch: off by default, the owner only, and on only with the four Vault secrets', async () => {
  assert.equal((await one('irit', 'select public.whatsapp_settings() s')).s.enabled, false);
  assert.equal((await one('nadia', 'select public.whatsapp_settings() s')).s, null, 'not the office');
  assert.match((await q('irit', 'select public.whatsapp_set_enabled(true)')).error, /owner only/);
  assert.match((await q('owner', 'select public.whatsapp_set_enabled(true)')).error, /not_ready/);
  // The owner adds them in the SQL editor (vault.create_secret), never from the app.
  assert.match((await q('owner', "select vault.create_secret('x', 'whatsapp_app_secret')")).error || '', /permission denied/);
  for (const [name, value] of SECRETS) await db.query('select vault.create_secret($1, $2)', [value, name]);
  const out = await run('owner', async (tx) => {
    const { rows: [r] } = await tx.query('select public.whatsapp_set_enabled(true) s');
    const { rows: [flag] } = await tx.query("select value, updated_by_email from public.app_settings where key = 'whatsapp_enabled'");
    return { s: r.s, flag };
  });
  assert.equal(out.s.enabled, true);
  assert.deepEqual(out.s.secrets, { access_token: true, phone_number_id: true, app_secret: true, verify_token: true });
  assert.deepEqual(out.flag, { value: true, updated_by_email: 'owner@astrateg.test' });
});

// Turns WhatsApp on with the secrets for the rest of the tests (outside a rollback).
async function turnOn() {
  for (const [name, value] of SECRETS) await db.query('insert into vault.secrets (name, secret) values ($1, $2) on conflict (name) do nothing', [name, value]);
  await db.query("update public.app_settings set value = 'true' where key = 'whatsapp_enabled'");
}

test('the consent screen: once, with the person\'s own number; the choice is kept with the words, the number and the time', async () => {
  let me = (await one('irit', 'select public.whatsapp_my_consent() s')).s;
  assert.equal(me.prompt, false, 'not while WhatsApp is off');
  await turnOn();
  me = (await one('irit', 'select public.whatsapp_my_consent() s')).s;
  assert.deepEqual([me.enabled, me.prompt, me.phone, me.status, me.owner], [true, true, '972501111111', null, false]);
  assert.match(me.text.body, /למספר 050-111-1111\./);
  assert.equal(me.text.version, 1);
  // Lior has no number: nothing to agree to, no screen.
  assert.equal((await one('lior', 'select public.whatsapp_my_consent() s')).s.prompt, false);
  assert.match((await q('lior', "select public.whatsapp_decide('whatsapp', 1)")).error, /no_phone/);
  // An old screen (another version) is refused.
  assert.match((await q('irit', "select public.whatsapp_decide('whatsapp', 0)")).error, /stale_text/);
  const after = (await keep('irit', "select public.whatsapp_decide('whatsapp', 1, '0529999999', 'Test UA') s")).s;
  assert.deepEqual([after.status, after.active, after.prompt, after.phone], ['granted', true, false, '972501111111'], 'a staff number is the office\'s, not typed');
  const [logRow] = (await db.query("select * from public.whatsapp_consent_log where email = 'irit@astrateg.test'")).rows;
  assert.deepEqual([logRow.action, logRow.via, logRow.phone, logRow.text_version, logRow.answer, logRow.user_agent], ['granted', 'app', '972501111111', 1, 'אני מסכים/ה לקבל הודעות ב־WhatsApp', 'Test UA']);
  assert.match(logRow.wording, /^הודעות עבודה ב־WhatsApp\n\nהמערכת יכולה לשלוח לך[^]*050-111-1111[^]*פרטים בהודעת הפרטיות לעובדים\.$/);
  // Ofir says no: push only, recorded too.
  assert.equal((await keep('ofir', "select public.whatsapp_decide('push', 1) s")).s.status, 'declined');
  // The owner keeps no number on the staff list: typed on the screen, kept in their own row only.
  assert.equal((await one('owner', 'select public.whatsapp_my_consent() s')).s.prompt, true);
  assert.match((await q('owner', "select public.whatsapp_decide('whatsapp', 1, '03-1234567')")).error, /no_phone/);
  const own = (await keep('owner', "select public.whatsapp_decide('whatsapp', 1, '050-222-2222') s")).s;
  assert.deepEqual([own.status, own.active, own.phone], ['granted', true, '972502222222']);
  assert.equal((await db.query("select phone from public.staff where email = 'owner@astrateg.test'")).rows[0].phone, null);
});

test('each person reads only their own consent; the office sees who agreed, never the numbers', async () => {
  assert.deepEqual((await q('irit', 'select email from public.whatsapp_consents')).map((r) => r.email), ['irit@astrateg.test']);
  assert.deepEqual((await q('irit', 'select email from public.whatsapp_consent_log')).map((r) => r.email), ['irit@astrateg.test']);
  assert.deepEqual(await q('nadia', 'select email from public.whatsapp_consents'), []);
  const team = await q('lior', 'select * from public.whatsapp_team_status()');
  const by = Object.fromEntries(team.map((r) => [r.person, r]));
  assert.deepEqual([by.irit.status, by.irit.phone_set, by.irit.active], ['granted', true, true]);
  assert.deepEqual([by.owner.status, by.owner.phone_set, by.owner.active], ['granted', true, true]);
  assert.deepEqual([by.ofir.status, by.lior.status, by.lior.phone_set], ['declined', null, false]);
  assert.ok(!JSON.stringify(team).includes('97250'), 'no numbers');
  assert.deepEqual(await q('nadia', 'select * from public.whatsapp_team_status()'), [], 'not the office');
  // The function's list: who agreed, with both numbers (the service role only).
  const list = await svc('select email, person, consent_phone, staff_phone from public.whatsapp_recipients() order by email');
  assert.deepEqual(list.map((r) => [r.person, r.consent_phone, r.staff_phone]), [['irit', '972501111111', '972501111111'], ['owner', '972502222222', null]]);
  const cfg = (await svc('select * from public.whatsapp_config()'))[0];
  assert.deepEqual([cfg.enabled, cfg.phone_number_id], [true, '1234567890']);
});

test('a changed number asks again; withdrawing stops the messages and is recorded', async () => {
  let out;
  await db.transaction(async (tx) => {
    await tx.query("update public.staff set phone = '972505555555' where email = 'irit@astrateg.test'"); // (the office, through staff-admin)
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users.irit.id, email: users.irit.email, role: 'authenticated' })]);
    const { rows: [a] } = await tx.query('select public.whatsapp_my_consent() s');
    const { rows: [b] } = await tx.query("select public.whatsapp_withdraw('UA2') s");
    const { rows: l } = await tx.query("select action, via from public.whatsapp_consent_log where email = 'irit@astrateg.test' order by id");
    out = { a: a.s, b: b.s, l };
    await tx.rollback();
  });
  assert.deepEqual([out.a.active, out.a.prompt, out.a.phone], [false, true, '972505555555']);
  assert.deepEqual([out.b.status, out.b.active, out.b.prompt], ['withdrawn', false, false]);
  assert.deepEqual(out.l, [{ action: 'granted', via: 'app' }, { action: 'withdrawn', via: 'app' }]);
});

// A reminder, and its WhatsApp message to Irit.
async function message({ key, rule, ref = null, template = 'due', wa = `wamid.${key}` }) {
  const { rows: [l] } = await db.query(`insert into public.reminder_log (key, rule, person, level, channel, status, title, client_id, ref)
    values ($1, $2, 'irit', 'ring', 'push', 'sent', 'עסקה חדשה: פיצה', $3, $4) returning id`, [key, rule, ids.client, ref]);
  const { rows: [m] } = await db.query(`insert into public.whatsapp_messages (log_id, person, email, phone, template, wa_message_id, status, sent_at)
    values ($1, 'irit', 'irit@astrateg.test', '972501111111', $2, $3, 'sent', now()) returning id`, [l.id, template, wa]);
  return { log: l.id, msg: m.id, wa };
}

test('delivery only moves forward; "read" marks the reminder read', async () => {
  const m = await message({ key: 'deal:c:deal:now@irit', rule: 'deal' });
  const st = async (status, err = null) => (await svc('select public.whatsapp_status($1, $2, now(), $3) ok', [m.wa, status, err]))[0].ok;
  const out = await asRole('service_role', async (tx) => {
    const s = async (status, err = null) => (await tx.query('select public.whatsapp_status($1, $2, now(), $3) ok', [m.wa, status, err])).rows[0].ok;
    const r = [await s('delivered'), await s('sent'), await s('read'), await s('delivered'), await s('failed', 'meta #1')];
    const { rows: [row] } = await tx.query('select status, delivered_at is not null d, read_at is not null r, error from public.whatsapp_messages where id = $1', [m.msg]);
    const { rows: [lr] } = await tx.query('select read_at is not null r from public.reminder_log where id = $1', [m.log]);
    return { r, row, lr };
  });
  assert.deepEqual(out.r, [true, false, true, false, false]);
  assert.deepEqual(out.row, { status: 'read', d: true, r: true, error: null });
  assert.equal(out.lr.r, true);
  assert.equal(await st('failed', 'meta #131026'), true, 'failed before delivery');
  assert.equal(await st('nonsense'), false);
  assert.equal((await svc("select public.whatsapp_status('wamid.unknown', 'read', now(), null) ok"))[0].ok, false);
});

test('a reply is applied once, as the person, only from the number the message went to', async () => {
  const { rows: [t] } = await db.query("insert into public.client_tasks (client_id, title, owner, urgent, created_by_email) values ($1, 'להחליף לוגו', 'irit', true, 'lior@astrateg.test') returning id", [ids.client]);
  const m = await message({ key: `urgent:c:${t.id}:now@irit`, rule: 'urgent', template: 'new_task' });
  const apply = (tx, inbound, plan, from = '972501111111', msg = m.msg) => tx.query('select public.whatsapp_apply($1, $2, $3, $4) r', [inbound, msg, from, JSON.stringify(plan)]).then((x) => x.rows[0].r);
  const out = await asRole('service_role', async (tx) => {
    const r = [
      await apply(tx, 'in.x', { op: 'task_start', task: t.id }, '972509999999'), // someone else's number
      await apply(tx, 'in.1', { op: 'task_start', task: t.id }),
      await apply(tx, 'in.1', { op: 'task_start', task: t.id }), // Meta sent it twice
      await apply(tx, 'in.2', { op: 'task_done', task: t.id }),
    ];
    const { rows: [task] } = await tx.query('select started_at is not null s, started_by_email, done_at is not null d, done_by_email from public.client_tasks where id = $1', [t.id]);
    const { rows: inbound } = await tx.query('select id, op, result from public.whatsapp_inbound order by id');
    return { r, task, inbound };
  });
  assert.deepEqual(out.r, ['unknown', 'started', 'duplicate', 'done']);
  assert.deepEqual(out.task, { s: true, started_by_email: 'irit@astrateg.test', d: true, done_by_email: 'irit@astrateg.test' });
  assert.deepEqual(out.inbound.map((x) => [x.id, x.op, x.result]), [['in.1', 'task_start', 'started'], ['in.2', 'task_done', 'done'], ['in.x', 'none', 'unknown']]);
});

test('"אני על זה" on a process claims it as in the app; "צריך עזרה" opens an exception for Lior; "הסר" stops the messages', async () => {
  const m = await message({ key: 'deal:c2:deal:now@irit', rule: 'deal', ref: 'p01' });
  const m3 = await message({ key: 'deal:c3:deal:now@irit', rule: 'deal', ref: 'p03' });
  await db.query("insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p03.claim', 'done', 'lior')", [ids.client]);
  await db.query("update public.staff set phone = '972501111111' where email = 'irit@astrateg.test'");
  await db.query("update public.whatsapp_consents set status = 'granted', phone = '972501111111' where email = 'irit@astrateg.test'");
  const out = await asRole('service_role', async (tx) => {
    const apply = (inbound, plan, from = '972501111111', msg = m.msg) => tx.query('select public.whatsapp_apply($1, $2, $3, $4) r', [inbound, msg, from, JSON.stringify(plan)]).then((x) => x.rows[0].r);
    const r = [
      await apply('c.1', { op: 'claim', item: 'p02.claim' }), // not this reminder's process
      await apply('c.2', { op: 'claim', item: 'p01.claim' }),
      await apply('c.3', { op: 'claim', item: 'p01.claim' }), // her second press

      await apply('c.4', { op: 'help', title: 'צריך עזרה (עירית): עסקה חדשה: פיצה' }),
      await apply('c.4b', { op: 'help', title: 'צריך עזרה (עירית): עסקה חדשה: פיצה' }), // pressed again: still one
      await apply('c.5', { op: 'withdraw' }, '972501111111', null),
      await apply('c.6', { op: 'withdraw' }, '972500000000', null),
      await apply('c.7', { op: 'drop_table' }),
      await apply('c.8', { op: 'claim', item: 'p03.claim' }, '972501111111', m3.msg), // Lior has it
    ];
    const { rows: checks } = await tx.query("select item_key, note, by_email from public.protocol_checks where client_id = $1 and item_key like '%.claim'", [ids.client]);
    const { rows: help } = await tx.query("select owner, source, created_by_email, title from public.client_tasks where source = 'escalation'");
    const { rows: [c] } = await tx.query("select status, withdrawn_via from public.whatsapp_consents where email = 'irit@astrateg.test'");
    const { rows: [l] } = await tx.query("select action, via from public.whatsapp_consent_log where email = 'irit@astrateg.test' order by id desc limit 1");
    return { r, checks, help, c, l };
  });
  assert.deepEqual(out.r, ['unchanged', 'claimed', 'claimed', 'help', 'help', 'withdrawn', 'not_found', 'none', 'taken']);
  assert.deepEqual(out.checks.filter((c) => c.item_key === 'p01.claim'), [{ item_key: 'p01.claim', note: 'irit', by_email: 'irit@astrateg.test' }]);
  assert.equal(out.checks.find((c) => c.item_key === 'p03.claim').note, 'lior', 'not taken over');
  assert.deepEqual(out.help, [{ owner: 'lior', source: 'escalation', created_by_email: 'irit@astrateg.test', title: 'צריך עזרה (עירית): עסקה חדשה: פיצה' }]);
  assert.deepEqual(out.c, { status: 'withdrawn', withdrawn_via: 'whatsapp' });
  assert.deepEqual(out.l, { action: 'withdrawn', via: 'whatsapp' });
});

test('the team screen counts this week\'s messages per person', async () => {
  const team = await q('owner', 'select person, sent, delivered, read, failed from public.whatsapp_team_status()');
  const irit = team.find((r) => r.person === 'irit');
  assert.ok(irit.sent >= 3, JSON.stringify(irit));
  assert.equal(typeof irit.read, 'number');
});
