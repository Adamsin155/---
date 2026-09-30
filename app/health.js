// The client's colour and the owner's screens (docs/plan/system-plan.md,
// section 6: screens 1–4 and the colour rule; decisions 22–24 in
// docs/plan/decisions.md). Pure: no DOM and no database, so node tests it and a
// server job can use it. Every day and hour is Israel's (tz.js), whatever the
// zone of the device or the server.
//
// The colour is computed by rules, never set by hand:
//   red     a critical item late by more than 2 business days; a shoot day that
//           moved or is at risk (no approved scripts a business day before, or the
//           day-before reminders not sent by 15:00), or whose own preparation (11,
//           Natali's 11b) is still open close to it; a login broken for more than 2
//           business days; an urgent exception, or one open for more than a
//           business day (an urgent task open for more than 4 office hours too); a
//           client score of 2 or less; the deliverables behind the promised pace.
//   yellow  due today or on the next business day and not started; waiting on the
//           client for more than 2 business days; a second round of corrections or
//           more; no contact with the client for 2 business days; no activity for
//           5; stuck in a station longer than its norm; a missing Thursday summary;
//           a score of 3. Also anything late that is not red (yet), a late task and
//           a fresh exception: already past "due tomorrow".
//   green   otherwise.
// Every reason names ONE responsible person and says why in a few words.
// Time waiting on the client never counts against the staff: a process that waits
// on the client is not late (its deadline moved on by the wait, decision 3), it is
// never "not started", and deliverables the client is holding are not behind.
import { STATIONS, PEOPLE, PROCESSES, WORK_HOURS, DELIVERABLES, NETWORKS } from './protocol.js';
import {
  isResolved, blockers, businessDaysBetween, isBusinessDay, parseDate, roundsOf, roundContext, IMPORT_NOTE,
  isImported, workingMinutesBetween, addWorkingMinutes, workedMinutes, targetMinutes, durationStart, weekKey,
  openItemsFor, byUrgency, bucketOf, PAUSE, erevOn, applicableProcesses,
} from './protocol-logic.js';
import { stationOf, promisedClosing, materialsOf, SENT_CHECK_NOTE } from './messages-logic.js';
import { isOwnerView } from './team-rules.js';
import {
  partsIL, dayKeyIL, weekdayIL, atTimeIL, addDaysIL, startOfDayIL, endOfDayIL, daysBetweenIL, dayFromKeyIL,
} from './tz.js';

const DAY = 864e5;
export const COLORS = { red: 'אדום', yellow: 'צהוב', green: 'ירוק' };
const COLOR_RANK = { red: 0, yellow: 1, green: 2 };

// Who sees what (decision 22 and section 6). Screens only; the database decides
// what each person may read. Screen 1 ("מה דורש אותי") is the owner's; screen 2
// ("כל הלקוחות במבט") also Irit's, Lior's and Ofir's; the whole team on screen 4
// only the owner's and Lior's (everyone else sees their own row).
export const ALL_CLIENTS_VIEWERS = ['irit', 'lior', 'ofir'];
export const canSeeOwnerScreen = (v) => isOwnerView(v);
export const canSeeAllClients = (v) => isOwnerView(v) || (!!v && !v.error && ALL_CLIENTS_VIEWERS.includes(v.me));
export const seesWholeTeam = (v) => isOwnerView(v) || (!!v && !v.error && v.me === 'lior');

// Defaults waiting for the office's decision (docs/protocols/README.md).
export const EDITOR_CAP = 2;          // editing jobs an editor holds at once
export const SHOOT_MOVED_DAYS = 3;    // a moved shoot day stays red this many business days
export const THURSDAY_AT = 13;        // Ofir's Thursday summary is due at 13:00 (decision 20)
// How many whole business days a client may stay in a station before it is
// "stuck" (screen 1). The ongoing work and the renewal have no norm. A station
// that waits for a date already set (the meeting, the shoot day) is not stuck.
export const STATION_NORM = { join: 2, char: 5, content: 10, shoot: 3, post: 8, publish: 5 };
const OFFICE_DAY = (WORK_HOURS.end - WORK_HOURS.start) * 60;
const URGENT_OPEN = 4 * 60;           // an urgent task open 4 office hours (decision 24)
// A process that is not a promise to the client or its clock: the daily follow-up
// until the shoot (14) is a check-list, not a deliverable.
const NOT_CRITICAL = new Set(['p14']);

// Order of the reasons, most severe first, within each colour.
const RANK = {
  'shoot-risk': 10, 'shoot-moved': 11, 'shoot-prep': 11.5, 'escalation-urgent': 12, late: 13, access: 14, 'escalation-open': 15,
  'urgent-task': 16, 'score-low': 17, pace: 18,
  'late-soon': 30, 'late-task': 31, 'due-soon': 32, stuck: 32.5, waiting: 33, escalation: 34, revision: 35, review32: 36,
  review33: 37, 'score-mid': 38, 'no-contact': 39, quiet: 40, thursday: 41,
};
export const bySeverity = (a, b) => (COLOR_RANK[a.color] - COLOR_RANK[b.color]) || ((RANK[a.code] ?? 99) - (RANK[b.code] ?? 99))
  || ((b.days || 0) - (a.days || 0));

