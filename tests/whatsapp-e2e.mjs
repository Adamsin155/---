// End-to-end check of the staff WhatsApp channel's screens (stage 4), since 21.10.2026 a
// required work channel together with the app's notifications: the screen (the words
// from the database, one line per channel, each done ✓ or a button, the privacy
// notice, the owner types a number), "later" by closing it and back on the next page
// until both are on, "הסר" brings it back, the card in "המשימות שלי" (both lines, no
// "stop"), nobody asked while WhatsApp is off, the team screen (✓ or ✗ per person,
// who is not connected yet, a number yes or no, this week's messages, the owner's
// switch, no phone numbers in the WhatsApp lines), 390px and 360px phones, and the
// privacy page. Against an in-memory fake of Supabase that follows
// supabase/migrations/20260930180000_whatsapp.sql and 20261030100000_whatsapp_mandatory.sql,
// and a fake of the browser's notifications (as tests/push-e2e.mjs); the page clock is
// Monday 5.10.2026 10:00 in Jerusalem.
// Run: npx http-server -p 8080 -s . &  then  node tests/whatsapp-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { summarize, roleOf } from '../supabase/functions/staff-admin/rules.js';
import { formatPhone, normPhone } from '../app/team-rules.js';
import { withClientColumns } from './fake-clients.mjs';
import { VAPID_PUBLIC_KEY } from '../app/push-config.js';

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

// Version 2 (20261030100000_whatsapp_mandatory.sql), shortened.
const TEXT = {
  version: 2, title: 'חובה: גם WhatsApp וגם התראות באפליקציה',
  body: 'הודעות העבודה מגיעות בשני ערוצים, ושניהם חובה לכל הצוות: WhatsApp, מהמספר העסקי הייעודי של אסטרטג, למספר {phone}, והתראות של האפליקציה בטלפון.\n\nמה יישלח: סיכום יומי, משימה חדשה.\n\nמתי: רק בימים א׳–ה׳ בין 08:30 ל־19:00.',
  yes: 'חיבור WhatsApp', no: 'אחר כך',
};
const wa = {
  enabled: true,
  secrets: { access_token: true, phone_number_id: true, app_secret: true, verify_token: true },
  // The provider (20261025100000_whatsapp_jako.sql): Meta by default; with Jako the secrets are
  // its key and the reply flows' secret, and the two reply flows must be set.
  provider: 'meta', jakoSecrets: { jako_api_key: true, jako_hook_secret: true }, jakoFlows: { done: true, onit: true },
  consents: new Map(), // email -> { status, phone, via }
  week: { 'irit@astrateg.test': { sent: 6, delivered: 5, read: 3, failed: 1 } },
};
const db = {
  staff: Object.values(users).map((u) => ({ email: u.email, person: u.person, vault: false, phone: u.phone ?? null, created_at: '2026-09-01T07:00:00Z' })),
  quotes: [], clients: [], protocol_checks: [], protocol_log: [], office_reviews: [], client_status_notes: [], client_tasks: [], push_subscriptions: [], reminder_log: [],
};
const calls = [];
// Metricool as the database and its function answer (nothing leaves the machine).
const mc = {
  enabled: false, secrets: { user_token: true, user_id: false }, mapped: 0, synced: 0, failed: 0, lastAt: null, lastError: null,
  answer: { ok: true, account: 'office@astrateg.test', brands: 14 }, calls: [],
};

