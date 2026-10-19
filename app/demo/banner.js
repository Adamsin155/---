// The strip of the demo link (app/demo/flag.js) on every screen: it says plainly that
// this is a demo with made-up clients and that nothing is saved, lets the guest see
// the app as another member of the team, and leaves the demo.
import { h } from '../quote-doc.js';
import { PEOPLE } from '../protocol.js';
import { DEMO_KEY, DEMO_AUTH_KEY, DEMO_ROLES, demoEmail, leaveDemo, plantDemoSession, roleOfEmail } from './flag.js';

const nameOf = (role) => (role === 'owner' ? 'הבעלים' : PEOPLE[role]?.name || role);
const jobOf = (role) => (role === 'owner' ? 'כל המערכת' : PEOPLE[role]?.role || '');

async function seeAs(role) {
  try {
    sessionStorage.setItem(DEMO_KEY, role);
    sessionStorage.removeItem(DEMO_AUTH_KEY);
    for (const k of Object.keys(sessionStorage)) if (k === 'astrateg.shell' || k === 'astrateg.cache' || k.startsWith('astrateg.cache.')) sessionStorage.removeItem(k);
  } catch { /* no storage */ }
  plantDemoSession(role);
  // Their own first screen, as after a sign-in (app/shell-rules.js).
  let to = 'clients.html';
  try {
    const [shell, rules] = await Promise.all([import('../shell.js'), import('../shell-rules.js')]);
    const viewer = await shell.viewerFor(demoEmail(role));
    if (viewer && !viewer.error) to = rules.homeHref(viewer);
  } catch { /* the clients list then */ }
  // Always a new load: most homes are this same page (clients.html#mine), and a change of
  // the hash alone would keep the page of the role before.
  const next = new URL(to, new URL('../../', import.meta.url));
  if (next.pathname === location.pathname) { history.replaceState(null, '', next.href); location.reload(); } else location.assign(next.href);
}

export function mountDemoBanner(role) {
  if (document.getElementById('demo-strip')) return;
  if (!document.querySelector('link[href$="app/styles/demo.css"]')) {
    document.head.append(h('link', { rel: 'stylesheet', href: new URL('../styles/demo.css', import.meta.url).href }));
  }
  const pick = h('select', { id: 'demo-role', class: 'demo-role', 'aria-label': 'לראות את המערכת בתור' },
    ...DEMO_ROLES.map((r) => h('option', { value: r, ...(r === role ? { selected: '' } : {}) }, `${nameOf(r)} · ${jobOf(r)}`)));
  pick.addEventListener('change', () => { pick.disabled = true; seeAs(pick.value); });
  const leave = h('button', { type: 'button', class: 'demo-leave' }, 'יציאה');
  leave.addEventListener('click', () => { leaveDemo(); location.assign(new URL('../../clients.html', import.meta.url).href); });
  const strip = h('div', { id: 'demo-strip', class: 'demo-strip', role: 'region', 'aria-label': 'מצב הדגמה' },
    h('span', { class: 'demo-tag' }, 'הדגמה'),
    h('span', { class: 'demo-note' }, 'לקוחות ונתונים מומצאים · שום דבר לא נשמר'),
    h('label', { class: 'demo-as', for: 'demo-role' }, 'צפייה בתור'),
    pick,
    leave);
  document.body.prepend(strip);
  document.body.classList.add('is-demo');
}

export { roleOfEmail };
