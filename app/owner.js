// The owner's screens (owner.html; docs/plan/system-plan.md, section 6).
//  Screen 1, "מה דורש אותי" (the owner's; opens first for him): four numbers,
//   then up to 10 rows, most severe first: client, station, ONE name, one reason,
//   with "פתיחה" and "שאלה לאחראי" (the answer comes back to the row).
//  Screen 2, "כל הלקוחות במבט" (also Irit, Lior and Ofir): two lines per client,
//   tap for the rest, and the board of what happens this week and in 30 days.
// Everything is computed from what the team checks (app/health.js); nothing here
// is marked by hand except the question.
import { PEOPLE } from './protocol.js';
import { clientState, weekKey } from './protocol-logic.js';
import {
  loadClients, loadChecks, loadTasks, loadTasksDoneSince, loadAllLog, loadStatusNotes, loadReviews, loadDirectory,
} from './protocol-data.js';
import {
  loadMessagesSince, loadAccessStatus, loadDateChanges, loadQuestions, askQuestion, withdrawQuestion, loadLogFor,
} from './owner-data.js';
import {
  clientHealth, station, ownerRows, officeReasons, colorCounts, lateNow, shootsAhead, closedProcesses, onTimeTrend,
  trendSince, upcomingEvents, canSeeOwnerScreen, canSeeAllClients, personName, bySeverity, COLORS, dayText,
  historyKeys, withHistory,
} from './health.js';
import { healthBadge, reasonText, nextText, stationBar, markOwnerLanded } from './health-ui.js';
import {
  $, fill, h, toast, errorText, personChip, formatWhen, formatStamp, mountSession, directory, who, viewerOf, VIEWER_UNKNOWN, progressBar, capList
} from './protocol-ui.js';
import { canManageTeam } from './team-rules.js';
import { canSeeInsights } from './insights.js';
import { canSendMessages } from './messages-logic.js';
import { TZ, dayKeyIL, daysBetweenIL } from './tz.js';
// The manager profile (app/manager-rules.js): the table and the archive.
import { canArchive, canSeeTable, seesFinance, sameName } from './manager-rules.js';
import {
  tableRow, columnsFor, filterRows, sortRows, filterOptions, toCsv, csvName, DEFAULT_FILTERS, dayText as dmy, moneyText,
} from './manager-table.js';
import { fileCounts } from './contract-summary.js';
// The week's chart on screen 1 (the counting: app/week-chart.js) and the page's motion (app/shell.js).
import { weekClosings, weekSummary, weekLabel } from './week-chart.js';
import { countUp, growOnce, glide } from './shell.js';
import { loadFinance, loadDeliverableFiles, loadArchived, restoreClient, purgeClient } from './manager-data.js';

let viewer = null;
let isOwner = false;
let allClients = [];   // every client, for the on-time trend
let clients = [];      // active and ending: the ones with a colour
let checks = {};
let tasks = [];
let doneTasks = null;  // tasks marked done since Sunday, for the week's chart (null: not loaded)
let log = null;        // protocol_log of the last 8 weeks (null: not loaded)
let messages = null;   // client_messages of the last 30 days
let access = null;     // login statuses
let notes = null;      // Ofir's weekly summaries
let reviews = null;    // daily reviews (processes 32, 33)
let changes = null;    // date changes of the last 30 days
let questions = [];    // questions asked in the last 30 days
let entries = [];      // [{ client, state, health, station }]
// The manager table and the archive (app/manager-table.js, app/manager-data.js).
let mayTable = false;  // the owner, Irit, Ofir and Lior
let showMoney = false; // the owner, Irit and Ofir: the price columns (never Lior)
let mayArchive = false; // the owner and Ofir
let finance = null;    // the prices by client id (null: not loaded or not allowed)
let files = null;      // deliverables uploaded as files (null: no such table, or not readable)
let tableRows = [];    // one row per client, every status
let tableShown = [];   // what the table shows now, in order (the CSV exports this)
let filters = { ...DEFAULT_FILTERS };
let sortKey = 'color';
let sortDir = 'asc';
let archived = null;   // archived_clients() (null: not loaded)
let view = 'now';
let colorFilter = '';
let boardDays = 7;
let lastLoad = 0;
const expanded = new Set();
const states = new Map();
const stateOf = (c) => {
  if (!states.has(c.id)) states.set(c.id, clientState(c, checks[c.id] || {}, new Date()));
  return states.get(c.id);
};
const clientUrl = (id, hash = '') => `client.html?id=${encodeURIComponent(id)}${hash}`;
const hmFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const busy = () => $('dlg-ask').open || $('dlg-purge').open;
const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows || []) (m.get(r[key]) || m.set(r[key], []).get(r[key])).push(r);
  return m;
};

