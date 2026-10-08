// supabase/migrations/20261021100000_people_messages.sql on every migration in a real
// Postgres (PGlite): the moment a field deal is cancelled is stamped by the database
// (so the reminders can tell the seller once, rule `dealCancelled`; docs/ops.md,
// section 45), whatever the browser sends; opening it again clears it; nothing else of
// the deal's stamps changes; and the file runs twice and uses none of the words the
// tool that applies migrations refuses.
// Also what the new rules read with the service role, as the reminders function does:
// a question, its answer and its withdrawal in public.client_questions.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql } from './pg.mjs';

const MIGRATION = '20261021100000_people_messages.sql';
let db;
const users = {};
let deal;
let client;

before(async () => {
  db = await freshDatabase({ upTo: MIGRATION });
  for (const [key, person] of Object.entries({ owner: null, irit: 'irit', stav: 'stav' })) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
  // A deal that was cancelled before the migration: it has no moment, and gets none.
  const old = await as(db, users.stav, async (tx) => (await tx.query("insert into public.deal_requests (business_name, contact_name, phone, tier, influencer) values ('ישן', 'א', '050-1111111', 'social', 'natali') returning id")).rows[0]);
  assert.equal(old.error, undefined, old.error);
  await db.query("insert into public.deal_requests (business_name, contact_name, phone, tier, influencer) values ('ישן', 'א', '050-1111111', 'social', 'natali')");
  await db.query("update public.deal_requests set status = 'cancelled' where business_name = 'ישן'");
  await db.exec(migrationSql(MIGRATION));
  await db.exec(migrationSql(MIGRATION)); // safe to run again
  deal = (await db.query("insert into public.deal_requests (business_name, contact_name, phone, tier, influencer) values ('פיצה רון', 'רון', '050-7654321', 'social', 'natali') returning *")).rows[0];
  client = (await db.query("insert into public.clients (name, shoot_type) values ('דנה', 'dms') returning id")).rows[0].id;
});

test('the migration is additive and uses none of the words the tool refuses, comments included', () => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  assert.equal(/\b(drop|delete|truncate)\b/i.test(sql), false);
  assert.match(sql, /add column if not exists cancelled_at/);
  assert.match(sql, /create or replace trigger deal_requests_zz_cancelled/);
  assert.equal(/\bupdate\s+public\./i.test(sql), false); // no row is changed
});

test('a deal cancelled before the migration keeps an empty moment: nobody is told now of an old cancellation', async () => {
  const { rows } = await db.query("select status, cancelled_at from public.deal_requests where business_name = 'ישן'");
  assert.deepEqual(rows, [{ status: 'cancelled', cancelled_at: null }]);
});

test('cancelling stamps the moment and who; a later edit keeps it; opening the deal again clears it; the browser cannot set it', async () => {
  assert.equal(deal.cancelled_at, null);
  const r = await as(db, users.irit, async (tx) => {
    const one = (sql, p = []) => tx.query(sql, p).then((x) => x.rows[0]);
    // A moment sent by the browser is ignored while the deal is not cancelled.
    const forged = await one("update public.deal_requests set cancelled_at = '2020-01-01' where id = $1 returning status, cancelled_at", [deal.id]);
    const cancelled = await one("update public.deal_requests set status = 'cancelled', cancelled_at = '2020-01-01' where id = $1 returning status, cancelled_at, status_by_email, sent_at, signed_at", [deal.id]);
    const again = await one("update public.deal_requests set status = 'cancelled', cancelled_at = null where id = $1 returning cancelled_at", [deal.id]);
    const open = await one("update public.deal_requests set status = 'pending' where id = $1 returning status, cancelled_at", [deal.id]);
    const now = await one('select now() as now');
    return { forged, cancelled, again, open, now: now.now };
  });
  assert.equal(r.error, undefined, r.error);
  assert.deepEqual(r.forged, { status: 'pending', cancelled_at: null });
  assert.equal(r.cancelled.status, 'cancelled');
  assert.equal(+new Date(r.cancelled.cancelled_at), +new Date(r.now)); // the database's clock, not the browser's 2020
  assert.equal(r.cancelled.status_by_email, 'irit@astrateg.test');
  assert.equal(r.cancelled.sent_at, null);
  assert.equal(+new Date(r.again.cancelled_at), +new Date(r.now)); // still cancelled: the moment stays
  assert.deepEqual(r.open, { status: 'pending', cancelled_at: null });
});

test('a new deal never starts with a moment, and the trigger function is not an API', async () => {
  const r = await as(db, users.stav, async (tx) => (await tx.query("insert into public.deal_requests (business_name, contact_name, phone, tier, influencer, cancelled_at) values ('חדש', 'ב', '050-2222222', 'social', 'natali', now()) returning status, cancelled_at")).rows[0]);
  assert.deepEqual(r, { status: 'pending', cancelled_at: null });
  const call = await as(db, users.stav, (tx) => tx.query('select public.deal_requests_cancelled_stamp()'));
  assert.match(call.error, /permission denied/);
});

test('what the reminders read of a question: asked, answered by the person asked, and gone when withdrawn', async () => {
  const cols = 'id, client_id, to_person, about, context, question, asked_by, asked_at, answer, answered_by, answered_at';
  const r = await as(db, users.owner, async (tx) => {
    const q = (await tx.query(`insert into public.client_questions (client_id, to_person, about, context, question) values ($1, 'irit', 'late:p07', 'באיחור', ' מה המצב? ') returning ${cols}`, [client])).rows[0];
    const gone = (await tx.query('delete from public.client_questions where id = $1 returning id', [q.id])).rows.length;
    const left = (await tx.query('select count(*)::int as n from public.client_questions')).rows[0].n;
    return { q, gone, left };
  });
  assert.equal(r.error, undefined, r.error);
  assert.deepEqual([r.q.to_person, r.q.question, r.q.asked_by, r.q.answer, r.q.answered_at], ['irit', 'מה המצב?', 'owner@astrateg.test', null, null]);
  assert.deepEqual([r.gone, r.left], [1, 0]); // withdrawn: no row is left for the rule to ring
  // Answered: who and when are stamped, which is what `questionAnswered` reads.
  const id = (await db.query("insert into public.client_questions (client_id, to_person, question) values ($1, 'irit', 'מתי?') returning id", [client])).rows[0].id;
  const a = await as(db, users.irit, async (tx) => (await tx.query(`update public.client_questions set answer = 'מחר' where id = $1 returning ${cols}`, [id])).rows[0]);
  assert.deepEqual([a.answer, a.answered_by, a.answered_at !== null], ['מחר', 'irit@astrateg.test', true]);
});
