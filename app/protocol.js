// The office's general work protocol: the code mirror of docs/protocols/general.md.
// Item keys are stored with each check, so never rename or reuse a key; retire it
// instead and add a new one. Bump PROTOCOL_VERSION when the protocol changes.

export const PROTOCOL_VERSION = 1;

// Office hours. Deadlines of minutes or hours that start from an office event
// (a deal coming in, a finished process) run only inside these hours; a deal
// that arrives at night is due the next working morning. Proposal for the
// owner to confirm: see docs/protocols/roadmap.md, Q3.
export const WORK_HOURS = { start: 9, end: 18 };

// People named in the protocol. `key` is stored in the database (staff.person).
export const PEOPLE = {
  irit: { key: 'irit', name: 'עירית', role: 'מנהלת המשרד' },
  lior: { key: 'lior', name: 'ליאור', role: 'קמפיינים וניהול יום צילום' },
  ofir: { key: 'ofir', name: 'אופיר', role: 'אפיון ובקרת איכות' },
  shirel: { key: 'shirel', name: 'שיראל', role: 'כתיבת תוכן' },
  ilai: { key: 'ilai', name: 'עילאי', role: 'גרפיקה וסושיאל' },
  editor: { key: 'editor', name: 'עורך', role: 'עריכת וידאו' },
};

export const SHOOT_TYPES = {
  natali: { key: 'natali', name: 'נטלי דדון' },
  dms: { key: 'dms', name: 'דניס, מישל וסמיון' },
};

export const CLIENT_STATUS = {
  active: 'פעיל',
  ending: 'מסיים התקשרות',
  ended: 'הסתיים',
  cancelled: 'ההסכם בוטל',
};

// Processes that must be checked item by item, never with "mark the whole process":
// the ones with a hard rule (18, 19, 21), approval only (25), and the recurring call (31).
export const NO_BULK = new Set(['p18', 'p19', 'p21', 'p25', 'p31']);

// Links kept in the client card (never passwords), in display order, with the
// item after which each one is expected.
export const LINKS = [
  { key: 'whatsapp', label: 'קבוצת WhatsApp', after: 'p02.opened', hint: 'chat.whatsapp.com' },
  { key: 'drive', label: 'תיקיית Drive', after: 'p24.folder', hint: 'drive.google.com' },
  { key: 'scripts', label: 'תסריטים (Google Docs)', after: 'p12.docs', hint: 'docs.google.com' },
  { key: 'gantt', label: 'גאנט שנתי', after: 'p09.file', hint: 'docs.google.com/spreadsheets' },
  { key: 'dropbox', label: 'Dropbox', after: 'p24.dropbox', hint: 'dropbox.com' },
  { key: 'metricool', label: 'Metricool', after: 'p06.metricool', hint: 'metricool.com' },
  { key: 'meta', label: 'Meta Business', after: 'p10.ready', hint: 'business.facebook.com' },
];

// Package quantities shown in the card, in order.
export const DELIVERABLES = [
  { key: 'videos', label: 'סרטונים', one: 'סרטון' },
  { key: 'graphics', label: 'גרפיקות', one: 'גרפיקה' },
  { key: 'collabs', label: 'קולאבים', one: 'קולאב' },
  { key: 'stories', label: 'סטורי אצל המשפיענים', one: 'סטורי' },
  { key: 'ch14', label: 'אייטם בערוץ 14', one: 'אייטם' },
];

// The two daily reviews (processes 32 and 33) and what each one goes over.
export const REVIEW_TOPICS = {
  p32: ['חוזים', 'חתימות', 'קבוצות WhatsApp', 'הודעות פתיחה', 'אפיונים', 'ימי צילום', 'משימות', 'אישורי לקוחות', 'עובדים שטרם ביצעו משימות', 'לקוחות שצריך ליצור איתם קשר'],
  p33: ['איפה כל לקוח נמצא', 'מה חסר', 'למה חסר', 'אצל מי המשימה', 'מה תקוע', 'מה צריך לבצע היום'],
};

// The nine topics of the weekly call (process 31), in the protocol's order.
export const CALL_TOPICS = [
  ['campaigns', 'קמפיינים'], ['leads', 'לידים'], ['results', 'תוצאות'], ['videos', 'סרטונים'],
  ['published', 'תכנים שעלו'], ['upcoming', 'תכנים עתידיים'], ['problems', 'בעיות'],
  ['improve', 'דברים שצריך לשפר'], ['requests', 'בקשות חדשות'],
];

// Owners may depend on the client (who ran the characterization meeting).
const characterizer = (c) => (c.characterizer ? [c.characterizer] : ['ofir', 'shirel']);
const accessOwners = (c) => {
  if (c.characterizer === 'ofir') return ['ofir'];
  if (c.characterizer === 'shirel') return ['lior', 'irit'];
  return ['ofir', 'lior', 'irit'];
};
const isNatali = (c) => c.shoot_type === 'natali';
const isDms = (c) => c.shoot_type === 'dms';

