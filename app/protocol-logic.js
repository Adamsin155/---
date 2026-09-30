// Pure protocol logic: which processes apply to a client, who owns them,
// due dates and progress. Shared by the browser and the unit tests; no DOM, so it
// can also run in an edge function.
// Every date is computed in Israel time (tz.js), whatever the zone of the device
// or the server: office hours, business days, "today" and the day before a shoot.
import { PHASES, PROCESSES, WORK_HOURS, NO_BULK, APPROVALS } from './protocol.js';
import { SPECS, TERM_MONTHS } from './catalog.js';
import { holidayOn as closedOn, erevOn } from './holidays.js';
import {
  dateIL, dayKeyIL, weekdayIL, atTimeIL, endOfDayIL, addDaysIL, daysBetweenIL,
} from './tz.js';

const DAY = 864e5;
// Israeli work week: Sunday to Thursday, except the holidays in holidays.js.
export const isBusinessDay = (d) => { const w = weekdayIL(d); return w !== 5 && w !== 6 && !closedOn(d); };
export const holidayOn = closedOn;
export { erevOn };

// Office hours of the Israel day of `d`: 09:00–18:00, and until 13:00 on erev chag.
const openAt = (d) => atTimeIL(d, WORK_HOURS.start);
const closeAt = (d) => atTimeIL(d, erevOn(d) ? WORK_HOURS.erevEnd : WORK_HOURS.end);
// Walks whole days from noon, far from any clock change (Israel changes at 02:00).
const nextDay = (d, step = 1) => addDaysIL(atTimeIL(d, 12), step);

// The next moment inside office hours (the moment itself when it already is).
export function nextWorkMoment(date) {
  const d = new Date(date);
  if (isBusinessDay(d) && d < closeAt(d)) return d < openAt(d) ? openAt(d) : d;
  let n = d;
  do n = nextDay(n); while (!isBusinessDay(n));
  return openAt(n);
}

// Adds minutes of office time: the clock stops at night, on weekends and holidays.
export function addWorkingMinutes(date, minutes) {
  let d = nextWorkMoment(date);
  let left = minutes;
  while (left > 0) {
    const close = closeAt(d);
    const room = (close - d) / 6e4;
    if (left <= room) return new Date(d.getTime() + left * 6e4);
    left -= room;
    d = nextWorkMoment(close);
  }
  return d;
}

// Office time between two moments, in milliseconds (a running clock, to the second).
export function officeMsBetween(from, to) {
  const end = new Date(to);
  let d = nextWorkMoment(from);
  let total = 0;
  while (d < end) {
    const close = closeAt(d);
    total += Math.min(close, end) - d;
    d = nextWorkMoment(close);
  }
  return total;
}
// Minutes of office time between two moments (the employee's clock).
export const workingMinutesBetween = (from, to) => Math.round(officeMsBetween(from, to) / 6e4);
// Anchors that are office events run on office time; a meeting or a shoot runs on the real clock.
const onOfficeClock = (from) => from === 'deal' || from === 'charEnd' || /^(r\d+-)?p\d/.test(from) || from.startsWith('item:');
// Whether resolveTime counts a due spec in office minutes (and so a clock of it stops at night).
export const onOfficeTime = (spec) => !!spec && !spec.businessDays && onOfficeClock(spec.from) && spec.days === undefined && !spec.prevBusinessDay;

const sameDay = (a, b) => dayKeyIL(a) === dayKeyIL(b);

// End of the nth business day after `date` (the count starts the next business day).
export function addBusinessDays(date, n) {
  let d = new Date(date);
  let left = n;
  while (left > 0) {
    d = nextDay(d);
    if (isBusinessDay(d)) left -= 1;
  }
  return endOfDayIL(d);
}

export function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  // A bare date (contract end) is an Israel calendar day.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return dateIL(+m[1], +m[2], +m[3]);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const ownersOf = (entry, client) => (typeof entry.owners === 'function' ? entry.owners(client) : entry.owners || []);
const applies = (entry, client) => !entry.when || entry.when(client);

