// Payouts app: screens, forms and dialogs. Calculations live in engine.js,
// database access in data.js. User text is always rendered as text nodes.
import {
  supabase, sendPasswordReset, consumeRecoveryLink, looksLikeEmail, RESET_NEEDS_EMAIL, RESET_SENT, h,
} from './client.js';
import { reconcile, paidAddonAvailable, freeAddonAvailable } from '../pricing.js';
import { PACKAGES, PAID_ADDONS, TIERS, INFLUENCERS, FREE_ADDONS, TERM_MONTHS, packageId } from '../catalog.js';
import {
  ITEMS, SOURCE_LABEL, MONTH_ITEM_KINDS, CHECKS_UPFRONT, DEFER_MONTHS, computeMonth, computeDeal, commissionStatement, settingsOn,
  monthBounds, shiftMonth, packageName, monthItemLabel,
} from './engine.js';
import * as db from './data.js';

const $ = (id) => document.getElementById(id);
const state = { session: null, owner: false, month: null, route: 'month', versions: [], data: null, report: null, lastLocked: null };

// ---------- formatting ----------

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const monthLabel = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, mo - 1, 15));
};
const dateLabel = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, day));
};
const ilsFmt = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const ilsFmt2 = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formatILS(agorot) {
  return `${(agorot % 100 === 0 ? ilsFmt : ilsFmt2).format(agorot / 100)} ₪`;
}
const money = (agorot, cls = '') => h('span', { class: `num ${cls}`.trim(), dir: 'ltr' }, formatILS(agorot));
const signed = (agorot) => (agorot < 0
  ? h('span', { class: 'neg' }, 'הפסד ', money(-agorot))
  : money(agorot));
// A negative amount owed back by a person (commission clawback).
const offset = (agorot) => (agorot < 0
  ? h('span', { class: 'neg' }, 'קיזוז ', money(-agorot))
  : money(agorot));
const pct = (bp) => `${(bp / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 })}%`;
const shekelsText = (agorot) => (agorot === null || agorot === undefined ? '' : String(agorot / 100));
const pctText = (bp) => String(bp / 100);

// "15,300" / "15300.5" / "₪ 1,450" -> agorot. Empty -> null. Invalid -> NaN.
function parseMoney(v) {
  const s = String(v ?? '').replace(/[₪,\s]/g, '');
  if (s === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}
function parsePct(v) {
  const s = String(v ?? '').replace(/[%\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const bp = Math.round(Number(s) * 100);
  return bp <= 10000 ? bp : NaN;
}

let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600);
}
const setState = (msg) => { $('state').textContent = msg || ''; };

// ---------- dialog ----------

let onDialogClose = null;
function openSheet({ title, body, foot, wide = false, onClose }) {
  $('dlg-title').textContent = title;
  $('dlg-body').replaceChildren(...[].concat(body).filter(Boolean));
  $('dlg-foot').replaceChildren(...[].concat(foot || []).filter(Boolean));
  $('dlg').classList.toggle('wide', wide);
  onDialogClose = onClose || null;
  if (!$('dlg').open) $('dlg').showModal();
  $('dlg-body').scrollTop = 0;
}
function closeSheet() {
  if ($('dlg').open) $('dlg').close();
}
$('dlg').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeSheet();
});
$('dlg').addEventListener('close', () => {
  document.body.classList.remove('print-statement');
  const cb = onDialogClose;
  onDialogClose = null;
  if (cb) cb();
});

