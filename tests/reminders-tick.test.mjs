// One minute of the reminders function (supabase/functions/reminders/tick.js)
// against an in-memory database and push service: each step is claimed in the log
// once (also when two ticks overlap), pushed to every device of its person, a dead
// subscription (410) is removed, a failure is recorded on the row and on the
// device, a person without a device still gets it in the app, and the 08:30 digest
// carries what waited overnight. Also the test notification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTick, sendTest } from '../supabase/functions/reminders/tick.js';
import { importKeys } from '../app/client-open.js';
import { IMPORT_NOTE } from '../app/protocol-logic.js';
import { PROCESSES } from '../app/protocol.js';
import { dateIL } from '../app/tz.js';
import { pushPayload } from '../app/reminder-engine.js';
import { encryptPayload, b64uEncode, MAX_PAYLOAD } from '../supabase/functions/reminders/webpush.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const KEY = 'B' + 'A'.repeat(86);
const STAFF = [{ email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' }, { email: 'ofir@x', person: 'ofir' }];

function fakeDb({ clients = [], checks = [], tasks = [], subs = [] } = {}) {
  let clock = new Date();
  const db = {
    log: [], subs: subs.map((s, i) => ({ id: `s${i}`, p256dh: KEY, auth: 'A'.repeat(22), fail_count: 0, ...s })), nextId: 1,
    at(now) { clock = now; return db; },
    async load() {
      return { clients, checks, tasks, staff: STAFF, access: [], reviews: [], statusNotes: [], messages: [], subscriptions: db.subs.map((s) => ({ ...s })), log: db.log.map((r) => ({ ...r })) };
    },
    async known(keys) { const set = new Set(keys); return new Set(db.log.map((r) => r.key).filter((k) => set.has(k))); },
    // As PostgREST does: a batch is one statement, so one row that breaks a check of
    // the table (20260930110000_reminders.sql) refuses the whole batch.
    refuse: () => false,
    async insertLog(rows) {
      for (const r of rows) {
        const bad = !(r.title.length <= 300) || !(String(r.body ?? '').length <= 2000) || !(r.reason == null || r.reason.length <= 200)
          || !['pending', 'sent', 'queued', 'suppressed', 'failed'].includes(r.status)
          || !['owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli'].includes(r.person) || db.refuse(r);
        if (bad) throw Object.assign(new Error('new row violates check constraint'), { code: '23514' });
      }
      const out = [];
      for (const r of rows) {
        if (db.log.some((x) => x.key === r.key)) continue; // ON CONFLICT (key) DO NOTHING
        const row = { id: db.nextId++, created_at: clock.toISOString(), claimed_at: clock.toISOString(), attempts: 0, read_at: null, digest_key: null, ...r };
        db.log.push(row);
        out.push({ ...row });
      }
      return out;
    },
    // public.reminders_reclaim: pending rows claimed before `before`, taken again.
    async reclaim(before) {
      const out = [];
      for (const r of db.log) {
        if (r.status !== 'pending' || !(new Date(r.claimed_at) < before)) continue;
        Object.assign(r, { claimed_at: clock.toISOString(), attempts: r.attempts + 1 });
        out.push({ ...r });
      }
      return out;
    },
    async updateLog(ids, patch) { for (const r of db.log) if (ids.includes(r.id)) Object.assign(r, patch); },
    async subscriptionOk(id, now) { Object.assign(db.subs.find((s) => s.id === id), { last_ok_at: now.toISOString(), fail_count: 0, last_error: null }); },
    async subscriptionFailed(id, why) { const s = db.subs.find((x) => x.id === id); s.fail_count += 1; s.last_error = why; },
    async removeSubscription(id) { db.subs = db.subs.filter((s) => s.id !== id); },
    async subscriptionsOf(email) { return db.subs.filter((s) => s.email === email); },
    async recentTest(email, since) { return db.log.some((r) => r.rule === 'test' && r.key.startsWith(`test:${email}:`) && new Date(r.created_at) >= since); },
  };
  return db;
}
function fakePush(answers = {}) {
  const sent = [];
  const push = async (sub, payload, opts) => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), opts });
    const status = answers[sub.endpoint] ?? 201;
    return { ok: status === 201, status, gone: status === 404 || status === 410 };
  };
  return { push, sent };
}
const deal = (at, name = 'פיצה') => ({
  id: 'c1', name, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [], contract_end: '2027-12-31', deal_at: at.toISOString(),
});

