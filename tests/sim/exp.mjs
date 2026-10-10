// '
// Two side experiments, each from a saved state of the main run (their records are kept apart, in exp-*.json):
//   A. the agreement was sent and the client does not sign, until its validity runs out;
//   B. Irit marks process 3 on "המשימות שלי" without entering the date of the meeting in the client card.
//   C–F (protocol v9; docs/ops.md, section 57), Ofir's fast ladder, the reminder rows minute by minute:
//      C. Ilai hands the 9 graphics over and Ofir approves in time (no lateness ring; Irit is told at once);
//      D. Ofir ignores them (a ring at 10 minutes, Lior at 15, then Ofir every 10 minutes), then approves;
//      E. the shoot day is closed and Ofir does not assign an editor (the same ladder);
//      F. the graphics are handed over at 20:55 (nothing after 21:00; the count goes on the next morning).
//      C, D and F start from the state s3c, E from s5a (node tests/sim/stage5.mjs writes it).
// Both were the two places a client was silently lost (report.md, findings 1.1, 1.2, 3.1). Since the fix
// (docs/ops.md, section 47) the experiments show them caught: the screenshots end in "-fixed".
// Run: node tests/sim/exp.mjs   (needs the states s1a and s1: node tests/sim/stage1.mjs first)
import { join } from "node:path";
import { Sim, IL, OUT, fmtLog, settle, emailOf } from "./lib.mjs";
import { brief, markMine, letPass } from "./steps.mjs";

const shoot = async (page, name) => {
  const height = Math.min(2000, await page.evaluate(() => document.documentElement.scrollHeight));
  await page.screenshot({ path: join(OUT, name), fullPage: true, clip: { x: 0, y: 0, width: 390, height } }).catch(async () => { await page.screenshot({ path: join(OUT, name) }); });
  return name;
};

// One experiment alone: node tests/sim/exp.mjs exp-d
const only = process.argv[2] || "";
// A.
if (!only || only === "exp-a") {
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
if (!only || only === "exp-b") {
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

// ── Protocol v9: Ofir's fast ladder ──
const markAs = (sim, role, keys, note = null) => { for (const k of [].concat(keys)) sim.db.protocol_checks.push({ client_id: sim.client().id, item_key: k, state: "done", note, by_email: emailOf(role), at: sim.iso() }); };
const P07 = ["spelling", "phone", "address", "logo", "details", "wording", "design"].map((k) => `p07.r.${k}`);
// The rows that are about the check or the assignment (and whatever any other ladder says of them).
const about = (r) => r.rule === "fast" || r.rule === "graphics9" || (r.rule === "clientLink" && /סטטוס/.test(r.title))
  || (["late", "lateOwn", "lateNag", "qaReturn", "editing", "digest"].includes(r.rule) && /גרפיקות| 7 · |22א|עורך|בעריכה/.test(`${r.title} ${r.body || ""}`));
const rowsOf = (sim, from) => fmtLog(sim.db.reminder_log.slice(from).filter(about));
async function experiment(name, from, run) {
  if (only && only !== name) return;
  const sim = await Sim.start(name, from);
  sim.records = [];
  const before = sim.db.reminder_log.length;
  const what = await run(sim);
  const rows = rowsOf(sim, before);
  sim.rec({ ...what, before: {}, taps: 0, after: { mine: { ofir: brief(await sim.mine("ofir", { shot: name })), irit: brief(await sim.mine("irit")), lior: brief(await sim.mine("lior")) } }, reminders: rows });
  console.log(`
--- ${name}: ${what.step}`);
  for (const r of rows) console.log(`    ${r}`);
  sim.save(name);
  await sim.stop();
}
// C. Approved in time.
await experiment("exp-c", "s3c", async (sim) => {
  await sim.until(IL(2026, 10, 13, 9, 45));
  markAs(sim, "ilai", "p07.made");
  await sim.until(IL(2026, 10, 13, 9, 52));
  markAs(sim, "ofir", [...P07, "p07.ofir"]);
  await sim.until(IL(2026, 10, 13, 10, 30), { step: 1 });
  return { id: "fast-review-in-time", step: "ניסוי ג: עילאי מסר את 9 הגרפיקות ב־09:45, אופיר אישר ב־09:52", proc: "p07", role: "ofir", act: "עילאי: מוכן לבדיקה. אופיר: 7 בדיקות ואישור אחרי 7 דקות" };
});
// D. Ignored for an hour, then approved.
await experiment("exp-d", "s3c", async (sim) => {
  await sim.until(IL(2026, 10, 13, 9, 45));
  markAs(sim, "ilai", "p07.made");
  await sim.until(IL(2026, 10, 13, 10, 46), { step: 1 });
  markAs(sim, "ofir", [...P07, "p07.ofir"]);
  await sim.until(IL(2026, 10, 13, 11, 10), { step: 1 });
  return { id: "fast-review-ignored", step: "ניסוי ד: עילאי מסר ב־09:45, אופיר לא נגע שעה ואישר ב־10:46", proc: "p07", role: "ofir", act: "אף אחד לא עושה כלום שעה; אז אופיר מאשר" };
});
// E. The assignment, ignored.
await experiment("exp-e", "s5a", async (sim) => {
  const closed = new Date(sim.checkOf("p19.took").at);
  await sim.until(new Date(closed.getTime() + 52 * 6e4), { step: 1 });
  return { id: "fast-assign-ignored", step: `ניסוי ה: יום הצילום נסגר ב־${closed.toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })}, ואופיר לא משייך עורך 50 דקות`, proc: "p22a", role: "ofir", act: "אף אחד לא עושה כלום" };
});
// F. Handed over at 20:55.
await experiment("exp-f", "s3c", async (sim) => {
  await sim.until(IL(2026, 10, 13, 20, 55), { step: 1 });
  markAs(sim, "ilai", "p07.made");
  await sim.until(IL(2026, 10, 14, 9, 5), { step: 1 });
  return { id: "fast-review-2055", step: "ניסוי ו: עילאי מסר את 9 הגרפיקות ביום ג׳ ב־20:55, ואף אחד לא נגע עד למחרת 09:05", proc: "p07", role: "ofir", act: "אף אחד לא עושה כלום" };
});
// '
