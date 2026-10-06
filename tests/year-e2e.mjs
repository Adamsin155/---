// End-to-end check of the package year (stage 5; plan section 4, stations 7–8,
// decisions 31 and 33), against an in-memory fake of Supabase. The browser's clock
// is fixed on Thursday 12.11.2026 at 10:00 in Israel.
//  - The monthly cycle, a draft: each owner sees only their own items of it in
//    "המשימות שלי", labelled "טיוטה"; Ilai's plan of next month is due today; he marks
//    it and it leaves his list. Ofir sees his overdue report; an editor nothing.
//  - Versions: a client that started under version 4 is not late on the scripts'
//    shorter version-5 deadline (day 2), a version-5 client is; an item added after
//    a client started is tagged "חדש בפרוטוקול" in its card.
//  - year.html: the renewals within 90 days, soonest first, each with its results
//    summary (and the surveys' scores when the table is there); "הצעת חידוש" opens
//    the builder prefilled with the client and the current package. The month grid,
//    marking in someone's name, the protocol's versions. Irit sees the renewals,
//    Ofir only the months, an editor nothing; the link from clients.html.
//  - The client card's month block. A 360px phone: no sideways scrolling, 44px targets.
// Run: npx http-server -p 8080 -s . &  then  node tests/year-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { importKeys } from '../app/client-open.js';
import { buildQuoteModel, emptySelection } from '../app/pricing.js';
import { dateIL } from '../app/tz.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-11-12T10:00:00+02:00'); // Thursday
const t0 = Date.now();
const serverNow = () => new Date(NOW.getTime() + (Date.now() - t0)).toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;
// An Israel wall time ('2026-03-15T10:00:00'), whatever the season.
const IL = (s) => { const [d, t = '00:00:00'] = s.split('T'); const [y, mo, da] = d.split('-').map(Number); const [hh, mi] = t.split(':').map(Number); return dateIL(y, mo, da, hh, mi).toISOString(); };

// ── People ────────────────────────────────
const people = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia' };
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: person !== 'nadia', phone: null }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => staff.find((x) => x.email === u?.email)?.person;
const isOffice = (u) => { const p = personOf(u); return p === null || ['irit', 'lior', 'ofir', 'ilai'].includes(p); };

// ── Clients ───────────────────────────────
const client = (fields) => ({
  id: randomUUID(), name: '', business: null, address: null, phone: null, package_name: null, shoot_type: 'dms', characterizer: 'ofir',
  has_logo: true, editor_name: null, editor: null, deal_at: IL('2026-03-15T10:00:00'), char_at: IL('2026-03-16T10:00:00'), shoot_at: IL('2026-03-25T10:00:00'),
  contract_end: '2027-03-15', status: 'active', notes: null, quote_id: null, created_at: '2026-09-29T18:00:00Z',
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: { videos: 25, graphics: 35, shoot_days: 1 }, rounds: [], verified_at: null, verified_by: null,
  closed_reason: null, protocol_version: 4,
  ...fields,
});
const checks = [];
const done = (c, key, at, note = null, by = 'irit@astrateg.test') => checks.push({ client_id: c.id, item_key: key, state: 'done', note, by_email: by, at });
const imported = (c, station, at) => { for (const k of importKeys(station)) done(c, k, at, 'ייבוא'); };
const marks = [];
const mark = (c, month, item, by) => marks.push({ client_id: c.id, month, item, state: 'done', note: null, by_email: `${by}@astrateg.test`, at: IL('2026-10-20T12:00:00') });

