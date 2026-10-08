// The client's colour and the owner's screens (app/health.js): every red and
// yellow rule, green, waiting on the client never counted against the staff, the
// station and next milestone, the timeline, screen 1's rows and numbers, and
// screen 4's rows. `npm test` runs this under UTC, America/New_York and Jerusalem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applicableProcesses, clientState, WAIT, waitNote, IMPORT_NOTE } from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';
import { onTimeOf } from '../app/production.js';
import {
  clientHealth, station, timeline, ownerRows, officeReasons, colorCounts, lateNow, shootsAhead, closedProcesses,
  onTimeTrend, teamRows, upcomingEvents, weeklyCallDue, deliverablesPace, contractMonth, lastContact,
  canSeeOwnerScreen, canSeeAllClients, seesWholeTeam, responsibleOf, doneEvents, thursdayDue, EDITOR_CAP, isAutoCheck,
  lateWords, reworkCounts, historyKeys, withHistory, STATION_NORM,
} from '../app/health.js';

const at = (s) => new Date(s);
// Sunday 11.10.2026: the deal. Monday 12.10 10:00: the characterization. Israel is on summer time until 25.10.
// The client started under protocol version 5: setting the shoot day (11) is due 3
// business days after the meeting, as these rules were written against. Version 6
// (11 right after the group) has its own test below.
const base = {
  id: 'c1', name: 'דנה', business: 'סטודיו דנה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  deal_at: '2026-10-11T09:00:00+03:00', char_at: '2026-10-12T10:00:00+03:00', created_at: '2026-10-11T09:00:00+03:00',
  contract_end: '2027-10-11', deliverables: {}, rounds: [], protocol_version: 5,
};
const keysFor = (c, ids) => applicableProcesses(c).filter((p) => ids.includes(p.id))
  .flatMap((p) => p.items.filter((i) => !i.optional).map((i) => i.key));
const done = (c, ids, when, note = null, by = 'irit@x.test') => Object.fromEntries(keysFor(c, ids).map((k) => [k, { state: 'done', at: when, note, by_email: by }]));
const item = (key, when, note = null, by = 'irit@x.test') => ({ [key]: { state: 'done', at: when, note, by_email: by } });
const JOIN = ['p01', 'p02', 'p03'];
const CHAR = ['p04', 'p05', 'p05b', 'p06', 'p07', 'p07a', 'p07b', 'p08', 'p08b', 'p09', 'p10'];
const health = (c, checks, now, extras = {}) => clientHealth(c, clientState(c, checks, at(now)), { checks, now: at(now), ...extras });
const codes = (h) => h.reasons.map((r) => r.code);
const find = (h, code, procId) => h.reasons.find((r) => (!code || r.code === code) && (!procId || r.procId === procId));
// Everything done up to and including the characterization day, at its end.
const onboarded = (c = base) => ({ ...done(c, JOIN, '2026-10-11T09:03:00+03:00'), ...done(c, CHAR, '2026-10-12T12:00:00+03:00') });

test('green: everything on time, the client heard from us, nothing waits', () => {
  const checks = done(base, JOIN, '2026-10-11T09:03:00+03:00');
  const c = { ...base, char_at: '2026-10-13T10:00:00+03:00' };
  const h = health(c, checks, '2026-10-11T12:00:00+03:00', { messages: [], tasks: [], statusNotes: [], access: [], dateChanges: [] });
  assert.equal(h.color, 'green');
  assert.deepEqual(h.reasons, []);
  // An ended or cancelled client has no colour.
  assert.equal(health({ ...c, status: 'ended' }, checks, '2026-10-11T12:00:00+03:00').color, null);
  assert.equal(health({ ...c, status: 'cancelled' }, checks, '2026-10-11T12:00:00+03:00').color, null);
});

test('red: a critical item more than 2 business days late; yellow up to 2; one name', () => {
  // Process 11 (setting the shoot day) is due 3 business days after the meeting: Thursday 15.10 at the office's close (18:00).
  const checks = onboarded();
  const late = (now) => find(health(base, checks, now), null, 'p11');
  assert.equal(late('2026-10-15T17:00:00+03:00').code, 'due-soon'); // its own day: not late, not started yet
  const sun = late('2026-10-18T10:00:00+03:00'); // 1 business day (Friday and Saturday do not count)
  assert.deepEqual([sun.color, sun.code, sun.who, sun.text], ['yellow', 'late-soon', 'irit', 'באיחור יום עסקים']);
  assert.equal(late('2026-10-19T10:00:00+03:00').color, 'yellow'); // 2
  const tue = late('2026-10-20T10:00:00+03:00'); // 3
  assert.deepEqual([tue.color, tue.code, tue.text, tue.what], ['red', 'late', 'באיחור 3 ימי עסקים', '11 · קביעת יום צילום']);
  assert.equal(health(base, checks, '2026-10-20T10:00:00+03:00').color, 'red');
  // A shared process belongs to whoever took it; the rest to the owner of its first open item.
  const h = health(base, { ...checks, ...done(base, ['p11'], '2026-10-13T10:00:00+03:00') }, '2026-10-20T10:00:00+03:00');
  assert.equal(find(h, null, 'p12a').who, 'lior');
  // The daily follow-up until the shoot (14) is asked once a day and is never late (protocol v8).
  assert.equal(find(health({ ...base, shoot_at: '2026-10-14T10:00:00+03:00' }, checks, '2026-10-20T10:00:00+03:00'), null, 'p14'), undefined);
  assert.equal(find(health({ ...base, shoot_at: '2026-10-27T10:00:00+02:00' }, checks, '2026-10-20T10:00:00+03:00'), null, 'p14'), undefined);
});

