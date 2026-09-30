// The hardening after the review of stages 4–6 (supabase/migrations/
// 20260930210000_hardening.sql; docs/ops.md, section 18) in a real Postgres:
//   - the office's columns of a client (phone, notes, closed_reason) are not
//     readable by anyone else, the office still reads and writes them, and the
//     migration moves no data (applied onto a database with clients, then again);
//   - the signed agreements are the office's;
//   - who writes which protocol item: the database's rule (private.protocol_write_ok)
//     against the app's (mayWrite in scripts/protocol-writers.mjs, generated from
//     app/protocol.js), and the cases the review found (an editor marking p25.approved
//     or p27.toilai, clearing Ofir's p25.return.1; imported history);
//   - the monthly cycle: Ilai marks only his own items;
//   - the status page: approving the scripts closes a Zoom still open ('na'), a double
//     approval applies once, a revoked link leaves Vault; and the page still marks
//     the protocol through its security definer functions.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as, migrationSql } from './pg.mjs';
import { writerRows, mayWrite, EXTRA_MARKS, OFFICE_WRITERS } from '../../scripts/protocol-writers.mjs';
import { PROCESSES, EDITORS } from '../../app/protocol.js';
import { MONTH_ITEMS, SPREAD_ITEMS } from '../../app/year-logic.js';
import { wordingFor } from '../../app/status-logic.js';

const HARDENING = '20260930210000_hardening.sql';
const PRIVATE = ['phone', 'notes', 'closed_reason'];
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', yariv: 'yariv', nirel: 'nirel', eli: 'eli' };
const RLS = /row-level security|permission denied/;

let db;
const users = {};
const ids = {};
const clients = {};

before(async () => {
  // The database as it is live before this migration, with real rows in it.
  db = await freshDatabase({ upTo: HARDENING });
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, true)', [email, person]);
  }
  const add = async (name, fields) => {
    const cols = ['name', ...Object.keys(fields)];
    const vals = [name, ...Object.values(fields).map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : v))];
    const { rows } = await db.query(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, vals);
    ids[name] = rows[0].id;
    clients[name] = rows[0];
  };
  const soon = new Date(Date.now() + 3 * 864e5).toISOString();
  // Nadia edits the main shoot, Yariv the second round; Eli's shoot is in 3 days.
  await add('dana', { business: 'קפה דנה', phone: '050-1234567', notes: 'הערה פנימית', shoot_type: 'dms', editor: 'nadia', shoot_at: soon,
    rounds: [{ n: 2, shoot_type: 'dms', editor: 'yariv', shoot_at: soon }], status: 'active', char_at: new Date(Date.now() - 20 * 864e5).toISOString() });
  // A Natali client that Nirel sees but does not edit (no editor yet).
  await add('natali', { phone: '052-7654321', notes: 'לא לספר לעורכת', shoot_type: 'natali', editor: null });
  // A cancelled agreement, with its reason.
  await add('gone', { phone: '053-1111111', status: 'cancelled', closed_reason: 'לא שילם', editor: 'nadia' });
  const mark = (c, key, note = null, state = 'done') => db.query('insert into public.protocol_checks (client_id, item_key, state, note) values ($1, $2, $3, $4)', [ids[c], key, state, note]);
  await mark('dana', 'p25.return.1', '{"v":1,"issues":[{"ref":"4","text":"לקצר"}]}');
  await mark('dana', 'p01.signed');
  for (const k of ['p12.scripts', 'p12.numbered', 'p12.docs']) await mark('dana', k);
  await db.query("insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot) values ($1, 'דנה', 100000, 1200000)",
    [JSON.stringify({ client: { name: 'דנה', phone: '050-1234567' }, totals: {} })]);
  // The migration, then again (it must be safe to run twice).
  await db.exec(migrationSql(HARDENING));
  await db.exec(migrationSql(HARDENING));
});

