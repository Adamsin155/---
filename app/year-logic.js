// The whole package year (plan stage 5; section 4, stations 7–8; decisions 31 and 33).
// Pure, no DOM: year.html, "המשימות שלי", the client card and the reminder rules
// (app/year-rules.js, in the server tick) read the same months and items.
//
// The monthly cycle is a DRAFT (decision 31): a temporary process from the plan's
// proposal until there is a written protocol. For every active client, from month 2
// of the package (counted from deal_at, in Israel days) and once the first
// publishing (process 28) is done, each month has its items with an owner and a due
// date: Ilai plans the month and checks last month's content went up, Ofir sends
// the monthly report, the monthly photographer (when bought), and the package's
// once-a-term items spread over the year (channel 14, collabs, stories, a second
// shoot day). The podcast package has no cycle of its own (no protocol yet).
// Marks are kept per client and month (public.client_month_marks: month, item).
import { TERM_MONTHS } from './catalog.js';
import { addBusinessDays, isBusinessDay, parseDate, roundsOf, inLanding, workFloor } from './protocol-logic.js';
import { partsIL, dateIL, endOfDayIL, addDaysIL, atTimeIL, dayKeyIL, daysBetweenIL } from './tz.js';

export const DRAFT_LABEL = 'טיוטה — עד שיהיה פרוטוקול כתוב';
export const CYCLE_FROM = 2;          // month 1 is the onboarding protocol
export const SOON_DAYS = 7;           // an item shows in "המשימות שלי" this many days before its due date
export const RENEWAL_DAYS = 90;       // the renewals list (station 8)

// ── Months ────────────────────────────────
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// The first day (Israel midnight) of month n of the package: the deal's day of the
// month, n - 1 months later (the 31st becomes the month's last day).
export function monthStart(client, n) {
  const deal = parseDate(client?.deal_at);
  if (!deal || !Number.isInteger(n) || n < 1) return null;
  const p = partsIL(deal);
  const idx = p.month - 1 + (n - 1);
  const y = p.year + Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return dateIL(y, m, Math.min(p.day, daysInMonth(y, m)));
}
// How many months the package runs: from the deal to the contract's end, else the catalog's term.
export function termOf(client) {
  const deal = parseDate(client?.deal_at);
  const end = parseDate(client?.contract_end);
  if (!deal || !end || end <= deal) return TERM_MONTHS;
  const a = partsIL(deal);
  const b = partsIL(end);
  return Math.max(1, Math.min(120, (b.year - a.year) * 12 + (b.month - a.month)));
}
// The month of the package that `now` falls in: { n, of, start, next, over }.
export function monthOf(client, now = new Date()) {
  const first = monthStart(client, 1);
  if (!first) return null;
  const of = termOf(client);
  if (now < first) return { n: 1, of, start: first, next: monthStart(client, 2), over: false, early: true };
  let n = 1;
  while (n < 240 && monthStart(client, n + 1) <= now) n += 1;
  return { n: Math.min(n, of), of, start: monthStart(client, Math.min(n, of)), next: monthStart(client, Math.min(n, of) + 1), over: n > of };
}

// The nth business day before the Israel day of `d`, at its end.
function businessDayBefore(d, n = 1) {
  let x = atTimeIL(d, 12);
  let left = n;
  while (left > 0) { x = addDaysIL(x, -1); if (isBusinessDay(x)) left -= 1; }
  return endOfDayIL(x);
}
// The last business day of month m (the business day before month m + 1 starts).
const monthEnd = (client, m) => businessDayBefore(monthStart(client, m + 1), 1);

// The first month of the cycle: the month after the first publishing (28) was
// done (for a client brought in mid-way, the month after it was imported), never
// before month 2, so nothing of it is late on the day it appears. Null until 28 is done.
export function cycleFrom(client, state) {
  // A client in landing has no cycle yet; once it is activated the cycle starts the
  // month after the activation (docs/ops.md, section 41), so no item of it is born
  // late. The months themselves are still counted from the real deal_at.
  if (inLanding(client)) return null;
  const p28 = state?.states?.find((s) => s.proc.id === 'p28');
  if (!p28?.complete || !p28.completedAt) return null;
  const floor = workFloor(client);
  const at = floor && p28.completedAt < floor ? floor : p28.completedAt;
  let k = 1;
  while (k < 240 && monthStart(client, k + 1) && monthStart(client, k + 1) <= at) k += 1;
  return Math.max(CYCLE_FROM, k + 1); // k: the month that holds the completion
}

