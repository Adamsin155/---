// "בדיוק כמו שכתבתי (חוזה חופשי)" (the owner, 29.10.2026; docs/ops.md, section 79), without a real
// call to Claude: each text is what the office or the field would write, with the JSON the model
// would answer (the mock), and what the builder must show after the answer is checked
// (validateFreeResult) and set on the builder (applyFreeDraft): a custom contract exactly as
// written, its totals by the pricing engine, the document it becomes, and what a signed one opens.
// Then the contract-ai function's handler in free mode with fakes of Supabase and of the SDK.
// Also: no contract waits for a manager any more, and Stav's free deal opens the builder with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freeSystemPrompt, FREE_SCHEMA, validateFreeResult, applyFreeDraft, aiMarksOf, FREE_MAX_DRAFTS, draftTitle,
} from '../app/contract-ai-logic.js';
import * as shared from '../supabase/functions/_shared/app/contract-ai-logic.js';
import {
  emptySelection, normalizeSelection, validateSelection, buildQuoteModel, exceptionOf, computeTotals, reconcile,
  paidAddonAvailable, freeAddonAvailable,
} from '../app/pricing.js';
import { PAID_ADDONS } from '../app/catalog.js';
import { packageDeliverables } from '../app/protocol-logic.js';
import { makeHandler, buildRequest, MODEL } from '../supabase/functions/contract-ai/handler.js';
import { validateDeal, prefillFromDeal, dealSummary, contractTitle, submitText, isFreeDeal, docTypeOf } from '../app/deal-logic.js';

// One draft as structured outputs returns it: every key, null where the text says nothing.
const draft = (o = {}) => ({
  title: '', docType: null, influencer: null, tier: null, monthlyPrice: null, priceIncludesVat: false, monthlyShoot: false, monthlyContents: null,
  quantities: [], addons: [], months: null, extraLines: [], specialClauses: [], discount: null,
  client: { name: '', company: '', companyId: '', phone: '', email: '' }, ...o,
});
const answer = (drafts, o = {}) => ({ drafts, questions: [], notes: null, ...o });
// What the builder sends to create-quote: the custom state as the builder keeps it (the discount inside).
const toSend = (sel) => {
  const { custom, ...rest } = sel;
  return normalizeSelection({ ...rest, discount: 0, custom: { ...custom, discount: rest.discount || 0 } });
};
const run = (raw, current = { ...emptySelection(), docType: 'agreement' }) => {
  const { result, dropped } = validateFreeResult(raw);
  const applied = result.drafts.map((d) => applyFreeDraft(current, d));
  return { result, dropped, applied };
};

/* ── The owner's example ───────────────────── */

const OFIR = 'תוציא לי הצעת מחיר 4,900 עם שתי דפי נחיתה\nסתיו מכירות: בלי משפיען 4,900 בחודש\nסתיו מכירות: צילום כל חודש 8 תכנים';

