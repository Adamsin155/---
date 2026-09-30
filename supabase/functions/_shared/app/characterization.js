// generated — edit app/ instead. Source: app/characterization.js. Regenerate: node scripts/sync-functions.mjs
// Ending a characterization and its full form (docs/plan/system-plan.md, section 3,
// Ofir: "סיום אפיון"; section 4, station 2; decision 12). Pure: no DOM and no
// network, so node tests it and the screens (intake.html) use it.
//
//   1. "האפיון הסתיים": one tap at the end of the meeting with 4 short required
//      fields: the address, the business phone, has a logo (yes / no), and the
//      access of each network (straight into the vault, each with its own status).
//      It is recorded as the mark p04.ended (protocol-logic.js, CHAR_ENDED), which
//      starts the clocks of Ilai (6, 7, 9), Ofir (8, highlights) and Lior (10,
//      Meta) at once; access given marks 5's "access received" (Ilai's 30 minutes).
//   2. The full form, within 60 minutes (p04's deadline moves to the mark + 60):
//      11 fields, plus the logo link, the brand colors and the materials. Stored
//      as content (public.characterizations); when all 11 are filled it checks
//      process 4's items and closes Irit's follow-up (her section 5) by itself.
//      Missing material opens one task for Irit with a ready message to the client;
//      when it blocks today's work, an exception rings Lior too.
import { NETWORKS, PEOPLE } from './protocol.js';
import { CHAR_ENDED, addBusinessDays } from './protocol-logic.js';
import { dayKeyIL } from './tz.js';
import { fillTemplate, listText, DEFAULT_TEMPLATES } from './messages-logic.js';

export { CHAR_ENDED };

// Notes of the marks the form sets by itself (the timeline shows them as automatic).
export const AUTO_NOTE = 'נסגר אוטומטית מטופס האפיון';
export const ENDED_NOTE_PREFIX = 'האפיון הסתיים';

// The vault's statuses, as Ofir picks them per network at the end of the meeting.
export const ACCESS_STATUS = [
  ['ok', 'יש גישה תקינה'], ['broken', 'יש גישה, לא עובדת'], ['missing', 'אין רשת'],
];
// The networks offered first; the rest of NETWORKS behind "עוד רשת".
export const MAIN_NETWORKS = ['instagram', 'facebook', 'tiktok'];
export const networkName = (k) => NETWORKS.find(([n]) => n === k)?.[1] || k;

// The 11 fields of process 4, in the protocol's order, each with the item it checks.
export const FORM_FIELDS = [
  { key: 'address', item: 'p04.address', label: 'כתובת מלאה של העסק', short: true, hint: 'רחוב, מספר, עיר. קומה או כניסה אם צריך.' },
  { key: 'phone', item: 'p04.phone', label: 'טלפון העסק', short: true, tel: true, hint: 'המספר שמופיע בסגיר של הסרטונים ובגרפיקות.' },
  { key: 'services', item: 'p04.services', label: 'שירותים ומוצרים' },
  { key: 'audiences', item: 'p04.audiences', label: 'קהלי יעד' },
  { key: 'advantages', item: 'p04.advantages', label: 'יתרונות העסק' },
  { key: 'goals', item: 'p04.goals', label: 'מטרות השיווק' },
  { key: 'offers', item: 'p04.offers', label: 'מבצעים ומחירים' },
  { key: 'content', item: 'p04.content', label: 'צרכים לתוכן' },
  { key: 'graphics', item: 'p04.graphics', label: 'צרכים לגרפיקה' },
  { key: 'campaigns', item: 'p04.campaigns', label: 'צרכים לקמפיינים' },
  { key: 'special', item: 'p04.special', label: 'דגשים מיוחדים' },
];
// Process 4's own items the complete form closes as well: "saved in full", and
// Irit's two verifications (her section 5: the system knows the form is saved and
// that the clocks of 5–10 started at the tap).
export const FORM_DONE_ITEMS = ['p04.saved'];
export const FOLLOWUP_ITEMS = ['p04.followup', 'p04.tasks'];

// The materials of process 5: each received, missing, or not relevant for this client.
export const MATERIALS = [
  { key: 'photos', item: 'p05.photos', label: 'תמונות' },
  { key: 'videos', item: 'p05.videos', label: 'סרטונים קיימים' },
  { key: 'menu', item: 'p05.menu', label: 'תפריט או מחירון', optional: true },
];
export const MATERIAL_STATES = [['got', 'התקבל'], ['missing', 'חסר'], ['none', 'אין / לא רלוונטי']];

const clean = (v) => String(v ?? '').trim();