test('waiting on the client is never late: yellow only after 2 business days, and Irit follows it', () => {
  const checks = { ...onboarded(), [WAIT({ id: 'p11' })]: { state: 'done', at: '2026-10-13T10:00:00+03:00', note: waitNote('הלקוח לא אישר תאריך', null), by_email: 'irit@x.test' } };
  // Four business days after its deadline, the process still is not late: it is the client's.
  const h = health(base, checks, '2026-10-20T10:00:00+03:00');
  assert.equal(find(h, 'late', 'p11'), undefined);
  assert.equal(find(h, 'late-soon', 'p11'), undefined);
  const w = find(h, 'waiting', 'p11');
  assert.deepEqual([w.color, w.who, w.waiting, w.text], ['yellow', 'irit', true, 'ממתין ללקוח 5 ימי עסקים']);
  assert.match(w.what, /הלקוח לא אישר תאריך/);
  // Waiting a day or two is nothing yet.
  assert.equal(find(health(base, checks, '2026-10-15T10:00:00+03:00'), 'waiting'), undefined);
  // And a client holding the work is not "quiet".
  assert.equal(find(h, 'quiet'), undefined);
});

test('red: the shoot day at risk (no approved scripts a business day before; reminders not sent by 15:00) and its preparation', () => {
  const c = { ...base, shoot_at: '2026-10-21T11:00:00+03:00' };
  const checks = { ...onboarded(c), ...done(c, ['p11', 'p12a', 'p12'], '2026-10-14T10:00:00+03:00'), ...item('p13.zoom', '2026-10-15T10:00:00+03:00') };
  assert.equal(find(health(c, checks, '2026-10-15T10:00:00+03:00'), 'shoot-risk'), undefined); // 4 business days ahead
  // Monday, 2 business days before Wednesday: not yet (section 3: "יום עסקים לפני הצילום").
  assert.equal(find(health(c, checks, '2026-10-19T17:00:00+03:00'), 'shoot-risk'), undefined);
  const h = health(c, checks, '2026-10-20T08:00:00+03:00'); // Tuesday: the business day before
  const r = find(h, 'shoot-risk', 'p13');
  assert.deepEqual([r.color, r.who, r.text], ['red', 'lior', 'צילום בסיכון']);
  assert.match(r.what, /^אין אישור לקוח על התסריטים, הצילום מחר$/);
  assert.equal(h.color, 'red');
  const approved = { ...checks, ...item('p13.approved', '2026-10-16T10:00:00+03:00') };
  assert.equal(find(health(c, approved, '2026-10-20T08:00:00+03:00'), 'shoot-risk'), undefined);
  // Approval marked "not relevant" (no scripts for this shoot): not at risk either.
  const na = { ...checks, 'p13.approved': { state: 'na', at: '2026-10-16T10:00:00+03:00', note: null, by_email: 'lior@x.test' } };
  assert.equal(find(health(c, na, '2026-10-20T08:00:00+03:00'), 'shoot-risk', 'p13'), undefined);
  // The day before (Tuesday) at 15:00 the reminders (15) are still open.
  const eve = health(c, approved, '2026-10-20T15:30:00+03:00');
  assert.match(find(eve, 'shoot-risk', 'p15').what, /^התזכורות של יום לפני לא נשלחו, הצילום מחר$/);
  assert.equal(find(health(c, approved, '2026-10-20T14:30:00+03:00'), 'shoot-risk', 'p15'), undefined);
  // Natali: make-up and ride (11ב) 3 business days before: red, its own reason, not "צילום בסיכון".
  const n = { ...c, shoot_type: 'natali' };
  const nChecks = { ...approved, ...done(n, ['p11'], '2026-10-14T10:00:00+03:00') };
  const prep = find(health(n, nChecks, '2026-10-18T10:00:00+03:00'), 'shoot-prep', 'p11b');
  assert.deepEqual([prep.color, prep.who, prep.text], ['red', 'lior', 'הכנת יום הצילום לא הושלמה']);
  assert.equal(find(health(n, nChecks, '2026-10-18T10:00:00+03:00'), 'shoot-risk'), undefined);
  // An extra shoot round is watched the same way, named by its round.
  const r2 = { ...c, rounds: [{ n: 2, shoot_type: 'dms', shoot_at: '2026-11-04T11:00:00+02:00', start_at: '2026-10-25T10:00:00+02:00' }] };
  assert.equal(find(health(r2, approved, '2026-11-02T10:00:00+02:00'), 'shoot-risk', 'r2-p13'), undefined);
  const risk2 = find(health(r2, approved, '2026-11-03T10:00:00+02:00'), 'shoot-risk', 'r2-p13');
  assert.match(risk2.what, /\(סבב 2\)$/);
});

test('red: the shoot day moved (recently, from a set date)', () => {
  const c = { ...base, shoot_at: '2026-10-22T11:00:00+03:00' };
  const moved = { client_id: 'c1', field: 'shoot_at', old_value: '2026-10-20T08:00:00+00:00', new_value: '2026-10-22T08:00:00+00:00', at: '2026-10-15T09:00:00+03:00', by_email: 'irit@x.test' };
  const r = find(health(c, onboarded(c), '2026-10-15T10:00:00+03:00', { dateChanges: [moved] }), 'shoot-moved');
  assert.deepEqual([r.color, r.who, r.text, r.what], ['red', 'lior', 'יום הצילום זז', 'מ־ג׳ 20.10 ל־ה׳ 22.10']);
  // Long enough ago, or the first time a date was set, is not a move.
  assert.equal(find(health(c, onboarded(c), '2026-10-21T10:00:00+03:00', { dateChanges: [moved] }), 'shoot-moved'), undefined);
  assert.equal(find(health(c, onboarded(c), '2026-10-15T10:00:00+03:00', { dateChanges: [{ ...moved, old_value: null }] }), 'shoot-moved'), undefined);
});

test('red: a login broken for more than 2 business days', () => {
  const a = (updated) => [{ client_id: 'c1', network: 'instagram', status: 'broken', updated_at: updated }, { client_id: 'c1', network: 'tiktok', status: 'ok', updated_at: updated }];
  const r = find(health(base, onboarded(), '2026-10-15T10:00:00+03:00', { access: a('2026-10-11T10:00:00+03:00') }), 'access');
  assert.deepEqual([r.color, r.who, r.text, r.what], ['red', 'lior', 'גישה שבורה 4 ימי עסקים', 'Instagram']);
  assert.equal(find(health(base, onboarded(), '2026-10-15T10:00:00+03:00', { access: a('2026-10-13T10:00:00+03:00') }), 'access'), undefined);
});

