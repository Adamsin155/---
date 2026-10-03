// The rules of the client-media function (./index.ts), without Deno: what a request
// must look like, which origins may call it, and how the database's answer
// (public.media_for_token, 20261003110000_client_files.sql) becomes what the page
// gets: each file with a short-lived signed URL (to view), the same URL with a
// download name, and for images a small preview, and never the object's path.
// Tested in node: tests/client-media.test.mjs.
import { downloadName, isImage } from '../_shared/app/files-logic.js';

export const SITE_ORIGINS = ['https://adamsin155.github.io', 'https://app.astrateg.com'];
export const SCOPES = ['gallery', 'status'];
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
// How long a signed URL works (seconds): long enough to watch a video, short enough
// that a forwarded URL soon stops working. The page asks again when it is reopened.
export const URL_TTL = 3600;
// The preview of an image (Supabase image transformations: billed per origin image
// beyond the plan's quota; MEDIA_THUMBS=off turns them off and the page shows the image itself).
export const THUMB = { width: 480, height: 480, resize: 'cover', quality: 70 };
export const MAX_FILES = 300;

export function allowedOrigin(origin) {
  if (!origin) return null;
  if (SITE_ORIGINS.includes(origin)) return origin;
  try {
    const u = new URL(origin);
    if (u.protocol === 'http:' && u.hostname === 'localhost' && u.origin === origin) return origin;
  } catch { /* not a URL */ }
  return null;
}

export function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  const ok = allowedOrigin(origin);
  if (ok) headers['Access-Control-Allow-Origin'] = ok;
  return headers;
}

// { t, scope } → { token, scope } | null.
export function parseRequest(body) {
  if (!body || typeof body !== 'object') return null;
  const token = typeof body.t === 'string' ? body.t : '';
  const scope = typeof body.scope === 'string' ? body.scope : '';
  if (!SCOPES.includes(scope) || token.length > 100) return null;
  return { token, scope };
}

export const withDownload = (url, name) => `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`;
export const codeOf = (e) => e?.code ?? e?.name ?? 'error';

async function mapLimit(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  const worker = async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
  return out;
}

/**
 * The answer to one request.
 *   rpc(token, scope)  → public.media_for_token's jsonb
 *   sign(paths, ttl)   → signed URLs in the same order (null for one that failed)
 *   thumb(path, ttl)   → a signed preview URL of an image, or null (optional)
 * Returns { status, body, log? } (log: a short error code, never the token).
 */
export async function answer({ body, rpc, sign, thumb = null, ttl = URL_TTL }) {
  const req = parseRequest(body);
  if (!req) return { status: 400, body: { error: 'bad_request' } };
  if (!TOKEN.test(req.token)) return { status: 200, body: { state: 'invalid' } };
  let data;
  try {
    data = await rpc(req.token, req.scope);
  } catch (e) {
    return { status: 500, body: { error: 'server' }, log: codeOf(e) };
  }
  if (!data || data.state !== 'ok') return { status: 200, body: { state: data?.state || 'invalid' } };
  const files = (Array.isArray(data.files) ? data.files : []).filter((f) => f && typeof f.path === 'string').slice(0, MAX_FILES);
  let urls = [];
  try {
    urls = files.length ? await sign(files.map((f) => f.path), ttl) : [];
  } catch (e) {
    return { status: 500, body: { error: 'server' }, log: codeOf(e) };
  }
  const thumbs = thumb ? await mapLimit(files, 8, (f) => (isImage(f.mime) ? thumb(f.path, ttl).catch(() => null) : null)) : [];
  const seen = new Map();
  const out = [];
  files.forEach((f, i) => {
    const url = urls[i];
    if (!url) return;
    const { path: _path, ...rest } = f;
    const base = downloadName(f);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.push({ ...rest, url, download: withDownload(url, n ? downloadName(f, n + 1) : base), thumb: thumbs[i] || null });
  });
  return {
    status: 200,
    body: { state: 'ok', scope: data.scope || req.scope, business: data.business ?? null, expiresAt: data.expiresAt ?? null, ttl, files: out },
  };
}