const isOffice = (row) => !!row && (row.person === null || ['irit', 'lior', 'ofir', 'ilai'].includes(row.person));
// public.whatsapp_my_consent, as in the migration.
function myConsent(row) {
  const c = wa.consents.get(row.email) || null;
  const owner = row.person === null;
  const phone = owner ? c?.phone ?? null : row.phone;
  const active = c?.status === 'granted' && !!c.phone && c.phone === phone;
  return {
    enabled: wa.enabled, required: true, owner, phone, status: c?.status ?? null, via: c?.via ?? null, decided_at: c ? NOW.toISOString() : null, version: c ? 2 : null, active,
    prompt: wa.enabled && (owner || !!phone) && !active,
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
    if (body.p_choice === 'push') return json(400, { code: '22023', message: 'required: WhatsApp is a required work channel' });
    if (body.p_version !== 2) return json(400, { code: '22023', message: 'stale_text' });
    const phone = row.person === null ? normPhone(body.p_phone || '') || wa.consents.get(row.email)?.phone || null : row.phone;
    if (body.p_choice === 'whatsapp' && !phone) return json(400, { code: '22023', message: 'no_phone' });
    wa.consents.set(row.email, { status: 'granted', phone, via: null });
    return json(200, myConsent(row));
  }
  // No "stop" from the app any more (20261030100000_whatsapp_mandatory.sql).
  if (p === '/rest/v1/rpc/whatsapp_withdraw') return json(403, { code: '42501', message: 'permission denied for function whatsapp_withdraw' });
  // This device's notifications (app/push.js, as tests/push-e2e.mjs).
  if (p === '/rest/v1/rpc/push_subscribe') {
    db.push_subscriptions = db.push_subscriptions.filter((x) => !(x.endpoint === body.p_endpoint && x.email === me.email));
    db.push_subscriptions.push({ id: randomUUID(), email: me.email, endpoint: body.p_endpoint, confirmed_at: null, last_ok_at: null, created_at: NOW.toISOString() });
    return json(200, db.push_subscriptions.at(-1).id);
  }
  if (p === '/functions/v1/reminders') {
    const mine = db.push_subscriptions.filter((x) => x.email === me.email);
    return mine.length ? json(200, { ok: true, devices: mine.length }) : json(404, { error: 'no_device' });
  }
  // public.whatsapp_settings: the secrets it names are the chosen provider's.
  const waSecrets = () => (wa.provider === 'jako' ? wa.jakoSecrets : wa.secrets);
  const waReady = () => Object.values(waSecrets()).every(Boolean) && (wa.provider !== 'jako' || Object.values(wa.jakoFlows).every(Boolean));
  const waSettings = () => ({ enabled: wa.enabled, owner: row.person === null, provider: wa.provider, ready: waReady(), secrets: waSecrets(), ...(wa.provider === 'jako' ? { flows: wa.jakoFlows } : {}) });
  if (p === '/rest/v1/rpc/whatsapp_settings') return json(200, isOffice(row) ? waSettings() : null);
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
    if (body.p_on && !waReady()) return json(400, { code: 'P0001', message: 'not_ready: WhatsApp secrets are missing in Vault' });
    wa.enabled = !!body.p_on;
    return json(200, waSettings());
  }
  // "חיבור Metricool" (app/metricool-team.js; 20261007100100_metricool.sql): the settings for the
  // office, the switch for the owner, and the connection check through the edge function.
  const mcSettings = () => ({ enabled: mc.enabled, owner: row.person === null, canEdit: row.person === null || row.person === 'ilai', secrets: mc.secrets, mapped: mc.mapped, synced: mc.synced, failed: mc.failed, lastAt: mc.lastAt, lastError: mc.lastError });
  if (p === '/rest/v1/rpc/metricool_settings') return json(200, isOffice(row) ? mcSettings() : null);
  if (p === '/rest/v1/rpc/metricool_set_enabled') {
    mc.calls.push({ path: 'metricool_set_enabled', by: me.email, body });
    if (row.person !== null) return json(403, { code: '42501', message: 'not allowed: owner only' });
    if (body.p_on && !(mc.secrets.user_token && mc.secrets.user_id)) return json(400, { code: 'P0001', message: 'not_ready: Metricool secrets are missing in Vault' });
    mc.enabled = !!body.p_on;
    return json(200, mcSettings());
  }
  if (p === '/functions/v1/metricool') {
    mc.calls.push({ path: 'metricool', by: me.email, body });
    if (body.action !== 'check' || row.person !== null) return json(403, { error: 'not_allowed' });
    return json(200, mc.answer);
  }
  if (p === '/rest/v1/rpc/push_status') {
    return json(200, isOffice(row) ? db.staff.map((x) => ({ email: x.email, person: x.person ?? 'owner', devices: db.push_subscriptions.filter((d) => d.email === x.email).length, confirmed: 0, last_ok_at: null, failing: 0 })) : []);
  }
  if (p === '/functions/v1/staff-admin') {
    const role = roleOf(row);
    if (!role) return json(403, { error: 'not_allowed' });
    if (body.action !== 'list') return json(400, { error: 'unknown_action' });
    return json(200, { caller: { email: me.email, person: row.person, owner: role === 'owner', vault: false }, rows: db.staff.map((r) => summarize(r, { email_confirmed_at: '2026-09-01T07:00:00Z', last_sign_in_at: '2026-10-05T06:00:00Z' })) });
  }
  if (p.startsWith('/rest/v1/rpc/')) return json(404, { code: 'PGRST202', message: 'not found' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { message: 'not found' });
  // Row level security: each person reads only their own devices.
  const rows = applyFilters(m[1] === 'push_subscriptions' ? db.push_subscriptions.filter((x) => x.email === me.email) : db[m[1]], url.searchParams);
  if ((headers.accept || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' });
  return json(200, req.method() === 'GET' ? rows : []);
}

// A fake Notification and PushManager (as tests/push-e2e.mjs): permission and the
// subscription live in this context's storage.
// `subscribed`: this device already has the notifications on (a page that is not about them).
const fakePush = ({ key, permission = 'default', subscribed = false }) => {
  const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4)), (c) => c.charCodeAt(0));
  window.__asked = 0;
  if (subscribed) { try { localStorage.setItem('fake.perm', 'granted'); localStorage.setItem('fake.sub', '1'); } catch { /* no storage */ } }
  const perm = () => { try { return localStorage.getItem('fake.perm') || permission; } catch { return permission; } };
  class FakeNotification {
    static get permission() { return perm(); }
    static async requestPermission() { window.__asked += 1; if (permission === 'denied') return 'denied'; localStorage.setItem('fake.perm', 'granted'); return 'granted'; }
  }
  window.Notification = FakeNotification;
  const make = () => ({
    endpoint: 'https://push.test/device-1',
    options: { applicationServerKey: bytes.buffer, userVisibleOnly: true },
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) } }; },
    async unsubscribe() { localStorage.removeItem('fake.sub'); return true; },
  });
  PushManager.prototype.getSubscription = async function getSubscription() { return localStorage.getItem('fake.sub') ? make() : null; };
  PushManager.prototype.subscribe = async function subscribe() { localStorage.setItem('fake.sub', '1'); return make(); };
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function open(who, path = 'clients.html#mine', { viewport = { width: 1280, height: 900 }, push = {} } = {}) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.addInitScript(fakePush, { key: VAPID_PUBLIC_KEY, ...push });
  await ctx.clock.install({ time: NOW });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', users[who].email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app:not([hidden])');
  return { ctx, page };
}
const ON = { subscribed: true }; // this device's notifications already on
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

