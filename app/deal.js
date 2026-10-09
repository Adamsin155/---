// deal.html: the field sales agent's page (Stav; the owner's decision of 3.10.2026).
// "עסקה חדשה": the business, the contact, the phone, the package, the influencers,
// the add-ons, the discount and notes, sent "לעירית להכנת חוזה"; under it his own
// deals with their status (ממתין לחוזה / חוזה נשלח / נחתם). He sees nothing else: the
// database lets him read and add only his own deals (deal_requests, row level
// security), and no client, item, vault, quote or payout. The logic is
// app/deal-logic.js; Irit's side is in "המשימות שלי" (app/deal-ui.js) and the builder.
import { TIERS, INFLUENCERS, FREE_ADDONS, PACKAGES, packageId } from './catalog.js';
import { formatILS } from './pricing.js';
import { PEOPLE, isSales } from './protocol.js';
import {
  validateDeal, addonsFor, statusText, byNewest, dealSummary,
} from './deal-logic.js';
import { loadDeals, addDeal } from './deal-data.js';
import { $, fill, h, toast, errorText, mountSession, viewerOf, formatStamp } from './protocol-ui.js';
import { mountPush } from './push.js';
import { mountStaffTasks } from './staff-tasks-ui.js';
import { icon as kIcon, iconSquare, headIcon } from './kit.js';

// The look of the kit (app/kit.js; docs/ops.md, section 53): every card of the form takes
// its icon square in front of its heading; the words and the fields stay as they are.
const SEC_LOOK = [['user', 'navy'], ['handshake', 'purple'], ['edit', 'orange'], ['box', 'blue'], ['users', 'pink'], ['star', 'green'], ['tag', 'teal']];
document.querySelectorAll('#deal-form > .deal-sec > legend').forEach((lg, i) => headIcon(lg, ...(SEC_LOOK[i] || ['list', 'navy']), { size: 'md' }));
headIcon($('mine-h'), 'briefcase', 'navy', { size: 'md' });
headIcon($('na-h'), 'lock', 'navy', { size: 'md' });
const STATUS_ICON = { pending: ['hourglass', 'orange'], approval: ['shield', 'blue'], rejected: ['alert', 'pink'], sent: ['send', 'purple'], signed: ['check-circle', 'green'], cancelled: ['archive', 'navy'] };

let me = null;
let deals = [];
// "הצעה אחרת" (6.10.2026): the seller's own words and numbers instead of a built-in package.
const CUSTOM_FIELDS = ['description', 'videos', 'graphics', 'shoot_days', 'price', 'term_months'];
const FIELDS = ['business', 'contact', 'phone', 'tier', 'influencer', 'discount', ...CUSTOM_FIELDS];
const FIELD_OF = {
  business_name: 'business', contact_name: 'contact', phone: 'phone', tier: 'tier', influencer: 'influencer', discount: 'discount',
  ...Object.fromEntries(CUSTOM_FIELDS.map((f) => [f, f])),
};
const kind = () => (document.querySelector('input[name="kind"]:checked')?.value === 'custom' ? 'custom' : 'package');
// The chosen kind shows its own fields; the other kind's are hidden (and not sent).
function showKind() {
  const custom = kind() === 'custom';
  $('d-custom').hidden = !custom;
  for (const el of document.querySelectorAll('.deal-builtin')) el.hidden = custom;
  $('d-submit').textContent = SUBMIT_TEXT();
}
const SUBMIT_TEXT = () => (kind() === 'custom' ? 'לעירית להכנת חוזה מותאם' : 'לעירית להכנת חוזה');
for (const el of document.querySelectorAll('input[name="kind"]')) el.addEventListener('change', () => { showErrors({}); showKind(); });

// ── The form ────────────────────────────────
const picked = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || null;

