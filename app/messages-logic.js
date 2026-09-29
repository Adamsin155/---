// Client messages center (messages.html): which proactive message each client
// gets today, and the office's message templates. docs/plan/system-plan.md,
// section 7 ("מה הלקוח מקבל") and Irit's day (section 3).
// Pure logic, no DOM, so node can test it. Every day and time is an Israel one
// (tz.js), whatever the zone of the device: "today", "Thursday", the day before a
// shoot and the promised dates all follow the office's clock.
//
// The rules:
//  - At most ONE proactive message per client per Israel day. The database
//    enforces the same (client_messages_one_per_day).
//  - Today's message, the first that applies: a notice of a delay (always before
//    the promised date), the day before a shoot, a milestone that happened since
//    its message was last sent, the Thursday update, and otherwise the daily
//    message of the client's station. The others stay available as options.
//  - Clients that ended or were cancelled get nothing, and nobody does on a day
//    the office is closed (Friday, Saturday, holidays).
//  - Imported history (checks with the note "ייבוא") is never a milestone.
import { STATIONS, PEOPLE, SHOOT_TYPES } from './protocol.js';
import {
  clientState, isBusinessDay, addBusinessDays, businessDaysBetween, parseDate, roundsOf, roundContext,
  isImported, IMPORT_NOTE,
} from './protocol-logic.js';
import { partsIL, dayKeyIL, weekdayIL, addDaysIL, startOfDayIL, daysBetweenIL } from './tz.js';
import { whatsappLink } from './quote-doc.js';

// Who works in the queue: the owner (no person), Irit and Lior. The database lets
// the office read and write (can_message_clients(): Ofir too); the page is theirs.
export const MESSAGE_SENDERS = ['irit', 'lior'];
export const canSendMessages = (v) => !!v && !v.error
  && ((!v.me && v.scope === 'office') || MESSAGE_SENDERS.includes(v.me));

export const MESSAGE_KINDS = {
  delay: 'הודעה על עיכוב',
  milestone: 'אבן דרך',
  thursday: 'עדכון חמישי',
  daily: 'הודעה יומית',
};

// ── Templates ──────────────────────────────
// The defaults, as seeded by supabase/migrations/20260930100000_client_messages.sql
// (tests/messages.test.mjs checks that the two agree). The office edits them in
// the page; the table wins, and a default fills in only when a row is missing.
// {x} is filled by the system; [x] marks a place the sender fills by hand. A
// message with either left in it cannot be sent.
const daily = (key, body) => {
  const i = STATIONS.findIndex((s) => s.key === key);
  return { key: `daily.${key}`, title: `הודעה יומית: ${STATIONS[i].title}`, kind: 'daily', station: i + 1, body };
};

