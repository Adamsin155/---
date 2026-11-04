// A monthly client's editing round, opened by itself every month (the owner's decision of
// 4.11.2026; app/monthly-rounds.js; docs/ops.md, section 94): what is written, from which list,
// that it is written once, and what the round then is for the editor, the office and the
// reminders. npm test runs this under UTC, New York and Jerusalem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthlyRoundPlan, monthlyRoundPlans, monthlyMarks, NA_KEYS, BEFORE_EDITING, hasMonthWork, roundMonth,
  MONTHLY_NOTE, MONTHLY_NA_NOTE, MONTHLY_DRIVE_NOTE,
} from '../app/monthly-rounds.js';
import { PROCESSES, isRetired } from '../app/protocol.js';
import { clientState, roundContext, roundsOf, addBusinessDays, shootHeld, phasesFor, IMPORT_NOTE } from '../app/protocol-logic.js';
import { editingCases, editorState } from '../app/production.js';
import { monthTargetOf, monthVideosText } from '../app/edit-count.js';
import { computeReminders } from '../app/reminder-engine.js';
import { shootContexts } from '../app/shoot-prep.js';
import { shootHistory } from '../app/shoot-table.js';
import { importKeys } from '../app/client-open.js';
import { dateIL } from '../app/tz.js';
import { stationChange, suggestFor, thursdayVars } from '../app/messages-logic.js';
import { runTick } from '../supabase/functions/reminders/tick.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const NOV4 = IL(2026, 11, 4, 10); // Wednesday
const STAFF = ['irit', 'lior', 'ofir', 'ilai', 'anna', 'nadia', 'yariv', 'eli'].map((p) => ({ email: `${p}@x`, person: p })).concat([{ email: 'owner@x', person: null }]);

let seq = 0;
const client = (o = {}) => {
  seq += 1;
  return {
    id: `m${seq}`, name: o.name || `לקוח ${seq}`, business: null, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
    editor: 'anna', editor2: null, editor_split: null, rounds: [], contract_end: '2027-06-30', deal_at: IL(2026, 7, 1, 10).toISOString(),
    char_at: IL(2026, 7, 5, 10).toISOString(), shoot_at: IL(2026, 9, 20, 11).toISOString(), landing: false, archived_at: null, protocol_version: 12,
    deliverables: { videos_month: 8, shoot_monthly: true }, updated_at: '2026-11-01T08:00:00.000Z', ...o,
  };
};
// The client's first cycle is behind it (brought in through "שוטף").
const history = (c) => Object.fromEntries(importKeys('ongoing').map((k) => [k, { client_id: c.id, item_key: k, state: 'done', note: IMPORT_NOTE, at: '2026-10-01T09:00:00.000Z' }]));
// The plan written, as the reminders function writes it (the database stamps the time).
function apply(c, checks, plan, at) {
  const next = plan.rounds ? { ...c, rounds: plan.rounds } : c;
  const out = { ...checks };
  for (const m of plan.marks) if (!out[m.item_key]) out[m.item_key] = { client_id: c.id, ...m, at: at.toISOString() };
  return { c: next, checks: out };
}

test('the not-relevant list is every round process before the editing, from app/protocol.js', () => {
  const edit = PROCESSES.findIndex((p) => p.id === 'p22');
  const want = PROCESSES.slice(0, edit).filter((p) => p.round && !isRetired(p));
  assert.deepEqual(BEFORE_EDITING, want.map((p) => p.id));
  assert.deepEqual(NA_KEYS, want.flatMap((p) => p.items.filter((i) => !isRetired(i)).map((i) => i.key)).filter((k) => k !== 'p22a.assigned'));
  // The shoot day and its preparation, and the assignment's other lines (Irit's check, Ofir's load).
  for (const k of ['p11.calendar', 'p11.ok.client', 'p12.link', 'p13.zoom', 'p14.day', 'p36.form', 'p17b.arrived', 'p18b.order', 'p19b.handed', 'p22a.load', 'p22a.irit']) assert.ok(NA_KEYS.includes(k), k);
  // Nothing of the editing or after it; nothing a version retired (p13.approved may never be 'na' in the database).
  for (const k of ['p22a.assigned', 'p22.received', 'p22.edited', 'p24.notify', 'p25.approved', 'p13.approved', 'p15.client', 'p19.all']) assert.ok(!NA_KEYS.includes(k), k);
  for (const k of NA_KEYS) assert.match(`r12.${k}`, /^(r[0-9]+\.)?p[0-9]+[ab]?\.[a-z0-9.]+$/, 'the database\'s item key rule');
  const marks = monthlyMarks(3);
  assert.equal(marks.length, NA_KEYS.length + 2);
  assert.deepEqual(marks.filter((m) => m.state === 'done'), [
    { item_key: 'r3.p22a.assigned', state: 'done', note: MONTHLY_NOTE },
    { item_key: 'r3.p22.received', state: 'done', note: MONTHLY_DRIVE_NOTE },
  ]);
  assert.ok(marks.filter((m) => m.state === 'na').every((m) => m.note === MONTHLY_NA_NOTE && m.item_key.startsWith('r3.')));
});