function field(label, input, { hint, id, error, context } = {}) {
  const fid = id || input.id || `f${Math.random().toString(36).slice(2, 8)}`;
  input.id = fid;
  const hintId = hint ? `${fid}-hint` : null;
  const errId = `${fid}-err`;
  if (hintId) input.setAttribute('aria-describedby', hintId);
  return h('div', { class: 'field' },
    h('label', { for: fid }, label, context ? h('span', { class: 'sr-only' }, ` · ${context}`) : null),
    input,
    hint ? h('div', { class: 'hint', id: hintId }, hint) : null,
    h('div', { class: 'field-err', id: errId, hidden: !error }, error || ''),
  );
}
function setFieldError(input, msg) {
  const err = document.getElementById(`${input.id}-err`);
  if (err) { err.textContent = msg || ''; err.hidden = !msg; }
  if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  const ids = [document.getElementById(`${input.id}-hint`) ? `${input.id}-hint` : '', msg ? `${input.id}-err` : ''].filter(Boolean);
  if (ids.length) input.setAttribute('aria-describedby', ids.join(' ')); else input.removeAttribute('aria-describedby');
}
const textInput = (value = '', attrs = {}) => h('input', { class: 'input', type: 'text', value, ...attrs });
const moneyInput = (agorot, attrs = {}) => textInput(shekelsText(agorot), { inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', ...attrs });
const pctInput = (bp, attrs = {}) => textInput(pctText(bp), { inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', ...attrs });
const btn = (label, attrs = {}) => h('button', { type: 'button', class: 'btn', ...attrs }, label);

function errorSummary(errors) {
  const box = h('div', { class: 'err-summary', tabindex: '-1', role: 'alert' },
    h('strong', {}, 'יש לתקן לפני שמירה:'),
    h('ul', {}, errors.map(([input, msg]) => h('li', {}, h('a', {
      href: `#${input.id}`, onclick: (e) => { e.preventDefault(); input.focus(); },
    }, msg)))));
  return box;
}

// ---------- routing ----------

function parseHash() {
  const [, route = 'month', month] = (location.hash || '').split('/');
  return {
    route: ['month', 'deals', 'pay', 'settings'].includes(route) ? route : 'month',
    month: /^\d{4}-\d{2}$/.test(month || '') ? month : null,
  };
}
function go(route, month = state.month) {
  location.hash = `#/${route}/${month}`;
}
window.addEventListener('hashchange', () => { route(); });

async function route() {
  const p = parseHash();
  const monthChanged = p.month && p.month !== state.month;
  state.route = p.route;
  if (p.month) state.month = p.month;
  if (!state.month) state.month = today().slice(0, 7);
  if (!state.owner) return;
  for (const a of document.querySelectorAll('#nav a')) {
    a.href = `#/${a.dataset.route}/${state.month}`;
    if (a.dataset.route === state.route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (monthChanged || !state.data || state.data.month !== state.month) await loadMonth();
  else render();
}

// ---------- boot / auth ----------

// The reset link returns here; the page itself sets the new password.
const appHome = () => new URL('./', window.location.href.split('#')[0]).href;

function showSetPassword() {
  const pass = h('input', { class: 'input', type: 'password', dir: 'ltr', autocomplete: 'new-password', minlength: '10', required: true });
  const again = h('input', { class: 'input', type: 'password', dir: 'ltr', autocomplete: 'new-password', required: true });
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'שמירת הסיסמה');
  const form = h('form', { class: 'login card', novalidate: true },
    h('h1', {}, 'בחירת סיסמה חדשה'),
    field('סיסמה חדשה', pass, { hint: 'לפחות 10 תווים.' }),
    field('אימות הסיסמה', again),
    err, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (pass.value.length < 10) { err.textContent = 'הסיסמה צריכה להיות באורך 10 תווים לפחות.'; err.hidden = false; pass.focus(); return; }
    if (pass.value !== again.value) { err.textContent = 'הסיסמאות לא זהות.'; err.hidden = false; again.focus(); return; }
    submit.disabled = true;
    const { error } = await supabase.auth.updateUser({ password: pass.value });
    submit.disabled = false;
    if (error) { err.textContent = db.explain(error); err.hidden = false; return; }
    toast('הסיסמה עודכנה.');
    state.session = await db.session();
    await enter();
  });
  $('view').replaceChildren(form);
  pass.focus();
}

async function boot() {
  const recovery = await consumeRecoveryLink();
  if (recovery === 'recovery') {
    state.session = await db.session();
    return showSetPassword();
  }
  state.session = await db.session();
  if (recovery === 'expired' && !state.session) {
    showLogin();
    setState('קישור האיפוס פג תוקף או כבר נוצל. בקשו קישור חדש ב״שכחתי סיסמה״.');
    return;
  }
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { state.session = null; state.owner = false; showLogin(); }
    else if (session) state.session = session;
  });
  if (!state.session) return showLogin();
  await enter();
}

async function enter() {
  try {
    state.owner = await db.isOwner(state.session.user.id);
  } catch (e) {
    setState(db.explain(e));
    return;
  }
  $('btn-account').hidden = false;
  if (!state.owner) return showNotOwner();
  $('nav').hidden = false;
  $('monthbar').hidden = false;
  document.body.classList.add('signed-in');
  try {
    [state.versions, state.lastLocked] = await Promise.all([db.loadSettings(), db.lastLockedMonth()]);
  } catch (e) {
    setState(db.explain(e));
    return;
  }
  const p = parseHash();
  state.month = p.month || today().slice(0, 7);
  if (!location.hash) history.replaceState(null, '', `#/month/${state.month}`);
  await route();
}

function showLogin() {
  document.body.classList.remove('signed-in');
  $('nav').hidden = true;
  $('monthbar').hidden = true;
  $('btn-account').hidden = true;
  const email = h('input', { class: 'input', type: 'email', dir: 'ltr', autocomplete: 'username', required: true });
  const pass = h('input', { class: 'input', type: 'password', dir: 'ltr', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const msg = h('div', { class: 'form-ok', role: 'status', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'כניסה');
  const form = h('form', { class: 'login card', novalidate: true },
    h('h1', {}, 'כניסה לאסטרטג פיימנט'),
    h('p', { class: 'muted' }, 'למנהלי החברה בלבד. אנשי מכירות מקבלים דוח עמלה נפרד.'),
    field('אימייל', email),
    field('סיסמה', pass),
    err, msg, submit,
    h('button', {
      type: 'button', class: 'btn-text',
      onclick: async () => {
        err.hidden = true; msg.hidden = true;
        const v = email.value.trim();
        if (!looksLikeEmail(v)) { err.textContent = RESET_NEEDS_EMAIL; err.hidden = false; email.focus(); return; }
        try { await sendPasswordReset(v, appHome()); msg.textContent = RESET_SENT; msg.hidden = false; } catch (e) { err.textContent = db.explain(e); err.hidden = false; }
      },
    }, 'שכחתי סיסמה'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!email.value.trim() || !pass.value) { err.textContent = 'יש למלא אימייל וסיסמה.'; err.hidden = false; return; }
    submit.disabled = true;
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    submit.disabled = false;
    if (error) { err.textContent = db.explain(error); err.hidden = false; return; }
    state.session = data.session;
    await enter();
  });
  $('view').replaceChildren(form);
  setState('');
}

function showNotOwner() {
  $('nav').hidden = true;
  $('monthbar').hidden = true;
  $('view').replaceChildren(h('section', { class: 'card narrow' },
    h('h1', {}, 'אין לך גישה לאסטרטג פיימנט'),
    h('p', {}, `המשתמש ${state.session.user.email} מחובר, אבל אינו מוגדר כמנהל במערכת הזו.`),
    h('p', { class: 'muted' }, 'מנהל קיים מוסיף גישה ב־Supabase (SQL Editor) לפי ההוראות ב־README.'),
    btn('התנתקות', { class: 'btn', onclick: () => supabase.auth.signOut() }),
  ));
}

$('btn-account').addEventListener('click', () => {
  const pass = h('input', { class: 'input', type: 'password', dir: 'ltr', autocomplete: 'new-password', minlength: '10' });
  const again = h('input', { class: 'input', type: 'password', dir: 'ltr', autocomplete: 'new-password' });
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const change = btn('שמירת סיסמה חדשה', {
    class: 'btn btn-primary',
    onclick: async () => {
      err.hidden = true;
      if (pass.value.length < 10) { err.textContent = 'הסיסמה צריכה להיות באורך 10 תווים לפחות.'; err.hidden = false; pass.focus(); return; }
      if (pass.value !== again.value) { err.textContent = 'הסיסמאות לא זהות.'; err.hidden = false; again.focus(); return; }
      change.disabled = true;
      const { error } = await supabase.auth.updateUser({ password: pass.value });
      change.disabled = false;
      if (error) { err.textContent = db.explain(error); err.hidden = false; return; }
      closeSheet();
      toast('הסיסמה עודכנה.');
    },
  });
  openSheet({
    title: 'חשבון',
    body: [
      h('p', {}, 'מחובר בתור ', h('bdi', { dir: 'ltr' }, state.session?.user?.email || '')),
      h('h3', {}, 'שינוי סיסמה'),
      field('סיסמה חדשה', pass, { hint: 'לפחות 10 תווים.' }),
      field('אימות הסיסמה', again),
      err,
    ],
    foot: [
      change,
      btn('התנתקות', { class: 'btn', onclick: async () => { closeSheet(); await supabase.auth.signOut(); } }),
      btn('סגירה', { class: 'btn btn-ghost', 'data-close': true }),
    ],
  });
});

// ---------- month data ----------

async function loadMonth() {
  setState('טוען…');
  try {
    const d = await db.loadMonth(state.month);
    state.data = { month: state.month, ...d };
    recompute();
    setState('');
  } catch (e) {
    state.data = null;
    setState(db.explain(e));
    $('view').replaceChildren();
    return;
  }
  render();
}

function recompute() {
  const d = state.data;
  state.report = d.lock
    ? d.lock.report
    : computeMonth({ month: d.month, deals: d.deals, incomes: d.incomes, expenses: d.expenses, versions: state.versions });
}

const isLocked = () => !!state.data?.lock;

function render() {
  $('m-title').textContent = monthLabel(state.month);
  $('m-lock').hidden = !isLocked();
  const views = { month: viewMonth, deals: viewDeals, pay: viewPay, settings: viewSettings };
  $('view').replaceChildren(views[state.route]());
  document.title = `${{ month: 'החודש', deals: 'עסקאות', pay: 'תשלומים', settings: 'הגדרות' }[state.route]} · ${monthLabel(state.month)} · אסטרטג פיימנט`;
}

$('m-prev').addEventListener('click', () => go(state.route, shiftMonth(state.month, -1)));
$('m-next').addEventListener('click', () => go(state.route, shiftMonth(state.month, 1)));
$('nav-add').addEventListener('click', () => openDeal());

async function refresh() {
  state.data = null;
  await loadMonth();
}

function lockedBanner() {
  if (!isLocked()) return null;
  return h('div', { class: 'banner' },
    h('strong', {}, 'החודש נעול. '),
    'המספרים מוצגים כפי שהיו בזמן הסגירה, ואי אפשר לשנות עסקאות, הכנסות או הוצאות בחודש הזה.');
}

function notices(r) {
  const items = [...(r.errors || []).map((t) => ['error', t]), ...(r.warnings || []).map((t) => ['warn', t])];
  if (!items.length) return null;
  return h('ul', { class: 'notices', 'aria-label': 'הערות לחודש' },
    items.map(([k, t]) => h('li', { class: k }, h('span', { class: 'sr-only' }, k === 'error' ? 'שגיאה: ' : 'אזהרה: '), t)));
}

// ---------- view: month ----------

function viewMonth() {
  const r = state.report;
  if (r.empty) {
    return h('div', { class: 'stack' }, notices(r), h('div', { class: 'card' },
      h('p', {}, 'עוד אין הגדרות שחלות על החודש הזה.'),
      btn('למסך ההגדרות', { class: 'btn btn-primary', onclick: () => go('settings') })));
  }
  const t = r.totals;
  const kpi = (label, value, sub) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-k' }, label), h('div', { class: 'kpi-v' }, value), sub ? h('div', { class: 'kpi-s' }, sub) : null);
  const row = (label, value, strong) => h('div', { class: `row${strong ? ' strong' : ''}` }, h('span', {}, label), value);
  return h('div', { class: 'stack' },
    lockedBanner(),
    notices(r),
    h('section', { class: 'kpis', 'aria-label': 'סיכום החודש' },
      kpi('הכנסות', money(t.revenue), `${r.counts.deals} עסקאות${t.incomeRevenue ? ` + הכנסה נוספת` : ''}`),
      kpi('הוצאות', money(t.variable + t.fixed)),
      kpi('רווח', signed(t.profit), t.marginBp === null ? '' : `${pct(t.marginBp)} מההכנסות`),
      t.incomeRevenue ? kpi('רווח בלי הכנסה נוספת', signed(t.profitExcludingIncome)) : null,
    ),
    h('section', { class: 'card', 'aria-labelledby': 'h-partners' },
      h('h2', { id: 'h-partners' }, 'חלוקה לשותפים'),
      r.partners.map((p) => row(`${p.name} · ${pct(p.shareBp)}`, signed(p.amount))),
      t.incomeRevenue ? h('p', { class: 'muted small' }, 'בלי ההכנסה הנוספת: ', r.partners.map((p, i) => [i ? ' · ' : '', `${p.name} `, money(p.amountExcludingIncome)])) : null,
    ),
    h('section', { class: 'card', 'aria-labelledby': 'h-break' },
      h('h2', { id: 'h-break' }, 'מאיפה זה מגיע'),
      row('הכנסות מעסקאות', money(t.dealsRevenue)),
      t.incomeRevenue ? row('הכנסה נוספת', money(t.incomeRevenue)) : null,
      t.deferredRevenue ? row(`יתרות צ׳קים מעסקאות של לפני ${DEFER_MONTHS} חודשים`, money(t.deferredRevenue)) : null,
      t.cancelledRevenue ? row('הכנסה שירדה בגלל ביטולים', money(t.cancelledRevenue)) : null,
      row('פיימנט', money(t.paymentReal)),
      row('עמלות', money(t.commissions - (t.clawbacks || 0))),
      t.clawbacks ? row('קיזוז עמלות מעסקאות שבוטלו', money(t.clawbacks)) : null,
      t.closerFees ? row('עמלות סגירה לעסקה', money(t.closerFees)) : null,
      row('הפקה (משפיענים, צלם, מאפרת)', money(t.production)),
      row('רכיבים, תוספות וצ׳ופרים', money(t.itemsReal)),
      row(t.employerCost ? 'משכורות, כולל עלות מעסיק' : 'משכורות', money(t.employees)),
      row('הוצאות קבועות', money(t.recurring)),
      t.oneOff ? row('הוצאות משתנות של החודש', money(t.oneOff)) : null,
      row('רווח', signed(t.profit), true),
    ),
    incomeSection(r),
    expenseSection(r),
    lockSection(),
  );
}

function incomeSection(r) {
  const list = state.data.incomes;
  return h('section', { class: 'card', 'aria-labelledby': 'h-inc' },
    h('div', { class: 'card-head' },
      h('h2', { id: 'h-inc' }, 'הכנסה נוספת'),
      isLocked() ? null : btn('הוספה', { class: 'btn btn-sm', onclick: () => openIncome() })),
    h('p', { class: 'muted small' }, 'כסף שלא שייך לעסקה חדשה, למשל שיקים של עסקה קיימת. חלים עליו פיימנט ועמלות.'),
    list.length ? h('ul', { class: 'list' }, list.map((e) => h('li', {},
      h('button', { type: 'button', class: 'list-btn', disabled: isLocked(), onclick: () => openIncome(e) },
        h('span', {}, h('bdi', {}, e.label), h('small', {}, `${dateLabel(e.date)} · ${INFLUENCERS[e.family].name}`)),
        money(e.amount))))) : h('p', { class: 'empty' }, 'אין הכנסה נוספת בחודש הזה.'),
  );
}

function expenseSection() {
  const list = state.report.oneOff || [];
  const byId = new Map(state.data.expenses.map((e) => [e.id, e]));
  return h('section', { class: 'card', 'aria-labelledby': 'h-exp' },
    h('div', { class: 'card-head' },
      h('h2', { id: 'h-exp' }, 'הוצאות משתנות של החודש'),
      isLocked() ? null : btn('הוספה', { class: 'btn btn-sm', onclick: () => openExpense() })),
    h('p', { class: 'muted small' }, 'דלק, פחת רכב, תיאום פגישות וכל הוצאה שחלה רק על החודש הזה. הוצאות שחוזרות כל חודש מוגדרות במסך ההגדרות.'),
    list.length ? h('ul', { class: 'list' }, list.map((e) => h('li', {},
      h('button', { type: 'button', class: 'list-btn', disabled: isLocked() || !byId.has(e.id), onclick: () => openExpense(byId.get(e.id)) },
        h('span', {}, h('bdi', {}, e.payee), h('small', {}, h('bdi', {}, monthItemLabel(e, currentSettings(state.month)?.data)))),
        money(e.amount))))) : h('p', { class: 'empty' }, 'אין הוצאות משתנות בחודש הזה.'),
  );
}

const currentSettings = (month) => settingsOn(state.versions, monthBounds(month).last);

// Everyone the business pays, for pickers.
function knownPeople(data) {
  if (!data) return [];
  const names = [
    ...(data.employees || []).map((e) => e.name),
    ...(data.commissionPeople || []).map((p) => p.name),
    ...(data.perDealPeople || []).map((p) => p.name),
    data.meetingPayee,
  ].filter(Boolean);
  return [...new Set(names)];
}

function lockSection() {
  if (isLocked()) {
    return h('section', { class: 'card' },
      h('h2', {}, 'החודש נסגר'),
      h('p', { class: 'muted' }, 'נסגר ב־', new Date(state.data.lock.locked_at).toLocaleString('he-IL'), '. פתיחה מחדש תחשב את החודש לפי הנתונים וההגדרות הנוכחיים.'),
      btn('פתיחת החודש', { class: 'btn', onclick: confirmUnlock }));
  }
  return h('section', { class: 'card' },
    h('h2', {}, 'סגירת חודש'),
    h('p', { class: 'muted' }, 'אחרי ששילמתם, סגרו את החודש. הדוח נשמר כפי שהוא, ושינוי אחוזים או עלויות לא ישנה אותו.'),
    btn('סגירת החודש', { class: 'btn', disabled: !!state.report.errors?.length, onclick: confirmLock }),
    state.report.errors?.length ? h('p', { class: 'small warn-text' }, 'אי אפשר לסגור חודש שיש בו שגיאות.') : null);
}

function confirmLock() {
  const t = state.report.totals;
  openSheet({
    title: `לסגור את ${monthLabel(state.month)}?`,
    body: [
      h('p', {}, 'אחרי הסגירה לא אפשר להוסיף, לשנות או למחוק עסקאות, הכנסות והוצאות בחודש הזה, ולא לקבוע הגדרות שמתחילות בו או לפניו.'),
      h('div', { class: 'row' }, h('span', {}, 'עסקאות'), h('span', { class: 'num' }, String(state.report.counts.deals))),
      h('div', { class: 'row' }, h('span', {}, 'רווח'), signed(t.profit)),
    ],
    foot: [
      btn('כן, לסגור את החודש', {
        class: 'btn btn-primary',
        onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          try {
            await db.lockMonth(state.month, state.report);
            state.lastLocked = await db.lastLockedMonth();
            closeSheet();
            toast('החודש נסגר.');
            await refresh();
          } catch (err) { toast(db.explain(err)); b.disabled = false; }
        },
      }),
      btn('ביטול', { class: 'btn btn-ghost', 'data-close': true }),
    ],
  });
}

function confirmUnlock() {
  openSheet({
    title: `לפתוח את ${monthLabel(state.month)}?`,
    body: [h('p', {}, 'הדוח השמור יימחק, והחודש יחושב מחדש לפי הנתונים וההגדרות הנוכחיים. אם כבר שילמתם לפי הדוח, ייתכן שהסכומים ישתנו.')],
    foot: [
      btn('כן, לפתוח', {
        class: 'btn btn-primary',
        onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          try {
            await db.unlockMonth(state.month);
            state.lastLocked = await db.lastLockedMonth();
            closeSheet();
            toast('החודש נפתח.');
            await refresh();
          } catch (err) { toast(db.explain(err)); b.disabled = false; }
        },
      }),
      btn('ביטול', { class: 'btn btn-ghost', 'data-close': true }),
    ],
  });
}

// ---------- view: deals ----------

function viewDeals() {
  const r = state.report;
  const lines = (r.lines || []).filter((l) => l.kind === 'deal');
  const clawbacks = (r.lines || []).filter((l) => l.kind === 'clawback');
  const deferred = (r.lines || []).filter((l) => l.kind === 'deferred');
  const dealById = new Map(state.data.deals.map((d) => [d.id, d]));
  const t = r.totals || {};
  return h('div', { class: 'stack' },
    lockedBanner(),
    notices(r),
    h('div', { class: 'card-head page-head' },
      h('h2', {}, `${lines.length} עסקאות`),
      isLocked() ? null : h('div', { class: 'head-btns' },
        btn('ביטול עסקה', { class: 'btn btn-sm', onclick: () => openCancel() }),
        btn('עסקה חדשה', { class: 'btn btn-primary btn-sm', onclick: () => openDeal() }))),
    lines.length ? h('ul', { class: 'deals' }, lines.map((l) => h('li', {},
      h('button', {
        type: 'button', class: 'deal', disabled: isLocked() || !dealById.has(l.id),
        onclick: () => openDeal(dealById.get(l.id)),
      },
      h('span', { class: 'deal-main' },
        h('span', { class: 'deal-client' }, h('bdi', {}, l.client),
          l.cancelledOn ? h('span', { class: 'tag-cancel' }, `בוטלה ${dateLabel(l.cancelledOn)}`) : null,
          l.payMethod === 'checks' ? h('span', { class: 'tag-cheques' }, `צ׳קים ×${l.installments}`) : null),
        h('span', { class: 'deal-pkg' }, h('bdi', { dir: 'auto' }, l.packageName)),
        h('span', { class: 'deal-meta' }, dateLabel(l.date), l.seller ? [' · סגר: ', h('bdi', {}, l.seller)] : null,
          l.items.length ? ` · ${l.items.length} רכיבים` : null)),
      h('span', { class: 'deal-nums' },
        h('span', {}, h('small', {}, 'שווי'), money(l.value)),
        h('span', {}, h('small', {}, 'בסיס עמלה'), money(l.base)),
        h('span', {}, h('small', {}, 'רווח מהעסקה'), signed(l.contribution))),
      )))) : h('div', { class: 'card empty-state' },
      h('p', {}, `עוד אין עסקאות ב${monthLabel(state.month)}.`),
      isLocked() ? null : btn('הוספת עסקה ראשונה', { class: 'btn btn-primary', onclick: () => openDeal() })),
    lines.length ? h('div', { class: 'card' },
      h('div', { class: 'row' }, h('span', {}, 'סך שווי העסקאות'), money(t.dealsRevenue)),
      h('div', { class: 'row' }, h('span', {}, 'סך עמלות'), money(lines.reduce((s, l) => s + l.commissionTotal + l.closerTotal, 0))),
      h('div', { class: 'row strong' }, h('span', {}, 'רווח מהעסקאות לפני הוצאות קבועות'), signed(lines.reduce((s, l) => s + l.contribution, 0)))) : null,
    deferred.length ? h('section', { class: 'card', 'aria-labelledby': 'h-def' },
      h('h2', { id: 'h-def' }, 'יתרות צ׳קים שנכנסות החודש'),
      h('p', { class: 'muted small' }, `עסקאות בצ׳קים מלפני ${DEFER_MONTHS} חודשים: יתרת ההכנסה והעמלות.`),
      h('ul', { class: 'list' }, deferred.map((l) => h('li', { class: 'list-row' },
        h('span', {}, h('bdi', {}, l.client), h('small', {}, `נסגרה ${dateLabel(l.dealDate)} · ${l.installments - CHECKS_UPFRONT} מתוך ${l.installments} צ׳קים · עמלות `, money(l.commissions.reduce((a, c) => a + c.amount, 0)))),
        money(l.value))))) : null,
    clawbacks.length ? h('section', { class: 'card', 'aria-labelledby': 'h-claw' },
      h('h2', { id: 'h-claw' }, 'עסקאות שבוטלו החודש'),
      h('p', { class: 'muted small' }, 'ההכנסה של החודשים שהלקוח לא ישלם יורדת, והעמלות (אחוזים ועמלת סגירה) מתקזזות באותו יחס.'),
      h('ul', { class: 'list' }, clawbacks.map((l) => h('li', {},
        h('button', { type: 'button', class: 'list-btn', disabled: isLocked() || !dealById.has(l.id), onclick: () => openCancel(dealById.get(l.id)) },
          h('span', {}, h('bdi', {}, l.client), h('small', {}, `נסגרה ${dateLabel(l.dealDate)} · בוטלה אחרי ${l.paidMonths} חודשים · הכנסה `, money(l.value))),
          offset(l.commissionTotal + (l.closerTotal || 0))))))) : null,
  );
}

// Whole months between the closing date and the cancellation date (0–12).
function monthsBetween(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const m = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, Math.min(TERM_MONTHS, m));
}

async function openCancel(preset) {
  if (isLocked()) { toast('החודש נעול. פתחו אותו כדי לרשום ביטול.'); return; }
  let deals;
  try {
    deals = preset ? [preset] : await db.loadRecentDeals(monthBounds(shiftMonth(state.month, -TERM_MONTHS)).first);
  } catch (e) { toast(db.explain(e)); return; }
  if (!deals.length) { toast('אין עסקאות מהשנה האחרונה.'); return; }
  const dealIn = h('select', { class: 'input' }, deals.map((d) => h('option', { value: d.id },
    `${d.client} · ${dateLabel(d.date)} ${d.date.slice(0, 4)}${d.cancelledOn ? ' · כבר בוטלה' : ''}`)));
  const dateIn = h('input', { class: 'input', type: 'date', value: defaultDealDate() });
  const monthsIn = h('select', { class: 'input' }, Array.from({ length: TERM_MONTHS + 1 }, (_, i) => h('option', { value: String(i) }, `${i} חודשים`)));
  const preview = h('div', { class: 'preview' });
  const errBox = h('div');
  const pick = () => deals.find((d) => d.id === dealIn.value);
  const fill = () => {
    const d = pick();
    dateIn.value = d.cancelledOn || defaultDealDate();
    dateIn.min = d.date;
    monthsIn.value = String(d.paidMonths ?? monthsBetween(d.date, dateIn.value));
    draw();
  };
  const draw = () => {
    const d = pick();
    const cancelled = { ...d, cancelledOn: dateIn.value || defaultDealDate(), paidMonths: Number(monthsIn.value) };
    const r = computeMonth({ month: cancelled.cancelledOn.slice(0, 7), deals: [cancelled], versions: state.versions });
    const l = (r.lines || []).find((x) => x.kind === 'clawback');
    if (!l) { preview.replaceChildren(h('p', { class: 'warn-text' }, (r.errors || [])[0] || 'לא ניתן לחשב את הביטול.')); return; }
    preview.replaceChildren(h('h3', {}, `הלקוח שילם ${monthsIn.value} מתוך 12 חודשים`),
      h('div', { class: 'row' }, h('span', {}, `הכנסה שיורדת (מתוך ${formatILS(l.originalValue)})`), money(l.value)),
      ...l.commissions.map((c) => h('div', { class: 'row' }, h('span', {}, `${c.name} · עמלה ${formatILS(c.original)}`), offset(c.amount))),
      ...(l.closerFee ? [h('div', { class: 'row' }, h('span', {}, `${l.closerFee.name} · עמלת סגירה ${formatILS(l.closerFee.original)}`), offset(l.closerFee.amount))] : []),
      d.payMethod === 'checks' && d.installments > CHECKS_UPFRONT
        ? h('p', { class: 'muted small' }, `עסקת צ׳קים: יתרת ${d.installments - CHECKS_UPFRONT} הצ׳קים לא תיכנס אם הביטול לפני ${monthLabel(shiftMonth(d.date.slice(0, 7), DEFER_MONTHS))}.`)
        : null,
      h('p', { class: 'muted small' }, 'הקיזוז נרשם בחודש של תאריך הביטול.'));
  };
  dealIn.addEventListener('change', fill);
  dateIn.addEventListener('change', () => { monthsIn.value = String(monthsBetween(pick().date, dateIn.value)); draw(); });
  monthsIn.addEventListener('change', draw);
  if (preset) dealIn.value = preset.id;
  fill();
  const save = btn('שמירת הביטול', {
    class: 'btn btn-primary',
    onclick: async () => {
      const d = pick();
      setFieldError(dateIn, '');
      if (!dateIn.value || dateIn.value < d.date) {
        setFieldError(dateIn, 'תאריך הביטול חייב להיות אחרי תאריך הסגירה.');
        errBox.replaceChildren(errorSummary([[dateIn, 'תאריך הביטול חייב להיות אחרי תאריך הסגירה.']]));
        errBox.firstChild.focus();
        return;
      }
      if (save.disabled) return;
      save.disabled = true;
      try {
        await db.saveCancellation(d.id, dateIn.value, Number(monthsIn.value));
        closeSheet(); toast('הביטול נשמר.');
        const m = dateIn.value.slice(0, 7);
        if (m !== state.month) go('deals', m); else await refresh();
      } catch (e) { save.disabled = false; errBox.replaceChildren(h('div', { class: 'err-summary', role: 'alert' }, db.explain(e))); }
    },
  });
  const undo = btn('העסקה לא בוטלה (הסרת הביטול)', {
    class: 'btn btn-danger',
    onclick: async (e) => {
      const d = pick();
      if (!d.cancelledOn) { toast('העסקה הזו לא מסומנת כמבוטלת.'); return; }
      const b = e.currentTarget;
      b.disabled = true;
      try { await db.saveCancellation(d.id, null, null); closeSheet(); toast('הביטול הוסר.'); await refresh(); } catch (err) { b.disabled = false; toast(db.explain(err)); }
    },
  });
  openSheet({
    title: 'ביטול עסקה',
    body: [errBox,
      field('העסקה', dealIn, { hint: 'עסקאות מ־12 החודשים האחרונים.' }),
      h('div', { class: 'two-col' },
        field('תאריך הביטול', dateIn),
        field('כמה חודשים הלקוח שילם', monthsIn, { hint: 'מחושב מהתאריכים; אפשר לשנות.' })),
      preview],
    foot: [save, btn('סגירה', { class: 'btn btn-ghost', 'data-close': true }), undo],
  });
}

// ---------- deal form ----------

function emptyDealSelection() {
  return { tier: 'social', influencer: 'simeon', paid: [], free: { graphics: 0, simeonStories: 0, simeonJoin: false, extraCh14: false }, discount: 0 };
}

function defaultDealDate() {
  const t = today();
  return t.startsWith(state.month) ? t : monthBounds(state.month).first;
}

async function openDeal(existing) {
  if (isLocked()) { toast('החודש נעול. פתחו אותו כדי להוסיף עסקאות.'); return; }
  const d = existing
    ? structuredClone(existing)
    : { date: defaultDealDate(), client: '', selection: emptyDealSelection(), perks: [], seller: '', note: '' };
  if (!existing) {
    db.lastSeller().then((s) => {
      if (s && !sellerIn.value && [...sellerIn.options].some((o) => o.value === s)) { sellerIn.value = s; update(); }
    }).catch(() => {});
  }

  // Deal type: a catalog package, or a personal offer (total amount + family).
  const customInit = d.selection.custom ? d.selection : null;
  if (customInit) d.selection = emptyDealSelection();
  let mode = customInit ? 'custom' : 'package';
  let cFamily = customInit?.influencer || 'natali';
  const customAmountIn = moneyInput(customInit?.amount ?? null);
  let payMethod = d.payMethod === 'checks' ? 'checks' : 'payment';
  const chequesIn = h('select', { class: 'input' }, Array.from({ length: TERM_MONTHS }, (_, i) => h('option', { value: String(i + 1), selected: (d.installments || 12) === i + 1 }, `${i + 1} צ׳קים`)));

  const dateIn = h('input', { class: 'input', type: 'date', value: d.date, required: true });
  const clientIn = textInput(d.client, { autocomplete: 'off', maxlength: '200', required: true });
  const discountIn = moneyInput(d.selection.discount || 0);
  // Who closed the deal: people on percentages and people paid per deal.
  const sellerSet = settingsOn(state.versions, d.date)?.data || {};
  const sellerNames = [...new Set([
    ...(sellerSet.commissionPeople || []).map((p) => p.name),
    ...(sellerSet.perDealPeople || []).map((p) => p.name),
    d.seller,
  ].filter(Boolean))];
  const sellerIn = h('select', { class: 'input' },
    h('option', { value: '' }, 'לא צוין'),
    sellerNames.map((n) => h('option', { value: n, selected: n === d.seller }, n)));
  const noteIn = h('textarea', { class: 'input', rows: '2', maxlength: '2000' }, d.note || '');

  const pkgBox = h('div');
  const addonsBox = h('div');
  const perksBox = h('div');
  const removedNote = h('p', { class: 'note-info', role: 'status' });
  const preview = h('div', { class: 'preview' });
  const announce = h('div', { class: 'sr-only', role: 'status' });
  const errBox = h('div');

  const radio = (name, value, label, sub, checked, onchange) => h('label', { class: 'choice' },
    h('input', { type: 'radio', name, value, checked, onchange, 'data-key': `${name}:${value}` }),
    h('span', { class: 'choice-body' }, h('span', { class: 'choice-label' }, label), sub ? h('span', { class: 'choice-sub' }, sub) : null));
  const check = (label, sub, checked, onchange, key) => h('label', { class: 'choice' },
    h('input', { type: 'checkbox', checked, onchange, 'data-key': key }),
    h('span', { class: 'choice-body' }, h('span', { class: 'choice-label' }, label), sub ? h('span', { class: 'choice-sub' }, sub) : null));
  const qtySelect = (value, max, onchange, label) => h('select', { class: 'input input-sm', 'aria-label': label, onchange },
    Array.from({ length: max + 1 }, (_, i) => h('option', { value: String(i), selected: i === value }, String(i))));

  // Redraws replace controls; put focus back on the same control (or a fallback).
  function keepFocus(fn, fallback) {
    const key = document.activeElement?.dataset?.key;
    fn();
    const body = $('dlg-body');
    const el = (fallback && body.querySelector(`[data-key="${fallback}"]`)) || (key && body.querySelector(`[data-key="${key}"]`));
    if (el) el.focus();
  }

  function applyReconcile() {
    const { selection, removed } = reconcile(d.selection);
    d.selection = selection;
    removedNote.textContent = removed.length ? `הוסרו כי אינם זמינים בחבילה הזו: ${removed.join(', ')}.` : '';
  }

  function drawPackage() {
    const s = d.selection;
    pkgBox.replaceChildren(
      h('fieldset', { class: 'group' }, h('legend', {}, 'חבילה'),
        h('div', { class: 'choices' }, TIERS.map((t) => radio('tier', t.id, t.name, `${formatILS(PACKAGES[packageId(t.id, s.influencer)].price)} לחודש`, s.tier === t.id,
          () => keepFocus(() => { s.tier = t.id; applyReconcile(); drawAll(); }))))),
      h('fieldset', { class: 'group' }, h('legend', {}, 'משפיענים'),
        h('div', { class: 'choices two' }, Object.values(INFLUENCERS).map((inf) => radio('influencer', inf.id, inf.name, null, s.influencer === inf.id,
          () => keepFocus(() => { s.influencer = inf.id; applyReconcile(); drawAll(); }))))),
    );
  }

  function drawAddons() {
    const s = d.selection;
    const paid = PAID_ADDONS.filter((a) => paidAddonAvailable(a, s));
    const free = [];
    if (freeAddonAvailable('graphics', s)) {
      free.push(h('div', { class: 'choice qty' }, h('span', { class: 'choice-body' }, h('span', { class: 'choice-label' }, FREE_ADDONS.graphics.name), h('span', { class: 'choice-sub' }, 'עד 24')),
        qtySelect(s.free.graphics, FREE_ADDONS.graphics.max, (e) => { s.free.graphics = Number(e.target.value); update(); }, FREE_ADDONS.graphics.name)));
    }
    if (freeAddonAvailable('simeonJoin', s)) {
      free.push(check(FREE_ADDONS.simeonJoin.name, null, s.free.simeonJoin, (e) => keepFocus(() => { s.free.simeonJoin = e.target.checked; applyReconcile(); drawAddons(); update(); }), 'free:simeonJoin'));
    }
    if (freeAddonAvailable('simeonStories', s)) {
      free.push(h('div', { class: 'choice qty' }, h('span', { class: 'choice-body' }, h('span', { class: 'choice-label' }, FREE_ADDONS.simeonStories.name), h('span', { class: 'choice-sub' }, 'עד 3')),
        qtySelect(s.free.simeonStories, FREE_ADDONS.simeonStories.max, (e) => { s.free.simeonStories = Number(e.target.value); update(); }, FREE_ADDONS.simeonStories.name)));
    }
    free.push(check(FREE_ADDONS.extraCh14.name, 'במקרים חריגים בלבד', s.free.extraCh14, (e) => { s.free.extraCh14 = e.target.checked; update(); }));
    addonsBox.replaceChildren(
      h('fieldset', { class: 'group' }, h('legend', {}, 'תוספות בתשלום'),
        paid.length ? h('div', { class: 'choices' }, paid.map((a) => check(a.name, `${formatILS(a.price)} לחודש`, s.paid.includes(a.id), (e) => {
          s.paid = e.target.checked ? [...s.paid, a.id] : s.paid.filter((x) => x !== a.id);
          update();
        }))) : h('p', { class: 'muted small' }, 'אין תוספות בתשלום לחבילה הזו.')),
      h('fieldset', { class: 'group' }, h('legend', {}, 'הטבות ללא תשלום'), h('div', { class: 'choices' }, free)),
    );
  }

  function drawPerks() {
    const rows = d.perks.map((p, i) => h('div', { class: 'perk-row' },
      h('select', { class: 'input', 'aria-label': `צ׳ופר ${i + 1}`, 'data-key': `perk:${i}`, onchange: (e) => { p.id = e.target.value; update(); } },
        Object.entries(ITEMS).map(([id, it]) => h('option', { value: id, selected: p.id === id }, it.name))),
      h('select', { class: 'input input-sm', 'aria-label': `כמות לצ׳ופר ${i + 1}`, onchange: (e) => { p.qty = Number(e.target.value); update(); } },
        Array.from({ length: 10 }, (_, k) => h('option', { value: String(k + 1), selected: p.qty === k + 1 }, String(k + 1)))),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `הסרת צ׳ופר ${i + 1}`, onclick: () => keepFocus(() => { d.perks.splice(i, 1); drawPerks(); update(); }, 'perk-add') },
        h('span', { 'aria-hidden': 'true' }, '×'))));
    perksBox.replaceChildren(h('fieldset', { class: 'group' }, h('legend', {}, 'צ׳ופרים נוספים'),
      h('p', { class: 'muted small' }, 'כל דבר שאיש המכירות נתן בלי תשלום ולא מופיע למעלה. העלות שלו יורדת מבסיס העמלה.'),
      rows,
      btn('הוספת צ׳ופר', { class: 'btn btn-sm', 'data-key': 'perk-add', onclick: () => keepFocus(() => { d.perks.push({ id: 'natali-story', qty: 1 }); drawPerks(); update(); }, `perk:${d.perks.length}`) })));
  }

  function payFields() {
    return payMethod === 'checks'
      ? { payMethod: 'checks', installments: Number(chequesIn.value) }
      : { payMethod: 'payment', installments: null };
  }

  function currentDeal() {
    if (mode === 'custom') {
      const amount = parseMoney(customAmountIn.value);
      return {
        ...d, date: dateIn.value, client: clientIn.value, seller: sellerIn.value, note: noteIn.value, perks: [], ...payFields(),
        selection: { custom: true, influencer: cFamily, amount: Number.isFinite(amount) && amount > 0 ? amount : 0 },
      };
    }
    const disc = parseMoney(discountIn.value);
    return {
      ...d,
      ...payFields(),
      date: dateIn.value,
      client: clientIn.value,
      seller: sellerIn.value,
      note: noteIn.value,
      selection: { ...d.selection, discount: Number.isFinite(disc) && disc !== null ? disc : 0 },
    };
  }

  function update(announceIt = false) {
    const cur = currentDeal();
    const v = settingsOn(state.versions, cur.date || defaultDealDate());
    if (!v) { preview.replaceChildren(h('p', { class: 'warn-text' }, 'אין הגדרות בתוקף לתאריך הזה.')); return; }
    let l;
    const warns = new Set();
    try {
      l = computeDeal(cur, v.data, (w) => warns.add(w));
    } catch {
      preview.replaceChildren(h('p', { class: 'warn-text' }, mode === 'custom' ? 'הזינו את סכום העסקה.' : 'הבחירה לא תקינה. בדקו את ההנחה ואת התוספות.'));
      return;
    }
    const row = (label, value, cls) => h('div', { class: `row ${cls || ''}` }, h('span', {}, label), value);
    const prod = l.production.influencer + l.production.photographer + l.production.makeup;
    const closer = l.closerFee?.amount || 0;
    const contribution = l.value - l.paymentReal - l.commissions.reduce((s, c) => s + c.amount, 0) - prod - l.itemsReal - closer;
    preview.replaceChildren(...[
      h('h3', {}, 'חישוב העסקה'),
      row(`שווי ל־${TERM_MONTHS} חודשים`, money(l.value)),
      row(l.payMethod === 'checks' ? 'פיימנט (כפי שמוצג למקבלי העמלה)' : 'פיימנט', money(-l.paymentCommission)),
      l.payMethod === 'checks' ? row('עלות אמיתית: עמלת צ׳קים', h('span', { class: 'muted small' }, money(-l.paymentReal), l.deferred ? ' עכשיו' : ''), 'sub') : null,
      l.items.map((it) => row(`${it.name}${it.qty > 1 ? ` ×${it.qty}` : ''} · ${SOURCE_LABEL[it.source]}`, it.commission === 0 && [...warns].some((w) => w.endsWith(it.id)) ? h('span', { class: 'warn-text' }, 'עלות לא הוגדרה') : money(-it.commission), 'sub')),
      row('בסיס עמלה', money(l.base), 'strong'),
      l.deferred ? row(`עכשיו ${CHECKS_UPFRONT} מתוך ${l.installments} צ׳קים; היתרה ב${monthLabel(l.deferred.month)}`, h('span', { class: 'muted small' }, `הכנסה עכשיו `, money(l.value)), 'sub') : null,
      l.commissions.map((c) => row(`${c.name} · ${pct(c.rateBp)}${l.deferred ? ' · עכשיו' : ''}`, money(c.amount), 'sub')),
      l.closerFee ? row(`${l.closerFee.name} · עמלת סגירה`, money(l.closerFee.amount), 'sub') : null,
      row('הפקה', l.pooled ? h('span', { class: 'muted small' }, 'המשפיענית מתחלקת בסוף החודש', ' + ', money(prod)) : money(prod)),
      row(l.pooled ? 'רווח מהעסקה, לפני המשפיענית' : 'רווח מהעסקה', signed(contribution), 'strong'),
    ].flat().filter(Boolean));
    if (announceIt) announce.textContent = `בסיס עמלה ${formatILS(l.base)}. רווח מהעסקה ${formatILS(contribution)}.`;
  }

  function drawAll() {
    drawPackage();
    drawAddons();
    update(true);
  }

  sellerIn.addEventListener('change', () => update(true));
  for (const el of [dateIn, discountIn]) {
    el.addEventListener('input', () => update());
    el.addEventListener('change', () => update(true));
  }

  drawAll();
  drawPerks();

  const discountField = field('הנחה חודשית (₪)', discountIn, { hint: '0 עד 200 ₪ לחודש, לפני מע״מ.' });
  const chequesField = field('מספר הצ׳קים', chequesIn, { hint: `עד ${CHECKS_UPFRONT} צ׳קים: כל העמלה עכשיו. יותר: החלק של ${CHECKS_UPFRONT} הצ׳קים עכשיו, והיתרה אחרי ${DEFER_MONTHS} חודשים.` });
  chequesIn.addEventListener('change', () => update(true));
  const payBox = h('fieldset', { class: 'group' }, h('legend', {}, 'אמצעי תשלום'),
    h('div', { class: 'choices two' },
      radio('paymethod', 'payment', 'פיימנט', null, payMethod === 'payment', () => { payMethod = 'payment'; chequesField.hidden = true; update(true); }),
      radio('paymethod', 'checks', 'צ׳קים', null, payMethod === 'checks', () => { payMethod = 'checks'; chequesField.hidden = false; update(true); })),
    chequesField);
  chequesField.hidden = payMethod !== 'checks';
  const customBox = h('div', { class: 'stack' },
    field('סכום העסקה הכולל (₪, לפני מע״מ)', customAmountIn, { hint: 'הסכום לכל תקופת העסקה, כמו באקסל. לא צריך לפרט מה כלול.' }),
    h('fieldset', { class: 'group' }, h('legend', {}, 'משפיענים'),
      h('div', { class: 'choices two' }, Object.values(INFLUENCERS).map((inf) => radio('cfamily', inf.id, inf.name, null, cFamily === inf.id,
        () => { cFamily = inf.id; update(true); })))));
  customAmountIn.addEventListener('input', () => update());
  customAmountIn.addEventListener('change', () => update(true));
  const applyMode = () => {
    const custom = mode === 'custom';
    for (const el of [pkgBox, removedNote, addonsBox, perksBox, discountField]) el.hidden = custom;
    customBox.hidden = !custom;
    update(true);
  };
  const typeBox = h('fieldset', { class: 'group' }, h('legend', {}, 'סוג העסקה'),
    h('div', { class: 'choices two' },
      radio('dealtype', 'package', 'חבילה', 'מהחבילות והתוספות', mode === 'package', () => { mode = 'package'; applyMode(); }),
      radio('dealtype', 'custom', 'הצעה אישית', 'סכום כולל ומשפיענים בלבד', mode === 'custom', () => { mode = 'custom'; applyMode(); })));

  const save = h('button', { type: 'button', class: 'btn btn-primary' }, existing ? 'שמירת שינויים' : 'שמירת העסקה');
  save.addEventListener('click', async () => {
    const errors = [];
    const cur = currentDeal();
    for (const el of [dateIn, clientIn, discountIn]) setFieldError(el, '');
    if (!clientIn.value.trim()) errors.push([clientIn, 'חסר שם לקוח.']);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIn.value)) errors.push([dateIn, 'חסר תאריך סגירה.']);
    const disc = parseMoney(discountIn.value);
    if (mode === 'package' && disc !== null && (!Number.isFinite(disc) || disc < 0 || disc > 20000 || disc % 100 !== 0)) errors.push([discountIn, 'הנחה חודשית בשקלים שלמים, בין 0 ל־200.']);
    const customAmount = parseMoney(customAmountIn.value);
    setFieldError(customAmountIn, '');
    if (mode === 'custom' && !(Number.isFinite(customAmount) && customAmount > 0)) errors.push([customAmountIn, 'חסר סכום העסקה.']);
    for (const [el, msg] of errors) setFieldError(el, msg);
    if (errors.length) {
      errBox.replaceChildren(errorSummary(errors));
      errBox.firstChild.focus();
      return;
    }
    errBox.replaceChildren();
    save.disabled = true;
    try {
      await db.saveDeal(cur);
      closeSheet();
      toast(existing ? 'העסקה עודכנה.' : 'העסקה נשמרה.');
      const m = cur.date.slice(0, 7);
      if (m !== state.month) go('deals', m); else await refresh();
    } catch (e) {
      save.disabled = false;
      errBox.replaceChildren(h('div', { class: 'err-summary', role: 'alert' }, db.explain(e)));
    }
  });

  const del = existing ? btn('מחיקה', {
    class: 'btn btn-danger',
    onclick: async (e) => {
      if (!confirm(`למחוק את העסקה של ״${existing.client}״?`)) return;
      const b = e.currentTarget;
      b.disabled = true;
      try { await db.deleteRow('payout_deals', existing.id); closeSheet(); toast('העסקה נמחקה.'); await refresh(); } catch (err) { toast(db.explain(err)); b.disabled = false; }
    },
  }) : null;

  openSheet({
    title: existing ? 'עריכת עסקה' : 'עסקה חדשה',
    wide: true,
    body: [
      errBox,
      h('div', { class: 'form-grid' },
        h('div', { class: 'form-main' },
          h('div', { class: 'two-col' },
            field('שם הלקוח', clientIn),
            field('תאריך סגירה', dateIn, { hint: 'העסקה נכנסת לחודש של התאריך הזה.' })),
          typeBox, customBox, pkgBox, removedNote, addonsBox, perksBox, payBox,
          h('div', { class: 'two-col' },
            discountField,
            field('מי סגר', sellerIn, { hint: 'מקבלי האחוזים מקבלים מכל עסקה. מי שמוגדר עם תשלום לכל עסקה שסגר, מקבל אותו כשהוא מסומן כאן.' })),
          field('הערה', noteIn)),
        h('aside', { class: 'form-side' }, preview, announce)),
    ],
    foot: [save, btn('ביטול', { class: 'btn btn-ghost', 'data-close': true }), del],
  });
  applyMode();
  if (!existing) clientIn.focus();
}

