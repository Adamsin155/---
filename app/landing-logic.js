// "קליטת לקוחות קיימים": taking in the clients that came from the old system
// (docs/ops.md, section 41). Pure, no DOM: the intake screen (app/landing-ui.js), the
// line at the top of "המשימות שלי", the owners' control and the unit tests read the
// same answers.
//
// A client in landing (clients.landing) has no deadlines and no reminders. Each
// person goes over the items the system shows as open for them there and says, per
// item, "כבר בוצע", "עדיין פתוח" or "לא רלוונטי" (public.client_landing_marks: kept
// apart from the protocol's marks until the client is activated), then "סיימתי עם
// הלקוח" (public.client_landing_done). The client is activated when everyone who has
// something to go over there finished, or when an owner activates it.
//
//   marks  { itemKey: { choice: 'done' | 'open' | 'na', person, by_email, at } }  of one client
//   done   { person: { done: true, by_email, at } }                                of one client
import { STATIONS, PROCESSES, PEOPLE, APPROVALS } from './protocol.js';
import { clientState, itemsOf, inLanding, IMPORT_NOTE, parseDate, roundsOf } from './protocol-logic.js';
import { importKeys, stationIndex } from './client-open.js';
import { dayKeyIL, daysBetweenIL, partsIL } from './tz.js';

export const CHOICES = ['done', 'open', 'na'];
export const CHOICE_TEXT = { done: 'כבר בוצע', open: 'עדיין פתוח', na: 'לא רלוונטי' };
// The owners' one tap: clients in landing whose shoot day is this close.
export const SHOOT_SOON_DAYS = 14;

const inWork = (c) => c?.status === 'active' || c?.status === 'ending';
const settled = (m) => m?.choice === 'done' || m?.choice === 'na';
const baseKey = (key) => String(key).replace(/^r\d+\./, '');
const baseId = (id) => String(id).replace(/^r\d+-/, '');
const STATION_OF = new Map(STATIONS.flatMap((s, i) => s.procs.map((p) => [p, i])));
const dm = (d) => { const p = partsIL(d); return `${p.day}.${p.month}`; };

// The checks as they will be once the client is activated: what was said to be done or
// not relevant counts as imported history. A real mark always wins.
export function withIntake(checks = {}, marks = {}) {
  const out = { ...checks };
  for (const [key, m] of Object.entries(marks || {})) {
    if (!settled(m) || out[key]) continue;
    out[key] = { state: m.choice === 'na' ? 'na' : 'done', note: IMPORT_NOTE, at: m.at, by_email: m.by_email, staged: true };
  }
  return out;
}

// Who can go over this client at all (the same people the database lets read it):
// the office and Ilai always, an editor on the clients they edit (Nirel: every client
// of Natali), the photographer only around a shoot day. The owners have no items.
export function canTake(person, client, now = new Date()) {
  if (!person || !PEOPLE[person] || PEOPLE[person].sales || person === 'editor') return false;
  if (['irit', 'lior', 'ofir', 'ilai'].includes(person)) return true;
  if (client.editor === person || roundsOf(client).some((r) => r.editor === person)) return true;
  if (person === 'nirel') return client.shoot_type === 'natali';
  if (person === 'eli') {
    return [client.shoot_at, ...roundsOf(client).map((r) => r.shoot_at)].map(parseDate).filter(Boolean)
      .some((d) => { const n = daysBetweenIL(now, d); return n >= -7 && n <= 30; });
  }
  return false;
}

