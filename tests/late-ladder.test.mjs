// Whoever is late keeps being reminded, the client's fix request reaches Irit, and the
// owners' end-of-day table at 19:00 (the owner's approval of 8.10.2026; docs/ops.md,
// section 48). Fixed Israel times; npm test runs this under UTC, New York and Jerusalem.
//   1  who holds a late item and who waits for it, read from the protocol and its hand-offs;
//   2  the ladder, step by step: "באיחור" at the deadline, the one who waits told once,
//      09:00 and 14:00 every working day, the managers after one business day, the owners
//      after two; an ordinary task follows the same ladder;
//   3  several late things at one moment are ONE message; a day's volume per person;
//   4  what is left out: landing, "ממתין ללקוח", a pause, the client's turn, a snooze,
//      the weekend, erev chag, Lior's shoot day, a process with its own deadline ring;
//   5  the fix request: Irit's ring and the wording of her item;
//   6  the 19:00 table: the rows, the totals, the empty day, landing, erev chag, the push.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders, buildEnv, planDelivery, planDigests, summaryOf } from '../app/reminder-engine.js';
import { RULES, LATE_LADDER, LATE_BATCH_MINUTES, DIGESTS, ownerDigestAt, OWN_LATE, nextNagSlot } from '../app/reminder-rules.js';
import { lateItems, lateWords, fixTaskOf, fixNote, FIX_ITEM_LABEL, CLIENT_TURN } from '../app/late-chain.js';
import { daySummary, headline, pushLines, waText, EOD, EMPTY_DAY } from '../app/day-summary.js';
import { PROCESSES } from '../app/protocol.js';
import { clientState, IMPORT_NOTE, waitNote } from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';
import { isOwnerView } from '../app/team-rules.js';
import { runTick } from '../supabase/functions/reminders/tick.js';
import { dateIL, partsIL } from '../app/tz.js';
import { clocksFor, fixAnswered } from '../app/clocks.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'owner2@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' }, { email: 'nadia@x', person: 'nadia' }, { email: 'eli@x', person: 'eli' },
];
let seq = 0;
const world = () => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, deals: [] });
function client(w, o = {}) {
  seq += 1;
  const c = {
    id: `c${seq}`, name: o.name || `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
    rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 9, 1, 10).toISOString(), created_by_email: 'irit@x', ...o,
  };
  w.clients.push(c);
  return c;
}
const mark = (w, c, key, at, note = null) => { (w.checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state: 'done', note, at: at.toISOString(), by_email: 'x@x' }; };
const marks = (w, c, keys, at, note = null) => keys.forEach((k) => mark(w, c, k, at, note));
const itemsOf = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key);
const importTo = (w, c, station, at = IL(2026, 9, 1, 9)) => marks(w, c, importKeys(station), at, IMPORT_NOTE);
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const of = (list, rule, person = null) => list.filter((r) => r.rule === rule && (!person || r.person === person));
const stepsOf = (list, rule) => of(list, rule).map((r) => `${r.step}@${r.person}:${r.level}`).sort();
const lateOf = (w, now) => lateItems({ clients: w.clients, checksOf: (c) => w.checks[c.id] || {}, stateOf: (c) => clientState(c, w.checks[c.id] || {}, now), tasks: w.tasks, personOf: (e) => STAFF.find((s) => s.email === e)?.person ?? null, now });

// A client whose characterization ended on Monday 5.10.2026 at 12:00: the clocks of 5–10
// run from there (5 and 9 by 12:00 and 12:05, the 9 graphics, the Highlights and Meta by 14:00).
function afterMeeting(w = world(), o = {}) {
  const c = client(w, { name: 'אלפא', char_at: IL(2026, 10, 5, 10).toISOString(), ...o });
  importTo(w, c, 'char');
  marks(w, c, itemsOf('p04'), IL(2026, 10, 5, 12));
  marks(w, c, itemsOf('p05b'), IL(2026, 10, 5, 12, 10)); // Irit sent the logins link on time (5ב, protocol v8)
  return { w, c };
}
// Everything of the meeting day done on time, but Ilai's 9 graphics.
function onlyGraphicsLate(o = {}) {
  const { w, c } = afterMeeting(world(), o);
  // (11 came in with the history, with no shoot date: marked again by hand it would be open, since protocol v8.)
  for (const id of ['p05', 'p05b', 'p06', 'p08', 'p08b', 'p09', 'p10', 'p12a', 'p12']) marks(w, c, itemsOf(id), IL(2026, 10, 5, 12, 30));
  return { w, c };
}

// ── 1. Who holds, who waits ─────────────────────────────────────────────────
test('who holds a late item and who waits for it come from the protocol: its items, its hand-offs and the clocks that start from it', () => {
  const { w, c } = afterMeeting();
  const now = IL(2026, 10, 5, 15);
  const by = (num) => lateOf(w, now).find((x) => x.num === num);
  // 7: Ilai makes; Irit reviews after him (the hand-off "9 גרפיקות מוכנות" goes to her). Since
  // protocol v8 the review is hers alone: Lior is not a waiter.
  assert.deepEqual([by('7').holders, by('7').waiters.sort()], [['ilai'], ['irit']]);
  // 5: the access is taken by the characterizer and Irit; Ilai's 30 minutes (6) start from it.
  assert.deepEqual([by('5').holders.sort(), by('5').waiters], [['irit', 'ofir'], ['ilai']]);
  // 8 and 10 are their owner's alone: nobody waits inside the protocol.
  assert.deepEqual([by('8').holders, by('10').holders], [['ofir'], ['lior']]);
  assert.equal(hhmm(by('7').lateAt), '5.10 14:15'); // the deadline and the grace
  // Ofir and Lior are told of their own late process by the note every late process sends them
  // (rule `late`), not a second time: one line each in their batch, never the same item twice.
  const at1415 = due(w, IL(2026, 10, 5, 14, 15));
  const told = (p, num) => at1415.filter((r) => r.person === p && /^late(Own)?$/.test(r.rule) && new RegExp(` ${num} · `).test(r.title)).map((r) => `${r.rule}.${r.step}`);
  assert.deepEqual([told('ofir', '8'), told('lior', '10'), told('ilai', '7'), told('ofir', '7')], [['late.ofir'], ['late.lior'], ['lateOwn.own'], ['late.ofir']]);
  assert.equal(LATE_LADDER.graceMinutes, 15);
  // Ilai delivered a day late. The review is Irit's alone, and since protocol v8 it has its own
  // clock from the moment the graphics reach her: two office hours, so 7 is not late at all now.
  mark(w, c, 'p07.made', IL(2026, 10, 6, 9, 45));
  assert.equal(lateOf(w, IL(2026, 10, 6, 10)).find((x) => x.num === '7'), undefined);
  assert.equal(hhmm(clientState(c, w.checks[c.id], IL(2026, 10, 6, 10)).states.find((s) => s.proc.id === 'p07').dueAt), '6.10 11:45');
  // Nobody is rung "באיחור", told "מתעכב" or reminded "עדיין באיחור" about work that just landed on them.
  assert.deepEqual(due(w, IL(2026, 10, 6, 10)).filter((r) => /^late(Own|Nag)?$/.test(r.rule) && / 7 · /.test(`${r.title} ${r.body}`)), []);
  assert.equal(LATE_LADDER.tellWithinMinutes, 60);
  // Her own deadline passed (11:45, and the grace): now it is hers, and Lior hears as a manager only.
  // (Ilai waits again: his upload, 7ב, starts when the client approves.)
  const after = lateOf(w, IL(2026, 10, 6, 12, 5)).find((x) => x.num === '7');
  assert.deepEqual([after.holders, after.waiters, hhmm(after.lateAt)], [['irit'], ['ilai'], '6.10 12:00']);
  const at12 = due(w, IL(2026, 10, 6, 12, 0)).filter((r) => / 7 · /.test(r.title));
  assert.deepEqual(at12.filter((r) => r.rule === 'lateOwn').map((r) => `${r.step}@${r.person}`).sort(), ['own@irit', 'wait@ilai']);
  assert.deepEqual(at12.filter((r) => r.rule === 'late').map((r) => r.person).sort(), ['lior', 'ofir']);
  const nagTo = (now) => due(w, now).filter((r) => r.rule === 'lateNag' && / 7 · /.test(`${r.title} ${r.body}`)).map((r) => r.person).sort();
  assert.deepEqual(nagTo(IL(2026, 10, 6, 9, 46)), []);
  assert.deepEqual(nagTo(IL(2026, 10, 6, 14, 0)), ['irit']);
  // Sent to the client: it is the client's turn, nobody in the office holds it.
  marks(w, c, itemsOf('p07').filter((k) => k !== 'p07.approved' && k !== 'p07.made'), IL(2026, 10, 6, 10, 30));
  const sent = lateOf(w, IL(2026, 10, 6, 14)).find((x) => x.num === '7');
  assert.deepEqual([sent.holders, sent.waiters, sent.clientTurn], [[], [], true]);
  assert.ok(CLIENT_TURN.has('p07.approved') && CLIENT_TURN.has('p27.approved') && CLIENT_TURN.has('p13.approved'));
});

test('the editing: the editor holds 22 and 24, and Ofir (quality control) waits for the hand-over', () => {
  const w = world();
  const c = client(w, { editor: 'nadia', shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, c, 'post');
  for (const id of ['p22a', 'p22', 'p24', 'p25', 'p26', 'p27', 'p28', 'p29', 'p30']) for (const i of PROCESSES.find((p) => p.id === id).items) delete w.checks[c.id][i.key];
  marks(w, c, itemsOf('p22a'), IL(2026, 10, 18, 10)); // assigned Sunday: due the end of Wednesday 21.10
  // (Ofir's own items inside 22 and 24, the drive and the folder, are done.)
  for (const id of ['p22', 'p24']) for (const i of PROCESSES.find((p) => p.id === id).items) if ((i.owners || []).includes('ofir')) mark(w, c, i.key, IL(2026, 10, 18, 11));
  const late = lateOf(w, IL(2026, 10, 22, 10));
  const p22 = late.find((x) => x.num === '22');
  const p24 = late.find((x) => x.num === '24');
  assert.deepEqual(p22.holders, ['nadia']);
  assert.deepEqual([p24.holders, p24.waiters], [['nadia'], ['ofir']]);
});

// ── 2. The ladder ───────────────────────────────────────────────────────────
test('the ladder of a late item: "באיחור" when the deadline passes, the one who waits told once, 09:00 and 14:00 every working day, the managers after one business day, the owners after two', () => {
  const { w, c } = onlyGraphicsLate();
  const log = [];
  const at = (now) => { const got = due(w, now, log); log.push(...got.map((r) => ({ key: r.key }))); return got; };
  // Monday 5.10, the 9 graphics were due at 14:00. Before the grace: nothing of the ladder.
  assert.deepEqual(stepsOf(at(IL(2026, 10, 5, 14, 14)), 'lateOwn'), []);
  const first = at(IL(2026, 10, 5, 14, 15));
  // Ilai rings; Irit, who reviews them next, is told why her card is stuck. (Lior waits too, and
  // is told by the note every late item sends him and Ofir: rule `late`, as before.)
  assert.deepEqual(stepsOf(first, 'lateOwn'), ['own@ilai:ring', 'wait@irit:quiet']);
  assert.deepEqual(stepsOf(first, 'late'), ['lior@lior:quiet', 'ofir@ofir:quiet']);
  const [own] = of(first, 'lateOwn', 'ilai');
  assert.equal(own.title, 'באיחור: אלפא · 7 · הכנת 9 גרפיקות ראשונות');
  assert.match(own.body, /^היעד היה היום 14:00\. תזכורת ב־09:00 וב־14:00 בכל יום עבודה, עד שזה מסומן\.$/);
  assert.equal(own.batch, true);
  const [wait] = of(first, 'lateOwn', 'irit');
  assert.equal(wait.title, 'מתעכב אצל עילאי: אלפא · 7 · הכנת 9 גרפיקות ראשונות');
  assert.match(wait.body, /^בגלל זה הכרטיס שלך מחכה\./);
  // The same afternoon: no reminder (it became late after 14:00).
  assert.deepEqual(stepsOf(at(IL(2026, 10, 5, 16)), 'lateNag'), []);
  // Tuesday: 09:00 and 14:00, one ring each, and nothing in between.
  assert.deepEqual(stepsOf(at(IL(2026, 10, 6, 8, 59)), 'lateNag'), []);
  const nine = at(IL(2026, 10, 6, 9, 0));
  assert.deepEqual(stepsOf(nine, 'lateNag'), ['d2026-10-06.0900@ilai:ring']);
  assert.equal(of(nine, 'lateNag')[0].title, 'עדיין באיחור: אלפא · 7 · הכנת 9 גרפיקות ראשונות');
  assert.match(of(nine, 'lateNag')[0].body, /^באיחור יום עסקים\. מסמנים ב״המשימות שלי״/);
  assert.deepEqual(stepsOf(at(IL(2026, 10, 6, 11)), 'lateNag'), []);
  assert.deepEqual(stepsOf(at(IL(2026, 10, 6, 14, 0)), 'lateNag'), ['d2026-10-06.1400@ilai:ring']);
  // One full business day late (Tuesday 14:15 passed): the managers ring at the next of the two hours,
  // Wednesday 09:00, so that everything that crossed the line since 14:00 is one ring. Nothing new for Ilai or Irit.
  assert.deepEqual(stepsOf(at(IL(2026, 10, 6, 14, 15)), 'lateOwn'), []);
  assert.deepEqual(stepsOf(at(IL(2026, 10, 7, 8, 59)), 'lateOwn'), []);
  const mgr = at(IL(2026, 10, 7, 9, 0));
  assert.deepEqual(stepsOf(mgr, 'lateOwn'), ['mgr@lior:ring', 'mgr@ofir:ring']);
  assert.equal(hhmm(nextNagSlot(IL(2026, 10, 6, 14, 15))), '7.10 09:00');
  assert.equal(hhmm(nextNagSlot(IL(2026, 10, 8, 14, 1))), '11.10 09:00'); // Thursday afternoon: Sunday
  assert.equal(hhmm(nextNagSlot(IL(2027, 4, 21, 9, 15))), '25.4 09:00');  // erev Pesach after 09:00: after the holiday and the weekend
  assert.equal(of(mgr, 'lateOwn', 'ofir')[0].title, 'באיחור יום עסקים: אלפא · 7 · הכנת 9 גרפיקות ראשונות · עילאי');
  // Two business days (Wednesday 14:15 passed): the owners ring on Thursday 09:00, with a link to their table.
  at(IL(2026, 10, 7, 14, 0));
  assert.deepEqual(stepsOf(at(IL(2026, 10, 7, 14, 15)), 'lateOwn'), []);
  const owner = at(IL(2026, 10, 8, 9, 0));
  assert.deepEqual(stepsOf(owner, 'lateOwn'), ['owner@owner:ring']);
  assert.equal(of(owner, 'lateOwn')[0].title, 'באיחור יומיים: אלפא · 7 · הכנת 9 גרפיקות ראשונות · עילאי');
  assert.equal(of(owner, 'lateOwn')[0].url, 'owner.html#eod');
  // Thursday as every day; Friday and Saturday nothing; Sunday again. Until it is done.
  assert.deepEqual(stepsOf(owner, 'lateNag'), ['d2026-10-08.0900@ilai:ring']);
  assert.deepEqual(stepsOf(at(IL(2026, 10, 9, 9, 0)), 'lateNag'), []);
  assert.deepEqual(stepsOf(at(IL(2026, 10, 10, 14, 0)), 'lateNag'), []);
  assert.deepEqual(stepsOf(at(IL(2026, 10, 11, 9, 0)), 'lateNag'), ['d2026-10-11.0900@ilai:ring']);
  mark(w, c, 'p07.made', IL(2026, 10, 11, 10));
  // Done: Ilai's ladder stops. The review he handed on is late from its first minute: Irit and Lior hold it now.
  const done = at(IL(2026, 10, 11, 14, 0));
  assert.deepEqual(of(done, 'lateNag').map((r) => r.person).sort(), ['irit', 'lior']);
  assert.deepEqual(stepsOf(done, 'lateOwn'), []);
  // The numbers are data.
  assert.deepEqual(LATE_LADDER, { graceMinutes: 15, tellWithinMinutes: 60, nagAt: ['09:00', '14:00'], managerAfter: 1, ownerAfter: 2, managers: ['ofir', 'lior'], listMax: 6 });
  for (const id of ['lateOwn', 'lateNag']) assert.ok(RULES.some((r) => r.id === id), id);
});

test('an ordinary task (a decision\'s task too) that stays open past its due day follows the same ladder; whoever opened it is the one who waits', () => {
  const w = world();
  const c = client(w, { name: 'מאפייה' });
  importTo(w, c, 'ongoing');
  // Lior decided an exception and opened the next action for Irit, due Monday 5.10.
  w.tasks.push({ id: 't1', client_id: c.id, title: 'לתאם צילום המלצה', owner: 'irit', due_on: '2026-10-05', urgent: false, source: 'manual', created_at: IL(2026, 10, 4, 11).toISOString(), created_by_email: 'nadia@x' });
  const log = [];
  const at = (now) => { const got = due(w, now, log).filter((r) => /^(lateOwn|lateNag|task)$/.test(r.rule)); log.push(...got.map((r) => ({ key: r.key }))); return got.map((r) => `${r.rule}.${r.step}@${r.person}:${r.level}`).sort(); };
  at(IL(2026, 10, 5, 8, 30));
  assert.deepEqual(at(IL(2026, 10, 5, 19)), []); // the due day itself: not late
  assert.deepEqual(at(IL(2026, 10, 6, 9, 14)), []);
  // Tuesday 09:15: Irit rings; Nadia, who opened it, is told once; Ofir and Lior get their note.
  assert.deepEqual(at(IL(2026, 10, 6, 9, 15)), ['lateOwn.own@irit:ring', 'lateOwn.wait@nadia:quiet', 'task.late@lior:quiet', 'task.late@ofir:quiet']);
  assert.deepEqual(at(IL(2026, 10, 6, 14, 0)), ['lateNag.d2026-10-06.1400@irit:ring']);
  assert.deepEqual(at(IL(2026, 10, 7, 9, 0)), ['lateNag.d2026-10-07.0900@irit:ring']);
  assert.deepEqual(at(IL(2026, 10, 7, 9, 15)), []);
  // A full business day late since Wednesday 09:15: the managers at 14:00; the owners on Thursday at 14:00.
  assert.deepEqual(at(IL(2026, 10, 7, 14, 0)), ['lateNag.d2026-10-07.1400@irit:ring', 'lateOwn.mgr@lior:ring', 'lateOwn.mgr@ofir:ring']);
  assert.deepEqual(at(IL(2026, 10, 8, 9, 15)), ['lateNag.d2026-10-08.0900@irit:ring']);
  assert.deepEqual(at(IL(2026, 10, 8, 14, 0)), ['lateNag.d2026-10-08.1400@irit:ring', 'lateOwn.owner@owner:ring']);
  // Weeks later it still rings twice a day (it used to be mentioned once and forgotten).
  assert.deepEqual(at(IL(2026, 11, 2, 9, 0)), ['lateNag.d2026-11-02.0900@irit:ring']);
  assert.match(due(w, IL(2026, 11, 2, 9, 0)).find((r) => r.rule === 'lateNag').body, /^באיחור 20 ימי עסקים/);
  w.tasks[0].done_at = IL(2026, 11, 2, 10).toISOString();
  assert.deepEqual(at(IL(2026, 11, 2, 14, 0)), []);
  // A task of the manager himself: he is not his own manager's ring.
  const w2 = world();
  const c2 = client(w2);
  importTo(w2, c2, 'ongoing');
  w2.tasks.push({ id: 't2', client_id: c2.id, title: 'לבדוק קמפיין', owner: 'lior', due_on: '2026-10-05', urgent: false, created_at: IL(2026, 10, 4, 11).toISOString(), created_by_email: 'lior@x' });
  assert.deepEqual(due(w2, IL(2026, 10, 7, 14, 0)).filter((r) => r.rule === 'lateOwn' && r.step === 'mgr').map((r) => r.person), ['ofir']);
});

// ── 3. One message, and the day's volume ────────────────────────────────────
const KEY = 'B'.repeat(87);
function fakeDb(w) {
  let clock = new Date();
  const db = {
    log: [], nextId: 1,
    subs: STAFF.map((s, i) => ({ id: `s${i}`, email: s.email, endpoint: `https://push.test/${s.email}`, p256dh: KEY, auth: 'A'.repeat(22), fail_count: 0 })),
    at(now) { clock = now; return db; },
    async load() { return { ...w, checks: Object.values(w.checks).flatMap((x) => Object.values(x)), subscriptions: db.subs.map((s) => ({ ...s })), log: db.log.map((r) => ({ ...r })) }; },
    async known(keys) { const set = new Set(keys); return new Set(db.log.map((r) => r.key).filter((k) => set.has(k))); },
    async insertLog(rows) {
      const out = [];
      for (const r of rows) {
        // The table's own checks (20260930110000_reminders.sql): a new rule must fit them.
        assert.ok(/^[a-zA-Z0-9]+$/.test(r.rule) && r.key.length <= 400 && r.title.length <= 300 && ['ring', 'quiet', 'digest', 'board'].includes(r.level), JSON.stringify(r));
        assert.ok(r.ref === null || /^(r[0-9]+\.)?p[0-9]+[ab]?$/.test(r.ref), r.ref);
        if (db.log.some((x) => x.key === r.key)) continue;
        const row = { id: db.nextId++, created_at: clock.toISOString(), claimed_at: clock.toISOString(), attempts: 0, read_at: null, digest_key: null, ...r };
        db.log.push(row);
        out.push({ ...row });
      }
      return out;
    },
    async reclaim() { return []; },
    async updateLog(ids, patch) { for (const r of db.log) if (ids.includes(r.id)) Object.assign(r, patch); },
    async subscriptionOk() {}, async subscriptionFailed() {}, async removeSubscription() {},
  };
  return db;
}
function phones() {
  const sent = [];
  const push = async (sub, payload, opts) => { sent.push({ to: sub.endpoint.split('/').pop().split('@')[0], at: null, ...JSON.parse(payload), urgency: opts.urgency }); return { ok: true, status: 201 }; };
  return { push, sent };
}
// Every minute of the office's day, as the cron does.
async function runDay(db, push, sent, y, m, d, from = [8, 0], to = [19, 30]) {
  for (let t = IL(y, m, d, ...from); t <= IL(y, m, d, ...to); t = new Date(t.getTime() + 6e4)) {
    const before = sent.length;
    await runTick({ db: db.at(t), push, now: t });
    for (const s of sent.slice(before)) s.at = hhmm(t);
  }
}
const fiveLateEach = (dueOn) => {
  const w = world();
  const c = client(w, { name: 'גמא' });
  importTo(w, c, 'ongoing');
  for (const p of ['irit', 'ilai', 'nadia']) for (let i = 1; i <= 5; i += 1) w.tasks.push({ id: `${p}${i}`, client_id: c.id, title: `משימה ${i} של ${p}`, owner: p, due_on: dueOn, urgent: false, created_at: IL(2026, 9, 20, 11).toISOString(), created_by_email: 'owner@x' });
  return w;
};

