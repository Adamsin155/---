// The meetings a member of staff books in their own Google Calendar, read into the
// system (the owner's request of 21.10.2026, "סנכרון עם היומן גוגל של עירית"; stage 3
// of the calendar plan: Google → the system, as suggestions that are confirmed, never
// written by themselves). The plain rules, no DOM and no network, so node tests them
// (tests/gcal-logic.test.mjs) and the edge function runs the same copy
// (supabase/functions/calendar/google.js, through scripts/sync-functions.mjs):
//   - the secret iCal address of a Google calendar, checked (googleIcsUrl);
//   - an iCalendar text read into events (parseIcs): folded lines, escaped text,
//     DTSTART/DTEND in UTC (Z), with a TZID or floating, whole days, DURATION,
//     cancelled events, a recurrence (RRULE daily / weekly with BYDAY / monthly /
//     yearly, INTERVAL, COUNT, UNTIL, EXDATE, and a moved or cancelled occurrence);
//   - the events of a window (7 days back to 120 ahead), each with the client it most
//     likely belongs to and whether it is a characterization meeting or a shoot day
//     (googleRows); these are the rows of public.calendar_external_events;
//   - on the calendar page: a row as an event of the page, and the suggestion under it
//     (suggestionOf).
// Times are kept as moments (ISO, UTC); an Israel wall time is app/tz.js.
import { TZ, dateIL, dayKeyIL, partsIL } from './tz.js';
import { nameScore } from './metricool-logic.js';

export const WINDOW = { back: 7, ahead: 120 };     // days
export const MAX_BYTES = 3_000_000;                // a feed larger than this is not read
export const MAX_ROWS = 2000;                      // events kept per person
const MAX_STEPS = 20000;                           // a recurrence is walked at most this far
const DAY = 864e5;
const pad = (n, w = 2) => String(n).padStart(w, '0');

// ── The address ───────────────────────────
// The "secret address in iCal format" of a Google calendar:
//   https://calendar.google.com/calendar/ical/<calendar id>/private-<key>/basic.ics
// Only that host and that shape (the server reads it, so nothing else may be asked for).
// Returns the address, trimmed, or null.
export const URL_RE = /^https:\/\/calendar\.google\.com\/calendar\/ical\/[A-Za-z0-9%._+@-]{3,200}\/private-[A-Za-z0-9]{8,100}\/basic\.ics$/;
export function googleIcsUrl(raw) {
  const v = String(raw ?? '').trim();
  return v.length <= 400 && URL_RE.test(v) ? v : null;
}

// ── Reading iCalendar ─────────────────────
// Lines with their continuations joined (RFC 5545 3.1: a line break and one space or tab).
export const unfold = (text) => String(text ?? '').replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, '').split(/\r\n|\n|\r/);
// TEXT values: \n, \, \; \\ (one pass, so "\\n" stays a backslash and an n).
export const unescapeText = (v) => String(v ?? '').replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
// One content line: { name, params, value } (the first colon outside quotes ends the name).
export function parseLine(line) {
  let quoted = false;
  let i = 0;
  for (; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const [name, ...rest] = line.slice(0, i).split(';');
  const params = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"(.*)"$/, '$1');
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

// A zone name Intl knows, or null (a Windows name such as "Israel Standard Time" is not one).
const zoneFmts = new Map();
function zoneFmt(zone) {
  if (!zoneFmts.has(zone)) {
    let f = null;
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    } catch { f = null; }
    zoneFmts.set(zone, f);
  }
  return zoneFmts.get(zone);
}
const ISRAEL = new Set([TZ, 'Israel', 'Asia/Tel_Aviv']);
export function cleanZone(zone, fallback = TZ) {
  const z = String(zone || '').replace(/^\/[^/]+\/[^/]+\//, '').trim(); // "/mozilla.org/20050126_1/Asia/Jerusalem"
  if (!z) return fallback;
  if (z === 'UTC' || z === 'Etc/UTC' || z === 'GMT') return 'UTC';
  if (ISRAEL.has(z) || /israel|jerusalem/i.test(z)) return TZ;
  return zoneFmt(z) ? z : fallback;
}
function offsetIn(zone, t) {
  const p = {};
  for (const x of zoneFmt(zone).formatToParts(new Date(t))) p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}
// The moment of a wall-clock time in a zone ('UTC', Israel, or any zone Intl knows).
// Out-of-range fields roll over (day 32 is the 1st of the next month).
export function wallToDate([y, mo, d, h = 0, mi = 0, s = 0], zone = TZ) {
  if (zone === 'UTC') return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (zone === TZ) return dateIL(y, mo, d, h, mi, s);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = wall - offsetIn(zone, wall);
  t = wall - offsetIn(zone, t);
  return new Date(t);
}
// The wall-clock fields of a moment in a zone.
function wallOf(date, zone) {
  if (zone === 'UTC') { const x = new Date(date); return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), x.getUTCHours(), x.getUTCMinutes(), x.getUTCSeconds()]; }
  if (zone === TZ) { const p = partsIL(date); return [p.year, p.month, p.day, p.hour, p.minute, p.second]; }
  const t = +new Date(date);
  const x = new Date(t + offsetIn(zone, t));
  return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), x.getUTCHours(), x.getUTCMinutes(), x.getUTCSeconds()];
}

