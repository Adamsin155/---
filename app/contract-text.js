// "נוסח חופשי" (the owner, 17.11.2026; docs/ops.md, section 142): every text part of a quote or an
// agreement may be written by hand, the way the old system let Ofir write a contract from a messy
// WhatsApp thread ("שיוכל לשנות הכל ושרירותי כמו שאופיר רשם"). Stored in the selection, as
// selection.custom.text, so it is in the stored model and under the server-side hash; the same file
// runs in create-quote (supabase/functions/_shared/app/, node scripts/sync-functions.mjs).
//
//   custom.text = {
//     cover    { title?, packageName?, influencer? }   the cover's three lines (influencer '' hides it)
//     package  { title?, groups?: [{ title, items }] } "מה כוללת החבילה"
//     details  { title?, groups?: [{ title, items }] } "פירוט החבילה" (the דגשים)
//     tiles    [{ n, label }]                          the package's numbers ("104" "תכנים")
//     clauses  [{ title, items }]                      the agreement's chapters before "תנאים מיוחדים"
//   }
//
// A line (or a title) is plain text, or a reference to the regular wording at the same part:
//   "{{2}}"    the regular title of group (chapter) 2
//   "{{2.1}}"  the regular line 2.1        "{{2.*}}"  all the regular lines of group 2
// so a line nobody changed follows the contract's numbers as before, and the lines with money are
// kept only by reference: money is never typed (MONEY below; the clause of the price, 2.1, must stay:
// app/legal.js PRICE_CLAUSE). The numbering of the clauses stays automatic (app/quote-doc.js).
// A reference to a line the regular wording no longer has is simply left out.
import { PRICE_CLAUSE } from './legal.js';

