// Every staff page must open on an older Safari too (Ilai's Mac, 24.11.2026: "הלקוחות שלי" stayed grey).
// A regular expression with a lookbehind ("(?<=" or "(?<!") is a syntax error before Safari 16.4, and
// one such line in a file that a page loads stops the whole page before it starts (app/legal.js is
// loaded by every staff page through the sign-in code). Nothing in app/ may use one; comments are fine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'vendor' || n === 'node_modules') return [];
    return statSync(p).isDirectory() ? files(p) : /\.(m?js)$/.test(n) ? [p] : [];
  });
}
const LOOKBEHIND = /\(\?<[=!]/;
test('no lookbehind in the code the pages load (Safari before 16.4)', () => {
  const found = [];
  for (const f of [...files(join(ROOT, 'app')), ...files(join(ROOT, 'payouts')).filter((p) => !/node_modules/.test(p))]) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (LOOKBEHIND.test(line.replace(/\/\/.*$/, ''))) found.push(`${f.slice(ROOT.length)}:${i + 1}`);
    });
  }
  assert.deepEqual(found, []);
});
test('the html pages\' own scripts too', () => {
  const found = readdirSync(ROOT).filter((n) => n.endsWith('.html')).filter((n) => LOOKBEHIND.test(readFileSync(join(ROOT, n), 'utf8')));
  assert.deepEqual(found, []);
});
