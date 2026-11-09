import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAID_ADDONS, TIERS, INFLUENCERS } from '../app/catalog.js';
import {
  emptySelection, computeTotals, reconcile, validateSelection,
  paidAddonAvailable, buildQuoteModel,
} from '../app/pricing.js';

const sel = (tier, influencer, paid = [], free = {}) => ({
  ...emptySelection(), tier, influencer, paid,
  free: { ...emptySelection().free, ...free },
});
const shekels = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v / 100]));

// Acceptance cases from docs/pricing-rules.md
const cases = [
  ['podcast, no add-ons', sel('podcast', 'natali'), [3500, 630, 4130, 49560]],
  ['podcast (simeon), no add-ons', sel('podcast', 'simeon'), [3500, 630, 4130, 49560]],
  ['social natali + reel + story', sel('social', 'natali', ['natali-reel', 'natali-story']), [5200, 936, 6136, 73632]],
  ['social+tv simeon + photographer + day', sel('social-tv', 'simeon', ['photographer', 'simeon-day']), [7400, 1332, 8732, 104784]],
  ['social+tv natali + photographer + reel + story', sel('social-tv', 'natali', ['photographer', 'natali-reel', 'natali-story']), [8200, 1476, 9676, 116112]],
  ['podcast natali + reel + story', sel('podcast', 'natali', ['natali-reel', 'natali-story']), [4800, 864, 5664, 67968]],
];

for (const [name, s, [net, vat, gross, termGross]] of cases) {
  test(`acceptance: ${name}`, () => {
    validateSelection(s);
    const t = shekels(computeTotals(s));
    assert.equal(t.monthlyNet, net);
    assert.equal(t.monthlyVat, vat);
    assert.equal(t.monthlyGross, gross);
    assert.equal(t.termGross, termGross);
    assert.equal(t.termNet, net * 12);
  });
}

test('free add-ons never change the price', () => {
  const base = computeTotals(sel('social', 'natali'));
  const withFree = computeTotals(sel('social', 'natali', [], { graphics: 24, simeonJoin: true, simeonStories: 3, extraCh14: true }));
  assert.deepEqual(withFree, base);
});

// 34 until 28.10.2026; Niro and "הצל" add Natali's 24 each (3 tiers × 8: the photographer, a reel, a story).
// 88 since 5.11.2026: "משפיען לבחירה" adds 3 packages, each with or without the monthly photographer.
test('coverage: every package x every eligible paid combination = 112 (Arik Mishali, 8.11.2026: 24 more)', () => {
  let count = 0;
  for (const tier of TIERS) {
    for (const inf of Object.keys(INFLUENCERS)) {
      const probe = sel(tier.id, inf);
      const avail = PAID_ADDONS.filter((a) => paidAddonAvailable(a, probe));
      for (let mask = 0; mask < 1 << avail.length; mask++) {
        const paid = avail.filter((_, i) => mask & (1 << i)).map((a) => a.id);
        const s = sel(tier.id, inf, paid);
        validateSelection(s);
        const t = computeTotals(s);
        const expectedNet = { podcast: 350000, social: 390000, 'social-tv': 490000 }[tier.id]
          + paid.reduce((sum, id) => sum + PAID_ADDONS.find((a) => a.id === id).price, 0);
        assert.equal(t.monthlyNet, expectedNet);
        assert.equal(t.monthlyVat, expectedNet * 0.18);
        assert.equal(t.termGross, (expectedNet + t.monthlyVat) * 12);
        count++;
      }
    }
  }
  assert.equal(count, 112);
});

test('eligibility: natali add-ons only in natali packages (incl. podcast)', () => {
  assert.throws(() => validateSelection(sel('social', 'simeon', ['natali-reel'])));
  assert.throws(() => validateSelection(sel('podcast', 'simeon', ['natali-story'])));
  validateSelection(sel('podcast', 'natali', ['natali-reel']));
});

test('eligibility: simeon day only in simeon social packages, not podcast', () => {
  assert.throws(() => validateSelection(sel('social', 'natali', ['simeon-day'])));
  assert.throws(() => validateSelection(sel('podcast', 'simeon', ['simeon-day'])));
  validateSelection(sel('social-tv', 'simeon', ['simeon-day']));
});

