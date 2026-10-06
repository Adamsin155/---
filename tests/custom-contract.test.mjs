// Custom (exceptional) contracts in the engine (the owner's decisions of 6.10.2026;
// app/catalog.js, app/pricing.js, app/legal.js): what `selection.custom` may carry,
// the totals the engine computes from it, the list of deviations (exceptionOf), the
// agreement text, and above all that a regular selection produces exactly the bytes
// it produced before custom contracts existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACKAGES, SPECS, CUSTOM_QTY, INCLUDES_KEYS, CUSTOM_LIMITS, MAX_DISCOUNT } from '../app/catalog.js';
import {
  emptySelection, computeTotals, validateSelection, buildQuoteModel, exceptionOf, isExceptional,
  normalizeSelection, baseQuantities, effectiveQuantities, termOf,
} from '../app/pricing.js';
import { packageDeliverables } from '../app/protocol-logic.js';
import { regularFingerprint, regularSelections } from './regular-models.mjs';

const sel = (tier, influencer, paid = [], custom = undefined, extra = {}) => ({
  ...emptySelection(), docType: 'agreement', tier, influencer, paid, ...extra, ...(custom === undefined ? {} : { custom }),
});
const texts = (s) => exceptionOf(s).map((e) => e.text);
const legalText = (m) => m.legal.map((s) => `${s.title} ${s.items.join(' ')}`).join(' ');

test('regular selections are untouched: the same bytes as before custom contracts existed', () => {
  // Taken from the engine as it was on 6.10.2026 (commit 4baede1), before this feature.
  assert.deepEqual(regularFingerprint(), { count: 612, sha256: 'c050c8791427f54f3c18ffc422aa520b47a35ee4478271eca242776735c56ed6' });
  for (const s of regularSelections()) {
    assert.deepEqual(exceptionOf(s), []);
    assert.equal(normalizeSelection(s), s);
    const m = buildQuoteModel(s, { name: 'x' });
    assert.equal(m.selection, s);
    for (const k of ['custom', 'extraLines', 'specialTerms']) assert.ok(!(k in m), k);
    if (m.legal) assert.ok(!m.legal.some((x) => x.title === 'תנאים מיוחדים'));
  }
});

test('a custom contract that changes nothing is a regular contract, byte for byte', () => {
  const base = sel('social', 'simeon', ['photographer'], undefined, { discount: 10000 });
  const same = {
    ...base, discount: 0,
    custom: { qty: { ...baseQuantities(base) }, price: PACKAGES['social-simeon'].price, discount: 10000, termMonths: 12, lines: [], terms: '  \n ' },
  };
  validateSelection(same);
  assert.deepEqual(exceptionOf(same), []);
  assert.equal(isExceptional(same), false);
  assert.deepEqual(normalizeSelection(same), base);
  assert.equal(JSON.stringify(buildQuoteModel(same, { name: 'דנה' })), JSON.stringify(buildQuoteModel(base, { name: 'דנה' })));
  assert.deepEqual(computeTotals(same), computeTotals(base));
});

test('the deviations, as data and as Hebrew sentences', () => {
  const s = sel('podcast', 'natali', [], {
    qty: { videos: 25, graphics: 20, collabs: 2 }, price: 430000, discount: 35000, termMonths: 6,
    lines: [{ label: 'אתר תדמית', qty: 1, monthly: 50000 }, { label: 'ליווי אישי' }], terms: 'הלקוח רשאי לסיים אחרי 3 חודשים.',
  });
  validateSelection(s);
  assert.deepEqual(texts(s), [
    '25 סרטונים במקום 20',
    '2 קולאבים באינסטגרם במקום 0',
    'מחיר חודשי 4,300 ₪ במקום 3,500 ₪',
    'הנחה חודשית 350 ₪ (המותר בלי אישור: 200 ₪)',
    'תקופה 6 חודשים במקום 12',
    'שורה נוספת: אתר תדמית × 1 · 500 ₪ לחודש',
    'שורה נוספת: ליווי אישי',
    'תנאים מיוחדים',
  ]);
  const e = exceptionOf(s);
  assert.deepEqual(e[0], { kind: 'qty', key: 'videos', from: 20, to: 25, text: '25 סרטונים במקום 20' });
  assert.deepEqual(e.find((x) => x.kind === 'discount'), { kind: 'discount', from: MAX_DISCOUNT, to: 35000, text: 'הנחה חודשית 350 ₪ (המותר בלי אישור: 200 ₪)' });
  assert.equal(isExceptional(s), true);
  // Each kind alone is a deviation; the graphics equal the package, so they are not.
  assert.deepEqual(texts(sel('social', 'simeon', [], { termMonths: 1 })), ['תקופה חודש אחד במקום 12']);
  assert.deepEqual(texts(sel('social', 'simeon', [], { qty: { graphics: 35 } })), []);
  assert.deepEqual(texts(sel('social', 'simeon', ['photographer'], { qty: { monthly: 10 } })), ['10 תכנים בחודש מהצלם החודשי במקום 8']);
  // A discount of up to 200 ₪ typed in the custom fields is a regular discount.
  const small = sel('social', 'simeon', [], { discount: 20000 });
  assert.deepEqual(texts(small), []);
  assert.equal(normalizeSelection(small).discount, 20000);
  assert.deepEqual(texts(sel('social', 'simeon', [], { discount: 20100 })), ['הנחה חודשית 201 ₪ (המותר בלי אישור: 200 ₪)']);
});

