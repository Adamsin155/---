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

test('coverage: every package x every eligible paid combination = 34', () => {
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
  assert.equal(count, 34);
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
    assert.equal(s.shootDays, find(pkg, /(יום|ימי) צילום.*(סמיון|נטלי)/), `${id} shootDays`);
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
  const a = buildQuoteModel({ ...sel('social-tv', 'natali', ['photographer']), docType: 'agreement' }, { name: 'x', companyId: '514729938' });
  assert.equal(a.signable, true);
  assert.equal(a.client.companyId, '514729938');
  assert.equal(a.legal.length, 7);
  assert.match(a.legal[1].items[0], /6,900 ₪ לחודש \+ מע״מ כחוק, למשך 12 חודשים \(סה״כ 82,800 ₪ \+ מע״מ\)/);
  assert.match(a.legal[1].items[0], /והתוספות שנבחרו/);
  const b = buildQuoteModel({ ...sel('social', 'simeon'), docType: 'agreement' }, { name: 'x' });
  assert.doesNotMatch(b.legal[1].items[0], /התוספות/);
  assert.throws(() => validateSelection({ ...sel('social', 'simeon'), docType: 'contract' }));
});