export const DEFAULT_TEMPLATES = [
  {
    key: 'welcome', title: 'ברוכים הבאים', kind: 'milestone', station: null,
    body: `היי {לקוח}, ברוכים הבאים לאסטרטג! שמחים להתחיל לעבוד איתכם.

מי בצוות שלכם:
{צוות}

התאריכים הקרובים:
{תאריכים}

מה נצטרך מכם: לוגו, צבעי המותג, ותמונות וסרטונים שכבר יש לכם. את הגישות לרשתות נקבל מכם בשיחה, לא כאן בקבוצה.

בכל יום חמישי תקבלו כאן עדכון קצר: מה עשינו, מה הלאה ומה צריך מכם. בכל שאלה אפשר לכתוב לנו כאן.`,
  },
  {
    key: 'access', title: 'מצב החומרים והגישות', kind: 'milestone', station: null,
    body: `היי {לקוח}, עדכון קצר על החומרים לעמוד: התקבלו {התקבלו} מתוך {מתוך}.
עוד חסר: {חסר}.
חומרים אפשר לשלוח כאן בקבוצה. את הגישות לרשתות לא שולחים בקבוצה: נתאם שיחה קצרה ונקבל אותן מכם בטלפון.`,
  },
  {
    key: 'summary', title: 'מה הבנו על העסק', kind: 'milestone', station: null,
    body: `היי {לקוח}, תודה על פגישת האפיון! כדי לוודא שהבנו נכון, זה מה שהבנו על {עסק}:
1. מה העסק עושה: [להשלים]
2. למי אתם פונים: [להשלים]
3. מה מייחד אתכם: [להשלים]
4. מה המטרה שלנו יחד: [להשלים]
5. על מה נשים דגש בתוכן: [להשלים]
משהו לא מדויק? כתבו לנו כאן ונתקן.`,
  },
  {
    key: 'scripts', title: 'תסריטים לאישור', kind: 'milestone', station: null,
    body: `היי {לקוח}, התסריטים ליום הצילום מוכנים!
נקבע איתכם זום קצר כדי לעבור עליהם יחד ולאשר. לא מצלמים שום דבר שלא אישרתם.
מתי נוח לכם לזום?`,
  },
  {
    key: 'eve', title: 'יום לפני הצילום', kind: 'milestone', station: null,
    body: `היי {לקוח}, מתכוננים ליום הצילום!
מתי: {תאריך}. הצוות מגיע ב־{שעת הצוות}, והמשפיענים ב־{שעה}.
איפה: {כתובת}
מי מגיע: {מגיעים}
מה להכין: העסק מסודר ונקי, מוצרים ושירותים מוכנים לצילום, שילוט ותאורה דולקים, ועובדים שמוכנים להופיע. בשעה הראשונה מצלמים את העסק עצמו, לפני שהמשפיענים מגיעים.
אם משהו השתנה, כתבו לנו כאן עוד היום.`,
  },
  {
    key: 'thanks', title: 'תודה אחרי הצילום', kind: 'milestone', station: null,
    body: `היי {לקוח}, תודה על יום צילום מעולה!
החומרים כבר בדרך לעריכה, והסרטונים יהיו סגורים עד {תאריך}, כולל סבב תיקונים.
ושאלה קצרה: מ־1 עד 5, איך היה יום הצילום בשבילכם?`,
  },
  {
    key: 'videos', title: 'הסרטונים מוכנים', kind: 'milestone', station: null,
    body: `היי {לקוח}, הסרטונים שלכם מוכנים!
יש לכם סבב תיקונים אחד (סבב 1 מתוך 1). כדאי לרכז את כל ההערות בהודעה אחת, לפי מספר הסרטון.
הערות שיגיעו עד 13:00 נטפל בהן עוד באותו יום, כדי שהכול יהיה סגור עד {תאריך}.`,
  },
  {
    key: 'first_post', title: 'הפוסט הראשון עלה', kind: 'milestone', station: null,
    body: `היי {לקוח}, הפוסט הראשון שלכם עלה!
כל התכנים מתוזמנים לפי הגאנט השנתי, ובכל שבוע נעדכן אתכם מה עלה ומה בדרך.`,
  },
  {
    key: 'campaign', title: 'הקמפיין באוויר', kind: 'milestone', station: null,
    body: `היי {לקוח}, הקמפיין שלכם באוויר!
בימים הראשונים הקמפיין לומד, ואחר כך רואים את התמונה המלאה. נעבור איתכם על התוצאות בשיחה השבועית.`,
  },
  {
    key: 'renewal', title: 'חידוש', kind: 'milestone', station: null,
    body: `היי {לקוח}, בעוד כחודשיים, ב{תאריך}, מסתיימת שנת העבודה שלנו יחד.
נשמח לקבוע שיחה קצרה: נעבור על התוצאות ונתכנן יחד את ההמשך. מתי נוח לכם?`,
  },
  {
    key: 'thursday', title: 'עדכון חמישי', kind: 'thursday', station: null,
    body: `היי {לקוח}, העדכון השבועי שלנו:
מה עשינו השבוע: {עשינו}.
מה הלאה: {הלאה}.
מה צריך מכם: {צריך}.
סוף שבוע נעים!`,
  },
  {
    key: 'delay', title: 'הודעה על עיכוב', kind: 'delay', station: null,
    body: `היי {לקוח}, רצינו לעדכן מראש לגבי {מה}: זה ייקח קצת יותר זמן ממה שתכננו.
במקום {תאריך}, זה יהיה מוכן עד [מועד חדש].
מצטערים על העיכוב. אנחנו על זה.`,
  },
  daily('join', 'היי {לקוח}, אנחנו מסדרים את כל מה שצריך כדי להתחיל: הצוות, פגישת האפיון והחומרים. אם יש שאלה, אנחנו כאן בקבוצה.'),
  daily('char', 'היי {לקוח}, אנחנו בשלב האפיון: לומדים את העסק לעומק ומסדרים את העמוד, הגרפיקות הראשונות וה־Highlights. נעדכן כאן כשיש משהו לאישור.'),
  daily('content', 'היי {לקוח}, היום אנחנו עובדים על התוכן ליום הצילום: הדגשים והתסריטים. לפני שמצלמים, הכול מגיע אליכם לאישור.'),
  daily('shoot', 'היי {לקוח}, יום הצילום בפתח ואנחנו מתכוננים אליו. אם יש משהו שחשוב לכם שנדע, כתבו לנו כאן.'),
  daily('post', 'היי {לקוח}, הסרטונים שלכם בעריכה. הם יהיו סגורים עד {תאריך}, ונשלח לכם אותם כאן.'),
  daily('publish', 'היי {לקוח}, אנחנו מתזמנים את התכנים שלכם ומכינים את הקמפיינים. נעדכן כאן ברגע שהם עולים.'),
  daily('ongoing', 'היי {לקוח}, התכנים שלכם ממשיכים לעלות לפי הגאנט. יש מבצע, אירוע או משהו חדש בעסק? ספרו לנו ונשלב אותו.'),
  daily('renewal', 'היי {לקוח}, אנחנו מסכמים את התוצאות של השנה שלנו יחד לקראת שיחת ההמשך. יש משהו שתרצו שנבדוק? כתבו לנו כאן.'),
];

