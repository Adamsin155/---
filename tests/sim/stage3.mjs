// '
// Stage 3, the characterization day (station 2, first half): Sunday evening to Monday 12.10.2026 noon.
// The meeting (4) and its form, the access taken in the meeting (5). Run: node tests/sim/stage3.mjs
import { Sim, IL, fmtLog, settle } from "./lib.mjs";
import { brief, proto, cardsOf, shotOf, letPass, markMine } from "./steps.mjs";

const sim = await Sim.start("s3", "s2");
const cid = sim.client().id;

// Sunday afternoon to Monday 09:50: nobody acts. What the reminders say on the way (the kit of the meeting; the shoot day is not set yet).
await letPass(sim, IL(2026, 10, 12, 9, 50), { id: "night-1", step: "מיום א׳ 09:50 עד יום ב׳ 09:50: מה נשלח בינתיים", proc: "p03→p04, p11", role: "ofir", watch: ["ofir", "irit"] });

// 4: Ofir at the client. The meeting ends at 11:25 and he presses "האפיון הסתיים" on the phone.
{
  await sim.until(IL(2026, 10, 12, 11, 25));
  const before = await sim.mine("ofir", { shot: "p04-meeting" });
  const { page, ctx } = await sim.open("ofir");
  let taps = 0;
  const go = page.locator(`#mine-list .wproc[data-key="${cid}:p04"] a.ik-go`).first();
  const goText = (await go.innerText()).trim();
  await go.click(); taps += 1;
  await page.waitForSelector("#end-submit");
  await page.fill("#end-address", "הדקל 12, רמת גן"); taps += 1;
  await page.fill("#end-phone", "03-5550142"); taps += 1;
  await page.check("#end-has_logo-yes"); taps += 1;
  await page.check("#end-net-instagram-ok"); taps += 1;
  await page.fill("#end-net-instagram-user", "hadekel.bakery"); taps += 1;
  await page.fill("#end-net-instagram-pass", "Secret-123"); taps += 1;
  const shot = await shotOf(sim, page, "ofir", "p04-end-form");
  await page.click("#end-submit"); taps += 1;
  await settle(page, 900);
  const doneText = await page.locator(".ik-done").innerText().catch(() => "(אין סיכום)");
  const toast = await page.evaluate(() => [...document.querySelectorAll(".toast, #toast, [role=status]")].map((e) => e.innerText).join(" | "));
  await ctx.close();
  const rows = await sim.tick();
  const after = await sim.mine("ofir");
  const next = {};
  for (const r of ["ilai", "lior", "irit"]) next[r] = brief(await sim.mine(r, { shot: r === "ilai" ? "after-char-ilai" : null }));
  sim.rec({ id: "p04-end", step: "אופיר מסיים את האפיון אצל הלקוח ולוחץ ״האפיון הסתיים״", proc: "p04, p05", role: "ofir",
    before: { ...brief(before), shot: before.shot },
    act: `כרטיס תהליך 4 -> "${goText}" (intake.html#end): כתובת, טלפון, יש לוגו, אינסטגרם (משתמש וסיסמה לכספת), ואז "האפיון הסתיים". תמונה: ${shot}`, taps,
    after: { doneText: doneText.replace(/\s+/g, " "), toast, marks: ["p04.ended", "p04.address", "p04.phone", "p05.access", "p05.vault", "p05.logo"].map((k) => `${k}=${sim.checkOf(k)?.state || "-"}`), access: sim.db.client_access.map((a) => `${a.network}:${a.status}`), ...brief(after), next },
    reminders: fmtLog(rows) });
}
// 4: the full form, within 60 minutes of "the meeting ended". Ofir fills it back at the office (12:05).
{
  await sim.until(IL(2026, 10, 12, 12, 5));
  const before = await sim.mine("ofir", { shot: "p04-form" });
  const { page, ctx } = await sim.open("ofir");
  let taps = 0;
  const go = page.locator(`#mine-list .wproc[data-key="${cid}:p04"] a.ik-go`).first();
  const goText = (await go.innerText().catch(() => "")).trim();
  await go.click(); taps += 1;
  await page.waitForSelector("#form-form");
  const fill = { services: "לחמי מחמצת, מאפים, עוגות להזמנה, קפה", audiences: "משפחות ברמת גן וגבעתיים, בני 28 עד 55", advantages: "אפייה במקום כל בוקר, 30 שנה באותה משפחה", goals: "יותר הזמנות לשישי ולאירועים", offers: "מגש מאפים 120 ש״ח, עוגת יום הולדת מ־180 ש״ח",
    content: "מאחורי הקלעים של האפייה, לקוחות קבועים, מוצר השבוע", graphics: "מחירון, שעות פתיחה, מבצעי שישי", campaigns: "הזמנות בוואטסאפ ולידים לאירועים", special: "לא לצלם את המתכונים הכתובים על הקיר" };
  for (const [k, v] of Object.entries(fill)) { await page.fill(`#form-${k}`, v); taps += 1; }
  await page.fill("#form-colors", "חום ושמנת"); taps += 1;
  await page.check("#form-mat-photos-got"); taps += 1;
  await page.check("#form-mat-videos-none").catch(() => page.check("#form-mat-videos-missing")); taps += 1;
  await page.check("#form-mat-menu-got").catch(() => null); taps += 1;
  const progress = await page.locator("#form-progress").innerText().catch(() => "");
  await page.click("#form-save"); taps += 1;
  await settle(page, 900);
  const toast = await page.evaluate(() => [...document.querySelectorAll(".toast, #toast, [role=status]")].map((e) => e.innerText).join(" | "));
  await ctx.close();
  const rows = await sim.tick();
  const after = await sim.mine("ofir");
  const irit = brief(await sim.mine("irit", { shot: "after-char-irit" }));
  sim.rec({ id: "p04-form", step: "אופיר ממלא ושומר את טופס האפיון המלא", proc: "p04", role: "ofir",
    before: { ...brief(before), shot: before.shot },
    act: `כרטיס תהליך 4 -> "${goText}" -> 9 שדות, צבעים, חומרים (${progress.replace(/\s+/g, " ")}), "שמירת טופס האפיון"`, taps,
    after: { toast, marks: ["p04.saved", "p04.followup", "p04.tasks", "p05.colors", "p05.photos", "p05.videos", "p05.menu"].map((k) => `${k}=${sim.checkOf(k)?.state || "-"}${sim.checkOf(k)?.note ? ` (${sim.checkOf(k).note})` : ""}`), tasks: sim.db.client_tasks.map((t) => `${t.owner}: ${t.title} (עד ${t.due_on || "-"}${t.source ? `, ${t.source}` : ""})`), ...brief(after), next: { irit } },
    reminders: fmtLog(rows) });
}
sim.save();
await sim.stop();
// '
