// Reading a signed contract that was uploaded by hand (the owner, 5.11.2026: "המערכת יכולה לדעת
// מתוך החוזה שמעלים"): the contract-ai function sends the file (a PDF or a picture) to Claude, and
// this module holds what is shared by the function and the site: the strict answer schema, the
// prompt, the checking of the answer, and what a confirmed reading writes. Pure (no DOM, no Deno):
// node tests it; supabase/functions/_shared/app/ has the copy the function deploys with.
//
// Nothing is saved by the reading itself. The uploader sees what was found, corrects it and
// confirms; only then a row goes to public.manual_contracts (quotes.html lists it as "נחתם · חוזה
// ידני") and the client's details are filled in (docs/ops.md, section 104).
import { PACKAGES, TIERS, INFLUENCERS, VAT_RATE_PERCENT } from './catalog.js';

export const PACKAGE_IDS = Object.keys(PACKAGES);
// The file types Claude reads: a PDF as a document, these pictures as an image (HEIC is not one).
export const READ_PDF = 'application/pdf';
export const READ_IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
// The size sent to the model: a PDF up to 15MB, a picture up to 3.5MB (the API's own limits, with
// room for the base64 that grows a file by a third).
export const READ_MAX_PDF = 15 * 1024 * 1024;
export const READ_MAX_IMAGE = 3.5 * 1024 * 1024;

// The media of a stored file, from its type, else from its name: { kind: 'document'|'image', mime }
// or { error }.
export function readMediaOf(mime, path = '') {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  const name = String(path || '').toLowerCase();
  const byName = /\.pdf$/.test(name) ? READ_PDF : /\.jpe?g$/.test(name) ? 'image/jpeg' : /\.png$/.test(name) ? 'image/png'
    : /\.webp$/.test(name) ? 'image/webp' : /\.gif$/.test(name) ? 'image/gif' : '';
  const type = m === READ_PDF || READ_IMAGES.includes(m) ? m : byName;
  if (type === READ_PDF) return { kind: 'document', mime: READ_PDF };
  if (READ_IMAGES.includes(type)) return { kind: 'image', mime: type };
  return { error: 'read_unsupported' };
}
export const readTooBig = (media, bytes) => Number(bytes) > (media.kind === 'document' ? READ_MAX_PDF : READ_MAX_IMAGE);

// The answer, strict (structured outputs). 0 and '' mean "not in the contract".
export const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['business', 'company_id', 'contact_name', 'package_id', 'monthly_net', 'term_months', 'signed_on', 'notes'],
  properties: {
    business: { type: 'string' },
    company_id: { type: 'string' },
    contact_name: { type: 'string' },
    package_id: { type: 'string', enum: ['', ...PACKAGE_IDS] },
    monthly_net: { type: 'integer' },
    term_months: { type: 'integer' },
    signed_on: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

const packageLine = (id) => {
  const p = PACKAGES[id];
  return `- ${id}: ${TIERS.find((t) => t.id === p.tier)?.name || p.tier} · ${INFLUENCERS[p.influencer]?.name || p.influencer} (${(p.price / 100).toLocaleString('en-US')} ₪ לחודש לפני מע״מ)`;
};
export function readSystemPrompt() {
  return [
    'אתה קורא הסכם התקשרות חתום של "אסטרטג", משרד שיווק בישראל, ומחזיר את פרטיו בדיוק כפי שהם כתובים בו.',
    'אל תנחש ואל תשלים: מה שלא כתוב בחוזה מוחזר ריק ("") או 0.',
    'business: שם העסק של הלקוח (לא אסטרטג). company_id: ח.פ/ע.מ של הלקוח, ספרות בלבד (לא של אסטרטג, 514729938). contact_name: שם איש הקשר או החותם מטעם הלקוח.',
    'package_id: החבילה מהרשימה, לפי שם החבילה והמשפיען שכתובים בחוזה. "משפיען לבחירה" או "משפיען מרשימת המשפיענים של אסטרטג" הוא המשפיען choice. אם החבילה לא מתאימה לאף אחת: "".',
    PACKAGE_IDS.map(packageLine).join('\n'),
    'monthly_net: התמורה החודשית בשקלים לפני מע״מ, מספר שלם (אם כתוב רק כולל מע״מ, חלק ב־1.18 ועגל). term_months: מספר חודשי ההתחייבות.',
    'signed_on: תאריך החתימה בפורמט YYYY-MM-DD. אם אין תאריך חתימה מפורש, תאריך המסמך; אם אין גם אותו: "".',
    'notes: עד 3 משפטים קצרים בעברית על מה שלא היה ברור או חסר (למשל "החתימה לא נראית במסמך"). אם הכול ברור: [].',
  ].join('\n');
}
export const READ_USER_TEXT = 'זה ההסכם החתום. החזר את הפרטים.';

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function validDay(s, now = new Date()) {
  const m = DATE.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return false;
  return +m[1] >= 2020 && d.getTime() <= now.getTime() + 2 * 864e5;
}
export const LIMITS = { business: 120, contact: 80, note: 200, notes: 3, monthlyMax: 200000, termMax: 60 };

// The model's answer, checked: { result, dropped }. Never throws. `result`:
// { business, company_id, contact_name, package_id, monthly_net (₪ or null), term_months (or null),
//   signed_on ('YYYY-MM-DD' or ''), notes: [] }.
export function validateReadResult(raw, now = new Date()) {
  const dropped = [];
  const drop = (field, text) => dropped.push({ field, text });
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (r !== raw) drop('', 'התשובה לא הייתה בפורמט הנכון');
  const company = String(r.company_id ?? '').replace(/\D/g, '');
  if (company && company.length !== 9) drop('company_id', 'הח.פ שנקרא לא תקין');
  const pkg = PACKAGE_IDS.includes(r.package_id) ? r.package_id : '';
  if (r.package_id && !pkg) drop('package_id', 'החבילה שנקראה לא מוכרת');
  const int = (v) => (Number.isInteger(v) ? v : Number.isFinite(Number(v)) && String(v).trim() !== '' ? Math.round(Number(v)) : 0);
  const monthly = int(r.monthly_net);
  if (monthly && (monthly < 1 || monthly > LIMITS.monthlyMax)) drop('monthly_net', 'המחיר שנקרא לא סביר');
  const term = int(r.term_months);
  if (term && (term < 1 || term > LIMITS.termMax)) drop('term_months', 'מספר החודשים שנקרא לא סביר');
  const day = String(r.signed_on ?? '').trim();
  if (day && !validDay(day, now)) drop('signed_on', 'תאריך החתימה שנקרא לא תקין');
  return {
    result: {
      business: clip(r.business, LIMITS.business),
      company_id: company.length === 9 ? company : '',
      contact_name: clip(r.contact_name, LIMITS.contact),
      package_id: pkg,
      monthly_net: monthly >= 1 && monthly <= LIMITS.monthlyMax ? monthly : null,
      term_months: term >= 1 && term <= LIMITS.termMax ? term : null,
      signed_on: validDay(day, now) ? day : '',
      notes: (Array.isArray(r.notes) ? r.notes : []).map((n) => clip(n, LIMITS.note)).filter(Boolean).slice(0, LIMITS.notes),
    },
    dropped,
  };
}

// The day the contract ends: the signing day plus the months (the same day of the month, as the
// "לקוח חדש" form counts it), 'YYYY-MM-DD'; null without both.
export function contractEndOf(signedOn, termMonths) {
  const m = DATE.exec(String(signedOn || ''));
  const t = Number(termMonths);
  if (!m || !Number.isInteger(t) || t < 1) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1 + t, +m[3]));
  return d.toISOString().slice(0, 10);
}

