// One minute of the reminder engine, and the test notification. No Deno APIs:
// index.ts passes a database adapter (`db`) and a push sender (`push`), and
// tests/reminders-tick.test.mjs passes fakes of both.
//
// A tick: load everything (service role) → the ladder steps due now
// (app/reminder-engine.js) → the ones the log does not have → where each one goes
// (push now, in the app, the next digest, or stale) → claim them in
// public.reminder_log (the key is unique, so two overlapping ticks never send the
// same step twice) → the digests due now → the pushes. A dead subscription (404 or
// 410) is removed; every other failure is recorded on the log row and on the
// subscription.
import {
  buildEnv, candidates, computeReminders, planDelivery, planDigests, pushPayload,
} from '../_shared/app/reminder-engine.js';
import { atIL, DIGESTS, FOLD } from '../_shared/app/reminder-rules.js';
import { isBusinessDay } from '../_shared/app/protocol-logic.js';

const MIN = 6e4;
// How long a push may wait at the push service before it is dropped (a ring is
// stale after a few hours; a digest is good for the day).
const TTL = { ring: 4 * 3600, digest: 12 * 3600, test: 600 };
const PARALLEL = 5;

const rowOf = (r, now) => ({
  key: r.key, rule: r.rule, person: r.person, level: r.level, channel: r.channel, status: r.status, reason: r.reason || null,
  exempt: !!r.exempt, client_id: r.clientId || null, ref: r.ref || null, title: r.title, body: r.body || '', url: r.url,
  due_at: r.at ? new Date(r.at).toISOString() : null, sent_at: r.status === 'sent' && r.channel !== 'push' ? now.toISOString() : null,
});

async function inChunks(list, size, work) {
  for (let i = 0; i < list.length; i += size) await Promise.all(list.slice(i, i + size).map(work));
}

// Sends one log row to every device of its person, and records what happened.
async function deliver({ db, push, env, row, kind, now, stats }) {
  const emails = new Set(env.emailsOf(row.person));
  const subs = env.subscriptions.filter((s) => emails.has(String(s.email).toLowerCase()));
  if (!subs.length) {
    await db.updateLog([row.id], { channel: 'app', reason: 'no_device', sent_at: now.toISOString() });
    stats.noDevice += 1;
    return;
  }
  const payload = pushPayload({ id: row.id, key: row.key, title: row.title, body: row.body, url: row.url, level: row.level });
  const results = await Promise.all(subs.map(async (s) => ({ s, r: await push(s, payload, { ttl: TTL[kind], urgency: kind === 'digest' ? 'normal' : 'high' }) })));
  for (const { s, r } of results) {
    if (r.ok) await db.subscriptionOk(s.id, now);
    else if (r.gone) { await db.removeSubscription(s.id); stats.removed += 1; }
    else await db.subscriptionFailed(s.id, `${r.status || r.error || 'error'}`);
  }
  const ok = results.filter((x) => x.r.ok).length;
  if (ok) {
    await db.updateLog([row.id], { status: 'sent', sent_at: now.toISOString(), reason: ok < results.length ? `${results.length - ok} of ${results.length} devices failed` : null });
    stats.pushed += 1;
  } else {
    const why = results.map((x) => x.r.status || x.r.error || 'error').join(',');
    await db.updateLog([row.id], { status: 'failed', reason: `push failed: ${why}`.slice(0, 200) });
    stats.failed += 1;
  }
}

