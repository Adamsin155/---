// "מעקב לקוחות", the tab "ימי צילום" (Irit's request, 10.11.2026; tracking.html#shoots): every
// client in work that the contract gives shoot days, with how many it has, how many are left, and
// whether the next one is set. Pure, no DOM (tests/tracking-shoots.test.mjs); the page is
// app/tracking-shoots.js. The date itself is set in the client's card; numbers fixed by hand
// (app/tracking-fix-logic.js) and the Channel 14 dates (app/tracking-ch14-logic.js) are read here.
//
// Where each value comes from (docs/ops.md, section 122):
//   total      the contract's shoot days: deliverables.shoot_days + photo_days (shootHistory.agreed)
//   remaining  total less the days that took place (shootHistory.held: a date behind today, or a
//              mark that says so, or the card's counter "נמסרו")
//   status     "נקבע" when a shoot day from today on has a date (shootHistory.next); "ממתין לקביעה"
//              when none is set and days remain; "בוצעו כולם" when every day took place.
//              A client with a shoot day every month (deliverables.shoot_monthly): by the current
//              Israel month, set when it has a shoot day this month or one ahead.
//   type       who comes on each day: the client's shoot type, each round's, and the plan of the
//              days not added yet (app/shoot-plan.js shootDays); plus "יום צילום כל חודש".
//   benefit    what the contract adds without a count: "סמיון מצטרף" (deliverables.simeon_join) and
//              the lines added by hand to a custom contract (deliverables.extra), as the contract
//              summary shows them (app/contract-summary.js). On 10.11.2026 no client in work had any.
import { roundsOf, isMonthlyRound, parseDate, clientLabel } from './protocol-logic.js';
import { shootHistory } from './shoot-table.js';
import { shootDays } from './shoot-plan.js';
import { isShootMonthly, monthName } from './monthly-shoot.js';
import { FLAGS } from './contract-summary.js';
import { inWork, dayMonth } from './tracking-logic.js';
import { partsIL, dayKeyIL } from './tz.js';
import { fixOf } from './tracking-fix-logic.js';
import { ch14Of } from './tracking-ch14-logic.js';

const pad = (n) => String(n).padStart(2, '0');
// 'YYYY-MM' of the Israel month of a moment.
export const monthOf = (d) => { const p = partsIL(d); return `${p.year}-${pad(p.month)}`; };
// "אוגוסט 2026".
export const monthLabel = (key) => (monthName(key) ? `${monthName(key)} ${key.slice(0, 4)}` : '');

export const MONTHLY_WORDS = 'יום צילום כל חודש';
export const STATUS = { waiting: 'ממתין לקביעה', set: 'נקבע', done: 'בוצעו כולם' };
const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

// Whether the contract gives the client shoot days: a number, or one every month.
export const hasShootDays = (client) => n(client?.deliverables?.shoot_days) + n(client?.deliverables?.photo_days) > 0 || isShootMonthly(client);

// Who comes, each name once: "נטלי דדון · דניס, מישל וסמיון".
export function typeNames(client) {
  return [...new Set(shootDays(client).map((d) => d.who).filter(Boolean))];
}
// What the contract adds: ["סמיון מצטרף ליום הצילום עם נטלי (…)", "צילומי מוצר × 2"].
export function benefitsOf(client) {
  const d = client?.deliverables || {};
  const extra = (Array.isArray(d.extra) ? d.extra : []).filter((x) => x && String(x.label || '').trim())
    .map((x) => (n(x.qty) > 0 ? `${String(x.label).trim()} × ${n(x.qty)}` : String(x.label).trim()));
  return [...FLAGS.filter((f) => n(d[f.key]) > 0).map((f) => f.text), ...extra];
}

// The shoot days with a date: the client's own and every shoot round's (a monthly editing round is
// not a shoot day).
const datesOf = (client) => [client?.shoot_at, ...roundsOf(client || {}).filter((r) => !isMonthlyRound(r)).map((r) => r?.shoot_at)]
  .map(parseDate).filter(Boolean);

// Where the date is set in the card: day 1 has none yet (process 11, "קביעת יום צילום"); a round
// added without a date (#round-N); else the next day of the package (#add-round, as Irit's line in
// "המשימות שלי").
export function setHash(client) {
  if (!parseDate(client?.shoot_at)) return '#p11';
  const open = roundsOf(client).filter((r) => !isMonthlyRound(r) && !parseDate(r.shoot_at)).sort((a, b) => a.n - b.n)[0];
  return open ? `#round-${open.n}` : '#add-round';
}

