// The reminder engine's server (stage 3): every minute pg_cron calls it
// (public.reminders_tick(), migration 20260930110002) and it runs one tick of
// ./tick.js: the ladders of app/reminder-rules.js through app/reminder-engine.js
// (copies in ../_shared/app, made by scripts/sync-functions.mjs), with the
// sending hours, the digests and the batches of lateness notes, into
// public.reminder_log, and Web Push (./webpush.js) to the devices in
// public.push_subscriptions. Every step reaches the phone and there is no daily cap
// (the owner's rule of 7.10.2026; docs/ops.md, section 40).
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
import { whatsappChannel } from './wa-server.ts';
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
const LOG_COLS = 'id, key, rule, person, level, channel, status, reason, exempt, client_id, ref, title, body, url, due_at, sent_at, created_at, digest_key, read_at';
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

// Open tasks, and the ones finished in the last two days with their result (a
// brief task Nirel finished: the requester hears, rule `briefDone`). Until
// migration 20260930140000 adds client_tasks.result, open tasks only.
const TASK_COLS = 'id, client_id, title, owner, due_on, done_at, created_by_email, created_at, source, urgent, started_at, brief';
async function loadTasks(now: Date): Promise<Row[]> {
  const since = new Date(now.getTime() - 2 * 864e5).toISOString();
  try {
    return await all(() => admin.from('client_tasks').select(`${TASK_COLS}, result`).or(`done_at.is.null,done_at.gte."${since}"`).order('id'));
  } catch (err) {
    if ((err as { code?: string })?.code !== '42703') throw err;
    return all(() => admin.from('client_tasks').select(TASK_COLS).is('done_at', null).order('id'));
  }
}

// The monthly cycle's marks (stage 5, app/year-rules.js). Until migration
// 20260930190000_year.sql adds the table, none.
async function loadMonthMarks(): Promise<Row[]> {
  try {
    return await all(() => admin.from('client_month_marks').select('client_id, month, item, state, at').order('client_id').order('month').order('item'));
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === '42P01' || code === 'PGRST205') return [];
    throw err;
  }
}

// Stav's deals (3.10.2026, app/deal-logic.js): those still waiting for a contract, and
// the ones signed in the last two days (the seller hears). Until migration
// 20261003100000_sales_deals.sql adds the table, none.
// Since 8.10.2026 (docs/ops.md, section 45) also the ones whose contract was sent or
// that were marked cancelled in the last two days: the seller hears (rules `dealSent`,
// `dealCancelled`). Until migration 20261021100000_people_messages.sql adds
// deal_requests.cancelled_at, without the cancelled ones.
const DEAL_COLS = 'id, created_at, created_by_email, seller, business_name, contact_name, tier, influencer, paid, free, discount_agorot, status, quote_id, sent_at, signed_at, status_by_email';
async function loadDeals(now: Date): Promise<Row[]> {
  const since = new Date(now.getTime() - 2 * 864e5).toISOString();
  try {
    try {
      return await all(() => admin.from('deal_requests').select(`${DEAL_COLS}, cancelled_at`)
        .or(`status.eq.pending,signed_at.gte."${since}",sent_at.gte."${since}",cancelled_at.gte."${since}"`).order('id'));
    } catch (err) {
      if ((err as { code?: string })?.code !== '42703') throw err;
      return await all(() => admin.from('deal_requests').select(DEAL_COLS)
        .or(`status.eq.pending,signed_at.gte."${since}",sent_at.gte."${since}"`).order('id'));
    }
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === '42P01' || code === 'PGRST205') return [];
    throw err;
  }
}

