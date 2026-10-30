// The client's Google Drive folder, read-only (the owner's request of 29.10.2026; docs/ops.md,
// section 74): which files are in it, never what is inside them. First used by the ask function
// ("מה עלה לדרייב של <לקוח>?"); kept apart so that the content Gantt can later match its videos
// to the files in the same folder.
//
// How it signs in: a Google service account (a robot account of the office's Google Cloud
// project) whose JSON key is the edge-function secret GOOGLE_DRIVE_SERVICE_ACCOUNT. Each
// client's folder (or the one folder that holds them all) is shared with the robot's address as
// "צופה". The robot asks Google for a one-hour token with the scope drive.metadata.readonly:
// names, types, dates and links of files, and nothing else (it cannot open a file, change one,
// or see a folder that was not shared with it). The Google Calendar sync of 21.10.2026 reads a
// secret iCal address and has no Google sign-in to reuse.
//
// Plain JavaScript with fetch passed in (and WebCrypto, which Deno and node both have), so node
// tests it whole (tests/drive.test.mjs). The key is never logged and never returned.

export const SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const TIMEOUT_MS = 12000;
// At most this many files from one client (all the subfolders together), two folder levels down.
export const MAX_FILES = 400;
export const MAX_DEPTH = 2;
const FIELDS = 'nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, webViewLink, size)';

const fail = (code) => Object.assign(new Error(code), { code });

// The folder's id from what the office pastes in the card (links.drive):
//   https://drive.google.com/drive/folders/<id>?usp=sharing
//   https://drive.google.com/drive/u/1/folders/<id>
//   https://drive.google.com/open?id=<id>      a bare id
// null for anything else (a file's link, another site).
export function folderIdOf(link) {
  const s = String(link ?? '').trim();
  if (!s) return null;
  if (/^[\w-]{10,}$/.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'drive.google.com') return null;
  const m = /\/folders\/([\w-]{10,})/.exec(u.pathname);
  if (m) return m[1];
  const id = u.searchParams.get('id');
  return u.pathname === '/open' && id && /^[\w-]{10,}$/.test(id) ? id : null;
}

// The secret, read: { email, key } or null (not set, or not a service account's JSON key).
export function serviceAccountOf(json) {
  if (!json) return null;
  let v;
  try { v = typeof json === 'string' ? JSON.parse(json) : json; } catch { return null; }
  const email = typeof v?.client_email === 'string' ? v.client_email.trim() : '';
  const key = typeof v?.private_key === 'string' ? v.private_key : '';
  if (!email || !/-----BEGIN PRIVATE KEY-----/.test(key)) return null;
  return { email, key };
}

const enc = new TextEncoder();
const b64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlText = (text) => b64url(enc.encode(text));
function pemToDer(pem) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

