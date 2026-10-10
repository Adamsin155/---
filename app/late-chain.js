// What is late now, who holds it and who waits for it (docs/ops.md, section 48).
// One answer for the reminders (the ladder of a late item: the rules `lateOwn` and
// `lateNag` in app/reminder-rules.js), for the owners' end-of-day table
// (app/day-summary.js) and for the tests. Pure: no DOM, no network, Israel time.
//
// A late item is a process of a client whose deadline passed (clientState: 'overdue'),
// or a task (public.client_tasks) still open after its due day. For each:
//   holders   who can act on it now: the owners of its open items that nothing blocks,
//             and that do not come after someone else's open item. In a shared process
//             that was taken ("אני על זה"), whoever took it.
//   waiters   who waits for that work, read from the protocol itself and never from a
//             hand-written list: the owners of the items that come after the open one
//             (an item that `requires` it, or the target of its hand-off in
//             app/handoffs.js), the targets of every hand-off out of the process, and
//             the owners of the processes whose clock starts when this one (or one of
//             its open items) is done (`start.from` / `due.from` in app/protocol.js).
//             For a task: whoever opened it, and for a fix the client asked for, whoever
//             owns that approval.
//   clientTurn  the work was sent to the client and the client did not answer yet (no
//             approval, no fix request): nobody in the office can move it, so nobody
//             holds it and nobody is reminded. (A process marked "ממתין ללקוח" is not
//             'overdue' at all, and a paused editing is left out here.)
// Not asked of a client in landing (docs/ops.md, section 41).
import { PROCESSES, FAST_LADDER } from './protocol.js';
import { isResolved, blockers, pauseOf, clientLabel, inLanding, addWorkingMinutes, businessDaysBetween, officeMsBetween, parseDate, endOfBusinessDay } from './protocol-logic.js';
import { HANDOFFS } from './handoffs.js';
import { ANSWER_CLOCKS } from './clocks.js';
import { QA_KINDS, GRAPHICS_KINDS, kindOfProc, qaState } from './office-marks.js';
import { fastCaseOf } from './fast-ladder.js';

import { dayFromKeyIL, endOfDayIL, dayKeyIL } from './tz.js';

// The numbers of the ladder: each is a one-line change.
export const LATE_LADDER = {
  graceMinutes: 15,          // office minutes past the deadline before anybody is told (a hand-off that just landed is not late)
  tellWithinMinutes: 60,     // "באיחור" and "מתעכב אצל…" are said when it becomes late, to whoever holds or waits then; never hours later to whoever got it since
  nagAt: ['09:00', '14:00'], // every working day, to whoever holds something late, until it is done
  managerAfter: 1,           // business days of lateness before the managers ring
  ownerAfter: 2,             // business days of lateness before the owners ring
  managers: ['ofir', 'lior'], // who supervises (the watchers of the rule `late`)
  listMax: 6,                // items named in one grouped message; the rest is "ועוד N"
};

const FIX_SOURCE = 'client_fix'; // app/status-rules.js CLIENT_FIX (not imported: that module is the rules' side)
const baseKey = (key) => String(key).replace(/^r\d+\./, '');
const preOf = (key) => String(key).slice(0, String(key).length - baseKey(key).length);
const baseProc = (id) => String(id).replace(/^r\d+-/, '');
const ITEM_OWNERS = new Map(PROCESSES.flatMap((p) => p.items.map((i) => [i.key, i])));
// The items that are the client's own answer: the approvals the "client did not answer"
// clocks wait for (app/clocks.js), and the scripts' approval.
export const CLIENT_TURN = new Set([...Object.values(ANSWER_CLOCKS).map((c) => c.approval), 'p13.approved']);

const real = (people) => [...new Set(people)].filter((p) => p && p !== 'editor');
const open = (s, checks, now) => s.proc.items.filter((i) => (s.gap && s.gap.item.key === i.key) || (!i.optional && !isResolved(i, checks[i.key], now)));
const openFix = (tasks, cid, key) => (tasks || []).find((t) => t.source === FIX_SOURCE && !t.done_at && t.client_id === cid && t.brief?.item_key === key) || null;

