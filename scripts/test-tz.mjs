// `npm test`: the unit tests, once per time zone. The office runs on Israel time,
// and no result may depend on the zone of the machine (a phone abroad, a UTC
// server, a CI runner). Extra arguments go to `node --test`.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ZONES = ['UTC', 'America/New_York', 'Asia/Jerusalem'];
const dir = fileURLToPath(new URL('../tests/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `${dir}${f}`);

const failed = [];
for (const tz of ZONES) {
  console.log(`\n=== unit tests, TZ=${tz} ===`);
  const run = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit', env: { ...process.env, TZ: tz } });
  if (run.status !== 0) failed.push(tz);
}
console.log(failed.length ? `\nFAILED under: ${failed.join(', ')}` : `\nAll unit tests passed under ${ZONES.join(', ')}.`);
process.exit(failed.length ? 1 : 0);
