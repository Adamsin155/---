// '
// Runs the whole simulation, stage after stage (each starts from the saved state of the one before),
// the two side experiments, and builds the step table. About 15 minutes. Nothing leaves the machine.
//   node tests/sim/run.mjs            everything
//   node tests/sim/run.mjs stage6b    from that stage on (the states before it must exist in tests/sim/state)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const STAGES = ["stage1", "stage2", "stage3", "stage3b", "stage3c", "stage4", "stage4b", "stage5", "stage6", "stage6b", "stage7", "stage8", "stage8b", "stage9", "stage10", "exp", "report"];
const from = process.argv[2] ? STAGES.indexOf(process.argv[2]) : 0;
if (from < 0) { console.error(`unknown stage; one of: ${STAGES.join(", ")}`); process.exit(1); }
for (const s of STAGES.slice(from)) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(`./${s}.mjs`, import.meta.url))], { stdio: "inherit" });
  if (r.status !== 0) { console.error(`${s} failed`); process.exit(1); }
}
// '
