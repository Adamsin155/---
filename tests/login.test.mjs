// The staff sign-in screen (docs/ops.md, section 51), without a browser: the small form
// shell the pages keep, the gate that decides the first paint (app/login-gate.js), what
// the publish carries, and the rules of the stylesheet. The browser side is
// tests/login-e2e.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readdirSync, readFileSync } from 'node:fs';
import { publishEdits, scriptsOf } from '../scripts/build-pages.mjs';
import { loginDoor, LOGIN_TEXT, LOGIN_TIMES } from '../app/login-ui.js';

const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const PAGES = readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const WITH_FORM = PAGES.filter((p) => read(p).includes('id="login-form"'));
// The form is a dialog in the builder (index.html); gantt.html is also the client's page.
const SCREENS = WITH_FORM.filter((p) => p !== 'index.html');
const GATED = SCREENS.filter((p) => p !== 'gantt.html');
const GATE = '<script src="app/login-gate.js"></script>';
const SHEET = '<link rel="stylesheet" href="app/styles/login.css">';

test('the twenty pages keep one small form shell; the rest is built in one place', () => {
  assert.equal(WITH_FORM.length, 20);
  const shells = new Set();
  for (const page of SCREENS) {
    const html = read(page);
    const shell = /<section class="block" id="login-block" hidden aria-labelledby="lg-h">([\s\S]*?)<\/section>/.exec(html)?.[1];
    assert.ok(shell, `${page}: the sign-in block, hidden until the page knows nobody is signed in`);
    shells.add(shell.replace(/\s+/g, ' ').trim());
  }
  assert.equal(shells.size, 1, 'the same shell on every page');
  const [shell] = shells;
  assert.ok(shell.length < 900, 'a small shell');
  // What the tests, the handlers and the browser's saved passwords lean on.
  assert.match(shell, /<form class="login" id="login-form" novalidate>/);
  assert.match(shell, /<label for="lg-email">אימייל<\/label><input class="input" id="lg-email" type="email" dir="ltr" autocomplete="username" required>/);
  assert.match(shell, /<label for="lg-pass">סיסמה<\/label><input class="input" id="lg-pass" type="password" dir="ltr" autocomplete="current-password" required>/);
  assert.match(shell, /<div class="err" id="lg-err" role="alert" hidden><\/div>/);
  assert.match(shell, /<div class="note-ok" id="lg-msg" role="status" hidden><\/div>/);
  assert.match(shell, /<button type="submit" class="btn btn-primary" id="lg-submit">כניסה<\/button>/);
  assert.match(shell, /<button type="button" class="btn-text" id="lg-forgot">שכחתי סיסמה<\/button>/);
  assert.match(shell, new RegExp(`<h2 id="lg-h">${LOGIN_TEXT.heading}</h2>`));
  // Not on this screen: an account to create, another provider, "remember me", a code.
  assert.equal((shell.match(/<(input|button|a|select)\b/g) || []).length, 4);
  assert.doesNotMatch(shell, /checkbox|Google|Apple|otp|one-time-code/i);
  // The builder's dialog keeps the same fields.
  const dialog = /<dialog id="dlg-login"[\s\S]*?<\/dialog>/.exec(read('index.html'))[0];
  for (const need of ['id="login-form"', 'id="lg-email" type="email" dir="ltr" autocomplete="username"', 'id="lg-pass" type="password" dir="ltr" autocomplete="current-password"', 'id="lg-err" role="alert" hidden', 'id="lg-submit"', 'id="lg-forgot"']) assert.ok(dialog.includes(need), need);
  assert.doesNotMatch(dialog, /style="/);
});

test('every page with the form takes the stylesheet; the gate is a plain script in the head of the staff pages, and nowhere else', () => {
  for (const page of PAGES) {
    const html = read(page);
    const head = html.slice(0, html.indexOf('</head>'));
    assert.equal(head.includes(SHEET), WITH_FORM.includes(page), `${page}: login.css`);
    assert.equal(html.includes('login-gate.js'), GATED.includes(page), `${page}: the gate`);
    if (!GATED.includes(page)) continue;
    assert.equal(html.split(GATE).length, 2, page);
    // In the head, after the frame guard and before anything is drawn (not a module, not deferred).
    assert.ok(head.indexOf('app/frame-guard.js') < head.indexOf(GATE) && head.indexOf(GATE) > 0, page);
    assert.ok(head.indexOf(GATE) < head.indexOf('rel="stylesheet"'), `${page}: before the styles`);
  }
  // The client's pages know nothing of it.
  for (const page of ['q.html', 'status.html', 'gallery.html', 'scripts-view.html', 'access.html']) assert.doesNotMatch(read(page), /login-gate|login\.css/, page);
  // The payments app takes the look of the screen (the owner's decision of 10.10.2026;
  // docs/ops.md, section 56): the same stylesheet, and a gate of its own, because it keeps
  // its own session under its own key. The staff gate and the staff module stay out of it.
  const pay = read('payouts/index.html');
  const payHead = pay.slice(0, pay.indexOf('</head>'));
  assert.ok(payHead.includes('<link rel="stylesheet" href="../app/styles/login.css">'), 'payouts: login.css');
  assert.ok(payHead.indexOf('../app/frame-guard.js') < payHead.indexOf('<script src="../app/payouts/gate.js"></script>'), 'payouts: its gate, after the frame guard');
  assert.ok(payHead.indexOf('../app/payouts/gate.js') < payHead.indexOf('rel="stylesheet"'), 'payouts: the gate before the styles');
  assert.doesNotMatch(pay, /login-gate|login-ui/, 'payouts: not the staff gate, not the staff module');
  assert.match(read('app/payouts/gate.js'), /getItem\('astrateg-payment-auth'\)/);
  assert.doesNotMatch(read('app/payouts/gate.js'), /\b(import|export|let|const|=>)\b/, 'a plain script');
});

// The gate, run as the browser runs it: a plain script with the page's storage.
function gate({ local = {}, session = {}, broken = false } = {}) {
  const attrs = {};
  const storage = (data) => ({
    get length() { if (broken) throw new Error('denied'); return Object.keys(data).length; },
    key: (i) => Object.keys(data)[i] ?? null,
    getItem: (k) => { if (broken) throw new Error('denied'); return k in data ? data[k] : null; },
    removeItem: (k) => { delete data[k]; },
  });
  const window = { localStorage: storage(local), sessionStorage: storage(session) };
  vm.runInNewContext(read('app/login-gate.js'), { window, document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } } });
  return { attrs, session };
}

