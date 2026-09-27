// Monthly payouts engine. Pure functions, no DOM and no network.
// Rules: docs/payouts/rules.md. Money is integer agorot, rates are basis
// points (1% = 100). Business values come from settings stored in the
// database, never from this file: the repository is public.

import { PACKAGES, PAID_ADDONS, SPECS, INFLUENCERS, TIERS, TERM_MONTHS, packageId } from '../catalog.js';
import { validateSelection } from '../pricing.js';

// Cost items the engine knows how to derive from a deal. Their costs live
// in settings.items[id] = { real, commission, per: 'unit' | 'deal' }.
export const ITEMS = {
  'natali-story': { name: 'סטורי אצל נטלי דדון', payee: 'נטלי דדון' },
  'natali-reel': { name: 'העלאה אצל נטלי דדון', payee: 'נטלי דדון' },
  'simeon-story': { name: 'סטורי אצל סמיון, מישל ודניס', payee: 'סמיון, מישל ודניס' },
  'simeon-collab': { name: 'קולאב אצל סמיון, מישל ודניס', payee: 'סמיון, מישל ודניס' },
  'simeon-day': { name: 'יום צילום נוסף עם סמיון, מישל ודניס', payee: 'סמיון, מישל ודניס' },
  'simeon-join': { name: 'צירוף סמיון לחבילת נטלי', payee: 'סמיון, מישל ודניס' },
  ch14: { name: 'אייטם בערוץ 14', payee: 'ערוץ 14' },
  'photographer-monthly': { name: 'צלם חודשי', payee: 'צלם חודשי' },
  graphics: { name: 'גרפיקות נוספות', payee: 'גרפיקות' },
};

// Paid add-on id (catalog) -> cost item id.
export const PAID_ITEM = {
  photographer: 'photographer-monthly',
  'natali-reel': 'natali-reel',
  'natali-story': 'natali-story',
  'simeon-day': 'simeon-day',
};

// What a Social + TV package has beyond the Social package of the same
// influencer, per SPECS row, mapped to cost items.
const SPEC_ITEM = {
  shootDays: { simeon: 'simeon-day' },
  collabs: { simeon: 'simeon-collab' },
  stories: { simeon: 'simeon-story', natali: 'natali-story' },
  ch14: { simeon: 'ch14', natali: 'ch14' },
};

// Monthly variable costs entered per month (fuel, car depreciation, meetings).
export const MONTH_ITEM_KINDS = {
  fuel: 'דלק',
  depreciation: 'פחת רכב',
  meetings: 'תיאום פגישות',
  other: 'אחר',
};

export const SOURCE_LABEL = {
  package: 'מעבר לחבילת הבסיס',
  paid: 'תוספת בתשלום',
  free: 'הטבה ללא תשלום',
  perk: 'צ׳ופר',
};

// ---------- arithmetic ----------

// amount × bp / 10000, rounded half away from zero, in integer agorot.
export function applyBp(amount, bp) {
  const n = amount * bp;
  const q = Math.trunc(n / 10000);
  const r = n - q * 10000;
  if (Math.abs(r) * 2 >= 10000) return q + Math.sign(n);
  return q;
}

// Splits `total` by integer weights so the parts add up exactly
// (largest remainder; ties go to the earlier entry).
export function allocate(total, weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || weights.length === 0) return weights.map(() => 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / sum);
  const parts = raw.map(Math.floor);
  let left = abs - parts.reduce((s, p) => s + p, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) parts[order[k][1]] += 1;
  return parts.map((p) => p * sign);
}

// ---------- dates ----------

