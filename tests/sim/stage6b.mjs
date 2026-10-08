// '
// Stage 6b, editing and delivery, part 2 (Monday 26.10 to Wednesday 28.10.2026): Nadia hands the videos over
// (late), Ofir returns them once for fixes and then approves (25), Irit sends them (26), the client asks for
// one fix on the status page and then approves (27), Ilai takes the final versions. Run: node tests/sim/stage6b.mjs
import { Sim, IL, fmtLog, settle } from "./lib.mjs";
import { brief, proto, clientApproves, editorGo, ofirQa } from "./steps.mjs";

const sim = await Sim.start("s6b", "s6");
const cid = sim.client().id;
const DRIVE = "https://drive.google.com/drive/folders/hadekel-final";
const marks = (keys) => keys.map((k) => `${k}=${sim.checkOf(k)?.state || "-"}`);
// One step of the editor on her page, recorded.
async function editorStep(o) {
  if (o.at) await sim.until(o.at);
  const before = await sim.mine("nadia", { shot: o.shot });
  const r = await editorGo(sim, "nadia", { link: o.link || null });
  sim.advance(1);
  const rows = await sim.tick();
  const after = await sim.mine("nadia");
  const next = {};
  for (const x of o.next || []) next[x] = brief(await sim.mine(x));
  return sim.rec({ id: o.id, step: o.step, proc: o.proc, role: "nadia", before: { ...brief(before), shot: before.shot, editorCard: r.card },
    act: `עמוד העריכה: הכפתור "${r.button || "-"}"${r.dialog ? `; בדיאלוג (${r.dialog.slice(0, 160)}) -> "${r.submit}"` : ""}${r.result ? `; ${r.result}` : ""}`, taps: r.taps + 1,
    after: { said: r.said, cardAfter: r.cardAfter, marks: marks(o.keys), ...brief(after), next }, reminders: fmtLog(rows), errors: r.errors?.length ? r.errors : undefined });
}
async function qaStep(o) {
  if (o.wait) sim.advance(o.wait);
  await sim.tick();
  const before = await sim.mine("ofir", { shot: o.shot });
  const r = await ofirQa(sim, { fixes: o.fixes || null });
  sim.advance(1);
  const rows = await sim.tick();
  const after = await sim.mine("ofir");
  const next = {};
  for (const x of o.next || []) next[x] = brief(await sim.mine(x, { shot: o.nextShot === x ? `after-${o.id}` : null }));
  return sim.rec({ id: o.id, step: o.step, proc: "p25", role: "ofir", before: { ...brief(before), shot: before.shot, queue: r.queue },
    act: `כרטיס 25 -> בקרה ושיוך (qa.html) -> "${r.button || "-"}" -> ${o.fixes ? `החזרה לתיקון עם ${o.fixes.length} תיקונים` : "כל הבדיקות, ואישור"}${r.result ? `; ${r.result}` : ""}`, taps: r.taps + 1,
    after: { said: r.said, marks: marks(["p25.q.editing", "p25.approved", "p25.return.1"]), ...brief(after), next }, reminders: fmtLog(rows), errors: r.errors?.length ? r.errors : undefined });
}

await editorStep({ id: "p24-ready", at: IL(2026, 10, 26, 13, 0), step: "נדיה: כל הסרטונים בדרייב, מוכן לבדיקה (באיחור של יום עסקים)", proc: "p22, p24", shot: "p24-ready-late", link: DRIVE, keys: ["p22.edited", "p22.self.complete", "p24.drive", "p24.notify", "p24.folder"], next: ["ofir"] });
await qaStep({ id: "p25-return", wait: 25, step: "אופיר: בקרת איכות, מחזיר לתיקון (2 תיקונים)", shot: "p25-qa", fixes: [["3", "הטלפון בסגיר שגוי"], ["7", "כתוביות חתוכות בסוף"]], next: ["nadia", "irit"], nextShot: "nadia" });
await editorStep({ id: "p25-fixes", at: IL(2026, 10, 26, 15, 30), step: "נדיה מתקנת את מה שאופיר החזיר ומחזירה לבדיקה", proc: "p25 (תיקונים)", shot: "p25-fixes", link: DRIVE, keys: ["p24.notify", "p25.return.1"], next: ["ofir"] });
await qaStep({ id: "p25-approve", wait: 20, step: "אופיר: בקרת איכות שנייה, מאשר לשליחה ללקוח", shot: "p25-qa-2", next: ["irit", "lior", "nadia"], nextShot: "irit" });
// 26: Irit sends the videos to the client.
await proto(sim, { id: "p26", step: "עירית שולחת את הסרטונים ללקוחה לאישור", proc: "p26", role: "irit", shot: "p26-send", wait: 5, keys: ["p26.sent"], peek: ["lior"], next: [] });
sim.save("s6b1");
// 27: the client asks for one fix on the status page (the next morning).
await sim.until(IL(2026, 10, 27, 10, 0));
await clientApproves(sim, { id: "p27-fix", step: "הלקוחה מבקשת תיקון אחד בסרטונים בדף המצב", proc: "p27", key: "p27.approved", fix: "בסרטון 5 המחיר של מגש המאפים שגוי, צריך להיות 120", next: ["nadia", "irit", "ofir"], shot: "status-videos", nextShot: "nadia" });
await editorStep({ id: "p27-fixes", at: IL(2026, 10, 27, 12, 0), step: "נדיה מתקנת את הערת הלקוחה", proc: "p27", shot: "p27-fixes", link: DRIVE, keys: ["p27.notes", "p27.fixes", "p27.final"], next: [] });
await editorStep({ id: "p27-final", at: IL(2026, 10, 27, 12, 20), step: "נדיה: הגרסאות הסופיות בדרייב (סגירת העריכה)", proc: "p27", shot: "p27-final", link: DRIVE, keys: ["p27.fixes", "p27.final"], next: ["ilai", "irit"] });
await clientApproves(sim, { id: "p27-approved", step: "הלקוחה מאשרת את הסרטונים בדף המצב", proc: "p27", key: "p27.approved", wait: 40, next: ["ilai", "irit", "nadia"], shot: "status-videos-approve" });
// 27: Ilai takes the final versions ("קיבלתי").
{
  sim.advance(10);
  await sim.tick();
  const before = await sim.mine("ilai", { shot: "p27-ilai-final" });
  const { page, ctx } = await sim.open("ilai");
  const card = page.locator(`.il-card[data-key^="il-final:${cid}"]`);
  const text = (await card.innerText().catch(() => "(אין כרטיס גרסאות סופיות)")).replace(/\s+/g, " ").slice(0, 400);
  const btn = card.locator("button", { hasText: "קיבלתי" });
  const had = await btn.count();
  if (had) { await btn.first().click(); await settle(page, 800); }
  await ctx.close();
  const rows = await sim.tick();
  const after = await sim.mine("ilai");
  sim.rec({ id: "p27-toilai", step: "עילאי: קיבלתי את הגרסאות הסופיות לתזמון ולגאנט", proc: "p27→p28", role: "ilai", before: { ...brief(before), shot: before.shot, card: text },
    act: had ? "הכרטיס גרסאות סופיות -> קיבלתי" : "אין כפתור קיבלתי בכרטיס", taps: 1, after: { marks: marks(["p27.toilai", "p27.final", "p27.approved"]), ...brief(after) }, reminders: fmtLog(rows) });
}
sim.save();
await sim.stop();
// '
