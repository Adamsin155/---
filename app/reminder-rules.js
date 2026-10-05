// The reminder matrix (docs/plan/system-plan.md, section 5, and decisions 7–24
// in docs/plan/decisions.md) as data: which event or process starts a ladder,
// who gets each step, when (relative to the event, the due date or the start),
// at what level, and where it goes when nobody acts. Pure, no DOM: the server
// engine (supabase/functions/reminders, through app/reminder-engine.js) and the
// unit tests read the same rules as the screens, and every date is Israel time
// (tz.js) with the office rules of protocol-logic.js.
//
// A rule: { id, event (the matrix row, in words), procs, instances(env), steps }.
//   instances(env) → the live cases, each { id, cid (client id or null), client,
//     anchors: { name: Date }, url, ref (the process key, e.g. 'r2.p11'), snooze
//     (a "לדחות עד…" date), ... }. A case that reached a stop condition (done,
//     "אני על זה", waiting on the client, paused, the event no longer true) is
//     simply not returned, so its ladder stops.
//   steps: [{ id, from (anchor name, default 'event'), timing, to, level, ... }] or
//     (inst, env) → steps, where the timing is any of
//       minutes (real time), officeMinutes (office hours only; negative = before),
//       businessDays (the nth business day after), prevBusinessDays (before),
//       days (calendar days), at ('HH:MM' on the resulting day, Israel time),
//     and
//       to        a person key, 'owner', or (inst, env) → person key(s)
//       level     'ring' (push, sound), 'quiet' (in the app only), 'digest' (a line in
//                 the next digest; Lior's non-urgent escalations land in his 12:00 and
//                 16:00 lists), 'board' (the owner's screen and the 18:00 digest)
//       exempt    'clock' (a protocol clock), 'shoot' (a shoot-day event, also sent
//                 outside the sending hours) or 'urgent': not counted in the daily cap
//       exception true: an exception for Lior (decision 8: on his shoot day it goes to Ofir)
//       when      (inst, env) → false skips the step (the thing it reminds of is done)
//       expires   an anchor name: the step is not sent from that moment on
//       overdue   true: a digest lists it with what is late
//       title / body (inst, env) → text (plain Hebrew; the title is also the digest line)
import { PEOPLE, STAFF_PEOPLE, TEAM_PEOPLE, PROCESSES, WORK_HOURS } from './protocol.js';
import {
  isBusinessDay, addWorkingMinutes, parseDate, IMPORT_NOTE, isImported, pauseOf,
  businessDaysBetween, weekKey, erevOn, nextWorkMoment, CHAR_ENDED,
} from './protocol-logic.js';
// The owner's decisions of 3.10.2026: Stav's deals, the station-change message, the
// automatic editor assignment.
import { DEAL_MINUTES, contractTitle, dealSummary, dealUrl } from './deal-logic.js';
import { stationChange } from './messages-logic.js';
import { autoReasonOf } from './auto-assign.js';
import { shootPrep, reportedOf, TELL, requestOf } from './shoot-prep.js';
import { BLOCKING_TITLE } from './characterization.js';
import { ANSWER_CLOCKS } from './clocks.js';
import {
  QA_KINDS, qaState, qaDue, SHIFT_KEY, readShift, ACCESS_FIXED, readAccessFix,
} from './office-marks.js';
import { partsIL, dayKeyIL, atTimeIL, addDaysIL, dayFromKeyIL, daysBetweenIL, weekdayIL } from './tz.js';
import {
  missingOf, missingText, briefingOf, pauseText, arrivalOf, driveName, noteOf,
} from './production.js';
// Stage 4: the client's fix requests and low scores (their own ladders).
import { STATUS_RULES, STATUS_SOURCES } from './status-rules.js';
// Stage 5: the monthly cycle (a draft) and the 90-day renewals list.
import { YEAR_RULES } from './year-rules.js';

export const OWNER = 'owner';
// Who has reminders: the owner and the team, sales too (reminder_log.person).
export const REMINDER_PEOPLE = new Set([OWNER, ...TEAM_PEOPLE().map((p) => p.key)]);
// Sending hours (section 5): Sunday–Thursday 08:30–19:00, not on holidays. On erev
// chag the office works until 13:00 (decision 2), and so do the rings. Shoot-day
// events are the exception. The digests run inside them.
export const SEND_HOURS = { from: 8 * 60 + 30, to: 24 * 60, /* TEMP: to is 19 * 60 */ erevTo: WORK_HOURS.erevEnd * 60 };
// At most 6 rings a day for each person, not counting protocol clocks, shoot days and urgent work.
export const DAILY_CAP = 6;
// Digest times (principle 4, section 3, decision 24).
export const DIGESTS = { morning: '08:30', lists: ['12:00', '16:00'], owner: '18:00', ownerWeek: '08:30' };
// What is scheduled for 09:00–09:30 goes into the 08:30 digest instead.
export const FOLD = { from: '09:00', to: '09:30' };
// Rings a day each person is expected to get (section 5), for the owner's weekly report.
export const RING_TARGETS = { irit: 8, lior: 6, ofir: 5, ilai: 5, nirel: 3, nadia: 3, yariv: 3, anna: 3, eli: 3, owner: 1 };
// A step that should have gone out this long ago and never did (the engine was
// down, or the rules were just switched on) is recorded as stale, never sent late.
// A digest line belongs to the digest of its moment (the engine queues it within
// the minute): an hour late, it would land in the wrong day's digest.
export const STALE_MINUTES = { ring: 6 * 60, quiet: 6 * 60, board: 24 * 60, digest: 60 };
// Steps that report something that happened (a missed call, a missed review): once
// queued, they stay in the next digest even though the day that produced them is over.
export const FACTS = new Set(['control32.lior', 'control33.lior', 'thursday.lior', 'thursday.board', 'weekly.missed']);
// The end of the key of Lior's copy of an exception that went to Ofir on his shoot
// day (decision 8): held for his summary after the day, never pushed.
export const SHOOT_COPY = '+shoot';
// 'rule.step' of a reminder key (`rule:client:case:step@person`; the case may hold ':').
export const stepOfKey = (key) => { const parts = String(key).split(':'); return `${parts[0]}.${parts.at(-1).split('@')[0]}`; };

// "לדחות עד…": a process mark `pNN.snooze` whose note is the moment (ISO) to remind again.
export const SNOOZE = (keyBase) => `${keyBase}.snooze`;

// ── Time ──────────────────────────────────
const MIN = 6e4;
const hm = (s) => s.split(':').map(Number);
export const minuteOfDay = (d) => { const p = partsIL(d); return p.hour * 60 + p.minute; };
export const atIL = (d, s) => { const [h, m] = hm(s); return atTimeIL(d, h, m); };
// Whether a push may go out at `d` (outside it only shoot-day events do).
export const inSendHours = (d) => isBusinessDay(d) && minuteOfDay(d) >= SEND_HOURS.from && minuteOfDay(d) < (erevOn(d) ? SEND_HOURS.erevTo : SEND_HOURS.to);
// The nth business day after (n > 0) or before (n < 0) the Israel day of `d`, same wall time.
export function businessDayFrom(d, n) {
  const p = partsIL(d);
  let x = atTimeIL(d, 12);
  let left = Math.abs(n);
  while (left > 0) { x = addDaysIL(x, n > 0 ? 1 : -1); if (isBusinessDay(x)) left -= 1; }
  return atTimeIL(x, p.hour, p.minute, p.second);
}
// The moment `minutes` of office time before `due` (office clocks stop at night,
// on weekends and holidays; erev chag closes at 13:00), walking back day by day.
export function officeMinutesBefore(due, minutes) {
  let left = minutes * MIN;
  let t = new Date(due);
  for (let i = 0; i < 400; i += 1) {
    const open = atTimeIL(t, WORK_HOURS.start);
    const close = atTimeIL(t, erevOn(t) ? WORK_HOURS.erevEnd : WORK_HOURS.end);
    if (isBusinessDay(t) && t > open) {
      if (t > close) t = close;
      if (left <= t - open) return new Date(t.getTime() - left);
      left -= t - open;
    }
    t = atTimeIL(addDaysIL(atTimeIL(t, 12), -1), 23, 59); // the evening before
  }
  return t;
}
// A step's time from its anchors (null when the anchor is not known yet).
export function timeOf(step, anchors) {
  const base = anchors[step.from || 'event'];
  if (!base) return null;
  let d = new Date(base);
  if (step.prevBusinessDays) d = businessDayFrom(d, -step.prevBusinessDays);
  if (step.businessDays) d = businessDayFrom(d, step.businessDays);
  if (step.days) d = addDaysIL(d, step.days);
  if (step.at) d = atIL(d, step.at);
  if (step.officeMinutes > 0) d = addWorkingMinutes(d, step.officeMinutes);
  if (step.officeMinutes < 0) d = officeMinutesBefore(d, -step.officeMinutes);
  if (step.minutes) d = new Date(d.getTime() + step.minutes * MIN);
  return d;
}

// ── Words ─────────────────────────────────
const WEEKDAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const pad = (n) => String(n).padStart(2, '0');
export const dayText = (d) => { const p = partsIL(d); return `${WEEKDAY[p.weekday]} ${p.day}.${p.month}.${p.year}`; };
export const clock = (d) => { const p = partsIL(d); return `${pad(p.hour)}:${pad(p.minute)}`; };
// "היום 10:03", "מחר 09:00", "ה׳ 8.10 12:00" (Israel time).
export function whenText(d, now) {
  if (!d) return '';
  const days = daysBetweenIL(now, d);
  const p = partsIL(d);
  const day = days === 0 ? 'היום' : days === 1 ? 'מחר' : days === -1 ? 'אתמול' : `${WEEKDAY[p.weekday]} ${p.day}.${p.month}`;
  return `${day} ${clock(d)}`;
}
export const personName = (key) => (key === OWNER ? 'הבעלים' : PEOPLE[key]?.name || key);
const names = (list, max = 4) => (list.length > max ? `${list.slice(0, max).join(', ')} ועוד ${list.length - max}` : list.join(', '));
const procName = (proc) => `${proc.num} · ${proc.title}`;
export const clientUrl = (id, hash = '') => `client.html?id=${encodeURIComponent(id)}${hash ? `#${hash}` : ''}`;
export const MINE_URL = 'clients.html#mine';
// The production pages: the editor's (editor.html) and the shoot day's (shoot.html).
export const EDITOR_URL = (id) => `editor.html#c-${encodeURIComponent(id)}`;
export const SHOOT_URL = (id) => `shoot.html?id=${encodeURIComponent(id)}`;

// ── Reading a client ──────────────────────
export const baseId = (id) => id.replace(/^r\d+-/, '');
const ROUND = new Set(PROCESSES.filter((p) => p.round).map((p) => p.id));
const liveClient = (c) => c.status === 'active' || c.status === 'ending';

// One process of one client (the base or a shoot round), with what the ladders ask of it.
export function procCase(env, c, s) {
  const checks = env.checksOf(c);
  const kb = s.proc.keyBase || s.proc.id;
  const pre = kb.slice(0, kb.length - baseId(s.proc.id).length); // '' or 'r2.'
  const check = (k) => checks[pre + k];
  const states = env.stateOf(c).states;
  const snoozeMark = checks[SNOOZE(kb)];
  const snooze = snoozeMark?.state === 'done' ? parseDate(snoozeMark.note) : null;
  return {
    cid: c.id, client: c, s, proc: s.proc, pre, ctx: s.proc.ctx || c, checks, ref: kb, url: clientUrl(c.id, s.proc.id), snooze,
    name: c.name,
    check,
    resolved: (k) => { const x = check(k); return !!x && (x.state === 'done' || x.state === 'na'); },
    // An item added to the protocol after this client started (app/protocol-versions.js):
    // still work, never rung as late (the engine skips `overdue` steps; see freshCase).
    fresh: (k) => !!s.proc.items.find((it) => it.key === pre + k)?.fresh,
    // When an item was done now (imported history is not an event).
    doneAt: (k) => { const x = check(k); return x && x.state === 'done' && x.note !== IMPORT_NOTE ? new Date(x.at) : null; },
    // The same round's state of another process.
    same: (b) => states.find((x) => x.proc.id === (pre && ROUND.has(b) ? `${pre.slice(0, -1)}-${b}` : b)) || null,
    // A process finished now (not by importing history), and when.
    finishedAt(b) {
      const x = this.same(b);
      return x && x.complete && x.completedAt && !isImported(x.proc, checks) ? x.completedAt : null;
    },
  };
}
// Why a process's ladder stopped: done, taken ("אני על זה"), waiting on the client, editing paused.
export function halted(i, { claim = true, wait = true } = {}) {
  if (i.s.complete) return 'done';
  if (wait && i.s.wait) return 'client';
  if (claim && i.s.claim) return 'claim';
  if (pauseOf(i.proc, i.checks)) return 'pause';
  return null;
}
// Every case of process `b` (the base and each round) in the live clients.
export function casesOf(env, b, keep = () => true) {
  const out = [];
  for (const c of env.clients) {
    for (const s of env.stateOf(c).states) {
      if (baseId(s.proc.id) !== b) continue;
      const i = procCase(env, c, s);
      if (keep(i)) out.push(i);
    }
  }
  return out;
}
const shootAt = (i) => parseDate(i.ctx.shoot_at);
const charAt = (i) => parseDate(i.ctx.char_at);
const characterizer = (c) => c.characterizer || 'ofir';
// Items of `person` in a process that are still open.
const openOf = (i, person) => i.proc.items.filter((it) => !it.optional && it.owners.includes(person) && !i.resolved(it.key.slice(i.pre.length)));
const openItems = (i, keys) => keys.filter((k) => !i.resolved(k));
const TASK_URL = (cid) => clientUrl(cid, 'tasks');

