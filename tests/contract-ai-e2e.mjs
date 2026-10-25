// "הכנת חוזה עם AI" in the browser (the owner, 25.10.2026; docs/ops.md, section 68), against an
// in-memory fake of Supabase whose contract-ai function answers with the JSON the model would give
// (checked by the real app/contract-ai-logic.js, as the function does) and whose create-quote
// honours an AI run as the database does (aiRunProblem; tests/sql/contract-ai.test.mjs):
//   - by hand: a custom contract still goes for a manager's approval;
//   - the key not set: a quiet line "החיבור ל־AI עוד לא הוגדר", and nothing on the builder moves;
//   - Irit types the deal key by key, presses "הכנת חוזה עם AI": the busy state, then the package,
//     the custom contract's fields, the discount and the totals as if she had set them by hand,
//     "מולא אוטומטית" on each, what was set and "צריך לבדוק:"; she changes the price by hand (its
//     tag goes, the contract stays an AI one), previews, and "יצירת קישור לחתימה" gives the link at
//     once: no approval, even with a discount above 200 ₪; the client's link works; the list
//     shows "הוכן ע״י AI"; the run is used (sending again would go for approval);
//   - a phone (390px, Chromium) and an iPhone 13 (WebKit): the same typing and button, 44px targets,
//     nothing scrolls sideways.
// Run: npx http-server -p 5501 -s -c-1 . &  then
//      BASE_URL=http://localhost:5501/ node tests/contract-ai-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { withClientColumns } from './fake-clients.mjs';
import { validateSelection, normalizeSelection, exceptionOf, buildQuoteModel } from '../app/pricing.js';
import { validateAiResult, QTY_KEYS } from '../app/contract-ai-logic.js';
import { aiRunProblem } from '../supabase/functions/create-quote/http.js';

