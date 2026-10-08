// '
// Stage 7, publishing (Tuesday 27.10 to Thursday 29.10.2026): the scheduling (28), the Gantt filled and sent
// to the client (29), the campaigns (30), the first weekly call (31). And, once each: a question of the owner
// to an employee and its answer, a nudnik task from Irit, an exception reported to Lior and decided.
// Run: node tests/sim/stage7.mjs
import { Sim, IL, fmtLog, settle, scrapeControls } from "./lib.mjs";
import { brief, proto, shotOf, markMine } from "./steps.mjs";

const sim = await Sim.start("s7", "s6b");
const cid = sim.client().id;
const marks = (keys) => keys.map((k) => `${k}=${sim.checkOf(k)?.state || "-"}`);

// 28: Ilai schedules (no real Metricool here: the mark only).
// Protocol v8: first as in the first run, with an empty Gantt: "הגאנט מלא" and "תוזמן" are pressed with nothing behind them.
{
  sim.advance(30);
  await sim.tick();
  const { page, ctx } = await sim.open("ilai");
  const card = page.locator(`.il-card[data-key^="il-gantt:${cid}"]`).first();
  let said = "(אין כרטיס גאנט)";
  if (await card.count()) { await card.locator("button", { hasText: "הגאנט מלא" }).first().click(); await settle(page, 900); said = (await page.locator("#toast").innerText().catch(() => "")).replace(/\s+/g, " "); }
  await ctx.close();
  sim.rec({ id: "p29-empty", step: "עילאי לוחץ ״הגאנט מלא״ כשבגאנט אין אף שורה", proc: "p29", role: "ilai", before: { note: `שורות בגאנט של הלקוחה: ${sim.db.client_gantt.filter((r) => r.client_id === cid).length}` },
    act: "הכרטיס שלו -> ״הגאנט מלא״", taps: 1, after: { said, check: `p29.filled=${sim.checkOf("p29.filled")?.state || "-"}` }, reminders: fmtLog(await sim.tick()) });
}
await proto(sim, { id: "p28", step: "עילאי מסמן ״תוזמנו מראש״ כששום דבר לא מתוזמן בגאנט", proc: "p28", role: "ilai", shot: "p28-schedule", keys: ["p28.scheduled"], peek: ["irit"], next: [] });
// The Gantt gets its content (seeded into the fake's client_gantt: the simulation does not drive gantt.html, and there is no Metricool here).
sim.db.client_gantt.push(...Array.from({ length: 4 }, (_, i) => ({ id: `00000000-0000-4000-8000-00000000g${i}`.replace("g", "9"), client_id: cid, key: `sim-${i}`, kind: i < 3 ? "video" : "graphic", state: i < 2 ? "scheduled" : "planned", day: `2026-11-0${i + 1}`, time: "12:00" })));
sim.nudges.push({ at: sim.iso(), what: "4 שורות תוכן (2 מהן ״תוזמן״) הוכנסו ישירות לגאנט של המשרד המדומה (עמוד הגאנט ו־Metricool לא הופעלו בסימולציה), כדי שהסימונים 28 ו־29 יתקבלו" });
await proto(sim, { id: "p28-ok", step: "עילאי מסמן ״תוזמנו מראש״ אחרי שיש בגאנט תכנים מתוזמנים", proc: "p28", role: "ilai", wait: 5, keys: ["p28.scheduled"], peek: [], next: [] });
// 29: the Gantt is full (the button of his card), then Irit sends it to the client.
{
  sim.advance(20);
  await sim.tick();
  const before = await sim.mine("ilai", { shot: "p29-gantt" });
  const { page, ctx } = await sim.open("ilai");
  const card = page.locator(`.il-card[data-key^="il-gantt:${cid}"], .il-card:has-text("הגאנט מלא")`).first();
  const text = (await card.innerText().catch(() => "(אין כרטיס גאנט)")).replace(/\s+/g, " ").slice(0, 300);
  const btn = card.locator("button", { hasText: "הגאנט מלא" });
  const had = await btn.count();
  let said = "";
  if (had) { await btn.first().click(); await settle(page, 900); said = await page.evaluate(() => [...document.querySelectorAll("#handoff, .toast, dialog[open]")].map((e) => e.innerText).join(" | ").replace(/\s+/g, " ").slice(0, 300)); }
  await ctx.close();
  const res = sim.done("p29.filled") ? null : await markMine(sim, "ilai", ["p29.filled"]);
  sim.advance(1);
  const rows = await sim.tick();
  const next = { irit: brief(await sim.mine("irit", { shot: "p29-irit-send" })) };
  sim.rec({ id: "p29-filled", step: "עילאי: הגאנט מלא ותואם לתזמון", proc: "p29", role: "ilai", before: { ...brief(before), shot: before.shot, card: text },
    act: `${had ? "הכרטיס שלו -> הגאנט מלא" : "אין כפתור"}${res ? `; ואז במשימות שלי: ${JSON.stringify(res.out)}` : ""}. נאמר: ${said}`, taps: 1 + (res?.taps || 0),
    after: { marks: marks(["p29.filled"]), gantt_rows: sim.db.client_gantt.length, next }, reminders: fmtLog(rows) });
}
await proto(sim, { id: "p29-sent", step: "עירית מעבירה את הגאנט ללקוחה", proc: "p29", role: "irit", wait: 10, keys: ["p29.sent"], peek: [], next: [] });
// 30: the campaigns of Lior (a business day from the approval of Ofir: the end of Tuesday). He does it Wednesday morning.
await sim.until(IL(2026, 10, 28, 9, 40));
await proto(sim, { id: "p30", step: "ליאור בונה את הקמפיינים (יום אחרי היעד)", proc: "p30", role: "lior", shot: "p30-campaigns", keys: ["p30.picked", "p30.live"], peek: ["irit"], next: ["lior", "irit", "ofir", "ilai"] });
sim.save("s7a");

