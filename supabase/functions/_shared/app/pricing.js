// generated — edit app/ instead. Source: app/pricing.js. Regenerate: node scripts/sync-functions.mjs
// Pure pricing and eligibility engine. No DOM access.
// Rules: docs/pricing-rules.md. Amounts are integers in agorot.

import {
  VAT_RATE_PERCENT, TERM_MONTHS, INFLUENCERS, TIERS, PACKAGES,
  PAID_ADDONS, FREE_ADDONS, DOC_TYPES, SPECS, MAX_DISCOUNT, packageId,
  CUSTOM_QTY, INCLUDES_KEYS, CUSTOM_LIMITS, MONTHLY_CONTENTS,
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
  if (sel.custom !== undefined && sel.custom !== null) errors.push(...customErrors(sel, errors.length === 0));
  if (errors.length) throw new Error(errors.join('; '));
  return true;
}

/* ── Custom (exceptional) contracts ─────────────────────────────
   `selection.custom` changes a contract by hand on top of its base package:
     qty        { videos, graphics, shootDays, photoDays, collabs, stories, ch14, monthly }
                the package's own quantities (add-ons still add on top); `monthly` is the
                monthly photographer's contents each month, only with that add-on
     price      the package's monthly price before VAT, agorot
     discount   a monthly discount of any size, agorot (replaces selection.discount)
     termMonths 1–36
     lines      up to 10 × { label, qty?, monthly? (agorot) }: added to "מה כלול", and to
                the price when they carry one
     terms      "תנאים מיוחדים", free text shown in the document and in the agreement
   Types and ranges are strict (catalog.js CUSTOM_QTY, CUSTOM_LIMITS); the totals are
   always computed here, never taken from the caller. Whatever equals the built-in
   rule is dropped (normalizeSelection), so a contract without deviations is exactly a
   regular one. exceptionOf() lists the deviations; any of them needs a manager's approval. */

const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const cleanLine = (v) => String(v ?? '').replace(BIDI, '').replace(/\s+/g, ' ').trim();
const cleanBlock = (v) => String(v ?? '').replace(BIDI, '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ')
  .split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const CUSTOM_KEYS = ['qty', 'price', 'discount', 'termMonths', 'lines', 'terms'];
const given = (v) => v !== undefined && v !== null;

function customErrors(sel, selectionOk) {
  const c = sel.custom;
  const errors = [];
  if (!isObject(c)) return ['custom must be an object'];
  for (const k of Object.keys(c)) if (!CUSTOM_KEYS.includes(k)) errors.push(`unknown custom field: ${k}`);
  if (given(c.qty)) {
    if (!isObject(c.qty)) errors.push('custom quantities must be an object');
    else {
      for (const [k, v] of Object.entries(c.qty)) {
        const def = CUSTOM_QTY.find((q) => q.key === k);
        if (!def) { errors.push(`unknown custom quantity: ${k}`); continue; }
        if (!given(v)) continue;
        if (!Number.isInteger(v) || v < (def.min || 0) || v > def.max) errors.push(`custom quantity out of range: ${k}`);
        else if (def.addon && Array.isArray(sel.paid) && !sel.paid.includes(def.addon)) errors.push(`custom quantity needs its add-on: ${k}`);
      }
    }
  }
  if (given(c.price) && !isWholeInRange(c.price, CUSTOM_LIMITS.priceMax)) errors.push('custom price out of range');
  if (given(c.termMonths) && !(Number.isInteger(c.termMonths) && c.termMonths >= CUSTOM_LIMITS.termMin && c.termMonths <= CUSTOM_LIMITS.termMax)) errors.push('custom term out of range');
  if (given(c.lines)) {
    if (!Array.isArray(c.lines) || c.lines.length > CUSTOM_LIMITS.lines) errors.push('too many custom lines');
    else {
      for (const [i, l] of c.lines.entries()) {
        if (!isObject(l) || typeof l.label !== 'string') { errors.push(`custom line ${i + 1} is malformed`); continue; }
        if (Object.keys(l).some((k) => !['label', 'qty', 'monthly'].includes(k))) errors.push(`custom line ${i + 1} has an unknown field`);
        const label = cleanLine(l.label);
        if (!label || label.length > CUSTOM_LIMITS.lineLabel) errors.push(`custom line ${i + 1}: label length`);
        if (given(l.qty) && !(Number.isInteger(l.qty) && l.qty >= 1 && l.qty <= CUSTOM_LIMITS.lineQtyMax)) errors.push(`custom line ${i + 1}: quantity out of range`);
        if (given(l.monthly) && !(Number.isInteger(l.monthly) && l.monthly >= 1 && l.monthly <= CUSTOM_LIMITS.linePriceMax)) errors.push(`custom line ${i + 1}: price out of range`);
      }
    }
  }
  if (given(c.terms) && (typeof c.terms !== 'string' || cleanBlock(c.terms).length > CUSTOM_LIMITS.terms)) errors.push('custom terms too long');
  if (given(c.discount) && !(Number.isInteger(c.discount) && c.discount >= 0 && c.discount % 100 === 0)) errors.push('custom discount out of range');
  // The discount can never be more than the price it is taken from.
  if (selectionOk && errors.length === 0 && given(c.discount) && c.discount > listPrice(sel)) errors.push('custom discount is more than the monthly price');
  return errors;
}

