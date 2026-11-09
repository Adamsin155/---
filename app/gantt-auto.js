// The scheduling closes by itself (protocol v13; the owner's decision of 9.11.2026; docs/ops.md,
// section 119). Ilai no longer ticks "הסרטונים והגרפיקות תוזמנו" (p28.scheduled) or "הגאנט מלא"
// (p29.filled): once EVERY content row of the client's Gantt is scheduled or posted (Metricool's
// sync, or Ilai's own "תוזמן" in gantt.html), the system writes one mark, GANTT_READY (p28.auto),
// once. From that mark on everything runs as it did when Ilai marked them: 28 is complete, Irit's
// "הגאנט הועבר ללקוח" (p29.sent) opens with its 30 office minutes, her ring "לשלוח גאנט" and the
// handoff (app/handoffs.js) go out.
//
// Pure: no DOM, no network. Two writers call it: the reminders function on every tick
// (supabase/functions/reminders/tick.js, a copy of this file), and gantt.html right after a save
// (app/gantt.js), so it is there at once. The mark is written with "insert, never over a mark that
// exists" (the database's unique key on client_id and item_key), so two writers never write it twice.
//
// It is written only:
//   - for a client in work, not in landing;
//   - when the scheduling is the step the client is at: the client approved the videos (27 is
//     complete) and 28 is open (a round: the round's own 27 and 28; the round's key `r2.p28.auto`);
//   - when the Gantt has at least one content row (an empty Gantt is not "all scheduled"), and every
//     content row (a kind the Gantt publishes, not a skipped one) is 'scheduled' or 'posted'.
import { GANTT_READY } from './protocol.js';
import { GANTT_KINDS } from './gantt-template.js';
import { inLanding } from './protocol-logic.js';

export const AUTO_NOTE = 'נסגר אוטומטית: כל התכנים בגאנט תוזמנו';
const POST_STATES = new Set(['scheduled', 'posted']);
const isContent = (r) => !!GANTT_KINDS[r?.kind]?.post && r.state !== 'skipped';

// { posts, scheduled, all }: the content rows, how many are scheduled or posted, and whether all are.
export function scheduleFacts(rows) {
  const posts = (rows || []).filter(isContent);
  const scheduled = posts.filter((r) => POST_STATES.has(r.state)).length;
  return { posts: posts.length, scheduled, all: posts.length > 0 && scheduled === posts.length };
}

// The keys to write for one client now ([] when none): `${pre}p28.auto` for the base and for each
// round whose scheduling is open. `state`: clientState(client, checks).
export function ganttReadyKeys(client, checks = {}, rows = [], state = null) {
  if (!client || !state || inLanding(client) || !['active', 'ending'].includes(client.status)) return [];
  if (!scheduleFacts(rows).all) return [];
  const out = [];
  for (const s of state.states) {
    if (s.proc.id.replace(/^r\d+-/, '') !== 'p28' || s.complete) continue;
    const pre = (s.proc.keyBase || s.proc.id).slice(0, -'p28'.length);
    const p27 = state.states.find((x) => x.proc.id === `${s.proc.id.slice(0, -'p28'.length)}p27`);
    if (!p27?.complete) continue;
    const key = `${pre}${GANTT_READY}`;
    if (checks[key]) continue;
    out.push(key);
  }
  return out;
}

// Every client's marks: [{ client, marks: [{ item_key, state: 'done', note }] }].
//   checks: rows of public.protocol_checks; gantt: rows of public.client_gantt (client_id, kind, state).
export function ganttReadyPlans(clients, checks = [], gantt = [], stateOf) {
  const byClient = new Map();
  for (const r of checks || []) {
    if (!byClient.has(r.client_id)) byClient.set(r.client_id, {});
    byClient.get(r.client_id)[r.item_key] = r;
  }
  const rowsOf = new Map();
  for (const r of gantt || []) {
    if (!rowsOf.has(r.client_id)) rowsOf.set(r.client_id, []);
    rowsOf.get(r.client_id).push(r);
  }
  const out = [];
  for (const client of clients || []) {
    const rows = rowsOf.get(client.id);
    if (!rows?.length) continue;
    const cs = byClient.get(client.id) || {};
    const keys = ganttReadyKeys(client, cs, rows, stateOf(client, cs));
    if (keys.length) out.push({ client, marks: keys.map((item_key) => ({ item_key, state: 'done', note: AUTO_NOTE })) });
  }
  return out;
}