test('several things that became late at the same moment are ONE ring with the list, not one per item', async () => {
  const w = fiveLateEach('2026-10-05'); // due Monday: late from Tuesday 09:15
  const db = fakeDb(w);
  const { push, sent } = phones();
  await runDay(db, push, sent, 2026, 10, 6, [8, 30], [9, 20]);
  const irit = sent.filter((s) => s.to === 'irit' && s.title !== 'תקציר בוקר');
  assert.equal(irit.length, 1, irit.map((s) => `${s.at} ${s.title}`).join(' | '));
  assert.equal(irit[0].title, '5 איחורים חדשים');
  assert.equal(irit[0].at, '6.10 09:15');
  assert.match(irit[0].body, /^גמא · משימה 1 של irit\nגמא · משימה 2 של irit\nגמא · משימה 3 של irit\nגמא · משימה 4 של irit\nועוד 1$/);
  // A ring, not a quiet line: its row is a ring and it goes out as one (high urgency).
  const row = db.log.find((r) => r.key.startsWith('digest:late:irit:'));
  assert.deepEqual([row.level, row.channel, row.status, irit[0].urgency], ['ring', 'push', 'sent', 'high']);
  // Each item is still a row of its own in "התראות", marked as sent with that batch.
  const mine = db.log.filter((r) => r.rule === 'lateOwn' && r.person === 'irit');
  assert.deepEqual([mine.length, new Set(mine.map((r) => r.digest_key)).size, mine.every((r) => r.status === 'sent' && r.level === 'ring')], [5, 1, true]);
  // Ofir and Lior: one batch each with the 15 notes (as before), nothing per item.
  assert.deepEqual(['ofir', 'lior'].map((p) => sent.filter((s) => s.to === p && s.title !== 'תקציר בוקר').map((s) => s.title)), [['15 איחורים חדשים'], ['15 איחורים חדשים']]);
  assert.equal(LATE_BATCH_MINUTES, 30);
});

