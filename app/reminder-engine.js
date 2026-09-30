// The reminder engine (stage 3; docs/plan/system-plan.md, principle 4 and
// section 5): the ladders of app/reminder-rules.js evaluated against the
// clients, their checks and tasks at one moment, and what to do with each step
// at that moment (push, in the app only, a digest line, or held back). Pure, no
// DOM and no network, Israel time only: the server tick
// (supabase/functions/reminders) runs it every minute, and the unit tests run it
// at fixed moments.
//
//   computeReminders(input) → the steps due now that are not in the log yet:
//     [{ key, rule, step, person, level, title, body, url, exempt, escalation,
//        at, clientId, ref, shoot, exception, list, overdue }]
//     The key is stable (`rule:client:case:step@person`), so each ladder step goes
//     out once: the log's unique key is the dedupe.
//   planDelivery({ reminders, now, log, liorShoot }) → the same with
//     { channel: push | app | digest, status: sent | queued | suppressed, reason }
//     after the sending hours, the daily cap and Lior's shoot day.
//   planDigests({ env, now, log, active, lookahead }) → the digests due now.
import {
  RULES, OWNER, timeOf, inSendHours, atIL, DAILY_CAP, STALE_MINUTES, FOLD, DIGESTS, RING_TARGETS, personName, MINE_URL,
  baseId, RULE_BY_ID, ruleOfKey, FACTS, stepOfKey,
} from './reminder-rules.js';
import { clientState, openItemsFor, parseDate, isBusinessDay, roundsOf, charEndedAt } from './protocol-logic.js';
import { STAFF_PEOPLE } from './protocol.js';
import { dayKeyIL, atTimeIL, dayFromKeyIL, weekdayIL, addDaysIL, endOfDayIL } from './tz.js';

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
    access, reviews, statusNotes, messages, subscriptions, staff,
    personOf: (email) => people.get(String(email || '').toLowerCase()) || null,
    emailsOf: (person) => [...people].filter(([, p]) => p === person).map(([e]) => e),
    hasStaff: (person) => [...people.values()].includes(person),
    connected: (person) => env.emailsOf(person).some((e) => subscribedEmails.has(e)),
  };
  env.ofirMeetings = ofirMeetings(env);
  env.liorShoot = liorShoot(env);
  return env;
}

// Ofir's characterization meetings, [start, end] in ms: from the meeting until he
// tapped "the characterization ended" (or process 4 was completed), or two hours
// (decision 11 stops his quality clock meanwhile; it runs on from the tap).
function ofirMeetings(env) {
  const out = [];
  for (const c of env.clients) {
    const at = parseDate(c.char_at);
    if (!at || (c.characterizer && c.characterizer !== 'ofir')) continue;
    const p4 = env.stateOf(c).states.find((s) => s.proc.id === 'p04');
    const ended = charEndedAt(env.checksOf(c));
    const end = ended || (p4?.complete && p4.completedAt ? p4.completedAt : new Date(at.getTime() + 2 * 36e5));
    if (end > at) out.push([at.getTime(), end.getTime()]);
  }
  return out;
}