test('the gate: the night for a device with no session, nothing for someone signed in, and one more moment right after signing in', () => {
  const KEY = 'sb-czncjzziqrqtezpwxxpz-auth-token';
  assert.deepEqual(gate().attrs, { 'data-door': 'in' });
  assert.deepEqual(gate({ local: { 'astrateg.mode': 'manager', 'status.name': 'דנה' } }).attrs, { 'data-door': 'in' });
  // Signed in: no attribute at all, so nothing of the sign-in screen is drawn.
  assert.deepEqual(gate({ local: { [KEY]: '{}' } }).attrs, {});
  // The note of app/login-ui.js is read once.
  const after = gate({ local: { [KEY]: '{}' }, session: { 'astrateg.door': '1' } });
  assert.deepEqual(after.attrs, { 'data-door': 'through' });
  assert.deepEqual(after.session, {});
  // A note with no session (signed out in between) is not a reason to wait behind the night.
  assert.deepEqual(gate({ session: { 'astrateg.door': '1' } }).attrs, { 'data-door': 'in' });
  // A browser that refuses storage keeps no session either.
  assert.deepEqual(gate({ broken: true }).attrs, { 'data-door': 'in' });
  // It reads whether a session is kept, and nothing of it.
  const src = read('app/login-gate.js');
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /getItem\([^N]|JSON\.parse|fetch|XMLHttpRequest|import/);
});