test('totals with overrides: the price, the lines, the discount, VAT and the term are computed here', () => {
  const s = sel('social', 'simeon', ['simeon-day'], {
    price: 430000, discount: 35000, termMonths: 6, lines: [{ label: 'אתר', monthly: 50000 }, { label: 'בלי מחיר', qty: 3 }],
  });
  validateSelection(s);
  const t = computeTotals(s);
  // 4,300 + 500 (the extra day) + 500 (the line) = 5,300; minus 350 = 4,950; VAT 18% = 891.
  assert.deepEqual(t, {
    monthlyList: 530000, discount: 35000, monthlyNet: 495000, monthlyVat: 89100, monthlyGross: 584100,
    termNet: 495000 * 6, termVat: 89100 * 6, termGross: 584100 * 6,
  });
  assert.equal(termOf(s), 6);
  const m = buildQuoteModel(s, { name: 'x' });
  assert.deepEqual(m.totals, t);
  assert.equal(m.termMonths, 6);
  assert.deepEqual([m.package.monthly, m.package.term], [430000, 430000 * 6]);
  assert.equal(m.paid[0].term, 50000 * 6);
  assert.deepEqual(m.extraLines, [{ label: 'אתר', qty: null, monthly: 50000 }, { label: 'בלי מחיר', qty: 3, monthly: null }]);
  assert.equal(m.custom, true);
  // An odd price: VAT rounds to the agora, per month, and the term multiplies the rounded month.
  const odd = computeTotals(sel('social', 'simeon', [], { price: 333333 }));
  assert.deepEqual([odd.monthlyVat, odd.monthlyGross, odd.termGross], [60000, 393333, 393333 * 12]);
  // Numbers the browser sends beside the selection are simply not read.
  const lied = computeTotals({ ...s, totals: { monthlyGross: 1 }, monthlyNet: 1 });
  assert.deepEqual(lied, t);
});

test('validation stays strict: types, ranges, integers, agorot, the add-on a quantity needs', () => {
  const ok = (c, paid = []) => validateSelection(sel('social', 'simeon', paid, c));
  const bad = (c, re, paid = []) => assert.throws(() => ok(c, paid), re, JSON.stringify(c));
  ok({});
  ok({ qty: { videos: 0, graphics: 300, shootDays: 12, photoDays: 0, collabs: 24, stories: 60, ch14: 12 } });
  ok({ qty: { monthly: 60 } }, ['photographer']);
  ok({ price: 0, termMonths: 36, discount: 0, lines: [], terms: '' });
  ok({ lines: Array.from({ length: 10 }, (_, i) => ({ label: `שורה ${i + 1}`, qty: 999, monthly: 5000000 })) });
  ok({ terms: 'א'.repeat(2000) });
  bad('x', /custom must be an object/);
  bad([], /custom must be an object/);
  bad({ totals: {} }, /unknown custom field/);
  bad({ qty: { reels: 3 } }, /unknown custom quantity/);
  for (const v of [-1, 301, 1.5, '20', NaN]) bad({ qty: { videos: v } }, /custom quantity out of range: videos/);
  bad({ qty: { shootDays: 13 } }, /out of range: shootDays/);
  bad({ qty: { monthly: 10 } }, /needs its add-on/);
  bad({ qty: { monthly: 0 } }, /out of range: monthly/, ['photographer']);
  for (const v of [-100, 10000001, 1.5, '4300']) bad({ price: v }, /custom price/);
  for (const v of [0, 37, 6.5, '6']) bad({ termMonths: v }, /custom term/);
  for (const v of [-100, 150, 1.5, '300']) bad({ discount: v }, /custom discount/);
  // Never more than the price it is taken from (3,900 here).
  bad({ discount: 400000 }, /more than the monthly price/);
  ok({ discount: 390000 });
  bad({ lines: Array.from({ length: 11 }, () => ({ label: 'x' })) }, /too many custom lines/);
  bad({ lines: [{ label: ' ' }] }, /label length/);
  bad({ lines: [{ label: 'א'.repeat(121) }] }, /label length/);
  bad({ lines: [{ qty: 2 }] }, /malformed/);
  bad({ lines: [{ label: 'x', qty: 0 }] }, /quantity out of range/);
  bad({ lines: [{ label: 'x', qty: 1000 }] }, /quantity out of range/);
  bad({ lines: [{ label: 'x', monthly: -5 }] }, /price out of range/);
  bad({ lines: [{ label: 'x', monthly: 5000001 }] }, /price out of range/);
  bad({ lines: [{ label: 'x', total: 5 }] }, /unknown field/);
  bad({ terms: 'א'.repeat(2001) }, /terms too long/);
  bad({ terms: 5 }, /terms too long/);
  // The regular discount rule is as it was: more than 200 ₪ only through `custom`.
  assert.throws(() => validateSelection({ ...sel('social', 'simeon'), discount: 20100 }), /discount out of range/);
});

