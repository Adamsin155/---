// Tal, Natali's makeup artist (the owner's request of 15.11.2026; docs/ops.md, section 132), at fixed
// Israel times:
//   - the logic (app/makeup-logic.js): only Natali's days (not Niro's), one day for several clients,
//     a round's day, her typed hour (read, checked: before the shoot), where an answer stands
//     ("again" once the shoot moved), what Lior reads and what he is told;
//   - through the server's minute (supabase/functions/reminders/tick.js):
//       makeupSet    she is told at once of a day set, moved or cancelled, with the date and the
//                    shoot's hour; a second client on the same day is no news; a far day set at night
//                    waits for her morning digest, one within two days is told at once;
//       makeupAnswer Lior is told of EVERY answer at once: "מאשרת" with her hour, a changed hour,
//                    "לא יכולה" (a ring), and "מאשרת" after "לא יכולה"; each once;
//   - who she is: one screen in the menu, no bar, not given tasks or notes, not asked to the bot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTick } from '../supabase/functions/reminders/tick.js';
import { RULES, MAKEUP_SET, MAKEUP_ANSWER, makeupToldOf, REMINDER_PEOPLE } from '../app/reminder-rules.js';
import { templateFor } from '../app/wa-templates.js';
import { importKeys } from '../app/client-open.js';
import { IMPORT_NOTE } from '../app/protocol-logic.js';
import { dateIL } from '../app/tz.js';
import {
  readHour, hourProblem, nataliDays, statusOf, liorWords, answerNews, answerFor, makeupKeys, daysFromRows, groupDays,
} from '../app/makeup-logic.js';
import { PEOPLE, STAFF_PEOPLE, TEAM_PEOPLE, scopeOf, isMakeup } from '../app/protocol.js';
import { menuOf, barOf, homeHref, afterSignIn } from '../app/shell-rules.js';
import { ASSIGNEES } from '../app/staff-tasks-logic.js';
import { NOTE_PEOPLE } from '../app/staff-notes-logic.js';
import { canAsk } from '../app/ask-logic.js';
import { landingOf } from '../app/deal-logic.js';
import { timeline, shootCases } from '../app/production.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const MIN = 6e4;
const KEY = 'B' + 'A'.repeat(86);
const STAFF = [{ email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' }, { email: 'ofir@x', person: 'ofir' }, { email: 'eli@x', person: 'eli' }, { email: 'tal@x', person: 'tal' }];
const client = (o = {}) => ({
  id: 'c1', name: 'יעל', business: 'פרץ יוגה', status: 'active', shoot_type: 'natali', characterizer: 'ofir', has_logo: true, rounds: [], contract_end: '2027-12-31',
  deal_at: IL(2026, 9, 1, 10).toISOString(), address: 'הנביאים 5, חיפה', shoot_at: null, ...o,
});
const history = (c) => importKeys('shoot').map((k) => ({ client_id: c.id, item_key: k, state: 'done', note: IMPORT_NOTE, at: IL(2026, 9, 1, 9).toISOString() }));

function fakeDb({ clients = [], checks = [], answers = [], staff = STAFF } = {}) {
  let clock = new Date();
  const subs = [{ email: 'tal@x', endpoint: 'https://push.test/tal' }, { email: 'lior@x', endpoint: 'https://push.test/lior' }];
  const db = {
    log: [], answers, subs: subs.map((s, i) => ({ id: `s${i}`, p256dh: KEY, auth: 'A'.repeat(22), fail_count: 0, ...s })), nextId: 1,
    at(now) { clock = now; return db; },
    async load() {
      return {
        clients: clients.map((c) => ({ ...c })), checks, tasks: [], staff, access: [], reviews: [], statusNotes: [], messages: [],
        subscriptions: db.subs.map((s) => ({ ...s })), log: db.log.map((r) => ({ ...r })),
        // As index.ts: the rows of shootSet and makeupSet; her answers.
        shootTold: db.log.filter((r) => ['shootSet', MAKEUP_SET].includes(r.rule)).map((r) => ({ id: r.id, key: r.key, title: r.title, created_at: r.created_at })),
        makeupAnswers: db.answers.map((a) => ({ ...a })),
      };
    },
    async known(keys) { const set = new Set(keys); return new Set(db.log.map((r) => r.key).filter((k) => set.has(k))); },
    async insertLog(rows) {
      const out = [];
      for (const r of rows) {
        assert.ok(/^[a-zA-Z0-9]+$/.test(r.rule) && r.key.length <= 400 && r.title.length <= 300, r.key);
        if (db.log.some((x) => x.key === r.key)) continue;
        const row = { id: db.nextId++, created_at: clock.toISOString(), claimed_at: clock.toISOString(), attempts: 0, read_at: null, digest_key: null, ...r };
        db.log.push(row);
        out.push({ ...row });
      }
      return out;
    },
    async reclaim() { return []; },
    async updateLog(ids, patch) { for (const r of db.log) if (ids.includes(r.id)) Object.assign(r, patch); },
    async subscriptionOk() {},
    async subscriptionFailed() {},
    async removeSubscription() {},
  };
  return db;
}
function fakePush() {
  const sent = [];
  return { sent, push: async (sub, payload) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); return { ok: true, status: 201 }; } };
}
const to = (who) => (sent) => sent.filter((s) => s.endpoint === `https://push.test/${who}`).map((s) => [s.title, s.body]);
const talOf = to('tal');
const liorOf = to('lior');

