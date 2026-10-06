// Israel time: the office clock, whatever the time zone of the device or the server.
// Every protocol date is an Israel wall-clock date (Asia/Jerusalem, including the
// move to winter time), so a deadline is the same on a phone abroad, in a browser
// set to UTC and in a database function. Intl only, no DOM: also runs in Deno.
export const TZ = 'Asia/Jerusalem';

const DAY = 864e5;
const HOUR = 36e5;
const pad = (n) => String(n).padStart(2, '0');

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});
// Offset of Israel from UTC at one moment, in ms, read from Intl.
function readOffset(t) {
  const p = {};
  for (const x of partsFmt.formatToParts(new Date(t))) p[x.type] = Number(x.value);
  const whole = Math.floor(t / 1000) * 1000;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - whole;
}
// Israel changes its clock on a whole UTC hour, so the offset is cached per hour
// (only when it is the same at both ends of that hour).
const offsets = new Map();
function offsetAt(t) {
  const hour = Math.floor(t / HOUR);
  let off = offsets.get(hour);
  if (off === undefined) {
    const a = readOffset(hour * HOUR);
    if (a !== readOffset(hour * HOUR + HOUR - 1)) return readOffset(t);
    if (offsets.size > 20000) offsets.clear();
    offsets.set(hour, a);
    off = a;
  }
  return off;
}

// Wall-clock parts of a moment in Israel (read-only). month is 1–12; weekday 0 = Sunday.
// The same moment is often asked for several times in a row, so recent ones are kept.
const recent = new Map();
export function partsIL(date) {
  const t = +new Date(date);
  let p = recent.get(t);
  if (!p) {
    const w = new Date(t + offsetAt(t));
    p = Object.freeze({
      year: w.getUTCFullYear(), month: w.getUTCMonth() + 1, day: w.getUTCDate(),
      hour: w.getUTCHours(), minute: w.getUTCMinutes(), second: w.getUTCSeconds(), ms: w.getUTCMilliseconds(),
      weekday: w.getUTCDay(),
    });
    if (recent.size > 2000) recent.clear();
    recent.set(t, p);
  }
  return p;
}

// The moment of an Israel wall-clock time. Out-of-range fields roll over like
// Date.UTC (day 32 is the 1st of the next month). A time skipped when the clock
// moves forward lands an hour later; a time that occurs twice takes the first.
export function dateIL(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // The offsets on either side of a clock change (the same one on most days).
  const before = offsetAt(wall - DAY / 2);
  const after = offsetAt(wall + DAY / 2);
  const fits = [before, after].map((o) => wall - o).filter((t) => t + offsetAt(t) === wall);
  return new Date(fits.length ? Math.min(...fits) : wall - before);
}

// 'YYYY-MM-DD' of the Israel calendar day of a moment.
export function dayKeyIL(date) {
  const p = partsIL(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
export const weekdayIL = (date) => partsIL(date).weekday;

// The same Israel day at a given wall-clock time (setHours, in Israel).
export function atTimeIL(date, hour, minute = 0, second = 0, ms = 0) {
  const p = partsIL(date);
  return dateIL(p.year, p.month, p.day, hour, minute, second, ms);
}
export const startOfDayIL = (date) => atTimeIL(date, 0);
export const endOfDayIL = (date) => atTimeIL(date, 23, 59, 59, 999);

// n Israel calendar days later (or earlier), at the same wall-clock time.
export function addDaysIL(date, n) {
  const p = partsIL(date);
  return dateIL(p.year, p.month, p.day + n, p.hour, p.minute, p.second, p.ms);
}

// A bare calendar day 'YYYY-MM-DD' as the start of that day in Israel (null if not a day).
export function dayFromKeyIL(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  return m ? dateIL(+m[1], +m[2], +m[3]) : null;
}

// Calendar days from the Israel day of `a` to the Israel day of `b` (tomorrow = 1).
export function daysBetweenIL(a, b) {
  const x = partsIL(a);
  const y = partsIL(b);
  return Math.round((Date.UTC(y.year, y.month - 1, y.day) - Date.UTC(x.year, x.month - 1, x.day)) / DAY);
}

// Value of an <input type="datetime-local"> in Israel time, and back.
export function inputValueIL(date) {
  if (!date) return '';
  const p = partsIL(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
export function fromInputIL(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
  return m ? dateIL(+m[1], +m[2], +m[3], +m[4], +m[5]) : null;
}

// Whether a date needs its year to be understood at `now`: not in the current year,
// or more than about nine months away ("5.10" a year ahead reads as this October).
export const FAR_DAYS = 270;
export const needsYear = (d, now) => !!d && !!now && (partsIL(d).year !== partsIL(now).year || Math.abs(daysBetweenIL(now, d)) > FAR_DAYS);
