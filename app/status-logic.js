// The client's status page (status.html; docs/plan/system-plan.md, section 7 and
// stage 4; decisions 26–30) as pure logic: no DOM, no network, Israel time only
// (tz.js). The page, the client card's block (app/status-link-ui.js) and the unit
// tests read the same functions.
//
// The page gets what the database lets a client see (public.get_status in
// supabase/migrations/20260930170000_client_status.sql): the client's dates, the
// state of a short list of protocol marks (MARKS: what the client did or received,
// never an internal check, note or who), the items waiting for approval, the
// client's own approvals, the last Thursday update sent to them, and which
// questions are open. From these it shows, in the client's words:
//   - the 8 stations and where the work is (stationOf),
//   - the next 3 dates we PROMISED (section 4, ה1–ה12), never an internal target,
//     never who is late; a promised date already passed is not repeated,
//   - "מה אנחנו צריכים ממך",
//   - the words above "מאשר/ת" and "מבקש/ת תיקון" (the legal drafts, section 4),
//     the same as private.status_wording() in the database, which refuses any other.
// The legal texts here are drafts awaiting a lawyer's review (docs/ops.md, section 13).
import { PEOPLE, WORK_HOURS } from './protocol.js';
import { addBusinessDays, isBusinessDay, parseDate } from './protocol-logic.js';
import { startOfDayIL, endOfDayIL, addDaysIL } from './tz.js';
import { CLIENT_ROLES, dayText, timeText, promisedClosing, fillTemplate } from './messages-logic.js';

// ── The link ────────────────────────────────
// 32 random bytes, base64url (the database makes it; status_link_create).
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const LINK_DAYS = 180;
export const statusUrl = (base, token) => new URL(`status.html?t=${encodeURIComponent(token)}`, base).href;

// The message the office sends with the link (WhatsApp, by link only).
export const STATUS_LINK_TEMPLATE = `היי {לקוח}, זה דף המצב האישי שלכם אצלנו:
{קישור}
שם רואים איפה אנחנו עומדים, מה התאריכים הקרובים ומה צריך מכם, ואפשר גם לאשר תוצרים או לבקש תיקון.
הקישור אישי: לא להעביר אותו למי שלא מוסמך לאשר בשם העסק.`;
export const statusLinkMessage = (client, url) => fillTemplate(STATUS_LINK_TEMPLATE, { 'לקוח': client?.name || '', 'קישור': url });

// ── Items for approval ──────────────────────
// Their name, the name after "ל", and where the item goes once approved. The same
// table as private.status_item_text() (tests/sql/status.test.mjs).
export const ITEMS = {
  scripts: { label: 'התסריטים ליום הצילום', lamed: 'לתסריטים ליום הצילום', next: 'ליום הצילום', link: 'פתיחת התסריטים' },
  graphics9: { label: '9 הגרפיקות הראשונות', lamed: 'ל־9 הגרפיקות הראשונות', next: 'לפרסום בעמוד', link: 'פתיחת הגרפיקות' },
  graphics: { label: 'יתרת הגרפיקות', lamed: 'ליתרת הגרפיקות', next: 'לתזמון ולפרסום', link: 'פתיחת הגרפיקות' },
  videos: { label: 'הסרטונים', lamed: 'לסרטונים', next: 'לתזמון ולפרסום', link: 'פתיחת הסרטונים' },
};
export function itemText(item, shootRound = 1, form = 'label') {
  const t = ITEMS[item];
  if (!t) return '';
  return t[form] + (form !== 'next' && Number(shootRound) > 1 ? ` (סבב צילום ${shootRound})` : '');
}
// A name as typed: trimmed, inner runs of spaces made one (private.clean_name).
export const cleanName = (s) => String(s || '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').replace(/[ \t\r\n]+/g, ' ');
export const nameOk = (s) => cleanName(s).length >= 2 && cleanName(s).length <= 120;