// ── Irit: the screen, until both channels are on ──
const PHONE = { width: 390, height: 844 };
const { ctx: iritCtx, page } = await open('irit', 'clients.html#mine', { viewport: PHONE });
await step('the screen opens by itself: the required wording with her own number, one line per channel with its button, the privacy notice', async () => {
  await page.waitForSelector('#dlg-wa[open]');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'wa-h');
  assert.equal(await page.locator('#wa-h').innerText(), 'חובה: גם WhatsApp וגם התראות באפליקציה');
  const text = await page.locator('#dlg-wa').innerText();
  assert.match(text, /שניהם חובה לכל הצוות[\s\S]*למספר 050-111-1111,[\s\S]*מה יישלח:/);
  assert.match(text, /המספר לא נכון\? עירית או ליאור מתקנים אותו בעמוד הצוות\./);
  assert.doesNotMatch(text, /בחירה שלך/);
  assert.equal(await page.locator('#wa-phone').count(), 0, 'a staff member does not type a number');
  // One way forward per channel: no "push only", no "no".
  assert.equal(await page.locator('#wa-push').count(), 0);
  assert.match(await page.locator('#wa-dlg-wa').innerText(), /WhatsApp: עוד לא מחובר\./);
  assert.equal(await page.locator('#wa-whatsapp').innerText(), 'חיבור WhatsApp');
  assert.match(await page.locator('#wa-dlg-push').innerText(), /התראות באפליקציה: עוד לא פעילות בטלפון הזה\./);
  assert.equal(await page.locator('#wa-push-on').innerText(), 'הפעלת התראות');
  assert.equal(await page.evaluate(() => window.__asked), 0, 'permission is asked only from the button');
  assert.match(await page.locator('#dlg-wa .wa-privacy a').getAttribute('href'), /staff-privacy\.html$/);
  assert.equal(await page.getAttribute('#dlg-wa', 'aria-labelledby'), 'wa-h');
  assert.ok(await noHScroll(page));
  await shot(page, 'wa-01-consent');
  if (OUT) await page.screenshot({ path: `${OUT}/wa-mandatory-consent-390.png` });
});