// Anchors for due dates. `start` is when a process can begin; `due` is its deadline.
//   { from: 'deal' | 'char' | 'charEnd' | 'shoot' | 'contractEnd' | 'p05' … , minutes|hours|days|businessDays|at }
//   from 'pNN' means "when process NN was completed".
//   prevBusinessDay: the business day before the anchor ("the day before the shoot").
// `sla` is the protocol's own wording and is always shown.
// `round: true`: the process repeats for every extra shoot round (a second shoot day).
// Item `requires`: keys that must be done first ("only after Ofir approves").
// A process with several owners can be claimed by one of them (key `pNN.claim`).

export const PHASES = [
  { key: 'onboarding', title: 'קליטת לקוח ואפיון' },
  { key: 'parallel', title: 'מיד לאחר פגישת האפיון', note: 'התהליכים בשלב הזה מתחילים במקביל.' },
  { key: 'prep', title: 'הכנה ליום הצילום' },
  { key: 'eve', title: 'יום לפני הצילום', needs: ['shoot_type', 'shoot_at'] },
  { key: 'shoot', title: 'יום הצילום', needs: ['shoot_type', 'shoot_at'] },
  { key: 'post', title: 'עריכה ומסירה' },
  { key: 'publish', title: 'לאחר אישור התוכן' },
  { key: 'ongoing', title: 'ניהול שוטף' },
  { key: 'renewal', title: 'חידוש וסיום' },
];

