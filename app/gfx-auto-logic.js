// Graphics tasks that close by themselves (the owner, 17.11.2026; docs/ops.md, section 138).
// Ilai had many open "נודניק" tasks about graphics that were already done, and the system kept
// ringing him. The system now looks for the work itself:
//   stage 1  a task to a graphics person (GRAPHICS_PEOPLE in app/protocol.js), on a client, whose
//            words are about making or scheduling graphics, closes when new graphics appeared
//            AFTER it was given: files in the client's Drive graphics folders (public.drive_daily,
//            kind 'graphic', counted by the Drive scan), or graphics scheduled/posted in the
//            client's Gantt (public.client_gantt, synced from Metricool).
//   stage 2  the giver may say what kind of task it is (להכין / לתקן / לתזמן) and how many
//            graphics; such a task closes when the number is reached ("4 מתוך 10").
//   stage 3  a fix task (לתקן) is checked by Claude against its notes, once new graphics files
//            appeared (supabase/functions/gfx-auto).
// Pure, no DOM and no network: the gfx-auto function, the card (app/staff-tasks-ui.js), the
// reminder rules and the tests read the same rules.
import { isGraphics } from './protocol.js';
import { dayKeyIL } from './tz.js';

// ── The kinds ─────────────────────────────
// 'schedule' is the graphics' scheduling; 'schedule_videos' (the owner, 24.11.2026; docs/ops.md, section
// 152) the videos', given apart from it and closed by the videos scheduled in the Gantt.
export const GFX_KINDS = [['make', 'להכין'], ['fix', 'לתקן'], ['schedule', 'לתזמן גרפיקות'], ['schedule_videos', 'לתזמן סרטונים']];
const UNIT = (kind) => (kind === 'schedule_videos' ? 'סרטונים' : 'גרפיקות');
export const GFX_LABEL = Object.fromEntries(GFX_KINDS);
export const GFX_COUNT_MAX = 200;
export const AUTO_EMAIL = 'system:auto'; // done_by_email of a task the system closed

// ── The words of a task (stage 1) ─────────
// A Hebrew word may carry up to two prefix letters (ו, ה, ב, ל, ש, כ, מ: "ולמספר", "בגרפיקות").
const HE = 'א-ת';
const word = (stems) => new RegExp(`(?:^|[^${HE}])[והבלשכמ]{0,2}(?:${stems})`, 'u');
const GFX = /גרפיק/u;                                            // גרפיקה, גרפיקות, "להכיןנגרפיקות"
const VIDEO = word('סרטו|סירטו|וידאו|וידיאו|רילס|ריל(?![א-ת])');  // a task that is also about videos
// Fixing what exists: "לתקן", "תיקון", "לשנות", "הערות", "להוסיף בגרפיקות".
const FIX = new RegExp(`${word('תקן|תקנ|תיקו|לשנות|שינוי|שינויים|הער(?:ה|ות)').source}|להוסיף\\s+[ב]`, 'u');
// Putting them on the networks: the Gantt is the proof.
const SCHEDULE = word('תזמן|תזמו|העלות|העלא|פרסם|פרסו');
// Only looking or sending: not the graphics' own work.
const CHECK_ONLY = word('בדוק|בדיק');
const MAKE = word('הכין|הכנ|עשות|יצור|עצב|מספר|דלל');
// → 'make' | 'schedule' | 'fix' | null (not a graphics task the system can judge).
//   - no "גרפיק" in it: null;
//   - fix words: 'fix' (stage 3; never closed by a count of files), also when videos are named
//     (the AI says which notes it cannot judge, and only those it can are counted);
//   - otherwise, with videos named as well ("להעלות ולתזמן סרטונים וגרפיקות"): null, part of the
//     task is not graphics and new graphics do not prove it;
//   - schedule words ("לתזמן", "להעלות", "לפרסם"): 'schedule' (the Gantt only);
//   - "לבדוק" with no making word: null;
//   - anything else about graphics ("להכין", "לעשות", "למספר", "לדלל", or just "גרפיקות"): 'make'.
export function classifyText(body) {
  const t = String(body || '').replace(/\s+/g, ' ').trim();
  if (!GFX.test(t)) return null;
  if (FIX.test(t)) return 'fix';
  if (VIDEO.test(t)) return null;
  if (SCHEDULE.test(t)) return 'schedule';
  const withoutGfx = t.replace(/[והבלשכמ]{0,2}גרפיק[א-ת]*/gu, ' ');
  if (CHECK_ONLY.test(t) && !MAKE.test(withoutGfx)) return null;
  return 'make';
}
// The kind of a task: the one the giver chose (stage 2), else its words (stage 1).
export const kindOf = (task) => (GFX_LABEL[task?.gfx_kind] ? task.gfx_kind : classifyText(task?.body));