// ── Data ────────────────────────────────────
// One load at a time: the refresh button, coming back to the app and the timer
// share the one in flight, so a slower, older answer never overwrites a newer one.
let inflight = null;
function load() {
  inflight ||= doLoad().finally(() => { inflight = null; });
  return inflight;
}
async function doLoad() {
  if (!entries.length) $('state').textContent = 'טוען…';
  const now = new Date();
  try {
    [allClients, checks, tasks] = await Promise.all([loadClients({ includeEnded: true }), loadChecks(), loadTasks({ openOnly: true })]);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  clients = allClients.filter((c) => c.status === 'active' || c.status === 'ending');
  const since30 = new Date(now.getTime() - 30 * 864e5);
  const since = new Date(Math.min(+trendSince(now), +since30)).toISOString();
  // Each extra is optional: without it, its rule is left out, never assumed.
  // Rounds of corrections count the whole history of their items, not just the window's.
  const hist = historyKeys(clients);
  const got = await Promise.allSettled([
    loadAllLog(since), loadMessagesSince(since30.toISOString()), loadAccessStatus(),
    loadStatusNotes({ sinceWeek: weekKey(new Date(now.getTime() - 7 * 864e5)) }), loadReviews(dayKeyIL(new Date(now.getTime() - 14 * 864e5))),
    loadDateChanges({ sinceIso: since30.toISOString() }), loadQuestions({ sinceIso: since30.toISOString() }), loadLogFor(hist),
    showMoney ? loadFinance() : null, mayTable ? loadDeliverableFiles() : null,
    loadTasksDoneSince(officeWeekStart(now)),
  ]);
  const ok = (i) => (got[i].status === 'fulfilled' ? got[i].value : null);
  [log, messages, access, notes, reviews, changes] = [0, 1, 2, 3, 4, 5].map(ok);
  log = withHistory(log, ok(7), hist);
  questions = ok(6) || [];
  finance = ok(8);
  files = ok(9);
  doneTasks = ok(10);
  lastLoad = Date.now();
  $('state').textContent = '';
  compute();
  if (!busy()) renderKeepingFocus();
}

function compute(now = new Date()) {
  states.clear();
  const logBy = groupBy(log, 'client_id');
  const msgBy = groupBy(messages, 'client_id');
  const notesBy = groupBy(notes, 'client_id');
  const changesBy = groupBy(changes, 'client_id');
  entries = clients.map((c) => {
    const s = stateOf(c);
    const ex = {
      now, checks: checks[c.id] || {}, tasks: tasks.filter((t) => t.client_id === c.id),
      messages: messages ? msgBy.get(c.id) || [] : null, log: log ? logBy.get(c.id) || [] : null, access,
      statusNotes: notes ? notesBy.get(c.id) || [] : null, dateChanges: changes ? changesBy.get(c.id) || [] : null,
    };
    return { client: c, state: s, health: clientHealth(c, s, ex), station: station(c, s, ex) };
  });
  if (mayTable) {
    // Every client, also ended and cancelled ones (no colour, no station for them).
    const byId = new Map(entries.map((e) => [e.client.id, e]));
    const filesBy = files ? Object.fromEntries([...groupBy(files, 'client_id')].map(([id, rows]) => [id, fileCounts(rows)])) : null;
    tableRows = allClients.map((c) => tableRow(byId.get(c.id) || { client: c, state: stateOf(c), health: null, station: null },
      { checks, finance: showMoney ? finance || {} : null, files: filesBy, now }));
  }
}

// Re-rendering replaces elements; keyboard focus and the scroll stay where they were.
function renderKeepingFocus() {
  const focusId = document.activeElement?.id;
  const y = window.scrollY;
  render();
  window.scrollTo({ top: y });
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

// ── Tabs ────────────────────────────────────
const TABS = ['now', 'all', 'table', 'archive'];
const tabsShown = () => TABS.filter((t) => !$(`tab-${t}`).hidden);
// The page's heading follows the tab.
const VIEW_TITLES = {
  now: ['מה דורש אותי', 'רק מה שחרג, עם שם אחד וסיבה אחת. הכול מחושב ממה שהצוות מסמן.'],
  all: ['כל הלקוחות במבט', 'איפה כל לקוח, מה הבא, מי ומתי. לחיצה על לקוח מציגה את השאר.'],
  table: ['כל הלקוחות בטבלה', 'שורה לכל לקוח: מה בחוזה, איפה הוא עומד, מה הבא ומה בוצע. מיון, סינון וייצוא.'],
  archive: ['ארכיון', 'לקוחות שהועברו לארכיון: שחזור, או מחיקה לצמיתות.'],
};
function setView(v, focus = false) {
  view = tabsShown().includes(v) ? v : tabsShown()[0];
  const [title, sub] = VIEW_TITLES[view];
  $('ow-title').textContent = title;
  $('ow-sub').textContent = sub;
  document.title = title + ' · astrateg';
  for (const t of TABS) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === view));
    $(`tab-${t}`).tabIndex = t === view ? 0 : -1;
    $(`view-${t}`).hidden = t !== view;
  }
  if (focus) $(`tab-${view}`).focus();
  history.replaceState(null, '', `#${view}`);
  render();
}
for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => setView(t));
$('ow-tabs').addEventListener('keydown', (e) => {
  const list = tabsShown();
  const i = list.indexOf(view);
  const next = { ArrowLeft: list[(i + 1) % list.length], ArrowRight: list[(i + list.length - 1) % list.length], Home: list[0], End: list[list.length - 1] }[e.key];
  if (!next) return;
  e.preventDefault();
  setView(next, true);
});

function render() {
  if (view === 'now') renderNow();
  else if (view === 'table') renderTable();
  else if (view === 'archive') renderArchive();
  else renderAll();
}