// The words above each button. `round` is this round (fixes used + 1); `included`
// the rounds in the package (legal.js: one).
export function wordingFor(decision, { name, business, item, shootRound = 1, round = 1, included = 1 }) {
  const who = cleanName(name);
  if (decision === 'approve') {
    return `אני, ${who}, מאשר/ת בשם ${business} את ${itemText(item, shootRound)}, סבב ${round}, כפי שהוא, כולל נכונות המידע שבו. אחרי האישור הפריט עובר ${itemText(item, shootRound, 'next')}.`;
  }
  if (round <= included) {
    return `אני, ${who}, מבקש/ת תיקון ${itemText(item, shootRound, 'lamed')}. זה סבב ${round} מתוך ${included} הכלולים. כתבו כאן את כל ההערות בבת אחת. הפריט יחזור אלינו לתיקון.`;
  }
  return `אני, ${who}, מבקש/ת תיקון נוסף ${itemText(item, shootRound, 'lamed')}, מעבר לסבבים הכלולים בחבילה. כתבו כאן את כל ההערות בבת אחת. נחזור אליך לפני שמתחילים.`;
}
// Shown when the included rounds were used (the agreement: another round is paid by quote).
export const ROUNDS_USED = 'הסבבים הכלולים בחבילה נוצלו. אפשר לבקש תיקון נוסף, ונחזור אליך לפני שמתחילים.';
// What the client reads after pressing (the legal drafts: "התקבל: …").
export function receiptText(a) {
  const when = a.at ? `${dayText(new Date(a.at))} בשעה ${timeText(new Date(a.at))}` : '';
  const what = itemText(a.item, a.shootRound);
  return a.decision === 'approve'
    ? `התקבל: ${what}, סבב ${a.round}, אושר על ידי ${a.name} ב${when}.`
    : `התקבל: בקשת תיקון ${itemText(a.item, a.shootRound, 'lamed')}, סבב ${a.round}, מ${a.name} ב${when}. נחזור אליך עם הגרסה המתוקנת.`;
}

// ── Surveys (decision 28; the legal drafts, section 5) ──
export const QUESTIONS = {
  shoot: 'שאלה אחת, לא חובה: מ־1 עד 5, איך היה יום הצילום בשבילכם?',
  delivery: 'שאלה אחת, לא חובה: מ־1 עד 5, כמה אתם מרוצים מהסרטונים שקיבלתם?',
  nps: 'שאלה אחת, לא חובה: מ־0 עד 10, כמה סביר שתמליצו על אסטרטג לעסק אחר?',
};
export const SURVEY_NOTE = 'התשובה נשמרת עם השם שלך ועוזרת לנו לשפר את השירות.';
export const SURVEY_TITLES = { shoot: 'יום הצילום', delivery: 'הסרטונים', nps: 'המלצה' };
export const scaleOf = (kind) => (kind === 'nps' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 2, 3, 4, 5]);
// Lior calls: 3 or less of 5, 6 or less of 10. The owner hears too: 2 or less, 4 or less.
export const lowScore = (kind, score) => (kind === 'nps' ? score <= 6 : score <= 3);
export const severeScore = (kind, score) => (kind === 'nps' ? score <= 4 : score <= 2);

// ── The WhatsApp checkbox on the signing page (decision 26; legal section 1) ──
// q.html shows exactly these (tests/status.test.mjs), and the database stores the
// same words with the signature (private.whatsapp_consent_text()).
export const WHATSAPP_CONSENT = {
  label: 'אני מסכים/ה לקבל מאסטרטג עדכוני שירות ב־WhatsApp, בלי פרסום. אפשר להפסיק בכל עת.',
  more: 'תזכורות ליום צילום, "יש אישור שמחכה לך", "בעריכה, צפי X" ושאלת משוב קצרה. ההודעות יגיעו מהמספר העסקי של אסטרטג לטלפון שמסרת, בשעות העבודה. ההסכמה לא חובה ולא משפיעה על ההסכם. להפסקה: השב/י "הסר" או אמור/י לנו.',
};

