// End-to-end check of the office views on clients.html (batch 2): bulk marking,
// waiting on the client, morning summary, notifications, daily reviews,
// performance and auto-opened clients, against an in-memory fake of Supabase.
// The page clock is fixed to Tuesday 22.9.2026 10:00 (Jerusalem), the day after Yom Kippur.
// Run: npx http-server -p 8080 . &  then  node tests/protocol-office-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-09-22T07:00:00Z'); // 10:00 in Jerusalem
let skew = NOW.getTime() - Date.now();        // server time follows the page clock
const serverNow = () => new Date(Date.now() + skew).toISOString();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const USER = { id: randomUUID(), email: 'irit@astrateg.test', aud: 'authenticated', role: 'authenticated' };
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', exp: Math.floor(NOW / 1000) + 86400 })}.sig`;

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
};
let failNextCheck = false;

const base = {
  business: null, phone: null, package_name: null, shoot_type: null, characterizer: null, has_logo: null, editor_name: null,
  char_at: null, shoot_at: null, contract_end: '2027-09-20', status: 'active', notes: null, quote_id: null,
  created_by_email: USER.email, links: {}, deliverables: {}, rounds: [], verified_at: null, verified_by: null, closed_reason: null, address: null,
};
const client = (o) => { const c = { ...base, id: randomUUID(), created_at: o.deal_at, ...o }; db.clients.push(c); return c; };
const check = (c, key, when, by = 'ofir@astrateg.test', state = 'done', note = null) => {
  db.protocol_checks.push({ client_id: c.id, item_key: key, state, note, by_email: by, at: when });
  db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: c.id, item_key: key, action: state, note, by_email: by, at: when });
};
const P1 = ['p01.prepared', 'p01.sent', 'p01.signed'];
const P2 = ['p02.opened', 'p02.m.lior', 'p02.m.irit', 'p02.m.ofir', 'p02.m.shirel', 'p02.m.ilai', 'p02.m.client', 'p02.intro'];
const P3 = ['p03.who', 'p03.scheduled'];
const P4 = ['p04.address', 'p04.phone', 'p04.services', 'p04.audiences', 'p04.advantages', 'p04.goals', 'p04.offers', 'p04.content', 'p04.graphics', 'p04.campaigns', 'p04.special', 'p04.saved'];

// Mid-way client with a second shoot round.
const seeded = client({ name: 'מספרת רון', business: 'רון עיצוב שיער', phone: '052-7654321', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  deal_at: hoursAgo(80), char_at: hoursAgo(50), shoot_at: new Date(NOW.getTime() + 2 * 864e5).toISOString(),
  rounds: [{ n: 2, shoot_type: 'dms', shoot_at: null, start_at: hoursAgo(30) }] });