// ── Screen 1: what needs me ─────────────────
const pct = (r) => (r === null ? '—' : `${Math.round(r * 100)}%`);
const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k !== null && k !== undefined) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
// On time week by week: a thin line in the quiet ink, this week in the accent.
// Each point says its week and numbers on hover; the label reads them all out.
function sparkline(trend) {
  const W = 112;
  const H = 30;
  const n = trend.weeks.length;
  const x = (i) => 4 + (i * (W - 8)) / (n - 1);
  const y = (r) => 4 + (1 - r) * (H - 8);
  const pts = trend.weeks.map((w, i) => (w.rate === null ? null : [x(i), y(w.rate), w, i]));
  const segs = [];
  let cur = [];
  for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
  if (cur.length) segs.push(cur);
  const label = `בזמן לפי שבוע, מהישן לחדש: ${trend.weeks.map((w) => pct(w.rate)).join(', ')}`;
  return svg('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': label },
    svg('title', {}, label),
    svg('line', { class: 'spark-base', x1: 2, x2: W - 2, y1: y(1), y2: y(1) }),
    ...segs.filter((s) => s.length > 1).map((s) => svg('polyline', { class: 'spark-line', points: s.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ') })),
    ...pts.filter(Boolean).map(([a, b, w, i]) => svg('circle', { class: i === n - 1 ? 'spark-dot is-now' : 'spark-dot', cx: a.toFixed(1), cy: b.toFixed(1), r: i === n - 1 ? 3.5 : 2.5 },
      svg('title', {}, `השבוע של ${dayText(w.start)}: ${w.onTime} מתוך ${w.done} (${pct(w.rate)})`))));
}

function statTiles(now) {
  const counts = colorCounts(entries);
  const late = lateNow(clients, stateOf, tasks, now);
  const trend = onTimeTrend(closedProcesses(allClients.filter((c) => c.status !== 'cancelled'), {
    stateOf, checksByClient: checks, since: trendSince(now), now, log,
  }), now);
  const shoots = shootsAhead(clients, now);
  return [
    h('li', { class: 'ow-stat ow-colors' }, h('span', { class: 'k' }, 'לקוחות'),
      h('strong', { class: 'v ds-num' }, String(counts.red + counts.yellow + counts.green)),
      h('span', { class: 'ow-cc' }, ...['red', 'yellow', 'green'].map((k) => h('span', { class: `ow-c h-${k}` },
        h('span', { class: 'hicon', 'aria-hidden': 'true' }), h('strong', { class: 'v-sm' }, String(counts[k])), ` ${COLORS[k]}`)))),
    h('li', { class: `ow-stat${late ? ' is-late' : ''}` }, h('span', { class: 'k' }, 'באיחור עכשיו'),
      h('strong', { class: 'v ds-num' }, String(late)), h('span', { class: 'sub' }, late === 1 ? 'פריט אחד, בלי ממתין ללקוח' : 'פריטים, בלי ממתין ללקוח')),
    h('li', { class: 'ow-stat' }, h('span', { class: 'k' }, 'בזמן · 8 שבועות'),
      h('span', { class: 'ow-trend' }, h('strong', { class: 'v ds-num' }, pct(trend.rate)), trend.done ? sparkline(trend) : null),
      h('span', { class: 'sub' }, trend.done ? `${trend.onTime} מתוך ${trend.done} תהליכים` : 'עוד לא נסגרו תהליכים')),
    h('li', { class: 'ow-stat' }, h('span', { class: 'k' }, 'ימי צילום · 7 ימים'),
      h('strong', { class: 'v ds-num' }, String(shoots.length)),
      h('span', { class: 'sub' }, shoots.length ? shoots.slice(0, 2).map((x) => `${x.client.name} ${dayText(x.at)}`).join(' · ') + (shoots.length > 2 ? ` ועוד ${shoots.length - 2}` : '') : 'אין בשבוע הקרוב')),
  ];
}

// "משימות שנסגרו השבוע": a bar per office day, what was closed (solid) and what is
// still open with that day as its deadline (hatched). The numbers stand above the
// bars, today is marked, and the whole chart is read out as one sentence.
const officeWeekStart = (now) => new Date(now.getTime() - 8 * 864e5).toISOString(); // generous: the counting keeps this week's days
function weekCard(now) {
  if (!doneTasks) return null; // the tasks closed this week did not load: no half chart
  const w = weekClosings({ clients: allClients, stateOf, checksByClient: checks, doneTasks, openTasks: tasks, now });
  const sum = weekSummary(w);
  const pctOf = (n) => (w.max ? `${(n / w.max) * 100}%` : '0%');
  return [
    h('h2', { id: 'wk-h' }, 'משימות שנסגרו השבוע'),
    h('p', { class: 'wk-sum', id: 'wk-sum' }, h('strong', {}, sum.lead), sum.rest),
    h('div', { class: 'wk-bars', id: 'wk-bars', role: 'img', 'aria-label': weekLabel(w) }, ...w.days.map((d) => h('div', {
      class: `wk-col${d.today ? ' is-today' : ''}`, title: `${d.name}: ${d.closed} נסגרו, ${d.open} פתוחות`, 'data-day': d.key,
    },
    h('b', { class: 'wk-n' }, String(d.closed || d.open), d.closed && d.open ? h('small', {}, ` +${d.open}`) : null),
    h('div', { class: 'wk-stack' },
      d.open ? h('div', { class: 'wk-seg is-open', style: `height:${pctOf(d.open)}` }) : null,
      d.closed ? h('div', { class: 'wk-seg is-done', style: `height:${pctOf(d.closed)}` }) : null)))),
    h('div', { class: 'wk-days', 'aria-hidden': 'true' }, ...w.days.map((d) => h('span', { class: d.today ? 'is-now' : null }, d.today ? `${d.short} · היום` : d.short))),
    h('div', { class: 'wk-key', 'aria-hidden': 'true' },
      h('span', {}, h('i', { class: 'wk-k-done' }), 'נסגרו'),
      h('span', {}, h('i', { class: 'wk-k-open' }), 'פתוחות, היעד שלהן באותו יום')),
  ];
}

// The latest question about a row: the same client (or, for the office, the same
// kind of row) and the same person.
function questionFor(r) {
  return questions.find((q) => q.to_person === r.who && (r.client ? q.client_id === r.client.id : !q.client_id && String(q.about || '').split(':')[0] === r.code)) || null;
}
function questionLine(q) {
  return h('div', { class: `ow-q${q.answer ? ' is-answered' : ''}` },
    h('p', {}, h('span', { class: 'k' }, `שאלת את ${personName(q.to_person)}`), ` · ${formatStamp(q.asked_at)}: ״${q.question}״`),
    q.answer ? h('p', { class: 'ow-a' }, h('strong', {}, `${who(q.answered_by) || personName(q.to_person)} ענה/תה:`), ` ״${q.answer}״ · ${formatStamp(q.answered_at)}`)
      : h('p', { class: 'muted ow-wait' }, 'ממתין לתשובה'));
}

const rowHref = (r) => (r.client ? clientUrl(r.client.id, r.procId && !r.taskId ? `#${r.procId}` : r.taskId ? '#tasks' : '') : 'clients.html#control');
function rowItem(r, i) {
  const q = questionFor(r);
  const name = r.client ? r.client.name : r.code === 'thursday' ? 'סיכום חמישי' : 'המשרד';
  // Only someone who can sign in can read and answer a question.
  const canAsk = isOwner && !!PEOPLE[r.who] && r.who !== 'editor' && Object.values(directory).includes(r.who);
  const noLogin = isOwner && !canAsk && !!PEOPLE[r.who] && r.who !== 'editor';
  return h('li', { class: `ow-row h-${r.color}${r.waiting ? ' is-waiting' : ''}`, 'data-key': r.key },
    h('div', { class: 'ow-row-h' },
      healthBadge(r.color),
      r.client ? h('a', { class: 'wclient', href: clientUrl(r.client.id) }, name) : h('span', { class: 'wclient' }, name),
      r.station ? h('span', { class: 'ow-station' }, r.station.title) : null,
      personChip(r.who)),
    h('p', { class: 'ow-reason' }, h('strong', {}, r.text), r.what ? ` · ${r.what}` : '',
      r.more ? h('span', { class: 'muted' }, ` · ועוד ${r.more === 1 ? 'סיבה אחת' : `${r.more} סיבות`}`) : null),
    r.waiting ? h('p', { class: 'ow-waitnote' }, h('span', { class: 'sbadge s-client' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'ממתינים ללקוח, לא עיכוב של הצוות')) : null,
    q ? questionLine(q) : null,
    h('div', { class: 'ow-acts' },
      h('a', { class: 'btn btn-sm', href: rowHref(r), 'aria-label': `פתיחה: ${name}` }, 'פתיחה'),
      canAsk ? h('button', {
        type: 'button', class: 'btn btn-sm btn-ghost ask-btn', id: `ask-${i}`, 'aria-label': `שאלה ל${personName(r.who)} על ${name}`,
        onclick: () => openAsk(r, `ask-${i}`),
      }, 'שאלה לאחראי') : null,
      noLogin ? h('span', { class: 'muted ow-nologin' }, `אין ל${personName(r.who)} כניסה למערכת`) : null));
}

let shownOnce = false;
let countStart = null;
function renderNow() {
  const now = new Date();
  fill($('ow-stats'), statTiles(now));
  const week = weekCard(now);
  $('wk-card').hidden = !week;
  fill($('wk-card'), week);
  // The numbers count up and the bars grow the first time the screen shows them, never on a rebuild.
  // (A second build within that moment, when the rest of the data lands, carries on from where it was.)
  if (entries.length) {
    countStart ??= performance.now();
    countUp($('ow-stats'), countStart);
    if (week && !shownOnce) { shownOnce = true; growOnce($('wk-card')); }
  }
  const { rows, more } = ownerRows(entries, { office: officeReasons(reviews, now) });
  fill($('ow-rows'), rows.map(rowItem));
  capList($('ow-rows'), 8, 'ow:rows');
  $('ow-empty').hidden = rows.length > 0;
  $('rows-h').hidden = !rows.length;
  $('ow-more').hidden = !more;
  fill($('ow-more'), more ? [`ועוד ${more} במבט על כל הלקוחות. `, h('a', { href: '#all', onclick: (e) => { e.preventDefault(); setView('all', true); } }, 'לכל הלקוחות')] : null);
  // Answers to questions whose row is gone (the thing was fixed), from the last 3 days.
  const shown = new Set(rows.map(questionFor).filter(Boolean).map((q) => q.id));
  const recent = questions.filter((q) => q.answer && !shown.has(q.id) && now - new Date(q.answered_at) < 3 * 864e5);
  $('ow-answers').hidden = !recent.length;
  fill($('ow-alist'), recent.map((q) => {
    const c = q.client_id ? allClients.find((x) => x.id === q.client_id) : null;
    return h('li', {},
      c ? h('a', { class: 'wclient', href: clientUrl(c.id) }, c.name) : h('span', { class: 'wclient' }, q.client_id ? 'לקוח' : 'המשרד'),
      q.context ? h('span', { class: 'muted' }, ` · ${q.context}`) : null,
      questionLine(q));
  }));
}

// ── Asking the responsible person ───────────
const askDlg = $('dlg-ask');
let askFor = null;
askDlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === askDlg) askDlg.close(); });
askDlg.addEventListener('close', () => { if (askFor?.focusId) document.getElementById(askFor.focusId)?.focus(); });
function openAsk(r, focusId) {
  askFor = { r, focusId };
  const name = personName(r.who);
  $('ask-h').textContent = `שאלה ל${name}`;
  $('ask-ctx').textContent = `${r.client ? r.client.name : r.code === 'thursday' ? 'סיכום חמישי' : 'המשרד'} · ${reasonText(r)}`;
  $('ask-label').textContent = `מה לשאול את ${name}?`;
  $('ask-text').value = 'מה המצב, ומתי זה ייסגר?';
  $('ask-err').hidden = true;
  $('ask-text').removeAttribute('aria-invalid');
  askDlg.showModal();
  $('ask-text').focus();
  $('ask-text').select();
}
$('ask-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { r } = askFor;
  const question = $('ask-text').value.trim();
  $('ask-text').setAttribute('aria-invalid', String(!question));
  if (!question) {
    $('ask-err').textContent = 'כתבו מה לשאול.';
    $('ask-err').hidden = false;
    $('ask-text').focus();
    return;
  }
  $('ask-submit').disabled = true;
  try {
    const row = await askQuestion({
      client_id: r.client?.id || null, to_person: r.who, about: `${r.code}:${r.procId || ''}`.slice(0, 80),
      context: reasonText(r).slice(0, 300), question,
    });
    questions = [row, ...questions];
    askDlg.close();
    renderKeepingFocus();
    toast(`השאלה נשלחה ל${personName(r.who)}. התשובה תופיע כאן, באותה שורה.`, { label: 'ביטול', run: () => withdraw(row) });
  } catch (err) {
    $('ask-err').textContent = `השאלה לא נשמרה. ${errorText(err)}`;
    $('ask-err').hidden = false;
  } finally {
    $('ask-submit').disabled = false;
  }
});
async function withdraw(row) {
  try {
    await withdrawQuestion(row.id);
  } catch (err) {
    toast(`הביטול לא נשמר. ${errorText(err)}`);
    return;
  }
  questions = questions.filter((q) => q.id !== row.id);
  renderKeepingFocus();
  toast('השאלה בוטלה.');
}