// ── What the page reads ─────────────────────
// The marks the database returns (private.status_mark_ok).
export const MARKS = /^(r[0-9]+\.)?(p02\.opened|p04\.(ended|saved)|p05\.(access|logo|colors|photos|videos)|p07\.(sent|approved)|p11\.(ok\.client|calendar)|p12\.(scripts|numbered|docs)|p13\.approved|p19\.(all|took)|p23\.(sent|approved)|p26\.sent|p27\.(notes|fixes|final|approved)|p28\.scheduled|p29\.sent|p30\.live|p34\.talk)$/;

// The 8 stations (section 4) in the client's words.
export const STATIONS_CLIENT = [
  { key: 'join', title: 'הצטרפות', text: 'חותמים, פותחים קבוצה וקובעים פגישת אפיון' },
  { key: 'char', title: 'אפיון', text: 'פגישת אפיון, סידור העמוד ו־9 גרפיקות ראשונות' },
  { key: 'content', title: 'תוכן ואישור', text: 'קובעים יום צילום, כותבים תסריטים ומאשרים איתכם' },
  { key: 'shoot', title: 'יום צילום', text: 'מצלמים אצלכם בעסק' },
  { key: 'post', title: 'עריכה ובקרה', text: 'עורכים, בודקים ושולחים לאישורכם' },
  { key: 'publish', title: 'פרסום', text: 'תזמון התכנים, גאנט שנתי וקמפיין' },
  { key: 'ongoing', title: 'שוטף', text: 'תכנים עולים, שיחה שבועית ועדכון בחמישי' },
  { key: 'renewal', title: 'חידוש', text: 'מסכמים תוצאות ומתכננים את ההמשך' },
];

// Helpers over the payload's marks ({ key: { s: 'done' | 'na', at } }).
function view(data, pre = '') {
  const marks = data?.marks || {};
  const m = (k) => marks[pre + k] || null;
  return {
    pre,
    done: (k) => !!m(k) && (m(k).s === 'done' || m(k).s === 'na'),
    at: (k) => (m(k)?.s === 'done' && m(k).at ? new Date(m(k).at) : null),
  };
}
// The business day before the shoot (the day-before message goes out then).
function eveOf(shoot) {
  let d = addDaysIL(shoot, -1);
  while (!isBusinessDay(d)) d = addDaysIL(d, -1);
  return startOfDayIL(d);
}
// The latest extra shoot round while it is under way (started, and not live yet).
function activeRound(data, now) {
  const rounds = (data?.client?.rounds || []).filter((r) => Number(r.n) > 1);
  const r = rounds.reduce((a, b) => (!a || Number(b.n) > Number(a.n) ? b : a), null);
  if (!r) return null;
  const start = parseDate(r.startAt);
  if (start && start > now) return null;
  if (view(data, `r${r.n}.`).done('p30.live')) return null;
  return r;
}
function reached(x, shootAt, charAt, now, floor = 0) {
  let i = floor;
  if ((charAt && charAt <= now) || x.done('p04.ended') || x.done('p04.saved')) i = Math.max(i, 1);
  if (['p11.ok.client', 'p11.calendar', 'p12.scripts', 'p12.numbered', 'p12.docs', 'p13.approved'].some(x.done)) i = Math.max(i, 2);
  if (shootAt && now >= eveOf(shootAt)) i = Math.max(i, 3);
  if (x.done('p19.all') || x.done('p19.took') || (shootAt && now > endOfDayIL(shootAt))) i = Math.max(i, 4);
  if (x.done('p27.approved') || x.done('p27.final')) i = Math.max(i, 5);
  if (x.done('p30.live') && x.done('p28.scheduled') && x.done('p29.sent')) i = Math.max(i, 6);
  return i;
}
const renewalFrom = (data) => { const end = parseDate(data?.client?.contractEnd); return end ? addDaysIL(end, -60) : null; };

