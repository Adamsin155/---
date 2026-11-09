// generated — edit app/ instead. Source: app/staff-notes-logic.js. Regenerate: node scripts/sync-functions.mjs
// "הערה מיוחדת" for one employee (Lior and the owner, 9.11.2026; docs/ops.md, section 114).
// The owners, Irit, Lior and Ofir write a note to one person on the team ("לא לגעת בלקוח
// מסעדת בוכרה"). It stays at the top of every page that person opens until one of them
// deletes it; the person gets one push when it is written (app/reminder-rules.js
// `staffNote`) and cannot remove it.
// Pure, no DOM and no network: the screens (app/staff-notes-ui.js), the reminder rule (a
// copy runs in the reminders function) and the unit tests read the same rules. The
// database decides who may do what (supabase/migrations/20261206100000_staff_notes.sql).
import { PEOPLE, TEAM_PEOPLE, isSales } from './protocol.js';

const OWNER = 'owner';

// ── Who ───────────────────────────────────
// Who writes and deletes the notes. The same list is in public.can_write_staff_notes().
export const WRITERS = [OWNER, 'irit', 'lior', 'ofir'];
// The viewer as a person key ('owner' for the owners), or null when unknown.
export const personOfViewer = (viewer) => {
  if (!viewer || viewer.error) return null;
  if (viewer.me) return viewer.me;
  return viewer.scope === 'office' ? OWNER : null;
};
export const canWriteNotes = (viewer) => WRITERS.includes(personOfViewer(viewer));
// Whom a note can be written to: everyone on the team, in the team's order.
export const NOTE_PEOPLE = () => TEAM_PEOPLE().map((p) => ({ key: p.key, name: p.name }));
export const personName = (key) => (key === OWNER ? 'הבעלים' : PEOPLE[key]?.name || key || '');
// Where the push opens: the person's first screen (the note is on every page).
export const noteUrl = (person) => (isSales(person) ? 'deal.html' : 'clients.html#mine');

// ── What ──────────────────────────────────
export const NOTE_MAX = 1000;
const known = (p) => NOTE_PEOPLE().some((x) => x.key === p);
// → { ok, errors: { person?, body? }, row: { person, body } }
export function validateNote({ person = '', body = '' } = {}) {
  const text = String(body || '').trim();
  const errors = {};
  if (!known(person)) errors.person = 'בוחרים למי ההערה.';
  if (!text) errors.body = 'כותבים את ההערה.';
  else if (text.length > NOTE_MAX) errors.body = `עד ${NOTE_MAX} תווים.`;
  const ok = !Object.keys(errors).length;
  return { ok, errors, row: ok ? { person, body: text } : null };
}

const live = (n) => !!n && !n.deleted_at;
const byOldest = (a, b) => new Date(a.created_at) - new Date(b.created_at);
// The notes a person sees at the top of every page: their own, not deleted, the oldest
// first (one written later goes under it, so what was on top stays put).
export const notesFor = (notes = [], person = null) => (person ? notes.filter((n) => live(n) && n.person === person).sort(byOldest) : []);
// The writers' list: the live notes by person, in the team's order; each person's newest first.
export function notesByPerson(notes = []) {
  const order = NOTE_PEOPLE().map((p) => p.key);
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  const groups = new Map();
  for (const n of notes.filter(live).sort((a, b) => byOldest(b, a))) {
    if (!groups.has(n.person)) groups.set(n.person, []);
    groups.get(n.person).push(n);
  }
  return [...groups].sort(([a], [b]) => rank(a) - rank(b)).map(([person, list]) => ({ person, name: personName(person), notes: list }));
}

// ── The one push ──────────────────────────
// A note pushes once, when it is written. Only notes written in the last FRESH_HOURS are
// candidates (the engine records an older step as stale anyway): a note loaded later is
// already on the person's screens.
export const FRESH_HOURS = 6;
export const freshNote = (n, now) => live(n) && !!n.created_at && now - new Date(n.created_at) >= 0 && now - new Date(n.created_at) < FRESH_HOURS * 36e5;
export const noteTitle = (n) => `הערה מיוחדת מ${personName(n.created_by) || 'המשרד'}`;
// The body of the push: the note, on one line, cut where a phone's banner still reads it.
export const PUSH_MAX = 180;
export const noteText = (body, max = PUSH_MAX) => {
  const s = String(body || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