// ---------- income / expense forms ----------

function openIncome(existing) {
  if (isLocked()) return;
  const e = existing || { date: defaultDealDate(), label: '', family: 'natali', amount: null, note: '' };
  const dateIn = h('input', { class: 'input', type: 'date', value: e.date });
  const labelIn = textInput(e.label, { maxlength: '200' });
  const amountIn = moneyInput(e.amount);
  const famIn = h('select', { class: 'input' }, Object.values(INFLUENCERS).map((i) => h('option', { value: i.id, selected: e.family === i.id }, i.name)));
  const errBox = h('div');
  const save = btn('שמירה', {
    class: 'btn btn-primary',
    onclick: async () => {
      const errors = [];
      for (const el of [labelIn, amountIn, dateIn]) setFieldError(el, '');
      const amount = parseMoney(amountIn.value);
      if (!labelIn.value.trim()) errors.push([labelIn, 'חסר תיאור.']);
      if (!Number.isFinite(amount) || amount === null || amount <= 0) errors.push([amountIn, 'סכום חיובי בשקלים.']);
      if (!dateIn.value) errors.push([dateIn, 'חסר תאריך.']);
      errors.forEach(([el, m]) => setFieldError(el, m));
      if (errors.length) { errBox.replaceChildren(errorSummary(errors)); errBox.firstChild.focus(); return; }
      if (save.disabled) return;
      save.disabled = true;
      try {
        await db.saveIncome({ id: existing?.id, date: dateIn.value, label: labelIn.value, family: famIn.value, amount });
        closeSheet(); toast('נשמר.'); await refresh();
      } catch (err) { save.disabled = false; errBox.replaceChildren(h('div', { class: 'err-summary', role: 'alert' }, db.explain(err))); }
    },
  });
  openSheet({
    title: existing ? 'עריכת הכנסה נוספת' : 'הכנסה נוספת',
    body: [errBox, field('תיאור', labelIn, { hint: 'למשל: שיקים של לקוח קיים' }), field('סכום (₪, לפני מע״מ)', amountIn),
      field('אחוזי העמלה לפי', famIn), field('תאריך', dateIn)],
    foot: [save, btn('ביטול', { class: 'btn btn-ghost', 'data-close': true }),
      existing ? btn('מחיקה', { class: 'btn btn-danger', onclick: async () => { if (!confirm('למחוק?')) return; try { await db.deleteRow('payout_incomes', existing.id); closeSheet(); await refresh(); } catch (err) { toast(db.explain(err)); } } }) : null],
  });
}

