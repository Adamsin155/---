// '
// Stage 3b, Monday 12.10.2026 after the characterization: the logins form of the client (5),
// Ilai checks the access and opens the Gantt (6, 9), Ofir prepares the Highlights (8, 8ב), Lior and Meta (10).
// Ilai does NOT prepare the 9 graphics today (the deliberate delay of Ilai). Run: node tests/sim/stage3b.mjs
import { Sim, IL, fmtLog, settle } from "./lib.mjs";
import { brief, proto, cardsOf, shotOf, letPass, markMine } from "./steps.mjs";

const sim = await Sim.start("s3b", "s3");
const cid = sim.client().id;

// 5: Irit sends the client the link to the logins form (Ofir took only Instagram in the meeting).
{
  await sim.until(IL(2026, 10, 12, 12, 15));
  const before = await sim.mine("irit", { shot: "p05-access-link" });
  const { page, ctx } = await sim.open("irit", `client.html?id=${cid}#access-h`);
  await page.waitForSelector("#al-create");
  const linkBox = (await page.locator("#access-link").innerText()).replace(/\s+/g, " ");
  await page.click("#al-create");
  await page.waitForSelector("#al-copy-msg");
  const after1 = (await page.locator("#access-link").innerText()).replace(/\s+/g, " ").slice(0, 300);
  await ctx.close();
  const link = sim.db.client_access_links.at(-1);
  const rows = await sim.tick();
  sim.rec({ id: "p05-link", step: "עירית יוצרת ללקוחה קישור לטופס פרטי הכניסה לרשתות", proc: "p05", role: "irit",
    before: { ...brief(before), shot: before.shot, note: "אין ב״המשימות שלי״ של עירית שום כרטיס שאומר לשלוח את הקישור: תהליך 5 סומן כבוצע כשאופיר הכניס גישה אחת (אינסטגרם)", linkBox },
    act: "כרטיס הלקוח -> ״גישות לרשתות״ -> ״יצירת קישור״ (ואז העתקת ההודעה ללקוח ושליחה ב־WhatsApp, מחוץ למערכת)", taps: 3,
    after: { linkBox: after1, link: { created_by: link.created_by, expires_at: link.expires_at } }, reminders: fmtLog(rows) });
}
// 5: the client fills the form on her phone, 40 minutes later.
{
  await sim.until(IL(2026, 10, 12, 12, 55));
  const token = sim.secrets.access[sim.db.client_access_links.at(-1).id];
  const { page, ctx } = await sim.open(null, `access.html#t=${token}`);
  await page.waitForSelector("#page:not([hidden])");
  const head = (await page.locator("#page h1").first().innerText()).replace(/\s+/g, " ");
  await page.locator("label.schoice:has(#instagram-choice-have)").click();
  await page.fill("#instagram-username", "hadekel.bakery");
  await page.fill("#instagram-password", "Secret-123");
  await page.locator("label.schoice:has(#facebook-choice-have)").click();
  await page.fill("#facebook-username", "ronit@hadekel.example");
  await page.fill("#facebook-password", "Fb-Secret-9");
  await page.locator("label.schoice:has(#tiktok-choice-none)").click();
  await page.fill("#notes", "קוד האימות מגיע לטלפון של רונית");
  const shot = await shotOf(sim, page, "client", "access-form");
  await page.click("#next");
  await page.waitForSelector("#confirm:not([hidden])");
  await page.click("#send");
  await page.waitForSelector("#thanks:not([hidden])");
  const thanks = (await page.locator("#thanks").innerText()).replace(/\s+/g, " ");
  await ctx.close();
  const rows = await sim.tick();
  const next = {};
  for (const r of ["ilai", "irit", "lior"]) next[r] = brief(await sim.mine(r, { shot: r === "ilai" ? "access-arrived-ilai" : null }));
  sim.rec({ id: "p05-form", step: "הלקוחה ממלאת את טופס פרטי הכניסה בקישור הציבורי", proc: "p05→p06", role: "client",
    before: { head, shot }, act: "access.html: אינסטגרם ופייסבוק (יש: משתמש וסיסמה), טיקטוק (אין כיום, צריך לפתוח), הערה, ״המשך״, ״שליחה״", taps: 10,
    after: { thanks, access: sim.db.client_access.map((a) => `${a.network}:${a.status}:${a.updated_by}`), tasks: sim.db.client_tasks.filter((t) => !t.done_at).map((t) => `${t.owner}: ${t.title}${t.urgent ? " (דחוף)" : ""}`), next }, reminders: fmtLog(rows) });
}
// 9: Ilai opens the Gantt skeleton (5 minutes from the end of the meeting: it is 12:58, an hour and a half late).
await proto(sim, { id: "p09", step: "עילאי פותח את גאנט התוכן (המבנה)", proc: "p09", role: "ilai", shot: "p09-gantt", wait: 3,
  keys: ["p09.file", "p09.c.name", "p09.c.months", "p09.c.num", "p09.c.link", "p09.c.day", "p09.c.date", "p09.c.time"], peek: ["irit", "ofir"], next: [] });
// 6: Ilai checks the logins and tidies the pages.
await proto(sim, { id: "p06", step: "עילאי בודק את הגישות ומסדר את הרשתות", proc: "p06", role: "ilai", shot: "p06-access", wait: 20,
  keys: ["p06.verified", "p06.name", "p06.bio", "p06.details", "p06.phone", "p06.address", "p06.look", "p06.metricool"], peek: ["lior"], next: [] });
// 8, 8ב: Ofir prepares the Highlights and uploads them.
await proto(sim, { id: "p08", step: "אופיר מכין את ה־Highlights", proc: "p08", role: "ofir", shot: "p08-highlights", wait: 2, keys: ["p08.done", "p08.saved"], peek: ["irit"], next: [] });
await proto(sim, { id: "p08b", step: "אופיר מעלה את ה־Highlights לעמודי הלקוח", proc: "p08b", role: "ofir", shot: "p08b-upload", wait: 15, keys: ["p08b.posted"], peek: [], next: [] });
// 10: Lior and the Meta infrastructure.
await proto(sim, { id: "p10", step: "ליאור בודק את תשתית Meta ומנהל המודעות", proc: "p10", role: "lior", shot: "p10-meta", wait: 5,
  keys: ["p10.c.business", "p10.c.ads", "p10.c.page", "p10.c.ig", "p10.c.links", "p10.c.perms", "p10.ready"], peek: ["irit"], next: [] });
// 5: the logo. It sits with Ofir (item of process 5, late since the meeting ended) and with Irit (the task the form opened).
await proto(sim, { id: "p05-logo", step: "הלוגו: אצל אופיר (פריט בתהליך 5) ואצל עירית (משימה מטופס האפיון)", proc: "p05", role: "ofir", shot: "p05-logo", wait: 5, keys: ["p05.logo"], peek: ["irit"], next: ["irit"] });
sim.save();
await sim.stop();
// '
