// The seller's deal of 17.11.2026 (Stav's messy WhatsApp text, with a FAKE business: never a real
// client in the repository) and the answer the model is asked to give for it in free mode. The answer is
// RECORDED, written by hand: the real model is not called by the tests (tests/free-text-contract.test.mjs,
// tests/free-text-e2e.mjs).
import { emptySelection } from '../app/pricing.js';

export const STAV_TEXT = [
  'חפ : 500000001',
  'שם עסק : קפה הדגמה בע״מ',
  'מישל דניס סמיון והצל',
  '3,900',
  'אם דני שולח בקבוצה עד 5 תכנים במרוכז בחודש אחד הסושיאל משתף איתו פעולה שלנו לבחור תתוכן הכי יפה ואנחנו עורכים ומעלים לו אותו',
  'באישור דני',
  'ותוסיף גם',
  'עוד 32 סרטונים חוץ מי אה 72 תכנים שיש ברגיל',
  'לפה',
  'תכתוב את זה בצורה מסודרת',
  'ותוסיף לשורה',
  'של למטה',
  'בדגשים',
  'שעד 30 ימי עסקים עולה תוכן',
  'ומיום העלת התוכן נספר השנה',
  'אה 12 חודשים מתחילים להיספר מיום העלאת התוכן',
].join('\n');

// Stav's deal, as the seller closed it: Semyon, Michel, Denis and "הצל", 3,900 a month, 68 videos and 36
// graphics (72 contents and 32 more). A fake business: never a real client in the repository.
export const FAKE_CLIENT = { name: '', company: 'קפה הדגמה בע״מ', companyId: '500000001', phone: '', email: '' };
export const BASE = { ...emptySelection(), docType: 'agreement', tier: 'social', influencer: 'simeon' };
export const STAV = { ...BASE, custom: { price: 390000, qty: { videos: 68, graphics: 36 }, alsoInfluencers: ['hatzel'] } };
export const FIVE = 'בכל חודש רשאי בעל העסק לשלוח לקבוצה עד 5 תכנים שצילם בעצמו. איש הסושיאל של אסטרטג יבחר יחד איתו את התכנים הטובים ביותר, ואסטרטג תערוך אותם ותעלה אותם לרשתות, באישורו של בעל העסק';
export const CL11 = 'ההתקשרות הינה לתקופה קצובה של 12 חודשים, אשר תחל ממועד העלאת התוכן הראשון לרשתות החברתיות';
export const CL12 = 'אסטרטג מתחייבת להתחיל בהעלאת התכנים לרשתות החברתיות עד 30 ימי עסקים מיום הצילום, בכפוף לאמור בסעיף 3';
export const CL33 = 'בכל חודש רשאי בעל העסק לשלוח לקבוצה עד 5 תכנים שצילם בעצמו; איש הסושיאל של אסטרטג יבחר יחד איתו את התכנים הטובים ביותר, ואסטרטג תערוך ותעלה אותם לרשתות החברתיות, באישורו של בעל העסק.';
export const DETAILS = [
  'התשלום הוא חודשי, למשך כל תקופת ההתחייבות.',
  'תחילת העלאת התכנים לרשתות החברתיות - עד 30 ימי עסקים מיום הצילום.',
  '12 חודשי ההתקשרות נספרים מיום העלאת התוכן הראשון לרשתות.',
  'לכל תוצר כלול סבב תיקון אחד במסגרת המחיר.',
];
// The words as the model is asked to give them (its schema's shape: "" and [] keep the regular words).
export const AI_TEXT = {
  title: '', subtitle: 'ALL IN ONE · מישל, דניס, סמיון והצל (יואב אליאסי)', influencerLine: '', noInfluencerLine: true,
  packageTitle: '',
  packageGroups: [
    { title: '{{1}}', items: [
      'יום צילום מקצועי ומרוכז בבית העסק עם מישל, דניס, סמיון והצל (יואב אליאסי)',
      '72 תכנים: 36 סרטוני רילס מקוריים וטרנדיים ו־36 גרפיקות בהתאמה אישית',
      '32 סרטונים נוספים, מעבר ל־72 התכנים שבחבילה - סך הכל 104 תכנים',
      FIVE,
      // The client's business must never go into the words: this line is left out.
      'החבילה מותאמת במיוחד לקפה הדגמה בע״מ',
    ] },
    { title: '{{2}}', items: ['{{2.*}}'] },
    { title: '{{3}}', items: ['{{3.*}}'] },
  ],
  detailsTitle: 'דגשים',
  details: [{ title: 'דגשים:', items: DETAILS }],
  tiles: [{ n: '1', label: 'יום צילום' }, { n: '68', label: 'סרטונים' }, { n: '36', label: 'גרפיקות' }, { n: '104', label: 'תכנים' }],
  clauses: [
    { title: '{{1}}', items: [CL11, CL12, '{{1.2}}'] },
    { title: '{{2}}', items: ['{{2.*}}'] },
    { title: '{{3}}', items: ['{{3.1}}', '{{3.2}}', CL33] },
    { title: '{{4}}', items: ['{{4.*}}'] },
    { title: '{{5}}', items: ['{{5.*}}'] },
    { title: '{{6}}', items: ['{{6.*}}'] },
    { title: '{{7}}', items: ['{{7.*}}'] },
  ],
};
// The recorded answer of free mode for the seller's text (see the header: written by hand).
export const FAKE_ANSWER = { drafts: [{
  title: 'ALL IN ONE · סמיון והצל', docType: null, influencer: 'simeon', simeonJoin: false, alsoInfluencers: ['hatzel'],
  influencerName: null, postsAt: [], tier: null, monthlyPrice: 390000, priceIncludesVat: false, monthlyShoot: false,
  monthlyContents: null, quantities: [{ key: 'videos', value: 68 }, { key: 'graphics', value: 36 }], addons: [], months: null,
  extraLines: [], specialClauses: [], discount: null, client: FAKE_CLIENT, text: AI_TEXT,
}], questions: [], notes: null };

