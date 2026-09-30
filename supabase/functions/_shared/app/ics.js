// generated — edit app/ instead. Source: app/ics.js. Regenerate: node scripts/sync-functions.mjs
// iCalendar (RFC 5545) text: the personal calendar feed (supabase/functions/calendar,
// app/calendar-feed.js) and the one-event .ics files of app/calendar.js. Pure: no
// DOM, no Deno, so node tests it and the edge function runs the same copy
// (supabase/functions/_shared/app, scripts/sync-functions.mjs).
//
//  - Timed events are written in UTC (…Z), which every calendar shows in its own
//    zone; all-day events are a bare DATE (the Israel day), ending the next day.
//  - Text is escaped (\\ ; , and new lines), control characters are dropped, and
//    every line is folded at 75 octets of UTF-8 (Hebrew letters are 2 octets), never
//    inside a character; lines end with CRLF.
//  - UID is stable per event (the feed builds it from the client, the round and the
//    kind), DTSTAMP is the moment the feed was made, and SEQUENCE grows with the
//    event's last change (minutes since 1.1.2026), so a moved shoot day replaces the
//    old one in calendars that keep copies.

const pad = (n) => String(n).padStart(2, '0');
const enc = new TextEncoder();

// 20261001T070000Z
export function utcStamp(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error('bad date');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// 'YYYY-MM-DD' -> '20261001', and the day after it (DTEND of an all-day event is exclusive).
export function dateValue(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ''));
  if (!m) throw new Error('bad day');
  return `${m[1]}${m[2]}${m[3]}`;
}
export function nextDateValue(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ''));
  if (!m) throw new Error('bad day');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

// TEXT values (SUMMARY, DESCRIPTION, LOCATION): backslash, semicolon, comma and new
// lines escaped; other control characters removed.
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Folds one content line: at most 75 octets per physical line, continuation lines
// start with one space (which counts toward their 75). Splits between characters
// (code points), so a Hebrew letter or an emoji is never cut in half.
export function foldLine(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of String(line)) {
    const b = enc.encode(ch).length;
    const max = out.length ? 74 : 75;
    if (bytes + b > max) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// SEQUENCE from the time of an event's last change: whole minutes since 1.1.2026 UTC.
const SEQ_EPOCH = Date.UTC(2026, 0, 1);
export function sequenceOf(changedAt) {
  const t = changedAt ? new Date(changedAt).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((t - SEQ_EPOCH) / 6e4)) : 0;
}

// A UID must be one line of safe characters; anything else is replaced.
const cleanUid = (uid) => String(uid || '').replace(/[^A-Za-z0-9@._-]/g, '-').slice(0, 200);

// The lines of one VEVENT. `ev`: { uid, title, start, end | minutes, allDay ('YYYY-MM-DD'),
// description, location, url, changedAt, transparent }. `now`: DTSTAMP.
export function eventLines(ev, now = new Date()) {
  if (!ev?.uid) throw new Error('event without uid');
  const lines = ['BEGIN:VEVENT', `UID:${cleanUid(ev.uid)}`, `DTSTAMP:${utcStamp(now)}`];
  if (ev.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateValue(ev.allDay)}`, `DTEND;VALUE=DATE:${nextDateValue(ev.allDay)}`);
  } else {
    const start = new Date(ev.start);
    const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + (ev.minutes ?? 60) * 6e4);
    lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end > start ? end : new Date(start.getTime() + 6e4))}`);
  }
  lines.push(`SEQUENCE:${sequenceOf(ev.changedAt)}`);
  if (ev.changedAt) lines.push(`LAST-MODIFIED:${utcStamp(ev.changedAt)}`);
  lines.push(`SUMMARY:${escapeText(String(ev.title || '').slice(0, 250))}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(String(ev.description).slice(0, 2000))}`);
  if (ev.location) lines.push(`LOCATION:${escapeText(String(ev.location).slice(0, 300))}`);
  if (ev.url && /^https:\/\/[^\s]+$/.test(ev.url)) lines.push(`URL:${ev.url}`);
  lines.push(`TRANSP:${ev.transparent || ev.allDay ? 'TRANSPARENT' : 'OPAQUE'}`, 'END:VEVENT');
  return lines;
}

// A whole calendar. `name`: the calendar's name in the app; `refreshMinutes`: how
// often a subscribed calendar should come back (a hint; Google decides for itself).
// `feed: false` for a one-event file to import: no calendar name or refresh, so it
// lands in the person's own calendar.
export function buildCalendar({ name = 'אסטרטג', events = [], now = new Date(), refreshMinutes = 60, feed = true } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//astrateg//calendar//HE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (feed) {
    lines.push(`X-WR-CALNAME:${escapeText(name)}`, 'X-WR-TIMEZONE:Asia/Jerusalem',
      `REFRESH-INTERVAL;VALUE=DURATION:PT${refreshMinutes}M`, `X-PUBLISHED-TTL:PT${refreshMinutes}M`);
  }
  for (const ev of events) lines.push(...eventLines(ev, now));
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
