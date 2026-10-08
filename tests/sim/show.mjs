// '
// Prints the records of a saved state: node tests/sim/show.mjs <state> [from record n]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STATE, stamp } from "./lib.mjs";
const [state, from = "1"] = process.argv.slice(2);
const s = JSON.parse(readFileSync(join(STATE, `${state}.json`), "utf8"));
for (const r of s.records.filter((x) => x.n >= Number(from))) {
  console.log(`\n===== #${r.n} [${r.id}] ${stamp(r.at)} · ${r.proc} · ${r.role} · ${r.step}`);
  for (const k of ["before", "act", "taps", "after", "reminders", "note"]) if (r[k] !== undefined) console.log(`-- ${k}:`, typeof r[k] === "string" ? r[k] : JSON.stringify(r[k], null, 1));
}
if (s.nudges?.length) console.log("\nNUDGES:", JSON.stringify(s.nudges, null, 1));
// '
