// The quote in the old document's order, in our design, and "שינויים להצעה הזו" (the owner, 9.11.2026;
// docs/ops.md, section 118), in the browser, against an in-memory fake of Supabase that answers as the
// database and the create-quote function do (the engine itself runs in the fake: app/pricing.js; the
// real gate is tests/create-quote.test.mjs):
//   - the owner and the managers see the two fields under the packages; typing key by key, and
//     deleting, moves the totals and the preview (Chrome, and WebKit as an iPhone);
//   - the request carries custom.price and custom.packageName; the fake refuses them from anyone else,
//     as create-quote does;
//   - the client's link: the cover ("הצעת מחיר נירו לוי", the package's name big), "מי אנחנו", "מה
//     כוללת חבילת …", "למה לבחור בנו", "פירוט החבילה", the clauses, the signatures, the closing; the
//     client signs; a price offer the same without clauses; one sent before keeps its old look;
//   - phone 390 and desktop 1366: nothing scrolls sideways; full-page screenshots.
// Run: npx http-server -p 8111 -s -c-1 . &  then
//      BASE_URL=http://localhost:8111/ node tests/quote-old-format-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
import { watchCsp } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { withClientColumns } from './fake-clients.mjs';
import { validateSelection, normalizeSelection, exceptionOf, buildQuoteModel } from '../app/pricing.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Monday 9.11.2026, 10:00 in Jerusalem.
const NOW = new Date('2026-11-09T08:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();

const PEOPLE = { owner: null, irit: 'irit', ilai: 'ilai' };
const users = new Map();
const staff = [];
for (const [k, person] of Object.entries(PEOPLE)) {
  const email = `${k}@astrateg.test`;
  users.set(email, { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: NOW.toISOString() });
  staff.push({ email, person, vault: false });
}
const OFFICE = new Set(['irit', 'lior', 'ofir', 'ilai', null]);
const MANAGERS = new Set(['irit', 'lior', 'ofir', null]);
const EXP = Math.floor(NOW / 1000) + 3 * 3600;
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const sessionFor = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 3 * 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => staff.find((s) => s.email === u?.email)?.person;
const isStaff = (u) => !!u && staff.some((s) => s.email === u.email);
const isOffice = (u) => isStaff(u) && OFFICE.has(personOf(u));
const isManager = (u) => isStaff(u) && MANAGERS.has(personOf(u));

const quotes = [];
const calls = [];
let seq = 80;

// create-quote: validates, refuses the price and the name from anyone but the managers, computes the
// model itself, stores.
function createQuote(body, me, json) {
  calls.push({ createQuote: body, by: me?.email });
  if (!me) return json(401, { error: 'not signed in' });
  if (!isOffice(me)) return json(403, { error: 'not staff: quotes are prepared by the office' });
  let selection;
  try { validateSelection(body.selection); selection = normalizeSelection(body.selection); } catch (e) { return json(400, { error: e.message }); }
  const c = selection.custom;
  if (c && (c.price !== undefined || c.packageName !== undefined) && !isManager(me)) {
    return json(403, { error: 'not allowed: only the managers change the price or the package name' });
  }
  if (!body.client?.name?.trim() && body.selection?.docType !== 'quote') return json(400, { error: 'client name required' });
  const exceptions = exceptionOf(selection);
  const model = buildQuoteModel(selection, body.client);
  const q = {
    id: randomUUID(), token: randomUUID(), number: `AST-2026-${String(++seq).padStart(4, '0')}`, created_at: serverNow(), created_by_email: me.email,
    model, client_name: model.client.name, monthly_gross_agorot: model.totals.monthlyGross, term_gross_agorot: model.totals.termGross, status: 'sent',
    first_viewed_at: null, signed_at: null, signer_name: null, signature_png: null, approval: 'none', exceptions: exceptions.length ? exceptions : null,
  };
  q.model = { ...model, number: q.number, createdAt: q.created_at };
  q.expires_at = new Date(Date.parse(serverNow()) + model.validHours * 3600e3).toISOString();
  q.model.validUntil = q.expires_at;
  quotes.push(q);
  return json(200, { id: q.id, token: q.token, number: q.number, created_at: q.created_at, ...(exceptions.length ? { approval: 'none' } : {}) });
}

const view = (q) => ({
  number: q.number, createdAt: q.created_at, model: q.model, docHash: 'ab'.repeat(32), expiresAt: q.expires_at,
  expired: q.status !== 'signed' && !!q.expires_at && new Date(q.expires_at) < new Date(serverNow()),
  consentText: `קראתי ואני מאשר/ת את הסכם ההתקשרות ${q.number}, בהתחייבות ל־${q.model.termMonths} חודשים`, signatureHash: q.signature_png ? 'cd'.repeat(32) : null,
  status: q.status, signerName: q.signer_name, signedAt: q.signed_at, signaturePng: q.signature_png,
});

function rpc(name, body, me, json) {
  if (name === 'is_staff') return json(200, isStaff(me));
  if (name === 'is_office') return json(200, isOffice(me));
  if (name === 'is_manager') return json(200, isManager(me));
  if (name === 'get_quote') {
    const q = quotes.find((x) => x.token === body.p_token);
    if (!q || q.status === 'cancelled') return json(200, null);
    if (!me) q.first_viewed_at ||= serverNow();
    return json(200, view(q));
  }
  if (name === 'sign_quote') {
    const q = quotes.find((x) => x.token === body.p_token);
    if (!q) return json(404, { code: 'P0002', message: 'quote not found' });
    if (q.status === 'signed') return json(409, { code: '23505', message: 'quote already signed' });
    Object.assign(q, { status: 'signed', signer_name: body.p_name.trim(), signed_at: serverNow(), signature_png: body.p_signature });
    return json(200, view(q));
  }
  return json(200, []);
}

const quoteRow = (q) => ({
  ...q, tier: q.model.package.tierName, influencer: q.model.package.influencer, doc: q.model.docTitle, signable: String(q.model.signable),
  phone: q.model.client.phone, email: q.model.client.email, company: q.model.client.company, business: q.model.client.company,
  term: String(q.model.termMonths), valid: String(q.model.validHours),
});

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const json = (status, data) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
  });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  const me = userOf(req.headers());
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
    return json(200, sessionFor(u));
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p === '/functions/v1/create-quote') return createQuote(body, me, json);
  if (p.startsWith('/rest/v1/rpc/')) return rpc(p.slice('/rest/v1/rpc/'.length), body || {}, me, json);
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  const one = (req.headers().accept || '').includes('vnd.pgrst.object');
  const out = (rows) => (one ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' })) : json(200, rows));
  if (m[1] === 'quotes') return out(isOffice(me) ? quotes.map(quoteRow).reverse() : []);
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    return out(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff);
  }
  return out([]);
}

