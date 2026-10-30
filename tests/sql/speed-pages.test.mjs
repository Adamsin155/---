// The slow pages, fast (supabase/migrations/20261117100000_speed_pages.sql; docs/ops.md,
// section 77) on every migration in a real Postgres (PGlite):
//   - the file is the newest, has none of the three words the production tool refuses,
//     only creates its two functions (security invoker, not for anon), and runs twice;
//   - public.protocol_checks_compact(), unpacked as the pages unpack it (app/log-brief.js),
//     is exactly what each person read from public.protocol_checks before (the same rows,
//     the same values, the times in the same text), for every role: the owner, Irit, Lior,
//     Ofir, Ilai, an editor, Eli and the field sales; also for one client;
//   - public.protocol_log_brief() is, for each of them, exactly the rows the rule names
//     (the newest of each client since the moment, the items ending in the endings asked
//     for, the whole history of the history endings) out of what that person read from
//     public.protocol_log before: never a row the table did not give them, never one missing.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql, migrationFiles } from './pg.mjs';
import { expandChecks, briefOfLog } from '../../app/log-brief.js';
import { LOG_NEEDS, historySuffixes } from '../../app/health.js';

const FILE = '20261117100000_speed_pages.sql';
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', eli: 'eli', stav: 'stav' };
const ROLES = Object.keys(PEOPLE);
const SINCE = '2026-10-01T00:00:00+00:00';
let db;
const users = {};
const ids = {};

const q = async (who, sql, params = []) => {
  const out = await as(db, users[who], async (tx) => ({ rows: (await tx.query(sql, params)).rows }));
  assert.equal(out.error, undefined, `${who}: ${out.error}`);
  return out.rows;
};
// What PostgREST answered for the old reads: the rows as JSON, by the database (to_json of each row).
const tableChecks = async (who, client = null) => (await q(who, `select coalesce(json_agg(t), '[]'::json) as j from (
  select client_id, item_key, state, note, by_email, at from public.protocol_checks ${client ? 'where client_id = $1' : ''} order by client_id, item_key) t`, client ? [client] : []))[0].j;
const tableLog = async (who) => (await q(who, `select coalesce(json_agg(t), '[]'::json) as j from (
  select id, client_id, item_key, action, note, by_email, at from public.protocol_log order by at, id) t`))[0].j;
const grouped = (rows) => {
  const out = {};
  for (const r of rows) (out[r.client_id] ||= {})[r.item_key] = r;
  return out;
};

