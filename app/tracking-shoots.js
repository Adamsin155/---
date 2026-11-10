// "מעקב לקוחות", the tab "ימי צילום" (tracking.html#shoots; Irit, 10.11.2026): the tiles, the
// filters and the table. The rows come from app/tracking-shoots-logic.js; app/tracking.js reads
// the clients and the checks once for every tab and hands them here. The shoot date itself is set
// in the client's card (the button opens it at that place). Irit and the owners fix "מכלל",
// "שנותרו" and the status by hand, and turn "יום צילום כל חודש" on and off (app/tracking-fix.js);
// Irit, the owners and Lior set the Channel 14 items' dates (app/tracking-ch14-logic.js).
import { $, fill, h } from './protocol-ui.js';
import { iconSquare } from './kit.js';
import {
  shootRows, shootTiles, filterShoots, typeOptions, monthOptions, waitingLine, totalText, remainingText, dealText, MONTHLY_WORDS,
} from './tracking-shoots-logic.js';
import { canFix, fixLine } from './tracking-fix-logic.js';
import { canSetCh14, ch14Tile } from './tracking-ch14-logic.js';
import { openShootFix, openCh14 } from './tracking-fix.js';

let rows = [];
let byId = new Map();
let viewer = null;
let reload = () => {};
const f = { status: '', type: '', month: '', q: '', ch14: '' };

// Who looks (app/tracking.js), and how the page reads itself again after a save.
export function setShootsViewer(v, again) { viewer = v; if (again) reload = again; }

function tile(name, tone, label, value, extra = '', sub = null) {
  return h('li', { class: `ow-stat sh-stat${extra}` },
    h('span', { class: 'ow-stat-h' }, iconSquare(name, tone, { size: 'sm' }), h('span', { class: 'k' }, label)),
    h('strong', { class: 'v ds-num' }, String(value)),
    sub ? h('span', { class: 'sh-stat-sub' }, sub) : null);
}

// A select's choices, keeping the one chosen when it is still there.
function options(id, list, key) {
  const sel = $(id);
  fill(sel, [h('option', { value: '' }, 'הכל'), ...list.map((o) => h('option', { value: o.value }, o.label))]);
  if (!list.some((o) => o.value === f[key])) f[key] = '';
  sel.value = f[key];
}

const PILL = { waiting: 'k-pill-warn', set: 'k-pill-ok', done: 'k-pill-info' };
const CH14_PILL = { waiting: 'k-pill-warn', set: 'k-pill-ok', shot: 'k-pill-info' };

// A number Irit or the owners may fix: a button that opens the dialog.
function fixable(r, text, label) {
  if (!canFix(viewer)) return h('span', { class: 'num', dir: 'ltr' }, text);
  return h('button', {
    type: 'button', class: 'ct-fix sh-fix', 'aria-label': `תיקון ${label} של ${r.label}: ${text}`, onclick: () => fixRow(r),
  }, h('span', { class: 'num', dir: 'ltr' }, text), h('span', { class: 'ct-pen', 'aria-hidden': 'true' }, '✎'));
}
function fixRow(r) {
  const client = byId.get(r.id);
  if (client) openShootFix({ client, row: r, viewer, saved: () => reload() });
}

function ch14Cell(r) {
  if (!r.ch14) return h('td', { 'data-label': 'ערוץ 14', class: 'sh-14 is-none' }, h('span', { class: 'sh-none' }, '—'));
  const client = byId.get(r.id);
  return h('td', { 'data-label': 'ערוץ 14', class: 'sh-14' },
    h('span', { class: 'sh-14-items' }, ...r.ch14.items.map((x) => h('span', { class: `k-pill ${CH14_PILL[x.state]}` }, x.text))),
    canSetCh14(viewer) && client ? h('button', {
      type: 'button', class: `btn btn-sm sh-14-set${r.ch14.set ? ' btn-ghost' : ''}`, 'aria-label': `קביעת מועד לערוץ 14 ל${r.label}`,
      onclick: () => openCh14({ client, viewer, saved: () => reload() }),
    }, r.ch14.set ? 'שינוי מועד' : 'קביעת מועד לערוץ 14') : null);
}