// The renewals, soonest first: Galia (1.12), Ron (20.1), the old shop (1.2); Dana's ends in 111 days.
const QA = randomUUID();
const selection = { ...emptySelection(), docType: 'agreement', tier: 'social-tv', influencer: 'natali', paid: ['photographer', 'natali-story'] };
const model = buildQuoteModel(selection, { name: 'רון כהן', company: 'מספרת רון', phone: '', email: '', companyId: '' });
// Ron: month 8 of 10; Ilai's plan of month 9 (starting Sunday 15.11) is due today; Ofir's report and Lior's photographer are late.
const A = client({
  name: 'מספרת רון', shoot_type: 'natali', contract_end: '2027-01-20', quote_id: QA, package_name: 'Social + TV all in one · נטלי דדון',
  deliverables: { videos: 42, graphics: 42, shoot_days: 1, collabs: 0, stories: 1, ch14: 1, monthly: 96, done: { videos: 30, graphics: 40, ch14: 1 } },
});
imported(A, 'ongoing', IL('2026-04-10T09:00:00'));
done(A, 'p34.state', IL('2026-11-10T12:00:00'), null, 'lior@astrateg.test');
mark(A, 8, 'plan', 'ilai'); mark(A, 8, 'posted', 'ilai'); mark(A, 8, 'photo', 'irit');
// Galia: a six-month package, month 6 all done.
const B = client({
  name: 'קפה גליה', deal_at: IL('2026-06-01T10:00:00'), char_at: IL('2026-06-02T10:00:00'), shoot_at: IL('2026-06-10T10:00:00'), contract_end: '2026-12-01',
  package_name: 'Social all in one · סמיון, מישל ודניס', deliverables: { videos: 25, graphics: 35, shoot_days: 1, collabs: 1, stories: 0, ch14: 0, monthly: 0 },
});
imported(B, 'ongoing', IL('2026-06-20T09:00:00'));
mark(B, 6, 'plan', 'ilai'); mark(B, 6, 'posted', 'ilai'); mark(B, 6, 'report', 'ofir');
// The old shop: brought in this month, its cycle starts next month.
const F = client({
  name: 'חנות ישנה', deal_at: IL('2026-02-01T10:00:00'), char_at: IL('2026-02-02T10:00:00'), shoot_at: IL('2026-02-10T10:00:00'), contract_end: '2027-02-01',
  package_name: 'Social + TV all in one · סמיון, מישל ודניס', deliverables: { videos: 42, graphics: 42, shoot_days: 2, collabs: 3, stories: 3, ch14: 1, monthly: 0 },
});
imported(F, 'ongoing', IL('2026-11-05T09:00:00'));
// Scripts: characterization Monday 9.11. Dana started under version 4 (day 3: today), Napoli under 5 (day 2: yesterday), Shai under 1.
const scripts = (fields) => {
  const c = client({ deal_at: IL('2026-11-08T09:00:00'), char_at: IL('2026-11-09T10:00:00'), shoot_at: null, contract_end: '2027-11-08', ...fields });
  imported(c, 'content', IL('2026-11-09T12:00:00'));
  for (const k of ['read', 'call', ...['services', 'products', 'messages', 'dont', 'offers', 'faq', 'topics', 'objections', 'advantages', 'focus'].map((x) => `t.${x}`)]) done(c, `p12a.${k}`, IL('2026-11-09T16:00:00'), null, 'lior@astrateg.test');
  return c;
};
const C = scripts({ name: 'סטודיו דנה', protocol_version: 4, contract_end: '2027-03-03' });
const D = scripts({ name: 'פיצה נאפולי', protocol_version: 5, created_at: '2026-11-08T07:00:00Z' });
const G = scripts({ name: 'מאפיית שי', protocol_version: 1, created_at: '2026-09-29T12:00:00Z' });
const E = client({ name: 'גן אירועים', status: 'ended', contract_end: '2026-12-15' });

const db = {
  staff,
  clients: [A, B, F, C, D, G, E],
  protocol_checks: checks,
  protocol_log: checks.map((c, i) => ({ id: i + 1, client_id: c.client_id, item_key: c.item_key, action: c.state, note: c.note, by_email: c.by_email, at: c.at })),
  client_tasks: [],
  office_reviews: [],
  client_status_notes: [],
  client_messages: [],
  client_access: [],
  client_access_log: [],
  client_date_changes: [],
  client_questions: [],
  client_month_marks: marks,
  client_surveys: [
    { id: 1, client_id: A.id, kind: 'shoot', score: 5, respondent: 'דנה', question: 'q', source: 'page', link_id: null, recorded_by: '', at: '2026-10-02T08:00:00Z', task_id: null },
    { id: 2, client_id: A.id, kind: 'delivery', score: 4, respondent: 'דנה', question: 'q', source: 'office', link_id: null, recorded_by: 'irit@astrateg.test', at: '2026-10-20T08:00:00Z', task_id: null },
  ],
  quotes: [{ id: QA, number: 'AST-7', signed_at: IL('2026-03-15T10:00:00'), model }],
};

