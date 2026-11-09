// The agreement in the old system's words (the owner, 9.11.2026; app/legal.js, LEGAL_VERSION 3) and
// the documents already sent or signed: app/quote-doc.js draws a document from its stored model
// (quotes.model, the same bytes the document's fingerprint covers), never from the wording in the
// code. A model with `wording` (version 3) is drawn in the old document's order; a model without
// it (versions 1 and 2, every agreement sent or signed before this change) is drawn exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A small stand-in for the browser's document: enough for h() in app/quote-doc.js.
class Node {
  constructor(tag) { this.tag = tag; this.kids = []; this.attrs = {}; this.className = ''; }
  set textContent(v) { this.kids = [new Text(String(v))]; }
  get textContent() { return this.kids.map((k) => k.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener() {}
  append(...c) { this.kids.push(...c); }
}
class Text extends Node { constructor(t) { super('#text'); this.t = t; } get textContent() { return this.t; } }
globalThis.Node = Node;
globalThis.document = { createElement: (t) => new Node(t), createTextNode: (t) => new Text(t) };

const { renderQuoteDoc } = await import('../app/quote-doc.js');
const { buildQuoteModel, emptySelection } = await import('../app/pricing.js');

const all = (n, pred, out = []) => { if (pred(n)) out.push(n); for (const k of n.kids || []) all(k, pred, out); return out; };
const heads = (doc) => all(doc, (n) => n.tag === 'h2').map((n) => n.textContent);
const agreement = (tier, influencer, paid = []) => buildQuoteModel({ ...emptySelection(), docType: 'agreement', tier, influencer, paid }, { name: 'לקוח', companyId: '514729938' });
// A signed agreement as it is stored: its model, frozen as JSON (quotes.model).
const stored = (m) => JSON.parse(JSON.stringify(m));

test('a new agreement: the old document\'s order and words, with our numbers', () => {
  const m = agreement('social', 'niro');
  const doc = renderQuoteDoc(m, { number: 'Q-1', signOnline: true });
  assert.deepEqual(heads(doc), ['מי אנחנו', 'מה כוללת חבילת Social all in one', 'למה לבחור בנו', 'פירוט החבילה', 'פירוט מחיר', 'הסכם התקשרות ותנאים', 'חתימות הצדדים']);
  const text = doc.textContent;
  for (const words of [
    'אסטרטג היא חברת פרסום ושיווק דיגיטלי', 'החוזקות שלנו:', 'יום צילום מקצועי ומרוכז עם נירו לוי',
    'ביום הצילום יופקו 72 תכנים חדשים שנירו לוי ישתתף בהם', 'צוות הפקה וקריאייטיב:', 'ניהול סושיאל מדיה:',
    'התחייבות ל-12 חודשים (קמפיין שנתי)', 'אין אפשרות לסיים את ההתקשרות לפני תום 12 החודשים',
    'יחד, נהפוך את החברה להצלחה!',
  ]) assert.ok(text.includes(words), words);
  // The old six clauses, numbered as the old document numbered them, then the platforms chapter
  // and "הוראות נוספות" (the protections the owner put back on 9.11.2026).
  const clauses = all(doc, (n) => n.className === 'qd-clauses')[0];
  assert.equal(clauses.kids.length, 8);
  assert.ok(text.includes('2.2התשלום יתבצע באמצעות מערכת פיימנט בלבד'));
  assert.ok(text.includes('7.4חסימת פלטפורמות: אסטרטג אינה אחראית לחסימה'));
  assert.ok(text.includes('8.הוראות נוספות'));
  // Our longer wording is gone from a new agreement: no early exit, no 18 chapters.
  for (const gone of ['תנאי ההסכם', 'הגבלת אחריות', 'סודיות ואי־שידול', 'סיום ההתקשרות לפני תום התקופה', '50%']) assert.ok(!text.includes(gone), gone);
});

test('a signed agreement keeps the text it was signed with, whatever the code says now', () => {
  // Version 2 (signed before 9.11.2026): its stored clauses, under "תנאי ההסכם", in the old layout.
  const v2 = stored(agreement('social-tv', 'natali', ['photographer']));
  delete v2.wording;
  v2.legalVersion = 2;
  v2.legal = [
    { title: 'הצדדים, הגדרות ומסמכי ההסכם', items: ['הסכם זה נערך בין אסטרטג טכנולוגיות בע״מ לבין הלקוח.'] },
    { title: 'פלטפורמות וחסימת חשבונות', items: ['חסימת פלטפורמות: אסטרטג אינה אחראית לחסימה.'] },
  ];
  const sig = { name: 'לקוח', signedAt: '2026-11-01T10:00:00Z', png: 'data:image/png;base64,iVBORw0KGgo=', hash: 'b'.repeat(64), consent: 'קראתי ואני מסכים' };
  const doc2 = renderQuoteDoc(v2, { number: 'Q-2', docHash: 'a'.repeat(64), signature: sig });
  assert.deepEqual(heads(doc2), ['החבילה', 'תוספות בתשלום', 'פירוט מחיר', 'הערות', 'תנאי ההסכם', 'חתימות הצדדים'].filter((h) => h !== 'הערות' || v2.client.notes));
  const t2 = doc2.textContent;
  assert.ok(t2.includes('1.1הסכם זה נערך בין אסטרטג טכנולוגיות בע״מ לבין הלקוח.'));
  assert.ok(t2.includes('2.1חסימת פלטפורמות: אסטרטג אינה אחראית לחסימה.'));
  for (const v3 of ['מי אנחנו', 'הסכם התקשרות ותנאים', 'מערכת פיימנט', 'למה לבחור בנו']) assert.ok(!t2.includes(v3), v3);
  assert.ok(t2.includes(`DOC ${'a'.repeat(12)}`) && t2.includes(`SIG ${'b'.repeat(12)}`));

  // Version 3: drawn from its own stored words too, never re-made from app/legal.js.
  const v3 = stored(agreement('social', 'niro'));
  v3.legal[0].items[0] = 'הנוסח שנחתם.';
  v3.wording.intro.text = 'המילים שנחתמו.';
  const t3 = renderQuoteDoc(v3, { signature: sig }).textContent;
  assert.ok(t3.includes('1.1הנוסח שנחתם.') && t3.includes('המילים שנחתמו.'));
  assert.ok(!t3.includes('ההתקשרות הינה לתקופה קצובה'));
});

test('a price offer is drawn as before (it has no agreement and no words of the old document)', () => {
  const q = buildQuoteModel({ ...emptySelection(), tier: 'social', influencer: 'natali' }, { name: 'לקוח' });
  assert.equal(q.wording, undefined);
  const doc = renderQuoteDoc(q, {});
  assert.deepEqual(heads(doc), ['החבילה', 'פירוט מחיר']);
  assert.ok(!doc.textContent.includes('מי אנחנו'));
});