// ── The items of a month ──────────────────
const qty = (d, k) => Math.max(0, Math.floor(Number(d?.[k]) || 0));
const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);
// Every month of the cycle.
export const MONTH_ITEMS = [
  {
    key: 'plan', owner: 'ilai',
    label: (x) => `חודש ${x.n} מתוכנן: התכנים מתוזמנים והגאנט מעודכן`,
    due: (x) => businessDayBefore(x.start, 1),
  },
  {
    key: 'posted', owner: 'ilai',
    label: (x) => `נבדק שהתוכן של חודש ${x.n - 1} עלה בפועל לפי הגאנט`,
    due: (x) => addBusinessDays(x.start, 2),
  },
  {
    key: 'report', owner: 'ofir',
    label: (x) => `דוח חודשי על חודש ${x.n - 1} נשלח ללקוח`,
    due: (x) => addBusinessDays(x.start, 3),
  },
  {
    key: 'photo', owner: 'irit', when: (x) => qty(x.d, 'monthly') > 0,
    label: () => 'תואם מועד לצלם החודשי',
    due: (x) => addBusinessDays(x.start, 3),
  },
  // The package's monthly count is 8 a month over the catalog's term (packageDeliverables).
  {
    key: 'photoshot', owner: 'lior', when: (x) => qty(x.d, 'monthly') > 0,
    label: (x) => `הצלם החודשי צילם, והתכנים (${plural(Math.max(1, Math.round(qty(x.d, 'monthly') / TERM_MONTHS)), 'תוכן אחד', 'תכנים')}) עברו לעריכה`,
    due: (x) => addBusinessDays(x.start, 12),
  },
];
// The package's once-a-term items, spread evenly over the cycle's months.
export const SPREAD_ITEMS = [
  { key: 'ch14', owner: 'lior', qty: (d) => qty(d, 'ch14'), label: (k, q) => `אייטם בערוץ 14${q > 1 ? ` (${k} מתוך ${q})` : ''}: תואם וצולם` },
  { key: 'collab', owner: 'lior', qty: (d) => qty(d, 'collabs'), label: (k, q) => `קולאב באינסטגרם אצל המשפיענים${q > 1 ? ` (${k} מתוך ${q})` : ''} עלה` },
  { key: 'story', owner: 'lior', qty: (d) => qty(d, 'stories'), label: (k, q) => `סטורי אצל המשפיענים${q > 1 ? ` (${k} מתוך ${q})` : ''} עלה` },
  {
    key: 'round', owner: 'irit', qty: (d) => Math.max(0, qty(d, 'shoot_days') - 1),
    label: (k) => `יום צילום ${k + 1}: נפתח סבב צילום ונקבע תאריך`,
    // Done by itself once the round is in the client card.
    auto: (client, k) => roundsOf(client).some((r) => Number(r.n) === k + 1),
  },
];
// The month (from..of) that holds unit k of q, spread evenly, in the middle of its share.
export function spreadMonth(k, q, from, of) {
  const slots = Math.max(1, of - from + 1);
  return from + Math.min(slots - 1, Math.floor(((k - 0.5) * slots) / q));
}

// A stored mark's key: `item` or `item.k` (tests/sql and the migration check the same shape).
export const MARK_ITEM = /^[a-z][a-z0-9]*(\.[0-9]{1,2})?$/;

