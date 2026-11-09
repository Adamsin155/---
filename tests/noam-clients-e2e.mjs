// Noam's list of clients (the owner, 1.11.2026): all the current clients, each opens with its vault; her tasks stay her own.
// Shiel (9.11.2026; docs/ops.md, section 113): the same list, and the meeting's form of his client.
// Run: npx http-server -p 8094 -s -c-1 . &  then  BASE_URL=http://localhost:8094/ node tests/noam-clients-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
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
for (const e of ['noam@astrateg.test', 'nadia@astrateg.test', 'shiel@astrateg.test']) addUser(e);
const staff = [
  { email: 'noam@astrateg.test', person: 'noam', vault: true },
  { email: 'nadia@astrateg.test', person: 'nadia', vault: false },
  { email: 'shiel@astrateg.test', person: 'shiel', vault: true },
];
const OFFICE = new Set(['irit', 'lior', 'ofir', 'ilai', 'noam', 'shiel', null]);
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

const client = (n, name, status, characterizer) => ({ id: randomUUID(), name, business: name, status, characterizer, shoot_type: 'natali', package_name: 'Social', deal_at: minutesAgo(5000 + n), created_at: minutesAgo(5000 + n), rounds: [], links: {}, landing: false, archived_at: null, deliverables: { videos: 36, graphics: 36 } });
const MINE = client(1, 'קפה של נעם', 'active', 'noam');
const OFIRS = client(2, 'מסעדה של אופיר', 'active', 'ofir');
const ENDING = client(3, 'מוסך מסיים', 'ending', 'ofir');
const ENDED = client(4, 'לקוח שהסתיים', 'ended', 'ofir');
// Shiel's meeting: this morning at 9:00, nothing marked yet.
const SHIELS = { ...client(5, 'מספרה של שיאל', 'active', 'shiel'), char_at: minutesAgo(60) };
const tables = { clients: [MINE, OFIRS, ENDING, ENDED, SHIELS], client_access: [{ id: randomUUID(), client_id: OFIRS.id, network: 'instagram', label: null, username: 'x_user', status: 'new', linked: true, has_secret: true, note: null, updated_at: minutesAgo(100) }], protocol_checks: [], client_tasks: [], quotes: [], office_reviews: [], client_status_notes: [], protocol_log: [] };
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
  if (p === '/rest/v1/rpc/deal_take') {
    const d = deals.find((x) => x.id === body.p_id);
    if (!d.taken_by && d.status === 'pending') Object.assign(d, { taken_by: personOf(me), taken_at: serverNow() });
    return json(200, { ok: d.taken_by === personOf(me), taken_by: d.taken_by, status: d.status });
  }
  if (p === '/rest/v1/rpc/can_use_vault') return json(200, ['noam', 'shiel'].includes(personOf(me)));
  if (p === '/rest/v1/rpc/can_use_client_vault') return json(200, ['noam', 'shiel'].includes(personOf(me)));
  if (p === '/rest/v1/rpc/is_office') return json(200, isOffice(me));
  if (p === '/rest/v1/rpc/my_person') return json(200, personOf(me) ?? null);
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
  // As PostgREST: the eq filters, and one object when asked for one.
  const rows = (tables[m[1]] || []).filter((r) => [...url.searchParams.entries()].every(([k, v]) => !v.startsWith('eq.') || String(r[k]) === v.slice(3)));
  if ((headers.accept || '').includes('vnd.pgrst.object')) return rows.length === 1 ? json(200, rows[0]) : rows.length ? json(406, { code: 'PGRST116', message: 'many rows' }) : json(200, null);
  return json(200, rows);
}

let browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
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


