// Before the shoot day, Irit's part (docs/plan/system-plan.md, section 3, Irit:
// "מתאם יום צילום", "חוסמי יום צילום", "בדיקת יום לפני", "קליטת בקשת לקוח";
// section 4, stations 3–4; section 5; decision 15). Pure: no DOM and no network.
// The screen (prep.html), the reminder engine (reminder-rules.js, on the server)
// and the unit tests read the same functions, so they never disagree.
//
//   coordinatorOf  process 11: a separate approval for the client, the influencers,
//                  Lior and Eli; the day is "closed" only when all four approved and
//                  it is in the calendar. Natali: the makeup artist and the ride (11ב).
//   shootPrep      process 14: the shoot-day blockers, computed from what the system
//                  knows (late or stuck processes, broken access, missing material,
//                  open urgent or late tasks), by the 8 topics of process 14. Each
//                  gets "עברתי" (seen today: it comes back tomorrow if still there)
//                  or "דווח לליאור" (an exception at once; it stays on her list until
//                  that exception is closed).
//   dayBefore      process 15, Irit's check at 11:15 on the business day before the
//                  shoot (a Sunday shoot: Thursday, decision 15): what the system
//                  knows is filled in; she confirms only the rest; every failed item
//                  goes to Lior at once (an urgent exception).
//   requests       her section 17: a client's request opens a task with an owner and
//                  a due day in one tap; when it is done she gets "לעדכן את הלקוח"
//                  (a database trigger opens it) with a ready message.
import { PEOPLE, NETWORKS } from './protocol.js';
import {
  parseDate, roundsOf, roundContext, isBusinessDay, businessDaysBetween, addBusinessDays, isDaily, inLanding,
} from './protocol-logic.js';
import { dayKeyIL, atTimeIL, addDaysIL, startOfDayIL, daysBetweenIL } from './tz.js';
import { materialsOf, listText, dayText, timeText } from './messages-logic.js';

const clean = (v) => String(v ?? '').trim();
const done = (checks, key) => checks[key]?.state === 'done';
const resolved = (checks, key) => checks[key]?.state === 'done' || checks[key]?.state === 'na';
const live = (c) => c.status === 'active' || c.status === 'ending';
const networkName = (k) => NETWORKS.find(([n]) => n === k)?.[1] || k;

// The shoot of the client and of each extra round: { n, pre ('' or 'r2.'), pid ('' or 'r2-'), ctx }.
export function shootContexts(client) {
  return [
    { n: 1, pre: '', pid: '', ctx: client },
    ...roundsOf(client).map((r) => ({ n: r.n, pre: `r${r.n}.`, pid: `r${r.n}-`, ctx: roundContext(client, r) })),
  ];
}

// "The day before the shoot" is the business day before it (a Sunday shoot: Thursday).
export function eveOf(shoot) {
  let d = atTimeIL(shoot, 12);
  do d = addDaysIL(d, -1); while (!isBusinessDay(d));
  return d;
}
// Irit's day-before check: 11:15 on that day (section 5).
export const checkAt = (shoot) => atTimeIL(eveOf(shoot), 11, 15);

// ── 11: the shoot-day coordinator ─────────
export const PARTIES = [
  { key: 'p11.ok.client', label: 'הלקוח', short: 'לקוח' },
  { key: 'p11.ok.influencers', label: 'המשפיענים', short: 'משפיענים' },
  { key: 'p11.ok.lior', label: 'ליאור, מנהל יום הצילום', short: 'ליאור' },
  { key: 'p11.ok.photographer', label: 'אלי הצלם', short: 'אלי' },
];
export const NATALI = [
  { key: 'p11b.makeup', label: 'המאפרת, בבית נטלי שעתיים לפני', short: 'מאפרת' },
  { key: 'p11b.ride', label: 'ההסעה של נטלי, הלוך וחזור', short: 'הסעה' },
];
export function coordinatorOf(client, checks, x) {
  const k = (key) => `${x.pre}${key}`;
  const item = (p) => ({ ...p, key: k(p.key), done: done(checks, k(p.key)), check: checks[k(p.key)] || null });
  const approvals = PARTIES.map(item);
  const contract = item({ key: 'p11.influencers', label: 'בדקתי בחוזה אילו משפיענים נרכשו' });
  const calendar = item({ key: 'p11.calendar', label: 'יום הצילום ביומן של כולם' });
  const natali = x.ctx.shoot_type === 'natali' ? NATALI.map(item) : [];
  const shootAt = parseDate(x.ctx.shoot_at);
  const needs = [!x.ctx.shoot_type ? 'עם מי מצלמים' : null, !shootAt ? 'תאריך ושעה' : null].filter(Boolean);
  const missing = [...approvals.filter((a) => !a.done).map((a) => `אישור ${a.short}`),
    ...(contract.done ? [] : ['בדיקת המשפיענים בחוזה']), ...(calendar.done ? [] : ['הכנסה ליומן'])];
  const closed = !missing.length;
  const nataliMissing = natali.filter((a) => !a.done).map((a) => a.short);
  return { n: x.n, pre: x.pre, shootAt, shootType: x.ctx.shoot_type || null, approvals, contract, calendar, natali, needs, missing, closed, nataliMissing, fullyClosed: closed && !nataliMissing.length };
}

