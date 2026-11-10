// Protocol version 13 (the owner's decisions of 9.11.2026; docs/ops.md, section 119): what the staff
// marked "מיותר" left, for every client; the meeting's and the shoot day's lines close by themselves;
// a package with several shoot days opens the next day's line on the 1st of the next month; the
// scheduling (28) closes by itself once every content row of the Gantt is scheduled, and Irit is then
// told once to send the Gantt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROCESSES, PROTOCOL_VERSION, GANTT_READY, FINAL_CHECK, isRetired } from '../app/protocol.js';
import { applicableProcesses, clientState, openItemsFor } from '../app/protocol-logic.js';
import { PROTOCOL_HISTORY } from '../app/protocol-versions.js';
import { computeReminders } from '../app/reminder-engine.js';
import { ganttReadyKeys, ganttReadyPlans, scheduleFacts } from '../app/gantt-auto.js';
import { nextShootDay, shootDayWords, setShootLine } from '../app/shoot-plan.js';
import { followupRows } from '../app/shoot-prep.js';
import { flowLines } from '../app/mine-flow.js';
import { FINISH, finishOpen } from '../app/production.js';
import { suggestionOf } from '../app/gcal-logic.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const RETIRED = PROTOCOL_HISTORY.find((v) => v.version === 13).retired;
const base = { id: 'c1', name: 'דנה', business: 'קפה דנה', status: 'active', shoot_type: 'dms', characterizer: 'noam', has_logo: true, deal_at: IL(2026, 11, 1, 10).toISOString(), contract_end: '2027-11-01', rounds: [] };
const done = (at, note = null) => ({ state: 'done', at: at.toISOString(), note });
const keysOf = (c) => applicableProcesses(c).flatMap((p) => [p.id, ...p.items.map((i) => i.key)]);

test('version 13: every retired key is in protocol.js as retired: 13, and applies to no client (rounds too)', () => {
  assert.equal(PROTOCOL_VERSION, 14); // 14 since 10.11.2026 (the editors' marks, tests/protocol-v14.test.mjs)
  const all = new Map(PROCESSES.flatMap((p) => [[p.id, p], ...p.items.map((i) => [i.key, i])]));
  for (const k of RETIRED) {
    assert.ok(all.has(k), k);
    assert.equal(all.get(k).retired, 13, k);
  }
  const c = { ...base, char_at: IL(2026, 11, 3, 10).toISOString(), shoot_at: IL(2026, 11, 20, 10).toISOString(), rounds: [{ n: 2, start_at: IL(2026, 11, 2).toISOString() }] };
  const have = new Set(keysOf(c).map((k) => k.replace(/^r\d+[.-]/, '')));
  for (const k of RETIRED) assert.ok(!have.has(k), `${k} still applies`);
  // Kept: the signature, the two topics of 14, Ilai's four final points, Eli's merged check.
  for (const k of ['p01.signed', 'p14.scripts', 'p14.shootday', 'p29b.c.vsched', 'p29b.c.gsched', 'p29b.c.ganttok', 'p29b.c.updated', 'p29b.done', 'p19b.checked', 'p09.file', GANTT_READY, 'p29.sent']) assert.ok(have.has(k), k);
  assert.deepEqual(FINAL_CHECK.filter((x) => !x[2]).map(([k]) => k), ['vsched', 'gsched', 'ganttok', 'updated']);
  assert.deepEqual(PROCESSES.find((p) => p.id === 'p29b').items.find((i) => i.key === 'p29b.done').requires, ['p29b.c.vsched', 'p29b.c.gsched', 'p29b.c.ganttok', 'p29b.c.updated']);
});

