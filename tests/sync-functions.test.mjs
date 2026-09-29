// The edge functions deploy with their own copy of app/ (supabase/functions/_shared/app/).
// These tests fail when that copy drifts from app/, so the server never prices differently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_DIR, OUT_DIR, MARK, header, modules, importsOf, check, sync,
} from '../scripts/sync-functions.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FUNCTIONS = join(ROOT, 'supabase/functions');

test('shared copy covers pricing.js and everything it imports', () => {
  assert.deepEqual(modules(), ['catalog.js', 'legal.js', 'pricing.js']);
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

test('create-quote imports only the shared copy, never the repository', () => {
  const src = readFileSync(join(FUNCTIONS, 'create-quote/index.ts'), 'utf8');
  const specs = importsOf(src);
  assert.ok(specs.includes('../_shared/app/pricing.js'));
  for (const spec of specs) {
    assert.ok(!/githubusercontent|github\.com/.test(spec), `remote import ${spec}`);
    if (!spec.startsWith('.')) continue;
    const target = resolve(FUNCTIONS, 'create-quote', spec);
    assert.ok(target.startsWith(FUNCTIONS + '/'), `${spec} leaves supabase/functions/`);
    assert.ok(existsSync(target), `${spec} does not exist`);
  }
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
    const opts = { appDir, outDir };
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