export const PROCESSES = [
  {
    id: 'p01', num: '1', phase: 'onboarding', title: 'הכנת חוזה', owners: ['irit'],
    sla: 'עד 5 דקות מרגע קבלת פרטי העסקה מאיש המכירות',
    due: { from: 'deal', minutes: 5 },
    what: 'מכינים את החוזה בהתאם לחבילה ולתנאים שסגר איש המכירות, שולחים ללקוח ומוודאים שחתם בפועל במערכת.',
    items: [
      { key: 'p01.prepared', label: 'החוזה הוכן לפי החבילה והתנאים שסגר איש המכירות' },
      { key: 'p01.sent', label: 'החוזה נשלח ללקוח' },
      { key: 'p01.signed', label: 'הלקוח חתם בפועל על החוזה במערכת' },
    ],
  },
  {
    id: 'p02', num: '2', phase: 'onboarding', title: 'פתיחת קבוצת WhatsApp', owners: ['irit'],
    sla: 'עד 5 דקות מרגע קבלת פרטי הלקוח',
    due: { from: 'deal', minutes: 5 },
    what: 'פותחים קבוצת WhatsApp ללקוח. אחרי הפתיחה נשלחת הודעת היכרות מטעם ליאור ועירית.',
    items: [
      { key: 'p02.opened', label: 'הקבוצה נפתחה' },
      { key: 'p02.m.lior', label: 'ליאור בקבוצה' },
      { key: 'p02.m.irit', label: 'עירית בקבוצה' },
      { key: 'p02.m.ofir', label: 'אופיר בקבוצה' },
      { key: 'p02.m.shirel', label: 'שיראל בקבוצה' },
      { key: 'p02.m.ilai', label: 'עילאי בקבוצה' },
      { key: 'p02.m.client', label: 'הלקוח בקבוצה' },
      { key: 'p02.intro', label: 'נשלחה הודעת היכרות מטעם ליאור ועירית' },
    ],
  },
  {
    id: 'p03', num: '3', phase: 'onboarding', title: 'קביעת פגישת אפיון', owners: ['irit'],
    sla: 'עד 5 דקות מרגע שאיש המכירות שולח את פרטי הלקוח',
    due: { from: 'deal', minutes: 5 },
    what: 'בודקים מי מבצע את האפיון (אופיר או שיראל) ומתאמים עם הלקוח פגישה פיזית במועד המוקדם ביותר. עד 3 פגישות אפיון ביום; לכל פגישה משוריין חלון של שעתיים.',
    needs: ['characterizer', 'char_at'],
    items: [
      { key: 'p03.who', label: 'נקבע מי מבצע את האפיון (אופיר או שיראל)' },
      { key: 'p03.scheduled', label: 'נקבעה פגישה פיזית במועד המוקדם ביותר, בחלון של שעתיים' },
    ],
  },
  {
    id: 'p04', num: '4', phase: 'onboarding', title: 'ביצוע פגישת אפיון', owners: characterizer,
    sla: 'עד שעתיים',
    start: { from: 'char' }, due: { from: 'char', hours: 2 },
    what: 'מגיעים פיזית לעסק ועוברים עם הלקוח על כל המידע הנדרש לעבודה. בסיום הפגישה האפיון נשמר במערכת.',
    items: [
      { key: 'p04.address', label: 'כתובת מלאה של העסק' },
      { key: 'p04.phone', label: 'מספר טלפון תקין' },
      { key: 'p04.services', label: 'שירותים ומוצרים' },
      { key: 'p04.audiences', label: 'קהלי יעד' },
      { key: 'p04.advantages', label: 'יתרונות העסק' },
      { key: 'p04.goals', label: 'מטרות השיווק' },
      { key: 'p04.offers', label: 'מבצעים ומחירים' },
      { key: 'p04.content', label: 'צרכים לתוכן' },
      { key: 'p04.graphics', label: 'צרכים לגרפיקה' },
      { key: 'p04.campaigns', label: 'צרכים לקמפיינים' },
      { key: 'p04.special', label: 'דגשים מיוחדים' },
      { key: 'p04.saved', label: 'האפיון נשמר במערכת' },
    ],
  },
  {
    id: 'p05', num: '5', phase: 'onboarding', title: 'לקיחת גישות לרשתות', owners: accessOwners,
    ownerNote: 'אם אופיר מבצע את האפיון: אופיר. אם שיראל מבצעת: ליאור או עירית מבקשים את הגישות בקבוצת ה־WhatsApp.',
    sla: 'מיד במהלך או מיד לאחר פגישת האפיון',
    start: { from: 'char' }, due: { from: 'charEnd' },
    what: 'מקבלים מהלקוח גישה לכל הרשתות הרלוונטיות ולוקחים גם את חומרי המותג.',
    needs: ['characterizer', 'has_logo'],
    items: [
      { key: 'p05.access', label: 'התקבלה גישה לכל הרשתות הרלוונטיות' },
      { key: 'p05.logo', label: 'לוגו' },
      { key: 'p05.colors', label: 'צבעי מותג' },
      { key: 'p05.photos', label: 'תמונות' },
      { key: 'p05.videos', label: 'סרטונים קיימים' },
      { key: 'p05.menu', label: 'תפריט או מחירון', optional: true },
      { key: 'p05.newlogo', label: 'עילאי הכין לוגו חדש (אין ללקוח לוגו)', owners: ['ilai'], when: (c) => c.has_logo === false },
    ],
  },
  {
    id: 'p06', num: '6', phase: 'onboarding', title: 'בדיקת הגישות וסידור הרשתות', owners: ['ilai', 'shirel'],
    sla: 'עד 30 דקות מרגע קבלת הגישות',
    start: { from: 'p05' }, due: { from: 'p05', minutes: 30 },
    what: 'בודקים שכל שם משתמש וסיסמה עובדים. גישה לא תקינה: מתקשרים ללקוח ומאפסים או משחזרים איתו. אין עמודים: פותחים עמודים חדשים באותו חלון זמן.',
    items: [
      { key: 'p06.verified', label: 'כל שמות המשתמש והסיסמאות נבדקו ועובדים' },
      { key: 'p06.recovered', label: 'גישות לא תקינות אופסו או שוחזרו עם הלקוח', optional: true },
      { key: 'p06.newpages', label: 'נפתחו עמודים חדשים (אם לא היו)', optional: true },
      { key: 'p06.name', label: 'שם העמוד סודר' },
      { key: 'p06.bio', label: 'Bio נכתב או תוקן' },
      { key: 'p06.details', label: 'פרטי העסק עודכנו' },
      { key: 'p06.phone', label: 'הטלפון נבדק' },
      { key: 'p06.address', label: 'הכתובת נבדקה' },
      { key: 'p06.look', label: 'נראות העמוד סודרה' },
      { key: 'p06.metricool', label: 'כל הרשתות חוברו ל־Metricool' },
    ],
  },
  {
    id: 'p07', num: '7', phase: 'parallel', title: 'הכנת 9 גרפיקות ראשונות', owners: ['ilai'],
    sla: 'עד שעתיים לאחר האפיון',
    start: { from: 'charEnd' }, due: { from: 'charEnd', hours: 2 },
    what: 'עילאי מכין 9 גרפיקות לפי האפיון והשפה של העסק. עירית או ליאור בודקים, ואז הן נשלחות ללקוח לאישור. אם הלקוח לא מגיב תוך 10 דקות, עירית מתקשרת אליו.',
    items: [
      { key: 'p07.made', label: '9 גרפיקות הוכנו לפי האפיון ושפת העסק' },
      ...[['spelling', 'כתיב'], ['phone', 'טלפון'], ['address', 'כתובת'], ['logo', 'לוגו'], ['details', 'פרטי העסק'], ['wording', 'ניסוחים'], ['design', 'עיצוב']]
        .map(([k, l]) => ({ key: `p07.r.${k}`, label: `נבדק: ${l}`, owners: ['irit', 'lior'] })),
      { key: 'p07.sent', label: 'נשלחו ללקוח לאישור', owners: ['irit', 'lior'], requires: ['p07.r.spelling', 'p07.r.phone', 'p07.r.address', 'p07.r.logo', 'p07.r.details', 'p07.r.wording', 'p07.r.design'] },
      { key: 'p07.call', label: 'הלקוח לא הגיב תוך 10 דקות ועירית התקשרה', owners: ['irit'], optional: true },
      { key: 'p07.approved', label: 'הלקוח אישר את הגרפיקות', owners: ['irit', 'lior'] },
    ],
  },
  {
    id: 'p08', num: '8', phase: 'parallel', title: 'הכנת Highlights', owners: ['ofir'],
    sla: 'עד שעתיים לאחר האפיון, במקביל לגרפיקות',
    start: { from: 'charEnd' }, due: { from: 'charEnd', hours: 2 },
    what: 'אופיר מכין עד 4 Highlights לפי העסק והמידע מפגישת האפיון.',
    items: [
      { key: 'p08.done', label: 'הוכנו עד 4 Highlights לפי העסק והאפיון' },
    ],
  },
  {
    id: 'p09', num: '9', phase: 'parallel', title: 'פתיחת גאנט שנתי', owners: ['ilai'],
    sla: '5 דקות',
    start: { from: 'charEnd' }, due: { from: 'charEnd', minutes: 5 },
    what: 'עילאי פותח קובץ Excel שנתי ללקוח. בשלב זה מכינים רק את המבנה; הסרטונים נוספים אחרי העריכה.',
    items: [
      { key: 'p09.file', label: 'נפתח קובץ Excel שנתי ללקוח' },
      ...[['name', 'שם הלקוח'], ['months', 'כל חודשי השנה'], ['num', 'מספר סרטון'], ['link', 'קישור לסרטון'], ['day', 'יום'], ['date', 'תאריך'], ['time', 'שעה']]
        .map(([k, l]) => ({ key: `p09.c.${k}`, label: `בגאנט: ${l}` })),
    ],
  },
  {
    id: 'p10', num: '10', phase: 'parallel', title: 'סידור Meta ומנהל מודעות', owners: ['lior'],
    sla: 'עד שעתיים לאחר האפיון',
    start: { from: 'charEnd' }, due: { from: 'charEnd', hours: 2 },
    what: 'ליאור בודק שקיימת תשתית פרסום תקינה ב־Meta. אם אין, מקים ומסדר מנהל מודעות במלואו.',
    items: [
      { key: 'p10.checked', label: 'נבדקה תשתית הפרסום ב־Meta' },
      { key: 'p10.setup', label: 'הוקם וסודר מנהל מודעות (אם לא היה)', optional: true },
      { key: 'p10.ready', label: 'התשתית מוכנה לקמפיינים' },
    ],
  },
  {
    id: 'p11', round: true, num: '11', phase: 'prep', title: 'קביעת יום צילום', owners: ['irit'],
    sla: 'חובה לסגור תאריך בתוך עד 3 ימי עסקים מהאפיון',
    start: { from: 'charEnd' }, due: { from: 'char', businessDays: 3 },
    what: 'בודקים בחוזה אילו משפיענים הלקוח רכש ומתאמים מועד מול כל הצדדים. אחרי שכולם אישרו, מכניסים את יום הצילום ליומן של כולם.',
    needs: ['shoot_type', 'shoot_at'],
    items: [
      { key: 'p11.influencers', label: 'נבדק בחוזה אילו משפיענים נרכשו' },
      { key: 'p11.ok.client', label: 'הלקוח אישר את המועד' },
      { key: 'p11.ok.influencers', label: 'המשפיענים אישרו' },
      { key: 'p11.ok.lior', label: 'ליאור (מנהל יום הצילום) אישר' },
      { key: 'p11.ok.shirel', label: 'שיראל (כותבת התוכן) אישרה' },
      { key: 'p11.ok.photographer', label: 'הצלם אישר' },
      { key: 'p11.calendar', label: 'יום הצילום הוכנס ליומן של כולם', requiresFields: ['shoot_type', 'shoot_at'] },
    ],
  },
  {
    id: 'p11b', round: true, num: '11ב', phase: 'prep', title: 'יום צילום עם נטלי: מאפרת והסעה', owners: ['lior'],
    sla: 'מיד לאחר שנסגר תאריך יום הצילום עם נטלי',
    when: isNatali, start: { from: 'p11' }, due: { from: 'p11' },
    what: 'יום צילום עם נטלי לא נחשב סגור עד שגם המאפרת וגם ההסעה סודרו.',
    items: [
      { key: 'p11b.makeup', label: 'מאפרת תואמה, מגיעה לביתה של נטלי שעתיים לפני הצילום' },
      { key: 'p11b.ride', label: 'הסעה של נטלי לבית העסק וחזרה סודרה' },
    ],
  },
  {
    id: 'p12', round: true, num: '12', phase: 'prep', title: 'כתיבת התוכן ליום הצילום', owners: ['shirel'],
    sla: 'עד 3 ימי עסקים מפגישת האפיון',
    start: { from: 'charEnd' }, due: { from: 'char', businessDays: 3 },
    what: 'שיראל עוברת לעומק על האפיון, מתקשרת ללקוח לדגשים, ומכינה בדרך כלל 36 תסריטים לפי החבילה, האפיון, השיחה והמשפיענים.',
    guidance: {
      natali: 'יום עם נטלי: הפניות ברורות לצופה, ראיונות עם הלקוח, סרטוני הסברה, היכרות עם העסק והמקום, הצגת השירותים, מיני־סצנות ותוכן מקצועי. תוכן מסודר, מקצועי ומניע לפעולה.',
      dms: 'יום עם דניס, מישל וסמיון: סרטונים מצחיקים, רעיונות משוגעים, תוכן ויראלי, סצנות באנרגיה גבוהה, וגם הסברה, היכרות וראיונות. בראיונות חייבים למקד אותם בשאלות ובמסרים שנקבעו מראש.',
    },
    items: [
      { key: 'p12.read', label: 'האפיון נקרא לעומק' },
      { key: 'p12.call', label: 'בוצעה שיחה עם הלקוח לדגשים לסרטונים' },
      ...[['services', 'אילו שירותים חשוב לו לקדם'], ['messages', 'אילו מסרים חשובים'], ['dont', 'דברים שאסור להגיד'], ['products', 'מוצרים מרכזיים'], ['offers', 'מבצעים'], ['faq', 'שאלות נפוצות'], ['topics', 'נושאים שהוא רוצה שיופיעו בצילום']]
        .map(([k, l]) => ({ key: `p12.t.${k}`, label: `נלקח מהלקוח: ${l}` })),
      { key: 'p12.scripts', label: 'התסריטים הוכנו (בדרך כלל 36) לפי החבילה והמשפיענים' },
      { key: 'p12.docs', label: 'התסריטים מסודרים ב־Google Docs לפי סדר הצילום' },
    ],
  },
  {
    id: 'p13', round: true, num: '13', phase: 'prep', title: 'שיחת Zoom לאישור התוכן', owners: ['shirel'],
    sla: '3 ימי עסקים לאחר פגישת האפיון, ללא הגבלת משך עד שהלקוח מאשר',
    start: { from: 'p12' }, due: { from: 'char', businessDays: 3 },
    what: 'שיחת Zoom מוקלטת עם הלקוח על התוכן, עם שינויים והבהרות עד שהלקוח מאשר. תיקונים שנשארו: שיראל, עד יום עסקים אחד.',
    items: [
      { key: 'p13.zoom', label: 'התקיימה שיחת Zoom מוקלטת' },
      { key: 'p13.approved', label: 'הלקוח אישר את התסריטים' },
      { key: 'p13.fixes', label: 'תיקונים שנשארו אחרי השיחה בוצעו (עד יום עסקים אחד)', optional: true },
    ],
  },
  {
    id: 'p14', round: true, num: '14', phase: 'prep', title: 'Follow-up עד יום הצילום', owners: ['irit'],
    sla: 'מעקב שוטף מדי יום עד יום הצילום',
    start: { from: 'charEnd' }, due: { from: 'shoot' },
    what: 'מוודאים שאין דבר שיכול לעצור את יום הצילום. מסמנים כל נושא כשהוא סגור.',
    items: [
      { key: 'p14.approvals', label: 'אישורי לקוח' },
      { key: 'p14.scripts', label: 'תסריטים' },
      { key: 'p14.graphics', label: 'גרפיקות' },
      { key: 'p14.access', label: 'גישות' },
      { key: 'p14.shootday', label: 'יום צילום' },
      { key: 'p14.team', label: 'משימות צוות' },
      { key: 'p14.missing', label: 'חוסרים מהלקוח' },
    ],
  },
  {
    id: 'p15', round: true, num: '15', phase: 'eve', title: 'תזכורת לצוות וללקוח', owners: ['shirel', 'lior'],
    sla: 'יום לפני הצילום, בסביבות 11:00',
    start: { from: 'shoot', prevBusinessDay: true, at: '00:00' }, due: { from: 'shoot', prevBusinessDay: true, at: '11:00' },
    what: 'שולחים תזכורת ומוודאים שלכולם יש שעה, כתובת, תוכן מאושר ופרטי יום הצילום. בנוסף, שיחת הסבר עם הלקוח על מהלך היום ומה להכין.',
    items: [
      { key: 'p15.influencers', label: 'נשלחה תזכורת למשפיענים' },
      { key: 'p15.client', label: 'נשלחה תזכורת ללקוח' },
      { key: 'p15.crew', label: 'נשלחה תזכורת לצוות יום הצילום' },
      ...[['time', 'שעה'], ['address', 'כתובת'], ['content', 'תוכן מאושר'], ['details', 'פרטי יום הצילום']]
        .map(([k, l]) => ({ key: `p15.d.${k}`, label: `לכולם יש: ${l}` })),
      { key: 'p15.explain', label: 'בוצעה שיחת הסבר עם הלקוח' },
      { key: 'p15.natali.makeup', label: 'המאפרת אישרה הגעה לביתה של נטלי שעתיים לפני הצילום', owners: ['lior'], when: isNatali },
      { key: 'p15.natali.ride', label: 'ההסעה של נטלי סגורה ומאושרת', owners: ['lior'], when: isNatali },
    ],
  },
  {
    id: 'p16', round: true, num: '16', phase: 'eve', title: 'וידוא אחרון לפני יום הצילום', owners: ['shirel', 'lior'],
    sla: 'בערב שלפני יום הצילום',
    start: { from: 'shoot', prevBusinessDay: true, at: '00:00' }, due: { from: 'shoot', days: 0, at: '00:00' },
    items: [
      { key: 'p16.content', label: 'התוכן מוכן ומאושר' },
      { key: 'p16.influencers', label: 'המשפיענים קיבלו תזכורת' },
      { key: 'p16.address', label: 'יש לכולם כתובת' },
      { key: 'p16.photographer', label: 'הצלם קיבל תדרוך' },
      { key: 'p16.client', label: 'הלקוח קיבל הסבר' },
      { key: 'p16.drive', label: 'הכונן מוכן' },
    ],
  },
  {
    id: 'p17', round: true, num: '17', phase: 'shoot', title: 'הכנת המקום לפני הגעת המשפיענים', owners: ['lior', 'shirel'],
    ownerNote: 'ליאור, שיראל והצלם. מנהל יום הצילום: ליאור בלבד.',
    sla: 'שעה לפני הגעת המשפיענים',
    start: { from: 'shoot', hours: -1 }, due: { from: 'shoot' },
    items: [
      { key: 'p17.place', label: 'העסק סודר' },
      { key: 'p17.client', label: 'הלקוח הוכן' },
      { key: 'p17.order', label: 'עברנו על סדר התסריטים' },
      { key: 'p17.zones', label: 'הוכנו אזורי צילום' },
      { key: 'p17.brief', label: 'הצלם תודרך' },
      { key: 'p17.broll', label: 'הצלם התחיל לצלם B-Roll' },
    ],
  },
  {
    id: 'p18', round: true, num: '18', phase: 'shoot', title: 'מעקב אחר הסרטונים במהלך הצילום', owners: ['lior', 'shirel'],
    sla: 'לאורך כל יום הצילום',
    start: { from: 'shoot' }, due: { from: 'shoot', days: 0, at: '23:59' },
    what: 'עובדים לפי סדר התסריטים ב־Google Docs. כל סרטון שהסתיים מסומן בירוק וממשיכים לבא.',
    rule: 'אסור לסיים יום צילום לפני שצולמה כל כמות הסרטונים שהלקוח צריך לקבל.',
    items: [
      { key: 'p18.order', label: 'עבדנו לפי סדר התסריטים וסימנו כל סרטון בירוק' },
      { key: 'p18.all', label: 'צולמה כל כמות הסרטונים שהלקוח צריך לקבל' },
    ],
  },
  {
    id: 'p19', round: true, num: '19', phase: 'shoot', title: 'סיום יום צילום', owners: ['lior', 'shirel'],
    sla: 'מיד בסיום הצילום ולפני שהצוות עוזב',
    start: { from: 'shoot' }, due: { from: 'shoot', days: 0, at: '23:59' },
    rule: 'אסור לעזוב יום צילום בלי סרטון המלצה ובלי בדיקה שהחומרים נמצאים בכונן.',
    items: [
      { key: 'p19.testimonial', label: 'צולם סרטון המלצה של הלקוח עם המשפיענים (חובה)' },
      { key: 'p19.drive', label: 'כל חומרי הצילום נמצאים בכונן', owners: ['shirel'] },
      { key: 'p19.took', label: 'הכונן נלקח מהצלם' },
    ],
  },
  {
    id: 'p20', round: true, num: '20', phase: 'shoot', title: 'ניהול יום צילום עם נטלי דדון', owners: ['lior', 'shirel'],
    sla: 'צילום בפועל עד 3 שעות',
    when: isNatali, start: { from: 'shoot' }, due: { from: 'shoot', hours: 3 },
    what: 'יום ממוקד לפי התסריטים שאושרו: הפניות לצופה, ראיון עם הלקוח, הסברה, היכרות עם העסק והמקום, הצגת שירותים ומיני־סצנות. מסר ברור, מקצועי ומניע לפעולה, לא קומדיה מוגזמת.',
    items: [
      { key: 'p20.focus', label: 'הצילום התנהל לפי התסריטים המאושרים' },
      { key: 'p20.window', label: 'חלון שלוש השעות לא בוזבז על התארגנויות או נושאים לא קשורים' },
    ],
  },
  {
    id: 'p21', round: true, num: '21', phase: 'shoot', title: 'ניהול יום צילום עם דניס, מישל וסמיון', owners: ['lior', 'shirel'],
    sla: 'צילום בפועל כ־5 שעות, אחרי עד חצי שעה התארגנות',
    when: isDms, start: { from: 'shoot' }, due: { from: 'shoot', minutes: 330 },
    what: 'עם ההגעה: עד חצי שעה להתרענן, לאכול, להתארגן ולקבל תדרוך. רוב התוכן מצחיק, משוגע, אנרגטי וויראלי, ובנוסף הסברה, היכרות עם העסק והשירותים וראיונות עם הלקוח.',
    rule: 'בראיונות ממקדים את דניס, מישל וסמיון בשאלה ובמסר שאושרו מראש. שיחה שגולשת: עוצרים, ממקדים וחוזרים לשאלה.',
    items: [
      { key: 'p21.break', label: 'ניתנה עד חצי שעה להתארגנות ותדרוך, ואז התחלנו' },
      { key: 'p21.fun', label: 'צולם התוכן המצחיק, האנרגטי והוויראלי' },
      { key: 'p21.explain', label: 'צולמו סרטוני הסברה והיכרות עם העסק והשירותים' },
      { key: 'p21.interviews', label: 'צולמו ראיונות עם הלקוח, ממוקדים בשאלות ובמסרים שאושרו' },
    ],
  },
  {
    id: 'p22', round: true, num: '22', phase: 'post', title: 'עריכת 36 הסרטונים', owners: ['editor'],
    ownerNote: 'בסיום יום הצילום אופיר בוחר איזה עורך יערוך את חומר הגלם.',
    sla: 'עד 5 ימי עסקים; הספירה מתחילה ביום העסקים שאחרי יום הצילום',
    start: { from: 'shoot' }, due: { from: 'shoot', businessDays: 5 },
    what: 'חמשת ימי העסקים כוללים עריכה, בדיקה, המתנה לתגובת הלקוח וסבב תיקונים אחד.',
    items: [
      { key: 'p22.assigned', label: 'אופיר בחר עורך', owners: ['ofir'] },
      { key: 'p22.edited', label: 'כל הסרטונים נערכו' },
    ],
  },
  {
    id: 'p23', num: '23', phase: 'post', title: 'הכנת יתרת הגרפיקות', owners: ['ilai'],
    sla: 'עד יום עסקים אחד, במקביל לעריכת הסרטונים',
    start: { from: 'shoot' }, due: { from: 'shoot', businessDays: 1 },
    what: 'משלימים את כל 36 הגרפיקות (בדרך כלל עוד 27). אופיר בודק; אחרי אישורו נשלחות ללקוח. אם הלקוח לא מגיב תוך 10 דקות, עירית מתקשרת.',
    items: [
      { key: 'p23.made', label: 'כל הגרפיקות הושלמו (בדרך כלל עוד 27)' },
      { key: 'p23.ofir', label: 'אופיר בדק ואישר', owners: ['ofir'] },
      { key: 'p23.sent', label: 'נשלחו ללקוח', owners: ['irit'], requires: ['p23.ofir'] },
      { key: 'p23.call', label: 'הלקוח לא הגיב תוך 10 דקות ועירית התקשרה', owners: ['irit'], optional: true },
    ],
  },
  {
    id: 'p24', round: true, num: '24', phase: 'post', title: 'העלאת הסרטונים המוכנים', owners: ['editor', 'ofir'],
    sla: 'מיד ברגע שהעריכה הסתיימה',
    start: { from: 'p22' }, due: { from: 'p22' },
    items: [
      { key: 'p24.folder', label: 'נפתחה תיקייה מסודרת עם שם הלקוח', owners: ['ofir'] },
      { key: 'p24.drive', label: 'התוכן הועלה ל־Google Drive', owners: ['editor'] },
      { key: 'p24.dropbox', label: 'התוכן הועלה ל־Dropbox (לפי הצורך)', owners: ['editor'], optional: true },
      { key: 'p24.notify', label: 'נשלחה הודעה בקבוצת העורכים שהלקוח מוכן', owners: ['editor'] },
    ],
  },
  {
    id: 'p25', round: true, num: '25', phase: 'post', title: 'בדיקת הסרטונים', owners: ['ofir'],
    sla: 'עד שעה מרגע שהעורך הודיע שהחומרים מוכנים',
    start: { from: 'p24' }, due: { from: 'p24', hours: 1 },
    rule: 'רק לאחר אישור אופיר מותר לשלוח את הסרטונים ללקוח.',
    items: [
      { key: 'p25.qa', label: 'בוצעה בקרת איכות על כל הסרטונים' },
      { key: 'p25.approved', label: 'אופיר אישר שליחה ללקוח' },
    ],
  },
  {
    id: 'p26', round: true, num: '26', phase: 'post', title: 'שליחת הסרטונים ללקוח', owners: ['irit'],
    sla: 'מיד לאחר אישור אופיר',
    start: { from: 'p25' }, due: { from: 'p25' },
    items: [
      { key: 'p26.sent', label: 'הסרטונים נשלחו ללקוח לאישור', requires: ['p25.approved'] },
      { key: 'p26.call', label: 'הלקוח לא הגיב תוך 5 דקות ועירית התקשרה לוודא שראה', optional: true },
    ],
  },
  {
    id: 'p27', round: true, num: '27', phase: 'post', title: 'תיקוני וידאו', owners: ['editor'],
    sla: 'תיקונים שהתקבלו בזמן במהלך היום: באותו יום. מאוחר: עד יום עסקים אחד',
    start: { from: 'p26' }, due: { from: 'p26', businessDays: 1 },
    items: [
      { key: 'p27.fixes', label: 'בוצע סבב תיקונים אחד לפי ההערות שאושרו מול הלקוח', optional: true },
      { key: 'p27.approved', label: 'הלקוח אישר את הסרטונים', owners: ['irit'] },
    ],
  },
  {
    id: 'p28', round: true, num: '28', phase: 'publish', title: 'תזמון שנתי', owners: ['ilai'],
    ownerNote: 'עילאי או מנהל הסושיאל.',
    sla: 'עד שעתיים מרגע שהתוכן מוכן ומאושר',
    start: { from: 'p27' }, due: { from: 'p27', hours: 2 },
    items: [
      { key: 'p28.scheduled', label: 'הסרטונים והגרפיקות תוזמנו מראש לפי הכמות והתדירות בחבילה' },
    ],
  },
  {
    id: 'p29', round: true, num: '29', phase: 'publish', title: 'מילוי הגאנט ושליחה ללקוח', owners: ['ilai', 'irit'],
    sla: 'במקביל לתזמון, בתוך אותן שעתיים',
    start: { from: 'p27' }, due: { from: 'p27', hours: 2 },
    what: 'על כל תוכן שמתוזמן מעדכנים בגאנט מספר סרטון, קישור, יום, תאריך ושעה, כך שהגאנט והתזמון תמיד תואמים.',
    items: [
      { key: 'p29.filled', label: 'הגאנט מלא ותואם לתזמון בפועל', owners: ['ilai'] },
      { key: 'p29.told', label: 'עילאי עדכן את עירית שהגאנט מוכן', owners: ['ilai'] },
      { key: 'p29.sent', label: 'הגאנט הועבר ללקוח', owners: ['irit'], requires: ['p29.filled'] },
    ],
  },
  {
    id: 'p30', round: true, num: '30', phase: 'publish', title: 'בניית הקמפיינים', owners: ['lior'],
    sla: 'עד יום עסקים אחד מרגע קבלת הסרטונים המוכנים',
    start: { from: 'p25' }, due: { from: 'p25', businessDays: 1 },
    items: [
      { key: 'p30.picked', label: 'נבחרו הסרטונים המתאימים' },
      { key: 'p30.live', label: 'הוקמו קמפיינים לפי הצרכים, המטרות והתקציב של הלקוח' },
    ],
  },
  {
    id: 'p31', num: '31', phase: 'ongoing', title: 'שיחת לקוח שבועית', owners: ['lior'],
    sla: 'פעם בשבוע, בימי רביעי או חמישי',
    recurring: 'weekly', start: { from: 'p30' },
    what: 'עוברים עם הלקוח על קמפיינים, לידים, תוצאות, סרטונים, תכנים שעלו, תכנים עתידיים, בעיות, דברים שצריך לשפר ובקשות חדשות. הכול מתועד בסיכום השיחה; כל משימה נפתחת ברשימת המשימות עם מבצע.',
    items: [
      { key: 'p31.call', label: 'בוצעה שיחה שבועית ותועדה', recurring: 'weekly' },
    ],
  },
  {
    id: 'p34', num: '34', phase: 'renewal', title: 'חידוש חוזה', owners: ['lior'],
    sla: 'מתחילים 60 יום לפני סיום החוזה',
    start: { from: 'contractEnd', days: -60 }, due: { from: 'contractEnd', days: -60, at: '23:59' },
    items: [
      { key: 'p34.talk', label: 'התחלנו לדבר עם הלקוח על המשך העבודה' },
      { key: 'p34.satisfaction', label: 'נבדקה שביעות רצון' },
      { key: 'p34.issues', label: 'טופלו נושאים שיכולים להשפיע על החידוש' },
    ],
  },
  {
    id: 'p35', num: '35', phase: 'renewal', title: 'סיום התקשרות', owners: ['lior'],
    sla: 'במועד סיום העבודה עם הלקוח',
    when: (c) => c.status === 'ending' || c.status === 'ended', due: { from: 'contractEnd' },
    items: [
      { key: 'p35.campaigns', label: 'הקמפיינים נעצרו' },
      { key: 'p35.access', label: 'הוסרו גישות לפי הצורך' },
      { key: 'p35.connections', label: 'נסגרו חיבורים רלוונטיים' },
    ],
  },
];

// Processes 32 and 33 are office-wide daily reviews, served by the control view.
export const OFFICE_REVIEWS = [
  { num: '32', title: 'בקרה על ביצוע המשימות', owner: 'irit', sla: 'בכל יום עבודה' },
  { num: '33', title: 'בקרה על כל רשימת הלקוחות', owner: 'ofir', sla: 'בכל יום עבודה' },
];
