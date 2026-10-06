// The security hardening of 6.10.2026
// (supabase/migrations/20261014100000_security_hardening.sql; docs/ops.md, section 36)
// on every migration in a real Postgres (PGlite). Each hole of the audit is first
// shown open on the database as it was BEFORE the migration (`was`), then closed
// after it, role by role: the owner, Irit, Lior, Ofir, Ilai, Nirel, an editor
// (Nadia), Eli, Stav and a signed-out visitor. The migration runs twice.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { buildPayload, emptyForm, NOTES_MAX } from '../../app/access-logic.js';
import { UPLOAD_TYPES, uploadTypeAllowed, fileProblem } from '../../app/files-logic.js';
import { OFFICE_PERSONS } from '../../app/team-rules.js';

const MIGRATION = '20261014100000_security_hardening.sql';
const MANUAL = '20261014100100_security_hardening_manual.sql';
// vault: who has the flag here. Nirel has it so that "assigned through a task" shows.
const PEOPLE = {
  owner: [null, true], irit: ['irit', true], lior: ['lior', true], ofir: ['ofir', true], ilai: ['ilai', false],
  nirel: ['nirel', true], nadia: ['nadia', false], eli: ['eli', false], stav: ['stav', false],
};
const OFFICE = ['owner', 'irit', 'lior', 'ofir', 'ilai'];
const OUTSIDE = ['nirel', 'nadia', 'eli'];
const EVERYONE = [...Object.keys(PEOPLE), 'anon'];
const DENIED = /not allowed|permission denied|row-level security/;
let db;
const users = {};
const ids = {};
const was = {};   // what the database answered before the migration

