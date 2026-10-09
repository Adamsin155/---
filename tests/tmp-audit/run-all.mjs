// Runs every browser suite, two at a time, and prints each one's real exit code.
import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';

const only = process.argv.slice(2);
const all = readdirSync('tests').filter((f) => f.endsWith('-e2e.mjs') || f === 'e2e.mjs').sort();
const list = only.length ? all.filter((f) => only.some((o) => f.startsWith(o))) : all;
const LOGS = process.env.LOGS || 'tests/tmp-audit/logs';
mkdirSync(LOGS, { recursive: true });
const results = {};
const run = (f) => new Promise((done) => {
  const t = Date.now();
  let out = '';
  const p = spawn(process.execPath, [`tests/${f}`], { env: process.env });
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => {
    writeFileSync(`${LOGS}/${f}.log`, out);
    results[f] = code;
    console.log(`rc=${code} ${f} (${Math.round((Date.now() - t) / 1000)}s)`);
    done();
  });
});
const queue = [...list];
const worker = async () => { while (queue.length) await run(queue.shift()); };
await Promise.all(Array.from({ length: Number(process.env.JOBS || 2) }, worker));
const bad = Object.entries(results).filter(([, c]) => c !== 0).map(([f]) => f);
console.log(`\n${list.length} suites, ${bad.length} failed${bad.length ? `: ${bad.join(', ')}` : ''}`);
