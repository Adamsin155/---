// Catalog: the code mirror of docs/pricing-rules.md. Prices are in agorot.
// Shared by the builder, the client page and the create-quote edge function.

export const VAT_RATE_PERCENT = 18;

// Document types chosen before building: a quote is informational only;
// an agreement adds the legal terms and requires the client's signature.
// validHours: how long the link stays valid (quote) or signable (agreement).
export const DOC_TYPES = {
  quote: { id: 'quote', name: 'הצעת מחיר', signable: false, validHours: 48 },
  agreement: { id: 'agreement', name: 'הסכם התקשרות', signable: true, validHours: 72 },
};

// Optional monthly discount a seller may give on any package, in agorot.
export const MAX_DISCOUNT = 20000;
export const TERM_MONTHS = 12;

export const INFLUENCERS = {
  natali: { id: 'natali', name: 'נטלי דדון' },
  simeon: { id: 'simeon', name: 'סמיון, מישל ודניס' },
};

export const TIERS = [
  { id: 'podcast', name: 'פודקאסט עם משפיענים', short: 'Podcast' },
  { id: 'social', name: 'Social all in one', short: 'Social' },
  { id: 'social-tv', name: 'Social + TV all in one', short: 'Social + TV' },
];

// Each included line: qty is an annual quantity (null for ongoing services).
export const PACKAGES = {
  'podcast-natali': {
    tier: 'podcast', influencer: 'natali', price: 350000,
    includes: [
      { qty: null, label: 'פודקאסט עם נטלי דדון' },
      { qty: null, label: 'ניהול רשתות חברתיות' },
      { qty: null, label: 'ניהול קמפיינים ממומנים ברשתות' },
      { qty: 20, label: 'סרטוני פודקאסט' },
      { qty: 20, label: 'גרפיקות' },
      { qty: 1, label: 'יום צילום עם צלם בבית העסק, וידאו וסטילס' },
    ],
  },
  'podcast-simeon': {
    tier: 'podcast', influencer: 'simeon', price: 350000,
    includes: [
      { qty: null, label: 'פודקאסט עם סמיון, מישל ודניס' },
      { qty: null, label: 'ניהול רשתות חברתיות' },
      { qty: null, label: 'ניהול קמפיינים ממומנים ברשתות' },
      { qty: 20, label: 'סרטוני פודקאסט' },
      { qty: 20, label: 'גרפיקות' },
      { qty: 1, label: 'יום צילום עם צלם בבית העסק, וידאו וסטילס' },
    ],
  },
  'social-simeon': {
    tier: 'social', influencer: 'simeon', price: 390000,
    includes: [
      { qty: 1, label: 'יום צילום בבית העסק עם סמיון, מישל ודניס' },
      { qty: null, label: 'ניהול רשתות חברתיות' },
      { qty: null, label: 'ניהול קמפיינים ממומנים ברשתות' },
      { qty: 25, label: 'סרטונים בבית העסק' },
      { qty: 35, label: 'גרפיקות' },
      { qty: 2, label: 'צלמים לווידאו וסטילס בבית העסק' },
      { qty: 1, label: 'קולאב באינסטגרם אצל סמיון, מישל ודניס' },
    ],
  },
  'social-tv-simeon': {
    tier: 'social-tv', influencer: 'simeon', price: 490000,
    includes: [
      { qty: 2, label: 'ימי צילום בבית העסק עם סמיון, מישל ודניס' },
      { qty: null, label: 'ניהול רשתות חברתיות' },
      { qty: null, label: 'ניהול קמפיינים ממומנים ברשתות' },
      { qty: 42, label: 'סרטונים בבית העסק' },
      { qty: 42, label: 'גרפיקות' },
      { qty: 2, label: 'צלמים לווידאו וסטילס בבית העסק' },
      { qty: 3, label: 'קולאבים באינסטגרם אצל סמיון, מישל ודניס' },
      { qty: 3, label: 'סטורי אצל סמיון, מישל ודניס' },
      { qty: 1, label: 'אייטם בערוץ 14' },
    ],
  },
  'social-natali': {
    tier: 'social', influencer: 'natali', price: 390000,
    includes: [
      { qty: 1, label: 'יום צילום בבית העסק עם נטלי דדון' },
      { qty: null, label: 'ניהול רשתות חברתיות' },
      { qty: null, label: 'ניהול קמפיינים ממומנים ברשתות' },
      { qty: 25, label: 'סרטונים בבית העסק' },
      { qty: 35, label: 'גרפיקות' },
      { qty: 2, label: 'צלמים לווידאו וסטילס בבית העסק' },
    ],
  },
  'social-tv-natali': {
    tier: 'social-tv', influencer: 'natali', price: 490000,
    includes: [
      { qty: 1, label: 'יום צילום בבית העסק עם נטלי דדון' },
      { qty: null, label: 'ניהול רשתות חברתיות' },
      { qty: null, label: 'ניהול קמפיינים ממומנים ברשתות' },
      { qty: 42, label: 'סרטונים בבית העסק' },
      { qty: 42, label: 'גרפיקות' },
      { qty: 2, label: 'צלמים לווידאו וסטילס בבית העסק' },
      { qty: 1, label: 'אייטם בערוץ 14' },
    ],
  },
};