function openExpense(existing) {
  if (isLocked()) return;
  const set = currentSettings(state.month)?.data || {};
  const e = existing || { kind: 'fuel', label: '', payee: '', amount: null, qty: null };
  const kindIn = h('select', { class: 'input' }, Object.entries(MONTH_ITEM_KINDS).map(([k, label]) => h('option', { value: k, selected: e.kind === k }, label)));
  const payeeIn = textInput(e.payee || (e.kind === 'meetings' ? set.meetingPayee || '' : ''), { maxlength: '200', list: 'people', autocomplete: 'off' });
  const people = h('datalist', { id: 'people' }, knownPeople(set).map((n) => h('option', { value: n })));
  const labelIn = textInput(e.kind === 'other' ? e.label : (e.label !== MONTH_ITEM_KINDS[e.kind] ? e.label : ''), { maxlength: '200' });
  const amountIn = moneyInput(e.kind === 'meetings' ? null : e.amount);
  const qtyIn = textInput(e.qty ?? '', { inputmode: 'numeric', dir: 'ltr', autocomplete: 'off' });
  const amountField = field('סכום (₪)', amountIn);
  const qtyField = field('מספר פגישות שתואמו', qtyIn, { hint: `${formatILS(set.meetingRate || 0)} לכל פגישה, לפי ההגדרות.` });
  const labelField = field('תיאור', labelIn);
  const sync = () => {
    const k = kindIn.value;
    amountField.hidden = k === 'meetings';
    qtyField.hidden = k !== 'meetings';
    labelField.querySelector('label').firstChild.textContent = k === 'other' ? 'תיאור' : 'הערה (לא חובה)';
    if (k === 'meetings' && !payeeIn.value) payeeIn.value = set.meetingPayee || '';
  };
  kindIn.addEventListener('change', sync);
  sync();
  const errBox = h('div');
  const save = btn('שמירה', {
    class: 'btn btn-primary',
    onclick: async () => {
      const errors = [];
      const k = kindIn.value;
      for (const el of [labelIn, amountIn, qtyIn, payeeIn]) setFieldError(el, '');
      const amount = parseMoney(amountIn.value);
      const qty = /^\d+$/.test(qtyIn.value.trim()) ? Number(qtyIn.value.trim()) : NaN;
      if (!payeeIn.value.trim()) errors.push([payeeIn, 'למי שייכת ההוצאה?']);
      if (k === 'other' && !labelIn.value.trim()) errors.push([labelIn, 'חסר תיאור.']);
      if (k === 'meetings' && !(qty >= 0 && qty <= 10000)) errors.push([qtyIn, 'מספר פגישות שלם.']);
      if (k !== 'meetings' && (!Number.isFinite(amount) || amount === null)) errors.push([amountIn, 'סכום בשקלים.']);
      errors.forEach(([el, m]) => setFieldError(el, m));
      if (errors.length) { errBox.replaceChildren(errorSummary(errors)); errBox.firstChild.focus(); return; }
      if (save.disabled) return;
      save.disabled = true;
      try {
        await db.saveExpense({
          id: existing?.id, month: state.month, kind: k, payee: payeeIn.value,
          label: labelIn.value.trim() || MONTH_ITEM_KINDS[k],
          amount: k === 'meetings' ? qty * (set.meetingRate || 0) : amount,
          qty: k === 'meetings' ? qty : null,
        });
        closeSheet(); toast('נשמר.'); await refresh();
      } catch (err) { save.disabled = false; errBox.replaceChildren(h('div', { class: 'err-summary', role: 'alert' }, db.explain(err))); }
    },
  });
  openSheet({
    title: existing ? 'עריכת הוצאה' : `הוצאה משתנה · ${monthLabel(state.month)}`,
    body: [errBox, field('סוג', kindIn), field('למי', payeeIn, { hint: 'עובד, מקבל עמלה או ספק.' }), people, amountField, qtyField, labelField],
    foot: [save, btn('ביטול', { class: 'btn btn-ghost', 'data-close': true }),
      existing ? btn('מחיקה', { class: 'btn btn-danger', onclick: async () => { if (!confirm('למחוק?')) return; try { await db.deleteRow('payout_expenses', existing.id); closeSheet(); await refresh(); } catch (err) { toast(db.explain(err)); } } }) : null],
  });
}