// ── The logic ─────────────────────────────
test('her hour: read from what she types, and only before the shoot', () => {
  for (const [typed, hh] of [['07:30', '07:30'], ['7:30', '07:30'], ['0730', '07:30'], ['730', '07:30'], ['7.30', '07:30'], [' 08:05 ', '08:05'], ['23:59', '23:59']]) assert.equal(readHour(typed), hh, typed);
  for (const bad of ['', '7', '24:00', '07:60', 'שבע', '07:3', '7:300', null]) assert.equal(readHour(bad), null, String(bad));
  const day = { shootAt: IL(2026, 10, 20, 10) };
  assert.equal(hourProblem('', day), 'צריך לכתוב באיזו שעה את מגיעה לנטלי');
  assert.equal(hourProblem('בבוקר', day), 'שעה כמו 07:30');
  assert.equal(hourProblem('10:00', day), 'השעה צריכה להיות לפני הצילום (10:00)');
  assert.equal(hourProblem('11:15', day), 'השעה צריכה להיות לפני הצילום (10:00)');
  assert.equal(hourProblem('08:00', day), null);
  assert.equal(hourProblem('800', day), null);
});

test('Natali only (not Niro, הצל or Arik); one day for several clients; a round; the first shoot is the day\'s hour', () => {
  const a = client({ id: 'a', business: 'פרץ יוגה', shoot_at: IL(2026, 10, 20, 13).toISOString() });
  const b = client({ id: 'b', business: 'חן קוסמטיקה', shoot_at: IL(2026, 10, 20, 10).toISOString() });
  const niro = client({ id: 'n', business: 'נירו', shoot_type: 'niro', shoot_at: IL(2026, 10, 20, 9).toISOString() });
  const arik = client({ id: 'k', business: 'אריק', shoot_type: 'arik', shoot_at: IL(2026, 10, 21, 9).toISOString() });
  const round = client({ id: 'r', business: 'גולן', shoot_at: IL(2026, 9, 1, 10).toISOString(), rounds: [{ n: 2, shoot_at: IL(2026, 10, 22, 11).toISOString() }, { n: 3, shoot_at: IL(2026, 10, 23, 11).toISOString(), shoot_type: null, shoot_crew: 'eli' }] });
  const days = nataliDays([a, b, niro, arik, round], { after: IL(2026, 10, 12, 10) });
  assert.deepEqual(days.map((d) => [d.day, +d.shootAt, d.cases.map((c) => `${c.business}${c.pre}`)]), [
    ['2026-10-20', +IL(2026, 10, 20, 10), ['חן קוסמטיקה', 'פרץ יוגה']],
    ['2026-10-22', +IL(2026, 10, 22, 11), ['גולןr2.']],
  ]);
  assert.deepEqual(makeupKeys('r2.'), ['r2.p11b.makeup', 'r2.p15.natali.makeup']);
  // The page's rows group the same way.
  const rows = [{ day: '2026-10-20', shoot_at: IL(2026, 10, 20, 13).toISOString(), business: 'פרץ יוגה', round: 1 }, { day: '2026-10-20', shoot_at: IL(2026, 10, 20, 10).toISOString(), business: 'חן קוסמטיקה', round: 1 }];
  assert.deepEqual(daysFromRows(rows).map((d) => [d.day, +d.shootAt, d.cases.length]), [['2026-10-20', +IL(2026, 10, 20, 10), 2]]);
  // The timeline of Lior's day still says the makeup is two hours before (Niro's day too: his own artist).
  assert.ok(timeline(shootCases(niro)[0]).some((t) => t.key === 'makeup'));
});

