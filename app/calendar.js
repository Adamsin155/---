// "Add to calendar" for the characterization meeting and the shoot day:
// a Google Calendar link and an .ics file (iPhone, Outlook). Times are written
// in UTC, which every calendar converts to the viewer's zone.
import { buildCalendar } from './ics.js';

const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function googleCalendarUrl({ title, start, minutes = 120, details = '', location = '' }) {
  const end = new Date(new Date(start).getTime() + minutes * 6e4);
  const q = new URLSearchParams({
    action: 'TEMPLATE', text: title, dates: `${utc(start)}/${utc(end)}`, details, location, ctz: 'Asia/Jerusalem',
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// One event as an .ics file (the builder and its escaping and folding: app/ics.js).
export function icsText({ uid, title, start, minutes = 120, details = '', location = '' }) {
  return buildCalendar({ events: [{ uid, title, start, minutes, description: details, location }], feed: false, now: new Date() });
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
