// "תובנות" (insights.html): the month in numbers for the owner, and for Lior to
// read (decision 22 gives him the team screen). Everything is computed in
// app/insights.js from what the team marks; this page only loads and draws.
// Row level security decides what loads (the office reads every client, its marks,
// history and tasks; migration 20260930130000_assignment_rls.sql, and the clients'
// surveys, 20260930170000_client_status.sql); no policy was added for this page.
// Charts are plain HTML bars: the number is always written next to the bar, so
// nothing is said by colour or length alone.
import { supabase } from './supa.js';
import { clientLabel } from './protocol-logic.js';
import { loadClients, loadChecks, loadAllLog, loadDirectory } from './protocol-data.js';
import { loadLogFor } from './owner-data.js';
import { withHistory, dayText } from './health.js';
import {
  computeInsights, monthRange, monthsUpTo, monthKeyIL, canSeeInsights, canSeePayouts, pct, STAGES, contextsOf, PROMISE_DAYS, URGENT_MIN,
} from './insights.js';
import {
  $, fill, h, errorText, mountSession, directory, viewerOf, VIEWER_UNKNOWN, officeMinutes, personChip,
} from './protocol-ui.js';
import { emptyItem, dress } from './kit.js';
import { canManageTeam } from './team-rules.js';
import { officeLinks } from './office-ui.js';
import { SURVEY_TABLE, SURVEY_REPORT_COLS } from './surveys.js';

const PAGE = 1000;
async function all(build) {
  let out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < PAGE) return out;
  }
}

let month = monthKeyIL(new Date());
let data = null;
let inflight = null;

// Client requests (source 'request') opened since a moment.
const loadRequests = (sinceIso) => all(() => supabase.from('client_tasks')
  .select('id, client_id, title, owner, due_on, done_at, created_at, source, urgent').eq('source', 'request').gte('created_at', sinceIso).order('created_at'));
// The clients' answers (public.client_surveys, stage 4; the office reads them, so
// the owner and Lior do). Null only when the table is not there yet (before
// migration 20260930170000): the page then says the surveys are not running.
async function loadSurveys(sinceIso) {
  try {
    return await all(() => supabase.from(SURVEY_TABLE).select(SURVEY_REPORT_COLS).gte('at', sinceIso).order('at'));
  } catch (err) {
    if (/^(PGRST205|42P01)$/.test(err?.code || '') || /Could not find the table|does not exist/.test(err?.message || '')) return null;
    throw err;
  }
}
// The whole history of the items whose first time counts (returns, deliveries, the stages).
function historyKeys(clients) {
  const out = new Set();
  for (const c of clients) {
    for (const x of contextsOf(c)) {
      for (const s of STAGES) out.add(`${x.pre}${s.item}`);
      out.add(`${x.pre}p26.sent`);
      for (let n = 1; n <= 6; n += 1) { out.add(`${x.pre}p25.return.${n}`); if (!x.pre) { out.add(`p23.return.${n}`); out.add(`p07.return.${n}`); } }
    }
  }
  return [...out].sort();
}

function load() {
  inflight ||= doLoad().finally(() => { inflight = null; });
  return inflight;
}
async function doLoad() {
  const want = month;
  $('state').textContent = 'טוען…';
  const now = new Date();
  const since = monthRange(monthsUpTo(want, 6)[0]).start.toISOString();
  try {
    const [clients, checks] = await Promise.all([loadClients({ includeEnded: true }), loadChecks()]);
    const hist = historyKeys(clients);
    const [log, history, tasks, surveys] = await Promise.all([
      loadAllLog(since), loadLogFor(hist).catch(() => null), loadRequests(monthRange(want).start.toISOString()).catch(() => []),
      loadSurveys(monthRange(want).start.toISOString()),
    ]);
    if (want !== month) return;
    data = computeInsights({ clients, checks, log: withHistory(log, history, hist), tasks, surveys, now, month: want });
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  $('state').textContent = '';
  render();
}

// ── Drawing ─────────────────────────────────
const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);
const days = (n) => (n === null || n === undefined ? '—' : n === 1 ? 'יום עסקים אחד' : `${String(Math.round(n * 10) / 10)} ימי עסקים`);

