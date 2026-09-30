// The package year (stage 5): the months of a package, the monthly cycle (a draft,
// decision 31) with its owners and due dates, who sees what in "מה עליי", its
// gentle reminders, and the 90-day renewals list with its results summary and the
// prefilled renewal quote. npm test runs this under UTC, New York and Jerusalem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthStart, monthOf, termOf, cycleFrom, monthItems, spreadMonth, openMonthItems, itemState, monthState, yearOf,
  renewalsDue, groupMarks, marksByKey, MARK_ITEM, DRAFT_LABEL,
} from '../app/year-logic.js';
import { clientState, IMPORT_NOTE } from '../app/protocol-logic.js';
import { computeReminders, planDelivery } from '../app/reminder-engine.js';
import { RULES } from '../app/reminder-rules.js';
import { importKeys } from '../app/client-open.js';
import { renewalDraft, selectionFor, resultsSummary, surveySummary, renewalStage, packageText } from '../app/renewals.js';
import { buildQuoteModel, emptySelection } from '../app/pricing.js';
import { dateIL, partsIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const day = (d) => { const p = partsIL(d); return `${p.day}.${p.month}.${p.year}`; };
const at = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const TV = { videos: 42, graphics: 42, shoot_days: 2, collabs: 3, stories: 3, ch14: 1, monthly: 96 };
let seq = 0;
function client(o = {}) {
  seq += 1;
  return {
    id: `c${seq}`, name: o.name || `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [],
    deal_at: IL(2026, 3, 15, 10).toISOString(), char_at: IL(2026, 3, 16, 10).toISOString(), shoot_at: IL(2026, 3, 25, 10).toISOString(),
    contract_end: '2027-03-15', deliverables: TV, ...o,
  };
}
// Everything up to the ongoing station, imported on `on` (process 28 among them).
const ongoing = (on = IL(2026, 4, 10, 9)) => Object.fromEntries(importKeys('ongoing').map((k) => [k, { state: 'done', at: on.toISOString(), note: IMPORT_NOTE }]));
const mark = (c, month, item, state = 'done', when = IL(2026, 10, 1)) => ({ client_id: c.id, month, item, state, at: when.toISOString(), by_email: 'x@x' });

test('the months of a package: from the deal day, in Israel days; the 31st is the month\'s last day', () => {
  const c = client({ deal_at: IL(2026, 1, 31, 15).toISOString(), contract_end: '2027-01-31' });
  assert.deepEqual([1, 2, 3, 13].map((n) => day(monthStart(c, n))), ['31.1.2026', '28.2.2026', '31.3.2026', '31.1.2027']);
  const d = client();
  assert.equal(termOf(d), 12);
  assert.equal(termOf({ ...d, contract_end: null }), 12);
  assert.equal(termOf({ ...d, contract_end: '2026-09-15' }), 6);
  assert.equal(monthOf(d, IL(2026, 10, 14, 23, 59)).n, 7);
  assert.equal(monthOf(d, IL(2026, 10, 15, 0, 0)).n, 8);
  assert.deepEqual([monthOf(d, IL(2026, 11, 10, 12)).n, monthOf(d, IL(2026, 11, 10, 12)).of], [8, 12]);
  assert.equal(monthOf(d, IL(2027, 4, 1)).over, true);
  assert.equal(monthOf({ ...d, deal_at: null }, IL(2026, 11, 10)), null);
});

test('the cycle starts in the month after the first publishing (28), never before month 2', () => {
  const c = client();
  assert.equal(cycleFrom(c, clientState(c, {}, IL(2026, 11, 10))), null);
  assert.equal(cycleFrom(c, clientState(c, ongoing(IL(2026, 4, 10, 9)), IL(2026, 11, 10))), 2);
  assert.equal(cycleFrom(c, clientState(c, ongoing(IL(2026, 7, 20, 9)), IL(2026, 11, 10))), 6);
  assert.equal(cycleFrom(c, clientState(c, ongoing(IL(2026, 3, 20, 9)), IL(2026, 11, 10))), 2);
});

test('each month\'s items, owners and due dates; the once-a-term items spread over the year', () => {
  const c = client();
  assert.deepEqual(monthItems(c, 1), []);
  assert.deepEqual(monthItems(c, 13), []);
  const m8 = monthItems(c, 8);
  assert.deepEqual(m8.map((i) => `${i.key}:${i.owner}:${day(i.dueAt)}`), [
    'plan:ilai:14.10.2026', 'posted:ilai:19.10.2026', 'report:ofir:20.10.2026', 'photo:irit:20.10.2026', 'photoshot:lior:2.11.2026',
  ]);
  assert.match(m8.find((i) => i.key === 'posted').label, /חודש 7 עלה/);
  assert.match(m8.find((i) => i.key === 'photoshot').label, /8 תכנים/);
  // Spread over months 2..12: one channel-14 item and one second shoot day mid-year, three collabs and three stories.
  assert.deepEqual([spreadMonth(1, 1, 2, 12), spreadMonth(1, 3, 2, 12), spreadMonth(2, 3, 2, 12), spreadMonth(3, 3, 2, 12)], [7, 3, 7, 11]);
  const where = (key) => [...Array(13).keys()].filter((n) => monthItems(c, n).some((i) => i.key === key));
  assert.deepEqual(where('ch14.1'), [7]);
  assert.deepEqual([where('collab.1'), where('collab.2'), where('collab.3')], [[3], [7], [11]]);
  assert.deepEqual(where('round.1'), [7]);
  assert.match(monthItems(c, 7).find((i) => i.key === 'round.1').label, /יום צילום 2/);
  // Without a monthly photographer, no photographer items; the social package has one collab and no ch14.
  const s = client({ deliverables: { videos: 25, graphics: 35, shoot_days: 1, collabs: 1, stories: 0, ch14: 0, monthly: 0 } });
  const all = [...Array(13).keys()].flatMap((n) => monthItems(s, n).map((i) => i.key));
  assert.equal(all.filter((k) => k.startsWith('photo')).length, 0);
  assert.deepEqual(all.filter((k) => k.includes('.')), ['collab.1']);
  // The keys are the ones the database takes.
  for (const k of [...new Set([...Array(13).keys()].flatMap((n) => monthItems(c, n).map((i) => i.key)))]) assert.ok(MARK_ITEM.test(k), k);
});

test('item states: done, not relevant, a second shoot day opened in the card, late, today, soon, later', () => {
  const c = client({ rounds: [{ n: 2, start_at: IL(2026, 9, 20).toISOString() }] });
  const m7 = monthItems(c, 7);
  assert.equal(itemState(m7.find((i) => i.key === 'round.1'), {}, IL(2026, 11, 1)).status, 'auto');
  const m8 = monthItems(c, 8);
  const marks = marksByKey([mark(c, 8, 'plan'), mark(c, 8, 'report', 'na')]);
  const st = (key, now) => itemState(m8.find((i) => i.key === key), marks, now).status;
  assert.equal(st('plan', IL(2026, 10, 20)), 'done');
  assert.equal(st('report', IL(2026, 10, 25)), 'na');
  assert.equal(st('posted', IL(2026, 10, 20)), 'overdue');
  assert.equal(st('posted', IL(2026, 10, 19, 9)), 'today');
  assert.equal(st('photoshot', IL(2026, 10, 27)), 'open');
  assert.equal(st('photoshot', IL(2026, 10, 16)), 'later');
  const ms = monthState(c, 8, marks, IL(2026, 10, 25));
  assert.deepEqual([ms.total, ms.done, ms.late], [5, 2, 2]);
});

test('"מה עליי": this month\'s open items of each owner, and Ilai\'s next month within 7 days; only active clients', () => {
  const c = client();
  const checks = ongoing();
  const s = clientState(c, checks, IL(2026, 11, 10, 12));
  const now = IL(2026, 11, 10, 12);
  const keys = (person, marks = {}, cl = c) => openMonthItems(person, cl, s, checks, marks, now).map((i) => `${i.month}.${i.key}:${i.status}`);
  assert.deepEqual(keys('ilai'), ['8.plan:overdue', '8.posted:overdue', '9.plan:open']);
  assert.deepEqual(keys('ilai', marksByKey([mark(c, 8, 'plan'), mark(c, 8, 'posted')])), ['9.plan:open']);
  assert.deepEqual(keys('ofir'), ['8.report:overdue']);
  assert.deepEqual(keys('lior'), ['8.photoshot:overdue']);
  assert.deepEqual(keys('nadia'), []);
  assert.equal(openMonthItems(null, c, s, checks, {}, now).length, 6);
  for (const status of ['ending', 'ended', 'cancelled']) assert.deepEqual(keys('ilai', {}, { ...c, status }), [], status);
  // Before the first publishing: nothing.
  assert.deepEqual(openMonthItems('ilai', c, clientState(c, {}, now), {}, {}, now), []);
  // The year at a glance: month 1 onboarding, 2..7 done or late, 8 now, 9..12 ahead.
  const y = yearOf(c, s, checks, {}, now);
  assert.equal(y.n, 8);
  assert.equal(y.months[0].before, true);
  assert.equal(y.months[7].current, true);
  assert.equal(y.months[8].future, true);
  assert.equal(y.current.total, 5);
  assert.equal(DRAFT_LABEL, 'טיוטה — עד שיהיה פרוטוקול כתוב');
});

// ── Reminders ────────────────────────────
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' },
];
const world = (clients, checks, monthMarks = []) => ({ clients, checks, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, monthMarks });
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const pick = (list, rule, step = null, person = null) => list.filter((r) => r.rule === rule && (!step || r.step === step) && (!person || r.person === person));

test('the cycle\'s rules are in the engine, each with an event and valid steps', () => {
  for (const id of ['monthStart', 'monthDay', 'monthLate', 'renewalList']) assert.equal(RULES.filter((r) => r.id === id).length, 1, id);
});

test('a new month: one digest line to each owner, at 08:30 of its first day', () => {
  const c = client();
  const w = world([c], { [c.id]: ongoing() });
  const list = pick(due(w, IL(2026, 10, 15, 8, 30)), 'monthStart');
  assert.deepEqual(list.map((r) => r.person).sort(), ['ilai', 'irit', 'lior', 'ofir']);
  assert.ok(list.every((r) => r.level === 'digest' && r.clientId === c.id && r.ref === null));
  assert.match(list.find((r) => r.person === 'ilai').title, /^חודש 8 התחיל: .* · 2 פריטים במחזור החודשי \(טיוטה\)$/);
  assert.equal(pick(due(w, IL(2026, 10, 15, 8, 29)), 'monthStart').length, 0);
});

test('items due today: one ring a day for each person at 10:00, for all of them; none when done', () => {
  const a = client({ name: 'אלפא' });
  const b = client({ name: 'בטא' });
  // Month 9 starts on Sunday 15.11: Ilai's plan for it is due Thursday 12.11.
  const done8 = (c) => ['plan', 'posted'].map((k) => mark(c, 8, k));
  const w = world([a, b], { [a.id]: ongoing(), [b.id]: ongoing() }, [...done8(a), ...done8(b)]);
  assert.equal(pick(due(w, IL(2026, 11, 12, 9, 59)), 'monthDay').length, 0);
  const rings = pick(due(w, IL(2026, 11, 12, 10)), 'monthDay', 'ring', 'ilai');
  assert.equal(rings.length, 1);
  assert.equal(rings[0].level, 'ring');
  assert.equal(rings[0].title, 'היום במחזור החודשי: 2 פריטים');
  assert.match(rings[0].body, /אלפא, בטא\. טיוטה/);
  assert.equal(planDelivery({ reminders: rings, now: IL(2026, 11, 12, 10) })[0].channel, 'push');
  // Planned before 10:00: no ring.
  const w2 = world([a], { [a.id]: ongoing() }, [...done8(a), mark(a, 9, 'plan', 'done', IL(2026, 11, 12, 9))]);
  assert.equal(pick(due(w2, IL(2026, 11, 12, 10)), 'monthDay').length, 0);
});

test('an item past its due date: a digest line the next business morning to its owner, marked late; no escalation', () => {
  const c = client();
  const w = world([c], { [c.id]: ongoing() });
  // Ofir's report of month 8 was due Tuesday 20.10.
  assert.equal(pick(due(w, IL(2026, 10, 21, 8, 29)), 'monthLate', null, 'ofir').length, 0);
  const late = pick(due(w, IL(2026, 10, 21, 8, 30)), 'monthLate', 'digest', 'ofir');
  assert.equal(late.length, 1);
  assert.equal(late[0].overdue, true);
  assert.match(late[0].title, /^באיחור במחזור החודשי: .* · דוח חודשי על חודש 7 נשלח ללקוח$/);
  assert.deepEqual([...new Set(pick(due(w, IL(2026, 11, 10, 12)), 'monthLate').map((r) => r.person))].sort(), ['ilai', 'irit', 'lior', 'ofir']);
  assert.equal(pick(due(w, IL(2026, 11, 10, 12)), 'monthLate').every((r) => r.level === 'digest'), true);
  const w2 = world([c], { [c.id]: ongoing() }, [mark(c, 8, 'report')]);
  assert.equal(pick(due(w2, IL(2026, 10, 21, 8, 30)), 'monthLate', null, 'ofir').length, 0);
});

test('renewals: Lior and the owner 90 days before, the owner at 60, a ring to Lior if 34 has not started on its day, 30 days before', () => {
  const c = client({ contract_end: '2027-03-15' });
  const w = world([c], { [c.id]: ongoing() });
  const steps = (now) => pick(due(w, now), 'renewalList').map((r) => `${r.step}@${r.person}`).sort();
  assert.deepEqual(steps(IL(2026, 12, 15, 8, 29)), []);
  assert.deepEqual(steps(IL(2026, 12, 15, 8, 30)), ['d90@lior', 'd90@owner']);
  // 60 days before: Thursday 14.1.2027 (process 34's day). The owner's line in the morning, Lior's ring at 12:00.
  assert.deepEqual(steps(IL(2027, 1, 14, 8, 30)), ['d60@owner', 'd90@lior', 'd90@owner']);
  const ring = pick(due(w, IL(2027, 1, 14, 12)), 'renewalList', 'start', 'lior');
  assert.equal(ring.length, 1);
  assert.equal(ring[0].level, 'ring');
  assert.equal(ring[0].ref, 'p34');
  assert.equal(ring[0].url, 'year.html#renewals');
  // Started (one item of 34 marked): no ring.
  const started = world([c], { [c.id]: { ...ongoing(), 'p34.state': { state: 'done', at: IL(2027, 1, 12).toISOString() } } });
  assert.equal(pick(due(started, IL(2027, 1, 14, 12)), 'renewalList', 'start').length, 0);
  // 30 days before (Saturday 13.2): Lior's line; the owner's only after a renewal call (else rule `renewal` rings the owner).
  assert.ok(steps(IL(2027, 2, 13, 8, 30)).includes('d30@lior'));
  assert.ok(!steps(IL(2027, 2, 13, 8, 30)).includes('d30@owner'));
  assert.equal(pick(due(w, IL(2027, 2, 13, 10)), 'renewal', 'owner30', 'owner').length, 1);
  const talked = world([c], { [c.id]: { ...ongoing(), 'p34.talk': { state: 'done', at: IL(2027, 1, 20).toISOString() } } });
  assert.ok(pick(due(talked, IL(2027, 2, 13, 8, 30)), 'renewalList', 'd30', 'owner').length === 1);
  // Lior's 60-day line is rule `renewal`'s, not a second one.
  assert.equal(pick(due(w, IL(2027, 1, 14, 8, 30)), 'renewalList', 'd60', 'lior').length, 0);
  assert.equal(pick(due(w, IL(2027, 1, 14, 8, 30)), 'renewal', 'd60', 'lior').length, 1);
  // Process 34 done, or the client ending: the list stops.
  const doneAll = Object.fromEntries(['p34.state', 'p34.satisfaction', 'p34.problems', 'p34.talk', 'p34.issues'].map((k) => [k, { state: 'done', at: IL(2027, 1, 10).toISOString() }]));
  assert.deepEqual(pick(due(world([c], { [c.id]: { ...ongoing(), ...doneAll } }), IL(2027, 2, 13, 8, 30)), 'renewalList'), []);
  assert.deepEqual(pick(due(world([{ ...c, status: 'ending' }], { [c.id]: ongoing() }), IL(2027, 2, 13, 8, 30)), 'renewalList'), []);
});

// ── The renewals list ────────────────────
test('renewals within 90 days, soonest first; not ended, not past, not without an end date', () => {
  const now = IL(2026, 12, 1, 10);
  const list = [
    client({ name: 'בעוד 80', contract_end: '2027-02-19' }),
    client({ name: 'בעוד 10', contract_end: '2026-12-11' }),
    client({ name: 'היום', contract_end: '2026-12-01' }),
    client({ name: 'בעוד 95', contract_end: '2027-03-06' }),
    client({ name: 'עבר', contract_end: '2026-11-30' }),
    client({ name: 'מסיים', contract_end: '2026-12-20', status: 'ending' }),
    client({ name: 'בלי תאריך', contract_end: null }),
  ];
  assert.deepEqual(renewalsDue(list, now).map((x) => `${x.client.name}:${x.daysLeft}`), ['היום:0', 'בעוד 10:10', 'בעוד 80:80']);
});

test('the results summary: delivered against the package, shoot days, on time, the cycle, satisfaction', () => {
  const c = client({ deliverables: { ...TV, done: { videos: 20, graphics: 30, collabs: 1 } } });
  const checks = ongoing();
  const now = IL(2027, 1, 20, 10);
  const s = clientState(c, checks, now);
  const lines = resultsSummary(c, s, checks, { marks: marksByKey([mark(c, 11, 'plan'), mark(c, 11, 'posted')]), surveys: null, now });
  const by = Object.fromEntries(lines.map((l) => [l.key, l.text]));
  assert.match(by.videos, /^\d+ מתוך 42$/);
  assert.match(by.graphics, /^\d+ מתוך 42$/);
  assert.equal(by.collabs, '1 מתוך 3');
  assert.equal(by.shoots, '1 מתוך 2');
  assert.equal(by.ontime, 'אין עדיין תהליכים שנסגרו במערכת'); // imported history is not counted
  assert.match(by.cycle, /^2 מתוך \d+ פריטים$/);
  assert.equal(by.satisfaction, 'אין עדיין ציונים במערכת');
  assert.equal(renewalStage(s, checks).key, 'new');
  assert.equal(renewalStage(s, { ...checks, 'p34.state': { state: 'done' } }).text, 'תהליך 34: 1 מתוך 5');
});

test('satisfaction, read from public.client_surveys as stage 4 keeps it', () => {
  // The table's shape (migration 20260930170000): kind shoot | delivery (1–5) | nps (0–10), at.
  const row = (kind, score, at = '2026-10-05T07:00:00Z') => ({ client_id: 'x', kind, score, source: 'page', at });
  assert.equal(surveySummary(null), null);
  assert.equal(surveySummary([]), null);
  // Not an answer: no kind, a kind the table does not have, a score off its scale, no time.
  assert.equal(surveySummary([{ client_id: 'x', score: 5, at: '2026-10-05T07:00:00Z' }, row('recommend', 9), row('shoot', 7), row('nps', 11), row('delivery', 0), { ...row('shoot', 4), at: null }]), null);
  const s = surveySummary([row('shoot', 5), row('delivery', 4), row('nps', 9)]);
  assert.equal(s.text, '4.5 מתוך 5 (2 תשובות) · המלצה 9 מתוך 10');
  assert.equal(s.low, false);
  assert.equal(s.count, 3);
  // 2 or less of 5, or 4 or less of 10: the owner heard of it, the list warns.
  assert.equal(surveySummary([row('shoot', 5), row('delivery', 2)]).low, true);
  assert.equal(surveySummary([row('nps', 4)]).low, true);
  assert.equal(surveySummary([row('nps', 5)]).low, false);
  // A score of 6–10 on the recommendation is never read as a 1–5 answer, and 1–5 on it stays a recommendation.
  assert.equal(surveySummary([row('nps', 3), row('shoot', 5)]).text, '5 מתוך 5 (תשובה אחת) · המלצה 3 מתוך 10');
  assert.equal(surveySummary([row('shoot', 5)]).text, '5 מתוך 5 (תשובה אחת)');
});

test('the renewal quote: the signed agreement\'s package and client, else the package name; never unknown', () => {
  const sel = { ...emptySelection(), docType: 'agreement', tier: 'social-tv', influencer: 'natali', paid: ['photographer', 'natali-story'], free: { ...emptySelection().free, graphics: 6 }, discount: 10000 };
  const model = buildQuoteModel(sel, { name: 'דנה כהן', company: 'סטודיו דנה', phone: '050', email: 'a@b.c', companyId: '123' });
  const c = client({ name: 'סטודיו דנה', shoot_type: 'natali' });
  const d = renewalDraft(c, model);
  assert.equal(d.state.docType, 'quote');
  assert.deepEqual([d.state.tier, d.state.influencer, d.state.paid, d.state.free.graphics, d.state.discount], ['social-tv', 'natali', ['photographer', 'natali-story'], 6, 10000]);
  assert.equal(d.client['c-name'], 'דנה כהן');
  assert.equal(d.client['c-company'], 'סטודיו דנה');
  assert.equal(d.client['c-notes'], '');
  // Opened by hand: from the package name and the shoot type.
  const byName = selectionFor(client({ package_name: 'Social + TV all in one · נטלי דדון', shoot_type: 'natali' }));
  assert.deepEqual([byName.tier, byName.influencer, byName.docType], ['social-tv', 'natali', 'quote']);
  assert.deepEqual([selectionFor(client({ package_name: 'Social all in one', shoot_type: 'dms' })).tier], ['social']);
  assert.equal(renewalDraft(client({ package_name: 'משהו אחר', shoot_type: null }), null), null);
  assert.equal(renewalDraft(client({ package_name: '', shoot_type: 'dms' }), null).client['c-name'], `לקוח ${seq}`);
  assert.equal(packageText(c, model), 'Social + TV all in one · נטלי דדון');
  // A broken selection falls back to the package alone.
  const bad = renewalDraft(c, { selection: { tier: 'social', influencer: 'simeon', paid: ['natali-reel'], free: { graphics: 99 } } });
  assert.deepEqual([bad.state.tier, bad.state.influencer, bad.state.paid, bad.state.free.graphics], ['social', 'simeon', [], 0]);
});

test('marks grouped by client, month and item', () => {
  const g = groupMarks([{ client_id: 'a', month: 3, item: 'plan', state: 'done' }, { client_id: 'b', month: 4, item: 'ch14.1', state: 'na' }]);
  assert.equal(g.a['3:plan'].state, 'done');
  assert.equal(g.b['4:ch14.1'].state, 'na');
  assert.deepEqual(groupMarks(null), {});
  assert.equal(at(IL(2026, 1, 1, 9)), '1.1 09:00');
});
