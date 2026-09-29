// Pure protocol logic: which processes apply to a client, who owns them,
// due dates and progress. Shared by the browser and the unit tests.
// Times are computed in the viewer's local time zone (the office is in Israel).
import { PHASES, PROCESSES, WORK_HOURS, NO_BULK, APPROVALS } from './protocol.js';
import { SPECS, TERM_MONTHS } from './catalog.js';
import { HOLIDAYS } from './holidays.js';

const DAY = 864e5;
const HOLIDAY_SET = new Set(HOLIDAYS.map((h) => h.date));
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Israeli work week: Sunday to Thursday, except the holidays in holidays.js.
export const isBusinessDay = (d) => d.getDay() !== 5 && d.getDay() !== 6 && !HOLIDAY_SET.has(dayKey(d));
export const holidayOn = (d) => HOLIDAYS.find((h) => h.date === dayKey(d)) || null;

// The next moment inside office hours (the moment itself when it already is).
export function nextWorkMoment(date) {
  const d = new Date(date);
  const start = () => { d.setHours(WORK_HOURS.start, 0, 0, 0); };
  if (!isBusinessDay(d) || d.getHours() >= WORK_HOURS.end) {
    do d.setDate(d.getDate() + 1); while (!isBusinessDay(d));
    start();
  } else if (d.getHours() < WORK_HOURS.start) {
    start();
  }
  return d;
}

// Adds minutes of office time: the clock stops at night, on weekends and holidays.
export function addWorkingMinutes(date, minutes) {
  let d = nextWorkMoment(date);
  let left = minutes;
  while (left > 0) {
    const close = new Date(d); close.setHours(WORK_HOURS.end, 0, 0, 0);
    const room = (close - d) / 6e4;
    if (left <= room) return new Date(d.getTime() + left * 6e4);
    left -= room;
    d = nextWorkMoment(close);
  }
  return d;
}
// Anchors that are office events run on office time; a meeting or a shoot runs on the real clock.
const onOfficeClock = (from) => from === 'deal' || from === 'charEnd' || /^(r\d+-)?p\d/.test(from) || from.startsWith('item:');

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

export function resolveTime(spec, client, procs, checks, now = new Date()) {
  if (!spec) return null;
  const base = anchor(spec.from, client, procs, checks, now);
  if (!base) return null;
  if (spec.businessDays) return addBusinessDays(base, spec.businessDays);
  if (onOfficeClock(spec.from) && spec.days === undefined && !spec.prevBusinessDay) {
    return addWorkingMinutes(base, (spec.hours || 0) * 60 + (spec.minutes || 0));
  }
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
  // Counted back from the contract end, a deadline on a day off moves to the business day before.
  if (spec.from === 'contractEnd' && spec.days < 0) while (!isBusinessDay(d)) d.setDate(d.getDate() - 1);
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
    const dueAt = p.recurring ? null : resolveTime(p.due, ctx, procs, checks, now);
    return {
      proc: p, required: required.length, resolved, complete, touched, startAt, dueAt,
      completedAt: complete ? completedAt(p, checks, now) : null,
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

// Time buckets for "my work".
export function bucketOf(status, dueAt, now = new Date()) {
  if (status === 'overdue') return 'overdue';
  if (status === 'client') return 'client';
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

const RANK = { overdue: 0, today: 1, due: 2, open: 3, client: 4, waiting: 5, done: 6 };
export const byUrgency = (a, b) => (RANK[a.status] - RANK[b.status]) || ((a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));

// Performance: for processes completed within the window, how many met their
// due date and how long they took from start to completion (median, minutes).
// Per person: processes they own (or took, when shared).
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
    const s = clientState(c, checksByClient[c.id] || {}, now);
    for (const x of s.states) {
      if (!x.complete || !x.completedAt || x.completedAt < since || !x.dueAt) continue;
      const row = {
        onTime: x.completedAt <= x.dueAt,
        minutes: x.startAt && x.completedAt > x.startAt ? Math.round((x.completedAt - x.startAt) / 6e4) : null,
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