// One bar: the label, the bar (hidden from screen readers) and the value in words.
function bar({ id, label, value, text, sub = null }) {
  const w = value === null || value === undefined ? 0 : Math.max(0, Math.min(1, value));
  return h('li', { class: `bar-row${value === null || value === undefined ? ' is-empty' : ''}`, id },
    h('span', { class: 'bar-label' }, label, sub ? h('span', { class: 'bar-sub' }, sub) : null),
    h('span', { class: 'bar-track', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: `inline-size: ${(w * 100).toFixed(1)}%` })),
    h('span', { class: 'bar-val num' }, text));
}
const rateText = (r) => (r.done ? `${pct(r.rate)} · ${r.onTime} מתוך ${r.done}` : 'לא נסגרו תהליכים');

function stats() {
  const d = data;
  const tiles = [
    ['st-ontime', 'בזמן החודש', pct(d.onTime.all.rate), d.onTime.all.done ? `${d.onTime.all.onTime} מתוך ${d.onTime.all.done} תהליכים` : 'עוד לא נסגרו תהליכים'],
    ['st-returns', 'החזרות לתיקון', String(d.qa.total + d.qa.graphics.returns), `סרטונים ${d.qa.total} · גרפיקות ${d.qa.graphics.returns}`],
    ['st-delivery', 'מהצילום למסירה ראשונה', d.delivery.median === null ? '—' : String(Math.round(d.delivery.median * 10) / 10),
      d.delivery.first.length ? `ימי עסקים, חציון של ${plural(d.delivery.first.length, 'יום צילום אחד', 'ימי צילום')}` : 'לא היו מסירות'],
    ['st-requests', 'פניות שטופלו בזמן', pct(d.requests.rate), d.requests.handled ? `${d.requests.onTime} מתוך ${d.requests.handled}` : 'לא טופלו פניות'],
  ];
  if (d.satisfaction?.count) tiles.push(['st-sat', 'שביעות רצון', (Math.round(d.satisfaction.avg * 10) / 10).toFixed(1), `מתוך 5 · ${plural(d.satisfaction.count, 'תשובה אחת', 'תשובות')}`]);
  return tiles.map(([id, k, v, sub]) => h('li', { class: 'ow-stat', id },
    h('span', { class: 'k' }, k), h('strong', { class: 'v' }, v), h('span', { class: 'sub' }, sub)));
}

function renderOnTime() {
  const d = data.onTime;
  fill($('in-roles'), d.roles.map((r) => bar({ id: `role-${r.key}`, label: r.label, value: r.rate, text: rateText(r) })));
  fill($('in-people'), d.people.map((p) => bar({ id: `person-${p.key}`, label: p.name, value: p.rate, text: rateText(p) })));
  const months = data.months;
  fill($('in-trend'), h('caption', { id: 'h-trend' }, 'בזמן לפי חודש (מספר התהליכים בסוגריים)'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'תפקיד'), ...months.map((m) => h('th', { scope: 'col' }, m.short)))),
    h('tbody', {},
      ...d.roles.map((r) => h('tr', {}, h('th', { scope: 'row' }, r.label), ...r.trend.map((t) => h('td', { class: 'num' }, t.done ? `${pct(t.rate)} (${t.done})` : '—')))),
      h('tr', { class: 'is-total' }, h('th', { scope: 'row' }, 'כולם'), ...d.trend.map((t) => h('td', { class: 'num' }, t.done ? `${pct(t.rate)} (${t.done})` : '—')))));
  $('in-late-wrap').hidden = !d.late.length;
  fill($('in-late'), d.late.map((r) => h('li', {},
    h('a', { class: 'wclient', href: `client.html?id=${encodeURIComponent(r.client.id)}#${r.proc.id}` }, clientLabel(r.client)),
    ` · ${r.proc.num} ${r.proc.title} · `, ...r.people.map((p) => personChip(p)), h('span', { class: 'muted' }, ` · נסגר ${dayText(r.completedAt)}, היעד ${dayText(r.dueAt)}`))));
}

function renderQa() {
  const q = data.qa;
  const rows = [...q.editors, { ...q.graphics, graphics: true }];
  const max = Math.max(1, ...rows.map((r) => r.returns));
  const detail = (r) => {
    const parts = [];
    if (r.byRound[0]) parts.push(`החזרה ראשונה: ${r.byRound[0]}`);
    if (r.byRound[1]) parts.push(`שנייה: ${r.byRound[1]}`);
    if (r.byRound[2]) parts.push(`שלישית ומעלה: ${r.byRound[2]}`);
    if (!r.graphics) parts.push(`עברו בקרה: ${r.approved}`);
    return parts.join(' · ');
  };
  const list = rows.filter((r) => r.returns || r.approved);
  fill($('in-qa'), list.length ? h('li', {}, h('ul', { class: 'bars' }, ...list.map((r) => bar({
    id: `qa-${r.graphics ? 'graphics' : r.key}`, label: r.graphics ? `${r.name} (גרפיקות)` : r.name, value: r.returns / max,
    text: r.returns === 1 ? 'החזרה אחת' : `${r.returns} החזרות`, sub: detail(r),
  })))) : emptyItem('לא היו החזרות החודש.', { cls: 'muted' }));
}

