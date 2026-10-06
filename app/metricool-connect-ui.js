// "לקוחות שלא מחוברים ל-Metricool": one card in "המשימות שלי" of Ilai and the owner
// (the owner's request of 6.10.2026; docs/ops.md, section 33), under the exceptional
// contracts. A row per active client with no Metricool brand, the oldest deal first,
// the first 8 and "הצג עוד".
//   - "בחירת מותג" opens the row in place: the account's brands in one select (fetched
//     once, through the edge function `metricool`, only when asked), the one suggested
//     by the name already chosen, and "חיבור". The row goes, and the next one opens:
//     fifty clients are fifty looks at a suggestion, with no page to leave.
//   - "ללקוח אין מותג": the client has no brand and needs none; it leaves the list, and
//     comes back from "סומנו ״אין מותג״" at the foot of the card.
//   - Nothing to connect: no card at all.
// The list reads only the clients' own columns; the sync and its switch play no part.
// The database decides who may write (public.gantt_set_brand, public.metricool_set_none:
// Ilai and the owner). The rules are app/metricool-connect-logic.js; the styles
// app/styles/metricool-connect.css.
import { supabase } from './supa.js';
import { fill, h, toast, capList } from './protocol-ui.js';
import { errorText as metricoolError } from './metricool-logic.js';
import { fetchBrands, setBrand } from './gantt-data.js';
import {
  canConnect, unconnected, withoutBrand, takenBy, brandChoices, optionText, clientLabel, sinceText, cardTitle, withoutTitle, ganttUrl, explainConnect, CONNECT_CAP,
} from './metricool-connect-logic.js';

const BASE_COLS = 'id, name, business, status, deal_at, archived_at, metricool_blog_id, metricool_brand';
const missingColumn = (error) => ['42703', 'PGRST204'].includes(error?.code) || /column .* does not exist/i.test(String(error?.message || ''));

let box = null;
let clients = [];
let marks = true;        // "ללקוח אין מותג": false until its migration is in (20261012100000)
let active = false;
let openId = null;       // the client whose row is open
let brands = null;       // the account's brands, once fetched
let brandsError = null;  // the short code of a fetch that failed (asked again on the next open)
let showNone = false;

// ── Data ────────────────────────────────────
// Every client this login reads, with its brand. null: the brand columns are not there
// yet (before 20261007100100).
async function loadClients() {
  const read = (cols) => supabase.from('clients').select(cols).order('deal_at', { ascending: true }).limit(2000);
  let { data, error } = await read(`${BASE_COLS}, metricool_none`);
  marks = !error;
  if (error && missingColumn(error)) ({ data, error } = await read(BASE_COLS));
  if (error) {
    if (missingColumn(error)) return null;
    throw error;
  }
  return data || [];
}
async function loadBrandList() {
  if (brands) return;
  try {
    brands = await fetchBrands();
    brandsError = null;
  } catch (err) {
    brandsError = err?.code || 'server_error';
  }
}

// ── Actions ─────────────────────────────────
// The row that takes the place of the one that just left (or the last one).
function nextAfter(id) {
  const list = unconnected(clients);
  const i = list.findIndex((c) => c.id === id);
  return list[i + 1] || list[i - 1] || null;
}
// The client's row as it is held now (the list may have been read again since the click).
const held = (c) => clients.find((x) => x.id === c.id) || c;
function leave(c, fields, next) {
  Object.assign(held(c), fields);
  openId = brands && next ? next.id : null;
  render();
  (box?.querySelector('#mcn-brand') || box?.querySelector('h2'))?.focus();
}

async function connect(c, btn) {
  const sel = box.querySelector('#mcn-brand');
  const err = box.querySelector('#mcn-err');
  const brand = brands?.find((b) => b.id === sel.value);
  if (!brand) { err.textContent = 'בוחרים מותג מהרשימה.'; err.hidden = false; sel.focus(); return; }
  btn.disabled = true;
  const next = nextAfter(c.id);
  try {
    const saved = await setBrand(c.id, brand.id, brand.label);
    toast(`${clientLabel(c)} חובר למותג ״${saved.brand || brand.label}״.`);
    leave(c, { metricool_blog_id: saved.blogId || brand.id, metricool_brand: saved.brand || brand.label, metricool_none: false }, next);
  } catch (e) {
    btn.disabled = false;
    err.textContent = explainConnect(e);
    err.hidden = false;
    // Someone else took the brand, or archived this client, in the meantime: the fresh
    // list redraws the row, so the words go to the toast as well.
    if (/brand_taken|client not found/.test(e?.message || '')) { toast(explainConnect(e)); await refreshMetricoolConnect({ force: true }); }
  }
}

async function setNone(c, on, btn) {
  if (btn) btn.disabled = true;
  const next = on ? nextAfter(c.id) : null;
  const { error } = await supabase.rpc('metricool_set_none', { p_client: c.id, p_on: on });
  if (error) {
    toast(explainConnect(error));
    if (btn) btn.disabled = false;
    if (/connected:|client not found/.test(error.message || '')) await refreshMetricoolConnect({ force: true });
    return;
  }
  if (on) {
    toast(`${clientLabel(c)} סומן ״אין מותג״ וירד מהרשימה.`, { label: 'ביטול', run: () => setNone(c, false, null) });
    leave(c, { metricool_none: true }, next);
  } else {
    toast(`${clientLabel(c)} חזר לרשימה.`);
    held(c).metricool_none = false;
    render();
    if (btn) (box?.querySelector('#mcn-none-toggle') || box?.querySelector('h2'))?.focus();
  }
}