// The people a hand-off of this process goes to. `inside`: only the targets who carry on
// in this same process (the graphics' review); otherwise every target.
function handoffTargets(s, client, checks, openKeys, { inside }) {
  const b = baseProc(s.proc.id);
  const pre = preOf(s.proc.keyBase || s.proc.id);
  const ctx = s.proc.ctx || client;
  const out = [];
  for (const point of HANDOFFS) {
    const byProc = point.on === b;
    const on = byProc ? null : pre + point.on;
    if (byProc ? (inside || s.complete) : (point.on.split('.')[0] !== b || !openKeys.has(on))) continue;
    for (const t of point.to) {
      if (inside && t.proc !== b) continue;
      out.push({ on, person: typeof t.person === 'function' ? t.person(ctx, checks, pre) : t.person });
    }
  }
  return out;
}

// One late process: { holders, waiters, clientTurn, fixing }.
export function chainOf(s, client, checks, states, tasks = [], now = new Date()) {
  const ctx = s.proc.ctx || client;
  const owned = (i) => (s.claim && i.owners.join() === s.proc.owners.join() ? [s.claim.person] : i.owners);
  let items = open(s, checks, now);
  // The client's turn: an approval that is the client's to give, with all it needs done.
  const turn = items.find((i) => CLIENT_TURN.has(baseKey(i.key)) && !blockers(i, ctx, checks)) || null;
  const fix = turn ? openFix(tasks, client.id, turn.key) : null;
  // Notes the office wrote down by hand (27: p27.notes) are a fix request too.
  const notes = turn && baseKey(turn.key) === 'p27.approved' && checks[`${preOf(turn.key)}p27.notes`]?.state === 'done';
  if (turn && !fix && !notes) return { holders: [], waiters: [], clientTurn: true, fixing: false };
  if (turn) items = items.filter((i) => i !== turn);
  const openKeys = new Set(items.map((i) => i.key));
  // Graphics that Ofir returned for fixes (7, 23; protocol v9) are with whoever fixes
  // them, and he is the one who waits: his checks are not his lateness meanwhile.
  const qa = kindOfProc(s.proc.id);
  if (qa && GRAPHICS_KINDS.includes(qa) && qaState(checks, preOf(s.proc.keyBase || s.proc.id), qa).stage === 'fixing') {
    const holders = real([QA_KINDS[qa].fixer(ctx)]);
    return { holders, waiters: real(items.flatMap(owned)).filter((p) => !holders.includes(p)), clientTurn: false, fixing: false };
  }
  const after = handoffTargets(s, client, checks, openKeys, { inside: true });
  const isAfter = (i) => after.some((a) => a.on !== i.key && i.owners.includes(a.person));
  const free = items.filter((i) => !blockers(i, ctx, checks) || (s.gap && s.gap.item.key === i.key));
  let holders = real(free.filter((i) => !isAfter(i)).flatMap(owned));
  // Everything open waits for a detail of the client that is still missing: the process's own people.
  if (!free.length && items.length && items.every((i) => !(blockers(i, ctx, checks)?.items || []).length)) holders = real(s.claim ? [s.claim.person] : s.proc.owners);
  // The fix the client asked for is a task of its own (with its own due day): it carries
  // the lateness of whoever fixes, not this process as well.
  if (fix) holders = holders.filter((p) => p !== fix.owner);
  // The processes whose clock starts here (a shoot round's anchors carry the round: 'r2-p19', 'item:r2.p22a.assigned').
  const next = states.filter((x) => !x.complete && x !== s && [x.proc.start?.from, x.proc.due?.from]
    .some((from) => from === s.proc.id || (String(from || '').startsWith('item:') && openKeys.has(String(from).slice(5)))));
  const waiters = real([
    ...items.filter((i) => !free.includes(i) || isAfter(i)).flatMap(owned),
    ...handoffTargets(s, client, checks, openKeys, { inside: false }).map((t) => t.person),
    ...next.flatMap((x) => (x.claim ? [x.claim.person] : x.proc.owners)),
  ]).filter((p) => !holders.includes(p));
  return { holders, waiters: holders.length ? waiters : [], clientTurn: false, fixing: !!fix || !!notes };
}

