// The reminder ladders (app/reminder-rules.js through app/reminder-engine.js):
// every rule of the section 5 matrix that the engine covers, at fixed Israel
// times (npm test runs this under UTC, New York and Jerusalem). Each test builds a
// small world, asks what is due at a moment, and checks who gets which step, at
// what level and when; and that a stop condition ends the ladder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders, candidates, buildEnv, planDelivery } from '../app/reminder-engine.js';
import { RULES, SNOOZE, officeMinutesBefore, businessDayFrom, inSendHours, inTimeWords, sentOnTime } from '../app/reminder-rules.js';
import { PROCESSES } from '../app/protocol.js';
import { IMPORT_NOTE } from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';
import { dateIL, partsIL } from '../app/tz.js';
import { returnNote, returnKey, fixedKey } from '../app/office-marks.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' }, { email: 'nirel@x', person: 'nirel' },
  { email: 'nadia@x', person: 'nadia' }, { email: 'yariv@x', person: 'yariv' }, { email: 'anna@x', person: 'anna' }, { email: 'eli@x', person: 'eli' },
];
let seq = 0;
const world = () => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF });
function client(w, o = {}) {
  seq += 1;
  const c = {
    id: `c${seq}`, name: o.name || `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
    rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 9, 1, 10).toISOString(), created_by_email: 'irit@x', ...o,
  };
  w.clients.push(c);
  return c;
}
const mark = (w, c, key, at, note = null, state = 'done') => {
  (w.checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state, note, at: at.toISOString(), by_email: 'x@x' };
};
const marks = (w, c, keys, at, note = null) => keys.forEach((k) => mark(w, c, k, at, note));
// Everything before a station, imported (no events, no lateness).
const importTo = (w, c, station) => marks(w, c, importKeys(station), IL(2026, 9, 1, 9), IMPORT_NOTE);
const itemsOf = (id, pre = '') => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => pre + i.key);
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const pick = (list, rule, step, person = null) => list.filter((r) => r.rule === rule && r.step === step && (!person || r.person === person));
const one = (list, rule, step, person = null) => {
  const got = pick(list, rule, step, person);
  assert.equal(got.length, 1, `${rule}.${step}${person ? `@${person}` : ''}: ${JSON.stringify(list.filter((r) => r.rule === rule).map((r) => r.key))}`);
  return got[0];
};
// What only a screen reads (Lior's "החלטות"; the rule `late` since 5.11.2026, docs/ops.md, section 100): never sent.
const onScreen = (w, now) => candidates(buildEnv({ ...w, now })).filter((r) => r.screen);
const none = (list, rule, step = null) => assert.equal(list.filter((r) => r.rule === rule && (!step || r.step === step)).length, 0,
  `${rule}${step ? `.${step}` : ''} should not be due: ${JSON.stringify(list.filter((r) => r.rule === rule).map((r) => r.key))}`);
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };

test('every rule has an id, the matrix row it implements, and valid steps', () => {
  const ids = new Set();
  for (const r of RULES) {
    assert.ok(/^[a-zA-Z0-9]+$/.test(r.id) && !ids.has(r.id), r.id);
    ids.add(r.id);
    assert.ok(r.event && typeof r.instances === 'function', r.id);
    if (Array.isArray(r.steps)) {
      for (const s of r.steps) {
        assert.ok(['ring', 'quiet', 'digest', 'board'].includes(s.level), `${r.id}.${s.id}`);
        assert.ok(!s.exempt || ['clock', 'shoot', 'urgent'].includes(s.exempt), `${r.id}.${s.id}`);
        assert.equal(typeof s.title, 'function', `${r.id}.${s.id}`);
      }
    }
  }
});

// Stage 3, part 2 merged three branches that each rang some of the same events
// (a return for fixes, the final versions to Ilai, Ofir's clock): one rule each.
test('one ring per editing event: the return, the fixes back with Ofir, the final versions and Ilai\'s "קיבלתי"', () => {
  const w = world();
  const c = client(w, { editor: 'nadia', shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, c, 'post');
  for (const id of ['p22a', 'p22', 'p24', 'p25', 'p26', 'p27']) for (const i of PROCESSES.find((p) => p.id === id).items) delete w.checks[c.id][i.key];
  mark(w, c, 'p22a.assigned', IL(2026, 10, 18, 10));
  mark(w, c, 'p22.received', IL(2026, 10, 18, 11));
  mark(w, c, 'p24.notify', IL(2026, 10, 20, 11));
  // (The ladder of what is late in this fixture, rules lateOwn and lateNag, is tests/late-ladder.test.mjs.)
  const rings = (now, who) => due(w, now).filter((r) => r.person === who && r.level === 'ring' && !/^late(Own|Nag)$/.test(r.rule)).map((r) => `${r.rule}.${r.step}`);
  assert.deepEqual(rings(IL(2026, 10, 20, 11), 'ofir'), ['qa.now']);
  mark(w, c, returnKey('', 'videos', 1), IL(2026, 10, 20, 11, 20), returnNote([{ ref: '1', text: 'x' }], IL(2026, 10, 20, 18)));
  assert.deepEqual(rings(IL(2026, 10, 20, 11, 20), 'nadia'), ['qaReturn.now']);
  assert.deepEqual(rings(IL(2026, 10, 20, 11, 40), 'ofir'), [], 'his clock stops on a return');
  mark(w, c, fixedKey('', 'videos', 1), IL(2026, 10, 20, 13));
  assert.deepEqual(rings(IL(2026, 10, 20, 13), 'ofir'), ['qa.now']);
  assert.deepEqual(rings(IL(2026, 10, 20, 13), 'nadia'), []);
  mark(w, c, 'p25.approved', IL(2026, 10, 20, 13, 30));
  mark(w, c, 'p26.sent', IL(2026, 10, 20, 14));
  mark(w, c, 'p27.approved', IL(2026, 10, 21, 10));
  mark(w, c, 'p27.final', IL(2026, 10, 21, 11));
  const ilai = due(w, IL(2026, 10, 21, 11)).filter((r) => r.person === 'ilai' && /סופיות/.test(r.title));
  assert.deepEqual(ilai.map((r) => `${r.rule}.${r.step}.${r.level}`), ['finalReady.ilai.quiet']);
  // Ilai late on it past 27's deadline: finalReady tells Lior, not a second "late" line naming the editor.
  const late = due(w, IL(2026, 10, 26, 10));
  one(late, 'finalReady', 'lior');
  assert.deepEqual(late.filter((r) => r.rule === 'late' && /27/.test(r.title)).map((r) => r.key), []);
  mark(w, c, 'p27.toilai', IL(2026, 10, 26, 11)); // Ilai's "קיבלתי" (protocol v5)
  none(due(w, IL(2026, 10, 26, 18)), 'finalReady');
});

test('office time helpers: 30 office minutes before a morning deadline start the day before', () => {
  assert.equal(hhmm(officeMinutesBefore(IL(2026, 10, 7, 10, 30), 30)), '7.10 10:00');
  assert.equal(hhmm(officeMinutesBefore(IL(2026, 10, 7, 9, 10), 30)), '6.10 17:40');
  // Across the weekend (Thursday 17:50 → Sunday 09:20).
  assert.equal(hhmm(officeMinutesBefore(IL(2026, 10, 11, 9, 20), 30)), '8.10 17:50');
  assert.equal(hhmm(businessDayFrom(IL(2026, 10, 8, 12), 1)), '11.10 12:00');
  assert.equal(hhmm(businessDayFrom(IL(2026, 10, 11, 10), -1)), '8.10 10:00');
  assert.equal(inSendHours(IL(2026, 10, 5, 8, 29)), false);
  assert.equal(inSendHours(IL(2026, 10, 5, 8, 30)), true);
  assert.equal(inSendHours(IL(2026, 10, 5, 18, 59)), true);
  assert.equal(inSendHours(IL(2026, 10, 5, 19, 0)), false);
  assert.equal(inSendHours(IL(2026, 10, 9, 10)), false); // Friday
  assert.equal(inSendHours(IL(2026, 9, 21, 10)), false); // Yom Kippur
  // Erev Yom Kippur closes at 13:00 and the next day is a holiday: 30 office
  // minutes before Tuesday 09:15 begin on Sunday at 12:45.
  assert.equal(hhmm(officeMinutesBefore(IL(2026, 9, 22, 9, 15), 30)), '20.9 12:45');
});

test('new deal (1–3): Irit at once, at 5 minutes (the meeting date; v13: no group, no contract ring), Lior after 30 office minutes, the owner after an hour', () => {
  const w = world();
  const c = client(w, { name: 'פיצה', deal_at: IL(2026, 10, 5, 10).toISOString() });
  const now = one(due(w, IL(2026, 10, 5, 10)), 'deal', 'now', 'irit');
  assert.equal(now.level, 'ring');
  assert.equal(now.exempt, 'clock');
  assert.equal(now.escalation, 'lior');
  assert.match(now.title, /עסקה חדשה: פיצה/);
  // (v13: the contract's preparing and sending, and the group, 2, left the protocol: only the meeting's date is asked.)
  assert.equal(now.body, 'מועד אפיון עד היום 10:05.');
  none(due(w, IL(2026, 10, 5, 10, 4)), 'deal', 'due');
  const d = one(due(w, IL(2026, 10, 5, 10, 5)), 'deal', 'due', 'irit');
  assert.equal(d.body, 'עוד חסר: מועד אפיון.');
  // No ring about the contract at 10 minutes any more (v13: "החוזה נשלח" left the protocol).
  none(due(w, IL(2026, 10, 5, 10, 10)), 'deal', 'contract');
  none(due(w, IL(2026, 10, 5, 10, 29)), 'deal', 'lior');
  const l = one(due(w, IL(2026, 10, 5, 10, 30)), 'deal', 'lior', 'lior');
  assert.equal(l.exempt, null);
  assert.equal(l.body, 'עברו 30 דקות עבודה ועוד חסר: מועד אפיון.');
  assert.equal(one(due(w, IL(2026, 10, 5, 11)), 'deal', 'board', 'owner').level, 'board');
  // The signature alone does not stop it: the meeting's date does (docs/ops.md, section 47).
  marks(w, c, itemsOf('p01'), IL(2026, 10, 5, 10, 2));
  assert.equal(one(due(w, IL(2026, 10, 5, 10, 5)), 'deal', 'due').body, 'עוד חסר: מועד אפיון.');
  c.char_at = IL(2026, 10, 6, 10).toISOString();
  none(due(w, IL(2026, 10, 5, 11)), 'deal');
  // Each step once: a step in the log is not due again.
  const w2 = world();
  client(w2, { deal_at: IL(2026, 10, 5, 10).toISOString() });
  const first = due(w2, IL(2026, 10, 5, 10, 5)).filter((r) => r.rule === 'deal');
  assert.deepEqual(first.map((r) => r.step), ['now', 'due']);
  assert.deepEqual(due(w2, IL(2026, 10, 5, 10, 6), first.map((r) => r.key)).filter((r) => r.rule === 'deal'), []);
});

test('a deal at night: the 5-minute step is at 09:05 the next business day', () => {
  const w = world();
  client(w, { deal_at: IL(2026, 10, 8, 22).toISOString() }); // Thursday night
  none(due(w, IL(2026, 10, 11, 9, 4)), 'deal', 'due');
  assert.equal(hhmm(one(due(w, IL(2026, 10, 11, 9, 5)), 'deal', 'due').at), '11.10 09:05');
  // Lior: 30 office minutes from the deal, not from the 5-minute step.
  assert.equal(hhmm(one(due(w, IL(2026, 10, 11, 9, 30)), 'deal', 'lior').at), '11.10 09:30');
});

test('characterization: the evening before at 18:30 and an hour before; "ended" 15 minutes after its end', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 6, 11).toISOString(), address: 'הרצל 1' });
  importTo(w, c, 'char');
  none(due(w, IL(2026, 10, 5, 18, 29)), 'char', 'eve');
  const eve = one(due(w, IL(2026, 10, 5, 18, 30)), 'char', 'eve', 'ofir');
  assert.match(eve.title, /אפיון מחר 11:00/);
  assert.match(eve.body, /הרצל 1/);
  one(due(w, IL(2026, 10, 6, 10)), 'char', 'hour', 'ofir');
  // Once the meeting started, the kit is not sent any more.
  none(due(w, IL(2026, 10, 6, 11, 1)), 'char', 'eve');
  none(due(w, IL(2026, 10, 6, 11, 1)), 'char', 'hour');
  none(due(w, IL(2026, 10, 6, 13, 14)), 'char', 'end');
  one(due(w, IL(2026, 10, 6, 13, 15)), 'char', 'end', 'ofir');
  one(due(w, IL(2026, 10, 6, 13, 45)), 'char', 'irit', 'irit');
  // Ofir marked his part: nothing after the end.
  marks(w, c, PROCESSES.find((p) => p.id === 'p04').items.filter((i) => !i.owners).map((i) => i.key), IL(2026, 10, 6, 13));
  none(due(w, IL(2026, 10, 6, 13, 50)), 'char', 'end');
  // A Sunday meeting: the evening before is Thursday's; Lior when he characterizes.
  const w2 = world();
  client(w2, { char_at: IL(2026, 10, 11, 9, 30).toISOString(), characterizer: 'lior' });
  assert.equal(hhmm(one(due(w2, IL(2026, 10, 8, 18, 30)), 'char', 'eve', 'lior').at), '8.10 18:30');
});

test('"the meeting ended" starts the clocks of 6–10: one message each, and 30 minutes before the target', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 6, 10).toISOString() });
  importTo(w, c, 'char');
  marks(w, c, itemsOf('p04'), IL(2026, 10, 6, 12, 30));
  const at = due(w, IL(2026, 10, 6, 12, 30));
  const ilai = one(at, 'started', 'start', 'ilai');
  assert.equal(ilai.exempt, 'clock');
  // 9 has no clock since 11.11.2026 (the owner): it is in the message, without a time.
  assert.match(ilai.body, /הכנת 9 גרפיקות ראשונות עד היום 14:30 · פתיחת גאנט שנתי \(בלי זמן קצוב\)/);
  one(at, 'started', 'start', 'ofir');
  // v12: Lior's Meta check (10) left the protocol: no clock of his starts here.
  none(at.filter((r) => r.person === 'lior'), 'started');
  none(due(w, IL(2026, 10, 6, 13, 59)), 'started', 'pre30');
  const pre = due(w, IL(2026, 10, 6, 14));
  for (const p of ['ilai', 'ofir']) one(pre, 'started', 'pre30', p);
  none(pre.filter((r) => r.person === 'lior'), 'started');
  // Ofir's highlights are done: no reminder for him.
  marks(w, c, itemsOf('p08'), IL(2026, 10, 6, 13));
  none(due(w, IL(2026, 10, 6, 14)).filter((r) => r.person === 'ofir'), 'started');
  // Ilai's graphics (7) are done and only the gantt (9) is open: no "30 minutes left", no late, ever.
  marks(w, c, itemsOf('p07'), IL(2026, 10, 6, 13));
  none(due(w, IL(2026, 10, 6, 14)).filter((r) => r.person === 'ilai'), 'started', 'pre30');
  assert.equal(due(w, IL(2026, 10, 8, 17)).filter((r) => r.person === 'ilai' && /גאנט/.test(`${r.title} ${r.body}`) && /באיחור|איחור/.test(`${r.title} ${r.body}`)).length, 0);
  // Ended late in the day: the office clock runs on the next morning.
  const w2 = world();
  const c2 = client(w2, { char_at: IL(2026, 10, 6, 15).toISOString() });
  importTo(w2, c2, 'char');
  marks(w2, c2, itemsOf('p04'), IL(2026, 10, 6, 17, 30));
  assert.equal(hhmm(one(due(w2, IL(2026, 10, 7, 10)), 'started', 'pre30', 'ilai').at), '7.10 10:00');
  // An imported characterization starts nothing.
  const w3 = world();
  const c3 = client(w3);
  importTo(w3, c3, 'content');
  none(due(w3, IL(2026, 10, 6, 14)), 'started');
});

// Process 6 is Ofir's since 28.10.2026 (the owner; it was Ilai's).
test('access received: Ofir at once (30 minutes); Lior after 30 office minutes; stops when checked', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 6, 10).toISOString() });
  importTo(w, c, 'char');
  mark(w, c, 'p05.access', IL(2026, 10, 6, 12));
  const now = one(due(w, IL(2026, 10, 6, 12)), 'access', 'now', 'ofir');
  assert.equal(now.exempt, 'clock');
  assert.match(now.body, /יעד היום 12:30/);
  assert.equal(due(w, IL(2026, 10, 6, 12)).filter((r) => r.rule === 'access' && r.person === 'ilai').length, 0);
  none(due(w, IL(2026, 10, 6, 12, 29)), 'access', 'lior');
  const lior = one(due(w, IL(2026, 10, 6, 12, 30)), 'access', 'lior', 'lior');
  assert.equal(lior.body, 'עברו 30 דקות מקבלת הגישות ואופיר עוד לא סימן שבדק.');
  mark(w, c, 'p06.verified', IL(2026, 10, 6, 12, 20));
  none(due(w, IL(2026, 10, 6, 12, 30)), 'access');
});

test('broken access: Lior at once and after two office hours; the owner after a business day', () => {
  const w = world();
  const c = client(w, { name: 'מספרה' });
  importTo(w, c, 'content');
  w.access.push({ id: 'a1', client_id: c.id, network: 'instagram', status: 'broken', updated_at: IL(2026, 10, 6, 16).toISOString() });
  const now = one(due(w, IL(2026, 10, 6, 16)), 'broken', 'now', 'lior');
  assert.equal(now.body, 'Instagram. לתקן עם הלקוח ולעדכן בכספת.');
  assert.equal(now.url, `client.html?id=${c.id}#access`);
  none(due(w, IL(2026, 10, 6, 17, 59)), 'broken', 'again');
  one(due(w, IL(2026, 10, 6, 18)), 'broken', 'again', 'lior');
  assert.equal(one(due(w, IL(2026, 10, 7, 16)), 'broken', 'board', 'owner').level, 'board');
  w.access[0].status = 'ok';
  none(due(w, IL(2026, 10, 7, 16)), 'broken');
});