// Where the work is (index into STATIONS_CLIENT): the furthest station reached. An
// extra shoot round under way is shown by itself, from "תוכן ואישור".
export function stationOf(data, now = new Date()) {
  const c = data?.client || {};
  if (c.status === 'ending') return 7;
  const r = activeRound(data, now);
  if (r) return reached(view(data, `r${r.n}.`), parseDate(r.shootAt), null, now, 2);
  const renew = renewalFrom(data);
  if (renew && now >= renew) return 7;
  return reached(view(data), parseDate(c.shootAt), parseDate(c.charAt), now);
}

// The next dates we promised (section 4), at most `max`, soonest first. Each
// { key, label, promise, at, when }. Only dates still ahead; nothing late is shown.
export function nextMilestones(data, now = new Date(), max = 3) {
  const c = data?.client || {};
  const r = activeRound(data, now);
  const x = view(data, r ? `r${r.n}.` : '');
  const out = [];
  const today = startOfDayIL(now);
  const add = (key, label, promise, at, exact = false) => {
    if (!at || at < (exact ? now : today)) return;
    out.push({ key, label, promise, at, when: exact ? `${dayText(at)} בשעה ${timeText(at)}` : `עד ${dayText(at)}` });
  };
  const shootAt = parseDate(r ? r.shootAt : c.shootAt);
  if (!r) {
    const charAt = parseDate(c.charAt);
    if (charAt) add('char', 'פגישת האפיון', 'ה1', charAt, true);
    if (charAt && !x.done('p07.sent')) add('page', 'עמוד מסודר ו־9 גרפיקות ראשונות לאישורך', 'ה2', endOfDayIL(charAt));
    if (charAt && !shootAt) add('shootSet', 'קביעת יום הצילום', 'ה4', addBusinessDays(charAt, 3));
    if (charAt && !x.done('p13.approved') && !x.done('p19.all')) add('scripts', 'התסריטים ליום הצילום, לאישורך', 'ה5', addBusinessDays(charAt, 3));
  }
  if (shootAt) add('shoot', r ? `יום הצילום (סבב ${r.n})` : 'יום הצילום', 'ה7', shootAt, true);
  if (shootAt && !x.done('p27.approved') && !x.done('p27.final')) add('videos', 'הסרטונים סגורים, כולל סבב תיקונים', 'ה8', promisedClosing(shootAt));
  const delivered = x.at('p27.approved') || x.at('p27.final');
  if (delivered && !x.done('p30.live')) add('campaign', 'הגאנט השנתי והקמפיין באוויר', 'ה9', addBusinessDays(delivered, 1));
  const renew = renewalFrom(data);
  if (renew && !view(data).done('p34.talk')) add('renewal', 'שיחה על התוצאות ועל ההמשך', 'ה12', endOfDayIL(renew));
  return out.sort((a, b) => a.at - b.at).slice(0, max);
}

// "מה אנחנו צריכים ממך": each { key, text, href }.
const MATERIALS = [['p05.logo', 'לוגו'], ['p05.colors', 'צבעי המותג'], ['p05.photos', 'תמונות'], ['p05.videos', 'סרטונים שכבר יש לכם']];
export function needsFromYou(data, now = new Date()) {
  const c = data?.client || {};
  const x = view(data);
  const out = [];
  if (x.done('p04.ended') || x.done('p04.saved')) {
    const missing = MATERIALS.filter(([k]) => !x.done(k)).map(([, l]) => l);
    if (missing.length) out.push({ key: 'materials', text: `לשלוח לנו בוואטסאפ: ${missing.join(', ')}` });
    if (!x.done('p05.access')) out.push({ key: 'access', text: 'גישות לרשתות: נתאם איתכם שיחה קצרה. לא שולחים סיסמאות בהודעה' });
  }
  for (const it of data?.items || []) {
    if (it.state === 'waiting') out.push({ key: `approve:${it.key}`, text: `לאשר או לבקש תיקון: ${itemText(it.item, it.shootRound)}`, href: `#item-${domId(it.key)}` });
  }
  const shoots = [{ pre: '', at: parseDate(c.shootAt), n: 1 }, ...(c.rounds || []).filter((r) => Number(r.n) > 1).map((r) => ({ pre: `r${r.n}.`, at: parseDate(r.shootAt), n: Number(r.n) }))];
  for (const s of shoots) {
    if (s.at && s.at > now && !view(data, s.pre).done('p11.ok.client')) out.push({ key: `shootok:${s.n}`, text: `לאשר לנו בקבוצה את מועד יום הצילום: ${dayText(s.at)} בשעה ${timeText(s.at)}` });
  }
  if ((data?.surveys?.due || []).length) out.push({ key: 'survey', text: 'שאלה קצרה אחת, לא חובה', href: '#survey' });
  return out;
}
export const domId = (key) => String(key).replace(/[^a-z0-9]/gi, '-');