// A DATE or DATE-TIME value: { day: 'YYYY-MM-DD' } (a whole day), or { wall, zone }.
export function parseWhen(value, params = {}, calZone = TZ) {
  const v = String(value || '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { day: `${m[1]}-${m[2]}-${m[3]}`, wall: [+m[1], +m[2], +m[3], 0, 0, 0] };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const zone = m[7] ? 'UTC' : cleanZone(params.TZID, calZone);
  return { wall: [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)], zone };
}
const instantOf = (w) => (w.day ? wallToDate(w.wall, TZ) : wallToDate(w.wall, w.zone));
// ISO duration (DURATION, RFC 5545 3.3.6) in ms, or null.
export function durationMs(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  if (!m || String(v).trim() === 'P' || /T$/.test(String(v).trim())) return null;
  const ms = ((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 * 3600 + +(m[4] || 0) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}
export function parseRrule(v) {
  const out = {};
  for (const part of String(v || '').split(';')) {
    const [k, val] = part.split('=');
    if (k && val !== undefined) out[k.trim().toUpperCase()] = val.trim();
  }
  return out.FREQ ? out : null;
}

// The VEVENTs of a calendar: { zone, events: [{ uid, start, end, duration, summary,
// location, status, rrule, exdates, recurrenceId }] } (start/end/exdates/recurrenceId as
// parseWhen gives them). An alarm inside an event is skipped.
export function parseIcs(text) {
  const lines = unfold(text);
  let calZone = TZ;
  const raw = [];
  let cur = null;
  let depth = 0; // components inside the event (VALARM)
  for (const line of lines) {
    if (!line) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (cur) depth += 1;
      else if (p.value.toUpperCase() === 'VEVENT') cur = [];
      continue;
    }
    if (p.name === 'END') {
      if (cur && depth) depth -= 1;
      else if (cur && p.value.toUpperCase() === 'VEVENT') { raw.push(cur); cur = null; }
      continue;
    }
    if (cur && !depth) cur.push(p);
    else if (!cur && p.name === 'X-WR-TIMEZONE') calZone = cleanZone(p.value, TZ);
  }
  const events = raw.map((props) => {
    const e = { uid: '', start: null, end: null, duration: null, summary: '', location: '', status: '', rrule: null, exdates: [], recurrenceId: null };
    for (const p of props) {
      if (p.name === 'UID') e.uid = p.value.trim();
      else if (p.name === 'DTSTART') e.start = parseWhen(p.value, p.params, calZone);
      else if (p.name === 'DTEND') e.end = parseWhen(p.value, p.params, calZone);
      else if (p.name === 'DURATION') e.duration = durationMs(p.value);
      else if (p.name === 'SUMMARY') e.summary = unescapeText(p.value);
      else if (p.name === 'LOCATION') e.location = unescapeText(p.value);
      else if (p.name === 'STATUS') e.status = p.value.trim().toUpperCase();
      else if (p.name === 'RRULE') e.rrule = parseRrule(p.value);
      else if (p.name === 'RECURRENCE-ID') e.recurrenceId = parseWhen(p.value, p.params, calZone);
      else if (p.name === 'EXDATE') for (const v of p.value.split(',')) { const w = parseWhen(v, p.params, calZone); if (w) e.exdates.push(w); }
    }
    return e;
  }).filter((e) => e.start);
  return { zone: calZone, events };
}

// ── Recurrence ────────────────────────────
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const addWall = (w, { days = 0, months = 0, years = 0 }) => {
  const x = new Date(Date.UTC(w[0] + years, w[1] - 1 + months, w[2] + days, w[3], w[4], w[5]));
  return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), w[3], w[4], w[5]];
};
const weekdayOfWall = (w) => new Date(Date.UTC(w[0], w[1] - 1, w[2])).getUTCDay();
const sameDayKey = (w) => `${w[0]}-${pad(w[1])}-${pad(w[2])}`;
// An occurrence's own part of its id: its day, or its moment in UTC ('20261103T070000Z').
const stampOf = (w, allDay, zone) => (allDay ? `${w[0]}${pad(w[1])}${pad(w[2])}` : wallToDate(w, zone).toISOString().replace(/[-:]|\.\d{3}/g, ''));
const stampWhen = (x) => stampOf(x.wall, !!x.day, x.zone);
// What an RRULE this module walks: daily, weekly (with BYDAY), monthly and yearly on the
// start's own day. Anything finer (BYMONTHDAY, BYSETPOS, "the 2nd Monday"...) is not
// walked: only its first occurrence is kept, and the stats say so.
export function walkable(r) {
  if (!r || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(String(r.FREQ).toUpperCase())) return false;
  const finer = Object.keys(r).filter((k) => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'WKST', 'BYDAY'].includes(k));
  if (finer.length) return false;
  if (r.BYDAY && (r.FREQ !== 'WEEKLY' || !r.BYDAY.split(',').every((d) => d.trim() in WD))) return false;
  return true;
}
// The starts (wall fields in the event's zone) of a recurring event, up to `until` (a
// Date). Follows COUNT and UNTIL from the first occurrence on, as RFC 5545 counts them.
export function occurrences(e, until) {
  const r = e.rrule;
  const base = e.start.wall;
  const zone = e.start.day ? TZ : e.start.zone;
  const at = (w) => (e.start.day ? wallToDate([w[0], w[1], w[2]], TZ) : wallToDate(w, zone));
  if (!walkable(r)) return [base];
  const freq = r.FREQ.toUpperCase();
  const step = Math.max(1, Number(r.INTERVAL) || 1);
  const count = r.COUNT ? Math.max(0, Number(r.COUNT) || 0) : Infinity;
  const end = r.UNTIL ? parseWhen(r.UNTIL, {}, zone) : null;
  const endAt = end ? (end.day ? wallToDate([...end.wall.slice(0, 3), 23, 59, 59], zone === 'UTC' ? 'UTC' : zone) : instantOf(end)) : null;
  const out = [];
  let made = 0;
  const take = (w) => {
    const t = at(w);
    if ((endAt && t > endAt) || t > until) return false;
    out.push(w);
    made += 1;
    return made < count;
  };
  if (freq === 'WEEKLY') {
    const days = r.BYDAY ? [...new Set(r.BYDAY.split(',').map((d) => WD[d.trim()]))] : [weekdayOfWall(base)];
    const wkst = WD[String(r.WKST || 'MO').toUpperCase()] ?? 1;
    const first = addWall(base, { days: -((weekdayOfWall(base) - wkst + 7) % 7) }); // the week's first day
    const order = days.map((d) => (d - wkst + 7) % 7).sort((a, b) => a - b);
    for (let k = 0; k < MAX_STEPS; k += 1) {
      const week = addWall(first, { days: k * 7 * step });
      for (const off of order) {
        const w = addWall(week, { days: off });
        if (at(w) < at(base)) continue;
        if (!take(w)) return out;
      }
      if (at(week) > until) return out;
    }
    return out;
  }
  for (let k = 0; k < MAX_STEPS; k += 1) {
    const w = freq === 'DAILY' ? addWall(base, { days: k * step })
      : freq === 'MONTHLY' ? addWall(base, { months: k * step }) : addWall(base, { years: k * step });
    if (at(w) > until || (endAt && at(w) > endAt)) return out;
    if (freq !== 'DAILY' && w[2] !== base[2]) continue; // the 31st of a month without one: no occurrence
    if (!take(w)) return out;
  }
  return out;
}

