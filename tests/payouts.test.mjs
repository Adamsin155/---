// Payouts engine tests. All business values here are made up: the real ones
// live in the database and in private/ (not in the repository). The Excel
// acceptance case runs only when private/excel-case.json is present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  applyBp, allocate, monthBounds, inMonth, shiftMonth, settingsOn, packageExtras,
  computeDeal, computeMonth, commissionStatement,
} from '../app/payouts/engine.js';

const ils = (n) => Math.round(n * 100);

// Synthetic settings, deliberately round and unlike the real ones.
const S = () => ({
  payment: { realBp: 1000, commissionBp: 1000 },
  commissionPeople: [
    { id: 'a', name: 'מוכר א', rates: { simeon: 1000, natali: 2000 } },
    { id: 'b', name: 'מוכר ב', rates: { simeon: 500, natali: 500 } },
  ],
  items: {
    'natali-story': { real: ils(1000), commission: ils(1000), per: 'unit' },
    'natali-reel': { real: ils(400), commission: ils(400), per: 'unit' },
    'simeon-story': { real: 0, commission: 0, per: 'unit' },
    'simeon-collab': { real: 0, commission: 0, per: 'unit' },
    'simeon-day': { real: ils(500), commission: ils(500), per: 'unit' },
    'simeon-join': { real: null, commission: null, per: 'deal' },
    ch14: { real: ils(2000), commission: ils(2000), per: 'unit' },
    'photographer-monthly': { real: ils(10000), commission: ils(10000), per: 'unit' },
    graphics: { real: ils(300), commission: ils(300), per: 'deal' },
  },
  production: {
    'social-simeon': { influencer: ils(5000), photographer: ils(100), makeup: 0 },
    'social-tv-simeon': { influencer: ils(5000), photographer: ils(100), makeup: 0 },
    'social-natali': { influencer: ils(4000), photographer: ils(100), makeup: ils(50) },
    'social-tv-natali': { influencer: ils(4000), photographer: ils(100), makeup: ils(50) },
    'podcast-simeon': { influencer: ils(3000), photographer: ils(100), makeup: 0 },
    'podcast-natali': { influencerPerDay: ils(9000), clientsPerDay: 3, makeupPerDay: ils(70), photographer: ils(100), makeup: 0 },
  },
  payees: { influencer: { simeon: 'משפיען ס', natali: 'משפיענית נ' }, photographer: 'צלם', makeup: 'מאפרת' },
  employees: [{ id: 'e1', name: 'עובד', role: 'עורך', salary: ils(1000) }],
  expenses: [{ id: 'x1', name: 'פרסום', amount: ils(500) }],
  partners: [
    { id: 'p1', name: 'שותף 1', weight: 1 },
    { id: 'p2', name: 'שותף 2', weight: 1 },
    { id: 'p3', name: 'שותף 3', weight: 1 },
  ],
});
const V = (data = S(), from = '2026-01-01') => [{ effectiveFrom: from, data }];

let seq = 0;
const deal = (tier, influencer, opts = {}) => ({
  id: `d${++seq}`,
  date: opts.date || '2026-09-15',
  client: opts.client || `לקוח ${seq}`,
  selection: {
    tier, influencer,
    paid: opts.paid || [],
    free: { graphics: 0, simeonStories: 0, simeonJoin: false, extraCh14: false, ...(opts.free || {}) },
    discount: opts.discount || 0,
  },
  perks: opts.perks || [],
});
const commission = (line, id) => line.commissions.find((c) => c.personId === id).amount;

test('applyBp rounds half away from zero', () => {
  assert.equal(applyBp(1, 5000), 1);
  assert.equal(applyBp(-1, 5000), -1);
  assert.equal(applyBp(3, 3333), 1);
  assert.equal(applyBp(2145675, 1000), 214568);
  assert.equal(applyBp(-2145675, 1000), -214568);
});

test('allocate always sums to the total', () => {
  for (const total of [100, 101, 98765432, -1000001, 0]) {
    const parts = allocate(total, [1, 1, 1]);
    assert.equal(parts.reduce((s, p) => s + p, 0), total);
  }
  assert.deepEqual(allocate(1000000 * 2, [1, 1, 1, 1, 1, 1]), [333334, 333334, 333333, 333333, 333333, 333333]);
});

