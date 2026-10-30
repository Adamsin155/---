// Counts what is added to the clients' Google Drive folders, day by day, for "עבודה לפי עובד"
// (the owner, 30.10.2026; docs/ops.md, section 83). pg_cron calls it every 10 minutes
// (public.drive_scan_tick) with the cron secret, compared inside the database. Deployed with
// verify_jwt=false (supabase/config.toml). The work is in ./scan.js and ../_shared/drive.js.
// The secret: GOOGLE_DRIVE_SERVICE_ACCOUNT (the robot account's JSON key).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { serviceAccountOf, makeDrive } from '../_shared/drive.js';
import { runScan } from './scan.js';

function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (keys?.default) return keys.default;
  } catch { /* not set */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const must = <T>(r: { data: T; error: unknown }): T => { if (r.error) throw r.error; return r.data; };

const store = {
  async targets() {
    const clients = must(await admin.from('clients').select('id, links').in('status', ['active', 'ending'])) as { id: string; links: Record<string, string> | null }[];
    const states = must(await admin.from('drive_scan_state').select('client_id, scanned_at')) as { client_id: string; scanned_at: string }[];
    const at = new Map(states.map((s) => [s.client_id, s.scanned_at]));
    return clients.filter((c) => c.links?.drive).map((c) => ({ ...c, scanned_at: at.get(c.id) || null }));
  },
  async before(clientId: string, fromDay: string) {
    return must(await admin.from('drive_daily').select('day, folder, kind').eq('client_id', clientId).gte('day', fromDay).gt('files', 0));
  },
  async save(rows: unknown[]) {
    must(await admin.from('drive_daily').upsert(rows, { onConflict: 'client_id,day,folder,kind' }));
  },
  async state(row: unknown) {
    must(await admin.from('drive_scan_state').upsert(row, { onConflict: 'client_id' }));
  },
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  const secret = req.headers.get('x-cron-secret') ?? '';
  if (!secret) return json(401, { error: 'not_allowed' });
  const { data: ok, error } = await admin.rpc('reminders_check_secret', { p_secret: secret });
  if (error) return json(500, { error: 'server_error' });
  if (ok !== true) return json(401, { error: 'not_allowed' });
  const sa = serviceAccountOf(Deno.env.get('GOOGLE_DRIVE_SERVICE_ACCOUNT'));
  if (!sa) return json(503, { error: 'drive_not_connected' });
  try {
    return json(200, await runScan({ store, drive: makeDrive(sa), now: new Date() }));
  } catch (e) {
    console.error('drive-scan failed', String((e as { code?: string })?.code || 'error'));
    return json(500, { error: 'server_error' });
  }
});
