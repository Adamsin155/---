// '
// Stage 8b, once each (Sunday 1.11.2026): an exception reported to Lior and decided; a question of the owner
// to the responsible person and its answer. Run: node tests/sim/stage8b.mjs
import { Sim, IL, fmtLog, settle } from "./lib.mjs";
import { brief, shotOf } from "./steps.mjs";

const sim = await Sim.start("s8b", "s8");
const cid = sim.client().id;
const clip = (s, n = 400) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const controls = (loc) => loc.evaluate((el) => [...el.querySelectorAll("button, a.btn, select, textarea, input")].filter((e) => e.getClientRects().length).map((e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""} ${(e.textContent || "").trim().slice(0, 40)}`).join(" ; ")).catch(() => "");

// The exception: Nadia reports from the client card; Lior decides.
{
  await sim.until(IL(2026, 11, 1, 10, 0));
  const n = await sim.open("nadia", `client.html?id=${cid}`);
  await n.page.click("#btn-escalate");
  await n.page.waitForSelector("#dlg-escalate[open]");
  await n.page.selectOption("#esc-reason", "משימה תקועה");
  await n.page.fill("#esc-details", "חסר סרטון המלצה בכונן, אי אפשר לסגור את הגרסה המלאה");
  await n.page.click("#esc-submit");
  await settle(n.page, 700);
  const said = await n.page.evaluate(() => [...document.querySelectorAll(".toast, #toast")].map((e) => e.innerText).join(" | "));
  await n.ctx.close();
  const rows1 = await sim.tick();
  sim.advance(12);
  const rows2 = await sim.tick();
  const before = await sim.mine("lior", { shot: "exception-lior" });
  const ofir = brief(await sim.mine("ofir"));
  const l = await sim.open("lior", "decisions.html#ex-h");
  await settle(l.page, 600);
  const card = l.page.locator("#ex-list .dc-card, #ex-list li").first();
  const cardText = clip(await card.innerText().catch(() => "אין חריגה ברשימה"), 400);
  const cardControls = await controls(card);
  let did = "לא נמצא כפתור החלטה";
  const ex = sim.db.client_tasks.find((t) => t.source === "escalation" && !t.done_at);
  const btn = card.locator("button.none-such").first();
  if (ex && await l.page.locator(`[id="ex-${ex.id}-s"]`).count()) {
    await l.page.locator(`[id="ex-${ex.id}-s"]`).click();
    await l.page.fill(`[id="ex-${ex.id}-decision"]`, "מצלמים סרטון המלצה קצר ביום חמישי; נדיה סוגרת בלי, ומוסיפה כשמגיע");
    await l.page.fill(`[id="ex-${ex.id}-next"]`, "לתאם עם הלקוחה צילום המלצה ביום חמישי");
    await l.page.selectOption(`[id="ex-${ex.id}-owner"]`, "irit");
    await l.page.click(`[id="ex-${ex.id}-close"]`);
    await settle(l.page, 800);
    did = "טיפול בחריגה -> סיבה (ממולאת), החלטה, פעולה הבאה, אחראי (עירית), מועד (ממולא: מחר) -> פתיחת המשימה וסגירה";
  } else if (await btn.count()) {
    const label = clip(await btn.innerText());
    await btn.click(); await settle(l.page, 600);
    const dlg = l.page.locator("dialog[open]").first();
    if (await dlg.count()) {
      const dc = await controls(dlg);
      for (const t of await dlg.locator("textarea:visible").all()) await t.fill("מצלמים סרטון המלצה קצר ביום חמישי; נדיה סוגרת בלי, ומוסיפה כשמגיע");
      for (const s of await dlg.locator("select:visible").all()) { const opts = await s.locator("option").allInnerTexts(); if (opts.length > 1) await s.selectOption({ index: 1 }); }
      const submit = dlg.locator("button[type=submit], button.btn-primary").first();
      did = `"${label}" -> דיאלוג (${dc}) -> "${clip(await submit.innerText())}"`;
      await submit.click(); await settle(l.page, 800);
    } else did = `"${label}" (בלי דיאלוג)`;
  }
  const said2 = await l.page.evaluate(() => [...document.querySelectorAll(".toast, #toast, dialog[open] .err")].map((e) => e.innerText).join(" | "));
  await l.ctx.close();
  sim.advance(2);
  const rows3 = await sim.tick();
  const after = await sim.mine("lior");
  sim.rec({ id: "exception", step: "חריגה: נדיה מדווחת לליאור מכרטיס הלקוח; ליאור מחליט", proc: "חריגה (כל הפרוטוקולים)", role: "nadia→lior",
    before: { ...brief(before), shot: before.shot, ofir, exceptionCard: cardText, controls: cardControls },
    act: `נדיה: כרטיס הלקוח -> דיווח חריגה לליאור -> סיבה, פרטים, שליחה (${clip(said, 120)}); ליאור: חריגות שדווחו במשימות שלי -> החלטות -> ${did}. ${clip(said2, 160)}`, taps: 8,
    after: { tasks: sim.db.client_tasks.filter((t) => t.source === "escalation" || t.created_at >= "2026-11-01").map((t) => `${t.owner}: ${t.title} ${t.done_at ? "[נסגר]" : "[פתוח]"}`), decisions: sim.db.task_decisions.map((d) => clip(d.decision, 100)), ...brief(after), nadia: brief(await sim.mine("nadia")) },
    reminders: fmtLog([...rows1, ...rows2, ...rows3]) });
}
// The question: the owner asks whoever is responsible for the first row of "מה דורש אותי"; that person answers.
{
  await sim.until(IL(2026, 11, 1, 11, 30));
  const o = await sim.open("owner", "owner.html#now");
  await settle(o.page, 700);
  const row = o.page.locator("#ow-rows > li").first();
  const rowText = clip(await row.innerText().catch(() => "אין שורות"), 300);
  let asked = "אין שורה לשאול עליה";
  if (await row.locator(".ask-btn").count()) {
    await row.locator(".ask-btn").click();
    await o.page.waitForSelector("#dlg-ask[open]");
    const head = clip(await o.page.locator("#ask-h").innerText());
    await o.page.fill("#ask-text", "מה המצב, ומתי זה נסגר?");
    await o.page.click("#ask-submit");
    await settle(o.page, 700);
    asked = `${head}: ״מה המצב, ומתי זה נסגר?״`;
  }
  const shot = await shotOf(sim, o.page, "owner", "question-asked");
  await o.ctx.close();
  const rows1 = await sim.tick();
  const q = sim.db.client_questions.at(-1);
  let answered = "לא נשאלה שאלה";
  let beforeAns = null;
  if (q) {
    sim.advance(20);
    await sim.tick();
    const who = q.to_person;
    const snap = await sim.mine(who, { shot: "question-to-answer" });
    beforeAns = { ...brief(snap), shot: snap.shot };
    const a = await sim.open(who);
    const box = a.page.locator("#my-questions");
    const boxControls = await controls(box);
    const area = box.locator("textarea").first();
    if (await area.count()) {
      await area.fill("הכול סגור, נשאר רק סיכום חמישי. נסגר היום עד 14:00.");
      const send = box.locator("button", { hasText: /שליחה|שלח|תשובה|מענה/ }).first();
      answered = `${who}: הכרטיס שאלות אליי בראש המשימות שלי (${boxControls}) -> תשובה -> "${clip(await send.innerText())}"`;
      await send.click(); await settle(a.page, 700);
    } else {
      const open = box.locator("button").first();
      if (await open.count()) { await open.click(); await settle(a.page, 500); const ar = a.page.locator("#my-questions textarea, dialog[open] textarea").first(); if (await ar.count()) { await ar.fill("הכול סגור, נשאר רק סיכום חמישי. נסגר היום עד 14:00."); const send = a.page.locator("#my-questions button.btn-primary, dialog[open] button[type=submit], dialog[open] button.btn-primary").first(); answered = `${who}: שאלות אליי -> פתיחה -> תשובה -> "${clip(await send.innerText())}"`; await send.click(); await settle(a.page, 700); } else answered = `${who}: נפתח, אין שדה תשובה (${boxControls})`; }
      else answered = `${who}: אין כרטיס שאלות (${clip(await box.innerText().catch(() => ""), 100)})`;
    }
    await a.ctx.close();
  }
  sim.advance(2);
  const rows2 = await sim.tick();
  sim.rec({ id: "question", step: "שאלה של הבעלים לאחראי, ותשובה", proc: "שאלה לאחראי (סעיף 45)", role: "owner→?", before: { row: rowText, shot, asked: beforeAns },
    act: `הבעלים: מה דורש אותי -> שאלה לאחראי -> ${asked}; ${answered}`, taps: 6,
    after: { questions: sim.db.client_questions.map((x) => `${x.to_person}: ${clip(x.question, 60)} -> ${clip(x.answer, 80) || "(אין תשובה)"}`) }, reminders: fmtLog([...rows1, ...rows2]) });
}
sim.save();
await sim.stop();
// '
