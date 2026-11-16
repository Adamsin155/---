// Catalog: the code mirror of docs/pricing-rules.md. Prices are in agorot.
// Shared by the builder, the client page and the create-quote edge function.

export const VAT_RATE_PERCENT = 18;

// Document types chosen before building: a quote is informational only;
// an agreement adds the legal terms and requires the client's signature.
// validHours: how long the link stays valid (quote) or signable (agreement). One week for both
// since 9.11.2026 (the owner; docs/ops.md, section 118); until then 48 (quote) and 72 (agreement).
// The database sets expires_at from the model's validHours (quotes_set_hash), so a new link takes it.
export const DOC_TYPES = {
  quote: { id: 'quote', name: 'הצעת מחיר', signable: false, validHours: 168 },
  agreement: { id: 'agreement', name: 'הסכם התקשרות', signable: true, validHours: 168 },
};
// The validity in words: whole days from 4 days on ("7 ימים"), else hours ("72 שעות"), so a document
// made with 48 or 72 hours reads exactly as it did.
export function validityWords(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return '';
  return h >= 96 && h % 24 === 0 ? `${h / 24} ימים` : `${h} שעות`;
}

// Optional monthly discount a seller may give on any package, in agorot.
export const MAX_DISCOUNT = 20000;
// A podcast package (any influencer) may take up to 800 ₪ a month with no approval (the owner,
// 28.10.2026); every other package keeps MAX_DISCOUNT.
export const MAX_DISCOUNT_PODCAST = 80000;
export const maxDiscountFor = (tier) => (tier === 'podcast' ? MAX_DISCOUNT_PODCAST : MAX_DISCOUNT);
export const TERM_MONTHS = 12;

