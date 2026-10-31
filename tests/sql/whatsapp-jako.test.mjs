// The second WhatsApp provider's database (supabase/migrations/20261025100000_whatsapp_jako.sql;
// docs/ops.md, section 63) in a real Postgres with every migration (tests/sql/pg.mjs):
// Meta stays the default and answers as before; only the owner sets the provider, and
// only while the switch is off; the switch needs the chosen provider's secrets (Jako's
// one key, none of Meta's); the functions get only that provider's secrets, and Meta's
// webhook none while the provider is Jako; who is asked for replies ("הסר"), and from when.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';

const FILE = '20261025100000_whatsapp_jako.sql';
let db;
const users = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', nadia: 'nadia' };
const PHONES = { irit: '972501111111', ofir: '972503333333', nadia: '972504444444' };
const META = [['whatsapp_access_token', 'EAAG-token-for-tests-0123456789'], ['whatsapp_phone_number_id', '1234567890'], ['whatsapp_app_secret', 'app-secret-0123456789'], ['whatsapp_verify_token', 'verify-token-0123456789']];
const JAKO_KEY = 'jako-key-for-tests-0123456789';
const HOOK = 'hook-secret-for-tests-0123456789';

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
// As the service role, and kept (the reminders function's calls).
async function keepSvc(sql, params = []) {
  let out;
  await db.transaction(async (tx) => {
    await tx.query('set local role service_role');
    out = (await tx.query(sql, params)).rows;
  });
  return out;
}
const settings = async (who = 'owner') => (await one(who, 'select public.whatsapp_settings() s')).s;

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault, phone) values ($1, $2, false, $3)', [email, person, PHONES[key] || null]);
  }
});