test('where an answer stands; what Lior reads; what he is told of each answer', () => {
  const [day] = groupDays([{ cid: 'a', business: 'פרץ יוגה', n: 1, pre: '', shootAt: IL(2026, 10, 20, 10) }]);
  const yes = { id: 1, day: '2026-10-20', shoot_at: IL(2026, 10, 20, 10).toISOString(), answer: 'yes', arrive_time: '07:30', at: IL(2026, 10, 13, 9).toISOString() };
  assert.equal(statusOf(day, null), 'open');
  assert.equal(statusOf(day, yes), 'yes');
  assert.equal(statusOf(day, { ...yes, answer: 'no', arrive_time: null }), 'no');
  assert.equal(statusOf(day, { ...yes, shoot_at: IL(2026, 10, 20, 9).toISOString() }), 'again');
  assert.equal(liorWords(day, null), null, 'no answer: the item is his, as before');
  assert.deepEqual(liorWords(day, yes), { status: 'yes', done: true, text: 'טל אישרה, מגיעה ב־07:30' });
  assert.deepEqual(liorWords(day, { ...yes, answer: 'no' }), { status: 'no', done: false, text: 'טל לא יכולה · לסדר מאפרת אחרת' });
  assert.equal(liorWords(day, { ...yes, shoot_at: IL(2026, 10, 20, 9).toISOString() }).done, false);
  assert.equal(answerFor(day, [yes, { ...yes, id: 2, answer: 'no', at: IL(2026, 10, 13, 10).toISOString() }]).id, 2);
  // Every answer is news for Lior.
  assert.deepEqual(answerNews(day, yes, null), { kind: 'yes', title: 'טל אישרה את יום ג׳ 20.10 10:00 של פרץ יוגה, מגיעה לנטלי ב־07:30', body: 'המאפרת סומנה בהכנות ליום הצילום.' });
  assert.equal(answerNews(day, { ...yes, arrive_time: '08:00' }, yes).kind, 'hour');
  assert.equal(answerNews(day, { ...yes, arrive_time: '08:00' }, yes).body, 'מגיעה לנטלי ב־08:00 (במקום 07:30).');
  assert.equal(answerNews(day, { ...yes, answer: 'no', arrive_time: null }, yes).kind, 'no');
  assert.equal(answerNews(day, yes, { ...yes, answer: 'no' }).kind, 'yesAfterNo');
});

