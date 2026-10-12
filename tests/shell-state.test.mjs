// The app's frame in the first paint (app/shell-state.js, app/shell-gate.js; docs/ops.md,
// section 60). The gate is a plain script that knows no rules: it looks up what
// app/shell.js kept for it. So what is kept must say, for every role and every page,
// exactly what the rules say: which profile the page opens in, which item is "here",
// what the bar holds. Here the kept state is held equal to app/shell-rules.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { scopeOf } from '../app/protocol.js';
import {
  menuOf, profileMenu, profileOf, profileSwitch, barOf, groupsOf, currentOf, nameOf, initialsOf, avatarFill,
} from '../app/shell-rules.js';
import { shellState, shellKey, SHELL_PAGES, SHELL_VIEWS, SHELL_KEY, SHELL_VERSION } from '../app/shell-state.js';

const v = (me) => ({ me, scope: scopeOf(me), error: null });
const ROLES = [null, 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'amos'];
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('for every role, page, view and remembered profile the kept frame is what the rules say', () => {
  for (const me of ROLES) {
    const viewer = v(me);
    const state = shellState(viewer, { email: `${me || 'owner'}@astrateg.test`, uid: 'u1' });
    assert.equal(state.v, SHELL_VERSION);
    assert.equal(state.uid, 'u1');
    assert.equal(state.home, menuOf(viewer)[0].href);
    const name = nameOf(viewer, `${me || 'owner'}@astrateg.test`);
    assert.deepEqual(state.who, [name, initialsOf(name), avatarFill(me)]);
    const places = [];
    for (const page of SHELL_PAGES) {
      places.push([page, '', '']);
      for (const hash of SHELL_VIEWS[page] || []) places.push([page, hash, '']);
    }
    places.push(['gantt.html', '', '?id=abc'], ['client.html', '', '?id=abc'], ['year.html', '', '?id=abc']);
    for (const mode of ['mine', 'manager']) {
      for (const [page, hash, search] of places) {
        // What the gate does: the exact view, else the page.
        const table = state.pages[mode];
        const at = table[shellKey(page, hash, search)] || table[shellKey(page, '', search)] || table[page];
        const where = `${me || 'owner'} ${mode} ${page}${search}${hash}`;
        assert.ok(at, where);
        const profile = profileOf(viewer, page, hash, search, mode);
        assert.equal(at[0], profile || '-', `${where}: the profile`);
        const items = profileMenu(viewer, profile);
        const cur = currentOf(items, page, hash, search);
        assert.equal(at[1], cur.id, `${where}: the item`);
        assert.equal(!!at[2], cur.exact, `${where}: is it the page itself`);
        // And the menu of that profile, as app/shell.js arranges it.
        const menu = state.menus[at[0]];
        assert.deepEqual(menu.items.map((it) => it[0]), items.map((it) => it.id), where);
        assert.deepEqual(menu.items.map((it) => [it[1], it[2], it[3]]), items.map((it) => [it.href, it.label, it.short || 0]), where);
        const { bar, more } = barOf(items, viewer);
        assert.deepEqual([menu.bar, menu.more], [bar.map((it) => it.id), more.map((it) => it.id)], where);
        const groups = groupsOf(items, viewer);
        assert.deepEqual([menu.daily, menu.rest], [groups.daily.map((it) => it.id), groups.rest.map((it) => it.id)], where);
        const sw = profileSwitch(viewer, profile);
        assert.deepEqual(menu.sw, sw ? [sw.to, sw.label, sw.href] : null, where);
      }
    }
    // Every entry of the menu has its own answer (a screen of the bar is never guessed).
    for (const it of menuOf(viewer)) {
      const [file, hash = ''] = it.href.split('#');
      if (file.endsWith('/')) continue; // the payments app is another app
      assert.ok(state.pages.mine[shellKey(file, hash ? `#${hash}` : '')], `${me || 'owner'}: ${it.href}`);
    }
    // Names of screens and the person's name: nothing else is in it.
    assert.ok(JSON.stringify(state).length < 12000, `${me || 'owner'}: ${JSON.stringify(state).length} characters`);
  }
});

