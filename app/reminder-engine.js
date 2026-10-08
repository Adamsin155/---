// The reminder engine (stage 3; docs/plan/system-plan.md, principle 4 and
// section 5): the ladders of app/reminder-rules.js evaluated against the
// clients, their checks and tasks at one moment, and what to do with each step
// at that moment (push, a digest line, a batch of lateness notes, or held back). Pure, no
// DOM and no network, Israel time only: the server tick
// (supabase/functions/reminders) runs it every minute, and the unit tests run it
// at fixed moments.
//
//   computeReminders(input) → the steps due now that are not in the log yet:
//     [{ key, rule, step, person, level, title, body, url, exempt, escalation,
//        at, clientId, ref, shoot, exception, list, overdue }]
//     The key is stable (`rule:client:case:step@person`), so each ladder step goes
//     out once: the log's unique key is the dedupe.
//   planDelivery({ reminders, now, liorShoot }) → the same with
//     { channel: push | app | digest, status: sent | queued | suppressed, reason }
//     after the sending hours and Lior's shoot day. Since the owner's rule of
//     7.10.2026 ("אין הודעות שקטות, הכל מקבל התראה לפלאפון") every step reaches the
//     phone: a ring and an update ('quiet') as a push of their own, a lateness note
//     in a batch, a digest line and the owner's board in a digest; and there is no
//     daily cap.
//   planDigests({ env, now, log, active, lookahead }) → the digests due now, and the
//     batches of lateness notes.
import {
  RULES, OWNER, timeOf, inSendHours, atIL, STALE_MINUTES, FOLD, DIGESTS, RING_TARGETS, personName, MINE_URL,
  baseId, RULE_BY_ID, ruleOfKey, FACTS, stepOfKey, SHOOT_COPY, OWNER_LATE_HOURS, NAG, BATCH, LATE_BATCH_MINUTES, BURST, BURST_MAX, OFF, ownerDigestAt,
} from './reminder-rules.js';
import { daySummary, pushLines, EOD } from './day-summary.js';
import { clientState, openItemsFor, parseDate, isBusinessDay, roundsOf, pauseOf, clientLabel } from './protocol-logic.js';
import { STAFF_PEOPLE, TEAM_PEOPLE } from './protocol.js';
import { ofirMeetings as meetingsOf } from './office-marks.js';
import { dayKeyIL, atTimeIL, dayFromKeyIL, weekdayIL, addDaysIL, endOfDayIL } from './tz.js';
import { shootCases, quietWindow } from './production.js';

const MIN = 6e4;
const live = (c) => c.status === 'active' || c.status === 'ending';
const asDate = (v) => (v ? new Date(v) : null);

// Checks as the app keeps them ({ clientId: { key: row } }); rows are accepted too.
function groupChecks(checks) {
  if (!Array.isArray(checks)) return checks || {};
  const out = {};
  for (const r of checks) (out[r.client_id] ||= {})[r.item_key] = r;
  return out;
}

// Everything the rules read, built once per tick.
export function buildEnv({
  clients = [], checks = {}, tasks = [], staff = [], access = [], reviews = [], statusNotes = [], messages = [], subscriptions = [], now = new Date(),
  monthMarks = [], // stage 5: public.client_month_marks rows (app/year-rules.js)
  deals = [], // 3.10.2026: public.deal_requests rows (Stav's deals, app/deal-logic.js)
  accessLinks = [], // 6.10.2026: public.client_access_links rows (the client's logins form, app/access-logic.js)
  ganttFailures = [], // 6.10.2026: public.client_gantt rows whose post failed in Metricool (mc_status 'error')
  approvals = [], // 6.10.2026: public.quotes rows that went for a manager's approval (app/approvals-logic.js)
  unsigned = [], // 8.10.2026: public.quotes rows sent for signature and not signed (app/unsigned-logic.js)
  staffTasks = [], // 6.10.2026: public.staff_tasks rows, the tasks given on the spot (app/staff-tasks-logic.js)
  availability = { months: [], changes: [] }, // 7.10.2026: the photographer's free dates and unexpected changes (app/availability-logic.js)
  shootTold = [], // 7.10.2026: public.reminder_log rows of the rule `shootSet` (what the photographer was told of each shoot day)
  // 8.10.2026, what one person tells another (docs/ops.md, section 45):
  questions = [], // public.client_questions rows: the open ones and those answered lately
  changeRequests = [], // public.change_requests rows: the open ones and those decided lately
  decisions = [], // public.task_decisions rows of the last days (Lior's decisions on exceptions)
}) {
  const byClient = groupChecks(checks);
  const liveClients = clients.filter(live);
  const states = new Map();
  const people = new Map(); // email -> person key ('owner' for the owner's row)
  for (const s of staff) {
    if (!s.email) continue;
    if (s.person === null || s.person === undefined) people.set(s.email.toLowerCase(), OWNER);
    else if (s.person !== 'editor') people.set(s.email.toLowerCase(), s.person);
  }
  const subscribedEmails = new Set(subscriptions.map((x) => String(x.email || '').toLowerCase()));
  const env = {
    now,
    clients: liveClients,
    clientById: new Map(liveClients.map((c) => [c.id, c])),
    checksOf: (c) => byClient[c.id] || {},
    stateOf(c) {
      if (!states.has(c.id)) states.set(c.id, clientState(c, byClient[c.id] || {}, now));
      return states.get(c.id);
    },
    tasks: tasks.filter((t) => !t.done_at),
    // Tasks finished lately (the server loads the last two days): "the requester hears".
    doneTasks: tasks.filter((t) => t.done_at),
    access, reviews, statusNotes, messages, subscriptions, staff, monthMarks, deals, accessLinks, ganttFailures, approvals, unsigned, staffTasks, availability, shootTold, questions, changeRequests, decisions,
    personOf: (email) => people.get(String(email || '').toLowerCase()) || null,
    emailsOf: (person) => [...people].filter(([, p]) => p === person).map(([e]) => e),
    hasStaff: (person) => [...people.values()].includes(person),
    connected: (person) => env.emailsOf(person).some((e) => subscribedEmails.has(e)),
  };
  env.ofirMeetings = ofirMeetings(env);
  env.liorShoot = liorShoot(env);
  return env;
}