// Every late item of the live clients at `now`, the longest lateness first.
//   [{ kind: 'proc' | 'task', id, cid, client, name, what, num, dueAt, lateAt, holders,
//      waiters, clientTurn, ownLadder, gap, snooze, ref, procId, task }]
// `snooze`: "לדחות עד…" on the process (the mark `pNN.snooze`): its reminders wait until then.
// `lateAt`: the moment it counts as late (the deadline and the grace, in office time).
// `ownLadder`: another rule already follows this one (the characterization's form, the
// final versions waiting for "קיבלתי", and `fast`: Ofir's fast ladder of protocol v9);
// `gap`: process 3 with no meeting date (its own daily ring, section 47). All of them
// still count as late in the table.
// `meetings`: Ofir's characterization meetings (ofirMeetings in app/office-marks.js): his
// fast ladder does not count them, so work that reached him while he sits with a client
// is not late until the meeting ended and his minutes passed (protocol v10). Left out, it
// is what the page knows (setOfirMeetings in app/fast-ladder.js).
export function lateItems({ clients = [], checksOf = () => ({}), stateOf, tasks = [], personOf = () => null, now = new Date(), grace = LATE_LADDER.graceMinutes, meetings = undefined }) {
  const out = [];
  const live = new Map();
  for (const c of clients) {
    if (inLanding(c) || (c.status !== 'active' && c.status !== 'ending')) continue;
    live.set(c.id, c);
    const checks = checksOf(c);
    const st = stateOf(c).states;
    for (const s of st) {
      if (s.status !== 'overdue' || s.proc.recurring || !s.dueAt || pauseOf(s.proc, checks)) continue;
      const b = baseProc(s.proc.id);
      const pre = preOf(s.proc.keyBase || s.proc.id);
      const done = (k) => ['done', 'na'].includes(checks[pre + k]?.state);
      let chain = chainOf(s, c, checks, st, tasks, now);
      // On the fast ladder (app/fast-ladder.js) it is that one person's lateness, and the
      // ladder's own rings are the only ones: `fast`, and `ownLadder` below.
      const fc = chain.clientTurn ? null : (meetings === undefined ? fastCaseOf(c, s, st, checks) : fastCaseOf(c, s, st, checks, meetings));
      const fast = !!fc;
      // His minutes did not run out yet (they wait for the end of his meeting): not late.
      if (fc && now < fc.dueAt) continue;
      if (fast) chain = { ...chain, holders: [FAST_LADDER.who], waiters: real([...chain.holders, ...chain.waiters]).filter((p) => p !== FAST_LADDER.who) };
      const sn = checks[`${s.proc.keyBase || s.proc.id}.snooze`];
      const dueAt = fc ? fc.dueAt : s.dueAt;
      out.push({
        snooze: sn?.state === 'done' ? parseDate(sn.note) : null,
        kind: 'proc', id: `${s.proc.id}@${s.dueAt.toISOString()}`, cid: c.id, client: c, name: clientLabel(c), what: `${s.proc.num} · ${s.proc.title}`, num: s.proc.num,
        dueAt, lateAt: addWorkingMinutes(dueAt, grace), ...chain,
        // Only process 3's missing meeting date has a daily ring of its own (section 47). 11
        // without a shoot date (protocol v8) is a late item like any other: it is on the ladder.
        ownLadder: fast || (b === 'p04' && done('p04.ended')) || (b === 'p27' && done('p27.final')), fast, gap: !!s.gap && b === 'p03',
        ref: s.proc.keyBase || s.proc.id, procId: s.proc.id, task: null,
      });
    }
  }
  const today = dayKeyIL(now);
  for (const t of tasks) {
    const c = live.get(t.client_id);
    if (!c || t.done_at || !t.due_on || t.due_on >= today) continue;
    const dueAt = endOfDayIL(dayFromKeyIL(t.due_on));
    if (!dueAt) continue;
    const asked = t.source === FIX_SOURCE ? (ITEM_OWNERS.get(baseKey(t.brief?.item_key || ''))?.owners || []) : [];
    const holders = real([t.owner]);
    out.push({
      kind: 'task', id: `t${t.id}@${t.due_on}`, cid: c.id, client: c, name: clientLabel(c), what: t.title, num: null,
      dueAt, lateAt: addWorkingMinutes(dueAt, grace), holders, clientTurn: false, fixing: false,
      waiters: real([personOf(t.created_by_email), ...asked]).filter((p) => !holders.includes(p) && p !== 'owner'),
      ownLadder: false, fast: false, gap: false, snooze: null, ref: null, procId: null, task: t,
    });
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}

// ── "Late", for one person, as one number (docs/ops.md, section 50) ──
// The "באיחור" tab of "המשימות שלי", the "באיחור" group of the list, the daily control's
// column and the owners' end-of-day table all count with these, so a person sees the
// same number wherever it is written:
//   - past its deadline, and held by that person now (`holders`);
//   - not the client's turn (`clientTurn`): that is nobody's lateness;
//   - not a client in landing, not a paused editing, not "ממתין ללקוח" (lateItems leaves them out);
//   - a deadline at the close of this very day (18:00) is "of today, not done" until
//     tomorrow, as in the owners' table.
// The reminders (app/reminder-rules.js) read the same lateItems and add what is theirs
// alone: 15 office minutes of grace, "לדחות עד…", and the two cases another rule rings for.
export const dueAtCloseToday = (x, now = new Date()) => x.kind === 'proc' && dayKeyIL(x.dueAt) === dayKeyIL(now) && x.dueAt.getTime() === endOfBusinessDay(x.dueAt).getTime();
export const countsLate = (x, now = new Date()) => !x.clientTurn && x.holders.length > 0 && !dueAtCloseToday(x, now);
// The late items one person holds, the longest lateness first (lateItems is sorted so).
export const heldLate = (items, person, now = new Date()) => items.filter((x) => countsLate(x, now) && x.holders.includes(person));
// The key of a late item as the lists name their cards: `${client}:${process}`, `task:${id}`.
export const lateKey = (x) => (x.kind === 'task' ? `task:${x.task.id}` : `${x.cid}:${x.procId}`);
// Where a reminder about several late items opens: the "באיחור" tab of "המשימות שלי".
export const LATE_URL = 'clients.html#late';

// "באיחור 3 שעות", "באיחור יום עסקים", "באיחור 4 ימי עסקים": how late, in the office's time.
export function lateWords(dueAt, now = new Date()) {
  const days = businessDaysBetween(dueAt, now);
  if (days >= 2) return `${days} ימי עסקים`;
  if (days === 1) return 'יום עסקים';
  const m = Math.round(officeMsBetween(dueAt, now) / 6e4);
  if (m < 60) return m <= 1 ? 'כמה דקות' : `${m} דקות`;
  const hrs = Math.round(m / 60);
  return hrs === 1 ? 'שעה' : hrs === 2 ? 'שעתיים' : `${hrs} שעות`;
}

// The client's approval item that is under a fix the client asked for: its wording on
// the lists changes from waiting for the approval to what there is to do (section 48).
export const FIX_ITEM_LABEL = 'הלקוח ביקש תיקונים: לברר ולתעד';
export const fixTaskOf = (tasks, clientId, itemKey) => openFix(tasks, clientId, itemKey);
// The line under it: the client's own words, who fixes, and when the item is ticked.
export function fixNote(task, nameOf = (p) => p) {
  const words = String(task?.brief?.problem || '').replace(/\s+/g, ' ').trim();
  const said = words ? `הלקוח כתב: ״${words.length > 200 ? `${words.slice(0, 199)}…` : words}״. ` : '';
  return `${said}${task?.owner ? `${nameOf(task.owner)} ${task.brief?.extra ? 'מחליט/ה על סבב נוסף' : 'מתקן/ת'}. ` : ''}מסמנים כאן רק כשהלקוח מאשר אחרי התיקון.`;
}