test('a tick pushes each due step once to every device, removes a dead one and records the rest', async () => {
  const db = fakeDb({
    clients: [deal(IL(2026, 10, 5, 10))],
    subs: [{ email: 'irit@x', endpoint: 'https://push.test/phone' }, { email: 'irit@x', endpoint: 'https://push.test/old' }],
  });
  const { push, sent } = fakePush({ 'https://push.test/old': 410 });
  const t0 = IL(2026, 10, 5, 10);
  const stats = await runTick({ db: db.at(t0), push, now: t0 });
  assert.equal(stats.pushed, 1);
  assert.equal(stats.removed, 1);
  assert.deepEqual(sent.map((s) => s.endpoint).sort(), ['https://push.test/old', 'https://push.test/phone']);
  assert.equal(sent[0].payload.title, 'עסקה חדשה: פיצה');
  assert.equal(sent[0].payload.url, 'client.html?id=c1#p01');
  // The tag is the case, not the step: the next step of this deal replaces this banner and sounds again.
  assert.equal(sent[0].payload.tag, 'deal:c1:deal');
  assert.equal(sent[0].payload.renotify, true);
  assert.equal(sent[0].opts.urgency, 'high');
  const row = db.log.find((r) => r.key === 'deal:c1:deal:now@irit');
  assert.deepEqual([row.channel, row.status, row.reason], ['push', 'sent', '1 of 2 devices failed']);
  assert.ok(row.sent_at);
  assert.deepEqual(db.subs.map((s) => s.endpoint), ['https://push.test/phone']);
  // Next minute: nothing new. At 10:05 the second step.
  sent.length = 0;
  const t1 = IL(2026, 10, 5, 10, 1);
  assert.equal((await runTick({ db: db.at(t1), push, now: t1 })).pushed, 0);
  assert.equal(sent.length, 0);
  const t5 = IL(2026, 10, 5, 10, 5);
  await runTick({ db: db.at(t5), push, now: t5 });
  assert.deepEqual(sent.map((s) => s.payload.title), ['עברו 5 דקות: פיצה']);
});

test('a failing device: the row is "failed" with the reason, the device counts the failure; no device: in the app', async () => {
  const db = fakeDb({ clients: [deal(IL(2026, 10, 5, 10))], subs: [{ email: 'irit@x', endpoint: 'https://push.test/down' }] });
  const { push } = fakePush({ 'https://push.test/down': 500 });
  const t0 = IL(2026, 10, 5, 10);
  const stats = await runTick({ db: db.at(t0), push, now: t0 });
  assert.equal(stats.failed, 1);
  const row = db.log.find((r) => r.key === 'deal:c1:deal:now@irit');
  assert.deepEqual([row.status, row.reason], ['failed', 'push failed: 500']);
  assert.deepEqual([db.subs[0].fail_count, db.subs[0].last_error], [1, '500']);
  // Lior has no device: his step is in the app only.
  const t30 = IL(2026, 10, 5, 10, 30);
  await runTick({ db: db.at(t30), push, now: t30 });
  const lior = db.log.find((r) => r.key === 'deal:c1:deal:lior@lior');
  assert.deepEqual([lior.channel, lior.status, lior.reason], ['app', 'sent', 'no_device']);
});

test('two overlapping ticks send a step once', async () => {
  const db = fakeDb({ clients: [deal(IL(2026, 10, 5, 10))], subs: [{ email: 'irit@x', endpoint: 'https://push.test/phone' }] });
  const { push, sent } = fakePush();
  const t0 = IL(2026, 10, 5, 10);
  await Promise.all([runTick({ db: db.at(t0), push, now: t0 }), runTick({ db, push, now: t0 })]);
  assert.equal(sent.length, 1);
  assert.equal(db.log.filter((r) => r.key === 'deal:c1:deal:now@irit').length, 1);
});