// Ofir's characterization meetings (decision 11 stops his quality clock meanwhile):
// app/office-marks.js, shared with his screen.
const ofirMeetings = (env) => meetingsOf(env.clients, env.checksOf);

// Lior on a shoot (decision 8 and "מצב שקט"), a flag recorded in the checks: from
// Eli's "הגעתי" (p17b.arrived; or Lior's own start, p18.quiet) until the drive is
// back and confirmed by both (p19b.handed and p19.took), the day is closed (19) or
// the day ends (app/production.js quietWindow). Meanwhile his exceptions go to Ofir
// and his other rings wait for one summary after it.
export function liorShoot(env) {
  const now = env.now;
  const cids = new Set();
  for (const c of env.clients) {
    for (const sc of shootCases(c)) {
      if (dayKeyIL(sc.shootAt) !== dayKeyIL(now)) continue;
      const p19 = env.stateOf(c).states.find((s) => s.proc.id === (sc.pre ? `r${sc.n}-p19` : 'p19'));
      const w = quietWindow(sc, env.checksOf(c), p19?.complete ? p19.completedAt : null);
      if (w && now >= w.from && now < w.to) cids.add(c.id);
    }
  }
  return { active: cids.size > 0, cids };
}

// Items added to the protocol after a client started are work, never late
// (app/protocol-versions.js; the plan, stage 5). A rule says which item its case is
// about with `fresh(inst)`; otherwise a case of a process that is new as a whole for
// this client (every required item fresh: 12א for a version 1 client, 17ב–19ב
// before version 4) counts as fresh. The `overdue` steps of a fresh case are skipped.
export function freshCase(rule, inst) {
  if (typeof rule.fresh === 'function') return !!rule.fresh(inst);
  const items = (inst?.proc?.items || []).filter((i) => !i.optional);
  return items.length > 0 && items.every((i) => i.fresh);
}

// Every step of every live ladder due by `until` (default: now), log or not.
export function candidates(env, { until = env.now } = {}) {
  const out = [];
  const today = atTimeIL(env.now, 0);
  for (const rule of RULES) {
    for (const inst of rule.instances(env)) {
      const anchors = { today, ...inst.anchors };
      const steps = typeof rule.steps === 'function' ? rule.steps(inst, env) : rule.steps;
      const who = (step) => [typeof step.to === 'function' ? step.to(inst, env) : step.to].flat().filter((p) => p && p !== 'editor');
      const due = [];
      const fresh = freshCase(rule, inst);
      for (const [n, step] of steps.entries()) {
        if (fresh && step.overdue) continue;
        const at = timeOf(step, anchors);
        if (!at) continue;
        if (step.expires && anchors[step.expires] && env.now >= anchors[step.expires]) continue;
        if (step.when && !step.when(inst, env)) continue;
        // Where it goes if nobody acts: the next step for someone else.
        const mine = who(step);
        const next = steps.slice(n + 1).flatMap(who).find((p) => !mine.includes(p)) || null;
        due.push({ step, at, persons: mine, escalation: next });
      }
      // "לדחות עד…": what came due meanwhile waits for that moment, as one step (the latest).
      if (inst.snooze) {
        const held = due.filter((d) => d.at < inst.snooze);
        const last = held.sort((a, b) => a.at - b.at).at(-1);
        for (const d of held) d.drop = d !== last;
        if (last) last.at = inst.snooze;
      }
      for (const d of due) {
        if (d.drop || d.at > until) continue;
        for (const person of d.persons) {
          out.push({
            key: `${rule.id}:${inst.cid || '-'}:${inst.id}:${d.step.id}@${person}`,
            rule: rule.id, step: d.step.id, person, level: d.step.level,
            exempt: d.step.exempt || null, shoot: !!d.step.shoot, ownHours: !!d.step.ownHours, exception: !!d.step.exception,
            list: !!d.step.list, overdue: !!d.step.overdue, batch: !!d.step.batch, noFold: !!d.step.noFold, escalation: d.escalation,
            at: d.at, clientId: inst.cid || null, ref: inst.ref || null, url: (d.step.url ? d.step.url(inst, env) : inst.url) || MINE_URL,
            title: d.step.title(inst, env), body: d.step.body ? d.step.body(inst, env) : '',
            // The step follows whoever holds the work (planHandover): what the one before is told, if anything.
            handover: !d.step.handover ? null : d.step.handover === true ? {} : {
              title: d.step.handover.title(inst, env), body: d.step.handover.body ? d.step.handover.body(inst, env) : '', url: d.step.handover.url ? d.step.handover.url(inst, env) : MINE_URL,
            },
          });
        }
      }
    }
  }
  // Decision 8: on Lior's shoot day his exceptions go to Ofir (the key stays his,
  // so the step still goes out once), and Lior gets them in his summary after the
  // day ("ליאור מקבל סיכום בסוף היום"): a copy of each, held for it.
  if (env.liorShoot.active) {
    const copies = [];
    for (const r of out) {
      if (r.person === 'lior' && r.exception && !env.liorShoot.cids.has(r.clientId)) {
        copies.push({ ...r, key: `${r.key}${SHOOT_COPY}`, exception: false, exempt: null, copy: true, title: `הועבר לאופיר · ${r.title}` });
        r.person = 'ofir';
        r.title = `ליאור ביום צילום · ${r.title}`;
      }
    }
    out.push(...copies);
  }
  return out;
}