// The items the system shows as open for `person` on a client in landing: theirs,
// required, in a process that has started, with no real mark. An item they already
// answered stays in the list with its answer (so it can be changed). The weekly call
// is not asked about: it simply starts after the activation.
// Each: { key, label, proc, choice, by, approval }.
export function intakeItems(person, client, checks = {}, marks = {}, now = new Date()) {
  if (!person || !inLanding(client) || !inWork(client) || !canTake(person, client, now)) return [];
  const state = clientState(client, withIntake(checks, marks), now);
  const out = [];
  for (const s of state.states) {
    if (s.proc.recurring) continue;
    for (const i of itemsOf(person, s)) {
      if (i.optional || i.recurring) continue;
      // An item a later protocol version added is not a question of the taking-in: a
      // client from the old system is not asked about a step that did not exist then.
      if (i.fresh) continue;
      const real = checks[i.key];
      if (real && (real.state === 'done' || real.state === 'na')) continue;
      const m = marks?.[i.key] || null;
      if (!s.ready && !m) continue;
      out.push({ key: i.key, label: i.label, proc: s.proc, choice: m?.choice || null, by: m?.person || null, approval: APPROVALS.has(baseKey(i.key)) });
    }
  }
  return out;
}

// The station the system has the client in: the first one with unfinished work.
export function stationNow(client, checks = {}, now = new Date()) {
  const state = clientState(client, checks, now);
  for (let i = 0; i < STATIONS.length; i += 1) {
    if (STATIONS[i].key === 'renewal') break;
    if (state.states.some((s) => (s.proc.recurring ? s.holds : !s.complete) && !/^r\d+-/.test(s.proc.id) && STATION_OF.get(s.proc.id) === i)) return i;
  }
  return stationIndex('ongoing');
}

// Where the client evidently is, when the data itself says it is further than the
// guess of the import: its shoot day has passed (so everything up to the shoot day is
// behind it), or somebody already marked real work in a later station.
// { index, guessed, title, why } — why is null when there is no sign of anything.
export function evidentStation(client, checks = {}, now = new Date()) {
  const guessed = stationNow(client, checks, now);
  let index = guessed;
  let why = null;
  const shoot = parseDate(client.shoot_at);
  if (shoot && dayKeyIL(shoot) < dayKeyIL(now) && stationIndex('post') > index) {
    index = stationIndex('post');
    why = `יום הצילום כבר היה (${dm(shoot)})`;
  }
  for (const p of PROCESSES) {
    const at = STATION_OF.get(p.id);
    if (p.recurring || at === undefined || at <= index || STATIONS[at].key === 'renewal') continue;
    if (p.items.some((i) => { const c = checks[i.key]; return c && c.state === 'done' && c.note !== IMPORT_NOTE; })) {
      index = at;
      why = `כבר סומנה עבודה בתחנה ״${STATIONS[at].title}״`;
    }
  }
  return { index, guessed, title: STATIONS[index].title, why };
}

// The proposal for one person on one client: what is before the evident station is
// proposed as "כבר בוצע", the rest as "עדיין פתוח". Shown, never applied by itself;
// null when the data says nothing more than the import did. Items of a later shoot
// round are never proposed as done.
export function proposalFor(person, client, checks = {}, marks = {}, now = new Date()) {
  const items = intakeItems(person, client, checks, marks, now);
  const ev = evidentStation(client, checks, now);
  if (!items.length || !ev.why) return null;
  const done = [];
  const open = [];
  for (const i of items) {
    const at = STATION_OF.get(baseId(i.proc.id));
    (!/^r\d+-/.test(i.proc.id) && at !== undefined && at < ev.index ? done : open).push(i.key);
  }
  return done.length ? { done, open, why: ev.why, station: ev.title } : null;
}

// Everyone who still has to go over this client: has items there and has not said
// "סיימתי". The client is activated when this is empty.
export function waitingPeople(client, checks = {}, marks = {}, done = {}, now = new Date()) {
  if (!inLanding(client) || !inWork(client)) return [];
  return Object.keys(PEOPLE).filter((p) => !done?.[p]?.done && intakeItems(p, client, checks, marks, now).length > 0);
}

