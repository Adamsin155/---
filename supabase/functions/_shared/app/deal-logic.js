// generated — edit app/ instead. Source: app/deal-logic.js. Regenerate: node scripts/sync-functions.mjs
// A new deal from the field (the owner's decision of 3.10.2026): Stav, the field
// sales agent, fills "עסקה חדשה" on deal.html and sends it "לעירית להכנת חוזה".
// Irit gets "להכין חוזה ל־<עסק>" with a 10-minute clock in office hours only (as
// every office clock: WORK_HOURS in protocol.js); the builder (index.html?deal=<id>)
// opens prefilled from the deal, and the quote it creates is linked to the deal.
// Stav sees only his own deals and their status.
//
// Pure, no DOM and no network: deal.html, Irit's block in "המשימות שלי", the builder
// and the reminder rules (app/reminder-rules.js, also on the server) share it. The
// table is public.deal_requests (supabase/migrations/20261003100000_sales_deals.sql).
import { TIERS, INFLUENCERS, PAID_ADDONS, FREE_ADDONS, MAX_DISCOUNT, DOC_TYPES, CUSTOM_QTY, CUSTOM_LIMITS } from './catalog.js';
import { emptySelection, reconcile, formatILS } from './pricing.js';
import { addWorkingMinutes, parseDate } from './protocol-logic.js';
import { isSales } from './protocol.js';

// Sales land on their page, always (clients.html and the office's pages send them
// there): they have no client work and see nothing of the clients.
export const SALES_SCREEN = 'deal.html';
export const landingOf = (person) => (isSales(person) ? SALES_SCREEN : null);

// Irit's clock: 10 minutes of office time from the moment the deal came in.
export const DEAL_MINUTES = 10;

// The statuses as Stav reads them.
export const DEAL_STATUS = {
  pending: 'ממתין לחוזה',
  // An exceptional contract (another offer, or anything Irit changed by hand): Irit
  // prepared it and a manager decides (6.10.2026).
  approval: 'ממתין לאישור מנהל',
  rejected: 'לא אושר',
  sent: 'חוזה נשלח',
  signed: 'נחתם',
  cancelled: 'בוטל',
};
export const statusText = (d) => DEAL_STATUS[d?.status] || '';

export const contractTitle = (d) => `להכין חוזה ל־${String(d?.business_name || '').trim()}`;
// Where Irit's notification opens: the builder, prefilled from the deal.
export const dealUrl = (d) => `index.html?deal=${encodeURIComponent(d.id)}`;
export const dealDue = (d) => { const at = parseDate(d?.created_at); return at ? addWorkingMinutes(at, DEAL_MINUTES) : null; };

const LIMITS = { business_name: 120, contact_name: 120, phone: 30, notes: 2000 };
const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// The add-ons a deal may carry for this package (the builder's rules, app/pricing.js).
export function addonsFor(tier, influencer) {
  const sel = { ...emptySelection(), tier, influencer, paid: PAID_ADDONS.map((a) => a.id), free: { graphics: 0, simeonStories: 1, simeonJoin: true, extraCh14: false } };
  const { selection } = reconcile(sel);
  return {
    paid: PAID_ADDONS.filter((a) => selection.paid.includes(a.id)),
    free: Object.values(FREE_ADDONS).filter((f) => (f.id === 'simeonJoin' ? selection.free.simeonJoin : f.id === 'simeonStories' ? selection.free.simeonStories > 0 : true)),
  };
}

