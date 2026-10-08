// Clients list, "my work" across clients, the daily control view (protocol
// processes 32 and 33) and the performance report.
import {
  PEOPLE, STAFF_PEOPLE, EDITORS, PHASES, PROCESSES, CLIENT_STATUS, OFFICE_REVIEWS, REVIEW_TOPICS,
  STATUS_FIELDS, BRIEF_REQUIRED, STATIONS, DELIVERABLES,
} from './protocol.js';
import {
  clientState, openItemsFor, byUrgency, bucketOf, CLAIM, WAIT, waitNote, bulkEligible, isResolved,
  isBusinessDay, businessDaysBetween, addBusinessDays, weekKey, roundsOf, parseDate,
  upcomingFor, involves, WAITED, waitOf, parseWaitNote, endWaitNote, IMPORT_NOTE, ANSWERED, clientLabel,
  inLanding, workFloor,
} from './protocol-logic.js';
import { clocksFor, clockTime } from './clocks.js';
import { loadIntake } from './landing-data.js';
import { intakeFor, intakeLeft, quietWork, landingBoard } from './landing-logic.js';
import { glide } from './shell.js'; // a filter chosen: the rows that stay glide to their place
import { renderNowBar, updateNowBar, clockRows, ranOutText } from './now-bar.js';
import {
  loadClients, loadChecks, loadTasks, setCheck, clearCheck, setChecksBulk, clearChecksBulk, setTaskDone, createClient,
  signedQuotes, loadDirectory, loadReviews, markReview, loadAllLog, addTask,
  loadStatusNotes, saveStatusNote, setTaskStarted, updateClient,
} from './protocol-data.js';
import {
  $, fill, h, toast, errorText, personChip, peopleChips, formatWhen, formatDay, statusBadge, progressBar, capList,
  KEEP_BOOT, mountSession, store, directory, who, lateBy, formatStamp, loadQuoteNumbers, briefDetails, taskBadge,
  isUrgentTask, isEscalation, TASK_SOURCES, viewerOf, VIEWER_UNKNOWN, CLIENT_PROCS, officeMinutes, endWaitText,
} from './protocol-ui.js';
import { whatsappLink } from './quote-doc.js';
import { warm, taken } from './supa.js';
import { TZ, partsIL, dayKeyIL, dayFromKeyIL, endOfDayIL, weekdayIL, addDaysIL, atTimeIL, dateIL, inputValueIL, fromInputIL } from './tz.js';
import { PACKAGES } from './catalog.js';
import { PACKAGE_OPTIONS, packageName, shootTypeOf, dealDeliverables, importKeys, openedBySigning } from './client-open.js';
import { canManageTeam } from './team-rules.js';
import { canSendMessages, stationTitle } from './messages-logic.js';
import { offerHandoff, dropHandoff } from './handoff-ui.js';
import { canSeeAllClients, canSeeOwnerScreen, seesWholeTeam, closedProcesses, teamRows, EDITOR_CAP, historyKeys, withHistory } from './health.js';
import { loadDateChanges, loadLogFor } from './owner-data.js';
import { refreshQuestions } from './questions-ui.js';
import { mountPush, siteWorker, pushActive } from './push.js';
import { mountWhatsappCard } from './whatsapp.js';
import { mountCalendar } from './calendar-card.js';
// Stage 3, part 2 (the office's flows): Ilai's day in "המשימות שלי", the first screens of Ofir and Lior.
import { ilaiSection, coveredByCard } from './ilai-card.js';
import { landingNow, officeLinks } from './office-ui.js';
import { hasProfiles, modeOf } from './manager-rules.js';
import { profileOf, managerTabs } from './shell-rules.js';
import { folderItemOf } from './qa-logic.js';
import { uploadStepOf } from './files-logic.js';
// 3.10.2026: Stav's deals waiting for a contract (the office), and Stav's own page.
import { mountDeals, refreshDeals } from './deal-ui.js';
import { mountApprovals } from './approvals-ui.js';
import { mountStaffTasks } from './staff-tasks-ui.js';
import { mountMetricoolConnect, syncMetricoolConnect } from './metricool-connect-ui.js';
import { landingOf } from './deal-logic.js';
// A link to a part of this page (#mine, #control, a sign-in link) opens that part:
// nobody is sent to their first screen then.
const ARRIVED_WITH = location.hash;
import { intakeShortcut } from './intake-ui.js';
// Stage 5: the monthly cycle (a draft) in "המשימות שלי", and the way to the package year.
import { showMonths, worksCycle } from './month-ui.js';
// Irit's daily control (process 32): her eleven topics, each with what is open now.
import { controlTopics, unseenTopics, topicsRecord, recordText, topicLabel, ageText } from './control-topics.js';
import { loadDeals } from './deal-data.js';
import { fixTaskOf, fixNote, FIX_ITEM_LABEL } from './late-chain.js';
import { canSeeDeals, canSeeQuoteList } from './manager-rules.js';
// Everything that waits for me on another page, as counted lines (docs/ops.md, section 46).
import { flowLines, flowNeeds } from './mine-flow.js';
import { loadFlowExtra } from './mine-flow-data.js';

let clients = [];
let checks = {};
let tasks = [];
let reviews = null;         // office_reviews rows of the last 7 business days (null = not loaded)
let reviewsError = null;
let deals = null;           // Stav's deals, for the control's "חוזים" and "חתימות" (null: not this viewer's, or not loaded)
let statusNotes = null;     // client_status_notes of this week and the last (null = not loaded)
let statusError = null;
let lastLog = new Map();    // client id -> time of the latest history entry (last 3 weeks)
let quoteInfo = new Map();  // quote id -> { number, signed_at }, for clients opened automatically
let me = null;              // this user's person key (staff.person; null for the owner)
let scope = 'office';       // 'own': only my work and my clients; 'office': plus the office screens
let viewerError = null;     // the signed-in person could not be looked up
let minePerson = null;      // whose work the "my work" tab shows ('' = everyone; office only)
let view = 'mine';
// The owners, Irit, Ofir and Lior in their personal profile (app/manager-rules.js
// hasProfiles; app/shell-rules.js profileOf): "המשימות שלי" shows their own work only,
// and the performance waits in the manager profile; so does the office's daily review,
// except for Ofir and Irit, whose own process it is (managerTabs).
// In the manager profile the same list is the team's work, with the choice of whose, at
// its own address (#team), so that "המשימות שלי" (#mine) is always the personal profile.
let personal = false;
let managing = false;
function syncProfile() {
  const viewer = { me, scope, error: viewerError };
  const was = personal;
  const profile = profileOf(viewer, location.pathname, location.hash, location.search, modeOf(viewer));
  personal = profile === 'mine';
  managing = profile === 'manager';
  return was !== personal;
}
// The view an address asks for, and the address of a view.
const viewOfHash = () => { const v = location.hash.slice(1); return v === 'team' ? 'mine' : v; };
const hashOfView = (v) => (v === 'mine' && managing ? 'team' : v);
// A tab of the manager profile is not offered in the personal one.
const managerTab = (t) => personal && managerTabs({ me, scope, error: viewerError }).includes(t);
let clientFilter = 'active';
let lastLoad = 0;
const laterOpen = new Set();   // the folded "this week" and "later" groups a person opened
let waitGroupOpen = null;   // the collapsed "waiting on client" group keeps its state across renders
const clientUrl = (id, hash = '') => `client.html?id=${encodeURIComponent(id)}${hash}`;

const states = new Map();
function stateOf(c) {
  if (!states.has(c.id)) states.set(c.id, clientState(c, checks[c.id] || {}, new Date()));
  return states.get(c.id);
}

// ── Small helpers ───────────────────────────
// Days and hours are Israel's (tz.js), whatever the zone of the device.
const dayIso = (d) => dayKeyIL(d);
const dm = (d) => { const p = partsIL(d); return `${p.day}.${p.month}`; };
const WEEKDAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
// A bare date (yyyy-mm-dd) as "ב׳ 30.9", read as an Israel calendar day.
const dayShort = (iso) => { const x = dayFromKeyIL(iso); return x ? `${WEEKDAY[weekdayIL(x)]} ${dm(x)}` : String(iso); };
const weekdayLong = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long' });
const hmFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const hm = (d) => hmFmt.format(new Date(d));
const live = (c) => c.status !== 'cancelled';
// The clients from the old system that are in landing (docs/ops.md, section 41): what
// was said about them so far. Loaded only while some client is in landing.
let intake = { marks: {}, done: {}, ready: false };
// The rows of the queues that are worked on another page, for the counted lines of
// "המשימות שלי" (app/mine-flow.js): { name: rows | null }.
let flowExtra = {};
const landingTag = (c) => (c.landing === true ? h('span', { class: 'tag tag-landing', title: 'לקוח מהמערכת הישנה: בלי שעונים והתראות עד שיופעל' }, 'בקליטה') : null);
// A client opened by the signing trigger stays "new" until someone confirms its details.
// An imported client is never "new" (openedBySigning in app/client-open.js).
const isAuto = (c) => openedBySigning(c, checks[c.id]) && !c.verified_at && live(c);
const roundOf = (proc) => /^r(\d+)-/.exec(proc.id)?.[1] || null;
const procLabel = (proc, sep = ' · ') => `${roundOf(proc) ? `סבב ${roundOf(proc)} · ` : ''}${proc.num}${sep}${proc.title}`;
const namesOf = (keys) => keys.map((k) => PEOPLE[k]?.name || k).join(', ');
const busy = () => !!document.querySelector('dialog[open]');
const recheckDue = (wait, today = dayIso(new Date())) => !!(wait?.recheck && wait.recheck <= today);
const peopleOf = (x) => (x.claim ? [x.claim.person] : x.proc.owners);
const clientOf = (id) => clients.find((c) => c.id === id) || null;
// Clients the office still works with (the weekly summary and the integrity checks).
// A client in landing (docs/ops.md, section 41) is asked for nothing yet: no weekly
// summary, and it is not "quiet" or missing details in the integrity checks.
const inWork = (c) => (c.status === 'active' || c.status === 'ending') && !inLanding(c);
const isStaff = (key) => STAFF_PEOPLE().some((p) => p.key === key);
// Everyone but the editors, then the editors (grouped under their own heading where lists are long).
const officePeople = () => STAFF_PEOPLE().filter((p) => !p.editor);
const editorPeople = () => STAFF_PEOPLE().filter((p) => p.editor);

// The first rows of the page, asked for while the session is being confirmed (app/supa.js warm).
const firstRows = () => Promise.all([loadClients({ includeEnded: true }), loadChecks(), loadTasks({ openOnly: true })]);
warm('clients', firstRows);
async function load() {
  $('state').textContent = clients.length ? '' : 'טוען…';
  const now = new Date();
  try {
    [clients, checks, tasks] = await taken('clients', firstRows);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  // The counted lines of "המשימות שלי" ask for their own rows meanwhile (app/mine-flow-data.js).
  const flowWants = flowNeeds({ me, scope, error: viewerError }, now);
  // The owners have no list of their own: they read the contracts still out for signature
  // for the control's "חתימות" (the database answers only whoever may read the quotes).
  if (!flowWants.includes('unsigned') && canSeeQuoteList({ me, scope, error: viewerError })) flowWants.push('unsigned');
  const flowAsked = loadFlowExtra(flowWants, { now, clients, checks, stateOf: (c) => clientState(c, checks[c.id] || {}, now) });
  // Reviews and agreement numbers are extras: the page works without them.
  // They serve the office screens only, so an 'own' view does not load them.
  const none = { status: 'rejected', reason: null };
  const [rv, qi, sn, lg, dl] = scope === 'office' ? await Promise.allSettled([
    loadReviews(dayIso(lastBusinessDays(7, now).at(-1))),
    loadQuoteNumbers(clients.filter(isAuto).map((c) => c.quote_id)),
    loadStatusNotes({ sinceWeek: weekKey(new Date(now.getTime() - 7 * 864e5)) }),
    loadAllLog(new Date(now.getTime() - 21 * 864e5).toISOString()),
    // The deals answer only Irit and the owners (the database decides; canSeeDeals mirrors it).
    canSeeDeals({ me, scope, error: viewerError }) ? loadDeals() : Promise.resolve(null),
  ]) : [none, none, none, none, none];
  deals = dl.status === 'fulfilled' ? dl.value : null;
  reviews = rv.status === 'fulfilled' ? rv.value : null;
  reviewsError = rv.status === 'rejected' ? rv.reason : null;
  if (qi.status === 'fulfilled') quoteInfo = qi.value;
  statusNotes = sn.status === 'fulfilled' ? sn.value : null;
  statusError = sn.status === 'rejected' ? sn.reason : null;
  if (lg.status === 'fulfilled') {
    lastLog = new Map();
    for (const r of lg.value) if (!lastLog.has(r.client_id) || r.at > lastLog.get(r.client_id)) lastLog.set(r.client_id, r.at);
  }
  if (clients.some((c) => c.landing === true)) intake = await loadIntake();
  flowExtra = await flowAsked;
  states.clear();
  lastLoad = Date.now();
  $('state').textContent = '';
  rebuildClocks();
  watchNewClients();
  checkLate();
  if (!document.hidden) renderKeepingFocus();
  refreshQuestions($('my-questions'), me, clients);
  refreshDeals();
}

// Re-rendering replaces elements; keep keyboard focus and scroll where they were.
function renderKeepingFocus() {
  const focusId = document.activeElement?.id;
  const y = window.scrollY;
  render();
  window.scrollTo({ top: y });
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

// ── Identity and scope ──────────────────────
// Who I am comes from the database (staff.person); nobody picks it. The owner has
// no person and sees the office, and can show any one person's list.
function renderMe() {
  const bar = $('me-bar');
  if (me) {
    fill(bar, h('span', { class: 'me-label' }, 'אני:'), personChip(me, 'is-me'), h('span', { class: 'muted' }, PEOPLE[me].role));
  } else if (scope === 'office' && personal) {
    fill(bar, h('span', { class: 'me-label' }, 'המשימות שלי:'), h('span', { class: 'muted' }, 'מה שמחכה לך. כל השאר נמצא ב״מבט מנהל״, בכפתור שבראש העמוד.'));
  } else if (scope === 'office') {
    fill(bar, h('span', { class: 'me-label' }, 'תצוגת משרד:'), h('span', { class: 'muted' }, 'העבודה של כל הצוות. אפשר להציג את הרשימה של כל עובד.'));
  } else {
    fill(bar, h('p', { class: 'err', role: 'alert' }, viewerError ? VIEWER_UNKNOWN : 'לא הוגדר לך תפקיד בפרוטוקול. פנו למנהל המערכת.'));
  }
}

// 'own': only "my work" and my clients. The office screens are not offered at all.
function applyScope() {
  const own = scope === 'own';
  document.documentElement.dataset.scope = scope;
  $('tab-control').hidden = own || managerTab('control');
  // Everyone sees their own row of screen 4 (decision 22); 'own' roles only that.
  $('tab-performance').hidden = (own && !me) || managerTab('performance');
  $('tab-performance').textContent = own ? 'הנתונים שלי' : 'ביצועים';
  $('btn-new').hidden = own;
  $('tab-clients').textContent = own ? 'הלקוחות שלי' : 'לקוחות';
  $('tab-mine').textContent = managing || (!me && !personal) ? 'עבודת הצוות' : 'המשימות שלי';
  // One plain heading for everyone who is a person in the protocol: "שלום <name>" (it
  // was "לקוחות ופרוטוקול עבודה" for the office and "שלום …" for the rest; 6.10.2026).
  // The owner's login, which is not a person, keeps the page's own name.
  const head = document.querySelector('#app .page-head');
  const h1 = head?.querySelector('h1');
  if (h1 && me) h1.textContent = `שלום ${PEOPLE[me].name}`;
  if (own && head) {
    const sub = head.querySelector('h1 + p');
    if (h1 && !me) h1.textContent = 'המשימות שלי';
    if (sub) sub.textContent = 'מה פתוח אצלך עכשיו, והלקוחות שיש לך בהם עבודה.';
  }
}

// ── Tabs ────────────────────────────────────
const TABS = ['mine', 'clients', 'control', 'performance'];
const tabsShown = () => TABS.filter((t) => !$(`tab-${t}`).hidden);
function setView(v, focus = false) {
  view = tabsShown().includes(v) ? v : 'mine';
  for (const t of TABS) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === view));
    $(`tab-${t}`).tabIndex = t === view ? 0 : -1;
    $(`view-${t}`).hidden = t !== view;
  }
  if (focus) $(`tab-${view}`).focus();
  history.replaceState(null, '', `#${hashOfView(view)}`);
  // The address changed without an event: the app menu marks the screen by it (app/shell.js).
  window.dispatchEvent(new Event('hashchange'));
  render();
}
for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => setView(t));
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  const list = tabsShown();
  const i = list.indexOf(view);
  const next = { ArrowLeft: list[(i + 1) % list.length], ArrowRight: list[(i + list.length - 1) % list.length], Home: list[0], End: list[list.length - 1] }[e.key];
  if (!next) return;
  e.preventDefault();
  setView(next, true);
});

function render() {
  // The landing line and list belong to "המשימות שלי" alone.
  if (view !== 'mine') { $('land-line').hidden = true; $('land-quiet').hidden = true; }
  if (view === 'mine') renderMine();
  if (view === 'clients') renderClients();
  if (view === 'control') renderControl();
  if (view === 'performance') renderPerformance();
}

// ── My work ─────────────────────────────────
// Open work grouped by client and process (tasks are groups of one).
// Cancelled clients have no open work (openItemsFor), and their tasks are left out too.
function workFor(person) {
  const now = new Date();
  const groups = new Map();
  for (const c of clients) {
    for (const e of openItemsFor(person, c, checks[c.id] || {}, stateOf(c), now)) {
      const k = `${c.id}:${e.proc.id}`;
      if (!groups.has(k)) groups.set(k, { key: k, client: c, proc: e.proc, status: e.status, dueAt: e.dueAt, claim: e.claim, shared: e.shared, wait: e.wait, entries: [] });
      groups.get(k).entries.push(e);
    }
  }
  for (const t of tasks) {
    if (person && t.owner !== person) continue;
    const client = clients.find((c) => c.id === t.client_id);
    if (!client || !live(client)) continue;
    const dueAt = t.due_on ? endOfDayIL(dayFromKeyIL(t.due_on)) : null;
    const status = dueAt && dueAt < now ? 'overdue' : dueAt && t.due_on === dayIso(now) ? 'today' : 'open';
    groups.set(`task:${t.id}`, { key: `task:${t.id}`, client, task: t, status, dueAt, urgent: isUrgentTask(t), escalation: isEscalation(t), entries: [{ client, task: t }] });
  }
  return [...groups.values()].sort(byUrgency);
}

// "Urgent" comes before "overdue": an urgent task is done at that moment (Lior's protocol).
// Exceptions reported to Lior come right after it, urgent or not.
const bucketFor = (g, now = new Date()) => (g.urgent ? 'urgent' : g.escalation ? 'escalation' : bucketOf(g.status, g.dueAt, now));
const byReported = (a, b) => (isEscalation(b.task) - isEscalation(a.task)) || (new Date(a.task.created_at) - new Date(b.task.created_at));

// Outside the office, a mark that hands finished files on ("מוכן לבדיקה", the final
// versions) is pressed on the page where the files go up, where its lock is seen
// (app/files-logic.js uploadStepOf): here the row only points there.
// The client asked for a fix on the status page: the approval item says so, until the
// fix is done (docs/ops.md, section 48; the task of whoever fixes is in `tasks`).
const fixOf = (e) => (e.task ? null : fixTaskOf(tasks, e.client.id, e.item.key));
const entryLabel = (e) => (e.task ? e.task.title : fixOf(e) ? FIX_ITEM_LABEL : e.item.label);
const fixLine = (e) => { const t = fixOf(e); return t ? h('p', { class: 'hint fix-note' }, fixNote(t, (p) => PEOPLE[p]?.name || p)) : null; };
const viaPage = (e) => (e.task || scope === 'office' ? null : uploadStepOf(e.item.key, me, e.client.id));
function viaLine(e) {
  const via = viaPage(e);
  return via ? h('p', { class: 'hint via-page' }, via.text, ' ', h('a', { href: via.href }, 'לעמוד')) : null;
}

function nextFocusAfter(input) {
  const all = [...document.querySelectorAll('#mine-list .cbx:not(:disabled)')];
  const i = all.indexOf(input);
  return (all[i + 1] || all[i - 1])?.id || null;
}

