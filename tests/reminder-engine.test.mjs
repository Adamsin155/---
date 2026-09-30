// The reminder ladders (app/reminder-rules.js through app/reminder-engine.js):
// every rule of the section 5 matrix that the engine covers, at fixed Israel
// times (npm test runs this under UTC, New York and Jerusalem). Each test builds a
// small world, asks what is due at a moment, and checks who gets which step, at
// what level and when; and that a stop condition ends the ladder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders, candidates, buildEnv } from '../app/reminder-engine.js';
import { RULES, SNOOZE, officeMinutesBefore, businessDayFrom, inSendHours } from '../app/reminder-rules.js';
import { PROCESSES } from '../app/protocol.js';
import { IMPORT_NOTE } from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';
import { dateIL, partsIL } from '../app/tz.js';

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

test('new deal (1–3): Irit at once and at 5 minutes, Lior after 30 office minutes, the owner after an hour', () => {
  const w = world();
  const c = client(w, { name: 'פיצה', deal_at: IL(2026, 10, 5, 10).toISOString() });
  const now = one(due(w, IL(2026, 10, 5, 10)), 'deal', 'now', 'irit');
  assert.equal(now.level, 'ring');
  assert.equal(now.exempt, 'clock');
  assert.equal(now.escalation, 'lior');
  assert.match(now.title, /עסקה חדשה: פיצה/);
  assert.match(now.body, /עד היום 10:05/);
  none(due(w, IL(2026, 10, 5, 10, 4)), 'deal', 'due');
  const d = one(due(w, IL(2026, 10, 5, 10, 5)), 'deal', 'due', 'irit');
  assert.equal(d.body, 'עוד חסר: חוזה, קבוצה, מועד אפיון.');
  none(due(w, IL(2026, 10, 5, 10, 29)), 'deal', 'lior');
  const l = one(due(w, IL(2026, 10, 5, 10, 30)), 'deal', 'lior', 'lior');
  assert.equal(l.exempt, null);
  assert.equal(one(due(w, IL(2026, 10, 5, 11)), 'deal', 'board', 'owner').level, 'board');
  // What is still missing is named; once all three are done the ladder stops.
  marks(w, c, ['p01.prepared', 'p01.sent'], IL(2026, 10, 5, 10, 2));
  assert.equal(one(due(w, IL(2026, 10, 5, 10, 5)), 'deal', 'due').body, 'עוד חסר: קבוצה, מועד אפיון.');
  marks(w, c, [...itemsOf('p02'), ...itemsOf('p03')], IL(2026, 10, 5, 10, 3));
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
  assert.match(ilai.body, /הכנת 9 גרפיקות ראשונות עד היום 14:30 · פתיחת גאנט שנתי עד היום 12:35/);
  one(at, 'started', 'start', 'ofir');
  one(at, 'started', 'start', 'lior');
  none(due(w, IL(2026, 10, 6, 13, 59)), 'started', 'pre30');
  const pre = due(w, IL(2026, 10, 6, 14));
  for (const p of ['ilai', 'ofir', 'lior']) one(pre, 'started', 'pre30', p);
  // Ofir's highlights are done: no reminder for him.
  marks(w, c, itemsOf('p08'), IL(2026, 10, 6, 13));
  none(due(w, IL(2026, 10, 6, 14)).filter((r) => r.person === 'ofir'), 'started');
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

test('access received: Ilai at once (30 minutes); Lior after 30 office minutes; stops when checked', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 6, 10).toISOString() });
  importTo(w, c, 'char');
  mark(w, c, 'p05.access', IL(2026, 10, 6, 12));
  const now = one(due(w, IL(2026, 10, 6, 12)), 'access', 'now', 'ilai');
  assert.equal(now.exempt, 'clock');
  assert.match(now.body, /יעד היום 12:30/);
  none(due(w, IL(2026, 10, 6, 12, 29)), 'access', 'lior');
  one(due(w, IL(2026, 10, 6, 12, 30)), 'access', 'lior', 'lior');
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

test('9 graphics ready: Irit at once, Lior after 30 minutes (decision 7); waiting on the client or sending stops it', () => {
  const w = world();
  const c = client(w);
  importTo(w, c, 'char');
  mark(w, c, 'p07.made', IL(2026, 10, 7, 11));
  one(due(w, IL(2026, 10, 7, 11)), 'graphics9', 'now', 'irit');
  none(due(w, IL(2026, 10, 7, 11, 29)), 'graphics9', 'lior');
  one(due(w, IL(2026, 10, 7, 11, 30)), 'graphics9', 'lior', 'lior');
  mark(w, c, 'p07.wait', IL(2026, 10, 7, 11, 5), JSON.stringify({ reason: 'הלקוח ביקש לחכות' }));
  none(due(w, IL(2026, 10, 7, 11, 30)), 'graphics9');
  delete w.checks[c.id]['p07.wait'];
  mark(w, c, 'p07.sent', IL(2026, 10, 7, 11, 20));
  none(due(w, IL(2026, 10, 7, 11, 30)), 'graphics9');
});

