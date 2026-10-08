// End-to-end check of the office views on clients.html (batch 2): bulk marking,
// waiting on the client, morning summary, notifications, daily reviews,
// performance and auto-opened clients, against an in-memory fake of Supabase.
// The page clock is fixed to Tuesday 22.9.2026 10:00 (Jerusalem), the day after Yom Kippur.
// Run: npx http-server -p 8080 . &  then  node tests/protocol-office-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applicableProcesses } from '../app/protocol-logic.js';
import { PROCESSES } from '../app/protocol.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-09-22T07:00:00Z'); // 10:00 in Jerusalem
let skew = NOW.getTime() - Date.now();        // server time follows the page clock
const serverNow = () => new Date(Date.now() + skew).toISOString();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const USER = { id: randomUUID(), email: 'irit@astrateg.test', aud: 'authenticated', role: 'authenticated' };
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', exp: Math.floor(NOW / 1000) + 30 * 86400 })}.sig`; // valid through the Thursday check

const hoursAgo = (n) => new Date(NOW - n * 36e5).toISOString();
const minsAgo = (n) => new Date(NOW - n * 6e4).toISOString();
const at = (iso, plusMin = 0) => new Date(new Date(iso).getTime() + plusMin * 6e4).toISOString();

const autoQuote = { id: randomUUID(), number: 'AST-2026-0014', client_name: 'סלון יופי אור', signed_at: minsAgo(3), status: 'signed' };
const db = {
  staff: [{ email: USER.email, person: 'irit' }, { email: 'ofir@astrateg.test', person: 'ofir' }, { email: 'lior@astrateg.test', person: 'lior' }],
  quotes: [autoQuote],
  clients: [],
  protocol_checks: [],
  protocol_log: [],
  client_tasks: [],
  office_reviews: [],
  client_status_notes: [],
};
let failNextCheck = false;

const base = {
  business: null, phone: null, package_name: null, shoot_type: null, characterizer: null, has_logo: null, editor_name: null,
  char_at: null, shoot_at: null, contract_end: '2027-09-20', status: 'active', notes: null, quote_id: null,
  created_by_email: USER.email, links: {}, deliverables: {}, rounds: [], verified_at: null, verified_by: null, closed_reason: null, address: null,
  editor: null,
};
const client = (o) => { const c = { ...base, id: randomUUID(), created_at: o.deal_at, ...o }; db.clients.push(c); return c; };
const check = (c, key, when, by = 'ofir@astrateg.test', state = 'done', note = null) => {
  db.protocol_checks.push({ client_id: c.id, item_key: key, state, note, by_email: by, at: when });
  db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: c.id, item_key: key, action: state, note, by_email: by, at: when });
};
const P1 = ['p01.prepared', 'p01.sent', 'p01.signed'];
const P2 = ['p02.opened', 'p02.m.lior', 'p02.m.irit', 'p02.m.ofir', 'p02.m.ilai', 'p02.m.client', 'p02.intro', 'p02.deal'];
const P3 = ['p03.who', 'p03.available', 'p03.scheduled', 'p03.calendar'];
const P4 = ['p04.address', 'p04.phone', 'p04.services', 'p04.audiences', 'p04.advantages', 'p04.goals', 'p04.offers', 'p04.content', 'p04.graphics', 'p04.campaigns', 'p04.special', 'p04.saved', 'p04.followup'];

// Mid-way client with a second shoot round.
const seeded = client({ name: 'מספרת רון', business: 'רון עיצוב שיער', phone: '052-7654321', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  deal_at: hoursAgo(80), char_at: hoursAgo(50), shoot_at: new Date(NOW.getTime() + 2 * 864e5).toISOString(),
  rounds: [{ n: 2, shoot_type: 'dms', shoot_at: null, start_at: hoursAgo(30) }] });
for (const k of [...P1, ...P2, ...P3, ...P4, 'p05.access', 'p05.vault', 'p05.logo', 'p05.colors', 'p05.photos', 'p05.videos']) check(seeded, k, hoursAgo(49));
// Just in, WhatsApp group opened already by Ofir: Irit's bulk button offers the other 6.
const fresh = client({ name: 'פיצה נאפולי', deal_at: hoursAgo(3) });
check(fresh, 'p02.opened', hoursAgo(1));
// Waiting on the client for access since last Wednesday; recheck is today.
const waiting = client({ name: 'קפה גליה', phone: '054-1112233', deal_at: hoursAgo(24 * 8), char_at: hoursAgo(24 * 7) });
for (const k of [...P1, ...P2, ...P3, ...P4]) check(waiting, k, hoursAgo(24 * 7 - 1));
check(waiting, 'p05.wait', hoursAgo(24 * 6), 'lior@astrateg.test', 'done', JSON.stringify({ reason: 'הלקוח עוד לא שלח גישה לאינסטגרם', recheck: '2026-09-22' }));
// Opened by the signing trigger three minutes ago.
const auto = client({ name: 'סלון יופי אור', deal_at: minsAgo(3), quote_id: autoQuote.id, created_by_email: 'system' });
for (const k of P1) check(auto, k, minsAgo(3), 'system', 'done', 'נחתם במערכת: AST-2026-0014');
// Agreement cancelled: never in my work or in the control lists.
const cancelled = client({ name: 'מאפיית כהן', deal_at: hoursAgo(5), status: 'cancelled', closed_reason: 'הלקוח חזר בו' });
db.client_tasks.push({ id: randomUUID(), client_id: cancelled.id, title: 'להחזיר מקדמה', owner: 'irit', due_on: '2026-09-20', done_at: null, done_by_email: null, created_by_email: USER.email, created_at: hoursAgo(50), source: null });
// Closed clients for the performance report: process 1 closed 7 times, process 2 three times.
const oldDeals = ['2026-09-10', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-20'];
oldDeals.forEach((d, i) => {
  const c = client({ name: `לקוח ותיק ${i + 1}`, deal_at: `${d}T07:00:00Z`, status: 'ended', contract_end: '2027-01-01' });
  for (const k of P1) check(c, k, at(c.deal_at, i < 4 ? 3 : 90));
  if (i < 3) for (const k of P2) check(c, k, at(c.deal_at, 4));
});
// Imported at go-live: campaigns built (process 30) three weeks ago, and a weekly call
// brought in with the import today. Imported history is not a call made this month.
const imported = client({ name: 'חנות מיובאת', deal_at: '2026-06-01T07:00:00Z', status: 'ended', contract_end: '2027-01-01' });
for (const k of ['p30.picked', 'p30.live']) check(imported, k, hoursAgo(24 * 21), USER.email, 'done', 'ייבוא');
check(imported, 'p31.call', hoursAgo(2), USER.email, 'done', 'ייבוא');
// Earlier daily reviews: Irit on Sunday 20.9 and Thursday 17.9, Ofir on Sunday.
db.office_reviews.push(
  { day: '2026-09-20', kind: 'p32', note: null, by_email: USER.email, at: '2026-09-20T06:12:00Z' },
  { day: '2026-09-17', kind: 'p32', note: null, by_email: USER.email, at: '2026-09-17T06:40:00Z' },
  { day: '2026-09-20', kind: 'p33', note: null, by_email: 'ofir@astrateg.test', at: '2026-09-20T07:05:00Z' },
);

// ── Fake PostgREST ─────────────────────────
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
    else if (v === 'not.is.null') out = out.filter((r) => r[k] !== null && r[k] !== undefined);
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
    if (body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: JWT, token_type: 'bearer', expires_in: 30 * 86400, expires_at: Math.floor(NOW / 1000) + 30 * 86400, refresh_token: 'r', user: USER });
  }
  if (p === '/auth/v1/user') return json(200, USER);
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  const authed = (headers.authorization || '').includes(JWT);
  if (p === '/rest/v1/rpc/is_staff') return json(200, authed);
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { message: 'not found' });
  if (!authed) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  const now = serverNow();

  if (req.method() === 'GET') {
    const rows = applyFilters(db[table], url.searchParams);
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    return reply(rows.slice(off, off + lim));
  }
  if (req.method() === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    if (table === 'protocol_checks' && failNextCheck) { failNextCheck = false; return json(500, { message: 'Failed to fetch' }); }
    const out = [];
    for (const r of rows) {
      if (table === 'protocol_checks') {
        const row = { ...r, by_email: USER.email, at: now };
        const i = db.protocol_checks.findIndex((x) => x.client_id === r.client_id && x.item_key === r.item_key);
        if (i >= 0) db.protocol_checks[i] = row; else db.protocol_checks.push(row);
        db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: r.state, note: r.note, by_email: USER.email, at: now });
        out.push(row);
      } else if (table === 'client_status_notes') {
        const row = { current: null, missing: null, next: null, owner: null, due_on: null, ...r, by_email: USER.email, at: now };
        const i = db.client_status_notes.findIndex((x) => x.client_id === r.client_id && x.week === r.week);
        if (i >= 0) db.client_status_notes[i] = row; else db.client_status_notes.push(row);
        out.push(row);
      } else if (table === 'office_reviews') {
        const row = { note: null, ...r, by_email: USER.email, at: now };
        const i = db.office_reviews.findIndex((x) => x.day === r.day && x.kind === r.kind);
        if (i >= 0) db.office_reviews[i] = row; else db.office_reviews.push(row);
        out.push(row);
      } else {
        const row = { ...(table === 'client_tasks' ? { done_at: null, source: null, brief: null, urgent: false, due_on: null } : {}), ...r, id: randomUUID(), created_at: now, created_by_email: USER.email };
        db[table].push(row);
        out.push(row);
      }
    }
    return reply(out);
  }
  if (req.method() === 'PATCH') {
    const rows = applyFilters(db[table], url.searchParams);
    for (const r of rows) Object.assign(r, body);
    return reply(rows);
  }
  if (req.method() === 'DELETE') {
    if (table === 'office_reviews') return json(403, { message: 'permission denied for table office_reviews' });
    const rows = applyFilters(db[table], url.searchParams);
    db[table] = db[table].filter((r) => !rows.includes(r));
    if (table === 'protocol_checks') for (const r of rows) db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: 'clear', note: null, by_email: USER.email, at: now });
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  return json(405, {});
}