test('first run on old data: nothing late is sent, it is recorded as stale', async () => {
  const db = fakeDb({ clients: [deal(IL(2026, 9, 1, 10))], subs: [{ email: 'irit@x', endpoint: 'https://push.test/phone' }, { email: 'lior@x', endpoint: 'https://push.test/lior' }] });
  const { push, sent } = fakePush();
  const now = IL(2026, 10, 5, 10);
  const stats = await runTick({ db: db.at(now), push, now });
  // The one thing said is today's: this client still has no meeting date, which rings Irit
  // every business morning (docs/ops.md, section 47). Nothing of the month before goes out.
  assert.deepEqual(sent.filter((s) => /פיצה/.test(s.payload.title)).map((s) => s.payload.title), ['עוד אין מועד לפגישת האפיון: פיצה']);
  assert.ok(stats.stale >= 4);
  const today = (r) => r.key === 'meetingDate:c1:p03:d2026-10-05@irit';
  assert.ok(db.log.filter((r) => r.client_id === 'c1' && !today(r)).every((r) => r.status === 'suppressed' && r.reason === 'stale'));
  assert.equal(db.log.filter(today).length, 1);
});

test('overnight: a deal at 22:00 waits; the 08:30 digest carries it and the 09:05 and 09:10 steps, then marks them sent', async () => {
  const db = fakeDb({ clients: [deal(IL(2026, 10, 4, 22), 'לילה')], subs: [{ email: 'irit@x', endpoint: 'https://push.test/phone' }] });
  const { push, sent } = fakePush();
  const night = IL(2026, 10, 4, 22);
  await runTick({ db: db.at(night), push, now: night });
  assert.equal(sent.length, 0);
  // The deal waits for the morning; Sunday's own digest lines, seen after hours, are over.
  assert.deepEqual(db.log.filter((r) => r.status === 'queued').map((r) => [r.key, r.reason]), [['deal:c1:deal:now@irit', 'quiet_hours']]);
  assert.ok(db.log.filter((r) => r.key.includes(':2026-10-04:')).every((r) => r.status === 'suppressed'));
  const morning = IL(2026, 10, 5, 8, 30);
  const stats = await runTick({ db: db.at(morning), push, now: morning });
  assert.ok(stats.digests >= 1); // Irit's, and Ofir's and Lior's own lines (control 33)
  const digest = sent.find((s) => s.payload.tag === 'digest:morning:irit:2026-10-05');
  assert.ok(digest, JSON.stringify(sent.map((s) => s.payload.tag)));
  assert.equal(digest.payload.title, 'תקציר בוקר');
  // Both steps of the deal are in it, as one line (the latest says it).
  assert.match(digest.payload.body, /^עברו 10 דקות בלי חוזה: לילה$/m);
  assert.match(digest.payload.body, /^היום: לילה \(3\)$/m);
  assert.equal(digest.opts.urgency, 'normal');
  const queued = db.log.find((r) => r.key === 'deal:c1:deal:now@irit');
  assert.deepEqual([queued.status, queued.channel, queued.digest_key], ['sent', 'digest', 'digest:morning:irit:2026-10-05']);
  const folded = db.log.find((r) => r.key === 'deal:c1:deal:due@irit');
  assert.deepEqual([folded.status, folded.channel, folded.reason], ['sent', 'digest', 'fold']);
  // 09:05: the folded step does not ring again; the digest is not sent twice.
  sent.length = 0;
  const later = IL(2026, 10, 5, 9, 5);
  await runTick({ db: db.at(later), push, now: later });
  assert.deepEqual(sent.map((s) => s.payload.tag), []);
  assert.equal(db.log.filter((r) => r.key.startsWith('digest:morning:irit')).length, 1);
});

test('a queued line that was resolved before the digest is dropped, not sent', async () => {
  const c = deal(IL(2026, 10, 4, 22), 'נסגר');
  const checks = [];
  const db = fakeDb({ clients: [c], checks, subs: [{ email: 'irit@x', endpoint: 'https://push.test/phone' }] });
  const { push, sent } = fakePush();
  await runTick({ db: db.at(IL(2026, 10, 4, 22)), push, now: IL(2026, 10, 4, 22) });
  // Irit did everything at 07:00 from home.
  for (const k of importKeys('char').filter((x) => /^p0[123]\./.test(x))) checks.push({ client_id: 'c1', item_key: k, state: 'done', note: null, at: IL(2026, 10, 5, 7).toISOString() });
  for (const k of importKeys('ongoing').filter((x) => !/^p0[123]\./.test(x))) checks.push({ client_id: 'c1', item_key: k, state: 'done', note: IMPORT_NOTE, at: IL(2026, 9, 1).toISOString() });
  await runTick({ db: db.at(IL(2026, 10, 5, 8, 30)), push, now: IL(2026, 10, 5, 8, 30) });
  const row = db.log.find((r) => r.key === 'deal:c1:deal:now@irit');
  assert.deepEqual([row.status, row.reason], ['suppressed', 'resolved']);
  assert.ok(!sent.some((s) => /נסגר/.test(s.payload.body || '')));
});