// Checks the form and returns the row to insert ({ ok, errors: { field: words }, row }).
// `form`: { business_name, contact_name, phone, tier, influencer, paid: [ids],
// free: { graphics, simeonStories, simeonJoin, extraCh14 }, discount (₪ a month), notes }.
export function validateDeal(form = {}) {
  const errors = {};
  const row = {
    business_name: clean(form.business_name, LIMITS.business_name),
    contact_name: clean(form.contact_name, LIMITS.contact_name),
    phone: clean(form.phone, LIMITS.phone),
    notes: String(form.notes ?? '').trim().slice(0, LIMITS.notes) || null,
  };
  if (!row.business_name) errors.business_name = 'חסר שם העסק.';
  if (!row.contact_name) errors.contact_name = 'חסר איש קשר.';
  const digits = row.phone.replace(/\D/g, '');
  if (!row.phone) errors.phone = 'חסר טלפון.';
  else if (digits.length < 9 || digits.length > 12 || !/^[\d\s()+-]+$/.test(row.phone)) errors.phone = 'מספר הטלפון לא תקין.';
  if (form.kind === 'custom') return validateCustomDeal(form, row, errors);
  if (!TIERS.some((t) => t.id === form.tier)) errors.tier = 'בחרו חבילה.';
  if (!INFLUENCERS[form.influencer]) errors.influencer = 'בחרו משפיענים.';
  const discount = Number(form.discount ?? 0);
  if (!Number.isFinite(discount) || discount < 0 || discount * 100 > MAX_DISCOUNT || Math.round(discount) !== discount) {
    errors.discount = `הנחה בשקלים שלמים, עד ${MAX_DISCOUNT / 100} ₪ לחודש.`;
  }
  if (Object.keys(errors).length) return { ok: false, errors, row: null };
  const f = form.free || {};
  const { selection } = reconcile({
    ...emptySelection(), tier: form.tier, influencer: form.influencer,
    paid: PAID_ADDONS.map((a) => a.id).filter((id) => (form.paid || []).includes(id)),
    free: {
      graphics: Math.max(0, Math.min(FREE_ADDONS.graphics.max, Math.round(Number(f.graphics) || 0))),
      simeonStories: Math.max(0, Math.min(FREE_ADDONS.simeonStories.max, Math.round(Number(f.simeonStories) || 0))),
      simeonJoin: f.simeonJoin === true, extraCh14: f.extraCh14 === true,
    },
  });
  return {
    ok: true, errors: {},
    row: { ...row, tier: selection.tier, influencer: selection.influencer, paid: selection.paid, free: selection.free, discount_agorot: Math.round(discount * 100) },
  };
}

// "הצעה אחרת" (6.10.2026): not one of the built-in packages. The seller writes what it
// includes, optional quantities (videos, graphics, shoot days), the monthly price he
// agreed (whole shekels, before VAT) and the term. Stored in deal_requests.custom; the
// table checks the same limits. Irit builds a custom contract from it, and a manager
// approves it before the client can sign.
export const DEAL_CUSTOM_QTY = [['videos', 'סרטונים'], ['graphics', 'גרפיקות'], ['shoot_days', 'ימי צילום']];
const QTY_MAX = { videos: 'videos', graphics: 'graphics', shoot_days: 'shootDays' };
const qtyMax = (k) => CUSTOM_QTY.find((q) => q.key === QTY_MAX[k]).max;
export const isCustomDeal = (d) => !!d?.custom && typeof d.custom === 'object';
function validateCustomDeal(form, row, errors) {
  const custom = { description: String(form.description ?? '').trim() };
  if (!custom.description) errors.description = 'כתבו מה ההצעה כוללת.';
  else if (custom.description.length > CUSTOM_LIMITS.terms) errors.description = `עד ${CUSTOM_LIMITS.terms} תווים.`;
  for (const [k, name] of DEAL_CUSTOM_QTY) {
    const raw = form[k];
    if (raw === '' || raw === null || raw === undefined) continue;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 0 || v > qtyMax(k)) errors[k] = `${name}: מספר שלם, עד ${qtyMax(k)}.`;
    else custom[k] = v;
  }
  const price = Number(form.price);
  if (form.price === '' || form.price === null || form.price === undefined || !Number.isInteger(price) || price < 1 || price * 100 > CUSTOM_LIMITS.priceMax) {
    errors.price = 'המחיר החודשי שסוכם, בשקלים שלמים לפני מע״מ.';
  } else custom.price_agorot = price * 100;
  const term = form.term_months === '' || form.term_months === null || form.term_months === undefined ? 12 : Number(form.term_months);
  if (!Number.isInteger(term) || term < CUSTOM_LIMITS.termMin || term > CUSTOM_LIMITS.termMax) errors.term_months = `תקופה בחודשים, ${CUSTOM_LIMITS.termMin} עד ${CUSTOM_LIMITS.termMax}.`;
  else custom.term_months = term;
  if (Object.keys(errors).length) return { ok: false, errors, row: null };
  return { ok: true, errors: {}, row: { ...row, tier: null, influencer: null, paid: [], free: {}, discount_agorot: 0, custom } };
}

