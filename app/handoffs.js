// Handoff buttons (stage 1 of docs/plan/system-plan.md, principle 3): every place
// in the protocol where one person passes the work to the next becomes one button
// that opens a ready WhatsApp message to that person, with the client's name,
// what is needed, the due time (Israel time) and a link to the client card.
// Nothing is sent automatically: the button only opens WhatsApp (wa.me links,
// never an unofficial automation), and the person sends it themselves.
//
// Pure data and logic, no DOM: shared by the pages (app/handoff-ui.js) and the
// unit tests (tests/handoffs.test.mjs). Item keys are the protocol's own
// (app/protocol.js); they are never renamed.
import { PEOPLE, PROCESSES } from './protocol.js';
import { clientState, addWorkingMinutes, isBusinessDay, isImmediate, inLanding } from './protocol-logic.js';
import { partsIL, daysBetweenIL, atTimeIL, addDaysIL } from './tz.js';

// The next person, from the client and its marks. `ctx` is the client, or the
// round's view of it (a second shoot day has its own editor).
const editorOf = (ctx) => ctx.editor || 'editor';

// The handoff points, in protocol order (the reminder matrix, section 5 of the plan).
//   on:    an item key (offered when it is checked), or a process id (offered when
//          the check completes that process).
//   label: the short name shown in the card's "העברות" line and in the prompt.
//   to:    one or more next people. Each has
//     id      a short stable id (the record of the send is `<process>.handoff.<id>`;
//             the person it went to is kept in the record's note),
//     person  a person key, or (ctx, checks, roundPrefix) → person key,
//     who     for a person resolved from the client: who that is, in words,
//     proc    the process the next person works on (the link opens it; its due date),
//     until   (optional) the item that shows the next person has done their part;
//             by default, their process being complete. After that the handoff is
//             no longer offered,
//     text    the message; {client} is the client's name,
//     due     [{ label, proc?, minutes?, nextBusinessDayAt?, now? }]:
//               proc              that process's due date (Israel time, office rules),
//               minutes           office minutes from the handoff (also the fallback
//                                 when the process has no due date yet),
//               nextBusinessDayAt that time on the next business day (Israel),
//               now               right away.
// Kept as data, so a wording or a rule changes here without touching the pages.
export const HANDOFFS = [
  {
    id: 'access', on: 'p05.access', label: 'גישות התקבלו',
    to: [{
      id: 'ilai', person: 'ilai', proc: 'p06', until: 'p06.verified',
      text: 'גישות התקבלו ל{client}. יש לך 30 דק׳ לבדוק אותן מהכספת במערכת ולסדר את העמודים.',
      due: [{ label: 'יעד', proc: 'p06', minutes: 30 }],
    }],
  },
  {
    // Protocol v9: Ofir alone checks the graphics; Irit sends them once he approved.
    id: 'graphics9', on: 'p07.made', label: '9 גרפיקות מוכנות לבדיקה',
    to: [{
      id: 'ofir', person: 'ofir', proc: 'p07', until: 'p07.ofir',
      text: '9 הגרפיקות הראשונות של {client} מוכנות לבדיקה שלך.',
      due: [{ label: 'יעד', proc: 'p07' }],
    }],
  },
  {
    id: 'graphics9Ok', on: 'p07.ofir', label: 'אופיר אישר את 9 הגרפיקות',
    to: [{
      // Not 'irit': until protocol v9 that record meant "ready for Irit's check" (RETIRED below).
      id: 'send', person: 'irit', proc: 'p07', until: 'p07.sent',
      text: 'אופיר אישר את 9 הגרפיקות הראשונות של {client}. אפשר לשלוח אותן ללקוח.',
      due: [{ label: 'יעד', proc: 'p07' }],
    }],
  },
  {
    id: 'shootDone', on: 'p19', label: 'יום הצילום הסתיים',
    to: [{
      // Protocol v9: Ofir alone assigns, within the fast ladder's minutes (the process's own deadline).
      id: 'assigner', person: 'ofir', proc: 'p22a', until: 'p22a.assigned',
      text: 'יום הצילום של {client} הסתיים. צריך לשייך עורך ולהעביר אליו את הכונן.',
      due: [{ label: 'יעד', proc: 'p22a' }],
    }],
  },
  {
    id: 'editor', on: 'p22a.assigned', label: 'עורך שויך',
    to: [{
      id: 'editor', person: editorOf, who: 'העורך המשויך', proc: 'p22', until: 'p22.received',
      text: 'הלקוח {client} עובר לעריכה אצלך. הכונן, התסריטים והלוגו בכרטיס הלקוח.',
      due: [{ label: 'בדרייב של הלקוח ואצל אופיר לבקרה', proc: 'p24' }, { label: 'סגירה, כולל תיקוני הלקוח', proc: 'p27' }],
    }],
  },
  {
    id: 'graphicsRest', on: 'p23.made', label: 'יתרת הגרפיקות מוכנה לבדיקה',
    to: [{
      id: 'ofir', person: 'ofir', proc: 'p23', until: 'p23.ofir',
      text: 'יתרת הגרפיקות של {client} מוכנה לבדיקה שלך.',
      // Protocol v9: within the fast ladder's minutes (the process's own deadline).
      due: [{ label: 'יעד', proc: 'p23' }],
    }],
  },
  {
    id: 'graphicsOk', on: 'p23.ofir', label: 'אופיר אישר את יתרת הגרפיקות',
    to: [{
      id: 'irit', person: 'irit', proc: 'p23', until: 'p23.sent',
      text: 'אופיר אישר את יתרת הגרפיקות של {client}. אפשר לשלוח אותן ללקוח.',
      due: [{ label: 'יעד', now: true }],
    }],
  },
  {
    id: 'qa', on: 'p24.notify', label: 'הסרטונים מוכנים לבקרה',
    to: [{
      id: 'ofir', person: 'ofir', proc: 'p25',
      text: 'הסרטונים של {client} בדרייב של הלקוח ומוכנים לבקרת האיכות שלך.',
      due: [{ label: 'יעד', proc: 'p25', minutes: 60 }],
    }],
  },
  {
    id: 'approved', on: 'p25.approved', label: 'אופיר אישר את הסרטונים',
    to: [
      {
        id: 'irit', person: 'irit', proc: 'p26',
        text: 'אופיר אישר את הסרטונים של {client}. לשלוח אותם ללקוח לאישור.',
        due: [{ label: 'יעד', proc: 'p26' }],
      },
      {
        id: 'lior', person: 'lior', proc: 'p30',
        text: 'אופיר אישר את הסרטונים של {client}. אפשר לבחור סרטונים ולבנות קמפיין.',
        due: [{ label: 'יעד', proc: 'p30' }],
      },
    ],
  },
  {
    // The editor's final versions in the client's Drive (p27.final); Ilai's "קיבלתי" is
    // p27.toilai (protocol v5), so once he marked it there is nothing to send.
    id: 'final', on: 'p27.final', label: 'הגרסאות הסופיות עברו לעילאי',
    to: [{
      id: 'ilai', person: 'ilai', proc: 'p28', until: 'p27.toilai',
      text: 'הגרסאות הסופיות של {client} בדרייב של הלקוח. אפשר לתזמן את התכנים ולמלא את הגאנט.',
      due: [{ label: 'יעד', proc: 'p28' }],
    }],
  },
  {
    id: 'gantt', on: 'p29.filled', label: 'הגאנט מלא',
    to: [{
      id: 'irit', person: 'irit', proc: 'p29', until: 'p29.sent',
      text: 'הגאנט של {client} מלא ותואם לתזמון. לשלוח אותו ללקוח.',
      due: [{ label: 'יעד', proc: 'p29' }],
    }],
  },
];

