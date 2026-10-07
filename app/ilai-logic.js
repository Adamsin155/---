// Ilai's part of "המשימות שלי" (system-plan section 3, "עילאי"): when a
// characterization ends, the card "יום אפיון: שעתיים" with one line per client
// showing only the nearest due, and inside it the access check (30 minutes; the
// statuses in the vault mark it), the page setup (6 quick checks; pasting the
// Metricool link marks "Metricool מחובר"), the first 9 graphics (2 hours), the
// Gantt skeleton and a new logo when there is none. Also his "מוכן לבדיקה" routing
// (the first 9 to Irit, the rest to Ofir), "הגאנט מלא" and "קיבלתי" on the
// editor's final versions. Pure, no DOM, Israel time.
import { PROCESSES } from './protocol.js';
import { IMPORT_NOTE } from './protocol-logic.js';
import { qaState } from './office-marks.js';
import { NEW_STATUS, byClient } from './access-logic.js';

export const PAGE_KEYS = ['p06.name', 'p06.bio', 'p06.details', 'p06.phone', 'p06.address', 'p06.look'];
export const PAGE_LABELS = { 'p06.name': 'שם העמוד', 'p06.bio': 'Bio', 'p06.details': 'פרטי עסק', 'p06.phone': 'טלפון', 'p06.address': 'כתובת', 'p06.look': 'מראה העמוד' };
export const GANTT_KEYS = PROCESSES.find((p) => p.id === 'p09').items.map((i) => i.key);
export const AUTO_ACCESS_NOTE = 'נסגר לבד: כל הרשתות בכספת קיבלו סטטוס';
const done = (cs, k) => ['done', 'na'].includes(cs[k]?.state);
const inWork = (c) => c.status === 'active' || c.status === 'ending';

// Whether every login in the vault has a status set after the access came in
// (תקינה, לא עובדת, אין רשת): that is the check of process 6. A login the client's
// own form put there ('new': received, not checked yet), or any status the form set
// that nobody of the office saved since, is not a check: someone still has to try it.
export function accessChecked(rows, accessAt) {
  if (!accessAt || !rows?.length) return false;
  return rows.every((a) => a.status && a.status !== NEW_STATUS && !byClient(a) && new Date(a.updated_at) >= new Date(accessAt));
}
// The logins that came from the client and wait for the check.
export const toCheck = (rows) => (rows || []).filter((a) => a.status === NEW_STATUS);

// The day's lines of one client, each with its due (null when it has none) and done.
function lines(c, st, cs, access) {
  const by = new Map(st.states.map((s) => [s.proc.id, s]));
  const p05 = by.get('p05');
  const p06 = by.get('p06');
  const p07 = by.get('p07');
  const p09 = by.get('p09');
  const accessAt = cs['p05.access']?.state === 'done' ? new Date(cs['p05.access'].at) : null;
  const out = [
    { key: 'access', title: 'בדיקת גישות', due: p06?.dueAt || null, done: done(cs, 'p06.verified'), waiting: !accessAt, auto: accessChecked(access, accessAt) },
    { key: 'page', title: 'סידור העמוד', due: p06?.dueAt || null, done: PAGE_KEYS.every((k) => done(cs, k)) && done(cs, 'p06.metricool'), count: PAGE_KEYS.filter((k) => done(cs, k)).length },
    { key: 'graphics', title: '9 גרפיקות', due: p07?.dueAt || null, done: done(cs, 'p07.made') },
    { key: 'gantt', title: 'שלד גאנט', due: p09?.dueAt || null, done: !!p09?.complete },
  ];
  if (c.has_logo === false && p05?.proc.items.some((i) => i.key === 'p05.newlogo')) {
    out.push({ key: 'logo', title: 'לוגו חדש', due: p07?.dueAt || null, done: done(cs, 'p05.newlogo') });
  }
  return out;
}

// The card: clients whose characterization ended in the last day (process 4 done
// now, not by an import) and that still have something of Ilai's day open; what
// is still open a day later is in his list as late. Each: { client, endAt, lines,
// next (the nearest open line with a due) }.
export const CARD_HOURS = 24;
export function charDay({ clients, stateOf, checks, access = {}, now = new Date() }) {
  const out = [];
  for (const c of clients) {
    if (!inWork(c)) continue;
    const st = stateOf(c);
    const cs = checks[c.id] || {};
    const p4 = st.states.find((s) => s.proc.id === 'p04');
    if (!p4?.complete || !p4.completedAt || p4.proc.items.some((i) => cs[i.key]?.note === IMPORT_NOTE)) continue;
    if (now - p4.completedAt > CARD_HOURS * 36e5) continue;
    const ls = lines(c, st, cs, access[c.id] || []);
    const open = ls.filter((l) => !l.done);
    if (!open.length) continue;
    const next = open.filter((l) => l.due).sort((a, b) => a.due - b.due)[0] || open[0];
    out.push({ client: c, endAt: p4.completedAt, lines: ls, next });
  }
  return out.sort((a, b) => (a.next.due || Infinity) - (b.next.due || Infinity));
}

// After the characterization day: the first 9 graphics when they are still open
// (`first`: the day's card is gone after 24 hours, the upload and its lock stay), the
// rest of the graphics (ready for Ofir, or returned with fixes), the final versions
// to receive ("קיבלתי"), and the Gantt to fill ("הגאנט מלא", which tells Irit by itself).
export function ilaiWork({ clients, stateOf, checks, now = new Date() }) {
  const day = new Set(charDay({ clients, stateOf, checks, now }).map((x) => x.client.id));
  const first = [];
  const rest = [];
  const finals = [];
  const gantt = [];
  for (const c of clients) {
    if (!inWork(c)) continue;
    const st = stateOf(c);
    const cs = checks[c.id] || {};
    const p07 = st.states.find((s) => s.proc.id === 'p07');
    if (p07 && p07.ready && !done(cs, 'p07.made') && !day.has(c.id)) first.push({ client: c, state: p07 });
    const p23 = st.states.find((s) => s.proc.id === 'p23');
    if (p23 && p23.ready && !p23.complete) {
      const q = qaState(cs, '', 'graphics');
      if (q.stage === 'none' || q.stage === 'fixing') rest.push({ client: c, state: p23, qa: q });
    }
    for (const s of st.states) {
      const base = s.proc.id.replace(/^r\d+-/, '');
      const pre = s.proc.keyBase.slice(0, -base.length);
      if (base === 'p27' && cs[`${pre}p27.final`]?.state === 'done' && !done(cs, `${pre}p27.toilai`)) finals.push({ client: c, state: s, pre, n: s.proc.ctx?.round || null, at: new Date(cs[`${pre}p27.final`].at) });
      if (base === 'p29' && s.ready && !done(cs, `${pre}p29.filled`)) gantt.push({ client: c, state: s, pre, n: s.proc.ctx?.round || null });
    }
  }
  return { first, rest, finals, gantt };
}
