// "המשימות שלי" / "מבט מנהל": the switch at the top of every page for the managers
// (the owner, Irit and Ofir; app/manager-rules.js). Mounted by the shared session
// code (mountSession in app/protocol-ui.js) and by the quote pages after sign-in, so
// every page has it in the same place: a strip right under the top bar, which on a
// phone stays visible when the top bar folds its links away. Choosing a profile
// remembers it in this browser (where the next sign-in lands) and opens its page.
import { supabase } from './supa.js';
import { h } from './quote-doc.js';
import { PEOPLE, scopeOf } from './protocol.js';
import { MODES, isManager, modeOf, setMode, modeOfPage } from './manager-rules.js';

const CSS = 'app/styles/manager.css';
function ensureStyles() {
  if (document.querySelector(`link[data-manager-css]`)) return;
  const base = document.querySelector('link[href$="app/styles/app.css"]')?.getAttribute('href')?.replace(/app\/styles\/app\.css$/, '') || '';
  document.head.append(h('link', { rel: 'stylesheet', href: `${base}${CSS}`, 'data-manager-css': '' }));
}

// Who is signed in, as viewerOf() in app/protocol-ui.js has it.
async function viewerFor(email) {
  const { data, error } = await supabase.from('staff').select('person').eq('email', String(email || '').toLowerCase()).maybeSingle();
  if (error) return null;
  const person = data?.person || null;
  return { me: person && person !== 'editor' && PEOPLE[person] ? person : null, scope: scopeOf(person), error: null };
}

export function modeSwitch(viewer) {
  const saved = modeOf(viewer);
  const on = modeOfPage(location.pathname, location.hash, saved);
  const here = (m) => (m === 'manager' ? /owner\.html$/.test(location.pathname) : /clients\.html$/.test(location.pathname) && (!location.hash || location.hash === '#mine'));
  return h('nav', { class: 'mode-bar', id: 'mode-bar', 'aria-label': 'החלפת תצוגה' },
    h('span', { class: 'mode-k', id: 'mode-k' }, 'תצוגה:'),
    h('div', { class: 'mode-seg', role: 'group', 'aria-labelledby': 'mode-k' },
      ...Object.values(MODES).map((m) => h('a', {
        class: `mode-opt${on === m.key ? ' is-on' : ''}`, id: `mode-${m.key}`, href: m.href,
        'aria-current': on === m.key ? (here(m.key) ? 'page' : 'true') : null,
        onclick: () => setMode(m.key),
      }, m.label))));
}

// Mounts the switch once for a signed-in manager; nothing for anyone else.
export async function mountModeSwitch(email) {
  if (document.getElementById('mode-bar')) return;
  let viewer = null;
  try { viewer = await viewerFor(email); } catch { /* offline: no switch */ }
  if (!isManager(viewer) || document.getElementById('mode-bar')) return;
  ensureStyles();
  const bar = modeSwitch(viewer);
  const top = document.querySelector('header.topbar');
  if (top) top.after(bar); else document.body.prepend(bar);
  // Moving between "מה עליי" and the other lists of clients.html keeps the strip right.
  window.addEventListener('hashchange', () => document.getElementById('mode-bar')?.replaceWith(modeSwitch(viewer)));
}
