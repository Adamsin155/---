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
import { dateIL } from '../app/tz.js';

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
    async insertLog(rows) {
      const out = [];
      for (const r of rows) {
        if (db.log.some((x) => x.key === r.key)) continue; // ON CONFLICT (key) DO NOTHING
        const row = { id: db.nextId++, created_at: clock.toISOString(), read_at: null, digest_key: null, ...r };
        db.log.push(row);
        out.push({ ...row });
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
  assert.equal(sent[0].payload.tag, 'deal:c1:deal:now@irit');
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
  assert.equal(sent.filter((s) => /פיצה/.test(s.payload.title)).length, 0);
  assert.ok(stats.stale >= 4);
  assert.ok(db.log.filter((r) => r.client_id === 'c1').every((r) => r.status === 'suppressed' && r.reason === 'stale'));
});

test('overnight: a deal at 22:00 waits; the 08:30 digest carries it and the 09:05 step, then marks them sent', async () => {
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
  assert.match(digest.payload.body, /^עברו 5 דקות: לילה$/m);
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