// What one person tells another (8.10.2026; docs/ops.md, section 45). A table that is
// not there yet: none.
const optional = async (load: () => Promise<Row[]>): Promise<Row[]> => {
  try {
    return await load();
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === '42P01' || code === 'PGRST205') return [];
    throw err;
  }
};
// The name of the client a row is about, also for a client the rules do not load (in
// landing, archived): a person's message about it still names it.
async function withClientNames(rows: Row[]): Promise<Row[]> {
  const ids = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
  if (!ids.length) return rows;
  const names = new Map<string, string>();
  for (const part of chunks(ids, 200)) {
    const { data, error } = await admin.from('clients').select('id, name, business').in('id', part);
    if (error) throw error;
    for (const c of data ?? []) {
      const name = String(c.name ?? '').trim();
      const business = String(c.business ?? '').trim();
      names.set(c.id, !business || business === name ? name : name ? `${business} · ${name}` : business);
    }
  }
  return rows.map((r) => ({ ...r, client_name: names.get(r.client_id) ?? null }));
}
// Questions to the responsible person (owner.html): the open ones (rule `question`
// rings whoever was asked) and those answered in the last two days (whoever asked
// hears, rule `questionAnswered`). A withdrawn question is not a row any more.
const loadQuestions = (now: Date) => optional(async () => {
  const since = new Date(now.getTime() - 2 * 864e5).toISOString();
  return withClientNames(await all(() => admin.from('client_questions')
    .select('id, client_id, to_person, about, context, question, asked_by, asked_at, answer, answered_by, answered_at')
    .or(`answer.is.null,answered_at.gte."${since}"`).order('asked_at').order('id')));
});
// "בקשת שינוי" (pass.html): the open ones (Lior rings) and those decided in the last two days.
const loadChangeRequests = (now: Date) => optional(async () => {
  const since = new Date(now.getTime() - 2 * 864e5).toISOString();
  return withClientNames(await all(() => admin.from('change_requests')
    .select('id, client_id, problem, why, proposal, created_by_email, created_at, decision, decided_by_email, decided_at')
    .or(`decided_at.is.null,decided_at.gte."${since}"`).order('created_at').order('id')));
});
// Lior's decisions on exceptions, of the last two days (whoever reported hears once the exception is closed).
const loadDecisions = (now: Date) => optional(() => {
  const since = new Date(now.getTime() - 2 * 864e5).toISOString();
  return all(() => admin.from('task_decisions').select('task_id, client_id, reason, decision, next_task_id, by_email, at').gte('at', since).order('at').order('task_id'));
});

// The links to the client's logins form (6.10.2026, app/access-logic.js): those made
// or filled in the last 16 days (a link lives 14). Only when it was made, filled,
// revoked and expires, and the platforms and choices of a submission: never the hash,
// the Vault id or the client's notes. Until migration
// 20261008100000_client_access_form.sql adds the table, none.
async function loadAccessLinks(now: Date): Promise<Row[]> {
  const since = new Date(now.getTime() - 16 * 864e5).toISOString();
  try {
    return await all(() => admin.from('client_access_links').select('id, client_id, created_at, expires_at, revoked_at, submitted_at, attempts, summary')
      .gte('created_at', since).order('id'));
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === '42P01' || code === 'PGRST205') return [];
    throw err;
  }
}

// Posts that failed to publish in Metricool (6.10.2026, rule `metricoolFailed`): the Gantt
// rows the sync marked in the last two days. Until migration
// 20261007100000_gantt_roles_statuses.sql adds the columns, none.
async function loadGanttFailures(now: Date): Promise<Row[]> {
  const since = new Date(now.getTime() - 2 * 864e5).toISOString();
  try {
    return await all(() => admin.from('client_gantt').select('id, client_id, key, title, day, mc_post_id, mc_status, at')
      .eq('mc_status', 'error').gte('at', since).order('id'));
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === '42P01' || code === 'PGRST205' || code === '42703') return [];
    throw err;
  }
}

// Exceptional contracts (6.10.2026, app/approvals-logic.js): those waiting for a manager,
// and the ones decided in the last two days (whoever prepared them hears), each with the
// email of the seller whose deal it came from. Until migration
// 20261010100000_custom_contracts.sql adds the columns, none.
async function loadApprovals(now: Date): Promise<Row[]> {
  const since = new Date(now.getTime() - 2 * 864e5).toISOString();
  try {
    const rows = await all(() => admin.from('quotes')
      .select('id, number, client_name, business:model->client->>company, status, approval, approval_by, approval_by_email, approval_at, approval_note, exceptions, version, submitted_at, submitted_by_email, created_at, created_by_email')
      .neq('approval', 'none').neq('status', 'cancelled').or(`approval.eq.pending,approval_at.gte."${since}"`).order('id'));
    if (!rows.length) return rows;
    const { data: deals } = await admin.from('deal_requests').select('quote_id, created_by_email').in('quote_id', rows.map((r: Row) => r.id));
    const seller = new Map((deals ?? []).map((d: Row) => [d.quote_id, d.created_by_email]));
    return rows.map((r: Row) => ({ ...r, seller_email: seller.get(r.id) ?? null }));
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205') return [];
    throw err;
  }
}

