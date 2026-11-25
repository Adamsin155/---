// The Drive scan's work (docs/ops.md, section 83), free of Deno APIs so node tests run it
// (tests/drive-scan.test.mjs). Each run takes the few clients counted longest ago, lists what was
// added to their folder in the last WINDOW_DAYS, and writes the day's counts per folder and kind.
// Only counts, folder names and days are written: no file name, no link, no content.
import { folderIdOf, fileClass, kindOf } from '../_shared/drive.js';
import { addDaysIL, atTimeIL, dayKeyIL } from '../_shared/app/tz.js';
import { clientState } from '../_shared/app/protocol-logic.js';
import { driveMarks, ganttFills } from '../_shared/app/drive-auto-logic.js';

export const WINDOW_DAYS = 30;
// The move to the new Drive (the owner, 24-25.11.2026; docs/ops.md, section 154): the clients' files were
// copied there on 24.11, so every copy is dated 24.11. Only what was added from COUNT_FROM on is counted,
// and the days before it are left as they were (never zeroed): the copies are not new work, and the
// counts kept until the move stay. Applies to the daily scan; the one-time back-scan is not run again.
export const COUNT_FROM = new Date('2026-11-25T00:00:00+02:00');
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
    const row = { day: dayKeyIL(new Date(f.createdTime)), folder: String(f.path || '').trim().slice(0, FOLDER_LEN), kind: fileClass(f.mimeType, f.path, f.name) };
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

// store: { targets() → [{ id, links, scanned_at }], before(clientId, fromDay) → rows,
//          save(rows), state({ client_id, scanned_at, error, files, partial }) }
// What the folder just listed proves (docs/ops.md, section 141; app/drive-auto-logic.js): the
// protocol's marks of 24, 7 and 23 the Drive shows, inserted never over a mark that exists, and
// the content Gantt's empty links, filled only while empty. Read from the database after this
// run's counts were saved (no second Drive listing). Never throws: a failure is counted, and the
// next pass over the client tries again. Without the store's methods (an older store), nothing.
// Only the daily scan runs it, never the back-scan (runBackfill): a back-scan call takes 25 whole
// folders under the same time budget, and while it runs the counts of the clients after `after`
// are still the 30-day ones; each client is marked on its next daily pass (about two hours), from
// its full counts by then.
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

// The daily scan. store: as below, and for the marks (optional): autoContext(clientId) →
// { client, checks, daily, gantt }, addMarks(clientId, marks) → how many were written,
// fillLink(clientId, id, link) → written?
export async function runScan({ store, drive, now = new Date(), clock = () => Date.now(), batch = BATCH, budgetMs = BUDGET_MS }) {
  const started = clock();
  const window = atTimeIL(addDaysIL(now, -WINDOW_DAYS), 0);
  const since = window < COUNT_FROM ? COUNT_FROM : window;
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

// ── The back-scan (17.11.2026; docs/ops.md, section 140) ──────────────────
// The daily scan only ever looked 30 days back, so public.drive_daily starts on 30.9.2026, and a
// client whose videos were uploaded before that shows fewer in "מעקב לקוחות" and in the card's
// "נערכו" than its Drive holds. The back-scan lists each client's WHOLE folder once (no window; the
// scan's depth and caps) and writes its rows from the client's deal day on (Israel; without a deal
// time, the day the client was opened). The counts REPLACE what is there (the same upsert on
// client_id, day, folder, kind), and a row from the deal day on that the folder no longer has goes
// to 0, so running it twice, or with the daily scan in between, never counts a file twice. Days
// before the deal day are not touched.
// Resumable, with no column of its own: the clients go by id, and each call starts after `after`
// (the `next` of the call before) and stops taking clients after the time budget. It answers
// { clients, files, failed, next, done }: call again with { backfill: true, after: next } until done.
export const BACKFILL_BATCH = 25;
export function dealDay(c) {
  const t = Date.parse(c?.deal_at || c?.created_at || '');
  return Number.isFinite(t) ? dayKeyIL(new Date(t)) : null;
}
// store: as runScan's, and targets() also gives deal_at and created_at.
export async function runBackfill({ store, drive, after = null, now = new Date(), clock = () => Date.now(), batch = BACKFILL_BATCH, budgetMs = BUDGET_MS }) {
  const started = clock();
  const all = [...await store.targets()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const queue = all.filter((c) => !after || String(c.id) > String(after));
  const stats = { clients: 0, files: 0, failed: 0, next: after, done: false };
  let taken = 0;
  for (const c of queue) {
    if (taken >= batch || (taken > 0 && clock() - started > budgetMs)) break;
    taken += 1;
    const folder = folderIdOf(c.links?.drive);
    const at = now.toISOString();
    if (!folder) {
      await store.state({ client_id: c.id, scanned_at: at, error: 'not_a_folder', files: 0, partial: false });
      stats.failed += 1;
      stats.next = c.id;
      continue;
    }
    try {
      const from = dealDay(c);
      const { files, truncated } = await drive.list(folder, { maxDepth: SCAN_DEPTH, maxFiles: SCAN_MAX_FILES });
      const fresh = dayRows(files).filter((r) => !from || r.day >= from);
      const rows = mergeRows(c.id, fresh, await store.before(c.id, from || '1900-01-01'));
      if (rows.length) await store.save(rows);
      const n = fresh.reduce((sum, r) => sum + r.files, 0);
      await store.state({ client_id: c.id, scanned_at: at, error: null, files: n, partial: !!truncated });
      stats.clients += 1;
      stats.files += n;
    } catch (e) {
      await store.state({ client_id: c.id, scanned_at: at, error: String(e?.code || 'error').slice(0, 40), files: 0, partial: false });
      stats.failed += 1;
    }
    stats.next = c.id;
  }
  stats.done = !queue.length || stats.next === queue.at(-1).id;
  stats.left = queue.length - taken;
  return stats;
}
