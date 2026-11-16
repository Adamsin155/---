// Graphics tasks that close by themselves (17.11.2026; supabase/migrations/20261216100000_gfx_auto.sql):
// the giver's choice carried in the brief, the Drive's count stamped on a new task, the Gantt's
// live_at, the system's close (service role only, the giver's "done" ring handled), "לפתוח מחדש" by
// the assignee and the managers, and Claude's checks table. Invented people and clients only.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, migrationSql } from './pg.mjs';

const MIGRATION = '20261216100000_gfx_auto.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ilai: 'ilai', nirel: 'nirel', nadia: 'nadia' };
let db;
const users = {};
const ids = {};

async function call(who, sql, params = []) {
  const user = users[who];
  const claims = { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated' };
  try {
    return await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (err) {
    return { error: err.message };
  }
}
async function service(sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query('set local role service_role');
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (err) {
    return { error: err.message };
  }
}
const give = async (who, to, body, client = null, brief = null) => {
  const r = await call(who, 'select public.staff_task_create_brief($1, $2, $3, $4) as id', [to, body, client, brief && JSON.stringify(brief)]);
  if (r.error) return r;
  return r.rows[0].id;
};
const rowOf = async (id) => (await db.query('select * from public.staff_tasks where id = $1', [id])).rows[0];
const today = async () => (await db.query("select (now() at time zone 'Asia/Jerusalem')::date::text as d")).rows[0].d;

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2) on conflict (email) do update set person = excluded.person', [email, person]);
  }
  ids.client = (await db.query("insert into public.clients (name, business) values ('דנה לוי', 'מאפיית הדגמה') returning id")).rows[0].id;
  ids.other = (await db.query("insert into public.clients (name, business) values ('יוסי כהן', 'מוסך הדגמה') returning id")).rows[0].id;
});

test('before: a gfx choice is ignored, no column; then the migration loads, twice', async () => {
  const id = await give('irit', 'ilai', 'להכין גרפיקות', ids.client, { gfx_kind: 'make', gfx_count: 5 });
  assert.equal(typeof id, 'string');
  assert.equal((await rowOf(id)).gfx_kind, undefined);
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION));
  const job = (await db.query("select schedule, command from cron.job where jobname = 'gfx-auto'")).rows;
  assert.deepEqual(job, [{ schedule: '25 5-18 * * *', command: 'select public.gfx_auto_tick()' }]);
});

test('the giver\'s choice: kind and number for a graphics person on a client; refused otherwise', async () => {
  const a = await give('irit', 'ilai', 'מאפיית הדגמה להכין גרפיקות', ids.client, { gfx_kind: 'make', gfx_count: 10 });
  const t = await rowOf(a);
  assert.deepEqual([t.gfx_kind, t.gfx_count, t.brief], ['make', 10, null]);
  // A number alone is "להכין"; a fix has no number.
  assert.equal((await rowOf(await give('irit', 'ilai', 'עוד גרפיקות', ids.client, { gfx_count: '3' }))).gfx_kind, 'make');
  const fix = await rowOf(await give('irit', 'ilai', 'לתקן לפי ההערות', ids.client, { gfx_kind: 'fix', gfx_count: 4 }));
  assert.deepEqual([fix.gfx_kind, fix.gfx_count], ['fix', null]);
  // Nirel: the brief still required, the gfx kept beside it.
  const brief = { problem: 'צבעים חיוורים', change: 'צבעי הלוגו', keep: 'הטקסט', result: 'גרפיקה חיה' };
  const n = await rowOf(await give('irit', 'nirel', 'לתקן גרפיקות', ids.client, { ...brief, gfx_kind: 'fix' }));
  assert.equal(n.gfx_kind, 'fix');
  assert.deepEqual(Object.keys(n.brief).sort(), ['change', 'keep', 'problem', 'result']);
  // Refused: not a graphics person, no client, a bad kind, a bad number.
  assert.match((await give('irit', 'nadia', 'לערוך', ids.client, { gfx_kind: 'make' })).error, /graphics person and a client/);
  assert.match((await give('irit', 'ilai', 'להכין', null, { gfx_kind: 'make' })).error, /graphics person and a client/);
  assert.match((await give('irit', 'ilai', 'להכין', ids.client, { gfx_kind: 'draw' })).error, /invalid graphics kind/);
  for (const bad of ['0', '201', '2.5', 'עשר', -1]) assert.match((await give('irit', 'ilai', 'להכין', ids.client, { gfx_count: bad })).error, /invalid graphics count/, String(bad));
  // Without any gfx field: as before.
  const plain = await rowOf(await give('irit', 'ilai', 'להתקשר ללקוח', ids.client));
  assert.deepEqual([plain.gfx_kind, plain.gfx_count], [null, null]);
});

