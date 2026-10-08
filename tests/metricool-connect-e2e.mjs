// End-to-end check of "לקוחות שלא מחוברים ל-Metricool" in the browser (the owner's
// request of 6.10.2026; docs/ops.md, section 33), against an in-memory fake of Supabase
// that answers as the database does (who may connect and mark:
// tests/sql/metricool-none.test.mjs holds the real rules; the list's own rules:
// tests/metricool-connect.test.mjs):
//   - Ilai has the card under the exceptional contracts: every active client with no
//     brand, the oldest deal first, the first 8 and "הצג עוד"; nothing is asked of
//     Metricool until he opens a row;
//   - "בחירת מותג" opens the row in place with the account's brands (one request),
//     the suggestion by name chosen, a brand another client uses not choosable;
//     "חיבור" asks the database, the row goes and the next one opens;
//   - "ללקוח אין מותג" takes a client off the list; it comes back from the toast's
//     "ביטול" and from "סומנו ״אין מותג״";
//   - a brand someone else took in the meantime, and Metricool not answering (a way
//     to the client's Gantt instead);
//   - the owner has the card; Irit, Lior, an editor and a sales agent do not;
//   - a 360px phone; nothing to connect: no card; before the migrations.
// Run: npx http-server -p 8163 -s -c-1 . &  then
//      BASE_URL=http://localhost:8163/ node tests/metricool-connect-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { withClientColumns } from './fake-clients.mjs';
import { CONNECTORS, CONNECT_CAP } from '../app/metricool-connect-logic.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Monday 5.10.2026, 10:00 in Jerusalem: an office day.
const NOW = new Date('2026-10-05T07:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();
const minutesAgo = (n) => new Date(NOW - n * 6e4).toISOString();
const daysAgo = (n) => minutesAgo(n * 24 * 60);

const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ilai: 'ilai', nadia: 'nadia', stav: 'stav' };
const users = new Map();
const staff = [];
for (const [k, person] of Object.entries(PEOPLE)) {
  const email = `${k}@astrateg.test`;
  users.set(email, { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: minutesAgo(9000) });
  staff.push({ email, person, vault: false });
}
const OFFICE = new Set(['irit', 'lior', 'ofir', 'ilai', null]);
const EXP = Math.floor(NOW / 1000) + 3 * 3600;
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const sessionFor = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 3 * 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => { const s = staff.find((x) => x.email === u?.email); return s ? s.person ?? 'owner' : null; };
const isOffice = (u) => !!u && staff.some((s) => s.email === u.email) && OFFICE.has(staff.find((s) => s.email === u.email).person);
// public.can_edit_gantt(): Ilai and the owner.
const canEdit = (u) => CONNECTORS.includes(personOf(u));

