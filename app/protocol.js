// The office's work protocol: the code mirror of docs/protocols/general.md merged
// with each employee's protocol (docs/protocols/irit.md, lior.md, ofir.md,
// nirel.md, editors.md). Where they differ, the employee protocols are newer and
// win; every such choice is listed in docs/protocols/merge.md.
// Item keys are stored with each check, so never rename or reuse a key; retire it
// instead and add a new one. Bump PROTOCOL_VERSION when the protocol changes.
// Retired in v3 (Shirel removed from the protocol): p02.m.shirel, p11.ok.shirel.
// v5 (stage 3, part 2: the office's flows and the intake, one version):
//   - Retired: p29.told ("הגאנט מלא" tells Irit by itself, system-plan section 3).
//   - p27.toilai is Ilai's "קיבלתי" on the final versions (it closes the editing).
//   - Scripts are due at the end of business day 2 and the Zoom on day 3 (decision 14).
//   - After "the characterization ended" (the mark p04.ended, decision 12) the rest
//     of the form is due within 60 minutes.
// v6 (the owner's decisions of 3.10.2026):
//   - The shoot day (11, and Natali's 11ב) is set right after the WhatsApp group is
//     opened (anchor 'group'), by the end of the next business day; both moved to the
//     station "הצטרפות". Clients that started before keep the old timing
//     (protocol-versions.js `replace`).
//   - New: 7ב and 23ב, Ilai uploads the graphics the client approved within 30
//     office minutes; 23 gets the client's approval as an optional item (p23.approved,
//     until now only a mark of the status page).
// v7 (the owner's decision of 6.10.2026):
//   - New: 8ב, Ofir uploads the Highlights to the client's pages within 30 office
//     minutes of preparing them (process 8 complete), and marks it (p08b.posted).
// 7.10.2026, package 1 of the protocol audit (docs/ops.md, section 37), still v7: the
// words follow the owner's decisions (the files, the Gantt and the scripts are in the
// system, not in Drive, Excel or Google Docs; the contract has 10 office minutes).
// Keys are unchanged. One item no longer applies to anyone, p24.folder (Ofir's Drive
// folder): it stays in the data with `when: RETIRED`, so no client has it open and
// its old checks keep their place in the history. No item was added, so no client
// can become late from this and the version stays.

export const PROTOCOL_VERSION = 7;

// Office hours, in Israel time (decisions 1–2 in docs/plan/decisions.md).
// Deadlines of minutes or hours that start from an office event (a deal coming
// in, a finished process) run only inside these hours; a deal that arrives at
// night is due the next working morning. On erev chag (EREV in holidays.js) the
// office closes at erevEnd; Chol HaMoed is a normal day.
export const WORK_HOURS = { start: 9, end: 18, erevEnd: 13 };

// People named in the protocol. `key` is stored in the database (staff.person).
export const PEOPLE = {
  irit: { key: 'irit', name: 'עירית', role: 'מנהלת משרד ותפעול לקוחות' },
  lior: { key: 'lior', name: 'ליאור', role: 'ניהול, תוכן, קמפיינים וימי צילום' },
  ofir: { key: 'ofir', name: 'אופיר', role: 'אפיונים, פיקוח ובקרת איכות' },
  ilai: { key: 'ilai', name: 'עילאי', role: 'גרפיקה, סושיאל ותזמון' },
  nirel: { key: 'nirel', name: 'ניראל', role: 'עריכת סרטוני נטלי, גרפיקה ומשימות מורכבות', editor: true },
  nadia: { key: 'nadia', name: 'נדיה', role: 'עריכת וידאו', editor: true },
  yariv: { key: 'yariv', name: 'יריב', role: 'עריכת וידאו', editor: true },
  anna: { key: 'anna', name: 'אנה', role: 'עריכת וידאו', editor: true },
  eli: { key: 'eli', name: 'אלי', role: 'צלם ימי הצילום' },
  // Field sales (decision of 3.10.2026): sends new deals to Irit from deal.html and
  // sees only his own deals. Not part of the client protocol (no items, no clients).
  stav: { key: 'stav', name: 'סתיו', role: 'סוכן שטח', sales: true },
  amos: { key: 'amos', name: 'עמוס', role: 'סוכן שטח', sales: true },
  // Until Ofir assigns an editor, editing items belong to "the assigned editor".
  editor: { key: 'editor', name: 'העורך המשויך', role: 'עד ששויך עורך' },
};

// What each person sees when they sign in. 'office': their own work first, plus
// the office screens (all clients, daily control, performance). 'own': only their
// own work and the clients it belongs to. 'sales': only deal.html and their own
// deals (no client is theirs). The owner (no person) sees the office.
export const SCOPE = { irit: 'office', lior: 'office', ofir: 'office', ilai: 'own', nirel: 'own', nadia: 'own', yariv: 'own', anna: 'own', eli: 'own', stav: 'sales', amos: 'sales' };
export const scopeOf = (person) => (person ? SCOPE[person] || 'own' : 'office');
export const isSales = (person) => !!PEOPLE[person]?.sales;

// The people of the client protocol (everyone but the "assigned editor" placeholder
// and sales): for owner pickers, work lists and the reminders' digests.
export const STAFF_PEOPLE = () => Object.values(PEOPLE).filter((p) => p.key !== 'editor' && !p.sales);
// Everyone on the team, sales too: the team screen (team.html) and who has reminders.
export const TEAM_PEOPLE = () => Object.values(PEOPLE).filter((p) => p.key !== 'editor');

// Editors a client can be assigned to. Nirel edits only Natali Dadon's videos.
export const EDITORS = ['nadia', 'yariv', 'anna', 'nirel'];
export const editorsFor = (shootType) => (shootType === 'natali' ? EDITORS : EDITORS.filter((e) => e !== 'nirel'));

// Who can run the characterization meeting. Lior goes only when Ofir and Shirel cannot.
export const CHARACTERIZERS = ['ofir', 'lior'];

// Social networks kept in the access vault (the passwords themselves are encrypted in the database).
export const NETWORKS = [
  ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'],
  ['google', 'Google Business'], ['meta', 'Meta Business'], ['other', 'אחר'],
];

// Reasons to escalate to Lior (every employee protocol: "update Lior on any exception").
export const ESCALATIONS = [
  'עובד אינו עומד בזמן', 'לקוח אינו משתף פעולה', 'לקוח מתלונן', 'משימה תקועה', 'עיכוב ביום צילום',
  'בעיה בתהליך', 'בקשה חריגה של לקוח', 'בעיה בין עובדים', 'נדרשת החלטה ניהולית', 'אין מי שייצא לאפיון',
];

// A brief for tasks handed to Nirel (and anyone else who fixes something for a client):
// she does not work out alone what the client wants.
export const BRIEF_FIELDS = [
  ['problem', 'מה הבעיה המדויקת'], ['disliked', 'מה הלקוח לא אהב'], ['change', 'מה בדיוק צריך לשנות'], ['keep', 'מה צריך להישאר כמו שהוא'],
  ['result', 'מה התוצאה הרצויה'], ['materials', 'אילו חומרים רלוונטיים'],
];
export const BRIEF_REQUIRED = new Set(['nirel']);
// What Nirel must always receive (nirel.md): the problem, what to change, what stays, the result.
export const BRIEF_MUST = ['problem', 'change', 'keep', 'result'];