test('month bounds cover 28, 29, 30 and 31 day months', () => {
  assert.equal(monthBounds('2026-02').days, 28);
  assert.equal(monthBounds('2028-02').days, 29);
  assert.equal(monthBounds('2026-09').days, 30);
  assert.equal(monthBounds('2026-12').days, 31);
  assert.ok(inMonth('2028-02-29', '2028-02'));
  assert.ok(!inMonth('2028-03-01', '2028-02'));
  assert.ok(!inMonth('2026-08-31', '2026-09'));
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.throws(() => monthBounds('2026-13'));
});

test('base package: commission on value minus payment only', () => {
  const l = computeDeal(deal('social', 'natali'), S());
  assert.equal(l.value, ils(46800));
  assert.equal(l.paymentCommission, ils(4680));
  assert.equal(l.deductions, 0);
  assert.equal(l.base, ils(42120));
  assert.equal(commission(l, 'a'), ils(8424));
  assert.equal(commission(l, 'b'), ils(2106));
});

test('Social + TV extras over the base package are deducted', () => {
  assert.deepEqual(packageExtras('social-tv-natali').map((x) => [x.id, x.qty]), [['natali-story', 1], ['ch14', 1]]);
  assert.deepEqual(packageExtras('social-tv-simeon').map((x) => [x.id, x.qty]),
    [['simeon-day', 1], ['simeon-collab', 2], ['simeon-story', 3], ['ch14', 1]]);
  assert.deepEqual(packageExtras('social-simeon'), []);
  assert.deepEqual(packageExtras('podcast-natali'), []);
  const l = computeDeal(deal('social-tv', 'simeon'), S());
  assert.equal(l.value, ils(58800));
  assert.equal(l.deductions, ils(2500));
  assert.equal(l.base, ils(58800 - 5880 - 2500));
});

test('paid add-on: commission only on the margin over its cost', () => {
  const l = computeDeal(deal('social', 'simeon', { paid: ['photographer'] }), S());
  assert.equal(l.value, ils(70800));
  assert.equal(l.deductions, ils(10000));
  assert.equal(l.base, ils(70800 - 7080 - 10000));
});

test('perk and free benefits reduce the commission base for everyone', () => {
  const l = computeDeal(deal('social', 'natali', { perks: [{ id: 'natali-story', qty: 2 }], free: { graphics: 24, extraCh14: true } }), S());
  assert.equal(l.deductions, ils(2000 + 300 + 2000));
  assert.equal(l.base, ils(46800 - 4680 - 4300));
  assert.equal(commission(l, 'a'), applyBp(l.base, 2000));
  assert.equal(commission(l, 'b'), applyBp(l.base, 500));
  assert.throws(() => computeDeal(deal('social', 'natali', { perks: [{ id: 'nope', qty: 1 }] }), S()));
  assert.throws(() => computeDeal(deal('social', 'natali', { perks: [{ id: 'ch14', qty: 0 }] }), S()));
});

test('graphics cost is per deal, not per graphic', () => {
  const one = computeDeal(deal('social', 'natali', { free: { graphics: 1 } }), S());
  const max = computeDeal(deal('social', 'natali', { free: { graphics: 24 } }), S());
  assert.equal(one.deductions, max.deductions);
});

test('discount lowers the deal value for 12 months', () => {
  const l = computeDeal(deal('social', 'natali', { discount: 20000 }), S());
  assert.equal(l.value, ils((3900 - 200) * 12));
});

test('commission base never goes below zero', () => {
  const s = S();
  s.items.ch14 = { real: ils(100000), commission: ils(100000), per: 'unit' };
  const l = computeDeal(deal('social', 'natali', { free: { extraCh14: true } }), s);
  assert.equal(l.base, 0);
  assert.equal(commission(l, 'a'), 0);
});

test('missing cost is counted as 0 with a warning', () => {
  const r = computeMonth({ month: '2026-09', deals: [deal('social', 'natali', { free: { simeonJoin: true } })], versions: V() });
  assert.equal(r.lines[0].deductions, 0);
  assert.ok(r.warnings.some((w) => w.includes('צירוף סמיון')));
});

test('ineligible selection is reported, not silently computed', () => {
  const r = computeMonth({ month: '2026-09', deals: [deal('social', 'simeon', { paid: ['natali-story'] })], versions: V() });
  assert.equal(r.lines.length, 0);
  assert.equal(r.errors.length, 1);
});

