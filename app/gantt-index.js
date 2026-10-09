// "גאנט תוכן" without a client (gantt.html, the menu entry of Ilai, the owner, Irit,
// Lior and Ofir): the way into every client's Gantt, also when nobody has open work.
//  - "השבוע": everything due to go up this Israel week across the active clients, by
//    day; a row opens that client's Gantt on that day;
//  - "הלקוחות": every active client: its package month, this package month's posts
//    (up, scheduled, missing) and the next post, with a search and "missing first";
//    a client without a Gantt is listed too, with "יצירת הגאנט מהתבנית" for Ilai and the owner.
// The counting is app/gantt-logic.js (clientSummary, weekAgenda); who may change a Gantt
// is decided by the database. All text through text nodes.
import { h } from './quote-doc.js';
import { GANTT_KINDS, WEEKDAY_NAMES } from './gantt-template.js';
import { clientSummary, bySummary, weekAgenda, weekOf, addDays, timeText, STATUS_TEXT } from './gantt-logic.js';
import { clientLabel } from './protocol-logic.js';
import { dayKeyIL } from './tz.js';
import { paintLine, indexLine } from './gantt-brand.js';

const $ = (id) => document.getElementById(id);
const enc = encodeURIComponent;
const dm = (key) => { const [, m, d] = String(key).split('-').map(Number); return `${d}.${m}`; };
const dayLine = (key) => `יום ${WEEKDAY_NAMES[new Date(`${key}T12:00:00Z`).getUTCDay()]}, ${dm(key)}`;
const kindStyle = (kind) => `--k:${(GANTT_KINDS[kind] || GANTT_KINDS.custom).color};--ks:${(GANTT_KINDS[kind] || GANTT_KINDS.custom).soft}`;
const ganttUrl = (id, day = null) => `gantt.html?id=${enc(id)}${day ? `&m=${day.slice(0, 7)}&d=${day}` : ''}`;
export const stateMark = (s) => (s === 'posted' ? h('span', { class: 'gt-tick', 'aria-hidden': 'true' }, '✓')
  : s === 'scheduled' ? h('span', { class: 'gt-clock', 'aria-hidden': 'true' })
    : s === 'missing' || s === 'error' ? h('span', { class: 'gt-warn', 'aria-hidden': 'true' }, '!') : null);

const SHOW = 12;
let state = null; // { clients, byClient, has, canEdit, sort, q, more }

// ctx: { ui, data, loadClients, canEdit }.
export async function mountIndex(ctx) {
  const now = new Date();
  const today = dayKeyIL(now);
  $('gx').hidden = false;
  document.title = 'גאנט תוכן · astrateg';
  $('state').textContent = 'טוען…';
  let clients;
  let index;
  let settings;
  try {
    [clients, index, settings] = await Promise.all([
      ctx.loadClients(), ctx.data.loadIndex(addDays(today, -35), addDays(today, 40)), ctx.data.metricoolSettings(),
    ]);
  } catch (err) {
    $('state').textContent = ctx.ui.errorText(err);
    return;
  }
  $('state').textContent = '';
  if (index === null) {
    $('gx-sub').textContent = 'הגאנט יהיה זמין אחרי שהמיגרציה של הגאנט תוחל במסד.';
    return;
  }
  const active = clients.filter((c) => ['active', 'ending'].includes(c.status));
  const byClient = new Map();
  for (const r of index.rows) { if (!byClient.has(r.client_id)) byClient.set(r.client_id, []); byClient.get(r.client_id).push(r); }
  state = { clients: active, byClient, has: index.has, canEdit: ctx.canEdit, sort: 'missing', q: '', more: false };
  const withGantt = active.filter((c) => index.has.has(c.id)).length;
  $('gx-sub').textContent = `${active.length} לקוחות פעילים · ל־${withGantt} יש גאנט`;
  paintLine($('gx-mc'), settings ? indexLine(settings, now) : null);
  renderWeek(now);
  renderClients(now);
  $('gx-q').addEventListener('input', (e) => { state.q = e.target.value; state.more = false; renderClients(new Date()); });
  for (const s of ['missing', 'name']) {
    $(`gx-sort-${s}`).addEventListener('click', () => { state.sort = s; renderClients(new Date()); });
  }
}

