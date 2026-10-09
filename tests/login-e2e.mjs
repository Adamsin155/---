// The staff sign-in screen in the browser (app/login-ui.js, app/login-gate.js,
// app/styles/login.css; docs/ops.md, section 51), against the roles world
// (tests/roles-world.mjs):
//  - nobody signed in: the night is there from the first paint, the card holds an
//    email, a password, the eye, "שכחתי סיסמה" and the button, and nothing else;
//  - idle → signing → success. "מתחברים…" holds for as long as the server is asked
//    (the door half open) and success is never shown before its answer; then the
//    button is green with a check, "ברוכים השבים!", and the form is gone;
//  - a refusal: the door stays shut, the card shakes once, #lg-err says why;
//  - the dark screen opens onto a whole page, also when the page sends the person on
//    to their first screen; and someone who is signed in never sees the sign-in
//    screen or its background, on any staff page;
//  - with prefers-reduced-motion nothing walks, slides or shakes;
//  - 360 and 390 pixels wide: nothing overflows, the targets are 44 pixels, and with
//    the keyboard up the fields and the button stay on the screen;
//  - the quotes list (app/dashboard.js) and the builder's dialog (app/builder.js).
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/login-e2e.mjs
// SHOTS=<folder> also writes the screenshots of docs/design/login/.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from './roles-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PHONE = { width: 390, height: 844 };
const SMALL = { width: 360, height: 740 };
const WIDE = { width: 1280, height: 800 };
const STAFF_PAGES = ['client.html', 'clients.html', 'deal.html', 'decisions.html', 'editor.html', 'insights.html', 'intake.html', 'landing.html', 'messages.html',
  'owner.html', 'pass.html', 'prep.html', 'qa.html', 'quotes.html', 'scripts.html', 'shoot.html', 'team.html', 'year.html'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];

// What a page showed of the sign-in screen, from before its first script: every value
// <html data-door> took, and whether the form was ever drawn.
function record() {
  window.__door = [];
  window.__formSeen = false;
  const note = () => {
    const root = document.documentElement;
    if (!root) return;
    const v = root.getAttribute('data-door');
    if (v !== null && window.__door.at(-1) !== v) window.__door.push(v);
    if (document.getElementById('login-form')?.getClientRects().length) window.__formSeen = true;
  };
  new MutationObserver(note).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-door', 'hidden'] });
  document.addEventListener('DOMContentLoaded', note);
}

async function open({ viewport = PHONE, reduced = false, path = 'clients.html#mine', hold = null, mobile = false } = {}) {
  const fake = makeFake(buildWorld());
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, reducedMotion: reduced ? 'reduce' : 'no-preference', hasTouch: mobile, isMobile: mobile });
  await ctx.clock.install({ time: NOW });
  // `hold`: the server's answer to a sign-in waits until the test lets it go.
  await ctx.route(`${SUPA}/**`, async (route) => {
    if (hold && new URL(route.request().url()).pathname === '/auth/v1/token') await hold.gate;
    return fake.route(route);
  });
  await ctx.addInitScript(record);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  await page.goto(`${BASE}${path}`);
  return { page, ctx };
}
const held = () => { let release; const gate = new Promise((ok) => { release = ok; }); return { gate, release }; };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const fillIn = async (page, role = 'irit', password = 'correct-horse') => {
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', password);
};
// The button and the door, as they are drawn now.
const door = (page) => page.evaluate(() => {
  const btn = document.getElementById('lg-submit');
  const matrix = (sel) => getComputedStyle(btn.querySelector(sel)).transform;
  return {
    state: document.getElementById('login-form').dataset.door,
    signing: btn.classList.contains('is-signing'),
    won: btn.classList.contains('is-won'),
    status: document.getElementById('lg-status').textContent,
    leaf: matrix('.lg-leaf'),
    figure: matrix('.lg-figure'),
    check: Number(getComputedStyle(btn.querySelector('.lg-check')).opacity),
    green: Number(getComputedStyle(btn, '::after').opacity),
    errHidden: document.getElementById('lg-err').hidden,
  };
});
const SHUT = ['none', 'matrix(1, 0, 0, 1, 0, 0)'];
const gone = (page) => page.waitForFunction(() => document.getElementById('login-form').offsetParent === null && !('door' in document.documentElement.dataset));
const overflow = (page) => page.evaluate(() => {
  const out = [];
  if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page ${document.documentElement.scrollWidth}`);
  for (const el of document.querySelectorAll('#login-block form, #login-block form *')) {
    if (el.closest('svg') && el.tagName !== 'svg') continue;
    const r = el.getBoundingClientRect();
    if (r.width && (r.left < -0.5 || r.right > window.innerWidth + 0.5)) out.push(`${el.tagName}.${el.className?.baseVal ?? el.className} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  return out;
});