/** @param {{ db: any, push: any, now?: Date }} args */
export async function runTick({ db, push, now = new Date() }) {
  const stats = { steps: 0, pushed: 0, queued: 0, app: 0, stale: 0, digests: 0, failed: 0, removed: 0, noDevice: 0, dropped: 0 };
  const input = await db.load(now);
  const env = buildEnv({ ...input, now });
  const all = candidates(env);
  const active = new Set(all.map((r) => r.key));
  const known = await db.known([...active]);
  const fresh = all.filter((r) => !known.has(r.key));
  const planned = planDelivery({ reminders: fresh, now, log: input.log, liorShoot: env.liorShoot });
  const inserted = planned.length ? await db.insertLog(planned.map((r) => rowOf(r, now))) : [];
  stats.steps = inserted.length;
  for (const r of inserted) {
    if (r.status === 'queued') stats.queued += 1;
    else if (r.status === 'suppressed') stats.stale += 1;
    else if (r.channel === 'app') stats.app += 1;
  }

  // The 08:30 digest also carries what is due 09:00–09:30 today.
  const morning = atIL(now, DIGESTS.morning);
  const lookahead = isBusinessDay(now) && now >= morning && now - morning < 60 * MIN
    ? computeReminders({ env, log: new Set([...known, ...planned.map((r) => r.key)]), until: atIL(now, FOLD.to) })
    : [];
  const digests = planDigests({ env, now, log: [...input.log, ...inserted], active, lookahead });
  const sends = inserted.filter((r) => r.channel === 'push' && r.status === 'sent').map((row) => ({ row, kind: 'ring' }));
  for (const d of digests) {
    if (d.drop?.length) {
      await db.updateLog(d.drop.map((r) => r.id), { status: 'suppressed', reason: 'resolved' });
      stats.dropped += d.drop.length;
    }
    if (!d.key) continue;
    const [row] = await db.insertLog([{
      key: d.key, rule: 'digest', person: d.person, level: 'digest', channel: 'push', status: 'sent', reason: d.kind, exempt: true,
      client_id: null, ref: null, title: d.title, body: d.body, url: d.url, due_at: now.toISOString(), sent_at: null,
    }]);
    if (!row) continue; // another tick already sent this digest
    if (d.include.length) await db.updateLog(d.include.map((r) => r.id), { status: 'sent', channel: 'digest', reason: 'digest', digest_key: d.key, sent_at: now.toISOString() });
    if (d.fold?.length) {
      await db.insertLog(d.fold.map((r) => ({ ...rowOf({ ...r, channel: 'digest', status: 'sent', reason: 'fold' }, now), digest_key: d.key })));
    }
    stats.digests += 1;
    sends.push({ row, kind: 'digest' });
  }
  await inChunks(sends, PARALLEL, ({ row, kind }) => deliver({ db, push, env, row, kind, now, stats }));
  return stats;
}

// A test notification to the signed-in person's own devices (all of them, or the
// one just connected). At most one every 30 seconds.
/** @param {{ db: any, push: any, email: string, person: string, endpoint?: string | null, now?: Date }} args */
export async function sendTest({ db, push, email, person, endpoint = null, now = new Date() }) {
  const subs = (await db.subscriptionsOf(email)).filter((s) => !endpoint || s.endpoint === endpoint);
  if (!subs.length) return { status: 404, body: { error: 'no_device' } };
  if (await db.recentTest(email, new Date(now.getTime() - 30e3))) return { status: 429, body: { error: 'too_soon' } };
  const [row] = await db.insertLog([{
    key: `test:${email}:${now.toISOString()}`, rule: 'test', person, level: 'ring', channel: 'push', status: 'sent', reason: 'test', exempt: true,
    client_id: null, ref: null, title: 'התראת ניסיון', body: 'אם ההודעה הזו הגיעה, ההתראות עובדות. לחזור למערכת וללחוץ "קיבלתי".', url: 'clients.html#mine', due_at: now.toISOString(), sent_at: null,
  }]);
  const stats = { pushed: 0, failed: 0, removed: 0, noDevice: 0 };
  const env = { emailsOf: () => [email], subscriptions: subs };
  if (row) await deliver({ db, push, env, row, kind: 'test', now, stats });
  return { status: stats.pushed ? 200 : 502, body: { ok: !!stats.pushed, devices: subs.length, removed: stats.removed } };
}
