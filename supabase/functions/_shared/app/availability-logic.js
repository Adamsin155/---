// generated — edit app/ instead. Source: app/availability-logic.js. Regenerate: node scripts/sync-functions.mjs
// The photographer's monthly availability (his protocol, step 1 "העברת זמינות חודשית";
// docs/ops.md, section 39). Pure: no DOM and no network, Israel time only. His card
// (app/availability-ui.js on shoot.html), the hint where the office sets a shoot day,
// the reminder rules (the block at the end of app/reminder-rules.js, on the server too)
// and the unit tests read the same functions; the database holds the same rules
// (supabase/migrations/20261016100000_photographer_availability.sql).
//
//   The rule: by the 15th of each month the photographer hands over every date he is
//   free for shoot days in the NEXT month. In month M the month asked for is M+1:
//   open from the 1st, highlighted from the 10th, late from the 16th. A month is
//   handed over only by an explicit submit; no free day at all is an explicit "none".
//   After the 15th a free day comes off only as an unexpected change (בלת״ם): once a
//   calendar month, at most two consecutive dates (48 hours). A day with a shoot day
//   already set is "taken": it never comes off through an update.
//
// Rows, as the database keeps them:
//   months   public.photographer_months  { person, month 'YYYY-MM-01', days ['YYYY-MM-DD'], none, submitted_at, updated_at, by_person }
//   changes  public.photographer_changes { id, person, reported_at, reported_month, days, shoot_days, note }
//   taken    { 'YYYY-MM-DD': how many shoot days are set on that day } (public.photographer_taken)
import { PEOPLE } from './protocol.js';
import { isBusinessDay, roundsOf, parseDate, clientLabel } from './protocol-logic.js';
import { partsIL, dateIL, dayKeyIL, addDaysIL } from './tz.js';

// Who hands availability over. The ONE list (with public.photographer_people() in the
// migration): a second photographer is added here and there, and nothing else changes.
export const PHOTOGRAPHERS = ['eli'];
// Who reads it besides the photographer himself (public.can_read_availability).
export const READERS = ['owner', 'irit', 'lior', 'ofir'];
// Who is told (missing after the 15th, handed over, an unexpected change): the work
// manager and whoever sets the shoot days.
export const MANAGERS = ['irit', 'lior'];
// Who may enter it in his name, after a phone call (public.can_manage_availability).
export const ON_BEHALF = ['owner', 'irit', 'lior'];

export const DEADLINE_DAY = 15;
export const NUDGE_DAY = 10;
export const CHANGE_MAX_DAYS = 2;   // 48 hours
export const WEEK_AHEAD = 7;        // "at least a week ahead, where possible"
export const REMIND_HOUR = 10;      // after the 08:30 digest and its 09:00–09:30 fold
export const NOTE_MAX = 300;
export const AVAILABILITY_URL = 'shoot.html#availability';
export const OFFICE_URL = 'prep.html#availability';

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
export const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const dayOf = (v) => String(v || '').slice(0, 10);
const utcOf = (dayKey) => Date.UTC(+dayKey.slice(0, 4), +dayKey.slice(5, 7) - 1, +dayKey.slice(8, 10));

