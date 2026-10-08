// The client's logins form (supabase/migrations/20261008100000_client_access_form.sql)
// in a real Postgres with every migration (tests/sql/pg.mjs): the secret link (a hash
// in the table, the token in Vault, 14 days, one use, revocation; the owner, Irit,
// Lior and Ofir), the anonymous page reaching the database only through its two
// functions and getting nothing stored back, the strict checks (the same as the
// page's, app/access-logic.js), the vault's rows updated and never duplicated, the
// statuses ('new', 'missing', 'broken'), process 5 marked, Ilai's task, the limit of
// refused attempts, and the migration run twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { payloadProblem, buildPayload, emptyForm, summaryOf, CLIENT_BY, LINK_DAYS, MAX_ATTEMPTS } from '../../app/access-logic.js';
import { NUDGE_KEY } from '../../app/access-nudge.js';
import { DEFAULT_TEMPLATES } from '../../app/messages-logic.js';

const FILE = migrationFiles().find((f) => f.endsWith('_client_access_form.sql'));
let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', stav: 'stav' };

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    // The vault flag: the owner, Lior and Ofir. Irit and Ilai work without it.
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, ['owner', 'lior', 'ofir'].includes(key)]);
  }
  const add = async (name, fields = {}) => {
    const cols = ['name', ...Object.keys(fields)];
    const vals = [name, ...Object.values(fields)];
    const { rows } = await db.query(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals);
    ids[name] = rows[0].id;
  };
  await add('dana', { business: 'קפה דנה', phone: '050-1234567', editor: 'nadia', notes: 'הערה פנימית' });
  await add('yossi', { business: '' });
  await add('gil', { business: 'גיל נדל״ן' });
  await add('ended', { status: 'ended' });
});

const run = (who, fn) => as(db, who === 'anon' ? null : users[who], fn);
const q = (who, sql, params = []) => run(who, async (tx) => (await tx.query(sql, params)).rows);
// Committed calls (as() rolls back): a function run as a user, kept.
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
const create = async (who, client) => (await keep(who, 'select public.access_link_create($1) as l', [client]))[0].l;
const info = async (token, who = 'anon') => (await keep(who, 'select public.access_form_info($1) as r', [token]))[0].r;
const submit = async (token, payload, who = 'anon') => (await keep(who, 'select public.access_form_submit($1, $2::jsonb) as r', [token, JSON.stringify(payload)]))[0].r;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const secretOf = async (id) => (await one('select secret from vault.secrets where id = $1', [id]))?.secret ?? null;

// A form as the page builds it: Instagram with a login, Facebook to open, TikTok to reset.
function form({ extra = [], notes = '' } = {}) {
  const f = emptyForm();
  f.main.instagram = { choice: 'have', username: ' dana_cafe ', password: 'Insta-סוד 9!' };
  f.main.facebook = { choice: 'none', username: 'ignored', password: 'ignored' };
  f.main.tiktok = { choice: 'reset', username: 'dana.tt', password: 'ignored' };
  f.extra = extra;
  f.notes = notes;
  return f;
}
let token;
let link;

test('the owner, Irit, Lior and Ofir make a link; the table keeps a hash, the token is in Vault, 14 days', async () => {
  for (const who of ['ilai', 'nadia', 'stav', 'anon']) {
    assert.match((await q(who, 'select public.access_link_create($1)', [ids.dana])).error, /not allowed|permission denied/, who);
  }
  for (const who of ['owner', 'irit', 'lior', 'ofir']) {
    const r = await q(who, 'select public.access_link_create($1) as l', [ids.gil]);
    assert.match(r[0].l.token, /^[A-Za-z0-9_-]{43}$/, who);
  }
  link = await create('irit', ids.dana);
  token = link.token;
  const row = await one('select * from public.client_access_links where id = $1', [link.id]);
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(row.token_hash, token);
  assert.equal(row.created_by, 'irit@astrateg.test');
  assert.ok(Math.abs(new Date(row.expires_at) - Date.now() - LINK_DAYS * 864e5) < 60e3, 'expires in 14 days');
  assert.equal(await secretOf(row.secret_id), token);
  assert.equal((await all("select 1 from public.client_access_links where token_hash like '%' || $1 || '%'", [token])).length, 0);
  // Copying it again: who manages the links, while it can still be filled.
  assert.equal((await q('ofir', 'select public.access_link_token($1) as t', [link.id]))[0].t, token);
  assert.match((await q('ilai', 'select public.access_link_token($1)', [link.id])).error, /not allowed/);
  // A client that ended has no form.
  assert.match((await q('irit', 'select public.access_link_create($1)', [ids.ended])).error, /client not open/);
});

