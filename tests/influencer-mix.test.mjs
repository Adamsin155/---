// Several influencers in one contract (the owner, 16.11.2026; docs/ops.md, section 135): "שיהיה אופציה
// לשנות הכל מבחינת חבילות מחיר משפיענים ימי צילום קולאב — הכל". selection.custom.alsoInfluencers adds
// influencers next to the contract's own one; custom.postsAt says at whom the collabs and the stories
// are. The real deal from sales: "מישל דניס סמיון והצל, איש סושיאל חודש בחודשו, 4,900 בחודש, 2 העלאות
// בקולאב בעמודים של מישל דניס וסמיון, וכל השאר רגיל". No call to Claude: the answer is a fake in the
// server's real shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  emptySelection, normalizeSelection, validateSelection, buildQuoteModel, exceptionOf, computeTotals,
} from '../app/pricing.js';
import { contractInfluencers, shownInfluencerText, infPlain, MAX_ALSO_INFLUENCERS } from '../app/catalog.js';
import { packageDeliverables } from '../app/protocol-logic.js';
import { FREE_SCHEMA, freeSystemPrompt, validateFreeResult, applyFreeDraft, aiMarksOf } from '../app/contract-ai-logic.js';
import { draftOf, checkDraftInput } from '../app/mcp-draft.js';
import { makeHandler, MODEL } from '../supabase/functions/contract-ai/handler.js';
import { editsQuote } from '../supabase/functions/create-quote/http.js';
import * as shared from '../supabase/functions/_shared/app/pricing.js';

const base = { ...emptySelection(), docType: 'agreement', tier: 'social', influencer: 'simeon' };
const SALE = { ...base, custom: { price: 490000, termMonths: 1, alsoInfluencers: ['hatzel'], postsAt: { simeon: { collabs: 2 }, hatzel: { collabs: 0 } } } };
const refused = (custom, re, sel = base) => assert.throws(() => validateSelection({ ...sel, custom }), re, JSON.stringify(custom));

test('the sale of 16.11: Social with סמיון, מישל ודניס + הצל, 4,900 ₪, month to month, 2 collabs at Simeon only', () => {
  validateSelection(SALE);
  const sel = normalizeSelection(SALE);
  // Hatzel's 0 is no deviation: the 2 collabs are simply the package's collabs, all at its influencer.
  assert.deepEqual(sel.custom, { alsoInfluencers: ['hatzel'], qty: { collabs: 2 }, price: 490000, termMonths: 1 });
  assert.deepEqual(normalizeSelection(sel), sel, 'idempotent');
  validateSelection(sel);
  assert.equal(shared.normalizeSelection(SALE).custom.alsoInfluencers[0], 'hatzel', 'the server\'s copy agrees');
  // Not the managers' only: any office user adds influencers (the price and influencerName stay the managers').
  assert.equal(editsQuote({ ...base, custom: { alsoInfluencers: ['hatzel'], postsAt: { simeon: { collabs: 2 } } } }), false);
  for (const docType of ['quote', 'agreement']) {
    const m = buildQuoteModel({ ...sel, docType }, { name: 'לקוח', company: 'עסק' });
    assert.equal(m.package.tierName, 'Social all in one');
    assert.equal(m.package.influencer, 'סמיון, מישל ודניס', 'the office\'s lists keep the package\'s influencer');
    assert.equal(m.package.shownInfluencer, 'סמיון, מישל ודניס + הצל');
    assert.equal(m.wording.cover.title, docType === 'quote' ? 'הצעת מחיר סמיון, מישל ודניס + הצל' : 'הסכם התקשרות');
    assert.deepEqual(m.package.includes, [
      { qty: 1, label: 'יום צילום בבית העסק עם סמיון, מישל ודניס + הצל' },
      { qty: null, label: 'ניהול רשתות חברתיות' },
      { qty: null, label: 'ניהול קמפיינים ממומנים ברשתות' },
      { qty: 25, label: 'סרטונים בבית העסק' },
      { qty: 35, label: 'גרפיקות' },
      { qty: 2, label: 'צלמים לווידאו וסטילס בבית העסק' },
      { qty: 2, label: 'קולאבים באינסטגרם אצל סמיון, מישל ודניס' },
    ]);
    assert.equal(m.termMonths, 1);
    assert.equal(m.totals.monthlyNet, 490000);
    assert.equal(m.totals.termNet, 490000);
    assert.deepEqual(m.totals, computeTotals(sel));
    // The words of the document: the shoot day with both, in the plural.
    const content = m.wording.package.groups[0].items;
    assert.equal(content[0], 'יום צילום מקצועי ומרוכז עם סמיון, מישל ודניס + הצל');
    assert.equal(content[1], 'משפיעני רשת מובילים בישראל');
    assert.equal(content[2], 'ביום הצילום יופקו 60 תכנים חדשים שסמיון, מישל ודניס + הצל ישתתפו בהם');
    assert.ok(content.includes('2 קולאבים באינסטגרם אצל סמיון, מישל ודניס'), 'the collabs stay at Simeon');
    assert.ok(!content.some((l) => /קולאב.*הצל/.test(l)), 'no collab at Hatzel');
    assert.equal(m.wording.details.groups[1].items[0], 'התחייבות ל-חודש אחד');
  }
  const a = buildQuoteModel(sel, { name: 'x' });
  assert.ok(a.legal.some((s) => s.items.some((i) => i.includes('חודש אחד'))));
  assert.deepEqual(exceptionOf(sel).map((x) => x.text), ['2 קולאבים באינסטגרם במקום 1', 'מחיר חודשי 4,900 ₪ במקום 3,900 ₪', 'תקופה חודש אחד במקום 12', 'משפיענים נוספים: הצל']);
  // The system's counts (the client's deliverables) and the shoot type stay the package's.
  assert.equal(packageDeliverables(a).collabs, 2);
  assert.equal(packageDeliverables(a).shoot_days, 1);
});

