// End-to-end browser check with an in-memory fake of the Supabase API.
// Run: npx http-server -p 8080 . &  then  node tests/e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateSelection, buildQuoteModel } from '../app/pricing.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const recoverRequests = [];
const passwordUpdates = [];
const USER = { id: randomUUID(), email: 'seller@astrateg.test', aud: 'authenticated', role: 'authenticated' };
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const db = new Map();
let seq = 0;

function view(q) {
  return {
    number: q.number, createdAt: q.created_at, model: q.model, docHash: 'ab'.repeat(32),
    expiresAt: q.expires_at, expired: q.status !== 'signed' && new Date(q.expires_at) < new Date(),
    consentText: `קראתי ואני מאשר/ת את הצעת המחיר ${q.number}`, signatureHash: q.signature_png ? 'cd'.repeat(32) : null,
    status: q.status, signerName: q.signer_name, signedAt: q.signed_at, signaturePng: q.signature_png,
  };
}

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const json = (status, data) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
  });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  if (p === '/auth/v1/token') {
    if (body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: USER });
  }
  if (p === '/auth/v1/recover') { recoverRequests.push({ ...body, redirect_to: url.searchParams.get('redirect_to') }); return json(200, {}); }
  if (p === '/auth/v1/user') {
    if (req.method() === 'PUT') { passwordUpdates.push(body.password); return json(200, USER); }
    return json(200, USER);
  }
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (p === '/rest/v1/rpc/is_staff') return json(200, (req.headers().authorization || '').includes(JWT));
  // Who is signed in (app/shell.js): the owner, so the quote pages show the managers' switch.
  if (p === '/rest/v1/staff') return json(200, { person: null });
  if (p === '/functions/v1/create-quote') {
    if (!(req.headers().authorization || '').includes(JWT)) return json(401, { error: 'not signed in' });
    try { validateSelection(body.selection); } catch (e) { return json(400, { error: e.message }); }
    if (!body.client?.name?.trim()) return json(400, { error: 'client name required' });
    const q = {
      id: randomUUID(), token: randomUUID(), number: `AST-2026-${String(++seq).padStart(4, '0')}`,
      created_at: new Date().toISOString(), created_by_email: USER.email,
      model: buildQuoteModel(body.selection, body.client), status: 'sent',
    };
    q.expires_at = new Date(Date.parse(q.created_at) + q.model.validHours * 3600e3).toISOString();
    q.model.validUntil = q.expires_at;
    q.client_name = q.model.client.name;
    q.monthly_gross_agorot = q.model.totals.monthlyGross;
    db.set(q.token, q);
    return json(200, { id: q.id, token: q.token, number: q.number, created_at: q.created_at });
  }
  if (p === '/rest/v1/rpc/get_quote') {
    const q = db.get(body.p_token);
    if (!q || q.status === 'cancelled') return json(200, null);
    q.first_viewed_at ||= new Date().toISOString();
    return json(200, view(q));
  }
  if (p === '/rest/v1/rpc/sign_quote') {
    const q = db.get(body.p_token);
    if (!q) return json(404, { code: 'P0002', message: 'quote not found' });
    if (q.status === 'signed') return json(409, { code: '23505', message: 'quote already signed' });
    if (new Date(q.expires_at) < new Date()) return json(400, { code: '22023', message: 'quote expired' });
    if (!body.p_consent) return json(400, { code: '22023', message: 'consent required' });
    if (q.model.signable === false) return json(400, { code: '22023', message: 'this document does not require a signature' });
    assert.match(body.p_signature, /^data:image\/png;base64,/);
    assert.ok(body.p_signature.length < 400000, 'signature size');
    Object.assign(q, { status: 'signed', signer_name: body.p_name.trim(), signed_at: new Date().toISOString(), signature_png: body.p_signature, whatsapp: body.p_whatsapp });
    return json(200, view(q));
  }
  if (p === '/rest/v1/rpc/cancel_quote') {
    const q = [...db.values()].find((x) => x.id === body.p_id);
    q.status = 'cancelled';
    return json(200, null);
  }
  if (p === '/rest/v1/quotes') return json(200, [...db.values()].reverse().map((q) => ({
    ...q, tier: q.model.package.tierName, influencer: q.model.package.influencer,
    doc: q.model.docTitle, signable: String(q.model.signable), phone: q.model.client.phone,
  })));
  return json(404, { message: `unmocked ${p}` });
}

