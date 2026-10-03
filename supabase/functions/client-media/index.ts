// The client's media by a secret link (no login): the view-only gallery
// (gallery.html?t=…, a gallery link) and the graphics next to the approvals on the
// status page (status.html?t=…, a status link).
//
// POST JSON { t: <token>, scope: 'gallery' | 'status' }
//   → { state: 'ok', scope, business, expiresAt, ttl, files: [{ id, kind, label, mime,
//       size, postedOn, link, at, item?, url, download, thumb }] }
//   → { state: 'invalid' | 'revoked' | 'expired' | 'closed' }   (200: the page words it)
//   → 400 { error: 'bad_request' }, 500 { error: 'server' }
//
// Deployed with verify_jwt=false (supabase/config.toml): the page's visitor has no
// login; the token is the credential. It is checked inside the database by
// public.media_for_token() (service role only; only the token's SHA-256 is stored,
// 20261003110000_client_files.sql), which also decides what the client may see: the
// deliverables, never who uploaded them or the file's own name. The bucket is
// private, so every file is reached through a signed URL made here with the service
// role, valid for an hour (URL_TTL in ./media.js). Nothing about the request is
// logged, only a short error code. The rules: ./media.js (tests/client-media.test.mjs).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { answer, corsHeaders, codeOf, THUMB } from './media.js';
import { BUCKET } from '../_shared/app/files-logic.js';

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
const thumbsOn = (Deno.env.get('MEDIA_THUMBS') ?? 'on') !== 'off';

async function rpc(token: string, scope: string) {
  const { data, error } = await admin.rpc('media_for_token', { p_token: token, p_scope: scope });
  if (error) throw error;
  return data;
}
async function sign(paths: string[], ttl: number) {
  const out: (string | null)[] = [];
  for (let i = 0; i < paths.length; i += 100) {
    const part = paths.slice(i, i + 100);
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrls(part, ttl);
    if (error) throw error;
    const byPath = new Map((data ?? []).map((d: any) => [d.path, d.error ? null : d.signedUrl]));
    for (const p of part) out.push(byPath.get(p) ?? null);
  }
  return out;
}
async function thumb(path: string, ttl: number) {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, ttl, { transform: THUMB });
  return error ? null : data?.signedUrl ?? null;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('origin'));
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' },
  });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'bad_request' });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  try {
    const r = await answer({ body, rpc, sign, thumb: thumbsOn ? thumb : null });
    if (r.log) console.error('client-media: failed', r.log);
    return json(r.status, r.body);
  } catch (e) {
    console.error('client-media: failed', codeOf(e));
    return json(500, { error: 'server' });
  }
});