test('eligibility: free simeon stories', () => {
  validateSelection(sel('social', 'simeon', [], { simeonStories: 3 }));
  assert.throws(() => validateSelection(sel('podcast', 'simeon', [], { simeonStories: 1 })));
  assert.throws(() => validateSelection(sel('social', 'natali', [], { simeonStories: 1 })));
  validateSelection(sel('social', 'natali', [], { simeonJoin: true, simeonStories: 2 }));
  validateSelection(sel('podcast', 'natali', [], { simeonJoin: true, simeonStories: 1 }));
  assert.throws(() => validateSelection(sel('social', 'simeon', [], { simeonJoin: true })));
});

test('validation: bad quantities, duplicates, unknown ids', () => {
  for (const g of [-1, 25, 1.5, '3', null]) {
    assert.throws(() => validateSelection(sel('social', 'simeon', [], { graphics: g })));
  }
  assert.throws(() => validateSelection(sel('social', 'simeon', [], { simeonStories: 4 })));
  assert.throws(() => validateSelection(sel('social', 'simeon', ['photographer', 'photographer'])));
  assert.throws(() => validateSelection(sel('social', 'simeon', ['nope'])));
  assert.throws(() => validateSelection(sel('gold', 'simeon')));
  assert.throws(() => validateSelection(sel('social', 'someone')));
  validateSelection(sel('social', 'simeon', [], { graphics: 0 }));
  validateSelection(sel('social', 'simeon', [], { graphics: 24 }));
  validateSelection(sel('social', 'simeon', [], { graphics: 12 }));
});

test('reconcile: natali -> simeon removes natali items and join, keeps stories', () => {
  const from = sel('social', 'natali', ['photographer', 'natali-reel', 'natali-story'], { simeonJoin: true, simeonStories: 2 });
  const { selection, removed } = reconcile({ ...from, influencer: 'simeon' });
  assert.deepEqual(selection.paid, ['photographer']);
  assert.equal(selection.free.simeonJoin, false);
  assert.equal(selection.free.simeonStories, 2);
  assert.equal(removed.length, 3);
  validateSelection(selection);
});

test('reconcile: podcast natali -> podcast simeon removes stories too', () => {
  const from = sel('podcast', 'natali', ['natali-reel'], { simeonJoin: true, simeonStories: 3 });
  const { selection, removed } = reconcile({ ...from, influencer: 'simeon' });
  assert.deepEqual(selection.paid, []);
  assert.equal(selection.free.simeonStories, 0);
  assert.equal(removed.length, 3);
  validateSelection(selection);
});

test('reconcile: simeon -> natali removes simeon day and stories', () => {
  const from = sel('social-tv', 'simeon', ['simeon-day'], { simeonStories: 3, graphics: 10 });
  const { selection } = reconcile({ ...from, influencer: 'natali' });
  assert.deepEqual(selection.paid, []);
  assert.equal(selection.free.simeonStories, 0);
  assert.equal(selection.free.graphics, 10);
});

test('model lists only what was selected, trims client fields', () => {
  const m = buildQuoteModel(sel('social', 'natali', ['natali-story'], { extraCh14: true }), { name: '  לקוח  ' });
  assert.equal(m.client.name, 'לקוח');
  assert.deepEqual(m.paid.map((p) => p.id), ['natali-story']);
  assert.deepEqual(m.free.map((f) => f.id), ['extraCh14']);
  assert.equal(m.package.influencer, 'נטלי דדון');
});

test('catalog: comparison specs match the included items', async () => {
  const { PACKAGES, SPECS } = await import('../app/catalog.js');
  const find = (pkg, re) => pkg.includes.find((i) => re.test(i.label))?.qty ?? 0;
  for (const [id, pkg] of Object.entries(PACKAGES)) {
    const s = SPECS[id];
    assert.ok(s, `specs for ${id}`);
    assert.equal(s.videos, find(pkg, /סרטונ/), `${id} videos`);
    assert.equal(s.graphics, find(pkg, /^גרפיקות$/), `${id} graphics`);
    assert.equal(s.shootDays, find(pkg, /(יום|ימי) צילום.*(סמיון|נטלי|נירו|הצל|אריק|משפיען מרשימת)/), `${id} shootDays`);
    assert.equal(s.collabs, find(pkg, /קולאב/), `${id} collabs`);
    assert.equal(s.stories, find(pkg, /^סטורי/), `${id} stories`);
    assert.equal(s.ch14, find(pkg, /ערוץ 14/), `${id} ch14`);
    assert.equal(s.photographers, find(pkg, /צלמים/) || (find(pkg, /עם צלם/) ? 1 : 0), `${id} photographers`);
  }
});

