// End-to-end check of the staff WhatsApp channel's screens (stage 4): the one-time
// consent screen (the words from the database, two equal buttons, the privacy
// notice, the owner types a number), "later" by closing it, the card in "מה עליי"
// (on, stop, agree again), nobody asked while WhatsApp is off or without a
// number, the team screen (who agreed, a number yes or no, this week's messages,
// the owner's switch, no phone numbers in the WhatsApp lines), a 360px phone, and
// the privacy page. Against an in-memory fake of Supabase that follows
// supabase/migrations/20260930180000_whatsapp.sql; the page clock is Monday
// 5.10.2026 10:00 in Jerusalem.
// Run: npx http-server -p 8080 -s . &  then  node tests/whatsapp-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { summarize, roleOf } from '../supabase/functions/staff-admin/rules.js';
import { formatPhone, normPhone } from '../app/team-rules.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-10-05T07:00:00Z'); // Monday 10:00 in Jerusalem
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

const users = {
  owner: { id: randomUUID(), email: 'owner@astrateg.test', person: null },
  irit: { id: randomUUID(), email: 'irit@astrateg.test', person: 'irit', phone: '972501111111' },
  lior: { id: randomUUID(), email: 'lior@astrateg.test', person: 'lior', phone: null },
  ilai: { id: randomUUID(), email: 'ilai@astrateg.test', person: 'ilai', phone: '972503333333' },
};
const jwtOf = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: Math.floor(NOW / 1000) + 7 * 86400 })}.sig`;
const userOf = (headers) => Object.values(users).find((u) => (headers.authorization || '').includes(jwtOf(u))) || null;

const TEXT = {
  version: 1, title: 'הודעות עבודה ב־WhatsApp',
  body: 'המערכת יכולה לשלוח לך הודעות עבודה ב־WhatsApp, מהמספר העסקי של אסטרטג, למספר {phone}.\n\nמה יישלח: סיכום יומי, משימה חדשה.\n\nזו בחירה שלך. אם לא תסכים/י, תקבל/י את אותן התראות באפליקציה בלבד (Push).',
  yes: 'אני מסכים/ה לקבל הודעות ב־WhatsApp', no: 'לא, רק התראות באפליקציה',
};
const wa = {
  enabled: true,
  secrets: { access_token: true, phone_number_id: true, app_secret: true, verify_token: true },
  consents: new Map(), // email -> { status, phone }
  week: { 'irit@astrateg.test': { sent: 6, delivered: 5, read: 3, failed: 1 } },
};
const db = {
  staff: Object.values(users).map((u) => ({ email: u.email, person: u.person, vault: false, phone: u.phone ?? null, created_at: '2026-09-01T07:00:00Z' })),
  quotes: [], clients: [], protocol_checks: [], protocol_log: [], office_reviews: [], client_status_notes: [], client_tasks: [], push_subscriptions: [], reminder_log: [],
};
const calls = [];

const isOffice = (row) => !!row && (row.person === null || ['irit', 'lior', 'ofir', 'ilai'].includes(row.person));
// public.whatsapp_my_consent, as in the migration.
function myConsent(row) {
  const c = wa.consents.get(row.email) || null;
  const owner = row.person === null;
  const phone = owner ? c?.phone ?? null : row.phone;
  const active = c?.status === 'granted' && !!c.phone && c.phone === phone;
  return {
    enabled: wa.enabled, owner, phone, status: c?.status ?? null, decided_at: c ? NOW.toISOString() : null, version: c ? 1 : null, active,
    prompt: wa.enabled && (owner || !!phone) && (!c || (c.status === 'granted' && !active)),
    text: { ...TEXT, body: TEXT.body.replace('{phone}', phone ? formatPhone(phone) : '[מספר הנייד שלך]') },
  };
}

function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith('gte.')) out = out.filter((r) => String(r[k]) >= v.slice(4));
    else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
  }
  return out;
}

// public.clients as the database answers it since 20260930210000_hardening.sql (tests/fake-clients.mjs).
const CLIENT_SHAPE = { clients: () => db.clients, staff: () => db.staff };
async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const headers = req.headers();
  const json = (status, data) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
  });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  if (p === '/auth/v1/token') {
    const u = Object.values(users).find((x) => x.email === body.email);
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
    return json(200, { access_token: jwtOf(u), token_type: 'bearer', expires_in: 7 * 86400, expires_at: Math.floor(NOW / 1000) + 7 * 86400, refresh_token: 'r', user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-09-01T07:00:00Z' } });
  }
  const me = userOf(headers);
  if (p === '/auth/v1/user') return me ? json(200, { id: me.id, email: me.email, aud: 'authenticated', email_confirmed_at: '2026-09-01T07:00:00Z' }) : json(401, {});
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me);
  if (!me) return json(401, { message: 'permission denied' });
  const row = db.staff.find((s) => s.email === me.email);
  if (p.startsWith('/rest/v1/rpc/whatsapp') || p.startsWith('/functions/v1/')) calls.push({ path: p.replace('/rest/v1/rpc/', ''), by: me.email, body });
  if (p === '/rest/v1/rpc/whatsapp_my_consent') return json(200, myConsent(row));
  if (p === '/rest/v1/rpc/whatsapp_decide') {
    if (body.p_version !== 1) return json(400, { code: '22023', message: 'stale_text' });
    const phone = row.person === null ? normPhone(body.p_phone || '') || wa.consents.get(row.email)?.phone || null : row.phone;
    if (body.p_choice === 'whatsapp' && !phone) return json(400, { code: '22023', message: 'no_phone' });
    wa.consents.set(row.email, { status: body.p_choice === 'whatsapp' ? 'granted' : 'declined', phone });
    return json(200, myConsent(row));
  }
  if (p === '/rest/v1/rpc/whatsapp_withdraw') {
    const c = wa.consents.get(row.email);
    if (c?.status === 'granted') c.status = 'withdrawn';
    return json(200, myConsent(row));
  }
  if (p === '/rest/v1/rpc/whatsapp_settings') return json(200, isOffice(row) ? { enabled: wa.enabled, owner: row.person === null, secrets: wa.secrets } : null);
  if (p === '/rest/v1/rpc/whatsapp_team_status') {
    if (!isOffice(row)) return json(200, []);
    return json(200, db.staff.map((s) => {
      const c = wa.consents.get(s.email);
      const phone = s.person === null ? c?.phone : s.phone;
      return { email: s.email, person: s.person ?? 'owner', status: c?.status ?? null, phone_set: !!phone, active: c?.status === 'granted' && c.phone === phone, sent: 0, delivered: 0, read: 0, failed: 0, ...wa.week[s.email] };
    }));
  }
  if (p === '/rest/v1/rpc/whatsapp_set_enabled') {
    if (row.person !== null) return json(403, { code: '42501', message: 'not allowed: owner only' });
    if (body.p_on && !Object.values(wa.secrets).every(Boolean)) return json(400, { code: 'P0001', message: 'not_ready: WhatsApp secrets are missing in Vault' });
    wa.enabled = !!body.p_on;
    return json(200, { enabled: wa.enabled, owner: true, secrets: wa.secrets });
  }
  if (p === '/rest/v1/rpc/push_status') return json(200, []);
  if (p === '/functions/v1/staff-admin') {
    const role = roleOf(row);
    if (!role) return json(403, { error: 'not_allowed' });
    if (body.action !== 'list') return json(400, { error: 'unknown_action' });
    return json(200, { caller: { email: me.email, person: row.person, owner: role === 'owner', vault: false }, rows: db.staff.map((r) => summarize(r, { email_confirmed_at: '2026-09-01T07:00:00Z', last_sign_in_at: '2026-10-05T06:00:00Z' })) });
  }
  if (p.startsWith('/rest/v1/rpc/')) return json(404, { code: 'PGRST202', message: 'not found' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { message: 'not found' });
  const rows = applyFilters(db[m[1]], url.searchParams);
  if ((headers.accept || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' });
  return json(200, req.method() === 'GET' ? rows : []);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function open(who, path = 'clients.html#mine', { viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time: NOW });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', users[who].email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app:not([hidden])');
  return { ctx, page };
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const toastHas = (page, t) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), t);
const lastCall = (name) => calls.filter((c) => c.path === name).at(-1);
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) { console.error(`not ok - ${name}\n  errors: ${JSON.stringify(errors)}\n  calls: ${JSON.stringify(calls.slice(-4))}`); throw err; }
  passed += 1;
  console.log(`ok - ${name}`);
}

// ── Irit: the consent screen, once ─────────
const { ctx: iritCtx, page } = await open('irit');
await step('the consent screen opens by itself: the words from the database with her own number, two equal buttons, the privacy notice', async () => {
  await page.waitForSelector('#dlg-wa[open]');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'wa-h');
  const text = await page.locator('#dlg-wa').innerText();
  assert.match(text, /הודעות עבודה ב־WhatsApp[\s\S]*למספר 050-111-1111\.[\s\S]*מה יישלח:[\s\S]*זו בחירה שלך\./);
  assert.match(text, /המספר לא נכון\? עירית או ליאור מתקנים אותו בעמוד הצוות\./);
  assert.equal(await page.locator('#wa-phone').count(), 0, 'a staff member does not type a number');
  // Both choices look the same and are as big (a free choice: no default).
  const [yes, no] = await Promise.all(['#wa-whatsapp', '#wa-push'].map((s) => page.locator(s).evaluate((el) => ({ cls: el.className, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), text: el.textContent }))));
  assert.equal(yes.cls, no.cls);
  assert.deepEqual([yes.w, yes.h], [no.w, no.h]);
  assert.deepEqual([yes.text, no.text], [TEXT.yes, TEXT.no]);
  assert.match(await page.locator('#dlg-wa .wa-privacy a').getAttribute('href'), /staff-privacy\.html$/);
  assert.equal(await page.getAttribute('#dlg-wa', 'aria-labelledby'), 'wa-h');
  await shot(page, 'wa-01-consent');
});

await step('agreeing records the choice with the text version (the number is the office\'s); the card in "מה עליי" says where messages go', async () => {
  await page.click('#wa-whatsapp');
  await toastHas(page, 'הודעות העבודה יגיעו גם ב־WhatsApp');
  assert.equal(await page.locator('#dlg-wa[open]').count(), 0);
  assert.deepEqual(lastCall('whatsapp_decide').body.p_choice, 'whatsapp');
  assert.equal(lastCall('whatsapp_decide').body.p_version, 1);
  assert.equal(lastCall('whatsapp_decide').body.p_phone, null);
  await page.waitForSelector('#wa-card[data-state="on"]');
  assert.match(await page.locator('#wa-card').innerText(), /הודעות ב־WhatsApp[\s\S]*למספר 050-111-1111/);
  // Right after the notifications card.
  assert.equal(await page.evaluate(() => document.getElementById('push-card').nextElementSibling?.id), 'wa-card');
});

await step('the screen does not come back once chosen; stopping from "מה עליי", and choosing again from there', async () => {
  await page.reload();
  await page.waitForSelector('#wa-card[data-state="on"]');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#dlg-wa[open]').count(), 0);
  await page.click('#wa-card-off');
  await toastHas(page, 'הודעות ה־WhatsApp הופסקו');
  assert.ok(lastCall('whatsapp_withdraw'));
  await page.waitForSelector('#wa-card[data-state="off"]');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'wa-card-on');
  await page.click('#wa-card-on');
  await page.waitForSelector('#dlg-wa[open]');
  await page.click('#wa-push');
  await toastHas(page, 'באפליקציה בלבד');
  assert.equal(lastCall('whatsapp_decide').body.p_choice, 'push');
  assert.equal(wa.consents.get('irit@astrateg.test').status, 'declined');
  await page.waitForSelector('#wa-card[data-state="off"]');
  await shot(page, 'wa-02-card-off');
  // Agree again, for the team screen below.
  await page.click('#wa-card-on');
  await page.click('#wa-whatsapp');
  await page.waitForSelector('#wa-card[data-state="on"]');
});
await iritCtx.close();

// ── Ilai: closing the screen is "later" for this tab ──
await step('closing the screen without choosing: not again in this tab, again in a new one', async () => {
  const { ctx, page: p } = await open('ilai');
  await p.waitForSelector('#dlg-wa[open]');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#dlg-wa[open]').count(), 0);
  assert.equal(await p.getAttribute('#wa-later', 'aria-label'), 'סגירה: להחליט אחר כך');
  assert.equal(calls.filter((c) => c.by === 'ilai@astrateg.test' && c.path === 'whatsapp_decide').length, 0, 'nothing recorded');
  await p.reload();
  await p.waitForSelector('#wa-card[data-state="off"]');
  await p.waitForTimeout(300);
  assert.equal(await p.locator('#dlg-wa[open]').count(), 0);
  await ctx.close();
  // A phone has no Escape key: the × does the same.
  const again = await open('ilai');
  await again.page.waitForSelector('#dlg-wa[open]');
  await again.page.click('#wa-later');
  assert.equal(await again.page.locator('#dlg-wa[open]').count(), 0);
  assert.equal(await again.page.evaluate(() => sessionStorage.getItem('wa-consent-later')), '1');
  await again.ctx.close();
});

// ── Lior: no number, nothing to agree to ──
await step('without a number: no screen, and the card says who adds one', async () => {
  const { ctx, page: p } = await open('lior');
  await p.waitForSelector('#wa-card[data-state="none"]');
  assert.match(await p.locator('#wa-card').innerText(), /אין מספר נייד שמור במערכת[\s\S]*עירית או ליאור מוסיפים אותו/);
  assert.equal(await p.locator('#dlg-wa').count(), 0);
  await ctx.close();
});

// ── The owner: types a number ──────────────
await step('the owner keeps no number on the staff list: types one on the screen, checked before it is sent', async () => {
  const { ctx, page: p } = await open('owner');
  await p.waitForSelector('#dlg-wa[open]');
  assert.match(await p.locator('#dlg-wa').innerText(), /\[מספר הנייד שלך\]/);
  assert.equal(await p.getAttribute('#wa-phone', 'type'), 'tel');
  assert.equal(await p.locator('label[for="wa-phone"]').innerText(), 'המספר שלך');
  await p.fill('#wa-phone', '03-1234567');
  await p.click('#wa-whatsapp');
  // Said inside the screen, with the field marked and focused, and what was typed kept.
  await p.waitForSelector('#dlg-wa .wa-note[role="alert"]');
  assert.match(await p.locator('#dlg-wa .wa-note').innerText(), /צריך מספר נייד ישראלי/);
  assert.equal(await p.getAttribute('#wa-phone', 'aria-invalid'), 'true');
  assert.equal(await p.evaluate(() => document.activeElement?.id), 'wa-phone');
  assert.equal(await p.inputValue('#wa-phone'), '03-1234567');
  assert.equal(calls.filter((c) => c.by === 'owner@astrateg.test' && c.path === 'whatsapp_decide').length, 0);
  await p.fill('#wa-phone', '050-222-2222');
  await p.click('#wa-whatsapp');
  await toastHas(p, 'הודעות העבודה יגיעו גם ב־WhatsApp');
  assert.equal(lastCall('whatsapp_decide').body.p_phone, '972502222222');
  await p.waitForSelector('#wa-card[data-state="on"]');
  await ctx.close();
});

// ── The team screen ────────────────────────
await step('the team screen (owner): the switch, and per person who agreed, a number yes or no, and this week\'s messages', async () => {
  const { ctx, page: p } = await open('owner', 'team.html');
  await p.waitForSelector('#wa-panel');
  assert.match(await p.locator('#wa-state').innerText(), /^פועל\. .*\(2 מתוך 4\)/);
  assert.match(await p.locator('#row-irit').innerText(), /WhatsApp: הסכים\/ה · יש מספר · השבוע: 5 נמסרו, 3 נקראו, 1 נכשלו/);
  assert.match(await p.locator('#row-lior').innerText(), /WhatsApp: עוד לא בחר\/ה · אין מספר/);
  assert.match(await p.locator('#row-owner').innerText(), /WhatsApp: הסכים\/ה · יש מספר/);
  // No phone number in any WhatsApp line (the owner's is not on the staff list at all).
  const lines = await p.locator('.tm-wa-status').allInnerTexts();
  assert.equal(lines.length, 4);
  assert.ok(lines.every((l) => !/\d{3}-\d{3}/.test(l)), JSON.stringify(lines));
  assert.ok(!(await p.locator('body').innerText()).includes('050-222-2222'));
  assert.equal(await p.getAttribute('#wa-toggle', 'aria-pressed'), 'true');
  await shot(p, 'wa-03-team');
  await p.click('#wa-toggle');
  await toastHas(p, 'כובו');
  assert.deepEqual(lastCall('whatsapp_set_enabled').body, { p_on: false });
  await p.waitForFunction(() => document.getElementById('wa-state')?.textContent.startsWith('כבוי'));
  assert.equal(await p.evaluate(() => document.activeElement?.id), 'wa-toggle');
  // A secret missing in Vault: cannot be turned on, and the page says which.
  wa.secrets.app_secret = false;
  await p.click('#btn-refresh');
  await p.waitForSelector('#wa-missing');
  assert.match(await p.locator('#wa-missing').innerText(), /whatsapp_app_secret/);
  assert.equal(await p.locator('#wa-toggle').isDisabled(), true);
  wa.secrets.app_secret = true;
  await p.click('#btn-refresh');
  await p.waitForSelector('#wa-toggle:not([disabled])');
  await p.click('#wa-toggle');
  await toastHas(p, 'הופעלו');
  assert.equal(wa.enabled, true);
  await ctx.close();
});

await step('Irit on the team screen sees the same lines, but no switch', async () => {
  const { ctx, page: p } = await open('irit', 'team.html');
  await p.waitForSelector('#wa-panel');
  assert.equal(await p.locator('#wa-toggle').count(), 0);
  assert.match(await p.locator('#row-ilai').innerText(), /WhatsApp: עוד לא בחר\/ה · יש מספר/);
  await p.setViewportSize({ width: 360, height: 740 });
  assert.ok(await noHScroll(p), 'the team screen on a phone');
  await ctx.close();
});

await step('while WhatsApp is off nobody is asked and "מה עליי" shows nothing about it', async () => {
  wa.enabled = false;
  const { ctx, page: p } = await open('ilai');
  await p.waitForSelector('#view-mine:not([hidden])');
  await p.waitForTimeout(400);
  assert.equal(await p.locator('#dlg-wa[open]').count(), 0);
  assert.equal(await p.locator('#wa-card').isHidden(), true);
  await ctx.close();
  wa.enabled = true;
});

await step('a 360px phone: the screen fits, the two choices stack at full width; the privacy page reads well', async () => {
  const { ctx, page: p } = await open('ilai', 'clients.html#mine', { viewport: { width: 360, height: 740 } });
  await p.waitForSelector('#dlg-wa[open]');
  assert.ok(await noHScroll(p));
  const boxes = await p.locator('.wa-choice').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ w: Math.round(r.width), top: Math.round(r.top) })));
  assert.equal(boxes[0].w, boxes[1].w);
  assert.ok(boxes[1].top > boxes[0].top, 'stacked');
  const dlg = await p.locator('#dlg-wa').boundingBox();
  assert.ok(dlg.width <= 360);
  await shot(p, 'wa-04-phone');
  await p.goto(`${BASE}staff-privacy.html`);
  assert.match(await p.locator('h1').innerText(), /איזה מידע עליך נשמר/);
  assert.match(await p.locator('main').innerText(), /מה לא נאסף[\s\S]*מיקום[\s\S]*הזכויות שלך/);
  assert.ok(await noHScroll(p));
  await shot(p, 'wa-05-privacy');
  await ctx.close();
});

await browser.close();
assert.deepEqual(errors, [], `page errors: ${JSON.stringify(errors)}`);
console.log(`\n${passed} passed`);