test('collabs and stories at each influencer: one line each, the quantities are their sums', () => {
  const sel = normalizeSelection({ ...base, tier: 'social-tv', custom: { alsoInfluencers: ['hatzel', 'niro'], postsAt: { simeon: { collabs: 2, stories: 0 }, hatzel: { collabs: 1, stories: 2 }, niro: { stories: 1 } } } });
  assert.deepEqual(sel.custom, {
    alsoInfluencers: ['hatzel', 'niro'],
    postsAt: { simeon: { collabs: 2 }, hatzel: { collabs: 1, stories: 2 }, niro: { stories: 1 } },
  }, 'the sums (3 collabs, 3 stories) are the package\'s own: no quantity of their own');
  const m = buildQuoteModel(sel, {});
  const lines = m.package.includes.map((i) => (i.qty === null ? i.label : `${i.qty} ${i.label}`));
  assert.deepEqual(lines.filter((l) => /קולאב|סטורי/.test(l)), [
    '2 קולאבים באינסטגרם אצל סמיון, מישל ודניס',
    '1 קולאב באינסטגרם אצל הצל',
    '2 סטורי אצל הצל',
    '1 סטורי אצל נירו לוי',
  ]);
  assert.equal(lines[0], '2 ימי צילום בבית העסק עם סמיון, מישל ודניס + הצל + נירו לוי');
  assert.equal(m.package.shownInfluencer, 'סמיון, מישל ודניס + הצל + נירו לוי');
  const ex = exceptionOf(sel).map((x) => x.text);
  assert.ok(ex.includes('משפיענים נוספים: הצל + נירו לוי'));
  assert.ok(ex.includes('קולאבים לפי משפיען: 2 אצל סמיון, מישל ודניס · 1 אצל הצל'));
  assert.ok(ex.includes('סטורי לפי משפיען: 2 אצל הצל · 1 אצל נירו לוי'));
  const d = packageDeliverables(buildQuoteModel({ ...sel, docType: 'agreement' }, { name: 'x' }));
  assert.equal(d.collabs, 3);
  assert.equal(d.stories, 3);
});

