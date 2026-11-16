// "לקוחות לחשבוניות" (bookkeeper.html): the one screen of Gal, the office's bookkeeper (the owner's
// request of 16.11.2026; docs/ops.md, section 137). Pure, no DOM (tests/bookkeeper-gal.test.mjs).
// The rows come from public.bookkeeper_clients() (supabase/migrations/20261215100000_bookkeeper_gal.sql):
// the active and ending clients, the invoice fields, and the amounts with VAT in agorot, with `source`
// (where the amount is written) and `why` (what is missing). Nothing here guesses an amount.
import { CLIENT_STATUS } from './protocol.js';

export const BOOKKEEPER_TITLE = 'לקוחות לחשבוניות';
export const DASH = '—';

// The fields of a card, in order: the key of the row, the label, and whether it is read left to right.
export const FIELDS = [
  { key: 'contact_name', label: 'שם' },
  { key: 'business', label: 'שם העסק לחשבונית' },
  { key: 'company_id', label: 'ח.פ', ltr: true },
  { key: 'phone', label: 'טלפון', ltr: true },
  { key: 'email', label: 'מייל', ltr: true },
  { key: 'monthly', label: 'לחודש כולל מע״מ', ltr: true, money: true },
  { key: 'total', label: 'לכל החוזה כולל מע״מ', ltr: true, money: true },
];

// Where the amount is written, in her words.
export const SOURCE_WORDS = {
  quote: 'מתוך החוזה שנחתם במערכת',
  manual: 'מתוך החוזה שהועלה',
  legacy: 'מתוך החוזה במערכת הישנה',
  payments: 'מתוך "תשלומי לקוחות"',
};
// What is missing, in her words (never a guessed amount instead).
export const WHY_WORDS = {
  none: 'אין סכום במערכת ללקוח הזה. לברר במשרד.',
  no_term: 'בחוזה לא כתוב לכמה חודשים, ולכן אין סכום לכל החוזה. לברר במשרד.',
  no_total: 'אין סכום לכל החוזה במערכת. לברר במשרד.',
  no_monthly: 'אין סכום חודשי במערכת. לברר במשרד.',
  unclear: 'הסכום לכל החוזה שרשום במערכת לא מתאים לסכום החודשי, ולכן הוא לא מוצג. לברר במשרד.',
};

const whole = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Agorot as she reads them: "5,310 ₪", or "5,310.50 ₪" when there are agorot. null: nothing.
export function moneyWords(agorot) {
  const a = n(agorot);
  if (a === null) return null;
  const r = Math.round(a);
  return `${(r % 100 === 0 ? whole : cents).format(r / 100)} ₪`;
}
// What the copy button puts on the clipboard: the bare number her invoicing software takes
// ("5310", "5310.50"), no commas and no ₪.
export function moneyCopy(agorot) {
  const a = n(agorot);
  if (a === null) return null;
  const r = Math.round(a);
  return r % 100 === 0 ? String(r / 100) : (r / 100).toFixed(2);
}

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

// One row of the function into what the card shows. Each field: { text, copy } (both null when empty).
export function clientOf(r) {
  const months = n(r.months);
  const fields = {};
  for (const f of FIELDS) {
    if (f.money) continue;
    const v = clean(r[f.key]);
    fields[f.key] = { text: v, copy: v };
  }
  fields.monthly = { text: moneyWords(r.monthly_agorot), copy: moneyCopy(r.monthly_agorot) };
  fields.total = { text: moneyWords(r.total_agorot), copy: moneyCopy(r.total_agorot) };
  const title = fields.business.text || fields.contact_name.text || 'לקוח בלי שם';
  return {
    title,
    status: r.status,
    ending: r.status === 'ending',
    statusText: CLIENT_STATUS[r.status] || '',
    fields,
    months: months && months > 0 ? months : null,
    source: SOURCE_WORDS[r.source] || null,
    note: WHY_WORDS[r.why] || null,
    hay: haystack(r),
  };
}

// The words a search looks in: the names, the email, ח.פ and the phone (also as bare digits).
function haystack(r) {
  const parts = [r.contact_name, r.business, r.email, r.company_id, r.phone].map((x) => String(x ?? ''));
  return `${fold(parts.join(' '))} ${parts.map(digits).filter(Boolean).join(' ')}`;
}
const fold = (s) => String(s || '').toLowerCase().replace(/[֑-ׇ]/g, '').replace(/["'״׳`]/g, '').replace(/\s+/g, ' ').trim();
const digits = (s) => String(s || '').replace(/\D+/g, '');

// The clients matching what she typed (every word must match); all of them when empty.
export function search(list, q) {
  const words = fold(q).split(' ').filter(Boolean);
  if (!words.length) return list;
  return list.filter((c) => words.every((w) => c.hay.includes(w) || (/^\d[\d-]*$/.test(w) && digits(w) && c.hay.includes(digits(w)))));
}

// Business name order, Hebrew alphabet (as she looks a client up).
const collator = new Intl.Collator('he', { sensitivity: 'base', numeric: true });
export const sortClients = (list) => [...list].sort((a, b) => collator.compare(a.title, b.title));

// "98 לקוחות פעילים" / "3 מתוך 98".
export function countWords(shown, all) {
  if (!all) return '';
  if (shown === all) return all === 1 ? 'לקוח פעיל אחד' : `${all} לקוחות פעילים`;
  if (!shown) return 'לא נמצא לקוח';
  return `${shown} מתוך ${all} לקוחות`;
}
