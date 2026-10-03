// The edge functions deploy with their own copy of app/ (supabase/functions/_shared/app/).
// These tests fail when that copy drifts from app/, so the server never prices differently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_DIR, OUT_DIR, MARK, header, modules, importsOf, check, sync, FUNCTIONS as FUNCTION_NAMES, deployFiles,
} from '../scripts/sync-functions.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FUNCTIONS = join(ROOT, 'supabase/functions');

test('shared copy covers pricing.js, the reminder engine and everything they import', () => {
  assert.deepEqual(modules({ entries: ['pricing.js'] }), ['catalog.js', 'legal.js', 'pricing.js']);
  assert.deepEqual(modules(), [
    'auto-assign.js', 'calendar-feed.js', 'catalog.js', 'characterization.js', 'clocks.js', 'deal-logic.js', 'decisions-logic.js', 'holidays.js', 'ics.js', 'legal.js', 'messages-logic.js', 'office-marks.js', 'pricing.js',
    'production.js', 'protocol-logic.js', 'protocol-versions.js', 'protocol.js', 'push-config.js', 'qa-logic.js', 'quote-doc.js', 'reminder-engine.js', 'reminder-rules.js',
    'shoot-prep.js', 'status-rules.js', 'tz.js', 'wa-logic.js', 'wa-templates.js', 'year-logic.js', 'year-rules.js',
  ]);
});

test('every shared copy equals its app/ source under the generated header', () => {
  for (const rel of modules()) {
    const copy = readFileSync(join(OUT_DIR, rel), 'utf8');
    assert.ok(copy.startsWith(MARK), `${rel} lacks the generated header`);
    assert.equal(copy, header(rel) + readFileSync(join(APP_DIR, rel), 'utf8'),
      `supabase/functions/_shared/app/${rel} is stale: run node scripts/sync-functions.mjs`);
  }
  assert.deepEqual(check(), { missing: [], stale: [], extra: [] });
});

// Every relative import of a function's files stays inside supabase/functions/
// and reaches app/ only through the shared copy.
function localImports(fn, file, seen = new Set()) {
  const path = join(FUNCTIONS, fn, file);
  for (const spec of importsOf(readFileSync(path, 'utf8'))) {
    assert.ok(!/githubusercontent|github\.com/.test(spec), `remote import ${spec}`);
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(path), spec);
    assert.ok(target.startsWith(FUNCTIONS + sep), `${spec} leaves supabase/functions/`);
    assert.ok(existsSync(target), `${spec} does not exist`);
    seen.add(target.slice(FUNCTIONS.length + 1).split(sep).join('/'));
  }
  return seen;
}

test('create-quote imports only the shared copy, never the repository', () => {
  assert.ok(importsOf(readFileSync(join(FUNCTIONS, 'create-quote/index.ts'), 'utf8')).includes('../_shared/app/pricing.js'));
  localImports('create-quote', 'index.ts');
});

test('the reminders function imports only its own files and the shared copy', () => {
  const files = new Set(['index.ts', 'tick.js', 'webpush.js', 'http.js', 'wa-server.ts', 'whatsapp.js'].flatMap((f) => [...localImports('reminders', f)]));
  assert.deepEqual([...files].filter((f) => !f.startsWith('_shared/app/')).sort(), [
    '_shared/wa-graph.js', 'reminders/http.js', 'reminders/tick.js', 'reminders/wa-server.ts', 'reminders/webpush.js', 'reminders/whatsapp.js',
  ]);
  for (const f of files) if (f.startsWith('_shared/app/')) assert.ok(modules().includes(f.slice('_shared/app/'.length)), f);
});

test('the whatsapp-webhook function imports only its own files and the shared copies', () => {
  const files = new Set(['index.ts', 'webhook.js'].flatMap((f) => [...localImports('whatsapp-webhook', f)]));
  assert.deepEqual([...files].filter((f) => !f.startsWith('_shared/app/')).sort(), ['_shared/wa-graph.js', 'whatsapp-webhook/webhook.js']);
  for (const f of files) if (f.startsWith('_shared/app/')) assert.ok(modules().includes(f.slice('_shared/app/'.length)), f);
});

test('the calendar function imports only the shared copy', () => {
  const files = [...localImports('calendar', 'index.ts')];
  assert.deepEqual(files.sort(), ['_shared/app/calendar-feed.js', '_shared/app/ics.js']);
  for (const f of files) assert.ok(modules().includes(f.slice('_shared/app/'.length)), f);
  const config = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8');
  assert.match(config, /\[functions\.calendar\]\s*\nverify_jwt = false/);
});