const baseId = (id) => String(id).replace(/^r\d+-/, '');
const roundOf = (id) => Number(/^r(\d+)-/.exec(id)?.[1] || 0);
export const procName = (proc) => `${roundOf(proc.id) ? `סבב ${roundOf(proc.id)} · ` : ''}${proc.num} · ${proc.title}`;
const isDone = (checks, key) => checks[key]?.state === 'done';
// Done, or marked "not relevant".
const isResolvedKey = (checks, key) => checks[key]?.state === 'done' || checks[key]?.state === 'na';
const isReal = (c) => !!c && c.state === 'done' && c.note !== IMPORT_NOTE;
const WEEKDAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const dayText = (d) => { const p = partsIL(d); return `${WEEKDAY[p.weekday]} ${p.day}.${p.month}`; };
const cut = (s, n = 80) => { const t = String(s || '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// "20 דק׳", "3 שעות עבודה", "יום עסקים", "2 ימי עסקים": how long since `from`.
// From another day: in business days (a deadline at the end of Monday, seen on
// Tuesday at 10:00, is a business day late, not "10 hours"). Within the day: in
// office time, since the evening and the weekend are nobody's delay.
export function lateWords(from, now = new Date()) {
  const days = businessDaysBetween(from, now);
  if (days >= 1) return bdaysWords(days);
  const mins = Math.round(workingMinutesBetween(from, now));
  if (mins < 60) return `${Math.max(mins, 1)} דק׳`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? 'שעת עבודה' : `${hours} שעות עבודה`;
}
export const bdaysWords = (n) => (n === 1 ? 'יום עסקים' : `${n} ימי עסקים`);

// The one person who holds a process now: whoever took it; otherwise the owner of
// its first open item (the default owner comes first, decision 7). Until an
// editor is assigned, editing is Ofir's to assign.
export function responsibleOf(s, checks = {}, client = {}, now = new Date()) {
  if (!s) return null;
  if (s.claim?.person) return s.claim.person;
  const ctx = s.proc.ctx || client;
  const open = s.proc.items.filter((i) => !i.optional && !isResolved(i, checks[i.key], now));
  const item = open.find((i) => !blockers(i, ctx, checks)) || open[0];
  const who = (item?.owners || s.proc.owners)[0] || null;
  return who === 'editor' ? 'ofir' : who;
}

// The client and each extra shoot round: its context, item prefix and process prefix.
export function shootContexts(client) {
  return [{ ctx: client, pre: '', pid: '', n: 1 },
    ...roundsOf(client).map((r) => ({ ctx: roundContext(client, r), pre: `r${r.n}.`, pid: `r${r.n}-`, n: Number(r.n) }))];
}

// ── Log helpers ─────────────────────────────
// Real "done" events of an item in the history, oldest first. An undo (the same
// person clearing it within 10 minutes) takes its "done" back; imported history
// is not an event.
export function doneEvents(rows, key) {
  const out = [];
  const list = (rows || []).filter((r) => r.item_key === key).sort((a, b) => new Date(a.at) - new Date(b.at));
  for (const r of list) {
    if (r.action === 'done' && r.note !== IMPORT_NOTE) out.push(r);
    else if (r.action === 'clear') {
      const last = out.at(-1);
      if (last && last.by_email === r.by_email && new Date(r.at) - new Date(last.at) <= 10 * 6e4) out.pop();
    }
  }
  return out;
}
const rowsOf = (log, clientId) => (log || []).filter((r) => !r.client_id || r.client_id === clientId);

// Editing stopped for someone else's task (the `pNN.pause` mark): periods from the history.
export function pausePeriods(rows, key, until = new Date()) {
  const out = [];
  let open = null;
  for (const r of (rows || []).filter((x) => x.item_key === key).sort((a, b) => new Date(a.at) - new Date(b.at))) {
    if (r.action === 'done' && !open) open = new Date(r.at);
    else if (r.action === 'clear' && open) { out.push({ from: open, to: new Date(r.at) }); open = null; }
  }
  if (open) out.push({ from: open, to: new Date(until) });
  return out;
}
// Office minutes of those stops before `until`: all of them (`min`), and those that
// began before the deadline (`ext`), which move it on, as waiting on the client does.
export function pausedMinutes(periods, dueAt, until) {
  let min = 0;
  let ext = 0;
  for (const p of periods || []) {
    const end = new Date(Math.min(+p.to, +until));
    if (end <= p.from) continue;
    const m = workingMinutesBetween(p.from, end);
    min += m;
    if (dueAt && p.from < dueAt) ext += m;
  }
  return { min, ext };
}

// ── Contact and activity ───────────────────
// Items that are contact with the client: messages sent, calls, meetings, and the
// client answering.
const CONTACT = /^(r\d+\.)?(p02\.intro|p07\.(sent|call)|p12a\.call|p13\.zoom|p15\.(client|explain)|p23\.(sent|call)|p26\.(sent|call)|p27\.notes|p31\.call|p34\.talk|p\d+[a-z]?\.answered)$/;
export function lastContact(client, checks = {}, messages = null) {
  let t = 0;
  for (const m of messages || []) if (!m.client_id || m.client_id === client.id) t = Math.max(t, +new Date(m.sent_at));
  for (const [k, c] of Object.entries(checks)) if (CONTACT.test(k) && isReal(c)) t = Math.max(t, +new Date(c.at));
  return t ? new Date(t) : null;
}

// The last time anything happened with the client in the system.
export function lastActivity(client, { checks = {}, tasks = [], statusNotes = null, log = null, messages = null } = {}) {
  const times = [client.created_at, client.deal_at,
    ...Object.values(checks).map((c) => c.at),
    ...(tasks || []).filter((t) => t.client_id === client.id).flatMap((t) => [t.created_at, t.done_at]),
    ...(statusNotes || []).filter((n) => !n.client_id || n.client_id === client.id).map((n) => n.at),
    ...rowsOf(log, client.id).map((r) => r.at),
    ...(messages || []).filter((m) => !m.client_id || m.client_id === client.id).map((m) => m.sent_at),
  ].filter(Boolean).map((v) => new Date(v).getTime()).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)) : null;
}

// ── The weekly call (31) ────────────────────
// A week's call is due by the close of its last business day (Thursday, or the
// day before a holiday); a week with no business day has none.
function weekClose(d) {
  let x = addDaysIL(atTimeIL(d, 12), 4 - weekdayIL(d));
  for (let i = 0; i < 5 && !isBusinessDay(x); i += 1) x = addDaysIL(x, -1);
  if (!isBusinessDay(x) || daysBetweenIL(addDaysIL(atTimeIL(d, 12), -weekdayIL(d)), x) < 0) return null;
  return atTimeIL(x, erevOn(x) ? WORK_HOURS.erevEnd : WORK_HOURS.end);
}
// When the next weekly call is due: the week after the last one logged, or the
// first full week after the calls started (process 30 closed).
export function weeklyCallDue(s, checks = {}) {
  if (!s?.proc?.recurring || !s.startAt) return null;
  const c = checks[s.proc.items[0].key];
  let wk = isReal(c) ? addDaysIL(atTimeIL(new Date(c.at), 12), 7) : addDaysIL(atTimeIL(s.startAt, 12), 7);
  for (let i = 0; i < 4; i += 1) {
    const due = weekClose(wk);
    if (due) return due;
    wk = addDaysIL(wk, 7);
  }
  return null;
}