export function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`bad month: ${month}`);
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, '0')}`, days };
}

export function inMonth(date, month) {
  const { first, last } = monthBounds(month);
  return date >= first && date <= last;
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------- settings ----------

// versions: [{ effectiveFrom: 'YYYY-MM-DD', data }]. Returns the version in
// effect on `date` (the latest one that started on or before it).
export function settingsOn(versions, date) {
  let best = null;
  for (const v of versions) {
    if (v.effectiveFrom <= date && (!best || v.effectiveFrom > best.effectiveFrom)) best = v;
  }
  return best;
}

export function familyOf(sel) {
  return sel.influencer;
}

export function packageName(sel) {
  if (sel.custom) return `הצעה אישית · ${INFLUENCERS[sel.influencer]?.name || sel.influencer}`;
  const tier = TIERS.find((t) => t.id === sel.tier);
  return `${tier ? tier.name : sel.tier} · ${INFLUENCERS[sel.influencer]?.name || sel.influencer}`;
}

// ---------- items of a deal ----------

// Items the catalog lists in a package that the business does not actually
// give there (owner, 27.9: the Natali story is sold only as an add-on).
const NOT_GIVEN_IN_PACKAGE = { 'social-tv-natali': ['natali-story'] };

export function packageExtras(pid) {
  const pkg = PACKAGES[pid];
  if (!pkg || pkg.tier !== 'social-tv') return [];
  const base = SPECS[packageId('social', pkg.influencer)];
  const spec = SPECS[pid];
  const out = [];
  for (const [row, map] of Object.entries(SPEC_ITEM)) {
    const extra = spec[row] - base[row];
    if (extra <= 0) continue;
    const id = map[pkg.influencer];
    if (!id) throw new Error(`no cost item for extra ${row} in ${pid}`);
    if (NOT_GIVEN_IN_PACKAGE[pid]?.includes(id)) continue;
    out.push({ id, qty: extra, source: 'package' });
  }
  return out;
}

// Every cost item a deal carries, with where it came from.
export function dealItems(deal) {
  const sel = deal.selection;
  const list = [...packageExtras(packageId(sel.tier, sel.influencer))];
  for (const a of sel.paid) list.push({ id: PAID_ITEM[a], qty: 1, source: 'paid' });
  const f = sel.free || {};
  if (f.graphics > 0) list.push({ id: 'graphics', qty: f.graphics, source: 'free' });
  if (f.simeonStories > 0) list.push({ id: 'simeon-story', qty: f.simeonStories, source: 'free' });
  if (f.simeonJoin) list.push({ id: 'simeon-join', qty: 1, source: 'free' });
  if (f.extraCh14) list.push({ id: 'ch14', qty: 1, source: 'free' });
  for (const p of deal.perks || []) {
    if (!ITEMS[p.id]) throw new Error(`unknown perk: ${p.id}`);
    if (!Number.isInteger(p.qty) || p.qty < 1 || p.qty > 99) throw new Error(`bad perk quantity: ${p.id}`);
    list.push({ id: p.id, qty: p.qty, source: 'perk' });
  }
  return list;
}

function itemCost(settings, id, qty, which, warn) {
  const cfg = settings.items?.[id] || {};
  const unit = cfg[which];
  if (unit === null || unit === undefined) {
    warn(`missing-cost:${id}`);
    return 0;
  }
  return cfg.per === 'deal' ? unit : unit * qty;
}

// ---------- revenue lines ----------

// The commission part of any revenue: payment first, then deductions.
function commissionSide(value, family, deductions, settings) {
  const payment = applyBp(value, settings.payment.commissionBp);
  const base = Math.max(0, value - payment - deductions);
  const commissions = (settings.commissionPeople || []).map((p) => {
    const rateBp = p.rates?.[family] ?? 0;
    return { personId: p.id, name: p.name, rateBp, amount: applyBp(base, rateBp) };
  });
  return { payment, base, commissions };
}

// One deal. Production for pooled packages (podcast with Natali) is filled
// in at month level because it depends on how many closed that month.
// A deal outside the catalog ("personal offer"): only the total amount for
// the whole term and the influencer family are known. No items are deducted;
// production costs are those of the family's Social package.
export function validateCustomSelection(sel) {
  if (!INFLUENCERS[sel.influencer]) throw new Error(`unknown influencer: ${sel.influencer}`);
  if (!Number.isInteger(sel.amount) || sel.amount <= 0 || sel.amount > 1e10) throw new Error('custom deal amount must be a positive whole number of agorot');
}

export function computeDeal(deal, settings, warn = () => {}) {
  const sel = deal.selection;
  const custom = sel.custom === true;
  if (custom) validateCustomSelection(sel);
  else validateSelection({ ...sel, docType: 'agreement' });
  const pid = custom ? `custom-${sel.influencer}` : packageId(sel.tier, sel.influencer);
  const family = familyOf(sel);
  const value = custom ? sel.amount
    : (PACKAGES[pid].price
      + sel.paid.reduce((s, id) => s + PAID_ADDONS.find((a) => a.id === id).price, 0)
      - (sel.discount || 0)) * TERM_MONTHS;
  const monthly = Math.round(value / TERM_MONTHS);

  const items = (custom ? [] : dealItems(deal)).map((it) => ({
    ...it,
    name: ITEMS[it.id].name,
    payee: settings.items?.[it.id]?.payee || ITEMS[it.id].payee,
    real: itemCost(settings, it.id, it.qty, 'real', warn),
    commission: itemCost(settings, it.id, it.qty, 'commission', warn),
  }));
  const deductions = items.reduce((s, it) => s + it.commission, 0);
  const itemsReal = items.reduce((s, it) => s + it.real, 0);
  const side = commissionSide(value, family, deductions, settings);

  const prodKey = custom ? packageId('social', sel.influencer) : pid;
  const prod = settings.production?.[prodKey];
  if (!prod) warn(`missing-production:${prodKey}`);
  const production = {
    influencer: prod && !prod.influencerPerDay ? prod.influencer || 0 : 0,
    photographer: prod?.photographer || 0,
    makeup: prod?.makeupPerDay !== undefined ? 0 : prod?.makeup || 0,
  };
  const seller = (deal.seller || '').trim();
  const closer = seller ? (settings.perDealPeople || []).find((p) => p.name === seller) : null;
  return {
    kind: 'deal',
    id: deal.id,
    date: deal.date,
    client: deal.client,
    seller,
    closerFee: closer ? { name: closer.name, amount: closer.amount || 0 } : null,
    cancelledOn: deal.cancelledOn || null,
    paidMonths: deal.paidMonths ?? null,
    note: deal.note || '',
    packageId: pid,
    packageName: packageName(sel),
    custom,
    family,
    pooled: !!prod?.influencerPerDay,
    pool: prod?.influencerPerDay ? { perDay: prod.influencerPerDay, clientsPerDay: prod.clientsPerDay, makeupPerDay: prod.makeupPerDay } : null,
    monthly,
    value,
    paymentReal: applyBp(value, settings.payment.realBp),
    paymentCommission: side.payment,
    items,
    deductions,
    itemsReal,
    base: side.base,
    commissions: side.commissions,
    production,
  };
}

// Revenue that is not a new deal (e.g. cheques of an existing deal).
export function computeIncome(entry, settings) {
  const side = commissionSide(entry.amount, entry.family, 0, settings);
  return {
    kind: 'income',
    id: entry.id,
    date: entry.date,
    client: entry.label,
    family: entry.family,
    value: entry.amount,
    paymentReal: applyBp(entry.amount, settings.payment.realBp),
    paymentCommission: side.payment,
    items: [],
    deductions: 0,
    itemsReal: 0,
    base: side.base,
    commissions: side.commissions,
    production: { influencer: 0, photographer: 0, makeup: 0 },
  };
}

function finishLine(line) {
  const commissionTotal = line.commissions.reduce((s, c) => s + c.amount, 0);
  const productionTotal = line.production.influencer + line.production.photographer + line.production.makeup;
  const closerTotal = line.closerFee?.amount || 0;
  line.commissionTotal = commissionTotal;
  line.productionTotal = productionTotal;
  line.closerTotal = closerTotal;
  line.contribution = line.value - line.paymentReal - commissionTotal - productionTotal - line.itemsReal - closerTotal;
  return line;
}

// ---------- month ----------

const WARN_TEXT = {
  'missing-cost': (id) => `לא הוגדרה עלות ל״${ITEMS[id]?.name || id}״. חושב כ־0 ₪.`,
  'missing-production': (id) => `לא הוגדרו עלויות הפקה לחבילה ${id}.`,
};

// input: { month, deals, incomes, expenses, versions }
//   deals:    [{ id, date, client, selection, perks, seller, note }]
//   incomes:  [{ id, date, label, family, amount }]
//   expenses: [{ id, month, label, payee, amount }]  one-off for this month
export function computeMonth({ month, deals = [], incomes = [], expenses = [], versions }) {
  const { last } = monthBounds(month);
  const monthSettings = settingsOn(versions, last);
  const warnings = new Set();
  const warn = (w) => warnings.add(w);
  const errors = [];
  if (!monthSettings) {
    return { month, empty: true, errors: ['אין הגדרות בתוקף לחודש הזה.'], warnings: [] };
  }
  const ms = monthSettings.data;

  const lines = [];
  for (const d of deals.filter((x) => inMonth(x.date, month)).sort(byDate)) {
    const v = settingsOn(versions, d.date) || monthSettings;
    try {
      lines.push(computeDeal(d, v.data, warn));
    } catch (e) {
      errors.push(`עסקה ״${d.client}״ (${d.date}) לא חושבה: ${e.message}`);
    }
  }
  // Pooled influencer fee: a shoot day per group of clients, split between
  // the deals of that package closed this month.
  const pooledByPkg = {};
  for (const l of lines) if (l.pooled) (pooledByPkg[l.packageId] ||= []).push(l);
  // The fee terms are those in effect for the latest deal of the group.
  for (const group of Object.values(pooledByPkg)) {
    const p = group[group.length - 1].pool;
    if (!(p.perDay >= 0) || !(p.clientsPerDay > 0)) {
      warn(`missing-production:${group[0].packageId}`);
      continue;
    }
    const days = Math.ceil(group.length / p.clientsPerDay);
    const shares = allocate(days * p.perDay, group.map(() => 1));
    // Makeup is also booked per shoot day when set that way.
    const makeup = p.makeupPerDay !== undefined ? allocate(days * p.makeupPerDay, group.map(() => 1)) : null;
    group.forEach((l, i) => {
      l.production.influencer = shares[i];
      if (makeup) l.production.makeup = makeup[i];
      l.shootDays = days;
    });
  }
  // Cancelled deals, booked in the month of the cancellation (the deal's own
  // month may already be locked): the revenue of the months the client will
  // not pay is taken off, and everyone paid on the deal (percentages and the
  // closing fee) gives back the same share.
  for (const d of deals.filter((x) => x.cancelledOn && inMonth(x.cancelledOn, month)).sort((a, b) => byDate({ date: a.cancelledOn }, { date: b.cancelledOn }))) {
    const v = settingsOn(versions, d.date) || monthSettings;
    try {
      const orig = computeDeal(d, v.data);
      const remaining = TERM_MONTHS - d.paidMonths;
      const share = (a) => -Math.round((a * remaining) / TERM_MONTHS);
      lines.push({
        kind: 'clawback', id: d.id, date: d.cancelledOn, dealDate: d.date, client: d.client,
        packageName: orig.packageName, family: orig.family, paidMonths: d.paidMonths,
        originalValue: orig.value,
        value: share(orig.value), paymentReal: 0, paymentCommission: 0, items: [], deductions: 0, itemsReal: 0, base: 0,
        closerFee: orig.closerFee ? { name: orig.closerFee.name, original: orig.closerFee.amount, amount: share(orig.closerFee.amount) } : null,
        production: { influencer: 0, photographer: 0, makeup: 0 },
        commissions: orig.commissions.map((c) => ({ ...c, original: c.amount, amount: share(c.amount) })),
      });
    } catch (e) {
      errors.push(`ביטול העסקה ״${d.client}״ לא חושב: ${e.message}`);
    }
  }
  for (const e of incomes.filter((x) => inMonth(x.date, month)).sort(byDate)) {
    const v = settingsOn(versions, e.date) || monthSettings;
    lines.push(computeIncome(e, v.data));
  }
  lines.forEach(finishLine);

  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const dealLines = lines.filter((l) => l.kind === 'deal');
  const incomeLines = lines.filter((l) => l.kind === 'income');

  // Payroll employees cost the salary plus the employer's share; invoice
  // workers cost the invoice only.
  const employees = (ms.employees || []).map((e) => {
    const employerCost = e.payroll && !e.costIncluded ? applyBp(e.salary, ms.employerCostBp || 0) : 0;
    return { ...e, employerCost, amount: e.salary + employerCost };
  });
  const recurring = (ms.expenses || []).map((e) => ({ ...e, payee: e.payee || e.name }));
  const oneOff = expenses.filter((e) => e.month === month).map((e) => {
    const kind = MONTH_ITEM_KINDS[e.kind] ? e.kind : 'other';
    const amount = kind === 'meetings' ? (e.qty || 0) * (ms.meetingRate || 0) : e.amount;
    return { ...e, kind, amount, payee: e.payee || (kind === 'meetings' ? ms.meetingPayee : '') || e.label };
  });
  const fixed = sum(employees, (e) => e.amount) + sum(recurring, (e) => e.amount) + sum(oneOff, (e) => e.amount);

  const revenue = sum(lines, (l) => l.value);
  const paymentReal = sum(lines, (l) => l.paymentReal);
  const commissions = sum(lines, (l) => l.commissionTotal);
  const production = sum(lines, (l) => l.productionTotal);
  const itemsReal = sum(lines, (l) => l.itemsReal);
  const closerFees = sum(lines, (l) => l.closerTotal);
  const clawbacks = sum(lines.filter((l) => l.kind === 'clawback'), (l) => l.commissionTotal);
  const variable = paymentReal + commissions + production + itemsReal + closerFees;
  const profit = revenue - variable - fixed;
  const incomeContribution = sum(incomeLines, (l) => l.contribution);

  const partners = ms.partners || [];
  // Shares are relative weights (1, 1, 1 = thirds), so equal splits are exact.
  const weights = partners.map((p) => p.weight);
  const weightSum = sum(weights, (w) => w);
  if (partners.length && (weights.some((w) => !Number.isInteger(w) || w < 0) || weightSum <= 0)) {
    errors.push('חלקי השותפים לא תקינים.');
  }
  const partnerAmounts = allocate(profit, weights);
  const partnerExcl = allocate(profit - incomeContribution, weights);

  const report = {
    month,
    settingsFrom: monthSettings.effectiveFrom,
    lines,
    counts: {
      deals: dealLines.length,
      cancellations: lines.filter((l) => l.kind === 'clawback').length,
      byFamily: countBy(dealLines, (l) => l.family),
      byPackage: countBy(dealLines, (l) => l.packageId),
    },
    totals: {
      revenue, dealsRevenue: sum(dealLines, (l) => l.value), incomeRevenue: sum(incomeLines, (l) => l.value),
      cancelledRevenue: sum(lines.filter((l) => l.kind === 'clawback'), (l) => l.value),
      paymentReal, commissions, production, itemsReal, closerFees, clawbacks, variable, fixed,
      employees: sum(employees, (e) => e.amount),
      employerCost: sum(employees, (e) => e.employerCost),
      recurring: sum(recurring, (e) => e.amount),
      oneOff: sum(oneOff, (e) => e.amount),
      profit,
      profitExcludingIncome: profit - incomeContribution,
      marginBp: revenue ? Math.round((profit * 10000) / revenue) : null,
    },
    partners: partners.map((p, i) => ({
      ...p, shareBp: weightSum > 0 ? Math.round((p.weight * 10000) / weightSum) : 0,
      amount: partnerAmounts[i], amountExcludingIncome: partnerExcl[i],
    })),
    employees,
    recurring,
    oneOff,
    errors,
    warnings: [...warnings].map((w) => {
      const [k, id] = w.split(':');
      return WARN_TEXT[k] ? WARN_TEXT[k](id) : w;
    }),
  };
  report.payees = payeesOf(report, ms);
  return report;
}

function byDate(a, b) {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

function countBy(arr, f) {
  const out = {};
  for (const x of arr) out[f(x)] = (out[f(x)] || 0) + 1;
  return out;
}

// "How much to pay each person": one entry per payee with its lines.
export function payeesOf(report, ms) {
  const map = new Map();
  const add = (name, kind, label, amount) => {
    if (!amount) return;
    if (!map.has(name)) map.set(name, { name, kind, total: 0, lines: [] });
    const p = map.get(name);
    p.total += amount;
    p.lines.push({ label, amount });
  };
  const names = ms.payees || {};
  for (const l of report.lines) {
    add('פיימנט', 'payment', l.client, l.paymentReal);
    const who = l.kind === 'deal' ? `${l.client} · ${l.packageName}`
      : l.kind === 'clawback' ? `קיזוז: ${l.client} בוטלה אחרי ${l.paidMonths} חודשים` : l.client;
    for (const c of l.commissions) add(c.name, 'commission', who, c.amount);
    if (l.closerFee) add(l.closerFee.name, 'commission', l.kind === 'clawback' ? `קיזוז עמלת סגירה: ${l.client} בוטלה אחרי ${l.paidMonths} חודשים` : `עמלת סגירה · ${l.client}`, l.closerFee.amount);
    add(names.influencer?.[l.family] || INFLUENCERS[l.family]?.name, 'influencer', who, l.production.influencer);
    add(names.photographer || 'צלם', 'supplier', who, l.production.photographer);
    add(names.makeup || 'מאפרת', 'supplier', who, l.production.makeup);
    for (const it of l.items) add(it.payee, 'supplier', `${it.name}${it.qty > 1 ? ` ×${it.qty}` : ''} · ${l.client}`, it.real);
  }
  for (const e of report.employees) {
    const kind = !e.payroll ? 'חשבונית' : e.costIncluded ? 'משכורת כולל עלות מעסיק' : 'משכורת';
    add(e.name, 'employee', `${kind}${e.role ? ` · ${e.role}` : ''}`, e.salary);
    add(e.name, 'employee', 'עלות מעסיק', e.employerCost);
  }
  for (const e of report.recurring) add(e.payee, 'expense', e.name, e.amount);
  for (const e of report.oneOff) add(e.payee, 'expense', monthItemLabel(e, ms), e.amount);
  for (const p of report.partners) add(p.name, 'partner', 'חלק ברווח', p.amount);
  const order = { commission: 0, influencer: 1, supplier: 2, employee: 3, expense: 4, payment: 5, partner: 6 };
  return [...map.values()].sort((a, b) => order[a.kind] - order[b.kind] || b.total - a.total);
}

export function monthItemLabel(e, ms = {}) {
  if (e.kind === 'meetings') return `${MONTH_ITEM_KINDS.meetings}: ${e.qty || 0} × ${(ms.meetingRate || 0) / 100} ₪`;
  if (e.kind === 'other') return e.label;
  return e.label && e.label !== MONTH_ITEM_KINDS[e.kind] ? `${MONTH_ITEM_KINDS[e.kind]} · ${e.label}` : MONTH_ITEM_KINDS[e.kind];
}

// What a commission earner is shown: only commission-side values.
// Accepts the person's id or name. Shows their commissions (with the
// deductions they are told about), clawbacks, per-deal fees, and their own
// other payments this month. No real costs, other people or profit.
export function commissionStatement(report, who) {
  const rows = [];
  let name = '';
  for (const l of report.lines) {
    const c = l.commissions.find((x) => x.personId === who || x.name === who);
    if (c) {
      name = c.name;
      rows.push({
        kind: l.kind,
        date: l.date,
        dealDate: l.dealDate,
        paidMonths: l.paidMonths,
        client: l.client,
        packageName: l.packageName || 'הכנסה נוספת',
        value: l.value,
        payment: l.paymentCommission,
        deductions: l.items
          .filter((it) => it.commission)
          .map((it) => ({ name: it.name, qty: it.qty, source: it.source, amount: it.commission })),
        base: l.base,
        rateBp: c.rateBp,
        original: c.original,
        amount: c.amount,
      });
    }
    if (l.closerFee && l.closerFee.name === (name || who)) {
      name = l.closerFee.name;
      rows.push({
        kind: 'closer', clawback: l.kind === 'clawback', paidMonths: l.paidMonths, date: l.date,
        client: l.client, packageName: l.packageName, original: l.closerFee.original, amount: l.closerFee.amount,
      });
    }
  }
  name ||= typeof who === 'string' ? who : '';
  const extras = [
    ...(report.recurring || []).filter((e) => e.payee === name).map((e) => ({ label: e.name, amount: e.amount })),
    ...(report.oneOff || []).filter((e) => e.payee === name).map((e) => ({ label: monthItemLabel(e, { meetingRate: e.qty ? e.amount / e.qty : 0 }), amount: e.amount })),
  ];
  const commissionTotal = rows.reduce((s, r) => s + r.amount, 0);
  const extrasTotal = extras.reduce((s, e) => s + e.amount, 0);
  return {
    month: report.month,
    personId: who,
    name,
    rows,
    extras,
    commissionTotal,
    total: commissionTotal + extrasTotal,
  };
}
