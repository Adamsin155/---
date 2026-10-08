// generated — edit app/ instead. Source: app/protocol-logic.js. Regenerate: node scripts/sync-functions.mjs
// Pure protocol logic: which processes apply to a client, who owns them,
// due dates and progress. Shared by the browser and the unit tests; no DOM, so it
// can also run in an edge function.
// Every date is computed in Israel time (tz.js), whatever the zone of the device
// or the server: office hours, business days, "today" and the day before a shoot.
import { PHASES, PROCESSES, WORK_HOURS, NO_BULK, APPROVALS } from './protocol.js';
import { SPECS, TERM_MONTHS, PACKAGES } from './catalog.js';
import { holidayOn as closedOn, erevOn } from './holidays.js';
import { adjustForVersion, laterDue } from './protocol-versions.js';
import {
  dateIL, dayKeyIL, weekdayIL, atTimeIL, endOfDayIL, addDaysIL, daysBetweenIL, partsIL,
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
const onOfficeClock = (from) => from === 'deal' || from === 'group' || from === 'charEnd' || /^(r\d+-)?p\d/.test(from) || from.startsWith('item:');
// Whether resolveTime counts a due spec in office minutes (and so a clock of it stops at night).
// "The characterization ended" (decision 12): a mark with the 4 short fields in its
// note, tapped at the end of the meeting. It starts the clocks of processes 5–10
// (their anchor charEnd) before the full form is typed; the form is due 60 minutes later.
export const CHAR_ENDED = 'p04.ended';
export function charEndedAt(checks) {
  const c = checks?.[CHAR_ENDED];
  return c && c.state === 'done' && c.at ? new Date(c.at) : null;
}
export const onOfficeTime = (spec) => !!spec && !spec.businessDays && onOfficeClock(spec.from) && spec.days === undefined && !spec.prevBusinessDay;
// A deadline of "immediately" (מיד): due at the very office event that starts the work,
// with no time of its own (22א right when the shoot day is closed, 26 right when Ofir
// approves, 11ב once the shoot date is set). Process 5 is not one: it starts with the
// meeting and is due at its end. Nobody can finish in zero minutes, so such a process gets a
// working allowance of 15 office minutes before it is late anywhere: the lists, the
// colour, the "now" clocks and the reminders (found live, 6.10.2026: "נגמר לפני 1 דק׳"
// the moment the task appeared). Deadlines with their own time (5, 10, 30 minutes,
// hours, days) and anything hanging on a meeting or a shoot are untouched.
export const IMMEDIATE_MINUTES = 15;
const bare = (spec) => !!spec && !spec.hours && !spec.minutes && !spec.at && !spec.afterMark && !spec.businessDays && spec.days === undefined && !spec.prevBusinessDay;
export const isImmediate = (proc) => !!proc?.due && !!proc.start && proc.start.from === proc.due.from && onOfficeTime(proc.due) && bare(proc.due) && bare(proc.start);
const dueSpec = (proc) => (isImmediate(proc) ? { ...proc.due, minutes: IMMEDIATE_MINUTES } : proc.due);

const sameDay = (a, b) => dayKeyIL(a) === dayKeyIL(b);

// End of the nth business day after `date` (the count starts the next business day).
// "The end of a business day" is the office's close: 18:00, and 13:00 on erev chag
// (protocol v8; docs/ops.md, section 49). Until then it was 23:59, while the editor's
// page already said "עד ראשון 18:00": the deadline shown and the moment lateness starts
// are now the same moment everywhere. With no days to add it is the end of that
// calendar day, as before (a bare date).
export const endOfBusinessDay = (d) => closeAt(d);
// A deadline that names a day, not an hour: the office's close of its day, or 23:59
// (a shoot day, a bare date). The calendar feed makes it an all-day entry and the
// "עכשיו" bar gives it no countdown, as before.
export const isDayEnd = (d) => { const p = partsIL(d); return (p.hour === 23 && p.minute === 59) || new Date(d).getTime() === closeAt(d).getTime(); };
export function addBusinessDays(date, n) {
  let d = new Date(date);
  let left = n;
  while (left > 0) {
    d = nextDay(d);
    if (isBusinessDay(d)) left -= 1;
  }
  return n > 0 ? closeAt(d) : endOfDayIL(d);
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

// The stages of a deadline (`afterMark`: one, or a list in order).
export const stagesOf = (spec) => (!spec?.afterMark ? [] : Array.isArray(spec.afterMark) ? spec.afterMark : [spec.afterMark]);
export const isDaily = (proc) => proc?.recurring === 'daily';

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
    // The stages of a deadline (afterMark) are marks of the round's own items.
    const staged = (spec) => (spec?.afterMark ? { ...spec, afterMark: stagesOf(spec).map((st) => ({ ...st, key: pre(st.key) })) } : spec);
    return PROCESSES.filter((p) => p.round && applies(p, ctx)).map((p) => {
      const x = resolve(p, ctx);
      return {
        ...x, id: `r${r.n}-${p.id}`, keyBase: pre(p.id), phase: `round-${r.n}`, ctx,
        start: shift(p.start), due: staged(shift(p.due)),
        items: x.items.map((i) => ({ ...i, key: pre(i.key), requires: i.requires?.map(pre) })),
      };
    });
  });
  // Stage 5: what the client started under (items added later are "fresh").
  return adjustForVersion([...base, ...extra], client);
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
  // A daily item (14's follow-up) is answered for the Israel day it was answered on.
  if (item.recurring === 'daily') return check.state === 'done' && !!check.at && dayKeyIL(check.at) === dayKeyIL(now);
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