// The package's monthly price once the influencers are known (as in the builder).
const tierSub = (t, inf) => (inf ? `${t.name} · ${formatILS(PACKAGES[packageId(t.id, inf)].price)} לחודש` : t.name);
function renderChoices() {
  fill($('d-tiers'), ...TIERS.map((t) => choice('radio', 'tier', t.id, t.short, tierSub(t, null), false)));
  fill($('d-influencers'), ...Object.values(INFLUENCERS).map((i) => choice('radio', 'influencer', i.id, i.name, null, false)));
  renderAddons();
}
// A choice changed: the prices and the add-ons follow, in place (the focus stays on the radio).
function choiceChanged(name) {
  const inf = picked('influencer');
  for (const t of TIERS) {
    const sub = document.querySelector(`label[for="d-tier-${t.id}"] .deal-choice-sub`);
    if (sub) sub.textContent = tierSub(t, inf);
  }
  renderAddons();
  clearErr(FIELD_OF[name]);
}

function choice(type, name, value, label, sub, checked) {
  const id = `d-${name}-${value}`;
  return h('label', { class: 'deal-choice', for: id },
    h('input', { type, class: type === 'radio' ? 'radio' : 'cbox', name, id, value, checked, onchange: () => { if (name === 'tier' || name === 'influencer') choiceChanged(name); } }),
    h('span', { class: 'deal-choice-text' }, h('span', { class: 'deal-choice-label', dir: 'auto' }, label), sub ? h('span', { class: 'deal-choice-sub', dir: 'auto' }, sub) : null));
}

// The add-ons this package allows (the builder's rules); the ones already ticked stay ticked.
function renderAddons() {
  const tier = picked('tier');
  const inf = picked('influencer');
  const box = $('d-addons');
  if (!tier || !inf) { fill(box, h('p', { class: 'hint' }, 'בוחרים חבילה ומשפיענים, ואז מופיעות התוספות שאפשר להוסיף.')); return; }
  const was = new Set([...box.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value));
  const counts = Object.fromEntries([...box.querySelectorAll('input[type="number"]')].map((x) => [x.name, x.value]));
  const { paid, free } = addonsFor(tier, inf);
  fill(box,
    ...paid.map((a) => choice('checkbox', 'paid', a.id, a.name, `${formatILS(a.price)} לחודש · ${a.detail}`, was.has(a.id))),
    ...free.map((f) => (f.max
      ? h('div', { class: 'field deal-count' },
        h('label', { for: `d-free-${f.id}` }, `${f.name} (ללא עלות, עד ${f.max})`),
        h('input', { class: 'input deal-num', type: 'number', inputmode: 'numeric', min: '0', max: String(f.max), step: '1', id: `d-free-${f.id}`, name: f.id, value: counts[f.id] || '0', dir: 'ltr' }))
      : choice('checkbox', 'free', f.id, f.name, f.detail ? `ללא עלות · ${f.detail}` : 'ללא עלות', was.has(f.id)))));
}

function readForm() {
  const free = {};
  for (const f of Object.values(FREE_ADDONS)) {
    if (f.max) free[f.id] = Number($(`d-free-${f.id}`)?.value || 0);
    else free[f.id] = !!document.querySelector(`input[name="free"][value="${f.id}"]:checked`);
  }
  const custom = kind() === 'custom'
    ? { kind: 'custom', ...Object.fromEntries(CUSTOM_FIELDS.map((f) => [f, $(`d-${f}`).value])) }
    : {};
  return {
    ...custom,
    business_name: $('d-business').value,
    contact_name: $('d-contact').value,
    phone: $('d-phone').value,
    tier: picked('tier'),
    influencer: picked('influencer'),
    paid: [...document.querySelectorAll('input[name="paid"]:checked')].map((x) => x.value),
    free,
    discount: $('d-discount').value === '' ? 0 : Number($('d-discount').value),
    notes: $('d-notes').value,
  };
}

function clearErr(f) {
  if (!f) return;
  const err = $(`d-${f}-err`);
  if (err) { err.hidden = true; err.textContent = ''; }
  const input = $(`d-${f}`);
  if (input) input.removeAttribute('aria-invalid');
}
function showErrors(errors) {
  let first = null;
  for (const f of FIELDS) clearErr(f);
  for (const [k, msg] of Object.entries(errors)) {
    const f = FIELD_OF[k];
    const err = $(`d-${f}-err`);
    if (!err) continue;
    err.textContent = msg;
    err.hidden = false;
    const input = $(`d-${f}`) || document.querySelector(`input[name="${k}"]`);
    if (input?.id === `d-${f}`) input.setAttribute('aria-invalid', 'true');
    first ||= input;
  }
  first?.focus();
}

