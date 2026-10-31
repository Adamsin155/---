// generated — edit app/ instead. Source: app/ask-guide.js. Regenerate: node scripts/sync-functions.mjs
// "שאלו את המערכת" also answers "איפה…" and "איך…" about the app (the owner's request of
// 29.10.2026: "תוסיף שאפשר לשאול את כל השאלות שקשורות למסך שלי וגם למי שיש הרשאה במבט מנהל גם
// לשאול על מבט מנהל"; docs/ops.md, section 78). This module turns the app's own menu rules
// (menuOf / profileMenu in app/shell-rules.js, MODES in app/manager-rules.js) into a short guide
// for ONE person: the screens of their personal menu ("המשימות שלי"), and for whoever has the
// manager profile, the screens behind "מבט מנהל", each with its link and a line on what is there;
// and the common how-tos, each only when this person has the screen it needs. Nothing here reads
// the database: a screen a person does not have is simply not in their guide, so the bot cannot
// describe it. The ask function (supabase/functions/ask/tools.js, tool app_guide) runs a copy
// (supabase/functions/_shared/app/, node scripts/sync-functions.mjs). No DOM, so node tests it.
import { PEOPLE, isSales } from './protocol.js';
import { isOwnerView } from './team-rules.js';
import { canAsk } from './ask-logic.js';
import { hasProfiles, managerHome, MODES } from './manager-rules.js';
import { profileMenu, managerTabs, opensClients, writesChar, editsGantt } from './shell-rules.js';

export const SITE = 'https://app.astrateg.tech/';
export const linkOf = (href) => SITE + String(href || '').replace(/^\/+/, '');
// A client's own pages, reached from the client's card (the bot finds the client first).
export const clientLink = (id) => linkOf(`client.html?id=${encodeURIComponent(id)}`);
export const ganttLink = (id) => linkOf(`gantt.html?id=${encodeURIComponent(id)}`);

const known = (v) => !!v && !v.error;
const officeOf = (v) => known(v) && v.scope === 'office';
const isEditor = (v) => known(v) && !!PEOPLE[v.me]?.editor;