// What the system fills in each template ({לקוח} and {עסק} everywhere).
const EXTRA_VARS = {
  welcome: ['צוות', 'תאריכים'],
  access: ['התקבלו', 'מתוך', 'חסר'],
  eve: ['תאריך', 'שעה', 'שעת הצוות', 'כתובת', 'מגיעים'],
  thanks: ['תאריך'],
  videos: ['תאריך'],
  renewal: ['תאריך'],
  thursday: ['עשינו', 'הלאה', 'צריך'],
  delay: ['מה', 'תאריך'],
  'daily.post': ['תאריך'],
};
export const templateVars = (key) => ['לקוח', 'עסק', ...(EXTRA_VARS[key] || [])];

// Templates by key: the defaults, overridden by the rows of the table.
export function templatesByKey(rows = []) {
  const map = new Map(DEFAULT_TEMPLATES.map((t) => [t.key, { ...t, isDefault: true }]));
  for (const r of rows || []) if (r?.key && map.has(r.key)) map.set(r.key, { ...map.get(r.key), ...r, isDefault: false });
  return map;
}

const VAR = /\{([^{}\n]{1,30})\}/g;
const MANUAL = /\[[^[\]\n]{1,40}\]/g;

// Fills {name} from vars. A missing value leaves the {name} in place, so the
// page does not let the message go out until someone fills it.
export function fillTemplate(body, vars = {}) {
  return String(body || '').replace(VAR, (m, name) => {
    const v = vars[name.trim()];
    return v === undefined || v === null || v === '' ? m : String(v);
  });
}

// What is still to fill in a message: {x} left by the system, [x] to fill by hand.
export function unfilledIn(text) {
  const s = String(text || '');
  return [...new Set([...s.matchAll(VAR), ...s.matchAll(MANUAL)].map((m) => m[0]))];
}

// Placeholders in a template that the system does not fill for that template.
export function unknownVars(key, body) {
  const known = new Set(templateVars(key));
  return [...new Set([...String(body || '').matchAll(VAR)].map((m) => m[1].trim()).filter((v) => !known.has(v)))];
}

// The text of one of the day's options.
export const messageText = (option, templates) => fillTemplate(templates.get(option.key)?.body || '', option.vars);

// WhatsApp links only (never automation): to the client's number, in its 972…
// form, when the card has one; otherwise with no number, and the sender picks the group.
export const waLink = (phone, text) => whatsappLink(phone, text);
export const groupLink = (text) => whatsappLink('', text);

// ── Words and dates for clients ─────────────
const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const pad = (n) => String(n).padStart(2, '0');
// "יום ג׳ 13.10" and "10:00", in Israel time.
export const dayText = (d) => { const p = partsIL(d); return `יום ${WEEKDAYS[p.weekday]} ${p.day}.${p.month}`; };
export const timeText = (d) => { const p = partsIL(d); return `${pad(p.hour)}:${pad(p.minute)}`; };
// "היום", "אתמול", "מחר", or "ביום ג׳ 13.10".
export function relDay(d, now) {
  const n = daysBetweenIL(now, d);
  if (n === 0) return 'היום';
  if (n === -1) return 'אתמול';
  if (n === 1) return 'מחר';
  return `ב${dayText(d)}`;
}
// "א, ב וג" (the vav takes a maqaf before a digit or a Latin letter).
export function listText(items) {
  const list = items.filter(Boolean);
  if (list.length < 2) return list[0] || '';
  const last = list.at(-1);
  return `${list.slice(0, -1).join(', ')} ${/^[א-ת]/.test(last) ? 'ו' : 'ו־'}${last}`;
}