test('a name typed by a manager wins over the joined names, everywhere but the collab lines', () => {
  const sel = normalizeSelection({ ...SALE, custom: { ...SALE.custom, influencerName: 'הצל והחבר׳ה' } });
  assert.equal(sel.custom.influencerName, 'הצל והחבר׳ה');
  assert.equal(editsQuote(sel), true, 'the name is the managers\'');
  const m = buildQuoteModel({ ...sel, docType: 'quote' }, {});
  assert.equal(m.wording.cover.title, 'הצעת מחיר הצל והחבר׳ה');
  assert.equal(m.package.shownInfluencer, 'הצל והחבר׳ה');
  assert.equal(m.package.includes[0].label, 'יום צילום בבית העסק עם הצל והחבר׳ה');
  assert.equal(m.package.includes.at(-1).label, 'קולאבים באינסטגרם אצל סמיון, מישל ודניס');
  // The joined name typed again is no deviation.
  assert.equal(normalizeSelection({ ...SALE, custom: { ...SALE.custom, influencerName: ' סמיון, מישל ודניס  + הצל ' } }).custom.influencerName, undefined);
});

test('defaults dropped, the contract\'s own influencer dropped, "בלי משפיענים" and "משפיען לבחירה" clear it', () => {
  assert.equal(normalizeSelection({ ...base, custom: { alsoInfluencers: [] } }).custom, undefined);
  assert.equal(normalizeSelection({ ...base, custom: { alsoInfluencers: ['simeon'] } }).custom, undefined, 'the contract\'s own influencer');
  assert.equal(normalizeSelection({ ...base, custom: { postsAt: { simeon: { collabs: 1 } } } }).custom, undefined, 'the package\'s own collab at its own influencer');
  assert.deepEqual(normalizeSelection({ ...base, custom: { postsAt: { simeon: { collabs: 4 } } } }).custom, { qty: { collabs: 4 } }, 'one influencer: plain quantities');
  assert.deepEqual(normalizeSelection({ ...base, custom: { alsoInfluencers: ['hatzel', 'simeon'] } }).custom, { alsoInfluencers: ['hatzel'] });
  validateSelection({ ...base, custom: { alsoInfluencers: ['hatzel', 'simeon'] } });
  const none = normalizeSelection({ ...base, custom: { noInfluencer: true, alsoInfluencers: ['hatzel'], postsAt: { hatzel: { collabs: 2 } }, influencerName: 'הצל' } });
  assert.deepEqual(none.custom, { noInfluencer: true, qty: { shootDays: 0, collabs: 0 } });
  const nm = buildQuoteModel(none, {});
  assert.equal(nm.package.shownInfluencer, undefined);
  assert.doesNotMatch(JSON.stringify(nm.package), /הצל/);
  const choice = { ...base, influencer: 'choice' };
  assert.equal(normalizeSelection({ ...choice, custom: { alsoInfluencers: ['hatzel'] } }).custom, undefined);
  refused({ alsoInfluencers: ['hatzel'] }, /custom also influencers need a named influencer/, choice);
  assert.deepEqual(contractInfluencers({ ...base, custom: { alsoInfluencers: ['natali', 'natali', 'choice', 'x'] } }), ['simeon', 'natali']);
  assert.equal(shownInfluencerText(base), 'סמיון, מישל ודניס');
  assert.equal(infPlain('hatzel'), 'הצל');
  // A regular contract is exactly as before (no custom, no new key anywhere).
  const plain = buildQuoteModel(base, { name: 'x' });
  assert.equal(plain.package.shownInfluencer, undefined);
  assert.equal(plain.custom, undefined);
});

