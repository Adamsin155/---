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
  payment: { realBp: 1000, commissionBp: 1000, checksRealBp: 300 },
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
  seller: opts.seller || '',
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
  assert.deepEqual(packageExtras('social-tv-natali').map((x) => [x.id, x.qty]), [['ch14', 1]]);
  assert.deepEqual(packageExtras('social-tv-simeon').map((x) => [x.id, x.qty]),
    [['simeon-day', 1], ['simeon-collab', 2], ['simeon-story', 3], ['ch14', 1]]);
  assert.deepEqual(packageExtras('social-simeon'), []);
  assert.deepEqual(packageExtras('podcast-natali'), []);
  const l = computeDeal(deal('social-tv', 'simeon'), S());
  assert.equal(l.value, ils(58800));
  assert.equal(l.deductions, ils(2500));
  assert.equal(l.base, ils(58800 - 5880 - 2500));
});

test('personal offer: total amount and family only', () => {
  const d = { id: 'c1', date: '2026-09-10', client: 'הצעה אישית', selection: { custom: true, influencer: 'natali', amount: ils(40000) }, perks: [] };
  const l = computeDeal(d, S());
  assert.equal(l.value, ils(40000));
  assert.equal(l.paymentCommission, ils(4000));
  assert.equal(l.deductions, 0);
  assert.equal(l.base, ils(36000));
  assert.equal(commission(l, 'a'), ils(7200), 'Natali rate');
  assert.deepEqual(l.production, { influencer: ils(4000), photographer: ils(100), makeup: ils(50) }, 'family Social production');
  assert.equal(l.packageName, 'הצעה אישית · נטלי דדון');
  const sim = computeDeal({ ...d, selection: { custom: true, influencer: 'simeon', amount: ils(40000) } }, S());
  assert.equal(commission(sim, 'a'), ils(3600), 'Simeon rate');
  assert.throws(() => computeDeal({ ...d, selection: { custom: true, influencer: 'x', amount: 1 } }, S()));
  assert.throws(() => computeDeal({ ...d, selection: { custom: true, influencer: 'natali', amount: 0 } }, S()));
  const cancel = computeMonth({ month: '2026-10', deals: [{ ...d, cancelledOn: '2026-10-05', paidMonths: 6 }], versions: V() });
  assert.equal(cancel.totals.revenue, -ils(20000));
});