test('exceptions: urgent is red, open over a business day is red, a fresh one yellow; urgent tasks and late tasks', () => {
  const t = (o) => ({ id: `t${Math.random()}`, client_id: 'c1', title: 'הלקוח מתלונן על העיכוב', owner: 'lior', done_at: null, due_on: null, urgent: false, source: 'escalation', created_at: '2026-10-13T10:00:00+03:00', ...o });
  const h = (tasks, now = '2026-10-13T12:00:00+03:00') => health(base, onboarded(), now, { tasks });
  assert.deepEqual([find(h([t({ urgent: true })]), 'escalation-urgent').color, find(h([t({ urgent: true })]), 'escalation-urgent').who], ['red', 'lior']);
  assert.equal(find(h([t()]), 'escalation').color, 'yellow');
  const old = find(h([t()], '2026-10-14T11:00:00+03:00'), 'escalation-open');
  assert.deepEqual([old.color, old.text], ['red', 'חריגה פתוחה יום עסקים']);
  // An urgent task (not an exception) open over 4 office hours.
  assert.equal(find(h([t({ source: null, urgent: true, owner: 'ilai' })], '2026-10-13T13:00:00+03:00'), 'urgent-task'), undefined);
  const u = find(h([t({ source: null, urgent: true, owner: 'ilai' })], '2026-10-13T15:00:00+03:00'), 'urgent-task');
  assert.deepEqual([u.color, u.who], ['red', 'ilai']);
  // A task past its day: yellow, its owner's.
  const lt = find(h([t({ source: 'p31', due_on: '2026-10-12', owner: 'ofir' })]), 'late-task');
  assert.deepEqual([lt.color, lt.who], ['yellow', 'ofir']);
  // Done tasks and other clients' tasks do not count.
  assert.deepEqual(codes(h([t({ done_at: '2026-10-13T11:00:00+03:00', urgent: true }), t({ client_id: 'c2', urgent: true })])).filter((x) => /escalation|task/.test(x)), []);
});

test('red: deliverables behind the promised pace, never for what the client holds', () => {
  // Shot on Sunday 11.10: the videos are promised by the end of the 5th business day after, Sunday 18.10.
  const c = { ...base, shoot_at: '2026-10-11T10:00:00+03:00', deliverables: { videos: 25, graphics: 35, shoot_days: 1, done: { videos: 0 } } };
  const checks = { ...onboarded(c), ...done(c, ['p23'], '2026-10-12T15:00:00+03:00') };
  const st = (now, cs = checks) => deliverablesPace(c, clientState(c, cs, at(now)), cs, at(now));
  assert.deepEqual(st('2026-10-18T10:00:00+03:00').behind, []);
  const p = st('2026-10-19T10:00:00+03:00');
  assert.deepEqual(p.behind.map((x) => [x.key, x.done, x.total, x.expected]), [['videos', 0, 25, 25]]);
  const r = find(health(c, checks, '2026-10-19T10:00:00+03:00'), 'pace');
  assert.deepEqual([r.color, r.who, r.what], ['red', 'lior', 'סרטונים 0/25, צפוי 25']);
  // Sent to the client and waiting for their approval: not behind.
  const sent = { ...checks, ...item('p26.sent', '2026-10-18T12:00:00+03:00') };
  assert.deepEqual(st('2026-10-19T10:00:00+03:00', sent).behind, []);
  // Approved: delivered, even when nobody updated the count in the card.
  const ok = { ...sent, ...done(c, ['p22a', 'p22', 'p24', 'p25', 'p26', 'p27'], '2026-10-18T13:00:00+03:00') };
  const d = st('2026-10-19T10:00:00+03:00', ok);
  assert.deepEqual(d.items.map((x) => `${x.label} ${x.done}/${x.total}`), ['סרטונים 25/25', 'גרפיקות 35/35']);
  // Imported history counts as delivered, so an import never turns red.
  const imp = Object.fromEntries(importKeys('publish').map((k) => [k, { state: 'done', at: '2026-10-11T09:00:00+03:00', note: IMPORT_NOTE }]));
  assert.deepEqual(st('2026-10-19T10:00:00+03:00', imp).behind, []);
});

test('yellow: due tomorrow and not started (not what cannot start yet, not what waits on the client)', () => {
  // The content call (12א) is due Tuesday; on Monday afternoon nobody started it.
  const checks = { ...done(base, JOIN, '2026-10-11T09:03:00+03:00'), ...done(base, CHAR, '2026-10-12T12:00:00+03:00') };
  const h = health(base, checks, '2026-10-12T15:00:00+03:00');
  const r = find(h, 'due-soon', 'p12a');
  assert.deepEqual([r.color, r.who, r.text], ['yellow', 'lior', 'מועד מחר ועוד לא התחילו']);
  assert.equal(h.color, 'yellow');
  // Started (one item checked): fine.
  assert.equal(find(health(base, { ...checks, ...item('p12a.read', '2026-10-12T14:00:00+03:00') }, '2026-10-12T15:00:00+03:00'), 'due-soon', 'p12a'), undefined);
  // Shoot-day processes due tomorrow start with the shoot itself: not "not started".
  const c = { ...base, shoot_at: '2026-10-13T11:00:00+03:00' };
  assert.equal(find(health(c, checks, '2026-10-12T15:00:00+03:00'), 'due-soon', 'p17'), undefined);
  // Due today and still not started: still yellow (it does not turn green on its own day).
  const today = find(health(base, checks, '2026-10-13T16:00:00+03:00'), 'due-soon', 'p12a');
  assert.deepEqual([today.color, today.text], ['yellow', 'מועד היום ועוד לא התחילו']);
  // "Tomorrow" is the next business day: on Thursday, what is due on Sunday.
  const sun = { ...base, char_at: '2026-10-13T10:00:00+03:00' }; // 11 is due 3 business days on: Sunday 18.10
  const sunChecks = { ...done(sun, JOIN, '2026-10-11T09:03:00+03:00'), ...done(sun, CHAR, '2026-10-13T12:00:00+03:00') };
  const s11 = clientState(sun, sunChecks, at('2026-10-15T15:00:00+03:00')).states.find((x) => x.proc.id === 'p11');
  assert.equal(s11.dueAt.toISOString().slice(0, 10), '2026-10-18');
  const thu = find(health(sun, sunChecks, '2026-10-15T15:00:00+03:00'), 'due-soon', 'p11');
  assert.deepEqual([thu.color, thu.who, thu.text], ['yellow', 'irit', 'מועד ב־א׳ 18.10 ועוד לא התחילו']);
  assert.equal(find(health(sun, sunChecks, '2026-10-14T15:00:00+03:00'), 'due-soon', 'p11'), undefined); // Wednesday: two business days ahead
});