const client = (name, business, dealDays, fields = {}) => ({
  id: randomUUID(), name, business, address: null, phone: '050-1234567', package_name: 'סושיאל', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  editor_name: null, editor: null, deal_at: daysAgo(dealDays), char_at: null, shoot_at: null, contract_end: '2027-12-31', status: 'active', notes: null, quote_id: null,
  created_at: daysAgo(dealDays), created_by_email: null, links: {}, deliverables: {}, rounds: [], verified_at: daysAgo(dealDays - 1), verified_by: 'irit@astrateg.test',
  closed_reason: null, archived_at: null, archived_by: null, protocol_version: 7,
  metricool_blog_id: null, metricool_brand: null, metricool_none: false, metricool_none_by: null, metricool_none_at: null, ...fields,
});
// Eleven with no brand, written here out of order; the list must come out oldest first.
const tables = {
  clients: [
    client('דנה לוי', 'קפה דנה', 300),
    client('רון כהן', 'פיצה רון', 400),
    client('משה', 'מוסך הצפון', 350),
    client('יעל', 'מספרת יעל', 500, { metricool_blog_id: '13', metricool_brand: 'מספרת יעל' }), // connected: not listed
    client('אבי', 'אבי שיפוצים', 250),
    client('נועה', 'סטודיו נועה', 200, { status: 'ending' }),
    client('גיל', 'גיל נדל״ן', 150),
    client('תמר', 'תמר קוסמטיקה', 120),
    client('עומר', 'עומר כושר', 100),
    client('שיר', 'שיר פרחים', 80),
    client('בן', 'בן רכבים', 60),
    client('ליה', 'ליה אופנה', 40),
    client('ישן', 'לקוח שהסתיים', 600, { status: 'ended' }),            // ended: not listed
    client('ארכיון', 'לקוח בארכיון', 700, { archived_at: daysAgo(10) }), // archived: not listed
  ],
  protocol_checks: [], client_tasks: [], office_reviews: [], client_status_notes: [], protocol_log: [],
};
const byBusiness = (b) => tables.clients.find((c) => c.business === b);
const ORDER = ['פיצה רון · רון כהן', 'מוסך הצפון · משה', 'קפה דנה · דנה לוי', 'אבי שיפוצים · אבי', 'סטודיו נועה · נועה', 'גיל נדל״ן · גיל', 'תמר קוסמטיקה · תמר', 'עומר כושר · עומר', 'שיר פרחים · שיר', 'בן רכבים · בן', 'ליה אופנה · ליה'];
// The account's brands, as the edge function `metricool` answers { action: 'brands' }.
const BRANDS = [
  { id: '11', label: 'Cafe Dana', networks: ['instagram'] }, { id: '12', label: 'פיצה רון', networks: ['instagram', 'facebook'] },
  { id: '13', label: 'מספרת יעל', networks: [] }, { id: '14', label: 'מוסך הצפון', networks: ['facebook'] }, { id: '15', label: 'קפה דנה', networks: [] },
  { id: '16', label: 'Studio N', networks: [] },
];
const calls = [];
const fn = { calls: [], down: false };
const before = { none: false, brand: false }; // the migrations that are not applied yet

function rpc(name, body, me, json) {
  if (name === 'is_staff') return json(200, !!me && staff.some((s) => s.email === me.email));
  if (name === 'is_office') return json(200, isOffice(me));
  if (name === 'gantt_set_brand' || name === 'metricool_set_none') {
    calls.push({ [name]: body, by: me?.email });
    if (name === 'metricool_set_none' && before.none) return json(404, { code: 'PGRST202', message: 'Could not find the function public.metricool_set_none' });
    if (!canEdit(me)) return json(403, { code: '42501', message: 'not allowed' });
    const c = tables.clients.find((x) => x.id === body.p_client && !x.archived_at);
    if (!c) return json(400, { code: '22023', message: 'client not found' });
    if (name === 'gantt_set_brand') {
      if (body.p_blog_id && tables.clients.some((x) => x.metricool_blog_id === body.p_blog_id && x.id !== c.id)) return json(400, { code: 'P0001', message: 'brand_taken: this brand is connected to another client' });
      Object.assign(c, { metricool_blog_id: body.p_blog_id || null, metricool_brand: body.p_blog_id ? body.p_brand || null : null });
      if (c.metricool_blog_id) Object.assign(c, { metricool_none: false, metricool_none_by: null, metricool_none_at: null });
      return json(200, { blogId: c.metricool_blog_id, brand: c.metricool_brand });
    }
    if (body.p_on && c.metricool_blog_id) return json(400, { code: 'P0001', message: 'connected: this client is connected to a brand' });
    Object.assign(c, { metricool_none: !!body.p_on, metricool_none_by: body.p_on ? me.email : null, metricool_none_at: body.p_on ? serverNow() : null });
    return json(200, { none: c.metricool_none });
  }
  return json(200, []);
}