test('the test notification: only the caller\'s devices, at most one every 30 seconds', async () => {
  const db = fakeDb({ subs: [{ email: 'irit@x', endpoint: 'https://push.test/a' }, { email: 'irit@x', endpoint: 'https://push.test/b' }, { email: 'lior@x', endpoint: 'https://push.test/l' }] });
  const { push, sent } = fakePush();
  const now = IL(2026, 10, 5, 10);
  assert.deepEqual(await sendTest({ db: db.at(now), push, email: 'ofir@x', person: 'ofir', now }), { status: 404, body: { error: 'no_device' } });
  const ok = await sendTest({ db, push, email: 'irit@x', person: 'irit', endpoint: 'https://push.test/b', now });
  assert.deepEqual(ok, { status: 200, body: { ok: true, devices: 1, removed: 0 } });
  assert.deepEqual(sent.map((s) => s.endpoint), ['https://push.test/b']);
  assert.equal(sent[0].payload.title, 'התראת ניסיון');
  assert.equal(sent[0].opts.urgency, 'high');
  const row = db.log.find((r) => r.rule === 'test');
  assert.deepEqual([row.person, row.exempt, row.status], ['irit', true, 'sent']);
  const again = new Date(now.getTime() + 10e3);
  assert.equal((await sendTest({ db: db.at(again), push, email: 'irit@x', person: 'irit', now: again })).status, 429);
  const later = new Date(now.getTime() + 31e3);
  assert.equal((await sendTest({ db: db.at(later), push, email: 'irit@x', person: 'irit', now: later })).status, 200);
});

// ── Robustness: a tick that fails half way, and rows the database refuses ──
const until = async (cond) => { for (let i = 0; i < 1000 && !cond(); i += 1) await new Promise((r) => setTimeout(r, 1)); assert.ok(cond()); };

test('a tick that stops after claiming a push: a later tick sends it once, never while the first may still be sending', async () => {
  const db = fakeDb({ clients: [deal(IL(2026, 10, 5, 10))], subs: [{ email: 'irit@x', endpoint: 'https://push.test/phone' }] });
  const t0 = IL(2026, 10, 5, 10);
  // The first tick claims the step and is stopped while the push is in flight.
  let reached = false;
  runTick({ db: db.at(t0), push: () => { reached = true; return new Promise(() => {}); }, now: t0 });
  await until(() => reached);
  const row = () => db.log.find((r) => r.key === 'deal:c1:deal:now@irit');
  assert.equal(row().status, 'pending'); // claimed, not "sent": nothing reached a phone yet
  const { push, sent } = fakePush();
  const mine = () => sent.filter((s) => s.payload.tag === 'deal:c1:deal' && s.payload.title === 'עסקה חדשה: פיצה');
  // 5 minutes on, the first tick may still be alive: not taken.
  const t5 = IL(2026, 10, 5, 10, 5);
  await runTick({ db: db.at(t5), push, now: t5 });
  assert.equal(mine().length, 0);
  // 11 minutes on it is surely gone: sent now, once.
  const t11 = IL(2026, 10, 5, 10, 11);
  const stats = await runTick({ db: db.at(t11), push, now: t11 });
  assert.equal(stats.recovered, 1);
  assert.equal(mine().length, 1);
  assert.deepEqual([row().status, row().attempts], ['sent', 1]);
  const t25 = IL(2026, 10, 5, 10, 25);
  await runTick({ db: db.at(t25), push, now: t25 });
  assert.equal(mine().length, 1);
});

