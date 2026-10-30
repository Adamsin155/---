// Ofir's first screen (system-plan section 3, "אופיר"): the quality-control queue
// with its one-hour clock (stopped while he is in a characterization, decision 11),
// today's characterizations, clients waiting for an editor, and the assignment
// (22א) with each editor's load. Pure, no DOM, Israel time; the marks are in
// app/office-marks.js.
import { EDITORS, editorsFor, PEOPLE, isStarDay, starShort } from './protocol.js';
import { editingDaysOf } from './protocol-versions.js';
import {
  businessDaysBetween, addBusinessDays, pauseOf, roundsOf, parseDate, inLanding, workFloor,
} from './protocol-logic.js';
import { dayKeyIL, daysBetweenIL, weekdayIL, addDaysIL, endOfDayIL } from './tz.js';
import {
  QA_KINDS, qaState, qaDue, qaWaited, meetingNow, kindOfProc, readJson, REASON_KEY, readTodo, TODO_KEY,
} from './office-marks.js';
import { fastCaseOf, fastWaited } from './fast-ladder.js';

export const QA_TARGET_MINUTES = 60;
const baseId = (id) => id.replace(/^r\d+-/, '');
const inWork = (c) => c.status === 'active' || c.status === 'ending';
const preOf = (proc) => proc.keyBase.slice(0, proc.keyBase.length - baseId(proc.id).length);

// ── The queue ───────────────────────────────
// Everything waiting for Ofir's check: the videos of each shoot round (25), the first 9
// graphics (7, protocol v9) and the rest of the graphics (23), first due first. Each
// item: { client, kind, pre, proc, ctx, round (1 = first check), readyAt, dueAt, waited
// (office minutes, his meetings not counted), target (the minutes he has), late, rounds
// (earlier returns), fast }. `fast`: the graphics are on his fast ladder
// (app/fast-ladder.js): its own minutes and window, and his meetings do not stop it.
export function qaQueue({ clients, stateOf, checks, meetings = [], now = new Date() }) {
  const out = [];
  for (const c of clients) {
    if (!inWork(c)) continue;
    const cs = checks[c.id] || {};
    for (const s of stateOf(c).states) {
      const kind = kindOfProc(s.proc.id);
      if (!kind || s.wait) continue;
      const pre = preOf(s.proc);
      const q = qaState(cs, pre, kind);
      if (q.stage !== 'ofir') continue;
      // Work that was waiting when the client was activated: its hour starts then.
      const floor = workFloor(c);
      if (floor && q.readyAt < floor) q.readyAt = floor;
      const st = stateOf(c).states;
      const fast = fastCaseOf(c, s, st, cs);
      const dueAt = fast ? fast.dueAt : qaDue(meetings, q.readyAt, QA_TARGET_MINUTES);
      out.push({
        key: `${c.id}:${s.proc.id}`, client: c, kind, pre, proc: s.proc, ctx: s.proc.ctx || c, round: q.round, rounds: q.rounds, fast,
        target: fast ? fast.spec.minutes : QA_TARGET_MINUTES,
        readyAt: q.readyAt, dueAt, waited: inLanding(c) ? 0 : fast ? fastWaited(fast, now) : qaWaited(meetings, q.readyAt, now),
        // The work is in the queue as usual; the hour is not counted while the client is in landing.
        late: !inLanding(c) && now >= dueAt, landing: inLanding(c),
      });
    }
  }
  return out.sort(byClock);
}
// The order of Ofir's lists (the owner's review, 20.10.2026): what has a clock first, the
// late before the rest, then by its due time; work of a client in landing ("בקליטה", no
// clock until it is activated) last.
const dueOf = (x) => +(x.fast?.dueAt || x.dueAt || Infinity);
const isLate = (x) => (x.late ?? (x.state?.status === 'overdue')) ? 1 : 0;
export function byClock(a, b) {
  return Number(!!a.landing) - Number(!!b.landing) || isLate(b) - isLate(a) || dueOf(a) - dueOf(b);
}

// Work returned for fixes and not back yet: { client, kind, pre, proc, ctx, open (the round), who }.
export function qaFixing({ clients, stateOf, checks }) {
  const out = [];
  for (const c of clients) {
    if (!inWork(c)) continue;
    const cs = checks[c.id] || {};
    for (const s of stateOf(c).states) {
      const kind = kindOfProc(s.proc.id);
      if (!kind) continue;
      const pre = preOf(s.proc);
      const q = qaState(cs, pre, kind);
      if (q.stage !== 'fixing') continue;
      const ctx = s.proc.ctx || c;
      out.push({ key: `${c.id}:${s.proc.id}`, client: c, kind, pre, proc: s.proc, ctx, open: q.open, rounds: q.rounds, who: QA_KINDS[kind].fixer(ctx) });
    }
  }
  return out.sort((a, b) => (a.open.due || Infinity) - (b.open.due || Infinity));
}