// ── Screen 2: all the clients at a glance ────
const daysWords = (n) => (n === 0 ? 'נכנס היום' : n === 1 ? 'יום אחד' : `${n} ימים`);
const FILTERS = [['', 'הכול'], ['red', 'אדום'], ['yellow', 'צהוב'], ['green', 'ירוק'], ['waiting', 'ממתין ללקוח']];
const matches = (e) => !colorFilter || (colorFilter === 'waiting' ? e.station.waiting : e.health.color === colorFilter);

function toggle(id) {
  if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
  const li = document.querySelector(`.ga-item[data-id="${CSS.escape(id)}"]`);
  li?.replaceWith(clientItem(entries.find((e) => e.client.id === id), new Date()));
  document.getElementById(`gab-${id}`)?.focus();
}

function clientItem(e, now) {
  const c = e.client;
  const st = e.station;
  const top = e.health.reasons[0];
  const open = expanded.has(c.id);
  const more = `ga-${c.id}`;
  // Its own name for the browser's view transition: a filter lets the clients that stay glide to their place.
  return h('li', { class: `ga-item h-${e.health.color}`, 'data-id': c.id, style: `view-transition-name:ga-${String(c.id).replace(/[^\w-]/g, '')}` },
    h('button', { type: 'button', class: 'ga-row', id: `gab-${c.id}`, 'aria-expanded': String(open), 'aria-controls': more, onclick: () => toggle(c.id) },
      h('span', { class: 'ga-l1' }, healthBadge(e.health.color), h('strong', { class: 'ga-name' }, c.name),
        h('span', { class: 'ga-why' }, top ? `${reasonText(top)} · ${personName(top.who)}` : 'לפי התוכנית')),
      h('span', { class: 'ga-l2' }, nextText(st.next, now))),
    h('div', { class: 'ga-more', id: more, hidden: !open },
      h('p', { class: 'ga-pkg' }, [c.package_name || 'חבילה לא הוזנה', st.month?.text, c.status === 'ending' ? 'מסיים התקשרות' : null].filter(Boolean).join(' · ')),
      stationBar(st.index),
      h('dl', { class: 'ga-facts' },
        h('div', {}, h('dt', {}, 'בתחנה'), h('dd', {}, st.days === null ? '—' : `${daysWords(st.days)}${st.since && st.days ? ` · מאז ${dayText(st.since)}` : ''}`)),
        h('div', {}, h('dt', {}, 'ממתין ללקוח'), h('dd', {}, st.waiting || st.awaited.length ? h('span', { class: 'sbadge s-client' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), st.awaited.join(', ') || 'כן') : 'לא')),
        h('div', {}, h('dt', {}, 'קצב תוצרים'), h('dd', {}, st.paceText || 'הכמויות לא הוזנו')),
        h('div', {}, h('dt', {}, 'מגע אחרון'), h('dd', {}, st.lastContact ? formatWhen(st.lastContact, now) : 'אין תיעוד'))),
      e.health.reasons.length > 1 ? h('ul', { class: 'ga-reasons' }, ...e.health.reasons.map((r) => h('li', {}, healthBadge(r.color, 'is-sm'), ` ${reasonText(r)} `, personChip(r.who)))) : null,
      h('a', { class: 'btn btn-sm', href: clientUrl(c.id) }, 'לכרטיס הלקוח')));
}

