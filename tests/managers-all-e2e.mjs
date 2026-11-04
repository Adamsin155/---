// Irit, Ofir and Lior get what the owners have, except security and the payments app (the owner's
// decision of 4.11.2026; docs/ops.md, section 96), in the browser against the roles world
// (tests/roles-world.mjs), on a phone (390) and on a wide screen (1280):
//  - the menus of every role, both profiles: the three have the owners' screens but the payments
//    app; the owners keep it; Ilai, an editor and Eli as before (shell-rules' profileMenu);
//  - a money screen for Lior: the prices in the managers' table and the sent quotes with amounts;
//  - the team page for Irit: the list, read-only, without a single security button; the owner
//    keeps every button;
//  - the archive for Ofir: restore, no permanent purge; the owner keeps the purge;
//  - the deals card for Lior: every deal, a hand-over to Irit or Ofir, no "אני לוקח".
// Screenshots: process.argv[2] or %TEMP%\claude\managers-shots.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/managers-all-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { NOW, SUPA, ROLES, emailOf, buildWorld, makeFake } from './roles-world.mjs';
import { profileMenu } from '../app/shell-rules.js';
import { hasProfiles } from '../app/manager-rules.js';
import { roleOf, summarize } from '../supabase/functions/staff-admin/rules.js';
import { scopeOf } from '../app/protocol.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || join(tmpdir(), 'claude', 'managers-shots');
mkdirSync(OUT, { recursive: true });
const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1280, height: 900 };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const MANAGERS = ['irit', 'ofir', 'lior'];
const MONEY = (person) => person === null || MANAGERS.includes(person);
const emailOfToken = (headers) => {
  const t = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1] || '';
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).email || null; } catch { return null; }
};

// The world, with what these screens need besides it: sent and signed quotes, the prices next
// to two clients, one archived client, and the staff-admin function (its own rules module).
function world() {
  const db = buildWorld();
  const [a, b] = db.clients;
  db.quotes = [
    { id: 'q1', token: 't1', number: '2026-101', client_name: a.name, monthly_gross_agorot: 585000, term_gross_agorot: 7020000, created_at: '2026-10-12T09:00:00+03:00', created_by_email: emailOf('irit'), status: 'signed', signed_at: '2026-10-13T10:00:00+03:00', approval: 'none' },
    { id: 'q2', token: 't2', number: '2026-102', client_name: b.name, monthly_gross_agorot: 468000, term_gross_agorot: 5616000, created_at: '2026-10-18T09:00:00+03:00', created_by_email: emailOf('ofir'), status: 'sent', approval: 'none' },
  ];
  a.quote_id = 'q1';
  return db;
}
function override(db, route) {
  const req = route.request();
  const url = new URL(req.url());
  const email = emailOfToken(req.headers());
  const me = db.staff.find((s) => s.email === email);
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  if (req.method() === 'OPTIONS') return json(200, {});
  if (url.pathname === '/rest/v1/rpc/manager_client_finance') {
    if (!me || !MONEY(me.person)) return json(200, []);
    return json(200, [{ client_id: db.clients[0].id, quote_number: '2026-101', signed_at: '2026-10-13T10:00:00+03:00', monthly_net_agorot: 500000, monthly_gross_agorot: 585000, term_gross_agorot: 7020000, discount_agorot: 20000, term_months: 12 }]);
  }
  if (url.pathname === '/rest/v1/rpc/archived_clients') {
    if (!me || !MONEY(me.person)) return json(200, []);
    return json(200, [{ id: 'arch-1', label: 'מוסך יוסי', name: 'יוסי', business: 'מוסך יוסי', package_name: 'סושיאל', status: 'ended', deal_at: '2026-01-01', contract_end: '2026-07-01', archived_at: '2026-10-01T09:00:00+03:00', archived_by: emailOf('owner') }]);
  }
  if (url.pathname === '/functions/v1/staff-admin') {
    const role = roleOf(me);
    if (!role) return json(403, { error: 'not_allowed' });
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    if (body.action !== 'list') return json(403, { error: role === 'owner' ? 'bad_request' : 'owner_only' });
    return json(200, {
      caller: { email, person: me.person ?? null, owner: role === 'owner', vault: !!me.vault },
      rows: db.staff.map((r) => summarize(r, { id: r.email, email: r.email, email_confirmed_at: '2026-09-01T09:00:00Z', last_sign_in_at: '2026-10-19T09:00:00Z' })),
    });
  }
  return null;
}

