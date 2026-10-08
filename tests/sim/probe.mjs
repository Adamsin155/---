// '
// Finding the way while writing the scenario: what a role sees on a page, from a saved state.
//   node tests/sim/probe.mjs <state> <role|-> <path> <op>...
// ops: mine | controls | html:<sel> | text:<sel> | click:<sel> | fill:<sel>=<value> | check:<sel> | select:<sel>=<value> | wait:<ms> | plus:<minutes> | dialog (controls of the open dialog) | shot:<name>
import { Sim, scrapeControls, stamp, settle } from "./lib.mjs";
const [state, role, path = "clients.html#mine", ...ops] = process.argv.slice(2);
const sim = await Sim.start("probe", state);
const who = role === "-" ? null : role;
for (const op of ops) if (op.startsWith("plus:")) sim.advance(Number(op.slice(5)));
console.log("now:", stamp(sim.now));
const { page, ctx } = await sim.open(who, path.replace("CID", sim.client()?.id || ""));
for (const op of ops.length ? ops : ["controls"]) {
  const [name, ...restParts] = op.split(":");
  const rest = restParts.join(":");
  try {
    if (name === "mine") console.log(JSON.stringify(await page.evaluate((await import("./lib.mjs")).scrapeMine), null, 1));
    else if (name === "controls") console.log(JSON.stringify(await page.evaluate(scrapeControls), null, 1));
    else if (name === "html") console.log(await page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.outerHTML.slice(0, 6000)).join("\n---\n"), rest));
    else if (name === "text") console.log(await page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.innerText).join("\n---\n"), rest));
    else if (name === "click") { await page.locator(rest).first().click(); await settle(page, 500); }
    else if (name === "check") { await page.locator(rest).first().check(); await settle(page, 400); }
    else if (name === "fill") { const i = rest.indexOf("="); await page.locator(rest.slice(0, i)).first().fill(rest.slice(i + 1)); }
    else if (name === "select") { const i = rest.indexOf("="); await page.locator(rest.slice(0, i)).first().selectOption(rest.slice(i + 1)); }
    else if (name === "wait") await page.waitForTimeout(Number(rest));
    else if (name === "shot") await page.screenshot({ path: `${process.env.TEMP || "."}/${rest}.png`, fullPage: true });
    else if (name === "dialog") console.log(await page.evaluate(() => [...document.querySelectorAll("dialog[open]")].map((d) => `DIALOG#${d.id}\n` + [...d.querySelectorAll("h2, h3, label, input, select, textarea, button, p.hint, p.err")].filter((e) => e.getClientRects().length).map((e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${e.type ? `[${e.type}]` : ""}${e.name ? ` name=${e.name}` : ""} ${e.tagName === "SELECT" ? [...e.options].map((o) => o.value + "=" + o.text).join("|") : (e.innerText || e.value || "").replace(/\s+/g, " ").slice(0, 90)}`).join("\n")).join("\n\n")));
  } catch (e) { console.log(`op ${op} failed: ${String(e.message).split("\n")[0]}`); }
}
if (page.errors.length) console.log("page errors:", page.errors);
await ctx.close();
if (sim.unmocked.length) console.log("unanswered:", [...new Set(sim.unmocked)]);
if (process.env.SAVE) sim.save(process.env.SAVE);
await sim.stop();
// '
