// The "now" bar at the top of "my work" (docs/plan/system-plan.md, section 3,
// Irit): the short protocol clocks running for one person across all clients.
// Pure logic, no DOM, so a server engine can take it over in stage 3; in stage 1
// the clocks run while the page is open. Every time is Israel time (tz.js) and
// office hours come from protocol-logic.js.
//
// Three kinds of clock:
//   deal    a new deal: the office-time clocks of processes 1 (the contract, 10
//           minutes: the owner's decision of 3.10.2026), 2 and 3 (5 minutes each),
//           from the deal, while the person still has open items there.
//   answer  "the client did not answer": 10, 10 and 5 office minutes from the
//           moment the 9 graphics (7), the rest of the graphics (23) or the
//           videos (26) were marked sent, until the client answered. Then Irit calls.
//   soon    any other process of the person due within the next hour.
// A clock that ran out stays in the bar, red, until the end of that day (a
// "soon" one for an hour; after that it is in the "overdue" list).
import { clientState, openItemsFor, addWorkingMinutes, nextWorkMoment, officeMsBetween, onOfficeTime, ANSWERED, waitOf, IMPORT_NOTE, inLanding, workFloor, parseDate } from './protocol-logic.js';
import { endOfDayIL, partsIL } from './tz.js';

const MIN = 6e4;

// New deal (the plan's ה1): contract, group and characterization date. The
// contract's clock stops once it was sent; the signature has a clock of its own.
export const DEAL_CLOCKS = {
  p01: { what: 'חוזה', until: ['p01.prepared', 'p01.sent'] },
  p02: { what: 'קבוצה' },
  p03: { what: 'מועד אפיון' },
};

// "If the client does not answer within N minutes, Irit calls" (processes 7, 23, 26).
// The clock stops when the client answered (the ANSWERED mark), approved, Irit
// called (the process's `call` item) or the process waits on the client; only
// what happened after this sending counts (sent again after a fix: a new clock).
// `approval` is the client's own approval, also when it comes from the status page
// (approve_item writes the same key). Every clock needs one: without it Irit is
// rung "call the client" about something the client already approved.
export const ANSWER_CLOCKS = {
  p07: { minutes: 10, what: '9 הגרפיקות הראשונות', approval: 'p07.approved' },
  p23: { minutes: 10, what: 'יתרת הגרפיקות', approval: 'p23.approved' },
  p26: { minutes: 5, what: 'הסרטונים', approval: 'p27.approved' },
};

// Other deadlines join the bar this many minutes before they are due, and a
// "soon" clock that ran out stays as long after.
export const SOON_MINUTES = 60;

const KIND_ORDER = { answer: 0, deal: 1, soon: 2 };
const baseId = (proc) => proc.id.replace(/^r\d+-/, '');
// A deadline "by the end of the day" is a date, not a clock.
const endOfDay = (d) => { const p = partsIL(d); return p.hour === 23 && p.minute === 59; };
const peopleOf = (entries) => [...new Set(entries.flatMap((e) => (e.claim ? [e.claim.person] : e.item.owners)))];

// Where a clock stands at `now`. Office clocks stop outside office hours:
// `remaining` is then the office time left and `resumeAt` when it runs again.
// A clock that ran out has a negative `remaining` (how long ago, real time).
export function clockTime(clock, now = new Date()) {
  const left = clock.deadline - now;
  if (left <= 0) return { state: 'expired', remaining: left, paused: false, resumeAt: null };
  if (!clock.office) return { state: 'running', remaining: left, paused: false, resumeAt: null };
  const resume = nextWorkMoment(now);
  const paused = resume > now;
  return { state: 'running', remaining: officeMsBetween(now, clock.deadline), paused, resumeAt: paused ? resume : null };
}