test('broken access: editing the row while it is still broken does not start the ladder again or delay the owner', () => {
  const w = world();
  const c = client(w, { name: 'מספרה' });
  importTo(w, c, 'content');
  const a = { id: 'a1', client_id: c.id, network: 'instagram', status: 'broken', broken_since: IL(2026, 10, 6, 16).toISOString(), updated_at: IL(2026, 10, 6, 16).toISOString() };
  w.access.push(a);
  const first = one(due(w, IL(2026, 10, 6, 16)), 'broken', 'now', 'lior');
  const log = candidates(buildEnv({ ...w, now: IL(2026, 10, 6, 18) })).map((r) => r.key); // "now" and "again" went out
  // Lior adds a note (a new password that still fails) the next morning.
  a.updated_at = IL(2026, 10, 7, 10).toISOString();
  const later = due(w, IL(2026, 10, 7, 10, 1), log);
  none(later, 'broken', 'now');
  none(later, 'broken', 'again');
  assert.equal(one(due(w, IL(2026, 10, 7, 16), log), 'broken', 'board', 'owner').key.split(':')[0], 'broken');
  assert.ok(candidates(buildEnv({ ...w, now: IL(2026, 10, 7, 16) })).some((r) => r.key === first.key));
});

test('9 graphics ready: Ofir alone is rung to check them (protocol v9); Irit is rung the moment he approved, with her own two office hours; waiting on the client or sending stops it', () => {
  const w = world();
  const c = client(w);
  importTo(w, c, 'char');
  mark(w, c, 'p07.made', IL(2026, 10, 7, 11));
  // The check itself: Ofir's fast ladder (tests/fast-ladder.test.mjs). Irit and Lior hear nothing of it.
  const ready = due(w, IL(2026, 10, 7, 11));
  one(ready, 'fast', 'now', 'ofir');
  none(ready, 'graphics9');
  assert.deepEqual(ready.filter((r) => ['irit', 'lior'].includes(r.person) && /גרפיקות/.test(r.title)), []);
  // He approves at 11:08: Irit rings at once, "לשלוח ללקוח", due two office hours later.
  for (const i of PROCESSES.find((p) => p.id === 'p07').items.filter((x) => x.key.startsWith('p07.r.') || x.key === 'p07.ofir')) mark(w, c, i.key, IL(2026, 10, 7, 11, 8));
  const ring = one(due(w, IL(2026, 10, 7, 11, 8)), 'graphics9', 'irit', 'irit');
  assert.equal(ring.title, `לשלוח ללקוח: 9 הגרפיקות · ${c.name}`);
  assert.match(ring.body, /^אופיר אישר\. יעד היום 13:08\.$/);
  none(due(w, IL(2026, 10, 7, 11, 8)), 'fast');
  none(due(w, IL(2026, 10, 7, 11, 30)), 'graphics9', 'lior');
  // Late with the sending: on Lior's screen (the rule `late`, 15 office minutes past her deadline), and no copy is sent (5.11.2026).
  assert.ok(onScreen(w, IL(2026, 10, 7, 13, 23)).some((r) => r.rule === 'late' && r.person === 'lior' && /7 · הכנת 9 גרפיקות ראשונות/.test(r.title)));
  none(due(w, IL(2026, 10, 7, 13, 23)), 'late');
  mark(w, c, 'p07.wait', IL(2026, 10, 7, 11, 9), JSON.stringify({ reason: 'הלקוח ביקש לחכות' }));
  none(due(w, IL(2026, 10, 7, 11, 30)), 'graphics9');
  delete w.checks[c.id]['p07.wait'];
  mark(w, c, 'p07.sent', IL(2026, 10, 7, 11, 20));
  none(due(w, IL(2026, 10, 7, 11, 30)), 'graphics9');
});

