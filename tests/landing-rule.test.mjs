// Where a person stands when they open the app or sign in (the owner's rule, 9.10.2026;
// docs/ops.md, section 54): on THEIR home, never on a place the browser remembered.
// The rule (afterSignIn, homeHref in app/shell-rules.js), the visit (app/visit.js), and
// the profile, which lives in the tab and not in the browser (app/manager-rules.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterSignIn, homeHref, homeLink } from '../app/shell-rules.js';
import { beginVisit, forgetPlace, visitStore, PLACE_KEYS } from '../app/visit.js';
import { modeOf, setMode, resetMode } from '../app/manager-rules.js';
import { firstScreenOf, landingNow } from '../app/office-ui.js';

const v = (me, scope = 'office') => ({ me, scope, error: null });
const OWNER = v(null);
const OFFICE = ['irit', 'lior', 'ofir'];
const OWN = ['ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli'];
const SALES = ['stav', 'amos'];
const storage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, x) => { m.set(k, String(x)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, keys: () => [...m.keys()].sort() };
};
const at = (pathname, hash = '', search = '') => ({ pathname: `/${pathname}`, hash, search });

test('the home: "המשימות שלי" for everyone, the deal page for the field sales', () => {
  assert.equal(homeHref(OWNER), 'clients.html#mine');
  for (const who of OFFICE) assert.equal(homeHref(v(who)), 'clients.html#mine', who);
  // The editors, Nirel and Eli used to land on editor.html / shoot.html: now on their tasks too.
  for (const who of OWN) assert.equal(homeHref(v(who, 'own')), 'clients.html#mine', who);
  for (const who of SALES) assert.equal(homeHref(v(who, 'own')), 'deal.html', who);
  assert.equal(homeLink(v('nadia', 'own')).href, homeHref(v('nadia', 'own')));
  // clients.html sends nobody on to another screen any more, except the field sales.
  for (const who of [...OFFICE, ...OWN]) assert.equal(firstScreenOf(who, v(who)), null, who);
  assert.equal(landingNow({ me: 'nadia', viewer: v('nadia', 'own'), arrived: '', fresh: true }), null);
  assert.equal(landingNow({ me: 'eli', viewer: v('eli', 'own'), arrived: '', fresh: true }), null);
});

test('after a sign-in on any page the person goes to their home', () => {
  // The owner's screenshot: an editor signs in on messages.html, where the last person was.
  assert.deepEqual(afterSignIn(v('nadia', 'own'), at('messages.html')), { go: 'clients.html#mine' });
  for (const page of ['messages.html', 'owner.html', 'qa.html', 'decisions.html', 'editor.html', 'shoot.html', 'client.html', 'quotes.html', 'index.html', 'deal.html', 'team.html']) {
    for (const viewer of [OWNER, ...OFFICE.map((w) => v(w)), ...OWN.map((w) => v(w, 'own'))]) {
      assert.deepEqual(afterSignIn(viewer, at(page, '#x', page === 'client.html' ? '?id=1' : '')), { go: 'clients.html#mine' }, `${viewer.me || 'owner'} on ${page}`);
    }
  }
  for (const who of SALES) {
    assert.deepEqual(afterSignIn(v(who, 'own'), at('clients.html')), { go: 'deal.html' }, who);
    assert.deepEqual(afterSignIn(v(who, 'own'), at('messages.html')), { go: 'deal.html' }, who);
    assert.deepEqual(afterSignIn(v(who, 'own'), at('deal.html')), { stay: true }, who);
  }
});

test('on the home itself nothing moves; another tab of it becomes the first one', () => {
  for (const viewer of [OWNER, v('irit'), v('nadia', 'own'), v('eli', 'own')]) {
    assert.deepEqual(afterSignIn(viewer, at('clients.html')), { stay: true });
    assert.deepEqual(afterSignIn(viewer, at('clients.html', '#mine')), { stay: true });
    for (const hash of ['#control', '#clients', '#team', '#late', '#performance']) {
      assert.deepEqual(afterSignIn(viewer, at('clients.html', hash)), { stay: true, rewrite: 'clients.html#mine' }, hash);
    }
  }
});

test('a deep link the person opened in this visit keeps them, guarded: a page that is not theirs sends them home', () => {
  assert.deepEqual(afterSignIn(v('irit'), at('client.html', '#p07', '?id=7'), { entry: false }), { go: 'clients.html#mine' });
  const deep = (viewer, page, hash = '', search = '') => afterSignIn(viewer, { ...at(page, hash, search), entry: true });
  assert.deepEqual(deep(v('irit'), 'client.html', '#p07', '?id=7'), { stay: true, guard: 'clients.html#mine' });
  assert.deepEqual(deep(v('irit'), 'messages.html'), { stay: true, guard: 'clients.html#mine' });
  // The guard is the person's own home: an editor on the messages page is taken to their tasks.
  assert.deepEqual(deep(v('nadia', 'own'), 'messages.html'), { stay: true, guard: 'clients.html#mine' });
  assert.deepEqual(deep(v('stav', 'own'), 'owner.html'), { stay: true, guard: 'deal.html' });
  assert.deepEqual(deep(v('lior'), 'clients.html', '#late'), { stay: true, guard: 'clients.html#mine' });
  // The home opened as the first page is simply the home.
  assert.deepEqual(deep(v('lior'), 'clients.html'), { stay: true });
});

