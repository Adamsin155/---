// '
// Two side experiments, each from a saved state of the main run (their records are kept apart, in exp-*.json):
//   A. the agreement was sent and the client does not sign for a business day and a half;
//   B. Irit marks process 3 on "המשימות שלי" without entering the date of the meeting in the client card.
// Run: node tests/sim/exp.mjs
import { Sim, IL, fmtLog } from "./lib.mjs";
import { brief, markMine, letPass } from "./steps.mjs";

// A.
{
  const sim = await Sim.start("exp-a", "s1a");
  sim.records = [];
  const before = sim.db.reminder_log.length;
  await letPass(sim, IL(2026, 10, 11, 18, 5), { id: "unsigned-day", step: "ניסוי א: החוזה נשלח ב־09:11 והלקוחה לא חותמת; סוף אותו יום", proc: "p01", role: "irit", watch: ["irit", "lior", "owner", "stav"] });
  await letPass(sim, IL(2026, 10, 12, 16, 0), { id: "unsigned-next", step: "ניסוי א: למחרת 16:00, עדיין לא נחתם", proc: "p01", role: "irit", watch: ["irit", "lior", "owner", "stav"] });
  const { page, ctx } = await sim.open("irit", "quotes.html");
  const quotes = (await page.evaluate(() => document.querySelector("main")?.innerText || "")).replace(/\s+/g, " ").slice(0, 500);
  await ctx.close();
  sim.rec({ id: "unsigned-where", step: "ניסוי א: איפה בכל זאת רואים את החוזה שלא נחתם", proc: "p01", role: "irit", before: {}, act: "צפייה בעמוד ההצעות וההסכמים (quotes.html)", taps: 0,
    after: { quotes, clients: sim.db.clients.length, deal: sim.db.deal_requests[0].status, contractRule: sim.db.reminder_log.slice(before).filter((r) => r.rule === "contract").length }, reminders: fmtLog(sim.db.reminder_log.slice(before)) });
  sim.save("exp-a");
  await sim.stop();
}
// B.
{
  const sim = await Sim.start("exp-b", "s1");
  sim.records = [];
  sim.advance(2);
  await sim.tick();
  const res = await markMine(sim, "irit", ["p02.opened", "p02.m.lior", "p02.m.irit", "p02.m.ofir", "p02.m.ilai", "p02.m.client", "p02.intro", "p03.who", "p03.available", "p03.calendar"]);
  sim.advance(3);
  const rows = await sim.tick();
  const irit = brief(await sim.mine("irit", { shot: "exp-p03-no-date" }));
  sim.rec({ id: "p03-no-date", step: "ניסוי ב: עירית מסמנת את כל מה שמופיע בתהליך 3 בלי להזין מועד אפיון", proc: "p03", role: "irit", before: {}, act: `הגלולות במשימות שלי: ${JSON.stringify(res.out)}`, taps: res.taps,
    after: { char_at: sim.client().char_at, characterizer: sim.client().characterizer, mine: { irit, ofir: brief(await sim.mine("ofir")), lior: brief(await sim.mine("lior")) } }, reminders: fmtLog(rows) });
  await letPass(sim, IL(2026, 10, 13, 12, 0), { id: "p03-no-date-2days", step: "ניסוי ב: יומיים אחר כך, עדיין אין מועד אפיון", proc: "p03→p04", role: "irit", watch: ["irit", "ofir", "lior", "owner"] });
  sim.save("exp-b");
  await sim.stop();
}
// '