test('the client did not answer (7, 23, 26): no ring to call any more', () => {
  // (v13: "הלקוח לא הגיב ועירית התקשרה" left the protocol, and with it the call's clock and ring: CALL_CLOCKS.)
  const w = world();
  const c = client(w, { name: 'קפה' });
  importTo(w, c, 'char');
  mark(w, c, 'p07.sent', IL(2026, 10, 7, 11, 40));
  for (const m of [50, 59]) none(due(w, IL(2026, 10, 7, 11, m)), 'answer');
  const w2 = world();
  const c2 = client(w2, { rounds: [{ n: 2, shoot_type: 'dms', shoot_at: IL(2026, 10, 1, 10).toISOString(), start_at: IL(2026, 9, 28, 10).toISOString() }] });
  mark(w2, c2, 'r2.p26.sent', IL(2026, 10, 7, 11));
  none(due(w2, IL(2026, 10, 7, 11, 5)), 'answer');
});

test('setting the shoot day (11, v6): right after the group opens; Irit in the app, her digest, 16:00 on the due day; late to Ofir and Lior', () => {
  const w = world();
  // The group opened Sunday 4.10 at 11:00: the shoot day is due by the end of Monday 5.10 (before the meeting).
  const c = client(w, { deal_at: IL(2026, 10, 4, 10, 50).toISOString(), char_at: IL(2026, 10, 8, 10).toISOString() });
  marks(w, c, ['p01.prepared', 'p01.sent', 'p01.signed'], IL(2026, 10, 4, 10, 50));
  mark(w, c, 'p02.opened', IL(2026, 10, 4, 11));
  const start = one(due(w, IL(2026, 10, 4, 11)), 'shootDate', 'start', 'irit');
  assert.equal(start.level, 'quiet');
  assert.match(start.body, /יעד: מחר 18:00/);
  assert.match(one(due(w, IL(2026, 10, 5, 8, 30)), 'shootDate', 'd2026-10-05', 'irit').title, /יום צילום עוד לא נסגר \(יום 1\)/);
  none(due(w, IL(2026, 10, 5, 15, 59)), 'shootDate', 'due16');
  const ring = one(due(w, IL(2026, 10, 5, 16)), 'shootDate', 'due16', 'irit');
  assert.equal(ring.level, 'ring');
  // The next morning it is late: on Lior's screen only (the `late` rule, 15 office minutes into the day); nothing sent to the managers (5.11.2026).
  assert.ok(pick(onScreen(w, IL(2026, 10, 6, 9, 16)), 'late', 'lior').some((r) => r.key.includes(':p11@')));
  none(due(w, IL(2026, 10, 6, 9, 16)), 'late');
  // Waiting on the client stops it; so does closing the day.
  mark(w, c, 'p11.wait', IL(2026, 10, 5, 12), JSON.stringify({ reason: 'הלקוח בחו״ל' }));
  none(due(w, IL(2026, 10, 6, 8, 30)), 'shootDate');
});

test('setting the shoot day (11) for a client that started before v6: the old timing, 3 business days from the meeting', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 4, 10).toISOString(), protocol_version: 5 });
  importTo(w, c, 'content');
  // (v13: 11's one line, p11.date, is optional, so all its keys are taken back, not only the required ones.)
  for (const i of PROCESSES.find((p) => p.id === 'p11').items) delete w.checks[c.id][i.key];
  marks(w, c, itemsOf('p04'), IL(2026, 10, 4, 12)); // the meeting, done for real
  // It started when the meeting ended (charEnd), and is due the end of business day 3 (Wednesday 7.10).
  assert.match(one(due(w, IL(2026, 10, 5, 8, 30)), 'shootDate', 'd2026-10-05', 'irit').title, /יום 1/);
  none(due(w, IL(2026, 10, 6, 16)), 'shootDate', 'due16');
  one(due(w, IL(2026, 10, 7, 16)), 'shootDate', 'due16', 'irit');
});

test('scripts (12): due at the end of business day 2 (decision 14): a daily count for Lior; a ring at 12:00 on day 2', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 4, 10).toISOString() }); // Sunday
  importTo(w, c, 'content');
  for (const k of itemsOf('p12')) delete w.checks[c.id][k];
  assert.match(one(due(w, IL(2026, 10, 5, 8, 30)), 'scripts', 'd2026-10-05', 'lior').title, /יום 1 מתוך 2/);
  assert.match(one(due(w, IL(2026, 10, 6, 8, 30)), 'scripts', 'd2026-10-06', 'lior').title, /יום 2 מתוך 2/);
  none(due(w, IL(2026, 10, 6, 11, 59)), 'scripts', 'day2');
  const ring = one(due(w, IL(2026, 10, 6, 12)), 'scripts', 'day2', 'lior');
  assert.equal(ring.level, 'ring');
  assert.match(ring.body, /הזום מחר/);
  // Day 3 is the Zoom's: no scripts count any more (lateness goes the usual way).
  none(due(w, IL(2026, 10, 7, 8, 30)), 'scripts', 'd2026-10-07');
  marks(w, c, itemsOf('p12'), IL(2026, 10, 6, 11));
  none(due(w, IL(2026, 10, 6, 12)), 'scripts');
});

