// '
// Stage 9: a month of ongoing work with nobody doing the routine (what the reminders do by themselves),
// the question of the owner to the responsible person, the monthly cycle as each role sees it, and the
// renewal window (34) 60 days before the end of the contract. Run: node tests/sim/stage9.mjs
import { Sim, IL, fmtLog, settle, stamp } from "./lib.mjs";
import { brief, shotOf, proto, letPass } from "./steps.mjs";

const sim = await Sim.start("s9", "s8b");
const cid = sim.client().id;
const clip = (s, n = 400) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const controls = (loc) => loc.evaluate((el) => [...el.querySelectorAll("button, a.btn, select, textarea, input")].filter((e) => e.getClientRects().length).map((e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""} ${(e.textContent || "").trim().slice(0, 40)}`).join(" ; ")).catch(() => "");
// The reminders of a stretch of time, counted by rule, person and level.
const counted = (rows) => { const m = new Map(); for (const r of rows) { const k = `${r.rule} -> ${r.person} [${r.level}/${r.channel}/${r.status}]`; m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× ${k}`); };

// Two days with no routine, then the owner asks about the first row of "מה דורש אותי".
{
  const start = sim.db.reminder_log.length;
  await sim.until(IL(2026, 11, 3, 15, 0));
  const o = await sim.open("owner", "owner.html#now");
  await settle(o.page, 700);
  const rowsText = (await o.page.locator("#ow-rows > li").allInnerTexts()).map((t) => clip(t, 220));
  const row = o.page.locator("#ow-rows > li:has(.ask-btn)").first();
  let asked = "אין שורה לשאול עליה";
  if (await row.count()) {
    await row.locator(".ask-btn").click();
    await o.page.waitForSelector("#dlg-ask[open]");
    const head = clip(await o.page.locator("#ask-h").innerText());
    const ctxText = clip(await o.page.locator("#ask-ctx").innerText(), 160);
    await o.page.fill("#ask-text", "מה המצב, ומתי זה נסגר?");
    await o.page.click("#ask-submit");
    await settle(o.page, 700);
    asked = `${head} (${ctxText})`;
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
    const boxText = clip(await box.innerText().catch(() => "אין כרטיס"), 240);
    const boxControls = await controls(box);
    let area = box.locator("textarea").first();
    if (!(await area.count()) && await box.locator("button").count()) { await box.locator("button").first().click(); await settle(a.page, 500); area = a.page.locator("#my-questions textarea, dialog[open] textarea").first(); }
    if (await area.count()) {
      await area.fill("הבקרה לא סומנה יומיים כי הייתי בשטח. נסגר היום עד 16:00.");
      const send = a.page.locator("#my-questions button.btn-primary, #my-questions button[type=submit], dialog[open] button[type=submit]").first();
      const label = clip(await send.innerText().catch(() => "?"));
      await send.click(); await settle(a.page, 700);
      answered = `${who}: הכרטיס בראש המשימות שלי (${boxText}; ${boxControls}) -> תשובה -> "${label}"`;
    } else answered = `${who}: אין שדה תשובה (${boxText}; ${boxControls})`;
    await a.ctx.close();
  }
  sim.advance(2);
  const rows2 = await sim.tick();
  sim.rec({ id: "question", step: "שאלה של הבעלים לאחראי, ותשובה", proc: "שאלה לאחראי (סעיף 45)", role: `owner→${q?.to_person || "?"}`, before: { rows: rowsText, shot, asked: beforeAns, twoDays: counted(sim.db.reminder_log.slice(start)) },
    act: `הבעלים: מה דורש אותי -> שאלה לאחראי -> ${asked}; ${answered}`, taps: 6,
    after: { questions: sim.db.client_questions.map((x) => `${x.to_person}: ${clip(x.question, 60)} -> ${clip(x.answer, 90) || "(אין תשובה)"}`) }, reminders: fmtLog([...rows1, ...rows2]) });
}
// The monthly cycle, as the client card shows it and as each role sees it on "המשימות שלי".
{
  const { page, ctx } = await sim.open("irit", `client.html?id=${cid}`);
  const month = clip(await page.evaluate(() => document.getElementById("mc-card-h")?.closest("section")?.innerText || ""), 900);
  await ctx.close();
  const mine = {};
  for (const r of ["irit", "ilai", "lior", "ofir"]) mine[r] = brief(await sim.mine(r, { shot: r === "ilai" ? "month-ilai" : null }));
  sim.rec({ id: "month-cycle", step: "המחזור החודשי: מה כתוב בכרטיס הלקוח, ומה רואה כל אחד", proc: "מחזור חודשי (סעיף 15)", role: "כולם", before: {}, act: "צפייה בלבד", taps: 0, after: { monthCard: month, marks: sim.db.client_month_marks.length, mine }, reminders: [] });
}
sim.save("s9a");
// The rest of the month: nobody does the routine. What goes out, counted.
{
  const start = sim.db.reminder_log.length;
  await sim.until(IL(2026, 11, 26, 18, 30), { step: 5 });
  const rows = sim.db.reminder_log.slice(start);
  const mine = {};
  for (const r of ["irit", "lior", "ofir", "ilai", "owner"]) mine[r] = brief(await sim.mine(r, { shot: r === "irit" ? "month-no-routine-irit" : null }));
  sim.rec({ id: "month-pass", step: "מ־3.11 עד 26.11.2026: חודש שוטף שבו אף אחד לא עושה את השגרה (הודעה יומית, בקרות, שיחה שבועית, סיכום חמישי, פריטי החודש)", proc: "p31, 32, 33, מחזור חודשי", role: "כולם",
    before: {}, act: "אף אחד לא עושה כלום; התזכורות רצות כל 5 דקות", taps: 0, after: { counted: counted(rows), mine }, reminders: fmtLog(rows.filter((r) => /weekly|callFollowup|month|year|renewal|campaign|thursday/.test(r.rule)).slice(0, 40)) });
}
sim.save();
await sim.stop();
// '
