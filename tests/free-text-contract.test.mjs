// "נוסח חופשי" (the owner, 17.11.2026; docs/ops.md, section 140): every text part of a quote or an
// agreement written by hand (selection.custom.text, app/contract-text.js), from the builder, from
// "הכנת חוזה עם AI" (free mode) and from Claude (prepare_contract_draft). Money is never typed, the
// clause of the price keeps the computed number, the client's details never go into the words, and a
// document without words of its own is byte for byte what it was.
//
// The AI part is checked with a RECORDED answer (FAKE_ANSWER below, written by hand as the model is
// asked to answer for the seller's messy text): the real model is not called here.
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
const { STAV, BASE, FAKE_CLIENT, FIVE, CL11, CL12, CL33, DETAILS, AI_TEXT, FAKE_ANSWER } = await import('./free-text-fixture.mjs');
const { buildQuoteModel, emptySelection, validateSelection, normalizeSelection, exceptionOf, regularText } = await import('../app/pricing.js');
const { textErrors, checkAiText, asRefs, TEXT_LIMITS } = await import('../app/contract-text.js');
const { validateFreeResult, applyFreeDraft, FREE_SCHEMA, freeSystemPrompt } = await import('../app/contract-ai-logic.js');
const { draftAnswer, draftOf, draftFromHash, checkDraftInput, DRAFT_SCHEMA, DRAFT_PARAM, draftDescription } = await import('../app/mcp-draft.js');
const { mayUseMcp, MCP_PEOPLE } = await import('../app/mcp-logic.js');
const { canBuildQuote } = await import('../app/manager-rules.js');
const { QUOTE_EDIT_KEYS, editsQuote } = await import('../supabase/functions/create-quote/http.js');

const all = (n, pred, out = []) => { if (pred(n)) out.push(n); for (const k of n.kids || []) all(k, pred, out); return out; };
const byClass = (doc, cls) => all(doc, (n) => String(n.className).split(' ').includes(cls));
const stored = (m) => JSON.parse(JSON.stringify(m));
const agreement = (sel, client = {}) => buildQuoteModel(sel, client);

test('no words of its own: the model is key for key the regular one (and the parts equal to it are dropped)', () => {
  for (const sel of [BASE, { ...BASE, docType: 'quote' }, STAV, { ...BASE, influencer: 'niro', paid: [] }]) {
    const plain = agreement(sel, { name: 'לקוח' });
    // All the regular words as references: nothing of its own, so nothing is stored.
    const refs = asRefs(regularText(sel, { name: 'לקוח' }));
    const same = { ...sel, custom: { ...(sel.custom || {}), text: refs } };
    validateSelection(same);
    assert.equal(normalizeSelection(same).custom?.text, undefined);
    assert.deepEqual(stored(agreement(same, { name: 'לקוח' })), stored(plain));
  }
  // A regular contract has no custom at all, so no `tiles` and no cover line of its own.
  const m = agreement(BASE);
  assert.equal('tiles' in m, false);
  assert.equal('influencer' in m.wording.cover, false);
});

