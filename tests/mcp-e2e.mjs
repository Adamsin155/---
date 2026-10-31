// Connecting a Claude account, in the browser (docs/ops.md, section 84), against an in-memory fake of
// Supabase (the live OAuth server is not used, and nobody signs in anywhere real):
//   - the consent page: signed out, the sign-in with real typing, key by key and with deletes, on an iPhone
//     (WebKit) and Chrome; the app's name, what it can and cannot do; approve and refuse go where Supabase says;
//   - someone who is not on the list: told so, no button; a missing or expired link; approved before;
//     an address that is not a web address is never followed;
//   - the builder opens prefilled from a draft link, no client's details, the address cleaned, a refresh
//     keeps it; a link with anything else in it fills nothing;
//   - the owner's card on the team screen: on, off, last use; Lior does not see it.
// Run: node tests/mcp-e2e.mjs [outDir]   (it serves the repository itself, on a free local port)
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { draftAnswer, DRAFT_PARAM } from '../app/mcp-draft.js';

const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
  if (!file.startsWith(normalize(ROOT)) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const BASE = `http://localhost:${server.address().port}/`;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const PEOPLE = { owner: null, owner2: null, lior: 'lior', ofir: 'ofir', irit: 'irit', anna: 'anna' };
const users = new Map();
const staff = [];
for (const [k, person] of Object.entries(PEOPLE)) {
  const email = `${k}@astrateg.test`;
  users.set(email, { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: new Date().toISOString() });
  staff.push({ email, person, vault: false, phone: null });
}
const EXP = Math.floor(Date.now() / 1000) + 3 * 3600;
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: EXP })}.sig`;
const sessionFor = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 3 * 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};

const access = new Map([['owner@astrateg.test', true], ['owner2@astrateg.test', true], ['lior@astrateg.test', true], ['ofir@astrateg.test', true]]);
const lastUsed = { 'ofir@astrateg.test': new Date(Date.now() - 3600000).toISOString() };
const calls = [];
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
let details = {};

async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch { return null; } })() : null;
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(data) });
  if (req.method() === 'OPTIONS') return json(200, {});
  const me = userOf(req.headers());
  const person = me ? staff.find((s) => s.email === me.email)?.person : undefined;
  const path = url.pathname;
  if (path === '/auth/v1/token') {
    const u = users.get(String(body?.email || '').toLowerCase());
    calls.push({ login: body?.email });
    if (!u || body?.password !== 'סיסמה-Good1') return json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return json(200, sessionFor(u));
  }
  if (path === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'no' });
  if (path === '/auth/v1/logout') return json(204, {});
  let m = /^\/auth\/v1\/oauth\/authorizations\/([^/]+)$/.exec(path);
  if (m && req.method() === 'GET') {
    calls.push({ details: m[1] });
    if (!me) return json(401, { msg: 'no' });
    if (m[1] === 'expired-id-1') return json(404, { error_code: 'oauth_authorization_not_found', msg: 'gone' });
    return json(200, details);
  }
  m = /^\/auth\/v1\/oauth\/authorizations\/([^/]+)\/consent$/.exec(path);
  if (m) {
    calls.push({ consent: body?.action, id: m[1], by: me?.email });
    const q = body?.action === 'approve' ? 'code=abc' : 'error=access_denied';
    return json(200, { redirect_url: `${CALLBACK}?${q}&state=s1` });
  }
  if (path.startsWith('/rest/v1/rpc/')) {
    const fn = path.slice('/rest/v1/rpc/'.length);
    calls.push({ rpc: fn, body });
    if (fn === 'is_staff') return json(200, person !== undefined);
    if (fn === 'is_office') return json(200, person === null || ['irit', 'lior', 'ofir'].includes(person));
    if (fn === 'my_person') return json(200, person ?? null);
    if (fn === 'sees_money') return json(200, person === null);
    if (fn === 'mcp_allowed') return json(200, !!me && access.get(me.email) === true && (person === null || ['lior', 'ofir'].includes(person)));
    if (fn === 'mcp_people') {
      if (person !== null || !me) return json(200, []);
      return json(200, staff.filter((s) => s.person === null || ['lior', 'ofir'].includes(s.person)).map((s) => ({ email: s.email, person: s.person, enabled: access.get(s.email) === true, last_used: lastUsed[s.email] || null })));
    }
    if (fn === 'mcp_set_access') {
      if (person !== null) return json(403, { message: 'not allowed', code: '42501' });
      access.set(body.p_email, body.p_enabled);
      return json(200, null);
    }
    return json(200, null);
  }
  if (path === '/rest/v1/staff') {
    const eq = url.searchParams.get('email')?.replace(/^eq\./, '');
    const rows = eq ? staff.filter((s) => s.email === eq) : staff;
    if ((req.headers().accept || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
    return json(200, rows);
  }
  if (path === '/functions/v1/staff-admin') {
    return json(200, { rows: staff.map((s) => ({ ...s, has_login: true, last_sign_in_at: new Date().toISOString() })), caller: { email: me?.email, person, owner: person === null } });
  }
  if ((req.headers().accept || '').includes('vnd.pgrst.object')) return json(406, { code: 'PGRST116', message: 'no rows' });
  return json(200, []);
}

async function opened(browser, who, options = {}) {
  const ctx = await browser.newContext({ locale: 'he-IL', serviceWorkers: 'block', ...options });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', fake);
  // Where the browser goes back to: a page of ours standing for Claude's.
  await ctx.route(`${CALLBACK}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>back at Claude</title>' }));
  if (who) {
    const u = users.get(`${who}@astrateg.test`);
    await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, ['sb-czncjzziqrqtezpwxxpz-auth-token', JSON.stringify(sessionFor(u))]);
  }
  const page = await ctx.newPage();
  watchCsp(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, errors };
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true }); };
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const smallTargets = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height < 44; }).map((e) => e.id || e.className));

