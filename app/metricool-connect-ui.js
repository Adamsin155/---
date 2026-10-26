// "לקוחות שלא מחוברים ל-Metricool": one card for whoever connects (Ofir since v11, Ilai, the owner)
// (the owner's request of 6.10.2026; docs/ops.md, section 33), under the exceptional
// contracts. A row per active client with no Metricool brand, the oldest deal first,
// the first 8 and "הצג עוד".
//   - "בחירת מותג" opens the row in place: the account's brands in one select (fetched
//     once, through the edge function `metricool`, only when asked), the one suggested
//     by the name already chosen, and "חיבור". The row goes, and the next one opens:
//     fifty clients are fifty looks at a suggestion, with no page to leave.
//   - "ללקוח אין מותג": the client has no brand and needs none. It is not connected (the
//     owner, 26.10.2026): it moves to the end of the card, in a folded group of its own,
//     "לא רלוונטי ל־Metricool (N)", counted in the card's title, and comes back with
//     "החזרה לרשימה" there (or the toast's "ביטול").
//   - A search box at the top narrows the rows by the business or the person (both groups).
//   - Every client connected: no card at all.
// The list reads only the clients' own columns; the sync and its switch play no part.
// The database decides who may write (public.metricool_connect, public.metricool_set_none:
// Ofir, Ilai and the owner). The rules are app/metricool-connect-logic.js; the styles
// app/styles/metricool-connect.css.
import { supabase } from './supa.js';
import { fill, h, toast, capList } from './protocol-ui.js';
import { errorText as metricoolError } from './metricool-logic.js';
import { fetchBrands, setBrand } from './gantt-data.js';
import {
  canConnect, showsCard, unconnected, withoutBrand, takenBy, brandChoices, optionText, clientLabel, sinceText, cardTitle, withoutTitle, ganttUrl, explainConnect, CONNECT_CAP,
  matchesQuery,
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
let showNone = false;     // the "לא רלוונטי ל־Metricool" group open, as the person chose
let noneBySearch = true; // a search that matches there opens it too, until the person folds it
let mountedFor = null;         // the viewer the card was mounted for
let inPersonal = () => false; // whether the page is in the personal profile now (the owners: no card there)
let expanded = false;    // the card is one quiet line until asked for: the person's own work comes first
let onChanged = null;    // told after a connect or a mark (the Gantt's index recounts)
let pinned = false;      // open for good (the Gantt's index): no "סגירה"
let query = '';          // what is typed in the search box
let parts = null;        // the card's frame while it is shown: the search box is never redrawn, so it keeps its focus and its text

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
  onChanged?.(c.id, fields);
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
    toast(`${clientLabel(c)} סומן ״לא רלוונטי ל־Metricool״ ועבר לסוף הרשימה.`, { label: 'ביטול', run: () => setNone(c, false, null) });
    leave(c, { metricool_none: true }, next);
  } else {
    toast(`${clientLabel(c)} חזר לרשימה.`);
    held(c).metricool_none = false;
    onChanged?.(c.id, { metricool_none: false });
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

// "Metricool" inside a Hebrew line, isolated (<bdi>): a bare Latin word pulls the "(3)" after
// it to its own side, and "ל־Metricool (3)" read as "ל־(3) Metricool".
const isolated = (text) => {
  const i = text.indexOf('Metricool');
  return i < 0 ? [text] : [text.slice(0, i), h('bdi', {}, 'Metricool'), text.slice(i + 'Metricool'.length)];
};

// The frame: the title, the toggle, the search box and the place of the rows. Drawn once
// while the card is shown; a refresh (every minute, or after an action) redraws only the
// rows, so typing in the search is never interrupted.
function frame() {
  if (parts && parts.root === box && box.contains(parts.title)) return parts;
  const title = h('h2', { id: 'metricool-h', tabindex: '-1' });
  const toggle = pinned ? null : h('button', {
    type: 'button', class: 'btn btn-sm mcn-toggle', id: 'mcn-toggle', 'aria-controls': 'mcn-body',
    onclick: () => { expanded = !expanded; if (!expanded) openId = null; render(); box.querySelector('#mcn-toggle')?.focus(); },
  });
  const search = h('input', {
    class: 'input mcn-q', id: 'mcn-q', type: 'search', dir: 'auto', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search',
    placeholder: 'חיפוש לפי עסק או שם', 'aria-controls': 'mcn-rows', value: query,
    oninput: (e) => { query = e.currentTarget.value; noneBySearch = true; renderRows(); },
  });
  const rows = h('div', { id: 'mcn-rows', class: 'mcn-rows' });
  const body = h('div', { id: 'mcn-body' },
    h('div', { class: 'mcn-search' }, h('label', { for: 'mcn-q', class: 'sr-only' }, 'חיפוש לקוח לפי העסק או השם'), search),
    h('p', { class: 'hint' }, 'בוחרים לכל לקוח את המותג שלו ב־Metricool. לקוח שחובר יורד מהרשימה.'),
    rows);
  fill(box, h('div', { class: 'mcn-head' }, title, toggle), body);
  parts = { root: box, title, toggle, body, rows };
  return parts;
}

function render() {
  if (!box) return;
  const list = unconnected(clients);
  const none = marks ? withoutBrand(clients) : [];
  // A client marked "no brand" is still not connected: the card stays while there is one.
  box.hidden = !(list.length + none.length) || !showsCard(mountedFor, inPersonal());
  if (box.hidden) { fill(box); parts = null; return; }
  if (openId && !list.some((c) => c.id === openId)) openId = null;
  const f = frame();
  box.classList.toggle('is-closed', !expanded);
  fill(f.title, ...isolated(cardTitle(list.length + none.length)));
  if (f.toggle) {
    f.toggle.textContent = expanded ? 'סגירה' : 'הצגת הרשימה';
    f.toggle.setAttribute('aria-expanded', String(expanded));
  }
  f.body.hidden = !expanded;
  renderRows();
}

// The rows: the clients to connect (the first 8 and "הצג עוד" while nothing is typed),
// then the folded "לא רלוונטי ל־Metricool" group. A search narrows both, and opens the
// group when a client it holds matches.
function renderRows() {
  if (!parts || !expanded) return;
  const q = query.trim();
  const list = unconnected(clients).filter((c) => matchesQuery(c, q));
  const allNone = marks ? withoutBrand(clients) : [];
  const none = allNone.filter((c) => matchesQuery(c, q));
  // A group that emptied starts folded again when a client next joins it.
  if (!allNone.length) { showNone = false; noneBySearch = true; }
  // The open row was filtered out by the search: it closes.
  if (openId && !list.some((c) => c.id === openId)) openId = null;
  const ul = list.length ? h('ul', { class: 'mcn-list' }, ...list.map(row)) : null;
  // The open row is never one of the hidden ones.
  if (ul && !q && list.findIndex((c) => c.id === openId) < CONNECT_CAP) capList(ul, CONNECT_CAP, 'metricool-connect');
  const groupOpen = none.length > 0 && (showNone || (!!q && noneBySearch));
  const empty = list.length ? null : h('p', { class: 'hint mcn-empty', id: 'mcn-empty', role: 'status' },
    !q ? 'אין כרגע לקוח לחבר.' : none.length ? 'אין לקוח לחבר בשם הזה.' : 'אין לקוח בשם הזה.');
  fill(parts.rows, ul, empty,
    none.length ? h('button', {
      type: 'button', class: 'btn-text mcn-more mcn-none-toggle', id: 'mcn-none-toggle', 'aria-expanded': String(groupOpen), 'aria-controls': 'mcn-none-list',
      onclick: () => { if (groupOpen) { showNone = false; noneBySearch = false; } else showNone = true; renderRows(); box.querySelector('#mcn-none-toggle')?.focus(); },
    }, ...isolated(withoutTitle(none.length)), groupOpen ? ' · הסתרה' : null) : null,
    groupOpen ? h('ul', { class: 'mcn-list is-none', id: 'mcn-none-list' }, ...none.map(noneRow)) : null);
}

// Mounts the card for Ofir, Ilai and the owner; hidden for everyone else, and until the
// brand columns are there. `open`: the list shown at once (the content Gantt's index,
// where the card lives since 20.10.2026; `changed` hears every connect or mark).
export async function mountMetricoolConnect(el, viewer, { personal = () => false, open = false, changed = null } = {}) {
  box = el;
  expanded = open;
  pinned = open;
  onChanged = changed;
  mountedFor = viewer;
  inPersonal = personal;
  if (!el || !canConnect(viewer)) { if (el) el.hidden = true; return; }
  el.classList.add('mcn-card');
  el.setAttribute('aria-labelledby', 'metricool-h');
  active = true;
  await refreshMetricoolConnect();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMetricoolConnect(); });
  setInterval(() => { if (!document.hidden) refreshMetricoolConnect(); }, 60e3);
}

// The page moved between the two profiles (the owners): the card follows, with no new read.
export function syncMetricoolConnect() {
  if (box && active) render();
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