// ── Whose and what ────────────────────────
// Characterization meeting or shoot day, from the words of the title ("פגישת אפיון",
// "אפיון זום", "יום צילום", "צילומים"); anything else (a Zoom, a call) is neither.
export function kindGuess(text) {
  const t = String(text || '').toLowerCase();
  if (/אפיון/.test(t)) return 'char';
  if (/צילום|צילומים|shoot/.test(t)) return 'shoot';
  return null;
}
const NOISE = new Set(['בעמ', 'בע״מ', 'ltd', 'פגישת', 'פגישה', 'אפיון', 'יום', 'צילום', 'צילומים', 'עם', 'זום', 'zoom', 'אסטרטג', 'astrateg', 'של', 'ל', 'ב', 'ו', 'ה', '+', '-']);
const words = (s) => String(s || '').toLowerCase().replace(/[״"'׳`.,:;()\-–—_/|·!?]+/g, ' ').split(/\s+/).filter(Boolean);
const PREFIX = 'והלבשמכ';
// A word of the title is a word of the name, or the name's word with a one-letter
// Hebrew prefix ("לקפה" is "קפה").
const wordIs = (t, w) => t === w || (t.length === w.length + 1 && PREFIX.includes(t[0]) && t.slice(1) === w);
// How well a title names a client (0..1): all the words of the business (or the
// contact's name) in the title, or the same name once the meeting words are taken out
// (nameScore of app/metricool-logic.js, which ignores spaces and marks).
export function clientScore(text, client) {
  const title = words(text);
  if (!title.length) return 0;
  let best = 0;
  for (const [name, weight] of [[client?.business, 1], [client?.name, 0.95]]) {
    const ws = words(name).filter((w) => !NOISE.has(w));
    if (!ws.length || ws.join('').length < 3) continue;
    if (ws.every((w) => title.some((t) => wordIs(t, w)))) best = Math.max(best, weight * (0.9 + Math.min(0.1, ws.join('').length / 100)));
    const rest = title.filter((t) => !NOISE.has(t)).join(' ');
    // The same letters with other spaces ("קפהדנה"); a part of a word is not enough.
    best = Math.max(best, rest && nameScore(rest, ws.join(' ')) === 1 ? weight * 0.9 : 0);
  }
  return best;
}
// The client a title (and place) most likely belongs to: { id, score } or null. Two
// clients that fit as well are none (a wrong client is worse than no client).
export function matchClient(text, clients = [], location = '') {
  let best = null;
  let tie = false;
  for (const c of clients) {
    const s = Math.max(clientScore(text, c), clientScore(location, c) * 0.9);
    if (s < 0.8) continue;
    if (!best || s > best.score + 1e-9) { best = { id: c.id, score: s }; tie = false; } else if (Math.abs(s - best.score) < 1e-9 && best.id !== c.id) tie = true;
  }
  return best && !tie ? best : null;
}

// ── The rows ──────────────────────────────
const clip = (s, n) => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
// The events of a feed in the window around `now`, as rows of
// public.calendar_external_events: { uid, starts_at, ends_at, all_day, summary, location,
// client_id, kind_guess }, with { stats }. `clients`: [{ id, name, business }].
export function googleRows(text, { clients = [], now = new Date() } = {}) {
  const { events } = parseIcs(text);
  const from = new Date(+now - WINDOW.back * DAY);
  const until = new Date(+now + WINDOW.ahead * DAY);
  const stats = { events: events.length, recurring: 0, unwalked: 0, cancelled: 0, rows: 0 };
  // A moved or cancelled occurrence: its own VEVENT, with the master's UID and a RECURRENCE-ID.
  const moved = new Map();
  for (const e of events) if (e.recurrenceId && e.uid) moved.set(`${e.uid}#${stampWhen(e.recurrenceId)}`, e);
  const out = new Map();
  const add = (e, startWall, uid) => {
    const allDay = !!e.start.day;
    const start = allDay ? wallToDate([startWall[0], startWall[1], startWall[2]], TZ) : wallToDate(startWall, e.start.zone);
    let endMs = null;
    if (e.end) endMs = +instantOf(e.end) - +instantOf(e.start) + +start;
    else if (e.duration !== null) endMs = +start + e.duration;
    else if (allDay) endMs = +wallToDate([startWall[0], startWall[1], startWall[2] + 1], TZ);
    // A whole day keeps its days in Israel (the end is the start of the day after the last).
    if (allDay && e.end?.day) {
      const utcDay = (w) => Date.UTC(w[0], w[1] - 1, w[2]);
      const n = Math.round((utcDay(e.end.wall) - utcDay(e.start.wall)) / DAY);
      endMs = +wallToDate([startWall[0], startWall[1], startWall[2] + Math.max(1, n)], TZ);
    }
    const end = endMs !== null && endMs > +start ? new Date(endMs) : null;
    if (start > until || (end || start) < from) return;
    const summary = clip(e.summary, 200);
    const location = clip(e.location, 200);
    const match = matchClient(summary, clients, location);
    out.set(uid, {
      uid: clip(uid, 400), starts_at: start.toISOString(), ends_at: end ? end.toISOString() : null, all_day: allDay,
      summary, location, client_id: match?.id || null, kind_guess: kindGuess(summary),
    });
  };
  for (const e of events) {
    const base = e.uid || `nouid-${stampWhen(e.start)}-${clip(e.summary, 40)}`;
    if (e.recurrenceId) {
      if (e.status === 'CANCELLED') { stats.cancelled += 1; continue; }
      add(e, e.start.wall, `${base}#${stampWhen(e.recurrenceId)}`);
      continue;
    }
    if (e.status === 'CANCELLED') { stats.cancelled += 1; continue; }
    if (!e.rrule) { add(e, e.start.wall, base); continue; }
    stats.recurring += 1;
    if (!walkable(e.rrule)) stats.unwalked += 1;
    const skip = new Set(e.exdates.map(stampWhen));
    for (const w of occurrences(e, until)) {
      const stamp = stampOf(w, !!e.start.day, e.start.zone);
      const uid = `${base}#${stamp}`;
      if (skip.has(stamp) || moved.has(uid)) continue;
      add(e, w, uid);
    }
  }
  const rows = [...out.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.uid.localeCompare(b.uid)).slice(0, MAX_ROWS);
  stats.rows = rows.length;
  return { rows, stats };
}

// ── On the calendar page ──────────────────
// A row of public.calendar_external_events as an event of the page (app/calendar-view.js).
export function googleEvent(row) {
  const allDay = row.all_day ? dayKeyIL(row.starts_at) : null;
  return {
    uid: `g:${row.uid}`, kind: 'google', title: row.summary || 'אירוע ביומן', start: row.starts_at,
    ...(allDay ? { allDay } : row.ends_at ? { end: row.ends_at } : { minutes: 60 }),
    client: row.client_id || null, google: row,
  };
}
const ownShootDays = (c) => [c.shoot_at, ...(c.rounds || []).map((r) => r?.shoot_at)].filter(Boolean).map((d) => dayKeyIL(d));
// The suggestion under a Google event, or null: { kind: 'char' | 'shoot', at } when the
// event names a client, says it is a characterization meeting or a shoot day, is ahead,
// was not answered "לא קשור", and the system does not already hold that day for it:
//   - a meeting: the client has no meeting date, or a coming one on another day (a meeting
//     already held is not moved from here);
//   - a shoot day: the client has no shoot date, or a coming one on another day, and no
//     round of it is on that day (a later round is set in the client's card).
export function suggestionOf(row, client, { now = new Date() } = {}) {
  if (!row || !client || row.dismissed_at || row.all_day || !row.client_id || row.client_id !== client.id) return null;
  if (!['char', 'shoot'].includes(row.kind_guess)) return null;
  if (client.status && !['active', 'ending'].includes(client.status)) return null;
  const at = new Date(row.starts_at);
  if (!(at > now)) return null;
  const day = dayKeyIL(at);
  const today = dayKeyIL(now);
  if (row.kind_guess === 'char') {
    if (client.char_at && (dayKeyIL(client.char_at) === day || dayKeyIL(client.char_at) < today)) return null;
    return { kind: 'char', at };
  }
  if (ownShootDays(client).includes(day)) return null;
  if (client.shoot_at && dayKeyIL(client.shoot_at) < today) return null;
  return { kind: 'shoot', at };
}
// "לקבוע במערכת כפגישת אפיון של <client>?"
export const suggestionText = (s, client) => `לקבוע במערכת ${s.kind === 'char' ? 'כפגישת אפיון' : 'כיום צילום'} של ${client.business || client.name}?`;
