// The phone bugs the owner found on his iPhone on 9.10.2026 (docs/ops.md, section 54), in
// the browser, against the late world (tests/late-world.mjs: clients in landing, Ilai's
// cards, every role). The iPhone's insets are simulated (59 above, 34 below).
//  1. Where a person lands: signing out as one role on page X and in as another lands on
//     that role's home; a new launch starts on the home in the personal profile with the
//     view back to its default; a deep link opened on purpose keeps the person, and one
//     that is not theirs sends them home instead of "אין לך גישה".
//  2. The sign-in screen with the keyboard up: the card is whole, with a margin; the page
//     itself is the night; the fields do not make the iPhone zoom.
//  3. The top safe area: the layer in the page's colour, on every staff page.
//  4. The tab rows: one line, one height, the chosen one fully in its row; the page never
//     scrolls sideways. The phone bar's long names have short ones.
//  5. The last thing of a page scrolls clear of the bottom bar.
//  6. "בקליטה" is one solid pill, never dashed.
//  7. Ilai's cards: nothing clipped from 360 to 1440, in the look of the kit, and the
//     clients in landing folded into counted lines.
//  8. Fields side by side stand on one line.
//  9. The upload blocks are in the look of the kit.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/phone-bugs-e2e.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, lateWorld, makeFlowFake, cid } from './late-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const IPHONE = { width: 390, height: 844 };
const IPHONE_15 = { width: 393, height: 852 };
const SMALL = { width: 360, height: 740 };
const WIDE = { width: 1280, height: 900 };
const INSETS = { top: 59, bottom: 34, left: 0, right: 0 };
const NIGHT = 'rgb(7, 20, 51)';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];

async function context({ viewport = IPHONE, db = lateWorld() } = {}) {
  const fake = makeFlowFake(db);
  const phone = viewport.width < 600;
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  return ctx;
}
async function tab(ctx, { insets = null } = {}) {
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  if (insets) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
  }
  return page;
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(300); };
// The page is whole: the menu is there, nothing is being built, and the sign-in screen is gone.
const shown = (page) => page.waitForFunction(() => !!document.getElementById('app-side')?.childElementCount
  && !document.documentElement.hasAttribute('data-boot') && !document.documentElement.hasAttribute('data-door')
  && document.getElementById('login-block')?.hidden !== false, null, { timeout: 20000 });
async function fillIn(page, role) {
  await page.waitForSelector('#lg-email:visible');
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await shown(page);
  await settle(page);
}
async function signIn(page, path, role) {
  await page.goto(`${BASE}${path}`);
  await fillIn(page, role);
}
async function signOut(page) {
  await page.evaluate(() => document.getElementById('btn-logout').click());
  await page.waitForSelector('#lg-email:visible', { timeout: 20000 });
}
const where = (page) => page.evaluate(() => `${location.pathname.split('/').pop()}${location.search}${location.hash}`);
const refused = (page) => page.evaluate(() => { const b = document.getElementById('no-access'); return !!b && !b.hidden; });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// ── 1. Where a person lands ─────────────────
const MINE = 'clients.html#mine';
await step('signing out as one role on page X and in as another: the second lands on their own home, never on X', async () => {
  // [who was there, the page they left, who signs in next, where that one lands]
  const PAIRS = [
    ['irit', 'messages.html', 'nadia', MINE],        // the owner's screenshot: an editor on the messages page
    ['owner', 'owner.html#all', 'eli', MINE],
    ['nadia', 'editor.html', 'irit', MINE],
    ['ofir', 'clients.html#control', 'lior', MINE],
    ['lior', 'decisions.html', 'ilai', MINE],
    ['irit', 'messages.html', 'stav', 'deal.html'],
    ['irit', `client.html?id=${cid(4)}`, 'yariv', MINE],
  ];
  for (const [first, path, second, home] of PAIRS) {
    const ctx = await context();
    const page = await tab(ctx);
    await signIn(page, path, first);
    await signOut(page);
    await fillIn(page, second).catch(async (e) => { throw new Error(`${second} after ${first} on ${path}: ${e.message.slice(0, 60)} ${JSON.stringify(await page.evaluate(() => ({ url: location.href, boot: document.documentElement.getAttribute('data-boot'), door: document.documentElement.getAttribute('data-door'), block: document.getElementById('login-block')?.hidden, side: document.getElementById('app-side')?.childElementCount, err: document.getElementById('lg-err')?.textContent })))}`); });
    await page.waitForFunction((h) => `${location.pathname.split('/').pop()}${location.hash}` === h || (h === 'deal.html' && location.pathname.endsWith('deal.html')), home, { timeout: 15000 });
    assert.equal(await refused(page), false, `${second} after ${first} on ${path}: "אין לך גישה"`);
    if (home === MINE) {
      assert.equal(await page.getAttribute('#tab-mine', 'aria-selected'), 'true', `${second}: the first tab`);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.profile || 'mine'), 'mine', `${second}: the personal profile`);
    }
    // Signing out left nothing of the place behind.
    await signOut(page);
    assert.deepEqual(await page.evaluate(() => ({ visit: sessionStorage.getItem('astrateg.visit'), profile: sessionStorage.getItem('astrateg.profile'), old: localStorage.getItem('astrateg.profile'), full: sessionStorage.getItem('astrateg.mine.full') })),
      { visit: 'out', profile: null, old: null, full: null }, `${second}: after signing out`);
    await ctx.close();
  }
});