test('the Drive\'s count that day is stamped on a new task on a client (not the highlight covers)', async () => {
  const d = await today();
  await db.query("insert into public.drive_daily (client_id, day, folder, kind, files) values ($1, $2, 'גרפיקות', 'graphic', 4), ($1, $2, 'היילייטס', 'graphic', 6), ($1, $2, 'סרטונים מוכנים', 'video', 2), ($1, ($2::date - 1), 'גרפיקות', 'graphic', 9)", [ids.client, d]);
  assert.equal((await rowOf(await give('irit', 'ilai', 'להכין גרפיקות', ids.client))).gfx_base, 4);
  assert.equal((await rowOf(await give('irit', 'ilai', 'להכין גרפיקות', ids.other))).gfx_base, 0);
  assert.equal((await rowOf(await give('irit', 'ilai', 'משהו בלי לקוח'))).gfx_base, null);
});

test('the Gantt: live_at when a row becomes scheduled or posted, kept while it stays, gone when it goes back', async () => {
  const ins = await db.query("insert into public.client_gantt (client_id, key, kind, title, day) values ($1, 'graphic.1', 'graphic', 'גרפיקה 1', '2026-12-01') returning id, live_at", [ids.client]);
  assert.equal(ins.rows[0].live_at, null);
  const g = ins.rows[0].id;
  await db.query("update public.client_gantt set state = 'scheduled', source = 'metricool', mc_status = 'pending' where id = $1", [g]);
  const first = (await db.query('select live_at from public.client_gantt where id = $1', [g])).rows[0].live_at;
  assert.ok(first);
  await db.query("update public.client_gantt set state = 'posted', posted_on = '2026-12-01', live_at = now() + interval '9 days' where id = $1", [g]);
  assert.equal((await db.query('select live_at from public.client_gantt where id = $1', [g])).rows[0].live_at.getTime(), first.getTime(), 'scheduled → posted keeps the moment; a hand-written one is ignored');
  await db.query("update public.client_gantt set state = 'planned', posted_on = null where id = $1", [g]);
  assert.equal((await db.query('select live_at from public.client_gantt where id = $1', [g])).rows[0].live_at, null);
  const posted = await db.query("insert into public.client_gantt (client_id, key, kind, title, day, state, posted_on) values ($1, 'graphic.2', 'graphic', 'גרפיקה 2', '2026-11-10', 'posted', '2026-11-10') returning live_at", [ids.client]);
  assert.ok(posted.rows[0].live_at);
});