// ── Landing (docs/ops.md, section 41) ──
// A client brought in from the old system is "in landing" (clients.landing) until it
// is taken in: it is a client everywhere, but nothing of it has a deadline, is late or
// counts for or against anybody. When it is activated the database stamps landed_at,
// and that moment is where its working clock starts: every anchor of a deadline that
// lies before it (the deal months ago, a shoot day long past, a process the import
// marked) counts as having happened then. Nothing is rewritten: deal_at, char_at,
// shoot_at and contract_end stay the real dates, and the package year, the Gantt and
// the renewal read them as before.
export const inLanding = (client) => client?.landing === true;
export const workFloor = (client) => (client && !inLanding(client) && client.landed_at ? parseDate(client.landed_at) : null);
// The least time anything that was already late on the day of the activation gets:
// until the end of the next business day (a "5 minutes" of months ago is not due
// five minutes after the owner pressed "מפעילים").
export const freshDeadline = (floor) => addBusinessDays(floor, 1);
// Recurring work of an activated client does not all come up on one morning: the
// database gives each client a turn (landing_slot, 0..9) and its weekly call first
// comes up on business day slot + 1 after the activation, at the opening of the office.
// From the first call on, each client keeps its own weekly rhythm.
export const SPREAD_DAYS = 10;
export function spreadStart(client) {
  const floor = workFloor(client);
  if (!floor) return null;
  const slot = Number.isInteger(client.landing_slot) ? ((client.landing_slot % SPREAD_DAYS) + SPREAD_DAYS) % SPREAD_DAYS : 0;
  let d = floor;
  for (let left = slot + 1; left > 0;) { d = nextDay(d); if (isBusinessDay(d)) left -= 1; }
  return openAt(d);
}