const DETAILS = { authorization_id: 'auth-id-12345', redirect_uri: `${CALLBACK}`, client: { id: 'c1', name: 'Claude', uri: 'https://claude.ai' }, user: { id: 'u', email: 'x' }, scope: 'email' };
const consentUrl = `${BASE}mcp-consent.html?authorization_id=auth-id-12345`;
const PHONE = { ...devices['iPhone 13'] };
const WEB = { viewport: { width: 1280, height: 900 } };
const NARROW = { viewport: { width: 390, height: 844 } };

let failures = 0;
async function step(name, fn) {
  if (process.env.MCP_ONLY && !new RegExp(process.env.MCP_ONLY).test(name)) return;
  try { await fn(); console.log(`ok - ${name}`); } catch (err) { failures += 1; console.log(`not ok - ${name}\n  ${String(err.stack || err).slice(0, 900)}`); }
}

// Typed key by key, some of it wrong and taken back with the delete key, as a person types.
async function typeLikeAPerson(page, selector, text) {
  await page.locator(selector).click();
  const wrong = 'xy';
  await page.keyboard.type(text.slice(0, 3) + wrong, { delay: 15 });
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text.slice(3), { delay: 15 });
  assert.equal(await page.locator(selector).inputValue(), text, `${selector}: what was typed is what is there`);
}