// `short`: the name inside a sentence. `shootType`: the shoot day the signed agreement opens
// the client with (clients.shoot_type; app/protocol.js SHOOT_TYPES).
export const INFLUENCERS = {
  natali: { id: 'natali', name: 'נטלי דדון', short: 'נטלי', shootType: 'natali' },
  simeon: { id: 'simeon', name: 'סמיון, מישל ודניס', shootType: 'dms' },
  niro: { id: 'niro', name: 'נירו לוי', short: 'נירו', shootType: 'niro' },
  hatzel: { id: 'hatzel', name: 'הצל (יואב אליאסי)', short: 'הצל', shootType: 'hatzel' },
  // Arik Mishali (the owner, 8.11.2026): as Niro and "הצל", exactly as Natali.
  arik: { id: 'arik', name: 'אריק משעלי', short: 'אריק', shootType: 'arik' },
  // "משפיען לבחירה" (the owner, 5.11.2026; the old system's "ALL IN ONE · משפיען לבחירה מרשימת
  // המשפיענים של אסטרטג"): the client signs now and the influencer is chosen later with the
  // business. Natali's packages and quantities, with no add-on at an influencer (nobody is
  // chosen yet). No shoot type: the signed agreement opens the client without one, and the
  // office sets it in the card once chosen. `inText`: the words inside a sentence.
  choice: {
    id: 'choice', name: 'משפיען לבחירה מרשימת המשפיענים של אסטרטג', label: 'משפיען לבחירה', short: 'משפיען לבחירה',
    inText: 'משפיען מרשימת המשפיענים של אסטרטג שייבחר בתיאום עם בית העסק', shootType: null, choice: true,
  },
};
// An influencer said inside a sentence ("יום צילום ... עם X").
export const infText = (inf) => INFLUENCERS[inf]?.inText || INFLUENCERS[inf]?.name || '';
// The name on a picker's button ("משפיען לבחירה"; the others their name).
export const infLabel = (inf) => INFLUENCERS[inf]?.label || INFLUENCERS[inf]?.name || '';
export const isChoice = (inf) => INFLUENCERS[inf]?.choice === true;
// An influencer's name in a list of several (16.11.2026: "סמיון, מישל ודניס + הצל"): the catalog's
// name without what is in brackets ("הצל", not "הצל (יואב אליאסי)").
export const infPlain = (inf) => INFLUENCERS[inf]?.label || String(INFLUENCERS[inf]?.name || '').replace(/\s*\([^)]*\)\s*$/, '');
// Several influencers in one contract (the owner, 16.11.2026; selection.custom.alsoInfluencers, app/pricing.js):
// at most this many next to the contract's own influencer.
export const MAX_ALSO_INFLUENCERS = 4;
// Who can be added next to the contract's own influencer: any named influencer of the catalog.
export const canAlsoBe = (inf) => !!INFLUENCERS[inf] && !isChoice(inf);
// The influencers of a contract, the contract's own first (selection.influencer: it decides the package,
// the add-ons and the shoot day the signed agreement opens the client with), then the ones added by hand.
// None in a contract "בלי משפיענים"; nobody next to "משפיען לבחירה".
export function contractInfluencers(sel) {
  if (!INFLUENCERS[sel?.influencer] || sel?.custom?.noInfluencer === true) return [];
  const out = [sel.influencer];
  const also = isChoice(sel.influencer) || !Array.isArray(sel.custom?.alsoInfluencers) ? [] : sel.custom.alsoInfluencers;
  for (const id of also) if (canAlsoBe(id) && !out.includes(id) && out.length <= MAX_ALSO_INFLUENCERS) out.push(id);
  return out;
}
// The influencers' name inside the document's sentences: the one typed for this quote
// (custom.influencerName); else, with several, their names joined ("סמיון, מישל ודניס + הצל");
// else the catalog's ("יום צילום ... עם X"). Empty in a contract "בלי משפיענים".
export function shownInfluencerText(sel) {
  if (sel?.custom?.noInfluencer === true) return '';
  const typed = typeof sel?.custom?.influencerName === 'string' ? sel.custom.influencerName.trim() : '';
  if (typed) return typed;
  const all = contractInfluencers(sel);
  return all.length > 1 ? all.map(infPlain).join(' + ') : infText(sel?.influencer);
}
// Niro Levi and "הצל" (Yoav Eliasi), the owner's decision of 28.10.2026: each exactly as Natali
// Dadon. The same three packages with the same prices and quantities, the same paid add-ons (a
// reel and a story at the influencer), and a shoot day that runs as hers (app/protocol.js
// isStarDay). Only "צירוף סמיון ליום הצילום" stays Natali's. The first star is Natali herself.
// Arik Mishali joined on 8.11.2026 (the owner: the same packages and prices as Natali).
export const STARS = ['natali', 'niro', 'hatzel', 'arik'];
export const isStar = (influencer) => STARS.includes(influencer);
const STAR_TIERS = ['podcast', 'social', 'social-tv'];
// Natali's words, said of another star: her full name becomes theirs.
const inName = (text, inf) => text.replaceAll(INFLUENCERS.natali.name, INFLUENCERS[inf].name);

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
      { qty: 36, label: 'סרטונים בבית העסק' },
      { qty: 36, label: 'גרפיקות' },
      { qty: 2, label: 'צלמים לווידאו וסטילס בבית העסק' },
    ],
  },
  'social-tv-natali': {
    tier: 'social-tv', influencer: 'natali', price: 490000,
    includes: [
      { qty: 1, label: 'יום צילום בבית העסק עם נטלי דדון' },
      { qty: null, label: 'ניהול רשתות חברתיות' },
      { qty: null, label: 'ניהול קמפיינים ממומנים ברשתות' },
      { qty: 36, label: 'סרטונים בבית העסק' },
      { qty: 36, label: 'גרפיקות' },
      { qty: 2, label: 'צלמים לווידאו וסטילס בבית העסק' },
      { qty: 1, label: 'אייטם בערוץ 14' },
    ],
  },
};
// The packages of Niro, of "הצל" and of Arik: Natali's, line by line, in their own name.
for (const inf of STARS.slice(1)) {
  for (const tier of STAR_TIERS) {
    const p = PACKAGES[`${tier}-natali`];
    PACKAGES[`${tier}-${inf}`] = { ...p, influencer: inf, includes: p.includes.map((l) => ({ ...l, label: inName(l.label, inf) })) };
  }
}
// "משפיען לבחירה": Natali's packages too, the influencer said as one still to be chosen
// ("יום צילום בבית העסק, עם משפיען מרשימת המשפיענים של אסטרטג שייבחר בתיאום עם בית העסק").
for (const tier of STAR_TIERS) {
  const p = PACKAGES[`${tier}-natali`];
  PACKAGES[`${tier}-choice`] = {
    ...p, influencer: 'choice',
    includes: p.includes.map((l) => ({ ...l, label: l.label.replace(` עם ${INFLUENCERS.natali.name}`, `, עם ${INFLUENCERS.choice.inText}`) })),
  };
}