test('no client approval of the scripts (13): Lior and Irit 2 business days before; the owner 1 day before, even while waiting', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 10).toISOString() }); // Thursday
  importTo(w, c, 'content');
  delete w.checks[c.id]['p13.approved'];
  mark(w, c, 'p13.wait', IL(2026, 10, 12, 10), JSON.stringify({ reason: 'ממתינים לתשובה' }));
  none(due(w, IL(2026, 10, 13, 9, 59)), 'approval');
  const tue = due(w, IL(2026, 10, 13, 10));
  assert.equal(one(tue, 'approval', 'lior', 'lior').exempt, 'urgent');
  one(tue, 'approval', 'irit', 'irit');
  none(tue, 'approval', 'owner');
  const owner = one(due(w, IL(2026, 10, 14, 10)), 'approval', 'owner', 'owner');
  assert.equal(owner.level, 'ring');
  assert.match(owner.title, /צילום בסיכון/);
  mark(w, c, 'p13.approved', IL(2026, 10, 14, 9));
  none(due(w, IL(2026, 10, 14, 10)), 'approval');
  // A Sunday shoot: two business days before is Wednesday.
  const w2 = world();
  const c2 = client(w2, { shoot_at: IL(2026, 10, 18, 10).toISOString() });
  importTo(w2, c2, 'content');
  delete w2.checks[c2.id]['p13.approved'];
  assert.equal(hhmm(one(due(w2, IL(2026, 10, 14, 10)), 'approval', 'lior').at), '14.10 10:00');
  assert.equal(hhmm(one(due(w2, IL(2026, 10, 15, 10)), 'approval', 'owner').at), '15.10 10:00');
});

test('v12: the day before the shoot (15) and the photographer\'s briefing (16) left with Lior\'s shoot day: nobody is rung for them', () => {
  // The rules were Lior's 10:30 and 12:00, Irit's 11:15 check, the owner's 15:00 "shoot at risk", and
  // the 17:00 / 20:00 briefing to Lior and Eli. Eli's own day (17ב–19ב) still rings him: the next test.
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString(), address: 'רחוב הים 3' });
  importTo(w, c, 'shoot');
  for (const t of [IL(2026, 10, 14, 10, 30), IL(2026, 10, 14, 11, 15), IL(2026, 10, 14, 12), IL(2026, 10, 14, 15), IL(2026, 10, 14, 17), IL(2026, 10, 14, 20)]) {
    const at = due(w, t);
    none(at, 'eve');
    none(at, 'briefing');
  }
  // Lior's old marks of the eve change nothing either.
  mark(w, c, 'p16.brief', IL(2026, 10, 14, 17, 20), JSON.stringify({ label: 'כונן 3', notes: '' }));
  none(due(w, IL(2026, 10, 14, 17, 20)), 'briefing');
  // On erev chag the same: the business day before a Sunday shoot (Shavuot, Friday 11.6.2027).
  const w2 = world();
  const c2 = client(w2, { shoot_at: IL(2027, 6, 13, 11).toISOString(), contract_end: '2028-12-31' });
  importTo(w2, c2, 'shoot');
  none(due(w2, IL(2027, 6, 10, 15)), 'eve');
});

test('shoot day: Eli 2 hours and 15 minutes before, his end of the day; Lior if Eli did not arrive (v12: no time management of Lior\'s)', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString(), shoot_type: 'dms' });
  importTo(w, c, 'shoot');
  none(due(w, IL(2026, 10, 14, 20)), 'shoot');
  one(due(w, IL(2026, 10, 15, 9)), 'shoot', 'eli2h', 'eli');
  one(due(w, IL(2026, 10, 15, 10, 45)), 'shoot', 'eli15', 'eli');
  // (v13: Eli's "הגעתי", p17b.arrived, left the protocol, and with it Lior's "אלי עוד לא סימן הגעה".)
  none(due(w, IL(2026, 10, 15, 10, 15)), 'shoot', 'arrived');
  // Lior's managing of the day (18–21) left the protocol in v12: no "begin", "progress" or end of his.
  none(due(w, IL(2026, 10, 15, 11, 30)), 'shoot', 'begin');
  none(due(w, IL(2026, 10, 15, 15)), 'shoot', 'progress');
  const end = due(w, IL(2026, 10, 15, 16, 30));
  none(end, 'shoot', 'endLior');
  one(end, 'shoot', 'endEli', 'eli');
  // Natali: Eli's end after three hours; nothing of Lior's ("an hour left", the end).
  const w2 = world();
  const c2 = client(w2, { shoot_at: IL(2026, 10, 15, 11).toISOString(), shoot_type: 'natali' });
  importTo(w2, c2, 'shoot');
  none(due(w2, IL(2026, 10, 15, 13)), 'shoot', 'hourLeft');
  none(due(w2, IL(2026, 10, 15, 14)), 'shoot', 'endLior');
  one(due(w2, IL(2026, 10, 15, 14)), 'shoot', 'endEli', 'eli');
});

test('assign an editor (22א): Ofir alone, no clock and no ring per client (30.10.2026); the old rule is gone', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, c, 'post');
  for (const k of itemsOf('p22a')) delete w.checks[c.id][k];
  marks(w, c, itemsOf('p19'), IL(2026, 10, 15, 17));
  assert.ok(!RULES.some((r) => r.id === 'assign' || r.id === 'autoAssigned'));
  for (const t of [IL(2026, 10, 15, 17), IL(2026, 10, 15, 17, 10), IL(2026, 10, 15, 17, 15)]) none(due(w, t), 'fast');
  // The one thing said about it: Ofir's 12:00 on a working day (tests/assign-no-clock.test.mjs). Sunday 18.10.
  assert.deepEqual(due(w, IL(2026, 10, 18, 12)).filter((r) => r.clientId === c.id && /עורך/.test(r.title)), []);
  assert.equal(one(due(w, IL(2026, 10, 18, 12)), 'assign12', '1200', 'ofir').title, 'לקוח אחד מחכה לשיוך עורך');
  mark(w, c, 'p22a.assigned', IL(2026, 10, 18, 11));
  none(due(w, IL(2026, 10, 18, 12)), 'assign12');
});

test('editing (22, 24), a client from before protocol v11: assigned, days 2 and 3, day 3 at 15:00; no "not started" since v14', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString(), editor: 'nadia', protocol_version: 10 });
  importTo(w, c, 'post');
  for (const k of [...itemsOf('p22'), ...itemsOf('p24'), ...itemsOf('p22a')]) delete w.checks[c.id][k];
  mark(w, c, 'p22a.assigned', IL(2026, 10, 18, 10));
  const now = one(due(w, IL(2026, 10, 18, 10)), 'editing', 'assigned', 'nadia');
  assert.match(now.body, /בדרייב ואצל אופיר עד ד׳ 21\.10 18:00 · סגירה עד ה׳ 22\.10 18:00/);
  // Protocol v14: "התקבל הכונן" left, and with it "עוד לא התחלת" and Lior's and Ofir's "עריכה לא התחילה".
  for (const at of [IL(2026, 10, 18, 12), IL(2026, 10, 18, 14), IL(2026, 10, 19, 17)]) {
    for (const step of ['nostart', 'nostartLior', 'ofir']) none(due(w, at), 'editing', step);
  }
  assert.equal(one(due(w, IL(2026, 10, 20, 8, 30)), 'editing', 'day2', 'nadia').level, 'digest');
  one(due(w, IL(2026, 10, 21, 8, 30)), 'editing', 'day3', 'nadia');
  none(due(w, IL(2026, 10, 21, 14, 59)), 'editing', 'day3pm');
  one(due(w, IL(2026, 10, 21, 15)), 'editing', 'day3pm', 'nadia');
  // Ready for QA: done.
  // An old pause stops nothing since 5.11.2026: the editing rings go on.
  mark(w, c, 'p22.pause', IL(2026, 10, 19, 11), JSON.stringify({ reason: 'משימה דחופה' }));
  one(due(w, IL(2026, 10, 21, 15)), 'editing', 'day3pm', 'nadia');
  delete w.checks[c.id]['p22.pause'];
  mark(w, c, 'p24.notify', IL(2026, 10, 21, 12));
  none(due(w, IL(2026, 10, 21, 15)), 'editing');
});

