// Uploading one file to Supabase Storage with progress, as the signed-in user (the
// bucket's policies decide; supabase/migrations/20261003110000_client_files.sql).
//   - up to 6 MB: one standard upload (POST /storage/v1/object/<bucket>/<path>);
//   - larger (videos, up to 2 GB): resumable, the TUS protocol Supabase supports
//     (POST /storage/v1/upload/resumable, then PATCH in 6 MB chunks, the size
//     Supabase requires). A dropped connection is retried from the last byte the
//     server has (HEAD), and an upload interrupted by closing the page continues
//     from there when the same file is chosen again on the same device (the upload's
//     address is kept in localStorage for a day).
// The vendored supabase-js has no resumable upload and no progress, so this is
// written here, small and without dependencies. The transport (XMLHttpRequest in the
// browser) can be replaced in tests (tests/upload.test.mjs).

export const CHUNK = 6 * 1024 * 1024;
export const RESUMABLE_OVER = 6 * 1024 * 1024;
export const RETRY_DELAYS = [1000, 3000, 6000, 12000, 20000];
const RESUME_TTL = 24 * 3600e3;

const b64 = (s) => btoa(unescape(encodeURIComponent(String(s))));
const encodePath = (p) => String(p).split('/').map(encodeURIComponent).join('/');

export class UploadError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'UploadError'; this.status = status; }
}

// The browser's transport: one request, progress on the body sent.
export function xhrTransport({ method, url, headers = {}, body = null, onProgress = null, signal = null }) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    if (onProgress && x.upload) x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    x.onload = () => resolve({ status: x.status, header: (n) => x.getResponseHeader(n), text: x.responseText });
    x.onerror = () => resolve({ status: 0, header: () => null, text: '' });
    x.onabort = () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
    if (signal) {
      if (signal.aborted) { x.abort(); return; }
      signal.addEventListener('abort', () => x.abort(), { once: true });
    }
    x.send(body);
  });
}

// Storage answers a policy refusal with HTTP 400 and statusCode "403" in the body.
function readError(r) {
  let msg = `upload failed (${r.status})`;
  let status = r.status;
  try {
    const j = JSON.parse(r.text || '{}');
    msg = j.message || j.error || msg;
    status = Number(j.statusCode) || status;
  } catch { if (r.text) msg = r.text.slice(0, 200); }
  return new UploadError(msg, status);
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }, { once: true });
});

// A small key-value store for resuming (localStorage in the browser; may be absent).
export function localStore() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    return { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v), remove: (k) => ls.removeItem(k) };
  } catch { return null; }
}

/**
 * Uploads `file` (a Blob/File) to `bucket` at `path`.
 * opts: { url (the project), apikey, token (the user's access token), bucket, path, file,
 *         contentType, onProgress(sent, total), signal, transport, store, resumeKey, delays }
 * Returns { path } (a resumed upload keeps the path it started with).
 */
export async function uploadFile(opts) {
  const { url, apikey, token, bucket, file, onProgress = () => {}, signal = null } = opts;
  const transport = opts.transport || xhrTransport;
  const type = opts.contentType || file.type || 'application/octet-stream';
  const auth = { authorization: `Bearer ${token}`, apikey, 'x-upsert': 'false' };
  const total = file.size;
  if (total <= RESUMABLE_OVER) {
    const r = await transport({
      method: 'POST', url: `${url}/storage/v1/object/${bucket}/${encodePath(opts.path)}`, signal,
      headers: { ...auth, 'content-type': type, 'cache-control': 'max-age=3600' }, body: file, onProgress: (n) => onProgress(n, total),
    });
    if (r.status < 200 || r.status >= 300) throw readError(r);
    onProgress(total, total);
    return { path: opts.path };
  }
  return resumable({ ...opts, type, auth, transport, total, onProgress, signal });
}

async function resumable({ url, bucket, path, file, type, auth, transport, total, onProgress, signal, store = localStore(), resumeKey = null, delays = RETRY_DELAYS }) {
  const tus = { ...auth, 'tus-resumable': '1.0.0' };
  let uploadUrl = null;
  let offset = 0;
  // A started upload of the same file on this device: continue it.
  const saved = (() => { try { return resumeKey && store ? JSON.parse(store.get(resumeKey) || 'null') : null; } catch { return null; } })();
  if (saved && saved.url && saved.path && Date.now() - saved.at < RESUME_TTL) {
    const h = await transport({ method: 'HEAD', url: saved.url, headers: tus, signal });
    if (h.status >= 200 && h.status < 300 && h.header('upload-offset') !== null) {
      uploadUrl = saved.url;
      path = saved.path;
      offset = Number(h.header('upload-offset')) || 0;
    } else store.remove(resumeKey);
  }
  if (!uploadUrl) {
    const r = await transport({
      method: 'POST', url: `${url}/storage/v1/upload/resumable`, signal,
      headers: {
        ...tus, 'upload-length': String(total),
        'upload-metadata': [['bucketName', bucket], ['objectName', path], ['contentType', type], ['cacheControl', '3600']].map(([k, v]) => `${k} ${b64(v)}`).join(','),
      },
    });
    if (r.status !== 201 || !r.header('location')) throw readError(r);
    uploadUrl = new URL(r.header('location'), `${url}/storage/v1/upload/resumable/`).href;
    if (resumeKey && store) { try { store.set(resumeKey, JSON.stringify({ url: uploadUrl, path, at: Date.now() })); } catch { /* full */ } }
  }
  onProgress(offset, total);
  let failures = 0;
  while (offset < total) {
    const end = Math.min(offset + CHUNK, total);
    const r = await transport({
      method: 'PATCH', url: uploadUrl, signal, body: file.slice(offset, end),
      headers: { ...tus, 'upload-offset': String(offset), 'content-type': 'application/offset+octet-stream' },
      onProgress: (n) => onProgress(offset + n, total),
    });
    if (r.status === 204 || r.status === 200) {
      offset = Number(r.header('upload-offset')) || end;
      failures = 0;
      onProgress(offset, total);
      continue;
    }
    // Refused for good: permissions, too large, gone.
    if ([400, 401, 403, 404, 410, 413].includes(r.status)) {
      if (resumeKey && store) store.remove(resumeKey);
      throw readError(r);
    }
    // Dropped or busy: wait, ask the server where it stands, and go on from there.
    if (failures >= delays.length) throw readError(r);
    await wait(delays[failures], signal);
    failures += 1;
    const h = await transport({ method: 'HEAD', url: uploadUrl, headers: tus, signal });
    if (h.status >= 200 && h.status < 300 && h.header('upload-offset') !== null) offset = Number(h.header('upload-offset'));
  }
  if (resumeKey && store) store.remove(resumeKey);
  return { path };
}