export const PAID_ADDONS = [
  {
    id: 'photographer', price: 200000, eligibility: 'all',
    name: 'צלם חודשי',
    detail: 'צלם שמגיע לבית העסק כל חודש ומייצר 8 תכנים בכל חודש',
    monthlyOutput: true,
  },
  {
    id: 'natali-reel', price: 100000, eligibility: 'natali',
    name: 'העלאה אצל נטלי דדון',
    detail: 'רילס אחד בשנה שעולה אצל נטלי דדון',
  },
  {
    id: 'natali-story', price: 30000, eligibility: 'natali',
    name: 'סטורי אצל נטלי דדון',
    detail: 'סטורי אחד בשנה שעולה אצל נטלי דדון',
  },
  {
    id: 'simeon-day', price: 50000, eligibility: 'simeon-social',
    name: 'יום צילום נוסף עם סמיון, מישל ודניס',
    detail: 'יום צילום אחד נוסף בשנה',
  },
];

export const FREE_ADDONS = {
  graphics: { id: 'graphics', name: 'גרפיקות נוספות', max: 24, unit: 'גרפיקות' },
  simeonStories: { id: 'simeonStories', name: 'סטורי אצל סמיון, מישל ודניס', max: 3, unit: 'סטורי' },
  simeonJoin: {
    id: 'simeonJoin', name: 'צירוף סמיון ליום הצילום עם נטלי',
    detail: 'סמיון מגיע ביחד עם נטלי ליום הצילום או להקלטת הפודקאסט. ללא קולאב וללא סטוריז.',
  },
  extraCh14: {
    id: 'extraCh14', name: 'אייטם נוסף בערוץ 14',
    detail: 'במקרים חריגים בלבד',
  },
};

// Comparison rows for the package picker. Values mirror `includes` above
// (annual quantities); tests/pricing.test.mjs checks they stay in sync.
export const SPEC_ROWS = [
  { key: 'videos', label: 'סרטונים' },
  { key: 'graphics', label: 'גרפיקות' },
  { key: 'shootDays', label: 'ימי צילום עם המשפיענים' },
  { key: 'photographers', label: 'צלמים' },
  { key: 'collabs', label: 'קולאבים באינסטגרם' },
  { key: 'stories', label: 'סטורי אצל המשפיענים' },
  { key: 'ch14', label: 'אייטם בערוץ 14' },
];

export const SPECS = {
  'podcast-natali': { videos: 20, graphics: 20, shootDays: 0, photographers: 1, collabs: 0, stories: 0, ch14: 0 },
  'podcast-simeon': { videos: 20, graphics: 20, shootDays: 0, photographers: 1, collabs: 0, stories: 0, ch14: 0 },
  'social-simeon': { videos: 25, graphics: 35, shootDays: 1, photographers: 2, collabs: 1, stories: 0, ch14: 0 },
  'social-tv-simeon': { videos: 42, graphics: 42, shootDays: 2, photographers: 2, collabs: 3, stories: 3, ch14: 1 },
  'social-natali': { videos: 25, graphics: 35, shootDays: 1, photographers: 2, collabs: 0, stories: 0, ch14: 0 },
  'social-tv-natali': { videos: 42, graphics: 42, shootDays: 1, photographers: 2, collabs: 0, stories: 0, ch14: 1 },
};

export function packageId(tier, influencer) {
  return `${tier}-${influencer}`;
}
