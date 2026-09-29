// End-to-end check of the "now" bar at the top of "my work" (clients.html,
// app/now-bar.js): live countdowns, "the client did not answer" with its two
// buttons, the answer mark with undo (also before the time is up), clocks
// running out while the page is open (read out; with notifications on, a toast
// on another tab or one notification per row), a 360px phone, and Chrome on
// Android, where only a service worker may notify. Against an in-memory fake of
// Supabase; the page clock starts on Monday 5.10.2026 10:00 in Jerusalem and is
// then driven by the test.
// Run: npx http-server -p 8080 -s . &  then  node tests/now-bar-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { clockDigits } from '../app/clocks.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-10-05T07:00:00Z'); // Monday 10:00 in Jerusalem
const skew = NOW.getTime() - Date.now();      // server time starts with the page clock
const serverNow = () => new Date(Date.now() + skew).toISOString();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const USER = { id: randomUUID(), email: 'irit@astrateg.test', aud: 'authenticated', role: 'authenticated' };
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', exp: Math.floor(NOW / 1000) + 7 * 86400 })}.sig`;
const minsAgo = (n) => new Date(NOW - n * 6e4).toISOString();
const hoursAgo = (n) => new Date(NOW - n * 36e5).toISOString();

const db = {
  staff: [{ email: USER.email, person: 'irit' }, { email: 'ofir@astrateg.test', person: 'ofir' }],
  quotes: [], clients: [], protocol_checks: [], protocol_log: [], client_tasks: [], office_reviews: [], client_status_notes: [],
};
const base = {
  business: null, phone: null, package_name: null, shoot_type: 'dms', characterizer: 'ofir', has_logo: true, editor_name: null,
  char_at: null, shoot_at: null, contract_end: '2027-10-01', status: 'active', notes: null, quote_id: null,
  created_by_email: USER.email, links: {}, deliverables: {}, rounds: [], verified_at: null, verified_by: null, closed_reason: null, address: null, editor: null,
};
const client = (o) => { const c = { ...base, id: randomUUID(), created_at: o.deal_at, ...o }; db.clients.push(c); return c; };
const check = (c, key, when, by = USER.email) => db.protocol_checks.push({ client_id: c.id, item_key: key, state: 'done', note: null, by_email: by, at: when });
const P123 = ['p01.prepared', 'p01.sent', 'p01.signed', 'p02.opened', 'p02.m.lior', 'p02.m.irit', 'p02.m.ofir', 'p02.m.ilai', 'p02.m.client', 'p02.intro', 'p02.deal', 'p02.team',
  'p03.who', 'p03.available', 'p03.scheduled', 'p03.calendar'];
const onboarded = (o) => { const c = client({ deal_at: hoursAgo(72), char_at: hoursAgo(48), ...o }); for (const k of P123) check(c, k, hoursAgo(71)); return c; };