async function toggleEntry(e, input) {
  const next = nextFocusAfter(input);
  input.disabled = true;
  try {
    if (e.task) {
      await setTaskDone(e.task.id, true);
      tasks = tasks.filter((t) => t.id !== e.task.id);
      // Ofir's folder task (24) is the item "יש תיקייה מסודרת": done together.
      const folder = folderItemOf(e.task);
      if (folder) try { (checks[e.client.id] ||= {})[folder] = await setCheck(e.client.id, folder, 'done'); states.delete(e.client.id); } catch { /* the item stays for the card */ }
    } else {
      const row = await setCheck(e.client.id, e.item.key, 'done');
      (checks[e.client.id] ||= {})[e.item.key] = row;
      states.delete(e.client.id);
      await endWaitIfComplete(e.client, e.proc);
    }
  } catch (err) {
    input.checked = false;
    input.disabled = false;
    toast(`הסימון לא נשמר. ${errorText(err)}`);
    return;
  }
  renderMine();
  if (next) document.getElementById(next)?.focus();
  toast(`סומן כבוצע: ${e.task ? e.task.title : e.item.label}`, { label: 'ביטול', run: () => undo(e) });
  offerHandoff({ client: e.client, key: e.task ? null : e.item.key, checks: () => checks[e.client.id], me, canTeam: canManageTeam({ me, scope, error: viewerError }) });
}

async function undo(e) {
  try {
    if (e.task) {
      const row = await setTaskDone(e.task.id, false);
      tasks = [row, ...tasks];
      const folder = folderItemOf(e.task);
      if (folder && checks[e.client.id]?.[folder]) try { await clearCheck(e.client.id, folder); delete checks[e.client.id][folder]; states.delete(e.client.id); } catch { /* the item stays */ }
    } else {
      await clearCheck(e.client.id, e.item.key);
      delete checks[e.client.id][e.item.key];
      states.delete(e.client.id);
      dropHandoff(e.item.key);
    }
    renderMine();
    toast('הסימון בוטל.');
  } catch (err) {
    toast(`הביטול לא נשמר. ${errorText(err)}`);
  }
}

async function claim(g, take) {
  try {
    if (take) {
      const row = await setCheck(g.client.id, CLAIM(g.proc), 'done', me);
      (checks[g.client.id] ||= {})[CLAIM(g.proc)] = row;
    } else {
      await clearCheck(g.client.id, CLAIM(g.proc));
      delete checks[g.client.id][CLAIM(g.proc)];
    }
    states.delete(g.client.id);
    renderKeepingFocus();
    toast(take ? `לקחת את תהליך ${g.proc.num} אצל ${g.client.name}.` : 'התהליך שוחרר.');
  } catch (err) {
    toast(errorText(err));
  }
}

function claimControl(g, person) {
  if (!g.shared || !person) return null;
  const others = g.proc.owners.filter((o) => o !== person).map((o) => PEOPLE[o].name).join(', ');
  if (g.claim?.person === person) {
    return h('span', { class: 'claim' }, person === me ? 'לקחת את זה' : `${PEOPLE[person].name} לקח/ה את זה`,
      person === me ? h('button', { type: 'button', class: 'btn-text', onclick: () => claim(g, false) }, 'שחרור') : null);
  }
  return h('span', { class: 'claim' }, `משותף עם ${others}`,
    person === me ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => claim(g, true) }, 'אני על זה') : null);
}

// ── Mark the whole process (spec §1) ─────────
// Offered by `me` only, never on behalf of the person being viewed.
function bulkFor(g) {
  if (!me || g.task) return null;
  const s = stateOf(g.client).states.find((x) => x.proc.id === g.proc.id);
  if (!s) return null;
  const cs = checks[g.client.id] || {};
  const items = bulkEligible(s, me, g.client, cs);
  if (items.length < 2) return null;
  const open = g.proc.items.filter((i) => !i.optional && !isResolved(i, cs[i.key]));
  return { items, whole: items.length === open.length };
}

function focusGroupAt(index) {
  const cards = [...document.querySelectorAll('#mine-list .wproc')];
  const card = cards[Math.min(index, cards.length - 1)];
  card?.querySelector('.cbx:not(:disabled), .bulk-btn, a')?.focus();
}

async function bulkMark(g, bulk, btn) {
  const c = g.client;
  const keys = bulk.items.map((i) => i.key);
  const index = [...document.querySelectorAll('#mine-list .wproc')].indexOf(btn.closest('.wproc'));
  btn.disabled = true;
  let rows;
  try {
    rows = await setChecksBulk(c.id, keys, 'done', 'בסימון כל התהליך');
  } catch (err) {
    btn.disabled = false;
    toast(`הסימון לא נשמר ולכן בוטל. אף פריט לא סומן. ${errorText(err)}`);
    return;
  }
  for (const r of rows) (checks[c.id] ||= {})[r.item_key] = r;
  states.delete(c.id);
  await endWaitIfComplete(c, g.proc);
  const cs = checks[c.id];
  // Items that were blocked stay open for a separate, deliberate check.
  const left = g.proc.items.filter((i) => !i.optional && i.owners.includes(me) && !isResolved(i, cs[i.key]));
  renderMine();
  focusGroupAt(index);
  const n = keys.length;
  const msg = left.length
    ? `סומנו ${n} פריטים. ${left.map((i) => `״${i.label}״`).join(', ')} ${left.length > 1 ? 'נשארו פתוחים' : 'נשאר פתוח'} לסימון נפרד.`
    : `סומנו ${n} פריטים בתהליך ${procLabel(g.proc)}.`;
  toast(msg, { label: 'ביטול', run: () => bulkUndo(c, keys, g) });
}

async function bulkUndo(c, keys, g) {
  try {
    await clearChecksBulk(c.id, keys);
  } catch (err) {
    toast(`הביטול לא נשמר. הפריטים נשארו מסומנים. ${errorText(err)}`);
    return;
  }
  for (const k of keys) delete checks[c.id][k];
  states.delete(c.id);
  renderMine();
  document.querySelector(`#mine-list .wproc[data-key="${CSS.escape(g.key)}"]`)?.querySelector('.bulk-btn, .cbx')?.focus();
  toast(`הסימון של ${keys.length} הפריטים בוטל.`);
}

// ── A missing detail, set right here (docs/ops.md, section 47) ──
// Process 3 stays on the list while the characterization meeting has no date (or
// nobody to run it): the card says so in one sentence, and the button opens two
// fields, the same two of the client card ("השלמת פרטים"), saved the same way
// (updateClient). Saving also marks "the meeting was set", which is what was just done.
const MEET_FIELDS = ['characterizer', 'char_at'];
const gapOf = (g) => g.entries.find((e) => e.fields) || null;
const checkable = (g) => g.entries.filter((e) => !e.fields);
const gapText = (fields) => (fields.includes('char_at') ? 'עוד לא נקבע מועד לפגישת האפיון.' : 'עוד לא נקבע מי מבצע את האפיון.');
function needLine(g) {
  const e = gapOf(g);
  if (!e) return null;
  const meeting = e.fields.every((f) => MEET_FIELDS.includes(f));
  const id = `need-${g.key}`.replace(/[^\w-]/g, '_');
  return h('div', { class: 'need wneed', role: 'note', 'data-need': e.fields.join(',') },
    h('span', {}, gapText(e.fields), scope === 'office' ? '' : ' המשרד משלים את זה בכרטיס הלקוח.'),
    scope !== 'office' ? null : meeting
      ? h('button', { type: 'button', class: 'btn btn-sm btn-primary', id, onclick: () => openMeet(g, id) }, e.fields.includes('char_at') ? 'קביעת מועד' : 'בחירת מבצע')
      : h('a', { class: 'btn btn-sm', id, href: clientUrl(g.client.id, `#${g.proc.id}`) }, 'לכרטיס הלקוח'));
}
const meetDlg = $('dlg-meet');
let meetTarget = null;
meetDlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === meetDlg) meetDlg.close(); });
function openMeet(g, focusId) {
  meetTarget = { g, focusId };
  $('meet-form').reset();
  $('meet-err').hidden = true;
  $('meet-at').removeAttribute('aria-invalid');
  $('meet-ctx').textContent = clientLabel(g.client);
  $('meet-at').value = g.client.char_at ? inputValueIL(new Date(g.client.char_at)) : '';
  $('meet-who').value = g.client.characterizer || 'ofir';
  meetDlg.showModal();
  $('meet-at').focus();
}
$('meet-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const { g, focusId } = meetTarget;
  const at = $('meet-at').value ? fromInputIL($('meet-at').value) : null;
  const person = $('meet-who').value;
  $('meet-at').setAttribute('aria-invalid', String(!at));
  if (!at || !['ofir', 'lior'].includes(person)) {
    $('meet-err').textContent = 'בחרו יום ושעה לפגישה.';
    $('meet-err').hidden = false;
    $('meet-at').focus();
    return;
  }
  $('meet-submit').disabled = true;
  const cid = g.client.id;
  try {
    const row = await updateClient(cid, { char_at: at.toISOString(), characterizer: person });
    clients = clients.map((c) => (c.id === cid ? { ...c, ...row } : c));
    states.delete(cid);
  } catch (err) {
    $('meet-err').textContent = `המועד לא נשמר. ${errorText(err)}`;
    $('meet-err').hidden = false;
    $('meet-submit').disabled = false;
    return;
  }
  // The date is saved. "The meeting was set" is marked with it; if that mark fails it
  // simply stays on the card as an item to tick.
  let marked = false;
  const item = gapOf(g)?.item;
  if (item && !isResolved(item, checks[cid]?.[item.key])) {
    try { (checks[cid] ||= {})[item.key] = await setCheck(cid, item.key, 'done'); states.delete(cid); marked = true; } catch { /* stays open on the card */ }
  }
  $('meet-submit').disabled = false;
  meetDlg.close();
  renderKeepingFocus();
  const card = `#mine-list .wproc[data-key="${CSS.escape(g.key)}"]`;
  (document.getElementById(focusId) || document.querySelector(`${card} .cbx, ${card} button`))?.focus();
  toast(`המועד נשמר: ${formatStamp(at)} · ${PEOPLE[person].name}.${marked ? ' סומן ״נקבעה פגישה״.' : ''}`);
});

// ── Waiting on the client (spec §4) ──────────
const waitDlg = $('dlg-wait');
let waitTarget = null;
waitDlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === waitDlg) waitDlg.close(); });
function openWait(g) {
  waitTarget = g;
  $('wait-form').reset();
  $('wait-err').hidden = true;
  $('wait-reason').removeAttribute('aria-invalid');
  $('wait-ctx').textContent = `${g.client.name} · תהליך ${procLabel(g.proc)}`;
  $('wait-recheck').value = dayIso(addBusinessDays(new Date(), 1));
  waitDlg.showModal();
  $('wait-reason').focus();
}
$('wait-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const g = waitTarget;
  const reason = $('wait-reason').value.trim();
  $('wait-reason').setAttribute('aria-invalid', String(!reason));
  if (!reason) {
    $('wait-err').textContent = 'כתבו בקצרה למה ממתינים, כדי שמי שבודק יידע מה לבקש מהלקוח.';
    $('wait-err').hidden = false;
    $('wait-reason').focus();
    return;
  }
  $('wait-submit').disabled = true;
  try {
    const row = await setCheck(g.client.id, WAIT(g.proc), 'done', waitNote(reason, $('wait-recheck').value || null));
    (checks[g.client.id] ||= {})[WAIT(g.proc)] = row;
    states.delete(g.client.id);
    waitDlg.close();
    renderKeepingFocus();
    toast(`תהליך ${g.proc.num} סומן כממתין ללקוח.`, { label: 'ביטול', run: () => endWait(g, true) });
  } catch (err) {
    $('wait-err').textContent = `ההמתנה לא נשמרה. ${errorText(err)}`;
    $('wait-err').hidden = false;
  } finally {
    $('wait-submit').disabled = false;
  }
});

// Puts a check back as it was before (or removes it): undo and rollback.
async function restoreCheck(cid, key, row) {
  const cs = (checks[cid] ||= {});
  if (row) cs[key] = await setCheck(cid, key, row.state, row.note ?? null);
  else { await clearCheck(cid, key); delete cs[key]; }
}

// Ending a wait stops the client's clock: its office minutes are added to the
// process's waited time first, and the deadline moves on by them (decision 3).
// Undoing a wait that was just marked adds nothing.
async function endWait(g, isUndo = false) {
  const cid = g.client.id;
  const cs = (checks[cid] ||= {});
  const prev = cs[WAIT(g.proc)];
  const prevWaited = cs[WAITED(g.proc)];
  const since = waitOf(g.proc, cs)?.at || null;
  let ended = null;
  try {
    if (!isUndo) ended = cs[WAITED(g.proc)] = await setCheck(cid, WAITED(g.proc), 'done', endWaitNote(g.client, g.proc, cs));
    await clearCheck(cid, WAIT(g.proc));
  } catch (err) {
    if (!isUndo) await restoreCheck(cid, WAITED(g.proc), prevWaited).catch(() => {});
    toast(`${isUndo ? 'הביטול' : 'סיום ההמתנה'} לא נשמר. ${errorText(err)}`);
    return;
  }
  delete cs[WAIT(g.proc)];
  states.delete(cid);
  renderKeepingFocus();
  if (isUndo) { toast('הסימון בוטל.'); return; }
  toast(endWaitText(prevWaited?.note, ended?.note), {
    label: 'ביטול',
    // The waited time goes back first, then the wait; if the wait cannot be
    // restored, the finished wait's minutes are kept (never counted twice or lost).
    run: async () => {
      try {
        await restoreCheck(cid, WAITED(g.proc), prevWaited);
      } catch (err) { toast(`הביטול לא נשמר. ${errorText(err)}`); return; }
      try {
        const p = parseWaitNote(prev?.note);
        cs[WAIT(g.proc)] = await setCheck(cid, WAIT(g.proc), 'done', waitNote(p.reason, p.recheck, since));
        toast('ההמתנה חזרה.');
      } catch (err) {
        await restoreCheck(cid, WAITED(g.proc), ended).catch(() => {});
        toast(`הביטול לא נשמר. ${errorText(err)}`);
      }
      states.delete(cid);
      renderKeepingFocus();
    },
  });
}

// A process completed from "my work" no longer waits on the client: the wait
// ends at the completion and its office minutes are kept (as on the client card).
async function endWaitIfComplete(c, proc) {
  const cs = checks[c.id] || {};
  if (!cs[WAIT(proc)]) return;
  states.delete(c.id);
  if (!stateOf(c).states.find((x) => x.proc.id === proc.id)?.complete) return;
  const prevWaited = cs[WAITED(proc)];
  try { cs[WAITED(proc)] = await setCheck(c.id, WAITED(proc), 'done', endWaitNote(c, proc, cs)); } catch { return; /* the wait stays and counts until completion */ }
  try {
    await clearCheck(c.id, WAIT(proc));
    delete cs[WAIT(proc)];
  } catch {
    await restoreCheck(c.id, WAITED(proc), prevWaited).catch(() => {}); // the wait still counts until completion
  }
  states.delete(c.id);
}

function waitLine(wait, id) {
  if (!wait) return null;
  return h('p', { class: 'wait-line', id },
    `ממתין ללקוח מאז ${formatStamp(wait.at)}`,
    wait.by_email ? ` · ${who(wait.by_email)}` : '',
    wait.reason ? ` · ״${wait.reason}״` : '',
    wait.recheck ? ` · לבדוק שוב: ${dayShort(wait.recheck)}` : '',
    recheckDue(wait) ? h('span', { class: 'tag tag-warn' }, 'הגיע מועד הבדיקה') : null);
}

// Who opened an urgent task or reported an exception, and since when.
function taskMeta(t, now = new Date()) {
  if (!(isUrgentTask(t) || isEscalation(t)) || !t.created_at) return null;
  const by = t.created_by_email ? who(t.created_by_email) : '';
  return h('p', { class: 'task-meta' },
    `${isEscalation(t) ? 'דווח' : 'נפתח'}${by ? ` ע״י ${by}` : ''} · ${formatStamp(t.created_at)} · לפני ${lateBy(new Date(t.created_at), now)}`);
}

// ── The short list (the phone review of 4.10.2026) ──
// "המשימות שלי" is short by default: a card per client and process with the client, the
// action, the deadline in words and ONE action; the checklist, "ממתין ללקוח", the
// shared-process claim and the exact deadline open with a tap ("פירוט"). Every group
// shows its first MINE_CAP cards and "הצג עוד". "תצוגה מלאה" (kept per browser) gives
// the whole list, as it was. Nothing is removed, only folded.
const MINE_CAP = 5;
const fullView = () => store.get('mine.full') === 'on';
const openCards = new Set();   // cards whose details are open: kept across rebuilds
function viewToggle() {
  const full = fullView();
  return h('div', { class: 'view-toggle', role: 'group', 'aria-label': 'אורך הרשימה' },
    ...[['off', 'תצוגה קצרה'], ['on', 'תצוגה מלאה']].map(([v, label]) => h('button', {
      type: 'button', class: 'chip', id: `mine-view-${v}`, 'aria-pressed': String((full ? 'on' : 'off') === v),
      onclick: () => { store.set('mine.full', v); renderMine(); document.getElementById(`mine-view-${v}`)?.focus(); },
    }, label)));
}
// The deadline in words: "באיחור 3 ימי עסקים", "היום עד 14:00", "מחר", "עד יום ה׳, 22.10".
function whenWords(g, now = new Date()) {
  if (g.status === 'overdue' && g.dueAt) return `באיחור ${lateBy(g.dueAt, now)}`;
  if (g.status === 'client') return 'ממתין ללקוח';
  if (!g.dueAt) return g.urgent ? 'עכשיו' : '';
  const w = formatWhen(g.dueAt, now);
  return /^(היום|מחר)$/.test(w) ? w : /^(היום|מחר) /.test(w) ? w.replace(' ', ' עד ') : `עד ${w}`;
}

function compactCard(g, person) {
  const href = clientUrl(g.client.id, g.proc ? `#${g.proc.id}` : '#tasks');
  const owners = g.task ? [g.task.owner] : [...new Set(g.entries.flatMap((e) => e.item.owners))];
  const bulk = bulkFor(g);
  const safe = g.key.replace(/[^\w-]/g, '_');
  const waitId = `wl-${safe}`;
  const panelId = `wd-${safe}`;
  const canWait = !g.task && !g.proc.recurring && (scope === 'office' || CLIENT_PROCS.has(baseId(g.proc)));
  // An entry that waits for a detail of the client is not a tick: it is the line above the items.
  const ticks = checkable(g);
  const need = needLine(g);
  const n = ticks.length;
  const one = n === 1 && !need;
  const shortcut = g.proc ? intakeShortcut(g.proc.id, g.client.id, { checks: checks[g.client.id] || {}, scope, me }) : null;
  const start = g.task && g.urgent ? taskStart(g.task) : null;
  const needsStart = !!start?.querySelector('button');
  // The action in words: the task, or the process (a single item is named by its own check).
  const what = g.task ? g.task.title : procLabel(g.proc);
  const sub = g.task ? [isEscalation(g.task) ? null : 'משימה', TASK_SOURCES[g.task.source]].filter(Boolean).join(' · ') : one || !n ? '' : n === 1 ? 'פריט אחד לסימון' : `${n} פריטים לסימון`;
  const rows = () => h('ul', { class: 'wlist' }, ...ticks.map((e) => {
    const id = `w-${e.client.id}-${e.task ? e.task.id : e.item.key}`.replace(/[^\w-]/g, '_');
    return h('li', { class: `witem${e.task && briefDetails(e.task) ? ' has-brief' : ''}` },
      h('label', { class: 'wrow', for: id },
        h('input', { type: 'checkbox', id, class: 'cbx fin', disabled: !!viaPage(e), onchange: (ev) => toggleEntry(e, ev.currentTarget) }),
        h('span', { class: 'wlabel' }, entryLabel(e))),
      viaLine(e),
      fixLine(e),
      e.task ? briefDetails(e.task) : null);
  }));
  // The one action: "התחלתי" on an urgent task; the form the process is worked in; the
  // single item's own check; or the list of items, which opens here.
  const listIsAction = !needsStart && !shortcut && !one && n > 0;
  const single = !needsStart && !shortcut && one;
  if (shortcut) shortcut.classList.add('wc-go');
  const extras = [
    g.dueAt ? h('p', { class: 'wc-due num' }, `יעד: ${formatWhen(g.dueAt)}`) : null,
    !person ? peopleChips(owners) : null,
    claimControl(g, person),
    g.task ? taskMeta(g.task) : null,
    g.status === 'client' ? waitLine(g.wait, waitId) : null,
    bulk || canWait ? h('div', { class: 'wproc-acts' },
      bulk ? h('button', {
        type: 'button', class: 'btn btn-sm btn-ghost bulk-btn',
        'aria-label': `סימון ${bulk.items.length} פריטים כבוצעו בתהליך ${procLabel(g.proc)}`,
        onclick: (ev) => bulkMark(g, bulk, ev.currentTarget),
      }, bulk.whole ? `סימון כל התהליך כבוצע (${bulk.items.length})` : `סימון כל הפריטים שלי כבוצעו (${bulk.items.length})`) : null,
      canWait && g.status !== 'client' ? h('button', { type: 'button', class: 'btn-text', onclick: () => openWait(g) }, 'ממתין ללקוח') : null,
      canWait && g.status === 'client' ? h('button', { type: 'button', class: 'btn-text', onclick: () => endWait(g) }, 'סיום המתנה') : null) : null,
    single || !n ? null : rows(),
  ].filter(Boolean);
  const open = openCards.has(g.key);
  const panel = extras.length ? h('div', { class: 'wc-panel', id: panelId, hidden: !open }, ...extras) : null;
  const toggle = (label, cls) => h('button', {
    type: 'button', class: cls, 'aria-expanded': String(open), 'aria-controls': panelId,
    'aria-label': `${label}: ${g.client.name}, ${what}`,
    onclick: (ev) => {
      const now = panel.hidden;
      panel.hidden = !now;
      if (now) openCards.add(g.key); else openCards.delete(g.key);
      for (const b of ev.currentTarget.closest('.wproc').querySelectorAll('[aria-controls]')) b.setAttribute('aria-expanded', String(now));
      if (now) panel.querySelector('.cbx:not(:disabled), button, a')?.focus();
    },
  }, label);
  const when = whenWords(g);
  return h('li', { class: `wproc wc s-${g.status}${g.urgent || g.escalation ? ' is-urgent' : ''}`, 'data-key': g.key },
    h('div', { class: 'wc-head', 'aria-describedby': g.wait ? waitId : null },
      h('a', { class: 'wclient', href }, clientLabel(g.client)),
      isAuto(g.client) ? h('span', { class: 'auto-tag' }, 'חדש') : null,
      g.task ? taskBadge(g.task) : null,
      when ? h('span', { class: `wc-when s-${g.status}` }, when) : null),
    h('div', { class: 'wc-what' },
      // A single task is named by its own check below; its kind is the line here.
      h('p', { class: 'wc-title' }, single && g.task ? h('span', { class: 'wc-sub' }, sub || 'משימה') : [what, sub ? h('span', { class: 'wc-sub' }, ` · ${sub}`) : null]),
      panel && !listIsAction ? toggle('פירוט', 'btn-text wc-more') : null),
    need, // a detail of the client that is still missing, set from here
    start, // "התחלתי", or when it was pressed
    shortcut,
    single ? rows() : null,
    listIsAction ? toggle(`הצגת הפריטים (${n})`, 'btn btn-sm wc-go wc-open') : null,
    panel);
}