test('how late, in words: business days from another day, office time within the day', () => {
  // A deadline at the end of Monday, seen on Tuesday at 10:00: a business day, never "10 hours".
  assert.equal(lateWords(at('2026-10-12T23:59:59+03:00'), at('2026-10-13T10:00:00+03:00')), 'יום עסקים');
  assert.equal(lateWords(at('2026-10-12T18:00:00+03:00'), at('2026-10-14T10:00:00+03:00')), '2 ימי עסקים');
  // Within the day, office time only (the evening does not count).
  assert.equal(lateWords(at('2026-10-13T09:05:00+03:00'), at('2026-10-13T09:25:00+03:00')), '20 דק׳');
  assert.equal(lateWords(at('2026-10-13T09:05:00+03:00'), at('2026-10-13T12:10:00+03:00')), '3 שעות עבודה');
  assert.equal(lateWords(at('2026-10-13T17:00:00+03:00'), at('2026-10-13T22:00:00+03:00')), 'שעת עבודה');
});

test('yellow: a second round of corrections (the client\'s notes on the videos again; graphics sent a third time)', () => {
  const c = { ...base, shoot_at: '2026-10-14T10:00:00+03:00' };
  const row = (key, action, when, by = 'irit@x.test') => ({ client_id: 'c1', item_key: key, action, at: when, by_email: by, note: null });
  const once = [row('p27.notes', 'done', '2026-10-19T10:00:00+03:00')];
  assert.equal(find(health(c, onboarded(c), '2026-10-20T10:00:00+03:00', { log: once }), 'revision'), undefined);
  const twice = [...once, row('p27.notes', 'clear', '2026-10-19T15:00:00+03:00'), row('p27.notes', 'done', '2026-10-20T09:00:00+03:00')];
  const r = find(health(c, onboarded(c), '2026-10-20T10:00:00+03:00', { log: twice }), 'revision');
  assert.deepEqual([r.color, r.who, r.text, r.what], ['yellow', 'lior', 'סבב תיקונים 2', 'בסרטונים']);
  // An undo within 10 minutes is not a round.
  const undo = [...once, row('p27.notes', 'clear', '2026-10-19T10:04:00+03:00'), row('p27.notes', 'done', '2026-10-19T10:05:00+03:00')];
  assert.equal(doneEvents(undo, 'p27.notes').length, 1);
  assert.equal(find(health(c, onboarded(c), '2026-10-20T10:00:00+03:00', { log: undo }), 'revision'), undefined);
  // The 9 graphics sent a third time, still not approved: the second round of corrections.
  const open7 = Object.fromEntries(Object.entries(onboarded(c)).filter(([k]) => k !== 'p07.approved'));
  const sends = ['2026-10-12T12:00', '2026-10-12T15:00', '2026-10-13T11:00'].map((t) => row('p07.sent', 'done', `${t}:00+03:00`));
  assert.equal(find(health(c, open7, '2026-10-13T12:00:00+03:00', { log: sends }), 'revision', 'p07').text, 'סבב תיקונים 2');
  assert.equal(find(health(c, open7, '2026-10-13T12:00:00+03:00', { log: sends.slice(0, 2) }), 'revision'), undefined);
});

test('yellow: no contact with the client for 2 business days (only where messages are recorded)', () => {
  const checks = done(base, JOIN, '2026-10-11T09:03:00+03:00'); // the intro message: contact on Sunday
  const c = { ...base, char_at: null };
  // Monday and Tuesday without a word: from Wednesday.
  assert.equal(find(health(c, checks, '2026-10-13T17:00:00+03:00', { messages: [] }), 'no-contact'), undefined);
  const r = find(health(c, checks, '2026-10-14T10:00:00+03:00', { messages: [] }), 'no-contact');
  assert.deepEqual([r.color, r.who, r.text], ['yellow', 'irit', 'אין מגע עם הלקוח 2 ימי עסקים']);
  assert.equal(find(health(c, checks, '2026-10-14T10:00:00+03:00', { messages: null }), 'no-contact'), undefined);
  const msg = [{ client_id: 'c1', sent_at: '2026-10-13T10:00:00+03:00' }, { client_id: 'c2', sent_at: '2026-10-14T09:00:00+03:00' }];
  assert.equal(find(health(c, checks, '2026-10-14T10:00:00+03:00', { messages: msg }), 'no-contact'), undefined);
  assert.equal(+lastContact(c, checks, msg), +at('2026-10-13T10:00:00+03:00'));
});

