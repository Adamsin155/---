// "עסקאות חדשות מהשטח": the card at the top of "המשימות שלי" for Irit, Ofir and the owners. Each
// deal the field sent is a task "להכין חוזה ל־<עסק>". Since 31.10.2026 (docs/ops.md, section 85) it
// goes to both: "אני לוקח" takes it (public.deal_take; of two presses one wins) and opens the
// builder prefilled from the deal (index.html?deal=…), and its 10-minute clock in office time starts
// (app/deal-logic.js; the rings: app/reminder-rules.js `dealNew`). The other sees "אופיר לקח" for a
// short while, then the card goes away. The owners see every deal and can hand it over. The quote it
// creates is linked to the deal, which makes it "חוזה נשלח". A contract sent another way: "החוזה
// נשלח". A deal that fell through: "בוטל".
import { fill, h, toast, errorText, formatStamp } from './protocol-ui.js';
import { PEOPLE } from './protocol.js';
import { clockTime, clockDigits } from './clocks.js';
import {
  contractTitle, dealSummary, dealDue, dealUrl, pendingDeals, DEAL_MINUTES, DEAL_PREPARERS, docTypeOf, isFreeDeal, takenText,
} from './deal-logic.js';
import { loadDeals, setDealStatus, takeDeal, handOverDeal } from './deal-data.js';
import { canSeeDeals } from './manager-rules.js';

let box = null;
let deals = [];
let timer = null;
let active = false;
let me = null; // Irit or Ofir; null: an owner, who sees every deal and can hand it over

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

// "אני לוקח": it is yours and the builder opens; if the other was faster, the card says so.
async function take(d, btn) {
  btn.disabled = true;
  try {
    const r = await takeDeal(d.id);
    if (r.ok) { location.href = dealUrl(d); return; }
    toast(`${takenText(r.taken_by)} את העסקה של ${d.business_name}.`);
  } catch (err) {
    btn.disabled = false;
    toast(`לא נשמר. ${errorText(err)}`);
    return;
  }
  await refreshDeals();
}

async function handOver(d, person, btn) {
  btn.disabled = true;
  try {
    await handOverDeal(d.id, person);
  } catch (err) {
    btn.disabled = false;
    toast(`לא נשמר. ${errorText(err)}`);
    return;
  }
  await refreshDeals();
  toast(`העסקה של ${d.business_name} אצל ${PEOPLE[person].name}.`);
}

// The actions of the card, by who looks at it and whose the deal is.
function actions(d) {
  const docWord = docTypeOf(d) === 'quote' ? 'ההצעה נשלחה' : 'החוזה נשלח';
  const work = [
    // The design keeps pink for the screen's one main action ("לקוח חדש"): a row's own action is the navy outline.
    h('a', { class: 'btn', href: dealUrl(d) }, docTypeOf(d) === 'quote' ? 'להכנת הצעת המחיר' : 'להכנת החוזה'),
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: (e) => move(d, 'sent', e.currentTarget, `סומן ש${docWord}: ${d.business_name}`) }, docWord),
    h('button', {
      type: 'button', class: 'btn btn-ghost',
      onclick: (e) => { if (window.confirm(`לסמן שהעסקה של ${d.business_name} בוטלה?`)) move(d, 'cancelled', e.currentTarget, `העסקה סומנה כמבוטלת: ${d.business_name}`); },
    }, 'בוטל'),
  ];
  if (!me) {
    const others = DEAL_PREPARERS.filter((p) => p !== d.taken_by);
    return [...work, ...others.map((p) => h('button', { type: 'button', class: 'btn btn-ghost', onclick: (e) => handOver(d, p, e.currentTarget) }, `להעביר ל${PEOPLE[p].name}`))];
  }
  if (d.taken_by === me) return work;
  if (d.taken_by) return [];
  return [h('button', { type: 'button', class: 'btn', onclick: (e) => take(d, e.currentTarget) }, 'אני לוקח')];
}

function card(d) {
  const c = clockText(d);
  return h('article', { class: 'deal-task', 'data-deal': d.id, 'aria-labelledby': `dt-${d.id}` },
    h('div', { class: 'deal-task-head' },
      h('span', { class: 'deal-task-title', id: `dt-${d.id}`, dir: 'auto' }, contractTitle(d)),
      d.taken_by && d.taken_by !== me ? h('span', { class: 'deal-clock' }, takenText(d.taken_by)) : h('span', { class: `deal-clock${c.late ? ' is-late' : ''}`, role: 'timer' }, c.text)),
    // The seller's own words (29.10.2026), whole, as he wrote them; otherwise the line of what was sold.
    isFreeDeal(d) ? h('p', { class: 'deal-task-meta deal-task-words', dir: 'auto' }, `${docTypeOf(d) === 'quote' ? 'הצעת מחיר' : 'חוזה'}: ${d.custom.text}`) : h('p', { class: 'deal-task-meta' }, dealSummary(d)),
    h('p', { class: 'deal-task-meta' },
      `${d.contact_name} · `, h('a', { href: telHref(d.phone), dir: 'ltr' }, d.phone),
      ` · מ${sellerName(d)}, ${formatStamp(d.created_at)}`),
    d.company_id || d.business_address ? h('p', { class: 'deal-task-meta', dir: 'auto' }, [d.company_id ? `ח.פ ${d.company_id}` : null, d.business_address].filter(Boolean).join(' · ')) : null,
    d.notes ? h('p', { class: 'deal-task-meta' }, `הערות: ${d.notes}`) : null,
    h('div', { class: 'deal-task-acts' }, ...actions(d)));
}

function render() {
  const list = pendingDeals(deals, { me });
  box.hidden = !list.length;
  if (!list.length) { fill(box); return; }
  fill(box,
    h('h2', { id: 'deals-h' }, `עסקאות חדשות מהשטח (${list.length})`),
    h('p', { class: 'hint' }, `מי שלוקח ראשון מכין, ויש לו ${DEAL_MINUTES} דקות עבודה. המחולל נפתח עם פרטי העסקה, ומה שנכתב בשטח כבר בתיבת ה־AI.`),
    ...list.map(card));
}

// Once a second: the countdowns only (nothing else is rebuilt, the focus stays).
function tick() {
  if (!box || box.hidden) return;
  const now = new Date();
  for (const el of box.querySelectorAll('.deal-task')) {
    const d = deals.find((x) => x.id === el.dataset.deal);
    const span = el.querySelector('.deal-clock[role="timer"]');
    if (!d || !span) continue;
    const c = clockText(d, now);
    if (span.textContent !== c.text) span.textContent = c.text;
    span.classList.toggle('is-late', c.late);
  }
}

// Mounts the card for Irit, Ofir and the owners (canSeeDeals: a deal carries the discount and
// any price that was agreed, and the database answers only them and the seller); hidden for anyone
// else, and when the table is not there yet. Every half minute it reads again, so that a deal the
// other one took shows it soon.
export async function mountDeals(el, viewer) {
  box = el;
  if (!el || !canSeeDeals(viewer)) { if (el) el.hidden = true; return; }
  active = true;
  me = DEAL_PREPARERS.includes(viewer?.me) ? viewer.me : null;
  await refreshDeals();
  if (!timer) {
    timer = setInterval(tick, 1000);
    setInterval(() => { if (!document.hidden) refreshDeals(); }, 30e3);
  }
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