await step('"חיבור WhatsApp" records it with the new wording\'s version (the number is the office\'s); the line turns ✓ and the screen waits for the notifications', async () => {
  await page.click('#wa-whatsapp');
  await toastHas(page, 'WhatsApp מחובר');
  assert.equal(lastCall('whatsapp_decide').body.p_choice, 'whatsapp');
  assert.equal(lastCall('whatsapp_decide').body.p_version, 2);
  assert.equal(lastCall('whatsapp_decide').body.p_phone, null);
  assert.equal(await page.locator('#dlg-wa[open]').count(), 1, 'the notifications are still missing');
  assert.match(await page.locator('#wa-dlg-wa.is-done').innerText(), /WhatsApp מחובר, למספר 050-111-1111/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'wa-push-on');
});

await step('"הפעלת התראות" connects this device (permission, subscribe, a test notification); both on, the screen closes by itself', async () => {
  await page.click('#wa-push-on');
  await toastHas(page, 'הכול מחובר');
  assert.equal(await page.locator('#dlg-wa[open]').count(), 0);
  assert.equal(await page.evaluate(() => window.__asked), 1);
  assert.ok(calls.some((c) => c.path === '/functions/v1/reminders' && c.by === 'irit@astrateg.test'), 'the test notification');
  assert.equal(db.push_subscriptions.filter((x) => x.email === 'irit@astrateg.test').length, 1);
  // The card in "המשימות שלי": both lines ✓, and nothing to stop with.
  await page.waitForSelector('#wa-card[data-state="on"].is-done');
  assert.match(await page.locator('#wa-card').innerText(), /חובה: גם WhatsApp וגם התראות באפליקציה[\s\S]*WhatsApp מחובר, למספר 050-111-1111[\s\S]*ההתראות באפליקציה פעילות בטלפון הזה/);
  assert.equal(await page.locator('#wa-card button').count(), 0, 'no "stop"');
  assert.equal(await page.locator('#push-card button:has-text("כיבוי")').count(), 0, 'and no "off" on the notifications card');
  // Right after the notifications card.
  assert.equal(await page.evaluate(() => document.getElementById('push-card').nextElementSibling?.id), 'wa-card');
  await page.locator('#wa-card').scrollIntoViewIfNeeded();
  if (OUT) await page.locator('#wa-card').screenshot({ path: `${OUT}/wa-mandatory-card-done-390.png` });
});

await step('once both are on the screen does not come back; "הסר" on WhatsApp brings it back with the reason, and connecting again closes it', async () => {
  await page.reload();
  await page.waitForSelector('#wa-card[data-state="on"]');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#dlg-wa[open]').count(), 0);
  // She replied "הסר" on WhatsApp (public.whatsapp_apply: withdrawn, via WhatsApp).
  Object.assign(wa.consents.get('irit@astrateg.test'), { status: 'withdrawn', via: 'whatsapp' });
  await page.reload();
  await page.waitForSelector('#dlg-wa[open]');
  assert.match(await page.locator('#wa-dlg-wa').innerText(), /WhatsApp: נותק בתשובה ״הסר״\. צריך לחבר שוב\./);
  assert.equal(await page.locator('#wa-dlg-push.is-done').count(), 1, 'the notifications are still on here');
  await page.click('#wa-whatsapp');
  await toastHas(page, 'הכול מחובר');
  assert.equal(await page.locator('#dlg-wa[open]').count(), 0);
  await page.waitForSelector('#wa-card[data-state="on"]');
});
await iritCtx.close();

