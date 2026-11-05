// "משפיען לבחירה" (the owner, 5.11.2026; the old system's "ALL IN ONE · משפיען לבחירה מרשימת
// המשפיענים של אסטרטג"): the client signs now and the influencer is chosen later, with the
// business (app/catalog.js INFLUENCERS.choice; docs/ops.md, section 98).
//   - Natali's packages and quantities, the shoot day said as one still to be chosen;
//   - no add-on at an influencer (nobody is chosen yet), the monthly photographer is;
//   - the document's head and the agreement say the same, never a name;
//   - Stav's deal, the AI's free mode and the card ("משפיען: עוד לא נבחר").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INFLUENCERS, PACKAGES, SPECS, PAID_ADDONS, infLabel } from '../app/catalog.js';
import { emptySelection, buildQuoteModel, paidAddonAvailable, freeAddonAvailable, computeTotals, normalizeSelection, validateSelection } from '../app/pricing.js';
import { validateDeal, dealSummary, prefillFromDeal } from '../app/deal-logic.js';
import { validateFreeResult, applyFreeDraft, freeCatalogText } from '../app/contract-ai-logic.js';
import { influencerToChoose, shootTypeOf, packageName } from '../app/client-open.js';
import { packageDeliverables } from '../app/protocol-logic.js';

const WORDS = 'משפיען מרשימת המשפיענים של אסטרטג שייבחר בתיאום עם בית העסק';
const sel = (tier = 'social', paid = []) => ({ ...emptySelection(), docType: 'agreement', tier, influencer: 'choice', paid });

test('the choice: its name, its button, no shoot type', () => {
  assert.equal(INFLUENCERS.choice.name, 'משפיען לבחירה מרשימת המשפיענים של אסטרטג');
  assert.equal(infLabel('choice'), 'משפיען לבחירה');
  assert.equal(infLabel('natali'), 'נטלי דדון');
  assert.equal(shootTypeOf('social-choice'), null);
  assert.equal(packageName('social-choice'), 'Social all in one · משפיען לבחירה מרשימת המשפיענים של אסטרטג');
});

test('Natali\'s packages: the same price and quantities, the day said as one to be chosen', () => {
  for (const tier of ['podcast', 'social', 'social-tv']) {
    const p = PACKAGES[`${tier}-choice`];
    const n = PACKAGES[`${tier}-natali`];
    assert.equal(p.price, n.price, tier);
    assert.deepEqual(p.includes.map((l) => l.qty), n.includes.map((l) => l.qty), tier);
    assert.deepEqual(SPECS[`${tier}-choice`], SPECS[`${tier}-natali`], tier);
    assert.ok(!p.includes.some((l) => l.label.includes('נטלי')), tier);
  }
  assert.equal(PACKAGES['social-choice'].includes[0].label, `יום צילום בבית העסק, עם ${WORDS}`);
  assert.equal(PACKAGES['social-choice'].price, 390000);
  // The owner's example: 1 shoot day, 36 videos, 36 graphics, 2 photographers, no collab.
  assert.deepEqual(packageDeliverables({ package: { id: 'social-choice' }, selection: { paid: [], free: {} } }),
    packageDeliverables({ package: { id: 'social-natali' }, selection: { paid: [], free: {} } }));
  assert.equal(SPECS['social-choice'].collabs, 0);
});

test('no add-on at an influencer; the monthly photographer and the free graphics are', () => {
  const s = sel();
  assert.deepEqual(PAID_ADDONS.filter((a) => paidAddonAvailable(a, s)).map((a) => a.id), ['photographer']);
  assert.equal(freeAddonAvailable('simeonJoin', s), false);
  assert.equal(freeAddonAvailable('simeonStories', s), false);
  assert.equal(freeAddonAvailable('graphics', s), true);
  assert.throws(() => validateSelection(normalizeSelection(sel('social', ['natali-reel']))));
  assert.equal(computeTotals(normalizeSelection(sel('social', ['photographer']))).monthlyNet, 590000);
});

test('the document: its head and the agreement say "to be chosen", never a name', () => {
  const m = buildQuoteModel(sel(), { name: 'רונית', companyId: '514729938' });
  assert.equal(m.package.influencer, 'משפיען לבחירה מרשימת המשפיענים של אסטרטג');
  assert.equal(`${m.package.tierName} · ${m.package.influencer}`, 'Social all in one · משפיען לבחירה מרשימת המשפיענים של אסטרטג');
  const text = m.legal.flatMap((s) => s.items).join('\n');
  assert.match(text, new RegExp(`בהשתתפות ${WORDS}`));
  assert.ok(!/נטלי|סמיון|נירו|הצל \(/.test(text), 'no influencer named');
  // A custom contract (every contract since 1.11.2026) keeps the line as the package says it.
  const custom = buildQuoteModel({ ...sel(), custom: { qty: { videos: 40 } } }, { name: 'רונית' });
  assert.equal(custom.package.includes[0].label, `יום צילום בבית העסק, עם ${WORDS}`);
  assert.ok(custom.package.includes.some((l) => l.qty === 40 && l.label === 'סרטונים בבית העסק'));
});

test('Stav\'s deal: "משפיען לבחירה" goes to Irit and Ofir and opens the builder with it', () => {
  const r = validateDeal({ business_name: 'פיצה רון', contact_name: 'רון', phone: '050-7654321', tier: 'social', influencer: 'choice' });
  assert.equal(r.ok, true);
  assert.equal(r.row.influencer, 'choice');
  assert.match(dealSummary(r.row), /^Social · משפיען לבחירה/);
  assert.equal(prefillFromDeal(r.row).selection.influencer, 'choice');
});

test('the AI\'s free mode knows it, and a draft with it builds the package', () => {
  assert.match(freeCatalogText(), /`choice`: משפיען לבחירה מרשימת המשפיענים של אסטרטג \(when the text says the influencer is not chosen yet/);
  const draft = {
    title: '', docType: 'agreement', influencer: 'choice', tier: 'social', monthlyPrice: null, priceIncludesVat: false, monthlyShoot: false, monthlyContents: null,
    quantities: [], addons: [], months: null, extraLines: [], specialClauses: [], discount: null,
    client: { name: '', company: '', companyId: '', phone: '', email: '' },
  };
  const { result } = validateFreeResult({ drafts: [draft], questions: [], notes: null });
  const { selection, summary } = applyFreeDraft({ ...emptySelection(), docType: 'agreement' }, result.drafts[0]);
  assert.equal(selection.influencer, 'choice');
  assert.ok(summary.some((s) => s.includes('משפיען לבחירה')));
});

test('the card: "משפיען: עוד לא נבחר" until the shoot day\'s influencer is set', () => {
  const c = { package_name: packageName('social-choice'), shoot_type: null };
  assert.equal(influencerToChoose(c), true);
  assert.equal(influencerToChoose({ ...c, shoot_type: 'niro' }), false);
  assert.equal(influencerToChoose({ ...c, shoot_crew: 'eli' }), false, 'a solo day: nobody to choose');
  assert.equal(influencerToChoose({ package_name: packageName('social-natali'), shoot_type: null }), false);
  assert.equal(influencerToChoose(null), false);
});
