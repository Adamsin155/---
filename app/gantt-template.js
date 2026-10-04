// The content Gantt's one fixed template (gantt.html, app/gantt-logic.js): a contract
// year described relatively — month n of the package, the nth weekday of that month,
// a business day, a time of day — never an absolute date. app/gantt-logic.js turns it
// into each client's dates from clients.deal_at and contract_end, in Israel time.
//
// Kept consistent with the package year (app/year-logic.js): the same months (from
// the deal's day of the month; the 31st becomes the month's last day), posts from the
// month the monthly cycle starts (CYCLE_FROM, month 2), the monthly report on business
// day 3, Ilai's plan on the business day before a month starts, and the once-a-term
// items (extra shoot days, stories, collabs, channel 14) in the same months as the
// cycle's items (spreadMonth). Quantities come from clients.deliverables (annual,
// app/protocol-logic.js packageDeliverables, which mirrors app/catalog.js).
//
// Changing a rule here changes every client's plan the next time someone presses
// "עדכון מהתבנית"; dates that were moved by hand stay unless that is confirmed.
// TEMPLATE_VERSION goes up with any change, so a plan can say which template made it.
import { CYCLE_FROM } from './year-logic.js';

export const TEMPLATE_VERSION = 1;

// Weekdays: 0 = Sunday … 6 = Saturday (Israel). Times are Israel wall-clock 'HH:MM'.
export const WEEKDAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// What can sit on the Gantt. `client: false` never reaches the client's link (get_gantt
// drops it in the database too). `files`: which kinds of public.client_files an entry
// of this kind can point at. Colours: brand navy, purple and pink first, then tones
// chosen to stay apart from them and from each other; every chip also carries its
// words, so colour is never the only cue.
export const GANTT_KINDS = {
  video: { label: 'סרטון', plural: 'סרטונים', color: '#5302DF', soft: '#EEE6FD', client: true, post: true, files: ['deliverable_video', 'video_existing'] },
  graphic: { label: 'גרפיקה', plural: 'גרפיקות', color: '#F82272', soft: '#FEE7F0', client: true, post: true, files: ['deliverable_graphic', 'image'] },
  monthly: { label: 'תוכן מהצלם החודשי', plural: 'תכנים מהצלם החודשי', color: '#0A84B5', soft: '#E3F3FA', client: true, post: true, files: ['deliverable_video', 'deliverable_graphic', 'image'] },
  highlight: { label: 'Highlights', plural: 'Highlights', color: '#B7791F', soft: '#FBF1DF', client: true, post: true, files: ['deliverable_highlight', 'image'] },
  story: { label: 'סטורי אצל המשפיענים', plural: 'סטורי אצל המשפיענים', color: '#C8327A', soft: '#FBE7F1', client: true, post: true, files: ['deliverable_video', 'deliverable_other'] },
  collab: { label: 'קולאב באינסטגרם', plural: 'קולאבים באינסטגרם', color: '#7A2BD9', soft: '#F2E8FC', client: true, post: true, files: ['deliverable_video', 'deliverable_other'] },
  ch14: { label: 'אייטם בערוץ 14', plural: 'אייטמים בערוץ 14', color: '#C0392B', soft: '#FBE9E7', client: true, post: true, files: ['deliverable_video', 'deliverable_other'] },
  shoot: { label: 'יום צילום', plural: 'ימי צילום', color: '#031432', soft: '#E4E7EF', client: true, post: false, files: [] },
  photo: { label: 'הצלם החודשי בעסק', plural: 'ימי צלם חודשי', color: '#0E8A6E', soft: '#E2F4EF', client: true, post: false, files: [] },
  report: { label: 'דוח חודשי', plural: 'דוחות חודשיים', color: '#2358C8', soft: '#E6EDFA', client: true, post: false, files: ['deliverable_other'] },
  plan: { label: 'תכנון החודש', plural: 'תכנון החודש', color: '#5E6882', soft: '#ECEEF3', client: false, post: false, files: [] },
  renewal: { label: 'שיחת חידוש', plural: 'שיחת חידוש', color: '#8F5B00', soft: '#FFF5E0', client: false, post: false, files: [] },
  end: { label: 'סיום שנת החבילה', plural: 'סיום שנת החבילה', color: '#031432', soft: '#FFFFFF', client: true, post: false, files: [] },
  custom: { label: 'אחר', plural: 'אחר', color: '#56617E', soft: '#EEF0F5', client: true, post: true, files: ['deliverable_video', 'deliverable_graphic', 'deliverable_highlight', 'deliverable_site', 'deliverable_other', 'image', 'video_existing', 'material_other'] },
};
export const KIND_ORDER = ['video', 'graphic', 'monthly', 'highlight', 'story', 'collab', 'ch14', 'shoot', 'photo', 'report', 'plan', 'renewal', 'end', 'custom'];

// Days a dated entry may not land on, unless its rule says otherwise. Shabbat (Friday
// and Saturday are never in a weekday list) and the office's holidays always; erev
// chag for posts too (the office closes at 13:00, nobody watches the comments).
const POSTS = ['holiday', 'erev'];

