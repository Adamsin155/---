// generated — edit app/ instead. Source: app/manager-rules.js. Regenerate: node scripts/sync-functions.mjs
// Who is a manager, and the two profiles a manager switches between (the owner's
// decision, 3.10.2026): the owner (Adam, no person), Ofir and Irit see everything and
// switch between "המשימות שלי" (their own tasks, clients.html#mine) and the manager
// profile (owner.html: "מה דורש אותי", "כל הלקוחות במבט" and the table). Until 4.11.2026 Lior
// saw everything except money (screen 2 and the table without its prices); since then he is a
// manager as Irit and Ofir, with the money. Everyone else sees only what they must do.
// Screens only; the database decides (supabase/migrations/20261003140000_manager_features.sql:
// is_manager(), can_archive_clients(), manager_client_finance()). No DOM here, so
// node can test it (tests/manager.test.mjs).
import { isOwnerView } from './team-rules.js';

// Irit, Ofir and Lior (the owner's decision of 4.11.2026; docs/ops.md, section 96): what the
// owners have and what any staff member can do, except security and the payments app. One list,
// the managers' (MANAGERS): every manager screen and work action, the money, the archive.
// What stays the owners' alone (isOwnerView): the payments app, the team page's actions
// (sign-in links, adding or removing staff, the vault flag and code, WhatsApp on and off, the
// Claude connector), the permanent purge of a client (canPurge), the evening summary's message.
// In the database: public.sees_income() and public.is_manager()
// (supabase/migrations/20261128100000_managers_all.sql); public.sees_money() stays the owners'.
export const MANAGERS = ['irit', 'ofir', 'lior'];  // and the owner
export const ARCHIVERS = MANAGERS;                  // and the owner: archive and restore a client
export const TABLE_VIEWERS = ['irit', 'ofir', 'lior'];
export const SHOOT_TABLE_VIEWERS = ['ofir', 'lior', 'irit']; // and the owner: "טבלת ימי צילום" (6.10.2026; Irit 4.11.2026)

const known = (v) => !!v && !v.error;
export const isManager = (v) => isOwnerView(v) || (known(v) && MANAGERS.includes(v.me));
export const canArchive = (v) => isOwnerView(v) || (known(v) && ARCHIVERS.includes(v.me));
// The permanent purge of an archived client: the owners only (public.can_archive_clients(),
// which public.purge_client() asks; Ofir until 4.11.2026).
export const canPurge = (v) => isOwnerView(v);
// Money (the owner's decision, 6.10.2026; the managers since 4.11.2026): the prices of the
// agreements in the table and in its CSV, the amounts in the list of sent quotes, and every
// sum of income: the owners and the managers. In the database: public.sees_income()
// (supabase/migrations/20261128100000_managers_all.sql). The payments app is not this: it
// stays public.payout_owners' (the menu's "אסטרטג פיימנט" is isOwnerView's).
export const seesFinance = (v) => isManager(v);
// The list of sent quotes (quotes.html): the owners, and Irit, who builds the contracts
// (she sees it without the amounts). public.quotes answers nobody else, except with the
// quotes a person made, and the approvers with the contracts that wait for them.
// QUOTE_LIST_VIEWERS also gives Irit her line "ממתינות לחתימה" in "המשימות שלי" (app/mine-flow.js).
export const QUOTE_LIST_VIEWERS = ['irit'];
// The same list WITH its amounts and the month's two sums ("נשלח החודש", "נחתם החודש"):
// the owners, and Ofir since 29.10.2026 (the owner: "לאופיר את העסקאות של חודש ... כמו שאתה
// רואה"), and Irit and Lior since 4.11.2026 (the managers: every sum of income is theirs too,
// seesFinance; the payments app stays the owners'). In the database: public.sees_quote_money(),
// which asks public.sees_income() (supabase/migrations/20261128100000_managers_all.sql).
export const QUOTE_MONEY_VIEWERS = MANAGERS; // Ofir since 29.10.2026, Irit and Lior since 4.11.2026
export const seesQuoteMoney = (v) => isOwnerView(v) || (known(v) && QUOTE_MONEY_VIEWERS.includes(v.me));
export const canSeeQuoteList = (v) => seesQuoteMoney(v) || (known(v) && QUOTE_LIST_VIEWERS.includes(v.me));
// Stav's and Amos's deals with what was agreed (the discount, a price typed by hand):
// Irit and Ofir, whoever takes it prepares the contract (31.10.2026), and the owners.
export const DEAL_VIEWERS = MANAGERS; // and Lior since 4.11.2026 (he hands a deal over, as the owners; only Irit and Ofir take one)
export const canSeeDeals = (v) => isOwnerView(v) || (known(v) && DEAL_VIEWERS.includes(v.me));
// The builder of a quote and of the contract (index.html), 8.10.2026: whoever prepares a
// contract. Ofir builds them too (the owner, 28.10.2026; until then he only approved an
// exceptional one from his approvals card). The create-quote function answers the office only
// (public.is_office(): these and Ilai); Ilai builds no contracts, so the screens leave him
// out, and so the editors, Nirel, Eli and the field sales, whom the server refuses anyway.
export const QUOTE_BUILDERS = ['irit', 'lior', 'ofir'];   // and the owner
export const canBuildQuote = (v) => isOwnerView(v) || (known(v) && QUOTE_BUILDERS.includes(v.me));
// "החלטות" (decisions.html) and "בקרה ושיוך" (qa.html): Lior's and Ofir's screens, and the
// owners'. Irit is of the office and the database would take her writes, but neither
// screen is her work (8.10.2026). Nobody else's side of them changed.
export const NOT_ON_OFFICE_QUEUES = []; // Irit until 4.11.2026 (the managers have every screen)
export const canSeeOfficeQueues = (v) => known(v) && v.scope === 'office' && !NOT_ON_OFFICE_QUEUES.includes(v.me);
// "בקרה ושיוך": since 3.11.2026 Irit too (the owner: "עירית לא רואה אצלה את בקרה ושיוך").
export const QA_EXTRA = ['irit'];
export const canSeeQa = (v) => canSeeOfficeQueues(v) || (known(v) && v.scope === 'office' && QA_EXTRA.includes(v.me));
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
// Where the manager profile opens: screen 1 for the managers (Lior too since 4.11.2026), screen 2
// for anyone else with profiles (nobody today).
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
