// "מעקב לקוחות", the tab "ימי צילום": the Channel 14 item (the owner approved, 10.11.2026). A client
// whose package has an item in Channel 14 (deliverables.ch14, which counts the free extra one too:
// app/protocol-logic.js packageDeliverables) gets a date for each item: "ממתין לקביעה", "נקבע · 20.11",
// and once the day is behind: "צולם · 20.11". Pure, no DOM (tests/tracking-ch14.test.mjs);
// the dialog is app/tracking-fix.js; docs/ops.md, section 122.
//
// Where it is kept: the client's free jsonb, no migration:
//   deliverables.ch14_dates = [{ at, by, set_at } | null, …]   one place per item, in order
// Who sets it: Irit, the owners, and Lior (whose item it is in the package year, app/year-logic.js).
import { isOwnerView } from './team-rules.js';
import { partsIL, dateIL, dayKeyIL } from './tz.js';

const known = (v) => !!v && !v.error;
export const CH14_SETTERS = ['irit', 'lior'];
export const canSetCh14 = (v) => isOwnerView(v) || (known(v) && CH14_SETTERS.includes(v.me));

// How many items the package has (0 when none).
export const ch14Count = (client) => {
  const n = Number(client?.deliverables?.ch14);
  return Number.isFinite(n) && n > 0 ? Math.min(24, Math.round(n)) : 0;
};
export const hasCh14 = (client) => ch14Count(client) > 0;

const validDate = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
// Each item's date (a Date or null), as many as the package has.
export function ch14Dates(client) {
  const kept = Array.isArray(client?.deliverables?.ch14_dates) ? client.deliverables.ch14_dates : [];
  return Array.from({ length: ch14Count(client) }, (_, i) => validDate(kept[i]?.at));
}

const dm = (d) => { const p = partsIL(d); return `${p.day}.${p.month}`; };
// One item: { state: 'waiting' | 'set' | 'shot', text, at }.
export function ch14Item(at, now = new Date()) {
  if (!at) return { state: 'waiting', text: 'ממתין לקביעה', at: null };
  const past = dayKeyIL(at) < dayKeyIL(now);
  return { state: past ? 'shot' : 'set', text: `${past ? 'צולם' : 'נקבע'} · ${dm(at)}`, at };
}
// The client's items, and whether all of them have a date (null when the package has none).
export function ch14Of(client, now = new Date()) {
  const q = ch14Count(client);
  if (!q) return null;
  const items = ch14Dates(client).map((d) => ch14Item(d, now));
  return { q, items, set: items.every((x) => x.state !== 'waiting') };
}

// The tile: "X נקבעו מתוך Y" (Y: the clients with an item; X: those with every item dated).
export function ch14Tile(rows) {
  const with14 = rows.filter((r) => r.ch14);
  return { total: with14.length, set: with14.filter((r) => r.ch14.set).length };
}

// The deliverables with item i's date set (at: a Date) or taken away (null). The rest is kept.
export function withCh14Date(deliverables, i, at, { by = '', now = new Date() } = {}) {
  const d = { ...(deliverables || {}) };
  const list = Array.isArray(d.ch14_dates) ? [...d.ch14_dates] : [];
  while (list.length <= i) list.push(null);
  list[i] = at ? { at: at.toISOString(), by, set_at: now.toISOString() } : null;
  while (list.length && !list.at(-1)) list.pop();
  if (list.length) d.ch14_dates = list; else delete d.ch14_dates;
  return d;
}

// The typed date: "20.11", "20.11.2026", "20.11.26", "20/11/2026" (a missing year: this one).
// The typed time: "10:30", "10.30", "1030", "10" (empty: no time, kept as 12:00).
// Returns { at: Date } or { error }.
export function parseDayTime(dayText, timeText, now = new Date()) {
  const dt = String(dayText ?? '').trim();
  if (!dt) return { error: 'צריך תאריך, למשל 20.11.' };
  const m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(dt);
  if (!m) return { error: 'התאריך לא ברור. כותבים יום.חודש, למשל 20.11.' };
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = m[3] ? Number(m[3]) : partsIL(now).year;
  if (year < 100) year += 2000;
  const tt = String(timeText ?? '').trim();
  let hour = 12;
  let minute = 0;
  if (tt) {
    const t = /^(\d{1,2})(?:[:.]?(\d{2}))?$/.exec(tt);
    if (!t || Number(t[1]) > 23 || Number(t[2] || 0) > 59) return { error: 'השעה לא ברורה. כותבים שעה:דקות, למשל 10:30.' };
    hour = Number(t[1]);
    minute = Number(t[2] || 0);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return { error: 'אין תאריך כזה.' };
  const at = dateIL(year, month, day, hour, minute);
  const p = partsIL(at);
  if (p.day !== day || p.month !== month) return { error: 'אין תאריך כזה.' };
  return { at };
}
// What the dialog's two fields show for a date kept: ["20.11.2026", "10:30"].
export function dayTimeText(at) {
  if (!at) return ['', ''];
  const p = partsIL(at);
  const pad = (n) => String(n).padStart(2, '0');
  return [`${p.day}.${p.month}.${p.year}`, `${pad(p.hour)}:${pad(p.minute)}`];
}
