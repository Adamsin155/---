// '
// Stage 4, Tuesday 13.10.2026: the 9 graphics (a day late), their review, the approval of the client on
// the status page, the upload (7, 7ב); the shoot day set a day late (11). Run: node tests/sim/stage4.mjs
import { Sim, IL, fmtLog, settle } from "./lib.mjs";
import { brief, proto, markMine, clientApproves, linkCard, followUp, cardsOf, shotOf } from "./steps.mjs";

const sim = await Sim.start("s4", "s3c");
const cid = sim.client().id;
const png = (n = 2000) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(n)]);

// 7: Ilai uploads the 9 graphics on his card and passes them to Irit (20 hours late).
{
  await sim.until(IL(2026, 10, 13, 9, 45));
  const before = await sim.mine("ilai", { shot: "p07-graphics-late" });
  // Before he hands them over: is anything of process 7 on Irit's or Lior's list?
  const peekBefore = {};
  for (const r of ["irit", "lior"]) peekBefore[r] = cardsOf(await sim.mine(r), "p07").map((c) => `${c.group} · ${c.when || "-"} · ${c.items.length} פריטים`);
  const { page, ctx } = await sim.open("ilai");
  let taps = 0;
  await page.locator(`[id="il-${cid}-s"]`).click(); taps += 1;
  await page.locator(`[id="il-${cid}-g9-in"]`).setInputFiles(Array.from({ length: 9 }, (_, i) => ({ name: `post-${i + 1}.png`, mimeType: "image/png", buffer: png(2000 + i) }))); taps += 2;
  await page.waitForFunction((s) => /9 מתוך 9|הועלו 9/.test(document.querySelector(s)?.textContent || ""), `[id="il-${cid}-g9-files"] .fl-work-h`, { timeout: 20000 }).catch(() => null);
  const head = await page.locator(`[id="il-${cid}-g9-files"] .fl-work-h`).innerText();
  await page.locator(`[id="il-${cid}-gfx"]`).click(); taps += 1;
  await settle(page, 900);
  const said = await page.evaluate(() => (document.querySelector("#handoff, dialog[open], .toast")?.innerText || "").replace(/\s+/g, " ").slice(0, 300));
  await ctx.close();
  const rows = await sim.tick();
  const after = await sim.mine("ilai");
  const next = { irit: brief(await sim.mine("irit", { shot: "p07-review" })), lior: brief(await sim.mine("lior")) };
  sim.rec({ id: "p07-made", step: "עילאי מעלה את 9 הגרפיקות ולוחץ מוכן לבדיקה (לעירית), באיחור של יום", proc: "p07", role: "ilai",
    before: { ...brief(before), shot: before.shot, peek: peekBefore },
    act: `הכרטיס שלו: פתיחה, + העלאת גרפיקות (9 קבצים: ${head}), מוכן לבדיקה (לעירית). מה נאמר אחרי הלחיצה: ${said}`, taps,
    after: { made: sim.checkOf("p07.made")?.state || "-", files: sim.db.client_files.filter((f) => !f.deleted_at).length, ...brief(after),
      result: `אצל עירית אחרי המסירה: ${(next.irit.cards || []).filter((c) => / 7א? · /.test(c)).map((c) => c.split(" | ").slice(0, 4).join(" | ")).join(" ;; ") || "אין כרטיס 7"}. אצל ליאור: ${(next.lior.cards || []).filter((c) => / 7א? · /.test(c)).length} כרטיסים של 7`, next }, reminders: fmtLog(rows) });
}
// 7: Irit checks the 7 points and sends to the client.
await proto(sim, { id: "p07-review", step: "עירית בודקת את 9 הגרפיקות (7 בדיקות) ושולחת ללקוחה", proc: "p07", role: "irit", wait: 10,
  keys: ["p07.r.spelling", "p07.r.phone", "p07.r.address", "p07.r.logo", "p07.r.details", "p07.r.wording", "p07.r.design", "p07.sent"], peek: ["lior", "ilai"], next: ["lior"] });