// ---------- view: payouts ----------

const KIND_LABEL = {
  commission: 'עמלות', influencer: 'משפיענים', supplier: 'הפקה וספקים', employee: 'משכורות', expense: 'הוצאות',
  payment: 'פיימנט ועמלת צ׳קים (מנוכים אוטומטית)', partner: 'שותפים',
};

function viewPay() {
  const r = state.report;
  if (r.empty) return h('div', { class: 'stack' }, notices(r));
  const groups = {};
  for (const p of r.payees) (groups[p.kind] ||= []).push(p);
  const toPay = r.payees.filter((p) => p.kind !== 'partner' && p.kind !== 'payment').reduce((s, p) => s + p.total, 0);
  return h('div', { class: 'stack pay' },
    lockedBanner(),
    notices(r),
    Object.entries(KIND_LABEL).filter(([k]) => groups[k]).map(([k, label]) => h('section', { class: 'pay-group', 'aria-labelledby': `h-${k}` },
      h('h2', { id: `h-${k}` }, label, h('span', { class: 'group-total' }, money(groups[k].reduce((s, p) => s + p.total, 0)))),
      groups[k].map((p) => h('details', { class: 'payee' },
        h('summary', {}, h('span', { class: 'payee-name' }, h('bdi', {}, p.name)), p.total < 0 ? (k === 'partner' ? signed(p.total) : offset(p.total)) : money(p.total, 'payee-amt')),
        h('ul', { class: 'payee-lines' }, p.lines.map((ln) => h('li', {}, h('bdi', {}, ln.label), money(ln.amount)))),
        k === 'commission'
          ? btn('דוח עמלה להצגה', { class: 'btn btn-sm', onclick: () => openStatement(p.name) })
          : null,
      )),
    )),
    h('div', { class: 'paybar', role: 'group', 'aria-label': 'סיכום תשלומים' },
      h('span', {}, 'סה״כ לתשלום החודש, בלי פיימנט, צ׳קים ושותפים'), money(toPay)),
  );
}

