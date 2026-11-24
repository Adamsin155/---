// "לתזמן סרטונים" (24.11.2026; supabase/migrations/20261224100000_schedule_videos.sql; docs/ops.md,
// section 152): Irit gives Ilai the videos' scheduling apart from the graphics'. The new kind is kept
// with its number; the old kinds still work; an unknown kind, or the kind for someone who is not a
// graphics person, is refused. Nothing is dropped or deleted. Invented people and clients only.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, migrationSql } from './pg.mjs';

const FILE = '20261224100000_schedule_videos.sql';
let db;
const users = {};
let client;

async function give(who, to, body, brief) {
  const u = users[who];
  try {
    return await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated' })]);
      const r = await tx.query('select public.staff_task_create_brief($1, $2, $3, $4) as id', [to, body, client, JSON.stringify(brief)]);
      return (await tx.query('select gfx_kind, gfx_count from public.staff_tasks where id = $1', [r.rows[0].id])).rows[0];
    });
  } catch (err) { return { error: err.message }; }
}

before(async () => {
  db = await freshDatabase();
  await db.exec(migrationSql(FILE)); // runs again safely
  for (const [key, person] of Object.entries({ irit: 'irit', ilai: 'ilai', nadia: 'nadia' })) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2) on conflict (email) do update set person = excluded.person', [email, person]);
  }
  client = (await db.query("insert into public.clients (name, business) values ('דנה לוי', 'מאפיית הדגמה') returning id")).rows[0].id;
});

test('the videos\' scheduling is kept with its number; the graphics\' kinds still work', async () => {
  assert.deepEqual(await give('irit', 'ilai', 'לתזמן את הסרטונים', { gfx_kind: 'schedule_videos', gfx_count: 12 }), { gfx_kind: 'schedule_videos', gfx_count: 12 });
  assert.deepEqual(await give('irit', 'ilai', 'לתזמן את הגרפיקות', { gfx_kind: 'schedule', gfx_count: 5 }), { gfx_kind: 'schedule', gfx_count: 5 });
  assert.deepEqual(await give('irit', 'ilai', 'לתקן', { gfx_kind: 'fix', gfx_count: 5 }), { gfx_kind: 'fix', gfx_count: null });
});

test('refused: an unknown kind, or the kind for someone who is not a graphics person; nothing dropped', async () => {
  assert.match((await give('irit', 'ilai', 'x', { gfx_kind: 'schedule_all' })).error, /invalid graphics kind/);
  assert.match((await give('irit', 'nadia', 'x', { gfx_kind: 'schedule_videos' })).error, /graphics person/);
  await assert.rejects(db.query("update public.staff_tasks set gfx_kind = 'other' where true"), /staff_tasks_gfx_check/);
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/\bdrop\s+(table|function|column)|\bdelete\s+from\b|\btruncate\b/gi), null);
});
