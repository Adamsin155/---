// Monthly insights for the owner (insights.html; docs/plan/system-plan.md, stage 6:
// "מגמות חודשיות", "מעקב אחרי כל סרטון, מהתסריט ועד התזמון", and every month the
// items marked "לא רלוונטי" in more than half the cases). Pure: no DOM and no
// database, so node tests it. Every month and day is Israel's (tz.js).
//
// Everything is computed from what the team already marks; nothing is entered here.
//   - On time, per role and per person: the processes closed in the month, as the
//     team screen counts them (health.js closedProcesses: waiting on the client and
//     editing stopped for someone else's task are not the person's time; imported
//     history and processes closed entirely as "not relevant" are left out).
//   - Returns from quality control: Ofir's marks p25.return.N (videos, the editor of
//     that shoot) and p23.return.N (graphics, Ilai), by the month of the return and
//     by N (first return, second, third or more), against the videos he approved.
//   - From the shoot to the first delivery (p26.sent) in business days, and closed
//     with the client's approval (p27.approved) within the promise ה8: 5 business
//     days from the business day after the shoot.
//   - Client requests (Irit's section 17, tasks with source 'request') against
//     decision 29: handled within a business day (the day after, as requestDue in
//     shoot-prep.js), urgent within an office hour. The "received" message goes out
//     when the request is recorded, so its 2 hours are not measured apart.
//   - Satisfaction: public.client_surveys (stage 4; app/surveys.js): the 1–5 questions
//     after the shoot and the first delivery, and the 0–10 recommendation (NPS);
//     when the table cannot be read, nothing is claimed.
//   - "Not relevant": each item's cases in the month (a client and the item's final
//     mark in the month: done or not relevant); an item marked not relevant in more
//     than half of at least NA_MIN_CASES cases is suggested for removal in the next
//     protocol version.
//   - Per shoot day, from the scripts to the scheduling: scripts approved (13), shot
//     (19), edited and handed to Ofir (24), passed quality control (25), approved by
//     the client (27), scheduled (28). The marks are per shoot day, not per video.
import { PEOPLE, PROCESSES, APPROVALS, SHOOT_TYPES } from './protocol.js';
import {
  clientState, parseDate, businessDaysBetween, workingMinutesBetween, IMPORT_NOTE, roundsOf, roundContext,
} from './protocol-logic.js';
import { closedProcesses, doneEvents } from './health.js';
import { requestDue, REQUEST } from './shoot-prep.js';
import { TZ, partsIL, dateIL, dayKeyIL } from './tz.js';
import { readSurvey, isNps, severeScore, npsOf, average, FIVE_KINDS } from './surveys.js';

// ── Months ─────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
export const monthKeyIL = (d) => { const p = partsIL(d); return `${p.year}-${pad(p.month)}`; };
const monthFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, month: 'long', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, month: 'short' });
export function monthRange(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m) throw new Error('bad month');
  const start = dateIL(+m[1], +m[2], 1);
  const end = dateIL(+m[1], +m[2] + 1, 1);
  const mid = dateIL(+m[1], +m[2], 15, 12);
  return { key, start, end, label: monthFmt.format(mid), short: shortFmt.format(mid) };
}
// The `n` months up to and including `key`, oldest first.
export function monthsUpTo(key, n = 6) {
  const [y, mo] = key.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, mo - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  });
}
const inMonth = (d, r) => !!d && d >= r.start && d < r.end;

// ── Roles ──────────────────────────────────
export const ROLES = [
  { key: 'ops', label: 'תפעול ולקוחות', people: ['irit'] },
  { key: 'lead', label: 'ניהול, תוכן וימי צילום', people: ['lior'] },
  { key: 'qa', label: 'אפיון ובקרת איכות', people: ['ofir'] },
  { key: 'graphics', label: 'גרפיקה ותזמון', people: ['ilai'] },
  { key: 'editing', label: 'עריכה', people: ['nadia', 'yariv', 'anna', 'nirel'] },
  { key: 'photo', label: 'צילום', people: ['eli'] },
];
export const INSIGHT_PEOPLE = ROLES.flatMap((r) => r.people);
const rate = (done, onTime) => (done ? onTime / done : null);

