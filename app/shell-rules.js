// The app menu's plain rules: which screens the signed-in person is offered, in what
// order, which of them sit in the phone's bottom bar, and which one is the page they
// are on. One list for every page (the side menu on a wide screen, the bottom bar and
// "עוד" on a phone; app/shell.js draws it). It only gathers the rules the pages
// already had: the office's screens (officeScreens, which app/office-ui.js
// officeLinks draws), the managers' two profiles (app/manager-rules.js), the team
// screen (app/team-rules.js), and the predicates of health.js, messages-logic.js and
// insights.js, repeated here in one line each so that the quote pages do not load those
// modules (tests/shell.test.mjs holds them equal for every role).
// Screens only: what anyone may read or open is decided by the database and by each
// page's own gate. No DOM here, so node can test it.
import { PEOPLE, isSales } from './protocol.js';
import { isOwnerView, canManageTeam } from './team-rules.js';
import { isManager, canSeeTable, canSeeShootTable, MODES } from './manager-rules.js';

const known = (v) => !!v && !v.error;
const officeOf = (v) => known(v) && v.scope === 'office';
// As canSendMessages (messages-logic.js), canSeeInsights (insights.js), canSeeAllClients (health.js).
const sendsMessages = (v) => known(v) && ((!v.me && v.scope === 'office') || ['irit', 'lior'].includes(v.me));
const seesInsights = (v) => known(v) && ((!v.me && v.scope === 'office') || v.me === 'lior');
const seesAllClients = (v) => canSeeTable(v);
// The index of the content Gantt: the office and Ilai (as worksCycle in month-ui.js).
export const seesGantt = (v) => known(v) && (v.scope === 'office' || v.me === 'ilai');
// Who changes a Gantt: Ilai and the owner (public.can_edit_gantt() decides).
export const editsGantt = (v) => known(v) && (v.me === 'ilai' || (!v.me && v.scope === 'office'));

// The office screens, one order everywhere: Ofir's two, Lior's decisions (and the
// assignment, which he takes when Ofir cannot), all three for the owner; the monthly
// insights for the owner and Lior; the package year for the office and Ilai.
export function officeScreens(viewer) {
  const me = viewer?.me || null;
  const ok = known(viewer);
  const owner = ok && !me && viewer.scope === 'office';
  return [
    ['qa', 'qa.html', 'בקרה ושיוך', me === 'ofir' || me === 'lior' || owner],
    ['pass', 'pass.html', 'מעבר על הלקוחות', me === 'ofir' || owner],
    ['decisions', 'decisions.html', 'החלטות', me === 'lior' || me === 'ofir' || owner],
    ['insights', 'insights.html', 'תובנות', seesInsights(viewer)],
    ['year', 'year.html', 'שנת החבילה', ok && (viewer.scope === 'office' || me === 'ilai')],
  ].filter(([, , , show]) => show).map(([id, href, label]) => ({ id, href, label }));
}

// Every screen this person is offered, in the menu's order. `mode: true` marks the
// managers' two profiles (the "המשימות שלי" / "מבט מנהל" switch).
export function menuOf(viewer) {
  const me = viewer?.me || null;
  if (known(viewer) && isSales(me)) return [{ id: 'deal', href: 'deal.html', label: 'עסקה חדשה' }];
  const list = [{ id: 'mine', href: MODES.mine.href, label: MODES.mine.label }];
  if (!known(viewer)) return list; // not identified: nothing is assumed
  const office = officeOf(viewer);
  if (isManager(viewer)) {
    list[0].mode = 'mine';
    list.push({ id: 'manager', href: MODES.manager.href, label: MODES.manager.label, mode: 'manager' });
  } else if (seesAllClients(viewer)) {
    list.push({ id: 'overview', href: 'owner.html#all', label: 'כל הלקוחות במבט' }); // Lior: screen 2 and the table
  }
  list.push({ id: 'clients', href: 'clients.html#clients', label: office ? 'לקוחות' : 'הלקוחות שלי' });
  // The content Gantt of every client (gantt.html without a client), 6.10.2026: Ilai, whose
  // it is, always has a way in, also with no open work; the owner, Irit, Lior and Ofir read.
  if (seesGantt(viewer)) list.push({ id: 'gantt', href: 'gantt.html', label: 'גאנט תוכן' });
  list.push(...officeScreens(viewer));
  if (office) list.push({ id: 'prep', href: 'prep.html', label: 'לפני יום צילום' });
  if (sendsMessages(viewer)) list.push({ id: 'messages', href: 'messages.html', label: 'הודעות ללקוחות' });
  if (PEOPLE[me]?.editor) list.push({ id: 'editor', href: 'editor.html', label: 'הלקוחות שלי בעריכה' });
  if (me === 'eli' || office) list.push({ id: 'shoot', href: 'shoot.html', label: 'ימי צילום' });
  // Every client by its last shoot day, the oldest first (6.10.2026): Lior, Ofir and the owner.
  if (canSeeShootTable(viewer)) list.push({ id: 'shoot-table', href: 'owner.html#shoots', label: 'טבלת ימי צילום' });
  list.push({ id: 'quote', href: 'index.html', label: 'הצעה חדשה' }, { id: 'quotes', href: 'quotes.html', label: 'הצעות שנשלחו' });
  if (canManageTeam(viewer)) list.push({ id: 'team', href: 'team.html', label: 'צוות' });
  return unique(list);
}
// No screen twice: one entry per id, per address and per name (the first one stays).
function unique(list) {
  const seen = new Set();
  return list.filter((it) => {
    const keys = [`id:${it.id}`, `href:${it.href}`, `label:${it.label}`];
    if (keys.some((k) => seen.has(k))) return false;
    for (const k of keys) seen.add(k);
    return true;
  });
}

