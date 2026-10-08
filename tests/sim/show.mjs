// '
// Prints the records of a saved state: node tests/sim/show.mjs <state> [from record n]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STATE, stamp } from "./lib.mjs";
const [state, from = "1", mode = "full", width = "600"] = process.argv.slice(2);
const W = Number(width);
const clip = (v) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > W ? `${s.slice(0, W)}…` : s; };
const s = JSON.parse(readFileSync(join(STATE, `${state}.json`), "utf8"));
for (const r of s.records.filter((x) => x.n >= Number(from))) {
  console.log(`\n===== #${r.n} [${r.id}] ${stamp(r.at)} · ${r.proc} · ${r.role} · ${r.step}`);
  if (mode === "short") {
    if (r.before?.where) console.log("   where:", clip(r.before.where));
    if (r.before?.peek && Object.keys(r.before.peek).length) console.log("   peek:", clip(r.before.peek));
    if (r.before?.remindersSinceLast?.length) console.log("   since:", clip(r.before.remindersSinceLast));
    console.log("   act:", clip(r.act), "| taps", r.taps);
    const { next, mine, cards, top, lines, landed, empty, ...rest } = r.after || {};
    if (Object.keys(rest).length) console.log("   after:", clip(rest));
    if (cards) console.log("   mine after:", clip(cards));
    if (next) for (const [who, b] of Object.entries(next)) console.log(`   next ${who}:`, clip([...(b.top || []), ...(b.lines || []), ...(b.cards || [])]));
    if (mine) for (const [who, b] of Object.entries(mine)) console.log(`   mine ${who}:`, clip([...(b.top || []), ...(b.lines || []), ...(b.cards || [])]));
    console.log("   reminders:", JSON.stringify(r.reminders, null, 1));
    if (r.errors) console.log("   ERRORS:", r.errors);
    continue;
  }
  for (const k of ["before", "act", "taps", "after", "reminders", "note"]) if (r[k] !== undefined) console.log(`-- ${k}:`, typeof r[k] === "string" ? r[k] : JSON.stringify(r[k], null, 1));
}
if (s.nudges?.length) console.log("\nNUDGES:", JSON.stringify(s.nudges, null, 1));
// '