const BASE = process.env.BASE_URL || 'http://localhost:5501/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Sunday 25.10.2026, 10:00 in Jerusalem.
const NOW = new Date('2026-10-25T07:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();

const PEOPLE = { owner: null, irit: 'irit', lior: 'lior' };
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
const isOffice = (u) => !!u && staff.some((s) => s.email === u.email);

// The deal Irit types, and what the model answers for it (structured outputs: every key).
const DEAL = 'חבילה נטלי 3500, 20 סרטונים במקום 25, בלי Highlights, 12 חודשים, 2 ימי צילום, הנחה 300 ש״ח';
const answer = (o) => ({
  package: null, months: null, removals: [], addons: [], monthlyPrice: null, priceIncludesVat: false, discount: null, discountPercent: null,
  extraLines: [], specialClauses: [], questions: [], notes: null, ...o,
  quantities: { ...Object.fromEntries(QTY_KEYS.map((k) => [k, null])), ...(o.quantities || {}) },
  freeAddons: { graphics: null, simeonStories: null, simeonJoin: null, extraCh14: null },
});
const MODEL_ANSWERS = {
  [DEAL]: answer({
    package: 'social-natali', months: 12, quantities: { videos: 20, shootDays: 2 }, monthlyPrice: 350000, discount: 30000,
    specialClauses: ['ללא Highlights'], questions: ['Highlights אינו חלק מהחבילה: נרשם כתנאי מיוחד. לוודא שזה מה שסוכם.'],
    notes: 'המחיר שנכתב נלקח כמחיר החודשי של החבילה לפני מע״מ.',
  }),
};

const quotes = [];
const runs = [];
const calls = [];
let aiMode = 'ok';
let seq = 70;

// The contract-ai function: the office only; without the key, 503; else the checked answer and a run.
async function contractAi(body, me, json) {
  calls.push({ contractAi: body });
  if (!me) return json(401, { error: 'not signed in' });
  if (!isOffice(me)) return json(403, { error: 'not staff: contracts are prepared by the office' });
  if (aiMode === 'not-configured') return json(503, { error: 'ai_not_configured' });
  await new Promise((r) => setTimeout(r, 450)); // the model takes a moment: the busy state shows
  const raw = MODEL_ANSWERS[String(body?.text || '').trim()] || answer({ questions: ['לא הובן מה נמכר.'] });
  const { result, dropped } = validateAiResult(raw);
  const run = { id: randomUUID(), user_id: me.id, status: 'ok', created_at: serverNow(), result };
  runs.push(run);
  return json(200, { runId: run.id, result, dropped, model: 'claude-sonnet-5-5' });
}

// The create-quote function: validates, computes the model, stores; an AI run sends without approval.
function createQuote(body, me, json) {
  calls.push({ createQuote: body });
  if (!me) return json(401, { error: 'not signed in' });
  let selection;
  try { validateSelection(body.selection); selection = normalizeSelection(body.selection); } catch (e) { return json(400, { error: e.message }); }
  const exceptions = exceptionOf(selection);
  let ai = false;
  if (body.aiRun) {
    const problem = aiRunProblem(runs.find((r) => r.id === body.aiRun), me.id, quotes.filter((q) => q.ai_run_id === body.aiRun).length, Date.parse(serverNow()));
    if (problem) return json(409, { error: `ai run ${problem}` });
    ai = true;
  }
  const model = buildQuoteModel(selection, body.client);
  const pending = exceptions.length > 0 && !ai;
  const q = {
    id: randomUUID(), token: randomUUID(), number: `AST-2026-${String(++seq).padStart(4, '0')}`, created_at: serverNow(), created_by: me.id, created_by_email: me.email,
    model: { ...model }, client_name: model.client.name, monthly_gross_agorot: model.totals.monthlyGross, term_gross_agorot: model.totals.termGross, status: 'sent',
    first_viewed_at: null, signed_at: null, signer_name: null, approval: pending ? 'pending' : 'none', approval_by: null, approval_note: null, approval_at: null,
    exceptions: exceptions.length && (pending || ai) ? exceptions : null, prepared_by: ai ? 'ai' : null, ai_run_id: ai ? body.aiRun : null,
    expires_at: pending ? null : new Date(Date.parse(serverNow()) + model.validHours * 3600e3).toISOString(),
  };
  q.model.number = q.number;
  quotes.push(q);
  if (pending) return json(200, { id: q.id, number: q.number, created_at: q.created_at, approval: 'pending' });
  return json(200, { id: q.id, token: q.token, number: q.number, created_at: q.created_at, ...(ai ? { approval: 'none', prepared_by: 'ai' } : {}) });
}

const quoteRow = (q) => ({
  ...q, tier: q.model.package.tierName, influencer: q.model.package.influencer, doc: q.model.docTitle, signable: String(q.model.signable),
  phone: q.model.client.phone, email: q.model.client.email, company: q.model.client.company, term: String(q.model.termMonths), valid: String(q.model.validHours),
});
const view = (q) => ({
  number: q.number, createdAt: q.created_at, model: q.model, docHash: 'ab'.repeat(32), expiresAt: q.expires_at, expired: false,
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
    if (name === 'get_quote') {
      const q = quotes.find((x) => x.token === body.p_token);
      if (!q || q.approval === 'pending') return json(200, null);
      if (!me) q.first_viewed_at ||= serverNow();
      return json(200, view(q));
    }
    return json(200, []);
  }
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  const many = (rows) => ((req.headers().accept || '').includes('vnd.pgrst.object') ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116' })) : json(200, rows));
  if (m[1] === 'quotes') return many(isOffice(me) ? quotes.map(quoteRow).reverse() : []);
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    return many(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff);
  }
  return many([]);
}

const errors = [];
const watch = (page) => {
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page);
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
};
async function newPage(browser, options) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', ...options });
  await ctx.clock.install({ time: new Date(serverNow()) });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => [], staff: () => staff }));
  const page = await ctx.newPage();
  watch(page);
  return page;
}
async function signIn(page, who) {
  await page.goto(`${BASE}quotes.html`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.locator('#list-block').waitFor();
}
// The builder, fresh: an agreement, the office's custom part on screen.
async function freshBuilder(page) {
  await page.goto(`${BASE}index.html`);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.locator('#start-agreement').click();
  await page.locator('#custom-group').waitFor();
  await page.locator('#ai-box').waitFor();
}
// Key by key, as a person types (on a phone too).
async function typeDeal(page, text = DEAL) {
  await page.locator('#ai-text').click();
  await page.keyboard.type(text, { delay: 8 });
  assert.equal(await page.locator('#ai-text').inputValue(), text);
}
const shot = async (page, name, fullPage = true) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage }); };
const text = (page, sel) => page.locator(sel).first().innerText();
const texts = (page, sel) => page.locator(sel).allInnerTexts();
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.offsetParent && el.getBoundingClientRect().height < 43.5)
  .map((el) => `${el.id || el.textContent.trim().slice(0, 20)}:${Math.round(el.getBoundingClientRect().height)}`), sel);