// One line of what was sold, for Irit's notification and her task.
export function dealSummary(d) {
  if (isCustomDeal(d)) {
    const c = d.custom;
    const qty = DEAL_CUSTOM_QTY.filter(([k]) => Number.isInteger(c[k])).map(([k, name]) => `${c[k]} ${name}`);
    const text = String(c.description || '').replace(/\s+/g, ' ').trim();
    return ['הצעה אחרת', `${formatILS(c.price_agorot)} לחודש`, c.term_months === 1 ? 'חודש אחד' : `${c.term_months} חודשים`, ...qty, text.length > 80 ? `${text.slice(0, 80)}…` : text].filter(Boolean).join(' · ');
  }
  const tier = TIERS.find((t) => t.id === d?.tier);
  const parts = [[tier?.short, INFLUENCERS[d?.influencer]?.name].filter(Boolean).join(' · ')];
  const extras = addonNames(d);
  if (extras.length) parts.push(`תוספות: ${extras.join(', ')}`);
  if (d?.discount_agorot) parts.push(`הנחה ${formatILS(d.discount_agorot)} לחודש`);
  return parts.filter(Boolean).join(' · ');
}

// The add-ons of a deal in words ("צלם חודשי", "גרפיקות נוספות (6)").
export function addonNames(d) {
  const f = d?.free || {};
  return [
    ...(d?.paid || []).map((id) => PAID_ADDONS.find((a) => a.id === id)?.name).filter(Boolean),
    f.graphics > 0 ? `${FREE_ADDONS.graphics.name} (${f.graphics})` : null,
    f.simeonStories > 0 ? `${FREE_ADDONS.simeonStories.name} (${f.simeonStories})` : null,
    f.simeonJoin ? FREE_ADDONS.simeonJoin.name : null,
    f.extraCh14 ? FREE_ADDONS.extraCh14.name : null,
  ].filter(Boolean);
}

// The builder, opened from the deal: an agreement with the deal's package, add-ons
// and discount, and the client's details. Anything the catalog no longer allows is
// left out (reconcile), as in the builder itself.
export function prefillFromDeal(d) {
  if (isCustomDeal(d)) return prefillFromCustomDeal(d);
  const { selection } = reconcile({
    ...emptySelection(),
    docType: DOC_TYPES.agreement.id,
    tier: TIERS.some((t) => t.id === d?.tier) ? d.tier : emptySelection().tier,
    influencer: INFLUENCERS[d?.influencer] ? d.influencer : emptySelection().influencer,
    paid: Array.isArray(d?.paid) ? d.paid.filter((id) => PAID_ADDONS.some((a) => a.id === id)) : [],
    free: { ...emptySelection().free, ...(d?.free || {}) },
    discount: Math.max(0, Math.min(MAX_DISCOUNT, Number(d?.discount_agorot) || 0)),
  });
  return {
    selection,
    client: {
      'c-name': d?.contact_name || '',
      'c-company': d?.business_name || '',
      'c-phone': d?.phone || '',
      'c-notes': d?.notes || '',
    },
  };
}

// Another offer: the builder opens in "חוזה מותאם אישית" on a base package Irit picks
// (the default one to begin with), with the seller's numbers as the overrides and his
// description as the draft of the special terms.
function prefillFromCustomDeal(d) {
  const c = d.custom;
  const qty = {};
  for (const [k] of DEAL_CUSTOM_QTY) if (Number.isInteger(c[k])) qty[QTY_MAX[k]] = Math.min(c[k], qtyMax(k));
  const custom = { terms: String(c.description || '').slice(0, CUSTOM_LIMITS.terms) };
  if (Object.keys(qty).length) custom.qty = qty;
  if (Number.isInteger(c.price_agorot)) custom.price = Math.max(0, Math.min(CUSTOM_LIMITS.priceMax, c.price_agorot));
  if (Number.isInteger(c.term_months)) custom.termMonths = Math.max(CUSTOM_LIMITS.termMin, Math.min(CUSTOM_LIMITS.termMax, c.term_months));
  return {
    selection: { ...emptySelection(), docType: DOC_TYPES.agreement.id, custom },
    client: { 'c-name': d?.contact_name || '', 'c-company': d?.business_name || '', 'c-phone': d?.phone || '', 'c-notes': d?.notes || '' },
  };
}

// Stav's list: newest first.
export const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);
// Irit's list: the deals still waiting for a contract, oldest (most urgent) first.
export const pendingDeals = (deals = []) => deals.filter((d) => d.status === 'pending').sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