const keysOf = (log) => (log instanceof Set ? log : new Set([...(log || [])].map((x) => (typeof x === 'string' ? x : x.key))));
// Whether a step is not in the log yet. Lior's copy of an exception (decision 8)
// is new only with the exception itself: one he already got before the shoot is
// not in his summary.
export const notKnown = (known) => (r) => !known.has(r.key) && !(r.copy && known.has(r.key.slice(0, -SHOOT_COPY.length)));

// The steps due now that the log does not have yet (spec: computeReminders).
export function computeReminders({ log = [], until, env = null, ...input }) {
  const e = env || buildEnv(input);
  return candidates(e, { until }).filter(notKnown(keysOf(log)));
}

// ── Work that passed to someone else ──────
// A step that follows whoever holds the work (`handover` in app/reminder-rules.js: the
// assigned editor, the owner of a task) is keyed by its person, and its moment is when
// the work started. When the work passes to someone else days later, the step is new
// for them and long past its moment: it used to be recorded as stale, so the new editor
// of a late job was never told (found in the audit of 8.10.2026). `siblings`: the log's
// rows of the same step of the same case (the key up to its '@'), of anyone. When
// someone else was already told, this is a handover: the step is due now, and with a
// handover text the one who had it last is told once that it passed on (the step
// `off`; its key carries the row it follows, so a job that changes hands again is told
// again). With no sibling it is a first assignment, and nothing changes.
const beforeAt = (key) => String(key).slice(0, String(key).lastIndexOf('@'));
export const handoverPrefixes = (reminders) => [...new Set(reminders.filter((r) => r.handover).map((r) => beforeAt(r.key)))];
export function planHandover({ reminders, siblings = [], now }) {
  const out = [];
  for (const r of reminders) {
    const others = r.handover ? siblings.filter((s) => beforeAt(s.key) === beforeAt(r.key) && s.person !== r.person) : [];
    if (!others.length) { out.push(r); continue; }
    const last = others.reduce((a, b) => ((Number(b.id) || 0) > (Number(a.id) || 0) ? b : a));
    out.push({ ...r, at: now, passed: true });
    if (!r.handover.title || last.person === r.person) continue;
    const base = beforeAt(r.key).split(':').slice(0, -1).join(':'); // rule:client:case
    out.push({
      ...r, key: `${base}#${last.id}:${OFF}@${last.person}`, step: OFF, person: last.person, level: 'quiet', exempt: null, shoot: false, ownHours: false,
      exception: false, list: false, overdue: false, batch: false, escalation: null, at: now, title: r.handover.title, body: r.handover.body, url: r.handover.url, handover: null,
    });
  }
  return out;
}

// ── Delivery ──────────────────────────────
// A ring that went (or is going, 'pending') to the phone.
const isPushRing = (row) => row.level === 'ring' && row.channel === 'push' && (row.status === 'sent' || row.status === 'pending');
// Whether the owner's digest of the day is behind us (or there is none today): a
// line for his board from then on waits for his next digest instead of missing it.
const afterOwnerDigest = (now) => !isBusinessDay(now) || now >= atIL(now, ownerDigestAt(now));

