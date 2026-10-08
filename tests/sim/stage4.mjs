// '
// Stage 4, Tuesday 13.10.2026: the 9 graphics (a day late), their review, the approval of the client on
// the status page, the upload (7, 7ב); the shoot day set a day late (11). Run: node tests/sim/stage4.mjs
import { Sim, IL, fmtLog, settle } from "./lib.mjs";
import { brief, proto, markMine, clientApproves } from "./steps.mjs";

const sim = await Sim.start("s4", "s3c");
const cid = sim.client().id;
const png = (n = 2000) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(n)]);

// 7: Ilai uploads the 9 graphics on his card and passes them to Irit (20 hours late).
{
  await sim.until(IL(2026, 10, 13, 9, 45));
  const before = await sim.mine("ilai", { shot: "p07-graphics-late" });
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
    before: { ...brief(before), shot: before.shot },
    act: `הכרטיס שלו: פתיחה, + העלאת גרפיקות (9 קבצים: ${head}), מוכן לבדיקה (לעירית). מה נאמר אחרי הלחיצה: ${said}`, taps,
    after: { made: sim.checkOf("p07.made")?.state || "-", files: sim.db.client_files.filter((f) => !f.deleted_at).length, ...brief(after), next }, reminders: fmtLog(rows) });
}
// 7: Irit checks the 7 points and sends to the client.
await proto(sim, { id: "p07-review", step: "עירית בודקת את 9 הגרפיקות (7 בדיקות) ושולחת ללקוחה", proc: "p07", role: "irit", wait: 10,
  keys: ["p07.r.spelling", "p07.r.phone", "p07.r.address", "p07.r.logo", "p07.r.details", "p07.r.wording", "p07.r.design", "p07.sent"], peek: ["lior", "ilai"], next: ["lior"] });
// The status page: Irit makes the link of the client (once); the client approves there.
{
  sim.advance(2);
  const { page, ctx } = await sim.open("irit", `client.html?id=${cid}#st-h`);
  await page.waitForSelector("#st-create");
  await page.click("#st-create");
  await page.waitForSelector("#st-copy-msg");
  await ctx.close();
  sim.rec({ id: "status-link", step: "עירית יוצרת את קישור דף המצב ללקוחה (פעם אחת)", proc: "p07 (דף המצב)", role: "irit", before: { note: "אין כרטיס במשימות שלי שמבקש ליצור את הקישור; הוא נוצר מכרטיס הלקוח" },
    act: "כרטיס הלקוח -> דף המצב ללקוח -> יצירת קישור -> העתקת ההודעה", taps: 3, after: { links: sim.db.client_status_links.length }, reminders: fmtLog(await sim.tick()) });
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
  const { page, ctx } = await sim.open("irit");
  let taps = 0;
  const card = page.locator(`#mine-list .wproc[data-key="${cid}:p11"]`);
  const go = (await card.locator("a.ik-go, a.wc-go").allInnerTexts()).join(", ");
  await card.locator("a.wclient").click(); taps += 1;
  await page.waitForSelector("#p11");
  const need = await page.evaluate(() => (document.querySelector("#p11 .need")?.innerText || "").replace(/\s+/g, " "));
  await page.locator("#p11 .need button").click(); taps += 1;
  await page.waitForSelector("#dlg-edit[open]");
  await page.fill("#ed-shoot-at", "2026-10-20T10:00"); taps += 1;
  await page.click("#ed-submit"); taps += 1;
  await settle(page, 600);
  await ctx.close();
  const res = await markMine(sim, "irit", ["p11.influencers", "p11.ok.client", "p11.ok.influencers", "p11.ok.lior", "p11.ok.photographer", "p11.calendar"]);
  sim.advance(2);
  const rows = await sim.tick();
  const after = await sim.mine("irit");
  const next = {};
  for (const r of ["lior", "eli", "ofir"]) next[r] = brief(await sim.mine(r, { shot: r === "eli" ? "shoot-set-eli" : null }));
  sim.rec({ id: "p11", step: "עירית קובעת את יום הצילום (באיחור של יום) ומסמנת את האישורים", proc: "p11", role: "irit",
    before: { ...brief(before), shot: before.shot, shortcut: go, need },
    act: `שם הלקוח -> כרטיס הלקוח -> השלמת פרטים בתהליך 11 -> מועד (20.10 10:00) -> שמירה; חזרה למשימות שלי: ${JSON.stringify(res.out)}`, taps: taps + res.taps,
    after: { shoot_at: sim.client().shoot_at, ...brief(after), next }, reminders: fmtLog(rows) });
}
sim.save();
await sim.stop();
// '
