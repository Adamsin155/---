// The whole document of the old system, word for word (the owner, 28.10.2026:
// app/legacy-contract-full.js, a copy of the old signing page's text around the record).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fullDoc, defaultTerms, docView, titleOf, ils } from '../app/legacy-contract-full.js';

// All the words of a model, as one text (bold pieces joined in).
const flat = (t) => (Array.isArray(t) ? t.map((x) => (x && typeof x === 'object' ? x.b : x)).join('') : String(t ?? ''));
const textOf = (model) => model.sections.flatMap((s) => [s.title ? flat(s.title) : '', ...s.parts.flatMap((p) => [
  p.text !== undefined ? flat(p.text) : '', ...(p.lines || []).map(flat), ...(p.items || []).map((i) => (i.text !== undefined ? flat(i.text) : `${i.n ?? ''} ${i.l ?? ''}${i.name ?? ''}`)),
  ...(p.rows || []).flatMap((r) => r.cells), ...(p.head || []),
])]).join('\n');

const SIGNED = {
  id: 631, status: 'נחתם', clientName: 'מיוזיקול', business: 'מיוזיקול הגברה ותאורה', packageName: 'Social all in one',
  influencers: 'נטלי דדון', months: 12, shootDays: 1, contentTotal: 90, reels: 54, graphics: 36, retainer: 3900, totalAmount: 55224,
  paymentMethod: 'הוראת קבע', atBusiness: true, notes: 'ללא הערות\nשורה שנייה',
};

test('a signed contract: every part of the old page, in its order, with the record\'s numbers', () => {
  const m = fullDoc(SIGNED);
  assert.equal(m.kind, 'contract');
  assert.equal(m.title, 'הסכם התקשרות');
  assert.deepEqual(m.sections.map((s) => flat(s.title)), ['מי אנחנו - אסטרטג+', 'מה כוללת החבילה', 'פירוט החבילה', 'פירוט מחיר', 'דגשים', 'הסכם התקשרות ותנאים']);
  const t = textOf(m);
  assert.match(t, /אסטרטג היא חברת פרסום ושיווק דיגיטלי/);
  assert.match(t, /יום צילום מקצועי ומרוכז בבית העסק עם נטלי דדון/);
  assert.match(t, /ביום הצילום יופקו 90 תכנים חדשים בהשתתפות נטלי דדון/);
  assert.match(t, /מתוכם 54 סרטוני רילס מקוריים וטרנדיים לרשתות החברתיות/);
  assert.match(t, /מתוכם 36 גרפיקות בהתאמה אישית עם עיצוב מקצועי וממיר/);
  assert.match(t, /כתיבת תוכן וקריאייטיב לכלל הסרטונים/);
  assert.match(t, /ניהול פרסום ממומן של בית העסק ברשתות החברתיות/);
  // The six clauses, with the record's months, sum and payment method.
  for (const h of ['1. תקופת ההסכם', '2. התמורה ותנאי תשלום', '3. לוחות זמנים ותכני הלקוח', '4. תיקונים ואישורים', '5. אחריות ותוצאות פרסומיות', '6. שונות']) assert.ok(t.includes(h), h);
  assert.ok(t.includes(`2.1 התמורה עבור החבילה הינה ${ils(3900)} לחודש + מע״מ כחוק, למשך 12 חודשים.`));
  assert.ok(t.includes('2.2 התשלום יתבצע באמצעות הוראת קבע, ללא תפיסת מסגרת.'));
  assert.ok(t.includes('6.2 הדין החל על ההתקשרות הוא הדין הישראלי בלבד.'));
  // The notes, with their line breaks.
  const terms = m.sections.at(-1).parts;
  assert.deepEqual(terms.slice(-2), [{ type: 'h4', text: 'הערות נוספות' }, { type: 'p', lines: ['ללא הערות', 'שורה שנייה'] }]);
  // The price table of a record with no price list: the package, VAT and the year.
  const table = m.sections.find((s) => s.title === 'פירוט מחיר').parts[0];
  assert.deepEqual(table.head, ['פריט', 'לחודש', 'ל-12 חודשים']);
  assert.deepEqual(table.rows.map((r) => r.cells[0]), ['חבילה · Social all in one', 'סה״כ לפני מע״מ', 'מע״מ 18%', 'סה״כ כולל מע״מ']);
  assert.deepEqual(table.rows.at(-1).cells, ['סה״כ כולל מע״מ', ils(4602), ils(4602 * 12)]);
});