// Contracts sent for signature and not signed (8.10.2026, app/unsigned-logic.js; docs/ops.md,
// section 47): every quote still 'sent', and for two days after its validity ran out (the
// one notice of that), each with the email of the seller whose deal it came from. No
// amounts are read. Which of them really wait for the client (an agreement, not one that
// waits for a manager) is decided by the shared logic, as on the screens.
async function loadUnsigned(now: Date): Promise<Row[]> {
  const since = new Date(now.getTime() - 2 * 864e5).toISOString();
  try {
    const rows = await all(() => admin.from('quotes')
      .select('id, number, client_name, business:model->client->>company, signable:model->>signable, valid:model->>validHours, status, approval, approval_at, created_at, created_by_email, expires_at')
      .eq('status', 'sent').or(`expires_at.is.null,expires_at.gte."${since}"`).order('id'));
    if (!rows.length) return rows;
    const { data: deals } = await admin.from('deal_requests').select('quote_id, created_by_email').in('quote_id', rows.map((r: Row) => r.id));
    const seller = new Map((deals ?? []).map((d: Row) => [d.quote_id, d.created_by_email]));
    return rows.map((r: Row) => ({ ...r, seller_email: seller.get(r.id) ?? null }));
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205') return [];
    throw err;
  }
}

// The tasks given on the spot (6.10.2026, app/staff-tasks-logic.js): the open ones
// (rule `nag` rings them every 10 minutes) and those finished in the last two days
// (whoever gave them hears, rule `nagDone`). Until migration
// 20261011100000_staff_tasks.sql adds the table, none.
async function loadStaffTasks(now: Date): Promise<Row[]> {
  const since = new Date(now.getTime() - 2 * 864e5).toISOString();
  try {
    return await all(() => admin.from('staff_tasks').select('id, created_at, created_by, assignee, body, client_id, client_name, status, done_at')
      .or(`status.eq.open,done_at.gte."${since}"`).order('id'));
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === '42P01' || code === 'PGRST205') return [];
    throw err;
  }
}

// The photographer's availability (7.10.2026, app/availability-logic.js; docs/ops.md,
// section 39): the months handed over from the current one on, and the unexpected
// changes reported in the last two days. Until migration
// 20261016100000_photographer_availability.sql adds the tables, none.
async function loadAvailability(now: Date): Promise<Row> {
  const since = new Date(now.getTime() - 2 * 864e5).toISOString();
  try {
    const [months, changes] = await Promise.all([
      all(() => admin.from('photographer_months').select('person, month, days, none, submitted_at, updated_at, by_person').gte('month', `${dayKeyIL(now).slice(0, 7)}-01`).order('person').order('month')),
      all(() => admin.from('photographer_changes').select('id, person, reported_at, reported_month, days, shoot_days, note').gte('reported_at', since).order('reported_at').order('id')),
    ]);
    return { months, changes };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === '42P01' || code === 'PGRST205') return { months: [], changes: [] };
    throw err;
  }
}

// What the photographer was told of each shoot day (7.10.2026, rule `shootSet`;
// docs/ops.md, section 40): that rule's own rows of the log, of the last 120 days.
// The rule compares them with the shoot days as they are now, and tells him of a day
// that was set, moved or taken off. Only the key, the title and the id are read.
async function loadShootTold(now: Date): Promise<Row[]> {
  const since = new Date(now.getTime() - 120 * 864e5).toISOString();
  return all(() => admin.from('reminder_log').select('id, key, title, created_at').eq('rule', 'shootSet').gte('created_at', since).order('id'));
}

