// End-to-end check of notifications on the phone (clients.html, app/push.js, sw.js):
// the "הפעלת התראות" card (connect, test notification, "קיבלתי", on), the iPhone
// path (iOS 16.4+, install to the home screen first, then a button), blocked and
// unsupported browsers, today's "התראות" list (unread count, mark read, "לדחות"),
// "התחלתי" on an urgent task, a 360px phone, and the page without the push tables
// (hidden). Against an in-memory fake of Supabase and a fake PushManager; the page
// clock is Monday 5.10.2026 10:00 in Jerusalem.
// Run: npx http-server -p 8080 -s . &  then  node tests/push-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { VAPID_PUBLIC_KEY } from '../app/push-config.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-10-05T07:00:00Z'); // Monday 10:00 in Jerusalem
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();
const minsAgo = (n) => new Date(NOW - n * 6e4).toISOString();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const users = {
  irit: { id: randomUUID(), email: 'irit@astrateg.test', person: 'irit' },
  ilai: { id: randomUUID(), email: 'ilai@astrateg.test', person: 'ilai' },
};
const jwtOf = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: Math.floor(NOW / 1000) + 7 * 86400 })}.sig`;
const userOf = (headers) => Object.values(users).find((u) => (headers.authorization || '').includes(jwtOf(u))) || null;

const cafe = {
  id: randomUUID(), name: 'קפה גליה', business: null, phone: null, package_name: null, shoot_type: 'dms', characterizer: 'ofir', has_logo: true, editor_name: null,
  deal_at: '2026-09-01T07:00:00Z', char_at: null, shoot_at: null, contract_end: '2027-10-01', status: 'active', notes: null, quote_id: null,
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: {}, rounds: [], verified_at: null, verified_by: null, closed_reason: null, address: null, editor: null, created_at: '2026-09-01T07:00:00Z',
};
const db = {
  staff: Object.values(users).map((u) => ({ email: u.email, person: u.person })),
  quotes: [], clients: [cafe], protocol_checks: [], protocol_log: [], office_reviews: [], client_status_notes: [],
  client_tasks: [{
    id: randomUUID(), client_id: cafe.id, title: 'לתקן את הלוגו בעמוד', owner: 'ilai', due_on: null, done_at: null, done_by_email: null,
    created_by_email: 'lior@astrateg.test', created_at: minsAgo(12), source: null, brief: null, urgent: true, started_at: null,
  }],
  push_subscriptions: [],
  reminder_log: [
    { id: 11, person: 'irit', key: 'answer:x@irit', rule: 'answer', level: 'ring', channel: 'push', status: 'sent', reason: null, title: 'הלקוח לא ענה: קפה גליה', body: '9 הגרפיקות הראשונות. עברו 10 דקות בלי תשובה: להתקשר.', url: `client.html?id=${cafe.id}#p07`, ref: 'p07', client_id: cafe.id, created_at: minsAgo(5), sent_at: minsAgo(5), read_at: null },
    { id: 12, person: 'irit', key: 'dailyMessages:-:x:1400@irit', rule: 'dailyMessages', level: 'quiet', channel: 'app', status: 'sent', reason: null, title: 'עוד לא קיבלו הודעה היום: 3 לקוחות', body: 'א, ב, ג', url: 'messages.html', ref: null, client_id: null, created_at: minsAgo(30), sent_at: minsAgo(30), read_at: null },
    { id: 13, person: 'irit', key: 'digest:morning:irit:2026-10-05', rule: 'digest', level: 'digest', channel: 'push', status: 'sent', reason: 'morning', title: 'תקציר בוקר', body: 'באיחור: קפה גליה · 7\nהיום: 2', url: 'clients.html#mine', ref: null, client_id: null, created_at: minsAgo(90), sent_at: minsAgo(90), read_at: minsAgo(80) },
    { id: 14, person: 'irit', key: 'late:y@irit', rule: 'late', level: 'ring', channel: 'push', status: 'suppressed', reason: 'stale', title: 'לא אמור להופיע', body: '', url: null, ref: null, client_id: null, created_at: minsAgo(20), sent_at: null, read_at: null },
    { id: 15, person: 'irit', key: 'task:z@irit', rule: 'task', level: 'quiet', channel: 'app', status: 'sent', reason: null, title: 'מאתמול', body: '', url: null, ref: null, client_id: null, created_at: '2026-10-04T15:00:00Z', sent_at: null, read_at: null },
    { id: 16, person: 'ilai', key: 'urgent:t@ilai', rule: 'urgent', level: 'ring', channel: 'push', status: 'sent', reason: null, title: 'משימה דחופה: קפה גליה', body: 'לתקן את הלוגו בעמוד. ללחוץ "התחלתי".', url: `client.html?id=${cafe.id}#tasks`, ref: null, client_id: cafe.id, created_at: minsAgo(12), sent_at: minsAgo(12), read_at: null },
  ],
};
const calls = [];
let pushTables = true;

