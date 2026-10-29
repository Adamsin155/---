// "בדיוק כמו שכתבתי (חוזה חופשי)" and Stav's free deal in the browser (the owner, 29.10.2026;
// docs/ops.md, section 79), against an in-memory fake of Supabase whose contract-ai function answers
// in free mode with the JSON the model would give (checked by the real app/contract-ai-logic.js, as
// the function does), whose create-quote stores every contract as a regular one (no manager's
// approval since that day), and whose deal_requests behave as the table does:
//   - Ofir's text of 29.10.2026, typed key by key with the switch on: a price offer, no influencer,
//     4,900 ₪ a month before VAT, the monthly photographer with 8 contents inside the price, "2 דפי
//     נחיתה" included, 12 months, in the custom contract's own fields; "יצירת קישור לצפייה" gives the
//     link at once;
//   - two offers in one text: "הצעה 1 · הצעה 2", one tap loads each, "להמשיך להצעה 2" after the first;
//   - Stav on an iPhone 13 (WebKit): "הצעת מחיר", then the big box, typed key by key, "לעירית להכנת
//     הצעת מחיר"; and "חוזה" on a 360px Chromium;
//   - Irit sees "להכין הצעת מחיר ל־…" with the 10-minute clock and Stav's words, opens it: the AI box
//     already has his text, the switch on, the client's details filled, the document his choice; one
//     press, review, the link, and the deal is linked;
//   - 1280 and 390 on Chromium and the iPhone 13 on WebKit: 44px targets, nothing sideways.
// Run: npx http-server -p 8418 -s -c-1 . &  then
//      BASE_URL=http://localhost:8418/ node tests/contract-ai-free-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { withClientColumns } from './fake-clients.mjs';
import { validateSelection, normalizeSelection, exceptionOf, buildQuoteModel } from '../app/pricing.js';
import { validateFreeResult, validateAiResult } from '../app/contract-ai-logic.js';