test('the catalog: every package line that can be changed is known by its position', () => {
  for (const [id, pkg] of Object.entries(PACKAGES)) {
    const keys = INCLUDES_KEYS[id];
    assert.equal(keys.length, pkg.includes.length, id);
    const s = { tier: pkg.tier, influencer: pkg.influencer, paid: [] };
    const base = baseQuantities(s);
    for (const [i, inc] of pkg.includes.entries()) {
      if (!keys[i]) continue;
      const q = CUSTOM_QTY.find((x) => x.key === keys[i]);
      assert.equal(inc.qty, base[q.key], `${id} ${q.key}`);
      // The generated line reads like the catalog's own.
      assert.equal(q.label(inc.qty, s), inc.label, `${id} ${q.key}`);
    }
    // Every quantity the package grants has its line.
    for (const q of CUSTOM_QTY) if (q.label && base[q.key] > 0) assert.ok(keys.includes(q.key), `${id} ${q.key}`);
    for (const k of ['videos', 'graphics', 'shootDays', 'collabs', 'stories', 'ch14']) assert.equal(base[k], SPECS[id][k]);
  }
  assert.deepEqual(CUSTOM_LIMITS, { termMin: 1, termMax: 36, priceMax: 10000000, lines: 10, lineLabel: 120, lineQtyMax: 999, linePriceMax: 5000000, terms: 2000 });
});

test('the document: quantities, added lines and the term come from the customised values', () => {
  const s = sel('social-tv', 'simeon', ['photographer'], {
    qty: { videos: 50, shootDays: 1, collabs: 0, stories: 5, photoDays: 2, monthly: 10 },
    termMonths: 18, lines: [{ label: 'אתר תדמית', qty: 1 }, { label: 'ניהול קהילה' }],
  });
  validateSelection(s);
  const m = buildQuoteModel(s, { name: 'x' });
  assert.deepEqual(m.package.includes, [
    { qty: 1, label: 'יום צילום בבית העסק עם סמיון, מישל ודניס' },
    { qty: null, label: 'ניהול רשתות חברתיות' },
    { qty: null, label: 'ניהול קמפיינים ממומנים ברשתות' },
    { qty: 50, label: 'סרטונים בבית העסק' },
    { qty: 42, label: 'גרפיקות' },
    { qty: 2, label: 'צלמים לווידאו וסטילס בבית העסק' },
    { qty: 5, label: 'סטורי אצל סמיון, מישל ודניס' },
    { qty: 1, label: 'אייטם בערוץ 14' },
    { qty: 2, label: 'ימי צילום עם צלם בבית העסק, וידאו וסטילס' },
    { qty: 1, label: 'אתר תדמית' },
    { qty: null, label: 'ניהול קהילה' },
  ]);
  assert.match(m.terms, /בהתחייבות ל־18 חודשים\. הכמויות בחבילה ובתוספות הן לכל תקופת ההתקשרות, למעט שירות הצלם החודשי שמספק 10 תכנים בכל חודש\./);
  assert.match(m.paid[0].detail, /מייצר 10 תכנים בכל חודש/);
  const text = legalText(m);
  assert.match(text, /לתקופה קצובה של 18 חודשים/);
  assert.match(text, /למשך 18 חודשים \(סה״כ 124,200 ₪ \+ מע״מ\)/); // (4,900 + 2,000) × 18
  assert.match(text, /מלוא 18 התשלומים החודשיים/);
  assert.match(text, /המספק 10 תכנים בכל חודש/);
  assert.match(text, /וכן הפריטים שנוספו לחבילה: אתר תדמית \(1\); ניהול קהילה/);
  // One shoot day now: the plural wording is gone.
  assert.doesNotMatch(text, /כלולים \d+ ימי צילום/);
  // Channel 14 removed by hand: its chapter is gone; added by hand: it is there.
  const titles = (c) => buildQuoteModel(sel('social-tv', 'natali', [], c), { name: 'x' }).legal.map((x) => x.title);
  assert.ok(titles(undefined).includes('אייטם בערוץ 14'));
  assert.ok(!titles({ qty: { ch14: 0 } }).includes('אייטם בערוץ 14'));
  const added = buildQuoteModel(sel('social', 'natali', [], { qty: { ch14: 1, collabs: 2 } }), { name: 'x' });
  assert.ok(added.legal.some((x) => x.title === 'אייטם בערוץ 14'));
  assert.match(legalText(added), /פרסומים בחשבונות המשפיענים/);
  assert.deepEqual(added.package.includes.slice(-2), [{ qty: 2, label: 'קולאבים באינסטגרם אצל נטלי דדון' }, { qty: 1, label: 'אייטם בערוץ 14' }]);
});