const chrome = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const safari = await webkit.launch();
try {
  for (const [label, browser, options] of [['iPhone WebKit', safari, PHONE], ['Chrome 390', chrome, NARROW], ['Chrome 1280', chrome, WEB]]) {
    await step(`${label}: signed out, real typing, the question, approve goes back to Claude`, async () => {
      details = DETAILS;
      calls.length = 0;
      const { page, ctx, errors } = await opened(browser, null, options);
      await page.goto(consentUrl);
      await page.locator('#lg-email').waitFor();
      await shot(page, `consent-login-${label.replace(/\W+/g, '-')}`);
      await typeLikeAPerson(page, '#lg-email', 'lior@astrateg.test');
      await typeLikeAPerson(page, '#lg-pass', 'סיסמה-Good1');
      await page.keyboard.press('Enter');
      await page.locator('#mc-yes').waitFor();
      assert.match(await page.locator('#card-h').innerText(), /^Claude מבקש להתחבר/);
      assert.equal(await page.locator('#mc-host').innerText(), 'claude.ai');
      assert.equal(await page.locator('#mc-can li').count(), 2);
      assert.match(await page.locator('#mc-cannot').innerText(), /טלפונים/);
      assert.match(await page.locator('#mc-who').innerText(), /lior@astrateg\.test/);
      assert.equal(await noSideScroll(page), true);
      assert.deepEqual(await smallTargets(page, '#mc-yes, #mc-no, #mc-other'), []);
      // The sign-in's night lifts off the question by itself, after the green button.
      await page.waitForFunction(() => !('door' in document.documentElement.dataset), null, { timeout: 5000 });
      await shot(page, `consent-ask-${label.replace(/\W+/g, '-')}`);
      await page.locator('#mc-yes').click();
      await page.waitForURL(`${CALLBACK}?code=abc&state=s1`);
      assert.deepEqual(calls.find((c) => c.consent), { consent: 'approve', id: 'auth-id-12345', by: 'lior@astrateg.test' });
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  }

  await step('a wrong password stays on the form, and says so', async () => {
    details = DETAILS;
    const { page, ctx } = await opened(chrome, null, NARROW);
    await page.goto(consentUrl);
    await typeLikeAPerson(page, '#lg-email', 'lior@astrateg.test');
    await typeLikeAPerson(page, '#lg-pass', 'wrong-password');
    await page.keyboard.press('Enter');
    await page.locator('#lg-err:not([hidden])').waitFor();
    assert.equal(await page.locator('#mc-yes').count(), 0);
    await ctx.close();
  });

  await step('refusing goes back with the refusal; signed in already there is no form', async () => {
    details = DETAILS;
    calls.length = 0;
    const { page, ctx } = await opened(chrome, 'owner', WEB);
    await page.goto(consentUrl);
    await page.locator('#mc-no').click();
    await page.waitForURL(`${CALLBACK}?error=access_denied&state=s1`);
    assert.equal(calls.find((c) => c.consent).consent, 'deny');
    assert.equal(calls.filter((c) => c.login).length, 0);
    await ctx.close();
  });

  await step('someone who is not on the list, or is switched off: told so, no button, details not asked', async () => {
    details = DETAILS;
    access.set('ofir@astrateg.test', false);
    for (const who of ['irit', 'anna', 'ofir']) {
      calls.length = 0;
      const { page, ctx } = await opened(chrome, who, NARROW);
      await page.goto(consentUrl);
      await page.locator('#card-body .mc-sub').waitFor();
      assert.match(await page.locator('#card-body').innerText(), /לא פתוח לחשבון הזה/, who);
      assert.equal(await page.locator('#mc-yes').count(), 0, who);
      assert.equal(calls.filter((c) => c.details).length, 0, who);
      if (who === 'irit') await shot(page, 'consent-refused-390');
      await ctx.close();
    }
    access.set('ofir@astrateg.test', true);
    const { page, ctx } = await opened(chrome, 'anna', WEB);
    await page.goto(consentUrl);
    await page.locator('#card-body .mc-sub').waitFor();
    await shot(page, 'consent-refused-1280');
    // Another account: the form again, with the same link.
    await page.locator('#mc-other').click();
    await page.locator('#lg-email').waitFor();
    assert.equal(await page.locator('#login-block').isVisible(), true);
    await ctx.close();
  });

  await step('a missing or expired link says so, and nothing is sent for a bad one', async () => {
    for (const q of ['', '?authorization_id=', '?authorization_id=../../etc']) {
      calls.length = 0;
      const { page, ctx } = await opened(chrome, 'owner', NARROW);
      await page.goto(`${BASE}mcp-consent.html${q}`);
      await page.locator('#card-body .mc-sub').waitFor();
      assert.match(await page.locator('#card-h').innerText(), /לא תקף/);
      assert.equal(calls.filter((c) => c.details).length, 0);
      await ctx.close();
    }
    const { page, ctx } = await opened(chrome, 'owner', NARROW);
    await page.goto(`${BASE}mcp-consent.html?authorization_id=expired-id-1`);
    await page.locator('#card-body .mc-sub').waitFor();
    assert.match(await page.locator('#card-body').innerText(), /פג תוקפו/);
    await shot(page, 'consent-expired-390');
    await ctx.close();
  });

  await step('approved before: straight back; an address that is not a web address is not followed', async () => {
    details = { redirect_url: `${CALLBACK}?code=again` };
    let { page, ctx } = await opened(chrome, 'owner', NARROW);
    await page.goto(consentUrl);
    await page.waitForURL(`${CALLBACK}?code=again`);
    await ctx.close();
    for (const bad of ['javascript:alert(1)', 'http://evil.test/cb']) {
      details = { redirect_url: bad };
      ({ page, ctx } = await opened(chrome, 'owner', NARROW));
      await page.goto(consentUrl);
      await page.locator('#card-body .mc-sub').waitFor();
      assert.ok(page.url().startsWith(BASE), bad);
      await ctx.close();
    }
  });

  const DEAL = { package: 'podcast-natali', months: 6, quantities: [{ key: 'videos', value: 20 }], specialClauses: ['ללא Highlights'] };
  await step('the builder opens prefilled, no client\'s details, the address cleaned; a refresh keeps it', async () => {
    const answer = draftAnswer(DEAL);
    const hash = answer.link.slice(answer.link.indexOf('#'));
    for (const [label, browser, options] of [['1280', chrome, WEB], ['390', chrome, NARROW], ['iphone', safari, PHONE]]) {
      const { page, ctx, errors } = await opened(browser, 'lior', options);
      await page.goto(`${BASE}${hash}`);
      await page.locator('#ai-result:not([hidden])').waitFor();
      assert.equal(new URL(page.url()).hash, '', 'the address is clean');
      assert.match(await page.locator('#ai-summary').innerText(), /סרטונים: 20/);
      assert.match(await page.locator('#ai-summary').innerText(), /ללא Highlights/);
      for (const id of ['c-name', 'c-company', 'c-companyid', 'c-address', 'c-phone', 'c-email', 'c-notes']) assert.equal(await page.locator(`#${id}`).inputValue(), '', id);
      assert.equal(await page.locator('#start').isVisible(), false);
      assert.equal(await noSideScroll(page), true, label);
      // The totals on the screen are the tool's.
      const money = `${answer.monthly_with_vat_ils.toLocaleString('en-US')}`;
      assert.ok((await page.locator('body').innerText()).includes(money), `the monthly total ${money}`);
      await shot(page, `builder-draft-${label}`);
      // Nothing was created: no quote went anywhere.
      assert.equal(calls.filter((c) => /create-quote/.test(JSON.stringify(c))).length, 0);
      if (label === '1280') {
        await page.locator('#c-name').click();
        await page.keyboard.type('שם', { delay: 15 });
        await page.waitForTimeout(100);
        await page.reload();
        await page.locator('#c-name').waitFor();
        assert.equal(await page.locator('#c-name').inputValue(), 'שם', 'what was typed is kept');
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  });

  await step('a free-hand draft opens as a custom contract, exactly as written', async () => {
    const answer = draftAnswer({ mode: 'free', influencer: 'none', monthlyPrice: 490000, monthlyShoot: true, monthlyContents: 8, extraLines: [{ label: 'דפי נחיתה', qty: 2 }] });
    const { page, ctx } = await opened(chrome, 'ofir', WEB);
    await page.goto(`${BASE}${answer.link.slice(answer.link.indexOf('#'))}`);
    await page.locator('#ai-result:not([hidden])').waitFor();
    assert.match(await page.locator('#ai-summary').innerText(), /דפי נחיתה/);
    assert.match(await page.locator('#ai-summary').innerText(), /4,900/);
    await shot(page, 'builder-free-1280');
    await ctx.close();
  });

  await step('a link with a client\'s details in it, or broken, fills nothing and says so', async () => {
    for (const payload of [b64({ ...DEAL, client: { name: 'דנה' } }), b64({ ...DEAL, phone: '0501112222' }), 'not-base64!!']) {
      const { page, ctx } = await opened(chrome, 'lior', NARROW);
      await page.goto(`${BASE}#${DRAFT_PARAM}=${payload}`);
      await page.locator('#start').waitFor();
      await page.waitForFunction(() => /הקישור לטיוטה לא תקין/.test(document.querySelector('.toast')?.textContent || ''));
      assert.equal(new URL(page.url()).hash, '');
      assert.equal(await page.locator('#start').isVisible(), true, 'the start, as a new contract');
      assert.equal(await page.locator('#ai-result').isVisible(), false);
      assert.equal(await page.locator('#c-name').inputValue(), '');
      await ctx.close();
    }
  });

  await step('signed out, the builder asks for the sign-in and then opens the draft', async () => {
    const answer = draftAnswer(DEAL);
    const { page, ctx } = await opened(chrome, null, WEB);
    await page.goto(`${BASE}${answer.link.slice(answer.link.indexOf('#'))}`);
    await page.locator('#dlg-login[open] #lg-email').waitFor();
    await typeLikeAPerson(page, '#lg-email', 'ofir@astrateg.test');
    await typeLikeAPerson(page, '#lg-pass', 'סיסמה-Good1');
    await page.keyboard.press('Enter');
    await page.locator('#ai-result:not([hidden])').waitFor();
    assert.match(await page.locator('#ai-summary').innerText(), /סרטונים: 20/);
    await ctx.close();
  });

  await step('someone who does not build contracts sees the builder\'s refusal, not the draft', async () => {
    const answer = draftAnswer(DEAL);
    const { page, ctx } = await opened(chrome, 'anna', NARROW);
    await page.goto(`${BASE}${answer.link.slice(answer.link.indexOf('#'))}`);
    await page.locator('#no-access:not([hidden])').waitFor();
    assert.equal(await page.locator('#ai-result').isVisible(), false);
    await ctx.close();
  });

  await step('the owner\'s card: each person, on and off, last use; switching off asks the database', async () => {
    for (const [label, options] of [['1280', WEB], ['390', NARROW]]) {
      calls.length = 0;
      const { page, ctx, errors } = await opened(chrome, 'owner', options);
      await page.goto(`${BASE}team.html`);
      await page.locator('#mcp-panel .tm-mcp-row').first().waitFor();
      const card = page.locator('#mcp-panel');
      // Two owners: a row and a switch for each, told apart by their address.
      assert.equal(await card.locator('.tm-mcp-row').count(), 4);
      assert.equal(await card.locator('.tm-mcp-row', { hasText: 'owner@astrateg.test' }).locator('input[role=switch]').count(), 1);
      assert.equal(await card.locator('.tm-mcp-row', { hasText: 'owner2@astrateg.test' }).locator('input[role=switch]').count(), 1);
      assert.match(await card.innerText(), /שימוש אחרון/);
      assert.match(await card.innerText(), /עוד לא התחבר/);
      assert.equal(await noSideScroll(page), true, label);
      await card.scrollIntoViewIfNeeded();
      if (OUT) await card.screenshot({ path: join(OUT, `team-card-${label}.png`) });
      if (label === '1280') {
        // One owner's switch moves that owner only.
        await card.locator('.tm-mcp-row', { hasText: 'owner2@astrateg.test' }).locator('input[role=switch]').click({ force: true });
        await page.waitForFunction(() => /כובה/.test(document.querySelector('.toast')?.textContent || ''));
        assert.equal(access.get('owner2@astrateg.test'), false);
        assert.equal(access.get('owner@astrateg.test'), true);
        access.set('owner2@astrateg.test', true);
        await page.reload();
        await page.locator('#mcp-panel .tm-mcp-row').first().waitFor();
        calls.length = 0;
        const row = card.locator('.tm-mcp-row', { hasText: 'lior@astrateg.test' });
        const box = row.locator('input[role=switch]');
        assert.equal(await box.isChecked(), true);
        await box.click({ force: true });
        await page.waitForFunction(() => /כובה/.test(document.querySelector('.toast')?.textContent || ''));
        assert.deepEqual(calls.find((c) => c.rpc === 'mcp_set_access').body, { p_email: 'lior@astrateg.test', p_enabled: false });
        assert.equal(access.get('lior@astrateg.test'), false);
        await page.waitForFunction(() => { const b = [...document.querySelectorAll('.tm-mcp-row')].find((r) => r.textContent.includes('lior@')); return b && !b.querySelector('input').checked && !b.querySelector('input').disabled; });
        await card.locator('.tm-mcp-row', { hasText: 'lior@astrateg.test' }).locator('input[role=switch]').click({ force: true });
        await page.waitForFunction(() => /הופעל/.test(document.querySelector('.toast')?.textContent || ''));
        assert.equal(access.get('lior@astrateg.test'), true);
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    const { page, ctx } = await opened(chrome, 'lior', WEB);
    await page.goto(`${BASE}team.html`);
    await page.locator('#team-list li').first().waitFor();
    await page.waitForFunction(() => !document.getElementById('state').textContent);
    assert.equal(await page.locator('#mcp-panel').count(), 0, 'Lior does not see it');
    await ctx.close();
  });

  noCspViolations();
} finally {
  await chrome.close();
  await safari.close();
  server.close();
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('all passed');
process.exit(0);
