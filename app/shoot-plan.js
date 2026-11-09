// "עם מי כל יום צילום" (Irit, 5.11.2026: Best Car's contract has two shoot days, one with Natali
// and one with Semion, and the card said one day). The client's own day is day 1 (its shoot_type);
// an extra round, once added, is its own day with its own influencer. Before a round is added, the
// influencer planned for that day is kept in clients.deliverables.shoot_plan, { "2": "dms" }.
// Pure: no DOM, no network (tests/shoot-plan.test.mjs).
import { SHOOT_TYPES, shootTypeName } from './protocol.js';
import { roundsOf, isMonthlyRound, parseDate } from './protocol-logic.js';
import { dateIL, partsIL } from './tz.js';

const MAX_DAYS = 12;

// The planned influencer of each later day, only known shoot types: { 2: 'dms' }.
export function planOf(client) {
  const raw = client?.deliverables?.shoot_plan;
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(k);
    if (Number.isInteger(n) && n >= 2 && n <= MAX_DAYS && SHOOT_TYPES[v]) out[n] = v;
  }
  return out;
}

// The new plan, kept on the deliverables: days 2..total only, empty choices dropped.
export function withPlan(deliverables, picks = {}) {
  const total = Number(deliverables?.shoot_days) || 0;
  const plan = {};
  for (const [k, v] of Object.entries(picks)) {
    const n = Number(k);
    if (Number.isInteger(n) && n >= 2 && n <= Math.min(total, MAX_DAYS) && SHOOT_TYPES[v]) plan[n] = v;
  }
  const next = { ...(deliverables || {}) };
  if (Object.keys(plan).length) next.shoot_plan = plan; else delete next.shoot_plan;
  return next;
}

// One line per shoot day: the days added (day 1 and the rounds), then the days still to come.
// { n, who, at, added, done? } — `who` is '' when nobody was chosen yet.
export function shootDays(client) {
  const rounds = roundsOf(client).filter((r) => !isMonthlyRound(r));
  const days = [{ n: 1, who: shootTypeName(client), at: client.shoot_at || null, added: true },
    ...rounds.map((r) => ({ n: r.n, who: shootTypeName(r.shoot_type || r.shoot_crew ? r : { shoot_type: client.shoot_type }), at: r.shoot_at || null, added: true }))];
  const total = Math.min(Number(client?.deliverables?.shoot_days) || 0, MAX_DAYS);
  const plan = planOf(client);
  const used = new Set(days.map((d) => d.n));
  let n = days.length;
  while (days.length < total) {
    n += 1;
    while (used.has(n)) n += 1;
    days.push({ n, who: SHOOT_TYPES[plan[n]]?.name || '', at: null, added: false });
  }
  return days;
}

// The influencer a new round starts with: the one planned for that day, else none.
export const plannedFor = (client, n) => planOf(client)[n] || null;

// ── Setting the shoot days, one after another (protocol v13; the owner's decision of 9.11.2026) ──
// Irit's line "לקבוע ל<לקוח> יום צילום" closes when the day has a date in the system (process 11, its
// `auto` item). A package with more than one day says which: "יום צילום 1 מתוך 2". Day 1 is the
// client's own shoot (shoot_at); each later day is a shoot round (clients.rounds, as "הוספת סבב
// צילום" adds it: app/client-card.js openRound). The next day's line opens on the 1st of the calendar
// month after the last day that was set, and stays until that day has a date; again every month
// until every day of the package is set.
const monthStart = (d) => { const p = partsIL(d); return dateIL(p.month === 12 ? p.year + 1 : p.year, p.month === 12 ? 1 : p.month + 1, 1); };
// How many shoot days the package has (deliverables.shoot_days), or 0 when unknown.
export const shootDaysTotal = (client) => Math.min(Math.max(Math.round(Number(client?.deliverables?.shoot_days) || 0), 0), MAX_DAYS);
// Which day of the package a shoot is: 1 for the client's own, and for a round its place among the
// shoot rounds (a monthly editing round is not a shoot day).
export function shootOrdinal(client, roundN = null) {
  if (!roundN) return 1;
  const ns = roundsOf(client).filter((r) => !isMonthlyRound(r)).map((r) => Number(r.n)).sort((a, b) => a - b);
  const i = ns.indexOf(Number(roundN));
  return i < 0 ? 1 : i + 2;
}
// "יום צילום 2 מתוך 3" (or "יום צילום" when the package has one day, or its size is unknown).
export function shootDayWords(client, roundN = null) {
  const total = shootDaysTotal(client);
  const n = shootOrdinal(client, roundN);
  return total > 1 ? `יום צילום ${n} מתוך ${total}` : 'יום צילום';
}
// The line of Irit's list: "לקבוע לקפה דנה יום צילום 1 מתוך 2".
export const setShootLine = (client, name, roundN = null) => `לקבוע ל${name} ${shootDayWords(client, roundN)}`;
// The next day of the package to set that has no round yet: { day, total, opensAt } once its line is
// open (now is on or after opensAt), else null. Null too while day 1 or an added round has no date
// (those are process 11's own lines), and when every day of the package is added.
export function nextShootDay(client, now = new Date()) {
  const total = shootDaysTotal(client);
  if (total < 2 || !client || !['active', 'ending'].includes(client.status ?? 'active')) return null;
  const rounds = roundsOf(client).filter((r) => !isMonthlyRound(r));
  const added = 1 + rounds.length;
  if (added >= total) return null;
  const dates = [client.shoot_at, ...rounds.map((r) => r.shoot_at)].map(parseDate);
  if (dates.some((d) => !d)) return null;
  const last = dates.reduce((a, b) => (b > a ? b : a));
  const opensAt = monthStart(last);
  return now >= opensAt ? { day: added + 1, total, opensAt } : null;
}
