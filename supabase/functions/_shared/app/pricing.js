// generated — edit app/ instead. Source: app/pricing.js. Regenerate: node scripts/sync-functions.mjs
// Pure pricing and eligibility engine. No DOM access.
// Rules: docs/pricing-rules.md. Amounts are integers in agorot.

import {
  VAT_RATE_PERCENT, TERM_MONTHS, INFLUENCERS, TIERS, PACKAGES,
  PAID_ADDONS, FREE_ADDONS, DOC_TYPES, SPECS, MAX_DISCOUNT, packageId,
} from './catalog.js';
import { PROVIDER, agreementSections } from './legal.js';

export function emptySelection() {
  return {
    docType: 'quote',
    tier: 'social',
    influencer: 'simeon',
    paid: [],
    free: { graphics: 0, simeonStories: 0, simeonJoin: false, extraCh14: false },
    discount: 0,
  };
}

export function isNataliPackage(sel) {
  return sel.influencer === 'natali';
}

export function isSimeonSocial(sel) {
  return sel.influencer === 'simeon' && sel.tier !== 'podcast';
}

export function paidAddonAvailable(addon, sel) {
  if (addon.eligibility === 'all') return true;
  if (addon.eligibility === 'natali') return isNataliPackage(sel);
  if (addon.eligibility === 'simeon-social') return isSimeonSocial(sel);
  return false;
}

export function freeAddonAvailable(id, sel) {
  switch (id) {
    case 'graphics':
    case 'extraCh14':
      return true;
    case 'simeonJoin':
      return isNataliPackage(sel);
    case 'simeonStories':
      return isSimeonSocial(sel) || (isNataliPackage(sel) && sel.free.simeonJoin === true);
    default:
      return false;
  }
}

function isWholeInRange(n, max) {
  return Number.isInteger(n) && n >= 0 && n <= max;
}

// Throws on malformed input (unknown ids, duplicates, bad quantities).
// Used by the server to reject anything the UI would never produce.
export function validateSelection(sel) {
  const errors = [];
  if (!sel || typeof sel !== 'object') throw new Error('selection missing');
  if (!DOC_TYPES[sel.docType]) errors.push(`unknown document type: ${sel.docType}`);
  if (!TIERS.some((t) => t.id === sel.tier)) errors.push(`unknown tier: ${sel.tier}`);
  if (!INFLUENCERS[sel.influencer]) errors.push(`unknown influencer: ${sel.influencer}`);
  if (!Array.isArray(sel.paid)) errors.push('paid must be an array');
  else {
    const seen = new Set();
    for (const id of sel.paid) {
      const addon = PAID_ADDONS.find((a) => a.id === id);
      if (!addon) errors.push(`unknown paid add-on: ${id}`);
      else if (seen.has(id)) errors.push(`duplicate paid add-on: ${id}`);
      else if (errors.length === 0 && !paidAddonAvailable(addon, sel)) errors.push(`paid add-on not available: ${id}`);
      seen.add(id);
    }
  }
  const f = sel.free || {};
  if (!isWholeInRange(f.graphics, FREE_ADDONS.graphics.max)) errors.push('graphics out of range');
  if (!isWholeInRange(f.simeonStories, FREE_ADDONS.simeonStories.max)) errors.push('simeonStories out of range');
  if (typeof f.simeonJoin !== 'boolean') errors.push('simeonJoin must be boolean');
  if (typeof f.extraCh14 !== 'boolean') errors.push('extraCh14 must be boolean');
  const d = sel.discount ?? 0;
  if (!isWholeInRange(d, MAX_DISCOUNT) || d % 100 !== 0) errors.push('discount out of range');
  if (errors.length === 0) {
    if (f.simeonJoin && !freeAddonAvailable('simeonJoin', sel)) errors.push('simeonJoin not available');
    if (f.simeonStories > 0 && !freeAddonAvailable('simeonStories', sel)) errors.push('simeonStories not available');
  }
  if (errors.length) throw new Error(errors.join('; '));
  return true;
}

// Drops choices that are no longer eligible after a package change.
// Returns the cleaned selection and the names of what was removed.
export function reconcile(sel) {
  const removed = [];
  const next = { ...sel, paid: [...sel.paid], free: { ...sel.free } };

  next.paid = next.paid.filter((id) => {
    const addon = PAID_ADDONS.find((a) => a.id === id);
    const ok = addon && paidAddonAvailable(addon, next);
    if (!ok && addon) removed.push(addon.name);
    return ok;
  });
  if (next.free.simeonJoin && !freeAddonAvailable('simeonJoin', next)) {
    next.free.simeonJoin = false;
    removed.push(FREE_ADDONS.simeonJoin.name);
  }
  if (next.free.simeonStories > 0 && !freeAddonAvailable('simeonStories', next)) {
    next.free.simeonStories = 0;
    removed.push(FREE_ADDONS.simeonStories.name);
  }
  return { selection: next, removed };
}