// What the one who waits for Ofir sees (the editor, Ilai): "אופיר באפיון, בקרה עד
// HH:MM" while he is in a meeting, otherwise "בקרה עד HH:MM".
export function qaNotice({ meetings = [], readyAt, now = new Date() }) {
  if (!readyAt) return null;
  const dueAt = qaDue(meetings, readyAt, QA_TARGET_MINUTES);
  return { inMeeting: !!meetingNow(meetings, now), dueAt };
}

// ── Today's characterizations ───────────────
export function charsToday({ clients, stateOf, now = new Date(), person = 'ofir' }) {
  return clients.filter((c) => inWork(c) && (c.characterizer || 'ofir') === person && parseDate(c.char_at) && daysBetweenIL(now, parseDate(c.char_at)) === 0)
    .map((c) => {
      const p4 = stateOf(c).states.find((s) => s.proc.id === 'p04');
      return { client: c, at: parseDate(c.char_at), done: !!p4?.complete, doneAt: p4?.completedAt || null };
    })
    .sort((a, b) => a.at - b.at);
}

// ── Editor assignment (22א) ────────────────
// Every shoot (the client's and each extra round's) waiting for an editor: its
// shoot day is over (19 done, so 22א is ready) and no editor is assigned yet.
export function awaitingEditor({ clients, stateOf, checks }) {
  const out = [];
  for (const c of clients) {
    if (!inWork(c)) continue;
    const cs = checks[c.id] || {};
    for (const s of stateOf(c).states) {
      if (baseId(s.proc.id) !== 'p22a' || !s.ready || s.complete) continue;
      const pre = preOf(s.proc);
      if (cs[`${pre}p22a.assigned`]?.state === 'done') continue;
      const ctx = s.proc.ctx || c;
      out.push({
        key: `${c.id}:${s.proc.id}`, client: c, pre, n: ctx.round || null, proc: s.proc, ctx, state: s, todo: readTodo(cs[TODO_KEY(pre)]),
        landing: c.landing === true,
      });
    }
  }
  // No clock on the assignment (30.10.2026): the most videos left first, a client in landing last.
  return out.sort((a, b) => Number(a.landing) - Number(b.landing) || b.todo - a.todo);
}

// How long the editing may take, as Ofir chooses when he assigns (30.10.2026), in business days
// from the assignment. A client's own editing days are the shortest choice, and the days above
// them are a shift of the deadlines (SHIFT_KEY), which moves 22, 24, 25 and 27 together.
const EDITING_CHOICES = [2, 3, 5, 7, 10];
export const editingChoices = (client) => EDITING_CHOICES.filter((d) => d >= editingDaysOf(client));
export const editingShift = (client, days) => Math.max(0, (Number(days) || 0) - editingDaysOf(client));
export const editingChoiceText = (d) => `${d} ימי עסקים`;

// Natali's shoot: Nirel is preselected, and for anyone else a reason is asked for. A
// joint Natali and Semyon day: no preselection, Ofir chooses, a reason asked for (decision 31).
// The reason is optional (the owner, 21.10.2026): the field and its hint stay, the
// assignment is never held back without it, and a reason given is kept (REASON_KEY).
// Niro's and "הצל"'s shoots as Natali's (28.10.2026); a joint day is Natali's only.
export const preselected = (shootType, joint = false) => (isStarDay(shootType) && !joint ? 'nirel' : null);
export function reasonNeeded({ shootType, joint = false, editor }) {
  if (!editor) return false;
  if (joint) return true;
  return isStarDay(shootType) && editor !== 'nirel';
}
export function reasonHint({ shootType, joint = false }) {
  if (joint) return 'יום צילום משותף לנטלי ולסמיון: בוחרים עורך, וכדאי לרשום למה (החלטה 31).';
  if (isStarDay(shootType)) return `בצילום של ${starShort(shootType)} ניראל מסומנת מראש. בשיוך לעורך אחר כדאי לרשום למה.`;
  return '';
}
export const eligibleEditors = (shootType) => editorsFor(shootType);
// Whether the client bought Semyon joining Natali's shoot day (the agreement's free add-on).
export const jointFromSelection = (selection) => selection?.free?.simeonJoin === true;
export const reasonNote = ({ editor, reason, preselected: pre = null, joint = false }) => JSON.stringify({ editor, reason: String(reason || '').trim().slice(0, 500), preselected: pre, joint: !!joint });
export const reasonOf = (checks, pre = '') => readJson(checks[REASON_KEY(pre)]);