// ── 14: shoot-day blockers ────────────────
// The topics of process 14, in its order (the item of each is p14.<key>).
export const TOPICS = [
  { key: 'approvals', label: 'אישורי לקוח' },
  { key: 'scripts', label: 'תסריטים' },
  { key: 'graphics', label: 'גרפיקות' },
  { key: 'access', label: 'גישות' },
  { key: 'shootday', label: 'יום צילום' },
  { key: 'team', label: 'משימות צוות' },
  { key: 'missing', label: 'חוסרים מהלקוח' },
  { key: 'delays', label: 'עיכוב של עובד' },
];
// Conditions that hold until the shoot, not things that get done: closed by the
// system only from the day before the shoot (the others as soon as they are done).
const CONTINUOUS = new Set(['team', 'delays']);
// Processes whose lateness is "an employee's delay" (the others have a topic of their own).
const DELAY_PROCS = ['p04', 'p08', 'p09', 'p10', 'p12a'];
// A client's request answered, telling the client, and blocker reports are not "team tasks".
const NOT_TEAM = new Set(['tell']);

export const SEEN = (pre = '') => `${pre}p14.seen`;
// "עברתי": the blockers seen today, from the mark's note { day, ids }.
export function seenToday(checks, pre, now = new Date()) {
  const c = checks[SEEN(pre)];
  if (!c || c.state !== 'done') return new Set();
  try {
    const v = JSON.parse(c.note);
    return v?.day === dayKeyIL(now) && Array.isArray(v.ids) ? new Set(v.ids) : new Set();
  } catch { return new Set(); }
}
export function seenNote(checks, pre, id, now = new Date()) {
  const ids = seenToday(checks, pre, now);
  ids.add(id);
  return JSON.stringify({ day: dayKeyIL(now), ids: [...ids] });
}
// Open exceptions Irit reported from this list, by the blocker they name.
export function reportedOf(tasks, clientId) {
  const out = new Map();
  for (const t of tasks || []) {
    if (t.client_id === clientId && !t.done_at && t.source === 'escalation' && t.brief?.blocker) out.set(t.brief.blocker, t);
  }
  return out;
}

const whenWords = (d, now) => {
  const days = daysBetweenIL(now, d);
  const day = days === 0 ? 'היום' : days === -1 ? 'אתמול' : days === 1 ? 'מחר' : dayText(d);
  return `${day} ${timeText(d)}`;
};
const ownerOf = (s) => s.claim?.person || s.proc.owners[0] || null;
const procText = (s) => `${s.proc.num} · ${s.proc.title}`;

