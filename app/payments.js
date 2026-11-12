// "תשלומי לקוחות" (payments.html; the owner's request of 11.11.2026; docs/ops.md, section 130):
// how each client pays, as the old CRM kept it on every deal. At the top, a tile per payment
// method (how many clients, the deals' amounts, the monthly retainers), and a tap on a tile
// shows only that method's clients. Under it, a row per client: its latest deal; the older ones
// (renewals) open under it. A client with no deal: "לא הוזן".
// The owners (Idan and Adam) read and write: "עריכה", "הוספה", "עסקה חדשה". Ofir reads only.
// Nobody else opens the page (the database answers them no row either: public.client_payments).
// The rules: app/payments-logic.js. Nothing of the payments app (payouts/) is read here.
import { supabase } from './supa.js';
import { loadDirectory } from './protocol-data.js';
import { $, fill, h, toast, errorText, mountSession, directory, viewerOf } from './protocol-ui.js';
import { iconSquare } from './kit.js';
import {
  METHODS, NONE, NOT_SET, methodLabel, canSeePayments, canEditPayments, paymentRows, paymentSummary, filterPayments,
  moneyText, dayText, checksText, paymentProblem, paymentRecord, clientsWord,
} from './payments-logic.js';

let viewer = null;
let rows = [];
let missing = false;
const f = { method: '', q: '' };
const open = new Set();
let lastLoad = 0;
const cardUrl = (id) => `client.html?id=${encodeURIComponent(id)}`;
const edits = () => canEditPayments(viewer);