export function computeTotals(sel) {
  const pkg = PACKAGES[packageId(sel.tier, sel.influencer)];
  const addons = sel.paid.map((id) => PAID_ADDONS.find((a) => a.id === id));
  const monthlyList = pkg.price + addons.reduce((s, a) => s + a.price, 0);
  const discount = sel.discount || 0;
  const monthlyNet = monthlyList - discount;
  const monthlyVat = Math.round((monthlyNet * VAT_RATE_PERCENT) / 100);
  const monthlyGross = monthlyNet + monthlyVat;
  return {
    monthlyList,
    discount,
    monthlyNet,
    monthlyVat,
    monthlyGross,
    termNet: monthlyNet * TERM_MONTHS,
    termVat: monthlyVat * TERM_MONTHS,
    termGross: monthlyGross * TERM_MONTHS,
  };
}

export function termsText(sel) {
  const monthly = sel.paid.includes('photographer')
    ? ', למעט שירות הצלם החודשי שמספק 8 תכנים בכל חודש.'
    : '.';
  return `המחירים חודשיים ובהתחייבות ל־${TERM_MONTHS} חודשים. `
    + `הכמויות בחבילה ובתוספות הן לשנה${monthly} `
    + 'תוספות ללא עלות אינן משנות את המחיר.';
}

// What the agreement needs to know about the selected package.
function agreementContext(sel, { tier, paid, free, totals }) {
  const specs = SPECS[packageId(sel.tier, sel.influencer)];
  return {
    termMonths: TERM_MONTHS,
    validHours: DOC_TYPES.agreement.validHours,
    totals,
    packageName: tier.name,
    influencer: INFLUENCERS[sel.influencer].name,
    tier: sel.tier,
    shootDays: specs.shootDays + (sel.paid.includes('simeon-day') ? 1 : 0),
    hasCh14: specs.ch14 > 0 || sel.free.extraCh14 === true,
    influencerPosts: specs.collabs > 0 || specs.stories > 0 || sel.free.simeonStories > 0
      || sel.paid.includes('natali-reel') || sel.paid.includes('natali-story'),
    simeonJoin: sel.free.simeonJoin === true,
    paid: paid.map((p) => ({ id: p.id, name: p.name })),
    free: free.map((f) => ({ id: f.id, name: f.name, qty: f.qty })),
  };
}

// The quote model rendered on screen, in the client link and in exports.
// Everything the client sees is stored in it, so the server-side hash covers it.
export function buildQuoteModel(sel, client = {}, meta = {}) {
  const pid = packageId(sel.tier, sel.influencer);
  const pkg = PACKAGES[pid];
  const tier = TIERS.find((t) => t.id === sel.tier);
  const paid = PAID_ADDONS
    .filter((a) => sel.paid.includes(a.id))
    .map((a) => ({
      id: a.id, name: a.name, detail: a.detail,
      monthly: a.price, term: a.price * TERM_MONTHS,
    }));
  const free = [];
  if (sel.free.graphics > 0) free.push({ id: 'graphics', name: FREE_ADDONS.graphics.name, qty: sel.free.graphics });
  if (sel.free.simeonJoin) free.push({ id: 'simeonJoin', name: FREE_ADDONS.simeonJoin.name, detail: FREE_ADDONS.simeonJoin.detail });
  if (sel.free.simeonStories > 0) free.push({ id: 'simeonStories', name: FREE_ADDONS.simeonStories.name, qty: sel.free.simeonStories });
  if (sel.free.extraCh14) free.push({ id: 'extraCh14', name: FREE_ADDONS.extraCh14.name, detail: FREE_ADDONS.extraCh14.detail });

  const totals = computeTotals(sel);
  const docType = DOC_TYPES[sel.docType] || DOC_TYPES.quote;
  // Bidi control characters could make the displayed name differ from the stored one.
  const clean = (v) => String(v || '').replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim();
  return {
    version: 2,
    docType: docType.id,
    docTitle: docType.name,
    signable: docType.signable,
    validHours: docType.validHours,
    provider: PROVIDER,
    number: meta.number || null,
    createdAt: meta.createdAt || null,
    client: {
      name: clean(client.name),
      company: clean(client.company),
      phone: clean(client.phone),
      email: clean(client.email),
      companyId: clean(client.companyId),
      notes: clean(client.notes),
    },
    package: {
      id: pid,
      tierName: tier.name,
      influencer: INFLUENCERS[sel.influencer].name,
      monthly: pkg.price,
      term: pkg.price * TERM_MONTHS,
      includes: pkg.includes,
    },
    paid,
    free,
    vatRate: VAT_RATE_PERCENT,
    termMonths: TERM_MONTHS,
    totals,
    terms: termsText(sel),
    legal: docType.signable ? agreementSections(agreementContext(sel, { tier, paid, free, totals })) : null,
    selection: sel,
  };
}

const ils = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
export function formatILS(agorot) {
  return `${ils.format(agorot / 100)} ₪`;
}