// A new deal two minutes ago: contract, group and characterization date, due 10:03.
const deal = client({ name: 'פיצה נאפולי', deal_at: minsAgo(2), shoot_type: null, characterizer: null, has_logo: null });
// The 9 graphics went out at 09:48: ten minutes passed, the client did not answer.
const gallia = onboarded({ name: 'קפה גליה', phone: '054-1112233' });
check(gallia, 'p07.sent', minsAgo(12));
// The videos went out at 09:57:30: five minutes, until 10:02:30.
const ron = onboarded({ name: 'מספרת רון', phone: '052-7654321' });
check(ron, 'p26.sent', minsAgo(2.5));
// The 9 graphics went out at 09:57: running until 10:07; the client answers in time.
const ohr = onboarded({ name: 'מאפיית אור' });
check(ohr, 'p07.sent', minsAgo(3));
// Answered already: no clock.
const quiet = onboarded({ name: 'סטודיו שקט', phone: '050-0000000' });
check(quiet, 'p07.sent', minsAgo(20));
check(quiet, 'p07.answered', minsAgo(15));
// Ofir's meeting at 08:40: Irit's follow-up (4) and the vault (5) are due at 10:40, within the hour.
const sea = onboarded({ name: 'חנות הים', char_at: minsAgo(80) });

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
let failNextCheck = false;
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
    return json(200, { access_token: JWT, token_type: 'bearer', expires_in: 7 * 86400, expires_at: Math.floor(NOW / 1000) + 7 * 86400, refresh_token: 'r', user: USER });
  }
  if (p === '/auth/v1/user') return json(200, USER);
  const authed = (headers.authorization || '').includes(JWT);
  if (p === '/rest/v1/rpc/is_staff') return json(200, authed);
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { message: 'not found' });
  if (!authed) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  const now = serverNow();
  if (req.method() === 'GET') return reply(applyFilters(db[table], url.searchParams));
  if (req.method() === 'POST') {
    if (table === 'protocol_checks' && failNextCheck) { failNextCheck = false; return json(500, { message: 'Failed to fetch' }); }
    const out = [];
    for (const r of Array.isArray(body) ? body : [body]) {
      if (table !== 'protocol_checks') return json(405, { message: `unexpected write to ${table}` });
      const row = { ...r, by_email: USER.email, at: now };
      const i = db.protocol_checks.findIndex((x) => x.client_id === r.client_id && x.item_key === r.item_key);
      if (i >= 0) db.protocol_checks[i] = row; else db.protocol_checks.push(row);
      db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: r.state, note: r.note, by_email: USER.email, at: now });
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

// A fake Notification API that remembers what was shown.
const fakeNotifications = () => {
  window.__notes = [];
  class FakeNotification {
    constructor(title, opts = {}) { window.__notes.push({ title, body: opts.body }); }
    static get permission() { return localStorage.getItem('fake.perm') || 'default'; }
    static async requestPermission() { localStorage.setItem('fake.perm', 'granted'); return 'granted'; }
    close() {}
  }
  window.Notification = FakeNotification;
};