function renderAll() {
  const now = new Date();
  const count = (k) => entries.filter((e) => (k === '' ? true : k === 'waiting' ? e.station.waiting : e.health.color === k)).length;
  fill($('ga-filters'), FILTERS.map(([k, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(colorFilter === k), id: `gaf-${k || 'all'}`,
    onclick: () => glide(() => { colorFilter = k; renderAll(); document.getElementById(`gaf-${k || 'all'}`)?.focus(); }),
  }, k && k !== 'waiting' ? h('span', { class: `hicon h-${k}`, 'aria-hidden': 'true' }) : null, label, h('span', { class: 'n' }, String(count(k))))));
  const top = (e) => e.health.reasons[0] || { color: 'green', code: '', days: 0 };
  const list = entries.filter(matches).sort((a, b) => bySeverity(top(a), top(b)) || String(a.client.name).localeCompare(String(b.client.name), 'he'));
  fill($('ga-list'), list.length ? list.map((e) => clientItem(e, now))
    : [h('li', { class: 'empty' }, entries.length ? 'אין לקוחות בסינון הזה.' : 'אין לקוחות פעילים.')]);
  renderBoard(now);
}

// "השבוע / 30 יום": what happens across the clients.
const KIND = { char: 'אפיונים', shoot: 'ימי צילום', delivery: 'מסירות', campaign: 'קמפיינים', renewal: 'חידושים' };
function dayHead(d, now) {
  const n = daysBetweenIL(now, d);
  return n === 0 ? `היום · ${dayText(d)}` : n === 1 ? `מחר · ${dayText(d)}` : dayText(d);
}
function renderBoard(now) {
  fill($('board-range'), [[7, 'השבוע'], [30, '30 יום']].map(([d, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(boardDays === d), id: `range-${d}`, onclick: () => glide(() => { boardDays = d; renderBoard(new Date()); document.getElementById(`range-${d}`)?.focus(); }),
  }, label)));
  const events = upcomingEvents(clients, stateOf, now, boardDays, checks);
  fill($('board-sum'), Object.entries(KIND).map(([k, label]) => `${label}: ${events.filter((e) => e.kind === k).length}`).join(' · '));
  if (!events.length) { fill($('board'), h('p', { class: 'muted' }, 'אין אירועים בתקופה הזו.')); return; }
  const days = groupBy(events.map((e) => ({ ...e, day: dayKeyIL(e.at) })), 'day');
  fill($('board'), [...days.entries()].map(([, list]) => h('section', { class: 'board-day', 'aria-label': dayHead(list[0].at, now) },
    h('h3', { class: 'board-dh' }, dayHead(list[0].at, now)),
    h('ul', { class: 'board-list' }, ...list.map((e) => h('li', { class: `board-ev k-${e.kind}${e.done ? ' is-done' : ''}` },
      h('span', { class: 'board-t num' }, /23:59/.test(hmFmt.format(e.at)) ? 'עד סוף היום' : hmFmt.format(e.at)),
      h('span', { class: 'board-what' }, e.label),
      h('a', { class: 'wclient', href: clientUrl(e.client.id, e.procId ? `#${e.procId}` : '') }, e.client.name),
      personChip(e.who),
      e.done ? h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'בוצע') : null))))));
}