export const PAID_ADDONS = [
  {
    id: 'photographer', price: 200000, eligibility: 'all',
    name: 'צלם חודשי',
    detail: 'צלם שמגיע לבית העסק כל חודש ומייצר 8 תכנים בכל חודש',
    monthlyOutput: true,
  },
  // A reel and a story at each star, in her or his own packages only (eligibility: the
  // influencer). `post`: what the client gets one more of (app/protocol-logic.js
  // packageDeliverables; public.package_deliverables in the database).
  ...STARS.flatMap((inf) => [
    {
      id: `${inf}-reel`, price: 100000, eligibility: inf, post: 'collabs',
      name: `העלאה אצל ${INFLUENCERS[inf].name}`,
      detail: `רילס אחד בשנה שעולה אצל ${INFLUENCERS[inf].name}`,
    },
    {
      id: `${inf}-story`, price: 30000, eligibility: inf, post: 'stories',
      name: `סטורי אצל ${INFLUENCERS[inf].name}`,
      detail: `סטורי אחד בשנה שעולה אצל ${INFLUENCERS[inf].name}`,
    },
  ]),
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
  'social-natali': { videos: 36, graphics: 36, shootDays: 1, photographers: 2, collabs: 0, stories: 0, ch14: 0 },
  'social-tv-natali': { videos: 36, graphics: 36, shootDays: 1, photographers: 2, collabs: 0, stories: 0, ch14: 1 },
};
for (const inf of [...STARS.slice(1), 'choice']) for (const tier of STAR_TIERS) SPECS[`${tier}-${inf}`] = { ...SPECS[`${tier}-natali`] };

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
const INF_NAME = (inf) => infText(inf);
export const MONTHLY_CONTENTS = 8;
export const CUSTOM_QTY = [
  { key: 'videos', max: 200, name: 'סרטונים', base: (s) => s.videos,
    label: (n, sel) => (sel.tier === 'podcast' ? 'סרטוני פודקאסט' : 'סרטונים בבית העסק') },
  { key: 'graphics', max: 300, name: 'גרפיקות', base: (s) => s.graphics, label: () => 'גרפיקות' },
  // With the influencers' name the document shows (several influencers, or a name typed for the quote).
  { key: 'shootDays', max: 12, name: 'ימי צילום עם המשפיענים', base: (s) => s.shootDays,
    label: (n, sel) => {
      const shown = shownInfluencerText(sel);
      const own = shown === INF_NAME(sel.influencer);
      return `${n === 1 ? 'יום צילום' : 'ימי צילום'} בבית העסק${own && isChoice(sel.influencer) ? ',' : ''} עם ${shown}`;
    } },
  { key: 'photoDays', max: 12, name: 'ימי צילום עם צלם', base: (s, pkg) => (pkg.tier === 'podcast' ? 1 : 0),
    label: (n) => `${n === 1 ? 'יום צילום' : 'ימי צילום'} עם צלם בבית העסק, וידאו וסטילס` },
  { key: 'collabs', max: 24, name: 'קולאבים באינסטגרם', base: (s) => s.collabs,
    label: (n, sel) => `${n === 1 ? 'קולאב' : 'קולאבים'} באינסטגרם אצל ${INF_NAME(sel.influencer)}`,
    // One line per influencer (custom.postsAt, 16.11.2026): "2 קולאבים באינסטגרם אצל הצל".
    labelAt: (n, inf) => `${n === 1 ? 'קולאב' : 'קולאבים'} באינסטגרם אצל ${infPlain(inf)}` },
  { key: 'stories', max: 60, name: 'סטורי אצל המשפיענים', base: (s) => s.stories,
    label: (n, sel) => `סטורי אצל ${INF_NAME(sel.influencer)}`,
    labelAt: (n, inf) => `סטורי אצל ${infPlain(inf)}` },
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
for (const inf of [...STARS.slice(1), 'choice']) for (const tier of STAR_TIERS) INCLUDES_KEYS[`${tier}-${inf}`] = [...INCLUDES_KEYS[`${tier}-natali`]];
// The limits of everything typed by hand (the server refuses anything outside them).
export const CUSTOM_LIMITS = {
  termMin: 1, termMax: 36,
  priceMax: 10000000,        // the package's monthly price before VAT: up to 100,000 ₪ (agorot)
  lines: 10, lineLabel: 120, lineQtyMax: 999, linePriceMax: 5000000,
  terms: 2000,
  // The package's name as the document shows it, for this quote only (the owner, 9.11.2026).
  packageName: 60,
  // The influencers' name as the document shows it, for this quote only (the owner, 15.11.2026:
  // "סמיון, מישל ודניס + הצל" on the cover and on the package).
  influencerName: 60,
};