// Office days in Israel between the start of the case and today, for "day X of 3".
const dayOfThree = (from, now) => Math.max(1, businessDaysBetween(from, now));

// ── The rules ─────────────────────────────
// Processes whose lateness also has its own ladder below (they keep ringing as
// before). Since 3.10.2026 every late process, these too, also tells Ofir and Lior
// quietly (`late`), and 24 hours late it is in the owner's 18:00 summary
// (lateSummary in app/reminder-engine.js).
export const OWN_LATE = new Set(['p01', 'p02', 'p03', 'p06', 'p11b', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p20', 'p21', 'p22a', 'p25', 'p31']);
// Quality and editing (principle 5).
export const QUALITY = new Set(['p22', 'p23', 'p24', 'p25', 'p27']);
// Who hears of every late item (the owner's decision of 3.10.2026), quietly.
export const LATE_WATCHERS = ['ofir', 'lior'];
// How late an item is before it joins the owner's daily summary (one message, 18:00).
export const OWNER_LATE_HOURS = 24;

export const RULES = [
  // 1–3: a new deal. Irit at once and again at 5 minutes if the contract, the group
  // (with its members) or the meeting date is missing; Lior after 30 office
  // minutes; the owner's screen after an office hour.
  {
    id: 'deal', event: 'פרטי עסקה התקבלו (1, 2, 3)', procs: ['p01', 'p02', 'p03'],
    instances(env) {
      const out = [];
      for (const c of env.clients) {
        const dealAt = parseDate(c.deal_at);
        const st = env.stateOf(c).states;
        const [p1, p2, p3] = ['p01', 'p02', 'p03'].map((id) => st.find((s) => s.proc.id === id));
        if (!dealAt || !p1) continue;
        const i = procCase(env, c, p1);
        const missing = [];
        if (!p1.wait && openItems(i, ['p01.prepared', 'p01.sent']).length) missing.push('חוזה');
        if (p2 && !p2.complete && !p2.wait) missing.push('קבוצה');
        if (p3 && !p3.complete && !p3.wait) missing.push('מועד אפיון');
        if (!missing.length) continue;
        out.push({ ...i, id: 'deal', ref: 'p01', url: clientUrl(c.id, 'p01'), missing, anchors: { event: dealAt, due: addWorkingMinutes(dealAt, 5) } });
      }
      return out;
    },
    steps: [
      { id: 'now', to: 'irit', level: 'ring', exempt: 'clock', title: (i) => `עסקה חדשה: ${i.name}`, body: (i, env) => `חוזה, קבוצה ומועד אפיון עד ${whenText(i.anchors.due, env.now)}.` },
      { id: 'due', from: 'due', to: 'irit', level: 'ring', exempt: 'clock', title: (i) => `עברו 5 דקות: ${i.name}`, body: (i) => `עוד חסר: ${i.missing.join(', ')}.` },
      { id: 'lior', officeMinutes: 30, to: 'lior', level: 'ring', title: (i) => `עסקה חדשה בלי טיפול: ${i.name}`, body: (i) => `עברו 30 דקות עבודה ועוד חסר: ${i.missing.join(', ')}.` },
      { id: 'board', officeMinutes: 60, to: OWNER, level: 'board', overdue: true, title: (i) => `עסקה חדשה בלי טיפול שעה: ${i.name}`, body: (i) => `חסר: ${i.missing.join(', ')}.` },
    ],
  },

  // 3–4: the characterization kit, the evening before (18:30, the business day
  // before) and an hour before; "the meeting ended" not marked 15 minutes after its
  // planned end (the characterizer), and Irit half an hour later.
  {
    id: 'char', event: 'לפני אפיון, ואחריו', procs: ['p04'],
    instances(env) {
      return casesOf(env, 'p04', (i) => !i.pre && charAt(i) && !halted(i, { claim: false }))
        .map((i) => {
          const meeting = charAt(i);
          return { ...i, id: `p04@${meeting.toISOString()}`, who: characterizer(i.client), anchors: { event: meeting, meeting, end: new Date(meeting.getTime() + 2 * 36e5) } };
        });
    },
    steps: [
      { id: 'eve', from: 'meeting', prevBusinessDays: 1, at: '18:30', to: (i) => i.who, level: 'ring', expires: 'meeting', title: (i, env) => `אפיון ${whenText(i.anchors.meeting, env.now)}: ${i.name}`, body: (i) => [i.client.address, i.client.business].filter(Boolean).join(' · ') || 'הכתובת והטלפון בכרטיס הלקוח.' },
      { id: 'hour', from: 'meeting', minutes: -60, to: (i) => i.who, level: 'ring', expires: 'meeting', title: (i) => `בעוד שעה אפיון: ${i.name}`, body: (i) => [i.client.address, 'ניווט וטלפון בכרטיס.'].filter(Boolean).join(' · ') },
      { id: 'end', from: 'end', minutes: 15, to: (i) => i.who, level: 'ring', when: (i) => !i.resolved(CHAR_ENDED) && openOf(i, i.who).length > 0, title: (i) => `האפיון הסתיים? ${i.name}`, body: () => 'עברו 15 דקות מסוף הפגישה המתוכנן. ללחוץ "האפיון הסתיים" עם ארבעת השדות.' },
      { id: 'irit', from: 'end', minutes: 45, to: 'irit', level: 'quiet', when: (i) => !i.resolved(CHAR_ENDED) && openOf(i, i.who).length > 0, title: (i) => `האפיון לא סומן: ${i.name}`, body: (i) => `${personName(i.who)} עוד לא סימן/ה שהאפיון הסתיים.` },
    ],
  },

  // 4: the full form after "the characterization ended" (decision 12): the
  // characterizer 60 minutes after the tap, then Irit (her follow-up, section 5 of
  // her protocol), then Lior's list. Saving the complete form stops it.
  {
    id: 'charForm', event: 'טופס האפיון המלא לא נשמר (4)', procs: ['p04'],
    instances(env) {
      return casesOf(env, 'p04', (i) => !i.pre && !!i.doneAt(CHAR_ENDED) && !i.resolved('p04.saved') && !halted(i, { claim: false }))
        .map((i) => ({ ...i, id: `p04@${i.doneAt(CHAR_ENDED).toISOString()}`, who: characterizer(i.client), url: `intake.html?id=${encodeURIComponent(i.cid)}#form`, anchors: { event: i.doneAt(CHAR_ENDED) } }));
    },
    steps: [
      { id: 'form', minutes: 60, to: (i) => i.who, level: 'ring', title: (i) => `טופס האפיון עוד לא נשמר: ${i.name}`, body: () => 'עברה שעה מ"האפיון הסתיים". להשלים את 11 השדות (אפשר להקליד בקול).' },
      { id: 'irit', minutes: 90, to: 'irit', level: 'ring', title: (i) => `טופס האפיון חסר: ${i.name}`, body: (i) => `${personName(i.who)} עוד לא השלים/ה את טופס האפיון. לבדוק ולהשלים את המידע.` },
      { id: 'lior', minutes: 120, to: 'lior', level: 'digest', list: true, overdue: true, title: (i) => `טופס אפיון לא נשמר: ${i.name} · ${personName(i.who)}`, body: () => 'עברו שעתיים מסוף האפיון.' },
    ],
  },

  // 6–10: the clocks that start when the characterization is marked done. One
  // message each ("your clock started") and one 30 minutes before the two-hour target.
  {
    id: 'started', event: 'השעון התחיל (6–10)', procs: ['p07', 'p08', 'p09', 'p10'],
    instances(env) {
      const out = [];
      const TEAM = [['ilai', ['p07', 'p09'], 'p07'], ['ofir', ['p08'], 'p08'], ['lior', ['p10'], 'p10']];
      for (const c of env.clients) {
        const p4 = env.stateOf(c).states.find((s) => s.proc.id === 'p04');
        if (!p4) continue;
        const i0 = procCase(env, c, p4);
        const endAt = i0.doneAt(CHAR_ENDED) || i0.finishedAt('p04');
        if (!endAt) continue;
        for (const [person, ids, main] of TEAM) {
          const open = ids.map((id) => i0.same(id)).filter((s) => s && !s.complete && !s.wait && !s.claim);
          const m = i0.same(main);
          if (!open.length || !m) continue;
          out.push({ ...procCase(env, c, m), id: person, who: person, open, mainOpen: open.includes(m), anchors: { event: endAt, due: m.dueAt } });
        }
      }
      return out;
    },
    steps: [
      { id: 'start', to: (i) => i.who, level: 'ring', exempt: 'clock', title: (i) => `השעון שלך התחיל: ${i.name}`, body: (i, env) => i.open.map((s) => `${s.proc.title} עד ${whenText(s.dueAt, env.now)}`).join(' · ') },
      { id: 'pre30', from: 'due', officeMinutes: -30, to: (i) => i.who, level: 'ring', exempt: 'clock', when: (i) => i.mainOpen, title: (i) => `עוד 30 דקות: ${i.name}`, body: (i, env) => `${i.proc.title} · יעד ${whenText(i.anchors.due, env.now)}.` },
    ],
  },

  // 5→6: access received. Ilai at once (30 minutes to check); Lior after 30 office minutes.
  {
    id: 'access', event: 'גישות התקבלו (5→6)', procs: ['p05', 'p06'],
    instances(env) {
      return casesOf(env, 'p06', (i) => !i.pre && !i.resolved('p06.verified') && !i.s.wait && !!i.doneAt('p05.access'))
        .map((i) => ({ ...i, id: 'p06', anchors: { event: i.doneAt('p05.access') } }));
    },
    steps: [
      { id: 'now', to: 'ilai', level: 'ring', exempt: 'clock', title: (i) => `קיבלת גישות: ${i.name}`, body: (i, env) => `יש לך 30 דקות לבדוק אותן מהכספת ולסדר את העמודים. יעד ${whenText(addWorkingMinutes(i.anchors.event, 30), env.now)}.` },
      { id: 'lior', officeMinutes: 30, to: 'lior', level: 'ring', title: (i) => `גישות לא נבדקו: ${i.name}`, body: () => 'עברו 30 דקות מקבלת הגישות ועילאי עוד לא סימן שבדק.' },
    ],
  },

  // 6: broken access. Lior at once and again after two office hours; the owner's
  // screen after a business day.
  {
    id: 'broken', event: 'גישה שבורה (6)', procs: ['p06'],
    instances(env) {
      const out = [];
      for (const a of env.access) {
        const c = env.clientById.get(a.client_id);
        // Since when it is broken (client_access.broken_since, kept by a trigger): an
        // edit of a broken row (a note, a new password that still fails) moves
        // updated_at, and must not start the ladder again or push the owner's step back.
        const at = parseDate(a.broken_since) || parseDate(a.updated_at);
        if (!c || a.status !== 'broken' || !at) continue;
        // Lior closed it as partly fixed ("עדיין חסר"): it stays red, and only the owner's screen follows it.
        const fix = readAccessFix(env.checksOf(c)[`p06.fixed.${a.network}`]);
        const partial = !!fix?.partial && fix.at >= new Date(at.getTime() - 5 * MIN);
        out.push({ id: `${a.id}@${at.toISOString()}`, cid: c.id, client: c, name: c.name, ref: 'p06', url: clientUrl(c.id, 'access'), network: a.network, partial, anchors: { event: at } });
      }
      return out;
    },
    steps: [
      { id: 'now', to: 'lior', level: 'ring', exception: true, when: (i) => !i.partial, title: (i) => `גישה לא עובדת: ${i.name}`, body: (i) => `${NETWORK_NAME[i.network] || i.network}. לתקן עם הלקוח ולעדכן בכספת.` },
      { id: 'again', officeMinutes: 120, to: 'lior', level: 'ring', exception: true, when: (i) => !i.partial, title: (i) => `גישה עדיין לא עובדת: ${i.name}`, body: (i) => `${NETWORK_NAME[i.network] || i.network}. עברו שעתיים עבודה.` },
      { id: 'board', businessDays: 1, to: OWNER, level: 'board', overdue: true, title: (i) => `גישה שבורה יותר מיום עסקים: ${i.name}`, body: (i) => NETWORK_NAME[i.network] || i.network },
    ],
  },

  // 7: the 9 graphics are ready. Irit checks and sends; Lior after 30 minutes (decision 7).
  {
    id: 'graphics9', event: '9 גרפיקות מוכנות (7)', procs: ['p07'],
    instances(env) {
      return casesOf(env, 'p07', (i) => !!i.doneAt('p07.made') && !i.resolved('p07.sent') && !halted(i))
        .map((i) => ({ ...i, id: 'p07', anchors: { event: i.doneAt('p07.made') } }));
    },
    steps: [
      { id: 'now', to: 'irit', level: 'ring', title: (i) => `9 גרפיקות מוכנות לבדיקה: ${i.name}`, body: () => '7 בדיקות, ואז שליחה ללקוח לאישור.' },
      { id: 'lior', officeMinutes: 30, to: 'lior', level: 'ring', title: (i) => `9 גרפיקות מחכות 30 דקות: ${i.name}`, body: () => 'עירית עוד לא שלחה אותן ללקוח. לבדוק ולשלוח.' },
    ],
  },

  // 7, 23, 26: the client did not answer within 10, 10 or 5 office minutes of the sending.
  {
    id: 'answer', event: 'הלקוח לא ענה (7, 23, 26)', procs: ['p07', 'p23', 'p26'],
    instances(env) {
      const out = [];
      for (const [b, spec] of Object.entries(ANSWER_CLOCKS)) {
        for (const i of casesOf(env, b)) {
          const sentAt = i.doneAt(`${b}.sent`);
          if (!sentAt) continue;
          const since = (k) => { const x = i.check(k); return !!x && x.state === 'done' && new Date(x.at) >= sentAt; };
          if (since(`${b}.answered`) || since(`${b}.call`) || (spec.approval && since(spec.approval))) continue;
          if (i.s.wait && new Date(i.s.wait.at) >= sentAt) continue;
          out.push({ ...i, id: `${i.proc.id}@${sentAt.toISOString()}`, what: spec.what, minutes: spec.minutes, anchors: { event: sentAt, due: addWorkingMinutes(sentAt, spec.minutes) } });
        }
      }
      return out;
    },
    steps: [
      { id: 'due', from: 'due', to: 'irit', level: 'ring', exempt: 'clock', title: (i) => `הלקוח לא ענה: ${i.name}`, body: (i) => `${i.what}. עברו ${i.minutes} דקות בלי תשובה: להתקשר.` },
    ],
  },

  // 11: setting the shoot day. Since v6 (3.10.2026) it starts right after the group is
  // opened and is due by the end of the next business day (a client that started
  // before keeps 3 business days from the meeting: the same steps, on its own dates).
  // Irit in the app when it starts, her digest every morning while it is open, a ring
  // at 16:00 on the due day. Late: Ofir and Lior quietly, and the owner's summary (`late`).
  {
    id: 'shootDate', event: 'יום צילום לא נסגר (11)', procs: ['p11'],
    instances(env) {
      return casesOf(env, 'p11', (i) => !!i.s.startAt && !!i.s.dueAt && !halted(i))
        .map((i) => ({ ...i, id: i.proc.id, anchors: { event: i.s.startAt, due: i.s.dueAt } }));
    },
    steps: (i, env) => [
      { id: 'start', to: 'irit', level: 'quiet', title: () => `לקבוע יום צילום: ${i.name}`, body: () => `במועד המוקדם ביותר, מול הלקוח, המשפיענים, ליאור ואלי. יעד: ${whenText(i.anchors.due, env.now)}.` },
      ...dailyDigest(i, env, 'irit', (n) => `יום צילום עוד לא נסגר (יום ${n}): ${i.name}`, 99),
      { id: 'due16', from: 'due', at: '16:00', to: 'irit', level: 'ring', title: () => `יום הצילום עוד לא נסגר: ${i.name}`, body: () => 'היעד: סוף היום. חסרים אישורים או תאריך.' },
    ],
  },

  // 12: scripts, due at the end of business day 2 (decision 14: the Zoom is on day
  // 3). A daily count in Lior's digest; a ring at 12:00 on day 2 if not done.
  {
    id: 'scripts', event: 'תסריטים (12)', procs: ['p12'],
    instances(env) {
      return casesOf(env, 'p12', (i) => charAt(i) && !halted(i)).map((i) => ({ ...i, id: i.proc.id, anchors: { event: charAt(i) } }));
    },
    steps: (i, env) => [
      ...dailyDigest(i, env, 'lior', (n) => `תסריטים, יום ${n} מתוך 2: ${i.name}`, 2),
      { id: 'day2', businessDays: 2, at: '12:00', to: 'lior', level: 'ring', title: () => `תסריטים: היום היעד · ${i.name}`, body: () => 'עוד אין תסריטים מוכנים בכרטיס. היעד: סוף היום, והזום מחר.' },
    ],
  },

  // 13: no client approval of the scripts. Lior and Irit two business days before the
  // shoot (a red alert); the owner, at once, one business day before (owner case 2).
  // Waiting on the client does not silence it: that is exactly the risk.
  {
    id: 'approval', event: 'אין אישור לקוח על התסריטים (13)', procs: ['p13'],
    instances(env) {
      return casesOf(env, 'p13', (i) => shootAt(i) && shootAt(i) > env.now && !i.resolved('p13.approved') && !halted(i, { wait: false }))
        .map((i) => ({ ...i, id: `${i.proc.id}@${shootAt(i).toISOString()}`, anchors: { event: shootAt(i), shoot: shootAt(i) } }));
    },
    steps: [
      { id: 'lior', prevBusinessDays: 2, at: '10:00', to: 'lior', level: 'ring', exempt: 'urgent', expires: 'shoot', title: (i) => `אין אישור לקוח על התסריטים: ${i.name}`, body: (i, env) => `הצילום ${whenText(i.anchors.shoot, env.now)}. לא מצלמים תוכן שלא אושר.` },
      { id: 'irit', prevBusinessDays: 2, at: '10:00', to: 'irit', level: 'ring', exempt: 'urgent', expires: 'shoot', title: (i) => `אין אישור לקוח על התסריטים: ${i.name}`, body: (i, env) => `הצילום ${whenText(i.anchors.shoot, env.now)}. לוודא מול הלקוח.` },
      { id: 'owner', prevBusinessDays: 1, at: '10:00', to: OWNER, level: 'ring', expires: 'shoot', title: (i) => `צילום בסיכון: ${i.name}`, body: (i, env) => `אין אישור לקוח על התסריטים, והצילום ${whenText(i.anchors.shoot, env.now)}.` },
    ],
  },

  // 15: the day before the shoot (the business day before; for a Sunday shoot,
  // Thursday). 10:30 Lior with the drafts, 11:15 Irit's check, 12:00 Lior urgent if
  // something is still open, 15:00 the owner if the reminders were not sent.
  {
    id: 'eve', event: 'יום לפני הצילום (15)', procs: ['p15'],
    instances(env) {
      return casesOf(env, 'p15', (i) => shootAt(i) && shootAt(i) > env.now && !halted(i, { wait: false }))
        .map((i) => ({ ...i, id: `${i.proc.id}@${shootAt(i).toISOString()}`, anchors: { event: shootAt(i), shoot: shootAt(i) } }));
    },
    steps: [
      { id: '1030', prevBusinessDays: 1, at: '10:30', to: 'lior', level: 'ring', exempt: 'shoot', shoot: true, expires: 'shoot', when: (i) => openItems(i, EVE_SENT).length > 0, title: (i, env) => `צילום ${whenText(i.anchors.shoot, env.now)}: ${i.name}`, body: () => 'הנוסחים מוכנים: ללקוח, למשפיענים ולצוות. לשלוח ולסמן בכרטיס.' },
      { id: '1115', prevBusinessDays: 1, at: '11:15', to: 'irit', level: 'ring', exempt: 'shoot', shoot: true, expires: 'shoot', when: (i) => !i.resolved('p15.irit'), title: (i) => `בדיקת יום לפני: ${i.name}`, body: () => 'לוודא שהתזכורות נשלחו, שהלקוח זוכר ושאין משימה פתוחה. כל פריט שנכשל: לליאור.' },
      { id: '1200', prevBusinessDays: 1, at: '12:00', to: 'lior', level: 'ring', exempt: 'urgent', shoot: true, expires: 'shoot', when: (i) => openOf(i, 'lior').length > 0, title: (i) => `דחוף: יום לפני הצילום עוד פתוח · ${i.name}`, body: (i) => `עוד פתוח: ${openOf(i, 'lior').length} פריטים בתהליך 15.` },
      { id: '1500', prevBusinessDays: 1, at: '15:00', to: OWNER, level: 'ring', shoot: true, expires: 'shoot', when: (i) => openItems(i, EVE_SENT).length > 0, title: (i) => `צילום בסיכון: ${i.name}`, body: (i, env) => `התזכורות של יום לפני הצילום עוד לא נשלחו. הצילום ${whenText(i.anchors.shoot, env.now)}.` },
    ],
  },

  // 16: the photographer's briefing, 17:00 the business day before. Lior fills the
  // drive label in his shoot-day screen (p16.brief); Eli gets it at 17:00, or when it
  // is sent if later, and taps "קיבלתי" (p16.photographer); 20:00 to Lior if Eli did
  // not. All may go out after the sending hours (a shoot-day event). The gear list is
  // on Eli's page only.
  {
    id: 'briefing', event: 'תדריך לצלם (16)', procs: ['p16'],
    instances(env) {
      return casesOf(env, 'p16', (i) => shootAt(i) && shootAt(i) > env.now && !halted(i, { wait: false }))
        .map((i) => {
          const b = briefingOf(i.checks, i.pre);
          const at17 = atIL(businessDayFrom(shootAt(i), -1), '17:00');
          return { ...i, id: `${i.proc.id}@${shootAt(i).toISOString()}`, brief: b, url: SHOOT_URL(i.cid), anchors: { event: shootAt(i), shoot: shootAt(i), brief: b ? new Date(Math.max(at17, b.at)) : null } };
        });
    },
    steps: [
      { id: 'lior', prevBusinessDays: 1, at: '17:00', to: 'lior', level: 'ring', exempt: 'shoot', shoot: true, expires: 'shoot', when: (i) => !i.brief, title: (i) => `תדריך לאלי: ${i.name}`, body: () => 'לשלוח לאלי את התדריך ואת תווית הכונן, במסך יום הצילום.' },
      { id: 'eli', from: 'brief', to: 'eli', level: 'ring', exempt: 'shoot', shoot: true, expires: 'shoot', title: (i, env) => `תדריך לצילום ${whenText(i.anchors.shoot, env.now)}: ${i.name}`, body: (i) => `הגעה ב־${clock(arrivalOf(i.anchors.shoot))}${i.client.address ? `, ${i.client.address}` : ''}${i.brief?.label ? ` · ${driveName(i.brief.label)}` : ''}. ללחוץ "קיבלתי".` },
      { id: '2000', prevBusinessDays: 1, at: '20:00', to: 'lior', level: 'ring', exempt: 'shoot', shoot: true, expires: 'shoot', when: (i) => !i.resolved('p16.photographer'), title: (i) => `אלי עוד לא אישר את התדריך: ${i.name}`, body: (i) => (i.brief ? 'אלי עוד לא לחץ "קיבלתי".' : 'התדריך עוד לא נשלח.') },
    ],
  },

  // 17–21: the shoot day. Eli two hours and 15 minutes before the influencers;
  // Lior if Eli did not mark arriving 15 minutes after his time; time management by
  // shoot type; the expected end if the day is not closed.
  {
    id: 'shoot', event: 'יום הצילום (17–21)', procs: ['p17b', 'p19'],
    instances(env) {
      return casesOf(env, 'p17b', (i) => !!shootAt(i) && dayKeyIL(shootAt(i)) === dayKeyIL(env.now))
        .map((i) => {
          const at = shootAt(i);
          return { ...i, id: `${i.proc.id}@${at.toISOString()}`, natali: i.ctx.shoot_type === 'natali', url: SHOOT_URL(i.cid), anchors: { event: at, shoot: at, endOfDay: atTimeIL(at, 23, 59) } };
        });
    },
    steps: (i) => {
      const s = { level: 'ring', exempt: 'shoot', shoot: true, expires: 'endOfDay' };
      const dayOpen = (b) => { const x = i.same(b); return !!x && !x.complete; };
      const endMin = i.natali ? 180 : 330;
      return [
        { ...s, id: 'eli2h', minutes: -120, to: 'eli', expires: 'shoot', title: () => `בעוד שעתיים המשפיענים מגיעים: ${i.name}`, body: () => `ההגעה שלך ב־${clock(new Date(i.anchors.shoot.getTime() - 36e5))}${i.client.address ? `, ${i.client.address}` : ''}.` },
        { ...s, id: 'eli15', minutes: -15, to: 'eli', expires: 'shoot', when: () => !i.check('p17b.brollq'), title: () => `הבי־רול גמור? ${i.name}`, body: () => 'המשפיענים מגיעים בעוד 15 דקות. לענות כן או לא במסך יום הצילום.' },
        { ...s, id: 'arrived', minutes: -45, to: 'lior', when: () => !i.resolved('p17b.arrived'), title: () => `אלי עוד לא סימן הגעה: ${i.name}`, body: () => 'עברו 15 דקות משעת ההגעה שלו.' },
        ...(i.natali
          ? [{ ...s, id: 'hourLeft', minutes: 120, to: 'lior', when: () => dayOpen('p19'), title: () => `נותרה שעה: ${i.name}`, body: () => 'צילום עם נטלי: עד 3 שעות.' }]
          : [
            { ...s, id: 'begin', minutes: 30, to: 'lior', when: () => dayOpen('p19'), title: () => `להתחיל לצלם: ${i.name}`, body: () => 'עברה חצי שעה של התארגנות.' },
            { ...s, id: 'progress', minutes: 240, to: 'lior', when: () => dayOpen('p19'), title: () => `בדיקת התקדמות: ${i.name}`, body: () => 'עברו 4 שעות. כמה סרטונים צולמו?' },
          ]),
        { ...s, id: 'endLior', minutes: endMin, to: 'lior', when: () => dayOpen('p19'), title: () => `סיום יום הצילום: ${i.name}`, body: () => 'סרטון המלצה, כל הכמות, והכונן חוזר אליך.' },
        { ...s, id: 'endEli', minutes: endMin, to: 'eli', when: () => dayOpen('p19b'), title: () => `סיום יום הצילום: ${i.name}`, body: () => 'לסדר את הכונן ולמסור לליאור.' },
      ];
    },
  },

  // 22א: assign an editor once the shoot day is closed. Ofir (or whoever took it) at
  // once, in the next morning's digest, and Lior at 12:00 on the next business day
  // (a hard stop: it fires even if someone said "אני על זה").
  {
    id: 'assign', event: 'שיוך עורך (22א)', procs: ['p22a'],
    instances(env) {
      return casesOf(env, 'p22a', (i) => !!i.finishedAt('p19') && !i.resolved('p22a.assigned') && !halted(i, { claim: false }))
        .map((i) => ({ ...i, id: i.proc.id, who: i.s.claim?.person || 'ofir', anchors: { event: i.finishedAt('p19') } }));
    },
    steps: [
      { id: 'now', to: (i) => i.who, level: 'ring', when: (i) => !i.s.claim, title: (i) => `לשייך עורך: ${i.name}`, body: (i, env) => `יום הצילום הסתיים. לשייך עורך עד ${whenText(businessDayFrom(atIL(i.anchors.event, '12:00'), 1), env.now)}.` },
      { id: 'morning', businessDays: 1, at: '08:30', to: (i) => i.who, level: 'digest', title: (i) => `עורך עוד לא שויך: ${i.name}`, body: () => 'עד 12:00 היום.' },
      { id: 'stop12', businessDays: 1, at: '12:00', to: 'lior', level: 'ring', exempt: 'urgent', title: (i) => `עורך לא שויך: ${i.name}`, body: () => 'עצירה קשיחה: היום 12:00 עבר ועוד אין עורך. לשייך עכשיו.' },
    ],
  },

  // 22–24: the editor. A ring on assignment, "not started" two office hours after
  // the drive was handed over (Lior's list after four), days 2 and 3 in the digest,
  // and day 3 at 15:00. Paused editing stops it.
  {
    id: 'editing', event: 'עורך שויך והתקדמות עריכה (22, 24)', procs: ['p22', 'p24'],
    instances(env) {
      return casesOf(env, 'p22', (i) => !!i.ctx.editor && !!i.doneAt('p22a.assigned') && !pauseOf(i.proc, i.checks) && !i.s.wait)
        .map((i) => {
          const p24 = i.same('p24');
          const assigned = i.doneAt('p22a.assigned');
          // Lior moved the deadlines (editing paused): days 2 and 3 move with them.
          const shift = readShift(i.checks[SHIFT_KEY(i.pre)]);
          return {
            ...i, id: i.proc.id, who: i.ctx.editor, url: EDITOR_URL(i.cid), ready: !!p24 && (p24.complete || i.resolved('p24.notify')), p24due: p24?.dueAt, p27due: i.same('p27')?.dueAt,
            anchors: { event: assigned, days: shift ? businessDayFrom(assigned, shift) : assigned },
          };
        })
        .filter((i) => !i.ready);
    },
    steps: [
      { id: 'assigned', to: (i) => i.who, level: 'ring', title: (i) => `לקוח חדש בעריכה אצלך: ${i.name}`, body: (i, env) => [i.p24due && `בדרייב ואצל אופיר עד ${whenText(i.p24due, env.now)}`, i.p27due && `סגירה עד ${whenText(i.p27due, env.now)}`].filter(Boolean).join(' · ') },
      { id: 'nostart', officeMinutes: 120, to: (i) => i.who, level: 'ring', when: (i) => !i.resolved('p22.received'), title: (i) => `עוד לא התחלת: ${i.name}`, body: () => 'עברו שעתיים עבודה מאז שהכונן נמסר. ללחוץ "קיבלתי את הכונן והתחלתי".' },
      { id: 'nostartLior', officeMinutes: 240, to: 'lior', level: 'digest', list: true, overdue: true, when: (i) => !i.resolved('p22.received'), title: (i) => `עריכה לא התחילה: ${i.name} · ${personName(i.who)}`, body: () => 'עברו 4 שעות עבודה מהשיוך.' },
      { id: 'ofir', officeMinutes: 240, to: 'ofir', level: 'quiet', when: (i) => !i.resolved('p22.received'), title: (i) => `עריכה לא התחילה: ${i.name} · ${personName(i.who)}`, body: () => 'עותק לידיעה: עברו 4 שעות עבודה מהשיוך.' },
      { id: 'day2', from: 'days', businessDays: 2, at: '08:30', to: (i) => i.who, level: 'digest', title: (i) => `עריכה, יום 2 מתוך 3: ${i.name}`, body: () => '' },
      { id: 'day3', from: 'days', businessDays: 3, at: '08:30', to: (i) => i.who, level: 'digest', title: (i) => `עריכה, יום 3 מתוך 3: ${i.name}`, body: () => 'עד סוף היום: הכול בדרייב ואצל אופיר.' },
      { id: 'day3pm', from: 'days', businessDays: 3, at: '15:00', to: (i) => i.who, level: 'ring', title: (i) => `היום יום 3: ${i.name}`, body: () => 'עד סוף היום כל הסרטונים בדרייב, ולחיצה על "מוכן לבדיקה".' },
    ],
  },

  // 23: the rest of the graphics. Ofir checks when Ilai marks them ready (and again
  // after each round of fixes: its own case, so each check rings once; decision 16:
  // within the hour); Irit sends once Ofir approved.
  {
    id: 'graphicsRest', event: 'יתרת גרפיקות (23)', procs: ['p23'],
    instances(env) {
      return casesOf(env, 'p23', (i) => !halted(i)).flatMap((i) => {
        const q = qaState(i.checks, i.pre, 'graphics');
        if (q.stage === 'ofir') return [{ ...i, id: q.returns ? `p23.fixed.${q.returns}` : 'p23.made', stage: 'ofir', round: q.round, anchors: { event: q.readyAt } }];
        if (i.doneAt('p23.ofir') && !i.resolved('p23.sent')) return [{ ...i, id: 'p23.ofir', stage: 'irit', anchors: { event: i.doneAt('p23.ofir') } }];
        return [];
      });
    },
    steps: [
      { id: 'ofir', to: 'ofir', level: 'ring', when: (i) => i.stage === 'ofir', title: (i) => `${i.round > 1 ? `התיקונים מוכנים לבדיקה (סבב ${i.round - 1})` : 'יתרת הגרפיקות מוכנה לבדיקה'}: ${i.name}`, body: () => 'יעד: שעה.' },
      { id: 'irit', to: 'irit', level: 'ring', when: (i) => i.stage === 'irit', title: (i) => `לשלוח ללקוח: יתרת הגרפיקות · ${i.name}`, body: () => 'אופיר אישר.' },
    ],
  },

  // 24→25: ready for quality control. Ofir at once and again after 40 office
  // minutes (the clock stops while he is in a characterization, decision 11);
  // Lior's list after an office hour.
  // After a return for fixes, "the fixes are ready" (or the videos marked ready
  // again) starts the same ladder for the new check.
  {
    id: 'qa', event: 'מוכן לבדיקה (24→25)', procs: ['p25'],
    instances(env) {
      return casesOf(env, 'p25', (i) => !halted(i)).flatMap((i) => {
        const q = qaState(i.checks, i.pre, 'videos');
        if (q.stage !== 'ofir') return [];
        const at = q.readyAt;
        return [{ ...i, id: `${i.proc.id}@${at.toISOString()}`, round: q.round, anchors: { event: at, due40: qaClock(env, at, 40), due60: qaClock(env, at, 60) } }];
      });
    },
    steps: [
      { id: 'now', to: 'ofir', level: 'ring', title: (i) => `${i.round > 1 ? `התיקונים מוכנים לבדיקה (סבב ${i.round - 1})` : 'מוכן לבדיקה'}: ${i.name}`, body: (i, env) => `הסרטונים בדרייב. בקרה עד ${whenText(i.anchors.due60, env.now)}.` },
      { id: 'again', from: 'due40', to: 'ofir', level: 'ring', title: (i) => `מחכה לבקרה 40 דקות: ${i.name}`, body: () => 'העורך מחכה לבקרת האיכות.' },
      { id: 'lior', from: 'due60', to: 'lior', level: 'digest', list: true, overdue: true, title: (i) => `בקרת איכות לא בוצעה תוך שעה: ${i.name}`, body: () => 'אופיר עוד לא אישר או החזיר לתיקון.' },
    ],
  },

  // 25: Ofir approved. Irit "send to the client now" (ring); Lior "campaign" (quiet).
  {
    id: 'approved', event: 'אופיר אישר (25)', procs: ['p25', 'p26', 'p30'],
    instances(env) {
      return casesOf(env, 'p25', (i) => !!i.doneAt('p25.approved')).map((i) => {
        const p26 = i.same('p26');
        const p30 = i.same('p30');
        return { ...i, id: i.proc.id, send: !!p26 && !p26.complete && !p26.wait, campaign: !!p30 && !p30.complete, anchors: { event: i.doneAt('p25.approved') } };
      }).filter((i) => i.send || i.campaign);
    },
    steps: [
      { id: 'irit', to: 'irit', level: 'ring', when: (i) => i.send, title: (i) => `לשלוח ללקוח עכשיו: הסרטונים · ${i.name}`, body: () => 'אופיר אישר. אחרי השליחה רץ שעון של 5 דקות.' },
      { id: 'lior', to: 'lior', level: 'quiet', when: (i) => i.campaign, title: (i) => `אפשר לבנות קמפיין: ${i.name}`, body: () => 'אופיר אישר את הסרטונים. יעד: יום עסקים.' },
    ],
  },

  // 28–29: scheduling and the Gantt, two hours from the client's approval (Ilai),
  // with a message at the start and 30 minutes before; then Irit "send the Gantt".
  {
    id: 'publish', event: 'תזמון וגאנט (28, 29)', procs: ['p28', 'p29'],
    instances(env) {
      return casesOf(env, 'p28', (i) => !!i.finishedAt('p27')).flatMap((i) => {
        const p29 = i.same('p29');
        const out = [];
        const open = !i.s.complete || (p29 && !i.resolved('p29.filled'));
        if (open && !i.s.wait) out.push({ ...i, id: i.proc.id, stage: 'ilai', anchors: { event: i.finishedAt('p27'), due: i.s.dueAt } });
        const filled = i.doneAt('p29.filled');
        if (filled && !i.resolved('p29.sent')) out.push({ ...i, id: `${i.proc.id}.gantt`, stage: 'irit', anchors: { event: filled } });
        return out;
      });
    },
    steps: [
      { id: 'start', to: 'ilai', level: 'ring', exempt: 'clock', when: (i) => i.stage === 'ilai', title: (i) => `שעתיים לתזמון ולגאנט: ${i.name}`, body: (i, env) => `הלקוח אישר את הסרטונים. יעד ${whenText(i.anchors.due, env.now)}.` },
      { id: 'pre30', from: 'due', officeMinutes: -30, to: 'ilai', level: 'ring', exempt: 'clock', when: (i) => i.stage === 'ilai', title: (i) => `עוד 30 דקות: תזמון וגאנט · ${i.name}`, body: (i, env) => `יעד ${whenText(i.anchors.due, env.now)}.` },
      { id: 'gantt', to: 'irit', level: 'ring', when: (i) => i.stage === 'irit', title: (i) => `לשלוח גאנט: ${i.name}`, body: () => 'עילאי סיים למלא את הגאנט.' },
    ],
  },

  // 31: the weekly call. Lior's digest on Sunday and Wednesday, a ring on Thursday at
  // 12:00, and at 18:00 on Thursday it is recorded as missed on the owner's screen.
  {
    id: 'weekly', event: 'שיחה שבועית (31)', procs: ['p31'],
    instances(env) {
      const week = weekKey(env.now);
      const sunday = dayFromKeyIL(week);
      return casesOf(env, 'p31', (i) => !i.pre && i.s.ready).filter((i) => {
        const x = i.check('p31.call');
        return !(x && x.state === 'done' && new Date(x.at) >= sunday);
      }).map((i) => ({ ...i, id: `p31@${week}`, anchors: { event: sunday } }));
    },
    steps: [
      { id: 'sun', at: '08:30', to: 'lior', level: 'digest', title: (i) => `שיחה שבועית השבוע: ${i.name}`, body: () => '' },
      { id: 'wed', days: 3, at: '08:30', to: 'lior', level: 'digest', title: (i) => `שיחה שבועית השבוע: ${i.name}`, body: () => 'עוד לא נרשמה.' },
      { id: 'thu', days: 4, at: '12:00', to: 'lior', level: 'ring', title: (i) => `שיחה שבועית: ${i.name}`, body: () => 'עוד לא נרשמה שיחה השבוע.' },
      { id: 'missed', days: 4, at: '18:00', to: OWNER, level: 'board', overdue: true, title: (i) => `שיחה שבועית הוחמצה: ${i.name}`, body: () => 'באחריות ליאור.' },
    ],
  },

  // Irit's daily messages to clients: the list in her 08:30 digest; at 14:00 (quiet)
  // the clients who did not get one yet.
  {
    id: 'dailyMessages', event: 'הודעות יומיות ללקוחות', procs: [],
    instances(env) {
      if (!isBusinessDay(env.now)) return [];
      const today = dayKeyIL(env.now);
      const got = new Set(env.messages.filter((m) => m.sent_at && dayKeyIL(new Date(m.sent_at)) === today).map((m) => m.client_id));
      const left = env.clients.filter((c) => !got.has(c.id));
      if (!left.length) return [];
      return [{ id: today, cid: null, name: '', left, url: 'messages.html', anchors: { event: atTimeIL(env.now, 0) } }];
    },
    steps: [
      { id: 'list', at: '08:30', to: 'irit', level: 'digest', title: (i) => `הודעות יומיות ללקוחות: ${i.left.length}`, body: () => '' },
      { id: '1400', at: '14:00', to: 'irit', level: 'quiet', title: (i) => `עוד לא קיבלו הודעה היום: ${i.left.length} לקוחות`, body: (i) => names(i.left.map((c) => c.name)) },
    ],
  },

  // 32: Irit's daily control. In her digest; a ring at 14:00 if not done; Lior's
  // list when it was missed.
  {
    id: 'control32', event: 'בקרה יומית (32)', procs: [],
    instances(env) {
      if (!isBusinessDay(env.now) || !env.clients.length) return [];
      const today = dayKeyIL(env.now);
      if (env.reviews.some((r) => r.kind === 'p32' && r.day === today)) return [];
      return [{ id: today, cid: null, name: '', url: 'clients.html#control', anchors: { event: atTimeIL(env.now, 0) } }];
    },
    steps: [
      { id: 'list', at: '08:30', to: 'irit', level: 'digest', title: () => 'בקרה יומית (32) היום', body: () => '' },
      { id: '1400', at: '14:00', to: 'irit', level: 'ring', title: () => 'הבקרה היומית עוד לא בוצעה', body: () => 'תהליך 32: לעבור על המשימות ולסמן את החריגות.' },
      { id: 'lior', at: '18:00', to: 'lior', level: 'digest', list: true, overdue: true, title: () => 'הבקרה היומית של עירית הוחמצה', body: () => '' },
    ],
  },

  // 33: Ofir's pass over all clients, at least every other business day: in his
  // digest on the day it is due; Lior's list on the third day.
  {
    id: 'control33', event: 'בקרת לקוחות (33)', procs: [],
    instances(env) {
      if (!isBusinessDay(env.now) || !env.clients.length) return [];
      const days = env.reviews.filter((r) => r.kind === 'p33').map((r) => r.day).sort();
      const last = days.at(-1);
      const gap = last ? businessDaysBetween(dayFromKeyIL(last), env.now) : 99;
      if (gap < 2) return [];
      return [{ id: dayKeyIL(env.now), cid: null, name: '', gap, url: 'clients.html#control', anchors: { event: atTimeIL(env.now, 0) } }];
    },
    steps: [
      { id: 'ofir', at: '08:30', to: 'ofir', level: 'digest', title: () => 'בקרת לקוחות (33) היום', body: () => '' },
      { id: 'lior', at: '08:30', to: 'lior', level: 'digest', list: true, overdue: true, when: (i) => i.gap >= 3, title: () => 'בקרת הלקוחות של אופיר לא בוצעה 3 ימי עסקים', body: () => '' },
    ],
  },

  // Thursday: Ofir's status summaries. One message at 09:00 (it falls in 09:00–09:30,
  // so it arrives in the 08:30 digest), the 13:00 target, Lior's 16:00 list and the
  // owner's 18:00 digest if some are still missing.
  {
    id: 'thursday', event: 'סיכום חמישי', procs: [],
    instances(env) {
      if (weekdayIL(env.now) !== 4 || !isBusinessDay(env.now)) return [];
      const week = weekKey(env.now);
      const have = new Set(env.statusNotes.filter((n) => n.week === week).map((n) => n.client_id));
      const missing = env.clients.filter((c) => !have.has(c.id));
      if (!missing.length) return [];
      return [{ id: week, cid: null, name: '', missing, url: 'clients.html#control', anchors: { event: atTimeIL(env.now, 0) } }];
    },
    steps: [
      { id: '0900', at: '09:00', to: 'ofir', level: 'ring', title: (i) => `סיכומי מצב לחמישי: ${i.missing.length} לקוחות`, body: () => 'היעד: 13:00, כדי שעירית תשלח עדכונים היום.' },
      { id: '1300', at: '13:00', to: 'ofir', level: 'quiet', title: (i) => `יעד 13:00: חסרים ${i.missing.length} סיכומים`, body: (i) => names(i.missing.map((c) => c.name)) },
      { id: 'lior', at: '13:00', to: 'lior', level: 'digest', list: true, overdue: true, title: (i) => `סיכומי חמישי חסרים: ${i.missing.length}`, body: () => '' },
      { id: 'board', at: '18:00', to: OWNER, level: 'board', overdue: true, title: (i) => `סיכומי חמישי חסרים: ${i.missing.length}`, body: () => 'באחריות אופיר.' },
    ],
  },

  // Urgent tasks and urgent exceptions: the owner of the task at once with
  // "התחלתי"; Lior after 30 office minutes without it (decision 9); the owner of
  // the office after four office hours still open (owner case 1).
  {
    id: 'urgent', event: 'משימה דחופה', procs: [],
    instances(env) {
      return env.tasks.filter((t) => t.urgent && !t.done_at && env.clientById.has(t.client_id) && parseDate(t.created_at)).map((t) => {
        const c = env.clientById.get(t.client_id);
        return { id: t.id, cid: c.id, client: c, name: c.name, task: t, who: t.owner, started: !!t.started_at, url: TASK_URL(c.id), anchors: { event: parseDate(t.created_at) } };
      });
    },
    steps: [
      { id: 'now', to: (i) => i.who, level: 'ring', exempt: 'urgent', exception: true, when: (i) => !i.started, title: (i) => `משימה דחופה: ${i.name}`, body: (i) => `${i.task.title}. ללחוץ "התחלתי".` },
      { id: 'lior', officeMinutes: 30, to: 'lior', level: 'ring', exempt: 'urgent', exception: true, when: (i) => !i.started && i.who !== 'lior', title: (i) => `משימה דחופה לא התחילה: ${i.name}`, body: (i) => `${personName(i.who)}: ${i.task.title}. עברו 30 דקות עבודה.` },
      { id: 'owner', officeMinutes: 240, to: OWNER, level: 'ring', title: (i) => `חריגה דחופה פתוחה 4 שעות: ${i.name}`, body: (i) => `${personName(i.who)}: ${i.task.title}` },
    ],
  },

  // An exception reported to Lior that is not urgent: his 12:00 or 16:00 list; the
  // owner's screen after a business day.
  {
    id: 'exception', event: 'חריגה לליאור', procs: [],
    instances(env) {
      return env.tasks.filter((t) => t.source === 'escalation' && !t.urgent && !t.done_at && env.clientById.has(t.client_id) && parseDate(t.created_at)).map((t) => {
        const c = env.clientById.get(t.client_id);
        return { id: t.id, cid: c.id, client: c, name: c.name, task: t, who: t.owner, url: TASK_URL(c.id), anchors: { event: parseDate(t.created_at) } };
      });
    },
    steps: [
      // "אין מי שייצא לאפיון" and missing information that blocks today's work ring at
      // once (the matrix); every other exception goes to his list.
      { id: 'nobody', to: (i) => i.who, level: 'ring', exception: true, when: (i) => i.task.title.startsWith(NO_CHARACTERIZER), title: (i) => `אין מי שייצא לאפיון: ${i.name}`, body: (i) => i.task.title.slice(NO_CHARACTERIZER.length).replace(/^[\s:(]+/, '') },
      { id: 'blocking', to: (i) => i.who, level: 'ring', exception: true, when: (i) => i.task.title.startsWith(BLOCKING_TITLE), title: (i) => `${BLOCKING_TITLE}: ${i.name}`, body: (i) => i.task.title.slice(BLOCKING_TITLE.length).replace(/^[\s:]+/, '') },
      { id: 'list', to: (i) => i.who, level: 'digest', list: true, when: (i) => !RINGING.some((t) => i.task.title.startsWith(t)), title: (i) => `חריגה: ${i.name}`, body: (i) => i.task.title },
      // The matrix: when nobody can go, Irit is told too (quiet).
      { id: 'nobodyIrit', to: 'irit', level: 'quiet', when: (i) => i.task.title.startsWith(NO_CHARACTERIZER) && i.who !== 'irit', title: (i) => `אין מי שייצא לאפיון: ${i.name}`, body: (i) => `עבר לליאור. ${i.task.title.slice(NO_CHARACTERIZER.length).replace(/^[\s:(]+/, '')}` },
      { id: 'board', businessDays: 1, to: OWNER, level: 'board', overdue: true, title: (i) => `חריגה פתוחה יותר מיום עסקים: ${i.name}`, body: (i) => i.task.title },
    ],
  },

  // An ordinary task: quiet when created, in the digest on the morning it is due;
  // a day late, its owner, whoever opened it, Ofir and Lior (quiet; the owner's
  // decision of 3.10.2026); from 24 hours late, the owner's 18:00 summary.
  {
    id: 'task', event: 'משימה רגילה', procs: [],
    instances(env) {
      return env.tasks.filter((t) => !t.urgent && t.source !== 'escalation' && t.source !== TELL && !STATUS_SOURCES.has(t.source) && !t.done_at && env.clientById.has(t.client_id)).map((t) => {
        const c = env.clientById.get(t.client_id);
        const creator = env.personOf(t.created_by_email);
        return { id: t.id, cid: c.id, client: c, name: c.name, task: t, who: t.owner, creator: creator && creator !== t.owner ? creator : null, url: TASK_URL(c.id), anchors: { event: parseDate(t.created_at), due: t.due_on ? dayFromKeyIL(t.due_on) : null } };
      });
    },
    steps: [
      { id: 'created', to: (i) => i.who, level: 'quiet', when: (i) => i.creator !== null || !i.task.created_by_email, title: (i) => `משימה חדשה: ${i.name}`, body: (i) => i.task.title },
      { id: 'due', from: 'due', at: '08:30', to: (i) => i.who, level: 'digest', title: (i) => `משימה להיום: ${i.name} · ${i.task.title}`, body: () => '' },
      { id: 'late', from: 'due', businessDays: 1, at: '08:30', to: (i) => [...new Set([i.who, i.creator, ...LATE_WATCHERS].filter(Boolean))], level: 'quiet', overdue: true, title: (i) => `משימה באיחור: ${i.name}`, body: (i) => `${personName(i.who)}: ${i.task.title}` },
    ],
  },

  // Irit's section 17: a client's request was done (the database opened a 'tell'
  // task for her): "לעדכן את הלקוח" in the app at once, and in her digest the next
  // morning if the client was not updated yet.
  {
    id: 'tell', event: 'בקשת לקוח טופלה: לעדכן את הלקוח', procs: [],
    instances(env) {
      return env.tasks.filter((t) => t.source === TELL && !t.done_at && env.clientById.has(t.client_id) && parseDate(t.created_at)).map((t) => {
        const c = env.clientById.get(t.client_id);
        return { id: t.id, cid: c.id, client: c, name: c.name, task: t, who: t.owner, url: `prep.html?id=${encodeURIComponent(c.id)}#requests`, anchors: { event: parseDate(t.created_at) } };
      });
    },
    steps: [
      { id: 'now', to: (i) => i.who, level: 'quiet', title: (i) => `לעדכן את הלקוח: ${i.name}`, body: (i) => `הבקשה טופלה: ${requestOf(i.task)}` },
      { id: 'next', businessDays: 1, at: '08:30', to: (i) => i.who, level: 'digest', overdue: true, title: (i) => `הלקוח עוד לא עודכן: ${i.name}`, body: (i) => requestOf(i.task) },
    ],
  },

  // 34: renewal. Lior and Irit's digest 75, 60 and 45 days before the contract ends;
  // the owner at once 30 days before if no renewal call was recorded (owner case 4).
  {
    id: 'renewal', event: 'חידוש (34)', procs: ['p34'],
    instances(env) {
      return casesOf(env, 'p34', (i) => i.client.status === 'active' && !!parseDate(i.client.contract_end) && !i.s.complete && !i.resolved('p34.talk'))
        .map((i) => ({ ...i, id: `p34@${i.client.contract_end}`, anchors: { event: parseDate(i.client.contract_end) } }));
    },
    steps: [
      ...[75, 60, 45].flatMap((n) => ['lior', 'irit'].map((p) => ({
        id: `d${n}`, days: -n, at: '08:30', to: p, level: 'digest', title: (i) => `חידוש בעוד ${n} יום: ${i.name}`, body: () => '',
      }))),
      { id: 'owner30', days: -30, at: '10:00', to: OWNER, level: 'ring', title: (i) => `חידוש בלי שיחה, 30 יום לפני הסיום: ${i.name}`, body: (i) => `החוזה מסתיים ב־${dayText(i.anchors.event)}. לא נרשמה שיחת חידוש.` },
    ],
  },

  // Staff not connected to notifications: Irit's digest every business morning.
  {
    id: 'unconnected', event: 'עובד לא מחובר להתראות', procs: [],
    instances(env) {
      if (!isBusinessDay(env.now)) return [];
      const people = STAFF_PEOPLE().map((p) => p.key).filter((k) => env.hasStaff(k) && !env.connected(k));
      if (!people.length) return [];
      return [{ id: dayKeyIL(env.now), cid: null, name: '', people, url: 'team.html', anchors: { event: atTimeIL(env.now, 0) } }];
    },
    steps: [
      { id: 'list', at: '08:30', to: 'irit', level: 'digest', title: (i) => `לא מחוברים להתראות: ${names(i.people.map(personName))}`, body: () => '' },
    ],
  },

  // 1: the contract was sent and not signed. Irit (quiet) after 4 office hours;
  // Lior's list after a business day.
  {
    id: 'contract', event: 'חוזה נשלח ולא נחתם (1)', procs: ['p01'],
    instances(env) {
      return casesOf(env, 'p01', (i) => !!i.doneAt('p01.sent') && !i.resolved('p01.signed') && !i.s.wait)
        .map((i) => ({ ...i, id: 'p01', anchors: { event: i.doneAt('p01.sent') } }));
    },
    steps: [
      { id: 'irit', officeMinutes: 240, to: 'irit', level: 'quiet', title: (i) => `החוזה עוד לא נחתם: ${i.name}`, body: () => 'עברו 4 שעות עבודה מהשליחה.' },
      { id: 'lior', businessDays: 1, to: 'lior', level: 'digest', list: true, overdue: true, title: (i) => `חוזה לא נחתם יום עסקים: ${i.name}`, body: () => '' },
    ],
  },

  // 2: the group was opened. Lior at once (the introduction, shared with Irit, an
  // unusual deal, "the client knows who handles them"); the owner's screen after an office hour.
  {
    id: 'group', event: 'קבוצה נפתחה (2)', procs: ['p02'],
    instances(env) {
      return casesOf(env, 'p02', (i) => !!i.doneAt('p02.opened') && openOf(i, 'lior').length > 0 && !i.s.wait)
        .map((i) => ({ ...i, id: 'p02', anchors: { event: i.doneAt('p02.opened') } }));
    },
    steps: [
      { id: 'lior', to: 'lior', level: 'ring', title: (i) => `קבוצה חדשה נפתחה: ${i.name}`, body: () => 'הודעת היכרות (עם עירית), בדיקת עסקה חריגה, והלקוח יודע מי מטפל בו.' },
      { id: 'board', officeMinutes: 60, to: OWNER, level: 'board', overdue: true, when: (i) => !i.resolved('p02.intro'), title: (i) => `הודעת היכרות לא נשלחה שעה: ${i.name}`, body: () => 'באחריות ליאור ועירית.' },
    ],
  },

  // 5: the access is not in the vault 30 minutes after the meeting (Irit, quiet;
  // it closes by itself when marked). A new logo when there is none (Ilai, quiet).
  {
    id: 'vault', event: 'גישות לא בכספת, לוגו חדש (5)', procs: ['p05'],
    instances(env) {
      const endOf = (i) => i.doneAt(CHAR_ENDED) || i.finishedAt('p04');
      return casesOf(env, 'p05', (i) => !i.s.wait && !!endOf(i))
        .map((i) => ({ ...i, id: 'p05', anchors: { event: endOf(i) } }));
    },
    steps: [
      { id: 'irit', minutes: 30, to: 'irit', level: 'quiet', when: (i) => !i.resolved('p05.vault'), title: (i) => `הגישות עוד לא בכספת: ${i.name}`, body: () => 'עברה חצי שעה מסוף האפיון.' },
      { id: 'logo', to: 'ilai', level: 'quiet', when: (i) => i.client.has_logo === false && !i.resolved('p05.newlogo'), title: (i) => `לוגו חדש: ${i.name}`, body: () => 'אין ללקוח לוגו. הגרפיקות הראשונות תלויות בו.' },
    ],
  },

  // 11ב: Natali's makeup artist and ride. Lior (quiet) once the date is set; three
  // business days before the shoot, Lior and Irit ring and the owner's screen.
  {
    id: 'natali', event: 'נטלי: מאפרת והסעה (11ב)', procs: ['p11b'],
    instances(env) {
      return casesOf(env, 'p11b', (i) => !halted(i) && shootAt(i) && shootAt(i) > env.now && !!i.finishedAt('p11'))
        .map((i) => ({ ...i, id: `${i.proc.id}@${shootAt(i).toISOString()}`, anchors: { event: i.finishedAt('p11'), shoot: shootAt(i) } }));
    },
    steps: [
      { id: 'lior', to: 'lior', level: 'quiet', title: (i) => `לסדר מאפרת והסעה לנטלי: ${i.name}`, body: (i, env) => `הצילום ${whenText(i.anchors.shoot, env.now)}. המאפרת בבית נטלי שעתיים לפני.` },
      ...['lior', 'irit'].map((p) => ({ id: `red${p}`, from: 'shoot', prevBusinessDays: 3, at: '10:00', to: p, level: 'ring', exempt: 'urgent', expires: 'shoot', title: (i) => `מאפרת והסעה לנטלי לא סגורות: ${i.name}`, body: (i, env) => `הצילום ${whenText(i.anchors.shoot, env.now)}.` })),
      { id: 'board', from: 'shoot', prevBusinessDays: 3, at: '10:00', to: OWNER, level: 'board', overdue: true, expires: 'shoot', title: (i) => `מאפרת והסעה לנטלי לא סגורות: ${i.name}`, body: () => 'באחריות ליאור.' },
    ],
  },

  // 12א: the focus call, in Lior's digest on the next business day.
  {
    id: 'focusCall', event: 'שיחת דגשים (12א)', procs: ['p12a'],
    instances(env) {
      return casesOf(env, 'p12a', (i) => charAt(i) && !halted(i)).map((i) => ({ ...i, id: i.proc.id, anchors: { event: charAt(i) } }));
    },
    steps: [
      { id: 'next', businessDays: 1, at: '08:30', to: 'lior', level: 'digest', title: (i) => `שיחת דגשים היום: ${i.name}`, body: () => '' },
    ],
  },

  // 14: shoot-day blockers, computed from what the system knows (shoot-prep.js,
  // the same list Irit sees in prep.html). Irit's digest every morning while there
  // are any; blockers still not reported to Lior two business days before the
  // shoot: Lior (ring). A blocker Irit reported is an exception of its own.
  {
    id: 'blockers', event: 'חוסמי יום צילום (14)', procs: ['p14'],
    instances(env) {
      const out = [];
      for (const c of env.clients) {
        const reported = reportedOf(env.tasks, c.id);
        for (const p of shootPrep(c, env.checksOf(c), env.stateOf(c), { tasks: env.tasks, access: env.access, now: env.now })) {
          if (!p.shootAt || !p.blockers.length) continue;
          const open = p.blockers.filter((b) => !reported.has(b.id) && !b.known);
          out.push({
            id: `${p.pid}p14@${p.shootAt.toISOString()}`, cid: c.id, client: c, name: c.name, ref: `${p.pre}p14`,
            url: `prep.html?id=${encodeURIComponent(c.id)}`, all: p.blockers.length, open: open.length, first: open[0]?.text || p.blockers[0].text,
            anchors: { event: p.shootAt, shoot: p.shootAt },
          });
        }
      }
      return out;
    },
    steps: (i, env) => [
      ...(isBusinessDay(env.now) ? [{ id: `d${dayKeyIL(env.now)}`, from: 'today', at: '08:30', to: 'irit', level: 'digest', expires: 'shoot', title: () => `חוסמי יום צילום: ${i.name} · ${i.all === 1 ? 'חוסם אחד' : `${i.all} חוסמים`}`, body: () => i.first }] : []),
      { id: 'lior', from: 'shoot', prevBusinessDays: 2, at: '10:00', to: 'lior', level: 'ring', expires: 'shoot', when: () => i.open > 0, title: () => `חוסם ביום צילום עדיין פתוח: ${i.name}`, body: (x, e) => `הצילום ${whenText(i.anchors.shoot, e.now)}. ${i.first}${i.open > 1 ? ` ועוד ${i.open - 1}` : ''}.` },
    ],
  },

  // 19: the shoot day was not closed: Lior's digest the next business day, and the owner's screen.
  {
    id: 'shootOpen', event: 'יום הצילום לא נסגר (19)', procs: ['p19'],
    instances(env) {
      return casesOf(env, 'p19', (i) => shootAt(i) && dayKeyIL(shootAt(i)) < dayKeyIL(env.now) && !halted(i, { wait: false }))
        .map((i) => ({ ...i, id: i.proc.id, anchors: { event: shootAt(i) } }));
    },
    steps: [
      { id: 'lior', businessDays: 1, at: '08:30', to: 'lior', level: 'digest', overdue: true, title: (i) => `יום הצילום לא נסגר: ${i.name}`, body: () => '' },
      { id: 'board', businessDays: 1, at: '08:30', to: OWNER, level: 'board', overdue: true, title: (i) => `יום הצילום לא נסגר: ${i.name}`, body: () => 'באחריות ליאור.' },
    ],
  },

  // 19ב: Eli may format the cards once his list is done and Lior confirmed the drive (quiet).
  {
    id: 'cards', event: 'אפשר לפרמט כרטיסים', procs: ['p19b'],
    instances(env) {
      return casesOf(env, 'p19b', (i) => i.s.complete && !!i.finishedAt('p19b') && !!i.doneAt('p19.took'))
        .map((i) => ({ ...i, id: i.proc.id, label: briefingOf(i.checks, i.pre)?.label || noteOf(i.check('p17b.drive')), url: SHOOT_URL(i.cid), anchors: { event: new Date(Math.max(i.finishedAt('p19b'), i.doneAt('p19.took'))) } }));
    },
    steps: [
      { id: 'eli', to: 'eli', level: 'quiet', title: (i) => `אפשר לפרמט את הכרטיסים של ${i.name}${i.label ? `, ${driveName(i.label)}` : ''}`, body: () => 'הכונן אצל ליאור והחומר נבדק.' },
    ],
  },

  // 17ב: Eli answered "לא" to "הבי־רול גמור?" 15 minutes before the influencers: Lior at once.
  {
    id: 'broll', event: 'בי־רול לא גמור (17ב)', procs: ['p17b'],
    instances(env) {
      return casesOf(env, 'p17b', (i) => i.check('p17b.brollq')?.state === 'done' && i.check('p17b.brollq').note === 'no'
        && !!shootAt(i) && dayKeyIL(shootAt(i)) === dayKeyIL(env.now))
        .map((i) => ({ ...i, id: `${i.proc.id}@${shootAt(i).toISOString()}`, url: SHOOT_URL(i.cid), anchors: { event: new Date(i.check('p17b.brollq').at), endOfDay: atTimeIL(shootAt(i), 23, 59) } }));
    },
    steps: [
      { id: 'lior', to: 'lior', level: 'ring', exempt: 'shoot', shoot: true, expires: 'endOfDay', title: (i) => `הבי־רול לא גמור: ${i.name}`, body: () => 'אלי ענה "לא" לפני הגעת המשפיענים.' },
    ],
  },

  // 22: editing paused or resumed: Ofir (quiet) and Lior's list; still paused the
  // next morning, Lior decides (his digest).
  {
    id: 'paused', event: 'עריכה נעצרה (22)', procs: ['p22'],
    instances(env) {
      return casesOf(env, 'p22', (i) => !!pauseOf(i.proc, i.checks) && !i.s.complete).map((i) => {
        const p = pauseOf(i.proc, i.checks);
        const at = new Date(p.at);
        return { ...i, id: `${i.proc.id}@${at.toISOString()}`, who: i.ctx.editor, why: p.for ? pauseText(p) : 'עריכה נעצרה', anchors: { event: at } };
      });
    },
    steps: [
      { id: 'ofir', to: 'ofir', level: 'quiet', title: (i) => `${i.why}: ${i.name}${i.who ? ` · ${personName(i.who)}` : ''}`, body: () => '' },
      { id: 'lior', to: 'lior', level: 'digest', list: true, title: (i) => `${i.why}: ${i.name}${i.who ? ` · ${personName(i.who)}` : ''}`, body: () => '' },
      { id: 'morning', businessDays: 1, at: '08:30', to: 'lior', level: 'digest', overdue: true, title: (i) => `העריכה עדיין עצורה: ${i.name} · להחליט`, body: () => 'להזיז מועדים או להעביר לעורך אחר.' },
    ],
  },

  // 23: the rest of the graphics, in Ilai's digest the morning after the shoot.
  {
    id: 'graphicsRestStart', event: 'יתרת גרפיקות: בוקר שאחרי הצילום (23)', procs: ['p23'],
    instances(env) {
      return casesOf(env, 'p23', (i) => !i.resolved('p23.made') && !halted(i) && !!parseDate(i.client.shoot_at) && parseDate(i.client.shoot_at) < env.now)
        .map((i) => ({ ...i, id: i.proc.id, anchors: { event: parseDate(i.client.shoot_at) } }));
    },
    steps: [
      { id: 'next', businessDays: 1, at: '08:30', to: 'ilai', level: 'digest', title: (i) => `יתרת הגרפיקות היום: ${i.name}`, body: () => '' },
    ],
  },

  // 27: the client did not send notes by the morning of day 4: Irit's digest.
  {
    id: 'clientNotes', event: 'לקוח לא החזיר הערות (27)', procs: ['p27'],
    instances(env) {
      return casesOf(env, 'p27', (i) => !!i.doneAt('p26.sent') && !!i.doneAt('p22a.assigned') && !i.resolved('p27.approved') && !i.resolved('p27.notes') && !halted(i))
        .map((i) => ({ ...i, id: i.proc.id, anchors: { event: i.doneAt('p22a.assigned') } }));
    },
    steps: [
      { id: 'day4', businessDays: 4, at: '08:30', to: 'irit', level: 'digest', title: (i) => `הלקוח לא החזיר הערות: ${i.name}`, body: () => 'אפשר לסמן ממתין ללקוח ולעקוב.' },
    ],
  },

  // 30: the campaign, in Lior's digest the business day after Ofir approved.
  {
    id: 'campaign', event: 'קמפיינים (30)', procs: ['p30'],
    instances(env) {
      return casesOf(env, 'p30', (i) => !!i.doneAt('p25.approved') && !halted(i))
        .map((i) => ({ ...i, id: i.proc.id, anchors: { event: i.doneAt('p25.approved') } }));
    },
    steps: [
      { id: 'next', businessDays: 1, at: '08:30', to: 'lior', level: 'digest', title: (i) => `קמפיין היום: ${i.name}`, body: () => '' },
    ],
  },

  // Decision 21: the weekly campaign check, Tuesday in Lior's digest.
  {
    id: 'campaignCheck', event: 'בדיקת קמפיינים שבועית (החלטה 21)', procs: [],
    instances(env) {
      if (weekdayIL(env.now) !== 2 || !isBusinessDay(env.now)) return [];
      // Marked done this week on Lior's screen (office_reviews kind 'campaigns'): nothing to remind.
      const sunday = weekKey(env.now);
      if (env.reviews.some((r) => r.kind === 'campaigns' && r.day >= sunday)) return [];
      const live = casesOf(env, 'p30', (i) => !i.pre && i.s.complete).map((i) => i.name);
      return live.length ? [{ id: dayKeyIL(env.now), cid: null, name: '', live, url: MINE_URL, anchors: { event: atTimeIL(env.now, 0) } }] : [];
    },
    steps: [
      { id: 'tue', at: '08:30', to: 'lior', level: 'digest', title: (i) => `בדיקת קמפיינים שבועית: ${i.live.length} לקוחות`, body: (i) => names(i.live) },
    ],
  },

  // 31: after a weekly call is saved, Irit checks every task has an owner (quiet).
  {
    id: 'callFollowup', event: 'מעקב אחרי שיחה (31)', procs: ['p31'],
    instances(env) {
      return casesOf(env, 'p31', (i) => !!i.doneAt('p31.call')).map((i) => ({ ...i, id: `p31@${i.doneAt('p31.call').toISOString()}`, anchors: { event: i.doneAt('p31.call') } }));
    },
    steps: [
      { id: 'irit', to: 'irit', level: 'quiet', title: (i) => `שיחה שבועית נשמרה: ${i.name}`, body: () => 'לבדוק שלכל משימה מהשיחה יש אחראי ומועד.' },
    ],
  },

  // 35: ending. Lior (quiet) when the client is marked ending; a ring on the last day.
  {
    id: 'ending', event: 'סיום התקשרות (35)', procs: ['p35'],
    instances(env) {
      return casesOf(env, 'p35', (i) => i.client.status === 'ending' && !i.s.complete && !!parseDate(i.client.contract_end))
        .map((i) => ({ ...i, id: `p35@${i.client.contract_end}`, anchors: { event: parseDate(i.client.contract_end) } }));
    },
    steps: [
      { id: 'lior', days: -1, at: '08:30', to: 'lior', level: 'digest', title: (i) => `סיום התקשרות מחר: ${i.name}`, body: () => 'קמפיינים, גישות, חיבורים והכספת.' },
      { id: 'day', at: '10:00', to: 'lior', level: 'ring', title: (i) => `היום מסתיימת ההתקשרות: ${i.name}`, body: () => 'לעצור קמפיינים, להסיר גישות ולסגור את הכספת של הלקוח.' },
    ],
  },

  // 22: the editor pressed "חסר לוגו / טלפון / חומר" (p22.missing, while the editing
  // waits: its deadline is "חסום", not late). Irit at once; Lior after 3 office
  // hours (decision 7). It stops when the wait ends.
  {
    id: 'editorMissing', event: 'חסר לוגו, טלפון או חומר (22)', procs: ['p22'],
    instances(env) {
      return casesOf(env, 'p22', (i) => !!missingOf(i.checks, i.pre)).map((i) => {
        const m = missingOf(i.checks, i.pre);
        return { ...i, id: `${i.proc.id}@${m.at.toISOString()}`, who: i.ctx.editor, missing: m, anchors: { event: m.at } };
      });
    },
    steps: [
      { id: 'irit', to: 'irit', level: 'ring', title: (i) => `חסר לעורך: ${i.name}`, body: (i) => `${i.who ? `${personName(i.who)}: ` : ''}חסר ${missingText(i.missing.what) || 'חומר'}${i.missing.note ? ` (${i.missing.note})` : ''}. העריכה חסומה עד שזה מגיע.` },
      { id: 'lior', officeMinutes: 180, to: 'lior', level: 'ring', exception: true, title: (i) => `עריכה חסומה 3 שעות: ${i.name}`, body: (i) => `חסר ${missingText(i.missing.what) || 'חומר'}${i.who ? ` אצל ${personName(i.who)}` : ''}. עירית עוד לא סגרה את זה.` },
    ],
  },

  // 27: the client's notes reached the editor (Irit typed them): a ring at once.
  // Lateness of 27 itself goes to Lior's list with a copy to Ofir (`late`).
  {
    id: 'clientFixes', event: 'הערות לקוח (27)', procs: ['p27'],
    instances(env) {
      return casesOf(env, 'p27', (i) => !!i.doneAt('p27.notes') && !i.resolved('p27.fixes') && !i.resolved('p27.approved') && !i.resolved('p27.final'))
        .map((i) => ({ ...i, id: `${i.proc.id}@${i.doneAt('p27.notes').toISOString()}`, who: i.ctx.editor, url: EDITOR_URL(i.cid), anchors: { event: i.doneAt('p27.notes') } }));
    },
    steps: [
      { id: 'editor', to: (i) => i.who, level: 'ring', title: (i) => `הערות הלקוח הגיעו: ${i.name}`, body: () => 'לתקן, להחליף בדרייב ולסמן. התיקונים עוברים ישר לעילאי.' },
    ],
  },

  // Nirel (or anyone with a brief) finished a task: whoever asked for it hears at
  // once, ringing only when it was urgent (the matrix: "בקשה לניראל … בסיום").
  // Reads the tasks finished in the last days (env.doneTasks) that carry a result.
  {
    id: 'briefDone', event: 'בקשה לניראל: הסתיימה', procs: [],
    instances(env) {
      const out = [];
      for (const t of env.doneTasks || []) {
        const c = env.clientById.get(t.client_id);
        const who = env.personOf(t.created_by_email);
        const at = parseDate(t.done_at);
        if (!c || !t.result || !at || !who || who === OWNER || who === t.owner) continue;
        out.push({ id: t.id, cid: c.id, client: c, name: c.name, task: t, who, urgent: !!t.urgent, url: TASK_URL(c.id), anchors: { event: at } });
      }
      return out;
    },
    steps: [
      { id: 'ring', to: (i) => i.who, level: 'ring', exempt: 'urgent', when: (i) => i.urgent, title: (i) => `${personName(i.task.owner)} סיים/ה: ${i.name} · ${i.task.title}`, body: (i) => briefBody(i.task.result) },
      { id: 'quiet', to: (i) => i.who, level: 'quiet', when: (i) => !i.urgent, title: (i) => `${personName(i.task.owner)} סיים/ה: ${i.name} · ${i.task.title}`, body: (i) => briefBody(i.task.result) },
    ],
  },

  // Returned for fixes by Ofir (23, 25): the editor (videos) or Ilai (graphics) at
  // once, with the list and the due time; Lior's list if not fixed by then; the
  // owner's screen on a second round.
  {
    id: 'qaReturn', event: 'הוחזר לתיקון מאופיר (23, 25)', procs: ['p23', 'p25'],
    instances(env) {
      const out = [];
      for (const kind of ['videos', 'graphics']) {
        const k = QA_KINDS[kind];
        for (const i of casesOf(env, k.base, (x) => !halted(x, { claim: false }))) {
          const q = qaState(i.checks, i.pre, kind);
          if (q.stage !== 'fixing') continue;
          const r = q.open;
          out.push({
            ...i, id: `${i.proc.id}.return.${r.n}`, kind, n: r.n, issues: r.issues.length, left: r.issues.length - r.fixed.size, who: k.fixer(i.ctx), what: k.title,
            url: kind === 'videos' ? EDITOR_URL(i.cid) : clientUrl(i.cid), anchors: { event: r.at, due: r.due },
          });
        }
      }
      return out;
    },
    steps: [
      { id: 'now', to: (i) => i.who, level: 'ring', title: (i) => `הוחזר לתיקון (סבב ${i.n}): ${i.name}`, body: (i, env) => `${i.what}: ${i.issues === 1 ? 'בעיה אחת' : `${i.issues} בעיות`} מאופיר.${i.anchors.due ? ` לתקן עד ${whenText(i.anchors.due, env.now)}.` : ''}` },
      { id: 'late', from: 'due', to: 'lior', level: 'digest', list: true, overdue: true, title: (i) => `תיקון לא הושלם במועד: ${i.name} · ${personName(i.who)}`, body: (i) => `${i.what}, סבב ${i.n}: עוד ${i.left} מתוך ${i.issues}.` },
      { id: 'board', to: OWNER, level: 'board', overdue: true, when: (i) => i.n >= 2, title: (i) => `סבב תיקונים ${i.n} מאופיר: ${i.name}`, body: (i) => `${i.what} · ${personName(i.who)}` },
    ],
  },

  // 6: Lior closed a broken login (fixed, or partly: "עדיין חסר"). Irit and Ilai are told (quiet).
  {
    id: 'accessClosed', event: 'גישה שבורה נסגרה (6)', procs: ['p06'],
    instances(env) {
      const out = [];
      for (const c of env.clients) {
        for (const [key, check] of Object.entries(env.checksOf(c))) {
          const m = ACCESS_FIXED.exec(key);
          const v = m && readAccessFix(check);
          if (!v) continue;
          out.push({ id: `${m[1]}@${v.at.toISOString()}`, cid: c.id, client: c, name: c.name, ref: 'p06', url: clientUrl(c.id, 'access'), network: m[1], fix: v, anchors: { event: v.at } });
        }
      }
      return out;
    },
    steps: ['irit', 'ilai'].map((p) => ({
      id: p, to: p, level: 'quiet',
      title: (i) => `${i.fix.partial ? 'גישה תוקנה חלקית' : 'גישה תוקנה'}: ${i.name}`,
      body: (i) => `${NETWORK_NAME[i.network] || i.network}.${i.fix.partial ? ` עדיין חסר: ${i.fix.missing}` : ''}`,
    })),
  },

  // 27: the final versions are in the Drive. Ilai at once (quiet) to press "קיבלתי",
  // which closes the editing; Lior's list if not by the end of that business day.
  {
    id: 'finalReady', event: 'גרסאות סופיות עברו לעילאי (27)', procs: ['p27'],
    // A client who started before "קיבלתי" was in the protocol (p27.toilai, version 2):
    // Ilai still hears the finals are in the Drive, but Lior's list never calls it late.
    fresh: (i) => i.fresh('p27.toilai'),
    instances(env) {
      return casesOf(env, 'p27', (i) => !!i.doneAt('p27.final') && !i.resolved('p27.toilai') && !i.s.wait).map((i) => {
        const at = i.doneAt('p27.final');
        const start = nextWorkMoment(at);
        return { ...i, id: `${i.proc.id}@${at.toISOString()}`, anchors: { event: at, close: atTimeIL(start, erevOn(start) ? WORK_HOURS.erevEnd : WORK_HOURS.end) } };
      });
    },
    steps: [
      { id: 'ilai', to: 'ilai', level: 'quiet', title: (i) => `גרסאות סופיות בדרייב: ${i.name}`, body: () => 'לבדוק ולסמן ״קיבלתי״. זה סוגר את העריכה.' },
      { id: 'lior', from: 'close', to: 'lior', level: 'digest', list: true, overdue: true, title: (i) => `עילאי לא סימן ״קיבלתי״ על הגרסאות הסופיות: ${i.name}`, body: () => 'באותו יום עסקים.' },
    ],
  },

  // Every late item of every employee (the owner's decision of 3.10.2026): Ofir and
  // Lior hear of it in the app, quietly (the list and the badge, no sound), once per
  // deadline. Whatever already rings for it (its own ladder above: urgent, the
  // protocol clocks, the shoot day) keeps ringing. From 24 hours late it is in the
  // owner's one summary at 18:00 (lateSummary in app/reminder-engine.js), never a
  // message per item.
  {
    id: 'late', event: 'איחור', procs: [],
    instances(env) {
      const out = [];
      for (const c of env.clients) {
        for (const s of env.stateOf(c).states) {
          if (s.status !== 'overdue' || s.proc.recurring || !s.dueAt) continue;
          const i = procCase(env, c, s);
          // A claim ("אני על זה") stops the reminders, not the report that it is late.
          if (pauseOf(i.proc, i.checks)) continue;
          // After "the characterization ended", the form has its own ladder (charForm).
          if (baseId(s.proc.id) === 'p04' && i.resolved(CHAR_ENDED)) continue;
          // The final versions are in the Drive: only Ilai's "קיבלתי" (p27.toilai) keeps
          // 27 open, and finalReady follows it; not a second line, nor the editor's lateness.
          if (baseId(s.proc.id) === 'p27' && i.resolved('p27.final')) continue;
          const owners = s.claim ? [s.claim.person] : s.proc.owners;
          out.push({ ...i, id: `${s.proc.id}@${s.dueAt.toISOString()}`, owners, anchors: { event: s.dueAt } });
        }
      }
      return out;
    },
    // `list`: Lior's "החלטות" screen keeps listing what is late (decisions.html), as before.
    steps: LATE_WATCHERS.map((p) => ({
      id: p, to: p, level: 'quiet', overdue: true, list: p === 'lior',
      title: (i) => `באיחור: ${i.name} · ${procName(i.proc)} · ${names(i.owners.filter((o) => o !== 'editor').map(personName)) || 'העורך המשויך'}`,
      body: (i, env) => `היעד היה ${whenText(i.anchors.event, env.now)}.`,
    })),
  },

  // ── The owner's decisions of 3.10.2026 ──
  // A new deal from the field (Stav, deal.html): "להכין חוזה ל־<עסק>". Irit rings at
  // once; 10 office minutes later, if the contract was not sent (a quote linked to
  // the deal, or Irit marked it sent or cancelled), Irit rings again and Ofir too.
  {
    id: 'dealNew', event: 'עסקה חדשה מהשטח: חוזה תוך 10 דקות', procs: [],
    instances(env) {
      return (env.deals || []).filter((d) => d.status === 'pending' && parseDate(d.created_at)).map((d) => {
        const at = parseDate(d.created_at);
        return {
          id: d.id, cid: null, deal: d, name: d.business_name, seller: env.personOf(d.created_by_email),
          url: dealUrl(d), anchors: { event: at, due: addWorkingMinutes(at, DEAL_MINUTES) },
        };
      });
    },
    steps: [
      { id: 'now', to: 'irit', level: 'ring', exempt: 'clock', title: (i) => contractTitle(i.deal), body: (i, env) => `${i.seller ? `מ${personName(i.seller)}: ` : ''}${dealSummary(i.deal)}. יעד ${whenText(i.anchors.due, env.now)}.` },
      { id: 'due', from: 'due', to: 'irit', level: 'ring', exempt: 'clock', title: (i) => `עברו ${DEAL_MINUTES} דקות: ${contractTitle(i.deal)}`, body: () => 'החוזה עוד לא נשלח.' },
      { id: 'ofir', from: 'due', to: 'ofir', level: 'ring', exempt: 'clock', title: (i) => `חוזה לא נשלח ${DEAL_MINUTES} דקות: ${i.name}`, body: (i) => `עסקה ${i.seller ? `של ${personName(i.seller)} ` : ''}מחכה לחוזה מעירית.` },
    ],
  },

  // The deal's client signed: the seller hears, quietly ("<עסק> חתם 🎉").
  {
    id: 'dealSigned', event: 'העסקה נחתמה: לאיש המכירות', procs: [],
    instances(env) {
      return (env.deals || []).filter((d) => d.status === 'signed' && parseDate(d.signed_at)).map((d) => ({
        id: d.id, cid: null, deal: d, name: d.business_name, seller: env.personOf(d.created_by_email), url: 'deal.html',
        anchors: { event: parseDate(d.signed_at) },
      })).filter((i) => i.seller && i.seller !== OWNER);
    },
    steps: [
      { id: 'seller', to: (i) => i.seller, level: 'quiet', title: (i) => `${i.name} חתם 🎉`, body: () => 'החוזה נחתם. תודה!' },
    ],
  },

  // 7ב, 23ב: the client approved graphics (the status page, or Irit marked "אושר"):
  // Ilai rings at once, 30 office minutes to post them. Late: `late` (Ofir and Lior).
  {
    id: 'graphicsUpload', event: 'גרפיקות אושרו: להעלות לרשתות (7ב, 23ב)', procs: ['p07b', 'p23b'],
    instances(env) {
      return ['p07b', 'p23b'].flatMap((b) => casesOf(env, b, (i) => !!i.s.startAt && !!i.s.dueAt && !halted(i)))
        .map((i) => ({ ...i, id: `${i.proc.id}@${i.s.startAt.toISOString()}`, anchors: { event: i.s.startAt, due: i.s.dueAt } }));
    },
    steps: [
      { id: 'now', to: 'ilai', level: 'ring', exempt: 'clock', title: (i) => `הגרפיקות של ${i.name} אושרו — להעלות לרשתות`, body: (i, env) => `${i.proc.title}. יעד ${whenText(i.anchors.due, env.now)} (30 דקות עבודה).` },
    ],
  },

  // The client moved on to the next station: Irit, quietly, with the ready text for
  // the client's group (she sends it herself; the same message is a milestone in
  // the messages queue that day).
  {
    id: 'stationChange', event: 'הלקוח עבר לשלב הבא: הודעה ללקוח', procs: [],
    instances(env) {
      const out = [];
      for (const c of env.clients) {
        const m = stationChange(c, env.checksOf(c), env.stateOf(c), env.now);
        if (m) out.push({ id: m.ref, cid: c.id, client: c, name: c.name, move: m, url: 'messages.html', anchors: { event: m.at } });
      }
      return out;
    },
    steps: [
      { id: 'irit', to: 'irit', level: 'quiet', title: (i) => `${i.name} עבר/ה לשלב ${i.move.to}`, body: (i) => `לשלוח בקבוצה: ${i.move.text}` },
    ],
  },

  // 22א assigned by the server when the shoot day was closed (app/auto-assign.js):
  // Ofir hears quietly, and can change it.
  {
    id: 'autoAssigned', event: 'עורך שויך אוטומטית (22א)', procs: ['p22a'],
    instances(env) {
      return casesOf(env, 'p22a', (i) => !!autoReasonOf(i.checks, i.pre) && !!i.doneAt('p22a.assigned')).map((i) => {
        const r = autoReasonOf(i.checks, i.pre);
        return { ...i, id: `${i.proc.id}@${r.editor}`, editor: r.editor, url: 'qa.html', anchors: { event: i.doneAt('p22a.assigned') } };
      });
    },
    steps: [
      { id: 'ofir', to: 'ofir', level: 'quiet', title: (i) => `שויך אוטומטית: ${i.name} · ${personName(i.editor)}`, body: () => 'לפי העומס, בסיום יום הצילום. אפשר להחליף בבקרה ושיוך.' },
    ],
  },
  ...STATUS_RULES,
];
RULES.push(...YEAR_RULES);

const NO_CHARACTERIZER = 'אין מי שייצא לאפיון';
// Exceptions that ring Lior at once instead of waiting for his 12:00 and 16:00 lists.
const RINGING = [NO_CHARACTERIZER, BLOCKING_TITLE];
const NETWORK_NAME = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', google: 'Google Business', meta: 'Meta Business', other: 'רשת אחרת' };
const EVE_SENT = ['p15.influencers', 'p15.client', 'p15.crew'];
const briefBody = (r) => [r?.done && `בוצע: ${r.done}`, r?.left ? `נשאר: ${r.left} (נפתחה משימת המשך)` : 'לא נשאר דבר', r?.client && 'אופיר בודק, ואז עירית שולחת ללקוח'].filter(Boolean).join(' · ');

// One digest line a day from the business day after the start until the due day ("day X of 3").
function dailyDigest(i, env, to, text, of = 3) {
  const start = i.anchors.event;
  const n = dayOfThree(start, env.now);
  if (!isBusinessDay(env.now) || daysBetweenIL(start, env.now) < 1 || n > of) return [];
  const today = dayKeyIL(env.now);
  return [{ id: `d${today}`, from: 'today', at: '08:30', to, level: 'digest', title: () => text(n), body: () => '' }];
}

// Ofir's quality clock (decision 11): office minutes from `from`, stopped while he
// is in a characterization meeting (from its start until it is marked done, or
// two hours).
export const qaClock = (env, from, minutes) => qaDue(env.ofirMeetings, from, minutes);

// The rule a reminder key belongs to (keys are `rule:client:case:step@person`).
export const ruleOfKey = (key) => String(key).split(':')[0];
export const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));