test('the volume of a day: with 5 late items each, a person gets the two daily reminders and one "became late" ring, never a message per item', async () => {
  // Day 1 (Tuesday 6.10): the day they become late. Day 2: a full day of lateness. Day 3: the owners' day.
  const w = fiveLateEach('2026-10-05');
  const db = fakeDb(w);
  const { push, sent } = phones();
  const day = async (d) => { const from = sent.length; await runDay(db, push, sent, 2026, 10, d); return sent.slice(from); };
  // (What is about lateness, and the daily digests; the office's other rings of the day are not this test's.)
  const about = (list, p) => list.filter((s) => s.to === p && /איחור|תקציר בוקר|סיכום היום/.test(s.title)).map((s) => `${s.at.split(' ')[1]} ${s.title}`);
  const d1 = await day(6);
  // The late person: the morning digest (as every day), "באיחור" once at 09:15, the 14:00 reminder.
  for (const p of ['irit', 'ilai', 'nadia']) assert.deepEqual(about(d1, p), ['08:30 תקציר בוקר', '09:15 5 איחורים חדשים', '14:00 5 דברים באיחור אצלך'], p);
  assert.deepEqual(about(d1, 'ofir'), ['08:30 תקציר בוקר', '09:15 15 איחורים חדשים']);
  assert.deepEqual(about(d1, 'owner'), ['19:00 סיכום היום']);
  assert.equal(d1.filter((s) => s.to === 'owner2').length, 1); // both owners
  assert.match(d1.find((s) => s.to === 'owner').body, /^היום: 15 באיחור אצל 3 עובדים, כל מה שהיה להיום בוצע\n/);
  const d2 = await day(7);
  for (const p of ['irit', 'ilai', 'nadia']) assert.deepEqual(about(d2, p), ['08:30 תקציר בוקר', '09:00 5 דברים באיחור אצלך', '14:00 5 דברים באיחור אצלך'], p);
  // The managers: ONE ring for the 15 items that are a business day late.
  assert.deepEqual(about(d2, 'ofir').filter((t) => /איחור/.test(t)), ['14:00 באיחור יום עסקים: 15 פריטים']);
  assert.deepEqual(about(d2, 'lior').filter((t) => /איחור/.test(t)), ['14:00 באיחור יום עסקים: 15 פריטים']);
  assert.equal(db.log.find((r) => r.key.startsWith('digest:late:ofir:2026-10-07')).level, 'ring');
  const d3 = await day(8);
  assert.deepEqual(about(d3, 'owner').filter((t) => !/סיכום היום/.test(t)), ['14:00 באיחור יומיים: 15 פריטים']);
  assert.ok(about(d3, 'owner').some((t) => /^19:00 סיכום היום/.test(t)));
  // Over the three days nobody got more than the two reminders and one batch about lateness a day.
  for (const list of [d1, d2, d3]) {
    for (const p of ['irit', 'ilai', 'nadia', 'ofir', 'lior']) {
      const lateness = list.filter((s) => s.to === p && /איחור/.test(s.title));
      assert.ok(lateness.length <= 3, `${p}: ${lateness.map((s) => s.title).join(' | ')}`);
    }
  }
  // The body of the reminder names the first six and counts the rest (5 here: all named).
  assert.equal(d2.find((s) => s.to === 'irit' && s.at.endsWith('09:00')).body.split('\n').length, 6);
});

