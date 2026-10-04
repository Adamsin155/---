// The monthly cycle on the shared screens, kept here so those screens change by a
// line or two: its part of "המשימות שלי" (clients.html, for the person shown), the
// month's block in the client card (client.html#month), and the item rows that
// year.html uses too. Every item is labelled as a draft (decision 31). The logic:
// app/year-logic.js; the data: app/year-data.js.
import { PEOPLE } from './protocol.js';
import { h, toast, errorText, formatWhen, formatStamp, who, personChip } from './protocol-ui.js';
import {
  DRAFT_LABEL, openMonthItems, monthOf, cycleFrom, monthState, marksByKey, groupMarks, markKey,
} from './year-logic.js';
import { loadMonthMarks, setMonthMark, clearMonthMark } from './year-data.js';

const enc = encodeURIComponent;
const cardUrl = (id) => `client.html?id=${enc(id)}#month`;
// Marking in someone else's name: the owner, Irit, Lior and Ofir (decision 23); the
// others mark their own. The database lets the office write; this is the screen's rule.
const ON_BEHALF = new Set(['irit', 'lior', 'ofir']);
export const mayMark = (item, me, office) => !!office && (!me || me === item.owner || ON_BEHALF.has(me));
// Who works the cycle: the office screens' people and Ilai (public.is_office()).
export const worksCycle = ({ me = null, scope = 'own', error = null } = {}) => !error && (scope === 'office' || me === 'ilai');

// ── One item ──────────────────────────────
const STATUS_TEXT = { overdue: 'באיחור', today: 'היום' };
// ctx: { client, me, office, pending: Set, onMark(item, state) }
export function itemRow(item, ctx) {
  const id = `mi-${String(ctx.client.id).replace(/\W/g, '')}-${item.month}-${item.key.replace(/\W/g, '_')}`;
  const can = mayMark(item, ctx.me, ctx.office) && !item.auto;
  const busy = ctx.pending?.has(`${ctx.client.id}:${markKey(item.month, item.key)}`);
  const mark = item.mark;
  const now = new Date();
  const meta = [h('span', { class: 'tag tag-draft' }, 'טיוטה'), personChip(item.owner)];
  if (item.status === 'done' && mark) meta.push(h('span', { class: 'by' }, `בוצע · ${who(mark.by_email)} · ${formatStamp(mark.at)}`));
  else if (item.status === 'na' && mark) meta.push(h('span', { class: 'by' }, `לא רלוונטי החודש · ${who(mark.by_email)}`));
  else if (item.status === 'auto') meta.push(h('span', { class: 'by' }, 'בוצע: הסבב נפתח בכרטיס'));
  else meta.push(h('span', { class: item.status === 'overdue' ? 'late' : '' }, `${STATUS_TEXT[item.status] ? `${STATUS_TEXT[item.status]} · ` : ''}עד ${formatWhen(item.dueAt, now)}`));
  if (mark?.note && item.status !== 'auto') meta.push(h('span', { class: 'inote' }, mark.note));
  const checked = item.status === 'done' || item.status === 'auto';
  return h('li', { class: `item mitem s-${item.status}${checked ? ' is-done' : ''}${item.status === 'na' ? ' is-na' : ''}${busy ? ' is-busy' : ''}` },
    h('label', { class: 'irow', for: id },
      h('input', {
        type: 'checkbox', id, class: 'cbx', checked, disabled: !can || busy || item.status === 'na',
        'aria-describedby': `${id}-m`,
        onchange: (e) => ctx.onMark(item, e.currentTarget.checked ? 'done' : null, id),
      }),
      h('span', { class: 'ibody' },
        h('span', { class: 'ilabel' }, item.label),
        h('span', { class: 'imeta', id: `${id}-m` }, ...meta))),
    can && item.status !== 'done' ? h('button', {
      type: 'button', class: 'btn-text na-btn is-opt', id: `${id}-na`, disabled: busy,
      'aria-label': `${item.status === 'na' ? 'החזרה לפתוח' : 'לא רלוונטי החודש'}: ${item.label}`,
      onclick: () => ctx.onMark(item, item.status === 'na' ? null : 'na', `${id}-na`),
    }, item.status === 'na' ? 'החזרה לפתוח' : 'לא רלוונטי החודש') : null);
}

