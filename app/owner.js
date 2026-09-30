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
  loadClients, loadChecks, loadTasks, loadAllLog, loadStatusNotes, loadReviews, loadDirectory,
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
  $, fill, h, toast, errorText, personChip, formatWhen, formatStamp, mountSession, directory, who, viewerOf, VIEWER_UNKNOWN,
} from './protocol-ui.js';
import { canManageTeam } from './team-rules.js';
import { canSeeInsights } from './insights.js';
import { canSendMessages } from './messages-logic.js';
import { TZ, dayKeyIL, daysBetweenIL } from './tz.js';

let viewer = null;
let isOwner = false;
let allClients = [];   // every client, for the on-time trend
let clients = [];      // active and ending: the ones with a colour
let checks = {};
let tasks = [];
let log = null;        // protocol_log of the last 8 weeks (null: not loaded)
let messages = null;   // client_messages of the last 30 days
let access = null;     // login statuses
let notes = null;      // Ofir's weekly summaries
let reviews = null;    // daily reviews (processes 32, 33)
let changes = null;    // date changes of the last 30 days
let questions = [];    // questions asked in the last 30 days
let entries = [];      // [{ client, state, health, station }]
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
const busy = () => $('dlg-ask').open;
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
  ]);
  const ok = (i) => (got[i].status === 'fulfilled' ? got[i].value : null);
  [log, messages, access, notes, reviews, changes] = [0, 1, 2, 3, 4, 5].map(ok);
  log = withHistory(log, ok(7), hist);
  questions = ok(6) || [];
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
const TABS = ['now', 'all'];
const tabsShown = () => TABS.filter((t) => !$(`tab-${t}`).hidden);
function setView(v, focus = false) {
  view = tabsShown().includes(v) ? v : tabsShown()[0];
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
      h('span', { class: 'ow-cc' }, ...['red', 'yellow', 'green'].map((k) => h('span', { class: `ow-c h-${k}` },
        h('span', { class: 'hicon', 'aria-hidden': 'true' }), h('strong', { class: 'v-sm' }, String(counts[k])), ` ${COLORS[k]}`)))),
    h('li', { class: 'ow-stat' }, h('span', { class: 'k' }, 'באיחור עכשיו'),
      h('strong', { class: 'v' }, String(late)), h('span', { class: 'sub' }, late === 1 ? 'פריט אחד, בלי ממתין ללקוח' : 'פריטים, בלי ממתין ללקוח')),
    h('li', { class: 'ow-stat' }, h('span', { class: 'k' }, 'בזמן · 8 שבועות'),
      h('span', { class: 'ow-trend' }, h('strong', { class: 'v' }, pct(trend.rate)), trend.done ? sparkline(trend) : null),
      h('span', { class: 'sub' }, trend.done ? `${trend.onTime} מתוך ${trend.done} תהליכים` : 'עוד לא נסגרו תהליכים')),
    h('li', { class: 'ow-stat' }, h('span', { class: 'k' }, 'ימי צילום · 7 ימים'),
      h('strong', { class: 'v' }, String(shoots.length)),
      h('span', { class: 'sub' }, shoots.length ? shoots.slice(0, 2).map((x) => `${x.client.name} ${dayText(x.at)}`).join(' · ') + (shoots.length > 2 ? ` ועוד ${shoots.length - 2}` : '') : 'אין בשבוע הקרוב')),
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

function renderNow() {
  const now = new Date();
  fill($('ow-stats'), statTiles(now));
  const { rows, more } = ownerRows(entries, { office: officeReasons(reviews, now) });
  fill($('ow-rows'), rows.map(rowItem));
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
  return h('li', { class: `ga-item h-${e.health.color}`, 'data-id': c.id },
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
    onclick: () => { colorFilter = k; renderAll(); },
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
    type: 'button', class: 'chip', 'aria-pressed': String(boardDays === d), id: `range-${d}`, onclick: () => { boardDays = d; renderBoard(new Date()); },
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

// ── Refresh ─────────────────────────────────
$('btn-refresh').addEventListener('click', () => load());
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
  isOwner = canSeeOwnerScreen(v);
  // Landed: from now on in this tab, "לקוחות" opens the clients list, not this screen.
  if (isOwner) markOwnerLanded();
  $('ow-page').hidden = false;
  // Screen 1 is the owner's; Irit, Lior and Ofir open straight on screen 2.
  $('tab-now').hidden = !isOwner;
  $('ow-tabs').hidden = !isOwner;
  if (!isOwner) {
    $('ow-title').textContent = 'כל הלקוחות במבט';
    $('ow-sub').textContent = 'איפה כל לקוח, מה הבא, מי ומתי. לחיצה על לקוח מציגה את השאר.';
    $('nav-owner').textContent = 'כל הלקוחות במבט';
    $('nav-owner').href = 'owner.html#all';
    $('link-work').textContent = 'מה עליי';
    document.title = 'כל הלקוחות במבט · astrateg';
  }
  const fromHash = location.hash.slice(1);
  view = isOwner && fromHash !== 'all' ? 'now' : 'all';
  await load();
  setView(view);
});
