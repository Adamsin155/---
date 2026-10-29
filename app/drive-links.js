// "משיכת קישורים מהדרייב" in the content Gantt (the owner's request of 29.10.2026; docs/ops.md,
// section 74): Ilai names every file he puts in the client's Drive folder starting with its day
// and month ("15.11 רילס מבצע.mp4"; also "15.11.26 …", "15/11", "15-11", "3.1", leading zeros
// optional). One tap reads the folder (the drive function, ../supabase/functions/drive/) and fills
// the link of the Gantt item on that date. The owner's rule: a link already in the Gantt is NEVER
// replaced; only empty items are filled. Plain logic, so node tests it (tests/drive-links.test.mjs).
import { GANTT_KINDS } from './gantt-template.js';

const pad = (n) => String(n).padStart(2, '0');
// The day and month at the start of a file's name, and the year when written (2 or 4 digits):
// { day, month, year|null } or null. "15.11", "15.11.26", "15/11/2026", "15-11", "3.1 ", "15.11_reel".
const LEAD = /^\s*(\d{1,2})\s*[./-]\s*(\d{1,2})(?:\s*[./-]\s*(\d{2}|\d{4}))?(?!\d)/;
export function dateOfName(name) {
  const m = LEAD.exec(String(name ?? ''));
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = m[3] ? Number(m[3]) : null;
  if (year !== null && year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // A day that the month does not have (31.11) is no date.
  const probe = new Date(Date.UTC(year ?? 2024, month - 1, day)); // 2024: 29.2 exists
  if (probe.getUTCMonth() !== month - 1) return null;
  return { day, month, year };
}

// What a file is, for the items of a day: 'video', 'image' or 'other' (by its type, then its name).
export function fileType(f) {
  const m = String(f?.mimeType || '');
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('image/')) return 'image';
  if (/\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(String(f?.name || ''))) return 'video';
  if (/\.(jpe?g|png|gif|webp|heic)$/i.test(String(f?.name || ''))) return 'image';
  return 'other';
}
// Which Gantt kinds a file of that type can be (from the kinds' own file lists).
const TAKES = {
  video: (k) => (GANTT_KINDS[k]?.files || []).some((x) => /video/.test(x)),
  image: (k) => (GANTT_KINDS[k]?.files || []).some((x) => /graphic|image|highlight/.test(x)),
  other: () => true,
};
// The items a link can go on: what is published (not a shoot day, a report, the renewal call).
export const linkable = (row) => !!GANTT_KINDS[row?.kind]?.post;
const hasLink = (row) => !!String(row?.link || '').trim();
const byOrder = (a, b) => String(a.time_il || '').localeCompare(String(b.time_il || '')) || (a.num ?? 0) - (b.num ?? 0) || String(a.id).localeCompare(String(b.id));

// The year of a file that has none: the year of the Gantt's day with that day and month nearest to
// when the file was added (a Gantt runs a year or a little more, so "15.12" and "3.1" find their
// own years; the same day and month twice in one Gantt goes to the one nearest the upload).
function dayKeyFor(d, f, daysOf) {
  const md = `${pad(d.month)}-${pad(d.day)}`;
  if (d.year) return `${d.year}-${md}`;
  const keys = [...daysOf].filter((k) => k.slice(5) === md);
  if (keys.length <= 1) return keys[0] || null;
  const at = Date.parse(f.createdTime || '') || Date.now();
  return keys.sort((a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - at) - Math.abs(Date.parse(`${b}T12:00:00Z`) - at))[0];
}

// The plan: { fills: [{ id, link, file }], already, unplaced: [{ name, why }], empty: [rows] }.
//   fills     an empty item gets this file's link;
//   already   files whose item already had a link (or that link is this file);
//   unplaced  files with no date in the name, no item on their date, or more files than items;
//   empty     items still without a link on the days the folder speaks of, and before `upTo`.
// rows: the Gantt's rows ({ id, kind, day, time_il, num, link }); files: the folder's listing
// ({ name, mimeType, createdTime, link }), folders left out.
export function matchFiles(rows, files, { upTo = null } = {}) {
  const items = (rows || []).filter(linkable);
  const daysOf = new Set(items.map((r) => r.day));
  const known = new Set(items.filter(hasLink).map((r) => String(r.link).trim()));
  const unplaced = [];
  let already = 0;
  const groups = new Map(); // day -> files
  for (const f of files || []) {
    if (!f || f.mimeType === 'application/vnd.google-apps.folder') continue;
    if (f.link && known.has(String(f.link).trim())) { already += 1; continue; }
    const d = dateOfName(f.name);
    if (!d) { unplaced.push({ name: f.name, why: 'אין תאריך בתחילת השם' }); continue; }
    const key = dayKeyFor(d, f, daysOf);
    if (!key || !daysOf.has(key)) { unplaced.push({ name: f.name, why: `אין פריט בגאנט ב־${d.day}.${d.month}` }); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const fills = [];
  const taken = new Set();
  for (const [key, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const dayRows = items.filter((r) => r.day === key).sort(byOrder);
    // Files of one type go to the items of that type, in the day's order, then by name.
    const types = ['video', 'image', 'other'];
    const ofType = Object.fromEntries(types.map((t) => [t, list.filter((f) => fileType(f) === t).sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'))]));
    for (const t of types) {
      for (const f of ofType[t]) {
        // The empty items this file could be, its own type first; any empty item when the day has
        // exactly one empty item left (a PDF for the day's one post).
        let free = dayRows.filter((r) => !hasLink(r) && !taken.has(r.id) && TAKES[t](r.kind));
        if (!free.length) {
          const left = dayRows.filter((r) => !hasLink(r) && !taken.has(r.id));
          free = left.length === 1 ? left : [];
        }
        if (free.length) {
          taken.add(free[0].id);
          fills.push({ id: free[0].id, link: f.link, file: f.name, day: key });
        } else if (dayRows.some(hasLink)) already += 1;
        else unplaced.push({ name: f.name, why: `יותר קבצים מפריטים ב־${Number(key.slice(8))}.${Number(key.slice(5, 7))}` });
      }
    }
  }
  const spoken = new Set([...groups.keys()].map((k) => k.slice(0, 7)));
  const empty = items.filter((r) => !hasLink(r) && !taken.has(r.id) && spoken.has(r.day.slice(0, 7)) && (!upTo || r.day <= upTo)).sort((a, b) => a.day.localeCompare(b.day) || byOrder(a, b));
  return { fills: fills.filter((x) => x.link), already, unplaced, empty };
}

// The summary after the tap, in the owner's words.
export function summaryLines(plan, done = plan.fills.length) {
  return { linked: `קושרו ${done}`, already: `כבר היה קישור: ${plan.already}` };
}
