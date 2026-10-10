// '
// Helpers of the scenario: a short form of "המשימות שלי", and the common ways of acting.
import { join } from "node:path";
import { OUT, settle, fmtLog } from "./lib.mjs";

// A snapshot of "המשימות שלי" in a few lines: the cards on top, the counted lines, and
// each card as "group | deadline words | client | title | items".
export function brief(snap) {
  if (!snap) return null;
  return {
    landed: snap.landed,
    top: snap.top || [],
    lines: snap.lines || [],
    cards: (snap.cards || []).filter((c) => !(c.key || "").startsWith("flow:")).map((c) => `[${c.group}] ${c.when || "-"} | ${c.client} | ${c.title || c.text || ""}${c.need ? ` | חסר: ${c.need}` : ""}${c.items?.length ? ` | ${c.items.map((i) => `${i.label}${i.disabled ? " (לא כאן)" : ""}`).join("; ")}` : ""}${c.go?.length ? ` | קישור: ${c.go.join(", ")}` : ""}`),
    empty: snap.empty || null,
    other: snap.other || undefined,
  };
}
// The cards of a snapshot that belong to a process (by its id inside the key "client:pNN").
export const cardsOf = (snap, procId) => (snap.cards || []).filter((c) => (c.key || "").endsWith(`:${procId}`));
export const hasProc = (snap, procId) => cardsOf(snap, procId).length > 0;

export async function shotOf(sim, page, role, name) {
  sim.shots += 1;
  const file = `${String(sim.shots).padStart(2, "0")}-${role}-${name}.png`;
  const height = Math.min(2000, await page.evaluate(() => document.documentElement.scrollHeight));
  await page.screenshot({ path: join(OUT, file), fullPage: true, clip: { x: 0, y: 0, width: 390, height } }).catch(async () => { await page.screenshot({ path: join(OUT, file) }); });
  return file;
}