// Whether the system may judge this task at all: open, a graphics person's, on a client.
export const judged = (task) => !!task && task.status === 'open' && isGraphics(task.assignee) && !!task.client_id && !!kindOf(task);

// ── The evidence ──────────────────────────
// The Drive's highlight covers are counted as 'graphic' by the scan (their folder says
// "היילייט"); they are Ofir's and Amit's work (8), never a graphics task's.
export const isHighlightFolder = (folder) => /היילייט/u.test(String(folder || ''));
const time = (v) => (v ? new Date(v).getTime() : NaN);

// New graphics files in the Drive since `since` (an ISO time). public.drive_daily keeps counts per
// Israel day, without the hour. The day of `since` itself counts only above `base`: the number of
// graphics files that day when the task was given (or reopened), stamped on the task by the
// database (staff_tasks.gfx_base / auto_reopen_base). Without a base (a task given before this
// came) that day is not counted at all: only the days after it.
// → { files, last: the newest day with new files ('2026-11-15') or null }
export function driveSince(rows, since, base) {
  const day = dayKeyIL(new Date(since));
  let files = 0;
  let last = null;
  let sameDay = 0;
  for (const r of rows || []) {
    if (r.kind !== 'graphic' || isHighlightFolder(r.folder)) continue;
    const d = String(r.day).slice(0, 10);
    const n = Number(r.files) || 0;
    if (d > day) { files += n; if (n && (!last || d > last)) last = d; } else if (d === day) sameDay += n;
  }
  if (base !== null && base !== undefined && sameDay > Number(base)) {
    files += sameDay - Number(base);
    if (!last) last = day;
  }
  return { files, last };
}

// Graphics in the Gantt that went into Metricool (scheduled) or up (posted) since `since`. The
// moment is client_gantt.live_at, stamped by the database when the row became scheduled or
// posted; a row from before that column came has none, and its created_at stands in (a row the
// sync added for a new post is created when the post is). A row scheduled before the task and
// published after it is not new work, and is not counted.
// → { count, last: the newest moment (ISO) or null }
//   kind: 'graphic' (the default) or 'video' (a "לתזמן סרטונים" task).
export function ganttSince(rows, since, kind = 'graphic') {
  const from = time(since);
  let count = 0;
  let last = null;
  for (const r of rows || []) {
    if (r.kind !== kind || !['scheduled', 'posted'].includes(r.state)) continue;
    const at = r.live_at || r.created_at;
    if (!(time(at) > from)) continue;
    count += 1;
    if (!last || time(at) > time(last)) last = at;
  }
  return { count, last };
}

const dm = (day) => { const [, m, d] = String(day).slice(0, 10).split('-'); return `${Number(d)}.${Number(m)}`; };