// ── Ilai: closing the screen is "later", until the next page ──
await step('closing the screen: nothing recorded, and it comes back on the next page; the card has a button for each missing channel', async () => {
  const { ctx, page: p } = await open('ilai', 'clients.html#mine', { viewport: PHONE });
  await p.waitForSelector('#dlg-wa[open]');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#dlg-wa[open]').count(), 0);
  assert.equal(await p.getAttribute('#wa-later', 'aria-label'), 'סגירה: אחר כך');
  assert.equal(calls.filter((c) => c.by === 'ilai@astrateg.test' && c.path === 'whatsapp_decide').length, 0, 'nothing recorded');
  await p.waitForSelector('#wa-card[data-state="off"]');
  assert.match(await p.locator('#wa-card').innerText(), /WhatsApp: עוד לא מחובר\.[\s\S]*התראות באפליקציה: עוד לא פעילות/);
  assert.equal(await p.locator('#wa-card-on').innerText(), 'חיבור WhatsApp');
  assert.equal(await p.locator('#wa-card-push-on').innerText(), 'הפעלת התראות');
  await p.locator('#wa-card').scrollIntoViewIfNeeded();
  if (OUT) await p.locator('#wa-card').screenshot({ path: `${OUT}/wa-mandatory-card-390.png` });
  // The next page load (the same tab): back.
  await p.reload();
  await p.waitForSelector('#dlg-wa[open]');
  // A phone has no Escape key: the × does the same.
  await p.click('#wa-later');
  assert.equal(await p.locator('#dlg-wa[open]').count(), 0);
  // From the card: the notifications here, then WhatsApp from the screen it opens.
  await p.click('#wa-card-push-on');
  await p.waitForSelector('#wa-card[data-push="confirm"]');
  assert.equal(await p.locator('#wa-card-push-on').count(), 0);
  await p.click('#wa-card-on');
  await p.waitForSelector('#dlg-wa[open]');
  assert.equal(await p.locator('#wa-dlg-push.is-done').count(), 1);
  await p.click('#wa-whatsapp');
  await toastHas(p, 'הכול מחובר');
  await p.waitForSelector('#wa-card[data-state="on"].is-done');
  await ctx.close();
  // For the team screen below: Ilai not connected (as before he was asked).
  wa.consents.delete('ilai@astrateg.test');
  db.push_subscriptions = db.push_subscriptions.filter((x) => x.email !== 'ilai@astrateg.test');
});

await step('notifications blocked in the browser: the screen says how to open them', async () => {
  const { ctx, page: p } = await open('ilai', 'clients.html#mine', { viewport: PHONE, push: { permission: 'denied' } });
  await p.waitForSelector('#dlg-wa[open]');
  assert.match(await p.locator('#wa-dlg-push').innerText(), /חסומות בטלפון הזה[\s\S]*הגדרות אתרים ← התראות ← לאפשר/);
  assert.equal(await p.locator('#wa-push-on').count(), 0);
  await ctx.close();
});

// ── Lior: no number ──
await step('without a number: the screen asks only for the notifications, and says who adds the number', async () => {
  const { ctx, page: p } = await open('lior');
  await p.waitForSelector('#dlg-wa[open]');
  assert.match(await p.locator('#wa-dlg-wa').innerText(), /אין מספר נייד שמור במערכת\. עירית או ליאור מוסיפים אותו בעמוד הצוות\./);
  assert.equal(await p.locator('#wa-whatsapp').count(), 0);
  await p.click('#wa-push-on');
  await toastHas(p, 'ההתראות באפליקציה פעילות');
  await p.waitForSelector('#wa-card[data-state="none"]');
  assert.match(await p.locator('#wa-card').innerText(), /אין מספר נייד שמור במערכת[\s\S]*עירית או ליאור מוסיפים אותו/);
  await p.reload();
  await p.waitForSelector('#wa-card[data-state="none"]');
  await p.waitForTimeout(300);
  assert.equal(await p.locator('#dlg-wa[open]').count(), 0, 'nothing he can do here: not asked again');
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
  await toastHas(p, 'WhatsApp מחובר');
  assert.equal(lastCall('whatsapp_decide').body.p_phone, '972502222222');
  assert.equal(await p.locator('#wa-phone').count(), 0, 'connected: the field is gone');
  await p.click('#wa-push-on');
  await toastHas(p, 'הכול מחובר');
  await p.waitForSelector('#wa-card[data-state="on"]');
  // The app never offers to stop: the old function is refused if called anyway.
  assert.equal(calls.filter((c) => c.path === 'whatsapp_withdraw').length, 0);
  await ctx.close();
});

