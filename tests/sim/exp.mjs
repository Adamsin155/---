// '
// Two side experiments, each from a saved state of the main run (their records are kept apart, in exp-*.json):
//   A. the agreement was sent and the client does not sign, until its validity runs out;
//   B. Irit marks process 3 on "המשימות שלי" without entering the date of the meeting in the client card.
// Both were the two places a client was silently lost (report.md, findings 1.1, 1.2, 3.1). Since the fix
// (docs/ops.md, section 47) the experiments show them caught: the screenshots end in "-fixed".
// Run: node tests/sim/exp.mjs   (needs the states s1a and s1: node tests/sim/stage1.mjs first)
import { join } from "node:path";
import { Sim, IL, OUT, fmtLog, settle } from "./lib.mjs";
import { brief, markMine, letPass } from "./steps.mjs";

const shoot = async (page, name) => {
  const height = Math.min(2000, await page.evaluate(() => document.documentElement.scrollHeight));
  await page.screenshot({ path: join(OUT, name), fullPage: true, clip: { x: 0, y: 0, width: 390, height } }).catch(async () => { await page.screenshot({ path: join(OUT, name) }); });
  return name;
};

// A.
{
  const sim = await Sim.start("exp-a", "s1a");
  sim.records = [];
  const before = sim.db.reminder_log.length;
  const watch = ["irit", "lior", "owner", "stav"];
  await letPass(sim, IL(2026, 10, 11, 18, 5), { id: "unsigned-day-fixed", step: "ניסוי א: החוזה נשלח ב־09:11 והלקוחה לא חותמת; סוף אותו יום", proc: "p01", role: "irit", watch });
  await letPass(sim, IL(2026, 10, 12, 16, 0), { id: "unsigned-next-fixed", step: "ניסוי א: למחרת 16:00, עדיין לא נחתם", proc: "p01", role: "irit", watch });
  // The line of "המשימות שלי" leads to the list of sent quotes, on the ones that wait.
  {
    const { page, ctx } = await sim.open("irit");
    const href = await page.locator("#flow-unsigned").getAttribute("href");
    const line = (await page.locator("#flow-unsigned").innerText()).replace(/\s+/g, " ").trim();
    await page.locator("#flow-unsigned").click();
    await page.waitForSelector("#rows tr");
    await settle(page);
    const chip = (await page.locator("#filters .chip[aria-pressed=true]").innerText()).replace(/\s+/g, " ").trim();
    const rows = await page.locator("#rows tr").count();
    const acts = (await page.locator("#rows tr .acts").first().innerText()).replace(/\s+/g, " ").trim();
    const shot = await shoot(page, "05-irit-unsigned-quotes-list-fixed.png");
    await ctx.close();
    sim.rec({ id: "unsigned-where", step: "ניסוי א: מהשורה ב״המשימות שלי״ אל ההסכם שמחכה", proc: "p01", role: "irit", before: { line, href }, act: "לחיצה על השורה", taps: 1,
      after: { chip, rows, acts, shot, clients: sim.db.clients.length, deal: sim.db.deal_requests[0].status }, reminders: [] });
  }
  await letPass(sim, IL(2026, 10, 13, 12, 0), { id: "unsigned-day3-fixed", step: "ניסוי א: יום שלישי 12:00, עדיין לא נחתם", proc: "p01", role: "irit", watch: ["irit", "lior"] });
  await letPass(sim, IL(2026, 10, 14, 10, 0), { id: "unsigned-expired-fixed", step: "ניסוי א: יום רביעי 10:00, תוקף ההסכם (72 שעות) עבר בלי חתימה", proc: "p01", role: "irit", watch: ["irit", "lior"] });
  sim.rec({ id: "unsigned-rows", step: "ניסוי א: כל שורות התזכורת של הכלל unsigned", proc: "p01", role: "irit", before: {}, act: "-", taps: 0, after: {}, reminders: fmtLog(sim.db.reminder_log.slice(before).filter((r) => r.rule === "unsigned")) });
  sim.save("exp-a");
  await sim.stop();
}
// B.
{
  const sim = await Sim.start("exp-b", "s1");
  sim.records = [];
  const before = sim.db.reminder_log.length;
  sim.advance(2);
  await sim.tick();
  const res = await markMine(sim, "irit", ["p02.opened", "p02.m.lior", "p02.m.irit", "p02.m.ofir", "p02.m.ilai", "p02.m.client", "p02.intro", "p03.who", "p03.available", "p03.calendar"]);
  sim.advance(3);
  const rows = await sim.tick();
  const irit = brief(await sim.mine("irit", { shot: "exp-p03-no-date-fixed" }));
  sim.rec({ id: "p03-no-date", step: "ניסוי ב: עירית מסמנת את כל מה שמופיע בתהליך 3 בלי להזין מועד אפיון", proc: "p03", role: "irit", before: {}, act: `הגלולות במשימות שלי: ${JSON.stringify(res.out)}`, taps: res.taps,
    after: { char_at: sim.client().char_at, characterizer: sim.client().characterizer, mine: { irit, ofir: brief(await sim.mine("ofir")), lior: brief(await sim.mine("lior")) } }, reminders: fmtLog(rows) });
  await letPass(sim, IL(2026, 10, 13, 12, 0), { id: "p03-no-date-2days-fixed", step: "ניסוי ב: יומיים אחר כך, עדיין אין מועד אפיון", proc: "p03→p04", role: "irit", watch: ["irit", "ofir", "lior", "owner"] });
  // Irit sets the date right on the card: the button, the date, save.
  {
    const { page, ctx } = await sim.open("irit");
    const cid = sim.client().id;
    const card = page.locator(`#mine-list .wproc[data-key="${cid}:p03"]`);
    const need = (await card.locator(".wneed").innerText()).replace(/\s+/g, " ").trim();
    await card.locator(".wneed button").click();
    await page.waitForSelector("#dlg-meet[open]");
    const dialog = await shoot(page, "06-irit-exp-p03-set-date-dialog-fixed.png");
    await page.fill("#meet-at", "2026-10-14T10:00");
    await page.click("#meet-submit");
    await page.waitForSelector("#dlg-meet:not([open])", { state: "attached" });
    await settle(page);
    const left = await card.count();
    const shot = await shoot(page, "07-irit-exp-p03-date-set-fixed.png");
    await ctx.close();
    sim.advance(1);
    const after = await sim.tick();
    sim.rec({ id: "p03-set-date", step: "ניסוי ב: עירית קובעת את המועד מהכרטיס ב״המשימות שלי״", proc: "p03", role: "irit", before: { need, dialog }, act: "״קביעת מועד״ -> תאריך ושעה -> ״שמירת המועד״", taps: 3,
      after: { char_at: sim.client().char_at, characterizer: sim.client().characterizer, scheduled: sim.done("p03.scheduled"), p03CardLeft: left, shot, ofir: brief(await sim.mine("ofir")) }, reminders: fmtLog(after) });
  }
  await letPass(sim, IL(2026, 10, 14, 9, 0), { id: "p03-after-date-fixed", step: "ניסוי ב: למחרת בבוקר, אחרי שנקבע המועד", proc: "p03→p04", role: "ofir", watch: ["irit", "ofir"] });
  sim.rec({ id: "p03-rows", step: "ניסוי ב: כל שורות התזכורת על המועד החסר (deal, meetingDate, late על תהליך 3)", proc: "p03", role: "irit", before: {}, act: "-", taps: 0, after: {},
    reminders: fmtLog(sim.db.reminder_log.slice(before).filter((r) => r.rule === "meetingDate" || (r.rule === "deal") || (r.rule === "late" && / 3 · /.test(r.title)))) });
  sim.save("exp-b");
  await sim.stop();
}
// '