// What the uploader typed in the review, checked again (the same rules): { ok, row, errors }.
// `form`: { business, company_id, contact_name, package_id, monthly_net, term_months, signed_on }
// as strings from the inputs.
export function checkReadForm(form, now = new Date()) {
  const errors = {};
  const business = clip(form.business, LIMITS.business);
  const company = String(form.company_id ?? '').replace(/[\s-]/g, '');
  if (company && !/^\d{9}$/.test(company)) errors.company_id = 'ח.פ: 9 ספרות.';
  const pkg = String(form.package_id || '');
  if (pkg && !PACKAGE_IDS.includes(pkg)) errors.package_id = 'החבילה לא מוכרת.';
  const num = (v) => (String(v ?? '').trim() === '' ? null : Number(String(v).replace(/[,\s₪]/g, '')));
  const monthly = num(form.monthly_net);
  if (monthly !== null && !(Number.isInteger(monthly) && monthly >= 1 && monthly <= LIMITS.monthlyMax)) errors.monthly_net = 'מחיר לחודש: מספר שלם בשקלים.';
  const term = num(form.term_months);
  if (term !== null && !(Number.isInteger(term) && term >= 1 && term <= LIMITS.termMax)) errors.term_months = `חודשים: בין 1 ל־${LIMITS.termMax}.`;
  const day = String(form.signed_on || '').trim();
  if (day && !validDay(day, now)) errors.signed_on = 'תאריך החתימה לא תקין.';
  if (!business) errors.business = 'חסר שם העסק.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    errors: {},
    row: {
      business, company_id: company || null, contact_name: clip(form.contact_name, LIMITS.contact) || null,
      package_id: pkg || null, monthly_net_agorot: monthly === null ? null : monthly * 100, term_months: term, signed_on: day || null,
    },
  };
}

// What a confirmed reading fills in the client: only what was read and is missing or plainly the
// contract's (the package's name, the end of the contract); a filled field is not overwritten,
// except the end of the contract, which the contract decides. `dealDeliverables(id)` is passed in
// (app/client-open.js) so this module stays free of the deliverables' rules.
export function clientPatchFromRead(row, client = {}, { packageName = () => null, dealDeliverables = () => ({}) } = {}) {
  const patch = {};
  if (row.business && !client.business) patch.business = row.business;
  if (row.company_id && !client.company_id) patch.company_id = row.company_id;
  if (row.package_id) {
    const name = packageName(row.package_id);
    if (name && name !== client.package_name) patch.package_name = name;
    const empty = !client.deliverables || !Object.keys(client.deliverables).length;
    if (empty) patch.deliverables = dealDeliverables(row.package_id);
  }
  const end = contractEndOf(row.signed_on, row.term_months);
  if (end && end !== client.contract_end) patch.contract_end = end;
  return patch;
}

// A confirmed manual contract as a line of quotes.html: the amounts with VAT, as the quotes are.
export function manualAmounts(row) {
  const net = Number(row?.monthly_net_agorot) || 0;
  const monthly = Math.round((net * (100 + VAT_RATE_PERCENT)) / 100);
  return { monthly_gross_agorot: monthly, term_gross_agorot: monthly * (Number(row?.term_months) || 0) };
}