test('the client did not answer (7, 23, 26): 10, 10 and 5 office minutes after sending, then Irit calls', () => {
  const w = world();
  const c = client(w, { name: 'קפה' });
  importTo(w, c, 'char');
  mark(w, c, 'p07.sent', IL(2026, 10, 7, 11, 40));
  none(due(w, IL(2026, 10, 7, 11, 49)), 'answer');
  const r = one(due(w, IL(2026, 10, 7, 11, 50)), 'answer', 'due', 'irit');
  assert.equal(r.exempt, 'clock');
  assert.equal(r.body, '9 הגרפיקות הראשונות. עברו 10 דקות בלי תשובה: להתקשר.');
  mark(w, c, 'p07.answered', IL(2026, 10, 7, 11, 45));
  none(due(w, IL(2026, 10, 7, 11, 50)), 'answer');
  // The videos in a second shoot round: 5 minutes, a key of their own.
  const w2 = world();
  const c2 = client(w2, { rounds: [{ n: 2, shoot_type: 'dms', shoot_at: IL(2026, 10, 1, 10).toISOString(), start_at: IL(2026, 9, 28, 10).toISOString() }] });
  mark(w2, c2, 'r2.p26.sent', IL(2026, 10, 7, 11));
  const v = one(due(w2, IL(2026, 10, 7, 11, 5)), 'answer', 'due');
  assert.match(v.key, /:r2-p26@/);
  // A new sending is a new clock.
  mark(w2, c2, 'r2.p26.sent', IL(2026, 10, 7, 12));
  assert.notEqual(one(due(w2, IL(2026, 10, 7, 12, 5)), 'answer', 'due').key, v.key);
});

test('shoot day not closed (11): Irit\'s digest each morning, 16:00 ring on business day 2, Lior and the owner on day 3', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 4, 10).toISOString() });
  importTo(w, c, 'content');
  for (const k of itemsOf('p11')) delete w.checks[c.id][k];
  const mon = due(w, IL(2026, 10, 5, 8, 30));
  assert.equal(one(mon, 'shootDate', 'd2026-10-05', 'irit').level, 'digest');
  assert.match(one(mon, 'shootDate', 'd2026-10-05').title, /יום 1 מתוך 3/);
  none(due(w, IL(2026, 10, 6, 15, 59)), 'shootDate', 'day2');
  one(due(w, IL(2026, 10, 6, 16)), 'shootDate', 'day2', 'irit');
  const wed = due(w, IL(2026, 10, 7, 8, 30));
  const lior = one(wed, 'shootDate', 'day3', 'lior');
  assert.equal(lior.level, 'digest');
  assert.equal(lior.list, true);
  one(wed, 'shootDate', 'board', 'owner');
  // Waiting on the client stops it; so does closing the day.
  mark(w, c, 'p11.wait', IL(2026, 10, 5, 12), JSON.stringify({ reason: 'הלקוח בחו״ל' }));
  none(due(w, IL(2026, 10, 7, 8, 30)), 'shootDate');
});

test('scripts (12): a daily count for Lior; a ring at 12:00 on business day 3', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 4, 10).toISOString() });
  importTo(w, c, 'content');
  for (const k of itemsOf('p12')) delete w.checks[c.id][k];
  assert.match(one(due(w, IL(2026, 10, 6, 8, 30)), 'scripts', 'd2026-10-06', 'lior').title, /יום 2 מתוך 3/);
  none(due(w, IL(2026, 10, 7, 11, 59)), 'scripts', 'day3');
  one(due(w, IL(2026, 10, 7, 12)), 'scripts', 'day3', 'lior');
  marks(w, c, itemsOf('p12'), IL(2026, 10, 7, 11));
  none(due(w, IL(2026, 10, 7, 12)), 'scripts');
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