// The database as tick.js sees it (service role: row level security does not apply).
const db = {
  // The automatic editor assignment (app/auto-assign.js), as qa.html writes it: the
  // editor on the client (only while it has none: Ofir may have assigned meanwhile)
  // or on the round, the marks, the reason with `auto`, and Ofir's folder task.
  async autoAssign(a: Row, now: Date) {
    if (a.patch) {
      let q = admin.from('clients').update(a.patch).eq('id', a.clientId);
      if (!a.n) q = q.is('editor', null);
      const { data, error } = await q.select('id');
      if (error) throw error;
      if (!data?.length) return false; // assigned by hand meanwhile
    }
    const rows = [...a.checks, a.reason].map((x: Row) => ({ client_id: a.clientId, item_key: x.key, state: 'done', note: x.note, at: now.toISOString() }));
    const { error: e1 } = await admin.from('protocol_checks').upsert(rows, { onConflict: 'client_id,item_key', ignoreDuplicates: true });
    if (e1) throw e1;
    if (a.task) {
      const { error: e2 } = await admin.from('client_tasks').insert({ ...a.task, created_by_email: null });
      if (e2) console.error('reminders: folder task not opened', e2.code ?? 'error');
    }
    return true;
  },
  async load(now: Date) {
    const today = atTimeIL(now, 0);
    const since = atTimeIL(addDaysIL(now, -weekdayIL(now) - 1), 0); // the week so far, for the owner's report
    const [clients, checks, tasks, staff, access, reviews, statusNotes, messages, subscriptions, queued, recent, monthMarks, deals, accessLinks, ganttFailures, approvals, staffTasks, availability, shootTold, questions, changeRequests, decisions, unsigned] = await Promise.all([
      all(() => admin.from('clients').select('*').in('status', ['active', 'ending']).is('archived_at', null).eq('landing', false).order('id')),
      all(() => admin.from('protocol_checks').select('client_id, item_key, state, note, at').order('client_id').order('item_key')),
      loadTasks(now),
      all(() => admin.from('staff').select('email, person').order('email')),
      // Broken logins (Lior's ladder) and those the client filled that nobody checked yet ('new').
      all(() => admin.from('client_access').select('id, client_id, network, status, broken_since, updated_at').in('status', ['broken', 'new']).order('id')),
      all(() => admin.from('office_reviews').select('day, kind').gte('day', dayKeyIL(addDaysIL(now, -14))).order('day')),
      all(() => admin.from('client_status_notes').select('client_id, week').gte('week', weekKey(now)).order('week')),
      all(() => admin.from('client_messages').select('client_id, sent_at').gte('sent_at', today.toISOString()).order('sent_at')),
      all(() => admin.from('push_subscriptions').select('id, email, endpoint, p256dh, auth, fail_count').order('id')),
      all(() => admin.from('reminder_log').select(LOG_COLS).eq('status', 'queued').order('id')),
      // Not the repeats of the tasks given on the spot (a row every 10 minutes for each
      // open task): nothing reads them here (the reports skip them; their
      // dedupe is `known`), and a week of them would be loaded every minute.
      all(() => admin.from('reminder_log').select(LOG_COLS).gte('created_at', since.toISOString()).neq('rule', 'nag').order('id')),
      loadMonthMarks(),
      loadDeals(now),
      loadAccessLinks(now),
      loadGanttFailures(now),
      loadApprovals(now),
      loadStaffTasks(now),
      loadAvailability(now),
      loadShootTold(now),
      loadQuestions(now),
      loadChangeRequests(now),
      loadDecisions(now),
      loadUnsigned(now),
    ]);
    const log = new Map<number, Row>();
    for (const r of [...queued, ...recent]) log.set(r.id, r);
    return { clients, checks, tasks, staff, access, reviews, statusNotes, messages, subscriptions, monthMarks, deals, accessLinks, ganttFailures, approvals, unsigned, staffTasks, availability, shootTold, questions, changeRequests, decisions, log: [...log.values()] };
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
  // The log's rows of the same step of the same case, of anyone (the keys that start
  // with one of these, up to the '@'): who held the work before (planHandover).
  async siblings(prefixes: string[]) {
    const out: Row[] = [];
    for (const p of prefixes) {
      const { data, error } = await admin.from('reminder_log').select('id, key, person').like('key', `${p.replace(/[\\%_]/g, '\\$&')}@%`).order('id', { ascending: false }).limit(20);
      if (error) throw error;
      out.push(...(data ?? []));
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
  // Pushes left 'pending' by a tick that stopped before they were sent (claimed
  // before `before`), taken again atomically: two ticks never take the same one.
  async reclaim(before: Date) {
    const { data, error } = await admin.rpc('reminders_reclaim', { p_before: before.toISOString() });
    if (error) throw error;
    return (data ?? []) as Row[];
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
      // Stage 4: WhatsApp copies when the owner turned them on (null otherwise; never stops the tick).
      const wa = await whatsappChannel(admin).catch((e) => { console.error('reminders: WhatsApp off', codeOf(e)); return null; });
      const stats = await runTick({ db, push: await pusher(), wa, now: new Date() });
      // A send that could not be recorded stays pending and is taken again later.
      await admin.rpc('reminders_end', { p_id: runId, p_ok: !stats.errors, p_stats: stats, p_error: stats.errors ? 'send_not_recorded' : null });
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