test('the example of 29.10.2026: a price offer, no influencer, 4,900 ₪ before VAT, a monthly shoot of 8 contents, 2 landing pages included, 12 months', () => {
  const raw = answer([draft({ title: '4,900 בלי משפיען', docType: 'quote', influencer: 'none', monthlyPrice: 490000, monthlyShoot: true, monthlyContents: 8, extraLines: [{ label: 'דפי נחיתה', qty: 2, monthly: null }] })]);
  const { result, dropped, applied } = run(raw);
  assert.deepEqual(dropped, []);
  assert.equal(result.drafts.length, 1);
  const a = applied[0];
  assert.deepEqual(a.questions, []);
  assert.deepEqual(a.skipped, []);
  assert.deepEqual(a.summary, [
    'מסמך: הצעת מחיר',
    'משפיענים: בלי',
    'צילום כל חודש (צלם חודשי): 8 תכנים בכל חודש',
    'לא נכתבו, ולכן לא בחוזה: סרטונים, גרפיקות',
    'מחיר: 4,900 ₪ לחודש לפני מע״מ, הכול כלול',
    'תקופה: 12 חודשים (לא נכתבה תקופה)',
    '2 דפי נחיתה (כלול במחיר)',
  ]);
  // The builder: "חוזה מותאם אישית" on, a quote, the monthly photographer inside the price.
  assert.equal(a.selection.docType, 'quote');
  assert.deepEqual(a.selection.paid, ['photographer']);
  assert.deepEqual(a.selection.custom, { noInfluencer: true, qty: { videos: 0, graphics: 0 }, price: 490000, addonsIncluded: true, lines: [{ label: 'דפי נחיתה', qty: 2 }] });
  const sel = toSend(a.selection);
  validateSelection(sel);
  const t = computeTotals(sel);
  assert.deepEqual([t.monthlyNet, t.monthlyGross, t.termGross], [490000, 578200, 578200 * 12], 'exactly 4,900 ₪ a month before VAT, for 12 months');
  // The document: no influencer anywhere, the photographer "כלול במחיר", the pages included.
  const m = buildQuoteModel(sel, { name: 'לקוח' });
  assert.equal(m.docTitle, 'הצעת מחיר');
  assert.equal(m.signable, false);
  assert.equal(m.termMonths, 12);
  assert.equal(m.package.influencer, 'בלי משפיענים');
  assert.deepEqual(m.package.includes, [{ qty: null, label: 'ניהול רשתות חברתיות' }, { qty: null, label: 'ניהול קמפיינים ממומנים ברשתות' }, { qty: 2, label: 'דפי נחיתה' }]);
  assert.deepEqual(m.paid.map((p) => [p.name, p.monthly, p.included]), [['צלם חודשי', 0, true]]);
  assert.doesNotMatch(JSON.stringify(m.package), /סמיון|נטלי|נירו|הצל/);
  // What the owners see in "הצעות שנשלחו" (information only).
  assert.deepEqual(exceptionOf(sel).map((e) => e.text), ['0 סרטונים במקום 25', '0 גרפיקות במקום 35', 'מחיר חודשי 4,900 ₪ במקום 3,900 ₪', 'שורה נוספת: דפי נחיתה × 2', 'בלי משפיענים', 'התוספות כלולות במחיר החודשי']);
  // The tags of the fields that were filled.
  assert.deepEqual([...aiMarksOf(a.selection, a.marks)].sort(), ['incl', 'lines', 'noinf', 'paid:photographer', 'price']);
  // A signed agreement of it would grant exactly that: 8 contents a month, no influencer's day.
  assert.deepEqual(packageDeliverables(buildQuoteModel({ ...sel, docType: 'agreement' })), { videos: 0, graphics: 0, shoot_days: 0, collabs: 0, stories: 0, ch14: 0, monthly: 96, extra: [{ label: 'דפי נחיתה', qty: 2 }] });
});

test('the example as an agreement: the same contract, signable, and the agreement says "ללא משפיענים" with no chapter on them', () => {
  const { applied } = run(answer([draft({ docType: 'agreement', influencer: 'none', monthlyPrice: 490000, monthlyShoot: true, monthlyContents: 8, extraLines: [{ label: 'דפי נחיתה', qty: 2, monthly: null }] })]));
  const sel = toSend(applied[0].selection);
  const m = buildQuoteModel(sel, { name: 'לקוח' });
  assert.equal(m.docTitle, 'הסכם התקשרות');
  assert.equal(m.signable, true);
  const text = m.legal.map((s) => `${s.title}: ${s.items.join(' ')}`).join('\n');
  assert.match(text, /חבילת Social all in one, ללא משפיענים, בתוספת: צלם חודשי/);
  assert.match(text, /\(Social all in one · ללא משפיענים\) והתוספות שנבחרו היא 4,900 ₪ לחודש/);
  assert.match(text, /"יום צילום": יום צילום של וידאו וסטילס עם צלם בבית העסק של הלקוח\./);
  assert.ok(!m.legal.some((s) => s.title === 'משפיעני רשת'), 'no chapter about influencers');
  // Without a text that says the document, the one chosen on the builder stays.
  const kept = run(answer([draft({ influencer: 'none', monthlyPrice: 300000 })]), { ...emptySelection(), docType: 'quote' }).applied[0];
  assert.equal(kept.selection.docType, 'quote');
  assert.equal(kept.summary[0], 'מסמך: הצעת מחיר (כמו שנבחר במחולל)');
});