const browser = await chromium.launch();
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); }
  console.log(results.at(-1).join('  '));
}
const shot = async (page, name, full = true) => OUT && page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });

async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true, acceptDownloads: true });
  await ctx.route(/supabase\.co/, fakeSupabase);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(15000);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|status of (400|401|409)/.test(m.text())) page.errors.push(m.text()); });
  return page;
}
const text = (page, sel) => page.locator(sel).innerText();

console.log('start');
const page = await newPage();
console.log('page');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });

await step('start screen: choose a document type before building', async () => {
  assert.ok(await page.locator('#start').isVisible());
  assert.ok(await page.locator('#sec-package').isHidden());
  await page.locator('#start-agreement').click();
  assert.ok(await page.locator('#sec-package').isVisible());
  assert.equal(await text(page, '#page-h1'), 'הסכם התקשרות חדש');
  assert.equal(await text(page, '#btn-link'), 'יצירת קישור לחתימה');
});

await step('default: Social · Simeon 3,900 → 4,602 incl. VAT', async () => {
  assert.equal(await text(page, '#t-mnet'), '3,900 ₪');
  assert.equal(await text(page, '#t-mgross'), '4,602 ₪');
});

await step('Social+TV · Natali + photographer + reel + story = 8,200 / 1,476 / 9,676 / 116,112', async () => {
  await page.locator('label[for="inf-natali"]').click();
  await page.locator('label[for="tier-social-tv"]').click();
  for (const id of ['photographer', 'natali-reel', 'natali-story']) await page.locator(`label[for="paid-${id}"]`).click();
  assert.equal(await text(page, '#t-mnet'), '8,200 ₪');
  assert.equal(await text(page, '#t-mvat'), '1,476 ₪');
  assert.equal(await text(page, '#t-mgross'), '9,676 ₪');
  assert.equal(await text(page, '#t-ygross'), '116,112 ₪');
  assert.match(await text(page, '#term-note'), /8 תכנים בכל חודש/);
  assert.equal(await page.locator('#paid-simeon-day').count(), 0, 'simeon day hidden for natali');
});

await step('Simeon join unlocks free Simeon stories; free items listed, price unchanged', async () => {
  assert.equal(await page.locator('#free-simeonStories').count(), 0);
  await page.locator('label[for="free-simeonJoin"]').click();
  assert.equal(await page.locator('#free-simeonStories').count(), 1);
  for (let i = 0; i < 5; i++) {
    const inc = page.locator('#free-simeonStories-inc');
    if (await inc.isDisabled()) break;
    await inc.click();
  }
  assert.equal(await page.locator('#free-simeonStories').inputValue(), '3');
  assert.ok(await page.locator('#free-simeonStories-inc').isDisabled(), 'inc disabled at max');
  assert.match(await text(page, '#free-simeonStories-limit'), /מקסימום 3/);
  await page.locator('#free-graphics').fill('99');
  await page.locator('#free-graphics').press('Tab');
  assert.equal(await page.locator('#free-graphics').inputValue(), '24', 'graphics clamped');
  await page.locator('#free-graphics').fill('-3');
  await page.locator('#free-graphics').press('Tab');
  assert.equal(await page.locator('#free-graphics').inputValue(), '0');
  await page.locator('#free-graphics-inc').click();
  assert.equal(await text(page, '#t-mgross'), '9,676 ₪');
  assert.match(await text(page, '#sum-lines'), /סטורי אצל סמיון, מישל ודניס × 3/);
});

await step('keyboard: stepper keeps focus after click', async () => {
  await page.locator('#free-graphics-inc').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'free-graphics-inc');
});

await step('switch Natali → Simeon removes Natali items + join, explains', async () => {
  await page.locator('label[for="inf-simeon"]').click();
  assert.ok(await page.locator('#removed-notice').isVisible());
  const note = await text(page, '#removed-text');
  assert.match(note, /העלאה אצל נטלי/);
  assert.match(note, /סטורי אצל נטלי/);
  assert.match(note, /צירוף סמיון/);
  assert.equal(await text(page, '#t-mnet'), '6,900 ₪'); // 4,900 + photographer 2,000
  assert.equal(await page.locator('#free-simeonStories').inputValue(), '3', 'stories stay valid for simeon');
});