// Promise ה8: the videos are closed, with a round of corrections, within 5
// business days, counted from the business day after the shoot.
export function promisedClosing(shootAt) {
  const shoot = parseDate(shootAt);
  return shoot ? addBusinessDays(shoot, 5) : null;
}

// The team as the client sees it, in the welcome message.
const CLIENT_ROLES = [
  ['lior', 'מנהל הלקוח, תוכן, ימי צילום וקמפיינים'],
  ['irit', 'תפעול ולקוחות, הכתובת שלכם לכל שאלה'],
  ['ofir', 'אפיון העסק ובקרת איכות'],
  ['ilai', 'גרפיקה, עיצוב העמודים ותזמון התכנים'],
];
export const teamText = () => CLIENT_ROLES.map(([k, role]) => `${PEOPLE[k].name}: ${role}`).join('\n');

// Who comes to the shoot.
export function crewText(shootType) {
  const who = ['ליאור (מנהל יום הצילום)', 'אלי (הצלם)'];
  if (shootType === 'natali') who.push(SHOOT_TYPES.natali.name);
  if (shootType === 'dms') who.push(`המשפיענים ${SHOOT_TYPES.dms.name}`);
  return listText(who);
}

// The materials counted in "התקבלו X מתוך Y" (process 5; the menu is optional).
const MATERIALS = [
  ['p05.access', 'גישות לרשתות'], ['p05.logo', 'לוגו'], ['p05.colors', 'צבעי המותג'],
  ['p05.photos', 'תמונות'], ['p05.videos', 'סרטונים קיימים'],
];
const resolvedCheck = (checks, key) => checks[key]?.state === 'done' || checks[key]?.state === 'na';
export function materialsOf(checks) {
  const missing = MATERIALS.filter(([k]) => !resolvedCheck(checks, k)).map(([, label]) => label);
  return { got: MATERIALS.length - missing.length, of: MATERIALS.length, missing };
}

// Processes in the client's words: what we did, and what comes next. Internal
// steps (checks, folders, reviews) are not mentioned, and never an internal date.
const STEPS = {
  p02: ['פתחנו את קבוצת העבודה', 'פתיחת קבוצת העבודה'],
  p03: ['קבענו את פגישת האפיון', 'קביעת פגישת האפיון'],
  p04: ['קיימנו את פגישת האפיון', 'פגישת האפיון'],
  p06: ['סידרנו את העמודים ברשתות', 'סידור העמודים ברשתות'],
  p07: ['הכנו את 9 הגרפיקות הראשונות', 'הכנת 9 הגרפיקות הראשונות'],
  p08: ['הכנו Highlights לעמוד', 'הכנת Highlights לעמוד'],
  p10: ['הכנו את התשתית לקמפיינים', 'הכנת התשתית לקמפיינים'],
  p11: ['קבענו את יום הצילום', 'קביעת יום הצילום'],
  p12a: ['עשינו שיחת דגשים לתוכן', 'שיחת דגשים לתוכן'],
  p12: ['כתבנו את התסריטים', 'כתיבת התסריטים'],
  p13: ['אישרנו יחד את התסריטים', 'אישור התסריטים בזום'],
  p19: ['צילמנו את יום הצילום', 'יום הצילום'],
  p22: ['ערכנו את הסרטונים', 'עריכת הסרטונים'],
  p23: ['הכנו את יתרת הגרפיקות', 'הכנת יתרת הגרפיקות'],
  p26: ['שלחנו לכם את הסרטונים', 'שליחת הסרטונים אליכם'],
  p27: ['סגרנו את התיקונים בסרטונים', 'סבב התיקונים בסרטונים'],
  p28: ['תזמנו את התכנים לפרסום', 'תזמון התכנים לפרסום'],
  p29: ['שלחנו לכם את הגאנט השנתי', 'הגאנט השנתי'],
  p30: ['העלינו את הקמפיינים לאוויר', 'הקמת הקמפיינים'],
};

