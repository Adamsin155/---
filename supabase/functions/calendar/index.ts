// The personal calendar feed ("היומן שלי", stage 6): a calendar app (Google, Apple,
// Outlook) reads GET /functions/v1/calendar?t=<token> every so often and gets that
// person's own shoot days, meetings, Zoom calls and deadlines as iCalendar.
//
// Deployed with verify_jwt=false (supabase/config.toml): a calendar app sends no
// login, so the secret token in the link is the credential. It is checked inside
// the database by public.calendar_feed_check() (service role only; only the
// token's SHA-256 is stored, migration 20260930200000_calendar_feeds.sql), which
// says whose feed it is. What the feed holds is app/calendar-feed.js and the text
// is app/ics.js (copies in ../_shared/app, made by scripts/sync-functions.mjs).
// An unknown, replaced or malformed token gets 404, the same answer as a wrong path.
// Nothing about the request or the data is logged, only a short error code.
//
// The other direction (the owner's request of 21.10.2026; docs/ops.md, section 65):
//   POST { action: 'google' }  header x-cron-secret: the Vault secret 'reminders_cron_secret',
//        compared inside the database (public.reminders_check_secret), as the Metricool
//        sync does. pg_cron sends it every 15 minutes (public.google_calendar_tick,
//        migration 20261028100000_google_calendar_sync.sql). Reads each connected person's
//        own Google calendar into public.calendar_external_events (./google.js). It lives
//        here, not in a function of its own: this one already reads the clients with the
//        service role and is deployed without a JWT check, and it is the calendar's.
// Anything else that is not GET or HEAD gets 405.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { feedEvents, feedName, tokenFrom, OWNER, SITE } from '../_shared/app/calendar-feed.js';
import { buildCalendar } from '../_shared/app/ics.js';
import { runGoogle } from './google.js';

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
// Where the links in the events open; SITE_URL overrides it after the move to the fixed address.
const site = (() => {
  const v = Deno.env.get('SITE_URL') ?? '';
  return /^https:\/\/[^\s]+\/$/.test(v) ? v : SITE;
})();

type Row = Record<string, any>;
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

// What the protocol logic needs, the name and the address; never the phone or the office's notes.
const CLIENT_COLS = 'id, name, address, shoot_type, characterizer, editor, editor2, has_logo, deal_at, char_at, shoot_at, contract_end, status, rounds, created_at, updated_at';
const TASK_COLS = 'id, client_id, title, owner, due_on, done_at, created_at, started_at, urgent, source';

async function load(person: string, now: Date) {
  const clients = await all(() => admin.from('clients').select(CLIENT_COLS).in('status', ['active', 'ending']).is('archived_at', null).order('id'));
  // The person's own tasks: open, or finished in the last 30 days (who sees what).
  const since = new Date(now.getTime() - 30 * 864e5).toISOString();
  const tasks = person === OWNER ? [] : await all(() => admin.from('client_tasks').select(TASK_COLS)
    .eq('owner', person).or(`done_at.is.null,done_at.gte."${since}"`).order('id'));
  const checks: Record<string, Row> = {};
  for (const part of chunks(clients.map((c) => c.id), 200)) {
    const rows = await all(() => admin.from('protocol_checks').select('client_id, item_key, state, note, by_email, at').in('client_id', part).order('client_id').order('item_key'));
    for (const r of rows) (checks[r.client_id] ||= {})[r.item_key] = r;
  }
  return { clients, tasks, checks };
}

const HEADERS = {
  'Content-Type': 'text/calendar; charset=utf-8',
  // Short: a calendar that reads again soon sees a moved shoot day.
  'Cache-Control': 'private, max-age=300',
  'Content-Disposition': 'inline; filename="astrateg.ics"',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const plain = (status: number, text: string) => new Response(text, {
  status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const codeOf = (e: unknown) => (e as { code?: string })?.code ?? (e as Error)?.name ?? 'error';

// The database as ./google.js sees it (service role: row level security does not apply).
const googleDb = {
  async feeds() {
    const { data, error } = await admin.rpc('google_calendar_feeds');
    if (error) throw error;
    return data ?? [];
  },
  // The names a meeting's title is matched against: open clients only.
  async clients() {
    return all(() => admin.from('clients').select('id, name, business').in('status', ['active', 'ending']).is('archived_at', null).order('id'));
  },
  async apply(email: string, rows: Row[] | null, ok: boolean, error: string | null) {
    const { error: e } = await admin.rpc('google_calendar_apply', { p_email: email, p_rows: rows ?? [], p_ok: ok, p_error: error });
    if (e) throw e;
  },
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

async function google(req: Request): Promise<Response> {
  let body: Row | null = null;
  try { body = await req.json(); } catch { body = null; }
  if (body?.action !== 'google') return plain(405, 'method not allowed');
  const secret = req.headers.get('x-cron-secret') ?? '';
  const { data: ok, error } = await admin.rpc('reminders_check_secret', { p_secret: secret });
  if (error) { console.error('calendar: secret check failed', codeOf(error)); return json(500, { error: 'server_error' }); }
  if (ok !== true) return json(401, { error: 'not_allowed' });
  try {
    return json(200, await runGoogle({ db: googleDb, fetch, now: new Date() }));
  } catch (e) {
    // Only a short code: no address, nothing of anyone's calendar.
    console.error('calendar: google failed', codeOf(e));
    return json(500, { error: 'server_error' });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'POST' && req.headers.has('x-cron-secret')) return google(req);
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain(405, 'method not allowed');
  const token = tokenFrom(req.url);
  if (!token) return plain(404, 'not found');
  try {
    const { data, error } = await admin.rpc('calendar_feed_check', { p_token: token });
    if (error) throw error;
    const who = Array.isArray(data) ? data[0] : data;
    if (!who?.email) return plain(404, 'not found');
    const person = who.person ?? OWNER;
    const now = new Date();
    const { clients, tasks, checks } = await load(person, now);
    const events = feedEvents({ person, clients, checks, tasks, now, site });
    const body = buildCalendar({ name: feedName(person), events, now });
    return new Response(req.method === 'HEAD' ? null : body, { status: 200, headers: HEADERS });
  } catch (e) {
    console.error('calendar: feed failed', codeOf(e));
    return plain(500, 'server error');
  }
});