test('editing since protocol v11: two business days; day 2 is the last, with its ring at 15:00 and no day 3', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString(), editor: 'nadia' });
  importTo(w, c, 'post');
  for (const k of [...itemsOf('p22'), ...itemsOf('p24'), ...itemsOf('p22a')]) delete w.checks[c.id][k];
  mark(w, c, 'p22a.assigned', IL(2026, 10, 18, 10));
  const now = one(due(w, IL(2026, 10, 18, 10)), 'editing', 'assigned', 'nadia');
  assert.match(now.body, /בדרייב ואצל אופיר עד ג׳ 20\.10 18:00 · סגירה עד ה׳ 22\.10 18:00/);
  const d2 = one(due(w, IL(2026, 10, 20, 8, 30)), 'editing', 'day2', 'nadia');
  assert.match(d2.title, /^עריכה, יום 2 מתוך 2: /);
  assert.equal(d2.body, 'עד סוף היום: הכול בדרייב ואצל אופיר.');
  none(due(w, IL(2026, 10, 20, 14, 59)), 'editing', 'day2pm');
  assert.equal(one(due(w, IL(2026, 10, 20, 15)), 'editing', 'day2pm', 'nadia').level, 'ring');
  none(due(w, IL(2026, 10, 21, 15)), 'editing', 'day3');
  none(due(w, IL(2026, 10, 21, 15)), 'editing', 'day3pm');
});

test('ready for QA (24→25): Ofir at once and after 40 office minutes, paused while he is in a characterization; Lior after an hour', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString(), editor: 'yariv' });
  importTo(w, c, 'post');
  for (const k of itemsOf('p25')) delete w.checks[c.id][k];
  mark(w, c, 'p24.notify', IL(2026, 10, 21, 11));
  one(due(w, IL(2026, 10, 21, 11)), 'qa', 'now', 'ofir');
  one(due(w, IL(2026, 10, 21, 11, 40)), 'qa', 'again', 'ofir');
  // Irit hears both too (5.11.2026: she reviews as Ofir does).
  one(due(w, IL(2026, 10, 21, 11)), 'qa', 'now', 'irit');
  one(due(w, IL(2026, 10, 21, 11, 40)), 'qa', 'again', 'irit');
  assert.equal(one(due(w, IL(2026, 10, 21, 12)), 'qa', 'lior', 'lior').list, true);
  // Ofir characterizes another client 11:20–13:20: the 40 minutes end at 13:40.
  const other = client(w, { char_at: IL(2026, 10, 21, 11, 20).toISOString() });
  importTo(w, other, 'char');
  none(due(w, IL(2026, 10, 21, 13, 39)), 'qa', 'again');
  assert.equal(hhmm(one(due(w, IL(2026, 10, 21, 13, 40)), 'qa', 'again', 'ofir').at), '21.10 13:40');
  // He marked the meeting done at 12:20: the clock runs again from then (12:40).
  marks(w, other, itemsOf('p04'), IL(2026, 10, 21, 12, 20));
  assert.equal(hhmm(one(due(w, IL(2026, 10, 21, 12, 40)), 'qa', 'again', 'ofir').at), '21.10 12:40');
  mark(w, c, 'p25.approved', IL(2026, 10, 21, 11, 30));
  none(due(w, IL(2026, 10, 21, 12)), 'qa');
});

test('Ofir approved (25): Irit rings "send now", Lior quietly "campaign"; the rest of the graphics', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, c, 'post');
  for (const k of [...itemsOf('p25'), ...itemsOf('p26'), 'p23.ofir', 'p23.sent']) delete w.checks[c.id][k];
  mark(w, c, 'p25.approved', IL(2026, 10, 21, 12));
  const at = due(w, IL(2026, 10, 21, 12));
  assert.equal(one(at, 'approved', 'irit', 'irit').level, 'ring');
  assert.equal(one(at, 'approved', 'lior', 'lior').level, 'quiet');
  mark(w, c, 'p26.sent', IL(2026, 10, 21, 12, 10));
  none(due(w, IL(2026, 10, 21, 12, 30)), 'approved', 'irit');
  // p23: Ilai marks ready → Ofir (his fast ladder, protocol v9); Ofir approves → Irit.
  mark(w, c, 'p23.made', IL(2026, 10, 21, 13));
  assert.equal(one(due(w, IL(2026, 10, 21, 13)), 'fast', 'now', 'ofir').title, `יתרת הגרפיקות מוכנה לבדיקה: ${c.name}`);
  none(due(w, IL(2026, 10, 21, 13)), 'graphicsRest');
  mark(w, c, 'p23.ofir', IL(2026, 10, 21, 13, 8));
  const g = due(w, IL(2026, 10, 21, 13, 8));
  none(g, 'fast');
  one(g, 'graphicsRest', 'irit', 'irit');
});

test('scheduling and Gantt (28–29): two hours for Ilai with 30 minutes before, across the move to winter time; then Irit', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, c, 'ongoing');
  for (const k of ['p27', 'p28', 'p29'].flatMap((id) => PROCESSES.find((p) => p.id === id).items.map((i) => i.key))) delete w.checks[c.id][k];
  // Sunday 25.10.2026, the first day of winter time.
  marks(w, c, itemsOf('p27'), IL(2026, 10, 25, 10));
  assert.equal(one(due(w, IL(2026, 10, 25, 10)), 'publish', 'start', 'ilai').exempt, 'clock');
  none(due(w, IL(2026, 10, 25, 11, 29)), 'publish', 'pre30');
  assert.equal(hhmm(one(due(w, IL(2026, 10, 25, 11, 30)), 'publish', 'pre30', 'ilai').at), '25.10 11:30');
  mark(w, c, 'p29.filled', IL(2026, 10, 25, 11, 45));
  one(due(w, IL(2026, 10, 25, 11, 45)), 'publish', 'gantt', 'irit');
  mark(w, c, 'p29.sent', IL(2026, 10, 25, 11, 50));
  none(due(w, IL(2026, 10, 25, 11, 55)), 'publish', 'gantt');
});

test('weekly call (31) left the protocol in v12: no digest, no Thursday ring, nothing on the owner\'s screen', () => {
  const w = world();
  const c = client(w, { name: 'לקוח שוטף' });
  importTo(w, c, 'ongoing');
  marks(w, c, itemsOf('p30'), IL(2026, 9, 20, 10));
  for (const t of [IL(2026, 10, 4, 8, 30), IL(2026, 10, 7, 8, 30), IL(2026, 10, 8, 12), IL(2026, 10, 8, 18)]) none(due(w, t), 'weekly');
  mark(w, c, 'p31.call', IL(2026, 10, 7, 12));
  none(due(w, IL(2026, 10, 8, 18)), 'weekly');
  none(due(w, IL(2026, 10, 8, 10)), 'callFollowup');
});

test('daily messages, daily control (32) and the clients review (33)', () => {
  const w = world();
  const a = client(w, { name: 'א' });
  const b = client(w, { name: 'ב' });
  importTo(w, a, 'ongoing');
  importTo(w, b, 'ongoing');
  // The daily messages queue is off since 9.11.2026 (Irit: "מיותר"): no list, no 14:00 line.
  none(due(w, IL(2026, 10, 5, 8, 30)), 'dailyMessages');
  const at14 = due(w, IL(2026, 10, 5, 14));
  none(at14, 'dailyMessages');
  assert.equal(one(at14, 'control32', '1400', 'irit').level, 'ring');
  assert.equal(one(due(w, IL(2026, 10, 5, 18)), 'control32', 'lior', 'lior').list, true);
  w.reviews.push({ day: '2026-10-05', kind: 'p32' });
  none(due(w, IL(2026, 10, 5, 14)), 'control32');
  // The pass over the clients (33), Irit's since 26.10.2026 (the owner; Ofir's until then), last
  // on Thursday 1.10: due Monday (2 business days), late on Tuesday, for her alone: nobody else
  // hears of it (Lior's list had it), and nobody else's list counts it.
  w.reviews.push({ day: '2026-10-01', kind: 'p33' });
  one(due(w, IL(2026, 10, 5, 8, 30)), 'control33', 'due', 'irit');
  none(due(w, IL(2026, 10, 5, 8, 30)), 'control33', 'late');
  const late33 = one(due(w, IL(2026, 10, 6, 8, 30)), 'control33', 'late', 'irit');
  assert.equal(late33.overdue, true);
  assert.equal(late33.list, false);
  for (const at of [IL(2026, 10, 5, 8, 30), IL(2026, 10, 6, 8, 30), IL(2026, 10, 6, 16)]) {
    assert.deepEqual(due(w, at).filter((r) => r.rule === 'control33' && r.person !== 'irit').map((r) => r.key), []);
  }
  w.reviews.push({ day: '2026-10-05', kind: 'p33' });
  none(due(w, IL(2026, 10, 6, 8, 30)), 'control33');
  // Not on a Friday.
  none(due(w, IL(2026, 10, 9, 14)), 'dailyMessages');
});