const BASE = process.env.BASE_URL || 'http://localhost:8418/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Thursday 29.10.2026, 10:00 in Jerusalem (an office day).
const NOW = new Date('2026-10-29T08:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();

const PEOPLE = { owner: null, irit: 'irit', ofir: 'ofir', stav: 'stav' };
const OFFICE = new Set([null, 'irit', 'ofir', 'lior', 'ilai']);
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
const isOffice = (u) => !!u && staff.some((s) => s.email === u.email) && OFFICE.has(personOf(u));

// The texts, and what the model answers for each in free mode (structured outputs: every key).
const OFIR = 'תוציא לי הצעת מחיר 4,900 עם שתי דפי נחיתה\nסתיו מכירות: בלי משפיען 4,900 בחודש\nסתיו מכירות: צילום כל חודש 8 תכנים';
const TWO = 'שתי הצעות: אחת 4,900 בלי משפיען, אחת 6,500 עם נטלי';
const STAV = 'בלי משפיען 4,900 בחודש\nצילום כל חודש 8 תכנים\n2 דפי נחיתה';
const NO_CLIENT = { name: '', company: '', companyId: '', phone: '', email: '' };
const draft = (o) => ({
  title: '', docType: null, influencer: null, tier: null, monthlyPrice: null, priceIncludesVat: false, monthlyShoot: false, monthlyContents: null,
  quantities: [], addons: [], months: null, extraLines: [], specialClauses: [], discount: null, client: NO_CLIENT, ...o,
});
const EXAMPLE = draft({ title: '4,900 בלי משפיען', docType: 'quote', influencer: 'none', monthlyPrice: 490000, monthlyShoot: true, monthlyContents: 8, extraLines: [{ label: 'דפי נחיתה', qty: 2, monthly: null }] });
const FREE_ANSWERS = {
  [OFIR]: { drafts: [EXAMPLE], questions: [], notes: 'המחיר שנכתב הוא המחיר החודשי לפני מע״מ, והכול כלול בו.' },
  [TWO]: {
    drafts: [
      draft({ title: '4,900 בלי משפיען', docType: 'quote', influencer: 'none', monthlyPrice: 490000 }),
      draft({ title: '6,500 עם נטלי', docType: 'quote', influencer: 'natali', tier: 'social', monthlyPrice: 650000 }),
    ],
    questions: [], notes: null,
  },
  // Stav's words: no document in them, so the one he chose stays.
  [STAV]: { drafts: [{ ...EXAMPLE, title: '', docType: null }], questions: [], notes: null },
};

const quotes = [];
const runs = [];
const calls = [];
const deals = [];
let seq = 80;

async function contractAi(body, me, json) {
  calls.push({ contractAi: body });
  if (!me) return json(401, { error: 'not signed in' });
  if (!isOffice(me)) return json(403, { error: 'not staff: contracts are prepared by the office' });
  await new Promise((r) => setTimeout(r, 350)); // the model takes a moment: the busy state shows
  const text = String(body?.text || '').trim();
  if (body?.mode === 'free') {
    const { result, dropped } = validateFreeResult(FREE_ANSWERS[text] || { drafts: [], questions: ['לא הובן מה נמכר.'], notes: null });
    const runIds = result.drafts.map(() => { const r = { id: randomUUID(), user_id: me.id, status: 'ok', created_at: serverNow() }; runs.push(r); return r.id; });
    return json(200, { mode: 'free', runId: runIds[0] ?? null, runIds, result, dropped, model: 'claude-sonnet-5-5' });
  }
  const { result, dropped } = validateAiResult({ questions: ['לא הובן מה נמכר.'] });
  return json(200, { runId: null, result, dropped, model: 'claude-sonnet-5-5' });
}

// create-quote: validates, computes the model, stores; never pending since 29.10.2026.
function createQuote(body, me, json) {
  calls.push({ createQuote: body });
  if (!me) return json(401, { error: 'not signed in' });
  let selection;
  try { validateSelection(body.selection); selection = normalizeSelection(body.selection); } catch (e) { return json(400, { error: e.message }); }
  const exceptions = exceptionOf(selection);
  const ai = !!body.aiRun && runs.some((r) => r.id === body.aiRun && r.user_id === me.id) && !quotes.some((q) => q.ai_run_id === body.aiRun);
  const model = buildQuoteModel(selection, body.client);
  const q = {
    id: randomUUID(), token: randomUUID(), number: `AST-2026-${String(++seq).padStart(4, '0')}`, created_at: serverNow(), created_by: me.id, created_by_email: me.email,
    model: { ...model }, client_name: model.client.name, monthly_gross_agorot: model.totals.monthlyGross, term_gross_agorot: model.totals.termGross, status: 'sent',
    first_viewed_at: null, signed_at: null, signer_name: null, approval: 'none', approval_by: null, approval_note: null, approval_at: null,
    exceptions: exceptions.length ? exceptions : null, prepared_by: ai ? 'ai' : null, ai_run_id: ai ? body.aiRun : null,
    expires_at: new Date(Date.parse(serverNow()) + model.validHours * 3600e3).toISOString(),
  };
  q.model.number = q.number;
  quotes.push(q);
  return json(200, { id: q.id, token: q.token, number: q.number, created_at: q.created_at, approval: 'none', ...(ai ? { prepared_by: 'ai' } : {}) });
}

// deal_requests as the table answers (row level security, the stamping trigger, the checks).
function dealsRoute(req, url, me, json) {
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const filters = [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
  const match = (d) => filters.every(([k, v]) => (v.startsWith('eq.') ? String(d[k]) === v.slice(3) : true));
  const mine = (d) => isOffice(me) || (personOf(me) === 'stav' && d.created_by_email === me.email);
  const one = (req.headers().accept || '').includes('vnd.pgrst.object');
  const out = (rows) => (one ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  if (req.method() === 'GET') return out(deals.filter(mine).filter(match).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
  if (req.method() === 'POST') {
    calls.push({ insert: body });
    if (personOf(me) !== 'stav') return json(403, { code: '42501', message: 'new row violates row-level security policy' });
    // The checks of 20261118100000_no_manager_approval.sql.
    const c = body.custom;
    const okCustom = c == null || (Object.keys(c).every((k) => k === 'text') && typeof c.text === 'string' && c.text.trim().length >= 1 && c.text.length <= 2000);
    if (!okCustom || !(body.doc_type == null || ['agreement', 'quote'].includes(body.doc_type))) return json(400, { code: '23514', message: 'new row violates check constraint' });
    const d = { ...body, id: randomUUID(), created_at: serverNow(), created_by_email: me.email, seller: 'stav', status: 'pending', quote_id: null, sent_at: null, signed_at: null, status_by_email: null };
    deals.push(d);
    return out([d]);
  }
  if (req.method() === 'PATCH') {
    calls.push({ update: body, where: Object.fromEntries(filters) });
    if (!isOffice(me)) return out([]);
    const rows = deals.filter(match);
    for (const d of rows) {
      Object.assign(d, body);
      if (body.quote_id && d.status === 'pending') { d.status = 'sent'; d.sent_at = serverNow(); }
    }
    return out(rows);
  }
  return json(405, {});
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
    if (name === 'is_staff') return json(200, !!me && staff.some((s) => s.email === me.email));
    if (name === 'is_office') return json(200, isOffice(me));
    if (name === 'my_person') return json(200, personOf(me) ?? null);
    if (name === 'get_quote') {
      const q = quotes.find((x) => x.token === body.p_token);
      if (!q) return json(200, null);
      if (!me) q.first_viewed_at ||= serverNow();
      return json(200, view(q));
    }
    return json(200, []);
  }
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  const many = (rows) => ((req.headers().accept || '').includes('vnd.pgrst.object') ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116' })) : json(200, rows));
  if (m[1] === 'deal_requests') return dealsRoute(req, url, me, json);
  if (m[1] === 'quotes') return many(isOffice(me) ? quotes.map(quoteRow).reverse() : []);
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    return many(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff);
  }
  return many([]);
}

const errors = [];
const watch = (page) => {
  page.setDefaultTimeout(9000);
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page);
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
};
async function newPage(browser, options) {
  // No service worker: in WebKit its requests would not pass through the fake below.
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', serviceWorkers: 'block', ...options });
  await ctx.clock.install({ time: new Date(serverNow()) });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => [], staff: () => staff }));
  const page = await ctx.newPage();
  watch(page);
  return page;
}
async function signIn(page, who, path = 'quotes.html', ready = '#list-block') {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  if (ready) await page.locator(ready).first().waitFor();
  // The sign-in card's goodbye (the door) is over before anything is looked at.
  await page.waitForFunction(() => !document.querySelector('#lg-email')?.offsetParent, null, { timeout: 15000 });
  await page.waitForTimeout(400);
}
async function freshBuilder(page, doc = 'agreement') {
  await page.goto(`${BASE}index.html`);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.locator(`#start-${doc}`).click();
  await page.locator('#ai-box').waitFor();
}
// Key by key, as a person types (a new line is Enter, as on a phone's keyboard).
async function typeKeys(page, sel, value) {
  await page.locator(sel).click();
  await page.keyboard.type(value, { delay: 6 });
  assert.equal(await page.locator(sel).inputValue(), value);
}
// The switch "בדיוק כמו שכתבתי": a tap on its label.
async function freeOn(page, tap = false) {
  assert.equal(await page.locator('#ai-free').isChecked(), false, 'off by default: the catalog mode stays the default');
  await page.locator('label.ai-free')[tap ? 'tap' : 'click']();
  assert.equal(await page.locator('#ai-free').isChecked(), true);
  assert.equal(await text(page, '#ai-go'), 'הכנה בדיוק כמו שכתבתי');
  assert.ok(await page.locator('#ai-free-hint').isVisible());
}
const shot = async (page, name, fullPage = false) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage }); };
const text = (page, sel) => page.locator(sel).first().innerText();
const texts = (page, sel) => page.locator(sel).allInnerTexts();
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.offsetParent && el.getBoundingClientRect().height < 43.5)
  .map((el) => `${el.id || el.className || el.textContent.trim().slice(0, 20)}:${Math.round(el.getBoundingClientRect().height)}`), sel);
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

