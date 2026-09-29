// Builds what GitHub Pages publishes: the HTML pages at the root, their
// manifests, app/ and payouts/, and nothing else. Pages serves every file in
// the gh-pages branch to anyone, even when the repository is private, so
// docs/, supabase/, tests/, scripts/ and .claude/ must never be pushed there.
// app/ stays public by nature: the browser runs it.
// Usage: node scripts/build-pages.mjs <outDir>  copy the site from the working tree into an empty folder (preview, tests)
//        node scripts/build-pages.mjs --commit  make a gh-pages commit from HEAD (committed files only) on top of
//                                               origin/gh-pages, and print the push command. Nothing is pushed.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// The top-level entries that make up the site. Anything else stays out of gh-pages.
export const DIRS = ['app', 'payouts'];
export const FILES = ['.nojekyll', 'CNAME'];
const PAGE = /\.(html|webmanifest)$/;
export const published = (name, isDir) => (isDir ? DIRS.includes(name) : FILES.includes(name) || PAGE.test(name));

// Copies the site from the working tree into outDir, which must be empty or not exist.
export function build(outDir, { root = ROOT } = {}) {
  const out = resolve(outDir);
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${outDir} is not empty; choose an empty or new folder`);
  const names = readdirSync(root, { withFileTypes: true })
    .filter((e) => published(e.name, e.isDirectory()))
    .map((e) => e.name)
    .sort();
  mkdirSync(out, { recursive: true });
  for (const name of names) cpSync(join(root, name), join(out, name), { recursive: true });
  return names;
}

// Records the site at `ref` as a commit whose parent is `base`, without
// touching the working tree, the index or any branch. Returns { sha, changed, ... }.
export function commitSite({ root = ROOT, ref = 'HEAD', base = 'refs/remotes/origin/gh-pages' } = {}) {
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
  const tree = git(['mktree'], `${entries.join('\n')}\n`);
  if (git(['rev-parse', `${parent}^{tree}`]) === tree) return { sha: parent, parent, source, names, changed: false };
  const subject = git(['log', '-1', '--format=%s', source]);
  const sha = git(['commit-tree', tree, '-p', parent, '-m', `Site from ${source.slice(0, 7)}: ${subject}\n\nBuilt by scripts/build-pages.mjs from ${source}.`]);
  return { sha, parent, source, names, changed: true };
}

function main(args) {
  if (args[0] === '--commit') {
    const { sha, parent, source, names, changed } = commitSite();
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
    console.error('usage: node scripts/build-pages.mjs <emptyOutDir> | --commit');
    process.exit(1);
  }
  console.log(`built ${args[0]}: ${build(args[0]).join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