test('November opens once for a monthly client, straight to its editor, with the month\'s own number', () => {
  const c = client({ name: 'ניב בן שימול', business: 'אלאור בוטיק', deliverables: { videos_month: 8, videos_month_except: { '2026-11': 12 } } });
  const checks = history(c);
  const plan = monthlyRoundPlan(c, checks, NOV4);
  assert.equal(plan.month, '2026-11');
  assert.equal(plan.n, 2);
  assert.deepEqual(plan.rounds, [{ n: 2, month: '2026-11', monthly: true, editor: 'anna', start_at: NOV4.toISOString() }]);
  assert.equal(monthTargetOf(c, plan.month), 12);
  assert.equal(monthVideosText(c, NOV4, '2026-11'), '12 סרטונים החודש');
  assert.equal(monthVideosText(c, NOV4, '2026-10'), '8 סרטונים · אוקטובר 2026');
  // Written: nothing more, the same day or later in the month (also a second run in the same minute).
  const w = apply(c, checks, plan, NOV4);
  for (const at of [NOV4, IL(2026, 11, 4, 10, 1), IL(2026, 11, 15, 9), IL(2026, 11, 30, 17)]) assert.equal(monthlyRoundPlan(w.c, w.checks, at), null, String(at));
  // December: a round of its own, the next number, the regular 8.
  const dec = monthlyRoundPlan(w.c, w.checks, IL(2026, 12, 1, 0, 5));
  assert.deepEqual(dec.rounds.map((r) => [r.n, r.month]), [[2, '2026-11'], [3, '2026-12']]);
  assert.equal(monthTargetOf(c, dec.month), 8);
});

test('the round written without its marks (a stopped write) gets them; a round with any mark is left alone', () => {
  const c = client();
  const checks = history(c);
  const plan = monthlyRoundPlan(c, checks, NOV4);
  const half = { ...c, rounds: plan.rounds };
  const again = monthlyRoundPlan(half, checks, NOV4);
  assert.equal(again.rounds, null);
  assert.deepEqual(again.marks, monthlyMarks(2));
  // Someone cleared the assignment on purpose: nothing is written over it.
  const w = apply(half, checks, again, NOV4);
  const cleared = { ...w.checks };
  delete cleared['r2.p22a.assigned'];
  assert.equal(monthlyRoundPlan(w.c, cleared, NOV4), null);
});

test('two editors: both on the round, with their split', () => {
  const c = client({ editor: 'nadia', editor2: 'yariv', editor_split: { nadia: 5, yariv: 3 } });
  const plan = monthlyRoundPlan(c, history(c), NOV4);
  assert.deepEqual(plan.rounds.at(-1), { n: 2, month: '2026-11', monthly: true, editor: 'nadia', editor2: 'yariv', editor_split: { nadia: 5, yariv: 3 }, start_at: NOV4.toISOString() });
});