// ── Her notifications ─────────────────────
test('a day with Natali is set, gets a second client, moves, is cancelled: she is told at once, each once; Niro\'s day is not hers', async () => {
  const a = client({ id: 'a' });
  const b = client({ id: 'b', business: 'חן קוסמטיקה' });
  const niro = client({ id: 'n', business: 'נירו', shoot_type: 'niro' });
  const db = fakeDb({ clients: [a, b, niro], checks: [...history(a), ...history(b), ...history(niro)] });
  const { push, sent } = fakePush();
  let now = IL(2026, 10, 12, 10);
  const tick = async (minutes = 1) => { now = new Date(now.getTime() + minutes * MIN); sent.length = 0; await Promise.all([runTick({ db: db.at(now), push, now }), runTick({ db: db.at(now), push, now })]); return talOf(sent); };
  assert.deepEqual(await tick(), []);
  niro.shoot_at = IL(2026, 10, 20, 9).toISOString();
  assert.deepEqual(await tick(), [], 'Niro\'s day is not hers');
  a.shoot_at = IL(2026, 10, 20, 10).toISOString();
  assert.deepEqual(await tick(), [['נקבע יום צילום עם נטלי: יום ג׳ 20.10 10:00', 'הצילום ב־10:00. לאשר באפליקציה ולכתוב באיזו שעה את מגיעה לנטלי.']]);
  const row = db.log.find((r) => r.rule === MAKEUP_SET);
  assert.deepEqual([row.person, row.url, row.level, row.client_id], ['tal', 'makeup.html', 'ring', null]);
  assert.equal(makeupToldOf(row).day, '2026-10-20');
  assert.equal(templateFor({ rule: MAKEUP_SET, key: row.key, person: 'tal' }), 'shoot_day');
  // A second client the same day, later: the day's hour is the same, no news.
  b.shoot_at = IL(2026, 10, 20, 13).toISOString();
  assert.deepEqual(await tick(), []);
  // The first shoot moves earlier: moved.
  a.shoot_at = IL(2026, 10, 20, 9).toISOString();
  assert.deepEqual(await tick(), [['יום הצילום עם נטלי זז: יום ג׳ 20.10 09:00', 'הצילום ב־09:00. במקום יום ג׳ 20.10 10:00. לאשר שוב באפליקציה ולכתוב באיזו שעה את מגיעה לנטלי.']]);
  assert.deepEqual(await tick(60), []);
  // Both leave the day: cancelled.
  a.shoot_at = null;
  b.shoot_at = null;
  assert.deepEqual(await tick(), [['יום הצילום עם נטלי בוטל: יום ג׳ 20.10 09:00', 'לא צריך להגיע ביום הזה.']]);
  assert.deepEqual(await tick(), []);
  // A round with Natali on another day.
  a.rounds = [{ n: 2, shoot_at: IL(2026, 10, 27, 11).toISOString() }];
  assert.deepEqual((await tick()).map((t) => t[0]), ['נקבע יום צילום עם נטלי: יום ג׳ 27.10 11:00']);
});

test('the hours: a far day set at night waits for her morning digest; one within two days is told at once', async () => {
  const a = client({ id: 'a' });
  const db = fakeDb({ clients: [a], checks: history(a) });
  const { push, sent } = fakePush();
  const night = IL(2026, 10, 12, 22);
  a.shoot_at = IL(2026, 10, 20, 10).toISOString();
  await runTick({ db: db.at(night), push, now: night });
  assert.deepEqual(talOf(sent), []);
  assert.equal(db.log.find((r) => r.rule === MAKEUP_SET).status, 'queued');
  const b = client({ id: 'b', business: 'חן קוסמטיקה', shoot_at: IL(2026, 10, 14, 10).toISOString() });
  const db2 = fakeDb({ clients: [b], checks: history(b) });
  await runTick({ db: db2.at(night), push, now: night });
  assert.deepEqual(talOf(sent).map((t) => t[0]), ['נקבע יום צילום עם נטלי: יום ד׳ 14.10 10:00']);
});

test('no login for her yet (no staff row): nothing is told', async () => {
  const a = client({ id: 'a', shoot_at: IL(2026, 10, 20, 10).toISOString() });
  const db = fakeDb({ clients: [a], checks: history(a), staff: STAFF.filter((s) => s.person !== 'tal') });
  const { push, sent } = fakePush();
  await runTick({ db: db.at(IL(2026, 10, 12, 10)), push, now: IL(2026, 10, 12, 10) });
  assert.deepEqual(talOf(sent), []);
});