// ── Changing an assigned editor ("החלפת עורך") ──
// The automatic assignment tells Ofir he can change it; he does it from the load
// list of his own screen, with the same rules as the first assignment (Nirel preselected
// for Natali, another editor for Natali with a reason, if he writes one).
//
// The editing clocks: the deadlines of 22, 24 and 27 count from the moment 22א
// "שויך" was marked (3 and 4 business days). Marking it again, as the first
// assignment does, starts them over from now; leaving the mark keeps them.
// A job that is already late is never restarted silently: there the default keeps
// the deadlines (the job stays late with the new editor), and starting over is
// Ofir's explicit choice; a reason, if he writes one, is kept in the reason mark.
//   job: one of editorLoad()'s jobs ({ dueAt, of, assignedAt, … }).
export function swapClock(job, now = new Date()) {
  const late = !!job?.dueAt && job.dueAt < now;
  return { late, keepDue: job?.dueAt || null, restartDue: addBusinessDays(now, job?.of || 3), choice: late ? 'keep' : 'restart' };
}
// No reason is required in a swap (the owner, 29.10.2026: "שלא יהיה חובה"), also not for
// counting a late job's deadlines again; one written is kept in the reason mark.
export function swapReasonNeeded() {
  return false;
}
// The reason mark of a swap: the usual { editor, reason, preselected, joint } and
// { swap: true, from, restart, prev (the earlier assignment time), late }. It
// replaces an automatic assignment's mark, so Ofir is not told again "שויך אוטומטית".
// The words say what happened, so the client's history reads by itself.
export function swapNote({ editor, from, reason = '', preselected: pre = null, joint = false, restart = false, late = false, prev = null }) {
  const why = String(reason || '').trim();
  const text = [`החלפת עורך: מ${editorName(from)} ל${editorName(editor)}`, why || null,
    restart ? 'מועדי העריכה נספרים מחדש מהיום' : late ? 'המועדים לא השתנו, העריכה נשארת באיחור' : 'המועדים לא השתנו'].filter(Boolean).join(' · ');
  return JSON.stringify({
    ...JSON.parse(reasonNote({ editor, reason: text, preselected: pre, joint })),
    swap: true, from: from || null, restart: !!restart, late: !!late, prev: prev ? new Date(prev).toISOString() : null,
  });
}

// Ofir's folder task (24): opened at the assignment, due the end of editing day 1
// (the assignment day is not counted). Not opened again on an editor swap: the
// client's folder is the same one.
export const folderTitle = (n = null) => `פתיחת תיקייה מסודרת בדרייב לעריכה (24)${n ? ` · סבב ${n}` : ''}`;
export const folderDueOn = (assignedAt) => dayKeyIL(addBusinessDays(assignedAt, 1));
// The item the folder task stands for (`p24.folder`, `r2.p24.folder`), or null.
export function folderItemOf(task) {
  const m = /^פתיחת תיקייה מסודרת בדרייב לעריכה \(24\)(?: · סבב (\d+))?$/.exec(task?.title || '');
  return m ? `${m[1] ? `r${m[1]}.` : ''}p24.folder` : null;
}

// "יום X מתוך 2" (3 for a client from before protocol v11; or 4 once the videos are with Ofir: closing with the client's
// fixes). The count starts the business day after the assignment (0: the
// assignment day itself).
export function editingDay(assignedAt, now = new Date()) {
  return assignedAt ? businessDaysBetween(assignedAt, now) : null;
}
export const dayText = (day, of) => (day === 0 ? 'שויך היום' : `יום ${day} מתוך ${of}`);