// The Thursday summaries are part of the pass (33): Irit's since 26.10.2026 (Ofir's until then),
// and nobody else's (Lior's list and the owner's board had them).
test('Thursday summaries: 09:00 Irit, 13:00 her target (quiet, late); nobody else is told', () => {
  const w = world();
  const a = client(w);
  importTo(w, a, 'ongoing');
  one(due(w, IL(2026, 10, 8, 9)), 'thursday', '0900', 'irit');
  const at13 = due(w, IL(2026, 10, 8, 13));
  const t13 = one(at13, 'thursday', '1300', 'irit');
  assert.equal(t13.level, 'quiet');
  assert.equal(t13.overdue, true);
  for (const at of [IL(2026, 10, 8, 9), IL(2026, 10, 8, 13), IL(2026, 10, 8, 16), IL(2026, 10, 8, 18)]) {
    assert.deepEqual(due(w, at).filter((r) => r.rule === 'thursday' && r.person !== 'irit').map((r) => r.key), []);
  }
  w.statusNotes.push({ client_id: a.id, week: '2026-10-04' });
  none(due(w, IL(2026, 10, 8, 18)), 'thursday');
  none(due(w, IL(2026, 10, 7, 13)), 'thursday');
});

test('urgent task: the owner of it at once, Lior after 30 office minutes without "התחלתי", the owner after 4 office hours', () => {
  const w = world();
  const c = client(w, { name: 'דחוף' });
  importTo(w, c, 'ongoing');
  w.tasks.push({ id: 't1', client_id: c.id, title: 'לתקן לוגו', owner: 'ilai', urgent: true, created_at: IL(2026, 10, 5, 10).toISOString(), created_by_email: 'lior@x' });
  const now = one(due(w, IL(2026, 10, 5, 10)), 'urgent', 'now', 'ilai');
  assert.equal(now.exempt, 'urgent');
  assert.equal(now.url, `client.html?id=${c.id}#tasks`);
  none(due(w, IL(2026, 10, 5, 10, 29)), 'urgent', 'lior');
  one(due(w, IL(2026, 10, 5, 10, 30)), 'urgent', 'lior', 'lior');
  none(due(w, IL(2026, 10, 5, 13, 59)), 'urgent', 'owner');
  one(due(w, IL(2026, 10, 5, 14)), 'urgent', 'owner', 'owner');
  // Started: Lior is not called; open four hours still reaches the owner.
  w.tasks[0].started_at = IL(2026, 10, 5, 10, 10).toISOString();
  none(due(w, IL(2026, 10, 5, 10, 30)), 'urgent', 'lior');
  one(due(w, IL(2026, 10, 5, 14)), 'urgent', 'owner');
  w.tasks[0].done_at = IL(2026, 10, 5, 12).toISOString();
  none(due(w, IL(2026, 10, 5, 14)), 'urgent');
});

test('decision 8: on Lior\'s shoot day his exceptions go to Ofir', () => {
  const w = world();
  const shoot = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, shoot, 'shoot');
  const other = client(w, { name: 'אחר' });
  importTo(w, other, 'ongoing');
  w.tasks.push({ id: 't9', client_id: other.id, title: 'לקוח כועס', owner: 'lior', source: 'escalation', urgent: true, created_at: IL(2026, 10, 15, 12).toISOString() });
  // The quiet mode is a recorded flag. Since v12 (Lior's shoot day left the protocol) only Lior's own
  // start makes it: Eli's "הגעתי" no longer does.
  assert.equal(buildEnv({ ...w, now: IL(2026, 10, 15, 12) }).liorShoot.active, false);
  assert.equal(one(due(w, IL(2026, 10, 15, 12)), 'urgent', 'now').person, 'lior');
  mark(w, shoot, 'p17b.arrived', IL(2026, 10, 15, 10, 5));
  assert.equal(buildEnv({ ...w, now: IL(2026, 10, 15, 12) }).liorShoot.active, false);
  assert.equal(one(due(w, IL(2026, 10, 15, 12)), 'urgent', 'now').person, 'lior');
  mark(w, shoot, 'p18.quiet', IL(2026, 10, 15, 10, 5));
  // Not before the moment it was made.
  assert.equal(buildEnv({ ...w, now: IL(2026, 10, 15, 10) }).liorShoot.active, false);
  const env = buildEnv({ ...w, now: IL(2026, 10, 15, 12) });
  assert.equal(env.liorShoot.active, true);
  const list = computeReminders({ env });
  const r = one(list, 'urgent', 'now', 'ofir');
  assert.match(r.title, /^ליאור ביום צילום · משימה דחופה: אחר/);
  assert.match(r.key, /@lior$/); // still Lior's step: it goes out once
  // "ליאור מקבל סיכום בסוף היום": a copy for Lior, held for his summary, never pushed.
  const copy = one(list, 'urgent', 'now', 'lior');
  assert.equal(copy.key, `${r.key}+shoot`);
  assert.match(copy.title, /^הועבר לאופיר · משימה דחופה: אחר/);
  const [held] = planDelivery({ reminders: [copy], now: env.now, log: [], liorShoot: env.liorShoot });
  assert.deepEqual([held.channel, held.status, held.reason], ['digest', 'queued', 'shoot_mode']);
  // An exception Lior already got before the shoot is not copied into his summary.
  assert.equal(computeReminders({ env, log: [r.key] }).filter((x) => x.rule === 'urgent' && x.step === 'now').length, 0);
  // Once the drive is back, confirmed by both Eli and Lior, Lior again (before the day is closed).
  mark(w, shoot, 'p19b.handed', IL(2026, 10, 15, 15));
  assert.equal(buildEnv({ ...w, now: IL(2026, 10, 15, 15, 30) }).liorShoot.active, true);
  mark(w, shoot, 'p19.took', IL(2026, 10, 15, 15, 10));
  assert.equal(buildEnv({ ...w, now: IL(2026, 10, 15, 15, 30) }).liorShoot.active, false);
  assert.equal(one(due(w, IL(2026, 10, 15, 16)), 'urgent', 'now').person, 'lior');
  // Lior starts it himself (p18.quiet) when Eli has not marked yet. Since v12 nobody closes the day
  // (19): it ends when he takes it off, or with the day.
  const w2 = world();
  const s2 = client(w2, { shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w2, s2, 'shoot');
  mark(w2, s2, 'p18.quiet', IL(2026, 10, 15, 9, 50));
  assert.equal(buildEnv({ ...w2, now: IL(2026, 10, 15, 9, 55) }).liorShoot.active, true);
  assert.equal(buildEnv({ ...w2, now: IL(2026, 10, 15, 23, 50) }).liorShoot.active, true);
  assert.equal(buildEnv({ ...w2, now: IL(2026, 10, 16, 0, 5) }).liorShoot.active, false);
  delete w2.checks[s2.id]['p18.quiet'];
  assert.equal(buildEnv({ ...w2, now: IL(2026, 10, 15, 12) }).liorShoot.active, false);
});

test('exception to Lior (not urgent): his list at once, the owner\'s screen after a business day', () => {
  const w = world();
  const c = client(w);
  importTo(w, c, 'ongoing');
  w.tasks.push({ id: 'e1', client_id: c.id, title: 'עובד לא עומד בזמן', owner: 'lior', source: 'escalation', urgent: false, created_at: IL(2026, 10, 5, 10).toISOString() });
  const l = one(due(w, IL(2026, 10, 5, 10)), 'exception', 'list', 'lior');
  assert.equal(l.level, 'digest');
  assert.equal(l.list, true);
  one(due(w, IL(2026, 10, 6, 10)), 'exception', 'board', 'owner');
});

test('ordinary task: quiet when created, the morning it is due; a day late: Ofir and Lior (quiet), and the ladder of a late item for its owner and whoever opened it', () => {
  const w = world();
  const c = client(w, { name: 'משימות' });
  importTo(w, c, 'ongoing');
  w.tasks.push({ id: 'r1', client_id: c.id, title: 'לשלוח חשבונית', owner: 'irit', due_on: '2026-10-06', urgent: false, created_at: IL(2026, 10, 5, 11).toISOString(), created_by_email: 'lior@x' });
  assert.equal(one(due(w, IL(2026, 10, 5, 11)), 'task', 'created', 'irit').level, 'quiet');
  none(due(w, IL(2026, 10, 6, 8, 29)), 'task', 'due');
  assert.equal(one(due(w, IL(2026, 10, 6, 8, 30)), 'task', 'due', 'irit').level, 'digest');
  none(due(w, IL(2026, 10, 7, 9, 14)), 'task', 'late');
  const late = due(w, IL(2026, 10, 7, 9, 15));
  // Since 5.11.2026 (section 100) no copy to Ofir and Lior: only on Lior's screen.
  none(late, 'task', 'late');
  assert.equal(pick(onScreen(w, IL(2026, 10, 7, 9, 15)), 'task', 'late', 'lior').length, 1);
  // 8.10.2026 (docs/ops.md, section 48): its owner rings "באיחור" at the same moment, not a quiet line.
  assert.equal(pick(late, 'task', 'late', 'irit').length, 0);
  assert.deepEqual([one(late, 'lateOwn', 'own', 'irit').level, one(late, 'lateOwn', 'own', 'irit').batch], ['ring', true]);
  // No per-item list for Lior two days later: from 24 hours late it is in the owner's summary.
  none(due(w, IL(2026, 10, 8, 8, 30)), 'task', 'lior');
  // Her own task: no "new task" note to herself.
  w.tasks.push({ id: 'r2', client_id: c.id, title: 'לעצמי', owner: 'irit', urgent: false, created_at: IL(2026, 10, 5, 11).toISOString(), created_by_email: 'irit@x' });
  assert.equal(pick(due(w, IL(2026, 10, 5, 11)), 'task', 'created').filter((r) => r.key.includes(':r2:')).length, 0);
});