// What the system sees for a task, and whether it closes now.
//   task:  a staff_tasks row (created_at, gfx_kind, gfx_count, gfx_base, auto_reopened_at, auto_reopen_base)
//   drive: the client's drive_daily rows; gantt: the client's client_gantt rows.
// → { kind, n (the progress: graphics found since the task was given), close, note (the line
//     "נסגר אוטומטית: …" when it closes), source: 'drive' | 'gantt' | null }
// A fix task is never closed here (stage 3 decides). A task opened again after the system had
// closed it needs something new since it was reopened: never the same evidence twice.
export function judge(task, { drive = [], gantt = [] } = {}) {
  const kind = kindOf(task);
  const out = { kind, n: 0, close: false, note: null, source: null };
  if (!judged(task) || kind === 'fix') return out;
  const videos = kind === 'schedule_videos';
  const d = videos ? { files: 0, last: null } : driveSince(drive, task.created_at, task.gfx_base);
  const g = ganttSince(gantt, task.created_at, videos ? 'video' : 'graphic');
  // להכין: the files in the Drive (or graphics already scheduled, which were surely made);
  // לתזמן: the Gantt only.
  const useDrive = kind === 'make' && d.files >= g.count && d.files > 0;
  out.source = useDrive ? 'drive' : g.count ? 'gantt' : null;
  out.n = useDrive ? d.files : g.count;
  const need = Number(task.gfx_count) > 0 ? Number(task.gfx_count) : 1;
  let enough = out.n >= need;
  if (enough && task.auto_reopened_at) {
    const nd = kind === 'make' ? driveSince(drive, task.auto_reopened_at, task.auto_reopen_base).files : 0;
    const ng = ganttSince(gantt, task.auto_reopened_at, videos ? 'video' : 'graphic').count;
    enough = nd + ng > 0;
  }
  if (!enough) return out;
  out.close = true;
  out.note = out.source === 'drive'
    ? `נסגר אוטומטית: עלו ${out.n} גרפיקות בדרייב${d.last ? ` ב־${dm(d.last)}` : ''}`
    : `נסגר אוטומטית: תוזמנו ${out.n} ${UNIT(kind)} בגאנט${g.last ? ` עד ${dm(dayKeyIL(new Date(g.last)))}` : ''}`;
  return out;
}

// ── On the card ───────────────────────────
export const isAuto = (task) => task?.status === 'done' && task?.done_by_email === AUTO_EMAIL;
// "להכין · 4 מתוך 10" (a typed task), "להכין" (a typed task without a number), or null.
export function progressText(task) {
  const label = GFX_LABEL[task?.gfx_kind];
  if (!label) return null;
  const count = Number(task.gfx_count) || 0;
  if (!count) return label;
  const done = Math.min(Number(task.gfx_done) || 0, count);
  return `${label} · ${done} מתוך ${count}`;
}
// How long an auto-closed task stays on its assignee's list, with "לפתוח מחדש".
export const AUTO_SHOW_DAYS = 3;
export const recentAuto = (task, now = new Date()) => isAuto(task) && now - new Date(task.done_at) < AUTO_SHOW_DAYS * 864e5;

// The form's choice (stage 2) → { gfx_kind?, gfx_count? } to send in the brief, or errors.
// Only for a graphics person and a client; both are optional; a number without a kind is 'make'.
export function gfxChoice({ assignee, clientId, kind = '', count = '' } = {}) {
  const errors = {};
  if (!isGraphics(assignee) || !clientId) return { ok: true, errors, value: {} };
  const value = {};
  if (kind) {
    if (!GFX_LABEL[kind]) errors.gfxKind = 'בוחרים סוג מהרשימה.';
    else value.gfx_kind = kind;
  }
  const c = String(count ?? '').trim();
  if (c) {
    if (!/^\d{1,3}$/.test(c) || Number(c) < 1 || Number(c) > GFX_COUNT_MAX) errors.gfxCount = `מספר בין 1 ל־${GFX_COUNT_MAX}.`;
    else { value.gfx_count = Number(c); if (!value.gfx_kind && !errors.gfxKind) value.gfx_kind = 'make'; }
  }
  if (value.gfx_kind === 'fix') delete value.gfx_count; // a fix is judged by its notes, not counted
  return { ok: !Object.keys(errors).length, errors, value };
}

// ── Stage 3: Claude checks a fix task ─────
// When new graphics files appeared in the client's Drive graphics folders after a fix task was
// given (or reopened), the gfx-auto function sends Claude the task's notes and those images and
// asks, per note: fixed, not fixed, or cannot tell. Every note fixed: the task closes. A note not
// fixed: the assignee hears "עוד לא תוקן: …" (rule `gfxFix`) and the task stays open. Each file
// is checked once (public.gfx_ai_checks.files).
export const AI = {
  maxImages: 12,     // images in one check (the newest)
  maxImageBytes: 3.5 * 1024 * 1024, // as a contract picture (app/contract-read-logic.js READ_MAX_IMAGE)
  perRun: 3,         // checks in one hourly run
  perDay: 20,        // checks in one Israel day, all tasks together
  perTaskDay: 2,     // checks of one task in one Israel day
  maxNotes: 20,
};
export const AI_IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// The notes as the giver wrote them: the task's words, and a brief's fields (Nirel's) under them.
export function notesText(task) {
  const lines = [String(task?.body || '').trim()];
  const b = task?.brief && typeof task.brief === 'object' ? task.brief : {};
  for (const [k, l] of [['problem', 'הבעיה'], ['change', 'מה לשנות'], ['keep', 'מה נשאר'], ['result', 'התוצאה']]) {
    if (String(b[k] || '').trim()) lines.push(`${l}: ${String(b[k]).trim()}`);
  }
  return lines.filter(Boolean).join('\n');
}

