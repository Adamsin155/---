// "מעקב לקוחות" (tracking.html; the owner's request of 9.11.2026, for Irit): one table, a row per
// client in work, with the editor and the videos, graphics and shoot days against the package.
// Three tabs since 10.11.2026 (Irit): "סרטונים וגרפיקות" (this table), "ימי צילום"
// (app/tracking-shoots.js) and "משימות לעורכים ולגרפיקאי" (app/tracking-tasks.js); the open one is
// in the address (#shoots, #tasks) and kept on this device for the next visit.
// The owners and the managers (Irit, Lior, Ofir: isManager), and Ilai (the first tab only).
// A number is fixed by hand (10.11.2026): Irit and the owners tap it; Ilai the graphics only;
// Lior and Ofir read (app/tracking-fix-logic.js, the dialogs app/tracking-fix.js). Nothing of
// money is read (the work columns only, as the editors' pages read them).
// The counting: app/tracking-logic.js; docs/ops.md, section 122.
import { loadChecks, loadDirectory } from './protocol-data.js';
import { loadWorkClients, loadEditorProgress, loadEditorMonths } from './production-data.js';
import { loadPostedGraphics } from './gantt-data.js';
import { monthKey, isMonthly } from './edit-count.js';
import { $, fill, h, errorText, mountSession, directory, viewerOf } from './protocol-ui.js';
import { trackingRows, searchTracking, complete, ratioText, shootDates, clientsWord } from './tracking-logic.js';
import { canOpenTracking, onlyFirstTab, canFix, canFixKind, fixLine } from './tracking-fix-logic.js';
import { canAssignFromCard } from './card-assign-logic.js';
import { openCountFix } from './tracking-fix.js';
import { showShoots, setShootsViewer } from './tracking-shoots.js';
import { renderTasksTab } from './tracking-tasks.js';

let rows = [];
let clientsById = new Map();
let viewer = null;
let q = '';
let lastLoad = 0;
const cardUrl = (id) => `client.html?id=${encodeURIComponent(id)}`;