// ── Fake PostgREST, RPCs and the reminders function ──
const unq = (s) => s.replace(/^"(.*)"$/, '$1');
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith('neq.')) out = out.filter((r) => String(r[k]) !== v.slice(4));
    else if (v.startsWith('gte.')) out = out.filter((r) => String(r[k]) >= v.slice(4));
    else if (v.startsWith('in.(')) { const set = new Set(v.slice(4, -1).split(',').map(unq)); out = out.filter((r) => set.has(String(r[k]))); }
    else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
  }
  return out;
}
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
    return json(200, { access_token: jwtOf(u), token_type: 'bearer', expires_in: 7 * 86400, expires_at: Math.floor(NOW / 1000) + 7 * 86400, refresh_token: 'r', user: { ...u, aud: 'authenticated', role: 'authenticated' } });
  }
  const me = userOf(headers);
  if (p === '/auth/v1/user') return me ? json(200, { ...me, aud: 'authenticated' }) : json(401, {});
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me);
  if (!me) return json(401, { message: 'permission denied' });
  const person = db.staff.find((s) => s.email === me.email)?.person ?? 'owner';
  if (p.startsWith('/rest/v1/rpc/') || p.startsWith('/functions/v1/')) calls.push({ path: p, by: me.email, body });
  if (p === '/rest/v1/rpc/push_subscribe') {
    db.push_subscriptions = db.push_subscriptions.filter((s) => s.endpoint !== body.p_endpoint);
    db.push_subscriptions.push({ id: randomUUID(), email: me.email, endpoint: body.p_endpoint, p256dh: body.p_p256dh, auth: body.p_auth, confirmed_at: null, last_ok_at: null, created_at: serverNow() });
    return json(200, db.push_subscriptions.at(-1).id);
  }
  if (p === '/rest/v1/rpc/push_confirm') {
    const s = db.push_subscriptions.find((x) => x.endpoint === body.p_endpoint && x.email === me.email);
    if (s) s.confirmed_at = serverNow();
    return json(200, !!s);
  }
  if (p === '/rest/v1/rpc/push_unsubscribe') {
    const before = db.push_subscriptions.length;
    db.push_subscriptions = db.push_subscriptions.filter((x) => !(x.endpoint === body.p_endpoint && x.email === me.email));
    return json(200, before !== db.push_subscriptions.length);
  }
  if (p === '/rest/v1/rpc/reminders_mark_read') {
    let n = 0;
    for (const r of db.reminder_log) if (r.person === person && !r.read_at && (!body.p_ids || body.p_ids.includes(r.id))) { r.read_at = serverNow(); n += 1; }
    return json(200, n);
  }
  if (p === '/functions/v1/reminders') {
    if (body.action !== 'test') return json(400, { error: 'bad_request' });
    const mine = db.push_subscriptions.filter((s) => s.email === me.email && (!body.endpoint || s.endpoint === body.endpoint));
    return mine.length ? json(200, { ok: true, devices: mine.length }) : json(404, { error: 'no_device' });
  }
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]] || (!pushTables && ['push_subscriptions', 'reminder_log'].includes(m[1]))) return json(404, { message: 'not found' });
  const table = m[1];
  // Row level security as in the migration: your own devices and reminders only.
  let rows = db[table];
  if (table === 'push_subscriptions') rows = rows.filter((r) => r.email === me.email);
  if (table === 'reminder_log') rows = rows.filter((r) => r.person === person);
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (list) => (single ? (list.length ? json(200, list[0]) : json(406, { message: 'no rows' })) : json(200, list));
  // Before migration 20260930110001 there is no started_at column.
  if (req.method() === 'GET' && table === 'client_tasks' && !pushTables && (url.searchParams.get('select') || '').includes('started_at')) {
    return json(400, { code: '42703', message: 'column client_tasks.started_at does not exist' });
  }
  if (req.method() === 'GET' && table === 'client_tasks' && !(url.searchParams.get('select') || '').includes('started_at')) {
    return reply(applyFilters(rows, url.searchParams).map(({ started_at: _, ...t }) => t));
  }
  if (req.method() === 'GET') return reply(applyFilters(rows, url.searchParams));
  if (req.method() === 'POST' && table === 'protocol_checks') {
    const out = [];
    for (const r of [body].flat()) {
      const row = { ...r, by_email: me.email, at: serverNow() };
      db.protocol_checks = db.protocol_checks.filter((x) => !(x.client_id === r.client_id && x.item_key === r.item_key));
      db.protocol_checks.push(row);
      calls.push({ path: 'protocol_checks', body: row });
      out.push(row);
    }
    return reply(out);
  }
  if (req.method() === 'PATCH' && table === 'client_tasks') {
    const hit = applyFilters(db.client_tasks, url.searchParams);
    for (const t of hit) {
      // The database stamps the first start (migration 20260930110001).
      if (body.started_at !== undefined) t.started_at = body.started_at ? t.started_at || serverNow() : null;
    }
    calls.push({ path: 'client_tasks', body });
    return reply(hit);
  }
  return json(405, { message: `unexpected ${req.method()} ${table}` });
}