// ── The client's place in the journey ──────
const baseId = (id) => id.replace(/^r\d+-/, '');
const isRoundState = (s) => /^r\d+-/.test(s.proc.id);
const STATION_OF = new Map(STATIONS.flatMap((st, i) => st.procs.map((p) => [p, i])));
const stationAt = (key) => STATIONS.findIndex((s) => s.key === key);
// Processes that start by themselves rather than on someone's check: the
// meeting, the shoot, editing (22א starts when the shoot day is closed) and the
// renewal. The others count once someone works on them.
const DATED = new Set(['p04', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p20', 'p21', 'p22a', 'p34']);

// The station the work is in: the furthest one reached (a process in it was
// checked, or its date came). A station whose work is all done hands over to
// the next one, up to "ongoing", so an imported client is where it was placed.
function reachedStation(states, now, floor) {
  let i = floor;
  for (const s of states) {
    const id = baseId(s.proc.id);
    const k = STATION_OF.get(id);
    if (k === undefined || k <= i) continue;
    if (s.touched || s.complete || (DATED.has(id) && s.startAt && s.startAt <= now)) i = k;
  }
  const ongoing = stationAt('ongoing');
  while (i < ongoing && states.every((s) => STATION_OF.get(baseId(s.proc.id)) !== i || s.proc.recurring || s.complete)) i += 1;
  return i;
}

// The latest extra shoot round, while it is under way and not delivered yet.
function activeRound(client, state, now) {
  const r = roundsOf(client).reduce((a, b) => (!a || Number(b.n) > Number(a.n) ? b : a), null);
  if (!r) return null;
  const start = parseDate(r.start_at);
  if (start && start > now) return null;
  const mine = state.states.filter((s) => s.proc.id.startsWith(`r${r.n}-`));
  if (!mine.length || mine.find((s) => baseId(s.proc.id) === 'p30')?.complete) return null;
  return { n: Number(r.n), states: mine };
}

// Station of the client (index into STATIONS). A client ending the contract is in renewal.
export function stationOf(client, state, now = new Date()) {
  if (client.status === 'ending') return stationAt('renewal');
  const round = activeRound(client, state, now);
  if (round) return reachedStation(round.states, now, stationAt('content'));
  return reachedStation(state.states.filter((s) => !isRoundState(s)), now, 0);
}

// ── Today's message ───────────────────────
const CLOSED = new Set(['ended', 'cancelled']);
export const isClosedClient = (c) => CLOSED.has(c?.status);

// The message this client already got today (Israel day), if any.
export function sentToday(messages, now = new Date()) {
  const day = dayKeyIL(now);
  return (messages || []).filter((m) => dayKeyIL(m.sent_at) === day)
    .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))[0] || null;
}

// The business day before the shoot day (process 15): for a Sunday shoot, Thursday.
function eveOf(shoot) {
  let d = addDaysIL(shoot, -1);
  while (!isBusinessDay(d)) d = addDaysIL(d, -1);
  return d;
}

const later = (a, b) => (a && b ? (a > b ? a : b) : a || b);
const earlier = (a, b) => (a && b ? (a < b ? a : b) : a || b);

// Milestones, in the order of the journey. `at`: when it happened (null: not
// yet). `fresh`: business days it stays worth sending. `station`: where in the
// journey it belongs; a client already two stations further on does not get it
// (many late checks in one go must not greet a client who is in editing).
// `base`: once per client, not per shoot round. `when`: still relevant now.
// `urgent`: goes first.
const MILESTONES = [
  { key: 'welcome', station: 'join', base: true, fresh: 2, at: (x) => x.doneAt('p02.opened') },
  {
    key: 'access', station: 'char', base: true, fresh: 3, at: (x) => x.completed('p04'),
    when: (x) => !x.st('p05')?.complete && materialsOf(x.checks).missing.length > 0,
  },
  { key: 'summary', station: 'char', base: true, fresh: 2, at: (x) => x.completed('p04') },
  { key: 'scripts', station: 'content', fresh: 3, at: (x) => x.completed('p12'), when: (x) => !x.isDone('p13.approved') },
  {
    // Only on the business day before the shoot.
    key: 'eve', station: 'shoot', urgent: true, fresh: 0,
    at: (x, now) => {
      const shoot = parseDate(x.ctx.shoot_at);
      return shoot && shoot > now && dayKeyIL(eveOf(shoot)) === dayKeyIL(now) && !x.st('p19')?.complete ? startOfDayIL(now) : null;
    },
  },
  {
    // From the business day after the shoot ("למחרת").
    key: 'thanks', station: 'shoot', fresh: 2,
    at: (x) => {
      const done = x.completed('p19');
      const shoot = parseDate(x.ctx.shoot_at);
      return done && shoot ? later(done, startOfDayIL(addBusinessDays(shoot, 1))) : done;
    },
  },
  { key: 'videos', station: 'post', fresh: 2, at: (x) => x.doneAt('p26.sent'), when: (x) => !x.isDone('p27.approved') },
  { key: 'first_post', station: 'publish', base: true, fresh: 3, at: (x) => earlier(x.completed('p28'), x.doneAt('p29.sent')) },
  { key: 'campaign', station: 'publish', fresh: 3, at: (x) => x.completed('p30') },
  {
    key: 'renewal', station: 'renewal', base: true, fresh: 10,
    at: (x) => (x.client.contract_end ? x.st('p34')?.startAt || null : null),
    when: (x) => !x.isDone('p34.talk'),
  },
];
const ORDER = new Map(MILESTONES.map((m, i) => [m.key, i]));