// Ofir's Thursday status summary for every client.
export const STATUS_FIELDS = [
  ['current', 'מצב נוכחי', 'איפה הלקוח נמצא עכשיו'], ['missing', 'מה חסר', 'מה עדיין לא בוצע'],
  ['next', 'פעולה הבאה', 'מה צריך לקרות עכשיו'],
];

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
// the ones with a hard rule (18, 19, 21), quality control (25), and the recurring call (31).
export const NO_BULK = new Set(['p18', 'p19', 'p21', 'p25', 'p31']);

// Links kept in the client card (never passwords), in display order, with the
// item after which each one is expected (`after: null`: never asked for) and the
// address it should look like (`hint`; null: any https address, with `placeholder`).
export const LINKS = [
  { key: 'whatsapp', label: 'קבוצת WhatsApp', after: 'p02.opened', hint: 'chat.whatsapp.com' },
  // Drive is only the client's archive outside the system (process 35): never asked for.
  { key: 'drive', label: 'ארכיון ב־Drive (לא חובה)', after: null, hint: 'drive.google.com' },
  { key: 'scripts', label: 'תסריטים (קישור לשיתוף)', after: 'p12.docs', hint: null, placeholder: 'הקישור לשיתוף מעמוד התסריטים' },
  // The Gantt is gantt.html; a sheet's link from before is still shown, never asked for.
  { key: 'gantt', label: 'גאנט ישן בגיליון (לא חובה)', after: null, hint: 'docs.google.com' },
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
  { key: 'monthly', label: 'תכנים מהצלם החודשי', one: 'תוכן' },
];

// Approvals that "not relevant" never replaces: what depends on them waits for a real approval.
export const APPROVALS = new Set(['p25.approved', 'p13.approved', 'p27.approved', 'p07.approved', 'p23.approved']);

// The two daily reviews (processes 32 and 33) and what each one goes over.
export const REVIEW_TOPICS = {
  p32: ['חוזים', 'חתימות', 'קבוצות WhatsApp', 'הודעות פתיחה', 'פגישות אפיון', 'ימי צילום', 'משימות פתוחות', 'אישורי לקוחות', 'תיקונים', 'עובדים שטרם סיימו משימות', 'לקוחות שצריך לחזור אליהם', 'הודעות יומיות ללקוחות'],
  p33: ['איפה כל לקוח נמצא', 'מה כבר בוצע', 'מה חסר ולמה', 'אצל מי המשימה ומתי היא אמורה להסתיים', 'האם הלקוח מחכה לתשובה או לחומר', 'מה תקוע ולמה', 'מה צריך לעשות כדי לקדם', 'תקינות המערכת: סטטוסים, אחראים ומועדי יעד'],
};

// The nine topics of the weekly call (process 31), in the protocol's order.
export const CALL_TOPICS = [
  ['campaigns', 'קמפיינים'], ['leads', 'לידים'], ['results', 'תוצאות'], ['videos', 'סרטונים'],
  ['published', 'תכנים שעלו'], ['upcoming', 'תכנים עתידיים'], ['problems', 'בעיות'],
  ['improve', 'דברים שצריך לשפר'], ['requests', 'בקשות חדשות'],
];

// Owners may depend on the client (who ran the characterization, which editor was assigned).
const characterizer = (c) => (c.characterizer ? [c.characterizer] : ['ofir']);
// Whoever characterizes takes the access in the meeting; otherwise Irit gets it from the client.
const accessOwners = (c) => (c.characterizer === 'ofir' || c.characterizer === 'lior' ? [c.characterizer] : ['irit']);
const editorOf = (c) => (c.editor ? [c.editor] : ['editor']);
const isNatali = (c) => c.shoot_type === 'natali';
const isDms = (c) => c.shoot_type === 'dms';
// An item that applies to no client any more (its key and its old checks stay).
const RETIRED = () => false;

// Anchors for due dates. `start` is when a process can begin; `due` is its deadline.
//   { from: 'deal' | 'group' | 'char' | 'charEnd' | 'shoot' | 'contractEnd' | 'p05' … , minutes|hours|days|businessDays|at }
//   'group': when the WhatsApp group was opened (p02.opened); inside a shoot round, the round's start.
//   from 'pNN' means "when process NN was completed"; 'item:pNN.x' when that one item was done.
//   prevBusinessDay: the business day before the anchor ("the day before the shoot").
//   afterMark: { key, minutes }: once that mark is done, the deadline is `minutes` after it.
// `sla` is the protocol's own wording and is always shown.
// `round: true`: the process repeats for every extra shoot round (a second shoot day).
// Item `noBulk`: a confirmation by the client or someone outside the office; never marked in bulk.
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

// The 8 stations of the client journey (docs/plan/system-plan.md, section 4):
// where an existing client is placed when imported, and the owner's bar. Each
// station is a run of processes in PROCESSES order; against PHASES above:
//   הצטרפות      onboarding 1–3 (the deal, the WhatsApp group, setting the meeting)
//                and, since v6, 11 and 11ב (the shoot day is set right after the group)
//   אפיון        onboarding 4–6 (the meeting, access, the pages) + parallel 7, 7ב, 8, 8ב, 9, 10
//   תוכן ואישור  prep (12א, 12, 13, 14)
//   יום צילום    eve (15, 16) + shoot (17–21, with 17ב, 18ב, 19ב)
//   עריכה ובקרה  post (22א, 22, 23, 23ב, 24, 25, 26, 27)
//   פרסום        publish (28, 29, 30)
//   שוטף         ongoing (31)
//   חידוש        renewal (34, 35)
// tests/client-open.test.mjs checks that every process sits in exactly one station.
export const STATIONS = [
  { key: 'join', title: 'הצטרפות', procs: ['p01', 'p02', 'p03', 'p11', 'p11b'] },
  { key: 'char', title: 'אפיון', procs: ['p04', 'p05', 'p06', 'p07', 'p07b', 'p08', 'p08b', 'p09', 'p10'] },
  { key: 'content', title: 'תוכן ואישור', procs: ['p12a', 'p12', 'p13', 'p14'] },
  { key: 'shoot', title: 'יום צילום', procs: ['p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p20', 'p21'] },
  { key: 'post', title: 'עריכה ובקרה', procs: ['p22a', 'p22', 'p23', 'p23b', 'p24', 'p25', 'p26', 'p27'] },
  { key: 'publish', title: 'פרסום', procs: ['p28', 'p29', 'p30'] },
  { key: 'ongoing', title: 'שוטף', procs: ['p31'] },
  { key: 'renewal', title: 'חידוש', procs: ['p34', 'p35'] },
];