function groupCard(g, person) {
  if (!fullView()) return compactCard(g, person);
  // A reported exception is named by its badge; its reason is the task's own title below.
  const title = g.task ? (isEscalation(g.task) ? null : ['משימה', TASK_SOURCES[g.task.source]].filter(Boolean).join(' · ')) : procLabel(g.proc);
  const href = clientUrl(g.client.id, g.proc ? `#${g.proc.id}` : '#tasks');
  const owners = g.task ? [g.task.owner] : [...new Set(g.entries.flatMap((e) => e.item.owners))];
  const bulk = bulkFor(g);
  const waitId = `wl-${g.key}`.replace(/[^\w-]/g, '_');
  // 'own' roles mark a wait only where the client is part of their work (approvals, corrections).
  const canWait = !g.task && !g.proc.recurring && (scope === 'office' || CLIENT_PROCS.has(baseId(g.proc)));
  return h('li', { class: `wproc s-${g.status}${g.urgent || g.escalation ? ' is-urgent' : ''}`, 'data-key': g.key },
    h('div', { class: 'wproc-h', 'aria-describedby': g.wait ? waitId : null },
      h('a', { class: 'wclient', href }, clientLabel(g.client)),
      isAuto(g.client) ? h('span', { class: 'auto-tag' }, 'חדש') : null,
      g.task ? taskBadge(g.task) : null,
      title ? h('span', { class: 'wtitle' }, title) : null,
      person ? null : peopleChips(owners),
      g.dueAt ? h('span', { class: 'num' }, `יעד: ${formatWhen(g.dueAt)}`) : null,
      statusBadge(g.status, g.dueAt),
      claimControl(g, person)),
    g.task ? taskMeta(g.task) : null,
    g.task && g.urgent ? taskStart(g.task) : null,
    needLine(g),
    g.proc ? intakeShortcut(g.proc.id, g.client.id, { checks: checks[g.client.id] || {}, scope, me }) : null,
    g.status === 'client' ? waitLine(g.wait, waitId) : null,
    bulk || canWait ? h('div', { class: 'wproc-acts' },
      bulk ? h('button', {
        type: 'button', class: 'btn btn-sm btn-ghost bulk-btn',
        'aria-label': `סימון ${bulk.items.length} פריטים כבוצעו בתהליך ${procLabel(g.proc)}`,
        onclick: (ev) => bulkMark(g, bulk, ev.currentTarget),
      }, bulk.whole ? `סימון כל התהליך כבוצע (${bulk.items.length})` : `סימון כל הפריטים שלי כבוצעו (${bulk.items.length})`) : null,
      canWait && g.status !== 'client' ? h('button', { type: 'button', class: 'btn-text', onclick: () => openWait(g) }, 'ממתין ללקוח') : null,
      canWait && g.status === 'client' ? h('button', { type: 'button', class: 'btn-text', onclick: () => endWait(g) }, 'סיום המתנה') : null) : null,
    h('ul', { class: 'wlist' }, ...checkable(g).map((e) => {
      const id = `w-${e.client.id}-${e.task ? e.task.id : e.item.key}`.replace(/[^\w-]/g, '_');
      return h('li', { class: `witem${e.task && briefDetails(e.task) ? ' has-brief' : ''}` },
        h('label', { class: 'wrow', for: id },
          h('input', { type: 'checkbox', id, class: 'cbx fin', disabled: !!viaPage(e), onchange: (ev) => toggleEntry(e, ev.currentTarget) }),
          h('span', { class: 'wlabel' }, entryLabel(e))),
        viaLine(e),
        fixLine(e),
        e.task ? briefDetails(e.task) : null);
    })));
}

// An urgent task: "התחלתי" within 30 office minutes, or it goes back to Lior
// (decision 9; the reminder engine watches started_at, stamped by the database).
function taskStart(t) {
  if (!('started_at' in t)) return null; // before migration 20260930110001
  if (t.started_at) return h('p', { class: 'task-start' }, `${t.owner === me ? 'התחלת' : 'התחיל/ה'} ${formatStamp(t.started_at)}`);
  if (t.owner !== me) return null;
  return h('p', { class: 'task-start' },
    h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: (ev) => startTask(t, ev.currentTarget) }, 'התחלתי'),
    h('span', { class: 'hint' }, 'בלי ״התחלתי״ תוך 30 דקות עבודה, המשימה עוברת לליאור.'));
}
async function startTask(t, btn) {
  btn.disabled = true;
  try {
    Object.assign(t, await setTaskStarted(t.id, true));
  } catch (err) {
    btn.disabled = false;
    toast(`הסימון לא נשמר. ${errorText(err)}`);
    return;
  }
  renderKeepingFocus();
  toast(`נרשם שהתחלת: ${t.title}`);
}

const BUCKETS = [['urgent', 'דחוף'], ['escalation', 'חריגות שדווחו'], ['overdue', 'באיחור'], ['today', 'היום'], ['tomorrow', 'מחר'], ['week', 'השבוע'], ['later', 'בהמשך'], ['client', 'ממתין ללקוח']];

// Clients the signing trigger opened, shown to Irit and to the whole-team view (spec §10).
function autoBanner() {
  const list = clients.filter(isAuto).sort((a, b) => new Date(b.deal_at) - new Date(a.deal_at));
  if (!list.length) return null;
  const now = new Date();
  return h('div', { class: 'auto-banner', role: 'status' },
    ...list.slice(0, 3).map((c) => {
      const q = quoteInfo.get(c.quote_id);
      const at = q?.signed_at || c.created_at;
      return h('p', {},
        `לקוח חדש נפתח אוטומטית: ${c.name}`,
        q ? [' · הסכם ', h('bdi', { class: 'num', dir: 'ltr' }, q.number)] : null,
        `${at ? ` · לפני ${lateBy(new Date(at), now)}` : ''} `,
        h('a', { href: clientUrl(c.id) }, 'לכרטיס'));
    }),
    list.length > 3 ? h('p', { class: 'muted' }, `ועוד ${list.length - 3}`) : null);
}

// ── Coming up: not checkable yet ─────────────
// Processes of the person with a known start in the next 30 days, one card per
// client and shoot round. For the photographer these are the coming shoot days.
// A process of the shoot day itself (in any round), not one that merely starts from it.
const SHOOT_DAY = new Set(PROCESSES.filter((p) => p.phase === 'shoot').map((p) => p.id));
const onShootDay = (proc) => SHOOT_DAY.has(proc.id.replace(/^r\d+-/, ''));
function upcomingGroups(person, now = new Date()) {
  const groups = new Map();
  for (const c of clients) {
    for (const s of upcomingFor(person, c, stateOf(c), now)) {
      const round = Number(roundOf(s.proc) || 1);
      const k = `${c.id}:${round}`;
      if (!groups.has(k)) groups.set(k, { key: k, client: c, round, shootAt: null, startAt: s.startAt, list: [] });
      const g = groups.get(k);
      g.list.push(s);
      if (s.startAt < g.startAt) g.startAt = s.startAt;
      if (onShootDay(s.proc)) g.shootAt = parseDate((s.proc.ctx || c).shoot_at);
    }
  }
  return [...groups.values()].sort((a, b) => a.startAt - b.startAt);
}

function upcomingCard(g) {
  return h('li', { class: 'wproc s-waiting soon-card', 'data-key': `soon:${g.key}` },
    h('div', { class: 'wproc-h' },
      h('a', { class: 'wclient', href: clientUrl(g.client.id, `#${g.list[0].proc.id}`) }, clientLabel(g.client)),
      h('span', { class: 'wtitle' }, [g.shootAt ? 'יום צילום' : null, g.round > 1 ? `סבב ${g.round}` : null].filter(Boolean).join(' · ') || 'מתחיל בקרוב'),
      h('span', { class: 'num' }, g.shootAt ? `הגעת המשפיענים: ${formatWhen(g.shootAt)}` : `מתחיל: ${formatWhen(g.startAt)}`)),
    g.shootAt && g.client.address ? h('p', { class: 'task-meta' }, `כתובת: ${g.client.address}`) : null,
    h('ul', { class: 'soon-list' }, ...g.list.map((s) => h('li', {},
      h('span', {}, `${s.proc.num} · ${s.proc.title}`), ' ', h('span', { class: 'muted num' }, `· מתחיל ${formatWhen(s.startAt)}`)))));
}

// Open for 'own' views (it is often all they have this week); folded in the office.
function upcomingSection(list, open) {
  if (!list.length) return null;
  const title = 'בקרוב · עוד אין מה לסמן';
  const n = h('span', { class: 'n' }, String(list.length));
  const body = h('ul', { class: 'wprocs' }, ...list.map(upcomingCard));
  if (!fullView()) capList(body, MINE_CAP, 'mine:soon');
  if (open) return h('section', { class: 'wgroup g-soon', 'aria-label': title }, h('h2', { class: 'wgroup-h' }, title, n), body);
  return h('details', { class: 'wgroup g-soon' }, h('summary', { class: 'wgroup-h' }, title, n), body);
}

// The one line at the top of "המשימות שלי" while I have old clients to take in, and
// under the list what I left open on clients still in landing (no clock, no colour).
function renderLanding(flow = []) {
  const now = new Date();
  const line = $('land-line');
  const quiet = $('land-quiet');
  const mine = !!me;
  const list = mine && intake.ready ? intakeFor(me, clients, checks, intake.marks, intake.done, now) : [];
  const left = intakeLeft(list);
  // The owners: how many are still in landing, and where they activate.
  const total = !me && scope === 'office' && !viewerError ? landingBoard(clients, checks, intake.marks, intake.done, now).total : 0;
  // Work that waits for me on the clients still in landing, each a counted line to the
  // page it is done on: said plainly, with no clock and no colour (section 46).
  const quietLines = flow.filter((f) => f.bucket === 'landing');
  line.hidden = !left && !total && !quietLines.length;
  fill(line, left ? h('a', { class: 'land-line', href: 'landing.html' },
    h('strong', {}, left === 1 ? 'יש לקוח קיים אחד לקלוט' : `יש ${left} לקוחות קיימים לקלוט`), h('span', {}, 'לקליטה'))
    : total ? h('a', { class: 'land-line', href: 'owner.html#landing' },
      h('strong', {}, total === 1 ? 'לקוח קיים אחד עדיין בקליטה' : `${total} לקוחות קיימים עדיין בקליטה`), h('span', {}, 'להפעלה')) : null,
    ...quietLines.map((f) => h('a', { class: 'land-line flow-line is-landing', id: `flow-${f.id}`, 'data-flow': f.id, href: f.href }, h('strong', {}, f.text), h('span', {}, f.cta))));
  const rest = mine ? quietWork(me, clients, checks, intake.marks, intake.done, now) : [];
  const n = rest.reduce((sum, x) => sum + x.items.length, 0);
  quiet.hidden = !n;
  fill(quiet, n ? h('details', { class: 'wgroup g-landing' },
    h('summary', { class: 'wgroup-h' }, 'בקליטה · בלי שעון', h('span', { class: 'n' }, String(n))),
    h('p', { class: 'hint' }, 'פריטים שאמרת שעדיין פתוחים, בלקוחות שעוד לא הופעלו. אפשר לעבוד עליהם ולסמן בכרטיס הלקוח; המועד יתחיל ביום ההפעלה.'),
    h('ul', { class: 'land-quiet-list' }, ...rest.map((x) => h('li', {},
      h('a', { class: 'wclient', href: clientUrl(x.client.id) }, clientLabel(x.client)),
      h('ul', {}, ...x.items.map((i) => h('li', {}, i.label))))))) : null);
}

// One counted line of work that is done on another page: what waits and how many. The
// whole row is the link to the place (one sentence, 44px and up).
function flowCard(f) {
  return h('li', { class: 'wproc flow-card', 'data-flow': f.id },
    h('a', { class: 'flow-line', id: `flow-${f.id}`, href: f.href }, h('strong', {}, f.text), h('span', { class: 'flow-go' }, f.cta)));
}

function renderMine() {
  const wrap = $('mine-list');
  const own = scope === 'own';
  rebuildClocks();
  paintNowBar();
  // What waits for me on another page (app/mine-flow.js): on my own list only.
  const showsMine = !!me && (own || personal || (minePerson || null) === me);
  const flow = showsMine ? flowLines({ viewer: { me, scope, error: viewerError }, clients, checks, stateOf, tasks, reviews, extra: flowExtra, now: new Date() }) : [];
  renderLanding(flow);
  if (own && !me) {
    $('mine-people').hidden = true;
    fill($('mine-people'));
    fill($('mine-tools'));
    fill($('mine-foot'));
    fill(wrap, h('p', { class: 'empty' }, viewerError ? VIEWER_UNKNOWN : 'לא הוגדר לך תפקיד בפרוטוקול, ולכן אין כאן רשימה. פנו למנהל המערכת.'));
    return;
  }
  // The personal profile of an owner: the cards above are what waits for them; the whole
  // team's list stays closed in one line until asked for (nothing is taken away).
  if (personal && !me) {
    $('mine-people').hidden = true;
    fill($('mine-people'));
    fill($('mine-tools'));
    fill($('mine-foot'));
    $('my-months').hidden = true;
    const n = workFor(null).length;
    fill(wrap, h('p', { class: 'team-fold', id: 'team-fold' },
      h('span', {}, n ? `עבודת הצוות: ${n} פתוחים.` : 'עבודת הצוות: אין כרגע פריטים פתוחים.'),
      h('a', { class: 'btn btn-sm', id: 'team-open', href: '#team' }, 'הצגת עבודת הצוות')));
    return;
  }
  // An 'own' view is always the signed-in person's; the office can show anyone's. In the
  // personal profile the list is the person's own, and the others' are one tap away (#team).
  const mineOnly = own || personal;
  const person = mineOnly ? me : minePerson || null;
  $('mine-people').hidden = mineOnly;
  if (mineOnly) {
    fill($('mine-people'));
  } else {
    const opts = [...STAFF_PEOPLE().map((p) => [p.key, p.key === me ? `${p.name} (אני)` : p.name]), ['', 'כל הצוות']];
    const count = (k) => workFor(k || null).length;
    fill($('mine-people'),
      h('div', { class: 'chips-row wide-only' }, ...opts.map(([k, label]) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String((minePerson || '') === k),
        onclick: () => { minePerson = k; renderMine(); },
      }, label, h('span', { class: 'n' }, String(count(k)))))),
      h('label', { class: 'narrow-only person-select' }, h('span', {}, 'מציג:'),
        h('select', { class: 'input', id: 'mine-select', onchange: (ev) => { minePerson = ev.currentTarget.value; renderMine(); } },
          ...opts.map(([k, label]) => h('option', { value: k, selected: (minePerson || '') === k }, `${label} (${count(k)})`)))));
  }
  const full = fullView();
  $('mine-list').classList.toggle('is-short', !full);
  // The morning summary and the browser notifications fold on a short list.
  const tools = [!own && person ? summaryActions(person, 'mine') : null, person && person === me && !pushActive() ? notifyRow() : null].filter(Boolean);
  fill($('mine-tools'), full ? tools : null);
  // Under the list: the length of the list, and on a short one the tools.
  fill($('mine-foot'), tools.length && !full ? h('details', { class: 'mine-more' }, h('summary', {}, 'סיכום בוקר והתראות'), ...tools) : null, viewToggle(),
    mineOnly && !own ? h('a', { class: 'btn-text', id: 'team-open', href: '#team' }, 'הרשימה של עובד אחר') : null);
  showMonths($('my-months'), { person, me, office: worksCycle({ me, scope, error: viewerError }), clients, stateOf, checks, short: !full });

  const nothing = person === me ? 'אין כרגע משהו פתוח אצלך.' : person ? `אין כרגע משהו פתוח אצל ${PEOPLE[person].name}.` : 'אין כרגע פריטים פתוחים.';
  // With no client at all the list is still not empty when something waits on another
  // page (a contract out for signature is there before its client exists; section 47).
  if (!clients.length && !flow.some((f) => f.bucket !== 'landing')) {
    fill(wrap, h('p', { class: 'empty' }, own ? nothing : 'עדיין אין לקוחות. לקוח חדש נפתח בכפתור ״לקוח חדש״.'));
    return;
  }
  // Ilai: the characterization day's card (and the rest of his graphics, the final
  // versions, the Gantt) comes first and replaces the process groups it covers.
  const ilaiCtx = person === 'ilai' ? { clients, checks, stateOf, me, viewer: { me, scope, error: viewerError }, refresh: () => { if (view === 'mine' && !busy()) renderKeepingFocus(); } } : null;
  const ilai = ilaiCtx ? ilaiSection(ilaiCtx) : null;
  const covered = ilaiCtx ? coveredByCard(ilaiCtx) : () => false;
  if (ilai && !full) capList(ilai.querySelector('.il-list'), MINE_CAP, 'mine:ilai');
  const list = workFor(person).filter((g) => !covered(g));
  const soon = person ? upcomingSection(upcomingGroups(person), own) : null;
  const review = person ? OFFICE_REVIEWS.find((r) => r.owner === person && reviewPending(r)) : null;
  const thursday = person === 'ofir' ? thursdayCard() : null;
  const banner = !person || person === 'irit' ? autoBanner() : null;
  // The counted lines with a clock sit in the group of their urgency, before its cards.
  const flowIn = (k) => flow.filter((f) => f.bucket === k).map(flowCard);
  if (!list.length && !review && !thursday && !flow.some((f) => f.bucket !== 'landing')) {
    fill(wrap, banner, ilai, ilai ? null : h('p', { class: 'empty' }, nothing), soon);
    return;
  }
  const today = dayIso(new Date());
  // A short list: each group shows its first cards and "הצג עוד" (kept per person and group).
  const cap = (ul, k) => (full ? ul : capList(ul, MINE_CAP, `mine:${person || 'all'}:${k}`));
  // Thursday's pass is a fixed card of its own, right after urgent work.
  const thuGroup = thursday ? h('section', { class: 'wgroup g-thu', 'aria-label': 'מעבר חובה של יום חמישי' }, h('ul', { class: 'wprocs' }, thursday)) : null;
  fill(wrap, banner, ilai, ...BUCKETS.flatMap(([k, title]) => [k === 'overdue' ? thuGroup : null, k === 'client' ? soon : null, (() => {
    let g = list.filter((x) => bucketFor(x) === k);
    if (k === 'urgent' || k === 'escalation') g = g.sort(byReported);
    const extra = [...(k === 'client' ? [] : flowIn(k)), ...(k === 'today' && review ? [reviewCard(review)] : [])];
    if (!g.length && !extra.length) return null;
    if (k === 'client') {
      // What reached its recheck day first, then the longest wait.
      g = g.sort((a, b) => (recheckDue(b.wait, today) - recheckDue(a.wait, today)) || (new Date(a.wait?.at || 0) - new Date(b.wait?.at || 0)));
      if (waitGroupOpen === null) waitGroupOpen = !window.matchMedia('(max-width: 760px)').matches;
      return h('details', {
        class: 'wgroup g-client', open: waitGroupOpen,
        ontoggle: (ev) => { waitGroupOpen = ev.currentTarget.open; },
      },
      h('summary', { class: 'wgroup-h' }, title, h('span', { class: 'n' }, String(g.length))),
      cap(h('ul', { class: 'wprocs' }, ...g.map((x) => groupCard(x, person))), k));
    }
    // On a short list what is not for today or tomorrow waits folded, one tap away.
    if (!full && (k === 'week' || k === 'later')) {
      return h('details', { class: `wgroup g-${k}`, open: laterOpen.has(k), ontoggle: (ev) => { if (ev.currentTarget.open) laterOpen.add(k); else laterOpen.delete(k); } },
        h('summary', { class: 'wgroup-h' }, title, h('span', { class: 'n' }, String(g.length + extra.length))),
        cap(h('ul', { class: 'wprocs' }, ...extra, ...g.map((x) => groupCard(x, person))), k));
    }
    return h('section', { class: `wgroup g-${k}`, 'aria-label': title },
      h('h2', { class: 'wgroup-h' }, k === 'urgent' || k === 'escalation' ? [h('span', { class: 'sicon', 'aria-hidden': 'true' }), title] : title,
        h('span', { class: 'n' }, String(g.length + extra.length))),
      cap(h('ul', { class: 'wprocs' }, ...extra, ...g.map((x) => groupCard(x, person))), k));
  })()]));
}

