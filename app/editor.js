// The editors' page (editor.html; docs/plan/system-plan.md §3 "העורכים" and
// "ניראל"): "הלקוחות שלי בעריכה" and nothing else. Per client and shoot round: day X
// of 3, both dates in words, the links, the number of videos, the logo and the
// business phone with the ready closing line, Eli's notes and the 12א highlights;
// and one button for the next step (app/production.js editorState):
//   ממתין לכונן → (1) קיבלתי את הכונן והתחלתי → (2) מוכן לבדיקה → (3) תיקונים מאופיר
//   (the office's returns, app/office-ui.js fixList) → (4) תיקונים הושלמו, הגרסאות
//   הסופיות בתיק הלקוח → אצל עילאי until he marks "קיבלתי" (p27.toilai).
// The finished videos are uploaded here, into the client's files (app/files-ui.js
// mountWorkFiles): (2) and (4) open only once a video of this round is there.
// The business phone and the logo come from the characterization form, the
// highlights from the focus call (app/intake-data.js, app/briefs.js).
// Nirel also gets her "בריפים" inbox here. Each editor sees their own on-time and
// first-pass numbers, never anyone else's.
import { PEOPLE } from './protocol.js';
import { clientState, WAIT, WAITED, waitNote, endWaitNote } from './protocol-logic.js';
import { dayFromKeyIL, endOfDayIL } from './tz.js';
import {
  loadChecks, setCheck, clearCheck, setChecksBulk, addTask, setTaskDone, setTaskStarted, loadAllLog, loadDirectory,
} from './protocol-data.js';
import { loadWorkClients, loadMyTasks, loadOpenTasksOf, finishTask, loadLogoFiles, signedDownload } from './production-data.js';
import { loadCharacterizations, loadBriefsOf } from './intake-data.js';
import { highlightsOf, briefBlock, SUMMARY } from './briefs.js';
import { fixList } from './office-ui.js';
import { QA_KINDS } from './office-marks.js';
import {
  $, fill, h, toast, errorText, mountSession, viewerOf, directory, formatStamp, formatWhen, briefDetails, taskBadge,
  isUrgentTask, hasBrief, VIEWER_UNKNOWN,
} from './protocol-ui.js';
import { mountPush } from './push.js';
import { offerHandoff } from './handoff-ui.js';
import { closedProcesses } from './health.js';
import * as P from './production.js';
import { mountWorkFiles, workFilesState, forgetFiles, readFiles } from './files-ui.js';
import { charViewHref } from './intake-ui.js';
import { videoWindow, uploadGate, uploadedText } from './files-logic.js';

let me = null;
let myEmail = '';
let clients = [];
let checks = {};
let tasks = [];
let chars = {};
let briefs = {};
let logos = {}; // the uploaded logo file of each client (client_files, kind 'logo')
let viewer = null;
let statsLog = null;
let lastLoad = 0;
const states = new Map();
const stateOf = (c) => {
  if (!states.has(c.id)) states.set(c.id, clientState(c, checks[c.id] || {}, new Date()));
  return states.get(c.id);
};
const cs = (c) => (checks[c.id] ||= {});
const busy = () => !!document.querySelector('dialog[open]');
const cardId = (job) => `c-${job.client.id}${job.round > 1 ? `-r${job.round}` : ''}`;
const jobName = (job) => `${job.client.name}${job.round > 1 ? ` · סבב ${job.round}` : ''}`;
const isNirel = () => me === 'nirel';

