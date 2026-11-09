// generated — edit app/ instead. Source: app/legal.js. Regenerate: node scripts/sync-functions.mjs
// Engagement agreement text, built from the selected package so the signed wording always
// matches what was sold. Shared by the browser and the create-quote edge function.
//
// Since 9.11.2026 (LEGAL_VERSION 3) the words are the old system's (astrateg-crm), as its
// clients read and signed them (the owner: "שהפורמט עם כל המילים שרשומות בחוזה הישן יהיו אצלנו
// במערכת במקום מה שיש היום"): "מי אנחנו", "מה כוללת חבילת ...", "למה לבחור בנו", "פירוט
// החבילה" and the agreement's six clauses, word for word from the old document the owner sent
// (the PDF "הצעת מחיר נירו לוי – ALL IN ONE"; app/legacy-contract-full.js is the old page's
// code, with a few words that differ). Only the numbers are ours (price, months, quantities,
// the influencer). What the old document did not have (a contract typed by hand, the add-ons,
// the new influencers) is said in its style. What our longer wording (version 2) had and this
// one does not: docs/contract-old-text-removed.md.

export const PROVIDER = {
  name: 'אסטרטג טכנולוגיות בע״מ',
  companyId: '514729938',
  addresses: ['הבונים 5, רמת גן', 'האורזים 23, נתניה'],
  email: 'info@astrateg.com',
};

// The version of the wording below, stored in each new document's model (model.legalVersion,
// app/pricing.js). A document keeps the text it was made with (quotes.model.legal and
// quotes.model.wording, written when it is sent), so a change here reaches only the documents
// made after it; a sent or signed one is drawn from its own stored text and never from this file
// (app/quote-doc.js draws the old layout for a model with no `wording`).
//   1  until 27.10.2026 (documents with no legalVersion)
//   2  27.10.2026: "חסימת פלטפורמות", the last clause of the platforms chapter
//   3  9.11.2026: the old system's words and its six clauses (the owner's request)
export const LEGAL_VERSION = 3;

const ils = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const money = (agorot) => `${ils.format(agorot / 100)} ₪`;

// "12 חודשים", or "חודש אחד" for a contract of one month (typed by hand).
const monthsText = (n) => (n === 1 ? 'חודש אחד' : `${n} חודשים`);

/**
 * ctx: {
 *   termMonths, totals, tier ('podcast'|'social'|'social-tv'), packageName, influencer (the
 *   name inside a sentence), influencerId, noInfluencer (bool), shootDays, videos, graphics,
 *   photographers, includes [{qty, label}] (the package's lines as the document lists them),
 *   and, only in a contract changed by hand: specialTerms (free text, one clause per line)
 * }
 */

