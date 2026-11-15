// Natali Dadon's makeup artist, Tal (the owner's request of 15.11.2026; docs/ops.md, section 132).
// Pure: no DOM, no network, Israel time. The page (makeup.html, app/makeup.js), the reminder
// rules (app/reminder-rules.js, `makeupSet` and `makeupAnswer`, on the server), Lior's view of
// the item ("לפני יום צילום", app/prep.js) and the unit tests read the same functions.
//
//   - Only a shoot day WITH NATALI: shoot_type 'natali' (the client's, or an extra round's). Not
//     Niro's, "הצל"'s or Arik's days, although they run "like Natali's" for Lior (isStarDay): their
//     makeup is not Tal's.
//   - One day is one row for her: several clients can shoot with Natali on the same date, and the
//     makeup is done once, at Natali's home. What she is shown and told is the date and the hour of
//     the day's first shoot with Natali (the owner, 15.11.2026: the shoot's own time, no computed
//     arrival). One answer covers the day.
//   - "מאשרת" is saved only with the hour she arrives at Natali's home, which she types (HH:MM,
//     before the shoot). She can change it, or her answer, at any time.
//   - Her answer is kept with the shoot time it was given for: when the day's first shoot moves,
//     the answer no longer holds ("השעה של הצילום השתנתה") and she is asked again.
import { shootCases } from './production.js';
import { dayKeyIL, dayFromKeyIL, daysBetweenIL, partsIL } from './tz.js';

export const MAKEUP_PERSON = 'tal';
export const MAKEUP_SCREEN = 'makeup.html';
export const MAKEUP_TITLE = 'הימים שלי עם נטלי';
// The shoot type that is Natali's own (app/protocol.js SHOOT_TYPES).
export const NATALI = 'natali';
// The items her "מאשרת" marks: Lior's "מאפרת תואמה" of 11ב, shown on "לפני יום צילום", and the
// "המאפרת אישרה הגעה" of 15 (a round's take its prefix). The database writes them
// (public.makeup_answer), with her hour in the note.
export const MAKEUP_ITEMS = ['p11b.makeup', 'p15.natali.makeup'];
export const makeupKeys = (pre = '') => MAKEUP_ITEMS.map((k) => `${pre}${k}`);

export const isNataliDay = (ctx) => ctx?.shoot_type === NATALI;

const pad = (n) => String(n).padStart(2, '0');
const WEEKDAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const hourText = (d) => { const p = partsIL(d); return `${pad(p.hour)}:${pad(p.minute)}`; };
// "יום ג׳ 20.10"
export const dayWords = (d) => { const p = partsIL(d); return `יום ${WEEKDAY[p.weekday]} ${p.day}.${p.month}`; };