test('special terms: their own last chapter, prevailing only as far as they say; the standard chapters do not move', () => {
  const plain = buildQuoteModel(sel('social-tv', 'natali', ['photographer']), { name: 'x' });
  const s = sel('social-tv', 'natali', ['photographer'], { terms: '  הלקוח רשאי לסיים את ההסכם אחרי 3 חודשים, בהודעה של 30 ימים.\n\n\nיום הצילום יתקיים בסניף חיפה.  ' });
  const m = buildQuoteModel(s, { name: 'x' });
  assert.equal(m.specialTerms, 'הלקוח רשאי לסיים את ההסכם אחרי 3 חודשים, בהודעה של 30 ימים.\n\nיום הצילום יתקיים בסניף חיפה.');
  const last = m.legal.at(-1);
  assert.equal(last.title, 'תנאים מיוחדים');
  assert.equal(last.items.length, 3);
  assert.match(last.items[0], /יגבר התנאי המיוחד, אך ורק במידה שנקבעה בו במפורש/);
  assert.match(last.items[0], /יתר הוראות ההסכם יעמדו בתוקפן/);
  assert.deepEqual(last.items.slice(1), ['הלקוח רשאי לסיים את ההסכם אחרי 3 חודשים, בהודעה של 30 ימים.', 'יום הצילום יתקיים בסניף חיפה.']);
  // Every standard chapter is word for word the regular agreement's, in the same place.
  assert.deepEqual(m.legal.slice(0, -1), plain.legal);
  // A view-only quote carries the text too (no legal chapters there).
  const q = buildQuoteModel({ ...s, docType: 'quote' }, { name: 'x' });
  assert.equal(q.legal, null);
  assert.match(q.specialTerms, /סניף חיפה/);
  // Direction marks never reach the text or a line's label.
  const dirty = buildQuoteModel(sel('social', 'simeon', [], { terms: '‮תנאי‬', lines: [{ label: 'a⁦b' }] }), { name: 'x' });
  assert.equal(dirty.specialTerms, 'תנאי');
  assert.equal(dirty.extraLines[0].label, 'ab');
});

test('what the signed contract grants follows the customised quantities (the client card, scripts, Gantt)', () => {
  const s = sel('social-tv', 'simeon', ['simeon-day', 'photographer'], {
    qty: { videos: 50, graphics: 10, shootDays: 1, collabs: 0, stories: 5, ch14: 2, photoDays: 2, monthly: 10 }, termMonths: 6,
    lines: [{ label: 'אתר תדמית', qty: 1, monthly: 50000 }, { label: 'ניהול קהילה' }],
  });
  s.free = { ...s.free, graphics: 4, simeonStories: 1, extraCh14: true };
  validateSelection(s);
  const m = buildQuoteModel(s, { name: 'x' });
  assert.deepEqual(packageDeliverables(m), {
    videos: 50, graphics: 14, shoot_days: 2, collabs: 0, stories: 6, ch14: 3, monthly: 60, photo_days: 2,
    extra: [{ label: 'אתר תדמית', qty: 1 }, { label: 'ניהול קהילה', qty: null }],
  });
  assert.deepEqual(effectiveQuantities(s), { videos: 50, graphics: 10, shootDays: 1, photoDays: 2, collabs: 0, stories: 5, ch14: 2, monthly: 10 });
  // A podcast whose photographer day was removed by hand has none.
  const p = buildQuoteModel(sel('podcast', 'natali', [], { qty: { photoDays: 0 } }), { name: 'x' });
  assert.ok(!('photo_days' in packageDeliverables(p)));
  // Regular agreements: as before.
  assert.deepEqual(packageDeliverables(buildQuoteModel(sel('podcast', 'natali', ['photographer']), { name: 'x' })),
    { videos: 20, graphics: 20, shoot_days: 0, collabs: 0, stories: 0, ch14: 0, monthly: 96, photo_days: 1 });
});