export const TEXT_LIMITS = {
  line: 600, title: 160, groups: 8, items: 24, sections: 20, tiles: 12, tileN: 12, tileLabel: 80,
  // All the text together (a draft link of Claude has to hold it: app/mcp-draft.js DRAFT_LINK_MAX).
  total: 9000,
};
export const TEXT_PARTS = ['cover', 'package', 'details', 'tiles', 'clauses'];
export const COVER_KEYS = ['title', 'packageName', 'influencer'];
const LIST_KEYS = ['title', 'groups'];
const GROUP_KEYS = ['title', 'items'];
const TILE_KEYS = ['n', 'label'];
export const REF = /^\{\{(\d{1,2})(?:\.(\d{1,2}|\*))?\}\}$/;
// No markup, no control characters (a line is one line), no bidi controls: drawn as text anyway,
// and the text the client signs must be the text stored.
const BAD = /[<>{}`\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/;
// Money is computed (app/pricing.js), never written by hand.
export const MONEY = /₪|ש["״'׳]ח|שקל|\bNIS\b|\bILS\b/i;

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const given = (v) => v !== undefined && v !== null;
export const cleanText = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const refOf = (s) => REF.exec(String(s ?? '').trim());
const isTitleRef = (s) => { const m = refOf(s); return !!m && m[2] === undefined; };
const isItemRef = (s) => { const m = refOf(s); return !!m && m[2] !== undefined; };

// The text of one plain line: what is wrong with it, or null.
function lineProblem(v, max, where) {
  if (typeof v !== 'string') return `${where} must be text`;
  const t = cleanText(v);
  if (t.length > max) return `${where} too long`;
  if (BAD.test(v)) return `${where} has characters that are not allowed`;
  if (MONEY.test(t)) return `${where}: money is computed, not written`;
  return null;
}

function groupsErrors(groups, where) {
  const errors = [];
  if (!Array.isArray(groups) || groups.length > (where === 'clauses' ? TEXT_LIMITS.sections : TEXT_LIMITS.groups)) return [`custom text ${where}: too many groups`];
  for (const [i, g] of groups.entries()) {
    const at = `custom text ${where} ${i + 1}`;
    if (!isObject(g) || Object.keys(g).some((k) => !GROUP_KEYS.includes(k))) { errors.push(`${at} is malformed`); continue; }
    if (given(g.title) && !isTitleRef(g.title)) { const p = lineProblem(g.title, TEXT_LIMITS.title, `${at} title`); if (p) errors.push(p); }
    if (!Array.isArray(g.items) || g.items.length > TEXT_LIMITS.items) { errors.push(`${at}: too many lines`); continue; }
    for (const [j, item] of g.items.entries()) {
      if (typeof item === 'string' && isItemRef(item)) continue;
      const p = lineProblem(item, TEXT_LIMITS.line, `${at} line ${j + 1}`);
      if (p) errors.push(p);
    }
  }
  return errors;
}

// The errors of custom.text (its shape and its words; nothing of the contract needed).
export function textErrors(text) {
  if (!isObject(text)) return ['custom text must be an object'];
  const errors = [];
  for (const k of Object.keys(text)) if (!TEXT_PARTS.includes(k)) errors.push(`unknown custom text part: ${String(k).slice(0, 30)}`);
  if (given(text.cover)) {
    if (!isObject(text.cover) || Object.keys(text.cover).some((k) => !COVER_KEYS.includes(k))) errors.push('custom text cover is malformed');
    else for (const k of COVER_KEYS) if (given(text.cover[k])) { const p = lineProblem(text.cover[k], TEXT_LIMITS.title, `custom text cover ${k}`); if (p) errors.push(p); }
  }
  for (const part of ['package', 'details']) {
    const v = text[part];
    if (!given(v)) continue;
    if (!isObject(v) || Object.keys(v).some((k) => !LIST_KEYS.includes(k))) { errors.push(`custom text ${part} is malformed`); continue; }
    if (given(v.title) && !isTitleRef(v.title)) { const p = lineProblem(v.title, TEXT_LIMITS.title, `custom text ${part} title`); if (p) errors.push(p); }
    if (given(v.groups)) errors.push(...groupsErrors(v.groups, part));
  }
  if (given(text.tiles)) {
    if (!Array.isArray(text.tiles) || text.tiles.length > TEXT_LIMITS.tiles) errors.push('custom text tiles: too many');
    else {
      for (const [i, t] of text.tiles.entries()) {
        if (!isObject(t) || Object.keys(t).some((k) => !TILE_KEYS.includes(k))) { errors.push(`custom text tile ${i + 1} is malformed`); continue; }
        for (const [k, max] of [['n', TEXT_LIMITS.tileN], ['label', TEXT_LIMITS.tileLabel]]) {
          const p = lineProblem(t[k] ?? '', max, `custom text tile ${i + 1} ${k}`);
          if (p) errors.push(p);
        }
      }
    }
  }
  if (given(text.clauses)) {
    const e = groupsErrors(text.clauses, 'clauses');
    errors.push(...e);
    // The clause of the price stays (by reference: its number is the computed one).
    if (!e.length && !text.clauses.some((g) => g.items.some((x) => keepsPrice(x)))) errors.push('custom text clauses must keep the clause of the price ({{2.1}})');
  }
  if (!errors.length && JSON.stringify(text).length > TEXT_LIMITS.total) errors.push('custom text too long');
  return errors;
}
const PRICE_CHAPTER = PRICE_CLAUSE.replace(/\.\d+\}\}$/, '.*}}');
const keepsPrice = (x) => typeof x === 'string' && [PRICE_CLAUSE, PRICE_CHAPTER].includes(x.trim());

// regular: the parts as the regular wording has them (app/pricing.js regularParts):
//   { cover: { title, packageName, influencer }, package: { title, groups }, details: { title, groups },
//     tiles: [{ n, label }], clauses: [{ title, items }] }
function resolveGroups(groups, regular) {
  const out = [];
  for (const g of groups) {
    const title = given(g.title) ? (isTitleRef(g.title) ? regular[Number(refOf(g.title)[1]) - 1]?.title ?? '' : cleanText(g.title)) : '';
    const items = [];
    for (const raw of g.items) {
      const m = isItemRef(raw) ? refOf(raw) : null;
      if (!m) { const t = cleanText(raw); if (t) items.push(t); continue; }
      const src = regular[Number(m[1]) - 1]?.items || [];
      if (m[2] === '*') items.push(...src);
      else if (src[Number(m[2]) - 1] !== undefined) items.push(src[Number(m[2]) - 1]);
    }
    if (title || items.length) out.push({ title, items });
  }
  return out;
}
const resolveTitle = (t, regular) => (given(t) ? (isTitleRef(t) ? regular.title : cleanText(t)) : regular.title);

// The parts of custom.text as the document shows them (only the parts it has).
export function resolveText(text, regular) {
  const out = {};
  if (!isObject(text)) return out;
  if (isObject(text.cover)) {
    out.cover = { ...regular.cover };
    for (const k of COVER_KEYS) if (typeof text.cover[k] === 'string') out.cover[k] = cleanText(text.cover[k]);
  }
  for (const part of ['package', 'details']) {
    const v = text[part];
    if (!isObject(v)) continue;
    out[part] = {
      title: resolveTitle(v.title, regular[part]) || regular[part].title,
      groups: Array.isArray(v.groups) ? resolveGroups(v.groups, regular[part].groups) : regular[part].groups,
    };
  }
  if (Array.isArray(text.tiles)) out.tiles = text.tiles.map((t) => ({ n: cleanText(t.n), label: cleanText(t.label) })).filter((t) => t.label);
  if (Array.isArray(text.clauses)) out.clauses = resolveGroups(text.clauses, regular.clauses);
  return out;
}

// custom.text with its words cleaned and every part that shows exactly the regular wording dropped
// (a contract without a change is a regular one). Undefined: nothing left.
export function normalizeText(text, regular) {
  if (!isObject(text)) return undefined;
  const shown = resolveText(text, regular);
  const out = {};
  if (shown.cover) {
    const cover = {};
    for (const k of COVER_KEYS) if (typeof text.cover[k] === 'string' && shown.cover[k] !== regular.cover[k]) cover[k] = shown.cover[k];
    if (Object.keys(cover).length) out.cover = cover;
  }
  const cleanGroups = (groups) => groups.map((g) => {
    const title = given(g.title) ? (isTitleRef(g.title) ? g.title.trim() : cleanText(g.title)) : undefined;
    const items = g.items.map((x) => (isItemRef(x) ? x.trim() : cleanText(x))).filter(Boolean);
    return { ...(title ? { title } : {}), items };
  }).filter((g) => g.title || g.items.length);
  for (const part of ['package', 'details']) {
    if (!shown[part] || JSON.stringify(shown[part]) === JSON.stringify(regular[part])) continue;
    const v = text[part];
    const p = {};
    const title = given(v.title) ? (isTitleRef(v.title) ? v.title.trim() : cleanText(v.title)) : '';
    if (title && shown[part].title !== regular[part].title) p.title = title;
    if (Array.isArray(v.groups) && JSON.stringify(shown[part].groups) !== JSON.stringify(regular[part].groups)) p.groups = cleanGroups(v.groups);
    if (Object.keys(p).length) out[part] = p;
  }
  if (shown.tiles && JSON.stringify(shown.tiles) !== JSON.stringify(regular.tiles)) out.tiles = shown.tiles;
  if (shown.clauses && JSON.stringify(shown.clauses) !== JSON.stringify(regular.clauses)) out.clauses = cleanGroups(text.clauses);
  return Object.keys(out).length ? out : undefined;
}

// The Hebrew names of the parts written by hand (for "מה שונה מהחבילה").
export const TEXT_PART_NAMES = {
  cover: 'הכותרת', package: 'מה כוללת החבילה', details: 'פירוט החבילה', tiles: 'המספרים של החבילה', clauses: 'סעיפי ההסכם',
};

// The regular parts with every line as a reference (the editor's starting point and the AI's
// numbering): the same shape as custom.text.
export function asRefs(regular) {
  const groups = (list) => list.map((g, i) => ({ title: `{{${i + 1}}}`, items: g.items.map((_, j) => `{{${i + 1}.${j + 1}}}`) }));
  return {
    cover: { ...regular.cover },
    package: { title: regular.package.title, groups: groups(regular.package.groups) },
    details: { title: regular.details.title, groups: groups(regular.details.groups) },
    tiles: regular.tiles.map((t) => ({ ...t })),
    clauses: groups(regular.clauses),
  };
}

// The regular wording numbered, for a prompt or for Claude: "2.1 ..." per line.
export function numberedText(regular) {
  const list = (groups) => groups.map((g, i) => [`${i + 1}. ${g.title}`, ...g.items.map((x, j) => `  ${i + 1}.${j + 1} ${x}`)].join('\n')).join('\n');
  return [
    `cover: title "${regular.cover.title}" · subtitle "${regular.cover.packageName}" · influencerLine "${regular.cover.influencer}"`,
    `package (title "${regular.package.title}"):\n${list(regular.package.groups)}`,
    `details (title "${regular.details.title}"):\n${list(regular.details.groups)}`,
    `tiles: ${regular.tiles.map((t) => `${t.n} ${t.label}`).join(' · ')}`,
    `clauses:\n${list(regular.clauses)}`,
  ].join('\n\n');
}

/* ── The text parts from "הכנת חוזה עם AI" and from Claude (prepare_contract_draft) ──
   Their shape for a model (structured outputs: one union-typed parameter, "" and [] for "the regular
   words"), its mapping onto custom.text, and the check of what came back: a line with the client's
   details or with money is left out, a reference to the clause of the price is put back when missing. */
const STR = { type: 'string' };
const GROUPS_SCHEMA = {
  type: 'array',
  items: { type: 'object', additionalProperties: false, required: ['title', 'items'], properties: { title: STR, items: { type: 'array', items: STR } } },
};
export const TEXT_AI_PROPS = {
  title: STR, subtitle: STR, influencerLine: STR, noInfluencerLine: { type: 'boolean' },
  packageTitle: STR, packageGroups: GROUPS_SCHEMA, detailsTitle: STR, details: GROUPS_SCHEMA,
  tiles: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['n', 'label'], properties: { n: STR, label: STR } } },
  clauses: GROUPS_SCHEMA,
};
export const TEXT_AI_KEYS = Object.keys(TEXT_AI_PROPS);
// For an API schema (all keys required).
export const TEXT_AI_SCHEMA = { type: 'object', additionalProperties: false, required: TEXT_AI_KEYS, properties: TEXT_AI_PROPS };

// An email, or a number as long as a phone or a company id.
export const PERSONAL = /@|(?:\d[\s().\-‎‏]*){8,}/;

// The model's shape onto custom.text (a custom.text given as it is passes through). Null: none.
export function textFromAi(t) {
  if (!isObject(t)) return null;
  // custom.text itself (checked once already): its own parts. tiles and clauses are the same in both.
  if ('cover' in t || 'package' in t || isObject(t.details)) return t;
  const s = (v) => (typeof v === 'string' ? v : '');
  const list = (v) => (Array.isArray(v) && v.length ? v : null);
  const out = {};
  const cover = {};
  if (cleanText(s(t.title))) cover.title = s(t.title);
  if (cleanText(s(t.subtitle))) cover.packageName = s(t.subtitle);
  if (t.noInfluencerLine === true) cover.influencer = '';
  else if (cleanText(s(t.influencerLine))) cover.influencer = s(t.influencerLine);
  if (Object.keys(cover).length) out.cover = cover;
  for (const [part, title, groups] of [['package', 'packageTitle', 'packageGroups'], ['details', 'detailsTitle', 'details']]) {
    const p = {};
    if (cleanText(s(t[title]))) p.title = s(t[title]);
    if (list(t[groups])) p.groups = t[groups];
    if (Object.keys(p).length) out[part] = p;
  }
  if (list(t.tiles)) out.tiles = t.tiles;
  if (list(t.clauses)) out.clauses = t.clauses;
  return Object.keys(out).length ? out : null;
}

// What came back, made safe: { text (custom.text or null), notes: [Hebrew] }. `client`: the details
// the same answer gave for the client's fields ({ name, company, companyId, phone, email }); a line
// with any of them is left out too. Never throws.
export function checkAiText(raw, client = {}) {
  const notes = [];
  const t = textFromAi(raw);
  if (!t) return { text: null, notes };
  const who = Object.values(isObject(client) ? client : {}).map((v) => cleanText(v)).filter((v) => v.length >= 3);
  const fix = (v, max) => cleanText(String(v ?? '').replace(/[<>`\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ')).slice(0, max);
  let personal = 0;
  let money = 0;
  // A plain line: '' when it is left out.
  const line = (v, max) => {
    if (typeof v !== 'string') return '';
    if (isItemRef(v) || isTitleRef(v)) return v.trim();
    const x = fix(v, max).replace(/[{}]/g, '');
    if (PERSONAL.test(x) || who.some((w) => x.includes(w))) { personal += 1; return ''; }
    if (MONEY.test(x)) { money += 1; return ''; }
    return x;
  };
  const groups = (list, max) => (Array.isArray(list) ? list : []).slice(0, max).filter(isObject).map((g) => ({
    title: line(g.title, TEXT_LIMITS.title),
    items: (Array.isArray(g.items) ? g.items : []).slice(0, TEXT_LIMITS.items).map((x) => line(x, TEXT_LIMITS.line)).filter(Boolean),
  })).filter((g) => g.title || g.items.length);
  const out = {};
  if (isObject(t.cover)) {
    const cover = {};
    for (const k of COVER_KEYS) {
      if (typeof t.cover[k] !== 'string') continue;
      const x = line(t.cover[k], TEXT_LIMITS.title);
      if (x || (k === 'influencer' && !cleanText(t.cover[k]))) cover[k] = x;
    }
    if (Object.keys(cover).length) out.cover = cover;
  }
  for (const part of ['package', 'details']) {
    if (!isObject(t[part])) continue;
    const p = {};
    const title = line(t[part].title, TEXT_LIMITS.title);
    if (title) p.title = title;
    const g = groups(t[part].groups, TEXT_LIMITS.groups);
    if (g.length) p.groups = g;
    if (Object.keys(p).length) out[part] = p;
  }
  if (Array.isArray(t.tiles)) {
    const tiles = t.tiles.slice(0, TEXT_LIMITS.tiles).filter(isObject)
      .map((x) => ({ n: line(x.n, TEXT_LIMITS.tileN), label: line(x.label, TEXT_LIMITS.tileLabel) })).filter((x) => x.label);
    if (tiles.length) out.tiles = tiles;
  }
  if (Array.isArray(t.clauses)) {
    const c = groups(t.clauses, TEXT_LIMITS.sections);
    if (c.length) {
      // The clause of the price is always the computed one: put back when it was left out.
      if (!c.some((g) => g.items.some((x) => keepsPrice(x)))) {
        if (c.length >= 2) c[1].items.unshift(PRICE_CLAUSE);
        else c.push({ title: '{{2}}', items: [PRICE_CHAPTER] });
        notes.push('סעיף המחיר נשאר כמו בנוסח הרגיל (המחיר מחושב).');
      }
      out.clauses = c;
    }
  }
  if (personal) notes.push(personal === 1 ? 'שורה עם פרטי הלקוח לא נכנסה לנוסח: הפרטים נכנסים רק לפרטי הלקוח.' : `${personal} שורות עם פרטי הלקוח לא נכנסו לנוסח: הפרטים נכנסים רק לפרטי הלקוח.`);
  if (money) notes.push(money === 1 ? 'שורה עם סכום לא נכנסה לנוסח: המחיר מחושב.' : `${money} שורות עם סכום לא נכנסו לנוסח: המחיר מחושב.`);
  // The engine's own check, part by part: a part it refuses is left out.
  for (const k of Object.keys(out)) {
    const e = textErrors({ [k]: out[k] });
    if (e.length) { delete out[k]; notes.push(`${TEXT_PART_NAMES[k]}: הנוסח לא נכנס (${e[0]}).`); }
  }
  if (Object.keys(out).length && textErrors(out).length) return { text: null, notes: [...notes, 'הנוסח ארוך מדי ולא נכנס.'] };
  return { text: Object.keys(out).length ? out : null, notes };
}