// What is on each screen and what one does there: short, plain, for this person.
const WHAT = {
  mine: (v) => (isEditor(v)
    ? 'כל מה שמחכה לך: הסעיפים שלך בכל לקוח, עם "סיימתי" בסוף השורה. לשונית "באיחור" מופיעה כשיש משהו שעבר את המועד.'
    : 'המסך הראשון: כל מה שמחכה לך היום, משימה אחרי משימה, עם "סיימתי" בסוף השורה. לשונית "באיחור" מופיעה כשיש משהו שעבר את המועד, עם המספר.'),
  manager: () => 'מסך "מה דורש אותי": רק מה שחרג, עם שם וסיבה. בלשוניות למעלה: "כל הלקוחות במבט", "טבלה" (כל לקוח בשורה, מיון, סינון וייצוא), "ימי צילום" ו"ארכיון" למי שיש.',
  overview: () => '"כל הלקוחות במבט": איפה כל לקוח עומד, מה הבא, מי ומתי. לחיצה על לקוח מציגה את השאר. בלשונית "טבלה": כל לקוח בשורה (בלי מחירים).',
  clients: (v) => (officeOf(v)
    ? 'רשימת כל הלקוחות עם חיפוש. לחיצה על לקוח פותחת את כרטיס הלקוח: הפרטים, החבילה, הקישורים (דרייב, גאנט), הפרוטוקול וכל המשימות שלו.'
    : 'הלקוחות שאת/ה עובד/ת עליהם. לחיצה על לקוח פותחת את הכרטיס שלו: מה צריך, הקישורים והסעיפים שלך.'),
  gantt: (v) => (editsGantt(v)
    ? 'גאנט התוכן של כל הלקוחות: בוחרים לקוח ומעדכנים את הפרסומים (מתוכנן, תוזמן, עלה). בגאנט של לקוח יש גם "משיכת קישורים מהדרייב".'
    : 'גאנט התוכן של כל הלקוחות, לצפייה: מה מתוכנן, מה תוזמן ומה עלה, לכל לקוח בכל חודש.'),
  qa: () => 'התור של בקרת האיכות (יעד של שעה), האפיונים של היום, לקוחות שמחכים לשיוך עורך (בוחרים עורך וזמן עריכה; אין זמן קצוב, תזכורת ב־12:00), ו"עומס עורכים" עם "החלפת עורך".',
  pass: () => 'המעבר על הלקוחות: פעם ביומיים ובחמישי מעבר מלא. רק מה שדורש פעולה, תקינות הנתונים, "סיכום חמישי" ומשימות שפתחת.',
  decisions: () => 'מה מחכה להחלטה: חריגות, בקשות שינוי של לקוחות, משימות דחופות, גישות שבורות, עריכה שעצורה ובדיקת קמפיינים שבועית.',
  insights: () => 'תובנות החודש: עמידה בזמנים, החזרות מבקרת איכות, מהצילום למסירה, פניות לקוח ושביעות רצון.',
  year: () => 'שנת החבילה: באיזה חודש בחבילה כל לקוח, מה פתוח החודש, ומי מסיים ב־90 הימים הקרובים (חידושים).',
  prep: () => 'לפני יום צילום: סגירת יום הצילום מול כולם, מה חוסם, בדיקת יום לפני, ובקשות שהלקוחות שלחו.',
  messages: () => 'הודעות ללקוחות: תור של הודעה אחת ביום לכל לקוח לכל היותר. עוברים, מתקנים נוסח אם צריך, ושולחים בוואטסאפ.',
  editor: () => 'הלקוחות שבעריכה אצלך: באיזה שלב כל אחד, עד מתי, "ערכתי N מתוך…", "קיבלתי את הכונן" וכפתור אחד לשלב הבא.',
  shoot: (v) => (known(v) && v.me === 'eli'
    ? 'ימי הצילום שלך: מתי, איפה, עם מי, ומה צריך להביא.'
    : 'ימי הצילום: כל יום צילום ומה מוכן אליו. ליאור מנהל ממנו את יום הצילום מהטלפון.'),
  calendar: (v) => (officeOf(v)
    ? 'יומן: פגישות האפיון וימי הצילום של כל הלקוחות בשבוע או בחודש, "שליחת זימון", ובתחתית חיבור היומן שלך ב־Google.'
    : 'יומן: האירועים שלך בשבוע או בחודש (ימי צילום, יעדים ומשימות). לחיצה על אירוע פותחת את כרטיס הלקוח.'),
  'shoot-table': () => 'טבלת ימי צילום: כל הלקוחות הפעילים לפי יום הצילום האחרון, מי שצולם הכי מזמן למעלה.',
  quote: () => 'בניית הצעת מחיר וחוזה: בוחרים חבילה ומשפיענים, תוספות, הנחה ופרטי לקוח, ושולחים ללקוח קישור לחתימה. אפשר גם "הכנת חוזה עם AI".',
  quotes: (v) => (isOwnerView(v) || (known(v) && v.me === 'ofir')
    ? 'כל ההצעות והחוזים שנשלחו ומה נחתם, עם הסכומים, ו"נשלח החודש" / "נחתם החודש".'
    : 'כל ההצעות והחוזים שנשלחו ומה מצב החתימה של כל אחד (בלי סכומים).'),
  ask: () => 'שאלו את המערכת: שאלה בעברית על לקוחות, משימות, תוכן, דרייב, או איפה עושים משהו במערכת.',
  team: () => 'צוות וכניסות: כל אחד מהצוות, יצירת קישור כניסה אישי ושליחתו בוואטסאפ (גם למי ששכח סיסמה), וקוד הכספת.',
  payouts: () => 'אסטרטג פיימנט: התשלומים החודשיים, עמלות, משכורות והוצאות (אפליקציה נפרדת לבעלים).',
  deal: () => 'עסקה חדשה: ממלאים את מה שסגרת עם הלקוח ושולחים לעירית ולאופיר. מי שלוקח ראשון מכין את החוזה. מתחת: העסקאות ששלחת ומה המצב שלהן.',
  // The tabs of the clients screen that belong to a profile (MANAGER_TABS in shell-rules.js).
  'team-work': () => 'עבודת הצוות: "המשימות שלי" של כל אחד מהצוות, עם בחירה של מי.',
  control: () => 'בקרה יומית: 11 הנושאים של הבקרה, שורה לכל נושא עם מספר הפריטים הפתוחים, וכל פריט מוביל לכרטיס הלקוח.',
  performance: () => 'ביצועים: עמידה בזמנים של כל אחד מהצוות.',
};
// The tabs of the clients screen that belong to a profile (MANAGER_TABS in shell-rules.js):
// reached through "לקוחות" ("עבודת הצוות" through "הצגת עבודת הצוות" on "המשימות שלי").
const TAB_SCREENS = [
  { id: 'team-work', tab: 'team', href: 'clients.html#team', label: 'עבודת הצוות', via: 'בתפריט ← המשימות שלי ← "הצגת עבודת הצוות"' },
  { id: 'control', tab: 'control', href: 'clients.html#control', label: 'בקרה יומית', via: 'בתפריט ← לקוחות ← לשונית "בקרה יומית"' },
  { id: 'performance', tab: 'performance', href: 'clients.html#performance', label: 'ביצועים', via: 'בתפריט ← לקוחות ← לשונית "ביצועים"' },
];
// The way to a screen in clicks: from the menu, and for the manager profile's screens, through
// the "מבט מנהל" button first.
const SWITCH = `כפתור "${MODES.manager.label}" בראש המסך`;
const screenOf = (v, it, manager) => {
  const own = it.via || `בתפריט ← ${it.label}`;
  const path = !manager ? own : it.id === 'manager' ? SWITCH : `${SWITCH} ← ${own}`;
  return { id: it.id, label: it.label, path, link: linkOf(it.href), what: (WHAT[it.id] || (() => ''))(v) };
};

