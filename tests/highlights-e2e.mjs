// End-to-end check of process 8ב (protocol version 7, the owner's decision of
// 6.10.2026), as Ofir, against an in-memory fake of Supabase: once the Highlights are
// prepared, a 30-minute office clock runs in his "עכשיו" bar and the upload is in his
// "המשימות שלי"; the client card shows the process with its checkbox; marking it stops
// the clock; a client that started before version 7 gets the same work, tagged "חדש
// בפרוטוקול" and never late; Highlights that were ready long ago (imported) ask nothing.
// The page clock starts on Monday 5.10.2026 13:05 in Jerusalem.
// Run: npx http-server -p 8109 -s -c-1 . &  then  BASE_URL=http://localhost:8109/ node tests/highlights-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { clockDigits } from '../app/clocks.js';
import { PROTOCOL_VERSION } from '../app/protocol.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-10-05T10:05:00Z'); // Monday 13:05 in Jerusalem
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const USER = { id: randomUUID(), email: 'ofir@astrateg.test', aud: 'authenticated', role: 'authenticated' };
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', exp: Math.floor(NOW / 1000) + 7 * 86400 })}.sig`;
const minsAgo = (n) => new Date(NOW - n * 6e4).toISOString();
const hoursAgo = (n) => new Date(NOW - n * 36e5).toISOString();

const db = {
  staff: [{ email: USER.email, person: 'ofir' }, { email: 'irit@astrateg.test', person: 'irit' }],
  quotes: [], clients: [], protocol_checks: [], protocol_log: [], client_tasks: [], office_reviews: [], client_status_notes: [],
};
const base = {
  business: null, phone: null, package_name: null, shoot_type: 'dms', characterizer: 'ofir', has_logo: true, editor_name: null,
  char_at: null, shoot_at: null, contract_end: '2027-10-01', status: 'active', notes: null, quote_id: null,
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: {}, rounds: [], verified_at: null, verified_by: null, closed_reason: null, address: null, editor: null,
  protocol_version: PROTOCOL_VERSION,
};
const client = (o) => { const c = { ...base, id: randomUUID(), deal_at: hoursAgo(72), char_at: hoursAgo(26), created_at: hoursAgo(72), ...o }; db.clients.push(c); return c; };
const check = (c, key, when, note = null) => db.protocol_checks.push({ client_id: c.id, item_key: key, state: 'done', note, by_email: USER.email, at: when });