// The builder after the example: the custom contract's own fields, exactly as written.
async function checkExample(page, doc = 'quote') {
  assert.equal(await page.locator('#custom-on').isChecked(), true, '"חוזה מותאם אישית" on');
  assert.equal(await page.locator('#custom-noinf').isChecked(), true, 'בלי משפיענים');
  assert.equal(await page.locator('#custom-incl').isChecked(), true, 'the photographer inside the price');
  assert.ok(await page.locator('#inf-none').isVisible());
  assert.equal(await page.locator('#paid-photographer').isChecked(), true);
  assert.equal(await page.locator('#custom-price').inputValue(), '4900');
  assert.equal(await page.locator('#custom-term').inputValue(), '12');
  assert.equal(await page.locator('#cq-videos').inputValue(), '0');
  assert.equal(await page.locator('#cq-graphics').inputValue(), '0');
  assert.equal(await page.locator('#cq-monthly').inputValue(), '8');
  assert.equal(await page.locator('#cl-label-0').inputValue(), 'דפי נחיתה');
  assert.equal(await page.locator('#cl-qty-0').inputValue(), '2');
  assert.equal(await page.locator('#cl-price-0').inputValue(), '');
  assert.equal(await text(page, '#page-h1'), doc === 'quote' ? 'הצעת מחיר חדשה' : 'הסכם התקשרות חדש');
  // 4,900 before VAT; 882 VAT; 12 months.
  assert.equal(await text(page, '#t-mnet'), '4,900 ₪');
  assert.equal(await text(page, '#t-mgross'), '5,782 ₪');
  assert.equal(await text(page, '#t-ynet'), '58,800 ₪');
  assert.equal(await text(page, '#btn-link'), doc === 'quote' ? 'יצירת קישור לצפייה' : 'יצירת קישור לחתימה');
}

