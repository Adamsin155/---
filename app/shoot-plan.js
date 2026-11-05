// "עם מי כל יום צילום" (Irit, 5.11.2026: Best Car's contract has two shoot days, one with Natali
// and one with Semion, and the card said one day). The client's own day is day 1 (its shoot_type);
// an extra round, once added, is its own day with its own influencer. Before a round is added, the
// influencer planned for that day is kept in clients.deliverables.shoot_plan, { "2": "dms" }.
// Pure: no DOM, no network (tests/shoot-plan.test.mjs).
import { SHOOT_TYPES, shootTypeName } from './protocol.js';
import { roundsOf, isMonthlyRound } from './protocol-logic.js';

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
