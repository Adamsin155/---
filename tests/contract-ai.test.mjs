// "הכנת חוזה עם AI" (the owner, 25.10.2026; docs/ops.md, section 68), without a real call to
// Claude: each deal below is a text the office would write, with the JSON the model would answer
// (the mock), and what the builder must show after the answer is checked against the catalog
// (app/contract-ai-logic.js validateAiResult) and set on the builder (applyAiResult): the package,
// the add-ons, the custom contract's fields, the totals and the deviations of the pricing engine.
// Then the contract-ai function's handler with fakes of Supabase and of the SDK (who may call,
// the missing key, the request sent to the Messages API, the rate limit, timeouts and refusals,
// the record of every run), and create-quote's check of an AI run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  systemPrompt, catalogText, userMessage, RESULT_SCHEMA, validateAiResult, applyAiResult, aiMarksOf,
  PACKAGE_KEYS, QTY_KEYS, PAID_IDS, AI_TEXT_MAX,
} from '../app/contract-ai-logic.js';
import * as shared from '../supabase/functions/_shared/app/contract-ai-logic.js';
import {
  PACKAGES, PAID_ADDONS, CUSTOM_QTY, CUSTOM_LIMITS, MAX_DISCOUNT, TERM_MONTHS, FREE_ADDONS,
} from '../app/catalog.js';
import { emptySelection, computeTotals, exceptionOf, normalizeSelection, validateSelection, buildQuoteModel } from '../app/pricing.js';
import {
  makeHandler, buildRequest, readAnswer, failureOf, makeLimiter, cleanText, corsHeaders, SITE_ORIGINS, MODEL, RATE_PER_MINUTE,
} from '../supabase/functions/contract-ai/handler.js';
import { SITE_ORIGINS as QUOTE_ORIGINS, aiRunProblem, AI_RUN_HOURS } from '../supabase/functions/create-quote/http.js';

/* ── The prompt and the schema ─────────────── */

test('the prompt describes the builder from the catalog itself, the same text on every call', () => {
  const p = systemPrompt();
  assert.equal(systemPrompt(), p, 'one text: it is cached');
  assert.equal(shared.systemPrompt(), p, 'the function\'s copy says the same');
  assert.doesNotMatch(p, /20\d\d-\d\d-\d\d|\d{1,2}\.\d{1,2}\.20\d\d/, 'no date in it');
  for (const key of PACKAGE_KEYS) {
    assert.match(p, new RegExp(`\`${key}\`: .* ${String(PACKAGES[key].price / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ₪ a month`), key);
  }
  // The package's own quantities, by the keys of the custom contract.
  assert.match(p, /`social-natali`[\s\S]*?Quantities: videos 25, graphics 35, shootDays 1, photoDays 0, collabs 0, stories 0, ch14 0/);
  assert.match(p, /`podcast-simeon`[\s\S]*?Quantities: videos 20, graphics 20, shootDays 0, photoDays 1/);
  for (const a of PAID_ADDONS) assert.match(p, new RegExp(`\`${a.id}\`: ${a.name}, `), a.id);
  assert.match(p, /`natali-reel`.*only packages with נטלי דדון/);
  assert.match(p, /`simeon-day`.*only the Social and Social \+ TV packages with סמיון, מישל ודניס/);
  for (const q of CUSTOM_QTY) assert.match(p, new RegExp(`\`${q.key}\`: ${q.name}, ${q.min || 0}–${q.max}`), q.key);
  for (const k of Object.keys(FREE_ADDONS)) assert.match(p, new RegExp(`\`${k}\``), k);
  assert.match(p, new RegExp(`${TERM_MONTHS} months unless the deal says otherwise; ${CUSTOM_LIMITS.termMin}–${CUSTOM_LIMITS.termMax} months`));
  assert.match(p, /up to 200 ₪ is regular/);
  assert.match(p, /Never compute, round or guess a price/);
  assert.match(p, /"ללא Highlights"/);
  assert.ok(catalogText().length > 2000, 'long enough to be worth caching (512 tokens and more)');
  assert.equal(userMessage('חבילה נטלי'), 'פרטי העסקה כפי שנרשמו במשרד:\n<deal>\nחבילה נטלי\n</deal>');
});