test('the system closes: service role only, open only; reminders read, the giver\'s "done" ring handled', async () => {
  const id = await give('irit', 'ilai', 'להכין גרפיקות למאפייה', ids.client);
  await db.query("insert into public.reminder_log (key, rule, person, level, channel, status, title) values ($1, 'nag', 'ilai', 'ring', 'push', 'sent', 'תזכורת')", [`nag:-:${id}:2026-11-17.0@ilai`]);
  // Nobody signed in may call it.
  assert.match((await call('irit', 'select public.staff_task_auto_close($1, $2)', [id, 'x'])).error, /permission denied/);
  assert.match((await call('owner', 'select public.staff_task_auto_close($1, $2)', [id, 'x'])).error, /permission denied/);
  assert.match((await service('select public.staff_task_auto_close($1, $2)', [id, '  '])).error, /note is required/);
  const r = await service('select public.staff_task_auto_close($1, $2, $3) as ok', [id, 'נסגר אוטומטית: עלו 4 גרפיקות בדרייב ב־17.11', 4]);
  assert.equal(r.rows[0].ok, true);
  const t = await rowOf(id);
  assert.deepEqual([t.status, !!t.done_at, t.done_by_email, t.auto_note, t.gfx_done], ['done', true, 'system:auto', 'נסגר אוטומטית: עלו 4 גרפיקות בדרייב ב־17.11', 4]);
  assert.ok((await db.query("select read_at from public.reminder_log where rule = 'nag' and key like $1", [`nag:-:${id}:%`])).rows[0].read_at);
  const handled = (await db.query('select person, status from public.reminder_log where key = $1', [`nagDone:-:${id}:done@irit`])).rows;
  assert.deepEqual(handled, [{ person: 'irit', status: 'suppressed' }]);
  // Again: nothing (not open).
  assert.equal((await service('select public.staff_task_auto_close($1, $2) as ok', [id, 'שוב'])).rows[0].ok, false);
  // Progress: service role only, open tasks only.
  const open = await give('irit', 'ilai', 'להכין 10 גרפיקות', ids.client, { gfx_count: 10 });
  assert.match((await call('irit', 'select public.staff_task_gfx_progress($1, 3)', [open])).error, /permission denied/);
  await service('select public.staff_task_gfx_progress($1, 3)', [open]);
  assert.equal((await rowOf(open)).gfx_done, 3);
});

test('"לפתוח מחדש": the assignee, the giver, the owner and the managers for a task the system closed; the moment and the day\'s count are kept', async () => {
  const close = async (id) => service('select public.staff_task_auto_close($1, $2)', [id, 'נסגר אוטומטית: בדיקה']);
  for (const who of ['ilai', 'irit', 'owner', 'lior']) {
    const id = await give('irit', 'ilai', `להכין גרפיקות (${who})`, ids.client);
    await close(id);
    const r = await call(who, 'select (public.staff_task_reopen($1)).status as s', [id]);
    assert.equal(r.error, undefined, who);
    const t = await rowOf(id);
    assert.deepEqual([t.status, t.done_at, t.done_by_email, t.auto_note], ['open', null, null, null], who);
    assert.ok(t.auto_reopened_at, who);
    assert.equal(t.auto_reopen_base, 4, `${who}: the Drive's count today`);
  }
  // Someone else (Nadia, not the assignee, not a manager): not even seen.
  const id = await give('irit', 'ilai', 'להכין גרפיקות (נדיה)', ids.client);
  await close(id);
  assert.match((await call('nadia', 'select public.staff_task_reopen($1)', [id])).error, /task not found/);
  // A task the ASSIGNEE marked done: as before, the assignee cannot reopen it; the giver can.
  const own = await give('irit', 'ilai', 'להכין גרפיקות (ידני)', ids.client);
  assert.equal((await call('ilai', 'select public.staff_task_done($1)', [own])).error, undefined);
  assert.match((await call('ilai', 'select public.staff_task_reopen($1)', [own])).error, /task not found/);
  assert.equal((await call('irit', 'select public.staff_task_reopen($1)', [own])).error, undefined);
  const t = await rowOf(own);
  assert.deepEqual([t.status, t.auto_reopened_at], ['open', null]);
});

test('Claude\'s checks: the managers read them, nobody signed in writes them', async () => {
  const id = await give('irit', 'ilai', 'לתקן גרפיקות לפי ההערות', ids.client, { gfx_kind: 'fix' });
  const ins = await service("insert into public.gfx_ai_checks (task_id, files, status, result, model) values ($1, '{a1,a2}', 'missing', '[]', 'claude-sonnet-5-5') returning id", [id]);
  assert.equal(ins.error, undefined);
  assert.match((await call('irit', "insert into public.gfx_ai_checks (task_id, status) values ($1, 'done')", [id])).error, /permission denied/);
  assert.equal((await call('lior', 'select count(*)::int as n from public.gfx_ai_checks')).rows[0].n, 1);
  assert.equal((await call('ilai', 'select count(*)::int as n from public.gfx_ai_checks')).rows[0].n, 0);
  assert.match((await service("insert into public.gfx_ai_checks (task_id, status) values ($1, 'maybe')", [id])).error, /check/);
});