test('the migration only adds: no statement removes anything, and running it again changes nothing', async () => {
  const whole = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  // None of the words the production deploy tool refuses, anywhere in the file (comments too).
  assert.deepEqual(whole.match(/drop|delete|truncate/gi), null);
  const sql = whole.replace(/--[^\n]*/g, '');
  // Every UPDATE in it has a WHERE (an upsert's "do update set" is not one).
  for (const m of sql.matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  // The newest migration but the landing's editor of 14.10.2026 and what came after it, which are not WhatsApp's.
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261026100000_landing_editor.sql', '20261027100000_landing_links.sql', '20261028100000_quotes_insert_fix.sql', '20261029100000_google_calendar_sync.sql', '20261031090000_nudnik_givers.sql', '20261031100000_access_and_editors.sql', '20261031110000_protocol_2110.sql', '20261031120000_nirel_any_shoot.sql', '20261101100000_editor_progress.sql', '20261102100000_gantt_irit.sql', '20261104100000_editor_progress_month.sql', '20261105100000_legacy_contracts.sql', '20261106100000_contract_ai.sql', '20261107100000_shoot_crew.sql', '20261109100000_legacy_characterizations.sql', '20261110100000_batch_2710.sql', '20261111100000_p06_ofir.sql', '20261112100000_new_influencers.sql', '20261112200000_legacy_contracts_full.sql', '20261113100000_client_details_month.sql', '20261114100000_ofir_deals.sql', '20261117100000_speed_pages.sql', '20261118100000_no_manager_approval.sql', '20261119100000_work_history.sql', '20261120100000_drive_daily.sql', '20261121100000_mcp.sql', '20261122100000_deal_pool.sql', '20261123100000_old_income.sql'], 'the newest migration');
  // Nothing of a secret in the file: the names of the Vault secrets only, read and never
  // written (the owner creates them himself).
  assert.match(sql, /whatsapp_jako_api_key/);
  assert.match(sql, /whatsapp_jako_hook_secret/);
  assert.doesNotMatch(sql, /vault\.(create_secret|update_secret)|insert\s+into\s+vault|update\s+vault/i);
  assert.equal((await db.query("select count(*)::int n from vault.secrets where name like 'whatsapp_jako%'")).rows[0].n, 0);
  await db.query("update public.whatsapp_provider set provider = 'jako' where id");
  await db.exec(migrationSql(FILE));
  assert.deepEqual((await db.query('select provider from public.whatsapp_provider')).rows, [{ provider: 'jako' }], 'a second run keeps the choice');
  await db.query("update public.whatsapp_provider set provider = 'meta' where id");
});

test('Meta is the default, and with it everything answers as before', async () => {
  const s = await settings();
  assert.deepEqual([s.enabled, s.provider, s.ready, s.owner], [false, 'meta', false, true]);
  assert.deepEqual(s.secrets, { access_token: false, phone_number_id: false, app_secret: false, verify_token: false });
  assert.equal((await one('nadia', 'select public.whatsapp_settings() s')).s, null, 'not the office');
  assert.match((await keep('owner', 'select public.whatsapp_set_enabled(true)')).error, /not_ready/);
  for (const [name, value] of META) await db.query('select vault.create_secret($1, $2)', [value, name]);
  // Jako's key alone would not do for Meta, and Meta's four do.
  assert.equal((await keep('owner', 'select public.whatsapp_set_enabled(true) s')).s.enabled, true);
  const [v2] = await svc('select * from public.whatsapp_config_v2()');
  assert.deepEqual(v2, { enabled: true, provider: 'meta', access_token: META[0][1], phone_number_id: '1234567890', jako_api_key: null, jako_flow_done: null, jako_flow_onit: null });
  // Meta's webhook is Meta's: the sub flows' door stays shut.
  assert.deepEqual((await svc('select * from public.whatsapp_jako_hook()'))[0], { provider: 'meta', hook_secret: null, jako_api_key: null });
  assert.ok(!('flows' in s));
  assert.deepEqual((await svc('select * from public.whatsapp_config()'))[0], { enabled: true, access_token: META[0][1], phone_number_id: '1234567890' });
  assert.deepEqual((await svc('select * from public.whatsapp_webhook_secrets()'))[0], { app_secret: META[2][1], verify_token: META[3][1], phone_number_id: '1234567890' });
});

test('only the owner sets the provider, and only while the switch is off', async () => {
  for (const who of ['irit', 'lior', 'nadia']) assert.match((await keep(who, "select public.whatsapp_set_provider('jako')")).error, /owner only/, who);
  assert.match((await q(null, "select public.whatsapp_set_provider('jako')")).error, /permission denied/);
  assert.match((await keep('owner', "select public.whatsapp_set_provider('twilio')")).error, /bad_provider/);
  assert.match((await keep('owner', 'select public.whatsapp_set_provider(null)')).error, /bad_provider/);
  // Nothing straight from the browser, for anyone.
  assert.match((await q('owner', "update public.whatsapp_provider set provider = 'jako' where id")).error, /permission denied/);
  assert.match((await q('irit', 'select * from public.whatsapp_provider')).error, /permission denied/);
  assert.match((await q('owner', 'select * from public.whatsapp_poll')).error, /permission denied/);
  // On: not moved to the other provider by one call (the same one is no change).
  assert.match((await keep('owner', "select public.whatsapp_set_provider('jako')")).error, /switch_off_first/);
  assert.equal((await keep('owner', "select public.whatsapp_set_provider('meta') s")).s.provider, 'meta');
  await keep('owner', 'select public.whatsapp_set_enabled(false)');
  const s = (await keep('owner', "select public.whatsapp_set_provider('jako') s")).s;
  assert.deepEqual([s.provider, s.enabled, s.ready], ['jako', false, false]);
  assert.deepEqual(s.secrets, { jako_api_key: false, jako_hook_secret: false }, 'the secrets asked for are the provider\'s');
  assert.deepEqual(s.flows, { done: false, onit: false });
  const { rows: [row] } = await db.query('select provider, updated_by_email from public.whatsapp_provider');
  assert.deepEqual(row, { provider: 'jako', updated_by_email: 'owner@astrateg.test' });
  assert.equal((await settings('irit')).provider, 'jako', 'the office sees which');
});

test('with Jako the switch needs Jako\'s two secrets and its two reply flows, and none of Meta\'s; the functions get Jako\'s only, and Meta\'s webhook nothing', async () => {
  const on = () => keep('owner', 'select public.whatsapp_set_enabled(true) s');
  // Meta's four are all in Vault, and still: not ready.
  assert.match((await on()).error, /not_ready/);
  assert.match((await keep('irit', 'select public.whatsapp_set_enabled(true)')).error, /owner only/);
  // The owner adds the secrets himself in the SQL editor (vault.create_secret), never from the app.
  assert.match((await q('owner', "select vault.create_secret('x', 'whatsapp_jako_api_key')")).error || '', /permission denied/);
  await db.query("select vault.create_secret('too-short', 'whatsapp_jako_api_key')");
  assert.match((await on()).error, /not_ready/);
  await db.query("update vault.secrets set secret = $1 where name = 'whatsapp_jako_api_key'", [JAKO_KEY]);
  // The key alone is not enough: the buttons' calls need their secret…
  assert.match((await on()).error, /not_ready/);
  assert.deepEqual((await settings()).secrets, { jako_api_key: true, jako_hook_secret: false });
  await db.query("select vault.create_secret('short', 'whatsapp_jako_hook_secret')");
  assert.equal((await settings()).secrets.jako_hook_secret, false);
  await db.query("update vault.secrets set secret = $1 where name = 'whatsapp_jako_hook_secret'", [HOOK]);
  // … and each button its flow. Only the owner sets them.
  assert.match((await on()).error, /not_ready/);
  for (const who of ['irit', 'lior', 'nadia']) assert.match((await keep(who, "select public.whatsapp_set_jako_flows('f100s200', 'f100s201')")).error, /owner only/, who);
  assert.match((await q(null, "select public.whatsapp_set_jako_flows('f100s200', 'f100s201')")).error, /permission denied/);
  assert.match((await keep('owner', "select public.whatsapp_set_jako_flows('a b; c', 'f100s201')")).error, /bad_flow/);
  assert.match((await q('owner', "update public.whatsapp_provider set jako_flow_done = 'x1234' where id")).error, /permission denied/);
  let s = (await keep('owner', "select public.whatsapp_set_jako_flows(' f100s200 ', null) s")).s;
  assert.deepEqual([s.flows, s.ready], [{ done: true, onit: false }, false]);
  assert.match((await on()).error, /not_ready/);
  s = (await keep('owner', "select public.whatsapp_set_jako_flows('f100s200', 'f100s201') s")).s;
  assert.deepEqual([s.flows, s.ready, s.provider], [{ done: true, onit: true }, true, 'jako'], 'the provider is not touched');
  // While it is off no secret leaves Vault, for either provider (the flows are not secrets).
  const off = { enabled: false, provider: 'jako', access_token: null, phone_number_id: null, jako_api_key: null, jako_flow_done: 'f100s200', jako_flow_onit: 'f100s201' };
  assert.deepEqual((await svc('select * from public.whatsapp_config_v2()'))[0], off);
  await db.query("update vault.secrets set name = name || '_away' where name like 'whatsapp_%' and name not like 'whatsapp_jako_%'");
  s = (await on()).s;
  assert.deepEqual([s.enabled, s.provider, s.ready, s.secrets], [true, 'jako', true, { jako_api_key: true, jako_hook_secret: true }]);
  await db.query("update vault.secrets set name = replace(name, '_away', '') where name like '%_away'");
  assert.ok(!JSON.stringify(s).includes(JAKO_KEY) && !JSON.stringify(s).includes(HOOK), 'the screen never gets a secret');
  assert.deepEqual((await svc('select * from public.whatsapp_config_v2()'))[0], { ...off, enabled: true, jako_api_key: JAKO_KEY });
  // The secret of the buttons' calls, for the whatsapp-webhook function only.
  assert.deepEqual((await svc('select * from public.whatsapp_jako_hook()'))[0], { provider: 'jako', hook_secret: HOOK, jako_api_key: JAKO_KEY });
  // Whoever still asks the old way (a function deployed before, Meta's webhook) sends nothing through Meta.
  assert.deepEqual((await svc('select * from public.whatsapp_config()'))[0], { enabled: false, access_token: null, phone_number_id: null });
  assert.deepEqual((await svc('select * from public.whatsapp_webhook_secrets()'))[0], { app_secret: null, verify_token: null, phone_number_id: null });
  // The helpers are the service role's.
  for (const sql of ['select * from public.whatsapp_config_v2()', 'select * from public.whatsapp_jako_hook()', 'select * from public.whatsapp_poll_due(5, 300)',
    "select public.whatsapp_poll_done('irit@astrateg.test', now())", "select public.whatsapp_jako_reply('x', 1, '972501111111', '{\"op\":\"none\"}')"]) {
    assert.match((await q('owner', sql)).error || '', /permission denied/, sql);
    assert.match((await q(null, sql)).error || '', /permission denied/, sql);
  }
  // The key removed from Vault: the tick's own check turns the channel off, whatever the switch says.
  await db.query("update vault.secrets set name = 'parked' where name = 'whatsapp_jako_api_key'");
  assert.deepEqual((await svc('select enabled, jako_api_key from public.whatsapp_config_v2()'))[0], { enabled: false, jako_api_key: null });
  assert.deepEqual((await settings()).secrets, { jako_api_key: false, jako_hook_secret: true });
  await db.query("update vault.secrets set name = 'whatsapp_jako_api_key' where name = 'parked'");
});

test('a reply through Jako: "המשימה בוצעה" closes a nagging task as its assignee, once, only for a message that went through Jako to that number; the rest is applied as with Meta', async () => {
  const { rows: [c] } = await db.query("insert into public.clients (name, shoot_type) values ('סושי', 'dms') returning id");
  const nag = async (assignee = 'irit') => (await db.query("insert into public.staff_tasks (created_by, created_by_email, assignee, body) values ('lior', 'lior@astrateg.test', $1, 'להתקשר ללקוח') returning id", [assignee])).rows[0].id;
  const message = async ({ key, rule, template, provider = 'jako', client = null }) => {
    const { rows: [l] } = await db.query("insert into public.reminder_log (key, rule, person, level, channel, status, title, client_id) values ($1, $2, 'irit', 'ring', 'push', 'sent', 'כותרת', $3) returning id", [key, rule, client]);
    const { rows: [m] } = await db.query("insert into public.whatsapp_messages (log_id, person, email, phone, template, status, sent_at, provider) values ($1, 'irit', 'irit@astrateg.test', '972501111111', $2, 'sent', now(), $3) returning id", [l.id, template, provider]);
    return m.id;
  };
  const reply = (inbound, msg, plan, from = '972501111111') => keepSvc('select public.whatsapp_jako_reply($1, $2, $3, $4) r', [inbound, msg, from, JSON.stringify(plan)]).then((r) => r[0].r);
  const t1 = await nag();
  const m1 = await message({ key: `nag:-:${t1}:s0@irit`, rule: 'nag', template: 'nodnik' });
  // Not from her number, not a Jako message, not this reminder's task: nothing changes.
  assert.equal(await reply('jako:done:x1', m1, { op: 'nag_done', task: t1 }, '972509999999'), 'unknown');
  const meta = await message({ key: `nag:-:${t1}:s1@irit`, rule: 'nag', template: 'due', provider: 'meta' });
  assert.equal(await reply('jako:done:x2', meta, { op: 'nag_done', task: t1 }), 'unknown');
  const t2 = await nag();
  assert.equal(await reply('jako:done:x3', m1, { op: 'nag_done', task: t2 }), 'not_open', 'the task is the reminder\'s own, whatever the plan names');
  const open = async (id) => (await db.query('select status, done_by_email from public.staff_tasks where id = $1', [id])).rows[0];
  assert.deepEqual([await open(t1), await open(t2)], [{ status: 'open', done_by_email: null }, { status: 'open', done_by_email: null }]);
  // Done: by her, in her name, through the function the app calls (the reminders of the task are marked read with it).
  assert.equal(await reply(`jako:done:${m1}`, m1, { op: 'nag_done', task: t1 }), 'done');
  assert.deepEqual(await open(t1), { status: 'done', done_by_email: 'irit@astrateg.test' });
  assert.equal((await db.query('select read_at is not null r from public.reminder_log where key = $1', [`nag:-:${t1}:s0@irit`])).rows[0].r, true);
  assert.equal(await reply(`jako:done:${m1}`, m1, { op: 'nag_done', task: t1 }), 'duplicate');
  // Another message of a task that is closed by now.
  const m1b = await message({ key: `nag:-:${t1}:s2@irit`, rule: 'nag', template: 'nodnik' });
  assert.equal(await reply(`jako:done:${m1b}`, m1b, { op: 'nag_done', task: t1 }), 'not_open');
  // A nagging task of someone else is not hers to close, even with a message to her.
  const t3 = await nag('ofir');
  const m3 = await message({ key: `nag:-:${t3}:s0@irit`, rule: 'nag', template: 'nodnik' });
  assert.equal(await reply(`jako:done:${m3}`, m3, { op: 'nag_done', task: t3 }), 'not_open');
  assert.equal((await open(t3)).status, 'open');
  // "אני על זה" on a nagging task: recorded as noted, the task stays open (it keeps ringing).
  const m2 = await message({ key: `nag:-:${t2}:s0@irit`, rule: 'nag', template: 'nodnik' });
  assert.equal(await reply('wamid.PRESS-ONIT', m2, { op: 'none', why: 'noted' }), 'noted');
  assert.equal((await open(t2)).status, 'open');
  // The key is the id of the press itself, as Jako's chat shows it: the same press again changes nothing.
  assert.equal(await reply('wamid.PRESS-DONE', m2, { op: 'nag_done', task: t2 }), 'done');
  assert.equal(await reply('wamid.PRESS-DONE', m2, { op: 'nag_done', task: t2 }), 'duplicate');
  // A reply whose message was only assumed (the last one with that button) says so in what is kept.
  const t5 = await nag();
  const m5 = await message({ key: `nag:-:${t5}:s0@irit`, rule: 'nag', template: 'nodnik' });
  assert.equal(await reply(`jako:onit:${m5}`, m5, { op: 'none', why: 'noted', match: 'last' }), 'noted');
  assert.equal(await reply(`jako:done:${m5}`, m5, { op: 'nag_done', task: t5, match: 'last' }), 'done');
  assert.deepEqual((await db.query('select id, result from public.whatsapp_inbound where message_id = $1 order by id', [m5])).rows,
    [{ id: `jako:done:${m5}`, result: 'done (last message)' }, { id: `jako:onit:${m5}`, result: 'noted (last message)' }]);
  // A simple client task and a process: exactly what Meta's replies do (public.whatsapp_apply).
  const { rows: [ct] } = await db.query("insert into public.client_tasks (client_id, title, owner, urgent, created_by_email) values ($1, 'להחליף לוגו', 'irit', true, 'lior@astrateg.test') returning id", [c.id]);
  const m4 = await message({ key: `urgent:c:${ct.id}:now@irit`, rule: 'urgent', template: 'nodnik', client: c.id });
  assert.equal(await reply(`jako:onit:${m4}`, m4, { op: 'task_start', task: ct.id }), 'started');
  assert.equal(await reply(`jako:done:${m4}`, m4, { op: 'task_done', task: ct.id }), 'done');
  assert.deepEqual((await db.query('select started_by_email, done_by_email from public.client_tasks where id = $1', [ct.id])).rows[0], { started_by_email: 'irit@astrateg.test', done_by_email: 'irit@astrateg.test' });
  // What is kept of a reply: the button and message it names, the operation and the result. No text.
  const kept = (await db.query("select id, op, result from public.whatsapp_inbound where id like 'jako:%' or id like 'wamid.PRESS%' order by received_at, id")).rows;
  assert.deepEqual(kept.map((r) => `${r.op} ${r.result}`).sort(), [
    'nag_done done', 'nag_done done', 'nag_done done (last message)', 'nag_done not_open', 'nag_done not_open', 'nag_done not_open',
    'none noted', 'none noted (last message)', 'none unknown', 'none unknown', 'task_done done', 'task_start started',
  ]);
});

test('a message is marked with its provider; Meta\'s rows are what they were', async () => {
  const { rows: [c] } = await db.query("insert into public.clients (name, shoot_type) values ('פיצה', 'dms') returning id");
  const add = async (key, extra = '', vals = '') => {
    const { rows: [l] } = await db.query("insert into public.reminder_log (key, rule, person, level, channel, status, title, client_id) values ($1, 'deal', 'irit', 'ring', 'push', 'sent', 'עסקה חדשה', $2) returning id", [key, c.id]);
    return db.query(`insert into public.whatsapp_messages (log_id, person, email, phone, template, status${extra}) values ($1, 'irit', 'irit@astrateg.test', '972501111111', 'due', 'sent'${vals}) returning provider, wa_message_id`, [l.id]);
  };
  assert.deepEqual((await add('deal:a:deal:now@irit')).rows[0], { provider: 'meta', wa_message_id: null });
  // Jako's rows have no message id: any number of them may be without one.
  assert.equal((await add('deal:b:deal:now@irit', ', provider', ", 'jako'")).rows[0].provider, 'jako');
  assert.equal((await add('deal:c:deal:now@irit', ', provider', ", 'jako'")).rows[0].provider, 'jako');
  await assert.rejects(add('deal:d:deal:now@irit', ', provider', ", 'twilio'"), /check/);
  const team = await q('owner', 'select person, sent, delivered, read from public.whatsapp_team_status()');
  // (Three here, and the seven of the replies' test above.)
  assert.deepEqual(team.find((r) => r.person === 'irit'), { person: 'irit', sent: 10, delivered: 0, read: 0 });
});

test('who is asked for replies: whoever agreed for the number they have, each at most once in five minutes, from where the last reading ended', async () => {
  await keep('irit', "select public.whatsapp_decide('whatsapp', 1)");
  await keep('ofir', "select public.whatsapp_decide('whatsapp', 1)");
  await keep('nadia', "select public.whatsapp_decide('push', 1)");
  await keep('owner', "select public.whatsapp_decide('whatsapp', 1, '050-222-2222')");
  await db.query("update public.staff set phone = '972509999999' where email = 'ofir@astrateg.test'"); // changed since he agreed
  await db.query("update public.whatsapp_consents set decided_at = now() - interval '1 hour'");
  const decided = Object.fromEntries((await db.query('select email, decided_at from public.whatsapp_consents')).rows.map((r) => [r.email, r.decided_at.toISOString()]));
  const due = (max = 5, every = 300) => keepSvc('select email, person, phone, since from public.whatsapp_poll_due($1, $2)', [max, every]);
  const first = await due();
  assert.deepEqual(first.map((r) => [r.email, r.person, r.phone, r.since.toISOString()]), [
    ['irit@astrateg.test', 'irit', '972501111111', decided['irit@astrateg.test']],
    ['owner@astrateg.test', 'owner', '972502222222', decided['owner@astrateg.test']],
  ]);
  // Asked: not again for five minutes (also when the reading failed and nothing was marked read).
  assert.deepEqual(await due(), []);
  await db.query("update public.whatsapp_poll set checked_at = now() - interval '4 minutes 50 seconds'");
  assert.deepEqual(await due(), []);
  await db.query("update public.whatsapp_poll set checked_at = now() - interval '6 minutes'");
  // A reading that failed left no mark: the next one starts from the same moment.
  const until = new Date(Date.now() - 60e3);
  await keepSvc('select public.whatsapp_poll_done($1, $2)', ['irit@astrateg.test', until.toISOString()]);
  const again = await due();
  assert.deepEqual(again.map((r) => [r.person, r.since.toISOString()]), [['irit', until.toISOString()], ['owner', decided['owner@astrateg.test']]]);
  // Read marks only move forward, and never past now.
  await keepSvc('select public.whatsapp_poll_done($1, $2)', ['irit@astrateg.test', new Date(until.getTime() - 3600e3).toISOString()]);
  assert.equal((await db.query("select read_until from public.whatsapp_poll where email = 'irit@astrateg.test'")).rows[0].read_until.toISOString(), until.toISOString());
  await keepSvc('select public.whatsapp_poll_done($1, $2)', ['irit@astrateg.test', '2099-01-01T00:00:00Z']);
  assert.ok((await db.query("select read_until <= now() ok from public.whatsapp_poll where email = 'irit@astrateg.test'")).rows[0].ok);
  await keepSvc("select public.whatsapp_poll_done('nobody@astrateg.test', now())");
  assert.equal((await db.query("select count(*)::int n from public.whatsapp_poll where email = 'nobody@astrateg.test'")).rows[0].n, 0);
  // At most p_max in one tick, whoever waited longest first; the pace has a floor of a minute.
  await db.query("update public.whatsapp_poll set checked_at = now() - interval '6 minutes' where email = 'irit@astrateg.test'");
  await db.query("update public.whatsapp_poll set checked_at = now() - interval '9 minutes' where email = 'owner@astrateg.test'");
  assert.deepEqual((await due(1)).map((r) => r.person), ['owner']);
  assert.deepEqual((await due(1)).map((r) => r.person), ['irit']);
  assert.deepEqual(await due(5, 0), []);
  // Agreeing again starts from the new consent: a "הסר" written before it is never read as one.
  await db.query("update public.whatsapp_poll set checked_at = now() - interval '6 minutes', read_until = now() - interval '2 days' where email = 'irit@astrateg.test'");
  const [irit] = (await due()).filter((r) => r.person === 'irit');
  assert.equal(irit.since.toISOString(), decided['irit@astrateg.test']);
});

test('"הסר" read from Jako withdraws the consent as the webhook does, once, and that person is asked no more', async () => {
  const stop = (inbound, from) => keepSvc("select public.whatsapp_apply($1, null, $2, '{\"op\":\"withdraw\"}') r", [inbound, from]).then((r) => r[0].r);
  assert.equal(await stop('jako:irit:904', '972501111111'), 'withdrawn');
  assert.equal(await stop('jako:irit:904', '972501111111'), 'duplicate');
  assert.equal(await stop('jako:irit:905', '972501111111'), 'not_found', 'already withdrawn');
  const { rows: [c] } = await db.query("select status, withdrawn_via from public.whatsapp_consents where email = 'irit@astrateg.test'");
  assert.deepEqual(c, { status: 'withdrawn', withdrawn_via: 'whatsapp' });
  const { rows: [l] } = await db.query("select action, via from public.whatsapp_consent_log where email = 'irit@astrateg.test' order by id desc limit 1");
  assert.deepEqual(l, { action: 'withdrawn', via: 'whatsapp' });
  // No text of the message anywhere: only its id, the operation and the result.
  assert.deepEqual((await db.query("select id, op, result from public.whatsapp_inbound where id like 'jako:irit:%' order by id")).rows, [
    { id: 'jako:irit:904', op: 'withdraw', result: 'withdrawn' }, { id: 'jako:irit:905', op: 'withdraw', result: 'not_found' },
  ]);
  await db.query("update public.whatsapp_poll set checked_at = now() - interval '6 minutes'");
  assert.deepEqual((await keepSvc('select person from public.whatsapp_poll_due(5, 300)')).map((r) => r.person), ['owner']);
});

test('back to Meta: off, the provider, on; Meta\'s secrets are asked for again and Jako\'s key stays in Vault unused', async () => {
  assert.match((await keep('owner', "select public.whatsapp_set_provider('meta')")).error, /switch_off_first/);
  await keep('owner', 'select public.whatsapp_set_enabled(false)');
  const s = (await keep('owner', "select public.whatsapp_set_provider('meta') s")).s;
  assert.deepEqual([s.provider, s.ready], ['meta', true]);
  assert.deepEqual(s.secrets, { access_token: true, phone_number_id: true, app_secret: true, verify_token: true });
  assert.equal((await keep('owner', 'select public.whatsapp_set_enabled(true) s')).s.enabled, true);
  assert.deepEqual((await svc('select * from public.whatsapp_config_v2()'))[0], { enabled: true, provider: 'meta', access_token: META[0][1], phone_number_id: '1234567890', jako_api_key: null, jako_flow_done: null, jako_flow_onit: null });
  assert.equal((await svc('select app_secret from public.whatsapp_webhook_secrets()'))[0].app_secret, META[2][1]);
  // The sub flows' secret is in Vault and is not given out: their calls get 503.
  assert.deepEqual((await svc('select * from public.whatsapp_jako_hook()'))[0], { provider: 'meta', hook_secret: null, jako_api_key: null });
  // The flows are kept for the day Jako is chosen again.
  assert.deepEqual((await db.query('select jako_flow_done, jako_flow_onit from public.whatsapp_provider')).rows[0], { jako_flow_done: 'f100s200', jako_flow_onit: 'f100s201' });
});

test('every new function pins its search path, and none is open to anon', async () => {
  const names = ['whatsapp_provider', 'whatsapp_jako_key_present', 'whatsapp_jako_hook_present', 'whatsapp_ready', 'whatsapp_set_provider', 'whatsapp_set_jako_flows', 'whatsapp_config_v2', 'whatsapp_jako_hook', 'whatsapp_jako_reply', 'whatsapp_poll_due', 'whatsapp_poll_done'];
  const { rows } = await db.query(`select p.proname, coalesce(array_to_string(p.proconfig, ','), '') cfg, has_function_privilege('anon', p.oid, 'execute') anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.proname = any($1) order by 1`, [names]);
  assert.deepEqual(rows.map((r) => r.proname), [...names].sort());
  for (const r of rows) assert.ok(r.cfg.includes('search_path=""') && !r.anon, r.proname);
  const open = await db.query(`select c.relname from pg_class c where c.relname in ('whatsapp_provider', 'whatsapp_poll')
    and (not c.relrowsecurity or has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))`);
  assert.deepEqual(open.rows, []);
});
