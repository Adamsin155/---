// Builds what GitHub Pages publishes: the HTML pages at the root, their
// manifests, the service worker (sw.js), app/ and payouts/, and nothing else. Pages serves every file in
// the gh-pages branch to anyone, even when the repository is private, so
// docs/, supabase/, tests/, scripts/ and .claude/ must never be pushed there.
// app/ stays public by nature: the browser runs it.
// Two things are written at publish and nowhere else (publishEdits; docs/ops.md, section 42),
// so the repository itself runs as it is, with no build step:
//  - every page lists the scripts it will run (<link rel="modulepreload">) and the app's
//    fonts, so the browser fetches them together instead of discovering them one import
//    after another;
//  - sw.js gets the version of this publish and the list of the site's files with the
//    hash of each: the files the service worker keeps on the device, and nothing else.
// Usage: node scripts/build-pages.mjs <outDir>  copy the site from the working tree into an empty folder (preview, tests)
//        node scripts/build-pages.mjs --commit  make a gh-pages commit from HEAD (committed files only) on top of
//                                               origin/gh-pages, and print the push command. Nothing is pushed.
//        … --no-store                           with either: publish a worker that keeps nothing (the way to turn
//                                               the files kept on the phones off: every phone drops to the network
//                                               on its next page).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// The top-level entries that make up the site. Anything else stays out of gh-pages.
export const DIRS = ['app', 'payouts'];
// sw.js is the site's service worker: at the root, so its scope covers the pages.
export const FILES = ['.nojekyll', 'CNAME', 'sw.js'];
const PAGE = /\.(html|webmanifest)$/;
export const published = (name, isDir) => (isDir ? DIRS.includes(name) : FILES.includes(name) || PAGE.test(name));

