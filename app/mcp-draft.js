// "prepare_contract_draft" (docs/ops.md, section 84): Claude takes the deal's package choices and
// answers with a summary and a link; the builder (app/builder.js) opens from the link prefilled, and
// the person fills in the client, creates and sends in the system as always. This module is the plain
// part that the mcp edge function and the builder share (a copy runs on the server:
// supabase/functions/_shared/app/, node scripts/sync-functions.mjs).
//   DRAFT_SCHEMA        what the tool takes. No name, business, id, phone, email or address field;
//   checkDraftInput()   refuses any other field, and text with an email or a long number in it;
//   draftOf()           the choices through the same checks as "הכנת חוזה עם AI"
//                       (validateAiResult/applyAiResult, or the free contract's
//                       validateFreeResult/applyFreeDraft), and then the pricing engine
//                       (validateSelection, buildQuoteModel). Writes nothing, sends nothing;
//   draftLink()         the link: the choices in the part of the address after #, which browsers
//                       never send to any server;
//   draftFromHash()     the builder's way back: the same check again. The link is never trusted.
import { CUSTOM_QTY, INFLUENCERS, TIERS, DOC_TYPES, CUSTOM_LIMITS } from './catalog.js';
import { validateSelection, buildQuoteModel, exceptionOf, normalizeSelection } from './pricing.js';
import {
  validateAiResult, applyAiResult, validateFreeResult, applyFreeDraft, catalogText, freeCatalogText,
  PACKAGE_KEYS, QTY_KEYS, PAID_IDS, FREE_KEYS,
} from './contract-ai-logic.js';

export const DRAFT_TOOL = 'prepare_contract_draft';
export const DRAFT_SITE = 'https://app.astrateg.tech/';
export const DRAFT_PARAM = 'mcp-draft';
// A long link is not a working link (and the longest allowed choices fit well under it).
export const DRAFT_LINK_MAX = 12000;

const COMMON = ['mode', 'docType', 'months', 'quantities', 'addons', 'monthlyPrice', 'priceIncludesVat', 'discount', 'extraLines', 'specialClauses'];
const ONLY_CATALOG = ['package', 'removals', 'freeAddons', 'discountPercent'];
const ONLY_FREE = ['influencer', 'tier', 'monthlyShoot', 'monthlyContents'];
const ALL_KEYS = [...COMMON, ...ONLY_CATALOG, ...ONLY_FREE];
const REMOVABLE = CUSTOM_QTY.filter((q) => !q.min).map((q) => q.key);

const INT = { type: 'integer' };
const pair = (keys) => ({ type: 'object', properties: { key: { type: 'string', enum: keys }, value: INT }, required: ['key', 'value'], additionalProperties: false });
// No field for who the client is, on purpose: the person fills that in on the builder.
export const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['catalog', 'free'], description: 'catalog (default): a package of the catalog, with what differs from it. free: a free-hand contract exactly as the deal was closed, nothing mapped onto a package.' },
    docType: { type: 'string', enum: Object.keys(DOC_TYPES), description: 'agreement (default) or quote.' },
    package: { type: 'string', enum: PACKAGE_KEYS, description: 'catalog mode, required: the key of the package.' },
    months: { ...INT, description: `The term, only when the deal states it (${CUSTOM_LIMITS.termMin}-${CUSTOM_LIMITS.termMax}).` },
    quantities: { type: 'array', items: pair(QTY_KEYS), description: 'Only the quantities the deal changes: the new number for the whole contract.' },
    removals: { type: 'array', items: { type: 'string', enum: REMOVABLE }, description: 'catalog mode: quantities the deal leaves out.' },
    addons: { type: 'array', items: { type: 'string', enum: PAID_IDS }, description: 'Paid add-ons the deal asks for.' },
    freeAddons: { type: 'array', items: pair(FREE_KEYS), description: 'catalog mode: free add-ons; for simeonJoin and extraCh14 the value is 1 or 0.' },
    monthlyPrice: { ...INT, description: 'Only a price the deal states: monthly, before VAT, in agorot (3500 ILS is 350000). Never compute or guess one.' },
    priceIncludesVat: { type: 'boolean', description: 'True when the price given includes VAT.' },
    discount: { ...INT, description: 'Only a discount the deal states: monthly, before VAT, in agorot.' },
    discountPercent: { type: 'number', description: 'catalog mode: a discount the deal states as a percentage.' },
    extraLines: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, qty: INT, monthly: INT }, required: ['label'], additionalProperties: false }, description: 'Things sold that are in no package. The label names the thing, never the client.' },
    specialClauses: { type: 'array', items: { type: 'string' }, description: 'Short Hebrew clauses for anything else agreed. Never the client\'s name, business, id, phone, email or address.' },
    influencer: { type: 'string', enum: [...Object.keys(INFLUENCERS), 'none'], description: 'free mode: the influencer the deal names; none when it names none.' },
    tier: { type: 'string', enum: TIERS.map((t) => t.id), description: 'free mode: only when the deal says the kind of package.' },
    monthlyShoot: { type: 'boolean', description: 'free mode: a shoot or a photographer every month.' },
    monthlyContents: { ...INT, description: 'free mode: the contents a month written with monthlyShoot.' },
  },
  additionalProperties: false,
};