// ── Deliverables pace ───────────────────────
// Delivered is the card's count ("נמסרו", when the client got and approved it) or
// what the protocol shows as approved, whichever is more. Expected: the videos of
// every shoot round whose promised closing date passed (promise ה8), the first 9
// graphics once process 7 is due and the rest once 23 is. Whatever the client is
// holding (sent, waiting for their approval) is not expected from us.
export function deliverablesPace(client, state, checks = {}, now = new Date()) {
  const d = client.deliverables || {};
  const counted = d.done || {};
  const byId = new Map(state.states.map((s) => [s.proc.id, s]));
  const items = [];
  const vids = Number(d.videos) || 0;
  if (vids > 0) {
    const xs = shootContexts(client);
    const perRound = vids / Math.max(Number(d.shoot_days) || 0, xs.length, 1);
    let delivered = 0;
    let expected = 0;
    for (const x of xs) {
      const p27 = byId.get(`${x.pid}p27`);
      if (!p27) continue;
      if (p27.complete || isDone(checks, `${x.pre}p27.approved`)) { delivered += perRound; expected += perRound; continue; }
      const closing = promisedClosing(x.ctx.shoot_at);
      const withClient = p27.status === 'client' || (isDone(checks, `${x.pre}p26.sent`) && !isDone(checks, `${x.pre}p27.approved`));
      if (closing && closing < now && !withClient) expected += perRound;
    }
    items.push(paceItem('videos', vids, counted.videos, delivered, expected));
  }
  const gfx = Number(d.graphics) || 0;
  if (gfx > 0) {
    const first = Math.min(9, gfx);
    let delivered = 0;
    let expected = 0;
    const p07 = byId.get('p07');
    if (p07) {
      if (p07.complete || isDone(checks, 'p07.approved')) { delivered += first; expected += first; } else {
        const withClient = p07.status === 'client' || isDone(checks, 'p07.sent');
        if (p07.dueAt && p07.dueAt < now && !withClient) expected += first;
      }
    }
    const p23 = byId.get('p23');
    if (p23 && gfx > first) {
      if (p23.complete) { delivered += gfx - first; expected += gfx - first; } else if (p23.dueAt && p23.dueAt < now && p23.status !== 'client') expected += gfx - first;
    }
    items.push(paceItem('graphics', gfx, counted.graphics, delivered, expected));
  }
  // The rest have no schedule in the protocol yet (the monthly process is stage 5): shown, never "behind".
  for (const x of DELIVERABLES.filter((y) => y.key !== 'videos' && y.key !== 'graphics')) {
    const total = Number(d[x.key]) || 0;
    if (total > 0) items.push({ key: x.key, label: x.label, done: Number(counted[x.key]) || 0, total, expected: null, behind: false });
  }
  return { items, behind: items.filter((x) => x.behind) };
}
function paceItem(key, total, counted, delivered, expected) {
  const done = Math.min(total, Math.max(Number(counted) || 0, Math.round(delivered)));
  const exp = Math.min(total, Math.round(expected));
  return { key, label: DELIVERABLES.find((x) => x.key === key).label, done, total, expected: exp, behind: done < exp };
}
// "סרטונים 18/42 · גרפיקות 20/35"
export const paceText = (pace) => pace.items.filter((x) => x.key === 'videos' || x.key === 'graphics')
  .map((x) => `${x.label} ${x.done}/${x.total}`).join(' · ');

// ── Rounds of corrections ───────────────────
// A second round of corrections or more (decision 18: Lior decides on it): the
// client's notes on the videos a second time (27), or the graphics sent a third
// time (the first sending and one round of corrections are included), while that
// work is still open.
export function revisionRounds(client, state, log) {
  const rows = rowsOf(log, client.id);
  const byId = new Map(state.states.map((s) => [s.proc.id, s]));
  const out = [];
  for (const [id, what] of [['p07', 'ב־9 הגרפיקות הראשונות'], ['p23', 'ביתרת הגרפיקות']]) {
    const s = byId.get(id);
    if (!s || s.complete) continue;
    const sends = doneEvents(rows, `${id}.sent`).length;
    if (sends >= 2) out.push({ procId: id, round: sends - 1, what });
  }
  for (const x of shootContexts(client)) {
    const s = byId.get(`${x.pid}p27`);
    if (!s || s.complete) continue;
    const n = doneEvents(rows, `${x.pre}p27.notes`).length;
    if (n >= 1) out.push({ procId: s.proc.id, round: n, what: `בסרטונים${x.n > 1 ? ` (סבב צילום ${x.n})` : ''}` });
  }
  return out;
}

// ── Thursday summary ───────────────────────
// Ofir's summary of the week is due on Thursday at 13:00 (decision 20). From then
// until the week ends, a client without one is missing it. Null when not relevant now.
export function thursdayDue(now = new Date()) {
  const wd = weekdayIL(now);
  if (wd < 4 || (wd === 4 && now < atTimeIL(now, THURSDAY_AT))) return null;
  const thu = addDaysIL(atTimeIL(now, 12), 4 - wd);
  if (!isBusinessDay(thu)) return null;
  return { at: atTimeIL(thu, THURSDAY_AT), week: weekKey(thu) };
}

// The business day before a moment, and the one after it.
function prevBusinessDay(d) {
  let x = addDaysIL(atTimeIL(d, 12), -1);
  for (let i = 0; i < 30 && !isBusinessDay(x); i += 1) x = addDaysIL(x, -1);
  return x;
}
function nextBusinessDay(d) {
  let x = addDaysIL(atTimeIL(d, 12), 1);
  for (let i = 0; i < 30 && !isBusinessDay(x); i += 1) x = addDaysIL(x, 1);
  return x;
}
const whenWords = (d, now) => {
  const n = daysBetweenIL(now, d);
  if (n === 0) return 'היום';
  if (n === 1) return 'מחר';
  return `ב־${dayText(d)}`;
};

