// The intake pieces on the shared screens, kept here so those screens change by a
// line or two: the shortcut from a process to its form (the client card and "מה
// עליי"), what the characterization and the focus call gave (the client card, for
// everyone who sees the client: the editors get the business phone, the logo and
// "what must and must not be said"; never the client's private phone), and the
// history's words for the new marks.
import { h } from './quote-doc.js';
import { CHAR_ENDED } from './protocol-logic.js';
import { briefBlock } from './briefs.js';
import { businessPhoneOf, logoUrlOf, closingLine } from './characterization.js';
import { SEEN, DAY_BEFORE_KEY, readDayBefore } from './shoot-prep.js';
import { loadCharacterization, loadBriefs } from './intake-data.js';

const enc = encodeURIComponent;
const baseOf = (procId) => String(procId).replace(/^r\d+-/, '');

// The scripts page (scripts.html): Lior's and the owner's (`me` null is the owner;
// undefined: not known, so not offered). Others reach it by a grant, from the card.
// (A person the protocol does not know also has `me` null, but not the office's scope.)
export const writesScripts = (me, scope = 'office') => (me === null && scope === 'office') || me === 'lior';
export const scriptsHref = (clientId, round = 1) => `scripts.html?id=${enc(clientId)}${round > 1 ? `&round=${round}` : ''}`;

// The characterization, read-only (intake.html shows it so to whoever makes graphics
// from it and is not the office: Ilai, and Nirel on a client she works on). What they
// may read is the database's (characterizations: whoever sees the client).
export const CHAR_READERS = ['ilai', 'nirel'];
export const readsChar = (me) => CHAR_READERS.includes(me);
export const charViewHref = (clientId) => `intake.html?id=${enc(clientId)}`;
// The graphics processes (7 and 23) and Ilai's new logo (5) are made from it.
const CHAR_PROCS = ['p05', 'p07', 'p23'];

// The form a process is worked in, for the office (null: none, or not the office).
// Process 12 (the scripts) goes to the scripts page for Lior and the owner.
export function intakeShortcut(procId, clientId, { checks = {}, scope = 'office', complete = false, me = undefined } = {}) {
  const b = baseOf(procId);
  // The content Gantt (gantt.html): Ilai's processes 9, 28 and 29, for whoever sees the process.
  if (clientId && ['p09', 'p28', 'p29'].includes(b)) return h('a', { class: 'btn btn-sm ik-go gantt-go', href: `gantt.html?id=${enc(clientId)}` }, 'גאנט התוכן');
  if (clientId && readsChar(me) && CHAR_PROCS.includes(b)) return h('a', { class: 'btn btn-sm ik-go char-go', href: charViewHref(clientId) }, 'האפיון של הלקוח');
  if (scope !== 'office' || !clientId) return null;
  const round = Number(/^r(\d+)-/.exec(String(procId))?.[1] || 1);
  const r = round > 1 ? `&round=${round}` : '';
  const go = (href, label) => h('a', { class: 'btn btn-sm ik-go', href }, label);
  // Ofir's queue (qa.html): the assignment (22א) opens there on this client, and his
  // quality control of the videos (25) is done there (docs/ops.md, section 46). For him
  // and for the owners' view of the team; never for Irit, whom that page refuses.
  if (me === 'ofir' || me === null) {
    if (b === 'p22a' && !complete && checks[`${round > 1 ? `r${round}.` : ''}p22a.assigned`]?.state !== 'done') return go(`qa.html#assign-${enc(clientId)}${round > 1 ? `-r${round}` : ''}`, 'שיוך עורך');
    if (b === 'p25' && !complete) return go('qa.html#qa-h', 'לבקרת האיכות');
  }
  if (b === 'p04' && !complete) return go(`intake.html?id=${enc(clientId)}#${checks[CHAR_ENDED]?.state === 'done' ? 'form' : 'end'}`, checks[CHAR_ENDED]?.state === 'done' ? 'לטופס האפיון' : 'האפיון הסתיים');
  if (b === 'p12a') return go(`intake.html?id=${enc(clientId)}${r}#focus`, 'טופס שיחת הדגשים');
  if (b === 'p12' && writesScripts(me, scope)) return go(scriptsHref(clientId, round), 'כתיבת תסריטים');
  if (b === 'p12' || b === 'p13') return go(`intake.html?id=${enc(clientId)}${r}#scripts`, 'תסריטים וזום');
  if (['p11', 'p11b', 'p14', 'p15'].includes(b)) return go(`prep.html?id=${enc(clientId)}`, b === 'p15' ? 'בדיקת יום לפני' : b === 'p14' ? 'חוסמי יום צילום' : 'סגירת יום הצילום');
  return null;
}