// What each function deploys (supabase functions deploy <name> uploads these; docs/ops.md).
const APP = (...xs) => xs.map((x) => `_shared/app/${x}`);
const DEPLOY = {
  calendar: [
    ...APP('calendar-feed.js', 'catalog.js', 'holidays.js', 'ics.js', 'protocol-logic.js', 'protocol-versions.js', 'protocol.js', 'tz.js'),
    'calendar/index.ts',
  ],
  'create-quote': [
    ...APP('catalog.js', 'legal.js', 'pricing.js'),
    'create-quote/index.ts',
  ],
  reminders: [
    ...APP('auto-assign.js', 'catalog.js', 'characterization.js', 'clocks.js', 'deal-logic.js', 'decisions-logic.js', 'holidays.js', 'legal.js', 'messages-logic.js', 'office-marks.js', 'pricing.js', 'production.js', 'protocol-logic.js', 'protocol-versions.js', 'protocol.js', 'push-config.js', 'qa-logic.js', 'quote-doc.js', 'reminder-engine.js', 'reminder-rules.js', 'shoot-prep.js', 'status-rules.js', 'tz.js', 'wa-logic.js', 'wa-templates.js', 'year-logic.js', 'year-rules.js'),
    '_shared/wa-graph.js',
    'reminders/http.js',
    'reminders/index.ts',
    'reminders/tick.js',
    'reminders/wa-server.ts',
    'reminders/webpush.js',
    'reminders/whatsapp.js',
  ],
  'staff-admin': [
    'staff-admin/index.ts',
    'staff-admin/rules.js',
  ],
  'whatsapp-webhook': [
    ...APP('auto-assign.js', 'catalog.js', 'characterization.js', 'clocks.js', 'deal-logic.js', 'decisions-logic.js', 'holidays.js', 'legal.js', 'messages-logic.js', 'office-marks.js', 'pricing.js', 'production.js', 'protocol-logic.js', 'protocol-versions.js', 'protocol.js', 'qa-logic.js', 'quote-doc.js', 'reminder-rules.js', 'shoot-prep.js', 'status-rules.js', 'tz.js', 'wa-logic.js', 'wa-templates.js', 'year-logic.js', 'year-rules.js'),
    '_shared/wa-graph.js',
    'whatsapp-webhook/index.ts',
    'whatsapp-webhook/webhook.js',
  ],
};
test('every function, and every file it deploys (the shared copies it reaches are all generated)', () => {
  const dirs = readdirSync(FUNCTIONS, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== '_shared').map((e) => e.name).sort();
  assert.deepEqual(FUNCTION_NAMES, dirs);
  assert.deepEqual(Object.keys(DEPLOY).sort(), dirs);
  const reached = new Set();
  for (const fn of FUNCTION_NAMES) {
    const files = deployFiles(fn);
    assert.deepEqual(files, [...DEPLOY[fn]].sort(), fn);
    for (const f of files) if (f.startsWith('_shared/app/')) reached.add(f.slice('_shared/app/'.length));
  }
  // The copies are exactly what the functions reach: nothing generated for nobody.
  for (const rel of reached) assert.ok(modules().includes(rel), rel);
  for (const rel of modules()) assert.ok(reached.has(rel), `${rel} is copied but no function reaches it`);
  // The hand-written shared file is not in the generated folder.
  assert.ok(!readFileSync(join(FUNCTIONS, '_shared/wa-graph.js'), 'utf8').startsWith(MARK));
});

test('verify_jwt: off for the functions that check their caller themselves', () => {
  const config = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8');
  const off = [...config.matchAll(/\[functions\.([a-z-]+)\]\s*\nverify_jwt = false/g)].map((m) => m[1]).sort();
  assert.deepEqual(off, ['calendar', 'reminders', 'staff-admin', 'whatsapp-webhook']);
});

test('the shared pricing engine computes the same quote as app/', async () => {
  const app = await import('../app/pricing.js');
  const shared = await import('../supabase/functions/_shared/app/pricing.js');
  const sel = {
    ...app.emptySelection(),
    docType: 'agreement', tier: 'social-tv', influencer: 'natali',
    paid: ['photographer', 'natali-reel'],
  };
  const client = { name: 'לקוח בדיקה', company: 'חברה' };
  app.validateSelection(sel);
  shared.validateSelection(sel);
  assert.deepEqual(shared.buildQuoteModel(sel, client), app.buildQuoteModel(sel, client));
  assert.throws(() => shared.validateSelection({ ...sel, tier: 'nope' }));
});

test('--check logic reports stale, missing and extra copies; sync repairs them', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sync-fn-'));
  try {
    const appDir = join(tmp, 'app');
    const outDir = join(tmp, 'out');
    for (const rel of ['pricing.js', 'catalog.js', 'legal.js']) cpSync(join(APP_DIR, rel), join(appDir, rel));
    const opts = { appDir, outDir, entries: ['pricing.js'] };
    assert.deepEqual(check(opts).missing, ['catalog.js', 'legal.js', 'pricing.js']);
    sync(opts);
    assert.deepEqual(check(opts), { missing: [], stale: [], extra: [] });

    writeFileSync(join(appDir, 'catalog.js'), `${readFileSync(join(appDir, 'catalog.js'), 'utf8')}\n// changed\n`);
    writeFileSync(join(outDir, 'old.js'), `${header('old.js')}export const x = 1;\n`);
    assert.deepEqual(check(opts), { missing: [], stale: ['catalog.js'], extra: ['old.js'] });
    assert.deepEqual(sync(opts).removed, ['old.js']);
    assert.deepEqual(check(opts), { missing: [], stale: [], extra: [] });
    assert.deepEqual(readdirSync(outDir).sort(), ['catalog.js', 'legal.js', 'pricing.js']);

    writeFileSync(join(outDir, 'notes.js'), '// hand written\n');
    assert.throws(() => sync(opts), /not generated/);
    assert.ok(existsSync(join(outDir, 'notes.js')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('imports are followed into sub-folders and must stay inside app/', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sync-fn-'));
  try {
    const appDir = join(tmp, 'app');
    const write = (rel, src) => {
      mkdirSync(join(appDir, dirname(rel)), { recursive: true });
      writeFileSync(join(appDir, rel), src);
    };
    write('a.js', "import {\n  b,\n} from './lib/b.js';\nexport * from \"./c.js\";\nconst d = () => import('./d.js');\n// import x from './not-a-file.js' is a comment\n");
    write('lib/b.js', "import { c } from '../c.js';\nexport const b = c;\n");
    write('c.js', 'export const c = 1;\n');
    write('d.js', "import 'npm:left-alone';\nexport const d = 1;\n");
    assert.deepEqual(modules({ appDir, entries: ['a.js'] }), ['a.js', 'c.js', 'd.js', 'lib/b.js']);
    write('e.js', "import { x } from '../outside.js';\n");
    assert.throws(() => modules({ appDir, entries: ['e.js'] }), /outside app/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
