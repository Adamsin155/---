// The content Gantt after the owner's decisions of 6.10.2026, in a real Postgres (PGlite,
// every migration applied): 20261007100000_gantt_roles_statuses.sql,
// 20261007100100_metricool.sql and 20261007100200_metricool_cron.sql.
//  A. Ilai and the owner change the Gantt; Irit, Lior and Ofir read it and still make
//     the client's link; everyone else as before.
//  C. The states (scheduled, error), who set them (`source`), and the client's link:
//     planned / scheduled / posted only.
//  D. Metricool: the two Vault secrets (read by the service role only), the owner's
//     switch that cannot go on while one is missing, a client's brand, the sync's
//     writes (only through gantt_sync_apply), its last-run line, and the 15-minute clock.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { planSync, parsePosts, windowOf } from '../../app/metricool-logic.js';

const FILES = ['20261007100000_gantt_roles_statuses.sql', '20261007100100_metricool.sql', '20261007100200_metricool_cron.sql'];
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', anna: 'anna', stav: 'stav' };
const DENIED = /row-level security|violates|permission denied|not allowed/i;
let db;
const users = {};
const ids = {};

const run = (who, sql, params = []) => as(db, who ? users[who] : null, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows ?? r.rows.length };
});
// The same, kept (committed).
async function keep(who, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users[who].id, email: users[who].email, role: 'authenticated' })]);
    return (await tx.query(sql, params)).rows;
  });
}
// As the edge function: the service role, no user.
async function svc(sql, params = [], { commit = false } = {}) {
  let out;
  await db.transaction(async (tx) => {
    await tx.query('set local role service_role');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'service_role' })]);
    try { out = (await tx.query(sql, params)).rows; } catch (err) { out = { error: err.message }; }
    if (!commit || out.error) await tx.rollback();
  });
  return out;
}
const rowsOf = async (client) => (await db.query(
  "select id, key, kind, title, day::text, to_char(time_il, 'HH24:MI') as time_il, internal, state, posted_on::text, link, edited, source, mc_post_id, mc_status, mc_at, mc_networks, mc_error, mc_extra, by_email from public.client_gantt where client_id = $1 order by day, key", [client])).rows;

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  const add = async (name, editor) => (await db.query(
    "insert into public.clients (name, business, shoot_type, editor, status, deal_at, contract_end) values ($1, $1, 'dms', $2, 'active', '2026-03-15 08:00+00', '2027-03-15') returning id", [name, editor])).rows[0].id;
  ids.a = await add('מספרת רון', 'nadia');
  ids.b = await add('קפה נדיה', 'yariv');
});

