// '
// The reminder log of a saved state: node tests/sim/log.mjs <state> [text to find] [from id]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STATE, hhmm } from "./lib.mjs";
const [state, find = "", from = "0"] = process.argv.slice(2);
const s = JSON.parse(readFileSync(join(STATE, `${state}.json`), "utf8"));
for (const r of s.db.reminder_log) {
  if (r.id < Number(from)) continue;
  const line = `#${r.id} ${hhmm(r.created_at)} (due ${r.due_at ? hhmm(r.due_at) : "-"}) ${r.rule} -> ${r.person} [${r.level}/${r.channel}/${r.status}${r.reason ? `:${r.reason}` : ""}] ${r.title} || ${String(r.body || "").replace(/\n/g, " / ")} || ${r.key}`;
  if (!find || line.includes(find)) console.log(line);
}
// '