// How the prompt and the tool explain the text parts (with the regular words, numbered).
export function textRulesText(regular) {
  return `# The document's own words (text)
The document has regular words, numbered below (for an agreement with Semyon, Michel and Denis, 12 months; the numbers inside them follow each contract). When the deal asks for words of its own (a condition, a promise, a rule, "תכתוב את זה בצורה מסודרת", "תוסיף לדגשים", a different start of the term or of the uploads, lines to add or remove), write them in text; otherwise leave every part of text empty ("" or []).
- Rewrite the seller's messy words into clean, formal contract Hebrew: full sentences, correct spelling, no slang, no WhatsApp style, the influencers by their names.
- Each list you give replaces the whole regular list of that part, in your order. To keep a regular line as it is, write only its reference: "{{2.1}}" (group 2, line 1), "{{3.*}}" (all the lines of group 3); "{{2}}" as a group's title keeps its regular title. The clauses are numbered by the system (1.1, 1.2…): never write numbers in front of a clause.
- Money is never written in text: no ₪, no price, no total, no payment amount. The lines with the price are references only: clauses always keep "{{2.1}}", and the details' price line is "{{1.1}}".
- Never write the client's name, business, company id (ח.פ), phone, email or address in text: those go to client only.
- Keep the document consistent: the numbers in your lines are the contract's quantities; when the deal changes when the term or the uploads start, rewrite clauses 1.1 and 1.2, the clauses of chapter 3 that say the same, and the details lines, so that they all say the same thing; a rule the deal adds (for example contents the client sends himself) gets a clause of its own in the chapter it belongs to, and a line in the package when it is something the client gets. When you write clauses, agreed conditions go there and not in specialClauses.
- packageGroups: "מה כוללת החבילה" (the title of each group, and its lines). details: "פירוט החבילה", the דגשים (detailsTitle "דגשים" when the deal calls them so). tiles: the package's numbers, all of them as they should be shown ({n: "104", label: "תכנים"}), only when the deal changes them or gives a total. title, subtitle, influencerLine: the cover's three lines (noInfluencerLine true when the subtitle already names the influencers).

${numberedText(regular)}`;
}