test('a pending push that is no longer true is dropped, and one hours old is recorded as lost, never sent late', async () => {
  const checks = [];
  const first = deal(IL(2026, 10, 5, 10), 'א');
  const db = fakeDb({ clients: [first, { ...deal(IL(2026, 10, 5, 10), 'ב'), id: 'c2' }], checks, subs: [{ email: 'irit@x', endpoint: 'https://push.test/phone' }] });
  const t0 = IL(2026, 10, 5, 10);
  let reached = 0;
  runTick({ db: db.at(t0), push: () => { reached += 1; return new Promise(() => {}); }, now: t0 });
  await until(() => reached === 2);
  // Irit handled client c1 meanwhile (the meeting has its date too); the tick of c2's step is long gone.
  first.char_at = IL(2026, 10, 6, 10).toISOString();
  for (const k of importKeys('char').filter((x) => /^p0[123]\./.test(x))) checks.push({ client_id: 'c1', item_key: k, state: 'done', note: null, at: IL(2026, 10, 5, 10, 2).toISOString() });
  const { push, sent } = fakePush();
  const t11 = IL(2026, 10, 5, 10, 11);
  await runTick({ db: db.at(t11), push, now: t11 });
  assert.deepEqual(sent.filter((s) => s.payload.title.startsWith('עסקה חדשה:')).map((s) => s.payload.tag), ['deal:c2:deal']);
  const c1 = db.log.find((r) => r.key === 'deal:c1:deal:now@irit');
  assert.deepEqual([c1.status, c1.reason], ['suppressed', 'resolved']);
  // Another one claimed at 13:00 and stopped; the engine is down until 15:30.
  const db2 = fakeDb({ clients: [deal(IL(2026, 10, 5, 13))], subs: [{ email: 'irit@x', endpoint: 'https://push.test/phone' }] });
  let hung = false;
  runTick({ db: db2.at(IL(2026, 10, 5, 13)), push: () => { hung = true; return new Promise(() => {}); }, now: IL(2026, 10, 5, 13) });
  await until(() => hung);
  const late = IL(2026, 10, 5, 15, 30);
  const p2 = fakePush();
  const stats = await runTick({ db: db2.at(late), push: p2.push, now: late });
  assert.equal(stats.lost, 1);
  assert.equal(p2.sent.filter((s) => s.payload.title.startsWith('עסקה חדשה:')).length, 0);
  assert.equal(db2.log.find((r) => r.key === 'deal:c1:deal:now@irit').status, 'failed');
});

test('one row the database refuses does not stop the tick: long text is cut to the columns, a bad row is left out and tried again', async () => {
  const c = deal(IL(2026, 10, 5, 10), 'ל'.repeat(200));
  const task = { id: 't1', client_id: 'c1', title: 'מ'.repeat(290), owner: 'irit', due_on: '2026-10-05', done_at: null, created_by_email: 'irit@x', created_at: IL(2026, 10, 1, 10).toISOString(), source: null, urgent: false, started_at: null };
  const db = fakeDb({ clients: [c], tasks: [task], subs: [{ email: 'irit@x', endpoint: 'https://push.test/phone' }] });
  // The database refuses one of the steps (say, a check this code does not know).
  db.refuse = (r) => r.key === 'deal:c1:deal:now@irit';
  const { push, sent } = fakePush();
  const t0 = IL(2026, 10, 5, 10);
  const stats = await runTick({ db: db.at(t0), push, now: t0 });
  assert.equal(stats.rejected, 1);
  const due = db.log.find((r) => r.key === 'task:c1:t1:due@irit');
  assert.ok(due, 'the task step is in the log');
  assert.ok(due.title.length <= 300 && due.title.endsWith('…'), due.title.length);
  assert.ok(!db.log.some((r) => r.key === 'deal:c1:deal:now@irit'));
  // Next minute the refusal is gone: the step is claimed and sent then.
  db.refuse = () => false;
  const t1 = IL(2026, 10, 5, 10, 1);
  await runTick({ db: db.at(t1), push, now: t1 });
  assert.equal(sent.filter((s) => s.payload.tag === 'deal:c1:deal' && s.payload.title.startsWith('עסקה חדשה:')).length, 1);
});

test('a push always fits the 4 KB of a Web Push message, even a long Hebrew digest', async () => {
  const payload = pushPayload({ id: 7, key: 'digest:owner18:owner:2026-10-05', title: 'ת'.repeat(300), body: 'ש'.repeat(2000), url: 'clients.html', level: 'digest' });
  assert.ok(new TextEncoder().encode(payload).length <= MAX_PAYLOAD);
  const msg = JSON.parse(payload);
  assert.ok(msg.body.endsWith('…') && msg.body.length > 500, msg.body.length);
  assert.equal(msg.tag, 'digest:owner18:owner:2026-10-05');
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64uEncode(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)));
  await encryptPayload(payload, { p256dh, auth: b64uEncode(crypto.getRandomValues(new Uint8Array(16))) }); // does not throw "payload too large"
  // A short one is unchanged.
  assert.equal(JSON.parse(pushPayload({ key: 'k', title: 'שלום', body: 'גוף', url: 'x.html', level: 'ring' })).body, 'גוף');
});