const userOf = (who) => (who === 'anon' ? null : users[who]);
// Rolled back: { rows } or { error }.
const q = (who, sql, params = []) => as(db, userOf(who), async (tx) => { const r = await tx.query(sql, params); return { rows: r.rows, affected: r.affectedRows }; });
// Committed, as a signed-in user, the signed-out role, or the service role.
async function keep(who, sql, params = []) {
  const user = who === 'anon' || who === 'service' ? null : users[who];
  const role = who === 'service' ? 'service_role' : user ? 'authenticated' : 'anon';
  const claims = user ? { sub: user.id, email: user.email, role, aud: 'authenticated' } : { role };
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      const r = await tx.query(sql, params);
      return { rows: r.rows, affected: r.affectedRows };
    });
  } catch (err) {
    return { error: err.message };
  }
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const secretOf = async (id) => (await one('select secret from vault.secrets where id = $1', [id]))?.secret ?? null;
const client = async (name, fields = {}) => {
  const cols = ['name', ...Object.keys(fields)];
  const { rows } = await db.query(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, [name, ...Object.values(fields)]);
  ids[name] = rows[0].id;
  return rows[0].id;
};
// A task as someone opens it in the browser (the database stamps who).
const task = async (who, clientId, owner, title = 'משימה') => {
  const r = await keep(who, 'insert into public.client_tasks (client_id, title, owner) values ($1, $2, $3) returning id', [clientId, title, owner]);
  if (r.error) throw new Error(`${who} → ${owner}: ${r.error}`);
  return r.rows[0].id;
};
// The client's form: Instagram with a login, Facebook to open, TikTok to renew.
const formPayload = (over = {}, notes = '') => {
  const f = emptyForm();
  f.main.instagram = { choice: 'have', username: 'ig_client', password: 'ig-from-client' };
  f.main.facebook = { choice: 'none', username: '', password: '' };
  f.main.tiktok = { choice: 'reset', username: 'tt_client', password: '' };
  Object.assign(f.main, over);
  f.notes = notes;
  return buildPayload(f);
};
const linkFor = async (clientId) => (await keep('ofir', 'select public.access_link_create($1) as l', [clientId])).rows[0].l;
const submit = async (token, payload) => (await keep('anon', 'select public.access_form_submit($1, $2::jsonb) as r', [token, JSON.stringify(payload)])).rows[0].r;
const sees = async (who, clientId) => (await q(who, 'select public.can_see_client($1) as ok', [clientId])).rows[0].ok;
const listed = async (who, clientId) => (await q(who, 'select id from public.clients where id = $1', [clientId])).rows.length === 1;
const vaultOk = async (who, clientId) => (await q(who, 'select public.can_use_client_vault($1) as ok', [clientId])).rows[0].ok;

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const [key, [person, vault]] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault, phone) values ($1, $2, $3, $4)', [email, person, vault, person ? '972500000000' : null]);
  }
  // A Natali client that Nadia edits, with a shoot in three days: Nirel, Nadia and Eli all see it.
  await client('shared', { shoot_type: 'natali', editor: 'nadia', shoot_at: new Date(Date.now() + 3 * 864e5).toISOString() });
  await client('plain');                                  // the office's only
  await client('kept');                                   // Nadia sees it through one task of the office
  await client('imported', { business: 'קפה דנה' });      // logins already in the vault
  await client('fresh', { business: 'פיצה רון' });
  await client('archived', { business: 'נסגר' });
  await client('linked', { links: JSON.stringify({ drive: 'http://old.example/folder', whatsapp: 'https://chat.whatsapp.com/abc' }) });
  ids.quote = (await one("insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot, status) values ('{\"x\":1}', 'דנה', 100000, 1200000, 'sent') returning id")).id;
  ids.quote2 = (await one("insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot, status) values ('{\"x\":2}', 'רון', 100000, 1200000, 'sent') returning id")).id;
  await db.query('update public.clients set quote_id = $2 where id = $1', [ids.plain, ids.quote]);

  // Tasks. Lior's on the shared client; one of the office's for Nadia on "kept".
  ids.liorTask = await task('ofir', ids.shared, 'lior', 'לאשר את הסרטונים');
  ids.nadiaTask = await task('ofir', ids.shared, 'nadia', 'לתקן כתוביות');
  ids.keptOffice = await task('ofir', ids.kept, 'nadia', 'בריף מהמשרד');
  ids.keptSelf = await task('nadia', ids.kept, 'nadia', 'משימה שפתחתי לעצמי');
  ids.nirelByNadia = await task('nadia', ids.kept, 'nirel', 'משימה שנדיה פתחה לניראל');

  // The vault of the imported client, and a filled form link with a note (as it was stored).
  ids.igOffice = (await keep('ofir', "select public.access_save($1, null, 'instagram', null, 'ig_office', 'ig-office-pass', 'ok', null) as id", [ids.imported])).rows[0].id;
  ids.ttOffice = (await keep('ofir', "select public.access_save($1, null, 'tiktok', null, 'tt_office', 'tt-office-pass', 'ok', null) as id", [ids.imported])).rows[0].id;
  const oldLink = await linkFor(ids.fresh);
  assert.deepEqual(await submit(oldLink.token, formPayload({}, 'קוד האימות אצל רון')), { state: 'done' });
  ids.oldLink = oldLink.id;
  // The links of the archived client, made while it was open.
  ids.scripts = (await keep('owner', 'select public.scripts_share_create($1) as l', [ids.archived])).rows[0].l;
  ids.gantt = (await keep('owner', 'select public.gantt_link_create($1) as l', [ids.archived])).rows[0].l;
  ids.gallery = (await keep('owner', 'select public.gallery_link_create($1) as l', [ids.archived])).rows[0].l;
  ids.archivedForm = await linkFor(ids.archived);
  assert.equal((await keep('owner', 'select public.archive_client($1)', [ids.archived])).error, undefined);

  // ── As it was ──
  was.editorCancels = (await q('nadia', 'select public.cancel_quote($1)', [ids.quote])).error;
  was.closeOthers = (await q('nadia', 'update public.client_tasks set done_at = now() where id = $1', [ids.liorTask])).affected;
  was.rewriteOthers = (await q('nadia', "update public.client_tasks set title = 'נמחק' where id = $1", [ids.liorTask])).affected;
  await db.query('update public.client_tasks set done_at = now() where id = $1', [ids.keptOffice]);
  await db.exec('alter table public.client_tasks disable trigger client_tasks_stamp');
  await db.query("update public.client_tasks set done_at = now() - interval '40 days' where id = $1", [ids.keptOffice]);
  await db.exec('alter table public.client_tasks enable trigger client_tasks_stamp');
  was.keepsBySelfTask = await sees('nadia', ids.kept);
  was.nirelSees = await sees('nirel', ids.kept);
  was.nirelVault = await vaultOk('nirel', ids.kept);
  was.columns = (await q('irit', "update public.clients set metricool_blog_id = '777', metricool_brand = 'x', quote_id = $2 where id = $1 returning metricool_blog_id, quote_id", [ids.fresh, ids.quote2])).rows[0];
  was.badLink = (await q('irit', "update public.clients set links = '{\"drive\":\"javascript:alert(1)\"}' where id = $1", [ids.fresh])).affected;
  was.vaultFlags = (await q('nadia', 'select email, vault from public.staff order by email')).rows?.length;
  was.note = (await q('ilai', 'select client_note from public.client_access_links where id = $1', [ids.oldLink])).rows[0].client_note;
  was.archivedScripts = (await keep('anon', 'select public.get_scripts($1) as r', [ids.scripts.token])).rows[0].r.state;
  was.archivedGantt = (await keep('anon', 'select public.get_gantt($1) as r', [ids.gantt.token])).rows[0].r.state;
  was.archivedGallery = (await one('select reason from private.gallery_check($1)', [ids.gallery.token])).reason;
  was.archivedFormLink = (await q('irit', 'select id from public.client_access_links where client_id = $1', [ids.archived])).rows.length;
  was.anon = (await all(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`)).map((r) => r.proname);
  was.mime = (await one("select allowed_mime_types as m from storage.buckets where id = 'client-files'")).m;
  was.url = (await keep('service', "insert into public.reminder_log (key, rule, person, level, channel, status, title, url) values ('k:before', 'r', 'irit', 'ring', 'app', 'sent', 't', '//evil.example/x') returning id")).error;
  // The form, before: the office's Instagram password leaves Vault for good.
  const before = await client('imported-before');
  const bi = (await keep('ofir', "select public.access_save($1, null, 'instagram', null, 'ig_office', 'ig-old', 'ok', null) as id", [before])).rows[0].id;
  const bs = (await one('select secret_id from public.client_access where id = $1', [bi])).secret_id;
  await submit((await linkFor(before)).token, formPayload());
  was.officeSecretAfterForm = await secretOf(bs);

  // The migration, twice (safe to run again).
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
});

test('the holes were open before the migration (what each test below closes)', () => {
  assert.equal(was.editorCancels, undefined, 'an editor cancelled a quote');
  assert.equal(was.closeOthers, 1, 'an editor closed Lior\'s task');
  assert.equal(was.rewriteOthers, 1, 'an editor rewrote Lior\'s task');
  assert.equal(was.keepsBySelfTask, true, 'an editor kept a client by a task opened for herself');
  assert.equal(was.nirelSees, true, 'an editor gave Nirel a client by a task in her name');
  assert.equal(was.nirelVault, true, 'and its vault');
  assert.deepEqual(was.columns, { metricool_blog_id: '777', quote_id: ids.quote2 }, 'Irit re-linked the brand and the agreement');
  assert.equal(was.badLink, 1, 'a javascript: link was stored');
  assert.equal(was.vaultFlags, Object.keys(PEOPLE).length, 'an editor read who has the vault');
  assert.equal(was.note, 'קוד האימות אצל רון', 'Ilai (no vault) read the client\'s note');
  assert.deepEqual([was.archivedScripts, was.archivedGantt, was.archivedGallery], ['ok', 'ok', null], 'an archived client\'s links kept opening');
  assert.equal(was.archivedFormLink, 1, 'and its form link was listed');
  assert.equal(was.officeSecretAfterForm, null, 'the form wiped the password the office had saved');
  assert.equal(was.mime, null, 'the bucket took any content type');
  assert.equal(was.url, undefined, 'a notification could point at another site');
  for (const f of ['client_tasks_stamp', 'clients_touch', 'office_reviews_stamp', 'protocol_stamp', 'package_deliverables']) assert.ok(was.anon.includes(f), f);
});

test('the migration file: nothing in it removes an object or a row, and there is no second file to paste by hand', () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null, 'the production tool refuses these three words, also in a comment or a name');
  assert.equal(existsSync(new URL(`../../supabase/migrations/${MANUAL}`, import.meta.url)), false);
  assert.equal(migrationFiles().at(-1), MIGRATION);
});

// ── 1. Quotes ──
test('cancelling a quote: the office only', async () => {
  for (const who of EVERYONE) {
    const r = await q(who, 'select public.cancel_quote($1)', [ids.quote]);
    if (OFFICE.includes(who)) assert.equal(r.error, undefined, who);
    else assert.match(r.error, DENIED, who);
  }
  // The signing page of a signed-out client still reads its quote.
  const token = (await one('select token from public.quotes where id = $1', [ids.quote])).token;
  assert.equal((await keep('anon', 'select public.get_quote($1) as r', [token])).error, undefined);
});

// ── 2. Tasks ──
test('a task of someone else: outside the office it is not closed, reopened or rewritten', async () => {
  for (const who of EVERYONE) {
    const close = await q(who, 'update public.client_tasks set done_at = now() where id = $1', [ids.liorTask]);
    const rewrite = await q(who, "update public.client_tasks set title = 'אחר', due_on = '2027-01-01', urgent = true where id = $1", [ids.liorTask]);
    if (OFFICE.includes(who)) {
      assert.equal(close.affected, 1, who);
      assert.equal(rewrite.affected, 1, who);
    } else if (OUTSIDE.includes(who)) {
      // They see the client and the task; the change is refused.
      assert.equal((await q(who, 'select id from public.client_tasks where id = $1', [ids.liorTask])).rows.length, 1, `${who} sees it`);
      assert.match(close.error, /someone else's/, who);
      assert.match(rewrite.error, /someone else's/, who);
    } else if (who === 'stav') {
      assert.equal(close.affected, 0, 'a sales agent sees no task');
    } else {
      assert.match(close.error, DENIED, who);
    }
  }
});

test('one\'s own task: done, undone, started and its result; what it says is the office\'s', async () => {
  for (const sql of [
    'update public.client_tasks set done_at = now() where id = $1',
    'update public.client_tasks set started_at = now() where id = $1',
    "update public.client_tasks set result = '{\"done\":\"x\"}', done_at = now() where id = $1",
  ]) assert.equal((await q('nadia', sql, [ids.nadiaTask])).affected, 1, sql);
  const undone = await as(db, users.nadia, async (tx) => {
    await tx.query('update public.client_tasks set done_at = now() where id = $1', [ids.nadiaTask]);
    return (await tx.query('update public.client_tasks set done_at = null where id = $1 returning done_at, done_by_email', [ids.nadiaTask])).rows[0];
  });
  assert.deepEqual(undone, { done_at: null, done_by_email: null });
  for (const set of ["title = 'אחר'", "due_on = '2027-01-01'", 'urgent = true', "brief = '{\"problem\":\"x\"}'", "source = 'p31'", 'id = gen_random_uuid()']) {
    assert.match((await q('nadia', `update public.client_tasks set ${set} where id = $1`, [ids.nadiaTask])).error, /only the office changes what a task says/, set);
  }
  assert.match((await q('nadia', "update public.client_tasks set owner = 'anna' where id = $1", [ids.nadiaTask])).error, /only the office moves a task/);
  // Ofir changes all of it.
  assert.equal((await q('ofir', "update public.client_tasks set title = 'אחר', due_on = '2027-01-01', owner = 'anna' where id = $1", [ids.nadiaTask])).affected, 1);
});

test('the screens outside the office still work: a pause notice to Lior and Ofir, closed again by the editor who opened it', async () => {
  // app/editor.js pause(): a task for each of them, on a client the editor sees.
  const a = await task('nadia', ids.shared, 'lior', 'נדיה עצרה את העריכה');
  const b = await task('nadia', ids.shared, 'ofir', 'נדיה עצרה את העריכה');
  // resume(): she closes what she opened, though it is theirs.
  for (const id of [a, b]) assert.equal((await keep('nadia', 'update public.client_tasks set done_at = now() where id = $1', [id])).affected, 1);
  assert.equal((await one('select done_by_email from public.client_tasks where id = $1', [a])).done_by_email, 'nadia@astrateg.test');
  // An escalation to Lior from the card, Eli's and Nirel's too.
  for (const who of OUTSIDE) assert.ok(await task(who, ids.shared, 'lior', `חריגה מ־${who}`), who);
  // Not on a client they do not see.
  for (const who of [...OUTSIDE, 'stav']) {
    assert.match((await keep(who, "insert into public.client_tasks (client_id, title, owner) values ($1, 'x', 'lior')", [ids.plain])).error, DENIED, who);
  }
  // The system's own writes (the status page, WhatsApp answers: no email in the session) are not limited.
  assert.equal((await keep('service', 'update public.client_tasks set done_at = now(), title = title where id = $1', [ids.nadiaTask])).affected, 1);
  await db.query('update public.client_tasks set done_at = null where id = $1', [ids.nadiaTask]);
});

test('a task opened outside the office gives nobody a client or its vault; the office\'s and the system\'s do', async () => {
  // Nadia's only way to "kept" was the office's task, finished 40 days ago. Her own
  // task there no longer keeps the client; the one she opened for Nirel gives Nirel nothing.
  assert.equal(await sees('nadia', ids.kept), false);
  assert.equal(await listed('nadia', ids.kept), false);
  assert.equal(await sees('nirel', ids.kept), false);
  assert.equal(await listed('nirel', ids.kept), false);
  assert.equal(await vaultOk('nirel', ids.kept), false);
  assert.equal((await q('nirel', 'select id from public.client_tasks where client_id = $1', [ids.kept])).rows.length, 0);
  // The two forms of the rule agree, for everyone and every client.
  for (const who of Object.keys(PEOPLE)) {
    const set = new Set((await q(who, 'select id from public.clients')).rows.map((r) => r.id));
    for (const name of ['shared', 'plain', 'kept', 'imported', 'fresh', 'linked']) {
      assert.equal(await sees(who, ids[name]), set.has(ids[name]), `${who} / ${name}`);
    }
  }
  // A task the office opens for Nirel: she sees the client, and (with the flag) its vault.
  const t = await task('ofir', ids.kept, 'nirel', 'בריף לניראל');
  assert.equal(await sees('nirel', ids.kept), true);
  assert.equal(await listed('nirel', ids.kept), true);
  assert.equal(await vaultOk('nirel', ids.kept), true);
  await db.query('update public.client_tasks set done_at = now() where id = $1', [t]);
  assert.equal(await sees('nirel', ids.kept), true, 'for 30 days after it was finished');
  await db.query('update public.client_tasks set owner = $2 where id = $1', [t, 'irit']);
  assert.equal(await sees('nirel', ids.kept), false);
  // A task the system opens (a fix the client asked for on the status page: no one's email).
  const s = (await one("insert into public.client_tasks (client_id, title, owner) values ($1, 'תיקון שהלקוח ביקש', 'eli') returning id, created_by_email", [ids.plain]));
  assert.equal(s.created_by_email, '');
  assert.equal(await sees('eli', ids.plain), true);
  assert.equal(await listed('eli', ids.plain), true);
  await db.query('update public.client_tasks set done_at = now() where id = $1', [s.id]);
  // Each office person's task counts (the same list as is_office and the team screen).
  assert.deepEqual(OFFICE_PERSONS, ['irit', 'lior', 'ofir', 'ilai']);
  for (const who of OFFICE) {
    const id = await task(who, ids.linked, 'nadia', `מ־${who}`);
    assert.equal(await sees('nadia', ids.linked), true, who);
    await db.query('update public.client_tasks set owner = $2 where id = $1', [id, 'irit']);
    assert.equal(await sees('nadia', ids.linked), false, who);
  }
});

// ── 3. The client's logins form ──
test('the form never replaces a login the office saved: it goes into a row beside it, for the office to decide', async () => {
  const before = await all('select * from public.client_access where client_id = $1 order by id', [ids.imported]);
  const link = await linkFor(ids.imported);
  assert.deepEqual(await submit(link.token, formPayload()), { state: 'done' });
  const rows = await all('select * from public.client_access where client_id = $1 order by created_at, id', [ids.imported]);
  for (const b of before) assert.deepEqual(rows.find((r) => r.id === b.id), b, `${b.network}: exactly as the office left it`);
  assert.equal(await secretOf(before.find((r) => r.id === ids.igOffice).secret_id), 'ig-office-pass');
  assert.equal(await secretOf(before.find((r) => r.id === ids.ttOffice).secret_id), 'tt-office-pass');
  const added = rows.filter((r) => !before.some((b) => b.id === r.id));
  const by = Object.fromEntries(added.map((r) => [r.network, r]));
  assert.deepEqual(added.map((r) => r.network).sort(), ['facebook', 'instagram', 'tiktok']);
  // Instagram: the client's login, waiting ("התקבל מהלקוח, עוד לא נבדק"), labelled as the client's.
  assert.deepEqual([by.instagram.status, by.instagram.username, by.instagram.updated_by], ['new', 'ig_client', 'client-form']);
  assert.match(by.instagram.label, /^מהלקוח, \d{1,2}\.\d{1,2}\.\d{4}$/);
  assert.match(by.instagram.note, /הפרטים שכבר היו בכספת נשארו בשורה נפרדת/);
  assert.equal(await secretOf(by.instagram.secret_id), 'ig-from-client');
  // TikTok "לחדש סיסמה": said beside the office's working login, which keeps its password.
  assert.deepEqual([by.tiktok.status, by.tiktok.username, by.tiktok.secret_id], ['broken', 'tt_client', null]);
  // Facebook was not in the vault: a plain new row, as before.
  assert.deepEqual([by.facebook.status, by.facebook.label], ['missing', null]);
  assert.deepEqual((await one('select summary from public.client_access_links where id = $1', [link.id])).summary, [
    { network: 'instagram', label: null, choice: 'have', beside: true },
    { network: 'facebook', label: null, choice: 'none' },
    { network: 'tiktok', label: null, choice: 'reset', beside: true },
  ]);
  // Whoever has the vault reads both and sees which is which; the office decides, and
  // only an action of the office takes a password out (access_save, the card's removal).
  const seen = (await q('ofir', 'select network, label, status from public.client_access where client_id = $1 and network = $2 order by created_at', [ids.imported, 'instagram'])).rows;
  assert.deepEqual(seen.map((r) => r.status), ['ok', 'new']);
  assert.equal((await keep('ofir', "select public.access_save($1, $2, 'instagram', 'העמוד', 'ig_client', null, 'ok', null)", [ids.imported, by.instagram.id])).error, undefined);
  assert.equal(await secretOf(by.instagram.secret_id), 'ig-from-client');
  // A second form: the row Ofir confirmed is now the office's too; nothing of the three moves.
  const l2 = await linkFor(ids.imported);
  assert.deepEqual(await submit(l2.token, formPayload({ instagram: { choice: 'have', username: 'ig_again', password: 'ig-second' } })), { state: 'done' });
  for (const [id, pw] of [[ids.igOffice, 'ig-office-pass'], [by.instagram.id, 'ig-from-client'], [ids.ttOffice, 'tt-office-pass']]) {
    assert.equal(await secretOf((await one('select secret_id from public.client_access where id = $1', [id])).secret_id), pw);
  }
  assert.equal((await all("select 1 from public.client_access where client_id = $1 and network = 'instagram'", [ids.imported])).length, 3);
  // The client's own unchecked rows (TikTok, Facebook) were updated in place, not doubled.
  assert.equal((await all("select 1 from public.client_access where client_id = $1 and network in ('tiktok', 'facebook')", [ids.imported])).length, 3);
});

test('a client with nothing in the vault: one row per network, as before; its own row takes a corrected login in place', async () => {
  const c = await client('new-client');
  assert.deepEqual(await submit((await linkFor(c)).token, formPayload()), { state: 'done' });
  const first = await all('select id, network, label, status, secret_id from public.client_access where client_id = $1 order by network', [c]);
  assert.deepEqual(first.map((r) => [r.network, r.label, r.status]), [['facebook', null, 'missing'], ['instagram', null, 'new'], ['tiktok', null, 'broken']]);
  assert.deepEqual(await submit((await linkFor(c)).token, formPayload({ instagram: { choice: 'have', username: 'ig2', password: 'ig-corrected' } })), { state: 'done' });
  const second = await all('select id, network, label, status, secret_id from public.client_access where client_id = $1 order by network', [c]);
  assert.deepEqual(second.map((r) => r.id), first.map((r) => r.id));
  assert.equal(await secretOf(second[1].secret_id), 'ig-corrected');
  assert.equal(second[1].secret_id, first[1].secret_id, 'the same secret, updated');
});

test('the client\'s note: capped, and read only by whoever has the vault', async () => {
  assert.equal(NOTES_MAX, 300);
  const row = await one('select client_note, client_note_private from public.client_access_links where id = $1', [ids.oldLink]);
  assert.deepEqual(row, { client_note: null, client_note_private: 'קוד האימות אצל רון' }, 'the note that was stored moved');
  const c = await client('noted');
  const l = await linkFor(c);
  assert.deepEqual(await submit(l.token, formPayload({}, 'n'.repeat(301))), { state: 'refused', left: 4 });
  assert.deepEqual(await submit(l.token, formPayload({}, '  קוד האימות מגיע לדנה  ')), { state: 'done' });
  for (const who of EVERYONE) {
    const notes = await q(who, 'select * from public.access_link_notes($1)', [[c, ids.fresh]]);
    const col = await q(who, 'select client_note from public.client_access_links where client_id = $1', [c]);
    const hidden = await q(who, 'select client_note_private from public.client_access_links where client_id = $1', [c]);
    assert.match(hidden.error, /permission denied/, `${who}: the column itself is not granted`);
    if (['owner', 'irit', 'lior', 'ofir'].includes(who)) {
      assert.deepEqual(notes.rows.map((r) => r.note).sort(), ['קוד האימות אצל רון', 'קוד האימות מגיע לדנה'], who);
      assert.deepEqual(col.rows, [{ client_note: null }], who);
    } else if (who === 'anon') {
      assert.match(notes.error, /permission denied/);
    } else {
      // Ilai (the office, no vault flag), Nirel (the flag, not her client), an editor, Eli, a sales agent.
      assert.deepEqual(notes.rows, [], who);
      if (who === 'ilai') assert.deepEqual(col.rows, [{ client_note: null }]);
    }
  }
});

// ── 4. Columns of a client ──
test('the brand and the agreement of a client change only through their own functions', async () => {
  await db.query("update public.clients set metricool_blog_id = '4455', metricool_brand = 'קפה דנה' where id = $1", [ids.plain]);
  for (const who of OFFICE) {
    const r = await q(who, "update public.clients set metricool_blog_id = '999', metricool_brand = 'אחר', quote_id = $2, notes = 'נשמר' where id = $1 returning metricool_blog_id, metricool_brand, quote_id, status", [ids.plain, ids.quote2]);
    assert.deepEqual(r.rows, [{ metricool_blog_id: '4455', metricool_brand: 'קפה דנה', quote_id: ids.quote, status: 'active' }], `${who}: the three stay`);
    const saved = await as(db, users[who], async (tx) => {
      await tx.query("update public.clients set metricool_blog_id = null, quote_id = null, notes = 'נשמר' where id = $1", [ids.plain]);
      return (await tx.query('select notes from public.clients_private($1)', [[ids.plain]])).rows[0].notes;
    });
    assert.equal(saved, 'נשמר', `${who}: the rest of the row is saved`);
  }
  for (const who of [...OUTSIDE, 'stav']) assert.equal((await q(who, "update public.clients set metricool_blog_id = '999' where id = $1", [ids.shared])).affected, 0, who);
  assert.match((await q('anon', "update public.clients set metricool_blog_id = '999' where id = $1", [ids.plain])).error, DENIED);
  // The owners of the columns still write them.
  for (const who of ['ilai', 'owner']) {
    const r = await q(who, "select public.gantt_set_brand($1, '8800', 'מותג') as b", [ids.fresh]);
    assert.deepEqual(r.rows[0].b, { blogId: '8800', brand: 'מותג' }, who);
  }
  for (const who of ['irit', 'lior', 'ofir', 'nadia']) assert.match((await q(who, "select public.gantt_set_brand($1, '8800', 'מותג')", [ids.fresh])).error, DENIED, who);
  // The metricool function (service role) and an import (the database owner).
  assert.equal((await keep('service', "update public.clients set metricool_brand = 'מהסנכרון' where id = $1", [ids.plain])).affected, 1);
  assert.equal((await one('select metricool_brand from public.clients where id = $1', [ids.plain])).metricool_brand, 'מהסנכרון');
  // "לקוח חדש" from a signed agreement: the office sets quote_id when it opens the client; never a brand.
  const made = await q('irit', "insert into public.clients (name, quote_id, metricool_blog_id, metricool_brand) values ('חדש', $1, '321', 'x') returning quote_id, metricool_blog_id, metricool_brand", [ids.quote2]);
  assert.deepEqual(made.rows, [{ quote_id: ids.quote2, metricool_blog_id: null, metricool_brand: null }]);
  // The trigger sorts before the one that reads the brand (clients_metricool_none_guard).
  const order = (await all("select tgname from pg_trigger where tgrelid = 'public.clients'::regclass and not tgisinternal order by tgname")).map((r) => r.tgname);
  assert.ok(order.indexOf('clients_columns_guard') < order.indexOf('clients_metricool_none_guard'));
});

test('a client\'s links: a signed-in user stores https:// addresses only; what is already there does not block the row', async () => {
  const set = (who, links, id = ids.fresh) => q(who, 'update public.clients set links = $2::jsonb where id = $1 returning links', [id, JSON.stringify(links)]);
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>1</script>', 'http://drive.google.com/x', '//evil.example/x',
    'drive.google.com/x', 'https://a b', 'https://x"onmouseover="1', ' https://drive.google.com/x', `https://x.example/${'a'.repeat(2000)}`]) {
    assert.match((await set('irit', { drive: bad })).error, /only an https:\/\/ address/, bad);
  }
  for (const bad of [{ drive: 5 }, { drive: ['https://x.example'] }, { drive: { a: 1 } }]) assert.match((await set('ofir', bad)).error, /only an https:\/\/ address/, JSON.stringify(bad));
  for (const who of OFFICE) {
    const ok = { drive: 'https://drive.google.com/drive/folders/abc?x=1#y', whatsapp: '', gantt: null };
    assert.deepEqual((await set(who, ok)).rows[0].links, ok, who);
  }
  assert.match((await q('irit', "insert into public.clients (name, links) values ('x', '{\"drive\":\"javascript:alert(1)\"}')")).error, /only an https:\/\/ address/);
  // An imported row with an http:// link: the other links and the other fields still save;
  // the odd one can stay, be fixed or be cleared, and not be changed to another odd one.
  const old = { drive: 'http://old.example/folder', whatsapp: 'https://chat.whatsapp.com/abc' };
  assert.deepEqual((await set('irit', { ...old, scripts: 'https://docs.google.com/d/1' }, ids.linked)).rows[0].links, { ...old, scripts: 'https://docs.google.com/d/1' });
  assert.equal((await q('irit', "update public.clients set package_name = 'סושיאל' where id = $1", [ids.linked])).affected, 1);
  assert.equal((await set('irit', { whatsapp: old.whatsapp }, ids.linked)).error, undefined);
  assert.match((await set('irit', { ...old, drive: 'http://other.example' }, ids.linked)).error, /only an https:\/\/ address/);
  // An import as the database owner is not checked (the pages skip what is not https).
  await db.query("update public.clients set links = links || '{\"dropbox\":\"http://legacy.example\"}' where id = $1", [ids.linked]);
});

