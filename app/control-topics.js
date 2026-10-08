// Irit's daily control (process 32; her protocol, step 19): the eleven things she
// goes over every working day, each as a list of what is open right now, "so that no
// task or client is left without follow-up". The control tab (app/clients.js) shows
// one row per topic with its count, and the items one tap away.
// Pure, no DOM, Israel time. Everything is computed from what the tab already loads:
// the clients with their marks and states, the open tasks, each person's work, and
// (for Irit and the owners, who may read them) Stav's deals.
import { REVIEW_TOPICS, PEOPLE } from './protocol.js';
import { businessDaysBetween, addBusinessDays, parseDate, IMPORT_NOTE, inLanding, workFloor } from './protocol-logic.js';
import { dayKeyIL, daysBetweenIL } from './tz.js';
import { dealUrl, dealDue } from './deal-logic.js';
import { unsignedList, UNSIGNED_URL } from './unsigned-logic.js';

// The protocol's order (docs/protocols/irit.md, step 19). The words come from
// REVIEW_TOPICS.p32 (app/protocol.js), so a wording change there shows here too.
export const TOPIC_KEYS = ['contracts', 'signatures', 'groups', 'intro', 'chars', 'shoots', 'tasks', 'approvals', 'fixes', 'staff', 'back'];
const FALLBACK = ['חוזים', 'חתימות', 'קבוצות WhatsApp', 'הודעות פתיחה', 'פגישות אפיון', 'ימי צילום', 'משימות פתוחות', 'אישורי לקוחות', 'תיקונים', 'עובדים שטרם סיימו משימות', 'לקוחות שצריך לחזור אליהם'];
export const topicLabel = (key) => { const i = TOPIC_KEYS.indexOf(key); return (REVIEW_TOPICS.p32 || [])[i] || FALLBACK[i] || key; };

export const SHOOT_DAYS_AHEAD = 7;  // "ימי צילום": the shoot days of the coming week
export const WAIT_LATE_DAYS = 2;    // with the client for more than this many business days: flagged
const CLIENT_FIX = 'client_fix';    // app/status-rules.js: the client asked for a fix on the status page

// A client in landing is in no topic: nothing of it is asked for until it is activated.
const inWork = (c) => (c.status === 'active' || c.status === 'ending') && !inLanding(c);
// Topics whose lateness is counted in days from a raw mark (not from a process's deadline).
const FROM_MARK = new Set(['signatures', 'approvals', 'back']);
const isDone = (cs, k) => cs[k]?.state === 'done';
const isResolved = (cs, k) => cs[k]?.state === 'done' || cs[k]?.state === 'na';
const atOf = (cs, k) => (cs[k]?.at ? new Date(cs[k].at) : null);
const baseId = (id) => id.replace(/^r\d+-/, '');
const preOf = (proc) => proc.keyBase.slice(0, proc.keyBase.length - baseId(proc.id).length);
const roundOf = (proc) => /^r(\d+)-/.exec(proc.id)?.[1] || null;
const roundText = (proc) => (roundOf(proc) ? ` · סבב ${roundOf(proc)}` : '');
const nameOf = (k) => PEOPLE[k]?.name || '';

// "היום", "מאתמול", "3 ימי עסקים": how long something has been open.
export function ageText(since, now = new Date()) {
  if (!since) return '';
  const days = daysBetweenIL(since, now);
  if (days <= 0) return 'מהיום';
  if (days === 1) return 'מאתמול';
  const n = businessDaysBetween(since, now);
  return n <= 1 ? 'יום עסקים אחד' : `${n} ימי עסקים`;
}

const oldestFirst = (a, b) => (b.late - a.late) || ((a.since?.getTime() ?? Infinity) - (b.since?.getTime() ?? Infinity));
const soonestFirst = (a, b) => ((a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity)) || oldestFirst(a, b);

// One item: { id, client (or null), title (a deal's business; null: the client's label),
// text, hash (the place in the client card) or href (another page), since, when (a
// meeting or shoot to come), late, info (to know about, nothing is missing), person }.
const item = (o) => ({ client: null, title: null, hash: '', href: null, since: null, when: null, late: false, info: false, person: null, ...o });

