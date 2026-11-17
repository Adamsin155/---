// "עריכה" in the builder's preview (the owner, 17.11.2026; docs/ops.md, section 142): one part of the
// document's words (the cover, "מה כוללת החבילה", "פירוט החבילה", the package's numbers, the clauses)
// edited in place, a box per line, add and delete a line, "חזרה לנוסח הרגיל" to drop what was written.
// What is saved is selection.custom.text[part] (app/contract-text.js): a line nobody changed stays a
// reference to the regular wording, so it keeps following the contract's numbers; a line with money
// (the price) is shown locked, and the clause of the price can never be deleted.
// The DOM only: no state of the builder here (app/builder.js passes what it needs and gets the part).
import { h } from './quote-doc.js';
import { REF, MONEY, cleanText, textErrors, TEXT_LIMITS, COVER_KEYS } from './contract-text.js';
import { PRICE_CLAUSE } from './legal.js';

export const PART_TITLES = {
  cover: 'הכותרת', package: 'מה כוללת החבילה', details: 'פירוט החבילה', tiles: 'המספרים של החבילה', clauses: 'סעיפי ההסכם',
};

// The groups of a list part as the editor holds them: [{ title: { ref, text }, items: [{ ref, text }] }].
function working(list, regular) {
  const out = [];
  for (const g of list) {
    const t = REF.exec(String(g.title ?? '').trim());
    const title = t && t[2] === undefined
      ? { ref: `{{${t[1]}}}`, text: regular[Number(t[1]) - 1]?.title ?? '' }
      : { ref: null, text: cleanText(g.title) };
    const items = [];
    for (const raw of g.items || []) {
      const m = REF.exec(String(raw).trim());
      if (!m || m[2] === undefined) { items.push({ ref: null, text: cleanText(raw) }); continue; }
      const src = regular[Number(m[1]) - 1]?.items || [];
      if (m[2] === '*') src.forEach((x, j) => items.push({ ref: `{{${m[1]}.${j + 1}}}`, text: x }));
      else if (src[Number(m[2]) - 1] !== undefined) items.push({ ref: `{{${m[1]}.${m[2]}}}`, text: src[Number(m[2]) - 1] });
    }
    out.push({ title, items });
  }
  return out;
}
const allRefs = (regular) => regular.map((g, i) => ({ title: `{{${i + 1}}}`, items: g.items.map((_, j) => `{{${i + 1}.${j + 1}}}`) }));

// The part as it is stored, from what the editor holds (a line left as it was stays a reference).
function storedGroups(groups) {
  return groups.map((g) => ({
    title: g.title.ref ? g.title.ref : cleanText(g.title.text),
    items: g.items.map((i) => (i.ref ? i.ref : cleanText(i.text))).filter(Boolean),
  })).filter((g) => g.title || g.items.length);
}

// The Hebrew words for what the engine refuses.
function problemWords(errors) {
  const e = errors.join(' ');
  if (/money/.test(e)) return 'סכומים לא כותבים בנוסח: המחיר מחושב אוטומטית.';
  if (/price/.test(e)) return 'סעיף המחיר חייב להישאר.';
  if (/not allowed/.test(e)) return 'יש תו שאי אפשר לכתוב בנוסח (למשל < או >).';
  if (/too long/.test(e)) return 'יש שורה ארוכה מדי.';
  if (/too many/.test(e)) return 'יותר מדי שורות.';
  return 'הנוסח לא נשמר. בודקים את השורות ומנסים שוב.';
}

// A box as tall as its words (only once it is on the page: before that it has no height to measure).
const grow = (el) => { if (!el.isConnected) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };

// part: 'cover' | 'package' | 'details' | 'tiles' | 'clauses'; regular: regularText() of the contract;
// current: what custom.text has for this part now (or undefined).
// onSave(value) with the part to store, onReset() to drop it, onCancel().
export function textEditor({ part, regular, current, onSave, onReset, onCancel }) {
  const box = h('div', { class: 'te', role: 'group', 'aria-label': `עריכת ${PART_TITLES[part]}`, 'data-part': part });
  const error = h('p', { class: 'te-error', role: 'alert', hidden: true });
  const say = (text) => { error.textContent = text || ''; error.hidden = !text; };
  let body;
  let collect;

  if (part === 'cover') {
    const now = { ...regular.cover, ...(current || {}) };
    const fields = [['title', 'כותרת'], ['packageName', 'שורה שנייה'], ['influencer', 'שורה שלישית (ריק: בלי)']];
    const inputs = {};
    body = h('div', { class: 'te-fields' }, fields.map(([k, label]) => h('label', { class: 'te-field' },
      h('span', {}, label),
      inputs[k] = h('input', { type: 'text', class: 'te-input', value: now[k] || '', maxlength: String(TEXT_LIMITS.title), dir: 'auto' }))));
    collect = () => Object.fromEntries(COVER_KEYS.map((k) => [k, cleanText(inputs[k].value)]));
  } else if (part === 'tiles') {
    const rows = (current || regular.tiles).map((t) => ({ n: t.n, label: t.label }));
    const list = h('ol', { class: 'te-tiles' });
    const draw = (focusAt = -1) => {
      list.replaceChildren(...rows.map((t, i) => h('li', { class: 'te-tile' },
        h('input', { type: 'text', class: 'te-input te-n', value: t.n, maxlength: String(TEXT_LIMITS.tileN), inputmode: 'text', 'aria-label': `מספר ${i + 1}`, oninput: (e) => { rows[i].n = e.target.value; } }),
        h('input', { type: 'text', class: 'te-input', value: t.label, maxlength: String(TEXT_LIMITS.tileLabel), dir: 'auto', 'aria-label': `מה נספר ${i + 1}`, oninput: (e) => { rows[i].label = e.target.value; } }),
        h('button', { type: 'button', class: 'te-del', 'aria-label': `מחיקת ${t.label || 'השורה'}`, onclick: () => { rows.splice(i, 1); draw(); } }, '×'))));
      if (focusAt >= 0) list.querySelectorAll('.te-n')[focusAt]?.focus();
    };
    draw();
    body = h('div', {}, list, h('button', { type: 'button', class: 'te-add', disabled: false, onclick: () => { if (rows.length >= TEXT_LIMITS.tiles) return; rows.push({ n: '', label: '' }); draw(rows.length - 1); } }, '+ הוספת מספר'));
    collect = () => rows.map((t) => ({ n: cleanText(t.n), label: cleanText(t.label) })).filter((t) => t.label);
  } else {
    // package, details, clauses: groups of lines.
    const reg = part === 'clauses' ? regular.clauses : regular[part].groups;
    const given = part === 'clauses' ? current : current?.groups;
    const groups = working(given || allRefs(reg), reg);
    const regTitle = part === 'clauses' ? null : regular[part].title;
    const titleInput = regTitle !== null
      ? h('input', { type: 'text', class: 'te-input te-ptitle', value: current?.title || regTitle, maxlength: String(TEXT_LIMITS.title), dir: 'auto', 'aria-label': 'כותרת החלק' })
      : null;
    const list = h('div', { class: 'te-groups' });
    const word = part === 'clauses' ? 'פרק' : 'קבוצה';
    const draw = (focus = null) => {
      list.replaceChildren(...groups.map((g, gi) => h('fieldset', { class: 'te-group' },
        h('legend', { class: 'sr-only' }, `${word} ${gi + 1}`),
        h('div', { class: 'te-ghead' },
          part === 'clauses' ? h('span', { class: 'te-num num' }, `${gi + 1}.`) : null,
          h('input', { type: 'text', class: 'te-input te-gtitle', value: g.title.text, maxlength: String(TEXT_LIMITS.title), dir: 'auto', 'aria-label': `כותרת ה${word} ${gi + 1}`,
            oninput: (e) => { g.title = { ref: null, text: e.target.value }; } }),
          g.items.some((i) => i.ref === PRICE_CLAUSE && part === 'clauses') ? null
            : h('button', { type: 'button', class: 'te-del te-del-group', 'aria-label': `מחיקת ה${word} ${gi + 1}`, onclick: () => { groups.splice(gi, 1); draw(); } }, `מחיקת ה${word}`)),
        h('ol', { class: 'te-lines' }, g.items.map((it, ii) => {
          const locked = !!it.ref && MONEY.test(it.text);
          const keep = part === 'clauses' && it.ref === PRICE_CLAUSE;
          return h('li', { class: `te-line${locked ? ' is-locked' : ''}` },
            part === 'clauses' ? h('span', { class: 'te-num num' }, `${gi + 1}.${ii + 1}`) : null,
            locked
              ? h('div', { class: 'te-locked' }, h('span', {}, it.text), h('small', {}, 'מחושב אוטומטית'))
              : h('textarea', { class: 'te-text', rows: '1', dir: 'auto', maxlength: String(TEXT_LIMITS.line), 'aria-label': `שורה ${ii + 1}`,
                oninput: (e) => { it.ref = null; it.text = e.target.value; grow(e.target); } }, it.text),
            keep ? null : h('button', { type: 'button', class: 'te-del', 'aria-label': `מחיקת שורה ${ii + 1}`, onclick: () => { g.items.splice(ii, 1); draw(); } }, '×'));
        })),
        h('button', { type: 'button', class: 'te-add', onclick: () => {
          if (g.items.length >= TEXT_LIMITS.items) return;
          g.items.push({ ref: null, text: '' });
          draw([gi, g.items.length - 1]);
        } }, '+ הוספת שורה'))));
      for (const ta of list.querySelectorAll('textarea')) grow(ta);
      if (focus) {
        const group = list.querySelectorAll('.te-group')[focus[0]];
        const el = focus[1] === 'title' ? group?.querySelector('.te-gtitle') : group?.querySelectorAll('.te-line')[focus[1]]?.querySelector('textarea');
        el?.focus();
      }
    };
    draw();
    const max = part === 'clauses' ? TEXT_LIMITS.sections : TEXT_LIMITS.groups;
    body = h('div', {}, titleInput, list,
      h('button', { type: 'button', class: 'te-add te-add-group', onclick: () => {
        if (groups.length >= max) return;
        groups.push({ title: { ref: null, text: '' }, items: [{ ref: null, text: '' }] });
        draw([groups.length - 1, 'title']);
      } }, `+ הוספת ${word}`));
    collect = () => {
      const g = storedGroups(groups);
      if (part === 'clauses') return g;
      const title = cleanText(titleInput.value);
      return { ...(title && title !== regTitle ? { title } : {}), groups: g };
    };
  }

  box.append(
    h('div', { class: 'te-head' }, h('strong', {}, `עריכה: ${PART_TITLES[part]}`),
      h('span', { class: 'te-hint' }, part === 'clauses' ? 'המספור מתעדכן לבד. סעיף המחיר מחושב.' : 'סכומים מחושבים אוטומטית.')),
    body,
    // The refusal sits on the bar of the buttons, where the eyes are when saving.
    h('div', { class: 'te-actions' },
      error,
      h('button', { type: 'button', class: 'btn btn-primary btn-sm te-save', onclick: () => {
        const value = collect();
        const errors = textErrors({ [part]: value });
        if (errors.length) { say(problemWords(errors)); return; }
        say('');
        onSave(value);
      } }, 'שמירה'),
      h('button', { type: 'button', class: 'btn btn-sm te-cancel', onclick: () => onCancel() }, 'ביטול'),
      current ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm te-reset', onclick: () => onReset() }, 'חזרה לנוסח הרגיל') : null),
  );
  // Called once the editor is on the page.
  box.fit = () => { for (const ta of box.querySelectorAll('textarea')) grow(ta); };
  return box;
}
