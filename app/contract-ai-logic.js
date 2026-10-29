// "הכנת חוזה עם AI" (the owner's request, 25.10.2026; docs/ops.md, section 68). Irit writes the
// deal in her own words, e.g. "חבילה נטלי 3500, 20 סרטונים במקום 25, בלי Highlights, 12 חודשים,
// 2 ימי צילום"; the contract-ai edge function asks Claude for the builder's own settings as strict
// JSON, and the builder fills itself as if she had set it by hand. This module is the pure part
// that the builder and the edge function share (a copy runs on the server:
// supabase/functions/_shared/app/, node scripts/sync-functions.mjs):
//   systemPrompt()      what the builder offers, generated from app/catalog.js (the packages with
//                       their keys, prices and quantities, the add-ons, the quantities that change
//                       by hand with their limits, the term, the discount rules), and how to answer:
//                       never a price that was not written, a question for anything unclear;
//   RESULT_SCHEMA       the JSON the model must answer with (structured outputs);
//   validateAiResult()  the answer checked against the catalog: unknown keys dropped, numbers
//                       clamped to the limits, with the list of what was dropped or changed;
//   applyAiResult()     the builder's selection with the result set the way the builder's own
//                       controls set it (the package, the add-ons, then "חוזה מותאם אישית": the
//                       quantities, the price, the term, added lines, special terms, the discount),
//                       with a line per setting for the summary and the values behind the
//                       "מולא אוטומטית" tags;
//   aiMarksOf()         which of those tags still hold (a field Irit changed afterwards loses it).
// The totals and the approval rules stay the pricing engine's (app/pricing.js). Nothing here
// talks to the network, and nothing here decides a price: a price is either the one written in
// the text or the package's own.
import {
  VAT_RATE_PERCENT, TERM_MONTHS, INFLUENCERS, STARS, TIERS, PACKAGES, PAID_ADDONS, FREE_ADDONS,
  MAX_DISCOUNT, MAX_DISCOUNT_PODCAST, maxDiscountFor, CUSTOM_QTY, CUSTOM_LIMITS, MONTHLY_CONTENTS, packageId,
} from './catalog.js';
import {
  emptySelection, reconcile, baseQuantities, computeTotals, normalizeSelection,
  paidAddonAvailable, freeAddonAvailable, formatILS,
} from './pricing.js';

// The longest text the office may send (the database keeps it with the run).
export const AI_TEXT_MAX = 2000;
// The limits of what the answer may carry (the builder's own limits where it has them).
export const AI_LIMITS = {
  clauses: 12, clause: 300, questions: 8, question: 300, notes: 500, minPrice: 10000, minLinePrice: 1000,
};

export const PACKAGE_KEYS = Object.keys(PACKAGES);
export const QTY_KEYS = CUSTOM_QTY.map((q) => q.key);
export const PAID_IDS = PAID_ADDONS.map((a) => a.id);
export const FREE_KEYS = ['graphics', 'simeonStories', 'simeonJoin', 'extraCh14'];
const FREE_NUMBERS = { graphics: FREE_ADDONS.graphics.max, simeonStories: FREE_ADDONS.simeonStories.max };
// What the model may name in `removals`: a quantity of the contract that goes to 0 (the monthly
// photographer's contents cannot be 0: that add-on is simply not chosen).
const REMOVABLE = CUSTOM_QTY.filter((q) => !q.min).map((q) => q.key);
// What an influencer brings to a package (none of it in a contract "בלי משפיענים").
const INF_KEYS = ['shootDays', 'collabs', 'stories'];

const tierOf = (id) => TIERS.find((t) => t.id === id);
const qtyDef = (key) => CUSTOM_QTY.find((q) => q.key === key);
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const BIDI = /[‎‏‪-‮⁦-⁩]/g;
const cleanLine = (v) => String(v ?? '').replace(BIDI, '').replace(/\s+/g, ' ').trim();
// Shekels with a thousands comma, the same in every runtime (the prompt must never change by itself).
const ils = (agorot) => `${String(Math.round(agorot / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ₪`;
const wholeShekels = (agorot) => Math.round(agorot / 100) * 100;

/* ── The prompt ─────────────────────────────── */

const ELIGIBILITY = {
  all: 'any package',
  // A star's own reel and story (Natali; Niro and "הצל" since 28.10.2026).
  ...Object.fromEntries(STARS.map((inf) => [inf, `only packages with ${INFLUENCERS[inf].name}`])),
  'simeon-social': `only the Social and Social + TV packages with ${INFLUENCERS.simeon.name}`,
};

