// '
// Stage 3c, Monday 12.10.2026 afternoon: Ilai on his own card (the access, the pages, the Gantt, the urgent task).
// He does NOT prepare the 9 graphics (due 13:25): the deliberate delay of Ilai, watched until Tuesday morning,
// together with the shoot day Irit did not set (due Monday 18:00): the deliberate delay of Irit.
// Run: node tests/sim/stage3c.mjs
import { Sim, IL, fmtLog, settle } from "./lib.mjs";
import { brief, proto, cardsOf, shotOf, letPass, markMine, ilaiCard, followUp } from "./steps.mjs";

const sim = await Sim.start("s3c", "s3b");
const cid = sim.client().id;

{
  await sim.until(IL(2026, 10, 12, 14, 0));
  const before = await sim.mine("ilai", { shot: "ilai-char-day" });
  const { page, ctx } = await sim.open("ilai");
  let taps = 0;
  const cardBefore = await ilaiCard(page, cid);
  // The urgent task first: "התחלתי", then the work, then its pill.
  const task = sim.db.client_tasks.find((t) => t.owner === "ilai" && t.urgent);
  const startBtn = page.locator(`#mine-list .wproc[data-key$="${task.id}"] button`, { hasText: "התחלתי" });
  const hadStart = await startBtn.count();
  if (hadStart) { await startBtn.click(); taps += 1; await settle(page, 400); }
  // His card of the characterization day.
  await page.locator(`[id="il-${cid}-s"]`).click(); taps += 1;
  await page.locator(`[id="il-${cid}-gantt"]`).check(); taps += 1; await settle(page, 300);
  for (const k of ["name", "bio", "details", "phone", "address", "look"]) { await page.locator(`[id="il-${cid}-p06_${k}"]`).check(); taps += 1; await settle(page, 250); }
  await page.locator(`[id="il-${cid}-mc"]`).fill("https://app.metricool.com/evolution/web?blogId=4242"); taps += 1;
  await page.locator(`[id="il-${cid}-mc"]`).press("Enter"); taps += 1;
  await settle(page, 500);
  const cardAfter = await ilaiCard(page, cid);
  // The logins the client filled: checked in the vault, each one "תקינה".
  await page.locator(`.il-card[data-key="il:${cid}"] a[href*="#access"]`).first().click(); taps += 1;
  await page.waitForSelector("#access-list .access-row");
  await settle(page, 600);
  const rowsText = await page.locator("#access-list .access-row").allInnerTexts();
  const vault = [];
  for (const net of ["Facebook", "Instagram"]) {
    const row = page.locator("#access-list .access-row", { hasText: net }).filter({ hasText: "מהלקוח" }).first();
    if (!(await row.count())) { vault.push(`${net}: אין שורה מהלקוח`); continue; }
    const edit = row.locator("button", { hasText: /עריכה|עדכון|בדיקה/ }).first();
    if (!(await edit.count())) { vault.push(`${net}: אין כפתור עריכה (${(await row.innerText()).replace(/\s+/g, " ").slice(0, 120)})`); continue; }
    await edit.click(); taps += 1;
    await page.waitForSelector("#acc-status");
    await page.selectOption("#acc-status", "ok"); taps += 1;
    await page.click("#acc-submit"); taps += 1;
    await settle(page, 500);
    vault.push(`${net}: סומן תקינה`);
  }
  await ctx.close();
  sim.advance(25);
  // The urgent task done (TikTok opened), from "המשימות שלי".
  const res = await markMine(sim, "ilai", [task.id]);
  const rows = await sim.tick();
  const after = await sim.mine("ilai", { shot: "ilai-after-char-items" });
  sim.rec({ id: "p06-p09-ilai", step: "עילאי: משימה דחופה (TikTok), שלד גאנט (9), סידור העמוד ו־Metricool (6), בדיקת הגישות מהלקוח בכספת", proc: "p06, p09", role: "ilai",
    before: { ...brief(before), shot: before.shot, card: cardBefore },
    act: `כרטיס המשימה הדחופה: ${hadStart ? "״התחלתי״" : "(אין כפתור התחלתי)"}; הכרטיס ״יום אפיון״: פתיחה, תיבת שלד הגאנט, 6 תיבות סידור העמוד, קישור Metricool; ״לכספת״ -> ${vault.join("; ")}; המשימה הדחופה: ${JSON.stringify(res.out)}`, taps: taps + res.taps,
    after: { card: cardAfter, vaultRows: rowsText.map((s) => s.replace(/\s+/g, " ").slice(0, 140)), marks: ["p09.file", "p09.c.time", "p06.verified", "p06.name", "p06.look", "p06.metricool", "p07.made"].map((k) => `${k}=${sim.checkOf(k)?.state || "-"}`), access: sim.db.client_access.map((a) => `${a.network}:${a.status}`), task: { started_at: task.started_at, done_at: task.done_at }, ...brief(after) },
    reminders: fmtLog(rows) });
}
// Irit closes the task of the logo (the client sent it on WhatsApp).
await proto(sim, { id: "task-logo", step: "עירית סוגרת את המשימה ״להשלים מהלקוח: לוגו״", proc: "p05 (משימה)", role: "irit", shot: "task-logo", wait: 10,
  keys: [sim.db.client_tasks.find((t) => t.owner === "irit").id], peek: [], next: [] });

// 14 (protocol v8): the daily follow-up before the shoot day, Monday (the meeting ended at 11:25).
await followUp(sim, { id: "fu-mon", step: "עירית: המעקב היומי לפני צילום, יום ב׳ (היום הראשון אחרי האפיון)", shot: "p14-followup-line" });
// The night: nobody prepares the 9 graphics, nobody sets the shoot day.
await letPass(sim, IL(2026, 10, 12, 18, 5), { id: "late-mon-evening", step: "יום ב׳ עד 18:05: 9 הגרפיקות (יעד 13:25) לא הוכנו, יום הצילום (יעד 18:00) לא נקבע", proc: "p07, p11", role: "ilai", watch: ["ilai", "irit", "lior", "ofir", "owner"] });
await letPass(sim, IL(2026, 10, 13, 9, 30), { id: "late-tue-morning", step: "עד יום ג׳ 09:30: עדיין לא הוכנו גרפיקות ולא נקבע יום צילום", proc: "p07, p11", role: "irit", watch: ["ilai", "irit", "lior", "ofir", "owner"] });
sim.save();
await sim.stop();
// '