let DESCRIPTION = null;
// What the tool is, with what the builder offers (from the catalog, as "הכנת חוזה עם AI").
export function draftDescription() {
  DESCRIPTION ??= [
    'Prepares a contract draft from the package choices of a closed deal and gives a summary with totals and a link that opens the contract builder prefilled. It saves nothing and sends nothing: the person checks the draft on the builder, fills in the client\'s details there, and creates and sends it in the system as always.',
    'Set only what the deal says; everything else stays the package\'s own. Never put the client\'s name, business, id, phone, email or address in any field: those are typed on the builder only. Give the person the link and any "to_check" lines.',
    catalogText(),
    `# Free mode (a free-hand contract, exactly as written)\n${freeCatalogText()}`,
  ].join('\n\n');
  return DESCRIPTION;
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// An email, or a number as long as a phone or a company id.
const PERSONAL = /@|(?:\d[\s().\-‎‏]*){8,}/;
const pickItems = (list, keys) => list.filter(isObject).map((x) => Object.fromEntries(keys.filter((k) => x[k] !== undefined).map((k) => [k, x[k]])));

// { input } (only known fields, in the schema's shape) or { error, fields }. Field names only,
// never what they hold: the refusal goes back through the same chat.
export function checkDraftInput(raw) {
  if (!isObject(raw)) return { error: 'bad_input', fields: [] };
  const mode = raw.mode === undefined || raw.mode === null ? 'catalog' : raw.mode;
  if (!['catalog', 'free'].includes(mode)) return { error: 'bad_input', fields: ['mode'] };
  const allowed = [...COMMON, ...(mode === 'free' ? ONLY_FREE : ONLY_CATALOG)];
  const unknown = Object.keys(raw).filter((k) => !ALL_KEYS.includes(k)).map((k) => k.slice(0, 40)).slice(0, 10);
  if (unknown.length) return { error: 'unknown_field', fields: unknown };
  const wrongMode = Object.keys(raw).filter((k) => !allowed.includes(k));
  if (wrongMode.length) return { error: 'field_of_other_mode', fields: wrongMode };
  const input = {};
  for (const k of allowed) if (raw[k] !== undefined && raw[k] !== null) input[k] = raw[k];
  input.mode = mode;
  if (input.docType !== undefined && !DOC_TYPES[input.docType]) return { error: 'bad_input', fields: ['docType'] };
  if (mode === 'catalog' && !PACKAGE_KEYS.includes(input.package)) return { error: 'package_required', fields: ['package'] };
  for (const k of ['quantities', 'removals', 'addons', 'freeAddons', 'extraLines', 'specialClauses']) {
    if (input[k] !== undefined && !Array.isArray(input[k])) return { error: 'bad_input', fields: [k] };
  }
  // Inside a list too: only the schema's fields.
  const inner = [];
  for (const [k, keys] of [['quantities', ['key', 'value']], ['freeAddons', ['key', 'value']], ['extraLines', ['label', 'qty', 'monthly']]]) {
    if (!input[k]) continue;
    if (input[k].some((x) => !isObject(x) || Object.keys(x).some((f) => !keys.includes(f)))) inner.push(k);
    else input[k] = pickItems(input[k], keys);
  }
  if (inner.length) return { error: 'unknown_field', fields: inner };
  const texts = [...(input.extraLines || []).map((l) => l.label), ...(input.specialClauses || [])];
  if (texts.some((t) => typeof t !== 'string')) return { error: 'bad_input', fields: ['extraLines', 'specialClauses'] };
  const personal = [];
  if ((input.extraLines || []).some((l) => PERSONAL.test(l.label))) personal.push('extraLines');
  if ((input.specialClauses || []).some((t) => PERSONAL.test(t))) personal.push('specialClauses');
  if (personal.length) return { error: 'personal_details', fields: personal };
  return { input };
}

export const DRAFT_ERRORS = {
  bad_input: 'הבחירות לא בפורמט הנכון.',
  unknown_field: 'יש שדה שהכלי לא מקבל. פרטי הלקוח לא עוברים כאן: ממלאים אותם במחולל.',
  field_of_other_mode: 'יש שדה ששייך למצב האחר (catalog או free).',
  package_required: 'צריך לבחור חבילה מהקטלוג (package), או להכין חוזה חופשי (mode: free). אם לא ברור, לשאול.',
  personal_details: 'בטקסט יש מייל או מספר ארוך. פרטי הלקוח לא עוברים כאן: ממלאים אותם במחולל.',
  invalid_selection: 'הבחירות לא מסתדרות עם הקטלוג.',
  too_long: 'הטיוטה ארוכה מדי לקישור. לקצר את התנאים המיוחדים.',
};

// The choices through the same checks as the AI preparation, and then the pricing engine:
// { selection, marks, summary, check, exceptions, model } or { error, fields, details }.
export function draftOf(raw) {
  const checked = checkDraftInput(raw);
  if (checked.error) return checked;
  const { mode, docType, ...choices } = checked.input;
  const current = { docType: docType || 'agreement' };
  let applied;
  let check;
  if (mode === 'free') {
    const { result, dropped } = validateFreeResult({ drafts: [{ ...choices, docType: docType || null }] });
    applied = applyFreeDraft(current, result.drafts[0]);
    check = [...applied.questions, ...applied.skipped, ...dropped.map((d) => d.text)];
  } else {
    const { result, dropped } = validateAiResult(choices);
    applied = applyAiResult(current, result);
    check = [...result.questions, ...applied.skipped, ...dropped.map((d) => d.text)];
  }
  const { selection, marks, summary } = applied;
  // What the builder would send to create-quote (selectionToSend in app/builder.js): in a custom
  // contract the discount goes inside `custom`. `selection` itself is the builder's own state.
  const toSend = selection.custom
    ? normalizeSelection({ ...selection, discount: 0, custom: { ...selection.custom, discount: selection.discount || 0 } })
    : selection;
  let model;
  try {
    validateSelection(toSend);
    model = buildQuoteModel(toSend, {});
  } catch (err) {
    return { error: 'invalid_selection', fields: [], details: String(err?.message || '').slice(0, 300) };
  }
  return { input: checked.input, selection, marks, summary, check, exceptions: exceptionOf(toSend).map((x) => x.text), model };
}

// UTF-8 in the address's own alphabet (the same in the browser, Deno and node).
function toParam(value) {
  let bin = '';
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromParam(param) {
  const bin = atob(String(param).replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

export const draftLink = (input) => `${DRAFT_SITE}#${DRAFT_PARAM}=${toParam(input)}`;

// The tool's whole answer: { summary… } or { error }. Shekels, for reading.
const ils = (agorot) => Math.round(agorot / 100);
export function draftAnswer(raw) {
  const d = draftOf(raw);
  if (d.error) return d;
  const link = draftLink(d.input);
  if (link.length > DRAFT_LINK_MAX) return { error: 'too_long', fields: ['specialClauses'] };
  const { model } = d;
  const t = model.totals;
  return {
    status: 'טיוטה בלבד: שום דבר לא נשמר ולא נשלח',
    next_step: 'פותחים את הקישור, בודקים, ממלאים את פרטי הלקוח, ויוצרים ושולחים במערכת כרגיל.',
    document: model.docTitle,
    package: `${model.package.tierName} · ${model.package.influencer}`,
    months: model.termMonths,
    monthly_before_discount_ils: ils(t.monthlyList),
    monthly_discount_ils: ils(t.discount),
    monthly_before_vat_ils: ils(t.monthlyNet),
    vat_percent: model.vatRate,
    monthly_with_vat_ils: ils(t.monthlyGross),
    whole_term_with_vat_ils: ils(t.termGross),
    custom_contract: !!model.custom,
    set: d.summary,
    differs_from_package: d.exceptions,
    to_check: d.check,
    link,
  };
}

// From the builder's address: { input } when the address holds a draft that passes the same check,
// { bad: true } when it holds something else, {} when it holds none.
export function draftFromHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw.startsWith(`${DRAFT_PARAM}=`)) return {};
  const param = raw.slice(DRAFT_PARAM.length + 1);
  if (!param || param.length > DRAFT_LINK_MAX) return { bad: true };
  try {
    const { input, error } = checkDraftInput(fromParam(param));
    return error ? { bad: true } : { input };
  } catch {
    return { bad: true };
  }
}