// The processes and items that apply to this client, with owners resolved.
// Extra shoot rounds (client.rounds) repeat the round processes under their own
// phase, with ids like `r2-p12` and item keys like `r2.p12.read`.
const ROUND_IDS = new Set(PROCESSES.filter((p) => p.round).map((p) => p.id));
const resolve = (p, ctx) => {
  const owners = ownersOf(p, ctx);
  return {
    ...p, owners, keyBase: p.id,
    items: p.items.filter((i) => applies(i, ctx)).map((i) => ({ ...i, owners: i.owners ? ownersOf(i, ctx) : owners })),
  };
};

export const roundsOf = (client) => (Array.isArray(client.rounds) ? client.rounds : []);

// The client as seen from inside a round: its own shoot, and its start as the "characterization".
export function roundContext(client, r) {
  return {
    ...client, round: r.n,
    shoot_type: r.shoot_type || client.shoot_type, shoot_at: r.shoot_at || null,
    char_at: r.start_at || null, editor: r.editor || null,
  };
}

export function applicableProcesses(client) {
  const base = PROCESSES.filter((p) => applies(p, client)).map((p) => resolve(p, client));
  const extra = roundsOf(client).flatMap((r) => {
    const ctx = roundContext(client, r);
    const pre = (k) => `r${r.n}.${k}`;
    const shift = (spec) => {
      if (!spec) return spec;
      if (ROUND_IDS.has(spec.from)) return { ...spec, from: `r${r.n}-${spec.from}` };
      const item = /^item:(p\d+[a-z]?)\./.exec(spec.from);
      if (item && ROUND_IDS.has(item[1])) return { ...spec, from: `item:${pre(spec.from.slice(5))}` };
      return spec;
    };
    return PROCESSES.filter((p) => p.round && applies(p, ctx)).map((p) => {
      const x = resolve(p, ctx);
      return {
        ...x, id: `r${r.n}-${p.id}`, keyBase: pre(p.id), phase: `round-${r.n}`, ctx,
        start: shift(p.start), due: shift(p.due),
        items: x.items.map((i) => ({ ...i, key: pre(i.key), requires: i.requires?.map(pre) })),
      };
    });
  });
  return [...base, ...extra];
}

// Phases for this client: the fixed ones, with a phase per extra round before "ongoing".
export function phasesFor(client) {
  const rounds = roundsOf(client).map((r) => ({ key: `round-${r.n}`, title: `סבב צילום ${r.n}`, round: r.n, needs: ['shoot_type', 'shoot_at'] }));
  const i = PHASES.findIndex((p) => p.key === 'ongoing');
  return [...PHASES.slice(0, i), ...rounds, ...PHASES.slice(i)];
}

// A check counts for a recurring item only within its period.
export function isResolved(item, check, now = new Date()) {
  if (!check) return false;
  if (item.recurring === 'weekly') return check.state === 'done' && now - new Date(check.at) < 7 * DAY;
  return check.state === 'done' || check.state === 'na';
}

// When every required item of a process is resolved: the latest of those checks.
function completedAt(proc, checks, now) {
  const required = proc.items.filter((i) => !i.optional);
  if (!required.length || proc.recurring) return null;
  let last = 0;
  for (const i of required) {
    const c = checks[i.key];
    if (!isResolved(i, c, now)) return null;
    last = Math.max(last, new Date(c.at).getTime());
  }
  return new Date(last);
}

function anchor(from, client, procs, checks, now) {
  switch (from) {
    case 'deal': return parseDate(client.deal_at);
    case 'char': return parseDate(client.char_at);
    case 'charEnd': {
      // Inside a round there is no meeting: the round starts when it was added.
      if (client.round) return parseDate(client.char_at);
      // End of the characterization meeting: when process 4 was completed,
      // otherwise the end of its two-hour window.
      const p4 = procs.find((p) => p.id === 'p04');
      const done = p4 && completedAt(p4, checks, now);
      if (done) return done;
      const c = parseDate(client.char_at);
      return c ? new Date(c.getTime() + 2 * 36e5) : null;
    }
    case 'shoot': return parseDate(client.shoot_at);
    case 'contractEnd': return parseDate(client.contract_end);
    default: {
      // `item:p05.access`: when that one item was done (process 6 starts when access arrives).
      if (from.startsWith('item:')) {
        const c = checks[from.slice(5)];
        return c && c.state === 'done' ? new Date(c.at) : null;
      }
      const p = procs.find((x) => x.id === from);
      return p ? completedAt(p, checks, now) : null;
    }
  }
}