await step('the field sales after an office user, and an office user after the field sales', async () => {
  const ctx = await context();
  const page = await tab(ctx);
  await signIn(page, 'deal.html', 'stav');
  assert.equal(await page.locator('#deal-form').isVisible(), true);
  await signOut(page);
  await fillIn(page, 'irit');
  await page.waitForFunction(() => location.pathname.endsWith('clients.html'));
  assert.equal(await where(page), MINE);
  assert.equal(await refused(page), false);
  await ctx.close();
});

await step('the editors, Nirel and Eli stay on "המשימות שלי" when they sign in (they were sent to editor.html / shoot.html)', async () => {
  for (const role of ['nadia', 'nirel', 'eli']) {
    const ctx = await context();
    const page = await tab(ctx);
    await signIn(page, 'clients.html', role);
    assert.match(await where(page), /^clients\.html(#mine)?$/, role);
    assert.equal(await page.locator('#view-mine').isVisible(), true, role);
    // Their own screen is one tap away in the menu.
    const own = role === 'eli' ? 'shoot.html' : 'editor.html';
    assert.equal(await page.locator(`#app-side a[href="${own}"]`).count(), 1, `${role}: ${own} in the menu`);
    await ctx.close();
  }
});

await step('a new launch of the app: the home, the personal profile, the first tab, the short view (nothing of the last visit)', async () => {
  for (const role of ['owner', 'ofir']) {
    const ctx = await context({ viewport: IPHONE });
    const first = await tab(ctx);
    await signIn(first, 'clients.html', role);
    // The last visit ended in the manager view, with the full list on.
    const toggle = await first.locator('#mine-view-on').count();
    if (toggle) { await first.click('#mine-view-on'); assert.equal(await first.evaluate(() => sessionStorage.getItem('astrateg.mine.full')), 'on'); }
    await first.click('#profile-switch');
    await first.waitForFunction(() => location.pathname.endsWith('owner.html'));
    await shown(first);
    assert.equal(await first.evaluate(() => sessionStorage.getItem('astrateg.profile')), 'manager');
    // The installed app starts again (a new tab has a new session storage): its start_url.
    const again = await tab(ctx);
    await again.goto(`${BASE}clients.html#mine`);
    await shown(again);
    await settle(again);
    assert.equal(await where(again), MINE, role);
    assert.equal(await again.evaluate(() => document.documentElement.dataset.profile), 'mine', `${role}: the personal profile`);
    assert.equal(await again.getAttribute('#tab-mine', 'aria-selected'), 'true');
    assert.equal(await again.getAttribute('#profile-switch', 'data-to'), 'manager', `${role}: the button offers the manager view`);
    assert.equal(await again.evaluate(() => sessionStorage.getItem('astrateg.mine.full')), null, `${role}: the full view is not remembered`);
    if (toggle) assert.equal(await again.getAttribute('#mine-view-off', 'aria-pressed'), 'true', `${role}: the short view`);
    assert.equal(await again.evaluate(() => sessionStorage.getItem('astrateg.profile') || 'mine'), 'mine');
    // The bare address (an app installed before 9.10.2026 starts there) is the same home.
    const old = await tab(ctx);
    await old.goto(`${BASE}clients.html`);
    await shown(old);
    assert.match(await where(old), /^clients\.html(#mine)?$/);
    assert.equal(await old.evaluate(() => document.documentElement.dataset.profile), 'mine');
    await ctx.close();
  }
});

await step('a deep link opened on purpose still opens its target: after a sign-in, and in a new tab of whoever is signed in', async () => {
  const ctx = await context();
  const page = await tab(ctx);
  // A notification's link to a client, opened while signed out: the sign-in continues to it.
  const target = `client.html?id=${cid(4)}#p07`;
  await signIn(page, target, 'irit');
  assert.equal((await where(page)).split('#')[0], target.split('#')[0]);
  assert.equal(await page.locator('#app').isVisible(), true);
  // Signed in: a notification opens a new tab on its target ("N דברים באיחור אצלך").
  const late = await tab(ctx);
  await late.goto(`${BASE}clients.html#late`);
  await shown(late);
  assert.match(await where(late), /^clients\.html#(late|mine)$/);
  const owner = await tab(ctx);
  await owner.goto(`${BASE}messages.html`);
  await shown(owner);
  assert.equal(await where(owner), 'messages.html');
  assert.equal(await refused(owner), false);
  await ctx.close();
});

await step('a deep link that is not theirs: home, not "אין לך גישה"', async () => {
  for (const [role, path, home] of [['nadia', 'messages.html', MINE], ['eli', 'owner.html', MINE], ['stav', 'qa.html', 'deal.html']]) {
    const ctx = await context();
    const page = await tab(ctx);
    await page.goto(`${BASE}${path}`);
    await page.waitForSelector('#lg-email:visible');
    await page.fill('#lg-email', emailOf(role));
    await page.fill('#lg-pass', 'correct-horse');
    await page.click('#lg-submit');
    await page.waitForFunction((h) => location.pathname.endsWith(h.split('#')[0]), home, { timeout: 15000 });
    await shown(page);
    assert.equal(await refused(page), false, `${role} from ${path}`);
    assert.match(await where(page), home === MINE ? /^clients\.html(#mine)?$/ : /^deal\.html$/, role);
    await ctx.close();
  }
});

// ── 2. The sign-in screen with the keyboard up ──
await step('sign-in on a phone: the page is the night under the status bar, and light again after; the fields are 16px', async () => {
  for (const viewport of [IPHONE, IPHONE_15]) {
    const ctx = await context({ viewport });
    const page = await tab(ctx, { insets: INSETS });
    await page.goto(`${BASE}clients.html`);
    await page.waitForSelector('#lg-email:visible');
    const look = () => page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor,
      strip: getComputedStyle(document.body, '::before').backgroundColor, theme: document.querySelector('meta[name=theme-color]').content,
    }));
    const night = await look();
    assert.equal(night.html, NIGHT);
    assert.equal(night.body, NIGHT);
    assert.equal(night.strip, NIGHT, 'the layer under the status bar');
    assert.equal(night.theme.toLowerCase(), '#071433');
    for (const id of ['lg-email', 'lg-pass']) assert.ok(parseFloat(await page.evaluate((x) => getComputedStyle(document.getElementById(x)).fontSize, id)) >= 16, `${id}: 16px, so the iPhone does not zoom`);
    assert.doesNotMatch(await page.getAttribute('meta[name=viewport]', 'content'), /user-scalable|maximum-scale/);
    await fillIn(page, 'irit');
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-door'));
    const day = await look();
    assert.notEqual(day.html, NIGHT);
    assert.equal(day.html, day.strip, 'the layer under the status bar is the page colour');
    assert.equal(day.theme.toLowerCase(), '#eef0f4');
    await ctx.close();
  }
});

await step('sign-in with the keyboard up: the logo, the two fields and the button are all in what is left, with a margin', async () => {
  // What is left of 390×844 and 393×852 above an iPhone keyboard, and a phone on its side.
  for (const [viewport, tight] of [[{ width: 390, height: 430 }, false], [{ width: 393, height: 440 }, false], [{ width: 360, height: 400 }, false], [{ width: 740, height: 330 }, true]]) {
    const ctx = await context({ viewport });
    const page = await tab(ctx);
    await page.goto(`${BASE}clients.html`);
    await page.waitForSelector('#lg-email:visible');
    await page.focus('#lg-email');
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => {
      const box = (sel) => { const e = document.querySelector(sel); const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, shown: r.width > 1 && r.height > 1 && getComputedStyle(e).display !== 'none' }; };
      return { card: box('#login-form'), email: box('#lg-email'), pass: box('#lg-pass'), go: box('#lg-submit'), brand: box('.lg-brand'), h: innerHeight, w: innerWidth, kb: document.getElementById('login-block').className };
    });
    const tag = `${viewport.width}×${viewport.height}`;
    assert.match(m.kb, /lg-kb/, tag);
    assert.ok(m.card.top >= 10, `${tag}: a margin above the card (${m.card.top})`);
    assert.ok(m.card.left >= 12 && m.card.right <= m.w - 12, `${tag}: a margin beside the card`);
    for (const k of ['email', 'pass', 'go']) assert.ok(m[k].shown && m[k].top >= m.card.top && m[k].bottom <= m.h, `${tag}: ${k} is on the screen (${m[k].top}–${m[k].bottom} of ${m.h})`);
    assert.equal(m.brand.shown, !tight, `${tag}: the logo ${tight ? 'steps aside' : 'stays'}`);
    if (!tight) assert.ok(m.brand.top >= m.card.top, `${tag}: the head of the card is not cut`);
    assert.ok(await sideways(page) <= 0, `${tag}: no sideways scroll`);
    await ctx.close();
  }
});

// ── 3 and 5. The safe areas ─────────────────
const STAFF_PAGES = ['clients.html', 'owner.html', `client.html?id=${cid(4)}`, 'messages.html', 'prep.html', 'qa.html', 'decisions.html', 'pass.html', 'shoot.html',
  'gantt.html', `gantt.html?id=${cid(4)}`, 'year.html', 'insights.html', 'team.html', 'landing.html', `intake.html?id=${cid(4)}`, `scripts.html?id=${cid(4)}`, 'quotes.html'];
async function safeAreas(page, name, { bar = true } = {}) {
  const m = await page.evaluate(() => {
    const b = getComputedStyle(document.body, '::before');
    const top = document.querySelector('header.topbar')?.getBoundingClientRect();
    const side = document.getElementById('app-side');
    const barBox = side && getComputedStyle(side).position === 'fixed' ? side.getBoundingClientRect() : null;
    return {
      layer: { position: b.position, height: parseFloat(b.height), top: parseFloat(b.top), width: parseFloat(b.width), bg: b.backgroundColor, z: Number(b.zIndex), events: b.pointerEvents },
      page: getComputedStyle(document.body).backgroundColor, padTop: parseFloat(getComputedStyle(document.body).paddingTop), padBottom: parseFloat(getComputedStyle(document.body).paddingBottom),
      topbar: top ? top.top + scrollY : null, bar: barBox ? { top: barBox.top, bottom: barBox.bottom } : null, h: innerHeight, w: innerWidth,
    };
  });
  assert.deepEqual([m.layer.position, m.layer.height, m.layer.top, m.layer.events], ['fixed', INSETS.top, 0, 'none'], `${name}: the layer under the status bar`);
  assert.ok(m.layer.width >= m.w - 1, `${name}: the layer is as wide as the screen`);
  assert.equal(m.layer.bg, m.page, `${name}: the layer has the page colour`);
  assert.ok(m.layer.z > 50, `${name}: the layer is above the page and the bar`);
  assert.ok(m.padTop >= INSETS.top + 8, `${name}: the page starts below the status bar (${m.padTop})`);
  if (m.topbar !== null) assert.ok(m.topbar >= INSETS.top + 8, `${name}: the top bar is below the status bar (${m.topbar})`);
  if (bar && m.bar) {
    assert.ok(Math.abs(m.h - m.bar.bottom - (INSETS.bottom + 10)) <= 1, `${name}: the bottom bar keeps clear of the home indicator (${m.h - m.bar.bottom})`);
    assert.ok(m.padBottom >= (m.h - m.bar.top) + 8, `${name}: the page's bottom padding clears the bar (${m.padBottom} for ${m.h - m.bar.top})`);
  }
  // The last thing of the page can be scrolled fully above the bar.
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(120);
  const end = await page.evaluate(() => {
    const side = document.getElementById('app-side');
    const barTop = side && getComputedStyle(side).position === 'fixed' ? side.getBoundingClientRect().top : innerHeight;
    const main = document.querySelector('body > main');
    return { barTop, mainBottom: main.getBoundingClientRect().bottom, wide: document.documentElement.scrollWidth - innerWidth };
  });
  assert.ok(end.mainBottom <= end.barTop - 4, `${name}: the end of the page is above the bar (${end.mainBottom} vs ${end.barTop})`);
  assert.ok(end.wide <= 0, `${name}: no sideways scroll (${end.wide})`);
  await page.evaluate(() => scrollTo(0, 0));
}
await step('the top safe area is kept while scrolling, and the last thing clears the bottom bar: every staff page, 390×844 and 393×852', async () => {
  for (const viewport of [IPHONE, IPHONE_15]) {
    const ctx = await context({ viewport });
    const page = await tab(ctx, { insets: INSETS });
    await signIn(page, 'clients.html', 'owner');
    for (const path of STAFF_PAGES) {
      await page.goto(`${BASE}${path}`);
      await shown(page);
      await settle(page);
      await safeAreas(page, `owner ${path} ${viewport.width}`);
    }
    await ctx.close();
    for (const [role, path] of [['nadia', 'editor.html'], ['eli', 'shoot.html'], ['ilai', 'clients.html'], ['stav', 'deal.html']]) {
      const c = await context({ viewport });
      const p = await tab(c, { insets: INSETS });
      await signIn(p, path, role);
      await safeAreas(p, `${role} ${path} ${viewport.width}`);
      await c.close();
    }
  }
});
await step('without an inset (a desktop, a browser tab) the layer has no height and the page starts where it did', async () => {
  const ctx = await context({ viewport: WIDE });
  const page = await tab(ctx);
  await signIn(page, 'clients.html', 'irit');
  const m = await page.evaluate(() => ({ h: parseFloat(getComputedStyle(document.body, '::before').height), pad: parseFloat(getComputedStyle(document.body).paddingTop) }));
  assert.deepEqual(m, { h: 0, pad: 12 });
  await ctx.close();
});

// ── 4. The tab rows and the phone's bar ─────
await step('the manager view\'s tabs on a phone: one line, one height, the same padding; the row scrolls inside itself and the chosen tab is whole', async () => {
  for (const viewport of [SMALL, IPHONE, IPHONE_15]) {
    for (const [role, n] of [['owner', 5], ['lior', 3], ['irit', 2]]) {
      const ctx = await context({ viewport });
      const page = await tab(ctx);
      await signIn(page, 'owner.html', role);
      await page.waitForSelector('#ow-tabs .tab:visible');
      const read = () => page.evaluate(() => {
        const row = document.getElementById('ow-tabs');
        const r = row.getBoundingClientRect();
        const tabs = [...row.querySelectorAll('.tab')].filter((t) => !t.hidden).map((t) => {
          const b = t.getBoundingClientRect(); const cs = getComputedStyle(t);
          const range = document.createRange(); range.selectNodeContents(t);
          return { id: t.id, top: Math.round(b.top), h: Math.round(b.height), left: b.left, right: b.right, pad: [cs.paddingInlineStart, cs.paddingInlineEnd].join(), lines: new Set([...range.getClientRects()].filter((x) => x.width > 1).map((x) => Math.round(x.top))).size, on: t.getAttribute('aria-selected') === 'true', ws: cs.whiteSpace };
        });
        return { row: { left: r.left, right: r.right, scrolls: row.scrollWidth > row.clientWidth + 1 }, tabs, wide: document.documentElement.scrollWidth - innerWidth };
      });
      const tag = `${role} ${viewport.width}`;
      let m = await read();
      assert.ok(m.tabs.length >= n, `${tag}: ${m.tabs.length} tabs`);
      assert.equal(new Set(m.tabs.map((t) => t.top)).size, 1, `${tag}: one row`);
      assert.equal(new Set(m.tabs.map((t) => t.h)).size, 1, `${tag}: one height`);
      assert.equal(new Set(m.tabs.map((t) => t.pad)).size, 1, `${tag}: the same padding`);
      for (const t of m.tabs) { assert.equal(t.lines, 1, `${tag}: ${t.id} is one line`); assert.ok(t.h >= 44 && t.h <= 48, `${tag}: ${t.id} is ${t.h}px high`); }
      assert.ok(m.wide <= 0, `${tag}: the page does not scroll sideways (${m.wide})`);
      const whole = (t) => t.left >= m.row.left - 0.5 && t.right <= m.row.right + 0.5;
      assert.ok(whole(m.tabs.find((t) => t.on)), `${tag}: the chosen tab is whole in its row`);
      // No odd gap: the tabs follow one another at the row's own gap.
      const order = [...m.tabs].sort((a, b) => b.right - a.right);
      for (let i = 1; i < order.length; i += 1) assert.ok(Math.abs(order[i - 1].left - order[i].right) <= 6, `${tag}: the gap before ${order[i].id}`);
      // The last tab, chosen, is brought whole into the row.
      const last = m.tabs[m.tabs.length - 1].id;
      await page.evaluate((id) => document.getElementById(id).click(), last);
      await page.waitForTimeout(150);
      m = await read();
      assert.equal(m.tabs.find((t) => t.on).id, last);
      assert.ok(whole(m.tabs.find((t) => t.on)), `${tag}: ${last}, chosen, is whole in its row`);
      assert.ok(m.wide <= 0, `${tag}: still no sideways scroll`);
      await ctx.close();
    }
  }
});
await step('the four tabs of "המשימות שלי" still share the row with no scroll (360 and 390)', async () => {
  for (const viewport of [SMALL, IPHONE]) {
    const ctx = await context({ viewport });
    const page = await tab(ctx);
    await signIn(page, 'clients.html', 'irit');
    const m = await page.evaluate(() => { const row = document.querySelector('.tabs'); const tabs = [...row.querySelectorAll('.tab')].filter((t) => !t.hidden); return { over: row.scrollWidth - row.clientWidth, n: tabs.length, tops: new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size, low: Math.min(...tabs.map((t) => t.getBoundingClientRect().height)) }; });
    assert.ok(m.n >= 3 && m.over <= 1 && m.tops === 1 && m.low >= 44, JSON.stringify(m));
    assert.ok(await sideways(page) <= 0);
    await ctx.close();
  }
});
await step('the phone\'s bar: a long name is shown short on one line, and its full name is what is read', async () => {
  for (const [role, path, id, short, full] of [['lior', 'owner.html', 'side-overview', 'במבט', 'כל הלקוחות במבט'], ['ofir', 'clients.html', 'side-pass', 'מעבר', 'מעבר על הלקוחות'],
    ['irit', 'clients.html', 'side-prep', 'לפני צילום', 'לפני יום צילום'], ['nadia', 'clients.html', 'side-editor', 'בעריכה', 'הלקוחות שלי בעריכה']]) {
    for (const viewport of [SMALL, IPHONE]) {
      const ctx = await context({ viewport });
      const page = await tab(ctx);
      await signIn(page, path, role);
      const m = await page.evaluate((x) => {
        const a = document.getElementById(x); if (!a) return null;
        const t = a.querySelector('.side-t'); const range = document.createRange(); range.selectNodeContents(t);
        return { text: t.textContent, label: a.getAttribute('aria-label'), inBar: !!a.closest('#side-list'), lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size, cut: t.scrollWidth > t.clientWidth + 1 };
      }, id);
      assert.ok(m && m.inBar, `${role}: ${id} is in the bar`);
      assert.deepEqual([m.text, m.label, m.lines, m.cut], [short, full, 1, false], `${role} ${viewport.width}`);
      await ctx.close();
    }
  }
});

// ── 6. "בקליטה" ─────────────────────────────
await step('"בקליטה" is one solid pill on every page that shows it, never a dashed outline', async () => {
  let seen = 0;
  for (const [role, path, viewport] of [['owner', 'owner.html#all', IPHONE], ['irit', 'clients.html#clients', IPHONE], ['ofir', 'qa.html', WIDE], ['ofir', 'pass.html', WIDE], ['ilai', 'clients.html', WIDE], ['irit', `client.html?id=${cid(31)}`, IPHONE]]) {
    const ctx = await context({ viewport });
    const page = await tab(ctx);
    await signIn(page, path, role);
    for (const d of await page.locator('details.il-fold').all()) await d.evaluate((x) => { x.open = true; });
    const tags = await page.evaluate(() => [...document.querySelectorAll('.tag-landing')].filter((t) => t.getClientRects().length).map((t) => { const cs = getComputedStyle(t); return { border: `${cs.borderTopStyle} ${cs.borderTopWidth}`, bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius), wrap: cs.whiteSpace, h: t.getBoundingClientRect().height }; }));
    for (const t of tags) {
      assert.match(t.border, /^none|0px$/, `${path}: ${t.border}`);
      assert.doesNotMatch(t.bg, /rgba\(0, 0, 0, 0\)|transparent/, `${path}: a solid ground`);
      assert.ok(t.radius >= 10 && t.wrap === 'nowrap' && t.h >= 22, `${path}: a pill`);
    }
    seen += tags.length;
    await ctx.close();
  }
  assert.ok(seen >= 6, `only ${seen} marks were seen`);
});

// ── 7. Ilai's cards ─────────────────────────
await step('Ilai: nothing is clipped from 360 to 1440, the cards wear the kit, and the clients in landing are folded into counted lines', async () => {
  for (const width of [360, 390, 768, 1024, 1280, 1440]) {
    const ctx = await context({ viewport: { width, height: 900 } });
    const page = await tab(ctx);
    await signIn(page, 'clients.html', 'ilai');
    await page.waitForSelector('.g-ilai .il-card');
    const check = async (tag) => {
      const out = await page.evaluate(() => {
        const sec = document.querySelector('.g-ilai');
        const bad = [];
        for (const card of sec.querySelectorAll('.il-card, .il-fold > summary')) {
          if (!card.getClientRects().length) continue;
          const c = card.getBoundingClientRect();
          for (const el of card.querySelectorAll('*')) {
            if (!el.getClientRects().length || el.closest('.sr-only') || el.matches('input[type=file]')) continue;
            const r = el.getBoundingClientRect();
            if (r.width && (r.left < c.left - 1 || r.right > c.right + 1)) bad.push(`${el.tagName}.${String(el.className).slice(0, 30)} ${Math.round(r.left)}–${Math.round(r.right)} outside ${Math.round(c.left)}–${Math.round(c.right)}`);
          }
          if (c.left < -0.5 || c.right > innerWidth + 0.5) bad.push(`card outside the screen ${c.left}–${c.right}`);
        }
        return { bad: bad.slice(0, 5), wide: document.documentElement.scrollWidth - innerWidth };
      });
      assert.deepEqual(out.bad, [], `${tag}`);
      assert.ok(out.wide <= 0, `${tag}: sideways scroll ${out.wide}`);
    };
    await check(`ilai ${width}`);
    // The working cards: none of a client in landing; each with its square, its tile and one filled action.
    const cards = page.locator('.g-ilai > .il-list > .il-card');
    assert.ok(await cards.count() >= 2);
    assert.equal(await page.locator('.g-ilai > .il-list > .il-card .tag-landing').count(), 0, 'a client in landing has a full card');
    assert.ok(await page.locator('.g-ilai > .il-list > .il-card .il-head > .k-ico').count() >= 2);
    assert.ok(await page.locator('.g-ilai > .il-list > .il-card .fl-work-add.k-tile .k-ico').count() >= 2);
    assert.equal(await page.locator('.g-ilai .il-card .il-ready:not(.k-btn-navy)').count(), 0);
    const lock = page.locator('.g-ilai .il-card .il-lock').first();
    assert.match(await lock.evaluate((e) => e.textContent), /נפתח אחרי שמעלים כאן לפחות גרפיקה אחת/);
    // The clients in landing: a counted line a kind, with the words of every landing line.
    const fold = page.locator('#il-fold-rest');
    assert.equal(await fold.count(), 1);
    const n = await fold.locator('.il-card').count();
    assert.ok(n >= 1);
    assert.match((await fold.locator('summary').innerText()).replace(/\s+/g, ' '), new RegExp(`^${n === 1 ? 'לקוח אחד' : `${n} לקוחות`} עם יתרת גרפיקות · ?בקליטה, בלי שעון`));
    assert.equal(await fold.locator('summary .k-num').getAttribute('data-n'), String(n));
    assert.equal(await fold.locator('.il-card').first().isVisible(), false, 'folded');
    assert.ok((await fold.locator('summary').boundingBox()).height >= 48);
    await fold.locator('summary').click();
    assert.equal(await fold.locator('.il-card').first().isVisible(), true, 'the same cards under the line');
    assert.equal(await fold.locator('.il-card .tag-landing').count(), n);
    assert.equal(await fold.locator('.il-card .fl-work-add').count(), n, 'the work can still be done there');
    await check(`ilai ${width}, the landing line open`);
    await ctx.close();
  }
});

// ── 8. Fields side by side ──────────────────
// Every row of fields in `root`: the inputs that share a line start at the same height, and
// so do their labels; nothing is wider than its row.
const rowsOf = (page, root) => page.evaluate((sel) => {
  const out = [];
  for (const row of document.querySelectorAll(sel)) {
    if (!row.getClientRects().length) continue;
    const fields = [...row.children].filter((f) => f.matches('.field') && f.getClientRects().length);
    const cells = fields.map((f) => { const c = f.querySelector('input, select, textarea'); const l = f.querySelector('label'); return c && l ? { id: c.id, top: Math.round(c.getBoundingClientRect().top), bottom: Math.round(c.getBoundingClientRect().bottom), label: Math.round(l.getBoundingClientRect().top), left: c.getBoundingClientRect().left, right: c.getBoundingClientRect().right } : null; }).filter(Boolean);
    const r = row.getBoundingClientRect();
    // Group by the line they stand on (their labels overlap in height).
    const lines = [];
    for (const c of cells) { const line = lines.find((x) => Math.abs(x[0].bottom - c.bottom) < 40 && Math.abs(x[0].label - c.label) < 60); if (line) line.push(c); else lines.push([c]); }
    out.push({ cls: row.className, lines: lines.filter((x) => x.length > 1), over: cells.filter((c) => c.left < r.left - 1 || c.right > r.right + 1).map((c) => c.id) });
  }
  return out;
}, root);
const aligned = (rows, tag) => {
  for (const row of rows) {
    assert.deepEqual(row.over, [], `${tag} ${row.cls}: a field is wider than its row`);
    for (const line of row.lines) {
      assert.equal(new Set(line.map((c) => c.top)).size, 1, `${tag} ${row.cls}: the fields ${line.map((c) => `${c.id}@${c.top}`).join(', ')} are not on one line`);
      assert.equal(new Set(line.map((c) => c.label)).size, 1, `${tag} ${row.cls}: the labels of ${line.map((c) => `${c.id}@${c.label}`).join(', ')} do not start together`);
    }
  }
};
await step('deal.html "הצעה אחרת": the three counts stand on one line and so do the price and the period (360, 390, 393, 1280)', async () => {
  for (const viewport of [SMALL, IPHONE, IPHONE_15, WIDE]) {
    const ctx = await context({ viewport });
    const page = await tab(ctx);
    await signIn(page, 'deal.html', 'stav');
    await page.check('#d-kind-custom', { force: true });
    await page.waitForSelector('#d-custom:not([hidden])');
    const rows = await rowsOf(page, '.deal-custom-qty, .deal-custom-money');
    assert.deepEqual(rows.map((r) => r.lines.map((l) => l.length)), [[3], [2]], `${viewport.width}`);
    aligned(rows, `deal ${viewport.width}`);
    assert.ok(await sideways(page) <= 0);
    await ctx.close();
  }
});
await step('the other rows of fields in the app are on one line too: the new client and the client\'s details dialogs, the task form', async () => {
  for (const viewport of [SMALL, IPHONE, WIDE]) {
    const ctx = await context({ viewport });
    const page = await tab(ctx);
    await signIn(page, 'clients.html', 'irit');
    await page.evaluate(() => document.getElementById('dlg-new')?.showModal());
    aligned(await rowsOf(page, '#dlg-new .form-grid'), `new client ${viewport.width}`);
    await page.goto(`${BASE}client.html?id=${cid(4)}`);
    await shown(page);
    await settle(page);
    aligned(await rowsOf(page, '.task-form'), `task form ${viewport.width}`);
    await page.evaluate(() => document.getElementById('dlg-edit')?.showModal());
    aligned(await rowsOf(page, '#dlg-edit .form-grid'), `client details ${viewport.width}`);
    await ctx.close();
  }
});

// ── 9. The upload blocks ────────────────────
await step('every upload block wears the kit: the editor\'s batch, the short form and the materials of the characterization page, the gallery link, the inspiration links', async () => {
  {
    const ctx = await context();
    const page = await tab(ctx);
    await signIn(page, 'editor.html', 'yariv');
    const add = page.locator('.ed-card .fl-work .fl-work-add').first();
    await add.scrollIntoViewIfNeeded();
    assert.equal(await add.evaluate((b) => b.tagName === 'BUTTON' && b.classList.contains('k-tile') && b.classList.contains('fl-add') && /-v-add$/.test(b.id)), true);
    assert.equal(await add.locator('.k-ico, .k-tile-plus, .k-tile-name, .k-tile-n').count(), 4);
    assert.match(await add.locator('.k-tile-name').innerText(), /^העלאת סרטונים$/);
    assert.ok((await add.boundingBox()).height >= 56);
    assert.ok(await sideways(page) <= 0);
    await ctx.close();
  }
  {
    const ctx = await context();
    const page = await tab(ctx);
    await signIn(page, `intake.html?id=${cid(4)}#form`, 'ofir');
    await page.waitForSelector('#files-materials [data-kind-btn="image"]:not([hidden])');
    assert.equal(await page.locator('#files-materials .fl-add.k-tile:visible').count(), 4);
    assert.equal(await page.locator('#files-materials .fl-add:not(.k-tile)').count(), 0, 'no plain button is left');
    assert.equal(await page.locator('#files-materials .fl-head .k-ico').count(), 1);
    assert.ok(await sideways(page) <= 0);
    await ctx.close();
  }
  {
    const ctx = await context();
    const page = await tab(ctx);
    await signIn(page, `client.html?id=${cid(4)}`, 'irit');
    await page.waitForSelector('#fl-gal-create');
    assert.equal(await page.locator('#fl-gal-create.k-btn-navy').count(), 1);
    const g = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.fl-gallery')); return { bg: cs.backgroundColor, r: parseFloat(cs.borderTopLeftRadius) }; });
    assert.ok(g.r >= 10 && !/rgba\(0, 0, 0, 0\)/.test(g.bg));
    await ctx.close();
  }
  {
    const ctx = await context();
    const page = await tab(ctx);
    await signIn(page, `scripts.html?id=${cid(4)}`, 'lior');
    await page.waitForSelector('.sc-links');
    assert.ok(await page.locator('.sc-link-add .btn.k-btn-navy').count() >= 1);
    assert.equal(await page.locator('.sc-link-add .btn:not(.k-btn-navy)').count(), 0);
    await ctx.close();
  }
});

await browser.close();
assert.deepEqual(errors, [], `page errors:\n${errors.join('\n')}`);
noCspViolations();
console.log(`\n${passed} steps passed`);