// ── Helpers on the history ─────────────────
const byClient = (rows) => {
  const m = new Map();
  for (const r of rows || []) (m.get(r.client_id) || m.set(r.client_id, []).get(r.client_id)).push(r);
  return m;
};
// When an item was first really done: from the history when there is one, else the check.
function firstDone(rows, checks, key) {
  const ev = rows ? doneEvents(rows, key)[0] : null;
  if (ev) return new Date(ev.at);
  const c = checks[key];
  return c?.state === 'done' && c.note !== IMPORT_NOTE ? new Date(c.at) : null;
}
const imported = (checks, key) => checks[key]?.note === IMPORT_NOTE;
export function contextsOf(client) {
  return [{ ctx: client, pre: '', n: 1 },
    ...roundsOf(client).map((r) => ({ ctx: roundContext(client, r), pre: `r${r.n}.`, n: Number(r.n) }))];
}
const median = (list) => {
  const d = list.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!d.length) return null;
  return d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
};

// ── On time ────────────────────────────────
export function onTimeReport(rows, months) {
  const count = (list) => ({ done: list.length, onTime: list.filter((r) => r.onTime).length });
  const perMonth = (pick) => months.map((m) => {
    const c = count(rows.filter((r) => inMonth(r.completedAt, m) && pick(r)));
    return { key: m.key, ...c, rate: rate(c.done, c.onTime) };
  });
  const cur = months.at(-1);
  const people = INSIGHT_PEOPLE.map((key) => {
    const trend = perMonth((r) => r.people.includes(key));
    const cur = trend.at(-1);
    return { ...cur, key, name: PEOPLE[key].name, role: ROLES.find((x) => x.people.includes(key)).key, trend };
  });
  const roles = ROLES.map((role) => {
    const trend = perMonth((r) => r.people.some((p) => role.people.includes(p)));
    return { ...trend.at(-1), key: role.key, label: role.label, trend };
  });
  const allTrend = perMonth(() => true);
  const late = rows.filter((r) => inMonth(r.completedAt, cur) && !r.onTime)
    .sort((a, b) => b.completedAt - a.completedAt).slice(0, 10)
    .map((r) => ({ client: r.client, proc: r.proc, people: r.people.filter((p) => PEOPLE[p] && p !== 'editor'), dueAt: r.dueAt, completedAt: r.completedAt }));
  return { people, roles, all: allTrend.at(-1), trend: allTrend, late };
}

// ── Returns from quality control ───────────
const RETURN = /^(?:r(\d+)\.)?p(25|23)\.return\.(\d+)$/;
export function qaReport(clients, checksByClient, logBy, month) {
  const editors = new Map();
  const row = (key) => editors.get(key) || editors.set(key, { key, name: PEOPLE[key]?.name || 'לא שויך', approved: 0, returns: 0, byRound: [0, 0, 0] }).get(key);
  const graphics = { key: 'ilai', name: PEOPLE.ilai.name, returns: 0, byRound: [0, 0, 0] };
  for (const c of clients) {
    const cs = checksByClient[c.id] || {};
    const rows = logBy ? logBy.get(c.id) || [] : null;
    const ctxs = contextsOf(c);
    const editorOf = (round) => (round ? ctxs.find((x) => x.n === Number(round))?.ctx.editor : c.editor) || 'none';
    const keys = new Set([...Object.keys(cs), ...(rows || []).map((r) => r.item_key)]);
    for (const k of keys) {
      const m = RETURN.exec(k);
      if (!m) continue;
      const at = firstDone(rows, cs, k);
      if (!inMonth(at, month)) continue;
      const slot = Math.min(Number(m[3]), 3) - 1;
      const target = m[2] === '25' ? row(editorOf(m[1])) : graphics;
      target.returns += 1;
      target.byRound[slot] += 1;
    }
    for (const x of ctxs) {
      if (inMonth(firstDone(rows, cs, `${x.pre}p25.approved`), month)) row(x.ctx.editor || 'none').approved += 1;
    }
  }
  const list = [...editors.values()].sort((a, b) => (a.key === 'none') - (b.key === 'none') || b.returns - a.returns || a.name.localeCompare(b.name, 'he'));
  return { editors: list, graphics, total: list.reduce((n, e) => n + e.returns, 0) };
}

// ── From the shoot to the first delivery ───
export const PROMISE_DAYS = 5; // promise ה8: closed within 5 business days, from the day after the shoot
export function deliveryReport(clients, checksByClient, logBy, month) {
  const first = [];
  const closed = [];
  for (const c of clients) {
    const cs = checksByClient[c.id] || {};
    const rows = logBy ? logBy.get(c.id) || [] : null;
    for (const x of contextsOf(c)) {
      const shootAt = parseDate(x.ctx.shoot_at);
      if (!shootAt) continue;
      const sent = `${x.pre}p26.sent`;
      const ok = `${x.pre}p27.approved`;
      const sentAt = imported(cs, sent) ? null : firstDone(rows, cs, sent);
      if (inMonth(sentAt, month) && sentAt > shootAt) first.push({ client: c, n: x.n, shootAt, at: sentAt, days: businessDaysBetween(shootAt, sentAt) });
      const okAt = imported(cs, ok) ? null : firstDone(rows, cs, ok);
      if (inMonth(okAt, month) && okAt > shootAt) {
        const days = businessDaysBetween(shootAt, okAt);
        closed.push({ client: c, n: x.n, shootAt, at: okAt, days, within: days <= PROMISE_DAYS });
      }
    }
  }
  first.sort((a, b) => a.at - b.at);
  closed.sort((a, b) => a.at - b.at);
  return {
    first, median: median(first.map((r) => r.days)),
    closed, closedWithin: closed.filter((r) => r.within).length,
  };
}

