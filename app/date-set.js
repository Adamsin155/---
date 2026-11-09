// Setting a client's characterization meeting or shoot day: the one write that the
// "קביעת מועד" dialogs do (app/clients.js openMeet / openShoot), for the calendar page's
// Google suggestions and its "פגישה חדשה" (the owner, 21.10.2026). The same fields, the
// same rules, the same questions:
//   - a meeting: a day and an hour, and who runs it (Noam or Ofir, or Lior); updateClient({ char_at,
//     characterizer }). Since protocol v13 the date itself closes Irit's line "לקבוע אפיון" (until
//     then a first date also marked "נקבעה פגישה", p03.scheduled);
//   - a shoot day: a day and an hour and who films (a choice of app/shoot-crew.js: the shoot
//     type, or a day without influencers with its photographer, 25.10.2026); the
//     photographer's availability (Eli's, when he films it) and the usual order are asked
//     first (app/availability-ui.js confirmShootDay), and the reason given is kept with the
//     date (noteDateChange); updateClient({ shoot_at, shoot_type[, deliverables] }). v13: once the
//     client's own shoot day is behind it, the date goes to the next day of the package that has
//     none (shootTarget: a round without a date, or a new round when its line is open,
//     app/shoot-plan.js nextShootDay), so "לקבוע" in the calendar sets day 2 as day 1.
// app/clients.js still has its own copy of these few lines (it was being changed by
// another hand on 21.10.2026); it can call these two instead.
import { updateClient } from './protocol-data.js';
import { noteDateChange } from './owner-data.js';
import { isChoice, soloOf, crewPatch, roundWithCrew } from './shoot-crew.js';
import { roundsOf, isMonthlyRound, parseDate } from './protocol-logic.js';
import { nextShootDay } from './shoot-plan.js';
import { dayKeyIL } from './tz.js';
import { CHARACTERIZERS } from './protocol.js';

export const MEET_PEOPLE = CHARACTERIZERS; // Noam, Ofir, or Lior when nobody else can (app/protocol.js)
const refuse = (text) => Object.assign(new Error(text), { rule: true });

// → { row, marked: null } (row: the client as saved). Throws { rule: true } with a sentence to show.
export async function saveMeeting(client, { at, person }) {
  if (!(at instanceof Date) || Number.isNaN(+at)) throw refuse('בחרו יום ושעה לפגישה.');
  if (!MEET_PEOPLE.includes(person)) throw refuse('בחרו מי מבצע את האפיון.');
  const row = await updateClient(client.id, { char_at: at.toISOString(), characterizer: person });
  return { row, marked: null };
}

// Which shoot day a date goes to (v13): { round: null } the client's own (no date yet, or a coming
// one: it is moved); { round: n } a shoot round that has no date; { add: n } a new round, the next day
// of the package whose line is open; null when the client's day is behind it and nothing is open.
export function shootTarget(client, now = new Date()) {
  const own = parseDate(client?.shoot_at);
  if (!own || dayKeyIL(own) >= dayKeyIL(now)) return { round: null };
  const open = roundsOf(client).filter((r) => !isMonthlyRound(r)).find((r) => !r.shoot_at);
  if (open) return { round: open.n };
  if (nextShootDay(client, now)) return { add: Math.max(1, ...roundsOf(client).map((r) => Number(r.n) || 0)) + 1 };
  return null;
}

// → { ok: false } when the question about the day was cancelled, or { ok: true, row }.
export async function saveShootDay(client, { at, type }, { me = null } = {}) {
  if (!(at instanceof Date) || Number.isNaN(+at)) throw refuse('בחרו יום ושעה ליום הצילום.');
  if (!isChoice(type)) throw refuse('בחרו מי מצלם.');
  let asked = { ok: true, note: null };
  try {
    const A = await import('./availability-ui.js');
    const crew = soloOf(type);
    asked = await A.confirmShootDay({ shootAt: at, charAt: client.char_at, own: client.shoot_at, me, who: crew || 'eli' });
  } catch { /* nothing known here: the date is saved as chosen */ }
  if (!asked.ok) return { ok: false };
  const target = shootTarget(client) || { round: null };
  if (target.round === null) {
    const row = await updateClient(client.id, { shoot_at: at.toISOString(), ...crewPatch(client, type) });
    if (asked.note) { try { await noteDateChange(client.id, 'shoot_at', null, at.toISOString(), asked.note); } catch { /* the date itself is saved */ } }
    return { ok: true, row };
  }
  // A later day of the package: a round's date, as "הוספת סבב צילום" writes it (app/client-card.js).
  const rounds = roundsOf(client);
  const next = target.add
    ? [...rounds, { ...roundWithCrew({ n: target.add }, type), shoot_at: at.toISOString(), editor: null, start_at: new Date().toISOString() }]
    : rounds.map((r) => (r.n === target.round ? { ...roundWithCrew(r, type), shoot_at: at.toISOString() } : r));
  const row = await updateClient(client.id, { rounds: next });
  const n = target.add || target.round;
  if (asked.note) { try { await noteDateChange(client.id, 'round_shoot_at', n, at.toISOString(), asked.note); } catch { /* the date itself is saved */ } }
  return { ok: true, row, round: n };
}