test('a deploy on old data: what has been late for days sends no "became late" ring and no manager ring; each late person gets the one grouped reminder', async () => {
  const w = fiveLateEach('2026-09-24'); // late for more than a week
  const db = fakeDb(w);
  const { push, sent } = phones();
  await runDay(db, push, sent, 2026, 10, 6);
  const titles = (p) => sent.filter((s) => s.to === p && /איחור|תקציר בוקר|סיכום היום/.test(s.title)).map((s) => s.title);
  for (const p of ['irit', 'ilai', 'nadia']) assert.deepEqual(titles(p), ['תקציר בוקר', '5 דברים באיחור אצלך', '5 דברים באיחור אצלך'], p);
  assert.deepEqual([titles('ofir'), titles('lior')].map((t) => t.filter((x) => /איחור/.test(x))), [[], []]);
  assert.deepEqual(titles('owner'), ['סיכום היום']);
  assert.ok(db.log.filter((r) => r.rule === 'lateOwn').every((r) => r.status === 'suppressed' && r.reason === 'stale'));
});

// ── 4. What is left out ─────────────────────────────────────────────────────
test('not for a client in landing, not while "ממתין ללקוח" or a pause, not on the weekend; erev chag has the 09:00 only; a snooze holds it', () => {
  const ladder = (w, now) => due(w, now).filter((r) => r.rule === 'lateOwn' || r.rule === 'lateNag').map((r) => `${r.rule}.${r.step}@${r.person}`);
  const tue = IL(2026, 10, 6, 14, 0);
  const base = onlyGraphicsLate();
  assert.ok(ladder(base.w, tue).includes('lateNag.d2026-10-06.1400@ilai'));
  // In landing: nothing of it, and nothing in the table (ops §41).
  const landing = onlyGraphicsLate({ landing: true });
  assert.deepEqual(ladder(landing.w, tue), []);
  assert.equal(summaryOf(buildEnv({ ...landing.w, now: tue })).empty, true);
  // "ממתין ללקוח" on the process: the clock stopped, and so did the reminders.
  const waiting = onlyGraphicsLate();
  mark(waiting.w, waiting.c, 'p07.wait', IL(2026, 10, 5, 13), waitNote('הלקוח לא שלח לוגו', null));
  assert.deepEqual(ladder(waiting.w, tue), []);
  // "לדחות עד…" on the process: held until that moment.
  const snoozed = onlyGraphicsLate();
  mark(snoozed.w, snoozed.c, 'p07.snooze', IL(2026, 10, 6, 8), IL(2026, 10, 7, 12).toISOString());
  assert.deepEqual(ladder(snoozed.w, tue).filter((k) => k.startsWith('lateNag')), []);
  assert.ok(ladder(snoozed.w, IL(2026, 10, 7, 14, 0)).includes('lateNag.d2026-10-07.1400@ilai'));
  // Erev Pesach (Wednesday 21.4.2027, the window ends at 13:00): 09:00 goes, 14:00 does not exist.
  const erev = world();
  const ce = client(erev, { name: 'חג' });
  importTo(erev, ce, 'ongoing');
  erev.tasks.push({ id: 'e1', client_id: ce.id, title: 'משימה', owner: 'irit', due_on: '2027-04-19', urgent: false, created_at: IL(2027, 4, 18, 11).toISOString(), created_by_email: 'lior@x' });
  assert.deepEqual(ladder(erev, IL(2027, 4, 21, 9, 0)).filter((k) => k.startsWith('lateNag')), ['lateNag.d2027-04-21.0900@irit']);
  assert.deepEqual(ladder(erev, IL(2027, 4, 21, 14, 0), [{ key: 'lateNag:-:irit:d2027-04-21.0900@irit' }]).filter((k) => k.includes('.1400')), []);
  assert.deepEqual(ladder(erev, IL(2027, 4, 22, 9, 0)).filter((k) => k.startsWith('lateNag')), []); // the holiday itself
  // The reminder is never one line inside the 08:30 digest: it is not folded into it.
  const fold = computeReminders({ ...base.w, now: IL(2026, 10, 6, 8, 30), until: IL(2026, 10, 6, 9, 30) }).filter((r) => r.rule === 'lateNag');
  assert.deepEqual(fold.map((r) => r.noFold), []);
  const nine = due(base.w, IL(2026, 10, 6, 9, 0)).find((r) => r.rule === 'lateNag');
  assert.equal(nine.noFold, true);
  const digests = planDigests({ env: buildEnv({ ...base.w, now: IL(2026, 10, 6, 8, 30) }), log: [], active: new Set(), lookahead: [{ ...nine, at: IL(2026, 10, 6, 9, 0) }] });
  assert.deepEqual(digests.filter((d) => d.person === 'ilai').flatMap((d) => d.fold || []), []);
  // Outside the sending hours and on Lior's shoot day it waits like every ring.
  const [night] = planDelivery({ reminders: [{ ...nine, at: IL(2026, 10, 6, 20) }], now: IL(2026, 10, 6, 20) });
  assert.deepEqual([night.status, night.reason], ['queued', 'quiet_hours']);
  const [held] = planDelivery({ reminders: [{ ...nine, person: 'lior' }], now: IL(2026, 10, 6, 9, 0), liorShoot: { active: true, cids: new Set(['other']) } });
  assert.deepEqual([held.status, held.reason], ['queued', 'shoot_mode']);
});