test('the schema is strict: every object closed and fully required, the catalog\'s own keys, no numeric limits', () => {
  const walk = (s, path) => {
    if (s.anyOf) { s.anyOf.forEach((x, i) => walk(x, `${path}|${i}`)); return; }
    for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'multipleOf', 'minItems', 'maxItems']) assert.ok(!(k in s), `${path}: ${k}`);
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, path);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), path);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`);
    }
    if (s.type === 'array') walk(s.items, `${path}[]`);
  };
  walk(RESULT_SCHEMA, '$');
  const P = RESULT_SCHEMA.properties;
  assert.deepEqual(P.package.anyOf[0].enum, PACKAGE_KEYS);
  assert.deepEqual(P.quantities.items.properties.key.enum, QTY_KEYS);
  // The API refuses a schema with more than 16 union-typed parameters (found live, 25.10.2026).
  let unions = 0; const count = (o) => { if (o && typeof o === 'object') { if (o.anyOf || Array.isArray(o.type)) unions += 1; Object.values(o).forEach(count); } }; count(RESULT_SCHEMA);
  assert.ok(unions <= 16, `${unions} union-typed parameters`);
  assert.deepEqual(P.addons.items.enum, PAID_IDS);
  assert.ok(!P.removals.items.enum.includes('monthly'), 'the monthly contents are never removed');
  assert.deepEqual(Object.keys(P).sort(), ['addons', 'client', 'discount', 'discountPercent', 'extraLines', 'freeAddons', 'monthlyPrice', 'months', 'notes', 'package', 'priceIncludesVat', 'quantities', 'questions', 'removals', 'specialClauses'].sort());
});

/* ── Fifteen deals ─────────────────────────── */

// The answer as structured outputs returns it: every key, null where the text says nothing.
const answer = (o = {}) => ({
  package: null, months: null,
  quantities: Object.fromEntries(QTY_KEYS.map((k) => [k, null])),
  removals: [], addons: [], freeAddons: { graphics: null, simeonStories: null, simeonJoin: null, extraCh14: null },
  monthlyPrice: null, priceIncludesVat: false, discount: null, discountPercent: null,
  extraLines: [], specialClauses: [], questions: [], notes: null,
  ...o,
  quantities: { ...Object.fromEntries(QTY_KEYS.map((k) => [k, null])), ...(o.quantities || {}) },
  freeAddons: { graphics: null, simeonStories: null, simeonJoin: null, extraCh14: null, ...(o.freeAddons || {}) },
});
// The builder as Irit opened it: an agreement on the default package.
const START = { ...emptySelection(), docType: 'agreement' };
// What the builder sends (as selectionToSend: the discount moves into `custom` in a custom contract).
function toSend(sel) {
  const { custom, ...rest } = sel;
  if (!custom) return rest;
  return normalizeSelection({ ...rest, discount: 0, custom: { ...custom, discount: rest.discount || 0 } });
}
function run(ai, from = START) {
  const { result, dropped } = validateAiResult(ai);
  const applied = applyAiResult(from, result);
  const send = toSend(applied.selection);
  validateSelection(send); // the server would accept it as it is
  return { result, dropped: dropped.map((d) => d.text), ...applied, send, totals: computeTotals(send), kinds: exceptionOf(send).map((e) => e.kind) };
}

test('1. the owner\'s example: "חבילה נטלי 3500, 20 סרטונים במקום 25, בלי Highlights, 12 חודשים, 2 ימי צילום"', () => {
  const r = run(answer({
    package: 'social-natali', months: 12, quantities: { videos: 20, shootDays: 2 }, monthlyPrice: 350000,
    specialClauses: ['ללא Highlights'], notes: 'המחיר שנכתב נלקח כמחיר החודשי של החבילה לפני מע״מ.',
  }));
  assert.deepEqual(r.dropped, []);
  assert.deepEqual([r.selection.tier, r.selection.influencer], ['social', 'natali']);
  assert.deepEqual(r.selection.custom, { qty: { videos: 20, shootDays: 2 }, price: 350000, terms: 'ללא Highlights' });
  assert.equal(r.selection.custom.termMonths, undefined, '12 months is the package\'s own term');
  assert.deepEqual(Object.keys(r.marks), ['package', 'q:videos', 'q:shootDays', 'price', 'terms']);
  assert.deepEqual([r.totals.monthlyNet, r.totals.monthlyVat, r.totals.monthlyGross, r.totals.termNet], [350000, 63000, 413000, 4200000]);
  assert.deepEqual(r.kinds, ['qty', 'qty', 'price', 'terms']);
  assert.deepEqual(r.summary, [
    'חבילה: Social all in one · נטלי דדון (3,900 ₪ לחודש)',
    'סרטונים: 20 (בחבילה 25)',
    'ימי צילום עם המשפיענים: 2 (בחבילה 1)',
    'מחיר החבילה: 3,500 ₪ לחודש לפני מע״מ (בחבילה 3,900 ₪)',
    'תקופה: 12 חודשים (כמו בחבילה)',
    'תנאי מיוחד: ללא Highlights',
  ]);
  // The document says it.
  const model = buildQuoteModel(r.send, { name: 'דנה' });
  assert.ok(model.package.includes.some((i) => i.qty === 20 && /סרטונים/.test(i.label)));
  assert.ok(model.package.includes.some((i) => i.qty === 2 && /ימי צילום בבית העסק עם נטלי דדון/.test(i.label)));
  assert.equal(model.specialTerms, 'ללא Highlights');
});

test('2. a price with VAT: "סושיאל עם סמיון, 4602 כולל מע״מ" is the package\'s own price, a regular contract', () => {
  const r = run(answer({ package: 'social-simeon', monthlyPrice: 460200, priceIncludesVat: true }));
  assert.equal(r.result.monthlyPrice, 390000);
  assert.equal(r.result.priceIncludesVat, false, 'the checked price is before VAT');
  assert.deepEqual(r.dropped, ['המחיר שנכתב כולל מע״מ (4,602 ₪): הוזן 3,900 ₪ לפני מע״מ']);
  assert.equal(r.selection.custom, undefined);
  assert.deepEqual(r.kinds, []);
  assert.match(r.summary.join('\n'), /מחיר החבילה: 3,900 ₪ לחודש לפני מע״מ \(כמו בחבילה\)/);
  assert.equal(r.totals.monthlyGross, 460200);
});

test('3. fewer videos, a discount above 200 ₪, half a year: "פודקאסט נטלי, 15 סרטונים במקום 20, הנחה 500 ש״ח, חצי שנה"', () => {
  const r = run(answer({ package: 'podcast-natali', quantities: { videos: 15 }, discount: 50000, months: 6 }));
  assert.deepEqual(r.selection.custom, { qty: { videos: 15 }, termMonths: 6 });
  assert.equal(r.selection.discount, 50000, 'the discount field holds it, as when typed by hand');
  assert.ok(r.selection.discount > MAX_DISCOUNT);
  assert.deepEqual([r.totals.monthlyList, r.totals.discount, r.totals.monthlyNet, r.totals.termNet], [350000, 50000, 300000, 1800000]);
  assert.deepEqual(r.kinds, ['qty', 'discount', 'term']);
  assert.deepEqual(r.marks.discount, 50000);
});

test('4. an unknown add-on: "סושיאל נטלי + צלם חודשי + ניהול טיקטוק" keeps the photographer and drops the rest', () => {
  const r = run(answer({ package: 'social-natali', addons: ['photographer', 'tiktok'], questions: ['ניהול טיקטוק אינו תוספת במערכת: להוסיף כשורה נוספת?'] }));
  assert.deepEqual(r.dropped, ['תוספת לא מוכרת: tiktok']);
  assert.deepEqual(r.selection.paid, ['photographer']);
  assert.equal(r.selection.custom, undefined, 'a regular contract');
  assert.equal(r.totals.monthlyNet, 590000);
  assert.deepEqual(r.result.questions, ['ניהול טיקטוק אינו תוספת במערכת: להוסיף כשורה נוספת?']);
  assert.equal(r.marks['paid:photographer'], true);
});

test('5. a missing number becomes a question: "סושיאל סמיון, סרטונים נוספים, 6 חודשים"', () => {
  const r = run(answer({ package: 'social-simeon', months: 6, questions: ['כמה סרטונים בסך הכול? (בחבילה 25)'] }));
  assert.deepEqual(r.selection.custom, { termMonths: 6 });
  assert.deepEqual(r.result.questions, ['כמה סרטונים בסך הכול? (בחבילה 25)']);
  assert.ok(!('q:videos' in r.marks));
  assert.deepEqual(r.kinds, ['term']);
});

test('6. an add-on the package does not allow is not set, and is said: "פודקאסט סמיון עם העלאה אצל נטלי"', () => {
  const r = run(answer({ package: 'podcast-simeon', addons: ['natali-reel'] }));
  assert.deepEqual(r.selection.paid, []);
  assert.deepEqual(r.skipped, ['העלאה אצל נטלי דדון: לא זמינה בחבילה שנבחרה']);
});

test('7. numbers out of range are brought to the limits: "סושיאל TV נטלי, 300 סרטונים, 40 חודשים"', () => {
  const r = run(answer({ package: 'social-tv-natali', quantities: { videos: 300 }, months: 40 }));
  assert.deepEqual(r.dropped, ['תקופה של 40 חודשים מחוץ לטווח (1–36): הוזנו 36', 'סרטונים: 300 מחוץ לטווח (0–200), הוזן 200']);
  assert.deepEqual(r.selection.custom, { qty: { videos: 200 }, termMonths: 36 });
});

test('8. "סושיאל סמיון בלי קולאב ובלי Highlights": the collab goes to 0, Highlights is a special term', () => {
  // The model put Highlights in the removals as well (it is not a quantity of the contract).
  const r = run(answer({ package: 'social-simeon', removals: ['collabs', 'highlights'], specialClauses: ['ללא Highlights'] }));
  assert.deepEqual(r.dropped, ['אין בחוזה פריט בשם ״highlights״ להסרה']);
  assert.deepEqual(r.selection.custom, { qty: { collabs: 0 }, terms: 'ללא Highlights' });
  assert.match(r.summary.join('\n'), /קולאבים באינסטגרם: בלי \(בחבילה 1\)/);
  const model = buildQuoteModel(r.send, { name: 'x' });
  assert.ok(!model.package.includes.some((i) => /קולאב/.test(i.label)));
});

test('9. an extra line with its price: "סושיאל נטלי + אתר תדמית 500 ש״ח לחודש"', () => {
  const r = run(answer({ package: 'social-natali', extraLines: [{ label: 'אתר תדמית', qty: 1, monthly: 50000 }] }));
  assert.deepEqual(r.selection.custom, { lines: [{ label: 'אתר תדמית', qty: 1, monthly: 50000 }] });
  assert.equal(r.totals.monthlyList, 440000);
  assert.deepEqual(r.kinds, ['line']);
  // The same price written as shekels (500 instead of 50000 agorot): not set, and said.
  const s = run(answer({ package: 'social-natali', extraLines: [{ label: 'אתר תדמית', qty: 1, monthly: 500 }] }));
  assert.deepEqual(s.selection.custom, { lines: [{ label: 'אתר תדמית', qty: 1 }] });
  assert.deepEqual(s.dropped, ['מחיר של 5 ₪ לחודש ל״אתר תדמית״ נראה שגוי ולא הוזן']);
});

test('10. a discount in percent is taken from the builder\'s own monthly price: "סושיאל סמיון, 10% הנחה"', () => {
  const r = run(answer({ package: 'social-simeon', discountPercent: 10 }));
  assert.equal(r.selection.discount, 39000);
  assert.ok(r.selection.custom, 'above 200 ₪: a custom contract');
  assert.equal(r.totals.monthlyNet, 351000);
  assert.match(r.summary.join('\n'), /הנחה של 10% מ־3,900 ₪/);
});

test('11. free add-ons: "נטלי סושיאל, סמיון מצטרף ליום הצילום, 2 סטוריז של סמיון, 10 גרפיקות מתנה"', () => {
  const r = run(answer({ package: 'social-natali', freeAddons: { simeonJoin: true, simeonStories: 2, graphics: 10 } }));
  assert.deepEqual(r.selection.free, { graphics: 10, simeonStories: 2, simeonJoin: true, extraCh14: false });
  assert.equal(r.selection.custom, undefined, 'a regular contract');
  assert.deepEqual(['free:simeonJoin', 'free:graphics', 'free:simeonStories'].filter((k) => k in r.marks), ['free:simeonJoin', 'free:graphics', 'free:simeonStories']);
  assert.equal(r.totals.monthlyNet, 390000);
});

test('12. the monthly photographer\'s contents need the photographer: "סושיאל סמיון + צלם חודשי, 12 תכנים בחודש"', () => {
  const r = run(answer({ package: 'social-simeon', addons: ['photographer'], quantities: { monthly: 12 } }));
  assert.deepEqual(r.selection.custom, { qty: { monthly: 12 } });
  assert.deepEqual(r.kinds, ['qty']);
  const without = run(answer({ package: 'social-simeon', quantities: { monthly: 12 } }));
  assert.equal(without.selection.custom, undefined);
  assert.deepEqual(without.skipped, ['תכנים בחודש מהצלם החודשי: רק עם צלם חודשי']);
});

test('13. a price that cannot be the monthly price is not set and is asked: "חבילה סמיון 3500" read as 35 ₪', () => {
  const r = run(answer({ package: 'social-simeon', monthlyPrice: 3500 }));
  assert.equal(r.result.monthlyPrice, null);
  assert.deepEqual(r.dropped, ['מחיר חודשי של 35 ₪ נראה שגוי ולא הוזן']);
  assert.deepEqual(r.result.questions, ['מה המחיר החודשי של החבילה לפני מע״מ?']);
  assert.equal(r.selection.custom, undefined);
});

test('14. no package in the text: the current one stays, with a question: "חבילה עם 30 סרטונים"', () => {
  const from = { ...START, tier: 'social-tv', influencer: 'simeon' };
  const r = run(answer({ quantities: { videos: 30 }, questions: ['איזו חבילה? לא צוין משפיען ולא סוג חבילה.'] }), from);
  assert.deepEqual([r.selection.tier, r.selection.influencer], ['social-tv', 'simeon']);
  assert.deepEqual(r.selection.custom, { qty: { videos: 30 } });
  assert.equal(r.summary[0], 'חבילה: לא זוהתה בטקסט, נשארה Social + TV all in one · סמיון, מישל ודניס');
  assert.ok(!('package' in r.marks));
});

test('15. a broken answer: nothing unknown gets in, nothing throws', () => {
  for (const raw of [null, 'nonsense', 42, []]) {
    const { result, dropped } = validateAiResult(raw);
    assert.deepEqual(dropped.map((d) => d.text), ['התשובה לא הייתה בפורמט הנכון']);
    assert.equal(result.package, null);
  }
  const r = run({ package: 'premium', months: 'שנה', quantities: { videos: 'many', reels: 5 }, price: 3000, addons: 'photographer', freeAddons: { graphics: 'x', vip: true, simeonJoin: 'yes' } });
  assert.deepEqual(r.dropped, [
    'שדה לא מוכר: price', 'חבילה לא מוכרת: premium', 'תקופה לא מספרית', 'סרטונים: לא מספר', 'כמות לא מוכרת: reels',
    'גרפיקות נוספות: לא מספר', 'תוספת ללא עלות לא מוכרת: vip', 'צירוף סמיון ליום הצילום עם נטלי: לא כן/לא',
  ]);
  assert.deepEqual([r.selection.tier, r.selection.influencer, r.selection.paid, r.selection.custom], ['social', 'simeon', [], undefined]);
});

test('16. a discount larger than the price is the price; long terms are cut to fit the agreement', () => {
  const r = run(answer({ package: 'podcast-simeon', discount: 500000 }));
  assert.equal(r.selection.discount, 350000);
  assert.deepEqual(r.skipped, ['הנחה של 5,000 ₪ גדולה מהמחיר החודשי: הוזנה 3,500 ₪']);
  assert.equal(r.totals.monthlyNet, 0);
  const many = Array.from({ length: 14 }, (_, i) => `סעיף ${i + 1}: ${'א'.repeat(250)}`);
  const c = run(answer({ package: 'social-natali', specialClauses: many }));
  assert.ok(c.selection.custom.terms.length <= CUSTOM_LIMITS.terms);
  assert.ok(c.dropped.length >= 1 && c.dropped.every((t) => /^תנאי לא נכנס/.test(t)));
});

test('checking a checked result again changes nothing (the builder checks what the function already checked)', () => {
  const answers = [
    answer({ package: 'social-natali', months: 12, quantities: { videos: 20, shootDays: 2 }, monthlyPrice: 350000, specialClauses: ['ללא Highlights'] }),
    answer({ package: 'social-simeon', monthlyPrice: 460200, priceIncludesVat: true }),
    answer({ package: 'social-tv-simeon', monthlyPrice: 413000, priceIncludesVat: true, discount: 50000 }),
    answer({ package: 'social-tv-natali', quantities: { videos: 300 }, months: 40, removals: ['collabs', 'highlights'] }),
    answer({ package: 'social-simeon', monthlyPrice: 3500 }),
    answer({ package: 'social-simeon', discountPercent: 10, addons: ['photographer', 'tiktok'], quantities: { monthly: 12 } }),
    answer({ package: 'social-natali', extraLines: [{ label: '  אתר   תדמית ', qty: 0, monthly: 50 }], freeAddons: { graphics: 99, simeonJoin: true } }),
  ];
  for (const a of answers) {
    const once = validateAiResult(a).result;
    const twice = validateAiResult(once);
    assert.deepEqual(twice.result, once, JSON.stringify(a.package));
    assert.deepEqual(twice.dropped, [], JSON.stringify(a.package));
    // And the builder ends in the same place either way.
    assert.deepEqual(applyAiResult(START, twice.result).selection, applyAiResult(START, once).selection);
  }
});

test('the tags follow the fields: a field changed by hand afterwards loses "מולא אוטומטית"', () => {
  const { selection, marks } = run(answer({ package: 'social-natali', quantities: { videos: 20 }, monthlyPrice: 350000, discount: 10000, addons: ['photographer'], extraLines: [{ label: 'אתר', qty: null, monthly: null }] }));
  assert.deepEqual([...aiMarksOf(selection, marks)].sort(), ['discount', 'lines', 'package', 'paid:photographer', 'price', 'q:videos'].sort());
  const edited = { ...selection, discount: 0, custom: { ...selection.custom, qty: { videos: 22 }, lines: [{ label: 'אתר', qty: null, monthly: null }] } };
  assert.deepEqual([...aiMarksOf(edited, marks)].sort(), ['lines', 'package', 'paid:photographer', 'price'].sort(), 'an empty quantity or price field of a line is no change');
  assert.deepEqual([...aiMarksOf({ ...edited, influencer: 'simeon' }, marks)].sort(), ['lines', 'paid:photographer', 'price']);
  assert.deepEqual([...aiMarksOf(selection, null)], []);
});

test('the result starts from the package: what was on the builder before is replaced, the document type stays', () => {
  const before = { ...emptySelection(), docType: 'quote', tier: 'social-tv', influencer: 'natali', paid: ['natali-reel'], discount: 20000, custom: { qty: { videos: 50 }, terms: 'ישן' } };
  const r = applyAiResult(before, validateAiResult(answer({ package: 'social-simeon' })).result);
  assert.deepEqual(r.selection, { ...emptySelection(), docType: 'quote', tier: 'social', influencer: 'simeon' });
});

/* ── The function ──────────────────────────── */

const RUN_ID = '7b0c8a52-4c55-4b0e-9a0a-2b7f9f0c1d11';
class APIError extends Error {}
class APIConnectionError extends APIError {}
class APIConnectionTimeoutError extends APIConnectionError {}
class AuthenticationError extends APIError {}
class RateLimitError extends APIError {}
const Errors = { APIError, APIConnectionError, APIConnectionTimeoutError, AuthenticationError, PermissionDeniedError: class extends APIError {}, RateLimitError };
const GOOD = { id: 'msg_1', model: MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer({ package: 'social-natali', quantities: { videos: 20, reels: 3 }, monthlyPrice: 350000 })) }] };

function world({ office = true, user = { id: 'u-irit', email: 'irit@astrateg.test' }, key = 'sk-ant-secret-key', reply = GOOD, recent = 0, table = true } = {}) {
  const w = { calls: [], inserts: [], logs: [], clients: 0 };
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', ...(key ? { ANTHROPIC_API_KEY: key } : {}) };
  const createClient = (url, k, opts) => {
    w.clients += 1;
    return {
      auth: { getUser: async () => ({ data: { user: opts?.global?.headers?.Authorization ? user : null } }) },
      rpc: async (fn) => (fn === 'is_office' ? { data: office, error: null } : { data: null, error: { message: 'no' } }),
      from: (t) => ({
        select: () => ({ eq: () => ({ gte: async () => (table ? { count: recent, error: null } : { count: null, error: { code: '42P01' } }) }) }),
        insert: (row) => ({ select: () => ({ single: async () => { w.inserts.push({ t, row }); return table ? { data: { id: RUN_ID }, error: null } : { data: null, error: { code: '42P01' } }; } }) }),
      }),
    };
  };
  const makeClient = (apiKey) => ({
    beta: { messages: { create: async (params) => { w.calls.push({ apiKey, params }); if (reply instanceof Error) throw reply; return reply; } } },
  });
  w.handle = makeHandler({ env: (k) => env[k], serviceKey: () => 'service', createClient, makeClient, Errors, log: (m) => w.logs.push(m) });
  return w;
}
const post = (body, { auth = 'Bearer t', origin = 'https://app.astrateg.tech', method = 'POST' } = {}) => new Request('https://db.example/functions/v1/contract-ai', {
  method, headers: { ...(auth ? { Authorization: auth } : {}), origin, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});
const call = async (w, req) => { const res = await w.handle(req); return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }; };
const TEXT = 'חבילה נטלי 3500, 20 סרטונים במקום 25, בלי Highlights, 12 חודשים, 2 ימי צילום';

test('the function: the office only, from the office\'s site; the key is checked after who calls', async () => {
  assert.deepEqual(SITE_ORIGINS, QUOTE_ORIGINS, 'the same allow-list as create-quote');
  assert.equal(corsHeaders('https://evil.example')['Access-Control-Allow-Origin'], undefined);
  assert.equal(corsHeaders('https://app.astrateg.tech')['Access-Control-Allow-Origin'], 'https://app.astrateg.tech');
  const opt = await world().handle(post(null, { method: 'OPTIONS' }));
  assert.equal(opt.status, 200);
  assert.equal((await call(world(), post({ text: TEXT }, { method: 'GET' }))).status, 405);
  assert.deepEqual(await call(world(), post({ text: TEXT }, { auth: null })).then((r) => [r.status, r.body]), [401, { error: 'not signed in' }]);
  // An editor or a seller: refused, and nothing tells them whether the AI is set up.
  for (const key of ['sk', null]) {
    const w = world({ office: false, key });
    assert.deepEqual(await call(w, post({ text: TEXT })).then((r) => [r.status, r.body.error]), [403, 'not staff: contracts are prepared by the office']);
    assert.equal(w.calls.length, 0);
  }
  const none = world({ key: null });
  assert.deepEqual(await call(none, post({ text: TEXT })).then((r) => [r.status, r.body]), [503, { error: 'ai_not_configured' }]);
  assert.deepEqual([none.calls.length, none.inserts.length], [0, 0]);
});

test('the function: the text is checked before anything is sent', async () => {
  assert.deepEqual(cleanText('  שלום \r\n עולם '), { text: 'שלום \n עולם' });
  for (const [body, error] of [[{}, 'text_required'], [{ text: '   ' }, 'text_required'], [{ text: 5 }, 'text_required'], [{ text: 'א'.repeat(AI_TEXT_MAX + 1) }, 'text_too_long']]) {
    const w = world();
    assert.deepEqual(await call(w, post(body)).then((r) => [r.status, r.body.error]), [400, error], JSON.stringify(body).slice(0, 30));
    assert.equal(w.calls.length, 0);
  }
  const w = world();
  const res = await w.handle(new Request('https://db.example/functions/v1/contract-ai', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: '{not json' }));
  assert.equal(res.status, 400);
});

test('the function: the request to Claude, the checked answer, the record of the run', async () => {
  const w = world();
  const r = await call(w, post({ text: `  ${TEXT}  ` }));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://app.astrateg.tech');
  // The request: the current Sonnet, the strict schema, the cached system prompt, the words last.
  const { apiKey, params } = w.calls[0];
  assert.equal(apiKey, 'sk-ant-secret-key');
  assert.deepEqual(params, buildRequest(TEXT));
  assert.equal(params.model, 'claude-sonnet-5-5');
  assert.deepEqual(params.output_config, { effort: 'medium', format: { type: 'json_schema', schema: RESULT_SCHEMA } });
  assert.deepEqual([params.betas, params.fallbacks], [['server-side-fallback-2026-07-01'], 'default']);
  assert.deepEqual(params.system, [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }]);
  assert.deepEqual(params.messages, [{ role: 'user', content: userMessage(TEXT) }]);
  for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice']) assert.ok(!(k in params), k);
  // The answer, checked: the unknown quantity is out and said.
  assert.equal(r.body.runId, RUN_ID);
  assert.equal(r.body.model, MODEL);
  assert.deepEqual(r.body.result.quantities, { videos: 20 });
  assert.deepEqual(r.body.dropped, [{ field: 'quantities.reels', text: 'כמות לא מוכרת: reels' }]);
  // The run is kept: who, the words, the checked result; never the key.
  assert.equal(w.inserts.length, 1);
  const { t, row } = w.inserts[0];
  assert.equal(t, 'contract_ai_runs');
  assert.deepEqual({ ...row, result: undefined, left_out: undefined }, { user_id: 'u-irit', by_email: 'irit@astrateg.test', deal_text: TEXT, model: MODEL, status: 'ok', result: undefined, left_out: undefined });
  assert.deepEqual(row.result, r.body.result);
  assert.deepEqual(row.left_out, r.body.dropped);
  assert.doesNotMatch(JSON.stringify([r.body, w.inserts, w.logs]), /sk-ant-secret-key/);
});

test('the function: refusals, cut answers, timeouts and a wrong key answer plainly, and the run is kept as an error', async () => {
  const cases = [
    [{ ...GOOD, stop_reason: 'refusal', content: [] }, 502, 'ai_refused'],
    [{ ...GOOD, stop_reason: 'max_tokens' }, 502, 'ai_incomplete'],
    [{ ...GOOD, content: [{ type: 'text', text: 'לא JSON' }] }, 502, 'ai_failed'],
    [{ ...GOOD, content: [{ type: 'thinking', thinking: '' }] }, 502, 'ai_failed'],
    [new APIConnectionTimeoutError('Request timed out.'), 504, 'ai_timeout'],
    [new AuthenticationError('invalid x-api-key'), 503, 'ai_not_configured'],
    [new RateLimitError('rate limited'), 503, 'ai_busy'],
    [new APIConnectionError('Connection error.'), 502, 'ai_unreachable'],
    [new Error('boom'), 502, 'ai_failed'],
  ];
  for (const [reply, status, error] of cases) {
    const w = world({ reply });
    const r = await call(w, post({ text: TEXT }));
    assert.deepEqual([r.status, r.body], [status, { error }], error);
    assert.deepEqual(w.inserts.map((i) => [i.row.status, i.row.result.error]), [['error', error]], error);
    assert.ok(!JSON.stringify(w.inserts[0].row.result).includes('sk-'), 'no key kept');
    // The log has the kind of failure only: never the words or the key.
    assert.equal(w.logs.length, 1);
    assert.doesNotMatch(w.logs[0], /סרטונים|sk-ant/);
  }
  // A thinking block before the text is read past.
  assert.deepEqual(readAnswer({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":1}' }] }), { raw: { a: 1 } });
  assert.deepEqual(readAnswer(null), { error: 'ai_failed' });
  assert.deepEqual(failureOf(new Error('x'), {}), { status: 502, error: 'ai_failed' });
});

test('the function: at most 20 preparations a minute for each person, by the database and inside the instance', async () => {
  const busy = world({ recent: RATE_PER_MINUTE });
  assert.deepEqual(await call(busy, post({ text: TEXT })).then((r) => [r.status, r.body]), [429, { error: 'rate_limited' }]);
  assert.equal(busy.calls.length, 0);
  const allow = makeLimiter(3);
  assert.deepEqual([allow('a', 0), allow('a', 1), allow('a', 2), allow('a', 3), allow('b', 3), allow('a', 60001)], [true, true, true, false, true, true]);
  const w = world();
  const codes = [];
  for (let i = 0; i <= RATE_PER_MINUTE; i += 1) codes.push((await w.handle(post({ text: TEXT }))).status);
  assert.deepEqual([codes.slice(0, RATE_PER_MINUTE).every((c) => c === 200), codes.at(-1)], [true, 429]);
});

test('the function: before the migration (no table) the builder is still filled, without a run id', async () => {
  const w = world({ table: false });
  const r = await call(w, post({ text: TEXT }));
  assert.equal(r.status, 200);
  assert.equal(r.body.runId, null);
  assert.equal(r.body.result.package, 'social-natali');
  assert.match(w.logs.join('\n'), /the run was not kept \(42P01\)/);
});

/* ── create-quote and the AI run ───────────── */

test('create-quote: an AI run counts only if it is the caller\'s own, successful, recent and unused', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const run = { user_id: 'u-irit', status: 'ok', created_at: '2026-10-25T09:00:00Z' };
  assert.equal(aiRunProblem(run, 'u-irit', 0, now), null);
  assert.equal(aiRunProblem(run, 'u-lior', 0, now), 'not found');
  assert.equal(aiRunProblem({ ...run, status: 'error' }, 'u-irit', 0, now), 'not found');
  assert.equal(aiRunProblem(null, 'u-irit', 0, now), 'not found');
  assert.equal(aiRunProblem(run, null, 0, now), 'not found');
  assert.equal(aiRunProblem(run, 'u-irit', 1, now), 'used');
  assert.equal(aiRunProblem({ ...run, created_at: new Date(now - AI_RUN_HOURS * 3600e3 - 1000).toISOString() }, 'u-irit', 0, now), 'expired');
  assert.equal(aiRunProblem({ ...run, created_at: 'nope' }, 'u-irit', 0, now), 'expired');
});

test('create-quote: the run is checked before anything is stored; a corrected version keeps the approval', () => {
  const src = readFileSync(new URL('../supabase/functions/create-quote/index.ts', import.meta.url), 'utf8');
  assert.ok(src.indexOf('aiRunProblem(run, user.id') < src.indexOf(".from('quotes')\n    .insert("), 'checked before the insert');
  assert.match(src, /if \(!revise\) aiRun = body\.aiRun;/);
  assert.match(src, /\.\.\.\(aiRun \? \{ prepared_by: 'ai', ai_run_id: aiRun \} : \{\}\)/);
  assert.match(src, /if \(problem\) return json\(409, \{ error: `ai run \$\{problem\}` \}\);/);
  // Waiting for a manager: no token; prepared with AI: the token at once.
  assert.match(src, /if \(row\.approval === 'pending'\) return json\(200, \{ id: row\.id, number: row\.number, created_at: row\.created_at, approval: row\.approval \}\);/);
});

test('the customer\'s details: what the text gave, in the form\'s limits; nothing invented', () => {
  const ok = validateAiResult({ client: { name: ' דני כהן ', company: 'פיצה דני', companyId: '51-472993-8', phone: '050-1234567', email: 'dani@pizza.co.il' } });
  assert.deepEqual(ok.result.client, { name: 'דני כהן', company: 'פיצה דני', companyId: '514729938', phone: '050-1234567', email: 'dani@pizza.co.il' });
  assert.deepEqual(ok.dropped, []);
  assert.deepEqual(validateAiResult({ client: { name: '', company: '', companyId: '', phone: '', email: '' } }).result.client, {});
  const bad = validateAiResult({ client: { name: 'דני', company: '', companyId: '12', phone: '05', email: 'dani@' } });
  assert.deepEqual(bad.result.client, { name: 'דני' });
  assert.deepEqual(bad.dropped.map((d) => d.field), ['client.companyId', 'client.phone', 'client.email']);
});