// ── 1, 2: contracts and signatures ──────────
// Before the client signs there is no client yet: the contract lives in Stav's deal
// (public.deal_requests). A client opened by hand has process 1 in its card.
function contracts({ live, cs, st, deals, now }) {
  const out = [];
  for (const d of deals || []) {
    if (d.status === 'pending') out.push(item({ id: `deal:${d.id}`, title: d.business_name, text: 'עסקה מהשטח: להכין חוזה', href: dealUrl(d), since: parseDate(d.created_at), late: !!dealDue(d) && dealDue(d) < now }));
    if (d.status === 'approval') out.push(item({ id: `deal:${d.id}`, title: d.business_name, text: 'חוזה חריג: ממתין לאישור מנהל', href: 'quotes.html', since: parseDate(d.created_at) }));
    if (d.status === 'rejected') out.push(item({ id: `deal:${d.id}`, title: d.business_name, text: 'החוזה לא אושר: לתקן ולשלוח מחדש', href: 'quotes.html', since: parseDate(d.created_at), late: true }));
  }
  for (const c of live) {
    const s = st(c).find((x) => x.proc.id === 'p01');
    if (!s || s.complete || !s.ready) continue;
    const k = cs(c);
    if (!isResolved(k, 'p01.prepared')) out.push(item({ id: `${c.id}:p01`, client: c, text: 'החוזה לא הוכן', hash: 'p01', since: parseDate(c.deal_at), late: s.status === 'overdue' }));
    else if (!isResolved(k, 'p01.sent')) out.push(item({ id: `${c.id}:p01`, client: c, text: 'החוזה הוכן ולא נשלח', hash: 'p01', since: atOf(k, 'p01.prepared') || parseDate(c.deal_at), late: s.status === 'overdue' }));
  }
  return out.sort(oldestFirst);
}
function signatures({ live, cs, st, deals, unsigned, now }) {
  const out = [];
  const late = (since) => !!since && businessDaysBetween(since, now) > WAIT_LATE_DAYS;
  const ofDeal = new Set();
  for (const d of deals || []) {
    if (d.status !== 'sent' || d.signed_at) continue;
    if (d.quote_id) ofDeal.add(d.quote_id);
    const since = parseDate(d.sent_at) || parseDate(d.created_at);
    out.push(item({ id: `deal:${d.id}`, title: d.business_name, text: 'החוזה נשלח ולא נחתם', href: 'quotes.html', since, late: late(since) }));
  }
  // A contract built directly, with no field deal behind it (app/unsigned-logic.js; section 47).
  for (const u of unsignedList(unsigned || [], now)) {
    if (ofDeal.has(u.quote.id)) continue;
    out.push(item({ id: `quote:${u.quote.id}`, title: u.name, text: 'ההסכם נשלח ולא נחתם', href: UNSIGNED_URL, since: u.since, late: late(u.since) }));
  }
  for (const c of live) {
    const s = st(c).find((x) => x.proc.id === 'p01');
    const k = cs(c);
    if (!s || s.complete || !isDone(k, 'p01.sent') || isResolved(k, 'p01.signed')) continue;
    const since = atOf(k, 'p01.sent');
    out.push(item({ id: `${c.id}:p01`, client: c, text: 'החוזה נשלח ולא נחתם', hash: 'p01', since, late: late(since) }));
  }
  return out.sort(oldestFirst);
}

// ── 3, 4: the WhatsApp group and the intro message ──
function groups({ live, cs, st }) {
  const out = [];
  for (const c of live) {
    const s = st(c).find((x) => x.proc.id === 'p02');
    if (!s || !s.ready || isResolved(cs(c), 'p02.opened')) continue;
    out.push(item({ id: `${c.id}:p02`, client: c, text: 'הקבוצה לא נפתחה', hash: 'p02', since: parseDate(c.deal_at), late: s.status === 'overdue' }));
  }
  return out.sort(oldestFirst);
}
// A client with no group yet is in "קבוצות": the message waits for the group.
function intro({ live, cs, st }) {
  const out = [];
  for (const c of live) {
    const s = st(c).find((x) => x.proc.id === 'p02');
    const k = cs(c);
    if (!s || !isDone(k, 'p02.opened') || isResolved(k, 'p02.intro')) continue;
    out.push(item({ id: `${c.id}:p02`, client: c, text: 'לא נשלחה הודעת היכרות', hash: 'p02', since: atOf(k, 'p02.opened'), late: s.status === 'overdue' }));
  }
  return out.sort(oldestFirst);
}

