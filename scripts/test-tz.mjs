// `npm test`: the unit tests, once per time zone. The office runs on Israel time,
// and no result may depend on the zone of the machine (a phone abroad, a UTC
// server, a CI runner). Then the database tests (tests/sql/: every migration in a
// real Postgres, PGlite), once: the database keeps its own zone, UTC as in Supabase.
// Extra arguments go to `node --test`.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ZONES = ['UTC', 'America/New_York', 'Asia/Jerusalem'];
const testsIn = (rel) => {
  const dir = fileURLToPath(new URL(rel, import.meta.url));
  return readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `${dir}${f}`);
};
const files = testsIn('../tests/');
const sqlFiles = testsIn('../tests/sql/');

const failed = [];
const run = (label, list, env) => {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...list], { stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) failed.push(label);
};
for (const tz of ZONES) run(`unit tests, TZ=${tz}`, files, { TZ: tz });
if (sqlFiles.length) run('database tests (tests/sql, PGlite)', sqlFiles, {});
console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : `\nAll unit tests passed under ${ZONES.join(', ')}; database tests passed.`);
process.exit(failed.length ? 1 : 0);