await step('preview/print/link require client name', async () => {
  await page.locator('#btn-preview').click();
  assert.ok(await page.locator('#c-name-err').isVisible());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'c-name');
  await page.locator('#c-name').fill('   ');
  await page.locator('#btn-print').click();
  assert.equal(await page.evaluate(() => window.__printed || 0), 0);
  assert.ok(await page.locator('#c-name-err').isVisible());
});

const nasty = 'דנה "הלקוחה" <img src=x onerror=alert(1)> & שות\'';
await step('preview renders text safely and matches summary', async () => {
  await page.locator('#c-name').fill(nasty);
  await page.locator('#c-company').fill('Cafe Noir בע"מ');
  await page.locator('#c-phone').fill('050-123-4567');
  await page.locator('#c-email').fill('dana@example.com');
  await page.locator('#c-companyid').fill('514729938');
  await page.locator('#c-notes').fill('שורה ראשונה\nשורה <b>שנייה</b>');
  await page.locator('#btn-preview').click();
  const dlg = page.locator('#dlg-preview');
  assert.ok(await dlg.isVisible());
  assert.equal(await dlg.locator('.qd-client').innerText(), nasty);
  assert.equal(await dlg.locator('img[src="x"]').count(), 0);
  const docText = await dlg.innerText();
  assert.match(docText, /6,900 ₪/);
  assert.match(docText, /8,142 ₪/);
  assert.match(docText, /97,704 ₪/);
  assert.match(docText, /ללא עלות/);
  assert.match(docText, /8 תכנים בכל חודש/);
  assert.match(docText, /הסכם התקשרות/);
  assert.match(docText, /תנאי ההסכם/);
  assert.match(docText, /6,900 ₪ לחודש \+ מע״מ כחוק/);
  assert.match(docText, /514729938/);
  assert.match(docText, /אסטרטג טכנולוגיות בע״מ/);
  await shot(page, '02-preview', false);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-preview', 'focus returns');
});