// ── 5: characterization meetings ────────────
// Today's and the next business day's meetings (to know about), a client with no
// meeting set, and a meeting that passed without the characterization being saved.
function chars({ live, cs, st, now }) {
  const out = [];
  const today = dayKeyIL(now);
  const horizon = dayKeyIL(addBusinessDays(now, 1));
  for (const c of live) {
    const states = st(c);
    const p4 = states.find((x) => x.proc.id === 'p04');
    if (!p4 || p4.complete || isResolved(cs(c), 'p04.saved')) continue;
    const p3 = states.find((x) => x.proc.id === 'p03');
    const at = parseDate(c.char_at);
    const who = nameOf(c.characterizer || 'ofir');
    if (!at) {
      if (p3 && !p3.ready) continue;
      out.push(item({ id: `${c.id}:p03`, client: c, text: 'לא נקבעה פגישת אפיון', hash: 'p03', since: parseDate(c.deal_at), late: p3?.status === 'overdue' }));
    } else if (dayKeyIL(at) < today) {
      // A meeting from before the client was activated: late only once its fresh deadline passed.
      const before = workFloor(c) && at < workFloor(c);
      out.push(item({ id: `${c.id}:p04`, client: c, text: `הפגישה עברה והאפיון לא נשמר${who ? ` · ${who}` : ''}`, hash: 'p04', since: at, late: before ? p4.status === 'overdue' : true }));
    } else if (dayKeyIL(at) <= horizon) {
      out.push(item({ id: `${c.id}:p04`, client: c, text: `פגישת אפיון${who ? ` · ${who}` : ''}`, hash: 'p04', when: at, info: true }));
    }
  }
  return out.sort(soonestFirst);
}

// ── 6: shoot days ───────────────────────────
// The shoot days of the coming week (the client's and each extra round's), and a
// client whose shoot day should have been set by now (process 11).
function shoots({ live, st, now }) {
  const out = [];
  for (const c of live) {
    for (const s of st(c)) {
      if (baseId(s.proc.id) !== 'p11') continue;
      const ctx = s.proc.ctx || c;
      const at = parseDate(ctx.shoot_at);
      if (at) {
        const days = daysBetweenIL(now, at);
        if (days < 0 || days > SHOOT_DAYS_AHEAD) continue;
        out.push(item({
          id: `${c.id}:${s.proc.id}`, client: c, hash: s.proc.id, when: at, info: s.complete,
          text: `יום צילום${roundText(s.proc)}${s.complete ? '' : ' · עוד לא סגור מול כולם'}`, late: !s.complete && s.status === 'overdue',
        }));
      } else if (s.ready && !s.complete) {
        out.push(item({ id: `${c.id}:${s.proc.id}`, client: c, hash: s.proc.id, text: `לא נקבע יום צילום${roundText(s.proc)}`, since: s.startAt || null, late: s.status === 'overdue' }));
      }
    }
  }
  return out.sort(soonestFirst);
}

