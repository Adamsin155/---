// Ofir's pass over the clients (process 33; system-plan section 3, "מעבר על
// הלקוחות"): at least every other business day, a full pass on Thursday (it counts
// as that day's control). The list is sorted by risk (app/health.js) with what
// changed since the previous pass; action only on the red, yellow, changed and
// stuck clients, one button for all the rest. Under it the data health checks
// (Ofir's protocol, stages 12–14), and the Thursday summary prefilled from the
// system (decision 20: by 13:00). Pure, no DOM, Israel time.
import { STATIONS, PEOPLE, STAFF_PEOPLE } from './protocol.js';
import {
  businessDaysBetween, isBusinessDay, addBusinessDays, weekKey,
} from './protocol-logic.js';
import { dayKeyIL, dayFromKeyIL, weekdayIL, atTimeIL } from './tz.js';
import {
  COLORS, lastActivity, currentStep, awaitedFromClient, personName, procName, THURSDAY_AT,
} from './health.js';

export const PASS_EVERY = 2;       // business days between passes, at most (process 33)
export const STUCK_LATE_DAYS = 2;  // a process late by more than this: stuck
export const STUCK_IDLE_DAYS = 5;  // no activity for this many whole business days: stuck
const COLOR_RANK = { red: 0, yellow: 1, green: 2 };
const isStaff = (k) => STAFF_PEOPLE().some((p) => p.key === k);

// ── Snapshots: what a pass saw ───────────────
// entries: [{ client, health: { color, reasons }, station: { index } }] (app/health.js).
export const snapshotEntry = (e) => ({ c: e.health.color, r: [...new Set(e.health.reasons.map((x) => x.code))].sort(), s: e.station?.index ?? null });
export const snapshotOf = (entries) => Object.fromEntries(entries.map((e) => [e.client.id, snapshotEntry(e)]));

// The reason codes in words, for "נפתר: …".
const CODE_TEXT = {
  late: 'איחור', 'late-soon': 'איחור', 'shoot-risk': 'צילום בסיכון', 'shoot-prep': 'הכנת יום הצילום', 'shoot-moved': 'יום הצילום זז',
  access: 'גישה שבורה', 'escalation-urgent': 'חריגה דחופה', 'escalation-open': 'חריגה פתוחה', escalation: 'חריגה', 'urgent-task': 'משימה דחופה',
  'late-task': 'משימה באיחור', 'score-low': 'ציון לקוח נמוך', 'score-mid': 'ציון לקוח 3', pace: 'פיגור בקצב התוצרים', 'due-soon': 'מועד קרוב שלא התחיל',
  waiting: 'המתנה ללקוח', revision: 'סבב תיקונים', 'no-contact': 'אין מגע עם הלקוח', quiet: 'אין פעילות', stuck: 'תקוע בתחנה', thursday: 'סיכום חמישי',
};

// What changed for one client since the snapshot of the previous pass.
// { isNew, texts: [] } — no previous pass at all: nothing is "changed".
export function changesOf(prev, e, hadPass = true) {
  if (!hadPass) return { isNew: false, texts: [] };
  if (!prev) return { isNew: true, texts: ['לקוח חדש מאז המעבר הקודם'] };
  const now = snapshotEntry(e);
  const texts = [];
  if (prev.c !== now.c) texts.push(`השתנה מ${COLORS[prev.c] || prev.c} ל${COLORS[now.c] || now.c}`);
  const was = new Set(prev.r || []);
  const is = new Set(now.r);
  for (const r of e.health.reasons) if (!was.has(r.code)) { texts.push(`חדש: ${r.text}`); was.add(r.code); }
  for (const code of prev.r || []) if (!is.has(code)) texts.push(`נפתר: ${CODE_TEXT[code] || code}`);
  if (prev.s !== null && prev.s !== undefined && now.s !== null && prev.s !== now.s) texts.push(`עבר לתחנה: ${STATIONS[now.s]?.title || ''}`);
  return { isNew: false, texts };
}