// An Israeli business number: a landline or mobile (0…, 9–10 digits, also as
// +972…), a 1-700/1-800 number, or a *1234 short number.
export function normalizePhone(v) {
  let d = clean(v).replace(/[^\d*+]/g, '');
  if (d.startsWith('+972')) d = `0${d.slice(4)}`;
  else if (d.startsWith('972') && d.length >= 11) d = `0${d.slice(3)}`;
  return d.replace(/\+/g, '');
}
export function validPhone(v) {
  const d = normalizePhone(v);
  return /^0\d{8,9}$/.test(d) || /^1[5-9]00\d{6}$/.test(d) || /^\*\d{4}$/.test(d);
}
// A link as the card keeps it (never with a password in it).
export function validUrl(v) {
  const s = clean(v);
  if (!s) return false;
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
  } catch { return false; }
}

// ── 1. "האפיון הסתיים" ─────────────────────
// The 4 required fields: { address, phone, has_logo (true/false), networks:
// [{ network, status }] with at least one network given a status }.
// Returns the problems, by field, in plain Hebrew (empty when it can be saved).
export function endedProblems(v) {
  const out = {};
  if (clean(v.address).length < 4) out.address = 'חסרה כתובת העסק.';
  if (!clean(v.phone)) out.phone = 'חסר טלפון העסק.';
  else if (!validPhone(v.phone)) out.phone = 'הטלפון לא נראה תקין. למשל \u206603-1234567\u2069 או \u2066050-1234567\u2069.';
  if (v.has_logo !== true && v.has_logo !== false) out.has_logo = 'לבחור אם יש ללקוח לוגו.';
  const given = (v.networks || []).filter((n) => n && n.status);
  if (!given.length) out.networks = 'לבחור לפחות רשת אחת ומה מצב הגישה אליה (גם ״אין רשת״).';
  return out;
}

// The note of the p04.ended mark: what was given, in words (the history shows it).
export function endedNote(v) {
  const nets = (v.networks || []).filter((n) => n.status)
    .map((n) => `${networkName(n.network)}: ${ACCESS_STATUS.find(([k]) => k === n.status)?.[1] || n.status}`);
  return `${ENDED_NOTE_PREFIX} · לוגו: ${v.has_logo ? 'יש' : 'אין'} · ${nets.join(', ')}`.slice(0, 2000);
}

// What the tap checks besides the mark itself (process 5): the access was received
// and is in the vault (when it went there), and "the logo" is not relevant when
// there is none (Ilai makes one, 5's new logo).
export function endedChecks(v, { inVault = true } = {}) {
  const out = [];
  const given = (v.networks || []).filter((n) => n.status);
  if (given.length) out.push({ key: 'p05.access', state: 'done', note: `מסיום האפיון: ${given.map((n) => networkName(n.network)).join(', ')}` });
  if (given.length && inVault) out.push({ key: 'p05.vault', state: 'done', note: 'נכנס לכספת בסיום האפיון' });
  if (v.has_logo === false) out.push({ key: 'p05.logo', state: 'na', note: 'אין ללקוח לוגו: עילאי מכין לוגו חדש' });
  return out;
}

// The client's details the tap updates (the office's own columns).
export const endedClientFields = (v) => ({ address: clean(v.address), has_logo: v.has_logo });

// ── 2. The full form ───────────────────────
// fields: { address, phone, services, …, special, logo_url, colors,
//           materials: { photos: 'got'|'missing'|'none', … }, blocking: bool, blocking_what }
export function formProblems(f) {
  const out = {};
  if (clean(f.phone) && !validPhone(f.phone)) out.phone = 'הטלפון לא נראה תקין.';
  if (clean(f.logo_url) && !validUrl(f.logo_url)) out.logo_url = 'קישור ללוגו צריך להתחיל ב־https:// (בלי סיסמה בקישור).';
  return out;
}
// The 11 fields still empty (the form is complete when none are, and the phone is valid).
export const missingFields = (f) => FORM_FIELDS.filter((x) => !clean(f?.[x.key]));
export const isComplete = (f) => missingFields(f).length === 0 && validPhone(f.phone) && !Object.keys(formProblems(f)).length;
export const filledCount = (f) => FORM_FIELDS.length - missingFields(f).length;

// What is missing from the client after the meeting: the logo (when there is one
// but no link yet), the brand colors, and every material marked missing.
export function missingMaterials(f, hasLogo) {
  const out = [];
  if (hasLogo !== false && !clean(f.logo_url)) out.push('לוגו');
  if (!clean(f.colors)) out.push('צבעי המותג');
  for (const m of MATERIALS) if (f.materials?.[m.key] === 'missing') out.push(m.label);
  return out;
}

