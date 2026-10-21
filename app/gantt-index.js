// "גאנט תוכן" without a client (gantt.html, the menu entry of Ilai, the owner, Irit,
// Lior and Ofir): the way into every client's Gantt, also when nobody has open work.
// Since 20.10.2026 (the owner's review, with the Metricool sync on) the page is about
// the problems first:
//  - three filters with counts: "נכשלו" (a failed post), "אין מתוזמן קדימה" (a connected
//    client with nothing scheduled in the next 7 days) and "לא מחוברים ל־Metricool".
//    They open by hash too (#failed, #nothing-ahead, #not-connected: "המשימות שלי"
//    links to them). Under "לא מחוברים" Ilai and the owner get the card
//    "לקוחות שלא מחוברים ל־Metricool" (app/metricool-connect-ui.js), open, in place of
//    the list: they connect the clients right there (docs/ops.md, section 33);
//  - "השבוע": only what needs someone (failed, missing, today's posts not scheduled),
//    and "כל השבוע" for the rest; a row opens that client's Gantt on that day;
//  - "הלקוחות": a short line per active client (connected or not, the next post, or
//    "אין מתוזמן ב־7 הימים הקרובים" in red), problems first; a problem never waits behind
//    "הצג עוד", and a client without a Gantt is one ("יצירת הגאנט מהתבנית": Ilai and the
//    owner, process 9).
// The counting is app/gantt-logic.js (clientSummary, problemRank, weekProblems); who may
// change a Gantt is decided by the database. All text through text nodes.
import { h } from './quote-doc.js';
import { GANTT_KINDS, WEEKDAY_NAMES } from './gantt-template.js';
import {
  clientSummary, bySummary, weekAgenda, weekProblems, weekOf, addDays, timeText, STATUS_TEXT, INDEX_FILTERS, isProblem, AHEAD_DAYS,
} from './gantt-logic.js';
import { clientLabel } from './protocol-logic.js';
import { dayKeyIL } from './tz.js';
import { paintLine, indexLine } from './gantt-brand.js';
import { dateLeaf } from './kit.js'; // already loaded by app/gantt.js: no request is added

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
// The filters, in the order of the chips: [hash, words].
const FILTERS = [['failed', 'נכשלו'], ['nothing-ahead', 'אין מתוזמן קדימה'], ['not-connected', 'לא מחוברים ל־Metricool']];
const NOTHING_AHEAD = `אין מתוזמן ב־${AHEAD_DAYS} הימים הקרובים`;
let state = null; // { clients, byClient, has, plans, conns, canEdit, viewer, ui, sort, q, more, filter, allWeek }

const filterOfHash = () => { const k = location.hash.slice(1); return INDEX_FILTERS[k] ? k : null; };

