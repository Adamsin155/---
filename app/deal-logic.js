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
import { TIERS, INFLUENCERS, PAID_ADDONS, FREE_ADDONS, MAX_DISCOUNT, DOC_TYPES } from './catalog.js';
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

// One line of what was sold, for Irit's notification and her task.
export function dealSummary(d) {
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

// Stav's list: newest first.
export const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);
// Irit's list: the deals still waiting for a contract, oldest (most urgent) first.
export const pendingDeals = (deals = []) => deals.filter((d) => d.status === 'pending').sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