test('yellow: no activity for 5 business days; a missing Thursday summary; the client\'s score', () => {
  const c = { ...base, char_at: '2026-11-01T10:00:00+02:00' }; // a meeting far ahead: nothing to do meanwhile
  const checks = done(c, JOIN, '2026-10-11T09:03:00+03:00');
  assert.equal(find(health(c, checks, '2026-10-15T10:00:00+03:00'), 'quiet'), undefined);
  // Last activity on Sunday 11.10: Monday to Thursday and Sunday 18.10 are five whole
  // business days only once Sunday is over (just after midnight, and in the day, it is four).
  assert.equal(find(health(c, checks, '2026-10-18T00:30:00+03:00'), 'quiet'), undefined);
  assert.equal(find(health(c, checks, '2026-10-18T10:00:00+03:00'), 'quiet'), undefined);
  const q = find(health(c, checks, '2026-10-19T08:00:00+03:00'), 'quiet');
  assert.deepEqual([q.color, q.text], ['yellow', 'אין פעילות 5 ימי עסקים']);
  // Thursday from 13:00: Ofir's summary of the week is missing.
  const thu = (now, notes) => find(health(c, checks, now, { statusNotes: notes }), 'thursday');
  assert.equal(thu('2026-10-15T12:59:00+03:00', []), undefined);
  assert.deepEqual([thu('2026-10-15T13:00:00+03:00', []).who, thu('2026-10-15T13:00:00+03:00', []).color], ['ofir', 'yellow']);
  assert.equal(thu('2026-10-16T10:00:00+03:00', [{ client_id: 'c1', week: '2026-10-11' }]), undefined);
  assert.equal(thu('2026-10-15T14:00:00+03:00', null), undefined); // not loaded: no claim
  assert.equal(thu('2026-10-18T10:00:00+03:00', []), undefined); // a new week
  assert.equal(thursdayDue(at('2026-10-17T10:00:00+03:00')).week, '2026-10-11');
  // The client's score, when there is one.
  assert.equal(find(health(c, checks, '2026-10-12T10:00:00+03:00', { score: 2 }), 'score-low').color, 'red');
  assert.equal(find(health(c, checks, '2026-10-12T10:00:00+03:00', { score: 3 }), 'score-mid').color, 'yellow');
  assert.equal(health(c, checks, '2026-10-12T10:00:00+03:00', { score: 5 }).color, 'green');
});

test('reasons come most severe first: red before yellow, then by rule, then the longest', () => {
  const checks = { ...onboarded(), [WAIT({ id: 'p12a' })]: { state: 'done', at: '2026-10-12T15:00:00+03:00', note: waitNote('ממתינים לשיחה', null) } };
  const h = health({ ...base, shoot_at: '2026-10-21T11:00:00+03:00' }, checks, '2026-10-20T10:00:00+03:00', { messages: [] });
  const colors = h.reasons.map((r) => r.color);
  assert.deepEqual(colors, [...colors].sort((a, b) => (a === b ? 0 : a === 'red' ? -1 : 1)));
  assert.equal(h.reasons[0].code, 'shoot-risk');
  for (const r of h.reasons) assert.ok(r.who && r.text, JSON.stringify(r));
});

test('the station: where, how long, what next and by whom, the month, the pace and the last contact', () => {
  const c = { ...base, deliverables: { videos: 42, graphics: 42, shoot_days: 2, done: { videos: 18, graphics: 20 } } };
  const checks = onboarded(c);
  const now = at('2026-10-13T10:00:00+03:00');
  const s = station(c, clientState(c, checks, now), { checks, now, messages: [{ client_id: 'c1', sent_at: '2026-10-12T16:00:00+03:00' }] });
  assert.deepEqual([s.index, s.key, s.title], [2, 'content', 'תוכן ואישור']);
  // The station began when the characterization day was done.
  assert.equal(+s.since, +at('2026-10-12T12:00:00+03:00'));
  assert.equal(s.days, 1);
  assert.deepEqual([s.next.what, s.next.who, s.next.procId], ['קביעת יום הצילום', 'irit', 'p11']);
  assert.equal(+s.next.when, +at('2026-10-15T18:00:00+03:00'));
  assert.equal(s.paceText, 'סרטונים 18/42 · גרפיקות 20/42');
  assert.equal(s.month.text, 'חודש 1 מתוך 12');
  assert.equal(+s.lastContact, +at('2026-10-12T16:00:00+03:00'));
  assert.equal(s.waiting, false);
  assert.deepEqual([s.current.who, s.current.procId], ['lior', 'p12a']);
  // A shoot day not set yet: the milestone has no date, and must be set by process 11's deadline.
  // Since protocol v8 process 11 cannot be closed without a date, so this is only a history
  // that was brought in (the note "ייבוא") with no date typed.
  const later = at('2026-10-16T10:00:00+03:00');
  const history = Object.fromEntries(Object.entries(done(c, ['p11'], '2026-10-14T10:00:00+03:00')).map(([k, v]) => [k, { ...v, note: 'ייבוא' }]));
  const withScripts = { ...checks, ...history, ...done(c, ['p12a', 'p12', 'p13'], '2026-10-14T10:00:00+03:00') };
  const n = station(c, clientState(c, withScripts, later), { checks: withScripts, now: later }).next;
  assert.deepEqual([n.what, n.when, n.who], ['יום הצילום', null, 'lior']);
  assert.equal(+n.mustSetBy, +at('2026-10-15T18:00:00+03:00'));
  assert.deepEqual(contractMonth({ deal_at: '2026-10-11T09:00:00+03:00', contract_end: '2027-10-11' }, at('2026-12-20T10:00:00+02:00')), { n: 3, of: 12, text: 'חודש 3 מתוך 12' });
});

test('the timeline: done with who and when (automatic marked), now, and planned dates', () => {
  const c = { ...base, char_at: null };
  const checks = { ...done(c, ['p01'], '2026-10-11T09:00:00+03:00', 'נחתם במערכת: AST-2026-0001', 'system'), ...done(c, ['p02'], '2026-10-11T09:04:00+03:00') };
  const now = at('2026-10-11T12:00:00+03:00');
  const tl = timeline(c, clientState(c, checks, now), checks, now);
  assert.deepEqual(tl.done.map((x) => [x.procId, x.auto, x.by]), [['p01', true, 'system'], ['p02', false, 'irit@x.test']]);
  assert.deepEqual(tl.current.map((x) => x.procId), ['p03']);
  assert.equal(tl.current[0].who, 'irit');
  // The meeting has no date yet: it must be set by process 3's deadline (5 minutes from the deal).
  const p04 = tl.planned.find((x) => x.procId === 'p04');
  assert.equal(p04.when, null);
  assert.equal(+p04.mustSetBy, +at('2026-10-11T09:05:00+03:00'));
  assert.ok(isAutoCheck({ by_email: 'system' }) && !isAutoCheck({ by_email: 'lior@x.test', note: null }));
  // Only the setter's own deadline is claimed: with no meeting date yet, the shoot day
  // is "not set" without a date (it does not have to be set on the deal's day).
  const p19 = tl.planned.find((x) => x.procId === 'p19');
  assert.deepEqual([p19.when, p19.mustSetBy], [null, null]);
  for (const id of ['p19', 'p22', 'p27', 'p30']) assert.equal(tl.planned.find((x) => x.procId === id)?.mustSetBy ?? null, null, id);
});

