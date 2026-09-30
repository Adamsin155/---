// GitHub Pages serves every file in gh-pages publicly, even from a private
// repository. These tests keep the published site to the pages and what they
// load, so docs/, supabase/, tests/ and the rest never reach it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { build, commitSite, published } from '../scripts/build-pages.mjs';
import { importsOf } from '../scripts/sync-functions.mjs';

const PAGES = ['index.html', 'q.html', 'quotes.html', 'client.html', 'clients.html', 'editor.html', 'shoot.html', 'clients.webmanifest'];
const NEVER = ['docs', 'supabase', 'tests', 'scripts', '.claude', '.github', 'private', 'node_modules',
  'README.md', 'package.json', 'package-lock.json', '.gitignore'];

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'pages-'));
  try { return fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}

test('the site is the pages, their manifests, app/ and payouts/ only', () => withTmp((tmp) => {
  const out = join(tmp, 'site');
  build(out);
  const top = readdirSync(out);
  for (const name of [...PAGES, 'app', 'payouts', '.nojekyll', 'sw.js']) assert.ok(top.includes(name), `${name} is not published`);
  for (const name of NEVER) assert.ok(!top.includes(name), `${name} would be public on GitHub Pages`);
  for (const name of top) assert.ok(published(name, statSync(join(out, name)).isDirectory()), name);
  assert.throws(() => build(out), /not empty/);
}));

test('every file a published page loads is published too', () => withTmp((tmp) => {
  const out = join(tmp, 'site');
  build(out);
  const local = (ref) => ref && !/^([a-z]+:|#|\/)/i.test(ref);
  const missing = [];
  for (const file of walk(out)) {
    const src = /\.(html|js|css|webmanifest)$/.test(file) ? readFileSync(file, 'utf8') : '';
    const refs = [];
    if (file.endsWith('.html')) refs.push(...[...src.matchAll(/\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]));
    if (/\.(html|js)$/.test(file)) refs.push(...importsOf(src));
    if (file.endsWith('.css')) refs.push(...[...src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]));
    if (file.endsWith('.webmanifest')) refs.push(...(JSON.parse(src).icons ?? []).map((i) => i.src));
    for (const ref of refs.filter(local)) {
      let target = resolve(dirname(file), ref.split(/[?#]/)[0]);
      if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
      if (!existsSync(target)) missing.push(`${relative(out, file)} -> ${ref}`);
    }
  }
  assert.deepEqual(missing, []);
}));

test('a gh-pages commit holds only the site, on top of origin/gh-pages', () => withTmp((repo) => {
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const write = (rel, text) => {
    mkdirSync(join(repo, dirname(rel)), { recursive: true });
    writeFileSync(join(repo, rel), text);
  };
  git('init', '-q');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  for (const rel of ['index.html', 'q.html', 'clients.webmanifest', 'app/a.js', 'payouts/index.html', '.nojekyll', 'CNAME',
    'README.md', 'docs/plan.md', 'supabase/migrations/1_x.sql', 'scripts/s.mjs', '.claude/agents/a.md', 'notes.txt']) write(rel, rel);
  git('add', '-A');
  git('commit', '-qm', 'source');
  const source = git('rev-parse', 'HEAD');

  assert.throws(() => commitSite({ root: repo }), /git fetch origin gh-pages/);

  // Today's gh-pages: the whole source branch pushed as is.
  git('update-ref', 'refs/remotes/origin/gh-pages', source);
  const first = commitSite({ root: repo });
  assert.equal(first.changed, true);
  assert.equal(first.parent, source);
  assert.equal(git('rev-parse', `${first.sha}^`), source, 'fast-forward from origin/gh-pages');
  assert.deepEqual(git('ls-tree', '-r', '--name-only', first.sha).split('\n').sort(),
    ['.nojekyll', 'CNAME', 'app/a.js', 'clients.webmanifest', 'index.html', 'payouts/index.html', 'q.html']);
  assert.equal(git('rev-parse', 'HEAD'), source, 'no branch moved');
  assert.equal(git('status', '--porcelain'), '');

  git('update-ref', 'refs/remotes/origin/gh-pages', first.sha);
  assert.equal(commitSite({ root: repo }).changed, false, 'nothing new to publish');
  write('docs/plan.md', 'changed');
  git('commit', '-qam', 'docs only');
  assert.equal(commitSite({ root: repo }).changed, false, 'a docs change publishes nothing');
}));