// Each editor's load: the editing jobs (the client's and each round's) not closed
// yet, which day of the editing each is on, which are paused, and open tasks. A job
// with two editors counts for each of them (`second`: this editor is the second one).
export function editorLoad({ clients, stateOf, checks, tasks = [], now = new Date() }) {
  const load = Object.fromEntries(EDITORS.map((e) => [e, { editor: e, jobs: [], paused: 0, tasks: 0 }]));
  for (const c of clients) {
    if (!inWork(c)) continue;
    const cs = checks[c.id] || {};
    const st = stateOf(c).states;
    const units = [{ x: c, pre: '', pid: '', n: null }, ...roundsOf(c).map((r) => ({ x: r, pre: `r${r.n}.`, pid: `r${r.n}-`, n: r.n }))]
      .flatMap((u) => [{ ...u, editor: u.x.editor }, ...(u.x.editor && u.x.editor2 && u.x.editor2 !== u.x.editor ? [{ ...u, editor: u.x.editor2, second: true }] : [])]);
    for (const u of units) {
      if (!u.editor || !load[u.editor]) continue;
      const p27 = st.find((s) => s.proc.id === `${u.pid}p27`);
      if (!p27 || p27.complete) continue;
      const p22 = st.find((s) => s.proc.id === `${u.pid}p22`);
      const p24 = st.find((s) => s.proc.id === `${u.pid}p24`);
      const as = cs[`${u.pre}p22a.assigned`];
      // "יום X מתוך 3" of a client that came from the old system is counted from its activation.
      const floor = workFloor(c);
      const marked = as?.state === 'done' ? new Date(as.at) : null;
      const assignedAt = marked && floor && marked < floor ? floor : marked;
      const withOfir = !!p24?.complete || cs[`${u.pre}p24.notify`]?.state === 'done';
      const pause = p22 ? pauseOf(p22.proc, cs) : null;
      const job = {
        client: c, n: u.n, pre: u.pre, assignedAt, of: withOfir ? 4 : editingDaysOf(c), second: !!u.second,
        partner: (u.second ? u.x.editor : u.x.editor2) || null,
        day: editingDay(assignedAt, now), paused: pause, stage: withOfir ? 'closing' : 'editing', landing: inLanding(c),
        dueAt: (withOfir ? p27 : p24)?.dueAt || null,
      };
      load[u.editor].jobs.push(job);
      if (pause) load[u.editor].paused += 1;
    }
  }
  const live = new Set(clients.filter(inWork).map((c) => c.id));
  for (const t of tasks) if (!t.done_at && load[t.owner] && live.has(t.client_id)) load[t.owner].tasks += 1;
  for (const l of Object.values(load)) l.jobs.sort((a, b) => (a.dueAt || Infinity) - (b.dueAt || Infinity));
  return load;
}

// Ofir's proposal: the least loaded editor who may take this shoot type (active
// jobs, then open tasks), other than the ones excluded (the paused editor).
export function proposeEditor(load, shootType, exclude = []) {
  const active = (l) => l.jobs.filter((j) => !j.paused).length;
  return suggestPool(shootType).filter((e) => !exclude.includes(e) && load[e])
    .sort((a, b) => (active(load[a]) - active(load[b])) || (load[a].tasks - load[b].tasks) || EDITORS.indexOf(a) - EDITORS.indexOf(b))[0] || null;
}

// What the assignment dialog marked for Ofir until 13.10.2026 (protocol v9: he assigns,
// the system only suggests). Kept for its callers; the screen now asks suggestAssignment
// below, and this answers in the same order. { editor, why: 'rule' | 'load' } or null.
export function suggestEditor(load, shootType, joint = false, exclude = [], now = new Date()) {
  const pre = preselected(shootType, joint);
  if (pre && !exclude.includes(pre)) return { editor: pre, why: 'rule' };
  const editor = rankEditors(load, isStarDay(shootType) ? shootType : 'dms', exclude, now)[0]?.editor || null;
  return editor ? { editor, why: 'load' } : null;
}
export const SUGGESTED_TAG = 'מומלץ לפי עומס';
export const CONTINUITY_TAG = 'מומלץ: ערך/ה בסבב הקודם';