// The items of month n for this client (none outside the cycle): { key, month, owner, label, dueAt, auto }.
export function monthItems(client, n, { from = CYCLE_FROM } = {}) {
  const of = termOf(client);
  if (!Number.isInteger(n) || n < Math.max(CYCLE_FROM, from) || n > of) return [];
  const start = monthStart(client, n);
  if (!start) return [];
  const x = { client, n, of, start, d: client.deliverables || {} };
  const out = [];
  for (const it of MONTH_ITEMS) {
    if (it.when && !it.when(x)) continue;
    out.push({ key: it.key, month: n, owner: it.owner, label: it.label(x), dueAt: it.due(x), auto: false });
  }
  const first = Math.max(CYCLE_FROM, from);
  for (const it of SPREAD_ITEMS) {
    const q = Math.min(24, it.qty(x.d));
    for (let k = 1; k <= q; k += 1) {
      if (spreadMonth(k, q, first, of) !== n) continue;
      out.push({ key: `${it.key}.${k}`, month: n, owner: it.owner, label: it.label(k, q), dueAt: monthEnd(client, n), auto: !!it.auto?.(client, k) });
    }
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}

// Marks as { `${month}:${item}`: row } from rows { client_id, month, item, state, ... } of one client.
export const markKey = (month, item) => `${month}:${item}`;
export function marksByKey(rows = []) {
  const out = {};
  for (const r of rows) out[markKey(r.month, r.item)] = r;
  return out;
}
// Rows of every client, grouped: { clientId: { `${month}:${item}`: row } }.
export function groupMarks(rows = []) {
  const out = {};
  for (const r of rows || []) (out[r.client_id] ||= {})[markKey(r.month, r.item)] = r;
  return out;
}

// An item with its mark and status: done | na | auto | overdue | today | open | later.
export function itemState(item, marks = {}, now = new Date()) {
  const mark = marks[markKey(item.month, item.key)] || null;
  let status;
  if (mark?.state === 'done') status = 'done';
  else if (mark?.state === 'na') status = 'na';
  else if (item.auto) status = 'auto';
  else if (item.dueAt < now) status = 'overdue';
  else if (dayKeyIL(item.dueAt) === dayKeyIL(now)) status = 'today';
  else status = daysBetweenIL(now, item.dueAt) <= SOON_DAYS ? 'open' : 'later';
  return { ...item, mark, status, resolved: status === 'done' || status === 'na' || status === 'auto' };
}

// Month n of a client, with its items' states and counts.
export function monthState(client, n, marks = {}, now = new Date(), from = CYCLE_FROM) {
  const items = monthItems(client, n, { from }).map((i) => itemState(i, marks, now));
  return { n, start: monthStart(client, n), items, total: items.length, done: items.filter((i) => i.resolved).length, late: items.filter((i) => i.status === 'overdue').length };
}

const live = (c) => c.status === 'active';

// The client's year: which month it is in, where the cycle starts, and each month's
// counts ({ n, total, done, late, current, before }).
export function yearOf(client, state, checks = {}, marks = {}, now = new Date()) {
  const m = monthOf(client, now);
  if (!m) return null;
  const from = cycleFrom(client, state);
  const months = [];
  for (let n = 1; n <= m.of; n += 1) {
    if (from === null || n < from) { months.push({ n, total: 0, done: 0, late: 0, before: true, current: n === m.n }); continue; }
    const s = n <= m.n + 1 ? monthState(client, n, marks, now, from) : { n, total: monthItems(client, n, { from }).length, done: 0, late: 0 };
    months.push({ n, total: s.total, done: s.done, late: s.late || 0, before: false, current: n === m.n, future: n > m.n });
  }
  const current = from !== null && live(client) && m.n >= from ? monthState(client, m.n, marks, now, from) : null;
  return { ...m, from, months, current };
}

// Open items of the cycle `person` can act on now in one client: this month's, and
// next month's that are due before it starts, within SOON_DAYS (Ilai plans the next
// month in this one).
// Only active clients; null person: everyone's.
export function openMonthItems(person, client, state, checks = {}, marks = {}, now = new Date()) {
  if (!live(client)) return [];
  const m = monthOf(client, now);
  const from = cycleFrom(client, state);
  if (!m || from === null || m.over) return [];
  const out = [];
  for (const n of [m.n, m.n + 1]) {
    for (const i of monthItems(client, n, { from })) {
      if (person && i.owner !== person) continue;
      const s = itemState(i, marks, now);
      if (s.resolved || s.status === 'later') continue;
      // Of next month: only what is due before it starts (planning it), within SOON_DAYS.
      if (n > m.n && (i.dueAt >= monthStart(client, n) || daysBetweenIL(now, i.dueAt) > SOON_DAYS)) continue;
      out.push({ ...s, client });
    }
  }
  return out;
}

// ── Renewals (station 8, processes 34–35) ──
// Active clients whose contract ends within `days` (and has not ended), soonest first.
export function renewalsDue(clients, now = new Date(), days = RENEWAL_DAYS) {
  const today = atTimeIL(now, 0);
  const out = [];
  for (const c of clients) {
    if (c.status !== 'active') continue;
    const end = parseDate(c.contract_end);
    if (!end) continue;
    const left = daysBetweenIL(today, end);
    if (left < 0 || left > days) continue;
    out.push({ client: c, endAt: end, daysLeft: left });
  }
  return out.sort((a, b) => (a.endAt - b.endAt) || String(a.client.name).localeCompare(String(b.client.name), 'he'));
}
