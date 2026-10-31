// End-to-end check of the owner's decisions of 31.10.2026 in the browser, against an in-memory fake
// of Supabase whose deal_take is first-wins, as public.deal_take
// (supabase/migrations/20261122100000_deal_pool.sql):
//   - Stav on an iPhone 13 (WebKit) and on Chromium at 360px: real typing and deleting, key by key, in
//     the company number, the address and the discount; an agreement needs the two, a price offer
//     does not; "הנחה חריגה" lifts the discount limit.
//   - The builder, the same two engines: the agreement refuses without them and puts the cursor there;
//     the address reaches create-quote, the document and the client's page.
//   - Irit and Ofir, each on their own device (the two phones and 1280): both see "אני לוקח"; Ofir takes
//     it; the builder opens prefilled; Irit sees "אופיר לקח" with no buttons; her stale press gets the
//     toast and goes nowhere; Stav reads "ממתין לחוזה · אצל אופיר"; the owner hands it over.
//   - Nothing scrolls sideways, the targets are 44px, no page errors, nothing the CSP refused.
// Run: npx http-server -p 8094 -s -c-1 . &  then  BASE_URL=http://localhost:8094/ node tests/deal-pool-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { withClientColumns } from './fake-clients.mjs';
import { validateSelection, normalizeSelection, buildQuoteModel } from '../app/pricing.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Monday 5.10.2026, 10:00 in Jerusalem: an office day.
const NOW = new Date('2026-10-05T07:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();
const minutesAgo = (n) => new Date(Date.now() + skew - n * 6e4).toISOString();

const COMPANY = '514729938';
const ADDRESS = 'רחוב הרצל 12, תל אביב';

const users = new Map();
for (const email of ['stav', 'irit', 'ofir', 'owner'].map((p) => `${p}@astrateg.test`)) {
  users.set(email, { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-01-01T00:00:00Z' });
}
const staff = [
  { email: 'stav@astrateg.test', person: 'stav', vault: false },
  { email: 'irit@astrateg.test', person: 'irit', vault: true },
  { email: 'ofir@astrateg.test', person: 'ofir', vault: false },
  { email: 'owner@astrateg.test', person: null, vault: true },
];
const deals = [];
const quotes = [];
const calls = [];
const created = () => calls.filter((c) => c.createQuote).map((c) => c.createQuote);
const inserted = () => calls.filter((c) => c.insert).map((c) => c.insert);

const EXP = Math.floor(NOW / 1000) + 8 * 3600;
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const sessionFor = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 8 * 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const staffOf = (u) => staff.find((s) => s.email === u?.email);
const personOf = (u) => staffOf(u)?.person;
const isOwner = (u) => !!staffOf(u) && staffOf(u).person === null;
const preparer = (u) => ['irit', 'ofir'].includes(personOf(u));

// As the table answers: row level security, and the trigger public.deal_requests_taken.
function dealsRoute(req, url, me, json) {
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const filters = [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
  const match = (d) => filters.every(([k, v]) => (v.startsWith('eq.') ? String(d[k]) === v.slice(3) : true));
  const mine = (d) => isOwner(me) || preparer(me) || d.created_by_email === me.email;
  const one = (req.headers().accept || '').includes('vnd.pgrst.object');
  const out = (rows) => (one ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  if (req.method() === 'GET') return out(deals.filter(mine).filter(match).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
  if (req.method() === 'POST') {
    calls.push({ insert: body });
    if (personOf(me) !== 'stav') return json(403, { code: '42501', message: 'new row violates row-level security policy' });
    const d = { ...body, id: randomUUID(), created_at: serverNow(), created_by_email: me.email, seller: 'stav', status: 'pending', quote_id: null, sent_at: null, signed_at: null, status_by_email: null, taken_by: null, taken_at: null };
    deals.push(d);
    return out([d]);
  }
  if (req.method() === 'PATCH') {
    calls.push({ update: body, where: Object.fromEntries(filters), by: me.email });
    const rows = deals.filter(match);
    for (const d of rows) {
      if (!isOwner(me) && d.taken_by && d.taken_by !== personOf(me)) return json(400, { code: 'P0001', message: 'deal_taken' });
      if (!isOwner(me) && d.status === 'pending' && !d.taken_by) return json(400, { code: 'P0001', message: 'deal_not_taken' });
      Object.assign(d, body);
      if (body.quote_id && d.status === 'pending') d.status = 'sent';
    }
    return out(rows);
  }
  return json(405, {});
}

function createQuote(body, me, json) {
  calls.push({ createQuote: body });
  if (!me) return json(401, { error: 'not signed in' });
  let selection;
  try { validateSelection(body.selection); selection = normalizeSelection(body.selection); } catch (e) { return json(400, { error: e.message }); }
  // As the function: an agreement needs the name, the company number and the address.
  if (selection.docType !== 'quote') {
    if (!body.client?.name?.trim()) return json(400, { error: 'client name required' });
    if (!body.client?.companyId?.trim()) return json(400, { error: 'client company id required' });
    if (!body.client?.address?.trim()) return json(400, { error: 'client address required' });
  }
  const model = buildQuoteModel(selection, body.client);
  const q = {
    id: randomUUID(), token: randomUUID(), number: `AST-2026-${String(100 + quotes.length)}`, created_at: serverNow(), created_by_email: me.email,
    model: { ...model }, client_name: model.client.name, monthly_gross_agorot: model.totals.monthlyGross, status: 'sent', approval: 'none',
    expires_at: new Date(Date.parse(serverNow()) + model.validHours * 3600e3).toISOString(),
  };
  q.model.number = q.number;
  quotes.push(q);
  return json(200, { id: q.id, token: q.token, number: q.number, created_at: q.created_at, approval: 'none' });
}
const view = (q) => ({
  number: q.number, createdAt: q.created_at, model: q.model, docHash: 'ab'.repeat(32), expiresAt: q.expires_at, expired: false,
  consentText: `קראתי ואני מאשר/ת את הסכם ההתקשרות ${q.number}`, signatureHash: null, status: q.status, signerName: null, signedAt: null, signaturePng: null,
});

function rpc(name, body, me, json) {
  if (name === 'is_staff') return json(200, !!staffOf(me));
  if (name === 'is_office') return json(200, isOwner(me) || preparer(me));
  if (name === 'my_person') return json(200, personOf(me) ?? null);
  if (name === 'get_quote') {
    const q = quotes.find((x) => x.token === body.p_token);
    return json(200, q ? view(q) : null);
  }
  if (name === 'deal_take') {
    calls.push({ take: body.p_id, by: personOf(me) ?? 'owner' });
    if (!isOwner(me) && !preparer(me)) return json(403, { code: '42501', message: 'not allowed' });
    const d = deals.find((x) => x.id === body.p_id);
    if (!d) return json(404, { code: 'P0002', message: 'deal not found' });
    // One row: of two presses only the first finds it free.
    if (!isOwner(me) && !d.taken_by && d.status === 'pending') Object.assign(d, { taken_by: personOf(me), taken_at: serverNow() });
    return json(200, { ok: isOwner(me) || !d.taken_by || d.taken_by === personOf(me), taken_by: d.taken_by, status: d.status });
  }
  if (name === 'deal_hand_over') {
    calls.push({ handOver: body.p_id, to: body.p_person });
    if (!isOwner(me)) return json(403, { code: '42501', message: 'not allowed' });
    const d = deals.find((x) => x.id === body.p_id && x.status === 'pending');
    if (!d) return json(404, { code: 'P0002', message: 'deal not waiting' });
    Object.assign(d, { taken_by: body.p_person, taken_at: serverNow() });
    return json(200, { ok: true, taken_by: d.taken_by, status: d.status });
  }
  return json(200, []);
}

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
    const u = users.get(String(body?.email || '').toLowerCase());
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
  if (m[1] === 'deal_requests') return dealsRoute(req, url, me, json);
  const many = (rows) => ((req.headers().accept || '').includes('vnd.pgrst.object') ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116' })) : json(200, rows));
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    return many(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff);
  }
  return many([]);
}

const errors = [];
async function newPage(engine) {
  // No service worker: in WebKit its requests would not pass through the fake.
  const ctx = await engine.browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', serviceWorkers: 'block', ...engine.options });
  await ctx.clock.install({ time: new Date(serverNow()) });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => [], staff: () => staff }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, who, path, ready) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.locator(ready).first().waitFor();
  // The sign-in card's goodbye (the door) is over before anything is looked at.
  await page.waitForFunction(() => !document.querySelector('#lg-email')?.offsetParent, null, { timeout: 15000 });
  await page.waitForTimeout(400);
}
const MINE = 'clients.html#mine';
const MINE_READY = '#view-mine:not([hidden])';
async function freshBuilder(page, doc) {
  await page.goto(`${BASE}index.html`);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.locator(`#start-${doc}`).click();
  await page.locator('#c-name').waitFor();
}
// Key by key, as a person types and corrects: the last `del` characters are deleted with Backspace
// and typed again. What comes out is exactly what was meant, at each stage.
async function typeAndCorrect(page, sel, value, del) {
  const el = page.locator(sel);
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await page.keyboard.press('End');
  for (let n = (await el.inputValue()).length; n > 0; n -= 1) await page.keyboard.press('Backspace');
  assert.equal(await el.inputValue(), '', `${sel} emptied by Backspace`);
  await el.pressSequentially(value, { delay: 8 });
  assert.equal(await el.inputValue(), value, `${sel} typed`);
  for (let i = 0; i < del; i += 1) await page.keyboard.press('Backspace');
  assert.equal(await el.inputValue(), value.slice(0, value.length - del), `${sel} after ${del} deletes`);
  await el.pressSequentially(value.slice(value.length - del), { delay: 8 });
  assert.equal(await el.inputValue(), value, `${sel} typed again`);
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.offsetParent && el.getBoundingClientRect().height < 43.5)
  .map((el) => `${el.id || el.className || el.textContent.trim().slice(0, 20)}:${Math.round(el.getBoundingClientRect().height)}`), sel);
const activeId = (page) => page.evaluate(() => document.activeElement?.id);
async function settled(page, id) {
  await page.waitForFunction((x) => document.activeElement?.id === x, id, { timeout: 4000 }).catch(() => {});
  assert.equal(await activeId(page), id, 'the cursor is in the field');
}
const cardOf = (page, id) => page.locator(`.deal-task[data-deal="${id}"]`);
const TAKE = 'אני לוקח';
const actionsOf = (card) => card.locator('.deal-task-acts a, .deal-task-acts button').allInnerTexts();

let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last calls: ${JSON.stringify(calls.slice(-3)).slice(0, 900)}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

// ── Stav's form ───────────────────────────
async function stavForm(engine) {
  const L = engine.label;
  deals.length = 0;
  const stav = await newPage(engine);
  await signIn(stav, 'stav', 'deal.html', '#deal-form:not([hidden])');
  const sent = () => inserted().length;
  const start = sent();

  await step(`${L}: Stav, an agreement without the company number and the address: both say so, nothing is sent`, async () => {
    await stav.fill('#d-business', 'פיצה רון');
    await stav.fill('#d-contact', 'רון כהן');
    await stav.fill('#d-phone', '050-7654321');
    assert.equal(await stav.locator('#d-company_id-req').isVisible(), false, 'no star before the choice');
    await stav.check('#d-doc-agreement');
    assert.equal(await stav.locator('#d-company_id-req').isVisible(), true);
    assert.equal(await stav.locator('#d-business_address-req').isVisible(), true);
    assert.equal(await stav.locator('#d-submit').innerText(), 'לעירית ולאופיר להכנת חוזה');
    await stav.fill('#d-text', 'סיכום קצר');
    await stav.click('#d-submit');
    assert.match(await stav.locator('#d-company_id-err').innerText(), /בחוזה חובה למלא ח\.פ/);
    assert.match(await stav.locator('#d-business_address-err').innerText(), /בחוזה חובה למלא את כתובת העסק/);
    assert.equal(sent(), start, 'nothing sent');
    await stav.fill('#d-text', '');
  });

  await step(`${L}: Stav types and deletes, key by key: the number and the Hebrew address come out exactly as typed`, async () => {
    await typeAndCorrect(stav, '#d-company_id', COMPANY, 3);
    assert.equal(await stav.locator('#d-company_id-err').isVisible(), false, 'the error goes as he types');
    await typeAndCorrect(stav, '#d-business_address', ADDRESS, 4);
    assert.equal(await stav.locator('#d-business_address-err').isVisible(), false);
    // 16px: Safari does not zoom into the field.
    for (const id of ['d-company_id', 'd-business_address', 'd-discount']) assert.equal(await stav.locator(`#${id}`).evaluate((el) => getComputedStyle(el).fontSize), '16px', id);
  });

  await step(`${L}: the discount: 1,500 ₪ without "הנחה חריגה" is refused; with it, up to the package's price; the row goes in the column of its own`, async () => {
    await stav.click('#d-to-package');
    await stav.check('#d-influencer-natali');
    await stav.check('#d-tier-social');
    await typeAndCorrect(stav, '#d-discount', '1500', 2);
    await stav.click('#d-submit');
    assert.match(await stav.locator('#d-discount-err').innerText(), /סכום גבוה יותר: לסמן ״הנחה חריגה״/);
    assert.equal(sent(), start, 'nothing sent');
    await stav.locator('label[for="d-special"]').click();
    assert.equal(await stav.isChecked('#d-special'), true);
    assert.equal(await stav.locator('#d-discount-err').isVisible(), false, 'the error goes with the box');
    assert.equal(await stav.locator('#d-discount-label').innerText(), 'הנחה חריגה לחודש (₪)');
    assert.equal(await stav.inputValue('#d-discount'), '1500', 'what he typed stays');
    // Above the package's monthly price (3,900 ₪): refused even so.
    await typeAndCorrect(stav, '#d-discount', '4000', 1);
    await stav.click('#d-submit');
    assert.match(await stav.locator('#d-discount-err').innerText(), /עד המחיר החודשי של החבילה/);
    assert.equal(sent(), start, 'nothing sent');
    await typeAndCorrect(stav, '#d-discount', '1500', 2);
    assert.equal(await noSideScroll(stav), true, 'no sideways scroll');
    assert.deepEqual(await smallTargets(stav, '#deal-form .deal-choice, #deal-form .input, #d-submit'), []);
    await shot(stav, `01-stav-form-agreement-special-${L}`);
    await stav.click('#d-submit');
    await stav.locator('#deal-list .deal-item').first().waitFor();
    const row = inserted().at(-1);
    assert.deepEqual(
      [row.doc_type, row.company_id, row.business_address, row.tier, row.influencer, row.special_discount_agorot, row.discount_agorot],
      ['agreement', COMPANY, ADDRESS, 'social', 'natali', 150000, 0],
    );
    assert.match(await stav.locator('#deal-list .deal-item').first().innerText(), /פיצה רון[\s\S]*ממתין לחוזה/);
    assert.equal(await stav.isChecked('#d-special'), false, 'the next deal starts with the box off');
    assert.equal(await stav.inputValue('#d-company_id'), '', 'the next deal starts clean');
    assert.equal(await stav.inputValue('#d-business_address'), '');
  });

  await step(`${L}: a price offer goes without the two: no star, no error, sent`, async () => {
    const before = sent();
    await stav.fill('#d-business', 'שטיחי רות');
    await stav.fill('#d-contact', 'רות');
    await stav.fill('#d-phone', '050-1234567');
    await stav.check('#d-doc-quote');
    assert.equal(await stav.locator('#d-company_id-req').isVisible(), false);
    assert.equal(await stav.locator('#d-business_address-req').isVisible(), false);
    await stav.locator('#d-text').fill('בלי משפיען 4,900 בחודש');
    await stav.click('#d-submit');
    await stav.waitForFunction(() => document.querySelectorAll('#deal-list .deal-item').length === 2);
    assert.equal(sent(), before + 1);
    const row = inserted().at(-1);
    assert.equal(row.doc_type, 'quote');
    assert.equal('company_id' in row, false);
    assert.equal('business_address' in row, false);
    assert.equal(await noSideScroll(stav), true);
  });

  await step(`${L}: a price offer may still carry them, typed the same way`, async () => {
    await stav.fill('#d-business', 'מוסך דוד');
    await stav.fill('#d-contact', 'דוד');
    await stav.fill('#d-phone', '050-1112222');
    await stav.check('#d-doc-quote');
    await typeAndCorrect(stav, '#d-company_id', '51-4729938', 2);
    await typeAndCorrect(stav, '#d-business_address', 'התעשייה 4, חולון', 2);
    await stav.locator('#d-text').fill('2,000 בחודש');
    await stav.click('#d-submit');
    await stav.waitForFunction(() => document.querySelectorAll('#deal-list .deal-item').length === 3);
    const row = inserted().at(-1);
    assert.deepEqual([row.company_id, row.business_address], ['51-4729938', 'התעשייה 4, חולון']);
  });
  await stav.context().close();
}

// ── The builder ───────────────────────────
async function builderFields(engine) {
  const L = engine.label;
  const irit = await newPage(engine);
  await signIn(irit, 'irit', MINE, MINE_READY);

  await step(`${L}: the builder, an agreement: refuses without the number, then without the address, with the cursor in the field; nothing is created`, async () => {
    await freshBuilder(irit, 'agreement');
    const n = created().length;
    await irit.locator('#c-name').fill('רון כהן');
    assert.equal(await irit.locator('#c-companyid-req').isVisible(), true, 'the star');
    assert.equal(await irit.locator('#c-address-req').isVisible(), true, 'the star');
    await irit.locator('#btn-link').click();
    assert.match(await irit.locator('#c-companyid-err').innerText(), /בחוזה חובה למלא ח\.פ/);
    await settled(irit, 'c-companyid');
    assert.equal(await irit.locator('#c-address-err').isVisible(), true);
    await typeAndCorrect(irit, '#c-companyid', COMPANY, 3);
    await irit.locator('#btn-link').click();
    assert.equal(await irit.locator('#c-companyid-err').isVisible(), false);
    assert.match(await irit.locator('#c-address-err').innerText(), /בחוזה חובה למלא את כתובת העסק/);
    await settled(irit, 'c-address');
    assert.equal(created().length, n, 'nothing created');
    assert.equal(await irit.locator('#dlg-share').isVisible(), false);
  });

  await step(`${L}: real typing and deleting in the address: exact; the preview and create-quote carry it, and so does the client's page`, async () => {
    await typeAndCorrect(irit, '#c-address', ADDRESS, 4);
    assert.equal(await irit.locator('#c-address-err').isVisible(), false, 'the error goes as she types');
    assert.equal(await irit.locator('#c-address').evaluate((el) => getComputedStyle(el).fontSize), '16px');
    assert.deepEqual(await smallTargets(irit, '#c-address, #c-companyid'), []);
    assert.equal(await noSideScroll(irit), true);
    await irit.locator('#btn-preview').click();
    await irit.locator('#dlg-preview[open]').waitFor();
    const doc = await irit.locator('#preview-body').innerText();
    assert.ok(doc.includes(ADDRESS), 'the address in the document');
    assert.ok(doc.includes(COMPANY), 'the number in the document');
    await irit.locator('#dlg-preview .close').click();
    await irit.locator('#btn-link').click();
    await irit.locator('#dlg-share[open]').waitFor();
    const sent = created().at(-1);
    assert.deepEqual([sent.client.companyId, sent.client.address], [COMPANY, ADDRESS]);
    const q = quotes.at(-1);
    assert.deepEqual([q.model.client.companyId, q.model.client.address], [COMPANY, ADDRESS]);
    const client = await newPage(engine);
    await client.goto(await irit.locator('#sh-link').inputValue());
    await client.locator('.qd').waitFor();
    assert.ok((await client.locator('.qd').innerText()).includes(ADDRESS), 'the address on the client\'s page');
    assert.equal(await noSideScroll(client), true);
    await client.context().close();
    await irit.locator('#dlg-share .close').click();
  });

  await step(`${L}: the builder, a price offer: passes without them`, async () => {
    await freshBuilder(irit, 'quote');
    assert.equal(await irit.locator('#c-companyid-req').isVisible(), false);
    assert.equal(await irit.locator('#c-address-req').isVisible(), false);
    const n = created().length;
    await irit.locator('#btn-link').click();
    await irit.locator('#dlg-share[open]').waitFor();
    assert.equal(created().length, n + 1);
    assert.deepEqual([created().at(-1).client.companyId, created().at(-1).client.address], ['', '']);
    assert.equal(await irit.locator('#c-address-err').isVisible(), false);
    await irit.locator('#dlg-share .close').click();
  });

  await step(`${L}: a number that is not one is still refused, in a price offer too`, async () => {
    await typeAndCorrect(irit, '#c-companyid', 'abc', 1);
    await irit.locator('#btn-preview').click();
    assert.match(await irit.locator('#c-companyid-err').innerText(), /מספר לא תקין/);
    await settled(irit, 'c-companyid');
  });
  await irit.context().close();
}

// ── Who takes it ──────────────────────────
const dealRow = (o) => ({
  id: randomUUID(), created_at: minutesAgo(5), created_by_email: 'stav@astrateg.test', seller: 'stav', business_name: 'פיצה רון', contact_name: 'רון כהן', phone: '050-7654321',
  tier: 'social', influencer: 'natali', paid: [], free: {}, discount_agorot: 0, special_discount_agorot: 150000, company_id: COMPANY, business_address: ADDRESS, doc_type: 'agreement',
  notes: null, custom: null, status: 'pending', quote_id: null, sent_at: null, signed_at: null, status_by_email: null, taken_by: null, taken_at: null, ...o,
});

async function pool(engine) {
  const L = engine.label;
  deals.length = 0;
  const d = dealRow();
  deals.push(d);
  const irit = await newPage(engine);
  const ofir = await newPage(engine);
  await signIn(irit, 'irit', MINE, MINE_READY);
  await signIn(ofir, 'ofir', MINE, MINE_READY);

  await step(`${L}: Irit and Ofir, each on their own: the same card, "אני לוקח" and nothing else`, async () => {
    for (const [page, who] of [[irit, 'irit'], [ofir, 'ofir']]) {
      await cardOf(page, d.id).waitFor();
      const t = await cardOf(page, d.id).innerText();
      assert.match(t, /להכין חוזה ל־פיצה רון/);
      assert.match(t, /הנחה חריגה 1,500 ₪ לחודש/);
      assert.match(t, /ח\.פ 514729938 · רחוב הרצל 12, תל אביב/);
      assert.match(t, /נשארו \d+:\d\d/);
      assert.deepEqual(await actionsOf(cardOf(page, d.id)), [TAKE], who);
      assert.deepEqual(await smallTargets(page, '.deal-task-acts .btn'), [], who);
      assert.equal(await noSideScroll(page), true, who);
    }
    await shot(irit, `02-irit-card-before-${L}`);
  });

  await step(`${L}: Ofir presses first: the builder opens prefilled, the exceptional discount in a custom contract`, async () => {
    await cardOf(ofir, d.id).locator('button', { hasText: TAKE }).click();
    await ofir.waitForURL(/index\.html\?deal=/);
    await ofir.waitForFunction(() => document.getElementById('c-company').value === 'פיצה רון');
    assert.equal(d.taken_by, 'ofir');
    assert.ok(d.taken_at);
    assert.equal(await ofir.inputValue('#c-companyid'), COMPANY);
    assert.equal(await ofir.inputValue('#c-address'), ADDRESS);
    assert.equal(await ofir.inputValue('#c-name'), 'רון כהן');
    assert.equal(await ofir.inputValue('#c-phone'), '050-7654321');
    assert.equal(await ofir.isChecked('#custom-on'), true, 'a custom contract');
    assert.equal(await ofir.locator('#custom-body').isVisible(), true);
    assert.equal(await ofir.inputValue('#discount'), '1500');
    assert.equal(await ofir.locator('#t-mnet').first().innerText(), '2,400 ₪');
    assert.equal(await noSideScroll(ofir), true);
    await ofir.locator('#c-address').scrollIntoViewIfNeeded();
    await shot(ofir, `03-builder-address-${L}`);
    await ofir.locator('#btn-preview').click();
    await ofir.locator('#dlg-preview[open]').waitFor();
    assert.ok((await ofir.locator('#preview-body').innerText()).includes(ADDRESS));
    await shot(ofir, `04-document-address-${L}`);
    await ofir.locator('#dlg-preview .close').click();
  });

  await step(`${L}: back on his list, Ofir holds it: the work buttons, not "אני לוקח"`, async () => {
    await ofir.goto(`${BASE}${MINE}`);
    await cardOf(ofir, d.id).waitFor();
    assert.deepEqual(await actionsOf(cardOf(ofir, d.id)), ['להכנת החוזה', 'החוזה נשלח', 'בוטל']);
    assert.equal(await cardOf(ofir, d.id).locator('a.btn').getAttribute('href'), `index.html?deal=${d.id}`);
    assert.match(await cardOf(ofir, d.id).locator('.deal-clock').innerText(), /נשארו \d+:\d\d/);
    assert.deepEqual(await smallTargets(ofir, '.deal-task-acts .btn'), []);
    assert.equal(await noSideScroll(ofir), true);
    await shot(ofir, `05-ofir-card-after-${L}`);
  });

  await step(`${L}: Irit, after a refresh: "אופיר לקח", no buttons`, async () => {
    await irit.reload();
    await cardOf(irit, d.id).waitFor();
    assert.equal(await cardOf(irit, d.id).locator('.deal-clock').innerText(), 'אופיר לקח');
    assert.deepEqual(await actionsOf(cardOf(irit, d.id)), []);
    assert.equal(await noSideScroll(irit), true);
    await shot(irit, `06-irit-card-taken-${L}`);
  });

  await step(`${L}: Irit's stale "אני לוקח": a toast, no navigation, and the card catches up`, async () => {
    // Her screen from before he pressed: the row is free when it loads, his by the time she presses.
    Object.assign(d, { taken_by: null, taken_at: null });
    await irit.reload();
    const btn = cardOf(irit, d.id).locator('button', { hasText: TAKE });
    await btn.waitFor();
    Object.assign(d, { taken_by: 'ofir', taken_at: serverNow() });
    const url = irit.url();
    await btn.click();
    await irit.waitForFunction(() => /אופיר לקח את העסקה של פיצה רון/.test(document.getElementById('toast')?.textContent || ''));
    assert.equal(irit.url(), url, 'she stays where she is');
    await irit.waitForFunction((id) => document.querySelector(`.deal-task[data-deal="${id}"] .deal-clock`)?.textContent === 'אופיר לקח', d.id);
    assert.deepEqual(await actionsOf(cardOf(irit, d.id)), []);
    assert.equal(d.taken_by, 'ofir', 'still his');
  });

  await step(`${L}: Irit by a direct link: "העסקה כבר אצל אופיר", nothing prefilled`, async () => {
    const b = await newPage(engine);
    await signIn(b, 'irit', MINE, MINE_READY);
    await b.goto(`${BASE}index.html?deal=${d.id}`);
    await b.waitForFunction(() => /העסקה כבר אצל אופיר/.test(document.getElementById('toast')?.textContent || ''));
    assert.equal(await b.inputValue('#c-company'), '');
    assert.equal(await b.inputValue('#c-address'), '');
    await b.context().close();
  });

  await step(`${L}: ten minutes later, the card is gone from Irit's list and stays on Ofir's`, async () => {
    const at = d.taken_at;
    d.taken_at = minutesAgo(11);
    await irit.reload();
    await irit.locator(MINE_READY).waitFor();
    await irit.locator('#deals-card').waitFor({ state: 'hidden' });
    assert.equal(await cardOf(irit, d.id).count(), 0);
    await ofir.reload();
    await cardOf(ofir, d.id).waitFor();
    d.taken_at = at;
  });

  await step(`${L}: Stav's list: "ממתין לחוזה · אצל אופיר"`, async () => {
    const stav = await newPage(engine);
    await signIn(stav, 'stav', 'deal.html', '#deal-form:not([hidden])');
    await stav.locator('#deal-list .deal-item').first().waitFor();
    assert.equal(await stav.locator('#deal-list .deal-item .deal-status').first().innerText(), 'ממתין לחוזה · אצל אופיר');
    assert.equal(await noSideScroll(stav), true);
    await stav.context().close();
  });

  const free = dealRow({ business_name: 'קפה דנה', created_at: minutesAgo(1), special_discount_agorot: null, company_id: null, business_address: null, doc_type: 'quote' });
  deals.push(free);
  const owner = await newPage(engine);
  await step(`${L}: the owner sees it, with the work buttons and "להעביר לעירית"; a free one can go to either; no "אני לוקח"`, async () => {
    await signIn(owner, 'owner', MINE, MINE_READY);
    await cardOf(owner, d.id).waitFor();
    assert.equal(await cardOf(owner, d.id).locator('.deal-clock').innerText(), 'אופיר לקח');
    assert.deepEqual(await actionsOf(cardOf(owner, d.id)), ['להכנת החוזה', 'החוזה נשלח', 'בוטל', 'להעביר לעירית']);
    assert.deepEqual(await actionsOf(cardOf(owner, free.id)), ['להכנת הצעת המחיר', 'ההצעה נשלחה', 'בוטל', 'להעביר לעירית', 'להעביר לאופיר']);
    assert.deepEqual(await smallTargets(owner, '.deal-task-acts .btn'), []);
    assert.equal(await noSideScroll(owner), true);
    await shot(owner, `07-owner-card-${L}`);
  });

  await step(`${L}: the hand-over: the deal is Irit's, her ten minutes start; Ofir sees "עירית לקחה" and no buttons`, async () => {
    await cardOf(owner, d.id).locator('button', { hasText: 'להעביר לעירית' }).click();
    await owner.waitForFunction(() => /העסקה של פיצה רון אצל עירית/.test(document.getElementById('toast')?.textContent || ''));
    assert.equal(d.taken_by, 'irit');
    await owner.waitForFunction((id) => document.querySelector(`.deal-task[data-deal="${id}"] .deal-clock`)?.textContent === 'עירית לקחה', d.id);
    assert.deepEqual(await actionsOf(cardOf(owner, d.id)), ['להכנת החוזה', 'החוזה נשלח', 'בוטל', 'להעביר לאופיר']);
    await ofir.reload();
    await cardOf(ofir, d.id).waitFor();
    assert.equal(await cardOf(ofir, d.id).locator('.deal-clock').innerText(), 'עירית לקחה');
    assert.deepEqual(await actionsOf(cardOf(ofir, d.id)), []);
    await irit.reload();
    await cardOf(irit, d.id).waitFor();
    assert.deepEqual(await actionsOf(cardOf(irit, d.id)), ['להכנת החוזה', 'החוזה נשלח', 'בוטל']);
  });

  await step(`${L}: Irit makes the link: the agreement has the exceptional discount, the number and the address; the deal is "חוזה נשלח"`, async () => {
    await cardOf(irit, d.id).locator('a.btn', { hasText: 'להכנת החוזה' }).click();
    await irit.waitForURL(/index\.html\?deal=/);
    await irit.waitForFunction(() => document.getElementById('c-company').value === 'פיצה רון');
    await irit.locator('#btn-link').click();
    await irit.locator('#dlg-share[open]').waitFor();
    const q = quotes.at(-1);
    assert.deepEqual([q.model.client.companyId, q.model.client.address, q.model.totals.monthlyNet], [COMPANY, ADDRESS, 240000]);
    for (let i = 0; i < 50 && d.status !== 'sent'; i += 1) await irit.waitForTimeout(100);
    assert.deepEqual([d.status, d.quote_id], ['sent', q.id]);
    const client = await newPage(engine);
    await client.goto(await irit.locator('#sh-link').inputValue());
    await client.locator('.qd').waitFor();
    assert.ok((await client.locator('.qd').innerText()).includes(ADDRESS));
    await shot(client, `08-client-page-address-${L}`);
    await client.context().close();
  });

  for (const p of [irit, ofir, owner]) await p.context().close();
}

const browsers = [];
let exitCode = 0;
try {
  const safari = await webkit.launch();
  const chrome = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  browsers.push(safari, chrome);
  const iphone = { label: 'iphone13-webkit', browser: safari, options: { ...devices['iPhone 13'] } };
  const narrow = { label: 'chromium-360', browser: chrome, options: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true } };
  const web = { label: 'chromium-1280', browser: chrome, options: { viewport: { width: 1280, height: 900 } } };
  for (const engine of [iphone, narrow]) {
    await stavForm(engine);
    await builderFields(engine);
  }
  for (const engine of [iphone, narrow, web]) await pool(engine);
  assert.deepEqual(errors, [], 'no page errors');
  noCspViolations();
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await Promise.all(browsers.map((b) => b.close()));
}
console.log(`\n${passed} passed${exitCode ? ', and then a failure' : ''}`);
process.exit(exitCode);