test('the client\'s turn: work that was sent and waits for the client is nobody\'s lateness, also when it is only inherited (report 4.7); a fix request makes it work again', () => {
  const w = world();
  const c = client(w, { name: 'דקל', editor: 'nadia', shoot_at: IL(2026, 10, 8, 11).toISOString() });
  importTo(w, c, 'ongoing');
  for (const k of ['p26.sent', 'p27.approved', 'p27.final', 'p27.fixes', 'p27.toilai', 'p27.notes', 'p28.scheduled', 'p29.filled', 'p29.sent']) delete w.checks[c.id][k];
  for (const id of ['p28', 'p29']) for (const k of itemsOf(id)) delete w.checks[c.id][k];
  mark(w, c, 'p22a.assigned', IL(2026, 10, 12, 10)); // day 4 ends on Sunday 18.10
  mark(w, c, 'p26.sent', IL(2026, 10, 19, 9, 30));    // the editing ran late; sent to the client on Monday
  const now = IL(2026, 10, 19, 14, 0);
  const p27 = lateOf(w, now).find((x) => x.num === '27');
  assert.deepEqual([p27.clientTurn, p27.holders, p27.waiters], [true, [], []]);
  // Meanwhile Irit is rung to call the client who did not answer (the rule `answer`, as before).
  assert.equal(due(w, now).filter((r) => r.rule === 'answer' && r.person === 'irit').length, 1);
  assert.deepEqual(due(w, now).filter((r) => (r.rule === 'lateOwn' || r.rule === 'lateNag') && /27 ·/.test(`${r.title}${r.body}`)), []);
  // Ofir and Lior are not told "באיחור: … · נדיה" either: nobody in the office is late there.
  assert.deepEqual(due(w, now).filter((r) => r.rule === 'late' && / 27 · /.test(r.title)), []);
  // In the owners' table it is listed apart, and counted for nobody.
  const sum = summaryOf(buildEnv({ ...w, now }));
  assert.deepEqual(sum.waiting.map((x) => x.what), ['27 · תיקוני הלקוח וסגירת העריכה']);
  assert.equal(sum.items.filter((x) => /^27 /.test(x.what)).length, 0);
  // The client asks for a fix on the status page (Tuesday 10:00): the task is Nadia's, due the same day.
  mark(w, c, 'p27.notes', IL(2026, 10, 20, 10), JSON.stringify({ text: 'סרטון 3: להחליף מוזיקה', via: 'status' }));
  w.tasks.push({ id: 'fix1', client_id: c.id, title: 'תיקון לבקשת הלקוח: הסרטונים · סבב 1', owner: 'nadia', due_on: '2026-10-20', urgent: false, source: 'client_fix', created_at: IL(2026, 10, 20, 10).toISOString(), created_by_email: '', brief: { problem: 'סרטון 3: להחליף מוזיקה', item: 'videos', item_key: 'p27.approved', round: 1, notes_marked: true } });
  const at10 = due(w, IL(2026, 10, 20, 10, 1));
  // The old deadline of 27 is not announced to Ofir and Lior as Nadia's lateness in the minute the client asks.
  assert.deepEqual(at10.filter((r) => r.rule === 'late' && / 27 · /.test(r.title)), []);
  // Nadia rings as before (the protocol's own ladder), and Irit rings at the same moment with the client's words.
  assert.deepEqual(at10.filter((r) => r.rule === 'clientFixes').map((r) => `${r.person}:${r.level}`), ['nadia:ring']);
  const irit = at10.find((r) => r.rule === 'clientFix' && r.person === 'irit');
  assert.deepEqual([irit.level, irit.title], ['ring', 'הלקוח ביקש תיקון: דקל']);
  assert.match(irit.body, /^הלקוח כתב: ״סרטון 3: להחליף מוזיקה״\. לברר שההערות ברורות ולתעד\. נדיה מתקן\/ת עד ג׳ 20\.10\.$/);
  // A fix request is an answer: the "client did not answer, call" ring and clock of that sending stop.
  assert.deepEqual(at10.filter((r) => r.rule === 'answer'), []);
  const clocks = (tasks) => clocksFor('irit', w.clients, w.checks, { now: IL(2026, 10, 20, 10, 1), tasks }).filter((x) => x.kind === 'answer').length;
  assert.equal(clocks(w.tasks), 0);
  assert.equal(fixAnswered(w.tasks, c.id, 'p27.approved', IL(2026, 10, 19, 9, 30)), true);
  assert.equal(fixAnswered(w.tasks, c.id, 'p27.approved', IL(2026, 10, 21, 9, 30)), false); // sent again after the fix: a new wait
  // Her item says what there is to do, with the client's words under it, until the fix is done.
  assert.equal(FIX_ITEM_LABEL, 'הלקוח ביקש תיקונים: לברר ולתעד');
  assert.equal(fixTaskOf(w.tasks, c.id, 'p27.approved').id, 'fix1');
  assert.equal(fixTaskOf(w.tasks, c.id, 'p07.approved'), null);
  assert.equal(fixNote(w.tasks[0], () => 'נדיה'), 'הלקוח כתב: ״סרטון 3: להחליף מוזיקה״. נדיה מתקן/ת. מסמנים כאן רק כשהלקוח מאשר אחרי התיקון.');
  // The fix has its own due day: the old deadline of 27 is not rung on the editor meanwhile…
  const p27b = lateOf(w, IL(2026, 10, 20, 14)).find((x) => x.num === '27');
  assert.deepEqual([p27b.clientTurn, p27b.holders, p27b.fixing], [false, [], true]);
  // …and when the fix is late (Wednesday 09:15), Nadia rings and Irit, who waits for it, is told.
  const wed = due(w, IL(2026, 10, 21, 9, 15), at10.map((r) => ({ key: r.key }))).filter((r) => r.rule === 'lateOwn');
  assert.deepEqual(wed.map((r) => `${r.step}@${r.person}:${r.level}`).sort(), ['own@nadia:ring', 'wait@irit:quiet']);
  // Fixed: the task closes and the item is the approval again.
  w.tasks[0].done_at = IL(2026, 10, 21, 11).toISOString();
  assert.equal(fixTaskOf(w.tasks, c.id, 'p27.approved'), null);
});

