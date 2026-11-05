// The editors' page (editor.html; docs/plan/system-plan.md §3 "העורכים" and
// "ניראל"): "הלקוחות שלי בעריכה" and nothing else. Per client and shoot round: day X
// of 3, both dates in words, the links, the number of videos, the logo and the
// business phone with the ready closing line, Eli's notes and the 12א highlights;
// and one button for the next step (app/production.js editorState):
//   ממתין לכונן → (1) קיבלתי את הכונן והתחלתי → (2) מוכן לבדיקה → (3) תיקונים מאופיר
//   (the office's returns, app/office-ui.js fixList) → (4) תיקונים הושלמו, הגרסאות
//   הסופיות בדרייב → אצל עילאי until he marks "קיבלתי" (p27.toilai).
// The finished videos stay in the client's Google Drive (the owner's decision of
// 7.10.2026): (2) asks for the folder's link and (4) stands on it. Uploading them
// here too (app/files-ui.js mountWorkFiles) is optional, and stands in for the link.
// The business phone and the logo come from the characterization form, the
// highlights from the focus call (app/intake-data.js, app/briefs.js).
// Nirel also gets her "בריפים" inbox here. Each editor sees their own on-time and
// first-pass numbers, never anyone else's.
import { PEOPLE, CRITICAL_TITLE, editorsOf, editorNames, shareOf } from './protocol.js';
import { editingDaysOf } from './protocol-versions.js';
import { clientState, WAIT, WAITED, waitNote, endWaitNote } from './protocol-logic.js';
import { dayFromKeyIL, endOfDayIL } from './tz.js';
import {
  loadChecks, setCheck, clearCheck, setChecksBulk, addTask, setTaskDone, setTaskStarted, loadAllLog, loadDirectory,
} from './protocol-data.js';
import {
  loadWorkClients, loadMyTasks, loadOpenTasksOf, finishTask, loadLogoFiles, signedDownload, loadWorkScripts, scriptsWords, loadEditorProgress, saveEditorProgress,
  loadEditorMonths, saveEditorMonth,
} from './production-data.js';
import { loadCharacterizations, loadBriefsOf } from './intake-data.js';
import { highlightsOf, briefBlock, SUMMARY } from './briefs.js';
import { fixList } from './office-ui.js';
import { QA_KINDS } from './office-marks.js';
import {
  $, fill, h, toast, errorText, mountSession, viewerOf, directory, formatStamp, formatWhen, briefDetails, taskBadge,
  isUrgentTask, hasBrief, VIEWER_UNKNOWN,
} from './protocol-ui.js';
import { emptyState, noteIcon, dress, headIcon, facts, pill } from './kit.js';
import { mountPush } from './push.js';
import { offerHandoff } from './handoff-ui.js';
import { closedProcesses } from './health.js';
import * as P from './production.js';
import { todoText } from './office-marks.js';
import {
  progressMap, editTarget, editedValue, isMonthly, monthlyFor, monthKey, monthMap, monthVideosText, monthLabel, jobCount,
} from './edit-count.js';
import { splitJobs, byAssigned, sinceOf, readSort, saveSort } from './editor-order.js';
import { mountWorkFiles, workFilesState, forgetFiles, readFiles } from './files-ui.js';
import { charViewHref } from './intake-ui.js';
// The old system's characterization of each of my clients (the owner, 26.10.2026: every member of staff reads it).
import { loadLegacyChars } from './legacy-char-data.js';
import { legacyCharView, legacyCharSum } from './legacy-char-logic.js';
import { legacyCharBlock } from './legacy-char-ui.js';
import { loadIntake } from './landing-data.js';
import { withLandingEditors } from './landing-logic.js';
import { videoWindow, videosGate as gateOf, videosLinkOf, driveLinkProblem } from './files-logic.js';

let me = null;
let myEmail = '';
let clients = [];
let checks = {};
let tasks = [];
let chars = {};
let briefs = {};
let logos = {}; // the uploaded logo file of each client (client_files, kind 'logo')
let legacyChars = {}; // the old system's characterization of each client (client id → row; none: no block)
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
// The scripts Lior wrote for the shoots I edit (read only; 21.10.2026).
let scripts = [];
const scriptsOf = (job) => scripts.filter((s) => s.client_id === job.client.id && s.round === (job.round || 1));
const cardId = (job) => `c-${job.client.id}${job.round > 1 ? `-r${job.round}` : ''}`;
// A monthly editing round (app/monthly-rounds.js) is said by its month: "אלאור בוטיק · נובמבר 2026".
const jobName = (job) => `${job.client.name}${job.ctx?.monthly ? ` · ${monthLabel(job.ctx.month)}` : job.round > 1 ? ` · סבב ${job.round}` : ''}`;
const isNirel = () => me === 'nirel';
// How many videos I have edited, per shoot ('<client>:<round>:<me>' → row; 22.10.2026).
// null: the numbers cannot be read (before their migration): no counter then.
let progress = null;
// A monthly client's number this month ('<client>:<YYYY-MM>:<me>' → row; app/edit-count.js
// monthTarget). null: no monthly client of mine, or before its migration: no counter on those.
let months = null;
// What I count on a job (app/edit-count.js jobCount): a monthly round its month's number, else the job's part.
const partOf = (job, now = new Date()) => (jobCount(job, me, cs(job.client), now) || { of: editTarget(job.ctx, me) }).of;