// What the builder offers, from the catalog itself (a change in app/catalog.js changes the prompt).
export function catalogText() {
  const packages = PACKAGE_KEYS.map((key) => {
    const p = PACKAGES[key];
    const tier = tierOf(p.tier);
    const q = baseQuantities({ tier: p.tier, influencer: p.influencer, paid: [] });
    const lines = p.includes.map((i) => (i.qty === null ? `- ${i.label}` : `- ${i.qty} ${i.label}`)).join('\n');
    return [
      `### \`${key}\`: ${tier.name} (${tier.short}) with ${INFLUENCERS[p.influencer].name}, ${ils(p.price)} a month`,
      lines,
      `Quantities: ${QTY_KEYS.filter((k) => k !== 'monthly').map((k) => `${k} ${q[k]}`).join(', ')}`,
    ].join('\n');
  }).join('\n\n');
  const paid = PAID_ADDONS.map((a) => `- \`${a.id}\`: ${a.name}, ${ils(a.price)} a month, ${ELIGIBILITY[a.eligibility]}. ${a.detail}`).join('\n');
  const free = [
    `- \`graphics\`: ${FREE_ADDONS.graphics.name}, a number 0–${FREE_ADDONS.graphics.max} on top of the package's graphics.`,
    `- \`simeonStories\`: ${FREE_ADDONS.simeonStories.name}, a number 0–${FREE_ADDONS.simeonStories.max}; only Social and Social + TV with ${INFLUENCERS.simeon.name}, or a ${INFLUENCERS.natali.name} package with simeonJoin.`,
    `- \`simeonJoin\`: ${FREE_ADDONS.simeonJoin.name}, true or false; only ${INFLUENCERS.natali.name} packages. ${FREE_ADDONS.simeonJoin.detail}`,
    `- \`extraCh14\`: ${FREE_ADDONS.extraCh14.name}, true or false (${FREE_ADDONS.extraCh14.detail}).`,
  ].join('\n');
  const qty = CUSTOM_QTY.map((q) => `- \`${q.key}\`: ${q.name}, ${q.min || 0}–${q.max}`
    + (q.addon ? ` (only with the \`${q.addon}\` add-on; ${MONTHLY_CONTENTS} by default)` : '')).join('\n');
  return [
    '## Packages',
    `A package is a tier with an influencer. Prices are monthly, in shekels, before VAT (${VAT_RATE_PERCENT}%). Quantities are for the whole contract.`,
    packages,
    '## Paid add-ons (on top of the package price)',
    paid,
    '## Free add-ons (no price)',
    free,
    '## Quantities of the package that can be changed (key: name, allowed range, for the whole contract)',
    qty,
    '## Term',
    `${TERM_MONTHS} months unless the deal says otherwise; ${CUSTOM_LIMITS.termMin}–${CUSTOM_LIMITS.termMax} months.`,
    '## Price and discount',
    `- The package's monthly price before VAT can be set by hand, up to ${ils(CUSTOM_LIMITS.priceMax)}.`,
    `- A monthly discount before VAT: up to ${ils(MAX_DISCOUNT)} is regular (up to ${ils(MAX_DISCOUNT_PODCAST)} in a podcast package); a larger one is allowed in a custom contract. It can never be more than the monthly price.`,
    '## Extra lines',
    `Things that are sold but are in no package (for example "אתר תדמית"): up to ${CUSTOM_LIMITS.lines} lines, each a label of up to ${CUSTOM_LIMITS.lineLabel} characters, an optional quantity and an optional monthly price.`,
    '## Special terms',
    'Short clauses in Hebrew printed at the end of the agreement, for anything agreed that has no setting of its own: something left out that is not a quantity above (for example "ללא Highlights"), payment, exit or exclusivity terms.',
  ].join('\n\n');
}

const RULES = `# How to answer
Fill the settings the way the office would by hand, using only the options above. Set only what the text says; leave everything else null or empty, and the builder keeps the package's own values.
- package: the key of the package the text describes. "N במקום M" means M is the package's own quantity, so use it to tell the packages apart (for example "20 סרטונים במקום 25" points to a package with 25 videos). A price written in the text is not a reason to pick a package. If the package cannot be told, use null and ask.
- months: only when the text states the term.
- quantities: a list with one item {key, value} for each quantity the text changes, the value being the new number for the whole contract ("2 ימי צילום" means {key: "shootDays", value: 2}). Quantities the text does not change are not in the list.
- removals: keys of the quantities above that the text leaves out ("בלי קולאב" means collabs). Something that is not one of these quantities goes to specialClauses instead.
- addons and freeAddons: only what the text asks for. freeAddons is a list of {key, value}; for simeonJoin and extraCh14 the value is 1 (yes) or 0 (no).
- monthlyPrice: only when the text states a price. A price written in the deal is the package's monthly price before VAT, in agorot (3500 means 350000), unless the text says it includes VAT (then priceIncludesVat is true and the number is given as written). If the price may be for the whole term, or may include the add-ons, keep it as written and ask. Never compute, round or guess a price, and never fill in a price the text does not state.
- discount: a monthly discount before VAT in agorot, only when the text states an amount; discountPercent when it states a percentage.
- extraLines: things that are sold but are in no package; a monthly price only when the text states one.
- specialClauses: short Hebrew sentences for the agreement, one per clause.
- questions: short Hebrew questions to the office about anything unclear, missing or contradictory (a number without what it counts, two possible packages, a price that may include VAT, an add-on the package does not allow). Ask rather than guess.
- client: the customer's details when the text gives them: name (the person), company (the business), companyId (ח.פ / ע.מ, digits), phone, email. Write "" for anything the text does not give; never invent one.
- notes: one short Hebrew sentence for the office about the result, or null.
Write every text for the office in Hebrew.`;

let PROMPT = null;
// The system prompt: the same text on every call (no date, nothing per request), so it is cached.
export function systemPrompt() {
  PROMPT ??= [
    'You turn a deal that the office of Astrateg, an Israeli social media agency, wrote in free Hebrew into the settings of its contract builder. You never invent anything the text does not say.',
    '# The builder\'s options',
    catalogText(),
    RULES,
  ].join('\n\n');
  return PROMPT;
}

// The user turn: the office's words, marked as data.
export function userMessage(text) {
  return `פרטי העסקה כפי שנרשמו במשרד:\n<deal>\n${String(text ?? '')}\n</deal>`;
}