// ── "לקוח תקוע" (Ofir's protocol, stage 11) ──
// Flagged by itself in three cases: a process late by more than 2 business days, no
// activity for 5 business days, or past the recheck date of a wait on the client.
export function stuckOf(client, state, extras = {}, now = new Date()) {
  const out = [];
  const late = state.states.filter((s) => s.status === 'overdue' && s.dueAt && businessDaysBetween(s.dueAt, now) > STUCK_LATE_DAYS);
  if (late.length) out.push({ code: 'late', text: `באיחור של יותר מיומיים: ${late.slice(0, 2).map((s) => procName(s.proc)).join(', ')}${late.length > 2 ? ` ועוד ${late.length - 2}` : ''}` });
  const last = lastActivity(client, extras);
  const idle = last ? businessDaysBetween(last, now) - (isBusinessDay(now) ? 1 : 0) : 0;
  if (idle >= STUCK_IDLE_DAYS) out.push({ code: 'idle', text: `אין פעילות ${idle} ימי עסקים` });
  const today = dayKeyIL(now);
  const past = state.states.filter((s) => s.status === 'client' && s.wait?.recheck && s.wait.recheck < today);
  if (past.length) out.push({ code: 'recheck', text: `עבר מועד הבדיקה החוזרת: ${past.map((s) => procName(s.proc)).join(', ')}` });
  return out;
}

// ── The list ────────────────────────────────
// rows: every client, most at risk first; `attention` when red, yellow, changed
// since the previous pass or stuck (those get "עברתי" or "פתח משימה").
export function passRows(entries, { prev = null, stuck = () => [] } = {}) {
  const hadPass = !!prev;
  const rows = entries.map((e) => {
    const ch = changesOf(prev?.[e.client.id], e, hadPass);
    const st = stuck(e);
    const attention = e.health.color !== 'green' || ch.isNew || ch.texts.length > 0 || st.length > 0;
    return { entry: e, client: e.client, color: e.health.color, reasons: e.health.reasons, changes: ch, stuck: st, attention };
  });
  const score = (r) => [COLOR_RANK[r.color] ?? 3, r.stuck.length ? 0 : 1, r.changes.texts.length ? 0 : 1, -r.reasons.length];
  return rows.sort((a, b) => {
    const x = score(a);
    const y = score(b);
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
    return a.client.name.localeCompare(b.client.name, 'he');
  });
}

// How far this pass got: `seen` is the pass's record { clientId: { how, at } }.
export function passProgress(rows, seen = {}) {
  const attention = rows.filter((r) => r.attention);
  const rest = rows.filter((r) => !r.attention);
  const open = attention.filter((r) => !seen[r.client.id]);
  const restOpen = rest.filter((r) => !seen[r.client.id]);
  return {
    total: rows.length, attention: attention.length, handled: rows.length - open.length - restOpen.length,
    open, restOpen, complete: rows.length > 0 && !open.length && !restOpen.length,
  };
}

// When the pass is due: at least every other business day, and in full on Thursday.
// reviews: office_reviews rows (kind 'p33' marks a pass done that day).
export function passDue(reviews, now = new Date()) {
  const days = (reviews || []).filter((r) => r.kind === 'p33').map((r) => r.day).sort();
  const today = dayKeyIL(now);
  const doneToday = days.includes(today);
  const last = days.filter((d) => d < today).at(-1) || null;
  const gap = last ? businessDaysBetween(dayFromKeyIL(last), now) : null;
  const thursday = weekdayIL(now) === 4 && isBusinessDay(now);
  return { today, last, gap, doneToday, thursday, due: !doneToday && isBusinessDay(now) && (thursday || gap === null || gap >= PASS_EVERY) };
}

// The previous pass's snapshot: the latest completed pass before today.
export function previousPass(passes, now = new Date()) {
  const today = dayKeyIL(now);
  return (passes || []).filter((p) => p.day < today && p.completed_at && p.snapshot).sort((a, b) => (a.day < b.day ? 1 : -1))[0] || null;
}