function renderDelivery() {
  const d = data.delivery;
  const items = [];
  items.push(h('li', { class: 'in-fact', id: 'dl-median' }, h('strong', {}, 'חציון עד מסירה ראשונה: '), days(d.median),
    d.first.length ? h('span', { class: 'muted' }, ` · ${plural(d.first.length, 'יום צילום אחד', 'ימי צילום')}`) : null));
  items.push(h('li', { class: 'in-fact', id: 'dl-closed' }, h('strong', {}, `נסגרו עם אישור הלקוח תוך ${PROMISE_DAYS} ימי עסקים: `),
    d.closed.length ? `${d.closedWithin} מתוך ${d.closed.length}` : 'לא נסגרו החודש'));
  const max = Math.max(PROMISE_DAYS, ...d.first.map((r) => r.days));
  if (d.first.length) {
    items.push(h('li', {}, h('ul', { class: 'bars' }, ...d.first.map((r) => bar({
      id: `dl-${r.client.id}-${r.n}`, label: `${r.client.name}${r.n > 1 ? ` · סבב ${r.n}` : ''}`, sub: `צולם ${dayText(r.shootAt)} · נשלח ${dayText(r.at)}`,
      value: r.days / max, text: days(r.days),
    })))));
  }
  fill($('in-delivery'), items);
}

function renderRequests() {
  const r = data.requests;
  const fact = (id, k, v) => h('div', { id }, h('dt', {}, k), h('dd', {}, v));
  fill($('in-req'),
    fact('rq-total', 'נפתחו החודש', String(r.total)),
    fact('rq-ontime', 'טופלו בזמן', r.handled ? `${r.onTime} מתוך ${r.handled} (${pct(r.rate)})` : '—'),
    fact('rq-urgent', `דחופות, תוך ${URGENT_MIN} דק׳`, r.urgent ? `${r.urgentOnTime} מתוך ${r.urgent}` : 'לא היו'),
    fact('rq-median', 'זמן טיפול חציוני', r.medianMin === null ? '—' : `${officeMinutes(Math.round(r.medianMin))} בשעות משרד`),
    fact('rq-open', 'עדיין פתוחות', r.open ? `${r.open}${r.openLate ? `, מהן ${r.openLate} באיחור` : ''}` : 'אין'));
}

function renderSatisfaction() {
  const s = data.satisfaction;
  if (!s) { fill($('in-sat'), h('p', { class: 'muted', id: 'sat-none' }, 'הסקרים ללקוחות עוד לא פעילים במערכת. כשיהיו, הציונים יופיעו כאן.')); return; }
  if (!s.count && !s.nps.count) { fill($('in-sat'), h('p', { class: 'muted', id: 'sat-none' }, 'לא התקבלו תשובות החודש.')); return; }
  const avgText = (x) => (x.count ? `${(Math.round(x.avg * 10) / 10).toFixed(1)} · ${plural(x.count, 'תשובה אחת', 'תשובות')}` : '—');
  fill($('in-sat'), h('dl', { class: 'in-facts' },
    h('div', { id: 'sat-avg' }, h('dt', {}, 'ציון ממוצע (1–5)'), h('dd', {}, avgText(s))),
    h('div', { id: 'sat-shoot' }, h('dt', {}, 'יום הצילום'), h('dd', {}, avgText(s.kinds.shoot))),
    h('div', { id: 'sat-delivery' }, h('dt', {}, 'הסרטונים'), h('dd', {}, avgText(s.kinds.delivery))),
    h('div', { id: 'sat-low' }, h('dt', {}, 'ציון 2 או פחות'), h('dd', {}, String(s.low))),
    h('div', { id: 'sat-nps' }, h('dt', {}, 'שאלת ההמלצה (NPS, 0–10)'), h('dd', {}, s.nps.count ? `${s.nps.score} · ${plural(s.nps.count, 'תשובה אחת', 'תשובות')}${s.nps.low ? ` · ${s.nps.low} עם 4 או פחות` : ''}` : '—'))));
}