test('stuck in a station longer than its norm (not while waiting for a date that is set, nor on the client)', () => {
  // Onboarded on Monday 12.10; the shoot day never set.
  const checks = { ...onboarded(), ...done(base, ['p12a', 'p12', 'p13'], '2026-10-13T12:00:00+03:00') };
  // (The daily follow-up, 14, still holds the client in "תוכן ואישור" until the shoot day: protocol v8 moved nobody's station.)
  const norm = STATION_NORM.content;
  assert.equal(norm, 10);
  // In the station since Tuesday 13.10 (the first thing done in it). On Wednesday 28.10, 10 whole business days: the norm.
  assert.equal(find(health(base, checks, '2026-10-28T17:00:00+02:00'), 'stuck'), undefined);
  const s = find(health(base, checks, '2026-10-29T10:00:00+02:00'), 'stuck');
  assert.deepEqual([s.color, s.text, s.what, s.who], ['yellow', 'בתחנה 11 ימי עסקים', 'תוכן ואישור · הנורמה עד 10 ימי עסקים', 'irit']);
  // A shoot day set ahead: the station waits for it, nobody is stuck.
  const ahead = { ...base, shoot_at: '2026-11-15T10:00:00+02:00' };
  assert.equal(find(health(ahead, checks, '2026-10-29T10:00:00+02:00'), 'stuck'), undefined);
  // The client is holding the work: not the team's.
  const wait = { ...checks, [WAIT({ id: 'p11' })]: { state: 'done', at: '2026-10-14T10:00:00+03:00', note: waitNote('הלקוח לא אישר תאריך', null), by_email: 'irit@x.test' } };
  assert.equal(find(health(base, wait, '2026-10-29T10:00:00+02:00'), 'stuck'), undefined);
});

test('returns to fix and rounds of corrections count the whole history, not only the window', () => {
  const c = { ...base, editor: 'nadia', shoot_at: '2026-10-14T10:00:00+03:00' };
  const row = (key, when, by = 'nadia@x.test') => ({ client_id: 'c1', item_key: key, action: 'done', at: when, by_email: by, note: null });
  // Handed to Ofir on 1.9 (before a 30-day window) and again on 19.10 (inside it).
  const history = [row('p24.notify', '2026-09-01T10:00:00+03:00'), row('p24.notify', '2026-10-19T10:00:00+03:00')];
  const windowLog = [history[1], row('p05.menu', '2026-10-19T11:00:00+03:00', 'irit@x.test')];
  const since = at('2026-09-20T00:00:00+03:00');
  assert.equal(reworkCounts([c], windowLog, since).get('nadia') || 0, 0); // the window alone takes 19.10 for the first
  const keys = historyKeys([c]);
  assert.ok(keys.includes('p24.notify') && keys.includes('p27.notes') && keys.includes('p07.sent'));
  const merged = withHistory(windowLog, history, keys);
  assert.equal(reworkCounts([c], merged, since).get('nadia'), 1);
  assert.equal(merged.filter((r) => r.item_key === 'p05.menu').length, 1);
  // Without the history (not loaded), the window is used as it is.
  assert.equal(withHistory(windowLog, null, keys), windowLog);
});

test('screen 1: one row per client, the Thursday summary as one row, office rows, at most 10', () => {
  const mk = (id, reasons) => ({ client: { id, name: id }, station: null, health: { color: reasons.some((r) => r.color === 'red') ? 'red' : reasons.length ? 'yellow' : 'green', reasons } });
  const r = (color, code, days = 0, who = 'irit') => ({ color, code, days, who, text: code });
  const entries = [
    mk('a', [r('yellow', 'late-soon', 1), r('yellow', 'thursday', 0, 'ofir')]),
    mk('b', [r('red', 'late', 4, 'lior'), r('yellow', 'waiting', 3)]),
    mk('c', [r('yellow', 'thursday', 0, 'ofir')]),
    mk('d', []),
    ...Array.from({ length: 10 }, (_, i) => mk(`e${i}`, [r('yellow', 'quiet', 5 + i)])),
  ];
  const office = officeReasons([], at('2026-10-13T10:00:00+03:00'));
  assert.deepEqual(office.map((x) => [x.code, x.who]), [['review32', 'irit'], ['review33', 'ofir']]);
  const { rows, more, total } = ownerRows(entries, { office });
  assert.equal(rows.length, 10);
  assert.equal(total, 2 + 1 + 10 + 2); // a, b, the Thursday row, ten quiet clients, two reviews
  assert.equal(more, total - 10);
  assert.deepEqual([rows[0].client.id, rows[0].code, rows[0].more], ['b', 'late', 1]);
  assert.equal(rows[1].client.id, 'a');
  // The quiet ones, longest first.
  assert.deepEqual(rows.filter((x) => x.code === 'quiet').map((x) => x.days).slice(0, 3), [14, 13, 12]);
  const all = ownerRows(entries, { office, limit: 50 }).rows;
  const thu = all.find((x) => x.code === 'thursday');
  assert.deepEqual([thu.client, thu.who, thu.what, thu.clients.map((x) => x.id)], [null, 'ofir', '2 לקוחות', ['a', 'c']]);
  assert.deepEqual(colorCounts(entries), { red: 1, yellow: 12, green: 1 });
  // Reviews done: no office rows.
  const reviews = [{ day: '2026-10-12', kind: 'p32' }, { day: '2026-10-12', kind: 'p33' }];
  assert.deepEqual(officeReasons(reviews, at('2026-10-13T10:00:00+03:00')), []);
  assert.deepEqual(officeReasons(null, at('2026-10-13T10:00:00+03:00')), []);
});

