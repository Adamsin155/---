// generated — edit app/ instead. Source: app/mcp-draft.js. Regenerate: node scripts/sync-functions.mjs
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
import { CUSTOM_QTY, INFLUENCERS, TIERS, DOC_TYPES, CUSTOM_LIMITS, canAlsoBe, MAX_ALSO_INFLUENCERS } from './catalog.js';
import { validateSelection, buildQuoteModel, exceptionOf, normalizeSelection } from './pricing.js';
import {
  validateAiResult, applyAiResult, validateFreeResult, applyFreeDraft, catalogText, freeCatalogText,
  PACKAGE_KEYS, QTY_KEYS, PAID_IDS, FREE_KEYS,
} from './contract-ai-logic.js';
// "נוסח חופשי" (17.11.2026; docs/ops.md, section 140): the document's own words in the draft too.
import { TEXT_AI_PROPS, TEXT_AI_KEYS, TEXT_PART_NAMES, checkAiText, textRulesText, numberedText, resolveText, MONEY } from './contract-text.js';
import { regularText, emptySelection } from './pricing.js';

export const DRAFT_TOOL = 'prepare_contract_draft';
export const DRAFT_SITE = 'https://app.astrateg.tech/';
export const DRAFT_PARAM = 'mcp-draft';
// A long link is not a working link (and the longest allowed choices fit well under it). 16,000 since
// 17.11.2026: a draft with the document's own words (only the lines written differ from the regular ones).
export const DRAFT_LINK_MAX = 16000;

const COMMON = ['mode', 'docType', 'months', 'quantities', 'addons', 'monthlyPrice', 'priceIncludesVat', 'discount', 'extraLines', 'specialClauses', 'text'];
const ONLY_CATALOG = ['package', 'removals', 'freeAddons', 'discountPercent'];
const ONLY_FREE = ['influencer', 'tier', 'monthlyShoot', 'monthlyContents', 'alsoInfluencers', 'postsAt'];
const ALL_KEYS = [...COMMON, ...ONLY_CATALOG, ...ONLY_FREE];
const REMOVABLE = CUSTOM_QTY.filter((q) => !q.min).map((q) => q.key);