const PROC_OF = new Map(PROCESSES.map((p) => [p.id, p]));
const ROUND_IDS = new Set(PROCESSES.filter((p) => p.round).map((p) => p.id));
const isProcId = (on) => /^p\d+[a-z]?$/.test(on);
const procOfPoint = (point) => (isProcId(point.on) ? point.on : point.on.split('.')[0]);

// The record that WhatsApp was opened for a handoff, stored as a process mark
// (like `.claim` and `.wait`): `p05.handoff.ilai`, `r2.p24.handoff.ofir`.
export const HANDOFF_MARK = /^(?:r\d+\.)?p\d+[a-z]?\.handoff\.[a-z0-9]+$/;
export const markKeyOf = (pre, point, target) => `${pre}${procOfPoint(point)}.handoff.${target.id}`;

// The name to write, and the "to X" form for a button ("לשלוח לעילאי").
export const nameOf = (person) => (person && person !== 'editor' && PEOPLE[person] ? PEOPLE[person].name : null);
export const toName = (person) => (nameOf(person) ? `ל${nameOf(person)}` : 'לעורך המשויך');

// A record key in words, for the card's history: "גישות התקבלו ← עילאי". `note` is
// the record's note: the person WhatsApp was opened for (Lior, when he took the
// editor assignment; the editor by name). Null when the key is not a handoff record.
// Records of hand-offs that no longer exist, so a client's history keeps its words.
const RETIRED = { 'p07.handoff.irit': '9 גרפיקות מוכנות לבדיקה ← עירית' };
export function describeMark(key, note = null) {
  const m = /^(?:r\d+\.)?(p\d+[a-z]?)\.handoff\.([a-z0-9]+)$/.exec(String(key || ''));
  if (!m) return null;
  if (RETIRED[`${m[1]}.handoff.${m[2]}`]) return RETIRED[`${m[1]}.handoff.${m[2]}`];
  for (const point of HANDOFFS) {
    const target = procOfPoint(point) === m[1] && point.to.find((t) => t.id === m[2]);
    if (target) return `${point.label} ← ${nameOf(note) || nameOf(typeof target.person === 'string' ? target.person : null) || target.who}`;
  }
  return null;
}