// Lior on a shoot (decision 8 and "מצב שקט"): from Eli's arrival (an hour before
// the influencers, or his "הגעתי" if earlier) until the day is closed (19) or the
// day ends. Meanwhile his exceptions go to Ofir and his other rings wait.
export function liorShoot(env) {
  const now = env.now;
  const cids = new Set();
  for (const c of env.clients) {
    const shoots = [{ pre: '', at: parseDate(c.shoot_at) }, ...roundsOf(c).map((r) => ({ pre: `r${r.n}`, at: parseDate(r.shoot_at) }))];
    for (const { pre, at } of shoots) {
      if (!at || dayKeyIL(at) !== dayKeyIL(now)) continue;
      const checks = env.checksOf(c);
      const arrived = checks[`${pre ? `${pre}.` : ''}p17b.arrived`];
      let start = new Date(at.getTime() - 36e5);
      if (arrived?.state === 'done' && new Date(arrived.at) < start) start = new Date(arrived.at);
      const p19 = env.stateOf(c).states.find((s) => s.proc.id === (pre ? `${pre}-p19` : 'p19'));
      const end = p19?.complete && p19.completedAt ? p19.completedAt : endOfDayIL(at);
      if (now >= start && now < end) cids.add(c.id);
    }
  }
  return { active: cids.size > 0, cids };
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
      for (const [n, step] of steps.entries()) {
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
            exempt: d.step.exempt || null, shoot: !!d.step.shoot, exception: !!d.step.exception,
            list: !!d.step.list, overdue: !!d.step.overdue, escalation: d.escalation,
            at: d.at, clientId: inst.cid || null, ref: inst.ref || null, url: inst.url || MINE_URL,
            title: d.step.title(inst, env), body: d.step.body ? d.step.body(inst, env) : '',
          });
        }
      }
    }
  }
  // Decision 8: on Lior's shoot day his exceptions go to Ofir (the key stays his,
  // so the step still goes out once).
  if (env.liorShoot.active) {
    for (const r of out) {
      if (r.person === 'lior' && r.exception && !env.liorShoot.cids.has(r.clientId)) {
        r.person = 'ofir';
        r.title = `ליאור ביום צילום · ${r.title}`;
      }
    }
  }
  return out;
}

const keysOf = (log) => (log instanceof Set ? log : new Set([...(log || [])].map((x) => (typeof x === 'string' ? x : x.key))));

// The steps due now that the log does not have yet (spec: computeReminders).
export function computeReminders({ log = [], until, env = null, ...input }) {
  const e = env || buildEnv(input);
  const known = keysOf(log);
  return candidates(e, { until }).filter((r) => !known.has(r.key));
}

// ── Delivery ──────────────────────────────
const isPushRing = (row) => row.level === 'ring' && row.channel === 'push' && row.status === 'sent';
// Rings a person got today that count against the cap (not protocol clocks, shoot days, urgent or tests).
export function ringsToday(log, now) {
  const day = dayKeyIL(now);
  const out = {};
  for (const r of log || []) {
    if (!isPushRing(r) || r.exempt || dayKeyIL(asDate(r.sent_at || r.created_at)) !== day) continue;
    out[r.person] = (out[r.person] || 0) + 1;
  }
  return out;
}

