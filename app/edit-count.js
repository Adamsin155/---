// How many videos each editor has already edited (the owner's request of 22.10.2026), as
// pure logic. Kept per client, shoot round and editor (public.editor_progress,
// 20261101100000_editor_progress.sql): the editor writes it on their card (app/editor.js),
// the office reads it beside each editor's client (app/qa.js, app/client-card.js).
import { PEOPLE, editorsOf, shareOf } from './protocol.js';
import { videosPerDay } from './production.js';

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
