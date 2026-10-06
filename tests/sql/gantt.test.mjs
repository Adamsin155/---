// The content Gantt in a real Postgres (PGlite, every migration applied):
// supabase/migrations/20261003130000_content_gantt.sql and 20261003130100_gantt_file_fk.sql.
//  - client_gantt: the office (Ilai too) reads and writes; whoever else sees the
//    client (its editor) only reads; nobody else, not anon. Who and when from the
//    session; the key, link and kind shapes; internal kinds; the day it went up.
//  - client_files (20261003110000_client_files.sql): a file must be the client's own
//    and exist (a foreign key, set to null when the file row goes), and the client's
//    link shows the file's link, never its path.
//  - The client's read-only link: created by the office, the token in Vault, get_gantt
//    for anon without internal entries or notes; revoked, expired, closed, invalid.
//  - Safe to run again.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { GANTT_KINDS } from '../../app/gantt-template.js';
import { generatePlan } from '../../app/gantt-logic.js';

const MIGRATION = '20261003130000_content_gantt.sql';
const FK_MIGRATION = '20261003130100_gantt_file_fk.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', anna: 'anna' };
const RLS = /row-level security|violates|permission denied|not allowed/i;
let db;
const users = {};
const ids = {};

// A file row of public.client_files, with a path of the shape that table requires.
const addFile = async (client, kind, name, link = null) => (await db.query(
  'insert into public.client_files (client_id, kind, label, storage_path, link) values ($1, $2, $3, $4, $5) returning id',
  [client, kind, name, `${client}/${kind}/${crypto.randomUUID()}-${name}`, link])).rows[0].id;

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, true)', [email, person]);
  }
  const add = async (name, editor, status = 'active') => (await db.query(
    "insert into public.clients (name, business, shoot_type, editor, status, deal_at, contract_end) values ($1, $1, 'dms', $2, $3, '2026-03-15 08:00+00', '2027-03-15') returning id",
    [name, editor, status])).rows[0].id;
  ids.edited = await add('קפה נדיה', 'nadia');
  ids.other = await add('מאפייה', 'yariv');
  ids.ended = await add('נגמר', null, 'ended');
});

const run = (who, sql, params = []) => as(db, who ? users[who] : null, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows ?? r.rows.length };
});
const INSERT = "insert into public.client_gantt (client_id, key, kind, title, day, time_il, by_email, at) values ($1, $2, $3, $4, '2026-05-03', '19:00', 'x@y', '2000-01-01') returning by_email, at > now() - interval '1 minute' as fresh, internal";

test('Ilai and the owner write the plan, stamped by the session; the rest of the office and an editor read only; nobody else, not anon', async () => {
  for (const who of ['owner', 'ilai']) {
    const r = await run(who, INSERT, [ids.edited, 'video.1', 'video', 'סרטון 1']);
    assert.equal(r.rows?.[0]?.by_email, `${who}@astrateg.test`, who);
    assert.equal(r.rows[0].fresh, true, who);
  }
  // 6.10.2026 (20261007100000): Irit, Lior and Ofir only read; they still make the client's link (below).
  for (const who of ['irit', 'lior', 'ofir', 'nadia', 'anna']) assert.match((await run(who, INSERT, [ids.edited, 'video.1', 'video', 'x'])).error, RLS, who);
  assert.match((await run(null, INSERT, [ids.edited, 'video.1', 'video', 'x'])).error, RLS);
  await db.query("insert into public.client_gantt (client_id, key, kind, title, day) values ($1, 'video.1', 'video', 'סרטון 1', '2026-05-03'), ($2, 'video.1', 'video', 'סרטון 1', '2026-05-03')", [ids.edited, ids.other]);
  // Nadia edits the first client: she reads its plan, and only it; Anna nothing; anon nothing.
  assert.deepEqual((await run('nadia', 'select client_id from public.client_gantt')).rows.map((r) => r.client_id), [ids.edited]);
  assert.deepEqual((await run('anna', 'select * from public.client_gantt')).rows, []);
  assert.match((await run(null, 'select * from public.client_gantt')).error, RLS);
  assert.equal((await run('ilai', 'select * from public.client_gantt')).rows.length, 2);
  // Nadia cannot move or remove; Ilai can; nobody empties the table.
  assert.equal((await run('nadia', "update public.client_gantt set day = '2026-05-04'")).affected, 0);
  assert.equal((await run('nadia', 'delete from public.client_gantt')).affected, 0);
  assert.equal((await run('ilai', "update public.client_gantt set day = '2026-05-04', edited = true where client_id = $1 returning id", [ids.edited])).affected, 1);
  assert.match((await run('irit', 'truncate public.client_gantt')).error, RLS);
  for (const who of ['irit', 'lior', 'ofir']) {
    assert.equal((await run(who, 'select * from public.client_gantt')).rows.length, 2, who);
    assert.equal((await run(who, "update public.client_gantt set day = '2026-05-04'")).affected, 0, who);
    assert.equal((await run(who, 'delete from public.client_gantt')).affected, 0, who);
  }
  assert.equal((await run('owner', 'delete from public.client_gantt where client_id = $1', [ids.other])).affected, 1);
  await db.query('delete from public.client_gantt');
});

