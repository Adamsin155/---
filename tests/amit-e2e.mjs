// Amit (the owner's decision of 15.11.2026; docs/ops.md, section 132): exactly what Noam did, beside Ofir.
// In the browser, against a fake of Supabase that answers as the database does after
// 20261214100000_amit.sql and its checks (tests/sql/amit.test.mjs holds the real rules), on an iPhone 13
// (WebKit) and at 1366 (Chromium):
//   - her "המשימות שלי": her own meeting, not Ofir's work; the line to the clients not connected to
//     Metricool; "גאנט תוכן" in her menu; she is told things (not silent like Shiel);
//   - "לקוחות": every active and ending client (not the ended), to reach any client's vault;
//   - the meeting's form of her client, and "אפיון חדש";
//   - her client's card: "גישות לרשתות" with the link to the logins form, which she may make;
//   - the Gantt's index: the card "לקוחות שלא מחוברים ל־Metricool";
//   - Irit's pickers "מי מבצע את האפיון?": "קביעת מועד" and the card's edit form offer עמית, אופיר,
//     שיאל and ליאור; a client with nobody set stays Ofir's.
// Run: node <static server> . 8791 &  then  BASE_URL=http://localhost:8791/ node tests/amit-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Monday 5.10.2026, 10:00 in Jerusalem: an office day.
const NOW = new Date('2026-10-05T07:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();
const minutesAgo = (n) => new Date(NOW - n * 6e4).toISOString();

const users = new Map();
const addUser = (email) => { const u = { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: minutesAgo(9000) }; users.set(email, u); return u; };
for (const e of ['amit@astrateg.test', 'irit@astrateg.test', 'ofir@astrateg.test', 'nadia@astrateg.test']) addUser(e);
const staff = [
  { email: 'amit@astrateg.test', person: 'amit', vault: true },
  { email: 'irit@astrateg.test', person: 'irit', vault: true },
  { email: 'ofir@astrateg.test', person: 'ofir', vault: true },
  { email: 'nadia@astrateg.test', person: 'nadia', vault: false },
];
// public.is_office() after 20261214100000_amit.sql.
const OFFICE = new Set(['irit', 'lior', 'ofir', 'ilai', 'amit', 'shiel', null]);
const LINK_MAKERS = new Set(['irit', 'lior', 'ofir', 'amit', null]); // public.can_manage_access_links()
const calls = [];

const EXP = Math.floor(NOW / 1000) + 3 * 3600;
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const sessionFor = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 3 * 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => staff.find((s) => s.email === u?.email)?.person;
const isOffice = (u) => !!u && staff.some((s) => s.email === u.email) && OFFICE.has(personOf(u));

const client = (n, name, status, characterizer, extra = {}) => ({
  id: randomUUID(), name, business: name, status, characterizer, shoot_type: 'natali', package_name: 'Social', deal_at: minutesAgo(5000 + n), created_at: minutesAgo(5000 + n),
  rounds: [], links: {}, landing: false, archived_at: null, deliverables: { videos: 36, graphics: 36 },
  metricool_blog_id: null, metricool_brand: null, metricool_none: false, ...extra,
});
// Her meeting: this morning at 9:00, nothing marked yet.
const AMITS = client(1, 'קונדיטוריה של עמית', 'active', 'amit', { char_at: minutesAgo(60) });
// The others' meetings are set already (tomorrow): only the fresh client waits for "קביעת מועד".
const tomorrow = new Date(NOW.getTime() + 864e5).toISOString();
const OFIRS = client(2, 'מסעדה של אופיר', 'active', 'ofir', { metricool_blog_id: '7', metricool_brand: 'מסעדה של אופיר', char_at: tomorrow });
const SHIELS = client(3, 'מספרה של שיאל', 'active', 'shiel', { char_at: tomorrow });
const ENDING = client(4, 'מוסך מסיים', 'ending', 'ofir', { char_at: tomorrow });
const ENDED = client(5, 'לקוח שהסתיים', 'ended', 'ofir');
// No characterizer and no meeting yet, days after the deal: Irit's "קביעת מועד", on "באיחור".
const FRESH = client(6, 'פיצה חדשה', 'active', null);
const tables = {
  clients: [AMITS, OFIRS, SHIELS, ENDING, ENDED, FRESH],
  client_access: [{ id: randomUUID(), client_id: AMITS.id, network: 'instagram', label: null, username: 'cake_user', status: 'new', linked: false, has_secret: true, note: null, updated_at: minutesAgo(30) }],
  client_access_links: [], protocol_checks: [], client_tasks: [], quotes: [], office_reviews: [], client_status_notes: [], protocol_log: [],
};
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
  const me = userOf(headers);
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
    return json(200, sessionFor(u));
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me && staff.some((s) => s.email === me.email));
  if (p === '/rest/v1/rpc/can_use_vault' || p === '/rest/v1/rpc/can_use_client_vault') return json(200, !!staff.find((s) => s.email === me?.email)?.vault);
  if (p === '/rest/v1/rpc/is_office') return json(200, isOffice(me));
  if (p === '/rest/v1/rpc/my_person') return json(200, personOf(me) ?? null);
  if (p === '/rest/v1/rpc/can_manage_access_links') return json(200, !!me && LINK_MAKERS.has(personOf(me)));
  if (p === '/rest/v1/rpc/can_connect_metricool') return json(200, !!me && ['ilai', 'ofir', 'amit', 'irit', 'lior', null].includes(personOf(me)));
  if (p.startsWith('/rest/v1/rpc/')) { calls.push({ rpc: p.slice(13), body, by: me?.email }); return json(200, []); }
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    const rows = eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff;
    if ((headers.accept || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' });
    return json(200, rows);
  }
  if (req.method() !== 'GET') { calls.push({ [req.method()]: m[1], body }); return json(200, []); }
  // As PostgREST: the eq filters, and one object when asked for one.
  const rows = (tables[m[1]] || []).filter((r) => [...url.searchParams.entries()].every(([k, v]) => !v.startsWith('eq.') || String(r[k]) === v.slice(3)));
  if ((headers.accept || '').includes('vnd.pgrst.object')) return rows.length === 1 ? json(200, rows[0]) : rows.length ? json(406, { code: 'PGRST116', message: 'many rows' }) : json(200, null);
  return json(200, rows);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let iphoneBrowser = null;
const errors = [];
// iphone: WebKit as an iPhone 13 (390 wide).
async function newPage(viewport = { width: 1366, height: 768 }, { iphone = false } = {}) {
  if (iphone && !iphoneBrowser) iphoneBrowser = await webkit.launch();
  const opts = iphone ? { ...devices['iPhone 13'] } : { viewport };
  const ctx = await (iphone ? iphoneBrowser : browser).newContext({ ...opts, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.clock.install({ time: new Date(serverNow()) });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => tables.clients, staff: () => staff }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, path, email) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
}
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last calls: ${JSON.stringify(calls.slice(-3))}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
// The sign-in screen lifts on the animation clock: a screenshot waits until it is gone.
const settled = (page) => page.waitForFunction(() => [...document.querySelectorAll('.lg-screen')].every((e) => e.hidden || e.getBoundingClientRect().height === 0 || getComputedStyle(e).display === 'none'), null, { timeout: 5000 }).catch(() => null);
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' }); };

for (const [tag, iphone, viewport] of [['iphone', true, null], ['1366', false, { width: 1366, height: 768 }]]) {
  await step(`Amit (${tag}): her meeting in her tasks, not Ofir's work; the Metricool line; "גאנט תוכן" in her menu`, async () => {
    const n = await newPage(viewport || undefined, { iphone });
    await signIn(n, 'clients.html#mine', 'amit@astrateg.test');
    await n.waitForFunction(() => !document.getElementById('tab-clients').hidden && document.getElementById('tab-clients').textContent === 'לקוחות', null, { timeout: 15000 });
    await n.waitForFunction(() => document.getElementById('mine-list')?.innerText.includes('קונדיטוריה של עמית'), null, { timeout: 15000 });
    const mine = await n.locator('#mine-list').innerText();
    assert.ok(!mine.includes('מסעדה של אופיר'), 'only her own work');
    assert.ok(!mine.includes('מספרה של שיאל'), 'Shiel\'s meeting is his');
    await n.locator('#mine-list a[href="gantt.html#not-connected"]').first().waitFor({ timeout: 15000 });
    assert.match(mine + await n.locator('#mine-list').innerText(), /מחכים לחיבור ל־Metricool|מחכה לחיבור ל־Metricool/);
    assert.ok(await n.locator('a[href^="gantt.html"]').count() > 0, 'the Gantt in her menu');
    assert.equal(await n.locator('a[href="quotes.html"]:visible, a[href="payments.html"]:visible, a[href="index.html"]:visible, a[href="./"]:visible').count(), 0, 'no money, no contracts');
    assert.ok(await noSideScroll(n));
    await settled(n); await shot(n, `amit-01-mine-${tag}`);
    await n.click('#tab-clients');
    await n.waitForSelector('#client-list a, #client-list li');
    const t = await n.locator('#client-list').innerText();
    for (const name of ['קונדיטוריה של עמית', 'מסעדה של אופיר', 'מספרה של שיאל', 'מוסך מסיים', 'פיצה חדשה']) assert.ok(t.includes(name), name);
    assert.ok(!t.includes('לקוח שהסתיים'), 'not the ended');
    assert.ok(await noSideScroll(n));
    await settled(n); await shot(n, `amit-02-clients-${tag}`);
    await n.context().close();
  });
  await step(`Amit (${tag}): the meeting's form of her client, and "אפיון חדש"`, async () => {
    const n = await newPage(viewport || undefined, { iphone });
    await signIn(n, `intake.html?id=${AMITS.id}#end`, 'amit@astrateg.test');
    await n.waitForFunction(() => !document.getElementById('app')?.hidden && document.body.innerText.includes('כתובת העסק'), null, { timeout: 15000 });
    assert.doesNotMatch(await n.locator('#state').innerText().catch(() => ''), /פתוח לצוות המשרד|פתוח לבעלים/);
    assert.ok(await noSideScroll(n));
    await settled(n); await shot(n, `amit-03-meeting-${tag}`);
    const p = await newPage(viewport || undefined, { iphone });
    await signIn(p, 'intake.html', 'amit@astrateg.test');
    await p.waitForFunction(() => document.getElementById('pk-h')?.textContent === 'אפיון חדש', null, { timeout: 15000 });
    assert.ok(await noSideScroll(p));
    await settled(p); await shot(p, `amit-04-new-char-${tag}`);
    await n.context().close();
    await p.context().close();
  });
  await step(`Amit (${tag}): her client's card has "גישות לרשתות" and the link to the logins form, which she may make`, async () => {
    const n = await newPage(viewport || undefined, { iphone });
    await signIn(n, `client.html?id=${AMITS.id}`, 'amit@astrateg.test');
    await n.waitForSelector('#fold-access:not([hidden])', { timeout: 15000 });
    await settled(n);
    await n.locator('#fold-access > summary').click();
    await n.waitForFunction(() => document.getElementById('fold-access').open);
    await n.waitForSelector('#access-link', { timeout: 15000 });
    assert.match(await n.locator('#access-link').innerText(), /קישור ללקוח למילוי פרטי הכניסה/);
    assert.ok(await n.locator('#access-link button').count() > 0, 'a button to make the link');
    assert.ok(await noSideScroll(n));
    await n.locator('#access-link').scrollIntoViewIfNeeded();
    await shot(n, `amit-05-card-link-${tag}`);
    await n.context().close();
  });
  await step(`Amit (${tag}): the Gantt's index has the card of the clients not connected to Metricool`, async () => {
    const n = await newPage(viewport || undefined, { iphone });
    await signIn(n, 'gantt.html#not-connected', 'amit@astrateg.test');
    await n.waitForSelector('#metricool-card:not([hidden]) h2', { timeout: 15000 });
    const card = await n.locator('#metricool-card').innerText();
    assert.match(card, /לקוחות שלא מחוברים ל־Metricool/);
    assert.ok(card.includes('קונדיטוריה של עמית'));
    assert.ok(!card.includes('מסעדה של אופיר'), 'a connected client is not listed');
    assert.ok(await noSideScroll(n));
    await settled(n); await shot(n, `amit-06-gantt-metricool-${tag}`);
    await n.context().close();
  });
  await step(`Irit (${tag}): "קביעת מועד" offers עמית, אופיר, שיאל and ליאור; a client with nobody set stays Ofir's`, async () => {
    const n = await newPage(viewport || undefined, { iphone });
    await signIn(n, 'clients.html#mine', 'irit@astrateg.test');
    await n.waitForSelector('#tab-late:not([hidden])', { timeout: 15000 });
    await n.click('#tab-late');
    const btn = n.locator('#view-mine button', { hasText: /קביעת מועד|בחירת מבצע/ }).first();
    await btn.waitFor({ timeout: 15000 });
    await btn.click();
    await n.waitForSelector('#dlg-meet[open]');
    assert.match(await n.locator('#dlg-meet').innerText(), /פיצה חדשה/, 'the client with nobody set');
    assert.deepEqual(await n.locator('#meet-who option').evaluateAll((os) => os.map((o) => [o.value, o.textContent])),
      [['amit', 'עמית'], ['ofir', 'אופיר'], ['shiel', 'שיאל'], ['lior', 'ליאור (רק כשאין אחר)']]);
    assert.equal(await n.locator('#meet-who').inputValue(), 'ofir', 'the default stays Ofir');
    await n.locator('#meet-who').selectOption('amit');
    assert.equal(await n.locator('#meet-who').inputValue(), 'amit');
    assert.ok(await noSideScroll(n));
    await settled(n); await shot(n, `amit-07-meet-who-${tag}`);
    await n.context().close();
  });
  await step(`the card's edit form (${tag}): "מי מבצע את האפיון" offers עמית; her client shows her`, async () => {
    const n = await newPage(viewport || undefined, { iphone });
    await signIn(n, `client.html?id=${AMITS.id}`, 'irit@astrateg.test');
    await n.waitForSelector('#btn-edit:not([hidden])', { timeout: 15000 });
    await settled(n);
    await n.click('#btn-edit');
    await n.waitForSelector('#ed-characterizer');
    assert.deepEqual(await n.locator('#ed-characterizer option').evaluateAll((os) => os.map((o) => o.value)), ['', 'amit', 'ofir', 'shiel', 'lior']);
    assert.equal(await n.locator('#ed-characterizer').inputValue(), 'amit');
    assert.equal(await n.locator('#ed-characterizer option:checked').innerText(), 'עמית');
    await n.locator('#ed-characterizer').scrollIntoViewIfNeeded();
    await shot(n, `amit-08-card-picker-${tag}`);
    await n.context().close();
  });
}
assert.deepEqual(errors, []);
await browser.close();
if (iphoneBrowser) await iphoneBrowser.close();
noCspViolations();
console.log(`\n${passed} passed`);