// ── The manager table ───────────────────────
// One row per client: what the contract grants and where the client is. Sorting by
// any column, filters (station, colour, editor, status), search, a sticky header and
// business column, sideways scrolling inside the table on a phone, and the CSV.
const dash = (v) => (v === '' || v === null || v === undefined ? '—' : v);
function fillSelect(el, options, value) {
  const same = el.options.length === options.length && options.every(([k, l], i) => el.options[i].value === k && el.options[i].text === l);
  if (!same) fill(el, options.map(([k, l]) => h('option', { value: k }, l)));
  el.value = options.some(([k]) => k === value) ? value : options[0][0];
}
function ratioCell(x, label) {
  if (!x) return h('td', { class: 'is-num' }, '—');
  return h('td', { class: 'is-num' }, h('div', { class: 'mt-ratio' },
    h('span', { class: 'num', title: x.text }, `${x.done}/${x.total}`), progressBar(Math.min(x.done, x.total), x.total, `${label} שבוצעו`)));
}
const CELLS = {
  name: (r) => h('td', {}, h('a', { class: 'mt-name', href: clientUrl(r.id) }, r.name), r.contact ? h('span', { class: 'sub' }, r.contact) : null),
  package: (r) => h('td', {}, dash(r.package), !r.package && r.shootType ? h('span', { class: 'sub' }, r.shootType) : null),
  signed: (r) => h('td', { class: 'num' }, dash(dmy(r.signedAt))),
  end: (r) => h('td', { class: 'num' }, dash(dmy(r.endAt))),
  monthly: (r) => h('td', { class: 'is-num num' }, dash(moneyText(r.monthly)), r.quote ? h('span', { class: 'sub', dir: 'ltr' }, r.quote) : null),
  term: (r) => h('td', { class: 'is-num num' }, dash(moneyText(r.term))),
  station: (r) => h('td', {}, r.station ? `${r.stationIndex + 1} · ${r.station}` : r.statusText),
  color: (r) => h('td', {}, r.color ? healthBadge(r.color, 'is-sm') : h('span', { class: 'muted' }, r.statusText), r.reason ? h('span', { class: 'mt-why' }, r.reason) : null),
  step: (r) => h('td', { class: 'mt-step' }, dash(r.step), r.stepWho ? h('div', {}, personChip(r.stepWho)) : null),
  editor: (r) => h('td', {}, dash(r.editorName)),
  shoot: (r) => h('td', { class: 'num' }, r.shootAt ? dmy(r.shootAt) : h('span', { class: 'muted' }, 'טרם נקבע')),
  videos: (r) => ratioCell(r.videos, 'סרטונים'),
  graphics: (r) => ratioCell(r.graphics, 'גרפיקות'),
  renewal: (r) => h('td', {}, r.renewal ? h('span', { class: `mt-renew is-${r.renewal.state}` }, r.renewal.text) : '—'),
};
function setSort(key) {
  if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  else { sortKey = key; sortDir = 'asc'; }
  renderTable();
  document.getElementById(`mt-sort-${key}`)?.focus();
}
function renderTable() {
  const cols = columnsFor(showMoney);
  const opts = filterOptions(tableRows);
  fillSelect($('mt-station'), [['', 'כל התחנות'], ...opts.stations], filters.station);
  fillSelect($('mt-color'), [['', 'כל הצבעים'], ...opts.colors], filters.color);
  fillSelect($('mt-editor'), [['', 'כל העורכים'], ...opts.editors], filters.editor);
  fillSelect($('mt-status'), opts.statuses, filters.status);
  if ($('mt-q').value !== filters.q) $('mt-q').value = filters.q;
  tableShown = sortRows(filterRows(tableRows, filters), sortKey, sortDir, cols);
  fill($('mt-head'), cols.map((c) => h('th', {
    scope: 'col', class: c.num ? 'is-num' : null, 'aria-sort': sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : null,
  }, h('button', { type: 'button', id: `mt-sort-${c.key}`, onclick: () => setSort(c.key) }, c.label))));
  fill($('mt-body'), tableShown.length ? tableShown.map((r) => h('tr', { class: r.color ? `h-${r.color}` : null, 'data-id': r.id }, cols.map((c) => CELLS[c.key](r))))
    : [h('tr', {}, h('td', { class: 'mt-empty', colspan: String(cols.length) }, tableRows.length ? 'אין לקוחות בסינון הזה.' : 'אין לקוחות.'))]);
  const open = tableRows.filter((r) => r.status === 'active' || r.status === 'ending').length;
  $('mt-count').textContent = `${tableShown.length === 1 ? 'לקוח אחד' : `${tableShown.length} לקוחות`} בטבלה · ${open} פעילים ומסיימים בסך הכול`;
  $('mt-money-note').hidden = !showMoney;
}
$('mt-q').addEventListener('input', (e) => { filters.q = e.currentTarget.value; renderTable(); });
for (const k of ['station', 'color', 'editor', 'status']) {
  $(`mt-${k}`).addEventListener('change', (e) => { filters[k] = e.currentTarget.value; renderTable(); });
}
$('mt-csv').addEventListener('click', () => {
  const blob = new Blob([toCsv(tableShown, columnsFor(showMoney))], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: csvName(), hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`יוצא קובץ CSV עם ${tableShown.length === 1 ? 'לקוח אחד' : `${tableShown.length} לקוחות`}${showMoney ? ', כולל המחירים' : ''}.`);
});

