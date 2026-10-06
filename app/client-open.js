// Opening a client: the deal details that come from the catalog (package name,
// shoot type, quantities), and importing a client that is already mid-way.
// Pure logic, shared by the new-client dialog and the unit tests.
import { PACKAGES, TIERS, INFLUENCERS } from './catalog.js';
import { STATIONS, PROCESSES } from './protocol.js';
import { packageDeliverables, IMPORT_NOTE } from './protocol-logic.js';

// Every check an import makes carries exactly this note, so reports can leave it out.
export { IMPORT_NOTE };

// "New, opened by itself": only a client the signing trigger opened from a signed
// agreement. A batch import also writes without a session (created_by_email is
// 'system'), but it has no agreement and its history is marked "ייבוא": such a client
// is not news, so it gets no "לקוח חדש נפתח אוטומטית" note, no "חדש" tag and no alert
// (found 6.10.2026, after 39 clients were imported). `checks`: the client's own, by item key.
export const isImportedClient = (checks) => Object.values(checks || {}).some((c) => c?.note === IMPORT_NOTE);
export const openedBySigning = (client, checks) => !!client && client.created_by_email === 'system' && !!client.quote_id && !isImportedClient(checks);

// A package by its name, as the signing trigger writes it ("Social all in one · נטלי דדון").
export function packageName(id) {
  const p = PACKAGES[id];
  if (!p) return null;
  return `${TIERS.find((t) => t.id === p.tier)?.name || p.tier} · ${INFLUENCERS[p.influencer]?.name || p.influencer}`;
}

export const PACKAGE_OPTIONS = Object.keys(PACKAGES).map((id) => ({ id, name: packageName(id) }));

// Who comes to the shoot follows from the package itself, never from a guess on a name.
const SHOOT_OF = { natali: 'natali', simeon: 'dms' };
export const shootTypeOf = (id) => SHOOT_OF[PACKAGES[id]?.influencer] || null;

// Quantities for a package: with the agreement's add-ons when it has them
// (the same numbers the signing trigger stores), otherwise the package alone.
export function dealDeliverables(id, selection = null) {
  if (!PACKAGES[id]) return {};
  return packageDeliverables({ package: { id }, selection: selection || { paid: [], free: {} } });
}

export const stationIndex = (key) => STATIONS.findIndex((s) => s.key === key);

// What an import marks done: every item of every process in the stations before
// `stationKey`, including the ones that do not apply to the client yet. Whether it
// has a logo, or who came to the shoot, is often filled in on the card only after
// the import; an item that starts to apply then (a new logo, the other shoot day)
// is already behind the client and must not reopen as late. A check on an item
// that does not apply is ignored by clientState. The weekly call is recurring: it
// keeps its own rhythm and is never marked by an import.
// shootSet false: the client is imported before its shoot day took place and no shoot date
// was given, so setting the shoot day (11, 11ב; in the first station since v6) is still
// open work for Irit, not history.
export function importKeys(stationKey, { shootSet = true } = {}) {
  const i = stationIndex(stationKey);
  if (i < 0) return [];
  const before = new Set(STATIONS.slice(0, i).flatMap((s) => s.procs));
  if (!shootSet && i <= stationIndex('shoot')) for (const p of ['p11', 'p11b']) before.delete(p);
  return PROCESSES.filter((p) => before.has(p.id) && !p.recurring)
    .flatMap((p) => p.items.filter((it) => !it.recurring).map((it) => it.key));
}