test('bad inputs are refused, with words for the builder', () => {
  refused({ alsoInfluencers: 'hatzel' }, /custom also influencers: at most 4/);
  refused({ alsoInfluencers: ['natali', 'niro', 'hatzel', 'arik', 'simeon'] }, /at most 4/);
  assert.equal(MAX_ALSO_INFLUENCERS, 4);
  refused({ alsoInfluencers: ['choice'] }, /custom also influencer unknown: choice/);
  refused({ alsoInfluencers: ['nobody'] }, /custom also influencer unknown: nobody/);
  refused({ alsoInfluencers: ['hatzel', 'hatzel'] }, /custom also influencers repeat/);
  refused({ postsAt: [] }, /custom posts per influencer must be an object/);
  refused({ postsAt: { hatzel: { collabs: 1 } } }, /custom posts per influencer: not in the contract: hatzel/);
  refused({ alsoInfluencers: ['hatzel'], postsAt: { hatzel: { reels: 1 } } }, /custom posts per influencer are malformed/);
  refused({ alsoInfluencers: ['hatzel'], postsAt: { hatzel: { collabs: -1 } } }, /custom posts per influencer out of range: collabs/);
  refused({ alsoInfluencers: ['hatzel'], postsAt: { hatzel: { stories: 1.5 } } }, /out of range: stories/);
  // The sum too stays within the 24 collabs.
  refused({ alsoInfluencers: ['hatzel'], postsAt: { simeon: { collabs: 20 }, hatzel: { collabs: 5 } } }, /out of range: collabs/);
  refused({ alsoInfluencers: ['hatzel'], postsAt: { hatzel: '2' } }, /malformed/);
  // Each refusal has its Hebrew words in the builder (explainError in app/supa.js).
  const src = readFileSync(new URL('../app/supa.js', import.meta.url), 'utf8');
  const res = [...src.matchAll(/if \(\/(.+?)\/i\.test\(msg\)\) return '([^']+)'/g)].map((x) => [new RegExp(x[1], 'i'), x[2]]);
  for (const msg of ['custom also influencers: at most 4', 'custom also influencer unknown: x', 'custom also influencers repeat', 'custom also influencers need a named influencer']) {
    assert.match(res.find(([re]) => re.test(msg))?.[1] || '', /המשפיענים הנוספים/, msg);
  }
  for (const msg of ['custom posts per influencer out of range: collabs', 'custom posts per influencer: not in the contract: x', 'custom posts per influencer are malformed']) {
    assert.match(res.find(([re]) => re.test(msg))?.[1] || '', /לפי משפיען/, msg);
  }
});

/* ── "בדיוק כמו שכתבתי": the AI's free mode ── */

const TEXT = 'מישל דניס סמיון והצל, איש סושיאל חודש בחודשו, 4,900 בחודש, 2 העלאות בקולאב בעמודים של מישל דניס וסמיון, וכל השאר רגיל';
// One draft as structured outputs returns it: every key, null where the text says nothing.
const draft = (o = {}) => ({
  title: '', docType: null, influencer: null, simeonJoin: false, alsoInfluencers: [], influencerName: null, postsAt: [],
  tier: null, monthlyPrice: null, priceIncludesVat: false, monthlyShoot: false, monthlyContents: null,
  quantities: [], addons: [], months: null, extraLines: [], specialClauses: [], discount: null,
  client: { name: '', company: '', companyId: '', phone: '', email: '' }, ...o,
});
const SALE_DRAFT = draft({
  title: 'סמיון והצל 4,900', influencer: 'simeon', alsoInfluencers: ['hatzel'], tier: 'social', monthlyPrice: 490000, months: 1,
  postsAt: [{ influencer: 'simeon', collabs: 2, stories: null }],
});
const toSend = (sel) => {
  const { custom, edit, ...rest } = sel;
  return normalizeSelection({ ...rest, discount: 0, custom: { ...custom, discount: rest.discount || 0, ...(edit?.inf ? { influencerName: edit.inf } : {}) } });
};

