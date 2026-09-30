// generated — edit app/ instead. Source: app/office-marks.js. Regenerate: node scripts/sync-functions.mjs
// The office's flows as protocol marks (stage 3, part 2: Ofir, Lior and Ilai;
// docs/plan/system-plan.md, section 3, and decisions 7–24). Every event the
// reminder engine reacts to is a check in protocol_checks with a stable key, so
// the engine (app/reminder-rules.js, on the server too), the client card and the
// office screens read the same thing. Pure, no DOM, Israel time (tz.js).
//
// The keys (never renamed or reused; `r2.` before them in a second shoot round):
//   p25.return.N        Ofir returned the videos for fixes, round N (1, 2, …). Note
//                       JSON { v, issues: [{ ref, text }], due } (ref: the video's number).
//   p25.fixed.N.I       the fixer marked issue I of round N as fixed ("תוקן").
//   p25.fixed.N         round N is fixed and back with Ofir ("סמן הכול תוקן", or the
//                       last issue fixed). Marking the videos ready again (p24.notify)
//                       after the return counts the same.
//   p23.return.N, p23.fixed.N(.I)   the same for the rest of the graphics (Ilai fixes).
//   p22a.reason         why the editor was chosen, when a reason is needed (the
//                       Natali preselection, a joint day). Note JSON { editor, reason, preselected, joint }.
//   p22a.shift          Lior moved the editing deadlines (app/protocol-logic.js SHIFT).
//   p22.decision        Lior's decision on editing still paused the next morning.
//                       Note JSON { choice: 'move' | 'reassign', days, editor, proposal }.
//   p06.fixed.<network> Lior closed a broken login: fixed, or partly (Irit and Ilai
//                       are told). Note JSON { partial, missing, access }.
import { PROCESSES, WORK_HOURS, PEOPLE } from './protocol.js';
import {
  addWorkingMinutes, officeMsBetween, isBusinessDay, IMPORT_NOTE, parseDate, erevOn, SHIFT,
} from './protocol-logic.js';
import { atTimeIL, addDaysIL, partsIL } from './tz.js';