async function open(role, { viewport = WIDE, path = 'clients.html' } = {}) {
  const db = world();
  const fake = makeFake(db);
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, async (route) => { if (await override(db, route) === null) return fake.route(route); return undefined; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  watchCsp(page);
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role} ${path}: ${msg.text()}`); });
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  // The welcome after signing in fades out before anything is looked at.
  await page.waitForSelector('#login-block', { state: 'hidden', timeout: 15000 }).catch(() => {});
  return { page, ctx };
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
const menu = (page) => page.evaluate(() => [...document.querySelectorAll('#side-list .side-link, #side-sheet .side-link')].filter((a) => a.id !== 'side-more').map((a) => a.textContent.trim()));
const noSideScroll = async (page, label) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: no sideways scroll`);
const viewerOf = (role) => { const me = ROLES[role]; return { me, scope: me ? scopeOf(me) : 'office', error: null }; };
const labels = (items) => items.map((i) => i.label);

let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

for (const [vpName, viewport] of [['phone', PHONE], ['web', WIDE]]) {
  await step(`${vpName}: every role's menu in both profiles; the payments app only for the owners`, async () => {
    for (const role of ['owner', 'irit', 'ofir', 'lior', 'ilai', 'nadia', 'eli']) {
      const v = viewerOf(role);
      const { page, ctx } = await open(role, { viewport });
      await page.waitForSelector('#side-list .side-link');
      await settle(page);
      const mine = await menu(page);
      const want = labels(profileMenu(v, 'mine'));
      const short = Object.fromEntries(profileMenu(v, 'mine').concat(profileMenu(v, 'manager')).filter((i) => i.short).map((i) => [i.short, i.label]));
      const full = (list) => list.map((t) => short[t] || t);
      assert.deepEqual([...full(mine)].sort(), [...want].sort(), `${role} ${vpName}: the personal menu`);
      await noSideScroll(page, `${role} ${vpName}`);
      await shot(page, `menu-${role}-${vpName}-mine`);
      if (hasProfiles(v)) {
        await page.click('#profile-switch');
        await page.waitForSelector('#profile-switch[data-to="mine"]');
        await settle(page);
        const mgr = await menu(page);
        assert.deepEqual([...full(mgr)].sort(), [...labels(profileMenu(v, 'manager'))].sort(), `${role} ${vpName}: the manager menu`);
        const all = new Set([...full(mine), ...full(mgr)]);
        assert.equal(all.has('אסטרטג פיימנט'), role === 'owner', `${role}: the payments app`);
        if (MANAGERS.includes(role)) {
          for (const t of ['צוות', 'תובנות', 'החלטות', 'בקרה ושיוך', 'מעבר על הלקוחות', 'גאנט תוכן', 'שנת החבילה', 'טבלת ימי צילום', 'הצעות שנשלחו', 'הודעות ללקוחות', 'לפני יום צילום', 'ימי צילום']) {
            assert.ok(all.has(t), `${role} ${vpName}: ${t}`);
          }
        }
        await noSideScroll(page, `${role} ${vpName} manager`);
        await shot(page, `menu-${role}-${vpName}-manager`);
      } else {
        assert.equal(mine.includes('אסטרטג פיימנט') || mine.includes('צוות'), false, role);
      }
      await ctx.close();
    }
  });
}

for (const [vpName, viewport] of [['phone', PHONE], ['web', WIDE]]) {
  await step(`${vpName}: Lior sees the money: the prices in the managers' table and the sent quotes with amounts`, async () => {
    const { page, ctx } = await open('lior', { viewport, path: 'owner.html#table' });
    await page.waitForSelector('#tab-table:not([hidden])');
    await settle(page);
    if (!(await page.locator('#ow-table, .mt-table, table').first().isVisible().catch(() => false))) await page.click('#tab-table');
    await settle(page);
    const text = await page.locator('main').innerText();
    assert.match(text, /חודשי כולל מע״מ/, 'the monthly price column');
    assert.match(text, /5,850 ₪|5,850\s*₪/, 'a price');
    assert.equal(await page.locator('#tab-now').isHidden(), false, 'screen 1 is his now');
    await noSideScroll(page, `lior table ${vpName}`);
    await shot(page, `lior-table-${vpName}`);
    await page.goto(`${BASE}quotes.html`);
    await page.waitForSelector('#list-block:not([hidden])');
    await settle(page);
    assert.equal(await page.evaluate(() => document.getElementById('th-amt').hidden), false, 'the amounts column (a table head on the web, a line of each card on a phone)');
    assert.ok(await page.locator('td.amt').count() >= 2, 'an amount on each quote');
    const q = await page.locator('main').innerText();
    assert.match(q, /נשלח החודש/);
    assert.match(q, /70,200|56,160/);
    await noSideScroll(page, `lior quotes ${vpName}`);
    await shot(page, `lior-quotes-${vpName}`);
    await ctx.close();
  });
}