const filtersOf = (url) => [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k));
const matcher = (filters) => (row) => filters.every(([k, v]) => {
  if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
  if (v.startsWith('neq.')) return String(row[k]) !== v.slice(4);
  if (v.startsWith('in.')) return v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(row[k]));
  return true;
});
const answer = (req, json) => (rows) => ((req.headers().accept || '').includes('vnd.pgrst.object')
  ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' })) : json(200, rows));

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const json = (status, data) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
  });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  const me = userOf(req.headers());
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
    return json(200, sessionFor(u));
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  // The edge function: the office only; a short code when Metricool cannot be reached.
  if (p === '/functions/v1/metricool') {
    fn.calls.push({ action: body?.action, by: me?.email || null });
    if (!me) return json(401, { error: 'not_signed_in' });
    if (!isOffice(me)) return json(403, { error: 'not_allowed' });
    if (fn.down) return json(409, { error: 'not_ready' });
    return json(200, { brands: BRANDS });
  }
  if (p.startsWith('/rest/v1/rpc/')) return rpc(p.slice('/rest/v1/rpc/'.length), body || {}, me, json);
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    return answer(req, json)(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff);
  }
  if (m[1] === 'clients') {
    const cols = url.searchParams.get('select') || '';
    // The card writes through the two functions only.
    if (req.method() !== 'GET') { calls.push({ directWrite: req.method(), by: me.email }); return json(403, { code: '42501', message: 'permission denied' }); }
    if (before.none && /metricool_none/.test(cols)) return json(400, { code: '42703', message: 'column clients.metricool_none does not exist' });
    if (before.brand && /metricool_/.test(cols)) return json(400, { code: '42703', message: 'column clients.metricool_blog_id does not exist' });
    // Row level security: the office reads every client that is not archived; here nobody else has one.
    const rows = isOffice(me) ? tables.clients.filter((c) => !c.archived_at).filter(matcher(filtersOf(url))) : [];
    // Only the columns that were asked for come back (a column that is not there yet never does).
    const asked = new Set(cols.split(',').map((s) => s.trim()));
    return answer(req, json)(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('metricool_') || asked.has(k)))));
  }
  if (['reminder_log', 'deal_requests', 'quotes', 'staff_tasks'].includes(m[1])) return json(200, []);
  const rows = (tables[m[1]] || []).filter(matcher(filtersOf(url).filter(([k]) => k === 'id' || k === 'client_id')));
  return answer(req, json)(rows);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time: new Date(serverNow()) });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => tables.clients, staff: () => staff }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('request', (r) => { if (/metricool\.com/.test(r.url())) errors.push(`the browser called ${r.url()}`); });
  return page;
}
async function signIn(page, path, who) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.locator('#app:not([hidden])').waitFor();
}
const CARD = '#metricool-card';
const ROWS = `${CARD} .mcn-list:not(#mcn-none-list) > .mcn-row`;
const shot = async (page, name, fullPage = false) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage }); };
const text = (page, sel) => page.locator(sel).first().innerText();
const names = (page, visibleOnly = false) => page.evaluate(([sel, only]) => [...document.querySelectorAll(sel)].filter((li) => !only || !li.hidden).map((li) => li.querySelector('.mcn-name').textContent), [ROWS, visibleOnly]);
const rowOf = (page, label) => page.locator(ROWS, { has: page.locator('.mcn-name', { hasText: label }) });
const toastOf = (page) => page.locator('#toast.on > span').innerText();
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.offsetParent && el.getBoundingClientRect().height < 43.5)
  .map((el) => `${el.textContent.trim().slice(0, 20)}:${Math.round(el.getBoundingClientRect().height)}`), sel);