// A client that was cancelled or has ended has nothing more to hand over.
// Nothing is handed over, and no hand-over clock runs, on a client in landing.
export const isClosed = (client) => client?.status === 'cancelled' || client?.status === 'ended' || inLanding(client);

// ── Israel time in words ──────────────────
const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const pad = (n) => String(n).padStart(2, '0');
// "היום 14:30", "יום ג׳ 6.10 12:00", "סוף היום", "סוף יום ב׳ 12.10": always the
// office's clock, whatever the zone of the device. `now` decides what "today" is.
export function whenText(d, now = new Date()) {
  const p = partsIL(d);
  const today = daysBetweenIL(now, d) === 0;
  const day = today ? 'היום' : `יום ${WEEKDAYS[p.weekday]} ${p.day}.${p.month}`;
  if (p.hour === 23 && p.minute === 59) return `סוף ${day}`;
  return `${day} ${pad(p.hour)}:${pad(p.minute)}`;
}

// 12:00 (or `hhmm`) on the first business day after the Israel day of `d`.
function nextBusinessDayAt(d, hhmm) {
  const [hh, mm] = hhmm.split(':').map(Number);
  let x = atTimeIL(d, 12);
  do x = addDaysIL(x, 1); while (!isBusinessDay(x));
  return atTimeIL(x, hh, mm);
}

