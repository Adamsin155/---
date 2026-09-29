// Opening a client: the deal details that come from the catalog (package name,
// shoot type, quantities), and importing a client that is already mid-way.
// Pure logic, shared by the new-client dialog and the unit tests.
import { PACKAGES, TIERS, INFLUENCERS } from './catalog.js';
import { STATIONS } from './protocol.js';
import { applicableProcesses, packageDeliverables } from './protocol-logic.js';

// Every check an import makes carries exactly this note, so reports can leave it out.
export const IMPORT_NOTE = 'ייבוא';

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

// What an import marks done: every applicable item of every process in the
// stations before `stationKey`. The weekly call is recurring: it keeps its own
// rhythm and is never marked by an import.
export function importKeys(client, stationKey) {
  const i = stationIndex(stationKey);
  if (i < 0) return [];
  const before = new Set(STATIONS.slice(0, i).flatMap((s) => s.procs));
  return applicableProcesses(client)
    .filter((p) => before.has(p.id) && !p.recurring)
    .flatMap((p) => p.items.filter((it) => !it.recurring).map((it) => it.key));
}