await step('Ilai still has no quotes and no prices', async () => {
  const { page, ctx } = await open('ilai');
  await page.waitForSelector('#side-list .side-link');
  await page.goto(`${BASE}quotes.html`);
  await page.waitForSelector('#no-access:not([hidden])');
  assert.equal(await page.locator('#list-block').isHidden(), true);
  await ctx.close();
});

for (const [vpName, viewport] of [['phone', PHONE], ['web', WIDE]]) {
  await step(`${vpName}: the team page: Irit reads the list without a single security button; the owner keeps them all`, async () => {
    const { page, ctx } = await open('irit', { viewport, path: 'team.html' });
    await page.waitForSelector('#team-list .tm-row');
    await settle(page);
    await page.waitForTimeout(1500); // the welcome after signing in fades out
    assert.equal(await page.locator('#team-readonly').isVisible(), true, 'the read-only line');
    assert.match(await page.locator('#team-lead').innerText(), /במבט אחד/);
    assert.equal(await page.locator('#team-help').isHidden(), true, 'no "how it works" for making links');
    for (const sel of ['[id^="mklink-"]', '.tm-remove', '.tm-vault-btn', '.tm-add input', '.tm-phone-edit', '[id^="ownerlink-"]', '.tm-wa-acts button', '#mc-card', '.vc-card', '.mcp-card']) {
      assert.equal(await page.locator(sel).count(), 0, `irit ${vpName}: ${sel}`);
    }
    assert.ok(await page.locator('#team-list .tm-row').count() >= 10, 'the whole list');
    await noSideScroll(page, `irit team ${vpName}`);
    await shot(page, `team-irit-${vpName}`);
    await page.screenshot({ path: join(OUT, `team-irit-${vpName}-full.png`), fullPage: true });
    await ctx.close();
    const o = await open('owner', { viewport, path: 'team.html' });
    await o.page.waitForSelector('#team-list .tm-row');
    await settle(o.page);
    await o.page.waitForTimeout(1500);
    assert.ok(await o.page.locator('[id^="mklink-"]').count() > 3, 'the owner makes links');
    assert.ok(await o.page.locator('.tm-vault-btn').count() > 3, 'the owner sets the vault');
    assert.ok(await o.page.locator('.tm-remove').count() > 3, 'the owner removes');
    assert.equal(await o.page.locator('#team-readonly').isHidden(), true);
    await shot(o.page, `team-owner-${vpName}`);
    await o.ctx.close();
  });
}

await step('the archive: Ofir restores and does not purge; the owner keeps the purge', async () => {
  for (const [role, purge] of [['ofir', false], ['lior', false], ['owner', true]]) {
    const { page, ctx } = await open(role, { path: 'owner.html#archive' });
    await page.waitForSelector('#tab-archive:not([hidden])');
    await page.click('#tab-archive');
    await page.waitForSelector('#ar-restore-arch-1');
    assert.equal(await page.locator('#ar-purge-arch-1').count(), purge ? 1 : 0, role);
    await shot(page, `archive-${role}-web`);
    await ctx.close();
  }
});

await step('the deals card: Lior sees every deal and hands one to Irit or Ofir; he does not take one', async () => {
  for (const viewport of [PHONE, WIDE]) {
    const { page, ctx } = await open('lior', { viewport, path: 'clients.html#mine' });
    await page.waitForSelector('#mine-list, #mine-empty');
    await page.waitForSelector('.deal-task', { timeout: 15000 });
    await settle(page);
    const card = page.locator('.deal-task').first();
    const acts = await card.locator('.deal-task-acts button, .deal-task-acts a').allInnerTexts();
    assert.deepEqual(acts.map((t) => t.trim()).sort(), ['להעביר לאופיר', 'להעביר לעירית'].sort(), JSON.stringify(acts));
    await card.scrollIntoViewIfNeeded();
    await shot(page, `deals-lior-${viewport.width}`);
    await ctx.close();
  }
});

await browser.close();
assert.deepEqual(errors, []);
noCspViolations();
console.log(`\n${passed} steps passed; screenshots in ${OUT}`);