// ── Data ────────────────────────────────────
// Every client that is not archived (also an ended one: its cheques may still be coming in).
async function loadAll() {
  const [c, p] = await Promise.all([
    supabase.from('clients').select('id, name, business, status').is('archived_at', null).order('business'),
    supabase.from('client_payments').select('id, client_id, amount, retainer, method, checks_count, first_check_date, deal_date, package, note, source, by_email, at'),
  ]);
  if (c.error) throw c.error;
  // Before the migration (20261212100000_client_payments.sql) the table is not there yet.
  if (p.error && ['42P01', 'PGRST205'].includes(p.error.code)) return { clients: c.data || [], payments: [], missing: true };
  if (p.error) throw p.error;
  return { clients: c.data || [], payments: p.data || [], missing: false };
}
let inflight = null;
function load() {
  inflight ||= doLoad().finally(() => { inflight = null; });
  return inflight;
}
async function doLoad() {
  if (!rows.length) $('state').textContent = 'טוען…';
  try {
    const got = await loadAll();
    missing = got.missing;
    rows = paymentRows(got.clients, got.payments);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  lastLoad = Date.now();
  $('state').textContent = missing ? 'המסך מוכן, ופרטי התשלום יופיעו אחרי עדכון מסד הנתונים.' : '';
  render();
}

// ── The summary (and the filter) ────────────
const TONE = { payment: 'purple', checks: 'orange', transfer: 'blue', card: 'teal', [NONE]: 'navy', '': 'navy' };
const ICON = { payment: 'bolt', checks: 'file', transfer: 'link', card: 'check-circle', [NONE]: 'question', '': 'users' };
function sumTile(s) {
  const on = f.method === s.key;
  // The sums only where there is something to sum.
  const money = s.key === NONE || !s.clients ? null : h('span', { class: 'pm-s-money' },
    h('span', { class: 'pm-s-line' }, 'עסקאות ', h('bdi', { class: 'num' }, moneyText(s.amount))),
    h('span', { class: 'pm-s-line' }, 'ריטיינר ', h('bdi', { class: 'num' }, moneyText(s.retainer)), ' לחודש'));
  return h('li', {},
    h('button', {
      type: 'button', class: `pm-s pm-s-${s.key || 'all'}${on ? ' is-on' : ''}`, 'aria-pressed': String(on), 'data-method': s.key,
      onclick: () => { f.method = on && s.key ? '' : s.key; render(); },
    },
    h('span', { class: 'pm-s-h' }, iconSquare(ICON[s.key], TONE[s.key], { size: 'sm' }), h('span', { class: 'k' }, s.label)),
    h('span', { class: 'pm-s-n' }, h('strong', { class: 'v ds-num' }, String(s.clients)), h('span', { class: 'pm-s-w' }, s.clients === 1 ? 'לקוח' : 'לקוחות')),
    money));
}

// ── The table ───────────────────────────────
const none = () => h('span', { class: 'pm-none' }, NOT_SET);
const money = (n) => (n === null || n === undefined ? none() : h('bdi', { class: 'num' }, moneyText(n)));
const methodPill = (key) => (key ? h('span', { class: `pm-pill pm-pill-${key}` }, methodLabel(key)) : none());
const day = (d) => (d ? h('bdi', { class: 'num' }, dayText(d)) : none());
function dealCells(p) {
  return [
    h('td', { 'data-label': 'סכום העסקה', class: 'is-num' }, money(p.amount)),
    h('td', { 'data-label': 'ריטיינר חודשי', class: 'is-num' }, money(p.retainer)),
    h('td', { 'data-label': 'אמצעי תשלום' }, methodPill(p.method)),
    h('td', { 'data-label': 'שיקים', class: 'pm-checks' }, p.method === 'checks' ? h('span', { class: 'pm-lines' }, ...checksText(p).split(' · ').map((t) => h('span', { class: 'pm-line' }, t))) : h('span', { class: 'pm-dash', 'aria-label': 'אין' }, '—')),
    h('td', { 'data-label': 'תאריך העסקה' }, day(p.deal_date)),
  ];
}
function actCell(r, p) {
  if (!edits()) return null;
  return h('td', { class: 'pm-act' },
    h('button', {
      type: 'button', class: 'btn btn-sm', 'data-act': p ? 'edit' : 'add',
      'aria-label': `${p ? 'עריכת' : 'הוספת'} פרטי התשלום של ${r.label}`, onclick: (e) => openForm(r, p, e.currentTarget),
    }, p ? 'עריכה' : 'הוספה'),
    p && p === r.latest ? h('button', {
      type: 'button', class: 'btn-text pm-new', 'data-act': 'renew', 'aria-label': `עסקה חדשה (חידוש) ל${r.label}`,
      onclick: (e) => openForm(r, null, e.currentTarget),
    }, 'עסקה חדשה') : null);
}
function row(r) {
  const p = r.latest;
  const more = r.older.length;
  const isOpen = open.has(r.id);
  const head = h('td', {},
    h('a', { class: 'mt-name', href: cardUrl(r.id) }, r.label),
    p?.note ? h('span', { class: 'sub pm-note' }, p.note) : null,
    more ? h('button', {
      type: 'button', class: 'btn-text pm-more', 'aria-expanded': String(isOpen), 'aria-controls': `pm-old-${r.id}`,
      onclick: () => { if (open.has(r.id)) open.delete(r.id); else open.add(r.id); render(); },
    }, isOpen ? 'הסתרת העסקאות הקודמות' : more === 1 ? 'עוד עסקה קודמת' : `עוד ${more} עסקאות קודמות`) : null);
  const main = h('tr', { 'data-id': r.id, class: p ? 'pm-row' : 'pm-row is-empty' },
    head,
    ...(p ? dealCells(p) : [h('td', { colspan: '5', class: 'pm-empty', 'data-label': 'פרטי תשלום' }, none())]),
    actCell(r, p));
  if (!more || !isOpen) return [main];
  return [main, ...r.older.map((o, i) => h('tr', { class: 'pm-old', id: i === 0 ? `pm-old-${r.id}` : null, 'data-id': r.id },
    h('td', {}, h('span', { class: 'pm-old-h' }, `עסקה קודמת${more > 1 ? ` ${i + 1}` : ''}`)),
    ...dealCells(o),
    actCell(r, o)))];
}
function render() {
  if ($('pm-q').value !== f.q) $('pm-q').value = f.q;
  const s = paymentSummary(rows);
  fill($('pm-sum'), [s.all, ...s.methods].map(sumTile));
  const shown = filterPayments(rows, f);
  const cols = edits() ? 7 : 6;
  const empty = rows.length ? 'אין לקוח שמתאים לסינון.' : 'אין לקוחות.';
  fill($('pm-body'), shown.length ? shown.flatMap(row)
    : [h('tr', { class: 'pm-none-row' }, h('td', { class: 'mt-empty', colspan: String(cols) }, empty))]);
  const label = f.method ? ` · ${f.method === NONE ? NOT_SET : methodLabel(f.method)}` : '';
  $('pm-count').textContent = shown.length === rows.length ? clientsWord(rows.length) : `${clientsWord(shown.length)} מתוך ${rows.length}${label}`;
  $('pm-foot').textContent = edits()
    ? 'הסיכום למעלה סופר את העסקה האחרונה של כל לקוח. לחיצה על משבצת מסננת לפיה.'
    : 'הסיכום למעלה סופר את העסקה האחרונה של כל לקוח. לחיצה על משבצת מסננת לפיה. לצפייה בלבד: את הפרטים מעדכנים הבעלים.';
}

// ── The form (the owners) ───────────────────
let dlg = null;
let opener = null;
function dialog() {
  if (dlg) return dlg;
  dlg = document.body.appendChild(h('dialog', { class: 'pm-dlg', id: 'pm-dlg', 'aria-labelledby': 'pm-dlg-h' },
    h('form', { id: 'pm-form', novalidate: true, method: 'dialog' },
      h('div', { class: 'dlg-head' },
        h('h2', { id: 'pm-dlg-h' }),
        h('button', { type: 'button', class: 'close', 'aria-label': 'סגירה', onclick: () => dlg.close() }, '×')),
      h('div', { class: 'dlg-body', id: 'pm-dlg-body' }),
      h('div', { class: 'dlg-foot' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dlg.close() }, 'ביטול'),
        h('button', { type: 'submit', class: 'btn btn-primary', id: 'pm-save' }, 'שמירה')))));
  dlg.addEventListener('close', () => { opener?.focus?.(); opener = null; });
  return dlg;
}
const text = (id, label, value, { mode = 'text', hint = null, ph = null, ltr = true } = {}) => h('div', { class: 'field pm-field', id: `${id}-f` },
  h('label', { for: id }, label),
  h('input', {
    class: 'input', id, type: 'text', inputmode: mode, dir: ltr ? 'ltr' : null, autocomplete: 'off', value: value ?? '', placeholder: ph,
    'aria-describedby': hint ? `${id}-hint` : null,
  }),
  hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null);