test('a process whose own ladder rings at its deadline gets no second "באיחור" then, and joins the reminders from the next day; process 3 with no date keeps its own daily ring', () => {
  // A new deal on Monday 09:00 with nothing done: the deal's ladder rings Irit at 5, 10 and 30 minutes.
  const w = world();
  const c = client(w, { name: 'פיצה', deal_at: IL(2026, 10, 5, 9).toISOString() });
  const mon = due(w, IL(2026, 10, 5, 14, 0)).filter((r) => r.rule === 'lateOwn' || r.rule === 'lateNag');
  assert.deepEqual(mon.filter((r) => r.person === 'irit').map((r) => r.step), []);
  for (const b of ['p01', 'p02', 'p03']) assert.ok(OWN_LATE.has(b));
  // Tuesday 09:00: one reminder with what she holds (1 and 2); process 3 has its own 10:00 ring (section 47).
  const tue = due(w, IL(2026, 10, 6, 9, 0)).find((r) => r.rule === 'lateNag' && r.person === 'irit');
  assert.equal(tue.title, '2 דברים באיחור אצלך');
  assert.match(tue.body, /1 · הכנת חוזה/);
  assert.match(tue.body, /2 · פתיחת קבוצת WhatsApp/);
  assert.doesNotMatch(tue.body, /3 · קביעת פגישת אפיון/);
  assert.equal(due(w, IL(2026, 10, 6, 10, 0)).filter((r) => r.rule === 'meetingDate' && r.person === 'irit').length > 0, true);
  assert.equal(c.id.length > 0, true);
});