test('screen 1 numbers: late now, on time by week (waiting and others\' stops left out), shoot days ahead', () => {
  const now = at('2026-10-20T10:00:00+03:00');
  const c = { ...base, editor: 'nadia', shoot_at: '2026-10-14T10:00:00+03:00' };
  const s = clientState(c, onboarded(c), now);
  assert.equal(lateNow([c], () => s, [{ client_id: 'c1', due_on: '2026-10-19', done_at: null }], now), s.states.filter((x) => x.status === 'overdue').length + 1);
  // Editing was assigned Thursday 15.10 12:00; 22 is due 3 business days later (Tuesday 20.10, end of day).
  // Nadia finished on Wednesday 21.10 at 10:00, a day late, but her editing was stopped from Sunday to
  // Wednesday for Lior's urgent task: that stop moves her deadline, so she was on time.
  const checks = {
    ...onboarded(c), ...done(c, ['p11', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p21'], '2026-10-14T18:00:00+03:00'),
    ...done(c, ['p22a'], '2026-10-15T12:00:00+03:00', null, 'ofir@x.test'), ...done(c, ['p22'], '2026-10-21T10:00:00+03:00', null, 'nadia@x.test'),
  };
  const log = [{ client_id: 'c1', item_key: 'p22.pause', action: 'done', at: '2026-10-18T09:00:00+03:00', by_email: 'nadia@x.test' },
    { client_id: 'c1', item_key: 'p22.pause', action: 'clear', at: '2026-10-21T09:00:00+03:00', by_email: 'nadia@x.test' }];
  const when = at('2026-10-22T10:00:00+03:00');
  const st = clientState(c, checks, when);
  const rows = (lg) => closedProcesses([c], { stateOf: () => st, checksByClient: { c1: checks }, since: at('2026-09-01T00:00:00+03:00'), now: when, log: lg });
  assert.equal(rows(null).find((x) => x.key === 'p22').onTime, false);
  const p22 = rows(log).find((x) => x.key === 'p22');
  assert.equal(p22.onTime, true);
  assert.ok(p22.paused > 0);
  const trend = onTimeTrend(rows(log), when);
  assert.equal(trend.weeks.length, 8);
  assert.equal(trend.done, rows(log).length);
  assert.equal(trend.weeks.at(-1).done + trend.weeks.at(-2).done, trend.done);
  assert.ok(trend.rate > 0 && trend.rate <= 1);
  // Shoot days in the next 7 days, extra rounds too.
  const r = { ...base, id: 'c2', shoot_at: '2026-10-22T10:00:00+03:00', rounds: [{ n: 2, shoot_at: '2026-10-26T10:00:00+02:00' }, { n: 3, shoot_at: '2026-11-20T10:00:00+02:00' }] };
  assert.deepEqual(shootsAhead([r, { ...r, id: 'c3', status: 'ended' }], at('2026-10-20T10:00:00+03:00')).map((x) => x.round), [1, 2]);
});

test('screen 4: open, late, this week, on time, median vs norm, editor load vs cap, returns, "not relevant" and date changes', () => {
  const c = { ...base, editor: 'nadia', shoot_at: '2026-10-14T10:00:00+03:00' };
  const row = (key, action, when, by) => ({ client_id: 'c1', item_key: key, action, at: when, by_email: by, note: null });
  const log = [
    row('p24.notify', 'done', '2026-10-19T10:00:00+03:00', 'nadia@x.test'), row('p24.notify', 'clear', '2026-10-19T12:00:00+03:00', 'ofir@x.test'),
    row('p24.notify', 'done', '2026-10-19T16:00:00+03:00', 'nadia@x.test'),
    row('p07.made', 'done', '2026-10-12T11:00:00+03:00', 'ilai@x.test'),
    row('p10.c.ads', 'na', '2026-10-12T11:00:00+03:00', 'lior@x.test'), row('p05.menu', 'na', '2026-10-12T11:00:00+03:00', 'irit@x.test'),
  ];
  const directory = { 'nadia@x.test': 'nadia', 'lior@x.test': 'lior', 'irit@x.test': 'irit', 'ofir@x.test': 'ofir' };
  const changes = [{ client_id: 'c1', field: 'shoot_at', at: '2026-10-13T10:00:00+03:00', by_email: 'irit@x.test' },
    // A first setting kept only for its confirmation note (date_change_note) is not a moved deadline.
    { client_id: 'c1', field: 'shoot_at', old_value: null, new_value: '2026-10-20T08:00:00+00:00', at: '2026-10-12T10:00:00+03:00', by_email: 'irit@x.test' }];
  const work = (k) => (k === 'lior' ? [{ status: 'overdue', dueAt: at('2026-10-19T10:00:00+03:00') }, { status: 'today', dueAt: at('2026-10-20T18:00:00+03:00') }, { status: 'client', dueAt: null }] : []);
  const rows = [{ people: ['lior'], onTime: true, min: 60, targetMin: 120 }, { people: ['lior'], onTime: false, min: 200, targetMin: 120 }, { people: ['irit'], onTime: true, min: 5, targetMin: 5 }];
  const t = teamRows(['lior', 'nadia', 'irit'], {
    work, rows, log, changes, directory, clients: [c], jobs: (k) => (k === 'nadia' ? 1 : null), since: at('2026-09-20T00:00:00+03:00'), now: at('2026-10-20T10:00:00+03:00'),
  });
  const [lior, nadia, irit] = t;
  assert.deepEqual([lior.open, lior.late, lior.week, lior.done, lior.onTime, lior.median, lior.norm, lior.na], [2, 1, 1, 2, 1, 130, 120, 1]);
  assert.deepEqual([nadia.load, nadia.cap, nadia.rework], [1, EDITOR_CAP, 1]);
  // An optional item not needed is not gaming; a date change is counted for who made it.
  assert.deepEqual([irit.na, irit.moves, irit.load], [0, 1, null]);
});

test('the weekly call is due by Thursday of the week after the last one; the board of the week', () => {
  const c = { ...base, shoot_at: '2026-10-14T10:00:00+03:00' };
  const all = ['p04', 'p05', 'p05b', 'p06', 'p07', 'p07a', 'p07b', 'p08', 'p08b', 'p09', 'p10', 'p11', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p21', 'p22a', 'p22', 'p23', 'p24', 'p25', 'p26', 'p27', 'p28', 'p29', 'p30'];
  const checks = { ...done(c, JOIN, '2026-10-11T09:03:00+03:00'), ...done(c, all, '2026-10-20T10:00:00+03:00') };
  const s = clientState(c, checks, at('2026-10-21T10:00:00+03:00')).states.find((x) => x.proc.id === 'p31');
  // Campaigns up on Tuesday 20.10: the first call is due by Thursday of the following week.
  assert.equal(+weeklyCallDue(s, checks), +at('2026-10-29T18:00:00+02:00'));
  const called = { ...checks, ...item('p31.call', '2026-10-28T12:00:00+02:00') };
  assert.equal(+weeklyCallDue(s, called), +at('2026-11-05T18:00:00+02:00'));
  // Late after that Thursday, red from the third business day.
  const late = find(health(c, checks, '2026-11-02T10:00:00+02:00'), null, 'p31');
  assert.deepEqual([late.color, late.who], ['yellow', 'lior']);
  assert.equal(find(health(c, checks, '2026-11-04T10:00:00+02:00'), null, 'p31').color, 'red');
  // The board: the meeting, the shoot, the videos closing, the campaign and the renewal.
  const d = { ...base, id: 'c2', char_at: '2026-10-13T10:00:00+03:00', shoot_at: '2026-10-15T11:00:00+03:00', contract_end: '2026-11-05' };
  const ev = upcomingEvents([d], (x) => clientState(x, {}, at('2026-10-12T10:00:00+03:00')), at('2026-10-12T10:00:00+03:00'), 30);
  assert.deepEqual(ev.map((e) => e.kind), ['char', 'shoot', 'delivery', 'renewal']);
  assert.deepEqual(ev.map((e) => e.who), ['ofir', 'lior', 'ofir', 'lior']);
  assert.equal(upcomingEvents([d], (x) => clientState(x, {}, at('2026-10-12T10:00:00+03:00')), at('2026-10-12T10:00:00+03:00'), 7).length, 2); // the videos close on 22.10, beyond the week
});

test('who sees what: screen 1 the owner, Irit and Ofir (the managers); screen 2 also Lior; the whole team the owner and Lior', () => {
  const v = (me, scope = 'office', error = null) => ({ me, scope, error });
  assert.deepEqual([null, 'irit', 'lior', 'ofir', 'ilai', 'nadia'].map((m) => canSeeOwnerScreen(v(m, m && m !== 'irit' && m !== 'lior' && m !== 'ofir' ? 'own' : 'office'))), [true, true, false, true, false, false]);
  assert.deepEqual([null, 'irit', 'lior', 'ofir', 'ilai', 'eli'].map((m) => canSeeAllClients(v(m))), [true, true, true, true, false, false]);
  assert.deepEqual([null, 'irit', 'lior', 'ofir', 'nadia'].map((m) => seesWholeTeam(v(m))), [true, false, true, false, false]);
  assert.equal(canSeeOwnerScreen(v(null, 'office', new Error('x'))), false);
  assert.equal(canSeeAllClients(null), false);
  // Responsible for editing before an editor is assigned: Ofir assigns.
  const s = { proc: { owners: ['editor'], items: [{ key: 'p22.received', owners: ['editor'] }] }, claim: null };
  assert.equal(responsibleOf(s, {}, {}), 'ofir');
});

test('27: the editor\'s time ends at the final versions (p27.final), not at Ilai\'s "קיבלתי" (p27.toilai)', () => {
  const c = { ...base, editor: 'nadia', shoot_at: '2026-10-14T10:00:00+03:00' };
  const before = {
    ...onboarded(c), ...done(c, ['p11', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p21'], '2026-10-14T18:00:00+03:00'),
    ...done(c, ['p22a'], '2026-10-15T12:00:00+03:00', null, 'ofir@x.test'), ...done(c, ['p22', 'p23', 'p24'], '2026-10-19T10:00:00+03:00', null, 'nadia@x.test'),
    ...done(c, ['p25'], '2026-10-19T11:00:00+03:00', null, 'ofir@x.test'), ...done(c, ['p26'], '2026-10-19T12:00:00+03:00'),
    ...item('p27.approved', '2026-10-20T09:00:00+03:00'),
  };
  const due = clientState(c, before, at('2026-10-20T09:30:00+03:00')).states.find((x) => x.proc.id === 'p27').dueAt;
  assert.ok(due, 'p27 has a deadline');
  // The editor put the final versions in the Drive an hour before the deadline; Ilai pressed "קיבלתי" three days late.
  const finalAt = new Date(due.getTime() - 36e5);
  const lateIlai = new Date(due.getTime() + 3 * 864e5);
  const withFinal = { ...before, ...item('p27.final', finalAt.toISOString(), null, 'nadia@x.test') };
  const closed = { ...withFinal, ...item('p27.toilai', lateIlai.toISOString(), null, 'ilai@x.test') };
  const rowsAt = (checks, now) => closedProcesses([c], {
    stateOf: () => clientState(c, checks, now), checksByClient: { c1: checks }, since: at('2026-09-01T00:00:00+03:00'), now,
  }).filter((r) => r.key === 'p27');
  const now = new Date(lateIlai.getTime() + 36e5);
  assert.equal(clientState(c, closed, now).states.find((x) => x.proc.id === 'p27').complete, true);
  const [row] = rowsAt(closed, now);
  assert.equal(+row.completedAt, +finalAt);
  assert.equal(row.onTime, true);
  assert.deepEqual(row.people, ['nadia']);
  assert.deepEqual(onTimeOf(rowsAt(closed, now), 'nadia'), { done: 1, onTime: 1, rate: 1 });
  // Still waiting for Ilai: the editor's part is done and counted already.
  const [open] = rowsAt(withFinal, now);
  assert.equal(open.onTime, true);
  // Final versions after the deadline are the editor's lateness.
  const lateFinal = { ...closed, ...item('p27.final', new Date(due.getTime() + 36e5).toISOString(), null, 'nadia@x.test') };
  assert.equal(rowsAt(lateFinal, now)[0].onTime, false);
  // Not marked "final": nothing is counted for 27 until it closes.
  assert.deepEqual(rowsAt(before, now), []);
});