// Every upcoming shoot of the client (the main one and each round) with its topics
// and blockers. Only live clients, and only once the content stage started (process
// 14 is ready: from the end of the characterization, or a round's start) and until
// the shoot. The client-wide topics (graphics, access, missing material, tasks) are
// counted once, in the nearest shoot.
export function shootPrep(client, checks, state, { tasks = [], access = [], now = new Date() } = {}) {
  if (!live(client)) return [];
  const out = [];
  const byId = new Map(state.states.map((s) => [s.proc.id, s]));
  let wideDone = false;
  const contexts = shootContexts(client).map((x) => ({ x, shoot: parseDate(x.ctx.shoot_at) }))
    .filter(({ x, shoot }) => { const p14 = byId.get(`${x.pid}p14`); return p14 && p14.ready && (!shoot || shoot > now); })
    .sort((a, b) => (a.shoot?.getTime() ?? Infinity) - (b.shoot?.getTime() ?? Infinity));
  for (const { x, shoot } of contexts) {
    const st = (id) => byId.get(`${x.pid}${id}`) || null;
    const soon = !!shoot && businessDaysBetween(now, shoot) <= 2;
    // Stuck: late, or waiting on the client when the shoot is two business days away or less.
    const stuck = (s) => !!s && !s.complete && (s.status === 'overdue' || (s.status === 'client' && soon));
    const dueWords = (s) => (s.dueAt ? ` (היעד: ${whenWords(s.dueAt, now)})` : '');
    const block = (topic, detail, text, who) => ({ id: `${topic}:${detail}`, topic, text, who });
    const topics = Object.fromEntries(TOPICS.map((t) => [t.key, { ...t, item: `${x.pre}p14.${t.key}`, clear: false, blockers: [] }]));
    const wide = !wideDone;
    wideDone = true;

    // Approvals: the scripts (always a real approval), and the first 9 graphics.
    const p13 = st('p13');
    const scriptsOk = done(checks, `${x.pre}p13.approved`);
    if (!scriptsOk && (stuck(p13) || (soon && p13))) topics.approvals.blockers.push(block('approvals', p13.proc.id, `הלקוח עוד לא אישר את התסריטים${dueWords(p13)}`, 'lior'));
    const p07 = x.n === 1 ? st('p07') : null;
    const graphicsOk = x.n > 1 || !p07 || resolved(checks, 'p07.approved');
    if (wide && p07 && done(checks, 'p07.sent') && !graphicsOk && stuck(p07)) topics.approvals.blockers.push(block('approvals', 'p07', 'הלקוח עוד לא אישר את 9 הגרפיקות הראשונות', 'irit'));
    topics.approvals.clear = scriptsOk && graphicsOk;

    // Scripts (12).
    const p12 = st('p12');
    if (stuck(p12)) topics.scripts.blockers.push(block('scripts', p12.proc.id, `התסריטים לא מוכנים${dueWords(p12)}`, ownerOf(p12)));
    topics.scripts.clear = !!p12?.complete;

    // The first graphics (7): once per client.
    if (wide && p07 && stuck(p07) && !done(checks, 'p07.sent')) topics.graphics.blockers.push(block('graphics', 'p07', `9 הגרפיקות הראשונות לא מוכנות${dueWords(p07)}`, ownerOf(p07)));
    topics.graphics.clear = x.n > 1 || !p07 || p07.complete;

    // Access (6): broken logins, and the check itself late. Once per client.
    const p06 = st('p06');
    const broken = (access || []).filter((a) => a.client_id === client.id && a.status === 'broken');
    // A login the client filled in the form and nobody checked yet ('new').
    const unchecked = (access || []).filter((a) => a.client_id === client.id && a.status === 'new');
    if (wide) {
      for (const a of broken) topics.access.blockers.push(block('access', a.id, `גישה לא עובדת: ${networkName(a.network)}`, 'lior'));
      for (const a of unchecked) topics.access.blockers.push(block('access', a.id || `new-${a.network}`, `גישה מהלקוח שעוד לא נבדקה: ${networkName(a.network)}`, 'ilai'));
      if (stuck(p06)) topics.access.blockers.push(block('access', 'p06', `בדיקת הגישות וסידור העמודים באיחור${dueWords(p06)}`, ownerOf(p06)));
    }
    topics.access.clear = x.n > 1 || (!!p06?.complete && !broken.length && !unchecked.length);

    // The shoot day itself (11, and Natali's 11ב).
    const p11 = st('p11');
    if (stuck(p11)) {
      const open = coordinatorOf(client, checks, x).missing;
      topics.shootday.blockers.push(block('shootday', p11.proc.id, `יום הצילום עוד לא נסגר${open.length ? `: חסר ${listText(open)}` : ''}${dueWords(p11)}`, 'irit'));
    }
    const p11b = st('p11b');
    if (p11b && !p11b.complete && (stuck(p11b) || (shoot && businessDaysBetween(now, shoot) <= 3))) {
      topics.shootday.blockers.push(block('shootday', p11b.proc.id, 'המאפרת וההסעה של נטלי לא סגורות', 'lior'));
    }
    topics.shootday.clear = !!p11?.complete && (!p11b || p11b.complete);

    // Team tasks: urgent, reported exceptions (not from this list) and late ones. Once per client.
    const today = dayKeyIL(now);
    const teamTasks = wide ? (tasks || []).filter((t) => t.client_id === client.id && !t.done_at && !NOT_TEAM.has(t.source) && !t.brief?.blocker && !t.brief?.dayBefore
      && (t.urgent || t.source === 'escalation' || (t.due_on && t.due_on < today))) : [];
    for (const t of teamTasks) {
      // An open exception is Lior's already: nothing to report, only to know.
      const b = block('team', t.id, `${t.source === 'escalation' ? 'חריגה פתוחה אצל ליאור' : t.urgent ? 'משימה דחופה' : 'משימה באיחור'}: ${clean(t.title)}`, t.owner);
      if (t.source === 'escalation') b.known = true;
      topics.team.blockers.push(b);
    }
    topics.team.clear = !teamTasks.length;

    // Missing from the client (5): once per client, once the meeting's deadline passed.
    const p05 = x.n === 1 ? st('p05') : null;
    const mat = materialsOf(checks);
    if (wide && p05 && !p05.complete && mat.missing.length && stuck(p05)) {
      topics.missing.blockers.push(block('missing', 'p05', `חסר מהלקוח: ${listText(mat.missing)}`, 'irit'));
    }
    topics.missing.clear = x.n > 1 || !p05 || p05.complete || !mat.missing.length;

    // An employee's delay in anything else of the content stage.
    const delayed = DELAY_PROCS.map((id) => st(id)).filter((s) => s && !s.complete && s.status === 'overdue');
    for (const s of delayed) topics.delays.blockers.push(block('delays', s.proc.id, `באיחור: ${procText(s)}${dueWords(s)}`, ownerOf(s)));
    topics.delays.clear = !delayed.length;

    const list = TOPICS.map((t) => topics[t.key]);
    for (const t of list) if (t.blockers.length) t.clear = false;
    out.push({ n: x.n, pre: x.pre, pid: x.pid, shootAt: shoot, ctx: x.ctx, soon, topics: list, blockers: list.flatMap((t) => t.blockers) });
  }
  return out;
}