// One person's intake list: the clients in landing that have something of theirs,
// the ones not gone over yet first. Each: { client, items, proposal, finished }.
export function intakeFor(person, clients, checksBy = {}, marksBy = {}, doneBy = {}, now = new Date()) {
  const out = [];
  for (const client of clients || []) {
    const checks = checksBy[client.id] || {};
    const marks = marksBy[client.id] || {};
    const items = intakeItems(person, client, checks, marks, now);
    if (!items.length) continue;
    out.push({ client, items, proposal: proposalFor(person, client, checks, marks, now), finished: !!doneBy[client.id]?.[person]?.done });
  }
  const name = (x) => String(x.client.business || x.client.name || '');
  return out.sort((a, b) => (a.finished - b.finished) || name(a).localeCompare(name(b), 'he'));
}
export const intakeLeft = (list) => list.filter((x) => !x.finished).length;

// What a person left open on the clients they finished going over, while those are
// still in landing (somebody else has not finished): shown in "המשימות שלי" with no
// clock. Each: { client, items }.
export function quietWork(person, clients, checksBy = {}, marksBy = {}, doneBy = {}, now = new Date()) {
  return intakeFor(person, clients, checksBy, marksBy, doneBy, now).filter((x) => x.finished)
    .map((x) => ({ client: x.client, items: x.items.filter((i) => i.choice !== 'done' && i.choice !== 'na') }))
    .filter((x) => x.items.length);
}

// Correcting the station of a client in landing, as the import form does: everything
// before the station becomes imported history (`set`), and imported history from the
// station on is taken back (`clear`). Real marks are never touched.
export function stationPlan(client, checks = {}, stationKey) {
  if (stationIndex(stationKey) < 0) return null;
  const keys = importKeys(stationKey, { shootSet: !!client.shoot_at });
  const want = new Set(keys);
  const importable = new Set(PROCESSES.filter((p) => p.recurring !== 'weekly').flatMap((p) => p.items.filter((i) => !i.recurring).map((i) => i.key)));
  return {
    set: keys.filter((k) => !checks[k]),
    clear: Object.keys(checks).filter((k) => importable.has(k) && !want.has(k) && checks[k]?.note === IMPORT_NOTE),
  };
}

const shootDays = (client) => [client.shoot_at, ...roundsOf(client).map((r) => r.shoot_at)].map(parseDate).filter(Boolean);
// A shoot day of this client from today to SHOOT_SOON_DAYS ahead (the soonest), or null.
export function shootSoon(client, now = new Date(), days = SHOOT_SOON_DAYS) {
  const near = shootDays(client).filter((d) => { const n = daysBetweenIL(now, d); return n >= 0 && n <= days; }).sort((a, b) => a - b);
  return near[0] || null;
}

// The owners' control: how far the taking-in is.
//   total     clients in landing
//   people    [{ key, total, finished, left, alone }]: clients with something of theirs,
//             how many they finished, and `alone`: the ones that wait only for them
//   ready     clients nobody has to go over (any more): one tap activates them
//   soon      clients in landing with a shoot day in the coming two weeks
export function landingBoard(clients, checksBy = {}, marksBy = {}, doneBy = {}, now = new Date()) {
  const landing = (clients || []).filter((c) => inLanding(c) && inWork(c));
  const people = new Map();
  const row = (key) => people.get(key) || people.set(key, { key, total: 0, finished: 0, left: [], alone: [] }).get(key);
  const ready = [];
  for (const c of landing) {
    const checks = checksBy[c.id] || {};
    const marks = marksBy[c.id] || {};
    const waiting = waitingPeople(c, checks, marks, doneBy[c.id] || {}, now);
    if (!waiting.length) ready.push(c);
    for (const p of Object.keys(PEOPLE)) {
      if (!intakeItems(p, c, checks, marks, now).length) continue;
      const r = row(p);
      r.total += 1;
      if (waiting.includes(p)) { r.left.push(c); if (waiting.length === 1) r.alone.push(c); } else r.finished += 1;
    }
  }
  const order = Object.keys(PEOPLE);
  return {
    total: landing.length, clients: landing, ready,
    people: [...people.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)),
    soon: landing.filter((c) => shootSoon(c, now)).sort((a, b) => shootSoon(a, now) - shootSoon(b, now)),
  };
}