test('document type: quote has no legal text, agreement syncs price into the terms', () => {
  const q = buildQuoteModel(sel('social', 'natali'), { name: 'x' });
  assert.equal(q.docType, 'quote');
  assert.equal(q.signable, false);
  assert.equal(q.legal, null);
  assert.equal(q.wording, undefined);
  const a = buildQuoteModel({ ...sel('social-tv', 'natali', ['photographer']), docType: 'agreement' }, { name: 'x', companyId: '514729938' });
  assert.equal(a.signable, true);
  assert.equal(a.client.companyId, '514729938');
  // The price the client pays a month, add-ons included (the old wording; the table has the lines).
  const payment = a.legal.find((s) => s.title === 'התמורה ותנאי תשלום');
  assert.equal(payment.items[0], 'התמורה עבור החבילה הינה 6,900 ₪ לחודש + מע״מ כחוק, למשך 12 חודשים.');
  assert.equal(a.wording.details.groups[0].items[0], '6,900 ₪ לחודש + מע״מ כחוק.');
  assert.throws(() => validateSelection({ ...sel('social', 'simeon'), docType: 'contract' }));
});

test('agreement text follows the selected package (the old wording, LEGAL_VERSION 3)', () => {
  const words = (s) => buildQuoteModel({ ...s, docType: 'agreement' }, { name: 'x' }).wording;
  const content = (s) => words(s).package.groups[0].items;

  // Niro, "ALL IN ONE": the old document the owner sent, line by line.
  assert.deepEqual(content(sel('social', 'niro')), [
    'יום צילום מקצועי ומרוכז עם נירו לוי',
    'משפיען רשת מוביל בישראל',
    'ביום הצילום יופקו 72 תכנים חדשים שנירו לוי ישתתף בהם',
    '36 סרטוני רילס מקוריים וטרנדיים לרשתות החברתיות',
    '36 גרפיקות בהתאמה אישית עם עיצוב מקצועי וממיר',
  ]);
  assert.equal(words(sel('social', 'niro')).package.title, 'מה כוללת חבילת Social all in one');
  assert.match(content(sel('social', 'natali')).join('\n'), /שנטלי דדון תשתתף בהם/);
  // Two shoot days, and the paid extra Simeon day counted.
  assert.match(content(sel('social-tv', 'simeon')).join('\n'), /^2 ימי צילום מקצועיים ומרוכזים עם סמיון, מישל ודניס$/m);
  assert.match(content(sel('social-tv', 'simeon', ['simeon-day'])).join('\n'), /^3 ימי צילום/m);
  assert.match(content(sel('social-tv', 'simeon')).join('\n'), /בימי הצילום יופקו 84 תכנים חדשים שסמיון, מישל ודניס ישתתפו בהם/);
  // What the old document had no words for is listed as the package says it.
  assert.ok(content(sel('social-tv', 'natali')).includes('אייטם בערוץ 14'));
  assert.ok(!content(sel('social', 'natali')).includes('אייטם בערוץ 14'));
  assert.ok(content(sel('social-tv', 'simeon')).includes('3 קולאבים באינסטגרם אצל סמיון, מישל ודניס'));
  // A podcast: the podcast first, its videos, the day with a photographer at the business.
  assert.deepEqual(content(sel('podcast', 'natali')), [
    'פודקאסט עם נטלי דדון', 'משפיען רשת מוביל בישראל', '20 סרטוני פודקאסט מקצועיים',
    '20 גרפיקות בהתאמה אישית עם עיצוב מקצועי וממיר', 'יום צילום עם צלם בבית העסק, וידאו וסטילס',
  ]);
  // The crew: two photographers in a social package, one in a podcast.
  assert.equal(words(sel('social', 'natali')).package.groups[1].items[1], '2 צלמי וידאו מקצועיים עם ציוד הפקה וצילום מהמתקדמים שיש.');
  assert.equal(words(sel('podcast', 'natali')).package.groups[1].items[1], 'צלם וידאו מקצועי עם ציוד הפקה וצילום מהמתקדמים שיש.');
  // The same six clauses for every package; nothing undefined anywhere.
  for (const s of [sel('social', 'natali'), sel('social-tv', 'simeon', ['photographer']), sel('podcast', 'simeon'), sel('social', 'natali', [], { extraCh14: true })]) {
    const m = buildQuoteModel({ ...s, docType: 'agreement' }, { name: 'x' });
    assert.deepEqual(m.legal.map((x) => x.title), ['תקופת ההסכם', 'התמורה ותנאי תשלום', 'לוחות זמנים ותכני הלקוח', 'תיקונים ואישורים', 'אחריות ותוצאות פרסומיות', 'שונות']);
    assert.doesNotMatch(JSON.stringify([m.legal, m.wording]), /undefined|NaN/);
  }
});

