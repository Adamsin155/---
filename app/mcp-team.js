// "חיבור ל־Claude" on the team screen (team.html), for the owners only (docs/ops.md, section 84): each
// person who may connect their Claude account, on or off, and when they last used it. Switching off
// works at once: the mcp function asks public.mcp_allowed() on every request. Everyone else, and
// before the migration (20261121100000), nothing here shows.
import { supabase } from './supa.js';
import { h, fill, toast, errorText, formatWhen } from './protocol-ui.js';
import { usageWords } from './mcp-logic.js';

// The list, or null when the card is not for this person or not built yet.
export async function loadMcpCard() {
  const { data, error } = await supabase.rpc('mcp_people');
  return error || !Array.isArray(data) || !data.length ? null : data;
}

async function flip(row, on, reload, input) {
  input.disabled = true;
  const { error } = await supabase.rpc('mcp_set_access', { p_email: row.email, p_enabled: on });
  if (error) {
    input.checked = !on;
    input.disabled = false;
    toast(`לא נשמר. ${errorText(error)}`);
    return;
  }
  toast(on ? 'החיבור ל־Claude הופעל.' : 'החיבור ל־Claude כובה, מרגע זה.');
  await reload();
  document.getElementById(input.id)?.focus({ preventScroll: true });
}

// The card, above the list (created before `before` on first use).
export function paintMcpCard(list, before, reload, nameOf) {
  let el = document.getElementById('mcp-panel');
  if (!list) { if (el) el.hidden = true; return; }
  if (!el) {
    el = h('section', { class: 'block tm-help tm-wa tm-mcp', id: 'mcp-panel', 'aria-labelledby': 'mcp-panel-h' });
    before.before(el);
  }
  el.hidden = false;
  fill(el,
    h('h2', { id: 'mcp-panel-h' }, 'חיבור ל־Claude'),
    h('p', { class: 'muted' }, 'מי יכול לחבר את חשבון ה־Claude שלו למערכת: לקרוא את מה שהוא רואה במסכים שלו ולהכין טיוטת חוזה. כיבוי עובד מיד.'),
    h('ul', { class: 'tm-mcp-list' }, ...list.map((row, i) => h('li', { class: 'tm-mcp-row' },
      h('div', { class: 'tm-mcp-who' },
        h('strong', {}, nameOf(row.email)),
        h('span', { class: 'muted', dir: 'ltr' }, row.email),
        h('span', { class: 'muted', id: `mcp-used-${i}` }, usageWords(row.last_used, (at) => formatWhen(new Date(at))))),
      h('label', { class: 'switch' },
        h('input', {
          type: 'checkbox', id: `mcp-on-${i}`, role: 'switch', checked: row.enabled, 'aria-label': `חיבור ל־Claude: ${nameOf(row.email)}, ${row.email}`,
          onchange: (e) => flip(row, e.currentTarget.checked, reload, e.currentTarget),
        }),
        h('span', { 'aria-hidden': 'true' }))))));
}
