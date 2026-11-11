// "תשלומי לקוחות" (payments.html; the owner, 11.11.2026; docs/ops.md, section 130), against the
// office of tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in Israel; invented names). The fake
// answers public.client_payments as its row level security does: the owners and Ofir read, the
// owners write, anyone else reads no row and cannot write.
//   1  WebKit as an iPhone 13, the owner: the summary tiles, "לא הוזן", a tile filters; "הוספה" on a
//      client with no deal: real key-by-key typing and deleting in every field; saved, shown in place.
//   2  Chromium at 1366, the owner: "עריכה" corrects a deal (typing and deleting), the older deal
//      opens under the latest, "עסקה חדשה" adds a renewal; no sideways scroll.
//   3  Ofir, WebKit 390 and Chromium 1366: the screen and its menu entry, no control that writes.
//   4  Irit and Nadia: no menu entry, "אין לך גישה", and the table answers them no row.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: node <a static server> . 8461 &  then  BASE_URL=http://localhost:8461/ node tests/payments-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8461/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
// After the sign-in screen has faded out (html[data-door]).
const shot = async (page, name, full = false) => { if (!SHOTS) return; await page.waitForFunction(() => !document.documentElement.hasAttribute('data-door'), null, { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}payments-${name}.png`, fullPage: full }); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

const db = flowWorld({ landing: false, queues: false });
const A = cid(12); // חן קוסמטיקה: a renewal (an older פיימנט deal, a newer cheques deal)
const B = cid(7);  // דיין רהיטים: a bank transfer
const C = cid(10); // אורן פרחים: an amount with no method
const NEW = cid(1); // פיצה נאפולי: nothing yet
db.client_payments = [
  { id: 'p1', client_id: A, amount: 21240, retainer: 1500, method: 'payment', checks_count: null, first_check_date: null, deal_date: '2025-10-01', package: null, note: null, source: 'old_crm', by_email: 'system', at: '2025-10-01T09:00:00Z' },
  { id: 'p2', client_id: A, amount: 28320, retainer: 2000, method: 'checks', checks_count: 12, first_check_date: '2026-10-01', deal_date: '2026-09-24', package: null, note: 'שיקים אצל עדי', source: 'old_crm', by_email: 'system', at: '2026-09-24T09:00:00Z' },
  { id: 'p3', client_id: B, amount: 49560, retainer: 3500, method: 'transfer', checks_count: null, first_check_date: null, deal_date: '2026-10-06', package: null, note: null, source: 'manual', by_email: emailOf('owner'), at: '2026-10-06T09:00:00Z' },
  { id: 'p4', client_id: C, amount: 42480, retainer: null, method: null, checks_count: null, first_check_date: null, deal_date: null, package: null, note: null, source: 'old_crm', by_email: 'system', at: '2026-01-01T09:00:00Z' },
];
const deals = (id) => db.client_payments.filter((p) => p.client_id === id);

// public.client_payments' row level security (supabase/migrations/20261212100000_client_payments.sql).
function withPaymentsRls(fake) {
  const personOf = (req) => {
    const token = /^Bearer (.+)$/.exec(req.headers().authorization || '')?.[1] || '';
    const email = (() => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).email; } catch { return null; } })();
    const s = db.staff.find((x) => x.email === email);
    return s ? { person: s.person } : null;
  };
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'OPTIONS' && url.pathname === '/rest/v1/client_payments') {
      const who = personOf(req);
      const reads = !!who && (who.person === null || who.person === 'ofir');
      const writes = !!who && who.person === null;
      if (req.method() === 'GET' && !reads) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: CORS });
      if (req.method() !== 'GET' && !writes) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'new row violates row-level security policy' }), headers: CORS });
    }
    return fake.route(route);
  };
}

async function signedIn(engine, opts, role) {
  const fake = makeFlowFake(db);
  const ctx = await engine.newContext({ ...opts, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, withPaymentsRls(fake));
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}payments.html`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForFunction(() => !document.getElementById('pm-page')?.hidden || !document.getElementById('no-access')?.hidden);
  await settle(page);
  return { page, ctx };
}
const rowOf = (page, id) => page.locator(`#pm-body tr.pm-row[data-id="${id}"]`);
const tileOf = (page, key) => page.locator(`.pm-s[data-method="${key}"]`);
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// Real typing: one key at a time, a few wrong ones deleted with Backspace, the rest typed again.
async function typeField(page, sel, wrong, back, right) {
  await page.locator(sel).focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(wrong, { delay: 25 });
  for (let i = 0; i < back; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type(right, { delay: 25 });
}
const launchChromium = () => chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

await step('1  iPhone (WebKit), the owner: the summary, "לא הוזן", a tile filters; "הוספה" with key-by-key typing', async () => {
  const wk = await webkit.launch();
  const { page, ctx } = await signedIn(wk, devices['iPhone 13'], 'owner');
  assert.equal(await page.locator('#pm-page').isVisible(), true);
  // The summary: the latest deal of each client.
  assert.match(await text(tileOf(page, 'checks')), /שיקים 1 לקוח.*28,320 ₪.*2,000 ₪/);
  assert.match(await text(tileOf(page, 'payment')), /פיימנט 0/);
  assert.match(await text(tileOf(page, 'transfer')), /העברה בנקאית 1/);
  const total = db.clients.filter((c) => !c.archived_at).length;
  assert.match(await text(tileOf(page, '')), new RegExp(`כל הלקוחות ${total}`));
  assert.match(await text(tileOf(page, 'none')), new RegExp(`לא הוזן ${total - 2}`));
  // A client with no deal, and one with an amount but no method.
  assert.match(await text(rowOf(page, NEW)), /פיצה נאפולי.*לא הוזן.*הוספה/);
  assert.match(await text(rowOf(page, C)), /42,480 ₪.*לא הוזן/);
  assert.ok(await noSideways(page), 'no sideways scroll');
  await shot(page, 'owner-390');
  await shot(page, 'owner-390-full', true);
  await page.locator('#pm-q').scrollIntoViewIfNeeded();
  await shot(page, 'owner-390-list');
  // A tile filters, and a second tap shows everyone again.
  await tileOf(page, 'checks').tap();
  assert.equal(await page.locator('#pm-body tr.pm-row').count(), 1);
  assert.equal(await tileOf(page, 'checks').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#pm-count').innerText(), /לקוח אחד מתוך \d+ · שיקים/);
  await tileOf(page, 'checks').tap();
  assert.equal(await page.locator('#pm-body tr.pm-row').count(), total);
  // "הוספה": the form, typed key by key, with deleting.
  await rowOf(page, NEW).locator('[data-act="add"]').tap();
  await page.waitForSelector('#pm-dlg[open]');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'pm-amount');
  await page.keyboard.type('21250', { delay: 25 });
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('40', { delay: 25 });
  assert.equal(await page.inputValue('#pm-amount'), '21240');
  await typeField(page, '#pm-retainer', '15000', 1, '');
  assert.equal(await page.inputValue('#pm-retainer'), '1500');
  assert.equal(await page.locator('#pm-checks').isVisible(), false, 'the cheques only for cheques');
  await page.locator('.pm-m', { hasText: 'שיקים' }).tap();
  assert.equal(await page.locator('#pm-checks').isVisible(), true);
  await typeField(page, '#pm-count-n', '13', 1, '2');
  assert.equal(await page.inputValue('#pm-count-n'), '12');
  await typeField(page, '#pm-first', '1.11.2026', 6, '2.2026');
  assert.equal(await page.inputValue('#pm-first'), '1.12.2026');
  await typeField(page, '#pm-date', '20.10.2025', 1, '6');
  assert.equal(await page.inputValue('#pm-date'), '20.10.2026');
  await page.locator('#pm-note').focus();
  await page.keyboard.type('שיקים דחויים', { delay: 25 });
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('בדואר', { delay: 25 });
  assert.equal(await page.inputValue('#pm-note'), 'שיקים בדואר');
  await shot(page, 'owner-390-form');
  // A wrong date is caught before anything is written.
  await typeField(page, '#pm-date', '', 0, '32.10.2026');
  await page.locator('#pm-save').tap();
  assert.match(await page.locator('#pm-err').innerText(), /תאריך העסקה/);
  assert.equal(deals(NEW).length, 0);
  await typeField(page, '#pm-date', '', 0, '20.10.2026');
  await page.locator('#pm-save').tap();
  await page.waitForFunction(() => !document.querySelector('#pm-dlg')?.open);
  await settle(page);
  assert.deepEqual(deals(NEW).map((p) => [p.amount, p.retainer, p.method, p.checks_count, p.first_check_date, p.deal_date, p.note]),
    [[21240, 1500, 'checks', 12, '2026-12-01', '2026-10-20', 'שיקים בדואר']]);
  await rowOf(page, NEW).scrollIntoViewIfNeeded();
  assert.match(await text(rowOf(page, NEW)), /21,240 ₪.*1,500 ₪.*שיקים.*12 שיקים.*הראשון ב־1.12.2026.*20.10.2026.*עריכה/);
  assert.match(await text(tileOf(page, 'checks')), /שיקים 2 לקוחות/);
  assert.ok(await noSideways(page), 'no sideways scroll after saving');
  await shot(page, 'owner-390-saved');
  await ctx.close();
  await wk.close();
});

await step('2  Chromium 1366, the owner: "עריכה" corrects, the older deal opens, "עסקה חדשה" adds a renewal', async () => {
  const browser = await launchChromium();
  const { page, ctx } = await signedIn(browser, { viewport: { width: 1366, height: 900 } }, 'owner');
  assert.ok(await noSideways(page), 'no sideways scroll');
  assert.equal(await page.locator('a[href="payments.html"]').count() > 0, true, 'in the menu');
  await shot(page, 'owner-1366');
  // The older deal of A, under its latest.
  const more = rowOf(page, A).locator('.pm-more');
  assert.equal(await more.innerText(), 'עוד עסקה קודמת');
  await more.click();
  const old = page.locator(`#pm-body tr.pm-old[data-id="${A}"]`);
  assert.match(await text(old), /עסקה קודמת.*21,240 ₪.*1,500 ₪.*פיימנט.*1.10.2025/);
  await shot(page, 'owner-1366-older');
  // "עריכה" on B: typing and deleting.
  await rowOf(page, B).locator('[data-act="edit"]').click();
  await page.waitForSelector('#pm-dlg[open]');
  assert.equal(await page.inputValue('#pm-amount'), '49560');
  await page.keyboard.press('End');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('000', { delay: 20 });
  assert.equal(await page.inputValue('#pm-amount'), '49000');
  await page.locator('.pm-m', { hasText: 'כרטיס אשראי' }).click();
  await shot(page, 'owner-1366-form');
  await page.click('#pm-save');
  await page.waitForFunction(() => !document.querySelector('#pm-dlg')?.open);
  await settle(page);
  assert.deepEqual(deals(B).map((p) => [p.amount, p.method]), [[49000, 'card']]);
  assert.match(await text(rowOf(page, B)), /49,000 ₪.*כרטיס אשראי/);
  // "עסקה חדשה" on C: a second row; the latest is the new one.
  await rowOf(page, C).locator('[data-act="renew"]').click();
  await page.waitForSelector('#pm-dlg[open]');
  assert.match(await page.locator('#pm-dlg-h').innerText(), /עסקה חדשה/);
  assert.equal(await page.inputValue('#pm-amount'), '');
  await page.keyboard.type('33984', { delay: 20 });
  await page.locator('.pm-m', { hasText: 'פיימנט' }).click();
  await page.locator('#pm-date').focus();
  await page.keyboard.type('19.10.2026', { delay: 20 });
  await page.click('#pm-save');
  await page.waitForFunction(() => !document.querySelector('#pm-dlg')?.open);
  await settle(page);
  assert.equal(deals(C).length, 2);
  assert.match(await text(rowOf(page, C)), /33,984 ₪.*פיימנט.*19.10.2026.*עוד עסקה קודמת|עוד עסקה קודמת.*33,984 ₪.*פיימנט.*19.10.2026/);
  assert.ok(await noSideways(page), 'no sideways scroll after saving');
  await ctx.close();
  await browser.close();
});

await step('3  Ofir (WebKit 390 and Chromium 1366): the screen, no control that writes', async () => {
  for (const [engine, opts, name] of [[webkit, devices['iPhone 13'], '390'], [chromium, { viewport: { width: 1366, height: 900 } }, '1366']]) {
    const browser = engine === chromium ? await launchChromium() : await engine.launch();
    const { page, ctx } = await signedIn(browser, opts, 'ofir');
    assert.equal(await page.locator('#pm-page').isVisible(), true, name);
    assert.equal(await page.locator('#no-access').isVisible(), false, name);
    assert.ok(await page.locator('#pm-body tr.pm-row').count() > 3, name);
    assert.match(await text(rowOf(page, A)), /28,320 ₪.*שיקים/);
    assert.equal(await page.locator('[data-act], .pm-act, #pm-dlg').count(), 0, `${name}: nothing that writes`);
    assert.match(await page.locator('#pm-sub').innerText(), /לצפייה בלבד/);
    assert.equal(await page.locator('a[href="payouts/"]').count(), 0, `${name}: not the payments app`);
    if (name === '1366') assert.ok(await page.locator('a[href="payments.html"]').count() > 0, 'in his menu');
    assert.ok(await noSideways(page), `${name}: no sideways scroll`);
    // And the table refuses his writes.
    const status = await page.evaluate(async ([url, key]) => {
      const token = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /auth-token/.test(k))) || '{}').access_token;
      const r = await fetch(`${url}/rest/v1/client_payments`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ client_id: 'x' }) });
      return r.status;
    }, [SUPA, 'k']);
    assert.equal(status, 403);
    await shot(page, `ofir-${name}`);
    await ctx.close();
    await browser.close();
  }
});

