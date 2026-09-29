// Pure protocol logic: which processes apply to a client, who owns them,
// due dates and progress. Shared by the browser and the unit tests.
// Times are computed in the viewer's local time zone (the office is in Israel).
import { PHASES, PROCESSES } from './protocol.js';

const DAY = 864e5;
// Israeli work week: Sunday to Thursday. Holidays are not accounted for.
export const isBusinessDay = (d) => d.getDay() !== 5 && d.getDay() !== 6;

const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const sameDay = (a, b) => a.toDateString() === b.toDateString();

// End of the nth business day after `date` (the count starts the next business day).
export function addBusinessDays(date, n) {
  const d = new Date(date);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDay(d)) left -= 1;
  }
  return endOfDay(d);
}

export function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  // A bare date (contract end) is a local calendar day.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const ownersOf = (entry, client) => (typeof entry.owners === 'function' ? entry.owners(client) : entry.owners || []);
const applies = (entry, client) => !entry.when || entry.when(client);

// The processes and items that apply to this client, with owners resolved.
export function applicableProcesses(client) {
  return PROCESSES.filter((p) => applies(p, client)).map((p) => {
    const owners = ownersOf(p, client);
    return {
      ...p,
      owners,
      items: p.items.filter((i) => applies(i, client)).map((i) => ({ ...i, owners: i.owners ? ownersOf(i, client) : owners })),
    };
  });
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
    // End of the characterization meeting: when process 4 was completed,
    // otherwise the end of its two-hour window.
    case 'charEnd': {
      const p4 = procs.find((p) => p.id === 'p04');
      const done = p4 && completedAt(p4, checks, now);
      if (done) return done;
      const c = parseDate(client.char_at);
      return c ? new Date(c.getTime() + 2 * 36e5) : null;
    }
    case 'shoot': return parseDate(client.shoot_at);
    case 'contractEnd': return parseDate(client.contract_end);
    default: {
      const p = procs.find((x) => x.id === from);
      return p ? completedAt(p, checks, now) : null;
    }
  }
}

export function resolveTime(spec, client, procs, checks, now = new Date()) {
  if (!spec) return null;
  const base = anchor(spec.from, client, procs, checks, now);
  if (!base) return null;
  if (spec.businessDays) return addBusinessDays(base, spec.businessDays);
  let d = new Date(base);
  if (spec.prevBusinessDay) {
    do d.setDate(d.getDate() - 1); while (!isBusinessDay(d));
  }
  if (spec.days !== undefined) d.setDate(d.getDate() + spec.days);
  if (spec.days !== undefined || spec.prevBusinessDay) {
    if (spec.at) {
      const [hh, mm] = spec.at.split(':').map(Number);
      d.setHours(hh, mm, hh === 23 && mm === 59 ? 59 : 0, 0);
    }
  }
  if (spec.hours) d = new Date(d.getTime() + spec.hours * 36e5);
  if (spec.minutes) d = new Date(d.getTime() + spec.minutes * 6e4);
  // A bare contract-end date is due by the end of that day.
  if (spec.from === 'contractEnd' && spec.days === undefined) d = endOfDay(d);
  return d;
}

const phaseIndex = (key) => PHASES.findIndex((p) => p.key === key);

// Missing client details a process (or phase) depends on.
const blank = (v) => v === null || v === undefined || v === '';
export function missingFields(entry, client) {
  return (entry.needs || []).filter((f) => blank(client[f]));
}

// Why an item cannot be checked yet: unfinished prerequisite items or missing client details.
export function blockers(item, client, checks) {
  const items = (item.requires || []).filter((k) => checks[k]?.state !== 'done');
  const fields = (item.requiresFields || []).filter((f) => blank(client[f]));
  return items.length || fields.length ? { items, fields } : null;
}

// A process with several owners can be taken by one of them.
export const CLAIM = (procId) => `${procId}.claim`;
export function claimOf(proc, checks) {
  if (proc.owners.length < 2) return null;
  const c = checks[CLAIM(proc.id)];
  return c && c.state === 'done' && c.note ? { person: c.note, at: c.at, by_email: c.by_email } : null;
}