// Promises to the client that get a notice of delay up to a business day before
// their date (section 4: ה4, ה5, ה8, ה9). `due`: the promised date, when it is
// not the process's own due date (ה8 counts from the shoot).
const PROMISES = [
  { proc: 'p11', what: 'קביעת יום הצילום' },
  { proc: 'p12', what: 'התסריטים ליום הצילום' },
  { proc: 'p27', what: 'סגירת הסרטונים', due: (x) => promisedClosing(x.ctx.shoot_at) },
  { proc: 'p30', what: 'העלאת הקמפיינים' },
];

// The client and each extra shoot round, with helpers over its checks and states.
function contextsOf(client, checks, state) {
  const byId = new Map(state.states.map((s) => [s.proc.id, s]));
  const make = (pre, pid, ctx, round) => {
    const st = (id) => byId.get(`${pid}${id}`) || null;
    return {
      client, ctx, round, pre, checks, st,
      isDone: (k) => checks[`${pre}${k}`]?.state === 'done',
      // One item done for real (imported history is not an event).
      doneAt: (k) => {
        const c = checks[`${pre}${k}`];
        return c && c.state === 'done' && c.note !== IMPORT_NOTE ? new Date(c.at) : null;
      },
      completed: (id) => {
        const s = st(id);
        return s && s.complete && s.completedAt && !isImported(s.proc, checks) ? s.completedAt : null;
      },
    };
  };
  return [make('', '', client, 0),
    ...roundsOf(client).map((r) => make(`r${r.n}.`, `r${r.n}-`, roundContext(client, r), Number(r.n)))];
}
// The part of the journey the client is in now: the active round, or the client itself.
const currentOf = (xs, client, state, now) => {
  const r = activeRound(client, state, now);
  return (r && xs.find((x) => x.round === r.n)) || xs[0];
};

const roundNote = (x) => (x.round ? ` (סבב צילום ${x.round})` : '');

// The next three dates, for the welcome message (never an internal deadline).
function nextDatesText(c) {
  const char = parseDate(c.char_at);
  const shoot = parseDate(c.shoot_at);
  const at = (d) => `${dayText(d)} בשעה ${timeText(d)}`;
  return [
    char ? `פגישת האפיון: ${at(char)}` : 'פגישת האפיון: נתאם איתכם מועד בשעות הקרובות',
    `עמוד מסודר ו־9 גרפיקות ראשונות לאישור: ${char ? `ביום האפיון, ${dayText(char)}` : 'ביום האפיון'}`,
    shoot ? `יום הצילום: ${at(shoot)}`
      : `קביעת יום הצילום: ${char ? `עד ${dayText(addBusinessDays(char, 3))}` : 'עד 3 ימי עסקים אחרי האפיון'}`,
  ].join('\n');
}

// Variables and a one-line reason for a milestone.
function milestoneOption(m, x, at, now) {
  const vars = {};
  let reason = '';
  switch (m.key) {
    case 'welcome':
      vars['צוות'] = teamText();
      vars['תאריכים'] = nextDatesText(x.client);
      reason = `הקבוצה נפתחה ${relDay(at, now)}`;
      break;
    case 'access': {
      const mt = materialsOf(x.checks);
      Object.assign(vars, { 'התקבלו': mt.got, 'מתוך': mt.of, 'חסר': listText(mt.missing) });
      reason = `האפיון הסתיים ${relDay(at, now)}. התקבלו ${mt.got} מתוך ${mt.of} חומרים`;
      break;
    }
    case 'summary': reason = `האפיון הסתיים ${relDay(at, now)}: סיכום ״מה הבנו על העסק״`; break;
    case 'scripts': reason = 'התסריטים מוכנים, והלקוח עוד לא אישר אותם'; break;
    case 'eve': {
      const shoot = parseDate(x.ctx.shoot_at);
      Object.assign(vars, {
        'תאריך': dayText(shoot), 'שעה': timeText(shoot), 'שעת הצוות': timeText(new Date(shoot.getTime() - 36e5)),
        'כתובת': x.client.address || null, 'מגיעים': crewText(x.ctx.shoot_type),
      });
      reason = `יום הצילום ${daysBetweenIL(now, shoot) === 1 ? 'מחר, ' : 'ב'}${dayText(shoot)} ב־${timeText(shoot)}`;
      break;
    }
    case 'thanks': case 'videos': {
      const closing = promisedClosing(x.ctx.shoot_at);
      if (closing) vars['תאריך'] = dayText(closing);
      reason = m.key === 'thanks'
        ? `יום הצילום הסתיים${closing ? `. הסרטונים סגורים עד ${dayText(closing)}` : ''}`
        : `הסרטונים נשלחו ללקוח ${relDay(at, now)}`;
      break;
    }
    case 'first_post': reason = 'התכנים תוזמנו לפרסום'; break;
    case 'campaign': reason = `הקמפיינים הוקמו ${relDay(at, now)}`; break;
    case 'renewal': {
      const end = parseDate(x.client.contract_end);
      vars['תאריך'] = dayText(end);
      reason = `החוזה מסתיים ב${dayText(end)}: מתחילים לדבר על ההמשך`;
      break;
    }
    default: break;
  }
  return { kind: 'milestone', key: m.key, ref: `${x.pre}${m.key}`, at, reason: reason + roundNote(x), vars };
}