function statementText(st) {
  const lines = [`דוח עמלות · ${monthLabel(st.month)} · ${st.name}`, ''];
  for (const r of st.rows) {
    if (r.kind === 'deferred') {
      lines.push(`יתרת צ׳קים: ${r.client} · ${r.installments - CHECKS_UPFRONT} מתוך ${r.installments}: ${formatILS(r.amount)}`, '');
      continue;
    }
    if (r.kind === 'clawback') {
      lines.push(`קיזוז: ${r.client} · ${r.packageName} בוטלה אחרי ${r.paidMonths} חודשים`);
      lines.push(`עמלה מקורית ${formatILS(r.original)}; קיזוז ${formatILS(r.amount)}`, '');
    } else if (r.kind === 'closer' && r.clawback) {
      lines.push(`קיזוז עמלת סגירה: ${r.client} בוטלה אחרי ${r.paidMonths} חודשים: ${formatILS(r.amount)}`, '');
    } else if (r.kind === 'closer') {
      lines.push(`עמלת סגירה · ${r.client}: ${formatILS(r.amount)}`, '');
    } else {
      lines.push(`${r.client} · ${r.packageName}`);
      lines.push(`שווי ${formatILS(r.value)} − פיימנט ${formatILS(r.payment)}${r.deductions.map((x) => ` − ${x.name} (${SOURCE_LABEL[x.source]}) ${formatILS(x.amount)}`).join('')}`);
      if (r.full !== undefined && r.full !== r.amount) {
        lines.push(`בסיס ${formatILS(r.base)} × ${pct(r.rateBp)} = ${formatILS(r.full)}; עכשיו ${CHECKS_UPFRONT} מתוך ${r.installments} צ׳קים: ${formatILS(r.amount)}`, '');
      } else {
        lines.push(`בסיס ${formatILS(r.base)} × ${pct(r.rateBp)} = ${formatILS(r.amount)}`, '');
      }
    }
  }
  if (st.extras.length) {
    lines.push(`סה״כ עמלות: ${formatILS(st.commissionTotal)}`, '', 'תשלומים נוספים:');
    for (const e of st.extras) lines.push(`${e.label}: ${formatILS(e.amount)}`);
    lines.push('');
  }
  lines.push(`סה״כ לחודש: ${formatILS(st.total)}`);
  return lines.join('\n');
}