// ── Fake PostgREST ─────────────────────────
const unq = (s) => s.replace(/^"(.*)"$/, '$1');
function match(r, k, v) {
  if (v.startsWith('eq.')) return String(r[k]) === unq(v.slice(3));
  if (v.startsWith('neq.')) return String(r[k]) !== unq(v.slice(4));
  if (v.startsWith('gte.')) return String(r[k] ?? '') >= unq(v.slice(4));
  if (v.startsWith('in.(')) return new Set(v.slice(4, -1).split(',').map(unq)).has(String(r[k]));
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
  return true;
}
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    out = out.filter((r) => match(r, k, v));
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
  const me = userOf(headers);
  const now = serverNow();
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
  if (p === '/rest/v1/rpc/can_use_vault' || p === '/rest/v1/rpc/can_use_client_vault') return json(200, !!me && !!staff.find((r) => r.email === me.email)?.vault);
  if (p.startsWith('/rest/v1/rpc/')) return json(404, { code: 'PGRST202', message: 'not found' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { code: '42P01', message: 'relation does not exist' });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  // Row level security, as the migrations have it: the month marks are the office's.
  if (table === 'client_month_marks' && !isOffice(me)) return req.method() === 'GET' ? reply([]) : json(403, { code: '42501', message: 'new row violates row-level security policy for table "client_month_marks"' });
  if (req.method() === 'GET') {
    let rows = applyFilters(db[table], url.searchParams);
    // select=…,selection:model->selection,client:model->client
    if (table === 'quotes') rows = rows.map((q) => ({ id: q.id, number: q.number, signed_at: q.signed_at, selection: q.model.selection, client: q.model.client, package: q.model.package, paid: q.model.paid, free: q.model.free }));
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    return reply(rows.slice(off, off + lim));
  }
  if (req.method() === 'POST') {
    const out = [];
    for (const r of Array.isArray(body) ? body : [body]) {
      const row = { note: null, ...r, by_email: me.email, at: now };
      const key = table === 'client_month_marks' ? ['client_id', 'month', 'item'] : table === 'protocol_checks' ? ['client_id', 'item_key'] : null;
      const i = key ? db[table].findIndex((x) => key.every((k) => String(x[k]) === String(row[k]))) : -1;
      if (i >= 0) db[table][i] = row; else db[table].push(row);
      out.push(row);
    }
    return reply(out);
  }
  if (req.method() === 'DELETE') {
    const rows = applyFilters(db[table], url.searchParams);
    db[table] = db[table].filter((r) => !rows.includes(r));
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  if (req.method() === 'PATCH') {
    const rows = applyFilters(db[table], url.searchParams);
    for (const r of rows) Object.assign(r, body);
    return reply(rows);
  }
  return json(405, { message: `unexpected ${req.method()} on ${table}` });
}

// ── Browser ────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newContext(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  // These checks walk the whole list of "המשימות שלי" ("תצוגה מלאה"); the short one is tests/roles-phone-e2e.mjs.
  await ctx.addInitScript(() => { try { localStorage.setItem('astrateg.mine.full', 'on'); } catch { /* no storage */ } });
  await ctx.clock.install({ time: NOW });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msgx) => { if (msgx.type() === 'error' && !/Failed to load resource/.test(msgx.text())) errors.push(msgx.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, path, email) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
}
const text = (page, sel) => page.locator(sel).innerText();
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const toastHas = (page, t) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), t);
// Interactive targets smaller than 44px in a region (links inside running text excepted).
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} button, ${s} a.btn, ${s} summary, ${s} .irow`)]
  .filter((el) => el.offsetParent !== null).map((el) => [el.textContent.trim().slice(0, 30), Math.round(el.getBoundingClientRect().height)])
  .filter(([, hgt]) => hgt < 44), sel);
let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// ── Ilai ──────────────────────────────────
const ictx = await newContext();
const ilai = await newPage(ictx);

await step('Ilai: his items of the monthly cycle in "המשימות שלי", labelled a draft; next month\'s plan due today', async () => {
  await signIn(ilai, 'clients.html#mine', 'ilai@astrateg.test');
  await ilai.waitForSelector('#my-months:not([hidden]) .mitem');
  const box = ilai.locator('#my-months');
  assert.match(await box.locator('#mc-h').innerText(), /המחזור החודשי\s*טיוטה\s*1/);
  assert.match(await box.innerText(), /טיוטה — עד שיהיה פרוטוקול כתוב \(החלטה 31\)/);
  const items = box.locator('.mitem');
  assert.equal(await items.count(), 1);
  assert.match(await box.locator('.mc-head').innerText(), /^מספרת רון · חודש 8 מתוך 10$/);
  assert.match(await items.nth(0).innerText(), /חודש 9 מתוכנן: התכנים מתוזמנים והגאנט מעודכן[^]*טיוטה[^]*עילאי[^]*היום · עד/);
  assert.equal(await box.locator('.mc-head a').getAttribute('href'), `client.html?id=${A.id}#month`);
  // Nothing of Galia (all done) or of the old shop (its cycle starts next month); nothing of others.
  assert.doesNotMatch(await box.innerText(), /קפה גליה|חנות ישנה|דוח חודשי|צלם/);
  // Right after the tools, before the list (and the list's foot: its length, the short list's tools).
  assert.deepEqual(await ilai.evaluate(() => [...document.querySelectorAll('#view-mine > *')].map((e) => e.id).slice(-3)), ['my-months', 'mine-list', 'mine-foot']);
  await ilai.waitForSelector('#side-year');
  assert.equal(await ilai.getAttribute('#side-year', 'href'), 'year.html');
  await shot(ilai, 'year-01-ilai-mine');
});

