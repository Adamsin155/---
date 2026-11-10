// "מעקב לקוחות": a number fixed by hand (Irit, 10.11.2026; the owner approved). The page's numbers
// are counted (app/tracking-logic.js, app/tracking-shoots-logic.js); when one is wrong, Irit or the
// owners type the right one, and it stands in place of the count, with a small line "עודכן ביד ·
// עירית · 10.11". Emptying a field gives that number back to the count. Ilai fixes the graphics only.
// Pure, no DOM (tests/tracking-fix.test.mjs); the dialog is app/tracking-fix.js; docs/ops.md, section 122.
//
// Where it is kept: the client's own free jsonb, clients.deliverables (no column, no migration, as
// shoot_monthly and videos_month), under `tracking`:
//   deliverables.tracking = {
//     videos:   { done, of, month?, by, at }   month: 'YYYY-MM' for a monthly client (that month only)
//     graphics: { done, of, by, at }
//     shoots:   { held, agreed, status, by, at }   status: 'waiting' | 'set'
//   }
// Each number is there only when it was typed; a missing one is the count's. For this page only:
// the package itself (deliverables.videos, graphics, shoot_days) is not touched, so the editors'
// targets, the contract summary and the reminders stay as they were.
import { isOwnerView } from './team-rules.js';
import { isManager } from './manager-rules.js';
import { PEOPLE } from './protocol.js';
import { partsIL } from './tz.js';

export const KEY = 'tracking';
export const KINDS = ['videos', 'graphics', 'shoots'];
// The numbers of each kind, in the dialog's order.
export const FIELDS = { videos: ['done', 'of'], graphics: ['done', 'of'], shoots: ['held', 'agreed'] };
export const SHOOT_STATUS = ['waiting', 'set'];
export const MAX = 999;

const known = (v) => !!v && !v.error;
// Who fixes: Irit and the owners. Ilai: the graphics only. Lior and Ofir read.
export const FIXERS = ['irit'];
export const canFix = (v) => isOwnerView(v) || (known(v) && FIXERS.includes(v.me));
export const GRAPHICS_FIXERS = ['ilai'];
export const canFixKind = (v, kind) => canFix(v) || (kind === 'graphics' && known(v) && GRAPHICS_FIXERS.includes(v.me));
// Who opens the page: the owners and the managers, and Ilai (the first tab only, to fix his graphics).
export const canOpenTracking = (v) => isManager(v) || (known(v) && GRAPHICS_FIXERS.includes(v.me));
export const onlyFirstTab = (v) => !isManager(v);

// A typed number: '' is "none" (null); a whole number 0..MAX; anything else is not a number (NaN).
export function parseCount(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (!/^\d{1,3}$/.test(t)) return NaN;
  const n = Number(t);
  return n <= MAX ? n : NaN;
}
const count = (v) => (Number.isInteger(v) && v >= 0 && v <= MAX ? v : null);

// The fix of one kind as kept, cleaned (null when there is none).
export function fixOf(client, kind) {
  const f = client?.deliverables?.[KEY]?.[kind];
  if (!f || typeof f !== 'object') return null;
  const out = {};
  for (const k of FIELDS[kind]) { const n = count(f[k]); if (n !== null) out[k] = n; }
  if (kind === 'shoots' && SHOOT_STATUS.includes(f.status)) out.status = f.status;
  if (kind === 'videos' && typeof f.month === 'string') out.month = f.month;
  if (!Object.keys(out).some((k) => k !== 'month')) return null;
  out.by = typeof f.by === 'string' ? f.by : '';
  out.at = typeof f.at === 'string' ? f.at : '';
  return out;
}

// The deliverables with one kind's fix set (`values`: { done, of } / { held, agreed, status },
// each null for "the count's"), or taken away (values null, or nothing in it). The rest is kept.
export function withFix(deliverables, kind, values, { by = '', at = new Date().toISOString(), month = null } = {}) {
  const d = { ...(deliverables || {}) };
  const t = { ...(d[KEY] && typeof d[KEY] === 'object' ? d[KEY] : {}) };
  const f = {};
  for (const k of FIELDS[kind]) { const n = count(values?.[k]); if (n !== null) f[k] = n; }
  if (kind === 'shoots' && SHOOT_STATUS.includes(values?.status)) f.status = values.status;
  if (Object.keys(f).length) {
    if (kind === 'videos' && month) f.month = month;
    t[kind] = { ...f, by, at };
  } else delete t[kind];
  if (Object.keys(t).length) d[KEY] = t; else delete d[KEY];
  return d;
}

// Only what differs from the count is kept: a number typed as the count says follows the count.
export function changedOnly(kind, typed, auto) {
  const out = {};
  for (const k of FIELDS[kind]) out[k] = typed[k] === null || typed[k] === undefined || typed[k] === auto[k] ? null : typed[k];
  if (kind === 'shoots') out.status = typed.status && typed.status !== auto.status ? typed.status : null;
  return out;
}

// A count with the fix on it. `x`: { done, of, … } of app/tracking-logic.js. The count itself is
// kept in `auto` (the dialog shows it), and `fix` says who and when.
//   month: the Israel month of a monthly client's videos ('YYYY-MM'); a fix of another month is old.
export function applyCount(x, f, { month = null } = {}) {
  if (!f) return x;
  if (f.month && month && f.month !== month) return x;
  if (!f.month && month) return x;
  return { ...x, done: f.done ?? x.done, of: f.of ?? x.of, auto: { done: x.done, of: x.of }, fix: { by: f.by, at: f.at } };
}
// The shoot days of the first tab ({ done: held, of: agreed }).
export function applyShootCount(x, f) {
  if (!f || (f.held === undefined && f.agreed === undefined)) return x;
  return { ...x, done: f.held ?? x.done, of: f.agreed ?? x.of, auto: { done: x.done, of: x.of }, fix: { by: f.by, at: f.at } };
}

// Who fixed it: the person's name, "הבעלים" for an owner.
export const byKey = (v) => (v?.me ? v.me : 'owner');
export const byName = (by) => (PEOPLE[by]?.name || (by === 'owner' ? 'הבעלים' : ''));
// "עודכן ביד · עירית · 10.11"
export function fixLine(fix) {
  if (!fix) return '';
  const d = fix.at ? new Date(fix.at) : null;
  const day = d && !Number.isNaN(d.getTime()) ? (() => { const p = partsIL(d); return `${p.day}.${p.month}`; })() : '';
  return ['עודכן ביד', byName(fix.by), day].filter(Boolean).join(' · ');
}

// The dialog's check: every field a number or empty; done never above "of" (when both are known).
// Returns '' when it is fine, or the words to show.
export function problemOf(kind, typed, auto) {
  for (const k of FIELDS[kind]) if (Number.isNaN(typed[k])) return `רק מספר שלם, 0 עד ${MAX}.`;
  const [a, b] = FIELDS[kind];
  const done = typed[a] ?? auto[a];
  const of = typed[b] ?? auto[b];
  if (of !== null && of !== undefined && done !== null && done !== undefined && done > of) {
    return kind === 'shoots' ? 'אי אפשר יותר ימים שבוצעו מכלל הימים.' : 'אי אפשר יותר ממה שבחבילה.';
  }
  return '';
}