test('the free mode knows several influencers: the prompt, the strict schema under the API\'s limits', () => {
  const p = freeSystemPrompt();
  assert.match(p, /alsoInfluencers/);
  assert.match(p, /postsAt/);
  assert.match(p, /influencerName/);
  assert.match(p, /"מישל דניס סמיון והצל" is influencer "simeon" and alsoInfluencers \["hatzel"\]/);
  assert.match(p, /"חודש בחודשו" or "חודש לחודש" is 1/);
  assert.match(p, /simeonJoin/, 'Natali with Semyon stays simeonJoin');
  const item = FREE_SCHEMA.properties.drafts.items;
  assert.deepEqual(item.properties.alsoInfluencers.items.enum, ['natali', 'simeon', 'niro', 'hatzel', 'arik']);
  assert.deepEqual(Object.keys(item.properties.postsAt.items.properties), ['influencer', 'collabs', 'stories']);
  assert.ok(item.required.includes('postsAt') && item.required.includes('alsoInfluencers') && item.required.includes('influencerName'));
  let unions = 0; const count = (o) => { if (o && typeof o === 'object') { if (o.anyOf) unions += 1; Object.values(o).forEach(count); } }; count(FREE_SCHEMA);
  assert.ok(unions <= 16, `${unions} union-typed parameters`);
});

test('the sale through the contract-ai function (a fake of Claude in its real shape) and onto the builder', async () => {
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', ANTHROPIC_API_KEY: 'sk-ant-secret' };
  const createClient = (url, k, opts) => ({
    auth: { getUser: async () => ({ data: { user: opts?.global?.headers?.Authorization ? { id: 'u', email: 'u@x' } : null } }) },
    rpc: async (fn) => (fn === 'is_office' ? { data: true, error: null } : { data: null, error: { message: 'no' } }),
    from: () => ({
      select: () => ({ eq: () => ({ gte: async () => ({ count: 0, error: null }) }) }),
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: '11111111-1111-4111-8111-111111111111' }, error: null }) }) }),
    }),
  });
  const answer = { drafts: [SALE_DRAFT], questions: [], notes: null };
  const makeClient = () => ({ beta: { messages: { create: async () => ({ id: 'm', model: MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] }) } } });
  const handle = makeHandler({ env: (k) => env[k], serviceKey: () => 's', createClient, makeClient, Errors: {}, log: () => {} });
  const res = await handle(new Request('https://db.example/functions/v1/contract-ai', { method: 'POST', headers: { Authorization: 'Bearer t', origin: 'https://app.astrateg.tech', 'content-type': 'application/json' }, body: JSON.stringify({ text: TEXT, mode: 'free' }) }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.dropped || [], []);
  // The builder checks it again (the function's checked form), then sets it.
  const { result, dropped } = validateFreeResult(body.result);
  assert.deepEqual(dropped, []);
  const d = result.drafts[0];
  assert.deepEqual([d.influencer, d.alsoInfluencers, d.influencerName, d.postsAt, d.months, d.monthlyPrice], ['simeon', ['hatzel'], null, { simeon: { collabs: 2 } }, 1, 490000]);
  const a = applyFreeDraft({ ...emptySelection(), docType: 'agreement' }, d);
  assert.deepEqual(a.skipped, []);
  // Videos and graphics not written stay as in the package, and say so (18.11.2026).
  assert.deepEqual(a.questions, ['סרטונים: לא נכתבו בטקסט, ולכן 25 כמו בחבילה. לבדוק.', 'גרפיקות: לא נכתבו בטקסט, ולכן 35 כמו בחבילה. לבדוק.']);
  assert.ok(a.summary.includes('משפיענים: סמיון, מישל ודניס + הצל (Social all in one, החבילה של סמיון, מישל ודניס)'), a.summary.join(' | '));
  assert.ok(a.summary.includes('קולאבים באינסטגרם: 2 אצל סמיון, מישל ודניס'), a.summary.join(' | '));
  assert.ok(a.summary.includes('תקופה: חודש אחד'));
  assert.deepEqual(a.selection.custom, { alsoInfluencers: ['hatzel'], postsAt: { simeon: { collabs: 2 } }, price: 490000, termMonths: 1 });
  // The "מולא אוטומטית" tags hold until the office changes the field.
  const live = aiMarksOf(a.selection, a.marks);
  assert.ok(live.has('also') && live.has('posts') && live.has('price') && live.has('term'));
  assert.equal(aiMarksOf({ ...a.selection, custom: { ...a.selection.custom, alsoInfluencers: [] } }, a.marks).has('also'), false);
  const sel = toSend(a.selection);
  validateSelection(sel);
  assert.deepEqual(sel.custom, normalizeSelection(SALE).custom);
  const m = buildQuoteModel({ ...sel, docType: 'quote' }, {});
  assert.equal(m.wording.cover.title, 'הצעת מחיר סמיון, מישל ודניס + הצל');
  assert.equal(m.totals.monthlyNet, 490000);
});

