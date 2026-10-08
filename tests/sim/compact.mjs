// '
// A one-line-per-step view of the run (for a quick read): node tests/sim/compact.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STATE, hhmm } from "./lib.mjs";
import { VERDICTS } from "./verdicts.mjs";
const s = JSON.parse(readFileSync(join(STATE, "s10.json"), "utf8"));
const EN = { "זורם": "flows", "חסר": "MISSING", "מבלבל": "CONFUSING", "לא נבדק": "not simulated", "תקוע": "STUCK" };
for (const r of s.records) {
  const w = r.before?.where ? [...new Set(Object.values(r.before.where))].join(" / ") : "";
  const v = VERDICTS[r.id] || ["זורם", ""];
  console.log(`${r.n} | ${hhmm(r.at)}${r.at.startsWith("2027") ? ".2027" : ""} | ${r.proc} | ${r.role} | ${w || "-"} | ${r.taps} | ${EN[v[0]]}${v[1] ? `: ${v[1]}` : ""}`);
}
// '
