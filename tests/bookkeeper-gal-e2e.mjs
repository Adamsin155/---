// Gal, the office's bookkeeper (the owner's request of 16.11.2026; docs/ops.md, section 137), in the
// browser. The office of tests/roles-world.mjs (invented names; Tuesday 20.10.2026, 10:00), with
// invented ח.פ, phones, emails and amounts on its clients, a very long business name and email, a
// client that is ending, and one with no amount.
//   1  WebKit as an iPhone 13: Gal signs in on clients.html and lands on her one screen (no bottom
//      bar, one menu entry); a card per active client with the seven fields; "—" and a note where
//      nothing is written; the search typed key by key, a key deleted, everything deleted again;
//      a copy button; no sideways scroll. Another page she opens (owner.html) sends her back.
//   2  Chromium 1366: two columns of cards; the search by phone digits, typed and deleted key by
//      key; the copy button puts the bare number on the clipboard.
//   3  Gal signed in on another page (owner.html, gantt.html, team.html): sent to hers (app/shell.js).
//   4  Nadia (an editor) on bookkeeper.html: sent to her own home, the page not in her menu; the owner sees the list.
// Run: node <a static server> . 8481 &  then  BASE_URL=http://localhost:8481/ node tests/bookkeeper-gal-e2e.mjs
// SHOTS=1 SHOTS_OUT=<dir> also saves bookkeeper-390.png, bookkeeper-390-search.png, bookkeeper-1366.png,
// bookkeeper-1366-search.png, bookkeeper-owner-1366.png, bookkeeper-nadia-390.png.
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from './roles-world.mjs';
import { watchCsp } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8481/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\/]+$/, '')}/`;
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

const db = buildWorld();
db.staff.push({ email: emailOf('gal'), person: 'gal', vault: false, phone: null });
const STAFF = db.staff.slice();
const live = db.clients.filter((c) => !c.archived_at && ['active', 'ending'].includes(c.status || 'active'));
// The rows of public.bookkeeper_clients() on this world (invented numbers).
const ROWS = live.map((c, i) => ({
  contact_name: c.name, business: c.business, company_id: String(510000000 + i * 1111), phone: `050-${String(1000000 + i * 1371).slice(0, 7)}`,
  email: `office${i + 1}@example.test`, status: 'active',
  monthly_agorot: (3000 + (i % 5) * 500) * 118, total_agorot: (3000 + (i % 5) * 500) * 118 * 12, months: 12, source: ['quote', 'manual', 'legacy', 'payments'][i % 4], why: null,
}));
Object.assign(ROWS[0], { business: 'המרכז הארצי לשיפוצים, אינסטלציה ועבודות גמר בע״מ (סניף ראשון לציון)', email: 'accounts.payable.department.long.address@example-business-domain.test' });
Object.assign(ROWS[1], { status: 'ending' });
Object.assign(ROWS[2], { monthly_agorot: null, total_agorot: null, months: null, source: null, why: 'none', company_id: null, email: null });
Object.assign(ROWS[3], { total_agorot: null, months: null, why: 'unclear', monthly_agorot: 472050 });
const PHONE = ROWS[5].phone;

function bookkeeperFake() {
  const fake = makeFake(db);
  const route = async (r) => {
    const req = r.request();
    const p = new URL(req.url()).pathname;
    const json = (status, data) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: CORS });
    const token = /^Bearer (.+)$/.exec(req.headers().authorization || '')?.[1] || '';
    let email = null;
    try { email = JSON.parse(Buffer.from(token.split('.')[1] || 'e30', 'base64url').toString()).email || null; } catch { /* the anon key, or no token */ }
    const staff = db.staff.find((s) => s.email === email);
    // The team list: she reads only her own row (the restrictive policy of the migration).
    if (staff?.person === 'gal' && p === '/rest/v1/staff') {
      const mine = STAFF.filter((s) => s.email === email);
      return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(/vnd.pgrst.object/.test(req.headers().accept || '') ? mine[0] : mine) });
    }
    // Every other table answers her with nothing (she is not the office and has no client).
    if (staff?.person === 'gal' && p.startsWith('/rest/v1/') && !p.startsWith('/rest/v1/rpc/') && req.method() === 'GET') return json(200, []);
    if (req.method() === 'OPTIONS' || p !== '/rest/v1/rpc/bookkeeper_clients') return fake.route(r);
    if (!staff || !(staff.person === 'gal' || staff.person === null)) return json(403, { code: '42501', message: 'not allowed' });
    return json(200, ROWS);
  };
  return { route };
}

async function signedIn(engine, opts, who, path) {
  const ctx = await engine.newContext({ ...opts, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, bookkeeperFake().route);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${who} ${page.url()}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${who} ${page.url()}: ${m.text()}`); });
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf(who));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  return { page, ctx };
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// Nothing sticks out of its card (a long name or email wraps inside it).
const overflowing = (page) => page.evaluate(() => [...document.querySelectorAll('.bk-card')].filter((card) => {
  const box = card.getBoundingClientRect();
  return [...card.querySelectorAll('*')].some((el) => { const r = el.getBoundingClientRect(); return r.width && (r.left < box.left - 1 || r.right > box.right + 1); });
}).map((c) => c.id));
let passed = 0;
async function step(name, fn) { try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; } }
const hideToast = (page) => page.locator('#toast').evaluate((el) => { el.style.visibility = 'hidden'; });

