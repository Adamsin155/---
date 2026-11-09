// "הצעות שנשלחו" by month (the owner, 9.11.2026; docs/ops.md, section 117): the list shows one Israel
// month at a time, the current one first, and a picker goes back to an earlier one. And which
// contract files uploaded by hand take part in the list at all. Pure (no DOM): node tests it.
import { dayKeyIL } from './tz.js';
import { manualAmounts } from './contract-read-logic.js';

// The signed contracts uploaded by hand count in "הצעות שנשלחו" from this moment on (midnight of
// 1.11.2026 in Israel). Why: on 27-29.10.2026 the owner uploaded the old contracts of the clients
// who were already with the office (31 files, a bulk import, not new signings); they belong to the
// client's card ("החוזה החתום") and not to the list of what was signed. From November on, a contract
// uploaded by hand is a new signing and enters the list, read automatically.
export const MANUAL_FROM = '2026-11-01T00:00:00+02:00';
export const fromCutoff = (at) => !!at && !Number.isNaN(new Date(at).getTime()) && new Date(at) >= new Date(MANUAL_FROM);

// 'YYYY-MM' of the Israel month of a moment, or null.
export function monthKeyIL(at) {
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : dayKeyIL(d).slice(0, 7);
}

// The month a row of the list belongs to: the day it was created. A quote: when it was made. A
// contract uploaded by hand: the day its file was uploaded (app/dashboard.js gives such a row the
// file's created_at), so it lands in the month it came in, whatever date is written in it.
export const rowMonth = (q) => monthKeyIL(q?.created_at || q?.signed_at);
// The month a row counts in "נחתם החודש": a quote by the day it was signed; a contract uploaded by
// hand by the month it is listed in (the day it was uploaded), so the month's signed rows and its
// sum agree.
export const signedMonth = (q) => (q?.manual ? rowMonth(q) : monthKeyIL(q?.signed_at));

const NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const parse = (key) => { const m = /^(\d{4})-(\d{2})$/.exec(String(key || '')); return m ? [+m[1], +m[2]] : null; };
// "נובמבר 2026".
export function monthLabel(key) {
  const p = parse(key);
  return p ? `${NAMES[p[1] - 1]} ${p[0]}` : '';
}
// "בנובמבר": the month's name with "ב", for the sums of a month that is not this one.
export function inMonthWords(key) {
  const p = parse(key);
  return p ? `ב${NAMES[p[1] - 1]}` : '';
}

// The months to choose from, the newest first: every month that has a row, and this month always.
export function monthChoices(rows = [], now = new Date()) {
  const keys = new Set([monthKeyIL(now)]);
  for (const q of rows) { const k = rowMonth(q); if (k) keys.add(k); }
  return [...keys].sort().reverse();
}
export const rowsOfMonth = (rows = [], key) => rows.filter((q) => rowMonth(q) === key);

// A contract uploaded by hand has amounts once its price and its months were read (or typed).
export const hasAmounts = (m) => manualAmounts(m).term_gross_agorot > 0;

// The signed contracts uploaded by hand, sorted for the list (app/dashboard.js loadManual):
//   rows      public.manual_contracts rows;
//   files     the live contract files uploaded since MANUAL_FROM (client_files: id, client_id, created_at);
//   uploaded  { fileId: file } of any file a row may name (also older or deleted ones), for the day
//             it was uploaded; `files` count too;
//   failed    a Set of file ids the automatic reading failed on lately.
// Answers { listed, check, toRead }:
//   listed  [{ row, at }]: a row with amounts whose file was uploaded since MANUAL_FROM: a signed row
//           of the list, in the month its file was uploaded (`at`);
//   check   [{ fileId, clientId, at, row }]: to look at by hand ("חוזים שצריך לבדוק"): a row
//           without a price or months, or a file the reading failed on, the newest first;
//   toRead  [file]: a file since MANUAL_FROM with no row yet, not failed lately: read it now.
// A file uploaded before MANUAL_FROM is in none of them, read or not (it stays in the client's card).
export function sortManual({ rows = [], files = [], uploaded = {}, failed = new Set() } = {}) {
  const fileOf = (id) => files.find((f) => f.id === id) || uploaded[id] || null;
  const kept = new Set(rows.map((m) => m.file_id));
  const listed = [];
  const check = [];
  const toRead = [];
  for (const m of rows) {
    // A row whose file is not known any more: by the day the row was kept.
    const at = fileOf(m.file_id)?.created_at || m.created_at;
    if (!fromCutoff(at)) continue;
    if (hasAmounts(m)) listed.push({ row: m, at });
    else check.push({ fileId: m.file_id, clientId: m.client_id, at, row: m });
  }
  for (const f of files) {
    if (kept.has(f.id) || !fromCutoff(f.created_at)) continue;
    if (failed.has(f.id)) check.push({ fileId: f.id, clientId: f.client_id, at: f.created_at, row: null });
    else toRead.push(f);
  }
  check.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { listed, check, toRead };
}

// The automatic reading of a new contract file is tried again by the same browser only after this
// long (a failure each time the page opens would cost a reading each time).
export const RETRY_AFTER_MS = 12 * 3600 * 1000;
// The file ids a failed reading is still fresh for: `tried` is { fileId: ms }.
export function freshFailures(tried = {}, nowMs = Date.now()) {
  return new Set(Object.entries(tried || {}).filter(([, t]) => Number.isFinite(t) && nowMs - t < RETRY_AFTER_MS).map(([id]) => id));
}