// One due line: { label, at: Date | null, now: bool, late: bool, sla }.
// `now` when it is due right away (or at the handoff itself); `late` when its
// time has already passed at `now`; with no date, the protocol's own wording (sla).
function resolveDue(spec, { stateOf, triggerAt, now }) {
  if (spec.now) return { label: spec.label, at: null, now: true, late: false, sla: null };
  let at = null;
  if (spec.proc) at = stateOf(spec.proc)?.dueAt || null;
  if (!at && spec.minutes && triggerAt) at = addWorkingMinutes(triggerAt, spec.minutes);
  if (!at && spec.nextBusinessDayAt && triggerAt) at = nextBusinessDayAt(triggerAt, spec.nextBusinessDayAt);
  if (!at) return { label: spec.label, at: null, now: false, late: false, sla: PROC_OF.get(spec.proc)?.sla || null };
  // Due at the handoff itself (process 26 starts when 25 is done): right away. Such a
  // process has a short working allowance before it is late (IMMEDIATE_MINUTES); the
  // message to the next person still says "מיד".
  const immediate = !!triggerAt && (Math.abs(at - triggerAt) <= 6e4 || (isImmediate(PROC_OF.get(spec.proc)) && at >= now));
  return { label: spec.label, at, now: immediate, late: !immediate && at < now, sla: null };
}

export function dueText(due, now = new Date()) {
  if (due.now) return 'מיד';
  if (due.at && due.late) return `מיד (היעד היה ${whenText(due.at, now)})`;
  if (due.at) return whenText(due.at, now);
  return due.sla || 'לפי הפרוטוקול';
}

// Build the offers of one point: the next people, their due dates and the record keys.
//   handled  the next person already did their part (the target's `until` item, or
//            their process complete): nothing to hand over any more.
//   sentTo   the person WhatsApp was opened for, from the record's note.
function offersOf(point, { client, checks, state, n, triggerKey, triggerAt, now }) {
  const pre = n ? `r${n}.` : '';
  const sid = (pid) => (n && ROUND_IDS.has(pid) ? `r${n}-${pid}` : pid);
  const keyIn = (base) => (n && ROUND_IDS.has(base.split('.')[0]) ? `${pre}${base}` : base);
  const stateOf = (pid) => state.states.find((s) => s.proc.id === sid(pid)) || null;
  const trig = stateOf(procOfPoint(point));
  const ctx = trig?.proc.ctx || client;
  const roundName = n ? ` (סבב צילום ${n})` : '';
  return point.to.map((target) => {
    const person = typeof target.person === 'function' ? target.person(ctx, checks, pre) : target.person;
    const markKey = markKeyOf(pre, point, target);
    const sent = checks[markKey]?.state === 'done' ? checks[markKey] : null;
    const handled = (!!target.until && ['done', 'na'].includes(checks[keyIn(target.until)]?.state)) || !!stateOf(target.proc)?.complete;
    return {
      point, target, person, name: nameOf(person), toName: toName(person), known: !!nameOf(person),
      clientId: client.id, clientName: `${client.name}${roundName}`, round: n,
      procId: sid(target.proc), trigProcId: sid(procOfPoint(point)), triggerKey, triggerAt, markKey,
      sent, sentTo: nameOf(sent?.note), handled,
      text: target.text.replaceAll('{client}', `${client.name}${roundName}`),
      dues: target.due.map((spec) => resolveDue(spec, { stateOf, triggerAt, now })),
    };
  });
}

const parseKey = (key) => {
  const m = /^(?:r(\d+)\.)?(p\d+[a-z]?)\.(.+)$/.exec(String(key || ''));
  return m ? { n: m[1] ? Number(m[1]) : null, procId: m[2], base: `${m[2]}.${m[3]}` } : null;
};

