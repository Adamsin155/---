// "Add to calendar" for the characterization meeting and the shoot day:
// a Google Calendar link and an .ics file (iPhone, Outlook). Times are written
// in UTC, which every calendar converts to the viewer's zone.

const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function googleCalendarUrl({ title, start, minutes = 120, details = '', location = '' }) {
  const end = new Date(new Date(start).getTime() + minutes * 6e4);
  const q = new URLSearchParams({
    action: 'TEMPLATE', text: title, dates: `${utc(start)}/${utc(end)}`, details, location, ctz: 'Asia/Jerusalem',
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// RFC 5545 text escaping, and folding at 75 octets (UTF-8, so Hebrew counts double).
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function icsText({ uid, title, start, minutes = 120, details = '', location = '' }) {
  const end = new Date(new Date(start).getTime() + minutes * 6e4);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//astrateg//protocol//HE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${esc(title)}`,
    details ? `DESCRIPTION:${esc(details)}` : null,
    location ? `LOCATION:${esc(location)}` : null,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function downloadIcs(name, event) {
  const blob = new Blob([icsText(event)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.ics`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