// ── The client card's block ───────────────
let cache = { id: null, char: null, briefs: [], loaded: false };
async function loadFor(clientId, onReady) {
  cache = { id: clientId, char: null, briefs: [], loaded: false };
  const [char, briefs] = await Promise.all([
    loadCharacterization(clientId).catch(() => null),
    loadBriefs(clientId).catch(() => []),
  ]);
  if (cache.id !== clientId) return;
  cache = { id: clientId, char, briefs, loaded: true };
  onReady();
}
async function copy(text, toast) {
  try { await navigator.clipboard.writeText(text); toast?.('הועתק.'); } catch { toast?.('ההעתקה לא הצליחה. אפשר לסמן ולהעתיק ידנית.'); }
}

// Fills `slot` with the characterization's facts and the focus call, loading them
// once per client (re-rendering the card calls it again without a new load).
// `scripts`: this person writes the client's scripts (Lior, the owner, or a grant):
// the card links to the scripts page, even outside the office.
// `me`: staff.person; whoever reads the characterization outside the office (readsChar)
// gets a link to its read-only view.
export function mountClientIntake(slot, { client, scope = 'office', toast = null, rerender = null, scripts = false, me = undefined }) {
  if (!slot) return;
  if (!client) { slot.replaceChildren(); return; }
  if (cache.id !== client.id) { slot.replaceChildren(); loadFor(client.id, () => (rerender || (() => mountClientIntake(slot, { client, scope, toast, scripts, me })))()); return; }
  if (!cache.loaded) return;
  const phone = businessPhoneOf(cache.char);
  const logo = logoUrlOf(cache.char);
  const colors = String(cache.char?.fields?.colors || '').trim();
  const briefs = [...cache.briefs].sort((a, b) => a.round - b.round)
    .map((b) => briefBlock(b, { id: `ik-brief-${b.round}`, heading: `דגשים משיחת הדגשים (12א)${b.round > 1 ? ` · סבב ${b.round}` : ''}` })).filter(Boolean);
  const office = scope === 'office';
  const facts = [
    phone ? [h('dt', {}, 'טלפון העסק'), h('dd', {}, h('bdi', { dir: 'ltr', class: 'num' }, phone),
      h('button', { type: 'button', class: 'btn-text', onclick: () => copy(phone, toast) }, 'העתקה'),
      h('button', { type: 'button', class: 'btn-text', onclick: () => copy(closingLine(phone), toast) }, 'העתקת שורת הסגיר'))] : null,
    logo ? [h('dt', {}, 'לוגו'), h('dd', {}, h('a', { href: logo, target: '_blank', rel: 'noopener' }, 'הורדת הלוגו', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')))] : null,
    colors ? [h('dt', {}, 'צבעי המותג'), h('dd', {}, colors)] : null,
  ].filter(Boolean);
  const reads = !office && readsChar(me);
  const links = office || scripts || reads ? h('div', { class: 'ik-links' },
    office ? h('a', { class: 'btn btn-sm', href: `intake.html?id=${enc(client.id)}` }, 'אפיון ותוכן') : null,
    reads ? h('a', { class: 'btn btn-sm', href: charViewHref(client.id), id: 'ik-char' }, 'האפיון המלא') : null,
    scripts ? h('a', { class: 'btn btn-sm', href: scriptsHref(client.id), id: 'ik-scripts' }, 'כתיבת תסריטים') : null,
    office ? h('a', { class: 'btn btn-sm', href: `prep.html?id=${enc(client.id)}#requests`, id: 'ik-request' }, 'בקשת לקוח') : null,
    office ? h('a', { class: 'btn btn-sm btn-ghost', href: `prep.html?id=${enc(client.id)}` }, 'לפני יום צילום') : null) : null;
  if (!facts.length && !briefs.length && !links) { slot.replaceChildren(); return; }
  slot.replaceChildren(h('section', { class: 'block cc-side ik-summary', 'aria-labelledby': 'ik-sum-h' },
    h('h2', { id: 'ik-sum-h' }, 'מהאפיון ומשיחת הדגשים'),
    facts.length ? h('dl', { class: 'ik-facts' }, ...facts.flat()) : h('p', { class: 'muted' }, 'עוד לא נשמרו פרטים מהאפיון.'),
    ...briefs,
    links));
}

// ── History ───────────────────────────────
// Words for the marks of this module (null: not one of them).
export function describeIntakeMark(base, row) {
  const clear = row.action === 'clear';
  if (base === CHAR_ENDED) return clear ? 'ביטל/ה את הסימון "האפיון הסתיים"' : `סימן/ה שהאפיון הסתיים${row.note ? ` (${row.note.replace(/^האפיון הסתיים · /, '')})` : ''}`;
  if (base === SEEN('')) return clear ? null : 'עבר/ה על חוסמי יום הצילום';
  if (base === 'p13.zoomat') return clear ? 'ביטל/ה את מועד הזום' : `קבע/ה זום לאישור התסריטים${row.note ? ` ל־${new Date(row.note).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' })}` : ''}`;
  if (base === DAY_BEFORE_KEY('') && !clear && row.note?.startsWith('{')) {
    const r = readDayBefore(row.note);
    return `ביצע/ה את בדיקת יום לפני הצילום${r.failed.length ? ` (${r.failed.length} פריטים נכשלו ועברו לליאור)` : ' (הכול תקין)'}`;
  }
  return null;
}