test('the day before the shoot (15): 10:30 Lior, 11:15 Irit, 12:00 Lior urgent, 15:00 the owner', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, c, 'shoot');
  const r1030 = one(due(w, IL(2026, 10, 14, 10, 30)), 'eve', '1030', 'lior');
  assert.equal(r1030.exempt, 'shoot');
  assert.equal(r1030.shoot, true);
  one(due(w, IL(2026, 10, 14, 11, 15)), 'eve', '1115', 'irit');
  assert.equal(one(due(w, IL(2026, 10, 14, 12)), 'eve', '1200', 'lior').exempt, 'urgent');
  none(due(w, IL(2026, 10, 14, 14, 59)), 'eve', '1500');
  one(due(w, IL(2026, 10, 14, 15)), 'eve', '1500', 'owner');
  // Reminders sent by 14:00: no owner alert at 15:00.
  marks(w, c, ['p15.influencers', 'p15.client', 'p15.crew'], IL(2026, 10, 14, 14));
  none(due(w, IL(2026, 10, 14, 15)), 'eve', '1500');
  // A Sunday shoot: all of it on Thursday (decision 15).
  const w2 = world();
  const c2 = client(w2, { shoot_at: IL(2026, 10, 18, 11).toISOString() });
  importTo(w2, c2, 'shoot');
  assert.equal(hhmm(one(due(w2, IL(2026, 10, 15, 10, 30)), 'eve', '1030').at), '15.10 10:30');
});

test('photographer briefing (16): 17:00 Lior and Eli; 20:00 Lior if Eli did not get it', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString(), address: 'רחוב הים 3' });
  importTo(w, c, 'shoot');
  const at17 = due(w, IL(2026, 10, 14, 17));
  one(at17, 'briefing', 'lior', 'lior');
  // Eli gets the briefing once Lior sent it (with the drive label), not an empty one.
  none(at17, 'briefing', 'eli');
  mark(w, c, 'p16.brief', IL(2026, 10, 14, 17, 20), JSON.stringify({ label: 'כונן 3', notes: '' }));
  none(due(w, IL(2026, 10, 14, 17, 20)), 'briefing', 'lior');
  const eli = one(due(w, IL(2026, 10, 14, 17, 20)), 'briefing', 'eli', 'eli');
  assert.match(eli.body, /הגעה ב־10:00, רחוב הים 3 · כונן 3/);
  assert.doesNotMatch(eli.body, /סוללות/); // the gear list is on Eli's page only
  assert.equal(eli.url, `shoot.html?id=${c.id}`);
  // Sent earlier in the day: it reaches Eli at 17:00.
  mark(w, c, 'p16.brief', IL(2026, 10, 14, 12), JSON.stringify({ label: 'A' }));
  none(due(w, IL(2026, 10, 14, 16, 59)), 'briefing', 'eli');
  assert.equal(hhmm(one(due(w, IL(2026, 10, 14, 17)), 'briefing', 'eli').at), '14.10 17:00');
  const r20 = one(due(w, IL(2026, 10, 14, 20)), 'briefing', '2000', 'lior');
  assert.equal(r20.shoot, true);
  mark(w, c, 'p16.photographer', IL(2026, 10, 14, 17, 30));
  none(due(w, IL(2026, 10, 14, 20)), 'briefing', '2000');
});

test('shoot day: Eli 2 hours and 15 minutes before; Lior if Eli did not arrive; time management; the end', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString(), shoot_type: 'dms' });
  importTo(w, c, 'shoot');
  none(due(w, IL(2026, 10, 14, 20)), 'shoot');
  one(due(w, IL(2026, 10, 15, 9)), 'shoot', 'eli2h', 'eli');
  one(due(w, IL(2026, 10, 15, 10, 45)), 'shoot', 'eli15', 'eli');
  one(due(w, IL(2026, 10, 15, 10, 15)), 'shoot', 'arrived', 'lior');
  one(due(w, IL(2026, 10, 15, 11, 30)), 'shoot', 'begin', 'lior');
  one(due(w, IL(2026, 10, 15, 15)), 'shoot', 'progress', 'lior');
  const end = due(w, IL(2026, 10, 15, 16, 30));
  one(end, 'shoot', 'endLior', 'lior');
  one(end, 'shoot', 'endEli', 'eli');
  mark(w, c, 'p17b.arrived', IL(2026, 10, 15, 10));
  none(due(w, IL(2026, 10, 15, 10, 15)), 'shoot', 'arrived');
  marks(w, c, itemsOf('p19'), IL(2026, 10, 15, 16));
  none(due(w, IL(2026, 10, 15, 16, 30)), 'shoot', 'endLior');
  // Natali: "an hour left" after two hours, the end after three.
  const w2 = world();
  const c2 = client(w2, { shoot_at: IL(2026, 10, 15, 11).toISOString(), shoot_type: 'natali' });
  importTo(w2, c2, 'shoot');
  one(due(w2, IL(2026, 10, 15, 13)), 'shoot', 'hourLeft', 'lior');
  none(due(w2, IL(2026, 10, 15, 13)), 'shoot', 'begin');
  one(due(w2, IL(2026, 10, 15, 14)), 'shoot', 'endLior', 'lior');
});