// Saves a mark (or clears it) and updates `marks` (the client's, by `month:item`).
export async function saveMark(client, item, state, marks, me) {
  const k = markKey(item.month, item.key);
  if (state) {
    const note = me && me !== item.owner && state === 'done' ? `בשם ${PEOPLE[item.owner]?.name || item.owner}` : null;
    marks[k] = await setMonthMark(client.id, item.month, item.key, state, note);
  } else {
    await clearMonthMark(client.id, item.month, item.key);
    delete marks[k];
  }
}

const draftHint = () => h('p', { class: 'hint mc-draft' }, `${DRAFT_LABEL} (החלטה 31).`);

// ── "המשימות שלי" ─────────────────────────────
// The marks of all clients, loaded once and again after a minute.
const cache = { rows: undefined, at: 0, loading: null };
let box = null;
let last = null;
const pending = new Set();
function ensureMarks() {
  if (cache.loading || (cache.rows !== undefined && Date.now() - cache.at < 60e3)) return;
  cache.loading = loadMonthMarks().then((rows) => { cache.rows = rows; }).catch(() => { cache.rows = cache.rows ?? null; })
    .finally(() => { cache.at = Date.now(); cache.loading = null; if (box && last) showMonths(box, last); });
}
// ctx: { person (whose list; null: nobody's), me, office, clients, stateOf, checks }
export function showMonths(el, ctx) {
  box = el;
  last = ctx;
  if (!el) return;
  if (!ctx.person || !ctx.office) { el.hidden = true; el.replaceChildren(); return; }
  ensureMarks();
  // Until the marks are read, nothing: items already marked would show as open (and
  // late), then vanish, moving the list below them. ensureMarks draws it once they are in.
  if (cache.rows === undefined) { el.hidden = true; el.replaceChildren(); return; }
  const grouped = groupMarks(cache.rows || []);
  const now = new Date();
  const byClient = [];
  for (const c of ctx.clients) {
    const items = openMonthItems(ctx.person, c, ctx.stateOf(c), ctx.checks?.[c.id] || {}, grouped[c.id] || {}, now);
    if (items.length) byClient.push({ c, items, m: monthOf(c, now) });
  }
  const count = byClient.reduce((a, x) => a + x.items.length, 0);
  el.hidden = !count;
  if (!count) { el.replaceChildren(); return; }
  byClient.sort((a, b) => a.items[0].dueAt - b.items[0].dueAt);
  const onMark = (c) => async (item, state, focusId) => {
    const key = `${c.id}:${markKey(item.month, item.key)}`;
    if (pending.has(key)) return;
    pending.add(key);
    const marks = { ...(grouped[c.id] || {}) };
    const k = markKey(item.month, item.key);
    try {
      await saveMark(c, item, state, marks, ctx.me);
      cache.rows = [...(cache.rows || []).filter((r) => !(r.client_id === c.id && markKey(r.month, r.item) === k)), ...(marks[k] ? [marks[k]] : [])];
    } catch (err) {
      toast(`הסימון לא נשמר. ${errorText(err)}`);
    }
    pending.delete(key);
    showMonths(el, ctx);
    if (state) {
      toast(state === 'done' ? `סומן: ${item.label}` : 'סומן לא רלוונטי החודש.', { label: 'ביטול', run: () => onMark(c)(item, null, focusId) });
      (el.querySelector('.cbx:not(:disabled)') || document.getElementById('tab-mine'))?.focus();
    } else document.getElementById(focusId)?.focus();
  };
  el.replaceChildren(
    h('h2', { class: 'wgroup-h', id: 'mc-h' }, 'המחזור החודשי', h('span', { class: 'tag tag-draft' }, 'טיוטה'), h('span', { class: 'n' }, String(count))),
    draftHint(),
    h('ul', { class: 'wprocs mc-list', 'aria-labelledby': 'mc-h' }, ...byClient.map(({ c, items, m }) => h('li', { class: 'wproc mc-client' },
      h('p', { class: 'mc-head' }, h('a', { class: 'wclient', href: cardUrl(c.id) }, c.name), m ? h('span', { class: 'muted' }, ` · חודש ${m.n} מתוך ${m.of}`) : null),
      h('ul', { class: 'items' }, ...items.map((i) => itemRow(i, { client: c, me: ctx.me, office: ctx.office, pending, onMark: onMark(c) })))))),
  );
}