test('the record\'s own words win: package lines, custom clauses, details, a podcast and a price offer', () => {
  const m = fullDoc({ ...SIGNED, docType: 'quote', contractType: 'podcast', atBusiness: false, packageBullets: ['שורה אחת', 'שורה שתיים'],
    customClauses: [{ title: 'סעיף מיוחד', body: 'א\nב' }, 'סעיף בלי כותרת'], detailBullets: ['דגש'], extraBullets: ['בונוס'] });
  assert.equal(m.title, 'הצעת מחיר');
  const t = textOf(m);
  assert.match(t, /שורה אחת\nשורה שתיים\nבונוס/);
  assert.doesNotMatch(t, /יום צילום מקצועי/);
  assert.match(t, /חדר פודקאסט מקצועי/);
  assert.match(t, /ניהול קידום ממומן בגוגל/);
  assert.equal(m.sections.at(-1).title, 'תנאי ההצעה');
  assert.doesNotMatch(t, /1\. תקופת ההסכם/);
  assert.match(t, /סעיף מיוחד\n+א\nב/);
  assert.match(t, /סעיף בלי כותרת/);
  assert.ok(m.sections.find((s) => s.title === 'פירוט החבילה').parts[0].items.some((x) => x.l === 'חודשי התקשרות'));
  const star = m.sections[1].parts[1].items.find((i) => i.star);
  assert.equal(star.text, 'בונוס');
});

test('a document from the old price list: its add-ons, free gifts, discount and one-time lines', () => {
  const v = docView({ ...SIGNED, catalog: { tier: 'social', influencer: 'natali', paid: { 'natali-story': 2 }, free: { graphics: 6, simeonJoin: true }, discount: 200,
    lines: [{ name: 'אתר', price: 3000, kind: 'once' }] } });
  assert.deepEqual(v.paidAddons.map((a) => [a.name, a.price]), [['סטורי אצל נטלי דדון × 2', 600]]);
  assert.deepEqual(v.freeAddons.map((a) => a.name), ['גרפיקות נוספות · 6 גרפיקות', 'צירוף סמיון ליום הצילום עם נטלי']);
  assert.deepEqual(v.priceRows.map((r) => [r.label, r.month]), [['חבילה · Social all in one', 3900], ['סטורי אצל נטלי דדון × 2', 600], ['הנחה', -200]]);
  assert.equal(v.priceTotals.net, 4300);
  assert.deepEqual(v.onceTotals, { net: 3000, vat: 540, gross: 3540, vatPct: 18 });
  assert.ok(v.specs.some((s) => s.l === 'צלמים לווידאו וסטילס בבית העסק'));
});

test('a one-time payment changes clause 2; a termination is its own document', () => {
  const once = defaultTerms({ oneTimeNet: 20000, totalAmount: 23600 }, 12).map((p) => (p.lines || []).map(flat).join('\n')).join('\n');
  assert.match(once, /2\.1 התמורה עבור החבילה, לכל 12 חודשי ההתקשרות, הינה ₪20,000 \+ מע״מ כחוק \(₪23,600 כולל מע״מ\)\./);
  assert.match(once, /2\.2 התמורה תשולם בתשלום חד פעמי, עם חתימת ההסכם\./);
  const term = fullDoc({ docType: 'termination', clientName: 'לקוח', business: 'עסק', termination: { recitals: ['הואיל'], rows: [{ label: 'יתרה', value: '₪100', total: true }] },
    customClauses: [{ title: 'סיום', body: 'נוסח' }] });
  assert.equal(term.kind, 'termination');
  assert.equal(term.title, 'הסכם סיום התקשרות');
  const t = textOf(term);
  assert.match(t, /בין: אסטרטג טכנולוגיות בע״מ/);
  assert.match(t, /לבין: לקוח, עסק/);
  assert.match(t, /לפיכך הוסכם והותנה בין הצדדים כדלקמן:/);
  assert.match(t, /יתרה\n₪100/);
  assert.match(t, /סיום\n+נוסח/);
  assert.equal(titleOf({ docType: 'addendum' }), 'נספח להסכם');
  assert.equal(fullDoc(null), null);
});