// Highlights prepared at 12:50 and saved at 13:00: process 8 is complete, 8ב is due at 13:30.
const ron = client({ name: 'רון כהן', business: 'פיצה רון' });
check(ron, 'p08.done', minsAgo(15));
check(ron, 'p08.saved', minsAgo(5));
// The same, for a client that started under version 6.
const old = client({ name: 'קפה גליה', protocol_version: 6 });
check(old, 'p08.done', minsAgo(15));
check(old, 'p08.saved', minsAgo(5));
// Ready long ago: the migration marked the upload as imported history.
const past = client({ name: 'מאפיית אור', protocol_version: 6 });
check(past, 'p08.done', hoursAgo(24 * 9));
check(past, 'p08.saved', hoursAgo(24 * 9));
check(past, 'p08b.posted', hoursAgo(1), 'ייבוא');
// Prepared but not saved yet: process 8 is still open, 8ב has not started.
const half = client({ name: 'חנות הים' });
check(half, 'p08.done', minsAgo(15));

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
  if (p === '/auth/v1/token') return json(200, { access_token: JWT, token_type: 'bearer', expires_in: 7 * 86400, expires_at: Math.floor(NOW / 1000) + 7 * 86400, refresh_token: 'r', user: USER });
  if (p === '/auth/v1/user') return json(200, USER);
  const authed = (headers.authorization || '').includes(JWT);
  if (p === '/rest/v1/rpc/is_staff') return json(200, authed);
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { message: 'not found' });
  if (!authed) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  if (req.method() === 'GET') return reply(applyFilters(db[table], url.searchParams));
  if (req.method() === 'POST') {
    const out = [];
    for (const r of Array.isArray(body) ? body : [body]) {
      if (table !== 'protocol_checks') return json(405, { message: `unexpected write to ${table}` });
      const row = { ...r, by_email: USER.email, at: serverNow() };
      const i = db.protocol_checks.findIndex((x) => x.client_id === r.client_id && x.item_key === r.item_key);
      if (i >= 0) db.protocol_checks[i] = row; else db.protocol_checks.push(row);
      out.push(row);
    }
    return reply(out);
  }
  if (req.method() === 'DELETE') {
    const rows = applyFilters(db[table], url.searchParams);
    db[table] = db[table].filter((r) => !rows.includes(r));
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  return json(405, {});
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => { try { sessionStorage.setItem('astrateg.mine.full', 'on'); } catch { /* no storage */ } });
await ctx.clock.install({ time: NOW });
await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const shot = async (name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const step = async (name, fn) => { await fn(); console.log(`ok - ${name}`); };
const clockSel = (c) => `#now-bar .now-clock[data-clock^="soon:${c.id}:p08b"]`;
const TITLE = '8ב · העלאת ה־Highlights לרשתות';
const mineCard = (c) => page.locator(`#mine-list .wproc:has(.wclient:text("${c.business || c.name}")):has-text("${TITLE}")`);

await page.goto(`${BASE}clients.html#mine`);
await page.fill('#lg-email', USER.email);
await page.fill('#lg-pass', 'correct-horse');
await page.click('#lg-submit');
await page.waitForSelector('#view-mine:not([hidden]) #now-bar:not([hidden]) .now-clock');
const T0 = new Date(NOW.getTime() + 20_000);
await page.clock.pauseAt(T0);
await page.clock.runFor(1000);
const T1 = new Date(T0.getTime() + 1000);
const DUE = new Date('2026-10-05T10:30:00Z'); // 13:30

await step('Ofir\'s "עכשיו" bar: a running 30-minute clock for the upload, due 13:30', async () => {
  assert.match(await page.locator('#me-bar').innerText(), /אופיר/);
  const k = page.locator(clockSel(ron));
  assert.equal(await k.count(), 1);
  assert.equal(await k.getAttribute('data-state'), 'running');
  assert.equal(await k.locator('.now-left').innerText(), clockDigits(DUE - T1)); // 24:39
  assert.match(await k.innerText(), /נשארו[^]*פיצה רון[^]*העלאת ה־Highlights לרשתות[^]*תהליך 8ב · יעד היום 13:30/);
  // The older client has the same clock; imported history and an open process 8 have none.
  assert.equal(await page.locator(clockSel(old)).count(), 1);
  assert.equal(await page.locator(clockSel(past)).count(), 0);
  assert.equal(await page.locator(clockSel(half)).count(), 0);
  await shot('01-ofir-now-bar');
});

await step('"המשימות שלי": the upload is Ofir\'s work for both clients, with its item to mark', async () => {
  for (const c of [ron, old]) {
    assert.equal(await mineCard(c).count(), 1, c.name);
    assert.match(await mineCard(c).innerText(), /ה־Highlights הועלו לעמודי הלקוח ברשתות/);
  }
  assert.equal(await mineCard(past).count(), 0);
  assert.equal(await mineCard(half).count(), 0);
});

await step('the 30 minutes pass: the clock is red; the older client\'s process is not late', async () => {
  await page.clock.runFor(26 * 60_000);
  assert.equal(await page.locator(clockSel(ron)).getAttribute('data-state'), 'expired');
  assert.match(await page.locator(clockSel(ron)).innerText(), /נגמר לפני/);
  await page.reload();
  await page.waitForSelector('#view-mine:not([hidden]) #mine-list .wproc');
  assert.equal(await page.locator(`#mine-list .g-overdue .wproc:has(.wclient:text("פיצה רון")):has-text("${TITLE}")`).count(), 1);
  assert.equal(await page.locator(`#mine-list .g-overdue .wproc:has(.wclient:text("קפה גליה")):has-text("${TITLE}")`).count(), 0, 'new in the protocol for it: never late');
  assert.equal(await mineCard(old).count(), 1, 'still work to do');
  await shot('02-ofir-late');
});

await step('the client card: 8ב right after 8, with its words and a checkbox Ofir marks', async () => {
  await page.clock.resume(); // from here the page clock runs by itself (13:31 on)
  await page.goto(`${BASE}client.html?id=${ron.id}#p08b`);
  await page.waitForSelector('#p08b');
  // His own view lists it among his open processes, after the characterization's
  // (the finished process 8 is folded away); the whole protocol has it between 7ב and 9.
  const mine = await page.locator('.proc').evaluateAll((els) => els.map((e) => e.id));
  assert.deepEqual(mine.slice(0, 3), ['p04', 'p05', 'p08b'], mine.join(','));
  await page.click('#view-toggle');
  await page.waitForSelector('#p07b', { state: 'attached' });
  const ids = await page.locator('.proc').evaluateAll((els) => els.map((e) => e.id));
  assert.deepEqual(ids.slice(ids.indexOf('p07b'), ids.indexOf('p09') + 1), ['p07b', 'p08b', 'p09'], ids.join(','));
  await page.click('#view-toggle');
  await page.waitForSelector('#p07b', { state: 'detached' });
  const text = await page.locator('#p08b').innerText();
  assert.match(text, /8ב[^]*העלאת ה־Highlights לרשתות/);
  assert.match(text, /עד 30 דקות עבודה מרגע שה־Highlights הוכנו/);
  assert.match(text, /ה־Highlights הועלו לעמודי הלקוח ברשתות/);
  assert.equal(await page.locator('#p08b .tag-fresh').count(), 0);
  assert.equal(await page.isEnabled('#i-p08b-posted'), true);
  await shot('03-card-p08b');
  // One click marks it, and the process is done.
  await page.click('#i-p08b-posted');
  await page.waitForSelector('#p08b.s-done');
  assert.ok(db.protocol_checks.some((c) => c.client_id === ron.id && c.item_key === 'p08b.posted' && c.state === 'done'));
});

await step('a client from before version 7: the item is tagged "חדש בפרוטוקול (גרסה 7)"', async () => {
  await page.goto('about:blank');
  await page.goto(`${BASE}client.html?id=${old.id}#p08b`);
  await page.waitForSelector('#p08b');
  assert.equal(await page.locator('#p08b .tag-fresh').innerText(), 'חדש בפרוטוקול (גרסה 7) · לא נספר באיחור');
  // The imported one is done: nothing open to mark there.
  await page.goto('about:blank');
  await page.goto(`${BASE}client.html?id=${past.id}`);
  await page.waitForSelector('.proc');
  assert.equal(await page.locator('#p08b:not(.s-done)').count(), 0);
  assert.equal(await page.locator('#i-p08b-posted:not(:checked)').count(), 0);
});

await step('marked: the clock and the work are gone for that client', async () => {
  await page.goto(`${BASE}clients.html#mine`);
  await page.waitForSelector('#view-mine:not([hidden]) #mine-list .wproc');
  assert.equal(await page.locator(clockSel(ron)).count(), 0);
  assert.equal(await mineCard(ron).count(), 0);
  assert.equal(await mineCard(old).count(), 1);
});

assert.deepEqual(errors, []);
await browser.close();
noCspViolations();
console.log('highlights e2e: all checks passed');
