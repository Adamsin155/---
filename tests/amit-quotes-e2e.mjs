// Amit builds quotes and contracts and sees the list of sent quotes with its amounts, as Irit (the owner,
// 22.11.2026; docs/ops.md, section 144), in the browser, against an in-memory fake of Supabase (as in
// tests/quote-pdf-e2e.mjs):
//   - her menu has "הצעה חדשה והכנת חוזה" and "הצעות שנשלחו"; Ilai's has neither;
//   - quotes.html shows her the amounts column and the month's sums;
//   - the builder: an agreement with the business typed key by key, with Backspace, and the package's
//     price changed for this quote ("שינויים להצעה הזו", hers now too); the link is created by her;
//   - the new contract is in her list with its amount;
//   - the same on WebKit as an iPhone 13, and the list at 390 in Chrome.
// Run: node <static server> . 8121 &  then
//      BASE_URL=http://localhost:8121/ node tests/amit-quotes-e2e.mjs [outDir]
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
// Sunday 22.11.2026, 10:00 in Jerusalem.
const NOW = new Date('2026-11-22T08:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();

const PEOPLE = { owner: null, amit: 'amit', ilai: 'ilai' };
const users = new Map();
const staff = [];
for (const [k, person] of Object.entries(PEOPLE)) {
  const email = `${k}@astrateg.test`;
  users.set(email, { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: NOW.toISOString() });
  staff.push({ email, person, vault: false });
}
const OFFICE = new Set(['irit', 'lior', 'ofir', 'ilai', 'amit', 'shiel', null]);
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
// public.can_edit_quotes() and public.sees_quote_money(): the managers and Amit.
const canEditQuotes = (u) => isManager(u) || (isStaff(u) && personOf(u) === 'amit');
const seesQuoteMoney = canEditQuotes;

const quotes = [];
const calls = [];
let seq = 140;

function createQuote(body, me, json) {
  calls.push({ selection: body.selection, client: body.client, by: me?.email });
  if (!me) return json(401, { error: 'not signed in' });
  if (!isOffice(me)) return json(403, { error: 'not staff: quotes are prepared by the office' });
  let selection;
  try { validateSelection(body.selection); selection = normalizeSelection(body.selection); } catch (e) { return json(400, { error: e.message }); }
  const c = selection.custom;
  if (c && (c.price !== undefined || c.packageName !== undefined) && !canEditQuotes(me)) {
    return json(403, { error: 'not allowed: only the managers change the price or the package name' });
  }
  if (!body.client?.name?.trim() && !body.client?.company?.trim() && body.selection?.docType !== 'quote') return json(400, { error: 'client name required' });
  const exceptions = exceptionOf(selection);
  const model = buildQuoteModel(selection, body.client);
  const q = {
    id: randomUUID(), token: randomUUID(), number: `AST-2026-${String(++seq).padStart(4, '0')}`, created_at: serverNow(), created_by_email: me.email,
    model, client_name: model.client.name || model.client.company, monthly_gross_agorot: model.totals.monthlyGross, term_gross_agorot: model.totals.termGross, status: 'sent',
    first_viewed_at: null, signed_at: null, signer_name: null, signature_png: null, approval: 'none', exceptions: exceptions.length ? exceptions : null,
  };
  q.model = { ...model, number: q.number, createdAt: q.created_at };
  q.expires_at = new Date(Date.parse(serverNow()) + model.validHours * 3600e3).toISOString();
  q.model.validUntil = q.expires_at;
  quotes.push(q);
  return json(200, { id: q.id, token: q.token, number: q.number, created_at: q.created_at });
}

function rpc(name, body, me, json) {
  if (name === 'is_staff') return json(200, isStaff(me));
  if (name === 'is_office') return json(200, isOffice(me));
  if (name === 'is_manager') return json(200, isManager(me));
  if (name === 'can_edit_quotes') return json(200, canEditQuotes(me));
  if (name === 'sees_quote_money') return json(200, seesQuoteMoney(me));
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
  if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const u = [...users.values()].find((x) => `r-${x.id}` === body?.refresh_token);
    return u ? json(200, sessionFor(u)) : json(400, { error: 'invalid_grant', msg: 'Invalid Refresh Token' });
  }
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
  // public.quotes: the restrictive policy lets through whoever sees the quotes' money, and the maker.
  if (m[1] === 'quotes') return out(quotes.filter((q) => seesQuoteMoney(me) || q.created_by_email === me.email).map(quoteRow).reverse());
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    return out(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff);
  }
  return out([]);
}