test('nothing: not a business day, not monthly, no editor, not live, in landing, a month of 0, the first cycle not yet edited, or the month already has its editing', () => {
  const ok = client();
  assert.ok(monthlyRoundPlan(ok, history(ok), NOV4));
  assert.equal(monthlyRoundPlan(ok, history(ok), IL(2026, 11, 6, 10)), null, 'Friday');
  assert.equal(monthlyRoundPlan(ok, history(ok), IL(2026, 11, 7, 10)), null, 'Saturday');
  assert.ok(monthlyRoundPlan(ok, history(ok), IL(2026, 11, 1, 0, 1)), 'Sunday the 1st is the first business day');
  const none = [
    ['not monthly', client({ deliverables: { videos: 8, shoot_monthly: true } })],
    ['no editor', client({ editor: null })],
    ['the placeholder editor', client({ editor: 'editor' })],
    ['ended', client({ status: 'ended' })],
    ['cancelled', client({ status: 'cancelled' })],
    ['archived', client({ archived_at: '2026-10-30T10:00:00Z' })],
    ['in landing', client({ landing: true })],
    ['no videos this month', client({ deliverables: { videos_month: 8, videos_month_except: { '2026-11': 0 } } })],
    ['first shoot this month', client({ shoot_at: IL(2026, 11, 12, 11).toISOString() })],
    ['a shoot round this month', client({ rounds: [{ n: 2, shoot_at: IL(2026, 11, 20, 11).toISOString(), editor: 'anna', start_at: IL(2026, 10, 29, 10).toISOString() }] })],
    ['a shoot round added this month, no date yet', client({ rounds: [{ n: 2, shoot_at: null, editor: 'anna', start_at: IL(2026, 11, 2, 10).toISOString() }] })],
    ['this month\'s round already there (finished)', client({ rounds: [{ n: 2, month: '2026-11', monthly: true, editor: 'anna' }] })],
  ];
  for (const [why, c] of none) {
    const checks = why === 'this month\'s round already there (finished)' ? { ...history(c), ...apply(c, {}, { rounds: null, marks: monthlyMarks(2) }, NOV4).checks } : history(c);
    assert.equal(monthlyRoundPlan(c, checks, NOV4), null, why);
  }
  // The first cycle is still before its editing (a new client): its own editing comes first.
  const fresh = client();
  const open = history(fresh);
  delete open['p22a.assigned'];
  assert.equal(monthlyRoundPlan(fresh, open, NOV4), null);
  // Its first editing was assigned this month: that is the month's.
  const first = client();
  assert.equal(monthlyRoundPlan(first, { ...history(first), 'p22a.assigned': { state: 'done', note: null, at: IL(2026, 11, 2, 12).toISOString() } }, NOV4), null);
  // A shoot round of next month does not count for this one.
  const next = client({ rounds: [{ n: 2, shoot_at: IL(2026, 12, 3, 11).toISOString(), start_at: IL(2026, 10, 20, 10).toISOString(), editor: 'anna' }] });
  assert.equal(roundMonth(next.rounds[0]), '2026-12');
  assert.equal(hasMonthWork(next, history(next), '2026-11'), false);
  assert.equal(monthlyRoundPlan(next, history(next), NOV4).n, 3);
});

test('every client at once: the rows of the database, grouped by client', () => {
  const a = client();
  const b = client({ deliverables: { videos: 8 } });
  const rows = [...Object.values(history(a)), ...Object.values(history(b))];
  assert.deepEqual(monthlyRoundPlans([a, b], rows, NOV4).map((x) => x.client.id), [a.id]);
});

test('the round starts at the editing: all before it complete, the editor\'s card "בעריכה" with "מוכן לבדיקה", due from the round\'s start', () => {
  const c = client({ deliverables: { videos_month: 8, videos_month_except: { '2026-11': 12 } } });
  const w = apply(c, history(c), monthlyRoundPlan(c, history(c), NOV4), NOV4);
  const later = IL(2026, 11, 4, 11);
  const st = clientState(w.c, w.checks, later);
  for (const id of BEFORE_EDITING) {
    const s = st.states.find((x) => x.proc.id === `r2-${id}`);
    if (s) assert.ok(s.complete || s.proc.recurring, `${id} is behind the round`);
  }
  const p22 = st.states.find((s) => s.proc.id === 'r2-p22');
  assert.equal(p22.complete, false);
  assert.deepEqual(p22.proc.owners, ['anna']);
  assert.equal(+p22.dueAt, +addBusinessDays(NOV4, 2));
  const ph = phasesFor(w.c).find((p) => p.key === 'round-2');
  assert.deepEqual([ph.title, ph.needs], ['עריכה חודשית · נובמבר 2026', []]);
  const jobs = editingCases(w.c, w.checks, 'anna', st);
  const job = jobs.find((j) => j.round === 2);
  assert.ok(job, 'Anna has the month\'s card');
  assert.equal(job.ctx.monthly, true);
  assert.equal(job.ctx.month, '2026-11');
  assert.equal(editorState(job, w.checks).key, 'editing');
  assert.equal(editingCases(w.c, w.checks, 'nadia', st).length, 0);
});