test('assign an editor (22א): Ofir at once and next morning; Lior at 12:00 next business day even when taken', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, c, 'post');
  for (const k of itemsOf('p22a')) delete w.checks[c.id][k];
  marks(w, c, itemsOf('p19'), IL(2026, 10, 15, 17));
  one(due(w, IL(2026, 10, 15, 17)), 'assign', 'now', 'ofir');
  assert.equal(one(due(w, IL(2026, 10, 18, 8, 30)), 'assign', 'morning', 'ofir').level, 'digest');
  none(due(w, IL(2026, 10, 18, 11, 59)), 'assign', 'stop12');
  one(due(w, IL(2026, 10, 18, 12)), 'assign', 'stop12', 'lior');
  // "אני על זה" by Ofir: no more nudges to him, but the hard stop still fires.
  mark(w, c, 'p22a.claim', IL(2026, 10, 15, 17, 5), 'ofir');
  const later = due(w, IL(2026, 10, 18, 12));
  none(later, 'assign', 'now');
  one(later, 'assign', 'stop12', 'lior');
  mark(w, c, 'p22a.assigned', IL(2026, 10, 18, 11));
  none(due(w, IL(2026, 10, 18, 12)), 'assign');
});

test('editing (22, 24): assigned, not started after 2 office hours (Lior after 4), days 2 and 3, day 3 at 15:00', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString(), editor: 'nadia' });
  importTo(w, c, 'post');
  for (const k of [...itemsOf('p22'), ...itemsOf('p24'), ...itemsOf('p22a')]) delete w.checks[c.id][k];
  mark(w, c, 'p22a.assigned', IL(2026, 10, 18, 10));
  const now = one(due(w, IL(2026, 10, 18, 10)), 'editing', 'assigned', 'nadia');
  assert.match(now.body, /בדרייב ואצל אופיר עד ד׳ 21\.10 23:59 · סגירה עד ה׳ 22\.10 23:59/);
  none(due(w, IL(2026, 10, 18, 11, 59)), 'editing', 'nostart');
  one(due(w, IL(2026, 10, 18, 12)), 'editing', 'nostart', 'nadia');
  const at14 = due(w, IL(2026, 10, 18, 14));
  assert.equal(one(at14, 'editing', 'nostartLior', 'lior').list, true);
  assert.equal(one(at14, 'editing', 'ofir', 'ofir').level, 'quiet');
  assert.equal(one(due(w, IL(2026, 10, 20, 8, 30)), 'editing', 'day2', 'nadia').level, 'digest');
  one(due(w, IL(2026, 10, 21, 8, 30)), 'editing', 'day3', 'nadia');
  none(due(w, IL(2026, 10, 21, 14, 59)), 'editing', 'day3pm');
  one(due(w, IL(2026, 10, 21, 15)), 'editing', 'day3pm', 'nadia');
  // Started: no "not started"; paused: nothing; ready for QA: done.
  mark(w, c, 'p22.received', IL(2026, 10, 18, 11));
  none(due(w, IL(2026, 10, 18, 14)), 'editing', 'nostart');
  mark(w, c, 'p22.pause', IL(2026, 10, 19, 11), JSON.stringify({ reason: 'משימה דחופה' }));
  none(due(w, IL(2026, 10, 21, 15)), 'editing');
  delete w.checks[c.id]['p22.pause'];
  mark(w, c, 'p24.notify', IL(2026, 10, 21, 12));
  none(due(w, IL(2026, 10, 21, 15)), 'editing');
});