// ── 6. The owners' end of the day ───────────────────────────────────────────
test('the 19:00 table: a row per employee with what is late, what was for today and the longest lateness; the totals; the items worst first', () => {
  const { w, c } = afterMeeting();
  w.tasks.push({ id: 't1', client_id: c.id, title: 'לשלוח חשבונית', owner: 'irit', due_on: '2026-10-01', created_at: IL(2026, 9, 30, 10).toISOString() });
  w.tasks.push({ id: 't2', client_id: c.id, title: 'להתקשר ללקוח', owner: 'irit', due_on: '2026-10-06', created_at: IL(2026, 10, 5, 10).toISOString() });
  const now = IL(2026, 10, 6, 19);
  const sum = summaryOf(buildEnv({ ...w, now }));
  assert.deepEqual(sum.rows.map((r) => [r.person, r.late, r.today, r.longest]), [
    ['irit', 2, 1, '3 ימי עסקים'], ['ofir', 2, 0, 'יום עסקים'], ['ilai', 2, 0, 'יום עסקים'], ['lior', 1, 1, 'יום עסקים'],
  ]);
  // An item two people hold (5: Ofir and Irit) counts for each of them and once in the totals.
  assert.deepEqual([sum.totals.late, sum.totals.today, sum.totals.people, sum.totals.longest], [6, 2, 4, '3 ימי עסקים']);
  assert.equal(sum.items[0].what, 'לשלוח חשבונית');
  assert.deepEqual(sum.items.map((x) => x.kind), ['late', 'late', 'late', 'late', 'late', 'late', 'today', 'today']);
  assert.deepEqual(sum.items.filter((x) => x.kind === 'late').map((x) => +x.dueAt), sum.items.filter((x) => x.kind === 'late').map((x) => +x.dueAt).sort((a, b) => a - b));
  // The push says the numbers by itself.
  assert.equal(headline(sum), 'היום: 6 באיחור אצל 4 עובדים, 2 מהיום לא בוצעו');
  assert.deepEqual(pushLines(sum).slice(1), [
    'עירית: 2 באיחור (הארוך: 3 ימי עסקים), אחד מהיום לא בוצע', 'אופיר: 2 באיחור (הארוך: יום עסקים)', 'עילאי: 2 באיחור (הארוך: יום עסקים)', 'ליאור: 1 באיחור (הארוך: יום עסקים), אחד מהיום לא בוצע',
  ]);
  // The page computes the same from what it loaded (no engine, no env): the same numbers.
  const page = daySummary({ clients: w.clients, checksOf: (x) => w.checks[x.id] || {}, stateOf: (x) => clientState(x, w.checks[x.id] || {}, now), tasks: w.tasks, now });
  assert.deepEqual([page.rows, page.totals], [sum.rows, sum.totals]);
  // The WhatsApp text of the same day is ready for when the channel is connected; nothing sends it now.
  const wa = waText(sum, { link: 'https://example.test/owner.html#eod' });
  assert.match(wa, /^סיכום היום\nהיום: 6 באיחור אצל 4 עובדים, 2 מהיום לא בוצעו\n\nעירית: 2 באיחור/);
  assert.match(wa, /• אלפא · לשלוח חשבונית · עירית · באיחור 3 ימי עסקים/);
  // No money anywhere in it.
  assert.doesNotMatch(JSON.stringify(sum) + wa + pushLines(sum).join(' '), /₪|מחיר|agorot|monthly/);
  assert.equal(lateWords(IL(2026, 10, 6, 9), IL(2026, 10, 6, 12)), '3 שעות');
});