// What to offer right after `key` was checked: the handoffs it triggers, one entry
// per next person. `from` (the person who checked) never gets a message from
// themselves. Nothing on a closed client, or for a next person who already did
// their part. `state` may be passed when already computed (clientState).
export function handoffsFor(client, checks, key, { now = new Date(), from = null, state = null } = {}) {
  const k = parseKey(key);
  if (!k || isClosed(client) || HANDOFF_MARK.test(key) || checks[key]?.state !== 'done') return [];
  const st = state || clientState(client, checks, now);
  const sid = k.n && ROUND_IDS.has(k.procId) ? `r${k.n}-${k.procId}` : k.procId;
  const trig = st.states.find((s) => s.proc.id === sid);
  // Only a real item of the process (never a claim, a wait or a record).
  if (!trig || !trig.proc.items.some((i) => i.key === key)) return [];
  const out = [];
  for (const point of HANDOFFS) {
    const byItem = point.on === k.base;
    const byProc = point.on === k.procId && trig.complete;
    if (!byItem && !byProc) continue;
    const triggerAt = byItem ? new Date(checks[key].at || now) : trig.completedAt || new Date(checks[key].at || now);
    out.push(...offersOf(point, { client, checks, state: st, n: k.n, triggerKey: key, triggerAt, now }));
  }
  return out.filter((o) => !o.handled && (!from || o.person !== from));
}

// Whether the check behind an offer still stands: its item still checked, or (a
// process trigger) its process still complete, on a client still in work. An
// offer whose check was undone has nothing to hand over.
export function stillStands(offer, client, checks, now = new Date()) {
  if (!checks || isClosed(client)) return false;
  if (!isProcId(offer.point.on)) return checks[offer.triggerKey]?.state === 'done';
  return !!clientState(client, checks, now).states.find((s) => s.proc.id === offer.trigProcId)?.complete;
}

// The handoffs out of one process of the card (a state from clientState), for its
// "העברות" line: those still to hand over (the trigger is done, the client is in
// work and the next person has not done their part yet), and any already opened
// in WhatsApp (kept as a record). `live` says whether a button belongs there.
export function handoffsOf(client, checks, state, procState, now = new Date()) {
  const n = procState.proc.ctx?.round || null;
  const pid = procState.proc.id.replace(/^r\d+-/, '');
  const pre = n ? `r${n}.` : '';
  const open = !isClosed(client);
  const out = [];
  for (const point of HANDOFFS) {
    if (procOfPoint(point) !== pid) continue;
    const byProc = isProcId(point.on);
    const triggerKey = byProc ? null : `${pre}${point.on}`;
    const done = byProc ? procState.complete : checks[triggerKey]?.state === 'done';
    const sent = point.to.some((t) => checks[markKeyOf(pre, point, t)]?.state === 'done');
    if (!(done && open) && !sent) continue;
    const triggerAt = byProc ? procState.completedAt : checks[triggerKey] ? new Date(checks[triggerKey].at) : null;
    // A process trigger: the last required item checked stands for the trigger.
    const key = triggerKey || procState.proc.items.filter((i) => !i.optional && checks[i.key]?.state === 'done')
      .sort((a, b) => new Date(checks[b.key].at) - new Date(checks[a.key].at))[0]?.key || null;
    for (const o of offersOf(point, { client, checks, state, n, triggerKey: key, triggerAt, now })) {
      const live = done && open && !o.handled;
      if (live || o.sent) out.push({ ...o, done, live });
    }
  }
  return out;
}

// ── The message and the links ─────────────
// The client card: client.html?id=…#<process of the next person>. `page` is the
// full address of client.html on this site (location.origin + path).
export function clientLink(page, clientId, procId = null) {
  return `${page}?id=${encodeURIComponent(clientId)}${procId ? `#${procId}` : ''}`;
}

export function handoffMessage(offer, { page, now = new Date() }) {
  const hi = offer.known ? `היי ${offer.name},` : 'היי,';
  return [
    hi,
    offer.text,
    ...offer.dues.map((d) => `${d.label}: ${dueText(d, now)}`),
    `כרטיס הלקוח: ${clientLink(page, offer.clientId, offer.procId)}`,
  ].join('\n');
}

// A wa.me link: straight to the person's chat when their number is known
// (staff.phone, digits in international form), otherwise WhatsApp asks whom to send to.
export function waLink(phone, text) {
  const d = String(phone || '').replace(/\D/g, '');
  const to = d.length >= 8 && d.length <= 15 ? d : '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