// The rules. Placement, one of:
//   spreadPosts  q units (qty) over the cycle's months as evenly as possible (the
//                earlier months get the remainder), and inside each month on the
//                `weekdays` evenly spaced between its first and last allowed day;
//   perMonth     `count` units each month of the cycle, on the `weekdays` likewise;
//   businessDay  the nth business day of each cycle month (before: n business days
//                before the month starts);
//   nthWeekday   the `week`th `weekday` of a package month (month: a fixed month, or
//                `spread` to put unit k of q in spreadMonth's month, as year-logic does);
//   fromEnd      `days` calendar days from the contract's end (business: back to a
//                business day).
// A day that is not allowed moves to the next allowed day in the same package month
// (or the one before when there is none after it).
export const GANTT_RULES = [
  { key: 'video', kind: 'video', place: 'spreadPosts', qty: (d) => d.videos, weekdays: [0, 2, 4], time: '19:00', avoid: POSTS, numbered: true, title: (n) => `סרטון ${n}` },
  { key: 'graphic', kind: 'graphic', place: 'spreadPosts', qty: (d) => d.graphics, weekdays: [1, 3], time: '13:00', avoid: POSTS, numbered: true, title: (n) => `גרפיקה ${n}` },
  // The monthly photographer (a paid add-on): 8 contents a month; he comes on business
  // day 10, and his contents go up in the rest of that month (year-logic: shot by day 12).
  { key: 'photo', kind: 'photo', place: 'businessDay', when: (d) => d.monthly > 0, day: 10, time: '10:00', title: (m) => `הצלם החודשי בבית העסק · חודש ${m}` },
  { key: 'monthly', kind: 'monthly', place: 'perMonth', when: (d) => d.monthly > 0, count: (d, of) => Math.max(1, Math.round(d.monthly / Math.max(1, of))), afterBusinessDay: 11, weekdays: [0, 1, 2, 3, 4], time: '17:00', avoid: POSTS, title: (k, m) => `תוכן ${k} מהצלם החודשי · חודש ${m}` },
  // Shoot days: the first in month 1 (the second Tuesday), unless the card already has
  // its date; the extra ones in the months of year-logic's "round" items.
  { key: 'shoot', kind: 'shoot', place: 'nthWeekday', qty: (d) => d.shoot_days, firstMonth: 1, week: 2, weekday: 2, time: '10:00', avoid: ['holiday', 'erev'], title: (k) => `יום צילום ${k}` },
  // Highlights (process 8, up to 4): up on the first business day posts start.
  { key: 'highlight', kind: 'highlight', place: 'businessDay', months: 'first', day: 1, time: '12:00', title: () => 'Highlights מעודכנים באינסטגרם' },
  { key: 'story', kind: 'story', place: 'nthWeekday', qty: (d) => d.stories, spread: true, week: 3, weekday: 4, time: '20:00', avoid: POSTS, title: (k, q) => `סטורי אצל המשפיענים${q > 1 ? ` ${k}` : ''}` },
  { key: 'collab', kind: 'collab', place: 'nthWeekday', qty: (d) => d.collabs, spread: true, week: 3, weekday: 3, time: '20:00', avoid: POSTS, title: (k, q) => `קולאב באינסטגרם${q > 1 ? ` ${k}` : ''}` },
  { key: 'ch14', kind: 'ch14', place: 'nthWeekday', qty: (d) => d.ch14, spread: true, week: 2, weekday: 0, time: null, avoid: ['holiday'], title: (k, q) => `אייטם בערוץ 14${q > 1 ? ` ${k}` : ''} (מועד השידור ייקבע עם הערוץ)` },
  { key: 'report', kind: 'report', place: 'businessDay', day: 3, time: '12:00', title: (m) => `דוח חודשי על חודש ${m - 1}` },
  { key: 'plan', kind: 'plan', place: 'businessDay', before: 1, time: '16:00', title: (m) => `תכנון חודש ${m}: תזמון התכנים ועדכון הגאנט` },
  { key: 'renewal', kind: 'renewal', place: 'fromEnd', days: -60, business: true, time: '11:00', title: () => 'שיחת חידוש (תהליך 34)' },
  { key: 'end', kind: 'end', place: 'fromEnd', days: 0, time: null, title: () => 'סיום שנת החבילה' },
];

// The month posts start in: the monthly cycle's first month.
export const POSTS_FROM = CYCLE_FROM;

// One sentence per rule, for the page ("איך התבנית בונה את הגאנט") and the docs.
export const TEMPLATE_TEXT = [
  'החודשים נספרים מיום החתימה (deal_at), בשעון ישראל: אותו יום בכל חודש, וה־31 הופך ליום האחרון בחודש.',
  `הפרסומים מתחילים בחודש ${POSTS_FROM}, החודש שבו מתחיל המחזור החודשי, ומתפזרים שווה עד סוף החבילה.`,
  'סרטונים: ימי ראשון, שלישי וחמישי ב־19:00. גרפיקות: ימי שני ורביעי ב־13:00. בכל חודש במרווחים שווים.',
  'לא מפרסמים בשבת, בחג ובערב חג; פרסום שנופל על יום כזה עובר ליום המותר הבא באותו חודש.',
  'צלם חודשי (כשנרכש): יום עסקים 10 בכל חודש ב־10:00, ו־8 התכנים שלו עולים בהמשך החודש, מיום העסקים ה־11, בימים ראשון עד חמישי ב־17:00.',
  'יום הצילום הראשון: התאריך שבכרטיס הלקוח, ואם אין עדיין, יום שלישי השני של החודש הראשון ב־10:00. ימי צילום נוספים, סטורי, קולאבים וערוץ 14: באותם חודשים שבשנת החבילה, בשבוע השלישי (ערוץ 14: בשבוע השני).',
  'Highlights: ביום העסקים הראשון של חודש הפרסומים הראשון.',
  'דוח חודשי: יום עסקים 3 בכל חודש. תכנון החודש של עילאי: יום העסקים שלפני תחילת החודש (פנימי).',
  'שיחת חידוש: 60 יום לפני סיום החוזה, ביום עסקים (פנימי). סיום שנת החבילה: תאריך סיום החוזה.',
];
