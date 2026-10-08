// '
// Stage 1: the deal from the field, the agreement, the signature of the client. The client opens.
// Sunday 11.10.2026, 09:05 in Israel. Run: node tests/sim/stage1.mjs
import { Sim, IL, fmtLog, settle, scrapeControls } from "./lib.mjs";
import { brief, shotOf } from "./steps.mjs";

const sim = await Sim.start("s1");
// The office opens: the morning digests go out before anything happens.
sim.now = IL(2026, 10, 11, 8, 20);
sim.lastTick = IL(2026, 10, 11, 8, 19);
await sim.until(IL(2026, 10, 11, 9, 5));
sim.save("s0");

// 1. Stav fills the new deal and sends it to Irit.
{
  const { page, ctx } = await sim.open("stav", "clients.html");
  await page.waitForURL(/deal\.html/);
  await page.waitForSelector("#deal-form:not([hidden])");
  const stavShot = await shotOf(sim, page, "stav", "deal-page");
  await page.fill("#d-business", "מאפיית הדקל");
  await page.fill("#d-contact", "רונית דקל");
  await page.fill("#d-phone", "050-5550142");
  await page.check("#d-influencer-simeon").catch(() => null);
  await page.check("#d-tier-social");
  const controls = await page.evaluate(scrapeControls);
  await page.fill("#d-notes", "לקוחה חדשה, רוצה להתחיל מהר. זמינה בבקרים.");
  await page.click("#d-submit");
  await page.waitForFunction(() => document.querySelectorAll("#deal-list .deal-item").length === 1);
  const list = await page.locator("#deal-list .deal-item").allInnerTexts();
  await ctx.close();
  const deal = sim.db.deal_requests[0];
  const rows = await sim.tick();
  sim.rec({ id: "deal", step: "סתיו שולח עסקה חדשה לעירית", proc: "לפני 1", role: "stav",
    before: { landed: "deal.html (clients.html מפנה אותו לשם)", inputs: controls.inputs.length, shot: stavShot },
    act: "deal.html: שם עסק, איש קשר, טלפון, משפיען, חבילה, הערות, ואז הכפתור של השליחה", taps: 7,
    after: { list, deal: { status: deal.status, tier: deal.tier, influencer: deal.influencer } }, reminders: fmtLog(rows) });
}
// 2. Irit: the deal on "המשימות שלי".
{
  sim.advance(2);
  const before = await sim.mine("irit", { shot: "deal-arrived" });
  const others = { ofir: brief(await sim.mine("ofir")), lior: brief(await sim.mine("lior")), ilai: brief(await sim.mine("ilai")) };
  const { page, ctx } = await sim.open("irit");
  const href = await page.locator(".deal-task a.btn").first().getAttribute("href");
  const cardText = await page.locator(".deal-task").first().innerText();
  await page.locator(".deal-task a.btn").first().click();
  await page.waitForFunction(() => document.getElementById("c-company")?.value === "מאפיית הדקל");
  const filled = await page.evaluate(() => ({ name: document.getElementById("c-name").value, phone: document.getElementById("c-phone").value, tier: document.querySelector("input[name=tier]:checked")?.value, influencer: document.querySelector("input[name=influencer]:checked")?.value, h1: document.getElementById("page-h1")?.textContent, btn: document.getElementById("btn-link")?.textContent }));
  sim.advance(4);
  await page.click("#btn-link");
  await page.waitForFunction(() => /AST-2026/.test(document.getElementById("sh-number")?.textContent || ""));
  await settle(page, 800);
  const link = await page.locator("#sh-link").inputValue();
  const share = await page.evaluate(scrapeControls);
  await ctx.close();
  sim.secrets.signLink = link;
  const rows = await sim.tick();
  const after = await sim.mine("irit", { shot: "contract-sent-waiting" });
  const stavAfter = await sim.mine("stav");
  sim.rec({ id: "p01-contract", step: "עירית מכינה את החוזה מהעסקה ושולחת קישור לחתימה", proc: "p01", role: "irit",
    before: { ...brief(before), shot: before.shot, others },
    act: `כרטיס העסקה: "${cardText.replace(/\s+/g, " ").slice(0, 200)}" -> ${href}; בבונה: הכול ממולא (${JSON.stringify(filled)}); "${filled.btn}"`, taps: 2,
    after: { ...brief(after), shot: after.shot, deal: sim.db.deal_requests[0].status, link: link.replace(/t=.*/, "t=..."), stav: stavAfter.other }, reminders: fmtLog(rows) });
  sim.save("s1a");
}
// 3. The client signs on the public page.
{
  sim.advance(25);
  const waiting = await sim.tick();
  const iritWaiting = await sim.mine("irit");
  const path = sim.secrets.signLink.replace(/^https?:\/\/[^/]+\//, "");
  const { page, ctx } = await sim.open(null, path);
  await page.waitForSelector("#s-name", { state: "visible" });
  await page.fill("#s-name", "רונית דקל");
  const box = await page.locator("#pad").boundingBox();
  await page.locator("#pad").scrollIntoViewIfNeeded();
  const b2 = await page.locator("#pad").boundingBox();
  await page.mouse.move(b2.x + 40, b2.y + b2.height / 2);
  await page.mouse.down();
  for (let i = 0; i <= 20; i += 1) await page.mouse.move(b2.x + 40 + i * 10, b2.y + b2.height / 2 - Math.sin(i / 3) * 20);
  await page.mouse.up();
  await page.locator("#s-consent").check();
  await page.locator("#s-whatsapp").check().catch(() => null);
  await page.locator("#btn-sign").click();
  await page.locator("#signed").waitFor();
  const signedText = await page.locator("#signed-text").innerText();
  await ctx.close();
  const rows = await sim.tick();
  const c = sim.client();
  sim.rec({ id: "p01-sign", step: "הלקוחה חותמת בדף החתימה הציבורי; הלקוח נפתח במערכת", proc: "p01", role: "client",
    before: { irit: brief(iritWaiting), waitingReminders: fmtLog(waiting) },
    act: "q.html (קישור ציבורי, טלפון): שם, חתימה באצבע, תיבת ההסכמה, כפתור החתימה", taps: 4,
    after: { signedText, client: c ? { name: c.name, business: c.business, package_name: c.package_name, shoot_type: c.shoot_type, contract_end: c.contract_end, deliverables: c.deliverables, characterizer: c.characterizer, has_logo: c.has_logo } : null, deal: sim.db.deal_requests[0].status, p01: ["p01.prepared", "p01.sent", "p01.signed"].map((k) => sim.done(k)) },
    reminders: fmtLog(rows) });
}
sim.save();
await sim.stop();
// '