test('ready for QA (24→25): Ofir at once and after 40 office minutes, paused while he is in a characterization; Lior after an hour', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString(), editor: 'yariv' });
  importTo(w, c, 'post');
  for (const k of itemsOf('p25')) delete w.checks[c.id][k];
  mark(w, c, 'p24.notify', IL(2026, 10, 21, 11));
  one(due(w, IL(2026, 10, 21, 11)), 'qa', 'now', 'ofir');
  one(due(w, IL(2026, 10, 21, 11, 40)), 'qa', 'again', 'ofir');
  assert.equal(one(due(w, IL(2026, 10, 21, 12)), 'qa', 'lior', 'lior').list, true);
  // Ofir characterizes another client 11:20–13:20: the 40 minutes end at 13:40.
  const other = client(w, { char_at: IL(2026, 10, 21, 11, 20).toISOString() });
  importTo(w, other, 'char');
  none(due(w, IL(2026, 10, 21, 13, 39)), 'qa', 'again');
  assert.equal(hhmm(one(due(w, IL(2026, 10, 21, 13, 40)), 'qa', 'again').at), '21.10 13:40');
  // He marked the meeting done at 12:20: the clock runs again from then (12:40).
  marks(w, other, itemsOf('p04'), IL(2026, 10, 21, 12, 20));
  assert.equal(hhmm(one(due(w, IL(2026, 10, 21, 12, 40)), 'qa', 'again').at), '21.10 12:40');
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
  // p23: Ilai marks ready → Ofir; Ofir approves → Irit.
  mark(w, c, 'p23.made', IL(2026, 10, 21, 13));
  one(due(w, IL(2026, 10, 21, 13)), 'graphicsRest', 'ofir', 'ofir');
  mark(w, c, 'p23.ofir', IL(2026, 10, 21, 13, 30));
  const g = due(w, IL(2026, 10, 21, 13, 30));
  none(g, 'graphicsRest', 'ofir');
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

test('weekly call (31): Sunday and Wednesday digest, Thursday 12:00 ring, 18:00 missed on the owner\'s screen', () => {
  const w = world();
  const c = client(w, { name: 'לקוח שוטף' });
  importTo(w, c, 'ongoing');
  marks(w, c, itemsOf('p30'), IL(2026, 9, 20, 10));
  assert.equal(one(due(w, IL(2026, 10, 4, 8, 30)), 'weekly', 'sun', 'lior').level, 'digest');
  one(due(w, IL(2026, 10, 7, 8, 30)), 'weekly', 'wed', 'lior');
  none(due(w, IL(2026, 10, 8, 11, 59)), 'weekly', 'thu');
  one(due(w, IL(2026, 10, 8, 12)), 'weekly', 'thu', 'lior');
  assert.equal(one(due(w, IL(2026, 10, 8, 18)), 'weekly', 'missed', 'owner').level, 'board');
  // A call recorded this week ends it; last week's does not count.
  mark(w, c, 'p31.call', IL(2026, 10, 1, 12));
  one(due(w, IL(2026, 10, 8, 12)), 'weekly', 'thu');
  mark(w, c, 'p31.call', IL(2026, 10, 7, 12));
  none(due(w, IL(2026, 10, 8, 18)), 'weekly');
});

test('daily messages, daily control (32) and the clients review (33)', () => {
  const w = world();
  const a = client(w, { name: 'א' });
  const b = client(w, { name: 'ב' });
  importTo(w, a, 'ongoing');
  importTo(w, b, 'ongoing');
  assert.match(one(due(w, IL(2026, 10, 5, 8, 30)), 'dailyMessages', 'list').title, /הודעות יומיות ללקוחות: 2/);
  w.messages.push({ client_id: a.id, sent_at: IL(2026, 10, 5, 11).toISOString() });
  const at14 = due(w, IL(2026, 10, 5, 14));
  const q = one(at14, 'dailyMessages', '1400', 'irit');
  assert.equal(q.level, 'quiet');
  assert.equal(q.body, 'ב');
  assert.equal(one(at14, 'control32', '1400', 'irit').level, 'ring');
  assert.equal(one(due(w, IL(2026, 10, 5, 18)), 'control32', 'lior', 'lior').list, true);
  w.reviews.push({ day: '2026-10-05', kind: 'p32' });
  none(due(w, IL(2026, 10, 5, 14)), 'control32');
  // Ofir's review, last on Thursday 1.10: due Monday (2 business days), Lior on Tuesday.
  w.reviews.push({ day: '2026-10-01', kind: 'p33' });
  one(due(w, IL(2026, 10, 5, 8, 30)), 'control33', 'ofir', 'ofir');
  none(due(w, IL(2026, 10, 5, 8, 30)), 'control33', 'lior');
  one(due(w, IL(2026, 10, 6, 8, 30)), 'control33', 'lior', 'lior');
  w.reviews.push({ day: '2026-10-05', kind: 'p33' });
  none(due(w, IL(2026, 10, 6, 8, 30)), 'control33');
  // Not on a Friday.
  none(due(w, IL(2026, 10, 9, 14)), 'dailyMessages');
});

