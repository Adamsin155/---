// generated — edit app/ instead. Source: app/production.js. Regenerate: node scripts/sync-functions.mjs
// The production pages (stage 3, part 2; docs/plan/system-plan.md §3: העורכים,
// ניראל, אלי, and Lior's shoot-day mode) as pure logic: no DOM, no network, Israel
// time only (tz.js). The pages (app/editor.js, app/shoot.js), the reminder rules
// (app/reminder-rules.js, also in the edge function) and the unit tests read the
// same functions.
//
// Everything a person marks is a protocol check (public.protocol_checks), keyed by
// a stable key (never renamed or reused; docs/protocols/README.md). Existing items
// are used where they exist; the states between them are process marks, like the
// existing `pNN.wait` and `pNN.pause`. In a shoot round the keys carry its prefix
// ('r2.p22.received'). The marks added here:
//   p22.missing  the editor reported a missing logo / phone / footage (note JSON
//                { what: ['logo', 'phone', 'footage'], note }); it holds while the
//                process waits (p22.wait, and p24/p27 with it), so the deadline is
//                "חסום", not late (decision 3 moves it on by the blocked time)
//   p27.fixed    the client's fixes done so far (note JSON { videos: [n] }); all of
//                them = the existing item p27.fixes
//   p16.brief    Lior's briefing to Eli (note JSON { label, notes }): the drive label
//   p17b.brollq  Eli's answer to "הבי־רול גמור?" 15 minutes before (note 'yes' | 'no')
//   p18.shot     Lior's counter "צולמו X מתוך Y" (note JSON { videos: [1, 2, …] })
//   p18.quiet    Lior started the shoot's quiet mode himself (Eli had not arrived yet)
// Ofir's returns for fixes and the editor's "תוקן" are the office's marks
// (app/office-marks.js: p25.return.N, p25.fixed.N.I, p25.fixed.N; marking the
// videos ready again, p24.notify, after a return counts as fixed too), and Ilai's
// "קיבלתי" on the final versions is the item p27.toilai (protocol v5).
// The existing items they sit with: p22.received + p22.check.* (the drive arrived,
// 4 checks), p22.edited + p22.self.* + p24.drive + p24.dropbox + p24.notify ("מוכן
// לבדיקה"), p27.notes (Irit: the client's notes, JSON { videos: [{ n, text }] } or
// plain text), p27.fixes, p27.final (button 4) and Ilai's p27.toilai, p16.photographer (Eli's
// "קיבלתי" on the briefing), p17b.arrived / p17b.drive (arrival), p17b.gear (the
// gear list), p19b.folders / complete / opens / cards / handed (the finish),
// p19b.notes (Eli's notes for the editor, in its note), p19.testimonial / p19.took
// (Lior's side of the handoff) and p22.pause (note JSON { stage, left, why, for,
// task }: `for` is whoever asked for the urgent task, "עצירה לבקשת <שם>").
import { PEOPLE, WORK_HOURS } from './protocol.js';
import {
  roundsOf, roundContext, businessDaysBetween, parseDate, erevOn, IMPORT_NOTE, addBusinessDays, isBusinessDay, nextWorkMoment,
} from './protocol-logic.js';
import { partsIL, dayKeyIL, daysBetweenIL, atTimeIL, endOfDayIL, addDaysIL } from './tz.js';
import { qaState, qaRounds } from './office-marks.js';
import { businessPhoneOf, logoUrlOf, closingLine, validUrl } from './characterization.js';

const MIN = 6e4;
const HOUR = 36e5;
const pad = (n) => String(n).padStart(2, '0');

