// Several influencers in one contract, in the browser (the owner, 16.11.2026; docs/ops.md, section 135),
// against the same in-memory fake of Supabase as tests/quote-old-format-e2e.mjs (the engine itself runs
// in the fake: app/pricing.js):
//   - "חוזה מותאם אישית": the chip "הצל" next to Simeon; with two influencers the collabs and the stories
//     are one small stepper per influencer; 2 collabs at Simeon, 0 at "הצל";
//   - the influencers' name (the managers') typed key by key with a Backspace, the preview's words;
//   - "בלי משפיענים" hides it all; back to one influencer, the single steppers with the sums;
//   - Chrome 1366 and WebKit as an iPhone (390); nothing scrolls sideways.
// Run: npx http-server -p 8111 -s -c-1 . &  then
//      BASE_URL=http://localhost:8111/ node tests/influencer-mix-e2e.mjs [outDir]
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
  if (!body.client?.name?.trim() && !body.client?.company?.trim() && body.selection?.docType !== 'quote') return json(400, { error: 'client name required' });
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
  // Signed in when the session is stored (a person who is not a manager moves on to his own page).
  await page.waitForFunction(() => { try { return Object.keys(localStorage).some((k) => k.endsWith('-auth-token')); } catch { return false; } });
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

// The sale of 16.11 on one browser: the custom contract on, "הצל" added, 2 collabs at Simeon and 0 at
// Hatzel, the influencers' name typed key by key (a mistake deleted), and the preview's words.
async function mixFlow(page, tag, shotPrefix) {
  await page.goto(`${BASE}index.html`);
  await page.locator('#start-quote').click();
  await page.locator('label[for="inf-simeon"]').click();
  await page.locator('#tier-social').check();
  await page.locator('#custom-on').check();
  await page.locator('#custom-body').waitFor();
  // One influencer: no per-influencer steppers, the chips are there.
  assert.equal(await page.locator('#custom-also').isVisible(), true, `${tag}: the chips`);
  assert.equal(await page.locator('.custom-per').count(), 0);
  assert.deepEqual(await page.locator('#custom-also-chips .also-chip').allInnerTexts(), ['נטלי דדון', 'נירו לוי', 'הצל', 'אריק משעלי']);
  await page.locator('#also-hatzel').click();
  assert.equal(await page.locator('#also-hatzel').getAttribute('aria-pressed'), 'true');
  // Two influencers: the collabs and the stories per influencer.
  await page.locator('#cp-collabs-simeon').waitFor();
  assert.equal(await page.locator('#cq-collabs').count(), 0, 'the single collabs stepper gives way');
  assert.equal(await page.locator('#cp-collabs-simeon').inputValue(), '1', 'the package\'s collab stays at Simeon');
  assert.equal(await page.locator('#cp-collabs-hatzel').inputValue(), '0');
  await page.locator('#cp-collabs-simeon-inc').click();
  assert.equal(await page.locator('#cp-collabs-simeon').inputValue(), '2');
  // One up at Hatzel and back down: 0 at Hatzel.
  await page.locator('#cp-collabs-hatzel-inc').click();
  assert.equal(await page.locator('#cp-collabs-hatzel').inputValue(), '1');
  await page.locator('#cp-collabs-hatzel-dec').click();
  assert.equal(await page.locator('#cp-collabs-hatzel').inputValue(), '0');
  assert.equal(await page.locator('#cp-collabs-hatzel-dec').isDisabled(), true);
  const diff = await text(page, '#custom-diff');
  assert.match(diff, /משפיענים נוספים: הצל/);
  assert.match(diff, /2 קולאבים באינסטגרם במקום 1/);
  // The builder's own "מה כלול" names both for the shoot day.
  assert.match(await text(page, '#included'), /יום צילום בבית העסק עם סמיון, מישל ודניס \+ הצל/);
  assert.match(await text(page, '#included'), /קולאבים באינסטגרם אצל סמיון, מישל ודניס/);
  assert.ok(await noSideScroll(page), `${tag}: no sideways scroll`);
  await page.locator('#custom-also').scrollIntoViewIfNeeded();
  await shot(page, `${shotPrefix}-chips`, false);
  await page.locator('#cp-collabs-simeon').scrollIntoViewIfNeeded();
  await shot(page, `${shotPrefix}-steppers`, false);
  // The influencers' name (the managers' field): the joined names as its placeholder; typed key by
  // key, a mistake deleted with Backspace.
  assert.equal(await page.locator('#qe-inf').getAttribute('placeholder'), 'סמיון, מישל ודניס + הצל');
  await typeKeys(page, '#qe-inf', 'סמיון והצלל');
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#qe-inf').inputValue(), 'סמיון והצל');
  await page.keyboard.type(' בסושיאל', { delay: 15 });
  assert.equal(await page.locator('#qe-inf').inputValue(), 'סמיון והצל בסושיאל');
  assert.match(await text(page, '#included'), /יום צילום בבית העסק עם סמיון והצל בסושיאל/);
  await page.locator('#quote-edit').scrollIntoViewIfNeeded();
  await shot(page, `${shotPrefix}-name`, false);
  // The preview: the cover, the package card, the shoot day, the collab at Simeon only.
  await page.locator('#btn-preview').click();
  const pv = page.locator('#preview-body .qd');
  await pv.waitFor();
  assert.equal(await text(page, '#preview-body .qd-cover-title'), 'הצעת מחיר סמיון והצל בסושיאל');
  const all = await pv.innerText();
  assert.match(all, /יום צילום מקצועי ומרוכז עם סמיון והצל בסושיאל/);
  assert.match(all, /שסמיון והצל בסושיאל ישתתפו בהם/);
  assert.match(all, /קולאבים באינסטגרם אצל סמיון, מישל ודניס/);
  assert.doesNotMatch(all, /קולאב[^\n]*אצל הצל/);
  await page.locator('#preview-body .qd-cover-title').scrollIntoViewIfNeeded();
  await shot(page, `${shotPrefix}-preview-cover`, false);
  await page.locator('#preview-body li', { hasText: 'יום צילום מקצועי' }).first().scrollIntoViewIfNeeded();
  await shot(page, `${shotPrefix}-preview`, false);
  await page.keyboard.press('Escape');
  // The name deleted: the joined names come back.
  await typeKeys(page, '#qe-inf', 'x');
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#qe-inf').inputValue(), '');
  assert.match(await text(page, '#included'), /יום צילום בבית העסק עם סמיון, מישל ודניס \+ הצל/);
  // What is created: the influencers and the collabs in the request, the engine's model.
  await page.locator('#c-name').fill('לקוח לדוגמה');
  await page.locator('#btn-link').click();
  await page.locator('#sh-link').waitFor();
  const sent = lastCreate()?.createQuote?.selection;
  assert.ok(sent, `${tag}: a link was asked for`);
  assert.deepEqual(sent.custom.alsoInfluencers, ['hatzel']);
  assert.equal(sent.custom.qty.collabs, 2);
  const q = quotes.at(-1);
  assert.equal(q.model.package.shownInfluencer, 'סמיון, מישל ודניס + הצל');
  assert.equal(q.model.wording.cover.title, 'הצעת מחיר סמיון, מישל ודניס + הצל');
}