// ── Months ('YYYY-MM') and days ('YYYY-MM-DD'), Israel calendar ──
export const monthKeyOf = (date) => { const p = partsIL(date); return `${p.year}-${pad(p.month)}`; };
export const monthOfDay = (dayKey) => dayOf(dayKey).slice(0, 7);
export function addMonths(key, n) {
  const t = +key.slice(0, 4) * 12 + (+key.slice(5, 7) - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
export function monthDays(key) {
  const n = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7), 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${key}-${pad(i + 1)}`);
}
// A bare calendar day has a weekday of its own, whatever the device's time zone.
export const weekdayOfDay = (dayKey) => new Date(utcOf(dayKey)).getUTCDay();
export const monthName = (key, now = null) => `${MONTHS[+key.slice(5, 7) - 1]}${now && +key.slice(0, 4) !== partsIL(now).year ? ` ${key.slice(0, 4)}` : ''}`;
export const dayShort = (dayKey) => `${+dayKey.slice(8, 10)}.${+dayKey.slice(5, 7)}`;
export const dayLong = (dayKey) => `יום ${WEEKDAYS[weekdayOfDay(dayKey)]} ${dayShort(dayKey)}`;
// "12.11" or "12.11–13.11".
export const daysWords = (days) => { const l = [...days].map(dayOf).sort(); return l.length > 1 ? `${dayShort(l[0])}–${dayShort(l.at(-1))}` : l.length ? dayShort(l[0]) : ''; };
export const personName = (key) => PEOPLE[key]?.name || key;

// ── Which month is asked for, and when ─────
// In month M the photographer is asked for M+1: 'open' on the 1st–9th, 'soon' on the
// 10th–15th (the card is highlighted), 'late' from the 16th.
export function askOf(now = new Date()) {
  const p = partsIL(now);
  const current = monthKeyOf(now);
  return {
    current, month: addMonths(current, 1),
    phase: p.day > DEADLINE_DAY ? 'late' : p.day >= NUDGE_DAY ? 'soon' : 'open',
    daysLeft: DEADLINE_DAY - p.day,
    deadlineDay: `${current}-${pad(DEADLINE_DAY)}`,
    deadline: dateIL(p.year, p.month, DEADLINE_DAY, 23, 59, 59, 999),
  };
}
const backToBusinessDay = (d) => { let x = d; while (!isBusinessDay(x)) x = addDaysIL(x, -1); return x; };
// The reminders of the month `now` is in: quiet on the 10th, a ring on the 15th and
// on the business day before it. A day the office is closed (Friday, Saturday, a
// holiday) moves back to the business day before; the managers' line starts on the 16th.
export function remindTimes(now = new Date()) {
  const p = partsIL(now);
  const at = (day) => dateIL(p.year, p.month, day, REMIND_HOUR);
  const last = backToBusinessDay(at(DEADLINE_DAY));
  const first = backToBusinessDay(addDaysIL(last, -1));
  const nudge = backToBusinessDay(at(NUDGE_DAY));
  return { quiet: nudge < first ? nudge : null, first, last, managersFrom: dateIL(p.year, p.month, DEADLINE_DAY + 1) };
}
// From the 16th: the managers' daily line.
export const missingForManagers = (now = new Date()) => partsIL(now).day > DEADLINE_DAY;

// ── Reading the rows ───────────────────────
export const monthRow = (months, person, key) => (months || []).find((m) => m.person === person && monthOfDay(m.month) === key) || null;
export const freeDays = (row) => new Set((row?.days || []).map(dayOf));
// Days taken off by an unexpected change (they are no longer in the month's days).
export function changedDays(changes, person) {
  const out = new Set();
  for (const c of changes || []) if (c.person === person) for (const d of c.days || []) out.add(dayOf(d));
  return out;
}
export const takenOn = (taken, day, own = null) => Math.max(0, (taken?.[day] || 0) - (own && dayOf(own) === day ? 1 : 0));
// The unexpected change this person already reported in the calendar month of `now`.
export const changeThisMonth = (changes, person, now = new Date()) => (changes || [])
  .find((c) => c.person === person && (c.reported_month ? monthOfDay(c.reported_month) : monthKeyOf(new Date(c.reported_at))) === monthKeyOf(now)) || null;

// "12 ימים פנויים", "יום פנוי אחד", "אין ימים פנויים".
export function freeSummary(row) {
  const n = freeDays(row).size;
  return !n ? 'אין ימים פנויים' : n === 1 ? 'יום פנוי אחד' : `${n} ימים פנויים`;
}

// One day for one photographer, as the office sees it when it picks a shoot date:
//   'taken'    another shoot day is already set on it (`own`: the saved date of the
//              shoot being edited, which does not count against itself)
//   'free'     he marked it free
//   'busy'     the month was handed over and the day is not in it (`changed`: he took
//              it off as an unexpected change)
//   'unknown'  he has not handed that month over yet
export function dayStatus({ day, person, months = [], changes = [], taken = {}, own = null }) {
  const key = dayOf(day);
  const month = monthOfDay(key);
  const row = monthRow(months, person, month);
  const base = !row ? 'unknown' : freeDays(row).has(key) ? 'free' : 'busy';
  const changed = base !== 'free' && changedDays(changes, person).has(key);
  return { day: key, month, person, base, changed, status: takenOn(taken, key, own) > 0 ? 'taken' : base };
}
// The line next to the date.
export function dayHintText(st, now = null) {
  const name = personName(st.person);
  if (st.status === 'taken') return `ביום הזה כבר קבוע יום צילום אחר${st.base === 'free' ? ` (${name} סימן אותו כפנוי)` : ''}.`;
  if (st.status === 'free') return `${name} סימן את היום הזה כפנוי.`;
  if (st.status === 'unknown') return `${name} עוד לא מסר זמינות ל${monthName(st.month, now)}. לוודא איתו לפני שסוגרים.`;
  return st.changed ? `${name} דיווח בלת״ם על היום הזה: הוא לא פנוי.` : `${name} לא סימן את היום הזה כפנוי.`;
}
// A few words under "אלי הצלם" where the office ticks his approval (never the tick itself).
export function dayShortNote(st) {
  if (st.base === 'free') return 'סימן את היום כפנוי';
  if (st.base === 'unknown') return 'עוד לא מסר זמינות לחודש הזה';
  return st.changed ? 'דיווח בלת״ם על היום הזה' : 'לא סימן את היום כפנוי';
}
// What the office is asked to confirm, with a reason: a day he did not mark free in a
// month he handed over, and a day that already has a shoot. A month not handed over
// yet is said in the hint only (his approval is still ticked by hand, as before).
export function availabilityConcerns({ day, months = [], changes = [], taken = {}, own = null, people = PHOTOGRAPHERS, now = null }) {
  const out = [];
  if (!day) return out;
  let takenSaid = false;
  for (const person of people) {
    const st = dayStatus({ day, person, months, changes, taken, own });
    if (st.status === 'taken') { if (!takenSaid) out.push('ביום הזה כבר קבוע יום צילום אחר.'); takenSaid = true; }
    if (st.base === 'busy') out.push(dayHintText({ ...st, status: 'busy' }, now));
  }
  return out;
}
export const exceptionNote = (concerns, reason) => `אושר למרות: ${concerns.join(' ')} סיבה: ${String(reason || '').trim()}`.slice(0, 500);

// ── The limits (the database enforces the same) ──
// After the 15th of the month before, a free day comes off only as an unexpected change.
export const removalLocked = (monthKey, now = new Date()) => dayKeyIL(now) > `${addMonths(monthKey, -1)}-${pad(DEADLINE_DAY)}`;
const CALL = 'להתקשר לליאור';
export const TEXT = {
  empty: 'לסמן את הימים הפנויים, או לבחור ״אין לי ימים פנויים בחודש הזה״.',
  taken: (days) => `ב־${[...days].map(dayShort).join(', ')} כבר קבוע יום צילום, ואי אפשר להוריד אותו כאן. אם אי אפשר להגיע: ${CALL}.`,
  locked: `אחרי ה־${DEADLINE_DAY} בחודש יום פנוי יורד רק כבלת״ם (פעם בחודש, עד 48 שעות). להוסיף ימים אפשר תמיד.`,
  span: `בלת״ם הוא עד 48 שעות: יום אחד או יומיים רצופים. לשינוי גדול יותר: ${CALL}.`,
  pick: 'לבחור יום אחד או יומיים רצופים.',
  past: 'אי אפשר לדווח בלת״ם על יום שעבר.',
  used: (c) => `כבר דיווחת על בלת״ם החודש (${daysWords(c?.days || [])}). בלת״ם אפשר פעם אחת בחודש. לשינוי נוסף: ${CALL}.`,
  notFree: 'אפשר לדווח בלת״ם רק על יום שסימנת כפנוי או שקבוע בו יום צילום.',
};
// What stops a submit or an update; null when it may go.
export function submitProblem({ month, days = [], none = false, row = null, taken = {}, now = new Date(), onBehalf = false }) {
  const list = [...new Set([...days].map(dayOf))];
  if (none ? list.length > 0 : list.length === 0) return { code: 'empty', text: TEXT.empty };
  if (list.some((d) => monthOfDay(d) !== month)) return { code: 'month', text: 'יום שלא שייך לחודש הזה.' };
  if (!row || onBehalf) return null;
  const removed = [...freeDays(row)].filter((d) => !list.includes(d));
  if (!removed.length) return null;
  const held = removed.filter((d) => takenOn(taken, d) > 0);
  if (held.length) return { code: 'taken', text: TEXT.taken(held) };
  if (removalLocked(month, now)) return { code: 'locked', text: TEXT.locked };
  return null;
}
export const consecutive = (days) => { const l = [...days].map(dayOf).sort(); return l.every((d, i) => i === 0 || utcOf(d) - utcOf(l[i - 1]) === 864e5); };
// What stops an unexpected change; null when it may go.
export function changeProblem({ days = [], person, months = [], changes = [], taken = {}, now = new Date() }) {
  const list = [...new Set([...days].map(dayOf))].sort();
  const used = changeThisMonth(changes, person, now);
  if (used) return { code: 'used', text: TEXT.used(used) };
  if (!list.length) return { code: 'pick', text: TEXT.pick };
  if (list.length > CHANGE_MAX_DAYS || !consecutive(list)) return { code: 'span', text: TEXT.span };
  if (list[0] < dayKeyIL(now)) return { code: 'past', text: TEXT.past };
  const free = (d) => freeDays(monthRow(months, person, monthOfDay(d))).has(d);
  if (list.some((d) => !free(d) && !takenOn(taken, d))) return { code: 'notFree', text: TEXT.notFree };
  return null;
}
// What he is told before he reports it (it still goes through).
export function changeWarnings({ days = [], taken = {}, now = new Date() }) {
  const list = [...days].map(dayOf).sort();
  const out = [];
  const held = list.filter((d) => takenOn(taken, d) > 0);
  if (held.length) out.push(`ב־${held.map(dayShort).join(', ')} קבוע יום צילום. הדיווח מגיע מיד לעירית ולליאור; ${CALL} גם עכשיו.`);
  if (list.length && Math.round((utcOf(list[0]) - utcOf(dayKeyIL(now))) / 864e5) < WEEK_AHEAD) out.push(`פחות משבוע מראש: ${CALL} גם עכשיו.`);
  return out;
}
// The days an unexpected change can name: from today to the end of next month, free or taken.
export function changeChoices({ person, months = [], taken = {}, now = new Date() }) {
  const today = dayKeyIL(now);
  const ask = askOf(now);
  return [ask.current, ask.month].flatMap((m) => {
    const free = freeDays(monthRow(months, person, m));
    return monthDays(m).filter((d) => d >= today && (free.has(d) || takenOn(taken, d) > 0)).map((d) => ({ day: d, taken: takenOn(taken, d) > 0 }));
  });
}
// The database's refusal, in words (the message names the limit).
export function refusalText(err, { changes = [], person = null, now = new Date() } = {}) {
  const msg = String(err?.message || err || '');
  if (/availability_change_used|photographer_changes_person_reported_month_key/.test(msg)) return TEXT.used(changeThisMonth(changes, person, now));
  if (/availability_change_span/.test(msg)) return TEXT.span;
  if (/availability_change_past/.test(msg)) return TEXT.past;
  if (/availability_change_not_free/.test(msg)) return TEXT.notFree;
  if (/availability_taken/.test(msg)) return `ביום שהורדת כבר קבוע יום צילום, ואי אפשר להוריד אותו כאן. ${CALL}.`;
  if (/availability_locked/.test(msg)) return TEXT.locked;
  if (/availability_empty|availability_none/.test(msg)) return TEXT.empty;
  return null;
}

// ── For the reminders ──────────────────────
// The shoot days set on each Israel day, by client: Map day → [client label].
export function shootsByDay(clients) {
  const out = new Map();
  for (const c of clients || []) {
    for (const v of [c.shoot_at, ...roundsOf(c).map((r) => r.shoot_at)]) {
      const at = parseDate(v);
      if (!at || Number.isNaN(+at)) continue;
      const day = dayKeyIL(at);
      if (!out.has(day)) out.set(day, []);
      out.get(day).push(clientLabel(c));
    }
  }
  return out;
}
// The same as counts, the shape of `taken`.
export const takenFrom = (clients) => Object.fromEntries([...shootsByDay(clients)].map(([d, l]) => [d, l.length]));