// A nudnik task: Irit asks Nadia for something on the spot; it rings every 10 minutes until "בוצע".
{
  await sim.until(IL(2026, 10, 28, 10, 30));
  const { page, ctx } = await sim.open("irit");
  await page.click("#st-new");
  await page.selectOption("#st-assignee", "nadia");
  await page.fill("#st-body", "להעלות לדרייב את סרטון ההמלצה של מאפיית הדקל בנפרד");
  if (await page.locator("#st-client").count()) await page.selectOption("#st-client", cid).catch(() => null);
  await page.click("#st-send");
  await settle(page, 700);
  const card = (await page.locator("#staff-tasks-card").innerText()).replace(/\s+/g, " ").slice(0, 300);
  await ctx.close();
  const rows0 = await sim.tick();
  await sim.until(IL(2026, 10, 28, 11, 5));
  const nadiaBefore = await sim.mine("nadia", { shot: "nudnik-nadia" });
  const n = await sim.open("nadia");
  const doneBtn = n.page.locator("#staff-tasks-card [data-act=done]").first();
  const hadDone = await doneBtn.count();
  if (hadDone) { await doneBtn.click(); await settle(n.page, 600); }
  await n.ctx.close();
  const mid = sim.db.reminder_log.filter((r) => r.rule === "nag").map((r) => `${r.created_at.slice(11, 16)}Z -> ${r.person}`);
  await sim.until(IL(2026, 10, 28, 11, 40));
  const after = sim.db.reminder_log.filter((r) => r.rule === "nag" || r.rule === "nagDone");
  sim.rec({ id: "nudnik", step: "נודניק: עירית נותנת לנדיה משימה מיידית; נדיה מסמנת בוצע אחרי 35 דקות", proc: "נודניק (סעיף 31)", role: "irit→nadia",
    before: { nadia: brief(nadiaBefore), shot: nadiaBefore.shot },
    act: `עירית: במשימות שלי, שליחת נודניק -> למי, מה, לקוח -> שליחה (${card}); נדיה: ${hadDone ? "בוצע בכרטיס בראש המשימות שלי" : "אין כפתור בוצע"}`, taps: 6,
    after: { task: sim.db.staff_tasks.map((t) => `${t.assignee}: ${t.status}`), nagRows: mid, total: after.length },
    reminders: fmtLog([...rows0, ...after.filter((r) => !rows0.includes(r))]) });
}
sim.save();
await sim.stop();
// '
