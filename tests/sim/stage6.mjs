// '
// Stage 6, editing and delivery, part 1 (Wednesday 21.10 to Monday 26.10.2026): the editor was assigned by
// Ofir when the shoot day closed (22א; protocol v9). Nadia takes the drive (22), Ilai prepares the rest of the
// graphics (23), Ofir checks them, the client approves, Ilai uploads (23ב). Nadia does NOT finish by her
// deadline (the end of Sunday 25.10): the deliberate delay of the editor. Run: node tests/sim/stage6.mjs
import { Sim, IL, fmtLog, settle } from "./lib.mjs";
import { brief, proto, letPass, clientApproves, editorGo } from "./steps.mjs";

const sim = await Sim.start("s6", "s5");
const cid = sim.client().id;
const png = (n = 2000) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(n)]);

// 22: Nadia, Wednesday morning: the drive arrived, the editing starts.
{
  await sim.until(IL(2026, 10, 21, 9, 30));
  const before = await sim.mine("nadia", { shot: "p22-new-client" });
  const r = await editorGo(sim, "nadia", { shot: "editor-page-start" });
  const rows = await sim.tick();
  const after = await sim.mine("nadia");
  sim.rec({ id: "p22-start", step: "נדיה: קיבלתי את הכונן, העריכה התחילה", proc: "p22", role: "nadia", before: { ...brief(before), shot: before.shot, editorCard: r.card, editorShot: r.shot },
    act: `עמוד העריכה (editor.html): הכפתור "${r.button}"${r.dialog ? `, בדיאלוג: ${r.dialog.slice(0, 200)} -> "${r.submit}"` : ""}. ${r.result || ""}`, taps: r.taps + 1,
    after: { said: r.said, cardAfter: r.cardAfter, marks: ["p22.received", "p22.check.footage", "p22.check.logo"].map((k) => `${k}=${sim.checkOf(k)?.state || "-"}`), ...brief(after) }, reminders: fmtLog(rows), errors: r.errors?.length ? r.errors : undefined });
}
// 24: Ofir opens the Drive folder (the task his assignment opened for him).
await proto(sim, { id: "p24-folder", step: "אופיר פותח תיקייה מסודרת בדרייב (המשימה שנפתחה לו עם השיוך)", proc: "p24", role: "ofir", shot: "p24-folder", wait: 20,
  keys: [sim.db.client_tasks.find((t) => t.owner === "ofir" && !t.done_at).id], peek: [], next: [] });
// 23: Ilai uploads the rest of the graphics on his card and passes them to Ofir (due: the end of Wednesday).
{
  await sim.until(IL(2026, 10, 21, 13, 0));
  const before = await sim.mine("ilai", { shot: "p23-rest-graphics" });
  const { page, ctx } = await sim.open("ilai");
  let taps = 0;
  const base = `il-r-${cid}`;
  await page.locator(`[id="${base}-g-in"]`).setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `rest-${i + 1}.png`, mimeType: "image/png", buffer: png(2100 + i) }))); taps += 2;
  await page.waitForFunction((s) => /הועלו/.test(document.querySelector(s)?.textContent || ""), `[id="${base}-g-files"] .fl-work-h`, { timeout: 20000 }).catch(() => null);
  const head = await page.locator(`[id="${base}-g-files"] .fl-work-h`).innerText().catch(() => "");
  await page.locator(`[id="${base}-ready"]`).click(); taps += 1;
  await settle(page, 900);
  // Protocol v8: fewer graphics than the package: the browser asks (the harness accepts the question and keeps its words).
  const asked = (page.dialogs || []).join(" | ");
  if (asked) taps += 1;
  const said = await page.evaluate(() => (document.querySelector("#handoff, dialog[open], .toast")?.innerText || "").replace(/\s+/g, " ").slice(0, 300));
  await ctx.close();
  const rows = await sim.tick();
  const next = { ofir: brief(await sim.mine("ofir", { shot: "p23-ofir-check" })), irit: brief(await sim.mine("irit")) };
  sim.rec({ id: "p23-made", step: "עילאי מעלה את יתרת הגרפיקות ולוחץ מוכן לבדיקה (לאופיר)", proc: "p23", role: "ilai", before: { ...brief(before), shot: before.shot },
    act: `הכרטיס שלו: + העלאת גרפיקות (${head}), מוכן לבדיקה (לאופיר). ${asked ? `המערכת שאלה: ״${asked}״, אושר. ` : "המערכת לא שאלה דבר. "}אחרי הלחיצה: ${said}`, taps,
    after: { made: sim.checkOf("p23.made")?.state || "-", next }, reminders: fmtLog(rows) });
}
// 23: Ofir checks the 7 points and approves; Irit sends; the client approves; Ilai uploads.
// (Protocol v9: inside his ten minutes, 7 after the hand-over. Ignoring it is one of the experiments: exp.mjs.)
await proto(sim, { id: "p23-ofir", step: "אופיר בודק את יתרת הגרפיקות (7 בדיקות) ומאשר, בתוך 10 הדקות שלו", proc: "p23", role: "ofir", wait: 7,
  keys: ["p23.q.design", "p23.q.errors", "p23.q.logo", "p23.q.contact", "p23.q.match", "p23.q.pro", "p23.q.variety", "p23.ofir"], peek: ["irit"], next: ["irit"] });
await proto(sim, { id: "p23-sent", step: "עירית שולחת את יתרת הגרפיקות ללקוחה", proc: "p23", role: "irit", shot: "p23-send", wait: 6, keys: ["p23.sent"], peek: [], next: [] });
await clientApproves(sim, { id: "p23-approved", step: "הלקוחה מאשרת את יתרת הגרפיקות בדף המצב", proc: "p23→p23b", key: "p23.approved", wait: 50, next: ["ilai"], shot: "status-rest-graphics" });
await proto(sim, { id: "p23b", step: "עילאי מעלה את יתרת הגרפיקות שאושרו לרשתות", proc: "p23b", role: "ilai", shot: "p23b", wait: 15, keys: ["p23b.posted"], peek: [], next: [] });
sim.save("s6a");

// The deliberate delay of the editor: the deadline is the end of Sunday 25.10; nothing is ready.
await letPass(sim, IL(2026, 10, 22, 18, 5), { id: "edit-thu", step: "עד יום ה׳ 22.10 18:05: נדיה עורכת, יומיים מתוך שלושה עברו", proc: "p22", role: "nadia", watch: ["nadia", "ofir"] });
await letPass(sim, IL(2026, 10, 25, 18, 5), { id: "edit-sun", step: "עד יום א׳ 25.10 18:05: היעד של העריכה (סוף היום) מגיע, שום דבר לא מוכן", proc: "p22, p24", role: "nadia", watch: ["nadia", "ofir", "lior", "irit"] });
await letPass(sim, IL(2026, 10, 26, 12, 30), { id: "edit-late", step: "עד יום ב׳ 26.10 12:30: העריכה באיחור של חצי יום עסקים", proc: "p22, p24", role: "nadia", watch: ["nadia", "ofir", "lior", "irit", "owner"] });
sim.save();
await sim.stop();
// '