// What happens to each new step now (the owner's rule of 7.10.2026: everything
// reaches the phone, and there is no daily cap).
//   a digest line          waits for the next digest, which is one push;
//   the owner's board      is on his screen at once and in his end-of-day message; after
//                          it (or on a closed day) it waits for his next digest;
//   a ring and an update   ('quiet') are pushed now. Outside the sending hours they
//                          wait for the next digest (a shoot-day event does not, nor a
//                          rule that keeps its own hours); on Lior's shoot day his wait
//                          for the summary after it;
//   a lateness note        (`batch`) waits for its batch: one push per person at most
//                          every LATE_BATCH_MINUTES (planDigests).
// Nothing is sent late: a step that should have gone out hours ago is recorded as stale.
export function planDelivery({ reminders, now, liorShoot = { active: false, cids: new Set() } }) {
  const sorted = [...reminders].sort((a, b) => (a.at - b.at) || (!!b.exempt - !!a.exempt));
  const out = sorted.map((r) => {
    const age = (now - r.at) / MIN;
    if (age > STALE_MINUTES[r.level]) return { ...r, channel: r.level === 'digest' ? 'digest' : 'app', status: 'suppressed', reason: 'stale' };
    if (r.copy) return { ...r, channel: 'digest', status: 'queued', reason: 'shoot_mode' }; // decision 8: for Lior's summary only
    if (r.level === 'board') return afterOwnerDigest(now) ? { ...r, channel: 'digest', status: 'queued', reason: 'owner_digest' } : { ...r, channel: 'app', status: 'sent', reason: null };
    if (r.level === 'digest') return { ...r, channel: 'digest', status: 'queued', reason: null };
    if (!r.shoot && !r.ownHours && !inSendHours(now)) return { ...r, channel: 'digest', status: 'queued', reason: 'quiet_hours' };
    if (r.person === 'lior' && liorShoot.active && !r.shoot && !liorShoot.cids.has(r.clientId)) return { ...r, channel: 'digest', status: 'queued', reason: 'shoot_mode' };
    if (r.batch) return { ...r, channel: 'digest', status: 'queued', reason: BATCH };
    return { ...r, channel: 'push', status: 'sent', reason: null };
  });
  // A burst: more than BURST_MAX pushes for one person in this one minute go out as one
  // push that lists them (planDigests, this same minute), not as a pile of banners.
  const held = (r) => r.channel === 'push' && !r.shoot && !r.ownHours;
  const count = new Map();
  for (const r of out) if (held(r)) count.set(r.person, (count.get(r.person) || 0) + 1);
  return out.map((r) => (held(r) && count.get(r.person) > BURST_MAX ? { ...r, channel: 'digest', status: 'queued', reason: BURST } : r));
}

// ── Digests ───────────────────────────────
// A person's open work across clients: what is late and what is due today.
export function personWork(env, person) {
  const overdue = [];
  const today = [];
  const todayKey = dayKeyIL(env.now);
  for (const c of env.clients) {
    const seen = new Set();
    for (const e of openItemsFor(person, c, env.checksOf(c), env.stateOf(c), env.now)) {
      if (seen.has(e.proc.id) || (e.status !== 'overdue' && e.status !== 'today')) continue;
      seen.add(e.proc.id);
      (e.status === 'overdue' ? overdue : today).push({ client: clientLabel(c), what: e.proc.title, at: e.dueAt });
    }
  }
  for (const t of env.tasks) {
    const c = env.clientById.get(t.client_id);
    if (!c || t.owner !== person || !t.due_on) continue;
    if (t.due_on < todayKey) overdue.push({ client: clientLabel(c), what: t.title, at: dayFromKeyIL(t.due_on) });
    else if (t.due_on === todayKey) today.push({ client: clientLabel(c), what: t.title, at: dayFromKeyIL(t.due_on) });
  }
  const by = (a, b) => (a.at || 0) - (b.at || 0);
  return { overdue: overdue.sort(by), today: today.sort(by) };
}

const short = (list, max = 3) => (list.length > max ? `${list.slice(0, max).join(', ')} ועוד ${list.length - max}` : list.join(', '));
const TOPIC = (rule) => RULE_BY_ID.get(rule)?.event || rule;
// "אלפא (2), בטא": each client once, with how many things of it.
const perClient = (names) => {
  const counts = new Map();
  for (const x of names) counts.set(x, (counts.get(x) || 0) + 1);
  return [...counts].map(([x, k]) => (k > 1 ? `${x} (${k})` : x));
};

// Lines of a digest: one line per topic, with a count when several (section 3:
// "שורה לכל נושא עם מספר"), late things first, each client once per line. At
// most `max` lines; the last one says how many more are in "המשימות שלי".
export function digestLines({ work = { overdue: [], today: [] }, rows = [], max = 5, clientName = () => '' }) {
  const lines = [];
  const workLine = (label, list) => {
    if (!list.length) return null;
    const clients = perClient(list.map((x) => x.client));
    if (list.length === 1) return `${label}: ${list[0].client} · ${list[0].what}`;
    return clients.length === 1 ? `${label}: ${clients[0]}` : `${label} (${list.length}): ${short(clients)}`;
  };
  const late = workLine('באיחור', work.overdue);
  if (late) lines.push({ rank: 0, text: late });
  const groups = new Map();
  for (const r of rows) {
    const g = r.rule || ruleOfKey(r.key);
    if (!groups.has(g)) groups.set(g, new Map());
    // Several steps of one ladder for one client: the latest says it.
    const cid = r.client_id ?? r.clientId ?? r.key;
    const byClient = groups.get(g);
    const prev = byClient.get(cid);
    const when = (x) => new Date(x.due_at || x.at || x.created_at || 0).getTime();
    if (!prev || when(r) >= when(prev)) byClient.set(cid, { ...r, overdue: r.overdue || prev?.overdue });
  }
  for (const [g, byClient] of groups) {
    const list = [...byClient.values()];
    const rank = list.some((r) => r.overdue) ? 1 : 2;
    if (list.length === 1) { lines.push({ rank, text: list[0].title }); continue; }
    const who = list.map((r) => clientName(r.client_id ?? r.clientId)).filter(Boolean);
    lines.push({ rank, text: `${TOPIC(g)} (${list.length}): ${who.length === list.length ? short(who) : list.map((r) => r.title).slice(0, 2).join(' · ')}` });
  }
  const today = workLine('היום', work.today);
  if (today) lines.push({ rank: 3, text: today });
  lines.sort((a, b) => a.rank - b.rank);
  if (lines.length <= max) return lines.map((l) => l.text);
  const kept = lines.slice(0, max - 1).map((l) => l.text);
  return [...kept, `ועוד ${lines.length - kept.length} נושאים ב״המשימות שלי״`];
}

