// '
// Stage 8, the ongoing work, Thursday 29.10.2026: the daily message, the daily controls, the Thursday summary,
// the weekly call (31); and once each: an exception reported to Lior and decided, a question of the owner
// to an employee and its answer. Run: node tests/sim/stage8.mjs
import { Sim, IL, fmtLog, settle, scrapeControls } from "./lib.mjs";
import { brief, proto, shotOf, markMine } from "./steps.mjs";

const sim = await Sim.start("s8", "s7");
const cid = sim.client().id;
const clip = (s, n = 400) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
// A step done on a page the role opens from a line or a card of "המשימות שלי"; `act` gets the page and returns what it did.
async function onPage(o) {
  if (o.at) await sim.until(o.at);
  await sim.tick();
  const before = await sim.mine(o.role, { shot: o.shot });
  const { page, ctx } = await sim.open(o.role, o.path);
  await settle(page, 500);
  const seen = await page.evaluate(scrapeControls);
  let did = "";
  try { did = await o.act(page); } catch (e) { did = `נכשל: ${String(e.message).split("\n")[0]}`; }
  await settle(page, 600);
  const said = await page.evaluate(() => [...document.querySelectorAll("#handoff, .toast, #toast")].map((e) => e.innerText).join(" | ").replace(/\s+/g, " ").slice(0, 300));
  const errors = page.errors.slice();
  await ctx.close();
  sim.advance(1);
  const rows = await sim.tick();
  const after = await sim.mine(o.role);
  const next = {};
  for (const x of o.next || []) next[x] = brief(await sim.mine(x, { shot: o.nextShot === x ? `after-${o.id}` : null }));
  return sim.rec({ id: o.id, step: o.step, proc: o.proc, role: o.role, before: { ...brief(before), shot: before.shot, page: { h: seen.h, buttons: seen.buttons.filter((b) => !/side-|btn-logout|btn-inbox/.test(b)).slice(0, 14), text: clip(seen.text, 500) } },
    act: `${o.how}: ${did}`, taps: o.taps || 2, after: { said, ...(o.after ? o.after() : {}), ...brief(after), next }, reminders: fmtLog(rows), errors: errors.length ? errors : undefined });
}

// The daily message to the client (Irit, messages.html).
await onPage({ id: "daily-message", at: IL(2026, 10, 29, 9, 40), step: "עירית שולחת את ההודעה היומית ללקוחה", proc: "הודעה יומית", role: "irit", shot: "daily-message", path: "messages.html", how: "השורה הסופרת במשימות שלי -> הודעות ללקוחות",
  act: async (page) => { const b = page.locator(`[id="msg-send-${cid}"]`); const t = clip(await b.innerText()); const text = clip(await page.locator(`[id="msg-text-${cid}"]`).inputValue(), 160); await b.click(); return `נוסח מוכן (${text}); "${t}" (וואטסאפ נחסם בסימולציה)`; },
  after: () => ({ messages: sim.db.client_messages.map((m) => `${m.kind || "-"} ${m.sent_at}`) }) });