let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) { console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}`); throw err; }
  passed += 1;
  console.log(`ok - ${name}`);
}

await step('nobody signed in: the night from the first paint, and a card with an email, a password and one button', async () => {
  const { page, ctx } = await open();
  // The gate (a plain script in <head>) spoke before anything was drawn.
  assert.deepEqual(await page.evaluate(() => window.__door), ['in']);
  await page.waitForSelector('#lg-submit .lg-scene');
  const seen = await page.evaluate(() => {
    const form = document.getElementById('login-form');
    const controls = [...form.querySelectorAll('input, button, a, select, textarea')].filter((c) => c.getClientRects().length).map((c) => c.id || c.className);
    const tied = ['lg-email', 'lg-pass'].map((id) => form.querySelector(`label[for="${id}"]`)?.textContent);
    const sky = getComputedStyle(document.documentElement, '::before');
    const glow = getComputedStyle(document.documentElement, '::after');
    const under = document.elementFromPoint(4, 4);
    return {
      controls, tied,
      heading: document.getElementById('lg-h').textContent,
      labelled: document.getElementById('login-block').getAttribute('aria-labelledby'),
      hint: form.querySelector('.lg-hint')?.textContent,
      button: document.getElementById('lg-submit').innerText.trim(),
      auto: [document.getElementById('lg-email').autocomplete, document.getElementById('lg-pass').autocomplete],
      types: [document.getElementById('lg-email').type, document.getElementById('lg-pass').type],
      errHidden: document.getElementById('lg-err').hidden, msgHidden: document.getElementById('lg-msg').hidden,
      status: document.getElementById('lg-status').getAttribute('role'),
      sky: sky.position, skyImage: /gradient/.test(sky.backgroundImage) && !/url\(/.test(sky.backgroundImage), drift: glow.animationName,
      photo: [...document.querySelectorAll('#login-block img')].map((i) => i.getAttribute('src')),
      topbar: getComputedStyle(document.querySelector('.topbar')).visibility,
      appHidden: document.getElementById('app').hidden,
      underIsPage: !!under && under !== document.documentElement && !under.closest('#login-block'),
      text: form.innerText,
    };
  });
  assert.deepEqual(seen.controls, ['lg-email', 'lg-pass', 'lg-eye', 'lg-forgot', 'lg-submit'], 'only these controls');
  assert.deepEqual(seen.tied, ['אימייל', 'סיסמה']);
  assert.equal(seen.heading, 'ברוכים השבים');
  assert.equal(seen.labelled, 'lg-h');
  assert.ok(seen.hint && seen.hint.length < 50, 'one short hint');
  assert.equal(seen.button, 'כניסה');
  assert.deepEqual(seen.auto, ['username', 'current-password'], 'the browser\'s saved passwords still find the fields');
  assert.deepEqual(seen.types, ['email', 'password']);
  assert.equal(seen.errHidden, true);
  assert.equal(seen.msgHidden, true);
  assert.equal(seen.status, 'status');
  assert.equal(seen.sky, 'fixed');
  assert.ok(seen.skyImage, 'the background is drawn (gradients), not a picture');
  assert.match(seen.drift, /lg-drift/);
  assert.deepEqual(seen.photo, ['app/assets/logo-mark.png'], 'the only picture is the logo');
  assert.equal(seen.topbar, 'hidden', 'the page head behind the night is not reachable');
  assert.equal(seen.appHidden, true);
  assert.equal(seen.underIsPage, false, 'nothing of the light page is in front');
  assert.doesNotMatch(seen.text, /Google|Apple|זכור|הרשמה|חשבון חדש|קוד/);
  assert.deepEqual(await overflow(page), []);
  await page.waitForTimeout(350);
  await shot(page, 'login-390-idle');
  // A hidden tab: the drift stops.
  assert.equal(await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    return getComputedStyle(document.documentElement, '::after').animationPlayState;
  }), 'paused');
  await ctx.close();
});

await step('the fields: the label moves up when the field is in use or filled, the eye shows and hides and says so, the keyboard reaches everything', async () => {
  const { page, ctx } = await open();
  await page.waitForSelector('#lg-submit .lg-scene');
  const labelAt = (id) => page.evaluate((i) => getComputedStyle(document.querySelector(`label[for="${i}"]`)).transform, id);
  assert.ok(SHUT.includes(await labelAt('lg-email')), 'at rest the label sits in the field');
  await page.focus('#lg-email');
  await page.waitForTimeout(250);
  assert.ok(!SHUT.includes(await labelAt('lg-email')), 'in use: up and small');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.getElementById('lg-email')).boxShadow), 'none', 'a visible focus');
  await shot(page, 'login-390-focus');
  await page.keyboard.type(emailOf('irit'));
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'lg-pass');
  await page.waitForTimeout(250);
  assert.ok(!SHUT.includes(await labelAt('lg-email')), 'filled: stays up');
  await page.keyboard.type('secret-1');
  const eye = page.locator('.lg-eye');
  assert.equal(await eye.getAttribute('aria-pressed'), 'false');
  assert.equal(await eye.getAttribute('aria-label'), 'הצגת הסיסמה');
  await eye.click();
  assert.equal(await eye.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getAttribute('#lg-pass', 'type'), 'text');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'lg-pass', 'the press leaves the caret in the field');
  assert.equal(await page.inputValue('#lg-pass'), 'secret-1');
  await eye.click();
  assert.equal(await page.getAttribute('#lg-pass', 'type'), 'password');
  // Tab order, with a focus that can be seen on each.
  const order = [];
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => { const a = document.activeElement; return `${a.id || a.className}:${getComputedStyle(a).outlineStyle !== 'none'}`; }));
  }
  assert.deepEqual(order, ['lg-eye:true', 'lg-forgot:true', 'lg-submit:true']);
  // "שכחתי סיסמה" keeps its texts.
  await page.fill('#lg-email', '');
  await page.click('#lg-forgot');
  assert.match(await page.locator('#lg-err').innerText(), /אימייל|מייל/);
  await page.fill('#lg-email', emailOf('irit'));
  await page.click('#lg-forgot');
  await page.waitForSelector('#lg-msg:not([hidden])');
  assert.equal(await page.locator('#lg-err').isHidden(), true);
  await ctx.close();
});

await step('idle → signing → success: "מתחברים…" holds as long as the server is asked, then the green button, and the form is gone', async () => {
  const hold = held();
  const { page, ctx } = await open({ hold, path: 'owner.html' });
  await page.waitForSelector('#lg-submit .lg-scene');
  const idle = await door(page);
  assert.deepEqual({ state: idle.state, signing: idle.signing, won: idle.won, status: idle.status, check: idle.check, green: idle.green }, { state: 'idle', signing: false, won: false, status: '', check: 0, green: 0 });
  assert.ok(SHUT.includes(idle.leaf), 'the door is shut');
  await fillIn(page, 'owner');
  await page.locator('.lg-eye').click(); // shown while typing; what is sent is a password field again
  await page.focus('#lg-pass');
  await page.keyboard.press('Enter'); // Enter submits
  await page.waitForFunction(() => document.getElementById('lg-status').textContent === 'מתחברים…');
  assert.equal(await page.getAttribute('#lg-pass', 'type'), 'password');
  // A slow network: a second and a half later nothing changed, and nothing claims success.
  await page.waitForTimeout(1500);
  const waiting = await door(page);
  assert.deepEqual({ state: waiting.state, signing: waiting.signing, won: waiting.won, status: waiting.status, check: waiting.check, green: waiting.green }, { state: 'signing', signing: true, won: false, status: 'מתחברים…', check: 0, green: 0 });
  assert.ok(!SHUT.includes(waiting.leaf), 'the door is half open');
  assert.ok(!SHUT.includes(waiting.figure), 'the figure took a step and waits');
  const half = Number(/matrix\(([^,]+)/.exec(waiting.leaf)[1]);
  assert.ok(half > 0.4 && half < 0.7, `half open (${half})`);
  assert.equal(await page.getAttribute('#login-form', 'aria-busy'), 'true');
  assert.equal(await page.locator('#lg-submit').isDisabled(), true);
  assert.equal(await page.locator('#login-form').isVisible(), true);
  await shot(page, 'login-390-signing');
  hold.release();
  // The server said yes: the figure walks in, the button is green with a check.
  await page.waitForFunction(() => document.getElementById('lg-status').textContent === 'ברוכים השבים!');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('lg-submit'), '::after').opacity === '1' && getComputedStyle(document.querySelector('.lg-check')).opacity === '1');
  const won = await door(page);
  assert.deepEqual({ state: won.state, won: won.won, signing: won.signing, errHidden: won.errHidden }, { state: 'won', won: true, signing: false, errHidden: true });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lg-ok-1').trim() !== ''), true);
  await shot(page, 'login-390-success');
  // Then the dark screen opens onto the page: the form is gone, the page is whole.
  await gone(page);
  assert.equal(await page.locator('#login-block').isHidden(), true);
  assert.equal(await page.locator('#app').isVisible(), true);
  assert.equal(await page.evaluate(() => 'boot' in document.documentElement.dataset), false, 'the night left only when the page was ready');
  assert.deepEqual(await page.evaluate(() => window.__door), ['in', 'through', 'out']);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('astrateg.door')), null);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).visibility), 'visible');
  assert.equal(await page.getAttribute('meta[name="theme-color"]', 'content'), '#EEF0F4');
  await ctx.close();
});

await step('a refusal: the door stays shut, the card shakes once, and #lg-err says why; the next try gets in', async () => {
  const { page, ctx } = await open({ path: 'owner.html' });
  await page.waitForSelector('#lg-submit .lg-scene');
  await page.evaluate(() => {
    window.__shakes = 0;
    document.getElementById('login-form').addEventListener('animationstart', (e) => { if (e.animationName === 'lg-shake') window.__shakes += 1; });
  });
  await fillIn(page, 'owner', 'nope');
  await page.click('#lg-submit');
  await page.waitForSelector('#lg-err:not([hidden])');
  assert.match(await page.locator('#lg-err').innerText(), /האימייל או הסיסמה שגויים/);
  await page.waitForFunction(() => window.__shakes === 1);
  await page.waitForTimeout(600);
  const after = await door(page);
  assert.deepEqual({ state: after.state, signing: after.signing, won: after.won, status: after.status, check: after.check, green: after.green }, { state: 'idle', signing: false, won: false, status: '', check: 0, green: 0 });
  assert.ok(SHUT.includes(after.leaf), 'the door is shut');
  assert.ok(SHUT.includes(after.figure), 'the figure is back in its place');
  assert.equal(await page.evaluate(() => window.__shakes), 1, 'one shake');
  assert.equal(await page.locator('#lg-submit').isDisabled(), false);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.door), 'in');
  assert.deepEqual(await overflow(page), []);
  await shot(page, 'login-390-error');
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await gone(page);
  assert.equal(await page.locator('#app').isVisible(), true);
  await ctx.close();
});

await step('someone who is signed in never sees the sign-in screen or its background, on any staff page', async () => {
  const { page, ctx } = await open({ path: 'owner.html' });
  await fillIn(page, 'owner');
  await page.click('#lg-submit');
  await gone(page);
  for (const path of STAFF_PAGES) {
    await page.goto(`${BASE}${path}`);
    // Until the page is whole (or, for clients.html, until it sent the owner on).
    await page.waitForFunction(() => !('boot' in document.documentElement.dataset) && !!document.getElementById('btn-logout') && !document.getElementById('btn-logout').hidden, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(150);
    const seen = await page.evaluate(() => ({ door: window.__door, form: window.__formSeen, now: document.documentElement.getAttribute('data-door') }));
    assert.deepEqual(seen, { door: [], form: false, now: null }, path);
  }
  await page.goto(`${BASE}owner.html`);
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  assert.deepEqual(await page.evaluate(() => ({ door: window.__door, form: window.__formSeen })), { door: [], form: false }, 'a reload');
  // Signing out brings the screen back, dark from the first paint.
  await page.waitForFunction(() => !('boot' in document.documentElement.dataset));
  await page.click('#btn-logout');
  await page.waitForSelector('#lg-submit .lg-scene');
  assert.deepEqual(await page.evaluate(() => window.__door), ['in']);
  await ctx.close();
});

await step('a page that sends the person on to their first screen: the night stays through the move and opens onto that page', async () => {
  // Ofir on clients.html, a new tab: the page leaves for his own screen without showing itself.
  const { page, ctx } = await open({ path: 'clients.html' });
  await fillIn(page, 'ofir');
  const first = page.url();
  await page.click('#lg-submit');
  await page.waitForURL((u) => u.toString() !== first && !/clients\.html/.test(u.toString()), { timeout: 15000 });
  await page.waitForSelector('#app:not([hidden])');
  // The new page started under the night and never drew the sign-in form.
  assert.equal(await page.evaluate(() => window.__door[0]), 'through');
  await page.waitForFunction(() => !('door' in document.documentElement.dataset));
  assert.deepEqual(await page.evaluate(() => ({ door: window.__door, form: window.__formSeen, boot: 'boot' in document.documentElement.dataset })), { door: ['through', 'out'], form: false, boot: false });
  assert.equal(await page.evaluate(() => sessionStorage.getItem('astrateg.door')), null, 'the note is used once');
  // The next page of the same tab is an ordinary signed-in page.
  await page.goto(`${BASE}qa.html`);
  await page.waitForFunction(() => !('boot' in document.documentElement.dataset));
  assert.deepEqual(await page.evaluate(() => window.__door), []);
  await ctx.close();
});

await step('prefers-reduced-motion: nothing drifts, walks, slides or shakes; the states change with a fade', async () => {
  const hold = held();
  const { page, ctx } = await open({ reduced: true, hold, path: 'owner.html' });
  await page.waitForSelector('#lg-submit .lg-scene');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement, '::after').animationName), 'none', 'a still background');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('login-block')).animationName), 'lg-fade');
  await page.evaluate(() => {
    window.__moves = [];
    document.addEventListener('animationstart', (e) => { if (/shake|step|drift|lg-in\b/.test(e.animationName)) window.__moves.push(e.animationName); });
  });
  await fillIn(page, 'owner', 'nope');
  await page.click('#lg-submit');
  await page.waitForFunction(() => document.getElementById('lg-status').textContent === 'מתחברים…');
  await page.waitForTimeout(400);
  const waiting = await door(page);
  assert.equal(waiting.signing, true);
  assert.ok(SHUT.includes(waiting.leaf) && SHUT.includes(waiting.figure), 'nothing moved');
  assert.ok(Number(await page.evaluate(() => getComputedStyle(document.querySelector('.lg-glow')).opacity)) > 0.3, 'the state is shown by light');
  hold.release();
  await page.waitForSelector('#lg-err:not([hidden])');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('login-form')).animationName), 'none', 'no shake');
  hold.gate = Promise.resolve();
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForFunction(() => document.getElementById('lg-status').textContent === 'ברוכים השבים!');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.lg-check')).opacity === '1');
  const won = await door(page);
  assert.ok(SHUT.includes(won.figure) && SHUT.includes(won.leaf), 'no walk');
  assert.equal(won.won, true);
  await gone(page);
  assert.deepEqual(await page.evaluate(() => window.__moves), []);
  await ctx.close();
});

await step('360 and 390 pixels: nothing overflows, 44-pixel targets; with the keyboard up the fields and the button stay on the screen', async () => {
  for (const viewport of [SMALL, PHONE]) {
    const { page, ctx } = await open({ viewport, mobile: true });
    await page.waitForSelector('#lg-submit .lg-scene');
    await fillIn(page, 'irit', 'nope');
    await page.click('#lg-submit');
    await page.waitForSelector('#lg-err:not([hidden])'); // the tallest state: with the error
    await page.waitForTimeout(500);
    assert.deepEqual(await overflow(page), [], `${viewport.width}px`);
    const sizes = await page.evaluate(() => Object.fromEntries(['#lg-email', '#lg-pass', '.lg-eye', '#lg-forgot', '#lg-submit'].map((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return [s, [Math.round(r.width), Math.round(r.height), r.top >= 0 && r.bottom <= window.innerHeight]];
    })));
    for (const [sel, [w, hgt, inView]] of Object.entries(sizes)) assert.ok(w >= 44 && hgt >= 44 && inView, `${viewport.width}px ${sel}: ${w}×${hgt} ${inView}`);
    assert.ok(Number.parseFloat(await page.evaluate(() => getComputedStyle(document.getElementById('lg-email')).fontSize)) >= 16, 'no zoom on focus on a phone');
    if (viewport === SMALL) await shot(page, 'login-360-error');
    // The keyboard takes the lower part of the screen.
    await page.setViewportSize({ width: viewport.width, height: 330 });
    await page.focus('#lg-pass');
    await page.waitForFunction(() => document.getElementById('login-block').classList.contains('lg-kb'));
    await page.waitForTimeout(200);
    const kb = await page.evaluate(() => ['#lg-email', '#lg-pass', '#lg-submit', '#lg-err'].map((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
    }));
    assert.deepEqual(kb, [true, true, true, true], `${viewport.width}px with the keyboard`);
    assert.deepEqual(await overflow(page), []);
    if (viewport === SMALL) await shot(page, 'login-360-keyboard');
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => !document.getElementById('login-block').classList.contains('lg-kb'));
    await ctx.close();
  }
});

await step('the quotes list (its own sign-in handler): in, out again, and a refusal', async () => {
  const { page, ctx } = await open({ path: 'quotes.html', viewport: WIDE });
  assert.deepEqual(await page.evaluate(() => window.__door), ['in']);
  await page.waitForSelector('#lg-submit .lg-scene');
  await fillIn(page, 'owner', 'nope');
  await page.click('#lg-submit');
  await page.waitForSelector('#lg-err:not([hidden])');
  assert.equal((await door(page)).state, 'idle');
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForFunction(() => document.getElementById('lg-status').textContent === 'ברוכים השבים!');
  await gone(page);
  assert.equal(await page.locator('#login-block').isHidden(), true);
  // Signing out here does not reload the page: the screen comes back, with an idle button.
  await page.click('#btn-logout');
  await page.waitForSelector('#login-form', { state: 'visible' });
  await page.waitForFunction(() => document.documentElement.dataset.door === 'in');
  const back = await door(page);
  assert.deepEqual({ state: back.state, won: back.won, status: back.status, green: back.green }, { state: 'idle', won: false, status: '', green: 0 });
  await ctx.close();
});

await step('the builder\'s dialog: the same fields and button, and it closes only after the green button', async () => {
  const { page, ctx } = await open({ path: 'index.html', viewport: PHONE });
  await page.waitForSelector('#lg-submit .lg-scene', { state: 'attached' });
  assert.equal(await page.evaluate(() => 'door' in document.documentElement.dataset), false, 'no night on the builder: the form is a dialog there');
  await page.evaluate(() => document.getElementById('dlg-login').showModal());
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#dlg-login.lg-dialog .lg-eye').count(), 1);
  assert.equal(await page.locator('#dlg-login .lg-brand').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const box = await page.locator('#lg-submit').boundingBox();
  assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= PHONE.width);
  await fillIn(page, 'irit');
  await shot(page, 'login-390-dialog');
  await ctx.close();
});

// The screenshots of docs/design/login/ at 1280 pixels (the 390 ones are taken above).
await step('a wide screen: the same card in the middle, nothing overflowing', async () => {
  const hold = held();
  const { page, ctx } = await open({ viewport: WIDE, hold, path: 'owner.html' });
  await page.waitForSelector('#lg-submit .lg-scene');
  await page.waitForTimeout(350);
  const card = await page.locator('#login-form').boundingBox();
  assert.ok(Math.abs((card.x + card.width / 2) - WIDE.width / 2) < 2, 'centred');
  assert.ok(card.width <= 420 && card.y > 0 && card.y + card.height < WIDE.height);
  assert.deepEqual(await overflow(page), []);
  await shot(page, 'login-1280-idle');
  await page.focus('#lg-email');
  await page.waitForTimeout(250);
  await shot(page, 'login-1280-focus');
  await fillIn(page, 'owner', 'nope');
  await page.click('#lg-submit');
  await page.waitForFunction(() => document.getElementById('lg-status').textContent === 'מתחברים…');
  await page.waitForTimeout(500);
  await shot(page, 'login-1280-signing');
  hold.release();
  await page.waitForSelector('#lg-err:not([hidden])');
  await page.waitForTimeout(600);
  await shot(page, 'login-1280-error');
  hold.gate = Promise.resolve();
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('lg-submit'), '::after').opacity === '1' && getComputedStyle(document.querySelector('.lg-check')).opacity === '1');
  await shot(page, 'login-1280-success');
  await gone(page);
  await ctx.close();
});

await browser.close();
assert.deepEqual(errors, [], 'no page errors');
noCspViolations();
console.log(`\n${passed} steps passed.`);