test('a monthly round is no shoot day: not held, not in the shoot lists, not "יום צילום שלא נקבע"', () => {
  const c = client();
  const w = apply(c, history(c), monthlyRoundPlan(c, history(c), NOV4), NOV4);
  const r = roundsOf(w.c)[0];
  assert.equal(shootHeld({ pid: 'r2-', ctx: roundContext(w.c, r) }, w.checks, NOV4), null);
  assert.deepEqual(shootContexts(w.c).map((x) => x.n), [1]);
  const hist = shootHistory(w.c, w.checks, NOV4);
  assert.equal(hist.held, 1, 'only the real shoot day');
  // A shoot round still is one.
  assert.equal(roundContext(w.c, { n: 3, shoot_at: null }).monthly, undefined);
});

test('nothing rings for anyone but the editor about the round; once the editing is late, the lateness note as for any round', () => {
  const c = client();
  const base = history(c);
  const w = apply(c, base, monthlyRoundPlan(c, base, NOV4), NOV4);
  const world = (cl, checks) => ({ clients: [cl], checks: Object.values(checks).map((x) => ({ ...x, client_id: cl.id })), tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF });
  const roundOnes = (at) => computeReminders({ ...world(w.c, w.checks), now: at, log: [] }).filter((r) => /\br2[.-]/.test(r.key) || /\br2[.-]/.test(r.ref || ''));
  // Before the editing's deadline (the end of the second business day after the round opened: Sunday 8.11, 18:00):
  for (const at of [IL(2026, 11, 4, 10, 1), IL(2026, 11, 4, 16), IL(2026, 11, 5, 10), IL(2026, 11, 6, 12), IL(2026, 11, 8, 17)]) {
    const got = roundOnes(at);
    assert.ok(got.length, `the editor hears of it (${at.toISOString()})`);
    assert.deepEqual([...new Set(got.map((r) => r.person))], ['anna'], `${at.toISOString()}: ${got.map((r) => `${r.person} ${r.rule}`).join(', ')}`);
    assert.ok(got.every((r) => r.rule === 'editing'));
  }
  // Late: Ofir, Lior and the owner get the lateness notes of 22/24, as for every round; never Irit, Eli or Ilai.
  for (const at of [IL(2026, 11, 8, 12), IL(2026, 11, 9, 12), IL(2026, 11, 12, 12)]) {
    for (const r of roundOnes(at)) {
      assert.ok(r.person === 'anna' || (['ofir', 'lior', 'owner'].includes(r.person) && /^late/.test(r.rule)), `${at.toISOString()}: ${r.person} ${r.rule} ${r.title}`);
    }
  }
  assert.equal(+clientState(w.c, w.checks, NOV4).states.find((s) => s.proc.id === 'r2-p22').dueAt, +IL(2026, 11, 8, 18));
});

test('Irit\'s messages to the client: nothing of a shoot day or a move of station for the monthly round', () => {
  const c = client();
  const base = history(c);
  const w = apply(c, base, monthlyRoundPlan(c, base, NOV4), NOV4);
  assert.equal(stationChange(w.c, w.checks, null, IL(2026, 11, 4, 12)), null);
  for (const at of [IL(2026, 11, 4, 12), IL(2026, 11, 5, 10)]) {
    const s = suggestFor(w.c, w.checks, [], at);
    const keys = [...(s?.options || []), ...(s?.milestones || [])].map((o) => o.key || o.option?.key).filter(Boolean);
    for (const k of ['scripts', 'eve', 'eve_solo', 'thanks']) assert.ok(!keys.includes(k), `${k} at ${at.toISOString()}: ${keys.join()}`);
    assert.doesNotMatch(JSON.stringify(s || {}), /r2\.(scripts|eve|thanks|station)/);
  }
  const vars = thursdayVars(w.c, w.checks, clientState(w.c, w.checks, IL(2026, 11, 5, 12)), IL(2026, 11, 5, 12));
  assert.doesNotMatch(JSON.stringify(vars), /יום צילום|תסריט/);
});

