// End-to-end browser check with an in-memory fake of the Supabase API.
// Run: npx http-server -p 8080 . &  then  node tests/e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateSelection, buildQuoteModel } from '../app/pricing.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const USER = { id: randomUUID(), email: 'seller@astrateg.test', aud: 'authenticated', role: 'authenticated' };
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const db = new Map();
let seq = 0;

function view(q) {
  return {
    number: q.number, createdAt: q.created_at, model: q.model, docHash: 'ab'.repeat(32),
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
  if (p === '/auth/v1/user') return json(200, USER);
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (p === '/rest/v1/rpc/is_staff') return json(200, (req.headers().authorization || '').includes(JWT));
  if (p === '/functions/v1/create-quote') {
    if (!(req.headers().authorization || '').includes(JWT)) return json(401, { error: 'not signed in' });
    try { validateSelection(body.selection); } catch (e) { return json(400, { error: e.message }); }
    if (!body.client?.name?.trim()) return json(400, { error: 'client name required' });
    const q = {
      id: randomUUID(), token: randomUUID(), number: `AST-2026-${String(++seq).padStart(4, '0')}`,
      created_at: new Date().toISOString(), created_by_email: USER.email,
      model: buildQuoteModel(body.selection, body.client), status: 'sent',
    };
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
    if (!body.p_consent) return json(400, { code: '22023', message: 'consent required' });
    assert.match(body.p_signature, /^data:image\/png;base64,/);
    assert.ok(body.p_signature.length < 400000, 'signature size');
    Object.assign(q, { status: 'signed', signer_name: body.p_name.trim(), signed_at: new Date().toISOString(), signature_png: body.p_signature });
    return json(200, view(q));
  }
  if (p === '/rest/v1/rpc/cancel_quote') {
    const q = [...db.values()].find((x) => x.id === body.p_id);
    q.status = 'cancelled';
    return json(200, null);
  }
  if (p === '/rest/v1/quotes') return json(200, [...db.values()].reverse().map((q) => ({ ...q, tier: q.model.package.tierName, influencer: q.model.package.influencer })));
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

await step('default: Social · Simeon 3,900 → 4,602 incl. VAT', async () => {
  assert.equal(await text(page, '#t-mnet'), '3,900 ₪');
  assert.equal(await text(page, '#t-mgross'), '4,602 ₪');
});

await step('Social+TV · Natali + photographer + reel + story = 8,200 / 1,476 / 9,676 / 116,112', async () => {
  await page.locator('input[name=influencer][value=natali]').check();
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
  assert.match(await text(page, '#sum-lines'), /סטורי אצל סמיון, מישל ודניס · 3/);
});

await step('keyboard: stepper keeps focus after click', async () => {
  await page.locator('#free-graphics-inc').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'free-graphics-inc');
});

await step('switch Natali → Simeon removes Natali items + join, explains', async () => {
  await page.locator('input[name=influencer][value=simeon]').check();
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
  await shot(page, '02-preview', false);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-preview', 'focus returns');
});

await step('print renders only the quote', async () => {
  await page.locator('#btn-print').click();
  assert.equal(await page.evaluate(() => window.__printed), 1);
  await page.emulateMedia({ media: 'print' });
  assert.ok(await page.locator('#print-root .qd').isVisible());
  assert.ok(!(await page.locator('.topbar').isVisible()));
  if (OUT) await page.pdf({ path: `${OUT}/03-print.pdf`, format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
});

await step('HTML download is a self-contained, escaped file', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-html').click()]);
  assert.match(dl.suggestedFilename(), /\.html$/);
  const fs = await import('node:fs/promises');
  const html = await fs.readFile(await dl.path(), 'utf8');
  assert.ok(html.includes('data:image/png;base64,'), 'logo embedded');
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
  assert.match(await text(page, '#sh-number'), /AST-2026-0001/);
  assert.match(await page.locator('#sh-link').inputValue(), /q\.html\?t=[0-9a-f-]{36}$/);
  assert.match(await page.locator('#sh-wa').getAttribute('href'), /^https:\/\/wa\.me\/\?text=/);
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
  assert.match(t, /AST-2026-0001/);
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
  await client.locator('#s-consent').check();
  await client.locator('#btn-sign').click();
  await client.locator('#signed').waitFor();
  assert.match(await text(client, '#signed-text'), /דנה לוי/);
  assert.ok(await client.locator('.qd-sign.is-signed img').isVisible());
  assert.ok(await client.locator('#signbox').isHidden());
  await shot(client, '06-client-signed');
});

await step('reopening a signed link shows signed, no second signature', async () => {
  await client.reload({ waitUntil: 'networkidle' });
  await client.locator('#signed').waitFor();
  assert.ok(await client.locator('#signbox').isHidden());
  assert.equal(await text(client, '#status'), 'נחתם');
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
  assert.match(row, /AST-2026-0001/);
  assert.match(row, /נחתם/);
  assert.match(row, /דנה לוי/);
  await shot(dash, '07-dashboard', false);
});

await step('mobile builder: price bar visible, no horizontal scroll', async () => {
  const m = await newPage({ width: 360, height: 740 });
  await m.goto(BASE, { waitUntil: 'networkidle' });
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