// ── Client requests against decision 29 ────
export const URGENT_MIN = 60;
export function requestsReport(tasks, month, now = new Date()) {
  const list = (tasks || []).filter((t) => t.source === REQUEST && inMonth(parseDate(t.created_at), month)).map((t) => {
    const created = new Date(t.created_at);
    const done = t.done_at ? new Date(t.done_at) : null;
    const minutes = done ? workingMinutesBetween(created, done) : null;
    const due = requestDue(created, !!t.urgent);
    // Urgent: within an office hour; otherwise by the end of the next business day.
    const onTime = done ? (t.urgent ? minutes <= URGENT_MIN : dayKeyIL(done) <= due) : null;
    const late = !done && (t.urgent ? workingMinutesBetween(created, now) > URGENT_MIN : dayKeyIL(now) > due);
    return { task: t, urgent: !!t.urgent, created, done, minutes, onTime, late };
  });
  const handled = list.filter((r) => r.done);
  const urgent = list.filter((r) => r.urgent && r.done);
  return {
    total: list.length, handled: handled.length, onTime: handled.filter((r) => r.onTime).length,
    open: list.length - handled.length, openLate: list.filter((r) => r.late).length,
    urgent: urgent.length, urgentOnTime: urgent.filter((r) => r.onTime).length,
    medianMin: median(handled.map((r) => r.minutes)),
    rate: rate(handled.length, handled.filter((r) => r.onTime).length),
  };
}

// ── Satisfaction (public.client_surveys, stage 4; app/surveys.js) ──
// The answers given in the month (by `at`, the server's time): the two 1–5 questions
// together and each apart, and the 0–10 recommendation as an NPS. Null when the
// table could not be read (before its migration): nothing is claimed then.
export function satisfactionReport(rows, month) {
  if (!Array.isArray(rows)) return null;
  const answers = rows.map(readSurvey).filter((r) => r && inMonth(r.at, month));
  const five = answers.filter((r) => !isNps(r.kind));
  const ten = answers.filter((r) => isNps(r.kind)).map((r) => r.score);
  const kindOf = (k) => { const xs = five.filter((r) => r.kind === k).map((r) => r.score); return { count: xs.length, avg: average(xs) }; };
  return {
    count: five.length, avg: average(five.map((r) => r.score)),
    low: five.filter((r) => severeScore(r.kind, r.score)).length,
    kinds: Object.fromEntries(FIVE_KINDS.map((k) => [k, kindOf(k)])),
    nps: { count: ten.length, score: npsOf(ten), low: ten.filter((v) => severeScore('nps', v)).length },
  };
}

// ── "Not relevant" in more than half the cases ──
export const NA_MIN_CASES = 3;
const ITEMS = new Map(PROCESSES.flatMap((p) => p.items.map((i) => [i.key, { item: i, proc: p }])));
export function naReport(log, month) {
  const last = new Map(); // `${client}|${key}` -> the last done / na / clear of the month
  for (const r of (log || [])) {
    const at = new Date(r.at);
    if (!inMonth(at, month) || r.note === IMPORT_NOTE) continue;
    const base = String(r.item_key).replace(/^r\d+\./, '');
    if (!ITEMS.has(base) || APPROVALS.has(base)) continue;
    const id = `${r.client_id}|${r.item_key}`;
    const prev = last.get(id);
    if (!prev || at >= prev.at) last.set(id, { at, action: r.action, base });
  }
  const items = new Map();
  for (const { action, base } of last.values()) {
    if (action !== 'done' && action !== 'na') continue;
    const x = items.get(base) || items.set(base, { key: base, cases: 0, na: 0 }).get(base);
    x.cases += 1;
    if (action === 'na') x.na += 1;
  }
  return [...items.values()].filter((x) => x.na > 0).map((x) => {
    const { item, proc } = ITEMS.get(x.key);
    const share = x.na / x.cases;
    return { ...x, label: item.label, proc: `${proc.num} · ${proc.title}`, share, suggest: x.cases >= NA_MIN_CASES && share > 0.5 };
  }).sort((a, b) => (b.suggest - a.suggest) || (b.share - a.share) || (b.na - a.na) || a.key.localeCompare(b.key));
}