// ── The team screen ────────────────────────
await step('the team screen (owner): the switch, who is not connected yet, and per person ✓ or ✗ for WhatsApp and the notifications, a number yes or no, and this week\'s messages', async () => {
  const { ctx, page: p } = await open('owner', 'team.html', { push: ON });
  await p.waitForSelector('#wa-panel');
  assert.equal(await p.locator('#dlg-wa[open]').count(), 0, 'the owner is connected on both');
  assert.match(await p.locator('#wa-state').innerText(), /^פועל\. חובה לכולם: WhatsApp והתראות באפליקציה\. ב־WhatsApp מחוברים 2 מתוך 4\./);
  assert.match(await p.locator('#wa-not-connected').innerText(), /✗ לא מחוברים עדיין: ליאור \(WhatsApp\) · עילאי \(WhatsApp, התראות\)/);
  assert.match(await p.locator('#row-irit').innerText(), /✓ WhatsApp: מחובר\/ת · יש מספר · השבוע: 5 נמסרו, 3 נקראו, 1 נכשלו/);
  assert.match(await p.locator('#row-irit').innerText(), /✓ התראות: מכשיר אחד/);
  assert.match(await p.locator('#row-lior').innerText(), /✗ WhatsApp: לא מחובר\/ת · אין מספר/);
  assert.match(await p.locator('#row-ilai').innerText(), /✗ WhatsApp: לא מחובר\/ת · יש מספר/);
  assert.match(await p.locator('#row-ilai').innerText(), /✗ התראות: לא מחובר\/ה/);
  assert.match(await p.locator('#row-owner').innerText(), /✓ WhatsApp: מחובר\/ת · יש מספר/);
  if (OUT) await p.locator('#wa-panel').screenshot({ path: `${OUT}/wa-mandatory-team-panel.png` });
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

await step('the team screen (owner): "חיבור Metricool": the secrets by name, no switch while one is missing, the check, the switch, the last sync', async () => {
  const OUT2 = process.argv[2] || null;
  const { ctx, page: p } = await open('owner', 'team.html', { viewport: { width: 1440, height: 900 }, push: ON });
  await p.waitForSelector('#mc-panel');
  assert.equal(await p.locator('#mc-panel-h').innerText(), 'חיבור Metricool');
  assert.match(await p.locator('#mc-state').innerText(), /החיבור ל־Metricool כבוי: מסמנים ״תוזמן״ ו״עלה״ ביד/);
  assert.deepEqual(await p.locator('#mc-secrets li').allInnerTexts(), ['metricool_user_token · קיים ב־Vault', 'metricool_user_id · חסר ב־Vault']);
  assert.match(await p.locator('#mc-missing').innerText(), /סעיף 27/);
  assert.equal(await p.locator('#mc-toggle').isDisabled(), true);
  assert.equal(await p.locator('#mc-check').isDisabled(), true);
  assert.equal(mc.calls.length, 0, 'opening the page calls nothing');
  // The second secret arrives.
  mc.secrets.user_id = true;
  await p.click('#btn-refresh');
  await p.waitForSelector('#mc-toggle:not([disabled])');
  assert.equal(await p.locator('#mc-missing').count(), 0);
  await p.click('#mc-check');
  await p.waitForSelector('#mc-result');
  assert.equal(await p.locator('#mc-result').innerText(), 'החיבור תקין: החשבון office@astrateg.test, 14 מותגים.');
  assert.deepEqual(mc.calls.at(-1), { path: 'metricool', by: 'owner@astrateg.test', body: { action: 'check' } });
  // A token Metricool refuses: said in Hebrew, with what to check.
  mc.answer = { ok: false, error: 'auth' };
  await p.click('#mc-check');
  await p.waitForFunction(() => /החיבור לא עובד/.test(document.getElementById('mc-result')?.textContent || ''));
  assert.match(await p.locator('#mc-result').innerText(), /Metricool דחה את הטוקן\. צריך לבדוק את metricool_user_token/);
  mc.answer = { ok: true, account: 'office@astrateg.test', brands: 14 };
  await p.click('#mc-check');
  await p.waitForFunction(() => /החיבור תקין/.test(document.getElementById('mc-result')?.textContent || ''));
  // On: asked first, then the state and the summary of the last sync.
  await p.click('#mc-toggle');
  await toastHas(p, 'הסנכרון מ־Metricool הופעל');
  assert.deepEqual(mc.calls.at(-1).body, { p_on: true });
  assert.equal(await p.getAttribute('#mc-toggle', 'aria-pressed'), 'true');
  assert.equal(await p.locator('#mc-toggle').innerText(), 'כיבוי הסנכרון');
  Object.assign(mc, { mapped: 12, synced: 11, failed: 1, lastAt: new Date(NOW.getTime() - 4 * 60e3).toISOString(), lastError: 'denied' });
  await p.click('#btn-refresh');
  await p.waitForFunction(() => /12 לקוחות מחוברים למותג/.test(document.getElementById('mc-summary')?.textContent || ''));
  assert.match(await p.locator('#mc-summary').innerText(), /12 לקוחות מחוברים למותג · 11 סונכרנו · 1 נכשלו · הסנכרון האחרון לפני \d דקות/);
  assert.match(await p.locator('#mc-state').innerText(), /Metricool פועל: 12 לקוחות מחוברים, 1 נכשלו בסנכרון האחרון/);
  // Never a secret's value, and no second pink button on the page because of this card.
  assert.doesNotMatch(await p.locator('#mc-panel').innerText(), /TOKEN|\bnull\b|undefined/);
  assert.equal(await p.locator('#mc-panel .btn-primary').count(), 0);
  if (OUT2) {
    await p.locator('#mc-panel').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${OUT2}/metricool-card-desktop.png`, fullPage: true });
    await p.setViewportSize({ width: 375, height: 780 });
    await p.waitForTimeout(200);
    await p.locator('#mc-panel').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${OUT2}/metricool-card-phone.png`, fullPage: true });
  }
  await p.setViewportSize({ width: 360, height: 740 });
  assert.ok(await noHScroll(p), 'the card on a phone');
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#mc-panel .btn')].filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent)), []);
  await p.click('#mc-toggle');
  await toastHas(p, 'כובה');
  assert.equal(mc.enabled, false);
  await ctx.close();
});