test('the shapes: every key and kind the template makes is accepted; bad keys, kinds and links are not', async () => {
  const plan = generatePlan({ deal_at: '2026-03-15T08:00:00Z', contract_end: '2027-03-15', deliverables: { videos: 42, graphics: 42, shoot_days: 2, collabs: 3, stories: 3, ch14: 1, monthly: 96 } });
  const kinds = new Set(plan.entries.map((e) => e.kind));
  assert.ok(kinds.size >= 12);
  const values = plan.entries.map((e, i) => `($1, '${e.key}', '${e.kind}', $${i + 2}, '${e.day}', ${e.time_il ? `'${e.time_il}'` : 'null'}, ${e.month}, ${e.num ?? 'null'})`);
  const r = await run('ilai', `insert into public.client_gantt (client_id, key, kind, title, day, time_il, month, num) values ${values.join(', ')} returning key`, [ids.edited, ...plan.entries.map((e) => e.title)]);
  assert.equal(r.rows?.length, plan.entries.length, r.error);
  for (const k of Object.keys(GANTT_KINDS)) {
    const x = await run('owner', "insert into public.client_gantt (client_id, key, kind, title, day) values ($1, 'custom.1', $2, 't', '2026-05-01') returning kind", [ids.edited, k]);
    assert.equal(x.rows?.[0]?.kind, k, `${k}: ${x.error}`);
  }
  for (const k of ['Video.1', 'video.x', '1video', 'video..1', 'video.1.2.3', "v'; drop"]) {
    assert.match((await run('owner', "insert into public.client_gantt (client_id, key, kind, title, day) values ($1, $2, 'video', 't', '2026-05-01')", [ids.edited, k])).error, /check constraint/, k);
  }
  assert.match((await run('owner', "insert into public.client_gantt (client_id, key, kind, title, day) values ($1, 'x.1', 'tiktok', 't', '2026-05-01')", [ids.edited])).error, /check constraint/);
  for (const link of ['http://insecure.example', 'javascript:alert(1)', 'https://a b', 'https://x"y']) {
    assert.match((await run('owner', "insert into public.client_gantt (client_id, key, kind, title, day, link) values ($1, 'custom.2', 'custom', 't', '2026-05-01', $2)", [ids.edited, link])).error, /check constraint/, link);
  }
  assert.match((await run('owner', "insert into public.client_gantt (client_id, key, kind, title, day) values ($1, 'custom.3', 'custom', '  ', '2026-05-01')", [ids.edited])).error, /check constraint/);
  await db.query('delete from public.client_gantt');
});

test('the database\'s rules: plan and renewal are internal whatever is sent; posted has its day, planned none', async () => {
  for (const kind of ['plan', 'renewal']) {
    const r = await run('ilai', "insert into public.client_gantt (client_id, key, kind, title, day, internal) values ($1, 'custom.9', $2, 't', '2026-05-01', false) returning internal", [ids.edited, kind]);
    assert.equal(r.rows[0].internal, true, kind);
  }
  const p = await as(db, users.ilai, async (tx) => {
    await tx.query("insert into public.client_gantt (client_id, key, kind, title, day, state) values ($1, 'video.1', 'video', 't', '2026-05-01', 'posted')", [ids.edited]);
    const a = (await tx.query("select posted_on = (now() at time zone 'Asia/Jerusalem')::date as today from public.client_gantt where key = 'video.1'")).rows[0];
    await tx.query("update public.client_gantt set posted_on = '2026-05-02' where key = 'video.1'");
    const b = (await tx.query("select posted_on::text from public.client_gantt where key = 'video.1'")).rows[0];
    await tx.query("update public.client_gantt set state = 'planned' where key = 'video.1'");
    const c = (await tx.query("select posted_on from public.client_gantt where key = 'video.1'")).rows[0];
    return [a.today, b.posted_on, c.posted_on];
  });
  assert.deepEqual(p, [true, '2026-05-02', null]);
});

