// The parts of a client's package that the counting of the videos shares (17.11.2026; docs/ops.md,
// section 140): the client's shoots, each shoot's part of the package, and the day the count
// starts. Pure, apart from app/tracking-logic.js so that the check of "כל הסרטונים הועלו לדרייב"
// (app/drive-guard-logic.js) runs the same rules in the mcp function too (a copy runs there:
// node scripts/sync-functions.mjs).
import { editorsOf, shareOf } from './protocol.js';
import { roundsOf, roundContext, isMonthlyRound } from './protocol-logic.js';
import { videosPerDay } from './production.js';
import { dayKeyIL } from './tz.js';

// The client's shoots, the first one (its own) and every shoot round; a monthly editing round is
// not a shoot (app/monthly-rounds.js).
export function shootsOf(client) {
  return [{ ctx: client, pre: '', n: 1 },
    ...roundsOf(client).filter((r) => !isMonthlyRound(r)).map((r) => ({ ctx: roundContext(client, r), pre: `r${r.n}.`, n: Number(r.n) }))];
}

// One shoot's part of the package: the two editors' split when there is one, else the package's
// videos over its shoot days (as the editor's card says).
export function shootPart(ctx) {
  const eds = editorsOf(ctx);
  const s = eds.length === 2 ? shareOf(ctx, eds[0]) : null;
  return s ? s.total : videosPerDay(ctx);
}

// The day the package's count starts: the deal's day in Israel ('YYYY-MM-DD'); without a deal
// time, the day the client was opened; null when neither is known.
export function dealDayOf(client) {
  const t = Date.parse(client?.deal_at || client?.created_at || '');
  return Number.isFinite(t) ? dayKeyIL(new Date(t)) : null;
}