// ctx: { ui, data, loadClients, canEdit, viewer }.
export async function mountIndex(ctx) {
  const now = new Date();
  const today = dayKeyIL(now);
  $('gx').hidden = false;
  document.title = 'גאנט תוכן · astrateg';
  $('state').textContent = 'טוען…';
  let clients;
  let index;
  let settings;
  let conns;
  try {
    [clients, index, settings, conns] = await Promise.all([
      ctx.loadClients(), ctx.data.loadIndex(addDays(today, -35), addDays(today, 40)), ctx.data.metricoolSettings(), ctx.data.loadConnections().catch(() => null),
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
  state = {
    clients: active, byClient, has: index.has, plans: index.plans || index.has, conns, canEdit: ctx.canEdit, viewer: ctx.viewer, ui: ctx.ui,
    sort: 'missing', q: '', more: false, filter: filterOfHash(), allWeek: false, card: null,
  };
  const withGantt = active.filter((c) => state.plans.has(c.id)).length;
  $('gx-sub').textContent = `${active.length} לקוחות פעילים · ל־${withGantt} יש גאנט`;
  paintLine($('gx-mc'), settings ? indexLine(settings, now) : null);
  renderAll();
  $('gx-q').addEventListener('input', (e) => { state.q = e.target.value; state.more = false; renderClients(summaries(new Date())); });
  for (const s of ['missing', 'name']) {
    $(`gx-sort-${s}`).addEventListener('click', () => { state.sort = s; renderClients(summaries(new Date())); });
  }
  window.addEventListener('hashchange', () => { state.filter = filterOfHash(); state.more = false; renderAll(); });
}

function summaries(now) {
  return state.clients.map((c) => {
    const conn = state.conns ? state.conns.get(c.id) || { blogId: null, none: false } : null;
    return clientSummary(c, state.has.has(c.id) ? state.byClient.get(c.id) || [] : null, now,
      { plan: state.plans.has(c.id), blogId: conn ? conn.blogId : undefined, none: conn?.none });
  });
}

function renderAll() {
  const now = new Date();
  const all = summaries(now);
  renderFilters(all);
  const f = state.filter;
  // A filter is one question: the week waits, and "not connected" is the card itself for those who connect.
  const card = f === 'not-connected' && state.canEdit;
  $('gx-week').hidden = !!f;
  $('gx-clients').hidden = card;
  renderCard(card);
  if (!f) renderWeek(now);
  if (!card) renderClients(all);
}

// ── The filters ─────────────────────────────
function setFilter(key) {
  state.filter = state.filter === key ? null : key;
  state.more = false;
  // The hash follows, so the page opens the same way again (and "המשימות שלי" links to it).
  history.replaceState(null, '', state.filter ? `#${state.filter}` : location.pathname + location.search);
  renderAll();
  $(`gx-f-${key}`)?.focus();
}
function renderFilters(all) {
  const known = !!state.conns;
  $('gx-filters').replaceChildren(h('ul', { class: 'chips-row gx-chips' }, ...FILTERS.filter(([k]) => k === 'failed' || known).map(([k, words]) => {
    const n = all.filter(INDEX_FILTERS[k]).length;
    return h('li', {}, h('button', {
      type: 'button', class: `chip gx-chip${n ? ' has-n' : ''}${k === 'failed' && n ? ' is-hot' : ''}`, id: `gx-f-${k}`, 'data-filter': k,
      'aria-pressed': String(state.filter === k), onclick: () => setFilter(k),
    }, words, h('span', { class: 'n' }, String(n))));
  })),
  ...(state.filter ? [h('button', { type: 'button', class: 'btn-text gx-clear', id: 'gx-clear', onclick: () => setFilter(state.filter) }, 'הצגת כל הלקוחות')] : []));
}

// "לקוחות שלא מחוברים ל־Metricool": the card of section 33, open, for Ilai and the owner.
async function renderCard(show) {
  const box = $('metricool-card');
  if (!show) { box.hidden = true; return; }
  if (state.card) { state.card.refresh({ force: true }); return; }
  const mod = await import('./metricool-connect-ui.js');
  state.card = { refresh: mod.refreshMetricoolConnect };
  await mod.mountMetricoolConnect(box, state.viewer, {
    open: true,
    // A client connected (or marked) there leaves the count of the chip here too.
    changed: (id, fields) => {
      if (!state.conns) return;
      const was = state.conns.get(id) || { blogId: null, none: false };
      state.conns.set(id, { blogId: fields.metricool_blog_id ?? was.blogId, none: fields.metricool_none ?? was.none });
      renderFilters(summaries(new Date()));
    },
  });
  // Before the Metricool columns are in the database (no connections read) there is no
  // card, and nothing to claim about who is connected.
  if (box.hidden && state.conns) {
    // Nothing to connect: the card says nothing, so the page does.
    box.hidden = false;
    box.replaceChildren(h('p', { class: 'gt-none', id: 'gx-card-none' }, 'כל הלקוחות הפעילים מחוברים ל־Metricool, או סומנו שאין להם מותג.'));
  }
}

// ── The week ────────────────────────────────
function renderWeek(now) {
  const week = weekOf(dayKeyIL(now));
  const today = dayKeyIL(now);
  const every = weekAgenda(state.clients, state.byClient, now);
  const problems = weekProblems(every);
  const days = state.allWeek ? every : problems;
  const count = (list) => list.reduce((a, d) => a + d.items.length, 0);
  const n = count(every);
  const bad = count(problems);
  const posts = n === 1 ? 'פרסום אחד' : `${n} פרסומים`;
  $('gxw-sub').textContent = state.allWeek ? `${dm(week.from)}–${dm(week.to)} · ${posts} בכל הלקוחות`
    : `${dm(week.from)}–${dm(week.to)} · ${bad ? `${bad === 1 ? 'בעיה אחת' : `${bad} בעיות`} מתוך ${posts}` : `${posts}, בלי בעיות`}`;
  const toggle = n ? h('button', {
    type: 'button', class: 'btn-text gx-allweek', id: 'gx-allweek', 'aria-expanded': String(state.allWeek),
    onclick: () => { state.allWeek = !state.allWeek; renderWeek(new Date()); $('gx-allweek')?.focus(); },
  }, state.allWeek ? 'רק מה שדורש טיפול' : 'כל השבוע') : null;
  if (!days.length) {
    $('gxw-body').replaceChildren(h('p', { class: 'gt-none' }, n ? 'אין השבוע פרסום שנכשל, חסר או שעוד לא תוזמן להיום.' : 'אין פרסומים מתוכננים השבוע.'), ...(toggle ? [toggle] : []));
    return;
  }
  // Each day of the week opens with its leaf of the calendar (docs/ops.md, section 62).
  const dayLeaf = (key) => {
    const dt = new Date(`${key}T12:00:00Z`);
    const leaf = dateLeaf({ top: key === today ? 'היום' : `יום ${WEEKDAY_NAMES[dt.getUTCDay()]}`, day: dt.getUTCDate(), tone: key < today ? 'teal' : key === today ? 'navy' : key === addDays(today, 1) ? 'blue' : 'purple' });
    leaf.setAttribute('aria-hidden', 'true');
    return leaf;
  };
  $('gxw-body').replaceChildren(h('ol', { class: 'gt-agenda gx-days' }, ...days.map((d) => h('li', { class: `gt-aday has-leaf${d.day === today ? ' is-today' : ''}`, 'data-day': d.day },
    dayLeaf(d.day),
    h('h3', { class: 'gt-aday-h' }, dayLine(d.day), d.day === today ? h('span', { class: 'k-pill k-pill-navy' }, 'היום') : null),
    h('ul', { class: 'gt-rows' }, ...d.items.map(({ entry: e, client, status }) => {
      const k = GANTT_KINDS[e.kind] || GANTT_KINDS.custom;
      // Today's post that is not scheduled yet says so, not just "היום".
      const words = status === 'today' ? 'לא תוזמן' : STATUS_TEXT[status];
      return h('li', { class: `gt-row gx-row s-${status}`, style: kindStyle(e.kind) },
        h('a', { class: 'gt-row-main', href: ganttUrl(client.id, e.day), 'data-client': client.id, 'data-key': e.key },
          h('span', { class: 'gt-row-time num' }, timeText(e.time_il) || 'כל היום'),
          h('span', { class: 'gt-row-text' },
            h('span', { class: 'gt-row-title' }, clientLabel(client)),
            h('span', { class: 'gt-row-meta' }, h('span', { class: 'gt-kind-chip' }, h('span', { class: 'gt-swatch', 'aria-hidden': 'true' }), k.label), e.title)),
          h('span', { class: `gt-state s-${status}` }, stateMark(status), words)));
    }))))), ...(toggle ? [toggle] : []));
}

// ── The clients ─────────────────────────────
function connMark(s) {
  if (s.connected === true) return h('span', { class: 'gx-conn is-on', title: 'מחובר ל־Metricool' }, h('span', { 'aria-hidden': 'true' }, '✓'), ' מחובר');
  if (s.notConnected) return h('span', { class: 'gx-conn is-off', title: 'לא מחובר ל־Metricool' }, h('span', { 'aria-hidden': 'true' }, '✗'), ' לא מחובר');
  if (s.none) return h('span', { class: 'gx-conn is-none' }, 'בלי Metricool');
  return null;
}
function renderClients(all) {
  const q = state.q.trim().toLowerCase();
  const f = state.filter;
  const list = all.filter((s) => (!q || clientLabel(s.client).toLowerCase().includes(q)) && (!f || INDEX_FILTERS[f](s)))
    .sort((a, b) => bySummary(a, b, state.sort));
  for (const s of ['missing', 'name']) $(`gx-sort-${s}`).setAttribute('aria-pressed', String(state.sort === s));
  $('gxc-h').textContent = f ? FILTERS.find(([k]) => k === f)[1] : 'הלקוחות';
  $('gx-none').hidden = list.length > 0;
  $('gx-none').textContent = q ? 'אין לקוח בשם הזה.' : f ? 'אין כאן אף לקוח. יופי.' : 'אין לקוחות פעילים.';
  // A problem is never behind "הצג עוד": the cap is for the quiet ones only.
  const shown = state.more || q || f ? list : list.filter((s, i) => isProblem(s) || i < SHOW);
  $('gx-list').replaceChildren(...shown.map((s) => {
    const c = s.client;
    const bad = s.missing + s.errors;
    const hot = (text) => h('span', { class: 'gx-hot' }, h('span', { class: 'gt-warn', 'aria-hidden': 'true' }, '!'), text);
    const facts = [
      s.failed ? hot(s.failed === 1 ? 'פרסום אחד נכשל' : `${s.failed} פרסומים נכשלו`) : null,
      s.missing ? hot(s.missing === 1 ? 'חסר פרסום אחד' : `${s.missing} חסרים`) : null,
      s.nothingAhead ? hot(NOTHING_AHEAD) : null,
      !s.plan ? h('span', { class: 'gx-noplan' }, 'עוד אין גאנט') : null,
      s.next ? h('span', { class: 'gx-next' }, `הבא: ${dm(s.next.day)}${s.next.time_il ? ` · ${timeText(s.next.time_il)}` : ''}`) : null,
    ].filter(Boolean);
    const main = h('a', { class: 'gx-main', href: ganttUrl(c.id), 'data-client': c.id },
      h('span', { class: 'gx-top' }, h('span', { class: 'gx-name' }, clientLabel(c)), connMark(s)),
      facts.length ? h('span', { class: 'gx-facts' }, ...facts) : null);
    return h('li', { class: `gx-client${s.failed || bad || s.nothingAhead ? ' is-problem' : ''}${bad ? ' has-missing' : ''}${s.plan ? '' : ' no-gantt'}`, 'data-client': c.id },
      main,
      !s.plan && state.canEdit ? h('a', { class: 'btn btn-sm gx-create', href: ganttUrl(c.id) }, 'יצירת הגאנט מהתבנית', h('span', { class: 'sr-only' }, ` ל${clientLabel(c)}`)) : null);
  }));
  const rest = list.length - shown.length;
  const moreBtn = $('gx-more');
  moreBtn.hidden = rest <= 0;
  moreBtn.textContent = `הצג עוד ${rest}`;
  moreBtn.onclick = () => { state.more = true; renderClients(summaries(new Date())); };
}
