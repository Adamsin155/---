// supabase/migrations/20261109100000_legacy_characterizations.sql in a real Postgres with every
// migration (tests/sql/pg.mjs): the characterizations of the old system (astrateg-crm), each in
// its client's card (the owner's request of 26.10.2026).
//   - the file is the newest but one, only adds (none of the three words the production tool refuses)
//     and runs twice;
//   - only the owner imports, through public.legacy_characterization_import(); again on the
//     same client changes the same row; the client must be there; something must be in it;
//   - no phone number and no e-mail address is kept, in any text or answer ("[הוסר]");
//   - every member of staff reads (the owner, 26.10.2026: "כולם יכולים לראות את האיפיון"):
//     the office, an editor assigned or not, the photographer; not the field sales agents and
//     not anyone signed out; nobody writes the table directly.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';

const FILE = '20261109100000_legacy_characterizations.sql';
let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', yariv: 'yariv', eli: 'eli', stav: 'stav', amos: 'amos' };

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person) values ($1, $2)', [email, person]);
  }
  // Ron's editor is Nadia; Yariv edits nothing of these.
  for (const [name, editor] of [['ron', 'nadia'], ['gil', null]]) {
    const { rows } = await db.query("insert into public.clients (name, status, editor) values ($1, 'active', $2) returning id", [name, editor]);
    ids[name] = rows[0].id;
  }
});

// An old client record as the old system kept it (only the characterization's fields are read).
const OLD = (fields = {}) => ({
  id: 44, name: 'רון כהן', phone: '050-1234567', email: 'ron@example.com',
  charterFilledText: 'רקע על העסק\r\nשם העסק: מספרת רון\r\nטלפון: 050-1234567\r\nמייל: ron.cohen@gmail.com\r\nקהל יעד: גברים 25–45\r\n\r\nהערות:\r\nאין',
  charterFilledAt: '2025-03-01T08:00:00.000Z',
  briefText: 'דגשים: לצלם בבוקר. לחזור ל־+972-52-765-4321 או 03-5551234.',
  briefUpdatedAt: '2025-03-05T08:00:00.000Z',
  charterScript: 'תסריט 1: פתיחה במספרה\nתסריט 2: לפני ואחרי',
  charterScriptAt: '2025-03-07T08:00:00.000Z',
  charterSummary: 'לקוח שקט, אוהב סרטונים קצרים.',
  charterAnswers: { 1: 'מספרה', 2: '', 3: 'לחייג 0549876543', 10: 'לא', 7: null },
  ...fields,
});

// Runs and keeps the change (the RPC writes); returns the result, or { error }.
async function keep(who, sql, params = []) {
  const u = users[who];
  let out;
  try {
    await db.transaction(async (tx) => {
      if (u) {
        await tx.query('set local role authenticated');
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated' })]);
      } else {
        await tx.query('set local role anon');
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'anon' })]);
      }
      out = (await tx.query(sql, params)).rows;
    });
  } catch (err) { out = { error: err.message }; }
  return out;
}
const imp = (who, client, doc) => keep(who, 'select public.legacy_characterization_import($1, $2) as r', [client, JSON.stringify(doc)]).then((r) => (r.error ? r : r[0].r));
const read = (who) => as(db, who ? users[who] : null, async (tx) => (await tx.query('select client_id, filled_text from public.legacy_characterizations order by client_id')).rows);
const stored = async (client) => (await db.query('select * from public.legacy_characterizations where client_id = $1', [client])).rows[0];
const unlisted = async (text) => (await db.query('select private.legacy_unlisted($1) as t', [text])).rows[0].t;

test('the file: the newest but one, only adds, and runs twice', async () => {
  // After it only the requests of 27.10.2026 (20261110100000_batch_2710.sql).
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261110100000_batch_2710.sql', '20261112100000_new_influencers.sql']);
  const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  for (const m of sql.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+[a-z_.]+\s+set[^;]*;/gi)) assert.match(m[0], /\bwhere\b/i, m[0].slice(0, 80));
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE));
  assert.equal((await db.query("select count(*)::int as n from pg_policies where tablename = 'legacy_characterizations'")).rows[0].n, 1);
  assert.equal((await db.query("select relrowsecurity as on from pg_class where oid = 'public.legacy_characterizations'::regclass")).rows[0].on, true);
});

test('phone numbers and e-mail addresses become "[הוסר]"; dates, amounts and ids stay', async () => {
  const gone = [
    '050-1234567', '0501234567', '050 123 4567', '050-123-4567', '050 - 1234567', '(050) 1234567', '054.987.6543',
    '03-5551234', '035551234', '02-123-4567', '077-1234567', '+972-50-1234567', '+972501234567', '972-3-5551234', '+972 (0)50 123 4567',
    '00972-52-7654321', '1-800-123-456', '1700-500-500', 'ron@example.com', 'Ron.Cohen+ads@mail.co.il',
  ];
  for (const s of gone) assert.equal(await unlisted(`טל׳ ${s}.`), 'טל׳ [הוסר].', s);
  const kept = ['2025-03-01', '1.3.2025', '05.10.2026', '10:30', '₪5,000', '60000', '1,500,000', '1 800 000', 'ח.פ. 512345678', 'מספר 12345678901', 'gmail', '@ron_barber', '25–45'];
  for (const s of kept) assert.equal(await unlisted(`ערך ${s} כאן`), `ערך ${s} כאן`, s);
  assert.equal(await unlisted('לחזור ל־050-1234567 או ron@x.com, תודה'), 'לחזור ל־[הוסר] או [הוסר], תודה');
  assert.equal(await unlisted(null), null);
});