test('the 19:00 message: every working day at the end of the sending window, to both owners, also on a day with nothing late; not on the weekend; erev chag at 13:00', async () => {
  assert.deepEqual([EOD.at, EOD.erevAt, EOD.url, DIGESTS.owner], ['19:00', '13:00', 'owner.html#eod', '19:00']);
  assert.deepEqual([ownerDigestAt(IL(2026, 10, 6, 12)), ownerDigestAt(IL(2027, 4, 21, 12))], ['19:00', '13:00']);
  const w = world();
  const c = client(w, { name: 'שקט' });
  importTo(w, c, 'ongoing');
  const db = fakeDb(w);
  const { push, sent } = phones();
  // A quiet Tuesday: nothing at 18:00 or 18:59; at 19:00 one message to each owner, sent at once (not held for the morning).
  await runDay(db, push, sent, 2026, 10, 6, [17, 55], [18, 59]);
  assert.deepEqual(sent.filter((s) => s.to.startsWith('owner')), []);
  await runDay(db, push, sent, 2026, 10, 6, [19, 0], [19, 59]);
  const got = sent.filter((s) => s.to.startsWith('owner'));
  assert.deepEqual(got.map((s) => [s.to, s.at, s.title, s.body, s.url]), [
    ['owner', '6.10 19:00', 'סיכום היום', EMPTY_DAY, 'owner.html#eod'], ['owner2', '6.10 19:00', 'סיכום היום', EMPTY_DAY, 'owner.html#eod'],
  ]);
  const row = db.log.find((r) => r.key === 'digest:eod:owner:2026-10-06');
  assert.deepEqual([row.status, row.channel, row.person], ['sent', 'push', 'owner']);
  // Nobody else gets it.
  assert.deepEqual(sent.filter((s) => s.title === 'סיכום היום').map((s) => s.to).sort(), ['owner', 'owner2']);
  // Friday and Saturday: none.
  const plan = (now) => planDigests({ env: buildEnv({ ...w, now }), now, log: [], active: new Set() }).filter((d) => d.person === 'owner' && d.kind === 'owner').map((d) => d.key);
  assert.deepEqual([plan(IL(2026, 10, 9, 19)), plan(IL(2026, 10, 10, 19))], [[], []]);
  // Erev Pesach: at 13:00, the end of that day's window; not at 19:00.
  assert.deepEqual([plan(IL(2027, 4, 21, 12, 59)), plan(IL(2027, 4, 21, 13)), plan(IL(2027, 4, 21, 19))], [[], ['digest:eod:owner:2027-04-21'], []]);
});

test('the table is the owners\' alone: the two staff rows with no person', () => {
  assert.equal(isOwnerView({ me: null, scope: 'office' }), true);
  for (const me of ['irit', 'lior', 'ofir', 'ilai', 'nadia', 'eli', 'stav']) assert.equal(isOwnerView({ me, scope: 'office' }), false, me);
  assert.equal(isOwnerView({ error: true }), false);
  assert.equal(isOwnerView(null), false);
});
