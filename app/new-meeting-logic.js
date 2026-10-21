// "פגישה חדשה" on the calendar page (the owner, 21.10.2026: "an option to add from inside
// the app"): the office (Irit, Lior, Ofir) and the owners choose a client, a kind and a
// time; a characterization meeting or a shoot day is saved in the system as the
// "קביעת מועד" dialogs save it (app/date-set.js), and in every case Google Calendar opens
// with the invitation filled in, guests and all (as "שליחת זימון" does). "פגישה אחרת" is
// not kept in the system: it only opens the invitation, and comes back through the
// person's own Google Calendar (app/gcal-page.js). The plain rules, no DOM, so node tests
// them (tests/new-meeting.test.mjs); the dialog is app/new-meeting.js.
import { PEOPLE, SHOOT_TYPES } from './protocol.js';
import { inviteFor } from './calendar-view.js';
import { googleCalendarUrl, cleanGuests } from './calendar.js';
// Who runs a characterization meeting: the meeting dialog's two, as app/date-set.js checks them.
import { MEET_PEOPLE } from './date-set.js';

export { MEET_PEOPLE };

export const KINDS = [
  { key: 'char', label: 'פגישת אפיון' },
  { key: 'shoot', label: 'יום צילום' },
  { key: 'other', label: 'פגישה אחרת' },
];
const OFFICE = ['irit', 'lior', 'ofir'];
// Who has the button: the owners and the office's three.
export const addsMeetings = (v) => !!v && !v.error && v.scope === 'office' && (!v.me || OFFICE.includes(v.me));

const norm = (s) => String(s || '').toLowerCase().replace(/[״"'׳`.,()\-–_/|·]+/g, ' ').replace(/\s+/g, ' ').trim();
// The open clients whose business or name has every word typed (a word may start a word).
export function searchClients(clients = [], query = '', limit = 6) {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const open = clients.filter((c) => !c.archived_at && (!c.status || ['active', 'ending'].includes(c.status)));
  const hit = (c) => {
    const hay = norm(`${c.business || ''} ${c.name || ''}`).split(' ');
    return words.every((w) => hay.some((x) => x.startsWith(w)));
  };
  return open.filter(hit).sort((a, b) => String(a.business || a.name).localeCompare(String(b.business || b.name), 'he')).slice(0, limit);
}

// What is missing, as the sentence to show, or null.
export function checkMeeting({ kind, client, at, title, type, person }) {
  if (!KINDS.some((k) => k.key === kind)) return 'בוחרים איזו פגישה.';
  if (kind !== 'other' && !client) return 'בוחרים לקוח.';
  if (kind === 'other' && !String(title || '').trim()) return 'כותבים במה מדובר.';
  if (!(at instanceof Date) || Number.isNaN(+at)) return kind === 'shoot' ? 'בוחרים יום ושעה ליום הצילום.' : 'בוחרים יום ושעה לפגישה.';
  if (kind === 'shoot' && !SHOOT_TYPES[type]) return 'בוחרים עם מי מצלמים.';
  if (kind === 'char' && !MEET_PEOPLE.includes(person)) return 'בוחרים מי מבצע את האפיון.';
  return null;
}

// The invitation: { url, guests, people, withClient, title }. A shoot day's `at` is when the
// influencers arrive (as on the client's card); the event starts with the team, an hour before.
export function meetingInvite({ kind, client = null, at, title = '', type = null, person = null, emails = {}, clientEmail = null, site = '' }) {
  if (kind === 'char' || kind === 'shoot') {
    const c = { ...client, ...(kind === 'char' ? { characterizer: person || client.characterizer } : { shoot_type: type || client.shoot_type }) };
    const start = kind === 'shoot' ? new Date(+at - 36e5) : at;
    return inviteFor({ kind, start: start.toISOString(), shootType: c.shoot_type }, { client: c, emails, clientEmail, site });
  }
  const name = client ? client.business || client.name : '';
  const text = [String(title).trim(), name].filter(Boolean).join(' · ');
  const guests = cleanGuests([clientEmail]);
  const details = client ? `כרטיס הלקוח במערכת: ${site}client.html?id=${encodeURIComponent(client.id)}` : '';
  return {
    url: googleCalendarUrl({ title: text, start: at, minutes: 60, details, location: client?.address || '', guests }),
    guests, people: [], withClient: guests.length > 0, title: text,
  };
}
export const kindLabel = (key) => KINDS.find((k) => k.key === key)?.label || '';
export const personName = (key) => PEOPLE[key]?.name || key;
