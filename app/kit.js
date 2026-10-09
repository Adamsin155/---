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

/* client and owner screens */
// The additions of the client card, the manager view, the sales pages, the quote builder
// and the pages the agency's clients open (docs/ops.md, section 53). Appended only:
// nothing above this line is changed.
Object.assign(ICONS, {
  star: ['M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z'],
  key: [['circle', { cx: 8, cy: 15.5, r: 4 }], 'M11 12.5l8.5-8.5', 'M16.5 7l2.5 2.5', 'M14 9.5l2 2'],
  lock: [['rect', { x: 5, y: 10.5, width: 14, height: 10, rx: 2.5 }], 'M8 10.5V8a4 4 0 0 1 8 0v2.5', 'M12 14.5v2'],
  shield: ['M12 3.5l7 2.6v5.4c0 4.4-2.9 7.6-7 9-4.1-1.4-7-4.6-7-9V6.1z', 'M9 12l2.2 2.2L15 10.3'],
  globe: [['circle', { cx: 12, cy: 12, r: 8.5 }], 'M3.5 12h17', 'M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5', 'M12 3.5c-2.6 2.4-3.8 5.2-3.8 8.5s1.2 6.1 3.8 8.5'],
  grid: [['rect', { x: 4, y: 4, width: 6.5, height: 6.5, rx: 1.8 }], ['rect', { x: 13.5, y: 4, width: 6.5, height: 6.5, rx: 1.8 }], ['rect', { x: 4, y: 13.5, width: 6.5, height: 6.5, rx: 1.8 }], ['rect', { x: 13.5, y: 13.5, width: 6.5, height: 6.5, rx: 1.8 }]],
  palette: ['M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.9 2-1.9 0-1.3-1.1-1.6-1.1-2.8 0-1 .8-1.8 1.9-1.8h2.200a3.5 3.5 0 0 0 3.5-3.500c0-3.9-3.8-7-8.5-7z', 'M7.8 12.5h.01', 'M9.5 8.5h.01', 'M13.5 7.5h.01'],
  play: [['circle', { cx: 12, cy: 12, r: 8.5 }], 'M10.3 8.800v6.4l5.2-3.2z'],
  target: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['circle', { cx: 12, cy: 12, r: 4.3 }], 'M12 12h.01'],
  upload: ['M12 15.5V4.5', 'M7.5 8.5L12 4l4.5 4.5', 'M4.5 15.5V18A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5'],
  download: ['M12 4.5v11', 'M7.5 11.5L12 16l4.5-4.5', 'M4.5 15.5V18A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5'],
  smile: [['circle', { cx: 12, cy: 12, r: 8.5 }], 'M8.5 13.8a4.2 4.2 0 0 0 7 0', 'M9.2 9.8h.01', 'M14.8 9.8h.01'],
  history: ['M4.5 12a7.5 7.5 0 1 0 2.3-5.4', 'M4 4.5v3.8h3.8', 'M12 8v4.2l2.8 1.7'],
  table: [['rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5 }], 'M3.5 9.5h17', 'M3.5 14.5h17', 'M9.5 9.5v10'],
  archive: [['rect', { x: 3.5, y: 4.5, width: 17, height: 4.5, rx: 1.5 }], 'M5 9v9a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V9', 'M10 13h4'],
  sign: ['M4 19.5h16', 'M5.5 15.5c2-5 4-8.5 5.5-8.5 2 0-1.5 7 .5 7 1.5 0 2-3 3.5-3s1 2.5 3.5 2.5'],
  tag: ['M3.8 12.3V5.3a1.5 1.5 0 0 1 1.5-1.5h7l8 8a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z', 'M8.3 8.3h.01'],
  coins: [['circle', { cx: 9, cy: 9, r: 5.5 }], 'M14.2 9.7a5.5 5.5 0 1 1-4.5 4.5', 'M9 7v4'],
  briefcase: [['rect', { x: 3.5, y: 7.5, width: 17, height: 12, rx: 2.5 }], 'M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5', 'M3.5 13h17'],
  search: [['circle', { cx: 11, cy: 11, r: 6.5 }], 'M16 16l4 4'],
  info: [['circle', { cx: 12, cy: 12, r: 8.5 }], 'M12 11v5', 'M12 7.8v.2'],
  script: ['M6.5 3.5h11A1.5 1.5 0 0 1 19 5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z', 'M8.5 8h7', 'M8.5 12h7', 'M8.5 16h4'],
  box: ['M12 3.5l8 4.2v8.6l-8 4.2-8-4.2V7.7z', 'M4 7.7l8 4.3 8-4.3', 'M12 12v8.5'],
});

// A side head that already exists in the page (`.side-head`, `.block-head` or any box
// holding a heading and its one line of hint) takes the icon square at its start; its
// heading, its id and its words stay as they are.
export function dressHead(box, name, tone = 'navy', { size = 'md' } = {}) {
  if (!box || box.querySelector(':scope > .k-ico')) return box;
  box.classList.add('k-sidehead');
  box.prepend(iconSquare(name, tone, { size }));
  return box;
}
// The same for several heads of a page at once: [[selector, icon, tone], …].
export function dressHeads(list, root = document) {
  for (const [sel, name, tone, opts] of list) for (const box of root.querySelectorAll(sel)) dressHead(box, name, tone, opts);
}

// A status word as a pill. `tone`: 'plain', 'ok', 'warn', 'late', 'info'.
export function pill(text, tone = 'plain', { id = null } = {}) {
  return el('span', { class: `k-pill k-pill-${tone}`, id }, text);
}

// The tile of one kind of thing that can be added: its icon square, a plus at the
// corner, its name and how many there are. A real <button> (or the <summary> of a
// <details> that opens a small form): `tag`.
//   { icon, tone, label, count (words: "3 קבצים"), id, cls, tag ('button' | 'summary'), onclick, lead (words for a screen reader before the name) }
export function tile({ icon: name, tone = 'navy', label, count = null, id = null, cls = '', tag = 'button', onclick = null, lead = null }) {
  return el(tag, { type: tag === 'button' ? 'button' : null, class: `k-tile${cls ? ` ${cls}` : ''}`, id, onclick },
    iconSquare(name, tone),
    el('span', { class: 'k-tile-plus', 'aria-hidden': 'true' }, icon('plus', { size: 16 })),
    el('span', { class: 'k-tile-name' }, lead ? el('span', { class: 'sr-only' }, lead) : null, label),
    count === null ? null : el('span', { class: 'k-tile-n' }, count));
}

// The quiet empty line: a soft box, a small icon and one sentence in a row (inside a
// block that already has its head; `emptyState` is the big one for a whole screen).
export function emptyRow({ icon: name = 'inbox', text, cls = 'muted', id = null }) {
  return el('div', { class: 'k-emptyrow', id }, icon(name, { size: 18 }), el('p', { class: cls }, text));
}

// The head of a small card inside a block: a small icon square, the heading and a counter.
export function cardHead({ icon: name, tone = 'navy', title, level = 3, count = null, id = null }) {
  return el('div', { class: 'k-cardhead' }, iconSquare(name, tone, { size: 'sm' }), el(`h${level}`, { id }, title), count === null ? null : el('span', { class: 'k-count' }, String(count)));
}

// A notice strip around a sentence that already exists (its element, id and words stay).
export function noticeAround(p, { kind = 'info', icon: name = null } = {}) {
  const [defIcon, tone] = NOTICE[kind] || NOTICE.info;
  p.classList.add('k-notice-t');
  return el('div', { class: `k-notice k-notice-${NOTICE[kind] ? kind : 'info'}` }, iconSquare(name || defIcon, tone, { size: 'sm' }), p);
}
// An element that already exists (a status sentence whose text the page rewrites) gets
// the icon square beside it: a small row is put in its place, holding the square and the
// element itself, which keeps its id, its classes and its words.
export function besideIcon(node, name, tone = 'navy', { size = 'md' } = {}) {
  if (!node || node.parentNode?.classList.contains('k-beside')) return node;
  const row = el('div', { class: 'k-beside' });
  node.replaceWith(row);
  row.append(iconSquare(name, tone, { size }), node);
  return node;
}
// A control that already exists (a tab, a button, a link) gets a small icon before its words.
export function leadIcon(node, name, { size = 16 } = {}) {
  if (!node || node.querySelector(':scope > .k-svg')) return node;
  node.classList.add('k-with-ico');
  node.prepend(icon(name, { size }));
  return node;
}
/* end: client and owner screens */

/* office screens */
// ── The office's screens (docs/ops.md, section 52): more icons, and the pieces a list of
// things is built from: a row with an icon square, a status pill, a line of small facts,
// an icon on a status sentence, and one table that dresses the headings a page's modules draw.
Object.assign(ICONS, {
  pin: ['M12 21s-6.5-5.9-6.5-11a6.5 6.5 0 0 1 13 0c0 5.1-6.5 11-6.5 11z', ['circle', { cx: 12, cy: 10, r: 2.4 }]],
  scissors: [['circle', { cx: 6.5, cy: 7, r: 2.6 }], ['circle', { cx: 6.5, cy: 17, r: 2.6 }], 'M8.7 8.5 20 17.5', 'M8.7 15.5 20 6.5'],
  pause: [['circle', { cx: 12, cy: 12, r: 8.5 }], 'M10 9v6', 'M14 9v6'],
  key: [['circle', { cx: 8, cy: 15, r: 4 }], 'M11 12.2 19.5 3.8', 'M16 7.3l2.7 2.7'],
  star: ['M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z'],
  target: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['circle', { cx: 12, cy: 12, r: 4.5 }], 'M12 12h.01'],
  play: [['circle', { cx: 12, cy: 12, r: 8.5 }], 'M10.2 8.6v6.8l5.4-3.4z'],
  search: [['circle', { cx: 11, cy: 11, r: 6.5 }], 'M16 16l4.5 4.5'],
  shield: ['M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2z', 'M9 12l2.2 2.2 3.8-4'],
  sliders: ['M5 7h9', 'M18 7h1', 'M5 12h2', 'M11 12h8', 'M5 17h8', 'M17 17h2', ['circle', { cx: 16, cy: 7, r: 2 }], ['circle', { cx: 9, cy: 12, r: 2 }], ['circle', { cx: 15, cy: 17, r: 2 }]],
  eye: ['M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z', ['circle', { cx: 12, cy: 12, r: 2.8 }]],
  lock: [['rect', { x: 5, y: 10.5, width: 14, height: 10, rx: 2.5 }], 'M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7'],
  drive: [['rect', { x: 3.5, y: 13, width: 17, height: 7, rx: 2.5 }], 'M5.2 13 7.4 5.6A1.5 1.5 0 0 1 8.8 4.5h6.4a1.5 1.5 0 0 1 1.4 1.1l2.2 7.4', 'M16.5 16.5h.01'],
  upload: ['M12 15.5V4.5', 'M7.5 9 12 4.5 16.5 9', 'M4.5 15.5V18A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5'],
  mic: [['rect', { x: 9, y: 3.5, width: 6, height: 10.5, rx: 3 }], 'M5.5 11.5a6.5 6.5 0 0 0 13 0', 'M12 18v2.5'],
  palette: ['M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.6-2.2-.5-1.4.3-2.6 1.8-2.6H17a3.5 3.5 0 0 0 3.5-3.6C20.4 7.1 16.6 3.5 12 3.5z', 'M7.8 12.5h.01', 'M9.5 8.3h.01', 'M14 7.6h.01'],
  trend: ['M3.5 17 9.5 11l3.5 3.5L20.5 7', 'M15.5 7h5v5'],
  wallet: [['rect', { x: 3.5, y: 6, width: 17, height: 13.5, rx: 3 }], 'M3.5 10h17', 'M16 14.8h.01'],
  box: ['M12 3.5 20 8v8l-8 4.5L4 16V8z', 'M4 8l8 4.5L20 8', 'M12 12.5v8'],
  tv: [['rect', { x: 3.5, y: 5, width: 17, height: 11.5, rx: 2.5 }], 'M8.5 20h7', 'M12 16.5V20'],
});

