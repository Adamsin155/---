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
    cards: (snap.cards || []).filter((c) => !(c.key || "").startsWith("flow:")).map((c) => `[${c.group}] ${c.when || "-"} | ${c.client} | ${c.title || c.text || ""}${c.items?.length ? ` | ${c.items.map((i) => `${i.label}${i.disabled ? " (לא כאן)" : ""}`).join("; ")}` : ""}${c.go?.length ? ` | קישור: ${c.go.join(", ")}` : ""}`),
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
    const err = await page.locator(".toast.is-error, #toast.is-error, [role=alert]").allInnerTexts().catch(() => []);
    out[key] = sim.done(key) ? "done" : `not saved${err.length ? `: ${err.join(" ")}` : ""}`;
    if (gap) sim.advance(gap);
  }
  const errors = page.errors.slice();
  await ctx.close();
  return { out, taps, errors };
}
export { fmtLog };
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
// Lets time pass with nobody acting and returns what the reminders did: the delay experiments.
export async function letPass(sim, to, { id, step, proc, role, watch = [], note }) {
  const rows = await sim.until(to, { step: 1 });
  const snaps = {};
  for (const r of watch) snaps[r] = brief(await sim.mine(r, { shot: r === role ? `late-${id}` : null }));
  return sim.rec({ id, step, proc, role, before: {}, act: "אף אחד לא עושה כלום; השעון מתקדם", taps: 0, after: { mine: snaps }, reminders: fmtLog(rows), note });
}
// '