const MIN = 6e4;
const baseOf = (id) => id.replace(/^r\d+-/, '');
const itemsOf = (id, prefix) => PROCESSES.find((p) => p.id === id).items.filter((i) => i.key.startsWith(prefix)).map((i) => i.key);
const json = (note) => { try { const v = JSON.parse(note); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const real = (c) => !!c && c.state === 'done' && c.note !== IMPORT_NOTE;

// ── Quality control (processes 23 and 25) ────
// What Ofir checks, what marks the work ready for him, and his approval.
export const QA_KINDS = {
  videos: {
    kind: 'videos', base: 'p25', proc: 'p25', ready: 'p24.notify', approved: 'p25.approved', checks: itemsOf('p25', 'p25.q.'),
    unit: 'סרטון', units: 'סרטונים', title: 'סרטונים', fixer: (ctx) => ctx?.editor || 'editor',
  },
  graphics: {
    kind: 'graphics', base: 'p23', proc: 'p23', ready: 'p23.made', approved: 'p23.ofir', checks: itemsOf('p23', 'p23.q.'),
    unit: 'גרפיקה', units: 'גרפיקות', title: 'יתרת הגרפיקות', fixer: () => 'ilai',
  },
};
export const kindOfProc = (procId) => ({ p25: 'videos', p23: 'graphics' })[baseOf(procId)] || null;

export const returnKey = (pre, kind, n) => `${pre}${QA_KINDS[kind].base}.return.${n}`;
export const fixedKey = (pre, kind, n) => `${pre}${QA_KINDS[kind].base}.fixed.${n}`;
export const fixedItemKey = (pre, kind, n, i) => `${fixedKey(pre, kind, n)}.${i}`;
export const QA_MARK = /^(?:r\d+\.)?p2[35]\.(?:return|fixed)\.\d+(?:\.\d+)?$/;

// Limits that keep a return inside one check's note.
export const ISSUE_MAX = 30;
export const ISSUE_TEXT_MAX = 200;
export const ISSUE_REF_MAX = 20;
export function returnNote(issues, due) {
  const list = (issues || [])
    .map((x) => ({ ref: String(x.ref ?? '').trim().slice(0, ISSUE_REF_MAX), text: String(x.text ?? '').trim().slice(0, ISSUE_TEXT_MAX) }))
    .filter((x) => x.text)
    .slice(0, ISSUE_MAX);
  return JSON.stringify({ v: 1, issues: list, due: due ? new Date(due).toISOString() : null });
}
export function readReturn(check) {
  if (!check || check.state !== 'done') return null;
  const v = json(check.note) || {};
  const issues = Array.isArray(v.issues) ? v.issues.filter((x) => x && x.text).map((x) => ({ ref: String(x.ref || ''), text: String(x.text) })) : [];
  return { at: new Date(check.at), by: check.by_email || null, issues, due: parseDate(v.due) };
}

// Every return of one piece of work, in order: { n, at, by, issues, due, fixedAt,
// fixed (the issues marked fixed, by index), open }. Rounds are consecutive.
export function qaRounds(checks, pre, kind) {
  const k = QA_KINDS[kind];
  const ready = checks[`${pre}${k.ready}`];
  const readyAt = real(ready) ? new Date(ready.at) : null;
  const out = [];
  for (let n = 1; n < 100; n += 1) {
    const r = readReturn(checks[returnKey(pre, kind, n)]);
    if (!r) break;
    const fx = checks[fixedKey(pre, kind, n)];
    let fixedAt = fx?.state === 'done' ? new Date(fx.at) : null;
    // Marked ready again after the return (the editor's "מוכן לבדיקה"): fixed too.
    if (!fixedAt && readyAt && readyAt > r.at) fixedAt = readyAt;
    const fixed = new Set(r.issues.map((_, i) => i).filter((i) => checks[fixedItemKey(pre, kind, n, i)]?.state === 'done'));
    out.push({ n, ...r, fixedAt, fixed });
  }
  for (const r of out) r.open = !r.fixedAt;
  return out;
}

// Where one piece of work stands with Ofir:
//   stage 'none' (not ready yet), 'ofir' (waiting for his check since readyAt),
//   'fixing' (returned, round `open`), 'approved'.
//   round: the number of this check (1 the first time, 2 after one return, …).
export function qaState(checks, pre, kind) {
  const k = QA_KINDS[kind];
  const rounds = qaRounds(checks, pre, kind);
  const last = rounds.at(-1) || null;
  const ready = checks[`${pre}${k.ready}`];
  let readyAt = real(ready) ? new Date(ready.at) : null;
  for (const r of rounds) if (r.fixedAt && (!readyAt || r.fixedAt > readyAt)) readyAt = r.fixedAt;
  const ap = checks[`${pre}${k.approved}`];
  const base = { kind, pre, rounds, returns: rounds.length, open: null, readyAt: null, round: rounds.length + 1 };
  if (ap && (ap.state === 'done' || ap.state === 'na')) return { ...base, stage: 'approved', approvedAt: new Date(ap.at) };
  if (last?.open) return { ...base, stage: 'fixing', open: last, round: rounds.length };
  if (readyAt && (!last || readyAt > last.at)) return { ...base, stage: 'ofir', readyAt };
  return { ...base, stage: 'none' };
}

// Decisions 17 and 18: notes given by 13:00 are fixed the same day; later ones by
// the end of the next business day (the office's close, 13:00 on erev chag).
export const FIX_CUTOFF_HOUR = 13;
const closeOf = (d) => atTimeIL(d, erevOn(d) ? WORK_HOURS.erevEnd : WORK_HOURS.end);
export function fixDue(now = new Date()) {
  if (isBusinessDay(now) && partsIL(now).hour < FIX_CUTOFF_HOUR && now < closeOf(now)) return closeOf(now);
  let x = atTimeIL(now, 12);
  do x = addDaysIL(x, 1); while (!isBusinessDay(x));
  return closeOf(x);
}

// ── Ofir's quality clock (decision 11) ───────
// His characterization meetings, [start, end] in ms: from the meeting until he
// marked it done (MEETING_DONE_KEYS), at most 4 hours; not marked, two hours. His
// one-hour clock stops meanwhile. public.ofir_meetings() in the database
// (20260930150000_office_flows.sql) answers the same for those who do not see his
// clients (the editors). "האפיון הסתיים" (decision 12), when it has its own mark,
// belongs first in MEETING_DONE_KEYS (and in that function).
export const MEETING_DONE_KEYS = ['p04.saved'];
export const MEETING_HOURS = 2;
export const MEETING_MAX_HOURS = 4;
export function ofirMeetings(clients, checksOf) {
  const out = [];
  for (const c of clients) {
    const at = parseDate(c.char_at);
    if (!at || (c.characterizer && c.characterizer !== 'ofir')) continue;
    const cs = checksOf(c) || {};
    const done = MEETING_DONE_KEYS.map((k) => cs[k]).filter((x) => x?.state === 'done').map((x) => new Date(x.at)).filter((d) => d > at);
    const end = done.length ? new Date(Math.min(...done, at.getTime() + MEETING_MAX_HOURS * 36e5)) : new Date(at.getTime() + MEETING_HOURS * 36e5);
    out.push([at.getTime(), end.getTime()]);
  }
  return out;
}
// Office time inside meetings between two moments, in ms.
function meetingMs(meetings, from, to) {
  let extra = 0;
  for (const [a, b] of meetings || []) {
    const s = Math.max(a, +from);
    const e = Math.min(b, +to);
    if (e > s) extra += officeMsBetween(new Date(s), new Date(e));
  }
  return extra;
}
// When `minutes` of Ofir's office time from `from` run out, not counting his meetings.
export function qaDue(meetings, from, minutes = 60) {
  let due = addWorkingMinutes(from, minutes);
  for (let n = 0; n < 10; n += 1) {
    const next = addWorkingMinutes(from, minutes + Math.round(meetingMs(meetings, from, due) / MIN));
    if (next.getTime() === due.getTime()) break;
    due = next;
  }
  return due;
}
// Office minutes the work has waited for him, without his meetings.
export const qaWaited = (meetings, from, now = new Date()) => Math.max(0, Math.round((officeMsBetween(from, now) - meetingMs(meetings, from, now)) / MIN));
// The meeting Ofir is in right now, or null.
export function meetingNow(meetings, now = new Date()) {
  const m = (meetings || []).find(([a, b]) => +now >= a && +now < b);
  return m ? { from: new Date(m[0]), to: new Date(m[1]) } : null;
}

// ── Editing deadlines moved by Lior; his decision on paused editing ──
export const SHIFT_KEY = (pre = '') => SHIFT(`${pre}p22a`);
export const shiftNote = (days, why = '') => JSON.stringify({ days, why: String(why || '').slice(0, 300) });
export const readShift = (check) => (check?.state === 'done' ? Number(json(check.note)?.days) || 0 : 0);
export const DECISION_KEY = (pre = '') => `${pre}p22.decision`;
export const REASON_KEY = (pre = '') => `${pre}p22a.reason`;
export const readJson = (check) => (check?.state === 'done' ? json(check.note) : null);

// ── Broken logins closed by Lior (process 6) ──
export const ACCESS_FIXED = /^p06\.fixed\.([a-z]+)$/;
export const accessFixedKey = (network) => `p06.fixed.${network}`;
export const accessFixNote = ({ partial = false, missing = '', access = null }) => JSON.stringify({ partial: !!partial, missing: String(missing || '').trim().slice(0, 500), access });
export function readAccessFix(check) {
  if (!check || check.state !== 'done') return null;
  const v = json(check.note) || {};
  return { partial: !!v.partial, missing: v.missing || '', access: v.access || null, at: new Date(check.at) };
}

// ── The history line of a mark, in words (client card) ──
const nameOf = (p) => PEOPLE[p]?.name || p || '';
export function describeOfficeMark(key, action, note) {
  const clear = action === 'clear';
  let m = /^(p2[35])\.(return|fixed)\.(\d+)(?:\.(\d+))?$/.exec(key);
  if (m) {
    const what = m[1] === 'p25' ? 'הסרטונים' : 'יתרת הגרפיקות';
    if (m[2] === 'return') {
      if (clear) return `ביטל/ה את ההחזרה לתיקון (${what}, סבב ${m[3]})`;
      const v = json(note);
      const n = Array.isArray(v?.issues) ? v.issues.length : 0;
      return `החזיר/ה לתיקון את ${what}: סבב ${m[3]}${n ? `, ${n === 1 ? 'בעיה אחת' : `${n} בעיות`}` : ''}`;
    }
    if (m[4] !== undefined) return clear ? `ביטל/ה סימון תיקון (${what}, סבב ${m[3]})` : `סימן/ה תיקון (${what}, סבב ${m[3]}, שורה ${Number(m[4]) + 1})`;
    return clear ? `ביטל/ה ״התיקונים מוכנים״ (${what}, סבב ${m[3]})` : `התיקונים מוכנים וחזרו לבדיקה של אופיר (${what}, סבב ${m[3]})`;
  }
  if (key === 'p22a.reason') {
    const v = json(note);
    return clear ? 'ביטל/ה את סיבת השיוך' : `נימק/ה את בחירת העורך${v?.editor ? ` (${nameOf(v.editor)})` : ''}: ${v?.reason || ''}`;
  }
  if (key === 'p22a.shift') return clear ? 'ביטל/ה את הזזת מועדי העריכה' : `הזיז/ה את מועדי העריכה ב־${readShift({ state: 'done', note })} ימי עסקים`;
  if (key === 'p22.decision') {
    const v = json(note) || {};
    if (clear) return 'ביטל/ה את ההחלטה על העריכה העצורה';
    return v.choice === 'reassign' ? `החליט/ה להעביר את העריכה ל${nameOf(v.editor)}` : `החליט/ה להזיז את מועדי העריכה ב־${v.days || 0} ימי עסקים`;
  }
  m = ACCESS_FIXED.exec(key);
  if (m) {
    const v = readAccessFix({ state: 'done', note, at: 0 });
    if (clear) return `ביטל/ה את סגירת הגישה (${m[1]})`;
    return v.partial ? `סגר/ה גישה שבורה כתוקנה חלקית (${m[1]}). עדיין חסר: ${v.missing}` : `סגר/ה גישה שבורה כתוקנה (${m[1]})`;
  }
  return null;
}