// ── Loading ─────────────────────────────────
async function load() {
  $('state').textContent = clients.length ? '' : 'טוען…';
  try {
    [clients, checks, tasks] = await Promise.all([loadWorkClients(), loadChecks(), loadMyTasks(me)]);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  states.clear();
  const ids = [...new Set(allJobs().map((j) => j.client.id))];
  for (const cid of ids) forgetFiles(cid);
  // The files too, before the cards are drawn: "מוכן לבדיקה" is locked or open at once.
  [chars, briefs, logos] = await Promise.all([loadCharacterizations(ids), loadBriefsOf(ids), loadLogoFiles(ids), ...ids.map(readFiles)]);
  lastLoad = Date.now();
  $('state').textContent = '';
  await tidyBlocks();
  render();
  goToHash();
  loadStats();
}

// Every editing job of mine (done ones too, for the numbers).
function allJobs() {
  return clients.flatMap((c) => P.editingCases(c, cs(c), me, stateOf(c)));
}
const openJobs = () => allJobs().map((j) => ({ ...j, st: P.editorState(j, cs(j.client)) })).filter((j) => j.st.key !== 'done')
  .sort((a, b) => (a.p24?.dueAt || Infinity) - (b.p24?.dueAt || Infinity));

// A block ended from the client card (its wait on 22 ended there): the waits it put
// on 24 and 27 end too, and the report is cleared.
async function tidyBlocks() {
  for (const j of allJobs()) {
    const c = cs(j.client);
    const m = c[`${j.pre}p22.missing`];
    if (!m || m.state !== 'done' || c[`${j.pre}p22.wait`]?.state === 'done') continue;
    try { await endBlock(j, { quiet: true }); } catch { /* shown as not blocked anyway */ }
  }
}

// ── Rendering ───────────────────────────────
function render() {
  const jobs = openJobs();
  const waiting = jobs.filter((j) => j.st.key === 'waiting').length;
  $('ed-summary').textContent = jobs.length
    ? `${jobs.length === 1 ? 'לקוח אחד בעריכה' : `${jobs.length} לקוחות בעריכה`}${waiting ? ` · ${waiting} ממתינים לכונן` : ''}`
    : '';
  fill($('ed-list'), jobs.length ? jobs.map(jobCard)
    : h('p', { class: 'empty' }, 'אין כרגע לקוח בעריכה אצלך. כשאופיר ישייך לקוח, הוא יופיע כאן ותקבל/י הודעה.'));
  renderBriefs();
  renderStats();
}
function renderKeepingFocus(focusId = document.activeElement?.id) {
  const y = window.scrollY;
  render();
  window.scrollTo({ top: y });
  // The next step's button may be locked until a video is up: the upload button then.
  const el = focusId ? document.getElementById(focusId) : null;
  (el?.disabled ? document.getElementById(focusId.replace(/-go$/, '-v-add')) || el : el)?.focus({ preventScroll: true });
}
function goToHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id.startsWith('c-')) return;
  // A link to the client (#c-<id>) finds its card, or its first shoot round's.
  const el = document.getElementById(id) || document.querySelector(`[id^="${CSS.escape(id)}-r"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'start' });
  el.querySelector('h2')?.focus({ preventScroll: true });
}

const link = (href, text, extra = {}) => (href ? h('a', { class: 'btn btn-sm btn-ghost', href, target: '_blank', rel: 'noopener noreferrer', ...extra }, text) : null);
async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { class: 'sr-only', readonly: true }, text);
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* nothing more to try */ }
    ta.remove();
  }
  toast(`${what} הועתק.`);
}

function datesLine(job, st) {
  const now = new Date();
  if (st.blocked) return h('p', { class: 'ed-dates is-blocked' }, h('strong', {}, 'חסום'), ` · חסר ${P.missingText(st.blocked.what) || 'חומר'} · דווח לעירית ${formatWhen(st.blocked.at, now)}. המועד לא רץ עד שזה מגיע.`);
  const ofir = job.p24?.dueAt;
  const close = job.p27?.dueAt;
  const parts = [];
  if (['waiting', 'editing', 'fixes'].includes(st.key) && ofir) parts.push(`אצל אופיר עד ${P.dueWords(ofir, now)}`);
  if (close && st.key !== 'ilai') parts.push(`סגירה עד ${P.dayWords(close, now)}`);
  return parts.length ? h('p', { class: 'ed-dates' }, parts.join(' · ')) : null;
}

function sheetBlock(job) {
  const s = P.sheetOf(job.client, chars[job.client.id], logos[job.client.id]);
  const id = cardId(job);
  return h('div', { class: 'ed-sheet' },
    // The uploaded logo file first (a signed link, made on the tap); the link from the
    // characterization form or the card is the fallback.
    s.logoFile ? h('button', { type: 'button', class: 'btn btn-sm', id: `${id}-logo`, onclick: (e) => downloadLogo(s.logoFile, e.currentTarget) }, 'לוגו להורדה')
      : s.logo ? h('a', { class: 'btn btn-sm', href: s.logo, target: '_blank', rel: 'noopener noreferrer', download: '' }, 'לוגו להורדה')
        : h('p', { class: 'ed-miss' }, 'אין לוגו בתיק הלקוח.'),
    s.phone ? h('div', { class: 'ed-phone' },
      h('span', { class: 'ed-k' }, 'טלפון העסק'), h('bdi', { class: 'num', dir: 'ltr' }, s.phone),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', id: `${id}-cp-phone`, 'aria-label': `העתקת טלפון העסק ${s.phone}`, onclick: () => copy(s.phone, 'הטלפון') }, 'העתקה'))
      : h('p', { class: 'ed-miss' }, 'אין טלפון עסק בכרטיס.'),
    s.closing ? h('div', { class: 'ed-closing' },
      h('span', { class: 'ed-k' }, 'נוסח הסגיר'), h('span', { class: 'ed-line' }, s.closing),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', id: `${id}-cp-closing`, onclick: () => copy(s.closing, 'נוסח הסגיר') }, 'העתקת הסגיר')) : null);
}

async function downloadLogo(file, btn) {
  btn.disabled = true;
  try {
    const { url, name } = await signedDownload(file.storage_path);
    const a = h('a', { href: url, download: name, rel: 'noopener' });
    document.body.append(a); a.click(); a.remove();
  } catch {
    toast('ההורדה של הלוגו לא התחילה. נסו שוב.');
  } finally { btn.disabled = false; }
}

// "מה חייבים להגיד ומה אסור" from Lior's focus call (12א, public.content_briefs of
// this shoot round; app/briefs.js), and the call's other answers below them.
function highlightsBlock(job) {
  const brief = briefs[job.client.id]?.[job.round] || null;
  const hl = highlightsOf(brief);
  const rest = briefBlock(brief, { heading: 'שאר הדגשים משיחת הדגשים', id: `${cardId(job)}-brief` });
  // Lior's "סיכום דגשים" (written in the focus call or the Zoom) is inside `rest`, first.
  const summary = String(brief?.fields?.[SUMMARY] ?? '').trim();
  const body = hl
    ? h('dl', { class: 'ed-hl' }, hl.must ? [h('dt', {}, 'חייבים להגיד'), h('dd', {}, hl.must)] : null, hl.dont ? [h('dt', {}, 'אסור להגיד'), h('dd', {}, hl.dont)] : null)
    : h('p', { class: 'muted' }, summary ? 'אין "חייבים" ו"אסור" משיחת הדגשים. סיכום הדגשים של ליאור למטה.' : 'עוד לא נרשמו דגשים משיחת הדגשים (12א). אם חסר, לשאול את ליאור.');
  return h('details', { class: 'ed-more', open: !!hl || !!summary }, h('summary', {}, 'מה חייבים להגיד ומה אסור'), body,
    rest ? h('details', { class: 'ed-more ed-brief', open: !!summary }, h('summary', {}, 'כל הדגשים מהשיחה'), rest) : null);
}
function eliNotes(job) {
  const text = P.noteOf(cs(job.client)[`${job.pre}p19b.notes`]);
  return text ? h('details', { class: 'ed-more', open: true }, h('summary', {}, 'הערות של אלי מיום הצילום'), h('p', { class: 'ed-note' }, text)) : null;
}

// ── The round's finished videos ─────────────
// Uploaded here, into the client's files (package 1; docs/ops.md, section 37). "מוכן
// לבדיקה" and the final hand-off open only once a video of this round is up; after
// the client's notes, one that went up since. A failed upload says what to do: try
// again, then "חסר…" (Irit at once, Lior after her), never a way around.
const VIDEO = 'deliverable_video';
const FAIL_HELP = 'אם זה חוזר: ״חסר לוגו / טלפון / חומר״, לסמן ״העלאה למערכת״. עירית מקבלת מיד, וליאור אחריה.';
const windowOf = (job) => videoWindow(job.client, cs(job.client), job.round);
function videosGate(job, st) {
  const state = workFilesState(job.client.id);
  return uploadGate({
    files: state.files, kind: VIDEO, window: windowOf(job), state,
    after: st.key === 'final' && st.notes ? st.notes.at : null,
    none: 'נפתח אחרי שמעלים כאן לפחות סרטון סופי אחד.',
  });
}
function videosBlock(job, st) {
  if (st.key === 'waiting') return null;
  return mountWorkFiles({
    client: job.client, kind: VIDEO, window: windowOf(job), me, myEmail, idp: `${cardId(job)}-v`, toast,
    title: 'הסרטונים הסופיים', total: P.videosPerDay(job.ctx) || null, failHelp: FAIL_HELP,
    onChange: () => { if (!busy()) renderKeepingFocus(); },
  });
}
const lockHint = (id, gate) => (gate.ok ? null : h('p', { class: 'hint fl-lock', id: `${id}-lock` }, gate.reason));

function stateBlock(job, st) {
  const id = cardId(job);
  const now = new Date();
  const missingBtn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', id: `${id}-missing`, onclick: () => openMissing(job) }, 'חסר לוגו / טלפון / חומר');
  const gate = ['editing', 'final'].includes(st.key) ? videosGate(job, st) : null;
  switch (st.key) {
    case 'waiting':
      return h('div', { class: 'ed-act' },
        h('button', { type: 'button', class: 'btn btn-primary', id: `${id}-go`, onclick: () => openStart(job) }, 'קיבלתי את הכונן והתחלתי'),
        st.blocked ? null : missingBtn);
    case 'editing':
      return h('div', { class: 'ed-act' },
        h('button', { type: 'button', class: 'btn btn-primary', id: `${id}-go`, disabled: !gate.ok, 'aria-describedby': gate.ok ? null : `${id}-lock`, onclick: () => openReady(job) }, 'מוכן לבדיקה'),
        st.blocked ? null : missingBtn,
        lockHint(id, gate));
    case 'qa':
      return h('p', { class: 'ed-wait' }, `${st.round > 1 ? 'התיקונים אצל אופיר לבדיקה חוזרת' : 'אצל אופיר'} מאז ${formatWhen(st.since, now)}. יעד הבקרה: שעת עבודה. תיקונים, אם יהיו, יופיעו כאן.`);
    case 'fixes': return qaFixes(job);
    case 'client': return h('p', { class: 'ed-wait' }, 'אופיר אישר. הסרטונים אצל הלקוח. הערות הלקוח יופיעו כאן.');
    case 'clientFixes': return clientFixesBlock(job, st);
    case 'final':
      return h('div', { class: 'ed-act' },
        h('button', { type: 'button', class: 'btn btn-primary', id: `${id}-go`, disabled: !gate.ok, 'aria-describedby': gate.ok ? null : `${id}-lock`, onclick: (e) => finish(job, st, e.currentTarget) }, 'תיקונים הושלמו, הגרסאות הסופיות בתיק הלקוח'),
        st.blocked ? null : missingBtn,
        lockHint(id, gate) || h('p', { class: 'hint' }, st.notes ? 'התיקונים של הלקוח עוברים ישר לעילאי.' : 'הלקוח אישר. הגרסאות עוברות לעילאי.'));
    case 'ilai': return h('p', { class: 'ed-wait' }, 'הגרסאות הסופיות אצל עילאי. המשימה נסגרת כשהוא מסמן ״קיבלתי״.');
    default: return null;
  }
}

// Ofir's return for fixes: the office's list (app/office-ui.js), the same one the
// client card shows, with "תוקן" per issue and "סמן הכול תוקן". The last one fixed
// sends the videos back to Ofir (p25.fixed.N; his clock starts again).
function qaFixes(job) {
  const c = job.client;
  return h('div', { class: 'ed-fixes' }, fixList({
    client: c, checks: cs(c), kind: 'videos', pre: job.pre, fixer: QA_KINDS.videos.fixer(job.ctx), me, viewer,
    onChange: () => {
      states.delete(c.id);
      renderKeepingFocus(`${cardId(job)}-h`);
      if (P.editorState(job, cs(c)).key === 'qa') offerHandoff({ client: c, key: `${job.pre}p24.notify`, checks: () => cs(c), me });
    },
  }));
}

// The client's notes, one line per video (Irit typed them, process 27).
function clientFixesBlock(job, st) {
  const id = cardId(job);
  const list = st.notes.videos;
  const text = st.notes.text;
  const fixed = st.fixed || new Set();
  const left = list.filter((v) => !fixed.has(v.n));
  const head = 'הערות הלקוח · מתקנים ומעבירים ישר לעילאי';
  return h('div', { class: 'ed-fixes' },
    h('p', { class: 'ed-fixes-h' }, head),
    text ? h('p', { class: 'ed-note' }, text) : null,
    list.length ? h('ul', { class: 'ed-fix-list' }, ...list.map((v) => {
      const done = fixed.has(v.n);
      return h('li', { class: done ? 'is-done' : '' },
        h('span', { class: 'ed-fix-n num' }, `סרטון ${v.n}`),
        h('span', { class: 'ed-fix-t' }, v.text || ''),
        done ? h('span', { class: 'tag' }, 'תוקן')
          : h('button', { type: 'button', class: 'btn btn-sm', id: `${id}-fix-${v.n}`, 'aria-label': `סרטון ${v.n} תוקן`, onclick: (e) => markFixed(job, st, [v.n], e.currentTarget) }, 'תוקן'));
    })) : null,
    h('div', { class: 'ed-act' },
      h('button', { type: 'button', class: 'btn btn-primary', id: `${id}-go`, onclick: (e) => markFixed(job, st, list.map((v) => v.n), e.currentTarget) },
        list.length && left.length < list.length ? `סמן את השאר תוקן (${left.length})` : 'סמן הכול תוקן'),
      h('span', { class: 'hint' }, 'כשהכול תוקן: ״תיקונים הושלמו״.')));
}

function pauseBlock(job, st) {
  const id = cardId(job);
  if (st.paused) {
    const p = st.paused;
    return h('div', { class: 'ed-pause', role: 'note' },
      h('p', {}, h('strong', {}, P.pauseText(p)), ` · ${formatStamp(p.at)}${p.stage ? ` · שלב: ${p.stage}` : ''}${p.left ? ` · נשאר: ${p.left}` : ''}`),
      h('button', { type: 'button', class: 'btn btn-sm', id: `${id}-resume`, onclick: (e) => resume(job, e.currentTarget) }, 'חזרה לעריכה'));
  }
  if (!['editing', 'fixes', 'clientFixes', 'final'].includes(st.key)) return null;
  return h('button', { type: 'button', class: 'btn-text ed-pause-btn', id: `${id}-pause`, onclick: () => openPause(job) }, 'עצירת העריכה למשימה אחרת');
}

function jobCard(job) {
  const { st } = job;
  const id = cardId(job);
  const now = new Date();
  const c = job.client;
  const day = P.editingDay(job.assignedAt, now);
  const videos = P.videosPerDay(job.ctx);
  const links = c.links || {};
  const dropbox = P.needsDropbox(c);
  return h('article', { class: `ed-card s-${st.key}${st.blocked ? ' is-blocked' : ''}${st.paused ? ' is-paused' : ''}`, id, 'aria-labelledby': `${id}-h` },
    h('header', { class: 'ed-head' },
      h('h2', { id: `${id}-h`, tabindex: '-1' }, jobName(job), c.business && c.business !== c.name ? h('small', {}, c.business) : null),
      h('span', { class: `ed-state s-${st.key}` }, st.blocked ? 'חסום' : st.paused ? P.pauseText(st.paused) : P.STATE_TEXT[st.key])),
    h('p', { class: 'ed-day' }, c.landing === true ? 'בקליטה · הימים עוד לא נספרים' : P.editingDayText(day, now, job.assignedAt)),
    datesLine(job, st),
    // The one next step comes first; what the work needs follows.
    st.blocked ? h('div', { class: 'ed-blocked', role: 'note' },
      h('p', {}, `עירית קיבלה הודעה ${formatWhen(st.blocked.at, now)}.${st.blocked.note ? ` ״${st.blocked.note}״` : ''}`),
      h('button', { type: 'button', class: 'btn btn-sm', id: `${id}-unblock`, onclick: (e) => endBlock(job, { btn: e.currentTarget }) }, 'הגיע, ממשיכים')) : null,
    st.paused ? null : stateBlock(job, st),
    videosBlock(job, st),
    pauseBlock(job, st),
    h('p', { class: 'ed-facts' },
      videos ? h('span', {}, `${videos} סרטונים לפי החבילה`) : h('span', { class: 'muted' }, 'כמות הסרטונים לא הוזנה'),
      dropbox ? h('span', { class: 'tag tag-warn' }, 'צריך גם Dropbox') : null),
    // The finished videos go up above; an old Drive link in the card is only the archive.
    h('div', { class: 'ed-links' },
      link(links.scripts, 'תסריטים'), dropbox ? link(links.dropbox, 'Dropbox') : null, link(links.drive, 'ארכיון ב־Drive'),
      !links.scripts ? h('span', { class: 'muted' }, 'אין עדיין קישור לתסריטים בכרטיס.') : null),
    sheetBlock(job),
    eliNotes(job),
    highlightsBlock(job));
}

// ── (1) The drive arrived ───────────────────
const dialogs = {};
function dialog(id) {
  const d = $(id);
  d.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === d) d.close(); });
  dialogs[id] = d;
  return d;
}
const showErr = (id, msg) => { $(id).textContent = msg; $(id).hidden = !msg; };
const checkRow = (id, label, checked = false) => h('label', { class: 'prod-check', for: id },
  h('input', { type: 'checkbox', id, class: 'cbx', checked }), h('span', {}, label));

const startDlg = dialog('dlg-start');
let target = null;
function openStart(job) {
  target = job;
  $('start-ctx').textContent = jobName(job);
  const c = cs(job.client);
  fill($('start-list'), ...P.START_CHECKS.map(([k, l], i) => checkRow(`start-${i}`, l, c[job.pre + k]?.state === 'done')));
  // The logo check stands on what the card shows: say so when there is none to tick against.
  if (!P.sheetOf(job.client, chars[job.client.id], logos[job.client.id]).hasLogo) {
    $('start-list').append(h('p', { class: 'hint', id: 'start-nologo' }, 'אין לוגו בתיק הלקוח. אם הוא לא אצלך: ״חסר לוגו / טלפון / חומר״.'));
  }
  showErr('start-err', '');
  startDlg.showModal();
  $('start-0').focus();
}
const ticked = (prefix, list) => list.filter((_, i) => $(`${prefix}-${i}`).checked).map(([k]) => k);
$('start-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const job = target;
  const ok = ticked('start', P.START_CHECKS);
  if (ok.length < P.START_CHECKS.length) {
    showErr('start-err', 'סמנו את ארבע הבדיקות. אם משהו חסר: ״חסר לוגו / טלפון / חומר״.');
    return;
  }
  $('start-submit').disabled = true;
  try {
    await markMany(job, ['p22.received', ...ok]);
    startDlg.close();
    toast(`התחלת: ${jobName(job)}. בהצלחה!`);
    renderKeepingFocus(`${cardId(job)}-go`);
  } catch (err) {
    showErr('start-err', `הסימון לא נשמר. ${errorText(err)}`);
  } finally {
    $('start-submit').disabled = false;
  }
});
$('start-missing').addEventListener('click', () => {
  const job = target;
  const missing = P.START_CHECKS.filter((_, i) => !$(`start-${i}`).checked).map(([k]) => k);
  const what = [...new Set(missing.map((k) => (k.endsWith('logo') ? 'logo' : k.endsWith('phone') ? 'phone' : 'footage')))];
  const received = ticked('start', P.START_CHECKS);
  startDlg.close();
  openMissing(job, { what, received });
});

// Marks keys of a job (only those not done yet: a done check keeps its time).
async function markMany(job, keys, note = null) {
  const c = cs(job.client);
  const list = keys.map((k) => job.pre + k).filter((k) => c[k]?.state !== 'done');
  if (!list.length) return;
  const rows = await setChecksBulk(job.client.id, list, 'done', note);
  for (const r of rows) c[r.item_key] = r;
  states.delete(job.client.id);
}
async function markOne(job, key, note = null) {
  const row = await setCheck(job.client.id, job.pre + key, 'done', note);
  cs(job.client)[row.item_key] = row;
  states.delete(job.client.id);
  return row;
}
async function unmark(job, key) {
  await clearCheck(job.client.id, job.pre + key);
  delete cs(job.client)[job.pre + key];
  states.delete(job.client.id);
}

// ── Missing logo / phone / footage ──────────
const missDlg = dialog('dlg-missing');
let missCtx = null;
function openMissing(job, { what = [], received = null } = {}) {
  missCtx = { job, received };
  $('miss-ctx').textContent = jobName(job);
  fill($('miss-list'), ...P.MISSING_WHAT.map(([k, l]) => checkRow(`miss-${k}`, l, what.includes(k))));
  $('miss-note').value = '';
  showErr('miss-err', '');
  missDlg.showModal();
  (document.querySelector('#miss-list .cbx:checked') || $('miss-logo')).focus();
}
$('miss-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { job, received } = missCtx;
  const what = P.MISSING_WHAT.map(([k]) => k).filter((k) => $(`miss-${k}`).checked);
  if (!what.length) { showErr('miss-err', 'סמנו מה חסר.'); $('miss-logo').focus(); return; }
  $('miss-submit').disabled = true;
  try {
    // From the start dialog: the drive did arrive, with whatever was there.
    if (received) await markMany(job, ['p22.received', ...received]);
    // The deadline is "חסום": the editor's processes wait while it is missing (their
    // clocks stop, decision 3), then the report that rings Irit.
    const st = stateOf(job.client);
    for (const b of P.BLOCKS) {
      const s = st.states.find((x) => x.proc.id === (job.pre ? `r${job.round}-${b}` : b));
      if (!s || s.complete || s.wait) continue;
      const row = await setCheck(job.client.id, WAIT(s.proc), 'done', waitNote(P.blockedReason(what), null));
      cs(job.client)[row.item_key] = row;
    }
    await markOne(job, 'p22.missing', P.missingNote(what, $('miss-note').value));
    missDlg.close();
    toast(`עירית קיבלה הודעה: חסר ${P.missingText(what)}. המועד שלך מסומן ״חסום״.`);
    renderKeepingFocus(`${cardId(job)}-unblock`);
  } catch (err) {
    showErr('miss-err', `הדיווח לא נשמר. ${errorText(err)}`);
  } finally {
    $('miss-submit').disabled = false;
  }
});

// The missing thing arrived: the waits end (their time moves the deadlines on) and
// what was missing is checked.
async function endBlock(job, { btn = null, quiet = false } = {}) {
  if (btn) btn.disabled = true;
  const c = cs(job.client);
  const report = P.missingOf(c, job.pre) || (() => { try { return JSON.parse(c[`${job.pre}p22.missing`]?.note || '{}'); } catch { return {}; } })();
  try {
    for (const b of P.BLOCKS) {
      const s = stateOf(job.client).states.find((x) => x.proc.id === (job.pre ? `r${job.round}-${b}` : b));
      if (!s?.wait || !String(s.wait.reason || '').startsWith('חסר לעורך')) continue;
      const w = await setCheck(job.client.id, WAITED(s.proc), 'done', endWaitNote(job.client, s.proc, c));
      c[w.item_key] = w;
      await clearCheck(job.client.id, WAIT(s.proc));
      delete c[WAIT(s.proc)];
      states.delete(job.client.id);
    }
    await unmark(job, 'p22.missing');
    if (c[`${job.pre}p22.received`]?.state === 'done') {
      const keys = (report.what || []).map((k) => ({ logo: 'p22.check.logo', phone: 'p22.check.phone', footage: 'p22.check.footage' }[k])).filter(Boolean);
      if (keys.length) await markMany(job, keys);
    }
  } catch (err) {
    if (btn) btn.disabled = false;
    if (!quiet) toast(`לא נשמר. ${errorText(err)}`);
    throw err;
  }
  if (!quiet) {
    toast('ממשיכים. המועד הוארך בזמן שהעריכה הייתה חסומה.');
    renderKeepingFocus(`${cardId(job)}-go`);
  }
}

// ── (2) Ready for QA ────────────────────────
const readyDlg = dialog('dlg-ready');
let readyList = [];
function openReady(job) {
  const gate = videosGate(job, job.st || P.editorState(job, cs(job.client)));
  if (!gate.ok) { toast(gate.reason); return; }
  target = job;
  readyList = P.selfCheck(P.needsDropbox(job.client));
  $('ready-ctx').textContent = `${jobName(job)} · ${uploadedText(gate.count, P.videosPerDay(job.ctx) || null)} סרטונים`;
  fill($('ready-list'), ...readyList.map(([, l], i) => checkRow(`ready-${i}`, l)));
  showErr('ready-err', '');
  readyDlg.showModal();
  $('ready-0').focus();
}
$('ready-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const job = target;
  const open = readyList.filter((_, i) => !$(`ready-${i}`).checked);
  if (open.length) {
    showErr('ready-err', `עוד לא סומן: ${open.map(([, l]) => `״${l}״`).join(', ')}.`);
    $(`ready-${readyList.indexOf(open[0])}`).focus();
    return;
  }
  $('ready-submit').disabled = true;
  try {
    // The four checks of the start are true by now; the notice to Ofir goes last.
    await markMany(job, [...P.START_CHECKS.map(([k]) => k), ...P.readyKeys(P.needsDropbox(job.client)).filter((k) => k !== 'p24.notify')]);
    await markOne(job, 'p24.notify', 'מוכן לבדיקה');
    readyDlg.close();
    toast(`נשלח לאופיר: ${jobName(job)}. הבקרה שלו עד שעת עבודה.`);
    renderKeepingFocus(`${cardId(job)}-h`);
    offerHandoff({ client: job.client, key: `${job.pre}p24.notify`, checks: () => cs(job.client), me });
  } catch (err) {
    showErr('ready-err', `הסימון לא נשמר. ${errorText(err)}`);
  } finally {
    $('ready-submit').disabled = false;
  }
});

// ── (3) The client's fixes ──────────────────
// (Ofir's fixes are the office's list: qaFixes above.)
async function markFixed(job, st, videos, btn) {
  btn.disabled = true;
  try {
    const list = st.notes.videos;
    const fixed = new Set([...st.fixed, ...videos]);
    await markOne(job, 'p27.fixed', P.clientFixedNote([...fixed]));
    if (!list.length || list.every((v) => fixed.has(v.n))) {
      await markOne(job, 'p27.fixes', 'בעמוד העריכה');
      toast('כל תיקוני הלקוח סומנו. עכשיו: ״תיקונים הושלמו, הגרסאות הסופיות בתיק הלקוח״.');
      renderKeepingFocus(`${cardId(job)}-go`);
      return;
    }
    toast(`סומן: ${videos.map((n) => `סרטון ${n}`).join(', ')} תוקן.`);
    renderKeepingFocus(`${cardId(job)}-go`);
  } catch (err) {
    btn.disabled = false;
    toast(`הסימון לא נשמר. ${errorText(err)}`);
  }
}

// ── (4) Final versions to Ilai ──────────────
// The editor marks the final versions as uploaded (p27.final); Ilai gets them
// (app/reminder-rules.js finalReady) and his "קיבלתי" (p27.toilai) closes the job.
async function finish(job, st, btn) {
  if (!P.canFinish(st)) return;
  const gate = videosGate(job, st);
  if (!gate.ok) { toast(gate.reason); return; }
  btn.disabled = true;
  try {
    await markMany(job, [...(st.notes ? ['p27.fixes'] : []), 'p27.final'], 'בעמוד העריכה');
    toast(`הגרסאות הסופיות עברו לעילאי: ${jobName(job)}. נסגר כשהוא מסמן ״קיבלתי״.`);
    renderKeepingFocus(`${cardId(job)}-h`);
    offerHandoff({ client: job.client, key: `${job.pre}p27.final`, checks: () => cs(job.client), me });
  } catch (err) {
    btn.disabled = false;
    toast(`הסימון לא נשמר. ${errorText(err)}`);
  }
}

// ── Pause and resume ────────────────────────
const pauseDlg = dialog('dlg-pause');
function openPause(job) {
  target = job;
  const pre = P.pausePrefill(job, job.st);
  $('pause-ctx').textContent = jobName(job);
  $('pause-stage').value = pre.stage;
  $('pause-left').value = pre.left;
  $('pause-why').value = '';
  showErr('pause-err', '');
  pauseDlg.showModal();
  $('pause-stage').focus();
}
async function pause(job, v) {
  const title = `${PEOPLE[me]?.name || 'העורך'} עצר/ה את העריכה של ${jobName(job)}: שלב ${v.stage}, נשאר ${v.left}${v.why ? `, בגלל ${v.why}` : ''}${v.for ? ` (לבקשת ${PEOPLE[v.for]?.name || v.for})` : ''}`.slice(0, 500);
  await markOne(job, 'p22.pause', P.pauseNote(v));
  const failed = [];
  for (const owner of ['lior', 'ofir']) {
    try { await addTask({ client_id: job.client.id, title, owner, source: 'pause' }); } catch { failed.push(PEOPLE[owner].name); }
  }
  return failed;
}
$('pause-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const job = target;
  const v = { stage: $('pause-stage').value.trim(), left: $('pause-left').value.trim(), why: $('pause-why').value.trim() };
  if (!v.stage || !v.left) { showErr('pause-err', 'כתבו באיזה שלב העריכה ומה נשאר, כדי שליאור ואופיר יוכלו להיערך.'); (v.stage ? $('pause-left') : $('pause-stage')).focus(); return; }
  $('pause-submit').disabled = true;
  try {
    const failed = await pause(job, v);
    pauseDlg.close();
    toast(failed.length ? `העריכה נעצרה, אבל העדכון ל${failed.join(' ול')} לא נשמר. עדכנו אותם ישירות.` : 'העריכה נעצרה. ליאור ואופיר עודכנו.');
    renderKeepingFocus(`${cardId(job)}-resume`);
  } catch (err) {
    showErr('pause-err', `לא נשמר. ${errorText(err)}`);
  } finally {
    $('pause-submit').disabled = false;
  }
});
// Back to editing: the pause ends and the notices it opened for Lior and Ofir close by themselves.
async function resume(job, btn) {
  btn.disabled = true;
  const since = new Date(job.st.paused.at).getTime() - 60e3;
  try {
    await unmark(job, 'p22.pause');
    const open = await loadOpenTasksOf([job.client.id]).catch(() => []);
    for (const t of open.filter((x) => x.source === 'pause' && new Date(x.created_at).getTime() >= since)) {
      await setTaskDone(t.id, true).catch(() => {});
    }
  } catch (err) {
    btn.disabled = false;
    toast(`לא נשמר. ${errorText(err)}`);
    return;
  }
  toast('חזרת לעריכה. עדכוני העצירה נסגרו.');
  renderKeepingFocus(`${cardId(job)}-go`);
}

// ── Briefs (Nirel) and tasks ────────────────
function renderBriefs() {
  const sec = $('ed-briefs');
  const list = tasks.filter((t) => !t.done_at);
  sec.hidden = !list.length && !isNirel();
  if (sec.hidden) { fill(sec); return; }
  const title = isNirel() ? 'בריפים' : 'משימות';
  const byClient = new Map(clients.map((c) => [c.id, c]));
  fill(sec,
    h('h2', { class: 'prod-h', id: 'briefs-h' }, title, h('span', { class: 'n' }, String(list.length))),
    list.length ? h('ul', { class: 'prod-tasks' }, ...list.sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent)).map((t) => {
      const c = byClient.get(t.client_id);
      const from = directory[String(t.created_by_email || '').toLowerCase()];
      return h('li', { class: `prod-task${isUrgentTask(t) ? ' is-urgent' : ''}`, id: `t-${t.id}` },
        h('div', { class: 'prod-task-h' },
          h('strong', {}, c?.name || 'לקוח'), taskBadge(t),
          t.due_on && dayFromKeyIL(t.due_on) ? h('span', { class: 'num muted' }, `עד ${formatWhen(endOfDayIL(dayFromKeyIL(t.due_on)))}`) : null),
        h('p', { class: 'prod-task-t' }, t.title),
        from ? h('p', { class: 'muted' }, `ביקש/ה: ${PEOPLE[from]?.name || from}`) : null,
        briefDetails(t, isNirel()),
        h('div', { class: 'ed-act' },
          // What the work is made from: the client's characterization, read-only.
          isNirel() && c ? h('a', { class: 'btn btn-sm btn-ghost', id: `t-${t.id}-char`, href: charViewHref(c.id) }, 'האפיון של הלקוח') : null,
          isUrgentTask(t) && 'started_at' in t && !t.started_at
            ? h('button', { type: 'button', class: 'btn btn-primary', id: `t-${t.id}-start`, onclick: (e) => startUrgent(t, e.currentTarget) }, 'התחלתי') : null,
          isUrgentTask(t) && t.started_at ? h('span', { class: 'hint' }, `התחלת ${formatStamp(t.started_at)}`) : null,
          h('button', { type: 'button', class: 'btn', id: `t-${t.id}-done`, onclick: () => openDone(t) }, 'סיום המשימה')));
    })) : h('p', { class: 'empty' }, 'אין בריפים פתוחים.'));
}

// An urgent task taken while editing: "לעצור את העריכה של X?", prefilled.
const urgDlg = dialog('dlg-urgent');
let urgCtx = null;
const editingNow = () => openJobs().filter((j) => ['editing', 'fixes', 'clientFixes', 'final'].includes(j.st.key) && !j.st.paused);
function startUrgent(t, btn) {
  const jobs = editingNow();
  if (!jobs.length) { doStart(t, btn); return; }
  urgCtx = { t, jobs, btn };
  const asker = directory[String(t.created_by_email || '').toLowerCase()];
  $('urg-ctx').textContent = `״${t.title}״${asker && PEOPLE[asker] ? `, לבקשת ${PEOPLE[asker].name}` : ''}. ${jobs.length === 1 ? `לעצור את העריכה של ${jobName(jobs[0])}?` : 'לעצור את העריכה?'}`;
  fill($('urg-jobs'), ...jobs.map((j, i) => {
    const pre = P.pausePrefill(j, j.st);
    return h('fieldset', { class: 'prod-urg' },
      h('legend', {}, jobs.length > 1 ? checkRow(`urg-${i}`, `לעצור את ${jobName(j)}`, true) : jobName(j)),
      h('div', { class: 'field' }, h('label', { for: `urg-${i}-stage` }, 'שלב'), h('input', { class: 'input', id: `urg-${i}-stage`, value: pre.stage, maxlength: 200 })),
      h('div', { class: 'field' }, h('label', { for: `urg-${i}-left` }, 'מה נשאר'), h('input', { class: 'input', id: `urg-${i}-left`, value: pre.left, maxlength: 200 })));
  }));
  showErr('urg-err', '');
  urgDlg.showModal();
  $('urg-submit').focus();
}
async function doStart(t, btn) {
  if (btn) btn.disabled = true;
  try {
    Object.assign(t, await setTaskStarted(t.id, true));
  } catch (err) {
    if (btn) btn.disabled = false;
    toast(`הסימון לא נשמר. ${errorText(err)}`);
    return false;
  }
  toast(`נרשם שהתחלת: ${t.title}`);
  renderKeepingFocus(`t-${t.id}-done`);
  return true;
}
$('urg-nopause').addEventListener('click', async () => { urgDlg.close(); await doStart(urgCtx.t, urgCtx.btn); });
$('urg-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { t, jobs, btn } = urgCtx;
  const asker = directory[String(t.created_by_email || '').toLowerCase()] || null;
  const chosen = jobs.map((j, i) => ({ j, i })).filter(({ i }) => jobs.length === 1 || $(`urg-${i}`).checked);
  for (const { i } of chosen) {
    if (!$(`urg-${i}-stage`).value.trim() || !$(`urg-${i}-left`).value.trim()) { showErr('urg-err', 'כתבו שלב ומה נשאר.'); $(`urg-${i}-stage`).focus(); return; }
  }
  $('urg-submit').disabled = true;
  try {
    for (const { j, i } of chosen) {
      await pause(j, { stage: $(`urg-${i}-stage`).value, left: $(`urg-${i}-left`).value, why: t.title, for: asker && PEOPLE[asker] ? asker : null, task: t.id });
    }
    urgDlg.close();
    await doStart(t, btn);
    if (chosen.length) toast(`העריכה נעצרה${asker && PEOPLE[asker] ? ` לבקשת ${PEOPLE[asker].name}` : ''}, ונרשם שהתחלת את המשימה.`);
  } catch (err) {
    showErr('urg-err', `לא נשמר. ${errorText(err)}`);
  } finally {
    $('urg-submit').disabled = false;
  }
});

// Finishing a task: with a brief (always for Nirel), what was done, what is left and a link to the result.
const doneDlg = dialog('dlg-done');
function openDone(t) {
  if (!hasBrief(t) && !isNirel()) { plainDone(t); return; }
  target = t;
  $('done-ctx').textContent = t.title;
  for (const k of ['done', 'left', 'drive']) { $(`done-${k}`).value = ''; $(`done-${k}`).removeAttribute('aria-invalid'); }
  for (const k of ['done-done-err', 'done-drive-err', 'done-err']) showErr(k, '');
  $('done-client').checked = isNirel();
  doneDlg.showModal();
  $('done-done').focus();
}
async function plainDone(t) {
  try {
    await setTaskDone(t.id, true);
    tasks = tasks.filter((x) => x.id !== t.id);
    render();
    toast(`בוצע: ${t.title}`);
  } catch (err) { toast(`לא נשמר. ${errorText(err)}`); }
}
$('done-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = target;
  const v = { done: $('done-done').value, left: $('done-left').value, drive: $('done-drive').value, client: $('done-client').checked };
  const errs = P.briefResultErrors(v);
  for (const k of ['done', 'drive']) {
    showErr(`done-${k}-err`, errs[k] || '');
    $(`done-${k}`).setAttribute('aria-invalid', String(!!errs[k]));
  }
  if (Object.keys(errs).length) { $(`done-${Object.keys(errs)[0]}`).focus(); return; }
  $('done-submit').disabled = true;
  const result = P.briefResult(v);
  try {
    await finishTask(t.id, result);
  } catch (err) {
    showErr('done-err', `לא נשמר. ${errorText(err)}`);
    $('done-submit').disabled = false;
    return;
  }
  const asker = directory[String(t.created_by_email || '').toLowerCase()] || null;
  const failed = [];
  for (const f of P.briefFollowups(t, result, asker)) {
    try { await addTask(f); } catch { failed.push(PEOPLE[f.owner]?.name || f.owner); }
  }
  $('done-submit').disabled = false;
  doneDlg.close();
  tasks = tasks.filter((x) => x.id !== t.id);
  render();
  const who = asker && PEOPLE[asker] ? PEOPLE[asker].name : 'מי שביקש';
  toast(failed.length ? `המשימה נסגרה, אבל ${failed.join(', ')} לא עודכנ/ו. עדכנו ישירות.`
    : `המשימה נסגרה. ${result.left ? 'ההודעה ומשימת ההמשך עוברות' : 'ההודעה עוברת'} ל${who}${result.client ? '; אופיר בודק ועירית שולחת' : ''}.`);
  $('ed-briefs').querySelector('button')?.focus();
});

// ── My numbers ──────────────────────────────
async function loadStats() {
  const since = new Date(Date.now() - 56 * 864e5);
  try { statsLog = await loadAllLog(since.toISOString()); } catch { statsLog = null; }
  renderStats();
}
function renderStats() {
  const sec = $('ed-stats');
  const now = new Date();
  const mine = clients.filter((c) => allJobs().some((j) => j.client.id === c.id));
  if (!mine.length) { sec.hidden = true; return; }
  const since = new Date(now.getTime() - 56 * 864e5);
  const rows = closedProcesses(mine, { stateOf, checksByClient: checks, since, now, log: statsLog });
  const onTime = P.onTimeOf(rows, me);
  const jobs = allJobs().map((j) => ({
    videos: P.videosPerDay(j.ctx),
    approved: cs(j.client)[`${j.pre}p25.approved`]?.state === 'done',
    firstReturn: P.firstReturnOf(cs(j.client), j.pre),
  }));
  const fp = P.firstPassOf(jobs);
  sec.hidden = false;
  fill(sec,
    h('h2', { class: 'prod-h', id: 'stats-h' }, 'הנתונים שלי'),
    h('div', { class: 'prod-kpis' },
      h('div', { class: 'prod-kpi' }, h('span', { class: 'prod-kpi-v num' }, P.percent(onTime.rate)), h('span', { class: 'prod-kpi-k' }, 'עמידה בזמנים'),
        h('span', { class: 'hint' }, onTime.done ? `${onTime.onTime} מתוך ${onTime.done} שלבים, 8 שבועות` : 'עוד אין שלבים שהושלמו')),
      h('div', { class: 'prod-kpi' }, h('span', { class: 'prod-kpi-v num' }, P.percent(fp.rate)), h('span', { class: 'prod-kpi-k' }, 'עברו בקרה בפעם הראשונה'),
        h('span', { class: 'hint' }, fp.videos ? `${fp.first} מתוך ${fp.videos} סרטונים` : 'עוד אין סרטונים שנבדקו'))),
    h('p', { class: 'hint' }, 'רק שלך. עצירה לבקשת מישהו אחר וזמן המתנה ללקוח לא נספרים נגדך.'));
}

// ── Start ───────────────────────────────────
$('btn-refresh').addEventListener('click', () => load());
window.addEventListener('hashchange', goToHash);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden && !busy()) load(); });
setInterval(() => {
  if ($('app').hidden || document.hidden || busy()) return;
  if (Date.now() - lastLoad > 5 * 60e3) { load(); return; }
  states.clear();
  renderKeepingFocus();
}, 60e3);

mountSession(async (staff) => {
  let dir;
  [dir, viewer] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  me = viewer.me;
  myEmail = String(staff.email || '').toLowerCase();
  if (!me || !PEOPLE[me]?.editor) {
    fill($('ed-list'));
    $('no-access').hidden = false;
    $('ed-summary').textContent = viewer.error ? VIEWER_UNKNOWN : '';
    for (const id of ['btn-refresh']) $(id).hidden = true;
    return;
  }
  $('ed-h1').textContent = isNirel() ? 'העריכה והבריפים שלי' : 'הלקוחות שלי בעריכה';
  $('ed-sub').textContent = isNirel()
    ? 'הלקוחות של נטלי שבעריכה אצלך, ומתחת הבריפים מכל לקוח.'
    : 'לכל לקוח: באיזה יום את/ה, עד מתי, וכפתור אחד לשלב הבא.';
  mountPush({ who: me, card: $('push-card'), button: $('btn-inbox'), dialog: $('dlg-inbox'), changed: () => {} });
  await load();
});