function row(r) {
  const kinds = [...r.types, ...(r.monthly ? [MONTHLY_WORDS] : [])];
  return h('tr', { 'data-id': r.id, id: `sh-${r.id}`, class: `sh-${r.status}${r.fix ? ' is-fixed' : ''}` },
    h('td', {}, h('a', { class: 'mt-name', href: `client.html?id=${encodeURIComponent(r.id)}` }, r.label),
      r.fix ? h('span', { class: 'ct-by' }, fixLine(r.fix)) : null),
    h('td', { 'data-label': 'סגירת חוזה', class: 'sh-deal' }, h('span', { class: 'num', dir: 'ltr' }, dealText(r.dealAt))),
    h('td', { 'data-label': 'ימי צילום מכלל', class: 'ct-n sh-total' }, fixable(r, totalText(r), 'ימי צילום מכלל')),
    h('td', { 'data-label': 'ימי צילום שנותרו', class: 'ct-n sh-left' }, fixable(r, remainingText(r), 'ימי צילום שנותרו')),
    h('td', { 'data-label': 'סוג / הטבה', class: 'sh-type' },
      h('span', { class: 'sh-kinds' },
        kinds.length ? kinds.map((t) => h('span', { class: t === MONTHLY_WORDS ? 'sh-kind sh-monthly' : 'sh-kind' }, t)) : '—',
        ...r.benefits.map((b) => h('span', { class: 'sh-kind sh-benefit' }, `הטבה: ${b}`)))),
    h('td', { 'data-label': 'סטטוס', class: 'sh-status' }, canFix(viewer)
      ? h('button', { type: 'button', class: 'ct-fix sh-fix-status', 'aria-label': `תיקון הסטטוס של ${r.label}: ${r.statusText}`, onclick: () => fixRow(r) },
        h('span', { class: `k-pill ${PILL[r.status]}` }, r.statusText), h('span', { class: 'ct-pen', 'aria-hidden': 'true' }, '✎'))
      : h('span', { class: `k-pill ${PILL[r.status]}` }, r.statusText)),
    ch14Cell(r),
    h('td', { class: 'sh-act' }, h('a', { class: r.action.set ? 'btn btn-sm btn-primary' : 'btn btn-sm', href: r.action.href }, r.action.text)));
}

function render() {
  if ($('sh-q').value !== f.q) $('sh-q').value = f.q;
  const t = shootTiles(rows);
  const c14 = ch14Tile(rows);
  fill($('sh-stats'), [
    tile('hourglass', 'orange', 'לקוחות ממתינים לקביעת יום צילום', t.waiting, t.waiting ? ' is-waiting' : ''),
    tile('camera', 'blue', 'לקוחות עם 2 ימי צילום', t.two),
    tile('camera', 'purple', 'לקוחות עם 3 ימי צילום', t.three),
    tile('calendar', 'teal', 'לקוחות עם יום צילום כל חודש', t.monthly),
    tile('video', 'navy', 'לקוחות עם אייטם בערוץ 14', c14.total, ' sh-stat-14', `${c14.set} נקבעו מתוך ${c14.total}`),
  ]);
  const shown = filterShoots(rows, f);
  const word = (n) => (n === 1 ? 'לקוח אחד' : `${n} לקוחות`);
  fill($('sh-body'), shown.length ? shown.map(row)
    : [h('tr', { class: 'ct-none' }, h('td', { class: 'mt-empty', colspan: '8' }, rows.length ? 'אין לקוח שמתאים לסינון.' : 'אין לקוחות עם ימי צילום.'))]);
  $('sh-count').textContent = shown.length === rows.length ? word(rows.length) : `${word(shown.length)} מתוך ${rows.length}`;
  $('sh-foot').textContent = waitingLine(shown);
}

// The clients and their checks ({ clientId: { itemKey: row } }), read by app/tracking.js.
export function showShoots(clients, checks, now = new Date()) {
  rows = shootRows(clients, checks, now);
  byId = new Map((clients || []).map((c) => [c.id, c]));
  options('sh-type', typeOptions(rows), 'type');
  options('sh-month', monthOptions(rows), 'month');
  render();
}

$('sh-q').addEventListener('input', (e) => { f.q = e.currentTarget.value; render(); });
for (const [id, key] of [['sh-status', 'status'], ['sh-type', 'type'], ['sh-month', 'month'], ['sh-ch14', 'ch14']]) {
  $(id).addEventListener('change', (e) => { f[key] = e.currentTarget.value; render(); });
}