// Deadlines counted in business days from an item moved on by a decision (Lior,
// editing still paused the next morning): a `.shift` mark on that item's process,
// note JSON { days }, adds that many business days (app/office-marks.js).
export const SHIFT = (keyBase) => `${keyBase}.shift`;
function shiftDays(from, checks) {
  const m = /^item:((?:r\d+\.)?p\d+[a-z]?)\./.exec(from || '');
  const c = m && checks[SHIFT(m[1])];
  if (!c || c.state !== 'done') return 0;
  let days = 0;
  try { days = Number(JSON.parse(c.note)?.days); } catch { /* not JSON */ }
  return Number.isInteger(days) && days > 0 && days <= 30 ? days : 0;
}

export function resolveTime(spec, client, procs, checks, now = new Date()) {
  if (!spec) return null;
  const base = anchor(spec.from, client, procs, checks, now);
  if (!base) return null;
  if (spec.businessDays) return addBusinessDays(base, spec.businessDays + shiftDays(spec.from, checks));
  if (onOfficeTime(spec)) {
    return addWorkingMinutes(base, (spec.hours || 0) * 60 + (spec.minutes || 0));
  }
  let d = new Date(base);
  if (spec.prevBusinessDay) {
    do d = addDaysIL(d, -1); while (!isBusinessDay(d));
  }
  if (spec.days !== undefined) d = addDaysIL(d, spec.days);
  if (spec.days !== undefined || spec.prevBusinessDay) {
    if (spec.at) {
      const [hh, mm] = spec.at.split(':').map(Number);
      d = atTimeIL(d, hh, mm, hh === 23 && mm === 59 ? 59 : 0);
    }
  }
  if (spec.hours) d = new Date(d.getTime() + spec.hours * 36e5);
  if (spec.minutes) d = new Date(d.getTime() + spec.minutes * 6e4);
  // A bare contract-end date is due by the end of that day.
  if (spec.from === 'contractEnd' && spec.days === undefined) d = endOfDayIL(d);
  // Counted back from the contract end, a deadline on a day off moves to the business day before.
  if (spec.from === 'contractEnd' && spec.days < 0) while (!isBusinessDay(d)) d = addDaysIL(d, -1);
  return d;
}

// Missing client details a process (or phase) depends on.
const blank = (v) => v === null || v === undefined || v === '';
export function missingFields(entry, client) {
  return (entry.needs || []).filter((f) => blank(client[f]));
}

// Why an item cannot be checked yet: unfinished prerequisite items or missing client details.
export function blockers(item, client, checks) {
  // "Not relevant" satisfies a prerequisite, except an approval, which must really be given.
  const items = (item.requires || []).filter((k) => {
    const st = checks[k]?.state;
    return !(st === 'done' || (st === 'na' && !APPROVALS.has(k.replace(/^r\d+\./, ''))));
  });
  const fields = (item.requiresFields || []).filter((f) => blank(client[f]));
  return items.length || fields.length ? { items, fields } : null;
}

