// "הורדת PDF" (the owner, 10.11.2026; docs/ops.md, section 124), in the browser, against the in-memory
// fake of Supabase of tests/quote-old-format-e2e.mjs:
//   - the builder, a price offer with NO client name: "הורדת PDF" is the first, big button; a click
//     downloads a .pdf at once (no print dialog): "%PDF", at least 3 A4 pages, under 6 MB, named
//     "הצעת מחיר - … .pdf"; Ctrl+P draws the offer too (never the "יש למלא את שם הלקוח" page);
//   - an agreement: the link to sign stays first; "הורדת PDF" beside the HTML file, and it asks for
//     the client's name first;
//   - the client's link (q.html): "הורדת PDF" for a price offer, and for a signed agreement (the
//     signature inside);
//   - the same on WebKit as an iPhone 13 (the builder and q.html);
//   - with an outDir: each PDF is saved, and its pages are written out as JPEGs to look at.
// Run: npx http-server -p 8111 -s -c-1 . &  then
//      BASE_URL=http://localhost:8111/ node tests/quote-pdf-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
import { watchCsp } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { withClientColumns } from './fake-clients.mjs';
import { validateSelection, normalizeSelection, exceptionOf, buildQuoteModel } from '../app/pricing.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Tuesday 10.11.2026, 10:00 in Jerusalem.
const NOW = new Date('2026-11-10T08:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();

// ── The fake of Supabase and the pages: as in tests/quote-old-format-e2e.mjs ──
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

// Clicks the button and checks the file: its name, "%PDF", the pages, the size. Returns the bytes.
async function downloadOf(page, sel, tag, { kind = 'הצעת מחיר', minPages = 3 } = {}) {
  const t0 = Date.now();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator(sel).click()]);
  const ms = Date.now() - t0;
  const name = download.suggestedFilename();
  assert.ok(name.startsWith(`${kind} - `) && name.endsWith('.pdf'), `${tag}: the file's name (${name})`);
  const bytes = readFileSync(await download.path());
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-', `${tag}: a PDF`);
  const pages = (bytes.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;
  assert.ok(pages >= minPages, `${tag}: ${pages} pages`);
  assert.ok(bytes.length < 6 * 1024 * 1024, `${tag}: ${bytes.length} bytes`);
  console.log(`  ${tag}: "${name}", ${pages} pages, ${(bytes.length / 1024).toFixed(0)} KB, ${ms} ms`);
  if (OUT) {
    writeFileSync(`${OUT}/${tag}.pdf`, bytes);
    // The pages as they are inside the file (one JPEG per page), to look at.
    let at = 0;
    for (let i = 1; ; i += 1) {
      const s = bytes.indexOf(Buffer.from([0xff, 0xd8, 0xff]), at);
      if (s < 0) break;
      const e = bytes.indexOf(Buffer.from('\nendstream'), s);
      writeFileSync(`${OUT}/${tag}-page${i}.jpg`, bytes.subarray(s, e));
      at = e;
    }
  }
  // The button is back to its name.
  assert.equal((await page.locator(sel).innerText()).trim(), 'הורדת PDF');
  return { bytes, pages, name };
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
const actionIds = (page) => page.locator('#summary .actions button').evaluateAll((bs) => bs.map((b) => b.id));

let exitCode = 0;
const chrome = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const safari = await webkit.launch();
try {
  const owner = await newPage(chrome);
  await signIn(owner, 'owner');
  let quoteLink;
  let agreementLink;

  await step('the builder, a price offer with no client name: "הורדת PDF" first and big; a real PDF at once (Chrome)', async () => {
    await owner.goto(`${BASE}index.html`);
    await owner.locator('#start-quote').click();
    await owner.locator('label[for="inf-niro"]').click();
    await owner.locator('#c-name').fill('');
    assert.equal(await owner.locator('#btn-print').count(), 0, 'no print button');
    assert.equal((await actionIds(owner))[0], 'btn-pdf');
    assert.match(await owner.getAttribute('#btn-pdf', 'class'), /btn-primary/);
    assert.doesNotMatch(await owner.getAttribute('#btn-link', 'class'), /btn-primary/);
    await owner.locator('#summary').scrollIntoViewIfNeeded();
    await shot(owner, '01-builder-quote-actions-1366');
    await owner.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
    await downloadOf(owner, '#btn-pdf', 'quote-builder-chrome');
    assert.equal(await owner.evaluate(() => window.__printed), 0, 'no print dialog');
    assert.ok(await owner.locator('#c-name-err').isHidden());
  });

  await step('Ctrl+P on a price offer with no name draws the offer, not "יש למלא את שם הלקוח"', async () => {
    await owner.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await owner.locator('#print-root .qd').count(), 1);
    assert.doesNotMatch(await owner.locator('#print-root').innerText(), /יש למלא את שם הלקוח/);
  });

  await step('with the business: the name of the file carries it; then the link for the client', async () => {
    await owner.locator('#c-company').fill('קפה "נואר" בע״מ');
    const { name } = await downloadOf(owner, '#btn-pdf', 'quote-builder-business');
    assert.equal(name, 'הצעת מחיר - נירו לוי - קפה נואר בע״מ.pdf');
    await owner.locator('#c-company').fill('');
    await owner.locator('#btn-link').click();
    await owner.locator('#sh-link').waitFor();
    quoteLink = await owner.locator('#sh-link').inputValue();
  });

  await step('an agreement: the link to sign first; "הורדת PDF" beside the HTML file, and it asks for the name', async () => {
    await owner.goto(`${BASE}index.html`);
    await owner.locator('#start-agreement').click();
    await owner.locator('label[for="inf-niro"]').click();
    const ids = await actionIds(owner);
    assert.equal(ids[0], 'btn-link');
    assert.match(await owner.getAttribute('#btn-link', 'class'), /btn-primary/);
    assert.match(await owner.getAttribute('#btn-pdf', 'class'), /btn-ghost/);
    assert.equal(await owner.locator('.actions .pair #btn-pdf + #btn-html').count(), 1);
    await owner.locator('#summary').scrollIntoViewIfNeeded();
    await shot(owner, '02-builder-agreement-actions-1366');
    let downloads = 0;
    owner.on('download', () => { downloads += 1; });
    await owner.locator('#btn-pdf').click();
    assert.ok(await owner.locator('#c-name-err').isVisible());
    await owner.waitForTimeout(1500);
    assert.equal(downloads, 0);
    await owner.locator('#c-name').fill('דנה כהן');
    await owner.locator('#c-companyid').fill('514729938');
    await downloadOf(owner, '#btn-pdf', 'agreement-builder-chrome', { kind: 'הסכם התקשרות' });
    await owner.locator('#btn-link').click();
    await owner.locator('#sh-link').waitFor();
    agreementLink = await owner.locator('#sh-link').inputValue();
  });

  for (const [tag, vp] of [['1366', { viewport: { width: 1366, height: 900 } }], ['390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
    await step(`the client's link (${tag}), a price offer: "הורדת PDF" saves the document`, async () => {
      const client = await newPage(chrome, vp);
      await client.goto(quoteLink);
      await client.locator('#doc .qd').waitFor();
      assert.ok(await client.locator('#btn-pdf').isVisible());
      await shot(client, `03-client-quote-${tag}`);
      await downloadOf(client, '#btn-pdf', `quote-client-chrome-${tag}`);
      await client.context().close();
    });
  }

  await step('while the file is made the button says "מכין PDF…"; when it fails, a message and the button back', async () => {
    const client = await newPage(chrome);
    await client.goto(quoteLink);
    await client.locator('#doc .qd').waitFor();
    const got = client.waitForEvent('download', { timeout: 90000 });
    await client.locator('#btn-pdf').click();
    assert.equal((await client.locator('#btn-pdf').innerText()).trim(), 'מכין PDF…');
    await got;
    await client.context().close();
    const broken = await newPage(chrome, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await broken.route('**/app/vendor/html2canvas.min.js', (r) => r.abort());
    await broken.goto(quoteLink);
    await broken.locator('#doc .qd').waitFor();
    await broken.locator('#btn-pdf').click();
    await broken.locator('#toast').waitFor();
    assert.equal(await broken.locator('#toast').innerText(), 'לא הצלחנו להכין את קובץ ה־PDF. נסו שוב.');
    assert.equal((await broken.locator('#btn-pdf').innerText()).trim(), 'הורדת PDF');
    await shot(broken, '06-client-pdf-error-390');
    await broken.context().close();
  });

  await step('the client signs; the PDF of the signed agreement has the signature', async () => {
    const client = await newPage(chrome, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await client.goto(agreementLink);
    await client.locator('#signbox').waitFor();
    await drawAndSign(client, 'דנה כהן');
    assert.ok(await client.locator('.qd-sign-box.is-signed img').count());
    await downloadOf(client, '#btn-pdf', 'agreement-client-signed-chrome', { kind: 'הסכם התקשרות' });
    await client.context().close();
  });

  // ── WebKit as an iPhone ───────────────────
  await step('WebKit (iPhone 13): the builder, a price offer with no name, "הורדת PDF"', async () => {
    const page = await newPage(safari, { ...devices['iPhone 13'] });
    await signIn(page, 'owner');
    await page.goto(`${BASE}index.html`);
    await page.locator('#start-quote').click();
    await page.locator('label[for="inf-niro"]').click();
    await page.locator('#btn-pdf').scrollIntoViewIfNeeded();
    await shot(page, '04-builder-quote-actions-iphone13-webkit');
    await downloadOf(page, '#btn-pdf', 'quote-builder-webkit');
    await page.context().close();
  });

  await step('WebKit (iPhone 13): the client\'s link, a signed agreement and a price offer', async () => {
    const page = await newPage(safari, { ...devices['iPhone 13'] });
    await page.goto(agreementLink);
    await page.locator('#doc .qd').waitFor();
    await shot(page, '05-client-agreement-iphone13-webkit');
    await downloadOf(page, '#btn-pdf', 'agreement-client-webkit', { kind: 'הסכם התקשרות' });
    // Another page: the two links differ only after the "#".
    const second = await page.context().newPage();
    second.on('pageerror', (e) => errors.push(String(e)));
    await second.goto(quoteLink);
    await second.locator('#doc .qd').waitFor();
    await downloadOf(second, '#btn-pdf', 'quote-client-webkit');
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