await step('Ilai on a phone (360px): the list fits, targets are 44px', async () => {
  const pctx = await newContext({ width: 360, height: 780 });
  const ph = await newPage(pctx);
  await signIn(ph, 'clients.html#mine', 'ilai@astrateg.test');
  await ph.waitForSelector('#my-months:not([hidden]) .mitem');
  assert.equal(await noHScroll(ph), true);
  assert.deepEqual(await smallTargets(ph, '#my-months'), []);
  await shot(ph, 'year-02-ilai-360');
  await pctx.close();
});
await step('Ilai marks it: saved for month 9 in his name, and it leaves his list (with an undo)', async () => {
  // click(), not check(): the marked item leaves the list at once (check() would look
  // for it again to see it checked, until its timeout).
  await ilai.locator('#my-months .mitem .cbx').click();
  await toastHas(ilai, 'סומן: חודש 9 מתוכנן');
  const row = db.client_month_marks.find((r) => r.client_id === A.id && r.month === 9 && r.item === 'plan');
  assert.deepEqual([row?.state, row?.by_email, row?.note], ['done', 'ilai@astrateg.test', null]);
  await ilai.waitForSelector('#my-months', { state: 'hidden' });
  await ilai.click('#toast .toast-act');
  await ilai.waitForSelector('#my-months:not([hidden]) .mitem');
  assert.equal(db.client_month_marks.some((r) => r.client_id === A.id && r.month === 9), false);
  await ilai.locator('#my-months .mitem .cbx').click();
  await ilai.waitForSelector('#my-months', { state: 'hidden' });
  assert.equal(db.client_month_marks.find((r) => r.client_id === A.id && r.month === 9 && r.item === 'plan')?.state, 'done');
});

await ictx.close();

// ── Ofir, an editor ───────────────────────
await step('Ofir sees his late report (and no one else\'s items); an editor sees no cycle and no link to the year', async () => {
  const octx = await newContext();
  const ofir = await newPage(octx);
  await signIn(ofir, 'clients.html#mine', 'ofir@astrateg.test');
  await ofir.waitForSelector('#my-months:not([hidden]) .mitem');
  const items = ofir.locator('#my-months .mitem');
  assert.equal(await items.count(), 1);
  assert.match(await items.nth(0).innerText(), /דוח חודשי על חודש 7 נשלח ללקוח[^]*אופיר[^]*באיחור · עד/);
  assert.equal(await items.nth(0).evaluate((el) => el.classList.contains('s-overdue')), true);
  await octx.close();
  const nctx = await newContext();
  const nadia = await newPage(nctx);
  await signIn(nadia, 'clients.html#mine', 'nadia@astrateg.test');
  await nadia.waitForSelector('#app:not([hidden])');
  await nadia.waitForTimeout(300);
  assert.equal(await nadia.isHidden('#my-months'), true);
  assert.equal(await nadia.isHidden('#cta-year'), true);
  await nadia.waitForSelector('#side-list .side-link');
  assert.equal(await nadia.locator('#side-year').count(), 0);
  await nadia.goto(`${BASE}year.html`);
  await nadia.waitForSelector('#no-access:not([hidden])');
  assert.equal(await nadia.isHidden('#yr-page'), true);
  await nctx.close();
});

