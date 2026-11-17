// "נוסח חופשי" in the browser (the owner, 17.11.2026; docs/ops.md, section 140), against an in-memory
// fake of Supabase whose contract-ai answers free mode with a RECORDED answer for the seller's messy
// text (tests/free-text-fixture.mjs; the real model is not called), checked by the real
// app/contract-ai-logic.js as the function does, and whose create-quote validates and stores as the real one:
//   - Irit (an office user, not asked to be a manager) types Stav's text key by key, "בדיוק כמו שכתבתי",
//     and the builder fills the choices and the document's words; the client's business goes to the
//     client's fields only;
//   - the preview shows the words; "עריכה" at the clauses opens the editor: a new line typed key by key
//     in Hebrew, with Backspace, saved, and shown with its number; a line deleted; "חזרה לנוסח הרגיל";
//   - the price clause is locked (no box, no delete); money typed is refused in Hebrew;
//   - the link: the client's page (q.html) draws exactly the stored words;
//   - desktop Chrome 1280 and the iPhone 13 on WebKit: screenshots of the document and of the editors.
// Run: node "$TMP/makeup-shots/serve.mjs" . 8491 &  then
//      BASE_URL=http://localhost:8491/ node tests/free-text-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { withClientColumns } from './fake-clients.mjs';
import { validateSelection, normalizeSelection, exceptionOf, buildQuoteModel } from '../app/pricing.js';
import { validateFreeResult } from '../app/contract-ai-logic.js';
import { STAV_TEXT, FAKE_ANSWER, CL11, CL12, CL33, FIVE, DETAILS } from './free-text-fixture.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8491/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const NOW = new Date('2026-11-17T08:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();

const PEOPLE = { owner: null, irit: 'irit' };
const users = new Map();
const staff = [];
for (const [k, person] of Object.entries(PEOPLE)) {
  const email = `${k}@astrateg.test`;
  users.set(email, { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: NOW.toISOString() });
  staff.push({ email, person, vault: false });
}
const EXP = Math.floor(NOW / 1000) + 3 * 3600;
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const sessionFor = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 3 * 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => staff.find((s) => s.email === u?.email)?.person;
const isOffice = (u) => !!u && staff.some((s) => s.email === u.email);

const quotes = [];
const calls = [];
let seq = 140;
async function contractAi(body, me, json) {
  calls.push({ contractAi: body });
  if (!isOffice(me)) return json(403, { error: 'not staff' });
  await new Promise((r) => setTimeout(r, 300));
  const same = String(body?.text || '').trim() === STAV_TEXT.trim();
  const { result, dropped } = validateFreeResult(same ? FAKE_ANSWER : { drafts: [], questions: ['לא הובן'], notes: null });
  return json(200, { mode: 'free', runId: null, runIds: [], result, dropped, model: 'claude-sonnet-5-5' });
}
function createQuote(body, me, json) {
  calls.push({ createQuote: body });
  if (!isOffice(me)) return json(403, { error: 'not staff' });
  let selection;
  try { validateSelection(body.selection); selection = normalizeSelection(body.selection); } catch (e) { return json(400, { error: e.message }); }
  // custom.text is not a manager's field (create-quote/http.js QUOTE_EDIT_KEYS): the office may send it.
  const model = buildQuoteModel(selection, body.client);
  const q = { id: randomUUID(), token: randomUUID(), number: `AST-2026-${String(++seq).padStart(4, '0')}`, created_at: serverNow(), model: { ...model, number: null }, status: 'sent', exceptions: exceptionOf(selection) };
  q.model.number = q.number;
  quotes.push(q);
  return json(200, { id: q.id, token: q.token, number: q.number, created_at: q.created_at, approval: 'none' });
}
const view = (q) => ({
  number: q.number, createdAt: q.created_at, model: q.model, docHash: 'ab'.repeat(32), expiresAt: new Date(Date.parse(q.created_at) + 7 * 864e5).toISOString(), expired: false,
  consentText: `קראתי ואני מאשר/ת את הסכם ההתקשרות ${q.number}`, signatureHash: null, status: q.status, signerName: null, signedAt: null, signaturePng: null,
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
    const u = users.get(String(body?.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
    return json(200, sessionFor(u));
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p === '/functions/v1/contract-ai') return contractAi(body, me, json);
  if (p === '/functions/v1/create-quote') return createQuote(body, me, json);
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.slice('/rest/v1/rpc/'.length);
    if (name === 'is_staff' || name === 'is_office') return json(200, isOffice(me));
    if (name === 'is_manager') return json(200, false);
    if (name === 'my_person') return json(200, personOf(me) ?? null);
    if (name === 'get_quote') { const q = quotes.find((x) => x.token === body.p_token); return json(200, q ? view(q) : null); }
    return json(200, []);
  }
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  const many = (rows) => ((req.headers().accept || '').includes('vnd.pgrst.object') ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116' })) : json(200, rows));
  if (m[1] === 'staff') { const eq = url.searchParams.get('email'); return many(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff); }
  return many([]);
}

const errors = [];
async function newPage(browser, options) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', serviceWorkers: 'block', ...options });
  await ctx.clock.install({ time: new Date(serverNow()) });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => [], staff: () => staff }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, who) {
  await page.goto(`${BASE}quotes.html`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForFunction(() => !document.querySelector('#lg-email')?.offsetParent, null, { timeout: 15000 });
  await page.waitForTimeout(400);
}
const shot = async (page, name, opts = {}) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, ...opts }); };
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last calls: ${JSON.stringify(calls.slice(-1)).slice(0, 600)}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}
const noSideScroll = (page, sel = null) => page.evaluate((s) => { const el = s ? document.querySelector(s) : document.documentElement; return el.scrollWidth <= el.clientWidth + 1; }, sel);

