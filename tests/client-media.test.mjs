// The client-media edge function (supabase/functions/client-media): its rules
// (media.js) and the function itself (index.ts, run in node with its TypeScript
// types stripped and supabase-js replaced by a stand-in). A token is checked by the
// database before anything is signed; the answer carries signed URLs, a download
// name without the file's own name, a preview for images, and never the object's
// path or who uploaded; only the site's origins get CORS; a failure is a bare 500.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as nodeModule from 'node:module';
import { answer, parseRequest, allowedOrigin, withDownload, URL_TTL } from '../supabase/functions/client-media/media.js';

const TOKEN = 'A'.repeat(40) + 'b_-';
const files = [
  { id: '1', kind: 'deliverable_graphic', label: null, mime: 'image/png', size: 10, at: '2026-10-01T09:00:00Z', path: 'c/deliverable_graphic/0b0e8a5c-1d2e-4f3a-8b9c-0d1e2f3a4b5c-nadia-internal.png' },
  { id: '2', kind: 'deliverable_graphic', label: null, mime: 'image/png', size: 10, at: '2026-10-01T10:00:00Z', path: 'c/deliverable_graphic/1b0e8a5c-1d2e-4f3a-8b9c-0d1e2f3a4b5c-b.png' },
  { id: '3', kind: 'deliverable_video', label: 'סרטון השקה', mime: 'video/mp4', size: 99, at: '2026-10-02T10:00:00Z', path: 'c/deliverable_video/2b0e8a5c-1d2e-4f3a-8b9c-0d1e2f3a4b5c-v.mp4' },
];
const signOf = (p) => `https://p.test/storage/v1/object/sign/client-files/${p}?token=s`;

test('requests: a token and a scope; anything else is refused before the database', async () => {
  assert.deepEqual(parseRequest({ t: TOKEN, scope: 'gallery' }), { token: TOKEN, scope: 'gallery' });
  for (const b of [null, 'x', {}, { t: TOKEN }, { t: TOKEN, scope: 'all' }, { t: 'x'.repeat(200), scope: 'gallery' }]) assert.equal(parseRequest(b), null);
  let called = 0;
  const rpc = async () => { called += 1; return { state: 'ok', files }; };
  assert.equal((await answer({ body: { t: TOKEN, scope: 'other' }, rpc, sign: async () => [] })).status, 400);
  assert.deepEqual((await answer({ body: { t: 'short', scope: 'gallery' }, rpc, sign: async () => [] })).body, { state: 'invalid' });
  assert.equal(called, 0);
  assert.equal(allowedOrigin('https://adamsin155.github.io'), 'https://adamsin155.github.io');
  assert.equal(allowedOrigin('http://localhost:8095'), 'http://localhost:8095');
  assert.equal(allowedOrigin('https://evil.test'), null);
  assert.equal(withDownload('https://x/a?token=1', 'a b.png'), 'https://x/a?token=1&download=a%20b.png');
});

