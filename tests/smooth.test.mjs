// The feel of an app on a phone (docs/ops.md, section 42): what the publish writes
// (the list of scripts each page preloads, the files the service worker keeps), that
// the worker keeps the site's own files and NOTHING else (never an answer of the
// database), how a new publish replaces the old one, and the markup and styles the
// staff pages need for it. The browser side is tests/smooth-e2e.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { build, commitSite, publishEdits, scriptsOf, withPreloads, EAGER, FONTS, FILES, SW_MARK } from '../scripts/build-pages.mjs';
import { SUPABASE_URL } from '../app/supa.js';
import { nextPage, quietPage } from '../app/feel.js';

const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const policyOf = (html) => /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] ?? null;

// The published site, built once for the tests below.
const tmp = mkdtempSync(join(tmpdir(), 'smooth-'));
const OUT = join(tmp, 'site');
build(OUT);
test.after(() => rmSync(tmp, { recursive: true, force: true }));
const built = new Map(walk(OUT).map((f) => [relative(OUT, f).split(sep).join('/'), readFileSync(f)]));
const PAGES = [...built.keys()].filter((p) => !p.includes('/') && p.endsWith('.html')).sort();
const buildOf = (swSource) => JSON.parse(/^const BUILD = (\{.*\});$/m.exec(swSource)[1]);

