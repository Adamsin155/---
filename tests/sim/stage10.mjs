// '
// Stage 10, the renewal window (34): the contract ends on 11.10.2027, so the renewal starts 60 days before,
// on 12.8.2027. The clock jumps from the end of November 2026 to 10.8.2027 with no tick in between (said in
// the report). Lior lets the day pass, then does it. Run: node tests/sim/stage10.mjs
import { Sim, IL, fmtLog, settle } from "./lib.mjs";
import { brief, proto, letPass, shotOf } from "./steps.mjs";

const sim = await Sim.start("s10", "s9");
const cid = sim.client().id;
const clip = (s, n = 500) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
sim.jump(IL(2027, 8, 10, 8, 0), "מסוף נובמבר 2026 עד 10.8.2027 לא הורצו תזכורות; חלון החידוש נבדק מכאן");

// Two days before the window opens: what does anyone see?
{
  await sim.until(IL(2027, 8, 10, 10, 0), { step: 5 });
  const mine = {};
  for (const r of ["lior", "irit", "owner"]) mine[r] = brief(await sim.mine(r));
  const y = await sim.open("lior", "year.html");
  await settle(y.page, 800);
  const year = clip(await y.page.evaluate(() => document.querySelector("main")?.innerText || ""), 900);
  const shot = await shotOf(sim, y.page, "lior", "year-page");
  await y.ctx.close();
  sim.rec({ id: "renewal-before", step: "10.8.2027, יומיים לפני חלון החידוש: מה רואים", proc: "p34", role: "lior", before: {}, act: "צפייה בלבד (המשימות שלי, שנת החבילה)", taps: 0, after: { year, shot, mine }, reminders: fmtLog(sim.db.reminder_log.filter((r) => r.created_at >= "2027-08-09" && /renewal|ending|year|month/.test(r.rule))) });
}
// The window opens on Thursday 12.8.2027. Lior does nothing until Monday 16.8.
await letPass(sim, IL(2027, 8, 12, 12, 0), { id: "renewal-opens", step: "12.8.2027 12:00: 60 יום לפני סיום החוזה, החידוש נפתח", proc: "p34", role: "lior", watch: ["lior", "irit", "owner"] });
await letPass(sim, IL(2027, 8, 16, 10, 0), { id: "renewal-late", step: "עד יום ב׳ 16.8.2027: ליאור לא התחיל בחידוש", proc: "p34", role: "lior", watch: ["lior", "irit", "ofir", "owner"] });
// 34: Lior does the renewal checks.
await proto(sim, { id: "p34", step: "ליאור: חידוש חוזה (מצב ותוצאות, שביעות רצון, בעיות, שיחה על המשך, טיפול בנושאים)", proc: "p34", role: "lior", shot: "p34-renewal",
  keys: ["p34.state", "p34.satisfaction", "p34.problems", "p34.talk", "p34.issues"], peek: ["irit", "ofir"], next: ["lior", "irit", "owner"] });
// What is left open at the very end: who still has anything of this client.
{
  const mine = {};
  for (const r of ["irit", "lior", "ofir", "ilai", "nadia", "eli", "owner"]) mine[r] = brief(await sim.mine(r));
  const y = await sim.open("lior", "year.html");
  await settle(y.page, 800);
  const year = clip(await y.page.evaluate(() => document.querySelector("main")?.innerText || ""), 700);
  await y.ctx.close();
  sim.rec({ id: "end", step: "סוף התרחיש (16.8.2027): מה נשאר פתוח אצל כל אחד", proc: "p34→p35", role: "כולם", before: {}, act: "צפייה בלבד", taps: 0, after: { year, status: sim.client().status, contract_end: sim.client().contract_end, mine }, reminders: [] });
}
sim.save();
await sim.stop();
// '
