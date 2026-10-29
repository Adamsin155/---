// What app/shell-gate.js needs to put the app's frame into the first paint of the next
// page (docs/ops.md, section 60): the menu of each profile of this person, already
// split into the phone's bar and the wide list, and for every page of the app which
// profile it opens in and which item is "here". The gate is a plain script that runs
// before the modules and knows no rules; so the rules (app/shell-rules.js) are applied
// here, once, for every page the person can reach, and the gate only looks the answer up.
// Names of screens and the person's own name: nothing from the database's tables.
// No DOM here, so node can test it (tests/shell.test.mjs holds it equal to the rules).
import {
  menuOf, profileMenu, profileOf, profileSwitch, barOf, groupsOf, currentOf, avatarFill, initialsOf, nameOf, pageOf,
} from './shell-rules.js';

export const SHELL_KEY = 'astrateg.shell';
export const SHELL_VERSION = 1;
// Every staff page that carries the gate, and the views of the two pages whose address
// decides the profile or the item (the tabs of clients.html, the manager's screens).
export const SHELL_PAGES = [
  'clients.html', 'client.html', 'owner.html', 'gantt.html', 'scripts.html', 'intake.html', 'landing.html', 'qa.html', 'pass.html',
  'decisions.html', 'insights.html', 'year.html', 'prep.html', 'messages.html', 'editor.html', 'shoot.html', 'quotes.html',
  'team.html', 'deal.html', 'calendar.html', 'ask.html',
];
export const SHELL_VIEWS = {
  'clients.html': ['#mine', '#late', '#clients', '#team', '#control', '#performance'],
  'owner.html': ['#now', '#all', '#shoots', '#table', '#archive'],
};
// The key of a page in the table: its file, "?" for a Gantt of one client, and its view.
export const shellKey = (page, hash = '', search = '') => `${page}${page === 'gantt.html' && /[?&]id=/.test(String(search)) ? '?' : ''}${hash}`;

const NONE = '-'; // the one menu of whoever has no profiles

export function shellState(viewer, { email = '', uid = '' } = {}) {
  const profiles = profileOf(viewer, 'clients.html', '#mine') === null ? [null] : ['mine', 'manager'];
  const menus = {};
  for (const p of profiles) {
    const items = profileMenu(viewer, p);
    const { bar, more } = barOf(items, viewer);
    const groups = groupsOf(items, viewer);
    const sw = profileSwitch(viewer, p);
    const ids = (list) => list.map((it) => it.id);
    menus[p || NONE] = {
      items: items.map((it) => [it.id, it.href, it.label, it.short || 0]),
      bar: ids(bar), more: ids(more), daily: ids(groups.daily), rest: ids(groups.rest),
      sw: sw ? [sw.to, sw.label, sw.href] : null,
    };
  }
  // Every address worth an answer: the pages, their views, and each entry of the menu.
  const places = [];
  for (const page of SHELL_PAGES) {
    places.push([page, '', '']);
    for (const hash of SHELL_VIEWS[page] || []) places.push([page, hash, '']);
  }
  places.push(['gantt.html', '', '?id=x']);
  for (const it of menuOf(viewer)) {
    const [file, hash = ''] = String(it.href).split('#');
    if (!file.endsWith('/')) places.push([pageOf(file), hash ? `#${hash}` : '', '']);
  }
  const pages = {};
  for (const mode of ['mine', 'manager']) {
    pages[mode] = {};
    for (const [page, hash, search] of places) {
      const profile = profileOf(viewer, page, hash, search, mode);
      const cur = currentOf(profileMenu(viewer, profile), page, hash, search);
      pages[mode][shellKey(page, hash, search)] = [profile || NONE, cur.id, cur.exact ? 1 : 0];
    }
  }
  const name = nameOf(viewer, email);
  return {
    v: SHELL_VERSION, uid, home: menuOf(viewer)[0].href, menus, pages,
    who: [name, initialsOf(name), avatarFill(viewer?.me || null)],
  };
}