const list = async (page) => (await page.locator('#client-list').innerText());
await step('Noam at 360px: the tab says "לקוחות", all the current clients, not the ended; search works by real typing', async () => {
  const n = await newPage({ width: 360, height: 780 });
  await signIn(n, 'clients.html#clients', 'noam@astrateg.test');
  await n.waitForSelector('#tab-clients');
  await n.waitForFunction(() => !document.getElementById('tab-clients').hidden && document.getElementById('tab-clients').textContent === 'לקוחות', null, { timeout: 15000 });
  await n.click('#tab-clients');
  await n.waitForSelector('#client-list a, #client-list li');
  const t1 = await list(n);
  for (const name of ['קפה של נעם', 'מסעדה של אופיר', 'מוסך מסיים']) assert.ok(t1.includes(name), name);
  assert.ok(!t1.includes('לקוח שהסתיים'));
  assert.match(await n.locator('#client-filters').innerText(), /כל הלקוחות הפעילים/);
  assert.ok(await noSideScroll(n));
  await shot(n, 'noam-01-list-phone');
  await n.locator('#client-search').pressSequentially('מסעדה', { delay: 20 });
  await n.waitForFunction(() => !document.getElementById('client-list').innerText.includes('קפה של נעם'));
  assert.ok((await list(n)).includes('מסעדה של אופיר'));
  for (let i = 0; i < 6; i += 1) await n.keyboard.press('Backspace');
  assert.equal(await n.inputValue('#client-search'), '');
  await n.waitForFunction(() => document.getElementById('client-list').innerText.includes('קפה של נעם'));
});
await step('a client of Ofir\'s opens for Noam, with "גישות לרשתות"; her tasks do not include it', async () => {
  const n = await newPage();
  await signIn(n, 'clients.html#mine', 'noam@astrateg.test');
  await n.waitForFunction(() => !document.getElementById('tab-clients').hidden);
  await shot(n, 'noam-02-mine-web');
  assert.ok(!(await n.locator('#mine-list').innerText()).includes('מסעדה של אופיר'), 'not in her tasks');
  await n.click('#tab-clients');
  await n.locator('#client-list').getByText('מסעדה של אופיר').first().click();
  await n.waitForURL(/client\.html/);
  await n.waitForSelector('#fold-access:not([hidden])', { timeout: 15000 });
  assert.match(await n.locator('#fold-access > summary').innerText(), /גישות לרשתות/);
  assert.equal(await n.locator('#access').getAttribute('hidden'), null, 'the vault block is not hidden');
  await n.locator('#fold-access > summary').click();
  await n.waitForFunction(() => document.getElementById('fold-access').open);
  assert.match(await n.locator('#access').innerText(), /instagram|אינסטגרם/i);
  assert.equal(await n.locator('a[href="clients.html#clients"]').first().innerText(), 'לקוחות', 'the menu says it too');
  await shot(n, 'noam-03-card-web');
});
await step('someone else stays with their own list: Nadia, "הלקוחות שלי"', async () => {
  const n = await newPage();
  await signIn(n, 'clients.html#mine', 'nadia@astrateg.test');
  await n.waitForFunction(() => document.getElementById('tab-clients').textContent === 'הלקוחות שלי', null, { timeout: 15000 });
});
// The sign-in screen lifts on the animation clock: a screenshot waits until it is gone.
// A full-page capture of these pages still draws the sign-in screen over the top (seen 9.11.2026; the
// page itself is open under it): the viewport, at the top and then lower down.
const vshot = async (page, name) => { if (!OUT) return; await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" }); await page.mouse.wheel(0, 700); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${name}-b.png`, animations: "disabled" }); await page.evaluate(() => scrollTo(0, 0)); };
const settled = (page) => page.waitForFunction(() => [...document.querySelectorAll('.lg-screen')].every((e) => e.hidden || e.getBoundingClientRect().height === 0 || getComputedStyle(e).display === 'none'), null, { timeout: 5000 }).catch(() => null);
for (const [w, h, tag] of [[390, 844, 'phone'], [1280, 900, 'web']]) {
  await step(`Shiel (${tag}): "לקוחות" lists every current client; his meeting is in his tasks; no Gantt in the menu`, async () => {
    const n = await newPage({ width: w, height: h });
    await signIn(n, 'clients.html#mine', 'shiel@astrateg.test');
    await n.waitForFunction(() => !document.getElementById('tab-clients').hidden && document.getElementById('tab-clients').textContent === 'לקוחות', null, { timeout: 15000 });
    await n.waitForFunction(() => document.getElementById('mine-list')?.innerText.includes('מספרה של שיאל'), null, { timeout: 15000 });
    const mine = await n.locator('#mine-list').innerText();
    assert.ok(!mine.includes('מסעדה של אופיר'), 'only his own work');
    assert.equal(await n.locator('a[href^="gantt.html"]').count(), 0, 'no Gantt');
    assert.equal(await n.locator('#mine-connect').isHidden(), true, 'nothing to connect: he gets no notification');
    assert.ok(await noSideScroll(n));
    await settled(n); await vshot(n, `shiel-01-mine-${tag}`);
    await n.click('#tab-clients');
    await n.waitForSelector('#client-list a, #client-list li');
    const t = await list(n);
    for (const name of ['קפה של נעם', 'מסעדה של אופיר', 'מוסך מסיים', 'מספרה של שיאל']) assert.ok(t.includes(name), name);
    assert.ok(!t.includes('לקוח שהסתיים'));
    assert.ok(await noSideScroll(n));
    await settled(n); await vshot(n, `shiel-02-clients-${tag}`);
  });
  await step(`Shiel (${tag}): the meeting's form of his client, and "אפיון חדש"`, async () => {
    const n = await newPage({ width: w, height: h });
    await signIn(n, `intake.html?id=${SHIELS.id}#end`, 'shiel@astrateg.test');
    await n.waitForFunction(() => !document.getElementById('app')?.hidden && /שיאל|האפיון הסתיים|אפיון/.test(document.body.innerText), null, { timeout: 15000 });
    assert.doesNotMatch(await n.locator('#state').innerText().catch(() => ''), /פתוח לצוות המשרד|פתוח לבעלים/);
    assert.ok(await noSideScroll(n));
    await settled(n); await vshot(n, `shiel-03-meeting-${tag}`);
    const p = await newPage({ width: w, height: h });
    await signIn(p, 'intake.html', 'shiel@astrateg.test');
    await p.waitForFunction(() => document.getElementById('pk-h')?.textContent === 'אפיון חדש', null, { timeout: 15000 });
    assert.ok(await noSideScroll(p));
    await settled(p); await vshot(p, `shiel-04-new-char-${tag}`);
  });
}
assert.deepEqual(errors, []);
await browser.close();
noCspViolations();
console.log(`\n${passed} passed`);
