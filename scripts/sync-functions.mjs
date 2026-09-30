// Copies the browser modules the edge functions use (the ENTRIES below and every
// app module they import, followed recursively) into
// supabase/functions/_shared/app/, so a function deploys with its own copy and
// never loads code from the repository at run time. Relative paths are kept,
// so the copies import each other exactly as the originals do.
// Usage: node scripts/sync-functions.mjs          write the copies
//        node scripts/sync-functions.mjs --check  exit 1 if a copy is stale, missing or extra
//        node scripts/sync-functions.mjs --deploy what each function deploys (its files,
//                                                  the hand-written _shared ones, the copies)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const APP_DIR = join(ROOT, 'app');
export const OUT_DIR = join(ROOT, 'supabase/functions/_shared/app');
// The app modules edge functions import. Add one here when a new function needs it.
//   pricing.js                         create-quote
//   reminder-engine.js, push-config.js reminders (the engine, its rules and the protocol)
//   wa-logic.js (and wa-templates.js)  reminders and whatsapp-webhook (the WhatsApp channel)
//   calendar-feed.js, ics.js           calendar (the personal calendar feed)
export const ENTRIES = ['pricing.js', 'reminder-engine.js', 'push-config.js', 'wa-logic.js', 'calendar-feed.js', 'ics.js'];

// Every edge function in supabase/functions/ (tests/sync-functions.test.mjs checks
// the folder has no other, and what each one deploys).
export const FUNCTIONS = ['calendar', 'create-quote', 'reminders', 'staff-admin', 'whatsapp-webhook'];
export const FUNCTIONS_DIR = join(ROOT, 'supabase/functions');

export const MARK = '// generated — edit app/ instead.';
export const header = (rel) => `${MARK} Source: app/${rel}. Regenerate: node scripts/sync-functions.mjs\n`;

// Static imports and re-exports that start a line, side-effect imports, and dynamic imports.
const IMPORTS = [
  /^\s*(?:import|export)\b[^'"]*?\bfrom\s*(['"])([^'"]+)\1/gm,
  /^\s*import\s*(['"])([^'"]+)\1/gm,
  /\bimport\(\s*(['"])([^'"]+)\1\s*\)/g,
];

export function importsOf(source) {
  const specs = new Set();
  for (const re of IMPORTS) for (const m of source.matchAll(re)) specs.add(m[2]);
  return [...specs];
}

const posix = (p) => p.split(sep).join('/');

// Every app module reachable from the entries, as paths relative to app/ (sorted).
export function modules({ appDir = APP_DIR, entries = ENTRIES } = {}) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const file = join(appDir, rel);
    if (!['.js', '.mjs'].includes(extname(rel))) throw new Error(`app/${rel}: only .js modules can be shared`);
    if (!existsSync(file)) throw new Error(`app/${rel} not found`);
    seen.add(rel);
    for (const spec of importsOf(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
      const target = posix(relative(appDir, resolve(dirname(file), spec)));
      if (target.startsWith('../')) throw new Error(`app/${rel} imports ${spec}, which is outside app/`);
      queue.push(target);
    }
  }
  return [...seen].sort();
}

export function expected(opts = {}) {
  const appDir = opts.appDir ?? APP_DIR;
  return new Map(modules(opts).map((rel) => [rel, header(rel) + readFileSync(join(appDir, rel), 'utf8')]));
}

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? listFiles(full, base) : [posix(relative(base, full))];
  });
}

// What is wrong with the copies on disk: { missing, stale, extra }, each a list of paths relative to outDir.
export function check(opts = {}) {
  const outDir = opts.outDir ?? OUT_DIR;
  const want = expected(opts);
  const missing = [];
  const stale = [];
  for (const [rel, content] of want) {
    const file = join(outDir, rel);
    if (!existsSync(file)) missing.push(rel);
    else if (readFileSync(file, 'utf8') !== content) stale.push(rel);
  }
  const extra = listFiles(outDir).filter((rel) => !want.has(rel)).sort();
  return { missing, stale, extra };
}

// What a function deploys: its index.ts and every local file it reaches (its own,
// the hand-written ones in _shared/ such as _shared/wa-graph.js, and the copies in
// _shared/app/), paths relative to supabase/functions/, sorted.
export function deployFiles(fn, { functionsDir = FUNCTIONS_DIR } = {}) {
  const seen = new Set();
  const queue = [join(functionsDir, fn, 'index.ts')];
  while (queue.length) {
    const file = queue.shift();
    const rel = posix(relative(functionsDir, file));
    if (seen.has(rel)) continue;
    if (rel.startsWith('../')) throw new Error(`${fn} imports ${rel}, which is outside supabase/functions/`);
    if (!existsSync(file)) throw new Error(`${fn}: ${rel} not found`);
    seen.add(rel);
    for (const spec of importsOf(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('./') || spec.startsWith('../')) queue.push(resolve(dirname(file), spec));
    }
  }
  return [...seen].sort();
}

// Writes missing or stale copies and removes generated files that are no
// longer imported. A hand-written file in the folder is an error, not deleted.
export function sync(opts = {}) {
  const outDir = opts.outDir ?? OUT_DIR;
  const want = expected(opts);
  const { missing, stale, extra } = check(opts);
  const foreign = extra.filter((rel) => !readFileSync(join(outDir, rel), 'utf8').startsWith(MARK));
  if (foreign.length) throw new Error(`not generated, move out of ${posix(relative(ROOT, outDir))}: ${foreign.join(', ')}`);
  for (const rel of [...missing, ...stale]) {
    mkdirSync(dirname(join(outDir, rel)), { recursive: true });
    writeFileSync(join(outDir, rel), want.get(rel));
  }
  for (const rel of extra) rmSync(join(outDir, rel));
  return { files: [...want.keys()], written: [...missing, ...stale].sort(), removed: extra };
}

function main(args) {
  const out = posix(relative(ROOT, OUT_DIR));
  if (args.includes('--deploy')) {
    for (const fn of FUNCTIONS) console.log(`${fn}:\n${deployFiles(fn).map((f) => `  supabase/functions/${f}`).join('\n')}`);
    return;
  }
  if (args.includes('--check')) {
    const { missing, stale, extra } = check();
    const problems = [
      ...missing.map((f) => `missing: ${out}/${f}`),
      ...stale.map((f) => `stale:   ${out}/${f}`),
      ...extra.map((f) => `extra:   ${out}/${f}`),
    ];
    if (problems.length) {
      console.error(`${problems.join('\n')}\nThe edge functions' copy of app/ is out of date. Run: node scripts/sync-functions.mjs`);
      process.exit(1);
    }
    console.log(`${out} is up to date (${modules().length} files)`);
    return;
  }
  const { files, written, removed } = sync();
  for (const f of written) console.log(`wrote   ${out}/${f}`);
  for (const f of removed) console.log(`removed ${out}/${f}`);
  console.log(`${out}: ${files.join(', ')}${written.length || removed.length ? '' : ' (no changes)'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