// The agreement's clauses: the old document's six, and a seventh only for the special terms of
// a contract typed by hand. [{ title, items: [text] }]; app/quote-doc.js numbers them 1.1, 1.2…
export function agreementSections(ctx) {
  const n = ctx.termMonths;
  const S = [
    { title: 'תקופת ההסכם', items: [
      `ההתקשרות הינה לתקופה קצובה של ${monthsText(n)} מיום החתימה על הצעת המחיר/ההסכם (להלן: "תקופת ההתקשרות").`,
      `אין אפשרות לסיים את ההתקשרות לפני תום ${n === 1 ? 'החודש' : `${n} החודשים`}, מכל סיבה שהיא, וזאת מאחר שהלקוח מקבל את כלל התוצרים עד 30 ימי עסקים מיום הצילום, בכפוף לאמור בסעיף 3 להלן.`,
    ] },
    { title: 'התמורה ותנאי תשלום', items: [
      `התמורה עבור החבילה הינה ${money(ctx.totals.monthlyNet)} לחודש + מע״מ כחוק, למשך ${monthsText(n)}.`,
      'התשלום יתבצע באמצעות מערכת פיימנט בלבד, בחיוב חודשי שוטף, ללא תפיסת מסגרת.',
      n === 1
        ? 'הלקוח מתחייב בזאת לתשלום מלוא התשלום החודשי, גם אם יבחר להפסיק את פעילותו העסקית או את השימוש בתוצרים בטרם עת. אי עמידה בתשלום תעמיד את מלוא החוב לפירעון מיידי.'
        : `הלקוח מתחייב בזאת לתשלום מלוא ${n} התשלומים החודשיים, גם אם יבחר להפסיק את פעילותו העסקית או את השימוש בתוצרים בטרם עת. אי עמידה באחד התשלומים תעמיד את מלוא יתרת החוב לפירעון מיידי.`,
    ] },
    { title: 'לוחות זמנים ותכני הלקוח', items: [
      'הלקוח מתחייב לספק לאסטרטג את כל המידע, התכנים, הלוגואים, ההנחיות והחומרים הנדרשים לצורך ההפקה, תוך 14 ימי עסקים מיום חתימת ההסכם.',
      'איחור מצד הלקוח במסירת התכנים עלול לגרום לעיכוב בהפקת התוצרים; במקרה כזה, המועד של 30 ימי עסקים לתחילת העלאת התוצרים לא יחייב את אסטרטג, והעיכוב לא ייחשב כהפרה מצד אסטרטג.',
      'אסטרטג מתחייבת להתחיל עלייה של סרטונים לרשתות החברתיות עד 30 ימי עסקים מיום הצילום, בכפוף לעמידת הלקוח בחובותיו לפי סעיף 3.1.',
    ] },
    { title: 'תיקונים ואישורים', items: [
      'לכל תוצר כלול סבב תיקון אחד.',
      'כל תיקון נוסף (מעבר לסבב האחד) יוגדר כעבודה נוספת בתשלום, על פי הצעת מחיר שתימסר ללקוח מראש.',
      'אי מתן מענה/אישור מסודר מצד הלקוח בתוך זמן סביר (עד 7 ימי עסקים מקבלת התוצרים) ייחשב כאישור התוצר, ואסטרטג תהיה רשאית להמשיך הלאה בתהליך ההפקה.',
    ] },
    { title: 'אחריות ותוצאות פרסומיות', items: [
      'אסטרטג אחראית על הפקת התוצרים לפי ההסכמה המקצועית בין הצדדים, אך אינה מתחייבת לכמות לידים, מכירות, פניות, צפיות, חשיפות או כל תוצאה עסקית/כספית אחרת.',
      'הלקוח מודע לכך שתוצאות פרסום מושפעות מפרמטרים רבים שאינם בשליטת אסטרטג (שוק, תחרות, תקציב מדיה, אלגוריתמים של פלטפורמות וכו׳).',
    ] },
    { title: 'שונות', items: [
      'כל שינוי או תוספת להסכם זה יהיה בתוקף רק אם נעשה בכתב ונחתם על ידי שני הצדדים.',
      'הדין החל על ההתקשרות הוא הדין הישראלי בלבד.',
    ] },
  ];
  // Special terms, typed by hand for this client (a contract changed by hand). Always the last
  // chapter, so the six above keep their numbers. The old document had none; said in its style.
  const special = String(ctx.specialTerms || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (special.length) {
    S.push({ title: 'תנאים מיוחדים', items: [
      'בכל סתירה בין תנאי מיוחד לבין סעיף אחר בהסכם זה, יגבר התנאי המיוחד, אך ורק במידה שנקבעה בו במפורש.',
      ...special,
    ] });
  }
  return S;
}

// How the old document said that the influencer takes part ("שנירו לוי ישתתף בהם").
const TAKES_PART = { natali: 'תשתתף', simeon: 'ישתתפו', niro: 'ישתתף', hatzel: 'ישתתף', arik: 'ישתתף' };
// The package's lines the old document says in words of its own (the shoot day, the videos, the
// graphics, the crew, the management of the networks); the rest are listed as they are.
const SAID = /^(יום צילום בבית העסק|ימי צילום בבית העסק|סרטונים|סרטוני פודקאסט|גרפיקות|צלמים)/;
const MANAGED = new Set(['ניהול רשתות חברתיות', 'ניהול קמפיינים ממומנים ברשתות']);

// The words around the agreement, in the old document's order. Stored in the model (wording),
// so a document keeps them as it was made. { intro, package, why, details, closing }:
//   intro    { title, text, strengthsTitle, strengths: [..], after }
//   package  { title, groups: [{ title, items: [..] }] }
//   why      { title, text }
//   details  { title, groups: [{ title, items: [..] }] }
//   closing  text
export function agreementWording(ctx) {
  const n = ctx.termMonths;
  const pod = ctx.tier === 'podcast';
  const inf = ctx.noInfluencer ? '' : ctx.influencer;
  const days = ctx.shootDays || 0;
  const content = [];
  if (inf && !pod) {
    content.push(days > 1 ? `${days} ימי צילום מקצועיים ומרוכזים עם ${inf}` : `יום צילום מקצועי ומרוכז עם ${inf}`);
    if (TAKES_PART[ctx.influencerId]) content.push(ctx.influencerId === 'simeon' ? 'משפיעני רשת מובילים בישראל' : 'משפיען רשת מוביל בישראל');
    const total = (ctx.videos || 0) + (ctx.graphics || 0);
    if (total) {
      const verb = TAKES_PART[ctx.influencerId];
      content.push(`${days > 1 ? 'בימי הצילום' : 'ביום הצילום'} יופקו ${total} תכנים חדשים ${verb ? `ש${inf} ${verb} בהם` : `בהשתתפות ${inf}`}`);
    }
  } else if (inf && TAKES_PART[ctx.influencerId]) {
    content.push(ctx.influencerId === 'simeon' ? 'משפיעני רשת מובילים בישראל' : 'משפיען רשת מוביל בישראל');
  }
  if (ctx.videos) content.push(pod ? `${ctx.videos} סרטוני פודקאסט מקצועיים` : `${ctx.videos} סרטוני רילס מקוריים וטרנדיים לרשתות החברתיות`);
  if (ctx.graphics) content.push(`${ctx.graphics} גרפיקות בהתאמה אישית עם עיצוב מקצועי וממיר`);
  // Anything else in the package (the podcast, collabs, stories, Channel 14, lines added by hand).
  const rest = (ctx.includes || []).filter((i) => !MANAGED.has(i.label) && !(i.qty !== null && SAID.test(i.label)))
    .map((i) => (i.qty === null || i.qty === 1 ? i.label : `${i.qty} ${i.label}`));
  // The podcast line opens the list, as the package's first line.
  if (pod) content.unshift(...rest.filter((l) => l.startsWith('פודקאסט')));
  content.push(...rest.filter((l) => !(pod && l.startsWith('פודקאסט'))));

  const crew = ctx.photographers > 1
    ? `${ctx.photographers} צלמי וידאו מקצועיים עם ציוד הפקה וצילום מהמתקדמים שיש.`
    : 'צלם וידאו מקצועי עם ציוד הפקה וצילום מהמתקדמים שיש.';
  return {
    intro: {
      title: 'מי אנחנו',
      text: 'אסטרטג היא חברת פרסום ושיווק דיגיטלי המתמחה בליווי עסקים - מהעצמאיים והעסקים הקטנים ועד חברות גדולות ומותגים מובילים. אנחנו משלבים חשיבה אסטרטגית, קריאייטיב חד ותפעול שוטף של התוכן ברשתות החברתיות, מתוך מטרה אחת: להפוך נוכחות דיגיטלית לתוצאות עסקיות.',
      strengthsTitle: 'החוזקות שלנו:',
      strengths: [
        'צוות מקצועי הכולל אנשי אסטרטגיה, קריאייטיב, צילום, עריכה וגרפיקה.',
        'ניסיון רב בעבודה עם מגוון רחב של תחומים וקטגוריות.',
        'תהליכי עבודה מסודרים, שקופים וברורים מול הלקוח.',
        'חשיבה לטווח ארוך - בניית תדמית, מותג ונוכחות עקבית לאורך זמן.',
      ],
      after: 'החבילה המוצעת להלן נועדה לאפשר לעסק שלך ליהנות מתוכן איכותי ומדויק, המופק ברמה גבוהה ונותן מענה אמיתי לצרכי השיווק ברשתות החברתיות.',
    },
    package: {
      title: `מה כוללת חבילת ${ctx.packageName}`,
      groups: [
        { title: 'הפקת תוכן ווידאו מקיפה:', items: content },
        { title: 'צוות הפקה וקריאייטיב:', items: [
          'כתיבת תוכן וקריאייטיב לכלל הסרטונים.',
          crew,
          'עריכת וידאו מקצועית (כולל סבב תיקונים אחד לכל תוצר).',
        ] },
        { title: 'ניהול סושיאל מדיה:', items: [
          'מנהל תיק לקוחות הכולל קשר יום יומי ומענה לכל שאלה.',
          'ניהול סושיאל מקצועי בדפים העסקיים של בית העסק ברשתות החברתיות.',
          'העלאת התכנים מימי הצילום לדפים העסקיים של בית העסק ברשתות החברתיות. (אינסטגרם, פייסבוק וטיקטוק).',
          'ניהול פרסום ממומן של בית העסק ברשתות החברתיות.',
          'שיפור הנראות של העמודים העסקיים ברשתות החברתיות.',
        ] },
      ],
    },
    why: {
      title: 'למה לבחור בנו',
      text: 'אנחנו באסטרטג משלבים חשיבה שיווקית חדה עם ביצוע מקצועי בשטח - מצילום וקריאייטיב ועד עריכה והפצה, כך שהתוכן באמת עובד לטובת העסק שלך. אנחנו עובדים בשיטה מסודרת, שקופה ונתמכת נתונים, כדי שתדע בכל רגע לאן התקציב שלך הולך ומה הוא מייצר עבורך.',
    },
    details: {
      title: 'פירוט החבילה',
      groups: [
        { title: 'עלות החבילה:', items: [
          `${money(ctx.totals.monthlyNet)} לחודש + מע״מ כחוק.`,
          'התשלום הוא חודשי, למשך כל תקופת ההתחייבות.',
        ] },
        { title: 'תקופת ההתקשרות:', items: [
          n === 12 ? 'התחייבות ל-12 חודשים (קמפיין שנתי)' : `התחייבות ל-${monthsText(n)}`,
          'תחילת העלאת התוצרים עד 30 ימי עסקים מיום הצילום',
        ] },
        { title: 'תיקונים:', items: [
          'לכל תוצר כלול סבב תיקון אחד במסגרת המחיר.',
          'במקרה של בקשת תיקונים נוספים מעבר לסבב היחיד - תינתן ללקוח מחיר נוסף בנפרד, לפי היקף השינויים.',
        ] },
      ],
    },
    agreementTitle: 'הסכם התקשרות ותנאים',
    closing: 'אנחנו כאן כדי להפוך את המותג שלכם למוביל בתחום, עם אסטרטגיה מדויקת, תוכן מנצח ונוכחות דיגיטלית עוצמתית. יחד, נהפוך את החברה להצלחה!',
  };
}