// The p14 items the system closes by itself: a topic that is clear (the continuous
// ones only from the business day before the shoot), not yet resolved.
export function topicsToClose(prep, checks, now = new Date()) {
  const eveStarted = prep.shootAt && now >= startOfDayIL(eveOf(prep.shootAt));
  return prep.topics.filter((t) => t.clear && !resolved(checks, t.item) && (!CONTINUOUS.has(t.key) || eveStarted)).map((t) => t.item);
}
export const TOPIC_NOTE = 'נסגר אוטומטית: אין חוסם';

// "דווח לליאור": an exception at once (urgent when the shoot is two business days away or less).
export const BLOCKER_TITLE = 'חוסם ליום הצילום';
export function blockerTask(client, prep, blocker, now = new Date()) {
  const when = prep.shootAt ? ` (${dayText(prep.shootAt)})` : '';
  return {
    client_id: client.id, owner: 'lior', source: 'escalation', urgent: !!(prep.shootAt && businessDaysBetween(now, prep.shootAt) <= 2),
    title: `${BLOCKER_TITLE}${when}: ${blocker.text}`.slice(0, 500), due_on: null, brief: { blocker: blocker.id },
  };
}

// ── 14 (protocol v8): the daily follow-up until the shoot day ──
// Once every working day, from the end of the characterization until the shoot day,
// Irit answers for each client in one tap: "הכול תקין", or which of the eight topics is
// stuck, with a short note (then Lior is told: followupTask). The answer is the mark
// `p14.day` (in a second shoot round `r2.p14.day`), written over every day; its note is
// JSON { ok: true } or { stuck: [topic keys], note }, and it counts for the Israel day
// it was written on (isResolved in app/protocol-logic.js). The history of the marks
// (protocol_log) keeps the days before. No table of its own.
export const FOLLOWUP_KEY = (pre = '') => `${pre}p14.day`;
export const FOLLOWUP_URL = 'prep.html#followup';
export const FOLLOWUP_NOTE_MAX = 200;
export const FOLLOWUP_TITLE = 'תקוע לפני יום הצילום';
const topicLabel = (k) => TOPICS.find((t) => t.key === k)?.label || k;
export function followupNote({ stuck = [], note = '' } = {}) {
  const keys = [...new Set(stuck)].filter((k) => TOPICS.some((t) => t.key === k));
  return JSON.stringify(keys.length ? { stuck: keys, note: clean(note).slice(0, FOLLOWUP_NOTE_MAX) } : { ok: true });
}
// An answer read back: { at, day, by_email, ok, stuck: [keys], note }; null when there is none.
export function readFollowup(check) {
  if (!check || check.state !== 'done' || !check.at) return null;
  let v = null;
  try { v = JSON.parse(check.note); } catch { /* a plain note: read as "all is well" */ }
  const stuck = Array.isArray(v?.stuck) ? v.stuck.filter((k) => TOPICS.some((t) => t.key === k)) : [];
  return { at: new Date(check.at), day: dayKeyIL(new Date(check.at)), by_email: check.by_email || null, ok: !stuck.length, stuck, note: clean(v?.note) };
}
// "תקוע: תסריטים, גישות · הלקוח לא עונה".
export const followupText = (a) => (!a ? '' : a.ok ? 'הכול תקין' : `תקוע: ${a.stuck.map(topicLabel).join(', ')}${a.note ? ` · ${a.note}` : ''}`);
// Every shoot the follow-up is asked of today, the nearest shoot first:
//   [{ client, n, pre, pid, shootAt, status: 'due' | 'done', answer (today's, or null),
//      last (the latest answer of any day, or null) }]
// A client in landing, an imported history, a shoot day that came, a weekend or a
// holiday: not asked (clientState decides; this only reads it).
export function followupRows({ clients = [], checksOf = () => ({}), stateOf, now = new Date() }) {
  const out = [];
  for (const c of clients) {
    if (!live(c) || inLanding(c)) continue;
    const checks = checksOf(c) || {};
    for (const s of stateOf(c).states) {
      if (!isDaily(s.proc) || !s.ready || (s.status !== 'due' && s.status !== 'done')) continue;
      const kb = s.proc.keyBase || s.proc.id;
      const pre = kb.slice(0, kb.length - 'p14'.length);
      const last = readFollowup(checks[FOLLOWUP_KEY(pre)]);
      const answer = last && last.day === dayKeyIL(now) ? last : null;
      out.push({
        client: c, n: Number(/^r(\d+)-/.exec(s.proc.id)?.[1] || 1), pre, pid: s.proc.id.slice(0, s.proc.id.length - 'p14'.length),
        shootAt: parseDate((s.proc.ctx || c).shoot_at), status: answer ? 'done' : 'due', answer, last,
      });
    }
  }
  return out.sort((a, b) => (a.shootAt?.getTime() ?? Infinity) - (b.shootAt?.getTime() ?? Infinity));
}
export const followupDue = (rows) => rows.filter((r) => r.status === 'due');
// "מעקב לפני צילום: 3 לקוחות" (the counted line of "המשימות שלי" and the reminder).
export const followupLine = (n) => `מעקב לפני צילום: ${n === 1 ? 'לקוח אחד' : `${n} לקוחות`}`;
// "Lior is told": an exception, as a blocker reported from this page is (urgent when
// the shoot is two business days away or less). One per client per day.
export function followupTask(client, row, { stuck = [], note = '' }, now = new Date()) {
  const when = row.shootAt ? ` (${dayText(row.shootAt)})` : '';
  const text = `${stuck.map(topicLabel).join(', ')}${clean(note) ? ` · ${clean(note)}` : ''}`;
  return {
    client_id: client.id, owner: 'lior', source: 'escalation', urgent: !!(row.shootAt && businessDaysBetween(now, row.shootAt) <= 2),
    title: `${FOLLOWUP_TITLE}${when}: ${text}`.slice(0, 500), due_on: null, brief: { blocker: `followup:${row.pre}${dayKeyIL(now)}` },
  };
}