test('3: no meeting date, one line for Irit that closes by itself when the date is set; nothing to tick', () => {
  const now = IL(2026, 11, 2, 12);
  const s = clientState(base, {}, now);
  const p3 = s.states.find((x) => x.proc.id === 'p03');
  assert.equal(p3.complete, false);
  const mine = openItemsFor('irit', base, {}, s, now).filter((o) => o.proc.id === 'p03');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].item.key, 'p03.date');
  assert.equal(mine[0].item.auto, true);
  assert.deepEqual(mine[0].fields, ['char_at']);
  const dated = { ...base, char_at: IL(2026, 11, 4, 10).toISOString() };
  const s2 = clientState(dated, {}, now);
  assert.equal(s2.states.find((x) => x.proc.id === 'p03').complete, true);
  assert.equal(openItemsFor('irit', dated, {}, s2, now).filter((o) => o.proc.id === 'p03').length, 0);
});

test('11: the clock starts at the signing; the line closes when the date is set; a client already past it is not asked', () => {
  const signed = { 'p01.signed': done(IL(2026, 11, 2, 11)) };
  const s = clientState(base, signed, IL(2026, 11, 3, 12));
  const p11 = s.states.find((x) => x.proc.id === 'p11');
  assert.equal(+p11.startAt, +IL(2026, 11, 2, 11));
  assert.equal(p11.complete, false);
  assert.deepEqual(openItemsFor('irit', base, signed, s, IL(2026, 11, 3, 12)).filter((o) => o.proc.id === 'p11').map((o) => [o.item.key, o.fields]), [['p11.date', ['shoot_at']]]);
  const dated = { ...base, shoot_at: IL(2026, 11, 20, 10).toISOString() };
  assert.equal(clientState(dated, signed, IL(2026, 11, 3, 12)).states.find((x) => x.proc.id === 'p11').complete, true);
  // Old approvals marked before v13 hold nothing either way.
  const old = { ...signed, 'p11.ok.client': done(IL(2026, 11, 2, 12)) };
  assert.equal(clientState(dated, old, IL(2026, 11, 3, 12)).states.find((x) => x.proc.id === 'p11').complete, true);
  // The group (2) is gone; a deal without signing starts 11 at the deal.
  assert.equal(s.states.find((x) => x.proc.id === 'p02'), undefined);
  assert.equal(+clientState(base, {}, IL(2026, 11, 3, 12)).states.find((x) => x.proc.id === 'p11').startAt, +IL(2026, 11, 1, 10));
});

test('14 is no longer a daily answer: no follow-up row, no line', () => {
  const c = { ...base, char_at: IL(2026, 11, 2, 10).toISOString(), shoot_at: IL(2026, 11, 20, 10).toISOString() };
  const checks = { 'p04.ended': done(IL(2026, 11, 2, 12)) };
  const now = IL(2026, 11, 3, 12);
  assert.deepEqual(followupRows({ clients: [c], checksOf: () => checks, stateOf: (x) => clientState(x, checks, now), now }), []);
  assert.equal(clientState(c, checks, now).states.find((x) => x.proc.id === 'p14').proc.recurring, undefined);
});

