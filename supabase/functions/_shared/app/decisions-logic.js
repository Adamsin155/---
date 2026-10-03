// generated — edit app/ instead. Source: app/decisions-logic.js. Regenerate: node scripts/sync-functions.mjs
// Lior's first screen, "החלטות" (system-plan section 3, "ליאור"): the exceptions
// waiting for him, each on a fixed path (reason → decision → next action with an
// owner and a due date, opened as a linked task → close); urgent tasks nobody
// started within 30 office minutes, which come back to him (decision 9); broken
// logins closed as fixed or partly fixed; editing still paused the next morning
// (move the deadlines or reassign, with Ofir's proposal by load); the weekly
// campaign check on Tuesday (decision 21). Pure, no DOM, Israel time.
import { ESCALATIONS, PEOPLE } from './protocol.js';
import { addWorkingMinutes, parseDate, pauseOf, roundsOf, weekKey, isBusinessDay } from './protocol-logic.js';
import { atTimeIL, weekdayIL, dayKeyIL } from './tz.js';

export const URGENT_START_MINUTES = 30;

// ── Urgent tasks: "התחלתי" within 30 office minutes (decision 9) ──
export function urgentState(t, now = new Date()) {
  const created = parseDate(t.created_at);
  const deadline = created ? addWorkingMinutes(created, URGENT_START_MINUTES) : null;
  const started = !!t.started_at;
  return { started, deadline, returned: !started && !!deadline && now >= deadline, startedAt: started ? new Date(t.started_at) : null };
}

// ── An exception's report and its path ──────
// The report's title is "<reason> (תהליך X): <details>" (the client card's form).
export function parseReport(title = '') {
  const reason = ESCALATIONS.find((r) => title.startsWith(r)) || '';
  let rest = reason ? title.slice(reason.length) : title;
  const proc = /^\s*\((תהליך [^)]*)\)/.exec(rest);
  if (proc) rest = rest.slice(proc[0].length);
  return { reason, proc: proc ? proc[1] : '', details: rest.replace(/^[\s:]+/, '').trim() };
}

// Where one exception stands: the steps done so far, and the next one.
//   d: its task_decisions row (or null). Steps: reason, decision, next (the linked task), close.
export const PATH = [['reason', 'סיבה'], ['decision', 'החלטה'], ['next', 'פעולה הבאה'], ['close', 'סגירה']];
export function exceptionPath(task, d) {
  const done = {
    reason: !!String(d?.reason || '').trim(),
    decision: !!String(d?.decision || '').trim(),
    next: !!d?.next_task_id,
    close: !!task?.done_at,
  };
  const step = PATH.find(([k]) => !done[k])?.[0] || null;
  return { done, step, ready: done.reason && done.decision && done.next };
}

// A decision row as it is saved (the database stamps who and when).
export function decisionRow(task, { reason, decision, nextTaskId = null }) {
  return {
    task_id: task.id, client_id: task.client_id,
    reason: String(reason || '').trim().slice(0, 1000) || null,
    decision: String(decision || '').trim().slice(0, 1000) || null,
    next_task_id: nextTaskId,
  };
}
// The linked task's title: the next action, and what it came from.
export const linkedTitle = (next, task) => `${String(next || '').trim()} (בעקבות חריגה: ${parseReport(task.title).reason || 'דיווח'})`.slice(0, 500);

// ── Editing still paused the next morning ────
// Every editing job whose pause began before today (Israel): Lior decides.
export function pausedSinceYesterday({ clients, stateOf, checks, now = new Date() }) {
  const startOfToday = atTimeIL(now, 0);
  const out = [];
  for (const c of clients) {
    if (c.status !== 'active' && c.status !== 'ending') continue;
    const cs = checks[c.id] || {};
    for (const s of stateOf(c).states) {
      if (s.proc.id.replace(/^r\d+-/, '') !== 'p22' || s.complete) continue;
      const pause = pauseOf(s.proc, cs);
      if (!pause || new Date(pause.at) >= startOfToday) continue;
      const ctx = s.proc.ctx || c;
      const pre = s.proc.keyBase.slice(0, -3);
      const decided = cs[`${pre}p22.decision`];
      out.push({
        key: `${c.id}:${s.proc.id}`, client: c, ctx, pre, n: ctx.round || null, state: s, pause, editor: ctx.editor || null,
        decidedToday: decided?.state === 'done' && dayKeyIL(new Date(decided.at)) === dayKeyIL(now),
      });
    }
  }
  return out.sort((a, b) => new Date(a.pause.at) - new Date(b.pause.at));
}
export const decisionNote = ({ choice, days = 0, editor = null, proposal = null }) => JSON.stringify({ choice, days, editor, proposal });

// The round's editor changes in `rounds`; the client's own in `clients.editor`.
export function withEditor(client, n, editor) {
  if (!n) return { editor };
  return { rounds: roundsOf(client).map((r) => (r.n === n ? { ...r, editor } : r)) };
}

// ── The weekly campaign check (decision 21: Tuesday) ──
// Shown from Tuesday until it is marked that week (office_reviews kind 'campaigns').
export function campaignCheck(reviews, now = new Date()) {
  const week = weekKey(now);
  const done = (reviews || []).find((r) => r.kind === 'campaigns' && r.day >= week) || null;
  const wd = weekdayIL(now);
  return { week, done, show: isBusinessDay(now) && wd >= 2 && wd <= 4, late: !done && wd > 2 };
}

export const personName = (k) => (k === 'owner' ? 'הבעלים' : PEOPLE[k]?.name || k || '');