await step('print renders only the quote', async () => {
  await page.locator('#btn-print').click();
  await page.waitForFunction(() => window.__printed === 1);
  assert.ok(await page.locator('#print-root img.qd-logo').evaluate((img) => img.complete && img.naturalWidth > 0), 'logo loaded before print');
  await page.emulateMedia({ media: 'print' });
  assert.ok(await page.locator('#print-root .qd').isVisible());
  assert.ok(!(await page.locator('.topbar').isVisible()));
  if (OUT) await page.pdf({ path: `${OUT}/03-print.pdf`, format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
});

await step('Ctrl+P (beforeprint) renders the current selection', async () => {
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  assert.match(await page.locator('#print-root').innerText(), /8,142 ₪/);
});

await step('HTML download is a self-contained, escaped file', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-html').click()]);
  assert.match(dl.suggestedFilename(), /\.html$/);
  const fs = await import('node:fs/promises');
  const html = await fs.readFile(await dl.path(), 'utf8');
  assert.ok(html.includes('data:image/png;base64,'), 'logo embedded');
  assert.ok(html.includes('font/woff2') && !html.includes('fonts.googleapis'), 'fonts embedded');
  assert.ok(!html.includes('<img src=x'), 'user html escaped');
  assert.ok(html.includes('&lt;img src=x'), 'escaped text present');
});

await step('create link: wrong password shows error, then login + share dialog', async () => {
  await page.locator('#btn-link').click();
  await page.locator('#dlg-login').waitFor();
  await page.locator('#lg-email').fill('seller@astrateg.test');
  await page.locator('#lg-pass').fill('nope');
  await page.locator('#lg-submit').click();
  await page.locator('#lg-err').waitFor();
  assert.match(await text(page, '#lg-err'), /שגויים/);
  await page.locator('#lg-pass').fill('correct-horse');
  await page.locator('#lg-submit').click();
  await page.locator('#dlg-share').waitFor();
  assert.equal(db.size, 1, 'one quote created');
  await page.keyboard.press('Escape');
  await page.locator('#btn-link').dblclick();
  await page.locator('#dlg-share').waitFor();
  assert.equal(db.size, 2, 'double click creates one more quote, not two');
  assert.match(await text(page, '#sh-prev'), /קיימת הצעה פתוחה/);
  assert.match(await text(page, '#sh-number'), /AST-2026-000[12]/);
  assert.match(await page.locator('#sh-link').inputValue(), /q\.html\?t=[0-9a-f-]{36}$/);
  assert.match(await page.locator('#sh-wa').getAttribute('href'), /^https:\/\/wa\.me\/972501234567\?text=/);
  assert.match(await text(page, '#session-who'), /seller@astrateg\.test/);
  await shot(page, '04-share', false);
});
const link = await page.locator('#sh-link').inputValue();
assert.ok(page.errors.length === 0, `builder console errors: ${page.errors.join(' | ')}`);

const client = await newPage({ width: 390, height: 844 });
await step('client link shows the same quote', async () => {
  await client.goto(link, { waitUntil: 'networkidle' });
  await client.locator('.qd').waitFor();
  assert.equal(await client.locator('.qd-client').innerText(), nasty);
  const t = await client.locator('.qd').innerText();
  assert.match(t, /AST-2026-0002/);
  assert.match(t, /8,142 ₪/);
  assert.match(t, /97,704 ₪/);
  assert.equal(await client.locator('#s-name').inputValue(), '', 'signer types their own name');
  await shot(client, '05-client-mobile');
});

await step('client sign: validation, draw, consent, signed state', async () => {
  await client.locator('#s-name').fill('דנה לוי');
  await client.locator('#btn-sign').click();
  assert.ok(await client.locator('#pad-err').isVisible());
  const box = await client.locator('#pad').boundingBox();
  await client.mouse.move(box.x + 60, box.y + 110);
  await client.mouse.down();
  for (let i = 0; i <= 20; i++) await client.mouse.move(box.x + 60 + i * 12, box.y + 110 - Math.sin(i / 3) * 30);
  await client.mouse.up();
  await client.locator('#btn-sign').click();
  assert.ok(await client.locator('#s-consent-err').isVisible());
  // Decision 26: the WhatsApp updates are a separate choice, unchecked, never required.
  assert.equal(await client.locator('#s-whatsapp').isChecked(), false);
  assert.ok(await client.locator('#wa-more').isHidden());
  await client.locator('#wa-what').click();
  assert.match(await text(client, '#wa-more'), /ההסכמה לא חובה ולא משפיעה על ההסכם/);
  assert.match(await text(client, '.privacy'), /ואם סימנת את התיבה, גם לעדכוני שירות ב־WhatsApp/);
  await client.locator('#s-consent').check();
  await client.locator('#btn-sign').click();
  await client.locator('#signed').waitFor();
  assert.equal([...db.values()].find((x) => x.status === 'signed').whatsapp, false, 'signed without the WhatsApp box');
  assert.match(await text(client, '#signed-text'), /דנה לוי/);
  assert.ok(await client.locator('.qd-sign-box.is-signed img').isVisible());
  assert.ok(await client.locator('#signbox').isHidden());
  await shot(client, '06-client-signed');
});

await step('reopening a signed link shows signed, no second signature', async () => {
  await client.reload({ waitUntil: 'networkidle' });
  await client.locator('#signed').waitFor();
  assert.ok(await client.locator('#signbox').isHidden());
  assert.equal(await text(client, '#status'), 'נחתם');
});

await step('client page prints the document with Ctrl+P (no blank page)', async () => {
  await client.emulateMedia({ media: 'print' });
  assert.ok(await client.locator('.qd').isVisible());
  assert.ok(await client.locator('.cbar').isHidden());
  await client.emulateMedia({ media: 'screen' });
});

await step('bad and unknown tokens show a clear message', async () => {
  const p = await newPage();
  await p.goto(`${BASE}q.html?t=abc`, { waitUntil: 'networkidle' });
  assert.match(await text(p, '#state'), /הקישור אינו תקין/);
  await p.goto(`${BASE}q.html?t=${randomUUID()}`, { waitUntil: 'networkidle' });
  assert.match(await text(p, '#state'), /לא נמצאה/);
});
assert.ok(client.errors.length === 0, `client console errors: ${client.errors.join(' | ')}`);

await step('dashboard lists the signed quote (same session)', async () => {
  const dash = await page.context().newPage();
  await dash.goto(`${BASE}quotes.html`, { waitUntil: 'networkidle' });
  await dash.locator('#rows tr').first().waitFor();
  const row = await dash.locator('#rows tr').first().innerText();
  assert.match(row, /AST-2026-0002/);
  await dash.setViewportSize({ width: 360, height: 740 });
  const overflow = await dash.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `quotes list horizontal overflow ${overflow}px`);
  await dash.setViewportSize({ width: 1440, height: 900 });
  assert.match(row, /נחתם/);
  assert.match(row, /דנה לוי/);
  await shot(dash, '07-dashboard', false);
  await dash.locator('#btn-password').click();
  await dash.locator('#pw-new').fill('short');
  await dash.locator('#pw-submit').click();
  assert.match(await dash.locator('#pw-err').innerText(), /10 תווים/);
  await dash.locator('#pw-new').fill('a-long-new-password');
  await dash.locator('#pw-again').fill('a-long-new-password');
  await dash.locator('#pw-submit').click();
  await dash.locator('#toast').waitFor();
  assert.match(await dash.locator('#toast').innerText(), /הסיסמה עודכנה/);
});