// Process-level marks stored as checks: who took a shared process, and a
// process waiting on the client (with the reason in the note).
const markKey = (proc, kind) => `${proc.keyBase || proc.id}.${kind}`;
export const CLAIM = (proc) => markKey(proc, 'claim');
export const WAIT = (proc) => markKey(proc, 'wait');
// The client answered after work was sent to them (processes 7, 23, 26): stops
// the "client did not answer" clock of that sending (app/clocks.js).
export const ANSWERED = (proc) => markKey(proc, 'answered');
// Editing paused for another task (Nirel and the editors must say so first).
export const PAUSE = (proc) => markKey(proc, 'pause');
export function pauseOf(proc, checks) {
  const c = checks[PAUSE(proc)];
  if (!c || c.state !== 'done') return null;
  let v = {};
  try { v = JSON.parse(c.note) || {}; } catch { /* plain text */ }
  return { ...v, at: c.at, by_email: c.by_email };
}
export function claimOf(proc, checks) {
  if (proc.owners.length < 2) return null;
  const c = checks[CLAIM(proc)];
  return c && c.state === 'done' && c.note ? { person: c.note, at: c.at, by_email: c.by_email } : null;
}
// The wait note is JSON {reason, recheck}; a plain note is read as the reason.
export function parseWaitNote(note) {
  try {
    const v = JSON.parse(note);
    if (v && typeof v === 'object') return { reason: v.reason || '', recheck: v.recheck || null };
  } catch { /* plain text */ }
  return { reason: note || '', recheck: null };
}
export const waitNote = (reason, recheck, since = null) => JSON.stringify({ reason, recheck: recheck || null, ...(since ? { since } : {}) });
// `since` keeps the start of the wait when its reason or date is edited later.
export function waitOf(proc, checks) {
  const c = checks[WAIT(proc)];
  if (!c || c.state !== 'done') return null;
  let since = null;
  try { since = JSON.parse(c.note)?.since || null; } catch { /* plain text */ }
  return { ...parseWaitNote(c.note), at: since || c.at, by_email: c.by_email };
}

// Waiting on the client stops the employee's clock (decision 3). Each finished
// wait adds its office minutes to the process's `waited` mark, note JSON {min, ext}:
// `min` is all the time waited on the client (the client's response time, never
// the employee's), `ext` the part that moved the deadline. A wait moves the
// deadline only when it began before the deadline as it stood then: the clock
// stops with the time the employee had left, and time already overrun is not
// given back.
export const WAITED = (proc) => markKey(proc, 'waited');
const wholeMinutes = (v) => Math.max(0, Math.round(Number(v) || 0));
export const waitedNote = (min, ext = min) => JSON.stringify({ min: wholeMinutes(min), ext: Math.min(wholeMinutes(ext), wholeMinutes(min)) });
// The `waited` note as {min, ext}; a note without `ext` moved the deadline by all of it.
export function readWaited(note) {
  let v = null;
  try { v = JSON.parse(note); } catch { /* not JSON */ }
  if (!v || typeof v !== 'object') return { min: 0, ext: 0 };
  const min = wholeMinutes(v.min);
  return { min, ext: v.ext === undefined ? min : Math.min(min, wholeMinutes(v.ext)) };
}
export function waitedOf(proc, checks) {
  const c = checks[WAITED(proc)];
  return c && c.state === 'done' ? readWaited(c.note) : { min: 0, ext: 0 };
}
// Office minutes the process waited on the client until `until` — the finished
// waits, and the current one while it lasts — as {min, ext}. `baseDueAt` is the
// process's own deadline: the current wait moves it only if it began before the
// deadline moved by the earlier waits (without a deadline, nothing moves).
export function waitedMinutes(proc, checks, until = new Date(), baseDueAt = null) {
  const past = waitedOf(proc, checks);
  const w = waitOf(proc, checks);
  const since = w ? new Date(w.at) : null;
  const running = since && since < until ? workingMinutesBetween(since, until) : 0;
  const moves = running > 0 && baseDueAt && since < (past.ext ? addWorkingMinutes(baseDueAt, past.ext) : baseDueAt);
  return { min: past.min + running, ext: past.ext + (moves ? running : 0) };
}
// Ending a wait at `now`: the note for the `waited` mark with the current wait
// added. A process completed during the wait counts it until the completion.
export function endWaitNote(client, proc, checks, now = new Date()) {
  const s = clientState(client, checks, now).states.find((x) => x.proc.id === proc.id);
  return s ? waitedNote(s.waited, s.extended) : waitedNote(waitedMinutes(proc, checks, now).min, waitedOf(proc, checks).ext);
}