// A fake Notification API that remembers what was shown and whether permission was asked.
const fakeNotifications = () => {
  window.__notes = [];
  window.__asked = 0;
  class FakeNotification {
    constructor(title, opts = {}) { window.__notes.push({ title, body: opts.body }); }
    static get permission() { return localStorage.getItem('fake.perm') || 'default'; }
    static async requestPermission() { window.__asked += 1; localStorage.setItem('fake.perm', 'granted'); return 'granted'; }
    close() {}
  }
  window.Notification = FakeNotification;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 1280, height: 900 } });
// These checks walk the whole list of "המשימות שלי" ("תצוגה מלאה"); the short one is tests/roles-phone-e2e.mjs.
await ctx.addInitScript(() => { try { localStorage.setItem('astrateg.mine.full', 'on'); } catch { /* no storage */ } });
await ctx.clock.install({ time: NOW });
await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>wa</p>' }));
await ctx.addInitScript(fakeNotifications);
const page = await ctx.newPage();
const errors = [];
const watch = (pg) => {
  pg.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(pg); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
};
watch(page);
const shot = async (name, pg = page) => { if (OUT) await pg.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const noHScroll = async (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const toastHas = (text) => page.waitForFunction((t) => document.querySelector('#toast.on')?.textContent.includes(t), text);
const waText = async (sel, pg = page) => new URL(await pg.getAttribute(sel, 'href')).searchParams.get('text');

// Login
await page.goto(`${BASE}clients.html`);
await page.fill('#lg-email', USER.email);
await page.fill('#lg-pass', 'correct-horse');
await page.click('#lg-submit');
await page.waitForSelector('#view-mine:not([hidden]) .witem');
assert.equal(await page.evaluate(() => window.__asked), 0, 'no permission request on load');

// ── §10 auto-opened client: banner, short tag; cancelled client is gone ──
const mine = await page.locator('#mine-list').innerText();
assert.match(await page.locator('.auto-banner[role="status"]').innerText(), /לקוח חדש נפתח אוטומטית: סלון יופי אור · הסכם\s*AST-2026-0014 · לפני 3 דק׳/);
assert.match(await page.locator('.wproc:has(.wclient:text("סלון יופי אור"))').first().innerText(), /חדש/);
assert.doesNotMatch(mine, /מאפיית כהן|להחזיר מקדמה/);

// ── §7 fixed review card in Irit's "today" group ──
assert.match(await page.locator('.g-today').innerText(), /בקרה יומית · תהליך 32 · בקרה על ביצוע המשימות/);

// ── Multi-round header and deep link ──
const r2 = page.locator('.wproc:has-text("סבב 2 · 11 · קביעת יום צילום")');
assert.equal(await r2.count(), 1);
assert.match(await r2.locator('.wclient').getAttribute('href'), /#r2-p11$/);

// ── §4 waiting group: last, recheck tag, not under "overdue" ──
const groups = await page.locator('#mine-list .wgroup').evaluateAll((els) => els.map((e) => e.className));
assert.match(groups.at(-1), /g-client/);
const waitGroup = await page.locator('.g-client').innerText();
assert.match(waitGroup, /קפה גליה/);
assert.match(waitGroup, /הגיע מועד הבדיקה/);
assert.match(waitGroup, /״הלקוח עוד לא שלח גישה לאינסטגרם״/);
assert.equal(await page.locator('.g-overdue .wproc:has-text("קפה גליה"):has-text("לקיחת גישות")').count(), 0);
await shot('01-my-work');

// ── §1 bulk: 6 of Irit's items in process 2 of the fresh client, then undo ──
const p2card = page.locator('.wproc:has(.wclient:text("פיצה נאפולי")):has-text("פתיחת קבוצת WhatsApp")');
assert.equal(await p2card.locator('.bulk-btn').innerText(), 'סימון כל הפריטים שלי כבוצעו (6)'); // p02.deal and p02.team are Lior's; Shirel removed in v3
assert.equal(await p2card.locator('.bulk-btn').getAttribute('aria-label'), 'סימון 6 פריטים כבוצעו בתהליך 2 · פתיחת קבוצת WhatsApp');
// A failed save marks nothing.
failNextCheck = true;
await p2card.locator('.bulk-btn').click();
await toastHas('אף פריט לא סומן');
assert.equal(db.protocol_checks.filter((c) => c.client_id === fresh.id).length, 1);
await p2card.locator('.bulk-btn').click();
await toastHas('סומנו 6 פריטים בתהליך 2 · פתיחת קבוצת WhatsApp.');
assert.equal(db.protocol_checks.filter((c) => c.client_id === fresh.id && c.item_key.startsWith('p02.')).length, 7);
assert.equal(await page.locator('.wproc:has(.wclient:text("פיצה נאפולי")):has-text("פתיחת קבוצת WhatsApp")').count(), 0);
await page.click('.toast-act');
await toastHas('הסימון של 6 הפריטים בוטל.');
// Undo removes only what the bulk action marked: Ofir's earlier check stays.
assert.deepEqual(db.protocol_checks.filter((c) => c.client_id === fresh.id).map((c) => c.item_key), ['p02.opened']);
await page.waitForSelector('.wproc:has(.wclient:text("פיצה נאפולי")) .bulk-btn');
// Process 3 has open items of Irit's, so it gets the button too.
assert.equal(await page.locator('.wproc:has(.wclient:text("פיצה נאפולי")):has-text("קביעת פגישת אפיון") .bulk-btn').innerText(), 'סימון כל הפריטים שלי כבוצעו (3)'); // p03.scheduled waits for the characterizer and date

// ── §4 mark "waiting on the client" from my work ──
const p3card = page.locator('.wproc:has(.wclient:text("פיצה נאפולי")):has-text("קביעת פגישת אפיון")');
await p3card.locator('.wproc-acts .btn-text:text("ממתין ללקוח")').click();
await page.waitForSelector('#dlg-wait[open]');
assert.match(await page.locator('#wait-ctx').innerText(), /פיצה נאפולי · תהליך 3 · קביעת פגישת אפיון/);
assert.equal(await page.inputValue('#wait-recheck'), '2026-09-23');
await page.click('#wait-submit');
assert.match(await page.locator('#wait-err').innerText(), /כתבו בקצרה למה ממתינים/);
await page.fill('#wait-reason', 'הלקוח לא עונה לטלפון');
await page.click('#wait-submit');
await toastHas('תהליך 3 סומן כממתין ללקוח.');
const w3 = db.protocol_checks.find((c) => c.client_id === fresh.id && c.item_key === 'p03.wait');
assert.deepEqual(JSON.parse(w3.note), { reason: 'הלקוח לא עונה לטלפון', recheck: '2026-09-23' });
assert.match(await page.locator('.g-client').innerText(), /פיצה נאפולי/);
await page.locator('.g-client .wproc:has(.wclient:text("פיצה נאפולי")) .btn-text:text("סיום המתנה")').click();
await toastHas('ההמתנה הסתיימה.'); // marked after process 3's deadline: it does not move it
assert.ok(!db.protocol_checks.some((c) => c.client_id === fresh.id && c.item_key === 'p03.wait'));
// The wait's office minutes are kept on the process (decision 3): the deadline moves on by them.
assert.ok(JSON.parse(db.protocol_checks.find((c) => c.client_id === fresh.id && c.item_key === 'p03.waited').note).min >= 0);

// ── §6a morning summary for Irit ──
const summary = await waText('#mine-tools .wa-link');
assert.ok(summary.startsWith('בוקר טוב עירית,\nהסיכום שלך ליום שלישי 22.9:\n\n'), summary);
const order = ['באיחור (', 'היום (', 'ממתין ללקוח, לבדוק היום (1):', 'משימות ('].map((t) => summary.indexOf(t));
assert.ok(order[0] >= 0 && order[1] > order[0] && order[2] > order[1], summary);
assert.match(summary, /- קפה גליה · 5 לקיחת גישות לרשתות · הלקוח עוד לא שלח גישה לאינסטגרם/);
assert.match(summary, /- פיצה נאפולי · 2 פתיחת קבוצת WhatsApp · באיחור /);
assert.doesNotMatch(summary, /קפה גליה · 5 לקיחת גישות לרשתות · באיחור/);
assert.doesNotMatch(summary, /מאפיית כהן|054|052/);
assert.ok(summary.endsWith(`הרשימה המלאה: ${BASE}clients.html#mine`), summary);
assert.equal(new URL(await page.getAttribute('#mine-tools .wa-link', 'href')).pathname, '/');
const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#mine-tools .wa-link')]);
await popup.close();
await toastHas('WhatsApp נפתח עם הסיכום. השליחה עצמה נעשית שם.');

// ── Clients tab: auto-opened first in every filter, waiting flag and filters ──
await page.click('#tab-clients');
await page.waitForSelector('.crow');
assert.match(await page.locator('.crow').first().innerText(), /סלון יופי אור[^]*חדש · נפתח אוטומטית מהסכם\s*AST-2026-0014[^]*נחתם היום 09:57/);
assert.match(await page.locator('.crow:has-text("קפה גליה") .cflags').innerText(), /ממתין ללקוח · 1/);
await page.click('#client-filters .chip:text("ממתין ללקוח")');
assert.deepEqual(await page.locator('.crow strong').allInnerTexts(), ['קפה גליה']);
await page.click('#client-filters .chip:text("עם איחור")');
const lateNames = await page.locator('.crow strong').allInnerTexts();
assert.ok(lateNames.includes('פיצה נאפולי') && !lateNames.includes('מאפיית כהן'), lateNames.join());
await page.click('#client-filters .chip:text("בוטלו")');
assert.deepEqual(await page.locator('.crow strong').allInnerTexts(), ['מאפיית כהן']);
await page.click('#client-filters .chip:text("פעילים")');
await shot('02-clients');

// ── Control: reviews, waiting split, contact links ──
await page.click('#tab-control');
await page.waitForSelector('.rv-panel');
const control = await page.locator('#control').innerText();
assert.match(control, /באיחור אצלנו/);
assert.match(control, /ממתין ללקוח · צריך ליצור קשר/);
assert.doesNotMatch(control, /מאפיית כהן/);
const wl = page.locator('.waiting-list > li:has-text("קפה גליה")');
assert.equal(await wl.locator('a[href^="tel:"]').getAttribute('href'), 'tel:0541112233');
assert.match(await wl.locator('a:text("WhatsApp")').getAttribute('href'), /^https:\/\/wa\.me\/972541112233/);
assert.match(await wl.innerText(), /ממתין יותר מיומיים/);
assert.match(await page.locator('.ctable thead').innerText(), /ממתין ללקוח/);
assert.match(await page.locator('.ctable tbody tr:has-text("עירית")').innerText(), /נפתח היום 10:0\d/);
// Seven business days, holidays skipped (21.9 Yom Kippur, 13.9 Rosh Hashana).
const p32 = page.locator('.rv-row').first();
const week = await p32.locator('.rv-week.rv-wide li').allInnerTexts();
assert.equal(week.length, 7);
assert.match(week[0], /ה׳ 10\.9/);
assert.ok(!week.some((d) => /21\.9|13\.9/.test(d)), week.join('|'));
assert.match(week.find((d) => /20\.9/.test(d)), /בוצעה 09:12 · עירית/);
assert.match(week.find((d) => /16\.9/.test(d)), /לא בוצעה/);
assert.match(week.at(-1), /היום[^]*טרם בוצעה/);
assert.match(await p32.locator('.rv-sum').innerText(), /בוצעה ב־2 מתוך 7 ימי העבודה האחרונים/);
// ── Irit's eleven topics (her protocol, step 19): one row each, in the protocol's order ──
const TOPICS = ['חוזים', 'חתימות', 'קבוצות WhatsApp', 'הודעות פתיחה', 'פגישות אפיון', 'ימי צילום', 'משימות פתוחות', 'אישורי לקוחות', 'תיקונים', 'עובדים שטרם סיימו משימות', 'לקוחות שצריך לחזור אליהם'];
assert.deepEqual(await p32.locator('.tp-list > li .tp-name').allInnerTexts(), TOPICS);
assert.equal(await p32.locator('.rv-topics').count(), 0); // the static list "על מה עוברים" is gone from her process
assert.equal(await page.locator('.rv-row').nth(1).locator('.rv-topics').count(), 1); // Ofir's keeps its own
const tp = (key) => page.locator(`#tp-${key}`);
const counts = await p32.locator('.tp-list > li').evaluateAll((els) => Object.fromEntries(els.map((e) => [e.id.slice(3), e.classList.contains('is-empty') ? 0 : Number(e.querySelector('.n').textContent)])));
// The work comes before the tick: the topics sit above "הבקרה היומית בוצעה".
assert.ok(await page.evaluate(() => document.querySelector('.tp-list').compareDocumentPosition(document.getElementById('rv-p32')) & Node.DOCUMENT_POSITION_FOLLOWING));
// A topic with nothing open: one quiet word, one line, nothing to open.
assert.equal(await tp('fixes').innerText().then((t) => t.replace(/\s+/g, ' ')), 'תיקונים אין');
assert.equal(await tp('fixes').locator('summary').count(), 0);
assert.ok((await tp('fixes').boundingBox()).height <= 46);
// The tick first says what was not opened; "לעבור עליהם" opens the first of them and marks nothing.
const openKeys = Object.keys(counts).filter((k) => counts[k] > 0);
assert.match(await page.innerText('#tp-left'), new RegExp(`^${openKeys.length} נושאים שיש בהם פריטים פתוחים עוד לא נפתחו היום: `));
await page.click('#rv-p32');
await page.waitForSelector('#dlg-unseen[open]');
assert.deepEqual(await page.locator('#dlg-unseen .tp-unseen li').allInnerTexts(), openKeys.map((k) => `${TOPICS[Object.keys(counts).indexOf(k)]} (${counts[k]})`));
assert.equal(await page.evaluate(() => document.activeElement.id), 'unseen-go');
await page.click('#unseen-go');
await page.waitForSelector(`#tp-${openKeys[0]} details[open]`);
assert.equal(await page.isChecked('#rv-p32'), false);
assert.ok(!db.office_reviews.some((r) => r.day === '2026-09-22' && r.kind === 'p32'));
assert.equal(await page.evaluate(() => document.activeElement.closest('.tp-row')?.id), `tp-${openKeys[0]}`);
// Each item leads to the client card at the right process, with how long it has been open.
assert.deepEqual(counts, { contracts: 1, signatures: 0, groups: 1, intro: 1, chars: 2, shoots: 4, tasks: 0, approvals: 0, fixes: 0, staff: 4, back: 1 });
// The client the trigger opened three minutes ago has no group yet; the pizzeria's group is open and its intro message is not sent.
await tp('groups').locator('summary').click();
assert.match(await tp('groups').locator('.tp-item').innerText(), /סלון יופי אור[^]*הקבוצה לא נפתחה · מהיום/);
assert.match(await tp('groups').locator('.tp-item a.wclient').getAttribute('href'), new RegExp(`client\\.html\\?id=${auto.id}#p02$`));
await tp('intro').locator('summary').click();
assert.match(await tp('intro').locator('.tp-item').innerText(), /פיצה נאפולי[^]*לא נשלחה הודעת היכרות · מהיום[^]*באיחור/);
// Shoot days: Thursday's (not closed with everyone yet), and the clients with no day set; the late one first of those.
await tp('shoots').locator('summary').click();
assert.deepEqual(await tp('shoots').locator('.tp-item .tp-text').allInnerTexts(), [
  'יום צילום · עוד לא סגור מול כולם · יום ה׳, 24.9 10:00', 'לא נקבע יום צילום · 4 ימי עסקים', 'לא נקבע יום צילום · סבב 2 · מהיום', 'לא נקבע יום צילום · מהיום',
]);
assert.match(await tp('shoots').locator('.tp-item').nth(2).locator('a.wclient').getAttribute('href'), /#r2-p11$/);
// Employees who have not finished: the same numbers as the table below, and the same way to each one's list.
await tp('staff').locator('summary').click();
assert.match(await tp('staff').locator('.tp-item').first().innerText(), /באיחור \d+ · פתוחים \d+[^]*הרשימה של /);
await tp('back').locator('summary').click();
const backRow = tp('back').locator('.tp-item', { hasText: 'קפה גליה' });
assert.match(await backRow.innerText(), /הגיע מועד הבדיקה · ממתין ללקוח: לקיחת גישות לרשתות · ״הלקוח עוד לא שלח גישה לאינסטגרם״[^]*ימי עסקים/);
assert.match(await backRow.locator('a.wclient').getAttribute('href'), new RegExp(`client\\.html\\?id=${waiting.id}#p05$`));
// Her step 20: a late item keeps the card's own "דיווח חריגה לליאור" one tap away.
assert.match(await backRow.locator('a.tp-esc').getAttribute('href'), new RegExp(`client\\.html\\?id=${waiting.id}#btn-escalate$`));
// The lists the control already had stay one tap away from their topic.
await tp('back').locator('.tp-more button').click();
assert.equal(await page.evaluate(() => document.activeElement.id), 'ctl-wait');
// Opening the rest: nothing is left, and one tick closes the day.
for (const k of openKeys) if ((await tp(k).locator('details').getAttribute('open')) === null) await tp(k).locator('summary').click();
await page.waitForFunction(() => document.getElementById('tp-left')?.textContent === 'עברת על כל הנושאים שיש בהם פריטים פתוחים.');
await shot('03a-control-topics');
if (OUT) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator('.rv-walk').screenshot({ path: `${OUT}/03b-1366-topics-only.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
}
// Irit marks her review; Ofir's she marks on his behalf.
// A click, not check(): once the mark is saved the tick is replaced by "בוצעה · …", and check() then
// looks for the tick again to read its state (it timed out whenever the save won that race).
await page.click('#rv-p32');
await toastHas('הבקרה של היום סומנה.');
assert.ok(db.office_reviews.some((r) => r.day === '2026-09-22' && r.kind === 'p32' && r.by_email === USER.email));
// The record keeps what was open at the tick, and that every one of them was opened.
const tick = JSON.parse(db.office_reviews.find((r) => r.day === '2026-09-22' && r.kind === 'p32').note);
assert.deepEqual(tick, { general: '', clients: {}, open: Object.fromEntries(openKeys.map((k) => [k, counts[k]])), unseen: [] });
assert.match(await p32.locator('.rv-record').innerText(), /^בזמן הסימון היו פתוחים: /);
assert.equal(await page.locator('#tp-left').count(), 0);
assert.match(await p32.innerText(), /בוצעה · עירית · 10:0\d/);
assert.match(await p32.locator('.rv-sum').innerText(), /בוצעה ב־3 מתוך 7/);
await page.locator('.rv-row').nth(1).locator('button:text("סימון בשם אופיר")').click();
await page.waitForFunction(() => /\(בשם אופיר\)/.test(document.querySelectorAll('.rv-row')[1]?.innerText || ''));
assert.match(await page.locator('.rv-row').nth(1).innerText(), /בוצעה · עירית · 10:0\d \(בשם אופיר\)/);
// Notes for today's review, shown next to the client.
await p32.locator('button:text("הוספת הערות")').click();
await page.waitForSelector('#dlg-notes[open]');
assert.match(await page.locator('#notes-h').innerText(), /הערות לבקרה של היום · תהליך 32/);
await page.locator('#dlg-notes label:has-text("קפה גליה")').click();
await page.keyboard.type('מחכים לגישה, אתקשר אחה״צ');
await page.fill('#notes-general', 'יום עמוס');
await page.click('#notes-submit');
await toastHas('ההערות נשמרו.');
const saved = JSON.parse(db.office_reviews.find((r) => r.day === '2026-09-22' && r.kind === 'p32').note);
assert.equal(saved.clients[waiting.id], 'מחכים לגישה, אתקשר אחה״צ');
assert.deepEqual([saved.open, saved.unseen], [tick.open, []]); // the notes do not wipe what the tick saw
assert.match(await wl.innerText(), /עירית, הבוקר: ״מחכים לגישה, אתקשר אחה״צ״/);
// Team summary
const team = await waText('.team-summary .wa-link');
assert.ok(team.startsWith('סיכום בוקר, יום שלישי 22.9:\nעירית: באיחור '), team);
assert.match(team, /באיחור אצלנו:\n- /);
assert.match(team, /ממתינים ללקוח: 1 לקוחות$/);
assert.doesNotMatch(team, /מאפיית כהן/);
await shot('03-control');
// The review card left Irit's list once marked.
await page.click('#tab-mine');
await page.waitForSelector('.witem');
assert.doesNotMatch(await page.locator('#mine-list').innerText(), /בקרה יומית · תהליך 32/);

// ── §8 performance: Irit sees the team table ──
// (Since 7.10.2026 the performance is Irit's manager profile, as for the owner, Ofir and Lior:
// the tab is not offered in her personal profile, and its address opens the manager's.)
assert.equal(await page.isHidden('#tab-performance'), true);
assert.equal(await page.isHidden('#mine-people'), true);
await page.evaluate(() => { location.hash = '#performance'; });
await page.waitForSelector('#profile-switch[data-to="mine"]');
await page.waitForSelector('.perf-table');
assert.equal(new URL(page.url()).hash, '#performance');
const perf = await page.locator('#performance').innerText();
assert.match(await page.locator('.perf-table tr:has-text("1 · הכנת חוזה")').innerText(), /\d+ מתוך \d+ \(\d+%\)/);
// Actual time and target are both office time: process 1's target is 10 office minutes (the contract), whenever the deal came in.
const p1perf = page.locator('.perf-table tr:has-text("1 · הכנת חוזה")');
assert.equal(await p1perf.locator('td[data-label="יעד"]').innerText(), '10 דק׳');
assert.match(await p1perf.locator('td[data-label="זמן בפועל (חציון)"]').innerText(), /^\d+ (דק׳|ש׳)/);
assert.match(await p1perf.locator('.perf-proc li:has-text("לקוח ותיק 1")').textContent(), / · 3 דק׳ בשעות העבודה$/);
// The imported weekly call is not counted: three client-weeks due since the imported campaigns, none logged.
assert.match(perf, /שיחות שתועדו: 0 מתוך 3 שבועות־לקוח/);
assert.match(await page.locator('.perf-table tr:has-text("3 · קביעת פגישת אפיון")').innerText(), /מעט מדי נתונים \(2\)/);
assert.match(perf, /הנתונים שלי/);
assert.match(perf, /אחוז נמוך בתהליך הוא קודם כול סימן לבדוק את התהליך או את היעד/);
// Decision 22: the whole team is the owner's and Lior's; Irit sees her own row only.
assert.equal(await page.locator('.perf-team').count(), 0);
assert.deepEqual(await page.locator('.perf-me tbody td:first-child').allInnerTexts(), ['עירית']);
await page.click('#performance .chip:text("90 הימים האחרונים")');
await page.waitForSelector('#performance .chip[aria-pressed="true"]:text("90")');
await page.waitForSelector('.perf-me tbody tr');
assert.deepEqual(await page.locator('.perf-me tbody td:first-child').allInnerTexts(), ['עירית']);
assert.equal(await page.locator('.perf-team').count(), 0);
await shot('04-performance');
// Arrow keys reach the new tab.
await page.focus('#tab-performance');
await page.keyboard.press('Home');
assert.equal(await page.getAttribute('#tab-mine', 'aria-selected'), 'true');
await page.keyboard.press('End');
assert.equal(await page.getAttribute('#tab-performance', 'aria-selected'), 'true');
// Back to her personal profile with the button at the top.
await page.click('#profile-switch');
await page.waitForSelector('#profile-switch[data-to="manager"]');
await page.waitForSelector('#view-mine:not([hidden])');

// ── §6b notifications: asked only on click; once per process (a new deal's three: once); none on first load ──
await page.click('#tab-mine');
await page.click('#btn-notify');
await page.waitForSelector('.notify-row:has-text("התראות על איחורים ועל לקוח שלא ענה פעילות בדפדפן הזה.")');
assert.equal(await page.evaluate(() => window.__asked), 1);
await page.reload();
await page.waitForSelector('.witem');
assert.equal(await page.evaluate(() => window.__notes.length), 0, 'no notification on first load');
// A client arrives whose process 1 is due in two minutes; the tab goes to the background.
const soon = client({ name: 'גלידה בנמל', deal_at: new Date(Date.now() + skew).toISOString() });
await page.click('#btn-refresh');
await page.waitForSelector('.wclient:text("גלידה בנמל")');
await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
for (let i = 0; i < 12; i += 1) { await page.clock.runFor(61_000); skew += 61_000; }
const notes = await page.evaluate(() => window.__notes);
// One notification per process, however many checks ran (12 here).
assert.equal(new Set(notes.map((n) => `${n.title}|${n.body}`)).size, notes.length, JSON.stringify(notes));
// Its clocks run out in the "now" bar: the group and the meeting date together at 5
// minutes, the contract at 10 (the owner's decision of 3.10.2026). One notification
// for each row, and none again when the processes turn overdue.
const late = notes.filter((n) => /גלידה בנמל/.test(n.title));
assert.deepEqual(late.map((n) => [n.title, n.body]), [
  ['נגמר הזמן: גלידה בנמל', 'עסקה חדשה: קבוצה ומועד אפיון (תהליכים 2, 3).'],
  ['נגמר הזמן: גלידה בנמל', 'עסקה חדשה: חוזה (תהליך 1).'],
], JSON.stringify(notes));
assert.ok(!notes.some((n) => /קפה גליה/.test(n.title)), 'no notification for waiting on the client');
await page.evaluate(() => { delete document.hidden; });
assert.ok(soon);

// ── Lior: the whole team (decision 22), his own row first ──
// (Since 6.10.2026 the performance and the others' lists are Lior's manager profile: its
// address opens it, and "עבודת הצוות" there is the list with the choice of whose.)
db.staff[0].person = 'lior';
await page.reload();
await page.waitForSelector('#app:not([hidden])');
await page.waitForSelector('#profile-switch');
assert.equal(await page.isHidden('#tab-performance'), true);
await page.evaluate(() => { location.hash = '#performance'; });
await page.waitForSelector('#profile-switch[data-to="mine"]');
await page.waitForSelector('.perf-table');
assert.deepEqual(await page.locator('.perf-me tbody td:first-child').allInnerTexts(), ['ליאור']);
assert.deepEqual(await page.locator('.perf-team tbody tr:not(.group-row) td:first-child').allInnerTexts(),
  ['עירית', 'ליאור', 'אופיר', 'עילאי', 'אלי', 'ניראל', 'נדיה', 'יריב', 'אנה']); // the editors under their own heading
// Not Irit: the bulk button follows "me", never the person being viewed.
await page.click('#tab-mine');
await page.click('#mine-people .chip:has-text("עירית")');
await page.waitForSelector('.wproc:has(.wclient:text("פיצה נאפולי"))');
// (Process 3 has no items of Lior's; in process 2 he has his own two, p02.intro and p02.deal.)
assert.equal(await page.locator('.wproc:has(.wclient:text("פיצה נאפולי")):has-text("קביעת פגישת אפיון") .bulk-btn').count(), 0);
assert.equal(await page.locator('.auto-banner').count(), 1); // Irit's view shows the banner
db.staff[0].person = 'irit';

// ── Batch 3: new people, urgent tasks, escalations, briefs, Ofir's control ──
// Every required item of the processes in these phases, closed at `when`.
const doneThrough = (c, phases, when) => {
  for (const p of applicableProcesses(c)) if (phases.includes(p.phase)) for (const i of p.items) if (!i.optional) check(c, i.key, when);
};
const UP_TO_SHOOT = ['onboarding', 'parallel', 'prep', 'eve', 'shoot'];
// Shot on Sunday, drive back and assigned to Nirel (Natali's editor) on Monday.
const natali = client({ name: 'סטודיו נטלי', phone: '050-1234567', shoot_type: 'natali', characterizer: 'ofir', has_logo: true, editor: 'nirel',
  deal_at: hoursAgo(24 * 14), char_at: hoursAgo(24 * 13), shoot_at: hoursAgo(48) });
doneThrough(natali, UP_TO_SHOOT, hoursAgo(26));
for (const k of ['p22a.drive', 'p22a.load', 'p22a.assigned']) check(natali, k, hoursAgo(25));
// Shot too, but no editor yet: waits for Ofir, and the post phase is missing its editor.
const sea = client({ name: 'מסעדת הים', phone: '050-7654321', shoot_type: 'dms', characterizer: null, has_logo: true,
  deal_at: hoursAgo(24 * 10), char_at: hoursAgo(24 * 9), shoot_at: hoursAgo(48) });
doneThrough(sea, UP_TO_SHOOT, hoursAgo(26));
// Nothing happened since 3.9: no activity for weeks, processes late by more than two business days.
const idle = client({ name: 'חנות ישנה', characterizer: 'ofir', deal_at: '2026-09-01T07:00:00Z', char_at: '2026-09-02T07:00:00Z' });
doneThrough(idle, ['onboarding'], '2026-09-03T08:00:00Z');
const task = (o) => db.client_tasks.push({ id: randomUUID(), done_at: null, done_by_email: null, source: null, brief: null, urgent: false, due_on: null, ...o });
task({ client_id: seeded.id, title: 'להחליף את הלוגו בגרפיקה 4', owner: 'irit', urgent: true, created_by_email: 'lior@astrateg.test', created_at: minsAgo(30) });
task({ client_id: waiting.id, title: 'לקוח מתלונן: הגרפיקות לא מתאימות לעסק', owner: 'lior', source: 'escalation', due_on: '2026-09-22', created_by_email: 'ofir@astrateg.test', created_at: hoursAgo(2) });
task({ client_id: natali.id, title: 'תיקון כתובית בסרטון 3', owner: 'nirel', due_on: '2026-09-23', created_by_email: 'lior@astrateg.test', created_at: hoursAgo(3),
  brief: { problem: 'שגיאת כתיב בכתובית של סרטון 3', change: 'לתקן את המילה ״מספרה״', keep: 'הקצב והמוזיקה', result: 'סרטון מתוקן בדרייב', materials: '' } });
db.staff.push({ email: 'nirel@astrateg.test', person: 'nirel' });
db.staff[0].person = 'irit';
await page.reload();
await page.waitForSelector('#view-mine:not([hidden]) .witem');

// Urgent first, above "overdue", with a text badge; who opened it and when.
const order3 = await page.locator('#mine-list .wgroup').evaluateAll((els) => els.map((e) => e.className));
assert.match(order3[0], /g-urgent/);
assert.match(order3[1], /g-overdue/);
const urgentCard = page.locator('.g-urgent .wproc');
assert.equal(await urgentCard.count(), 1);
assert.match(await page.locator('.g-urgent .wgroup-h').innerText(), /^דחוף/);
assert.match(await urgentCard.innerText(), /מספרת רון[^]*דחוף[^]*נפתח ע״י ליאור[^]*להחליף את הלוגו בגרפיקה 4/);
assert.equal(await urgentCard.locator('.sbadge.s-urgent .sicon').count(), 1);
// People: the new ones appear, the "assigned editor" placeholder does not.
// (The choice of whose list is the manager profile's, at #team; it opens on her own list.)
await page.evaluate(() => { location.hash = '#team'; });
await page.waitForSelector('#mine-people .chip');
const chips = await page.locator('#mine-people .chip').allInnerTexts();
for (const n of ['ניראל', 'נדיה', 'יריב', 'אנה']) assert.ok(chips.some((c) => c.startsWith(n)), chips.join('|'));
assert.ok(!chips.some((c) => /העורך המשויך/.test(c)), chips.join('|'));
assert.ok(!(await page.locator('#mine-select option').allInnerTexts()).some((o) => /העורך המשויך/.test(o)));
// The morning summary leads with urgent work.
const sum3 = await waText('#mine-tools .wa-link');
assert.match(sum3, /\n\nדחוף \(1\):\n- מספרת רון · להחליף את הלוגו בגרפיקה 4\nבאיחור \(/);
await shot('09-urgent-first');
// Nirel's list: the task shows its brief, folded.
await page.click('#mine-people .chip:has-text("ניראל")');
const briefTask = page.locator('.wproc:has(.wclient:text("סטודיו נטלי")):has-text("תיקון כתובית בסרטון 3")');
await briefTask.waitFor();
assert.equal(await briefTask.locator('details.brief').getAttribute('open'), null);
await briefTask.locator('details.brief summary').click();
const brief = await briefTask.locator('.brief-list').innerText();
assert.match(brief, /מה הבעיה המדויקת\s*שגיאת כתיב בכתובית של סרטון 3/);
assert.match(brief, /מה צריך להישאר כמו שהוא\s*הקצב והמוזיקה/);
assert.doesNotMatch(brief, /אילו חומרים רלוונטיים/); // empty fields are left out
// Nirel's editing work (process 22 of the client assigned to her) is in her list too.
assert.ok(await page.locator('.wproc:has(.wclient:text("סטודיו נטלי")):has-text("עריכת הסרטונים")').count() >= 1);
assert.match(await waText('#mine-tools .wa-link'), /^בוקר טוב ניראל,/);
await shot('10-nirel-brief');
// Lior's list: the exception reported to him, on top.
await page.click('#mine-people .chip:has-text("ליאור")');
// Not marked urgent: its own group right after "urgent", still above "overdue".
const esc = page.locator('.g-escalation .wproc:has(.wclient:text("קפה גליה"))');
await esc.waitFor();
const liorGroups = await page.locator('#mine-list .wgroup').evaluateAll((els) => els.map((e) => e.className));
assert.ok(liorGroups.findIndex((c) => /g-escalation/.test(c)) < liorGroups.findIndex((c) => /g-overdue/.test(c)), liorGroups.join('|'));
assert.equal(await page.locator('.g-urgent .wproc:has(.wclient:text("קפה גליה"))').count(), 0);
assert.match(await waText('#mine-tools .wa-link'), /חריגות שדווחו \(1\):\n- חריגה שדווחה: קפה גליה · לקוח מתלונן: הגרפיקות לא מתאימות לעסק/);
assert.match(await esc.innerText(), /חריגה שדווחה[^]*דווח ע״י אופיר[^]*לקוח מתלונן: הגרפיקות לא מתאימות לעסק/);
assert.equal(await esc.locator('.sbadge.s-escalation').count(), 1);

// Control: urgent and exceptions lead; editors grouped; Ofir's sections.
await page.click('#tab-control');
await page.waitForSelector('.ctl-esc');
const secs = await page.locator('#control > *').evaluateAll((els) => els.map((e) => e.className));
assert.match(secs[0], /ctl-nav/);
assert.match(secs[1], /ctl-urgent/);
assert.match(secs[2], /ctl-esc/);
assert.match(await page.locator('.ctl-urgent').innerText(), /מספרת רון[^]*דחוף[^]*להחליף את הלוגו בגרפיקה 4[^]*עירית/);
const escRow = await page.locator('.ctl-esc .task-row').innerText();
assert.match(escRow, /קפה גליה[^]*חריגה שדווחה[^]*לקוח מתלונן: הגרפיקות לא מתאימות לעסק[^]*ליאור/);
assert.match(escRow, /דווח ע״י אופיר · .* · לפני (2 שעות|שעתיים)/);
const bodyRows = await page.locator('.ctable tbody tr').allInnerTexts();
assert.ok(bodyRows.some((r) => /^עורכים/.test(r.trim())), 'editors sub-heading');
for (const n of ['ניראל', 'נדיה', 'יריב', 'אנה']) assert.ok(bodyRows.some((r) => r.includes(n)), n);
assert.ok(!bodyRows.some((r) => /העורך המשויך/.test(r)));
assert.match(await page.locator('.ctable thead').innerText(), /דחוף/);
const team3 = await waText('.team-summary .wa-link');
assert.match(team3, /\nעירית: דחוף 1 · באיחור /);
assert.match(team3, /\nניראל: באיחור \d+ · להיום \d+/);
assert.match(team3, /חריגות פתוחות אצל ליאור \(1\):\n- קפה גליה · לקוח מתלונן: הגרפיקות לא מתאימות לעסק/);
// Editor load: every editor in the same order, Nirel "Natali only", due dates of the editing steps.
assert.deepEqual(await page.locator('.editor-card .editor-head .pchip').allInnerTexts(), ['נדיה', 'יריב', 'אנה', 'ניראל']);
const nirelCard = page.locator('.editor-card:has(.pchip:text("ניראל"))');
const nirelText = await nirelCard.innerText();
assert.match(nirelText, /נטלי בלבד/);
assert.match(nirelText, /1 לקוח בעריכה · 1 משימה פתוחה/);
assert.match(nirelText, /סטודיו נטלי[^]*22 · עריכה[^]*יעד[^]*24 · העלאה לדרייב והעברה לאופיר[^]*27 · תיקונים וסגירה/);
assert.match(await page.locator('.editor-card:has(.pchip:text("נדיה"))').innerText(), /0 לקוחות בעריכה · 0 משימות פתוחות[^]*אין כרגע לקוחות בעריכה/);
assert.match(await page.locator('.await-editor').innerText(), /ממתינים לשיוך עורך[^]*מסעדת הים[^]*22א · העברה לעריכה ושיוך לעורך/);
// System integrity, each row linking to the client (and process).
const health = page.locator('.health-sec');
assert.match(await health.locator('.h-idle').innerText(), /חנות ישנה[^]*פעילות אחרונה/);
assert.doesNotMatch(await health.locator('.h-idle').innerText(), /סטודיו נטלי|מספרת רון/);
assert.match(await health.locator('.h-nodue').innerText(), /מספרת רון · להחליף את הלוגו בגרפיקה 4/);
assert.match(await health.locator('.h-missing').innerText(), /מסעדת הים · חסר: עורך משויך/);
const lateRow = health.locator('.h-late li:has-text("חנות ישנה")').first();
assert.match(await lateRow.locator('a').nth(1).getAttribute('href'), new RegExp(`client\\.html\\?id=${idle.id}#p\\d`));
assert.doesNotMatch(await health.locator('.h-late').innerText(), /פיצה נאפולי/); // late, but not by more than two business days
// Jump links reach a section.
await page.click('.ctl-nav .chip:has-text("תקינות המערכת")');
assert.equal(await page.evaluate(() => document.activeElement.id), 'ctl-health');
await shot('11-control-batch3');

// Weekly status summary: every client in work, progress, the dialog.
const inWorkN = db.clients.filter((c) => c.status === 'active' || c.status === 'ending').length;
const status = page.locator('.status-sec');
assert.match(await status.locator('.status-progress').innerText(), new RegExp(`סוכמו 0 מתוך ${inWorkN} לקוחות`));
assert.equal(await status.locator('.status-row').count(), inWorkN);
assert.equal(await status.locator('.status-row:has-text("מאפיית כהן")').count(), 0);
await status.locator('button[aria-label="כתיבת סיכום המצב של סטודיו נטלי"]').click();
await page.waitForSelector('#dlg-status[open]');
assert.equal(await page.locator('#status-h').innerText(), 'סיכום מצב · סטודיו נטלי');
assert.match(await page.locator('#status-ctx').innerText(), /מהמערכת: שלב: עריכה ובקרה/ /* the station (one source), not the protocol's phase "עריכה ומסירה" */);
assert.deepEqual(await page.locator('#stf-owner option').allInnerTexts(), ['בחירה', 'עירית', 'ליאור', 'אופיר', 'עילאי', 'אלי', 'ניראל', 'נדיה', 'יריב', 'אנה']);
await page.click('#status-save');
assert.match(await page.locator('#status-err').innerText(), /^חסר: מצב נוכחי, פעולה הבאה, אחראי, מועד יעד\./);
assert.equal(await page.getAttribute('#stf-owner', 'aria-invalid'), 'true');
assert.equal(await page.evaluate(() => document.activeElement.id), 'stf-current');
await page.click('#status-ctx .btn-text:text("מילוי מהמערכת")');
assert.equal(await page.inputValue('#stf-current'), 'עריכה ובקרה');
await page.fill('#stf-current', 'הסרטונים בעריכה');
await page.fill('#stf-missing', '12 סרטונים');
await page.fill('#stf-next', 'בדיקת סטטוס מול ניראל');
await page.selectOption('#stf-owner', 'ofir');
await page.fill('#stf-due', '2026-09-24');
await page.click('#status-next');
await toastHas(`סיכום המצב של סטודיו נטלי נשמר. סוכמו 1 מתוך ${inWorkN} לקוחות.`);
const note1 = db.client_status_notes.find((n) => n.client_id === natali.id);
assert.deepEqual({ ...note1, by_email: undefined, at: undefined }, {
  client_id: natali.id, week: '2026-09-20', current: 'הסרטונים בעריכה', missing: '12 סרטונים', next: 'בדיקת סטטוס מול ניראל',
  owner: 'ofir', due_on: '2026-09-24', by_email: undefined, at: undefined,
});
// "Save and next" opens the next client not summarised yet.
await page.waitForSelector('#dlg-status[open]');
assert.notEqual(await page.locator('#status-h').innerText(), 'סיכום מצב · סטודיו נטלי');
await page.locator('#dlg-status .dlg-foot [data-close]').click();
const row1 = status.locator('.status-row:has(.wclient:text("סטודיו נטלי"))');
assert.match(await row1.innerText(), /סוכם[^]*מצב נוכחי\s*הסרטונים בעריכה[^]*מה חסר\s*12 סרטונים[^]*פעולה הבאה\s*בדיקת סטטוס מול ניראל[^]*אחראי\s*אופיר[^]*מועד יעד\s*ה׳ 24\.9[^]*נכתב ע״י עירית/);
assert.match(await status.locator('.status-progress').innerText(), new RegExp(`סוכמו 1 מתוך ${inWorkN}`));
// The next action becomes a task in the system.
await row1.locator('button:text("פתיחת משימה")').click();
await toastHas('נפתחה משימה לאופיר: בדיקת סטטוס מול ניראל');
const made = db.client_tasks.find((t) => t.source === 'status');
assert.deepEqual([made.client_id, made.title, made.owner, made.due_on], [natali.id, 'בדיקת סטטוס מול ניראל', 'ofir', '2026-09-24']);
assert.match(await row1.innerText(), /נפתחה משימה/);
assert.equal(await row1.locator('button:text("פתיחת משימה")').count(), 0);
// Editing keeps the saved values.
await row1.locator('button:text("עריכה")').click();
await page.waitForSelector('#dlg-status[open]');
assert.equal(await page.inputValue('#stf-missing'), '12 סרטונים');
assert.equal(await page.inputValue('#stf-owner'), 'ofir');
await page.locator('#dlg-status .dlg-foot [data-close]').click();
// A next action for Nirel needs a brief: the task is opened in the card.
await status.locator('button[aria-label="כתיבת סיכום המצב של מסעדת הים"]').click();
await page.waitForSelector('#dlg-status[open]');
await page.fill('#stf-current', 'ממתין לשיוך עורך');
await page.fill('#stf-next', 'לתקן את הלוגו בסגיר');
await page.selectOption('#stf-owner', 'nirel');
await page.fill('#stf-due', '2026-09-23');
await page.click('#status-save');
await toastHas(`סוכמו 2 מתוך ${inWorkN} לקוחות.`);
assert.match(await status.locator('.status-row:has(.wclient:text("מסעדת הים")) a:has-text("פתיחת משימה לניראל בכרטיס (עם בריף)")').getAttribute('href'), new RegExp(`${sea.id}#tasks$`));
await shot('12-status-summary');

// ── Mobile 360px ──
const mob = await ctx.newPage();
watch(mob);
await mob.setViewportSize({ width: 360, height: 780 });
for (const [hash, sel, name] of [['mine', '.witem', '05-mobile-mine'], ['clients', '.crow', '06-mobile-clients'], ['control', '.rv-panel', '07-mobile-control'], ['performance', '.perf-table', '08-mobile-performance']]) {
  await mob.goto(`${BASE}clients.html#${hash}`);
  await mob.waitForSelector(sel);
  assert.ok(await noHScroll(mob), `${hash} scrolls sideways at 360px`);
  await shot(name, mob);
}
await mob.goto(`${BASE}clients.html#mine`);
await mob.waitForSelector('.bulk-btn');
const bb = await mob.locator('.bulk-btn').first().boundingBox();
assert.ok(bb.height >= 44, `bulk button ${bb.height}px high`);
assert.equal(await mob.locator('details.g-client').getAttribute('open'), null, 'waiting group folds on phones');
const tabsFit = await mob.evaluate(() => { const t = document.querySelector('.tabs'); return t.scrollWidth <= t.clientWidth + 1; });
assert.ok(tabsFit, 'four tabs fit at 360px');
// The weekly summary dialog fills the phone screen without sideways scrolling; its buttons are 44px.
await mob.goto(`${BASE}clients.html#control`);
await mob.locator('.status-sec .status-edit').first().click();
await mob.waitForSelector('#dlg-status[open]');
assert.ok(await noHScroll(mob), 'status dialog scrolls sideways at 360px');
assert.ok((await mob.locator('#status-save').boundingBox()).height >= 44);
assert.ok((await mob.locator('.ctl-nav .chip').first().boundingBox()).height >= 44);
await shot('15-mobile-status-dialog', mob);
await mob.locator('#dlg-status .dlg-foot [data-close]').click();

// ── Irit's control on a 390px phone: the eleven topics in about two screens, and "לסמן בכל זאת" is recorded as such ──
db.office_reviews = db.office_reviews.filter((r) => !(r.kind === 'p32' && r.day === '2026-09-22')); // today's control is open again
await mob.setViewportSize({ width: 390, height: 844 });
await mob.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('astrateg.control.seen.')) localStorage.removeItem(k); });
await mob.goto('about:blank');
await mob.goto(`${BASE}clients.html#control`);
await mob.waitForSelector('.tp-list');
assert.ok(await noHScroll(mob), 'the control scrolls sideways at 390px');
const walk = await mob.locator('.rv-walk').boundingBox();
assert.ok(walk.height <= 2 * 844, `Irit's control is ${Math.round(walk.height)}px high at 390px: more than two screens`);
const rowHeights = await mob.locator('.tp-list > li').evaluateAll((els) => els.map((e) => Math.round((e.querySelector('summary') || e).getBoundingClientRect().height)));
assert.equal(rowHeights.length, 11);
assert.ok(rowHeights.every((x) => x >= 44 && x <= 60), `topic rows: ${rowHeights.join(', ')}`); // one line each, a full touch target
await shot('16-mobile-390-control-topics', mob);
if (OUT) await mob.locator('.rv-walk').screenshot({ path: `${OUT}/16b-mobile-390-topics-only.png` });
const mobOpen = await mob.locator('.tp-list > li:not(.is-empty)').evaluateAll((els) => els.map((e) => e.id.slice(3)));
await mob.locator(`#tp-${mobOpen[0]} summary`).click();
await mob.waitForSelector(`#tp-${mobOpen[0]} .tp-item`);
for (const el of await mob.locator(`#tp-${mobOpen[0]} .tp-item a, #tp-${mobOpen[0]} .tp-item button`).all()) assert.ok((await el.boundingBox()).height >= 44, 'a link inside a topic is a 44px target');
assert.ok(await noHScroll(mob), 'an open topic scrolls sideways at 390px');
await shot('17-mobile-390-topic-open', mob);
if (OUT) await mob.locator('.rv-walk').screenshot({ path: `${OUT}/17b-mobile-390-topic-open-only.png` });
await mob.click('#rv-p32');
await mob.waitForSelector('#dlg-unseen[open]');
assert.equal(await mob.locator('#dlg-unseen .tp-unseen li').count(), mobOpen.length - 1);
assert.ok(await noHScroll(mob), 'the confirmation scrolls sideways at 390px');
for (const id of ['#unseen-mark', '#unseen-go']) assert.ok((await mob.locator(id).boundingBox()).height >= 44, id);
await shot('18-mobile-390-unseen', mob);
await mob.click('#unseen-mark');
await mob.waitForFunction(() => document.querySelector('.rv-walk .rv-record'));
const anyway = JSON.parse(db.office_reviews.find((r) => r.day === '2026-09-22' && r.kind === 'p32').note);
assert.deepEqual(Object.keys(anyway.open), mobOpen);
assert.deepEqual(anyway.unseen, mobOpen.slice(1)); // marked anyway: the record says which were not opened
assert.match(await mob.locator('.rv-walk .rv-record').innerText(), /בזמן הסימון היו פתוחים: [^]* לא נפתחו: /);

// ── Role views: everyone lands on their own work ──
// Ilai ('own'): his list only. No picker, no one else's list, no office screens, not even by link.
db.staff[0].person = 'ilai';
await page.goto('about:blank'); // a real load (the same address with another hash would not reload)
await page.goto(`${BASE}clients.html#control`);
await page.waitForSelector('#view-mine:not([hidden]) .wproc');
assert.equal(new URL(page.url()).hash, '#mine');
assert.match(await page.locator('#me-bar').innerText(), /עילאי/);
for (const sel of ['#tab-control', '#btn-new', '#mine-people', '#view-control']) assert.equal(await page.isHidden(sel), true, sel);
assert.equal(await page.innerText('#tab-performance'), 'הנתונים שלי'); // his own row of the team screen (decision 22)
assert.equal(await page.locator('.who-panel, .auto-banner, .rv-card, .thu-card, #mine-tools .wa-link').count(), 0);
// Every card is a process with an item of his.
const ilaiTitles = await page.locator('#mine-list .wproc:not(.soon-card) .wtitle').allInnerTexts();
// Since package 1 the first 9 graphics are a card of his (with the upload), not a row of this list.
assert.ok(ilaiTitles.length >= 4, ilaiTitles.join('|'));
assert.ok(!ilaiTitles.some((t) => /^7 · /.test(t)), ilaiTitles.join('|'));
assert.ok(await page.locator('.g-ilai .il-card[data-key^="il-first:"]').count() >= 1);
for (const t of ilaiTitles) {
  const proc = PROCESSES.find((p) => p.num === /^(?:סבב \d+ · )?([^ ]+) · /.exec(t)?.[1]);
  assert.ok(proc?.items.some((i) => [].concat(i.owners || proc.owners).includes('ilai')), t);
}
assert.match(await page.locator('.g-overdue .wproc:has(.wclient:text("מספרת רון")):has-text("בדיקת הגישות וסידור הרשתות")').innerText(), /באיחור/);
// His graphics start on the shoot day: coming up, not called his shoot day.
const ilaiSoon = page.locator('.g-soon .soon-card:has(.wclient:text("מספרת רון"))');
assert.match(await ilaiSoon.innerText(), /23 · הכנת יתרת הגרפיקות · מתחיל/);
assert.doesNotMatch(await ilaiSoon.innerText(), /יום צילום|הגעת המשפיענים/);
await shot('16-ilai-mine');
// Only the clients he works on: not the fresh ones yet, never the cancelled or ended.
await page.click('#tab-clients');
await page.waitForSelector('.crow');
assert.deepEqual((await page.locator('.crow strong').allInnerTexts()).sort(), ['חנות ישנה', 'מסעדת הים', 'רון עיצוב שיער · מספרת רון', 'סטודיו נטלי', 'קפה גליה'].sort()); // the business first, when there is one
assert.equal(await page.locator('.crow .cprog, #client-filters .chip').count(), 0);
// The arrow keys move between his three tabs only: his work, his clients, his own numbers.
await page.focus('#tab-clients');
await page.keyboard.press('ArrowLeft');
assert.equal(await page.getAttribute('#tab-performance', 'aria-selected'), 'true');
await page.waitForSelector('.perf-me tbody tr');
assert.deepEqual(await page.locator('.perf-me tbody td:first-child').allInnerTexts(), ['עילאי']);
assert.equal(await page.locator('.perf-team, .perf-table:not(.perf-people), .perf-calls').count(), 0);
await page.keyboard.press('ArrowLeft');
assert.equal(await page.getAttribute('#tab-mine', 'aria-selected'), 'true');
await page.keyboard.press('End');
assert.equal(await page.getAttribute('#tab-performance', 'aria-selected'), 'true');
// His card: only his processes (with the second round's), none of the office's controls; one click checks.
await page.goto(`${BASE}client.html?id=${seeded.id}#p06`);
await page.waitForSelector('#p06');
// 27 too: Ilai's "קיבלתי" on the final versions closes the editing (protocol v5).
assert.deepEqual(await page.locator('.proc').evaluateAll((els) => els.map((e) => e.id)), ['p06', 'p07', 'p07b', 'p09', 'p23', 'p23b', 'p27', 'p28', 'p29', 'r2-p27', 'r2-p28', 'r2-p29']);
for (const sel of ['#btn-edit', '#view-toggle', '.deliv', '.status-note', '.round-add', '.round-head button', '#task-form:not([hidden])']) assert.equal(await page.locator(sel).count(), 0, sel);
assert.equal(await page.isHidden('#access'), true); // the vault is not his in this fake
assert.equal(await page.isHidden('#history'), true);
// Lior's optional item in process 6 is summed up, not listed.
assert.equal(await page.locator('#i-p06-recovered').count(), 0);
assert.match(await page.locator('#p06 .others-note').innerText(), /ועוד פריט אחד בתהליך הזה אצל ליאור/);
await page.check('#i-p06-verified');
await page.waitForFunction(() => document.querySelector('#i-p06-verified')?.closest('.item').classList.contains('is-done') && !document.querySelector('.is-busy'));
assert.ok(db.protocol_checks.some((c) => c.client_id === seeded.id && c.item_key === 'p06.verified'));
db.protocol_checks = db.protocol_checks.filter((c) => !(c.client_id === seeded.id && c.item_key === 'p06.verified'));
await shot('17-ilai-card');
// On a phone: no sideways scrolling, 44px rows.
const mobIlai = await ctx.newPage();
watch(mobIlai);
await mobIlai.setViewportSize({ width: 360, height: 780 });
await mobIlai.goto(`${BASE}clients.html`);
await mobIlai.waitForSelector('#view-mine:not([hidden]) .witem');
assert.ok(await noHScroll(mobIlai), 'Ilai\'s list scrolls sideways at 360px');
assert.ok(await mobIlai.locator('.witem').first().evaluate((el) => el.getBoundingClientRect().height) >= 44);
await shot('18-mobile-ilai-mine', mobIlai);
await mobIlai.goto(`${BASE}client.html?id=${seeded.id}`);
await mobIlai.waitForSelector('#p06', { state: 'attached' });
assert.ok(await noHScroll(mobIlai), 'Ilai\'s card scrolls sideways at 360px');
await mobIlai.close();

// The owner (no person): the office, the whole team first, anyone's list on request.
// (Since 6.10.2026 he lands on "המשימות שלי", where the team's work is closed in one line;
// the team's work itself is the manager profile's, at #team.)
db.staff[0].person = null;
await page.goto(`${BASE}clients.html#mine`);
await page.waitForSelector('#team-fold');
assert.match(await page.locator('#me-bar').innerText(), /המשימות שלי/);
assert.equal(await page.innerText('#tab-mine'), 'המשימות שלי');
for (const sel of ['#tab-control', '#tab-performance', '#mine-people']) assert.equal(await page.isHidden(sel), true, sel);
await page.click('#team-open');
await page.waitForSelector('#view-mine:not([hidden]) .wproc');
assert.equal(new URL(page.url()).hash, '#team');
assert.match(await page.locator('#me-bar').innerText(), /תצוגת משרד/);
assert.equal(await page.innerText('#tab-mine'), 'עבודת הצוות');
assert.match(await page.locator('#mine-people .chip[aria-pressed="true"]').innerText(), /^כל הצוות/);
assert.equal(await page.locator('.who-panel').count(), 0);
for (const sel of ['#tab-control', '#tab-performance', '#btn-new']) assert.equal(await page.isVisible(sel), true, sel);
await page.click('#mine-people .chip:has-text("אלי")');
await page.waitForSelector('details.g-soon'); // the photographer's coming shoot day, folded in the office
await page.locator('details.g-soon summary').click();
assert.match(await page.locator('.g-soon').innerText(), /מספרת רון[^]*יום צילום[^]*17ב/);
await page.click('#tab-performance');
await page.waitForSelector('.perf-team'); // the table by person
await page.goto(`${BASE}client.html?id=${seeded.id}`);
await page.waitForSelector('#p04', { state: 'attached' }); // the whole protocol
assert.equal(await page.locator('#view-toggle').count(), 0);
assert.ok(await page.locator('.viewbar .chip').count() >= 10, 'highlight anyone');

// Irit (office): her card opens on hers; a link to someone else's process shows the whole protocol.
db.staff[0].person = 'irit';
await page.goto(`${BASE}client.html?id=${fresh.id}`);
await page.waitForSelector('#view-toggle');
assert.equal(await page.innerText('#view-toggle'), 'הצגת כל הפרוטוקול');
assert.equal(await page.locator('#p06').count(), 0); // Ilai's
assert.equal(await page.locator('#p02').count(), 1); // hers
await page.goto('about:blank');
await page.goto(`${BASE}client.html?id=${seeded.id}#p06`);
await page.waitForSelector('#p06');
assert.equal(await page.innerText('#view-toggle'), 'רק התהליכים שלי');

// ── Thursday, as Ofir: the mandatory pass over every client ──
// No review of process 33 since Sunday: three business days.
db.office_reviews = db.office_reviews.filter((r) => !(r.kind === 'p33' && r.day === '2026-09-22'));
db.staff[0].person = 'ofir';
const THU = new Date('2026-09-24T06:30:00Z'); // 09:30 in Jerusalem
const thuCtx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 1280, height: 900 } });
// These checks walk the whole list of "המשימות שלי" ("תצוגה מלאה"); the short one is tests/roles-phone-e2e.mjs.
await thuCtx.addInitScript(() => { try { localStorage.setItem('astrateg.mine.full', 'on'); } catch { /* no storage */ } });
await thuCtx.clock.install({ time: THU });
skew = THU.getTime() - Date.now();
await thuCtx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
await thuCtx.addInitScript(fakeNotifications);
const thu = await thuCtx.newPage();
watch(thu);
// Ofir's first screen is the quality-control queue (qa.html); "המשימות שלי" is one link away.
await thu.goto(`${BASE}clients.html#mine`);
await thu.fill('#lg-email', USER.email);
await thu.fill('#lg-pass', 'correct-horse');
await thu.click('#lg-submit');
await thu.waitForSelector('#view-mine:not([hidden]) .wproc');
const thuCard = thu.locator('.g-thu .thu-card');
const thuGroups = await thu.locator('#mine-list .wgroup').evaluateAll((els) => els.map((e) => e.className));
assert.ok(thuGroups.findIndex((c) => /g-thu/.test(c)) < thuGroups.findIndex((c) => /g-overdue/.test(c)), thuGroups.join('|'));
assert.match(await thuCard.innerText(), new RegExp(`מעבר חובה של יום חמישי: סיכום מצב לכל הלקוחות \\(2/${inWorkN}\\)`));
assert.match(await waText('#mine-tools .wa-link', thu), new RegExp(`מעבר חובה של יום חמישי \\(1\\):\\n- סיכום מצב לכל הלקוחות: סוכמו 2 מתוך ${inWorkN}`));
await shot('13-thursday-ofir', thu);
await thuCard.locator('a:text("מעבר לסיכום המצב")').click();
await thu.waitForSelector('#view-control:not([hidden]) .status-sec');
assert.equal(await thu.evaluate(() => document.activeElement.id), 'ctl-status');
const p33row = thu.locator('.rv-row').nth(1);
assert.match(await p33row.innerText(), /עבר יותר מיומיים מהבקרה האחרונה[^]*הבקרה האחרונה: א׳ 20\.9/);
assert.equal(await thu.locator('.rv-row').first().locator('.rv-stale').count(), 0); // process 32 is daily, flagged elsewhere
// Irit's eleven topics are hers: in Ofir's personal profile her process keeps its one short line.
assert.equal(await thu.locator('.tp-list, .tp-row').count(), 0);
assert.equal(await thu.locator('.rv-row').first().locator('.rv-topics').count(), 1);
await shot('14-thursday-control', thu);

