// A monthly client's editing, every month by itself (the owner's decision of 4.11.2026: "פשוט
// תעשה את זה בלי חובת סבב צלמים"; docs/ops.md, section 94). Pure logic: the reminders function
// runs it on its tick (supabase/functions/reminders/tick.js) and writes what it returns.
//
// A monthly client (app/edit-count.js isMonthly: deliverables.videos_month) with a regular editor
// (clients.editor, and editor2) gets, on the first business day of each Israel month it has none,
// one extra round in clients.rounds that is the month's editing: { n, month, monthly: true,
// editor, editor2?, editor_split?, start_at }. It reuses the round mechanism, so the editor's page,
// Ofir's quality control (25), the client's approval (26–27) and Ilai's steps (28–29ב) run exactly
// as for any shoot round. Everything of the round that comes before the editing (the shoot day
// and its preparation, and the assignment's own lines) is marked not relevant, the assignment
// itself (22א) done with the client's editor, and "התקבל הכונן" (22) done, as there is no drive:
// the round starts at the editing and rings nobody but the editor.
import { PROCESSES, isRetired, editorsOf } from './protocol.js';
import { roundsOf, isMonthlyRound, isBusinessDay, parseDate } from './protocol-logic.js';
import { isMonthly, monthKey, monthTargetOf } from './edit-count.js';

export const MONTHLY_NOTE = 'סבב חודשי (אוטומטי)';
export const MONTHLY_NA_NOTE = 'סבב חודשי, בלי יום צילום';
export const MONTHLY_DRIVE_NOTE = 'סבב חודשי, בלי כונן';
export const ASSIGNED = 'p22a.assigned';
export const RECEIVED = 'p22.received';

// Every round process that comes before the editing (22) in the protocol's order, and the items
// of them that apply to anyone (an item a protocol version retired applies to nobody). From
// app/protocol.js, never a hand list: a process added there before 22 is covered by itself.
const EDITING = PROCESSES.findIndex((p) => p.id === 'p22');
export const BEFORE_EDITING = PROCESSES.slice(0, EDITING).filter((p) => p.round && !isRetired(p)).map((p) => p.id);
export const NA_KEYS = PROCESSES.filter((p) => BEFORE_EDITING.includes(p.id))
  .flatMap((p) => p.items.filter((i) => !isRetired(i)).map((i) => i.key))
  .filter((k) => k !== ASSIGNED);

const live = (c) => (c?.status === 'active' || c?.status === 'ending') && !c.archived_at && c.landing !== true;
const resolved = (c) => c?.state === 'done' || c?.state === 'na';
const monthOfDate = (v) => { const d = parseDate(v); return d ? monthKey(d) : null; };

// The month a round belongs to: a monthly round's own; a shoot round's, the month of its shoot day
// (or, with no date yet, of when it was added).
export const roundMonth = (r) => (isMonthlyRound(r) ? r.month : monthOfDate(r?.shoot_at || r?.start_at));

// Whether the month `key` already has its editing: a round of that month (monthly or a shoot
// round), or the client's own first shoot in it, or its own first editing assigned in it.
export function hasMonthWork(client, checks, key) {
  if (roundsOf(client).some((r) => roundMonth(r) === key)) return true;
  if (monthOfDate(client.shoot_at) === key) return true;
  const a = checks?.[ASSIGNED];
  return a?.state === 'done' && a.note !== 'ייבוא' && monthOfDate(a.at) === key;
}

// The marks of a monthly round `n`, as rows without the client: [{ item_key, state, note }].
export const monthlyMarks = (n) => [
  ...NA_KEYS.map((k) => ({ item_key: `r${n}.${k}`, state: 'na', note: MONTHLY_NA_NOTE })),
  { item_key: `r${n}.${ASSIGNED}`, state: 'done', note: MONTHLY_NOTE },
  { item_key: `r${n}.${RECEIVED}`, state: 'done', note: MONTHLY_DRIVE_NOTE },
];

// What to write for one client now (checks: its marks, item key → { state, note, at }), or null:
//   { month, n, rounds, marks }: `rounds` the client's new list (null when the round is already
//   there and only its marks are missing: a write that stopped half way), `marks` to insert
//   without overwriting any mark that exists.
// Nothing for: a client that is not live, in landing, not monthly or without an editor; a day that
// is not a business day; a month whose number is 0 (the office's "חריג לחודש": no videos); a client
// whose first cycle has not reached its editing yet; and a month that already has its editing.
// Running it again after its writes returns null (idempotent).
export function monthlyRoundPlan(client, checks = {}, now = new Date()) {
  if (!live(client) || !isMonthly(client) || !editorsOf(client).length) return null;
  if (!isBusinessDay(now)) return null;
  const month = monthKey(now);
  const mine = roundsOf(client).find((r) => isMonthlyRound(r) && r.month === month);
  if (mine) {
    // Written, and its marks not (the tick stopped between the two): the marks again. A round
    // with any mark of its own is left alone (someone may have changed it on purpose).
    const has = Object.keys(checks || {}).some((k) => k.startsWith(`r${mine.n}.`));
    return has ? null : { month, n: mine.n, rounds: null, marks: monthlyMarks(mine.n) };
  }
  if (!monthTargetOf(client, month)) return null;
  if (!resolved(checks?.[ASSIGNED])) return null;
  if (hasMonthWork(client, checks, month)) return null;
  const n = Math.max(1, ...roundsOf(client).map((r) => Number(r.n) || 0)) + 1;
  const [editor, editor2] = editorsOf(client);
  const round = {
    n, month, monthly: true, editor,
    ...(editor2 ? { editor2 } : {}),
    ...(editor2 && client.editor_split ? { editor_split: client.editor_split } : {}),
    start_at: now.toISOString(),
  };
  return { month, n, rounds: [...roundsOf(client), round], marks: monthlyMarks(n) };
}

// Every client's plan: [{ client, plan }]. `checks`: rows of public.protocol_checks.
export function monthlyRoundPlans(clients, checks = [], now = new Date()) {
  const by = new Map();
  for (const r of checks) {
    if (!by.has(r.client_id)) by.set(r.client_id, {});
    by.get(r.client_id)[r.item_key] = r;
  }
  return (clients || []).map((client) => ({ client, plan: monthlyRoundPlan(client, by.get(client.id) || {}, now) })).filter((x) => x.plan);
}