// ── A ───────────────────────────────────────
test('A. Ilai and the owner change the Gantt; Irit, Lior and Ofir only read it, and still make the client\'s link', async () => {
  const can = async (who) => (await run(who, 'select public.can_edit_gantt() as ok')).rows[0].ok;
  assert.deepEqual(await Promise.all(Object.keys(PEOPLE).map(can)), [true, false, false, false, true, false, false, false]);
  assert.match((await run(null, 'select public.can_edit_gantt()')).error, /permission denied/);
  const INS = "insert into public.client_gantt (client_id, key, kind, title, day, time_il) values ($1, $2, 'video', 'סרטון', '2026-11-15', '19:00') returning key";
  await keep('ilai', INS, [ids.a, 'video.30']);
  await keep('owner', INS, [ids.a, 'video.31']);
  for (const who of ['irit', 'lior', 'ofir', 'nadia', 'anna', 'stav']) {
    assert.match((await run(who, INS, [ids.a, 'video.99'])).error, DENIED, who);
    assert.equal((await run(who, "update public.client_gantt set state = 'posted'")).affected, 0, who);
    assert.equal((await run(who, 'delete from public.client_gantt')).affected, 0, who);
  }
  for (const who of ['owner', 'ilai', 'irit', 'lior', 'ofir', 'nadia']) assert.equal((await run(who, 'select key from public.client_gantt')).rows.length, 2, who);
  for (const who of ['anna', 'stav']) assert.equal((await run(who, 'select key from public.client_gantt')).rows.length, 0, who);
  // The client's link stays with the office: made, read again and revoked by Irit, Lior or Ofir.
  for (const who of ['irit', 'lior', 'ofir', 'ilai', 'owner']) {
    const out = await as(db, users[who], async (tx) => {
      const l = (await tx.query('select public.gantt_link_create($1) as l', [ids.a])).rows[0].l;
      const t = (await tx.query('select public.gantt_link_token($1) as t', [l.id])).rows[0].t;
      await tx.query('select public.gantt_link_revoke($1)', [l.id]);
      return t === l.token;
    });
    assert.equal(out, true, who);
  }
  for (const who of ['nadia', 'stav']) assert.match((await run(who, 'select public.gantt_link_create($1)', [ids.a])).error, DENIED, who);
  // Exactly its own four rules (the archive rule is a restrictive fifth).
  const pol = (await db.query("select policyname from pg_policies where tablename = 'client_gantt' and permissive = 'PERMISSIVE' order by 1")).rows.map((r) => r.policyname);
  assert.deepEqual(pol, ['gantt editors add entries', 'gantt editors change entries', 'gantt editors remove entries', 'gantt of own clients']);
});

// ── C ───────────────────────────────────────
test('C. the states: scheduled and error are stored, "חסר" is not a state; a person\'s mark is manual and cannot set the sync\'s columns', async () => {
  for (const state of ['planned', 'scheduled', 'posted', 'error', 'skipped']) {
    const r = await run('ilai', "update public.client_gantt set state = $1 where key = 'video.30' returning state, posted_on is not null as has_day, source", [state]);
    assert.deepEqual(r.rows, [{ state, has_day: state === 'posted', source: 'manual' }], state);
  }
  for (const state of ['missing', 'late', 'done']) assert.match((await run('ilai', "update public.client_gantt set state = $1 where key = 'video.30'", [state])).error, /check constraint/, state);
  // Whatever the browser sends, the sync's columns are not a person's to write.
  const forged = await run('ilai', `insert into public.client_gantt (client_id, key, kind, title, day, source, mc_post_id, mc_status, mc_extra, mc_error)
    values ($1, 'custom.5', 'custom', 'x', '2026-11-20', 'metricool', '123', 'published', true, 'x') returning source, mc_post_id, mc_status, mc_extra, mc_error`, [ids.a]);
  assert.deepEqual(forged.rows, [{ source: 'manual', mc_post_id: null, mc_status: null, mc_extra: false, mc_error: null }]);
  const up = await run('owner', "update public.client_gantt set source = 'metricool', mc_post_id = '5', mc_status = 'pending' where key = 'video.30' returning source, mc_post_id, mc_status");
  assert.deepEqual(up.rows, [{ source: 'manual', mc_post_id: null, mc_status: null }]);
});

