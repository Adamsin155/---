// The signed documents of the old system (astrateg-crm), in the new one (the owner's request
// of 25.10.2026; public.legacy_contracts, 20261105100000_legacy_contracts.sql). What the
// client card's list and the document's page (legacy-contract.html) say, without the DOM.
// The documents are read as the old system kept them: a field that is missing, empty or of
// another shape is left out, never guessed. Times are in Israel time on every device.
import { TZ } from './tz.js';

export const DOC_TYPES = { contract: 'חוזה', termination: 'סיום התקשרות', addendum: 'נספח' };
export const DOC_TITLES = { contract: 'הסכם התקשרות', termination: 'סיום התקשרות', addendum: 'נספח להסכם' };
export const typeOf = (t) => (DOC_TYPES[t] ? t : 'contract');
export const typeLabel = (t) => DOC_TYPES[typeOf(t)];

// The document's state (public.legacy_contracts.status, 20261110100000_batch_2710.sql; the
// owner, 27.10.2026): signed there, sent and never signed, or a price offer. A row brought
// over before that (or read before that migration) is a signed one.
export const STATUS_LABELS = { signed: 'נחתם', pending: 'ממתין לחתימה (במערכת הישנה)', quote: 'הצעת מחיר' };
export const statusOf = (s) => (STATUS_LABELS[s] ? s : 'signed');
export const statusLabel = (s) => STATUS_LABELS[statusOf(s)];
export const isSigned = (row) => statusOf(row?.status) === 'signed';

// Only a PNG picture is drawn as a signature (as the table's check says).
const PNG_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
export const isSignaturePng = (s) => typeof s === 'string' && s.length < 400000 && PNG_RE.test(s);

// A time of the old record: ISO text, or milliseconds (or seconds) since 1970.
export function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  const d = typeof v === 'number' ? new Date(v > 1e11 ? v : v * 1000) : typeof v === 'string' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}
const dayFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric' });
const longFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const dayText = (v) => { const d = toDate(v); return d ? dayFmt.format(d) : null; };
export const longDayText = (v) => { const d = toDate(v); return d ? longFmt.format(d) : null; };
export const timeText = (v) => { const d = toDate(v); return d ? timeFmt.format(d) : null; };

