// The calendar page ("יומן", calendar.html; the owner's request of 15.10.2026): the
// meetings and the shoot days in a week or a month, and "שליחת זימון" for the office.
// The plain rules, no DOM, so node tests them (tests/calendar-view.test.mjs); the page
// itself is app/calendar-page.js.
//
// What is on it is what the personal calendar feed already decides (app/calendar-feed.js
// feedEvents), so the page and "היומן שלי" never disagree:
//   - the office (the owners, Irit, Lior, Ofir) sees every client's characterization
//     meeting and shoot day (the owner's overview of the feed), and their own Zoom, tasks
//     and weekly work; their own deadlines stay on "המשימות שלי", so the week is meetings;
//   - everyone else sees their own feed: Eli his shoot days (in his window), an editor
//     the deadlines of her work and her tasks, Ilai his;
//   - the field sales have no client work: no page (seesCalendar).
// The clients come in through the signed-in client, so the database (RLS) has already cut
// them to what this person may see; the feed's own rule (visibleTo) agrees with it.
// Dates are Israel days (app/tz.js), whatever the device's zone; the week starts on Sunday.
//
// A later stage may add the office's own Google Calendar beside these (not built): it
// would come in as more events of the same shape ({ uid, kind, title, start, minutes |
// end | allDay }) through `extra` below.
import { PEOPLE, SHOOT_TYPES, isSales } from './protocol.js';
import { feedEvents, OWNER, shootMinutes } from './calendar-feed.js';
import { googleCalendarUrl, cleanGuests } from './calendar.js';
import { TZ, dayKeyIL, dayFromKeyIL, dateIL, partsIL, weekdayIL } from './tz.js';

const known = (v) => !!v && !v.error;
// The page is everyone's but the field sales' (and whoever the app could not identify).
export const seesCalendar = (v) => known(v) && v.scope !== 'sales' && !isSales(v.me) && (v.scope === 'office' || !!v.me);
// "שליחת זימון": the office and the owners only.
export const sendsInvites = (v) => known(v) && v.scope === 'office';

// How each kind of event looks: its word, its icon and its tone (app/kit.js).
// `short`: its word in a day of the month, where the room is small.
export const KINDS = {
  char: { label: 'פגישת אפיון', short: 'אפיון', icon: 'handshake', tone: 'purple' },
  shoot: { label: 'יום צילום', short: 'צילום', icon: 'camera', tone: 'pink' },
  zoom: { label: 'זום תסריטים', short: 'זום', icon: 'video', tone: 'blue' },
  due: { label: 'יעד', short: 'יעד', icon: 'flag', tone: 'orange' },
  task: { label: 'משימה', short: 'משימה', icon: 'check-circle', tone: 'green' },
  weekly: { label: 'קבוע', short: 'קבוע', icon: 'loop', tone: 'teal' },
};
export const kindOf = (e) => KINDS[e?.kind] || KINDS.task;

// ── Days ──────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (y, m, d) => dayKeyIL(dateIL(y, m, d, 12)); // noon: never across a clock change
const split = (key) => String(key).split('-').map(Number);
export const addDays = (key, n) => { const [y, m, d] = split(key); return keyOf(y, m, d + n); };
export const todayKey = (now = new Date()) => dayKeyIL(now);
// The Sunday of the week of a day.
export const weekStart = (key) => addDays(key, -weekdayIL(dateIL(...split(key), 12)));
export const weekDays = (key) => { const first = weekStart(key); return Array.from({ length: 7 }, (_, i) => addDays(first, i)); };
const monthOf = (key) => key.slice(0, 7);
const firstOfMonth = (key) => `${monthOf(key)}-01`;
// The weeks a month is drawn in: from the Sunday on or before the 1st to the Saturday on
// or after its last day (4 to 6 rows). `month`: 'YYYY-MM'.
export function monthWeeks(key) {
  const [y, m] = split(key);
  const last = keyOf(y, m + 1, 0);
  const weeks = [];
  for (let day = weekStart(firstOfMonth(key)); day <= last; day = addDays(day, 7)) weeks.push(weekDays(day));
  return { month: monthOf(key), weeks };
}
// The days a view shows, first and last: { first, last, from, until } (until: the moment the day after `last` starts).
export function rangeOf(view, key) {
  const days = view === 'month' ? monthWeeks(key).weeks.flat() : weekDays(key);
  const first = days[0];
  const last = days.at(-1);
  return { first, last, from: dayFromKeyIL(first), until: new Date(dayFromKeyIL(addDays(last, 1)).getTime() - 1) };
}
// The next or the previous week or month (dir: 1 or -1); a month moves to its 1st.
export function shift(view, key, dir) {
  if (view !== 'month') return addDays(key, 7 * dir);
  const [y, m] = split(key);
  return keyOf(y, m + dir, 1);
}

const monthFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, month: 'long', year: 'numeric' });
const monthName = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, month: 'long' });
// The heading of a view: "אוקטובר 2026", or the week "18–24 באוקטובר 2026" (across months: "27.9–3.10.2026").
export function titleOf(view, key) {
  if (view === 'month') return monthFmt.format(dateIL(...split(firstOfMonth(key)), 12));
  const days = weekDays(key);
  const [a, b] = [split(days[0]), split(days[6])];
  if (a[1] === b[1]) return `${a[2]}–${b[2]} ב${monthName.format(dateIL(b[0], b[1], 1, 12))} ${b[0]}`;
  return `${a[2]}.${a[1]}${a[0] !== b[0] ? `.${a[0]}` : ''}–${b[2]}.${b[1]}.${b[0]}`;
}
export const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

// ── Events ────────────────────────────────
export const startOf = (e) => (e.allDay ? dayFromKeyIL(e.allDay) : new Date(e.start));
export const endOf = (e) => (e.allDay ? null : e.end ? new Date(e.end) : new Date(new Date(e.start).getTime() + (e.minutes ?? 60) * 6e4));
export const dayOf = (e) => e.allDay || dayKeyIL(e.start);
const hm = (d) => { const p = partsIL(d); return `${pad(p.hour)}:${pad(p.minute)}`; };
// "10:00 עד 12:00", or "כל היום" (a task or a deadline at a day's end).
export const timeText = (e) => (e.allDay ? 'כל היום' : `${hm(startOf(e))} עד ${hm(endOf(e))}`);
export const startText = (e) => (e.allDay ? null : hm(startOf(e)));

// The words of an event on the page: { title, short, sub }. A meeting and a shoot day say
// what and whose ("יום צילום · עומר דיין"); the time, and who meets or who shoots, are the
// second line. Anything else keeps the feed's own title, which names the client.
export function wordsOf(e, client = null) {
  const k = kindOf(e);
  const round = Number(e.round) > 1 ? ` ${e.round}` : '';
  const named = client && (e.kind === 'char' || e.kind === 'shoot');
  const title = named ? `${k.label}${round} · ${client.name}` : e.title;
  const extra = e.kind === 'char' && client ? `עם ${PEOPLE[client.characterizer || 'ofir']?.name || ''}`
    : e.kind === 'shoot' ? SHOOT_TYPES[e.shootType || client?.shoot_type]?.name || null : null;
  return { title, short: named ? `${k.short} · ${client.name}` : e.title, sub: [timeText(e), extra].filter(Boolean).join(' · ') };
}

// Every event this viewer sees between `from` and `until`. `extra`: events from elsewhere
// (none yet), kept to the same range.
export function calendarEvents({ viewer, clients = [], checks = {}, tasks = [], now = new Date(), from, until, site, extra = [] }) {
  if (!seesCalendar(viewer)) return [];
  const range = { from, until };
  const office = viewer.scope === 'office';
  const args = { clients, checks, tasks, now, range, ...(site ? { site } : {}) };
  const lists = [];
  if (office) lists.push(feedEvents({ person: OWNER, ...args }));
  if (viewer.me) lists.push(feedEvents({ person: viewer.me, ...args }).filter((e) => !(office && e.kind === 'due')));
  const inRange = (e) => { const t = startOf(e).getTime(); return t >= new Date(from).getTime() && t <= new Date(until).getTime(); };
  lists.push(extra.filter(inRange));
  const seen = new Set();
  const out = [];
  for (const e of lists.flat()) {
    if (seen.has(e.uid)) continue; // the office's own meeting is already in the overview
    seen.add(e.uid);
    out.push(e);
  }
  return out.sort((a, b) => startOf(a) - startOf(b) || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || a.uid.localeCompare(b.uid));
}