// ── The colour of one client ────────────────
// extras: { now, checks, tasks (open tasks), messages (client_messages rows, or
// null when not available), log (protocol_log rows), access (client_access rows:
// status, updated_at), statusNotes (client_status_notes rows, or null),
// dateChanges (client_date_changes rows), score (the client's latest score, when
// there is one) }. Returns { color, reasons } with the reasons most severe first;
// an ended or cancelled client has no colour.
export function clientHealth(client, state, extras = {}) {
  const now = extras.now || new Date();
  const checks = extras.checks || {};
  if (!client || client.status === 'ended' || client.status === 'cancelled') return { color: null, reasons: [], closed: true };
  const reasons = [];
  const add = (color, code, r) => reasons.push({ color, code, rank: RANK[code], ...r });
  const byId = new Map(state.states.map((s) => [s.proc.id, s]));
  const who = (s) => responsibleOf(s, checks, client, now);

  // Late: red past 2 business days on anything critical; yellow before that.
  for (const s of state.states) {
    let dueAt = null;
    if (s.proc.recurring) {
      if (!s.ready) continue;
      dueAt = weeklyCallDue(s, checks);
      if (!dueAt || dueAt >= now) continue;
    } else if (s.status === 'overdue') dueAt = s.dueAt;
    else continue;
    const days = businessDaysBetween(dueAt, now);
    const red = !NOT_CRITICAL.has(baseId(s.proc.id)) && days > 2;
    add(red ? 'red' : 'yellow', red ? 'late' : 'late-soon', {
      who: who(s), text: `באיחור ${lateWords(dueAt, now)}`, what: procName(s.proc), procId: s.proc.id, days, since: dueAt,
    });
  }

  // The shoot day: at risk while it is ahead, or moved lately.
  for (const x of shootContexts(client)) {
    const shoot = parseDate(x.ctx.shoot_at);
    if (!shoot || shoot <= now) continue;
    const st = (id) => byId.get(`${x.pid}${id}`);
    const ahead = businessDaysBetween(now, shoot);
    const round = x.n > 1 ? ` (סבב ${x.n})` : '';
    // "צילום בסיכון" is exactly the plan's two cases (section 3; decision 24 alerts
    // the owner on it): no client approval of the scripts a business day before
    // the shoot, or the day-before reminders not sent by 15:00.
    const risk = (s, whom, what, code = 'shoot-risk', text = 'צילום בסיכון') => add('red', code, { who: whom, text, what: `${what}, הצילום ${whenWords(shoot, now)}${round}`, procId: s?.proc.id || `${x.pid}p19`, days: 0, since: shoot });
    if (ahead <= 1 && !isResolvedKey(checks, `${x.pre}p13.approved`)) risk(st('p13'), 'lior', 'אין אישור לקוח על התסריטים');
    if (now >= atTimeIL(prevBusinessDay(shoot), 15) && st('p15') && !st('p15').complete) risk(st('p15'), 'lior', 'התזכורות של יום לפני לא נשלחו');
    // The shoot day's own preparation not closed close to it: red too (a default
    // waiting for the office's decision, docs/protocols/README.md), but not the alert.
    const prep = (s, whom, what) => risk(s, whom, what, 'shoot-prep', 'הכנת יום הצילום לא הושלמה');
    if (ahead <= 2 && st('p11') && !st('p11').complete) prep(st('p11'), who(st('p11')) || 'irit', 'יום הצילום עוד לא נסגר מול כולם');
    if (x.ctx.shoot_type === 'natali' && ahead <= 3 && st('p11b') && !st('p11b').complete) prep(st('p11b'), 'lior', 'המאפרת וההסעה של נטלי עוד לא סודרו');
  }
  const moves = new Map();
  for (const ch of extras.dateChanges || []) {
    if ((ch.client_id && ch.client_id !== client.id) || !ch.old_value || !['shoot_at', 'round_shoot_at'].includes(ch.field)) continue;
    const k = `${ch.field}:${ch.round || ''}`;
    if (!moves.has(k) || new Date(ch.at) > new Date(moves.get(k).at)) moves.set(k, ch);
  }
  for (const ch of moves.values()) {
    if (businessDaysBetween(new Date(ch.at), now) > SHOOT_MOVED_DAYS) continue;
    const from = parseDate(ch.old_value);
    const to = parseDate(ch.new_value);
    const round = ch.round ? ` (סבב ${ch.round})` : '';
    add('red', 'shoot-moved', {
      who: 'lior', text: 'יום הצילום זז', what: `${from ? `מ־${dayText(from)} ` : ''}${to ? `ל־${dayText(to)}` : 'והמועד נמחק'}${round}`,
      procId: ch.round ? `r${ch.round}-p11` : 'p11', days: 0, since: new Date(ch.at),
    });
  }

  // Logins that do not work (process 6): Lior restores them with the client.
  const broken = (extras.access || []).filter((a) => a.client_id === client.id && a.status === 'broken'
    && businessDaysBetween(new Date(a.updated_at), now) > 2);
  if (broken.length) {
    const since = new Date(Math.min(...broken.map((a) => +new Date(a.updated_at))));
    const days = businessDaysBetween(since, now);
    add('red', 'access', { who: 'lior', text: `גישה שבורה ${bdaysWords(days)}`, what: broken.map((a) => NETWORKS.find(([k]) => k === a.network)?.[1] || a.network).join(', '), procId: 'p06', days, since });
  }

  // Exceptions reported to Lior, urgent tasks and late tasks.
  for (const t of extras.tasks || []) {
    if (t.done_at || t.client_id !== client.id) continue;
    const created = new Date(t.created_at);
    const open = workingMinutesBetween(created, now);
    const base = { who: t.owner, what: cut(t.title), procId: null, taskId: t.id, since: created, days: businessDaysBetween(created, now) };
    if (t.source === 'escalation') {
      if (t.urgent) add('red', 'escalation-urgent', { ...base, text: 'חריגה דחופה' });
      else if (open > OFFICE_DAY) add('red', 'escalation-open', { ...base, text: `חריגה פתוחה ${lateWords(created, now)}` });
      else add('yellow', 'escalation', { ...base, text: 'חריגה פתוחה' });
      continue;
    }
    if (t.urgent && open > URGENT_OPEN) { add('red', 'urgent-task', { ...base, text: `משימה דחופה פתוחה ${lateWords(created, now)}` }); continue; }
    const due = t.due_on ? endOfDayIL(dayFromKeyIL(t.due_on)) : null;
    if (due && due < now) add('yellow', 'late-task', { ...base, text: `משימה באיחור ${lateWords(due, now)}`, since: due, days: businessDaysBetween(due, now) });
  }

  // The client's own score (surveys, stage 4), when there is one.
  const score = Number(extras.score);
  if (extras.score !== null && extras.score !== undefined && Number.isFinite(score)) {
    if (score <= 2) add('red', 'score-low', { who: 'lior', text: `ציון לקוח ${score}`, what: 'שיחה מליאור', procId: null });
    else if (score === 3) add('yellow', 'score-mid', { who: 'lior', text: 'ציון לקוח 3', what: 'שיחה מליאור תוך יום עסקים', procId: null });
  }

  // Deliverables behind the promised pace.
  const pace = deliverablesPace(client, state, checks, now);
  if (pace.behind.length) {
    add('red', 'pace', {
      who: 'lior', text: 'פיגור בקצב התוצרים', procId: pace.behind[0].key === 'videos' ? 'p27' : 'p23',
      what: pace.behind.map((p) => `${p.label} ${p.done}/${p.total}, צפוי ${p.expected}`).join(' · '),
    });
  }

  // Due today or on the next business day (Sunday, seen on Thursday) and nobody
  // started. Not a process that cannot start yet, nor one waiting on the client.
  const soonUntil = dayKeyIL(nextBusinessDay(now));
  for (const s of state.states) {
    if (s.proc.recurring || s.complete || !s.dueAt || !s.ready || s.touched || s.status === 'client' || s.status === 'overdue') continue;
    if (s.startAt && s.startAt > now) continue;
    if (s.dueAt < now || dayKeyIL(s.dueAt) > soonUntil) continue;
    add('yellow', 'due-soon', { who: who(s), text: `מועד ${whenWords(s.dueAt, now)} ועוד לא התחילו`, what: procName(s.proc), procId: s.proc.id, since: s.dueAt });
  }

  // Waiting on the client for more than 2 business days: Irit follows it up.
  for (const s of state.states) {
    if (s.status !== 'client' || !s.wait) continue;
    const since = new Date(s.wait.at);
    const days = businessDaysBetween(since, now);
    if (days <= 2) continue;
    add('yellow', 'waiting', {
      who: 'irit', waiting: true, text: `ממתין ללקוח ${bdaysWords(days)}`, what: `${procName(s.proc)}${s.wait.reason ? ` · ${cut(s.wait.reason, 60)}` : ''}`,
      procId: s.proc.id, days, since,
    });
  }

  // A second round of corrections or more.
  for (const r of revisionRounds(client, state, extras.log)) {
    if (r.round < 2) continue;
    add('yellow', 'revision', { who: 'lior', text: `סבב תיקונים ${r.round}`, what: r.what, procId: r.procId, days: r.round });
  }

  // No contact with the client for 2 business days (not counting today, when the
  // day's message can still go out). Only when the messages center records messages.
  if (Array.isArray(extras.messages)) {
    const last = lastContact(client, checks, extras.messages);
    const deal = parseDate(client.deal_at);
    const base = last && deal ? (last > deal ? last : deal) : last || deal;
    if (base) {
      const days = businessDaysBetween(base, now) - (isBusinessDay(now) ? 1 : 0);
      if (days >= 2) add('yellow', 'no-contact', { who: 'irit', text: `אין מגע עם הלקוח ${bdaysWords(days)}`, what: last ? `מגע אחרון: ${dayText(last)}` : 'עוד לא היה מגע', procId: null, days, since: base });
    }
  }

  // No activity for 5 business days, unless the client is holding the work.
  if (!state.states.some((s) => s.status === 'client')) {
    const last = extras.lastActivity || lastActivity(client, { checks, tasks: extras.tasks, statusNotes: extras.statusNotes, log: extras.log, messages: extras.messages });
    // Whole business days, as for "no contact": today is not over yet.
    const days = last ? businessDaysBetween(last, now) - (isBusinessDay(now) ? 1 : 0) : 0;
    if (days >= 5) {
      const step = currentStep(client, state, checks, now);
      add('yellow', 'quiet', { who: step?.who || 'ofir', text: `אין פעילות ${bdaysWords(days)}`, what: `פעילות אחרונה: ${dayText(last)}`, procId: step?.procId || null, days, since: last });
    }
  }

  // Stuck in its station longer than the norm, unless the client is holding the
  // work or the station waits for a date that is set (the meeting, the shoot day).
  if (!state.states.some((s) => s.status === 'client')) {
    const index = stationOf(client, state, now);
    const key = STATIONS[index].key;
    const norm = STATION_NORM[key];
    const since = norm ? stationSince(client, state, checks, index, now) : null;
    const dateAhead = (key === 'join' && parseDate(client.char_at) > now)
      || (key === 'content' && shootContexts(client).some((x) => parseDate(x.ctx.shoot_at) > now));
    if (since && !dateAhead) {
      const days = businessDaysBetween(since, now) - (isBusinessDay(now) ? 1 : 0);
      if (days > norm) {
        const step = currentStep(client, state, checks, now);
        add('yellow', 'stuck', {
          who: step?.who || 'ofir', text: `בתחנה ${bdaysWords(days)}`, what: `${STATIONS[index].title} · הנורמה עד ${bdaysWords(norm)}`,
          procId: step?.procId || null, days, since,
        });
      }
    }
  }

  // Ofir's Thursday summary.
  const thu = thursdayDue(now);
  const deal = parseDate(client.deal_at);
  if (thu && Array.isArray(extras.statusNotes) && deal && deal < thu.at
    && !extras.statusNotes.some((n) => (!n.client_id || n.client_id === client.id) && n.week === thu.week)) {
    add('yellow', 'thursday', { who: 'ofir', text: 'חסר סיכום חמישי', what: 'סיכום המצב של השבוע', procId: null });
  }

  reasons.sort(bySeverity);
  return { color: reasons.some((r) => r.color === 'red') ? 'red' : reasons.length ? 'yellow' : 'green', reasons };
}

