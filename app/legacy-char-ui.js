// The old system's characterization as a block (the owner's request of 26.10.2026): the client
// card's closed row "אפיון מהמערכת הישנה" and the editors' page draw the same block. The filled
// characterization first, readable (app/legacy-char-logic.js), then a closed row each for the
// brief, the scripts, the summary and the raw answers. Read-only; on paper everything is open.
import { h } from './quote-doc.js';
import { legacyCharView } from './legacy-char-logic.js';

const HEAD = 'אפיון מהמערכת הישנה';

// The parts of a text as elements (the words go in as text, never as markup).
export function blocksEl(blocks) {
  return blocks.map((b) => {
    if (b.type === 'h') return h('h3', { class: 'lch-h' }, b.text);
    if (b.type === 'dl') return h('dl', { class: 'lch-dl' }, ...b.items.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v || '—')]));
    if (b.type === 'ul') return h('ul', { class: 'lch-ul' }, ...b.items.map((x) => h('li', {}, x)));
    return h('p', { class: 'lch-p' }, b.text);
  });
}

// row: public.legacy_characterizations' row (null: nothing to draw).
// id: the block's id; open: the set of the parts opened (kept across drawings by the page);
// printing: every part open.
export function legacyCharBlock(row, { id = 'legacy-char', open = new Set(), printing = false } = {}) {
  const v = legacyCharView(row);
  if (!v) return null;
  const part = (name, title, stamp, ...body) => {
    const d = h('details', { class: 'lch-fold', id: `${id}-${name}`, open: printing || open.has(name) },
      h('summary', {}, h('span', { class: 'lch-ft' }, title), stamp ? h('span', { class: 'lch-fs' }, stamp) : null),
      h('div', { class: 'lch-fb' }, ...body));
    d.addEventListener('toggle', () => { if (printing) return; if (d.open) open.add(name); else open.delete(name); });
    return d;
  };
  return h('section', { class: 'lch', id, 'aria-label': HEAD },
    h('p', { class: 'hint lch-note' }, 'כפי שנשמר במערכת הקודמת. לקריאה ולהדפסה בלבד; פרטי הקשר הוסרו מהטקסט (הם בכרטיס).'),
    v.filled
      ? h('article', { class: 'lch-doc', id: `${id}-filled` }, v.filled.stamp ? h('p', { class: 'lch-stamp' }, v.filled.stamp) : null, ...blocksEl(v.filled.blocks))
      : h('p', { class: 'muted lch-none' }, 'במערכת הישנה לא נשמר אפיון ממולא ללקוח הזה.'),
    v.brief ? part('brief', 'בריף מהמערכת הישנה', v.brief.stamp, ...blocksEl(v.brief.blocks)) : null,
    v.script ? part('script', 'תסריטים מהמערכת הישנה', v.script.stamp, ...blocksEl(v.script.blocks)) : null,
    v.summary ? part('summary', 'סיכום', null, ...blocksEl(v.summary.blocks)) : null,
    v.answers.length ? part('answers', `תשובות גולמיות (${v.answers.length})`, null,
      h('p', { class: 'hint' }, 'נוסח השאלות לא נשמר במערכת הישנה: מספר השאלה והתשובה בלבד.'),
      h('dl', { class: 'lch-dl lch-answers' }, ...v.answers.flatMap(([k, a]) => [h('dt', {}, `שאלה ${k}`), h('dd', {}, a)]))) : null);
}