// The events of each day: { 'YYYY-MM-DD': [events] }, a whole day's first, then by the hour.
export function byDay(events) {
  const map = {};
  for (const e of events) (map[dayOf(e)] ||= []).push(e);
  for (const list of Object.values(map)) list.sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || startOf(a) - startOf(b));
  return map;
}

// ── "שליחת זימון" ─────────────────────────
// person → email, from the staff directory (email → person) the pages already load.
export function emailsOf(directory = {}) {
  const out = {};
  for (const [email, person] of Object.entries(directory).sort(([a], [b]) => a.localeCompare(b))) if (person && !out[person]) out[person] = email;
  return out;
}
// Who is invited: the client (when the system has their email and this viewer may read
// it), and the staff of that event: the characterizer at a meeting; Lior and Eli on a shoot day.
export const STAFF_GUESTS = { char: (c) => [c.characterizer || 'ofir'], shoot: () => ['lior', 'eli'] };
// The invitation of one event as a Google Calendar template, or null (only meetings and shoot days).
//   { url, guests (emails), people (staff keys), withClient (bool), title }
export function inviteFor(event, { client, emails = {}, clientEmail = null, site = '' } = {}) {
  const staff = STAFF_GUESTS[event?.kind];
  if (!staff || !client) return null;
  const name = client.business || client.name || '';
  const card = `${site}client.html?id=${encodeURIComponent(client.id)}`;
  const staffOf = staff(client);
  // Only whoever has an email in the staff list is invited (and named on the button).
  const people = staffOf.filter((p) => cleanGuests([emails[p]]).length);
  const guests = cleanGuests([clientEmail, ...people.map((p) => emails[p])]);
  const withClient = cleanGuests([clientEmail]).length > 0;
  let title;
  let details;
  let minutes;
  if (event.kind === 'char') {
    title = `פגישת אפיון · ${name}`;
    minutes = 120;
    details = ['פגישת אפיון עם אסטרטג.', `מבצע/ת האפיון: ${PEOPLE[staffOf[0]]?.name || ''}`, `כרטיס הלקוח במערכת: ${card}`];
  } else {
    const n = Number(event.round) || 1;
    title = `יום צילום${n > 1 ? ` ${n}` : ''} · ${name}`;
    minutes = shootMinutes(event.shootType || client.shoot_type);
    const arrive = new Date(new Date(event.start).getTime() + 36e5); // the event starts with the team, an hour before
    details = [`הגעת המשפיענים: ${hm(arrive)}. הצוות מגיע שעה לפני.`, `כרטיס הלקוח במערכת: ${card}`];
  }
  const url = googleCalendarUrl({ title, start: event.start, minutes, details: details.join('\n'), location: client.address || '', guests });
  return { url, guests, people, withClient, title };
}
// The names on the button's hint: "הלקוח, ליאור ואלי".
export function guestNames(invite) {
  if (!invite) return '';
  const names = [...(invite.withClient ? ['הלקוח'] : []), ...invite.people.map((p) => PEOPLE[p]?.name || p)];
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} ו${names.at(-1)}` : names.join('');
}
// Client id → email, from the agreements (public.quote_facts: model.client.email; the
// office reads it). A client with no agreement, or no email in it, has none.
export function clientEmails(clients = [], facts = []) {
  const byQuote = new Map((facts || []).map((q) => [q.id, q.client?.email || null]));
  const out = {};
  for (const c of clients) {
    const email = c.quote_id ? cleanGuests([byQuote.get(c.quote_id)])[0] : null;
    if (email) out[c.id] = email;
  }
  return out;
}
