// One minute of the reminder engine, and the test notification. No Deno APIs:
// index.ts passes a database adapter (`db`) and a push sender (`push`), and
// tests/reminders-tick.test.mjs passes fakes of both.
//
// A tick: load everything (service role) → the ladder steps due now
// (app/reminder-engine.js) → the ones the log does not have → where each one goes
// (push now, the next digest or batch of lateness notes, or stale; since 7.10.2026
// nothing stays in the app only, and there is no daily cap) → claim them in
// public.reminder_log (the key is unique, so two overlapping ticks never send the
// same step twice) → the digests due now → the pushes. A dead subscription (404 or
// 410) is removed; every other failure is recorded on the log row and on the
// subscription.
//
// A push is claimed as 'pending' and becomes 'sent' or 'failed' once the push
// services answered. A tick that died in between (a timeout, the worker stopped)
// leaves it 'pending': a later tick takes it again once it is older than
// RECLAIM_AFTER (longer than a tick can live, so never while its tick may still
// be sending), checks it is still true, and sends it; one that could not be sent
// within RECOVER_FOR is recorded as lost, never sent late. (A push that went out
// but could not be recorded may so go out twice; it has the same tag, so the phone
// replaces the first rather than showing two.)
import {
  buildEnv, candidates, computeReminders, planDelivery, planDigests, pushPayload, notKnown, planHandover, handoverPrefixes,
} from '../_shared/app/reminder-engine.js';
import { atIL, DIGESTS, FOLD, REMINDER_PEOPLE, BATCH, VOID_WHEN_GONE } from '../_shared/app/reminder-rules.js';
import { isBusinessDay } from '../_shared/app/protocol-logic.js';
import { planAutoAssign } from '../_shared/app/auto-assign.js';

const MIN = 6e4;
// How long a push may wait at the push service before it is dropped (a ring is
// stale after a few hours; a digest is good for the day).
const TTL = { ring: 4 * 3600, digest: 12 * 3600, test: 600 };
const PARALLEL = 5;
// A pending push older than this belongs to a tick that is gone (an edge function
// lives at most 400 seconds); it is sent again for up to RECOVER_FOR after it was
// claimed, at most MAX_ATTEMPTS times.
export const RECLAIM_AFTER = 10 * MIN;
export const RECOVER_FOR = 2 * 60 * MIN;
export const MAX_ATTEMPTS = 3;
// The log's column limits (20260930110000_reminders.sql): one step with a long
// client name or task title must not stop the whole tick.
const clip = (text, n) => (text && text.length > n ? `${text.slice(0, n - 1)}…` : text);

const rowOf = (r, now) => {
  const push = r.channel === 'push' && r.status === 'sent';
  return {
    key: r.key, rule: r.rule, person: r.person, level: r.level, channel: r.channel, status: push ? 'pending' : r.status, reason: clip(r.reason || null, 200),
    exempt: !!r.exempt, client_id: r.clientId || null, ref: r.ref || null, title: clip(r.title, 300), body: clip(r.body || '', 2000), url: r.url,
    due_at: r.at ? new Date(r.at).toISOString() : null, sent_at: r.status === 'sent' && !push ? now.toISOString() : null,
  };
};

// Claims rows in the log (the unique key: a row another tick claimed is not
// returned). A batch the database refuses is claimed row by row, so one bad row is
// left out (counted, and tried again next minute, as it is not in the log) instead
// of stopping every tick from now on. When the first rows all fail one by one, the
// database itself is the problem and the error goes up.
async function claim(db, rows, stats) {
  if (!rows.length) return [];
  try {
    return await db.insertLog(rows);
  } catch (err) {
    const out = [];
    let anyIn = false;
    let refused = 0;
    for (const r of rows) {
      try {
        out.push(...await db.insertLog([r]));
        anyIn = true;
      } catch (e) {
        refused += 1;
        if (!anyIn && refused >= 5) throw e;
        stats.rejected += 1;
        console.error('reminders: a row was refused', r.rule, e?.code || e?.name || 'error');
      }
    }
    return out;
  }
}

async function inChunks(list, size, work) {
  for (let i = 0; i < list.length; i += size) await Promise.all(list.slice(i, i + size).map(work));
}

