// The app menu's rules (app/shell-rules.js): which screens each role is offered and in
// what order, the phone's bottom bar, the current page, and the head links the menu
// already offers. Held equal to the predicates the pages use (health.js,
// messages-logic.js, insights.js, team-rules.js, manager-rules.js, office-ui.js), so
// the menu never offers a screen a page would refuse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE, scopeOf } from '../app/protocol.js';
import { canSeeAllClients, canSeeOwnerScreen } from '../app/health.js';
import { canSendMessages } from '../app/messages-logic.js';
import { canSeeInsights } from '../app/insights.js';
import { canManageTeam } from '../app/team-rules.js';
import { isManager } from '../app/manager-rules.js';
import { firstScreenOf } from '../app/office-ui.js';
import { worksCycle } from '../app/month-ui.js';
import {
  menuOf, barOf, currentOf, inMenu, officeScreens, pageOf, initialsOf, nameOf, avatarFill, AVATAR_FILL, seesGantt, editsGantt,
} from '../app/shell-rules.js';

const v = (me) => ({ me, scope: scopeOf(me), error: null });
const OWNER = v(null);
const ROLES = ['irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'amos'];
const ids = (viewer) => menuOf(viewer).map((it) => it.id);

test('the menu of each role, in one order', () => {
  assert.deepEqual(ids(OWNER), ['mine', 'manager', 'clients', 'gantt', 'qa', 'pass', 'decisions', 'insights', 'year', 'prep', 'messages', 'shoot', 'quote', 'quotes', 'team']);
  assert.deepEqual(ids(v('irit')), ['mine', 'manager', 'clients', 'gantt', 'year', 'prep', 'messages', 'shoot', 'quote', 'quotes', 'team']);
  assert.deepEqual(ids(v('ofir')), ['mine', 'manager', 'clients', 'gantt', 'qa', 'pass', 'decisions', 'year', 'prep', 'shoot', 'quote', 'quotes']);
  assert.deepEqual(ids(v('lior')), ['mine', 'overview', 'clients', 'gantt', 'qa', 'decisions', 'insights', 'year', 'prep', 'messages', 'shoot', 'quote', 'quotes', 'team']);
  assert.deepEqual(ids(v('ilai')), ['mine', 'clients', 'gantt', 'year', 'quote', 'quotes']);
  for (const editor of ['nirel', 'nadia', 'yariv', 'anna']) assert.deepEqual(ids(v(editor)), ['mine', 'clients', 'editor', 'quote', 'quotes'], editor);
  assert.deepEqual(ids(v('eli')), ['mine', 'clients', 'shoot', 'quote', 'quotes']);
  // The field agents: their own page and nothing else.
  for (const sales of ['stav', 'amos']) assert.deepEqual(menuOf(v(sales)), [{ id: 'deal', href: 'deal.html', label: 'עסקה חדשה' }]);
  // Someone the app could not identify is offered only their own work.
  assert.deepEqual(ids({ me: null, scope: 'own', error: new Error('x') }), ['mine']);
  assert.deepEqual(ids(null), ['mine']);
});

test('the menu offers a screen exactly when the page\'s own rule opens it', () => {
  for (const viewer of [OWNER, ...ROLES.map(v)]) {
    const has = (id) => ids(viewer).includes(id);
    const who = viewer.me || 'owner';
    if (PEOPLE[viewer.me]?.sales) continue;
    assert.equal(has('manager'), canSeeOwnerScreen(viewer), `${who}: manager`);
    assert.equal(has('manager') || has('overview'), canSeeAllClients(viewer), `${who}: all clients`);
    assert.equal(has('manager'), isManager(viewer), `${who}: the switch`);
    assert.equal(has('messages'), canSendMessages(viewer), `${who}: messages`);
    assert.equal(has('insights'), canSeeInsights(viewer), `${who}: insights`);
    assert.equal(has('team'), canManageTeam(viewer), `${who}: team`);
    assert.equal(has('year'), worksCycle(viewer), `${who}: year`);
    // The content Gantt's index: Ilai, the owner, Irit, Lior and Ofir (gantt.html's own gate is worksCycle too).
    assert.equal(has('gantt'), worksCycle(viewer), `${who}: gantt`);
    assert.equal(has('gantt'), seesGantt(viewer), `${who}: gantt`);
    assert.equal(has('gantt'), [null, 'irit', 'lior', 'ofir', 'ilai'].includes(viewer.me), `${who}: gantt, by name`);
    assert.equal(editsGantt(viewer), [null, 'ilai'].includes(viewer.me), `${who}: edits the gantt`);
    assert.equal(has('prep'), viewer.scope === 'office', `${who}: prep`);
    // qa, pass and decisions open for the office only (their pages' gate).
    for (const id of ['qa', 'pass', 'decisions']) if (has(id)) assert.equal(viewer.scope, 'office', `${who}: ${id}`);
    // The role's own first screen is always in its menu.
    const first = firstScreenOf(viewer.me, viewer, null);
    if (first) assert.ok(menuOf(viewer).some((it) => it.href.split('#')[0] === first.split('#')[0]), `${who}: first screen ${first}`);
  }
});

test('the managers\' two profiles are the first two entries; nobody else has them', () => {
  for (const viewer of [OWNER, v('irit'), v('ofir')]) {
    assert.deepEqual(menuOf(viewer).slice(0, 2).map((it) => [it.mode, it.href, it.label]), [['mine', 'clients.html#mine', 'המשימות שלי'], ['manager', 'owner.html#now', 'מבט מנהל']]);
  }
  for (const viewer of ['lior', 'ilai', 'nadia', 'eli', 'stav'].map(v)) assert.equal(menuOf(viewer).some((it) => it.mode), false);
  assert.deepEqual(menuOf(v('lior'))[1], { id: 'overview', href: 'owner.html#all', label: 'כל הלקוחות במבט' });
});

test('the office screens: the same list the page heads had', () => {
  const list = (viewer) => officeScreens(viewer).map((s) => s.id);
  assert.deepEqual(list(OWNER), ['qa', 'pass', 'decisions', 'insights', 'year']);
  assert.deepEqual(list(v('ofir')), ['qa', 'pass', 'decisions', 'year']);
  assert.deepEqual(list(v('lior')), ['qa', 'decisions', 'insights', 'year']);
  assert.deepEqual(list(v('irit')), ['year']);
  assert.deepEqual(list(v('ilai')), ['year']);
  assert.deepEqual(list(v('nadia')), []);
  assert.deepEqual(list({ me: null, scope: 'own', error: new Error('x') }), []);
});

test('the phone\'s bar: the role\'s three screens and "עוד"; four or fewer all fit; one needs no bar', () => {
  const bar = (viewer) => { const b = barOf(menuOf(viewer), viewer); return [b.bar.map((it) => it.id), b.more.length]; };
  assert.deepEqual(bar(OWNER), [['mine', 'manager', 'clients'], 12]);
  assert.deepEqual(bar(v('irit')), [['mine', 'manager', 'clients'], 8]);
  assert.deepEqual(bar(v('ofir')), [['mine', 'manager', 'qa'], 9]);
  assert.deepEqual(bar(v('lior')), [['mine', 'clients', 'decisions'], 11]);   // in the menu's order
  // Ilai: the Gantt is one of his three (6.10.2026); the package year moved behind "עוד".
  assert.deepEqual(bar(v('ilai')), [['mine', 'clients', 'gantt'], 3]);
  assert.deepEqual(bar(v('nadia')), [['mine', 'clients', 'editor'], 2]);
  assert.deepEqual(bar(v('eli')), [['mine', 'clients', 'shoot'], 2]);
  assert.deepEqual(bar(v('stav')), [[], 0]);
  const four = menuOf(v('eli')).slice(0, 4);
  assert.deepEqual(barOf(four, v('eli')), { bar: four, more: [] });
  // Everything is either in the bar or behind "עוד": nothing is lost.
  for (const viewer of [OWNER, ...ROLES.map(v)]) {
    const items = menuOf(viewer);
    const b = barOf(items, viewer);
    if (items.length > 1) assert.deepEqual([...b.bar, ...b.more].map((it) => it.id).sort(), items.map((it) => it.id).sort());
    assert.ok(b.bar.length <= 4);
  }
});

test('the current page: the screen itself, the two halves of clients.html, and a client\'s pages under the list', () => {
  const items = menuOf(OWNER);
  const cur = (path, hash = '') => currentOf(items, path, hash);
  assert.deepEqual(cur('/owner.html', '#now'), { id: 'manager', exact: true });
  assert.deepEqual(cur('/owner.html', '#table'), { id: 'manager', exact: true });
  assert.deepEqual(cur('/clients.html', ''), { id: 'mine', exact: true });
  assert.deepEqual(cur('/clients.html', '#mine'), { id: 'mine', exact: true });
  assert.deepEqual(cur('/clients.html', '#clients'), { id: 'clients', exact: true });
  assert.deepEqual(cur('/clients.html', '#control'), { id: 'clients', exact: true });
  assert.deepEqual(cur('/sub/dir/qa.html'), { id: 'qa', exact: true });
  assert.deepEqual(cur('/'), { id: 'quote', exact: true });
  assert.deepEqual(cur('/index.html'), { id: 'quote', exact: true });
  assert.deepEqual(cur('/client.html'), { id: 'clients', exact: false });
  // The Gantt's index is its own screen; a client's Gantt is a page under it. Whoever has no index (an editor) stays under the clients list.
  assert.deepEqual(cur('/gantt.html'), { id: 'gantt', exact: true });
  assert.deepEqual(currentOf(items, '/gantt.html', '', '?id=abc&m=2026-11'), { id: 'gantt', exact: false });
  assert.deepEqual(currentOf(menuOf(v('nadia')), '/gantt.html', '', '?id=abc'), { id: 'clients', exact: false });
  assert.deepEqual(cur('/scripts.html'), { id: 'clients', exact: false });
  assert.deepEqual(cur('/staff-privacy.html'), { id: null, exact: false });
  assert.deepEqual(currentOf(menuOf(v('lior')), '/owner.html', '#all'), { id: 'overview', exact: true });
  assert.deepEqual(currentOf(menuOf(v('stav')), '/deal.html'), { id: 'deal', exact: true });
  assert.deepEqual(currentOf(menuOf(v('stav')), '/client.html'), { id: null, exact: false });
  assert.equal(pageOf('/'), 'index.html');
});

test('a head link is hidden only when the menu offers that screen', () => {
  const irit = menuOf(v('irit'));
  assert.equal(inMenu(irit, '/clients.html', '#mine'), true);
  assert.equal(inMenu(irit, '/clients.html', ''), true);
  assert.equal(inMenu(irit, '/owner.html', ''), true);        // "מה דורש אותי" is the manager profile
  assert.equal(inMenu(irit, '/messages.html'), true);
  assert.equal(inMenu(irit, '/insights.html'), false);        // not Irit's: a link to it would stay (no page offers her one)
  assert.equal(inMenu(irit, '/client.html'), false);
  const nadia = menuOf(v('nadia'));
  assert.equal(inMenu(nadia, '/editor.html'), true);
  assert.equal(inMenu(nadia, '/shoot.html'), false);
});

test('names and avatars: two letters on the person\'s pastel; the owner by the address', () => {
  assert.equal(nameOf(v('irit'), 'irit@astrateg.test'), 'עירית');
  assert.equal(nameOf(OWNER, 'adam@astrateg.com'), 'adam');
  assert.equal(initialsOf('עירית'), 'עי');
  assert.equal(initialsOf(' adam '), 'ad');
  assert.equal(initialsOf(''), '');
  for (const key of ROLES) assert.match(AVATAR_FILL[key], /^#[0-9A-F]{6}$/, key);
  assert.equal(avatarFill('nobody'), '#E4E8F3');
});

// Found live (6.10.2026): Ilai's side menu read "המשימות שלי" twice. Whatever the cause,
// no role is ever offered the same screen, address or name twice.
test('no menu has a duplicate entry, for any role: not by id, not by address, not by name', () => {
  for (const viewer of [OWNER, ...ROLES.map(v), { me: null, scope: 'own', error: new Error('x') }, null]) {
    const items = menuOf(viewer);
    for (const f of ['id', 'href', 'label']) {
      const values = items.map((it) => it[f]);
      assert.deepEqual(values, [...new Set(values)], `${viewer?.me || 'owner'}: ${f}`);
    }
    // The bar and "עוד" together hold each entry once.
    const b = barOf(items, viewer);
    const shown = [...b.bar, ...b.more].map((it) => it.id);
    if (items.length > 1) assert.equal(shown.length, new Set(shown).size);
  }
  assert.equal(menuOf(v('ilai')).filter((it) => it.label === 'המשימות שלי').length, 1);
  assert.deepEqual(menuOf(v('ilai')).find((it) => it.id === 'gantt'), { id: 'gantt', href: 'gantt.html', label: 'גאנט תוכן' });
});