// ── 15: Irit's day-before check ───────────
export const DAY_BEFORE_KEY = (pre = '') => `${pre}p15.irit`;
export function dayBefore(client, checks, prep, x, now = new Date()) {
  const shoot = parseDate(x.ctx.shoot_at);
  if (!shoot || shoot <= now) return null;
  const eve = eveOf(shoot);
  const d = (key) => done(checks, `${x.pre}${key}`);
  const sys = (ok) => (ok ? 'ok' : 'fail');
  const items = [
    { id: 'content', label: 'הלקוח אישר את התוכן', auto: sys(d('p13.approved')), why: 'אישור התסריטים בתהליך 13' },
    { id: 'client', label: 'הלקוח קיבל תזכורת ליום הצילום', auto: sys(d('p15.client')), why: 'תזכורת ללקוח בתהליך 15' },
    { id: 'influencers', label: 'המשפיענים עודכנו', auto: sys(d('p15.influencers')), why: 'תזכורת למשפיענים בתהליך 15' },
    { id: 'crew', label: 'הצלם והצוות עודכנו', auto: sys(d('p15.crew')), why: 'תזכורת לצוות בתהליך 15' },
    {
      id: 'address', label: 'הכתובת נכונה אצל כולם',
      auto: !clean(client.address) ? 'fail' : d('p15.d.address') ? 'ok' : null,
      why: !clean(client.address) ? 'אין כתובת בכרטיס הלקוח' : `בכרטיס: ${clean(client.address)}`,
    },
    {
      id: 'tasks', label: 'אין משימה פתוחה שחוסמת את יום הצילום',
      auto: prep && prep.topics.find((t) => t.key === 'team')?.blockers.length ? 'fail' : 'ok',
      why: prep ? listText(prep.topics.find((t) => t.key === 'team')?.blockers.map((b) => b.text) || []) : '',
    },
    ...(x.ctx.shoot_type === 'natali' ? [{ id: 'natali', label: 'המאפרת וההסעה של נטלי אישרו', auto: sys(d('p15.natali.makeup') && d('p15.natali.ride')), why: 'אישור חוזר של ליאור בתהליך 15' }] : []),
    { id: 'remembers', label: 'הלקוח זוכר את היום (שיחה קצרה)', auto: null, why: 'רק עירית יכולה לדעת' },
  ];
  const check = checks[DAY_BEFORE_KEY(x.pre)];
  return {
    n: x.n, pre: x.pre, shoot, eve, at: atTimeIL(eve, 11, 15), open: now >= startOfDayIL(eve), items,
    done: check?.state === 'done' ? { at: check.at, by_email: check.by_email, ...readDayBefore(check.note) } : null,
  };
}
// Irit's answers ({ id: 'ok' | 'fail' } for the items the system does not know) with
// what the system knows: which passed and which failed; null while one is unanswered.
export function dayBeforeResult(check, answers = {}) {
  const ok = [];
  const failed = [];
  for (const it of check.items) {
    const v = it.auto || answers[it.id];
    if (v !== 'ok' && v !== 'fail') return null;
    (v === 'ok' ? ok : failed).push(it.id);
  }
  return { ok, failed };
}
export const dayBeforeNote = (res) => JSON.stringify({ ok: res.ok, failed: res.failed });
// The check's items by id, for reading a saved result back in words.
export const DAY_BEFORE_LABELS = {
  content: 'הלקוח אישר את התוכן', client: 'הלקוח קיבל תזכורת ליום הצילום', influencers: 'המשפיענים עודכנו',
  crew: 'הצלם והצוות עודכנו', address: 'הכתובת נכונה אצל כולם', tasks: 'אין משימה פתוחה שחוסמת את יום הצילום',
  natali: 'המאפרת וההסעה של נטלי אישרו', remembers: 'הלקוח זוכר את היום (שיחה קצרה)',
};
// The saved result as one line for the client card ("נבדקו 7 פריטים, הכול תקין", or
// the failed ones by name); null when the note is not a saved result.
export function dayBeforeText(note) {
  let v = null;
  try { v = JSON.parse(note); } catch { return null; }
  if (!v || typeof v !== 'object' || !Array.isArray(v.failed)) return null;
  const ok = Array.isArray(v.ok) ? v.ok : [];
  const n = ok.length + v.failed.length;
  const count = n === 1 ? 'נבדק פריט אחד' : `נבדקו ${n} פריטים`;
  if (!v.failed.length) return n ? `${count}, הכול תקין` : '';
  return `${count}. לא תקין: ${v.failed.map((id) => DAY_BEFORE_LABELS[id] || String(id)).join(', ')}`;
}
export function readDayBefore(note) {
  try {
    const v = JSON.parse(note);
    if (v && Array.isArray(v.failed)) return { ok: v.ok || [], failed: v.failed };
  } catch { /* a plain note */ }
  return { ok: [], failed: [] };
}
export function dayBeforeTask(client, check, failedIds) {
  const labels = check.items.filter((it) => failedIds.includes(it.id)).map((it) => it.label);
  return {
    client_id: client.id, owner: 'lior', source: 'escalation', urgent: true, due_on: null,
    title: `בדיקת יום לפני הצילום (${dayText(check.shoot)}) נכשלה: ${listText(labels)}`.slice(0, 500),
    brief: { dayBefore: `${check.pre}p15` },
  };
}