// ── Words for days and times (Israel time) ──
export const WEEKDAY_LONG = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const clockText = (d) => { const p = partsIL(d); return `${pad(p.hour)}:${pad(p.minute)}`; };
const isEndOfDay = (d) => { const p = partsIL(d); return p.hour === 23 && p.minute === 59; };
// "היום", "מחר", "רביעי", or "רביעי 14.10" when it is a week or more away (or past).
export function dayWords(d, now = new Date()) {
  if (!d) return '';
  const days = daysBetweenIL(now, d);
  const p = partsIL(d);
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days === -1) return 'אתמול';
  if (days > 1 && days < 7) return WEEKDAY_LONG[p.weekday];
  return `${WEEKDAY_LONG[p.weekday]} ${p.day}.${p.month}`;
}
// A deadline in words with its hour: a deadline at the end of a day is the end of
// that office day (18:00, or 13:00 on erev chag), as the plan writes it
// ("אצל אופיר עד רביעי 18:00"); any other deadline keeps its own time.
export function dueWords(d, now = new Date()) {
  if (!d) return '';
  const hour = isEndOfDay(d) ? `${pad(erevOn(d) ? WORK_HOURS.erevEnd : WORK_HOURS.end)}:00` : clockText(d);
  return `${dayWords(d, now)} ${hour}`;
}
// The end of the office day an event falls in (or of the next one, after hours):
// "the same business day" for a reminder.
export function nextWorkClose(d) {
  const m = nextWorkMoment(d);
  return atTimeIL(m, erevOn(m) ? WORK_HOURS.erevEnd : WORK_HOURS.end);
}
// "יום ה׳ 15.10" style for a shoot date.
export const dateWords = (d) => { const p = partsIL(d); return `יום ${WEEKDAY_LONG[p.weekday]} ${p.day}.${p.month}`; };

// ── Day X of 3 ─────────────────────────────
// The editing day: business days since the assignment, the assignment day itself not
// counted (the count starts the next business day). 0 on the assignment day.
export const editingDay = (assignedAt, now = new Date()) => (assignedAt ? businessDaysBetween(assignedAt, now) : 0);
export function editingDayText(n, now = new Date(), assignedAt = null) {
  if (n <= 0) {
    const first = assignedAt ? addBusinessDays(assignedAt, 1) : null;
    return `יום השיוך · יום 1 מתוך 3 מתחיל ${first ? dayWords(first, now) : 'ביום העסקים הבא'}`;
  }
  if (n <= 3) return `יום ${n} מתוך 3`;
  if (n === 4) return 'יום 4 · תיקוני הלקוח';
  return `יום ${n} · אחרי יום 4`;
}

// Videos for one shoot day: the package's videos, split over its shoot days.
export function videosPerDay(client) {
  const d = client?.deliverables || {};
  const videos = Number(d.videos) || 0;
  if (!videos) return null;
  const days = Math.max(1, Number(d.shoot_days) || 1);
  return Math.ceil(videos / days);
}