// Decision 29, a promise the page makes (ה11).
export const RESPONSE_TIMES = [
  ['אישור שקיבלנו את הפנייה', 'תוך שעתיים'],
  ['טיפול בפנייה', 'תוך יום עסקים'],
  ['פנייה דחופה', 'תוך שעה'],
];
export const OFFICE_HOURS_TEXT = `בשעות הפעילות: א׳–ה׳ ${String(WORK_HOURS.start).padStart(2, '0')}:00–${WORK_HOURS.end}:00, ובערב חג עד ${WORK_HOURS.erevEnd}:00.`;

// The team the client works with: first names and roles only (as in the welcome message).
export const team = () => CLIENT_ROLES.map(([k, role]) => ({ key: k, name: PEOPLE[k].name, role }));

// Deliverables' links (only https, only these three).
export const LINK_LABELS = [['drive', 'הסרטונים והגרפיקות (Drive)'], ['scripts', 'התסריטים'], ['gantt', 'הגאנט השנתי']];

// Friendly words for a link that does not open.
export const CLOSED_TEXT = {
  invalid: ['הקישור אינו תקין', 'ייתכן שהקישור הועתק באופן חלקי. בקשו מאיתנו בקבוצה לשלוח אותו שוב.'],
  expired: ['תוקף הקישור הסתיים', 'מטעמי אבטחה לקישור יש תוקף. בקשו מאיתנו בקבוצה קישור חדש, ונשלח אותו מיד.'],
  revoked: ['הקישור הזה כבר לא פעיל', 'שלחנו לכם קישור חדש, או שהקישור בוטל. בקשו מאיתנו בקבוצה את הקישור העדכני.'],
  closed: ['הדף כבר לא פעיל', 'העבודה המשותפת שלנו על החבילה הסתיימה. לכל שאלה אפשר לפנות אלינו.'],
  error: ['לא הצלחנו לטעון את הדף', 'בדקו את החיבור לאינטרנט ורעננו את העמוד.'],
};

// The client's own words for the database's refusals.
export function actionError(err) {
  const msg = String(err?.message || err || '');
  if (/staff cannot act/.test(msg)) return 'אתם מחוברים כאנשי צוות, ולכן הפעולה נחסמה. את הדף ממלא הלקוח, בדפדפן שבו אינכם מחוברים.';
  if (/wording changed|not awaiting approval|survey not open/.test(msg)) return 'המצב בדף השתנה בינתיים. רעננו את העמוד ונסו שוב.';
  if (/status link/.test(msg)) return 'הקישור כבר לא פעיל. בקשו מאיתנו קישור חדש בקבוצה.';
  if (/invalid name/.test(msg)) return 'יש למלא שם מלא.';
  if (/note required/.test(msg)) return 'יש לכתוב מה לתקן.';
  if (/already|duplicate key|client_surveys_once/.test(msg)) return 'כבר קיבלנו תשובה לשאלה הזו. תודה!';
  return 'הפעולה לא נשמרה. בדקו את החיבור לאינטרנט ונסו שוב. מה שכתבתם נשאר בעמוד.';
}
