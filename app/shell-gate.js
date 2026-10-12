// The app's frame is in the first paint of every staff page, so that it stays in place
// from screen to screen (docs/ops.md, section 60). Every move between screens is a
// page load; what makes it feel like one app is that the bottom bar (the side menu on
// a wide screen) and the top bar do not go away and come back. The menu is drawn by a
// module (app/shell.js) that knows the rules, but a module runs after the first paint,
// and after the server said who is signed in. So this runs before the page is drawn (a
// plain script in <head>, like login-gate.js; the policy allows no code in the page
// itself) and puts back the frame as app/shell.js last drew it for this person in this
// tab: the items, the one that is this page, the name and the profile button.
//  - What is kept is the menu only (sessionStorage 'astrateg.shell': names of screens,
//    the person's own name; nothing from the database's tables), under the id of the
//    account that is signed in on this device. Another account, or none: it is
//    removed, and so is the session's data cache (app/data-cache.js), before anything
//    is drawn. app/shell.js draws the real menu a moment later either way, from the
//    server's answer, and replaces this one.
//  - If the page turns out to show the sign-in screen (the session ended), the frame is
//    taken away again.
//  - Also here, because it must be listening before the first paint: which way the
//    page comes in (a client's card from the side, "back" the other way, a screen of
//    the bar with a fade). app/styles/shell.css moves it; a browser without
//    cross-document view transitions simply loads the page.
// It decides nothing about what anyone may see: the pages and the database do.
(function () {
  var root = document.documentElement;
  var KEY = 'astrateg.shell';
  var CACHE = 'astrateg.cache';
  var store = null;
  try { store = window.sessionStorage; } catch (e) { /* no storage: nothing is kept, nothing is drawn early */ }

  // ── Whose session is kept on this device ──
  var uid = null;
  try {
    for (var i = 0; i < window.localStorage.length; i += 1) {
      var name = window.localStorage.key(i) || '';
      if (!/^sb-.+-auth-token$/.test(name)) continue;
      var kept = JSON.parse(window.localStorage.getItem(name) || 'null');
      if (kept && kept.user && typeof kept.user.id === 'string') uid = kept.user.id;
    }
  } catch (e) { uid = null; }

  // What this tab kept for someone else (or for nobody) goes before anything is drawn.
  function forget() {
    if (!store) return;
    try {
      var gone = [];
      for (var j = 0; j < store.length; j += 1) {
        var k = store.key(j) || '';
        if (k === KEY || k === CACHE || k.indexOf(CACHE + '.') === 0) gone.push(k);
      }
      for (var g = 0; g < gone.length; g += 1) store.removeItem(gone[g]);
    } catch (e) { /* no storage */ }
  }
  var shell = null;
  try { shell = store ? JSON.parse(store.getItem(KEY) || 'null') : null; } catch (e) { shell = null; }
  var owner = null;
  try { owner = store ? (JSON.parse(store.getItem(CACHE) || 'null') || {}).uid || null : null; } catch (e) { owner = null; }
  if (!uid || (shell && shell.uid !== uid) || (owner && owner !== uid)) { forget(); shell = null; }
  if (shell && (shell.v !== 1 || !shell.menus || !shell.pages)) shell = null;

  // ── Which way the page comes in ──
  var pageOf = function (path) { return String(path || '').split('/').pop() || 'index.html'; };
  // A page about one client is a step in from a list; everything else is a screen of the menu.
  var DEEP = { 'client.html': 1, 'scripts.html': 1, 'intake.html': 1, 'landing.html': 1 };
  var depthOf = function (url) {
    try {
      var u = new URL(url, window.location.href);
      var page = pageOf(u.pathname);
      if (page === 'gantt.html' || page === 'year.html') return /[?&]id=/.test(u.search) ? 1 : 0;
      return DEEP[page] ? 1 : 0;
    } catch (e) { return 0; }
  };
  var LAST = 'astrateg.nav';
  var from = null;
  try { from = store ? store.getItem(LAST) : null; if (store) store.setItem(LAST, window.location.pathname + window.location.search); } catch (e) { from = null; }
  function wayIn() {
    var back = false;
    var prev = from;
    try {
      var act = window.navigation && window.navigation.activation;
      if (act && act.from && act.from.url) prev = act.from.url;
      if (act && act.navigationType === 'traverse' && act.entry && act.from) return act.entry.index < act.from.index ? 'back' : 'forward';
      if (act && act.navigationType === 'reload') return 'fade';
    } catch (e) { /* no Navigation API */ }
    try {
      var nav = window.performance.getEntriesByType('navigation')[0];
      back = !!nav && nav.type === 'back_forward';
      if (nav && nav.type === 'reload') return 'fade';
    } catch (e) { back = false; }
    if (back) return 'back';
    if (!prev) return 'fade';
    var was = depthOf(prev);
    var now = depthOf(window.location.href);
    return now > was ? 'forward' : now < was ? 'back' : 'fade';
  }
  // A page the browser kept whole and shows again: "back", unless the browser says otherwise.
  var restored = false;
  function wayBack() {
    try {
      var act = window.navigation && window.navigation.activation;
      if (act && act.navigationType === 'traverse' && act.entry && act.from) return act.entry.index < act.from.index ? 'back' : 'forward';
    } catch (e) { /* no Navigation API */ }
    return 'back';
  }
  try {
    window.addEventListener('pageshow', function (e) {
      if (!e.persisted) return;
      restored = true;
      try { if (store) store.setItem(LAST, window.location.pathname + window.location.search); } catch (err) { /* no storage */ }
    });
    window.addEventListener('pagereveal', function (e) {
      if (!e.viewTransition) return;
      var way = 'fade';
      try { way = restored ? wayBack() : wayIn(); } catch (err) { way = 'fade'; }
      restored = false;
      root.setAttribute('data-nav', way);
      var done = function () { root.removeAttribute('data-nav'); };
      e.viewTransition.finished.then(done, done);
    });
  } catch (e) { /* an old browser: pages just load */ }

  if (!shell) return;

  // ── The frame, as it was last drawn for this person ──
  var el = function (tag, attrs, text) {
    var node = document.createElement(tag);
    for (var a in attrs) if (Object.prototype.hasOwnProperty.call(attrs, a)) node.setAttribute(a, attrs[a]);
    if (text != null) node.textContent = text;
    return node;
  };
  function lookUp() {
    var page = pageOf(window.location.pathname);
    var mode = 'mine';
    try { if (store && store.getItem('astrateg.profile') === 'manager') mode = 'manager'; } catch (e) { mode = 'mine'; }
    var table = shell.pages[mode] || {};
    var withId = (page === 'gantt.html' && /[?&]id=/.test(window.location.search)) ? '?' : '';
    return table[page + withId + window.location.hash] || table[page + withId] || table[page] || null;
  }
  function draw() {
    var top = document.querySelector('header.topbar');
    var at = lookUp();
    var menu = at ? shell.menus[at[0]] : null;
    if (!top || !menu || document.getElementById('app-side')) return;
    var wide = false;
    try { wide = window.matchMedia('(min-width: 1024px)').matches; } catch (e) { wide = false; }
    var cur = at[1];
    var byId = {};
    for (var i = 0; i < menu.items.length; i += 1) byId[menu.items[i][0]] = menu.items[i];
    var link = function (id, short) {
      var it = byId[id];
      var cut = short && !!it[3];
      var a = el('a', { class: 'side-link' + (id === cur ? ' is-on' : ''), id: 'side-' + id, href: it[1], 'data-menu': id });
      if (id === cur) a.setAttribute('aria-current', at[2] ? 'page' : 'true');
      if (cut) a.setAttribute('aria-label', it[2]);
      a.appendChild(el('span', { class: 'side-t' }, cut ? it[3] : it[2]));
      return a;
    };
    var side = el('aside', { class: 'side', id: 'app-side', 'data-early': '' });
    var nav = el('nav', { class: 'side-nav', id: 'side-nav', 'aria-label': 'תפריט ראשי' });
    var list = el('div', { class: 'side-list', id: 'side-list' });
    var n = 1;
    var ids = function (arr) { for (var x = 0; x < arr.length; x += 1) list.appendChild(link(arr[x], !wide)); };
    if (wide) {
      var logo = el('a', { class: 'side-logo', href: shell.home, 'aria-label': 'astrateg' });
      logo.appendChild(el('img', { src: 'app/assets/logo.png', alt: '', width: '403', height: '280' }));
      side.appendChild(logo);
      if (menu.rest.length) {
        ids(menu.daily);
        list.appendChild(el('small', { class: 'side-k side-k-rest', id: 'side-rest-h' }, 'עוד'));
        ids(menu.rest);
      } else {
        for (var w = 0; w < menu.items.length; w += 1) list.appendChild(link(menu.items[w][0], false));
      }
    } else if (menu.more.length) {
      ids(menu.bar);
      var more = el('button', { type: 'button', class: 'side-link side-more' + (menu.more.indexOf(cur) >= 0 ? ' is-on' : ''), id: 'side-more', 'aria-expanded': 'false', 'aria-controls': 'side-sheet' });
      more.appendChild(el('span', { class: 'side-t' }, 'עוד'));
      list.appendChild(more);
      n = menu.bar.length + 1;
    } else {
      for (var b = 0; b < menu.items.length; b += 1) list.appendChild(link(menu.items[b][0], true));
      n = Math.max(1, menu.items.length);
    }
    side.style.setProperty('--bar-n', String(n));
    nav.appendChild(el('span', { class: 'side-rail', id: 'side-rail', 'aria-hidden': 'true' }));
    nav.appendChild(el('small', { class: 'side-k' }, 'תפריט'));
    nav.appendChild(list);
    side.appendChild(nav);
    top.parentNode.insertBefore(side, top);
    document.body.classList.add('has-shell');
    if (menu.items.length > 1) document.body.classList.add('has-tabbar');
    root.setAttribute('data-profile', at[0] === '-' ? '' : at[0]);
    // The top bar: the profile button, the name and the avatar (app/shell.js mountSwitch, mountUser).
    var session = top.querySelector('.session');
    if (session && menu.sw && !document.getElementById('profile-switch')) {
      var sw = el('a', { class: 'profile-switch', id: 'profile-switch', href: menu.sw[2], 'data-to': menu.sw[0], 'data-early': '' }, menu.sw[1]);
      session.parentNode.insertBefore(sw, session);
    }
    if (session && shell.who && !session.querySelector('.ds-av')) {
      session.appendChild(el('span', { class: 'who-name', id: 'who-name', 'data-early': '' }, shell.who[0]));
      session.appendChild(el('span', { class: 'ds-av', style: '--av:' + shell.who[2], title: shell.who[0], 'aria-hidden': 'true', 'data-early': '' }, shell.who[1]));
    }
    // The way out stands in the same bar, and would push the rest aside when it appears.
    var out = document.getElementById('btn-logout');
    if (out && out.hidden) { out.hidden = false; out.setAttribute('data-early-shown', ''); }
    watchSignIn();
  }
  // The page shows the sign-in screen after all (the session ended): no frame around it.
  function undraw() {
    var early = document.querySelectorAll('[data-early]');
    for (var i = 0; i < early.length; i += 1) early[i].parentNode.removeChild(early[i]);
    var out = document.querySelector('[data-early-shown]');
    if (out) { out.hidden = true; out.removeAttribute('data-early-shown'); }
    if (!document.getElementById('app-side')) { document.body.classList.remove('has-shell'); document.body.classList.remove('has-tabbar'); }
  }
  function watchSignIn() {
    var block = document.getElementById('login-block');
    if (!block || typeof MutationObserver !== 'function') return;
    var seen = new MutationObserver(function () { if (!block.hidden) { seen.disconnect(); undraw(); } });
    seen.observe(block, { attributes: true, attributeFilter: ['hidden'] });
  }
  // The body is not there yet when this runs. The frame goes in the moment the parser
  // reaches the page's <main> (the top bar before it is whole by then), which is before
  // the first paint: the styles in <head> still hold the paint back.
  if (typeof MutationObserver !== 'function') return;
  var ready = function () { return !!document.querySelector('header.topbar') && !!document.querySelector('main'); };
  if (ready()) { draw(); return; }
  var parsed = new MutationObserver(function () { if (ready()) { parsed.disconnect(); draw(); } });
  parsed.observe(root, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', function () { parsed.disconnect(); if (!document.getElementById('app-side')) draw(); });
}());