// ── Reading marks ──────────────────────────
// The words a person wrote on a check (Eli's notes, the drive label, a 12א point),
// never the notes the system writes (imported history, a whole process marked at once).
const SYSTEM_NOTES = new Set([IMPORT_NOTE, 'בסימון כל התהליך', 'בעמוד העריכה', 'בסגירת יום הצילום', 'בתדריך לאלי']);
export function noteOf(check) {
  if (!check || check.state !== 'done') return '';
  const t = String(check.note || '').trim();
  return SYSTEM_NOTES.has(t) ? '' : t;
}
const done = (checks, key) => checks?.[key]?.state === 'done';
const resolved = (checks, key) => ['done', 'na'].includes(checks?.[key]?.state);
const atOf = (checks, key) => (done(checks, key) ? new Date(checks[key].at) : null);
const json = (note) => { try { const v = JSON.parse(note); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const nums = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
// Per-video notes, as [{ n, text }], from { videos: [...] } (a video may be a number,
// a string or { n, text }); plain text, with no per-video list, is kept as `text`.
function videoNotes(note) {
  const v = json(note);
  if (!v) return { videos: [], text: String(note || '').trim() };
  const videos = (Array.isArray(v.videos) ? v.videos : []).map((x, i) => {
    if (typeof x === 'number') return { n: x, text: '' };
    if (typeof x === 'string') return { n: i + 1, text: x };
    return { n: Number(x?.n) || i + 1, text: String(x?.text || '').trim() };
  }).filter((x) => x.n > 0);
  return { videos, text: String(v.text || '').trim(), round: Number(v.round) || null, due: v.due || null };
}

// The client's notes (Irit types them per video, process 27).
export function clientNotesOf(checks, pre = '') {
  const r = checks?.[`${pre}p27.notes`];
  if (!r || r.state !== 'done') return null;
  const v = videoNotes(r.note);
  return { at: new Date(r.at), videos: v.videos, text: v.text };
}
export function clientFixedOf(checks, pre = '') {
  return new Set(nums(json(checks?.[`${pre}p27.fixed`]?.note)?.videos));
}
export const clientFixedNote = (videos) => JSON.stringify({ videos: nums(videos) });

// "חסר לוגו / טלפון / חומר": reported, and still holding the process (its wait).
// 'upload': a video does not go up into the system (uploading there is optional: the
// videos are handed over in the client's Drive; a failed upload can still be reported).
export const MISSING_WHAT = [['logo', 'לוגו'], ['phone', 'טלפון העסק'], ['footage', 'חומר צילום'], ['upload', 'העלאה למערכת (לא עובדת)']];
export const missingText = (what) => MISSING_WHAT.filter(([k]) => (what || []).includes(k)).map(([, l]) => l).join(', ');
export function missingOf(checks, pre = '') {
  const m = checks?.[`${pre}p22.missing`];
  if (!m || m.state !== 'done' || !done(checks, `${pre}p22.wait`)) return null;
  const v = json(m.note) || {};
  return { at: new Date(m.at), what: Array.isArray(v.what) ? v.what : [], note: String(v.note || ''), by_email: m.by_email };
}
export const missingNote = (what, note = '') => JSON.stringify({ what, note: String(note || '').trim() });
// The reason written on the processes' wait while blocked.
export const blockedReason = (what) => `חסר לעורך: ${missingText(what) || 'חומר'}`;
// The editor's processes that stop (and move on) while the editing is blocked.
export const BLOCKS = ['p22', 'p24', 'p27'];

// The editing pause (the existing p22.pause mark), with whoever asked for the task.
export function pauseText(p) {
  if (!p) return '';
  const who = p.for && PEOPLE[p.for] ? PEOPLE[p.for].name : null;
  return who ? `עצירה לבקשת ${who}` : 'העריכה נעצרה';
}
export const pauseNote = ({ stage, left, why = '', for: forWhom = null, task = null }) => JSON.stringify({
  stage: String(stage || '').trim(), left: String(left || '').trim(), why: String(why || '').trim(),
  ...(forWhom ? { for: forWhom } : {}), ...(task ? { task } : {}),
});

// ── The editor's cases ─────────────────────
// Each editing job of `person`: the client's main editing and every shoot round
// that is theirs, once assigned (22א). `state` is clientState() of the client.
export function editingCases(client, checks, person, state) {
  if (!person || !client || !(client.status === 'active' || client.status === 'ending')) return [];
  const jobs = [{ n: 1, pre: '', editor: client.editor, ctx: client },
    ...roundsOf(client).map((r) => ({ n: r.n, pre: `r${r.n}.`, editor: r.editor, ctx: roundContext(client, r) }))];
  const out = [];
  for (const j of jobs) {
    if (j.editor !== person || !done(checks, `${j.pre}p22a.assigned`)) continue;
    const pid = (b) => (j.pre ? `r${j.n}-${b}` : b);
    const st = (b) => state?.states.find((s) => s.proc.id === pid(b)) || null;
    out.push({
      key: `${client.id}:${j.n}`, client, round: j.n, pre: j.pre, ctx: j.ctx,
      assignedAt: atOf(checks, `${j.pre}p22a.assigned`),
      p22: st('p22'), p24: st('p24'), p25: st('p25'), p27: st('p27'),
    });
  }
  return out;
}

// Ilai received the final versions: his "קיבלתי" (the item p27.toilai, protocol v5),
// or he already began scheduling or the Gantt with them (28, 29).
export const ilaiGot = (checks, pre = '') => ['p27.toilai', 'p28.scheduled', 'p29.filled'].some((k) => done(checks, pre + k));

// The state of one editing job: the four buttons of §3 in order.
//   waiting      "ממתין לכונן" → (1) "קיבלתי את הכונן והתחלתי"
//   editing      → (2) "מוכן לבדיקה"
//   qa           with Ofir (first check, or again after a round of fixes)
//   fixes        Ofir returned it (p25.return.N): per-issue "תוקן" / "סמן הכול תוקן"
//                (app/office-ui.js fixList) → back to Ofir
//   client       Ofir approved; with the client
//   clientFixes  the client's notes: per video → p27.fixes
//   final        → (4) "תיקונים הושלמו, הגרסאות הסופיות בדרייב"
//   ilai         with Ilai until he marks "קיבלתי"
//   done         closed
// `blocked` (a missing logo / phone / footage) and `paused` can sit on any open state.
export function editorState(job, checks) {
  const k = (x) => `${job.pre}${x}`;
  const is = (x) => done(checks, k(x));
  const pause = checks?.[k('p22.pause')]?.state === 'done' ? (json(checks[k('p22.pause')].note) || {}) : null;
  const base = { blocked: missingOf(checks, job.pre), paused: pause ? { ...pause, at: checks[k('p22.pause')].at, by_email: checks[k('p22.pause')].by_email } : null };
  if (ilaiGot(checks, job.pre)) return { ...base, key: 'done', blocked: null, paused: null };
  if (is('p27.final')) return { ...base, key: 'ilai' };
  if (!is('p22.received')) return { ...base, key: 'waiting' };
  if (is('p25.approved')) {
    const notes = clientNotesOf(checks, job.pre);
    if (is('p27.approved') || resolved(checks, k('p27.fixes'))) return { ...base, key: 'final', notes };
    if (notes) return { ...base, key: 'clientFixes', notes, fixed: clientFixedOf(checks, job.pre) };
    return { ...base, key: 'client' };
  }
  const q = qaState(checks || {}, job.pre, 'videos');
  if (q.stage === 'fixing') return { ...base, key: 'fixes', ret: q.open, qa: q };
  if (q.stage === 'ofir') return { ...base, key: 'qa', since: q.readyAt, round: q.round };
  return { ...base, key: 'editing' };
}
export const STATE_TEXT = {
  waiting: 'ממתין לכונן', editing: 'בעריכה', qa: 'אצל אופיר לבקרה', fixes: 'תיקונים מאופיר',
  client: 'אצל הלקוח לאישור', clientFixes: 'תיקוני הלקוח', final: 'לסגירה', ilai: 'אצל עילאי', done: 'הושלם',
};
// Button 4 is open only when Ofir approved and the client approved or their fixes are done.
export const canFinish = (st) => st?.key === 'final';

// (1) the four checks when the drive arrives.
export const START_CHECKS = [
  ['p22.check.footage', 'כל חומרי הצילום בכונן'], ['p22.check.scripts', 'התסריטים וסדר הסרטונים ברורים'],
  ['p22.check.logo', 'יש לוגו תקין של העסק'], ['p22.check.phone', 'יש טלפון תקין של העסק'],
];
// (2) the short self-check before "מוכן לבדיקה", each an existing item.
export function selfCheck(needsDropbox) {
  return [
    ['p22.self.spelling', 'אין שגיאות כתיב: כתוביות, כותרות, שמות, טלפונים ומחירים'],
    ['p22.self.closing', 'סגיר עם הלוגו והטלפון הנכונים של העסק, בלי תוספות'],
    ['p22.self.broll', 'אותה תבנית בי־רול בלא יותר מ־3 סרטונים'],
    ['p22.self.complete', 'כל כמות הסרטונים הושלמה ותואמת לתסריטים'],
    ['p24.drive', 'כל הסרטונים בדרייב של הלקוח ונפתחים, בלי גרסאות ישנות'],
    ...(needsDropbox ? [['p24.dropbox', 'הסרטונים הועלו גם ל־Dropbox']] : []),
  ];
}
// What "מוכן לבדיקה" marks: the edit, the self-check, and the notice to Ofir (last:
// its time starts his one-hour clock, app/reminder-rules.js `qa`).
export const readyKeys = (needsDropbox) => ['p22.edited', ...selfCheck(needsDropbox).map(([k]) => k), 'p24.notify'];
// Dropbox is needed when the office put the client's Dropbox link in the card.
export const needsDropbox = (client) => !!String(client?.links?.dropbox || '').trim();

// ── What the editor needs from the business ──
// The business phone and the logo link come from the characterization form
// (public.characterizations.fields.phone / .logo_url, app/characterization.js);
// the client's own phone (clients.phone) is never read here. A logo link the office
// put in the card's links is the fallback. A logo FILE uploaded to the client's files
// (public.client_files, kind 'logo') comes first: `logoFile` is its row (the page
// signs a download link for it), and `logo` the link, when there is one.
// `hasLogo` is what the start check "יש לוגו תקין של העסק" stands on.
export function sheetOf(client, charRow = null, logoFile = null) {
  const phone = businessPhoneOf(charRow) || '';
  const cardLogo = String(client?.links?.logo || '').trim();
  const logo = logoUrlOf(charRow) || (validUrl(cardLogo) ? cardLogo : '');
  const file = logoFile?.storage_path ? logoFile : null;
  return { phone, logo, logoFile: file, hasLogo: !!(file || logo), closing: phone ? closingLine(phone) : '' };
}
export { closingLine };

// ── The editor's own numbers (no leaderboard) ──
// On time: of the editing processes they closed (22, 24, 27; rows of
// health.closedProcesses), how many met the deadline.
export function onTimeOf(rows, person) {
  const mine = (rows || []).filter((r) => ['p22', 'p24', 'p27'].includes(r.key) && (r.people || []).includes(person));
  const onTime = mine.filter((r) => r.onTime).length;
  return { done: mine.length, onTime, rate: mine.length ? onTime / mine.length : null };
}
// First pass: of the videos Ofir decided on the first time, how many he did not
// return. Per job: the first return (p25.return.1, its videos, or the whole batch
// when it names none), or an approval with no return.
export function firstPassOf(jobs) {
  let videos = 0;
  let first = 0;
  for (const j of jobs) {
    const total = Number(j.videos) || 0;
    if (!total || (!j.firstReturn && !j.approved)) continue;
    const back = j.firstReturn ? Math.min(total, j.firstReturn.videos?.length || total) : 0;
    videos += total;
    first += total - back;
  }
  return { videos, first, rate: videos ? first / videos : null };
}
// The first return of a job (round 1 of app/office-marks.js), as { videos: [n] }:
// the numbered videos its issues name (an issue without a number: the whole batch).
export function firstReturnOf(checks, pre = '') {
  const r = qaRounds(checks || {}, pre, 'videos')[0];
  if (!r) return null;
  const refs = r.issues.map((x) => Number(String(x.ref).replace(/[^\d]/g, '')));
  return { videos: refs.length && refs.every((n) => Number.isInteger(n) && n > 0) ? nums(refs) : [] };
}
export const percent = (rate) => (rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`);

// ── Nirel's briefs ─────────────────────────
// Finishing a brief task: what was done (required), what is left, and a link to the
// result (the field is still named `drive` in the saved result).
export function briefResultErrors(v) {
  const out = {};
  if (!String(v.done || '').trim()) out.done = 'כתבו בקצרה מה בוצע.';
  const link = String(v.drive || '').trim();
  if (!link) out.drive = 'הדביקו קישור לתוצר.';
  else if (!/^https:\/\/\S+$/i.test(link)) out.drive = 'קישור מלא, שמתחיל ב־https://.';
  else if (/password|passwd|pwd=|token=|key=/i.test(link)) out.drive = 'קישור בלי סיסמה או קוד.';
  return out;
}
export const briefResult = (v, now = new Date()) => ({
  done: String(v.done || '').trim().slice(0, 1000), left: String(v.left || '').trim().slice(0, 1000),
  drive: String(v.drive || '').trim().slice(0, 500), client: !!v.client, at: now.toISOString(),
});
// What opens when a brief task is finished:
//   something left → a follow-up for whoever asked, the next business day;
//   work that goes to the client (graphics, a problem client) → Ofir checks first,
//   then Irit sends (decision 19): Ofir's task carries `route: 'irit'`, and closing
//   it opens Irit's (the database does that: 20260930140000_production.sql).
export function briefFollowups(task, result, requester, now = new Date()) {
  const out = [];
  const asker = requester && requester !== task.owner && PEOPLE[requester] && requester !== 'editor' && requester !== 'eli' ? requester : 'lior';
  const nextDay = dayKeyIL(addBusinessDays(now, 1));
  if (result.left) {
    out.push({
      client_id: task.client_id, owner: asker, due_on: nextDay,
      title: `המשך אחרי ${PEOPLE[task.owner]?.name || ''}: ${task.title}`.slice(0, 500),
      brief: { problem: `נשאר: ${result.left}`, result: `בוצע: ${result.done}`, materials: result.drive },
    });
  }
  if (result.client) {
    out.push({
      client_id: task.client_id, owner: 'ofir', due_on: dayKeyIL(now),
      title: `לבדוק לפני שליחה ללקוח: ${task.title}`.slice(0, 500),
      brief: { problem: `עבודה של ${PEOPLE[task.owner]?.name || ''} שיוצאת ללקוח. אחרי האישור עירית שולחת.`, result: result.done, materials: result.drive, route: 'irit' },
    });
  }
  return out;
}
// Prefilled pause for an urgent task taken while editing: the stage and what is left.
export function pausePrefill(job, st, now = new Date()) {
  const day = editingDay(job.assignedAt, now);
  const stage = `${STATE_TEXT[st?.key] || 'בעריכה'}${day > 0 ? ` · ${editingDayText(day, now)}` : ''}`;
  const videos = videosPerDay(job.ctx);
  const due = job.p24?.dueAt;
  const open = st?.key === 'fixes' ? (st.ret?.issues?.length || 0) - (st.ret?.fixed?.size || 0) : 0;
  const left = st?.key === 'fixes' ? `תיקונים מאופיר (${open === 1 ? 'תיקון אחד' : open > 1 ? `${open} תיקונים` : 'כל התיקונים'})`
    : st?.key === 'clientFixes' ? 'תיקוני הלקוח'
      : `${videos ? `${videos} סרטונים` : 'הסרטונים'}${due ? `, אצל אופיר עד ${dueWords(due, now)}` : ''}`;
  return { stage, left };
}

// ── Shoot days (Eli, and Lior's shoot-day mode) ──
// Each shoot (the main one and every round) with its own key prefix.
export function shootCases(client) {
  if (!client || !(client.status === 'active' || client.status === 'ending')) return [];
  const list = [{ n: 1, pre: '', ctx: client }, ...roundsOf(client).map((r) => ({ n: r.n, pre: `r${r.n}.`, ctx: roundContext(client, r) }))];
  return list.map((x) => ({ ...x, key: `${client.id}:${x.n}`, client, shootAt: parseDate(x.ctx.shoot_at), natali: x.ctx.shoot_type === 'natali' }))
    .filter((x) => x.shootAt);
}
// Eli arrives an hour before the influencers (shoot_at is their arrival).
export const arrivalOf = (shootAt) => new Date(shootAt.getTime() - HOUR);
// Length of the shooting window: Natali 3 hours; Denis, Michel and Semyon 5.5 hours (20, 21).
export const windowMinutes = (natali) => (natali ? 180 : 330);
// Navigation links for an address (Waze, Google Maps).
export function navLinks(address) {
  const a = String(address || '').trim();
  if (!a) return null;
  const q = encodeURIComponent(a);
  return { waze: `https://waze.com/ul?q=${q}&navigate=yes`, maps: `https://www.google.com/maps/dir/?api=1&destination=${q}` };
}
// The day's timeline, with the time-management prompts (§3, 20, 21).
export function timeline(sc) {
  const t = sc.shootAt.getTime();
  const at = (min) => new Date(t + min * MIN);
  const list = [
    ...(sc.natali ? [{ key: 'makeup', at: at(-120), label: 'המאפרת בבית של נטלי' }] : []),
    { key: 'eli', at: at(-60), label: 'אלי מגיע · בי־רול של העסק' },
    { key: 'influencers', at: at(0), label: 'המשפיענים מגיעים' },
    ...(sc.natali
      ? [{ key: 'hourLeft', at: at(120), label: 'נותרה שעה', prompt: true }]
      : [{ key: 'begin', at: at(30), label: 'להתחיל לצלם', prompt: true }, { key: 'progress', at: at(240), label: 'בדיקת התקדמות', prompt: true }]),
    { key: 'end', at: at(windowMinutes(sc.natali)), label: 'סוף החלון' },
  ];
  return list.sort((a, b) => a.at - b.at);
}
// The counter: the numbered videos shot so far.
export const shotOf = (checks, pre = '') => nums(json(checks?.[`${pre}p18.shot`]?.note)?.videos);
export const shotNote = (videos) => JSON.stringify({ videos: nums(videos) });
export const nextVideo = (shot) => (shot.length ? Math.max(...shot) + 1 : 1);
export const counterText = (n, y) => (y ? `צולמו ${n} מתוך ${y}` : `צולמו ${n}`);
// Lior's briefing to Eli, and Eli's "קיבלתי".
export function briefingOf(checks, pre = '') {
  const b = checks?.[`${pre}p16.brief`];
  if (!b || b.state !== 'done') return null;
  const v = json(b.note) || {};
  const ack = checks?.[`${pre}p16.photographer`];
  return { label: String(v.label || '').trim(), notes: String(v.notes || '').trim(), at: new Date(b.at), by_email: b.by_email, ack: ack?.state === 'done' ? new Date(ack.at) : null };
}
// The drive by its label: "כונן 3" whether Lior typed "3" or "כונן 3".
export const driveName = (label) => { const l = String(label || '').trim(); return !l ? '' : /^כונן/.test(l) ? l : `כונן ${l}`; };
export const briefNote = (label, notes = '') => JSON.stringify({ label: String(label || '').trim(), notes: String(notes || '').trim() });
// The briefing goes out the evening before (17:00 of the business day before the shoot;
// for a Sunday shoot, Thursday; decision 15).
export function briefingDay(shootAt) {
  let d = atTimeIL(shootAt, 12);
  do d = addDaysIL(d, -1); while (!isBusinessDay(d));
  return atTimeIL(d, 17);
}
// Eli's gear checklist, the evening before (the only place it appears).
export const GEAR = [['batteries', 'סוללות טעונות'], ['cards', 'כרטיסים ריקים'], ['mics', 'מיקרופונים'], ['lights', 'תאורה']];
// Eli's finish: the four items, then "מסרתי לליאור" (locked until they are done).
export const FINISH = [
  ['p19b.folders', 'בכונן תיקיית "בי־רול" ותיקיית "סרטונים" 01 עד N, לפי התסריטים'],
  ['p19b.complete', 'כל הסרטונים וכל הבי־רול בכונן'],
  ['p19b.opens', 'הקבצים נפתחים'],
  ['p19b.cards', 'שום דבר לא נשאר רק על הכרטיסים'],
];
export const finishOpen = (checks, pre = '') => FINISH.filter(([k]) => !done(checks, pre + k)).map(([k]) => k);
// The drive going back to Lior: recorded once, confirmed by both.
export function handoffOf(checks, pre = '') {
  const eli = atOf(checks, `${pre}p19b.handed`);
  const lior = atOf(checks, `${pre}p19.took`);
  return { eli, lior, done: !!(eli && lior), at: eli && lior ? new Date(Math.max(eli, lior)) : null };
}
// The shoot day runs from its start (shoot_at, when the influencers arrive): the
// counter and the closing are not available before it (found live, 6.10.2026: a day
// counted 25/25 and closed 36 minutes before it began). Eli's steps before the
// arrival (the briefing, the gear, "הגעתי") are not held by this.
export const shootStarted = (sc, now = new Date()) => !!sc?.shootAt && now >= sc.shootAt;
export const startsText = (shootAt) => `מתחיל ב־${clockText(shootAt)}`;
// The shoot day can be closed only from its start, with the testimonial video, the
// full quantity (the counter, or Lior's check when the package has no number) and
// the drive back. `startAt` is the shoot's start; without it only the marks decide.
export function closeLock(checks, pre = '', target = null, { startAt = null, now = new Date() } = {}) {
  const missing = [];
  const early = !!startAt && now < startAt;
  if (early) missing.push(`יום הצילום ${startsText(startAt)}`);
  const shot = shotOf(checks, pre).length;
  if (!done(checks, `${pre}p19.testimonial`)) missing.push('סרטון המלצה');
  if (target ? shot < target : !done(checks, `${pre}p18.all`)) missing.push(target ? `עוד ${target - shot} סרטונים (${counterText(shot, target)})` : 'סימון שכל הכמות צולמה');
  const h = handoffOf(checks, pre);
  if (!h.eli) missing.push('אלי עוד לא סימן שמסר את הכונן');
  if (!h.lior) missing.push('לא אישרת שהכונן חזר אליך');
  return { ok: !missing.length, missing, shot, early };
}
// After the day is closed: who edits. The server assigns the editor by itself in the
// next reminders run (app/auto-assign.js) and tells Ofir quietly; an editor already
// in the card is kept.
export function afterCloseText(checks, pre = '', ctx = null) {
  const editor = ctx?.editor && PEOPLE[ctx.editor] ? PEOPLE[ctx.editor].name : null;
  if (done(checks, `${pre}p22a.assigned`) && editor) return `העריכה אצל ${editor}.`;
  if (editor) return `העריכה נשארת אצל ${editor}, כפי שנרשם בכרטיס, ואופיר יקבל על כך הודעה.`;
  return 'העורך ישויך אוטומטית לפי העומס, ואופיר יקבל על כך הודעה.';
}
// What closing the day marks (with the testimonial and the handoff already marked).
export const CLOSE_KEYS = ['p18.order', 'p18.all', 'p19.all', 'p19.drive'];

// Lior's quiet mode on a shoot (decision 8, "מצב שקט"): from Eli's "הגעתי" (or
// Lior's own start, p18.quiet) until the drive is back and confirmed by both, the
// day is closed (19), or the day ends. Only marks made on the shoot day count.
export function quietWindow(sc, checks, p19CompletedAt = null) {
  const day = dayKeyIL(sc.shootAt);
  const onDay = (k) => {
    const c = checks?.[sc.pre + k];
    return c && c.state === 'done' && c.note !== IMPORT_NOTE && dayKeyIL(new Date(c.at)) === day ? new Date(c.at) : null;
  };
  const starts = [onDay('p17b.arrived'), onDay('p18.quiet')].filter(Boolean);
  if (!starts.length) return null;
  const from = new Date(Math.min(...starts));
  const h = handoffOf(checks, sc.pre);
  const ends = [endOfDayIL(sc.shootAt), h.done ? h.at : null, p19CompletedAt].filter(Boolean);
  const to = new Date(Math.min(...ends));
  return to > from ? { from, to, by: onDay('p17b.arrived') ? 'eli' : 'lior' } : null;
}

// ── History lines for the marks above (client card) ──
export function markHistory(base, r) {
  const clear = r.action === 'clear';
  const v = json(r.note) || {};
  switch (base) {
    case 'p22.missing': return clear ? 'סימן/ה שהחוסר אצל העורך טופל' : `דיווח/ה שחסר לעריכה: ${missingText(v.what) || 'חומר'}${v.note ? ` (${v.note})` : ''}`;
    case 'p27.fixed': return clear ? null : `סימן/ה תיקוני לקוח: סרטונים ${nums(v.videos).join(', ') || '—'}`;
    case 'p16.brief': return clear ? 'ביטל/ה את התדריך לאלי' : `שלח/ה תדריך לאלי${v.label ? `, ${driveName(v.label)}` : ''}`;
    case 'p17b.brollq': return clear ? null : r.note === 'no' ? 'ענה/תה שהבי־רול לא גמור' : 'ענה/תה שהבי־רול גמור';
    case 'p18.shot': return clear ? 'איפס/ה את מונה הסרטונים' : `מונה יום הצילום: צולמו ${nums(v.videos).length}`;
    case 'p18.quiet': return clear ? 'ביטל/ה מצב שקט' : 'הפעיל/ה מצב שקט ליום הצילום';
    default: return null;
  }
}