// ── 5. Archive ──
test('archive: every table with a client is hidden (but the two named ones), and the three link pages say "closed"', async () => {
  const missing = (await all(`select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'client_id' and c.table_name <> 'clients'
      and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.table_name
                      and p.policyname = 'archived clients are hidden' and p.permissive = 'RESTRICTIVE') order by 1`)).map((r) => r.table_name);
  assert.deepEqual(missing, ['client_admin_log', 'staff_tasks']);
  for (const who of OFFICE) {
    assert.equal((await q(who, 'select id from public.client_access_links where client_id = $1', [ids.archived])).rows.length, 0, who);
    assert.ok((await q(who, 'select id from public.client_access_links where client_id = $1', [ids.fresh])).rows.length >= 1, who);
  }
  const state = async () => [
    (await keep('anon', 'select public.get_scripts($1) as r', [ids.scripts.token])).rows[0].r.state,
    (await keep('anon', 'select public.get_gantt($1) as r', [ids.gantt.token])).rows[0].r.state,
    (await one('select reason from private.gallery_check($1)', [ids.gallery.token])).reason,
    (await keep('anon', 'select public.access_form_info($1) as r', [ids.archivedForm.token])).rows[0].r.state,
  ];
  assert.deepEqual(await state(), ['closed', 'closed', 'closed', 'closed']);
  // Restored: everything opens again, as it was.
  assert.equal((await keep('owner', 'select public.restore_client($1)', [ids.archived])).error, undefined);
  assert.deepEqual(await state(), ['ok', 'ok', null, 'ok']);
  assert.equal((await q('irit', 'select id from public.client_access_links where client_id = $1', [ids.archived])).rows.length, 1);
  assert.equal((await keep('owner', 'select public.archive_client($1)', [ids.archived])).error, undefined);
  assert.deepEqual(await state(), ['closed', 'closed', 'closed', 'closed']);
  // The check functions stay out of the API's reach.
  for (const who of ['anon', 'nadia']) {
    assert.match((await q(who, 'select * from private.gantt_check($1)', [ids.gantt.token])).error, /permission denied/, who);
    assert.match((await q(who, 'select * from private.gallery_check($1)', [ids.gallery.token])).error, /permission denied/, who);
  }
});

