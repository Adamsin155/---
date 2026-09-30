// The reminder engine's server (stage 3): every minute pg_cron calls it
// (public.reminders_tick(), migration 20260930110002) and it runs one tick of
// ./tick.js: the ladders of app/reminder-rules.js through app/reminder-engine.js
// (copies in ../_shared/app, made by scripts/sync-functions.mjs), with the
// sending hours, the daily cap and the digests, into public.reminder_log, and Web
// Push (./webpush.js) to the devices in public.push_subscriptions.
//
// Deployed with verify_jwt=false (supabase/config.toml); each action checks its
// caller here:
//   POST { action: 'tick' }  header x-cron-secret: the Vault secret
//        'reminders_cron_secret', compared inside the database
//        (public.reminders_check_secret, service role only).
//   POST { action: 'test', endpoint? }  Authorization: Bearer <the user's JWT>: a
//        test notification to that staff member's own devices.
// The VAPID private key and subject are read from Vault ('vapid_private_key',
// 'vapid_subject') through public.reminders_vapid() (service role only); the
// public key is app/push-config.js. Deploy every file listed in docs/ops.md.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runTick, sendTest } from './tick.js';
import { sendWebPush } from './webpush.js';
import { corsHeaders, bearer, ACTIONS } from './http.js';
import { VAPID_PUBLIC_KEY } from '../_shared/app/push-config.js';
import { atTimeIL, addDaysIL, dayKeyIL, weekdayIL } from '../_shared/app/tz.js';
import { weekKey } from '../_shared/app/protocol-logic.js';

// The new secret key when the project has one, else the legacy service-role key.
function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (keys?.default) return keys.default;
  } catch { /* not set */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Row = Record<string, any>;
const LOG_COLS = 'id, key, rule, person, level, channel, status, reason, exempt, client_id, ref, title, body, url, due_at, sent_at, created_at, digest_key';
const PAGE = 1000;
async function all(build: () => any): Promise<Row[]> {
  let out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < PAGE) return out;
  }
}
const chunks = <T>(list: T[], n: number): T[][] => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// The database as tick.js sees it (service role: row level security does not apply).
const db = {
  async load(now: Date) {
    const today = atTimeIL(now, 0);
    const since = atTimeIL(addDaysIL(now, -weekdayIL(now) - 1), 0); // the week so far, for the owner's report
    const [clients, checks, tasks, staff, access, reviews, statusNotes, messages, subscriptions, queued, recent] = await Promise.all([
      all(() => admin.from('clients').select('*').in('status', ['active', 'ending']).order('id')),
      all(() => admin.from('protocol_checks').select('client_id, item_key, state, note, at').order('client_id').order('item_key')),
      all(() => admin.from('client_tasks').select('id, client_id, title, owner, due_on, done_at, created_by_email, created_at, source, urgent, started_at, brief').is('done_at', null).order('id')),
      all(() => admin.from('staff').select('email, person').order('email')),
      all(() => admin.from('client_access').select('id, client_id, network, status, updated_at').eq('status', 'broken').order('id')),
      all(() => admin.from('office_reviews').select('day, kind').gte('day', dayKeyIL(addDaysIL(now, -14))).order('day')),
      all(() => admin.from('client_status_notes').select('client_id, week').gte('week', weekKey(now)).order('week')),
      all(() => admin.from('client_messages').select('client_id, sent_at').gte('sent_at', today.toISOString()).order('sent_at')),
      all(() => admin.from('push_subscriptions').select('id, email, endpoint, p256dh, auth, fail_count').order('id')),
      all(() => admin.from('reminder_log').select(LOG_COLS).eq('status', 'queued').order('id')),
      all(() => admin.from('reminder_log').select(LOG_COLS).gte('created_at', since.toISOString()).order('id')),
    ]);
    const log = new Map<number, Row>();
    for (const r of [...queued, ...recent]) log.set(r.id, r);
    return { clients, checks, tasks, staff, access, reviews, statusNotes, messages, subscriptions, log: [...log.values()] };
  },
  async known(keys: string[]) {
    const out = new Set<string>();
    for (const part of chunks(keys, 1000)) {
      const { data, error } = await admin.rpc('reminders_known', { p_keys: part });
      if (error) throw error;
      for (const r of data ?? []) out.add(typeof r === 'string' ? r : r.key);
    }
    return out;
  },
  async insertLog(rows: Row[]) {
    const out: Row[] = [];
    for (const part of chunks(rows, 200)) {
      const { data, error } = await admin.from('reminder_log').upsert(part, { onConflict: 'key', ignoreDuplicates: true }).select(LOG_COLS);
      if (error) throw error;
      out.push(...(data ?? []));
    }
    return out;
  },
  async updateLog(ids: number[], patch: Row) {
    for (const part of chunks(ids.filter(Boolean), 200)) {
      const { error } = await admin.from('reminder_log').update(patch).in('id', part);
      if (error) throw error;
    }
  },
  async subscriptionOk(id: string, now: Date) {
    const { error } = await admin.from('push_subscriptions').update({ last_ok_at: now.toISOString(), fail_count: 0, last_error: null }).eq('id', id);
    if (error) throw error;
  },
  async subscriptionFailed(id: string, why: string) {
    const { data } = await admin.from('push_subscriptions').select('fail_count').eq('id', id).maybeSingle();
    const { error } = await admin.from('push_subscriptions').update({ fail_count: (data?.fail_count ?? 0) + 1, last_error: why.slice(0, 200) }).eq('id', id);
    if (error) throw error;
  },
  async removeSubscription(id: string) {
    const { error } = await admin.from('push_subscriptions').delete().eq('id', id);
    if (error) throw error;
  },
  async subscriptionsOf(email: string) {
    const { data, error } = await admin.from('push_subscriptions').select('id, email, endpoint, p256dh, auth, fail_count').eq('email', email);
    if (error) throw error;
    return data ?? [];
  },
  async recentTest(email: string, since: Date) {
    const { data, error } = await admin.from('reminder_log').select('id').eq('rule', 'test').like('key', `test:${email}:%`).gte('created_at', since.toISOString()).limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  },
};