// Sends one log row to every device of its person, and records what happened: the
// row first (that is what stops it from being sent again), then the devices. A
// failure here is counted and does not stop the other sends; a row left pending
// is taken again by a later tick.
async function deliver({ db, push, env, row, kind, now, stats }) {
  try {
    const emails = new Set(env.emailsOf(row.person));
    const subs = env.subscriptions.filter((s) => emails.has(String(s.email).toLowerCase()));
    if (!subs.length) {
      await db.updateLog([row.id], { status: 'sent', channel: 'app', reason: 'no_device', sent_at: now.toISOString() });
      stats.noDevice += 1;
      return;
    }
    const payload = pushPayload({ id: row.id, key: row.key, title: row.title, body: row.body, url: row.url, level: row.level });
    const opts = { ttl: TTL[kind], urgency: kind === 'digest' ? 'normal' : 'high' };
    const results = await Promise.all(subs.map(async (s) => ({ s, r: await push(s, payload, opts).catch(() => ({ ok: false, status: 0, error: 'error' })) })));
    const ok = results.filter((x) => x.r.ok).length;
    if (ok) {
      await db.updateLog([row.id], { status: 'sent', sent_at: now.toISOString(), reason: ok < results.length ? `${results.length - ok} of ${results.length} devices failed` : null });
      stats.pushed += 1;
    } else {
      const why = results.map((x) => x.r.status || x.r.error || 'error').join(',');
      await db.updateLog([row.id], { status: 'failed', reason: `push failed: ${why}`.slice(0, 200) });
      stats.failed += 1;
    }
    for (const { s, r } of results) {
      if (r.ok) await db.subscriptionOk(s.id, now);
      else if (r.gone) { await db.removeSubscription(s.id); stats.removed += 1; }
      else await db.subscriptionFailed(s.id, `${r.status || r.error || 'error'}`);
    }
  } catch (err) {
    stats.errors += 1;
    console.error('reminders: a send was not recorded', row.rule, err?.code || err?.name || 'error');
  }
}

// The automatic editor assignment (the owner's decision of 3.10.2026,
// app/auto-assign.js): a shoot day closed with no editor yet gets one, so it happens
// even when nobody opens the app. Written through db.autoAssign (the service role);
// a database without it (or a failure) leaves the assignment to Ofir's screen, and
// never stops the reminders. Returns how many were assigned.
async function autoAssign(db, env, input, now, stats) {
  if (typeof db.autoAssign !== 'function') return 0;
  let plan = [];
  try {
    plan = planAutoAssign({ clients: env.clients, stateOf: env.stateOf, checks: Object.fromEntries(env.clients.map((c) => [c.id, env.checksOf(c)])), tasks: input.tasks || [], now });
  } catch (err) {
    stats.errors += 1;
    console.error('reminders: auto-assign plan failed', err?.code || err?.name || 'error');
    return 0;
  }
  let done = 0;
  for (const a of plan) {
    try {
      if (await db.autoAssign(a, now)) done += 1;
    } catch (err) {
      stats.errors += 1;
      console.error('reminders: auto-assign failed', err?.code || err?.name || 'error');
    }
  }
  return done;
}

