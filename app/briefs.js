// Lior's focus call (process 12א, "שיחת דגשים"): the 10 topics as short fields,
// stored per client and shoot round (public.content_briefs), and shown read-only
// to whoever works on the content: the editors (their page and the client card),
// Ofir in quality control and Nirel. docs/plan/system-plan.md, section 3 (Lior:
// "התשובות נשמרות בכרטיס הלקוח, והעורכים, אופיר וניראל רואים אותן").
//
// The topics are read from process 12א's items in app/protocol.js (p12a.t.<key>),
// so the form and the protocol never disagree. Saving a topic checks its item.
//
// For other pages: briefBlock(brief) renders the answers (null when there are
// none); highlightsOf(brief) gives "what must be said and what must not" for the
// editors' card. Both take the row as loaded (loadBrief in intake-data.js).
import { PROCESSES } from './protocol.js';
import { h } from './quote-doc.js';

const P12A = PROCESSES.find((p) => p.id === 'p12a');
const PREFIX = 'נלקח מהלקוח: ';
// [[key, label, item key]] in the protocol's order.
export const FOCUS_TOPICS = P12A.items.filter((i) => i.key.startsWith('p12a.t.'))
  .map((i) => [i.key.slice('p12a.t.'.length), i.label.replace(PREFIX, ''), i.key]);
// The two the editors need first (editors.md: "מה חייבים להגיד ומה אסור").
export const MUST = 'messages';
export const MUST_NOT = 'dont';
// "סיכום דגשים לקוח": Lior's free-text summary of what the client stressed, written
// during the focus call or the Zoom (13), next to the topics. Not a protocol item:
// saving it checks nothing. Shown first wherever the answers are read.
export const SUMMARY = 'summary';
export const SUMMARY_LABEL = 'סיכום דגשים';
// The fields a saved brief keeps: the summary and the 10 topics.
export const BRIEF_KEYS = [SUMMARY, ...FOCUS_TOPICS.map(([k]) => k)];
// Placeholder shown for a topic that did not come up in the call.
export const NOT_RAISED = 'לא עלה בשיחה';

const clean = (v) => String(v ?? '').trim();
// Item keys of a round: 'p12a.t.x' in the first shoot, 'r2.p12a.t.x' in round 2.
export const roundKey = (key, round = 1) => (round > 1 ? `r${round}.${key}` : key);

// The protocol items the saved answers check (only those still open).
//   read   "the characterization was read in depth" (Lior ticks it in the form)
//   done   "the call took place": the topics left empty are then "not relevant",
//          with the reason NOT_RAISED (every topic is a required item).
export function briefChecks(fields, checks = {}, { round = 1, read = false, done = false } = {}) {
  const open = (k) => !checks[k] || (checks[k].state !== 'done' && checks[k].state !== 'na');
  const out = [];
  if (read) out.push({ key: roundKey('p12a.read', round), state: 'done', note: null });
  if (done) out.push({ key: roundKey('p12a.call', round), state: 'done', note: null });
  for (const [k, , item] of FOCUS_TOPICS) {
    const key = roundKey(item, round);
    if (clean(fields?.[k])) out.push({ key, state: 'done', note: null });
    else if (done) out.push({ key, state: 'na', note: NOT_RAISED });
  }
  return out.filter((w) => open(w.key));
}
export const emptyTopics = (fields) => FOCUS_TOPICS.filter(([k]) => !clean(fields?.[k]));

// "What must be said and what must not", for the editors' card (null when neither).
export function highlightsOf(brief) {
  const f = brief?.fields || {};
  const must = clean(f[MUST]);
  const dont = clean(f[MUST_NOT]);
  return must || dont ? { must: must || null, dont: dont || null } : null;
}

// The answers, read-only: the two highlights first, then the other topics that
// have an answer. `heading` names the block; `compact` keeps only the highlights
// (a narrow card). Null when nothing was saved yet.
export function briefBlock(brief, { heading = 'דגשים משיחת הדגשים (12א)', compact = false, id = 'brief' } = {}) {
  const f = brief?.fields || {};
  const hl = highlightsOf(brief);
  const summary = clean(f[SUMMARY]);
  const rest = compact ? [] : FOCUS_TOPICS.filter(([k]) => k !== MUST && k !== MUST_NOT && clean(f[k]));
  if (!hl && !rest.length && !summary) return null;
  const row = (label, text, cls = '') => [h('dt', { class: cls }, label), h('dd', { class: cls }, text)];
  return h('section', { class: 'brief-view', 'aria-labelledby': `${id}-h` },
    h('h2', { id: `${id}-h` }, heading),
    summary ? h('dl', { class: 'brief-hl brief-summary' }, row(SUMMARY_LABEL, summary, 'is-summary')) : null,
    hl ? h('dl', { class: 'brief-hl' },
      hl.must ? row('חייבים להגיד', hl.must, 'is-must') : null,
      hl.dont ? row('אסור להגיד', hl.dont, 'is-dont') : null) : null,
    rest.length ? h('dl', { class: 'brief-list' }, ...rest.flatMap(([k, label]) => row(label, clean(f[k])))) : null);
}