// ── Where the client is ─────────────────────
const STATION_OF = new Map(STATIONS.flatMap((st, i) => st.procs.map((p) => [p, i])));
// Processes that start by themselves: the meeting, the shoot, editing and the renewal.
const DATED = new Set(['p04', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p20', 'p21', 'p22a', 'p34']);

// When the client came into its station: the first thing done in it (or the
// meeting, the shoot, the editing starting by itself); otherwise when the station
// before it was finished. The latest shoot round comes first.
function stationSince(client, state, checks, index, now) {
  const scopes = [...roundsOf(client).map((r) => `r${r.n}-`).reverse(), ''];
  for (const pid of scopes) {
    const list = state.states.filter((s) => (pid ? s.proc.id.startsWith(pid) : !/^r\d+-/.test(s.proc.id)));
    const inSt = list.filter((s) => STATION_OF.get(baseId(s.proc.id)) === index);
    if (!inSt.length) continue;
    let first = Infinity;
    for (const s of inSt) {
      for (const i of s.proc.items) if (checks[i.key]) first = Math.min(first, +new Date(checks[i.key].at));
      if (DATED.has(baseId(s.proc.id)) && s.startAt && s.startAt <= now) first = Math.min(first, +s.startAt);
    }
    if (first === Infinity) {
      const prev = list.filter((s) => (STATION_OF.get(baseId(s.proc.id)) ?? 99) < index && s.completedAt).map((s) => +s.completedAt);
      if (prev.length) first = Math.max(...prev);
    }
    if (first !== Infinity) return new Date(Math.min(first, +now));
  }
  return parseDate(client.deal_at);
}

// Milestones of the journey, in order: the ones the owner and the client wait for.
const MILESTONES = [
  ['p03', 'קביעת פגישת אפיון'], ['p04', 'פגישת אפיון'], ['p07', '9 הגרפיקות הראשונות'], ['p11', 'קביעת יום הצילום'],
  ['p13', 'אישור התסריטים'], ['p19', 'יום הצילום'], ['p22a', 'שיוך עורך'], ['p27', 'סגירת הסרטונים'],
  ['p28', 'תזמון התכנים'], ['p30', 'הקמפיין באוויר'], ['p34', 'שיחת חידוש'], ['p35', 'סיום התקשרות'],
];
const EVENT = new Set(['p04', 'p19']); // their date is the event itself

// Which process sets the date a deadline hangs on: the meeting's date is set in
// 3, the shoot's in 11, editing starts when 22א assigns an editor.
function setterOf(from, pid) {
  if (!from) return null;
  if (from === 'char' || from === 'charEnd') return pid ? null : 'p03';
  if (from === 'shoot') return `${pid}p11`;
  if (from === 'contractEnd') return 'p01';
  const item = /^item:(?:(r\d+)\.)?(p\d+[a-z]?)\./.exec(from);
  if (item) return `${item[1] ? `${item[1]}-` : ''}${item[2]}`;
  return /^(r\d+-)?p\d+[a-z]?$/.test(from) ? from : null;
}
// A date not known yet must be set by the deadline of the process that sets it.
// Only that process's own deadline: when it has none yet either, nothing is
// claimed (the shoot day is not due on the deal's day because the meeting is).
export function mustSetBy(s, byId) {
  if (!s) return null;
  const pid = /^r\d+-/.exec(s.proc.id)?.[0] || '';
  const setter = byId.get(setterOf((s.proc.due || s.proc.start)?.from, pid));
  if (!setter || setter === s) return null;
  return setter.dueAt || null;
}

// The next milestone: { procId, what, who, when, mustSetBy, status }. In each part
// of the journey (the client, each extra shoot round) the first milestone still
// open; of those, the earliest. With only the renewal left, the weekly call.
export function nextMilestone(client, state, checks = {}, now = new Date()) {
  const byId = new Map(state.states.map((s) => [s.proc.id, s]));
  const make = (s, what) => {
    const when = EVENT.has(baseId(s.proc.id)) ? s.startAt : s.dueAt;
    return {
      procId: s.proc.id, what: `${what}${roundOf(s.proc.id) ? ` (סבב ${roundOf(s.proc.id)})` : ''}`,
      who: EVENT.has(baseId(s.proc.id)) && baseId(s.proc.id) === 'p19' ? 'lior' : responsibleOf(s, checks, client, now),
      when: when || null, mustSetBy: when ? null : mustSetBy(s, byId), status: s.status,
    };
  };
  const found = [];
  for (const x of shootContexts(client)) {
    for (const [id, what] of MILESTONES) {
      const s = byId.get(`${x.pid}${id}`);
      if (!s || s.complete) continue;
      found.push(make(s, what));
      break;
    }
  }
  const base = found[0];
  const call = byId.get('p31');
  if (call?.ready && (!base || /^(p34|p35)$/.test(base.procId)) && (!base?.when || base.when - now > 14 * DAY)) {
    found.unshift({ procId: 'p31', what: 'שיחה שבועית', who: responsibleOf(call, checks, client, now), when: weeklyCallDue(call, checks), mustSetBy: null, status: call.status });
  }
  if (!found.length) return null;
  const dated = found.filter((m) => m.when);
  return dated.length ? dated.reduce((a, b) => (b.when < a.when ? b : a)) : found[0];
}

// What is open now and whose: the most urgent process that is not waiting on the
// client, with its deadline; or, when all that is open waits on the client, that.
export function currentStep(client, state, checks = {}, now = new Date()) {
  const open = openItemsFor(null, client, checks, state, now).sort(byUrgency);
  const ours = open.find((e) => e.status !== 'client');
  const pick = ours || open[0];
  if (!pick) return null;
  const s = state.states.find((x) => x.proc.id === pick.proc.id);
  return {
    procId: s.proc.id, what: procName(s.proc), who: ours ? responsibleOf(s, checks, client, now) : 'irit',
    until: ours ? s.dueAt : null, status: s.status, waiting: !ours,
  };
}

// What we are waiting for from the client, in words.
export function awaitedFromClient(client, state, checks = {}) {
  const out = [];
  const byId = new Map(state.states.map((s) => [s.proc.id, s]));
  for (const s of state.states) if (s.status === 'client') out.push(s.wait?.reason ? cut(s.wait.reason, 80) : s.proc.title);
  if (byId.get('p04')?.complete && byId.get('p05') && !byId.get('p05').complete) {
    const m = materialsOf(checks);
    if (m.missing.length) out.push(`חומרים: ${m.missing.join(', ')}`);
  }
  if (isDone(checks, 'p07.sent') && !isDone(checks, 'p07.approved')) out.push('אישור 9 הגרפיקות הראשונות');
  for (const x of shootContexts(client)) {
    const p11 = byId.get(`${x.pid}p11`);
    if (p11?.touched && !p11.complete && !isDone(checks, `${x.pre}p11.ok.client`)) out.push('אישור מועד ליום הצילום');
    if (byId.get(`${x.pid}p12`)?.complete && !isDone(checks, `${x.pre}p13.approved`)) out.push('אישור התסריטים');
    if (isDone(checks, `${x.pre}p26.sent`) && !isDone(checks, `${x.pre}p27.approved`)) out.push('הערות או אישור על הסרטונים');
  }
  return [...new Set(out)];
}

// "חודש 2 מתוך 12": the month of the contract the client is in.
const monthsBetween = (a, b) => {
  const x = partsIL(a);
  const y = partsIL(b);
  return (y.year - x.year) * 12 + (y.month - x.month) - (y.day < x.day ? 1 : 0);
};
export function contractMonth(client, now = new Date()) {
  const start = parseDate(client.deal_at);
  if (!start) return null;
  const end = parseDate(client.contract_end);
  const of = end && end > start ? Math.max(1, monthsBetween(start, end)) : 12;
  const n = Math.min(of, Math.max(1, monthsBetween(start, now) + 1));
  return { n, of, text: `חודש ${n} מתוך ${of}` };
}

// The client's place: one of the 8 stations, days in it, the next milestone, the
// current step, the last contact, what we wait for from the client and the pace.
export function station(client, state, extras = {}) {
  const now = extras.now || new Date();
  const checks = extras.checks || {};
  const index = stationOf(client, state, now);
  const since = stationSince(client, state, checks, index, now);
  const pace = deliverablesPace(client, state, checks, now);
  return {
    index, key: STATIONS[index].key, title: STATIONS[index].title,
    since, days: since ? Math.max(0, daysBetweenIL(since, now)) : null,
    next: nextMilestone(client, state, checks, now),
    current: currentStep(client, state, checks, now),
    lastContact: lastContact(client, checks, extras.messages),
    waiting: state.states.some((s) => s.status === 'client'),
    awaited: awaitedFromClient(client, state, checks),
    pace, paceText: paceText(pace),
    month: contractMonth(client, now),
  };
}

// ── The client card's timeline ──────────────
// Done (who and when; what the system did by itself is marked automatic, imported
// history as imported), now (open, with its deadline), and planned (computed
// dates; "not set yet, must be set by X" when a date is missing).
const AUTO_NOTES = [SENT_CHECK_NOTE];
export const isAutoCheck = (c) => !!c && (c.by_email === 'system' || AUTO_NOTES.includes(c.note) || /^נחתם במערכת/.test(c.note || ''));
export function timeline(client, state, checks = {}, now = new Date()) {
  const byId = new Map(state.states.map((s) => [s.proc.id, s]));
  const done = [];
  const current = [];
  const planned = [];
  for (const s of state.states) {
    if (s.proc.recurring) {
      if (s.ready) current.push({ procId: s.proc.id, what: procName(s.proc), who: responsibleOf(s, checks, client, now), until: weeklyCallDue(s, checks), status: s.status });
      continue;
    }
    if (s.complete) {
      const last = s.proc.items.filter((i) => !i.optional && checks[i.key])
        .map((i) => checks[i.key]).sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null;
      done.push({
        procId: s.proc.id, what: procName(s.proc), at: s.completedAt, by: last?.by_email || null,
        auto: isAutoCheck(last), imported: isImported(s.proc, checks), late: !!(s.dueAt && s.completedAt > s.dueAt),
      });
    } else if (s.ready) {
      current.push({ procId: s.proc.id, what: procName(s.proc), who: responsibleOf(s, checks, client, now), until: s.dueAt, status: s.status, wait: s.wait || null });
    } else {
      const when = s.startAt || s.dueAt;
      planned.push({ procId: s.proc.id, what: procName(s.proc), who: responsibleOf(s, checks, client, now), when: when || null, mustSetBy: when ? null : mustSetBy(s, byId) });
    }
  }
  done.sort((a, b) => a.at - b.at);
  current.sort((a, b) => byUrgency({ status: a.status, dueAt: a.until }, { status: b.status, dueAt: b.until }));
  return { done, current, planned };
}

// ── The owner's screen 1 ────────────────────
// One row per client: its most severe reason (and how many more). A reason about
// the whole office (a missing Thursday summary) is one row for all its clients.
// Office rows (a daily review not done) come in as they are. Most severe first.
const AGGREGATED = new Set(['thursday']);
export function ownerRows(entries, { office = [], limit = 10 } = {}) {
  const rows = [];
  const agg = new Map();
  for (const e of entries) {
    const reasons = e.health?.reasons || [];
    if (!reasons.length) continue;
    const own = reasons.filter((r) => !AGGREGATED.has(r.code));
    for (const r of reasons.filter((x) => AGGREGATED.has(x.code))) {
      if (!agg.has(r.code)) agg.set(r.code, { ...r, clients: [] });
      agg.get(r.code).clients.push(e.client);
    }
    if (own.length) {
      rows.push({
        ...own[0], key: `${e.client.id}:${own[0].code}:${own[0].procId || own[0].taskId || ''}`,
        client: e.client, station: e.station || null, more: own.length - 1, reasons: own,
      });
    }
  }
  for (const a of agg.values()) {
    rows.push({ ...a, key: a.code, client: null, what: a.clients.length === 1 ? a.clients[0].name : `${a.clients.length} לקוחות`, more: 0 });
  }
  rows.push(...office);
  rows.sort(bySeverity);
  return { rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit), total: rows.length };
}

// The daily reviews (processes 32 and 33) not done, as office rows. `reviews`:
// office_reviews rows of the last week or so.
export function officeReasons(reviews, now = new Date()) {
  if (!Array.isArray(reviews)) return [];
  const out = [];
  const has = (day, kind) => reviews.some((r) => r.day === day && r.kind === kind);
  const prev = prevBusinessDay(now);
  if (!has(dayKeyIL(prev), 'p32')) {
    out.push({ color: 'yellow', code: 'review32', rank: RANK.review32, key: 'review32', client: null, who: 'irit', text: 'הבקרה היומית לא בוצעה', what: `תהליך 32 · ${dayText(prev)}`, days: businessDaysBetween(prev, now) });
  }
  if (isBusinessDay(now)) {
    const last = reviews.filter((r) => r.kind === 'p33').map((r) => r.day).sort().at(-1) || null;
    const days = last ? businessDaysBetween(dayFromKeyIL(last), now) : null;
    if (days === null || days > 2) {
      out.push({
        color: 'yellow', code: 'review33', rank: RANK.review33, key: 'review33', client: null, who: 'ofir', text: 'בקרת הלקוחות לא בוצעה',
        what: last ? `תהליך 33 · לאחרונה ב־${dayText(dayFromKeyIL(last))}` : 'תהליך 33 · לא בוצעה בשבוע האחרון', days: days ?? 7,
      });
    }
  }
  return out;
}

// Red, yellow and green clients.
export function colorCounts(entries) {
  const out = { red: 0, yellow: 0, green: 0 };
  for (const e of entries) if (e.health?.color) out[e.health.color] += 1;
  return out;
}

// Items late right now: overdue processes (never ones waiting on the client) and overdue tasks.
export function lateNow(clients, stateOf, tasks = [], now = new Date()) {
  const live = new Map(clients.filter((c) => c.status === 'active' || c.status === 'ending').map((c) => [c.id, c]));
  let n = 0;
  for (const c of live.values()) n += stateOf(c).states.filter((s) => s.status === 'overdue').length;
  const today = dayKeyIL(now);
  n += tasks.filter((t) => !t.done_at && live.has(t.client_id) && t.due_on && t.due_on < today).length;
  return n;
}

// Shoot days (every round) within the next `days` days, from now.
export function shootsAhead(clients, now = new Date(), days = 7) {
  const until = now.getTime() + days * DAY;
  const out = [];
  for (const c of clients.filter((x) => x.status === 'active' || x.status === 'ending')) {
    for (const x of shootContexts(c)) {
      const d = parseDate(x.ctx.shoot_at);
      if (d && d >= now && d.getTime() <= until) out.push({ client: c, at: d, round: x.n });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// ── Closed processes: on time and how long ──
// Processes closed since `since`, as the performance report counts them: a process
// closed entirely as "not relevant" and imported history are left out. Waiting on
// the client already moved the deadline (decision 3) and is taken off the time;
// editing stopped for someone else's task (the pause mark, from the history in
// `log`) does the same, so neither counts against the person.
export function closedProcesses(clients, { stateOf, checksByClient = {}, since, now = new Date(), log = null } = {}) {
  const out = [];
  for (const c of clients) {
    const s = stateOf(c);
    const cs = checksByClient[c.id] || {};
    const procs = s.states.map((x) => x.proc);
    const rows = log ? rowsOf(log, c.id) : null;
    for (const x of s.states) {
      if (!x.complete || !x.completedAt || x.completedAt < since || !x.dueAt) continue;
      const req = x.proc.items.filter((i) => !i.optional);
      if (req.length && req.every((i) => cs[i.key]?.state === 'na')) continue;
      if (isImported(x.proc, cs)) continue;
      const start = durationStart(x, c, procs, cs, now);
      const paused = rows ? pausedMinutes(pausePeriods(rows, PAUSE(x.proc), x.completedAt), x.dueAt, x.completedAt) : { min: 0, ext: 0 };
      const dueAt = paused.ext ? addWorkingMinutes(x.dueAt, paused.ext) : x.dueAt;
      const worked = workedMinutes(x, start);
      out.push({
        key: baseId(x.proc.id), client: c, proc: x.proc, dueAt, completedAt: x.completedAt,
        onTime: x.completedAt <= dueAt,
        min: worked === null ? null : Math.max(0, worked - paused.min),
        targetMin: targetMinutes(x, start),
        people: x.claim ? [x.claim.person] : x.proc.owners,
        paused: paused.min,
      });
    }
  }
  return out;
}

// On time week by week over the last `weeks` Israel weeks (this one last), and in all.
export function onTimeTrend(rows, now = new Date(), weeks = 8) {
  const thisWeek = startOfDayIL(addDaysIL(atTimeIL(now, 12), -weekdayIL(now)));
  const list = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = addDaysIL(atTimeIL(thisWeek, 12), -7 * i);
    list.push({ start: startOfDayIL(start), end: startOfDayIL(addDaysIL(start, 7)), done: 0, onTime: 0 });
  }
  for (const r of rows) {
    const w = list.find((x) => r.completedAt >= x.start && r.completedAt < x.end);
    if (!w) continue;
    w.done += 1;
    if (r.onTime) w.onTime += 1;
  }
  const done = list.reduce((a, w) => a + w.done, 0);
  const onTime = list.reduce((a, w) => a + w.onTime, 0);
  return {
    weeks: list.map((w) => ({ ...w, rate: w.done ? w.onTime / w.done : null })),
    since: list[0].start, done, onTime, rate: done ? onTime / done : null,
  };
}
export const trendSince = (now = new Date(), weeks = 8) => onTimeTrend([], now, weeks).since;

// ── Screen 4: the team ──────────────────────
// Work handed for a check that came back: the 9 graphics and the rest of them
// made again (Ilai), the videos handed to Ofir again (the editor). Each time after
// the first is one return to fix, counted for the item's owner.
const REWORK = ['p07.made', 'p23.made', 'p24.notify'];
export function reworkCounts(clients, log, since = null) {
  const out = new Map();
  for (const c of clients) {
    const rows = rowsOf(log, c.id);
    if (!rows.length) continue;
    for (const p of applicableProcesses(c)) {
      for (const i of p.items) {
        if (!REWORK.includes(i.key.replace(/^r\d+\./, ''))) continue;
        const ev = doneEvents(rows, i.key).slice(1).filter((r) => !since || new Date(r.at) >= since);
        if (!ev.length) continue;
        for (const o of i.owners.filter((k) => k !== 'editor')) out.set(o, (out.get(o) || 0) + ev.length);
      }
    }
  }
  return out;
}

// Items whose whole history counts: returns to fix and rounds of corrections. A
// window of the log would take the first event inside it for the original.
const HISTORY = [...REWORK, 'p07.sent', 'p23.sent', 'p27.notes'];
export function historyKeys(clients) {
  const out = new Set();
  for (const c of clients) {
    for (const p of applicableProcesses(c)) for (const i of p.items) if (HISTORY.includes(i.key.replace(/^r\d+\./, ''))) out.add(i.key);
  }
  return [...out].sort();
}
// The log of a period, with the whole history of those items in place of its part of it.
export function withHistory(log, history, keys) {
  if (!log || !history) return log;
  const set = new Set(keys);
  return [...log.filter((r) => !set.has(r.item_key)), ...history.filter((r) => set.has(r.item_key))];
}

// "Not relevant" on a required item, and deadline changes, by who marked them
// (anti-gaming, section 6). `directory`: email -> person.
const REQUIRED = new Set(PROCESSES.flatMap((p) => p.items.filter((i) => !i.optional).map((i) => i.key)));
export function naCounts(log, directory = {}, since = null) {
  const out = new Map();
  for (const r of log || []) {
    if (r.action !== 'na' || (since && new Date(r.at) < since)) continue;
    if (!REQUIRED.has(String(r.item_key).replace(/^r\d+\./, ''))) continue;
    const who = directory[String(r.by_email || '').toLowerCase()];
    if (who) out.set(who, (out.get(who) || 0) + 1);
  }
  return out;
}
export function moveCounts(changes, directory = {}, since = null) {
  const out = new Map();
  for (const r of changes || []) {
    if (since && new Date(r.at) < since) continue;
    const who = directory[String(r.by_email || '').toLowerCase()];
    if (who) out.set(who, (out.get(who) || 0) + 1);
  }
  return out;
}

const median = (list) => {
  const d = list.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (!d.length) return null;
  return d.length % 2 ? d[(d.length - 1) / 2] : Math.round((d[d.length / 2 - 1] + d[d.length / 2]) / 2);
};

// One row per person for screen 4. `work(key)`: their open work groups ("my
// work": { status, dueAt, task }); `rows`: closedProcesses of the period; `jobs(key)`:
// editing jobs an editor holds now (null for anyone else).
export function teamRows(keys, { work, rows = [], log = null, changes = null, directory = {}, jobs = () => null, clients = [], since = null, now = new Date() }) {
  const rework = reworkCounts(clients, log, since);
  const na = naCounts(log, directory, since);
  const moves = changes ? moveCounts(changes, directory, since) : null;
  return keys.map((key) => {
    const w = work(key);
    const mine = rows.filter((r) => r.people.includes(key));
    const onTime = mine.filter((r) => r.onTime).length;
    const load = jobs(key);
    return {
      key,
      open: w.filter((g) => g.status !== 'client').length,
      late: w.filter((g) => g.status === 'overdue').length,
      week: w.filter((g) => g.status !== 'overdue' && g.status !== 'client' && ['today', 'tomorrow', 'week'].includes(bucketOf(g.status, g.dueAt, now))).length,
      done: mine.length, onTime, rate: mine.length ? onTime / mine.length : null,
      median: median(mine.map((r) => r.min)), norm: median(mine.map((r) => r.targetMin)),
      load, cap: load === null ? null : EDITOR_CAP,
      rework: rework.get(key) || 0, na: na.get(key) || 0, moves: moves ? moves.get(key) || 0 : null,
    };
  });
}

// ── Screen 2: what happens this week / this month ──
// Characterization meetings, shoot days, videos closing, campaigns and renewals
// across the clients, from the start of today to `days` days on.
export function upcomingEvents(clients, stateOf, now = new Date(), days = 7, checksByClient = {}) {
  const from = startOfDayIL(now);
  const until = endOfDayIL(addDaysIL(atTimeIL(now, 12), days - 1));
  const out = [];
  for (const c of clients.filter((x) => x.status === 'active' || x.status === 'ending')) {
    const s = stateOf(c);
    const byId = new Map(s.states.map((x) => [x.proc.id, x]));
    const add = (at, kind, label, who, st) => {
      if (at && at >= from && at <= until) out.push({ at, kind, label, client: c, who, done: !!st?.complete, procId: st?.proc.id || null });
    };
    const p04 = byId.get('p04');
    add(parseDate(c.char_at), 'char', 'פגישת אפיון', c.characterizer || 'ofir', p04);
    for (const x of shootContexts(c)) {
      const round = x.n > 1 ? ` · סבב ${x.n}` : '';
      add(parseDate(x.ctx.shoot_at), 'shoot', `יום צילום${round}`, 'lior', byId.get(`${x.pid}p19`));
      const p27 = byId.get(`${x.pid}p27`);
      if (p27) add(p27.dueAt || promisedClosing(x.ctx.shoot_at), 'delivery', `סגירת הסרטונים${round}`, responsibleOf(p27, checksByClient[c.id] || {}, c, now), p27);
      const p30 = byId.get(`${x.pid}p30`);
      if (p30) add(p30.dueAt, 'campaign', `קמפיין${round}`, 'lior', p30);
    }
    const p34 = byId.get('p34');
    if (p34) add(p34.startAt, 'renewal', 'חידוש: מתחילים לדבר על ההמשך', 'lior', p34);
    const end = parseDate(c.contract_end);
    if (end) add(endOfDayIL(end), 'renewal', 'סיום החוזה', 'lior', null);
  }
  return out.sort((a, b) => a.at - b.at);
}

export const personName = (k) => PEOPLE[k]?.name || k || '';