// ── Lior ──────────────────────────────────
const lctx = await newContext();
const lior = await newPage(lctx);

await step('versions: Dana (version 4) is not late on the scripts\' version-5 deadline; Napoli (version 5) is; Shai (version 1) neither', async () => {
  await signIn(lior, 'clients.html#mine', 'lior@astrateg.test');
  await lior.waitForSelector('#mine-list .wproc');
  const card = (c) => lior.locator(`#mine-list .wproc[data-key="${c.id}:p12"]`);
  assert.equal(await card(D).evaluate((el) => el.classList.contains('s-overdue')), true);
  assert.equal(await lior.locator(`#mine-list .g-overdue .wproc[data-key="${D.id}:p12"]`).count(), 1);
  assert.equal(await card(C).evaluate((el) => el.classList.contains('s-today')), true);
  assert.equal(await lior.locator(`#mine-list .g-overdue .wproc[data-key="${C.id}:p12"]`).count(), 0);
  assert.equal(await lior.locator(`#mine-list .g-today .wproc[data-key="${C.id}:p12"]`).count(), 1);
  assert.equal(await card(G).evaluate((el) => el.classList.contains('s-today')), true);
  // His own item of the cycle: the monthly photographer, late.
  assert.match(await lior.locator('#my-months').innerText(), /הצלם החודשי צילם, והתכנים \(8 תכנים\) עברו לעריכה/);
  await shot(lior, 'year-03-lior-mine');
});

await step('the card of a client from version 1: items added later are tagged "חדש בפרוטוקול" and never late', async () => {
  await lior.goto(`${BASE}client.html?id=${G.id}#p12`);
  await lior.waitForSelector('#p12');
  const tag = lior.locator('#p12 .tag-fresh');
  assert.equal(await tag.count(), 1);
  assert.match(await tag.innerText(), /^חדש בפרוטוקול \(גרסה 2\) · לא נספר באיחור$/);
  assert.match(await lior.locator('#p12').innerText(), /לכל סרטון מספר ברור/);
  await lior.goto(`${BASE}client.html?id=${C.id}#p12`);
  await lior.waitForSelector('#p12');
  assert.equal(await lior.locator('#p12 .tag-fresh').count(), 0);
});

await step('year.html: the renewals within 90 days, soonest first, with the results and the stage of 34', async () => {
  await lior.goto(`${BASE}year.html`);
  await lior.waitForSelector('#rn-list .yr-renew');
  assert.equal(await lior.isVisible('#yr-draft'), true);
  assert.match(await text(lior, '#yr-draft'), /המחזור החודשי הוא טיוטה — עד שיהיה פרוטוקול כתוב/);
  const names = await lior.locator('#rn-list .yr-renew .wclient').allInnerTexts();
  assert.deepEqual(names, ['קפה גליה', 'מספרת רון', 'חנות ישנה']);
  assert.equal(await text(lior, '#rn-n'), '3');
  const ron = lior.locator(`#rn-list .yr-renew[data-id="${A.id}"]`);
  const t = await ron.innerText();
  assert.match(t, /Social \+ TV all in one · נטלי דדון/);
  assert.match(t, /מסתיים 20\.1\.2027\s*· בעוד 69 ימים/);
  assert.match(t, /תהליך 34: 1 מתוך 5/);
  assert.match(t, /סרטונים\s*42 מתוך 42/);
  assert.match(t, /גרפיקות\s*42 מתוך 42/);
  assert.match(t, /אייטם בערוץ 14\s*1 מתוך 1/);
  assert.match(t, /ימי צילום\s*1 מתוך 1/);
  assert.match(t, /בזמן\s*אין עדיין תהליכים שנסגרו במערכת/);
  assert.match(t, /מחזור חודשי \(טיוטה\)\s*\d+ מתוך \d+ פריטים/);
  assert.match(t, /שביעות רצון\s*4\.5 מתוך 5 \(2 תשובות\)/);
  assert.match(await text(lior, `#rn-list .yr-renew[data-id="${B.id}"]`), /מסתיים 1\.12\.2026\s*· בעוד 19 ימים[^]*תהליך 34 עוד לא התחיל[^]*שביעות רצון\s*אין עדיין ציונים במערכת/);
  assert.match(await text(lior, '#renewals .hint'), /יוצאת ידנית/);
  await shot(lior, 'year-04-renewals');
});

