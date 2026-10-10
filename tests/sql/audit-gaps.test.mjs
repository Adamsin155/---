// Protocol version 10 in the database (supabase/migrations/20261024100000_audit_gaps_v10.sql;
// docs/ops.md, section 58), on every migration in a real Postgres (PGlite):
//   - the migration is the newest one, with none of the words the production deploy tool
//     refuses, and every UPDATE in it has a WHERE;
//   - the version and the column default;
//   - the clients that were already there: a Gantt that was already sent → Ilai's final
//     check (29ב) is imported history; an editor's self-check that was already finished →
//     the five critical mistakes are "לא רלוונטי"; nothing else is written; running the
//     migration again later closes nothing that is really waiting;
//   - "הלקוח ביקש תיקון" written down by the office opens the same task as the client's own
//     request on the status page (the same person, the same due day), counts as a round,
//     and only the office may call it;
//   - a task on the spot for Nirel is refused without her brief, by either function;
//   - the writers table: 23 new rows, and the database agrees with the app on who marks what
//     (the photographer's "קיבלתי", refused until now, among them);
//   - Ilai may upload a logo.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { PROTOCOL_VERSION, PROCESSES, BRIEF_MUST } from '../../app/protocol.js';
import { writerRows, mayWrite, sqlBlock, latestBlock } from '../../scripts/protocol-writers.mjs';
import { wordingFor } from '../../app/status-logic.js';
import { uploadKinds } from '../../app/files-logic.js';

const MIGRATION = '20261024100000_audit_gaps_v10.sql';
const FINAL = PROCESSES.find((p) => p.id === 'p29b').items.map((i) => i.key);
const FIVE = ['sound', 'exposure', 'stable', 'angles', 'export'].map((k) => `p22.self.${k}`);
const OLD_SELF = ['spelling', 'broll', 'closing', 'complete'].map((k) => `p22.self.${k}`);
const DENIED = /not allowed|permission denied|row-level security/;
let db;
const ids = {};
const users = {};
const check = (id, key, state = 'done', note = null) => db.query('insert into public.protocol_checks (client_id, item_key, state, note) values ($1, $2, $3, $4)', [id, key, state, note]);
const marksLike = async (id, like) => Object.fromEntries((await db.query('select item_key, state, note from public.protocol_checks where client_id = $1 and item_key like $2 order by item_key', [id, like])).rows.map((r) => [r.item_key, `${r.state}:${r.note}`]));