// What happens to each new step now. Rings: outside the sending hours they wait for
// the next digest (a shoot-day event does not); on Lior's shoot day his other rings
// wait for the summary after it; past 6 a day (exempt ones aside) they go to the
// next digest. Nothing is sent late: a step that should have gone out hours ago is
// recorded as stale.
export function planDelivery({ reminders, now, log = [], liorShoot = { active: false, cids: new Set() } }) {
  const count = ringsToday(log, now);
  const sorted = [...reminders].sort((a, b) => (a.at - b.at) || (!!b.exempt - !!a.exempt));
  return sorted.map((r) => {
    const age = (now - r.at) / MIN;
    if (age > STALE_MINUTES[r.level]) return { ...r, channel: r.level === 'digest' ? 'digest' : 'app', status: 'suppressed', reason: 'stale' };
    if (r.level === 'board' || r.level === 'quiet') return { ...r, channel: 'app', status: 'sent', reason: null };
    if (r.level === 'digest') return { ...r, channel: 'digest', status: 'queued', reason: null };
    if (!r.shoot && !inSendHours(now)) return { ...r, channel: 'digest', status: 'queued', reason: 'quiet_hours' };
    if (r.person === 'lior' && liorShoot.active && !r.shoot && !liorShoot.cids.has(r.clientId)) return { ...r, channel: 'digest', status: 'queued', reason: 'shoot_mode' };
    if (!r.exempt && (count[r.person] || 0) >= DAILY_CAP) return { ...r, channel: 'digest', status: 'queued', reason: 'cap' };
    if (!r.exempt) count[r.person] = (count[r.person] || 0) + 1;
    return { ...r, channel: 'push', status: 'sent', reason: null };
  });
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
      (e.status === 'overdue' ? overdue : today).push({ client: c.name, what: e.proc.title, at: e.dueAt });
    }
  }
  for (const t of env.tasks) {
    const c = env.clientById.get(t.client_id);
    if (!c || t.owner !== person || !t.due_on) continue;
    if (t.due_on < todayKey) overdue.push({ client: c.name, what: t.title, at: dayFromKeyIL(t.due_on) });
    else if (t.due_on === todayKey) today.push({ client: c.name, what: t.title, at: dayFromKeyIL(t.due_on) });
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
// most `max` lines; the last one says how many more are in "מה עליי".
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
  return [...kept, `ועוד ${lines.length - kept.length} נושאים ב״מה עליי״`];
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
  // A queued line is carried only while it is still true (or it reports a fact).
  const holds = (r) => active.has(r.key) || FACTS.has(stepOfKey(r.key));
  const split = (rows) => ({ keep: rows.filter(holds), drop: rows.filter((r) => !holds(r)) });
  const staffPeople = STAFF_PEOPLE().map((p) => p.key).filter((k) => env.hasStaff(k));
  const business = isBusinessDay(now);

  if (business && within(DIGESTS.morning)) {
    const foldFrom = atIL(now, FOLD.from);
    const foldTo = atIL(now, FOLD.to);
    const known = new Set(log.map((r) => r.key));
    for (const person of staffPeople) {
      const { keep, drop } = split(queuedFor(person));
      const fold = lookahead.filter((r) => r.person === person && r.level === 'ring' && !r.shoot && r.at >= foldFrom && r.at <= foldTo && !known.has(r.key));
      const work = personWork(env, person);
      const lines = digestLines({ work, rows: [...keep, ...fold], max: 5, clientName });
      if (!lines.length) { if (drop.length) out.push({ key: null, person, drop }); continue; }
      out.push({ key: `digest:morning:${person}:${day}`, kind: 'morning', person, title: 'תקציר בוקר', lines, url: MINE_URL, include: keep, drop, fold });
    }
  }
  if (business) {
    for (const t of DIGESTS.lists) {
      if (!within(t)) continue;
      const { keep, drop } = split(queuedFor('lior'));
      if (env.liorShoot.active) { if (drop.length) out.push({ key: null, person: 'lior', drop }); continue; }
      const lines = digestLines({ rows: keep, max: 8, clientName });
      if (!lines.length) { if (drop.length) out.push({ key: null, person: 'lior', drop }); continue; }
      out.push({ key: `digest:list${t.slice(0, 2)}:lior:${day}`, kind: 'list', person: 'lior', title: `הרשימה של ${t}`, lines, url: MINE_URL, include: keep, drop });
    }
  }
  // After the shoot: what waited for Lior meanwhile, in one message (unless a list
  // goes out at this very moment and carries it).
  const heldForShoot = queuedFor('lior').filter((r) => r.reason === 'shoot_mode');
  if (heldForShoot.length && !env.liorShoot.active && !out.some((d) => d.kind === 'list')) {
    const { keep, drop } = split(queuedFor('lior'));
    const lines = digestLines({ rows: keep, max: 8, clientName });
    const last = Math.max(...heldForShoot.map((r) => Number(r.id) || 0));
    if (lines.length) out.push({ key: `digest:shoot:lior:${day}:${last}`, kind: 'shoot', person: 'lior', title: 'סיכום אחרי יום הצילום', lines, url: MINE_URL, include: keep, drop });
    else if (drop.length) out.push({ key: null, person: 'lior', drop });
  }
  if (env.hasStaff(OWNER) && business && within(DIGESTS.owner)) {
    const sinceDay = log.filter((r) => r.person === OWNER && r.level === 'board' && r.status === 'sent' && dayKeyIL(asDate(r.created_at)) === day);
    const { keep, drop } = split([...sinceDay, ...queuedFor(OWNER)]);
    let lines = digestLines({ rows: keep, max: 10, clientName });
    if (!lines.length) lines = ['הכול לפי התוכנית.'];
    const thursday = weekdayIL(now) === 4;
    if (thursday) lines = [...lines, ...weeklyReport(env, log, now)];
    out.push({ key: `digest:owner18:owner:${day}`, kind: 'owner', person: OWNER, title: thursday ? 'חריגות היום ודוח שבועי' : 'חריגות היום', lines, url: 'clients.html', include: keep.filter((r) => r.status === 'queued'), drop: drop.filter((r) => r.status === 'queued') });
  }
  if (env.hasStaff(OWNER) && business && within(DIGESTS.ownerWeek) && firstBusinessDayOfWeek(now)) {
    out.push({ key: `digest:week:owner:${day}`, kind: 'week', person: OWNER, title: 'השבוע הקרוב', lines: weekAhead(env, now), url: 'clients.html', include: [], drop: [] });
  }
  return out.map((d) => (d.key ? { ...d, body: d.lines.join('\n') } : d));
}