// History brought in when an existing client was imported (note exactly "ייבוא"):
// it keeps the process's place in the protocol, but never counts in the statistics.
export const IMPORT_NOTE = 'ייבוא';
export const isImported = (proc, checks) => proc.items.some((i) => checks[i.key]?.note === IMPORT_NOTE);

// Items `person` may close together with "mark the whole process": open,
// unblocked, required, theirs (and, in a shared process taken by someone else, none).
export function bulkEligible(state, person, client, checks, now = new Date()) {
  const p = state.proc;
  if (!person || p.recurring || NO_BULK.has(p.id.replace(/^r\d+-/, '')) || state.complete) return [];
  if (state.claim && state.claim.person !== person) return [];
  return p.items.filter((i) => !i.optional && !i.noBulk && i.owners.includes(person)
    && !isResolved(i, checks[i.key], now) && !blockers(i, p.ctx || client, checks));
}

// Full state of a client's protocol. `checks` maps item key -> { state, at, by_email }.
export function clientState(client, checks = {}, now = new Date()) {
  const procs = applicableProcesses(client);
  const phaseList = phasesFor(client);
  const phaseIndex = (key) => phaseList.findIndex((p) => p.key === key);
  const states = procs.map((p) => {
    const ctx = p.ctx || client;
    const required = p.items.filter((i) => !i.optional);
    const resolved = required.filter((i) => isResolved(i, checks[i.key], now)).length;
    const touched = p.items.some((i) => checks[i.key]);
    const complete = p.recurring ? false : resolved === required.length;
    const startAt = resolveTime(p.start, ctx, procs, checks, now);
    const baseDueAt = p.recurring ? null : resolveTime(p.due, ctx, procs, checks, now);
    const doneAt = complete ? completedAt(p, checks, now) : null;
    // Waiting on the client (office minutes): `waited` in all, `extended` the part
    // that moved the deadline on.
    const w = waitedMinutes(p, checks, doneAt || now, baseDueAt);
    const dueAt = baseDueAt && w.ext ? addWorkingMinutes(baseDueAt, w.ext) : baseDueAt;
    return {
      proc: p, required: required.length, resolved, complete, touched, startAt, dueAt, baseDueAt,
      waited: w.min, extended: w.ext, completedAt: doneAt,
    };
  });

  // Current phase: the first one that still has open work.
  const openPhase = phaseList.find((ph) => states.some((s) => s.proc.phase === ph.key && !s.complete && !s.proc.recurring && ph.key !== 'renewal'));
  const current = openPhase ? openPhase.key : 'ongoing';
  const cur = phaseIndex(current);

  for (const s of states) {
    const pi = phaseIndex(s.proc.phase);
    // Ready: its start anchor has passed; or, with no start anchor, its phase has been reached.
    s.ready = s.touched || (s.proc.start ? !!(s.startAt && s.startAt <= now) : pi <= cur)
      || !!(s.dueAt && s.dueAt < now); // a passed deadline makes it actionable regardless
    s.claim = claimOf(s.proc, checks);
    s.wait = s.complete ? null : waitOf(s.proc, checks);
    if (s.proc.recurring) {
      const item = s.proc.items[0];
      const done = isResolved(item, checks[item.key], now);
      s.status = !s.ready ? 'waiting' : done ? 'done' : 'due';
      s.lastAt = checks[item.key]?.at || null;
      continue;
    }
    s.late = !s.complete && !!(s.dueAt && s.dueAt < now);
    if (s.complete) s.status = 'done';
    else if (s.wait) s.status = 'client'; // stuck on the client, not on us
    else if (s.late) s.status = 'overdue';
    else if (s.dueAt && sameDay(s.dueAt, now)) s.status = 'today';
    else s.status = s.ready ? 'open' : 'waiting';
  }

  const phases = phaseList.map((ph) => {
    const list = states.filter((s) => s.proc.phase === ph.key);
    const counted = list.filter((s) => !s.proc.recurring);
    return { ...ph, states: list, procsTotal: counted.length, procsDone: counted.filter((s) => s.complete).length, complete: list.some((s) => !s.proc.recurring) && list.every((s) => s.complete || s.proc.recurring) };
  }).filter((ph) => ph.states.length);

  // Progress is counted in processes everywhere; renewal is not part of delivery.
  const counted = states.filter((x) => !x.proc.recurring && x.proc.phase !== 'renewal');
  return {
    phases, states, current,
    procsTotal: counted.length,
    procsDone: counted.filter((x) => x.complete).length,
    overdue: states.filter((s) => s.status === 'overdue').length,
    waitingOnClient: states.filter((s) => s.status === 'client').length,
  };
}

