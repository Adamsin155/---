// How many videos each editor has already edited (the owner's request of 22.10.2026), as
// pure logic. Kept per client, shoot round and editor (public.editor_progress,
// 20261101100000_editor_progress.sql): the editor writes it on their card (app/editor.js),
// the office reads it beside each editor's client (app/qa.js, app/client-card.js).
// A monthly client is counted per month instead (the second half of this file).
import { PEOPLE, editorsOf, shareOf, isEditorOf } from './protocol.js';
import { videosPerDay } from './production.js';
import { partsIL } from './tz.js';

// The editor's part of the shoot: their share with two editors, else the package's
// videos (as the card says); null when not known.
export function editTarget(ctx, person) {
  const s = shareOf(ctx, person);
  return s ? s.mine : videosPerDay(ctx);
}
// What was typed, as the number to keep: a whole number 0..999, else null.
export function editedValue(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  return Number(s);
}
export const progressKey = (clientId, round, editor) => `${clientId}:${round || 1}:${editor}`;
export const progressMap = (rows) => Object.fromEntries((rows || []).map((r) => [progressKey(r.client_id, r.round, r.editor), r]));
// "8/10", or "8" without a known part. Above the part it stays as it is ("12/10").
export const editedShort = (n, of) => (of ? `${n}/${of}` : `${n}`);
// The office's line for a shoot (ctx: the client, or a round's roundContext): "27/48" with
// one editor, "נדיה 8/10 · יריב 12/15" with two (one not written yet counts 0); null when
// no editor of it wrote a number.
export function editedLine(ctx, map) {
  const eds = editorsOf(ctx);
  const rows = eds.map((e) => map?.[progressKey(ctx.id, ctx.round, e)] || null);
  if (!rows.some(Boolean)) return null;
  if (eds.length === 1) return editedShort(rows[0].edited, editTarget(ctx, eds[0]));
  return eds.map((e, i) => `${PEOPLE[e]?.name || e} ${editedShort(rows[i]?.edited || 0, editTarget(ctx, e))}`).join(' · ');
}

// ── A monthly client (the owner's request of 22.10.2026) ──
// A client that gets a fixed number of videos every month instead of one package: the
// client's deliverables say so, `videos_month: 8`, and a month that differs is in
// `videos_month_except: { "2026-10": 12 }` (the office's fields in the client's details,
// app/client-card.js). Its editor counts per Israel calendar month, from 0 again on the 1st
// (nothing carries over): public.editor_progress_month (20261104100000_editor_progress_month.sql).
// Who counts by the month: the client's own editors (main or second). Everyone else (a
// round's other editor), and every other client, counts per shoot as above.
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
export const isMonthKey = (k) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(k ?? ''));
// 'YYYY-MM' of the Israel month of a moment: a new month starts at 00:00 of the 1st in Israel,
// whatever the device's time zone.
export const monthKey = (now = new Date()) => { const p = partsIL(now); return `${p.year}-${pad(p.month)}`; };
// 'YYYY-MM' n months later (or earlier).
export function addMonth(key, n) {
  const t = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
// "אוקטובר 2026".
export const monthLabel = (key) => (isMonthKey(key) ? `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` : String(key ?? ''));
const whole = (v, min) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isInteger(n) && n >= min && n <= 999 ? n : null;
};
// The client's regular number a month (1..999), or null: not a monthly client.
export const monthBase = (client) => whole(client?.deliverables?.videos_month, 1);
export const isMonthly = (client) => monthBase(client) !== null;
// The months with a number of their own, { 'YYYY-MM': n } (only well-formed ones, in order).
export function monthExceptions(client) {
  const x = client?.deliverables?.videos_month_except;
  if (!x || typeof x !== 'object' || Array.isArray(x)) return {};
  return Object.fromEntries(Object.entries(x).filter(([k, v]) => isMonthKey(k) && whole(v, 0) !== null).map(([k, v]) => [k, whole(v, 0)]).sort());
}
// How many videos the client gets in the Israel month of `now` (the month's own number, else
// the regular one); null for a client counted by the package.
export function monthTarget(client, now = new Date()) {
  const base = monthBase(client);
  if (base === null) return null;
  return monthExceptions(client)[monthKey(now)] ?? base;
}
// Whether `person` counts this client by the month: a monthly client, and one of its editors.
export const monthlyFor = (client, person) => isMonthly(client) && isEditorOf(client, person);
// The editor card's line: "8 סרטונים בחודש"; a month with its own number, "12 סרטונים החודש".
export function monthVideosText(client, now = new Date()) {
  const n = monthTarget(client, now);
  if (n === null) return null;
  const own = monthExceptions(client)[monthKey(now)] !== undefined;
  return `${n === 1 ? 'סרטון אחד' : `${n} סרטונים`} ${own ? 'החודש' : 'בחודש'}`;
}
export const monthRowKey = (clientId, month, editor) => `${clientId}:${month}:${editor}`;
export const monthMap = (rows) => Object.fromEntries((rows || []).map((r) => [monthRowKey(r.client_id, r.month, r.editor), r]));
// The office's line for a monthly client this month: "5/8 החודש" with one editor, "נדיה 3 ·
// יריב 2 · 5/8 החודש" with two (together against the month); null when no editor of it wrote
// a number this month, or it is not a monthly client.
export function monthLine(client, map, now = new Date()) {
  const of = monthTarget(client, now);
  if (of === null || !map) return null;
  const key = monthKey(now);
  const eds = editorsOf(client);
  const rows = eds.map((e) => map[monthRowKey(client.id, key, e)] || null);
  if (!rows.some(Boolean)) return null;
  const sum = rows.reduce((t, r) => t + (r?.edited || 0), 0);
  const total = `${editedShort(sum, of)} החודש`;
  return eds.length === 1 ? total : `${eds.map((e, i) => `${PEOPLE[e]?.name || e} ${rows[i]?.edited || 0}`).join(' · ')} · ${total}`;
}

// The office's fields in the client's details: "סרטונים בחודש" (empty: counted by the package)
// and "חריג לחודש" (a month and its number; the month with an empty number goes back to the
// regular one). Returns { deliverables } with everything else kept, or { error, field }.
export function withMonthly(deliverables, { base = '', month = '', except = '' } = {}) {
  const out = { ...(deliverables || {}) };
  const b = String(base ?? '').trim();
  if (b === '') delete out.videos_month;
  else {
    const n = editedValue(b);
    if (n === null || n < 1) return { error: 'סרטונים בחודש: מספר שלם מ־1 עד 999, או ריק.', field: 'base' };
    out.videos_month = n;
  }
  const e = String(except ?? '').trim();
  if (!isMonthKey(month)) return e === '' ? { deliverables: out } : { error: 'בחרו את החודש של החריג.', field: 'month' };
  const x = monthExceptions({ deliverables: out });
  if (e === '') delete x[month];
  else {
    const n = editedValue(e);
    if (n === null) return { error: 'החריג לחודש: מספר שלם מ־0 עד 999, או ריק.', field: 'except' };
    x[month] = n;
  }
  if (Object.keys(x).length) out.videos_month_except = Object.fromEntries(Object.entries(x).sort());
  else delete out.videos_month_except;
  return { deliverables: out };
}
// The months offered for an exception: last month, this month and the eleven after it, and
// any month that already has one.
export function exceptMonths(client, now = new Date()) {
  const here = monthKey(now);
  const list = Array.from({ length: 13 }, (_, i) => addMonth(here, i - 1));
  return [...new Set([...list, ...Object.keys(monthExceptions(client))])].sort();
}