const INT = { type: 'integer' };
const TEXT_HELP = {
  title: 'The cover\'s title ("הסכם התקשרות" is the agreement\'s own).',
  subtitle: 'The cover\'s second line, e.g. "ALL IN ONE · סמיון, מישל ודניס והצל".',
  influencerLine: 'The cover\'s third line (the influencers).',
  noInfluencerLine: 'true: no third line (when the subtitle names the influencers).',
  packageTitle: 'The title of "מה כוללת החבילה".',
  packageGroups: '"מה כוללת החבילה": [{title, items}], all its groups in order.',
  detailsTitle: 'The title of "פירוט החבילה" ("דגשים" when the deal calls them so).',
  details: '"פירוט החבילה" (the דגשים): [{title, items}]; the price line only as "{{1.1}}".',
  tiles: 'The package\'s numbers as shown: [{n: "104", label: "תכנים"}], all of them.',
  clauses: 'The agreement\'s chapters: [{title, items}], numbered by the system; must keep "{{2.1}}" (the price).',
};
const pair =(keys) => ({ type: 'object', properties: { key: { type: 'string', enum: keys }, value: INT }, required: ['key', 'value'], additionalProperties: false });
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
    // Several influencers in one contract (16.11.2026; docs/ops.md, section 135).
    alsoInfluencers: { type: 'array', items: { type: 'string', enum: Object.keys(INFLUENCERS).filter(canAlsoBe) }, description: `free mode: up to ${MAX_ALSO_INFLUENCERS} more influencers next to \`influencer\` (the first one named), when the deal names several.` },
    postsAt: { type: 'array', items: { type: 'object', properties: { influencer: { type: 'string', enum: Object.keys(INFLUENCERS).filter(canAlsoBe) }, collabs: INT, stories: INT }, required: ['influencer'], additionalProperties: false }, description: 'free mode: the collabs and stories at each influencer, only when the deal says at whom.' },
    // The document's own words (17.11.2026): see "The document's own words" in the description.
    text: {
      type: 'object',
      properties: Object.fromEntries(TEXT_AI_KEYS.map((k) => [k, { ...TEXT_AI_PROPS[k], description: TEXT_HELP[k] }])),
      additionalProperties: false,
      description: 'The document\'s own words, tidy formal Hebrew: only the parts the deal writes differently; a list replaces that whole part; "{{2.1}}" keeps a regular line. Never money, never the client\'s details.',
    },
    previous: { type: 'string', description: 'To change a draft already made by talking: its link (or the part after "#mcp-draft="). Then send only what changes; a field set to null goes back to the package\'s own, and in text a part you send replaces that part (send the whole list, from the previous answer\'s text, with the change).' },
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
    // The document's own words (17.11.2026), in both modes.
    'The person may write the deal in messy words, as a seller writes on WhatsApp. Then set the choices from it and write the document\'s own words in text: tidy them into clean contract Hebrew lines, keep clauses 1.1 and 1.2 and the details (דגשים) saying the same thing, and never put the client\'s details in text.',
    textRulesText(regularText({ ...emptySelection(), docType: 'agreement', tier: 'social', influencer: 'simeon' })),
    '# Changing a draft by talking\nWhen the person asks to change a draft already made ("תוריד את השורה של הקולאב", "תשנה את סעיף 1.1 ל…"), call this tool again with previous: the draft\'s link, and only what changes. In text, a part you send replaces that whole part: take it from the previous answer\'s text (or document_words), change what was asked, and send all of it. Give the person the new link. Nothing is saved or sent: it is a draft until the person creates it on the builder.',
  ].join('\n\n');
  return DESCRIPTION;
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// An email, or a number as long as a phone or a company id (the write tools refuse the same in their text:
// supabase/functions/mcp/write-tools.js).
export const PERSONAL = /@|(?:\d[\s().\-‎‏]*){8,}/;
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
  for (const k of ['quantities', 'removals', 'addons', 'freeAddons', 'extraLines', 'specialClauses', 'alsoInfluencers', 'postsAt']) {
    if (input[k] !== undefined && !Array.isArray(input[k])) return { error: 'bad_input', fields: [k] };
  }
  // Inside a list too: only the schema's fields.
  const inner = [];
  for (const [k, keys] of [['quantities', ['key', 'value']], ['freeAddons', ['key', 'value']], ['extraLines', ['label', 'qty', 'monthly']], ['postsAt', ['influencer', 'collabs', 'stories']]]) {
    if (!input[k]) continue;
    if (input[k].some((x) => !isObject(x) || Object.keys(x).some((f) => !keys.includes(f)))) inner.push(k);
    else input[k] = pickItems(input[k], keys);
  }
  if (inner.length) return { error: 'unknown_field', fields: inner };
  if ((input.alsoInfluencers || []).some((x) => typeof x !== 'string')) return { error: 'bad_input', fields: ['alsoInfluencers'] };
  const texts = [...(input.extraLines || []).map((l) => l.label), ...(input.specialClauses || [])];
  if (texts.some((t) => typeof t !== 'string')) return { error: 'bad_input', fields: ['extraLines', 'specialClauses'] };
  const personal = [];
  if ((input.extraLines || []).some((l) => PERSONAL.test(l.label))) personal.push('extraLines');
  if ((input.specialClauses || []).some((t) => PERSONAL.test(t))) personal.push('specialClauses');
  // The document's own words (17.11.2026): only the schema's keys, text and lists of text.
  if (input.text !== undefined) {
    const t = input.text;
    if (!isObject(t)) return { error: 'bad_input', fields: ['text'] };
    const unknownText = Object.keys(t).filter((k) => !TEXT_AI_KEYS.includes(k)).map((k) => `text.${k.slice(0, 30)}`).slice(0, 10);
    if (unknownText.length) return { error: 'unknown_field', fields: unknownText };
    const strings = textStrings(t);
    if (strings === null) return { error: 'bad_input', fields: ['text'] };
    if (strings.some((x) => PERSONAL.test(x))) personal.push('text');
    else if (strings.some((x) => MONEY.test(x))) return { error: 'money_in_text', fields: ['text'] };
  }
  if (personal.length) return { error: 'personal_details', fields: personal };
  return { input };
}

// Every string of a draft's text, or null when its shape is wrong.
function textStrings(t) {
  const out = [];
  const str = (v) => { if (typeof v !== 'string') throw new Error('shape'); out.push(v); };
  try {
    for (const k of ['title', 'subtitle', 'influencerLine', 'packageTitle', 'detailsTitle']) if (t[k] !== undefined && t[k] !== null) str(t[k]);
    if (t.noInfluencerLine !== undefined && t.noInfluencerLine !== null && typeof t.noInfluencerLine !== 'boolean') return null;
    for (const k of ['packageGroups', 'details', 'clauses']) {
      if (t[k] === undefined || t[k] === null) continue;
      if (!Array.isArray(t[k])) return null;
      for (const g of t[k]) {
        if (!isObject(g) || Object.keys(g).some((f) => !['title', 'items'].includes(f)) || !Array.isArray(g.items ?? [])) return null;
        if (g.title !== undefined) str(g.title);
        (g.items || []).forEach(str);
      }
    }
    if (t.tiles !== undefined && t.tiles !== null) {
      if (!Array.isArray(t.tiles)) return null;
      for (const x of t.tiles) {
        if (!isObject(x) || Object.keys(x).some((f) => !['n', 'label'].includes(f))) return null;
        str(x.n ?? ''); str(x.label ?? '');
      }
    }
  } catch { return null; }
  return out;
}