test('the gh-pages commit carries what the publish writes: the preloads in the page, the list in the worker; the folders are the commit\'s own', () => {
  const repo = mkdtempSync(join(tmpdir(), 'smooth-commit-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    const show = (rev, path) => execFileSync('git', ['show', `${rev}:${path}`], { cwd: repo });
    const write = (rel, text) => { mkdirSync(join(repo, dirname(rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
    git('init', '-q');
    git('config', 'user.name', 'test');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'core.autocrlf', 'false');
    write('index.html', '<!doctype html><html><head>\n</head><body><script type="module" src="app/a.js"></script></body></html>\n');
    write('app/a.js', "import { b } from './b.js';\nexport const a = b;\n");
    write('app/b.js', 'export const b = 1;\n');
    write('payouts/index.html', '<html>pay</html>\n');
    write('sw.js', read('sw.js'));
    write('docs/plan.md', 'not published');
    git('add', '-A');
    git('commit', '-qm', 'source');
    const source = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/gh-pages', source);
    const made = commitSite({ root: repo });
    assert.equal(made.changed, true);
    assert.deepEqual(git('ls-tree', '-r', '--name-only', made.sha).split('\n').sort(), ['app/a.js', 'app/b.js', 'index.html', 'payouts/index.html', 'sw.js']);
    const page = show(made.sha, 'index.html').toString('utf8');
    assert.match(page, /  <link rel="modulepreload" href="app\/b\.js">\n<\/head>/);
    const info = buildOf(show(made.sha, 'sw.js').toString('utf8'));
    assert.deepEqual(Object.keys(info.files), ['app/a.js', 'app/b.js', 'index.html', 'payouts/index.html']);
    for (const [path, hash] of Object.entries(info.files)) assert.equal(hash, sha(show(made.sha, path)), `${path}: the hash is of the file as it is published`);
    // The folders are the source commit's own trees, and the source commit itself is untouched.
    assert.equal(git('rev-parse', `${made.sha}:app`), git('rev-parse', `${source}:app`));
    assert.equal(show(source, 'sw.js').toString('utf8'), read('sw.js'));
    assert.equal(git('status', '--porcelain'), '');
    // The same source gives the same commit content (nothing new to publish), and --no-store publishes the worker as it is.
    git('update-ref', 'refs/remotes/origin/gh-pages', made.sha);
    assert.equal(commitSite({ root: repo }).changed, false);
    const plain = commitSite({ root: repo, store: false });
    assert.equal(plain.changed, true);
    assert.equal(show(plain.sha, 'sw.js').toString('utf8'), read('sw.js'));
    assert.match(show(plain.sha, 'index.html').toString('utf8'), /rel="modulepreload"/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('the repository runs as it is: the worker keeps nothing there, and no page lists preloads', () => {
  const sw = read('sw.js');
  assert.equal(sw.split(SW_MARK).length, 2, 'the line the publish replaces, once');
  for (const page of PAGES) assert.doesNotMatch(read(page), /rel="modulepreload"|rel="preload"/, page);
});

test('published pages: the same policy, no code written in, and the scripts each will run are preloaded', () => {
  assert.ok(PAGES.length >= 26, String(PAGES.length));
  for (const page of PAGES) {
    const html = built.get(page).toString('utf8');
    const source = read(page);
    assert.equal(policyOf(html), policyOf(source), `${page}: the Content-Security-Policy changed at publish`);
    assert.ok(policyOf(html), page);
    // The publish only adds <link> lines before </head>.
    const added = html.split('\n').filter((l) => !source.split('\n').includes(l));
    for (const line of added) assert.match(line, /^  (<!-- Written at publish[^>]*-->|<link rel="(modulepreload|preload)"[^>]*>)$/, `${page}: ${line}`);
    for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      assert.match(attrs, /\bsrc="/, `${page}: an inline script`);
      assert.equal(body.trim(), '', page);
    }
    assert.equal((html.match(/<style\b|\son[a-z]+\s*=\s*["']/g) || []).length, 0, page);
    const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
    const fonts = [...html.matchAll(/<link rel="preload" as="font" type="font\/woff2" href="([^"]+)" crossorigin>/g)].map((m) => m[1]);
    for (const href of [...preloads, ...fonts]) {
      assert.doesNotMatch(href, /^([a-z]+:|\/)/i, `${page}: ${href} is not a file of the site`);
      assert.ok(built.has(href), `${page}: ${href} is not published`);
    }
    assert.equal(new Set(preloads).size, preloads.length, `${page}: a script listed twice`);
    const entries = [...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(preloads, [...new Set(entries.flatMap((e) => scriptsOf(e, built)))].filter((s) => !entries.includes(s)), page);
    // The app's fonts on the pages with the app shell, and only there.
    assert.deepEqual(fonts, html.includes('app/styles/shell.css') && entries.length ? FONTS : [], page);
    // Before the end of the head, after the policy and the frame guard.
    if (preloads.length) assert.ok(html.indexOf('rel="modulepreload"') > html.indexOf('app/frame-guard.js') && html.indexOf('rel="modulepreload"') < html.indexOf('</head>'), page);
  }
});

test('the preload list is the page\'s real import graph: every static import, the app menu, and no lazy script', () => {
  const files = new Map([
    ['app/a.js', Buffer.from("import { b } from './b.js';\nimport './c.js';\nexport { d } from './d.js';\nconst x = () => import('./lazy.js');\nimport('./shell.js');\n")],
    ['app/b.js', Buffer.from("import {\n  one,\n  two,\n} from './vendor/v.js';\nimport { a } from './a.js';\n")],
    ['app/c.js', Buffer.from('// no imports\n')],
    ['app/d.js', Buffer.from("import x from 'https://elsewhere.example/x.js';\nimport { gone } from './missing.js';\n")],
    ['app/vendor/v.js', Buffer.from('export const one = 1;\n')],
    ['app/lazy.js', Buffer.from("import './heavy.js';\n")],
    ['app/heavy.js', Buffer.from('')],
    ['app/shell.js', Buffer.from("import './feel.js';\n")],
    ['app/feel.js', Buffer.from('')],
  ]);
  assert.deepEqual(EAGER, ['app/shell.js', 'app/whatsapp.js']);
  assert.deepEqual(scriptsOf('app/a.js', files), ['app/b.js', 'app/d.js', 'app/c.js', 'app/shell.js', 'app/vendor/v.js', 'app/feel.js']);
  const page = '<html><head>\n  <script src="app/frame-guard.js"></script>\n</head><body><script type="module" src="app/a.js"></script></body></html>';
  const out = withPreloads(page, files);
  assert.equal((out.match(/rel="modulepreload"/g) || []).length, 6);
  assert.equal(withPreloads(out, files), out, 'written once');
  assert.equal(withPreloads('<html><head></head><body></body></html>', files), '<html><head></head><body></body></html>', 'a page with no module script is left alone');
  // The real pages: a client's page does not preload the staff's code.
  const q = scriptsOf('app/client.js', built);
  assert.ok(!q.includes('app/shell.js') && !q.includes('app/clients.js') && !q.includes('app/protocol-ui.js'), q.join(' '));
  const mine = scriptsOf('app/clients.js', built);
  for (const need of ['app/protocol-ui.js', 'app/supa.js', 'app/vendor/supabase.js', 'app/shell.js', 'app/feel.js', 'app/whatsapp.js']) assert.ok(mine.includes(need), need);
});

test('the worker\'s list: every published file with the hash of its content, and nothing that is not a file of the site', () => {
  const info = buildOf(built.get('sw.js').toString('utf8'));
  assert.match(info.version, /^[0-9a-f]{16}$/);
  const expected = [...built.keys()].filter((p) => !FILES.includes(p)).sort();
  assert.deepEqual(Object.keys(info.files), expected);
  for (const [path, hash] of Object.entries(info.files)) {
    assert.equal(hash, sha(built.get(path)), path);
    assert.doesNotMatch(path, /^([a-z]+:|\/)|\.\.|supabase\.co|\?/i, path);
  }
  assert.ok(!('sw.js' in info.files) && !('CNAME' in info.files));
  for (const need of ['clients.html', 'client.html', 'index.html', 'app/clients.js', 'app/styles/shell.css', 'app/fonts/heebo-hebrew.woff2', 'payouts/index.html', 'payouts/icons/icon-192.png', 'clients.webmanifest']) assert.ok(need in info.files, need);
  // The same site gives the same version; any changed file gives another.
  const again = buildOf(publishEdits(new Map([...built].map(([p, b]) => [p, p === 'sw.js' ? Buffer.from(read('sw.js')) : b]))).get('sw.js').toString('utf8'));
  assert.equal(again.version, info.version);
  const changed = new Map([...built].map(([p, b]) => [p, p === 'sw.js' ? Buffer.from(read('sw.js')) : b]));
  changed.set('app/tz.js', Buffer.concat([changed.get('app/tz.js'), Buffer.from('\n// changed\n')]));
  const other = buildOf(publishEdits(changed).get('sw.js').toString('utf8'));
  assert.notEqual(other.version, info.version);
  assert.deepEqual(Object.keys(other.files).filter((p) => other.files[p] !== info.files[p]), ['app/tz.js']);
  assert.throws(() => publishEdits(new Map([['sw.js', Buffer.from('// no marker')]])), /expected the line/);
  // --no-store: the pages keep their preloads, and the worker is published as it is in the repository (it keeps nothing).
  const small = new Map([['sw.js', Buffer.from(read('sw.js'))], ['a.html', Buffer.from('<html><head>\n</head><body><script type="module" src="app/x.js"></script></body></html>')],
    ['app/x.js', Buffer.from("import './y.js';\n")], ['app/y.js', Buffer.from('')]]);
  assert.deepEqual([...publishEdits(small, { store: false }).keys()], ['a.html']);
  assert.deepEqual([...publishEdits(small).keys()], ['a.html', 'sw.js']);
});

// ── The worker itself, in a sandbox: real Response and SHA-256, a fake Cache Storage and network ──
const SITE = 'https://app.astrateg.test/';
function sandbox(swSource, { stores = new Map(), net, clientsOpen = [] }) {
  const listeners = {};
  const fetched = [];
  const posted = [];
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      match: async (url) => { const hit = m.get(String(url)); return hit ? new Response(hit.body, { status: 200, headers: hit.headers }) : undefined; },
      put: async (url, res) => { m.set(String(url), { body: Buffer.from(await res.arrayBuffer()), headers: Object.fromEntries(res.headers) }); },
    };
  };
  const caches = { open: async (name) => store(name), keys: async () => [...stores.keys()], delete: async (name) => stores.delete(name) };
  const fetch = async (input, init) => {
    const url = String(input?.url || input);
    fetched.push({ url, init });
    return net(url);
  };
  const self = {
    location: new URL('sw.js', SITE),
    registration: { scope: SITE, showNotification: async () => {} },
    clients: { matchAll: async () => clientsOpen.map((id) => ({ id, postMessage: (m) => posted.push({ id, ...m }) })), openWindow: async () => {} },
    skipWaiting: () => {},
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  vm.runInNewContext(swSource, { self, URL, String, JSON, Response, caches, fetch, crypto: webcrypto, Uint8Array, console });
  // A request as the browser hands it to the worker; resolves to the worker's answer, or null when it did not take it.
  // (settle: false: without waiting for what the worker goes on doing after its answer.)
  const ask = async (url, { method = 'GET', mode = 'cors', clientId = 'page-1', resultingClientId = '', headers = {}, settle = true } = {}) => {
    let answer = null;
    const waits = [];
    listeners.fetch?.({ request: { url, method, mode, headers: new Headers(headers) }, clientId, resultingClientId, respondWith: (p) => { answer = p; }, waitUntil: (p) => waits.push(p) });
    const res = answer ? await answer : null;
    if (settle) await Promise.all(waits);
    return res;
  };
  const message = async (data) => { const waits = []; listeners.message?.({ data, waitUntil: (p) => waits.push(p) }); await Promise.all(waits); };
  return { listeners, stores, fetched, posted, ask, message };
}
const siteOf = (files) => {
  const edits = publishEdits(new Map([...Object.entries(files).map(([p, text]) => [p, Buffer.from(text)]), ['sw.js', Buffer.from(read('sw.js'))]]));
  const sw = edits.get('sw.js').toString('utf8');
  const served = (url) => {
    const u = new URL(url);
    const path = u.pathname.slice(1);
    if (u.origin !== new URL(SITE).origin || !(path in files)) return new Response('not found', { status: 404 });
    return new Response(files[path], { status: 200, headers: { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/html', 'set-cookie': 'x=1', 'content-encoding': 'identity' } });
  };
  return { sw, served, info: buildOf(sw) };
};
const V1 = { 'clients.html': '<html>one</html>', 'index.html': '<html>home</html>', 'app/a.js': 'export const a = 1;', 'app/b.js': 'export const b = 1;', 'payouts/index.html': '<html>pay</html>' };

test('in the repository the worker takes no request at all', async () => {
  const stores = new Map([['astrateg-site-0123456789abcdef', new Map([['https://app.astrateg.test/clients.html', { body: Buffer.from('old'), headers: {} }]])], ['another-cache', new Map()]]);
  const w = sandbox(read('sw.js'), { stores, net: async () => new Response('x') });
  assert.equal(w.listeners.fetch, undefined);
  assert.equal(w.listeners.message, undefined);
  // It also clears what a published worker kept before it (the way to turn the store off: --no-store).
  let cleared;
  w.listeners.activate({ waitUntil: (p) => { cleared = p; } });
  await cleared;
  assert.deepEqual([...stores.keys()], ['another-cache']);
  assert.ok(w.listeners.push && w.listeners.notificationclick && w.listeners.install, 'the notifications are as before');
});

test('the worker never touches the database, the functions or the client\'s files, and stores only the listed files', async () => {
  const site = siteOf(V1);
  const w = sandbox(site.sw, { net: async (url) => site.served(url) });
  await w.message({ type: 'astrateg-fill' });
  const before = w.fetched.length;
  // Another host: not answered, not fetched, not stored. With a session's header or without.
  for (const url of [`${SUPABASE_URL}/rest/v1/clients?select=*`, `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, `${SUPABASE_URL}/functions/v1/client-media`,
    `${SUPABASE_URL}/storage/v1/object/sign/client-files/a.png?token=t`, `${SUPABASE_URL}/clients.html`, 'https://elsewhere.example/app/a.js']) {
    assert.equal(await w.ask(url, { headers: { authorization: 'Bearer secret' } }), null, url);
    assert.equal(await w.ask(url, { mode: 'navigate' }), null, url);
  }
  // This site: only a GET of a listed file. Not a write, not a part of a file, not an unknown address.
  assert.equal(await w.ask(`${SITE}clients.html`, { method: 'POST' }), null);
  assert.equal(await w.ask(`${SITE}app/a.js`, { method: 'HEAD' }), null);
  assert.equal(await w.ask(`${SITE}app/a.js`, { headers: { range: 'bytes=0-9' } }), null);
  for (const path of ['sw.js', 'rest/v1/clients', 'app/unknown.js', 'app/', 'app/../docs/ops.md', '%E0%A4%A']) assert.equal(await w.ask(`${SITE}${path}`), null, path);
  assert.equal(w.fetched.length, before, 'nothing was fetched for any of them');
  // What is stored: one store, the listed files and the mark that it is whole.
  assert.deepEqual([...w.stores.keys()], [`astrateg-site-${site.info.version}`]);
  const kept = [...w.stores.get(`astrateg-site-${site.info.version}`).keys()].sort();
  assert.deepEqual(kept, [...Object.keys(V1).map((p) => `${SITE}${p}`), `${SITE}__whole__`].sort());
  for (const [url, hit] of w.stores.get(`astrateg-site-${site.info.version}`)) {
    assert.ok(url.startsWith(SITE), url);
    assert.equal(hit.headers['set-cookie'], undefined, 'no header of the answer is kept but its type');
    assert.deepEqual(Object.keys(hit.headers), ['content-type'], url);
  }
  // The worker's code: the cache is written in one place, from the list; no request is ever stored as it passes.
  const code = read('sw.js').replace(/\/\/[^\n]*/g, '');
  assert.equal((code.match(/\.put\(/g) || []).length, 3, 'the three writes of fill(): a copied file, a fetched file, the mark');
  assert.doesNotMatch(code, /cache\.add|addAll|\.put\(\s*(event\.)?req/, 'no request is stored as it passes');
  assert.match(code, /if \(url\.origin !== self\.location\.origin\) return;/);
  assert.ok(code.indexOf('url.origin !== self.location.origin') < code.indexOf('event.respondWith('), 'another host is let go before anything is answered');
  assert.doesNotMatch(code, /supabase|importScripts|indexedDB/i);
});

test('a store answers only when it is whole and every file is the published content', async () => {
  const site = siteOf(V1);
  // The host still serves an older copy of one file (a publish that has not reached every edge).
  let stale = true;
  const net = async (url) => (stale && new URL(url).pathname === '/app/b.js' ? new Response('export const b = 0;', { status: 200 }) : site.served(url));
  const w = sandbox(site.sw, { net });
  await w.message({ type: 'astrateg-fill' });
  const name = `astrateg-site-${site.info.version}`;
  assert.ok(!w.stores.get(name).has(`${SITE}__whole__`), 'not whole');
  assert.ok(!w.stores.get(name).has(`${SITE}app/b.js`), 'the wrong content is not kept');
  // Until it is whole: the network, as before.
  const viaNet = await w.ask(`${SITE}app/a.js`);
  assert.equal(await viaNet.text(), V1['app/a.js']);
  assert.equal(w.fetched.at(-1).url, `${SITE}app/a.js`);
  // Every file is asked for past every cache, by its content, with no cookie.
  const asked = w.fetched.find((f) => f.url.startsWith(`${SITE}app/a.js?v=`));
  assert.equal(asked.url, `${SITE}app/a.js?v=${site.info.files['app/a.js'].slice(0, 16)}`);
  assert.deepEqual({ ...asked.init }, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
  // The next page tries again; now the host has it.
  stale = false;
  const n = w.fetched.length;
  await w.ask(`${SITE}clients.html?x=1#mine`, { mode: 'navigate', resultingClientId: 'page-2' });
  assert.ok(w.stores.get(name).has(`${SITE}__whole__`));
  assert.deepEqual(w.fetched.slice(n).map((f) => f.url.split('?')[0]).filter((u) => u.endsWith('app/b.js')), [`${SITE}app/b.js`], 'only the missing file is fetched again');
  // Whole: answered from the device, with any ?… and #…, and the folder addresses.
  const m = w.fetched.length;
  assert.equal(await (await w.ask(`${SITE}clients.html?id=7#mine`, { mode: 'navigate', resultingClientId: 'page-3' })).text(), V1['clients.html']);
  assert.equal(await (await w.ask(SITE, { mode: 'navigate', resultingClientId: 'page-4' })).text(), V1['index.html']);
  assert.equal(await (await w.ask(`${SITE}payouts/`, { mode: 'navigate', resultingClientId: 'page-5' })).text(), V1['payouts/index.html']);
  const js = await w.ask(`${SITE}app/a.js`, { clientId: 'page-3' });
  assert.equal(js.headers.get('content-type'), 'text/javascript');
  assert.equal(await js.text(), V1['app/a.js']);
  assert.equal(w.fetched.length, m, 'no request left the device');
});

test('a new publish: the old version answers until the new one is whole, a page keeps the version it opened with, then the old one goes', async () => {
  const one = siteOf(V1);
  const stores = new Map();
  const w1 = sandbox(one.sw, { stores, net: async (url) => one.served(url) });
  await w1.message({ type: 'astrateg-fill' });
  const V2 = { ...V1, 'clients.html': '<html>two</html>', 'app/a.js': 'export const a = 2;', 'app/new.js': 'export const n = 1;' };
  const two = siteOf(V2);
  assert.notEqual(two.info.version, one.info.version);
  // The new worker starts (the browser found another sw.js); the host is slow with one file.
  let release;
  const held = new Promise((r) => { release = r; });
  const net = async (url) => { if (new URL(url).pathname === '/app/new.js' && new URL(url).search) await held; return two.served(url); };
  // 'open-before': a page that was open when the new worker took over (the worker it was opened under is gone).
  const clientsOpen = ['open-before'];
  const w2 = sandbox(two.sw, { stores, net, clientsOpen });
  w2.listeners.activate({});
  // Meanwhile: a page opens, and gets version one whole (page and script of the same publish).
  clientsOpen.push('old-page');
  assert.equal(await (await w2.ask(`${SITE}clients.html`, { mode: 'navigate', resultingClientId: 'old-page', settle: false })).text(), V1['clients.html']);
  assert.equal(await (await w2.ask(`${SITE}app/a.js`, { clientId: 'old-page', settle: false })).text(), V1['app/a.js']);
  release();
  await w2.message({ type: 'astrateg-fill' });
  clientsOpen.push('fresh-page');
  // Only what changed was fetched; the rest was copied from the old store.
  const got = w2.fetched.map((f) => f.url).filter((u) => u.includes('?v=')).map((u) => new URL(u).pathname).sort();
  assert.deepEqual(got, ['/app/a.js', '/app/new.js', '/clients.html']);
  // A page opened now runs version two; the page that opened before keeps version one to its end.
  assert.equal(await (await w2.ask(`${SITE}clients.html`, { mode: 'navigate', resultingClientId: 'fresh-page' })).text(), V2['clients.html']);
  assert.equal(await (await w2.ask(`${SITE}app/a.js`, { clientId: 'fresh-page' })).text(), V2['app/a.js']);
  assert.equal(await (await w2.ask(`${SITE}app/a.js`, { clientId: 'old-page' })).text(), V1['app/a.js']);
  assert.equal(await (await w2.ask(`${SITE}app/a.js`, { clientId: 'open-before' })).text(), V1['app/a.js']);
  // Those pages were told a newer publish is ready (app/feel.js loads them again when that disturbs nobody).
  assert.deepEqual(w2.posted, ['open-before', 'old-page'].map((id) => ({ id, type: 'astrateg-update', version: two.info.version })));
  assert.deepEqual([...stores.keys()].sort(), [`astrateg-site-${one.info.version}`, `astrateg-site-${two.info.version}`].sort(), 'the old store stays while a page runs on it');
  // The next publish, with that page closed: every older store goes.
  const three = siteOf({ ...V2, 'app/b.js': 'export const b = 3;' });
  const w3 = sandbox(three.sw, { stores, net: async (url) => three.served(url), clientsOpen: [] });
  await w3.message({ type: 'astrateg-fill' });
  assert.deepEqual([...stores.keys()], [`astrateg-site-${three.info.version}`]);
  assert.deepEqual(w3.fetched.map((f) => new URL(f.url).pathname), ['/app/b.js']);
});

test('the staff pages are built out of sight and shown whole; the phone gets its safe areas and pressed states', () => {
  const sessionPages = PAGES.filter((p) => {
    const entry = /<script type="module" src="(app\/[^"]+)"/.exec(read(p))?.[1];
    // gantt.html is also the client's own page (no sign-in there): it starts the wait from its script.
    return entry && /\bmountSession\(/.test(read(entry)) && p !== 'gantt.html';
  });
  assert.ok(sessionPages.length >= 17, sessionPages.join(' '));
  for (const page of PAGES) {
    const html = read(page);
    const boot = /<html lang="he" dir="rtl"( data-boot(="plain")?)?>/.exec(html);
    assert.ok(boot, `${page}: the <html> tag`);
    // Every page that opens through mountSession (which ends the wait), and no other page.
    assert.equal(!!boot[1], sessionPages.includes(page), `${page}: data-boot`);
    if (boot[1]) for (const need of ['id="login-block"', 'id="app"', 'id="state"', 'app/styles/shell.css']) assert.ok(html.includes(need), `${page}: ${need}`);
    // Sales (Stav) have no bottom bar: its place is not held on their page.
    assert.equal(boot[2] === '="plain"', page === 'deal.html', page);
    assert.equal(html.includes('viewport-fit=cover'), html.includes('app/styles/shell.css'), `${page}: viewport-fit`);
  }
  const ui = read('app/protocol-ui.js');
  assert.match(ui, /if \(ok\) bootStart\(\); else bootEnd\(\);/);
  assert.match(ui, /finally \{[\s\S]{0,400}?bootEnd\(\);\s*\}/, 'the wait ends even when the page fails');
  const css = read('app/styles/shell.css');
  assert.match(css, /html\[data-boot\] #app \{ opacity: 0; pointer-events: none; \}/);
  assert.match(css, /touch-action: manipulation/);
  assert.match(css, /-webkit-tap-highlight-color: transparent/);
  assert.match(css, /:active:not\(:disabled, \[aria-disabled='true'\]\) \{ opacity: [.\d]+; \}/);
  assert.match(css, /@view-transition \{ navigation: auto; \}\s*@media \(prefers-reduced-motion: reduce\) \{ @view-transition \{ navigation: none; \} \}/);
  assert.match(css, /dialog, \.dlg-body, \.side-sheet \{ overscroll-behavior: contain; \}/);
  // The installed app opens on the page's own ground, not on the old dark one.
  const manifest = JSON.parse(read('clients.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#EEF0F4');
  assert.equal(manifest.theme_color, /<meta name="theme-color" content="([^"]+)">/.exec(read('clients.html'))[1]);
});

test('the next page is fetched early only when it is another page of this site; a page reloads itself only when nothing is typed', () => {
  const here = new URL('https://app.astrateg.test/clients.html#mine');
  const a = (href, attrs = {}) => ({ target: attrs.target || '', hasAttribute: (n) => n in attrs, getAttribute: () => href });
  assert.equal(nextPage(a('owner.html#now'), here), 'https://app.astrateg.test/owner.html');
  assert.equal(nextPage(a('client.html?id=abc#p08'), here), 'https://app.astrateg.test/client.html', 'the address of the client stays out of the early request');
  assert.equal(nextPage(a('./'), here), 'https://app.astrateg.test/');
  for (const none of [a('clients.html#clients'), a('#mine'), a('https://wa.me/972500000000'), a('https://elsewhere.example/x.html'), a('owner.html', { target: '_blank' }),
    a('file.pdf'), a('owner.html', { download: '' }), a('mailto:a@b.co'), null]) assert.equal(nextPage(none, here), null);
  const doc = (fields, dialog = false) => ({ querySelector: () => (dialog ? {} : null), querySelectorAll: () => fields });
  assert.equal(quietPage(doc([])), true);
  assert.equal(quietPage(doc([{ value: '', defaultValue: '' }, { value: 'saved', defaultValue: 'saved' }])), true);
  assert.equal(quietPage(doc([{ value: 'typed', defaultValue: '' }])), false);
  assert.equal(quietPage(doc([], true)), false, 'a dialog is open');
  const feel = read('app/feel.js');
  assert.match(feel, /if \(!stale \|\| !document\.hidden \|\| !quietPage\(\)\) return;/, 'only in the background, and only a quiet page');
  assert.match(feel, /updateViaCache: 'none'/);
});

test('every published file is still only the pages and what they load', () => {
  for (const path of built.keys()) {
    const top = path.split('/')[0];
    assert.ok(path.includes('/') ? ['app', 'payouts'].includes(top) : FILES.includes(path) || /\.(html|webmanifest)$/.test(path), path);
    assert.ok(statSync(join(OUT, path)).isFile());
  }
});