function anchor(from, client, procs, checks, now) {
  const at = realAnchor(from, client, procs, checks, now);
  // The contract's end is never moved: the renewal is counted from the real date.
  const floor = from === 'contractEnd' ? null : workFloor(client);
  return at && floor && at < floor ? floor : at;
}
function realAnchor(from, client, procs, checks, now) {
  switch (from) {
    case 'deal': return parseDate(client.deal_at);
    case 'group': {
      // v6: the shoot day is set right after the WhatsApp group is opened (p02.opened).
      // Inside a round there is no new group: the round starts when it was added.
      if (client.round) return parseDate(client.char_at);
      const c = checks['p02.opened'];
      return c && c.state === 'done' && c.at ? new Date(c.at) : null;
    }
    case 'char': return parseDate(client.char_at);
    case 'charEnd': {
      // Inside a round there is no meeting: the round starts when it was added.
      if (client.round) return parseDate(client.char_at);
      // End of the characterization meeting: "the characterization ended" (decision
      // 12: one tap, before the full form), else when process 4 was completed,
      // otherwise the end of its two-hour window.
      const ended = charEndedAt(checks);
      if (ended) return ended;
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
  // The stages of the deadline: the last one whose mark is done sets it, counted from
  // that mark (the moment the work reached whoever acts next).
  let stage = null;
  for (const st of stagesOf(spec)) {
    const c = checks[st.key];
    if (c && c.state === 'done' && c.at) stage = { st, at: new Date(c.at) };
  }
  if (stage) {
    const { st, at } = stage;
    if (st.businessDays) return addBusinessDays(at, st.businessDays);
    return st.office ? addWorkingMinutes(at, st.minutes) : new Date(at.getTime() + st.minutes * 6e4);
  }
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

// The renewal talk (process 34, the promise ה12): 60 days before the contract ends, and
// when that falls on a day off, the business day before it. One source for the client
// card (34's deadline, resolveTime above) and the client's status page, which showed
// the bare 60th day (a Friday) while the card showed the Thursday before it.
export const RENEWAL_LEAD_DAYS = 60;
export function renewalDay(contractEnd) {
  const end = parseDate(contractEnd);
  if (!end) return null;
  let d = addDaysIL(end, -RENEWAL_LEAD_DAYS);
  while (!isBusinessDay(d)) d = addDaysIL(d, -1);
  return d;
}

// How a client is named wherever the office picks one out of many (lists, the "עכשיו"
// clocks, the Thursday summary, reminder titles built on the server, and through them
// the WhatsApp template variables): the business first, then the contact,
// "קפה דנה · דנה". Two clients with the same contact stay apart (found live,
// 6.10.2026). A greeting to the client itself still uses the contact's name alone.
export function clientLabel(client) {
  const name = String(client?.name || '').trim();
  const business = String(client?.business || '').trim();
  if (!business || business === name) return name;
  return name ? `${business} · ${name}` : business;
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

// ── A detail that must not stay missing (docs/ops.md, section 47) ──
// An item marked `setHere` (app/protocol.js: "the meeting was set", process 3) needs
// details of the client: who characterizes and when. While one of them is blank the
// process is open, whatever was ticked, and it stays on its owner's list with the
// detail to fill in (openItemsFor), so a signed client never sits with no meeting date
// and nothing on anybody's list. The lists, the deadlines and the reminders all read
// this one answer. It is not asked of:
//   - a client in landing (nothing of it is asked for until it is activated);
//   - history brought in by an import (the mark's note is "ייבוא");
//   - a client that the process `unless` is already behind (the characterization ended,
//     process 4 is complete, or it was brought in as history).
// Returns { item, fields } for the first such item of the process, or null.
export function fieldGap(proc, client, checks = {}, procs = [], now = new Date()) {
  if (!client || inLanding(client)) return null;
  for (const item of proc.items) {
    if (!item.setHere) continue;
    const check = checks[item.key];
    if (check?.note === IMPORT_NOTE) continue;
    // Not ticked yet: every detail it needs. Ticked: only the detail the work after it
    // cannot start without (`keep`: the date; a blank "who" is Ofir, the protocol's
    // default, as on rows from before that default existed).
    const need = isResolved(item, check, now) ? (item.setHere.keep || item.requiresFields) : item.requiresFields;
    const fields = (need || []).filter((f) => blank(client[f]));
    if (!fields.length) continue;
    const round = /^(r\d+-)/.exec(proc.id)?.[1] || '';
    const next = item.setHere.unless && procs.find((p) => p.id === `${round}${item.setHere.unless}`);
    if (next && (isImported(next, checks) || completedAt(next, checks, now) || (next.id === 'p04' && charEndedAt(checks)))) continue;
    return { item, fields };
  }
  return null;
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
  // An item the system looks into before taking it (`guard`) is pressed by itself.
  return p.items.filter((i) => !i.optional && !i.noBulk && !i.guard && i.owners.includes(person)
    && !isResolved(i, checks[i.key], now) && !blockers(i, p.ctx || client, checks));
}

// Full state of a client's protocol. `checks` maps item key -> { state, at, by_email }.
// An item a later protocol version added (`fresh`) is not asked of history that was
// brought in by an import (docs/ops.md, section 49): when its own process carries an
// imported mark, or the mark or process its clock starts from does, the work it belongs
// to was done before this system knew of it. It stays in the card as "לא חובה" and is in
// nobody's list; a client that is still working through that step gets it as usual.
const ANCHOR_PROC = { deal: 'p01', group: 'p02', char: 'p04', charEnd: 'p04', shoot: 'p19' };
function afterImport(proc, procs, checks) {
  if (isImported(proc, checks)) return true;
  const from = proc.start?.from || proc.due?.from;
  if (!from) return false;
  if (from.startsWith('item:')) return checks[from.slice(5)]?.note === IMPORT_NOTE;
  // Inside an extra shoot round only the round's own shoot day is "before" it: the
  // round itself began in this system.
  const round = /^(r\d+-)/.exec(proc.id)?.[1] || '';
  if (round && ANCHOR_PROC[from] && from !== 'shoot') return false;
  const id = ANCHOR_PROC[from] ? `${round}${ANCHOR_PROC[from]}` : from;
  const p = procs.find((x) => x.id === id);
  return !!p && isImported(p, checks);
}
function withoutFreshAfterImport(procs, checks) {
  return procs.map((p) => {
    if (!p.items.some((i) => i.fresh && !i.optional)) return p;
    if (!afterImport(p, procs, checks)) return p;
    return { ...p, items: p.items.map((i) => (i.fresh && !i.optional ? { ...i, optional: true, history: true } : i)) };
  });
}

export function clientState(client, checks = {}, now = new Date()) {
  const procs = withoutFreshAfterImport(applicableProcesses(client), checks);
  const phaseList = phasesFor(client);
  const phaseIndex = (key) => phaseList.findIndex((p) => p.key === key);
  // In landing nothing has a deadline; after it, deadlines are counted from landed_at.
  const quiet = inLanding(client);
  const floor = workFloor(client);
  const states = procs.map((p) => {
    const ctx = p.ctx || client;
    // A deadline whose clock was already running when the client was activated (its
    // anchor lies at or before landed_at: the old deal, a past shoot day, a process the
    // taking-in marked) is counted again from the activation, and is never earlier than
    // the end of the next business day. What starts after the activation is untouched.
    const due = (spec) => {
      const d = resolveTime(spec, ctx, procs, checks, now);
      if (!d || !floor || spec.from === 'contractEnd') return d;
      const began = realAnchor(spec.from, ctx, procs, checks, now);
      return began && began <= floor ? laterDue(d, freshDeadline(floor)) : d;
    };
    const required = p.items.filter((i) => !i.optional);
    const resolved = required.filter((i) => isResolved(i, checks[i.key], now)).length;
    const touched = p.items.some((i) => checks[i.key]);
    // A detail the process is there to set (the meeting's date) keeps it open: fieldGap.
    const gap = p.recurring ? null : fieldGap(p, ctx, checks, procs, now);
    const complete = p.recurring ? false : resolved === required.length && !gap;
    const startAt = resolveTime(p.start, ctx, procs, checks, now);
    // A deadline a later protocol version shortened keeps the one the client started under.
    const baseDueAt = p.recurring || quiet ? null : laterDue(due(dueSpec(p)), p.dueBefore && due(p.dueBefore));
    const doneAt = complete ? completedAt(p, checks, now) : null;
    // Waiting on the client (office minutes): `waited` in all, `extended` the part
    // that moved the deadline on.
    const w = waitedMinutes(p, checks, doneAt || now, baseDueAt);
    const dueAt = baseDueAt && w.ext ? addWorkingMinutes(baseDueAt, w.ext) : baseDueAt;
    return {
      proc: p, required: required.length, resolved, complete, gap, touched, startAt, dueAt, baseDueAt,
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
    if (isDaily(s.proc)) {
      // 14: asked on every working day from its start until the day of `until` (the
      // shoot day), never of a client in landing or of imported history. Answered
      // today: 'done'. It is never late; a day that passed unanswered is simply gone.
      const ctx = s.proc.ctx || client;
      const item = s.proc.items[0];
      const end = s.proc.until ? realAnchor(s.proc.until, ctx, procs, checks, now) : null;
      const over = (!!end && dayKeyIL(now) >= dayKeyIL(end)) || isImported(s.proc, checks);
      const started = !!(s.startAt && s.startAt <= now);
      s.ready = !quiet && started && !over && client.status !== 'cancelled' && client.status !== 'ended';
      s.over = over;
      s.status = !s.ready ? (over ? 'done' : 'waiting') : isResolved(item, checks[item.key], now) ? 'done' : isBusinessDay(now) ? 'due' : 'waiting';
      s.lastAt = checks[item.key]?.at || null;
      continue;
    }
    if (s.proc.recurring) {
      const item = s.proc.items[0];
      const done = isResolved(item, checks[item.key], now);
      // In landing the weekly call is not asked for; after the activation it first comes
      // up on the client's own day (spreadStart), unless a call was recorded since.
      const first = spreadStart(client);
      const since = checks[item.key];
      if (quiet) s.ready = false;
      else if (s.ready && first && now < first && !(since && since.note !== IMPORT_NOTE && new Date(since.at) >= floor)) {
        s.ready = false;
        s.startAt = first;
      }
      s.status = !s.ready ? 'waiting' : done ? 'done' : 'due';
      s.lastAt = checks[item.key]?.at || null;
      continue;
    }
    // Items added to the protocol after the client started never make it late.
    s.late = !s.complete && !!(s.dueAt && s.dueAt < now)
      && (!!s.gap || s.proc.items.some((i) => !i.optional && !i.fresh && !isResolved(i, checks[i.key], now)));
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
    phases, states, current, landing: quiet,
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
  // A client in landing is taken in on its own screen (app/landing-logic.js): its items
  // are in nobody's list, count or clock until it is activated.
  if (client.status === 'cancelled' || inLanding(client)) return out;
  for (const s of state.states) {
    if (!s.ready || s.status === 'done') continue;
    if (client.status === 'ended' && s.proc.id !== 'p35') continue;
    // The daily follow-up is one counted line on its owner's list (app/mine-flow.js),
    // answered on its own page: never a card per client.
    if (isDaily(s.proc)) continue;
    for (const i of s.proc.items) {
      if (person && !i.owners.includes(person)) continue;
      const shared = i.owners === s.proc.owners || i.owners.join() === s.proc.owners.join();
      if (person && shared && s.claim && s.claim.person !== person) continue;
      // The detail this item waits for is filled in right on the list (`fields`): the
      // entry stays although it cannot be ticked yet (fieldGap).
      if (s.gap && s.gap.item.key === i.key) {
        out.push({ client, proc: s.proc, item: i, status: s.status, dueAt: s.dueAt, wait: s.wait, claim: shared ? s.claim : null, shared: shared && s.proc.owners.length > 1, fields: s.gap.fields });
        continue;
      }
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
    // A client in landing is not measured, and after it only what was finished since
    // the activation (the months before it were not worked in this system).
    if (inLanding(c)) continue;
    const floor = workFloor(c);
    const checks = checksByClient[c.id] || {};
    const s = clientState(c, checks, now);
    const procs = s.states.map((x) => x.proc);
    for (const x of s.states) {
      if (!x.complete || !x.completedAt || x.completedAt < since || !x.dueAt || isImported(x.proc, checks)) continue;
      if (floor && x.completedAt < floor) continue;
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

// Package quantities from a signed agreement's model: everything the agreement
// grants that can be counted. Mirrors public.package_deliverables() (last defined in
// supabase/migrations/20261003140000_manager_features.sql; tests/sql/manager.test.mjs
// compares the two). photo_days: the podcast packages' shoot day with a photographer
// at the business (not a day with the influencers, so not in shoot_days);
// simeon_join: the free "Simeon joins Natali's shoot day". Both only when granted.
export function packageDeliverables(model) {
  const sel = model?.selection;
  const id = model?.package?.id;
  const spec = SPECS[id];
  if (!sel || !spec) return {};
  const paid = sel.paid || [];
  const free = sel.free || {};
  // A contract changed by hand (selection.custom, app/pricing.js; 6.10.2026): the
  // package's own quantities as typed (add-ons still add on top), the term, and the
  // added lines, kept for display only (`extra`, no counters).
  const custom = sel.custom || {};
  const qty = custom.qty || {};
  const num = (key, base) => (Number.isInteger(qty[key]) ? qty[key] : base);
  const months = Number.isFinite(model?.termMonths) ? Math.round(model.termMonths)
    : Number.isInteger(custom.termMonths) ? custom.termMonths : TERM_MONTHS;
  const out = {
    videos: num('videos', spec.videos),
    graphics: num('graphics', spec.graphics) + (free.graphics || 0),
    shoot_days: num('shootDays', spec.shootDays) + (paid.includes('simeon-day') ? 1 : 0),
    collabs: num('collabs', spec.collabs) + (paid.includes('natali-reel') ? 1 : 0),
    stories: num('stories', spec.stories) + (free.simeonStories || 0) + (paid.includes('natali-story') ? 1 : 0),
    ch14: num('ch14', spec.ch14) + (free.extraCh14 ? 1 : 0),
    monthly: paid.includes('photographer') ? num('monthly', 8) * months : 0,
  };
  const photoDays = num('photoDays', PACKAGES[id]?.tier === 'podcast' ? 1 : 0);
  if (photoDays > 0) out.photo_days = photoDays;
  if (free.simeonJoin) out.simeon_join = 1;
  const lines = Array.isArray(custom.lines) ? custom.lines.filter((l) => l?.label) : [];
  if (lines.length) out.extra = lines.map((l) => ({ label: l.label, qty: Number.isInteger(l.qty) ? l.qty : null }));
  return out;
}

// The Sunday that starts the Israel week of `d`, as a YYYY-MM-DD key.
export function weekKey(d = new Date()) {
  return dayKeyIL(nextDay(d, -weekdayIL(d)));
}