$('deal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('d-err').hidden = true;
  const v = validateDeal(readForm());
  if (!v.ok) { showErrors(v.errors); return; }
  showErrors({});
  const btn = $('d-submit');
  btn.disabled = true;
  btn.textContent = 'שולח…';
  try {
    const d = await addDeal(v.row);
    deals = [d, ...deals];
    $('deal-form').reset();
    renderChoices();
    showKind();
    renderList();
    toast(d.custom ? `נשלח לעירית: ${d.business_name}. חוזה מותאם, ואחריו אישור מנהל.` : `נשלח לעירית: ${d.business_name}. החוזה בדרך.`);
    $('deal-h1').setAttribute('tabindex', '-1');
    $('deal-h1').focus();
  } catch (err) {
    $('d-err').textContent = `העסקה לא נשלחה. ${errorText(err)}`;
    $('d-err').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = SUBMIT_TEXT();
  }
});
for (const id of ['d-business', 'd-contact', 'd-phone', 'd-discount', ...CUSTOM_FIELDS.map((f) => `d-${f}`)]) $(id).addEventListener('input', () => clearErr(id.slice(2)));

// ── His deals ───────────────────────────────
const STATUS_CLASS = { pending: 'is-pending', approval: 'is-approval', rejected: 'is-rejected', sent: 'is-sent', signed: 'is-signed', cancelled: 'is-cancelled' };
function renderList() {
  $('deal-mine').hidden = false;
  const list = [...deals].sort(byNewest);
  if (!list.length) { fill($('deal-list'), h('li', { class: 'empty k-emptyrow' }, kIcon('briefcase', { size: 18 }), h('span', {}, 'עוד לא שלחת עסקאות.'))); return; }
  fill($('deal-list'), ...list.map((d) => h('li', { class: 'deal-item' },
    h('div', { class: 'deal-item-head' },
      iconSquare(...(STATUS_ICON[d.status] || ['briefcase', 'navy']), { size: 'sm' }),
      h('strong', { class: 'deal-item-name', dir: 'auto' }, d.business_name),
      h('span', { class: `deal-status ${STATUS_CLASS[d.status] || ''}` }, statusText(d))),
    h('p', { class: 'deal-item-meta' }, `${dealSummary(d)} · נשלח ${formatStamp(d.created_at)}`),
    d.status === 'approval' ? h('p', { class: 'deal-item-meta' }, 'עירית הכינה את החוזה. מחכה לאישור של אדם, אופיר או ליאור.') : null,
    d.status === 'rejected' ? h('p', { class: 'deal-item-meta' }, 'המנהל לא אישר את החוזה כמו שהוא. עירית מתקנת ושולחת שוב לאישור.') : null,
    d.status === 'signed' && d.signed_at ? h('p', { class: 'deal-item-meta' }, `נחתם ${formatStamp(d.signed_at)} 🎉`) : null)));
}

async function load() {
  $('state').textContent = 'טוען…';
  try {
    const rows = await loadDeals();
    if (rows === null) {
      $('state').textContent = 'הטבלה של העסקאות עוד לא הוקמה. פנו למנהל המערכת.';
      return;
    }
    deals = rows;
    $('state').textContent = '';
    renderList();
  } catch (err) {
    $('state').textContent = `העסקאות לא נטענו. ${errorText(err)}`;
  }
}

mountSession(async (staff) => {
  const viewer = await viewerOf(staff.email);
  me = viewer.me;
  if (!isSales(me)) {
    // Not a sales login: this page is not theirs.
    $('no-access').hidden = false;
    return;
  }
  $('deal-form').hidden = false;
  document.title = `עסקה חדשה · ${PEOPLE[me].name} · astrateg`;
  renderChoices();
  showKind();
  // The notifications list ("<עסק> חתם 🎉"), and since 6.10.2026 the phone card too: a
  // task given on the spot rings its assignee, a sales agent included.
  mountPush({ who: me, card: $('push-card'), button: $('btn-inbox'), dialog: $('dlg-inbox') });
  // The tasks Irit or the owner gave this agent, with "בוצע" (app/staff-tasks-ui.js).
  mountStaffTasks($('staff-tasks-card'), viewer);
  await load();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden) load(); }, 60e3);
});