test('C. the client\'s link shows planned / scheduled / posted only: a failure reads as planned, a scheduled post whose time has passed as posted', async () => {
  const add = (key, day, time, state) => db.query('insert into public.client_gantt (client_id, key, kind, title, day, time_il, state) values ($1, $2, $3, $2, $4, $5, $6)', [ids.b, key, 'video', day, time, state]);
  await add('video.1', '2026-01-10', '19:00', 'scheduled');   // long past: it went up by itself
  await add('video.2', '2035-01-10', '19:00', 'scheduled');   // ahead
  await add('video.3', '2026-01-11', '19:00', 'error');
  await add('video.4', '2026-01-12', '19:00', 'planned');     // "חסר" for the team; planned for the client
  await add('video.5', '2026-01-13', null, 'posted');
  await add('video.6', '2026-01-14', null, 'scheduled');      // no time: from noon of its day
  const link = (await keep('irit', 'select public.gantt_link_create($1) as l', [ids.b]))[0].l;
  const g = (await run(null, 'select public.get_gantt($1) as g', [link.token])).rows[0].g;
  assert.deepEqual(g.entries.map((e) => [e.key, e.state, e.postedOn ?? null]), [
    ['video.1', 'posted', '2026-01-10'], ['video.3', 'planned', null], ['video.4', 'planned', null],
    ['video.5', 'posted', g.entries.find((e) => e.key === 'video.5').postedOn], ['video.6', 'posted', '2026-01-14'], ['video.2', 'scheduled', null],
  ]);
  assert.ok(!/error|missing|mc_|source|metricool/.test(JSON.stringify(g)));
  // The stored fact stays: it was scheduled.
  assert.equal((await db.query("select state from public.client_gantt where client_id = $1 and key = 'video.1'", [ids.b])).rows[0].state, 'scheduled');
  await db.query('delete from public.client_gantt where client_id = $1', [ids.b]);
});

// ── D ───────────────────────────────────────
test('D. the switch: off by default, the owner\'s, and it cannot go on while a secret is missing; secrets are named, never shown', async () => {
  const settings = async (who) => (await run(who, 'select public.metricool_settings() as s')).rows?.[0]?.s;
  const s0 = await settings('owner');
  assert.deepEqual([s0.enabled, s0.owner, s0.canEdit, s0.secrets, s0.mapped], [false, true, true, { user_token: false, user_id: false }, 0]);
  assert.deepEqual([(await settings('irit')).owner, (await settings('irit')).canEdit, (await settings('ilai')).canEdit], [false, false, true]);
  for (const who of ['nadia', 'stav']) assert.equal(await settings(who), null, who);
  assert.match((await run(null, 'select public.metricool_settings()')).error, /permission denied/);
  for (const who of ['irit', 'ilai', 'lior', 'nadia']) assert.match((await run(who, 'select public.metricool_set_enabled(true)')).error, /owner only/, who);
  assert.match((await run('owner', 'select public.metricool_set_enabled(true)')).error, /not_ready/);
  // One secret is not enough; a user id that is not a number does not count.
  await db.query("select vault.create_secret('TOKEN-abcdefghij-0123456789', 'metricool_user_token', 'metricool: API token')");
  assert.match((await run('owner', 'select public.metricool_set_enabled(true)')).error, /not_ready/);
  await db.query("select vault.create_secret('not a number', 'metricool_user_id', 'metricool: user id')");
  assert.deepEqual((await settings('owner')).secrets, { user_token: true, user_id: false });
  await db.query("select vault.update_secret(id, ' 4455 ') from vault.secrets where name = 'metricool_user_id'");
  assert.deepEqual((await settings('irit')).secrets, { user_token: true, user_id: true });
  // Nobody signed in reads the secrets, by any way; the service role does, trimmed.
  for (const who of ['owner', 'irit', 'ilai']) {
    assert.match((await run(who, 'select * from public.metricool_config()')).error, /permission denied/, who);
    assert.match((await run(who, 'select * from vault.decrypted_secrets')).error, /permission denied/, who);
    assert.ok(!JSON.stringify(await settings(who)).includes('TOKEN-'), who);
  }
  assert.deepEqual(await svc('select * from public.metricool_config()'), [{ enabled: false, user_token: 'TOKEN-abcdefghij-0123456789', user_id: '4455' }]);
  // On, by the owner; anyone on staff reads the flag; nobody writes it directly.
  const on = (await keep('owner', 'select public.metricool_set_enabled(true) as s'))[0].s;
  assert.equal(on.enabled, true);
  assert.deepEqual((await run('nadia', "select value from public.app_settings where key = 'metricool_enabled'")).rows, [{ value: true }]);
  assert.match((await run('owner', "update public.app_settings set value = 'false' where key = 'metricool_enabled'")).error, /permission denied/);
  assert.match((await db.query("insert into public.app_settings (key, value) values ('anything', 'true')").catch((e) => ({ error: e.message }))).error, /check constraint/);
  assert.equal((await svc('select enabled from public.metricool_config()'))[0].enabled, true);
});

