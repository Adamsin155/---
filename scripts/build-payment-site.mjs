// Builds the standalone "Astrateg Payment" site (the payouts app at the
// root of its own GitHub Pages repository) from this repository's files.
// Usage: node scripts/build-payment-site.mjs <outDir> [basePath]
//   basePath defaults to /astrateg-payment/ (https://adamsin155.github.io/astrateg-payment/)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
const base = process.argv[3] || '/astrateg-payment/';
if (!out) {
  console.error('usage: node scripts/build-payment-site.mjs <outDir> [basePath]');
  process.exit(1);
}
const root = new URL('..', import.meta.url).pathname;
const src = (p) => join(root, p);

// Keep the target's .git (it is a clone of the site repository).
if (existsSync(out)) {
  for (const name of readdirSync(out)) if (name !== '.git') rmSync(join(out, name), { recursive: true, force: true });
} else {
  mkdirSync(out, { recursive: true });
}

const files = [
  'app/payouts/app.js', 'app/payouts/data.js', 'app/payouts/engine.js', 'app/payouts/client.js',
  'app/catalog.js', 'app/pricing.js', 'app/legal.js',
  'app/styles/payouts.css', 'app/assets/logo.png', 'app/assets/logo-mark.png',
];
for (const f of files) {
  mkdirSync(join(out, f, '..'), { recursive: true });
  cpSync(src(f), join(out, f));
}
cpSync(src('app/vendor'), join(out, 'app/vendor'), { recursive: true });
cpSync(src('app/fonts'), join(out, 'app/fonts'), { recursive: true });
cpSync(src('payouts/icons'), join(out, 'icons'), { recursive: true });

const html = readFileSync(src('payouts/index.html'), 'utf8').replaceAll('../app/', 'app/');
writeFileSync(join(out, 'index.html'), html);

const manifest = JSON.parse(readFileSync(src('payouts/manifest.webmanifest'), 'utf8'));
Object.assign(manifest, { id: base, start_url: base, scope: base });
writeFileSync(join(out, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);

// The statement's logo is referenced relative to the page.
const appJs = join(out, 'app/payouts/app.js');
writeFileSync(appJs, readFileSync(appJs, 'utf8').replaceAll("'../app/assets/logo.png'", "'app/assets/logo.png'"));

writeFileSync(join(out, '.nojekyll'), '');
writeFileSync(join(out, 'README.md'), `# אסטרטג פיימנט

האתר של מערכת התשלומים החודשית: https://adamsin155.github.io${base}

**אין לערוך כאן.** הקבצים נבנים מהריפו \`Adamsin155/---\` בפקודה:

\`\`\`bash
node scripts/build-payment-site.mjs <תיקיית הריפו הזה>
\`\`\`

הנתונים (עסקאות, אחוזים, משכורות) נשמרים ב־Supabase ונגישים רק לבעלים. אין בריפו הזה נתונים עסקיים.
`);
console.log(`built ${out} for ${base}`);