// ── The archive (the owner and Ofir) ────────
async function renderArchive() {
  if (archived === null) {
    fill($('ar-list'), h('li', { class: 'muted' }, 'טוען…'));
    try { archived = await loadArchived(); } catch (err) { fill($('ar-list'), h('li', { class: 'err' }, errorText(err))); return; }
    if (view !== 'archive') return;
  }
  fill($('ar-list'), archived.length ? archived.map((a) => h('li', { class: 'ar-item', 'data-id': a.id },
    h('div', {},
      h('p', { class: 'ar-name' }, a.label),
      h('p', { class: 'ar-meta' }, [a.package_name, `בארכיון מ־${formatStamp(a.archived_at)}`, a.archived_by ? `על ידי ${who(a.archived_by) || a.archived_by}` : null].filter(Boolean).join(' · '))),
    h('div', { class: 'ar-acts' },
      h('button', { type: 'button', class: 'btn btn-sm', id: `ar-restore-${a.id}`, 'aria-label': `שחזור: ${a.label}`, onclick: (e) => restore(a, e.currentTarget) }, 'שחזור'),
      h('button', { type: 'button', class: 'btn btn-sm btn-danger', id: `ar-purge-${a.id}`, 'aria-label': `מחיקה לצמיתות: ${a.label}`, onclick: () => openPurge(a) }, 'מחיקה לצמיתות'))))
    : [h('li', { class: 'muted' }, 'אין לקוחות בארכיון.')]);
}
async function restore(a, btn) {
  btn.disabled = true;
  try {
    await restoreClient(a.id);
  } catch (err) {
    btn.disabled = false;
    toast(`השחזור לא נשמר. ${errorText(err)}`);
    return;
  }
  archived = archived.filter((x) => x.id !== a.id);
  toast(`${a.label} שוחזר/ה וחזר/ה לכל הרשימות.`);
  renderArchive();
  load();
}
const purgeDlg = $('dlg-purge');
let purgeFor = null;
purgeDlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === purgeDlg) purgeDlg.close(); });
purgeDlg.addEventListener('close', () => { if (purgeFor) document.getElementById(`ar-purge-${purgeFor.id}`)?.focus(); });
const purgeReady = () => !!purgeFor && sameName($('purge-text').value, purgeFor.label) && $('purge-sure').checked;
function openPurge(a) {
  purgeFor = a;
  $('purge-name').textContent = a.label;
  $('purge-label').textContent = `כדי לאשר, הקלידו את שם העסק: ${a.label}`;
  $('purge-hint').textContent = 'בדיוק כמו שהוא כתוב כאן.';
  $('purge-text').value = '';
  $('purge-sure').checked = false;
  $('purge-err').hidden = true;
  $('purge-submit').disabled = true;
  purgeDlg.showModal();
  $('purge-text').focus();
}
for (const id of ['purge-text', 'purge-sure']) $(id).addEventListener('input', () => { $('purge-submit').disabled = !purgeReady(); });
$('purge-sure').addEventListener('change', () => { $('purge-submit').disabled = !purgeReady(); });
$('purge-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!purgeReady()) return;
  const a = purgeFor;
  $('purge-submit').disabled = true;
  try {
    await purgeClient(a.id, $('purge-text').value);
  } catch (err) {
    $('purge-err').textContent = `המחיקה לא בוצעה. ${errorText(err)}`;
    $('purge-err').hidden = false;
    $('purge-submit').disabled = !purgeReady();
    return;
  }
  archived = archived.filter((x) => x.id !== a.id);
  purgeFor = null;
  purgeDlg.close();
  toast(`${a.label} נמחק/ה לצמיתות.`);
  renderArchive();
  $('ar-h').focus?.();
});