// ── Irit's section 17: a client's request ──
export const REQUEST = 'request';
export const TELL = 'tell';
export const TELL_PREFIX = 'לעדכן את הלקוח: ';
// Decision 29: handled within a business day (urgent: today, within an hour).
export const requestDue = (now = new Date(), urgent = false) => dayKeyIL(urgent ? now : addBusinessDays(now, 1));
export function requestTask({ client, text, owner, dueOn, urgent = false }) {
  return { client_id: client.id, title: clean(text).slice(0, 500), owner, due_on: dueOn || null, source: REQUEST, urgent: !!urgent };
}
export function requestProblems({ client, text, owner }) {
  const out = {};
  if (!client) out.client = 'לבחור לקוח.';
  if (clean(text).length < 3) out.text = 'לכתוב מה הלקוח ביקש.';
  if (!owner || !PEOPLE[owner] || owner === 'editor') out.owner = 'לבחור מי מטפל.';
  return out;
}
const firstName = (c) => clean(c.name) || 'שלום';
// "קיבלנו": the acknowledgement (promise ה11: within two hours).
export function ackMessage(client, text, owner, dueOn) {
  const due = dueOn ? parseDate(dueOn) : null;
  return `היי ${firstName(client)}, קיבלנו את הבקשה: "${clean(text)}". הבקשה אצל ${PEOPLE[owner]?.name || 'הצוות'}${due ? `, ונחזור אליכם עד ${dayText(due)}` : ''}.`;
}
export const requestOf = (tell) => clean(tell?.brief?.request) || clean(String(tell?.title || '').replace(TELL_PREFIX, ''));
export function tellMessage(client, requestText) {
  return `היי ${firstName(client)}, עדכון על הבקשה שלכם: "${clean(requestText)}". טיפלנו בזה. אם צריך עוד משהו, כתבו לנו.`;
}