const lastCall = (name) => calls.filter((c) => c[name]).at(-1);
// The card is one line until asked for (the person's own work comes first): the title with its count and "הצגת הרשימה".
const openCard = async (page) => {
  const t = page.locator('#mcn-toggle');
  await t.waitFor();
  if ((await t.getAttribute('aria-expanded')) === 'false') {
    assert.equal(await page.locator(`${CARD} .mcn-row`).count(), 0);
    assert.equal((await t.innerText()).trim(), 'הצגת הרשימה');
    await t.click();
  }
};
const settled = async (page) => { await page.locator('#mine-list').waitFor(); await page.waitForLoadState('networkidle'); };
let passed = 0;
async function step(name, fn2) {
  try { await fn2(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last calls: ${JSON.stringify(calls.slice(-3)).slice(0, 900)}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

let exitCode = 0;
try {
  const ilai = await newPage();
  await signIn(ilai, 'clients.html#mine', 'ilai');

  await step('Ilai: the card under the exceptional contracts, every active client with no brand, the oldest deal first, 8 and "הצג עוד"', async () => {
    await ilai.locator(`${CARD}:not([hidden])`).waitFor();
    await openCard(ilai);
    assert.deepEqual(await ilai.evaluate(() => [...document.querySelectorAll('#view-mine > *')].slice(0, 6).map((e) => e.id)), ['now-bar', 'staff-tasks-card', 'deals-card', 'approvals-card', 'metricool-card', 'push-card']);
    assert.equal(await text(ilai, `${CARD} h2`), 'לקוחות שלא מחוברים ל־Metricool (11)');
    assert.equal(await text(ilai, `${CARD} .hint`), 'בוחרים לכל לקוח את המותג שלו ב־Metricool. לקוח שחובר יורד מהרשימה.');
    // The connected, the ended and the archived client are not in it.
    assert.deepEqual(await names(ilai), ORDER);
    assert.deepEqual(await names(ilai, true), ORDER.slice(0, CONNECT_CAP));
    assert.equal(await text(ilai, `${CARD} [data-more]`), 'הצג עוד (3)');
    assert.match(await rowOf(ilai, 'פיצה רון').innerText(), /פיצה רון · רון כהן\s*עסקה מ־31\.8\.2025\s*בחירת מותג/);
    // One action a row, and no pink button in the card.
    assert.equal(await ilai.locator(`${ROWS}:not([hidden]) button`).count(), CONNECT_CAP);
    assert.equal(await ilai.locator(`${CARD} .btn-primary`).count(), 0);
    assert.equal(await ilai.locator('#mcn-none-toggle').count(), 0);
    // Nothing was asked of Metricool, or of the function, to draw the list.
    assert.deepEqual(fn.calls, []);
    await shot(ilai, '01-ilai-desktop', true);
  });

  await step('"הצג עוד" shows the rest', async () => {
    await ilai.click(`${CARD} [data-more]`);
    assert.deepEqual(await names(ilai, true), ORDER);
    assert.equal(await ilai.locator(`${CARD} [data-more]`).count(), 0);
  });

  await step('"בחירת מותג" opens the row in place: the brands through the function, once; the suggestion chosen; a brand in use not choosable', async () => {
    await rowOf(ilai, 'פיצה רון').locator('[data-act="open"]').click();
    await ilai.locator('#mcn-brand').waitFor();
    assert.deepEqual(fn.calls, [{ action: 'brands', by: 'ilai@astrateg.test' }]);
    assert.equal(await ilai.evaluate(() => document.activeElement.id), 'mcn-brand');
    assert.deepEqual(await ilai.locator('#mcn-brand option').allInnerTexts(), ['לא נבחר מותג', 'Cafe Dana', 'פיצה רון (הצעה לפי השם)', 'מספרת יעל (מחובר ללקוח אחר)', 'מוסך הצפון', 'קפה דנה', 'Studio N']);
    assert.equal(await ilai.inputValue('#mcn-brand'), '12');
    assert.equal(await ilai.locator('#mcn-brand option[value="13"]').isDisabled(), true);
    assert.deepEqual(await ilai.locator(`${CARD} .mcn-row.is-open .mcn-acts > *`).allInnerTexts(), ['חיבור', 'ללקוח אין מותג', 'סגירה']);
    // The other rows keep their one button; only one row is open.
    assert.equal(await ilai.locator(`${CARD} .mcn-row.is-open`).count(), 1);
    assert.doesNotMatch(await text(ilai, CARD), /TOKEN|\bnull\b|undefined/);
    await shot(ilai, '02-ilai-row-open');
  });

  await step('"חיבור": the database is asked with the client and the brand; the row goes, and the next one opens with its own suggestion', async () => {
    await ilai.click(`${CARD} [data-act="save"]`);
    await ilai.locator(`${CARD} h2`, { hasText: '(10)' }).waitFor();
    const ron = byBusiness('פיצה רון');
    assert.deepEqual(lastCall('gantt_set_brand'), { gantt_set_brand: { p_client: ron.id, p_blog_id: '12', p_brand: 'פיצה רון' }, by: 'ilai@astrateg.test' });
    assert.deepEqual([ron.metricool_blog_id, ron.metricool_brand], ['12', 'פיצה רון']);
    assert.equal(await toastOf(ilai), 'פיצה רון · רון כהן חובר למותג ״פיצה רון״.');
    assert.deepEqual(await names(ilai), ORDER.slice(1));
    // The next client is open already, and the brands were not asked for again.
    assert.equal(await text(ilai, `${CARD} .mcn-row.is-open .mcn-name`), 'מוסך הצפון · משה');
    assert.equal(await ilai.inputValue('#mcn-brand'), '14');
    assert.equal(await ilai.evaluate(() => document.activeElement.id), 'mcn-brand');
    assert.equal(fn.calls.length, 1);
    // The brand just given is now in use.
    assert.equal(await ilai.locator('#mcn-brand option[value="12"]').isDisabled(), true);
    assert.equal(calls.filter((c) => c.directWrite).length, 0);
  });

  await step('no brand chosen: said in words, and nothing is sent; "סגירה" folds the row', async () => {
    await ilai.selectOption('#mcn-brand', '');
    const n = calls.length;
    await ilai.click(`${CARD} [data-act="save"]`);
    assert.equal(await text(ilai, '#mcn-err'), 'בוחרים מותג מהרשימה.');
    assert.equal(calls.length, n);
    await ilai.selectOption('#mcn-brand', '14');
    assert.ok(await ilai.locator('#mcn-err').isHidden());
    await ilai.click(`${CARD} [data-act="close"]`);
    assert.equal(await ilai.locator(`${CARD} .mcn-row.is-open`).count(), 0);
    assert.equal(await ilai.evaluate(() => document.activeElement.getAttribute('aria-label')), 'בחירת מותג: מוסך הצפון · משה');
    assert.equal(byBusiness('מוסך הצפון').metricool_blog_id, null);
  });

  await step('a client with no name close to a brand: nothing is chosen for him', async () => {
    await rowOf(ilai, 'אבי שיפוצים').locator('[data-act="open"]').click();
    await ilai.locator('#mcn-brand').waitFor();
    assert.equal(await ilai.inputValue('#mcn-brand'), '');
    assert.equal(fn.calls.length, 1);
  });

  await step('"ללקוח אין מותג": the client leaves the list; the toast\'s "ביטול" brings it back', async () => {
    const avi = byBusiness('אבי שיפוצים');
    await ilai.click(`${CARD} [data-act="none"]`);
    await ilai.locator(`${CARD} h2`, { hasText: '(9)' }).waitFor();
    assert.deepEqual(lastCall('metricool_set_none'), { metricool_set_none: { p_client: avi.id, p_on: true }, by: 'ilai@astrateg.test' });
    assert.deepEqual([avi.metricool_none, avi.metricool_none_by], [true, 'ilai@astrateg.test']);
    assert.equal(await toastOf(ilai), 'אבי שיפוצים · אבי סומן ״אין מותג״ וירד מהרשימה.');
    assert.ok(!(await names(ilai)).includes('אבי שיפוצים · אבי'));
    assert.equal(await text(ilai, '#mcn-none-toggle'), 'סומנו ״אין מותג״ (1)');
    await ilai.click('#toast .toast-act');
    await ilai.locator(`${CARD} h2`, { hasText: '(10)' }).waitFor();
    assert.deepEqual(lastCall('metricool_set_none').metricool_set_none, { p_client: avi.id, p_on: false });
    assert.equal(avi.metricool_none, false);
    assert.deepEqual(await names(ilai), ORDER.slice(1));
    assert.equal(await ilai.locator('#mcn-none-toggle').count(), 0);
  });

  await step('"סומנו ״אין מותג״": the marked clients, folded at the foot of the card, each with "החזרה לרשימה"', async () => {
    await ilai.click(`${CARD} [data-act="close"]`).catch(() => {});
    await rowOf(ilai, 'גיל נדל״ן').locator('[data-act="open"]').click();
    await ilai.locator('#mcn-brand').waitFor();
    await ilai.click(`${CARD} [data-act="none"]`);
    await ilai.locator('#mcn-none-toggle').waitFor();
    assert.equal(await text(ilai, `${CARD} h2`), 'לקוחות שלא מחוברים ל־Metricool (9)');
    assert.equal(await ilai.getAttribute('#mcn-none-toggle', 'aria-expanded'), 'false');
    assert.equal(await ilai.locator('#mcn-none-list').count(), 0);
    await ilai.click('#mcn-none-toggle');
    assert.equal(await ilai.getAttribute('#mcn-none-toggle', 'aria-expanded'), 'true');
    assert.match(await text(ilai, '#mcn-none-list .mcn-row'), /גיל נדל״ן · גיל\s*עסקה מ־\d+\.\d+\.2026\s*החזרה לרשימה/);
    await shot(ilai, '03-ilai-no-brand-list', true);
    await ilai.click('#mcn-none-list [data-act="back"]');
    await ilai.locator(`${CARD} h2`, { hasText: '(10)' }).waitFor();
    assert.equal(byBusiness('גיל נדל״ן').metricool_none, false);
    assert.equal(await toastOf(ilai), 'גיל נדל״ן · גיל חזר לרשימה.');
    assert.equal(await ilai.locator('#mcn-none-toggle').count(), 0);
    // Back in its place by the deal date.
    assert.deepEqual(await names(ilai), ORDER.slice(1));
  });

  await step('a brand someone else took in the meantime: refused in words, and the list is read again', async () => {
    await ilai.click(`${CARD} [data-act="close"]`).catch(() => {});
    await rowOf(ilai, 'קפה דנה').locator('[data-act="open"]').click();
    await ilai.locator('#mcn-brand').waitFor();
    assert.equal(await ilai.inputValue('#mcn-brand'), '15');
    // The owner gives that brand to another client from the Gantt.
    Object.assign(byBusiness('ליה אופנה'), { metricool_blog_id: '15', metricool_brand: 'קפה דנה' });
    await ilai.click(`${CARD} [data-act="save"]`);
    await ilai.locator(`${CARD} h2`, { hasText: '(9)' }).waitFor();
    assert.equal(await toastOf(ilai), 'המותג הזה כבר מחובר ללקוח אחר.');
    assert.equal(byBusiness('קפה דנה').metricool_blog_id, null);
    assert.ok(!(await names(ilai)).includes('ליה אופנה · ליה'));
    // His row is still open, and the brand is now marked as in use.
    assert.equal(await text(ilai, `${CARD} .mcn-row.is-open .mcn-name`), 'קפה דנה · דנה לוי');
    assert.equal(await ilai.locator('#mcn-brand option[value="15"]').isDisabled(), true);
    await ilai.selectOption('#mcn-brand', '11');
    await ilai.click(`${CARD} [data-act="save"]`);
    await ilai.locator(`${CARD} h2`, { hasText: '(8)' }).waitFor();
    assert.deepEqual([byBusiness('קפה דנה').metricool_blog_id, byBusiness('קפה דנה').metricool_brand], ['11', 'Cafe Dana']);
  });

  await step('Metricool does not answer: said in Hebrew, with a way to the client\'s Gantt and "ללקוח אין מותג"; asked again on the next open', async () => {
    fn.down = true;
    const page = await newPage();
    await signIn(page, 'clients.html#mine', 'ilai');
    await page.locator(`${CARD}:not([hidden])`).waitFor();
    await openCard(page);
    const before2 = fn.calls.length;
    await rowOf(page, 'מוסך הצפון').locator('[data-act="open"]').click();
    await page.locator('#mcn-err').waitFor();
    assert.equal(await text(page, '#mcn-err'), 'לא הצלחנו לקבל את רשימת המותגים. חסר סוד של Metricool ב־Vault.');
    assert.equal(await page.locator('#mcn-brand').count(), 0);
    assert.equal(await page.getAttribute(`${CARD} [data-act="gantt"]`, 'href'), `gantt.html?id=${byBusiness('מוסך הצפון').id}`);
    assert.deepEqual(await page.locator(`${CARD} .mcn-row.is-open .mcn-acts > *`).allInnerTexts(), ['פתיחת הגאנט של הלקוח', 'ללקוח אין מותג', 'סגירה']);
    await page.click(`${CARD} [data-act="close"]`);
    fn.down = false;
    await rowOf(page, 'מוסך הצפון').locator('[data-act="open"]').click();
    await page.locator('#mcn-brand').waitFor();
    assert.equal(fn.calls.length, before2 + 2);
    await page.context().close();
  });

  await step('the owner has the card and connects too; Irit, Lior and an editor have none; a sales agent lands on his own page', async () => {
    const owner = await newPage();
    await signIn(owner, 'clients.html#mine', 'owner');
    // Not among the owners' own tasks (8.10.2026; docs/ops.md, section 43): the card is in the
    // manager profile's "עבודת הצוות" (#team), where the owner connects as before.
    await settled(owner);
    assert.equal(await owner.locator(CARD).isVisible(), false, 'the card is on the personal tasks of the owners');
    await owner.goto(`${BASE}clients.html#team`);
    await owner.locator(`${CARD}:not([hidden])`).waitFor();
    await openCard(owner);
    assert.equal(await text(owner, `${CARD} h2`), 'לקוחות שלא מחוברים ל־Metricool (8)');
    await rowOf(owner, 'מוסך הצפון').locator('[data-act="open"]').click();
    await owner.locator('#mcn-brand').waitFor();
    await owner.click(`${CARD} [data-act="save"]`);
    await owner.locator(`${CARD} h2`, { hasText: '(7)' }).waitFor();
    assert.equal(lastCall('gantt_set_brand').by, 'owner@astrateg.test');
    assert.equal(byBusiness('מוסך הצפון').metricool_blog_id, '14');
    await shot(owner, '04-owner');
    await owner.context().close();
    const asked = fn.calls.length;
    for (const who of ['irit', 'lior', 'nadia']) {
      const page = await newPage(who === 'nadia' ? { width: 390, height: 844 } : undefined);
      await signIn(page, 'clients.html#mine', who);
      await settled(page);
      assert.ok(await page.locator(CARD).isHidden(), who);
      assert.equal(await page.locator(`${CARD} *`).count(), 0, who);
      await page.context().close();
    }
    const stav = await newPage({ width: 390, height: 844 });
    await signIn(stav, 'clients.html#mine', 'stav');
    await stav.waitForURL(/deal\.html/);
    await stav.waitForLoadState('networkidle');
    assert.equal(await stav.locator(CARD).count(), 0);
    assert.doesNotMatch(await stav.locator('body').innerText(), /Metricool/);
    await stav.context().close();
    assert.equal(fn.calls.length, asked, 'none of them asked for the brands');
  });

  const phone = await newPage({ width: 360, height: 760 });
  await step('a 360px phone: one column, no sideways scroll, every target at least 44px, also with a row open', async () => {
    await signIn(phone, 'clients.html#mine', 'ilai');
    await phone.locator(`${CARD}:not([hidden])`).waitFor();
    await openCard(phone);
    assert.equal(await text(phone, `${CARD} h2`), 'לקוחות שלא מחוברים ל־Metricool (7)');
    assert.equal(await noSideScroll(phone), true);
    assert.deepEqual(await smallTargets(phone, `${CARD} .btn, ${CARD} .btn-text, ${CARD} select`), []);
    await phone.locator(CARD).scrollIntoViewIfNeeded();
    await shot(phone, '05-ilai-phone-360');
    await rowOf(phone, 'אבי שיפוצים').locator('[data-act="open"]').click();
    await phone.locator('#mcn-brand').waitFor();
    assert.equal(await noSideScroll(phone), true);
    assert.deepEqual(await smallTargets(phone, `${CARD} .btn, ${CARD} .btn-text, ${CARD} select`), []);
    const box = await phone.locator(`${CARD} [data-act="save"]`).boundingBox();
    assert.ok(box.height >= 44 && box.width >= 200, `the "חיבור" button is ${Math.round(box.width)}×${Math.round(box.height)}`);
    await phone.locator(`${CARD} .mcn-row.is-open`).scrollIntoViewIfNeeded();
    await shot(phone, '06-ilai-phone-360-open');
  });

  await step('the last clients: the card counts down, and with nothing left to connect it is not there at all', async () => {
    const left = tables.clients.filter((c) => ['active', 'ending'].includes(c.status) && !c.archived_at && !c.metricool_blog_id);
    assert.equal(left.length, 7);
    // All but one get a brand elsewhere; the last one has none and needs none.
    left.slice(1).forEach((c, i) => Object.assign(c, { metricool_blog_id: String(500 + i), metricool_brand: `מותג ${i}` }));
    await phone.reload();
    await phone.locator(`${CARD}:not([hidden])`).waitFor();
    await openCard(phone);
    assert.equal(await text(phone, `${CARD} h2`), 'לקוחות שלא מחוברים ל־Metricool (1)');
    assert.equal(await phone.locator(`${CARD} [data-more]`).count(), 0);
    await phone.click(`${CARD} [data-act="open"]`);
    await phone.locator('#mcn-brand').waitFor();
    await phone.click(`${CARD} [data-act="none"]`);
    await phone.locator(CARD).waitFor({ state: 'hidden' });
    assert.equal(await phone.locator(`${CARD} *`).count(), 0);
    assert.equal(left[0].metricool_none, true);
    await phone.reload();
    await settled(phone);
    assert.ok(await phone.locator(CARD).isHidden());
    assert.equal(await noSideScroll(phone), true);
    await shot(phone, '07-ilai-phone-nothing-left');
    await phone.context().close();
  });

  await step('before the mark\'s migration: the list and "חיבור" work, with no "ללקוח אין מותג"; before Metricool\'s: no card', async () => {
    Object.assign(byBusiness('ליה אופנה'), { metricool_blog_id: null, metricool_brand: null });
    before.none = true;
    const early = await newPage();
    await signIn(early, 'clients.html#mine', 'ilai');
    await early.locator(`${CARD}:not([hidden])`).waitFor();
    await openCard(early);
    // The client marked "אין מותג" is read without the mark, so it is listed again.
    assert.equal(await text(early, `${CARD} h2`), 'לקוחות שלא מחוברים ל־Metricool (2)');
    await rowOf(early, 'ליה אופנה').locator('[data-act="open"]').click();
    await early.locator('#mcn-brand').waitFor();
    assert.deepEqual(await early.locator(`${CARD} .mcn-row.is-open .mcn-acts > *`).allInnerTexts(), ['חיבור', 'סגירה']);
    assert.equal(await early.locator('#mcn-none-toggle').count(), 0);
    await early.selectOption('#mcn-brand', '15');
    await early.click(`${CARD} [data-act="save"]`);
    await early.locator(`${CARD} h2`, { hasText: '(1)' }).waitFor();
    assert.equal(byBusiness('ליה אופנה').metricool_blog_id, '15');
    await early.context().close();
    before.brand = true;
    const earlier = await newPage();
    await signIn(earlier, 'clients.html#mine', 'ilai');
    await settled(earlier);
    assert.ok(await earlier.locator(CARD).isHidden());
    assert.equal(await earlier.locator(`${CARD} *`).count(), 0);
    await earlier.context().close();
    before.none = before.brand = false;
  });

  assert.equal(calls.filter((c) => c.directWrite).length, 0, 'the card never writes the clients table directly');
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`\n${passed} steps passed`);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await browser.close();
  noCspViolations();
}
process.exit(exitCode);
