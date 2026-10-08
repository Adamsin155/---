// '
// Stage 4b, Tuesday 13.10 afternoon to Thursday 15.10.2026: the focus call (12א), the scripts (12),
// the Zoom and the approval of the client (13), the follow-up (14). Run: node tests/sim/stage4b.mjs
import { Sim, IL, fmtLog, settle } from "./lib.mjs";
import { brief, proto, clientApproves } from "./steps.mjs";

const sim = await Sim.start("s4b", "s4");
const cid = sim.client().id;

// 12א: the focus call of Lior, in its form.
{
  await sim.until(IL(2026, 10, 13, 14, 0));
  const before = await sim.mine("lior", { shot: "p12a-focus-call" });
  const { page, ctx } = await sim.open("lior");
  let taps = 0;
  const go = page.locator(`#mine-list .wproc[data-key="${cid}:p12a"] a.ik-go`).first();
  const goText = (await go.innerText()).trim();
  await go.click(); taps += 1;
  await page.waitForSelector("#focus-form");
  const fill = { messages: "אפייה במקום כל בוקר, משפחה אחת 30 שנה", dont: "לא להזכיר את הסניף שנסגר, לא לצלם את המתכונים", services: "מגשי אירוח והזמנות לשישי", products: "לחם מחמצת, רוגלך, עוגת שמרים", offers: "מגש מאפים 120 שקלים",
    faq: "האם יש ללא גלוטן, עד מתי מזמינים לשישי", topics: "מאחורי הקלעים של הלילה במאפייה", objections: "יקר יותר מהסופר", advantages: "טרי מהבוקר", focus: "הזמנות לאירועים" };
  for (const [k, v] of Object.entries(fill)) { if (await page.locator(`#focus-${k}`).count()) { await page.fill(`#focus-${k}`, v); taps += 1; } }
  await page.check("#focus-read"); taps += 1;
  await page.click("#focus-done"); taps += 1;
  await settle(page, 800);
  await ctx.close();
  const rows = await sim.tick();
  const after = await sim.mine("lior");
  sim.rec({ id: "p12a", step: "ליאור: שיחת דגשים עם הלקוחה, בטופס שלה", proc: "p12a", role: "lior", before: { ...brief(before), shot: before.shot },
    act: `כרטיס 12א -> "${goText}" -> 10 הנושאים, קראתי את האפיון, סיום השיחה`, taps,
    after: { marks: ["p12a.read", "p12a.call", "p12a.t.messages", "p12a.t.faq"].map((k) => `${k}=${sim.checkOf(k)?.state || "-"}`), ...brief(after) }, reminders: fmtLog(rows) });
}
// 12: the scripts (due at the end of Wednesday). Lior marks them on Wednesday 16:00.
await sim.until(IL(2026, 10, 14, 16, 0));
await proto(sim, { id: "p12", step: "ליאור: התסריטים כתובים, ממוספרים ומסודרים בעמוד התסריטים", proc: "p12", role: "lior", shot: "p12-scripts",
  keys: ["p12.scripts", "p12.numbered", "p12.docs"], peek: ["irit"], next: ["irit"] });
// 13: the Zoom on Thursday, and the approval of the client on the status page.
await sim.until(IL(2026, 10, 15, 11, 0));
await proto(sim, { id: "p13-zoom", step: "ליאור: שיחת Zoom מוקלטת עם הלקוחה", proc: "p13", role: "lior", shot: "p13-zoom", keys: ["p13.zoom"], peek: ["irit"], next: [] });
await clientApproves(sim, { id: "p13-approved", step: "הלקוחה מאשרת את התסריטים בדף המצב", proc: "p13", key: "p13.approved", wait: 20, next: ["lior", "irit"], shot: "status-scripts" });
// 14: the daily follow-up of Irit until the shoot day (once, Thursday).
await proto(sim, { id: "p14", step: "עירית: Follow-up עד יום הצילום (8 נושאים)", proc: "p14", role: "irit", shot: "p14-followup", wait: 30,
  keys: ["p14.approvals", "p14.scripts", "p14.graphics", "p14.access", "p14.shootday", "p14.team", "p14.missing", "p14.delays"], peek: ["lior"], next: [] });
sim.save();
await sim.stop();
// '