test('Stav\'s deal: the recorded AI answer becomes the document the old system made', () => {
  const { result, dropped } = validateFreeResult(FAKE_ANSWER);
  const d = result.drafts[0];
  // The client's business goes to the client's fields only; the line with it is left out of the words.
  assert.equal(d.client.company, FAKE_CLIENT.company);
  assert.ok(dropped.some((x) => /פרטי הלקוח/.test(x.text)));
  assert.ok(!JSON.stringify(d.text).includes('קפה הדגמה') && !JSON.stringify(d.text).includes('500000001'));
  const applied = applyFreeDraft({ docType: 'agreement' }, d);
  const sel = applied.selection;
  assert.ok(applied.summary.some((s) => s.startsWith('נוסח שנכתב מהטקסט')));
  // What the builder sends (selectionToSend: the discount inside custom).
  const toSend = normalizeSelection({ ...sel, discount: 0, custom: { ...sel.custom, discount: 0 } });
  validateSelection(toSend);
  const m = buildQuoteModel(toSend, FAKE_CLIENT);
  // The money is the engine's: 3,900 a month, 55,224 with VAT for 12 months.
  assert.equal(m.totals.monthlyNet, 390000);
  assert.equal(m.totals.termGross, 5522400);
  assert.equal(m.termMonths, 12);
  // The cover.
  assert.equal(m.wording.cover.title, 'הסכם התקשרות');
  assert.equal(m.wording.cover.packageName, 'ALL IN ONE · מישל, דניס, סמיון והצל (יואב אליאסי)');
  assert.equal(m.wording.cover.influencer, '');
  // "מה כוללת החבילה": the lines written, then the regular team and social lines.
  const [content, team, social] = m.wording.package.groups;
  assert.equal(content.title, 'הפקת תוכן ווידאו מקיפה:');
  assert.deepEqual(content.items, [
    'יום צילום מקצועי ומרוכז בבית העסק עם מישל, דניס, סמיון והצל (יואב אליאסי)',
    '72 תכנים: 36 סרטוני רילס מקוריים וטרנדיים ו־36 גרפיקות בהתאמה אישית',
    '32 סרטונים נוספים, מעבר ל־72 התכנים שבחבילה - סך הכל 104 תכנים',
    FIVE,
  ]);
  assert.equal(team.items[0], 'כתיבת תוכן וקריאייטיב לכלל הסרטונים.');
  assert.ok(social.items.length >= 5);
  // The tiles and the דגשים.
  assert.deepEqual(m.tiles.map((t) => `${t.n} ${t.label}`), ['1 יום צילום', '68 סרטונים', '36 גרפיקות', '104 תכנים']);
  assert.equal(m.wording.details.title, 'דגשים');
  assert.deepEqual(m.wording.details.groups[0].items, DETAILS);
  // The clauses: 1.1 and 1.2 as written, the price (2.1) computed, 3.3 the five contents.
  assert.equal(m.legal[0].items[0], CL11);
  assert.equal(m.legal[0].items[1], CL12);
  assert.match(m.legal[1].items[0], /^התמורה עבור החבילה הינה 3,900 ₪ לחודש \+ מע״מ כחוק, למשך 12 חודשים\.$/);
  assert.equal(m.legal[2].items[2], CL33);
  assert.equal(m.legal.length, 7);
  // The owners see that the words were written by hand.
  assert.ok(exceptionOf(toSend).some((x) => x.kind === 'text'));
  // The document draws exactly the stored words.
  const doc = renderQuoteDoc(stored(m), { number: 'Q-1', signOnline: true });
  const text = doc.textContent;
  for (const line of [CL11, CL12, CL33, FIVE, ...DETAILS, 'ALL IN ONE · מישל, דניס, סמיון והצל (יואב אליאסי)']) assert.ok(text.includes(line), line);
  assert.equal(byClass(doc, 'qd-cover-inf').length, 0);
  assert.deepEqual(byClass(doc, 'qd-cell-n').map((n) => n.textContent), ['1', '68', '36', '104']);
  assert.deepEqual(all(doc, (n) => String(n.className).includes('qd-cl-n')).slice(0, 3).map((n) => n.textContent), ['1.1', '1.2', '1.3']);
  assert.ok(!text.includes('קפה הדגמה בע״מ ') || text.split('קפה הדגמה').length <= 3, 'the business only in the client\'s box');
});

test('the price is never typed: money in the words is refused; the clause of the price must stay', () => {
  const words = (text) => textErrors(text);
  assert.ok(words({ details: { groups: [{ title: 'עלות', items: ['3,900 ₪ לחודש'] }] } }).some((e) => /money/.test(e)));
  assert.ok(words({ clauses: [{ title: 'x', items: ['התמורה 3900 ש״ח'] }, { title: 'y', items: ['{{2.1}}'] }] }).some((e) => /money/.test(e)));
  assert.ok(words({ clauses: [{ title: 'תקופה', items: ['שנה'] }] }).some((e) => /price/.test(e)));
  assert.deepEqual(words({ clauses: [{ title: 'תקופה', items: ['שנה', '{{2.*}}'] }] }), []);
  // Through the engine (as create-quote runs it).
  assert.throws(() => validateSelection({ ...BASE, custom: { text: { tiles: [{ n: '3,900 ₪', label: 'לחודש' }] } } }), /money/);
  // From the AI: a line with money is left out, the clause of the price put back.
  const { text, notes } = checkAiText({ clauses: [{ title: 'א', items: ['שורה'] }, { title: 'ב', items: ['התמורה 4,000 ₪'] }] });
  assert.deepEqual(text.clauses[1].items, ['{{2.1}}']);
  assert.ok(notes.some((n) => /סכום/.test(n)) && notes.some((n) => /סעיף המחיר/.test(n)));
});