// A fake Notification and PushManager: permission and the subscription live in this page's storage.
const fakePush = ({ key, permission = 'default', ua = null, standalone = false }) => {
  const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4)), (c) => c.charCodeAt(0));
  window.__asked = 0;
  window.__subscribed = [];
  if (ua) Object.defineProperty(navigator, 'userAgent', { get: () => ua });
  if (standalone) Object.defineProperty(navigator, 'standalone', { get: () => true });
  const perm = () => { try { return localStorage.getItem('fake.perm') || permission; } catch { return permission; } };
  class FakeNotification {
    constructor() {}
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
  PushManager.prototype.subscribe = async function subscribe(opts) {
    window.__subscribed.push({ userVisibleOnly: opts.userVisibleOnly, key: Array.from(new Uint8Array(opts.applicationServerKey)).join(',') === Array.from(bytes).join(','), scope: this === undefined ? null : 'ok' });
    localStorage.setItem('fake.sub', '1');
    return make();
  };
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function open(who, { viewport = { width: 1280, height: 900 }, push = {}, mobile = false } = {}) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: mobile, hasTouch: mobile });
  await ctx.clock.install({ time: NOW });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', fakeSupabase);
  await ctx.addInitScript(fakePush, { key: VAPID_PUBLIC_KEY, ...push });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}clients.html`);
  await page.fill('#lg-email', users[who].email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#view-mine:not([hidden])');
  return { ctx, page };
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const toastHas = (page, t) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), t);
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) { console.error(`not ok - ${name}\n  errors: ${JSON.stringify(errors)}\n  calls: ${JSON.stringify(calls.slice(-4))}`); throw err; }
  passed += 1;
  console.log(`ok - ${name}`);
}

// ── Irit on her computer: connect, test, confirm ──
const { ctx: iritCtx, page } = await open('irit');
await step('the card offers "הפעלת התראות"; permission is asked only from the button', async () => {
  await page.waitForSelector('#push-card:not([hidden])');
  assert.equal(await page.locator('#push-card').getAttribute('data-state'), 'ready');
  assert.match(await page.locator('#push-card').innerText(), /הפעלת התראות[\s\S]*גם כשהמערכת סגורה[\s\S]*08:30/);
  assert.equal(await page.evaluate(() => window.__asked), 0);
  // Right under the "now" bar in "my work".
  const ids = await page.locator('#view-mine > *').evaluateAll((els) => els.map((e) => e.id));
  assert.deepEqual(ids.slice(0, 2), ['now-bar', 'push-card']);
  await shot(page, '01-card');
});

await step('connecting: the browser subscribes with the office key, the device is saved, a test notification goes to it', async () => {
  await page.click('#push-card button:has-text("הפעלת התראות")');
  await page.waitForSelector('#push-card[data-state="confirm"]');
  assert.equal(await page.evaluate(() => window.__asked), 1);
  assert.deepEqual(await page.evaluate(() => window.__subscribed.map((s) => [s.userVisibleOnly, s.key])), [[true, true]]);
  const sub = calls.find((c) => c.path === '/rest/v1/rpc/push_subscribe');
  assert.equal(sub.body.p_endpoint, 'https://push.test/device-1');
  assert.equal(sub.body.p_p256dh.length, 87);
  assert.equal(sub.body.p_auth.length, 22);
  const t = calls.find((c) => c.path === '/functions/v1/reminders');
  assert.deepEqual(t.body, { action: 'test', endpoint: 'https://push.test/device-1' });
  assert.match(await page.locator('#push-card').innerText(), /הגיעה התראת ניסיון\?[\s\S]*קיבלתי[\s\S]*לא הגיעה, לשלוח שוב/);
  // The site's one service worker, at the root (it also serves the "now" bar).
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope);
  assert.equal(scope, BASE);
  await shot(page, '02-confirm');
});

await step('"לא הגיעה" sends again with tips; "קיבלתי" confirms and the card folds to one line', async () => {
  await page.click('#push-card button:has-text("לא הגיעה")');
  await page.waitForSelector('#push-card .push-hint');
  assert.match(await page.locator('#push-card .push-hint').innerText(), /נא לא להפריע/);
  assert.equal(calls.filter((c) => c.path === '/functions/v1/reminders').length, 2);
  await page.click('#push-card button:has-text("קיבלתי")');
  await page.waitForSelector('#push-card[data-state="on"]');
  await toastHas(page, 'ההתראות פעילות בטלפון הזה');
  assert.ok(calls.some((c) => c.path === '/rest/v1/rpc/push_confirm' && c.body.p_endpoint === 'https://push.test/device-1'));
  assert.match(await page.locator('#push-card').innerText(), /ההתראות פעילות בטלפון הזה\.[\s\S]*שליחת ניסיון[\s\S]*כיבוי/);
  // With push on, the stage-1 in-page alert switch is not offered again.
  assert.equal(await page.locator('.notify-row').count(), 0);
  await page.reload();
  await page.waitForSelector('#push-card[data-state="on"]');
});

await step('"התראות": today\'s reminders, newest first, with how each arrived; unread count; mark read', async () => {
  await page.waitForSelector('#btn-inbox:not([hidden])');
  assert.equal(await page.locator('#btn-inbox').getAttribute('aria-label'), 'התראות, 2 חדשות');
  assert.equal(await page.locator('#btn-inbox .n').innerText(), '2');
  await page.click('#btn-inbox');
  await page.waitForSelector('#dlg-inbox[open] .inbox-row');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'inbox-h');
  const titles = await page.locator('#inbox-list .inbox-title').allInnerTexts();
  assert.deepEqual(titles, ['הלקוח לא ענה: קפה גליה', 'עוד לא קיבלו הודעה היום: 3 לקוחות', 'תקציר בוקר']); // no stale step, nothing from yesterday
  assert.match(await page.locator('#inbox-list .inbox-row').nth(0).innerText(), /חדש[\s\S]*נשלח לטלפון[\s\S]*פתיחה/);
  assert.match(await page.locator('#inbox-list .inbox-row').nth(1).innerText(), /בתוך המערכת, בלי צליל/);
  assert.match(await page.locator('#inbox-list .inbox-row').nth(2).innerText(), /תקציר, נשלח לטלפון/);
  assert.equal(await page.locator('#inbox-list .inbox-row').nth(0).locator('a').getAttribute('href'), `${BASE}client.html?id=${cafe.id}#p07`);
  await shot(page, '03-inbox');
  await page.locator('#inbox-list .inbox-row').nth(1).locator('button:has-text("סימון כנקרא")').click();
  await page.waitForFunction(() => document.querySelector('#btn-inbox .n')?.textContent === '1');
  assert.deepEqual(calls.filter((c) => c.path === '/rest/v1/rpc/reminders_mark_read').at(-1).body, { p_ids: [12] });
  await page.click('#inbox-read');
  await toastHas(page, 'כל ההתראות סומנו כנקראו');
  assert.deepEqual(calls.filter((c) => c.path === '/rest/v1/rpc/reminders_mark_read').at(-1).body, { p_ids: null });
  assert.equal(await page.locator('#btn-inbox .n').count(), 0);
  assert.equal(await page.locator('#btn-inbox').getAttribute('aria-label'), 'התראות');
});