// ── Morning summary via WhatsApp (spec §6a) ──
const listUrl = () => new URL('clients.html#mine', location.href).href;
const PER_SECTION = 8;

function personSummary(person, now = new Date()) {
  const name = PEOPLE[person].name;
  const w = workFor(person);
  const procs = w.filter((g) => !g.task);
  const today = dayIso(now);
  const until = (d) => { const p = partsIL(d); return p.hour === 23 && p.minute === 59 ? 'עד סוף היום' : `עד ${hm(d)}`; };
  const line = (g) => `${g.client.name} · ${procLabel(g.proc, ' ')}`;
  const taskLine = (g) => `${isEscalation(g.task) ? 'חריגה שדווחה: ' : ''}${g.client.name} · ${g.task.title}${g.dueAt ? ` · עד ${dm(g.dueAt)}` : ''}`;
  const sections = [
    ['דחוף', w.filter((g) => g.urgent).sort(byReported), taskLine],
    ['חריגות שדווחו', w.filter((g) => g.escalation && !g.urgent).sort(byReported), taskLine],
    ['באיחור', procs.filter((g) => g.status === 'overdue'), (g) => `${line(g)} · באיחור ${lateBy(g.dueAt, now)}`],
    ['היום', procs.filter((g) => bucketOf(g.status, g.dueAt, now) === 'today'), (g) => (g.dueAt ? `${line(g)} · ${until(g.dueAt)}` : line(g))],
    ['מחר', procs.filter((g) => bucketOf(g.status, g.dueAt, now) === 'tomorrow'), line],
    ['ממתין ללקוח, לבדוק היום', procs.filter((g) => g.status === 'client' && recheckDue(g.wait, today)), (g) => `${line(g)}${g.wait?.reason ? ` · ${g.wait.reason}` : ''}`],
    ['משימות', w.filter((g) => g.task && !g.urgent && !g.escalation).sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity)), taskLine],
  ].filter(([, list]) => list.length);
  // Ofir's Thursday pass over every client (process 33).
  const pass = person === 'ofir' ? thursdayPass(now) : null;
  if (pass) sections.unshift(['מעבר חובה של יום חמישי', [pass], () => `סיכום מצב לכל הלקוחות: סוכמו ${pass.done} מתוך ${pass.total}`]);
  const head = `בוקר טוב ${name},`;
  if (!sections.length) {
    return [head, 'אין לך היום תהליכים באיחור, להיום או למחר. יום טוב.', `הרשימה המלאה: ${listUrl()}`].join('\n');
  }
  let cut = 0;
  const body = sections.flatMap(([title, list, fmt]) => {
    cut += Math.max(0, list.length - PER_SECTION);
    return [`${title} (${list.length}):`, ...list.slice(0, PER_SECTION).map((g) => `- ${fmt(g)}`)];
  });
  return [head, `הסיכום שלך ל${weekdayLong.format(now)} ${dm(now)}:`, '', ...body, '',
    ...(cut ? [`ועוד ${cut} ברשימה המלאה.`] : []), `הרשימה המלאה: ${listUrl()}`].join('\n');
}

function lateProcsOf(c) {
  return stateOf(c).states.filter((x) => x.status === 'overdue' && (c.status !== 'ended' || x.proc.id === 'p35'));
}
function waitingProcsOf(c) {
  return stateOf(c).states.filter((x) => x.status === 'client' && (c.status !== 'ended' || x.proc.id === 'p35'));
}

function teamSummary(now = new Date()) {
  const lines = [`סיכום בוקר, ${weekdayLong.format(now)} ${dm(now)}:`];
  for (const p of STAFF_PEOPLE()) {
    const w = workFor(p.key);
    const urgent = w.filter((g) => g.urgent).length;
    lines.push(`${p.name}: ${urgent ? `דחוף ${urgent} · ` : ''}באיחור ${w.filter((g) => g.status === 'overdue').length} · להיום ${w.filter((g) => bucketFor(g, now) === 'today').length}`);
  }
  const esc = openEscalations();
  if (esc.length) {
    lines.push(`חריגות פתוחות אצל ליאור (${esc.length}):`, ...esc.slice(0, PER_SECTION).map(({ c, t }) => `- ${c.name} · ${t.title}`));
    if (esc.length > PER_SECTION) lines.push(`ועוד ${esc.length - PER_SECTION} ברשימה המלאה.`);
  }
  const late = clients.filter(live).flatMap((c) => lateProcsOf(c).map((x) => ({ c, x })));
  if (late.length) {
    lines.push('באיחור אצלנו:', ...late.slice(0, PER_SECTION).map(({ c, x }) => `- ${c.name} · ${procLabel(x.proc, ' ')} · ${namesOf(peopleOf(x))}`));
    if (late.length > PER_SECTION) lines.push(`ועוד ${late.length - PER_SECTION} ברשימה המלאה.`);
  }
  const waiting = clients.filter((c) => live(c) && waitingProcsOf(c).length).length;
  if (waiting) lines.push(`ממתינים ללקוח: ${waiting} לקוחות`);
  return lines.join('\n');
}

const openedKey = (person) => `summary.${person}.${dayIso(new Date())}`;
function summaryActions(person, where) {
  const text = () => (person === 'team' ? teamSummary() : personSummary(person));
  const label = person === 'team' ? 'סיכום לכל הצוות ב־WhatsApp' : where === 'mine' ? 'שליחת סיכום בוקר ב־WhatsApp' : 'סיכום בוקר ב־WhatsApp';
  const link = h('a', {
    class: where === 'row' ? 'btn-text wa-link' : 'btn btn-sm wa-link', href: whatsappLink('', text()), target: '_blank', rel: 'noopener',
    'aria-label': person === 'team' || where === 'mine' ? null : `סיכום בוקר ב־WhatsApp ל${PEOPLE[person].name}`,
    onclick: (ev) => {
      ev.currentTarget.href = whatsappLink('', text()); // fresh at the moment of the click
      store.set(openedKey(person), new Date().toISOString());
      toast('WhatsApp נפתח עם הסיכום. השליחה עצמה נעשית שם.');
      if (view === 'control') setTimeout(() => { if (!busy()) renderKeepingFocus(); }, 0);
    },
  }, label);
  if (where === 'row') return link;
  return h('div', { class: 'summary-acts' }, link,
    h('button', {
      type: 'button', class: 'btn-text',
      onclick: async () => {
        try { await navigator.clipboard.writeText(text()); toast('הסיכום הועתק.'); } catch (err) { toast(`הטקסט לא הועתק. ${errorText(err)}`); }
      },
    }, 'העתקת הטקסט'));
}

// ── Browser notifications (spec §6b) ─────────
const canNotify = () => typeof window.Notification === 'function';
function notifyState() {
  if (!canNotify()) return 'none';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission === 'granted' && store.get('notify') === 'on') return 'on';
  return 'off';
}
function notifyRow() {
  const st = notifyState();
  if (st === 'none') return null;
  if (st === 'blocked') return h('p', { class: 'notify-row muted' }, 'ההתראות חסומות בדפדפן. אפשר לאפשר אותן בהגדרות האתר.');
  if (st === 'on') {
    return h('p', { class: 'notify-row' }, 'התראות על איחורים ועל לקוח שלא ענה פעילות בדפדפן הזה. ',
      h('button', { type: 'button', class: 'btn-text', onclick: () => { store.set('notify', 'off'); renderMine(); } }, 'כיבוי'));
  }
  return h('div', { class: 'notify-row' },
    h('button', {
      type: 'button', class: 'btn-text', id: 'btn-notify',
      onclick: async () => {
        // Permission is asked only here, on a click, never on load.
        const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        if (p === 'granted') store.set('notify', 'on');
        renderMine();
      },
    }, 'התראה כשמשהו שלי נכנס לאיחור או כשלקוח לא ענה'),
    h('span', { class: 'hint' }, 'עובד רק כשהעמוד פתוח בדפדפן, גם בלשונית ברקע.'));
}

// A system notification; a click opens `href`. Chrome on Android lets only a
// service worker show one (`new Notification` throws a TypeError there), so
// from the first such refusal the site's worker (sw.js, the same registration
// that receives the pushes: app/push.js) shows them.
let workerNotes = false;
const notifyWorker = () => siteWorker();
function showNote(title, body, tag, href) {
  if (!workerNotes) {
    try {
      const n = new Notification(title, { body, tag });
      n.onclick = () => { window.focus(); location.href = href; n.close(); };
      return;
    } catch (err) {
      if (err?.name !== 'TypeError') return; // the browser refused
      workerNotes = true;
    }
  }
  const url = new URL(href, location.href).href;
  notifyWorker().then((reg) => reg?.showNotification(title, { body, tag, data: { href: url } })).catch(() => { /* refused */ });
}

// Alerts once a day for `keys` (one key, or every process a row of the "now"
// bar covers). With the page hidden: a notification. `ring`: a clock of the
// "now" bar ran out; it also notifies when the page is open but its window is
// not in front, and on the "my work" tab it needs no toast (the bar shows it,
// in red, and it is read out). Returns 'note', 'toast' or null.
function alertOnce(keys, title, body, href, { ring = false } = {}) {
  const day = dayIso(new Date());
  const ks = [keys].flat().map((key) => `notified.${key}.${day}`);
  if (ks.every((k) => store.get(k))) return null;
  for (const k of ks) store.set(k, '1');
  if (document.hidden || (ring && !document.hasFocus())) {
    // A clock that ran out also rings from the server when this phone is connected (sw.js): once is enough.
    if (!(ring && pushActive())) showNote(title, body, [keys].flat()[0], href);
    return 'note';
  }
  if (ring && view === 'mine') return null;
  toast(`${title} · ${body}`, { label: 'מעבר', run: () => { location.href = href; } });
  return 'toast';
}

// A process alerts once a day, whether its clock in the "now" bar ran out or
// it turned overdue, whichever came first.
const procAlertKey = (c) => `${c.client.id}:${c.proc.id}`;

// Processes of `me` that turned overdue since the previous check. The first
// check only records the state: on load every overdue process is "new".
let lastLate = null;
function checkLate() {
  if (!me || !isStaff(me) || !clients.length) return;
  const late = workFor(me).filter((g) => !g.task && g.status === 'overdue');
  const prev = lastLate;
  lastLate = new Set(late.map((g) => g.key));
  if (!prev || notifyState() !== 'on') return;
  for (const g of late) {
    if (prev.has(g.key)) continue;
    alertOnce(procAlertKey(g), `באיחור: ${g.client.name}`,
      `תהליך ${procLabel(g.proc)}. היעד היה ${formatWhen(g.dueAt)}.`, clientUrl(g.client.id, `#${g.proc.id}`));
  }
}

// ── "Now" bar: the clocks running right now (app/clocks.js) ──
// Stage 1: they run while this page is open (a server engine takes over in stage 3).
// The signed-in person's own clocks; the owner (no person) sees everyone's.
let clocks = [];
let clockSeen = new Map(); // clock id -> 'running' | 'expired' at the last second
const clockPerson = () => me || (scope === 'office' && !viewerError ? null : undefined);
function rebuildClocks(now = new Date()) {
  const person = clockPerson();
  clocks = person === undefined || !clients.length ? [] : clocksFor(person, clients, checks, { now, stateOf, tasks });
}
function paintNowBar() {
  renderNowBar($('now-bar'), clocks, { everyone: !me, onAnswered: markAnswered });
}

// Once a second: the countdowns, without rebuilding anything else. Only a clock
// seen running and now run out counts as running out while the page is open.
function clockTick() {
  if ($('app').hidden) return;
  const now = new Date();
  const seen = new Map();
  const ranOut = [];
  for (const c of clocks) {
    const { state } = clockTime(c, now);
    if (state === 'expired' && clockSeen.get(c.id) === 'running') ranOut.push(c);
    seen.set(c.id, state);
  }
  clockSeen = seen;
  if (ranOut.length) clocksRanOut(ranOut);
  const bar = $('now-bar');
  if (!document.hidden && view === 'mine' && !bar.hidden) updateNowBar(bar, clocks, { now, onAnswered: markAnswered });
}
setInterval(clockTick, 1000);

// Clocks ran out: one alert per row of the bar (the new deal's three processes
// are one "time is up"). With notifications on, a notification when the page is
// not in front, a toast on another tab; every process of the row counts as
// alerted, so turning overdue a minute later does not alert it again. Read out
// at once, unless the one toast already says it (a toast is a live region too).
// My bar has only my clocks; the owner hears the team's only while looking at them.
function clocksRanOut(list) {
  if (!me && !(view === 'mine' && !document.hidden)) return;
  const rows = clockRows(list);
  const toasted = !me || notifyState() !== 'on' ? [] : rows.filter((r) => {
    const t = ranOutText(r);
    const keys = r.clocks.map((c) => (c.kind === 'answer' ? c.id : procAlertKey(c)));
    return alertOnce(keys, t.title, t.body, clientUrl(r.client.id, `#${r.proc.id}`), { ring: true }) === 'toast';
  });
  if (rows.length === 1 && toasted.length === 1) return;
  fill($('now-live'), h('p', {}, rows.map((r) => { const t = ranOutText(r); return `${t.title}. ${t.body}`; }).join(' ')));
}

// "The client answered": stops that clock (the ANSWERED mark), with undo.
async function markAnswered(c, btn) {
  const cid = c.client.id;
  const key = ANSWERED(c.proc);
  const index = [...document.querySelectorAll('#now-bar .now-clock')].findIndex((li) => li.dataset.clock === c.id);
  btn.disabled = true;
  let row;
  try {
    row = await setCheck(cid, key, 'done');
  } catch (err) {
    btn.disabled = false;
    toast(`הסימון לא נשמר. ${errorText(err)}`);
    return;
  }
  (checks[cid] ||= {})[key] = row;
  states.delete(cid);
  rebuildClocks();
  paintNowBar();
  // Focus moves on to the next clock (or back to the list when the bar is empty).
  const items = [...document.querySelectorAll('#now-bar .now-clock')];
  const next = items[Math.min(index, items.length - 1)];
  (next?.querySelector('.now-answered, .now-client') || document.querySelector('#mine-list .cbx:not(:disabled)') || $('tab-mine')).focus();
  toast(`סומן שהלקוח ענה: ${c.client.name} · ${c.what}.`, { label: 'ביטול', run: () => unmarkAnswered(c) });
}

async function unmarkAnswered(c) {
  const cid = c.client.id;
  const key = ANSWERED(c.proc);
  try {
    await clearCheck(cid, key);
  } catch (err) {
    toast(`הביטול לא נשמר. ${errorText(err)}`);
    return;
  }
  if (checks[cid]) delete checks[cid][key];
  states.delete(cid);
  rebuildClocks();
  paintNowBar();
  document.querySelector(`#now-bar .now-clock[data-clock="${CSS.escape(c.id)}"] .now-answered`)?.focus();
  toast('הסימון בוטל. השעון חזר לפס.');
}

// A client the signing trigger opened while this page was open (spec §10).
let knownAuto = null;
function watchNewClients() {
  const ids = new Set(clients.filter(isAuto).map((c) => c.id));
  const prev = knownAuto;
  knownAuto = ids;
  if (!prev || me !== 'irit' || notifyState() !== 'on') return;
  for (const c of clients.filter((x) => ids.has(x.id) && !prev.has(x.id))) {
    alertOnce(`new:${c.id}`, `לקוח חדש נחתם: ${c.name}`, 'תהליכים 2 ו־3: עד 5 דקות.', clientUrl(c.id));
  }
}

// ── Clients ─────────────────────────────────
// The next step skips processes that wait on the client.
function nextStep(c, s) {
  const open = openItemsFor(null, c, checks[c.id] || {}, s).sort(byUrgency);
  const ours = open.find((e) => e.status !== 'client');
  if (ours) return { proc: ours.proc, owners: ours.claim ? [ours.claim.person] : ours.item.owners };
  return open[0] ? { proc: open[0].proc, waiting: true } : null;
}

function autoTag(c) {
  const q = quoteInfo.get(c.quote_id);
  return h('span', { class: 'auto-tag' }, 'חדש · נפתח אוטומטית מהסכם', q ? [' ', h('bdi', { class: 'num', dir: 'ltr' }, q.number)] : null);
}

// An 'own' view lists only the person's clients: open or scheduled work of theirs,
// an open task, or the client's editing assigned to them.
function myClients(person) {
  return clients.filter((c) => involves(person, c, checks[c.id] || {}, stateOf(c))
    || tasks.some((t) => t.client_id === c.id && t.owner === person && live(c)));
}

// "Your next step" in one client: open work first, then what starts soon.
function myNextIn(c, work, soon) {
  const g = work.find((x) => x.client.id === c.id);
  if (g) return h('span', {}, g.task ? `משימה: ${g.task.title} ` : `${procLabel(g.proc)} `, statusBadge(g.status, g.dueAt));
  const u = soon.find((x) => x.client.id === c.id);
  if (u) return h('span', {}, `${u.shootAt ? 'יום צילום' : `${u.list[0].proc.num} · ${u.list[0].proc.title}`} · מתחיל ${formatWhen(u.startAt)}`);
  return h('span', { class: 'muted' }, 'אין כרגע משהו פתוח אצלך');
}