const errors = [];
async function newPage(browser, viewport = { viewport: { width: 1366, height: 900 } }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', ...viewport });
  await ctx.clock.install({ time: new Date(serverNow()) });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => [], staff: () => staff }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page);
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, who) {
  // Signed in through quotes.html; the builder then knows who it is (the same browser).
  await page.goto(`${BASE}quotes.html`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.locator('#list-block').waitFor();
}
const shot = async (page, name, fullPage = true) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage }); };
// The whole page in screens of the viewport, to look at each part at its real size.
async function parts(page, name) {
  if (!OUT) return;
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const vh = page.viewportSize().height;
  for (let i = 0, y = 0; y < h; i += 1, y += vh) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(80);
    await page.screenshot({ path: `${OUT}/${name}-part${i + 1}.png` });
  }
}
const text = (page, sel) => page.locator(sel).first().innerText();
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const ils = (n) => `${new Intl.NumberFormat('he-IL').format(n)} ₪`;
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last calls: ${JSON.stringify(calls.slice(-2)).slice(0, 900)}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}
const lastCreate = () => calls.filter((c) => c.createQuote).at(-1);
// Key by key, as a person types; then deletes with Backspace.
async function typeKeys(page, sel, value) {
  await page.locator(sel).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  for (const ch of value) await page.keyboard.type(ch, { delay: 15 });
}
async function drawAndSign(page, name) {
  await page.locator('#s-name').fill(name);
  await page.locator('#pad').scrollIntoViewIfNeeded();
  const box = await page.locator('#pad').boundingBox();
  await page.mouse.move(box.x + 40, box.y + 80);
  await page.mouse.down();
  for (let i = 0; i <= 20; i += 1) await page.mouse.move(box.x + 40 + i * 9, box.y + 80 - Math.sin(i / 3) * 25);
  await page.mouse.up();
  await page.locator('#s-consent').check();
  await page.locator('#btn-sign').click();
  await page.locator('#signed').waitFor();
}
// The real typing in the two fields, on one browser (Chrome or WebKit as an iPhone).
async function typingChecks(page, tag) {
  await page.locator('#tier-social').check();
  await page.locator('#quote-edit').waitFor();
  assert.equal(await page.locator('#qe-price').inputValue(), '3900');
  // The price: key by key, each key moves the total (no reload, the caret stays).
  await typeKeys(page, '#qe-price', '4');
  assert.equal(await text(page, '#t-mnet'), ils(4));
  await page.keyboard.type('2', { delay: 15 });
  assert.equal(await text(page, '#t-mnet'), ils(42));
  await page.keyboard.type('0', { delay: 15 });
  await page.keyboard.type('0', { delay: 15 });
  assert.equal(await page.locator('#qe-price').inputValue(), '4200');
  assert.equal(await text(page, '#t-mnet'), ils(4200));
  assert.equal(await text(page, '#t-mgross'), ils(4956));
  assert.match(await text(page, '#qe-price-was'), /שונה להצעה הזו/);
  // Delete one digit, then all of them: back to the catalog's price.
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#qe-price').inputValue(), '420');
  assert.equal(await text(page, '#t-mnet'), ils(420));
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#qe-price').inputValue(), '');
  assert.equal(await text(page, '#t-mnet'), ils(3900));
  await page.keyboard.type('4200', { delay: 15 });
  assert.equal(await text(page, '#t-mnet'), ils(4200));
  // The name: Hebrew and English, key by key, a mistake deleted, the preview follows.
  await typeKeys(page, '#qe-name', 'ALL IN ONX');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('E', { delay: 15 });
  assert.equal(await page.locator('#qe-name').inputValue(), 'ALL IN ONE');
  await page.keyboard.type(' פלוס', { delay: 15 });
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#qe-name').inputValue(), 'ALL IN ONE');
  // Blur: the fields keep what was typed.
  await page.locator('#c-name').click();
  assert.equal(await page.locator('#qe-price').inputValue(), '4200');
  assert.equal(await page.locator('#qe-name').inputValue(), 'ALL IN ONE');
  assert.ok(await noSideScroll(page), `${tag}: no sideways scroll`);
}