// Full state of a client's protocol. `checks` maps item key -> { state, at, by_email }.
export function clientState(client, checks = {}, now = new Date()) {
  const procs = applicableProcesses(client);
  const states = procs.map((p) => {
    const required = p.items.filter((i) => !i.optional);
    const resolved = required.filter((i) => isResolved(i, checks[i.key], now)).length;
    const touched = p.items.some((i) => checks[i.key]);
    const complete = p.recurring ? false : resolved === required.length;
    const startAt = resolveTime(p.start, client, procs, checks, now);
    const dueAt = p.recurring ? null : resolveTime(p.due, client, procs, checks, now);
    return { proc: p, required: required.length, resolved, complete, touched, startAt, dueAt };
  });

  // Current phase: the first one that still has open work.
  const openPhase = PHASES.find((ph) => states.some((s) => s.proc.phase === ph.key && !s.complete && !s.proc.recurring && ph.key !== 'renewal'));
  const current = openPhase ? openPhase.key : 'ongoing';
  const cur = phaseIndex(current);

  for (const s of states) {
    const pi = phaseIndex(s.proc.phase);
    // Ready: its start anchor has passed; or, with no start anchor, its phase has been reached.
    s.ready = s.touched || (s.proc.start ? !!(s.startAt && s.startAt <= now) : pi <= cur)
      || !!(s.dueAt && s.dueAt < now); // a passed deadline makes it actionable regardless
    s.claim = claimOf(s.proc, checks);
    if (s.proc.recurring) {
      const item = s.proc.items[0];
      const done = isResolved(item, checks[item.key], now);
      s.status = !s.ready ? 'waiting' : done ? 'done' : 'due';
      s.lastAt = checks[item.key]?.at || null;
      continue;
    }
    if (s.complete) s.status = 'done';
    else if (s.dueAt && s.dueAt < now) s.status = 'overdue';
    else if (s.dueAt && sameDay(s.dueAt, now)) s.status = 'today';
    else s.status = s.ready ? 'open' : 'waiting';
  }

  const phases = PHASES.map((ph) => {
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
  };
}

// Open items a person can act on now in one client. Items blocked by a
// prerequisite are left out; a shared process taken by someone else is too.
// An ended client keeps only its closing process.
export function openItemsFor(person, client, checks, state, now = new Date()) {
  const out = [];
  for (const s of state.states) {
    if (!s.ready || s.status === 'done') continue;
    if (client.status === 'ended' && s.proc.id !== 'p35') continue;
    for (const i of s.proc.items) {
      if (person && !i.owners.includes(person)) continue;
      const shared = i.owners === s.proc.owners || i.owners.join() === s.proc.owners.join();
      if (person && shared && s.claim && s.claim.person !== person) continue;
      if (i.optional || isResolved(i, checks[i.key], now) || blockers(i, client, checks)) continue;
      out.push({ client, proc: s.proc, item: i, status: s.status, dueAt: s.dueAt, claim: shared ? s.claim : null, shared: shared && s.proc.owners.length > 1 });
    }
  }
  return out;
}

// Time buckets for "my work".
export function bucketOf(status, dueAt, now = new Date()) {
  if (status === 'overdue') return 'overdue';
  if (!dueAt) return status === 'due' ? 'week' : 'later';
  const days = Math.round((new Date(dueAt).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return 'week';
  return 'later';
}

// Business days between two moments (Sunday–Thursday), for "late by".
export function businessDaysBetween(from, to) {
  const d = new Date(from); d.setHours(0, 0, 0, 0);
  const end = new Date(to); end.setHours(0, 0, 0, 0);
  let n = 0;
  while (d < end) { d.setDate(d.getDate() + 1); if (isBusinessDay(d)) n += 1; }
  return n;
}

const RANK = { overdue: 0, today: 1, due: 2, open: 3, waiting: 4, done: 5 };
export const byUrgency = (a, b) => (RANK[a.status] - RANK[b.status]) || ((a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));