export const DRAFT_ERRORS = {
  bad_input: 'הבחירות לא בפורמט הנכון.',
  unknown_field: 'יש שדה שהכלי לא מקבל. פרטי הלקוח לא עוברים כאן: ממלאים אותם במחולל.',
  field_of_other_mode: 'יש שדה ששייך למצב האחר (catalog או free).',
  package_required: 'צריך לבחור חבילה מהקטלוג (package), או להכין חוזה חופשי (mode: free). אם לא ברור, לשאול.',
  personal_details: 'בטקסט יש מייל או מספר ארוך. פרטי הלקוח לא עוברים כאן: ממלאים אותם במחולל.',
  invalid_selection: 'הבחירות לא מסתדרות עם הקטלוג.',
  too_long: 'הטיוטה ארוכה מדי לקישור. לקצר את התנאים המיוחדים או את הנוסח.',
  money_in_text: 'בנוסח יש סכום. סכומים לא נכתבים בנוסח: המחיר מחושב (monthlyPrice), ובסעיף המחיר נשאר "{{2.1}}".',
  bad_previous: 'הקישור לטיוטה הקודמת לא תקין. אפשר להכין את הטיוטה מחדש.',
};

// A draft changed by talking (17.11.2026): the previous draft's link (or its part after "#mcp-draft=")
// and only what changes. A field set to null goes back to the package's own; in text, each part sent
// replaces that part (null or "" / [] puts its regular words back). { raw } or { error, fields }.
export function withPrevious(raw) {
  if (!isObject(raw) || raw.previous === undefined || raw.previous === null) return { raw };
  const { previous, ...changes } = raw;
  const s = typeof previous === 'string' ? previous.trim() : '';
  const at = s.indexOf(`${DRAFT_PARAM}=`);
  const param = at >= 0 ? s.slice(at + DRAFT_PARAM.length + 1) : s;
  let before;
  try {
    if (!param || param.length > DRAFT_LINK_MAX || !/^[A-Za-z0-9_-]+$/.test(param)) throw new Error('bad');
    before = checkDraftInput(fromParam(param));
  } catch {
    return { error: 'bad_previous', fields: ['previous'] };
  }
  if (before.error) return { error: 'bad_previous', fields: ['previous'] };
  const merged = { ...before.input };
  for (const [k, v] of Object.entries(changes)) {
    if (k === 'text' && isObject(v)) {
      const text = { ...(merged.text || {}) };
      for (const [tk, tv] of Object.entries(v)) { if (tv === null) delete text[tk]; else text[tk] = tv; }
      if (Object.keys(text).length) merged.text = text; else delete merged.text;
    } else if (v === null) delete merged[k];
    else merged[k] = v;
  }
  // Another mode: what belonged to the previous one only is left behind.
  const mode = merged.mode || 'catalog';
  const allowed = [...COMMON, ...(mode === 'free' ? ONLY_FREE : ONLY_CATALOG)];
  for (const k of Object.keys(merged)) if (ALL_KEYS.includes(k) && !allowed.includes(k) && !(k in changes)) delete merged[k];
  return { raw: merged };
}

// The choices through the same checks as the AI preparation, and then the pricing engine:
// { selection, marks, summary, check, exceptions, model } or { error, fields, details }.
export function draftOf(given) {
  const prev = withPrevious(given);
  if (prev.error) return prev;
  const { raw } = prev;
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
    const { text: words, ...rest } = choices;
    const { result, dropped } = validateAiResult(rest);
    applied = applyAiResult(current, result);
    check = [...result.questions, ...applied.skipped, ...dropped.map((d) => d.text)];
    // The document's own words, checked as those of "הכנת חוזה עם AI" (app/contract-text.js).
    const { text, notes } = checkAiText(words);
    check.push(...notes);
    if (text) {
      applied.selection = { ...applied.selection, custom: { ...(applied.selection.custom || {}), text } };
      applied.summary = [...applied.summary, `נוסח שנכתב: ${Object.keys(text).map((k) => TEXT_PART_NAMES[k]).join(', ')}`];
    }
  }
  const { selection, marks, summary } = applied;
  // What the builder would send to create-quote (selectionToSend in app/builder.js): in a custom
  // contract the discount goes inside `custom`. `selection` itself is the builder's own state;
  // `toSend` is what send_contract gives create-quote (supabase/functions/mcp/write-tools.js).
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
  return { input: checked.input, selection, toSend, marks, summary, check, exceptions: exceptionOf(toSend).map((x) => x.text), model };
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
  if (link.length > DRAFT_LINK_MAX) return { error: 'too_long', fields: d.input.text ? ['text', 'specialClauses'] : ['specialClauses'] };
  const { model } = d;
  const t = model.totals;
  return {
    status: 'טיוטה בלבד: שום דבר לא נשמר ולא נשלח',
    next_step: 'פותחים את הקישור, בודקים, ממלאים את פרטי הלקוח, ויוצרים ושולחים במערכת כרגיל.',
    document: model.docTitle,
    package: `${model.package.tierName} · ${model.package.shownInfluencer || model.package.influencer}`,
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
    // The document's own words as stored ("{{2.1}}" a regular line) and the whole wording as the
    // document shows it, numbered: what a change by talking starts from.
    ...(d.input.text ? { text: d.input.text } : {}),
    document_words: documentWords(d.toSend),
    link,
  };
}

// The document's words, numbered as the document shows them (with the draft's own words in them).
function documentWords(sel) {
  const regular = regularText(sel);
  return numberedText({ ...regular, ...resolveText(sel.custom?.text, regular) });
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