// Marks items on "המשימות שלי" with the pill, as the role, in the short view (the default):
// a card with one item shows its pill; a card with several opens with "הצגת הפריטים".
// Returns what happened to each key: "done", "disabled: <where it is marked>", "absent".
export async function markMine(sim, role, keys, { gap = 0 } = {}) {
  const { page, ctx } = await sim.open(role);
  const cid = sim.client().id;
  const out = {};
  let taps = 0;
  for (const key of keys) {
    const id = `w-${cid}-${key}`.replace(/[^\w-]/g, "_");
    const box = page.locator(`[id="${id}"]`);
    if (!(await box.count())) { out[key] = "absent"; continue; }
    if (!(await box.isVisible())) {
      const card = box.locator("xpath=ancestor::li[contains(@class,\"wproc\")]");
      // A folded group ("השבוע", "בהמשך") opens first.
      const fold = card.locator("xpath=ancestor::details[not(@open)]");
      if (await fold.count()) { await fold.locator("summary").first().click(); taps += 1; }
      const more = card.locator("xpath=ancestor::*[contains(@class,\"wgroup\")]//button[contains(@class,\"more\")]");
      if (!(await box.isVisible()) && await card.locator("button.wc-open").count()) { await card.locator("button.wc-open").click(); taps += 1; }
      if (!(await box.isVisible()) && await card.locator("button.wc-more").count()) { await card.locator("button.wc-more").click(); taps += 1; }
      if (!(await box.isVisible()) && await more.count()) { await more.first().click(); taps += 1; }
    }
    if (!(await box.isVisible())) { out[key] = "hidden"; continue; }
    if (await box.isDisabled()) { out[key] = `disabled: ${await box.locator("xpath=ancestor::li[contains(@class,\"witem\")]").innerText().then((s) => s.replace(/\s+/g, " ").trim())}`; continue; }
    await box.check();
    taps += 1;
    await settle(page, 350);
    const err = await page.locator(".toast.is-error, #toast, [role=alert]:visible").allInnerTexts().catch(() => []);
    const saved = /^(r\d+\.)?p\d/.test(key) ? sim.done(key) : !!sim.db.client_tasks.find((t) => t.id === key)?.done_at;
    out[key] = saved ? "done" : `not saved${err.length ? `: ${err.join(" ")}` : ""}`;
    if (gap) sim.advance(gap);
  }
  const errors = page.errors.slice();
  await ctx.close();
  return { out, taps, errors };
}
export { fmtLog };
// The cards of Ilai on "המשימות שלי" (his own kind of card: the parts, what is next, the deadlines), as text.
export async function ilaiCard(page, cid) {
  return page.evaluate((id) => [...document.querySelectorAll(".il-card")].filter((c) => (c.dataset.key || "").includes(id)).map((c) => {
    const head = (c.querySelector("summary")?.textContent || "").replace(/\s+/g, " ").trim();
    const parts = [...c.querySelectorAll(".il-part h4")].map((h) => h.textContent.replace(/\s+/g, " ").trim());
    const buttons = [...c.querySelectorAll("button")].map((b) => `${b.textContent.trim()}${b.disabled ? " (נעול)" : ""}`).filter((s) => s.length > 1);
    return `${c.dataset.key.split(":")[0]} | ${head || c.textContent.replace(/\s+/g, " ").trim().slice(0, 200)} | חלקים: ${parts.join("; ")} | כפתורים: ${buttons.join("; ")}`;
  }), cid);
}
// '
// '
// One step of the protocol done from "המשימות שלי" with the pill:
//   before: the list of the role (a phone screenshot), where the items sit, who else sees the process;
//   the act: each key marked with its pill; after: the list again, and the lists of the next roles;
//   the reminders the tick produced on the way.
// opts: { id, step, proc, role, keys, shot, peek: [roles], next: [roles], wait: minutes to let pass first, gap, note }
export async function proto(sim, o) {
  if (o.wait) sim.advance(o.wait);
  const rowsBefore = await sim.tick();
  const beforeSnap = await sim.mine(o.role, { shot: o.shot || null });
  const cid = sim.client().id;
  const idOf = (key) => `w-${cid}-${key}`.replace(/[^\w-]/g, "_");
  const where = {};
  for (const key of o.keys) {
    const card = beforeSnap.cards.find((c) => c.items.some((i) => i.id === idOf(key)));
    where[key] = card ? `${card.group} · ${card.when || "בלי מועד"}${card.items.find((i) => i.id === idOf(key)).disabled ? " · לא מסומן כאן" : ""}` : "לא מופיע";
  }
  const peek = {};
  for (const r of o.peek || []) { const s = await sim.mine(r); peek[r] = cardsOf(s, o.proc).map((c) => `${c.group} · ${c.title} · ${c.items.map((i) => i.label).join("; ")}`); }
  const res = await markMine(sim, o.role, o.keys, { gap: o.gap || 0 });
  sim.advance(1);
  const rows = await sim.tick();
  const afterSnap = await sim.mine(o.role);
  const next = {};
  for (const r of o.next || []) next[r] = brief(await sim.mine(r));
  return sim.rec({ id: o.id, step: o.step, proc: o.proc, role: o.role,
    before: { ...brief(beforeSnap), shot: beforeSnap.shot, where, peek, remindersSinceLast: fmtLog(rowsBefore) },
    act: `הגלולה "סיימתי" ב"המשימות שלי": ${Object.entries(res.out).map(([k, v]) => `${k}=${v}`).join(", ")}`, taps: res.taps,
    after: { ...brief(afterSnap), left: cardsOf(afterSnap, o.proc).flatMap((c) => c.items.map((i) => i.label)), next },
    reminders: fmtLog(rows), note: o.note, errors: res.errors.length ? res.errors : undefined });
}
// 22א (protocol v9): Ofir assigns the editor himself, from the ring's own address: his screen opens on the
// assignment of this client with the suggested editor already chosen, and he presses "שיוך".
export async function assignGo(sim, { shot = null, round = null } = {}) {
  const cid = sim.client().id;
  const { page, ctx } = await sim.open("ofir", `qa.html#assign-${cid}${round ? `-r${round}` : ""}`, { wait: "#dlg-assign[open]" });
  const text = async (sel) => (await page.locator(sel).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  const meta = await text("#as-meta");
  const editors = await page.locator("#as-editors label").evaluateAll((els) => els.map((e) => `${e.querySelector("input").checked ? "(*) " : ""}${e.innerText.replace(/\s+/g, " ").trim()}`));
  const chosen = await page.locator("#as-editors input:checked").getAttribute("value").catch(() => null);
  const file = shot ? await shotOf(sim, page, "ofir", shot) : null;
  await page.click("#as-submit");
  await settle(page, 900);
  const said = await page.evaluate(() => [...document.querySelectorAll("#toast, .toast, #handoff")].map((e) => e.innerText).join(" | ").replace(/\s+/g, " ").slice(0, 300));
  await ctx.close();
  return { meta, editors, chosen, shot: file, said, taps: 2 };
}
// Lets time pass with nobody acting and returns what the reminders did: the delay experiments.
export async function letPass(sim, to, { id, step, proc, role, watch = [], note }) {
  const rows = await sim.until(to, { step: 1 });
  const snaps = {};
  for (const r of watch) snaps[r] = brief(await sim.mine(r, { shot: r === role ? `late-${id}` : null }));
  return sim.rec({ id, step, proc, role, before: {}, act: "אף אחד לא עושה כלום; השעון מתקדם", taps: 0, after: { mine: snaps }, reminders: fmtLog(rows), note });
}
// '
// '
// The client on the public status page (a phone, nobody signed in): approves an item, or asks for a fix.
// opts: { id, step, proc, key, wait, next: [roles], shot, fix: "the note" (a fix request instead of an approval) }
export async function clientApproves(sim, o) {
  if (o.wait) sim.advance(o.wait);
  const waiting = await sim.tick();
  const link = sim.db.client_status_links.find((l) => !l.revoked_at);
  const token = sim.secrets.status[link.id];
  const { page, ctx } = await sim.open(null, `status.html#t=${token}`);
  await page.waitForSelector("#page:not([hidden])");
  await settle(page, 500);
  const dom = o.key.replace(/[^a-z0-9]/gi, "-");
  const needs = (await page.locator("#needs").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
  const station = (await page.locator("#stations li[aria-current=step]").innerText().catch(() => "")).replace(/\s+/g, " ");
  const shot = o.shot ? await shotOf(sim, page, "client", o.shot) : null;
  let result;
  const has = await page.locator(`[id="n-${dom}"]`).count();
  if (!has) result = "הפריט לא מוצג בדף המצב";
  else {
    await page.fill(`[id="n-${dom}"]`, "רונית דקל");
    if (o.fix) { await page.fill(`[id="f-${dom}"]`, o.fix); await page.click(`[id="fx-${dom}"]`); }
    else await page.click(`[id="ok-${dom}"]`);
    await page.waitForFunction(() => !document.getElementById("receipt")?.hidden, null, { timeout: 8000 }).catch(() => null);
    result = (await page.locator("#receipt").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300) || "אין קבלה";
  }
  await ctx.close();
  sim.advance(1);
  const rows = await sim.tick();
  const next = {};
  for (const r of o.next || []) next[r] = brief(await sim.mine(r, { shot: o.nextShot === r ? `after-${o.id}` : null }));
  return sim.rec({ id: o.id, step: o.step, proc: o.proc, role: "client",
    before: { station, needs, shot, remindersSinceLast: fmtLog(waiting) },
    act: o.fix ? `דף המצב (קישור ציבורי): שם, הערת תיקון, הכפתור של בקשת תיקון` : "דף המצב (קישור ציבורי): שם, הכפתור של האישור", taps: o.fix ? 3 : 2,
    after: { result, check: `${o.key}=${sim.checkOf(o.key)?.state || "-"}${sim.checkOf(o.key)?.note ? ` (${sim.checkOf(o.key).note})` : ""}`, tasks: sim.db.client_tasks.filter((t) => !t.done_at).map((t) => `${t.owner}: ${t.title} (עד ${t.due_on || "-"})`), next },
    reminders: fmtLog(rows) });
}
// '
// '
// The editor on editor.html: the one button of the card of the client ("קיבלתי כונן", "מוכן לבדיקה",
// "סמן הכול תוקן", the final hand-off). A dialog that opens is filled as an editor would: every box
// checked, the Drive link pasted, its own button pressed. Returns what was on the screen.
export async function editorGo(sim, role, { link = null, shot = null } = {}) {
  const cid = sim.client().id;
  const { page, ctx } = await sim.open(role, "editor.html");
  await page.waitForSelector(`[id="c-${cid}"]`, { timeout: 8000 }).catch(() => null);
  await settle(page, 400);
  const card = page.locator(`[id="c-${cid}"]`);
  const out = { card: (await card.innerText().catch(() => "(אין כרטיס)")).replace(/\s+/g, " ").slice(0, 600), taps: 0 };
  if (shot) out.shot = await shotOf(sim, page, role, shot);
  // The one button of the card; after a return for fixes it is "סמן הכול תוקן".
  const main = page.locator(`[id="c-${cid}-go"]`);
  const go = (await main.count()) ? main : page.locator("button.fix-all").first();
  if (!(await go.count())) { out.result = "אין כפתור בכרטיס"; await ctx.close(); return out; }
  out.button = (await go.innerText()).trim();
  if (await go.isDisabled()) { out.result = `הכפתור נעול: ${(await page.locator(`[id="c-${cid}-lock"]`).innerText().catch(() => "")).replace(/\s+/g, " ")}`; await ctx.close(); return out; }
  await go.click(); out.taps += 1;
  await settle(page, 500);
  const dlg = page.locator("dialog[open]").first();
  if (await dlg.count()) {
    out.dialog = (await dlg.innerText()).replace(/\s+/g, " ").slice(0, 500);
    if (link && await dlg.locator("#ready-link").count()) { await dlg.locator("#ready-link").fill(link); out.taps += 1; }
    for (const box of await dlg.locator("input[type=checkbox]:not(:disabled)").all()) { if (!(await box.isChecked())) { await box.check(); out.taps += 1; } }
    for (const t of await dlg.locator("textarea:visible").all()) { if (!(await t.inputValue())) { await t.fill("בוצע"); out.taps += 1; } }
    const submit = dlg.locator("button[type=submit], button.btn-primary").first();
    out.submit = (await submit.innerText().catch(() => "")).trim();
    await submit.click(); out.taps += 1;
    await settle(page, 800);
  }
  out.said = await page.evaluate(() => [...document.querySelectorAll("#handoff, .toast, dialog[open] .err, dialog[open] [role=alert]")].map((e) => e.innerText).join(" | ").replace(/\s+/g, " ").slice(0, 300));
  out.cardAfter = (await card.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
  out.errors = page.errors.slice();
  await ctx.close();
  return out;
}
// Ofir on qa.html: opens the quality control of the client, and approves or returns it with fixes.
export async function ofirQa(sim, { fixes = null, shot = null } = {}) {
  const { page, ctx } = await sim.open("ofir", "qa.html#qa-h");
  await page.waitForSelector("#qa-list", { timeout: 8000 }).catch(() => null);
  await settle(page, 500);
  const out = { queue: (await page.locator("#qa-list").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500), taps: 0 };
  if (shot) out.shot = await shotOf(sim, page, "ofir", shot);
  const open = page.locator("#qa-list .of-card button").first();
  if (!(await open.count())) { out.result = "התור ריק"; await ctx.close(); return out; }
  out.button = (await open.innerText()).trim();
  await open.click(); out.taps += 1;
  await page.waitForSelector("#dlg-qa[open]");
  await settle(page, 400);
  out.dialog = (await page.locator("#dlg-qa").innerText()).replace(/\s+/g, " ").slice(0, 600);
  if (fixes) {
    await page.click("#qa-to-return"); out.taps += 1;
    for (let i = 0; i < fixes.length; i += 1) {
      if (i > 0) { await page.click("#qa-add"); out.taps += 1; }
      await page.fill(`#qa-ref-${i + 1}`, fixes[i][0]);
      await page.fill(`#qa-text-${i + 1}`, fixes[i][1]); out.taps += 2;
    }
    await page.click("#qa-send-return"); out.taps += 1;
  } else {
    // Every check of the list, one by one (the list is drawn again after each mark).
    for (let i = 0; i < 14; i += 1) {
      const open = page.locator("#dlg-qa input[type=checkbox]:not(:checked):not(:disabled)").first();
      if (!(await open.count())) break;
      await open.check(); out.taps += 1;
      await settle(page, 250);
    }
    out.checks = (await page.locator("#qa-checks-box").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    await page.click("#qa-approve"); out.taps += 1;
  }
  await settle(page, 800);
  out.said = await page.evaluate(() => [...document.querySelectorAll("#handoff, .toast, dialog[open] .err")].map((e) => e.innerText).join(" | ").replace(/\s+/g, " ").slice(0, 300));
  out.errors = page.errors.slice();
  await ctx.close();
  return out;
}
// '

// '
// Protocol v10 (docs/ops.md, section 58).
// 29ב: Ilai's final check, from his card on "המשימות שלי": the list opens, "סימון הכול" ticks the 13 points, and
// the pill that is left is "העבודה שלי על הלקוח הושלמה". o: { id, step, wait, shot }
export async function finalCheck(sim, o) {
  if (o.wait) sim.advance(o.wait);
  const rowsBefore = await sim.tick();
  const cid = sim.client().id;
  const { page, ctx } = await sim.open("ilai");
  await unfold(page);
  const card = page.locator(`#mine-list .wproc[data-key="${cid}:p29b"]`);
  const out = { found: (await card.count()) > 0, taps: 0 };
  let shot = null;
  if (out.found) {
    out.card = (await card.innerText()).replace(/\s+/g, " ").trim();
    if (o.shot) shot = await shotOf(sim, page, "ilai", o.shot);
    await card.locator("button.wc-open").click(); out.taps += 1;
    out.items = await card.locator(".wlist .witem").count();
    out.bulk = (await card.locator(".bulk-btn").innerText().catch(() => "")).trim();
    await card.locator(".bulk-btn").click(); out.taps += 1;
    await settle(page, 700);
    out.left = (await card.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const pill = card.locator("input.cbx.fin").first();
    if (await pill.count()) { await pill.check(); out.taps += 1; await settle(page, 600); }
  }
  const errors = page.errors.slice();
  await ctx.close();
  sim.advance(1);
  const rows = await sim.tick();
  const s = sim.state().states.find((x) => x.proc.id === "p29b");
  return sim.rec({ id: o.id, step: o.step, proc: "p29b", role: "ilai",
    before: { where: { "p29b": out.found ? `הכרטיס: ${out.card}` : "לא מופיע" }, shot, remindersSinceLast: fmtLog(rowsBefore) },
    act: `הכרטיס 29ב: ״הצגת הפריטים״ (${out.items || 0}) -> ״${out.bulk || "-"}״ -> מה שנשאר: ${out.left || "-"} -> הגלולה`, taps: out.taps,
    after: { result: `תהליך 29ב ${s?.complete ? "הושלם" : "פתוח"}; p29b.done=${sim.checkOf("p29b.done")?.state || "-"}`, next: { irit: brief(await sim.mine("irit")), ilai: brief(await sim.mine("ilai")) } },
    reminders: fmtLog(rows), errors: errors.length ? errors : undefined });
}
// Protocol v8 (docs/ops.md, section 49).
const one = (s) => String(s || "").replace(/\s+/g, " ").trim();
// Everything of the list on the screen: the folded groups opened, "הצג עוד" pressed.
export async function unfold(page) {
  await page.evaluate(() => { for (const d of document.querySelectorAll("#mine-list details")) d.open = true; });
  for (let i = 0; i < 10 && await page.locator("#mine-list .more-btn:visible").count(); i += 1) await page.locator("#mine-list .more-btn:visible").first().click();
}
// Irit's card of a link to send the client (5ב, 7א): "העתקת הקישור", then "סיימתי".
export async function linkCard(sim, role, proc, { shot = null } = {}) {
  const { page, ctx } = await sim.open(role);
  const cid = sim.client().id;
  await unfold(page);
  const card = page.locator(`#mine-list .wproc[data-key="${cid}:${proc}"]`);
  const out = { found: (await card.count()) > 0, taps: 0 };
  if (out.found) {
    out.card = one(await card.innerText());
    if (shot) out.shot = await shotOf(sim, page, role, shot);
    const btn = card.locator(".wlink button");
    if (await btn.count()) {
      await btn.click(); out.taps += 1;
      await settle(page, 700);
      out.said = one(await page.locator("#toast").innerText().catch(() => ""));
      out.copied = one(await page.evaluate(() => navigator.clipboard.readText()).catch(() => "(הלוח לא נקרא)")).replace(/#t=[^ ]+/, "#t=…");
    } else out.said = "אין כפתור העתקת הקישור בכרטיס";
    const pill = card.locator(".cbx").first();
    if (await pill.count()) { await pill.check(); out.taps += 1; await settle(page, 500); }
  }
  out.errors = page.errors.slice();
  await ctx.close();
  return out;
}
// The daily follow-up before the shoot day (14): the counted line of Irit, then the row of the client.
// o: { id, step, stuck: null | { topic, note }, shot, note }
export async function followUp(sim, o) {
  const rowsBefore = await sim.tick();
  const cid = sim.client().id;
  const { page, ctx } = await sim.open("irit");
  await unfold(page);
  const line = page.locator('#mine-list a[href="prep.html#followup"]');
  const cardsOf14 = await page.locator(`#mine-list .wproc[data-key="${cid}:p14"]`).count();
  let taps = 0; let lineText = "אין שורה של המעקב ברשימה"; let header = ""; let rowBefore = ""; let rowAfter = ""; let said = ""; let shot = null;
  if (await line.count()) {
    lineText = one(await line.innerText());
    if (o.shot) shot = await shotOf(sim, page, "irit", o.shot);
    await line.click(); taps += 1;
    await page.waitForSelector("#followup:not([hidden]) .pp-follow-row", { timeout: 10000 }).catch(() => null);
    await settle(page, 500);
    header = one(await page.locator("#fu-h").innerText().catch(() => ""));
    const row = page.locator(`[id="fu-${cid}-1"]`);
    rowBefore = one(await row.innerText().catch(() => "(אין שורה ללקוח)"));
    if (o.stuck) {
      await page.locator(`[id="fu-${cid}-1-stuck"]`).click(); taps += 1;
      await page.locator(`[id="fu-${cid}-1-t-${o.stuck.topic}"]`).click(); taps += 1;
      await page.locator(`[id="fu-${cid}-1-note"]`).fill(o.stuck.note); taps += 1;
      if (o.shot) await shotOf(sim, page, "irit", `${o.shot}-stuck`);
      await page.locator(`[id="fu-${cid}-1-save"]`).click(); taps += 1;
    } else if (await page.locator(`[id="fu-${cid}-1-ok"]`).count()) { await page.locator(`[id="fu-${cid}-1-ok"]`).click(); taps += 1; }
    await settle(page, 700);
    said = one(await page.locator("#toast").innerText().catch(() => ""));
    rowAfter = one(await page.locator(`[id="fu-${cid}-1"]`).innerText().catch(() => ""));
  }
  const errors = page.errors.slice();
  await ctx.close();
  sim.advance(1);
  const rows = await sim.tick();
  const after = await sim.mine("irit");
  const next = o.stuck ? { lior: brief(await sim.mine("lior")) } : {};
  const day = sim.checkOf("p14.day");
  return sim.rec({ id: o.id, step: o.step, proc: "p14", role: "irit",
    before: { note: `השורה ברשימה: ״${lineText}״. כרטיסים של תהליך 14 ברשימה: ${cardsOf14}. בעמוד: ״${header}״; השורה של הלקוחה: ${rowBefore}${o.note ? `. ${o.note}` : ""}`, shot, remindersSinceLast: fmtLog(rowsBefore) },
    act: o.stuck ? `השורה ״מעקב לפני צילום״ -> ״משהו תקוע״ -> הנושא (${o.stuck.topic}) -> כמה מילים -> ״שמירה והודעה לליאור״` : "השורה ״מעקב לפני צילום״ -> ״הכול תקין״", taps,
    after: { said, result: `השורה אחרי: ${rowAfter}`, check: `p14.day=${day?.state || "-"} ${day?.note || ""}`, tasks: sim.db.client_tasks.filter((t) => !t.done_at).map((t) => `${t.owner}: ${t.title} (עד ${t.due_on || "-"})`),
      counted: [`השורות של עירית אחרי: ${(after.lines || []).join(" ; ") || "אין"}`], next },
    reminders: fmtLog(rows), errors: errors.length ? errors : undefined });
}
// What a role sees of the follow-up on a day when it is not asked (a weekend, the shoot day).
export async function followLine(sim) {
  const s = await sim.mine("irit");
  return (s.lines || []).filter((l) => /מעקב לפני צילום/.test(l)).join(" ; ") || "אין שורה";
}
// '
