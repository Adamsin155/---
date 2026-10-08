// '
// Stage 4b, Tuesday 13.10 afternoon to Thursday 15.10.2026: the focus call (12א), the scripts (12),
// the Zoom and the approval of the client (13), the follow-up (14). Run: node tests/sim/stage4b.mjs
import { Sim, IL, fmtLog, settle } from "./lib.mjs";
import { brief, proto, clientApproves, followUp, markMine } from "./steps.mjs";

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
// 14 (protocol v8): Wednesday's follow-up. The scripts are not written yet: Irit marks the topic as stuck, and Lior is told.
await sim.until(IL(2026, 10, 14, 15, 30));
await followUp(sim, { id: "fu-wed", step: "עירית: המעקב היומי, יום ד׳: התסריטים תקועים", stuck: { topic: "scripts", note: "התסריטים עוד לא כתובים, הזום מחר" }, shot: "p14-followup-wed" });
// 12: the scripts (due at the end of Wednesday). Lior marks them on Wednesday 16:00, as in the first run: with no script on the scripts page.
await sim.until(IL(2026, 10, 14, 16, 0));
await proto(sim, { id: "p12", step: "ליאור: התסריטים כתובים, ממוספרים ומסודרים בעמוד התסריטים (בלי תסריט בעמוד התסריטים)", proc: "p12", role: "lior", shot: "p12-scripts",
  keys: ["p12.scripts", "p12.numbered", "p12.docs"], peek: ["irit"], next: ["irit"] });
// The scripts are put on the scripts page (seeded into the fake's client_scripts: the simulation does not drive scripts.html), and the mark is pressed again.
for (let n = 1; n <= 3; n += 1) sim.db.client_scripts = [...(sim.db.client_scripts || []), { client_id: cid, round: 1, n, content: `תסריט ${n}`, version: 1, updated_at: sim.iso(), updated_by: "lior@astrateg.test" }];
sim.nudges.push({ at: sim.iso(), what: "3 תסריטים הוכנסו ישירות לטבלת התסריטים של המשרד המדומה (עמוד התסריטים לא הופעל בסימולציה), כדי שהסימון ״התסריטים מסודרים״ יתקבל" });
await proto(sim, { id: "p12-docs", step: "ליאור: ״התסריטים מסודרים בעמוד התסריטים״, אחרי שיש שם תסריטים", proc: "p12", role: "lior", wait: 5, keys: ["p12.docs"], peek: [], next: ["irit"] });
// The exception Irit opened from the follow-up: Lior closes it on his list.
{
  const t = sim.db.client_tasks.find((x) => x.source === "escalation" && !x.done_at && /תקוע לפני יום הצילום/.test(x.title));
  if (t) await proto(sim, { id: "fu-wed-lior", step: "ליאור סוגר את החריגה ״תקוע לפני יום הצילום״ שעירית פתחה מהמעקב", proc: "p14 (חריגה)", role: "lior", wait: 3, keys: [t.id], peek: [], next: [] });
  else sim.rec({ id: "fu-wed-lior", step: "החריגה מהמעקב היומי לא נמצאה אצל ליאור", proc: "p14 (חריגה)", role: "lior", before: {}, act: "אין משימת חריגה פתוחה", taps: 0, after: {}, reminders: [] });
}
// 13: the Zoom on Thursday, and the approval of the client on the status page.
await sim.until(IL(2026, 10, 15, 11, 0));
await proto(sim, { id: "p13-zoom", step: "ליאור: שיחת Zoom מוקלטת עם הלקוחה", proc: "p13", role: "lior", shot: "p13-zoom", keys: ["p13.zoom"], peek: ["irit"], next: [] });
await clientApproves(sim, { id: "p13-approved", step: "הלקוחה מאשרת את התסריטים בדף המצב", proc: "p13", key: "p13.approved", wait: 20, next: ["lior", "irit"], shot: "status-scripts" });
// 14 (protocol v8): Thursday's follow-up, one tap.
sim.advance(30);
await followUp(sim, { id: "p14", step: "עירית: המעקב היומי לפני צילום, יום ה׳", shot: "p14-followup" });
sim.save();
await sim.stop();
// '
