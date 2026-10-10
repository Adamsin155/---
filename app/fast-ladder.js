// The fast ladder of the two things only Ofir does (protocol v9, the owner's decision of
// 10.10.2026; docs/ops.md, section 57): checking the graphics Ilai handed over (the
// first 9: process 7; the rest: 23) and assigning the editor once the shoot day is
// closed (22א). The numbers and the window are data: FAST_LADDER in app/protocol.js.
//
//   T0                        the work reaches Ofir: a ring, and `minutes` to do it;
//   T0 + minutes              not done: a second ring, worded as lateness, and `more` minutes;
//   T0 + minutes + more       not done: the manager (Lior) is told that Ofir is late;
//   then every `every`        Ofir is rung again, until he approves, returns it or assigns.
//
// Every one of these moments is counted in the ladder's own window (working days until
// 21:00; app/protocol-logic.js addFastMinutes), so a T0 at 20:55 goes on the next working
// morning and nothing is due at night, on a weekend or on a holiday.
//
// One answer for the reminders (the rule `fast` in app/reminder-rules.js), for what
// counts as late (app/late-chain.js: these cases are Ofir's lateness from T0 + minutes,
// and no other ladder rings for them), for the countdown on "המשימות שלי" (app/clocks.js)
// and for the tests. Pure: no DOM, no network, Israel time.
//
// Not a case:
//   - a client in landing (docs/ops.md, section 41): nothing of it has a clock;
//   - imported history (the note "ייבוא"): a mark that was brought in is not an event;
//   - work that was already waiting when the client was activated out of landing: it
//     keeps the gentle deadline every such work gets (the end of the next business day)
//     and the usual ladder of a late item;
//   - a process marked "ממתין ללקוח", and graphics that are back with Ilai for fixes
//     (then the fix's own deadline holds, and it is his).
import { FAST_LADDER } from './protocol.js';
import {
  addFastMinutes, fastMsBetween, fastOpen, nextFastMoment, inLanding, workFloor, isImported, clientLabel,
} from './protocol-logic.js';
import { QA_KINDS, GRAPHICS_KINDS, kindOfProc, qaState } from './office-marks.js';

const MIN = 6e4;
const baseId = (id) => String(id).replace(/^r\d+-/, '');
const preOf = (proc) => { const kb = proc.keyBase || proc.id; return kb.slice(0, kb.length - baseId(proc.id).length); };
const live = (c) => c?.status === 'active' || c?.status === 'ending';
const settled = (c) => !!c && (c.state === 'done' || c.state === 'na');

// Where each case is done: Ofir's screen, opened on that very check or assignment.
export const reviewUrl = (clientId, procId) => `qa.html#review-${encodeURIComponent(clientId)}-${procId}`;
export const assignUrl = (clientId, round = null) => `qa.html#assign-${encodeURIComponent(clientId)}${round ? `-r${round}` : ''}`;

// The case of one process state of one client, or null.
//   { kind: 'review' | 'assign', qa (the QA kind of a review), spec, client, cid, state,
//     proc, procId, pre, n (the shoot round of an assignment), round (the number of this
//     check: 2 after one return), t0, startAt (the first moment of the window at or after
//     T0: when the first ring goes), dueAt (T0 + minutes), tellAt (+ more), what, url }
export function fastCaseOf(client, s, states, checks) {
  if (!live(client) || inLanding(client) || !s || s.complete || s.wait || s.proc.recurring) return null;
  const b = baseId(s.proc.id);
  const pre = preOf(s.proc);
  const floor = workFloor(client);
  const make = (kind, t0, more) => {
    // Work that waited from before the activation is not put on a ten-minute clock.
    if (!t0 || (floor && t0 <= floor)) return null;
    const spec = FAST_LADDER[kind];
    return {
      kind, spec, client, cid: client.id, state: s, proc: s.proc, procId: s.proc.id, pre, t0,
      startAt: nextFastMoment(t0), dueAt: addFastMinutes(t0, spec.minutes), tellAt: addFastMinutes(t0, spec.minutes + spec.more), ...more,
    };
  };
  const qa = kindOfProc(s.proc.id);
  if (qa && GRAPHICS_KINDS.includes(qa)) {
    const k = QA_KINDS[qa];
    // His approval is asked of this client (not history that was passed before it existed).
    const approval = s.proc.items.find((i) => i.key === `${pre}${k.approved}`);
    if (!approval || approval.optional) return null;
    const q = qaState(checks, pre, qa);
    if (q.stage !== 'ofir') return null;
    return make('review', q.readyAt, { qa, round: q.round, what: k.title, url: reviewUrl(client.id, s.proc.id) });
  }
  if (b === 'p22a') {
    if (settled(checks[`${pre}p22a.assigned`])) return null;
    const p19 = states.find((x) => x.proc.id === `${s.proc.id.slice(0, s.proc.id.length - b.length)}p19`);
    // Only a shoot day closed for real: imported history is not an event.
    if (!p19?.complete || !p19.completedAt || isImported(p19.proc, checks)) return null;
    const n = s.proc.ctx?.round || null;
    return make('assign', p19.completedAt, { qa: null, n, round: 1, what: `שיוך עורך${n ? ` · סבב ${n}` : ''}`, url: assignUrl(client.id, n) });
  }
  return null;
}