const amountText = (n) => (n === null || n === undefined ? '' : String(Number(n)));
function methodField(current) {
  return h('fieldset', { class: 'pm-methods' },
    h('legend', {}, 'אמצעי תשלום'),
    h('div', { class: 'pm-m-grid' }, ...METHODS.map((m) => h('label', { class: 'pm-m' },
      h('input', { type: 'radio', name: 'pm-method', value: m.key, checked: current === m.key || null, onchange: syncChecks }),
      h('span', {}, m.label)))));
}
function syncChecks() {
  const checks = dlg.querySelector('input[name="pm-method"]:checked')?.value === 'checks';
  dlg.querySelector('#pm-checks').hidden = !checks;
}
function sayErr(t) {
  const e = dlg.querySelector('#pm-err');
  e.textContent = t;
  e.hidden = !t;
}
// `p`: the deal to correct, or null for a new one (a first one, or a renewal).
function openForm(r, p, from) {
  const d = dialog();
  opener = from || document.activeElement;
  d.querySelector('#pm-dlg-h').textContent = `${p ? 'עריכת פרטי תשלום' : r.latest ? 'עסקה חדשה' : 'הוספת פרטי תשלום'} · ${r.label}`;
  fill(d.querySelector('#pm-dlg-body'),
    !p && r.latest ? h('p', { class: 'pm-dlg-note' }, 'חידוש או עסקה נוספת: העסקה הקודמת נשארת ברשימה, מתחת לחדשה.') : null,
    h('div', { class: 'pm-pair' },
      text('pm-amount', 'סכום העסקה (₪)', amountText(p?.amount), { mode: 'decimal', ph: '21240' }),
      text('pm-retainer', 'ריטיינר חודשי (₪)', amountText(p?.retainer), { mode: 'decimal', ph: '1500' })),
    methodField(p?.method || null),
    h('div', { class: 'pm-pair', id: 'pm-checks', hidden: true },
      text('pm-count-n', 'מספר שיקים', p?.checks_count ?? '', { mode: 'numeric', ph: '12' }),
      text('pm-first', 'תאריך השיק הראשון', dayText(p?.first_check_date), { mode: 'text', ph: '1.12.2026' })),
    text('pm-date', 'תאריך העסקה', dayText(p?.deal_date), { ph: '15.11.2026', hint: 'יום.חודש.שנה' }),
    h('div', { class: 'field pm-field' },
      h('label', { for: 'pm-note' }, 'הערה (לא חובה)'),
      h('textarea', { class: 'input', id: 'pm-note', rows: '2', maxlength: '500' }, p?.note || '')),
    h('div', { class: 'err', id: 'pm-err', role: 'alert', hidden: true }));
  syncChecks();
  d.querySelector('#pm-form').onsubmit = (e) => { e.preventDefault(); save(r, p); };
  d.showModal();
  d.querySelector('#pm-amount').focus();
}
async function save(r, p) {
  const v = (id) => dlg.querySelector(`#${id}`).value;
  const typed = {
    amount: v('pm-amount'), retainer: v('pm-retainer'), method: dlg.querySelector('input[name="pm-method"]:checked')?.value || '',
    checks_count: v('pm-count-n'), first_check_date: v('pm-first'), deal_date: v('pm-date'), note: v('pm-note'),
  };
  const bad = paymentProblem(typed);
  if (bad) { sayErr(bad); return; }
  const rec = paymentRecord(typed);
  const btn = dlg.querySelector('#pm-save');
  btn.disabled = true;
  sayErr('');
  try {
    const { error } = p
      ? await supabase.from('client_payments').update(rec).eq('id', p.id)
      : await supabase.from('client_payments').insert({ ...rec, client_id: r.id });
    if (error) throw error;
    dlg.close();
    toast(p ? 'נשמר. פרטי התשלום עודכנו.' : 'נשמר. העסקה נוספה.');
    await load();
  } catch (err) {
    sayErr(`לא נשמר. ${errorText(err)}`);
  } finally {
    btn.disabled = false;
  }
}

// ── Boot ────────────────────────────────────
$('pm-q').addEventListener('input', (e) => { f.q = e.currentTarget.value; render(); });
$('btn-refresh').addEventListener('click', () => load());
document.addEventListener('visibilitychange', () => { if (!document.hidden && lastLoad && Date.now() - lastLoad > 60e3) load(); });

mountSession(async (staff) => {
  const [dir, v] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  if (v?.error || !canSeePayments(v)) { $('no-access').hidden = false; return; }
  viewer = v;
  if (edits()) $('pm-head').append(h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'פעולה')));
  else $('pm-sub').textContent = 'איך כל לקוח משלם: סכום העסקה, הריטיינר החודשי ואמצעי התשלום. לצפייה בלבד.';
  $('pm-page').hidden = false;
  await load();
});