test('renewal (34): Lior and Irit 75, 60 and 45 days before in the digest; the owner 30 days before without a call', () => {
  const w = world();
  const c = client(w, { contract_end: '2027-01-15' });
  importTo(w, c, 'ongoing');
  const d75 = due(w, IL(2026, 11, 1, 8, 30));
  assert.equal(one(d75, 'renewal', 'd75', 'lior').level, 'digest');
  one(d75, 'renewal', 'd75', 'irit');
  one(due(w, IL(2026, 11, 16, 8, 30)), 'renewal', 'd60', 'lior');
  one(due(w, IL(2026, 12, 1, 8, 30)), 'renewal', 'd45', 'irit');
  none(due(w, IL(2026, 12, 16, 9, 59)), 'renewal', 'owner30');
  const o = one(due(w, IL(2026, 12, 16, 10)), 'renewal', 'owner30', 'owner');
  assert.equal(o.level, 'ring');
  assert.match(o.body, /15\.1\.2027/);
  mark(w, c, 'p34.talk', IL(2026, 12, 10, 10));
  none(due(w, IL(2026, 12, 16, 10)), 'renewal');
  c.status = 'ending';
  delete w.checks[c.id]['p34.talk'];
  none(due(w, IL(2026, 12, 16, 10)), 'renewal');
});

test('staff not connected to notifications: Irit\'s morning digest', () => {
  const w = world();
  w.staff = STAFF.filter((s) => ['irit', 'lior', null].includes(s.person));
  w.subscriptions = [{ id: 's1', email: 'irit@x' }];
  const r = one(due(w, IL(2026, 10, 5, 8, 30)), 'unconnected', 'list', 'irit');
  assert.equal(r.title, 'לא מחוברים להתראות: ליאור');
  w.subscriptions.push({ id: 's2', email: 'lior@x' });
  none(due(w, IL(2026, 10, 5, 8, 30)), 'unconnected');
});

test('lateness (3.10.2026; since 5.11.2026 on Lior screen only): every late item listed once per deadline, nothing sent, no per-item board line', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 6, 10).toISOString() });
  importTo(w, c, 'char');
  marks(w, c, itemsOf('p04'), IL(2026, 10, 6, 12));
  none(due(w, IL(2026, 10, 6, 14, 14)).filter((r) => /:p0[78]@|:p10@/.test(r.key)), 'late'); // not in the minute the deadline passes
  const at = due(w, IL(2026, 10, 6, 14, 16));
  // (Lior's own Meta check, 10, left the protocol in v12: it is late for nobody.)
  assert.ok(!at.some((r) => r.key.includes(':p10@')));
  // Since 5.11.2026 (section 100): nothing sent to Ofir or Lior; Lior's screen lists both.
  none(at, 'late');
  for (const proc of ['p07', 'p08']) { // Ilai's and Ofir's own
    const r = pick(onScreen(w, IL(2026, 10, 6, 14, 16)), 'late', 'lior').find((x) => x.key.includes(`:${proc}@`));
    assert.ok(r, `${proc} late: lior's screen`);
    assert.equal(r.overdue, true);
  }
  none(at, 'late', 'board');
  const scr = onScreen(w, IL(2026, 10, 6, 14, 16));
  assert.match(pick(scr, 'late', 'lior').find((r) => r.key.includes(':p08@')).title, /באיחור: .* · 8 · הכנת Highlights · אופיר/);
  // Editing late: on Lior's screen, naming the editor; nothing sent to Ofir or Lior (5.11.2026).
  const w2 = world();
  const e = client(w2, { shoot_at: IL(2026, 10, 15, 11).toISOString(), editor: 'anna' });
  importTo(w2, e, 'post');
  for (const k of [...itemsOf('p22'), ...itemsOf('p22a')]) delete w2.checks[e.id][k];
  mark(w2, e, 'p22a.assigned', IL(2026, 10, 18, 10));
  none(due(w2, IL(2026, 10, 22, 9, 16)), 'late');
  assert.match(pick(onScreen(w2, IL(2026, 10, 22, 9, 16)), 'late', 'lior').find((r) => r.key.includes(':p22@')).title, /אנה/);
});

test('"לדחות עד…": what came due meanwhile waits for that moment, as one step', () => {
  const w = world();
  const c = client(w);
  importTo(w, c, 'char');
  // (Since protocol v9 the rule `graphics9` is Irit's "send them", from Ofir's approval.)
  mark(w, c, 'p07.made', IL(2026, 10, 7, 10, 55));
  mark(w, c, 'p07.ofir', IL(2026, 10, 7, 11));
  mark(w, c, SNOOZE('p07'), IL(2026, 10, 7, 11, 1), IL(2026, 10, 7, 13).toISOString());
  none(due(w, IL(2026, 10, 7, 12, 59)), 'graphics9');
  const at13 = due(w, IL(2026, 10, 7, 13)).filter((r) => r.rule === 'graphics9');
  assert.deepEqual(at13.map((r) => r.step), ['irit']);
  assert.equal(hhmm(at13[0].at), '7.10 13:00');
});

test('cancelled and ended clients get no reminders; imported history starts no ladder', () => {
  const w = world();
  client(w, { status: 'cancelled', deal_at: IL(2026, 10, 5, 10).toISOString() });
  client(w, { status: 'ended', deal_at: IL(2026, 10, 5, 10).toISOString() });
  assert.deepEqual(due(w, IL(2026, 10, 5, 10, 5)).filter((r) => r.clientId), []);
  const w2 = world();
  const c = client(w2);
  importTo(w2, c, 'ongoing');
  marks(w2, c, itemsOf('p30'), IL(2026, 9, 1, 9), IMPORT_NOTE);
  // The monthly cycle (stage 5, rules month*) is this month's work, not imported history.
  const list = candidates(buildEnv({ ...w2, now: IL(2026, 10, 7, 11) })).filter((r) => r.clientId === c.id && !r.rule.startsWith('month'));
  assert.deepEqual([...new Set(list.map((r) => r.rule))].sort(), []); // (the weekly call, 31, left in v12)
});

test('contract sent, not signed (1): no ring any more', () => {
  // (v13: "החוזה נשלח", p01.sent, left the protocol, and with it this ring; the unsigned agreement has its own, 'unsigned'.)
  const w = world();
  const c = client(w, { deal_at: IL(2026, 10, 5, 9).toISOString() });
  marks(w, c, ['p01.prepared', 'p01.sent'], IL(2026, 10, 5, 10));
  for (const t of [IL(2026, 10, 5, 14), IL(2026, 10, 6, 10)]) none(due(w, t), 'contract');
  assert.equal(c.id.length > 0, true);
});

test('group opened (2): nothing any more', () => {
  // (v13: the WhatsApp group, 2, left the protocol whole: no board line about the introduction.)
  const w = world();
  const c = client(w, { deal_at: IL(2026, 10, 5, 9).toISOString() });
  mark(w, c, 'p02.opened', IL(2026, 10, 5, 10));
  for (const t of [IL(2026, 10, 5, 10), IL(2026, 10, 5, 11)]) none(due(w, t), 'group');
});

test('access after the meeting: a new logo for Ilai; no vault ring for Irit (v13)', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 6, 10).toISOString(), has_logo: false });
  importTo(w, c, 'char');
  marks(w, c, itemsOf('p04'), IL(2026, 10, 6, 12, 30));
  assert.equal(one(due(w, IL(2026, 10, 6, 12, 30)), 'vault', 'logo', 'ilai').level, 'quiet');
  // (v13: "כל הגישות הוכנסו לכספת", p05.vault, left the protocol, and with it Irit's quiet note 30 minutes after.)
  none(due(w, IL(2026, 10, 6, 13)), 'vault', 'irit');
});

test('Natali (11ב) left the protocol in v12 with Lior\'s shoot day: no ring to Lior, Irit or the owner', () => {
  const w = world();
  const c = client(w, { shoot_type: 'natali', shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, c, 'content');
  for (const k of itemsOf('p11')) delete w.checks[c.id][k];
  marks(w, c, itemsOf('p11'), IL(2026, 10, 11, 10));
  none(due(w, IL(2026, 10, 11, 10)), 'natali');
  none(due(w, IL(2026, 10, 12, 10)), 'natali');
});

test('focus call (12א) left in v12; shoot blockers (14) left on 5.11.2026: no line, no ring', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 4, 10).toISOString(), shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, c, 'shoot');
  for (const k of [...itemsOf('p08'), ...PROCESSES.find((p) => p.id === 'p14').items.map((i) => i.key)]) delete w.checks[c.id][k];
  none(due(w, IL(2026, 10, 5, 8, 30)), 'focusCall');
  // The Highlights (8) are late: that is Ofir's own lateness, not a blocker of the shoot day.
  none(due(w, IL(2026, 10, 12, 8, 30)), 'blockers');
  none(due(w, IL(2026, 10, 13, 10)), 'blockers');
});