async function galScreen(page) {
  await page.locator('#bk-0').waitFor();
  await settle(page);
  assert.equal(await page.locator('.bk-card').count(), ROWS.length, 'a card per active client');
  assert.equal(await page.locator('#bk-count').innerText(), `${ROWS.length} לקוחות פעילים`);
  // The fields of a card, in order.
  const card = page.locator('.bk-card', { hasText: ROWS[5].business });
  assert.deepEqual(await card.locator('.bk-label').allInnerTexts(), ['שם', 'שם העסק לחשבונית', 'ח.פ', 'טלפון', 'מייל', 'לחודש כולל מע״מ', 'לכל החוזה כולל מע״מ']);
  const vals = await card.locator('.bk-val').allInnerTexts();
  assert.equal(vals[2], ROWS[5].company_id);
  assert.equal(vals[3], ROWS[5].phone);
  assert.match(vals[5], /^[\d,]+ ₪$/);
  assert.equal(await card.locator('.bk-copy').count(), 7);
  // No amount: "—", no copy button for it, and the note.
  const none = page.locator('.bk-card', { hasText: ROWS[2].business });
  assert.deepEqual((await none.locator('.bk-val').allInnerTexts()).slice(5), ['—', '—']);
  assert.equal(await none.locator('.bk-copy').count(), 3, 'only the fields that have a value');
  assert.match(await none.locator('.bk-note').innerText(), /אין סכום במערכת/);
  // Agorot shown as such; a total that does not fit is not shown.
  const odd = page.locator('.bk-card', { hasText: ROWS[3].business });
  assert.equal((await odd.locator('.bk-val').allInnerTexts())[5], '4,720.50 ₪');
  assert.match(await odd.locator('.bk-note').innerText(), /לא מתאים/);
  // Ending: the tag.
  assert.match(await page.locator('.bk-card', { hasText: ROWS[1].business }).innerText(), /מסיים התקשרות/);
  assert.deepEqual(await overflowing(page), [], 'nothing sticks out of a card');
  assert.ok(await noSideScroll(page), 'no sideways scroll');
}

