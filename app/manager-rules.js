// Who is a manager, and the two profiles a manager switches between (the owner's
// decision, 3.10.2026): the owner (Adam, no person), Ofir and Irit see everything and
// switch between "המשימות שלי" (their own tasks, clients.html#mine) and the manager
// profile (owner.html: "מה דורש אותי", "כל הלקוחות במבט" and the table). Lior sees
// everything except money: "כל הלקוחות במבט" and the table without its price
// columns, and no switch. Everyone else sees only what they must do.
// Screens only; the database decides (supabase/migrations/20261003140000_manager_features.sql:
// is_manager(), can_archive_clients(), manager_client_finance()). No DOM here, so
// node can test it (tests/manager.test.mjs).
import { isOwnerView } from './team-rules.js';

export const MANAGERS = ['irit', 'ofir'];     // and the owner
export const ARCHIVERS = ['ofir'];            // and the owner: archive and delete clients
export const TABLE_VIEWERS = ['irit', 'ofir', 'lior'];

const known = (v) => !!v && !v.error;
export const isManager = (v) => isOwnerView(v) || (known(v) && MANAGERS.includes(v.me));
export const canArchive = (v) => isOwnerView(v) || (known(v) && ARCHIVERS.includes(v.me));
// The prices of the agreements: the managers. Never Lior.
export const seesFinance = (v) => isManager(v);
export const canSeeTable = (v) => isOwnerView(v) || (known(v) && TABLE_VIEWERS.includes(v.me));

// ── The two profiles ────────────────────────
export const MODES = {
  mine: { key: 'mine', label: 'המשימות שלי', href: 'clients.html#mine' },
  manager: { key: 'manager', label: 'מבט מנהל', href: 'owner.html#now' },
};
const MODE_KEY = 'astrateg.mode';
// The owner starts in the manager profile (as before); Irit and Ofir in their own work.
export const defaultMode = (v) => (isOwnerView(v) ? 'manager' : 'mine');
// The profile this browser last chose, for a manager; null for anyone else.
export function modeOf(v, storage = globalThis.localStorage) {
  if (!isManager(v)) return null;
  let saved = null;
  try { saved = storage?.getItem(MODE_KEY) || null; } catch { /* no storage */ }
  return MODES[saved] ? saved : defaultMode(v);
}
export function setMode(mode, storage = globalThis.localStorage) {
  if (!MODES[mode]) return;
  try { storage?.setItem(MODE_KEY, mode); } catch { /* no storage */ }
}
// Which profile a page belongs to: owner.html is the manager's, "מה עליי" is mine;
// any other page shows the profile last chosen.
export function modeOfPage(path, hash, saved) {
  const page = String(path || '').split('/').pop() || 'index.html';
  if (page === 'owner.html') return 'manager';
  if (page === 'clients.html' && (!hash || hash === '#mine')) return 'mine';
  return saved;
}