test('discount: up to 200 ILS a month, whole shekels, shown in totals and terms', () => {
  const s = { ...sel('social', 'natali', ['natali-reel']), discount: 20000 };
  validateSelection(s);
  const t = shekels(computeTotals(s));
  assert.equal(t.monthlyList, 4900);
  assert.equal(t.discount, 200);
  assert.equal(t.monthlyNet, 4700);
  assert.equal(t.monthlyGross, 5546);
  assert.equal(t.termGross, 66552);
  for (const bad of [20100, -100, 150, 1.5, '100']) {
    assert.throws(() => validateSelection({ ...sel('social', 'natali'), discount: bad }), /discount/);
  }
  validateSelection({ ...sel('social', 'natali'), discount: undefined });
  const a = buildQuoteModel({ ...s, docType: 'agreement' }, { name: 'x' });
  // The old wording (LEGAL_VERSION 3) says the price after the discount; the price table shows the discount.
  const payment = a.legal.find((x) => x.title === 'התמורה ותנאי תשלום').items[0];
  assert.equal(payment, 'התמורה עבור החבילה הינה 4,700 ₪ לחודש + מע״מ כחוק, למשך 12 חודשים.');
  assert.equal(a.wording.details.groups[0].items[0], '4,700 ₪ לחודש + מע״מ כחוק.');
});

test('validity: quote 48 hours, agreement 72 hours', () => {
  assert.equal(buildQuoteModel(sel('social', 'natali'), { name: 'x' }).validHours, 48);
  assert.equal(buildQuoteModel({ ...sel('social', 'natali'), docType: 'agreement' }, { name: 'x' }).validHours, 72);
});

test('client fields drop bidi control characters', () => {
  const m = buildQuoteModel(sel('social', 'natali'), { name: '\u202Eevil\u202C ', company: 'a\u2066b' });
  assert.equal(m.client.name, 'evil');
  assert.equal(m.client.company, 'ab');
});