// ── Loading ─────────────────────────────────
// A monthly client's numbers: this month's, the month of a monthly editing round of mine still
// open from before (only last month: the database takes no number for an older one), and the
// month each other job of it kept its number in before 4.11.2026 (jobCount's `from`, read only).
async function loadMonthRows(ids) {
  const now = new Date();
  const here = monthKey(now);
  const counts = allJobs().filter((j) => ids.includes(j.client.id)).map((j) => jobCount(j, me, cs(j.client), now)).filter(Boolean);
  const olds = counts.flatMap((n) => [n.month, n.from?.split(':')[1]]).filter((m) => m && m !== here);
  const keys = [here, ...new Set(olds)];
  const parts = await Promise.all(keys.map((k) => loadEditorMonths(ids, k)));
  return parts[0] ? parts.flatMap((p) => p || []) : null;
}
async function load() {
  $('state').textContent = clients.length ? '' : 'טוען…';
  try {
    [clients, checks, tasks] = await Promise.all([loadWorkClients(), loadChecks(), loadMyTasks(me)]);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  // An old client whose real editor the office recorded while it is in landing (docs/ops.md,
  // the bullets of 14.10.2026): it is that editor's, as it will be once activated.
  if (clients.some((c) => c.landing === true)) checks = withLandingEditors(clients, checks, (await loadIntake()).marks);
  states.clear();
  const ids = [...new Set(allJobs().map((j) => j.client.id))];
  for (const cid of ids) forgetFiles(cid);
  // The files too, before the cards are drawn: "מוכן לבדיקה" is locked or open at once.
  let rows;
  let monthRows;
  const monthly = clients.filter((c) => ids.includes(c.id) && isMonthly(c)).map((c) => c.id);
  [chars, briefs, logos, scripts, rows, monthRows, legacyChars] = await Promise.all([loadCharacterizations(ids), loadBriefsOf(ids), loadLogoFiles(ids), loadWorkScripts(ids), loadEditorProgress(ids),
    monthly.length ? loadMonthRows(monthly) : null, loadLegacyChars(ids), ...ids.map(readFiles)]);
  progress = rows ? progressMap(rows) : null;
  months = monthRows ? monthMap(monthRows) : null;
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
// The open jobs: what waits for the editor first, then what already left them (with Ofir, the
// client or Ilai; the owner, 3.11.2026: "משימות שכבר עורך ביצע שירדו למטה"). Each part by the date
// of its assignment, in the order chosen on this device (4.11.2026, app/editor-order.js), the
// deadline breaking a tie.
let sortDir = readSort();
function openJobs() {
  const open = allJobs().map((j) => ({ ...j, st: P.editorState(j, cs(j.client)) })).filter((j) => j.st.key !== 'done')
    .sort((a, b) => (a.p24?.dueAt || Infinity) - (b.p24?.dueAt || Infinity));
  const { mine, waiting } = splitJobs(open);
  const by = (list) => byAssigned(list, (j) => cs(j.client), sortDir);
  return [...by(mine), ...by(waiting)];
}

// A block ended from the client card (its wait on 22 ended there): the waits it put
// on 24 and 27 end too, and the report is cleared. (A report made while the editing goes
// on has no wait: it stays until "הגיע הכול" or "מוכן לבדיקה".)
async function tidyBlocks() {
  for (const j of allJobs()) {
    const c = cs(j.client);
    const m = c[`${j.pre}p22.missing`];
    if (!m || m.state !== 'done' || c[`${j.pre}p22.wait`]?.state === 'done' || P.reportOf(c, j.pre)) continue;
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
  if (jobs.length) noteIcon($('ed-summary'), 'info', 'scissors');
  const { mine, waiting: theirs } = splitJobs(jobs);
  const sort = $('ed-sort');
  sort.hidden = jobs.length < 2;
  sort.textContent = sortDir === 'new' ? 'מהחדש לישן' : 'מהישן לחדש';
  sort.setAttribute('aria-label', `סדר הרשימה לפי תאריך השיוך: ${sort.textContent}. לחיצה הופכת את הסדר.`);
  fill($('ed-list'), jobs.length ? [...mine.map(jobCard), theirs.length ? waitFold(theirs) : null]
    : emptyState({ icon: 'scissors', tone: 'purple', text: 'אין כרגע לקוח בעריכה אצלך. כשאופיר ישייך לקוח, הוא יופיע כאן ותקבל/י הודעה.' }));
  renderBriefs();
  renderStats();
}
// One toggle, "מהישן לחדש" / "מהחדש לישן", remembered on this device.
$('ed-sort').addEventListener('click', () => {
  sortDir = sortDir === 'new' ? 'old' : 'new';
  saveSort(sortDir);
  renderKeepingFocus('ed-sort');
});

// What the editor finished and waits for someone else (the owner, 4.11.2026): one fold at the end,
// closed, "מחכים לבדיקה (N)"; inside, one short line each (the client, where it is, since when),
// and the full card under the line on a tap. What is open stays open across the page's re-renders.
let foldOpen = false;
const openWaits = new Set();
function waitFold(list) {
  const now = new Date();
  return h('details', {
    class: 'ed-waitfold', id: 'ed-waits', open: foldOpen,
    ontoggle: (e) => { foldOpen = e.currentTarget.open; },
  }, h('summary', { id: 'ed-waits-s' }, `מחכים לבדיקה (${list.length})`),
  h('div', { class: 'ed-wlist' }, ...list.map((job) => {
    const id = `${cardId(job)}-w`;
    const since = sinceOf(job, cs(job.client));
    return h('details', {
      class: `ed-wline s-${job.st.key}`, id, open: openWaits.has(id),
      ontoggle: (e) => { if (e.currentTarget.open) openWaits.add(id); else openWaits.delete(id); },
    }, h('summary', {},
      h('span', { class: 'ed-wname' }, jobName(job)),
      h('span', { class: `ed-state s-${job.st.key}` }, P.STATE_TEXT[job.st.key]),
      since ? h('span', { class: 'ed-wsince' }, `מאז ${formatWhen(new Date(since), now)}`) : null),
    jobCard(job));
  })));
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
  // A card in the fold of "מחכים לבדיקה": the fold and its line open first.
  for (let d = el.parentElement?.closest('details'); d; d = d.parentElement?.closest('details')) {
    d.open = true;
    if (d.id === 'ed-waits') foldOpen = true;
    else openWaits.add(d.id);
  }
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
  const ofir = job.p24?.dueAt;
  const close = job.p27?.dueAt;
  const parts = [];
  if (['waiting', 'editing', 'fixes'].includes(st.key) && ofir) parts.push(`אצל אופיר עד ${P.dueWords(ofir, now)}`);
  if (close && st.key !== 'ilai') parts.push(`סגירה עד ${P.dayWords(close, now)}`);
  // Each date is a small fact with a clock (docs/ops.md, section 62); read as text it is the same sentence.
  return parts.length ? h('div', { class: 'ed-dates' }, facts(parts.map((p) => ['clock', p]))) : null;
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
// The raw material and the chosen take per script, as Lior and Eli wrote them on the shoot
// day (protocol v10; P.FILES_KEY). To read only: script → file → the take.
function rawFiles(job) {
  const files = P.filesOf(cs(job.client), job.pre);
  if (!files.size) return null;
  return h('details', { class: 'ed-more ed-files', open: true },
    h('summary', {}, `חומר גלם וטייק לכל תסריט (${files.size})`),
    h('ul', { class: 'ed-file-list' }, ...[...files].map(([n, x]) => h('li', { class: 'num' }, P.fileLine(n, x)))));
}

// ── The round's finished videos ─────────────
// In the client's Google Drive (docs/ops.md, section 37). The editor pastes the
// folder's link in "מוכן לבדיקה" (kept as the note of p24.drive: an editor may not
// write the card's links; a link the office put in the card is used as it is), and
// the final hand-off stands on the same link: after the client's notes the fixed
// versions replace the files in that folder. Uploading the videos here as well is
// optional; an uploaded video of this round stands in for the link.
const VIDEO = 'deliverable_video';
const FAIL_HELP = 'אם זה חוזר: ״חסר לוגו / טלפון / חומר״, לסמן ״העלאה למערכת״ ו״לדווח״. מי שבוחרים (עירית, ליאור או אופיר) מקבל מיד, והעריכה ממשיכה.';
const windowOf = (job) => videoWindow(job.client, cs(job.client), job.round);
const linkOf = (job) => videosLinkOf(job.client, cs(job.client), job.pre);
function videosGate(job) {
  const state = workFilesState(job.client.id);
  return gateOf({ link: linkOf(job), files: state.files, window: windowOf(job), state });
}
// Where the videos are (the Drive link, once known), and under it, closed, the
// optional upload into the system.
function videosBlock(job, st) {
  if (st.key === 'waiting') return null;
  const id = cardId(job);
  const link = linkOf(job);
  const gate = videosGate(job);
  const upload = mountWorkFiles({
    client: job.client, kind: VIDEO, window: windowOf(job), me, myEmail, idp: `${id}-v`, toast,
    title: 'סרטונים שהועלו למערכת', total: null, failHelp: FAIL_HELP,
    onChange: () => { if (!busy()) renderKeepingFocus(); },
  });
  return h('div', { class: 'ed-videos', id: `${id}-videos` },
    h('p', { class: 'ed-videos-h' }, h('strong', {}, 'הסרטונים הסופיים: בדרייב של הלקוח'),
      // The link pasted at the hand-off; the card's own Drive link is the button below, as always.
      link && link !== String(job.client.links?.drive || '').trim() ? [' · ', h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', id: `${id}-drive` }, 'פתיחת התיקייה בדרייב', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)'))]
        : !link && st.key === 'editing' ? ' · את הקישור לתיקייה מדביקים ב״מוכן לבדיקה״.' : null),
    h('details', {
      class: 'ed-more ed-upload', id: `${id}-up`, open: gate.count > 0 || openUploads.has(id),
      ontoggle: (e) => { if (e.currentTarget.open) openUploads.add(id); else openUploads.delete(id); },
    }, h('summary', {}, 'אפשר גם להעלות לכאן (לא חובה)'), upload));
}
const openUploads = new Set(); // the optional upload stays open across the page's re-renders
const lockHint = (id, gate) => (gate.ok ? null : h('p', { class: 'hint fl-lock', id: `${id}-lock` }, gate.reason));

function stateBlock(job, st) {
  const id = cardId(job);
  const now = new Date();
  const missingBtn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', id: `${id}-missing`, onclick: () => openMissing(job) }, 'חסר לוגו / טלפון / חומר');
  const gate = st.key === 'final' ? videosGate(job) : null;
  switch (st.key) {
    case 'waiting':
      return h('div', { class: 'ed-act' },
        h('button', { type: 'button', class: 'btn btn-primary', id: `${id}-go`, onclick: () => openStart(job) }, 'קיבלתי את הכונן והתחלתי'),
        missingBtn);
    case 'editing':
      return h('div', { class: 'ed-act' },
        h('button', { type: 'button', class: 'btn btn-primary', id: `${id}-go`, onclick: () => openReady(job) }, 'מוכן לבדיקה'),
        missingBtn);
    case 'qa':
      return h('p', { class: 'ed-wait' }, `${st.round > 1 ? 'התיקונים אצל אופיר לבדיקה חוזרת' : 'אצל אופיר'} מאז ${formatWhen(st.since, now)}. יעד הבקרה: שעת עבודה. תיקונים, אם יהיו, יופיעו כאן.`);
    case 'fixes': return qaFixes(job);
    case 'client': return h('p', { class: 'ed-wait' }, 'אופיר אישר. הסרטונים אצל הלקוח. הערות הלקוח יופיעו כאן.');
    case 'clientFixes': return clientFixesBlock(job, st);
    case 'final':
      return h('div', { class: 'ed-act' },
        h('button', { type: 'button', class: 'btn btn-primary', id: `${id}-go`, disabled: !gate.ok, 'aria-describedby': gate.ok ? null : `${id}-lock`, onclick: (e) => finish(job, st, e.currentTarget) }, 'תיקונים הושלמו, הגרסאות הסופיות בדרייב'),
        missingBtn,
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
    client: c, checks: cs(c), kind: 'videos', pre: job.pre, fixer: QA_KINDS.videos.fixers(job.ctx), me, viewer,
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

// ("עצירת העריכה למשימה אחרת" left on 5.11.2026: nothing stops the editing; the owner: "אף אחד לא חוסם אף אחד".)

function jobCard(job) {
  const { st } = job;
  const id = cardId(job);
  const now = new Date();
  const c = job.client;
  const day = P.editingDay(job.assignedAt, now);
  const videos = P.videosPerDay(job.ctx);
  const share = shareOf(job.ctx, me);
  // A monthly round: "12 סרטונים החודש" (or its month). Another job of a monthly client: the
  // package's videos when known, else the number of the month it was assigned in ("8 סרטונים · ספטמבר 2026"), as its counter.
  const cnt = jobCount(job, me, cs(c), now);
  const perMonth = cnt?.month ? monthVideosText(c, now, cnt.month)
    : monthlyFor(c, me) && !share && !videos ? monthVideosText(c, now, cnt?.own || monthKey(now)) : null;
  const mine = scriptsOf(job);
  // The scripts: Lior's Google Docs link (links.scripts), and how many (the office's number, else the system's).
  const nScripts = job.round > 1 ? (mine.length || null) : P.scriptsCountOf(c, mine.length);
  const links = c.links || {};
  const dropbox = P.needsDropbox(c);
  return h('article', { class: `ed-card s-${st.key}`, id, 'aria-labelledby': `${id}-h` },
    h('header', { class: 'ed-head' },
      h('h2', { id: `${id}-h`, tabindex: '-1' }, jobName(job), c.business && c.business !== c.name ? h('small', {}, c.business) : null),
      h('span', { class: `ed-state s-${st.key}` }, P.STATE_TEXT[st.key])),
    h('p', { class: 'ed-day' }, c.landing === true ? 'בקליטה · הימים עוד לא נספרים' : P.editingDayText(day, now, job.assignedAt, editingDaysOf(c))),
    job.todo ? h('p', { class: 'ed-day ed-todo' }, h('strong', {}, todoText(job.todo))) : null,
    // Two editors on this shoot (editor2): with whom.
    editorsOf(job.ctx).length > 1 ? h('p', { class: 'ed-pair', id: `${id}-pair` }, `עורכים יחד: ${editorNames(job.ctx)}`) : null,
    datesLine(job, st),
    // The one next step comes first; what the work needs follows.
    st.report ? reportBlock(job, st.report) : null,
    stateBlock(job, st),
    videosBlock(job, st),
    countLine(job),
    h('p', { class: 'ed-facts' },
      // Two editors with a split: this editor's own share.
      perMonth ? h('span', { class: 'ed-month', id: `${id}-month` }, perMonth)
        : share ? h('span', { class: 'ed-share' }, `${share.mine} מתוך ${share.total} סרטונים — השאר אצל ${PEOPLE[share.other]?.name || share.other}`)
        : videos ? h('span', {}, `${videos} סרטונים לפי החבילה`) : h('span', { class: 'muted' }, 'כמות הסרטונים לא הוזנה'),
      h('span', { class: nScripts ? 'ed-scount' : 'ed-scount muted', id: `${id}-scount` }, nScripts ? scriptsWords(nScripts) : 'מספר התסריטים לא הוזן'),
      dropbox ? h('span', { class: 'tag tag-warn' }, 'צריך גם Dropbox') : null),
    // The scripts first, and prominent: the editor works from them from the assignment on.
    links.scripts ? h('a', { class: 'btn ed-scripts-open', id: `${id}-scripts-link`, href: links.scripts, target: '_blank', rel: 'noopener noreferrer' },
      `פתיחת התסריטים${nScripts ? ` (${nScripts})` : ''}`) : null,
    h('div', { class: 'ed-links' },
      link(links.drive, 'דרייב'), dropbox ? link(links.dropbox, 'Dropbox') : null,
      !links.drive && !links.scripts && !mine.length ? h('span', { class: 'muted' }, 'אין עדיין קישור לדרייב ולתסריטים בכרטיס.') : null),
    scriptsBlock(job, mine),
    sheetBlock(job),
    eliNotes(job),
    rawFiles(job),
    highlightsBlock(job),
    legacyCharFold(job));
}

// The characterization filled in the old system (the owner, 26.10.2026; app/legacy-char-ui.js):
// closed under the highlights, only when there is one. What is open stays open across re-renders.
const legacyOpen = new Map(); // card id → the parts open ('all': the row itself)
function legacyCharFold(job) {
  const row = legacyChars[job.client.id];
  const view = legacyCharView(row);
  if (!view) return null;
  const id = cardId(job);
  if (!legacyOpen.has(id)) legacyOpen.set(id, new Set());
  const open = legacyOpen.get(id);
  const d = h('details', { class: 'ed-more ed-lch', id: `${id}-lch`, open: open.has('all') },
    h('summary', {}, 'אפיון מהמערכת הישנה', h('span', { class: 'lch-fs' }, legacyCharSum(view))),
    legacyCharBlock(row, { id: `${id}-lch-body`, open }));
  d.addEventListener('toggle', () => { if (d.open) open.add('all'); else open.delete('all'); });
  return d;
}

// ── How many I have edited (the owner's request of 22.10.2026) ──
// One line: "ערכתי [ N ] מתוך M" (M: my share with two editors, else the package's videos;
// unknown: "ערכתי [ N ] סרטונים"). A monthly client of mine (app/edit-count.js monthTarget)
// counts the current Israel month instead, from 0 again on the 1st: "ערכתי [ N ] מתוך 8", or
// the month's own number. Saved by itself a moment after the last change, with a quiet "נשמר".
// Above M is allowed and kept as it is.
const typed = new Map(); // key → the number typed and not saved yet (kept across re-renders)
const saveTimers = new Map();
// What a job's counter counts: { key, of, month } (month: a monthly client's 'YYYY-MM', else
// null), or null when those numbers cannot be read (before their migration): no counter then.
// Each card counts its own work (the owner's bug of 4.11.2026, app/edit-count.js jobCount): a
// monthly editing round its own month; the client's own job and a shoot round their own job.
// A client in landing counts too (most of the real ones, 22.10.2026): the office records its
// editor in clients.editor (landing_set_editor), and the number is that editor's.
function counterOf(job, now = new Date()) {
  const cnt = jobCount(job, me, cs(job.client), now);
  return cnt && mapOf(cnt) ? cnt : null;
}
const mapOf = (cnt) => (cnt.month ? months : progress);
// A job's number: what was typed, else its own row, else (a monthly client's job from before the
// fix) the month row it was kept in until then, else 0.
const shownOf = (cnt) => (typed.has(cnt.key) ? typed.get(cnt.key)
  : mapOf(cnt)?.[cnt.key]?.edited ?? (cnt.from ? months?.[cnt.from]?.edited : null) ?? 0);
function countLine(job) {
  const cnt = counterOf(job);
  if (!cnt) return null;
  const { key, of } = cnt;
  const id = `${cardId(job)}-edited`;
  const n = shownOf(cnt);
  const status = h('span', { class: 'ed-count-s', id: `${id}-s`, 'aria-live': 'polite' });
  const input = h('input', {
    type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 3, autocomplete: 'off', class: 'input ed-count-n num', id, value: String(n), 'data-count': key,
    'aria-label': `כמה סרטונים ערכתי${cnt.month ? ' החודש' : ''}${of ? ` מתוך ${of}` : ''}: ${jobName(job)}`,
    oninput: (e) => setCount(job, cnt, editedValue(e.currentTarget.value), { status }),
    onblur: (e) => { if (editedValue(e.currentTarget.value) === null) e.currentTarget.value = String(shownOf(cnt)); },
  });
  const minus = h('button', { type: 'button', class: 'step', id: `${id}-minus`, 'aria-label': 'אחד פחות', disabled: n <= 0, onclick: () => bumpCount(job, cnt, -1, input, status) }, '−');
  const plus = h('button', { type: 'button', class: 'step', id: `${id}-plus`, 'aria-label': 'עוד אחד', disabled: n >= 999, onclick: () => bumpCount(job, cnt, 1, input, status) }, '+');
  return h('div', { class: 'ed-count', id: `${id}-row` },
    h('label', { for: id, class: 'ed-count-k' }, 'ערכתי'),
    h('span', { class: 'ed-count-ctl' }, minus, input, plus),
    h('span', { class: 'ed-count-of num' }, of ? `מתוך ${of}` : 'סרטונים'),
    status);
}
function bumpCount(job, cnt, by, input, status) {
  const now = editedValue(input.value) ?? shownOf(cnt);
  const n = Math.min(999, Math.max(0, now + by));
  input.value = String(n);
  setCount(job, cnt, n, { status, row: input.closest('.ed-count') });
}
const stepsFor = (row, n) => {
  row.querySelector('[id$="-minus"]').disabled = n <= 0;
  row.querySelector('[id$="-plus"]').disabled = n >= 999;
};
function setCount(job, cnt, n, { status, row = status.closest('.ed-count') }) {
  if (n === null) return; // half typed (or emptied): saved once it is a number again
  const { key } = cnt;
  typed.set(key, n);
  stepsFor(row, n);
  status.textContent = '';
  clearTimeout(saveTimers.get(key));
  saveTimers.set(key, setTimeout(() => saveCount(job, cnt, n), 700));
}
async function saveCount(job, cnt, n) {
  const { key } = cnt;
  saveTimers.delete(key);
  const status = () => document.getElementById(`${cardId(job)}-edited-s`);
  try {
    const row = await (cnt.month ? saveEditorMonth(job.client.id, n, cnt.month) : saveEditorProgress(job.client.id, n, job.round));
    const map = mapOf(cnt);
    if (row && map) map[key] = row;
    if (typed.get(key) === n) typed.delete(key);
    const s = status();
    if (s && !saveTimers.has(key)) {
      s.textContent = 'נשמר';
      setTimeout(() => { if (s.textContent === 'נשמר') s.textContent = ''; }, 2000);
    }
  } catch (err) {
    const s = status();
    if (s) s.textContent = 'לא נשמר. נסו שוב.';
    else toast(`המספר של ${jobName(job)} לא נשמר. ${errorText(err)}`);
  }
}

// The client's scripts from the system (Lior writes them; scripts.html), read only, folded.
function scriptsBlock(job, list) {
  if (!list.length) return null;
  const id = `${cardId(job)}-scripts`;
  return h('details', { class: 'ed-scripts', id },
    h('summary', {}, `תסריטים (${list.length})`),
    h('ol', { class: 'ed-script-list' }, ...list.map((s) => h('li', { class: 'ed-script' },
      h('strong', {}, s.title || `תסריט ${s.n}`), s.status === 'approved' ? h('span', { class: 'tag' }, 'אושר') : null,
      s.body ? h('p', { class: 'ed-script-body' }, s.body) : null,
      ...(s.links || []).map((u, i) => h('a', { class: 'ed-script-link', href: u, target: '_blank', rel: 'noopener noreferrer' }, `השראה ${i + 1}`))))));
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

// Each of the four is answered "יש" or "חסר" (the owner, 22.10.2026: an unticked box said
// nothing). "קיבלתי את הכונן והתחלתי" opens once every line has an answer, in any mix: what
// is "חסר" is reported to Irit with the words written under it, and the editing goes on, its
// clock running (P.reportOf); for part of the footage, "יש חומר ל־N מתוך M", Lior gets a
// task (P.materialTask). "אי אפשר להתחיל בכלל" is the real can't-start case: "מה חסר?",
// then "לעצור את העריכה".
const NOTE_HINT = {
  logo: 'למשל: הלוגו מטושטש', phone: 'למשל: המספר לא עונה', footage: 'למשל: אין צילומי מוצר',
  scripts: 'למשל: לא ברור מה הסדר של סרטונים 5–8', upload: 'למשל: נעצר באמצע ולא ממשיך',
};
const ynOpt = (id, name, value, text, checked) => h('label', { class: `ed-yn-o is-${value}`, for: id },
  h('input', { type: 'radio', id, name, value, checked }), h('span', {}, text));
// Under a "חסר": for the footage, "יש חומר ל־[ N ] מתוך M סרטונים"; then, in a few words, what
// exactly is missing (it goes with the report to Irit and into Lior's task).
function moreBlock(prefix, k, { of, open, have = '', note = '' }) {
  return h('div', { class: 'ed-q-more', id: `${prefix}-more`, hidden: !open },
    k === 'footage' ? h('div', { class: 'ed-have' },
      h('label', { for: `${prefix}-have` }, 'יש חומר ל־'),
      h('input', {
        type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 3, autocomplete: 'off', class: 'input ed-have-n num',
        id: `${prefix}-have`, value: have, 'aria-describedby': `${prefix}-of`,
      }),
      h('span', { id: `${prefix}-of` }, of ? `מתוך ${of} סרטונים` : 'סרטונים')) : null,
    h('div', { class: 'field' },
      h('label', { for: `${prefix}-note` }, 'מה חסר? (לא חובה)'),
      h('input', { class: 'input', id: `${prefix}-note`, maxlength: P.NOTE_MAX, autocomplete: 'off', placeholder: NOTE_HINT[k] || '', value: note })));
}
// "למי לשלוח את הדיווח?" (the owner, 29.10.2026): עירית, ליאור or אופיר, one chosen.
// Irit is the default, as before; a report already sent comes with whom it went to.
function fillTo(prefix, chosen = 'irit') {
  const to = P.reportTo(chosen);
  fill($(`${prefix}-to-chips`), ...P.REPORT_TO.map(([k, l]) => h('label', { class: 'ed-to-o', for: `${prefix}-to-${k}` },
    h('input', { type: 'radio', id: `${prefix}-to-${k}`, name: `${prefix}-to`, value: k, checked: k === to }), h('span', {}, l))));
}
const toOf = (prefix) => P.reportTo(document.querySelector(`input[name="${prefix}-to"]:checked`)?.value);
const wordsOf = (prefix, keys) => Object.fromEntries(keys.map((k) => [k, $(`${prefix}-${k}-note`)?.value.trim() || '']).filter(([, t]) => t));
// "יש חומר ל־N": a whole number below the editor's part (0 too). The problem in words, or null.
function haveProblem(have, raw, of) {
  if (have === null) return raw.trim() ? 'מספר הסרטונים: רק ספרות.' : 'כתבו לכמה סרטונים יש חומר (אפשר גם 0).';
  if (of && have >= of) return `יש חומר לכל ${of} הסרטונים? אז ״יש״ בשורת החומר.`;
  return null;
}

const startDlg = dialog('dlg-start');
let target = null;
// The lines in START_CHECKS order: { key (the check), k (what it reports), i, answer }.
// One tick (3.11.2026): "עברתי על הכול, הכול תקין" answers all four "יש"; "משהו חסר?" opens
// the "יש" / "חסר" of each line (startDetail), as before.
let startDetail = false;
const startLines = () => P.START_CHECKS.map(([key], i) => ({
  key, k: P.missingKeyOf(key), i,
  answer: startDetail ? document.querySelector(`input[name="start-a-${i}"]:checked`)?.value || null : $('start-all').checked ? 'yes' : null,
}));
function showStartDetail(on) {
  startDetail = on;
  $('start-simple').hidden = on;
  $('start-detail').hidden = !on;
  $('start-some').setAttribute('aria-expanded', String(on));
}
function openStart(job) {
  target = job;
  $('start-ctx').textContent = jobName(job);
  const c = cs(job.client);
  const of = partOf(job);
  // What is known already: a check done is "יש"; what a report or a block names is "חסר".
  const open = job.st?.blocked || job.st?.report || null;
  $('start-nologo-s')?.remove();
  const answers = P.START_CHECKS.map(([key]) => (c[job.pre + key]?.state === 'done' ? 'yes' : open?.what.includes(P.missingKeyOf(key)) ? 'no' : null));
  fill($('start-lines'), ...P.START_CHECKS.map(([, label]) => h('li', {}, label)));
  $('start-all').checked = answers.every((a) => a === 'yes');
  fill($('start-list'), ...P.START_CHECKS.map(([key, label], i) => {
    const k = P.missingKeyOf(key);
    const answer = answers[i];
    const id = `start-${i}`;
    return h('div', { class: `ed-q${answer === 'no' ? ' is-no' : ''}`, id, role: 'radiogroup', 'aria-labelledby': `${id}-l` },
      h('span', { class: 'ed-q-l', id: `${id}-l` }, label),
      h('span', { class: 'ed-yn' }, ynOpt(`${id}-yes`, `start-a-${i}`, 'yes', 'יש', answer === 'yes'), ynOpt(`${id}-no`, `start-a-${i}`, 'no', 'חסר', answer === 'no')),
      moreBlock(`start-${k}`, k, { of, open: answer === 'no', have: k === 'footage' && open?.have != null ? String(open.have) : '', note: open?.notes?.[k] || '' }));
  }));
  // The logo line stands on what the card shows: say so when there is none to look at.
  fillTo('start', open?.to);
  if (!P.sheetOf(job.client, chars[job.client.id], logos[job.client.id]).hasLogo) {
    $('start-list').append(h('p', { class: 'hint', id: 'start-nologo' }, 'אין לוגו בתיק הלקוח. אם הוא לא אצלך: ״חסר״ בשורת הלוגו.'));
    $('start-lines').after(h('p', { class: 'hint', id: 'start-nologo-s' }, 'אין לוגו בתיק הלקוח. אם הוא לא אצלך: ״משהו חסר?״.'));
  }
  // Something already named missing (a report, a block) opens on the lines, with it marked.
  showStartDetail(answers.includes('no'));
  showErr('start-err', '');
  startAnswered();
  startDlg.showModal();
  (startDetail ? $('start-0-yes') : $('start-all')).focus();
}
$('start-all').addEventListener('change', () => { showErr('start-err', ''); startAnswered(); });
$('start-some').addEventListener('click', () => {
  // What the one tick said stays: each line "יש" until one is turned to "חסר".
  if ($('start-all').checked) for (let i = 0; i < P.START_CHECKS.length; i += 1) $(`start-${i}-yes`).checked = true;
  showStartDetail(true);
  startAnswered();
  $('start-0-no').focus();
});
// The button opens once every line is answered; the line under it says what happens.
function startAnswered() {
  const lines = startLines();
  const all = lines.every((l) => l.answer);
  // Whom to tell, once something is "חסר".
  $('start-to').hidden = !lines.some((l) => l.answer === 'no');
  $('start-submit').disabled = !all;
  $('start-hint').textContent = !startDetail ? (all ? '' : 'מסמנים ״עברתי על הכול, הכול תקין״, או ״משהו חסר?״.')
    : all ? 'מה שמסומן ״חסר״ יירשם כחסר, והעריכה ממשיכה.' : 'עונים ״יש״ או ״חסר״ בכל שורה.';
  return lines;
}
$('start-to').addEventListener('change', () => startAnswered());
$('start-list').addEventListener('change', (e) => {
  const line = e.target.closest('.ed-q');
  if (!line || e.target.type !== 'radio') return;
  const no = e.target.value === 'no';
  line.classList.toggle('is-no', no);
  line.querySelector('.ed-q-more').hidden = !no;
  showErr('start-err', '');
  startAnswered();
});
// A number being corrected: the error about it goes.
for (const [list, err] of [['start-list', 'start-err'], ['miss-list', 'miss-err']]) {
  $(list).addEventListener('input', (e) => {
    if (!e.target.classList.contains('ed-have-n') || e.target.getAttribute('aria-invalid') !== 'true') return;
    e.target.removeAttribute('aria-invalid');
    showErr(err, '');
  });
}
$('start-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const job = target;
  const lines = startAnswered();
  if (!lines.every((l) => l.answer)) return;
  const missing = lines.filter((l) => l.answer === 'no').map((l) => l.k);
  const of = partOf(job);
  let have = null;
  if (missing.includes('footage')) {
    const raw = $('start-footage-have').value;
    have = editedValue(raw);
    const problem = haveProblem(have, raw, of);
    $('start-footage-have').setAttribute('aria-invalid', String(!!problem));
    if (problem) { showErr('start-err', problem); $('start-footage-have').focus(); return; }
  }
  $('start-submit').disabled = true;
  try {
    await markMany(job, ['p22.received', ...lines.filter((l) => l.answer === 'yes').map((l) => l.key)]);
    const to = toOf('start');
    const lior = missing.length ? await reportGoing(job, missing, { notes: wordsOf('start', missing), have, of, to }) : null;
    startDlg.close();
    toast(!missing.length ? `התחלת: ${jobName(job)}. בהצלחה!`
      : `התחלת: ${jobName(job)}. ${P.reportGot(to)} הודעה על מה שחסר${lior === 'failed' ? ', אבל המשימה לליאור על החומר לא נפתחה. עדכנו אותו ישירות.' : lior === 'opened' ? ', וליאור משימה להשלים את החומר.' : '.'}`);
    renderKeepingFocus(`${cardId(job)}-go`);
  } catch (err) {
    showErr('start-err', `הסימון לא נשמר. ${errorText(err)}`);
  } finally {
    startAnswered();
  }
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
// "מה חסר?" offers only what was not confirmed as there (a check done, or "יש" in the start
// dialog); what is reported already comes ticked, with its words, and each ticked line opens
// "מה חסר?" in a few words under it. One way out (the owner, 5.11.2026: nothing stops the
// editing): "לדווח, והעריכה ממשיכה"; the report reaches whoever was chosen and the clock runs.
const missDlg = dialog('dlg-missing');
let missCtx = null;
function openMissing(job, { what = null, notes = null, have = null, yes = null, received = null, to = null } = {}) {
  const c = cs(job.client);
  const starting = !!received || job.st?.key === 'waiting';
  const open = job.st?.report || null;
  const marked = what ?? open?.what ?? [];
  const words = notes ?? open?.notes ?? {};
  const known = have ?? (what ? null : open?.have ?? null);
  const confirmed = (k) => !!P.CHECK_OF[k] && (yes ? yes.includes(k) : c[job.pre + P.CHECK_OF[k]]?.state === 'done');
  // A video upload is something to report only once there are videos.
  const list = P.MISSING_WHAT.filter(([k]) => !confirmed(k) && (k !== 'upload' || !starting)).map(([k]) => k);
  missCtx = { job, received, list };
  $('miss-ctx').textContent = jobName(job);
  const of = partOf(job);
  fill($('miss-list'), ...(list.length ? P.MISSING_WHAT.filter(([k]) => list.includes(k)).map(([k, l]) => h('div', { class: `ed-mq${marked.includes(k) ? ' is-no' : ''}` },
    checkRow(`miss-${k}`, l, marked.includes(k)),
    moreBlock(`miss-${k}`, k, { of, open: marked.includes(k), have: k === 'footage' && known !== null ? String(known) : '', note: words[k] || '' })))
    : [h('p', { class: 'hint', id: 'miss-none' }, 'הכול מסומן ״יש״. אם משהו בכל זאת חסר, ״חסר״ בשורה שלו.')]));
  fillTo('miss', to ?? open?.to);
  $('miss-go').disabled = !list.length;
  $('miss-hint').textContent = 'ההודעה יוצאת עכשיו למי שבחרת. העריכה ממשיכה, והמועד שלך רץ כרגיל.';
  showErr('miss-err', '');
  missDlg.showModal();
  (document.querySelector('#miss-list .cbx:checked') || document.querySelector('#miss-list .cbx') || $('miss-cancel')).focus();
}
$('miss-list').addEventListener('change', (e) => {
  if (!e.target.classList.contains('cbx')) return;
  const row = e.target.closest('.ed-mq');
  row.classList.toggle('is-no', e.target.checked);
  row.querySelector('.ed-q-more').hidden = !e.target.checked;
  showErr('miss-err', '');
});
// Enter in a field sends nothing: each way out is its own button.
$('miss-form').addEventListener('submit', (e) => e.preventDefault());
$('miss-go').addEventListener('click', () => sendMissing());
async function sendMissing() {
  const { job, received, list } = missCtx;
  const what = list.filter((k) => $(`miss-${k}`).checked);
  if (!what.length) { showErr('miss-err', 'סמנו מה חסר.'); $(`miss-${list[0]}`)?.focus(); return; }
  const of = partOf(job);
  let have = null;
  if (what.includes('footage')) {
    // Lior needs the number.
    const raw = $('miss-footage-have').value;
    have = editedValue(raw);
    const problem = haveProblem(have, raw, of);
    $('miss-footage-have').setAttribute('aria-invalid', String(!!problem));
    if (problem) { showErr('miss-err', problem); $('miss-footage-have').focus(); return; }
  }
  const notes = wordsOf('miss', what);
  const to = toOf('miss');
  $('miss-go').disabled = true;
  try {
    // From the start dialog: the drive arrived, with whatever was there.
    if (received) await markMany(job, ['p22.received', ...received]);
    const lior = await reportGoing(job, what, { notes, have, of, to });
    missDlg.close();
    const extra = lior === 'failed' ? ' המשימה לליאור על החומר לא נפתחה: עדכנו אותו ישירות.' : lior === 'opened' ? ' ליאור קיבל משימה להשלים את החומר.' : '';
    toast(`${P.reportGot(to)} הודעה: חסר ${P.missingText(what)}. העריכה ממשיכה.${extra}`);
    renderKeepingFocus(`${cardId(job)}-arrived`);
  } catch (err) {
    showErr('miss-err', `הדיווח לא נשמר. ${errorText(err)}`);
  } finally {
    $('miss-go').disabled = false;
  }
}

// A report while the editing goes on: no wait, the clock runs. Irit (or Lior or Ofir, `to`) is rung on it
// (app/reminder-rules.js editorMissing). What an earlier report named and this one does
// not came in the meantime (its check is marked). Returns how Lior's task went (syncMaterial).
async function reportGoing(job, what, { notes = {}, have = null, of = null, to = 'irit' } = {}) {
  const c = cs(job.client);
  const before = P.reportOf(c, job.pre);
  await markOne(job, 'p22.missing', P.missingNote(what, '', { notes, have, of, going: true, to }));
  const came = (before?.what || []).filter((k) => !what.includes(k)).map((k) => P.CHECK_OF[k]).filter(Boolean);
  if (came.length && c[`${job.pre}p22.received`]?.state === 'done') await markMany(job, came);
  return syncMaterial(job, { what, notes, have, of });
}
// Part of the footage (a report with "יש חומר ל־N"): Lior's task to plan the rest, one open
// per shoot round. With the footage no longer missing, his open one closes by itself (as the
// pause's notices do); footage missing with no number leaves it as it is. `report` is
// { what, notes, have, of } as written. Returns 'opened' | 'kept' | 'closed' | 'failed' | null.
async function syncMaterial(job, report) {
  const footage = !!report?.what.includes('footage');
  if (footage && (report.have === null || report.have === undefined)) return null;
  let open = [];
  try { open = (await loadOpenTasksOf([job.client.id])).filter((t) => P.isMaterialTask(t, job.round)); } catch { /* none known */ }
  if (!footage) {
    for (const t of open) await setTaskDone(t.id, true).catch(() => {});
    return open.length ? 'closed' : null;
  }
  if (open.length) return 'kept';
  try { await addTask(P.materialTask(job.client, job.round, report)); return 'opened'; } catch { return 'failed'; }
}

// Reported while the editing goes on: "חומר ל־14 מתוך 36", each missing thing with its words,
// and "הגיע הכול" (so does "מוכן לבדיקה").
function reportBlock(job, r) {
  const id = cardId(job);
  return h('div', { class: 'ed-report', role: 'note', id: `${id}-report` },
    r.have !== null ? h('p', { class: 'ed-report-n num', id: `${id}-material` }, P.materialText(r.have, r.of)) : null,
    h('ul', { class: 'ed-report-list' }, ...P.MISSING_WHAT.filter(([k]) => r.what.includes(k)).map(([k, l]) => h('li', {},
      h('strong', {}, `חסר ${l}`), r.notes[k] ? ` · ${r.notes[k]}` : ''))),
    r.note ? h('p', { class: 'ed-note' }, `״${r.note}״`) : null,
    h('p', { class: 'hint' }, `${P.reportGot(r.to)} הודעה ${formatWhen(r.at, new Date())}. העריכה ממשיכה.`),
    h('button', { type: 'button', class: 'btn btn-sm', id: `${id}-arrived`, onclick: (e) => endReport(job, e.currentTarget) }, 'הגיע הכול'));
}
async function endReport(job, btn) {
  btn.disabled = true;
  const r = P.reportOf(cs(job.client), job.pre);
  try {
    await unmark(job, 'p22.missing');
    const keys = (r?.what || []).map((k) => P.CHECK_OF[k]).filter(Boolean);
    if (keys.length) await markMany(job, keys);
    await syncMaterial(job, null);
  } catch (err) {
    btn.disabled = false;
    toast(`לא נשמר. ${errorText(err)}`);
    return;
  }
  toast('סומן שהכול הגיע.');
  renderKeepingFocus(`${cardId(job)}-go`);
}

// The missing thing arrived: the waits end (their time moves the deadlines on) and
// what was missing is checked; Lior's task for the rest of the footage closes (`tasks`).
async function endBlock(job, { btn = null, quiet = false, tasks: closeTasks = true } = {}) {
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
      const keys = (report.what || []).map((k) => P.CHECK_OF[k]).filter(Boolean);
      if (keys.length) await markMany(job, keys);
    }
    if (closeTasks && (report.what || []).includes('footage')) await syncMaterial(job, null);
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
  target = job;
  readyList = P.selfCheck(P.needsDropbox(job.client));
  const gate = videosGate(job);
  $('ready-ctx').textContent = `${jobName(job)}${P.videosPerDay(job.ctx) ? ` · ${P.videosPerDay(job.ctx)} סרטונים` : ''}`;
  // The Drive folder of the videos: what is known already, to confirm or replace.
  $('ready-link').value = gate.link || '';
  $('ready-link').removeAttribute('aria-invalid');
  $('ready-link-hint').textContent = gate.count ? `${gate.count === 1 ? 'סרטון אחד הועלה למערכת' : `${gate.count} סרטונים הועלו למערכת`}: אפשר גם בלי קישור.` : 'התיקייה של הלקוח בדרייב, עם כל הסרטונים הסופיים.';
  showErr('ready-link-err', '');
  // The five critical mistakes come under their own line (protocol v10).
  // What to check, as lines (3.11.2026), and one tick under them for all of them.
  const plain = readyList.filter(([, , group]) => group !== 'critical');
  const critical = readyList.filter(([, , group]) => group === 'critical');
  fill($('ready-list'),
    h('ul', { class: 'ed-lines', id: 'ready-lines' }, ...plain.map(([, l]) => h('li', {}, l))),
    critical.length ? h('p', { class: 'prod-sub', id: 'ready-critical' }, CRITICAL_TITLE) : null,
    critical.length ? h('ul', { class: 'ed-lines', id: 'ready-crit-lines' }, ...critical.map(([, l]) => h('li', {}, l))) : null);
  $('ready-all').checked = false;
  showErr('ready-err', '');
  readyDlg.showModal();
  $('ready-all').focus();
}
$('ready-all').addEventListener('change', () => { if ($('ready-all').checked) showErr('ready-err', ''); });
$('ready-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const job = target;
  if (!$('ready-all').checked) {
    showErr('ready-err', 'עוברים על הרשימה ומסמנים ״עברתי על הכול, הכול תקין״.');
    $('ready-all').focus();
    return;
  }
  // The hand-off stands on the Drive link, or on a video uploaded here.
  const link = $('ready-link').value.trim();
  const problem = link || !videosGate(job).count ? driveLinkProblem(link) : null;
  showErr('ready-link-err', problem || '');
  $('ready-link').setAttribute('aria-invalid', String(!!problem));
  if (problem) { $('ready-link').focus(); return; }
  $('ready-submit').disabled = true;
  try {
    // The four checks of the start are true by now; the notice to Ofir goes last.
    // The folder (24) is the editor's since 3.11.2026: the link pasted here is that folder.
    await markMany(job, [...P.START_CHECKS.map(([k]) => k), 'p24.folder', ...P.readyKeys(P.needsDropbox(job.client)).filter((k) => !['p24.notify', 'p24.drive', 'p24.folder'].includes(k))]);
    // "הכול בדרייב" carries the folder's link (written again when it changed).
    await markOne(job, 'p24.drive', link || null);
    await markOne(job, 'p24.notify', 'מוכן לבדיקה');
    // What was reported while editing is here by now (the four are marked): the report closes.
    if (P.reportOf(cs(job.client), job.pre)) {
      await unmark(job, 'p22.missing');
      await syncMaterial(job, null);
    }
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
      toast('כל תיקוני הלקוח סומנו. עכשיו: ״תיקונים הושלמו, הגרסאות הסופיות בדרייב״.');
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
// The editor marks the final versions in the Drive (p27.final); Ilai gets them
// (app/reminder-rules.js finalReady) and his "קיבלתי" (p27.toilai) closes the job.
async function finish(job, st, btn) {
  if (!P.canFinish(st)) return;
  const gate = videosGate(job);
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
          // The day it is due as a pill: pink once it has passed, amber on the day itself.
          t.due_on && dayFromKeyIL(t.due_on) ? pill(h('span', { class: 'num' }, `עד ${formatWhen(endOfDayIL(dayFromKeyIL(t.due_on)))}`),
            endOfDayIL(dayFromKeyIL(t.due_on)) < new Date() ? 'late' : dayFromKeyIL(t.due_on) <= new Date() ? 'today' : 'plain') : null),
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
    })) : emptyState({ icon: 'check-circle', tone: 'green', text: 'אין בריפים פתוחים.' }));
}

// An urgent task: "התחלתי" records the start; the editing is not stopped (5.11.2026).
function startUrgent(t, btn) { doStart(t, btn); }
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

// The kit (docs/ops.md, section 52): the headings and the cards take their icon square.
dress($('app'), [['.ed-card .ed-head h2', 'scissors', 'purple', 'md'], ['#briefs-h', 'list', 'orange', 'md'], ['#stats-h', 'chart', 'teal', 'md'],
  ['.prod-task.is-urgent .prod-task-h', 'bolt', 'pink'], ['.prod-task .prod-task-h', 'check-circle', 'blue'], ['#na-h', 'lock', 'navy']]);

// The dialogs of this page open with the same icon square in their head.
for (const [sel, name, tone] of [['#start-h', 'drive', 'purple', 'md'], ['#miss-h', 'alert', 'orange', 'md'], ['#ready-h', 'check-circle', 'green', 'md'],
  ['#pause-h', 'pause', 'navy'], ['#urg-h', 'bolt', 'pink'], ['#done-h', 'check', 'green']]) headIcon(document.querySelector(sel), name, tone, { size: 'md' });

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
    ? 'הלקוחות של נטלי, נירו והצל שבעריכה אצלך, ומתחת הבריפים מכל לקוח.'
    : 'לכל לקוח: באיזה יום את/ה, עד מתי, וכפתור אחד לשלב הבא.';
  mountPush({ who: me, card: $('push-card'), button: $('btn-inbox'), dialog: $('dlg-inbox'), changed: () => {} });
  await load();
});