// ── The reminders function's tick (supabase/functions/reminders/tick.js) ──
function tickDb(clients, rows, { refuse = false, stale = false } = {}) {
  const db = {
    clients, rows, log: [], writes: [], nextId: 1,
    async load() { return { clients: db.clients.map((c) => ({ ...c, rounds: [...c.rounds] })), checks: db.rows.map((r) => ({ ...r })), tasks: [], staff: STAFF, access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], log: [] }; },
    async known() { return new Set(); },
    async insertLog(list) { const out = list.map((r) => ({ id: db.nextId++, created_at: new Date().toISOString(), attempts: 0, ...r })); db.log.push(...out); return out; },
    async reclaim() { return []; },
    async updateLog() {},
    // As index.ts: the round only when the row is the one loaded; the marks never over one that exists.
    async openMonthlyRound({ client, rounds, marks }) {
      if (refuse) throw Object.assign(new Error('refused'), { code: '42501' });
      const row = db.clients.find((c) => c.id === client.id);
      if (rounds) {
        if (stale || row.updated_at !== client.updated_at) return false;
        row.rounds = rounds;
        row.updated_at = new Date(Date.parse(row.updated_at) + 1000).toISOString();
      }
      for (const m of marks) if (!db.rows.some((r) => r.client_id === client.id && r.item_key === m.item_key)) db.rows.push({ client_id: client.id, ...m, by_email: 'system', at: new Date().toISOString() });
      db.writes.push(client.id);
      return true;
    },
  };
  return db;
}
const noPush = async () => ({ ok: true, status: 201 });

test('the tick opens the month once; again the same minute or the next day: nothing', async () => {
  const c = client({ name: 'אלאור בוטיק' });
  const other = client({ deliverables: { videos: 8 } });
  const db = tickDb([c, other], [...Object.values(history(c)), ...Object.values(history(other))]);
  const s1 = await runTick({ db, push: noPush, now: NOV4 });
  assert.equal(s1.monthly, 1);
  assert.equal(s1.monthlyFailed, 0);
  assert.deepEqual(db.clients[0].rounds, [{ n: 2, month: '2026-11', monthly: true, editor: 'anna', start_at: NOV4.toISOString() }]);
  assert.deepEqual(db.clients[1].rounds, []);
  assert.equal(db.rows.filter((r) => r.item_key.startsWith('r2.')).length, NA_KEYS.length + 2);
  assert.equal(db.rows.find((r) => r.item_key === 'r2.p22a.assigned').note, MONTHLY_NOTE);
  // This tick already saw the round: the editor's own "new client in editing" went out, nobody else's.
  const told = db.log.filter((r) => /:r2-/.test(r.key));
  assert.ok(told.length && told.every((r) => r.person === 'anna'), told.map((r) => `${r.person} ${r.key}`).join());
  for (const at of [IL(2026, 11, 4, 10, 1), IL(2026, 11, 5, 9)]) {
    const s = await runTick({ db, push: noPush, now: at });
    assert.equal(s.monthly, 0);
  }
  assert.deepEqual(db.writes, [c.id]);
  assert.equal(db.clients[0].rounds.length, 1);
});

test('the tick: a row changed since it was loaded writes nothing; a refusal is counted and the tick goes on', async () => {
  const c = client();
  const stale = tickDb([c], Object.values(history(c)), { stale: true });
  const s1 = await runTick({ db: stale, push: noPush, now: NOV4 });
  assert.deepEqual([s1.monthly, s1.monthlyFailed, stale.clients[0].rounds.length, stale.rows.some((r) => r.item_key.startsWith('r2.'))], [0, 0, 0, false]);
  const refused = tickDb([client()], [], { refuse: true });
  refused.rows = Object.values(history(refused.clients[0]));
  const s2 = await runTick({ db: refused, push: noPush, now: NOV4 });
  assert.deepEqual([s2.monthly, s2.monthlyFailed, s2.errors], [0, 1, 0]);
  // A database without the write (an older adapter): the tick runs as before.
  const plain = tickDb([client()], []);
  delete plain.openMonthlyRound;
  const s3 = await runTick({ db: plain, push: noPush, now: NOV4 });
  assert.equal(s3.monthly, 0);
});