// Every toast and every read-out text, in order (a toast lasts seconds).
const recordSaid = () => {
  window.__toasts = [];
  window.__said = [];
  document.addEventListener('DOMContentLoaded', () => {
    const watchText = (id, list) => {
      const el = document.getElementById(id);
      if (el) new MutationObserver(() => { if (el.textContent) list.push(el.textContent); }).observe(el, { childList: true, subtree: true });
    };
    watchText('toast', window.__toasts);
    watchText('now-live', window.__said);
  });
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 1280, height: 900 } });
await ctx.clock.install({ time: NOW });
await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', fakeSupabase);
await ctx.addInitScript(fakeNotifications);
await ctx.addInitScript(recordSaid);
const page = await ctx.newPage();
const errors = [];
const watch = (pg) => {
  pg.on('pageerror', (e) => errors.push(String(e)));
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
};
watch(page);
// The whole page, and the bar alone (readable at full size).
const shot = async (name, pg = page) => {
  if (!OUT) return;
  await pg.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  if (await pg.locator('#now-bar:not([hidden])').count()) await pg.locator('#now-bar').screenshot({ path: `${OUT}/${name}-bar.png` });
};
const noHScroll = async (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const toastHas = (text) => page.waitForFunction((t) => document.querySelector('#toast.on')?.textContent.includes(t), text);
const clockSel = (kind, c, proc) => `#now-bar .now-clock[data-clock^="${kind}:${c.id}:${proc}"]`;
const left = (sel, pg = page) => pg.locator(`${sel} .now-left`).innerText();

await page.goto(`${BASE}clients.html`);
await page.fill('#lg-email', USER.email);
await page.fill('#lg-pass', 'correct-horse');
await page.click('#lg-submit');
await page.waitForSelector('#view-mine:not([hidden]) #now-bar:not([hidden]) .now-clock');
// From here the test moves the page clock by hand.
const T0 = new Date(NOW.getTime() + 20_000);
await page.clock.pauseAt(T0);
await page.clock.runFor(1000); // let the countdowns catch up with the paused clock
const T1 = new Date(T0.getTime() + 1000);

// ── The bar: first in "my work", most urgent first, the right time left ──
assert.equal(await page.locator('#view-mine > *').first().getAttribute('id'), 'now-bar');
assert.match(await page.locator('#now-h').innerText(), /^עכשיו\s*5$/);
const order = await page.locator('#now-bar .now-clock').evaluateAll((els) => els.map((e) => `${e.dataset.clock.split(':')[0]}:${e.querySelector('.now-client').textContent}:${e.dataset.state}`));
// The new deal's three clocks end together: one row. So do the two processes due at 10:40.
assert.deepEqual(order, ['answer:קפה גליה:expired', 'answer:מספרת רון:running', 'deal:פיצה נאפולי:running', 'answer:מאפיית אור:running', 'soon:חנות הים:running']);
assert.equal(await page.locator(`#now-bar .now-clock[data-clock*="${quiet.id}"]`).count(), 0, 'an answered sending has no clock');
const dealDue = new Date(new Date(deal.deal_at).getTime() + 5 * 6e4); // 10:03:00
const ronDue = new Date(NOW.getTime() + 2.5 * 6e4);                   // 10:02:30
assert.equal(await left(clockSel('deal', deal, 'p01')), clockDigits(dealDue - T1)); // 2:39
assert.match(await page.locator(clockSel('deal', deal, 'p01')).innerText(), /נשארו[^]*פיצה נאפולי[^]*עסקה חדשה: חוזה, קבוצה ומועד אפיון[^]*תהליכים 1, 2, 3 · יעד היום 10:03/);
assert.equal(await left(clockSel('answer', ron, 'p26')), clockDigits(ronDue - T1)); // 2:09
assert.match(await page.locator(clockSel('answer', ron, 'p26')).innerText(), /נשלח ללקוח: הסרטונים[^]*תהליך 26 · נשלח היום 09:57 · אם אין תשובה עד היום 10:02, מתקשרים/);
assert.equal(await left(clockSel('soon', sea, 'p04')), clockDigits(40 * 6e4 - 21_000)); // 39:39
assert.match(await page.locator(clockSel('soon', sea, 'p04')).innerText(), /ביצוע פגישת אפיון ולקיחת גישות לרשתות[^]*תהליכים 4, 5 · יעד היום 10:40/);
// The seconds are a timer (never read out every second); running out is said at once.
assert.equal(await page.locator('#now-bar .now-time[role="timer"]').count(), 5);
assert.equal(await page.getAttribute('#now-live', 'aria-live'), 'assertive');
await shot('01-now-bar');

// ── Live: every second, only the countdown changes; focus stays where it is ──
await page.locator(clockSel('deal', deal, 'p01')).evaluate((el) => { el.__same = true; });
const listCard = await page.locator('#mine-list .wproc').first().elementHandle();
await page.locator('#mine-list .cbx').first().focus();
const focused = await page.evaluate(() => document.activeElement.id);
assert.ok(focused);
await page.clock.runFor(3000);
assert.equal(await left(clockSel('deal', deal, 'p01')), clockDigits(dealDue - T1 - 3000));
assert.equal(await page.locator(clockSel('deal', deal, 'p01')).evaluate((el) => el.__same === true), true, 'the clock was not rebuilt');
assert.equal(await listCard.evaluate((el) => el.isConnected), true, 'the list was not rebuilt');
assert.equal(await page.evaluate(() => document.activeElement.id), focused, 'focus stays');

// ── "The client did not answer": two big buttons ──
const gal = page.locator(clockSel('answer', gallia, 'p07'));
assert.match(await gal.innerText(), /נגמר לפני[^]*קפה גליה[^]*הלקוח לא ענה: 9 הגרפיקות הראשונות[^]*תהליך 7 · נשלח היום 09:48 · עברו 10 דקות בלי תשובה/);
assert.equal(await gal.locator('.now-answered').innerText(), 'הלקוח ענה');
assert.equal(await gal.locator('.now-call').getAttribute('href'), 'tel:0541112233');
assert.match(await gal.locator('.now-call').innerText(), /להתקשר\s*054-1112233/);
for (const b of [gal.locator('.now-answered'), gal.locator('.now-call')]) assert.ok((await b.boundingBox()).height >= 44);
// "Call" only where the time is up; a running one has a small "the client answered".
assert.equal(await page.locator('#now-bar .now-call').count(), 1);
assert.deepEqual(await page.locator('#now-bar .now-answered').evaluateAll((els) => els.map((e) => `${e.closest('.now-clock').dataset.state}:${e.classList.contains('btn-sm')}`)),
  ['expired:false', 'running:true', 'running:true']);

// A failed save marks nothing and keeps the clock.
failNextCheck = true;
await gal.locator('.now-answered').click();
await toastHas('הסימון לא נשמר');
assert.equal(await gal.count(), 1);
assert.ok(!db.protocol_checks.some((c) => c.client_id === gallia.id && c.item_key === 'p07.answered'));
// "The client answered": the mark is written, the clock leaves, focus moves on to the next clock.
await gal.locator('.now-answered').click();
await toastHas('סומן שהלקוח ענה: קפה גליה · 9 הגרפיקות הראשונות.');
assert.ok(db.protocol_checks.some((c) => c.client_id === gallia.id && c.item_key === 'p07.answered' && c.state === 'done'));
assert.equal(await gal.count(), 0);
assert.equal(await page.evaluate(() => document.activeElement.closest('.now-clock')?.querySelector('.now-client')?.textContent), 'מספרת רון');
// Undo brings it back.
await page.click('#toast .toast-act');
await toastHas('הסימון בוטל. השעון חזר לפס.');
assert.ok(!db.protocol_checks.some((c) => c.client_id === gallia.id && c.item_key === 'p07.answered'));
await gal.waitFor();
assert.equal(await page.evaluate(() => document.activeElement.textContent), 'הלקוח ענה');
await gal.locator('.now-answered').click();
await toastHas('סומן שהלקוח ענה');
assert.equal(await gal.count(), 0);
assert.match(await page.locator('#now-h').innerText(), /^עכשיו\s*4$/);

// ── The client answered in time: the running clock stops, no alarm follows ──
const ohrClock = page.locator(clockSel('answer', ohr, 'p07'));
assert.equal(await ohrClock.getAttribute('data-state'), 'running');
assert.equal(await ohrClock.locator('.now-call').count(), 0);
assert.ok((await ohrClock.locator('.now-answered').boundingBox()).height >= 44);
await ohrClock.locator('.now-answered').click();
await toastHas('סומן שהלקוח ענה: מאפיית אור · 9 הגרפיקות הראשונות.');
assert.ok(db.protocol_checks.some((c) => c.client_id === ohr.id && c.item_key === 'p07.answered' && c.state === 'done'));
assert.equal(await ohrClock.count(), 0);
assert.match(await page.locator('#now-h').innerText(), /^עכשיו\s*3$/);

// ── A clock runs out while the page is open ──
// The videos' five minutes end at 10:02:30: red in place, its buttons, read out.
// "The client answered" is the same button, grown: if it had focus, it keeps it.
const ronClock = page.locator(clockSel('answer', ron, 'p26'));
await ronClock.locator('.now-answered').focus();
await page.clock.runFor(ronDue - (T1.getTime() + 3000) + 1000);
await ronClock.locator('.now-call').waitFor();
assert.equal(await ronClock.getAttribute('data-state'), 'expired');
assert.equal(await page.evaluate(() => document.activeElement.textContent), 'הלקוח ענה');
assert.equal(await page.evaluate(() => document.activeElement.closest('.now-clock')?.querySelector('.now-client')?.textContent), 'מספרת רון');
assert.equal(await ronClock.locator('.now-answered.btn-sm').count(), 0);
assert.equal(await ronClock.locator('.now-answered, .now-call').count(), 2);
assert.match(await ronClock.innerText(), /נגמר לפני[^]*הלקוח לא ענה: הסרטונים[^]*עברו 5 דקות בלי תשובה/);
assert.equal(await ronClock.locator('.now-call').getAttribute('href'), 'tel:0527654321');
assert.equal(await page.locator('#now-live').innerText(), 'הלקוח לא ענה: מספרת רון. הסרטונים (תהליך 26). עברו 5 דקות בלי תשובה: להתקשר.');
await shot('02-ran-out');

// Notifications on (asked earlier, on a click). On another tab of the page, in
// front: the new deal's clocks run out at 10:03 with one toast for the row, not
// three, and not again when the three processes turn overdue a minute later.
await page.evaluate(() => { localStorage.setItem('fake.perm', 'granted'); localStorage.setItem('astrateg.notify', 'on'); document.hasFocus = () => true; });
await page.click('#tab-clients');
await page.clock.runFor(dealDue - (ronDue.getTime() + 1000) + 1000);
await toastHas('נגמר הזמן: פיצה נאפולי · עסקה חדשה: חוזה, קבוצה ומועד אפיון (תהליכים 1, 2, 3).');
assert.equal(await page.locator('#toast .toast-act').innerText(), 'מעבר');
assert.deepEqual(await page.evaluate(() => window.__notes), []);
await page.clock.runFor(3 * 60e3);
const toasts = await page.evaluate(() => window.__toasts);
assert.equal(toasts.filter((t) => t.includes('פיצה נאפולי') && !t.startsWith('סומן')).length, 1, JSON.stringify(toasts));
// The toast is a live region: said once, not twice.
assert.ok(!(await page.evaluate(() => window.__said)).some((t) => t.includes('פיצה נאפולי')));

// The page in the background: the two processes of "חנות הים" due at 10:40 run
// out: one notification for the row, none when they turn overdue.
await page.click('#tab-mine');
await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
const seaDue = new Date(NOW.getTime() + 40 * 6e4);
await page.clock.runFor(seaDue - (dealDue.getTime() + 1000 + 3 * 60e3) + 3 * 60e3);
const notes = await page.evaluate(() => window.__notes);
const seaNotes = notes.filter((n) => n.title.includes('חנות הים'));
assert.equal(seaNotes.length, 1, JSON.stringify(notes));
assert.match(seaNotes[0].title, /^נגמר הזמן: חנות הים$/);
assert.match(seaNotes[0].body, /\(תהליכים 4, 5\)\.$/);
assert.equal(new Set(notes.map((n) => `${n.title}|${n.body}`)).size, notes.length, 'no notification twice');
// Nothing about what was already said or answered in time.
assert.ok(!notes.some((n) => /פיצה נאפולי|מאפיית אור|קפה גליה/.test(n.title)), JSON.stringify(notes));
assert.ok(!(await page.evaluate(() => [...window.__said, ...window.__toasts])).some((t) => t.includes('מאפיית אור') && !t.startsWith('סומן')));
await page.evaluate(() => { delete document.hidden; });
await page.clock.runFor(1000);
assert.equal(await page.locator(clockSel('deal', deal, 'p01')).getAttribute('data-state'), 'expired');
assert.match(await page.locator(clockSel('deal', deal, 'p01')).innerText(), /נגמר לפני[^]*עסקה חדשה: חוזה, קבוצה ומועד אפיון/);
assert.equal(await page.locator(clockSel('soon', sea, 'p04')).getAttribute('data-state'), 'expired');
// Read out once, for the row.
assert.match(await page.locator('#now-live').innerText(), /^נגמר הזמן: חנות הים\. .*\(תהליכים 4, 5\)\.$/);
// A clock that was already red when the page opened is not "new": nothing on load.
await page.clock.resume();
await page.reload();
await page.waitForSelector('#now-bar .now-clock');
await page.clock.runFor(2000);
assert.deepEqual(await page.evaluate(() => window.__notes), []);
assert.equal(await page.locator('#now-live').innerText(), '');
// The answer mark is in the client's history, in words.
await page.goto(`${BASE}client.html?id=${gallia.id}`);
await page.waitForSelector('#hist-list li');
assert.match(await page.locator('#hist-list').innerText(), /סימן\/ה שהלקוח ענה \(תהליך 7\)/);

// ── A phone, 360px ──
const mob = await ctx.newPage();
watch(mob);
await mob.setViewportSize({ width: 360, height: 780 });
await mob.goto(`${BASE}clients.html#mine`);
await mob.waitForSelector('#now-bar .now-clock .now-answered');
assert.ok(await noHScroll(mob), 'the bar scrolls sideways at 360px');
for (const sel of ['.now-answered', '.now-call', '.now-client']) {
  const box = await mob.locator(`#now-bar ${sel}`).first().boundingBox();
  assert.ok(box.height >= 44, `${sel} ${box.height}px high`);
  assert.ok(box.x >= 0 && box.x + box.width <= 360, `${sel} fits: ${box.x}+${box.width}`);
}
// The two buttons of a clock, one under the other.
const [a, b] = await Promise.all([mob.locator('#now-bar .now-answered').first().boundingBox(), mob.locator('#now-bar .now-call').first().boundingBox()]);
assert.ok(b.y >= a.y + a.height, 'stacked on a phone');
await shot('03-phone', mob);
await mob.close();

// ── Whose clocks: the owner sees everyone's, with their names; Ilai only his ──
db.staff[0].person = null;
await page.goto(`${BASE}clients.html#mine`); // the owner's own landing is owner.html
await page.waitForSelector('#now-bar .now-clock');
assert.match(await page.locator('.now-hint').innerText(), /אצל הצוות/);
assert.match(await page.locator(clockSel('answer', ron, 'p26')).locator('.pchips').innerText(), /עירית/);
assert.match(await page.locator(clockSel('deal', deal, 'p01')).locator('.pchips').innerText(), /עירית[^]*ליאור/); // Lior has items in process 2
assert.ok(await page.locator('#now-bar .now-clock').count() >= 3);
db.staff[0].person = 'ilai';
await page.goto('about:blank');
await page.goto(`${BASE}clients.html`);
await page.waitForSelector('#view-mine:not([hidden]) .wproc');
assert.match(await page.locator('#me-bar').innerText(), /עילאי/);
// His one clock: the sea shop's annual Gantt (process 9), due 10:45.
assert.deepEqual(await page.locator('#now-bar .now-clock').evaluateAll((els) => els.map((e) => e.dataset.clock)), [`soon:${sea.id}:p09`]);
// No clock of his at all: no bar.
sea.status = 'ended';
await page.reload();
await page.waitForSelector('#view-mine:not([hidden]) .wproc');
assert.equal(await page.isHidden('#now-bar'), true);
sea.status = 'active';
db.staff[0].person = 'irit';

// ── A deadline that is not a clock still alerts when it turns overdue ──
// Lior's shoot day is due by the end of the day (never a clock in the bar).
// The page is open from 23:57:30 in the background, notifications on; once the
// day is over, the overdue check alerts it, once.
const shootDay = onboarded({ name: 'בית קפה צילום', shoot_at: '2026-10-05T07:00:00Z' });
db.staff[0].person = 'lior';
const nightCtx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 1280, height: 900 } });
await nightCtx.clock.install({ time: new Date('2026-10-05T20:57:30Z') });
await nightCtx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', fakeSupabase);
await nightCtx.addInitScript(fakeNotifications);
await nightCtx.addInitScript(() => { try { localStorage.setItem('fake.perm', 'granted'); localStorage.setItem('astrateg.notify', 'on'); } catch { /* about:blank */ } });
const night = await nightCtx.newPage();
watch(night);
await night.goto(`${BASE}clients.html`);
await night.fill('#lg-email', USER.email);
await night.fill('#lg-pass', 'correct-horse');
await night.click('#lg-submit');
await night.waitForSelector('#view-mine:not([hidden]) .wproc');
assert.equal(await night.locator(`#now-bar .now-clock[data-clock*="${shootDay.id}"]`).count(), 0);
await night.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
await night.clock.runFor(3 * 60e3);
const nightNotes = await night.evaluate(() => window.__notes);
const p18 = nightNotes.filter((n) => n.title === 'באיחור: בית קפה צילום' && n.body.startsWith('תהליך 18 '));
assert.equal(p18.length, 1, JSON.stringify(nightNotes));
assert.match(p18[0].body, /^תהליך 18 · ניהול יום הצילום והתסריטים\. היעד היה /);
assert.equal(new Set(nightNotes.map((n) => `${n.title}|${n.body}`)).size, nightNotes.length, 'no notification twice');
await nightCtx.close();
db.staff[0].person = 'irit';
shootDay.status = 'ended';