// ── The client card ───────────────────────
const cardCache = { id: null, rows: undefined, landed: false };
// ctx: { client, state, checks, me, office, scope, rerender }
export function mountClientMonth(slot, ctx) {
  if (!slot) return;
  const c = ctx.client;
  if (!c || !ctx.office || c.status !== 'active') { slot.replaceChildren(); return; }
  if (cardCache.id !== c.id) {
    cardCache.id = c.id;
    cardCache.rows = undefined;
    loadMonthMarks(c.id).then((rows) => { if (cardCache.id === c.id) { cardCache.rows = rows; ctx.rerender?.(); } })
      .catch(() => { if (cardCache.id === c.id) { cardCache.rows = null; ctx.rerender?.(); } });
  }
  const now = new Date();
  const m = monthOf(c, now);
  const from = cycleFrom(c, ctx.state);
  if (!m) { slot.replaceChildren(); return; }
  const marks = marksByKey(cardCache.rows || []);
  const own = ctx.scope === 'own';
  let body;
  // Until the marks are read, no count and no items (they would all read as open and late).
  if (cardCache.rows === undefined && from !== null && !m.over && m.n >= from) body = [h('p', { class: 'muted', role: 'status' }, 'טוען את הסימונים…')];
  else if (from === null) body = [h('p', { class: 'muted' }, 'המחזור החודשי מתחיל בחודש שאחרי התזמון הראשון (תהליך 28).')];
  else if (m.over) body = [h('p', { class: 'muted' }, 'תקופת החבילה הסתיימה.')];
  else if (m.n < from) body = [h('p', { class: 'muted' }, `המחזור החודשי מתחיל בחודש ${from}.`)];
  else {
    const s = monthState(c, m.n, marks, now, from);
    const items = s.items.filter((i) => !own || i.owner === ctx.me);
    const onMark = async (item, state, focusId) => {
      const key = `${c.id}:${markKey(item.month, item.key)}`;
      if (pending.has(key)) return;
      pending.add(key);
      try {
        await saveMark(c, item, state, marks, ctx.me);
        cardCache.rows = Object.values(marks);
      } catch (err) {
        toast(`הסימון לא נשמר. ${errorText(err)}`);
      }
      pending.delete(key);
      ctx.rerender?.();
      document.getElementById(focusId)?.focus();
    };
    body = [
      h('p', { class: 'mc-count' }, `${s.done} מתוך ${s.total} בוצעו${s.late ? ` · ${s.late} באיחור` : ''}`),
      items.length ? h('ul', { class: 'items' }, ...items.map((i) => itemRow(i, { client: c, me: ctx.me, office: ctx.office, pending, onMark })))
        : h('p', { class: 'muted' }, 'אין לך פריטים החודש.'),
    ];
  }
  if (cardCache.rows === null) body.push(h('p', { class: 'hint' }, 'הסימונים של המחזור החודשי יישמרו אחרי שהמיגרציה של שלב 5 תוחל.'));
  const section = h('section', { class: 'block cc-side mc-card', id: 'month', 'aria-labelledby': 'mc-card-h', tabindex: '-1' },
    h('div', { class: 'side-head' },
      h('h2', { id: 'mc-card-h' }, `המחזור החודשי · חודש ${m.n} מתוך ${m.of}`, h('span', { class: 'tag tag-draft' }, 'טיוטה')),
      draftHint()),
    ...body,
    h('p', { class: 'mc-more' }, h('a', { href: 'year.html' }, 'כל השנה של כל הלקוחות')));
  slot.replaceChildren(section);
  // A link to the month (the reminders, year.html) lands on it once it is drawn.
  if (location.hash === '#month' && cardCache.rows !== undefined && !cardCache.landed) {
    cardCache.landed = true;
    section.scrollIntoView();
    section.focus({ preventScroll: true });
  }
}