test('Thursday summaries: 09:00 Ofir, 13:00 target (quiet) and Lior\'s list, 18:00 the owner', () => {
  const w = world();
  const a = client(w);
  importTo(w, a, 'ongoing');
  one(due(w, IL(2026, 10, 8, 9)), 'thursday', '0900', 'ofir');
  const at13 = due(w, IL(2026, 10, 8, 13));
  assert.equal(one(at13, 'thursday', '1300', 'ofir').level, 'quiet');
  one(at13, 'thursday', 'lior', 'lior');
  one(due(w, IL(2026, 10, 8, 18)), 'thursday', 'board', 'owner');
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
  // The quiet mode is a recorded flag: not before Eli marks "הגעתי".
  assert.equal(buildEnv({ ...w, now: IL(2026, 10, 15, 12) }).liorShoot.active, false);
  assert.equal(one(due(w, IL(2026, 10, 15, 12)), 'urgent', 'now').person, 'lior');
  mark(w, shoot, 'p17b.arrived', IL(2026, 10, 15, 10, 5));
  // A mark from another day (imported, or a moved shoot) does not start it.
  assert.equal(buildEnv({ ...w, now: IL(2026, 10, 15, 10) }).liorShoot.active, false);
  const env = buildEnv({ ...w, now: IL(2026, 10, 15, 12) });
  assert.equal(env.liorShoot.active, true);
  const r = one(computeReminders({ env }), 'urgent', 'now');
  assert.equal(r.person, 'ofir');
  assert.match(r.title, /^ליאור ביום צילום · משימה דחופה: אחר/);
  assert.match(r.key, /@lior$/); // still Lior's step: it goes out once
  // Once the drive is back, confirmed by both Eli and Lior, Lior again (before the day is closed).
  mark(w, shoot, 'p19b.handed', IL(2026, 10, 15, 15));
  assert.equal(buildEnv({ ...w, now: IL(2026, 10, 15, 15, 30) }).liorShoot.active, true);
  mark(w, shoot, 'p19.took', IL(2026, 10, 15, 15, 10));
  assert.equal(buildEnv({ ...w, now: IL(2026, 10, 15, 15, 30) }).liorShoot.active, false);
  assert.equal(one(due(w, IL(2026, 10, 15, 16)), 'urgent', 'now').person, 'lior');
  // Lior can start it himself (p18.quiet) when Eli has not marked yet; the day closed (19) ends it.
  const w2 = world();
  const s2 = client(w2, { shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w2, s2, 'shoot');
  mark(w2, s2, 'p18.quiet', IL(2026, 10, 15, 9, 50));
  assert.equal(buildEnv({ ...w2, now: IL(2026, 10, 15, 9, 55) }).liorShoot.active, true);
  marks(w2, s2, itemsOf('p19'), IL(2026, 10, 15, 15));
  assert.equal(buildEnv({ ...w2, now: IL(2026, 10, 15, 15, 1) }).liorShoot.active, false);
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

test('ordinary task: quiet when created, the morning it is due, a day late to it and its creator, two days to Lior', () => {
  const w = world();
  const c = client(w, { name: 'משימות' });
  importTo(w, c, 'ongoing');
  w.tasks.push({ id: 'r1', client_id: c.id, title: 'לשלוח חשבונית', owner: 'irit', due_on: '2026-10-06', urgent: false, created_at: IL(2026, 10, 5, 11).toISOString(), created_by_email: 'lior@x' });
  assert.equal(one(due(w, IL(2026, 10, 5, 11)), 'task', 'created', 'irit').level, 'quiet');
  none(due(w, IL(2026, 10, 6, 8, 29)), 'task', 'due');
  assert.equal(one(due(w, IL(2026, 10, 6, 8, 30)), 'task', 'due', 'irit').level, 'digest');
  const late = due(w, IL(2026, 10, 7, 8, 30));
  one(late, 'task', 'late', 'irit');
  one(late, 'task', 'late', 'lior'); // who opened it
  assert.equal(one(due(w, IL(2026, 10, 8, 8, 30)), 'task', 'lior', 'lior').list, true);
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

test('lateness: a worker\'s to Lior\'s list, Lior\'s to the owner\'s screen, Ofir copied on editing', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 6, 10).toISOString() });
  importTo(w, c, 'char');
  marks(w, c, itemsOf('p04'), IL(2026, 10, 6, 12));
  const at = due(w, IL(2026, 10, 6, 14, 1));
  const ofirLate = pick(at, 'late', 'lior').find((r) => r.key.includes(':p08@'));
  assert.ok(ofirLate, 'Ofir\'s highlights late: Lior\'s list');
  assert.equal(ofirLate.list, true);
  assert.ok(pick(at, 'late', 'board').some((r) => r.key.includes(':p10@')), 'Lior late: the owner\'s screen');
  assert.ok(!pick(at, 'late', 'ofir').some((r) => r.key.includes(':p08@')), 'Ofir is not copied on his own work');
  // Editing late: Ofir gets a copy.
  const w2 = world();
  const e = client(w2, { shoot_at: IL(2026, 10, 15, 11).toISOString(), editor: 'anna' });
  importTo(w2, e, 'post');
  for (const k of [...itemsOf('p22'), ...itemsOf('p22a')]) delete w2.checks[e.id][k];
  mark(w2, e, 'p22a.assigned', IL(2026, 10, 18, 10));
  const late = due(w2, IL(2026, 10, 22, 8, 30));
  assert.ok(pick(late, 'late', 'ofir').some((r) => r.key.includes(':p22@')));
  assert.match(pick(late, 'late', 'lior').find((r) => r.key.includes(':p22@')).title, /אנה/);
});

test('"לדחות עד…": what came due meanwhile waits for that moment, as one step', () => {
  const w = world();
  const c = client(w);
  importTo(w, c, 'char');
  mark(w, c, 'p07.made', IL(2026, 10, 7, 11));
  mark(w, c, SNOOZE('p07'), IL(2026, 10, 7, 11, 1), IL(2026, 10, 7, 13).toISOString());
  none(due(w, IL(2026, 10, 7, 12, 59)), 'graphics9');
  const at13 = due(w, IL(2026, 10, 7, 13)).filter((r) => r.rule === 'graphics9');
  assert.deepEqual(at13.map((r) => r.step), ['lior']);
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
  const list = candidates(buildEnv({ ...w2, now: IL(2026, 10, 7, 11) })).filter((r) => r.clientId === c.id);
  assert.deepEqual([...new Set(list.map((r) => r.rule))].sort(), ['weekly']);
});

test('contract sent, not signed (1): Irit quietly after 4 office hours, Lior\'s list after a business day', () => {
  const w = world();
  const c = client(w, { deal_at: IL(2026, 10, 5, 9).toISOString() });
  marks(w, c, ['p01.prepared', 'p01.sent'], IL(2026, 10, 5, 10));
  none(due(w, IL(2026, 10, 5, 13, 59)), 'contract', 'irit');
  assert.equal(one(due(w, IL(2026, 10, 5, 14)), 'contract', 'irit', 'irit').level, 'quiet');
  assert.equal(one(due(w, IL(2026, 10, 6, 10)), 'contract', 'lior', 'lior').list, true);
  mark(w, c, 'p01.signed', IL(2026, 10, 5, 12));
  none(due(w, IL(2026, 10, 6, 10)), 'contract');
});

test('group opened (2): Lior at once; the owner\'s screen if the introduction was not sent within an office hour', () => {
  const w = world();
  const c = client(w, { deal_at: IL(2026, 10, 5, 9).toISOString() });
  mark(w, c, 'p02.opened', IL(2026, 10, 5, 10));
  assert.equal(one(due(w, IL(2026, 10, 5, 10)), 'group', 'lior', 'lior').level, 'ring');
  one(due(w, IL(2026, 10, 5, 11)), 'group', 'board', 'owner');
  mark(w, c, 'p02.intro', IL(2026, 10, 5, 10, 30));
  none(due(w, IL(2026, 10, 5, 11)), 'group', 'board');
  marks(w, c, ['p02.deal', 'p02.team'], IL(2026, 10, 5, 10, 40));
  none(due(w, IL(2026, 10, 5, 11)), 'group');
});

test('access not in the vault 30 minutes after the meeting (Irit, quiet); a new logo for Ilai', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 6, 10).toISOString(), has_logo: false });
  importTo(w, c, 'char');
  marks(w, c, itemsOf('p04'), IL(2026, 10, 6, 12, 30));
  assert.equal(one(due(w, IL(2026, 10, 6, 12, 30)), 'vault', 'logo', 'ilai').level, 'quiet');
  none(due(w, IL(2026, 10, 6, 12, 59)), 'vault', 'irit');
  one(due(w, IL(2026, 10, 6, 13)), 'vault', 'irit', 'irit');
  mark(w, c, 'p05.vault', IL(2026, 10, 6, 12, 45));
  none(due(w, IL(2026, 10, 6, 13)), 'vault', 'irit');
});

