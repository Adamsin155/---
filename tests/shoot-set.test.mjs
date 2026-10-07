// The photographer and his shoot days (the owner's rule of 7.10.2026: "כאשר יש יום
// צילום צריך להכניס לצלם תזכורת לשעה שקבעו ליום הצילום שלו, שעה קודם תמיד";
// docs/ops.md, section 40), at fixed Israel times (npm test runs this under UTC, New
// York and Jerusalem):
//   - the rule `shootSet` (app/reminder-rules.js): he is told the moment a shoot day is
//     set, moved or taken off, the main one and an extra round's, with the client, the
//     day, the address and HIS time, an hour before the shoot time; once each, also when
//     a day moves back and forth or is set again after it was taken off;
//   - through one minute of the server (supabase/functions/reminders/tick.js) and two
//     that overlap: the log's key lets each notice out once;
//   - the hours: a far shoot day set at night waits for the morning digest, one within
//     two days is told at once; and the ring an hour before his arrival goes out before
//     the sending hours and on a Friday, so no second morning reminder is needed;
//   - everything he gets for one shoot day, in order, and that every text with a time
//     names his own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTick } from '../supabase/functions/reminders/tick.js';
import { buildEnv, computeReminders, planDelivery } from '../app/reminder-engine.js';
import { RULES, RULE_BY_ID, SHOOT_SET, toldOf, arrivalText } from '../app/reminder-rules.js';
import { templateFor } from '../app/wa-templates.js';
import { importKeys } from '../app/client-open.js';
import { IMPORT_NOTE } from '../app/protocol-logic.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const MIN = 6e4;
const KEY = 'B' + 'A'.repeat(86);
const STAFF = [{ email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' }, { email: 'ofir@x', person: 'ofir' }, { email: 'eli@x', person: 'eli' }];
const client = (o = {}) => ({
  id: 'c1', name: 'מאפיית שי', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [], contract_end: '2027-12-31',
  deal_at: IL(2026, 9, 1, 10).toISOString(), address: 'הנביאים 5, חיפה', shoot_at: null, ...o,
});
// Everything up to the shoot day is history, so only the shoot day's own rules speak.
const history = (c) => importKeys('shoot').map((k) => ({ client_id: c.id, item_key: k, state: 'done', note: IMPORT_NOTE, at: IL(2026, 9, 1, 9).toISOString() }));

// The database as index.ts gives it to the tick: `shootTold` is the rule's own rows of the log.
function fakeDb({ clients = [], checks = [], subs = [{ email: 'eli@x', endpoint: 'https://push.test/eli' }] } = {}) {
  let clock = new Date();
  const db = {
    log: [], subs: subs.map((s, i) => ({ id: `s${i}`, p256dh: KEY, auth: 'A'.repeat(22), fail_count: 0, ...s })), nextId: 1,
    at(now) { clock = now; return db; },
    async load() {
      return {
        clients: clients.map((c) => ({ ...c })), checks, tasks: [], staff: STAFF, access: [], reviews: [], statusNotes: [], messages: [],
        subscriptions: db.subs.map((s) => ({ ...s })), log: db.log.map((r) => ({ ...r })),
        shootTold: db.log.filter((r) => r.rule === SHOOT_SET).map((r) => ({ id: r.id, key: r.key, title: r.title, created_at: r.created_at })),
      };
    },
    async known(keys) { const set = new Set(keys); return new Set(db.log.map((r) => r.key).filter((k) => set.has(k))); },
    async insertLog(rows) {
      const out = [];
      for (const r of rows) {
        // The table's checks (20260930110000_reminders.sql): the rule's name, the key, the ref.
        assert.ok(/^[a-zA-Z0-9]+$/.test(r.rule) && r.key.length <= 400 && r.title.length <= 300 && (r.ref === null || /^(r[0-9]+\.)?p[0-9]+[ab]?$/.test(r.ref)), r.key);
        if (db.log.some((x) => x.key === r.key)) continue; // ON CONFLICT (key) DO NOTHING
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
const eliOf = (sent) => sent.filter((s) => s.endpoint === 'https://push.test/eli');
const told = (db) => db.log.filter((r) => r.rule === SHOOT_SET).map((r) => `${r.key.split(':').at(-1)} ${r.channel}/${r.status}`);

test('the rule is registered once; its log rows are read back from their keys', () => {
  assert.equal(RULES.filter((r) => r.id === SHOOT_SET).length, 1);
  assert.equal(RULE_BY_ID.get(SHOOT_SET).id, 'shootSet');
  const iso = IL(2026, 10, 20, 11).toISOString();
  assert.deepEqual(toldOf({ id: 7, key: `shootSet:c1:p17b@${iso}:set@eli`, title: 'x' }), { id: 7, cid: 'c1', case: `p17b@${iso}`, proc: 'p17b', at: new Date(iso), step: 'set', person: 'eli', title: 'x' });
  const moved = toldOf({ id: 9, key: `shootSet:8f14e45f-ceea-4672-9c41-000000000001:r2-p17b@${iso}#7:changed@eli` });
  assert.deepEqual([moved.cid, moved.case, moved.proc, moved.step, +moved.at], ['8f14e45f-ceea-4672-9c41-000000000001', `r2-p17b@${iso}#7`, 'r2-p17b', 'changed', +new Date(iso)]);
  for (const key of ['deal:c1:deal:now@irit', 'shootSet:c1:p17b@nonsense:set@eli', 'shootSet:c1:p19@2026-10-20T08:00:00.000Z:set@eli']) assert.equal(toldOf({ id: 1, key }), null, key);
  assert.equal(arrivalText(IL(2026, 10, 20, 11)), 'ההגעה שלך ב־10:00, שעה לפני הצילום (11:00)');
  assert.equal(arrivalText(IL(2026, 10, 20, 8, 30)), 'ההגעה שלך ב־07:30, שעה לפני הצילום (08:30)');
});

test('a shoot day is set: Eli is told at once, with the client, the day, the address and his own time; once, also with two ticks at the same minute', async () => {
  const c = client();
  const db = fakeDb({ clients: [c], checks: history(c) });
  const { push, sent } = fakePush();
  // No shoot day yet: nothing for him.
  const t0 = IL(2026, 10, 12, 10);
  await runTick({ db: db.at(t0), push, now: t0 });
  assert.deepEqual(told(db), []);
  // Irit sets it for Tuesday 20.10 at 11:00. The next minute, twice at once.
  c.shoot_at = IL(2026, 10, 20, 11).toISOString();
  const t1 = IL(2026, 10, 12, 10, 1);
  await Promise.all([runTick({ db: db.at(t1), push, now: t1 }), runTick({ db: db.at(t1), push, now: t1 })]);
  assert.deepEqual(eliOf(sent).map((s) => [s.title, s.body, s.url, s.level]), [[
    'נקבע יום צילום: מאפיית שי · ג׳ 20.10.2026', 'ההגעה שלך ב־10:00, שעה לפני הצילום (11:00) · הנביאים 5, חיפה.', 'shoot.html?id=c1', 'ring',
  ]]);
  assert.deepEqual(told(db), ['set@eli push/sent']);
  const row = db.log.find((r) => r.rule === SHOOT_SET);
  assert.deepEqual([row.key, row.person, row.ref, row.client_id, row.exempt], [`shootSet:c1:p17b@${c.shoot_at}:set@eli`, 'eli', null, 'c1', true]);
  // On WhatsApp it is a shoot-day message, like his other ones.
  assert.equal(templateFor({ rule: SHOOT_SET, key: row.key, person: 'eli' }), 'shoot_day');
  // Every minute for the next two hours, and the next morning: never again.
  for (let t = t1.getTime() + MIN; t <= t1.getTime() + 120 * MIN; t += MIN) await runTick({ db: db.at(new Date(t)), push, now: new Date(t) });
  await runTick({ db: db.at(IL(2026, 10, 13, 8, 30)), push, now: IL(2026, 10, 13, 8, 30) });
  assert.equal(eliOf(sent).filter((s) => /יום צילום/.test(s.title) && !/תקציר/.test(s.title)).length, 1);
  assert.deepEqual(told(db), ['set@eli push/sent']);
});

test('the day moves, moves back, is taken off and set again: he is told each time, with what it was; a day that passed is not news', async () => {
  const c = client({ shoot_at: IL(2026, 10, 20, 11).toISOString() });
  const db = fakeDb({ clients: [c], checks: history(c) });
  const { push, sent } = fakePush();
  let now = IL(2026, 10, 12, 10);
  const tick = async (minutes = 1) => { now = new Date(now.getTime() + minutes * MIN); sent.length = 0; await runTick({ db: db.at(now), push, now }); await runTick({ db: db.at(now), push, now }); return eliOf(sent).map((s) => [s.title, s.body]); };
  assert.equal((await tick())[0][0], 'נקבע יום צילום: מאפיית שי · ג׳ 20.10.2026');
  // Moved to Thursday 22.10 at 09:30.
  c.shoot_at = IL(2026, 10, 22, 9, 30).toISOString();
  assert.deepEqual(await tick(), [['יום הצילום זז: מאפיית שי · ה׳ 22.10.2026', 'ההגעה שלך ב־08:30, שעה לפני הצילום (09:30) · הנביאים 5, חיפה. במקום ג׳ 20.10.2026, הגעה ב־10:00.']]);
  assert.deepEqual(await tick(), []);
  // Only the hour changed (10:00 instead of 09:30): his time moved too.
  c.shoot_at = IL(2026, 10, 22, 10).toISOString();
  assert.deepEqual(await tick(), [['יום הצילום זז: מאפיית שי · ה׳ 22.10.2026', 'ההגעה שלך ב־09:00, שעה לפני הצילום (10:00) · הנביאים 5, חיפה. במקום ה׳ 22.10.2026, הגעה ב־08:30.']]);
  // Back to 09:30, where it already was once: told again (the case follows the row before it).
  c.shoot_at = IL(2026, 10, 22, 9, 30).toISOString();
  assert.equal((await tick())[0][1], 'ההגעה שלך ב־08:30, שעה לפני הצילום (09:30) · הנביאים 5, חיפה. במקום ה׳ 22.10.2026, הגעה ב־09:00.');
  // Taken off.
  c.shoot_at = null;
  assert.deepEqual(await tick(), [['יום הצילום בוטל: מאפיית שי · ה׳ 22.10.2026', 'ההגעה שלך הייתה ב־08:30. המועד ירד מהמערכת. כשייקבע מועד חדש תגיע הודעה.']]);
  assert.deepEqual(await tick(30), []);
  // Set again, for the very same time: news again.
  c.shoot_at = IL(2026, 10, 22, 9, 30).toISOString();
  assert.deepEqual(await tick(), [['נקבע יום צילום: מאפיית שי · ה׳ 22.10.2026', 'ההגעה שלך ב־08:30, שעה לפני הצילום (09:30) · הנביאים 5, חיפה.']]);
  assert.deepEqual(told(db), ['set@eli push/sent', 'changed@eli push/sent', 'changed@eli push/sent', 'changed@eli push/sent', 'cancelled@eli push/sent', 'set@eli push/sent']);
  assert.equal(new Set(db.log.filter((r) => r.rule === SHOOT_SET).map((r) => r.key)).size, 6);
  // The client stopped (no longer active): the day he was told of is off, in general words.
  c.status = 'frozen';
  const [[title, body]] = await tick();
  assert.equal(title, 'יום צילום בוטל · ה׳ 22.10.2026');
  assert.match(body, /^ההגעה שלך הייתה ב־08:30\. הלקוח כבר לא פעיל במערכת\. ההודעה הקודמת: נקבע יום צילום: מאפיית שי/);
  assert.deepEqual(await tick(), []);
  // A shoot day written into the card after it took place is not news; nor is one moved into the past.
  const old = client({ id: 'c2', name: 'עבר', shoot_at: IL(2026, 10, 5, 11).toISOString() });
  const db2 = fakeDb({ clients: [old], checks: history(old) });
  await runTick({ db: db2.at(IL(2026, 10, 12, 10)), push, now: IL(2026, 10, 12, 10) });
  assert.deepEqual(told(db2), []);
  // After the day itself nothing is "cancelled" either.
  const done = client({ id: 'c3', name: 'צולם', shoot_at: IL(2026, 10, 13, 11).toISOString() });
  const db3 = fakeDb({ clients: [done], checks: history(done) });
  await runTick({ db: db3.at(IL(2026, 10, 12, 10)), push, now: IL(2026, 10, 12, 10) });
  done.shoot_at = null;
  await runTick({ db: db3.at(IL(2026, 10, 14, 10)), push, now: IL(2026, 10, 14, 10) });
  assert.deepEqual(told(db3), ['set@eli push/sent']);
});

test('an extra round has its own notices, and the main day is not told again with it', async () => {
  const c = client({ shoot_at: IL(2026, 10, 20, 11).toISOString() });
  const db = fakeDb({ clients: [c], checks: history(c) });
  const { push, sent } = fakePush();
  const t0 = IL(2026, 10, 12, 10);
  await runTick({ db: db.at(t0), push, now: t0 });
  c.rounds = [{ n: 2, shoot_type: 'natali', shoot_at: IL(2026, 11, 10, 14).toISOString(), start_at: IL(2026, 10, 12, 10).toISOString() }];
  const t1 = IL(2026, 10, 12, 10, 5);
  await runTick({ db: db.at(t1), push, now: t1 });
  const titles = eliOf(sent).filter((s) => s.tag.startsWith('shootSet:')).map((s) => [s.title, s.body]);
  assert.deepEqual(titles, [
    ['נקבע יום צילום: מאפיית שי · ג׳ 20.10.2026', 'ההגעה שלך ב־10:00, שעה לפני הצילום (11:00) · הנביאים 5, חיפה.'],
    ['נקבע יום צילום: מאפיית שי (סבב 2) · ג׳ 10.11.2026', 'ההגעה שלך ב־13:00, שעה לפני הצילום (14:00) · הנביאים 5, חיפה.'],
  ]);
  assert.ok(db.log.some((r) => r.key === `shootSet:c1:r2-p17b@${c.rounds[0].shoot_at}:set@eli`));
  // The round is removed: that one is off; the main day stands.
  c.rounds = [];
  sent.length = 0;
  const t2 = IL(2026, 10, 12, 10, 9);
  await runTick({ db: db.at(t2), push, now: t2 });
  assert.deepEqual(eliOf(sent).map((s) => s.title), ['יום הצילום בוטל: מאפיית שי (סבב 2) · ג׳ 10.11.2026']);
});

test('the hours: a far day set at night waits for his 08:30 digest; a day within two days is told at once, at night too', async () => {
  // Monday 21:00, for the 20th: nobody is pushed at night.
  const c = client({ shoot_at: IL(2026, 10, 20, 11).toISOString() });
  const db = fakeDb({ clients: [c], checks: history(c) });
  const { push, sent } = fakePush();
  const night = IL(2026, 10, 12, 21);
  await runTick({ db: db.at(night), push, now: night });
  assert.equal(eliOf(sent).length, 0);
  assert.deepEqual(db.log.filter((r) => r.rule === SHOOT_SET).map((r) => [r.status, r.channel, r.reason]), [['queued', 'digest', 'quiet_hours']]);
  // Through the night nothing; at 08:30 his digest carries it, once.
  for (const t of [IL(2026, 10, 12, 23), IL(2026, 10, 13, 3), IL(2026, 10, 13, 8, 29)]) await runTick({ db: db.at(t), push, now: t });
  assert.equal(eliOf(sent).length, 0);
  const morning = IL(2026, 10, 13, 8, 30);
  await runTick({ db: db.at(morning), push, now: morning });
  await runTick({ db: db.at(new Date(morning.getTime() + MIN)), push, now: new Date(morning.getTime() + MIN) });
  assert.deepEqual(eliOf(sent).map((s) => [s.title, s.body, s.tag]), [['תקציר בוקר', 'נקבע יום צילום: מאפיית שי · ג׳ 20.10.2026', 'digest:morning:eli:2026-10-13']]);
  assert.deepEqual(db.log.filter((r) => r.rule === SHOOT_SET).map((r) => [r.status, r.channel, r.digest_key]), [['sent', 'digest', 'digest:morning:eli:2026-10-13']]);
  // Tuesday 21:30: tomorrow's shoot day (set long ago) moves to Thursday. He hears now.
  const soon = client({ id: 'c5', name: 'קפה דנה', shoot_at: IL(2026, 10, 14, 9).toISOString() });
  const db2 = fakeDb({ clients: [soon], checks: history(soon) });
  const p2 = fakePush();
  await runTick({ db: db2.at(IL(2026, 10, 5, 10)), push: p2.push, now: IL(2026, 10, 5, 10) });
  p2.sent.length = 0;
  soon.shoot_at = IL(2026, 10, 15, 9).toISOString();
  const eve = IL(2026, 10, 13, 21, 30);
  await runTick({ db: db2.at(eve), push: p2.push, now: eve });
  assert.deepEqual(eliOf(p2.sent).map((s) => s.title), ['יום הצילום זז: קפה דנה · ה׳ 15.10.2026']);
  // Taken off the evening before, on a Saturday night: at once as well.
  const sat = client({ id: 'c6', name: 'סושי', shoot_at: IL(2026, 10, 18, 9).toISOString() });
  const db3 = fakeDb({ clients: [sat], checks: history(sat) });
  const p3 = fakePush();
  await runTick({ db: db3.at(IL(2026, 10, 12, 10)), push: p3.push, now: IL(2026, 10, 12, 10) });
  p3.sent.length = 0;
  sat.shoot_at = null;
  await runTick({ db: db3.at(IL(2026, 10, 17, 22)), push: p3.push, now: IL(2026, 10, 17, 22) });
  assert.deepEqual(eliOf(p3.sent).map((s) => s.title), ['יום הצילום בוטל: סושי · א׳ 18.10.2026']);
});

// ── What Eli gets for one shoot day, and when ──────────────────────────────
const world = (c, checks, shootTold = []) => ({ clients: [c], checks, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, shootTold });
const byClient = (rows) => { const out = {}; for (const r of rows) (out[r.client_id] ||= {})[r.item_key] = r; return out; };

test('the ring an hour before his arrival goes out before the sending hours and on a Friday: no second morning reminder', () => {
  for (const shoot of [IL(2026, 10, 20, 8, 0), IL(2026, 10, 23, 9, 0), IL(2026, 10, 20, 7, 0)]) { // Tuesday 08:00, Friday 09:00, Tuesday 07:00
    const c = client({ shoot_at: shoot.toISOString() });
    const checks = byClient(history(c));
    const at = new Date(shoot.getTime() - 120 * MIN);
    const due = computeReminders({ ...world(c, checks), now: at }).filter((r) => r.person === 'eli' && r.rule === 'shoot');
    assert.deepEqual(due.map((r) => [r.step, r.shoot, r.exempt]), [['eli2h', true, 'shoot']], shoot.toISOString());
    assert.equal(due[0].title, 'בעוד שעה ההגעה שלך לצילום: מאפיית שי');
    assert.equal(due[0].body, `${arrivalText(shoot)} · הנביאים 5, חיפה.`);
    assert.deepEqual(planDelivery({ reminders: due, now: at }).map((r) => [r.channel, r.status]), [['push', 'sent']], `pushed at ${at.toISOString()}`);
  }
});

test('one shoot day, from the day it is set to its end: the list of what Eli gets, each once, and every time he is told is his own', () => {
  const shoot = IL(2026, 10, 20, 11);
  const c = client({ shoot_at: shoot.toISOString() });
  const rows = history(c).filter((r) => !/^p(16|17b|19b)\./.test(r.item_key));
  const checks = byClient(rows);
  const mark = (key, at, note = null) => { checks.c1[key] = { client_id: 'c1', item_key: key, state: 'done', note, at: at.toISOString() }; };
  const log = [];
  const got = [];
  const at = (now) => {
    const shootTold = log.filter((r) => r.rule === SHOOT_SET).map((r, i) => ({ id: i + 1, key: r.key, title: r.title }));
    const fresh = computeReminders({ ...world(c, checks, shootTold), now, log: log.map((r) => r.key) });
    for (const r of planDelivery({ reminders: fresh, now })) {
      log.push(r);
      // (His monthly availability, rule `availability`, is not about a shoot day.)
      if (r.person === 'eli' && r.rule !== 'availability') got.push([`${r.rule}.${r.step}`, r.status === 'suppressed' ? 'stale' : r.channel, r.title, r.body]);
    }
  };
  at(IL(2026, 10, 12, 10)); // set
  mark('p16.brief', IL(2026, 10, 19, 16), JSON.stringify({ label: 'כונן 3', notes: '' }));
  at(IL(2026, 10, 19, 17)); // the briefing, 17:00 the business day before
  at(IL(2026, 10, 19, 20));
  at(IL(2026, 10, 20, 8, 30)); // the morning of the day: nothing of its own
  at(IL(2026, 10, 20, 9, 0)); // an hour before his arrival
  at(IL(2026, 10, 20, 10, 0)); // his arrival time: nothing
  at(IL(2026, 10, 20, 10, 45)); // 15 minutes before the influencers
  at(IL(2026, 10, 20, 16, 30)); // the expected end (5.5 hours)
  assert.deepEqual(got.map((g) => g.slice(0, 2)), [
    ['shootSet.set', 'push'], ['briefing.eli', 'push'], ['shoot.eli2h', 'push'], ['shoot.eli15', 'push'], ['shoot.endEli', 'push'],
  ]);
  const text = Object.fromEntries(got.map((g) => [g[0], `${g[2]} | ${g[3]}`]));
  assert.equal(text['shootSet.set'], 'נקבע יום צילום: מאפיית שי · ג׳ 20.10.2026 | ההגעה שלך ב־10:00, שעה לפני הצילום (11:00) · הנביאים 5, חיפה.');
  assert.equal(text['briefing.eli'], 'תדריך לצילום מחר 11:00: מאפיית שי | ההגעה שלך ב־10:00, שעה לפני הצילום (11:00) · הנביאים 5, חיפה · כונן 3. ללחוץ "קיבלתי".');
  assert.equal(text['shoot.eli2h'], 'בעוד שעה ההגעה שלך לצילום: מאפיית שי | ההגעה שלך ב־10:00, שעה לפני הצילום (11:00) · הנביאים 5, חיפה.');
  assert.equal(text['shoot.eli15'], 'הבי־רול גמור? מאפיית שי | המשפיענים מגיעים בעוד 15 דקות. לענות כן או לא במסך יום הצילום.');
  assert.equal(text['shoot.endEli'], 'סיום יום הצילום: מאפיית שי | לסדר את הכונן ולמסור לליאור.');
  // Every message of his that states an hour of the shoot day states his arrival.
  for (const [id, , title, body] of got) {
    if (/\d{2}:\d{2}/.test(`${title} ${body}`)) assert.match(body, /ההגעה שלך ב־10:00, שעה לפני הצילום \(11:00\)/, id);
  }
});

test('with nobody set as the photographer on the staff list, the rule is silent', () => {
  const c = client({ shoot_at: IL(2026, 10, 20, 11).toISOString() });
  const env = buildEnv({ ...world(c, byClient(history(c))), staff: STAFF.filter((s) => s.person !== 'eli'), now: IL(2026, 10, 12, 10) });
  assert.deepEqual(computeReminders({ env }).filter((r) => r.rule === SHOOT_SET), []);
});