function statementRow(r) {
  const head = (sub) => h('div', { class: 'st-client' }, h('bdi', {}, r.client), h('small', {}, sub));
  if (r.kind === 'clawback') {
    return h('div', { class: 'st-row' },
      head([`בוטלה ב־${dateLabel(r.date)} אחרי ${r.paidMonths} חודשים · `, h('bdi', { dir: 'auto' }, r.packageName)]),
      h('div', { class: 'row' }, h('span', {}, 'עמלה מקורית'), money(r.original)),
      h('div', { class: 'row strong' }, h('span', {}, `קיזוז · ${12 - r.paidMonths} מתוך 12 חודשים`), offset(r.amount)));
  }
  if (r.kind === 'deferred') {
    return h('div', { class: 'st-row' },
      head([`עסקה מ־${dateLabel(r.dealDate)} · `, h('bdi', { dir: 'auto' }, r.packageName)]),
      h('div', { class: 'row' }, h('span', {}, 'עמלה מלאה'), money(r.full)),
      h('div', { class: 'row strong' }, h('span', {}, `יתרה: ${r.installments - CHECKS_UPFRONT} מתוך ${r.installments} צ׳קים`), money(r.amount)));
  }
  if (r.kind === 'closer' && r.clawback) {
    return h('div', { class: 'st-row' },
      head([`בוטלה ב־${dateLabel(r.date)} אחרי ${r.paidMonths} חודשים · `, h('bdi', { dir: 'auto' }, r.packageName || '')]),
      h('div', { class: 'row' }, h('span', {}, 'עמלת סגירה מקורית'), money(r.original)),
      h('div', { class: 'row strong' }, h('span', {}, `קיזוז · הלקוח שילם ${r.paidMonths} מתוך 12 חודשים`), offset(r.amount)));
  }
  if (r.kind === 'closer') {
    return h('div', { class: 'st-row' },
      head([`${dateLabel(r.date)} · `, h('bdi', { dir: 'auto' }, r.packageName || '')]),
      h('div', { class: 'row strong' }, h('span', {}, 'עמלת סגירה'), money(r.amount)));
  }
  return h('div', { class: 'st-row' },
    head([`${dateLabel(r.date)} · `, h('bdi', { dir: 'auto' }, r.packageName)]),
    h('div', { class: 'row' }, h('span', {}, 'שווי העסקה'), money(r.value)),
    h('div', { class: 'row sub' }, h('span', {}, 'פיימנט'), money(-r.payment)),
    r.deductions.map((x) => h('div', { class: 'row sub' }, h('span', {}, `${x.name}${x.qty > 1 ? ` ×${x.qty}` : ''} `, h('small', { class: 'muted' }, `(${SOURCE_LABEL[x.source]})`)), money(-x.amount))),
    h('div', { class: 'row' }, h('span', {}, 'בסיס עמלה'), money(r.base)),
    r.full !== undefined && r.full !== r.amount
      ? [h('div', { class: 'row' }, h('span', {}, `עמלה · ${pct(r.rateBp)}`), money(r.full)),
        h('div', { class: 'row strong' }, h('span', {}, `עכשיו: ${CHECKS_UPFRONT} מתוך ${r.installments} צ׳קים`), money(r.amount))]
      : h('div', { class: 'row strong' }, h('span', {}, `עמלה · ${pct(r.rateBp)}`), money(r.amount)));
}

function openStatement(who) {
  const st = commissionStatement(state.report, who);
  const doc = h('div', { class: 'statement' },
    h('div', { class: 'st-head' },
      h('img', { src: '../app/assets/logo.png', alt: 'astrateg', class: 'st-logo' }),
      h('div', {}, h('div', { class: 'st-title' }, 'דוח עמלות'), h('div', {}, monthLabel(st.month)), h('div', { class: 'st-name' }, h('bdi', {}, st.name)))),
    st.rows.length ? st.rows.map(statementRow) : h('p', {}, 'אין עסקאות בחודש הזה.'),
    st.extras.length ? [
      h('div', { class: 'row strong' }, h('span', {}, 'סה״כ עמלות'), offset(st.commissionTotal)),
      h('h3', { class: 'st-sub' }, 'תשלומים נוספים החודש'),
      st.extras.map((e) => h('div', { class: 'row' }, h('span', {}, h('bdi', {}, e.label)), money(e.amount))),
    ] : null,
    h('div', { class: 'row total' }, h('span', {}, 'סה״כ לחודש'), offset(st.total)),
  );
  openSheet({
    title: `דוח עמלה · ${st.name}`,
    body: [h('p', { class: 'muted small no-print' }, 'זה מה שמקבל העמלה רואה: הניכויים לחישוב העמלה בלבד, בלי עלויות אמיתיות, משכורות של אחרים, רווח או עמלות של אחרים.'), doc],
    foot: [
      btn('הדפסה או שמירה כ־PDF', { class: 'btn btn-primary', onclick: () => {
        document.body.classList.add('print-statement');
        window.addEventListener('afterprint', () => document.body.classList.remove('print-statement'), { once: true });
        window.print();
      } }),
      btn('העתקה כטקסט', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(statementText(st)); toast('הדוח הועתק.'); } catch { toast('ההעתקה לא הצליחה.'); } } }),
      h('a', { class: 'btn', href: `https://wa.me/?text=${encodeURIComponent(statementText(st))}`, target: '_blank', rel: 'noopener' }, 'שליחה בוואטסאפ'),
    ],
  });
}

// ---------- view: settings ----------

