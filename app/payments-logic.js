// "תשלומי לקוחות" (payments.html; the owner's request of 11.11.2026; docs/ops.md, section 130):
// how each client pays, one row per deal in public.client_payments. The plain rules here, no
// DOM, so node tests them (tests/payments-logic.test.mjs):
//   who sees and who writes   canSeePayments, canEditPayments (the database decides the same:
//                             private.can_read_client_payments / can_write_client_payments)
//   the list                  paymentRows: a row per client, its latest deal and the older ones
//   the summary and filter    paymentSummary, filterPayments
//   the form                  parseMoney, parseDay, paymentProblem, paymentRecord
import { clientLabel } from './protocol-logic.js';

export const METHODS = [
  { key: 'payment', label: 'פיימנט' },
  { key: 'checks', label: 'שיקים' },
  { key: 'transfer', label: 'העברה בנקאית' },
  { key: 'card', label: 'כרטיס אשראי' },
];
export const NONE = 'none';            // the filter's "לא הוזן": no deal, or a deal with no method
export const NOT_SET = 'לא הוזן';
export const methodLabel = (key) => METHODS.find((m) => m.key === key)?.label || NOT_SET;

// The owners (Idan and Adam: no person) see and write; Ofir sees only. Nobody else.
const known = (v) => !!v && !v.error;
export const isOwner = (v) => known(v) && !v.me && v.scope === 'office';
export const PAYMENT_READERS = ['ofir'];
export const canSeePayments = (v) => isOwner(v) || (known(v) && PAYMENT_READERS.includes(v.me));
export const canEditPayments = (v) => isOwner(v);

// The order of a client's deals: the latest deal first (by its date; a deal with no date after
// the dated ones), then the latest written.
const dealKey = (p) => `${p.deal_date || '0000-00-00'}|${p.at || ''}`;
export const byLatest = (a, b) => (dealKey(a) < dealKey(b) ? 1 : dealKey(a) > dealKey(b) ? -1 : 0);

// One row per client: { id, label, latest (a deal or null), older: [deals], method (key or NONE) }.
// The clients with a deal first, the latest deal first; then the rest by name.
export function paymentRows(clients, payments) {
  const byClient = new Map();
  for (const p of payments || []) {
    if (!byClient.has(p.client_id)) byClient.set(p.client_id, []);
    byClient.get(p.client_id).push(p);
  }
  const rows = (clients || []).map((c) => {
    const deals = (byClient.get(c.id) || []).slice().sort(byLatest);
    const latest = deals[0] || null;
    return { id: c.id, label: clientLabel(c) || c.business || c.name || '', latest, older: deals.slice(1), method: latest?.method || NONE };
  });
  return rows.sort((a, b) => {
    if (!!a.latest !== !!b.latest) return a.latest ? -1 : 1;
    if (a.latest) { const d = byLatest(a.latest, b.latest); if (d) return d; }
    return a.label.localeCompare(b.label, 'he');
  });
}

const sum = (list, k) => list.reduce((s, r) => s + (Number(r.latest?.[k]) || 0), 0);
// The summary at the top, of the latest deal of every client: per method (and "לא הוזן") how many
// clients, the deals' amounts and the monthly retainers; and the same for all of them.
export function paymentSummary(rows) {
  const part = (key, label, list) => ({ key, label, clients: list.length, amount: sum(list, 'amount'), retainer: sum(list, 'retainer') });
  const all = rows || [];
  return {
    all: part('', 'כל הלקוחות', all),
    methods: [...METHODS.map((m) => part(m.key, m.label, all.filter((r) => r.method === m.key))), part(NONE, NOT_SET, all.filter((r) => r.method === NONE))],
  };
}

const norm = (s) => String(s || '').replace(/["'״׳`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
// By method ('' = all, NONE = "לא הוזן") and by a part of the client's name.
export function filterPayments(rows, { method = '', q = '' } = {}) {
  const want = norm(q);
  return (rows || []).filter((r) => (!method || r.method === method) && (!want || norm(r.label).includes(want)));
}

// ── The form ──
// Shekels as typed: "21,240", "21240.50", "₪ 1500"; empty is null; anything else is NaN.
export function parseMoney(text) {
  const t = String(text ?? '').replace(/[₪,\s]/g, '');
  if (!t) return null;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(t)) return NaN;
  return Number(t);
}
// A whole number of cheques; empty is null.
export function parseCount(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  return /^\d{1,2}$/.test(t) ? Number(t) : NaN;
}
// A day as typed in Israel: "1.12.2026", "1/12/26", "01-12-2026"; empty is null; else NaN.
// Returns 'YYYY-MM-DD'.
export function parseDay(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(t);
  if (!m) return NaN;
  const [d, mo] = [Number(m[1]), Number(m[2])];
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (y < 2000 || y > 2100 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// 'YYYY-MM-DD' as the form shows it: "1.12.2026".
export const dayText = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : '';
};
// Shekels as the screen shows them: "21,240 ₪".
const ils = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });
export const moneyText = (n) => (n === null || n === undefined || n === '' ? NOT_SET : `${ils.format(Number(n))} ₪`);

// The form's typed text → the problem to show, or null.
export function paymentProblem(f) {
  if (Number.isNaN(parseMoney(f.amount))) return 'סכום העסקה: מספר בשקלים, למשל 21240.';
  if (Number.isNaN(parseMoney(f.retainer))) return 'ריטיינר חודשי: מספר בשקלים, למשל 1500.';
  if (f.method && !METHODS.some((m) => m.key === f.method)) return 'בחרו אמצעי תשלום.';
  if (f.method === 'checks') {
    const n = parseCount(f.checks_count);
    if (Number.isNaN(n) || n === 0 || n > 60) return 'מספר השיקים: מספר שלם בין 1 ל־60.';
    if (Number.isNaN(parseDay(f.first_check_date))) return 'תאריך השיק הראשון: יום.חודש.שנה, למשל 1.12.2026.';
  }
  if (Number.isNaN(parseDay(f.deal_date))) return 'תאריך העסקה: יום.חודש.שנה, למשל 15.11.2026.';
  if (String(f.note || '').length > 500) return 'הערה: עד 500 תווים.';
  return null;
}
// The form's typed text → the row's fields (the cheques' details only on a cheques deal).
export function paymentRecord(f) {
  const checks = f.method === 'checks';
  return {
    amount: parseMoney(f.amount),
    retainer: parseMoney(f.retainer),
    method: f.method || null,
    checks_count: checks ? parseCount(f.checks_count) : null,
    first_check_date: checks ? parseDay(f.first_check_date) : null,
    deal_date: parseDay(f.deal_date),
    note: String(f.note || '').trim() || null,
  };
}
// The cheques in one line: "12 שיקים · מ־1.12.2026".
export function checksText(p) {
  if (p?.method !== 'checks') return '';
  const n = p.checks_count ? (p.checks_count === 1 ? 'שיק אחד' : `${p.checks_count} שיקים`) : 'מספר השיקים לא הוזן';
  return p.first_check_date ? `${n} · הראשון ב־${dayText(p.first_check_date)}` : n;
}
export const clientsWord = (n) => (n === 1 ? 'לקוח אחד' : `${n} לקוחות`);