test('the test notification is only for people who have reminders', async () => {
  const db = fakeDb({ subs: [{ email: 'ed@x', endpoint: 'https://push.test/e' }] });
  const { push, sent } = fakePush();
  const now = IL(2026, 10, 5, 10);
  assert.deepEqual(await sendTest({ db: db.at(now), push, email: 'ed@x', person: 'editor', now }), { status: 403, body: { error: 'not_allowed' } });
  assert.equal(sent.length, 0);
});

test('a pending ring taken again after 19:00 waits for the morning digest instead of ringing', async () => {
  const db = fakeDb({ clients: [deal(IL(2026, 10, 5, 18, 55))], subs: [{ email: 'irit@x', endpoint: 'https://push.test/phone' }] });
  const t0 = IL(2026, 10, 5, 18, 55);
  let reached = false;
  runTick({ db: db.at(t0), push: () => { reached = true; return new Promise(() => {}); }, now: t0 });
  await until(() => reached);
  const { push, sent } = fakePush();
  const t = IL(2026, 10, 5, 19, 6);
  await runTick({ db: db.at(t), push, now: t });
  assert.equal(sent.filter((s) => s.payload.tag === 'deal:c1:deal').length, 0);
  const row = db.log.find((r) => r.key === 'deal:c1:deal:now@irit');
  assert.deepEqual([row.status, row.channel, row.reason], ['queued', 'digest', 'quiet_hours']);
});

// The owner's decision of 3.10.2026 (app/auto-assign.js): a shoot day closed with no
// editor gets one in the tick itself, and this minute's ladders already see it.
test('a tick assigns an editor when the shoot day was closed: written once, Ofir is not asked to assign', async () => {
  const items = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key);
  const shoot = IL(2026, 10, 18, 10);
  const c = { ...deal(IL(2026, 9, 1, 10), 'צולם'), id: 'c9', shoot_at: shoot.toISOString(), char_at: IL(2026, 10, 5, 10).toISOString() };
  const checks = importKeys('shoot').map((k) => ({ client_id: c.id, item_key: k, state: 'done', note: IMPORT_NOTE, at: IL(2026, 9, 1, 9).toISOString() }))
    .filter((r) => !/^p(17|17b|18|18b|19|19b|20|21)\./.test(r.item_key));
  for (const k of items('p19')) checks.push({ client_id: c.id, item_key: k, state: 'done', note: null, at: IL(2026, 10, 18, 17).toISOString() });
  const tasks = [];
  const db = fakeDb({ clients: [c], checks, tasks });
  const writes = [];
  db.autoAssign = async (a, now) => {
    writes.push(a);
    Object.assign(c, a.patch || {});
    for (const x of [...a.checks, a.reason]) checks.push({ client_id: c.id, item_key: x.key, state: 'done', note: x.note, at: now.toISOString() });
    if (a.task) tasks.push({ id: `t${tasks.length}`, ...a.task, created_at: now.toISOString() });
    return true;
  };
  const { push } = fakePush();
  const t = IL(2026, 10, 18, 17, 1);
  const stats = await runTick({ db: db.at(t), push, now: t });
  assert.equal(stats.assigned, 1);
  assert.deepEqual(writes.map((a) => [a.clientId, a.editor]), [['c9', 'nadia']]);
  assert.equal(c.editor, 'nadia');
  assert.ok(!db.log.some((r) => r.rule === 'assign'), 'Ofir is not asked to assign');
  assert.ok(db.log.some((r) => r.rule === 'autoAssigned' && r.person === 'ofir' && r.level === 'quiet'));
  // The next minute: nothing to assign again.
  const t2 = IL(2026, 10, 18, 17, 2);
  assert.equal((await runTick({ db: db.at(t2), push, now: t2 })).assigned, 0);
  assert.equal(writes.length, 1);
  // A database without the writer (an older deploy): the tick still runs, and Ofir is asked as before.
  const plain = fakeDb({ clients: [{ ...c, id: 'c10', editor: null }], checks: checks.filter((r) => !/^p22a\./.test(r.item_key)).map((r) => ({ ...r, client_id: 'c10' })) });
  assert.equal((await runTick({ db: plain.at(t), push, now: t })).assigned, 0);
  assert.ok(plain.log.some((r) => r.rule === 'assign' && r.person === 'ofir'));
});

