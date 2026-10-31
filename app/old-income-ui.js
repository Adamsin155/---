// The tab "הכנסות ישנות" (owner.html#old-income; docs/ops.md, section 86). Loaded once, when the tab is
// first opened. The filter box is in the page and is never drawn again, so typing keeps the cursor.
import { $, fill, h } from './protocol-ui.js';
import { iconSquare } from './kit.js';
import { loadOldIncome } from './old-income-data.js';
import {
  COPY_LINE, SUM_LABEL, NO_NAME, shekels, countText, dateText, totalOf, monthsOf, filterByBusiness, quietLine, isMissingTable,
} from './old-income-logic.js';

const state = { rows: null, missing: false, failed: false, open: new Set(), shut: new Set(), mounted: false };

function say(text, ...more) {
  $('oi-total').hidden = true;
  $('oi-search').hidden = true;
  $('oi-found').hidden = true;
  fill($('oi-months'));
  fill($('oi-msg'), h('p', { class: 'oi-msg', id: 'oi-msg-text' }, text), ...more);
}

function dealRow(r) {
  const quiet = quietLine(r);
  return h('li', { class: 'oi-deal' },
    h('span', { class: 'oi-date' }, dateText(r.deal_date)),
    h('strong', { class: 'oi-biz' }, r.business || NO_NAME),
    r.package ? h('span', { class: 'oi-pkg' }, r.package) : null,
    h('strong', { class: 'oi-amt' }, shekels(r.amount)),
    quiet ? h('span', { class: 'oi-quiet' }, quiet) : null);
}

function monthRow(m, filtering) {
  const open = filtering ? !state.shut.has(m.key) : state.open.has(m.key);
  const id = `oi-m-${m.key}`;
  const toggle = () => {
    const set = filtering ? state.shut : state.open;
    if (set.has(m.key)) set.delete(m.key); else set.add(m.key);
    drawList();
    $(id)?.focus();
  };
  return h('li', { class: 'oi-month' },
    h('button', { type: 'button', class: 'wh-row oi-m', id, 'aria-expanded': String(open), 'aria-controls': `${id}-b`, onclick: toggle },
      iconSquare('calendar', m.key === 'none' ? 'orange' : 'blue'),
      h('span', { class: 'oi-m-t' }, h('strong', {}, m.label), h('span', { class: 'oi-m-n' }, countText(m.count))),
      h('strong', { class: 'oi-m-s' }, shekels(m.sum)),
      h('span', { class: 'oi-chev', 'aria-hidden': 'true' })),
    h('ul', { class: 'oi-deals', id: `${id}-b`, hidden: !open }, ...(open ? m.deals.map(dealRow) : [])));
}

function drawList() {
  const q = $('oi-q').value;
  const found = filterByBusiness(state.rows, q);
  const filtering = !!q.trim();
  const line = $('oi-found');
  line.hidden = !filtering;
  if (filtering) {
    const t = totalOf(found);
    line.textContent = t.count ? `נמצאו ${countText(t.count)} · ${shekels(t.sum)}` : 'לא נמצא עסק בשם הזה';
  }
  fill($('oi-months'), ...monthsOf(found).map((m) => monthRow(m, filtering)));
}

function draw() {
  if (state.missing || (state.rows && !state.rows.length)) {
    say('ההכנסות הישנות עוד לא הועלו למערכת.');
    return;
  }
  if (state.failed) {
    say('לא הצלחנו לטעון.', h('button', { type: 'button', class: 'btn btn-sm', id: 'oi-retry', onclick: load }, 'לנסות שוב'));
    return;
  }
  const all = totalOf(state.rows);
  fill($('oi-msg'));
  $('oi-sum').textContent = shekels(all.sum);
  $('oi-sum-label').textContent = `${SUM_LABEL} · ${countText(all.count)}`;
  $('oi-copy').textContent = COPY_LINE;
  $('oi-total').hidden = false;
  $('oi-search').hidden = false;
  drawList();
}

async function load() {
  state.failed = false;
  say('טוען…');
  try {
    state.rows = await loadOldIncome();
  } catch (err) {
    state.missing = isMissingTable(err);
    state.failed = !state.missing;
  }
  draw();
}

// Called whenever the tab is drawn: the first time it loads; afterwards nothing moves under the hand.
export function showOldIncome() {
  if (state.mounted) return;
  state.mounted = true;
  $('oi-q').addEventListener('input', () => { state.shut.clear(); drawList(); });
  load();
}