const lastCreate = () => calls.filter((c) => c.createQuote).at(-1).createQuote;
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last calls: ${JSON.stringify(calls.slice(-2)).slice(0, 900)}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

// What the builder shows after the deal above (the owner's example with a 300 ₪ discount).
async function checkFilled(page) {
  assert.equal(await page.locator('#tier-social').isChecked(), true);
  assert.equal(await page.locator('#inf-natali').isChecked(), true);
  assert.equal(await page.locator('#custom-on').isChecked(), true);
  assert.equal(await page.locator('#cq-videos').inputValue(), '20');
  assert.equal(await page.locator('#cq-shootDays').inputValue(), '2');
  assert.equal(await page.locator('#cq-graphics').inputValue(), '35', 'what the text did not change stays the package\'s');
  assert.equal(await page.locator('#custom-price').inputValue(), '3500');
  assert.equal(await page.locator('#custom-term').inputValue(), '12');
  assert.equal(await page.locator('#custom-terms').inputValue(), 'ללא Highlights');
  assert.equal(await page.locator('#discount').inputValue(), '300');
  // 3,500 − 300 = 3,200; VAT 576.
  assert.equal(await text(page, '#t-mnet'), '3,200 ₪');
  assert.equal(await text(page, '#t-mgross'), '3,776 ₪');
  assert.equal(await text(page, '#t-ynet'), '38,400 ₪');
}