const errors = [];
async function newPage(browser, viewport = { viewport: { width: 1366, height: 900 } }) {
  // The site's service worker would send the requests past this fake after the first page (seen on
  // WebKit: the second page then had no session), so it is blocked here.
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', serviceWorkers: 'block', ...viewport });
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
  await page.goto(`${BASE}quotes.html`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
}
// The list, once the sign-in screen and its animation are gone.
async function listReady(page) {
  await page.locator('#list-block').waitFor();
  await page.locator('#login-block').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.querySelector('.login-leaving, .is-entering, [data-login-anim]'));
  await page.waitForTimeout(1200);
}
const shot = async (page, name, fullPage = false) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage }); };
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}
const menuHrefs = (page) => page.locator('#side-nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
// Types like a person: key by key, a slip fixed with Backspace.
async function typeLikeAPerson(page, sel, text, slip = 'xx') {
  const input = page.locator(sel);
  await input.click();
  await input.pressSequentially(text.slice(0, 3), { delay: 25 });
  await input.pressSequentially(slip, { delay: 25 });
  for (let i = 0; i < slip.length; i += 1) await input.press('Backspace');
  await input.pressSequentially(text.slice(3), { delay: 25 });
  assert.equal(await input.inputValue(), text, `${sel} after typing`);
}
async function buildAgreement(page, business, price, tag) {
  await page.goto(`${BASE}index.html`);
  await page.locator('#start-agreement').click();
  await page.locator('label[for="inf-niro"]').click();
  // "שינויים להצעה הזו": hers since 22.11.2026.
  await page.locator('#quote-edit').waitFor();
  await page.locator('#qe-price').scrollIntoViewIfNeeded();
  await page.locator('#qe-price').fill('');
  await page.locator('#qe-price').pressSequentially(String(price), { delay: 25 });
  await page.locator('#qe-price').press('Backspace');
  await page.locator('#qe-price').pressSequentially(String(price).slice(-1), { delay: 25 });
  assert.equal(await page.locator('#qe-price').inputValue(), String(price));
  await page.locator('#c-company').scrollIntoViewIfNeeded();
  await typeLikeAPerson(page, '#c-company', business);
  await typeLikeAPerson(page, '#c-companyid', '514729938', '77');
  await shot(page, `${tag}-builder-client`);
  await page.locator('#btn-link').click();
  await page.locator('#sh-link').waitFor();
  await shot(page, `${tag}-builder-link`);
}

let exitCode = 0;
const chrome = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const safari = await webkit.launch();
try {
  const amit = await newPage(chrome);

  await step('Amit (1366): her menu has the builder and the list; the list shows the amounts', async () => {
    await signIn(amit, 'amit');
    await listReady(amit);
    const hrefs = await menuHrefs(amit);
    assert.ok(hrefs.includes('index.html') && hrefs.includes('quotes.html'), hrefs.join(' '));
    assert.ok(!hrefs.some((h) => /payments|payouts|insights|team\.html/.test(h)), hrefs.join(' '));
    assert.equal(await amit.locator('#th-amt').isHidden(), false);
    assert.ok(await amit.locator('#stats.has-money').count());
    await shot(amit, '01-amit-list-empty-1366');
  });

  await step('Amit (Chrome 1366): an agreement typed key by key, with the price changed; created by her', async () => {
    await buildAgreement(amit, 'קפה נואר בע״מ', 5200, '02-amit-chrome-1366');
    const last = calls.at(-1);
    assert.equal(last.by, 'amit@astrateg.test');
    assert.equal(last.client.company, 'קפה נואר בע״מ');
    assert.equal(last.selection.custom?.price, 520000);
    assert.equal(quotes.length, 1);
  });

  await step('Amit (1366): the new contract in her list with its amount', async () => {
    await amit.goto(`${BASE}quotes.html`);
    await listReady(amit);
    await amit.locator('td.amt').first().waitFor();
    const row = await amit.locator('#list-block').innerText();
    assert.match(row, /קפה נואר/);
    assert.match(await amit.locator('td.amt').first().innerText(), /₪/);
    await shot(amit, '03-amit-list-1366');
  });

  await step('Amit (Chrome 390): the list with its amounts on the phone', async () => {
    const phone = await newPage(chrome, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await signIn(phone, 'amit');
    await listReady(phone);
    await phone.locator('td.amt').first().waitFor();
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `no sideways scroll (${overflow}px)`);
    await shot(phone, '04-amit-list-390');
    await phone.context().close();
  });

  await step('Amit (WebKit, iPhone 13): an agreement typed key by key, then her list', async () => {
    const page = await newPage(safari, { ...devices['iPhone 13'] });
    await signIn(page, 'amit');
    await listReady(page);
    await buildAgreement(page, 'מאפיית שירן', 4800, '05-amit-webkit-iphone13');
    assert.equal(calls.at(-1).by, 'amit@astrateg.test');
    assert.equal(calls.at(-1).client.company, 'מאפיית שירן');
    await page.goto(`${BASE}quotes.html`);
    await listReady(page);
    await page.locator('td.amt').first().waitFor();
    assert.match(await page.locator('#list-block').innerText(), /מאפיית שירן/);
    await shot(page, '06-amit-list-iphone13-webkit');
    await page.context().close();
  });

  await step('Ilai (control): no builder and no list in his menu', async () => {
    const page = await newPage(chrome);
    await page.goto(`${BASE}clients.html`);
    await page.fill('#lg-email', 'ilai@astrateg.test');
    await page.fill('#lg-pass', 'correct-horse');
    await page.click('#lg-submit');
    await page.locator('#side-nav a').first().waitFor();
    const hrefs = await menuHrefs(page);
    assert.ok(!hrefs.includes('index.html') && !hrefs.includes('quotes.html'), hrefs.join(' '));
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
