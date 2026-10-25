// "מי מצלם" (the owner's decision of 25.10.2026): a shoot day with influencers (Natali Dadon,
// or Denis, Michel and Semion: the shoot type, as always), or without influencers, Lior and
// one photographer (Eli or Eliel). What the choice means is in app/protocol.js (crewOf,
// PHOTOGRAPHERS, SOLO); this is how the forms offer it and write it. Pure: no DOM of its own
// (crewOptions takes the page's `h`), so node tests it.
//
// Where it is kept: the client's own shoot in clients.deliverables.shoot_crew (with its
// shoot_type emptied), a round's in its entry of clients.rounds (shoot_crew, shoot_type null).
// Choosing a day with influencers writes the type and takes the crew away.
import { SHOOT_TYPES, PHOTOGRAPHERS, SOLO, crewOf } from './protocol.js';

// One value per choice, for one <select>: 'natali', 'dms', 'solo:eli', 'solo:eliel'.
export const SOLO_PREFIX = 'solo:';
export const WITH_LABEL = 'עם משפיענים';
export const SOLO_LABEL = `${SOLO.name}: ליאור + צלם`;
export const CREW_GROUPS = [
  { key: 'with', label: WITH_LABEL, options: Object.values(SHOOT_TYPES).map((t) => [t.key, t.name]) },
  { key: 'solo', label: SOLO_LABEL, options: Object.values(PHOTOGRAPHERS).map((p) => [`${SOLO_PREFIX}${p.key}`, `ליאור + ${p.name}`]) },
];
// The photographer of a choice ('eli' | 'eliel'), or null for a day with influencers.
export const soloOf = (choice) => {
  const v = String(choice || '');
  return v.startsWith(SOLO_PREFIX) && PHOTOGRAPHERS[v.slice(SOLO_PREFIX.length)] ? v.slice(SOLO_PREFIX.length) : null;
};
export const isChoice = (choice) => !!SHOOT_TYPES[choice] || !!soloOf(choice);
// The choice a shoot (the client, a round's entry, or a round's view) holds now ('' when none).
export const choiceOf = (x) => (crewOf(x) ? `${SOLO_PREFIX}${crewOf(x)}` : SHOOT_TYPES[x?.shoot_type] ? x.shoot_type : '');

// The fields of the client's own shoot for a choice, for updateClient: { shoot_type } and,
// when the crew changes, the whole deliverables with it (the rest of the package as it is).
// Nothing chosen: nothing written ({}).
export function crewPatch(client, choice) {
  const crew = soloOf(choice);
  const d = { ...(client?.deliverables || {}) };
  if (crew) return { shoot_type: null, deliverables: { ...d, shoot_crew: crew } };
  if (!SHOOT_TYPES[choice]) return {};
  if (!Object.prototype.hasOwnProperty.call(d, 'shoot_crew')) return { shoot_type: choice };
  delete d.shoot_crew;
  return { shoot_type: choice, deliverables: d };
}
// A round's entry with a choice (nothing chosen: the entry as it was).
export function roundWithCrew(r, choice) {
  const crew = soloOf(choice);
  const { shoot_crew: _old, ...rest } = r || {};
  if (crew) return { ...rest, shoot_type: null, shoot_crew: crew };
  if (SHOOT_TYPES[choice]) return { ...rest, shoot_type: choice };
  return { ...(r || {}) };
}

// The words of the shoot's time: on a day without influencers it is the shoot's own time.
export const timeLabel = (choice, { long = false } = {}) => (soloOf(choice)
  ? (long ? 'מועד הצילום' : 'שעת הצילום')
  : (long ? 'מועד הגעת המשפיענים' : 'הגעת המשפיענים'));

// The options of one <select>, in two groups, with `h` from the page. `empty`: the words of
// the "nothing chosen" option (null: none).
export function crewOptions(h, current = '', { empty = null } = {}) {
  return [
    empty === null ? null : h('option', { value: '', selected: !current }, empty),
    ...CREW_GROUPS.map((g) => h('optgroup', { label: g.label },
      ...g.options.map(([v, l]) => h('option', { value: v, selected: v === current }, l)))),
  ].filter(Boolean);
}