// The daily control of Irit (32) and of Ofir (33): the mark on "המשימות שלי".
for (const [role, num] of [["irit", "32"], ["ofir", "33"]]) {
  await onPage({ id: `control${num}`, step: `הבקרה היומית (תהליך ${num})`, proc: num, role, path: "clients.html#mine", how: "הכרטיס בקרה יומית במשימות שלי",
    act: async (page) => { const box = page.locator("#mine-list .rv-card:not(.thu-card) input.cbx").first(); if (!(await box.count())) return "אין תיבה"; if (await box.isDisabled()) return `התיבה נעולה: ${clip(await page.locator("#mine-list .rv-card").first().innerText())}`; await box.check(); return "סומן הבקרה היומית בוצעה"; },
    after: () => ({ reviews: sim.db.office_reviews.map((r) => `${r.kind} ${r.day}`) }) });
}
// The Thursday summary of Ofir (the state of every client).
await onPage({ id: "thursday", at: IL(2026, 10, 29, 11, 0), step: "אופיר: סיכום חמישי, מצב לכל לקוח", proc: "33 (חמישי)", role: "ofir", shot: "thursday-ofir", path: "clients.html#mine", how: "הכרטיס מעבר חובה של יום חמישי",
  act: async (page) => {
    const card = page.locator("#mine-list .thu-card").first();
    const text = clip(await card.innerText().catch(() => "אין כרטיס חמישי"));
    const link = card.locator("a, button").first();
    if (!(await link.count())) return text;
    const label = clip(await link.innerText());
    await link.click();
    await settle(page, 800);
    const areas = page.locator("textarea:visible");
    const n = await areas.count();
    for (let i = 0; i < n; i += 1) await areas.nth(i).fill(["בשוטף, התוכן מתוזמן", "אין חוסרים", "שיחה שבועית ביום חמישי"][i % 3]);
    const save = page.locator("button:visible", { hasText: /שמירה|שמור|סיכום נשמר|שמירת/ }).first();
    const saveText = (await save.count()) ? clip(await save.innerText()) : "(אין כפתור שמירה)";
    if (await save.count()) await save.click();
    return `${text} -> "${label}" -> ${n} שדות טקסט -> "${saveText}" (${page.url().split("/").pop()})`;
  },
  after: () => ({ notes: sim.db.client_status_notes.length }) });
// 31: the weekly call of Lior.
await sim.until(IL(2026, 10, 29, 14, 0));
{
  const before = await sim.mine("lior", { shot: "p31-weekly-call" });
  const card = before.cards.find((c) => (c.key || "").endsWith(":p31"));
  const { page, ctx } = await sim.open("lior");
  const li = page.locator(`#mine-list .wproc[data-key="${cid}:p31"]`);
  const text = clip(await li.innerText().catch(() => "אין כרטיס 31"), 300);
  const html = await li.evaluate((el) => [...el.querySelectorAll("button, a, input")].map((e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""} ${e.textContent.trim() || e.getAttribute("aria-label") || ""}`).join(" ; ")).catch(() => "");
  let did = "לא נמצא פקד";
  const btn = li.locator("button", { hasText: /תיעוד שיחה/ }).first();
  if (await btn.count()) {
    await btn.click(); await settle(page, 600);
    const dlg = page.locator("dialog[open]").first();
    if (await dlg.count()) {
      const fields = await dlg.locator("textarea:visible, input[type=text]:visible").count();
      for (const t of await dlg.locator("textarea:visible").all()) await t.fill("עברנו על הקמפיינים, הלידים והתכנים שעלו. אין בעיות.");
      const submit = dlg.locator("button[type=submit], button.btn-primary").first();
      did = `תיעוד שיחה -> דיאלוג עם ${fields} שדות -> "${clip(await submit.innerText())}"`;
      await submit.click(); await settle(page, 700);
    } else did = "תיעוד שיחה (בלי דיאלוג)";
  }
  await ctx.close();
  if (did === "לא נמצא פקד") { const res = await markMine(sim, "lior", ["p31.call"]); did = `אין כפתור תיעוד שיחה בכרטיס; הגלולה סיימתי: ${JSON.stringify(res.out)} (${res.taps} לחיצות)`; }
  sim.advance(1);
  const rows = await sim.tick();
  const after = await sim.mine("lior");
  sim.rec({ id: "p31", step: "ליאור: שיחת לקוח שבועית ותיעוד שלה", proc: "p31", role: "lior", before: { ...brief(before), shot: before.shot, card: text, controls: html },
    act: did, taps: 3, after: { checks: sim.db.protocol_checks.filter((x) => x.item_key.startsWith("p31")).map((x) => `${x.item_key}=${x.state} ${clip(x.note, 80)}`), tasks: sim.db.client_tasks.filter((t) => !t.done_at).map((t) => `${t.owner}: ${t.title}`), ...brief(after), next: { irit: brief(await sim.mine("irit")) } }, reminders: fmtLog(rows) });
}
sim.save();
await sim.stop();
// '