// ── What the publish writes ─────────────────
// Imports that start a line (static), and import('…') (asked for while the page runs).
const STATIC_IMPORTS = [/^\s*(?:import|export)\b[^'"]*?\bfrom\s*(['"])([^'"]+)\1/gm, /^\s*import\s*(['"])([^'"]+)\1/gm];
const DYNAMIC_IMPORT = /\bimport\(\s*(['"])([^'"]+)\1\s*\)/g;
// Asked for with import() by every staff page as soon as someone is signed in (the app
// menu, the WhatsApp consent): listed with the page's scripts. Any other import() stays
// lazy (a client's page does not fetch the staff's code).
export const EAGER = ['app/shell.js', 'app/whatsapp.js'];
// The app's text and heading fonts (app/fonts/fonts.css), for the pages with the app shell.
export const FONTS = ['app/fonts/heebo-hebrew.woff2', 'app/fonts/heebo-latin.woff2', 'app/fonts/varela-round-hebrew.woff2', 'app/fonts/varela-round-latin.woff2'];
export const SW_MARK = 'const BUILD = null;';
const PRELOAD_NOTE = '<!-- Written at publish (scripts/build-pages.mjs): what this page will load, asked for together. -->';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Every script a page's entry script loads, in the order met (the entry itself is not listed).
export function scriptsOf(entry, files) {
  const seen = new Set([entry]);
  const queue = [entry];
  const out = [];
  while (queue.length) {
    const file = queue.shift();
    const src = files.get(file)?.toString('utf8');
    if (src === undefined) continue;
    const specs = STATIC_IMPORTS.flatMap((re) => [...src.matchAll(re)].map((m) => ({ spec: m[2], eager: true })));
    specs.push(...[...src.matchAll(DYNAMIC_IMPORT)].map((m) => ({ spec: m[2], eager: false })));
    for (const { spec, eager } of specs) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
      const target = posix.normalize(posix.join(posix.dirname(file), spec));
      if (seen.has(target) || !files.has(target) || !(eager || EAGER.includes(target))) continue;
      seen.add(target);
      out.push(target);
      queue.push(target);
    }
  }
  return out;
}

// The page with its list of preloads before </head>. A page with no module script is left as it is.
export function withPreloads(html, files) {
  if (html.includes(PRELOAD_NOTE) || !html.includes('</head>')) return html;
  const entries = [...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]).filter((src) => files.has(src));
  if (!entries.length) return html;
  const scripts = [...new Set(entries.flatMap((e) => scriptsOf(e, files)))].filter((s) => !entries.includes(s));
  const fonts = html.includes('app/styles/shell.css') ? FONTS.filter((f) => files.has(f)) : [];
  const lines = [
    PRELOAD_NOTE,
    ...fonts.map((f) => `<link rel="preload" as="font" type="font/woff2" href="${f}" crossorigin>`),
    ...scripts.map((s) => `<link rel="modulepreload" href="${s}">`),
  ];
  return html.replace('</head>', () => `${lines.map((l) => `  ${l}\n`).join('')}</head>`);
}

// files: Map of every published file (posix path -> Buffer). Returns the files the
// publish changes: the pages (their preloads) and sw.js (the version and the list).
export function publishEdits(files, { store = true } = {}) {
  const edits = new Map();
  for (const [path, buf] of files) {
    if (path.includes('/') || !path.endsWith('.html')) continue;
    const html = buf.toString('utf8');
    const next = withPreloads(html, files);
    if (next !== html) edits.set(path, Buffer.from(next, 'utf8'));
  }
  const sw = files.get('sw.js')?.toString('utf8');
  if (sw !== undefined && store) {
    if (sw.split(SW_MARK).length !== 2) throw new Error(`sw.js: expected the line "${SW_MARK}" once`);
    // The files the worker keeps: everything published but the worker itself and the host's own files.
    const list = {};
    for (const path of [...files.keys()].sort()) {
      if (FILES.includes(path)) continue;
      list[path] = sha256(edits.get(path) ?? files.get(path));
    }
    const version = sha256(JSON.stringify(list)).slice(0, 16);
    edits.set('sw.js', Buffer.from(sw.replace(SW_MARK, () => `const BUILD = ${JSON.stringify({ version, files: list })};`), 'utf8'));
  }
  return edits;
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

// Copies the site from the working tree into outDir, which must be empty or not exist,
// and writes what the publish writes (the preloads, the worker's list).
export function build(outDir, { root = ROOT, store = true } = {}) {
  const out = resolve(outDir);
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${outDir} is not empty; choose an empty or new folder`);
  const names = readdirSync(root, { withFileTypes: true })
    .filter((e) => published(e.name, e.isDirectory()))
    .map((e) => e.name)
    .sort();
  mkdirSync(out, { recursive: true });
  for (const name of names) cpSync(join(root, name), join(out, name), { recursive: true });
  const files = new Map(walk(out).map((file) => [relative(out, file).split(sep).join('/'), readFileSync(file)]));
  for (const [path, buf] of publishEdits(files, { store })) writeFileSync(join(out, path), buf);
  return names;
}

// Records the site at `ref` as a commit whose parent is `base`, without
// touching the working tree, the index or any branch. Returns { sha, changed, ... }.
export function commitSite({ root = ROOT, ref = 'HEAD', base = 'refs/remotes/origin/gh-pages', store = true } = {}) {
  const git = (args, input) => execFileSync('git', args, { cwd: root, input, encoding: 'utf8' }).trim();
  const tryGit = (args) => { try { return git(args); } catch { return ''; } };
  const source = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  const parent = tryGit(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  if (!parent) throw new Error(`${base} not found. Run: git fetch origin gh-pages`);
  // ls-tree lines: "<mode> <type> <sha>\t<name>", the format mktree reads back.
  const entries = git(['ls-tree', source]).split('\n').filter((line) => {
    const [meta, name] = line.split('\t');
    return published(name, meta.split(' ')[1] === 'tree');
  });
  const names = entries.map((line) => line.split('\t')[1]);
  // What the publish writes (the preloads, the worker's list) goes in as new blobs of
  // the top-level files it changes; the folders are the commit's own.
  const raw = (args, input) => execFileSync('git', args, { cwd: root, input, maxBuffer: 1 << 28 });
  const blobs = raw(['ls-tree', '-r', '-z', source]).toString('utf8').split('\0').filter(Boolean).map((line) => {
    const [meta, path] = line.split('\t');
    return { sha: meta.split(' ')[2], path };
  }).filter(({ path }) => published(path.split('/')[0], path.includes('/')));
  const files = new Map(blobs.map(({ sha, path }) => [path, raw(['cat-file', 'blob', sha])]));
  const edits = publishEdits(files, { store });
  for (let i = 0; i < entries.length; i += 1) {
    const [meta, name] = entries[i].split('\t');
    if (!edits.has(name)) continue;
    const sha = raw(['hash-object', '-w', '--stdin'], edits.get(name)).toString('utf8').trim();
    entries[i] = `${meta.split(' ').slice(0, 2).join(' ')} ${sha}\t${name}`;
  }
  const tree = git(['mktree'], `${entries.join('\n')}\n`);
  if (git(['rev-parse', `${parent}^{tree}`]) === tree) return { sha: parent, parent, source, names, changed: false };
  const subject = git(['log', '-1', '--format=%s', source]);
  const sha = git(['commit-tree', tree, '-p', parent, '-m', `Site from ${source.slice(0, 7)}: ${subject}\n\nBuilt by scripts/build-pages.mjs from ${source}.`]);
  return { sha, parent, source, names, changed: true };
}

function main(all) {
  const store = !all.includes('--no-store');
  const args = all.filter((a) => a !== '--no-store');
  if (!store) console.log('--no-store: the worker of this publish keeps no files on the devices.');
  if (args[0] === '--commit') {
    const { sha, parent, source, names, changed } = commitSite({ store });
    console.log(`site from HEAD ${source.slice(0, 7)} (committed files only): ${names.join(', ')}`);
    if (!changed) {
      console.log(`origin/gh-pages (${parent.slice(0, 7)}) already has this site. Nothing to publish.`);
      return;
    }
    console.log(`commit ${sha} on top of origin/gh-pages ${parent.slice(0, 7)}. To publish:`);
    console.log(`  git push origin ${sha}:refs/heads/gh-pages`);
    return;
  }
  if (!args[0] || args[0].startsWith('-')) {
    console.error('usage: node scripts/build-pages.mjs <emptyOutDir> | --commit   [--no-store]');
    process.exit(1);
  }
  console.log(`built ${args[0]}: ${build(args[0], { store }).join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