let exitCode = 0;
const chrome = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const safari = await webkit.launch();
try {
  await step('Chrome 1366: chips, steppers per influencer, the name typed key by key, the preview', async () => {
    const page = await newPage(chrome);
    await signIn(page, 'owner');
    await mixFlow(page, 'chrome 1366', 'mix-1366');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.context().close();
  });
  await step('WebKit as an iPhone (390): the same, key by key', async () => {
    const page = await newPage(safari, { ...devices['iPhone 13'] });
    await signIn(page, 'owner');
    await mixFlow(page, 'webkit iphone', 'mix-iphone');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.context().close();
  });
  await step('Chrome 390: "בלי משפיענים" hides the chips and the steppers; back to one influencer, the plain steppers', async () => {
    const page = await newPage(chrome, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await signIn(page, 'owner');
    await page.goto(`${BASE}index.html`);
    await page.locator('#start-agreement').click();
    await page.locator('#custom-on').check();
    await page.locator('#also-niro').click();
    await page.locator('#cp-stories-niro').waitFor();
    await page.locator('#custom-noinf').check();
    assert.equal(await page.locator('#custom-also').isVisible(), false);
    assert.equal(await page.locator('.custom-per').count(), 0);
    await page.locator('#custom-noinf').uncheck();
    assert.equal(await page.locator('#also-niro').getAttribute('aria-pressed'), 'true');
    // Back to one influencer: the single steppers again, with the sums.
    await page.locator('#cp-stories-niro-inc').click();
    await page.locator('#also-niro').click();
    assert.equal(await page.locator('.custom-per').count(), 0);
    assert.equal(await page.locator('#cq-stories').inputValue(), '0', 'Niro\'s story left with him');
    assert.ok(await noSideScroll(page));
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.context().close();
  });
  assert.deepEqual(errors, [], JSON.stringify(errors));
  console.log(`\n${passed} passed`);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await chrome.close();
  await safari.close();
}
process.exit(exitCode);