await step('quote (view only): no legal text, link opens without signing', async () => {
  const p = await page.context().newPage();
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.locator('#start-quote').click();
  assert.equal(await text(p, '#btn-link'), 'יצירת קישור לצפייה');
  await p.locator('#c-name').fill('לקוח הצעה');
  await p.locator('#btn-preview').click();
  const doc = await p.locator('#dlg-preview').innerText();
  assert.match(doc, /הצעת מחיר/);
  assert.doesNotMatch(doc, /תנאי ההסכם/);
  assert.doesNotMatch(doc, /חתימות הצדדים/);
  await p.keyboard.press('Escape');
  await p.locator('#btn-link').click();
  await p.locator('#dlg-share').waitFor();
  assert.match(await text(p, '#sh-status'), /נשלח לצפייה/);
  const qlink = await p.locator('#sh-link').inputValue();
  const c = await newPage({ width: 390, height: 844 });
  await c.goto(qlink, { waitUntil: 'networkidle' });
  await c.locator('.qd').waitFor();
  assert.ok(await c.locator('#signbox').isHidden(), 'no signing for a quote');
  assert.ok(await c.locator('#strip-go').isHidden());
  assert.equal(await text(c, '#status'), 'לעיון');
  await shot(c, '09-client-quote');
});

await step('forgot password: asks for email, sends reset link to the quotes page', async () => {
  const f = await newPage();
  await f.goto(`${BASE}quotes.html`, { waitUntil: 'networkidle' });
  await f.locator('#lg-forgot').click();
  assert.match(await text(f, '#lg-err'), /הזינו את כתובת האימייל/);
  await f.locator('#lg-email').fill('seller@astrateg.test');
  await f.locator('#lg-forgot').click();
  await f.locator('#lg-msg').waitFor();
  assert.match(await text(f, '#lg-msg'), /נשלח אליה קישור/);
  assert.ok(await f.locator('#lg-err').isHidden());
  const last = recoverRequests.at(-1);
  assert.equal(last.email, 'seller@astrateg.test');
  assert.equal(last.redirect_to, `${BASE}quotes.html`);
  assert.deepEqual(f.errors, []);
});

await step('forgot password from the builder login dialog', async () => {
  const b = await newPage();
  await b.goto(BASE, { waitUntil: 'networkidle' });
  await b.locator('#start-quote').click();
  await b.locator('#c-name').fill('בדיקה');
  await b.locator('#btn-link').click();
  await b.locator('#dlg-login').waitFor();
  await b.locator('#lg-email').fill('seller@astrateg.test');
  await b.locator('#lg-forgot').click();
  await b.locator('#lg-msg').waitFor();
  assert.equal(recoverRequests.at(-1).redirect_to, `${BASE}quotes.html`);
  assert.deepEqual(b.errors, []);
});

await step('reset link signs in and asks for a new password; expired link explains', async () => {
  const r = await newPage();
  await r.goto(`${BASE}quotes.html#access_token=${JWT}&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery`, { waitUntil: 'networkidle' });
  await r.locator('#dlg-password').waitFor();
  assert.equal(await text(r, '#pw-h'), 'בחירת סיסמה חדשה');
  assert.ok(!(await r.evaluate(() => location.hash)), 'token removed from the address bar');
  await r.locator('#pw-new').fill('new-password-123');
  await r.locator('#pw-again').fill('new-password-123');
  await r.locator('#pw-submit').click();
  await r.locator('#dlg-password').waitFor({ state: 'hidden' });
  assert.equal(passwordUpdates.at(-1), 'new-password-123');
  assert.ok(await r.locator('#list-block').isVisible());

  const x = await newPage();
  await x.goto(`${BASE}quotes.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`, { waitUntil: 'networkidle' });
  await x.locator('#lg-err').waitFor();
  assert.match(await text(x, '#lg-err'), /פג תוקפו/);
  assert.deepEqual([...r.errors, ...x.errors], []);
});