export const PROCESSES = [
  {
    id: 'p01', num: '1', phase: 'onboarding', title: 'הכנת חוזה', owners: ['irit'],
    // 10 office minutes (the owner's decision of 3.10.2026; DEAL_MINUTES in deal-logic.js).
    sla: 'עד 10 דקות עבודה מרגע קבלת פרטי העסקה מאיש המכירות',
    due: { from: 'deal', minutes: 10 },
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
      { key: 'p02.m.ilai', label: 'עילאי בקבוצה' },
      { key: 'p02.m.client', label: 'הלקוח בקבוצה' },
      { key: 'p02.intro', label: 'נשלחה הודעת היכרות מטעם ליאור ועירית', owners: ['irit', 'lior'] },
      { key: 'p02.deal', label: 'ליאור בדק שאין בעסקה או בחבילה משהו חריג שדורש טיפול ניהולי', owners: ['lior'] },
      { key: 'p02.team', label: 'ליאור וידא שהלקוח יודע מי הגורמים שמטפלים בו', owners: ['lior'] },
    ],
  },
  {
    id: 'p03', num: '3', phase: 'onboarding', title: 'קביעת פגישת אפיון', owners: ['irit'],
    sla: 'עד 5 דקות מרגע שאיש המכירות שולח את פרטי הלקוח',
    due: { from: 'deal', minutes: 5 },
    what: 'בודקים את הזמינות של מבצע האפיון (אופיר), ומתאמים עם הלקוח פגישה פיזית במועד המוקדם ביותר. עד 3 פגישות אפיון ביום; לכל פגישה משוריין חלון של שעתיים. פתיחת הקבוצה וקביעת האפיון נעשות במקביל.',
    ownerNote: 'ליאור יוצא לאפיון רק כשאופיר לא יכול ואין עובד אחר. אופיר מודיע לו ומעביר שם, מועד, כתובת ושעה.',
    needs: ['characterizer', 'char_at'],
    items: [
      { key: 'p03.who', label: 'נקבע מי מבצע את האפיון (אופיר, או ליאור כשאופיר לא יכול)' },
      { key: 'p03.available', label: 'נבדקה זמינות מבצע האפיון' },
      { key: 'p03.scheduled', label: 'נקבעה פגישה פיזית במועד המוקדם ביותר, בחלון של שעתיים', requiresFields: ['characterizer', 'char_at'] },
      { key: 'p03.calendar', label: 'הפגישה הוכנסה ליומן' },
    ],
  },
  {
    id: 'p11', round: true, num: '11', phase: 'onboarding', title: 'קביעת יום צילום', owners: ['irit'],
    sla: 'מיד אחרי פתיחת קבוצת ה־WhatsApp, במועד המוקדם ביותר; סגור עד סוף יום העסקים שאחרי פתיחת הקבוצה',
    // v6 (3.10.2026): right after the group is opened, not after the characterization.
    // Lior does not set the date (he confirms he can run it, p11.ok.lior).
    start: { from: 'group' }, due: { from: 'group', businessDays: 1 },
    what: 'מיד אחרי פתיחת הקבוצה קובעים את יום הצילום במועד המוקדם ביותר. בודקים בחוזה אילו משפיענים הלקוח רכש ומתאמים מועד מול כל הצדדים. יום הצילום לא נחשב סגור עד שכולם אישרו והתאריך ביומן של כולם ובמערכת.',
    needs: ['shoot_type', 'shoot_at'],
    items: [
      { key: 'p11.influencers', label: 'נבדק בחוזה אילו משפיענים נרכשו' },
      { key: 'p11.ok.client', label: 'הלקוח אישר את המועד', noBulk: true },
      { key: 'p11.ok.influencers', label: 'המשפיענים אישרו', noBulk: true },
      { key: 'p11.ok.lior', label: 'ליאור (מנהל יום הצילום) אישר', noBulk: true },
      { key: 'p11.ok.photographer', label: 'הצלם אישר', noBulk: true },
      { key: 'p11.calendar', label: 'יום הצילום הוכנס ליומן של כולם', requiresFields: ['shoot_type', 'shoot_at'] },
    ],
  },
  {
    id: 'p11b', round: true, num: '11ב', phase: 'onboarding', title: 'יום צילום עם נטלי: מאפרת והסעה', owners: ['lior'],
    sla: 'מיד לאחר שנסגר תאריך יום הצילום עם נטלי',
    when: isNatali, start: { from: 'p11' }, due: { from: 'p11' },
    what: 'יום צילום עם נטלי לא נחשב סגור עד שגם המאפרת וגם ההסעה סודרו.',
    items: [
      { key: 'p11b.makeup', label: 'מאפרת תואמה, מגיעה לביתה של נטלי שעתיים לפני הצילום' },
      { key: 'p11b.ride', label: 'הסעה של נטלי לבית העסק וחזרה סודרה' },
    ],
  },
  {
    id: 'p04', num: '4', phase: 'onboarding', title: 'ביצוע פגישת אפיון', owners: characterizer,
    sla: 'עד שעתיים; אחרי "האפיון הסתיים" שאר הטופס תוך 60 דקות',
    // Decision 12: once "the characterization ended" is marked (with its 4 short
    // fields), the full form is due 60 minutes later.
    start: { from: 'char' }, due: { from: 'char', hours: 2, afterMark: { key: 'p04.ended', minutes: 60 } },
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
      { key: 'p04.saved', label: 'האפיון נשמר במערכת בצורה מלאה וברורה' },
      { key: 'p04.followup', label: 'עירית וידאה שהאפיון התקיים ונשמר ושאין מידע שחסר להמשך (חוסר: לליאור)', owners: ['irit'] },
      { key: 'p04.tasks', label: 'עירית וידאה שנפתחו כל המשימות שצריכות להתחיל אחרי האפיון', owners: ['irit'] },
    ],
  },
  {
    id: 'p05', num: '5', phase: 'onboarding', title: 'לקיחת גישות לרשתות', owners: accessOwners,
    ownerNote: 'מי שמבצע את האפיון לוקח את הגישות בפגישה. אחרת עירית בודקת מול הלקוח אילו רשתות יש לו ואם הוא יודע את הגישות. גישה שלא עובדת: משימה לליאור. אין רשתות: משימה לעילאי לפתוח.',
    sla: 'מיד במהלך או מיד לאחר פגישת האפיון',
    start: { from: 'char' }, due: { from: 'charEnd' },
    what: 'מקבלים מהלקוח גישה לכל הרשתות הרלוונטיות ולוקחים גם את חומרי המותג.',
    rule: 'כל גישה תקינה נכנסת מיד לכספת הגישות במערכת. אין להשאיר גישות רק בוואטסאפ, בהודעות פרטיות או אצל אחד העובדים.',
    needs: ['characterizer', 'has_logo'],
    items: [
      { key: 'p05.access', label: 'התקבלה גישה לכל הרשתות הרלוונטיות' },
      { key: 'p05.vault', label: 'כל הגישות הוכנסו לכספת הגישות במערכת', owners: ['irit'] },
      { key: 'p05.logo', label: 'לוגו' },
      { key: 'p05.colors', label: 'צבעי מותג' },
      { key: 'p05.photos', label: 'תמונות' },
      { key: 'p05.videos', label: 'סרטונים קיימים' },
      { key: 'p05.menu', label: 'תפריט או מחירון', optional: true },
      { key: 'p05.newlogo', label: 'עילאי הכין לוגו חדש (אין ללקוח לוגו)', owners: ['ilai'], when: (c) => c.has_logo === false },
    ],
  },
  {
    id: 'p06', num: '6', phase: 'onboarding', title: 'בדיקת הגישות וסידור הרשתות', owners: ['ilai'],
    sla: 'עד 30 דקות מרגע קבלת הגישות',
    start: { from: 'item:p05.access' }, due: { from: 'item:p05.access', minutes: 30 },
    what: 'בודקים שכל שם משתמש וסיסמה עובדים. גישה לא תקינה: מתקשרים ללקוח ומאפסים או משחזרים איתו. אין עמודים: פותחים עמודים חדשים באותו חלון זמן.',
    items: [
      { key: 'p06.verified', label: 'כל שמות המשתמש והסיסמאות נבדקו ועובדים' },
      { key: 'p06.recovered', label: 'גישות לא תקינות אופסו או שוחזרו עם הלקוח והוכנסו לכספת', owners: ['lior'], optional: true },
      { key: 'p06.newpages', label: 'נפתחו רשתות חדשות (אם לא היו) והגישות הוכנסו לכספת', owners: ['ilai'], optional: true },
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
      // noBulk on the marks that hand finished files on (7, 23, 24, 27): each is pressed
      // where the files are uploaded, never with "mark the whole process".
      { key: 'p07.made', label: '9 גרפיקות הוכנו לפי האפיון ושפת העסק', noBulk: true },
      ...[['spelling', 'כתיב'], ['phone', 'טלפון'], ['address', 'כתובת'], ['logo', 'לוגו'], ['details', 'פרטי העסק'], ['wording', 'ניסוחים'], ['design', 'עיצוב']]
        .map(([k, l]) => ({ key: `p07.r.${k}`, label: `נבדק: ${l}`, owners: ['irit', 'lior'] })),
      { key: 'p07.sent', label: 'נשלחו ללקוח לאישור', owners: ['irit', 'lior'], requires: ['p07.r.spelling', 'p07.r.phone', 'p07.r.address', 'p07.r.logo', 'p07.r.details', 'p07.r.wording', 'p07.r.design'] },
      { key: 'p07.call', label: 'הלקוח לא הגיב תוך 10 דקות ועירית התקשרה', owners: ['irit'], optional: true },
      { key: 'p07.approved', label: 'הלקוח אישר את הגרפיקות', owners: ['irit', 'lior'], requires: ['p07.sent'], noBulk: true },
    ],
  },
  {
    id: 'p07b', num: '7ב', phase: 'parallel', title: 'העלאת 9 הגרפיקות שאושרו לרשתות', owners: ['ilai'],
    sla: 'עד 30 דקות עבודה מאישור הלקוח',
    // v6: the client approved (the status page, or Irit marked "אושר"): Ilai posts them.
    start: { from: 'item:p07.approved' }, due: { from: 'item:p07.approved', minutes: 30 },
    what: 'הלקוח אישר את 9 הגרפיקות הראשונות. עילאי מעלה אותן לרשתות של הלקוח.',
    items: [
      { key: 'p07b.posted', label: '9 הגרפיקות שאושרו הועלו לרשתות' },
    ],
  },
  {
    id: 'p08', num: '8', phase: 'parallel', title: 'הכנת Highlights', owners: ['ofir'],
    sla: 'עד שעתיים לאחר האפיון, במקביל לגרפיקות',
    start: { from: 'charEnd' }, due: { from: 'charEnd', hours: 2 },
    what: 'אופיר מכין עד 4 Highlights לפי העסק והמידע מפגישת האפיון.',
    items: [
      { key: 'p08.done', label: 'הוכנו עד 4 Highlights לפי השירותים, המוצרים ושפת העסק' },
      { key: 'p08.saved', label: 'ה־Highlights נשמרו במקום המסודר של הלקוח ומוכנים לעמוד' },
    ],
  },
  {
    id: 'p08b', num: '8ב', phase: 'parallel', title: 'העלאת ה־Highlights לרשתות', owners: ['ofir'],
    sla: 'עד 30 דקות עבודה מרגע שה־Highlights הוכנו',
    // v7: the Highlights are ready (process 8 complete: prepared and saved): Ofir uploads them.
    start: { from: 'p08' }, due: { from: 'p08', minutes: 30 },
    what: 'אחרי שה־Highlights מוכנים, אופיר מעלה אותם לעמודי הלקוח ומסמן. חצי שעה מרגע שהוכנו.',
    items: [
      { key: 'p08b.posted', label: 'ה־Highlights הועלו לעמודי הלקוח ברשתות' },
    ],
  },
  {
    id: 'p09', num: '9', phase: 'parallel', title: 'פתיחת גאנט שנתי', owners: ['ilai'],
    sla: '5 דקות',
    start: { from: 'charEnd' }, due: { from: 'charEnd', minutes: 5 },
    what: 'עילאי פותח את גאנט התוכן של הלקוח במערכת. בשלב זה מכינים רק את המבנה; הסרטונים נוספים אחרי העריכה.',
    items: [
      { key: 'p09.file', label: 'נפתח גאנט התוכן של הלקוח במערכת' },
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
      ...[['business', 'חשבון עסקי'], ['ads', 'מנהל מודעות'], ['page', 'עמוד פייסבוק'], ['ig', 'אינסטגרם'], ['links', 'החיבורים הנדרשים לפרסום'], ['perms', 'הרשאות מתאימות']]
        .map(([k, l]) => ({ key: `p10.c.${k}`, label: `נבדק ותקין: ${l}` })),
      { key: 'p10.setup', label: 'הוקם וסודר מה שלא היה קיים', optional: true },
      { key: 'p10.ready', label: 'התשתית מוכנה לקמפיינים' },
    ],
  },
  {
    id: 'p12a', round: true, num: '12א', phase: 'prep', title: 'שיחת דגשים לתוכן', owners: ['lior'],
    sla: 'יום עסקים אחד לאחר פגישת האפיון',
    start: { from: 'charEnd' }, due: { from: 'char', businessDays: 1 },
    what: 'ליאור עובר לעומק על האפיון ומתקשר ללקוח לשיחת דגשים, כדי לדעת בדיוק אילו מסרים נכנסים לתוכן של יום הצילום.',
    items: [
      { key: 'p12a.read', label: 'האפיון נקרא לעומק' },
      { key: 'p12a.call', label: 'בוצעה שיחת דגשים עם הלקוח' },
      ...[['services', 'אילו שירותים הכי חשוב לקדם'], ['products', 'אילו מוצרים חשוב להציג'], ['messages', 'אילו מסרים חייבים להופיע'], ['dont', 'דברים שאסור להגיד'],
        ['offers', 'מבצעים ומחירים'], ['faq', 'שאלות נפוצות של לקוחות'], ['topics', 'נושאים שהלקוח רוצה בסרטונים'], ['objections', 'התנגדויות שחוזרות אצל לקוחות'],
        ['advantages', 'יתרונות מרכזיים של העסק'], ['focus', 'שירותים או מוצרים שצריך לתת להם יותר דגש']]
        .map(([k, l]) => ({ key: `p12a.t.${k}`, label: `נלקח מהלקוח: ${l}` })),
    ],
  },
  {
    id: 'p12', round: true, num: '12', phase: 'prep', title: 'כתיבת התסריטים ליום הצילום', owners: ['lior'],
    sla: 'עד סוף יום העסקים השני מפגישת האפיון, כדי שהזום ייכנס ביום השלישי',
    start: { from: 'charEnd' }, due: { from: 'char', businessDays: 2 }, // decision 14
    what: 'ליאור מכין תסריטים לפי החבילה (תסריט לכל סרטון), האפיון, שיחת הדגשים, העסק, קהל היעד והמשפיענים שמגיעים ליום הצילום.',
    guidance: {
      natali: 'יום עם נטלי: הפניות ברורות לצופה, ראיונות עם הלקוח, סרטוני הסברה, היכרות עם העסק והמקום, הצגת השירותים, מיני־סצנות ותוכן מקצועי ומדויק. מסודר, ברור ומניע לפעולה; פחות קומדיה מוגזמת.',
      dms: 'יום עם דניס, מישל וסמיון: סרטונים מצחיקים, רעיונות משוגעים, תוכן ויראלי, סצנות באנרגיה גבוהה וסיטואציות, וגם הסברה, היכרות וראיונות. גם תוכן מצחיק חייב להיות קשור לעסק ולמסר שהלקוח רוצה להעביר.',
    },
    items: [
      { key: 'p12.scripts', label: 'התסריטים הוכנו לפי החבילה (תסריט לכל סרטון), הדגשים והמשפיענים', requires: ['p12a.call'] },
      { key: 'p12.numbered', label: 'לכל סרטון מספר ברור, כדי לסמן אותו ביום הצילום' },
      { key: 'p12.docs', label: 'התסריטים מסודרים בעמוד התסריטים במערכת, לפי סדר הצילום' },
    ],
  },
  {
    id: 'p13', round: true, num: '13', phase: 'prep', title: 'שיחת Zoom לאישור התוכן', owners: ['lior'],
    sla: 'ביום העסקים השלישי לאחר פגישת האפיון, ללא הגבלת משך עד שהלקוח מאשר',
    start: { from: 'p12' }, due: { from: 'char', businessDays: 3 },
    what: 'שיחת Zoom מוקלטת: עוברים על התסריטים, מסבירים את הרעיונות, מקבלים הערות ומשנים ניסוחים, עד שיש אישור ברור. תיקונים שנשארו: ליאור, עד יום עסקים אחד, והגרסה הסופית היא זו שבעמוד התסריטים במערכת.',
    rule: 'לא מגיעים ליום צילום עם תוכן שלא עבר אישור לקוח.',
    items: [
      { key: 'p13.zoom', label: 'התקיימה שיחת Zoom מוקלטת' },
      { key: 'p13.approved', label: 'הלקוח אישר את התסריטים', requires: ['p13.zoom'], noBulk: true },
      { key: 'p13.fixes', label: 'תיקונים שנשארו אחרי הזום בוצעו ועודכנו בעמוד התסריטים (עד יום עסקים אחד)', optional: true },
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
      { key: 'p14.delays', label: 'אין עיכוב מצד אחד העובדים (אם יש: מתועד ועודכן ליאור)' },
    ],
  },
  {
    id: 'p15', round: true, num: '15', phase: 'eve', title: 'תזכורת לצוות וללקוח', owners: ['lior'],
    ownerNote: 'ליאור שולח את התזכורות; עירית בודקת באותה שעה שזה בוצע, ומעדכנת את ליאור מיד אם יש בעיה.',
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
      { key: 'p15.irit', label: 'עירית וידאה שהתזכורות נשלחו, שהלקוח זוכר ושאין משימה פתוחה שתפגע ביום הצילום', owners: ['irit'] },
    ],
  },
  {
    id: 'p16', round: true, num: '16', phase: 'eve', title: 'תדרוך הצלם והכנת יום הצילום', owners: ['lior'],
    sla: 'בערב שלפני יום הצילום',
    start: { from: 'shoot', prevBusinessDay: true, at: '00:00' }, due: { from: 'shoot', days: 0, at: '00:00' },
    items: [
      { key: 'p16.photographer', label: 'הצלם קיבל את פרטי יום הצילום' },
      { key: 'p16.plan', label: 'עברנו עם הצלם על תוכנית היום' },
      { key: 'p16.early', label: 'הצלם יודע להגיע שעה לפני המשפיענים' },
      { key: 'p16.drive', label: 'הכונן מוכן' },
      { key: 'p16.content', label: 'התסריטים הסופיים מוכנים ומאושרים' },
      { key: 'p16.open', label: 'אין משימה פתוחה שעלולה לעצור את יום הצילום' },
    ],
  },
  {
    id: 'p17', round: true, num: '17', phase: 'shoot', title: 'הגעה מוקדמת והכנת המקום', owners: ['lior'],
    ownerNote: 'ליאור והצלם. מנהל יום הצילום: ליאור בלבד.',
    sla: 'שעה לפני הגעת המשפיענים',
    start: { from: 'shoot', hours: -1 }, due: { from: 'shoot' },
    items: [
      { key: 'p17.handdrive', label: 'הכונן נמסר לצלם' },
      { key: 'p17.plan', label: 'עברנו על תוכנית היום' },
      { key: 'p17.place', label: 'העסק סודר' },
      { key: 'p17.client', label: 'הלקוח הוכן' },
      { key: 'p17.order', label: 'עברנו על סדר התסריטים' },
      { key: 'p17.zones', label: 'הוכנו אזורי צילום' },
      { key: 'p17.brief', label: 'הצלם תודרך' },
      { key: 'p17.broll', label: 'הצלם התחיל מיד לצלם B-Roll; כל ה־B-Roll המרכזי צולם עד הגעת המשפיענים' },
    ],
  },
  {
    id: 'p17b', round: true, num: '17ב', phase: 'shoot', title: 'הצלם: הגעה, ציוד ובי־רול לפני המשפיענים', owners: ['eli'],
    sla: 'שעה לפני הגעת המשפיענים',
    start: { from: 'shoot', hours: -1 }, due: { from: 'shoot' },
    what: 'הצלם מגיע שעה לפני המשפיענים בעיקר כדי לסיים את כל הבי־רול של העסק לפני שהם מגיעים, כך שכשהם מגיעים מתחילים מיד בסרטונים. ההתארגנות מהירה, כדי להשאיר את רוב השעה לבי־רול.',
    rule: 'לא משאירים את הבי־רול הכללי של העסק לזמן שבו המשפיענים כבר במקום. בי־רול נקודתי שקשור למשפיען או לסצנה מסוימת אפשר להשלים במהלך היום.',
    items: [
      { key: 'p17b.arrived', label: 'הגעתי שעה לפני המשפיענים' },
      { key: 'p17b.drive', label: 'קיבלתי את הכונן מליאור (באחריותי עד סוף היום)' },
      { key: 'p17b.gear', label: 'נבדקו מצלמות, סוללות, כרטיסי זיכרון, מיקרופונים ותאורה' },
      { key: 'p17b.zones', label: 'עברתי עם ליאור על אזורי הצילום: זוויות, תאורה וסאונד, רקע נקי ובלי דברים מיותרים בפריים' },
      { key: 'p17b.broll', label: 'כל הבי־רול המרכזי של העסק צולם לפני הגעת המשפיענים: המקום, חזית ופנים, מוצרים, שירותים, עובדים, שילוט, אווירה ותהליכי עבודה' },
      { key: 'p17b.variety', label: 'הבי־רול מגוון: תקריבים וצילומים רחבים, זוויות ומוצרים שונים, מספיק אפשרויות לעורכים' },
    ],
  },
  {
    id: 'p18', round: true, num: '18', phase: 'shoot', title: 'ניהול יום הצילום והתסריטים', owners: ['lior'],
    sla: 'לאורך כל יום הצילום',
    start: { from: 'shoot' }, due: { from: 'shoot', days: 0, at: '23:59' },
    what: 'ליאור מנהל את סדר היום ומחזיק את התסריטים: מסביר מה מצלמים, שומר על המסר, מקדם את הצוות בזמן ופותר בעיות. כל סרטון שצולם מסומן במונה של יום הצילום במערכת.',
    rule: 'אסור לסיים יום צילום לפני שצולמה כל כמות הסרטונים שהלקוח צריך לקבל.',
    items: [
      { key: 'p18.order', label: 'עבדנו לפי סדר התסריטים וסימנו כל סרטון שצולם במונה של יום הצילום' },
      { key: 'p18.all', label: 'צולמה כל כמות הסרטונים שהלקוח צריך לקבל' },
    ],
  },
  {
    id: 'p18b', round: true, num: '18ב', phase: 'shoot', title: 'הצלם: צילום הסרטונים לפי הסדר', owners: ['eli'],
    sla: 'לאורך כל יום הצילום',
    start: { from: 'shoot' }, due: { from: 'shoot', days: 0, at: '23:59' },
    what: 'ליאור מנהל את יום הצילום. הצלם עובד לפי סדר הסרטונים והתסריטים שליאור מגדיר, ובכל סרטון מוודא: תמונה חדה, פריים נכון, תאורה, סאונד ומיקרופון תקינים, בלי רעשי רקע חריגים, המצולם במקום הנכון והשוט מתאים לסוג הסרטון.',
    rule: 'אם יש תקלה, לא ממשיכים לסרטון הבא בלי לפתור אותה. לא מחכים לסוף היום כדי להבין איזה קובץ שייך לאיזה סרטון.',
    items: [
      { key: 'p18b.order', label: 'צילמתי לפי סדר התסריטים של ליאור' },
      { key: 'p18b.quality', label: 'בכל סרטון נבדקו חדות, פריים, תאורה, סאונד ומיקרופון' },
      { key: 'p18b.numbered', label: 'לכל חומר ברור לאיזה מספר סרטון הוא שייך; גרסאות של אותו סרטון שמורות יחד' },
    ],
  },
  {
    id: 'p19', round: true, num: '19', phase: 'shoot', title: 'סיום יום צילום', owners: ['lior'],
    sla: 'מיד בסיום הצילום ולפני שהצוות עוזב',
    start: { from: 'shoot' }, due: { from: 'shoot', days: 0, at: '23:59' },
    rule: 'ליאור לא עוזב יום צילום בלי הכונן, בלי סרטון המלצה ובלי בדיקה שכל החומרים בכונן.',
    items: [
      { key: 'p19.all', label: 'כל הסרטונים צולמו וסומנו' },
      { key: 'p19.testimonial', label: 'צולם סרטון המלצה של הלקוח עם המשפיענים (חובה)' },
      { key: 'p19.drive', label: 'כל חומרי הצילום נמצאים בכונן, והכונן מסודר' },
      { key: 'p19.took', label: 'הכונן חזר לליאור מהצלם' },
    ],
  },
  {
    id: 'p19b', round: true, num: '19ב', phase: 'shoot', title: 'הצלם: סידור הכונן ומסירה לליאור', owners: ['eli'],
    sla: 'מיד בסיום הצילום ולפני עזיבת המקום',
    start: { from: 'shoot' }, due: { from: 'shoot', days: 0, at: '23:59' },
    what: 'בכונן שתי תיקיות: בי־רול, וסרטונים לפי סדר התסריטים (סרטון 01, סרטון 02 וכן הלאה). העורך לא אמור לפתוח עשרות קבצים ולנחש מה שייך לאיזה סרטון.',
    rule: 'הצלם לא עוזב לפני שכל החומרים בכונן, מסודרים בתיקיות, והכונן בידיים של ליאור. אסור לפרמט או למחוק כרטיס זיכרון לפני שנבדק שכל החומר בכונן תקין.',
    items: [
      { key: 'p19b.folders', label: 'בכונן תיקיית בי־רול ותיקיית סרטונים, וכל סרטון במספר שלו לפי התסריטים' },
      { key: 'p19b.complete', label: 'כל הסרטונים וכל הבי־רול בכונן, בלי קבצים חסרים' },
      { key: 'p19b.opens', label: 'הקבצים נפתחים תקין והמספור תואם לסדר התסריטים' },
      { key: 'p19b.cards', label: 'לא נשאר חומר רק על כרטיסי הזיכרון; שום כרטיס לא פורמט לפני הבדיקה' },
      { key: 'p19b.handed', label: 'מסרתי את הכונן לליאור, והוא אישר שקיבל', noBulk: true },
      { key: 'p19b.notes', label: 'עדכנתי את ליאור על בעיה בסרטון או על גרסה או חומר שהעורך צריך לדעת עליהם', optional: true },
    ],
  },
  {
    id: 'p20', round: true, num: '20', phase: 'shoot', title: 'ניהול יום צילום עם נטלי דדון', owners: ['lior'],
    sla: 'צילום בפועל עד 3 שעות',
    when: isNatali, start: { from: 'shoot' }, due: { from: 'shoot', hours: 3 },
    what: 'יום ממוקד לפי התסריטים שאושרו: הפניות לצופה, ראיון עם הלקוח, הסברה, היכרות עם העסק והמקום, הצגת שירותים ומיני־סצנות. מסר ברור, מקצועי ומניע לפעולה, לא קומדיה מוגזמת.',
    items: [
      { key: 'p20.focus', label: 'הצילום התנהל לפי התסריטים המאושרים' },
      { key: 'p20.window', label: 'חלון שלוש השעות לא בוזבז על התארגנויות או נושאים לא קשורים' },
    ],
  },
  {
    id: 'p21', round: true, num: '21', phase: 'shoot', title: 'ניהול יום צילום עם דניס, מישל וסמיון', owners: ['lior'],
    sla: 'צילום בפועל כ־5 שעות, אחרי עד חצי שעה התארגנות',
    when: isDms, start: { from: 'shoot' }, due: { from: 'shoot', minutes: 330 },
    what: 'עם ההגעה: עד חצי שעה להתרענן, לאכול, להתארגן ולקבל תדרוך. רוב התוכן מצחיק, משוגע, אנרגטי וויראלי, ובנוסף הסברה, היכרות עם העסק והשירותים וראיונות עם הלקוח.',
    rule: 'בראיונות ליאור ממקד את דניס, מישל וסמיון בשאלה, במסר ובנושא שהוגדרו בתסריט. ראיון שמתפזר: עוצרים, ממקדים וחוזרים לשאלה.',
    items: [
      { key: 'p21.break', label: 'ניתנה עד חצי שעה להתארגנות ותדרוך, ואז התחלנו' },
      { key: 'p21.fun', label: 'צולם התוכן המצחיק, האנרגטי והוויראלי' },
      { key: 'p21.explain', label: 'צולמו סרטוני הסברה והיכרות עם העסק והשירותים' },
      { key: 'p21.interviews', label: 'צולמו ראיונות עם הלקוח, ממוקדים בשאלות ובמסרים שאושרו' },
    ],
  },
  {
    id: 'p22a', round: true, num: '22א', phase: 'post', title: 'העברה לעריכה ושיוך לעורך', owners: ['ofir', 'lior'],
    sla: 'מיד לאחר יום הצילום וקבלת חומרי הצילום',
    start: { from: 'p19' }, due: { from: 'p19' },
    what: 'ליאור מחזיר את הכונן. אופיר (או ליאור) בודק את עומס העורכים (מי פנוי, מי מחזיק הרבה לקוחות, אילו משימות פתוחות, מי יעמוד בזמן) ומשייך את הלקוח. מכאן מתחילה ספירת זמני העריכה.',
    needs: ['editor'],
    items: [
      { key: 'p22a.drive', label: 'ליאור החזיר את הכונן', owners: ['lior'] },
      { key: 'p22a.load', label: 'נבדק עומס העורכים: נדיה, יריב, אנה (וניראל לנטלי)' },
      { key: 'p22a.assigned', label: 'הלקוח שויך לעורך והכונן הועבר אליו', requiresFields: ['editor'] },
      { key: 'p22a.irit', label: 'עירית וידאה שהלקוח הועבר לעורך, מי העורך, ומתי מתחילה ומסתיימת העריכה', owners: ['irit'], requires: ['p22a.assigned'] },
    ],
  },
  {
    id: 'p22', round: true, num: '22', phase: 'post', title: 'עריכת הסרטונים', owners: editorOf,
    ownerNote: 'העורך שאופיר שייך. ניראל עורכת רק סרטוני נטלי דדון.',
    sla: 'עד סוף יום העסקים השלישי מקבלת הלקוח: כל הסרטונים ערוכים, בדוקים ואצל אופיר',
    start: { from: 'item:p22a.assigned' }, due: { from: 'item:p22a.assigned', businessDays: 3 },
    what: 'עורכים לפי התסריטים ולפי מה שצולם, בלי לשנות את משמעות הסרטון. יוצרים גיוון בקצב, ב־B-Roll, במעברים, במבנה ובהצגת הטקסטים.',
    rule: 'חסר לוגו או מספר טלפון: מדווחים מיד לליאור או לעירית, לא מגלים בסוף העריכה. אופיר לא אמור למצוא טעויות בסיסיות.',
    items: [
      { key: 'p22.received', label: 'התקבל הכונן; עודכן שהעריכה התחילה' },
      { key: 'p22.check.footage', label: 'כל חומרי הצילום קיימים' },
      { key: 'p22.check.scripts', label: 'התסריטים וסדר הסרטונים ברורים' },
      { key: 'p22.check.logo', label: 'יש לוגו תקין של העסק' },
      { key: 'p22.check.phone', label: 'יש מספר טלפון תקין של העסק' },
      { key: 'p22.edited', label: 'כל הסרטונים נערכו לפי התסריטים' },
      { key: 'p22.self.spelling', label: 'בדיקה עצמית: אין שגיאות כתיב בכתוביות, כותרות, שמות, טלפונים, מחירים וטקסטים' },
      { key: 'p22.self.broll', label: 'בדיקה עצמית: אותה תבנית B-Roll לא חוזרת ביותר מ־3 סרטונים' },
      { key: 'p22.self.closing', label: 'בדיקה עצמית: סגיר נקי — לוגו, "לפרטים נוספים התקשרו" ומספר הטלפון, בלי תוספות' },
      { key: 'p22.self.complete', label: 'בדיקה עצמית: כל כמות הסרטונים הושלמה ותואמת לתסריטים' },
    ],
  },
  {
    id: 'p23', num: '23', phase: 'post', title: 'הכנת יתרת הגרפיקות', owners: ['ilai'],
    sla: 'עד יום עסקים אחד, במקביל לעריכת הסרטונים',
    start: { from: 'shoot' }, due: { from: 'shoot', businessDays: 1 },
    what: 'משלימים את כל הגרפיקות לפי החבילה (היתרה אחרי 9 הגרפיקות הראשונות). אופיר בודק; אחרי אישורו נשלחות ללקוח. אם הלקוח לא מגיב תוך 10 דקות, עירית מתקשרת.',
    items: [
      { key: 'p23.made', label: 'כל הגרפיקות לפי החבילה הושלמו (היתרה אחרי 9 הראשונות)', noBulk: true },
      ...[['design', 'העיצוב מתאים לעסק'], ['errors', 'אין טעויות'], ['logo', 'הלוגו נכון'], ['contact', 'הטלפון והכתובת נכונים'],
        ['match', 'המידע תואם לאפיון'], ['pro', 'הגרפיקות ברמה מקצועית'], ['variety', 'אין חזרתיות מוגזמת בין הגרפיקות']]
        .map(([k, l]) => ({ key: `p23.q.${k}`, label: `אופיר בדק: ${l}`, owners: ['ofir'] })),
      { key: 'p23.ofir', label: 'אופיר אישר את הגרפיקות (תיקון: משימה לעילאי)', owners: ['ofir'], requires: ['p23.q.design', 'p23.q.errors', 'p23.q.logo', 'p23.q.contact', 'p23.q.match', 'p23.q.pro', 'p23.q.variety'] },
      { key: 'p23.sent', label: 'נשלחו ללקוח', owners: ['irit'], requires: ['p23.ofir'] },
      { key: 'p23.call', label: 'הלקוח לא הגיב תוך 10 דקות ועירית התקשרה', owners: ['irit'], optional: true },
      // v6: the client's approval, by Irit here or by the client on the status page (same key).
      { key: 'p23.approved', label: 'הלקוח אישר את יתרת הגרפיקות', owners: ['irit'], requires: ['p23.sent'], noBulk: true, optional: true },
    ],
  },
  {
    id: 'p23b', num: '23ב', phase: 'post', title: 'העלאת יתרת הגרפיקות שאושרו לרשתות', owners: ['ilai'],
    sla: 'עד 30 דקות עבודה מאישור הלקוח',
    start: { from: 'item:p23.approved' }, due: { from: 'item:p23.approved', minutes: 30 },
    what: 'הלקוח אישר את יתרת הגרפיקות. עילאי מעלה אותן לרשתות של הלקוח (או מתזמן אותן לפי הגאנט).',
    items: [
      { key: 'p23b.posted', label: 'יתרת הגרפיקות שאושרו הועלו לרשתות או תוזמנו' },
    ],
  },
  {
    id: 'p24', round: true, num: '24', phase: 'post', title: 'העלאה לתיק הלקוח והעברה לאופיר', owners: editorOf,
    sla: 'עד סוף יום העסקים השלישי',
    start: { from: 'p22' }, due: { from: 'item:p22a.assigned', businessDays: 3 },
    items: [
      // Retired (package 1): the videos go into the client's files in the system, so
      // there is no Drive folder to open. Applies to no client; the key stays.
      { key: 'p24.folder', label: 'יש תיקייה מסודרת עם שם הלקוח', owners: ['ofir'], when: RETIRED },
      { key: 'p24.drive', label: 'כל הסרטונים הועלו לתיק הלקוח במערכת, וכל הקבצים נפתחים' },
      { key: 'p24.dropbox', label: 'התוכן הועלה ל־Dropbox (לפי הצורך)', optional: true },
      { key: 'p24.notify', label: 'העורך עדכן את אופיר שהלקוח מוכן לבקרה', noBulk: true },
    ],
  },
  {
    id: 'p25', round: true, num: '25', phase: 'post', title: 'בקרת איכות על הסרטונים', owners: ['ofir'],
    sla: 'עד שעה מרגע שהעורך הודיע שהלקוח מוכן',
    start: { from: 'p24' }, due: { from: 'p24', hours: 1 },
    rule: 'רק לאחר אישור אופיר מותר לשלוח את הסרטונים ללקוח. בעיה: התיקון חוזר לעורך כמשימה במערכת.',
    items: [
      ...[['editing', 'העריכה ברמה טובה'], ['errors', 'אין טעויות'], ['clear', 'הסרטונים ברורים'], ['match', 'התוכן תואם למה שצולם'],
        ['pro', 'אין קטעים לא מקצועיים'], ['fit', 'הסרטונים מתאימים ללקוח']]
        .map(([k, l]) => ({ key: `p25.q.${k}`, label: `נבדק: ${l}` })),
      { key: 'p25.approved', label: 'אופיר אישר: החומר מוכן לשליחה ללקוח', requires: ['p25.q.editing', 'p25.q.errors', 'p25.q.clear', 'p25.q.match', 'p25.q.pro', 'p25.q.fit'] },
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
    id: 'p27', round: true, num: '27', phase: 'post', title: 'תיקוני הלקוח וסגירת העריכה', owners: editorOf,
    sla: 'ביום העסקים הרביעי: כל תיקוני הלקוח סגורים והגרסאות הסופיות בתיק הלקוח במערכת',
    start: { from: 'p26' }, due: { from: 'item:p22a.assigned', businessDays: 4 },
    what: 'ללקוח סבב תיקונים אחד. עירית מקבלת את ההערות, מוודאת שהן ברורות ומתעדת; העורך מתקן, בודק מחדש ומחליף את הקבצים. בסוף הלקוח עובר לעילאי לתזמון ולגאנט.',
    items: [
      { key: 'p27.notes', label: 'הערות הלקוח התקבלו, ברורות ומתועדות', owners: ['irit'], optional: true },
      { key: 'p27.fixes', label: 'כל התיקונים בוצעו ונבדקו מחדש', optional: true },
      { key: 'p27.final', label: 'הגרסאות הסופיות בתיק הלקוח במערכת, בלי גרסאות ישנות שמבלבלות', noBulk: true },
      { key: 'p27.approved', label: 'הלקוח אישר את הסרטונים', owners: ['irit'], requires: ['p26.sent'], noBulk: true },
      { key: 'p27.toilai', label: 'עילאי קיבל את הגרסאות הסופיות לתזמון ולגאנט (״קיבלתי״)', owners: ['ilai'], requires: ['p27.final'] },
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
      { key: 'p29.sent', label: 'הגאנט הועבר ללקוח', owners: ['irit'], requires: ['p29.filled'] },
    ],
  },
  {
    id: 'p30', round: true, num: '30', phase: 'publish', title: 'בניית הקמפיינים', owners: ['lior'],
    sla: 'עד יום עסקים אחד מרגע קבלת הסרטונים המוכנים',
    start: { from: 'p25' }, due: { from: 'p25', businessDays: 1 },
    items: [
      { key: 'p30.picked', label: 'נבחרו הסרטונים המתאימים ביותר' },
      { key: 'p30.live', label: 'הוקמו קמפיינים לפי המטרות, השירותים, קהל היעד, התקציב וסוג הפניות הרצוי' },
    ],
  },
  {
    id: 'p31', num: '31', phase: 'ongoing', title: 'שיחת לקוח שבועית', owners: ['lior'],
    sla: 'פעם בשבוע, בימי רביעי או חמישי',
    recurring: 'weekly', start: { from: 'p30' },
    what: 'עוברים עם הלקוח על קמפיינים, לידים, תוצאות, סרטונים, תכנים שעלו, תכנים עתידיים, בעיות, דברים שצריך לשפר ובקשות חדשות. הכול מתועד בסיכום השיחה; כל משימה נפתחת עם אחראי ברור. לאורך התקופה ליאור בודק גם ביצועים, לידים, הודעות, עלויות, קריאייטיבים וצורך באופטימיזציה. עירית בודקת אחרי השיחה שלכל משימה יש אחראי.',
    items: [
      { key: 'p31.call', label: 'בוצעה שיחה שבועית ותועדה', recurring: 'weekly' },
    ],
  },
  {
    id: 'p34', num: '34', phase: 'renewal', title: 'חידוש חוזה', owners: ['lior'],
    sla: 'מתחילים 60 יום לפני סיום החוזה',
    start: { from: 'contractEnd', days: -60 }, due: { from: 'contractEnd', days: -60, at: '23:59' },
    items: [
      { key: 'p34.state', label: 'נבדקו מצב הלקוח והתוצאות' },
      { key: 'p34.satisfaction', label: 'נבדקה שביעות רצון' },
      { key: 'p34.problems', label: 'זוהו בעיות' },
      { key: 'p34.talk', label: 'התחלנו לדבר עם הלקוח על המשך העבודה' },
      { key: 'p34.issues', label: 'טופלו נושאים שיכולים להשפיע על החידוש' },
    ],
  },
  {
    id: 'p35', num: '35', phase: 'renewal', title: 'סיום התקשרות', owners: ['lior'],
    sla: 'במועד סיום העבודה עם הלקוח',
    when: (c) => c.status === 'ending' || c.status === 'ended', due: { from: 'contractEnd' },
    items: [
      { key: 'p35.campaigns', label: 'הקמפיינים נעצרו' },
      { key: 'p35.access', label: 'הוסרו גישות לפי הצורך (ונמחקו מכספת הגישות)' },
      { key: 'p35.connections', label: 'נסגרו חיבורים רלוונטיים' },
      // The one place Drive still means Drive: the client's archive outside the system.
      { key: 'p35.drive', label: 'החומרים של הלקוח נשארים שמורים בדרייב' },
      { key: 'p35.system', label: 'המערכת עודכנה' },
    ],
  },
];

// Processes 32 and 33 are office-wide daily reviews, served by the control view.
export const OFFICE_REVIEWS = [
  { num: '32', title: 'בקרה על ביצוע המשימות', owner: 'irit', sla: 'בכל יום עבודה, כולל הודעות יומיות ללקוחות' },
  { num: '33', title: 'בקרה על כל רשימת הלקוחות', owner: 'ofir', sla: 'לפחות פעם ביומיים; ביום חמישי מעבר מלא עם סיכום מצב לכל לקוח' },
];