test('salary that already includes employer cost gets no addition', () => {
  const s = S();
  s.employerCostBp = 3000;
  s.employees = [{ id: 'e1', name: 'כולל', role: 'x', salary: ils(1300), payroll: true, costIncluded: true }];
  const r = computeMonth({ month: '2026-09', versions: V(s) });
  assert.equal(r.totals.employees, ils(1300));
  assert.equal(r.totals.employerCost, 0);
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

test('employer cost is added for payroll employees only', () => {
  const s = S();
  s.employerCostBp = 2000;
  s.employees = [
    { id: 'e1', name: 'בתלוש', role: 'x', salary: ils(1000), payroll: true },
    { id: 'e2', name: 'בחשבונית', role: 'y', salary: ils(1000), payroll: false },
  ];
  const r = computeMonth({ month: '2026-09', versions: V(s) });
  assert.equal(r.totals.employees, ils(1200 + 1000));
  assert.equal(r.totals.employerCost, ils(200));
  const p = r.payees.find((x) => x.name === 'בתלוש');
  assert.deepEqual(p.lines.map((l) => l.amount), [ils(1000), ils(200)]);
});

test('per-deal closing fee goes to the person marked as the closer', () => {
  const s = S();
  s.perDealPeople = [{ id: 'c', name: 'סוגר', amount: ils(250) }];
  const r = computeMonth({
    month: '2026-09',
    deals: [deal('social', 'natali', { seller: 'סוגר' }), deal('social', 'natali', { seller: 'מוכר א' }), deal('social', 'simeon')],
    versions: V(s),
  });
  assert.equal(r.totals.closerFees, ils(250));
  assert.equal(r.payees.find((p) => p.name === 'סוגר').total, ils(250));
  assert.equal(r.lines[0].contribution, r.lines[1].contribution - ils(250), 'fee reduces the deal profit');
  assert.equal(commissionStatement(r, 'סוגר').total, ils(250));
  const t = r.totals;
  assert.equal(t.revenue, t.paymentReal + t.commissions + t.production + t.itemsReal + t.closerFees + t.fixed + t.profit);
});

test('cancellation claws back the unpaid share of every commission in the cancellation month', () => {
  const d = { ...deal('social', 'natali', { date: '2026-03-10' }), cancelledOn: '2026-09-12', paidMonths: 6 };
  const orig = computeDeal(d, S());
  const march = computeMonth({ month: '2026-03', deals: [d], versions: V() });
  assert.equal(march.counts.deals, 1);
  assert.equal(march.totals.clawbacks, 0);
  const sep = computeMonth({ month: '2026-09', deals: [d], versions: V() });
  assert.equal(sep.counts.deals, 0);
  assert.equal(sep.counts.cancellations, 1);
  const back = sep.lines[0].commissions;
  assert.equal(back[0].amount, -Math.round(commission(orig, 'a') / 2));
  assert.equal(back[1].amount, -Math.round(commission(orig, 'b') / 2));
  assert.equal(sep.totals.clawbacks, back[0].amount + back[1].amount);
  assert.equal(sep.totals.revenue, -ils(46800 / 2), 'unpaid half of the revenue is taken off');
  assert.equal(sep.totals.cancelledRevenue, -ils(23400));
  assert.equal(sep.totals.profit, sep.totals.revenue - sep.totals.clawbacks - sep.totals.fixed);
  const st = commissionStatement(sep, 'a');
  assert.equal(st.rows[0].kind, 'clawback');
  assert.equal(st.total, back[0].amount);
  const s = S();
  s.perDealPeople = [{ id: 'c', name: 'סוגר', amount: ils(300) }];
  const closed = computeMonth({ month: '2026-09', deals: [{ ...d, seller: 'סוגר', paidMonths: 4 }], versions: V(s) });
  assert.equal(closed.lines[0].closerFee.amount, -ils(200), 'closing fee: 8 of 12 months back');
  assert.equal(closed.totals.closerFees, -ils(200));
  const cst = commissionStatement(closed, 'סוגר');
  assert.ok(cst.rows[0].clawback && cst.total === -ils(200));
  const t = closed.totals;
  assert.equal(t.revenue, t.paymentReal + t.commissions + t.production + t.itemsReal + t.closerFees + t.fixed + t.profit);
  const none = computeMonth({ month: '2026-09', deals: [{ ...d, paidMonths: 12 }], versions: V() });
  assert.ok(none.lines[0].commissions.every((c) => c.amount === 0));
  const all = computeMonth({ month: '2026-09', deals: [{ ...d, paidMonths: 0 }], versions: V() });
  assert.equal(all.lines[0].commissions[0].amount, -commission(orig, 'a'));
});

test('monthly variable costs: fuel, depreciation, meetings at the set rate', () => {
  const s = S();
  s.meetingRate = ils(40);
  s.meetingPayee = 'מתאמת';
  const r = computeMonth({
    month: '2026-09',
    expenses: [
      { id: '1', month: '2026-09', kind: 'fuel', label: 'דלק', payee: 'עובד', amount: ils(320) },
      { id: '2', month: '2026-09', kind: 'depreciation', label: 'פחת רכב', payee: 'עובד', amount: ils(150) },
      { id: '3', month: '2026-09', kind: 'meetings', label: 'תיאום פגישות', payee: '', qty: 7, amount: 0 },
      { id: '4', month: '2026-08', kind: 'fuel', label: 'דלק', payee: 'עובד', amount: ils(999) },
    ],
    versions: V(s),
  });
  assert.equal(r.totals.oneOff, ils(320 + 150 + 280));
  assert.equal(r.payees.find((p) => p.name === 'מתאמת').total, ils(280));
  assert.equal(r.payees.find((p) => p.name === 'עובד').total, ils(1000 + 320 + 150), 'salary and month costs on one card');
  const st = commissionStatement(r, 'מתאמת');
  assert.equal(st.extras[0].amount, ils(280));
});

test('cheques: shown fee as with the processor, real cheque fee; up to 6 cheques books everything now', () => {
  const d = { ...deal('social', 'natali', { date: '2026-03-10' }), payMethod: 'checks', installments: 6 };
  const l = computeDeal(d, S());
  assert.equal(l.paymentCommission, ils(4680), 'commission earners see the processor fee');
  assert.equal(l.paymentReal, ils(1404), 'real cost is the cheque fee (3%)');
  assert.equal(l.base, ils(42120));
  assert.equal(l.value, ils(46800));
  assert.equal(commission(l, 'a'), ils(8424));
  const r = computeMonth({ month: '2026-03', deals: [d], versions: V() });
  assert.equal(r.payees.find((p) => p.kind === 'payment').name, 'עמלת צ׳קים');
  const noSetting = S();
  delete noSetting.payment.checksRealBp;
  assert.equal(computeDeal(d, noSetting).paymentReal, ils(4680), 'falls back to the processor fee');
  assert.equal(l.deferred, undefined);
  const sep = computeMonth({ month: '2026-09', deals: [d], versions: V() });
  assert.equal(sep.lines.length, 0, 'nothing deferred');
  assert.throws(() => computeDeal({ ...d, installments: 13 }, S()));
});

test('cheques: 12 cheques book half now and half six months later', () => {
  const d = { ...deal('social', 'natali', { date: '2026-03-10' }), payMethod: 'checks', installments: 12 };
  const mar = computeMonth({ month: '2026-03', deals: [d], versions: V() });
  assert.equal(mar.totals.revenue, ils(23400));
  assert.equal(mar.lines[0].commissions[0].amount, ils(4212), 'half of 8,424');
  assert.equal(mar.totals.paymentReal, ils(702), 'half of the cheque fee now');
  const sep = computeMonth({ month: '2026-09', deals: [d], versions: V() });
  assert.equal(sep.lines.length, 1);
  assert.equal(sep.lines[0].kind, 'deferred');
  assert.equal(sep.totals.revenue, ils(23400));
  assert.equal(sep.lines[0].commissions[0].amount, ils(4212));
  assert.equal(sep.totals.paymentReal, ils(702), 'rest of the cheque fee later');
  assert.equal(commissionStatement(sep, 'a').total, ils(4212));
  const t = sep.totals;
  assert.equal(t.revenue, t.paymentReal + t.commissions + t.production + t.itemsReal + t.closerFees + t.fixed + t.profit);
  const aug = computeMonth({ month: '2026-08', deals: [d], versions: V() });
  assert.equal(aug.lines.length, 0);
});

test('cheques: 7 cheques book 6/7 now and 1/7 later; parts add up exactly', () => {
  const d = { ...deal('social-tv', 'simeon', { date: '2026-01-31' }), payMethod: 'checks', installments: 7 };
  const now = computeMonth({ month: '2026-01', deals: [d], versions: V() }).lines[0];
  const later = computeMonth({ month: '2026-07', deals: [d], versions: V() }).lines[0];
  assert.equal(now.value + later.value, ils(58800));
  assert.equal(now.value, Math.round((ils(58800) * 6) / 7));
  for (let i = 0; i < now.commissions.length; i += 1) {
    assert.equal(now.commissions[i].amount + later.commissions[i].amount, now.full.commissions[i].amount);
  }
});

test('cheques: cancelled before the deferred month gives back only what was booked beyond the months paid', () => {
  const base = { ...deal('social', 'natali', { date: '2026-03-10' }), payMethod: 'checks', installments: 12 };
  const full = computeDeal(base, S()).full;
  // Cancelled after 4 months: half was booked, 4/12 was earned, so 2/12 comes back; nothing deferred later.
  const d = { ...base, cancelledOn: '2026-07-15', paidMonths: 4 };
  const jul = computeMonth({ month: '2026-07', deals: [d], versions: V() });
  assert.equal(jul.totals.revenue, -Math.round((full.value * 2) / 12));
  assert.equal(jul.lines[0].commissions[0].amount, -Math.round((full.commissions[0].amount * 2) / 12));
  assert.equal(computeMonth({ month: '2026-09', deals: [d], versions: V() }).lines.length, 0, 'deferred part dropped');
  // Cancelled after 8 months: all was booked, 8/12 earned, 4/12 comes back.
  const late = { ...base, cancelledOn: '2026-11-15', paidMonths: 8 };
  const nov = computeMonth({ month: '2026-11', deals: [late], versions: V() });
  assert.equal(nov.lines[0].commissions[0].amount, -Math.round((full.commissions[0].amount * 4) / 12));
  // Cancelled after 2 months with payment by processor: unchanged rule.
  const pay = { ...deal('social', 'natali', { date: '2026-03-10' }), cancelledOn: '2026-05-10', paidMonths: 2 };
  const may = computeMonth({ month: '2026-05', deals: [pay], versions: V() });
  assert.equal(may.totals.revenue, -ils(46800 * 10 / 12));
});

test('half-year deal: 6 monthly payments, half the influencer fee, same photographer', () => {
  const d = { ...deal('social', 'simeon', { paid: ['photographer'] }), termMonths: 6 };
  const l = computeDeal(d, S());
  assert.equal(l.value, ils((3900 + 2000) * 6));
  assert.equal(l.production.influencer, ils(2500), 'half of 5,000');
  assert.equal(l.production.photographer, ils(100));
  assert.equal(l.packageName, 'Social all in one · סמיון, מישל ודניס · חצי שנתי');
  assert.throws(() => computeDeal({ ...d, payMethod: 'checks', installments: 7 }, S()));
  // Cancelled after 3 of 6 months: half comes back.
  const c = computeMonth({ month: '2026-11', deals: [{ ...d, date: '2026-09-15', cancelledOn: '2026-11-20', paidMonths: 3 }], versions: V() });
  assert.equal(c.totals.revenue, -Math.round(l.value / 2));
  // Pooled podcast share is halved too.
  const pod = computeMonth({ month: '2026-09', deals: [{ ...deal('podcast', 'natali'), termMonths: 6 }, deal('podcast', 'natali')], versions: V() });
  assert.deepEqual(pod.lines.map((x) => x.production.influencer), [ils(2250), ils(4500)]);
  // Annual stays as before.
  assert.equal(computeDeal(deal('social', 'simeon'), S()).production.influencer, ils(5000));
});

// Owner's Excel ("רווח והפסד חודשי"), reproduced from local private data.
const excelPath = new URL('../private/excel-case.json', import.meta.url);
const settingsPath = new URL('../private/payouts-settings.json', import.meta.url);
test('Excel acceptance case', { skip: !existsSync(excelPath) && 'private/excel-case.json not present' }, () => {
  const xl = JSON.parse(readFileSync(excelPath, 'utf8'));
  const data = JSON.parse(readFileSync(settingsPath, 'utf8'));
  data.employerCostBp = 0; // the Excel predates employer cost
  data.expenses = data.expenses.filter((e) => !e.payee); // and the fixed monthly pay added later
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