function renderWeek(now) {
  const week = weekOf(dayKeyIL(now));
  const today = dayKeyIL(now);
  const days = weekAgenda(state.clients, state.byClient, now);
  const n = days.reduce((a, d) => a + d.items.length, 0);
  $('gxw-sub').textContent = `${dm(week.from)}–${dm(week.to)} · ${n === 1 ? 'פרסום אחד' : `${n} פרסומים`} בכל הלקוחות`;
  if (!days.length) { $('gxw-body').replaceChildren(h('p', { class: 'gt-none' }, 'אין פרסומים מתוכננים השבוע.')); return; }
  $('gxw-body').replaceChildren(h('ol', { class: 'gt-agenda gx-days' }, ...days.map((d) => h('li', { class: `gt-aday${d.day === today ? ' is-today' : ''}`, 'data-day': d.day },
    h('h3', { class: 'gt-aday-h' }, dayLine(d.day), d.day === today ? h('span', { class: 'k-pill k-pill-navy' }, 'היום') : null),
    h('ul', { class: 'gt-rows' }, ...d.items.map(({ entry: e, client, status }) => {
      const k = GANTT_KINDS[e.kind] || GANTT_KINDS.custom;
      return h('li', { class: `gt-row gx-row s-${status}`, style: kindStyle(e.kind) },
        h('a', { class: 'gt-row-main', href: ganttUrl(client.id, e.day), 'data-client': client.id, 'data-key': e.key },
          h('span', { class: 'gt-row-time num' }, timeText(e.time_il) || 'כל היום'),
          h('span', { class: 'gt-row-text' },
            h('span', { class: 'gt-row-title' }, clientLabel(client)),
            h('span', { class: 'gt-row-meta' }, h('span', { class: 'gt-kind-chip' }, h('span', { class: 'gt-swatch', 'aria-hidden': 'true' }), k.label), e.title)),
          h('span', { class: `gt-state s-${status}` }, stateMark(status), STATUS_TEXT[status])));
    }))))));
}

function summaryLine(s) {
  if (!s.has) return 'עוד אין גאנט';
  const parts = [];
  if (s.month >= 1 && s.month <= s.of) parts.push(`חודש ${s.month} מתוך ${s.of}`);
  else if (s.month > s.of) parts.push('תקופת החוזה הסתיימה');
  else parts.push('לפני תחילת החוזה');
  return parts.join(' · ');
}
function renderClients(now) {
  const q = state.q.trim().toLowerCase();
  const all = state.clients.map((c) => clientSummary(c, state.has.has(c.id) ? state.byClient.get(c.id) || [] : null, now))
    .filter((s) => !q || clientLabel(s.client).toLowerCase().includes(q))
    .sort((a, b) => bySummary(a, b, state.sort));
  for (const s of ['missing', 'name']) $(`gx-sort-${s}`).setAttribute('aria-pressed', String(state.sort === s));
  $('gx-none').hidden = all.length > 0;
  $('gx-none').textContent = q ? 'אין לקוח בשם הזה.' : 'אין לקוחות פעילים.';
  const shown = state.more || q ? all : all.slice(0, SHOW);
  const count = (cls, n, label) => h('span', { class: `gx-n ${cls}${n ? '' : ' is-zero'}` }, h('strong', { class: 'num' }, String(n)), ` ${label}`);
  $('gx-list').replaceChildren(...shown.map((s) => {
    const c = s.client;
    const next = s.next ? `הבא: ${dm(s.next.day)}${s.next.time_il ? ` · ${timeText(s.next.time_il)}` : ''} · ${s.next.title}` : s.has ? 'אין פרסום קרוב' : '';
    const bad = s.missing + s.errors;
    const main = h('a', { class: 'gx-main', href: ganttUrl(c.id), 'data-client': c.id },
      h('span', { class: 'gx-name' }, clientLabel(c)),
      h('span', { class: 'gx-sub' }, summaryLine(s)),
      s.has ? h('span', { class: 'gx-counts' },
        count('n-up', s.posted, 'עלו'), count('n-sched', s.scheduled, 'תוזמנו'),
        bad ? h('span', { class: 'gx-n n-miss' }, h('span', { class: 'gt-warn', 'aria-hidden': 'true' }, '!'), h('strong', { class: 'num' }, String(bad)), bad === 1 ? ' חסר' : ' חסרים') : null) : null,
      next ? h('span', { class: 'gx-next' }, next) : null);
    return h('li', { class: `gx-client${bad ? ' has-missing' : ''}${s.has ? '' : ' no-gantt'}`, 'data-client': c.id },
      main,
      !s.has && state.canEdit ? h('a', { class: 'btn btn-sm gx-create', href: ganttUrl(c.id) }, 'יצירת הגאנט מהתבנית', h('span', { class: 'sr-only' }, ` ל${clientLabel(c)}`)) : null);
  }));
  const rest = all.length - shown.length;
  const moreBtn = $('gx-more');
  moreBtn.hidden = rest <= 0;
  moreBtn.textContent = `הצג עוד ${rest}`;
  moreBtn.onclick = () => { state.more = true; renderClients(new Date()); };
}