let exitCode = 0;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const ofir = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  await signIn(ofir, 'ofir');

  await step('Ofir\'s text with "בדיוק כמו שכתבתי": a price offer, no influencer, 4,900 ₪, 8 contents a month, 2 landing pages, 12 months', async () => {
    await freshBuilder(ofir, 'agreement');
    await ofir.locator('#c-name').fill('רות');
    await freeOn(ofir);
    await typeKeys(ofir, '#ai-text', OFIR);
    // Delete a word and type it again (Backspace, as a person corrects).
    for (let i = 0; i < 5; i += 1) await ofir.keyboard.press('Backspace');
    await ofir.keyboard.type('תכנים', { delay: 6 });
    assert.equal(await ofir.locator('#ai-text').inputValue(), OFIR);
    await ofir.locator('#ai-go').click();
    await ofir.waitForFunction(() => document.getElementById('ai-go').disabled);
    await ofir.locator('#ai-result:not([hidden])').waitFor();
    assert.deepEqual(calls.filter((c) => c.contractAi).at(-1).contractAi, { text: OFIR, mode: 'free' });
    assert.equal(await text(ofir, '#ai-go'), 'הכנה בדיוק כמו שכתבתי');
    await checkExample(ofir, 'quote');
    assert.deepEqual(await texts(ofir, '#ai-summary li'), [
      'מסמך: הצעת מחיר',
      'משפיענים: בלי',
      'צילום כל חודש (צלם חודשי): 8 תכנים בכל חודש',
      'לא נכתבו, ולכן לא בחוזה: סרטונים, גרפיקות',
      'מחיר: 4,900 ₪ לחודש לפני מע״מ, הכול כלול',
      'תקופה: 12 חודשים (לא נכתבה תקופה)',
      '2 דפי נחיתה (כלול במחיר)',
    ]);
    assert.equal(await ofir.locator('#ai-check').count(), 0, 'nothing written is asked again');
    assert.equal(await ofir.locator('.ai-draft').count(), 0, 'one document: no cards');
    // The tags of what was filled.
    for (const id of ['custom-noinf-ai', 'custom-incl-ai', 'custom-price-ai', 'custom-lines-ai']) assert.ok(await ofir.locator(`#${id}`).isVisible(), id);
    // Information only, no approval anywhere.
    assert.match(await text(ofir, '#custom-diff .needs'), /הקישור ללקוח נוצר מיד/);
    assert.ok((await texts(ofir, '#custom-diff-list li')).includes('בלי משפיענים'));
    assert.doesNotMatch(await ofir.locator('main').innerText(), /אישור מנהל|לאישור של/);
    assert.equal(await noSideScroll(ofir), true);
    await ofir.locator('#ai-box').scrollIntoViewIfNeeded();
    await shot(ofir, '01-free-example-1280');
    await shot(ofir, '02-free-example-1280-full', true);
  });

  await step('the preview says it as written, and the link comes at once, "הוכן ע״י AI"', async () => {
    await ofir.locator('#btn-preview').click();
    await ofir.locator('#dlg-preview[open]').waitFor();
    const doc = await ofir.locator('#preview-body').innerText();
    assert.match(doc, /בלי משפיענים/);
    assert.match(doc, /כלול במחיר/);
    assert.match(doc, /2\s*דפי נחיתה/);
    assert.doesNotMatch(doc, /סמיון|נטלי|נירו/);
    await shot(ofir, '03-free-preview-1280');
    await ofir.locator('#dlg-preview .close').click();
    await ofir.locator('#btn-link').click();
    await ofir.locator('#dlg-share[open]').waitFor();
    const sent = lastCreate();
    assert.equal(sent.selection.docType, 'quote');
    assert.deepEqual(sent.selection.custom, { noInfluencer: true, qty: { videos: 0, graphics: 0, shootDays: 0, collabs: 0 }, price: 490000, addonsIncluded: true, lines: [{ label: 'דפי נחיתה', qty: 2 }] });
    const q = quotes.at(-1);
    assert.deepEqual([q.approval, q.prepared_by, q.model.totals.monthlyNet, q.model.termMonths, q.model.signable], ['none', 'ai', 490000, 12, false]);
    assert.ok(await ofir.locator('#sh-next').isHidden(), 'one document: nothing next');
    await shot(ofir, '04-free-share-1280');
    await ofir.locator('#dlg-share .close').click();
  });

  await step('two offers in one text: "הצעה 1 · הצעה 2", each its own contract, the next one tap away', async () => {
    await freshBuilder(ofir, 'quote');
    await ofir.locator('#c-name').fill('דני');
    await freeOn(ofir);
    await typeKeys(ofir, '#ai-text', TWO);
    await ofir.locator('#ai-go').click();
    await ofir.locator('#ai-result:not([hidden])').waitFor();
    assert.deepEqual((await texts(ofir, '.ai-draft .ai-draft-t')), ['הצעה 1 · 4,900 בלי משפיען', 'הצעה 2 · 6,500 עם נטלי']);
    assert.equal(await ofir.locator('#ai-draft-0').getAttribute('aria-pressed'), 'true');
    assert.equal(await ofir.locator('#custom-price').inputValue(), '4900');
    assert.equal(await ofir.locator('#custom-noinf').isChecked(), true);
    // A tap on the second loads it; back on the first.
    await ofir.locator('#ai-draft-1').click();
    assert.equal(await ofir.locator('#custom-price').inputValue(), '6500');
    assert.equal(await ofir.locator('#inf-natali').isChecked(), true);
    assert.equal(await ofir.locator('#custom-noinf').isChecked(), false);
    assert.match(await text(ofir, '#ai-result h4'), /הצעה 2 · 6,500 עם נטלי/);
    await shot(ofir, '05-two-drafts-1280');
    await ofir.locator('#ai-draft-0').click();
    assert.equal(await ofir.locator('#custom-price').inputValue(), '4900');
    await ofir.locator('#btn-link').click();
    await ofir.locator('#dlg-share[open]').waitFor();
    const first = quotes.at(-1);
    assert.equal(await text(ofir, '#sh-next'), 'להמשיך להצעה 2');
    await shot(ofir, '06-two-drafts-share-1280');
    await ofir.locator('#sh-next').click();
    await ofir.waitForFunction(() => document.getElementById('custom-price').value === '6500');
    assert.match(await text(ofir, '#ai-draft-0'), new RegExp(`נוצר · ${first.number}`));
    assert.equal(await ofir.locator('#ai-draft-1').getAttribute('aria-pressed'), 'true');
    assert.equal(await ofir.inputValue('#c-name'), 'דני', 'the same client');
    await ofir.locator('#btn-link').click();
    await ofir.locator('#dlg-share[open]').waitFor();
    const second = quotes.at(-1);
    assert.notEqual(second.number, first.number);
    assert.notEqual(second.ai_run_id, first.ai_run_id);
    assert.deepEqual([first.model.totals.monthlyNet, second.model.totals.monthlyNet], [490000, 650000]);
    assert.deepEqual([first.prepared_by, second.prepared_by], ['ai', 'ai']);
    assert.equal(second.model.package.influencer, 'נטלי דדון');
    assert.ok(await ofir.locator('#sh-next').isHidden(), 'both done');
    await ofir.locator('#dlg-share .close').click();
  });

  await step('a phone (390px): the switch, the typing and the drafts, 44px targets, nothing sideways', async () => {
    const phone = await newPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await signIn(phone, 'irit');
    await freshBuilder(phone, 'agreement');
    await phone.locator('#ai-box').scrollIntoViewIfNeeded();
    await freeOn(phone, true);
    assert.deepEqual(await smallTargets(phone, 'label.ai-free, #ai-go, #ai-text'), []);
    await typeKeys(phone, '#ai-text', TWO);
    await phone.locator('#ai-go').tap();
    await phone.locator('#ai-result:not([hidden])').waitFor();
    assert.deepEqual(await smallTargets(phone, '.ai-draft, label.custom-flag, #custom-group .btn, #custom-group input.input'), []);
    assert.equal(await noSideScroll(phone), true);
    await phone.locator('#ai-result').scrollIntoViewIfNeeded();
    await shot(phone, '07-two-drafts-390');
    await phone.locator('#custom-body').scrollIntoViewIfNeeded();
    await shot(phone, '08-free-custom-390');
    await phone.context().close();
  });

  await step('Stav on a 360px phone: "חוזה", the big box opens, his words go to Irit "לעירית להכנת חוזה"', async () => {
    const stav = await newPage(browser, { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await signIn(stav, 'stav', 'deal.html', '#deal-form:not([hidden])');
    assert.ok(await stav.locator('#d-free').isHidden(), 'the box opens after the choice');
    assert.equal(await text(stav, '#d-submit'), 'לעירית');
    await stav.locator('#d-submit').click();
    assert.ok(await stav.locator('#d-doc_type-err').isVisible());
    await stav.fill('#d-business', 'מוסך דוד');
    await stav.fill('#d-contact', 'דוד');
    await stav.fill('#d-phone', '050-7654321');
    await stav.locator('label[for="d-doc-agreement"]').tap();
    await stav.locator('#d-free:not([hidden])').waitFor();
    assert.equal(await stav.evaluate(() => document.activeElement.id), 'd-text', 'the cursor is in the box');
    assert.equal(await text(stav, '#d-submit'), 'לעירית להכנת חוזה');
    await stav.keyboard.type('6,500 עם נטלי, סושיאל', { delay: 6 });
    assert.equal(await stav.inputValue('#d-text'), '6,500 עם נטלי, סושיאל');
    assert.deepEqual(await smallTargets(stav, '#deal-form .deal-choice, #deal-form .input, #d-submit, #d-to-package'), []);
    assert.equal(await noSideScroll(stav), true);
    await shot(stav, '09-stav-agreement-360', true);
    await stav.locator('#d-submit').tap();
    await stav.waitForFunction(() => document.querySelectorAll('#deal-list .deal-item').length === 1);
    const ins = calls.filter((c) => c.insert).at(-1).insert;
    assert.deepEqual([ins.doc_type, ins.custom, ins.tier, ins.business_name], ['agreement', { text: '6,500 עם נטלי, סושיאל' }, null, 'מוסך דוד']);
    assert.match(await text(stav, '#deal-list .deal-item'), /מוסך דוד[\s\S]*ממתין לחוזה[\s\S]*חוזה · 6,500 עם נטלי/);
    // The package from the list stays a second way.
    await stav.locator('label[for="d-doc-quote"]').tap();
    await stav.locator('#d-to-package').tap();
    assert.ok(await stav.locator('#d-tiers').isVisible());
    assert.ok(await stav.locator('#d-text').isHidden());
    await stav.locator('#d-to-free').tap();
    assert.ok(await stav.locator('#d-text').isVisible());
    await stav.context().close();
  });
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await browser.close();
}

// The iPhone: WebKit, as the office's and the field's phones run Safari.
if (!exitCode) {
  const safari = await webkit.launch();
  try {
    await step('Stav on an iPhone 13 (WebKit): "הצעת מחיר", his words key by key, "לעירית להכנת הצעת מחיר"', async () => {
      const stav = await newPage(safari, { ...devices['iPhone 13'] });
      await signIn(stav, 'stav', 'deal.html', '#deal-form:not([hidden])');
      await stav.fill('#d-business', 'שטיחי רות');
      await stav.fill('#d-contact', 'רות');
      await stav.fill('#d-phone', '050-1234567');
      await stav.locator('label[for="d-doc-quote"]').tap();
      await stav.locator('#d-free:not([hidden])').waitFor();
      assert.equal(await text(stav, '#d-submit'), 'לעירית להכנת הצעת מחיר');
      // 16px: Safari does not zoom into the box.
      assert.equal(await stav.locator('#d-text').evaluate((el) => getComputedStyle(el).fontSize), '16px');
      await typeKeys(stav, '#d-text', STAV);
      assert.equal(await noSideScroll(stav), true);
      assert.deepEqual(await smallTargets(stav, '#deal-form .deal-choice, #d-submit, #d-to-package'), []);
      await shot(stav, '10-stav-quote-iphone13-webkit', true);
      await stav.locator('#d-submit').tap();
      await stav.waitForFunction(() => document.querySelectorAll('#deal-list .deal-item').length === 2);
      const ins = calls.filter((c) => c.insert).at(-1).insert;
      assert.deepEqual([ins.doc_type, ins.custom], ['quote', { text: STAV }]);
      assert.match(await text(stav, '#toast'), /נשלח לעירית: שטיחי רות\. הצעת המחיר בדרך/);
      await stav.context().close();
    });

    await step('Irit (iPhone 13): "להכין הצעת מחיר ל־שטיחי רות" with the clock and his words; the builder opens with the AI box filled, the switch on', async () => {
      const irit = await newPage(safari, { ...devices['iPhone 13'] });
      await signIn(irit, 'irit', 'clients.html#mine', null);
      await irit.locator('#deals-card:not([hidden]) .deal-task').first().waitFor();
      const d = deals.find((x) => x.business_name === 'שטיחי רות');
      const card = irit.locator(`.deal-task[data-deal="${d.id}"]`);
      const t = await card.innerText();
      assert.match(t, /להכין הצעת מחיר ל־שטיחי רות/);
      assert.match(t, /נשארו \d+:\d\d/);
      assert.match(t, /הצעת מחיר: בלי משפיען 4,900 בחודש\s+צילום כל חודש 8 תכנים\s+2 דפי נחיתה/);
      const open = card.locator('a.btn', { hasText: 'להכנת הצעת המחיר' });
      assert.equal(await open.getAttribute('href'), `index.html?deal=${d.id}`);
      // The agreement deal of the 360px step: its own words, its own button.
      assert.ok(await irit.locator('.deal-task', { hasText: 'להכין חוזה ל־מוסך דוד' }).locator('a.btn', { hasText: 'להכנת החוזה' }).count());
      await card.scrollIntoViewIfNeeded();
      await shot(irit, '11-irit-deal-card-iphone13');
      await open.tap();
      await irit.waitForURL(/index\.html\?deal=/);
      await irit.waitForFunction(() => document.getElementById('c-company').value === 'שטיחי רות');
      await irit.waitForFunction(() => { const r = document.getElementById('ai-box').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });
      assert.equal(await irit.evaluate(() => document.activeElement.id), 'ai-go', 'one press away');
      assert.equal(await irit.inputValue('#ai-text'), STAV);
      assert.equal(await irit.locator('#ai-free').isChecked(), true);
      assert.equal(await text(irit, '#ai-go'), 'הכנה בדיוק כמו שכתבתי');
      assert.deepEqual([await irit.inputValue('#c-name'), await irit.inputValue('#c-phone')], ['רות', '050-1234567']);
      assert.equal(await text(irit, '#page-h1'), 'הצעת מחיר חדשה');
      await shot(irit, '12-irit-builder-prefilled-iphone13');
      await irit.locator('#ai-go').tap();
      await irit.locator('#ai-result:not([hidden])').waitFor();
      assert.deepEqual(calls.filter((c) => c.contractAi).at(-1).contractAi, { text: STAV, mode: 'free' });
      await checkExample(irit, 'quote');
      assert.equal((await texts(irit, '#ai-summary li'))[0], 'מסמך: הצעת מחיר (כמו שנבחר במחולל)');
      assert.equal(await noSideScroll(irit), true);
      await irit.locator('#ai-result').scrollIntoViewIfNeeded();
      await shot(irit, '13-irit-filled-iphone13');
      await irit.locator('#btn-link').tap();
      await irit.locator('#dlg-share[open]').waitFor();
      const q = quotes.at(-1);
      assert.deepEqual([q.model.docType, q.model.totals.monthlyNet, q.prepared_by, q.approval], ['quote', 490000, 'ai', 'none']);
      for (let i = 0; i < 50 && deals.find((x) => x.id === d.id).status !== 'sent'; i += 1) await irit.waitForTimeout(100);
      assert.deepEqual([deals.find((x) => x.id === d.id).status, deals.find((x) => x.id === d.id).quote_id], ['sent', q.id]);
      await shot(irit, '14-irit-share-iphone13');
      await irit.context().close();
    });

    await step('Irit (1280, WebKit): the agreement deal opens as an agreement, the switch on', async () => {
      const irit = await newPage(safari, { viewport: { width: 1280, height: 900 } });
      await signIn(irit, 'irit');
      const d = deals.find((x) => x.business_name === 'מוסך דוד');
      await irit.goto(`${BASE}index.html?deal=${d.id}`);
      await irit.waitForFunction(() => document.getElementById('c-company').value === 'מוסך דוד');
      assert.equal(await text(irit, '#page-h1'), 'הסכם התקשרות חדש');
      assert.equal(await irit.locator('#ai-free').isChecked(), true);
      assert.equal(await irit.inputValue('#ai-text'), '6,500 עם נטלי, סושיאל');
      await shot(irit, '15-irit-agreement-deal-1280-webkit');
      await irit.context().close();
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