// (pill() is defined once, above: any tone the stylesheet knows.)

// One thing in a list, as a row: the icon square, the key fact, a quiet second line, and
// whatever sits at the far end (a pill, a button). Its text is its parts in order.
//   { icon, tone, title, sub, end, tag ('div' | 'li' | 'a'), cls, href, id, size }
export function row({ icon: name, tone = 'navy', title, sub = null, end = null, tag = 'div', cls = '', href = null, id = null, size = 'md' }) {
  return el(tag, { class: `k-row${cls ? ` ${cls}` : ''}`, href, id },
    iconSquare(name, tone, { size }),
    el('span', { class: 'k-row-t' }, el('strong', { class: 'k-row-title' }, title), sub ? el('span', { class: 'k-row-sub' }, sub) : null),
    end);
}

// The friendly empty state as a list's one item (`<li class="empty">`, as the lists already have it).
export function emptyItem(text, { icon: name = 'check-circle', tone = 'green', cls = 'empty' } = {}) {
  return el('li', { class: `${cls} k-empty` }, iconSquare(name, tone, { size: 'lg' }), el('p', {}, text));
}

// A few small facts in one wrapping line, each with its own small icon: [[icon, text], …].
// Read as text they are still one sentence: the " · " between them stays, and is not drawn.
export function facts(list, { cls = '' } = {}) {
  return el('ul', { class: `k-facts${cls ? ` ${cls}` : ''}` }, list.filter((x) => x && x[1]).map(([name, text], i) => el('li', {}, i ? el('i', { class: 'k-sep' }, ' · ') : null, el('span', { class: 'k-fact' }, icon(name, { size: 16 }), text))));
}