// Open items a person can act on now in one client. Items blocked by a
// prerequisite are left out; a shared process taken by someone else is too.
// An ended client keeps only its closing process.
export function openItemsFor(person, client, checks, state, now = new Date()) {
  const out = [];
  if (client.status === 'cancelled') return out;
  for (const s of state.states) {
    if (!s.ready || s.status === 'done') continue;
    if (client.status === 'ended' && s.proc.id !== 'p35') continue;
    for (const i of s.proc.items) {
      if (person && !i.owners.includes(person)) continue;
      const shared = i.owners === s.proc.owners || i.owners.join() === s.proc.owners.join();
      if (person && shared && s.claim && s.claim.person !== person) continue;
      if (i.optional || isResolved(i, checks[i.key], now) || blockers(i, s.proc.ctx || client, checks)) continue;
      out.push({ client, proc: s.proc, item: i, status: s.status, dueAt: s.dueAt, wait: s.wait, claim: shared ? s.claim : null, shared: shared && s.proc.owners.length > 1 });
    }
  }
  return out;
}

// Items of `person` in a process; in a shared process taken by someone else, only
// the items that are theirs alone.
export function itemsOf(person, s) {
  if (!person) return [];
  return s.proc.items.filter((i) => i.owners.includes(person)
    && !(s.claim && s.claim.person !== person && i.owners.join() === s.proc.owners.join()));
}

// Processes of `person` that have not started yet but have a known start within
// `days` (for the photographer: the coming shoot days). Not checkable yet.
export function upcomingFor(person, client, state, now = new Date(), days = 30) {
  if (!person || client.status === 'cancelled' || client.status === 'ended') return [];
  const until = now.getTime() + days * DAY;
  return state.states.filter((s) => !s.ready && !s.complete && s.startAt && s.startAt > now
    && s.startAt.getTime() <= until && itemsOf(person, s).length);
}

// Whether `person` works on this client: an open item of theirs in a process that
// started or has a start date, or the client's (or a round's) editing is theirs.
export function involves(person, client, checks, state, now = new Date()) {
  if (!person || client.status === 'cancelled') return false;
  const inWork = client.status === 'active' || client.status === 'ending';
  if (inWork && (client.editor === person || roundsOf(client).some((r) => r.editor === person))) return true;
  return state.states.some((s) => (s.ready || s.startAt) && (client.status !== 'ended' || s.proc.id === 'p35')
    && itemsOf(person, s).some((i) => !i.optional && !isResolved(i, checks[i.key], now)));
}

// Time buckets for "my work".
export function bucketOf(status, dueAt, now = new Date()) {
  if (status === 'overdue') return 'overdue';
  if (status === 'client') return 'client';
  if (!dueAt) return status === 'due' ? 'week' : 'later';
  const days = daysBetweenIL(now, dueAt);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return 'week';
  return 'later';
}

// Business days between two moments (Sunday–Thursday), for "late by".
export function businessDaysBetween(from, to) {
  const end = dayKeyIL(to);
  let d = new Date(from);
  let n = 0;
  while (dayKeyIL(d) < end) { d = nextDay(d); if (isBusinessDay(d)) n += 1; }
  return n;
}

const RANK = { overdue: 0, today: 1, due: 2, open: 3, client: 4, waiting: 5, done: 6 };
export const byUrgency = (a, b) => (RANK[a.status] - RANK[b.status]) || ((a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));