// A call that stays (committed), as a signed-in user or anon.
async function call(who, sql, params = []) {
  const user = who === 'anon' ? null : users[who];
  const claims = user ? { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated' } : { role: 'anon' };
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`set local role ${user ? 'authenticated' : 'anon'}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'TestBrowser/1.0' })]);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (err) {
    return { error: err.message };
  }
}
const q = (who, sql, params = []) => as(db, who === 'anon' ? null : users[who], async (tx) => ({ rows: (await tx.query(sql, params)).rows }));

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const name of ['gantt', 'round', 'selfdone', 'selfpart', 'plain', 'landing', 'fix', 'videos']) {
    const { rows } = await db.query("insert into public.clients (name, shoot_type, editor) values ($1, 'dms', 'nadia') returning id, protocol_version", [name]);
    ids[name] = rows[0].id;
    assert.equal(rows[0].protocol_version, 9, 'before the migration');
  }
  // The Gantt was already sent to the client (the main shoot; and in another client, only its second shoot round).
  await check(ids.gantt, 'p29.filled');
  await check(ids.gantt, 'p29.sent');
  await db.query(`update public.clients set rounds = '[{"n":2,"shoot_type":"dms"}]'::jsonb where id = $1`, [ids.round]);
  await check(ids.round, 'r2.p29.sent', 'na', 'לא נדרש');
  // The editor finished the four self-checks that existed (one as "לא רלוונטי"); another editor ticked three of them.
  for (const k of OLD_SELF) await check(ids.selfdone, k, k === 'p22.self.broll' ? 'na' : 'done');
  for (const k of OLD_SELF.slice(0, 3)) await check(ids.selfpart, k);
  // A client in landing whose Gantt was sent long ago: history like any other (it must not be asked when it is activated).
  await db.query('update public.clients set landing = true where id = $1', [ids.landing]);
  await check(ids.landing, 'p29.sent', 'done', 'ייבוא');
  // Work that waits for the client's answer: the first graphics of one client, the videos of another.
  await check(ids.fix, 'p07.sent');
  await check(ids.videos, 'p26.sent');

  await db.exec(migrationSql(MIGRATION));

  for (const [key, person] of Object.entries({ owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', nirel: 'nirel', eli: 'eli' })) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
});

test('the migration is the newest one, right after the migration of version 9, and has none of the words the production deploy tool refuses', () => {
  const files = migrationFiles();
  assert.equal(files.at(-1), MIGRATION);
  assert.equal(files.at(-2), '20261023100000_ofir_fast_ladder_v9.sql');
  const sql = readFileSync(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  assert.deepEqual(sql.match(/drop|delete|truncate/gi), null);
  // Every UPDATE in it has a WHERE (tests/safeupdate.test.mjs reads the function bodies; this is the whole file).
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  // A key that spells one of those words is still written in two halves and reads the same.
  assert.match(sql, /'p24\.d' \|\| 'ropbox'/);
  // The block in the file is exactly what the script generates from app/protocol.js now.
  assert.deepEqual([latestBlock().file, latestBlock().block === sqlBlock()], [MIGRATION, true]);
  // No table, no policy, no trigger is created, and no index: one column, functions, marks and the writers' rows.
  assert.deepEqual(sql.replace(/--[^\n]*/g, '').match(/create\s+(table|policy|trigger|index|type)/gi), null);
});

test('version 10: the function, the column default, a new client; a client that started before keeps its version', async () => {
  assert.equal(PROTOCOL_VERSION, 10);
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 10);
  const d = await db.query("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'protocol_version'");
  assert.equal(d.rows[0].column_default, '10');
  assert.equal((await db.query("insert into public.clients (name) values ('new') returning protocol_version")).rows[0].protocol_version, 10);
  assert.equal((await db.query('select protocol_version from public.clients where id = $1', [ids.gantt])).rows[0].protocol_version, 9);
  const fn = await db.query("select has_function_privilege('authenticated', 'private.protocol_version_current()', 'execute') as a, has_function_privilege('anon', 'private.protocol_version_current()', 'execute') as b");
  assert.deepEqual(fn.rows[0], { a: false, b: false });
});

test('the clients that were already there: a Gantt already sent makes the final check history; a finished self-check is not asked for the five; nothing else is written', async () => {
  // 29ב: all 14 items, as imported history, under the key of the shoot whose Gantt was sent.
  const g = await marksLike(ids.gantt, 'p29b.%');
  assert.deepEqual(Object.keys(g).sort(), [...FINAL].sort());
  assert.ok(Object.values(g).every((v) => v === 'done:ייבוא'));
  const r = await marksLike(ids.round, '%p29b.%');
  assert.deepEqual(Object.keys(r).sort(), FINAL.map((k) => `r2.${k}`).sort());
  assert.deepEqual(await marksLike(ids.round, 'p29b.%'), {}, 'the main shoot of that client did not send its Gantt: it will be asked');
  assert.equal(Object.keys(await marksLike(ids.landing, 'p29b.%')).length, 14, 'a client in landing: the same history');
  // The five critical mistakes: "לא רלוונטי", with the reason, only where the four that existed were all ticked.
  const s = await marksLike(ids.selfdone, 'p22.self.%');
  assert.deepEqual(FIVE.map((k) => s[k]), Array(5).fill('na:גרסה 10: הבדיקה העצמית הושלמה לפני שהפריט נוסף'));
  assert.deepEqual(Object.keys(await marksLike(ids.selfpart, 'p22.self.%')).sort(), OLD_SELF.slice(0, 3).sort());
  // Ofir's five (25) are never written by the migration: the app does not ask them of videos he approved (`passedIf`).
  assert.equal((await db.query("select count(*)::int as n from public.protocol_checks where item_key like '%p25.q.sound'")).rows[0].n, 0);
  // A client with none of these: nothing at all.
  assert.equal((await db.query('select count(*)::int as n from public.protocol_checks where client_id = $1', [ids.plain])).rows[0].n, 0);
});

test('the migration runs again safely: nothing doubled, and a step that is really waiting is neither closed nor marked', async () => {
  // After the migration: a Gantt is sent (Ilai's final check opens for real), and an editor finishes the four old self-checks.
  const { rows } = await db.query("insert into public.clients (name, shoot_type) values ('later', 'dms'), ('editing', 'dms') returning id");
  ids.later = rows[0].id;
  ids.editing = rows[1].id;
  await check(ids.later, 'p29.sent');
  for (const k of OLD_SELF) await check(ids.editing, k);
  await check(ids.plain, 'p29.sent'); // a client of version 9 reaches the step now
  const before = (await db.query('select count(*)::int as n from public.protocol_checks')).rows[0].n;
  const writers = (await db.query('select key, proc, round, persons from private.protocol_writers order by key')).rows;
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
  assert.equal((await db.query('select count(*)::int as n from public.protocol_checks')).rows[0].n, before);
  for (const k of ['later', 'plain']) assert.deepEqual(await marksLike(ids[k], 'p29b.%'), {}, k);
  assert.deepEqual(Object.keys(await marksLike(ids.editing, 'p22.self.%')).sort(), [...OLD_SELF].sort());
  assert.deepEqual((await db.query('select key, proc, round, persons from private.protocol_writers order by key')).rows, writers);
  assert.equal((await db.query('select private.protocol_version_current() as v')).rows[0].v, 10);
  assert.equal((await db.query("select count(*)::int as n from information_schema.columns where table_name = 'staff_tasks' and column_name = 'brief'")).rows[0].n, 1);
});

test('"הלקוח ביקש תיקון" written down by the office: the same task as the client\'s own request (who fixes, by when), a round of its own, and only the office may', async () => {
  // Who may: the owner, Irit, Lior, Ofir. Nobody else, and never without a login.
  for (const who of ['ilai', 'nadia', 'eli', 'anon']) {
    const r = await q(who, 'select public.staff_request_fix($1, $2, $3)', [ids.fix, 'p07.approved', 'להחליף טלפון']);
    assert.match(r.error, DENIED, who);
  }
  // What the client asked is required; the item must be waiting for the client's answer.
  assert.match((await q('irit', 'select public.staff_request_fix($1, $2, $3)', [ids.fix, 'p07.approved', ' '])).error, /note required/);
  assert.match((await q('irit', 'select public.staff_request_fix($1, $2, $3)', [ids.fix, 'p23.approved', 'x x'])).error, /not awaiting approval/);
  assert.match((await q('irit', 'select public.staff_request_fix($1, $2, $3)', [ids.plain, 'p07.approved', 'x x'])).error, /not awaiting approval/);
  // Irit writes it down: the task is Ilai's (the graphics), from the office, with her as who wrote it.
  const made = await call('irit', 'select * from public.staff_request_fix($1, $2, $3)', [ids.fix, 'p07.approved', '  להחליף את הטלפון בגרפיקה 4  ']);
  assert.equal(made.error, undefined, made.error);
  const t = made.rows[0];
  assert.deepEqual([t.owner, t.source, t.title, t.created_by_email, t.done_at], ['ilai', 'client_fix', 'תיקון לבקשת הלקוח: 9 הגרפיקות הראשונות · סבב 1', 'irit@astrateg.test', null]);
  assert.deepEqual([t.brief.problem, t.brief.from, t.brief.by, t.brief.item, t.brief.item_key, t.brief.round, t.brief.extra, t.brief.notes_marked, t.brief.approval],
    ['להחליף את הטלפון בגרפיקה 4', 'office', 'irit', 'graphics9', 'p07.approved', 1, false, false, null]);
  // The due day, by the one rule: asked by 13:00 on a working day (Israel time), that day; otherwise the next working day.
  const rule = (await db.query(`select case when extract(dow from l) in (5, 6) or l::time >= time '13:00' then private.next_workday(l::date) else l::date end as due
    from (select now() at time zone 'Asia/Jerusalem' as l) x`)).rows[0].due;
  assert.equal(String(t.due_on), String(rule));
  // No record of the client's own is written: the approvals table holds what the client did.
  assert.equal((await db.query('select count(*)::int as n from public.client_approvals where client_id = $1', [ids.fix])).rows[0].n, 0);
  // It is under way now: a second request is refused, and the client's page says "בתיקון".
  assert.match((await q('irit', 'select public.staff_request_fix($1, $2, $3)', [ids.fix, 'p07.approved', 'עוד משהו'])).error, /not awaiting approval/);
  const link = (await call('irit', 'select public.status_link_create($1) as l', [ids.fix])).rows[0].l;
  const page = (await call('anon', 'select public.get_status($1) as s', [link.token])).rows[0].s;
  const item = page.items.find((i) => i.key === 'p07.approved');
  assert.deepEqual([item.state, item.round], ['fixing', 2], 'the office\'s request is counted as a round');
  // The client approves: the task closes by itself, exactly as a task from the page does.
  await check(ids.fix, 'p07.approved');
  assert.ok((await db.query('select done_at from public.client_tasks where id = $1', [t.id])).rows[0].done_at);

  // The client's own way, on the page, for another item of the same client: the same owner and the same due day.
  await check(ids.fix, 'p23.sent');
  const before = (await call('anon', 'select public.get_status($1) as s', [link.token])).rows[0].s;
  const g = before.items.find((i) => i.key === 'p23.approved');
  const wording = wordingFor('fix', { name: 'דנה', business: before.client.business, item: 'graphics', shootRound: 1, round: g.round, included: g.included });
  const own = await call('anon', 'select public.request_fix($1, $2, $3, $4, $5) as s', [link.token, 'p23.approved', 'דנה', wording, 'הטלפון בגרפיקה 12 שגוי']);
  assert.equal(own.error, undefined, own.error);
  const t2 = (await db.query("select owner, due_on, source, brief from public.client_tasks where client_id = $1 and brief ->> 'item_key' = 'p23.approved'", [ids.fix])).rows[0];
  assert.deepEqual([t2.owner, String(t2.due_on), t2.source, t2.brief.from, t2.brief.by], ['ilai', String(t.due_on), 'client_fix', 'status', 'דנה']);
  assert.ok(t2.brief.approval, 'the client\'s request keeps its record');
  assert.equal((await db.query("select count(*)::int as n from public.client_approvals where client_id = $1 and decision = 'fix'", [ids.fix])).rows[0].n, 1);
});

test('the videos: the office\'s request goes to the editor of that shoot and writes the notes mark of 27 at that moment (the deadline of the fix is counted from it)', async () => {
  const made = await call('lior', 'select * from public.staff_request_fix($1, $2, $3)', [ids.videos, 'p27.approved', 'סרטון 3: להחליף מוזיקה']);
  assert.equal(made.error, undefined, made.error);
  const t = made.rows[0];
  assert.deepEqual([t.owner, t.brief.item, t.brief.notes_marked, t.brief.from, t.brief.by], ['nadia', 'videos', true, 'office', 'lior']);
  const notes = (await db.query("select state, note, at from public.protocol_checks where client_id = $1 and item_key = 'p27.notes'", [ids.videos])).rows[0];
  assert.deepEqual([notes.state, JSON.parse(notes.note)], ['done', { text: 'סרטון 3: להחליף מוזיקה', via: 'office' }]);
  assert.ok(Math.abs(new Date(notes.at) - new Date(t.created_at)) < 5000, 'the mark and the task carry the same moment');
  // A very long request does not break the mark (it holds 2,000 characters): the task keeps all of it.
  const { rows } = await db.query("insert into public.clients (name, shoot_type, editor) values ('long', 'dms', 'yariv') returning id");
  await check(rows[0].id, 'p26.sent');
  const long = await call('irit', 'select * from public.staff_request_fix($1, $2, $3)', [rows[0].id, 'p27.approved', 'א'.repeat(3500)]);
  assert.equal(long.error, undefined, long.error);
  assert.equal(long.rows[0].brief.problem.length, 3500);
  assert.equal(JSON.parse((await db.query("select note from public.protocol_checks where client_id = $1 and item_key = 'p27.notes'", [rows[0].id])).rows[0].note).text.length, 1500);
});

test('a task on the spot for Nirel is refused without her brief, by either function; for anyone else nothing changed', async () => {
  // The function the site called until now: as before for Nadia, refused for Nirel.
  const plain = await call('irit', "select public.staff_task_create('nadia', 'להעלות את סרטון 4') as id");
  assert.equal(plain.error, undefined, plain.error);
  assert.match((await call('irit', "select public.staff_task_create('nirel', 'לתקן את הסגיר') as id")).error, /needs the full brief/);
  // With a part of the brief: refused, whichever field is missing.
  const brief = { problem: 'הלוגו בסגיר ישן', change: 'להחליף ללוגו החדש', keep: 'המוזיקה והטקסט', result: 'סגיר נקי עם הלוגו החדש' };
  for (const k of BRIEF_MUST) {
    const r = await call('irit', 'select public.staff_task_create_brief($1, $2, null, $3::jsonb) as id', ['nirel', 'לתקן את הסגיר', JSON.stringify({ ...brief, [k]: '  ' })]);
    assert.match(r.error, /needs the full brief/, k);
  }
  assert.match((await call('irit', 'select public.staff_task_create_brief($1, $2, null, $3::jsonb) as id', ['nirel', 'x', '[1]'])).error, /invalid brief/);
  // Full: it is kept with the task (only the brief's own fields, trimmed), and Nirel reads it.
  const full = await call('irit', 'select public.staff_task_create_brief($1, $2, null, $3::jsonb) as id', ['nirel', 'לתקן את הסגיר', JSON.stringify({ ...brief, problem: `  ${brief.problem} `, other: 'x' })]);
  assert.equal(full.error, undefined, full.error);
  const mine = await q('nirel', 'select body, brief, created_by from public.staff_tasks where id = $1', [full.rows[0].id]);
  assert.deepEqual(mine.rows, [{ body: 'לתקן את הסגיר', brief, created_by: 'irit' }]);
  // Whoever does not give these tasks still cannot, and the table still takes no direct write.
  assert.match((await call('lior', 'select public.staff_task_create_brief($1, $2, null, $3::jsonb) as id', ['nirel', 'x', JSON.stringify(brief)])).error, DENIED);
  assert.match((await call('anon', 'select public.staff_task_create_brief($1, $2, null, $3::jsonb) as id', ['nirel', 'x', JSON.stringify(brief)])).error, DENIED);
  assert.match((await call('irit', "insert into public.staff_tasks (created_by, created_by_email, assignee, body) values ('irit', 'irit@astrateg.test', 'nirel', 'x')")).error, DENIED);
});

test('the writers table: 23 new rows against version 9, and the database agrees with the app on who marks what', async () => {
  assert.equal((await db.query('select count(*)::int as n from private.protocol_writers')).rows[0].n, writerRows().length);
  const v9 = migrationSql('20261023100000_ofir_fast_ladder_v9.sql');
  const rowsOf = (sql) => new Map(sql.split('\n').filter((l) => l.startsWith('  (')).map((l) => [l.slice(3, l.indexOf(', ')), l.trim().replace(/,$/, '')]));
  const a = rowsOf(v9.slice(v9.indexOf('-- protocol-writers:begin'), v9.indexOf('-- protocol-writers:end')));
  const b = rowsOf(sqlBlock());
  const added = [...b].filter(([k, v]) => a.get(k) !== v).map(([k]) => k.replace(/'/g, '')).sort();
  assert.deepEqual(added, [...FIVE, ...FINAL, 'p29b.@part', 'p16.photographer', 'p16.read', 'p18b.files'].sort());
  assert.equal(added.length, 23);
  assert.deepEqual([...a.keys()].filter((k) => !b.has(k)), [], 'no row of version 9 is gone');
  const office = ['owner', 'irit', 'lior', 'ofir'];
  const expect = {
    // The editor of that shoot ticks his five; Ofir's five are the office's.
    'p22.self.sound': [...office, 'nadia'], 'p22.self.export': [...office, 'nadia'], 'p25.q.sound': office, 'p25.q.export': office,
    // Ilai's final check.
    'p29b.c.nets': [...office, 'ilai'], 'p29b.done': [...office, 'ilai'], 'r2.p29b.done': [...office, 'ilai'],
    // The photographer: "קיבלתי" (refused until now), "קראתי את התסריטים", the raw material per script.
    'p16.photographer': [...office, 'eli'], 'p16.read': [...office, 'eli'], 'p18b.files': [...office, 'eli'], 'r2.p18b.files': [...office, 'eli'],
    // Lior's answer after the Zoom, and what stays the office's.
    'p13.left': office, 'p13.fixes': office, 'p29.sent': office,
  };
  // (The photographer sees a client whose shoot day is near: tomorrow, for the main shoot and for the second round.)
  await db.query(`update public.clients set editor = 'nadia', shoot_at = now() + interval '1 day',
    rounds = jsonb_build_array(jsonb_build_object('n', 2, 'shoot_type', 'dms', 'shoot_at', (now() + interval '1 day')::text)) where id = $1`, [ids.later]);
  for (const [key, allowed] of Object.entries(expect)) {
    for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai', 'nadia', 'eli']) {
      const person = who === 'owner' ? null : who;
      const app = mayWrite({ person, client: { editor: 'nadia', rounds: [{ n: 2 }] }, key });
      const r = await as(db, users[who], async (tx) => (await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done') on conflict (client_id, item_key) do update set state = 'done' returning item_key", [ids.later, key])).rows.length).catch(() => 0);
      assert.equal(r === 1, app, `${who} ${key}: ${JSON.stringify(r)}`);
      assert.equal(app, allowed.includes(who), `${who} ${key}`);
    }
  }
});

test('Ilai may upload the logo he made; nobody else gained a kind', async () => {
  const can = async (who, kind) => (await q(who, 'select public.can_upload_client_file($1, $2) as ok', [ids.later, kind])).rows?.[0]?.ok === true;
  assert.deepEqual([await can('ilai', 'logo'), await can('ilai', 'deliverable_graphic'), await can('ilai', 'image'), await can('ilai', 'deliverable_video')], [true, true, false, false]);
  assert.deepEqual([await can('nadia', 'logo'), await can('eli', 'logo'), await can('irit', 'logo')], [false, false, true]);
  assert.ok(uploadKinds('ilai', {}).includes('logo') && !uploadKinds('ilai', {}).includes('image'));
});