async function open(c, btn) {
  btn.disabled = true;
  btn.textContent = 'טוען את המותגים…';
  await loadBrandList();
  openId = c.id;
  render();
  (box.querySelector('#mcn-brand') || box.querySelector('.mcn-panel a, .mcn-panel button'))?.focus();
}
function close(c) {
  openId = null;
  render();
  box.querySelector(`[data-client="${c.id}"] [data-act="open"]`)?.focus();
}

// ── The card ────────────────────────────────
const who = (c) => h('div', { class: 'mcn-who' },
  h('strong', { class: 'mcn-name', dir: 'auto' }, clientLabel(c)),
  sinceText(c.deal_at) ? h('span', { class: 'mcn-since' }, sinceText(c.deal_at)) : null);
const noneBtn = (c) => (marks ? h('button', { type: 'button', class: 'btn btn-ghost', 'data-act': 'none', onclick: (e) => setNone(c, true, e.currentTarget) }, 'ללקוח אין מותג') : null);
const closeBtn = (c) => h('button', { type: 'button', class: 'btn-text mcn-close', 'data-act': 'close', onclick: () => close(c) }, 'סגירה');

function panel(c) {
  if (!brands) {
    return h('div', { class: 'mcn-panel' },
      h('p', { class: 'err', role: 'alert', id: 'mcn-err' }, `לא הצלחנו לקבל את רשימת המותגים. ${metricoolError(brandsError)}`),
      h('div', { class: 'mcn-acts' },
        h('a', { class: 'btn', 'data-act': 'gantt', href: ganttUrl(c.id) }, 'פתיחת הגאנט של הלקוח'), noneBtn(c), closeBtn(c)));
  }
  const { options, pick } = brandChoices(c, brands, takenBy(clients, c.id));
  return h('form', { class: 'mcn-panel', novalidate: true, onsubmit: (e) => { e.preventDefault(); connect(c, e.currentTarget.querySelector('.mcn-save')); } },
    h('label', { class: 'mcn-label', for: 'mcn-brand' }, 'המותג ב־Metricool'),
    h('select', { class: 'input', id: 'mcn-brand', 'aria-describedby': 'mcn-err', onchange: () => { box.querySelector('#mcn-err').hidden = true; } },
      h('option', { value: '' }, options.length ? 'לא נבחר מותג' : 'אין מותגים בחשבון ה־Metricool'),
      ...options.map((o) => h('option', { value: o.id, selected: o.id === pick ? true : null, disabled: o.taken ? true : null }, optionText(o)))),
    h('p', { class: 'err', id: 'mcn-err', role: 'alert', hidden: true }),
    h('div', { class: 'mcn-acts' },
      h('button', { type: 'submit', class: 'btn mcn-save', 'data-act': 'save' }, 'חיבור'), noneBtn(c), closeBtn(c)));
}

function row(c) {
  const isOpen = c.id === openId;
  return h('li', { class: `mcn-row${isOpen ? ' is-open' : ''}`, 'data-client': c.id },
    who(c),
    isOpen ? panel(c) : h('button', { type: 'button', class: 'btn mcn-open', 'data-act': 'open', 'aria-label': `בחירת מותג: ${clientLabel(c)}`, onclick: (e) => open(c, e.currentTarget) }, 'בחירת מותג'));
}
const noneRow = (c) => h('li', { class: 'mcn-row is-none', 'data-client': c.id },
  who(c),
  h('button', { type: 'button', class: 'btn btn-ghost', 'data-act': 'back', 'aria-label': `החזרה לרשימה: ${clientLabel(c)}`, onclick: (e) => setNone(c, false, e.currentTarget) }, 'החזרה לרשימה'));

function render() {
  if (!box) return;
  const list = unconnected(clients);
  box.hidden = !list.length;
  if (box.hidden) { fill(box); return; }
  if (openId && !list.some((c) => c.id === openId)) openId = null;
  const none = marks ? withoutBrand(clients) : [];
  const ul = h('ul', { class: 'mcn-list' }, ...list.map(row));
  // The open row is never one of the hidden ones.
  if (list.findIndex((c) => c.id === openId) < CONNECT_CAP) capList(ul, CONNECT_CAP, 'metricool-connect');
  fill(box,
    h('h2', { id: 'metricool-h', tabindex: '-1' }, cardTitle(list.length)),
    h('p', { class: 'hint' }, 'בוחרים לכל לקוח את המותג שלו ב־Metricool. לקוח שחובר יורד מהרשימה.'),
    ul,
    none.length ? h('button', {
      type: 'button', class: 'btn-text mcn-more', id: 'mcn-none-toggle', 'aria-expanded': String(showNone),
      onclick: () => { showNone = !showNone; render(); box.querySelector('#mcn-none-toggle')?.focus(); },
    }, showNone ? 'הסתרה' : withoutTitle(none.length)) : null,
    showNone && none.length ? h('ul', { class: 'mcn-list', id: 'mcn-none-list' }, ...none.map(noneRow)) : null);
}

// Mounts the card for Ilai and the owner; hidden for everyone else, and until the
// brand columns are there.
export async function mountMetricoolConnect(el, viewer) {
  box = el;
  if (!el || !canConnect(viewer)) { if (el) el.hidden = true; return; }
  el.classList.add('mcn-card');
  el.setAttribute('aria-labelledby', 'metricool-h');
  active = true;
  await refreshMetricoolConnect();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMetricoolConnect(); });
  setInterval(() => { if (!document.hidden) refreshMetricoolConnect(); }, 60e3);
}

export async function refreshMetricoolConnect({ force = false } = {}) {
  if (!box || !active) return;
  // While a brand is being chosen, the list waits.
  if (openId && !force) return;
  try {
    const rows = await loadClients();
    if (rows === null) { clients = []; active = false; box.hidden = true; fill(box); return; }
    clients = rows;
  } catch {
    return; // keep the last list
  }
  if (openId && !force) return;
  render();
}