// Every case of the live clients, the first T0 first.
export function fastCases({ clients = [], checksOf = () => ({}), stateOf }) {
  const out = [];
  for (const c of clients) {
    if (!live(c) || inLanding(c)) continue;
    const checks = checksOf(c) || {};
    const states = stateOf(c).states;
    for (const s of states) {
      const x = fastCaseOf(c, s, states, checks);
      if (x) out.push({ ...x, name: clientLabel(c) });
    }
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

// Where a case stands at `now`:
//   phase 'run'   the minutes are running: `remaining` (the window's time left to dueAt);
//         'late'  past them, inside the extra minutes: `remaining` to tellAt;
//         'told'  the manager was told: `slot` is the repeated ring `now` falls in
//                 ({ n, at }; n = 0 right after the telling, when nothing more is rung yet).
//   paused / resumeAt: the window is closed now (after 21:00, a weekend, a holiday).
export function ladderAt(c, now = new Date()) {
  const resume = nextFastMoment(now);
  const paused = resume > now;
  const base = { paused, resumeAt: paused ? resume : null, slot: null };
  if (now < c.dueAt) return { ...base, phase: 'run', remaining: fastMsBetween(now, c.dueAt) };
  if (now < c.tellAt) return { ...base, phase: 'late', remaining: fastMsBetween(now, c.tellAt) };
  const n = Math.floor(fastMsBetween(c.tellAt, now) / (c.spec.every * MIN));
  return { ...base, phase: 'told', remaining: 0, slot: { n, at: n ? addFastMinutes(c.tellAt, n * c.spec.every) : c.tellAt } };
}

// Minutes of the window's time the work has waited for him.
export const fastWaited = (c, now = new Date()) => Math.max(0, Math.round(fastMsBetween(c.t0, now) / MIN));
// Whole minutes left, rounded up ("נשארו 7 דק׳").
export const minutesLeft = (ms) => Math.max(0, Math.ceil(ms / MIN));

// The one line said about a case to whoever looks at it (the cards of "המשימות שלי"):
//   the one who does it:   "נשארו 7 דק׳" / "באיחור · עוד 4 דק׳" / "באיחור · ליאור עודכן"
//   whoever waits for it:  "אצל אופיר לבדיקה · נשארו 7 דק׳" / "אצל אופיר לבדיקה · באיחור"
export function ladderWords(c, now = new Date(), { waiting = false, managerName = 'ליאור', whoName = 'אופיר' } = {}) {
  const t = ladderAt(c, now);
  const left = `${minutesLeft(t.remaining)} דק׳`;
  if (waiting) {
    const where = c.kind === 'assign' ? `אצל ${whoName} לשיוך עורך` : `אצל ${whoName} לבדיקה`;
    return t.phase === 'run' ? `${where} · נשארו ${left}` : `${where} · באיחור`;
  }
  if (t.phase === 'run') return `נשארו ${left}`;
  if (t.phase === 'late') return `באיחור · עוד ${left}`;
  return `באיחור · ${managerName} עודכן`;
}

export { fastOpen };