// ── A shoot date against the usual order ──
// The shoot day comes after the characterization, with time for the scripts to be
// written and approved (12, 13: three business days). The office is not stopped
// from setting it otherwise, but is asked to confirm, and the reasons are kept in
// the history of date changes. Returns the reasons, in Hebrew ([] when all is in order).
export const SHOOT_MIN_BUSINESS_DAYS = 3;
export function shootDateConcerns({ shootAt, charAt = null, now = new Date() }) {
  const shoot = parseDate(shootAt);
  if (!shoot) return [];
  const char = parseDate(charAt);
  const out = [];
  if (shoot < now) out.push('המועד כבר עבר.');
  if (char && shoot < char) out.push(`יום הצילום לפני פגישת האפיון (${dayText(char)}).`);
  else if (char && businessDaysBetween(char, shoot) < SHOOT_MIN_BUSINESS_DAYS) {
    out.push(`פחות מ־${SHOOT_MIN_BUSINESS_DAYS} ימי עסקים אחרי פגישת האפיון (${dayText(char)}): התסריטים עוד לא יהיו כתובים ומאושרים.`);
  }
  return out;
}
// The question put to whoever sets it, and the note kept when they confirm.
export const shootDateQuestion = (shootAt, concerns) => `יום הצילום: ${dayText(parseDate(shootAt))} בשעה ${timeText(parseDate(shootAt))}.\n${concerns.map((c) => `• ${c}`).join('\n')}\n\nלקבוע את המועד בכל זאת?`;
export const shootDateNote = (concerns) => `אושר למרות: ${concerns.join(' ')}`.slice(0, 500);
