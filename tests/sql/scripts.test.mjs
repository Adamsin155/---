// The scripts (supabase/migrations/20261003120000_scripts.sql) in a real Postgres
// with every migration (tests/sql/pg.mjs): only Lior and the owner, and whoever they
// granted a client to, read and write a client's scripts; "approved" only by Lior or
// the owner, or by the client's approval of p13 (on the status page, approve_item);
// the version moves on with every save; the share link keeps a hash, the token in
// Vault, and the anonymous page gets only the scripts with text.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { wordingFor } from '../../app/status-logic.js';

let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', yariv: 'yariv' };

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, true)', [email, person]);
  }
  const add = async (name, fields = {}) => {
    const cols = ['name', ...Object.keys(fields)];
    const vals = [name, ...Object.values(fields)];
    const { rows } = await db.query(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals);
    ids[name] = rows[0].id;
  };
  await add('dana', { business: 'קפה דנה', phone: '050-1234567', notes: 'הערה פנימית', editor: 'nadia', deliverables: JSON.stringify({ videos: 25 }) });
  await add('gil', { deliverables: JSON.stringify({ videos: 42 }), rounds: JSON.stringify([{ n: 2, shoot_at: null }]) });
  await add('ended', { status: 'ended' });
});

const run = (who, fn) => as(db, who === 'anon' ? null : users[who], fn);
const q = (who, sql, params = []) => run(who, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows };
});
async function keep(who, sql, params = []) {
  const u = who === 'anon' ? null : users[who];
  const claims = u ? { sub: u.id, email: u.email, role: 'authenticated' } : { role: 'anon' };
  let out;
  await db.transaction(async (tx) => {
    await tx.query(`set local role ${u ? 'authenticated' : 'anon'}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'TestBrowser/1.0' })]);
    out = (await tx.query(sql, params)).rows;
  });
  return out;
}
const save = (who, client, n, fields, round = 1) => keep(who,
  `insert into public.client_scripts (client_id, round, n, title, body, links, status) values ($1, $2, $3, $4, $5, $6, $7)
   on conflict (client_id, round, n) do update set title = excluded.title, body = excluded.body, links = excluded.links, status = excluded.status
   returning *`,
  [ids[client], round, n, fields.title ?? '', fields.body ?? '', JSON.stringify(fields.links ?? []), fields.status ?? 'draft']);

test('Lior and the owner write any client\'s scripts; the office, editors and anon see nothing', async () => {
  const [row] = await save('lior', 'dana', 1, { title: 'פתיחה', body: 'דנה מגישה קפה', links: ['https://www.instagram.com/reel/abc'] });
  assert.equal(row.version, 1);
  assert.equal(row.by_email, 'lior@astrateg.test');
  const [again] = await save('owner', 'dana', 1, { title: 'פתיחה', body: 'דנה מגישה קפה ומחייכת', links: ['https://www.instagram.com/reel/abc'] });
  assert.equal(again.version, 2, 'every save moves the version on');
  assert.equal(again.by_email, 'owner@astrateg.test');
  for (const who of ['irit', 'ofir', 'ilai', 'nadia', 'yariv']) {
    assert.deepEqual((await q(who, 'select n from public.client_scripts')).rows, [], who);
    const w = await q(who, "insert into public.client_scripts (client_id, n, body) values ($1, 2, 'x')", [ids.dana]);
    assert.match(w.error, /row-level security/, who);
    assert.equal((await q(who, "update public.client_scripts set body = 'x'")).affected, 0, who);
    assert.equal((await q(who, 'select public.scripts_client($1) as c', [ids.dana])).rows[0].c, null, who);
    assert.equal((await q(who, 'select public.can_write_scripts($1) as ok', [ids.dana])).rows[0].ok, false, who);
  }
  assert.match((await q('anon', 'select 1 from public.client_scripts')).error, /permission denied/);
  assert.match((await q('anon', 'select public.scripts_client($1)', [ids.dana])).error, /permission denied/);
});

test('scripts_client: the package\'s video count and rounds, never the office\'s columns', async () => {
  const c = (await q('lior', 'select public.scripts_client($1) as c', [ids.dana])).rows[0].c;
  assert.equal(c.videos, 25);
  assert.equal(c.business, 'קפה דנה');
  assert.equal(c.manage, true);
  assert.ok(!JSON.stringify(c).includes('050-1234567') && !JSON.stringify(c).includes('הערה פנימית'));
  const g = (await q('owner', 'select public.scripts_client($1) as c', [ids.gil])).rows[0].c;
  assert.deepEqual([g.videos, g.rounds], [42, [2]]);
});

test('Lior grants a person one client: they write it (not "approved"), and nothing else', async () => {
  assert.match((await q('irit', 'select public.scripts_grant($1, $2)', [ids.dana, 'nadia'])).error, /not allowed/);
  assert.match((await q('lior', 'select public.scripts_grant($1, $2)', [ids.dana, 'nobody'])).error, /unknown person/);
  await keep('lior', 'select public.scripts_grant($1, $2)', [ids.dana, 'yariv']);
  assert.equal((await q('yariv', 'select public.can_write_scripts($1) as ok', [ids.dana])).rows[0].ok, true);
  assert.equal((await q('yariv', 'select public.can_write_scripts($1) as ok', [ids.gil])).rows[0].ok, false);
  const c = (await q('yariv', 'select public.scripts_client($1) as c', [ids.dana])).rows[0].c;
  assert.equal(c.manage, false);
  assert.equal(c.videos, 25);
  // Yariv still does not see the client itself (the grant opens the scripts only).
  assert.deepEqual((await q('yariv', 'select id from public.clients')).rows, []);
  // He writes and marks ready; "approved" is Lior's.
  const [r2] = await save('yariv', 'dana', 2, { title: 'טעימות', body: 'סמיון טועם', status: 'ready' });
  assert.equal(r2.by_email, 'yariv@astrateg.test');
  assert.match((await q('yariv', "update public.client_scripts set status = 'approved' where client_id = $1 and n = 2", [ids.dana])).error, /only Lior or the owner/);
  assert.match((await q('yariv', "insert into public.client_scripts (client_id, n, status) values ($1, 9, 'approved')", [ids.dana])).error, /only Lior or the owner/);
  assert.equal((await q('yariv', 'delete from public.client_scripts where client_id = $1', [ids.dana])).affected, 0, 'only managers remove');
  assert.equal((await q('yariv', 'select n from public.client_scripts order by n')).rows.length, 2);
  // He sees his own grant, not others'.
  await keep('owner', 'select public.scripts_grant($1, $2)', [ids.gil, 'nadia']);
  assert.deepEqual((await q('yariv', 'select person from public.script_grants')).rows.map((r) => r.person), ['yariv']);
  assert.equal((await q('lior', 'select person from public.script_grants')).rows.length, 2);
  // Taken back: nothing.
  await keep('lior', 'select public.scripts_grant($1, $2, false)', [ids.dana, 'yariv']);
  assert.deepEqual((await q('yariv', 'select n from public.client_scripts')).rows, []);
  assert.equal((await q('yariv', "update public.client_scripts set body = 'x'")).affected, 0);
});

test('links: https addresses only; the client, the round and the number never move', async () => {
  assert.match((await q('lior', "insert into public.client_scripts (client_id, n, links) values ($1, 5, '[\"javascript:alert(1)\"]')", [ids.dana])).error, /invalid inspiration link/);
  assert.match((await q('lior', "insert into public.client_scripts (client_id, n, links) values ($1, 5, '[3]')", [ids.dana])).error, /invalid inspiration link/);
  assert.match((await q('lior', 'insert into public.client_scripts (client_id, n) values ($1, 0)', [ids.dana])).error, /check/);
  const r = await q('lior', 'update public.client_scripts set n = 7, client_id = $2 where client_id = $1 and n = 1 returning n, client_id', [ids.dana, ids.gil]);
  assert.deepEqual([r.rows[0].n, r.rows[0].client_id], [1, ids.dana]);
});

test('Lior approves by hand; the client\'s approval of the scripts (p13) approves what is ready', async () => {
  await save('lior', 'dana', 3, { title: 'סיום', body: 'דנה מנופפת', status: 'ready' });
  await save('lior', 'dana', 4, { title: 'עוד לא', body: 'טיוטה' });
  // The status page: the scripts are ready for approval once 12 is marked.
  for (const k of ['p12.scripts', 'p12.numbered', 'p12.docs']) await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done')", [ids.dana, k]);
  const [{ l }] = await keep('lior', 'select public.status_link_create($1) as l', [ids.dana]);
  const s = (await keep('anon', 'select public.get_status($1) as s', [l.token]))[0].s;
  const it = s.items.find((i) => i.item === 'scripts');
  assert.equal(it.state, 'waiting');
  const wording = wordingFor('approve', { name: 'דנה כהן', business: 'קפה דנה', item: 'scripts', shootRound: 1, round: it.round });
  await keep('anon', 'select public.approve_item($1, $2, $3, $4)', [l.token, it.key, 'דנה כהן', wording]);
  const rows = (await db.query('select n, status from public.client_scripts where client_id = $1 order by n', [ids.dana])).rows;
  assert.deepEqual(rows.map((r) => `${r.n}:${r.status}`), ['1:draft', '2:approved', '3:approved', '4:draft']);
  // Lior marks a draft approved by hand, and can take it back.
  await keep('lior', "update public.client_scripts set status = 'approved' where client_id = $1 and n = 1", [ids.dana]);
  await keep('lior', "update public.client_scripts set status = 'ready' where client_id = $1 and n = 1", [ids.dana]);
  assert.equal((await db.query('select status from public.client_scripts where client_id = $1 and n = 1', [ids.dana])).rows[0].status, 'ready');
  // A shoot round's approval touches only that round.
  await save('owner', 'gil', 1, { body: 'סבב ראשון', status: 'ready' });
  await save('owner', 'gil', 1, { body: 'סבב שני', status: 'ready' }, 2);
  await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'r2.p13.approved', 'done')", [ids.gil]);
  const g = (await db.query('select round, status from public.client_scripts where client_id = $1 order by round', [ids.gil])).rows;
  assert.deepEqual(g.map((r) => `${r.round}:${r.status}`), ['1:ready', '2:approved']);
});

let token;
let linkId;
test('the share link: Lior and the owner only, a hash in the table, the token in Vault, a new one revokes the old', async () => {
  for (const who of ['irit', 'ofir', 'nadia']) {
    assert.match((await q(who, 'select public.scripts_share_create($1)', [ids.dana])).error, /not allowed/, who);
  }
  assert.match((await q('anon', 'select public.scripts_share_create($1)', [ids.dana])).error, /permission denied/);
  assert.match((await q('lior', 'select public.scripts_share_create($1)', [ids.ended])).error, /client not open/);
  const [{ l: first }] = await keep('lior', 'select public.scripts_share_create($1) as l', [ids.dana]);
  const [{ l }] = await keep('lior', 'select public.scripts_share_create($1) as l', [ids.dana]);
  token = l.token;
  linkId = l.id;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const rows = (await db.query('select id, token_hash, secret_id, revoked_at from public.script_share_links order by created_at')).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows[0].revoked_at && !rows[0].secret_id, 'the old one is revoked and its token left Vault');
  assert.notEqual(rows[1].token_hash, token);
  assert.equal((await q('lior', 'select public.scripts_share_token($1) as t', [l.id])).rows[0].t, token);
  assert.equal((await q('owner', 'select public.scripts_share_token($1) as t', [first.id])).rows[0].t, null);
  assert.match((await q('ofir', 'select public.scripts_share_token($1) as t', [l.id])).error, /not allowed/);
  assert.match((await q('lior', 'select token_hash from public.script_share_links')).error, /permission denied/);
  assert.equal((await q('ofir', 'select id from public.script_share_links')).rows.length, 0);
  assert.equal((await q('owner', 'select id from public.script_share_links')).rows.length, 2);
});

test('the read-only page: the scripts with text and their links, nothing internal', async () => {
  await save('lior', 'dana', 6, { title: '', body: '' });
  const s = (await keep('anon', 'select public.get_scripts($1) as s', [token]))[0].s;
  assert.equal(s.state, 'ok');
  assert.equal(s.preview, false);
  assert.equal(s.client.business, 'קפה דנה');
  assert.deepEqual(s.scripts.map((x) => x.n), [1, 2, 3, 4], 'an empty slot is left out');
  assert.deepEqual(s.scripts[0].links, ['https://www.instagram.com/reel/abc']);
  const text = JSON.stringify(s);
  for (const secret of ['050-1234567', 'הערה פנימית', '@astrateg', 'nadia', 'version', 'by_email']) assert.ok(!text.includes(secret), secret);
  assert.equal((await keep('lior', 'select public.get_scripts($1) as s', [token]))[0].s.preview, true);
  for (const bad of ['short', 'A'.repeat(43), null]) assert.equal((await keep('anon', 'select public.get_scripts($1) as s', [bad]))[0].s.state, 'invalid');
  // Revoked: the page says so, and the token is gone from Vault.
  await keep('lior', 'select public.scripts_share_revoke($1)', [linkId]);
  assert.equal((await keep('anon', 'select public.get_scripts($1) as s', [token]))[0].s.state, 'revoked');
  assert.equal((await db.query('select secret_id from public.script_share_links where id = $1', [linkId])).rows[0].secret_id, null);
  // A client that ended: closed.
  const [{ l }] = await keep('owner', 'select public.scripts_share_create($1) as l', [ids.dana]);
  await db.query("update public.clients set status = 'ended' where id = $1", [ids.dana]);
  assert.equal((await keep('anon', 'select public.get_scripts($1) as s', [l.token]))[0].s.state, 'closed');
  await db.query("update public.clients set status = 'active' where id = $1", [ids.dana]);
  // Expired.
  await db.query("update public.script_share_links set expires_at = now() - interval '1 minute' where id = $1", [l.id]);
  assert.equal((await keep('anon', 'select public.get_scripts($1) as s', [l.token]))[0].s.state, 'expired');
});

test('anon reaches only get_scripts; the tables are closed to anon', async () => {
  for (const t of ['client_scripts', 'script_grants', 'script_share_links']) {
    assert.match((await q('anon', `select 1 from public.${t}`)).error, /permission denied/, t);
  }
  for (const fn of ['public.scripts_grant($1, \'nadia\')', 'public.scripts_share_create($1)', 'public.can_write_scripts($1)']) {
    assert.match((await q('anon', `select ${fn}`, [ids.dana])).error, /permission denied/, fn);
  }
  // Nobody writes the link table directly.
  assert.match((await q('lior', "insert into public.script_share_links (client_id, token_hash, expires_at) values ($1, repeat('a', 64), now())", [ids.dana])).error, /permission denied/);
  assert.match((await q('lior', "insert into public.script_grants (client_id, person) values ($1, 'nadia')", [ids.dana])).error, /permission denied/);
});

test('the migration runs again safely, keeping the scripts, grants and links', async () => {
  const count = async () => (await db.query(`select (select count(*) from public.client_scripts)::int as s,
    (select count(*) from public.script_grants)::int as g, (select count(*) from public.script_share_links)::int as l`)).rows[0];
  const before = await count();
  await db.exec(migrationSql('20261003120000_scripts.sql'));
  assert.deepEqual(await count(), before);
});