await step('1  iPhone (WebKit): her one screen; the search typed key by key and deleted; a copy button', async () => {
  const wk = await webkit.launch();
  const { page, ctx } = await signedIn(wk, devices['iPhone 13'], 'gal', 'clients.html');
  await page.waitForURL(/bookkeeper\.html/);
  await galScreen(page);
  assert.equal(await page.evaluate(() => document.body.classList.contains('has-tabbar')), false, 'no bottom bar');
  assert.equal(await page.locator('a[href="clients.html#mine"]:visible, a[href="calendar.html"]:visible, a[href="ask.html"]:visible, a[href="gantt.html"]:visible').count(), 0);
  if (SHOTS) await page.screenshot({ path: `${OUT}bookkeeper-390.png`, fullPage: true });
  // The search, key by key.
  const q = page.locator('#bk-q');
  assert.equal(await q.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16), true, 'no zoom on focus');
  await q.tap();
  await page.keyboard.type('פלד אופנ', { delay: 40 });
  assert.equal(await q.inputValue(), 'פלד אופנ');
  assert.equal(await page.locator('.bk-card').count(), 1);
  assert.equal(await page.locator('#bk-count').innerText(), `1 מתוך ${ROWS.length} לקוחות`);
  await page.keyboard.press('Backspace');
  assert.equal(await q.inputValue(), 'פלד אופ');
  assert.equal(await page.locator('.bk-card').count(), 1);
  await page.keyboard.type('Z', { delay: 40 });
  assert.equal(await page.locator('.bk-card').count(), 0);
  assert.match(await page.locator('#bk-empty').innerText(), /לא נמצא לקוח/);
  for (let i = 0; i < 8; i += 1) await page.keyboard.press('Backspace');
  assert.equal(await q.inputValue(), '');
  assert.equal(await page.locator('.bk-card').count(), ROWS.length);
  await page.keyboard.type('פלד', { delay: 40 });
  assert.equal(await page.locator('.bk-card').count(), 1);
  // A copy button: the toast says what was copied, the button shows it.
  const btn = page.locator('.bk-card').first().locator('.bk-copy').nth(2);
  await btn.tap();
  await page.locator('#toast:has-text("הועתק")').waitFor({ timeout: 5000 });
  assert.match(await page.locator('#toast').innerText(), /הועתק: ח\.פ/);
  assert.ok(await noSideScroll(page));
  if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}bookkeeper-390-search.png` }); }
  await ctx.close(); await wk.close();
});

await step('2  Chromium 1366: two columns; the search by phone digits; the bare number on the clipboard', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const { page, ctx } = await signedIn(browser, { viewport: { width: 1366, height: 900 } }, 'gal', 'bookkeeper.html');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await galScreen(page);
  const xs = await page.locator('.bk-card').evaluateAll((cs) => [...new Set(cs.slice(0, 4).map((c) => Math.round(c.getBoundingClientRect().left)))]);
  assert.equal(xs.length, 2, 'two columns');
  const items = await page.locator('nav a[href$=".html"], nav a[href*=".html#"]').evaluateAll((as) => [...new Set(as.filter((a) => a.offsetParent).map((a) => a.getAttribute('href')))]);
  assert.ok(items.every((x) => x === 'bookkeeper.html'), JSON.stringify(items));
  if (SHOTS) await page.screenshot({ path: `${OUT}bookkeeper-1366.png`, fullPage: true });
  const q = page.locator('#bk-q');
  await q.click();
  const digits = PHONE.replace(/\D/g, '');
  await page.keyboard.type(digits, { delay: 30 });
  assert.equal(await page.locator('.bk-card').count(), 1);
  for (let i = 0; i < digits.length; i += 1) await page.keyboard.press('Backspace');
  assert.equal(await q.inputValue(), '');
  assert.equal(await page.locator('.bk-card').count(), ROWS.length);
  await page.keyboard.type(PHONE, { delay: 30 });
  assert.equal(await page.locator('.bk-card').count(), 1);
  const card = page.locator('.bk-card').first();
  await card.locator('.bk-copy').nth(5).click();
  await page.locator('#toast:has-text("הועתק")').waitFor({ timeout: 5000 });
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), String((3000 + (5 % 5) * 500) * 118 / 100));
  await card.locator('.bk-copy').nth(4).click();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), ROWS[5].email);
  // Escape clears the search.
  await q.click();
  await page.keyboard.press('Escape');
  assert.equal(await q.inputValue(), '');
  await page.keyboard.type(PHONE.slice(0, 7), { delay: 30 });
  if (SHOTS) { await hideToast(page); await page.screenshot({ path: `${OUT}bookkeeper-1366-search.png` }); }
  await ctx.close(); await browser.close();
});

await step('3  another page, signed in on it (owner.html, gantt.html, team.html): she is sent to hers, or refused with the way to it; nothing of the clients', async () => {
  for (const path of ['owner.html', 'gantt.html', 'team.html']) {
    const wk = await webkit.launch();
    const { page, ctx } = await signedIn(wk, devices['iPhone 13'], 'gal', path);
    await page.waitForTimeout(2500);
    await settle(page);
    const home = await page.locator('a[href="bookkeeper.html"]:visible').count();
    if (process.env.DEBUG) console.log(path, page.url(), (await page.locator('main').innerText()).slice(0, 300));
    assert.ok(/bookkeeper\.html/.test(page.url()) || home > 0, `${path}: ${page.url()}`);
    const text = await page.locator('body').innerText();
    for (const c of db.clients.slice(0, 16)) assert.ok(/bookkeeper\.html/.test(page.url()) || !text.includes(c.business), `${path} shows ${c.business}`);
    assert.ok(await noSideScroll(page), path);
    if (SHOTS) await page.screenshot({ path: `${OUT}bookkeeper-gal-on-${path.replace('.html', '')}-390.png` });
    await ctx.close(); await wk.close();
  }
});

await step('4  an editor is sent home, the page not in her menu; the owner sees the list', async () => {
  const wk = await webkit.launch();
  const { page, ctx } = await signedIn(wk, devices['iPhone 13'], 'nadia', 'bookkeeper.html');
  // The page is not in her menu: the sign-in sends her home ("המשימות שלי"); had she stayed, the page says it is not hers.
  await page.waitForURL(/clients\.html#mine/, { timeout: 15000 });
  await settle(page);
  assert.equal(await page.locator('.bk-card').count(), 0);
  assert.equal(await page.locator('a[href="bookkeeper.html"]').count(), 0, 'not in her menu');
  assert.ok(await noSideScroll(page));
  if (SHOTS) await page.screenshot({ path: `${OUT}bookkeeper-nadia-390.png` });
  await ctx.close(); await wk.close();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const o = await signedIn(browser, { viewport: { width: 1366, height: 900 } }, 'owner', 'bookkeeper.html');
  await o.page.locator('#bk-0').waitFor();
  assert.equal(await o.page.locator('.bk-card').count(), ROWS.length);
  if (SHOTS) await o.page.screenshot({ path: `${OUT}bookkeeper-owner-1366.png` });
  await o.ctx.close(); await browser.close();
});

const real = errors.filter((e) => !/Skipping view transition because skipTransition\(\) was called/.test(e));
assert.deepEqual(real, [], 'page errors');
console.log(`\n${passed} passed`);