function renderClients() {
  const own = scope === 'own';
  const FILTERS = [['active', 'פעילים'], ['late', 'עם איחור'], ['client', 'ממתין ללקוח'], ['ending', 'מסיימים'], ['ended', 'הסתיימו'], ['cancelled', 'בוטלו']];
  fill($('client-filters'), own ? h('p', { class: 'muted mine-hint' }, 'לקוחות שיש לך בהם עבודה פתוחה או מתוכננת, או שהעריכה שלהם אצלך.')
    : FILTERS.map(([k, label]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(clientFilter === k),
      onclick: () => glide(() => { clientFilter = k; renderClients(); }),
    }, label)));

  const q = $('client-search').value.trim();
  const open = (c) => c.status === 'active' || c.status === 'ending';
  const pool = own ? (me ? myClients(me) : []) : clients;
  const list = pool.filter((c) => {
    if (q && !`${c.name} ${c.business || ''} ${own ? '' : c.phone || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (own) return true;
    if (clientFilter === 'active') return c.status === 'active';
    if (clientFilter === 'late') return open(c) && stateOf(c).overdue > 0;
    if (clientFilter === 'client') return open(c) && stateOf(c).waitingOnClient > 0;
    return c.status === clientFilter;
  }).sort((a, b) => (isAuto(b) - isAuto(a)) || (stateOf(b).overdue - stateOf(a).overdue) || (new Date(b.deal_at) - new Date(a.deal_at)));

  if (!list.length) {
    fill($('client-list'), h('p', { class: 'empty' }, own ? 'אין כרגע לקוחות עם עבודה שלך.'
      : clients.length ? 'אין לקוחות בסינון הזה.' : 'עדיין אין לקוחות. לקוח חדש נפתח בכפתור ״לקוח חדש״.'));
    return;
  }
  const now = new Date();
  const work = own ? workFor(me) : [];
  const soon = own ? upcomingGroups(me, now) : [];
  // A long list shows its first twelve and "הצג עוד" (the search and the filters cover the rest).
  fill($('client-list'), capList(h('ul', { class: 'clist' }, ...list.map((c) => {
    const s = stateOf(c);
    const next = live(c) && !own ? nextStep(c, s) : null;
    const signed = quoteInfo.get(c.quote_id)?.signed_at;
    return h('li', { style: `--vt:cl-${String(c.id).replace(/[^\w-]/g, '')}` },
      h('a', { class: 'crow', href: clientUrl(c.id) },
        h('div', { class: 'cname' },
          h('strong', {}, clientLabel(c)),
          landingTag(c),
          isAuto(c) && !own ? autoTag(c) : null,
          isAuto(c) && signed ? h('small', { class: 'auto-when' }, `נחתם ${formatWhen(new Date(signed), now)}`) : null,
          h('small', {}, c.package_name || ' ')),
        h('div', { class: 'cphase' },
          h('span', { class: 'k' }, 'שלב'),
          h('span', {}, c.status === 'active' ? phaseTitle(c) : CLIENT_STATUS[c.status])),
        own ? null : h('div', { class: 'cprog' },
          h('span', { class: 'k' }, 'תהליכים שהושלמו'),
          h('span', { class: 'num', dir: 'ltr' }, `${s.procsDone}/${s.procsTotal}`),
          progressBar(s.procsDone, s.procsTotal, 'תהליכים שהושלמו')),
        h('div', { class: 'cnext' },
          h('span', { class: 'k' }, own ? 'הצעד הבא שלך' : 'הצעד הבא'),
          own ? myNextIn(c, work, soon)
            : !next ? h('span', { class: 'muted' }, 'אין פריטים פתוחים')
              : next.waiting ? h('span', {}, `ממתין ללקוח (${procLabel(next.proc)})`)
                : h('span', {}, `${procLabel(next.proc)} `, peopleChips(next.owners))),
        h('div', { class: 'cflags' },
          live(c) && s.overdue && !own ? h('span', { class: 'flag' }, statusBadge('overdue', null), h('span', { class: 'num' }, ` · ${s.overdue} תהליכים`)) : null,
          live(c) && s.waitingOnClient && !own ? h('span', { class: 'flag' }, statusBadge('client', null), h('span', { class: 'num' }, ` · ${s.waitingOnClient}`)) : null,
          c.shoot_at && live(c) ? h('span', { class: 'muted' }, `צילום: ${formatWhen(new Date(c.shoot_at))}`) : null)));
  })), q ? Infinity : 12, `clients:${clientFilter}`));
}
$('client-search').addEventListener('input', renderClients);

// ── Daily reviews (spec §7) ──────────────────
function lastBusinessDays(n, now = new Date()) {
  const out = [];
  let d = atTimeIL(now, 12);
  for (let guard = 0; out.length < n && guard < 60; guard += 1) {
    if (isBusinessDay(d)) out.push(d);
    d = addDaysIL(d, -1);
  }
  return out;
}
const reviewKind = (r) => `p${r.num}`;
const reviewOn = (day, kind) => reviews?.find((x) => x.day === day && x.kind === kind) || null;
// The note is JSON { general, clients: { clientId: text } }; plain text is read as general.
// Process 32 also keeps what the tick saw: { open: { topic: count }, unseen: [topic] }
// (app/control-topics.js topicsRecord), carried along when the notes are edited.
function parseReviewNote(note) {
  if (!note) return { general: '', clients: {}, topics: null };
  try {
    const v = JSON.parse(note);
    if (v && typeof v === 'object') {
      const topics = v.open && typeof v.open === 'object' ? { open: v.open, unseen: Array.isArray(v.unseen) ? v.unseen : [] } : null;
      return { general: v.general || '', clients: v.clients || {}, topics };
    }
  } catch { /* plain text */ }
  return { general: note, clients: {}, topics: null };
}
function reviewPending(r) {
  const now = new Date();
  return reviews !== null && isBusinessDay(now) && !reviewOn(dayIso(now), reviewKind(r));
}

async function doMarkReview(r, input) {
  // Process 32: one tick closes the day, and it says first which topics with open
  // items were not opened today. What the tick saw is kept in the record.
  let note;
  if (reviewKind(r) === 'p32') {
    const topics = topicsNow();
    const left = showsTopics() ? unseenTopics(topics, seenTopics()) : [];
    if (left.length && !(await confirmUnseen(left))) {
      if (input?.type === 'checkbox') input.checked = false;
      return;
    }
    // Marked from a screen that does not show the topics (on Irit's behalf): none of them was opened there.
    note = JSON.stringify({ general: '', clients: {}, ...topicsRecord(topics, showsTopics() ? seenTopics() : []) });
  }
  if (input) input.disabled = true;
  const day = dayIso(new Date());
  try {
    const row = await markReview(day, reviewKind(r), note);
    reviews = [row, ...(reviews || []).filter((x) => !(x.day === row.day && x.kind === row.kind))];
  } catch (err) {
    if (input) { input.checked = false; input.disabled = false; }
    toast(`הסימון לא נשמר. ${errorText(err)}`);
    return;
  }
  renderKeepingFocus();
  // No undo: review records cannot be deleted (the table has no delete grant).
  toast('הבקרה של היום סומנה.');
}

function reviewMarkControl(r, idPrefix) {
  const owner = PEOPLE[r.owner];
  if (me === r.owner) {
    const id = `${idPrefix}-${reviewKind(r)}`;
    return h('label', { class: 'wrow rv-check', for: id },
      h('input', {
        type: 'checkbox', id, class: 'cbx fin', 'aria-label': `הבקרה היומית בוצעה: תהליך ${r.num}, ${r.title}`,
        onchange: (ev) => doMarkReview(r, ev.currentTarget),
      }),
      h('span', { class: 'wlabel' }, 'הבקרה היומית בוצעה'));
  }
  return h('button', { type: 'button', class: 'btn btn-sm', onclick: (ev) => doMarkReview(r, ev.currentTarget) }, `סימון בשם ${owner.name}`);
}

// The fixed card in Irit's / Ofir's "today" group, until the review is marked.
function reviewCard(r) {
  return h('li', { class: 'wproc rv-card' },
    h('div', { class: 'wproc-h' },
      h('span', { class: 'wtitle' }, `בקרה יומית · תהליך ${r.num} · ${r.title}`),
      h('a', { class: 'btn-text', href: '#control' }, 'מעבר לבקרה')),
    reviewMarkControl(r, 'rvm'));
}

function reviewDone(rec, r) {
  // Marked by someone else on the owner's behalf: the record keeps who actually marked it.
  const by = directory[String(rec.by_email || '').toLowerCase()];
  const onBehalf = by && by !== r.owner ? ` (בשם ${PEOPLE[r.owner].name})` : '';
  return `בוצעה · ${who(rec.by_email)} · ${hm(rec.at)}${onBehalf}`;
}

function reviewWeek(r, now) {
  const today = dayIso(now);
  const days = lastBusinessDays(7, now).reverse();
  const items = days.map((d) => {
    const iso = dayIso(d);
    const rec = reviewOn(iso, reviewKind(r));
    const label = iso === today ? 'היום' : `${WEEKDAY[weekdayIL(d)]} ${dm(d)}`;
    const cls = rec ? 'is-done' : iso === today ? 'is-pending' : 'is-miss';
    const text = rec ? `בוצעה ${hm(rec.at)} · ${who(rec.by_email)}` : iso === today ? 'טרם בוצעה' : 'לא בוצעה';
    return { cls, label, text };
  });
  const done = items.filter((x) => x.cls === 'is-done').length;
  const list = (cls) => h('ol', { class: cls }, ...items.map((x) => h('li', { class: `rv-day ${x.cls}` },
    h('span', { class: 'rv-icon', 'aria-hidden': 'true' }), h('span', { class: 'rv-d' }, x.label), h('span', { class: 'rv-s' }, x.text))));
  const summary = `בוצעה ב־${done} מתוך 7 ימי העבודה האחרונים`;
  return h('div', { class: 'rv-hist' },
    h('p', { class: 'rv-sum rv-wide' }, summary),
    list('rv-week rv-wide'),
    h('details', { class: 'rv-narrow' }, h('summary', {}, summary), list('rv-week')));
}

// ── Irit's eleven topics (process 32; her protocol, step 19) ──
// One row per topic in the protocol's order, with how many items are open and the
// items one tap away (app/control-topics.js). Irit sees them, and so does whoever
// looks at the office from the manager profile; in Ofir's personal profile process
// 32 keeps its one short line (his own control is 33).
const showsTopics = () => me === 'irit' || !personal;
const topicsOpen = new Set();      // rows left open, across the re-renders
const seenToday = new Set();       // opened today on this screen (the store may be closed: private mode)
const seenKey = () => `control.seen.${dayIso(new Date())}`;
function seenTopics() {
  let saved = [];
  try { saved = JSON.parse(store.get(seenKey()) || '[]'); } catch { /* not ours */ }
  return [...new Set([...(Array.isArray(saved) ? saved : []), ...seenToday])];
}
function markTopicSeen(key) {
  if (seenTopics().includes(key)) return;
  seenToday.add(key);
  store.set(seenKey(), JSON.stringify(seenTopics()));
}
const workRows = (rows) => rows.map((x) => ({ key: x.p.key, late: x.late, urgent: x.urgent, today: x.today, open: x.open }));
const topicsNow = (now = new Date(), rows = personRows()) => controlTopics({ clients, checks, stateOf, tasks, deals, unsigned: flowExtra.unsigned || null, work: workRows(rows), now });

// The rest of a topic that the control already lists in full, lower on the page.
const TOPIC_MORE = { tasks: ['ctl-late', 'לכל האיחורים'], staff: ['ctl-people', 'לטבלה של כל הצוות'], back: ['ctl-wait', 'לרשימה המלאה, עם התקשרות'] };
const lateWord = (t, x) => (t.key === 'staff' || x.recheck ? null : ['approvals', 'signatures', 'back'].includes(t.key) ? 'יותר מיומיים' : 'באיחור');
function jumpTo(id) {
  const el = $(id);
  el?.scrollIntoView({ block: 'start' });
  el?.focus({ preventScroll: true });
}
function topicItem(t, x, now) {
  const name = x.client ? clientLabel(x.client) : x.title;
  const word = x.late ? lateWord(t, x) : null;
  return h('li', { class: `tp-item${x.late ? ' is-late' : ''}` },
    x.client ? h('a', { class: 'wclient', href: clientUrl(x.client.id, x.hash ? `#${x.hash}` : '') }, name)
      : x.href ? h('a', { class: 'wclient', href: x.href }, name)
        : h('strong', { class: 'tp-who' }, name),
    h('span', { class: 'tp-text' }, x.text,
      x.when ? h('span', { class: 'num' }, ` · ${formatWhen(x.when, now)}`) : null,
      x.since ? h('span', { class: 'muted num' }, ` · ${ageText(x.since, now)}`) : null),
    word ? h('span', { class: 'tag tag-warn' }, word) : null,
    // "עובדים שטרם סיימו": the person's own list, as in the table below.
    t.key === 'staff' ? h('button', {
      type: 'button', class: 'btn-text', onclick: () => { minePerson = x.person; if (personal) location.hash = '#team'; else setView('mine'); },
    }, `הרשימה של ${name}`) : null,
    // Her step 20: a real exception goes to Lior, through the card's own report.
    x.late && x.client ? h('a', { class: 'btn-text tp-esc', href: clientUrl(x.client.id, '#btn-escalate'), 'aria-label': `דיווח חריגה לליאור: ${name}` }, 'חריגה לליאור') : null);
}
function topicRow(t, now) {
  if (!t.count) {
    return h('li', { class: 'tp-row is-empty', id: `tp-${t.key}` }, h('span', { class: 'tp-name' }, t.label), h('span', { class: 'tp-none' }, 'אין'));
  }
  const more = TOPIC_MORE[t.key];
  return h('li', { class: 'tp-row', id: `tp-${t.key}` },
    h('details', {
      open: topicsOpen.has(t.key),
      ontoggle: (ev) => {
        if (ev.currentTarget.open) { topicsOpen.add(t.key); markTopicSeen(t.key); } else topicsOpen.delete(t.key);
        syncTopicsLeft();
      },
    },
    h('summary', {},
      h('span', { class: 'tp-name' }, t.label),
      t.late ? h('span', { class: 'tp-late' }, `${t.late} באיחור`) : null,
      h('span', { class: 'n', 'aria-label': `${t.count} פתוחים` }, String(t.count))),
    capList(h('ul', { class: 'tp-items' }, ...t.items.map((x) => topicItem(t, x, now))), 6, `tp:${t.key}`),
    more ? h('p', { class: 'tp-more' }, h('button', { type: 'button', class: 'btn-text', onclick: () => jumpTo(more[0]) }, more[1])) : null));
}
// Under the rows: how many topics with something in them were not opened yet today.
function topicsLeftText(topics) {
  if (!topics.some((t) => t.count)) return 'אין היום פריטים פתוחים באף נושא.';
  const left = unseenTopics(topics, seenTopics());
  if (!left.length) return 'עברת על כל הנושאים שיש בהם פריטים פתוחים.';
  return `${left.length === 1 ? 'נושא אחד שיש בו פריטים פתוחים עוד לא נפתח' : `${left.length} נושאים שיש בהם פריטים פתוחים עוד לא נפתחו`} היום: ${left.map((t) => t.label).join(', ')}.`;
}
let shownTopics = [];
function syncTopicsLeft() {
  const el = $('tp-left');
  if (el) el.textContent = topicsLeftText(shownTopics);
}
function topicsBlock(now, rows, pending) {
  shownTopics = topicsNow(now, rows);
  return h('div', { class: 'tp-block' },
    h('ol', { class: 'tp-list', 'aria-label': 'על מה עוברים בבקרה היומית' }, ...shownTopics.map((t) => topicRow(t, now))),
    // The daily messages to the clients are part of 32 too; they have their own page.
    canSendMessages({ me, scope, error: viewerError }) ? h('p', { class: 'tp-msgs' }, h('a', { class: 'btn-text', href: 'messages.html' }, 'הודעות יומיות ללקוחות')) : null,
    pending ? h('p', { class: 'tp-left', id: 'tp-left', role: 'status' }, topicsLeftText(shownTopics)) : null);
}
function goToTopic(key) {
  if (view !== 'control') setView('control');
  topicsOpen.add(key);
  markTopicSeen(key);
  renderKeepingFocus();
  const row = $(`tp-${key}`);
  row?.scrollIntoView({ block: 'center' });
  row?.querySelector('summary')?.focus({ preventScroll: true });
}
// "הבקרה היומית בוצעה" with topics not opened: say so, and let her decide. Resolves
// true to mark anyway; "לעבור עליהם" opens the first of them instead.
function confirmUnseen(left) {
  return new Promise((resolve) => {
    let answer = false;
    const dlg = h('dialog', { id: 'dlg-unseen', 'aria-labelledby': 'unseen-h' },
      h('div', { class: 'dlg-head' }, h('h2', { id: 'unseen-h' }, 'לסמן שהבקרה בוצעה?'),
        h('button', { type: 'button', class: 'close', 'aria-label': 'סגירה', onclick: () => dlg.close() }, '×')),
      h('div', { class: 'dlg-body' },
        h('p', {}, left.length === 1 ? 'בנושא אחד יש פריטים פתוחים, והוא עוד לא נפתח היום:' : `ב־${left.length} נושאים יש פריטים פתוחים, והם עוד לא נפתחו היום:`),
        h('ul', { class: 'tp-unseen' }, ...left.map((t) => h('li', {}, `${t.label} (${t.count})`)))),
      h('div', { class: 'dlg-foot' },
        h('button', { type: 'button', class: 'btn btn-ghost', id: 'unseen-mark', onclick: () => { answer = true; dlg.close(); } }, 'לסמן בכל זאת'),
        h('button', { type: 'button', class: 'btn btn-primary', id: 'unseen-go', onclick: () => { answer = 'go'; dlg.close(); } }, 'לעבור עליהם')));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (answer === 'go') goToTopic(left[0].key);
      resolve(answer === true);
    });
    document.body.append(dlg);
    dlg.showModal();
    $('unseen-go').focus();
  });
}
// What the tick saw, under a marked review.
function reviewRecord(notes) {
  if (!notes.topics) return null;
  const text = recordText(notes.topics);
  const unseen = notes.topics.unseen.map(topicLabel);
  return h('p', { class: 'rv-record muted' }, text ? `בזמן הסימון היו פתוחים: ${text}.` : 'בזמן הסימון לא היו פריטים פתוחים.',
    unseen.length ? ` לא נפתחו: ${unseen.join(', ')}.` : null);
}

function reviewRow(r, now, rows) {
  const kind = reviewKind(r);
  const rec = reviewOn(dayIso(now), kind);
  const notes = parseReviewNote(rec?.note);
  const walk = kind === 'p32' && showsTopics();
  const meta = h('p', { class: 'rv-meta' }, `תהליך ${r.num} · ${r.title} · `, personChip(r.owner), ` · ${r.sla}`);
  // With the topics the work comes first and the tick after it.
  return h('div', { class: `rv-row${walk ? ' rv-walk' : ''}` },
    walk ? [meta, topicsBlock(now, rows || personRows(), !rec && isBusinessDay(now))] : null,
    h('div', { class: 'rv-main' },
      !isBusinessDay(now) ? h('p', { class: 'muted rv-off' }, 'היום אינו יום עבודה.')
        : rec ? h('div', { class: 'rv-state' },
          h('label', { class: 'wrow rv-check' },
            h('input', { type: 'checkbox', class: 'cbx fin', checked: true, disabled: true, 'aria-label': `הבקרה היומית בוצעה: תהליך ${r.num}, ${r.title}` }),
            h('span', { class: 'wlabel' }, 'הבקרה היומית בוצעה')),
          h('span', { class: 'rv-by' }, reviewDone(rec, r)),
          h('button', { type: 'button', class: 'btn-text', onclick: () => openNotes(r) }, notes.general || Object.keys(notes.clients).length ? 'עריכת הערות' : 'הוספת הערות'))
          : reviewMarkControl(r, 'rv'),
      walk ? null : meta),
    reviewStale(r, now),
    reviewRecord(notes),
    notes.general ? h('p', { class: 'rv-general' }, `הערות: ״${notes.general}״`) : null,
    walk ? null : h('details', { class: 'rv-topics' }, h('summary', {}, 'על מה עוברים'),
      h('ul', {}, ...(REVIEW_TOPICS[kind] || []).map((t) => h('li', {}, t)))),
    reviewWeek(r, now));
}

// Process 33 runs at least every other business day: flag a longer gap until today's is marked.
function reviewStale(r, now) {
  const kind = reviewKind(r);
  if (kind !== 'p33' || reviews === null || !isBusinessDay(now) || reviewOn(dayIso(now), kind)) return null;
  const last = reviews.filter((x) => x.kind === kind).map((x) => x.day).sort().at(-1) || null;
  if (last && businessDaysBetween(parseDate(last), now) <= 2) return null;
  return h('p', { class: 'rv-stale' }, h('span', { class: 'tag tag-warn' }, 'עבר יותר מיומיים מהבקרה האחרונה'),
    h('span', {}, last ? `הבקרה האחרונה: ${dayShort(last)}` : 'אין בקרה ב־7 ימי העבודה האחרונים'));
}

function reviewPanel(now, rows = null) {
  return h('section', { class: 'rv-panel', 'aria-labelledby': 'rv-h' },
    h('h2', { class: 'wgroup-h', id: 'rv-h', tabindex: '-1' }, 'הבקרה של היום'),
    reviews === null
      ? h('p', { class: 'muted' }, `הבקרות לא נטענו. ${reviewsError ? errorText(reviewsError) : ''}`)
      : OFFICE_REVIEWS.map((r) => reviewRow(r, now, rows)));
}

// Notes written today next to a client in the control lists.
function clientNotes(c, now) {
  const today = dayIso(now);
  return OFFICE_REVIEWS.map((r) => {
    const rec = reviewOn(today, reviewKind(r));
    const text = rec && parseReviewNote(rec.note).clients[c.id];
    if (!text) return null;
    return h('p', { class: 'rv-cnote' }, `${who(rec.by_email)}, ${partsIL(rec.at).hour < 12 ? 'הבוקר' : 'היום'}: ״${text}״`);
  });
}