await step('4  Irit and Nadia: no menu entry, "אין לך גישה", no row', async () => {
  const browser = await launchChromium();
  for (const role of ['irit', 'nadia']) {
    const { page, ctx } = await signedIn(browser, { viewport: { width: 1366, height: 900 } }, role);
    // Signed in, the address opened again (the sign-in itself may lead home first).
    await page.goto(`${BASE}payments.html`);
    await page.waitForFunction(() => !document.getElementById('no-access')?.hidden || !document.getElementById('pm-page')?.hidden);
    await settle(page);
    assert.equal(await page.locator('#pm-page').isVisible(), false, role);
    assert.equal(await page.locator('#no-access').isVisible(), true, role);
    assert.equal(await page.locator('a[href="payments.html"]:not(.navlink)').count(), 0, `${role}: no menu entry`);
    const rows = await page.evaluate(async (url) => {
      const token = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /auth-token/.test(k))) || '{}').access_token;
      const r = await fetch(`${url}/rest/v1/client_payments?select=id`, { headers: { apikey: 'k', authorization: `Bearer ${token}` } });
      return (await r.json()).length;
    }, SUPA);
    assert.equal(rows, 0, `${role}: no row`);
    await ctx.close();
  }
  await browser.close();
});

assert.deepEqual(errors, [], 'page errors');
console.log(`\n${passed} passed`);
