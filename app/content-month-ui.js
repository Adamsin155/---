// "תכנים מול החוזה" (Irit and the owner, 22.11.2026; docs/ops.md, section 145): the clients short of their
// month's contents, the biggest gap first, with "החודש" and "החודש הבא". One list for two screens: the
// manager view (owner.html#content: the owner, Irit, Ofir, Lior) and Ilai's "שנת החבילה" (year.html#content).
// The numbers: app/content-month-logic.js over public.content_months; each row opens the client's card
// at its months (#content-months).
import { h, fill } from './protocol-ui.js';
import { loadContentMonths } from './card-metricool.js';
import { loadConnections } from './gantt-data.js';
import { byClient, shortList, monthOfClient, monthOf, noBrand, hasContents } from './content-month-logic.js';
import { addMonth, monthLabel } from './edit-count.js';

const live = (c) => !c.archived_at && (c.status === 'active' || c.status === 'ending');
const nameOf = (c) => String(c.business || c.name || '').trim();
const card = (c) => `client.html?id=${encodeURIComponent(c.id)}#content-months`;

// el: the section to draw into. clients: () => the page's clients. Returns { reload, render }.
export function mountContentList(el, { clients }) {
  let rows = null; // public.content_months (undefined: not there yet)
  let conn = null; // Map client id -> { blogId, none } (null: not known)
  let which = 'cur';
  let busy = false;
  async function reload() {
    busy = true;
    render();
    [rows, conn] = await Promise.all([loadContentMonths(null), loadConnections().catch(() => null)]);
    busy = false;
    render();
  }
  function render() {
    const now = new Date();
    const key = which === 'cur' ? monthOf(now) : addMonth(monthOf(now), 1);
    const label = monthLabel(key).split(' ')[0];
    // The page's client rows do not carry the Metricool brand: it comes from loadConnections.
    const list = (clients() || []).filter(live).map((c) => (conn ? { ...c, metricool_blog_id: conn.get(c.id)?.blogId || null, metricool_none: !!conn.get(c.id)?.none } : c));
    const chips = h('div', { class: 'chips-row cmo-range', role: 'group', 'aria-label': 'איזה חודש' },
      ...[['cur', 'החודש'], ['next', 'החודש הבא']].map(([k, t]) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(which === k), onclick: () => { which = k; render(); },
      }, t)));
    if (rows === undefined) {
      fill(el, h('h2', { class: 'wgroup-h', id: 'cmo-h' }, 'תכנים מול החוזה'), h('p', { class: 'muted' }, 'הספירה עוד לא הופעלה במערכת.'));
      return;
    }
    if (!rows) {
      fill(el, h('h2', { class: 'wgroup-h', id: 'cmo-h' }, 'תכנים מול החוזה'), h('p', { class: 'muted', role: 'status' }, busy ? 'טוען…' : ''));
      return;
    }
    const map = byClient(rows);
    const short = shortList(list, map, now, key);
    const counted = list.filter((c) => monthOfClient(c, map.get(c.id), key, now)).length;
    const unlinked = conn ? list.filter((c) => noBrand(c, now)) : [];
    const notYet = conn ? list.filter((c) => hasContents(c) && c.metricool_blog_id && !map.get(c.id)?.first).length : 0;
    const ended = key < monthOf(now);
    fill(el,
      h('div', { class: 'cmo-head' },
        h('h2', { class: 'wgroup-h', id: 'cmo-h' }, `חסרים תכנים ב${label} `, h('span', { class: 'n' }, String(short.length))),
        chips),
      h('p', { class: 'hint' }, `לפי Metricool: מה שעלה ומה שמתוזמן ל${label}, מול החלק של החודש בחוזה (סך התכנים בחוזה חלקי חודשי החוזה). ${counted} לקוחות נספרים.`),
      short.length ? h('ol', { class: 'cmo-list', 'aria-labelledby': 'cmo-h' }, ...short.map(({ client: c, month: m }) => h('li', { class: 'cmo-row' },
        h('a', { class: 'cmo-name', href: card(c) }, nameOf(c)),
        h('span', { class: 'cmo-n num', dir: 'ltr', 'aria-label': `${ended ? m.posted : m.planned} מתוך ${m.target}` }, `${ended ? m.posted : m.planned}/${m.target}`),
        h('span', { class: 'cmo-sub' }, ended || which === 'next' ? `חסרים ${m.missing}` : `עלו ${m.posted}${m.scheduled ? ` · מתוזמנים ${m.scheduled}` : ''} · חסרים ${m.missing}`))))
        : h('p', { class: 'cmo-ok' }, counted ? `כל הלקוחות מתוזמנים במלואם ל${label}.` : 'עוד אין לקוחות שנספרים.'),
      unlinked.length ? h('p', { class: 'cmo-foot' }, `לא מחוברים ל־Metricool ולכן לא נספרים: ${unlinked.slice(0, 6).map(nameOf).join(', ')}${unlinked.length > 6 ? ` ועוד ${unlinked.length - 6}` : ''}.`) : null,
      notYet ? h('p', { class: 'cmo-foot' }, `${notYet === 1 ? 'לקוח אחד מחובר' : `${notYet} לקוחות מחוברים`} ועוד בלי אף תוכן ב־Metricool: הספירה שלהם מתחילה בחודש של התוכן הראשון.`) : null);
  }
  return { reload, render };
}