// Most urgent first: what ran out (longest ago first), then the least time left.
export const byClockUrgency = (a, b) => (a.remaining - b.remaining)
  || (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || String(a.client.name).localeCompare(String(b.client.name), 'he');

// The countdown as m:ss (h:mm:ss from an hour), rounded up to the second so it
// reads 0:00 exactly when the clock runs out.
export function clockDigits(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// Whether a clock belongs in the bar at `now`.
function inBar(kind, deadline, now) {
  if (kind === 'soon') return Math.abs(deadline - now) <= SOON_MINUTES * MIN;
  return now <= endOfDayIL(deadline);
}

// The clocks of `person` (null: everyone's, for the owner) across `clients`, at
// `now`, most urgent first. `checksByClient` maps client id -> item key -> check;
// `stateOf(client)` may pass a cached clientState.
// Each clock: { id, kind, client, proc, what, deadline, office, people, phone,
// sentAt (answer only), minutes, state, remaining, paused, resumeAt }.
export function clocksFor(person, clients, checksByClient = {}, { now = new Date(), stateOf = null } = {}) {
  const out = [];
  const add = (c) => { if (inBar(c.kind, c.deadline, now)) out.push({ ...c, ...clockTime(c, now) }); };
  for (const client of clients) {
    // No clock runs on a client in landing (docs/ops.md, section 41).
    if (client.status === 'cancelled' || client.status === 'ended' || inLanding(client)) continue;
    const checks = checksByClient[client.id] || {};
    const state = stateOf ? stateOf(client) : clientState(client, checks, now);
    const phone = client.phone || null;

    // Process deadlines: the new-deal clocks, and whatever else is due within the hour.
    const groups = new Map();
    for (const e of openItemsFor(person, client, checks, state, now)) {
      if (e.status === 'client' || !e.dueAt) continue; // waiting on the client stops the clock
      if (!groups.has(e.proc.id)) groups.set(e.proc.id, { proc: e.proc, dueAt: e.dueAt, entries: [] });
      groups.get(e.proc.id).entries.push(e);
    }
    for (const g of groups.values()) {
      // A client activated out of landing is not a new deal: its contract, group and
      // meeting have no "5 minutes" countdown (they are ordinary deadlines now).
      const floor = workFloor(client);
      const deal = floor && parseDate(client.deal_at) < floor ? null : DEAL_CLOCKS[g.proc.id];
      if (deal) {
        const entries = deal.until ? g.entries.filter((e) => deal.until.includes(e.item.key)) : g.entries;
        if (!entries.length) continue;
        add({
          id: `deal:${client.id}:${g.proc.id}`, kind: 'deal', client, proc: g.proc, what: deal.what, minutes: g.proc.due?.minutes || 5,
          deadline: g.dueAt, office: true, people: peopleOf(entries), phone,
        });
      } else if (!endOfDay(g.dueAt)) {
        add({
          id: `soon:${client.id}:${g.proc.id}`, kind: 'soon', client, proc: g.proc, what: g.proc.title,
          deadline: g.dueAt, office: onOfficeTime(g.proc.due), people: peopleOf(g.entries), phone,
        });
      }
    }

    // "The client did not answer."
    for (const s of state.states) {
      const spec = ANSWER_CLOCKS[baseId(s.proc)];
      if (!spec) continue;
      const kb = s.proc.keyBase || s.proc.id;
      const sent = checks[`${kb}.sent`];
      // Imported history is not a sending that happened now.
      if (!sent || sent.state !== 'done' || !sent.at || sent.note === IMPORT_NOTE) continue;
      const sentAt = new Date(sent.at);
      const since = (key) => { const x = checks[key]; return !!x && x.state === 'done' && new Date(x.at) >= sentAt; };
      const round = kb.slice(0, kb.length - baseId(s.proc).length); // 'r2.' in a second shoot round
      if (since(ANSWERED(s.proc)) || since(`${kb}.call`) || (spec.approval && since(round + spec.approval))) continue;
      // A wait that began before this sending (say, for the client's material) is not an answer to it.
      const wait = waitOf(s.proc, checks);
      if (wait && new Date(wait.at) >= sentAt) continue;
      const call = s.proc.items.find((i) => i.key === `${kb}.call`);
      const people = call ? call.owners : s.proc.owners;
      if (person && !people.includes(person)) continue;
      add({
        id: `answer:${client.id}:${s.proc.id}:${sentAt.toISOString()}`, kind: 'answer', client, proc: s.proc, what: spec.what,
        minutes: spec.minutes, sentAt, deadline: addWorkingMinutes(sentAt, spec.minutes), office: true, people, phone,
      });
    }
  }
  return out.sort(byClockUrgency);
}