await step('"לדחות…": the reminder comes back later (a snooze mark on the process)', async () => {
  const sel = page.locator('#inbox-list .inbox-row').nth(0).locator('select');
  await sel.selectOption('hour');
  await toastHas(page, 'נדחה עד');
  const mark = calls.filter((c) => c.path === 'protocol_checks').at(-1).body;
  assert.equal(mark.item_key, 'p07.snooze');
  assert.equal(mark.client_id, cafe.id);
  assert.equal(new Date(mark.note).getTime() - NOW.getTime() > 55 * 6e4, true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('dlg-inbox').open);
});

await step('switching off removes this device only', async () => {
  await page.click('#push-card button:has-text("כיבוי")');
  await page.waitForSelector('#push-card[data-state="ready"]');
  assert.ok(calls.some((c) => c.path === '/rest/v1/rpc/push_unsubscribe'));
  assert.equal(db.push_subscriptions.length, 0);
});
await iritCtx.close();

// ── iPhone ────────────────────────────────
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
await step('iPhone in Safari: "הוספה למסך הבית" first, and no permission request', async () => {
  const { ctx, page: ph } = await open('irit', { viewport: { width: 360, height: 780 }, mobile: true, push: { ua: IPHONE } });
  await ph.waitForSelector('#push-card[data-state="ios-install"]');
  const text = await ph.locator('#push-card').innerText();
  assert.match(text, /הפעלת התראות באייפון[\s\S]*כפתור השיתוף[\s\S]*הוספה למסך הבית[\s\S]*אסטרטג לקוחות/);
  assert.equal(await ph.locator('#push-card button').count(), 0);
  assert.equal(await ph.evaluate(() => window.__asked), 0);
  assert.ok(await noHScroll(ph), 'no sideways scroll at 360px');
  await shot(ph, '04-iphone-install');
  await ctx.close();
});
await step('iPhone from the home screen: the button; an old iOS: update first', async () => {
  const { ctx, page: ph } = await open('irit', { viewport: { width: 360, height: 780 }, mobile: true, push: { ua: IPHONE, standalone: true } });
  await ph.waitForSelector('#push-card[data-state="ready"]');
  const box = await ph.locator('#push-card button').boundingBox();
  assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= 360, JSON.stringify(box));
  await shot(ph, '05-iphone-installed');
  await ctx.close();
  const old = await open('irit', { viewport: { width: 360, height: 780 }, mobile: true, push: { ua: IPHONE.replace(/17_4/g, '16_3').replace('17.4', '16.3') } });
  await old.page.waitForSelector('#push-card[data-state="ios-update"]');
  assert.match(await old.page.locator('#push-card').innerText(), /iOS 16\.4 ומעלה/);
  await old.ctx.close();
});
await step('blocked in the browser: how to allow it, no button', async () => {
  const { ctx, page: pb } = await open('irit', { push: { permission: 'denied' } });
  await pb.waitForSelector('#push-card[data-state="blocked"]');
  assert.match(await pb.locator('#push-card').innerText(), /ההתראות חסומות[\s\S]*לאפשר/);
  assert.equal(await pb.locator('#push-card button').count(), 0);
  await ctx.close();
});