await step('"הצעת חידוש" opens the builder prefilled: the client from the agreement and the current package; nothing is sent', async () => {
  const link = lior.locator(`#rn-${A.id}-quote`);
  assert.equal(await link.getAttribute('href'), './');
  const before = db.quotes.length;
  await link.click();
  await lior.waitForURL((u) => new URL(u).pathname.endsWith('/') || new URL(u).pathname.endsWith('/index.html'));
  await lior.waitForSelector('#c-name');
  await lior.waitForFunction(() => document.getElementById('c-name').value !== '');
  assert.equal(await lior.inputValue('#c-name'), 'רון כהן');
  assert.equal(await lior.inputValue('#c-company'), 'מספרת רון');
  assert.equal(await lior.isChecked('#tier-social-tv'), true);
  assert.equal(await lior.isChecked('#inf-natali'), true);
  assert.equal(await lior.isChecked('#paid-photographer'), true);
  assert.equal(await lior.evaluate(() => document.body.classList.contains('is-choosing')), false);
  assert.equal(db.quotes.length, before);
  await shot(lior, 'year-05-quote');
  // Galia, opened by hand: from the package's name.
  await lior.goto(`${BASE}year.html#renewals`);
  await lior.waitForSelector(`#rn-${B.id}-quote`);
  await lior.click(`#rn-${B.id}-quote`);
  await lior.waitForSelector('#c-name');
  await lior.waitForFunction(() => document.getElementById('c-name').value === 'קפה גליה');
  assert.equal(await lior.isChecked('#tier-social'), true);
  assert.equal(await lior.isChecked('#inf-simeon'), true);
});

await step('the month grid: which month each client is in, this month\'s items, marking in Ofir\'s name', async () => {
  await lior.goto(`${BASE}year.html#months`);
  await lior.waitForSelector('#mo-list .yr-row');
  const ron = lior.locator(`#mo-list .yr-row[data-id="${A.id}"]`);
  assert.match(await ron.locator('.of-head').innerText(), /מספרת רון\s*חודש 8 מתוך 10\s*התחיל בגרסה 4 של הפרוטוקול/);
  const cells = ron.locator('.yr-cell');
  assert.equal(await cells.count(), 10);
  assert.equal(await cells.nth(0).evaluate((el) => el.classList.contains('c-before')), true);
  assert.equal(await cells.nth(7).evaluate((el) => el.classList.contains('is-now') && el.classList.contains('c-late')), true);
  assert.match(await cells.nth(7).innerText(), /חודש 8 מתוך 10 \(החודש\): 3 מתוך 5 בוצעו, 2 באיחור/);
  assert.equal(await cells.nth(8).evaluate((el) => el.classList.contains('c-future')), true);
  assert.match(await ron.locator('.yr-status').innerText(), /^החודש: 3 מתוך 5 בוצעו · 2 באיחור$/);
  // Late items open the list by themselves; the report is Ofir's, Lior marks it in his name.
  const details = ron.locator('details.yr-items');
  assert.equal(await details.evaluate((el) => el.open), true);
  const report = ron.locator('.mitem', { hasText: 'דוח חודשי על חודש 7' });
  await report.locator('.cbx').check();
  await toastHas(lior, 'סומן: דוח חודשי');
  const row = db.client_month_marks.find((r) => r.client_id === A.id && r.month === 8 && r.item === 'report');
  assert.deepEqual([row?.state, row?.by_email, row?.note], ['done', 'lior@astrateg.test', 'בשם אופיר']);
  assert.match(await ron.locator('.yr-status').innerText(), /4 מתוך 5 בוצעו · 1 באיחור/);
  // Galia is done this month; Dana has no cycle yet; the ended client is not listed.
  assert.match(await text(lior, `#mo-list .yr-row[data-id="${B.id}"] .yr-status`), /^החודש: 3 מתוך 3 בוצעו$/);
  assert.match(await text(lior, `#mo-list .yr-row[data-id="${C.id}"] .yr-status`), /המחזור מתחיל בחודש שאחרי התזמון הראשון \(28\)/);
  assert.match(await text(lior, `#mo-list .yr-row[data-id="${F.id}"] .yr-status`), /המחזור מתחיל בחודש 11/);
  assert.equal(await lior.locator(`#mo-list .yr-row[data-id="${E.id}"]`).count(), 0);
  await shot(lior, 'year-06-months');
});

