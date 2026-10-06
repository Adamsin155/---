// End-to-end check of the owner's decisions of 3.10.2026 in the browser, against an
// in-memory fake of Supabase (as the other suites):
//   - Stav (sales) signs in, lands on deal.html (also from clients.html), sends "עסקה
//     חדשה" "לעירית להכנת חוזה", and sees only his deals with their status; at 360px
//     nothing scrolls sideways and the targets are 44px.
//   - Irit sees "להכין חוזה ל־<עסק>" in "המשימות שלי" with its office-time clock, opens
//     the builder prefilled from the deal, and the quote she creates is linked to it.
// Run: npx http-server -p 8094 -s -c-1 . &  then  BASE_URL=http://localhost:8094/ node tests/deal-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Monday 5.10.2026, 10:00 in Jerusalem: an office day.
const NOW = new Date('2026-10-05T07:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();
const minutesAgo = (n) => new Date(NOW - n * 6e4).toISOString();

const users = new Map();
const addUser = (email) => { const u = { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: minutesAgo(9000) }; users.set(email, u); return u; };
for (const e of ['stav@astrateg.test', 'irit@astrateg.test', 'nadia@astrateg.test']) addUser(e);
const staff = [
  { email: 'stav@astrateg.test', person: 'stav', vault: false },
  { email: 'irit@astrateg.test', person: 'irit', vault: true },
  { email: 'nadia@astrateg.test', person: 'nadia', vault: false },
];
const OFFICE = new Set(['irit', 'lior', 'ofir', 'ilai', null]);
const deals = [
  // Another seller's deal: Stav never sees it.
  { id: randomUUID(), created_at: minutesAgo(300), created_by_email: 'old@astrateg.test', seller: null, business_name: 'של אחר', contact_name: 'א', phone: '0501111111', tier: 'podcast', influencer: 'natali', paid: [], free: {}, discount_agorot: 0, notes: null, status: 'pending', quote_id: null, sent_at: null, signed_at: null, status_by_email: null },
  // Stav's deal from this morning, signed already.
  { id: randomUUID(), created_at: minutesAgo(120), created_by_email: 'stav@astrateg.test', seller: 'stav', business_name: 'קפה דנה', contact_name: 'דנה', phone: '0502222222', tier: 'social', influencer: 'simeon', paid: [], free: {}, discount_agorot: 0, notes: null, status: 'signed', quote_id: randomUUID(), sent_at: minutesAgo(110), signed_at: minutesAgo(30), status_by_email: null },
];
const reminders = [{ id: 1, key: 'dealSigned:-:x:seller@stav', rule: 'dealSigned', person: 'stav', level: 'quiet', channel: 'app', status: 'sent', title: 'קפה דנה חתם 🎉', body: 'החוזה נשלח. תודה!', url: 'deal.html', created_at: minutesAgo(30), sent_at: minutesAgo(30), read_at: null }];
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

// The deals as the database answers each person (row level security, the stamping trigger).
function dealsRoute(req, url, me, json) {
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const filters = [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
  const match = (d) => filters.every(([k, v]) => (v.startsWith('eq.') ? String(d[k]) === v.slice(3) : true));
  const mine = (d) => isOffice(me) || (personOf(me) === 'stav' && d.created_by_email === me.email);
  const one = (req.headers().accept || '').includes('vnd.pgrst.object');
  const out = (rows) => (one ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  if (req.method() === 'GET') return out(deals.filter(mine).filter(match).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
  if (req.method() === 'POST') {
    calls.push({ insert: body });
    if (personOf(me) !== 'stav') return json(403, { code: '42501', message: 'new row violates row-level security policy' });
    const d = { ...body, id: randomUUID(), created_at: serverNow(), created_by_email: me.email, seller: 'stav', status: 'pending', quote_id: null, sent_at: null, signed_at: null, status_by_email: null };
    deals.push(d);
    return out([d]);
  }
  if (req.method() === 'PATCH') {
    calls.push({ update: body, where: Object.fromEntries(filters) });
    if (!isOffice(me)) return out([]);
    const rows = deals.filter(match);
    for (const d of rows) {
      Object.assign(d, body);
      if (body.quote_id && d.status === 'pending') d.status = 'sent';
      if (d.status === 'sent') d.sent_at ||= serverNow();
    }
    return out(rows);
  }
  return json(405, {});
}

const tables = { clients: [], protocol_checks: [], client_tasks: [], quotes: [], office_reviews: [], client_status_notes: [], protocol_log: [] };
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
  if (p === '/functions/v1/create-quote') {
    calls.push({ createQuote: body });
    return json(200, { id: 'q-new', number: 'AST-2026-0042', token: randomUUID() });
  }
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me && staff.some((s) => s.email === me.email));
  if (p.startsWith('/rest/v1/rpc/')) return json(200, []);
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  if (m[1] === 'deal_requests') return dealsRoute(req, url, me, json);
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    const rows = eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff;
    if ((headers.accept || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' });
    return json(200, rows);
  }
  if (m[1] === 'reminder_log') return json(200, reminders.filter((r) => r.person === personOf(me)));
  return json(200, tables[m[1]] || []);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newPage(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
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
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
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

// ── Stav, on the phone ────────────────────
const stav = await newPage({ width: 360, height: 780 });
await step('Stav signs in through clients.html and lands on his page; he sees only his own deals', async () => {
  await signIn(stav, 'clients.html', 'stav@astrateg.test');
  await stav.waitForURL(/deal\.html/);
  await stav.waitForSelector('#deal-form:not([hidden])');
  await stav.waitForSelector('#deal-list .deal-item');
  const items = await stav.locator('#deal-list .deal-item').allInnerTexts();
  assert.equal(items.length, 1);
  assert.match(items[0], /קפה דנה[\s\S]*נחתם/);
  assert.ok(!items.join('\n').includes('של אחר'));
  assert.ok(await noSideScroll(stav), 'no sideways scroll at 360px');
  await shot(stav, 'deal-01-stav');
});

await step('the form: what is missing is said field by field; every target is 44px or more', async () => {
  await stav.click('#d-submit');
  for (const id of ['d-business-err', 'd-contact-err', 'd-phone-err', 'd-tier-err', 'd-influencer-err']) assert.equal(await stav.locator(`#${id}`).isVisible(), true, id);
  assert.equal(await stav.evaluate(() => document.activeElement.id), 'd-business');
  const small = await stav.evaluate(() => [...document.querySelectorAll('#deal-form .deal-choice, #deal-form .input, #d-submit')]
    .filter((el) => el.offsetParent && el.getBoundingClientRect().height < 44).map((el) => el.id || el.className));
  assert.deepEqual(small, []);
  assert.equal(calls.filter((c) => c.insert).length, 0, 'nothing sent');
});

await step('Stav sends the deal "לעירית להכנת חוזה": the add-ons follow the package, the row is his, the status "ממתין לחוזה"', async () => {
  await stav.fill('#d-business', 'פיצה רון');
  await stav.fill('#d-contact', 'רון כהן');
  await stav.fill('#d-phone', '050-7654321');
  await stav.check('#d-influencer-natali');
  await stav.check('#d-tier-social');
  // Natali's package: her reel and story; Semyon joining her day; no extra day with Semyon.
  assert.equal(await stav.locator('#d-paid-simeon-day').count(), 0);
  await stav.check('#d-paid-photographer');
  await stav.check('#d-free-simeonJoin');
  await stav.fill('#d-discount', '150');
  await stav.fill('#d-notes', 'לחזור אחרי 17:00');
  await shot(stav, 'deal-02-form');
  await stav.click('#d-submit');
  await stav.waitForFunction(() => document.querySelectorAll('#deal-list .deal-item').length === 2);
  const sent = calls.filter((c) => c.insert).at(-1).insert;
  assert.deepEqual({ ...sent, free: undefined }, {
    business_name: 'פיצה רון', contact_name: 'רון כהן', phone: '050-7654321', notes: 'לחזור אחרי 17:00',
    tier: 'social', influencer: 'natali', paid: ['photographer'], discount_agorot: 15000, free: undefined,
  });
  assert.equal(sent.free.simeonJoin, true);
  assert.match(await stav.locator('#deal-list .deal-item').first().innerText(), /פיצה רון[\s\S]*ממתין לחוזה/);
  assert.equal(await stav.inputValue('#d-business'), '', 'the form is ready for the next deal');
  assert.ok(await noSideScroll(stav));
});

// ── Irit ──────────────────────────────────
const irit = await newPage();
const dealId = () => deals.find((d) => d.business_name === 'פיצה רון').id;
await step('Irit: "להכין חוזה ל־פיצה רון" in המשימות שלי, with the 10-minute office clock, the details and the link to the builder', async () => {
  await signIn(irit, 'clients.html#mine', 'irit@astrateg.test');
  await irit.waitForSelector('#deals-card:not([hidden]) .deal-task');
  const card = irit.locator(`.deal-task[data-deal="${dealId()}"]`);
  const t = await card.innerText();
  assert.match(t, /להכין חוזה ל־פיצה רון/);
  assert.match(t, /נשארו \d+:\d\d/);
  assert.match(t, /Social · נטלי דדון · תוספות: צלם חודשי, צירוף סמיון ליום הצילום עם נטלי · הנחה 150 ₪ לחודש/);
  assert.match(t, /רון כהן · 050-7654321 · מסתיו/);
  assert.equal(await card.locator('a.btn', { hasText: 'להכנת החוזה' }).getAttribute('href'), `index.html?deal=${dealId()}`);
  // The other seller's deal is there too (the office reads all); Stav's signed one is not (done).
  assert.equal(await irit.locator('.deal-task').count(), 2);
  await shot(irit, 'deal-03-irit');
});

await step('the builder opens prefilled from the deal; the quote created is linked to it ("חוזה נשלח")', async () => {
  const b = await newPage();
  await b.goto(`${BASE}index.html?deal=${dealId()}`);
  // The builder asks for a sign-in when there is no session.
  await b.waitForSelector('#dlg-login[open]');
  await b.fill('#lg-email', 'irit@astrateg.test');
  await b.fill('#lg-pass', 'correct-horse');
  await b.click('#lg-submit');
  await b.waitForFunction(() => document.getElementById('c-company').value === 'פיצה רון');
  assert.equal(await b.inputValue('#c-name'), 'רון כהן');
  assert.equal(await b.inputValue('#c-phone'), '050-7654321');
  assert.equal(await b.inputValue('#discount'), '150');
  assert.equal(await b.isChecked('input[name="influencer"][value="natali"]'), true);
  assert.equal(await b.isChecked('input[name="tier"][value="social"]'), true);
  assert.equal(await b.isChecked('#paid-photographer'), true);
  await shot(b, 'deal-04-builder');
  await b.click('#btn-link');
  await b.waitForFunction(() => document.getElementById('sh-number').textContent === 'AST-2026-0042');
  await b.waitForFunction(() => true);
  for (let i = 0; i < 50 && !calls.some((c) => c.update?.quote_id === 'q-new'); i += 1) await b.waitForTimeout(100);
  const link = calls.find((c) => c.update?.quote_id === 'q-new');
  assert.ok(link, 'the deal was linked to the quote');
  assert.equal(link.where.id, `eq.${dealId()}`);
  assert.equal(deals.find((d) => d.id === dealId()).status, 'sent');
  const created = calls.find((c) => c.createQuote).createQuote;
  assert.equal(created.selection.docType, 'agreement');
  assert.equal(created.client.company, 'פיצה רון');
});

await step('"החוזה נשלח" on the other deal: it leaves the list', async () => {
  await irit.reload();
  await irit.waitForSelector('#deals-card:not([hidden]) .deal-task');
  assert.equal(await irit.locator('.deal-task').count(), 1, 'the linked one is not waiting any more');
  await irit.locator('.deal-task button', { hasText: 'החוזה נשלח' }).click();
  await irit.waitForSelector('#deals-card', { state: 'hidden' });
  assert.equal(calls.filter((c) => c.update?.status === 'sent').length, 1);
});

await step('back on his page, Stav sees "חוזה נשלח"', async () => {
  await stav.reload();
  await stav.waitForSelector('#deal-list .deal-item');
  assert.match(await stav.locator('#deal-list .deal-item', { hasText: 'פיצה רון' }).innerText(), /חוזה נשלח/);
});

await step('anyone else on deal.html: "העמוד הזה לסוכני השטח", no form', async () => {
  const n = await newPage({ width: 360, height: 780 });
  await signIn(n, 'deal.html', 'nadia@astrateg.test');
  await n.waitForSelector('#no-access:not([hidden])');
  assert.equal(await n.locator('#deal-form').isVisible(), false);
  assert.match(await n.locator('#no-access').innerText(), /למשימות שלי/);
});

assert.deepEqual(errors, []);
await browser.close();
noCspViolations();
console.log(`\n${passed} passed`);
