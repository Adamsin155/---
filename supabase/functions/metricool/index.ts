// Metricool and the content Gantt (docs/ops.md, section 27). The office schedules every
// client's content in Metricool (one account, a Brand per client); this function reads
// each connected brand's planner and marks the client's Gantt: scheduled, posted,
// failed. The work is ./sync.js, the rules ../_shared/app/metricool-logic.js (a copy of
// app/metricool-logic.js, made by scripts/sync-functions.mjs).
//
// Deployed with verify_jwt=false (supabase/config.toml); each action checks its caller here:
//   POST { action: 'sync' }    header x-cron-secret: the Vault secret
//        'reminders_cron_secret', compared inside the database
//        (public.reminders_check_secret). pg_cron sends it every 15 minutes
//        (public.metricool_tick, migration 20261007100200). Does nothing while the
//        owner's switch is off.
//   POST { action: 'brands' }  Authorization: Bearer <the user's JWT>, the office only:
//        the account's brands (id, name, networks), to connect a client to its brand.
//   POST { action: 'check' }   the owner only: does the token work, the account's name
//        and the number of brands.
// The token and the user id are read from Vault ('metricool_user_token',
// 'metricool_user_id') through public.metricool_config() (service role only). They are
// never returned and never logged; an error is a short code.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runSync, listBrands, checkAccount, corsHeaders, bearer, mayCall, ACTIONS } from './sync.js';

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
const codeOf = (e: unknown) => (e as { code?: string })?.code ?? (e as Error)?.name ?? 'error';
const GANTT_COLS = 'id, key, kind, title, day, time_il, internal, state, posted_on, link, edited, source, mc_post_id, mc_status, mc_at, mc_networks, mc_error, mc_extra';

async function config(): Promise<Row | null> {
  const { data, error } = await admin.rpc('metricool_config');
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

// The database as sync.js sees it (service role: row level security does not apply).
const db = {
  // Connected, open, not archived; the least recently synced first.
  async clients() {
    const { data, error } = await admin.from('clients').select('id, metricool_blog_id')
      .not('metricool_blog_id', 'is', null).in('status', ['active', 'ending']).is('archived_at', null).order('id');
    if (error) throw error;
    const { data: last, error: e2 } = await admin.from('client_gantt_sync').select('client_id, at');
    if (e2) throw e2;
    const at = new Map((last ?? []).map((r: Row) => [r.client_id, r.at]));
    return (data ?? []).sort((a: Row, b: Row) => String(at.get(a.id) ?? '').localeCompare(String(at.get(b.id) ?? '')));
  },
  async rows(clientId: string) {
    const { data, error } = await admin.from('client_gantt').select(GANTT_COLS).eq('client_id', clientId).order('day').order('key').limit(5000);
    if (error) throw error;
    return data ?? [];
  },
  async apply(clientId: string, ops: Row, ok: boolean, error: string | null, stats: Row) {
    const { error: e } = await admin.rpc('gantt_sync_apply', { p_client: clientId, p_ops: ops, p_ok: ok, p_error: error, p_stats: stats });
    if (e) throw e;
  },
};

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

  if (body.action === 'sync') {
    const secret = req.headers.get('x-cron-secret') ?? '';
    if (!secret) return json(401, { error: 'not_allowed' });
    const { data: ok, error } = await admin.rpc('reminders_check_secret', { p_secret: secret });
    if (error) { console.error('metricool: secret check failed', codeOf(error)); return json(500, { error: 'server_error' }); }
    if (ok !== true) return json(401, { error: 'not_allowed' });
    try {
      const stats = await runSync({ db, fetch, config: await config(), now: new Date() });
      return json(200, stats);
    } catch (e) {
      // Only a short code: nothing from Metricool or the database is written to the log.
      console.error('metricool: sync failed', codeOf(e));
      return json(500, { error: 'server_error' });
    }
  }

  // 'brands' and 'check': a signed-in member of staff.
  const token = bearer(req.headers.get('authorization'));
  if (!token) return json(401, { error: 'not_signed_in' });
  const { data: who, error: whoError } = await admin.auth.getUser(token);
  const user = who?.user;
  if (whoError || !user?.email || !user.email_confirmed_at) return json(401, { error: 'not_signed_in' });
  try {
    const { data: me, error } = await admin.from('staff').select('email, person').eq('email', user.email.toLowerCase()).maybeSingle();
    if (error) throw error;
    if (!mayCall(body.action, me)) return json(403, { error: 'not_allowed' });
    const res = body.action === 'check' ? await checkAccount({ fetch, config: await config() }) : await listBrands({ fetch, config: await config() });
    return json(res.status, res.body);
  } catch (e) {
    console.error(`metricool: ${body.action} failed`, codeOf(e));
    return json(500, { error: 'server_error' });
  }
});