test('the owner imports: each part, its time, the line ends made plain, no contact details', async () => {
  const r = await imp('owner', ids.ron, OLD());
  assert.equal(r.client_id, ids.ron);
  assert.equal(r.answers, 3, 'the empty answers are left out');
  assert.ok(r.filled > 0 && r.brief > 0 && r.script > 0 && r.summary > 0);
  assert.equal(r.filled_text, undefined, 'the texts are not sent back');
  const row = await stored(ids.ron);
  assert.equal(row.filled_text, 'רקע על העסק\nשם העסק: מספרת רון\nטלפון: [הוסר]\nמייל: [הוסר]\nקהל יעד: גברים 25–45\n\nהערות:\nאין');
  assert.equal(row.brief_text, 'דגשים: לצלם בבוקר. לחזור ל־[הוסר] או [הוסר].');
  assert.equal(row.script_text, 'תסריט 1: פתיחה במספרה\nתסריט 2: לפני ואחרי');
  assert.equal(row.summary_text, 'לקוח שקט, אוהב סרטונים קצרים.');
  assert.deepEqual(row.answers, { 1: 'מספרה', 3: 'לחייג [הוסר]', 10: 'לא' });
  assert.deepEqual([row.filled_at, row.brief_at, row.script_at].map((d) => d.toISOString()), ['2025-03-01T08:00:00.000Z', '2025-03-05T08:00:00.000Z', '2025-03-07T08:00:00.000Z']);
  assert.equal(row.imported_by, 'owner@astrateg.test');
  assert.doesNotMatch(JSON.stringify(row), /050-1234567|ron\.cohen@gmail|765-4321|5551234|0549876543|ron@example/);
  // Only a part or two: the rest stays empty; a time that is not one is left out; answers deep inside are stripped too.
  await imp('owner', ids.gil, { briefText: '  בריף בלבד  ', briefUpdatedAt: 'לא תאריך', charterAnswers: { 4: ['א', 'מייל gil@x.org'], 5: { a: ' ' } }, charterFilledText: '   ' });
  const gil = await stored(ids.gil);
  assert.deepEqual([gil.filled_text, gil.brief_text, gil.brief_at, gil.script_text, gil.summary_text], [null, 'בריף בלבד', null, null, null]);
  assert.deepEqual(gil.answers, { 4: ['א', 'מייל [הוסר]'] });
});

test('again on the same client: the same row, changed', async () => {
  const count = async () => (await db.query('select count(*)::int as n from public.legacy_characterizations')).rows[0].n;
  const n = await count();
  await imp('owner', ids.ron, OLD({ charterSummary: 'עודכן', charterAnswers: {} }));
  await imp('owner', ids.ron, OLD({ charterSummary: 'עודכן', charterAnswers: {} }));
  assert.equal(await count(), n);
  const row = await stored(ids.ron);
  assert.equal(row.summary_text, 'עודכן');
  assert.equal(row.answers, null);
});

test('only the owner imports; the client must be there; something must be in it; the lengths are checked', async () => {
  const before = JSON.stringify(await stored(ids.gil));
  for (const who of ['irit', 'lior', 'ofir', 'ilai', 'nadia', 'eli', 'stav', null]) {
    const r = await imp(who, ids.gil, OLD({ charterSummary: 'לא' }));
    assert.match(r.error || '', who ? /not allowed/ : /not allowed|permission denied/, String(who));
  }
  assert.equal(JSON.stringify(await stored(ids.gil)), before);
  assert.match((await imp('owner', '00000000-0000-4000-8000-000000000000', OLD())).error || '', /no such client/);
  assert.match((await imp('owner', ids.gil, { charterFilledText: ' ', charterAnswers: { 1: '' }, briefText: 5 })).error || '', /nothing to keep/);
  assert.match((await imp('owner', ids.gil, OLD({ charterScript: 'א'.repeat(20001) }))).error || '', /too long/);
  assert.equal(JSON.stringify(await stored(ids.gil)), before);
  // Exactly 20000 is kept.
  assert.ok(!(await imp('owner', ids.gil, OLD({ charterScript: 'א'.repeat(20000) }))).error);
  assert.equal((await stored(ids.gil)).script_text.length, 20000);
});

test('reading: every member of staff, assigned or not; not the sales agents or anyone signed out; nobody writes directly', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai', 'nadia', 'yariv', 'eli']) {
    assert.deepEqual((await read(who)).map((r) => r.client_id).sort(), [ids.ron, ids.gil].sort(), who);
  }
  for (const who of ['stav', 'amos']) assert.deepEqual(await read(who), [], who);
  assert.match((await read(null)).error || '', /permission denied/);
  for (const who of ['owner', 'irit', 'nadia']) {
    const ins = await as(db, users[who], (tx) => tx.query("insert into public.legacy_characterizations (client_id, filled_text) values ($1, 'x')", ['00000000-0000-4000-8000-000000000001']));
    assert.match(ins.error || '', /permission denied/, who);
    const upd = await as(db, users[who], (tx) => tx.query("update public.legacy_characterizations set filled_text = 'x' where true"));
    assert.match(upd.error || '', /permission denied/, who);
  }
  // The helpers are not the API's.
  for (const fn of ["private.legacy_unlisted('x')", "private.legacy_char_text('\"x\"'::jsonb)", "private.legacy_char_json('{}'::jsonb)"]) {
    const r = await as(db, users.owner, (tx) => tx.query(`select ${fn}`));
    assert.match(r.error || '', /permission denied/, fn);
  }
});