// One client's row.
//   checks: this client's checks by item key.
export function shootRow(client, checks = {}, now = new Date()) {
  const h = shootHistory(client, checks, now);
  const monthly = isShootMonthly(client);
  // A number fixed by hand stands in place of the count (app/tracking-fix-logic.js).
  const fix = fixOf(client, 'shoots');
  const autoTotal = h.agreed || null;
  const total = fix?.agreed ?? autoTotal;
  const held = fix?.held ?? h.held;
  const remaining = total ? Math.max(0, total - held) : null;
  let status;
  let date = h.next;
  if (monthly) {
    const key = monthOf(now);
    const thisMonth = datesOf(client).filter((d) => monthOf(d) === key).sort((a, b) => a - b);
    if (!date && thisMonth.length) date = thisMonth.at(-1);
    status = date ? 'set' : 'waiting';
  } else {
    status = date ? 'set' : remaining === 0 ? 'done' : 'waiting';
  }
  const autoStatus = status;
  if (fix?.status) status = fix.status;
  if (status === 'waiting') date = null;
  const past = date && dayKeyIL(date) < dayKeyIL(now);
  const deal = parseDate(client.deal_at);
  const cardUrl = `client.html?id=${encodeURIComponent(client.id)}`;
  return {
    id: client.id,
    label: clientLabel(client),
    dealAt: deal,
    dealMonth: deal ? monthOf(deal) : '',
    total, held, remaining, monthly,
    auto: { held: h.held, agreed: autoTotal, status: autoStatus },
    fix: fix ? { by: fix.by, at: fix.at, held: fix.held ?? null, agreed: fix.agreed ?? null, status: fix.status || null } : null,
    ch14: ch14Of(client, now),
    types: typeNames(client),
    benefits: benefitsOf(client),
    status, date,
    statusText: status === 'set' ? (date ? `${past ? 'צולם החודש' : STATUS.set} · ${dayMonth(date)}` : STATUS.set) : STATUS[status],
    action: status === 'waiting' ? { text: 'קביעת יום צילום', href: cardUrl + setHash(client), set: true }
      : { text: 'צפה בפרטים', href: cardUrl, set: false },
  };
}

// The waiting first, then the set, then the done; in each, the oldest deal first (no deal date
// last), then by name.
const ORDER = { waiting: 0, set: 1, done: 2 };
export function sortShoots(rows) {
  return [...rows].sort((a, b) => (ORDER[a.status] - ORDER[b.status])
    || ((a.dealAt ? +a.dealAt : Infinity) - (b.dealAt ? +b.dealAt : Infinity))
    || a.label.localeCompare(b.label, 'he'));
}

// The rows of the tab: the clients in work with shoot days, in order.
//   checks: { clientId: { itemKey: row } }
export function shootRows(clients, checks = {}, now = new Date()) {
  return sortShoots((clients || []).filter((c) => inWork(c) && hasShootDays(c)).map((c) => shootRow(c, checks[c.id] || {}, now)));
}

// The tiles: waiting, 2 days, 3 days, every month.
export function shootTiles(rows) {
  return {
    waiting: rows.filter((r) => r.status === 'waiting').length,
    two: rows.filter((r) => r.total === 2).length,
    three: rows.filter((r) => r.total === 3).length,
    monthly: rows.filter((r) => r.monthly).length,
  };
}
// The filter "אייטם בערוץ 14" (the owner, 10.11.2026): '' (everyone) | 'yes' | 'waiting' (an item without a date).
export const CH14_FILTER = [['yes', 'יש אייטם בערוץ 14'], ['waiting', 'ערוץ 14 ממתין לקביעה']];
function ch14Match(r, v) {
  if (!v) return true;
  if (!r.ch14) return false;
  return v === 'waiting' ? !r.ch14.set : true;
}

// The filters' choices, from the rows themselves.
//   types: [{ value, label }] — every name that comes, by name, then "יום צילום כל חודש".
//   months: [{ value: 'YYYY-MM', label: 'אוגוסט 2026' }] — the newest first.
export function typeOptions(rows) {
  const names = [...new Set(rows.flatMap((r) => r.types))].sort((a, b) => a.localeCompare(b, 'he'));
  const out = names.map((t) => ({ value: t, label: t }));
  if (rows.some((r) => r.monthly)) out.push({ value: 'monthly', label: MONTHLY_WORDS });
  return out;
}
export function monthOptions(rows) {
  return [...new Set(rows.map((r) => r.dealMonth).filter(Boolean))].sort().reverse().map((k) => ({ value: k, label: monthLabel(k) }));
}

// The filters: { status: '' | 'waiting' | 'set', type: '' | name | 'monthly', month: '' | 'YYYY-MM', q }.
// The search: the client's name, any part of it (as the first tab).
const plain = (s) => String(s || '').toLocaleLowerCase('he').replace(/\s+/g, ' ').trim();
export function filterShoots(rows, { status = '', type = '', month = '', q = '', ch14 = '' } = {}) {
  const t = plain(q);
  return rows.filter((r) => (!status || r.status === status) && ch14Match(r, ch14)
    && (!type || (type === 'monthly' ? r.monthly : r.types.includes(type)))
    && (!month || r.dealMonth === month)
    && (!t || plain(r.label).includes(t)));
}

// The line under the table.
export function waitingLine(rows) {
  const k = rows.filter((r) => r.status === 'waiting').length;
  if (!k) return 'אין כאן לקוחות שממתינים לקביעת יום צילום';
  return k === 1 ? 'סה״כ: לקוח אחד שטרם נקבע לו יום צילום' : `סה״כ: ${k} לקוחות שטרם נקבע להם יום צילום`;
}
// The cells' words: "2" / "כל חודש"; "1" / "—".
export const totalText = (r) => (r.total ? String(r.total) : r.monthly ? 'כל חודש' : '—');
export const remainingText = (r) => (r.remaining === null ? '—' : String(r.remaining));
// "1.8.2026"
export const dealText = (d) => { if (!d) return '—'; const p = partsIL(d); return `${p.day}.${p.month}.${p.year}`; };