// ── 6. The staff list ──
test('the staff list: names, emails and numbers for the screens; who has the vault is not readable', async () => {
  for (const who of EVERYONE) {
    const dir = await q(who, 'select email, person from public.staff order by email');
    const phones = await q(who, 'select person, phone from public.staff where person is not null');
    if (who === 'anon') {
      assert.match(dir.error, /permission denied/);
      continue;
    }
    // The directory (who marked what, by name) and the handoff buttons' numbers: every screen.
    assert.equal(dir.rows.length, Object.keys(PEOPLE).length, who);
    assert.equal(phones.rows.length, Object.keys(PEOPLE).length - 1, who);
    assert.equal((await q(who, 'select person from public.staff where email = $1', [users[who].email])).rows.length, 1, who);
    for (const sql of ['select vault from public.staff', 'select email, vault from public.staff where vault', 'select created_at from public.staff', 'select * from public.staff']) {
      assert.match((await q(who, sql)).error, /permission denied/, `${who}: ${sql}`);
    }
    assert.match((await q(who, "update public.staff set vault = true where email = $1", [users[who].email])).error, /permission denied/, who);
  }
  // The rules that read the flag themselves are as they were.
  for (const who of Object.keys(PEOPLE)) assert.equal((await q(who, 'select public.can_use_vault() as ok')).rows[0].ok, PEOPLE[who][1], who);
  assert.equal(await vaultOk('ofir', ids.plain), true);
  assert.equal(await vaultOk('ilai', ids.plain), false);
});