// How long a completed process took the office: office minutes from its start
// (without one, the anchor of its due date) to completion, less the time it
// waited on the client. Null when there is no start before the completion.
export function workedMinutes(state, start) {
  if (!start || !state.completedAt || state.completedAt <= start) return null;
  return Math.max(0, workingMinutesBetween(start, state.completedAt) - (state.waited || 0));
}
// The protocol's own time for it, in the same office minutes (null when none).
export function targetMinutes(state, start) {
  if (!start || !state.baseDueAt || state.baseDueAt <= start) return null;
  return workingMinutesBetween(start, state.baseDueAt) || null;
}
// Where a process's duration is counted from: its start, else the anchor of its due date.
export const durationStart = (state, client, procs, checks, now = new Date()) => state.startAt
  || resolveTime({ from: state.proc.due?.from }, state.proc.ctx || client, procs, checks, now);

// Performance: for processes completed within the window, how many met their
// due date and how long they took from start to completion (median, office
// minutes). Time spent waiting on the client is left out: the due date already
// moved on by it (when it began in time), and its office minutes are taken off
// the duration. Imported history is not counted. Per person: processes they own
// (or took, when shared).
export function performanceReport(clients, checksByClient, { days = 30, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * DAY);
  const byProc = new Map();
  const byPerson = new Map();
  const add = (map, key, row) => {
    if (!map.has(key)) map.set(key, { key, done: 0, onTime: 0, late: 0, durations: [] });
    const m = map.get(key);
    m.done += 1;
    if (row.onTime) m.onTime += 1; else m.late += 1;
    if (row.minutes !== null) m.durations.push(row.minutes);
  };
  for (const c of clients) {
    const checks = checksByClient[c.id] || {};
    const s = clientState(c, checks, now);
    const procs = s.states.map((x) => x.proc);
    for (const x of s.states) {
      if (!x.complete || !x.completedAt || x.completedAt < since || !x.dueAt || isImported(x.proc, checks)) continue;
      const row = {
        onTime: x.completedAt <= x.dueAt,
        minutes: workedMinutes(x, durationStart(x, c, procs, checks, now)),
      };
      add(byProc, x.proc.id.replace(/^r\d+-/, ''), row);
      for (const p of x.claim ? [x.claim.person] : x.proc.owners) add(byPerson, p, row);
    }
  }
  const finish = (m) => {
    const d = [...m.durations].sort((a, b) => a - b);
    const median = d.length ? (d.length % 2 ? d[(d.length - 1) / 2] : Math.round((d[d.length / 2 - 1] + d[d.length / 2]) / 2)) : null;
    return { key: m.key, done: m.done, onTime: m.onTime, late: m.late, rate: m.done ? m.onTime / m.done : null, medianMinutes: median };
  };
  return {
    since,
    processes: [...byProc.values()].map(finish),
    people: [...byPerson.values()].map(finish),
  };
}

// Package quantities from a signed agreement's model. Mirrors
// public.package_deliverables() in the batch-2 migration.
export function packageDeliverables(model) {
  const sel = model?.selection;
  const spec = SPECS[model?.package?.id];
  if (!sel || !spec) return {};
  const paid = sel.paid || [];
  const free = sel.free || {};
  return {
    videos: spec.videos,
    graphics: spec.graphics + (free.graphics || 0),
    shoot_days: spec.shootDays + (paid.includes('simeon-day') ? 1 : 0),
    collabs: spec.collabs + (paid.includes('natali-reel') ? 1 : 0),
    stories: spec.stories + (free.simeonStories || 0) + (paid.includes('natali-story') ? 1 : 0),
    ch14: spec.ch14 + (free.extraCh14 ? 1 : 0),
    monthly: paid.includes('photographer') ? 8 * TERM_MONTHS : 0,
  };
}

// The Sunday that starts the Israel week of `d`, as a YYYY-MM-DD key.
export function weekKey(d = new Date()) {
  return dayKeyIL(nextDay(d, -weekdayIL(d)));
}