// Has a message about `ref` (or, in a row without one, of template `key`) gone out since `at`?
const sentSince = (messages, key, ref, at) => messages.some((m) => (m.ref ? m.ref === ref : m.template_key === key)
  && new Date(m.sent_at) >= at);

function pendingMilestones(xs, messages, now, station) {
  const out = [];
  for (const x of xs) {
    const list = MILESTONES.filter((m) => !m.base || !x.round).map((m) => {
      const at = m.at(x, now);
      const ref = `${x.pre}${m.key}`;
      return { m, at, ref, sent: !!at && sentSince(messages, m.key, ref, at) };
    });
    for (const { m, at, sent } of list) {
      if (!at || at > now || sent || (m.when && !m.when(x))) continue;
      if (businessDaysBetween(at, now) > m.fresh || stationAt(m.station) < station - 1) continue;
      // A later step of the journey already reached the client: this one is behind them.
      if (list.some((o) => ORDER.get(o.m.key) > ORDER.get(m.key) && o.sent && o.at > at)) continue;
      out.push({ m, option: milestoneOption(m, x, at, now) });
    }
  }
  return [...out.filter((p) => p.m.urgent), ...out.filter((p) => !p.m.urgent)].map((p) => p.option);
}

function delayNotices(xs, messages, now) {
  const out = [];
  for (const x of xs) {
    for (const p of PROMISES) {
      const s = x.st(p.proc);
      if (!s || s.complete || s.wait) continue; // done, or waiting on the client (not our delay)
      const due = p.due ? p.due(x) : s.dueAt;
      if (!due || due <= now || businessDaysBetween(now, due) > 1) continue; // always before the date
      const ref = `${x.pre}${p.proc}`;
      if (messages.some((m) => m.kind === 'delay' && m.ref === ref)) continue;
      out.push({
        kind: 'delay', key: 'delay', ref, at: now,
        reason: `הבטחנו את ${p.what} עד ${dayText(due)}, וזה עוד לא הושלם${roundNote(x)}`,
        vars: { 'מה': p.what, 'תאריך': dayText(due) },
      });
    }
  }
  return out;
}