const pkgOf = (sel) => PACKAGES[packageId(sel.tier, sel.influencer)];
// The term in months: 12 unless the contract says otherwise.
export function termOf(sel) {
  const t = sel?.custom?.termMonths;
  return Number.isInteger(t) ? t : TERM_MONTHS;
}
// What the package itself grants, by CUSTOM_QTY key (before any change by hand).
export function baseQuantities(sel) {
  const pid = packageId(sel.tier, sel.influencer);
  return Object.fromEntries(CUSTOM_QTY.map((q) => [q.key, q.base(SPECS[pid], PACKAGES[pid])]));
}
// The same, with the changes made by hand.
export function effectiveQuantities(sel) {
  const out = baseQuantities(sel);
  for (const q of CUSTOM_QTY) {
    const v = sel?.custom?.qty?.[q.key];
    if (Number.isInteger(v) && (!q.addon || sel.paid.includes(q.addon))) out[q.key] = v;
  }
  return out;
}
const linesOf = (sel) => (Array.isArray(sel?.custom?.lines) ? sel.custom.lines : []);
const packagePrice = (sel) => (Number.isInteger(sel?.custom?.price) ? sel.custom.price : pkgOf(sel).price);
// The monthly price before any discount: the package, the paid add-ons, the added lines.
function listPrice(sel) {
  return packagePrice(sel)
    + sel.paid.reduce((s, id) => s + (PAID_ADDONS.find((a) => a.id === id)?.price || 0), 0)
    + linesOf(sel).reduce((s, l) => s + (Number.isInteger(l?.monthly) ? l.monthly : 0), 0);
}
const discountOf = (sel) => (Number.isInteger(sel?.custom?.discount) ? sel.custom.discount : sel.discount || 0);

// The selection without anything in `custom` that equals the built-in rule. With no
// deviation left, `custom` is gone and the selection is a regular one.
export function normalizeSelection(sel) {
  if (!sel || !('custom' in sel)) return sel;
  const { custom: raw, ...rest } = sel;
  if (!isObject(raw)) return rest;
  const base = baseQuantities(rest);
  const c = {};
  const qty = {};
  for (const q of CUSTOM_QTY) {
    const v = raw.qty?.[q.key];
    if (Number.isInteger(v) && v !== base[q.key] && (!q.addon || rest.paid.includes(q.addon))) qty[q.key] = v;
  }
  if (Object.keys(qty).length) c.qty = qty;
  if (Number.isInteger(raw.price) && raw.price !== pkgOf(rest).price) c.price = raw.price;
  if (Number.isInteger(raw.termMonths) && raw.termMonths !== TERM_MONTHS) c.termMonths = raw.termMonths;
  const lines = (Array.isArray(raw.lines) ? raw.lines : []).map((l) => {
    const line = { label: cleanLine(l?.label) };
    if (Number.isInteger(l?.qty) && l.qty > 0) line.qty = l.qty;
    if (Number.isInteger(l?.monthly) && l.monthly > 0) line.monthly = l.monthly;
    return line;
  }).filter((l) => l.label);
  if (lines.length) c.lines = lines;
  const terms = cleanBlock(raw.terms);
  if (terms) c.terms = terms;
  // A discount the seller may give anyway is a regular discount.
  if (Number.isInteger(raw.discount)) {
    if (raw.discount > MAX_DISCOUNT) { c.discount = raw.discount; rest.discount = 0; } else rest.discount = raw.discount;
  }
  return Object.keys(c).length ? { ...rest, custom: c } : rest;
}

// The deviations of a selection from the built-in rules, as data and as Hebrew
// sentences: [{ kind, key?, from?, to?, text }]. Empty: a regular contract.
export function exceptionOf(selection) {
  const sel = normalizeSelection(selection);
  const c = sel?.custom;
  if (!c) return [];
  const out = [];
  const base = baseQuantities(sel);
  for (const q of CUSTOM_QTY) {
    if (!given(c.qty?.[q.key])) continue;
    const to = c.qty[q.key];
    out.push({ kind: 'qty', key: q.key, from: base[q.key], to, text: `${to} ${q.name} במקום ${base[q.key]}` });
  }
  if (given(c.price)) out.push({ kind: 'price', from: pkgOf(sel).price, to: c.price, text: `מחיר חודשי ${formatILS(c.price)} במקום ${formatILS(pkgOf(sel).price)}` });
  if (given(c.discount)) out.push({ kind: 'discount', from: MAX_DISCOUNT, to: c.discount, text: `הנחה חודשית ${formatILS(c.discount)} (המותר בלי אישור: ${formatILS(MAX_DISCOUNT)})` });
  if (given(c.termMonths)) out.push({ kind: 'term', from: TERM_MONTHS, to: c.termMonths, text: `תקופה ${c.termMonths === 1 ? 'חודש אחד' : `${c.termMonths} חודשים`} במקום ${TERM_MONTHS}` });
  for (const l of c.lines || []) {
    out.push({
      kind: 'line', label: l.label, qty: l.qty ?? null, monthly: l.monthly ?? null,
      text: `שורה נוספת: ${l.label}${l.qty ? ` × ${l.qty}` : ''}${l.monthly ? ` · ${formatILS(l.monthly)} לחודש` : ''}`,
    });
  }
  if (c.terms) out.push({ kind: 'terms', text: 'תנאים מיוחדים' });
  return out;
}
export const isExceptional = (selection) => exceptionOf(selection).length > 0;