before(async () => {
  db = await freshDatabase({ upTo: FILE });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: r.rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  // Four clients: Nadia's, another editor's, one with a shoot day tomorrow (Eli's window), and one of nobody's.
  const add = async (name, extra = '', vals = []) => (await db.query(`insert into public.clients (name, shoot_type${extra ? `, ${extra}` : ''}) values ($1, 'dms'${vals.map((_, i) => `, $${i + 2}`).join('')}) returning id`, [name, ...vals])).rows[0].id;
  ids.nadia = await add('של נדיה', 'editor', ['nadia']);
  ids.yariv = await add('של יריב', 'editor', ['yariv']);
  ids.shoot = await add('צילום מחר', 'shoot_at', [new Date(Date.now() + 864e5).toISOString()]);
  ids.none = await add('בלי אף אחד');
  // Marks and history as the live office has them: imported marks sharing one moment, real
  // marks each at its own, notes and none, a "not relevant"; written as the database's owner
  // with the stamping triggers off, so the times and the authors stay as given.
  await db.exec("set session_replication_role = replica");
  let n = 0;
  for (const [k, c] of Object.entries(ids)) {
    const keys = ['p01.call', 'p02.intro', 'p07.sent', 'p07.made', 'p23.sent', 'p26.pause', 'p27.notes', 'p31.call'];
    for (const [i, key] of keys.entries()) {
      n += 1;
      const at = i < 3 ? '2026-09-01T08:00:00+00:00' : new Date(Date.UTC(2026, 9, 1 + i, 7, 0, 0, 0) + n * 1234 + 0.5).toISOString();
      await db.query('insert into public.protocol_checks (client_id, item_key, state, note, by_email, at) values ($1, $2, $3, $4, $5, $6)',
        [c, key, i === 4 ? 'na' : 'done', i < 3 ? 'ייבוא' : i === 5 ? `הערה של ${k}` : null, i % 2 ? 'irit@astrateg.test' : 'lior@astrateg.test', at]);
    }
    // History: old rows (before SINCE), rows in the window, sendings, notes, stops, returns, clears.
    const log = [
      ['p07.sent', 'done', '2026-08-20T09:00:00+00:00'], ['p07.sent', 'done', '2026-10-03T09:00:00.123456+00:00'],
      ['p23.made', 'done', '2026-08-01T09:00:00+00:00'], ['p25.return.2', 'done', '2026-08-02T09:00:00+00:00'],
      ['p26.pause', 'done', '2026-10-04T09:00:00+00:00'], ['p26.pause', 'clear', '2026-10-05T09:00:00+00:00'],
      ['p27.notes', 'done', '2026-10-06T10:00:00+00:00'], ['p01.call', 'done', '2026-10-07T10:00:00+00:00'],
      ['p31.call', 'clear', k === 'yariv' ? '2026-10-09T11:00:00+00:00' : '2026-10-08T11:00:00+00:00'],
      ['p02.intro', 'done', '2026-09-15T11:00:00+00:00'], ['p02.intro', 'na', '2026-10-02T11:00:00+00:00'],
    ];
    for (const [key, action, at] of log) {
      await db.query('insert into public.protocol_log (client_id, item_key, action, note, by_email, at) values ($1, $2, $3, $4, $5, $6)', [c, key, action, null, 'ofir@astrateg.test', at]);
    }
  }
  // Two rows of one client at the very same moment: the newest is the later one written.
  await db.query("insert into public.protocol_log (client_id, item_key, action, note, by_email, at) values ($1, 'p05.a', 'done', null, 'x@astrateg.test', '2026-10-20T12:00:00+00:00'), ($1, 'p05.b', 'done', null, 'x@astrateg.test', '2026-10-20T12:00:00+00:00')", [ids.none]);
  await db.exec("set session_replication_role = origin");
  await db.exec(migrationSql(FILE));
  await db.exec(migrationSql(FILE)); // safe to run again
});

test('the file: the newest but one (only the end of the manager approval after it), none of the refused words, its two functions only, invoker, not for anon', async () => {
  assert.deepEqual(migrationFiles().slice(migrationFiles().indexOf(FILE) + 1), ['20261118100000_no_manager_approval.sql', '20261119100000_work_history.sql', '20261120100000_drive_daily.sql']);
  const sql = migrationSql(FILE);
  assert.equal(sql.match(/drop|delete|truncate/gi), null);
  assert.deepEqual([...sql.matchAll(/create or replace function ([\w.]+)/g)].map((m) => m[1]), ['public.protocol_checks_compact', 'public.protocol_log_brief']);
  assert.equal(/security definer/i.test(sql), false);
  const fns = (await db.query("select proname, prosecdef from pg_proc where proname in ('protocol_checks_compact', 'protocol_log_brief') order by proname")).rows;
  assert.deepEqual(fns, [{ proname: 'protocol_checks_compact', prosecdef: false }, { proname: 'protocol_log_brief', prosecdef: false }]);
  const anon = await as(db, null, (tx) => tx.query('select public.protocol_checks_compact()'));
  assert.match(anon.error || '', /permission denied/);
  const anon2 = await as(db, null, (tx) => tx.query("select public.protocol_log_brief(now(), '{}', '{}')"));
  assert.match(anon2.error || '', /permission denied/);
});

test('the marks in one answer: for every role exactly what the table gave them', async () => {
  const seen = {};
  for (const who of ROLES) {
    const old = await tableChecks(who);
    const [{ j }] = await q(who, 'select public.protocol_checks_compact() as j');
    assert.deepEqual(expandChecks(j), grouped(old), who);
    // The same order of clients and of marks as the old read (order by client_id, item_key).
    assert.deepEqual(Object.entries(expandChecks(j)).flatMap(([c, m]) => Object.keys(m).map((k) => `${c} ${k}`)), old.map((r) => `${r.client_id} ${r.item_key}`), who);
    seen[who] = Object.keys(grouped(old)).sort();
    // One client: the same as the table read of that client.
    for (const id of Object.values(ids)) {
      const [{ j: one }] = await q(who, 'select public.protocol_checks_compact($1) as j', [id]);
      assert.deepEqual(expandChecks(one), grouped(await tableChecks(who, id)), `${who} ${id}`);
    }
  }
  // The rows are those of the access as it is: the office every client, Nadia hers, Eli the shoot, the sales none.
  const all = Object.values(ids).sort();
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) assert.deepEqual(seen[who], all, who);
  assert.deepEqual(seen.nadia, [ids.nadia]);
  assert.deepEqual(seen.eli, [ids.shoot]);
  assert.deepEqual(seen.stav, []);
  // The times are the text the table answers (microseconds and all), the notes as written.
  const [{ j }] = await q('owner', 'select public.protocol_checks_compact($1) as j', [ids.nadia]);
  const marks = expandChecks(j)[ids.nadia];
  assert.equal(marks['p01.call'].at, '2026-09-01T08:00:00+00:00');
  assert.equal(marks['p01.call'].note, 'ייבוא');
  assert.equal(marks['p26.pause'].note, 'הערה של nadia');
  assert.equal(marks['p23.sent'].state, 'na');
  assert.equal(marks['p27.notes'].note, null);
});

