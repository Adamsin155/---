// The drive function's work (docs/ops.md, section 74), free of Deno APIs so node tests run it
// (tests/drive.test.mjs): the list of files in one client's Google Drive folder, for
// "משיכת קישורים מהדרייב" in the content Gantt (app/drive-links.js matches them to the items).
//
//   POST { client_id }  →  200 { files: [{ name, mimeType, createdTime, link, path }], truncated }
//
//   - whoever changes the Gantt (public.can_edit_gantt(): Ilai, Irit, Ofir, Lior and the owners),
//     or (17.11.2026, docs/ops.md section 140) a staff member who edits this client: its editor or
//     second editor, or the editor of one of its rounds (public.my_person() against the client's
//     row, read as the caller). The editor marks "כל הסרטונים הועלו לדרייב", and the mark is taken
//     only once this listing shows the videos (app/drive-guard.js). Only a client they can read
//     (the card's Drive link is read as the caller: row level security);
//   - read-only, names and links only (../_shared/drive.js, scope drive.metadata.readonly);
//   - the robot's key is the secret GOOGLE_DRIVE_SERVICE_ACCOUNT. Without it:
//     503 { error: 'drive_not_connected' } ("הדרייב עוד לא מחובר").
// Nothing is written here: the page fills the empty links through its own session.
import { serviceAccountOf, makeDrive, folderIdOf } from '../_shared/drive.js';
import { corsHeaders } from '../_shared/cors.js';
import { isOAuthToken } from '../_shared/oauth-token.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The client's row as the caller reads it (row level security), with its editors. Before the
// migration of the second editor (editor2) the column is missing: read again without it.
async function readClient(db, id) {
  let r = await db.from('clients').select('id, links, editor, editor2, rounds').eq('id', id).maybeSingle();
  if (r.error?.code === '42703') r = await db.from('clients').select('id, links, editor, rounds').eq('id', id).maybeSingle();
  return { client: r.data || null, error: r.error || null };
}
// Whether `person` (a staff key: 'yariv') edits this client: its own shoot, or any round of it.
export function editsClient(client, person) {
  if (!client || typeof person !== 'string' || !person) return false;
  const rounds = Array.isArray(client.rounds) ? client.rounds : [];
  return [client.editor, client.editor2, ...rounds.flatMap((r) => [r?.editor, r?.editor2])].includes(person);
}

// deps: { env(name), createClient(url, key, opts?), fetch, log(message) }
export function makeHandler(deps) {
  const log = deps.log || (() => {});
  return async function handle(req) {
    const CORS = corsHeaders(req.headers.get('origin'));
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
    // A connected app's token is for the mcp function alone (docs/ops.md, section 84).
    if (isOAuthToken(req.headers.get('authorization'))) return json(403, { error: 'not_allowed' });
    const db = deps.createClient(deps.env('SUPABASE_URL'), deps.env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: userData } = await db.auth.getUser();
    if (!userData?.user) return json(401, { error: 'not_signed_in' });
    const may = await db.rpc('can_edit_gantt');
    const gantt = !may.error && may.data === true;
    let id;
    try { id = String((await req.json())?.client_id || ''); } catch { id = ''; }
    if (!UUID.test(id)) return json(400, { error: 'client_required' });
    const { client, error } = await readClient(db, id);
    if (!gantt) {
      const me = await db.rpc('my_person');
      if (me.error || !editsClient(client, me.data)) return json(403, { error: 'not_allowed' });
    }
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
