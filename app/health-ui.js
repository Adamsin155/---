// The client's colour on screen: the badge, the reasons, the 8-station bar, the
// next milestone and the client card's timeline. Shared by owner.html
// (app/owner.js) and the client card (app/client-card.js). The logic is
// app/health.js; colour is never the only cue (an icon and the word go with it).
import { STATIONS } from './protocol.js';
import { COLORS, personName, dayText } from './health.js';
import { h, personChip, formatWhen, formatStamp, who } from './protocol-ui.js';

// "אדום", "צהוב", "ירוק", with a shape: ! in a filled circle, ! in a ring, a tick.
export const healthBadge = (color, extra = '') => h('span', { class: `hbadge h-${color} ${extra}`.trim() },
  h('span', { class: 'hicon', 'aria-hidden': 'true' }), COLORS[color] || '');

// "באיחור 2 ימי עסקים · 11 · קביעת יום צילום"
export const reasonText = (r) => [r.text, r.what].filter(Boolean).join(' · ');

// When, in words: "היום 10:00", "ג׳ 13.10", or "טרם נקבע · חייב להיקבע עד ה׳ 15.10".
export function whenText(m, now = new Date()) {
  if (!m) return '';
  // The client holds it: its date moves with the wait (decision 3), so none is shown.
  if (m.status === 'client') return 'ממתין ללקוח';
  if (m.when && m.status === 'overdue' && m.when < now) return `היה עד ${formatWhen(m.when, now)} · באיחור`;
  if (m.when) return formatWhen(m.when, now);
  return m.mustSetBy ? `טרם נקבע · חייב להיקבע עד ${formatWhen(m.mustSetBy, now)}` : 'טרם נקבע';
}

// "הבא: יום הצילום · ליאור · ג׳ 13.10"
export function nextText(next, now = new Date()) {
  if (!next) return 'הבא: אין אבני דרך פתוחות';
  return ['הבא: ' + next.what, next.who ? personName(next.who) : null, whenText(next, now)].filter(Boolean).join(' · ');
}

// The 8 stations: done, now (named in text) and ahead.
export function stationBar(index, { id = null } = {}) {
  return h('div', { class: 'stbar-wrap' },
    h('ol', { class: 'stbar', 'aria-label': 'התחנות במסע הלקוח', id },
      ...STATIONS.map((s, i) => h('li', {
        class: i < index ? 'is-done' : i === index ? 'is-now' : 'is-ahead', 'aria-current': i === index ? 'step' : null,
      }, h('span', { class: 'sr-only' }, `${i + 1}. ${s.title}${i < index ? ' (עבר)' : i === index ? ' (עכשיו)' : ''}`)))),
    h('p', { class: 'stbar-now' }, h('span', { class: 'num' }, `${index + 1}/8`), ' ', STATIONS[index].title));
}

// The client card's three lines: the colour and why; now (station, who, until
// when); next (the milestone, and what we wait for from the client).
export function healthHead(health, st, now = new Date()) {
  if (!health?.color || !st) return null;
  const [top, ...rest] = health.reasons;
  const cur = st.current;
  const nowLine = !cur ? 'אין כרגע משהו פתוח'
    : cur.waiting ? `ממתין ללקוח (${cur.what})`
      : [personName(cur.who), cur.until ? `עד ${formatWhen(cur.until, now)}` : null].filter(Boolean).join(' · ');
  return h('section', { class: `hhead h-${health.color}`, 'aria-label': 'מצב הלקוח' },
    h('p', { class: 'hline hline-why' },
      healthBadge(health.color),
      top ? h('span', { class: 'hwhy' }, h('strong', {}, top.text), top.what ? ` · ${top.what}` : '', ' ', personChip(top.who)) : h('span', { class: 'hwhy' }, 'הכול לפי התוכנית')),
    rest.length ? h('ul', { class: 'hrest' }, ...rest.slice(0, 3).map((r) => h('li', {}, reasonText(r), ' ', personChip(r.who))),
      rest.length > 3 ? h('li', { class: 'muted' }, `ועוד ${rest.length - 3}`) : null) : null,
    h('p', { class: 'hline' }, h('span', { class: 'k' }, 'עכשיו:'), ` ${st.title} · ${nowLine}`),
    h('p', { class: 'hline' }, h('span', { class: 'k' }, 'הבא:'),
      ` ${st.next ? [st.next.what, personName(st.next.who), whenText(st.next, now)].filter(Boolean).join(' · ') : 'אין אבני דרך פתוחות'}`,
      h('span', { class: 'hawait' }, st.awaited.length ? ` · מחכים מהלקוח: ${st.awaited.join(', ')}` : ' · לא מחכים לשום דבר מהלקוח')));
}