// ── 7: open tasks ───────────────────────────
function openTasks({ live, tasks, now }) {
  const byId = new Map(live.map((c) => [c.id, c]));
  const today = dayKeyIL(now);
  return (tasks || []).filter((t) => !t.done_at && byId.has(t.client_id)).map((t) => item({
    id: `task:${t.id}`, client: byId.get(t.client_id), hash: 'tasks', person: t.owner, since: parseDate(t.created_at),
    text: `${t.title}${nameOf(t.owner) ? ` · ${nameOf(t.owner)}` : ''}${t.due_on ? '' : ' · בלי מועד'}`, due: t.due_on || null, late: !!t.due_on && t.due_on < today,
  })).sort((a, b) => (b.late - a.late) || ((a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : 0));
}

// ── 8: client approvals ─────────────────────
// What was sent to the client and is not approved yet: [process, the "sent" mark,
// the approval, what it is]. Once the client's notes on the videos arrived it is a
// correction (topic 9), not an approval we wait for.
const APPROVALS = [
  ['p07', 'p07.sent', 'p07.approved', '9 הגרפיקות הראשונות'],
  ['p13', 'p13.zoom', 'p13.approved', 'התסריטים'],
  ['p23', 'p23.sent', 'p23.approved', 'יתרת הגרפיקות'],
  ['p27', 'p26.sent', 'p27.approved', 'הסרטונים'],
];
function approvals({ live, cs, st, now }) {
  const out = [];
  for (const c of live) {
    const k = cs(c);
    for (const s of st(c)) {
      const row = APPROVALS.find((a) => a[0] === baseId(s.proc.id));
      if (!row) continue;
      const pre = preOf(s.proc);
      if (!isDone(k, pre + row[1]) || isResolved(k, pre + row[2])) continue;
      // History brought in with an imported client is not something that was sent now.
      if (k[pre + row[1]].note === IMPORT_NOTE) continue;
      if (row[0] === 'p27' && (isDone(k, `${pre}p27.notes`) || isResolved(k, `${pre}p27.final`))) continue;
      if (row[0] === 'p23' && isResolved(k, 'p23b.posted')) continue;
      const since = atOf(k, pre + row[1]);
      out.push(item({
        id: `${c.id}:${s.proc.id}`, client: c, hash: s.proc.id, since, text: `${row[3]}${roundText(s.proc)}: ממתין לאישור הלקוח`,
        late: !!since && businessDaysBetween(since, now) > WAIT_LATE_DAYS,
      }));
    }
  }
  return out.sort(oldestFirst);
}

// ── 9: corrections the client asked for ─────
// A fix the client asked for on the status page (a task with source 'client_fix'),
// and the client's notes on the videos while the editor has not closed them.
function fixes({ live, cs, st, tasks, now }) {
  const out = [];
  const byId = new Map(live.map((c) => [c.id, c]));
  const today = dayKeyIL(now);
  const fixTasks = (tasks || []).filter((t) => t.source === CLIENT_FIX && !t.done_at && byId.has(t.client_id));
  for (const t of fixTasks) {
    out.push(item({
      id: `task:${t.id}`, client: byId.get(t.client_id), hash: 'tasks', person: t.owner, since: parseDate(t.created_at),
      text: `${t.title}${nameOf(t.owner) ? ` · ${nameOf(t.owner)}` : ''}`, late: !!t.due_on && t.due_on < today,
    }));
  }
  for (const c of live) {
    const k = cs(c);
    // The status page marks the notes and opens the task together: one row, not two.
    if (fixTasks.some((t) => t.client_id === c.id && t.brief?.notes_marked)) continue;
    for (const s of st(c)) {
      if (baseId(s.proc.id) !== 'p27' || s.complete) continue;
      const pre = preOf(s.proc);
      if (!isDone(k, `${pre}p27.notes`) || isResolved(k, `${pre}p27.fixes`) || isResolved(k, `${pre}p27.approved`) || isResolved(k, `${pre}p27.final`)) continue;
      const editor = nameOf((s.proc.ctx || c).editor);
      out.push(item({
        id: `${c.id}:${s.proc.id}`, client: c, hash: s.proc.id, since: atOf(k, `${pre}p27.notes`), late: s.status === 'overdue',
        text: `תיקוני הלקוח בסרטונים${roundText(s.proc)}${editor ? ` · ${editor}` : ''}`,
      }));
    }
  }
  return out.sort(oldestFirst);
}

// ── 10: employees who have not finished ─────
// work: [{ key, late, urgent, today, open }] (the control's table "לפי עובד").
function staff({ work }) {
  return (work || []).filter((w) => w.late > 0 || w.urgent > 0).map((w) => item({
    id: `person:${w.key}`, title: nameOf(w.key) || w.key, person: w.key, late: w.late > 0,
    text: [w.late ? `באיחור ${w.late}` : null, w.urgent ? `דחוף ${w.urgent}` : null, `פתוחים ${w.open}`].filter(Boolean).join(' · '), n: w.late,
  })).sort((a, b) => b.n - a.n);
}

// ── 11: clients to get back to ──────────────
// A client we wait for (a process marked "ממתין ללקוח"): one row per client, the
// ones whose recheck date arrived first.
function back({ live, st, now }) {
  const out = [];
  const today = dayKeyIL(now);
  for (const c of live) {
    const waits = st(c).filter((s) => s.status === 'client' && s.wait);
    if (!waits.length) continue;
    const since = waits.map((s) => new Date(s.wait.at)).sort((a, b) => a - b)[0];
    const recheck = waits.some((s) => s.wait.recheck && s.wait.recheck <= today);
    const reason = waits.find((s) => s.wait.reason)?.wait.reason || '';
    out.push(item({
      id: `${c.id}:wait`, client: c, hash: waits[0].proc.id, since, recheck,
      late: recheck || businessDaysBetween(since, now) > WAIT_LATE_DAYS,
      text: [recheck ? 'הגיע מועד הבדיקה' : null, waits.length === 1 ? `ממתין ללקוח: ${waits[0].proc.title}` : `ממתין ללקוח ב־${waits.length} תהליכים`, reason ? `״${reason}״` : null].filter(Boolean).join(' · '),
    }));
  }
  return out.sort((a, b) => (b.recheck - a.recheck) || oldestFirst(a, b));
}

const BUILD = { contracts, signatures, groups, intro, chars, shoots, tasks: openTasks, approvals, fixes, staff, back };

// The eleven topics in the protocol's order: [{ key, label, items, count, late }].
//   clients, checks (by client id), stateOf(client) -> clientState, tasks (open),
//   deals (Stav's deals, or null when this viewer may not read them), unsigned (the
//   quotes still out for signature, or null likewise), work (per person).
export function controlTopics({ clients = [], checks = {}, stateOf, tasks = [], deals = null, unsigned = null, work = [], now = new Date() }) {
  const live = clients.filter(inWork);
  const env = { live, cs: (c) => checks[c.id] || {}, st: (c) => stateOf(c).states, tasks, deals, unsigned, work, now };
  return TOPIC_KEYS.map((key) => {
    // An activated client's work is counted from its activation, never from months before it.
    const items = BUILD[key](env).map((x) => {
      const floor = x.client && workFloor(x.client);
      if (!floor || !x.since || x.since >= floor) return x;
      return { ...x, since: floor, late: FROM_MARK.has(key) ? !!x.recheck || businessDaysBetween(floor, now) > WAIT_LATE_DAYS : x.late };
    });
    return { key, label: topicLabel(key), items, count: items.length, late: items.filter((x) => x.late).length };
  });
}

// ── "הבקרה היומית בוצעה" ───────────────────
// The lightest honest rule: the day is closed with one tick, and the tick says how
// many topics with something in them she has not opened today. `seen`: topic keys.
export function unseenTopics(topics, seen = []) {
  const s = new Set(seen);
  return topics.filter((t) => t.count > 0 && !s.has(t.key));
}
// What the review record keeps of the tick (office_reviews.note, JSON): how many
// items each topic had (only the ones that had any), and which were not opened.
export function topicsRecord(topics, seen = []) {
  const open = Object.fromEntries(topics.filter((t) => t.count > 0).map((t) => [t.key, t.count]));
  return { open, unseen: unseenTopics(topics, seen).map((t) => t.key) };
}
// "חוזים 2 · תיקונים 1", for the line under a marked review.
export function recordText(record) {
  const open = record?.open || {};
  return TOPIC_KEYS.filter((k) => open[k]).map((k) => `${topicLabel(k)} ${open[k]}`).join(' · ');
}