test('D. a client\'s brand: Ilai or the owner connects it; one brand, one client; everyone who sees the client reads it', async () => {
  for (const who of ['irit', 'lior', 'ofir', 'nadia', 'stav']) assert.match((await run(who, "select public.gantt_set_brand($1, '101', 'מספרת רון')", [ids.a])).error, DENIED, who);
  assert.match((await run(null, "select public.gantt_set_brand($1, '101', 'x')", [ids.a])).error, /permission denied/);
  for (const bad of ['abc', '12 34', "1'; drop", '1234567890123']) assert.match((await run('ilai', 'select public.gantt_set_brand($1, $2)', [ids.a, bad])).error, /bad brand id/, bad);
  assert.match((await run('ilai', "select public.gantt_set_brand($1, '101')", [crypto.randomUUID()])).error, /client not found/);
  assert.deepEqual((await keep('ilai', "select public.gantt_set_brand($1, ' 101 ', '  מספרת רון  ') as b", [ids.a]))[0].b, { blogId: '101', brand: 'מספרת רון' });
  assert.match((await run('owner', "select public.gantt_set_brand($1, '101', 'x')", [ids.b])).error, /brand_taken/);
  await keep('owner', "select public.gantt_set_brand($1, '102', 'Cafe Nadia')", [ids.b]);
  for (const who of ['irit', 'nadia']) assert.deepEqual((await run(who, 'select metricool_blog_id, metricool_brand from public.clients where id = $1', [ids.a])).rows, [{ metricool_blog_id: '101', metricool_brand: 'מספרת רון' }], who);
  assert.equal((await run('owner', 'select public.metricool_settings() as s')).rows[0].s.mapped, 2);
});