// No business day earlier in this Israel week (the owner's "Sunday 08:30" moves
// to the first business day when Sunday is a holiday).
function firstBusinessDayOfWeek(now) {
  const noon = atTimeIL(now, 12);
  for (let i = 1; i <= weekdayIL(now); i += 1) if (isBusinessDay(addDaysIL(noon, -i))) return false;
  return true;
}

// The owner's Thursday report inside the 18:00 digest: rings this week against
// each person's target, who is not connected, and how much is late now.
function weeklyReport(env, log, now) {
  const sunday = atTimeIL(addDaysIL(now, -weekdayIL(now)), 0);
  const rings = {};
  for (const r of log) {
    if (!isPushRing(r) || r.person === OWNER || asDate(r.sent_at || r.created_at) < sunday) continue;
    rings[r.person] = (rings[r.person] || 0) + 1;
  }
  const days = Math.max(1, [...Array(5).keys()].filter((i) => isBusinessDay(addDaysIL(sunday, i))).length);
  const ringLine = Object.keys(rings).length
    ? `צלצולים השבוע: ${Object.entries(rings).map(([p, n]) => `${personName(p)} ${n}${RING_TARGETS[p] && n > RING_TARGETS[p] * days ? ' (מעל היעד)' : ''}`).join(', ')}`
    : 'צלצולים השבוע: אין';
  const unconnected = STAFF_PEOPLE().filter((p) => env.hasStaff(p.key) && !env.connected(p.key)).length;
  let late = 0;
  for (const c of env.clients) late += env.stateOf(c).overdue;
  return ['דוח שבועי:', ringLine, `לא מחוברים להתראות: ${unconnected}`, `תהליכים באיחור עכשיו: ${late}`];
}

// The owner's Sunday 08:30 digest: characterizations, shoot days, deliveries,
// campaigns and renewals this week, across clients.
export function weekAhead(env, now) {
  const end = endOfDayIL(addDaysIL(now, Math.max(0, 4 - weekdayIL(now))));
  const inWeek = (d) => d && d >= atTimeIL(now, 0) && d <= end;
  const lists = { char: [], shoot: [], deliver: [], campaign: [], renew: [] };
  for (const c of env.clients) {
    if (inWeek(parseDate(c.char_at))) lists.char.push(c.name);
    const shoots = [c.shoot_at, ...roundsOf(c).map((r) => r.shoot_at)].map(parseDate);
    if (shoots.some(inWeek)) lists.shoot.push(c.name);
    const st = env.stateOf(c).states;
    if (st.some((s) => baseId(s.proc.id) === 'p27' && !s.complete && inWeek(s.dueAt))) lists.deliver.push(c.name);
    if (st.some((s) => baseId(s.proc.id) === 'p30' && !s.complete && inWeek(s.dueAt))) lists.campaign.push(c.name);
    const endAt = parseDate(c.contract_end);
    if (endAt && c.status === 'active' && (inWeek(addDaysIL(endAt, -60)) || inWeek(endAt))) lists.renew.push(c.name);
  }
  const line = (label, list) => (list.length ? `${label} (${list.length}): ${short(list, 4)}` : null);
  const lines = [
    line('אפיונים', lists.char), line('ימי צילום', lists.shoot), line('מסירות', lists.deliver),
    line('קמפיינים', lists.campaign), line('חידושים', lists.renew),
  ].filter(Boolean);
  return lines.length ? lines : ['אין אירועים מתוכננים השבוע.'];
}

// Payload of a push, as the service worker (sw.js) reads it.
export const pushPayload = ({ id = null, key, title, body, url, level }) => JSON.stringify({
  title, body: body || '', url: url || MINE_URL, tag: key, id, level,
});
