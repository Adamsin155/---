// "משיכת קישורים מהדרייב" in the content Gantt (the owner's request of 29.10.2026; docs/ops.md,
// section 74): Ilai names every file he puts in the client's Drive folder starting with its day
// and month ("15.11 רילס מבצע.mp4"; also "15.11.26 …", "15/11", "15-11", "3.1", leading zeros
// optional). One tap reads the folder (the drive function, ../supabase/functions/drive/) and fills
// the link of the Gantt item on that date. The owner's rule: a link already in the Gantt is NEVER
// replaced; only empty items are filled. Since 11.11.2026 (docs/ops.md, section 128) a file whose date
// has no free item of its kind takes the nearest one a day before or after it, and a year in the
// name that is one off ("13.1.2026" in a 2027 package) is read as the package's. Plain logic, so
// node tests it (tests/drive.test.mjs).
import { GANTT_KINDS, GANTT_RULES } from './gantt-template.js';

const pad = (n) => String(n).padStart(2, '0');
// The day and month at the start of a file's name, and the year when written (2 or 4 digits):
// { day, month, year|null } or null. "15.11", "15.11.26", "15/11/2026", "15-11", "3.1 ", "15.11_reel".
const LEAD = /^\s*(\d{1,2})\s*[./-]\s*(\d{1,2})(?:\s*[./-]\s*(\d{2}|\d{4}))?(?!\d)/;
// Also the year first, as the file names some editors use ("2026-11-11 - סרטון 9.mp4", "2026.11.11",
// "2026_11_11"; אלאור בוטיק, 11.11.2026: before this their videos never linked).
const ISO = /^\s*(20\d{2})\s*[./_-]\s*(\d{1,2})\s*[./_-]\s*(\d{1,2})(?!\d)/;
export function dateOfName(name) {
  const iso = ISO.exec(String(name ?? ''));
  const m = iso ? [iso[0], iso[3], iso[2], iso[1]] : LEAD.exec(String(name ?? ''));
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

// What a file is to the Gantt: 'video' (a video file), 'image' (a picture, or anything in a
// graphics or highlights folder: "גרפיקות", "היילייטס"; the drive function's own rule,
// supabase/functions/_shared/drive.js fileClass), else 'other'.
const GRAPHIC_FOLDER = /גרפיק|היילייט/;
const READY_FOLDER = /סופי|מוכנ|ערוכ|סגיר|מתוקן/;
const RAW_FOLDER = /גלם|מצלמה|רחפן|בירול|יום צילום|ראיונות|מאחורי הקלעים/;
// Footage and photos of a shoot (the drive function's 'raw'): never a row of their own.
export function isRaw(f) {
  const p = String(f?.path || '');
  const t = fileType(f);
  if (GRAPHIC_FOLDER.test(p)) return false;
  if (t === 'video') return RAW_FOLDER.test(p) && !READY_FOLDER.test(p);
  if (t === 'image') return RAW_FOLDER.test(p) || /תמונות/.test(p);
  return false;
}
// The row a file may make (11.11.2026): a video, or a graphic for a picture.
const ROW_OF = { video: 'video', image: 'graphic' };
const ROW_TITLE = { video: (n) => `סרטון ${n}`, graphic: (n) => `גרפיקה ${n}` };
const ROW_TIME = Object.fromEntries(GANTT_RULES.filter((r) => ROW_TITLE[r.kind]).map((r) => [r.kind, r.time]));
export function fileKind(f) {
  const t = fileType(f);
  if (t === 'video') return 'video';
  if (t === 'image' || GRAPHIC_FOLDER.test(String(f?.path || ''))) return 'image';
  return 'other';
}
const addDay = (key, n) => new Date(Date.parse(`${key}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const NEAR = [0, -1, 1]; // the day itself, then the day before (a post of yesterday), then the day after

// The days a dated name may stand for: with a year, that year's day (and, when the Gantt has
// nothing within a day of it in that year, the same day a year earlier or later: "13.1.2026" for
// a package that runs into 2027 is a typo of the year); without one, that day in each year of
// the Gantt, the one nearest to when the file was added first.
// When nothing in the Gantt is near, the day the file most likely means (`range`: the package's
// days, from the deal to the contract's end): the year written (or, when only the year next to it
// falls in the package, that one); without a year, the year that puts it nearest to when the file
// was added. The first of the list is the day a new row would go on (`fallback`).
function basesFor(d, f, daysOf, range = null) {
  const md = `${pad(d.month)}-${pad(d.day)}`;
  const near = (k) => NEAR.some((n) => daysOf.has(addDay(k, n)));
  const valid = (y) => !Number.isNaN(Date.parse(`${y}-${md}T12:00:00Z`)) && new Date(`${y}-${md}T12:00:00Z`).getUTCMonth() === d.month - 1;
  const inRange = (k) => !range || (k >= range.from && k <= range.to);
  if (d.year) {
    const own = `${d.year}-${md}`;
    if (near(own)) return [{ key: own, typo: false }];
    const other = [d.year - 1, d.year + 1].filter(valid).map((y) => `${y}-${md}`);
    const nearOther = other.filter(near);
    if (nearOther.length === 1) return [{ key: nearOther[0], typo: true }];
    const inside = other.filter(inRange);
    if (range && !inRange(own) && inside.length === 1) return [{ key: inside[0], typo: true, fallback: true }];
    return [{ key: own, typo: false, fallback: true }];
  }
  const at = Date.parse(f.createdTime || '') || Date.now();
  const closer = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - at) - Math.abs(Date.parse(`${b}T12:00:00Z`) - at);
  const years = [...new Set([...daysOf].map((k) => Number(k.slice(0, 4))))].filter(valid);
  const hits = years.map((y) => `${y}-${md}`).filter(near).sort(closer).map((key) => ({ key, typo: false }));
  if (hits.length) return hits;
  const y0 = new Date(at).getUTCFullYear();
  const guess = [y0 - 1, y0, y0 + 1].filter(valid).map((y) => `${y}-${md}`).sort(closer);
  const pick = guess.find(inRange) || guess[0];
  return pick ? [{ key: pick, typo: false, fallback: true }] : [];
}

// The plan: { fills: [{ id, link, file, day, near, typo }], creates: [{ kind, key, num, title, day,
// time_il, link, file }], already, unplaced: [{ name, why }], empty: [rows] }.
//   creates   (the owner, 11.11.2026: the Gantt shows only what is real; Ilai's dated files are his
//             plan) a video, or a picture, with no row of its kind on its day or a day before or
//             after it, makes a new row of that kind on its day: planned, with the file's link,
//             numbered after the rows of that kind. Never footage or photos of a shoot (isRaw),
//             never outside the package (`range`), never next to a row of its kind that is there;
//   fills     an empty item gets this file's link: the item of the file's date, else (the owner,
//             11.11.2026) the nearest within one day of it of the same kind (Dabush's file
//             "13.11.2026" was the Metricool post of 12.11); `near`: the days between, `typo`:
//             the year in the name was a year off;
//   already   files whose item already had a link (or that link is this file);
//   unplaced  files with no date in the name, no item within a day of it, or more files than items;
//   empty     items still without a link on the months the folder speaks of, and before `upTo`.
// A link already in the Gantt is never replaced, and one file goes on one item.
// rows: the Gantt's rows ({ id, kind, day, time_il, num, link }); files: the folder's listing
// ({ name, mimeType, createdTime, link, path }), folders left out.
export function matchFiles(rows, files, { upTo = null, range = null } = {}) {
  const items = (rows || []).filter(linkable);
  const daysOf = new Set(items.map((r) => r.day));
  const known = new Set(items.filter(hasLink).map((r) => String(r.link).trim()));
  const unplaced = [];
  let already = 0;
  const dated = []; // { f, t, bases }
  for (const f of files || []) {
    if (!f || f.mimeType === 'application/vnd.google-apps.folder') continue;
    if (f.link && known.has(String(f.link).trim())) { already += 1; continue; }
    const d = dateOfName(f.name);
    if (!d) { unplaced.push({ name: f.name, why: 'אין תאריך בתחילת השם' }); continue; }
    dated.push({ f, d, t: fileKind(f), bases: basesFor(d, f, daysOf, range) });
  }
  dated.sort((a, b) => String(a.bases[0]?.key || '').localeCompare(String(b.bases[0]?.key || '')) || String(a.f.name).localeCompare(String(b.f.name), 'he'));
  const fills = [];
  const taken = new Set();
  const free = (r) => !hasLink(r) && !taken.has(r.id);
  const rowsOn = (key) => items.filter((r) => r.day === key).sort(byOrder);
  const place = (x, r, key, n, typo) => { taken.add(r.id); fills.push({ id: r.id, link: x.f.link, file: x.f.name, day: r.day, near: n, typo }); x.done = true; };
  // 1. The file's own day: the items of its kind in the day's order; a file that is neither a
  //    video nor a picture (a PDF) takes the day's one empty item when only one is left. Videos first, then pictures, then the rest.
  const types = ['video', 'image', 'other'];
  for (const t of types) {
    for (const x of dated.filter((y) => y.t === t)) {
      for (const b of x.bases) {
        const day = rowsOn(b.key);
        let cand = day.filter((r) => free(r) && TAKES[t](r.kind));
        if (!cand.length && t === 'other') { const left = day.filter(free); cand = left.length === 1 ? left : []; }
        if (cand.length) { place(x, cand[0], b.key, 0, b.typo); break; }
      }
    }
  }
  // 2. A day off: the nearest item of the same kind (the day before first), never any kind; only a
  //    video or a picture (a PDF goes on its own day only).
  for (const t of ['video', 'image']) {
    for (const x of dated.filter((y) => y.t === t && !y.done)) {
      let hit = null;
      for (const n of NEAR.slice(1)) {
        for (const b of x.bases) {
          const cand = rowsOn(addDay(b.key, n)).filter((r) => free(r) && TAKES[t](r.kind));
          if (cand.length) { hit = { r: cand[0], b, n }; break; }
        }
        if (hit) break;
      }
      if (hit) place(x, hit.r, hit.b.key, hit.n, hit.b.typo);
    }
  }
  // 3. A video or a picture with no row of its kind within a day: a new row on its day.
  const all = (rows || []).filter((r) => r && r.day);
  const max = { video: 0, graphic: 0 };
  for (const r of all) if (max[r.kind] !== undefined) max[r.kind] = Math.max(max[r.kind], Number(r.num) || Number(/\.(\d+)$/.exec(String(r.key || ''))?.[1]) || 0);
  const creates = [];
  const ofKindNear = (kind, key) => [...all, ...creates].some((r) => r.kind === kind && NEAR.some((n) => r.day === addDay(key, n)));
  for (const x of [...dated].sort((a, b) => String(a.bases[0]?.key || '').localeCompare(String(b.bases[0]?.key || '')) || String(a.f.name).localeCompare(String(b.f.name), 'he'))) {
    const kind = ROW_OF[x.t];
    const b = x.bases[0];
    if (x.done || !kind || !b || !x.f.link || isRaw(x.f)) continue;
    if (range && (b.key < range.from || b.key > range.to)) continue;
    if (ofKindNear(kind, b.key)) continue;
    max[kind] += 1;
    creates.push({ kind, key: `${kind}.${max[kind]}`, num: max[kind], title: ROW_TITLE[kind](max[kind]), day: b.key, time_il: ROW_TIME[kind] || null, link: x.f.link, file: x.f.name, typo: b.typo });
    x.done = true;
  }
  // 4. What found nothing: its item already had a link, there were more files than items, or no item.
  for (const x of dated) {
    if (x.done) continue;
    const key = x.bases[0]?.key || null;
    const day = key ? rowsOn(key) : [];
    if (day.some(hasLink)) already += 1;
    else if (day.length) unplaced.push({ name: x.f.name, why: `יותר קבצים מפריטים ב־${Number(key.slice(8))}.${Number(key.slice(5, 7))}` });
    else unplaced.push({ name: x.f.name, why: `אין פריט בגאנט ב־${x.d.day}.${x.d.month} או יום לפניו או אחריו` });
  }
  const spoken = new Set([...fills.map((x) => x.day), ...dated.map((x) => x.bases[0]?.key).filter((k) => k && daysOf.has(k))].map((k) => k.slice(0, 7)));
  const empty = items.filter((r) => free(r) && spoken.has(r.day.slice(0, 7)) && (!upTo || r.day <= upTo)).sort((a, b) => a.day.localeCompare(b.day) || byOrder(a, b));
  return { fills: fills.filter((x) => x.link), creates, already, unplaced, empty };
}

// The summary after the tap, in the owner's words.
export function summaryLines(plan, done = plan.fills.length) {
  return { linked: `קושרו ${done}`, already: `כבר היה קישור: ${plan.already}` };
}