// The digests due at `now` (each goes out within an hour of its time, once: the
// key is its dedupe). `log`: queued rows and the rows of this week. `active`: the
// keys of every step still live now (a queued line that was resolved meanwhile is
// dropped). `lookahead`: steps due by 09:30 today, for the 08:30 digest.
export function planDigests({ env, now = env.now, log = [], active = new Set(), lookahead = [] }) {
  const out = [];
  const day = dayKeyIL(now);
  const within = (hhmm) => { const t = atIL(now, hhmm); return now >= t && now - t < 60 * MIN; };
  const queuedFor = (person) => log.filter((r) => r.status === 'queued' && r.person === person);
  const clientName = (id) => env.clientById.get(id)?.name || '';
  // A queued line is carried only while it is still true (or it reports a fact, like
  // an exception Ofir took on Lior's shoot day).
  const holds = (r) => active.has(r.key) || FACTS.has(stepOfKey(r.key)) || String(r.key).endsWith(SHOOT_COPY);
  const split = (rows) => ({ keep: rows.filter(holds), drop: rows.filter((r) => !holds(r)) });
  // The morning digest: the protocol's people, and anyone else on the team (sales)
  // with a line that waited for the morning, so that nothing stays in the app only.
  const staffPeople = TEAM_PEOPLE().map((p) => p.key).filter((k) => env.hasStaff(k));
  const business = isBusinessDay(now);

  if (business && within(DIGESTS.morning)) {
    const foldFrom = atIL(now, FOLD.from);
    const foldTo = atIL(now, FOLD.to);
    const known = new Set(log.map((r) => r.key));
    for (const person of staffPeople) {
      const { keep, drop } = split(queuedFor(person));
      const fold = lookahead.filter((r) => r.person === person && r.level === 'ring' && !r.shoot && !r.batch && !r.noFold && r.at >= foldFrom && r.at <= foldTo && !known.has(r.key));
      const work = personWork(env, person);
      const lines = digestLines({ work, rows: [...keep, ...fold], max: 5, clientName });
      if (!lines.length) { if (drop.length) out.push({ key: null, person, drop }); continue; }
      out.push({ key: `digest:morning:${person}:${day}`, kind: 'morning', person, title: 'תקציר בוקר', lines, url: MINE_URL, include: keep, drop, fold });
    }
  }
  if (business) {
    for (const t of DIGESTS.lists) {
      // Not after the office closed on erev chag (the 16:00 list): its lines wait for the morning.
      if (!within(t) || !inSendHours(atIL(now, t))) continue;
      const { keep, drop } = split(queuedFor('lior'));
      if (env.liorShoot.active) { if (drop.length) out.push({ key: null, person: 'lior', drop }); continue; }
      const lines = digestLines({ rows: keep, max: 8, clientName });
      if (!lines.length) { if (drop.length) out.push({ key: null, person: 'lior', drop }); continue; }
      out.push({ key: `digest:list${t.slice(0, 2)}:lior:${day}`, kind: 'list', person: 'lior', title: `הרשימה של ${t}`, lines, url: MINE_URL, include: keep, drop });
    }
  }
  // After the shoot: what waited for Lior meanwhile, in one message, on the shoot
  // day itself or within the sending hours (a shoot day never closed ends at
  // midnight: then the morning digest carries it), and unless a list or his morning
  // digest goes out at this very moment and carries it.
  const heldForShoot = queuedFor('lior').filter((r) => r.reason === 'shoot_mode');
  const heldToday = heldForShoot.some((r) => !r.created_at || dayKeyIL(asDate(r.created_at)) === day);
  if (heldForShoot.length && !env.liorShoot.active && (heldToday || inSendHours(now)) && !out.some((d) => d.person === 'lior' && d.key)) {
    const { keep, drop } = split(queuedFor('lior'));
    const lines = digestLines({ rows: keep, max: 8, clientName });
    const last = Math.max(...heldForShoot.map((r) => Number(r.id) || 0));
    if (lines.length) out.push({ key: `digest:shoot:lior:${day}:${last}`, kind: 'shoot', person: 'lior', title: 'סיכום אחרי יום הצילום', lines, url: MINE_URL, include: keep, drop });
    else if (drop.length) out.push({ key: null, person: 'lior', drop });
  }
  // The owners' end of the day (8.10.2026; docs/ops.md, section 48): at the END of the
  // sending window (19:00; 13:00 on erev chag), every working day, also when nothing is
  // late. The push says the numbers by itself and opens the table (owner.html#eod), which
  // computes the same summary (app/day-summary.js). It replaced the 18:00 digest "חריגות
  // היום": what that one carried besides the lateness (the lines of the owners' board, and
  // the weekly report on the last working day of the week) is under the numbers here.
  // A digest is pushed by the tick itself, so the end of the window does not hold it.
  if (env.hasStaff(OWNER) && business && within(ownerDigestAt(now))) {
    const sinceDay = log.filter((r) => r.person === OWNER && r.level === 'board' && r.status === 'sent' && dayKeyIL(asDate(r.created_at)) === day);
    const { keep, drop } = split([...sinceDay, ...queuedFor(OWNER)]);
    const board = digestLines({ rows: keep, max: 10, clientName });
    let lines = [...pushLines(summaryOf(env, now)), ...(board.length ? ['עוד מהיום:', ...board] : [])];
    // The weekly report: Thursday, or the last business day of the week when Thursday is a holiday.
    const weekly = lastBusinessDayOfWeek(now);
    if (weekly) lines = [...lines, ...weeklyReport(env, log, now)];
    out.push({ key: `digest:eod:owner:${day}`, kind: 'owner', person: OWNER, title: weekly ? 'סיכום היום ודוח שבועי' : 'סיכום היום', lines, url: EOD.url, include: keep.filter((r) => r.status === 'queued'), drop: drop.filter((r) => r.status === 'queued') });
  }
  if (env.hasStaff(OWNER) && business && within(DIGESTS.ownerWeek) && firstBusinessDayOfWeek(now)) {
    // Also what waited for the owner since the last digest (an immediate case that
    // came on the weekend, like a renewal 30 days before on a Saturday).
    const { keep, drop } = split(queuedFor(OWNER));
    const lines = [...digestLines({ rows: keep, max: 5, clientName }), ...weekAhead(env, now)];
    out.push({ key: `digest:week:owner:${day}`, kind: 'week', person: OWNER, title: 'השבוע הקרוב', lines, url: 'clients.html', include: keep, drop });
  }
  // A digest that goes out this minute carries the waiting lateness notes of its
  // person (one that already went out earlier in its hour does not).
  const sentKeys = new Set(log.map((r) => r.key));
  const taken = new Set(out.filter((d) => d.key && !sentKeys.has(d.key)).map((d) => d.person));
  out.push(...lateBatches({ env, now, log, holds, taken }));
  // A burst (planDelivery): what was held this minute for one push goes out now, as one.
  // Each line is a topic with its clients, as in a digest; each step stays its own row
  // in "התראות". (One that could not go now waits like any queued line, for the next digest.)
  const bursts = log.filter((r) => r.status === 'queued' && r.reason === BURST);
  for (const person of new Set(bursts.map((r) => r.person))) {
    if (taken.has(person) || !inSendHours(now) || (person === 'lior' && env.liorShoot.active)) continue;
    const mine = bursts.filter((r) => r.person === person);
    const keep = mine.filter(holds).sort((a, b) => (!!b.exempt - !!a.exempt) || (Number(a.id) || 0) - (Number(b.id) || 0));
    const drop = mine.filter((r) => !holds(r));
    if (!keep.length) { if (drop.length) out.push({ key: null, person, drop }); continue; }
    const last = Math.max(...keep.map((r) => Number(r.id) || 0));
    out.push({ key: `digest:burst:${person}:${day}:${last}`, kind: 'burst', person, title: `${keep.length} הודעות חדשות`, lines: digestLines({ rows: keep, max: 8, clientName }), url: MINE_URL, include: keep, drop });
  }
  return out.map((d) => (d.key ? { ...d, body: d.lines.join('\n') } : d));
}

