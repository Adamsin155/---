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
import { isManager, hasProfiles, canSeeQuoteList, seesFinance } from '../app/manager-rules.js';
import { firstScreenOf } from '../app/office-ui.js';
import { worksCycle } from '../app/month-ui.js';
import {
  menuOf, profileMenu, PERSONAL, barOf, groupsOf, GROUP_FROM, currentOf, inMenu, officeScreens, pageOf, initialsOf, nameOf, avatarFill, AVATAR_FILL, seesGantt, editsGantt,
} from '../app/shell-rules.js';

const v = (me) => ({ me, scope: scopeOf(me), error: null });
const OWNER = v(null);
const ROLES = ['irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'amos'];
const ids = (viewer) => menuOf(viewer).map((it) => it.id);

// Everything each role may open. Since 6.10.2026 "הצעות שנשלחו" is the owners' and Irit's
// only (it left the menus of Ofir, Lior, Ilai, the editors and Eli), and the owners have
// the payments app. The owners, Ofir and Lior see this list one profile at a time (below).
test('everything each role may open, in one order', () => {
  assert.deepEqual(ids(OWNER), ['mine', 'manager', 'clients', 'gantt', 'qa', 'pass', 'decisions', 'insights', 'year', 'prep', 'messages', 'shoot', 'shoot-table', 'quote', 'quotes', 'team', 'payouts']);
  assert.deepEqual(ids(v('irit')), ['mine', 'manager', 'clients', 'gantt', 'year', 'prep', 'messages', 'shoot', 'quote', 'quotes', 'team']);
  assert.deepEqual(ids(v('ofir')), ['mine', 'manager', 'clients', 'gantt', 'qa', 'pass', 'decisions', 'year', 'prep', 'shoot', 'shoot-table', 'quote']);
  assert.deepEqual(ids(v('lior')), ['mine', 'overview', 'clients', 'gantt', 'qa', 'decisions', 'insights', 'year', 'prep', 'messages', 'shoot', 'shoot-table', 'quote', 'team']);
  assert.deepEqual(ids(v('ilai')), ['mine', 'clients', 'gantt', 'year', 'quote']);
  for (const editor of ['nirel', 'nadia', 'yariv', 'anna']) assert.deepEqual(ids(v(editor)), ['mine', 'clients', 'editor', 'quote'], editor);
  assert.deepEqual(ids(v('eli')), ['mine', 'clients', 'shoot', 'quote']);
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
    // Money: the list of sent quotes for the owners and Irit, the payments app for the owners.
    assert.equal(has('quotes'), canSeeQuoteList(viewer), `${who}: quotes`);
    assert.equal(has('payouts'), seesFinance(viewer), `${who}: payouts`);
    assert.equal(has('payouts'), viewer.me === null, `${who}: payouts, by name`);
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

test('nobody has a switch inside the menu (Irit\'s two entries went on 7.10.2026): the one switch is the button at the top', () => {
  assert.deepEqual(menuOf(v('irit')).slice(0, 2).map((it) => [it.href, it.label]), [['clients.html#mine', 'המשימות שלי'], ['owner.html#now', 'מבט מנהל']]);
  for (const viewer of [OWNER, ...ROLES.map(v)]) assert.equal(menuOf(viewer).some((it) => 'mode' in it), false, viewer.me || 'owner');
  assert.deepEqual(menuOf(v('lior'))[1], { id: 'overview', href: 'owner.html#all', label: 'כל הלקוחות במבט' });
  // Without profiles the menu of either profile is the whole menu, unchanged.
  for (const viewer of ['ilai', 'nadia', 'eli', 'stav'].map(v)) for (const p of ['mine', 'manager', null]) assert.deepEqual(profileMenu(viewer, p), menuOf(viewer), viewer.me);
});

// The owner's wording of 7.10.2026: the builder is "הצעה חדשה והכנת חוזה" for everyone who
// has it; the phone's bottom bar shows the short name (app/shell.js).
test('the builder\'s entry: "הצעה חדשה והכנת חוזה", with a short name for the phone\'s bar', () => {
  for (const viewer of [OWNER, ...ROLES.filter((r) => !['stav', 'amos'].includes(r)).map(v)]) {
    assert.deepEqual(menuOf(viewer).find((it) => it.id === 'quote'), { id: 'quote', href: 'index.html', label: 'הצעה חדשה והכנת חוזה', short: 'הצעה וחוזה' }, viewer.me || 'owner');
  }
  for (const viewer of [OWNER, ...ROLES.map(v)]) for (const it of menuOf(viewer)) assert.equal('short' in it, it.id === 'quote', `${viewer.me || 'owner'}: ${it.id}`);
});

// The owner's request of 6.10.2026: the owners, Ofir and Lior start with a short menu of
// their own daily work; the management screens are only in the manager profile.
test('the two profiles of the owners, Ofir and Lior: a short personal menu, the management screens only behind "מבט מנהל"', () => {
  const of = (viewer, p) => profileMenu(viewer, p).map((it) => it.id);
  assert.deepEqual(of(OWNER, 'mine'), ['mine', 'clients', 'quote', 'quotes']);
  assert.deepEqual(of(OWNER, 'manager'), ['manager', 'clients', 'gantt', 'qa', 'pass', 'decisions', 'insights', 'year', 'prep', 'messages', 'shoot', 'shoot-table', 'team', 'payouts']);
  assert.deepEqual(of(v('lior'), 'mine'), ['mine', 'clients', 'decisions', 'messages', 'shoot']);
  assert.deepEqual(of(v('lior'), 'manager'), ['overview', 'clients', 'gantt', 'qa', 'insights', 'year', 'prep', 'shoot-table', 'quote', 'team']);
  assert.deepEqual(of(v('ofir'), 'mine'), ['mine', 'clients', 'qa', 'pass']);
  assert.deepEqual(of(v('ofir'), 'manager'), ['manager', 'clients', 'gantt', 'decisions', 'year', 'prep', 'shoot', 'shoot-table', 'quote']);
  // Irit (7.10.2026): her daily screens; the manager view, the Gantt, the year, the shoot days and the team behind the button.
  assert.deepEqual(of(v('irit'), 'mine'), ['mine', 'clients', 'prep', 'messages', 'quote', 'quotes']);
  assert.deepEqual(of(v('irit'), 'manager'), ['manager', 'clients', 'gantt', 'year', 'shoot', 'team']);
  for (const viewer of [OWNER, v('ofir'), v('lior'), v('irit')]) {
    const who = viewer.me || 'owner';
    assert.equal(hasProfiles(viewer), true, who);
    const all = ids(viewer);
    const mine = of(viewer, 'mine');
    const manager = of(viewer, 'manager');
    // Nothing is lost and nothing is added: the two profiles together are everything the person may open.
    assert.deepEqual([...new Set([...mine, ...manager])].sort(), [...all].sort(), who);
    // Only the clients list is in both.
    assert.deepEqual(mine.filter((id) => manager.includes(id)), ['clients'], who);
    // The personal menu is short, starts with "המשימות שלי" and holds no management screen.
    // (Irit's has six: "לפני יום צילום" is her own daily page, prep.html.)
    assert.ok(mine.length <= (who === 'irit' ? 6 : 5) && mine[0] === 'mine', who);
    assert.deepEqual(mine, PERSONAL[who], who);
    for (const id of ['manager', 'overview', 'gantt', 'insights', 'year', 'prep', 'shoot-table', 'team', 'payouts']) assert.equal(mine.includes(id), id === 'prep' && who === 'irit', `${who}: ${id}`);
    // The manager menu opens with the manager view and has no "המשימות שלי" (the button leads back).
    assert.ok(['manager', 'overview'].includes(manager[0]), who);
    assert.equal(manager.includes('mine'), false, who);
    // No profile ever shows a default: an unknown profile is the personal one.
    assert.deepEqual(of(viewer, null), mine, who);
  }
  // On a phone the personal profile needs no "עוד" for the owners and Ofir; Lior's fifth and fourth screens are behind it.
  const bar = (viewer, p) => { const b = barOf(profileMenu(viewer, p), viewer); return [b.bar.map((it) => it.id), b.more.map((it) => it.id)]; };
  assert.deepEqual(bar(OWNER, 'mine'), [['mine', 'clients', 'quote', 'quotes'], []]);
  assert.deepEqual(bar(v('ofir'), 'mine'), [['mine', 'clients', 'qa', 'pass'], []]);
  assert.deepEqual(bar(v('lior'), 'mine'), [['mine', 'clients', 'decisions'], ['messages', 'shoot']]);
  assert.deepEqual(bar(v('irit'), 'mine'), [['mine', 'clients', 'prep'], ['messages', 'quote', 'quotes']]);
  assert.deepEqual(bar(v('irit'), 'manager'), [['manager', 'clients', 'gantt'], ['year', 'shoot', 'team']]);
  assert.deepEqual(bar(OWNER, 'manager')[0], ['manager', 'clients', 'gantt']);
  assert.deepEqual(bar(v('ofir'), 'manager')[0], ['manager', 'clients', 'gantt']);
  assert.deepEqual(bar(v('lior'), 'manager')[0], ['overview', 'clients', 'gantt']);
  // Only the manager profile is long enough for two parts.
  const parts = (viewer, p) => { const g = groupsOf(profileMenu(viewer, p), viewer); return [g.daily.map((it) => it.id), g.rest.length]; };
  for (const viewer of [OWNER, v('ofir'), v('lior'), v('irit')]) assert.equal(parts(viewer, 'mine')[1], 0);
  assert.equal(parts(v('irit'), 'manager')[1], 0); // six screens: one list
  assert.deepEqual(parts(OWNER, 'manager'), [['manager', 'clients', 'decisions', 'messages'], 10]);
  assert.deepEqual(parts(v('lior'), 'manager'), [['overview', 'clients'], 8]);
  assert.deepEqual(parts(v('ofir'), 'manager'), [['manager', 'clients'], 7]);
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
  assert.deepEqual(bar(OWNER), [['mine', 'manager', 'clients'], 14]);
  assert.deepEqual(bar(v('irit')), [['mine', 'manager', 'clients'], 8]);
  assert.deepEqual(bar(v('ofir')), [['mine', 'manager', 'qa'], 9]);
  assert.deepEqual(bar(v('lior')), [['mine', 'overview', 'decisions'], 11]);   // in the menu's order
  // Ilai: the Gantt is one of his three (6.10.2026); the package year moved behind "עוד".
  assert.deepEqual(bar(v('ilai')), [['mine', 'clients', 'gantt'], 2]);
  // Four screens all fit in the bar (it was three and "עוד" while "הצעות שנשלחו" was a fifth).
  assert.deepEqual(bar(v('nadia')), [['mine', 'clients', 'editor', 'quote'], 0]);
  assert.deepEqual(bar(v('eli')), [['mine', 'clients', 'shoot', 'quote'], 0]);
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
  assert.equal(nameOf(OWNER, 'name@astrateg.com'), 'name');
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

// The simplicity pass of 6.10.2026: the office's menus ran 11 to 16 entries in one list.
test('a long menu is two parts: the daily screens, then the rest under "עוד"; nothing is lost and a short menu stays one list', () => {
  const parts = (viewer) => { const g = groupsOf(menuOf(viewer), viewer); return [g.daily.map((it) => it.id), g.rest.map((it) => it.id)]; };
  assert.deepEqual(parts(OWNER), [['mine', 'manager', 'clients', 'decisions', 'messages'], ['gantt', 'qa', 'pass', 'insights', 'year', 'prep', 'shoot', 'shoot-table', 'quote', 'quotes', 'team', 'payouts']]);
  assert.deepEqual(parts(v('irit')), [['mine', 'manager', 'clients', 'messages', 'quote', 'quotes'], ['gantt', 'year', 'prep', 'shoot', 'team']]);
  assert.deepEqual(parts(v('lior')), [['mine', 'overview', 'clients', 'decisions', 'messages'], ['gantt', 'qa', 'insights', 'year', 'prep', 'shoot', 'shoot-table', 'quote', 'team']]);
  assert.deepEqual(parts(v('ofir')), [['mine', 'manager', 'clients', 'qa', 'pass'], ['gantt', 'decisions', 'year', 'prep', 'shoot', 'shoot-table', 'quote']]);
  for (const viewer of [OWNER, ...ROLES.map(v), { me: null, scope: 'own', error: new Error('x') }, null]) {
    const items = menuOf(viewer);
    const g = groupsOf(items, viewer);
    const who = viewer?.me || 'owner';
    // Every entry once, each part in the menu's own order.
    assert.deepEqual([...g.daily, ...g.rest].map((it) => it.id).sort(), items.map((it) => it.id).sort(), who);
    for (const part of [g.daily, g.rest]) assert.deepEqual(part, items.filter((it) => part.includes(it)), who);
    // A short menu is not split; a split one keeps at most six on top.
    if (items.length <= GROUP_FROM) assert.deepEqual(g, { daily: items, rest: [] }, who);
    else assert.ok(g.daily.length >= 3 && g.daily.length <= 6 && g.rest.length > 0, who);
    // What the phone's bar holds is always among the daily screens, and so is the role's first screen.
    const bar = barOf(items, viewer).bar;
    for (const it of bar) assert.ok(g.daily.includes(it), `${who}: ${it.id} is in the bar but not daily`);
    const first = firstScreenOf(viewer?.me, viewer, null);
    if (first && g.rest.length) assert.ok(g.daily.some((it) => it.href.split('#')[0] === first.split('#')[0]), `${who}: the first screen is daily`);
  }
  for (const who of ['ilai', 'nadia', 'eli', 'stav']) assert.deepEqual(groupsOf(menuOf(v(who)), v(who)).rest, [], who);
});