// ── Data health (Ofir's protocol, stages 12–14) ──
// Each one fixable in one tap: a shared process nobody took (it goes to its
// default owner, decision 7), an open task with no due date (the next business
// day), a shoot waiting for an editor (the assignment).
export function dataHealth({ clients, stateOf, checks, tasks = [], now = new Date() }) {
  const live = clients.filter((c) => c.status === 'active' || c.status === 'ending');
  const byId = new Map(live.map((c) => [c.id, c]));
  const unowned = [];
  const noEditor = [];
  for (const c of live) {
    const cs = checks[c.id] || {};
    for (const s of stateOf(c).states) {
      const base = s.proc.id.replace(/^r\d+-/, '');
      const ctx = s.proc.ctx || c;
      // No editor yet: the assignment is the fix (not taking the process).
      if (base === 'p22a' && s.ready && !s.complete && !ctx.editor) { noEditor.push({ client: c, state: s, n: ctx.round || null }); continue; }
      const owners = s.proc.owners.filter((o) => o !== 'editor');
      if (s.ready && !s.complete && !s.wait && !s.claim && owners.length > 1 && (s.status === 'overdue' || s.status === 'today')) {
        const shared = s.proc.items.filter((i) => !i.optional && i.owners.join() === s.proc.owners.join() && !['done', 'na'].includes(cs[i.key]?.state));
        if (shared.length) unowned.push({ client: c, state: s, owner: owners.find(isStaff) || owners[0], owners });
      }
    }
  }
  const noDue = tasks.filter((t) => !t.done_at && !t.due_on && byId.has(t.client_id)).map((t) => ({ client: byId.get(t.client_id), task: t }));
  return { unowned, noDue, noEditor, total: unowned.length + noDue.length + noEditor.length, dueFix: dayKeyIL(addBusinessDays(now, 1)) };
}

// ── The Thursday summary, prefilled ──────────
// What the system knows: the current state, what is missing, who owns the next
// action and by when (Ofir's protocol, stage 9). He edits and saves.
export function summaryDraft(client, state, station, checks = {}, tasks = [], now = new Date()) {
  const cur = currentStep(client, state, checks, now);
  const late = state.states.filter((s) => s.status === 'overdue');
  const awaited = awaitedFromClient(client, state, checks);
  const open = tasks.filter((t) => t.client_id === client.id && !t.done_at);
  const current = [station?.title, cur ? cur.what : null, station?.paceText || null].filter(Boolean).join(' · ');
  const missing = [
    late.length ? `באיחור: ${late.slice(0, 3).map((s) => procName(s.proc)).join(', ')}${late.length > 3 ? ` ועוד ${late.length - 3}` : ''}` : null,
    awaited.length ? `מהלקוח: ${awaited.slice(0, 3).join(', ')}` : null,
    open.length ? `${open.length === 1 ? 'משימה פתוחה' : `${open.length} משימות פתוחות`}` : null,
  ].filter(Boolean).join(' · ');
  const who = cur && !cur.waiting && isStaff(cur.who) ? cur.who : cur?.waiting ? 'irit' : null;
  const next = !cur ? '' : cur.waiting ? `לקבל מהלקוח: ${awaited[0] || cur.what}` : cur.what;
  const due = cur?.until ? dayKeyIL(cur.until) : cur?.waiting ? dayKeyIL(addBusinessDays(now, 1)) : null;
  return { current: current.slice(0, 1000), missing: missing.slice(0, 1000), next: next.slice(0, 500), owner: who, due_on: due };
}

// Thursday's target (decision 20): the summaries by 13:00. Null on other days.
export function thursdayTarget(now = new Date()) {
  if (weekdayIL(now) !== 4 || !isBusinessDay(now)) return null;
  const at = atTimeIL(now, THURSDAY_AT);
  return { at, week: weekKey(now), late: now >= at };
}

export const ownerName = (k) => (k === 'owner' ? 'הבעלים' : PEOPLE[k]?.name || personName(k));