await step('Irit on the team screen sees the same lines, but no switch', async () => {
  const { ctx, page: p } = await open('irit', 'team.html', { push: ON });
  await p.waitForSelector('#wa-panel');
  assert.equal(await p.locator('#wa-toggle').count(), 0);
  assert.equal(await p.locator('#mc-panel').count(), 0, 'the Metricool card is the owner\'s');
  assert.match(await p.locator('#row-ilai').innerText(), /✗ WhatsApp: לא מחובר\/ת · יש מספר/);
  await p.setViewportSize({ width: 360, height: 740 });
  assert.ok(await noHScroll(p), 'the team screen on a phone');
  await ctx.close();
});

// ── The provider is Jako (docs/ops.md, section 63) ──
await step('the team screen with Jako: says so, counts only "נשלחו" (nothing of delivered or read), and the missing secret is Jako\'s key', async () => {
  const { ctx, page: p } = await open('owner', 'team.html', { push: ON });
  await p.waitForSelector('#wa-panel');
  // With Meta, as it always was: no provider line, delivered and read.
  assert.equal(await p.locator('#wa-provider').count(), 0);
  assert.equal(await p.locator('#wa-note').innerText(), 'נמסר ונקרא מוצגים לתכנון העבודה בלבד, לא להערכה ולא למשמעת.');
  assert.match(await p.locator('#row-irit').innerText(), /השבוע: 5 נמסרו, 3 נקראו, 1 נכשלו/);
  wa.provider = 'jako';
  await p.click('#btn-refresh');
  await p.waitForSelector('#wa-provider');
  assert.equal(await p.locator('#wa-provider').innerText(), 'ההודעות יוצאות דרך Jako.');
  assert.match(await p.locator('#wa-state').innerText(), /^פועל\. /);
  assert.match(await p.locator('#row-irit').innerText(), /WhatsApp: מחובר\/ת · יש מספר · השבוע: 6 נשלחו, 1 נכשלו/);
  assert.match(await p.locator('#row-lior').innerText(), /WhatsApp: לא מחובר\/ת · אין מספר$/m);
  assert.equal(await p.locator('#wa-note').innerText(), 'דרך Jako ידוע רק שהודעה נשלחה, לא אם נמסרה או נקראה. המספרים לתכנון העבודה בלבד, לא להערכה ולא למשמעת.');
  // No line claims a message was delivered or read.
  const lines = await p.locator('.tm-wa-status').allInnerTexts();
  assert.equal(lines.length, 4);
  assert.ok(lines.every((l) => !/נמסרו|נקראו/.test(l)), JSON.stringify(lines));
  assert.equal(await p.locator('#wa-missing').count(), 0);
  // (Opened again for the picture: the page clock stands still, so the sign-in screen's exit never ends.)
  if (OUT) { await p.reload(); await p.waitForSelector('#wa-provider'); await p.locator('#wa-panel').screenshot({ path: `${OUT}/wa-06-team-jako.png` }); }
  // Off, and Jako's key gone from Vault: named, none of Meta's secrets asked for, and no switching on.
  await p.click('#wa-toggle');
  await toastHas(p, 'כובו');
  wa.jakoSecrets.jako_api_key = false;
  await p.click('#btn-refresh');
  await p.waitForSelector('#wa-missing');
  assert.equal(await p.locator('#wa-missing').innerText(), 'חסר ב־Vault: whatsapp_jako_api_key. ההוראות במסמך התפעול.');
  assert.equal(await p.locator('#wa-toggle').isDisabled(), true);
  assert.equal(await p.locator('#wa-provider').innerText(), 'ההודעות יוצאות דרך Jako.');
  await p.setViewportSize({ width: 360, height: 740 });
  assert.ok(await noHScroll(p), 'the panel on a phone');
  if (OUT) await p.locator('#wa-panel').screenshot({ path: `${OUT}/wa-07-team-jako-phone.png` });
  await p.setViewportSize({ width: 1280, height: 900 });
  wa.jakoSecrets.jako_api_key = true;
  // The secret of the reply buttons' calls, and the flow of a button, are asked for the same way.
  wa.jakoSecrets.jako_hook_secret = false;
  wa.jakoFlows.onit = false;
  await p.click('#btn-refresh');
  await p.waitForSelector('#wa-flows');
  assert.equal(await p.locator('#wa-missing').innerText(), 'חסר ב־Vault: whatsapp_jako_hook_secret. ההוראות במסמך התפעול.');
  assert.equal(await p.locator('#wa-flows').innerText(), 'חסרה ההגדרה של הזרימה ב־Jako לכפתור ״אני על זה״. ההוראות במסמך התפעול, סעיף 63.');
  assert.equal(await p.locator('#wa-toggle').isDisabled(), true);
  wa.jakoSecrets.jako_hook_secret = true;
  await p.click('#btn-refresh');
  await p.waitForFunction(() => !document.getElementById('wa-missing'));
  assert.equal(await p.locator('#wa-toggle').isDisabled(), true, 'a flow is still missing');
  wa.jakoFlows.onit = true;
  await p.click('#btn-refresh');
  await p.waitForSelector('#wa-toggle:not([disabled])');
  assert.equal(await p.locator('#wa-flows').count(), 0);
  await p.click('#wa-toggle');
  await toastHas(p, 'הופעלו');
  assert.deepEqual(lastCall('whatsapp_set_enabled').body, { p_on: true });
  assert.equal(wa.enabled, true);
  await ctx.close();
  // Irit sees the same wording, and no switch.
  const irit = await open('irit', 'team.html', { push: ON });
  await irit.page.waitForSelector('#wa-provider');
  assert.equal(await irit.page.locator('#wa-toggle').count(), 0);
  assert.match(await irit.page.locator('#row-irit').innerText(), /השבוע: 6 נשלחו, 1 נכשלו/);
  await irit.ctx.close();
  wa.provider = 'meta';
});

await step('while WhatsApp is off nobody is asked and "המשימות שלי" shows nothing about it', async () => {
  wa.enabled = false;
  const { ctx, page: p } = await open('ilai');
  await p.waitForSelector('#view-mine:not([hidden])');
  await p.waitForTimeout(400);
  assert.equal(await p.locator('#dlg-wa[open]').count(), 0);
  assert.equal(await p.locator('#wa-card').isHidden(), true);
  await ctx.close();
  wa.enabled = true;
});

await step('a 360px phone: the screen fits, the two lines stack with full-width 44px buttons; the privacy page reads well', async () => {
  const { ctx, page: p } = await open('ilai', 'clients.html#mine', { viewport: { width: 360, height: 740 } });
  await p.waitForSelector('#dlg-wa[open]');
  assert.ok(await noHScroll(p));
  const boxes = await p.locator('#dlg-wa .wa-act').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) })));
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].w, boxes[1].w);
  assert.ok(boxes.every((b) => b.h >= 44), JSON.stringify(boxes));
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
noCspViolations();
assert.deepEqual(errors, [], `page errors: ${JSON.stringify(errors)}`);
console.log(`\n${passed} passed`);