// The VAPID keys, read from Vault once in a while (never logged).
let vapidCache: { at: number; keys: { publicKey: string; privateKey: string; subject: string } } | null = null;
async function vapid() {
  if (vapidCache && Date.now() - vapidCache.at < 10 * 60e3) return vapidCache.keys;
  const { data, error } = await admin.rpc('reminders_vapid');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.private_key || !row?.subject) throw Object.assign(new Error('vapid_missing'), { code: 'vapid_missing' });
  vapidCache = { at: Date.now(), keys: { publicKey: VAPID_PUBLIC_KEY, privateKey: row.private_key, subject: row.subject } };
  return vapidCache.keys;
}
const pusher = async () => {
  const keys = await vapid();
  return (sub: Row, payload: string, opts: Row) => sendWebPush(sub as any, payload, keys, opts);
};
const codeOf = (e: unknown) => (e as { code?: string })?.code ?? (e as Error)?.name ?? 'error';

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('origin'));
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'bad_request' });
  let body: Row;
  try {
    body = await req.json();
    if (!body || typeof body !== 'object' || !ACTIONS.has(body.action)) throw new Error('bad');
  } catch {
    return json(400, { error: 'bad_request' });
  }

  if (body.action === 'tick') {
    const secret = req.headers.get('x-cron-secret') ?? '';
    if (!secret) return json(401, { error: 'not_allowed' });
    const { data: ok, error } = await admin.rpc('reminders_check_secret', { p_secret: secret });
    if (error) { console.error('reminders: secret check failed', codeOf(error)); return json(500, { error: 'server_error' }); }
    if (ok !== true) return json(401, { error: 'not_allowed' });
    // One tick at a time: a tick that overlaps a running one returns at once.
    const { data: runId, error: leaseError } = await admin.rpc('reminders_begin');
    if (leaseError) { console.error('reminders: begin failed', codeOf(leaseError)); return json(500, { error: 'server_error' }); }
    if (!runId) return json(202, { busy: true });
    try {
      const stats = await runTick({ db, push: await pusher(), now: new Date() });
      await admin.rpc('reminders_end', { p_id: runId, p_ok: true, p_stats: stats, p_error: null });
      return json(200, stats);
    } catch (e) {
      // Only a short code: messages from the database are not written to the log.
      console.error('reminders: tick failed', codeOf(e));
      await admin.rpc('reminders_end', { p_id: runId, p_ok: false, p_stats: null, p_error: String(codeOf(e)).slice(0, 100) });
      return json(500, { error: 'server_error' });
    }
  }

  // action 'test'
  const token = bearer(req.headers.get('authorization'));
  if (!token) return json(401, { error: 'not_signed_in' });
  const { data: who, error: whoError } = await admin.auth.getUser(token);
  const user = who?.user;
  if (whoError || !user?.email || !user.email_confirmed_at) return json(401, { error: 'not_signed_in' });
  const email = user.email.toLowerCase();
  try {
    const { data: me, error } = await admin.from('staff').select('email, person').eq('email', email).maybeSingle();
    if (error) throw error;
    if (!me) return json(403, { error: 'not_allowed' });
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : null;
    const res = await sendTest({ db, push: await pusher(), email, person: me.person ?? 'owner', endpoint, now: new Date() });
    return json(res.status, res.body);
  } catch (e) {
    console.error('reminders: test failed', codeOf(e));
    return json(500, { error: codeOf(e) === 'vapid_missing' ? 'not_ready' : 'server_error' });
  }
});