test('the words: no markup, no control or bidi characters, lengths and counts; unknown parts refused', () => {
  const bad = [
    { cover: { title: '<b>x</b>' } },
    { cover: { title: 'a‮b' } },
    { cover: { title: 'a\nb' } },
    { cover: { title: 'א'.repeat(TEXT_LIMITS.title + 1) } },
    { package: { groups: Array(TEXT_LIMITS.groups + 1).fill({ title: 'x', items: [] }) } },
    { package: { groups: [{ title: 'x', items: Array(TEXT_LIMITS.items + 1).fill('y') }] } },
    { clauses: [{ title: 'x', items: ['{{2.1}}', 'א'.repeat(TEXT_LIMITS.line + 1)] }] },
    { tiles: Array(TEXT_LIMITS.tiles + 1).fill({ n: '1', label: 'x' }) },
    { nope: 1 },
    { cover: { other: 'x' } },
    { package: { groups: [{ title: 'x', items: ['{{1.1}', 'a{b}'] }] } },
    'text',
  ];
  for (const t of bad) assert.ok(textErrors(t).length > 0, JSON.stringify(t).slice(0, 80));
  assert.ok(textErrors({ clauses: Array(20).fill({ title: 'כותרת', items: Array(20).fill('א'.repeat(500)) }).map((g, i) => (i === 1 ? { ...g, items: ['{{2.1}}'] } : g)) }).some((e) => /too long|too many/.test(e)));
  for (const t of bad) if (typeof t === 'object') assert.throws(() => validateSelection({ ...BASE, custom: { text: t } }));
  // A quote too: the same words, no clauses drawn (a quote has none).
  const q = buildQuoteModel({ ...BASE, docType: 'quote', custom: { text: { cover: { title: 'הצעת מחיר מיוחדת' }, clauses: [{ title: 'x', items: ['{{2.1}}'] }] } } });
  assert.equal(q.wording.cover.title, 'הצעת מחיר מיוחדת');
  assert.equal(q.legal, null);
});

test('a reference follows the contract: change the term and the regular lines say it; a line that is gone is left out', () => {
  const text = { clauses: [{ title: '{{1}}', items: ['שורה שנכתבה', '{{1.2}}', '{{1.9}}'] }, { title: '{{2}}', items: ['{{2.*}}'] }] };
  const m = buildQuoteModel({ ...BASE, custom: { termMonths: 6, text } });
  assert.deepEqual(m.legal[0].items.slice(0, 1), ['שורה שנכתבה']);
  assert.match(m.legal[0].items[1], /6 החודשים/);
  assert.equal(m.legal[0].items.length, 2);
  assert.match(m.legal[1].items[0], /למשך 6 חודשים/);
  // "תנאים מיוחדים" stays the last chapter after clauses written by hand.
  const t = buildQuoteModel({ ...BASE, custom: { terms: 'תנאי', text } });
  assert.equal(t.legal.at(-1).title, 'תנאים מיוחדים');
});

test('who: any office user may write the words (not a manager\'s field); create-quote takes them from the office', () => {
  assert.equal(QUOTE_EDIT_KEYS.includes('text'), false);
  assert.equal(editsQuote({ ...BASE, custom: { text: { cover: { title: 'x' } } } }), false);
});