test('Natali (11ב): Lior quietly once the date is set; three business days before, Lior and Irit ring and the owner\'s screen', () => {
  const w = world();
  const c = client(w, { shoot_type: 'natali', shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, c, 'content');
  for (const k of [...itemsOf('p11'), ...itemsOf('p11b')]) delete w.checks[c.id][k];
  marks(w, c, itemsOf('p11'), IL(2026, 10, 11, 10));
  assert.equal(one(due(w, IL(2026, 10, 11, 10)), 'natali', 'lior', 'lior').level, 'quiet');
  const red = due(w, IL(2026, 10, 12, 10));
  assert.equal(one(red, 'natali', 'redlior', 'lior').exempt, 'urgent');
  one(red, 'natali', 'redirit', 'irit');
  one(red, 'natali', 'board', 'owner');
  marks(w, c, itemsOf('p11b'), IL(2026, 10, 12, 9));
  none(due(w, IL(2026, 10, 12, 10)), 'natali');
});

test('focus call (12א) the next business day; shoot blockers (14) every morning and Lior two days before', () => {
  const w = world();
  const c = client(w, { char_at: IL(2026, 10, 4, 10).toISOString(), shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, c, 'content');
  for (const k of [...itemsOf('p12a'), ...itemsOf('p14')]) delete w.checks[c.id][k];
  assert.equal(one(due(w, IL(2026, 10, 5, 8, 30)), 'focusCall', 'next', 'lior').level, 'digest');
  assert.match(one(due(w, IL(2026, 10, 12, 8, 30)), 'blockers', 'd2026-10-12', 'irit').title, /8 פתוחים/);
  one(due(w, IL(2026, 10, 13, 10)), 'blockers', 'lior', 'lior');
  marks(w, c, itemsOf('p14'), IL(2026, 10, 13, 9));
  none(due(w, IL(2026, 10, 13, 10)), 'blockers');
});

test('after the shoot: not closed → Lior next morning and the owner; the cards; the rest of the graphics', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString() });
  importTo(w, c, 'post');
  for (const k of Object.keys(w.checks[c.id])) if (/^p(19b?|23)\./.test(k)) delete w.checks[c.id][k];
  const sun = due(w, IL(2026, 10, 18, 8, 30));
  one(sun, 'shootOpen', 'lior', 'lior');
  one(sun, 'shootOpen', 'board', 'owner');
  one(sun, 'graphicsRestStart', 'next', 'ilai');
  marks(w, c, [...itemsOf('p19b'), 'p19.took'], IL(2026, 10, 15, 17));
  assert.equal(one(due(w, IL(2026, 10, 15, 17)), 'cards', 'eli', 'eli').level, 'quiet');
});