// ── Ilai: an urgent task and "התחלתי" ──
await step('an urgent task: "התחלתי" is stamped by the database and shown', async () => {
  const { ctx, page: pi } = await open('ilai', { viewport: { width: 360, height: 780 }, mobile: true });
  await pi.waitForSelector('.wproc.is-urgent .task-start button');
  assert.match(await pi.locator('.wproc.is-urgent .task-start').innerText(), /התחלתי[\s\S]*תוך 30 דקות עבודה, המשימה עוברת לליאור/);
  const box = await pi.locator('.wproc.is-urgent .task-start button').boundingBox();
  assert.ok(box.height >= 44, JSON.stringify(box));
  await pi.click('.wproc.is-urgent .task-start button');
  await toastHas(pi, 'נרשם שהתחלת');
  await pi.waitForSelector('.wproc.is-urgent .task-start:not(:has(button))');
  assert.match(await pi.locator('.wproc.is-urgent .task-start').innerText(), /^התחלת /);
  assert.ok(db.client_tasks[0].started_at);
  // His notifications list shows his own reminder only.
  await pi.click('#btn-inbox');
  await pi.waitForSelector('#dlg-inbox[open] .inbox-row');
  assert.deepEqual(await pi.locator('#inbox-list .inbox-title').allInnerTexts(), ['משימה דחופה: קפה גליה']);
  assert.ok(await noHScroll(pi));
  await shot(pi, '06-urgent-started');
  await ctx.close();
});

// ── Before the migration: nothing shows ──
await step('before the migrations: no card, no button, and tasks still load (without "התחלתי")', async () => {
  pushTables = false;
  db.client_tasks[0].started_at = null;
  const { ctx, page: pn } = await open('ilai');
  await pn.waitForSelector('#mine-list .wproc.is-urgent');
  await pn.waitForTimeout(300);
  assert.equal(await pn.isHidden('#push-card'), true);
  assert.equal(await pn.isHidden('#btn-inbox'), true);
  assert.match(await pn.locator('.wproc.is-urgent').innerText(), /לתקן את הלוגו בעמוד/);
  assert.equal(await pn.locator('.wproc.is-urgent .task-start').count(), 0);
  await ctx.close();
  pushTables = true;
});

assert.deepEqual(errors, []);
await browser.close();
console.log(`push-e2e: ${passed} passed`);
