// The shared look of the app's blocks (the owner's choice of 9.10.2026; docs/ops.md,
// section 50): a soft coloured rounded square with an icon per kind of thing, a section
// head (icon, title, one line of hint), an "add" tile with a plus and a counter, a
// friendly empty state, a notice strip, and the counted line (a number, one sentence,
// a real button). The styles are app/styles/kit.css.
//
// Colour lives only in the icon squares (`tone`): the product stays navy, with the
// brand pink for a screen's one primary action and for what is late.
//
// Icons: one small set, drawn here as inline SVG (24px grid, a 2px round stroke,
// `currentColor`). No icon font and no outside file: the pages' policy allows neither
// (docs/ops.md, section 36). Every icon is decoration: `aria-hidden`, never the only
// carrier of a meaning; the words next to it say it.
//
// No dependency on the rest of the app, so every page can take it.
const SVG = 'http://www.w3.org/2000/svg';

// name → the shapes: a string is a path's `d`; an array is [tag, attributes].
export const ICONS = {
  clock: [['circle', { cx: 12, cy: 12, r: 8.5 }], 'M12 7.5V12l3 2'],
  alert: ['M12 3.8 2.9 19.2a1 1 0 0 0 .9 1.5h16.4a1 1 0 0 0 .9-1.5L12 3.8z', 'M12 10v4.2', 'M12 17.3v.2'],
  flag: ['M5.5 21V4', 'M5.5 4.5h11l-2 4 2 4h-11'],
  bolt: ['M13 2.8 5 13.5h6l-1 7.7 8-10.7h-6l1-7.7z'],
  bell: ['M6 10a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 15 6 10z', 'M10 19.5a2 2 0 0 0 4 0'],
  'bell-off': ['M6 10a6 6 0 0 1 9.2-5.1', 'M18 10c0 5 2 6.5 2 6.5H9.5', 'M10 19.5a2 2 0 0 0 4 0', 'M4 4l16 16'],
  calendar: [['rect', { x: 3.5, y: 5, width: 17, height: 15.5, rx: 3 }], 'M3.5 10h17', 'M8 3v4', 'M16 3v4'],
  'calendar-check': [['rect', { x: 3.5, y: 5, width: 17, height: 15.5, rx: 3 }], 'M8 3v4', 'M16 3v4', 'M8.5 13.5l2.5 2.5 4.5-4.5'],
  chat: ['M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z', 'M8.5 11h.01', 'M12 11h.01', 'M15.5 11h.01'],
  question: [['circle', { cx: 12, cy: 12, r: 8.5 }], 'M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2.9-1.2 1.7', 'M12 16.6v.2'],
  megaphone: ['M4 10v4a1 1 0 0 0 1 1h2.5l5.5 3.8V5.2L7.5 9H5a1 1 0 0 0-1 1z', 'M16.5 9.2a4 4 0 0 1 0 5.6', 'M19 6.8a7.5 7.5 0 0 1 0 10.4'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  'check-circle': [['circle', { cx: 12, cy: 12, r: 8.5 }], 'M8.2 12.3l2.6 2.6 5-5.2'],
  plus: ['M12 5.5v13', 'M5.5 12h13'],
  users: [['circle', { cx: 9, cy: 8.5, r: 3.3 }], 'M2.8 19.5a6.2 6.2 0 0 1 12.4 0', 'M15.8 5.4a3.3 3.3 0 0 1 0 6.2', 'M17.6 14.3a6.2 6.2 0 0 1 3.6 5.2'],
  user: [['circle', { cx: 12, cy: 8.5, r: 3.5 }], 'M5 20a7 7 0 0 1 14 0'],
  chart: ['M4 20.5h16.5', 'M7 20.5v-7', 'M12 20.5V5.5', 'M17 20.5v-10'],
  inbox: ['M3.5 13.5 6.2 6h11.6l2.7 7.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z', 'M3.5 13.5h5a3.5 3.5 0 0 0 7 0h5'],
  folder: ['M3.5 7A1.5 1.5 0 0 1 5 5.5h4.2l2 2.5H19A1.5 1.5 0 0 1 20.5 9.5V18A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z'],
  file: ['M7 3.5h7l4.5 4.5v11A1.5 1.5 0 0 1 17 20.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z', 'M14 3.5V8h4.5', 'M9 13h6', 'M9 16.5h4'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  image: [['rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 3 }], ['circle', { cx: 9, cy: 10, r: 1.6 }], 'M4.5 17.5l4.8-4.3 3.2 2.8 3-3.3 4.8 4.8'],
  video: [['rect', { x: 3.5, y: 6, width: 12, height: 12, rx: 3 }], 'M15.5 10.5l5-3v9l-5-3'],
  camera: ['M4.5 8h3l1.5-2.5h6L16.5 8h3A1.5 1.5 0 0 1 21 9.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V9.5A1.5 1.5 0 0 1 4.5 8z', ['circle', { cx: 12, cy: 13.5, r: 3.3 }]],
  send: ['M20.5 3.5 3.5 10.8l6.6 2.6 2.6 6.6z', 'M20.5 3.5 10.1 13.4'],
  phone: [['rect', { x: 7, y: 2.8, width: 10, height: 18.4, rx: 2.5 }], 'M11 17.8h2'],
  list: ['M8.5 6.5h11', 'M8.5 12h11', 'M8.5 17.5h11', 'M4.5 6.5h.01', 'M4.5 12h.01', 'M4.5 17.5h.01'],
  hourglass: ['M7 3.5h10', 'M7 20.5h10', 'M8 3.5c0 4.2 8 4.6 8 8.5s-8 4.3-8 8.5', 'M16 3.5c0 4.2-8 4.6-8 8.5s8 4.3 8 8.5'],
  sun: [['circle', { cx: 12, cy: 12, r: 3.8 }], 'M12 3v2.2', 'M12 18.8V21', 'M3 12h2.2', 'M18.8 12H21', 'M5.6 5.6l1.6 1.6', 'M16.8 16.8l1.6 1.6', 'M5.6 18.4l1.6-1.6', 'M16.8 7.2l1.6-1.6'],
  loop: ['M19.5 12a7.5 7.5 0 0 1-12.9 5.2', 'M4.5 12a7.5 7.5 0 0 1 12.9-5.2', 'M17.5 3.5v3.5H14', 'M6.5 20.5V17H10'],
  handshake: ['M3 8.5h4l3-2 4 .5 3 1.5h4', 'M3 15.5h3.5l4.7 3.4a1.5 1.5 0 0 0 1.8 0l5-3.4H21', 'M10 9.5 8 12a1.6 1.6 0 0 0 2.5 2l1.8-1.6 3.2 2.6'],
  edit: ['M4.5 19.5l1-4.2L16.3 4.5a2 2 0 0 1 2.9 0l.3.3a2 2 0 0 1 0 2.9L8.7 18.5z', 'M14.5 6.5l3 3'],
  heart: ['M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z'],
  // "Onward" in a right-to-left page points left.
  go: ['M14.5 6.5 9 12l5.5 5.5'],
};

// The named tones of an icon square (kit.css): only these.
export const TONES = ['navy', 'purple', 'green', 'orange', 'pink', 'blue', 'teal'];

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  node.append(...kids.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
  return node;
}

// One icon, as decoration.
export function icon(name, { size = 20 } = {}) {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ class: 'k-svg', viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, String(v));
  for (const part of ICONS[name] || ICONS.list) {
    const [tag, attrs] = typeof part === 'string' ? ['path', { d: part }] : part;
    const shape = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, String(v));
    svg.append(shape);
  }
  return svg;
}

// The soft rounded square with the icon in its tone. `size`: 'sm' (28px), 'md' (40px, the default), 'lg' (48px).
export function iconSquare(name, tone = 'navy', { size = 'md' } = {}) {
  return el('span', { class: `k-ico k-ico-${size}`, 'data-tone': TONES.includes(tone) ? tone : 'navy', 'aria-hidden': 'true' }, icon(name, { size: size === 'sm' ? 16 : size === 'lg' ? 24 : 20 }));
}

// An existing heading takes the icon square in front of its words (its text, its id
// and whatever reads it stay as they are).
// `end`: the square is added after the words and drawn first (`order`), for a heading
// whose first child is read by position.
export function headIcon(heading, name, tone = 'navy', { size = 'sm', end = false } = {}) {
  if (!heading || heading.querySelector(':scope > .k-ico')) return heading;
  heading.classList.add('k-h');
  const square = iconSquare(name, tone, { size });
  if (end) { square.classList.add('k-ico-first'); heading.append(square); } else heading.prepend(square);
  return heading;
}

// A section head: the icon, the title, one line of hint, and an action at the far end.
//   { icon, tone, title, hint, id, level (2), count, action (a node) }
export function sectionHead({ icon: name, tone = 'navy', title, hint = null, id = null, level = 2, count = null, action = null }) {
  return el('div', { class: 'k-head' },
    iconSquare(name, tone),
    el('div', { class: 'k-head-t' },
      el(`h${level}`, { class: 'k-title', id, tabindex: id ? '-1' : null }, title, count === null ? null : el('span', { class: 'k-count' }, String(count))),
      hint ? el('p', { class: 'k-hint' }, hint) : null),
    action);
}

// An "add" tile: a plus, what is added, and how many there are already.
//   { label, count, id, onclick, href }: a button, or a link when `href` is given.
export function addTile({ label, count = null, id = null, onclick = null, href = null, tone = 'navy' }) {
  const kids = [el('span', { class: 'k-add-plus', 'data-tone': tone, 'aria-hidden': 'true' }, icon('plus', { size: 18 })),
    el('span', { class: 'k-add-label' }, label), count === null ? null : el('span', { class: 'k-count' }, String(count))];
  return href ? el('a', { class: 'k-add', id, href }, kids) : el('button', { type: 'button', class: 'k-add', id, onclick }, kids);
}

// A friendly empty state: a soft box, an icon, one sentence, and at most one action.
export function emptyState({ icon: name = 'check-circle', tone = 'green', text, action = null, cls = 'empty' }) {
  return el('div', { class: 'k-empty' }, iconSquare(name, tone, { size: 'lg' }), el('p', { class: cls }, text), action);
}

// A notice strip: an icon and one sentence on a soft surface. `kind`: 'info', 'ok', 'warn', 'late'.
const NOTICE = { info: ['bell', 'blue'], ok: ['check-circle', 'green'], warn: ['alert', 'orange'], late: ['alert', 'pink'] };
export function notice({ kind = 'info', icon: name = null, text, action = null, role = 'note', id = null }) {
  const [defIcon, tone] = NOTICE[kind] || NOTICE.info;
  return el('div', { class: `k-notice k-notice-${NOTICE[kind] ? kind : 'info'}`, role, id }, iconSquare(name || defIcon, tone, { size: 'sm' }), el('p', { class: 'k-notice-t' }, text), action);
}

// The counted line (docs/ops.md, sections 46 and 50): what waits on another page, how
// many, and the way there. The whole row is the link (48px and up); the number is big,
// the sentence is one, and the action looks like the button it is.
//   { id, n, text, cta, href, tone ('late' | 'today' | 'plain' | 'landing'), cls, data }
// The sentence keeps its full words for whoever reads the page without eyes (and for
// the suites): when it starts with the number ("14 לקוחות מחכים…", "יש 13 לקוחות…") those
// first words are still there, only not drawn twice next to the big number. The last
// part after " · " ("בקליטה, בלי שעון") is the small second line. The big number is drawn
// by the stylesheet from `data-n`, so the text of the row is the sentence and the action,
// as it always was (the first <span> of the row is still the action).
export function countedLine({ id = null, n, text, cta, href, tone = 'plain', cls = '', data = {} }) {
  const lead = new RegExp(`^((?:יש )?${n} )(.+)$`).exec(String(text));
  const rest = lead ? lead[2] : String(text);
  const cut = rest.lastIndexOf(' · ');
  const [main, sub] = cut > 0 ? [rest.slice(0, cut), rest.slice(cut + 3)] : [rest, ''];
  return el('a', { class: `k-line k-line-${tone}${cls ? ` ${cls}` : ''}`, id, href, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, v])) },
    el('b', { class: 'k-num', 'data-n': String(n), 'aria-hidden': 'true' }),
    el('strong', { class: 'k-line-t' }, lead ? el('b', { class: 'sr-only' }, lead[1]) : null, main, sub ? el('small', { class: 'k-line-sub' }, el('i', { class: 'k-sep' }, ' · '), sub) : null),
    el('span', { class: 'k-go' }, cta, icon('go', { size: 16 })));
}