async function run(browserType, options, tag) {
  const browser = await browserType.launch();
  const page = await newPage(browser, options);
  try {
    await step(`${tag}: Irit types Stav's text key by key; the choices and the words are filled`, async () => {
      await signIn(page, 'irit');
      await page.goto(`${BASE}index.html`);
      await page.evaluate(() => sessionStorage.clear());
      await page.reload();
      await page.locator('#start-agreement').click();
      await page.locator('#ai-box').waitFor();
      await page.locator('label.ai-free').click();
      await page.locator('#ai-text').click();
      // Key by key, Enter for a new line, as on a phone (the same 600 characters the seller wrote).
      await page.keyboard.type(STAV_TEXT, { delay: 2 });
      assert.equal(await page.locator('#ai-text').inputValue(), STAV_TEXT);
      await page.locator('#ai-go').click();
      await page.locator('#ai-summary').waitFor();
      const summary = await page.locator('#ai-summary').innerText();
      assert.match(summary, /נוסח שנכתב מהטקסט/);
      assert.match(await page.locator('#ai-result').innerText(), /פרטי הלקוח לא נכנסה לנוסח/);
      assert.equal(await page.locator('#c-company').inputValue(), 'קפה הדגמה בע״מ');
      assert.equal(await page.locator('#custom-on').isChecked(), true);
      assert.equal(await page.locator('#custom-price').inputValue(), '3900');
      assert.match(await page.locator('#custom-diff').innerText(), /נוסח שנכתב ביד/);
      await page.locator('#c-name').fill('לקוח הדגמה');
    });

    await step(`${tag}: the preview shows the words; the editor of the clauses opens in place`, async () => {
      await page.locator('#btn-preview').click();
      const doc = page.locator('#preview-body .qd');
      await doc.waitFor();
      const text = await doc.innerText();
      for (const line of [CL11, CL12, CL33, FIVE, ...DETAILS]) assert.ok(text.includes(line), line);
      assert.ok(text.includes('ALL IN ONE · מישל, דניס, סמיון והצל (יואב אליאסי)'));
      assert.ok(text.includes('3,900 ₪ לחודש + מע״מ כחוק, למשך 12 חודשים'));
      assert.equal(await page.locator('#preview-body .qd-edit').count(), 5);
      await shot(page, `${tag}-preview-top`);
      await page.locator('#preview-body .qd-edit[data-part="package"]').scrollIntoViewIfNeeded();
      await shot(page, `${tag}-preview-package`);
      await page.locator('#preview-body .qd-edit[data-part="details"]').scrollIntoViewIfNeeded();
      await shot(page, `${tag}-preview-details`);
      await page.locator('#preview-body .qd-edit[data-part="clauses"]').scrollIntoViewIfNeeded();
      await shot(page, `${tag}-preview-clauses`);
      await page.locator('#preview-body .qd-edit[data-part="clauses"]').click();
      await page.locator('#preview-body .te[data-part="clauses"]').waitFor();
      assert.ok(await noSideScroll(page, '#preview-body'), 'nothing sideways in the editor');
      // The price clause: locked, no delete.
      const locked = page.locator('.te .te-line.is-locked');
      assert.equal(await locked.count(), 1);
      assert.match(await locked.innerText(), /מחושב אוטומטית/);
      assert.equal(await locked.locator('.te-del').count(), 0);
      await shot(page, `${tag}-editor-clauses`);
    });

    await step(`${tag}: a new line typed key by key in Hebrew with Backspace, saved, numbered`, async () => {
      const group = page.locator('.te .te-group').nth(5); // chapter 6, "שונות"
      await group.locator('.te-add').click();
      const box = group.locator('textarea').last();
      assert.ok(await box.evaluate((el) => el === document.activeElement), 'the new line has the focus');
      await page.keyboard.type('הלקוח רשאי לבקש דוח חודשי', { delay: 15 });
      for (let i = 0; i < 'חודשי'.length; i += 1) await page.keyboard.press('Backspace');
      await page.keyboard.type('שבועי', { delay: 15 });
      assert.equal(await box.inputValue(), 'הלקוח רשאי לבקש דוח שבועי');
      await shot(page, `${tag}-editor-typed`);
      // Money typed is refused, in Hebrew.
      await page.keyboard.type(' ב־100 ₪', { delay: 10 });
      await page.locator('.te .te-save').click();
      assert.match(await page.locator('.te .te-error').innerText(), /סכומים לא כותבים בנוסח/);
      await shot(page, `${tag}-editor-money-refused`);
      // Back in the box, at its end, and the amount deleted key by key.
      await box.evaluate((el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
      for (let i = 0; i < ' ב־100 ₪'.length; i += 1) await page.keyboard.press('Backspace');
      assert.equal(await box.inputValue(), 'הלקוח רשאי לבקש דוח שבועי');
      await box.evaluate((el) => el.blur());
      await page.locator('.te .te-save').scrollIntoViewIfNeeded();
      await page.locator('.te .te-save').click();
      await page.locator('#preview-body .te').waitFor({ state: 'detached' });
      const text = await page.locator('#preview-body .qd').innerText();
      assert.ok(text.includes('הלקוח רשאי לבקש דוח שבועי'));
      const nums = await page.locator('#preview-body .qd-cl-n').allInnerTexts();
      assert.ok(nums.includes('6.3'), nums.join(' '));
    });

    await step(`${tag}: the package's editor: a line deleted; the tiles and the cover editors`, async () => {
      await page.locator('#preview-body .qd-edit[data-part="package"]').click();
      const ed = page.locator('#preview-body .te[data-part="package"]');
      await ed.waitFor();
      await shot(page, `${tag}-editor-package`);
      const lines = ed.locator('.te-group').first().locator('.te-line');
      const before = await lines.count();
      await lines.last().locator('.te-del').click();
      assert.equal(await lines.count(), before - 1);
      await ed.locator('.te-save').click();
      await ed.waitFor({ state: 'detached' });
      await page.locator('#preview-body .qd-edit[data-part="tiles"]').click();
      await page.locator('#preview-body .te[data-part="tiles"]').waitFor();
      await shot(page, `${tag}-editor-tiles`);
      await page.locator('#preview-body .te .te-cancel').click();
      await page.locator('#preview-body .qd-edit[data-part="cover"]').click();
      await page.locator('#preview-body .te[data-part="cover"]').waitFor();
      await shot(page, `${tag}-editor-cover`);
      // "חזרה לנוסח הרגיל": the regular cover again.
      await page.locator('#preview-body .te .te-reset').click();
      await page.locator('#preview-body .te').waitFor({ state: 'detached' });
      assert.ok(!(await page.locator('#preview-body .qd-cover').innerText()).includes('ALL IN ONE · מישל'));
      assert.match(await page.locator('#preview-body .qd-cover').innerText(), /סמיון, מישל ודניס \+ הצל/);
      await page.locator('#dlg-preview .close').click();
    });

    await step(`${tag}: the link; the client's page draws exactly the stored words`, async () => {
      await page.locator('#btn-link').click();
      await page.locator('#sh-link').waitFor();
      const sent = calls.filter((c) => c.createQuote).at(-1).createQuote;
      assert.ok(sent.selection.custom.text.clauses, 'the words go to create-quote');
      const q = quotes.at(-1);
      assert.ok(q.exceptions.some((x) => x.kind === 'text'));
      const client = await newPage(browser, options);
      await client.goto(`${BASE}q.html?t=${q.token}`);
      await client.locator('.qd').waitFor();
      const text = await client.locator('.qd').innerText();
      for (const line of [CL11, CL12, CL33, 'הלקוח רשאי לבקש דוח שבועי', ...DETAILS]) assert.ok(text.includes(line), line);
      assert.equal(await client.locator('.qd-edit').count(), 0, 'the client never sees "עריכה"');
      assert.ok(await noSideScroll(client));
      await shot(client, `${tag}-client-page`, { fullPage: true });
      await client.close();
    });
  } finally {
    await browser.close();
  }
}

await run(chromium, { viewport: { width: 1280, height: 900 } }, 'chrome-1280');
await run(webkit, { ...devices['iPhone 13'] }, 'iphone13-webkit');
assert.deepEqual(errors, []);
console.log(`# ${passed} steps passed`);
