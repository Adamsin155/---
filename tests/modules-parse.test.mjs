// Every browser module must parse: a duplicate import or declaration breaks a
// whole page, and only the browser suites would notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = readdirSync(new URL('../app/', import.meta.url)).filter((f) => f.endsWith('.js'));

test('every app/*.js module parses', () => {
  const bad = [];
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', new URL(`../app/${f}`, import.meta.url).pathname], { stdio: 'pipe' }); }
    catch (e) { bad.push(`${f}: ${String(e.stderr).split('\n').find((l) => /Error/.test(l))}`); }
  }
  assert.deepEqual(bad, []);
});
