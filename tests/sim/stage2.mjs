// '
// Stage 2, the joining (station 1): the WhatsApp group (2), the characterization meeting set (3).
// Sunday 11.10.2026 from 09:37. Run: node tests/sim/stage2.mjs
import { Sim, IL, fmtLog, settle } from "./lib.mjs";
import { brief, proto, cardsOf, shotOf } from "./steps.mjs";

const sim = await Sim.start("s2", "s1");
const t0 = Date.now();

// The client is open: who has what, the moment after the signature.
{
  sim.advance(1);
  const rows = await sim.tick();
  const snaps = {};
  for (const r of ["irit", "lior", "ofir", "ilai", "nadia", "eli", "owner"]) snaps[r] = brief(await sim.mine(r, { shot: r === "irit" ? "client-opened" : null }));
  sim.rec({ id: "opened", step: "הלקוח נפתח: מה יש לכל אחד ב״המשימות שלי״ דקה אחרי החתימה", proc: "p01→p02,p03", role: "כולם", before: {}, act: "צפייה בלבד", taps: 0, after: { mine: snaps }, reminders: fmtLog(rows) });
}
// 2: Irit opens the group, adds everyone, sends the introduction.
await proto(sim, { id: "p02-irit", step: "עירית פותחת קבוצת WhatsApp, מצרפת את כולם ושולחת הודעת היכרות", proc: "p02", role: "irit", shot: "p02-group",
  keys: ["p02.opened", "p02.m.lior", "p02.m.irit", "p02.m.ofir", "p02.m.ilai", "p02.m.client", "p02.intro"], peek: ["lior", "ofir", "ilai"], next: ["lior"] });
// 2: Lior checks the deal and that the client knows who handles them.
await proto(sim, { id: "p02-lior", step: "ליאור: בדיקת עסקה חריגה, והלקוח יודע מי מטפל בו", proc: "p02", role: "lior", shot: "p02-lior", wait: 6,
  keys: ["p02.deal", "p02.team"], peek: ["irit"], next: [] });

// 3: Irit sets the characterization meeting. The date and who runs it are fields of the client card.
{
  sim.advance(2);
  await sim.tick();
  const before = await sim.mine("irit", { shot: "p03-set-meeting" });
  const { page, ctx } = await sim.open("irit");
  let taps = 0;
  const card = page.locator(`#mine-list .wproc[data-key="${sim.client().id}:p03"]`);
  const cardText = (await card.innerText()).replace(/\s+/g, " ");
  // From the card on "המשימות שלי" there is no field for the date: the name of the client leads to the client card.
  await card.locator("a.wclient").click(); taps += 1;
  await page.waitForSelector("#p03-h");
  await settle(page);
  const hint = await page.evaluate(() => (document.querySelector("#p03 .need")?.innerText || "").replace(/\s+/g, " "));
  await page.locator("#p03 .need button").click(); taps += 1;
  await page.waitForSelector("#dlg-edit[open]");
  await page.selectOption("#ed-characterizer", "ofir"); taps += 1;
  await page.fill("#ed-char-at", "2026-10-12T10:00"); taps += 1;
  await page.fill("#ed-address", "הדקל 12, רמת גן"); taps += 1;
  await page.click("#ed-submit"); taps += 1;
  await settle(page, 600);
  const saved = { characterizer: sim.client().characterizer, char_at: sim.client().char_at };
  await ctx.close();
  sim.advance(2);
  const rows1 = await sim.tick();
  const mid = await sim.mine("irit");
  const res = await (await import("./steps.mjs")).markMine(sim, "irit", ["p03.who", "p03.available", "p03.scheduled", "p03.calendar"]);
  sim.advance(1);
  const rows2 = await sim.tick();
  const after = await sim.mine("irit");
  const next = { ofir: brief(await sim.mine("ofir", { shot: "after-p03-ofir" })), lior: brief(await sim.mine("lior")), ilai: brief(await sim.mine("ilai")) };
  sim.rec({ id: "p03", step: "עירית קובעת פגישת אפיון (מי מבצע, מתי) ומסמנת את תהליך 3", proc: "p03", role: "irit",
    before: { ...brief(before), shot: before.shot, cardText, hintInCard: hint },
    act: `שם הלקוח בכרטיס -> כרטיס הלקוח -> "השלמת פרטים" -> מי מבצע + מועד + כתובת -> שמירה (${JSON.stringify(saved)}); חזרה ל"המשימות שלי" וסימון: ${Object.entries(res.out).map(([k, v]) => `${k}=${v}`).join(", ")}`, taps: taps + res.taps,
    after: { mid: cardsOf(mid, "p03").map((c) => `${c.when} | ${c.items.map((i) => i.label).join("; ")}`), ...brief(after), next }, reminders: fmtLog([...rows1, ...rows2]) });
}
console.log("seconds:", Math.round((Date.now() - t0) / 1000));
sim.save();
await sim.stop();
// '