test('a file must be the client\'s own and exist; removing the file row leaves the entry without it', async () => {
  const INS = "insert into public.client_gantt (client_id, key, kind, title, day, file_id) values ($1, 'video.1', 'video', 't', '2026-05-01', $2) returning key";
  const mine = await addFile(ids.edited, 'deliverable_video', 'reel.mp4', 'https://instagram.com/reel/abc');
  const theirs = await addFile(ids.other, 'deliverable_video', 'x.mp4');
  assert.equal((await run('ilai', INS, [ids.edited, mine])).rows?.[0]?.key, 'video.1');
  assert.match((await run('ilai', INS, [ids.edited, theirs])).error, /file not of this client/);
  assert.match((await run('ilai', INS, [ids.edited, crypto.randomUUID()])).error, /file not of this client|foreign key/);
  // The foreign key (20261003130100): a file row removed (the SQL editor; the app only soft-deletes) clears the link.
  const gone = await addFile(ids.edited, 'deliverable_video', 'gone.mp4');
  await db.query("insert into public.client_gantt (client_id, key, kind, title, day, file_id) values ($1, 'video.2', 'video', 't', '2026-05-02', $2)", [ids.edited, gone]);
  await db.query('delete from public.client_files where id = $1', [gone]);
  assert.equal((await db.query("select file_id from public.client_gantt where client_id = $1 and key = 'video.2'", [ids.edited])).rows[0].file_id, null);
  const fk = await db.query("select confdeltype from pg_constraint where conname = 'client_gantt_file_id_fkey'");
  assert.equal(fk.rows[0]?.confdeltype, 'n', 'on delete set null');
  await db.query("delete from public.client_gantt where key = 'video.2'");
  ids.file = mine;
});

test('the client\'s link: the office creates it, anon reads only what the client may see', async () => {
  await db.query("insert into public.client_gantt (client_id, key, kind, title, day, time_il, state, file_id, note) values ($1, 'video.1', 'video', 'סרטון 1', '2026-05-03', '19:00', 'posted', $2, 'הערה פנימית')", [ids.edited, ids.file]);
  await db.query("insert into public.client_gantt (client_id, key, kind, title, day, time_il, link) values ($1, 'graphic.1', 'graphic', 'גרפיקה 1', '2026-05-04', '13:00', 'https://instagram.com/p/xyz')", [ids.edited]);
  await db.query("insert into public.client_gantt (client_id, key, kind, title, day) values ($1, 'plan.2', 'plan', 'תכנון', '2026-04-14'), ($1, 'renewal', 'renewal', 'חידוש', '2027-01-14'), ($1, 'custom.5', 'custom', 'פנימי', '2026-05-05')", [ids.edited]);
  await db.query("update public.client_gantt set internal = true where key = 'custom.5'");
  for (const who of ['nadia', 'anna']) assert.match((await run(who, 'select public.gantt_link_create($1)', [ids.edited])).error, RLS, who);
  assert.match((await run(null, 'select public.gantt_link_create($1)', [ids.edited])).error, RLS);
  assert.match((await run('ilai', 'select public.gantt_link_create($1)', [ids.ended])).error, /client not open/);
  // Created outside the rolled-back helper, as Ilai, so the link stays.
  const link = await db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users.ilai.id, email: users.ilai.email, role: 'authenticated' })]);
    return (await tx.query('select public.gantt_link_create($1) as l', [ids.edited])).rows[0].l;
  });
  assert.match(link.token, /^[A-Za-z0-9_-]{43}$/);
  const stored = (await db.query('select token_hash, secret_id, created_by from public.client_gantt_links where id = $1', [link.id])).rows[0];
  assert.notEqual(stored.token_hash, link.token);
  assert.equal(stored.created_by, 'ilai@astrateg.test');
  // The office reads the token again; nobody else; the hash and Vault id are never columns anyone reads.
  assert.equal((await run('irit', 'select public.gantt_link_token($1) as t', [link.id])).rows[0].t, link.token);
  assert.match((await run('nadia', 'select public.gantt_link_token($1) as t', [link.id])).error, RLS);
  assert.match((await run('irit', 'select token_hash from public.client_gantt_links')).error, /permission denied/);
  assert.equal((await run('irit', 'select id from public.client_gantt_links')).rows.length, 1);
  assert.deepEqual((await run('nadia', 'select id from public.client_gantt_links')).rows, []);
  assert.match((await run(null, 'select id from public.client_gantt_links')).error, /permission denied/);

  const g = (await run(null, 'select public.get_gantt($1) as g', [link.token])).rows[0].g;
  assert.equal(g.state, 'ok');
  assert.equal(g.preview, false);
  assert.equal(g.client.business, 'קפה נדיה');
  assert.equal(g.client.contractEnd, '2027-03-15');
  assert.deepEqual(g.entries.map((e) => e.key), ['video.1', 'graphic.1']);
  const [v, gr] = g.entries;
  assert.deepEqual([v.time, v.state, v.link, v.num], ['19:00', 'posted', 'https://instagram.com/reel/abc', null]);
  assert.equal(gr.link, 'https://instagram.com/p/xyz');
  const text = JSON.stringify(g);
  for (const secret of ['הערה פנימית', 'reel.mp4', 'deliverable_video/', 'תכנון', 'חידוש', 'פנימי', 'ilai@', 'note', 'storage', 'file_id', 'by_email']) assert.ok(!text.includes(secret), secret);
  // A staff member opening it sees a preview.
  assert.equal((await run('irit', 'select public.get_gantt($1) as g', [link.token])).rows[0].g.preview, true);
  // Wrong or malformed tokens.
  for (const t of ['', 'abc', `${link.token.slice(0, -1)}A`.replace(/AA$/, 'AB'), "x' or 1=1 --"]) {
    if (t === link.token) continue;
    assert.equal((await run(null, 'select public.get_gantt($1) as g', [t])).rows[0].g.state, 'invalid', t);
  }
  ids.link = link;
});