test('several shoot days: "1 מתוך 2", then the next day opens on the 1st of the month after the last day, until it is set', () => {
  const c = { ...base, deliverables: { shoot_days: 2 }, shoot_at: IL(2026, 11, 20, 10).toISOString() };
  assert.equal(shootDayWords(c), 'יום צילום 1 מתוך 2');
  assert.equal(setShootLine(c, 'קפה דנה'), 'לקבוע לקפה דנה יום צילום 1 מתוך 2');
  assert.equal(shootDayWords({ ...base, deliverables: { shoot_days: 1 } }), 'יום צילום');
  assert.equal(nextShootDay(c, IL(2026, 11, 30, 12)), null, 'not before the 1st of the next month');
  const open = nextShootDay(c, IL(2026, 12, 1, 9));
  assert.deepEqual({ day: open.day, total: open.total }, { day: 2, total: 2 });
  assert.ok(nextShootDay(c, IL(2027, 1, 15, 9)), 'it stays until set');
  // Irit's line in "המשימות שלי".
  const lines = flowLines({ viewer: { me: 'irit', scope: 'office' }, clients: [c], checks: {}, stateOf: (x) => clientState(x, {}, IL(2026, 12, 1, 9)), now: IL(2026, 12, 1, 9) });
  const line = lines.find((l) => l.id === `shootnext-${c.id}`);
  assert.equal(line.text, 'לקבוע לקפה דנה · דנה יום צילום 2 מתוך 2');
  assert.match(line.href, /#add-round$/);
  // Once day 2 is added (a round) it is the round's own line; dated, nothing more is open.
  const added = { ...c, rounds: [{ n: 2, start_at: IL(2026, 12, 1, 9).toISOString() }] };
  assert.equal(nextShootDay(added, IL(2026, 12, 2)), null);
  assert.equal(shootDayWords(added, 2), 'יום צילום 2 מתוך 2');
  const s = clientState(added, {}, IL(2026, 12, 2, 12));
  assert.deepEqual(openItemsFor('irit', added, {}, s, IL(2026, 12, 2, 12)).filter((o) => o.proc.id === 'r2-p11').map((o) => o.item.key), ['r2.p11.date']);
  const set = { ...added, rounds: [{ n: 2, start_at: IL(2026, 12, 1, 9).toISOString(), shoot_at: IL(2026, 12, 15, 10).toISOString() }] };
  assert.equal(clientState(set, {}, IL(2026, 12, 2, 12)).states.find((x) => x.proc.id === 'r2-p11').complete, true);
  assert.equal(nextShootDay(set, IL(2027, 1, 2)), null, 'every day of the package is set');
  // A monthly editing round is not a shoot day.
  const monthly = { ...c, rounds: [{ n: 2, month: '2026-12', monthly: true, start_at: IL(2026, 12, 1).toISOString() }] };
  assert.equal(nextShootDay(monthly, IL(2026, 12, 2)).day, 2);
  // The calendar's "לקבוע" is offered for that next day once the client's own day is behind it.
  const row = { client_id: c.id, kind_guess: 'shoot', starts_at: IL(2027, 1, 10, 10).toISOString() };
  assert.equal(suggestionOf(row, c, { now: IL(2026, 11, 25) }), null, 'day 1 is ahead and day 2 not open: the one shoot day is moved only before it');
  assert.equal(suggestionOf(row, c, { now: IL(2026, 12, 2) })?.kind, 'shoot');
});

// The Gantt's rows of one client.
const rows = (states) => states.map((state, i) => ({ id: `g${i}`, client_id: 'c1', kind: i % 2 ? 'graphic' : 'video', state }));
const approved = () => {
  const c = { ...base, char_at: IL(2026, 10, 1, 10).toISOString(), shoot_at: IL(2026, 10, 10, 10).toISOString(), editor: 'nadia' };
  const at = IL(2026, 11, 2, 10);
  const checks = Object.fromEntries(PROCESSES.find((p) => p.id === 'p27').items.filter((i) => !isRetired(i)).map((i) => [i.key, done(at)]));
  return { c, checks };
};

test('the scheduling closes by itself: all scheduled → once; partial → nothing; an empty Gantt → nothing', () => {
  const { c, checks } = approved();
  const now = IL(2026, 11, 2, 12);
  const st = clientState(c, checks, now);
  assert.deepEqual(ganttReadyKeys(c, checks, rows(['scheduled', 'posted', 'scheduled']), st), [GANTT_READY]);
  assert.deepEqual(ganttReadyKeys(c, checks, rows(['scheduled', 'planned', 'posted']), st), [], 'partial');
  assert.deepEqual(ganttReadyKeys(c, checks, [], st), [], 'empty');
  assert.deepEqual(ganttReadyKeys(c, checks, [{ kind: 'shoot', state: 'planned' }, { kind: 'end', state: 'planned' }], st), [], 'only frame rows');
  assert.deepEqual(scheduleFacts(rows(['scheduled', 'skipped'])), { posts: 1, scheduled: 1, all: true }, 'a skipped row is not content');
  // Not before the client approved the videos (27).
  assert.deepEqual(ganttReadyKeys(c, {}, rows(['scheduled']), clientState(c, {}, now)), []);
  // Once written, never again.
  const after = { ...checks, [GANTT_READY]: done(now) };
  assert.deepEqual(ganttReadyKeys(c, after, rows(['scheduled']), clientState(c, after, now)), []);
  const plans = ganttReadyPlans([c], Object.entries(checks).map(([k, v]) => ({ client_id: c.id, item_key: k, ...v })), rows(['scheduled', 'posted']), (x, cs) => clientState(x, cs, now));
  assert.deepEqual(plans.map((p) => p.marks.map((m) => m.item_key)), [[GANTT_READY]]);
  // 28 is complete with it; Irit's sending opens (it waited for it).
  const s2 = clientState(c, after, now);
  assert.equal(s2.states.find((x) => x.proc.id === 'p28').complete, true);
  assert.deepEqual(openItemsFor('irit', c, after, s2, now).filter((o) => o.proc.id === 'p29').map((o) => o.item.key), ['p29.sent']);
  assert.deepEqual(openItemsFor('irit', c, checks, clientState(c, checks, now), now).filter((o) => o.proc.id === 'p29').map((o) => o.item.key), []);
  // A client whose Gantt Ilai marked full before v13 is not asked again, and Irit can send it.
  const old = { ...checks, 'p28.scheduled': done(now), 'p29.filled': done(now) };
  const s3 = clientState(c, old, now);
  assert.equal(s3.states.find((x) => x.proc.id === 'p28').complete, true);
  assert.deepEqual(openItemsFor('irit', c, old, s3, now).filter((o) => o.proc.id === 'p29').map((o) => o.item.key), ['p29.sent']);
});

test('Irit is told once to send the Gantt when the system closed the scheduling; partial and empty tell nobody', () => {
  const { c, checks } = approved();
  const staff = [{ email: 'irit@x', person: 'irit' }, { email: 'ilai@x', person: 'ilai' }, { email: 'owner@x', person: null }];
  const w = (cs) => ({ clients: [c], checks: { [c.id]: cs }, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff });
  const irit = (list) => list.filter((r) => r.rule === 'publish' && r.step === 'gantt' && r.person === 'irit');
  const now = IL(2026, 11, 2, 12);
  assert.equal(irit(computeReminders({ ...w(checks), now, log: [] })).length, 0, 'not yet scheduled');
  const after = { ...checks, [GANTT_READY]: { ...done(now), note: 'נסגר אוטומטית' } };
  const got = irit(computeReminders({ ...w(after), now, log: [] }));
  assert.equal(got.length, 1);
  assert.match(got[0].title, /לשלוח גאנט/);
  assert.equal(irit(computeReminders({ ...w(after), now: IL(2026, 11, 2, 12, 5), log: new Set(got.map((r) => r.key)) })).length, 0, 'once');
});

test('Eli: one drive check (either old mark answers it), no "הגעתי"; the finish is two items', () => {
  assert.deepEqual(FINISH.map(([k]) => k), ['p19b.folders', 'p19b.checked']);
  assert.deepEqual(finishOpen({ 'p19b.folders': { state: 'done' }, 'p19b.opens': { state: 'done' } }), []);
  assert.deepEqual(finishOpen({ 'p19b.folders': { state: 'done' } }), ['p19b.checked']);
  const c = { ...base, shoot_at: IL(2026, 11, 20, 10).toISOString() };
  const items = applicableProcesses(c).find((p) => p.id === 'p17b').items.map((i) => i.key);
  assert.deepEqual(items, ['p17b.drive', 'p17b.gear', 'p17b.broll']);
  const s = clientState(c, { 'p19b.complete': done(IL(2026, 11, 20, 18)) }, IL(2026, 11, 20, 19));
  assert.equal(s.states.find((x) => x.proc.id === 'p19b').proc.items.find((i) => i.key === 'p19b.checked').optional, true, 'history');
});