test('the free mode: a name in words, posts at an influencer not in the contract, unknown ones', () => {
  const { result, dropped } = validateFreeResult({ drafts: [draft({
    influencer: 'natali', alsoInfluencers: ['niro', 'choice', 'natali', 'niro'], influencerName: 'נטלי ונירו <b>',
    postsAt: [{ influencer: 'niro', collabs: 1, stories: null }, { influencer: 'hatzel', collabs: 2, stories: null }, { influencer: 'natali', collabs: 'x', stories: 99 }],
  })] });
  const d = result.drafts[0];
  assert.deepEqual(d.alsoInfluencers, ['niro']);
  assert.equal(d.influencerName, 'נטלי ונירו b');
  assert.deepEqual(d.postsAt, { niro: { collabs: 1 }, natali: { stories: 60 } });
  assert.deepEqual(dropped.map((x) => x.text), [
    'הצעה 1: משפיען נוסף לא מוכר: choice',
    'הצעה 1: קולאבים או סטורי אצל משפיען שלא בחוזה: הצל (יואב אליאסי)',
    'הצעה 1: קולאבים באינסטגרם אצל נטלי דדון: לא מספר',
    'הצעה 1: סטורי אצל המשפיענים אצל נטלי דדון: 99 מחוץ לטווח, הוזן 60',
  ]);
  const a = applyFreeDraft({ ...emptySelection() }, d);
  assert.deepEqual(a.selection.edit, { inf: 'נטלי ונירו b' }, 'the name goes to the managers\' field');
  const sel = toSend(a.selection);
  validateSelection(sel);
  assert.equal(buildQuoteModel(sel, {}).package.shownInfluencer, 'נטלי ונירו b');
  // The joined name written out is no name of its own; with no influencer, none of it.
  assert.equal(validateFreeResult({ drafts: [draft({ influencer: 'simeon', alsoInfluencers: ['hatzel'], influencerName: 'סמיון, מישל ודניס + הצל' })] }).result.drafts[0].influencerName, null);
  const none = validateFreeResult({ drafts: [draft({ influencer: 'none', alsoInfluencers: ['hatzel'], postsAt: [{ influencer: 'hatzel', collabs: 1, stories: null }] })] });
  assert.deepEqual(none.result.drafts[0].alsoInfluencers, []);
  assert.equal(none.dropped.length, 2);
});

test('a draft from a Claude account (#mcp-draft=) carries several influencers too', () => {
  const input = { mode: 'free', influencer: 'simeon', alsoInfluencers: ['hatzel'], monthlyPrice: 490000, months: 1, postsAt: [{ influencer: 'simeon', collabs: 2 }] };
  assert.ok(checkDraftInput(input).input);
  assert.equal(checkDraftInput({ ...input, postsAt: [{ influencer: 'simeon', reels: 2 }] }).error, 'unknown_field');
  assert.equal(checkDraftInput({ ...input, mode: 'catalog', package: 'social-simeon' }).error, 'field_of_other_mode');
  const d = draftOf(input);
  assert.equal(d.error, undefined, d.details);
  assert.equal(d.model.package.shownInfluencer, 'סמיון, מישל ודניס + הצל');
  assert.deepEqual(d.toSend.custom, normalizeSelection(SALE).custom);
});