// Notes dialog for today's review.
const notesDlg = $('dlg-notes');
let notesFor = null;
notesDlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === notesDlg) notesDlg.close(); });
function controlLists(now) {
  const late = clients.filter(live).map((c) => ({
    c,
    lateProcs: lateProcsOf(c),
    lateTasks: tasks.filter((t) => t.client_id === c.id && t.due_on && t.due_on < dayIso(now)),
  })).filter((x) => x.lateProcs.length || x.lateTasks.length);
  const today = dayIso(now);
  const waiting = clients.filter(live).flatMap((c) => waitingProcsOf(c).map((x) => ({ c, x })))
    .sort((a, b) => (recheckDue(b.x.wait, today) - recheckDue(a.x.wait, today)) || (new Date(a.x.wait?.at || 0) - new Date(b.x.wait?.at || 0)));
  return { late, waiting };
}
function openNotes(r) {
  notesFor = r;
  const now = new Date();
  const rec = reviewOn(dayIso(now), reviewKind(r));
  const notes = parseReviewNote(rec?.note);
  const { late, waiting } = controlLists(now);
  const seen = new Set();
  const list = [...late.map((x) => x.c), ...waiting.map((x) => x.c)].filter((c) => !seen.has(c.id) && seen.add(c.id));
  $('notes-h').textContent = `הערות לבקרה של היום · תהליך ${r.num}`;
  $('notes-err').hidden = true;
  fill($('notes-fields'), list.length ? list.map((c, i) => h('div', { class: 'field note-field' },
    h('label', { for: `note-c-${i}` }, `${c.name}: למה תקוע ומה הצעד הבא`),
    h('input', { class: 'input', id: `note-c-${i}`, 'data-client': c.id, value: notes.clients[c.id] || '', autocomplete: 'off', maxlength: 300 }),
    h('a', { class: 'btn-text', href: clientUrl(c.id, '#tasks'), target: '_blank', rel: 'noopener' }, 'פתיחת משימה בכרטיס')))
    : h('p', { class: 'muted' }, 'אין היום לקוחות באיחור או ממתינים ללקוח.'));
  $('notes-general').value = notes.general;
  notesDlg.showModal();
  (notesDlg.querySelector('.note-field input') || $('notes-general')).focus();
}
$('notes-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = notesFor;
  const clientsNotes = {};
  for (const el of notesDlg.querySelectorAll('[data-client]')) if (el.value.trim()) clientsNotes[el.dataset.client] = el.value.trim();
  const general = $('notes-general').value.trim();
  // What the tick saw (process 32) stays in the record when the notes change.
  const kept = parseReviewNote(reviewOn(dayIso(new Date()), reviewKind(r))?.note).topics;
  const note = general || Object.keys(clientsNotes).length || kept ? JSON.stringify({ general, clients: clientsNotes, ...(kept || {}) }) : null;
  if (note && note.length > 2000) {
    $('notes-err').textContent = 'ההערות ארוכות מדי לשמירה. קצרו אותן, או פתחו משימה בכרטיס הלקוח.';
    $('notes-err').hidden = false;
    return;
  }
  $('notes-submit').disabled = true;
  try {
    const row = await markReview(dayIso(new Date()), reviewKind(r), note);
    reviews = [row, ...(reviews || []).filter((x) => !(x.day === row.day && x.kind === row.kind))];
    notesDlg.close();
    renderKeepingFocus();
    toast('ההערות נשמרו.');
  } catch (err) {
    $('notes-err').textContent = `ההערות לא נשמרו. ${errorText(err)}`;
    $('notes-err').hidden = false;
  } finally {
    $('notes-submit').disabled = false;
  }
});

// ── Urgent tasks and exceptions reported to Lior ──
// Every employee protocol: "update Lior on any exception". The card opens them as
// tasks with source 'escalation'; the control view and Lior's list show them first.
const withClient = (list) => list.map((t) => ({ t, c: clientOf(t.client_id) })).filter(({ c }) => c && live(c))
  .sort((a, b) => new Date(a.t.created_at) - new Date(b.t.created_at));
const openEscalations = () => withClient(tasks.filter(isEscalation));
const openUrgent = () => withClient(tasks.filter((t) => t.urgent && !isEscalation(t)));

function taskRow({ t, c }, now) {
  return h('li', { class: 'task-row' },
    h('div', { class: 'task-head' },
      h('a', { class: 'wclient', href: clientUrl(c.id, '#tasks') }, clientLabel(c)),
      taskBadge(t),
      h('span', { class: 'task-title' }, t.title),
      personChip(t.owner),
      t.due_on ? h('span', { class: 'muted num' }, `עד ${dayShort(t.due_on)}`) : null),
    taskMeta(t, now),
    t.urgent ? taskStart(t) : null,
    briefDetails(t));
}

// Section heading that the jump links at the top of the control view can focus.
const secHead = (id, title, n = null, icon = false) => h('h2', { class: 'wgroup-h', id, tabindex: '-1' },
  icon ? h('span', { class: 'sicon', 'aria-hidden': 'true' }) : null, title, n === null ? null : h('span', { class: 'n' }, String(n)));

function urgentSection(now) {
  const list = openUrgent();
  if (!list.length) return null;
  return h('section', { class: 'ctl-sec ctl-urgent', 'aria-labelledby': 'ctl-urgent' },
    secHead('ctl-urgent', 'משימות דחופות', list.length, true),
    h('p', { class: 'perf-intro' }, 'משימה דחופה מתבצעת באותו רגע, לפני כל דבר אחר.'),
    h('ul', { class: 'task-list' }, ...list.map((x) => taskRow(x, now))));
}

function escalationSection(now) {
  const list = openEscalations();
  return h('section', { class: 'ctl-sec ctl-esc', 'aria-labelledby': 'ctl-esc' },
    secHead('ctl-esc', 'חריגות פתוחות', list.length),
    list.length
      ? [h('p', { class: 'perf-intro' }, 'חריגות שדווחו לליאור ועוד לא נסגרו. נסגרות כשליאור מסמן את המשימה כבוצעה.'),
        h('ul', { class: 'task-list' }, ...list.map((x) => taskRow(x, now)))]
      : h('p', { class: 'muted ctl-none' }, 'אין חריגות פתוחות.'));
}

// ── Ofir's weekly status summary (process 33, stages 8–10) ──
function statusWeek(now = new Date()) {
  const wk = weekKey(now);
  const list = clients.filter(inWork);
  const notes = new Map((statusNotes || []).filter((n) => n.week === wk).map((n) => [n.client_id, n]));
  return { wk, list, notes, done: list.filter((c) => notes.has(c.id)).length, total: list.length };
}
// Thursday: every client gets a summary, without exception.
function thursdayPass(now = new Date()) {
  if (weekdayIL(now) !== 4 || statusNotes === null || !isBusinessDay(now)) return null;
  const w = statusWeek(now);
  return w.total && w.done < w.total ? w : null;
}
function goToStatus() {
  setView('control');
  const el = document.getElementById('ctl-status');
  el?.scrollIntoView({ block: 'start' });
  el?.focus({ preventScroll: true });
}
function thursdayCard() {
  const w = thursdayPass();
  if (!w) return null;
  return h('li', { class: 'wproc rv-card thu-card' },
    h('div', { class: 'wproc-h' },
      h('span', { class: 'wtitle' }, `מעבר חובה של יום חמישי: סיכום מצב לכל הלקוחות (${w.done}/${w.total})`),
      h('a', { class: 'btn-text', href: '#control', onclick: (ev) => { ev.preventDefault(); goToStatus(); } }, 'מעבר לסיכום המצב')),
    h('p', { class: 'task-meta' }, 'על כל לקוח: מצב נוכחי, מה חסר, פעולה הבאה, אחראי ומועד יעד.'),
    progressBar(w.done, w.total, 'לקוחות שסוכמו השבוע'));
}

// Where the client is: its station (the 8 stations, one source: messages-logic.js
// stationTitle), the same word as the card's "עכשיו" line and the client's status page.
const phaseTitle = (c) => (c.status === 'active' ? stationTitle(c, stateOf(c), new Date()) : CLIENT_STATUS[c.status]);

// The task opened from a summary's next action, while it is open.
const noteTask = (c, note) => tasks.find((t) => t.client_id === c.id && t.source === 'status' && t.title === noteTitle(note));
const noteTitle = (note) => String(note.next || '').trim().slice(0, 500);

async function taskFromNote(c, note, btn) {
  btn.disabled = true;
  try {
    const row = await addTask({ client_id: c.id, title: noteTitle(note), owner: note.owner, due_on: note.due_on, source: 'status' });
    tasks = [row, ...tasks];
  } catch (err) {
    btn.disabled = false;
    toast(`המשימה לא נפתחה. ${errorText(err)}`);
    return;
  }
  renderKeepingFocus();
  document.querySelector(`#st-${CSS.escape(c.id)} .status-task a`)?.focus();
  toast(`נפתחה משימה ל${PEOPLE[note.owner].name}: ${noteTitle(note)}`);
}

function noteTaskControl(c, note) {
  if (!note.next) return null;
  if (!note.owner || !note.due_on) return h('span', { class: 'muted' }, 'כדי לפתוח משימה מהפעולה הבאה חסרים אחראי ומועד יעד.');
  if (noteTask(c, note)) {
    return h('span', { class: 'status-task' }, h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'נפתחה משימה'),
      h('a', { class: 'btn-text', href: clientUrl(c.id, '#tasks') }, 'למשימה'));
  }
  // A task for Nirel needs a brief, which is written in the client card.
  if (BRIEF_REQUIRED.has(note.owner)) {
    return h('a', { class: 'btn-text', href: clientUrl(c.id, '#tasks') }, `פתיחת משימה ל${PEOPLE[note.owner].name} בכרטיס (עם בריף)`);
  }
  return h('button', {
    type: 'button', class: 'btn btn-sm', 'aria-label': `פתיחת משימה ל${PEOPLE[note.owner].name} אצל ${c.name}: ${noteTitle(note)}`,
    onclick: (ev) => taskFromNote(c, note, ev.currentTarget),
  }, 'פתיחת משימה');
}

function statusRow(c, note) {
  return h('li', { class: `status-row${note ? ' is-done' : ''}`, id: `st-${c.id}` },
    h('div', { class: 'status-head' },
      h('a', { class: 'wclient', href: clientUrl(c.id) }, clientLabel(c)),
      h('span', { class: 'muted small' }, phaseTitle(c)),
      note ? h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'סוכם')
        : h('span', { class: 'sbadge s-waiting' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'טרם סוכם'),
      h('button', {
        type: 'button', class: note ? 'btn-text status-edit' : 'btn btn-sm status-edit', 'aria-label': `${note ? 'עריכת' : 'כתיבת'} סיכום המצב של ${c.name}`,
        onclick: () => openStatus(c),
      }, note ? 'עריכה' : 'כתיבת סיכום')),
    note ? h('dl', { class: 'status-sum' },
      ...STATUS_FIELDS.filter(([k]) => note[k]).flatMap(([k, label]) => [h('dt', {}, label), h('dd', {}, note[k])]),
      note.owner ? [h('dt', {}, 'אחראי'), h('dd', {}, personChip(note.owner))] : null,
      note.due_on ? [h('dt', {}, 'מועד יעד'), h('dd', {}, dayShort(note.due_on))] : null) : null,
    note ? h('div', { class: 'status-by' }, h('span', { class: 'muted' }, `נכתב ע״י ${who(note.by_email)} · ${formatStamp(note.at)}`), noteTaskControl(c, note)) : null);
}

// Not summarised yet first, in the order of the clients list.
const passOrder = (w) => [...w.list].sort((a, b) => w.notes.has(a.id) - w.notes.has(b.id));

function statusSection(now) {
  const head = secHead('ctl-status', 'סיכום מצב שבועי', statusNotes === null ? null : `${statusWeek(now).done}/${statusWeek(now).total}`);
  if (statusNotes === null) {
    return h('section', { class: 'ctl-sec status-sec', 'aria-labelledby': 'ctl-status' }, head,
      h('p', { class: 'muted' }, `סיכומי המצב לא נטענו. ${statusError ? errorText(statusError) : ''}`));
  }
  const w = statusWeek(now);
  return h('section', { class: 'ctl-sec status-sec', 'aria-labelledby': 'ctl-status' }, head,
    h('p', { class: 'perf-intro' }, `השבוע שמתחיל ב־${dayShort(w.wk)}. לפחות פעם ביומיים עוברים על כל הלקוחות; ביום חמישי מעבר חובה עם סיכום מצב לכל לקוח. פעולה שצריך לבצע הופכת למשימה במערכת.`),
    h('p', { class: 'status-progress' }, h('span', {}, `סוכמו ${w.done} מתוך ${w.total} לקוחות`), progressBar(w.done, w.total, 'לקוחות שסוכמו השבוע')),
    w.total ? h('ul', { class: 'status-list' }, ...passOrder(w).map((c) => statusRow(c, w.notes.get(c.id))))
      : h('p', { class: 'muted ctl-none' }, 'אין לקוחות פעילים.'));
}

// The summary dialog. It stays open while the page refreshes in the background.
const statusDlg = $('dlg-status');
let statusFor = null;
statusDlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === statusDlg) statusDlg.close(); });
const STATUS_REQUIRED = new Set(['current', 'next']);
fill($('status-fields'), ...STATUS_FIELDS.map(([k, label, hint]) => h('div', { class: 'field' },
  h('label', { for: `stf-${k}` }, label, STATUS_REQUIRED.has(k) ? null : h('span', { class: 'muted small' }, ' (אם יש)')),
  h('textarea', { class: 'input', id: `stf-${k}`, rows: 2, maxlength: k === 'next' ? 500 : 1000, placeholder: hint, required: STATUS_REQUIRED.has(k) }))));

// What the system already knows about the client, to write the summary from.
function systemFacts(c) {
  const s = stateOf(c);
  const next = live(c) ? nextStep(c, s) : null;
  const open = tasks.filter((t) => t.client_id === c.id).length;
  return [
    `שלב: ${phaseTitle(c) || '—'}`,
    next ? ` · הצעד הבא: ${procLabel(next.proc)}${next.waiting ? ' (ממתין ללקוח)' : ` (${namesOf(next.owners)})`}` : '',
    s.overdue ? ` · ${s.overdue} תהליכים באיחור` : '',
    s.waitingOnClient ? ` · ממתין ללקוח: ${s.waitingOnClient}` : '',
    open ? ` · ${open} משימות פתוחות` : '',
  ].join('');
}
// "Fill from the system": the current phase, what is late, and the next step with its owner and due date.
function fillFromSystem(c) {
  const s = stateOf(c);
  const next = live(c) ? nextStep(c, s) : null;
  const late = s.states.filter((x) => x.status === 'overdue');
  if (!$('stf-current').value.trim()) $('stf-current').value = phaseTitle(c) || '';
  if (!$('stf-missing').value.trim() && late.length) $('stf-missing').value = late.map((x) => procLabel(x.proc)).join(', ');
  if (next && !next.waiting) {
    if (!$('stf-next').value.trim()) $('stf-next').value = procLabel(next.proc);
    const owner = next.owners.find(isStaff);
    if (!$('stf-owner').value && owner && next.owners.length === 1) $('stf-owner').value = owner;
    const st = s.states.find((x) => x.proc.id === next.proc.id);
    if (!$('stf-due').value && st?.dueAt) $('stf-due').value = dayIso(st.dueAt);
  }
  $('stf-current').focus();
}

function openStatus(c) {
  statusFor = c;
  const wk = weekKey(new Date());
  const note = (statusNotes || []).find((n) => n.client_id === c.id && n.week === wk) || null;
  const prev = (statusNotes || []).filter((n) => n.client_id === c.id && n.week < wk).sort((a, b) => (a.week < b.week ? 1 : -1))[0] || null;
  $('status-h').textContent = `סיכום מצב · ${c.name}`;
  fill($('status-ctx'), h('span', {}, `מהמערכת: ${systemFacts(c)}`), ' ',
    h('button', { type: 'button', class: 'btn-text', onclick: () => fillFromSystem(c) }, 'מילוי מהמערכת'));
  for (const [k] of STATUS_FIELDS) {
    $(`stf-${k}`).value = note?.[k] || '';
    $(`stf-${k}`).removeAttribute('aria-invalid');
  }
  $('stf-owner').removeAttribute('aria-invalid');
  $('stf-due').removeAttribute('aria-invalid');
  fill($('stf-owner'), h('option', { value: '' }, 'בחירה'),
    h('optgroup', { label: 'צוות' }, ...officePeople().map((p) => h('option', { value: p.key, selected: note?.owner === p.key }, p.name))),
    h('optgroup', { label: 'עורכים' }, ...editorPeople().map((p) => h('option', { value: p.key, selected: note?.owner === p.key }, p.name))));
  $('stf-due').value = note?.due_on || '';
  fill($('status-prev'), prev ? `בשבוע של ${dayShort(prev.week)} (${who(prev.by_email)}): ${[prev.current, prev.next].filter(Boolean).join(' · ')}` : null);
  $('status-prev').hidden = !prev;
  $('status-err').hidden = true;
  const w = statusWeek();
  $('status-next').hidden = !passOrder(w).some((x) => x.id !== c.id && !w.notes.has(x.id));
  statusDlg.showModal();
  $('stf-current').focus();
}

$('status-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const c = statusFor;
  const goNext = e.submitter?.id === 'status-next';
  const val = (id) => $(id).value.trim() || null;
  const row = {
    client_id: c.id, week: weekKey(new Date()),
    current: val('stf-current'), missing: val('stf-missing'), next: val('stf-next'),
    owner: $('stf-owner').value || null, due_on: $('stf-due').value || null,
  };
  // Ofir's protocol: every summary has the current state, the next action, who owns it and by when.
  const required = [['current', 'stf-current', 'מצב נוכחי'], ['next', 'stf-next', 'פעולה הבאה'], ['owner', 'stf-owner', 'אחראי'], ['due_on', 'stf-due', 'מועד יעד']];
  const missing = required.filter(([k]) => !row[k]);
  for (const [k, id] of required) $(id).setAttribute('aria-invalid', String(!row[k]));
  if (missing.length) {
    $('status-err').textContent = `חסר: ${missing.map(([, , label]) => label).join(', ')}. לכל לקוח רושמים מצב נוכחי, פעולה הבאה, אחראי ומועד יעד.`;
    $('status-err').hidden = false;
    $(missing[0][1]).focus();
    return;
  }
  for (const b of statusDlg.querySelectorAll('.dlg-foot .btn')) b.disabled = true;
  try {
    const saved = await saveStatusNote(row);
    statusNotes = [saved, ...(statusNotes || []).filter((n) => !(n.client_id === saved.client_id && n.week === saved.week))];
  } catch (err) {
    $('status-err').textContent = `הסיכום לא נשמר. ${errorText(err)}`;
    $('status-err').hidden = false;
    return;
  } finally {
    for (const b of statusDlg.querySelectorAll('.dlg-foot .btn')) b.disabled = false;
  }
  const w = statusWeek();
  const next = goNext ? passOrder(w).find((x) => !w.notes.has(x.id)) : null;
  statusDlg.close();
  renderKeepingFocus();
  toast(`סיכום המצב של ${c.name} נשמר. סוכמו ${w.done} מתוך ${w.total} לקוחות.`);
  if (next) openStatus(next);
  else document.querySelector(`#st-${CSS.escape(c.id)} .status-edit`)?.focus();
});

// ── Editor load (Ofir, stage 5: before assigning a client to an editor) ──
const EDIT_STEPS = [['p22', 'עריכה'], ['p24', 'העלאה לדרייב והעברה לאופיר'], ['p27', 'תיקונים וסגירה']];
// Every editing job not finished in post: the client's own, and each extra shoot round's.
function editingJobs() {
  const out = [];
  for (const c of clients.filter(inWork)) {
    const s = stateOf(c);
    const st = (id) => s.states.find((x) => x.proc.id === id) || null;
    for (const u of [{ editor: c.editor, pre: '', round: null }, ...roundsOf(c).map((r) => ({ editor: r.editor, pre: `r${r.n}-`, round: r.n }))]) {
      const end = st(`${u.pre}p27`);
      if (!u.editor || !end || end.complete) continue;
      out.push({ c, editor: u.editor, round: u.round, steps: EDIT_STEPS.map(([id, label]) => ({ label, s: st(`${u.pre}${id}`) })).filter((x) => x.s) });
    }
  }
  return out;
}
// Shot and waiting for Ofir to assign an editor (process 22א).
const awaitingEditor = () => clients.filter(inWork).flatMap((c) => stateOf(c).states
  .filter((x) => x.proc.id.replace(/^r\d+-/, '') === 'p22a' && x.ready && !x.complete).map((x) => ({ c, x })));