test('the publish carries the new files: the module in every staff page\'s preloads, all three on the device', () => {
  const files = new Map();
  const walk = (rel) => { for (const e of readdirSync(new URL(rel, ROOT), { withFileTypes: true })) { if (e.isDirectory()) walk(`${rel}${e.name}/`); else files.set(`${rel}${e.name}`, readFileSync(new URL(`${rel}${e.name}`, ROOT))); } };
  walk('app/');
  for (const page of PAGES) files.set(page, readFileSync(new URL(page, ROOT)));
  files.set('sw.js', readFileSync(new URL('sw.js', ROOT)));
  const edits = publishEdits(files);
  for (const page of WITH_FORM) {
    const html = edits.get(page).toString('utf8');
    // gantt.html is first the client's page: it asks for the staff's code only when someone signs in.
    if (page === 'gantt.html') { assert.ok(!html.includes('href="app/login-ui.js"'), 'the client\'s gantt does not fetch the sign-in screen'); continue; }
    assert.ok(html.includes('<link rel="modulepreload" href="app/login-ui.js">'), `${page}: app/login-ui.js is asked for with the rest`);
    const entry = /<script type="module" src="(app\/[^"]+)"/.exec(html)[1];
    assert.ok(scriptsOf(entry, files).includes('app/login-ui.js'), page);
  }
  const kept = JSON.parse(/^const BUILD = (\{.*\});$/m.exec(edits.get('sw.js').toString('utf8'))[1]).files;
  for (const file of ['app/login-ui.js', 'app/login-gate.js', 'app/styles/login.css']) assert.ok(kept[file], `${file} is kept on the device`);
});

test('the stylesheet: no picture and no other site, nothing blurred behind the card, a still version, and the first paint without the module', () => {
  const css = read('app/styles/login.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /url\(|@import|https?:/, 'pure CSS: no photo, no outside file');
  assert.doesNotMatch(css, /backdrop-filter|filter:\s*blur/, 'no blur over a moving background');
  // The night is drawn by <html data-door> alone, which the gate sets before the first paint.
  assert.match(css, /html\[data-door\]::before, html\[data-door\]::after \{[^}]*position: fixed/);
  assert.match(css, /html\[data-door-still\]::after \{ animation-play-state: paused; \}/);
  // It never stays over a page by itself, and never takes a press from the page under it.
  assert.match(css, /html\[data-door='through'\]::before \{ animation: lg-giveup/);
  assert.match(css, /html\[data-door\]::before, html\[data-door\]::after \{[^}]*pointer-events: none/);
  const still = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] || '';
  assert.match(still, /html\[data-door\]::after[^{]*\{ animation: none; \}/, 'no drift');
  assert.match(still, /\.lg-leaf, \.lg-figure, \.lg-check[^{]*\{ transform: none !important; \}/, 'no walk');
  assert.doesNotMatch(still, /lg-shake|lg-step|lg-drift 80s|translate|scale\(/);
  // Only transform and opacity move.
  for (const [, frames] of css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?\})\s*\}/g)) {
    for (const [, prop] of frames.matchAll(/[{;]\s*([a-z-]+):/g)) assert.ok(['transform', 'opacity'].includes(prop), `a keyframe moves ${prop}`);
  }
  // The brand's colours, by their tokens.
  for (const token of ['--ds-navy', '--ds-navy-2', '--ds-hot', '--ds-ok']) assert.ok(css.includes(`var(${token}`), token);
  assert.ok(css.includes('#5302DF'), 'the logo\'s purple (docs/brand/brand-guide.md)');
});

test('with no page (the unit tests load the pages\' modules) the door does nothing; the texts are the ones asked for', async () => {
  loginDoor.signing();
  loginDoor.failed();
  await loginDoor.success();
  assert.deepEqual(LOGIN_TEXT, { heading: 'ברוכים השבים', hint: LOGIN_TEXT.hint, signing: 'מתחברים…', welcome: 'ברוכים השבים!', show: 'הצגת הסיסמה' });
  assert.ok(LOGIN_TEXT.hint.length <= 40 && !/[:;]/.test(LOGIN_TEXT.hint), 'one short sentence');
  // A little over a second from the server's answer to the page.
  assert.ok(LOGIN_TIMES.welcomeAt < LOGIN_TIMES.beat && LOGIN_TIMES.beat + LOGIN_TIMES.lift <= 1300);
});