let exitCode = 0;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const irit = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  await signIn(irit, 'irit');

  await step('by hand: a custom contract that differs from the package still goes for a manager\'s approval', async () => {
    await freshBuilder(irit);
    await irit.locator('#c-name').fill('רון כהן');
    await irit.locator('.custom-head .switch').click();
    await irit.locator('#custom-body').waitFor();
    await irit.locator('#discount').fill('350');
    assert.equal(await text(irit, '#btn-link'), 'שליחה לאישור');
    assert.match(await text(irit, '#custom-diff .needs'), /אדם, אופיר או ליאור/);
    assert.equal(await irit.locator('.tag-ai:visible').count(), 0);
    await irit.locator('#btn-link').click();
    await irit.locator('#dlg-pending[open]').waitFor();
    const sent = lastCreate();
    assert.equal('aiRun' in sent, false);
    assert.deepEqual([quotes.at(-1).approval, quotes.at(-1).prepared_by], ['pending', null]);
    await irit.locator('#dlg-pending .close').click();
  });

  await step('the key not set: a quiet line, and nothing on the builder moves', async () => {
    aiMode = 'not-configured';
    await freshBuilder(irit);
    // The box: the owner's words, at the top of the custom contract, for the office.
    assert.equal(await text(irit, '#ai-h'), 'הכנת חוזה עם AI');
    assert.equal(await text(irit, 'label[for="ai-text"]'), 'רשמו את פרטי העסקה');
    assert.equal(await text(irit, '#ai-go'), 'הכנת חוזה עם AI');
    const before = await text(irit, '#t-mgross');
    await typeDeal(irit);
    await irit.locator('#ai-go').click();
    await irit.locator('#ai-quiet:not([hidden])').waitFor();
    assert.equal(await text(irit, '#ai-quiet'), 'החיבור ל־AI עוד לא הוגדר');
    assert.equal(await text(irit, '#t-mgross'), before);
    assert.ok(await irit.locator('#ai-result').isHidden());
    assert.equal(await irit.locator('#custom-on').isChecked(), false);
    // Empty text: asked to write first, nothing sent.
    await irit.locator('#ai-text').fill('');
    const n = calls.length;
    await irit.locator('#ai-go').click();
    assert.equal(await text(irit, '#ai-quiet'), 'רשמו קודם את פרטי העסקה.');
    assert.equal(calls.length, n);
    aiMode = 'ok';
  });

  let runId;
  await step('Irit types the deal and presses "הכנת חוזה עם AI": the builder fills itself, tagged, with what to check', async () => {
    await freshBuilder(irit);
    await irit.locator('#c-name').fill('דנה לוי');
    await irit.locator('#c-company').fill('קפה דנה');
    await irit.locator('#c-phone').fill('050-1234567');
    await typeDeal(irit);
    await irit.locator('#ai-go').click();
    // Busy while the model reads.
    await irit.waitForFunction(() => document.getElementById('ai-go').disabled);
    assert.match(await text(irit, '#ai-go'), /מכין את החוזה…/);
    await irit.locator('#ai-result:not([hidden])').waitFor();
    assert.equal(await irit.locator('#ai-go').isDisabled(), false);
    assert.equal(await text(irit, '#ai-go'), 'הכנת חוזה עם AI');
    runId = runs.at(-1).id;
    assert.deepEqual(calls.filter((c) => c.contractAi).at(-1).contractAi, { text: DEAL });
    await checkFilled(irit);
    // What was set, and what to check.
    assert.deepEqual(await texts(irit, '#ai-summary li'), [
      'חבילה: Social all in one · נטלי דדון (3,900 ₪ לחודש)',
      'סרטונים: 20 (בחבילה 25)',
      'ימי צילום עם המשפיענים: 2 (בחבילה 1)',
      'מחיר החבילה: 3,500 ₪ לחודש לפני מע״מ (בחבילה 3,900 ₪)',
      'תקופה: 12 חודשים (כמו בחבילה)',
      'תנאי מיוחד: ללא Highlights',
      'הנחה: 300 ₪ לחודש לפני מע״מ',
    ]);
    assert.equal(await text(irit, '.ai-check-h'), 'צריך לבדוק:');
    assert.deepEqual(await texts(irit, '#ai-check li'), ['Highlights אינו חלק מהחבילה: נרשם כתנאי מיוחד. לוודא שזה מה שסוכם.']);
    assert.match(await text(irit, '.ai-notes'), /לפני מע״מ/);
    assert.match(await text(irit, '.ai-flag'), /בלי אישור מנהל/);
    assert.equal(await irit.evaluate(() => document.activeElement?.id), 'ai-result');
    // "מולא אוטומטית" on each field that was filled, and on nothing else.
    const tagged = async () => irit.evaluate(() => [...document.querySelectorAll('.tag-ai')].filter((t) => t.offsetParent)
      .map((t) => t.closest('.custom-q')?.querySelector('input')?.id || t.closest('.tier')?.querySelector('input')?.id || t.closest('.inf')?.querySelector('input')?.id || t.id).sort());
    assert.deepEqual(await tagged(), ['cq-shootDays', 'cq-videos', 'custom-price-ai', 'custom-terms-ai', 'disc-ai', 'inf-natali', 'tier-social'].sort());
    assert.ok(await irit.locator('.custom-q.is-ai #cq-videos').count());
    // Prepared with AI: the link at once, no approval (the owner's decision), though it differs.
    assert.equal(await text(irit, '#btn-link'), 'יצירת קישור לחתימה');
    assert.match(await text(irit, '#act-hint'), /הוכן עם AI: אחרי שבדקת, הקישור נוצר מיד, בלי אישור מנהל/);
    assert.match(await text(irit, '#sum-diff'), /חוזה חריג · 5 שינויים מהחבילה · הוכן עם AI: נשלח ללקוח בלי אישור מנהל/);
    assert.match(await text(irit, '#custom-diff .needs'), /הוכן עם AI/);
    assert.deepEqual(await texts(irit, '#custom-diff-list li'), [
      '20 סרטונים במקום 25', '2 ימי צילום עם המשפיענים במקום 1', 'מחיר חודשי 3,500 ₪ במקום 3,900 ₪',
      'הנחה חודשית 300 ₪ (המותר בלי אישור: 200 ₪)', 'תנאים מיוחדים',
    ]);
    assert.equal(await noSideScroll(irit), true);
    await irit.locator('#ai-box').scrollIntoViewIfNeeded();
    await shot(irit, '01-ai-filled-1280', false);
    await shot(irit, '02-ai-filled-1280-full');
  });

  await step('a field changed by hand loses its tag; the contract stays an AI one', async () => {
    await irit.locator('#custom-price').fill('3400');
    await irit.locator('#custom-price').blur();
    assert.equal(await text(irit, '#t-mnet'), '3,100 ₪');
    assert.ok(await irit.locator('#custom-price-ai').isHidden());
    assert.ok(await irit.locator('#cq-videos').evaluate((el) => !!el.closest('.custom-q.is-ai')));
    assert.equal(await text(irit, '#btn-link'), 'יצירת קישור לחתימה');
    // A refresh keeps it all (the draft): the fields, the tags, the AI preparation, the words.
    await irit.reload();
    await irit.locator('#custom-body').waitFor();
    assert.equal(await irit.locator('#custom-price').inputValue(), '3400');
    assert.ok(await irit.locator('#custom-price-ai').isHidden());
    assert.ok(await irit.locator('#disc-ai').isVisible());
    assert.equal(await irit.locator('#ai-text').inputValue(), DEAL);
    assert.equal(await text(irit, '#btn-link'), 'יצירת קישור לחתימה');
  });

  let sentQuote;
  await step('preview, then "יצירת קישור לחתימה": the link at once, the client can open it, the list says "הוכן ע״י AI"', async () => {
    await irit.locator('#btn-preview').click();
    await irit.locator('#dlg-preview[open]').waitFor();
    assert.match(await irit.locator('#preview-body .qd-grid').innerText(), /20\s*סרטונים בבית העסק/);
    assert.match(await irit.locator('#preview-body .qd-grid').innerText(), /2\s*ימי צילום בבית העסק עם נטלי דדון/);
    assert.match(await irit.locator('#preview-body .qd-clauses > li').last().innerText(), /ללא Highlights/);
    await irit.locator('#dlg-preview .close').click();
    await irit.locator('#btn-link').click();
    await irit.locator('#dlg-share[open]').waitFor();
    const sent = lastCreate();
    assert.equal(sent.aiRun, runId);
    assert.deepEqual(sent.selection.custom, { qty: { videos: 20, shootDays: 2 }, price: 340000, discount: 30000, terms: 'ללא Highlights' });
    sentQuote = quotes.at(-1);
    assert.deepEqual([sentQuote.approval, sentQuote.prepared_by, sentQuote.ai_run_id], ['none', 'ai', runId]);
    assert.match(await irit.locator('#sh-link').inputValue(), new RegExp(`q\\.html#t=${sentQuote.token}$`));
    await shot(irit, '03-ai-share-1280', false);
    await irit.locator('#dlg-share .close').click();
    // The run is used: the same contract again would go for approval; the tags are gone.
    assert.equal(await text(irit, '#btn-link'), 'שליחה לאישור');
    assert.equal(await irit.locator('.tag-ai:visible').count(), 0);
    // The client's link.
    const anon = await newPage(browser, { viewport: { width: 390, height: 844 } });
    await anon.goto(`${BASE}q.html#t=${sentQuote.token}`);
    await anon.locator('#signbox').waitFor();
    assert.match(await anon.locator('.qd-grid').innerText(), /20\s*סרטונים/);
    await anon.context().close();
    // The list: "הוכן ע״י AI", without an approval, with what it changed.
    await irit.goto(`${BASE}quotes.html`);
    const row = irit.locator('#rows tr', { hasText: sentQuote.number });
    await row.waitFor();
    assert.equal(await row.locator('.doc-ai').innerText(), 'הוכן ע״י AI');
    assert.match(await row.locator('.apv-cell').innerText(), /^בלי אישור · הוכן ע״י AI\s*5 שינויים מהחבילה$/);
    assert.ok(await row.locator('.btn', { hasText: 'העתקת קישור' }).count());
    // The hand contract of the first step is still waiting for a manager.
    assert.match(await irit.locator('#rows tr', { hasText: quotes[0].number }).locator('.apv-cell').innerText(), /ממתין/);
    await shot(irit, '04-quotes-list-ai-tag-1280', false);
  });

  await step('an AI preparation used already: nothing is created, the contract stays, now by hand', async () => {
    await freshBuilder(irit);
    await irit.locator('#c-name').fill('יוסי');
    await typeDeal(irit);
    await irit.locator('#ai-go').click();
    await irit.locator('#ai-result:not([hidden])').waitFor();
    // Someone sent this run's contract in the meantime (another tab).
    quotes.push({ ...sentQuote, id: randomUUID(), ai_run_id: runs.at(-1).id });
    const n = quotes.length;
    await irit.locator('#btn-link').click();
    await irit.locator('#toast:not([hidden])').waitFor();
    assert.match(await text(irit, '#toast'), /ההכנה עם AI כבר לא בתוקף/);
    assert.equal(quotes.length, n);
    assert.equal(await text(irit, '#btn-link'), 'שליחה לאישור');
    assert.equal(await irit.locator('#cq-videos').inputValue(), '20');
  });

  await step('a phone (390px): the same typing and button, 44px targets, nothing scrolls sideways', async () => {
    const phone = await newPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await signIn(phone, 'irit');
    await freshBuilder(phone);
    await phone.locator('#ai-box').scrollIntoViewIfNeeded();
    assert.equal(await noSideScroll(phone), true);
    assert.deepEqual(await smallTargets(phone, '#ai-go, #ai-text'), []);
    await shot(phone, '05-ai-box-390', false);
    await typeDeal(phone);
    await phone.locator('#ai-go').tap();
    await phone.locator('#ai-result:not([hidden])').waitFor();
    await checkFilled(phone);
    assert.equal(await noSideScroll(phone), true);
    assert.deepEqual(await smallTargets(phone, '#custom-group .btn, #custom-group input.input, #custom-group textarea, #custom-group .stepper button'), []);
    await phone.locator('#ai-result').scrollIntoViewIfNeeded();
    await shot(phone, '06-ai-filled-390', false);
    await shot(phone, '07-ai-filled-390-full');
    // The list on the phone: the AI contract's row, nothing sideways.
    await phone.goto(`${BASE}quotes.html`);
    await phone.locator('#rows tr .doc-ai').first().waitFor();
    assert.equal(await noSideScroll(phone), true);
    await phone.locator('#rows tr', { has: phone.locator('.doc-ai') }).first().scrollIntoViewIfNeeded();
    await shot(phone, '09-quotes-list-ai-390', false);
    await phone.context().close();
  });
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await browser.close();
}