// The owners' end-of-day table from what the engine loaded (the page builds the same
// from what it loaded: app/owner.js).
export const summaryOf = (env, now = env.now) => daySummary({ clients: env.clients, checksOf: env.checksOf, stateOf: env.stateOf, tasks: env.tasks, personOf: env.personOf, now });

// The lateness notes (`batch` steps: every late item to Ofir and Lior, a late task to
// its owner and whoever opened it, a client's fix that is late) go to the phone
// together, never one push per item (the owner's rule of 7.10.2026). For each person
// with notes waiting: the first one goes out at once; from then on at most one push
// every LATE_BATCH_MINUTES, with everything that became late meanwhile ("3 איחורים
// חדשים", the first few, and how many today). So a note waits half an hour at most,
// and a morning with twenty late items is one or two pushes. Each note stays its own
// row in "התראות" (the tick marks it sent with its batch). Not outside the sending
// hours and not on Lior's shoot day (then the next digest or his summary carries
// them, as it carries every waiting line), and not when a digest of that person goes
// out this very minute (`taken`): it carries them. A note that is no longer true (the
// item was done meanwhile) is dropped, as in every digest.
export function lateBatches({ env, now = env.now, log = [], holds = () => true, taken = new Set() }) {
  const out = [];
  if (!inSendHours(now)) return out;
  const day = dayKeyIL(now);
  const waiting = log.filter((r) => r.status === 'queued' && r.reason === BATCH);
  for (const person of new Set(waiting.map((r) => r.person))) {
    if (taken.has(person) || (person === 'lior' && env.liorShoot.active)) continue;
    const mine = waiting.filter((r) => r.person === person);
    const keep = mine.filter(holds);
    const drop = mine.filter((r) => !holds(r));
    const prefix = `digest:late:${person}:`;
    const before = log.filter((r) => String(r.key).startsWith(prefix));
    const lastAt = Math.max(0, ...before.map((r) => +asDate(r.created_at || r.sent_at) || 0));
    if (!keep.length || now - lastAt < LATE_BATCH_MINUTES * MIN) { if (drop.length) out.push({ key: null, person, drop }); continue; }
    const last = Math.max(...keep.map((r) => Number(r.id) || 0));
    // How many he heard of today, these included: the banner on the phone replaces the one before.
    const today = keep.length + log.filter((r) => r.person === person && r.reason === BATCH && r.status === 'sent' && dayKeyIL(asDate(r.sent_at || r.created_at)) === day).length;
    const sum = today > keep.length ? [`היום עד עכשיו: ${today} איחורים. הכול ב״התראות״.`] : [];
    // A batch that carries a ring (the ladder of a late item, section 48) is a ring itself.
    const d = { key: `${prefix}${day}:${last}`, kind: 'late', level: keep.some((r) => r.level === 'ring') ? 'ring' : 'digest', person, include: keep, drop };
    if (keep.length === 1) out.push({ ...d, title: keep[0].title, lines: [keep[0].body, ...sum].filter(Boolean), url: keep[0].url || MINE_URL });
    else {
      // All of one kind ("באיחור: …"): the word is in the title once. Mixed: each line says what it is.
      const plain = keep.every((r) => /^באיחור: /.test(String(r.title)));
      const names = keep.map((r) => (plain ? String(r.title).replace(/^באיחור: /, '') : String(r.title)));
      out.push({ ...d, title: plain ? `${keep.length} איחורים חדשים` : `${keep.length} עדכוני איחור`, lines: [...names.slice(0, 4), ...(names.length > 4 ? [`ועוד ${names.length - 4}`] : []), ...sum], url: MINE_URL });
    }
  }
  return out;
}