// ── Her hour ───────────────────────────────
// What she typed, as "HH:MM", or null. "7:30", "07:30", "0730" and "7.30" are all 07:30.
export function readHour(text) {
  const s = String(text ?? '').trim().replace(/[.,]/g, ':');
  const m = /^(\d{1,2}):?(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
// Why an hour cannot be saved for a day (null: it can). It is the hour she is at Natali's home,
// so it is before the shoot.
export function hourProblem(text, day) {
  if (!String(text ?? '').trim()) return 'צריך לכתוב באיזו שעה את מגיעה לנטלי';
  const hh = readHour(text);
  if (!hh) return 'שעה כמו 07:30';
  if (day?.shootAt && minutesOf(hh) >= minutesOf(hourText(day.shootAt))) return `השעה צריכה להיות לפני הצילום (${hourText(day.shootAt)})`;
  return null;
}
// The stored hour ("07:30" or "07:30:00") as "07:30".
export const shortHour = (v) => (v ? String(v).slice(0, 5) : '');

// ── The days ───────────────────────────────
// The days from a flat list of cases: { cid, business, n, shootAt }. Each day:
//   { day: 'YYYY-MM-DD', shootAt (the first shoot with Natali), cases: [...] (by time, then name) }.
export function groupDays(cases) {
  const by = new Map();
  for (const c of cases) {
    if (!c?.shootAt || Number.isNaN(+c.shootAt)) continue;
    const day = dayKeyIL(c.shootAt);
    if (!by.has(day)) by.set(day, { day, cases: [] });
    by.get(day).cases.push(c);
  }
  return [...by.values()].map((d) => {
    const cases = d.cases.sort((a, b) => a.shootAt - b.shootAt || String(a.business).localeCompare(String(b.business), 'he'));
    return { day: d.day, shootAt: cases[0].shootAt, cases };
  }).sort((a, b) => a.shootAt - b.shootAt);
}

// The engine's view: every Natali shoot of the live clients (the main one and each round), as cases.
export function nataliCases(clients) {
  const out = [];
  for (const c of clients || []) {
    for (const sc of shootCases(c)) {
      if (!isNataliDay(sc.ctx)) continue;
      out.push({ cid: c.id, business: c.business || c.name || '', n: sc.n, pre: sc.pre ? `r${sc.n}.` : '', shootAt: sc.shootAt });
    }
  }
  return out;
}
// The days, grouped first: `after` keeps the days whose FIRST shoot is after it.
export const nataliDays = (clients, { after = null } = {}) => groupDays(nataliCases(clients)).filter((d) => !after || d.shootAt > after);

// The page's view: the rows of public.makeup_my_days() ({ day, shoot_at, client_id, business,
// round }), as days.
export function daysFromRows(rows) {
  return groupDays((rows || []).map((r) => ({
    cid: r.client_id, business: r.business || '', n: Number(r.round) || 1, pre: Number(r.round) > 1 ? `r${r.round}.` : '', shootAt: new Date(r.shoot_at),
  })));
}

// ── Her answers ────────────────────────────
// Rows of public.makeup_answers: { id, day, shoot_at, answer ('yes' | 'no'), arrive_time, at }.
const later = (a, b) => new Date(a.at) - new Date(b.at) || Number(a.id) - Number(b.id);
export const answersOfDay = (day, answers) => {
  const key = typeof day === 'string' ? day : day?.day;
  return (answers || []).filter((a) => String(a.day).slice(0, 10) === key).sort(later);
};
// Her latest answer on a day.
export const answerFor = (day, answers) => answersOfDay(day, answers).at(-1) || null;
// Where the day stands: 'open' (no answer yet), 'yes', 'no', or 'again' (she answered for another
// shoot time: the first shoot moved since).
export function statusOf(day, answer) {
  if (!answer) return 'open';
  if (+new Date(answer.shoot_at) !== +day.shootAt) return 'again';
  return answer.answer === 'yes' ? 'yes' : 'no';
}

// Her words (makeup.html).
export const STATUS_WORDS = {
  open: 'מחכה לתשובה שלך',
  yes: 'אישרת',
  no: 'אמרת שלא תוכלי',
  again: 'שעת הצילום השתנתה · צריך לאשר שוב',
};
export const STATUS_TONE = { open: 'orange', yes: 'green', no: 'pink', again: 'orange' };

// What Lior reads next to the makeup item ("לפני יום צילום"), or null with no answer at all (the
// item stays his to mark, as before).
export function liorWords(day, answer, name = 'טל') {
  const s = statusOf(day, answer);
  if (s === 'open') return null;
  if (s === 'yes') return { status: s, done: true, text: `${name} אישרה, מגיעה ב־${shortHour(answer.arrive_time)}` };
  if (s === 'no') return { status: s, done: false, text: `${name} לא יכולה · לסדר מאפרת אחרת` };
  return { status: s, done: false, text: `שעת הצילום השתנתה · ${name} עוד לא אישרה שוב` };
}

// What Lior is told of one answer (the reminders, `makeupAnswer`): { kind, title, body }. `prev`:
// her answer before it on the same day (null for the first).
export function answerNews(day, row, prev, name = 'טל') {
  const when = `${dayWords(day.shootAt)} ${hourText(day.shootAt)}`;
  const whose = businessesOf(day);
  const hour = shortHour(row.arrive_time);
  if (row.answer === 'no') {
    return { kind: 'no', title: `${name} לא יכולה להגיע ליום הצילום עם נטלי · ${when}`, body: `${whose}. לסדר מאפרת אחרת.` };
  }
  const sameShoot = prev && +new Date(prev.shoot_at) === +new Date(row.shoot_at);
  if (prev?.answer === 'yes' && sameShoot && shortHour(prev.arrive_time) !== hour) {
    return { kind: 'hour', title: `${name} שינתה את שעת ההגעה: ${when} של ${whose}`, body: `מגיעה לנטלי ב־${hour} (במקום ${shortHour(prev.arrive_time)}).` };
  }
  return {
    kind: prev?.answer === 'no' ? 'yesAfterNo' : 'yes',
    title: `${name} אישרה את ${when} של ${whose}, מגיעה לנטלי ב־${hour}`,
    body: prev?.answer === 'no' ? 'קודם אמרה שלא תוכל. אם כבר סודרה מאפרת אחרת, לעדכן אותה.' : 'המאפרת סומנה בהכנות ליום הצילום.',
  };
}

// The businesses of a day in one line: "פרץ יוגה, חן קוסמטיקה".
export const businessesOf = (day) => [...new Set(day.cases.map((c) => c.business).filter(Boolean))].join(', ');
// Days still ahead (from today on), as the page lists them.
export const upcoming = (days, now) => days.filter((d) => daysBetweenIL(now, dayFromKeyIL(d.day)) >= 0);
