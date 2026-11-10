// "מעקב לקוחות", the tab "ימי צילום" (tracking.html#shoots; Irit, 10.11.2026): the tiles, the
// filters and the table. The rows come from app/tracking-shoots-logic.js; app/tracking.js reads
// the clients and the checks once for every tab and hands them here. Read-only: the date is set in
// the client's card (the button opens it at that place).
import { $, fill, h } from './protocol-ui.js';
import { iconSquare } from './kit.js';
import {
  shootRows, shootTiles, filterShoots, typeOptions, monthOptions, waitingLine, totalText, remainingText, dealText, MONTHLY_WORDS,
} from './tracking-shoots-logic.js';

let rows = [];
const f = { status: '', type: '', month: '', q: '' };

function tile(name, tone, label, value, extra = '') {
  return h('li', { class: `ow-stat sh-stat${extra}` },
    h('span', { class: 'ow-stat-h' }, iconSquare(name, tone, { size: 'sm' }), h('span', { class: 'k' }, label)),
    h('strong', { class: 'v ds-num' }, String(value)));
}

// A select's choices, keeping the one chosen when it is still there.
function options(id, list, key) {
  const sel = $(id);
  fill(sel, [h('option', { value: '' }, 'הכל'), ...list.map((o) => h('option', { value: o.value }, o.label))]);
  if (!list.some((o) => o.value === f[key])) f[key] = '';
  sel.value = f[key];
}

const PILL = { waiting: 'k-pill-warn', set: 'k-pill-ok', done: 'k-pill-info' };
function row(r) {
  const kinds = [...r.types, ...(r.monthly ? [MONTHLY_WORDS] : [])];
  return h('tr', { 'data-id': r.id, id: `sh-${r.id}`, class: `sh-${r.status}` },
    h('td', {}, h('a', { class: 'mt-name', href: `client.html?id=${encodeURIComponent(r.id)}` }, r.label)),
    h('td', { 'data-label': 'סגירת חוזה', class: 'sh-deal' }, h('span', { class: 'num', dir: 'ltr' }, dealText(r.dealAt))),
    h('td', { 'data-label': 'ימי צילום מכלל', class: 'ct-n' }, h('span', { class: 'num', dir: 'ltr' }, totalText(r))),
    h('td', { 'data-label': 'ימי צילום שנותרו', class: 'ct-n' }, h('span', { class: 'num', dir: 'ltr' }, remainingText(r))),
    h('td', { 'data-label': 'סוג / הטבה', class: 'sh-type' },
      h('span', { class: 'sh-kinds' },
        kinds.length ? kinds.map((t) => h('span', { class: t === MONTHLY_WORDS ? 'sh-kind sh-monthly' : 'sh-kind' }, t)) : '—',
        ...r.benefits.map((b) => h('span', { class: 'sh-kind sh-benefit' }, `הטבה: ${b}`)))),
    h('td', { 'data-label': 'סטטוס', class: 'sh-status' }, h('span', { class: `k-pill ${PILL[r.status]}` }, r.statusText)),
    h('td', { class: 'sh-act' }, h('a', { class: r.action.set ? 'btn btn-sm btn-primary' : 'btn btn-sm', href: r.action.href }, r.action.text)));
}

function render() {
  if ($('sh-q').value !== f.q) $('sh-q').value = f.q;
  const t = shootTiles(rows);
  fill($('sh-stats'), [
    tile('hourglass', 'orange', 'לקוחות ממתינים לקביעת יום צילום', t.waiting, t.waiting ? ' is-waiting' : ''),
    tile('camera', 'blue', 'לקוחות עם 2 ימי צילום', t.two),
    tile('camera', 'purple', 'לקוחות עם 3 ימי צילום', t.three),
    tile('calendar', 'teal', 'לקוחות עם יום צילום כל חודש', t.monthly),
  ]);
  const shown = filterShoots(rows, f);
  const word = (n) => (n === 1 ? 'לקוח אחד' : `${n} לקוחות`);
  fill($('sh-body'), shown.length ? shown.map(row)
    : [h('tr', { class: 'ct-none' }, h('td', { class: 'mt-empty', colspan: '7' }, rows.length ? 'אין לקוח שמתאים לסינון.' : 'אין לקוחות עם ימי צילום.'))]);
  $('sh-count').textContent = shown.length === rows.length ? word(rows.length) : `${word(shown.length)} מתוך ${rows.length}`;
  $('sh-foot').textContent = waitingLine(shown);
}

// The clients and their checks ({ clientId: { itemKey: row } }), read by app/tracking.js.
export function showShoots(clients, checks, now = new Date()) {
  rows = shootRows(clients, checks, now);
  options('sh-type', typeOptions(rows), 'type');
  options('sh-month', monthOptions(rows), 'month');
  render();
}

$('sh-q').addEventListener('input', (e) => { f.q = e.currentTarget.value; render(); });
for (const [id, key] of [['sh-status', 'status'], ['sh-type', 'type'], ['sh-month', 'month']]) {
  $(id).addEventListener('change', (e) => { f[key] = e.currentTarget.value; render(); });
}