test('two views: commission uses the shown deduction, profit uses the real cost', () => {
  const s = S();
  s.items.ch14 = { real: ils(1700), commission: ils(2700), per: 'unit' };
  s.payment = { realBp: 800, commissionBp: 1000 };
  const r = computeMonth({ month: '2026-09', deals: [deal('social', 'natali', { free: { extraCh14: true } })], versions: V(s) });
  const l = r.lines[0];
  assert.equal(l.base, ils(46800 - 4680 - 2700));
  assert.equal(l.itemsReal, ils(1700));
  assert.equal(l.paymentReal, ils(3744));
  const st = commissionStatement(r, 'a');
  assert.equal(st.rows[0].payment, ils(4680));
  assert.equal(st.rows[0].deductions[0].amount, ils(2700));
  const shown = JSON.stringify(st);
  for (const hidden of [ils(1700), ils(3744)]) assert.ok(!shown.includes(String(hidden)));
  assert.ok(!('contribution' in st.rows[0]) && !('itemsReal' in st.rows[0]));
  assert.equal(st.total, commission(l, 'a'));
});

test('podcast with Natali: shoot-day fee split between the month\'s deals', () => {
  const run = (n) => computeMonth({ month: '2026-09', deals: Array.from({ length: n }, () => deal('podcast', 'natali')), versions: V() });
  assert.deepEqual(run(2).lines.map((l) => l.production.influencer), [ils(4500), ils(4500)]);
  assert.ok(run(3).lines.every((l) => l.production.influencer === ils(3000)));
  const four = run(4);
  assert.equal(four.lines.reduce((s, l) => s + l.production.influencer, 0), ils(18000));
  assert.equal(four.lines[0].shootDays, 2);
  assert.equal(four.lines.reduce((s, l) => s + l.production.makeup, 0), ils(140), 'makeup once per shoot day');
  assert.ok(run(1).lines[0].production.makeup === ils(70));
  assert.ok(four.lines.every((l) => l.production.photographer === ils(100)), 'photographer stays per client');
  const other = computeMonth({ month: '2026-09', deals: [deal('podcast', 'natali'), deal('podcast', 'natali', { date: '2026-10-01' })], versions: V() });
  assert.equal(other.lines[0].production.influencer, ils(9000));
  const sim = computeDeal(deal('podcast', 'simeon'), S());
  assert.equal(sim.production.influencer, ils(3000));
  assert.equal(commission(sim, 'a'), applyBp(sim.base, 1000));
});

test('pooled fee uses the terms in effect for the month\'s latest deal', () => {
  const later = S();
  later.production['podcast-natali'] = { influencerPerDay: ils(6000), clientsPerDay: 3, makeupPerDay: ils(70), photographer: ils(100), makeup: 0 };
  const versions = [...V(), { effectiveFrom: '2026-09-20', data: later }];
  const r = computeMonth({ month: '2026-09', deals: [deal('podcast', 'natali', { date: '2026-09-05' }), deal('podcast', 'natali', { date: '2026-09-25' })], versions });
  assert.deepEqual(r.lines.map((l) => l.production.influencer), [ils(3000), ils(3000)]);
  const early = computeMonth({ month: '2026-09', deals: [deal('podcast', 'natali', { date: '2026-09-05' })], versions });
  assert.equal(early.lines[0].production.influencer, ils(9000));
  assert.ok(Number.isFinite(early.totals.profit));
  const broken = S();
  delete broken.production['podcast-natali'];
  const noTerms = computeMonth({ month: '2026-09', deals: [deal('podcast', 'natali')], versions: V(broken) });
  assert.ok(Number.isFinite(noTerms.totals.profit));
  assert.ok(noTerms.warnings.length > 0);
});

test('rate change applies from its effective date only', () => {
  const later = S();
  later.commissionPeople[0].rates.natali = 3000;
  later.employees[0].salary = ils(2000);
  const versions = [...V(), { effectiveFrom: '2026-09-16', data: later }];
  const r = computeMonth({
    month: '2026-09',
    deals: [deal('social', 'natali', { date: '2026-09-15' }), deal('social', 'natali', { date: '2026-09-16' })],
    versions,
  });
  assert.equal(r.lines[0].commissions[0].rateBp, 2000);
  assert.equal(r.lines[1].commissions[0].rateBp, 3000);
  assert.equal(r.totals.employees, ils(2000));
  const aug = computeMonth({ month: '2026-08', deals: [], versions });
  assert.equal(aug.totals.employees, ils(1000));
  assert.equal(settingsOn(versions, '2025-12-31'), null);
});