// The two lists of one person: { mine, manager } (manager is empty for anyone without the profile).
export function screensOf(viewer) {
  const v = viewer;
  const mineItems = profileMenu(v, 'mine');
  if (!hasProfiles(v)) return { mine: mineItems.map((it) => screenOf(v, it, false)), manager: [] };
  const mineIds = new Set(mineItems.map((it) => it.id));
  const managerItems = profileMenu(v, 'manager').filter((it) => !mineIds.has(it.id));
  const mTabs = managerTabs(v);
  // #team is always the manager profile's; the daily review is Irit's own (OWN_TABS in shell-rules.js).
  const ownTabs = TAB_SCREENS.filter((t) => t.tab !== 'team' && !mTabs.includes(t.tab) && officeOf(v));
  const mgrTabs = TAB_SCREENS.filter((t) => mTabs.includes(t.tab));
  return {
    mine: [...mineItems, ...ownTabs].map((it) => screenOf(v, it, false)),
    manager: [...managerItems, ...mgrTabs].map((it) => screenOf(v, it, true)),
  };
}

function pathTo(lists, id) {
  const s = lists.mine.find((x) => x.id === id) || lists.manager.find((x) => x.id === id);
  return s ? { path: s.path, link: s.link } : null;
}

// The common how-tos: `via` is the screen it starts from, `when` who has it at all, `then` the
// clicks after reaching the screen.
const HOWTOS = [
  { id: 'new-client', q: 'איך מוסיפים לקוח חדש?', via: 'clients', when: opensClients,
    then: 'הכפתור "לקוח חדש" למעלה ← "עסקה חדשה" (או "ייבוא לקוח קיים") ← שם הלקוח, שם העסק, טלפון, חבילה וסוג יום צילום ← "פתיחת כרטיס לקוח". לקוח שחתם על הסכם במערכת נפתח לבד.' },
  { id: 'edit-client', q: 'איך משנים פרטים של לקוח (טלפון, אימייל, ח.פ / ת.ז, תאריכים, כמויות)?', via: 'clients', when: officeOf,
    then: 'מחפשים את הלקוח ← כרטיס הלקוח ← "עריכת פרטים" ← משנים ← "שמירה".' },
  { id: 'drive-link', q: 'איך מחברים ללקוח קישור לדרייב?', via: 'clients', when: officeOf,
    then: 'כרטיס הלקוח ← בשורת "קישורים:" ← "עריכת קישורים" (או "הוספת קישורים") ← "תיקיית הסרטונים ב־Drive": מדביקים קישור לתיקייה (drive.google.com/drive/folders/…) ← "שמירה".' },
  { id: 'monthly-shoot', q: 'איך מסמנים יום צילום חודשי או לקוח חודשי?', via: 'clients', when: officeOf,
    then: 'כרטיס הלקוח ← "עריכת פרטים" ← "כמויות בחבילה" ← "יום צילום חודשי" (ולקוח חודשי: "סרטונים בחודש") ← "שמירה".' },
  { id: 'characterization', q: 'איך ממלאים או מעדכנים אפיון?', via: 'clients', when: writesChar,
    then: 'הכפתור "אפיון חדש" למעלה ← בוחרים לקוח. או מכרטיס הלקוח: "אפיון" / "עדכון אפיון".' },
  { id: 'gantt', q: 'איפה הגאנט של לקוח?', via: 'clients', when: known,
    then: 'כרטיס הלקוח ← בשורת "קישורים:" ← "גאנט התוכן".', alsoVia: 'gantt' },
  { id: 'drive-pull', q: 'איך מושכים קישורים מהדרייב לגאנט?', via: 'clients', when: editsGantt,
    then: 'כרטיס הלקוח ← "גאנט התוכן" ← "משיכת קישורים מהדרייב". רק פריטים ריקים מתמלאים; שם הקובץ מתחיל ביום ובחודש (15.11 …). צריך קישור לתיקיית הדרייב בכרטיס.' },
  { id: 'sent-quotes', q: 'איפה רואים את ההצעות והעסקאות שנשלחו החודש?', via: 'quotes', when: known,
    then: 'הרשימה של כל ההצעות ומה נחתם.' },
  { id: 'new-quote', q: 'איך מכינים הצעת מחיר או חוזה חדש?', via: 'quote', when: known,
    then: 'בוחרים חבילה ומשפיענים ← תוספות ← פרטי הלקוח ← יוצרים קישור ושולחים ללקוח לחתימה.' },
  { id: 'vault', q: 'איפה הסיסמאות של לקוח (הכספת)?', via: 'clients', when: (v) => officeOf(v) || (known(v) && v.me === 'ilai'),
    then: 'כרטיס הלקוח ← "גישות לרשתות" ← "הצגת סיסמה" ← מקלידים את קוד הכספת. רק למי שיש לו הרשאת כספת. הבוט לא מוסר סיסמאות.' },
  { id: 'calendar', q: (v) => (officeOf(v) ? 'איפה היומן ואיך שולחים זימון?' : 'איפה היומן שלי?'), via: 'calendar', when: known,
    then: 'שבוע או חודש, "הקודם" / "הבא" / "היום". לחיצה על אירוע פותחת את כרטיס הלקוח.', office: '"שליחת זימון" ליד כל פגישת אפיון ויום צילום. חיבור Google: "היומן שלי ב־Google" בתחתית העמוד.' },
  { id: 'not-received', q: 'איך מדווחים שלוגו / טלפון / חומר לא התקבל?', via: 'mine', when: isEditor,
    then: 'כרטיס הלקוח ← בשורה של הסעיף (תהליך 22) ← "לא התקבל" ← בוחרים עירית, ליאור או אופיר ← "מה חסר?" (לא חובה) ← "לשלוח". גם ב"הלקוחות שלי בעריכה" ב"קיבלתי את הכונן".' },
  { id: 'editor-swap', q: 'איך מחליפים עורך ללקוח?', via: 'qa', when: known,
    then: '"עומס עורכים" ← פותחים את העורך ← ליד הלקוח "החלפת עורך" ← בוחרים עורך ← שמירה.' },
  { id: 'late', q: 'איפה רואים מה באיחור?', via: 'mine', when: known,
    then: 'לשונית "באיחור" (מופיעה רק כשיש משהו באיחור, עם המספר).' },
  { id: 'evening', q: 'איפה סיכום הערב (19:00)?', via: 'manager', when: isOwnerView,
    then: 'לשונית "סיכום היום": כמה פריטים באיחור אצל כל עובד ומה לא בוצע היום. אותם מספרים מגיעים גם בהודעה של 19:00.' },
  { id: 'new-deal', q: 'איך שולחים עסקה חדשה?', via: 'deal', when: (v) => known(v) && isSales(v.me),
    then: 'ממלאים את מה שסגרת עם הלקוח ← שליחה. עירית ואופיר מקבלים, ומי שלוקח ראשון מכין את החוזה.' },
];

