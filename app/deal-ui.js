// "עסקאות חדשות מהשטח": the card at the top of "המשימות שלי" for the office (Irit
// first). Each deal Stav sent is a task "להכין חוזה ל־<עסק>" with its 10-minute
// clock in office time (app/deal-logic.js; the server rings Irit at once and again
// with Ofir when it runs out, app/reminder-rules.js `dealNew`). "להכנת החוזה" opens
// the builder prefilled from the deal (index.html?deal=…); the quote it creates is
// linked to the deal, which makes it "חוזה נשלח". A contract sent another way:
// "החוזה נשלח". A deal that fell through: "בוטל".
import { fill, h, toast, errorText, formatStamp } from './protocol-ui.js';
import { PEOPLE } from './protocol.js';
import { clockTime, clockDigits } from './clocks.js';
import {
  contractTitle, dealSummary, dealDue, dealUrl, pendingDeals, DEAL_MINUTES,
} from './deal-logic.js';
import { loadDeals, setDealStatus } from './deal-data.js';

let box = null;
let deals = [];
let timer = null;
let active = false;

const telHref = (phone) => `tel:${String(phone).replace(/[^\d+]/g, '')}`;
const sellerName = (d) => PEOPLE[d.seller]?.name || 'השטח';

function clockText(d, now = new Date()) {
  const t = clockTime({ deadline: dealDue(d), office: true }, now);
  if (t.state === 'expired') return { late: true, text: `עברו ${DEAL_MINUTES} הדקות` };
  return { late: false, text: `${t.paused ? 'עצור · ' : ''}נשארו ${clockDigits(t.remaining)}` };
}

async function move(d, status, btn, done) {
  btn.disabled = true;
  try {
    await setDealStatus(d.id, status);
  } catch (err) {
    btn.disabled = false;
    toast(`לא נשמר. ${errorText(err)}`);
    return;
  }
  deals = deals.filter((x) => x.id !== d.id);
  render();
  toast(done);
}

function card(d) {
  const c = clockText(d);
  return h('article', { class: 'deal-task', 'data-deal': d.id, 'aria-labelledby': `dt-${d.id}` },
    h('div', { class: 'deal-task-head' },
      h('span', { class: 'deal-task-title', id: `dt-${d.id}`, dir: 'auto' }, contractTitle(d)),
      h('span', { class: `deal-clock${c.late ? ' is-late' : ''}`, role: 'timer' }, c.text)),
    h('p', { class: 'deal-task-meta' }, dealSummary(d)),
    h('p', { class: 'deal-task-meta' },
      `${d.contact_name} · `, h('a', { href: telHref(d.phone), dir: 'ltr' }, d.phone),
      ` · מ${sellerName(d)}, ${formatStamp(d.created_at)}`),
    d.notes ? h('p', { class: 'deal-task-meta' }, `הערות: ${d.notes}`) : null,
    h('div', { class: 'deal-task-acts' },
      // The design keeps pink for the screen's one main action ("לקוח חדש"): a row's own action is the navy outline.
      h('a', { class: 'btn', href: dealUrl(d) }, 'להכנת החוזה'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: (e) => move(d, 'sent', e.currentTarget, `סומן שהחוזה נשלח: ${d.business_name}`) }, 'החוזה נשלח'),
      h('button', {
        type: 'button', class: 'btn btn-ghost',
        onclick: (e) => { if (window.confirm(`לסמן שהעסקה של ${d.business_name} בוטלה?`)) move(d, 'cancelled', e.currentTarget, `העסקה סומנה כמבוטלת: ${d.business_name}`); },
      }, 'בוטל')));
}

function render() {
  const list = pendingDeals(deals);
  box.hidden = !list.length;
  if (!list.length) { fill(box); return; }
  fill(box,
    h('h2', { id: 'deals-h' }, `עסקאות חדשות מהשטח (${list.length})`),
    h('p', { class: 'hint' }, `חוזה תוך ${DEAL_MINUTES} דקות עבודה מכל עסקה. ״להכנת החוזה״ פותח את מחולל ההצעות עם פרטי העסקה.`),
    ...list.map(card));
}

// Once a second: the countdowns only (nothing else is rebuilt, the focus stays).
function tick() {
  if (!box || box.hidden) return;
  const now = new Date();
  for (const el of box.querySelectorAll('.deal-task')) {
    const d = deals.find((x) => x.id === el.dataset.deal);
    const span = el.querySelector('.deal-clock');
    if (!d || !span) continue;
    const c = clockText(d, now);
    if (span.textContent !== c.text) span.textContent = c.text;
    span.classList.toggle('is-late', c.late);
  }
}

// Mounts the card for an office viewer (the database lets only the office read every
// deal); hidden for anyone else, and when the table is not there yet.
export async function mountDeals(el, viewer) {
  box = el;
  if (!el || !viewer || viewer.error || viewer.scope !== 'office') { if (el) el.hidden = true; return; }
  active = true;
  await refreshDeals();
  if (!timer) timer = setInterval(tick, 1000);
}

export async function refreshDeals() {
  if (!box || !active) return;
  try {
    const rows = await loadDeals({ pendingOnly: true });
    deals = rows || [];
  } catch {
    return; // keep the last list
  }
  render();
}