test('a new link revokes the old one, and its token leaves Vault; expired and closed links say so', async () => {
  const { link } = ids;
  const second = await db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users.irit.id, email: users.irit.email, role: 'authenticated' })]);
    return (await tx.query('select public.gantt_link_create($1, 30) as l', [ids.edited])).rows[0].l;
  });
  assert.equal((await run(null, 'select public.get_gantt($1) as g', [link.token])).rows[0].g.state, 'revoked');
  assert.equal((await run(null, 'select public.get_gantt($1) as g', [second.token])).rows[0].g.state, 'ok');
  const old = (await db.query('select secret_id, revoked_by from public.client_gantt_links where id = $1', [link.id])).rows[0];
  assert.deepEqual(old, { secret_id: null, revoked_by: 'irit@astrateg.test' });
  assert.equal((await db.query("select count(*)::int as n from vault.secrets where name like 'gantt_link:%'")).rows[0].n, 1);
  await db.query("update public.client_gantt_links set expires_at = now() - interval '1 minute' where id = $1", [second.id]);
  assert.equal((await run(null, 'select public.get_gantt($1) as g', [second.token])).rows[0].g.state, 'expired');
  await db.query("update public.client_gantt_links set expires_at = now() + interval '1 day' where id = $1", [second.id]);
  await db.query("update public.clients set status = 'ended' where id = $1", [ids.edited]);
  assert.equal((await run(null, 'select public.get_gantt($1) as g', [second.token])).rows[0].g.state, 'closed');
  await db.query("update public.clients set status = 'active' where id = $1", [ids.edited]);
  // Revoke by hand: the office only.
  assert.match((await run('nadia', 'select public.gantt_link_revoke($1)', [second.id])).error, RLS);
  await db.query("select set_config('request.jwt.claims', '{}', false)");
  // Removing the client takes its links and their tokens.
  await db.query('delete from public.clients where id = $1', [ids.edited]);
  assert.equal((await db.query("select count(*)::int as n from vault.secrets where name like 'gantt_link:%'")).rows[0].n, 0);
});

test('anon runs get_gantt and nothing else of it; every table here has row level security', async () => {
  const { rows } = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname ~ 'gantt' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
  assert.deepEqual(rows.map((r) => r.proname), ['get_gantt']);
  const t = await db.query("select relname, relrowsecurity from pg_class where relname in ('client_gantt', 'client_gantt_links') order by 1");
  assert.deepEqual(t.rows, [{ relname: 'client_gantt', relrowsecurity: true }, { relname: 'client_gantt_links', relrowsecurity: true }]);
});

test('the migrations are safe to run again, with or without the files\' table, and the later ones still load', async () => {
  const again = await freshDatabase();
  for (const f of [MIGRATION, FK_MIGRATION, MIGRATION, FK_MIGRATION]) await again.exec(migrationSql(f));
  for (const f of migrationFiles().filter((x) => x > FK_MIGRATION)) await again.exec(migrationSql(f));
  // Its own four rules; the archive rule (20261003140000_manager_features.sql) is a restrictive fifth.
  const n = (await again.query("select count(*)::int as n from pg_policies where tablename = 'client_gantt' and permissive = 'PERMISSIVE'")).rows[0].n;
  assert.equal(n, 4);
  assert.equal((await again.query("select count(*)::int as n from pg_constraint where conname = 'client_gantt_file_id_fkey'")).rows[0].n, 1);
  await again.close();
  // Without public.client_files (a project where the files' migration is not in yet): both load, no key.
  const bare = await freshDatabase({ upTo: '20261003110000_client_files.sql' });
  for (const f of [MIGRATION, FK_MIGRATION, FK_MIGRATION]) await bare.exec(migrationSql(f));
  assert.equal((await bare.query("select count(*)::int as n from pg_constraint where conname = 'client_gantt_file_id_fkey'")).rows[0].n, 0);
  await bare.query("insert into public.clients (name) values ('x')");
  await bare.query("insert into public.client_gantt (client_id, key, kind, title, day, file_id) select id, 'video.1', 'video', 't', '2026-05-01', gen_random_uuid() from public.clients");
  await bare.close();
});