// The guide of one person, or null for anyone who does not ask (canAsk in app/ask-logic.js).
//   { who, profiles, switch, mine: [screen], manager: [screen], howto: [{ q, path, link }], client_pages }
export function guideOf(viewer) {
  if (!canAsk(viewer)) return null;
  const v = viewer;
  const lists = screensOf(v);
  const howto = [];
  for (const t of HOWTOS) {
    if (!t.when(v)) continue;
    const to = pathTo(lists, t.via);
    if (!to) continue;
    let then = t.then;
    if (t.office && officeOf(v)) then = `${then} ${t.office}`;
    const item = { q: typeof t.q === 'function' ? t.q(v) : t.q, path: `${to.path} ← ${then}`, link: to.link };
    if (t.alsoVia) {
      const also = pathTo(lists, t.alsoVia);
      if (also) item.or = `${also.path} ← בוחרים את הלקוח`;
    }
    howto.push(item);
  }
  const who = isOwnerView(v) ? 'הבעלים' : PEOPLE[v.me]?.name || '';
  return {
    who,
    profiles: hasProfiles(v),
    switch: hasProfiles(v) ? { label: MODES.manager.label, link: linkOf(managerHome(v)), back: 'חזרה למשימות שלי' } : undefined,
    mine: lists.mine,
    manager: lists.manager,
    howto,
    client_pages: lists.mine.some((s) => s.id === 'clients') || lists.manager.some((s) => s.id === 'clients')
      ? 'כרטיס של לקוח מסוים והגאנט שלו: מוצאים את הלקוח בכלי הנתונים, ו־app_links שלו נותן את הקישור הישיר.'
      : undefined,
  };
}

// The guide, with what fits the words of the question first (`likely`: the how-tos and screens
// that share a word with the topic). The whole guide always goes along: it is short.
// The question words alone count ("איפה", "איך", "רואים" … fit everything).
const STOP = new Set(['איפה', 'איך', 'רואים', 'רואה', 'אני', 'את', 'של', 'מה', 'יש', 'אפשר', 'עושים', 'מוצא', 'מוצאים', 'שלי', 'בבקשה']);
const words = (s) => String(s || '').replace(/[?"'״׳.,!:;()]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
export function guideFor(viewer, topic) {
  const g = guideOf(viewer);
  if (!g) return null;
  const ws = words(topic);
  if (!ws.length) return g;
  // The best fits first: the most shared words.
  const score = (...texts) => ws.filter((w) => texts.some((t) => String(t).includes(w))).length;
  const ranked = (list) => list.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([text]) => text);
  const likely = [
    ...ranked(g.howto.map((t) => [t.q, score(t.q)])),
    ...ranked([...g.mine, ...g.manager].map((s) => [s.label, score(s.label, s.what)])),
  ].slice(0, 6);
  return likely.length ? { likely, ...g } : g;
}