// ── Lior hears every answer ───────────────
test('Lior is told of every answer at once: confirmed with her hour, a new hour, "לא יכולה" (a ring), confirmed again; each once', async () => {
  const a = client({ id: 'a', shoot_at: IL(2026, 10, 20, 10).toISOString() });
  const b = client({ id: 'b', business: 'חן קוסמטיקה', shoot_at: IL(2026, 10, 20, 13).toISOString() });
  const db = fakeDb({ clients: [a, b], checks: [...history(a), ...history(b)] });
  const { push, sent } = fakePush();
  let now = IL(2026, 10, 13, 10);
  let id = 0;
  const say = (answer, hour = null) => db.answers.push({ id: ++id, day: '2026-10-20', shoot_at: a.shoot_at, answer, arrive_time: hour, at: now.toISOString() });
  const tick = async () => { now = new Date(now.getTime() + MIN); sent.length = 0; await Promise.all([runTick({ db: db.at(now), push, now }), runTick({ db: db.at(now), push, now })]); return liorOf(sent); };
  await tick();
  say('yes', '07:30');
  assert.deepEqual(await tick(), [['טל אישרה את יום ג׳ 20.10 10:00 של פרץ יוגה, חן קוסמטיקה, מגיעה לנטלי ב־07:30', 'המאפרת סומנה בהכנות ליום הצילום.']]);
  assert.deepEqual(await tick(), []);
  say('yes', '08:00');
  assert.deepEqual(await tick(), [['טל שינתה את שעת ההגעה: יום ג׳ 20.10 10:00 של פרץ יוגה, חן קוסמטיקה', 'מגיעה לנטלי ב־08:00 (במקום 07:30).']]);
  say('no');
  assert.deepEqual(await tick(), [['טל לא יכולה להגיע ליום הצילום עם נטלי · יום ג׳ 20.10 10:00', 'פרץ יוגה, חן קוסמטיקה. לסדר מאפרת אחרת.']]);
  assert.equal(db.log.filter((r) => r.rule === MAKEUP_ANSWER).at(-1).level, 'ring');
  say('yes', '07:45');
  assert.deepEqual(await tick(), [['טל אישרה את יום ג׳ 20.10 10:00 של פרץ יוגה, חן קוסמטיקה, מגיעה לנטלי ב־07:45', 'קודם אמרה שלא תוכל. אם כבר סודרה מאפרת אחרת, לעדכן אותה.']]);
  for (let n = 0; n < 30; n += 1) assert.deepEqual(await tick(), []);
  assert.deepEqual(db.log.filter((r) => r.rule === MAKEUP_ANSWER).map((r) => `${r.key.split(':').at(-1)} ${r.channel}/${r.status}`),
    ['yes@lior push/sent', 'hour@lior push/sent', 'no@lior push/sent', 'yesAfterNo@lior push/sent']);
});

test('an answer at night: within two days of the shoot Lior hears at once; further ahead it waits for his morning digest', async () => {
  const night = IL(2026, 10, 12, 22);
  for (const [shoot, day, status] of [[IL(2026, 10, 14, 10), '2026-10-14', 'sent'], [IL(2026, 10, 20, 10), '2026-10-20', 'queued']]) {
    const a = client({ id: 'a', shoot_at: shoot.toISOString() });
    const db = fakeDb({ clients: [a], checks: history(a), answers: [{ id: 1, day, shoot_at: shoot.toISOString(), answer: 'no', arrive_time: null, at: night.toISOString() }] });
    const { push } = fakePush();
    await runTick({ db: db.at(night), push, now: night });
    assert.equal(db.log.find((r) => r.rule === MAKEUP_ANSWER).status, status, String(shoot));
  }
});

// ── Who she is ────────────────────────────
test('her screen is the only one: no bar, no tasks, no notes, no bot; she lands on it; she has reminders', () => {
  assert.equal(isMakeup('tal'), true);
  assert.equal(PEOPLE.tal.name, 'טל');
  assert.equal(scopeOf('tal'), 'makeup');
  const v = { me: 'tal', scope: 'makeup', error: null };
  assert.deepEqual(menuOf(v), [{ id: 'makeup', href: 'makeup.html', label: 'הימים שלי עם נטלי' }]);
  assert.deepEqual(barOf(menuOf(v), v), { bar: [], more: [] });
  assert.equal(homeHref(v), 'makeup.html');
  assert.deepEqual(afterSignIn(v, { pathname: '/clients.html' }), { go: 'makeup.html' });
  assert.equal(landingOf('tal'), 'makeup.html');
  assert.equal(canAsk(v), false);
  assert.ok(!STAFF_PEOPLE().some((p) => p.key === 'tal'));
  assert.ok(TEAM_PEOPLE().some((p) => p.key === 'tal'), 'on the team screen, to add her login');
  assert.ok(!ASSIGNEES().some((p) => p.key === 'tal'));
  assert.ok(!NOTE_PEOPLE().some((p) => p.key === 'tal'));
  assert.ok(REMINDER_PEOPLE.has('tal'));
  assert.equal(RULES.filter((r) => [MAKEUP_SET, MAKEUP_ANSWER].includes(r.id)).length, 2);
});
