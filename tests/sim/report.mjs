// '
// Builds docs/design/full-flow/steps.md (the step table) from the saved records of the run, the reminder
// log and the verdicts of tests/sim/verdicts.mjs. Run: node tests/sim/report.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STATE, OUT, stamp, hhmm } from "./lib.mjs";
import { PROCESSES, PEOPLE } from "../../app/protocol.js";
import { VERDICTS } from "./verdicts.mjs";

const load = (name) => JSON.parse(readFileSync(join(STATE, `${name}.json`), "utf8"));
const main = load("s10");
const NOISE = /^(dailyMessages|control32|control33|availability|availabilityMissing|digest|unconnected)$/;
const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const cut = (s, n) => { const t = cell(s); return t.length > n ? `${t.slice(0, n)}…` : t; };
const who = (p) => (p === "owner" ? "הבעלים" : PEOPLE[p]?.name || p);
// What the protocol says of a process: who, and by when (app/protocol.js, the mirror of docs/protocols).
function protocolOf(proc) {
  const ids = String(proc).match(/p\d+[ab]?/g) || [];
  return ids.map((id) => { const p = PROCESSES.find((x) => x.id === id); if (!p) return null; const owners = typeof p.owners === "function" ? "לפי הלקוח" : p.owners.map(who).join(", "); return `${p.num} ${p.title} (${owners}): ${p.sla}`; }).filter(Boolean).join(" · ");
}
function beforeOf(r) {
  const b = r.before || {};
  const parts = [];
  if (b.where) { const vals = [...new Set(Object.values(b.where))]; parts.push(vals.join(" / ")); }
  else if (b.cards?.length) parts.push(`${b.cards.length} כרטיסים; ראשון: ${cut(b.cards[0], 110)}`);
  else if (b.landed) parts.push(b.empty ? `ריק: ${cut(b.empty, 60)}` : "אין כרטיס");
  if (b.top?.some((t) => t.startsWith("#deals-card"))) parts.push("כרטיס עסקאות חדשות בראש העמוד");
  if (b.peek) { const seen = Object.entries(b.peek).filter(([, v]) => v.length).map(([k]) => who(k)); const not = Object.entries(b.peek).filter(([, v]) => !v.length).map(([k]) => who(k)); if (seen.length) parts.push(`מופיע גם אצל: ${seen.join(", ")}`); if (not.length) parts.push(`לא מופיע אצל: ${not.join(", ")}`); }
  if (b.note) parts.push(b.note);
  if (b.shot) parts.push(`תמונה: ${b.shot}`);
  return parts.join(". ");
}
const procTitles = (cards) => (cards || []).map((c) => (c.match(/\| (\d+[אב]? · [^|·]+)/) || c.match(/\| (משימה \| [^|]+)/) || [])[1]).filter(Boolean).map((t) => t.trim());
function afterOf(r) {
  const a = r.after || {};
  const parts = [];
  if (a.left) parts.push(a.left.length ? `נשאר בכרטיס: ${cut(a.left.join("; "), 90)}` : "ירד מהרשימה");
  for (const k of ["said", "result", "check", "doneText", "toast"]) if (a[k] && cell(a[k]).replace(/[| ]/g, "")) parts.push(cut(a[k], 140));
  if (a.marks) parts.push(cut(a.marks.join(", "), 160));
  if (a.tasks?.length) parts.push(`משימות פתוחות: ${cut(a.tasks.join("; "), 160)}`);
  for (const [role, b] of Object.entries(a.next || {})) { const t = procTitles(b.cards); parts.push(`אצל ${who(role)}: ${t.length ? cut(t.join("; "), 150) : (b.cards?.length ? cut(b.cards[0], 90) : "אין כרטיס של הלקוח")}`); }
  if (a.counted) parts.push(cut(a.counted.join("; "), 700));
  return parts.join(". ");
}
const log = main.db.reminder_log;
function remindersOf(r, prev) {
  const from = prev ? prev.at : "2026-10-11T00:00:00.000Z";
  const rows = log.filter((x) => x.created_at > from && x.created_at <= r.at && !NOISE.test(x.rule));
  if (!rows.length) return "אין שורה";
  const m = new Map();
  for (const x of rows) { const k = `${x.rule}→${who(x.person)} (${x.level}${x.status !== "sent" ? `, ${x.status}` : ""}${x.channel === "digest" ? ", בתקציר" : ""}) ״${cut(x.title, 60)}״`; m.set(k, (m.get(k) || 0) + 1); }
  const list = [...m].map(([k, n]) => (n > 1 ? `${n}× ${k}` : k));
  return list.length > 9 ? `${list.slice(0, 9).join("; ")}; ועוד ${list.length - 9}` : list.join("; ");
}
const lines = ["| # | מתי | תהליך | מי | הצעד | מה אומר הפרוטוקול | לפני: ב״המשימות שלי״ | הפעולה (לחיצות) | אחרי: מה ירד, מה הופיע ולמי | תזכורות שנוצרו עד הצעד | הערכה |", "|---|---|---|---|---|---|---|---|---|---|---|"];
let prev = null;
for (const r of main.records) {
  const v = VERDICTS[r.id] || ["זורם", ""];
  lines.push(`| ${r.n} | ${stamp(r.at)} | ${cell(r.proc)} | ${cell(r.role)} | ${cell(r.step)} | ${cut(protocolOf(r.proc), 260)} | ${cut(beforeOf(r), 330)} | ${cut(r.act, 300)} (${r.taps}) | ${cut(afterOf(r), 560)} | ${cut(remindersOf(r, prev), 620)} | **${v[0]}**${v[1] ? `: ${cell(v[1])}` : ""} |`);
  prev = r;
}
const head = `# הטבלה המלאה של התרחיש: צעד אחרי צעד\n\nנוצר אוטומטית מ־tests/sim/report.mjs, מתוך הרשומות של ההרצה (tests/sim/state/s10.json). ${main.records.length} צעדים, ${log.length} שורות ביומן התזכורות. בעמודת התזכורות לא מופיעות השגרות היומיות (הודעה יומית, בקרות 32 ו־33, זמינות הצלם, תקצירים), אלא אם הצעד עוסק בהן; הן מסוכמות בצעד של החודש השוטף. העמודה סופרת את מה שנוצר מאז הצעד הקודם ועד הצעד הזה.\n\n`;
const nudges = `\n\n## דחיפות נתונים וקפיצות שעון\n\n${(main.nudges || []).map((n) => `- ${hhmm(n.at)}: ${n.what}`).join("\n") || "- לא היו."}\n`;
writeFileSync(join(OUT, "steps.md"), head + lines.join("\n") + nudges);
console.log(`steps.md: ${main.records.length} rows; verdicts: ${Object.keys(VERDICTS).length}; missing ids: ${Object.keys(VERDICTS).filter((k) => !main.records.some((r) => r.id === k)).join(", ") || "none"}`);
// '