await step('the protocol\'s versions: what changed in each, and how many clients started under which', async () => {
  const v = lior.locator('#versions');
  assert.equal(await v.locator('.yr-versions > li').count(), 7); // versions 1 to 7
  assert.match(await v.locator('.yr-versions > li').first().innerText(), /גרסה 7 · העלאת ה־Highlights לרשתות[^]*פריט חדש אחד[^]*נוסף 8ב/);
  assert.match(await v.innerText(), /גרסה 6 · יום הצילום מיד אחרי פתיחת הקבוצה[^]*3 פריטים חדשים/);
  assert.match(await v.innerText(), /גרסה 5 · זרימות המשרד והאפיון[^]*התסריטים עד סוף יום העסקים השני/);
  assert.match(await v.innerText(), /גרסה 4 · הפרוטוקול של הצלם[^]*15 פריטים חדשים/);
  assert.match(await v.innerText(), /גרסה 5: לקוח אחד · גרסה 4: 4 לקוחות · גרסה 1: לקוח אחד/);
});

await step('the client card: the month block, a draft, marked in place', async () => {
  await lior.goto(`${BASE}client.html?id=${A.id}#month`);
  await lior.waitForSelector('#month .mitem');
  const box = lior.locator('#month');
  assert.match(await box.locator('#mc-card-h').innerText(), /המחזור החודשי · חודש 8 מתוך 10\s*טיוטה/);
  assert.match(await box.innerText(), /4 מתוך 5 בוצעו · 1 באיחור/);
  assert.equal(await box.locator('.mitem').count(), 5);
  assert.equal(await lior.evaluate(() => document.activeElement?.id), 'month');
  const photo = box.locator('.mitem', { hasText: 'הצלם החודשי צילם' });
  await photo.locator('.na-btn').click();
  await lior.waitForFunction(() => document.querySelector('#month')?.textContent.includes('5 מתוך 5 בוצעו'));
  assert.equal(db.client_month_marks.find((r) => r.client_id === A.id && r.month === 8 && r.item === 'photoshot')?.state, 'na');
  await shot(lior, 'year-07-card');
});
await lctx.close();

// ── Irit and Ofir on year.html; the phone ─
await step('Irit sees the renewals (and reaches the page from clients.html); Ofir only the months', async () => {
  const ictx2 = await newContext();
  const irit = await newPage(ictx2);
  await signIn(irit, 'clients.html#mine', 'irit@astrateg.test');
  await irit.click('#side-year');
  await irit.waitForSelector('#rn-list .yr-renew');
  assert.equal(await irit.locator('#rn-list .yr-renew').count(), 3);
  await ictx2.close();
  const octx = await newContext();
  const ofir = await newPage(octx);
  await signIn(ofir, 'year.html', 'ofir@astrateg.test');
  await ofir.waitForSelector('#mo-list .yr-row');
  assert.equal(await ofir.isHidden('#renewals'), true);
  assert.equal(await ofir.locator('#yr-jump a[href="#renewals"]').count(), 0);
  await octx.close();
});

await step('a 360px phone: year.html without sideways scrolling, 44px targets', async () => {
  const pctx = await newContext({ width: 360, height: 780 });
  const ph = await newPage(pctx);
  await signIn(ph, 'year.html', 'lior@astrateg.test');
  await ph.waitForSelector('#rn-list .yr-renew');
  await ph.waitForSelector('#mo-list .yr-row');
  assert.equal(await noHScroll(ph), true);
  assert.deepEqual(await smallTargets(ph, '#rn-list'), []);
  assert.deepEqual(await smallTargets(ph, '#mo-list'), []);
  await shot(ph, 'year-08-phone');
  await ph.goto(`${BASE}client.html?id=${A.id}#month`);
  await ph.waitForSelector('#month .mitem');
  assert.equal(await noHScroll(ph), true);
  await pctx.close();
});

await browser.close();
noCspViolations();
assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`);
console.log(`\n${passed} passed`);
