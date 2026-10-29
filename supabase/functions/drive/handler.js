// The drive function's work (docs/ops.md, section 74), free of Deno APIs so node tests run it
// (tests/drive.test.mjs): the list of files in one client's Google Drive folder, for
// "משיכת קישורים מהדרייב" in the content Gantt (app/drive-links.js matches them to the items).
//
//   POST { client_id }  →  200 { files: [{ name, mimeType, createdTime, link, path }], truncated }
//
//   - whoever changes the Gantt (public.can_edit_gantt(): Ilai, Irit and the owners), and only a
//     client they can read (the card's Drive link is read as the caller: row level security);
//   - read-only, names and links only (../_shared/drive.js, scope drive.metadata.readonly);
//   - the robot's key is the secret GOOGLE_DRIVE_SERVICE_ACCOUNT. Without it:
//     503 { error: 'drive_not_connected' } ("הדרייב עוד לא מחובר").
// Nothing is written here: the page fills the empty links through its own session.
import { serviceAccountOf, makeDrive, folderIdOf } from '../_shared/drive.js';
import { corsHeaders } from '../_shared/cors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deps: { env(name), createClient(url, key, opts?), fetch, log(message) }
export function makeHandler(deps) {
  const log = deps.log || (() => {});
  return async function handle(req) {
    const CORS = corsHeaders(req.headers.get('origin'));
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
    const db = deps.createClient(deps.env('SUPABASE_URL'), deps.env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: userData } = await db.auth.getUser();
    if (!userData?.user) return json(401, { error: 'not_signed_in' });
    const may = await db.rpc('can_edit_gantt');
    if (may.error || may.data !== true) return json(403, { error: 'not_allowed' });
    let id;
    try { id = String((await req.json())?.client_id || ''); } catch { id = ''; }
    if (!UUID.test(id)) return json(400, { error: 'client_required' });
    const { data: client, error } = await db.from('clients').select('id, links').eq('id', id).maybeSingle();
    if (error || !client) return json(404, { error: 'no_client' });
    const folder = folderIdOf(client.links?.drive);
    if (!folder) return json(409, { error: client.links?.drive ? 'not_a_folder' : 'no_folder' });
    const sa = serviceAccountOf(deps.env('GOOGLE_DRIVE_SERVICE_ACCOUNT'));
    if (!sa) return json(503, { error: 'drive_not_connected' });
    try {
      const { files, truncated } = await makeDrive(sa, { fetch: deps.fetch || globalThis.fetch }).list(folder);
      return json(200, {
        files: files.map((f) => ({ name: f.name, mimeType: f.mimeType, createdTime: f.createdTime, link: f.link, path: f.path })),
        truncated,
      });
    } catch (e) {
      const code = String(e?.code || 'error');
      log(`drive: ${code}`);
      if (code === 'no_access') return json(403, { error: 'drive_no_access', robot: sa.email });
      if (code === 'auth') return json(503, { error: 'drive_auth' });
      return json(502, { error: 'drive_failed' });
    }
  };
}