test('D. the sync writes only through gantt_sync_apply (service role): the marks, the extra rows, the last-run line; twice changes nothing', async () => {
  for (const who of ['owner', 'ilai', 'irit']) assert.match((await run(who, "select public.gantt_sync_apply($1, '{}', true)", [ids.a])).error, /permission denied/, who);
  await db.query("update public.client_gantt set state = 'planned' where client_id = $1", [ids.a]);
  await db.query("insert into public.client_gantt (client_id, key, kind, title, day, time_il, state) values ($1, 'graphic.9', 'graphic', 'גרפיקה 9', '2026-11-10', '13:00', 'posted')", [ids.a]);
  const post = (id, dateTime, status, extra = {}) => ({ id, publicationDate: { dateTime, timezone: 'Asia/Jerusalem' }, text: `פוסט ${id}`, media: ['https://x/v.mp4'], instagramData: { type: 'REEL' }, providers: [{ network: 'instagram', status, ...extra }] });
  const listing = { data: [
    post(1, '2026-11-15T20:30:00', 'PENDING'),
    post(2, '2026-11-18T19:00:00', 'PENDING'),                 // no entry that day: an extra row
    { ...post(3, '2026-11-10T13:00:00', 'PUBLISHED', { publicUrl: 'https://www.instagram.com/p/g9' }), instagramData: { type: 'POST' }, media: ['https://x/a.jpg'] },
  ] };
  const now = new Date('2026-11-12T08:00:00Z');
  const plan = async () => planSync({ rows: await rowsOf(ids.a), posts: parsePosts(listing).posts, window: windowOf(now), complete: true });
  const p1 = await plan();
  const res = await svc('select public.gantt_sync_apply($1, $2, true, null, $3) as r', [ids.a, JSON.stringify({ update: p1.update, insert: p1.insert, remove: p1.remove }), JSON.stringify(p1.stats)], { commit: true });
  assert.deepEqual(res[0].r, { updated: 2, inserted: 1, removed: 0 });
  const rows = await rowsOf(ids.a);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual([by['video.30'].state, by['video.30'].source, by['video.30'].time_il, by['video.30'].edited, by['video.30'].mc_post_id, by['video.30'].mc_status, by['video.30'].mc_networks, by['video.30'].by_email],
    ['scheduled', 'metricool', '20:30', true, '1', 'pending', ['instagram'], 'system']);
  // A mark a person made stays theirs: only the post's link fills the empty one.
  assert.deepEqual([by['graphic.9'].state, by['graphic.9'].source, by['graphic.9'].link, by['graphic.9'].mc_post_id], ['posted', 'manual', 'https://www.instagram.com/p/g9', '3']);
  assert.deepEqual([by['mc.2'].kind, by['mc.2'].title, by['mc.2'].state, by['mc.2'].source, by['mc.2'].mc_extra, by['mc.2'].internal], ['custom', 'פוסט 2', 'scheduled', 'metricool', true, false]);
  assert.deepEqual([by['video.31'].state, by['video.31'].mc_post_id], ['planned', null]);
  // Twice: nothing to write.
  const p2 = await plan();
  assert.deepEqual([p2.update, p2.insert, p2.remove], [[], [], []]);
  // The last run, for the Gantt page: the office and the client's editor read it; nobody writes it.
  for (const who of ['ilai', 'irit', 'nadia']) {
    const s = (await run(who, 'select ok, error, stats from public.client_gantt_sync where client_id = $1', [ids.a])).rows;
    assert.deepEqual([s[0].ok, s[0].error, s[0].stats.matched, s[0].stats.extras], [true, null, 2, 1], who);
  }
  assert.deepEqual((await run('anna', 'select * from public.client_gantt_sync')).rows, []);
  assert.match((await run('owner', 'delete from public.client_gantt_sync')).error, /permission denied/);
  assert.match((await run(null, 'select * from public.client_gantt_sync')).error, /permission denied/);
  // A failed run keeps the last good counts next to its error, and writes no row of the Gantt.
  await svc("select public.gantt_sync_apply($1, '{}', false, 'rate_limited', '{}')", [ids.a], { commit: true });
  const failed = (await db.query('select ok, error, stats from public.client_gantt_sync where client_id = $1', [ids.a])).rows[0];
  assert.deepEqual([failed.ok, failed.error, failed.stats.matched], [false, 'rate_limited', 2]);
  const st = (await run('owner', 'select public.metricool_settings() as s')).rows[0].s;
  assert.deepEqual([st.mapped, st.synced, st.failed, st.lastError], [2, 0, 1, 'rate_limited']);
  // Only what the function names is ever written: a forged op cannot touch another client, a note or the kind.
  await db.query("insert into public.client_gantt (client_id, key, kind, title, day, note) values ($1, 'video.1', 'video', 'שלהם', '2026-11-15', 'הערה')", [ids.b]);
  const other = (await db.query("select id from public.client_gantt where client_id = $1 and key = 'video.1'", [ids.b])).rows[0].id;
  const forged = { update: [{ id: other, fields: { state: 'posted' } }, { id: by['video.31'].id, fields: { note: 'x', kind: 'plan', internal: true, client_id: ids.b } }], remove: [by['video.31'].id, other] };
  assert.deepEqual((await svc('select public.gantt_sync_apply($1, $2, true) as r', [ids.a, JSON.stringify(forged)], { commit: true }))[0].r, { updated: 1, inserted: 0, removed: 0 });
  assert.equal((await db.query('select state from public.client_gantt where id = $1', [other])).rows[0].state, 'planned');
  const v31 = (await db.query("select note, kind, internal, client_id from public.client_gantt where id = $1", [by['video.31'].id])).rows[0];
  assert.deepEqual(v31, { note: null, kind: 'video', internal: false, client_id: ids.a });
});

