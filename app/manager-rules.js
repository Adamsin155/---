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
export const SHOOT_TABLE_VIEWERS = ['ofir', 'lior']; // and the owner: "טבלת ימי צילום" (6.10.2026)

const known = (v) => !!v && !v.error;
export const isManager = (v) => isOwnerView(v) || (known(v) && MANAGERS.includes(v.me));
export const canArchive = (v) => isOwnerView(v) || (known(v) && ARCHIVERS.includes(v.me));
// Money (the owner's decision, 6.10.2026): the prices of the agreements in the table and
// in its CSV, the amounts in the list of sent quotes, and every sum of income, are the
// two owners' only. In the database: public.sees_money()
// (supabase/migrations/20261013100000_money_owners_only.sql).
export const seesFinance = (v) => isOwnerView(v);
// The list of sent quotes (quotes.html): the owners, and Irit, who builds the contracts
// (she sees it without the amounts). public.quotes answers nobody else, except with the
// quotes a person made, and the approvers with the contracts that wait for them.
export const QUOTE_LIST_VIEWERS = ['irit'];
export const canSeeQuoteList = (v) => isOwnerView(v) || (known(v) && QUOTE_LIST_VIEWERS.includes(v.me));
// Stav's and Amos's deals with what was agreed (the discount, a price typed by hand):
// Irit, who prepares the contract from them, and the owners.
export const canSeeDeals = (v) => canSeeQuoteList(v);
// The builder of a quote and of the contract (index.html), 8.10.2026: whoever prepares a
// contract. Ofir approves an exceptional one from his approvals card and builds none (the
// owner's decision of 8.10.2026), so his screens leave the builder out too. The create-quote function answers the office only
// (public.is_office(): these and Ilai); Ilai builds no contracts, so the screens leave him
// out, and so the editors, Nirel, Eli and the field sales, whom the server refuses anyway.
export const QUOTE_BUILDERS = ['irit', 'lior'];   // and the owner
export const canBuildQuote = (v) => isOwnerView(v) || (known(v) && QUOTE_BUILDERS.includes(v.me));
// "החלטות" (decisions.html) and "בקרה ושיוך" (qa.html): Lior's and Ofir's screens, and the
// owners'. Irit is of the office and the database would take her writes, but neither
// screen is her work (8.10.2026). Nobody else's side of them changed.
export const NOT_ON_OFFICE_QUEUES = ['irit'];
export const canSeeOfficeQueues = (v) => known(v) && v.scope === 'office' && !NOT_ON_OFFICE_QUEUES.includes(v.me);
export const canSeeTable =(v) => isOwnerView(v) || (known(v) && TABLE_VIEWERS.includes(v.me));
// The shoot-day table (owner.html#shoots, app/shoot-table.js): read-only, no prices in it.
export const canSeeShootTable = (v) => isOwnerView(v) || (known(v) && SHOOT_TABLE_VIEWERS.includes(v.me));

// The permanent deletion asks for the business name typed again. Compared as people
// see it (no direction marks, spaces collapsed, any case), like private.same_name()
// in the migration, which decides.
const plain = (s) => String(s ?? '').replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
export const sameName = (typed, name) => plain(name) !== '' && plain(typed) === plain(name);

// ── The two profiles ────────────────────────
// The owners, Ofir, Lior (the owner's request of 6.10.2026) and Irit (7.10.2026; until
// then her switch was the first two entries of her one menu) have them (hasProfiles):
// they start in the personal profile, a short menu of their own daily work, and one
// button at the top of every screen opens the manager profile ("מבט מנהל"), which
// alone holds the management screens, with "חזרה למשימות שלי" in the same spot
// (app/shell.js draws it; profileMenu and profileOf in app/shell-rules.js decide).
// A matter of screens only: what each of them reads and writes is the database's.
export const PROFILED = ['ofir', 'lior', 'irit'];     // and the owner
export const hasProfiles = (v) => isOwnerView(v) || (known(v) && PROFILED.includes(v.me));
export const MODES = {
  mine: { key: 'mine', label: 'המשימות שלי', href: 'clients.html#mine' },
  manager: { key: 'manager', label: 'מבט מנהל', href: 'owner.html#now' },
};
export const BACK_LABEL = 'חזרה למשימות שלי';
// Where the manager profile opens: screen 1 for the managers, screen 2 for Lior (who has no screen 1).
export const managerHome = (v) => (isManager(v) ? MODES.manager.href : 'owner.html#all');
// The choice lives in this tab only (sessionStorage) since 9.10.2026: "מבט מנהל" is not
// remembered across launches of the app, new tabs or sign-ins; everyone starts in the
// personal profile (docs/ops.md, section 54). Until then it was kept for the browser
// (localStorage, 'astrateg.profile'; before 6.10.2026 'astrateg.mode'): never read again.
const MODE_KEY = 'astrateg.profile';
const tabStore = () => { try { return globalThis.sessionStorage; } catch { return undefined; } };
const oldStore = () => { try { return globalThis.localStorage; } catch { return undefined; } };
// Everyone starts in their own work; the manager profile is a choice.
export const defaultMode = () => 'mine';
// The profile chosen in this tab, for whoever has two; null for anyone else.
export function modeOf(v, storage = tabStore()) {
  if (!hasProfiles(v)) return null;
  let saved = null;
  try { saved = storage?.getItem(MODE_KEY) || null; } catch { /* no storage */ }
  return MODES[saved] ? saved : defaultMode(v);
}
export function setMode(mode, storage = tabStore()) {
  if (!MODES[mode]) return;
  try { storage?.setItem(MODE_KEY, mode); } catch { /* no storage */ }
}
// A sign-in or a sign-out: whoever comes next starts in the personal profile.
export function resetMode(storage = tabStore()) {
  try { storage?.removeItem(MODE_KEY); } catch { /* no storage */ }
  try { oldStore()?.removeItem(MODE_KEY); } catch { /* no storage */ }
}