// ── The owner's rule of 7.10.2026: "אין הודעות שקטות, הכל מקבל התראה לפלאפון" ──
test('an update (level "quiet") is pushed like a ring, in the sending hours only; one that came at night is a line of the morning digest', async () => {
  const c = deal(IL(2026, 9, 1, 10), 'הסכם');
  const checks = importKeys('ongoing').map((k) => ({ client_id: 'c1', item_key: k, state: 'done', note: IMPORT_NOTE, at: IL(2026, 9, 1, 9).toISOString() }));
  // A task Lior opened for Irit, at 10:00 and another at 21:00: "משימה חדשה" is an update.
  const task = (id, at) => ({ id, client_id: 'c1', title: `משימה ${id}`, owner: 'irit', due_on: '2026-10-20', done_at: null, created_by_email: 'lior@x', created_at: at.toISOString(), source: null, urgent: false, started_at: null });
  const tasks = [task('t1', IL(2026, 10, 5, 10))];
  const db = fakeDb({ clients: [c], checks, tasks, subs: [{ email: 'irit@x', endpoint: 'https://push.test/irit' }] });
  const { push, sent } = fakePush();
  const t0 = IL(2026, 10, 5, 10);
  await Promise.all([runTick({ db: db.at(t0), push, now: t0 }), runTick({ db, push, now: t0 })]);
  const mine = () => sent.filter((s) => s.payload.title === 'משימה חדשה: הסכם');
  assert.deepEqual(mine().map((s) => [s.payload.body, s.payload.level, s.payload.tag, s.opts.urgency]), [['משימה t1', 'quiet', 'task:c1:t1', 'high']]);
  const row = db.log.find((r) => r.key === 'task:c1:t1:created@irit');
  assert.deepEqual([row.level, row.channel, row.status], ['quiet', 'push', 'sent']);
  // At 21:00: nobody is pushed at night. It waits, and is a line of her 08:30 digest.
  tasks.push(task('t2', IL(2026, 10, 5, 21)));
  const night = IL(2026, 10, 5, 21);
  await runTick({ db: db.at(night), push, now: night });
  assert.equal(mine().length, 1);
  const waiting = () => db.log.find((r) => r.key === 'task:c1:t2:created@irit');
  assert.deepEqual([waiting().channel, waiting().status, waiting().reason], ['digest', 'queued', 'quiet_hours']);
  const morning = IL(2026, 10, 6, 8, 30);
  await runTick({ db: db.at(morning), push, now: morning });
  const digest = sent.find((s) => s.payload.tag === 'digest:morning:irit:2026-10-06');
  assert.match(digest.payload.body, /^משימה חדשה: הסכם$/m);
  assert.deepEqual([waiting().status, waiting().channel, waiting().digest_key], ['sent', 'digest', 'digest:morning:irit:2026-10-06']);
  assert.equal(mine().length, 1, 'never pushed late by itself');
});

test('a burst in a tick: six rings for Irit in one minute are one push that lists them, sent that minute and once; each is its own row', async () => {
  const names = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];
  const clients = names.map((x, i) => ({ ...deal(IL(2026, 10, 5, 10), `לקוח ${x}`), id: `c${i + 1}` }));
  const db = fakeDb({ clients, subs: [{ email: 'irit@x', endpoint: 'https://push.test/irit' }] });
  const { push, sent } = fakePush();
  const t0 = IL(2026, 10, 5, 10);
  await Promise.all([runTick({ db: db.at(t0), push, now: t0 }), runTick({ db: db.at(t0), push, now: t0 })]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.title, '6 הודעות חדשות');
  assert.equal(sent[0].payload.body, 'פרטי עסקה התקבלו (1, 2, 3) (6): לקוח א, לקוח ב, לקוח ג ועוד 3');
  assert.match(sent[0].payload.tag, /^digest:burst:irit:2026-10-05:\d+$/);
  const rows = db.log.filter((r) => r.rule === 'deal' && r.person === 'irit');
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.level === 'ring' && r.status === 'sent' && r.channel === 'digest' && r.digest_key === sent[0].payload.tag));
  // The next minute: nothing again. At 10:05 the six "עברו 5 דקות" are one push as well.
  const t1 = IL(2026, 10, 5, 10, 1);
  await runTick({ db: db.at(t1), push, now: t1 });
  assert.equal(sent.length, 1);
  const t5 = IL(2026, 10, 5, 10, 5);
  await runTick({ db: db.at(t5), push, now: t5 });
  assert.deepEqual(sent.map((s) => s.payload.title), ['6 הודעות חדשות', '6 הודעות חדשות']);
});