await step('discount: up to 200 ILS a month, shown in summary, document and agreement', async () => {
  const d = await newPage();
  await d.goto(BASE, { waitUntil: 'networkidle' });
  await d.locator('#start-agreement').click();
  await d.locator('#discount').fill('150');
  assert.equal(await text(d, '#t-mnet'), '3,750 ₪');
  assert.match(await text(d, '#sum-lines'), /הנחה/);
  await d.locator('#discount').fill('500');
  assert.equal(await text(d, '#t-mnet'), '3,700 ₪', 'capped at 200');
  await d.locator('#discount').blur();
  assert.equal(await d.locator('#discount').inputValue(), '200');
  await d.locator('#c-name').fill('בדיקת הנחה');
  await d.locator('#btn-preview').click();
  const doc = await text(d, '#preview-body');
  assert.match(doc, /הנחה/);
  assert.match(doc, /לאחר הנחה של 200 ₪ לחודש/);
  assert.match(doc, /לחתימה בתוך 72 שעות מההפקה/);
  assert.deepEqual(d.errors, []);
});

await step('draft survives a refresh', async () => {
  const d = await newPage();
  await d.goto(BASE, { waitUntil: 'networkidle' });
  await d.locator('#start-quote').click();
  await d.locator('label[for="paid-photographer"]').click();
  await d.locator('#c-name').fill('טיוטה שנשמרה');
  await d.reload({ waitUntil: 'networkidle' });
  assert.ok(await d.locator('#start').isHidden(), 'start screen skipped');
  assert.equal(await d.locator('#c-name').inputValue(), 'טיוטה שנשמרה');
  assert.equal(await text(d, '#t-mnet'), '5,900 ₪');
});

await step('quote link: disclaimer and validity; expired link cannot be signed', async () => {
  const [q] = [...db.values()].filter((x) => x.model.docType === 'quote');
  const c = await newPage();
  await c.goto(`${BASE}q.html?t=${q.token}`, { waitUntil: 'networkidle' });
  assert.match(await text(c, '.qd'), /אינו הצעה לכריתת חוזה/);
  assert.match(await text(c, '.qd'), /בתוקף עד/);
  const a = [...db.values()].find((x) => x.model.docType === 'agreement' && x.status === 'sent');
  a.expires_at = new Date(Date.now() - 60e3).toISOString();
  const e = await newPage({ width: 390, height: 844 });
  await e.goto(`${BASE}q.html?t=${a.token}`, { waitUntil: 'networkidle' });
  await e.locator('#expired').waitFor();
  assert.equal(await text(e, '#status'), 'פג תוקף');
  assert.ok(await e.locator('#signbox').isHidden());
  assert.ok(await e.locator('#strip-go').isHidden());
  assert.match(await text(e, '#expired-text'), /הסכם מעודכן/);
  await shot(e, '10-expired');
});

await step('dashboard on mobile: cards show status and actions, expired filter', async () => {
  const m = await newPage({ width: 390, height: 844 });
  await m.goto(`${BASE}quotes.html`, { waitUntil: 'networkidle' });
  await m.locator('#lg-email').fill('seller@astrateg.test');
  await m.locator('#lg-pass').fill('correct-horse');
  await m.locator('#lg-submit').click();
  await m.locator('#rows tr').first().waitFor();
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
  const pill = m.locator('#rows .pill').first();
  const box = await pill.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'status visible');
  assert.ok(await m.locator('#filters button', { hasText: 'פג תוקף' }).isVisible());
  assert.match(await text(m, '#rows'), /פג תוקף/);
  await shot(m, '11-dashboard-mobile');
});

await step('mobile builder: price bar visible, no horizontal scroll', async () => {
  const m = await newPage({ width: 360, height: 740 });
  await m.goto(BASE, { waitUntil: 'networkidle' });
  await m.locator('#start-quote').click();
  assert.ok(await m.locator('#mobilebar').isVisible());
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
  await m.locator('label[for="paid-photographer"]').click();
  assert.equal(await text(m, '#mb-total'), '6,962 ₪');
  await shot(m, '08-mobile-builder');
});

await browser.close();
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