test('a visit: the page it began on is "on purpose" (also after a reload); signing out ends that', () => {
  const s = storage();
  assert.equal(beginVisit(at('client.html', '#p07', '?id=7'), s), true, 'the first page of the tab');
  assert.equal(beginVisit(at('client.html', '', '?id=7'), s), true, 'the same page again (a reload, another hash)');
  assert.equal(beginVisit(at('messages.html'), s), false, 'a page reached from inside the app');
  assert.equal(beginVisit(at('client.html', '', '?id=8'), s), false, 'another client');
  forgetPlace(s, storage());
  assert.equal(beginVisit(at('client.html', '', '?id=7'), s), false, 'after signing out, no page of this visit is on purpose');
  // A new tab (a notification opens one; the installed app starting): a new visit.
  assert.equal(beginVisit(at('messages.html'), storage()), true);
  // No storage at all: nothing is known to be on purpose.
  assert.equal(beginVisit(at('messages.html'), null), false);
});

test('what a place remembers lives in the tab, and a sign-out (or a sign-in) forgets it', () => {
  const s = storage();
  const l = storage({ 'astrateg.profile': 'manager', 'astrateg.mode': 'manager', 'astrateg.mine.full': 'on', 'astrateg.notify': 'on', 'astrateg.charform.c1': 'draft', 'sb-x-auth-token': '{}' });
  for (const k of PLACE_KEYS) visitStore.set(k, 'x', s);
  assert.deepEqual(s.keys(), PLACE_KEYS.map((k) => `astrateg.${k}`).sort());
  s.setItem('astrateg.tabSeen', '1');
  s.setItem('astrateg-draft', '{}');
  forgetPlace(s, l);
  // The tab keeps what is not a place (the drafts have their own rule, tests/auth-link.test.mjs).
  assert.deepEqual(s.keys(), ['astrateg-draft', 'astrateg.tabSeen', 'astrateg.visit']);
  assert.equal(s.getItem('astrateg.visit'), 'out');
  // The browser: the old remembered choices are removed; the device's own settings and the drafts are not touched here.
  assert.deepEqual(l.keys(), ['astrateg.charform.c1', 'astrateg.notify', 'sb-x-auth-token']);
  assert.equal(visitStore.get('mine.full', s), null);
  visitStore.set('mine.full', 'on', s);
  assert.equal(visitStore.get('mine.full', s), 'on');
  visitStore.set('mine.full', '', s);
  assert.equal(visitStore.get('mine.full', s), null);
});

test('"מבט מנהל" is a choice of this tab: a new tab, a new launch and a sign-in start in the personal profile', () => {
  const tab = storage();
  assert.equal(modeOf(OWNER, tab), 'mine');
  setMode('manager', tab);
  assert.equal(modeOf(OWNER, tab), 'manager');
  assert.equal(modeOf(OWNER, storage()), 'mine', 'another tab, or the next launch of the app');
  resetMode(tab);
  assert.equal(modeOf(OWNER, tab), 'mine');
  assert.equal(modeOf(v('nadia', 'own'), storage({ 'astrateg.profile': 'manager' })), null, 'no profiles: no mode');
  // The module no longer reads the browser's storage for the choice.
  const src = readFileSync(new URL('../app/manager-rules.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /storage = globalThis\.localStorage/);
});

test('every sign-in form asks the same rule, and the sign-out forgets the place', () => {
  const read = (f) => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
  for (const f of ['protocol-ui.js', 'dashboard.js']) {
    assert.match(read(f), /signInPlan\(/, f);
    assert.match(read(f), /forgetPlace\(\)/, f);
    assert.match(read(f), /loginDoor\.leave\(\)/, f);
  }
  assert.match(read('builder.js'), /if \(denied\) \{ const home = /, 'the builder dialog: whoever may not build goes home');
  for (const f of ['protocol-ui.js', 'dashboard.js']) assert.match(read(f), /resetMode\(\); forgetPlace\(\); await signOutHere\(\)/, `${f}: the sign-out`);
  // Not from supa.js: the client's passwords form loads it, and only its own short list of files (section 36).
  assert.doesNotMatch(read('supa.js'), /import [^;]*visit\.js/);
  // The installed app starts on the home.
  const manifest = JSON.parse(readFileSync(new URL('../clients.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.start_url, '/clients.html#mine');
  assert.equal(manifest.id, '/clients.html', 'the same installed app as before');
});
