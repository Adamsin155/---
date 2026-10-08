// generated — edit app/ instead. Source: app/access-logic.js. Regenerate: node scripts/sync-functions.mjs
// The client's "social network logins" form (access.html; the owner's request of
// 6.10.2026) as pure logic: no DOM, no network. The page (app/access-form.js), the
// client card's block (app/access-link-ui.js), the message queue, Ofir's "האפיון
// הסתיים" form, the reminder rules and the unit tests read the same functions.
//
// The office makes a secret link per client (public.access_link_create in
// supabase/migrations/20261008100000_client_access_form.sql); the client opens it,
// fills the user names and passwords, and sends ONCE. The page is write-only: the
// database (public.access_form_submit) checks the same rules again, puts every
// password straight into Vault and the rest into the existing access vault
// (public.client_access), and never gives anything back.
//
// What the client chooses, and what it becomes in the vault:
//   'have'   "יש לי פרטי כניסה"         → status 'new'     (received from the client, not checked yet)
//   'none'   "אין כיום, צריך לפתוח"      → status 'missing' (Ilai opens the page, as today)
//   'reset'  "יש, וצריך לחדש סיסמה"      → status 'broken'  (Lior restores it with the client, as today)
import { partsIL } from './tz.js';

// ── The link ────────────────────────────────
// 32 random bytes, base64url (the database makes it).
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const LINK_DAYS = 14;
// The token rides in the address's fragment (#t=…): a browser never sends a fragment
// to the server that hosts the page, nor in a Referer, so it reaches no log. An
// address with ?t=… is read too.
export const accessUrl = (base, token) => `${new URL('access.html', base).href}#t=${encodeURIComponent(token)}`;
export function tokenFrom({ hash = '', search = '' } = {}) {
  const fromHash = new URLSearchParams(String(hash).replace(/^#/, '')).get('t');
  return fromHash || new URLSearchParams(search).get('t') || '';
}
// The page refuses to work over http:// (a password must not travel in the clear).
// A developer's own machine is the one exception.
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
export const insecure = ({ protocol, hostname } = {}) => protocol !== 'https:' && !LOCAL.has(String(hostname || ''));
export const secureUrl = ({ host, pathname = '', search = '', hash = '' }) => `https://${host}${pathname}${search}${hash}`;

// A token in a text that is kept (the record of a sent message): the address stays,
// the token does not.
export const redactAccessLinks = (text) => String(text ?? '').replace(/(access\.html[#?]t=)[A-Za-z0-9_-]{20,}/g, '$1…');
export const hasRedactedLink = (text) => /access\.html[#?]t=…/.test(String(text ?? ''));

// "נשמרה גישה ל־Instagram בלבד. יש עוד רשתות?" (protocol v8, the item p05.allnets). The
// system does not hold the list of the client's networks; what it knows is what was
// saved when "access received" was marked, which that mark's note names (the end of the
// characterization, app/characterization.js endedChecks; or the client's own form).
// Marked by hand, with no names: the plain question.
export function accessGapQuestion(check) {
  const m = /^(?:מסיום האפיון|מהלקוח, בטופס פרטי הכניסה): (.+)$/.exec(String(check?.note || '').trim());
  const names = m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : [];
  if (!names.length) return 'יש ללקוח עוד רשתות שחסרה להן גישה?';
  return `נשמרה גישה ל־${names.join(', ')}${names.length === 1 ? ' בלבד' : ''}. יש עוד רשתות?`;
}

// Where a link stands: 'none' (no link yet), 'waiting' (sent, not filled), 'filled',
// 'expired', 'revoked', 'locked' (too many refused attempts).
export const MAX_ATTEMPTS = 5;
export function linkState(link, now = new Date()) {
  if (!link) return 'none';
  if (link.submitted_at) return 'filled';
  if (link.revoked_at) return 'revoked';
  if ((link.attempts || 0) >= MAX_ATTEMPTS) return 'locked';
  if (new Date(link.expires_at) <= now) return 'expired';
  return 'waiting';
}
// The link the card and the queue show: the newest one, or the one filled last when
// a newer link was only made and revoked.
export function currentLink(links = [], now = new Date()) {
  const sorted = [...(links || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return sorted.find((l) => linkState(l, now) === 'waiting') || sorted.find((l) => l.submitted_at) || sorted[0] || null;
}
export const waitingLink = (links = [], now = new Date()) => (links || []).find((l) => linkState(l, now) === 'waiting') || null;

// ── The platforms ───────────────────────────
// The three the form cannot be sent without.
export const REQUIRED = ['instagram', 'facebook', 'tiktok'];
// What "הוספת פלטפורמה" offers. `network` is the vault's own key (client_access.network);
// what the vault has no key for is kept as 'other' with its name as the label.
export const EXTRA_PLATFORMS = [
  { key: 'youtube', label: 'YouTube', network: 'youtube' },
  { key: 'google', label: 'Google Business', network: 'google' },
  { key: 'meta', label: 'Meta Business', network: 'meta' },
  { key: 'linkedin', label: 'LinkedIn', network: 'other' },
  { key: 'site', label: 'אתר / דומיין', network: 'other' },
  { key: 'custom', label: 'אחר', network: 'other', free: true },
];
export const NETWORK_NAMES = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', google: 'Google Business', meta: 'Meta Business', other: 'אחר' };
export const platformName = (network, label = null) => (network === 'other' ? (clean(label) || NETWORK_NAMES.other) : NETWORK_NAMES[network] || network);
const EXTRA_NETWORKS = new Set(['youtube', 'google', 'meta', 'other']);

export const CHOICES = [
  ['have', 'יש לי פרטי כניסה'],
  ['none', 'אין כיום, צריך לפתוח'],
  ['reset', 'יש, וצריך לחדש סיסמה'],
];
export const CHOICE_LABEL = Object.fromEntries(CHOICES);
// What the office reads for each choice (the card, Ofir's form, Irit's note).
export const CHOICE_OFFICE = { have: 'התקבלו פרטי כניסה', none: 'אין כיום, צריך לפתוח', reset: 'צריך לחדש סיסמה' };
export const STATUS_OF = { have: 'new', none: 'missing', reset: 'broken' };

// The vault's statuses, with the one this form adds ('new').
export const NEW_STATUS = 'new';
export const ACCESS_STATUS_LABEL = { ok: 'תקינה', broken: 'לא עובדת', missing: 'אין רשת', new: 'התקבל מהלקוח, עוד לא נבדק' };
export const accessStatusLabel = (s) => ACCESS_STATUS_LABEL[s] || s || '';
// Who set a row or a log line when it was the client's form (client_access.updated_by,
// client_access_log.by_email): never an email.
export const CLIENT_BY = 'client-form';
export const CLIENT_BY_NAME = 'הלקוח (בטופס)';
// A row the client's form set and nobody of the office touched since: its status is
// the client's word, not a check.
export const byClient = (row) => row?.by_client === true || row?.updated_by === CLIENT_BY;

// ── Limits (the database holds to the same) ──
export const MAX_ENTRIES = 12;
export const LABEL_MAX = 40;
export const USER_MAX = 200;
export const PASS_MAX = 200;
// Short on purpose (6.10.2026, ops.md section 36): the notes say who gets the
// verification code, and are not a place for a password.
export const NOTES_MAX = 300;

const clean = (v) => String(v ?? '').trim();
// Control characters (a pasted line break, a tab) are never part of a login.
const CONTROL = /[\u0000-\u001f\u007f]/;

// ── The form on the page ────────────────────
// { main: { instagram: { choice, username, password }, … },
//   extra: [{ id, platform ('' | a key of EXTRA_PLATFORMS), label, username, password }],
//   notes }
export const emptyForm = () => ({
  main: Object.fromEntries(REQUIRED.map((n) => [n, { choice: '', username: '', password: '' }])),
  extra: [],
  notes: '',
});
export const canAddExtra = (form) => REQUIRED.length + form.extra.length < MAX_ENTRIES;
const extraSpec = (x) => EXTRA_PLATFORMS.find((p) => p.key === x.platform) || null;
const extraNetwork = (x) => extraSpec(x)?.network || null;
const extraLabel = (x) => { const s = extraSpec(x); return !s || s.network !== 'other' ? null : s.free ? clean(x.label) : s.label; };
const entryKey = (network, label) => `${network}:${clean(label).toLowerCase()}`;

function loginProblems(v, { user = true, pass = true } = {}) {
  const out = {};
  const u = clean(v.username);
  if (user && !u) out.username = 'חסר שם משתמש.';
  else if (u.length > USER_MAX) out.username = `שם המשתמש ארוך מדי (עד ${USER_MAX} תווים).`;
  else if (CONTROL.test(u)) out.username = 'שם המשתמש צריך להיות בשורה אחת.';
  if (pass) {
    const p = String(v.password ?? '');
    if (!p.trim()) out.password = 'חסרה סיסמה.';
    else if (p.length > PASS_MAX) out.password = `הסיסמה ארוכה מדי (עד ${PASS_MAX} תווים).`;
    else if (CONTROL.test(p)) out.password = 'הסיסמה צריכה להיות בשורה אחת.';
  }
  return out;
}

// The problems of one mandatory card ({} when it is complete).
export function mainProblems(v) {
  if (!CHOICE_LABEL[v?.choice]) return { choice: 'בחרו אחת משלוש האפשרויות.' };
  if (v.choice === 'have') return loginProblems(v);
  if (v.choice === 'reset') return loginProblems(v, { user: false, pass: false });
  return {};
}
// The problems of one added card; `others` are the cards before it (no platform twice).
export function extraProblems(x, others = []) {
  const out = {};
  const spec = extraSpec(x);
  if (!spec) out.platform = 'בחרו פלטפורמה.';
  else if (spec.free) {
    const l = clean(x.label);
    if (!l) out.label = 'כתבו את שם הפלטפורמה.';
    else if (l.length > LABEL_MAX) out.label = `השם ארוך מדי (עד ${LABEL_MAX} תווים).`;
    else if (CONTROL.test(l)) out.label = 'השם צריך להיות בשורה אחת.';
  }
  if (spec && !out.label) {
    const key = entryKey(spec.network, extraLabel(x));
    const taken = others.some((o) => extraSpec(o) && entryKey(extraNetwork(o), extraLabel(o)) === key);
    const main = spec.network === 'other' && REQUIRED.some((n) => NETWORK_NAMES[n].toLowerCase() === clean(extraLabel(x)).toLowerCase());
    if (taken || main) out[spec.free ? 'label' : 'platform'] = 'הפלטפורמה הזו כבר ברשימה.';
  }
  return { ...out, ...loginProblems(x) };
}

// Everything wrong with the form, by field id ('instagram.choice', 'x3.password',
// 'notes'), and what the send button waits for.
export function formProblems(form) {
  const errors = {};
  const missing = [];
  for (const n of REQUIRED) {
    const p = mainProblems(form.main[n]);
    for (const [k, msg] of Object.entries(p)) errors[`${n}.${k}`] = msg;
    if (Object.keys(p).length) missing.push(NETWORK_NAMES[n]);
  }
  form.extra.forEach((x, i) => {
    for (const [k, msg] of Object.entries(extraProblems(x, form.extra.slice(0, i)))) errors[`${x.id}.${k}`] = msg;
  });
  if (String(form.notes ?? '').length > NOTES_MAX) errors.notes = `ההערות ארוכות מדי (עד ${NOTES_MAX} תווים).`;
  return { errors, missing, mainOk: !missing.length, ok: !Object.keys(errors).length };
}
// The line under the send button while it waits.
export const waitingText = (missing) => (missing.length ? `כדי להמשיך חסר: ${missing.join(', ')}.` : '');

// What goes to the database: only what each choice needs (a password typed and then
// "אין כיום" chosen is not sent).
export function buildPayload(form) {
  const entries = REQUIRED.map((n) => {
    const v = form.main[n];
    return {
      network: n, label: null, choice: v.choice,
      username: v.choice === 'have' || v.choice === 'reset' ? (clean(v.username) || null) : null,
      password: v.choice === 'have' ? String(v.password ?? '') : null,
    };
  });
  for (const x of form.extra) {
    entries.push({ network: extraNetwork(x), label: extraLabel(x), choice: 'have', username: clean(x.username), password: String(x.password ?? '') });
  }
  return { entries, notes: clean(form.notes) || null };
}

// The same checks as private.access_form_problem() in the database, on a payload:
// null when it may be saved, else a short reason (never shown to the client as is).
const ENTRY_KEYS = new Set(['network', 'label', 'choice', 'username', 'password']);
const textOrNull = (v) => v === null || v === undefined || typeof v === 'string';
export function payloadProblem(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'payload';
  if (Object.keys(p).some((k) => k !== 'entries' && k !== 'notes')) return 'unknown field';
  if (!Array.isArray(p.entries)) return 'entries';
  if (p.entries.length < REQUIRED.length || p.entries.length > MAX_ENTRIES) return 'entries count';
  if (!textOrNull(p.notes)) return 'notes';
  if (String(p.notes ?? '').length > NOTES_MAX) return 'notes too long';
  const seen = new Set();
  for (const e of p.entries) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return 'entry';
    if (Object.keys(e).some((k) => !ENTRY_KEYS.has(k))) return 'unknown field';
    if (![e.network, e.label, e.choice, e.username, e.password].every(textOrNull)) return 'entry type';
    const main = REQUIRED.includes(e.network);
    if (!main && !EXTRA_NETWORKS.has(e.network)) return 'network';
    const label = clean(e.label);
    if (e.network === 'other') {
      if (!label || label.length > LABEL_MAX || CONTROL.test(label)) return 'label';
    } else if (label) return 'label';
    if (!CHOICE_LABEL[e.choice] || (!main && e.choice !== 'have')) return 'choice';
    const user = clean(e.username);
    const pass = String(e.password ?? '');
    if (user.length > USER_MAX || CONTROL.test(user)) return 'username';
    if (e.choice === 'have') {
      if (!user) return 'username';
      if (!pass.trim() || pass.length > PASS_MAX || CONTROL.test(pass)) return 'password';
    } else {
      if (pass) return 'password';
      if (e.choice === 'none' && user) return 'username';
    }
    const key = entryKey(e.network, label);
    if (seen.has(key)) return 'duplicate';
    seen.add(key);
  }
  if (!REQUIRED.every((n) => seen.has(entryKey(n, '')))) return 'required';
  return null;
}

// What is kept of a submission besides the vault's rows: the platforms and the
// choices only (client_access_links.summary). Never a user name or a password.
export const summaryOf = (payload) => (payload?.entries || []).map((e) => ({ network: e.network, label: clean(e.label) || null, choice: e.choice }));
// The confirmation step, one line per platform: the choice, and the user name when
// one was typed. Never a password.
export function confirmLines(payload) {
  return (payload?.entries || []).map((e) => ({
    platform: platformName(e.network, e.label),
    choice: CHOICE_LABEL[e.choice] || e.choice,
    username: e.choice === 'none' ? null : (clean(e.username) || null),
    password: e.choice === 'have',
  }));
}
// "Instagram, Facebook: התקבלו פרטי כניסה · TikTok: אין כיום, צריך לפתוח" (the office's words).
export function summaryText(summary = []) {
  const parts = [];
  for (const [choice] of CHOICES) {
    // `beside`: the vault already held a login the office saved, so the client's went
    // into a row of its own next to it (access_form_submit; nothing was replaced).
    const names = (summary || []).filter((s) => s.choice === choice).map((s) => platformName(s.network, s.label) + (s.beside ? ' (בשורה נפרדת, הקיים נשמר)' : ''));
    if (names.length) parts.push(`${names.join(', ')}: ${CHOICE_OFFICE[choice]}`);
  }
  return parts.join(' · ');
}
// What the client sent for one of the vault's networks (Ofir's form), or null.
export const sentFor = (summary, network) => (summary || []).find((s) => s.network === network && network !== 'other') || null;

// ── The words on the page ───────────────────
export const PAGE_TEXT = {
  title: 'פרטי הכניסה לרשתות החברתיות',
  why: 'כדי שנוכל לנהל עבורכם את העמודים, לפרסם ולהריץ קמפיינים, אנחנו צריכים את שם המשתמש והסיסמה של כל רשת.',
  points: [
    'הפרטים נשמרים מוצפנים.',
    'רק אנשי הצוות שמטפלים בחשבון שלכם יכולים לפתוח אותם, וכל פתיחה נרשמת.',
    'אחרי השליחה אי אפשר לקרוא את הפרטים מהדף הזה, גם לא עם הקישור.',
  ],
  notesHint: 'למשל: למי מגיע קוד האימות, או חשבון שמנוהל דרך חשבון אחר.',
  notesWarn: 'אל תכתבו כאן סיסמאות. סיסמה נכתבת רק בשדה הסיסמה של הפלטפורמה, ורק שם היא נשמרת מוצפנת.',
  thanksTitle: 'תודה! הפרטים התקבלו',
  thanks: 'הפרטים נשמרו מוצפנים, ואנחנו ממשיכים מכאן. אפשר לסגור את הדף.',
};
export const CLOSED_TEXT = {
  invalid: ['הקישור אינו תקין', 'ייתכן שהקישור הועתק באופן חלקי. בקשו מאיתנו לשלוח אותו שוב.'],
  expired: ['תוקף הקישור הסתיים', 'מטעמי אבטחה הקישור תקף ל־14 יום. בקשו מאיתנו קישור חדש, ונשלח אותו מיד.'],
  revoked: ['הקישור הזה כבר לא פעיל', 'שלחנו לכם קישור חדש, או שהקישור בוטל. בקשו מאיתנו את הקישור העדכני.'],
  closed: ['הקישור הזה כבר לא פעיל', 'לכל שאלה אפשר לפנות אלינו.'],
  locked: ['הקישור ננעל', 'היו כמה ניסיונות שליחה שלא התקבלו, ולכן נעלנו את הקישור. בקשו מאיתנו קישור חדש.'],
  done: ['הפרטים התקבלו', ''],
  insecure: ['פתחו את הקישור בכתובת מאובטחת', 'הדף עובד רק בכתובת שמתחילה ב־https. מעבירים אתכם אליה עכשיו.'],
  error: ['לא הצלחנו לטעון את הדף', 'בדקו את החיבור לאינטרנט ורעננו את העמוד.'],
};
export const SEND_ERRORS = {
  network: 'השליחה לא הצליחה. בדקו את החיבור לאינטרנט ונסו שוב. מה שמילאתם נשאר בדף.',
  refused: 'חלק מהפרטים לא התקבלו. בדקו את השדות המסומנים ונסו שוב.',
  staff: 'אתם מחוברים כאנשי צוות: הדף הזה הוא תצוגה, ורק הלקוח שולח אותו.',
};

// ── The office's words ──────────────────────
const pad = (n) => String(n).padStart(2, '0');
const dayIL = (v) => { const p = partsIL(new Date(v)); return { day: `${p.day}.${p.month}.${p.year}`, time: `${pad(p.hour)}:${pad(p.minute)}` }; };
export const dateWords = (v) => dayIL(v).day;
// The state line of the card's block.
export function linkStateText(link, now = new Date()) {
  switch (linkState(link, now)) {
    case 'none': return 'עוד לא נוצר קישור.';
    case 'waiting': return `ממתין ללקוח מאז ${dateWords(link.created_at)} · הקישור תקף עד ${dateWords(link.expires_at)}.`;
    case 'filled': return `מולא ב־${dateWords(link.submitted_at)} בשעה ${dayIL(link.submitted_at).time}.`;
    case 'expired': return `תוקף הקישור הסתיים ב־${dateWords(link.expires_at)}, והלקוח לא מילא.`;
    case 'revoked': return `הקישור בוטל ב־${dateWords(link.revoked_at)}.`;
    case 'locked': return 'הקישור ננעל אחרי כמה ניסיונות שליחה שלא התקבלו. צריך קישור חדש.';
    default: return '';
  }
}

// The message with the link, from the card (WhatsApp, by link only).
export const ACCESS_LINK_TEMPLATE = `היי {לקוח}, כדי שנוכל להתחיל לעבוד על הרשתות שלכם, מלאו בקישור המאובטח את פרטי הכניסה:
{קישור}
הפרטים נשמרים מוצפנים, ורק אנשי הצוות שמטפלים בחשבון רואים אותם. הקישור אישי ותקף ל־14 יום.`;
export const accessLinkMessage = (client, url) => ACCESS_LINK_TEMPLATE.replace('{לקוח}', client?.name || '').replace('{קישור}', url);

// The welcome message (the 'welcome' template of app/messages-logic.js): one line,
// where the template says {פרטי כניסה}; a template without it (one the office
// edited before this form existed) gets the line at its end when there is a link.
export const ACCESS_VAR = 'פרטי כניסה';
export const accessLine = (url) => `כדי שנוכל להתחיל, מלאו כאן את פרטי הכניסה לרשתות: ${url}`;
export const ACCESS_FALLBACK = 'נקבל אותן מכם בשיחה, או בקישור מאובטח שנשלח לכם.';
export function withAccessVar(body, url) {
  const s = String(body ?? '');
  return url && !s.includes(`{${ACCESS_VAR}}`) ? `${s.replace(/\s+$/, '')}\n\n{${ACCESS_VAR}}` : s;
}
export const accessVars = (url) => ({ [ACCESS_VAR]: url ? accessLine(url) : ACCESS_FALLBACK });