// The iPhone: WebKit, as the office's phones run Safari.
if (!exitCode) {
  const safari = await webkit.launch();
  try {
    await step('an iPhone 13 (WebKit): typing in the box and the button fill the builder', async () => {
      const page = await newPage(safari, { ...devices['iPhone 13'] });
      await signIn(page, 'irit');
      await freshBuilder(page);
      await page.locator('#ai-box').scrollIntoViewIfNeeded();
      // 16px: Safari does not zoom into the field.
      assert.equal(await page.locator('#ai-text').evaluate((el) => getComputedStyle(el).fontSize), '16px');
      await typeDeal(page);
      await page.locator('#ai-go').tap();
      await page.locator('#ai-result:not([hidden])').waitFor();
      await checkFilled(page);
      assert.equal(await noSideScroll(page), true);
      assert.deepEqual(await smallTargets(page, '#ai-go, #ai-text'), []);
      await page.locator('#ai-result').scrollIntoViewIfNeeded();
      await shot(page, '08-ai-filled-iphone13-webkit', false);
      await page.context().close();
    });
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    await safari.close();
  }
}
try {
  assert.deepEqual(errors, [], 'no page errors');
  noCspViolations();
} catch (err) {
  console.error(err);
  exitCode = 1;
}
console.log(`\n${passed} steps passed`);
process.exit(exitCode);
