// Ofir's first screen (system-plan section 3, "אופיר"): the quality-control queue
// with its one-hour clock (stopped while he is in a characterization, decision 11),
// today's characterizations, clients waiting for an editor, and the assignment
// (22א) with each editor's load. Pure, no DOM, Israel time; the marks are in
// app/office-marks.js.
import { EDITORS, editorsFor, PEOPLE } from './protocol.js';
import {
  businessDaysBetween, addBusinessDays, pauseOf, roundsOf, parseDate,
} from './protocol-logic.js';
import { dayKeyIL, daysBetweenIL } from './tz.js';
import {
  QA_KINDS, qaState, qaDue, qaWaited, meetingNow, kindOfProc, readJson, REASON_KEY,
} from './office-marks.js';

export const QA_TARGET_MINUTES = 60;
const baseId = (id) => id.replace(/^r\d+-/, '');
const inWork = (c) => c.status === 'active' || c.status === 'ending';
const preOf = (proc) => proc.keyBase.slice(0, proc.keyBase.length - baseId(proc.id).length);

// ── The queue ───────────────────────────────
// Everything waiting for Ofir's check: the videos of each shoot round (25) and the
// rest of the graphics (23), first due first. Each item: { client, kind, pre,
// proc, ctx, round (1 = first check), readyAt, dueAt, waited (office minutes, his
// meetings not counted), late, rounds (earlier returns) }.
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
      const dueAt = qaDue(meetings, q.readyAt, QA_TARGET_MINUTES);
      out.push({
        key: `${c.id}:${s.proc.id}`, client: c, kind, pre, proc: s.proc, ctx: s.proc.ctx || c, round: q.round, rounds: q.rounds,
        readyAt: q.readyAt, dueAt, waited: qaWaited(meetings, q.readyAt, now), late: now >= dueAt,
      });
    }
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
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
      out.push({ key: `${c.id}:${s.proc.id}`, client: c, pre, n: ctx.round || null, proc: s.proc, ctx, state: s, dueAt: s.dueAt });
    }
  }
  return out;
}

// Natali's shoot: Nirel is preselected, and anyone else needs a recorded reason. A
// joint Natali and Semyon day: no preselection, Ofir chooses with a reason (decision 31).
export const preselected = (shootType, joint = false) => (shootType === 'natali' && !joint ? 'nirel' : null);
export function reasonNeeded({ shootType, joint = false, editor }) {
  if (!editor) return false;
  if (joint) return true;
  return shootType === 'natali' && editor !== 'nirel';
}
export function reasonHint({ shootType, joint = false }) {
  if (joint) return 'יום צילום משותף לנטלי ולסמיון: בוחרים עורך עם סיבה (החלטה 31).';
  if (shootType === 'natali') return 'בצילום של נטלי ניראל מסומנת מראש. שיוך לעורך אחר דורש סיבה שנרשמת.';
  return '';
}
export const eligibleEditors = (shootType) => editorsFor(shootType);
// Whether the client bought Semyon joining Natali's shoot day (the agreement's free add-on).
export const jointFromSelection = (selection) => selection?.free?.simeonJoin === true;
export const reasonNote = ({ editor, reason, preselected: pre = null, joint = false }) => JSON.stringify({ editor, reason: String(reason || '').trim().slice(0, 500), preselected: pre, joint: !!joint });
export const reasonOf = (checks, pre = '') => readJson(checks[REASON_KEY(pre)]);

// Ofir's folder task (24): opened at the assignment, due the end of editing day 1
// (the assignment day is not counted).
export const folderTitle = (n = null) => `פתיחת תיקייה מסודרת בדרייב לעריכה (24)${n ? ` · סבב ${n}` : ''}`;
export const folderDueOn = (assignedAt) => dayKeyIL(addBusinessDays(assignedAt, 1));
// The item the folder task stands for (`p24.folder`, `r2.p24.folder`), or null.
export function folderItemOf(task) {
  const m = /^פתיחת תיקייה מסודרת בדרייב לעריכה \(24\)(?: · סבב (\d+))?$/.exec(task?.title || '');
  return m ? `${m[1] ? `r${m[1]}.` : ''}p24.folder` : null;
}

// "יום X מתוך 3" (or 4 once the videos are with Ofir: closing with the client's
// fixes). The count starts the business day after the assignment (0: the
// assignment day itself).
export function editingDay(assignedAt, now = new Date()) {
  return assignedAt ? businessDaysBetween(assignedAt, now) : null;
}
export const dayText = (day, of) => (day === 0 ? 'שויך היום' : `יום ${day} מתוך ${of}`);

// Each editor's load: the editing jobs (the client's and each round's) not closed
// yet, which day of the editing each is on, which are paused, and open tasks.
export function editorLoad({ clients, stateOf, checks, tasks = [], now = new Date() }) {
  const load = Object.fromEntries(EDITORS.map((e) => [e, { editor: e, jobs: [], paused: 0, tasks: 0 }]));
  for (const c of clients) {
    if (!inWork(c)) continue;
    const cs = checks[c.id] || {};
    const st = stateOf(c).states;
    const units = [{ editor: c.editor, pre: '', pid: '', n: null }, ...roundsOf(c).map((r) => ({ editor: r.editor, pre: `r${r.n}.`, pid: `r${r.n}-`, n: r.n }))];
    for (const u of units) {
      if (!u.editor || !load[u.editor]) continue;
      const p27 = st.find((s) => s.proc.id === `${u.pid}p27`);
      if (!p27 || p27.complete) continue;
      const p22 = st.find((s) => s.proc.id === `${u.pid}p22`);
      const p24 = st.find((s) => s.proc.id === `${u.pid}p24`);
      const as = cs[`${u.pre}p22a.assigned`];
      const assignedAt = as?.state === 'done' ? new Date(as.at) : null;
      const withOfir = !!p24?.complete || cs[`${u.pre}p24.notify`]?.state === 'done';
      const pause = p22 ? pauseOf(p22.proc, cs) : null;
      const job = {
        client: c, n: u.n, pre: u.pre, assignedAt, of: withOfir ? 4 : 3,
        day: editingDay(assignedAt, now), paused: pause, stage: withOfir ? 'closing' : 'editing',
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
  return eligibleEditors(shootType).filter((e) => !exclude.includes(e) && load[e])
    .sort((a, b) => (active(load[a]) - active(load[b])) || (load[a].tasks - load[b].tasks) || EDITORS.indexOf(a) - EDITORS.indexOf(b))[0] || null;
}

// "נדיה: 2 לקוחות בעריכה · 1 עצורה · 3 משימות"
export function loadText(l) {
  const n = l.jobs.length;
  return [
    n ? `${n === 1 ? 'לקוח אחד' : `${n} לקוחות`} בעריכה` : 'אין לקוחות בעריכה',
    l.paused ? `${l.paused === 1 ? 'אחת עצורה' : `${l.paused} עצורות`}` : null,
    l.tasks ? `${l.tasks === 1 ? 'משימה פתוחה' : `${l.tasks} משימות פתוחות`}` : null,
  ].filter(Boolean).join(' · ');
}

export const editorName = (k) => PEOPLE[k]?.name || k;