function editorSection(now) {
  const jobs = editingJobs();
  const waiting = awaitingEditor();
  return h('section', { class: 'ctl-sec editor-sec', 'aria-labelledby': 'ctl-editors' },
    secHead('ctl-editors', 'עומס עורכים'),
    h('p', { class: 'perf-intro' }, 'לפני שיוך לקוח לעורך: כמה לקוחות כל עורך מחזיק, אילו משימות פתוחות לו, ומתי כל עריכה צריכה להסתיים (עד יום העסקים השלישי אצל אופיר, הרביעי כולל תיקונים).'),
    waiting.length ? h('div', { class: 'await-editor' },
      h('h3', { class: 'health-h' }, 'ממתינים לשיוך עורך', h('span', { class: 'n' }, String(waiting.length))),
      h('ul', { class: 'stuck' }, ...waiting.map(({ c, x }) => h('li', {},
        h('a', { class: 'wclient', href: clientUrl(c.id, `#${x.proc.id}`) }, clientLabel(c)), ' ',
        h('span', {}, procLabel(x.proc)), ' ', statusBadge(x.status, x.dueAt, now))))) : null,
    h('ul', { class: 'editor-list' }, ...EDITORS.map((key) => {
      const mine = jobs.filter((j) => j.editor === key);
      const openTasks = tasks.filter((t) => t.owner === key && live(clientOf(t.client_id) || { status: 'cancelled' })).length;
      return h('li', { class: 'editor-card' },
        h('div', { class: 'editor-head' },
          personChip(key),
          key === 'nirel' ? h('span', { class: 'tag' }, 'נטלי בלבד') : null,
          h('span', { class: 'editor-count' }, `${mine.length} ${mine.length === 1 ? 'לקוח' : 'לקוחות'} בעריכה · ${openTasks} ${openTasks === 1 ? 'משימה פתוחה' : 'משימות פתוחות'}`)),
        mine.length ? h('ul', { class: 'edit-jobs' }, ...mine.map((j) => h('li', {},
          h('a', { class: 'wclient', href: clientUrl(j.c.id, `#${j.steps[0]?.s.proc.id || ''}`) }, clientLabel(j.c), j.round ? ` · סבב ${j.round}` : ''),
          h('ol', { class: 'edit-steps' }, ...j.steps.map(({ label, s }) => h('li', {},
            h('span', { class: 'edit-k' }, `${s.proc.num} · ${label}`),
            statusBadge(s.status, s.dueAt, now),
            s.status !== 'done' && s.dueAt ? h('span', { class: 'muted num' }, `יעד ${formatWhen(s.dueAt, now)}`) : null))))))
          : h('p', { class: 'muted ctl-none' }, 'אין כרגע לקוחות בעריכה.'));
    })));
}

// ── System integrity (Ofir, stages 12–14) ────
function lastActivity(c) {
  const times = [c.created_at, c.deal_at, workFloor(c), lastLog.get(c.id),
    ...Object.values(checks[c.id] || {}).map((x) => x.at),
    ...tasks.filter((t) => t.client_id === c.id).map((t) => t.created_at),
    ...(statusNotes || []).filter((n) => n.client_id === c.id).map((n) => n.at),
  ].filter(Boolean).map((v) => new Date(v).getTime()).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)) : null;
}
const FIELD_LABEL = { char_at: 'מועד פגישת האפיון', shoot_at: 'מועד יום הצילום', editor: 'עורך משויך' };
const phaseAt = (key) => (key.startsWith('round-') ? PHASES.findIndex((p) => p.key === 'ongoing') - 0.5 : PHASES.findIndex((p) => p.key === key));
// Details a client must have by the phase it reached.
function missingKeyFields(c) {
  const cur = phaseAt(stateOf(c).current);
  const out = [];
  if (cur > phaseAt('onboarding') && !c.char_at) out.push('char_at');
  if (cur >= phaseAt('prep') && !c.shoot_at) out.push('shoot_at');
  if (cur >= phaseAt('post') && !c.editor) out.push('editor');
  return out;
}
function integrity(now) {
  const open = clients.filter(inWork);
  return {
    idle: open.map((c) => ({ c, at: lastActivity(c) })).filter((x) => x.at && businessDaysBetween(x.at, now) >= 5).sort((a, b) => a.at - b.at),
    noDue: withClient(tasks.filter((t) => !t.due_on)),
    missing: open.map((c) => ({ c, fields: missingKeyFields(c) })).filter((x) => x.fields.length),
    late: open.flatMap((c) => stateOf(c).states.filter((x) => x.status === 'overdue' && businessDaysBetween(x.dueAt, now) > 2).map((x) => ({ c, x })))
      .sort((a, b) => a.x.dueAt - b.x.dueAt),
  };
}

// One row per client, its most overdue process first.
function lateByClient(late) {
  const m = new Map();
  for (const r of late) (m.get(r.c.id) || m.set(r.c.id, { c: r.c, list: [] }).get(r.c.id)).list.push(r.x);
  return [...m.values()];
}

function healthSection(now) {
  const { idle, noDue, missing, late } = integrity(now);
  const total = idle.length + noDue.length + missing.length + lateByClient(late).length;
  const group = (cls, title, list, row) => (list.length ? h('div', { class: `health-group ${cls}` },
    h('h3', { class: 'health-h' }, title, h('span', { class: 'n' }, String(list.length))),
    capList(h('ul', { class: 'stuck health-list' }, ...list.map(row)), 5, `ctl:${cls}`)) : null);
  return h('section', { class: 'ctl-sec health-sec', 'aria-labelledby': 'ctl-health' },
    secHead('ctl-health', 'תקינות המערכת', total),
    h('p', { class: 'perf-intro' }, 'המערכת צריכה לשקף את המצב בפועל: לכל לקוח שלב נכון, לכל משימה אחראי ומועד יעד, ואף לקוח לא נתקע בין שלבים.'),
    total ? [
      group('h-late', 'תהליכים באיחור של יותר מיומיים', lateByClient(late), ({ c, list }) => h('li', {},
        h('a', { class: 'wclient', href: clientUrl(c.id) }, clientLabel(c)),
        h('span', { class: 'muted' }, ` · ${list.length === 1 ? 'תהליך אחד' : `${list.length} תהליכים`}`),
        h('ul', { class: 'late-procs' }, ...list.map((x) => h('li', {},
          h('a', { href: clientUrl(c.id, `#${x.proc.id}`) }, procLabel(x.proc)), ' ', peopleChips(peopleOf(x)),
          h('span', { class: 'muted' }, ` · באיחור ${lateBy(x.dueAt, now)}`)))))),
      group('h-idle', 'לקוחות בלי פעילות 5 ימי עסקים ומעלה', idle, ({ c, at: t }) => h('li', {},
        h('a', { class: 'wclient', href: clientUrl(c.id) }, clientLabel(c)),
        h('span', { class: 'muted' }, ` · ${phaseTitle(c) || ''} · פעילות אחרונה ${formatStamp(t)} (${businessDaysBetween(t, now)} ימי עסקים)`))),
      group('h-missing', 'חסרים פרטים לשלב שהלקוח נמצא בו', missing, ({ c, fields }) => h('li', {},
        h('a', { class: 'wclient', href: clientUrl(c.id) }, clientLabel(c)),
        h('span', {}, ` · חסר: ${fields.map((f) => FIELD_LABEL[f]).join(', ')}`),
        h('span', { class: 'muted' }, ` · שלב: ${phaseTitle(c) || ''}`))),
      group('h-nodue', 'משימות פתוחות בלי מועד יעד', noDue, ({ t, c }) => h('li', {},
        h('a', { class: 'wclient', href: clientUrl(c.id, '#tasks') }, clientLabel(c)), ' · ',
        h('span', {}, t.title), ' ', personChip(t.owner), taskBadge(t))),
    ] : h('p', { class: 'muted ctl-none' }, 'לא נמצאו חוסרים. המערכת תקינה.'));
}

// ── Daily control (processes 32, 33) ─────────
function contactLinks(c) {
  if (!c.phone) return h('span', { class: 'muted' }, 'אין טלפון בכרטיס');
  return h('span', { class: 'contact' },
    h('a', { class: 'btn-text', href: `tel:${String(c.phone).replace(/[^\d+]/g, '')}` }, 'התקשרות'),
    h('a', { class: 'btn-text', href: whatsappLink(c.phone, ''), target: '_blank', rel: 'noopener' }, 'WhatsApp'));
}

const PERSON_COLS = ['עובד', 'דחוף', 'באיחור', 'להיום', 'פתוחים', 'ממתין ללקוח', 'לקוחות עם איחור'];
function personRows() {
  return STAFF_PEOPLE().map((p) => {
    const w = workFor(p.key);
    const late = w.filter((g) => g.status === 'overdue');
    return {
      p, late: late.length, today: w.filter((g) => bucketFor(g) === 'today').length, open: w.length, urgent: w.filter((g) => g.urgent).length,
      waiting: w.filter((g) => g.status === 'client').length, opened: store.get(openedKey(p.key)),
      clients: [...new Set(late.map((g) => g.client.name))],
    };
  });
}
function personRow(r) {
  return h('tr', {},
    h('td', { 'data-label': 'עובד' }, personChip(r.p.key), h('small', { class: 'by' }, r.p.role)),
    h('td', { 'data-label': 'דחוף', class: r.urgent ? 'late num' : 'num' }, String(r.urgent)),
    h('td', { 'data-label': 'באיחור', class: r.late ? 'late num' : 'num' }, String(r.late)),
    h('td', { 'data-label': 'להיום', class: 'num' }, String(r.today)),
    h('td', { 'data-label': 'פתוחים', class: 'num' }, String(r.open)),
    h('td', { 'data-label': 'ממתין ללקוח', class: 'num' }, String(r.waiting)),
    h('td', { 'data-label': 'לקוחות עם איחור', class: 'client' }, r.clients.join(', ') || '—'),
    h('td', { class: 'acts-cell' }, h('div', { class: 'row-acts' },
      h('button', {
        // Someone else's list is the manager profile's (#team). From the daily control of
        // Ofir or Irit in their personal profile the address opens it there (it showed
        // their own list instead), and the button at the top leads back.
        type: 'button', class: 'btn-text', onclick: () => { minePerson = r.p.key; if (personal) location.hash = '#team'; else setView('mine'); },
      }, `הרשימה של ${r.p.name}`),
      summaryActions(r.p.key, 'row'),
      r.opened ? h('span', { class: 'muted small' }, `נפתח היום ${hm(r.opened)}`) : null)));
}

function jumpLinks(items) {
  return h('nav', { class: 'ctl-nav', 'aria-label': 'חלקי הבקרה' },
    h('ul', { class: 'chips-row' }, ...items.filter(Boolean).map(([id, label, n]) => h('li', {},
      h('button', {
        type: 'button', class: 'chip', onclick: () => { const el = $(id); el?.scrollIntoView({ block: 'start' }); el?.focus({ preventScroll: true }); },
      }, label, n === null || n === undefined ? null : h('span', { class: 'n' }, String(n)))))));
}

function renderControl() {
  const now = new Date();
  const rows = personRows();
  const { late: stuck, waiting } = controlLists(now);
  const byClient = new Map();
  for (const w of waiting) (byClient.get(w.c.id) || byClient.set(w.c.id, { c: w.c, list: [] }).get(w.c.id)).list.push(w.x);
  const teamOpened = store.get(openedKey('team'));
  const urgentN = openUrgent().length;
  const sw = statusNotes === null ? null : statusWeek(now);
  const health = integrity(now);

  fill($('control'),
    jumpLinks([
      urgentN ? ['ctl-urgent', 'דחוף', urgentN] : null,
      ['ctl-esc', 'חריגות', openEscalations().length],
      ['rv-h', 'הבקרה של היום', null],
      ['ctl-people', 'לפי עובד', null],
      ['ctl-late', 'באיחור', stuck.length],
      ['ctl-wait', 'ממתין ללקוח', byClient.size],
      ['ctl-status', 'סיכום מצב שבועי', sw ? `${sw.done}/${sw.total}` : null],
      ['ctl-editors', 'עומס עורכים', null],
      ['ctl-health', 'תקינות המערכת', health.idle.length + health.noDue.length + health.missing.length + lateByClient(health.late).length],
    ]),
    urgentSection(now),
    escalationSection(now),
    reviewPanel(now, rows),
    h('div', { class: 'team-summary' }, summaryActions('team', 'control'),
      teamOpened ? h('span', { class: 'muted small' }, `נפתח היום ${hm(teamOpened)}`) : null),
    h('h2', { class: 'wgroup-h', id: 'ctl-people', tabindex: '-1' }, 'לפי עובד', h('span', { class: 'muted small' }, 'נספר בתהליכים')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'qtable ctable' },
      h('thead', {}, h('tr', {}, ...PERSON_COLS.map((t) => h('th', { scope: 'col' }, t)), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'פעולות')))),
      h('tbody', {}, ...rows.filter((r) => !r.p.editor).map(personRow)),
      h('tbody', { class: 'editors-group' },
        h('tr', { class: 'group-row' }, h('th', { scope: 'colgroup', colspan: String(PERSON_COLS.length + 1) }, 'עורכים')),
        ...rows.filter((r) => r.p.editor).map(personRow)))),
    h('h2', { class: 'wgroup-h', id: 'ctl-late', tabindex: '-1' }, 'באיחור אצלנו', h('span', { class: 'n' }, String(stuck.length))),
    stuck.length
      ? capList(h('ul', { class: 'stuck' }, ...stuck.map(({ c, lateProcs, lateTasks }) => h('li', {},
        h('a', { href: clientUrl(c.id), class: 'wclient' }, clientLabel(c)),
        clientNotes(c, now),
        h('ul', {},
          ...lateProcs.map((x) => h('li', {},
            h('a', { href: clientUrl(c.id, `#${x.proc.id}`) }, procLabel(x.proc)), ' ',
            peopleChips(peopleOf(x)),
            x.proc.owners.length > 1 && !x.claim ? h('span', { class: 'tag' }, 'לא נלקח') : null,
            h('span', { class: 'muted num' }, ` · יעד ${formatWhen(x.dueAt)}`))),
          ...lateTasks.map((t) => h('li', {},
            h('a', { href: clientUrl(c.id, '#tasks') }, `משימה: ${t.title}`), ' ', personChip(t.owner), taskBadge(t),
            h('span', { class: 'muted num' }, ` · עד ${formatDay(t.due_on)}`))))))), 6, 'ctl:late')
      : h('p', { class: 'empty' }, 'אין לקוחות עם תהליכים או משימות באיחור.'),
    h('h2', { class: 'wgroup-h', id: 'ctl-wait', tabindex: '-1' }, 'ממתין ללקוח · צריך ליצור קשר', h('span', { class: 'n' }, String(byClient.size))),
    byClient.size
      ? capList(h('ul', { class: 'stuck waiting-list' }, ...[...byClient.values()].map(({ c, list }) => h('li', {},
        h('div', { class: 'wait-head' }, h('a', { href: clientUrl(c.id), class: 'wclient' }, clientLabel(c)), contactLinks(c)),
        clientNotes(c, now),
        h('ul', {}, ...list.map((x) => h('li', {},
          h('a', { href: clientUrl(c.id, `#${x.proc.id}`) }, procLabel(x.proc)),
          h('span', { class: 'muted' }, ` · מאז ${formatStamp(x.wait.at)}`),
          x.wait.reason ? h('span', {}, ` · ״${x.wait.reason}״`) : null,
          x.wait.recheck ? h('span', { class: 'muted' }, ` · לבדוק שוב: ${dayShort(x.wait.recheck)}`) : null,
          recheckDue(x.wait) ? h('span', { class: 'tag tag-warn' }, 'הגיע מועד הבדיקה') : null,
          businessDaysBetween(new Date(x.wait.at), now) > 2 ? h('span', { class: 'tag' }, 'ממתין יותר מיומיים') : null)))))), 6, 'ctl:wait')
      : h('p', { class: 'empty' }, 'אין לקוחות שממתינים להם.'),
    statusSection(now),
    editorSection(now),
    healthSection(now),
  );
}

// ── Performance: screen 4, the team (section 6; decision 22) ──
let perfDays = 30;
const perfLog = new Map(); // days -> { rows, changes }
const baseId = (proc) => proc.id.replace(/^r\d+-/, '');

// Processes closed in the window, with their due date and how long they took,
// in office minutes (the protocol's target too). A process closed entirely as
// "not relevant" is not counted, and neither is imported history. Waiting on the
// client is not the employee's time, and neither is editing stopped for someone
// else's task: both are taken off the duration and move the deadline (app/health.js).
function closings(days, now, log = null) {
  return closedProcesses(clients, { stateOf, checksByClient: checks, since: new Date(now.getTime() - days * 864e5), now, log });
}
const medianRow = (rows, f) => {
  const r = rows.filter((x) => x[f] !== null).sort((a, b) => a[f] - b[f]);
  return r.length ? r[Math.floor((r.length - 1) / 2)] : null;
};
const FEW = 5;
function onTimeCell(done, onTime) {
  if (done < FEW) return h('span', { class: 'muted' }, `מעט מדי נתונים (${done})`);
  return h('span', { class: 'rate' }, `${onTime} מתוך ${done} (${Math.round((onTime / done) * 100)}%) `,
    h('span', { class: 'pbar', role: 'img', 'aria-label': `בזמן: ${onTime} מתוך ${done}` },
      h('span', { class: 'pbar-fill', style: `inline-size:${Math.round((onTime / done) * 100)}%` })));
}

// Weekly calls (31): logged calls out of the client-weeks the call was due
// (imported history is not a call made that week).
function weeklyCalls(log, days, now) {
  const since = new Date(now.getTime() - days * 864e5);
  let due = 0; let done = 0;
  for (const c of clients.filter(live)) {
    if (inLanding(c)) continue;
    const s = stateOf(c).states.find((x) => x.proc.id === 'p31');
    if (!s?.startAt) continue;
    const from = new Date(Math.max(since, s.startAt));
    const weeks = Math.floor((now - from) / (7 * 864e5));
    if (weeks <= 0) continue;
    due += weeks;
    const hit = new Set(log.filter((l) => l.client_id === c.id && l.item_key === 'p31.call' && l.action === 'done' && l.note !== IMPORT_NOTE && new Date(l.at) >= from)
      .map((l) => Math.floor((new Date(l.at) - from) / (7 * 864e5))).filter((i) => i < weeks));
    done += hit.size;
  }
  return { due, done };
}

// Editing jobs an editor holds now, against the cap (null for anyone else).
const editorLoad = (key) => (EDITORS.includes(key) ? editingJobs().filter((j) => j.editor === key).length : null);
const TEAM_COLS = ['עובד', 'פתוחים', 'באיחור', 'להשבוע', 'בזמן', 'זמן חציוני מול נורמה', 'עומס עריכה', 'החזרות לתיקון', 'לא רלוונטי', 'שינויי מועד'];