// The protocol items the saved form checks, from what it holds now. Only what is
// not yet resolved is returned, so saving twice changes nothing.
export function formChecks(f, checks = {}, { hasLogo = null } = {}) {
  const want = [];
  const open = (k) => !checks[k] || (checks[k].state !== 'done' && checks[k].state !== 'na');
  for (const x of FORM_FIELDS) if (clean(f[x.key]) && (x.key !== 'phone' || validPhone(f.phone))) want.push({ key: x.item, state: 'done', note: null });
  if (isComplete(f)) {
    for (const k of FORM_DONE_ITEMS) want.push({ key: k, state: 'done', note: null });
    for (const k of FOLLOWUP_ITEMS) want.push({ key: k, state: 'done', note: AUTO_NOTE });
  }
  if (hasLogo !== false && validUrl(f.logo_url)) want.push({ key: 'p05.logo', state: 'done', note: null });
  if (clean(f.colors)) want.push({ key: 'p05.colors', state: 'done', note: null });
  for (const m of MATERIALS) {
    const st = f.materials?.[m.key];
    if (st === 'got') want.push({ key: m.item, state: 'done', note: null });
    if (st === 'none') want.push({ key: m.item, state: 'na', note: 'לא רלוונטי ללקוח (מטופס האפיון)' });
  }
  return want.filter((w) => open(w.key));
}

// The ready message to the client about what is still missing (the office's
// "מצב החומרים והגישות" template, with the count filled in).
const ACCESS_TEMPLATE = DEFAULT_TEMPLATES.find((t) => t.key === 'access');
export function missingMessage(client, missing, got, of, template = ACCESS_TEMPLATE?.body) {
  return fillTemplate(template || '', {
    'לקוח': client.name, 'עסק': client.business || client.name,
    'התקבלו': got, 'מתוך': of, 'חסר': listText(missing),
  });
}

// Missing material: one task for Irit, due the next business day (the matrix:
// "חומר חסר שלא חוסם · עירית · יום העסקים הבא"), whose title says what to ask for.
export const MISSING_TITLE = 'להשלים מהלקוח';
export function missingTask(client, missing, now = new Date()) {
  return {
    client_id: client.id, owner: 'irit', title: `${MISSING_TITLE}: ${listText(missing)}`.slice(0, 500),
    due_on: dayKeyIL(addBusinessDays(now, 1)), urgent: false,
  };
}
// When it blocks today's work: an exception that rings Lior at once (reminder-rules.js).
export const BLOCKING_TITLE = 'חסר מידע שחוסם עבודה היום';
export function blockingTask(client, what, missing) {
  const detail = clean(what) || listText(missing);
  return {
    client_id: client.id, owner: 'lior', source: 'escalation', urgent: false,
    title: `${BLOCKING_TITLE}: ${detail}`.slice(0, 500), due_on: null,
  };
}

// ── Reading what was saved (for the editors' page and the client card) ──
// The characterization row may be missing (not saved yet, or the table not there).
export const businessPhoneOf = (row) => clean(row?.fields?.phone) || null;
export const logoUrlOf = (row) => (validUrl(row?.fields?.logo_url) ? clean(row.fields.logo_url) : null);
export const addressOf = (row, client) => clean(row?.fields?.address) || clean(client?.address) || null;
// The closing line of the videos (editors.md: "לפרטים נוספים התקשרו" and the number).
export const closingLine = (phone) => (phone ? `לפרטים נוספים התקשרו: ${phone}` : null);

// A draft on the phone (the full form, typed or dictated near the client): kept per
// client in the browser, restored when the page opens again. Only newer than what
// the server has; never the vault.
export const DRAFT_KEY = (clientId) => `charform.${clientId}`;
export function readDraft(raw) {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && v.fields && typeof v.fields === 'object' ? { fields: v.fields, at: v.at || null } : null;
  } catch { return null; }
}
export const draftText = (fields, at = new Date()) => JSON.stringify({ fields, at: new Date(at).toISOString() });
// Whether a draft should be offered over the saved row: it holds something the row
// does not, and was not written before the row was saved (a save clears the draft,
// so a draft left over is typing that was never saved).
export function draftWins(draft, row) {
  if (!draft) return false;
  const saved = row?.fields || {};
  const differs = Object.keys(draft.fields).some((k) => JSON.stringify(draft.fields[k] ?? '') !== JSON.stringify(saved[k] ?? ''));
  if (!differs) return false;
  return !row?.at || !draft.at || new Date(draft.at) >= new Date(row.at);
}

export const characterizerName = (client) => PEOPLE[client?.characterizer || 'ofir']?.name || 'אופיר';