// The timeline: done (who and when; automatic and imported marked), now, and planned.
const DONE_SHOWN = 5;
export function timelineBlock(tl, { now = new Date(), showAll = false, onToggle = null, link = null } = {}) {
  const item = (cls, what, ...rest) => h('li', { class: `tl-item ${cls}` }, h('span', { class: 'tl-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'tl-body' }, link ? h('a', { href: `#${what.procId}`, onclick: (e) => { e.preventDefault(); link(what.procId); } }, what.what) : h('span', {}, what.what), ...rest));
  const done = showAll ? tl.done : tl.done.slice(-DONE_SHOWN);
  return h('section', { class: 'block cc-side tl', id: 'timeline', 'aria-labelledby': 'tl-h' },
    h('div', { class: 'side-head' }, h('h2', { id: 'tl-h' }, 'ציר זמן'),
      h('p', { class: 'muted' }, 'מה בוצע, מה פתוח עכשיו ומה מתוכנן, בתאריכים מחושבים.')),
    h('h3', { class: 'tl-h' }, 'בוצע', h('span', { class: 'n' }, String(tl.done.length))),
    tl.done.length > DONE_SHOWN && onToggle ? h('button', { type: 'button', class: 'btn-text tl-toggle', id: 'tl-toggle', 'aria-expanded': String(showAll), onclick: onToggle },
      showAll ? 'רק האחרונים' : `הצגת כל מה שבוצע (${tl.done.length})`) : null,
    done.length ? h('ol', { class: 'tl-list tl-done' }, ...done.map((x) => item('is-done', x,
      h('span', { class: 'tl-meta' }, ` · ${x.by && x.by !== 'system' ? who(x.by) : ''}${x.by && x.by !== 'system' ? ' · ' : ''}${formatStamp(x.at)}`),
      x.auto ? h('span', { class: 'tag' }, 'אוטומטי') : null,
      x.imported ? h('span', { class: 'tag' }, 'ייבוא') : null,
      x.late && !x.imported ? h('span', { class: 'tag tag-warn' }, 'אחרי היעד') : null)))
      : h('p', { class: 'muted tl-none' }, 'עוד לא הושלם תהליך.'),
    h('h3', { class: 'tl-h' }, 'עכשיו', h('span', { class: 'n' }, String(tl.current.length))),
    tl.current.length ? h('ol', { class: 'tl-list tl-now' }, ...tl.current.map((x) => item(`is-now s-${x.status}`, x,
      h('span', { class: 'tl-meta' }, ` · ${personName(x.who)}${x.until ? ` · עד ${formatWhen(x.until, now)}` : ''}`),
      x.status === 'overdue' ? h('span', { class: 'tag tag-warn' }, 'באיחור') : null,
      x.status === 'client' ? h('span', { class: 'tag' }, 'ממתין ללקוח') : null)))
      : h('p', { class: 'muted tl-none' }, 'אין כרגע תהליך פתוח.'),
    h('h3', { class: 'tl-h' }, 'מתוכנן', h('span', { class: 'n' }, String(tl.planned.length))),
    tl.planned.length ? h('ol', { class: 'tl-list tl-planned' }, ...tl.planned.map((x) => item(`is-planned${x.when ? '' : ' is-unset'}`, x,
      h('span', { class: 'tl-meta' }, ` · ${personName(x.who)} · ${whenText(x, now)}`))))
      : h('p', { class: 'muted tl-none' }, 'אין תהליכים מתוכננים.'));
}

export { dayText };