/* ── The answer's shape (structured outputs) ── */

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const INT = { type: 'integer' };
const object = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export const RESULT_SCHEMA = object({
  package: nullable({ type: 'string', enum: PACKAGE_KEYS }),
  months: nullable(INT),
  // Lists of {key, value} rather than objects of nullable numbers: the API allows at most 16 union-typed
  // parameters in a schema (found live, 25.10.2026: "too many parameters with union types").
  quantities: { type: 'array', items: object({ key: { type: 'string', enum: QTY_KEYS }, value: INT }) },
  removals: { type: 'array', items: { type: 'string', enum: REMOVABLE } },
  addons: { type: 'array', items: { type: 'string', enum: PAID_IDS } },
  freeAddons: { type: 'array', items: object({ key: { type: 'string', enum: ['graphics', 'simeonStories', 'simeonJoin', 'extraCh14'] }, value: INT }) },
  monthlyPrice: nullable(INT),
  priceIncludesVat: { type: 'boolean' },
  discount: nullable(INT),
  discountPercent: nullable({ type: 'number' }),
  extraLines: { type: 'array', items: object({ label: { type: 'string' }, qty: nullable(INT), monthly: nullable(INT) }) },
  specialClauses: { type: 'array', items: { type: 'string' } },
  questions: { type: 'array', items: { type: 'string' } },
  // "" when not given: plain strings keep the schema under the API's limit of union-typed parameters.
  client: object({ name: { type: 'string' }, company: { type: 'string' }, companyId: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' } }),
  notes: nullable({ type: 'string' }),
});

/* ── Checking the answer against the catalog ── */

// A whole number from what the model wrote (a number, or digits), or null.
function toInt(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Math.round(Number(v));
  return null;
}
const given = (v) => v !== undefined && v !== null;
const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const texts = (v) => (Array.isArray(v) ? v : []).map(cleanLine).filter(Boolean);
const KNOWN = Object.keys(RESULT_SCHEMA.properties);

// The model's answer, checked: { result, dropped }. `result` holds only known keys with values the
// builder accepts; `dropped` lists, in Hebrew, everything that was left out or brought into range
// ({ field, text }), for the office to see. Never throws.
export function validateAiResult(raw) {
  const dropped = [];
  const drop = (field, text) => dropped.push({ field, text });
  const r = isObject(raw) ? raw : {};
  if (!isObject(raw)) drop('', 'התשובה לא הייתה בפורמט הנכון');
  for (const k of Object.keys(r)) if (!KNOWN.includes(k)) drop(k, `שדה לא מוכר: ${k}`);
  const out = {
    package: null, months: null, quantities: {}, removals: [], addons: [], freeAddons: {},
    monthlyPrice: null, priceIncludesVat: false, discount: null, discountPercent: null,
    extraLines: [], specialClauses: [], questions: [], notes: null, client: {},
  };

  if (given(r.package)) {
    if (typeof r.package === 'string' && PACKAGES[r.package]) out.package = r.package;
    else drop('package', `חבילה לא מוכרת: ${cleanLine(r.package)}`);
  }

  if (given(r.months)) {
    const m = toInt(r.months);
    if (m === null) drop('months', 'תקופה לא מספרית');
    else {
      out.months = Math.max(CUSTOM_LIMITS.termMin, Math.min(CUSTOM_LIMITS.termMax, m));
      if (out.months !== m) drop('months', `תקופה של ${m} חודשים מחוץ לטווח (${CUSTOM_LIMITS.termMin}–${CUSTOM_LIMITS.termMax}): הוזנו ${out.months}`);
    }
  }

  // The schema sends lists of {key, value}; an object (older answers, the tests) is read too.
  const pairs = (v) => Object.fromEntries(v.filter((x) => isObject(x) && typeof x.key === 'string').map((x) => [x.key, x.value]));
  const q = Array.isArray(r.quantities) ? pairs(r.quantities) : isObject(r.quantities) ? r.quantities : {};
  if (given(r.quantities) && !isObject(r.quantities) && !Array.isArray(r.quantities)) drop('quantities', 'הכמויות לא בפורמט הנכון');
  for (const [k, v] of Object.entries(q)) {
    const def = qtyDef(k);
    if (!def) { drop(`quantities.${k}`, `כמות לא מוכרת: ${k}`); continue; }
    if (!given(v)) continue;
    const n = toInt(v);
    if (n === null) { drop(`quantities.${k}`, `${def.name}: לא מספר`); continue; }
    const lo = def.min || 0;
    const c = Math.max(lo, Math.min(def.max, n));
    if (c !== n) drop(`quantities.${k}`, `${def.name}: ${n} מחוץ לטווח (${lo}–${def.max}), הוזן ${c}`);
    out.quantities[k] = c;
  }

  for (const k of Array.isArray(r.removals) ? r.removals : []) {
    if (REMOVABLE.includes(k)) {
      if (!out.removals.includes(k) && !given(out.quantities[k])) out.removals.push(k);
    } else drop('removals', `אין בחוזה פריט בשם ״${cleanLine(k)}״ להסרה`);
  }

  for (const id of Array.isArray(r.addons) ? r.addons : []) {
    if (!PAID_IDS.includes(id)) drop('addons', `תוספת לא מוכרת: ${cleanLine(id)}`);
    else if (!out.addons.includes(id)) out.addons.push(id);
  }
  // In the catalog's order, as the builder keeps it.
  out.addons = PAID_IDS.filter((id) => out.addons.includes(id));

  const BOOL_FREE = ['simeonJoin', 'extraCh14'];
  const f = Array.isArray(r.freeAddons) ? Object.fromEntries(Object.entries(pairs(r.freeAddons)).map(([k, v]) => [k, BOOL_FREE.includes(k) ? (typeof v === 'boolean' ? v : Number(v) > 0) : v])) : isObject(r.freeAddons) ? r.freeAddons : {};
  for (const [k, v] of Object.entries(f)) {
    if (!FREE_KEYS.includes(k)) { drop(`freeAddons.${k}`, `תוספת ללא עלות לא מוכרת: ${k}`); continue; }
    if (!given(v)) continue;
    if (k in FREE_NUMBERS) {
      const n = toInt(v);
      if (n === null) { drop(`freeAddons.${k}`, `${FREE_ADDONS[k].name}: לא מספר`); continue; }
      const c = Math.max(0, Math.min(FREE_NUMBERS[k], n));
      if (c !== n) drop(`freeAddons.${k}`, `${FREE_ADDONS[k].name}: ${n} מחוץ לטווח (0–${FREE_NUMBERS[k]}), הוזן ${c}`);
      out.freeAddons[k] = c;
    } else if (typeof v === 'boolean') out.freeAddons[k] = v;
    else drop(`freeAddons.${k}`, `${FREE_ADDONS[k].name}: לא כן/לא`);
  }

  // The checked price is always before VAT (so the result can be checked again, by the builder,
  // without taking the VAT off twice); a price written with VAT is said under "צריך לבדוק:".
  if (given(r.monthlyPrice)) {
    let p = toInt(r.monthlyPrice);
    if (p === null || p < 0) drop('monthlyPrice', 'מחיר לא מספרי');
    else {
      if (r.priceIncludesVat === true) {
        const gross = p;
        p = wholeShekels(Math.round((p * 100) / (100 + VAT_RATE_PERCENT)));
        drop('priceIncludesVat', `המחיר שנכתב כולל מע״מ (${formatILS(gross)}): הוזן ${formatILS(p)} לפני מע״מ`);
      }
      p = wholeShekels(p);
      if (p < AI_LIMITS.minPrice) {
        drop('monthlyPrice', `מחיר חודשי של ${formatILS(p)} נראה שגוי ולא הוזן`);
        out.questions.push('מה המחיר החודשי של החבילה לפני מע״מ?');
      } else if (p > CUSTOM_LIMITS.priceMax) drop('monthlyPrice', `מחיר חודשי מעל ${formatILS(CUSTOM_LIMITS.priceMax)} לא הוזן`);
      else out.monthlyPrice = p;
    }
  }

  if (given(r.discount)) {
    const d = toInt(r.discount);
    if (d === null || d < 0) drop('discount', 'הנחה לא מספרית');
    else out.discount = Math.min(wholeShekels(d), CUSTOM_LIMITS.priceMax);
  } else if (given(r.discountPercent)) {
    const pct = Number(r.discountPercent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) drop('discountPercent', 'אחוז ההנחה מחוץ לטווח');
    else out.discountPercent = pct;
  }

  for (const l of Array.isArray(r.extraLines) ? r.extraLines : []) {
    const label = cleanLine(isObject(l) ? l.label : '');
    if (!label) { drop('extraLines', 'שורה נוספת בלי שם'); continue; }
    if (out.extraLines.length >= CUSTOM_LIMITS.lines) { drop('extraLines', `יותר מ־${CUSTOM_LIMITS.lines} שורות נוספות: ״${clip(label, 40)}״ לא הוזנה`); continue; }
    const line = { label: clip(label, CUSTOM_LIMITS.lineLabel) };
    const qn = toInt(l.qty);
    if (qn !== null && qn >= 1) line.qty = Math.min(qn, CUSTOM_LIMITS.lineQtyMax);
    const mo = toInt(l.monthly);
    if (mo !== null && mo >= AI_LIMITS.minLinePrice) line.monthly = Math.min(wholeShekels(mo), CUSTOM_LIMITS.linePriceMax);
    else if (mo !== null && mo > 0) drop('extraLines', `מחיר של ${formatILS(mo)} לחודש ל״${clip(label, 40)}״ נראה שגוי ולא הוזן`);
    out.extraLines.push(line);
  }

  let room = CUSTOM_LIMITS.terms;
  for (const c of texts(r.specialClauses)) {
    const clause = clip(c, AI_LIMITS.clause);
    if (out.specialClauses.length >= AI_LIMITS.clauses || clause.length + 1 > room) { drop('specialClauses', `תנאי לא נכנס (ארוך מדי): ״${clip(c, 40)}״`); continue; }
    out.specialClauses.push(clause);
    room -= clause.length + 1;
  }
  out.questions = [...out.questions, ...texts(r.questions).map((s) => clip(s, AI_LIMITS.question))].slice(0, AI_LIMITS.questions);
  const notes = cleanLine(r.notes);
  out.notes = notes ? clip(notes, AI_LIMITS.notes) : null;
  // The customer's details (the builder's "פרטי הלקוח"): only what the text gave, in the form's own limits.
  if (given(r.client)) {
    const c = isObject(r.client) ? r.client : {};
    const name = clip(cleanLine(c.name), 120);
    const company = clip(cleanLine(c.company), 120);
    const idText = cleanLine(c.companyId);
    const idDigits = idText.replace(/[^0-9]/g, '');
    const phoneText = cleanLine(c.phone);
    const phone = phoneText.replace(/[^0-9+\-\s()]/g, '').trim().slice(0, 40);
    const email = cleanLine(c.email).slice(0, 160);
    if (name) out.client.name = name;
    if (company) out.client.company = company;
    if (idDigits) {
      if (idDigits.length >= 8 && idDigits.length <= 9) out.client.companyId = idDigits;
      else drop('client.companyId', `ח.פ / ע.מ לא תקין: ${idText}`);
    }
    if (phoneText) {
      if (phone.replace(/\D/g, '').length >= 9) out.client.phone = phone;
      else drop('client.phone', `טלפון לא תקין: ${phoneText}`);
    }
    if (email) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.client.email = email;
      else drop('client.email', `אימייל לא תקין: ${email}`);
    }
  }
  return { result: out, dropped };
}

/* ── Filling the builder ─────────────────────── */

const pkgName = (sel) => `${tierOf(sel.tier).name} · ${INFLUENCERS[sel.influencer].name}`;
const paidName = (id) => PAID_ADDONS.find((a) => a.id === id)?.name || id;

// The builder's selection with the result set on it, as the builder's own controls set it:
// { selection, marks, summary, skipped }. The text describes the whole deal, so it starts from
// the package itself (the document type stays as chosen); `selection.custom` is there only when
// something differs from what a regular contract allows (as the "חוזה מותאם אישית" switch).
// `marks`: the value each field got ('package', 'paid:<id>', 'free:<key>', 'q:<key>', 'price',
// 'term', 'discount', 'lines', 'terms'), for the tags. `summary`: a Hebrew line per setting.
// `skipped`: what could not be set in this package, in Hebrew.
export function applyAiResult(current, result) {
  const r = result || validateAiResult({}).result;
  const docType = current?.docType || 'agreement';
  const marks = {};
  const summary = [];
  const skipped = [];
  let sel = { ...emptySelection(), docType, tier: current?.tier || 'social', influencer: current?.influencer || 'simeon' };
  if (r.package && PACKAGES[r.package]) {
    sel.tier = PACKAGES[r.package].tier;
    sel.influencer = PACKAGES[r.package].influencer;
    marks.package = r.package;
    summary.push(`חבילה: ${pkgName(sel)} (${formatILS(PACKAGES[r.package].price)} לחודש)`);
  } else {
    summary.push(`חבילה: לא זוהתה בטקסט, נשארה ${pkgName(sel)}`);
  }
  const pkg = PACKAGES[packageId(sel.tier, sel.influencer)];

  // Paid add-ons, only those the package allows.
  for (const id of r.addons || []) {
    const addon = PAID_ADDONS.find((a) => a.id === id);
    if (!addon) continue;
    if (!paidAddonAvailable(addon, sel)) { skipped.push(`${addon.name}: לא זמינה בחבילה שנבחרה`); continue; }
    sel.paid = PAID_IDS.filter((x) => x === id || sel.paid.includes(x));
    marks[`paid:${id}`] = true;
    summary.push(`תוספת: ${addon.name} (+${formatILS(addon.price)} לחודש)`);
  }

  // Free add-ons (simeonJoin first: it opens Simeon's stories in a Natali package).
  const free = r.freeAddons || {};
  for (const key of ['simeonJoin', 'extraCh14', 'graphics', 'simeonStories']) {
    const v = free[key];
    if (!given(v) || v === false || v === 0) continue;
    if (!freeAddonAvailable(key, sel)) { skipped.push(`${FREE_ADDONS[key].name}: לא זמינה בחבילה שנבחרה`); continue; }
    sel.free = { ...sel.free, [key]: v };
    marks[`free:${key}`] = v;
    summary.push(typeof v === 'number' ? `ללא עלות: ${FREE_ADDONS[key].name} × ${v}` : `ללא עלות: ${FREE_ADDONS[key].name}`);
  }

  // The custom contract: what differs from the package (as its steppers and fields keep it).
  const custom = {};
  const base = baseQuantities(sel);
  const qty = {};
  const wanted = { ...Object.fromEntries((r.removals || []).map((k) => [k, 0])), ...(r.quantities || {}) };
  for (const def of CUSTOM_QTY) {
    const v = wanted[def.key];
    if (!given(v)) continue;
    if (def.addon && !sel.paid.includes(def.addon)) { skipped.push(`${def.name}: רק עם ${paidName(def.addon)}`); continue; }
    if (v === base[def.key]) { summary.push(`${def.name}: ${v} (כמו בחבילה)`); continue; }
    qty[def.key] = v;
    marks[`q:${def.key}`] = v;
    summary.push(v === 0 ? `${def.name}: בלי (בחבילה ${base[def.key]})` : `${def.name}: ${v} (בחבילה ${base[def.key]})`);
  }
  if (Object.keys(qty).length) custom.qty = qty;
  if (given(r.monthlyPrice)) {
    if (r.monthlyPrice === pkg.price) summary.push(`מחיר החבילה: ${formatILS(r.monthlyPrice)} לחודש לפני מע״מ (כמו בחבילה)`);
    else {
      custom.price = r.monthlyPrice;
      marks.price = r.monthlyPrice;
      summary.push(`מחיר החבילה: ${formatILS(r.monthlyPrice)} לחודש לפני מע״מ (בחבילה ${formatILS(pkg.price)})`);
    }
  }
  if (given(r.months)) {
    const words = r.months === 1 ? 'חודש אחד' : `${r.months} חודשים`;
    if (r.months === TERM_MONTHS) summary.push(`תקופה: ${words} (כמו בחבילה)`);
    else {
      custom.termMonths = r.months;
      marks.term = r.months;
      summary.push(`תקופה: ${words} (בחבילה ${TERM_MONTHS})`);
    }
  }
  if ((r.extraLines || []).length) {
    custom.lines = r.extraLines.map((l) => ({ label: l.label, ...(given(l.qty) ? { qty: l.qty } : {}), ...(given(l.monthly) ? { monthly: l.monthly } : {}) }));
    marks.lines = JSON.stringify(custom.lines);
    for (const l of custom.lines) summary.push(`שורה נוספת: ${l.label}${l.qty ? ` × ${l.qty}` : ''}${l.monthly ? ` · ${formatILS(l.monthly)} לחודש` : ''}`);
  }
  if ((r.specialClauses || []).length) {
    custom.terms = r.specialClauses.join('\n');
    marks.terms = custom.terms;
    for (const c of r.specialClauses) summary.push(`תנאי מיוחד: ${c}`);
  }

  // The discount last: it is taken from the monthly price with everything above.
  let discount = null;
  const list = computeTotals(normalizeSelection({ ...sel, discount: 0, custom: { ...custom } })).monthlyList;
  if (given(r.discount)) discount = r.discount;
  else if (given(r.discountPercent)) {
    discount = wholeShekels((list * r.discountPercent) / 100);
    summary.push(`הנחה של ${r.discountPercent}% מ־${formatILS(list)}`);
  }
  if (given(discount)) {
    if (discount > list) { skipped.push(`הנחה של ${formatILS(discount)} גדולה מהמחיר החודשי: הוזנה ${formatILS(list)}`); discount = list; }
    sel.discount = discount;
    marks.discount = discount;
    summary.push(`הנחה: ${formatILS(discount)} לחודש לפני מע״מ`);
  }

  const customOn = Object.keys(custom).length > 0 || (sel.discount || 0) > maxDiscountFor(sel.tier);
  const next = reconcile(customOn ? { ...sel, custom } : sel).selection;
  return { selection: next, marks, summary, skipped };
}

// Which "מולא אוטומטית" tags still hold: the keys of `marks` whose field still has the value the
// result gave it (a field Irit changed by hand afterwards is hers).
export function aiMarksOf(sel, marks) {
  const out = new Set();
  if (!sel || !isObject(marks)) return out;
  const c = sel.custom || {};
  for (const [key, v] of Object.entries(marks)) {
    const [kind, k] = key.split(':');
    const holds = kind === 'package' ? packageId(sel.tier, sel.influencer) === v
      : kind === 'paid' ? (sel.paid || []).includes(k)
        : kind === 'free' ? sel.free?.[k] === v
          : kind === 'q' ? c.qty?.[k] === v
            : kind === 'price' ? c.price === v
              : kind === 'term' ? c.termMonths === v
                : kind === 'discount' ? (sel.discount || 0) === v
                  : kind === 'lines' ? JSON.stringify((c.lines || []).map((l) => ({ label: l.label, ...(given(l.qty) ? { qty: l.qty } : {}), ...(given(l.monthly) ? { monthly: l.monthly } : {}) }))) === v
                    : kind === 'terms' ? c.terms === v
                      : kind === 'noinf' ? c.noInfluencer === true
                        : kind === 'incl' ? c.addonsIncluded === true
                          : false;
    if (holds) out.add(key);
  }
  return out;
}

/* ── "בדיוק כמו שכתבתי": the free contract (the owner, 29.10.2026; docs/ops.md, section 79) ──
   The office writes the deal as it was closed, for example Ofir's
     "תוציא לי הצעת מחיר 4,900 עם שתי דפי נחיתה / בלי משפיען 4,900 בחודש / צילום כל חודש 8 תכנים",
   and the switch "בדיוק כמו שכתבתי (חוזה חופשי)" is on: nothing is mapped onto a package. The text
   becomes a custom contract exactly as written (the builder's "חוזה מותאם אישית", its fields and
   its checks): the monthly price as written (before VAT unless the text says "כולל מע״מ"), no
   influencer when it says so (and when it names none), the quantities as written, extra lines as
   written, the term (else 12 months) and the document type (else the one chosen on the builder).
   Several documents in one text ("שתי הצעות: …") are up to FREE_MAX_DRAFTS separate drafts.
     freeSystemPrompt()   the instructions of this mode (the same text on every call: cached);
     FREE_SCHEMA          its JSON shape;
     validateFreeResult() the answer checked: { result: { drafts, questions, notes }, dropped };
     applyFreeDraft()     one draft on the builder: { selection, marks, summary, skipped, questions }. */
export const FREE_MAX_DRAFTS = 3;
export const FREE_MAX_QUESTIONS = 2;
const FREE_INFLUENCERS = Object.keys(INFLUENCERS);
const TIER_IDS = TIERS.map((t) => t.id);
// What the text may change itself in a free contract (the monthly photographer's contents are
// `monthlyContents`).
const FREE_QTY = QTY_KEYS.filter((k) => k !== 'monthly');
// What can be added in a free contract (the monthly photographer is `monthlyShoot`).
const FREE_ADDON_IDS = PAID_IDS.filter((id) => id !== 'photographer');
// Without an influencer, what was not written: 36 videos and 36 graphics (72 contents, as the
// Social package; the owner, 29.10.2026: "את אותה כמות תכנים שיש 72, 36 ו־36"), and no extra
// shoot days or channel-14 items.
const FREE_DEFAULT = { videos: 36, graphics: 36, photoDays: 0, ch14: 0 };
const FREE_ZERO = Object.keys(FREE_DEFAULT);

export function freeCatalogText() {
  const infl = FREE_INFLUENCERS.map((k) => `- \`${k}\`: ${INFLUENCERS[k].name}`).join('\n');
  const tiers = TIERS.map((t) => `- \`${t.id}\`: ${t.name}`).join('\n');
  const addons = FREE_ADDON_IDS.map((id) => { const a = PAID_ADDONS.find((x) => x.id === id); return `- \`${id}\`: ${a.name} (${ELIGIBILITY[a.eligibility]})`; }).join('\n');
  const qty = CUSTOM_QTY.filter((q) => FREE_QTY.includes(q.key)).map((q) => `- \`${q.key}\`: ${q.name}, 0–${q.max}, for the whole contract`).join('\n');
  return [
    '## Influencers (only when the text names one)', infl,
    '## Package types (only when the text says it: "פודקאסט"; "טלוויזיה" or "ערוץ 14" for social-tv; else null)', tiers,
    '## Additions at an influencer (only when the text asks for them)', addons,
    '## Quantities', qty,
    `## Term\n${TERM_MONTHS} months unless the text says otherwise; ${CUSTOM_LIMITS.termMin}–${CUSTOM_LIMITS.termMax}.`,
  ].join('\n\n');
}

const FREE_RULES = `# How to answer (free mode: exactly as written)
Do exactly what the text says, nothing more. Do not map the deal onto a catalog package, do not add anything that was not written, and never second-guess what was written.
- drafts: one item for each document the text asks for ("שתי הצעות: אחת … ואחת …" is two drafts), at most ${FREE_MAX_DRAFTS}. Lines that repeat the same deal (for example the same price written twice, once by the seller and once by the office) are one draft.
- title: a short Hebrew name for the draft, from the text (for example "4,900 בלי משפיען").
- docType: "quote" when the text asks for "הצעת מחיר" or "הצעה", "agreement" when it asks for "חוזה" or "הסכם"; null when it does not say.
- influencer: the key of the influencer the text names; "none" when it says there is none ("בלי משפיען", "ללא משפיענים") and also when it names none.
- tier: only when the text says the kind of package; else null.
- monthlyPrice: the monthly price written, in agorot (4,900 is 490000). It is the whole monthly price, with everything in the draft included. A price is before VAT unless the text says it includes VAT ("כולל מע״מ"; then priceIncludesVat is true and the number is given as written). Never compute or guess a price; null when none is written.
- monthlyShoot: true when the text has a shoot or a photographer every month ("צילום כל חודש", "צלם חודשי"); monthlyContents: the contents a month written with it ("8 תכנים"), else null.
- quantities: one {key, value} for each quantity the text states (the value for the whole contract). Nothing that was not written.
- addons: only additions at the influencer that the text asks for.
- months: only when the text states the term.
- extraLines: anything else that is sold ("2 דפי נחיתה" is {label: "דפי נחיתה", qty: 2}), with a monthly price only when the text gives that thing its own price. Without a price it is included in the monthly price.
- specialClauses: short Hebrew clauses for anything agreed that is not a setting above (payment, exit terms).
- discount: a monthly discount before VAT in agorot, only when the text states one.
- client: the customer's details when the text gives them; "" for anything it does not give.
- questions: at most ${FREE_MAX_QUESTIONS} short Hebrew questions, only for what is genuinely missing to write the document (no price at all, or a price that is truly ambiguous). Never ask about something the text states, and never suggest a package.
- notes: one short Hebrew sentence for the office, or null.
Write every text for the office in Hebrew.`;

let FREE_PROMPT = null;
export function freeSystemPrompt() {
  FREE_PROMPT ??= [
    'You turn a deal that the office of Astrateg, an Israeli social media agency, wrote in free Hebrew into one or more custom contracts, exactly as written. You never invent anything the text does not say.',
    '# What a custom contract can hold',
    freeCatalogText(),
    FREE_RULES,
  ].join('\n\n');
  return FREE_PROMPT;
}

const CLIENT_SCHEMA = object({ name: { type: 'string' }, company: { type: 'string' }, companyId: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' } });
export const FREE_SCHEMA = object({
  drafts: {
    type: 'array',
    items: object({
      title: { type: 'string' },
      docType: nullable({ type: 'string', enum: ['quote', 'agreement'] }),
      influencer: nullable({ type: 'string', enum: [...FREE_INFLUENCERS, 'none'] }),
      tier: nullable({ type: 'string', enum: TIER_IDS }),
      monthlyPrice: nullable(INT),
      priceIncludesVat: { type: 'boolean' },
      monthlyShoot: { type: 'boolean' },
      monthlyContents: nullable(INT),
      quantities: { type: 'array', items: object({ key: { type: 'string', enum: FREE_QTY }, value: INT }) },
      addons: { type: 'array', items: { type: 'string', enum: FREE_ADDON_IDS } },
      months: nullable(INT),
      extraLines: { type: 'array', items: object({ label: { type: 'string' }, qty: nullable(INT), monthly: nullable(INT) }) },
      specialClauses: { type: 'array', items: { type: 'string' } },
      discount: nullable(INT),
      client: CLIENT_SCHEMA,
    }),
  },
  questions: { type: 'array', items: { type: 'string' } },
  notes: nullable({ type: 'string' }),
});

// One draft, checked (the same limits as the builder's own fields). `n`: its number, for the words.
function checkFreeDraft(d, n, drop) {
  const r = isObject(d) ? d : {};
  const at = (text) => drop(`drafts.${n}`, `הצעה ${n}: ${text}`);
  const out = {
    title: clip(cleanLine(r.title), 60),
    docType: ['quote', 'agreement'].includes(r.docType) ? r.docType : null,
    influencer: 'none',
    tier: TIER_IDS.includes(r.tier) ? r.tier : null,
    monthlyPrice: null, vatFrom: null,
    monthlyShoot: r.monthlyShoot === true, monthlyContents: null,
    quantities: {}, addons: [], months: null, extraLines: [], specialClauses: [], discount: null, client: {},
  };
  if (given(r.influencer) && r.influencer !== 'none') {
    if (FREE_INFLUENCERS.includes(r.influencer)) out.influencer = r.influencer;
    else at(`משפיען לא מוכר: ${cleanLine(r.influencer)}`);
  }
  // The catalog mode's checks for the parts both modes share.
  const { result: base, dropped } = validateAiResult({
    months: r.months, monthlyPrice: r.monthlyPrice, priceIncludesVat: r.priceIncludesVat, discount: r.discount,
    extraLines: r.extraLines, specialClauses: r.specialClauses, client: r.client,
    quantities: (Array.isArray(r.quantities) ? r.quantities : []).filter((x) => isObject(x) && FREE_QTY.includes(x.key)),
  });
  for (const x of dropped) if (x.field !== 'priceIncludesVat') at(x.text);
  if (r.priceIncludesVat === true && given(base.monthlyPrice)) out.vatFrom = wholeShekels(toInt(r.monthlyPrice));
  Object.assign(out, {
    months: base.months, monthlyPrice: base.monthlyPrice, discount: base.discount, quantities: base.quantities,
    extraLines: base.extraLines, specialClauses: base.specialClauses, client: base.client,
  });
  if (out.monthlyShoot && given(r.monthlyContents)) {
    const def = qtyDef('monthly');
    const m = toInt(r.monthlyContents);
    if (m === null) at('מספר התכנים בחודש לא מספרי');
    else out.monthlyContents = Math.max(def.min, Math.min(def.max, m));
  }
  for (const id of Array.isArray(r.addons) ? r.addons : []) {
    if (!FREE_ADDON_IDS.includes(id)) at(`תוספת לא מוכרת: ${cleanLine(id)}`);
    else if (!out.addons.includes(id)) out.addons.push(id);
  }
  return out;
}

// The model's answer in free mode, checked: { result: { drafts, questions, notes }, dropped }.
// Never throws.
export function validateFreeResult(raw) {
  const dropped = [];
  const drop = (field, text) => dropped.push({ field, text });
  const r = isObject(raw) ? raw : {};
  if (!isObject(raw)) drop('', 'התשובה לא הייתה בפורמט הנכון');
  const list = Array.isArray(r.drafts) ? r.drafts : [];
  if (list.length > FREE_MAX_DRAFTS) drop('drafts', `בטקסט יותר מ־${FREE_MAX_DRAFTS} מסמכים: הוכנו ${FREE_MAX_DRAFTS} הראשונים`);
  const drafts = list.slice(0, FREE_MAX_DRAFTS).map((d, i) => checkFreeDraft(d, i + 1, drop));
  const questions = texts(r.questions).map((s) => clip(s, AI_LIMITS.question)).slice(0, FREE_MAX_QUESTIONS);
  const notes = cleanLine(r.notes);
  return { result: { drafts, questions, notes: notes ? clip(notes, AI_LIMITS.notes) : null }, dropped };
}

const monthsWords = (m) => (m === 1 ? 'חודש אחד' : `${m} חודשים`);
export const draftTitle = (d, i) => `הצעה ${i + 1}${d?.title ? ` · ${d.title}` : ''}`;

// One draft on the builder, as "חוזה מותאם אישית" (the switch on): { selection, marks, summary,
// skipped, questions }. `current`: the builder's selection now (its document type is kept when
// the text does not say one). The totals and the checks stay the pricing engine's.
export function applyFreeDraft(current, draft) {
  const d = draft || checkFreeDraft({}, 1, () => {});
  const marks = {};
  const summary = [];
  const skipped = [];
  const questions = [];
  const docType = d.docType || current?.docType || 'agreement';
  summary.push(`מסמך: ${docType === 'quote' ? 'הצעת מחיר' : 'הסכם התקשרות'}${d.docType ? '' : ' (כמו שנבחר במחולל)'}`);
  const none = d.influencer === 'none' || !INFLUENCERS[d.influencer];
  let tier = d.tier || 'social';
  if (none && tier === 'podcast') { skipped.push('פודקאסט בלי משפיענים לא קיים: הוכן כ־Social'); tier = 'social'; }
  const influencer = none ? (INFLUENCERS[current?.influencer] ? current.influencer : 'simeon') : d.influencer;
  let sel = { ...emptySelection(), docType, tier, influencer };
  const custom = {};
  if (none) {
    custom.noInfluencer = true;
    marks.noinf = true;
    summary.push('משפיענים: בלי');
  } else {
    marks.package = packageId(tier, influencer);
    summary.push(`משפיענים: ${INFLUENCERS[influencer].name} (${tierOf(tier).name})`);
  }
  if (d.monthlyShoot) sel.paid = ['photographer'];
  for (const id of d.addons || []) {
    const addon = PAID_ADDONS.find((a) => a.id === id);
    if (!addon) continue;
    if (!paidAddonAvailable(addon, { ...sel, custom })) { skipped.push(`${addon.name}: רק בחבילה עם המשפיען שלה`); continue; }
    sel.paid = PAID_IDS.filter((x) => x === id || sel.paid.includes(x));
  }
  for (const id of sel.paid) marks[`paid:${id}`] = true;

  // The quantities: as written. Without an influencer, only what was written (the rest is 0).
  const base = baseQuantities(sel);
  const qty = {};
  const written = d.quantities || {};
  // The package's 36 and 36 only when no amount of contents was written at all ("אלא אם כן רושמים
  // כמות אחרת"): a written number of videos, graphics or monthly contents is the amount.
  const noAmount = none && !d.monthlyShoot && !['videos', 'graphics'].some((k) => given(written[k]));
  const fill = (k) => (noAmount ? FREE_DEFAULT[k] : 0);
  for (const def of CUSTOM_QTY) {
    if (def.key === 'monthly') continue;
    const v = given(written[def.key]) ? written[def.key] : none && FREE_ZERO.includes(def.key) ? fill(def.key) : undefined;
    if (!given(v)) continue;
    if (none && INF_KEYS.includes(def.key)) { if (v > 0) skipped.push(`${def.name}: אין בחוזה בלי משפיענים`); continue; }
    if (v !== base[def.key]) qty[def.key] = v;
    if (given(written[def.key])) { marks[`q:${def.key}`] = v; summary.push(`${def.name}: ${v}`); }
  }
  if (d.monthlyShoot) {
    const per = d.monthlyContents ?? MONTHLY_CONTENTS;
    if (per !== MONTHLY_CONTENTS) { qty.monthly = per; marks['q:monthly'] = per; }
    summary.push(`צילום כל חודש (צלם חודשי): ${per} תכנים בכל חודש`);
  }
  const byDefault = noAmount ? FREE_ZERO.filter((k) => FREE_DEFAULT[k] > 0).map((k) => `${FREE_DEFAULT[k]} ${qtyDef(k).name}`) : [];
  if (byDefault.length) summary.push(`לא נכתבה כמות, ולכן כמו בחבילה: ${byDefault.join(' ו־')}`);
  const notWritten = none && !noAmount ? FREE_ZERO.filter((k) => !given(written[k]) && base[k] > 0).map((k) => qtyDef(k).name) : [];
  if (notWritten.length) summary.push(`לא נכתבו, ולכן לא בחוזה: ${notWritten.join(', ')}`);
  if (Object.keys(qty).length) custom.qty = qty;

  const lines = (d.extraLines || []).map((l) => ({ label: l.label, ...(given(l.qty) ? { qty: l.qty } : {}), ...(given(l.monthly) ? { monthly: l.monthly } : {}) }));
  if (given(d.monthlyPrice)) {
    custom.price = d.monthlyPrice;
    marks.price = d.monthlyPrice;
    const allIn = sel.paid.length > 0 || lines.some((l) => !l.monthly);
    summary.push(`מחיר: ${formatILS(d.monthlyPrice)} לחודש לפני מע״מ${d.vatFrom ? ` (נכתב ${formatILS(d.vatFrom)} כולל מע״מ)` : ''}${allIn ? ', הכול כלול' : ''}`);
    if (sel.paid.length) { custom.addonsIncluded = true; marks.incl = true; }
  } else {
    questions.push('מה המחיר החודשי לפני מע״מ? לא נכתב מחיר, ובינתיים נשאר המחיר של החבילה.');
  }
  if (given(d.months)) {
    if (d.months !== TERM_MONTHS) { custom.termMonths = d.months; marks.term = d.months; }
    summary.push(`תקופה: ${monthsWords(d.months)}`);
  } else summary.push(`תקופה: ${monthsWords(TERM_MONTHS)} (לא נכתבה תקופה)`);
  if (lines.length) {
    custom.lines = lines;
    marks.lines = JSON.stringify(lines);
    for (const l of lines) summary.push(`${l.qty ? `${l.qty} ` : ''}${l.label}${l.monthly ? ` · ${formatILS(l.monthly)} לחודש` : ' (כלול במחיר)'}`);
  }
  if ((d.specialClauses || []).length) {
    custom.terms = d.specialClauses.join('\n');
    marks.terms = custom.terms;
    for (const c of d.specialClauses) summary.push(`תנאי מיוחד: ${c}`);
  }
  if (given(d.discount)) {
    const list = computeTotals(normalizeSelection({ ...sel, discount: 0, custom: { ...custom } })).monthlyList;
    let discount = d.discount;
    if (discount > list) { skipped.push(`הנחה של ${formatILS(discount)} גדולה מהמחיר החודשי: הוזנה ${formatILS(list)}`); discount = list; }
    sel.discount = discount;
    marks.discount = discount;
    summary.push(`הנחה: ${formatILS(discount)} לחודש לפני מע״מ`);
  }
  // Always a custom contract: the switch is on, even when nothing differs.
  sel = reconcile({ ...sel, custom }).selection;
  return { selection: sel, marks, summary, skipped, questions };
}
