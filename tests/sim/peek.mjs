// '
// The short form of "המשימות שלי" of several roles, from a saved state: node tests/sim/peek.mjs <state> <plus minutes> <role>...
import { Sim, stamp } from "./lib.mjs";
import { brief } from "./steps.mjs";
const [state, plus = "0", ...roles] = process.argv.slice(2);
const sim = await Sim.start("peek", state);
sim.advance(Number(plus));
console.log("now:", stamp(sim.now));
const c = sim.client();
console.log("client:", JSON.stringify({ editor: c.editor, shoot_at: c.shoot_at, links: c.links, status: c.status }));
console.log("checks p22+:", sim.db.protocol_checks.filter((x) => /^p2[2-9]|^p3/.test(x.item_key)).map((x) => `${x.item_key}=${x.state}${x.note ? `(${String(x.note).slice(0, 60)})` : ""}`).join(", "));
console.log("tasks:", sim.db.client_tasks.map((t) => `${t.owner}: ${t.title} ${t.done_at ? "[done]" : ""}`).join(" | "));
for (const r of roles) {
  const b = brief(await sim.mine(r));
  console.log(`\n--- ${r} (${b.landed})`);
  for (const x of [...b.top, ...b.lines, ...b.cards]) console.log("  ", x.slice(0, 520));
  if (b.empty) console.log("  ריק:", b.empty);
  if (b.other) console.log("  ", b.other);
}
await sim.stop();
// '