for (const k of [...P1, ...P2, ...P3, ...P4, 'p05.access', 'p05.logo', 'p05.colors', 'p05.photos', 'p05.videos']) check(seeded, k, hoursAgo(49));
// Just in, WhatsApp group opened already by Ofir: Irit's bulk button offers the other 7.
const fresh = client({ name: 'פיצה נאפולי', deal_at: hoursAgo(3) });
check(fresh, 'p02.opened', hoursAgo(1));
// Waiting on the client for access since last Wednesday; recheck is today.
const waiting = client({ name: 'קפה גליה', phone: '054-1112233', characterizer: 'shirel', deal_at: hoursAgo(24 * 8), char_at: hoursAgo(24 * 7) });
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
    return json(200, { access_token: JWT, token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(NOW / 1000) + 86400, refresh_token: 'r', user: USER });
  }
  if (p === '/auth/v1/user') return json(200, USER);
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  const authed = (headers.authorization || '').includes(JWT);
  if (p === '/rest/v1/rpc/is_staff') return json(200, authed);
  if (p === '/rest/v1/rpc/set_my_person') { db.staff[0].person = body.p_person; return json(200, null); }
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
      } else if (table === 'office_reviews') {
        const row = { note: null, ...r, by_email: USER.email, at: now };
        const i = db.office_reviews.findIndex((x) => x.day === r.day && x.kind === r.kind);
        if (i >= 0) db.office_reviews[i] = row; else db.office_reviews.push(row);
        out.push(row);
      } else {
        const row = { ...r, id: randomUUID(), created_at: now, created_by_email: USER.email };
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
await ctx.clock.install({ time: NOW });
await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', fakeSupabase);
await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>wa</p>' }));
await ctx.addInitScript(fakeNotifications);
const page = await ctx.newPage();
const errors = [];
const watch = (pg) => {
  pg.on('pageerror', (e) => errors.push(String(e)));
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

// ── §1 bulk: 7 of Irit's items in process 2 of the fresh client, then undo ──
const p2card = page.locator('.wproc:has(.wclient:text("פיצה נאפולי")):has-text("פתיחת קבוצת WhatsApp")');
assert.equal(await p2card.locator('.bulk-btn').innerText(), 'סימון כל התהליך כבוצע (7)');
assert.equal(await p2card.locator('.bulk-btn').getAttribute('aria-label'), 'סימון 7 פריטים כבוצעו בתהליך 2 · פתיחת קבוצת WhatsApp');
// A failed save marks nothing.
failNextCheck = true;
await p2card.locator('.bulk-btn').click();
await toastHas('אף פריט לא סומן');
assert.equal(db.protocol_checks.filter((c) => c.client_id === fresh.id).length, 1);
await p2card.locator('.bulk-btn').click();
await toastHas('סומנו 7 פריטים בתהליך 2 · פתיחת קבוצת WhatsApp.');
assert.equal(db.protocol_checks.filter((c) => c.client_id === fresh.id && c.item_key.startsWith('p02.')).length, 8);
assert.equal(await page.locator('.wproc:has(.wclient:text("פיצה נאפולי")):has-text("פתיחת קבוצת WhatsApp")').count(), 0);
await page.click('.toast-act');
await toastHas('הסימון של 7 הפריטים בוטל.');
// Undo removes only what the bulk action marked: Ofir's earlier check stays.
assert.deepEqual(db.protocol_checks.filter((c) => c.client_id === fresh.id).map((c) => c.item_key), ['p02.opened']);
await page.waitForSelector('.wproc:has(.wclient:text("פיצה נאפולי")) .bulk-btn');
// Process 3 has two open items of Irit's, so it gets the button too.
assert.equal(await page.locator('.wproc:has(.wclient:text("פיצה נאפולי")):has-text("קביעת פגישת אפיון") .bulk-btn').innerText(), 'סימון כל התהליך כבוצע (2)');

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
await toastHas('ההמתנה הסתיימה. התהליך חוזר לחישוב הרגיל.');
assert.ok(!db.protocol_checks.some((c) => c.client_id === fresh.id && c.item_key === 'p03.wait'));

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
// Irit marks her review; Ofir's she marks on his behalf.
await page.check('#rv-p32');
await toastHas('הבקרה של היום סומנה.');
assert.ok(db.office_reviews.some((r) => r.day === '2026-09-22' && r.kind === 'p32' && r.by_email === USER.email));
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
await page.click('#tab-performance');
await page.waitForSelector('.perf-table');
assert.equal(new URL(page.url()).hash, '#performance');
const perf = await page.locator('#performance').innerText();
assert.match(await page.locator('.perf-table tr:has-text("1 · הכנת חוזה")').innerText(), /\d+ מתוך \d+ \(\d+%\)/);
assert.match(await page.locator('.perf-table tr:has-text("3 · קביעת פגישת אפיון")').innerText(), /מעט מדי נתונים \(2\)/);
assert.match(perf, /הנתונים שלי/);
assert.match(perf, /אחוז נמוך בתהליך הוא קודם כול סימן לבדוק את התהליך או את היעד/);
const people = await page.locator('.perf-team tbody tr td:first-child').allInnerTexts();
assert.deepEqual(people, ['עירית', 'ליאור', 'אופיר', 'שיראל', 'עילאי', 'עורך']);
await page.click('#performance .chip:text("90 הימים האחרונים")');
await page.waitForSelector('#performance .chip[aria-pressed="true"]:text("90")');
await page.waitForSelector('.perf-team tbody tr');
assert.deepEqual(await page.locator('.perf-team tbody tr td:first-child').allInnerTexts(), people);
await shot('04-performance');
// Arrow keys reach the new tab.
await page.focus('#tab-performance');
await page.keyboard.press('Home');
assert.equal(await page.getAttribute('#tab-mine', 'aria-selected'), 'true');
await page.keyboard.press('End');
assert.equal(await page.getAttribute('#tab-performance', 'aria-selected'), 'true');

// ── §6b notifications: asked only on click; one per process; none on first load ──
await page.click('#tab-mine');
await page.click('#btn-notify');
await page.waitForSelector('.notify-row:has-text("התראות איחור פעילות בדפדפן הזה.")');
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
const late = notes.filter((n) => n.title === 'באיחור: גלידה בנמל' && n.body.startsWith('תהליך 1 '));
assert.equal(late.length, 1, JSON.stringify(notes));
assert.match(late[0].body, /^תהליך 1 · הכנת חוזה\. היעד היה היום 10:\d\d\.$/);
assert.ok(!notes.some((n) => /קפה גליה/.test(n.title)), 'no notification for waiting on the client');
await page.evaluate(() => { delete document.hidden; });
assert.ok(soon);

// ── Lior: no team table ──
db.staff[0].person = 'lior';
await page.reload();
await page.waitForSelector('#app:not([hidden])');
await page.click('#tab-performance');
await page.waitForSelector('.perf-table');
assert.equal(await page.locator('.perf-team').count(), 0);
assert.deepEqual(await page.locator('.perf-me tbody td:first-child').allInnerTexts(), ['ליאור']);
// Not Irit: the bulk button follows "me", never the person being viewed.
await page.click('#tab-mine');
await page.click('#mine-people .chip:has-text("עירית")');
await page.waitForSelector('.wproc:has(.wclient:text("פיצה נאפולי"))');
assert.equal(await page.locator('.wproc:has(.wclient:text("פיצה נאפולי")) .bulk-btn').count(), 0);
assert.equal(await page.locator('.auto-banner').count(), 1); // Irit's view shows the banner
db.staff[0].person = 'irit';

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

assert.deepEqual(errors, []);
await browser.close();
console.log('protocol office e2e: all checks passed');