test('lateness notes in a tick: three late items are one push to Ofir and one to Lior, each item its own row; overlapping ticks send a batch once', async () => {
  // The characterization ended at 12:00: Ilai's graphics (7), Ofir's Highlights (8) and
  // Lior's part (10) are due two office hours later, and nobody did them.
  const c = { ...deal(IL(2026, 9, 1, 10), 'מאחר'), char_at: IL(2026, 10, 6, 10).toISOString() };
  const checks = importKeys('char').map((k) => ({ client_id: 'c1', item_key: k, state: 'done', note: IMPORT_NOTE, at: IL(2026, 9, 1, 9).toISOString() }));
  for (const i of PROCESSES.find((p) => p.id === 'p04').items.filter((x) => !x.optional)) checks.push({ client_id: 'c1', item_key: i.key, state: 'done', note: null, at: IL(2026, 10, 6, 12).toISOString() });
  const db = fakeDb({ clients: [c], checks, subs: [{ email: 'ofir@x', endpoint: 'https://push.test/ofir' }, { email: 'lior@x', endpoint: 'https://push.test/lior' }] });
  const { push, sent } = fakePush();
  // 14:00 the deadlines pass; 14:15 the grace is over. A tick every minute, twice (overlapping).
  for (let t = IL(2026, 10, 6, 14, 10).getTime(); t <= IL(2026, 10, 6, 14, 50).getTime(); t += 6e4) {
    const now = new Date(t);
    await Promise.all([runTick({ db: db.at(now), push, now }), runTick({ db: db.at(now), push, now })]);
  }
  const lateRows = (who) => db.log.filter((r) => r.rule === 'late' && r.person === who);
  const batches = (who) => db.log.filter((r) => r.key.startsWith(`digest:late:${who}:`));
  for (const who of ['ofir', 'lior']) {
    // Each late item is its own row of the log (and of "התראות"), sent in a batch.
    assert.ok(lateRows(who).length >= 3, `${who}: ${lateRows(who).length}`);
    assert.ok(lateRows(who).every((r) => r.level === 'quiet' && r.status === 'sent' && r.channel === 'digest' && r.reason === 'batch' && batches(who).some((b) => b.key === r.digest_key)), who);
    // One push for all of them, not one each; no note was pushed by itself.
    const pushes = sent.filter((s) => s.endpoint === `https://push.test/${who}` && s.payload.tag === `digest:late:${who}`);
    assert.equal(pushes.length, batches(who).length);
    assert.ok(pushes.length <= 2 && pushes.length < lateRows(who).length, `${who}: ${pushes.length} pushes for ${lateRows(who).length} notes`);
    assert.ok(pushes.every((p) => /^\d+ איחורים חדשים$/.test(p.payload.title) && p.payload.renotify === true), JSON.stringify(pushes.map((p) => p.payload.title)));
    assert.ok(pushes.some((p) => /מאחר · 7 · /.test(p.payload.body)), JSON.stringify(pushes.map((p) => p.payload.body)));
    // The batches are at least half an hour apart.
    const times = batches(who).map((b) => +new Date(b.created_at));
    assert.ok(times.every((t, i) => i === 0 || t - times[i - 1] >= 30 * 6e4), who);
    assert.equal(sent.filter((s) => s.endpoint === `https://push.test/${who}` && s.payload.title.startsWith('באיחור:')).length, 0);
    // None was lost: every note belongs to exactly one batch that went out.
    assert.ok(batches(who).every((b) => b.status === 'sent' && b.channel === 'push'));
    assert.equal(batches(who).reduce((sum, b) => sum + lateRows(who).filter((r) => r.digest_key === b.key).length, 0), lateRows(who).length);
  }
});