// The office day is Israel's on any device: at 01:30 on Thursday in Jerusalem a
// phone set to New York (still Wednesday 18:30 there) shows Thursday's pass.
const THU_NY = new Date('2026-09-23T22:30:00Z');
const nyCtx = await browser.newContext({ locale: 'he-IL', timezoneId: 'America/New_York', viewport: { width: 1280, height: 900 } });
// These checks walk the whole list of "המשימות שלי" ("תצוגה מלאה"); the short one is tests/roles-phone-e2e.mjs.
await nyCtx.addInitScript(() => { try { localStorage.setItem('astrateg.mine.full', 'on'); } catch { /* no storage */ } });
await nyCtx.clock.install({ time: THU_NY });
await nyCtx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
await nyCtx.addInitScript(fakeNotifications);
const ny = await nyCtx.newPage();
watch(ny);
await ny.goto(`${BASE}clients.html#mine`);
await ny.fill('#lg-email', USER.email);
await ny.fill('#lg-pass', 'correct-horse');
await ny.click('#lg-submit');
await ny.waitForSelector('#view-mine:not([hidden]) .wproc');
assert.equal(await ny.evaluate(() => new Date().getDay()), 3, 'the device thinks it is Wednesday');
assert.equal(await ny.locator('.g-thu .thu-card').count(), 1);
assert.match(await waText('#mine-tools .wa-link', ny), /הסיכום שלך ליום חמישי 24\.9:/);
await nyCtx.close();