/* ── Three more texts ──────────────────────── */

test('with VAT: "4,900 כולל מע״מ" is 4,150 ₪ before VAT, and the summary says what was written', () => {
  const { applied } = run(answer([draft({ influencer: 'none', monthlyPrice: 490000, priceIncludesVat: true, quantities: [{ key: 'videos', value: 10 }] })]));
  const a = applied[0];
  assert.equal(a.selection.custom.price, 415300, '4,900 / 1.18, in whole shekels');
  assert.ok(a.summary.includes('מחיר: 4,153 ₪ לחודש לפני מע״מ (נכתב 4,900 ₪ כולל מע״מ)'), a.summary.join(' | '));
  assert.ok(a.summary.includes('סרטונים: 10'));
  assert.deepEqual(a.selection.custom.qty, { videos: 10, graphics: 0 });
  const t = computeTotals(toSend(a.selection));
  assert.equal(t.monthlyNet, 415300);
  assert.ok(Math.abs(t.monthlyGross - 490000) <= 100, 'back to about what was written with VAT');
});

test('with a term: "6 חודשים, 3,000 לחודש, 12 סרטונים ו־10 גרפיקות" is six months, as written', () => {
  const { applied } = run(answer([draft({ docType: 'agreement', influencer: 'none', monthlyPrice: 300000, months: 6, quantities: [{ key: 'videos', value: 12 }, { key: 'graphics', value: 10 }] })]));
  const a = applied[0];
  assert.deepEqual(a.selection.custom, { noInfluencer: true, qty: { videos: 12, graphics: 10 }, price: 300000, termMonths: 6 });
  assert.ok(a.summary.includes('תקופה: 6 חודשים'));
  const t = computeTotals(toSend(a.selection));
  assert.deepEqual([t.monthlyNet, t.termNet], [300000, 1800000]);
  assert.equal(a.marks.term, 6);
});

test('with an influencer named: "עם נטלי 6,500, סושיאל" is Natali\'s package at the price written, its own quantities kept', () => {
  const { applied } = run(answer([draft({ influencer: 'natali', tier: 'social', monthlyPrice: 650000, addons: ['natali-reel'] })]));
  const a = applied[0];
  assert.equal(a.selection.influencer, 'natali');
  assert.equal(a.selection.tier, 'social');
  assert.deepEqual(a.selection.paid, ['natali-reel']);
  assert.deepEqual(a.selection.custom, { price: 650000, addonsIncluded: true });
  assert.equal(a.marks.package, 'social-natali');
  assert.ok(a.summary.includes('משפיענים: נטלי דדון (Social all in one)'));
  const sel = toSend(a.selection);
  validateSelection(sel);
  const m = buildQuoteModel(sel);
  assert.equal(m.package.influencer, 'נטלי דדון');
  assert.equal(m.totals.monthlyNet, 650000, 'the reel is inside the price written');
  assert.ok(m.package.includes.some((l) => l.label.includes('נטלי דדון')), 'her shoot day stays');
  // An addition at someone else: not set, and said.
  const other = run(answer([draft({ influencer: 'natali', monthlyPrice: 650000, addons: ['niro-reel'] })])).applied[0];
  assert.deepEqual(other.selection.paid, []);
  assert.match(other.skipped[0], /העלאה אצל נירו לוי/);
});