test('the answer: signed URLs, previews for images, download names without the file\'s name, no paths', async () => {
  const r = await answer({
    body: { t: TOKEN, scope: 'gallery' },
    rpc: async (t, s) => { assert.deepEqual([t, s], [TOKEN, 'gallery']); return { state: 'ok', scope: 'gallery', business: 'קפה דנה', expiresAt: 'x', files }; },
    sign: async (paths, ttl) => { assert.equal(ttl, URL_TTL); return paths.map(signOf); },
    thumb: async (p) => `${signOf(p)}&thumb=1`,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.business, 'קפה דנה');
  assert.equal(r.body.files.length, 3);
  // (The signed URL itself names the object, as Storage signs it: docs/ops.md, 19.)
  const text = JSON.stringify(r.body.files.map(({ url, download, thumb, ...rest }) => rest));
  for (const bad of ['nadia-internal', '"path"']) assert.ok(!text.includes(bad), bad);
  assert.ok(r.body.files.every((f) => !('path' in f)));
  assert.ok(r.body.files[0].url.includes('token=s'));
  assert.ok(r.body.files[0].thumb.endsWith('&thumb=1'));
  assert.equal(r.body.files[2].thumb, null); // a video has no preview
  assert.deepEqual(r.body.files.map((f) => decodeURIComponent(f.download.split('download=')[1])),
    ['astrateg-graphic-2026-10-01.png', 'astrateg-graphic-2026-10-01-2.png', 'astrateg-video-2026-10-02.mp4']);
  // A file that could not be signed is left out; a preview that fails is just null.
  const r2 = await answer({ body: { t: TOKEN, scope: 'gallery' }, rpc: async () => ({ state: 'ok', files }), sign: async (p) => [null, ...p.slice(1).map(signOf)], thumb: async () => { throw new Error('no transforms'); } });
  assert.deepEqual(r2.body.files.map((f) => f.id), ['2', '3']);
  assert.equal(r2.body.files[0].thumb, null);
});

test('a token the database refuses: its state; a failure: a bare 500 with a short code', async () => {
  for (const state of ['invalid', 'revoked', 'expired', 'closed']) {
    let signed = false;
    const r = await answer({ body: { t: TOKEN, scope: 'status' }, rpc: async () => ({ state }), sign: async () => { signed = true; return []; } });
    assert.deepEqual(r, { status: 200, body: { state } });
    assert.equal(signed, false);
  }
  const r = await answer({ body: { t: TOKEN, scope: 'status' }, rpc: async () => { throw Object.assign(new Error('secret detail'), { code: 'XX000' }); }, sign: async () => [] });
  assert.deepEqual(r, { status: 500, body: { error: 'server' }, log: 'XX000' });
});

// ── The function itself ────────────────────
const state = { calls: [], fail: false };
const mock = `
const state = globalThis.__mediaState;
export function createClient() {
  return {
    async rpc(name, args) {
      state.calls.push('rpc:' + name);
      if (state.fail) return { data: null, error: { code: 'XX000', message: 'secret detail' } };
      return { data: args.p_token === state.token ? { state: 'ok', scope: args.p_scope, business: 'קפה דנה', files: state.files } : { state: 'invalid' }, error: null };
    },
    storage: { from(bucket) { return {
      async createSignedUrls(paths, ttl) { state.calls.push('sign:' + bucket + ':' + paths.length + ':' + ttl); return { data: paths.map((p) => ({ path: p, signedUrl: 'https://p.test/s/' + p + '?token=x', error: null })), error: null }; },
      async createSignedUrl(path, ttl, opts) { state.calls.push('thumb:' + (opts && opts.transform ? opts.transform.width : 'none')); return { data: { signedUrl: 'https://p.test/r/' + path + '?token=y' }, error: null }; },
    }; } },
  };
}`;
let dir;
let handler;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mediafn-'));
  writeFileSync(join(dir, 'supabase-mock.mjs'), mock);
  const fnDir = new URL('../supabase/functions/client-media/', import.meta.url).href;
  const shared = new URL('../supabase/functions/_shared/app/', import.meta.url).href;
  let src = nodeModule.stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/client-media/index.ts', import.meta.url), 'utf8'));
  src = src.replace("'npm:@supabase/supabase-js@2'", `'${pathToFileURL(join(dir, 'supabase-mock.mjs')).href}'`)
    .replaceAll("'../_shared/app/", `'${shared}`).replaceAll("'./media.js'", `'${fnDir}media.js'`);
  writeFileSync(join(dir, 'index.mjs'), src);
  globalThis.__mediaState = Object.assign(state, { token: TOKEN, files });
  globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'x' })[k] }, serve: (h) => { handler = h; } };
  await import(pathToFileURL(join(dir, 'index.mjs')).href);
});
after(() => { rmSync(dir, { recursive: true, force: true }); delete globalThis.Deno; });

const call = (body, { method = 'POST', origin = 'https://adamsin155.github.io' } = {}) => handler(new Request('https://example.supabase.co/functions/v1/client-media', {
  method, headers: { 'content-type': 'application/json', origin }, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
}));

test('the function: a current token gets signed URLs (one batch), previews, no-store, CORS for the site', async () => {
  state.calls = [];
  const res = await call({ t: TOKEN, scope: 'gallery' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://adamsin155.github.io');
  const body = await res.json();
  assert.equal(body.files.length, 3);
  assert.ok(body.files.every((f) => !('path' in f) && !('uploaded_by' in f)));
  assert.deepEqual(state.calls, ['rpc:media_for_token', 'sign:client-files:3:3600', 'thumb:480', 'thumb:480']);
  const evil = await call({ t: TOKEN, scope: 'gallery' }, { origin: 'https://evil.test' });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('the function: a wrong token reads nothing; bad input 400; GET 405; a failure a bare 500', async () => {
  state.calls = [];
  assert.deepEqual(await (await call({ t: 'B'.repeat(43), scope: 'gallery' })).json(), { state: 'invalid' });
  assert.deepEqual(state.calls, ['rpc:media_for_token']);
  assert.equal((await call('not json')).status, 400);
  assert.equal((await call({ t: TOKEN })).status, 400);
  assert.equal((await call(null, { method: 'GET' })).status, 405);
  assert.equal((await call(null, { method: 'OPTIONS' })).status, 200);
  state.fail = true;
  const origError = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  const res = await call({ t: TOKEN, scope: 'status' });
  console.error = origError;
  state.fail = false;
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'server' });
  assert.ok(!logged.join(' ').includes('secret detail'));
  assert.ok(!logged.join(' ').includes(TOKEN));
});