// ── Per shoot day, from the scripts to the scheduling ──
export const STAGES = [
  { key: 'scripts', label: 'תסריטים אושרו', item: 'p13.approved' },
  { key: 'shot', label: 'צולם', item: 'p19.all' },
  { key: 'edited', label: 'נערך והועבר לבקרה', item: 'p24.notify' },
  { key: 'qa', label: 'עבר בקרת איכות', item: 'p25.approved' },
  { key: 'approved', label: 'הלקוח אישר', item: 'p27.approved' },
  { key: 'scheduled', label: 'תוזמן', item: 'p28.scheduled' },
];
export function pipelineReport(clients, checksByClient, logBy, month, now = new Date()) {
  const out = [];
  const current = now >= month.start && now < month.end;
  for (const c of clients) {
    if (c.status === 'cancelled') continue;
    const cs = checksByClient[c.id] || {};
    const rows = logBy ? logBy.get(c.id) || [] : null;
    for (const x of contextsOf(c)) {
      const shootAt = parseDate(x.ctx.shoot_at);
      if (!shootAt) continue;
      const stages = STAGES.map((s) => {
        const key = `${x.pre}${s.item}`;
        if (imported(cs, key)) return { ...s, at: null, imported: true };
        let at = firstDone(rows, cs, key);
        // Shot: the day itself once it has passed, if the end of the day was not marked.
        if (!at && s.key === 'shot' && shootAt <= now) at = shootAt;
        return { ...s, at };
      });
      const done = stages.filter((s) => s.at || s.imported).length;
      const touched = stages.some((s) => inMonth(s.at, month)) || inMonth(shootAt, month);
      const inProgress = current && done < STAGES.length && (c.status === 'active' || c.status === 'ending');
      if (!touched && !inProgress) continue;
      // Next: the stage after the last one reached (a stage skipped on the way shows as missing).
      const last = stages.reduce((i, s, j) => (s.at || s.imported ? j : i), -1);
      const next = stages[last + 1] || null;
      // Business days between the stages that have a date.
      let prev = null;
      for (const s of stages) {
        if (s.at && prev) s.days = businessDaysBetween(prev, s.at);
        if (s.at) prev = s.at;
      }
      out.push({
        client: c, n: x.n, shootAt, shootType: SHOOT_TYPES[x.ctx.shoot_type]?.name || '', editor: x.ctx.editor || null,
        stages, done, next, total: shootAt <= now && stages.at(-1).at ? businessDaysBetween(shootAt, stages.at(-1).at) : null,
      });
    }
  }
  return out.sort((a, b) => a.shootAt - b.shootAt);
}

// ── Everything for one month ───────────────
// clients: every client (ended too); checks: { clientId: { key: check } }; log:
// protocol_log rows from the first month's start (with the whole history of the
// returns and deliveries, as the page loads them); tasks: client_tasks rows with
// source 'request'; surveys: public.client_surveys rows, or null when unreadable.
export function computeInsights({ clients = [], checks = {}, log = null, tasks = [], surveys = null, now = new Date(), month = monthKeyIL(now), span = 6 }) {
  const months = monthsUpTo(month, span).map(monthRange);
  const cur = months.at(-1);
  const counted = clients.filter((c) => c.status !== 'cancelled');
  const states = new Map();
  const stateOf = (c) => states.get(c.id) || states.set(c.id, clientState(c, checks[c.id] || {}, now)).get(c.id);
  const rows = closedProcesses(counted, { stateOf, checksByClient: checks, since: months[0].start, now, log }).filter((r) => r.completedAt < cur.end);
  const logBy = log ? byClient(log) : null;
  return {
    month: cur, months,
    onTime: onTimeReport(rows, months),
    qa: qaReport(counted, checks, logBy, cur),
    delivery: deliveryReport(counted, checks, logBy, cur),
    requests: requestsReport(tasks, cur, now),
    satisfaction: satisfactionReport(surveys, cur),
    na: naReport(log, cur),
    pipeline: pipelineReport(counted, checks, logBy, cur, now),
  };
}

// Who opens the page: the owner, and Lior read-only (decision 22 gives him the team
// screen). The link to the payouts app is the owner's alone.
export const canSeeInsights = (v) => !!v && !v.error && ((!v.me && v.scope === 'office') || v.me === 'lior');
export const canSeePayouts = (v) => !!v && !v.error && !v.me && v.scope === 'office';
export const pct = (r) => (r === null || r === undefined ? '—' : `${Math.round(r * 100)}%`);