// ── Refresh ─────────────────────────────────
$('btn-refresh').addEventListener('click', () => { archived = null; load(); });
window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (tabsShown().includes(v) && v !== view && !$('app').hidden) setView(v);
});
// Back in the app: fresh data, unless it was loaded in the last minute.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('ow-page').hidden && !busy() && Date.now() - lastLoad > 60e3) load();
});
// The colours depend on the clock: recomputed every minute; fresh data every 5 minutes.
setInterval(() => {
  if ($('ow-page').hidden || document.hidden || busy()) return;
  if (Date.now() - lastLoad > 5 * 60e3) { load(); return; }
  compute();
  renderKeepingFocus();
}, 60e3);

mountSession(async (staff) => {
  const [dir, v] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  viewer = v;
  $('nav-team').hidden = !canManageTeam(v);
  $('nav-insights').hidden = !canSeeInsights(v);
  $('nav-messages').hidden = !canSendMessages(v);
  if (!canSeeAllClients(v)) {
    $('no-access').hidden = false;
    if (v.error) fill($('no-access').querySelector('p'), VIEWER_UNKNOWN);
    return;
  }
  // The manager profile (the owner, Irit and Ofir): screen 1, screen 2, the table.
  isOwner = canSeeOwnerScreen(v);
  mayTable = canSeeTable(v);
  showMoney = seesFinance(v);
  mayArchive = canArchive(v);
  // Landed: from now on in this tab, "לקוחות" opens the clients list, not this screen.
  if (isOwner) markOwnerLanded();
  $('ow-page').hidden = false;
  // Screen 1 is the managers'; Lior opens straight on screen 2 (and has the table, without prices).
  $('tab-now').hidden = !isOwner;
  $('tab-table').hidden = !mayTable;
  $('tab-archive').hidden = !mayArchive;
  $('ow-tabs').hidden = tabsShown().length < 2;
  // Someone with a person of their own goes back to their own tasks; the owner to the team's work.
  if (v.me) $('link-work').textContent = 'המשימות שלי';
  if (!isOwner) {
    $('nav-owner').textContent = 'כל הלקוחות במבט';
    $('nav-owner').href = 'owner.html#all';
  }
  const fromHash = location.hash.slice(1);
  view = tabsShown().includes(fromHash) ? fromHash : isOwner ? 'now' : 'all';
  await load();
  setView(view);
});