test('D. after the sync: a person\'s change makes the mark theirs; a removed post takes back only the sync\'s; a brand taken away clears them', async () => {
  // Ilai marks the synced video as posted by hand: manual from now on, the link to the post kept.
  const mine = (await keep('ilai', "update public.client_gantt set state = 'posted' where client_id = $1 and key = 'video.30' returning state, source, mc_post_id", [ids.a]))[0];
  assert.deepEqual(mine, { state: 'posted', source: 'manual', mc_post_id: '1' });
  // Everything left Metricool: the manual marks stay, the untouched extra row goes.
  const now = new Date('2026-11-12T08:00:00Z');
  const p = planSync({ rows: await rowsOf(ids.a), posts: [], window: windowOf(now), complete: true });
  await svc('select public.gantt_sync_apply($1, $2, true, null, $3)', [ids.a, JSON.stringify({ update: p.update, insert: p.insert, remove: p.remove }), JSON.stringify(p.stats)], { commit: true });
  const rows = await rowsOf(ids.a);
  assert.deepEqual(rows.map((r) => [r.key, r.state, r.source, r.mc_post_id]), [['graphic.9', 'posted', 'manual', null], ['video.30', 'posted', 'manual', null], ['video.31', 'planned', 'manual', null]]);
  // Scheduled by the sync, then the brand is taken away: back to planned, the extra rows gone, the run line gone.
  const listing = { data: [{ id: 7, publicationDate: { dateTime: '2026-11-16T19:00:00', timezone: 'Asia/Jerusalem' }, text: 'x', media: ['https://x/v.mp4'], providers: [{ network: 'tiktok', status: 'PENDING' }] },
    { id: 8, publicationDate: { dateTime: '2026-11-19T19:00:00', timezone: 'Asia/Jerusalem' }, text: 'נוסף', media: ['https://x/v.mp4'], providers: [{ network: 'tiktok', status: 'PENDING' }] }] };
  await db.query("update public.client_gantt set day = '2026-11-16' where client_id = $1 and key = 'video.31'", [ids.a]);
  const p2 = planSync({ rows: await rowsOf(ids.a), posts: parsePosts(listing).posts, window: windowOf(now), complete: true });
  await svc('select public.gantt_sync_apply($1, $2, true, null, $3)', [ids.a, JSON.stringify({ update: p2.update, insert: p2.insert, remove: p2.remove }), JSON.stringify(p2.stats)], { commit: true });
  assert.deepEqual((await rowsOf(ids.a)).filter((r) => r.mc_post_id).map((r) => [r.key, r.state, r.source]), [['video.31', 'scheduled', 'metricool'], ['mc.8', 'scheduled', 'metricool']]);
  await keep('owner', 'select public.gantt_set_brand($1, null)', [ids.a]);
  const cleared = await rowsOf(ids.a);
  assert.deepEqual(cleared.map((r) => r.key).sort(), ['graphic.9', 'video.30', 'video.31']);
  assert.deepEqual(cleared.find((r) => r.key === 'video.31').state, 'planned');
  assert.equal(cleared.every((r) => r.mc_post_id === null && r.mc_status === null && !r.mc_extra), true);
  assert.deepEqual([cleared.find((r) => r.key === 'video.30').state, cleared.find((r) => r.key === 'graphic.9').link], ['posted', 'https://www.instagram.com/p/g9']);
  assert.equal((await db.query('select count(*)::int as n from public.client_gantt_sync where client_id = $1', [ids.a])).rows[0].n, 0);
  assert.deepEqual((await db.query('select metricool_blog_id, metricool_brand from public.clients where id = $1', [ids.a])).rows, [{ metricool_blog_id: null, metricool_brand: null }]);
});