// The owner's daily summary of lateness (the owner's decision of 3.10.2026): every
// process and task of every employee that is 24 hours late or more at `now`, in one
// section of the 18:00 digest, never one message per item. One line per person, the
// most late first; waiting on the client and paused editing are not late.
export function lateSummary(env, now = env.now, hours = OWNER_LATE_HOURS) {
  const cut = now.getTime() - hours * 36e5;
  const byPerson = new Map();
  const add = (person, text, at) => {
    if (!person || person === 'editor') return;
    if (!byPerson.has(person)) byPerson.set(person, []);
    byPerson.get(person).push({ text, at: +at });
  };
  let n = 0;
  for (const c of env.clients) {
    const checks = env.checksOf(c);
    for (const s of env.stateOf(c).states) {
      if (s.status !== 'overdue' || s.proc.recurring || !s.dueAt || +s.dueAt > cut || pauseOf(s.proc, checks)) continue;
      n += 1;
      for (const p of (s.claim ? [s.claim.person] : s.proc.owners)) add(p, `${clientLabel(c)} (${s.proc.num})`, s.dueAt);
    }
  }
  for (const t of env.tasks) {
    const c = env.clientById.get(t.client_id);
    if (!c || !t.due_on) continue;
    const end = endOfDayIL(dayFromKeyIL(t.due_on));
    if (!end || +end > cut) continue;
    n += 1;
    add(t.owner, `${clientLabel(c)}: ${t.title}`, end);
  }
  if (!n) return [];
  const rows = [...byPerson].map(([p, list]) => ({ p, list: list.sort((a, b) => a.at - b.at) }))
    .sort((a, b) => b.list.length - a.list.length || a.list[0].at - b.list[0].at);
  return [`באיחור ${hours} שעות ומעלה (${n}):`, ...rows.map(({ p, list }) => `${personName(p)} (${list.length}): ${short(list.map((x) => x.text), 3)}`)];
}

// No business day earlier in this Israel week (the owner's "Sunday 08:30" moves
// to the first business day when Sunday is a holiday).
function firstBusinessDayOfWeek(now) {
  const noon = atTimeIL(now, 12);
  for (let i = 1; i <= weekdayIL(now); i += 1) if (isBusinessDay(addDaysIL(noon, -i))) return false;
  return true;
}

// No business day later in this Israel week (Sunday–Thursday): Thursday, or the
// day before when Thursday is a holiday.
function lastBusinessDayOfWeek(now) {
  const noon = atTimeIL(now, 12);
  for (let i = 1; i <= 4 - weekdayIL(now); i += 1) if (isBusinessDay(addDaysIL(noon, i))) return false;
  return true;
}