test('no influencer: nothing of an influencer can be added, by hand or by the text', () => {
  const sel = { ...emptySelection(), influencer: 'natali', custom: { noInfluencer: true } };
  for (const a of PAID_ADDONS) assert.equal(paidAddonAvailable(a, sel), a.eligibility === 'all', a.id);
  assert.equal(freeAddonAvailable('simeonJoin', sel), false);
  assert.equal(freeAddonAvailable('simeonStories', sel), false);
  const { selection, removed } = reconcile({ ...sel, paid: ['natali-reel', 'photographer'], free: { ...sel.free, simeonJoin: true } });
  assert.deepEqual(selection.paid, ['photographer']);
  assert.deepEqual(removed.sort(), ['העלאה אצל נטלי דדון', 'צירוף סמיון ליום הצילום עם נטלי'].sort());
  assert.throws(() => validateSelection({ ...emptySelection(), custom: { noInfluencer: 'yes' } }), /noInfluencer must be boolean/);
  // "המחיר כולל את התוספות" without any add-on is no change at all.
  assert.equal(normalizeSelection({ ...emptySelection(), custom: { addonsIncluded: true } }).custom, undefined);
});

/* ── Several documents in one text ─────────── */

test('two offers in one text are two drafts, each its own contract; at most three', () => {
  const raw = answer([
    draft({ title: '4,900 בלי משפיען', docType: 'quote', influencer: 'none', monthlyPrice: 490000 }),
    draft({ title: '6,500 עם נטלי', docType: 'quote', influencer: 'natali', monthlyPrice: 650000 }),
  ], { questions: ['א', 'ב', 'ג'] });
  const { result, applied } = run(raw);
  assert.equal(result.drafts.length, 2);
  assert.deepEqual(result.questions, ['א', 'ב'], 'at most two questions');
  assert.deepEqual(applied.map((a) => [a.selection.docType, a.selection.custom.price, a.selection.custom.noInfluencer === true]), [['quote', 490000, true], ['quote', 650000, false]]);
  assert.deepEqual(result.drafts.map((d, i) => draftTitle(d, i)), ['הצעה 1 · 4,900 בלי משפיען', 'הצעה 2 · 6,500 עם נטלי']);
  const four = validateFreeResult(answer([draft(), draft(), draft(), draft()]));
  assert.equal(four.result.drafts.length, FREE_MAX_DRAFTS);
  assert.match(four.dropped[0].text, /יותר מ־3 מסמכים/);
});

test('a missing price is the one question; a broken answer lets nothing in', () => {
  const a = run(answer([draft({ influencer: 'none', quantities: [{ key: 'videos', value: 8 }] })])).applied[0];
  assert.deepEqual(a.questions, ['מה המחיר החודשי לפני מע״מ? לא נכתב מחיר, ובינתיים נשאר המחיר של החבילה.']);
  assert.equal(a.selection.custom.price, undefined);
  for (const raw of [null, 'x', { drafts: 'x' }, { drafts: [null, 5] }, answer([draft({ influencer: 'bibi', tier: 'radio', monthlyPrice: -5, quantities: [{ key: 'reels', value: 3 }], addons: ['tiktok'] })])]) {
    const { result } = validateFreeResult(raw);
    for (const d of result.drafts) {
      const x = applyFreeDraft(emptySelection(), d);
      validateSelection(toSend(x.selection));
    }
  }
  const odd = validateFreeResult(answer([draft({ influencer: 'bibi', addons: ['tiktok'] })]));
  assert.equal(odd.result.drafts[0].influencer, 'none');
  assert.deepEqual(odd.dropped.map((d) => d.text), ['הצעה 1: משפיען לא מוכר: bibi', 'הצעה 1: תוספת לא מוכרת: tiktok']);
});

/* ── The prompt and the schema ─────────────── */