test('nobody identified: nothing is assumed, and the frame is one entry', () => {
  const state = shellState({ me: null, scope: 'own', error: new Error('x') }, { email: 'a@b.c', uid: 'u' });
  assert.deepEqual(Object.keys(state.menus), ['-']);
  assert.deepEqual(state.menus['-'].items.map((it) => it[0]), ['mine']);
  // app/shell.js keeps nothing at all then.
  assert.match(read('app/shell.js'), /if \(!user\?\.id \|\| !viewer \|\| viewer\.error \|\|[^\n]+\{ sessionStorage\.removeItem\(SHELL_KEY\); return; \}/);
});

test('the gate is in the <head> of every staff page, before the styles, and is a plain script of this site', () => {
  const staff = readdirSync(new URL('../', import.meta.url)).filter((f) => f.endsWith('.html') && /<script type="module" src="app\/[^"]+"/.test(read(f)))
    .filter((f) => { const entry = /<script type="module" src="(app\/[^"]+)"/.exec(read(f))[1]; return /\bmountSession\(/.test(read(entry)) || f === 'quotes.html'; });
  assert.ok(staff.length >= 19, staff.join(' '));
  for (const page of staff) {
    const html = read(page);
    const head = html.slice(0, html.indexOf('</head>'));
    assert.ok(head.includes('<script src="app/shell-gate.js"></script>'), `${page}: the gate`);
    assert.ok(head.indexOf('app/frame-guard.js') < head.indexOf('app/shell-gate.js'), `${page}: after the frame guard`);
    assert.ok(head.indexOf('app/shell-gate.js') < head.indexOf('app/styles/shell.css'), `${page}: before the styles that hold the first paint`);
    assert.ok(SHELL_PAGES.includes(page), `${page}: has its answer in the kept frame`);
  }
  // A page a client opens without signing in never gets a frame.
  for (const page of ['q.html', 'status.html', 'gallery.html', 'scripts-view.html', 'access.html']) assert.ok(!read(page).includes('shell-gate.js'), page);
  const gate = read('app/shell-gate.js');
  assert.ok(gate.includes(`var KEY = '${SHELL_KEY}';`));
  // Plain DOM calls only: nothing kept is ever read as markup or run.
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(gate.replace(/\/\/.*$/gm, '')));
  assert.ok(!/\bimport\b|\bexport\b|=>|\bconst\b|\blet\b/.test(gate.replace(/\/\/.*$/gm, '')), 'runs as a plain script in any browser the pages open in');
  // The frame is drawn only for the account that is signed in on the device.
  assert.match(gate, /if \(!uid \|\| \(shell && shell\.uid !== uid\) \|\| \(owner && owner !== uid\)\) \{ forget\(\); shell = null; \}/);
  assert.match(gate, /if \(!shell\) return;/);
});

test('what the tab keeps for the next screen goes when the person signs out', async () => {
  const { forgetPlace, forgetKept, KEPT_KEYS, KEPT_PREFIX } = await import('../app/visit.js');
  const map = new Map();
  const s = { get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null, getItem: (k) => map.get(k) ?? null, setItem: (k, val) => map.set(k, val), removeItem: (k) => map.delete(k) };
  const fill = () => { for (const k of [...KEPT_KEYS, KEPT_PREFIX, `${KEPT_PREFIX}.abc`, `${KEPT_PREFIX}.sizes`, 'astrateg.tabSeen']) map.set(k, 'x'); };
  fill();
  forgetKept(s);
  assert.deepEqual([...map.keys()], ['astrateg.tabSeen']);
  fill();
  forgetPlace(s, null);
  assert.deepEqual([...map.keys()].sort(), ['astrateg.tabSeen', 'astrateg.visit']);
  assert.ok(KEPT_KEYS.includes(SHELL_KEY));
  assert.equal(KEPT_PREFIX, (await import('../app/data-cache.js')).CACHE_KEY);
});