// The Thursday update, from the system's data: what we did this week, what is
// next, and what we need from the client.
export function thursdayVars(client, checks, state, now = new Date()) {
  const xs = contextsOf(client, checks, state);
  const x = currentOf(xs, client, state, now);
  const station = stationOf(client, state, now);
  const weekStart = startOfDayIL(addDaysIL(now, -weekdayIL(now)));

  const did = [];
  for (const s of state.states) {
    const words = STEPS[baseId(s.proc.id)];
    if (!words || !s.completedAt || s.completedAt < weekStart || s.completedAt > now || isImported(s.proc, checks)) continue;
    if (!did.includes(words[0])) did.push(words[0]);
  }
  const call = checks['p31.call'];
  if (call?.state === 'done' && call.note !== IMPORT_NOTE && new Date(call.at) >= weekStart) did.push('קיימנו את השיחה השבועית');
  if (!did.length && STATIONS[station].key === 'ongoing') did.push('התכנים שלכם המשיכו לעלות לפי הגאנט');

  // The coming dates first, then the next open step from the client's station on.
  const next = [];
  const skip = new Set();
  const char = x.round ? null : parseDate(client.char_at);
  const shoot = parseDate(x.ctx.shoot_at);
  const closing = promisedClosing(x.ctx.shoot_at);
  if (char && char > now) { next.push(`פגישת האפיון ב${dayText(char)} בשעה ${timeText(char)}`); skip.add('p04'); }
  if (shoot && shoot > now) { next.push(`יום הצילום ב${dayText(shoot)}`); skip.add('p19'); }
  else if (shoot && closing > now && !x.st('p27')?.complete) {
    next.push(`סגירת הסרטונים עד ${dayText(closing)}`);
    for (const k of ['p22', 'p26', 'p27']) skip.add(k);
  }
  const scope = state.states.filter((s) => (x.round ? s.proc.id.startsWith(`r${x.round}-`) : !isRoundState(s)));
  for (const s of scope) {
    const id = baseId(s.proc.id);
    if (next.length >= 2) break;
    if (!STEPS[id] || s.complete || skip.has(id) || STATION_OF.get(id) < station) continue;
    next.push(STEPS[id][1]);
  }
  if (!next.length) next.push(STATIONS[station].key === 'renewal' ? 'שיחת סיכום ותכנון ההמשך' : 'השיחה השבועית והמשך התכנים לפי הגאנט');

  const need = [];
  const [b] = xs;
  if (b.st('p04')?.complete && !b.st('p05')?.complete) need.push(...materialsOf(checks).missing);
  if (b.isDone('p07.sent') && !b.isDone('p07.approved')) need.push('אישור על 9 הגרפיקות הראשונות');
  for (const c of xs) {
    const p11 = c.st('p11');
    // Once the office has started setting the shoot day (a date to approve exists).
    if (p11?.touched && !p11.complete && !c.isDone('p11.ok.client')) need.push('אישור מועד ליום הצילום');
    if (c.st('p12')?.complete && !c.isDone('p13.approved')) need.push('אישור התסריטים');
    if (c.isDone('p26.sent') && !c.isDone('p27.approved')) need.push('הערות או אישור על הסרטונים');
  }

  return {
    'עשינו': did.length ? listText(did.slice(0, 4)) : '[מה עשינו השבוע]',
    'הלאה': listText(next.slice(0, 2)),
    'צריך': need.length ? listText([...new Set(need)]) : 'כרגע כלום. אם עולה שאלה, אנחנו כאן',
  };
}

// Today's message for one client. null: the client is closed. Otherwise
// { client, station, sent, dayOff, options }: `sent` is the message that already
// went out today; `options` are what may go out today, the suggestion first,
// each { kind, key, ref, at, reason, vars }.
export function suggestFor(client, checks = {}, messages = [], now = new Date(), state = null) {
  if (isClosedClient(client)) return null;
  const st = state || clientState(client, checks, now);
  const station = stationOf(client, st, now);
  const base = { client, station, sent: null, dayOff: false, options: [] };
  const sent = sentToday(messages, now);
  if (sent) return { ...base, sent };
  if (!isBusinessDay(now)) return { ...base, dayOff: true };

  const xs = contextsOf(client, checks, st);
  const options = [...delayNotices(xs, messages, now), ...pendingMilestones(xs, messages, now, station)];
  if (weekdayIL(now) === 4) {
    options.push({ kind: 'thursday', key: 'thursday', ref: null, at: now, reason: 'יום חמישי: עדכון שבועי בשלוש שורות', vars: thursdayVars(client, checks, st, now) });
  }
  // A promised date that already passed is never repeated to the client: the
  // {תאריך} stays open, and the sender writes the new date.
  const closing = promisedClosing(currentOf(xs, client, st, now).ctx.shoot_at);
  options.push({
    kind: 'daily', key: `daily.${STATIONS[station].key}`, ref: null, at: now,
    reason: `הודעה יומית · תחנה: ${STATIONS[station].title}`,
    vars: closing && closing > now ? { 'תאריך': dayText(closing) } : {},
  });
  const who = { 'לקוח': client.name || '', 'עסק': client.business || client.name || '' };
  for (const o of options) o.vars = { ...who, ...o.vars };
  return { ...base, options };
}

// The day's queue: every open client; those still to message first (the most
// important kind first, then by station and name), and those done today last.
const KIND_RANK = { delay: 0, milestone: 1, thursday: 2, daily: 3 };
export function dayQueue(clients, checksByClient = {}, messagesByClient = {}, now = new Date()) {
  const rank = (e) => (e.sent ? 9 : KIND_RANK[e.options[0]?.kind] ?? 8);
  return clients.map((c) => suggestFor(c, checksByClient[c.id] || {}, messagesByClient[c.id] || [], now))
    .filter(Boolean)
    .sort((a, b) => rank(a) - rank(b) || a.station - b.station || String(a.client.name).localeCompare(String(b.client.name), 'he'));
}