// The status page (protocol v8): the step is the card 7א of her list; the client approves there.
{
  sim.advance(2);
  const res = await linkCard(sim, "irit", "p07a", { shot: "p07a-status-link-card" });
  sim.advance(1);
  const rows = await sim.tick();
  const after = await sim.mine("irit");
  sim.rec({ id: "status-link", step: "עירית שולחת ללקוחה את הקישור לדף הסטטוס, מהכרטיס 7א ב״המשימות שלי״", proc: "p07a", role: "irit",
    before: { where: { "p07a.sent": res.found ? `הכרטיס: ${res.card}` : "לא מופיע" }, shot: res.shot },
    act: `הכרטיס 7א: ״העתקת הקישור״ (מה נאמר: ${res.said}; מה הועתק: ${res.copied}), ואז ״סיימתי״`, taps: res.taps,
    after: { said: res.said, check: `p07a.sent=${sim.checkOf("p07a.sent")?.state || "-"}; קישורי דף סטטוס: ${sim.db.client_status_links.length}`, left: cardsOf(after, "p07a").flatMap((c) => c.items.map((i) => i.label)) },
    reminders: fmtLog(rows), errors: res.errors.length ? res.errors : undefined });
}
await clientApproves(sim, { id: "p07-approved", step: "הלקוחה מאשרת את 9 הגרפיקות בדף המצב", proc: "p07→p07b", key: "p07.approved", wait: 35, next: ["ilai", "irit"], shot: "status-graphics" });
// 7ב: Ilai uploads the approved graphics to the networks (30 office minutes).
await proto(sim, { id: "p07b", step: "עילאי מעלה את 9 הגרפיקות שאושרו לרשתות", proc: "p07b", role: "ilai", shot: "p07b-upload", wait: 12, keys: ["p07b.posted"], peek: ["irit"], next: [] });
// '
// '
// 11: Irit sets the shoot day, a day late. The date is a field of the client card.
{
  await sim.until(IL(2026, 10, 13, 11, 30));
  const before = await sim.mine("irit", { shot: "p11-shoot-day-late" });
  // First, as before the fix: everything that can be ticked, with no date. Does the card leave?
  const blind = await markMine(sim, "irit", ["p11.influencers", "p11.ok.client", "p11.ok.influencers", "p11.ok.lior", "p11.ok.photographer", "p11.calendar"]);
  const stays = cardsOf(await sim.mine("irit"), "p11").map((c) => `${c.group} · ${c.when || "-"}${c.need ? ` · חסר: ${c.need}` : ""} · ${c.items.length} פריטים`).join(" | ") || "הכרטיס ירד מהרשימה";
  sim.rec({ id: "p11-nodate", step: "עירית מסמנת את כל מה שאפשר בתהליך 11 בלי לקבוע תאריך", proc: "p11", role: "irit",
    before: { ...brief(before), shot: before.shot },
    act: `הגלולה "סיימתי" על כל פריט שמוצג: ${JSON.stringify(blind.out)}`, taps: blind.taps,
    after: { result: `הכרטיס אחרי: ${stays}; תהליך 11 ${sim.state().states.find((s) => s.proc.id === "p11").complete ? "נסגר" : "נשאר פתוח"}; shoot_at=${sim.client().shoot_at || "ריק"}` }, reminders: fmtLog(await sim.tick()) });
  // Then the date, from the card's own button (the dialog).
  const { page, ctx } = await sim.open("irit");
  let taps = 0;
  const card = page.locator(`#mine-list .wproc[data-key="${cid}:p11"]`);
  const go = (await card.locator("a.ik-go, a.wc-go").allInnerTexts()).join(", ");
  const need = (await card.locator(".wneed").innerText().catch(() => "")).replace(/\s+/g, " ");
  await card.locator(".wneed button").click(); taps += 1;
  await page.waitForSelector("#dlg-shoot[open]");
  await settle(page, 600);
  const dlg = { type: await page.locator("#shoot-type").inputValue(), free: (await page.locator("#shoot-free").innerText().catch(() => "")).replace(/\s+/g, " "), chips: await page.locator("#shoot-oks .chip").evaluateAll((els) => els.map((e) => `${e.textContent.trim()}${e.getAttribute("aria-pressed") === "true" ? " ✓" : ""}`)) };
  await page.fill("#shoot-at", "2026-10-20T10:00"); taps += 1;
  await settle(page, 500);
  dlg.hint = (await page.locator("#shoot-avail").innerText().catch(() => "")).replace(/\s+/g, " ");
  const dshot = await shotOf(sim, page, "irit", "p11-shoot-dialog");
  await page.click("#shoot-submit"); taps += 1;
  await settle(page, 700);
  // A date against the usual order, or a day the photographer did not mark: the reason dialog.
  if (await page.locator("#dlg-shoot-day[open]").count()) {
    dlg.asked = (await page.locator("#dlg-shoot-day").innerText()).replace(/\s+/g, " ").slice(0, 300);
    await page.fill("#av-reason", "תואם עם הלקוחה והמשפיענים"); taps += 1;
    await page.click("#av-reason-ok"); taps += 1;
    await settle(page, 700);
  }
  dlg.said = (await page.locator("#toast").innerText().catch(() => "")).replace(/\s+/g, " ");
  await ctx.close();
  const res = await markMine(sim, "irit", ["p11.calendar"]);
  sim.advance(2);
  const rows = await sim.tick();
  const after = await sim.mine("irit");
  const next = {};
  for (const r of ["lior", "eli", "ofir"]) next[r] = brief(await sim.mine(r, { shot: r === "eli" ? "shoot-set-eli" : null }));
  sim.rec({ id: "p11", step: "עירית קובעת את יום הצילום (באיחור של יום) ומסמנת את האישורים", proc: "p11", role: "irit",
    before: { where: { "p11.calendar": `הכרטיס: ${need}` }, shot: dshot, note: `קיצור הדרך שנשאר בכרטיס: ${go}. בחלון: עם מי מצלמים=${dlg.type}; ימים פנויים של הצלם: ${dlg.free || "לא מוצגים (הצלם לא מסר זמינות)"}; מתחת לתאריך: ${dlg.hint || "-"}; מי אישר: ${dlg.chips.join(", ")}${dlg.asked ? `; נשאל: ${dlg.asked}` : ""}` },
    act: `הכרטיס 11: ״קביעת יום צילום״ -> תאריך ושעה (20.10 10:00) -> ״שמירת המועד״${dlg.asked ? " -> סיבה -> ״לקבוע בכל זאת״" : ""}; ואז ״הוכנס ליומן של כולם״: ${JSON.stringify(res.out)}`, taps: taps + res.taps,
    after: { said: dlg.said, result: `shoot_at=${sim.client().shoot_at}; תהליך 11 ${sim.state().states.find((s) => s.proc.id === "p11").complete ? "נסגר" : "פתוח"}`, ...brief(after), next }, reminders: fmtLog(rows) });
}
// 14 (protocol v8): Tuesday's follow-up.
await followUp(sim, { id: "fu-tue", step: "עירית: המעקב היומי לפני צילום, יום ג׳" });
sim.save();
await sim.stop();
// '