export const AI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['note', 'verdict', 'why'],
        properties: {
          note: { type: 'string' },
          verdict: { type: 'string', enum: ['done', 'not_done', 'cant_tell'] },
          why: { type: 'string' },
        },
      },
    },
  },
};

export function aiSystemPrompt() {
  return [
    'אתה בודק עבודה של גרפיקאי במשרד שיווק בישראל.',
    'מקבלים משימת תיקון שנתנו לגרפיקאי (ההערות שנכתבו לו), ואת הגרפיקות שהעלה לתיקיית הגרפיקות של הלקוח אחרי שקיבל את המשימה.',
    'פרק את המשימה להערות נפרדות (כל דרישה בנפרד), ולכל הערה החלט על פי התמונות בלבד:',
    '- done: רואים בגרפיקות שההערה בוצעה.',
    '- not_done: רואים בגרפיקות שההערה לא בוצעה (למשל הטקסט הישן עדיין שם, הצבע לא השתנה).',
    '- cant_tell: אי אפשר לדעת מהתמונות (ההערה מפנה להודעות בווטסאפ או בקבוצה שלא ראית, היא על סרטונים או על פרסום ברשתות, או שאין גרפיקה שקשורה אליה).',
    'אל תנחש. כשיש ספק: cant_tell.',
    'note: ההערה במילים קצרות בעברית. why: סיבה קצרה בעברית, משפט אחד, עד 20 מילים.',
  ].join('\n');
}
export const aiUserText = (task, n) => `המשימה (ההערות):\n${notesText(task)}\n\nלמעלה ${n} הגרפיקות החדשות. החזר את ההחלטה לכל הערה.`;

// The request to the Messages API (client.beta.messages.create), as contract-ai's reading of a
// signed contract: the model the repo uses for pictures, structured outputs, server-side fallback.
export const AI_MODEL = 'claude-sonnet-5-5';
export function aiRequest(task, images) {
  return {
    model: AI_MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: AI_SCHEMA } },
    system: [{ type: 'text', text: aiSystemPrompt(), cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [
        ...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.base64 } })),
        { type: 'text', text: aiUserText(task, images.length) },
      ],
    }],
  };
}

// The answer, checked: [{ note, verdict, why }] (unknown verdicts become cant_tell, text trimmed).
export function aiVerdicts(raw) {
  const list = Array.isArray(raw?.notes) ? raw.notes : [];
  return list.slice(0, AI.maxNotes).map((x) => ({
    note: String(x?.note || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    verdict: ['done', 'not_done', 'cant_tell'].includes(x?.verdict) ? x.verdict : 'cant_tell',
    why: String(x?.why || '').replace(/\s+/g, ' ').trim().slice(0, 200),
  })).filter((x) => x.note);
}
// 'done' (every note done), 'missing' (one or more not done), 'unclear' (the rest).
export function aiOutcome(verdicts) {
  if (!verdicts.length) return 'unclear';
  if (verdicts.some((v) => v.verdict === 'not_done')) return 'missing';
  return verdicts.every((v) => v.verdict === 'done') ? 'done' : 'unclear';
}
export const aiCloseNote = (n) => `נסגר אוטומטית: ה־AI בדק ${n} גרפיקות מול ההערות`;
// "עוד לא תוקן: הצבעים של הלוגו; מספר הטלפון" (the notes not done, up to 200 characters).
export function missingText(verdicts) {
  const s = verdicts.filter((v) => v.verdict === 'not_done').map((v) => v.note).join('; ');
  const out = `עוד לא תוקן: ${s}`;
  return out.length > 200 ? `${out.slice(0, 199)}…` : out;
}