test('the history in one answer: for every role exactly the rows the rule names, out of what the table gave them', async () => {
  const cases = [
    { suffixes: [], history: [] }, // "המשימות שלי": the newest of each client
    { suffixes: LOG_NEEDS, history: [] }, // the pass
    { suffixes: LOG_NEEDS, history: historySuffixes() }, // the owner's screens
  ];
  for (const who of ROLES) {
    const old = await tableLog(who);
    for (const c of cases) {
      const [{ j }] = await q(who, 'select public.protocol_log_brief($1, $2, $3) as j', [SINCE, c.suffixes, c.history]);
      assert.deepEqual(j, briefOfLog(old, { since: SINCE, ...c }), `${who} ${JSON.stringify(c)}`);
      // Never wider: every row is one of the table's for that person.
      const keyOf = (r) => `${r.client_id} ${r.item_key} ${r.action} ${r.at}`;
      const had = new Set(old.map(keyOf));
      for (const r of j) assert.ok(had.has(keyOf(r)), `${who}: ${keyOf(r)}`);
      // Never narrower: the newest moment of each client (the "last activity") is the old one.
      const newest = (rows) => { const m = {}; for (const r of rows) if (new Date(r.at) >= new Date(SINCE) && (!m[r.client_id] || new Date(r.at) > new Date(m[r.client_id]))) m[r.client_id] = r.at; return m; };
      assert.deepEqual(newest(j), newest(old), who);
    }
  }
  // What the owner's screens get for Yariv's client: in the window, its newest (the clear of 31),
  // the second sending of 07, the notes of 27 and the stop of 26 with its end; from all time the
  // history of 07's sendings, 23's making and the return of 25; nothing of 02 or of 01's call.
  const [{ j }] = await q('owner', 'select public.protocol_log_brief($1, $2, $3) as j', [SINCE, LOG_NEEDS, historySuffixes()]);
  const mine = j.filter((r) => r.client_id === ids.yariv).map((r) => `${r.item_key} ${r.action} ${r.at.slice(0, 10)}`);
  assert.deepEqual(mine, ['p23.made done 2026-08-01', 'p25.return.2 done 2026-08-02', 'p07.sent done 2026-08-20', 'p07.sent done 2026-10-03',
    'p26.pause done 2026-10-04', 'p26.pause clear 2026-10-05', 'p27.notes done 2026-10-06', 'p31.call clear 2026-10-09']);
  assert.equal(j.find((r) => r.item_key === 'p07.sent' && r.at.startsWith('2026-10-03')).at, '2026-10-03T09:00:00.123456+00:00');
  // Two rows at one moment: the later written one stands for the client's newest.
  const [{ j: latest }] = await q('owner', "select public.protocol_log_brief($1, '{}', '{}') as j", [SINCE]);
  assert.deepEqual(latest.filter((r) => r.client_id === ids.none).map((r) => r.item_key), ['p05.b']);
  // The sales and anyone without the client read nothing of it.
  const [{ j: stav }] = await q('stav', 'select public.protocol_log_brief($1, $2, $3) as j', [SINCE, LOG_NEEDS, historySuffixes()]);
  assert.deepEqual(stav, []);
  const [{ j: nadia }] = await q('nadia', 'select public.protocol_log_brief($1, $2, $3) as j', [SINCE, LOG_NEEDS, historySuffixes()]);
  assert.deepEqual([...new Set(nadia.map((r) => r.client_id))], [ids.nadia]);
});
