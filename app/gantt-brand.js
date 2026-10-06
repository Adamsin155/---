// Metricool on the content Gantt (gantt.html; docs/ops.md, section 27):
//  - the small line about the connection ("סונכרן מ-Metricool לפני 4 דקות", or the
//    error in plain Hebrew), on a client's Gantt and on the index;
//  - "חיבור למותג ב-Metricool" (Ilai and the owner): the account's brands, fetched
//    through the edge function `metricool` (never from the browser to Metricool), with
//    a suggestion by name; a brand another client uses cannot be chosen.
// The words and the suggestion: app/metricool-logic.js. All text through text nodes.
import { h } from './quote-doc.js';
import { syncLine, accountLine, suggestBrand, errorText } from './metricool-logic.js';
import * as data from './gantt-data.js';

// The line itself: <p class="gt-mc is-ok|is-warn|is-off">, or hidden when there is nothing to say.
export function paintLine(el, line, action = null) {
  if (!el) return;
  if (!line) { el.hidden = true; el.replaceChildren(); return; }
  el.hidden = false;
  el.className = `gt-mc is-${line.tone}`;
  el.replaceChildren(h('span', { class: 'gt-mc-dot', 'aria-hidden': 'true' }), h('span', { class: 'gt-mc-t' }, line.text), ...(action ? [action] : []));
}
export const clientLine = (state, now = new Date()) => syncLine(state, now);
export const indexLine = (settings, now = new Date()) => accountLine(settings, now);

// The dialog. ctx: { client, current: { blogId, brand }, toast, onSaved({ blogId, brand }) }.
export async function openBrandDialog(ctx) {
  const dlg = document.getElementById('brand-dlg');
  const body = document.getElementById('bd-body');
  const foot = document.getElementById('bd-foot');
  const close = () => dlg.close();
  document.getElementById('bd-h').textContent = `חיבור למותג ב־Metricool · ${ctx.client.business || ctx.client.name}`;
  body.replaceChildren(h('p', { class: 'state', role: 'status' }, 'טוען את המותגים מ־Metricool…'));
  foot.replaceChildren(h('button', { type: 'button', class: 'btn btn-ghost', onclick: close }, 'סגירה'));
  if (!dlg.open) dlg.showModal();
  let brands;
  let all;
  try {
    [brands, all] = await Promise.all([data.fetchBrands(), data.loadBrands()]);
  } catch (err) {
    body.replaceChildren(...[
      h('p', { class: 'err', role: 'alert', id: 'bd-err' }, `לא הצלחנו לקבל את רשימת המותגים. ${errorText(err?.code)}`),
      ctx.current?.blogId ? h('p', { class: 'hint' }, `הלקוח מחובר עכשיו ל${ctx.current.brand ? `״${ctx.current.brand}״` : 'מותג'}.`) : null].filter(Boolean));
    foot.replaceChildren(...[
      ctx.current?.blogId ? h('button', { type: 'button', class: 'btn btn-ghost danger', id: 'bd-off', onclick: () => save(null) }, 'ניתוק מהמותג') : null,
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: close }, 'סגירה')].filter(Boolean));
    return;
  }
  const taken = new Map(Object.entries(all || {}).filter(([id, b]) => id !== ctx.client.id && b.blogId).map(([, b]) => [String(b.blogId), true]));
  const hint = suggestBrand(ctx.client, brands, [...taken.keys()]);
  const chosen = ctx.current?.blogId || hint?.brand.id || null;
  const filter = h('input', { class: 'input', id: 'bd-q', type: 'search', placeholder: 'חיפוש מותג', 'aria-label': 'חיפוש מותג' });
  const list = h('div', { class: 'gt-brands', role: 'radiogroup', 'aria-label': 'המותגים בחשבון', id: 'bd-list' });
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const shown = brands.filter((b) => !q || b.label.toLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown.map((b) => {
      const busy = taken.has(b.id);
      return h('label', { class: `gt-brand${busy ? ' is-taken' : ''}` },
        h('input', { type: 'radio', name: 'bd-brand', value: b.id, checked: b.id === (list.dataset.pick || chosen) ? true : null, disabled: busy ? true : null, onchange: () => { list.dataset.pick = b.id; } }),
        h('span', { class: 'gt-brand-t' }, h('bdi', {}, b.label),
          h('small', {}, [b.networks.join(' · '), busy ? 'מחובר ללקוח אחר' : null, hint?.brand.id === b.id ? 'הצעה לפי השם' : null, ctx.current?.blogId === b.id ? 'מחובר עכשיו' : null].filter(Boolean).join(' · '))));
    }) : [h('p', { class: 'gt-none' }, brands.length ? 'אין מותג בשם הזה.' : 'אין מותגים בחשבון ה־Metricool.')]));
  };
  filter.addEventListener('input', draw);
  body.replaceChildren(...[
    h('p', { class: 'hint' }, 'בוחרים את המותג של הלקוח בחשבון ה־Metricool של אסטרטג. מה שמתוזמן שם יסומן בגאנט ״תוזמן״, ומה שעלה ״עלה״ עם הקישור.'),
    brands.length > 8 ? filter : null, list,
    h('p', { class: 'err', id: 'bd-err', role: 'alert', hidden: true })].filter(Boolean));
  draw();
  async function save(blogId) {
    const err = document.getElementById('bd-err');
    const brand = blogId ? brands?.find((b) => b.id === blogId) : null;
    try {
      const saved = await data.setBrand(ctx.client.id, blogId, brand?.label || null);
      close();
      ctx.toast(blogId ? `הלקוח חובר למותג ״${saved.brand || brand?.label || blogId}״.` : 'הלקוח נותק מהמותג. מה ש־Metricool סימן חזר ל״מתוכנן״.');
      ctx.onSaved(saved);
    } catch (e) {
      const msg = /brand_taken/.test(e?.message || '') ? 'המותג הזה כבר מחובר ללקוח אחר.' : /not allowed|42501/.test(`${e?.message} ${e?.code}`) ? 'רק עילאי והבעלים מחברים לקוח למותג.' : 'החיבור לא נשמר. נסו שוב.';
      if (err) { err.textContent = msg; err.hidden = false; } else ctx.toast(msg);
    }
  }
  foot.replaceChildren(...[
    h('button', { type: 'button', class: 'btn btn-primary', id: 'bd-save', onclick: () => {
      const pick = list.querySelector('input[name="bd-brand"]:checked')?.value;
      if (!pick) { const e = document.getElementById('bd-err'); e.textContent = 'בחרו מותג.'; e.hidden = false; return; }
      save(pick);
    } }, 'חיבור'),
    ctx.current?.blogId ? h('button', { type: 'button', class: 'btn btn-ghost danger', id: 'bd-off', onclick: () => save(null) }, 'ניתוק מהמותג') : null,
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: close }, 'ביטול')].filter(Boolean));
}