test('the links table: the office reads it without the hash and the Vault id; nobody else; nobody writes', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) {
    assert.equal((await q(who, 'select id, client_id, created_at, expires_at, submitted_at, summary, client_note from public.client_access_links')).length, 1, who);
  }
  for (const who of ['nadia', 'stav']) assert.equal((await q(who, 'select id from public.client_access_links')).length, 0, who);
  assert.match((await q('anon', 'select id from public.client_access_links')).error, /permission denied/);
  for (const col of ['token_hash', 'secret_id']) assert.match((await q('irit', `select ${col} from public.client_access_links`)).error, /permission denied/, col);
  assert.match((await q('irit', 'update public.client_access_links set submitted_at = now()')).error, /permission denied/);
  assert.match((await q('irit', 'delete from public.client_access_links')).error, /permission denied/);
  assert.match((await q('irit', "insert into public.client_access_links (client_id, token_hash, expires_at) values ($1, repeat('a', 64), now())", [ids.dana])).error, /permission denied/);
  const rls = await one("select relrowsecurity from pg_class where oid = 'public.client_access_links'::regclass");
  assert.equal(rls.relrowsecurity, true);
});

test('anon reaches only the two functions of the page, and reads nothing', async () => {
  const fns = await all(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname ~ '^(access_|can_manage_access|client_access)' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
  assert.deepEqual(fns.map((r) => r.proname), ['access_form_info', 'access_form_submit']);
  // (A table Supabase grants by default answers anon with no rows: row level security.)
  for (const t of ['client_access', 'client_access_log', 'client_access_links', 'client_tasks', 'protocol_checks', 'clients']) {
    const r = await q('anon', `select 1 from public.${t}`);
    assert.ok(r.error ? /permission denied/.test(r.error) : r.length === 0, t);
  }
  assert.match((await q('anon', 'select 1 from public.client_access_links')).error, /permission denied/);
  for (const sql of ["insert into public.client_access (client_id, network) values ($1, 'instagram')", "update public.client_access set status = 'ok' where client_id = $1", 'delete from public.client_access where client_id = $1']) {
    assert.match((await q('anon', sql, [ids.dana])).error, /permission denied/, sql);
  }
  assert.match((await q('anon', 'select 1 from vault.secrets')).error, /permission denied/);
  assert.match((await q('anon', 'select public.access_reveal($1)', [ids.dana])).error, /permission denied/);
  assert.match((await q('anon', 'select public.access_link_token($1)', [link.id])).error, /permission denied/);
  assert.match((await q('anon', "select private.access_form_problem('{}'::jsonb)")).error, /permission denied/);
});

test('the page learns only the business name and the state', async () => {
  assert.deepEqual(await info(token), { state: 'ok', business: 'קפה דנה', preview: false });
  // A staff member signed in sees the same, marked as a preview.
  assert.deepEqual(await info(token, 'irit'), { state: 'ok', business: 'קפה דנה', preview: true });
  // No business in the card: the contact's name.
  const y = await create('lior', ids.yossi);
  assert.deepEqual(await info(y.token), { state: 'ok', business: 'yossi', preview: false });
  for (const bad of [null, '', 'abc', 'A'.repeat(43), `${token}x`, token.slice(1)]) assert.deepEqual(await info(bad), { state: 'invalid' }, String(bad));
});

test('the same rules in the database and on the page', async () => {
  const ok = buildPayload(form());
  const e = (i, patch) => ({ ...ok, entries: ok.entries.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const extra = (x) => ({ ...ok, entries: [...ok.entries, x] });
  const cases = [
    ['a good form', ok, null],
    ['with a platform the vault knows', extra({ network: 'youtube', label: null, choice: 'have', username: 'dana', password: 'x' }), null],
    ['with a platform by name', extra({ network: 'other', label: 'LinkedIn', choice: 'have', username: 'dana', password: 'x' }), null],
    ['a password with a space inside', e(0, { password: 'two words' }), null],
    ['not an object', [], 'payload'],
    ['an unknown field', { ...ok, extra: 1 }, 'unknown field'],
    ['an unknown field in an entry', e(0, { id: 'x' }), 'unknown field'],
    ['no entries', { notes: null }, 'entries'],
    ['two entries', { entries: ok.entries.slice(0, 2), notes: null }, 'entries count'],
    ['13 entries', { ...ok, entries: [...ok.entries, ...Array.from({ length: 10 }, (_, i) => ({ network: 'other', label: `p${i}`, choice: 'have', username: 'u', password: 'p' }))] }, 'entries count'],
    ['a number for a user name', e(0, { username: 5 }), 'entry type'],
    ['an unknown network', extra({ network: 'snapchat', label: null, choice: 'have', username: 'u', password: 'p' }), 'network'],
    ['no network', extra({ label: 'x', choice: 'have', username: 'u', password: 'p' }), 'network'],
    ['other without a name', extra({ network: 'other', label: ' ', choice: 'have', username: 'u', password: 'p' }), 'label'],
    ['a name of 41 characters', extra({ network: 'other', label: 'x'.repeat(41), choice: 'have', username: 'u', password: 'p' }), 'label'],
    ['a label on a known network', e(0, { label: 'x' }), 'label'],
    ['no choice', e(1, { choice: null }), 'choice'],
    ['an unknown choice', e(1, { choice: 'maybe' }), 'choice'],
    ['an added platform without a login', extra({ network: 'youtube', label: null, choice: 'none', username: null, password: null }), 'choice'],
    ['a login without a user name', e(0, { username: '  ' }), 'username'],
    ['a login without a password', e(0, { password: '' }), 'password'],
    ['a password of spaces', e(0, { password: '   ' }), 'password'],
    ['a password of 201 characters', e(0, { password: 'p'.repeat(201) }), 'password'],
    ['a user name of 201 characters', e(0, { username: 'u'.repeat(201) }), 'username'],
    ['a line break in a user name', e(0, { username: 'a\nb' }), 'username'],
    ['a tab in a password', e(0, { password: 'a\tb' }), 'password'],
    ['a password with "אין כיום"', e(1, { password: 'x' }), 'password'],
    ['a user name with "אין כיום"', e(1, { username: 'x' }), 'username'],
    ['a password with "לחדש סיסמה"', e(2, { password: 'x' }), 'password'],
    ['Instagram twice', extra({ network: 'instagram', label: null, choice: 'none', username: null, password: null }), 'duplicate'],
    ['the same name twice', { ...ok, entries: [...ok.entries, { network: 'other', label: 'LinkedIn', choice: 'have', username: 'u', password: 'p' }, { network: 'other', label: 'linkedin ', choice: 'have', username: 'u', password: 'p' }] }, 'duplicate'],
    ['TikTok missing', { ...ok, entries: [...ok.entries.slice(0, 2), { network: 'youtube', label: null, choice: 'have', username: 'u', password: 'p' }] }, 'required'],
    ['notes of 300 characters', { ...ok, notes: 'n'.repeat(300) }, null],
    ['notes of 301 characters', { ...ok, notes: 'n'.repeat(301) }, 'notes too long'],
    ['notes that are not text', { ...ok, notes: 7 }, 'notes'],
  ];
  for (const [name, payload, want] of cases) {
    assert.equal(payloadProblem(payload), want, `page: ${name}`);
    const got = (await one('select private.access_form_problem($1::jsonb) as p', [JSON.stringify(payload)])).p;
    assert.equal(got, want, `database: ${name}`);
  }
  assert.equal((await one('select private.access_form_problem(null) as p')).p, 'payload');
});

test('a refused submission writes nothing and is counted', async () => {
  const bad = buildPayload(form());
  bad.entries[0].password = '';
  assert.deepEqual(await submit(token, bad), { state: 'refused', left: 4 });
  const row = await one('select attempts, submitted_at from public.client_access_links where id = $1', [link.id]);
  assert.deepEqual([row.attempts, row.submitted_at], [1, null]);
  assert.equal((await all('select 1 from public.client_access where client_id = $1', [ids.dana])).length, 0);
  assert.equal((await all("select 1 from public.protocol_checks where client_id = $1 and item_key like 'p05.%'", [ids.dana])).length, 0);
  // A staff member signed in cannot send it for the client.
  await assert.rejects(submit(token, buildPayload(form()), 'irit'), /staff cannot send/);
  assert.deepEqual(await info(token), { state: 'ok', business: 'קפה דנה', preview: false });
});

// Since 20261014100000_security_hardening.sql a login the office saved is never
// replaced by the form: the client's goes into a row of its own beside it.
test('a submission: the vault as access_save writes it, the statuses, process 5, Ilai\'s task; nothing comes back', async () => {
  // Ofir already put Instagram (with a password) and YouTube in the vault.
  const [{ id: insta }] = await keep('ofir', "select public.access_save($1, null, 'instagram', 'העמוד הראשי', 'old_user', 'old-pass', 'ok', 'מהאפיון') as id", [ids.dana]);
  const [{ id: yt }] = await keep('ofir', "select public.access_save($1, null, 'youtube', null, 'dana_yt', 'yt-pass', 'ok', null) as id", [ids.dana]);
  const oldSecret = (await one('select secret_id from public.client_access where id = $1', [insta])).secret_id;
  const instaBefore = await one('select * from public.client_access where id = $1', [insta]);
  const ytBefore = await one('select * from public.client_access where id = $1', [yt]);

  const payload = buildPayload(form({
    extra: [{ id: 'x1', platform: 'linkedin', label: '', username: 'dana@cafe.co.il', password: 'Li-123' }],
    notes: '  קוד האימות מגיע לטלפון של דנה  ',
  }));
  const res = await submit(token, payload);
  assert.deepEqual(res, { state: 'done' });

  const rows = await all('select * from public.client_access where client_id = $1 order by network, label', [ids.dana]);
  const by = Object.fromEntries(rows.filter((r) => r.id !== insta).map((r) => [r.network, r]));
  assert.deepEqual(rows.map((r) => r.network).sort(), ['facebook', 'instagram', 'instagram', 'other', 'tiktok', 'youtube']);
  // Instagram: Ofir's row is exactly as it was, its password still in Vault; the client's
  // login is a second row of the same network, marked as the client's, not checked yet.
  assert.deepEqual(await one('select * from public.client_access where id = $1', [insta]), instaBefore);
  assert.equal(await secretOf(oldSecret), 'old-pass');
  assert.notEqual(by.instagram.id, insta);
  assert.deepEqual([by.instagram.status, by.instagram.username, by.instagram.updated_by], ['new', 'dana_cafe', CLIENT_BY]);
  assert.match(by.instagram.label, /^מהלקוח, \d{1,2}\.\d{1,2}\.\d{4}$/);
  assert.notEqual(by.instagram.secret_id, oldSecret);
  assert.equal(await secretOf(by.instagram.secret_id), 'Insta-סוד 9!');
  assert.match(by.instagram.note, /מהלקוח, בטופס פרטי הכניסה.*הפרטים שכבר היו בכספת נשארו בשורה נפרדת/);
  // Facebook: "אין כיום" → missing, no login kept.
  assert.deepEqual([by.facebook.status, by.facebook.username, by.facebook.secret_id, by.facebook.updated_by], ['missing', null, null, CLIENT_BY]);
  // TikTok: "לחדש סיסמה" → broken (since now), the user name kept, no password.
  assert.deepEqual([by.tiktok.status, by.tiktok.username, by.tiktok.secret_id], ['broken', 'dana.tt', null]);
  assert.ok(by.tiktok.broken_since);
  assert.match(by.tiktok.note, /יש, וצריך לחדש סיסמה/);
  // LinkedIn: the vault has no key for it, so 'other' with its name.
  assert.deepEqual([by.other.status, by.other.label, by.other.username], ['new', 'LinkedIn', 'dana@cafe.co.il']);
  assert.equal(await secretOf(by.other.secret_id), 'Li-123');
  // YouTube was not in the form: untouched.
  assert.deepEqual(await one('select * from public.client_access where id = $1', [yt]), ytBefore);

  // The link: closed, with the platforms and the choices only, and the notes; its token left Vault.
  const l = await one('select * from public.client_access_links where id = $1', [link.id]);
  assert.ok(l.submitted_at);
  assert.equal(l.secret_id, null);
  assert.equal((await all("select 1 from vault.secrets where name = 'access_link:' || $1", [link.id])).length, 0);
  assert.deepEqual(l.summary, summaryOf(payload).map((s) => (s.network === 'instagram' ? { ...s, beside: true } : s)));
  // The client's note: not in the column the office reads, only where the vault's users read it.
  assert.equal(l.client_note, null);
  assert.equal(l.client_note_private, 'קוד האימות מגיע לטלפון של דנה');
  const kept = JSON.stringify(l);
  for (const secret of ['Insta-', 'Li-123', 'dana_cafe', 'dana.tt', 'dana@cafe', token]) assert.ok(!kept.includes(secret), secret);

  // Process 5 is marked, by the system; Ilai gets one task for what has to be opened.
  const marks = await all("select item_key, state, note, by_email from public.protocol_checks where client_id = $1 and item_key like 'p05.%' order by 1", [ids.dana]);
  // Since protocol v8 the client's own form also answers "are there other networks" (p05.allnets)
  // and closes Irit's "send the client the link" (5ב): 20261022100000_flow_fixes_v8.sql.
  assert.deepEqual(marks.map((m) => [m.item_key, m.state, m.by_email]), [['p05.access', 'done', 'system'], ['p05.allnets', 'done', 'system'], ['p05.vault', 'done', 'system']]);
  const sentLink = await all("select state, note, by_email from public.protocol_checks where client_id = $1 and item_key = 'p05b.sent'", [ids.dana]);
  assert.deepEqual(sentLink, [{ state: 'done', note: 'נסגר לבד: הלקוח מילא את טופס פרטי הכניסה', by_email: 'system' }]);
  assert.equal(marks[0].note, 'מהלקוח, בטופס פרטי הכניסה: Instagram, Facebook, TikTok, LinkedIn');
  const tasks = await all('select title, owner, urgent, done_at from public.client_tasks where client_id = $1', [ids.dana]);
  assert.deepEqual(tasks, [{ title: 'לפתוח ללקוח Facebook ולהכניס את הגישה לכספת (הלקוח סימן בטופס: אין כיום)', owner: 'ilai', urgent: true, done_at: null }]);

  // The vault's log says who set what: the client's form, never an email.
  const log = await all("select network, action, by_email from public.client_access_log where client_id = $1 and by_email = $2 order by id", [ids.dana, CLIENT_BY]);
  assert.deepEqual(log.map((r) => `${r.network}:${r.action}`), ['instagram:create', 'facebook:create', 'tiktok:create', 'other:create']);

  // Neither a password nor a user name is in any table outside Vault.
  const dump = JSON.stringify([
    await all('select * from public.client_access'), await all('select * from public.client_access_log'), await all('select * from public.client_access_links'),
    await all('select * from public.protocol_checks'), await all('select * from public.protocol_log'), await all('select * from public.client_tasks'),
  ]);
  for (const secret of ['Insta-סוד', 'Li-123', 'old-pass']) assert.ok(!dump.includes(secret), secret);
});

test('one use: the link is closed, and sending again changes nothing', async () => {
  assert.deepEqual(await info(token), { state: 'done' });
  const before = JSON.stringify(await all('select * from public.client_access where client_id = $1 order by id', [ids.dana]));
  const again = buildPayload(form());
  again.entries[0].password = 'another';
  assert.deepEqual(await submit(token, again), { state: 'done' });
  assert.equal(JSON.stringify(await all('select * from public.client_access where client_id = $1 order by id', [ids.dana])), before);
  assert.equal((await all('select 1 from public.client_tasks where client_id = $1', [ids.dana])).length, 1);
  // The office cannot copy a filled link, nor revoke it into "revoked".
  assert.equal((await q('irit', 'select public.access_link_token($1) as t', [link.id]))[0].t, null);
  await keep('irit', 'select public.access_link_revoke($1)', [link.id]);
  assert.equal((await one('select revoked_at from public.client_access_links where id = $1', [link.id])).revoked_at, null);
});

test('who opens the passwords does not change: the vault flag; the statuses for work say "by the client"', async () => {
  const rows = await all("select id, network from public.client_access where client_id = $1 and network = 'instagram' and updated_by = $2", [ids.dana, CLIENT_BY]);
  assert.equal(rows.length, 1);
  assert.equal((await q('ofir', 'select public.access_reveal($1) as p', [rows[0].id]))[0].p, 'Insta-סוד 9!');
  for (const who of ['irit', 'ilai', 'nadia']) assert.match((await q(who, 'select public.access_reveal($1)', [rows[0].id])).error, /not allowed/, who);
  // Ilai (no vault flag) reads statuses only, and which of them the client set.
  const work = await q('ilai', 'select * from public.access_work_statuses($1)', [[ids.dana]]);
  assert.deepEqual(Object.keys(work[0]).sort(), ['by_client', 'client_id', 'label', 'network', 'status', 'updated_at']);
  assert.deepEqual(work.map((r) => `${r.network}:${r.status}:${r.by_client}`).sort(),
    ['facebook:missing:true', 'instagram:new:true', 'instagram:ok:false', 'other:new:true', 'tiktok:broken:true', 'youtube:ok:false']);
  // Once someone of the office saves a row, its status is theirs.
  await keep('ofir', "select public.access_save($1, $2, 'instagram', 'העמוד החדש', 'dana_cafe', null, 'ok', null)", [ids.dana, rows[0].id]);
  const after = await q('ilai', 'select network, label, status, by_client from public.access_work_statuses($1)', [[ids.dana]]);
  assert.deepEqual(after.find((r) => r.label === 'העמוד החדש'), { network: 'instagram', label: 'העמוד החדש', status: 'ok', by_client: false });
  // The password the client gave stayed (an empty password field keeps it).
  assert.equal((await q('ofir', 'select public.access_reveal($1) as p', [rows[0].id]))[0].p, 'Insta-סוד 9!');
});

test('a later form never replaces what the office saved since: it goes beside it; process 5 keeps its first time', async () => {
  const first = await one("select at, note from public.protocol_checks where client_id = $1 and item_key = 'p05.access'", [ids.dana]);
  // Ofir fixed TikTok and put a password meanwhile; then the client fills a new link.
  const tt = await one("select id from public.client_access where client_id = $1 and network = 'tiktok'", [ids.dana]);
  await keep('ofir', "select public.access_save($1, $2, 'tiktok', null, 'dana.tt', 'tt-by-ofir', 'ok', null)", [ids.dana, tt.id]);
  const l2 = await create('ofir', ids.dana);
  const f = emptyForm();
  f.main.instagram = { choice: 'reset', username: '', password: '' };
  f.main.facebook = { choice: 'none', username: '', password: '' };
  f.main.tiktok = { choice: 'have', username: 'dana.new', password: 'tt-by-client' };
  const before = await all('select * from public.client_access where client_id = $1 order by id', [ids.dana]);
  assert.equal(before.length, 6);
  assert.deepEqual(await submit(l2.token, buildPayload(f)), { state: 'done' });
  const rows = await all('select * from public.client_access where client_id = $1 order by created_at, id', [ids.dana]);
  // Every row the office saved (both Instagram rows, TikTok, YouTube) is exactly as it was.
  for (const b of before.filter((r) => r.updated_by !== CLIENT_BY)) assert.deepEqual(rows.find((r) => r.id === b.id), b, `${b.network} ${b.label}`);
  assert.equal(before.filter((r) => r.updated_by !== CLIENT_BY).length, 4);
  const added = rows.filter((r) => !before.some((b) => b.id === r.id));
  const by = Object.fromEntries(added.map((r) => [r.network, r]));
  assert.deepEqual(added.map((r) => r.network).sort(), ['instagram', 'tiktok'], 'one row beside each login the office holds');
  // TikTok: Ofir's password is still in Vault; the client's is in the new row, not checked yet.
  assert.deepEqual([by.tiktok.status, by.tiktok.username, by.tiktok.updated_by], ['new', 'dana.new', CLIENT_BY]);
  assert.equal(await secretOf(by.tiktok.secret_id), 'tt-by-client');
  assert.equal(await secretOf(rows.find((r) => r.id === tt.id).secret_id), 'tt-by-ofir');
  // "לחדש סיסמה" on a login the office confirmed: said in a row of its own, with no login.
  assert.deepEqual([by.instagram.status, by.instagram.username, by.instagram.secret_id], ['broken', null, null]);
  assert.match(by.instagram.label, /^מהלקוח, /);
  // Facebook ("אין כיום", the client's own row): the same row, still one.
  assert.equal(rows.filter((r) => r.network === 'facebook').length, 1);
  // No password left Vault.
  for (const pw of ['old-pass', 'Insta-סוד 9!', 'tt-by-ofir', 'tt-by-client', 'Li-123', 'yt-pass']) {
    assert.equal((await all('select 1 from vault.secrets where secret = $1', [pw])).length, 1, pw);
  }
  // Facebook was already "missing": no second task for Ilai.
  assert.equal((await all('select 1 from public.client_tasks where client_id = $1', [ids.dana])).length, 1);
  assert.deepEqual(await one("select at, note from public.protocol_checks where client_id = $1 and item_key = 'p05.access'", [ids.dana]), first);
  // The history: who set TikTok, in order.
  const log = await all("select action, by_email from public.client_access_log where client_id = $1 and network = 'tiktok' order by id", [ids.dana]);
  assert.deepEqual(log.map((r) => `${r.action}:${r.by_email}`), [`create:${CLIENT_BY}`, 'update:ofir@astrateg.test', `create:${CLIENT_BY}`]);

  // A third form: the client's own unchecked row (TikTok, 'new') takes the new login in
  // place, its password replaced inside the same secret; still nothing of the office's moves.
  const l3 = await create('ofir', ids.dana);
  const g = emptyForm();
  g.main.instagram = { choice: 'reset', username: 'dana_ig', password: '' };
  g.main.facebook = { choice: 'none', username: '', password: '' };
  g.main.tiktok = { choice: 'have', username: 'dana.newer', password: 'tt-third' };
  assert.deepEqual(await submit(l3.token, buildPayload(g)), { state: 'done' });
  const third = await all('select * from public.client_access where client_id = $1 order by created_at, id', [ids.dana]);
  assert.equal(third.length, rows.length, 'no further rows: the client\'s own rows are updated');
  const t3 = third.find((r) => r.id === by.tiktok.id);
  assert.deepEqual([t3.status, t3.username, t3.secret_id], ['new', 'dana.newer', by.tiktok.secret_id]);
  assert.equal(await secretOf(t3.secret_id), 'tt-third');
  assert.equal(third.find((r) => r.id === by.instagram.id).username, 'dana_ig');
  for (const b of before.filter((r) => r.updated_by !== CLIENT_BY)) assert.deepEqual(third.find((r) => r.id === b.id), b);
  assert.equal(await secretOf(rows.find((r) => r.id === tt.id).secret_id), 'tt-by-ofir');
});

test('a new link revokes the one that waits; a revoked link and an expired one do not open', async () => {
  const a = await create('irit', ids.yossi); // the test above made one for Yossi: it is revoked now
  const links = await all('select id, revoked_at, revoked_by, secret_id from public.client_access_links where client_id = $1 order by created_at', [ids.yossi]);
  assert.equal(links.length, 2);
  assert.ok(links[0].revoked_at && links[0].revoked_by === 'irit@astrateg.test' && links[0].secret_id === null);
  assert.equal((await all("select 1 from vault.secrets where name = 'access_link:' || $1", [links[0].id])).length, 0, 'the revoked token left Vault');
  assert.equal((await q('irit', 'select public.access_link_token($1) as t', [links[0].id]))[0].t, null);
  // Revoked by hand.
  await keep('lior', 'select public.access_link_revoke($1)', [a.id]);
  assert.deepEqual(await info(a.token), { state: 'revoked' });
  assert.deepEqual(await submit(a.token, buildPayload(form())), { state: 'revoked' });
  // Expired.
  const b = await create('irit', ids.yossi);
  await db.query("update public.client_access_links set expires_at = now() - interval '1 minute' where id = $1", [b.id]);
  assert.deepEqual(await info(b.token), { state: 'expired' });
  assert.deepEqual(await submit(b.token, buildPayload(form())), { state: 'expired' });
  assert.equal((await q('irit', 'select public.access_link_token($1) as t', [b.id]))[0].t, null);
  assert.equal((await all('select 1 from public.client_access where client_id = $1', [ids.yossi])).length, 0);
  assert.equal((await all("select 1 from public.protocol_checks where client_id = $1 and item_key like 'p05.%'", [ids.yossi])).length, 0);
});

test('five refused submissions lock the link; a client that ended or was archived has no form', async () => {
  const l = await create('irit', ids.yossi);
  const bad = { entries: [], notes: null };
  for (let i = 1; i < MAX_ATTEMPTS; i += 1) assert.deepEqual(await submit(l.token, bad), { state: 'refused', left: MAX_ATTEMPTS - i });
  assert.deepEqual(await submit(l.token, bad), { state: 'locked', left: 0 });
  assert.deepEqual(await info(l.token), { state: 'locked' });
  assert.deepEqual(await submit(l.token, buildPayload(form())), { state: 'locked' });
  assert.equal((await q('irit', 'select public.access_link_token($1) as t', [l.id]))[0].t, null);
  assert.equal((await all('select 1 from public.client_access where client_id = $1', [ids.yossi])).length, 0);

  const g = await create('irit', ids.gil);
  await db.query("update public.clients set status = 'ended' where id = $1", [ids.gil]);
  assert.deepEqual(await info(g.token), { state: 'closed' });
  assert.deepEqual(await submit(g.token, buildPayload(form())), { state: 'closed' });
  await db.query("update public.clients set status = 'active' where id = $1", [ids.gil]);
  await keep('owner', 'select public.archive_client($1)', [ids.gil]);
  assert.deepEqual(await info(g.token), { state: 'closed' });
  assert.deepEqual(await submit(g.token, buildPayload(form())), { state: 'closed' });
  assert.match((await q('irit', 'select public.access_link_create($1)', [ids.gil])).error, /client not open/);
  await keep('owner', 'select public.restore_client($1)', [ids.gil]);
  assert.deepEqual(await info(g.token), { state: 'ok', business: 'גיל נדל״ן', preview: false });
});

test('a client removed takes its links and their tokens', async () => {
  const before = (await all("select 1 from vault.secrets where name like 'access_link:%'")).length;
  assert.ok(before >= 1);
  await db.query('delete from public.clients where id = $1', [ids.gil]);
  assert.equal((await all('select 1 from public.client_access_links where client_id = $1', [ids.gil])).length, 0);
  assert.equal((await all("select 1 from vault.secrets where name like 'access_link:%'")).length, before - 1);
});

test('the status list: ok, broken, missing and new; nothing else', async () => {
  for (const s of ['ok', 'broken', 'missing', 'new']) {
    await db.query("insert into public.client_access (client_id, network, status) values ($1, 'google', $2)", [ids.yossi, s]);
  }
  await assert.rejects(db.query("insert into public.client_access (client_id, network, status) values ($1, 'google', 'checked')", [ids.yossi]), /client_access_status_check/);
  await db.query("delete from public.client_access where client_id = $1 and network = 'google'", [ids.yossi]);
});

test('the messages: the welcome has a place for the link, an edited welcome keeps its words; the nudge is seeded', async () => {
  const want = Object.fromEntries(DEFAULT_TEMPLATES.map((t) => [t.key, t]));
  const rows = Object.fromEntries((await all("select key, title, kind, station, body, updated_by from public.message_templates where key in ('welcome', $1)", [NUDGE_KEY])).map((r) => [r.key, r]));
  assert.equal(rows.welcome.body, want.welcome.body);
  assert.match(rows.welcome.body, /\{פרטי כניסה\}/);
  assert.equal(rows.welcome.updated_by, 'system');
  assert.deepEqual([rows[NUDGE_KEY].title, rows[NUDGE_KEY].kind, rows[NUDGE_KEY].body], [want[NUDGE_KEY].title, 'milestone', want[NUDGE_KEY].body]);
  // An office that edited the welcome before this migration: its words stay.
  const old = await freshDatabase({ upTo: FILE });
  await old.query("update public.message_templates set body = 'היי {לקוח}, ברוכים הבאים. הנוסח שלנו.' where key = 'welcome'");
  await old.exec(migrationSql(FILE));
  assert.equal((await old.query("select body from public.message_templates where key = 'welcome'")).rows[0].body, 'היי {לקוח}, ברוכים הבאים. הנוסח שלנו.');
  await old.close();
});

test('the migration runs again safely: nothing is lost, nothing is doubled', async () => {
  const snap = async () => JSON.stringify([
    await all('select * from public.client_access order by id'), await all('select * from public.client_access_links order by id'),
    await all('select key, body from public.message_templates order by key'), await all('select id, name from vault.secrets order by id'),
  ]);
  const before = await snap();
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  assert.equal(await snap(), before);
  const checks = await all("select conname from pg_constraint where conrelid = 'public.client_access'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'status'");
  assert.deepEqual(checks.map((r) => r.conname), ['client_access_status_check']);
  // The grants are as they were: anon runs the page's two functions, the office the rest.
  assert.deepEqual(await info(token), { state: 'done' });
  assert.equal((await q('ilai', 'select * from public.access_work_statuses($1)', [[ids.dana]])).length, 8);
  assert.match((await q('anon', 'select * from public.access_work_statuses()')).error, /permission denied/);
});
