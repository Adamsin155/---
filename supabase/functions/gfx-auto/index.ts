// Graphics tasks that close by themselves (the owner, 17.11.2026; docs/ops.md, section 138). pg_cron
// calls it every hour in the day (public.gfx_auto_tick) with the cron secret, compared inside the
// database. Deployed with verify_jwt=false (supabase/config.toml). The work is in ./run.js and
// ../_shared/app/gfx-auto-logic.js.
// Stage 3 (Claude checks a fix task against its notes) runs only when the owner turned it on:
// the secret GFX_AI=on, with GOOGLE_DRIVE_SERVICE_ACCOUNT (read with the Drive's read scope:
// it downloads the new graphics images) and ANTHROPIC_API_KEY. Without them stages 1 and 2 run alone.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { serviceAccountOf, makeDrive, READ_SCOPE } from '../_shared/drive.js';
import { GRAPHICS_PEOPLE } from '../_shared/app/protocol.js';
import { runGfx } from './run.js';

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
type Row = Record<string, unknown>;

const TASK_COLS = 'id, created_at, created_by, assignee, body, brief, client_id, status, gfx_kind, gfx_count, gfx_base, gfx_done, auto_reopened_at, auto_reopen_base';
const store = {
  async openTasks() {
    return must(await admin.from('staff_tasks').select(TASK_COLS).eq('status', 'open').in('assignee', GRAPHICS_PEOPLE()).not('client_id', 'is', null).limit(1000)) as Row[];
  },
  async drive(clientIds: string[], fromDay: string) {
    return must(await admin.from('drive_daily').select('client_id, day, folder, kind, files').in('client_id', clientIds).eq('kind', 'graphic').gte('day', fromDay).gt('files', 0).limit(10000)) as Row[];
  },
  async gantt(clientIds: string[]) {
    return must(await admin.from('client_gantt').select('client_id, kind, state, live_at, created_at').in('client_id', clientIds).eq('kind', 'graphic').in('state', ['scheduled', 'posted']).limit(10000)) as Row[];
  },
  async close(id: string, note: string, n: number | null) {
    return must(await admin.rpc('staff_task_auto_close', { p_id: id, p_note: note, p_done: n })) === true;
  },
  async progress(id: string, n: number) {
    must(await admin.rpc('staff_task_gfx_progress', { p_id: id, p_done: n }));
  },
  async drives(clientIds: string[]) {
    const rows = must(await admin.from('clients').select('id, links').in('id', clientIds)) as { id: string; links: Record<string, string> | null }[];
    return new Map(rows.map((c) => [c.id, c.links?.drive || null]));
  },
  async checks(taskIds: string[]) {
    return must(await admin.from('gfx_ai_checks').select('task_id, created_at, files, status').in('task_id', taskIds).order('created_at')) as Row[];
  },
  async checksSince(iso: string) {
    const { count, error } = await admin.from('gfx_ai_checks').select('id', { count: 'exact', head: true }).gte('created_at', iso);
    if (error) throw error;
    return count ?? 0;
  },
  async saveCheck(row: Row) {
    must(await admin.from('gfx_ai_checks').insert(row));
  },
};

function aiOf() {
  if (Deno.env.get('GFX_AI') !== 'on') return null;
  const sa = serviceAccountOf(Deno.env.get('GOOGLE_DRIVE_SERVICE_ACCOUNT'));
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!sa || !apiKey) return null;
  const drive = makeDrive(sa, { scope: READ_SCOPE });
  const claude = new Anthropic({ apiKey, timeout: 60000, maxRetries: 1 });
  return {
    list: (folder: string, since: string) => drive.list(folder, { since, maxDepth: 3, maxFiles: 1000 }),
    download: (id: string, o: { maxBytes: number }) => drive.download(id, o),
    // deno-lint-ignore no-explicit-any
    ask: (request: any) => claude.beta.messages.create(request),
    Errors: Anthropic,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  const secret = req.headers.get('x-cron-secret') ?? '';
  if (!secret) return json(401, { error: 'not_allowed' });
  const { data: ok, error } = await admin.rpc('reminders_check_secret', { p_secret: secret });
  if (error) return json(500, { error: 'server_error' });
  if (ok !== true) return json(401, { error: 'not_allowed' });
  try {
    return json(200, await runGfx({ store, ai: aiOf(), now: new Date(), log: (m: string) => console.error(m) }));
  } catch (e) {
    console.error('gfx-auto failed', String((e as { code?: string })?.code || 'error'));
    return json(500, { error: 'server_error' });
  }
});
