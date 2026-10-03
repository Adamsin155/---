// Every browser module must parse: a duplicate import or declaration breaks a
// whole page, and only the browser suites would notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const files = readdirSync(new URL('../app/', import.meta.url)).filter((f) => f.endsWith('.js'));

test('every app/*.js module parses', () => {
  const bad = [];
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', fileURLToPath(new URL(`../app/${f}`, import.meta.url))], { stdio: 'pipe' }); }
    catch (e) { bad.push(`${f}: ${String(e.stderr).split('\n').find((l) => /Error/.test(l))}`); }
  }
  assert.deepEqual(bad, []);
});

// Every name a module imports from another app module is exported there: a
// renamed or removed export (three branches merged into one) breaks a page at
// load, and only a browser suite that opens that page would notice.
test('every named import between app/*.js modules exists', () => {
  const src = Object.fromEntries(files.map((f) => [f, readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8')]));
  const exportsOf = (f) => {
    const s = src[f];
    const out = new Set();
    for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
    for (const m of s.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',').map((x) => x.trim()).filter(Boolean)) out.add(part.split(/\s+as\s+/).at(-1));
    }
    if (/export\s+default\b/.test(s)) out.add('default');
    return { names: out, star: /export\s*\*\s*from/.test(s) };
  };
  const missing = [];
  for (const f of files) {
    for (const m of src[f].matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/([\w.-]+\.js)['"]/g)) {
      if (!src[m[2]]) { missing.push(`${f}: ./${m[2]} does not exist`); continue; }
      const ex = exportsOf(m[2]);
      if (ex.star) continue;
      for (const part of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        const name = part.split(/\s+as\s+/)[0];
        if (!ex.names.has(name)) missing.push(`${f}: ${name} is not exported by ${m[2]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