test('month totals reconcile: payouts + profit = revenue', () => {
  const r = computeMonth({
    month: '2026-09',
    deals: [
      deal('social-tv', 'natali', { paid: ['photographer', 'natali-reel'], free: { graphics: 10 } }),
      deal('social', 'simeon', { perks: [{ id: 'ch14', qty: 1 }], discount: 10000 }),
      deal('podcast', 'natali'),
      deal('social', 'natali', { date: '2026-08-31' }),
    ],
    incomes: [{ id: 'i1', date: '2026-09-30', label: 'שיקים', family: 'natali', amount: ils(12345.67) }],
    expenses: [{ id: 'o1', month: '2026-09', label: 'חד פעמי', payee: 'ספק', amount: ils(250) }],
    versions: V(),
  });
  assert.equal(r.counts.deals, 3);
  const t = r.totals;
  assert.equal(t.revenue, t.paymentReal + t.commissions + t.production + t.itemsReal + t.fixed + t.profit);
  const paid = r.payees.filter((p) => p.kind !== 'partner').reduce((s, p) => s + p.total, 0);
  assert.equal(paid + t.profit, t.revenue);
  assert.equal(r.payees.find((p) => p.kind === 'payment').total, t.paymentReal);
  assert.equal(r.partners.reduce((s, p) => s + p.amount, 0), t.profit);
  assert.equal(r.partners.reduce((s, p) => s + p.amountExcludingIncome, 0), t.profitExcludingIncome);
  for (const p of r.payees) assert.equal(p.total, p.lines.reduce((s, l) => s + l.amount, 0));
});

test('negative profit is split between partners too', () => {
  const s = S();
  s.expenses = [{ id: 'x', name: 'גדול', amount: ils(1000000) }];
  const r = computeMonth({ month: '2026-09', deals: [deal('social', 'natali')], versions: V(s) });
  assert.ok(r.totals.profit < 0);
  assert.equal(r.partners.reduce((a, p) => a + p.amount, 0), r.totals.profit);
});

test('partner weights: thirds are exact, bad weights are reported', () => {
  const r = computeMonth({ month: '2026-09', deals: [deal('social', 'natali')], versions: V() });
  const amounts = r.partners.map((p) => p.amount);
  assert.ok(Math.max(...amounts) - Math.min(...amounts) <= 1);
  assert.deepEqual(r.partners.map((p) => p.shareBp), [3333, 3333, 3333]);
  const s = S();
  s.partners[2].weight = -1;
  assert.ok(computeMonth({ month: '2026-09', deals: [], versions: V(s) }).errors.some((e) => e.includes('השותפים')));
  s.partners.forEach((p) => { p.weight = 0; });
  assert.ok(computeMonth({ month: '2026-09', deals: [], versions: V(s) }).errors.some((e) => e.includes('השותפים')));
});

// Owner's Excel ("רווח והפסד חודשי"), reproduced from local private data.
const excelPath = new URL('../private/excel-case.json', import.meta.url);
const settingsPath = new URL('../private/payouts-settings.json', import.meta.url);
test('Excel acceptance case', { skip: !existsSync(excelPath) && 'private/excel-case.json not present' }, () => {
  const xl = JSON.parse(readFileSync(excelPath, 'utf8'));
  const data = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const incomes = xl.income.map((x, i) => ({ id: `x${i}`, date: '2026-09-10', label: `x${i}`, ...x }));
  const expenses = xl.production.map((amount, i) => ({ id: `p${i}`, month: '2026-09', label: `p${i}`, amount }));
  const r = computeMonth({ month: '2026-09', incomes, expenses, versions: [{ effectiveFrom: '2026-01-01', data }] });
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
  near(r.totals.paymentReal, xl.expect.payment, 1, 'payment');
  for (const [id, amount] of Object.entries(xl.expect.commissions)) {
    const got = r.lines.reduce((s, l) => s + l.commissions.find((c) => c.personId === id).amount, 0);
    near(got, amount, 3, `commission ${id}`);
  }
  const fixed = r.totals.employees + r.totals.recurring;
  assert.equal(fixed, xl.expect.fixed);
  near(r.totals.paymentReal + r.totals.commissions + r.totals.oneOff, xl.expect.variable, 5, 'variable');
  near(r.totals.profit, xl.expect.profit, 5, 'profit');
  const future = r.lines.filter((l, i) => xl.income[i].future).reduce((s, l) => s + l.contribution, 0);
  near(r.totals.profit - future, xl.expect.profitExcludingFuture, 5, 'profit excluding future');
  for (const p of r.partners) near(p.amount * r.partners.length, xl.expect.profit, 5, `partner ${p.id}`);
});
