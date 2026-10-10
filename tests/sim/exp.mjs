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
import { Sim, IL, OUT, fmtLog, settle, emailOf, hhmm as hhmmOf } from "./lib.mjs";
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
const rowsOf = (sim, from, keep = about) => fmtLog(sim.db.reminder_log.slice(from).filter(keep));
async function experiment(name, from, run, keep = about) {
  if (only && only !== name) return;
  const sim = await Sim.start(name, from);
  sim.records = [];
  const before = sim.db.reminder_log.length;
  const what = await run(sim);
  const rows = rowsOf(sim, before, keep);
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
// ── Protocol v10 (docs/ops.md, section 58) ──
//   G. the client asks for a fix over WhatsApp: Irit's button on "המשימות שלי" opens the task for Ilai;
//   H. the client does not answer for three working days: Irit's line and ring, day by day;
//   I. Ofir is in a characterization meeting when the graphics arrive: nothing is late until it ends, and ten minutes;
//   J. the renewal opens (60 days before the end) and its 14 days pass;
//   K. the contract ends and the client is still "active": Lior's ring, and his two actions.
// G, H and I start from the state s3c (before the 9 graphics), J from s9, K from s10.
// The first graphics made, checked by Ofir and sent to the client by Irit, on Tuesday 13.10 at 09:56 (as marks: the screens of these steps are the main run's).
async function graphicsSent(sim) {
  await sim.until(IL(2026, 10, 13, 9, 45));
  markAs(sim, "ilai", "p07.made");
  await sim.until(IL(2026, 10, 13, 9, 52));
  markAs(sim, "ofir", [...P07, "p07.ofir"]);
  await sim.until(IL(2026, 10, 13, 9, 56));
  markAs(sim, "irit", ["p07.sent", "p07a.sent"]);
}
const fixRows = (r) => ["clientFix", "clientFixes", "answer", "clientWaits", "clientWaitsLine"].includes(r.rule)
  || (["late", "lateOwn", "lateNag"].includes(r.rule) && /תיקון לבקשת הלקוח| 7 · /.test(`${r.title} ${r.body || ""}`));
// G. A fix asked for over WhatsApp, written down by Irit at 14:10 (after 13:00: due the next working day).
await experiment("exp-g", "s3c", async (sim) => {
  await graphicsSent(sim);
  await sim.until(IL(2026, 10, 13, 14, 10), { step: 1 });
  const cid = sim.client().id;
  const { page, ctx } = await sim.open("irit");
  const card = page.locator(`#mine-list .wproc[data-key="${cid}:p07"]`);
  const before = (await card.innerText()).replace(/\s+/g, " ").trim();
  await card.locator(".fix-ask").click();
  await page.waitForSelector("#dlg-fix[open]");
  await page.fill("#fix-note", "להחליף את הטלפון בגרפיקה 4, ולהגדיל את הלוגו");
  await shoot(page, "exp-g-irit-fix-dialog.png");
  await page.click("#fix-submit");
  await page.waitForSelector("#dlg-fix:not([open])", { state: "attached" });
  await settle(page, 700);
  const after = (await card.innerText()).replace(/\s+/g, " ").trim();
  await shoot(page, "exp-g-irit-after.png");
  await ctx.close();
  const t = sim.db.client_tasks.find((x) => x.source === "client_fix");
  console.log(`    עירית, הכרטיס לפני: ${before}`);
  console.log(`    עירית, הכרטיס אחרי: ${after}`);
  console.log(`    המשימה: ${t.owner} · ${t.title} · עד ${t.due_on} · from=${t.brief.from} by=${t.brief.by}`);
  // Nobody fixes: Wednesday passes, and on Thursday morning the task is late.
  await sim.until(IL(2026, 10, 15, 9, 20), { step: 1 });
  return { id: "fix-by-whatsapp", step: `ניסוי ז: הלקוחה ביקשה תיקון בוואטסאפ; עירית רשמה ב־14:10 (״הלקוח ביקש תיקון״). המשימה: ${t.owner}, עד ${t.due_on}. הכרטיס שלה אחרי: ${after}`, proc: "p07", role: "irit", act: "עירית: ״הלקוח ביקש תיקון״ -> מה הלקוח ביקש -> ״פתיחת משימת תיקון״ (3 לחיצות)" };
}, fixRows);
// H. The client does not answer: Wednesday, Thursday, Sunday.
await experiment("exp-h", "s3c", async (sim) => {
  await graphicsSent(sim);
  await sim.until(IL(2026, 10, 18, 12, 0), { step: 1 });
  return { id: "client-no-answer", step: "ניסוי ח: 9 הגרפיקות נשלחו ביום ג׳ 13.10 ב־09:56, והלקוחה לא עונה עד יום א׳ 18.10", proc: "p07", role: "irit", act: "אף אחד לא עושה כלום" };
}, fixRows);
// I. Ofir is in a characterization meeting (another client, 09:30) when Ilai hands the graphics over at 09:45; he presses "האפיון הסתיים" at 10:30.
await experiment("exp-i", "s3c", async (sim) => {
  await sim.until(IL(2026, 10, 13, 9, 40));
  const first = sim.client();
  const other = { ...first, id: "c0000000-0000-4000-8000-0000000000aa", name: "נועה שדה", business: "שדה פילאטיס", char_at: IL(2026, 10, 13, 9, 30).toISOString(), characterizer: "ofir", shoot_at: null, quote_id: null, deal_at: IL(2026, 10, 12, 9, 0).toISOString(), created_at: IL(2026, 10, 12, 9, 0).toISOString() };
  sim.nudge("לקוח שני נוסף לנתונים (אין בתרחיש לקוח אחר): אופיר מאפיין אותו היום מ־09:30", (db) => {
    db.clients.push(other);
    for (const p of ["p01.prepared", "p01.sent", "p01.signed", "p02.opened", "p02.m.lior", "p02.m.irit", "p02.m.ofir", "p02.m.ilai", "p02.m.client", "p02.intro", "p02.deal", "p02.team", "p03.who", "p03.available", "p03.scheduled", "p03.calendar", "p11.influencers", "p11.ok.client", "p11.ok.influencers", "p11.ok.lior", "p11.ok.photographer", "p11.calendar"]) db.protocol_checks.push({ client_id: other.id, item_key: p, state: "done", note: "ייבוא", by_email: "system", at: IL(2026, 10, 12, 9, 5).toISOString() });
  });
  await sim.until(IL(2026, 10, 13, 9, 45));
  markAs(sim, "ilai", "p07.made");
  await sim.until(IL(2026, 10, 13, 10, 0), { step: 1 });
  const during = brief(await sim.mine("ofir", { shot: "exp-i-ofir-in-meeting" }));
  console.log(`    אופיר ב־10:00 (בפגישה): ${JSON.stringify(during.top)} | ${(during.cards || []).filter((c) => / 7 · /.test(c)).join(" ;; ")}`);
  await sim.until(IL(2026, 10, 13, 10, 30), { step: 1 });
  sim.db.protocol_checks.push({ client_id: other.id, item_key: "p04.ended", state: "done", note: null, by_email: emailOf("ofir"), at: sim.iso() });
  await sim.until(IL(2026, 10, 13, 11, 0), { step: 1 });
  return { id: "fast-in-meeting", step: `ניסוי ט: עילאי מסר ב־09:45 כשאופיר בפגישת אפיון (09:30); אופיר סימן ״האפיון הסתיים״ ב־10:30 ולא נגע בגרפיקות. ב־10:00 אצל אופיר: ${(during.cards || []).filter((c) => / 7 · /.test(c)).join(" ;; ")}`, proc: "p07", role: "ofir", act: "אף אחד לא עושה כלום" };
}, (r) => r.rule === "fast" || (["late", "lateOwn", "lateNag"].includes(r.rule) && /גרפיקות| 7 · /.test(`${r.title} ${r.body || ""}`)));
// J. The renewal: it opens on Thursday 12.8.2027 (60 days before the end, 11.10.2027) and is due 14 days later.
const renewalRows = (r) => ["renewal", "renewalList", "contractEnd", "ending"].includes(r.rule) || (["late", "lateOwn", "lateNag"].includes(r.rule) && /34 · |35 · |חידוש/.test(`${r.title} ${r.body || ""}`));
await experiment("exp-j", "s9", async (sim) => {
  sim.jump(IL(2027, 8, 12, 8, 0), "מסוף נובמבר 2026 עד 12.8.2027 לא הורצו תזכורות; חלון החידוש נבדק מכאן");
  await sim.until(IL(2027, 8, 12, 12, 5), { step: 5 });
  const s = sim.state().states.find((x) => x.proc.id === "p34");
  console.log(`    תהליך 34: נפתח ${hhmmOf(s.startAt)}, יעד ${hhmmOf(s.dueAt)}, סטטוס ${s.status}`);
  await sim.until(IL(2027, 8, 26, 12, 0), { step: 5 });
  const mid = sim.state().states.find((x) => x.proc.id === "p34").status;
  await sim.until(IL(2027, 8, 29, 14, 5), { step: 5 });
  const end = sim.state().states.find((x) => x.proc.id === "p34").status;
  return { id: "renewal-14-days", step: `ניסוי י: החידוש נפתח ב־12.8.2027 (יעד ${hhmmOf(s.dueAt)}); ליאור לא עושה כלום. ב־26.8 בצהריים: ${mid}; ב־29.8: ${end}`, proc: "p34", role: "lior", act: "אף אחד לא עושה כלום" };
}, renewalRows);
// K. The contract ends on Monday 11.10.2027 and the client is still "active" (the renewal talk was done in August).
// That Monday is Yom Kippur: nothing is sent on it, and Lior's ring goes out the next working morning (Tuesday 12.10, 09:45).
await experiment("exp-k", "s10", async (sim) => {
  sim.jump(IL(2027, 10, 11, 8, 0), "מ־16.8.2027 עד 11.10.2027 לא הורצו תזכורות; יום סיום החוזה נבדק מכאן");
  await sim.until(IL(2027, 10, 12, 10, 0), { step: 5 });
  const cid = sim.client().id;
  const { page, ctx } = await sim.open("lior");
  const card = page.locator(`#mine-list .contract-end[data-contract="${cid}"]`);
  const text = (await card.innerText().catch(() => "(אין כרטיס)")).replace(/\s+/g, " ").trim();
  await shoot(page, "exp-k-lior-contract-end.png");
  console.log(`    ליאור, הכרטיס: ${text} | סטטוס הלקוח: ${sim.client().status}`);
  await card.locator("button", { hasText: "סיום התקשרות" }).click();
  await settle(page, 900);
  const p35 = (await page.locator(`#mine-list .wproc[data-key="${cid}:p35"]`).innerText().catch(() => "(אין כרטיס 35)")).replace(/\s+/g, " ").trim();
  await shoot(page, "exp-k-lior-ending.png");
  await ctx.close();
  console.log(`    אחרי ״סיום התקשרות״: סטטוס ${sim.client().status} | כרטיס 35: ${p35.slice(0, 160)}`);
  await sim.until(IL(2027, 10, 12, 12, 0), { step: 5 });
  return { id: "contract-ended-active", step: `ניסוי יא: החוזה הסתיים ב־11.10.2027 (יום כיפור) והלקוחה עדיין ״פעיל״; ליאור נכנס למחרת ב־10:00. הכרטיס של ליאור: ${text}. אחרי ״סיום התקשרות״: סטטוס ${sim.client().status}`, proc: "p34→p35", role: "lior", act: "ליאור: ״סיום התקשרות״ (לחיצה ואישור)" };
}, renewalRows);
// F. Handed over at 20:55.
await experiment("exp-f", "s3c", async (sim) => {
  await sim.until(IL(2026, 10, 13, 20, 55), { step: 1 });
  markAs(sim, "ilai", "p07.made");
  await sim.until(IL(2026, 10, 14, 9, 5), { step: 1 });
  return { id: "fast-review-2055", step: "ניסוי ו: עילאי מסר את 9 הגרפיקות ביום ג׳ ב־20:55, ואף אחד לא נגע עד למחרת 09:05", proc: "p07", role: "ofir", act: "אף אחד לא עושה כלום" };
});
// '
