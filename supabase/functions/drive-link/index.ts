// The clients' Drive folders found and connected by themselves (the owner, 19.11.2026; docs/ops.md,
// section 143). pg_cron calls it every three hours in the day (public.drive_link_tick) with the cron
// secret, compared inside the database. Deployed with verify_jwt=false (supabase/config.toml). The
// work is in ./run.js and ../_shared/app/drive-autolink-logic.js.
// The secrets: GOOGLE_DRIVE_SERVICE_ACCOUNT (the robot reads the main clients folder: shared with it,
// view only) and ANTHROPIC_API_KEY (the same key as contract-ai). Only names go to Claude.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { serviceAccountOf, makeDrive, FOLDER_MIME } from '../_shared/drive.js';
import { runAutolink } from './run.js';

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
  async mainFolder() {
    const row = must(await admin.from('app_settings').select('value').eq('key', 'drive_clients_folder').maybeSingle()) as { value: { folder?: string } } | null;
    const id = String(row?.value?.folder || '');
    return /^[A-Za-z0-9_-]{10,100}$/.test(id) ? id : null;
  },
  async clients() {
    return must(await admin.from('clients').select('id, name, business, status, archived_at, links').limit(5000));
  },
  async states() {
    return must(await admin.from('drive_link_state').select('client_id, status, ask_key').limit(5000));
  },
  async link(clientId: string, folderId: string, name: string) {
    return must(await admin.rpc('drive_link_auto', { p_client: clientId, p_folder: folderId, p_name: name })) === true;
  },
  async ask(row: Record<string, unknown>) {
    must(await admin.from('drive_link_state').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'client_id' }));
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
  const reader = makeDrive(sa);
  const drive = {
    async folders(id: string) {
      const { files } = await reader.list(id, { maxDepth: 0, maxFiles: 2000 });
      return files.filter((f: { mimeType: string }) => f.mimeType === FOLDER_MIME).map((f: { id: string; name: string }) => ({ id: f.id, name: f.name }));
    },
  };
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  const claude = apiKey ? new Anthropic({ apiKey, timeout: 90000, maxRetries: 1 }) : null;
  // deno-lint-ignore no-explicit-any
  const ai = claude ? { ask: (request: any) => claude.beta.messages.create(request) } : null;
  try {
    return json(200, await runAutolink({ store, drive, ai, log: (m: string) => console.error(m) }));
  } catch (e) {
    console.error('drive-link failed', String((e as { code?: string })?.code || 'error'));
    return json(500, { error: 'server_error' });
  }
});