// ── Chrome on Android: `new Notification` throws; a service worker shows it ──
// The page opens at 10:02 on a phone, with notifications on; the videos' clock
// of "מספרת רון" runs out at 10:02:30 while the page is in the background.
const androidNotifications = () => {
  window.__swNotes = [];
  class AndroidNotification {
    constructor() { throw new TypeError("Failed to construct 'Notification': Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead."); }
    static get permission() { return 'granted'; }
    static async requestPermission() { return 'granted'; }
  }
  window.Notification = AndroidNotification;
  ServiceWorkerRegistration.prototype.showNotification = function showNotification(title, opts = {}) {
    window.__swNotes.push({ title, body: opts.body, tag: opts.tag, href: opts.data?.href, scope: this.scope, state: this.active?.state });
    return Promise.resolve();
  };
  try { localStorage.setItem('astrateg.notify', 'on'); } catch { /* about:blank */ }
};
const droidCtx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
await droidCtx.clock.install({ time: new Date(NOW.getTime() + 2 * 6e4) });
await droidCtx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', fakeSupabase);
await droidCtx.addInitScript(androidNotifications);
const droid = await droidCtx.newPage();
watch(droid);
await droid.goto(`${BASE}clients.html`);
await droid.fill('#lg-email', USER.email);
await droid.fill('#lg-pass', 'correct-horse');
await droid.click('#lg-submit');
await droid.waitForSelector(`${clockSel('answer', ron, 'p26')}[data-state="running"]`);
assert.match(await droid.locator('.notify-row').innerText(), /התראות על איחורים ועל לקוח שלא ענה פעילות בדפדפן הזה/);
// A running "did not answer" on a phone: the small button fits, 44px high.
assert.ok(await noHScroll(droid), 'the bar scrolls sideways at 360px');
const smallBox = await droid.locator(`${clockSel('answer', ron, 'p26')} .now-answered.btn-sm`).boundingBox();
assert.ok(smallBox.height >= 44 && smallBox.x >= 0 && smallBox.x + smallBox.width <= 360, JSON.stringify(smallBox));
await shot('04-phone-running', droid);
await droid.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
await droid.clock.runFor(35_000);
await droid.waitForFunction(() => window.__swNotes.length > 0);
const sw = await droid.evaluate(() => window.__swNotes);
assert.equal(sw.length, 1, JSON.stringify(sw));
assert.deepEqual([sw[0].title, sw[0].body, sw[0].state], ['הלקוח לא ענה: מספרת רון', 'הסרטונים (תהליך 26). עברו 5 דקות בלי תשובה: להתקשר.', 'activated']);
assert.equal(sw[0].href, `${BASE}client.html?id=${ron.id}#p26`);
assert.equal(sw[0].scope, `${BASE}app/`); // it controls no page
await droidCtx.close();

assert.deepEqual(errors, []);
await browser.close();
console.log('now bar e2e: all checks passed');
