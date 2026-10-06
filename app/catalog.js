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

// ── Custom (exceptional) contracts, 6.10.2026 ──
// The office may change a contract by hand on top of a base package: `selection.custom`
// (docs/pricing-rules.md, "חוזה מותאם אישית"). Anything that differs from the built-in
// rules needs a manager's approval before the client can sign (app/pricing.js
// exceptionOf; the database holds the contract as pending).
//
// CUSTOM_QTY: the quantities of the package itself that can be changed (add-ons keep
// adding on top, as always). `base(spec, pkg)`: what the package grants; `max`: the
// most the server accepts; `label(n, sel)`: the line in the document; `name`: the words
// in the list of deviations. `monthly` is the monthly photographer's contents each
// month (only with that add-on).
const INF_NAME = (inf) => INFLUENCERS[inf]?.name || '';
export const MONTHLY_CONTENTS = 8;
export const CUSTOM_QTY = [
  { key: 'videos', max: 300, name: 'סרטונים', base: (s) => s.videos,
    label: (n, sel) => (sel.tier === 'podcast' ? 'סרטוני פודקאסט' : 'סרטונים בבית העסק') },
  { key: 'graphics', max: 300, name: 'גרפיקות', base: (s) => s.graphics, label: () => 'גרפיקות' },
  { key: 'shootDays', max: 12, name: 'ימי צילום עם המשפיענים', base: (s) => s.shootDays,
    label: (n, sel) => `${n === 1 ? 'יום צילום' : 'ימי צילום'} בבית העסק עם ${INF_NAME(sel.influencer)}` },
  { key: 'photoDays', max: 12, name: 'ימי צילום עם צלם', base: (s, pkg) => (pkg.tier === 'podcast' ? 1 : 0),
    label: (n) => `${n === 1 ? 'יום צילום' : 'ימי צילום'} עם צלם בבית העסק, וידאו וסטילס` },
  { key: 'collabs', max: 24, name: 'קולאבים באינסטגרם', base: (s) => s.collabs,
    label: (n, sel) => `${n === 1 ? 'קולאב' : 'קולאבים'} באינסטגרם אצל ${INF_NAME(sel.influencer)}` },
  { key: 'stories', max: 60, name: 'סטורי אצל המשפיענים', base: (s) => s.stories,
    label: (n, sel) => `סטורי אצל ${INF_NAME(sel.influencer)}` },
  { key: 'ch14', max: 12, name: 'אייטמים בערוץ 14', base: (s) => s.ch14,
    label: (n) => (n === 1 ? 'אייטם בערוץ 14' : 'אייטמים בערוץ 14') },
  { key: 'monthly', min: 1, max: 60, name: 'תכנים בחודש מהצלם החודשי', addon: 'photographer', base: () => MONTHLY_CONTENTS },
];
// Which CUSTOM_QTY key each line of PACKAGES[id].includes counts (by position; null: a
// service, or a line that is not changed by hand). tests/pricing.test.mjs holds it equal
// to the lines.
export const INCLUDES_KEYS = {
  'podcast-natali': [null, null, null, 'videos', 'graphics', 'photoDays'],
  'podcast-simeon': [null, null, null, 'videos', 'graphics', 'photoDays'],
  'social-simeon': ['shootDays', null, null, 'videos', 'graphics', null, 'collabs'],
  'social-tv-simeon': ['shootDays', null, null, 'videos', 'graphics', null, 'collabs', 'stories', 'ch14'],
  'social-natali': ['shootDays', null, null, 'videos', 'graphics', null],
  'social-tv-natali': ['shootDays', null, null, 'videos', 'graphics', null, 'ch14'],
};
// The limits of everything typed by hand (the server refuses anything outside them).
export const CUSTOM_LIMITS = {
  termMin: 1, termMax: 36,
  priceMax: 10000000,        // the package's monthly price before VAT: up to 100,000 ₪ (agorot)
  lines: 10, lineLabel: 120, lineQtyMax: 999, linePriceMax: 5000000,
  terms: 2000,
};