// The signed request for a token (RFC 7523): header.claims.signature, RS256.
export async function signedAssertion(sa, { now = Date.now(), subtle = globalThis.crypto.subtle, scope = SCOPE } = {}) {
  const iat = Math.floor(now / 1000);
  const head = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64urlText(JSON.stringify({ iss: sa.email, scope, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const key = await subtle.importKey('pkcs8', pemToDer(sa.key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${claims}`)));
  return `${head}.${claims}.${b64url(sig)}`;
}

async function timed(fetch, url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === 'AbortError' || ctrl.signal.aborted) throw fail('timeout');
    throw fail('unreachable');
  } finally {
    clearTimeout(timer);
  }
}

// A reader of folders: { email, list(folderId) }. One token for the reader's life (an edge
// function's request), asked for on the first list.
//   list(folderId) → { files: [{ name, mimeType, createdTime, modifiedTime, link, size, path }], truncated }
// Throws a short code: no_access (not shared with the robot, or no such folder), auth (the key
// was refused), timeout, unreachable, http_<status>.
export function makeDrive(sa, { fetch = globalThis.fetch, now = () => Date.now(), timeoutMs = TIMEOUT_MS, subtle } = {}) {
  let token = null;
  async function getToken() {
    if (token && token.until > now() + 60000) return token.value;
    const assertion = await signedAssertion(sa, { now: now(), ...(subtle ? { subtle } : {}) });
    const res = await timed(fetch, TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    }, timeoutMs);
    if (!res.ok) throw fail('auth');
    const body = await res.json().catch(() => ({}));
    if (!body?.access_token) throw fail('auth');
    token = { value: body.access_token, until: now() + (Number(body.expires_in) || 3600) * 1000 };
    return token.value;
  }
  async function page(folderId, pageToken, since) {
    // `since`: only what was added from then on, and the folders (an old folder may hold a new file).
    const newer = since ? ` and (mimeType = '${FOLDER_MIME}' or createdTime > '${since}')` : '';
    const q = new URLSearchParams({
      q: `'${folderId.replace(/'/g, '')}' in parents and trashed = false${newer}`,
      fields: FIELDS, pageSize: '200', orderBy: 'createdTime desc',
      supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const res = await timed(fetch, `${FILES_URL}?${q}`, { headers: { Authorization: `Bearer ${await getToken()}` } }, timeoutMs);
    if (res.status === 404 || res.status === 403) throw fail('no_access');
    if (res.status === 401) throw fail('auth');
    if (!res.ok) throw fail(`http_${res.status}`);
    return res.json();
  }
  async function list(folderId, { since = null, maxDepth = MAX_DEPTH, maxFiles = MAX_FILES } = {}) {
    const out = [];
    let truncated = false;
    // Breadth first: the folder's own files, then its subfolders' (a month, "סרטונים ערוכים").
    const queue = [{ id: folderId, path: '', depth: 0 }];
    let first = true;
    while (queue.length) {
      const dir = queue.shift();
      let pageToken = null;
      do {
        let body;
        try {
          body = await page(dir.id, pageToken, since);
        } catch (e) {
          // The client's folder itself must open; a subfolder that does not is only skipped.
          if (first) throw e;
          break;
        }
        for (const f of Array.isArray(body?.files) ? body.files : []) {
          if (out.length >= maxFiles) { truncated = true; break; }
          const item = {
            name: String(f.name ?? ''), mimeType: String(f.mimeType ?? ''), createdTime: f.createdTime ?? null,
            modifiedTime: f.modifiedTime ?? null, link: f.webViewLink ?? null, size: f.size ? Number(f.size) : null, path: dir.path,
          };
          out.push(item);
          if (item.mimeType === FOLDER_MIME && dir.depth + 1 <= maxDepth) queue.push({ id: f.id, path: dir.path ? `${dir.path}/${item.name}` : item.name, depth: dir.depth + 1 });
        }
        if (out.length >= maxFiles && body?.nextPageToken) truncated = true;
        pageToken = out.length >= maxFiles ? null : body?.nextPageToken || null;
      } while (pageToken);
      first = false;
      if (out.length >= maxFiles) { truncated = truncated || queue.length > 0; break; }
    }
    return { files: out, truncated };
  }
  return { email: sa.email, list };
}

// What kind of file, by its type: 'folder', 'video', 'image', 'doc', 'other'.
export function kindOf(mimeType) {
  const m = String(mimeType || '');
  if (m === FOLDER_MIME) return 'folder';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('application/vnd.google-apps.') || m === 'application/pdf' || m.startsWith('text/')) return 'doc';
  return 'other';
}

// What a file is to the office, by its type and the name of its folder (the folders are not
// uniform: "סרטונים מוכנים", "גלם יום 1/סופי", "יום צילום 3"…): 'graphic' (not a video, in a
// graphics or highlights folder), 'raw' (footage and photos of a shoot), 'video', 'other'.
const GRAPHIC_FOLDER = /גרפיק|היילייט/;
const READY_FOLDER = /סופי|מוכנ|ערוכ|סגיר|מתוקן/;
const RAW_FOLDER = /גלם|מצלמה|רחפן|בירול|יום צילום|ראיונות|מאחורי הקלעים/;
export function fileClass(mimeType, path) {
  const p = String(path || '');
  const k = kindOf(mimeType);
  if (k === 'video') return !READY_FOLDER.test(p) && RAW_FOLDER.test(p) ? 'raw' : 'video';
  if (GRAPHIC_FOLDER.test(p)) return 'graphic';
  if (k === 'image' && (RAW_FOLDER.test(p) || /תמונות/.test(p))) return 'raw';
  return 'other';
}

// The listing, summed up: counts by kind, and the files themselves (no folders), newest first,
// with `since` (an ISO date) keeping only what was added from then on.
export function summarize(files, { since = null, limit = 60 } = {}) {
  const all = (files || []).filter((f) => !since || String(f.createdTime || '') >= since);
  const counts = { video: 0, image: 0, doc: 0, other: 0, folder: 0 };
  for (const f of all) counts[kindOf(f.mimeType)] += 1;
  const list = all.filter((f) => kindOf(f.mimeType) !== 'folder')
    .sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')))
    .map((f) => ({ name: f.name, kind: kindOf(f.mimeType), folder: f.path || null, added: f.createdTime ? String(f.createdTime).slice(0, 10) : null, link: f.link }));
  // Each subfolder's counts ("גרפיקות": 9 images), so a question about the graphics is answered
  // even when the newest files listed are all videos (the owner, 29.10.2026).
  const folders = {};
  for (const f of all) {
    const k = kindOf(f.mimeType);
    if (k === 'folder' || !f.path) continue;
    const c = (folders[f.path] ||= { video: 0, image: 0, doc: 0, other: 0 });
    c[k] += 1;
  }
  return { counts, folders, files: list.slice(0, limit), more: Math.max(0, list.length - limit) };
}