// The role's own first screen (app/office-ui.js firstScreenOf), as a menu id; for Ilai,
// who stays on "המשימות שלי", his own screen is the Gantt.
const HOME = { ofir: 'qa', lior: 'decisions', eli: 'shoot', ilai: 'gantt' };
const homeOf = (viewer) => {
  const me = viewer?.me || null;
  if (PEOPLE[me]?.editor) return 'editor';
  return HOME[me] || null;
};

// The phone's bottom bar: the three most important screens of this role and "עוד"
// for the rest; four screens or fewer all fit, and one screen needs no bar at all.
// Returns { bar: [items], more: [items] }, each in the menu's order.
export function barOf(items, viewer) {
  if (items.length < 2) return { bar: [], more: [] };
  if (items.length <= 4) return { bar: items, more: [] };
  const first = ['mine', 'manager', homeOf(viewer), 'clients', 'overview'].filter(Boolean);
  const rank = (it) => { const i = first.indexOf(it.id); return i < 0 ? first.length : i; };
  const picked = new Set([...items].sort((a, b) => rank(a) - rank(b)).slice(0, 3).map((it) => it.id));
  return { bar: items.filter((it) => picked.has(it.id)), more: items.filter((it) => !picked.has(it.id)) };
}

const split = (href) => { const [page, hash = ''] = String(href).split('#'); return { page: page || 'index.html', hash: hash ? `#${hash}` : '' }; };
export const pageOf = (pathname) => String(pathname || '').split('/').pop() || 'index.html';
// Pages that belong to a client: the menu marks the clients list as where they are.
const UNDER_CLIENTS = new Set(['client.html', 'gantt.html', 'scripts.html', 'intake.html']);

// Which menu item is this page: { id, exact }. `exact` is false for a page under an
// item (a client's card under the clients list), which is marked but is not "the page".
export function currentOf(items, pathname, hash = '', search = '') {
  const page = pageOf(pathname);
  const same = items.filter((it) => split(it.href).page === page);
  // gantt.html is the index; with a client (?id=…) it is a page under it.
  if (same.length === 1 && same[0].id === 'gantt') return { id: 'gantt', exact: !/[?&]id=/.test(String(search)) };
  if (same.length === 1) return { id: same[0].id, exact: true };
  if (same.length > 1 && page === 'owner.html') {
    // The shoot-day table (#shoots) is its own entry; every other tab is the manager's view.
    const table = (it) => split(it.href).hash === '#shoots';
    const hit = same.find((it) => table(it) === (hash === '#shoots')) || same[0];
    return { id: hit.id, exact: true };
  }
  if (same.length > 1) {
    // clients.html holds "המשימות שלי" (no hash, or #mine) and the lists (#clients, #control …).
    const mine = !hash || hash === '#mine';
    const hit = same.find((it) => (split(it.href).hash === '#mine') === mine) || same[0];
    return { id: hit.id, exact: true };
  }
  if (UNDER_CLIENTS.has(page) && items.some((it) => it.id === 'clients')) return { id: 'clients', exact: false };
  return { id: null, exact: false };
}

// Whether a link (its href as written, resolved by the caller to page + hash) leads to
// a screen the menu already offers: such a link in a page head is not shown twice.
export function inMenu(items, pathname, hash = '') {
  const page = pageOf(pathname);
  return items.some((it) => {
    const s = split(it.href);
    if (s.page !== page) return false;
    if (page !== 'clients.html') return true;         // owner.html, owner.html#all: the same screen
    return (s.hash === '#mine') === (!hash || hash === '#mine');
  });
}

// The person's name and avatar. Pastel fills per person (ink text on each: 12:1 and up);
// the initials are the first two letters of the name.
export const AVATAR_FILL = {
  irit: '#FAD4DF', lior: '#D6E6FB', ofir: '#E3DBFC', ilai: '#D5F0E1', nadia: '#FDE9C4', yariv: '#D9F0F4',
  anna: '#F4DCF6', eli: '#E6E9C9', stav: '#FFE0CC', nirel: '#DDE3FA', amos: '#E9DCCB', editor: '#E4E8F3',
};
export const avatarFill = (person) => AVATAR_FILL[person] || '#E4E8F3';
export const initialsOf = (name) => [...String(name || '').trim()].filter((c) => /\S/.test(c)).slice(0, 2).join('');
export function nameOf(viewer, email = '') {
  const me = viewer?.me || null;
  if (me && PEOPLE[me]) return PEOPLE[me].name;
  return String(email || '').split('@')[0];
}