function viewSettings() {
  const versions = state.versions;
  const current = settingsOn(versions, today()) || versions[versions.length - 1];
  if (!current) return h('div', { class: 'card' }, h('p', {}, 'עוד אין הגדרות. פנו למפתח כדי לטעון הגדרות התחלתיות.'));
  const s = structuredClone(current.data);
  const minDate = state.lastLocked ? monthBounds(shiftMonth(state.lastLocked, 1)).first : null;
  const defaultFrom = [today(), minDate].filter(Boolean).sort().pop();
  const fromIn = h('input', { class: 'input', type: 'date', value: defaultFrom, min: minDate || undefined });
  const noteIn = textInput('', { maxlength: '200' });
  const errBox = h('div');
  const inputs = []; // [input, parse, assign, label]

  const reg = (input, parse, assign, label) => { inputs.push([input, parse, assign, label]); return input; };
  const moneyField = (label, get, set, { nullable = false, context } = {}) => {
    const input = moneyInput(get());
    reg(input, (v) => { const a = parseMoney(v); if (a === null) return nullable ? null : NaN; return a; }, set, context ? `${context}: ${label}` : label);
    return field(label, input, { hint: nullable ? 'ריק = לא מוגדר' : null, context });
  };
  const pctField = (label, get, set, { context } = {}) => {
    const input = pctInput(get());
    reg(input, parsePct, set, context ? `${context}: ${label}` : label);
    return field(label, input, { context });
  };
  const intField = (label, get, set, { context, hint } = {}) => {
    const input = textInput(String(get()), { inputmode: 'numeric', dir: 'ltr', autocomplete: 'off' });
    reg(input, (v) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN), set, context ? `${context}: ${label}` : label);
    return field(label, input, { context, hint });
  };
  const textField = (label, get, set, { context } = {}) => {
    const input = textInput(get(), { maxlength: '100' });
    reg(input, (v) => (v.trim() ? v.trim() : NaN), set, context ? `${context}: ${label}` : label);
    return field(label, input, { context });
  };
  // Keeps what was typed when a row is added or removed.
  const syncInputs = () => {
    for (const [input, parse, assign] of inputs) {
      const v = parse(input.value);
      if (!(typeof v === 'number' && Number.isNaN(v))) assign(v);
    }
  };

  const section = (title, hint, ...children) => h('section', { class: 'card' }, h('h2', {}, title), hint ? h('p', { class: 'muted small' }, hint) : null, ...children);
  const listSection = (title, hint, arr, make, blank) => {
    const box = h('div', { class: 'rows' });
    const draw = () => {
      box.replaceChildren(...arr.map((item, i) => h('div', { class: 'set-row' }, make(item, `${title} ${i + 1}`),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `הסרה מ${title}: ${item.name || `שורה ${i + 1}`}`, onclick: () => { syncInputs(); arr.splice(i, 1); redraw(); } }, h('span', { 'aria-hidden': 'true' }, '×')))));
    };
    draw();
    return section(title, hint, box, btn(`הוספה ל${title}`, { class: 'btn btn-sm', onclick: () => { syncInputs(); arr.push(blank()); redraw(); } }));
  };

  let root;
  const redraw = () => {
    inputs.length = 0;
    const fresh = build();
    root.replaceWith(fresh);
    root = fresh;
  };

  const build = () => h('div', { class: 'stack settings' },
    h('section', { class: 'card' },
      h('h2', {}, 'הגדרות בתוקף'),
      h('p', { class: 'muted' }, `ההגדרות שמוצגות כאן בתוקף מ־${current.effectiveFrom}. שמירה יוצרת גרסה חדשה מהתאריך שתבחרו: עסקאות מהתאריך הזה והלאה, ומשכורות והוצאות של החודש שבו הוא נופל, יחושבו לפיה. עסקאות לפני התאריך וחודשים נעולים לא משתנים.`),
      h('div', { class: 'two-col' }, field('בתוקף מתאריך', fromIn, { hint: minDate ? `לא לפני ${minDate} (אחרי החודש הנעול האחרון).` : null }), field('הערה לגרסה', noteIn, { hint: 'לא חובה. למשל: עדכון אחוזי עמלה' }))),
    section('פיימנט וצ׳קים', 'אחוז מההכנסה שיורד ראשון. ״מוצג למקבלי עמלה״ משמש לחישוב העמלה ומופיע בדוח שלהם, גם בעסקאות צ׳קים. העלות האמיתית (פיימנט או צ׳קים) משמשת לחישוב הרווח.',
      h('div', { class: 'three-col' },
        pctField('אחוז אמיתי', () => s.payment.realBp, (v) => { s.payment.realBp = v; }),
        pctField('מוצג למקבלי עמלה', () => s.payment.commissionBp, (v) => { s.payment.commissionBp = v; }),
        pctField('עמלת צ׳קים אמיתית (%)', () => s.payment.checksRealBp ?? s.payment.realBp, (v) => { s.payment.checksRealBp = v; }))),
    listSection('מקבלי עמלה', 'אחוז מבסיס העמלה, לפי משפחת המשפיענים של העסקה.', s.commissionPeople,
      (p, ctx) => h('div', { class: 'three-col' },
        textField('שם', () => p.name, (v) => { p.name = v; }, { context: ctx }),
        pctField('סמיון, מישל ודניס (%)', () => p.rates.simeon, (v) => { p.rates.simeon = v; }, { context: p.name || ctx }),
        pctField('נטלי דדון (%)', () => p.rates.natali, (v) => { p.rates.natali = v; }, { context: p.name || ctx })),
      () => ({ id: `p${Date.now().toString(36)}`, name: '', rates: { simeon: 0, natali: 0 } })),
    section('רכיבים שמעבר לחבילת הבסיס', 'העלות האמיתית משמשת לחישוב הרווח. ״מוצג למקבלי עמלה״ יורד מבסיס העמלה ומופיע בדוח שלהם.',
      Object.entries(ITEMS).map(([id, meta]) => {
        s.items[id] ||= { real: null, commission: null, per: 'unit' };
        const it = s.items[id];
        const perSel = h('select', { class: 'input' }, h('option', { value: 'unit', selected: it.per !== 'deal' }, 'לכל יחידה'), h('option', { value: 'deal', selected: it.per === 'deal' }, 'לעסקה'));
        reg(perSel, (v) => v, (v) => { it.per = v; }, `${meta.name}: חישוב`);
        return h('div', { class: 'item-block' },
          h('h3', {}, meta.name),
          h('div', { class: 'three-col' },
            moneyField('עלות אמיתית (₪)', () => it.real, (v) => { it.real = v; }, { nullable: true, context: meta.name }),
            moneyField('מוצג למקבלי עמלה (₪)', () => it.commission, (v) => { it.commission = v; }, { nullable: true, context: meta.name }),
            field('חישוב', perSel, { context: meta.name })));
      })),
    section('עלויות הפקה לעסקה', 'עלות לחברה בלבד. לא יורדות מבסיס העמלה.',
      Object.keys(PACKAGES).map((pid) => {
        const p = s.production[pid] ||= { influencer: 0, photographer: 0, makeup: 0 };
        const ctx = packageName({ tier: PACKAGES[pid].tier, influencer: PACKAGES[pid].influencer });
        return h('div', { class: 'item-block' },
          h('h3', {}, h('bdi', { dir: 'auto' }, ctx)),
          h('div', { class: 'three-col' },
            p.influencerPerDay !== undefined
              ? [moneyField('משפיענים ליום צילום (₪)', () => p.influencerPerDay, (v) => { p.influencerPerDay = v; }, { context: ctx }),
                intField('לקוחות ביום צילום', () => p.clientsPerDay, (v) => { p.clientsPerDay = Math.max(1, v); }, { context: ctx, hint: 'התשלום מתחלק בין עסקאות החודש; כל קבוצה מלאה פותחת יום נוסף.' })]
              : moneyField('משפיענים (₪)', () => p.influencer, (v) => { p.influencer = v; }, { context: ctx }),
            moneyField('צלם (₪)', () => p.photographer, (v) => { p.photographer = v; }, { context: ctx }),
            p.makeupPerDay !== undefined
              ? moneyField('מאפרת ליום צילום (₪)', () => p.makeupPerDay, (v) => { p.makeupPerDay = v; }, { context: ctx })
              : moneyField('מאפרת (₪)', () => p.makeup, (v) => { p.makeup = v; }, { context: ctx })));
      })),
    section('עלות מעסיק', 'נוספת על המשכורת של עובדים בתלוש. מי שעובד כנגד חשבונית נספר לפי החשבונית בלבד.',
      h('div', { class: 'two-col' }, pctField('עלות מעסיק (%)', () => s.employerCostBp || 0, (v) => { s.employerCostBp = v; }))),
    listSection('עובדים', 'משכורת חודשית, או סכום החשבונית החודשית למי שאינו בתלוש.', s.employees,
      (e, ctx) => h('div', { class: 'emp-row' },
        h('div', { class: 'three-col' },
          textField('שם', () => e.name, (v) => { e.name = v; }, { context: ctx }),
          (() => { const inp = textInput(e.role || '', { maxlength: '100' }); reg(inp, (v) => v.trim(), (v) => { e.role = v; }, 'תפקיד'); return field('תפקיד', inp, { context: e.name || ctx }); })(),
          moneyField(e.payroll ? 'משכורת (₪)' : 'חשבונית חודשית (₪)', () => e.salary, (v) => { e.salary = v; }, { context: e.name || ctx })),
        (() => {
          const cb = h('input', { type: 'checkbox', checked: !!e.payroll });
          reg(cb, () => cb.checked, (v) => { e.payroll = v; }, 'תלוש');
          return h('label', { class: 'choice inline' }, cb, h('span', { class: 'choice-body' },
            h('span', { class: 'choice-label' }, 'בתלוש'), h('span', { class: 'sr-only' }, ` · ${e.name || ctx}`)));
        })(),
        (() => {
          const cb = h('input', { type: 'checkbox', checked: !!e.costIncluded });
          reg(cb, () => cb.checked, (v) => { e.costIncluded = v; }, 'כולל עלות מעסיק');
          return h('label', { class: 'choice inline' }, cb, h('span', { class: 'choice-body' },
            h('span', { class: 'choice-label' }, 'הסכום כבר כולל עלות מעסיק'),
            h('span', { class: 'choice-sub' }, 'לא מוסיפים עליו את אחוז עלות המעסיק'),
            h('span', { class: 'sr-only' }, ` · ${e.name || ctx}`)));
        })()),
      () => ({ id: `e${Date.now().toString(36)}`, name: '', role: '', salary: 0, payroll: true })),
    listSection('תשלום לכל עסקה שסגר', 'למי שמקבל סכום קבוע על כל עסקה שהוא סוגר (לא אחוזים). מסמנים אותו ב״מי סגר״ בעסקה.', s.perDealPeople ||= [],
      (p, ctx) => h('div', { class: 'two-col' },
        textField('שם', () => p.name, (v) => { p.name = v; }, { context: ctx }),
        moneyField('סכום לעסקה (₪)', () => p.amount, (v) => { p.amount = v; }, { context: p.name || ctx })),
      () => ({ id: `d${Date.now().toString(36)}`, name: '', amount: 0 })),
    section('תיאום פגישות', 'הסכום לכל פגישה שתואמה. את מספר הפגישות מזינים בכל חודש ב״הוצאות משתנות של החודש״.',
      h('div', { class: 'two-col' },
        moneyField('לכל פגישה (₪)', () => s.meetingRate || 0, (v) => { s.meetingRate = v; }),
        (() => { const inp = textInput(s.meetingPayee || '', { maxlength: '100' }); reg(inp, (v) => v.trim(), (v) => { s.meetingPayee = v; }, 'מקבל התשלום'); return field('מקבל התשלום', inp); })())),
    listSection('הוצאות קבועות', 'חוזרות כל חודש: פרסום ממומן, משרד, תוספים, תשלום חודשי קבוע לאדם וכו׳.', s.expenses,
      (e, ctx) => h('div', { class: 'three-col' },
        textField('הוצאה', () => e.name, (v) => { e.name = v; }, { context: ctx }),
        (() => { const inp = textInput(e.payee || '', { maxlength: '100' }); reg(inp, (v) => v.trim(), (v) => { e.payee = v || undefined; }, 'למי'); return field('למי (לא חובה)', inp, { context: e.name || ctx }); })(),
        moneyField('סכום לחודש (₪)', () => e.amount, (v) => { e.amount = v; }, { context: e.name || ctx })),
      () => ({ id: `x${Date.now().toString(36)}`, name: '', amount: 0 })),
    listSection('שותפים', 'חלק יחסי: 1, 1, 1 היא חלוקה שווה לשלושה. 2, 1, 1 היא חצי, רבע ורבע.', s.partners,
      (p, ctx) => h('div', { class: 'two-col' },
        textField('שם', () => p.name, (v) => { p.name = v; }, { context: ctx }),
        intField('חלקים', () => p.weight ?? 1, (v) => { p.weight = v; }, { context: p.name || ctx })),
      () => ({ id: `s${Date.now().toString(36)}`, name: '', weight: 1 })),
    errBox,
    h('div', { class: 'save-bar' }, btn('שמירת גרסה חדשה של ההגדרות', { class: 'btn btn-primary', onclick: saveSettings })),
    h('section', { class: 'card' }, h('h2', {}, 'היסטוריית גרסאות'),
      h('ul', { class: 'list' }, [...versions].reverse().map((v) => h('li', { class: 'hist' },
        h('span', {}, `מ־${v.effectiveFrom}`), v.note ? h('small', {}, h('bdi', {}, v.note)) : null)))),
  );

  async function saveSettings() {
    const errors = [];
    for (const [input, parse, assign, label] of inputs) {
      setFieldError(input, '');
      const v = parse(input.value);
      if (typeof v === 'number' && Number.isNaN(v)) { errors.push([input, `${label}: ערך לא תקין.`]); setFieldError(input, 'ערך לא תקין.'); } else assign(v);
    }
    if (!fromIn.value) errors.push([fromIn, 'חסר תאריך תחילה.']);
    else if (minDate && fromIn.value < minDate) errors.push([fromIn, `התאריך חייב להיות ${minDate} או מאוחר יותר.`]);
    const weights = s.partners.reduce((a, p) => a + p.weight, 0);
    if (!errors.length && s.partners.length && weights <= 0) errors.push([fromIn, 'לפחות לשותף אחד צריך להיות חלק גדול מ־0.']);
    if (errors.length) { errBox.replaceChildren(errorSummary(errors)); errBox.firstChild.focus(); return; }
    errBox.replaceChildren();
    const same = versions.find((v) => v.effectiveFrom === fromIn.value);
    if (same && !confirm(`כבר יש גרסה שמתחילה ב־${fromIn.value}. להחליף אותה בערכים האלה?`)) return;
    try {
      await db.saveSettings(fromIn.value, s, noteIn.value.trim());
      state.versions = await db.loadSettings();
      toast('ההגדרות נשמרו.');
      await refresh();
    } catch (e) {
      errBox.replaceChildren(h('div', { class: 'err-summary', role: 'alert' }, db.explain(e)));
    }
  }

  root = build();
  return root;
}

boot().catch((e) => setState(db.explain(e)));