function renderNa() {
  const list = data.na;
  fill($('in-na'), list.length ? list.map((x) => h('li', { class: `na-row${x.suggest ? ' is-suggest' : ''}`, id: `na-${x.key.replace(/\./g, '-')}` },
    h('p', { class: 'na-item' }, x.label),
    h('p', { class: 'na-meta' }, h('span', { class: 'muted' }, `${x.proc} · `),
      h('span', { class: 'num' }, `${x.na} מתוך ${x.cases} (${pct(x.share)})`),
      x.suggest ? h('span', { class: 'sbadge s-waiting na-flag' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'להסרה בגרסה הבאה') : null)))
    : emptyItem('שום פריט לא סומן ״לא רלוונטי״ החודש.', { cls: 'muted' }));
}

function renderPipeline() {
  const list = data.pipeline;
  fill($('in-pipe'), list.length ? list.map((p) => h('li', { class: 'pipe', id: `pipe-${p.client.id}-${p.n}` },
    h('p', { class: 'pipe-h' },
      h('a', { class: 'wclient', href: `client.html?id=${encodeURIComponent(p.client.id)}` }, clientLabel(p.client)),
      h('span', { class: 'muted' }, [p.n > 1 ? `סבב ${p.n}` : null, `צילום ${dayText(p.shootAt)}`, p.shootType || null].filter(Boolean).join(' · ')),
      p.editor ? personChip(p.editor) : null),
    h('ol', { class: 'pipe-stages' }, ...p.stages.map((s) => {
      const state = s.at ? 'done' : s.imported ? 'imported' : p.next?.key === s.key ? 'next' : 'open';
      const word = { done: dayText(s.at), imported: 'ייבוא', next: 'הבא', open: 'טרם' }[state];
      return h('li', { class: `pipe-st is-${state}`, 'data-stage': s.key },
        h('span', { class: 'pipe-icon', 'aria-hidden': 'true' }),
        h('span', { class: 'pipe-label' }, s.label),
        h('span', { class: 'pipe-when' }, word, s.days !== undefined && s.at ? h('span', { class: 'muted' }, ` · +${s.days}`) : null));
    })),
    p.total !== null ? h('p', { class: 'pipe-total muted' }, `מהצילום ועד התזמון: ${days(p.total)}`) : null))
    : emptyItem('אין ימי צילום בחודש הזה.', { cls: 'muted' }));
}

function render() {
  if (!data) return;
  fill($('in-stats'), stats());
  renderOnTime();
  renderQa();
  renderDelivery();
  renderRequests();
  renderSatisfaction();
  renderNa();
  renderPipeline();
}

// ── The month picker ────────────────────────
function monthOptions() {
  const keys = monthsUpTo(monthKeyIL(new Date()), 12).reverse();
  fill($('in-month'), keys.map((k) => h('option', { value: k, selected: k === month }, monthRange(k).label)));
}
$('in-month').addEventListener('change', (e) => { month = e.target.value; load(); });
$('btn-refresh').addEventListener('click', () => load());

// The kit (docs/ops.md, section 52): every figure and every section opens with its icon square.
dress($('app'), [['#st-ontime', 'clock', 'blue', 'md'], ['#st-returns', 'loop', 'purple', 'md'], ['#st-delivery', 'camera', 'teal', 'md'], ['#st-requests', 'chat', 'orange', 'md'], ['#st-sat', 'heart', 'pink', 'md'],
  ['#h-ontime', 'clock', 'blue', 'md'], ['#h-qa', 'shield', 'purple', 'md'], ['#h-delivery', 'camera', 'teal', 'md'], ['#h-req', 'chat', 'orange', 'md'], ['#h-sat', 'heart', 'pink', 'md'],
  ['#h-na', 'pause', 'navy', 'md'], ['#h-pipe', 'trend', 'green', 'md'], ['#in-ro', 'eye', 'blue'], ['#na-h', 'lock', 'navy']]);

mountSession(async (staff) => {
  const [dir, v] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  $('nav-team').hidden = !canManageTeam(v);
  if (!canSeeInsights(v)) {
    $('no-access').hidden = false;
    $('nav-owner').hidden = true;
    if (v.error) fill($('no-access').querySelector('p'), VIEWER_UNKNOWN);
    return;
  }
  $('in-page').hidden = false;
  $('link-payouts').hidden = !canSeePayouts(v);
  $('link-payouts').before(...officeLinks(v, 'insights.html'));
  $('in-ro').hidden = v.me !== 'lior';
  if (v.me === 'lior') { $('nav-owner').textContent = 'כל הלקוחות במבט'; $('nav-owner').href = 'owner.html#all'; }
  monthOptions();
  await load();
});

