// Setting a client's characterization meeting or shoot day: the one write that the
// "קביעת מועד" dialogs do (app/clients.js openMeet / openShoot), for the calendar page's
// Google suggestions and its "פגישה חדשה" (the owner, 21.10.2026). The same fields, the
// same rules, the same questions:
//   - a meeting: a day and an hour, and who runs it (Ofir or Lior); updateClient({ char_at,
//     characterizer }); a first date also marks "נקבעה פגישה" (p03.scheduled) unless it is
//     already answered;
//   - a shoot day: a day and an hour and who films (a choice of app/shoot-crew.js: the shoot
//     type, or a day without influencers with its photographer, 25.10.2026); the
//     photographer's availability (Eli's, when he films it) and the usual order are asked
//     first (app/availability-ui.js confirmShootDay), and the reason given is kept with the
//     date (noteDateChange); updateClient({ shoot_at, shoot_type[, deliverables] }).
// app/clients.js still has its own copy of these few lines (it was being changed by
// another hand on 21.10.2026); it can call these two instead.
import { updateClient, setCheck } from './protocol-data.js';
import { noteDateChange } from './owner-data.js';
import { isChoice, soloOf, crewPatch } from './shoot-crew.js';

export const MEET_PEOPLE = ['ofir', 'lior'];
const SCHEDULED = 'p03.scheduled';
const answered = (check) => !!check && (check.state === 'done' || check.state === 'na');
const refuse = (text) => Object.assign(new Error(text), { rule: true });

// → { row, marked } (row: the client as saved). Throws { rule: true } with a sentence to show.
export async function saveMeeting(client, { at, person }, { checks = {} } = {}) {
  if (!(at instanceof Date) || Number.isNaN(+at)) throw refuse('בחרו יום ושעה לפגישה.');
  if (!MEET_PEOPLE.includes(person)) throw refuse('בחרו מי מבצע את האפיון.');
  const first = !client.char_at;
  const row = await updateClient(client.id, { char_at: at.toISOString(), characterizer: person });
  let marked = null;
  if (first && !answered(checks[SCHEDULED])) {
    try { marked = await setCheck(client.id, SCHEDULED, 'done'); } catch { /* stays open on the card */ }
  }
  return { row, marked };
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
  const row = await updateClient(client.id, { shoot_at: at.toISOString(), ...crewPatch(client, type) });
  if (asked.note) { try { await noteDateChange(client.id, 'shoot_at', null, at.toISOString(), asked.note); } catch { /* the date itself is saved */ } }
  return { ok: true, row };
}