async function renderPerformance() {
  const box = $('performance');
  const now = new Date();
  const own = scope === 'own';
  const viewer = { me, scope, error: viewerError };
  const chips = h('div', { class: 'chips-row', role: 'group', 'aria-label': 'תקופה' }, ...[30, 90].map((d) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(perfDays === d), onclick: () => { perfDays = d; renderPerformance(); },
  }, `${d} הימים האחרונים`)));
  const intro = h('p', { class: 'perf-intro' }, 'נמדד מהיעד המחושב עד שהתהליך נסגר. הזמנים בשעות העבודה: א׳–ה׳, בלי חגים, 09:00–18:00 (בערב חג עד 13:00). תהליך שכולו ״לא רלוונטי״ לא נספר, וגם לא היסטוריה שיובאה. זמן שבו התהליך המתין ללקוח לא נספר, וגם לא עריכה שנעצרה בגלל משימה של מישהו אחר: הם יורדים מהזמן בפועל, והיעד הוארך בהם אם התחילו לפני היעד.');
  const days = perfDays;
  if (!perfLog.has(days)) {
    fill(box, chips, intro, h('p', { class: 'state' }, 'מחשב…'));
    const since = new Date(now.getTime() - days * 864e5).toISOString();
    try {
      // Returns to fix count against the whole history of their items, not just the window's.
      const hist = historyKeys(clients);
      const [rows, changes, full] = await Promise.all([loadAllLog(since), loadDateChanges({ sinceIso: since }).catch(() => null), loadLogFor(hist).catch(() => null)]);
      perfLog.set(days, { rows: withHistory(rows, full, hist), changes });
    } catch (err) {
      if (view !== 'performance' || days !== perfDays) return;
      fill(box, chips, intro, h('div', { class: 'state' }, `הנתונים לא נטענו. ${errorText(err)} `,
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => renderPerformance() }, 'ניסיון נוסף')));
      return;
    }
    if (view !== 'performance' || days !== perfDays) return;
  }
  const { rows: log, changes } = perfLog.get(days);
  const rows = closings(days, now, log);
  const calls = weeklyCalls(log, days, now);
  const byProc = PROCESSES.filter((p) => !p.recurring).map((p) => ({ p, list: rows.filter((r) => r.key === p.id) })).filter((x) => x.list.length);
  const procTable = !byProc.length ? h('p', { class: 'empty' }, 'עוד אין מספיק תהליכים שנסגרו בתקופה הזו. הנתונים יופיעו אחרי שייסגרו תהליכים עם יעד מחושב.')
    : h('div', { class: 'table-wrap' }, h('table', { class: 'qtable ctable perf-table' },
      h('caption', { class: 'sr-only' }, 'לפי תהליך'),
      h('thead', {}, h('tr', {}, ...['תהליך', 'זמן ביצוע בפרוטוקול', 'נסגרו', 'בזמן', 'זמן בפועל (חציון)', 'יעד'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, ...byProc.map(({ p, list }) => {
        const onTime = list.filter((r) => r.onTime).length;
        const med = medianRow(list, 'min');
        const tgt = medianRow(list, 'targetMin');
        const flag = list.length >= FEW && med && tgt && med.min > 2 * tgt.targetMin;
        return h('tr', {},
          h('td', { 'data-label': 'תהליך', class: 'client' },
            h('details', { class: 'perf-proc' }, h('summary', {}, `${p.num} · ${p.title}`),
              h('ul', {}, ...list.sort((a, b) => b.completedAt - a.completedAt).map((r) => h('li', {},
                `${r.client.name}${roundOf(r.proc) ? ` · סבב ${roundOf(r.proc)}` : ''} · יעד ${formatWhen(r.dueAt, now)} · נסגר ${formatWhen(r.completedAt, now)}${r.min !== null ? ` · ${officeMinutes(r.min)} בשעות העבודה` : ''}${r.onTime ? '' : ' · אחרי היעד'}`)))),
            flag ? h('span', { class: 'tag tag-warn' }, 'כדאי לבדוק את התהליך או את היעד') : null),
          h('td', { 'data-label': 'זמן ביצוע בפרוטוקול', class: 'client sla' }, p.sla),
          h('td', { 'data-label': 'נסגרו', class: 'num' }, String(list.length)),
          h('td', { 'data-label': 'בזמן', class: 'client' }, onTimeCell(list.length, onTime)),
          h('td', { 'data-label': 'זמן בפועל (חציון)' }, med ? officeMinutes(med.min) : '—'),
          h('td', { 'data-label': 'יעד' }, tgt ? officeMinutes(tgt.targetMin) : '—'));
      }))));

  // One row per person: open, late and this week; on time; median against the
  // norm; an editor's load against the cap; returns to fix; and the anti-gaming
  // counts ("not relevant" on a required item, deadline changes).
  const team = (keys) => teamRows(keys, {
    work: (k) => workFor(k), rows, log, changes, directory, jobs: editorLoad, clients, since: new Date(now.getTime() - days * 864e5), now,
  });
  const personRow = (r) => h('tr', {},
    h('td', { 'data-label': 'עובד' }, personChip(r.key)),
    h('td', { 'data-label': 'פתוחים', class: 'num' }, String(r.open)),
    h('td', { 'data-label': 'באיחור', class: r.late ? 'late num' : 'num' }, String(r.late)),
    h('td', { 'data-label': 'להשבוע', class: 'num' }, String(r.week)),
    h('td', { 'data-label': 'בזמן', class: 'client' }, onTimeCell(r.done, r.onTime)),
    h('td', { 'data-label': 'זמן חציוני מול נורמה' }, r.median === null ? '—' : `${officeMinutes(r.median)}${r.norm ? ` · נורמה ${officeMinutes(r.norm)}` : ''}`),
    h('td', { 'data-label': 'עומס עריכה' }, r.load === null ? '—' : [`${r.load} מתוך ${r.cap}`, r.load > r.cap ? h('span', { class: 'tag tag-warn' }, 'מעל התקרה') : null]),
    h('td', { 'data-label': 'החזרות לתיקון', class: 'num' }, String(r.rework)),
    h('td', { 'data-label': 'לא רלוונטי', class: 'num' }, String(r.na)),
    h('td', { 'data-label': 'שינויי מועד', class: 'num' }, r.moves === null ? '—' : String(r.moves)));
  const personTable = (caption, keys) => {
    const list = team(keys);
    const office = list.filter((r) => !PEOPLE[r.key]?.editor);
    const editors = list.filter((r) => PEOPLE[r.key]?.editor);
    return h('div', { class: 'table-wrap' }, h('table', { class: 'qtable ctable perf-table perf-people' },
      h('caption', { class: 'sr-only' }, caption),
      h('thead', {}, h('tr', {}, ...TEAM_COLS.map((t) => h('th', { scope: 'col' }, t)))),
      office.length ? h('tbody', {}, ...office.map(personRow)) : null,
      editors.length ? h('tbody', { class: 'editors-group' },
        office.length ? h('tr', { class: 'group-row' }, h('th', { scope: 'colgroup', colspan: String(TEAM_COLS.length) }, 'עורכים')) : null,
        ...editors.map(personRow)) : null));
  };

  // Decision 22: the owner and Lior see everyone; everyone else sees only their own row.
  fill(box, chips, intro,
    me ? h('section', { class: 'perf-me', 'aria-label': 'הנתונים שלי' }, h('h2', { class: 'wgroup-h' }, 'הנתונים שלי'), personTable('הנתונים שלי', [me])) : null,
    own ? null : [
      h('h2', { class: 'wgroup-h' }, 'לפי תהליך'),
      h('p', { class: 'perf-intro' }, 'אחוז נמוך בתהליך הוא קודם כול סימן לבדוק את התהליך או את היעד.'),
      procTable,
      h('h2', { class: 'wgroup-h' }, 'שיחה שבועית (31)'),
      h('p', { class: 'perf-calls' }, calls.due ? `שיחות שתועדו: ${calls.done} מתוך ${calls.due} שבועות־לקוח` : 'עוד אין לקוחות בשלב השיחות השבועיות בתקופה הזו.')],
    seesWholeTeam(viewer) ? h('section', { class: 'perf-team', 'aria-label': 'הצוות' },
      h('h2', { class: 'wgroup-h' }, 'הצוות'),
      h('p', { class: 'perf-intro' }, `כל אחד בצוות רואה רק את השורה שלו. אין טבלת דירוג. עומס עריכה: לקוחות בעריכה מול תקרה של ${EDITOR_CAP}. ״לא רלוונטי״ ושינויי מועד נספרים לפי מי שסימן.`),
      personTable('הצוות', STAFF_PEOPLE().map((p) => p.key))) : null);
}

// ── New client: the deal details, or an existing client imported mid-way ──
const dlg = $('dlg-new');
let quotesForNew = [];
let importing = false;
let derivedShoot = false;   // the shoot type shown was set from the package, not picked
let pendingChecks = null;   // the client opened but its first checks did not save: submitting retries only them
const P01 = ['p01.prepared', 'p01.sent', 'p01.signed'];
const pad2 = (n) => String(n).padStart(2, '0');
// Date inputs are in Israel time, whatever the device's zone.
const toLocalInput = (v) => inputValueIL(new Date(v));
const fromLocalInput = (v) => (v ? fromInputIL(v)?.toISOString() ?? null : null);
const quoteOf = () => quotesForNew.find((x) => x.id === $('new-quote').value) || null;
// The agreement's add-ons count only while its own package is the one chosen.
const selectionFor = (pkg, q) => (q && q.package_id === pkg ? q.selection : null);
const delivText = (d) => [...DELIVERABLES.map((x) => [x.label, d[x.key]]), ['ימי צילום', d.shoot_days]]
  .filter(([, n]) => n > 0).map(([l, n]) => `${l} ${n}`).join(' · ');
// A field fixed after a failed save stops being marked; the message goes when none is left.
function clearInvalid(el) {
  if (!el?.hasAttribute('aria-invalid')) return;
  el.removeAttribute('aria-invalid');
  if (!dlg.querySelector('[aria-invalid]')) $('new-err').hidden = true;
}

fill($('new-package'), h('option', { value: '' }, 'לא מהקטלוג (כמויות בכרטיס)'), ...PACKAGE_OPTIONS.map((p) => h('option', { value: p.id }, p.name)));
fill($('new-station'), h('option', { value: '' }, 'בחירת תחנה'), ...STATIONS.map((st, i) => h('option', { value: st.key }, `${i + 1}. ${st.title}`)));

function setMode(imp) {
  importing = imp;
  $('new-mode-new').setAttribute('aria-pressed', String(!imp));
  $('new-mode-import').setAttribute('aria-pressed', String(imp));
  $('new-import').hidden = !imp;
  $('new-station').required = imp;
  $('new-submit').textContent = imp ? 'ייבוא הלקוח' : 'פתיחת כרטיס לקוח';
}
$('new-mode-new').addEventListener('click', () => setMode(false));
$('new-mode-import').addEventListener('click', () => { setMode(true); $('new-station').focus(); });

// Quantities and the shoot type follow the package, for manual opens too.
function packageChanged() {
  const pkg = $('new-package').value;
  const q = quoteOf();
  const d = dealDeliverables(pkg, selectionFor(pkg, q));
  $('new-package-hint').textContent = Object.keys(d).length
    ? `בכרטיס: ${delivText(d)}${selectionFor(pkg, q) ? ' (כולל התוספות בהסכם)' : ''}`
    : 'את הכמויות מזינים בכרטיס הלקוח.';
  const st = shootTypeOf(pkg);
  if (st) { $('new-shoot-type').value = st; clearInvalid($('new-shoot-type')); } else if (derivedShoot) $('new-shoot-type').value = '';
  derivedShoot = !!st;
  $('new-shoot-hint').textContent = st ? 'לפי החבילה.' : 'לבחור במפורש.';
}
$('new-package').addEventListener('change', packageChanged);
$('new-shoot-type').addEventListener('change', () => { derivedShoot = false; $('new-shoot-hint').textContent = ''; });
for (const type of ['input', 'change']) dlg.addEventListener(type, (e) => clearInvalid(e.target));

// The client opened but its first checks did not save. Closing drops the retry, and
// nothing else can redo an import: everything before the station would show as late.
// So the dialog closes only after the user agrees to lose them.
const unsaved = () => !!(pendingChecks && (pendingChecks.signed.length || pendingChecks.imported.length));
let letGo = false;
function mayClose() {
  if (!unsaved()) return true;
  letGo = confirm(pendingChecks.imported.length
    ? 'הלקוח כבר נפתח, אבל סימוני הייבוא לא נשמרו. בלעדיהם כל מה שלפני התחנה יופיע באיחור, ואי אפשר להריץ את הייבוא שוב. לסגור בכל זאת?'
    : 'הלקוח כבר נפתח, אבל הסימון של תהליך 1 (נחתם במערכת) לא נשמר. לסגור בכל זאת?');
  if (!letGo) $('new-submit').focus();
  return letGo;
}
dlg.addEventListener('click', (e) => { if ((e.target.closest('[data-close]') || e.target === dlg) && mayClose()) dlg.close(); });
dlg.addEventListener('cancel', (e) => { if (e.cancelable && !mayClose()) e.preventDefault(); });
dlg.addEventListener('close', () => {
  // An Escape the browser does not let the page stop: reopen, with the retry still there.
  if (unsaved() && !letGo) { dlg.showModal(); $('new-submit').focus(); return; }
  letGo = false;
  // Closed after the client opened: the list shows it.
  if (pendingChecks) { pendingChecks = null; load(); }
});
$('btn-new').addEventListener('click', async () => {
  $('new-form').reset();
  $('new-err').hidden = true;
  for (const el of dlg.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  pendingChecks = null;
  derivedShoot = false;
  setMode(false);
  packageChanged();
  $('new-submit').disabled = false;
  dlg.showModal();
  $('new-name').focus();
  try {
    quotesForNew = await signedQuotes();
  } catch { quotesForNew = []; }
  $('from-quote-field').hidden = !quotesForNew.length;
  fill($('new-quote'), h('option', { value: '' }, 'בלי הסכם (מילוי ידני)'),
    ...quotesForNew.map((q) => h('option', { value: q.id }, `${q.number} · ${q.client_name}${q.company ? ` (${q.company})` : ''} · נחתם ${formatDay(q.signed_at)}`)));
});
$('new-quote').addEventListener('change', () => {
  const q = quoteOf();
  if (!q) { packageChanged(); return; }
  $('new-name').value = q.client_name || '';
  $('new-business').value = q.company || '';
  $('new-phone').value = q.phone || '';
  // The shoot type comes from the agreement's package in the catalog.
  $('new-package').value = PACKAGES[q.package_id] ? q.package_id : '';
  packageChanged();
  const p = partsIL(new Date(q.signed_at));
  $('new-contract-end').value = dayKeyIL(dateIL(p.year, p.month + (Number(q.term_months) || 12), p.day, 12));
  $('new-deal-at').value = q.signed_at ? toLocalInput(q.signed_at) : '';
});

// The client's first checks: process 1 when it was signed in the system, and the
// import of everything before its station. Each batch saves whole or not at all.
async function saveFirstChecks(p) {
  if (p.signed.length) { await setChecksBulk(p.row.id, p.signed, 'done', p.signedNote); p.signed = []; }
  if (p.imported.length) { await setChecksBulk(p.row.id, p.imported, 'done', IMPORT_NOTE); p.imported = []; }
}

$('new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fail = (msg, el = null) => {
    $('new-err').textContent = msg; $('new-err').hidden = false;
    if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
  };
  $('new-err').hidden = true;
  for (const el of dlg.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  $('new-submit').disabled = true;
  const done = async () => {
    try {
      await saveFirstChecks(pendingChecks);
      location.href = clientUrl(pendingChecks.row.id);
    } catch (err) {
      fail(`הלקוח נפתח, אבל הסימונים ${pendingChecks.imported.length ? 'של הייבוא ' : ''}לא נשמרו (${errorText(err)}). לחיצה נוספת תנסה לשמור אותם שוב.`);
      $('new-submit').textContent = 'שמירת הסימונים';
      $('new-submit').disabled = false;
    }
  };
  if (pendingChecks) return done();

  const name = $('new-name').value.trim();
  const shoot = $('new-shoot-type').value;
  const station = importing ? $('new-station').value : '';
  const invalid = !name ? ['חסר שם לקוח.', $('new-name')]
    : !shoot ? ['חסר סוג יום הצילום: נטלי דדון, או דניס, מישל וסמיון.', $('new-shoot-type')]
      : importing && !station ? ['בחרו את התחנה שבה הלקוח נמצא עכשיו.', $('new-station')] : null;
  if (invalid) { $('new-submit').disabled = false; return fail(...invalid); }
  const q = quoteOf();
  const pkg = $('new-package').value;
  const val = (id) => $(id).value.trim() || null;
  const fields = {
    name, business: val('new-business'), phone: val('new-phone'),
    package_name: packageName(pkg) || (q ? [q.tier, q.influencer].filter(Boolean).join(' · ') || null : null),
    shoot_type: shoot, contract_end: val('new-contract-end'), quote_id: q?.id || null,
    deliverables: dealDeliverables(pkg, selectionFor(pkg, q)),
  };
  // The deal clock starts at the signature. A new deal without an agreement
  // reaches the office now (the database default); an import may know its dates.
  const typed = importing ? $('new-deal-at').value : '';
  const dealAt = q?.signed_at && (!typed || typed === toLocalInput(q.signed_at)) ? q.signed_at : fromLocalInput(typed);
  if (dealAt) fields.deal_at = dealAt;
  if (importing) {
    fields.char_at = fromLocalInput($('new-char-at').value);
    fields.shoot_at = fromLocalInput($('new-shoot-at').value);
  }
  let row;
  try {
    row = await createClient(fields);
  } catch (err) {
    $('new-submit').disabled = false;
    return fail(errorText(err));
  }
  // An agreement signed in the system already covers process 1.
  const signed = q ? P01 : [];
  pendingChecks = {
    row, signed, signedNote: q ? `נחתם במערכת: ${q.number}` : null,
    imported: importing ? importKeys(station, { shootSet: !!fields.shoot_at }).filter((k) => !signed.includes(k)) : [],
  };
  return done();
});

$('btn-refresh').addEventListener('click', () => { perfLog.clear(); load(); });
window.addEventListener('hashchange', () => {
  if ($('app').hidden) return;
  // The address may belong to the other profile (the button at the top, a link): the tabs follow it.
  const moved = syncProfile();
  if (moved) { applyScope(); renderMe(); syncMetricoolConnect(); }
  const v = viewOfHash();
  if (tabsShown().includes(v) && (v !== view || moved)) setView(v);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden && !busy()) load(); });
// Statuses depend on the clock: every minute, even in a background tab, check
// for processes that turned overdue (for the notification); render only when visible.
// With notifications on, a background tab also reloads the data every 5 minutes.
function tick() {
  if ($('app').hidden) return;
  states.clear();
  // Fresh data every 5 minutes: a screen left open all day shows other people's checks.
  if (Date.now() - lastLoad > 5 * 60e3 && (document.hidden ? notifyState() === 'on' : !busy())) { load(); return; }
  rebuildClocks();
  checkLate();
  if (!document.hidden && !busy()) renderKeepingFocus();
}
setInterval(tick, 60e3);

mountSession(async (staff) => {
  const [dir, viewer] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  ({ me, scope } = viewer);
  viewerError = viewer.error;
  // Everyone's first screen (app/office-ui.js firstScreenOf): the editors' page, Eli's
  // shoot days, and the manager view for whoever chose that profile on this browser;
  // the owners, Ofir and Lior otherwise stay here, in their personal profile. Only
  // when the tab opens here without a view, once per tab; "המשימות שלי" stays #mine.
  // Sales (Stav) have no client work: always their own page.
  if (landingOf(me)) { location.replace(landingOf(me)); return KEEP_BOOT; }
  const first = landingNow({ me, viewer, arrived: ARRIVED_WITH || location.hash });
  if (first) { location.replace(first); return KEEP_BOOT; }
  // The shortcuts of each role in the page head: the editors' page; the shoot day
  // (Eli's page, Lior's shoot-day mode and the counter the office watches); the
  // office's screens (Ofir's queue and pass, Lior's decisions).
  $('cta-editor').hidden = !PEOPLE[me]?.editor;
  $('cta-shoot').hidden = !(me === 'eli' || (scope === 'office' && !viewer.error));
  $('cta-prep').before(...officeLinks(viewer)); // after "מה דורש אותי", before the rest
  // Screen 2, "כל הלקוחות במבט", for Lior; screen 1 for the managers (the owner, Irit, Ofir).
  // The top bar folds away on phones: the page head keeps a way in (cta-owner).
  for (const el of [$('nav-owner'), $('cta-owner')]) {
    el.hidden = !canSeeAllClients(viewer);
    if (!canSeeOwnerScreen(viewer)) { el.href = 'owner.html#all'; el.textContent = 'כל הלקוחות במבט'; }
  }
  $('nav-team').hidden = !canManageTeam(viewer);
  // The top bar folds away on phones: the page head keeps a way in to the messages.
  $('nav-messages').hidden = $('cta-messages').hidden = !canSendMessages(viewer);
  // Before the shoot day and client requests (prep.html): the office's.
  $('nav-prep').hidden = $('cta-prep').hidden = scope !== 'office' || !!viewerError;
  // Always land on the signed-in person's own list; the owner lands on the whole team.
  minePerson = scope === 'own' ? me : me || '';
  syncProfile();
  applyScope();
  renderMe();
  // Notifications on the phone and today's list (app/push.js); the owner's list is 'owner'.
  // (The cards here each ask for their own rows; the page is shown when they have
  // answered, so none lands above a list that is already on the screen: bootEnd in protocol-ui.js.)
  mountPush({
    who: me || (scope === 'office' && !viewerError ? 'owner' : null), card: $('push-card'), button: $('btn-inbox'), dialog: $('dlg-inbox'),
    changed: () => { if (view === 'mine' && !$('app').hidden && !busy()) renderKeepingFocus(); },
  });
  mountWhatsappCard($('push-card')); // stage 4: WhatsApp on or off, under the notifications card
  // "היומן שלי": the personal calendar link (app/calendar-card.js).
  if (!viewerError) mountCalendar($('cal-card'));
  // Tasks given on the spot: the ones this person got ("בוצע"), and giving them (Irit, the owner).
  mountStaffTasks($('staff-tasks-card'), { me, scope, error: viewerError });
  // Stav's deals waiting for a contract (the office): "להכין חוזה ל־…" with its clock.
  mountDeals($('deals-card'), { me, scope, error: viewerError });
  // Exceptional contracts: the approvers decide here; Irit sees "ממתין לאישור", "אושר — אפשר לשלוח", "לא אושר".
  mountApprovals($('approvals-card'), { me, scope, error: viewerError }, { mail: staff.email, toast, changed: refreshDeals });
  // Ilai: the active clients that are not connected to a Metricool brand yet. The owners
  // have the card in the manager profile only ("עבודת הצוות"), not among their own tasks.
  mountMetricoolConnect($('metricool-card'), { me, scope, error: viewerError }, { personal: () => personal });
  const fromHash = viewOfHash();
  view = tabsShown().includes(fromHash) ? fromHash : 'mine';
  await load();
  setView(view);
});