// ── Data ────────────────────────────────────
let inflight = null;
function load() {
  inflight ||= doLoad().finally(() => { inflight = null; });
  return inflight;
}
async function doLoad() {
  if (!rows.length) $('state').textContent = 'טוען…';
  const now = new Date();
  try {
    // The counters and the Gantt are extras: a table that cannot be read counts as nothing typed.
    const [clients, checks, progress, months, posted] = await Promise.all([
      loadWorkClients(), loadChecks(),
      loadEditorProgress().catch(() => null), loadEditorMonths(null, monthKey(now)).catch(() => null), loadPostedGraphics(),
    ]);
    rows = trackingRows(clients, { checks, progress, months, posted }, now);
    clientsById = new Map(clients.map((c) => [c.id, c]));
    if (!onlyFirstTab(viewer)) showShoots(clients, checks, now);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  lastLoad = Date.now();
  $('state').textContent = '';
  render();
}

// ── Render ──────────────────────────────────
// A count: "7 / 25" (numbers left to right), a green ✓ when it is complete, and "החודש" for a
// monthly client's videos.
// Whoever may fix it taps the number (a button); "עודכן ביד · עירית · 10.11" under a number fixed by hand.
function countCell(r, kind, label, x, extra = null) {
  const ok = complete(x);
  const val = [
    h('span', { class: 'num', dir: 'ltr' }, ratioText(x)),
    x.month ? h('span', { class: 'ct-month' }, ' החודש') : null,
    ok ? h('span', { class: 'ct-ok', role: 'img', 'aria-label': 'הושלם' }, '✓') : null];
  const fixes = canFixKind(viewer, kind);
  return h('td', { 'data-label': label, 'data-kind': kind, class: `${ok ? 'ct-n is-done' : 'ct-n'}${x.fix ? ' is-fixed' : ''}` },
    fixes ? h('button', {
      type: 'button', class: 'ct-val ct-fix', 'data-fix': kind, 'aria-label': `תיקון ${label} של ${r.label}: ${ratioText(x)}`,
      onclick: (e) => openFix(r, kind, e.currentTarget),
    }, ...val, h('span', { class: 'ct-pen', 'aria-hidden': 'true' }, '✎')) : h('span', { class: 'ct-val' }, ...val),
    x.fix ? h('span', { class: 'ct-by' }, fixLine(x.fix)) : null,
    extra);
}
function openFix(r, kind) {
  const client = clientsById.get(r.id);
  if (!client) return;
  const x = kind === 'videos' ? r.videos : kind === 'graphics' ? r.graphics : r.shoots;
  openCountFix({ client, kind, x, viewer, month: kind === 'videos' && isMonthly(client) ? monthKey(new Date()) : null, saved: () => load() });
}
function row(r) {
  const dates = shootDates(r.shoots);
  // "שינוי": the editor's dialog of the client card (app/assign-dialog.js), opened there (#assign).
  const change = canFix(viewer) && canAssignFromCard(viewer)
    ? h('a', { class: 'ct-ed-change', href: `${cardUrl(r.id)}#assign`, 'aria-label': `${r.editor ? 'שינוי' : 'שיוך'} עורך ל${r.label}` }, r.editor ? 'שינוי' : 'שיוך')
    : null;
  return h('tr', { 'data-id': r.id, id: `ct-${r.id}` },
    h('td', {}, h('a', { class: 'mt-name', href: cardUrl(r.id) }, r.label)),
    h('td', { 'data-label': 'עורך', class: 'ct-ed' }, h('span', { class: 'ct-ed-in' }, h('span', {}, r.editor || '—'), change)),
    countCell(r, 'videos', 'סרטונים נערכו', r.videos),
    countCell(r, 'graphics', 'גרפיקות הועלו', r.graphics),
    countCell(r, 'shoots', 'ימי צילום', r.shoots, dates.length ? h('span', { class: 'ct-dates' }, ...dates.map((t) => h('span', {}, t))) : null));
}
function render() {
  if ($('ct-q').value !== q) $('ct-q').value = q;
  const shown = searchTracking(rows, q);
  fill($('ct-body'), shown.length ? shown.map(row)
    : [h('tr', { class: 'ct-none' }, h('td', { class: 'mt-empty', colspan: '5' }, rows.length ? 'אין לקוח בשם הזה.' : 'אין לקוחות בעבודה.'))]);
  $('ct-count').textContent = shown.length === rows.length ? clientsWord(rows.length) : `${clientsWord(shown.length)} מתוך ${rows.length}`;
}

// ── Tabs ────────────────────────────────────
const TABS = ['videos', 'shoots', 'tasks'];
const PANEL = { videos: 'ct-view', shoots: 'view-shoots', tasks: 'view-tasks' };
const SUB = {
  videos: 'כל לקוח בעבודה: מי עורך, וכמה כבר נעשה מתוך החבילה.',
  shoots: 'כל לקוח שמגיעים לו ימי צילום: כמה נשארו, ומי עוד מחכה לתאריך.',
  tasks: 'המשימות הפתוחות של העורכים והגרפיקאי.',
};
const SAVED = 'tracking-tab';
let view = 'videos';
let tasksShown = false;
const saved = () => { try { return localStorage.getItem(SAVED); } catch { return null; } };
function setView(v, focus = false) {
  view = TABS.includes(v) ? v : 'videos';
  for (const t of TABS) {
    const tab = $(`tab-${t}`);
    tab.setAttribute('aria-selected', String(t === view));
    tab.tabIndex = t === view ? 0 : -1;
    $(PANEL[t]).hidden = t !== view;
  }
  $('ct-sub').textContent = SUB[view];
  if (focus) $(`tab-${view}`).focus();
  history.replaceState(null, '', location.pathname + location.search + (view === 'videos' ? '' : `#${view}`));
  try { localStorage.setItem(SAVED, view); } catch { /* a private window: the address keeps it */ }
  if (view === 'tasks' && !tasksShown && !$('ct-page').hidden) {
    tasksShown = true;
    Promise.resolve(renderTasksTab($('view-tasks'))).catch((err) => { tasksShown = false; $('view-tasks').textContent = errorText(err); });
  }
}
for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => setView(t));
$('ct-tabs').addEventListener('keydown', (e) => {
  const i = TABS.indexOf(view);
  const next = { ArrowLeft: TABS[(i + 1) % TABS.length], ArrowRight: TABS[(i + TABS.length - 1) % TABS.length], Home: TABS[0], End: TABS.at(-1) }[e.key];
  if (!next) return;
  e.preventDefault();
  setView(next, true);
});
setView(location.hash.slice(1) || saved());

// ── Boot ────────────────────────────────────
$('ct-q').addEventListener('input', (e) => { q = e.currentTarget.value; render(); });
$('btn-refresh').addEventListener('click', () => load());
document.addEventListener('visibilitychange', () => { if (!document.hidden && lastLoad && Date.now() - lastLoad > 60e3) load(); });

mountSession(async (staff) => {
  const [dir, v] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  if (v?.error || !canOpenTracking(v)) { $('no-access').hidden = false; return; }
  viewer = v;
  setShootsViewer(v, () => load());
  // Ilai: the first tab only, to fix his graphics.
  if (onlyFirstTab(v)) {
    $('ct-tabs').hidden = true;
    view = 'videos';
  }
  $('ct-page').hidden = false;
  setView(view);
  await load();
});