/** @param {{ db: any, push: any, wa?: any, now?: Date }} args */
export async function runTick({ db, push, wa = null, now = new Date() }) {
  const stats = { steps: 0, pushed: 0, queued: 0, app: 0, stale: 0, digests: 0, failed: 0, removed: 0, noDevice: 0, dropped: 0, recovered: 0, lost: 0, rejected: 0, errors: 0, assigned: 0 };
  let input = await db.load(now);
  let env = buildEnv({ ...input, now });
  // An editor assigned now changes this very minute's ladders (22א stops, the editor's starts).
  stats.assigned = await autoAssign(db, env, input, now, stats);
  if (stats.assigned) {
    input = await db.load(now);
    env = buildEnv({ ...input, now });
  }
  const all = candidates(env);
  const active = new Set(all.map((r) => r.key));
  const known = await db.known([...active]);
  let fresh = all.filter(notKnown(known));
  // Work that passed to someone else (an editor swap, a task moved): the step is told
  // now to whoever got it, and whoever had it hears it passed on (planHandover).
  const passing = handoverPrefixes(fresh);
  if (passing.length && typeof db.siblings === 'function') {
    fresh = planHandover({ reminders: fresh, siblings: await db.siblings(passing), now });
  }
  const planned = planDelivery({ reminders: fresh, now, liorShoot: env.liorShoot });
  const inserted = await claim(db, planned.map((r) => rowOf(r, now)), stats);
  stats.steps = inserted.length;
  for (const r of inserted) {
    if (r.status === 'queued') stats.queued += 1;
    else if (r.status === 'suppressed') stats.stale += 1;
    else if (r.channel === 'app') stats.app += 1;
  }

  // A notification whose case is gone (a question that was withdrawn or answered) is
  // marked read, so it does not wait in "התראות" for something that is no longer asked.
  const gone = (input.log || []).filter((r) => VOID_WHEN_GONE.has(r.rule) && !r.read_at && r.status === 'sent' && !active.has(r.key));
  if (gone.length) await db.updateLog(gone.map((r) => r.id), { read_at: now.toISOString() });

  // The 08:30 digest also carries what is due 09:00–09:30 today.
  const morning = atIL(now, DIGESTS.morning);
  const lookahead = isBusinessDay(now) && now >= morning && now - morning < 60 * MIN
    ? computeReminders({ env, log: new Set([...known, ...planned.map((r) => r.key)]), until: atIL(now, FOLD.to) })
    : [];
  const digests = planDigests({ env, now, log: [...input.log, ...inserted], active, lookahead });
  const sends = inserted.filter((r) => r.channel === 'push' && r.status === 'pending').map((row) => ({ row, kind: 'ring' }));
  for (const d of digests) {
    if (d.drop?.length) {
      await db.updateLog(d.drop.map((r) => r.id), { status: 'suppressed', reason: 'resolved' });
      stats.dropped += d.drop.length;
    }
    if (!d.key) continue;
    const [row] = await db.insertLog([{
      key: d.key, rule: 'digest', person: d.person, level: 'digest', channel: 'push', status: 'pending', reason: d.kind, exempt: true,
      client_id: null, ref: null, title: clip(d.title, 300), body: clip(d.body, 2000), url: d.url, due_at: now.toISOString(), sent_at: null,
    }]);
    if (!row) continue; // another tick already sent this digest
    // A batch of lateness notes (kind 'late') keeps its own reason on the notes it carried.
    if (d.include.length) await db.updateLog(d.include.map((r) => r.id), { status: 'sent', channel: 'digest', reason: d.kind === 'late' ? BATCH : 'digest', digest_key: d.key, sent_at: now.toISOString() });
    if (d.fold?.length) {
      await claim(db, d.fold.map((r) => ({ ...rowOf({ ...r, channel: 'digest', status: 'sent', reason: 'fold' }, now), digest_key: d.key })), stats);
    }
    stats.digests += 1;
    sends.push({ row, kind: 'digest' });
  }

  // Pushes a tick that is gone left pending: not too old, still true, and planned
  // again for this moment (past 19:00 a ring waits for the digest) → sent now.
  const byKey = new Map(all.map((r) => [r.key, r]));
  for (const row of await db.reclaim(new Date(now.getTime() - RECLAIM_AFTER))) {
    const age = now - new Date(row.created_at);
    const step = byKey.get(row.key);
    if (row.rule === 'test' || age > RECOVER_FOR || (row.attempts || 0) > MAX_ATTEMPTS) {
      await db.updateLog([row.id], { status: 'failed', reason: 'lost: the tick that claimed it stopped' });
      stats.lost += 1;
    } else if (row.rule === 'digest') {
      sends.push({ row, kind: 'digest' });
      stats.recovered += 1;
    } else if (!step) {
      await db.updateLog([row.id], { status: 'suppressed', reason: 'resolved' });
      stats.dropped += 1;
    } else {
      // A step that passed to this person keeps the moment it was told at (planHandover), not the work's start.
      const [again] = planDelivery({ reminders: [{ ...step, at: step.handover && row.due_at ? new Date(row.due_at) : step.at }], now, liorShoot: env.liorShoot });
      if (again.channel === 'push') {
        sends.push({ row, kind: 'ring' });
        stats.recovered += 1;
      } else {
        await db.updateLog([row.id], { status: again.status, channel: again.channel, reason: again.reason });
        stats.queued += 1;
      }
    }
  }
  await inChunks(sends, PARALLEL, ({ row, kind }) => deliver({ db, push, env, row, kind, now, stats }));
  // Stage 4: the same rings and digests on WhatsApp too, for whoever agreed (./whatsapp.js).
  if (wa) await wa.deliver({ sends, env, now, stats });
  return stats;
}

// A test notification to the signed-in person's own devices (all of them, or the
// one just connected). At most one every 30 seconds.
/** @param {{ db: any, push: any, email: string, person: string, endpoint?: string | null, now?: Date }} args */
export async function sendTest({ db, push, email, person, endpoint = null, now = new Date() }) {
  // Only the protocol's people and the owner have reminders (and rows in the log).
  if (!REMINDER_PEOPLE.has(person)) return { status: 403, body: { error: 'not_allowed' } };
  const subs = (await db.subscriptionsOf(email)).filter((s) => !endpoint || s.endpoint === endpoint);
  if (!subs.length) return { status: 404, body: { error: 'no_device' } };
  if (await db.recentTest(email, new Date(now.getTime() - 30e3))) return { status: 429, body: { error: 'too_soon' } };
  const [row] = await db.insertLog([{
    key: `test:${email}:${now.toISOString()}`, rule: 'test', person, level: 'ring', channel: 'push', status: 'pending', reason: 'test', exempt: true,
    client_id: null, ref: null, title: 'התראת ניסיון', body: 'אם ההודעה הזו הגיעה, ההתראות עובדות. לחזור למערכת וללחוץ "קיבלתי".', url: 'clients.html#mine', due_at: now.toISOString(), sent_at: null,
  }]);
  const stats = { pushed: 0, failed: 0, removed: 0, noDevice: 0, errors: 0 };
  const env = { emailsOf: () => [email], subscriptions: subs };
  if (row) await deliver({ db, push, env, row, kind: 'test', now, stats });
  return { status: stats.pushed ? 200 : 502, body: { ok: !!stats.pushed, devices: subs.length, removed: stats.removed } };
}