// Once every client is summarised, the card leaves Ofir's list.
for (const c of db.clients.filter((x) => x.status === 'active' || x.status === 'ending')) {
  if (!db.client_status_notes.some((n) => n.client_id === c.id)) db.client_status_notes.push({ client_id: c.id, week: '2026-09-20', current: 'בבדיקה', missing: null, next: null, owner: null, due_on: null, by_email: 'ofir@astrateg.test', at: THU.toISOString() });
}
await thu.click('#btn-refresh');
await thu.waitForFunction((n) => document.querySelector('.status-progress')?.textContent.includes(`סוכמו ${n} מתוך ${n}`), inWorkN);
await thu.click('#tab-mine');
await thu.waitForSelector('#view-mine:not([hidden]) .wproc');
assert.equal(await thu.locator('.thu-card').count(), 0);
await thuCtx.close();

// ── Completing a process from "my work" ends its wait on the client (decision 3) ──
// Two new clients wait on the client in process 2 since 09:23 (due 09:25). Irit closes
// the last item of one with a single check, and the last two of the other in bulk.
db.staff[0].person = 'irit';
skew = (await page.evaluate(() => Date.now())) - Date.now(); // the server follows Tuesday's page clock again
const P2_ALL = [...P2, 'p02.team'];
const waitingIn2 = (name, open) => {
  const c = client({ name, deal_at: minsAgo(40) });
  for (const k of P1) check(c, k, minsAgo(39));
  for (const k of P2_ALL.filter((x) => !open.includes(x))) check(c, k, minsAgo(38));
  check(c, 'p02.wait', minsAgo(37), USER.email, 'done', JSON.stringify({ reason: 'הלקוח עוד לא הצטרף לקבוצה', recheck: null }));
  return c;
};
const single = waitingIn2('מאפה שקד', ['p02.m.client']);
const inBulk = waitingIn2('גלידת הנמל', ['p02.m.client', 'p02.m.ilai']);
const waitedOf2 = (c) => JSON.parse(db.protocol_checks.find((x) => x.client_id === c.id && x.item_key === 'p02.waited')?.note || 'null');
await page.goto('about:blank');
await page.goto(`${BASE}clients.html#mine`);
const singleCard = page.locator('.g-client .wproc:has(.wclient:text("מאפה שקד"))');
// A click, not check(): the item leaves the list once it is saved (check() would then act on the next one).
await singleCard.locator('.cbx').first().click();
await toastHas('סומן כבוצע: הלקוח בקבוצה');
assert.ok(!db.protocol_checks.some((x) => x.client_id === single.id && x.item_key === 'p02.wait'));
const w1 = waitedOf2(single);
assert.ok(w1 && w1.min >= 37 && w1.ext === w1.min, JSON.stringify(w1)); // began before the deadline: it all moves it
await page.locator('.g-client .wproc:has(.wclient:text("גלידת הנמל")) .bulk-btn').click();
await toastHas('סומנו 2 פריטים');
assert.ok(!db.protocol_checks.some((x) => x.client_id === inBulk.id && x.item_key === 'p02.wait'));
assert.ok(waitedOf2(inBulk)?.min >= 37, JSON.stringify(waitedOf2(inBulk)));

assert.deepEqual(errors, []);
await browser.close();
noCspViolations();
console.log('protocol office e2e: all checks passed');