// "מה כלול" with the quantities changed by hand and the added lines.
function effectiveIncludes(sel) {
  const pid = packageId(sel.tier, sel.influencer);
  const c = sel.custom || {};
  const keys = INCLUDES_KEYS[pid] || [];
  const seen = new Set();
  const out = [];
  const line = (q, n) => ({ qty: n, label: q.label(n, sel) });
  for (const [i, inc] of PACKAGES[pid].includes.entries()) {
    const q = CUSTOM_QTY.find((x) => x.key === keys[i]);
    const v = q ? c.qty?.[q.key] : undefined;
    if (!given(v)) { out.push(inc); continue; }
    seen.add(q.key);
    if (v > 0) out.push(line(q, v));
  }
  for (const q of CUSTOM_QTY) {
    const v = c.qty?.[q.key];
    if (!q.label || seen.has(q.key) || !given(v) || v <= 0) continue;
    out.push(line(q, v));
  }
  for (const l of c.lines || []) out.push({ qty: l.qty ?? null, label: l.label });
  return out;
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
  const term = termOf(sel);
  const monthlyList = listPrice(sel);
  const discount = discountOf(sel);
  const monthlyNet = monthlyList - discount;
  const monthlyVat = Math.round((monthlyNet * VAT_RATE_PERCENT) / 100);
  const monthlyGross = monthlyNet + monthlyVat;
  return {
    monthlyList,
    discount,
    monthlyNet,
    monthlyVat,
    monthlyGross,
    termNet: monthlyNet * term,
    termVat: monthlyVat * term,
    termGross: monthlyGross * term,
  };
}

export function termsText(sel) {
  const term = termOf(sel);
  const monthly = sel.paid.includes('photographer')
    ? `, למעט שירות הצלם החודשי שמספק ${effectiveQuantities(sel).monthly} תכנים בכל חודש.`
    : '.';
  return `המחירים חודשיים ובהתחייבות ל־${term === 1 ? 'חודש אחד' : `${term} חודשים`}. `
    + `הכמויות בחבילה ובתוספות הן ${term === TERM_MONTHS ? 'לשנה' : 'לכל תקופת ההתקשרות'}${monthly} `
    + 'תוספות ללא עלות אינן משנות את המחיר.';
}

// What the agreement needs to know about the selected package.
function agreementContext(sel, { tier, paid, free, totals }) {
  const specs = effectiveQuantities(sel);
  const custom = sel.custom
    ? { monthlyContents: specs.monthly, extraLines: sel.custom.lines || [], specialTerms: sel.custom.terms || '' }
    : {};
  return {
    ...custom,
    termMonths: termOf(sel),
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
export function buildQuoteModel(selection, client = {}, meta = {}) {
  const sel = normalizeSelection(selection);
  const pid = packageId(sel.tier, sel.influencer);
  const pkg = PACKAGES[pid];
  const tier = TIERS.find((t) => t.id === sel.tier);
  const term = termOf(sel);
  const custom = sel.custom || null;
  const monthlyContents = effectiveQuantities(sel).monthly;
  const paid = PAID_ADDONS
    .filter((a) => sel.paid.includes(a.id))
    .map((a) => ({
      id: a.id, name: a.name,
      detail: a.monthlyOutput && monthlyContents !== MONTHLY_CONTENTS ? a.detail.replace(String(MONTHLY_CONTENTS), String(monthlyContents)) : a.detail,
      monthly: a.price, term: a.price * term,
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
  const price = packagePrice(sel);
  // A contract changed by hand: what was added to it, for the document.
  const extra = custom ? {
    custom: true,
    extraLines: (custom.lines || []).map((l) => ({ label: l.label, qty: l.qty ?? null, monthly: l.monthly ?? null })),
    specialTerms: custom.terms || '',
  } : {};
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
      monthly: price,
      term: price * term,
      includes: custom ? effectiveIncludes(sel) : pkg.includes,
    },
    paid,
    free,
    vatRate: VAT_RATE_PERCENT,
    termMonths: term,
    totals,
    terms: termsText(sel),
    legal: docType.signable ? agreementSections(agreementContext(sel, { tier, paid, free, totals })) : null,
    selection: sel,
    ...extra,
  };
}

const ils = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
export function formatILS(agorot) {
  return `${ils.format(agorot / 100)} ₪`;
}