test('after the shoot: the rest of the graphics; the cards once Eli handed the drive (v12: nobody closes the day, no "not closed")', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, c, 'post');
  for (const k of Object.keys(w.checks[c.id])) if (/^p(19b?|23)\./.test(k)) delete w.checks[c.id][k];
  const sun = due(w, IL(2026, 10, 18, 8, 30));
  none(sun, 'shootOpen');
  one(sun, 'graphicsRestStart', 'next', 'ilai');
  // Eli's list done: he may format the cards (until v12 it waited for Lior's "הכונן חזר", p19.took).
  marks(w, c, itemsOf('p19b'), IL(2026, 10, 15, 17));
  assert.equal(one(due(w, IL(2026, 10, 15, 17)), 'cards', 'eli', 'eli').level, 'quiet');
});

test('an old editing pause rings nobody (5.11.2026: nothing stops the editing)', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString(), editor: 'nirel', shoot_type: 'natali' });
  importTo(w, c, 'post');
  for (const k of itemsOf('p22')) delete w.checks[c.id][k];
  mark(w, c, 'p22.pause', IL(2026, 10, 18, 11), JSON.stringify({ reason: 'משימה דחופה' }));
  none(due(w, IL(2026, 10, 18, 11)), 'paused');
  none(due(w, IL(2026, 10, 19, 8, 30)), 'paused');
});

test('client notes by day 4 (Irit), campaign the next business day and Tuesday\'s campaign check (Lior); no call follow-up since v12', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString(), editor: 'nadia' });
  importTo(w, c, 'post');
  for (const k of [...itemsOf('p27'), 'p27.notes', ...itemsOf('p30'), ...itemsOf('p25')]) delete w.checks[c.id][k];
  mark(w, c, 'p22a.assigned', IL(2026, 10, 18, 10));
  mark(w, c, 'p26.sent', IL(2026, 10, 21, 13));
  one(due(w, IL(2026, 10, 22, 8, 30)), 'clientNotes', 'day4', 'irit');
  mark(w, c, 'p25.approved', IL(2026, 10, 21, 12));
  one(due(w, IL(2026, 10, 22, 8, 30)), 'campaign', 'next', 'lior');
  const w2 = world();
  const d = client(w2, { name: 'שוטף' });
  importTo(w2, d, 'ongoing');
  marks(w2, d, itemsOf('p30'), IL(2026, 9, 1, 9), IMPORT_NOTE);
  assert.equal(one(due(w2, IL(2026, 10, 6, 8, 30)), 'campaignCheck', 'tue', 'lior').body, 'שוטף');
  none(due(w2, IL(2026, 10, 7, 8, 30)), 'campaignCheck');
  // The weekly call (31) left in v12: a call recorded anyway opens no follow-up for Irit.
  mark(w2, d, 'p31.call', IL(2026, 10, 7, 12));
  none(due(w2, IL(2026, 10, 7, 12)), 'callFollowup');
});

test('ending (35): Lior\'s digest the day before, a ring on the last day; late closing reaches Ofir and Lior', () => {
  const w = world();
  const c = client(w, { status: 'ending', contract_end: '2026-10-15' });
  importTo(w, c, 'ongoing');
  one(due(w, IL(2026, 10, 14, 8, 30)), 'ending', 'lior', 'lior');
  one(due(w, IL(2026, 10, 15, 10)), 'ending', 'day', 'lior');
  assert.ok(pick(onScreen(w, IL(2026, 10, 18, 9, 16)), 'late', 'lior').some((r) => r.key.includes(':p35@'))); // Sunday: 15 office minutes after the end of Thursday; Lior's screen (5.11.2026)
});

test('"אין מי שייצא לאפיון" rings for Lior; Ilai\'s late graphics go to Lior\'s list', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 6, 10).toISOString() });
  importTo(w, c, 'char');
  w.tasks.push({ id: 'n1', client_id: c.id, title: 'אין מי שייצא לאפיון: מחר 10:00, הרצל 1', owner: 'lior', source: 'escalation', urgent: false, created_at: IL(2026, 10, 5, 10).toISOString() });
  const r = one(due(w, IL(2026, 10, 5, 10)), 'exception', 'nobody', 'lior');
  assert.equal(r.level, 'ring');
  assert.equal(r.body, 'מחר 10:00, הרצל 1');
  none(due(w, IL(2026, 10, 5, 10)), 'exception', 'list');
  marks(w, c, itemsOf('p04'), IL(2026, 10, 6, 10));
  assert.ok(pick(onScreen(w, IL(2026, 10, 6, 12, 16)), 'late', 'lior').some((r2) => r2.key.includes(':p07@')));
});

// Found live (6.10.2026): "בעוד שעה אפיון" went out 1 minute before the meeting, and
// "בעוד שעתיים המשפיענים מגיעים" 49 minutes before the shoot (both were created close
// to their time).
test('a reminder "X before" that goes out late is worded by the time really left; never once the event began', () => {
  const at = IL(2026, 10, 6, 11);
  assert.deepEqual([60, 59, 12, 2, 1, 0, -3].map((m) => inTimeWords(at, new Date(at.getTime() - m * 6e4))),
    ['בעוד שעה', 'בעוד 59 דקות', 'בעוד 12 דקות', 'בעוד 2 דקות', 'בעוד דקה', 'עכשיו', 'עכשיו']);
  assert.deepEqual([120, 109, 61, 180].map((m) => inTimeWords(at, new Date(at.getTime() - m * 6e4))), ['בעוד שעתיים', 'בעוד שעה ו־49 דקות', 'בעוד שעה ו־דקה', 'בעוד 3 שעות']);
  assert.deepEqual([60, 56, 55, 54, 1].map((m) => sentOnTime(at, new Date(at.getTime() - m * 6e4), 60)), [true, true, true, false, false]);

  const w = world();
  const c = client(w, { name: 'קפה דנה', char_at: at.toISOString(), address: 'הרצל 1' });
  importTo(w, c, 'char');
  const title = (h, m) => one(due(w, IL(2026, 10, 6, h, m)), 'char', 'hour', 'ofir').title;
  // On time (the cron runs every minute; a few minutes of delay keep the usual words).
  assert.equal(title(10, 0), 'בעוד שעה אפיון: קפה דנה');
  assert.equal(title(10, 4), 'בעוד שעה אפיון: קפה דנה');
  // The meeting was put in the card at 10:48, or 10:59: the real time left.
  assert.equal(title(10, 48), 'האפיון מתחיל בעוד 12 דקות: קפה דנה');
  assert.equal(title(10, 59), 'האפיון מתחיל בעוד דקה: קפה דנה');
  // From its start on it is not sent at all.
  none(due(w, IL(2026, 10, 6, 11, 0)), 'char', 'hour');
  none(due(w, IL(2026, 10, 6, 11, 20)), 'char', 'hour');

  const w2 = world();
  const s = client(w2, { name: 'מאפיית שי', shoot_at: IL(2026, 10, 15, 11).toISOString(), shoot_type: 'dms', address: 'הנביאים 5' });
  importTo(w2, s, 'shoot');
  const eli = (h, m, step = 'eli2h') => one(due(w2, IL(2026, 10, 15, h, m)), 'shoot', step, 'eli');
  // Eli's reminder speaks of his own time (the owner's rule of 7.10.2026): he arrives an
  // hour before the shoot time, so two hours before the influencers is an hour before him.
  assert.equal(eli(9, 0).title, 'בעוד שעה ההגעה שלך לצילום: מאפיית שי');
  assert.equal(eli(9, 0).body, 'ההגעה שלך ב־10:00, שעה לפני הצילום (11:00) · הנביאים 5.');
  assert.equal(eli(9, 30).title, 'ההגעה שלך לצילום בעוד 30 דקות: מאפיית שי');
  assert.equal(eli(10, 11).title, 'שעת ההגעה שלך לצילום עברה: מאפיית שי');
  assert.equal(eli(10, 11).body, 'ההגעה שלך ב־10:00, שעה לפני הצילום (11:00) · הנביאים 5.');
  assert.match(eli(10, 45, 'eli15').body, /^המשפיענים מגיעים בעוד 15 דקות\./);
  assert.match(eli(10, 56, 'eli15').body, /^המשפיענים מגיעים בעוד 4 דקות\./);
  // (v13: Lior's "אלי עוד לא סימן הגעה" left with p17b.arrived.)
  for (const m of [15, 50]) none(due(w2, IL(2026, 10, 15, 10, m)), 'shoot', 'arrived');
  none(due(w2, IL(2026, 10, 15, 11, 0)), 'shoot', 'eli2h');
  none(due(w2, IL(2026, 10, 15, 11, 0)), 'shoot', 'eli15');
});
