// A client with a shoot day every month (the owner's request of 28.10.2026: שטיחי רות,
// נקודת חן, בראשית, שווארמה לשלום, אופנה פוז, אלאור בוטיק), as pure logic. The office
// turns it on in the client's details, next to "סרטונים בחודש" (app/client-card.js): the
// client's deliverables say `shoot_monthly: true` (no column, no migration: deliverables
// is a free jsonb object, as for videos_month). On the last business day of every Israel
// month Irit is reminded to set the next month's shoot day with each such client (rule
// `monthlyShoot` in app/reminder-rules.js; docs/ops.md, section 71).
import { isBusinessDay, roundsOf, parseDate } from './protocol-logic.js';
import { dateIL, partsIL, addDaysIL } from './tz.js';

// 'YYYY-MM' of the Israel month of a moment, and n months later (as in app/edit-count.js,
// kept here so that the reminders function does not carry the editors' counting).
const pad = (n) => String(n).padStart(2, '0');
const isMonthKey = (k) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(k ?? ''));
const monthKey = (d) => { const p = partsIL(d); return `${p.year}-${pad(p.month)}`; };
function addMonth(key, n) {
  const t = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export const isShootMonthly = (client) => client?.deliverables?.shoot_monthly === true;
// The deliverables with the switch set (true) or taken away (false); everything else kept.
export function withShootMonthly(deliverables, on) {
  const out = { ...(deliverables || {}) };
  if (on) out.shoot_monthly = true; else delete out.shoot_monthly;
  return out;
}
// "נובמבר" ('YYYY-MM' → the month's Hebrew name, without the year).
export const monthName = (key) => (isMonthKey(key) ? MONTHS[Number(key.slice(5, 7)) - 1] : '');
// The last business day of an Israel month (Sunday to Thursday, not a holiday:
// isBusinessDay in app/protocol-logic.js), as noon of that day in Israel.
export function lastBusinessDay(key) {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  let d = addDaysIL(dateIL(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, 12), -1);
  for (let i = 0; i < 31 && !isBusinessDay(d); i += 1) d = addDaysIL(d, -1);
  return d;
}
// Whether `now` is on the last business day of its Israel month.
export function onLastBusinessDay(now) {
  const a = partsIL(now);
  const b = partsIL(lastBusinessDay(monthKey(now)));
  return a.year === b.year && a.month === b.month && a.day === b.day;
}
// The month after the Israel month of `now`, 'YYYY-MM'.
export const nextMonthKey = (now) => addMonth(monthKey(now), 1);
// Whether the client already has a shoot day (its own, or a round's) in that Israel month.
export function hasShootIn(client, key) {
  const dates = [client?.shoot_at, ...roundsOf(client || {}).map((r) => r?.shoot_at)].map(parseDate).filter(Boolean);
  return dates.some((d) => monthKey(d) === key);
}