// ── 7. The bucket ──
test('the files bucket takes the app\'s list of content types, and no web page or script', async () => {
  const b = await one("select public, allowed_mime_types as m from storage.buckets where id = 'client-files'");
  assert.equal(b.public, false);
  assert.deepEqual(b.m, UPLOAD_TYPES);
  for (const ok of ['image/jpeg', 'image/svg+xml', 'video/mp4', 'video/quicktime', 'application/pdf', 'application/postscript', 'font/ttf',
    'application/zip', 'application/octet-stream', '', 'text/plain', 'IMAGE/PNG', 'text/plain; charset=utf-8',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) assert.equal(uploadTypeAllowed(ok), true, ok);
  for (const bad of ['text/html', 'application/xhtml+xml', 'text/javascript', 'application/javascript', 'application/xml', 'text/xml', 'image/', 'application/x-msdownload']) {
    assert.equal(uploadTypeAllowed(bad), false, bad);
  }
  // The card says so before anything is sent, for the free kinds too.
  assert.match(fileProblem('material_other', { name: 'page.html', size: 10, type: 'text/html' }), /סוג הקובץ הזה \(text\/html\) לא נשמר/);
  assert.equal(fileProblem('material_other', { name: 'menu.pdf', size: 10, type: 'application/pdf' }), null);
  assert.equal(fileProblem('deliverable_other', { name: 'font.ttf', size: 10, type: 'font/ttf' }), null);
  assert.equal(fileProblem('material_other', { name: 'logo.ai', size: 10, type: '' }), null);
});

// ── 8. What the signed-out role can call ──
test('a signed-out visitor can call exactly the ten functions of the public pages', async () => {
  const can = async (role) => (await all(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege($1, p.oid, 'execute') order by 1`, [role])).map((r) => r.proname);
  assert.deepEqual(await can('anon'), [
    'access_form_info', 'access_form_submit',           // access.html
    'answer_survey', 'approve_item',                    // status.html
    'get_gantt', 'get_quote', 'get_scripts', 'get_status', // gantt.html, q.html, scripts-view.html, status.html
    'request_fix', 'sign_quote',                        // status.html, q.html
  ]);
  const privateFns = (await all(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'execute')`)).map((r) => r.proname);
  assert.deepEqual(privateFns, []);
  const signedIn = await can('authenticated');
  for (const f of ['client_tasks_stamp', 'clients_touch', 'office_reviews_stamp', 'protocol_stamp', 'package_deliverables',
    'client_tasks_scope_guard', 'clients_columns_guard', 'clients_links_guard']) assert.ok(!signedIn.includes(f), f);
  assert.ok(signedIn.includes('access_link_notes'));
  // The triggers still fire for the people who write (they need no grant), and signing
  // still computes what the agreement gives (the trigger calls package_deliverables).
  const t = await q('nadia', "insert into public.client_tasks (client_id, title, owner) values ($1, 'x', 'nadia') returning created_by_email", [ids.shared]);
  assert.equal(t.rows[0].created_by_email, 'nadia@astrateg.test');
  assert.equal((await q('irit', "update public.clients set name = 'שם' where id = $1 returning updated_at", [ids.fresh])).rows.length, 1);
  assert.match((await q('irit', "select public.package_deliverables('{}'::jsonb)")).error, /permission denied/);
});

// ── 9. A notification's address ──
test('a notification opens a page of the site only', async () => {
  const add = (url, key) => keep('service', "insert into public.reminder_log (key, rule, person, level, channel, status, title, url) values ($2, 'r', 'irit', 'ring', 'app', 'sent', 't', $1) returning id", [url, key]);
  let n = 0;
  for (const bad of ['//evil.example/x', '/\\evil.example', '\\\\evil.example', 'https://evil.example', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)',
    'clients.html\\@evil.example', '../x.html', 'x/clients.html', 'clients.html?a b', 'clients']) {
    assert.match((await add(bad, `k:bad:${n += 1}`)).error, /reminder_log_url/, bad);
  }
  for (const ok of ['clients.html#mine', 'client.html?id=3f0c&p=p12#access', 'deal.html', 'scripts-view.html', 'gantt.html?id=1&m=2026-10&d=2026-10-06', null]) {
    assert.equal((await add(ok, `k:ok:${n += 1}`)).error, undefined, String(ok));
  }
  // The row written before the migration stays (the new check is for new rows).
  assert.equal((await all("select 1 from public.reminder_log where key = 'k:before'")).length, 1);
});

test('the migration runs a third time and changes nothing', async () => {
  const snap = async () => JSON.stringify([
    await all("select tablename, policyname, cmd, permissive, qual, with_check from pg_policies where schemaname in ('public', 'storage') order by 1, 2"),
    await all("select tgrelid::regclass::text t, tgname from pg_trigger where not tgisinternal order by 1, 2"),
    await all("select conrelid::regclass::text t, conname from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2"),
    await all("select grantee, table_name, column_name, privilege_type from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4"),
    await all('select * from public.client_access order by id'), await all('select * from public.client_access_links order by id'),
    await all('select id, name, secret from vault.secrets order by id'), await all('select * from public.client_tasks order by id'),
    await all("select allowed_mime_types from storage.buckets where id = 'client-files'"),
  ]);
  const before = await snap();
  await db.exec(migrationSql(MIGRATION));
  assert.equal(await snap(), before);
});