test('the AI schema: the words are one union-typed parameter, under the API\'s limit; the prompt explains them', () => {
  let unions = 0; const count = (o) => { if (o && typeof o === 'object') { if (o.anyOf) unions += 1; Object.values(o).forEach(count); } }; count(FREE_SCHEMA);
  assert.ok(unions <= 16, `${unions} union-typed parameters`);
  const p = freeSystemPrompt();
  assert.match(p, /\{\{2\.1\}\}/);
  assert.match(p, /Never write the client's name/);
  assert.match(p, /clauses 1\.1 and 1\.2/);
  // The regular words, numbered, are in it.
  assert.match(p, /2\.1 התמורה עבור החבילה הינה/);
});

/* ── Claude: prepare_contract_draft ─────────── */
const FREE_DRAFT = {
  mode: 'free', docType: 'agreement', influencer: 'simeon', alsoInfluencers: ['hatzel'], monthlyPrice: 390000,
  quantities: [{ key: 'videos', value: 68 }, { key: 'graphics', value: 36 }],
  text: { subtitle: AI_TEXT.subtitle, noInfluencerLine: true, packageGroups: AI_TEXT.packageGroups.map((g, i) => (i === 0 ? { ...g, items: g.items.slice(0, 4).concat('{{1.6}}') } : g)), detailsTitle: 'דגשים', details: AI_TEXT.details, tiles: AI_TEXT.tiles, clauses: AI_TEXT.clauses },
};

test('Claude\'s draft carries the words; the link gives the builder the same; nothing is saved', () => {
  const a = draftAnswer(FREE_DRAFT);
  assert.equal(a.error, undefined, JSON.stringify(a));
  assert.equal(a.status, 'טיוטה בלבד: שום דבר לא נשמר ולא נשלח');
  assert.equal(a.monthly_before_vat_ils, 3900);
  assert.equal(a.whole_term_with_vat_ils, 55224);
  assert.ok(a.text && a.document_words.includes(CL11) && a.document_words.includes('3.3 '));
  assert.ok(a.link.length < 16000);
  const back = draftFromHash(a.link.slice(a.link.indexOf('#')));
  assert.ok(back.input);
  const d = draftOf(back.input);
  assert.equal(d.model.legal[0].items[0], CL11);
  assert.ok(d.model.wording.package.groups[0].items.at(-1).includes('קולאב'));
  // Catalog mode takes the words too.
  const c = draftOf({ package: 'social-simeon', text: { clauses: [{ title: '{{1}}', items: [CL11] }, { title: '{{2}}', items: ['{{2.*}}'] }] } });
  assert.equal(c.model.legal[0].items[0], CL11);
  assert.equal(c.model.legal[1].items.length, 3);
});

test('a draft changed by talking: the previous link and only what changes', () => {
  const first = draftAnswer(FREE_DRAFT);
  // "תוריד את השורה של הקולאב, תשנה את סעיף 1.1 ל…"
  const groups = first.text.packageGroups.map((g, i) => (i === 0 ? { ...g, items: g.items.filter((x) => x !== '{{1.6}}') } : g));
  const clauses = first.text.clauses.map((g, i) => (i === 0 ? { ...g, items: ['ההתקשרות הינה לתקופה של 12 חודשים מיום הצילום.', ...g.items.slice(1)] } : g));
  const second = draftAnswer({ previous: first.link, text: { packageGroups: groups, clauses } });
  assert.equal(second.error, undefined, JSON.stringify(second));
  assert.notEqual(second.link, first.link);
  const d = draftOf(draftFromHash(second.link.slice(second.link.indexOf('#'))).input);
  assert.equal(d.model.legal[0].items[0], 'ההתקשרות הינה לתקופה של 12 חודשים מיום הצילום.');
  assert.ok(!d.model.wording.package.groups[0].items.some((x) => x.includes('קולאב')));
  // What was not sent stays: the price, the tiles, the דגשים.
  assert.equal(second.monthly_before_vat_ils, 3900);
  assert.deepEqual(d.model.tiles.map((t) => t.n), ['1', '68', '36', '104']);
  // A field set to null goes back to the package's own; a part set to null goes back to the regular words.
  const third = draftOf({ previous: second.link, monthlyPrice: null, text: { tiles: null } });
  assert.equal(third.model.totals.monthlyNet, 390000); // the package's own price is 3,900 too
  assert.equal('tiles' in third.model, false);
  // The bare part after "#mcp-draft=" works as well; anything else is refused.
  const param = second.link.slice(second.link.indexOf(`${DRAFT_PARAM}=`) + DRAFT_PARAM.length + 1);
  assert.equal(draftAnswer({ previous: param, months: 6 }).months, 6);
  for (const bad of ['nope', 'https://example.com/#mcp-draft=@@', 12]) assert.equal(draftAnswer({ previous: bad }).error, 'bad_previous');
});

test('Claude\'s words: never the client\'s details, never money; the schema has no field for the client', () => {
  for (const line of ['לקוח: a@b.co', 'ח.פ 500000001', 'טלפון 050-1234567']) {
    const r = checkDraftInput({ ...FREE_DRAFT, text: { clauses: [{ title: 'x', items: [line, '{{2.1}}'] }] } });
    assert.equal(r.error, 'personal_details');
    assert.deepEqual(r.fields, ['text']);
  }
  assert.equal(checkDraftInput({ ...FREE_DRAFT, text: { details: [{ title: 'עלות', items: ['3,900 ₪ לחודש'] }] } }).error, 'money_in_text');
  assert.equal(checkDraftInput({ ...FREE_DRAFT, text: { clientName: 'x' } }).error, 'unknown_field');
  assert.equal(checkDraftInput({ ...FREE_DRAFT, text: { clauses: 'x' } }).error, 'bad_input');
  const words = JSON.stringify(Object.keys(DRAFT_SCHEMA.properties.text.properties)).toLowerCase();
  for (const w of ['name', 'business', 'company', 'phone', 'email', 'address', 'client', '"id']) assert.ok(!words.includes(w), w);
  assert.match(draftDescription(), /Changing a draft by talking/);
  assert.match(draftDescription(), /clean contract Hebrew/);
});

test('who may prepare a draft with the words: the owners, Ofir, Lior and Irit; nobody else', () => {
  for (const person of [null, 'ofir', 'lior', 'irit']) {
    assert.equal(mayUseMcp({ office: true, person }), true, String(person));
    assert.equal(canBuildQuote({ me: person, scope: 'office', error: null }), true, String(person));
  }
  for (const person of ['ilai', 'amit', 'anna', 'eli', 'shiel', 'noam']) assert.equal(mayUseMcp({ office: true, person }), false, person);
  assert.equal(mayUseMcp({ office: false, person: null }), false);
  assert.deepEqual(MCP_PEOPLE, ['lior', 'ofir', 'irit']);
});