// The old system's words (the owner, 9.11.2026; app/legal.js, LEGAL_VERSION 3): the agreement's six
// clauses, word for word as the old document the owner sent (the PDF "הצעת מחיר נירו לוי – ALL IN
// ONE"), and the same six titles as the old signing page (app/legacy-contract-full.js). Only the
// numbers are ours. A sent or signed agreement keeps its stored text (quotes.model.legal), so
// nothing here re-draws it (tests/quote-doc-wording.test.mjs).
test('the agreement is the old system\'s six clauses, word for word', async () => {
  const { LEGAL_VERSION } = await import('../app/legal.js');
  const { defaultTerms } = await import('../app/legacy-contract-full.js');
  assert.equal(LEGAL_VERSION, 3);
  const a = buildQuoteModel({ ...sel('social', 'niro'), docType: 'agreement' }, { name: 'x' });
  assert.equal(a.legalVersion, 3);
  const old = defaultTerms({}, 12).filter((p) => p.type === 'h4').map((p) => p.text.replace(/^\d+\.\s*/, ''));
  assert.deepEqual(a.legal.map((s) => s.title), old);
  assert.deepEqual(a.legal.map((s) => s.items), [
    ['ההתקשרות הינה לתקופה קצובה של 12 חודשים מיום החתימה על הצעת המחיר/ההסכם (להלן: "תקופת ההתקשרות").',
      'אין אפשרות לסיים את ההתקשרות לפני תום 12 החודשים, מכל סיבה שהיא, וזאת מאחר שהלקוח מקבל את כלל התוצרים עד 30 ימי עסקים מיום הצילום, בכפוף לאמור בסעיף 3 להלן.'],
    ['התמורה עבור החבילה הינה 3,900 ₪ לחודש + מע״מ כחוק, למשך 12 חודשים.',
      'התשלום יתבצע באמצעות מערכת פיימנט בלבד, בחיוב חודשי שוטף, ללא תפיסת מסגרת.',
      'הלקוח מתחייב בזאת לתשלום מלוא 12 התשלומים החודשיים, גם אם יבחר להפסיק את פעילותו העסקית או את השימוש בתוצרים בטרם עת. אי עמידה באחד התשלומים תעמיד את מלוא יתרת החוב לפירעון מיידי.'],
    ['הלקוח מתחייב לספק לאסטרטג את כל המידע, התכנים, הלוגואים, ההנחיות והחומרים הנדרשים לצורך ההפקה, תוך 14 ימי עסקים מיום חתימת ההסכם.',
      'איחור מצד הלקוח במסירת התכנים עלול לגרום לעיכוב בהפקת התוצרים; במקרה כזה, המועד של 30 ימי עסקים לתחילת העלאת התוצרים לא יחייב את אסטרטג, והעיכוב לא ייחשב כהפרה מצד אסטרטג.',
      'אסטרטג מתחייבת להתחיל עלייה של סרטונים לרשתות החברתיות עד 30 ימי עסקים מיום הצילום, בכפוף לעמידת הלקוח בחובותיו לפי סעיף 3.1.'],
    ['לכל תוצר כלול סבב תיקון אחד.',
      'כל תיקון נוסף (מעבר לסבב האחד) יוגדר כעבודה נוספת בתשלום, על פי הצעת מחיר שתימסר ללקוח מראש.',
      'אי מתן מענה/אישור מסודר מצד הלקוח בתוך זמן סביר (עד 7 ימי עסקים מקבלת התוצרים) ייחשב כאישור התוצר, ואסטרטג תהיה רשאית להמשיך הלאה בתהליך ההפקה.'],
    ['אסטרטג אחראית על הפקת התוצרים לפי ההסכמה המקצועית בין הצדדים, אך אינה מתחייבת לכמות לידים, מכירות, פניות, צפיות, חשיפות או כל תוצאה עסקית/כספית אחרת.',
      'הלקוח מודע לכך שתוצאות פרסום מושפעות מפרמטרים רבים שאינם בשליטת אסטרטג (שוק, תחרות, תקציב מדיה, אלגוריתמים של פלטפורמות וכו׳).'],
    ['כל שינוי או תוספת להסכם זה יהיה בתוקף רק אם נעשה בכתב ונחתם על ידי שני הצדדים.',
      'הדין החל על ההתקשרות הוא הדין הישראלי בלבד.'],
  ]);
  // The old signing page's own words, where they are the same as the PDF's.
  const oldText = defaultTerms({ retainer: 3900 }, 12).filter((p) => p.type === 'p').flatMap((p) => p.lines.map((l) => l.replace(/^\d+\.\d+\s*/, '')));
  for (const same of [0, 4, 5, 8, 9, 10, 11, 12, 13, 14]) assert.ok(a.legal.flatMap((s) => s.items).includes(oldText[same]), oldText[same]);
  // The words around it, in the old document's order.
  assert.deepEqual(Object.keys(a.wording), ['intro', 'package', 'why', 'details', 'agreementTitle', 'closing']);
  assert.equal(a.wording.agreementTitle, 'הסכם התקשרות ותנאים');
  assert.equal(a.wording.intro.strengths.length, 4);
  assert.deepEqual(a.wording.details.groups.map((g) => g.title), ['עלות החבילה:', 'תקופת ההתקשרות:', 'תיקונים:']);
  assert.equal(a.wording.details.groups[1].items[0], 'התחייבות ל-12 חודשים (קמפיין שנתי)');
  // A price offer has neither.
  const q = buildQuoteModel(sel('social', 'natali'), { name: 'x' });
  assert.deepEqual([q.legal, q.legalVersion, q.wording], [null, null, undefined]);
});