const run = (who, fn) => as(db, who === 'anon' ? null : users[who], fn);
const q = (who, sql, params = []) => run(who, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows };
});
async function keep(who, sql, params = [], headers = {}) {
  const u = who === 'anon' ? null : users[who];
  const claims = u ? { sub: u.id, email: u.email, role: 'authenticated' } : { role: 'anon' };
  let out;
  await db.transaction(async (tx) => {
    await tx.query(`set local role ${u ? 'authenticated' : 'anon'}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify(headers)]);
    out = (await tx.query(sql, params)).rows;
  });
  return out;
}

// ── 1. The office's columns ─────────────────
test('the office\'s columns: nobody else reads them, however they ask; the rest of the row as before', async () => {
  for (const who of ['nadia', 'nirel', 'eli', 'yariv']) {
    for (const col of PRIVATE) {
      assert.match((await q(who, `select ${col} from public.clients`)).error, /permission denied/, `${who} ${col}`);
      assert.match((await q(who, `select id from public.clients where ${col} is not null`)).error, /permission denied/, `${who} filters on ${col}`);
      assert.match((await q(who, `select id from public.clients order by ${col}`)).error, /permission denied/, `${who} sorts on ${col}`);
    }
    assert.match((await q(who, 'select * from public.clients')).error, /permission denied/, `${who} *`);
    assert.match((await q(who, 'select to_jsonb(c) from public.clients c')).error, /permission denied/, `${who} the whole row`);
    assert.deepEqual((await q(who, 'select * from public.clients_private()')).rows, [], `${who} clients_private`);
  }
  // What they need still reads, on their clients only.
  const nadia = (await q('nadia', 'select name, address, editor, rounds, links, deliverables, status from public.clients order by name')).rows;
  assert.deepEqual(nadia.map((r) => r.name), ['dana', 'gone']);
  assert.deepEqual((await q('nirel', 'select name from public.clients')).rows.map((r) => r.name), ['natali']);
  assert.deepEqual((await q('eli', 'select name from public.clients')).rows.map((r) => r.name), ['dana']);
  // anon: nothing at all.
  assert.match((await q('anon', 'select id from public.clients')).error, /permission denied/);
  assert.match((await q('anon', 'select * from public.clients_private()')).error, /permission denied/);
});

test('the office reads its columns through clients_private(), and writes them as before; no data moved', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) {
    const all = (await q(who, 'select id, phone, notes, closed_reason from public.clients_private() order by phone')).rows;
    assert.deepEqual(all.map((r) => r.phone), ['050-1234567', '052-7654321', '053-1111111'], who);
    const one = (await q(who, 'select * from public.clients_private($1)', [[ids.gone]])).rows;
    assert.deepEqual(one, [{ id: ids.gone, phone: '053-1111111', notes: null, closed_reason: 'לא שילם' }], who);
  }
  assert.equal((await q('irit', 'select notes from public.clients_private($1)', [[ids.natali]])).rows[0].notes, 'לא לספר לעורכת');
  // The office changes them, with the row back as the app asks for it (no private column).
  const up = await q('irit', "update public.clients set phone = '054-2222222', notes = 'חדש' where id = $1 returning id, name", [ids.dana]);
  assert.deepEqual(up.rows, [{ id: ids.dana, name: 'dana' }]);
  const add = await q('lior', "insert into public.clients (name, phone, notes) values ('חדש', '050-0000000', 'x') returning id, name, protocol_version");
  assert.equal(add.rows[0].name, 'חדש');
  // Anyone else still cannot change a client at all.
  assert.equal((await q('nadia', "update public.clients set phone = '1' where id = $1", [ids.dana])).affected, 0);
  // The data is where it was.
  const raw = (await db.query('select name, phone, notes, closed_reason from public.clients order by name')).rows;
  assert.deepEqual(raw, [
    { name: 'dana', phone: '050-1234567', notes: 'הערה פנימית', closed_reason: null },
    { name: 'gone', phone: '053-1111111', notes: null, closed_reason: 'לא שילם' },
    { name: 'natali', phone: '052-7654321', notes: 'לא לספר לעורכת', closed_reason: null },
  ]);
});

test('every other column of clients is readable, and a new column has to be classified here', async () => {
  const cols = (await db.query("select column_name as c from information_schema.columns where table_schema = 'public' and table_name = 'clients' order by 1")).rows.map((r) => r.c);
  const granted = (await db.query("select column_name as c from information_schema.column_privileges where table_schema = 'public' and table_name = 'clients' and grantee = 'authenticated' and privilege_type = 'SELECT' order by 1")).rows.map((r) => r.c);
  assert.deepEqual(granted, cols.filter((c) => !PRIVATE.includes(c)),
    'a column added to public.clients needs its own "grant select (col)" in its migration, or a place in the private list');
});

test('the signed agreements (the phone and the prices in them) are the office\'s', async () => {
  const n = (await db.query('select count(*)::int as n from public.quotes')).rows[0].n;
  assert.ok(n >= 1);
  for (const who of ['owner', 'irit', 'lior', 'ofir', 'ilai']) assert.equal((await q(who, 'select 1 from public.quotes')).rows.length, n, who);
  for (const who of ['nadia', 'nirel', 'eli']) assert.deepEqual((await q(who, 'select 1 from public.quotes')).rows, [], who);
});

// ── 2. Who writes which item ─────────────────
test('private.protocol_writers is what scripts/protocol-writers.mjs makes of app/protocol.js', async () => {
  const rows = (await db.query('select key, proc, round, persons from private.protocol_writers order by key')).rows;
  const want = writerRows().map((r) => ({ key: r.key, proc: r.proc, round: r.round, persons: r.persons })).sort((a, b) => (a.key < b.key ? -1 : 1));
  assert.deepEqual(rows, want);
  assert.match((await q('nadia', 'select 1 from private.protocol_writers')).error, /permission denied/);
});

// Every key a person could send, on the main shoot and in round 2.
const KEYS = [
  ...PROCESSES.flatMap((p) => p.items.map((i) => i.key)),
  ...PROCESSES.flatMap((p) => ['claim', 'wait', 'waited', 'pause', 'answered', 'snooze', 'shift', 'handoff.irit', 'return.1', 'fixed.1', 'fixed.1.0', 'decision', 'reason', 'zoomat', 'ended'].map((s) => `${p.id}.${s}`)),
  ...Object.keys(EXTRA_MARKS), 'p06.fixed.instagram', 'p16.brief', 'p18.quiet', 'p18.shot', 'p14.seen',
];
const ALL_KEYS = [...KEYS, ...KEYS.map((k) => `r2.${k}`)];

test('the database decides as the app\'s rule does, for every person, key and shoot', async () => {
  const cases = [];
  for (const who of Object.keys(PEOPLE)) {
    for (const c of ['dana', 'natali']) {
      const got = await run(who, async (tx) => (await tx.query(
        'select k, private.protocol_write_ok($1, k, null) as ok, private.protocol_write_ok($1, k, $2) as imp from unnest($3::text[]) k', [ids[c], 'ייבוא', ALL_KEYS])).rows);
      for (const r of got) {
        const want = mayWrite({ person: PEOPLE[who], client: clients[c], key: r.k });
        const wantImp = mayWrite({ person: PEOPLE[who], client: clients[c], key: r.k, note: 'ייבוא' });
        if (r.ok !== want || r.imp !== wantImp) cases.push(`${who} ${c} ${r.k}: db ${r.ok}/${r.imp}, app ${want}/${wantImp}`);
      }
    }
  }
  assert.deepEqual(cases, []);
  // Not a staff member (a stray login): nothing.
  assert.equal((await q('anon', 'select private.protocol_write_ok($1, $2, null) as ok', [ids.dana, 'p22.received'])).error?.length > 0, true);
});

test('the office writes every item, as today; everyone else only their own', async () => {
  for (const who of ['owner', 'irit', 'lior', 'ofir']) {
    for (const k of ['p25.approved', 'p27.toilai', 'p22.received', 'r2.p17b.arrived', 'p13.approved']) {
      assert.equal((await q(who, "insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done') on conflict (client_id, item_key) do update set state = 'done'", [ids.dana, k])).affected, 1, `${who} ${k}`);
    }
    assert.equal((await q(who, "delete from public.protocol_checks where client_id = $1 and item_key = 'p25.return.1'", [ids.dana])).affected, 1, who);
  }
  // The review's cases: an editor cannot approve for Ofir, receive for Ilai, or clear Ofir's return.
  for (const k of ['p25.approved', 'p27.toilai', 'p27.approved', 'p27.notes', 'p25.return.2', 'p22.decision', 'p24.folder']) {
    assert.match((await q('nadia', "insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done')", [ids.dana, k])).error, RLS, `nadia ${k}`);
  }
  assert.equal((await q('nadia', "delete from public.protocol_checks where client_id = $1 and item_key = 'p25.return.1'", [ids.dana])).affected, 0);
  assert.equal((await q('nadia', "update public.protocol_checks set note = '{}' where client_id = $1 and item_key = 'p25.return.1'", [ids.dana])).affected, 0);
  assert.equal((await q('nadia', "delete from public.protocol_checks where client_id = $1 and item_key = 'p01.signed'", [ids.dana])).affected, 0);
  // Her own work: items, the missing report, the pause, a wait, a handoff, "תוקן" on Ofir's return.
  for (const k of ['p22.received', 'p22.missing', 'p22.pause', 'p22.wait', 'p22.waited', 'p24.notify', 'p24.handoff.ofir', 'p27.fixes', 'p27.fixed', 'p25.fixed.1', 'p25.fixed.1.0', 'p22.snooze']) {
    assert.equal((await q('nadia', "insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done')", [ids.dana, k])).affected, 1, `nadia ${k}`);
  }
  // Round 2 is Yariv's: Nadia cannot mark it, Yariv can (a shoot round, 'r2.').
  assert.match((await q('nadia', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'r2.p22.received', 'done')", [ids.dana])).error, RLS);
  // (Yariv sees dana through his round.)
  assert.equal((await q('yariv', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'r2.p22.received', 'done')", [ids.dana])).affected, 1);
  assert.match((await q('yariv', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.received', 'done')", [ids.dana])).error, RLS);
  // A round key on a process that has no rounds is nobody's but the office's.
  assert.match((await q('ilai', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'r2.p07.made', 'done')", [ids.dana])).error, RLS);
  // Ilai: his items and "קיבלתי", not Irit's sending or Ofir's check; Eli: his shoot day.
  for (const k of ['p07.made', 'p27.toilai', 'p23.made', 'p23.fixed.1', 'p29.claim', 'p07.wait']) {
    assert.equal((await q('ilai', "insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done')", [ids.dana, k])).affected, 1, `ilai ${k}`);
  }
  for (const k of ['p07.sent', 'p23.ofir', 'p23.return.1', 'p06.fixed.instagram', 'p06.recovered', 'p07.answered', 'p22.received']) {
    assert.match((await q('ilai', "insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done')", [ids.dana, k])).error, RLS, `ilai ${k}`);
  }
  for (const k of ['p17b.arrived', 'p17b.brollq', 'r2.p19b.handed']) {
    assert.equal((await q('eli', "insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done')", [ids.dana, k])).affected, 1, `eli ${k}`);
  }
  for (const k of ['p18.quiet', 'p19.took', 'p16.brief', 'p22.received']) {
    assert.match((await q('eli', "insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done')", [ids.dana, k])).error, RLS, `eli ${k}`);
  }
});

test('Nirel on a Natali client she does not edit: only the pause while no editor is assigned', async () => {
  assert.match((await q('nirel', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.received', 'done')", [ids.natali])).error, RLS);
  assert.equal((await q('nirel', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.pause', 'done')", [ids.natali])).affected, 1);
  // Once someone edits it, the pause is theirs.
  const res = await run('nirel', async (tx) => {
    await tx.query('reset role');
    await tx.query("update public.clients set editor = 'nirel' where id = $1", [ids.natali]);
    await tx.query('set local role authenticated');
    return (await tx.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.received', 'done')", [ids.natali])).affectedRows;
  });
  assert.equal(res, 1);
});

test('imported history (\'ייבוא\') is written by the office only; an owner re-marks an imported item of theirs', async () => {
  assert.equal((await q('irit', "insert into public.protocol_checks (client_id, item_key, state, note) select $1, k, 'done', 'ייבוא' from unnest(array['p22.received', 'p22.edited']) k", [ids.dana])).affected, 2);
  assert.match((await q('nadia', "insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p22.edited', 'done', 'ייבוא')", [ids.dana])).error, RLS);
  const res = await run('nadia', async (tx) => {
    await tx.query('reset role');
    await tx.query("insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p22.edited', 'done', 'ייבוא')", [ids.dana]);
    await tx.query('set local role authenticated');
    const up = await tx.query("insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p22.edited', 'done', null) on conflict (client_id, item_key) do update set note = excluded.note", [ids.dana]);
    const del = await tx.query("delete from public.protocol_checks where client_id = $1 and item_key = 'p22.edited'", [ids.dana]);
    return [up.affectedRows, del.affectedRows];
  });
  assert.deepEqual(res, [1, 1]);
});

test('the monthly cycle: Ilai marks only his own items; the rest of the office any, also for someone else', async () => {
  const ilaiItems = [...MONTH_ITEMS, ...SPREAD_ITEMS].filter((i) => i.owner === 'ilai').map((i) => i.key).sort();
  assert.deepEqual(ilaiItems, ['plan', 'posted'], 'private.month_write_ok lists them');
  const ins = (who, item) => q(who, "insert into public.client_month_marks (client_id, month, item, state) values ($1, 3, $2, 'done')", [ids.dana, item]);
  for (const item of ['plan', 'posted']) assert.equal((await ins('ilai', item)).affected, 1, item);
  for (const item of ['report', 'photo', 'ch14.1', 'round.1']) assert.match((await ins('ilai', item)).error, RLS, item);
  for (const who of ['owner', 'irit', 'lior', 'ofir']) assert.equal((await ins(who, 'report')).affected, 1, who);
  assert.match((await ins('nadia', 'plan')).error, RLS);
  const res = await run('ilai', async (tx) => {
    await tx.query('reset role');
    await tx.query("insert into public.client_month_marks (client_id, month, item, state) values ($1, 4, 'report', 'done')", [ids.dana]);
    await tx.query('set local role authenticated');
    return (await tx.query('delete from public.client_month_marks where client_id = $1 and month = 4', [ids.dana])).affectedRows;
  });
  assert.equal(res, 0, 'Ilai cannot clear Ofir\'s report');
  assert.equal((await q('ilai', 'select 1 from public.client_month_marks')).error, undefined);
});

test('the office writers of the table are SCOPE \'office\' in app/protocol.js, and the editors are EDITORS', () => {
  assert.deepEqual(OFFICE_WRITERS, ['irit', 'lior', 'ofir']);
  assert.deepEqual(writerRows().find((r) => r.key === '@editors').persons, [...EDITORS].sort());
});

// ── 3. The status page ───────────────────────
test('the page still marks the protocol (security definer); approving the scripts closes a Zoom still open', async () => {
  const [{ l }] = await keep('irit', 'select public.status_link_create($1) as l', [ids.dana]);
  const token = l.token;
  const s = (await keep('anon', 'select public.get_status($1) as s', [token]))[0].s;
  const it = s.items.find((x) => x.item === 'scripts' && x.shootRound === 1);
  assert.equal(it.state, 'waiting');
  const wording = wordingFor('approve', { name: 'דנה כהן', business: 'קפה דנה', item: 'scripts', shootRound: 1, round: it.round });
  // Pressed twice: one approval (the second finds it approved; the row lock makes it so
  // for two presses at the same moment too).
  await keep('anon', 'select public.approve_item($1, $2, $3, $4)', [token, it.key, 'דנה כהן', wording]);
  await assert.rejects(keep('anon', 'select public.approve_item($1, $2, $3, $4)', [token, it.key, 'דנה כהן', wording]), /not awaiting approval/);
  const checks = Object.fromEntries((await db.query("select item_key, state, note, by_email from public.protocol_checks where client_id = $1 and item_key like 'p13.%'", [ids.dana])).rows.map((r) => [r.item_key, r]));
  assert.equal(checks['p13.approved'].state, 'done');
  assert.deepEqual([checks['p13.zoom'].state, checks['p13.zoom'].note, checks['p13.zoom'].by_email], ['na', 'אושר בדף המצב', 'system']);
  assert.equal((await db.query("select count(*)::int as n from public.client_approvals where client_id = $1 and item_key = 'p13.approved'", [ids.dana])).rows[0].n, 1);
  // Lior can still mark the Zoom done, if it took place.
  assert.equal((await q('lior', "update public.protocol_checks set state = 'done', note = null where client_id = $1 and item_key = 'p13.zoom'", [ids.dana])).affected, 1);
});

test('a Zoom already marked stays as it was; approving other items does not touch it', async () => {
  const { rows } = await db.query("insert into public.clients (name, business, shoot_type, rounds, status) values ('zoomed', 'זום', 'dms', $1, 'active') returning id",
    [JSON.stringify([{ n: 2, shoot_type: 'dms', shoot_at: new Date(Date.now() + 5 * 864e5).toISOString() }])]);
  const id = rows[0].id;
  for (const k of ['r2.p12.scripts', 'r2.p12.numbered', 'r2.p12.docs', 'p07.sent']) await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, $2, 'done')", [id, k]);
  await db.query("insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'r2.p13.zoom', 'done', 'https://zoom.example/rec')", [id]);
  const [{ l }] = await keep('lior', 'select public.status_link_create($1) as l', [id]);
  const s = (await keep('anon', 'select public.get_status($1) as s', [l.token]))[0].s;
  for (const it of s.items.filter((x) => x.state === 'waiting')) {
    const wording = wordingFor('approve', { name: 'זיו', business: 'זום', item: it.item, shootRound: it.shootRound, round: it.round });
    await keep('anon', 'select public.approve_item($1, $2, $3, $4)', [l.token, it.key, 'זיו', wording]);
  }
  const zoom = (await db.query("select item_key, state, note from public.protocol_checks where client_id = $1 and item_key like '%p13.zoom'", [id])).rows;
  assert.deepEqual(zoom, [{ item_key: 'r2.p13.zoom', state: 'done', note: 'https://zoom.example/rec' }]);
  assert.equal((await db.query("select state from public.protocol_checks where client_id = $1 and item_key = 'r2.p13.approved'", [id])).rows[0].state, 'done');
});

test('a revoked status link\'s token leaves Vault', async () => {
  const [{ a }] = await keep('irit', 'select public.status_link_create($1) as a', [ids.dana]);
  const before = (await db.query('select secret_id from public.client_status_links where id = $1', [a.id])).rows[0].secret_id;
  assert.ok(before);
  // A new link revokes it.
  await keep('irit', 'select public.status_link_create($1)', [ids.dana]);
  const row = (await db.query('select revoked_at, secret_id from public.client_status_links where id = $1', [a.id])).rows[0];
  assert.ok(row.revoked_at);
  assert.equal(row.secret_id, null);
  assert.equal((await db.query('select count(*)::int as n from vault.secrets where id = $1', [before])).rows[0].n, 0);
  // Every revoked link: no secret kept.
  assert.equal((await db.query('select count(*)::int as n from public.client_status_links where revoked_at is not null and secret_id is not null')).rows[0].n, 0);
});