// ── The suggestion (the owner's choice of 13.10.2026: "the system suggests, Ofir confirms") ──
// Nothing is assigned without Ofir's tap (protocol v9 as it is); this only says whom his
// tap would assign. Pure: the same load the list next to it shows.
//
// "Open work" is the number the load list shows for the editor: the clients in editing
// (`jobs.length` of editorLoad, the paused ones too), so the suggestion never contradicts
// the list. A tie goes to the one with fewer editing deadlines until the end of this week
// (Sunday to Saturday, Israel; a deadline already missed counts, a client in landing has
// none), then to the team's order (EDITORS in app/protocol.js).
const clientsInEditing = (n) => (n ? `${n === 1 ? 'לקוח אחד' : `${n} לקוחות`} בעריכה` : 'אין לקוחות בעריכה');
export const endOfWeekIL = (now = new Date()) => endOfDayIL(addDaysIL(now, 6 - weekdayIL(now)));
export function dueThisWeek(l, now = new Date()) {
  const end = endOfWeekIL(now);
  return l.jobs.filter((j) => j.dueAt && !j.landing && j.dueAt <= end).length;
}
// The editors who may take this shoot, the least loaded first: [{ editor, open, week }].
// Whom the load may suggest: Nirel may edit any shoot since 21.10.2026, and is offered in the
// dialog for every shoot, but she is suggested by the load only for Natali's (her own work).
const suggestPool = (shootType) => (isStarDay(shootType) ? EDITORS : EDITORS.filter((e) => e !== 'nirel'));
export function rankEditors(load, shootType, exclude = [], now = new Date(), pool = suggestPool(shootType)) {
  if (!load) return [];
  return pool.filter((e) => !exclude.includes(e) && load[e])
    .map((e) => ({ editor: e, open: load[e].jobs.length, week: dueThisWeek(load[e], now) }))
    .sort((a, b) => (a.open - b.open) || (a.week - b.week) || EDITORS.indexOf(a.editor) - EDITORS.indexOf(b.editor));
}
// Who edited this client's latest earlier shoot (the client's own before round 2, round 2
// before round 3…): only a shoot that was really assigned (its 22א "שויך" is marked), not a
// name the office wrote in the card ahead of time. null for the client's first shoot.
export function earlierEditor(client, n, checks = {}) {
  if (!n) return null;
  const units = [{ editor: client.editor, pre: '', n: 1 }, ...roundsOf(client).filter((r) => r.n < n).map((r) => ({ editor: r.editor, pre: `r${r.n}.`, n: r.n }))]
    .sort((a, b) => b.n - a.n);
  return units.find((u) => u.editor && checks[`${u.pre}p22a.assigned`]?.state === 'done')?.editor || null;
}
// The suggested editor of one waiting shoot:
//   { editor, why, reason, load }   why: 'rule' | 'card' | 'continuity' | 'load'
//   { editor: null, why: 'none', reason, load: null }   nobody to suggest, and why in one line
// The order: an editor the office already wrote in the card and the rule's own choice
// (Nirel for Natali's shoot), both as the dialog already did; the editor of the client's earlier round when still on
// the team and allowed for this shoot (continuity beats load), else the least loaded.
//   n: the round (null for the client's own shoot); inCard: the editor written in the card.
export function suggestAssignment({ client, n = null, shootType, joint = false, inCard = null, load, checks = {}, exclude = [], now = new Date() }) {
  const none = (reason) => ({ editor: null, why: 'none', reason, load: null });
  const may = eligibleEditors(shootType).filter((e) => !exclude.includes(e));
  if (!may.length) return none('אין עורך שאפשר לשייך אליו');
  if (!load || may.some((e) => !load[e])) return none('העומס של העורכים לא ידוע כרגע');
  const pick = (editor, why, reason) => ({ editor, why, reason, load: load[editor] });
  if (inCard && may.includes(inCard)) return pick(inCard, 'card', 'רשום בכרטיס הלקוח');
  const pre = preselected(shootType, joint);
  if (pre && may.includes(pre)) return pick(pre, 'rule', `צילום של ${starShort(shootType)}: ${editorName(pre)} מסומנת מראש`);
  const before = earlierEditor(client, n, checks);
  if (before && may.includes(before)) return pick(before, 'continuity', 'ערך/ה ללקוח הזה בסבב הקודם');
  // Nobody of the usual ones left (all excluded): whoever may still take it, Nirel too.
  const ranked = rankEditors(load, shootType, exclude, now);
  const [first, second] = ranked.length ? ranked : rankEditors(load, shootType, exclude, now, may);
  const open = clientsInEditing(first.open);
  const reason = !second || first.open < second.open ? `העומס הנמוך ביותר: ${open}`
    : first.week < second.week ? `${open}, ופחות יעדים השבוע`
      : `${open} · עומס שווה, לפי סדר הצוות`;
  return pick(first.editor, 'load', reason);
}

// "נדיה: 2 לקוחות בעריכה · 1 עצורה · 3 משימות"
export function loadText(l) {
  return [
    clientsInEditing(l.jobs.length),
    l.paused ? `${l.paused === 1 ? 'אחת עצורה' : `${l.paused} עצורות`}` : null,
    l.tasks ? `${l.tasks === 1 ? 'משימה פתוחה' : `${l.tasks} משימות פתוחות`}` : null,
  ].filter(Boolean).join(' · ');
}

export const editorName = (k) => PEOPLE[k]?.name || k;
