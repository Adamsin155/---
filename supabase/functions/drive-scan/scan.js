// The Drive scan's work (docs/ops.md, section 83), free of Deno APIs so node tests run it
// (tests/drive-scan.test.mjs). Each run takes the few clients counted longest ago, lists what was
// added to their folder in the last WINDOW_DAYS, and writes the day's counts per folder and kind.
// Only counts, folder names and days are written: no file name, no link, no content.
import { folderIdOf, fileClass, kindOf } from '../_shared/drive.js';
import { addDaysIL, atTimeIL, dayKeyIL } from '../_shared/app/tz.js';
import { clientState } from '../_shared/app/protocol-logic.js';
import { driveMarks, ganttFills } from '../_shared/app/drive-auto-logic.js';

export const WINDOW_DAYS = 30;
export const BATCH = 8;
export const BUDGET_MS = 45000; // stops taking clients after this; the next run goes on from there
export const SCAN_DEPTH = 3;
export const SCAN_MAX_FILES = 5000;
const FOLDER_LEN = 120;

// The files of one listing, as rows: { day, folder, kind, files }.
export function dayRows(files) {
  const map = new Map();
  for (const f of files || []) {
    if (kindOf(f.mimeType) === 'folder' || !f.createdTime) continue;
    const row = { day: dayKeyIL(new Date(f.createdTime)), folder: String(f.path || '').trim().slice(0, FOLDER_LEN), kind: fileClass(f.mimeType, f.path) };
    const k = `${row.day}|${row.folder}|${row.kind}`;
    if (!map.has(k)) map.set(k, { ...row, files: 0 });
    map.get(k).files += 1;
  }
  return [...map.values()];
}

// The rows to write: the fresh counts, and 0 for what was counted before and is gone from the
// window (a file moved or removed). Nothing is ever taken out of the table.
export function mergeRows(clientId, fresh, before) {
  const key = (r) => `${r.day}|${r.folder}|${r.kind}`;
  const have = new Set(fresh.map(key));
  const gone = (before || []).filter((r) => !have.has(key(r))).map((r) => ({ day: r.day, folder: r.folder, kind: r.kind, files: 0 }));
  return [...fresh, ...gone].map((r) => ({ client_id: clientId, ...r }));
}

// What the folder just listed proves (docs/ops.md, section 141; app/drive-auto-logic.js): the
// protocol's marks of 24, 7 and 23 the Drive shows, inserted never over a mark that exists, and
// the content Gantt's empty links, filled only while empty. Read from the database after this
// run's counts were saved (no second Drive listing). Never throws: a failure is counted, and the
// next pass over the client tries again. Without the store's methods (an older store), nothing.
export async function autoStep({ store, clientId, files, now, stats }) {
  if (!store.autoContext) return;
  try {
    const ctx = await store.autoContext(clientId);
    if (!ctx?.client) return;
    const checks = {};
    for (const r of ctx.checks || []) checks[r.item_key] = r;
    const marks = driveMarks({ client: ctx.client, checks, state: clientState(ctx.client, checks, now), daily: ctx.daily || [], folderOk: true, now });
    if (marks.length) stats.marked += await store.addMarks(clientId, marks.map(({ item_key, state, note }) => ({ item_key, state, note })));
    for (const f of ganttFills(ctx.client, ctx.gantt || [], files, now)) {
      if (await store.fillLink(clientId, f.id, f.link)) stats.linked += 1;
    }
  } catch (e) {
    stats.autoFailed += 1;
    console.error('drive-scan: the Drive marks were not written', String(e?.code || e?.name || 'error').slice(0, 40));
  }
}

// store: { targets() → [{ id, links, scanned_at }], before(clientId, fromDay) → rows,
//          save(rows), state({ client_id, scanned_at, error, files, partial }),
//          and for the marks (optional): autoContext(clientId) → { client, checks, daily, gantt },
//          addMarks(clientId, marks) → how many were written, fillLink(clientId, id, link) → written? }
export async function runScan({ store, drive, now = new Date(), clock = () => Date.now(), batch = BATCH, budgetMs = BUDGET_MS }) {
  const started = clock();
  const since = atTimeIL(addDaysIL(now, -WINDOW_DAYS), 0);
  const fromDay = dayKeyIL(since);
  const all = await store.targets();
  const queue = [...all].sort((a, b) => String(a.scanned_at || '').localeCompare(String(b.scanned_at || ''))).slice(0, batch);
  const stats = { clients: 0, files: 0, failed: 0, marked: 0, linked: 0, autoFailed: 0 };
  for (const c of queue) {
    if (clock() - started > budgetMs) break;
    const folder = folderIdOf(c.links?.drive);
    const at = now.toISOString();
    if (!folder) {
      await store.state({ client_id: c.id, scanned_at: at, error: 'not_a_folder', files: 0, partial: false });
      stats.failed += 1;
      continue;
    }
    try {
      const { files, truncated } = await drive.list(folder, { since: since.toISOString(), maxDepth: SCAN_DEPTH, maxFiles: SCAN_MAX_FILES });
      const fresh = dayRows(files);
      const rows = mergeRows(c.id, fresh, await store.before(c.id, fromDay));
      if (rows.length) await store.save(rows);
      const n = fresh.reduce((sum, r) => sum + r.files, 0);
      await store.state({ client_id: c.id, scanned_at: at, error: null, files: n, partial: !!truncated });
      stats.clients += 1;
      stats.files += n;
      await autoStep({ store, clientId: c.id, files, now, stats });
    } catch (e) {
      // A client that fails moves to the back of the line, and the page names it as not counted.
      await store.state({ client_id: c.id, scanned_at: at, error: String(e?.code || 'error').slice(0, 40), files: 0, partial: false });
      stats.failed += 1;
    }
  }
  return stats;
}