// The owner's Thursday report inside the 18:00 digest: rings this week against
// each person's target (the repeats of a task given on the spot are not counted:
// they would bury the figure), who is not connected, and how much is late now.
function weeklyReport(env, log, now) {
  const sunday = atTimeIL(addDaysIL(now, -weekdayIL(now)), 0);
  const rings = {};
  // Since 7.10.2026 updates, digests and batches of lateness notes are pushed too.
  // "Rings" stays what it was (level 'ring': something to do now), so the figure and
  // its targets mean the same; everything that reached each phone is a line of its own.
  const pushes = {};
  for (const r of log) {
    if (r.person === OWNER || r.rule === NAG || asDate(r.sent_at || r.created_at) < sunday) continue;
    if (r.channel === 'push' && (r.status === 'sent' || r.status === 'pending')) pushes[r.person] = (pushes[r.person] || 0) + 1;
    if (!isPushRing(r)) continue;
    rings[r.person] = (rings[r.person] || 0) + 1;
  }
  const days = Math.max(1, [...Array(5).keys()].filter((i) => isBusinessDay(addDaysIL(sunday, i))).length);
  const ringLine = Object.keys(rings).length
    ? `צלצולים השבוע: ${Object.entries(rings).map(([p, n]) => `${personName(p)} ${n}${RING_TARGETS[p] && n > RING_TARGETS[p] * days ? ' (מעל היעד)' : ''}`).join(', ')}`
    : 'צלצולים השבוע: אין';
  const unconnected = STAFF_PEOPLE().filter((p) => env.hasStaff(p.key) && !env.connected(p.key)).length;
  let late = 0;
  for (const c of env.clients) late += env.stateOf(c).overdue;
  const pushLine = Object.keys(pushes).length
    ? [`כל ההודעות לטלפון השבוע (עם עדכונים ותקצירים): ${Object.entries(pushes).map(([p, n]) => `${personName(p)} ${n}`).join(', ')}`]
    : [];
  return ['דוח שבועי:', ringLine, ...pushLine, `לא מחוברים להתראות: ${unconnected}`, `תהליכים באיחור עכשיו: ${late}`];
}

// The owner's Sunday 08:30 digest: characterizations, shoot days, deliveries,
// campaigns and renewals this week, across clients.
export function weekAhead(env, now) {
  const end = endOfDayIL(addDaysIL(now, Math.max(0, 4 - weekdayIL(now))));
  const inWeek = (d) => d && d >= atTimeIL(now, 0) && d <= end;
  const lists = { char: [], shoot: [], deliver: [], campaign: [], renew: [] };
  for (const c of env.clients) {
    if (inWeek(parseDate(c.char_at))) lists.char.push(clientLabel(c));
    const shoots = [c.shoot_at, ...roundsOf(c).map((r) => r.shoot_at)].map(parseDate);
    if (shoots.some(inWeek)) lists.shoot.push(clientLabel(c));
    const st = env.stateOf(c).states;
    if (st.some((s) => baseId(s.proc.id) === 'p27' && !s.complete && inWeek(s.dueAt))) lists.deliver.push(clientLabel(c));
    if (st.some((s) => baseId(s.proc.id) === 'p30' && !s.complete && inWeek(s.dueAt))) lists.campaign.push(clientLabel(c));
    const endAt = parseDate(c.contract_end);
    if (endAt && c.status === 'active' && (inWeek(addDaysIL(endAt, -60)) || inWeek(endAt))) lists.renew.push(clientLabel(c));
  }
  const line = (label, list) => (list.length ? `${label} (${list.length}): ${short(list, 4)}` : null);
  const lines = [
    line('אפיונים', lists.char), line('ימי צילום', lists.shoot), line('מסירות', lists.deliver),
    line('קמפיינים', lists.campaign), line('חידושים', lists.renew),
  ].filter(Boolean);
  return lines.length ? lines : ['אין אירועים מתוכננים השבוע.'];
}

// Payload of a push, as the service worker (sw.js) reads it. A push message holds
// at most 4096 bytes after encryption (RFC 8291; supabase/functions/reminders/
// webpush.js refuses more), and Hebrew is two bytes a letter: a long title or a
// digest of long task titles is cut to fit, with the whole text in "התראות".
export const PUSH_MAX_BYTES = 3000;
const utf8 = (s) => new TextEncoder().encode(s).length;
// How the phone groups pushes (the owner's rule of 7.10.2026 sends many more of
// them): a notification with the tag of one already shown replaces it, and
// `renotify` makes it sound again. The tag is the case, not the step
// (`rule:client:case`), so the steps of one ladder for one person ("עסקה חדשה",
// "עברו 5 דקות", "עברו 10 דקות"; every repeat of a task given on the spot, rule
// `nag`) are one banner that updates, never a pile. The batches of lateness notes
// share one tag per person. A digest and a test keep their own key.
export function pushTag(key) {
  const k = String(key);
  if (k.startsWith('digest:late:')) return k.split(':').slice(0, 3).join(':');
  if (k.startsWith('digest:') || k.startsWith('test:') || !k.includes(':')) return k;
  return k.split(':').slice(0, -1).join(':');
}
export function pushPayload({ id = null, key, title, body, url, level }) {
  const tag = pushTag(key);
  const again = tag !== String(key);
  const msg = { title: String(title || '').slice(0, 150), url: url || MINE_URL, tag, id, level };
  const fit = (text) => JSON.stringify({ title: msg.title, body: text, url: msg.url, tag: msg.tag, id: msg.id, level: msg.level, ...(again ? { renotify: true } : {}) });
  // Without its body a payload is well under the limit (a short title, a url and a key).
  let text = String(body || '');
  let out = fit(text);
  while (text && utf8(out) > PUSH_MAX_BYTES) {
    text = text.slice(0, Math.max(0, text.length - Math.ceil((utf8(out) - PUSH_MAX_BYTES) / 3) - 2));
    out = fit(text ? `${text}…` : '');
  }
  return out;
}