// An existing sentence (a status line, a note) takes a small icon square and the look of
// a notice strip; its words, its id and its role stay. `kind` as in `notice`.
export function noteIcon(node, kind = 'info', name = null) {
  if (!node) return node;
  const [defIcon, tone] = NOTICE[kind] || NOTICE.info;
  for (const k of Object.keys(NOTICE)) node.classList.remove(`k-note-${k}`);
  node.classList.add('k-note', `k-note-${NOTICE[kind] ? kind : 'info'}`);
  node.querySelector(':scope > .k-ico')?.remove();
  const square = iconSquare(name || defIcon, tone, { size: 'sm' });
  square.classList.add('k-ico-first');
  node.append(square);
  return node;
}

// One table per page: [selector, icon, tone, size?]. The headings a page's modules draw
// take their icon square as they are drawn (in the same turn, before the paint, so
// nothing moves). The words, ids and whatever reads them stay as they are.
export function dress(root, table) {
  if (!root) return;
  const run = () => {
    for (const [sel, name, tone, size = 'sm'] of table) for (const node of root.querySelectorAll(sel)) headIcon(node, name, tone, { size, end: true });
    // The notifications card says its state in its heading: blocked or missing is the pink one.
    for (const node of root.querySelectorAll('h2#push-h')) { const off = /חסומות|לא /.test(node.textContent); headIcon(node, off ? 'bell-off' : 'bell', off ? 'pink' : 'blue', { size: 'sm', end: true }); }
  };
  run();
  new MutationObserver(run).observe(root, { childList: true, subtree: true });
}