// A sum of the old record (a number, or text such as "5,000" or "₪5000"), in shekels as it
// was written there; null when it is not a number.
export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\s,₪]/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}
export function moneyText(v) {
  const n = toNumber(v);
  if (n === null) return null;
  return `₪${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

// The first 12 characters of a SHA-256 in hex (the document's stamp), or null.
export const hashStamp = (h) => (typeof h === 'string' && /^[0-9a-f]{12,}$/i.test(h) ? h.slice(0, 12).toLowerCase() : null);

// The line under the title: "מסמך מהמערכת הישנה · נחתם <date> · חותמת <12>"; a document that
// was not signed says so in the place of the day.
export function stampLine(row, doc = row?.doc || {}) {
  if (!isSigned(row)) {
    const stamp = hashStamp(doc.docHash);
    return ['מסמך מהמערכת הישנה', statusOf(row?.status) === 'quote' ? 'הצעת מחיר, לא נחתמה' : 'ממתין לחתימה, לא נחתם', stamp ? `חותמת ${stamp}` : null].filter(Boolean).join(' · ');
  }
  const signed = dayText(row?.signed_at ?? doc.signedAt);
  const stamp = hashStamp(doc.docHash);
  return ['מסמך מהמערכת הישנה', signed ? `נחתם ${signed}` : null, stamp ? `חותמת ${stamp}` : null].filter(Boolean).join(' · ');
}

// ── The client card's list ──
// rows: { id, doc_type, doc_number, signer_name, signed_at, total_amount, status }, newest
// signed first, then those with no signing day (waiting, price offers), the newest id first.
const signedTime = (r) => (isSigned(r) ? toDate(r.signed_at)?.getTime() ?? -Infinity : -Infinity);
export function legacyRows(rows) {
  return [...(rows || [])]
    .sort((a, b) => (signedTime(b) - signedTime(a)) || Number(b.id) - Number(a.id))
    .map((r) => ({
      id: r.id,
      type: typeLabel(r.doc_type),
      number: r.doc_number || null,
      status: statusOf(r.status),
      statusText: statusLabel(r.status),
      signed: isSigned(r) ? dayText(r.signed_at) : null,
      signer: r.signer_name || null,
      total: moneyText(r.total_amount),
      href: `legacy-contract.html?id=${encodeURIComponent(r.id)}`,
    }));
}
export const legacySum = (n) => (n === 1 ? 'מסמך אחד' : `${n} מסמכים`);

// ── The document ──
const text = (v) => (typeof v === 'string' ? v.trim() || null : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);

// A list of the old record (bullets, custom clauses): strings or objects, as { title, text }.
export function listOf(v) {
  if (v === null || v === undefined) return [];
  const items = Array.isArray(v) ? v : [v];
  return items.map((x) => {
    if (typeof x === 'string' || typeof x === 'number') return text(x) ? { title: null, text: text(x) } : null;
    if (!x || typeof x !== 'object') return null;
    const title = text(x.title ?? x.heading ?? x.name ?? x.label);
    const body = text(x.text ?? x.body ?? x.content ?? x.description ?? x.value);
    return title || body ? { title, text: body } : null;
  }).filter(Boolean);
}

// The package's counts, each [number, label]; months unless the document had none.
export function packageCounts(doc) {
  const out = [];
  const add = (v, label) => { const n = toNumber(v); if (n !== null && n > 0) out.push([n, label]); };
  if (!doc.noMonths) add(doc.months, 'חודשים');
  add(doc.shootDays, 'ימי צילום');
  add(doc.contentTotal, 'תכנים בסך הכול');
  add(doc.reels, 'סרטונים');
  add(doc.graphics, 'גרפיקות');
  if (typeof doc.influencers === 'number') add(doc.influencers, 'משפיענים');
  return out;
}

// The money, each [label, text].
export function paymentFacts(doc, row = {}) {
  return [
    ['סכום כולל', moneyText(row.total_amount ?? doc.totalAmount)],
    ['ריטיינר חודשי', moneyText(row.retainer ?? doc.retainer)],
    ['דמי הקמה', moneyText(doc.setupNet)],
    ['תשלום חד־פעמי', moneyText(doc.oneTimeNet)],
    ['אמצעי תשלום', text(doc.paymentMethod)],
    ['מספר תשלומים / צ׳קים', text(doc.checksCount)],
  ].filter(([, v]) => v);
}

// The termination's details (an object of the old system), each [label, text].
const TERM_LABELS = {
  date: 'תאריך', endDate: 'תאריך סיום', effectiveDate: 'בתוקף מ־', lastDay: 'יום אחרון', endAt: 'תאריך סיום',
  reason: 'סיבה', notes: 'הערות', note: 'הערה', amount: 'סכום', balance: 'יתרה', refund: 'החזר', months: 'חודשים',
};
export function termFacts(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return [];
  return Object.entries(t).map(([k, v]) => {
    if (v === null || v === undefined || typeof v === 'object' || v === '') return null;
    if (typeof v === 'boolean') return [TERM_LABELS[k] || k, v ? 'כן' : 'לא'];
    const asDay = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? longDayText(v) : null;
    const asMoney = /amount|balance|refund|sum|total/i.test(k) ? moneyText(v) : null;
    return [TERM_LABELS[k] || k, asDay || asMoney || String(v)];
  }).filter(Boolean);
}

// Who signed: the signers of the record, or its one signer.
export function signersOf(doc, row = {}) {
  if (row.status && !isSigned(row)) return [];
  const many = Array.isArray(doc.signers) ? doc.signers.filter((s) => s && typeof s === 'object' && (s.name || s.signature)) : [];
  const list = many.length ? many.map((s) => ({ name: text(s.name), png: s.signature, at: s.signedAt ?? s.at, id: text(s.idNo), idLabel: text(s.idLabel), ip: text(s.ip ?? s.signedIp) }))
    : [{ name: row.signer_name || text(doc.signerName), png: row.signature || doc.signature, at: row.signed_at ?? doc.signedAt, id: text(doc.hp), idLabel: 'ח״פ', ip: text(doc.signedIp), ua: text(doc.signedUserAgent) }];
  return list.map((s) => ({ name: s.name || null, png: isSignaturePng(s.png) ? s.png : null, at: timeText(s.at), id: s.id || null, idLabel: s.idLabel || 'ח״פ', ip: s.ip || null, ua: s.ua || null }))
    .filter((s) => s.name || s.png || s.at);
}

// The signing's history, each line in words.
const EVENTS = { signed: 'נחתם', viewed: 'נצפה', opened: 'נפתח', sent: 'נשלח', created: 'נוצר' };
export function historyLines(v) {
  if (!Array.isArray(v)) return [];
  return v.map((e) => {
    if (typeof e === 'string') return e.trim() || null;
    if (!e || typeof e !== 'object') return null;
    const at = timeText(e.at ?? e.time ?? e.date ?? e.signedAt);
    const what = text(e.event ?? e.action ?? e.type ?? e.status);
    const who = text(e.name ?? e.by ?? e.signerName);
    // The device of the signing, as the old system kept it (28.10.2026: everything is copied).
    const ip = text(e.ip ?? e.signedIp);
    const ua = text(e.userAgent ?? e.ua ?? e.signedUserAgent);
    const parts = [at, what ? EVENTS[what] || what : null, who, ip ? `IP ${ip}` : null, ua].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }).filter(Boolean);
}

// Every other plain field of the record, for "שדות נוספים" (nothing is lost on the way).
const SHOWN = new Set(['id', 'clientId', 'clientName', 'business', 'packageName', 'influencers', 'months', 'shootDays', 'contentTotal',
  'reels', 'graphics', 'totalAmount', 'retainer', 'paymentMethod', 'notes', 'createdAt', 'docNumber', 'validUntil', 'docHash', 'docHashAt',
  'signHistory', 'signerName', 'signature', 'signedAt', 'firstViewedAt', 'sketches', 'customClauses', 'specialRequest', 'packageBullets',
  'checksCount', 'paymentSummary', 'docType', 'termination', 'signers', 'parentContractId', 'extraBullets', 'detailBullets', 'noServices',
  'noMonths', 'contentHeading', 'consentText', 'signatureHash', 'catalog', 'setupNet', 'oneTimeNet', 'extraSocial', 'atBusiness', 'status',
  'signedIp', 'signedUserAgent', 'phone', 'hp']);
const EXTRA_LABELS = { status: 'מצב', atBusiness: 'הצילום בבית העסק', extraSocial: 'רשתות נוספות', docHashAt: 'חותמת נוצרה', firstViewedAt: 'נצפה לראשונה', createdAt: 'נוצר' };
export function extraFacts(doc) {
  const out = [];
  for (const k of ['createdAt', 'firstViewedAt', 'docHashAt']) { const t = timeText(doc[k]); if (t) out.push([EXTRA_LABELS[k], t]); }
  if (typeof doc.atBusiness === 'boolean') out.push([EXTRA_LABELS.atBusiness, doc.atBusiness ? 'כן' : 'לא']);
  else if (text(doc.atBusiness)) out.push([EXTRA_LABELS.atBusiness, text(doc.atBusiness)]);
  if (typeof doc.extraSocial === 'boolean') { if (doc.extraSocial) out.push([EXTRA_LABELS.extraSocial, 'כן']); }
  else if (text(doc.extraSocial)) out.push([EXTRA_LABELS.extraSocial, moneyText(doc.extraSocial) || text(doc.extraSocial)]);
  for (const [k, v] of Object.entries(doc)) {
    if (SHOWN.has(k)) continue;
    if (typeof v === 'boolean') out.push([k, v ? 'כן' : 'לא']);
    else if (text(v)) out.push([k, text(v)]);
  }
  return out;
}

// Pictures among the sketches (only PNG, JPEG, GIF or WebP drawn in the page), and their words.
const PIC_RE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
export function sketchesOf(v) {
  const items = Array.isArray(v) ? v : v ? [v] : [];
  const pics = [];
  const words = [];
  for (const x of items) {
    const s = typeof x === 'string' ? x : x && typeof x === 'object' ? (x.src ?? x.url ?? x.data ?? x.image ?? null) : null;
    if (typeof s === 'string' && PIC_RE.test(s) && s.length < 2_000_000) pics.push(s);
    else if (typeof x === 'string' && x.trim() && !x.startsWith('data:')) words.push(x.trim());
    else if (x && typeof x === 'object') listOf(x).forEach((i) => words.push([i.title, i.text].filter(Boolean).join(': ')));
  }
  return { pics, words };
}