test('the free prompt: exactly as written, the same text every call; the schema strict and under the union limit', () => {
  const p = freeSystemPrompt();
  assert.equal(freeSystemPrompt(), p);
  assert.equal(shared.freeSystemPrompt(), p, 'the function\'s copy says the same');
  assert.match(p, /Do not map the deal onto a catalog package/);
  assert.match(p, /"none" when it says there is none/);
  assert.match(p, /at most 3/);
  assert.match(p, /before VAT unless the text says it includes VAT/);
  assert.match(p, /never second-guess what was written/);
  const walk = (s, path) => {
    if (s.anyOf) { s.anyOf.forEach((x, i) => walk(x, `${path}|${i}`)); return; }
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, path);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), path);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`);
    }
    if (s.type === 'array') walk(s.items, `${path}[]`);
  };
  walk(FREE_SCHEMA, '$');
  let unions = 0; const count = (o) => { if (o && typeof o === 'object') { if (o.anyOf) unions += 1; Object.values(o).forEach(count); } }; count(FREE_SCHEMA);
  assert.ok(unions <= 16, `${unions} union-typed parameters`);
  assert.deepEqual(buildRequest('x', 'free').output_config.format.schema, FREE_SCHEMA);
  assert.equal(buildRequest('x', 'free').system[0].text, p);
  assert.equal(buildRequest('x').system[0].text === p, false, 'the catalog mode is unchanged');
});

/* ── The function in free mode ─────────────── */

const RUNS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
function world(reply) {
  const w = { calls: [], inserts: [] };
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', ANTHROPIC_API_KEY: 'sk-ant-secret' };
  const createClient = (url, k, opts) => ({
    auth: { getUser: async () => ({ data: { user: opts?.global?.headers?.Authorization ? { id: 'u-ofir', email: 'ofir@x' } : null } }) },
    rpc: async (fn) => (fn === 'is_office' ? { data: true, error: null } : { data: null, error: { message: 'no' } }),
    from: (t) => ({
      select: () => ({ eq: () => ({ gte: async () => ({ count: 0, error: null }) }) }),
      insert: (row) => ({ select: () => ({ single: async () => { w.inserts.push({ t, row }); return { data: { id: RUNS[w.inserts.length - 1] }, error: null }; } }) }),
    }),
  });
  const makeClient = () => ({ beta: { messages: { create: async (params) => { w.calls.push(params); return reply; } } } });
  w.handle = makeHandler({ env: (k) => env[k], serviceKey: () => 's', createClient, makeClient, Errors: {}, log: () => {} });
  return w;
}
const post = (body) => new Request('https://db.example/functions/v1/contract-ai', { method: 'POST', headers: { Authorization: 'Bearer t', origin: 'https://app.astrateg.tech', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const reply = (obj) => ({ id: 'm', model: MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] });

test('the function, free mode: the free instructions and schema, the checked drafts, one run for each', async () => {
  const two = answer([draft({ docType: 'quote', influencer: 'none', monthlyPrice: 490000 }), draft({ docType: 'agreement', influencer: 'natali', monthlyPrice: 650000 })]);
  const w = world(reply(two));
  const res = await w.handle(post({ text: OFIR, mode: 'free' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(w.calls[0], buildRequest(OFIR, 'free'));
  assert.equal(w.calls[0].model, 'claude-sonnet-5-5', 'the same model and settings');
  assert.equal(body.mode, 'free');
  assert.deepEqual(body.runIds, RUNS);
  assert.equal(body.runId, RUNS[0]);
  assert.deepEqual(body.result, validateFreeResult(two).result);
  assert.equal(w.inserts.length, 2);
  assert.deepEqual(w.inserts.map((x) => [x.t, x.row.status, x.row.result.mode, x.row.result.draft, x.row.result.of, x.row.deal_text]), [['contract_ai_runs', 'ok', 'free', 1, 2, OFIR], ['contract_ai_runs', 'ok', 'free', 2, 2, OFIR]]);
  // An unknown mode is refused before anything is sent; no mode is the catalog mode, as before.
  const bad = world(reply(two));
  assert.equal((await bad.handle(post({ text: OFIR, mode: 'wild' }))).status, 400);
  assert.equal(bad.calls.length, 0);
  const cat = world(reply({}));
  await cat.handle(post({ text: OFIR }));
  assert.deepEqual(cat.calls[0], buildRequest(OFIR));
});

/* ── Stav's free deal (deal.html) ──────────── */

test('Stav writes what he closed and picks חוזה or הצעת מחיר; Irit\'s builder opens with it in the AI box, free mode on', () => {
  const form = { kind: 'free', doc_type: 'quote', business_name: 'שטיחי רות', contact_name: 'רות', phone: '050-1234567', text: '  בלי משפיען 4,900 בחודש\r\nצילום כל חודש 8 תכנים  ' };
  const v = validateDeal(form);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.row, { business_name: 'שטיחי רות', contact_name: 'רות', phone: '050-1234567', notes: null, doc_type: 'quote', tier: null, influencer: null, paid: [], free: {}, discount_agorot: 0, custom: { text: 'בלי משפיען 4,900 בחודש\nצילום כל חודש 8 תכנים' } });
  const d = { ...v.row, id: 'd1', status: 'pending' };
  assert.equal(isFreeDeal(d), true);
  assert.equal(docTypeOf(d), 'quote');
  assert.equal(contractTitle(d), 'להכין הצעת מחיר ל־שטיחי רות');
  assert.equal(contractTitle({ ...d, doc_type: 'agreement' }), 'להכין חוזה ל־שטיחי רות');
  assert.equal(contractTitle({ business_name: 'x' }), 'להכין חוזה ל־x', 'a deal from before is an agreement');
  assert.equal(dealSummary(d), 'הצעת מחיר · בלי משפיען 4,900 בחודש צילום כל חודש 8 תכנים');
  const pre = prefillFromDeal(d);
  assert.deepEqual(pre.selection, { ...emptySelection(), docType: 'quote' });
  assert.deepEqual(pre.ai, { text: 'בלי משפיען 4,900 בחודש\nצילום כל חודש 8 תכנים', free: true });
  assert.deepEqual(pre.client, { 'c-name': 'רות', 'c-company': 'שטיחי רות', 'c-companyid': '', 'c-address': '', 'c-phone': '050-1234567', 'c-notes': '' });
  assert.equal(prefillFromDeal({ ...d, doc_type: 'agreement' }).selection.docType, 'agreement');
  // The two choices, and the words of the button.
  assert.deepEqual([submitText('agreement'), submitText('quote'), submitText(null)], ['לעירית ולאופיר להכנת חוזה', 'לעירית ולאופיר להכנת הצעת מחיר', 'לעירית ולאופיר']);
  const bad = (patch, field) => { const r = validateDeal({ ...form, ...patch }); assert.equal(r.ok, false); assert.ok(r.errors[field], JSON.stringify(r.errors)); };
  bad({ doc_type: '' }, 'doc_type');
  bad({ doc_type: 'contract' }, 'doc_type');
  bad({ text: '   ' }, 'text');
  bad({ text: 'א'.repeat(2001) }, 'text');
  // A package from the list carries the choice too.
  const pkg = validateDeal({ doc_type: 'quote', business_name: 'x', contact_name: 'y', phone: '050-7654321', tier: 'social', influencer: 'natali', discount: 0 });
  assert.equal(pkg.row.doc_type, 'quote');
  assert.equal(prefillFromDeal({ ...pkg.row }).selection.docType, 'quote');
});

test('no amount written at all: 36 videos and 36 graphics, as the package (the owner, 29.10.2026: "את אותה כמות תכנים שיש 72, 36 ו־36")', () => {
  const { applied } = run(answer([draft({ influencer: 'none', monthlyPrice: 490000 })]));
  const a = applied[0];
  assert.deepEqual(a.selection.custom.qty, { videos: 36, graphics: 36 });
  assert.ok(a.summary.includes('לא נכתבה כמות, ולכן כמו בחבילה: 36 סרטונים ו־36 גרפיקות'), a.summary.join(' | '));
  // A written amount is the amount ("אלא אם כן רושמים כמות אחרת").
  const b = run(answer([draft({ influencer: 'none', monthlyPrice: 490000, quantities: [{ key: 'videos', value: 20 }, { key: 'graphics', value: 12 }] })])).applied[0];
  assert.deepEqual(b.selection.custom.qty, { videos: 20, graphics: 12 });
});
