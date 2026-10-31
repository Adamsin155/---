// "הכנסות ישנות" on the manager view (owner.html#old-income; the owner, 31.10.2026; docs/ops.md,
// section 86): the income records of the old system, to look at. Pure: no DOM, no network, and no
// Date, so the time zone of the device cannot move a deal to another month. Nothing outside the tab
// reads these rows: not the payments, the commissions, the salaries or the profit split.
import { isOwnerView } from './team-rules.js';

export const canSeeOldIncome = isOwnerView;
export const COPY_LINE = 'עותק מ־27.10.2026 · לצפייה בלבד · לא משפיע על התשלומים';
export const SUM_LABEL = 'סכום כפי שנרשם במערכת הישנה';
export const NO_DATE = 'בלי תאריך';
export const NO_NAME = 'בלי שם עסק';

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const ils = new Intl.NumberFormat('en-US');
export const shekels = (n) => `${ils.format(Number(n) || 0)} ₪`;
export const countText = (n) => (n === 1 ? 'עסקה אחת' : `${n} עסקאות`);

const DATE = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})/;
// 'YYYY-MM' of a deal, or null when it has no date the table can use.
const monthOf = (d) => { const m = DATE.exec(d || ''); return m ? `${m[1]}-${m[2]}` : null; };
export const dateText = (d) => { const m = DATE.exec(d || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : NO_DATE; };
export const monthLabel = (key) => (key ? `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}` : NO_DATE);

export const totalOf = (rows = []) => ({ count: rows.length, sum: rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) });

// Per month, the newest first; within a month the newest deal first; "בלי תאריך" last.
export function monthsOf(rows = []) {
  const groups = new Map();
  for (const r of rows) {
    const key = monthOf(r.deal_date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const newest = (a, b) => String(b.deal_date || '').localeCompare(String(a.deal_date || '')) || String(a.old_id).localeCompare(String(b.old_id));
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b.localeCompare(a)))
    .map(([key, deals]) => ({ key: key ?? 'none', label: monthLabel(key), ...totalOf(deals), deals: [...deals].sort(newest) }));
}

// The filter box: spaces and the marks of בע"מ / בע״מ do not decide; a deal with no name is never found.
const squeeze = (s) => String(s ?? '').toLowerCase().replace(/["'״׳`]/g, '').replace(/\s+/g, ' ').trim();
export function filterByBusiness(rows = [], q = '') {
  const want = squeeze(q);
  return want ? rows.filter((r) => squeeze(r.business).includes(want)) : rows;
}

// The second, quiet line of a deal: only what is there.
export function quietLine(r) {
  return [
    Number(r.retainer) > 0 ? `ריטיינר ${shekels(r.retainer)}` : null,
    r.payment_method ? `תשלום: ${r.payment_method}` : null,
    r.close_type ? `סגירה: ${r.close_type}` : null,
  ].filter(Boolean).join(' · ');
}

// The table is not there before its SQL has run: PostgREST's "not in the schema cache", or Postgres's own.
export const isMissingTable = (err) => ['42P01', 'PGRST205'].includes(err?.code) || /does not exist|schema cache/i.test(err?.message || '');