test('editing paused: Ofir quietly and Lior\'s list; still paused next morning, Lior decides', () => {
  const w = world();
  const c = client(w, { shoot_at: IL(2026, 10, 15, 11).toISOString(), editor: 'nirel', shoot_type: 'natali' });
  importTo(w, c, 'post');
  for (const k of itemsOf('p22')) delete w.checks[c.id][k];
  mark(w, c, 'p22.pause', IL(2026, 10, 18, 11), JSON.stringify({ reason: 'משימה דחופה' }));
  const now = due(w, IL(2026, 10, 18, 11));
  assert.match(one(now, 'paused', 'ofir', 'ofir').title, /ניראל/);
  one(now, 'paused', 'lior', 'lior');
  one(due(w, IL(2026, 10, 19, 8, 30)), 'paused', 'morning', 'lior');
});

test('client notes by day 4 (Irit), campaign the next business day and Tuesday\'s campaign check (Lior), call follow-up (Irit)', () => {
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
  mark(w2, d, 'p31.call', IL(2026, 10, 7, 12));
  one(due(w2, IL(2026, 10, 7, 12)), 'callFollowup', 'irit', 'irit');
});

test('ending (35): Lior\'s digest the day before, a ring on the last day; late closing reaches the owner\'s screen', () => {
  const w = world();
  const c = client(w, { status: 'ending', contract_end: '2026-10-15' });
  importTo(w, c, 'ongoing');
  one(due(w, IL(2026, 10, 14, 8, 30)), 'ending', 'lior', 'lior');
  one(due(w, IL(2026, 10, 15, 10)), 'ending', 'day', 'lior');
  assert.ok(pick(due(w, IL(2026, 10, 16, 8, 30)), 'late', 'board').some((r) => r.key.includes(':p35@')));
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
  assert.ok(pick(due(w, IL(2026, 10, 6, 12, 1)), 'late', 'lior').some((r2) => r2.key.includes(':p07@')));
});