test('D. the clock: every 15 minutes, with the cron secret from Vault, only while the switch is on and not at night', async () => {
  assert.deepEqual((await db.query("select jobname, schedule, command from cron.job where jobname = 'metricool-sync'")).rows, [{ jobname: 'metricool-sync', schedule: '*/15 * * * *', command: 'select public.metricool_tick()' }]);
  for (const who of ['owner', 'ilai']) assert.match((await run(who, 'select public.metricool_tick()')).error, /permission denied/, who);
  assert.match((await svc('select public.metricool_tick()')).error, /permission denied/);
  const calls = async () => (await db.query("select count(*)::int as n from net.calls where url like '%/functions/v1/metricool'")).rows[0].n;
  const night = Number((await db.query("select extract(hour from (now() at time zone 'Asia/Jerusalem'))::int as h")).rows[0].h) < 6;
  // On (the earlier test), but no cron secret yet: nothing is called.
  assert.equal((await db.query('select public.metricool_tick() as id')).rows[0].id, null);
  assert.equal(await calls(), 0);
  await db.query("select vault.create_secret($1, 'reminders_cron_secret')", ['c'.repeat(40)]);
  const id = (await db.query('select public.metricool_tick() as id')).rows[0].id;
  if (night) {
    assert.equal(id, null, 'between 00:00 and 06:00 in Israel nothing is called');
  } else {
    const call = (await db.query('select method, url, body, headers from net.calls where id = $1', [id])).rows[0];
    assert.deepEqual([call.method, call.url, call.body], ['POST', 'https://czncjzziqrqtezpwxxpz.supabase.co/functions/v1/metricool', { action: 'sync' }]);
    assert.equal(call.headers['x-cron-secret'], 'c'.repeat(40));
    assert.ok(!JSON.stringify(call).includes('TOKEN-'), 'the Metricool token never travels in the call');
  }
  // Off: nothing more is called, at any hour.
  const before = await calls();
  await keep('owner', 'select public.metricool_set_enabled(false)');
  assert.equal((await db.query('select public.metricool_tick() as id')).rows[0].id, null);
  assert.equal(await calls(), before);
  // The night rule itself, whatever the hour of this run.
  assert.match(migrationSql(FILES[2]), /extract\(hour from \(now\(\) at time zone 'Asia\/Jerusalem'\)\) < 6/);
});

test('anon runs nothing of it; the tables have row level security; the three migrations are safe to run again', async () => {
  const { rows } = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname ~ 'metricool|gantt_sync|gantt_set|can_edit_gantt' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
  assert.deepEqual(rows, []);
  const svcOnly = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('metricool_config', 'gantt_sync_apply') and has_function_privilege('authenticated', p.oid, 'execute')`)).rows;
  assert.deepEqual(svcOnly, []);
  assert.equal((await db.query("select relrowsecurity from pg_class where relname = 'client_gantt_sync'")).rows[0].relrowsecurity, true);
  const again = await freshDatabase();
  await again.query("insert into public.clients (name) values ('x')");
  await again.query("insert into public.client_gantt (client_id, key, kind, title, day, state) select id, 'video.1', 'video', 't', '2026-05-01', 'scheduled' from public.clients");
  for (const f of [...FILES, ...FILES]) await again.exec(migrationSql(f));
  assert.equal((await again.query('select state, source from public.client_gantt')).rows[0].state, 'scheduled');
  assert.equal((await again.query("select count(*)::int as n from cron.job where jobname = 'metricool-sync'")).rows[0].n, 1);
  assert.equal((await again.query("select count(*)::int as n from pg_policies where tablename = 'client_gantt' and permissive = 'PERMISSIVE'")).rows[0].n, 4);
  // The Gantt's first migration run again brings the old write rules back; this one after it removes them again.
  await again.exec(migrationSql('20261003130000_content_gantt.sql'));
  await again.exec(migrationSql(FILES[0]));
  assert.equal((await again.query("select count(*)::int as n from pg_policies where tablename = 'client_gantt' and policyname like 'office %'")).rows[0].n, 0);
  assert.ok(migrationFiles().filter((f) => f >= '20261007100000' && f <= '20261007109999').every((f) => FILES.includes(f)));
  await again.close();
});