let exitCode = 0;
const chrome = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const safari = await webkit.launch();
try {
  // ── The builder: the owner ──────────────────
  const owner = await newPage(chrome);
  await signIn(owner, 'owner');
  let agreementLink;
  await step('the owner: the two fields under the packages; key-by-key typing and delete move the totals (Chrome)', async () => {
    await owner.goto(`${BASE}index.html`);
    await owner.locator('#start-agreement').click();
    await owner.locator('label[for="inf-niro"]').click();
    await typingChecks(owner, 'chrome 1366');
    await owner.locator('#c-name').fill('לקוח לדוגמה');
    await owner.locator('#c-company').fill('עסק לדוגמה בע״מ');
    await owner.locator('#c-companyid').fill('514729938');
    // The preview's words follow: the cover, the heading, the price row.
    await owner.locator('#btn-preview').click();
    const pv = owner.locator('#preview-body .qd');
    await pv.waitFor();
    const t = await pv.innerText();
    assert.match(t, /הסכם התקשרות/);
    assert.doesNotMatch(t, /הצעת מחיר נירו לוי/);
    assert.match(t, /מה כוללת חבילת ALL IN ONE/);
    assert.match(t, /חבילה · ALL IN ONE/);
    assert.match(t, /4,200 ₪ לחודש \+ מע״מ כחוק/);
    await owner.keyboard.press('Escape');
    await owner.locator('#quote-edit').scrollIntoViewIfNeeded();
    await shot(owner, '01-builder-fields-1366', false);
  });

  await step('the link: the request carries the price and the name; the server computes the rest', async () => {
    await owner.locator('#btn-link').click();
    await owner.locator('#sh-link').waitFor();
    agreementLink = await owner.locator('#sh-link').inputValue();
    const { createQuote: body } = lastCreate();
    assert.deepEqual(body.selection.custom, { price: 420000, packageName: 'ALL IN ONE' });
    assert.equal(body.selection.edit, undefined);
    const q = quotes.at(-1);
    assert.equal(q.model.package.monthly, 420000);
    assert.equal(q.model.package.shownName, 'ALL IN ONE');
    assert.equal(q.model.package.tierName, 'Social all in one');
    assert.equal(q.monthly_gross_agorot, 495600);
  });

  await step('a member of the office who is not a manager: the server refuses the price and the name', async () => {
    const ilai = await newPage(chrome);
    await ilai.goto(`${BASE}quotes.html`);
    await ilai.fill('#lg-email', 'ilai@astrateg.test');
    await ilai.fill('#lg-pass', 'correct-horse');
    await ilai.click('#lg-submit');
    await ilai.waitForTimeout(800);
    // The builder is not his (canBuildQuote): "אין לך גישה", no fields.
    await ilai.goto(`${BASE}index.html`);
    await ilai.locator('#no-access').waitFor();
    assert.ok(await ilai.locator('#quote-edit').isHidden());
    const status = await ilai.evaluate(async () => {
      const key = Object.keys(localStorage).find((k) => /auth-token/.test(k));
      const token = JSON.parse(localStorage.getItem(key)).access_token;
      const r = await fetch('https://czncjzziqrqtezpwxxpz.supabase.co/functions/v1/create-quote', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ selection: { docType: 'quote', tier: 'social', influencer: 'niro', paid: [], free: { graphics: 0, simeonStories: 0, simeonJoin: false, extraCh14: false }, discount: 0, custom: { price: 100 } }, client: {} }),
      });
      return [r.status, (await r.json()).error];
    });
    assert.deepEqual(status, [403, 'not allowed: only the managers change the price or the package name']);
    await ilai.context().close();
  });

  // ── The client's link ────────────────────
  const order = ['מי אנחנו', 'מה כוללת חבילת ALL IN ONE', 'למה לבחור בנו', 'פירוט החבילה', 'פירוט מחיר', 'הסכם התקשרות ותנאים', 'חתימות הצדדים'];
  for (const [tag, vp] of [['1366', { viewport: { width: 1366, height: 900 } }], ['390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
    await step(`the client's link (${tag}): the cover, the old document's order, the closing; nothing sideways`, async () => {
      const client = await newPage(chrome, vp);
      await client.goto(agreementLink);
      await client.locator('#doc .qd').waitFor();
      // An agreement keeps its title and tag (the owner, 9.11.2026); the influencer under the package.
      assert.equal(await text(client, '.qd-cover-title'), 'הסכם התקשרות');
      assert.equal(await text(client, '.qd-cover .qd-type'), 'מסמך לחתימה');
      assert.equal(await text(client, '.qd-cover-pkg'), 'ALL IN ONE');
      assert.equal(await text(client, '.qd-cover-inf'), 'נירו לוי');
      assert.deepEqual(await client.locator('#doc .qd-sec-head h2').allInnerTexts(), order);
      assert.equal(await text(client, '.qd-closing-big'), 'יחד, נהפוך את החברה להצלחה!');
      assert.match(await text(client, '.qd-closing-contact'), /info@astrateg\.com/);
      assert.ok(await noSideScroll(client), 'no sideways scroll');
      await shot(client, `02-client-agreement-${tag}`);
      await parts(client, `02-client-agreement-${tag}`);
      await client.context().close();
    });
  }

  await step('the client signs (390): the signing form under the document works as before', async () => {
    const client = await newPage(chrome, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await client.goto(agreementLink);
    await client.locator('#signbox').waitFor();
    await drawAndSign(client, 'לקוח לדוגמה');
    assert.equal(quotes.at(-1).status, 'signed');
    assert.ok(await client.locator('.qd-sign-box.is-signed').count());
    await shot(client, '03-client-signed-390');
    await client.context().close();
  });

  // ── A price offer, and one sent before ───────
  let quoteLink;
  await step('a price offer (Irit, a manager): the same order, no clauses and no signatures', async () => {
    const irit = await newPage(chrome);
    await signIn(irit, 'irit');
    await irit.goto(`${BASE}index.html`);
    await irit.locator('#start-quote').click();
    await irit.locator('#quote-edit').waitFor();
    await irit.locator('#btn-link').click();
    await irit.locator('#sh-link').waitFor();
    quoteLink = await irit.locator('#sh-link').inputValue();
    assert.equal(lastCreate().createQuote.selection.custom, undefined);
    await irit.context().close();
    for (const [tag, vp] of [['1366', { viewport: { width: 1366, height: 900 } }], ['390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
      const client = await newPage(chrome, vp);
      await client.goto(quoteLink);
      await client.locator('#doc .qd').waitFor();
      assert.deepEqual(await client.locator('#doc .qd-sec-head h2').allInnerTexts(), ['מי אנחנו', `מה כוללת חבילת ${await client.locator('.qd-cover-pkg').textContent()}`, 'למה לבחור בנו', 'פירוט החבילה', 'פירוט מחיר']);
      assert.match(await text(client, '.qd-cover-title'), /^הצעת מחיר/);
      assert.ok(await client.locator('#signbox').isHidden());
      assert.ok(await noSideScroll(client));
      await shot(client, `04-client-quote-${tag}`);
      await parts(client, `04-client-quote-${tag}`);
      await client.context().close();
    }
  });

  await step('an agreement sent before 9.11.2026 (no words in its model): drawn as it was', async () => {
    const q = quotes.at(-2);
    const old = { ...q, id: randomUUID(), token: randomUUID(), status: 'sent', signed_at: null, signer_name: null, signature_png: null, model: JSON.parse(JSON.stringify(q.model)) };
    delete old.model.wording;
    delete old.model.package.shownName;
    quotes.push(old);
    const client = await newPage(chrome);
    await client.goto(agreementLink.replace(q.token, old.token));
    await client.locator('#doc .qd').waitFor();
    assert.equal(await client.locator('.qd-cover').count(), 0);
    assert.equal(await client.locator('.qd-top').count(), 1);
    await client.context().close();
  });

  // ── WebKit as an iPhone ───────────────────
  await step('WebKit (iPhone 13): key-by-key typing and delete in the two fields', async () => {
    const page = await newPage(safari, { ...devices['iPhone 13'] });
    await signIn(page, 'owner');
    await page.goto(`${BASE}index.html`);
    await page.locator('#start-agreement').click();
    await page.locator('label[for="inf-niro"]').click();
    await typingChecks(page, 'webkit iphone');
    await page.locator('#quote-edit').scrollIntoViewIfNeeded();
    await shot(page, '05-builder-fields-iphone13-webkit', false);
    await page.context().close();
  });

  await step('Chrome 390: the builder with the two fields fits the phone', async () => {
    const page = await newPage(chrome, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await signIn(page, 'owner');
    await page.goto(`${BASE}index.html`);
    await page.locator('#start-agreement').click();
    await page.locator('#quote-edit').waitFor();
    assert.ok(await noSideScroll(page));
    await page.locator('#quote-edit').scrollIntoViewIfNeeded();
    await shot(page, '06-builder-fields-390', false);
    await page.context().close();
  });

  assert.deepEqual(errors, []);
  console.log(`\n${passed} passed`);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await chrome.close();
  await safari.close();
}
process.exit(exitCode);
