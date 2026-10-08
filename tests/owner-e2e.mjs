// End-to-end check of the owner's screens (owner.html, app/owner.js), the client's
// colour in the card, the questions in "המשימות שלי" and the team screen's rule
// (decision 22), against an in-memory fake of Supabase. The browser's clock is
// fixed on Tuesday 20.10.2026 at 10:00 in Israel.
//  - The owner lands on screen 1 ("מה דורש אותי") from clients.html, with a link back.
//  - Four numbers, rows most severe first, one name each, "פתיחה" and "שאלה לאחראי";
//    the question reaches Lior's "המשימות שלי", he answers there, the answer shows in the row.
//  - Screen 2: two lines per client, a tap opens the rest; the board of the week / 30 days.
//  - The managers (the owner, Irit, Ofir) open screen 1; Lior screen 2 but not screen 1; an editor neither; a worker sees only
//    their own row of the team screen, the owner and Lior everyone.
//  - The client card: three lines (colour and why, now, next), the timeline and the
//    questions asked about the client. After landing, "לקוחות" opens the list; a
//    question is offered only to someone who can sign in; on a phone Lior reaches
//    screen 2 from the page head.
//  - Everything green: "הכול לפי התוכנית". A 360px phone: no sideways scrolling, 44px targets.
// Run: npx http-server -p 8080 -s . &  then  node tests/owner-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { importKeys } from '../app/client-open.js';
import { applicableProcesses, clientState } from '../app/protocol-logic.js';
import { clientHealth } from '../app/health.js';
import { daySummary, headline, EMPTY_DAY } from '../app/day-summary.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-10-20T10:00:00+03:00'); // Tuesday
const t0 = Date.now();
const serverNow = () => new Date(NOW.getTime() + (Date.now() - t0));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;

// ── People ────────────────────────────────
const people = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', nadia: 'nadia' };
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: person !== 'nadia', phone: null }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => { const r = staff.find((x) => x.email === u?.email); return r ? r.person : undefined; }; // null: the owner
// can_ask_questions(): the owner, Irit, Lior and Ofir.
const office = (u) => { const p = personOf(u); return p === null || ['irit', 'lior', 'ofir'].includes(p); };

// ── Clients ───────────────────────────────
const client = (id, fields) => ({
  id, name: '', business: null, address: null, phone: null, package_name: 'Social all in one · נטלי דדון', shoot_type: 'dms', characterizer: 'ofir',
  has_logo: true, editor_name: null, editor: null, deal_at: '2026-10-11T09:00:00+03:00', char_at: '2026-10-12T10:00:00+03:00', shoot_at: null,
  contract_end: '2027-10-11', status: 'active', notes: null, quote_id: null, created_at: '2026-10-11T09:00:00+03:00',
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: {}, rounds: [], verified_at: null, verified_by: null, closed_reason: null,
  // Started under protocol version 5: 11 is due 3 business days after the meeting (v6: tests/owner-decisions.test.mjs).
  protocol_version: 5,
  ...fields,
});
const keysFor = (c, ids) => applicableProcesses(c).filter((p) => ids.includes(p.id)).flatMap((p) => p.items.filter((i) => !i.optional).map((i) => i.key));
const checks = [];
const doneAll = (c, ids, at, by = 'irit@astrateg.test') => { for (const k of keysFor(c, ids)) checks.push({ client_id: c.id, item_key: k, state: 'done', note: null, by_email: by, at }); };
const one = (c, key, at, note = null, by = 'irit@astrateg.test') => checks.push({ client_id: c.id, item_key: key, state: 'done', note, by_email: by, at });
const JOIN = ['p01', 'p02', 'p03'];
const CHAR = ['p04', 'p05', 'p06', 'p07', 'p07b', 'p08', 'p08b', 'p09', 'p10'];
const onboard = (c) => { doneAll(c, JOIN, '2026-10-11T09:03:00+03:00'); doneAll(c, CHAR, '2026-10-12T12:00:00+03:00'); };

// Red: the shoot is tomorrow (Wednesday), a business day away, and the client has not approved the scripts.
const A = client('aaaaaaaa-0000-4000-8000-000000000001', { name: 'מספרת רון', shoot_at: '2026-10-21T11:00:00+03:00', address: 'הרצל 10' });
onboard(A);
doneAll(A, ['p11', 'p12a', 'p12'], '2026-10-14T12:00:00+03:00', 'lior@astrateg.test');
one(A, 'p13.zoom', '2026-10-19T12:00:00+03:00', null, 'lior@astrateg.test');
// Red: setting the shoot day (11) is 3 business days late, Irit's.
const B = client('bbbbbbbb-0000-4000-8000-000000000002', { name: 'קפה גליה' });
onboard(B);
doneAll(B, ['p12a', 'p12', 'p13'], '2026-10-15T12:00:00+03:00', 'lior@astrateg.test');
// Yellow: waiting on the client for 4 business days (never the team's delay).
const C = client('cccccccc-0000-4000-8000-000000000003', { name: 'סטודיו דנה' });
onboard(C);
doneAll(C, ['p12a', 'p12', 'p13'], '2026-10-15T12:00:00+03:00', 'lior@astrateg.test');
one(C, 'p11.wait', '2026-10-14T10:00:00+03:00', JSON.stringify({ reason: 'הלקוח לא מאשר תאריך לצילום', recheck: null }));
// Green: a new deal this morning, its meeting on Thursday.
const D = client('dddddddd-0000-4000-8000-000000000004', { name: 'פיצה נאפולי', deal_at: '2026-10-20T09:00:00+03:00', created_at: '2026-10-20T09:00:00+03:00', char_at: '2026-10-22T09:00:00+03:00' });
doneAll(D, JOIN, '2026-10-20T09:03:00+03:00');
// Protocol v6: the shoot day is set right after the group (due the next business day): done here.
doneAll(D, ['p11'], '2026-10-20T09:30:00+03:00');
// Green: an imported client in the ongoing station, its weekly call made yesterday.
const E = client('eeeeeeee-0000-4000-8000-000000000005', {
  name: 'חנות ישנה', deal_at: '2026-03-01T09:00:00+02:00', char_at: '2026-03-03T10:00:00+02:00', shoot_at: '2026-03-10T10:00:00+02:00', contract_end: '2027-03-01',
  deliverables: { videos: 25, graphics: 35, shoot_days: 1, done: { videos: 25, graphics: 35 } },
});
for (const k of importKeys('ongoing')) one(E, k, '2026-10-01T09:00:00+03:00', 'ייבוא');
one(E, 'p31.call', '2026-10-19T12:00:00+03:00', null, 'lior@astrateg.test');
const F = client('ffffffff-0000-4000-8000-000000000006', { name: 'גן אירועים', status: 'ended' });

const msg = (c, at) => ({ id: randomUUID(), client_id: c.id, kind: 'daily', template_key: 'daily.content', ref: null, body: 'היי', sent_by_email: 'irit@astrateg.test', sent_at: new Date(at).toISOString() });
const db = {
  staff,
  clients: [A, B, C, D, E, F],
  protocol_checks: checks,
  protocol_log: checks.map((c, i) => ({ id: i + 1, client_id: c.client_id, item_key: c.item_key, action: c.state, note: c.note, by_email: c.by_email, at: c.at })),
  client_tasks: [],
  // Ofir's review (33) was done yesterday; Irit's (32) was not.
  office_reviews: [{ day: '2026-10-19', kind: 'p33', note: null, by_email: 'ofir@astrateg.test', at: '2026-10-19T15:00:00+03:00', note_by: null, note_at: null }],
  client_status_notes: [],
  client_messages: [msg(A, '2026-10-19T10:00:00+03:00'), msg(B, '2026-10-19T10:00:00+03:00'), msg(C, '2026-10-19T10:00:00+03:00')],
  client_access: [],
  client_date_changes: [],
  client_questions: [],
  quotes: [],
};

// ── Fake PostgREST ─────────────────────────
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith('neq.')) out = out.filter((r) => String(r[k]) !== v.slice(4));
    else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    else if (v === 'not.is.null') out = out.filter((r) => r[k] !== null && r[k] !== undefined);
    else if (v.startsWith('gte.')) out = out.filter((r) => String(r[k]) >= v.slice(4));
    else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')); out = out.filter((r) => set.includes(String(r[k]))); }
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split(',')[0].split('.');
    out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
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
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
  if (p === '/rest/v1/rpc/can_use_vault') return json(200, !!me && !!staff.find((r) => r.email === me.email)?.vault);
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { message: 'not found' });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  const mine = personOf(me);
  if (req.method() === 'GET') {
    let rows = applyFilters(db[table], url.searchParams);
    // Row level security, as the migration has it.
    if (table === 'client_messages' && !office(me)) rows = [];
    if (table === 'client_questions' && !office(me)) rows = rows.filter((r) => r.to_person === mine);
    if (table === 'client_date_changes' && !office(me)) rows = rows.filter((r) => r.by_email === me.email);
    if (table === 'client_access' && !staff.find((r) => r.email === me.email)?.vault) rows = [];
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    return reply(rows.slice(off, off + lim));
  }
  if (table === 'client_questions') {
    if (req.method() === 'POST') {
      if (!office(me)) return json(403, { code: '42501', message: 'new row violates row-level security policy for table "client_questions"' });
      const row = { ...body, id: randomUUID(), asked_by: me.email, asked_at: serverNow().toISOString(), answer: null, answered_by: null, answered_at: null };
      db.client_questions.push(row);
      return reply([row]);
    }
    if (req.method() === 'PATCH') {
      const rows = applyFilters(db.client_questions, url.searchParams).filter((r) => r.to_person === mine);
      for (const r of rows) Object.assign(r, { answer: body.answer.trim(), answered_by: me.email, answered_at: serverNow().toISOString() });
      return reply(rows);
    }
    if (req.method() === 'DELETE') {
      const rows = applyFilters(db.client_questions, url.searchParams)
        .filter((r) => office(me) && r.asked_by === me.email && !r.answer && serverNow() - new Date(r.asked_at) < 5 * 6e4);
      db.client_questions = db.client_questions.filter((r) => !rows.includes(r));
      return reply(rows.map((r) => ({ id: r.id })));
    }
  }
  return json(405, { message: `unexpected ${req.method()} on ${table}` });
}

// ── Browser ────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newContext(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time: NOW });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msgx) => { if (msgx.type() === 'error' && !/Failed to load resource/.test(msgx.text())) errors.push(msgx.text()); });
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
let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// What the colours are, by the same rules the page uses (app/health.js).
const colourOf = (c) => {
  const cs = Object.fromEntries(checks.filter((x) => x.client_id === c.id).map((x) => [x.item_key, x]));
  return clientHealth(c, clientState(c, cs, NOW), { now: NOW, checks: cs, messages: db.client_messages.filter((x) => x.client_id === c.id), tasks: [], statusNotes: [], access: [] }).color;
};
assert.deepEqual([A, B, C, D, E].map(colourOf), ['red', 'red', 'yellow', 'green', 'green']);

const octx = await newContext();
const owner = await newPage(octx);

// Since 6.10.2026 the owner lands on "המשימות שלי" (it was screen 1), and "מבט מנהל" is one button away.
await step('the owner opens screen 1 with the button at the top of "המשימות שלי", with a link back to the team\'s work', async () => {
  await signIn(owner, 'clients.html', 'owner@astrateg.test');
  await owner.waitForSelector('#profile-switch[data-to="manager"]');
  await owner.waitForSelector('#view-mine:not([hidden])');
  assert.match(owner.url(), /clients\.html(#mine)?$/);
  await owner.click('#profile-switch');
  await owner.waitForURL(/owner\.html#now$/);
  await owner.waitForSelector('#view-now:not([hidden]) .ow-row');
  assert.equal(await text(owner, '#ow-title'), 'מה דורש אותי');
  assert.equal(await owner.getAttribute('#tab-now', 'aria-selected'), 'true');
  assert.equal(await owner.getAttribute('#link-work', 'href'), 'clients.html#mine');
  // The app menu: the manager profile is the current page, and the owner has the team screen.
  await owner.waitForSelector('#side-team');
  assert.equal(await owner.getAttribute('#side-manager', 'aria-current'), 'page');
  assert.equal(await owner.getAttribute('#side-team', 'href'), 'team.html');
});

await step('four numbers: the colours, late now, on time over 8 weeks with its trend, shoot days this week', async () => {
  const stats = owner.locator('#ow-stats > li');
  assert.equal(await stats.count(), 4);
  assert.match(await stats.nth(0).innerText(), /לקוחות[^]*2[^]*אדום[^]*1[^]*צהוב[^]*2[^]*ירוק/);
  // Late: Galia's shoot day (11) and Ron's scripts approval (13); never Dana's, which waits on the client.
  assert.match(await stats.nth(1).innerText(), /באיחור עכשיו\s*2\s*פריטים, בלי ממתין ללקוח/);
  assert.match(await stats.nth(2).innerText(), /בזמן · 8 שבועות\s*\d+%/);
  const spark = stats.nth(2).locator('svg.spark');
  assert.equal(await spark.getAttribute('role'), 'img');
  assert.match(await spark.getAttribute('aria-label'), /^בזמן לפי שבוע, מהישן לחדש: (—|\d+%)(, (—|\d+%)){7}$/);
  assert.match(await stats.nth(3).innerText(), /ימי צילום · 7 ימים\s*1\s*מספרת רון ד׳ 21\.10/);
  await shot(owner, 'owner-01-screen1');
});

await step('rows most severe first: client, station, one name, one reason; waiting on the client apart; an office row', async () => {
  const rows = owner.locator('#ow-rows > li');
  assert.equal(await rows.count(), 4);
  const lines = await rows.evaluateAll((els) => els.map((e) => [e.querySelector('.wclient').textContent, e.querySelector('.hbadge').textContent,
    e.querySelector('.ow-station')?.textContent || '', e.querySelector('.pchip').textContent, e.querySelector('.ow-reason strong').textContent]));
  assert.deepEqual(lines, [
    ['מספרת רון', 'אדום', 'יום צילום', 'ליאור', 'צילום בסיכון'],
    ['קפה גליה', 'אדום', 'תוכן ואישור', 'עירית', 'באיחור 3 ימי עסקים'],
    ['סטודיו דנה', 'צהוב', 'תוכן ואישור', 'עירית', 'ממתין ללקוח 4 ימי עסקים'],
    ['המשרד', 'צהוב', '', 'עירית', 'הבקרה היומית לא בוצעה'],
  ]);
  assert.match(await rows.nth(0).locator('.ow-reason').innerText(), /אין אישור לקוח על התסריטים, הצילום מחר/);
  assert.match(await rows.nth(1).locator('.ow-reason').innerText(), /11 · קביעת יום צילום/);
  assert.equal(await rows.nth(2).evaluate((el) => el.classList.contains('is-waiting')), true);
  assert.match(await rows.nth(2).innerText(), /ממתינים ללקוח, לא עיכוב של הצוות/);
  // "פתיחה" opens the card at the process, or the daily control for the office row.
  assert.equal(await rows.nth(1).locator('.ow-acts a').getAttribute('href'), `client.html?id=${B.id}#p11`);
  assert.equal(await rows.nth(3).locator('.ow-acts a').getAttribute('href'), 'clients.html#control');
  assert.equal(await owner.isHidden('#ow-empty'), true);
});

await step('"שאלה לאחראי": saved with the client and the one person, withdrawable for a moment', async () => {
  const row = owner.locator('#ow-rows > li').nth(0);
  await row.locator('.ask-btn').click();
  await owner.waitForSelector('#dlg-ask[open]');
  assert.equal(await text(owner, '#ask-h'), 'שאלה לליאור');
  assert.match(await text(owner, '#ask-ctx'), /^מספרת רון · צילום בסיכון · אין אישור לקוח על התסריטים/);
  assert.equal(await owner.evaluate(() => document.activeElement.id), 'ask-text');
  await owner.fill('#ask-text', '');
  await owner.click('#ask-submit');
  assert.equal(await owner.getAttribute('#ask-text', 'aria-invalid'), 'true');
  assert.equal(db.client_questions.length, 0);
  await owner.fill('#ask-text', 'הלקוח יאשר את התסריטים עד מחר?');
  await owner.click('#ask-submit');
  await toastHas(owner, 'השאלה נשלחה לליאור');
  assert.equal(db.client_questions.length, 1);
  const q = db.client_questions[0];
  assert.deepEqual([q.client_id, q.to_person, q.about, q.asked_by, q.question], [A.id, 'lior', 'shoot-risk:p13', 'owner@astrateg.test', 'הלקוח יאשר את התסריטים עד מחר?']);
  assert.match(q.context, /^צילום בסיכון · אין אישור לקוח על התסריטים/);
  assert.match(await row.locator('.ow-q').innerText(), /שאלת את ליאור[^]*״הלקוח יאשר את התסריטים עד מחר\?״[^]*ממתין לתשובה/);
  // Focus returns to the button that opened the dialog.
  assert.match(await owner.evaluate(() => document.activeElement.textContent), /שאלה לאחראי/);
  // A second question, taken back with the toast's undo.
  await owner.locator('#ow-rows > li').nth(1).locator('.ask-btn').click();
  await owner.waitForSelector('#dlg-ask[open]');
  assert.equal(await text(owner, '#ask-h'), 'שאלה לעירית');
  await owner.click('#ask-submit'); // the suggested wording
  await toastHas(owner, 'השאלה נשלחה לעירית');
  assert.equal(db.client_questions.length, 2);
  await owner.click('#toast .toast-act');
  await toastHas(owner, 'השאלה בוטלה.');
  assert.equal(db.client_questions.length, 1);
  assert.equal(await owner.locator('#ow-rows > li').nth(1).locator('.ow-q').count(), 0);
});

await step('the one asked sees it at the top of "המשימות שלי", answers inline, and the answer shows in the owner\'s row', async () => {
  const lctx = await newContext();
  const lior = await newPage(lctx);
  await signIn(lior, 'clients.html#mine', 'lior@astrateg.test'); // his first screen is decisions.html (it shows the question too)
  await lior.waitForSelector('#my-questions:not([hidden]) .myq-item');
  assert.equal(new URL(lior.url()).pathname.endsWith('/clients.html'), true);
  const box = lior.locator('#my-questions');
  assert.match(await box.innerText(), /שאלה אליך\s*1[^]*מספרת רון · הבעלים · [^]*על: צילום בסיכון[^]*״הלקוח יאשר את התסריטים עד מחר\?״/);
  // At the top of "המשימות שלי": after the "now" bar and how he hears (notifications, WhatsApp,
  // his calendar), before the list; the hidden cards keep their place.
  assert.deepEqual(await lior.evaluate(() => [...document.querySelectorAll('#view-mine > *')].slice(0, 9).map((e) => e.id)), ['now-bar', 'staff-tasks-card', 'deals-card', 'approvals-card', 'metricool-card', 'push-card', 'wa-card', 'cal-card', 'my-questions']);
  // His top bar links screen 2, never screen 1.
  assert.equal(await lior.getAttribute('#nav-owner', 'href'), 'owner.html#all');
  assert.equal(await text(lior, '#nav-owner'), 'כל הלקוחות במבט');
  const q = db.client_questions[0];
  await lior.click(`#myq-${q.id}-send`);
  assert.equal(await lior.getAttribute(`#myq-${q.id}`, 'aria-invalid'), 'true');
  assert.equal(q.answer, null);
  await lior.fill(`#myq-${q.id}`, 'הזום איתו מחר ב־10:00, אישור עד הצהריים');
  await lior.click(`#myq-${q.id}-send`);
  await toastHas(lior, 'התשובה נשלחה');
  assert.deepEqual([q.answer, q.answered_by], ['הזום איתו מחר ב־10:00, אישור עד הצהריים', 'lior@astrateg.test']);
  assert.equal(await lior.isHidden('#my-questions'), true);
  await shot(lior, 'owner-02-lior-mine');
  await lctx.close();
  // Irit has no question: no block.
  const ictx = await newContext();
  const irit = await newPage(ictx);
  await signIn(irit, 'clients.html', 'irit@astrateg.test');
  await irit.waitForSelector('#view-mine:not([hidden])');
  await irit.waitForTimeout(300);
  assert.equal(await irit.isHidden('#my-questions'), true);
  await ictx.close();
  // Back with the owner: the answer is in the row.
  await owner.click('#btn-refresh');
  await owner.waitForSelector('#ow-rows > li .ow-q.is-answered');
  assert.match(await owner.locator('#ow-rows > li').nth(0).locator('.ow-q').innerText(), /ליאור ענה\/תה: ״הזום איתו מחר ב־10:00, אישור עד הצהריים״/);
});

await step('screen 2: two lines per client, most severe first; a tap opens the rest; the filter by colour', async () => {
  await owner.click('#tab-all');
  await owner.waitForSelector('#view-all:not([hidden]) .ga-item');
  assert.equal(new URL(owner.url()).hash, '#all');
  assert.deepEqual(await owner.locator('.ga-name').allInnerTexts(), ['מספרת רון', 'קפה גליה', 'סטודיו דנה', 'חנות ישנה', 'פיצה נאפולי']);
  const row = owner.locator(`#gab-${A.id}`);
  assert.match(await row.locator('.ga-l1').innerText(), /אדום\s*מספרת רון\s*צילום בסיכון · אין אישור לקוח על התסריטים[^]*· ליאור/);
  assert.match(await row.locator('.ga-l2').innerText(), /^הבא: אישור התסריטים · ליאור · /);
  // A milestone already late says so; one the client holds says that, not a date that keeps moving.
  assert.match(await owner.locator(`#gab-${B.id} .ga-l2`).innerText(), /^הבא: קביעת יום הצילום · עירית · היה עד יום ה׳, 15\.10 · באיחור$/);
  assert.equal(await owner.locator(`#gab-${C.id} .ga-l2`).innerText(), 'הבא: קביעת יום הצילום · עירית · ממתין ללקוח');
  assert.equal(await row.getAttribute('aria-expanded'), 'false');
  assert.equal(await owner.isHidden(`#ga-${A.id}`), true);
  await row.click();
  assert.equal(await owner.locator(`#gab-${A.id}`).getAttribute('aria-expanded'), 'true');
  assert.equal(await owner.evaluate(() => document.activeElement.id), `gab-${A.id}`);
  const more = owner.locator(`#ga-${A.id}`);
  assert.match(await more.innerText(), /Social all in one · נטלי דדון · חודש 1 מתוך 12/);
  assert.equal(await more.locator('.stbar li').count(), 8);
  assert.equal(await more.locator('.stbar li[aria-current="step"]').count(), 1);
  assert.match(await more.locator('.stbar-now').innerText(), /4\/8\s*יום צילום/);
  assert.match(await more.innerText(), /ממתין ללקוח\s*אישור התסריטים/);
  assert.match(await more.innerText(), /מגע אחרון\s*אתמול 12:00/); // the Zoom call, after the day's message
  assert.match(await more.innerText(), /בתחנה\s*נכנס היום/); // the day before the shoot starts the shoot station
  // Keyboard: Enter closes it again.
  await owner.keyboard.press('Enter');
  assert.equal(await owner.isHidden(`#ga-${A.id}`), true);
  // The imported client's pace is complete, and it is green.
  await owner.click(`#gab-${E.id}`);
  assert.match(await owner.locator(`#ga-${E.id}`).innerText(), /קצב תוצרים\s*סרטונים 25\/25 · גרפיקות 35\/35/);
  assert.match(await owner.locator(`#gab-${E.id} .ga-l1`).innerText(), /ירוק[^]*לפי התוכנית/);
  // Waiting on the client.
  await owner.click('#gaf-waiting');
  assert.deepEqual(await owner.locator('.ga-name').allInnerTexts(), ['סטודיו דנה']);
  await owner.click('#gaf-red');
  assert.deepEqual(await owner.locator('.ga-name').allInnerTexts(), ['מספרת רון', 'קפה גליה']);
  await owner.click('#gaf-all');
  await shot(owner, 'owner-03-screen2');
});

await step('the board: this week, and 30 days', async () => {
  const week = await owner.locator('#board .board-ev').evaluateAll((els) => els.map((e) => [e.querySelector('.board-what').textContent, e.querySelector('.wclient').textContent, e.querySelector('.pchip').textContent]));
  assert.deepEqual(week, [['יום צילום', 'מספרת רון', 'ליאור'], ['פגישת אפיון', 'פיצה נאפולי', 'אופיר']]);
  assert.match(await text(owner, '#board-sum'), /אפיונים: 1 · ימי צילום: 1 · מסירות: 0 · קמפיינים: 0 · חידושים: 0/);
  assert.match(await owner.locator('.board-dh').first().innerText(), /^מחר · ד׳ 21\.10$/);
  await owner.click('#range-30');
  await owner.waitForSelector('#range-30[aria-pressed="true"]');
  const month = await owner.locator('#board .board-what').allInnerTexts();
  assert.ok(month.includes('סגירת הסרטונים'), month.join('|'));
});

await step('the client card: three lines (the colour and why, now, next) and the timeline', async () => {
  await owner.goto(`${BASE}client.html?id=${A.id}`);
  await owner.waitForSelector('.hhead');
  const head = owner.locator('.hhead');
  assert.equal(await head.evaluate((el) => el.classList.contains('h-red')), true);
  const lines = await head.locator('.hline').allInnerTexts();
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^אדום\s*צילום בסיכון · אין אישור לקוח על התסריטים, הצילום מחר\s*ליאור$/);
  assert.match(lines[1], /^עכשיו: יום צילום · ליאור · /);
  // One name for where the client is, on the whole screen (found live: "שלב נוכחי: הכנה ליום הצילום" next to "עכשיו: שוטף").
  assert.equal(await owner.locator('#cc-head .kicker').innerText(), 'שלב נוכחי: יום צילום');
  assert.equal(await owner.locator('.ph-now').count() ? await owner.locator('.ph-now').first().innerText() : 'פתוח עכשיו', 'פתוח עכשיו');
  // The clients list names the same station.
  // Two clients with the same contact are told apart by the business, which comes first (found live, 6.10.2026).
  Object.assign(A, { business: 'רון עיצוב שיער' });
  const [bName, bBusiness] = [B.name, B.business];
  Object.assign(B, { name: A.name, business: 'מספרת רון חיפה' });
  const listPage = await owner.context().newPage();
  await listPage.goto(`${BASE}clients.html#clients`);
  await listPage.waitForSelector(`a.crow[href*="${A.id}"] .cphase`);
  assert.match(await listPage.locator(`a.crow[href*="${A.id}"] .cphase`).innerText(), /^שלב\s*יום צילום$/);
  assert.equal(await listPage.locator(`a.crow[href*="${A.id}"] .cname strong`).innerText(), 'רון עיצוב שיער · מספרת רון');
  assert.equal(await listPage.locator(`a.crow[href*="${B.id}"] .cname strong`).innerText(), 'מספרת רון חיפה · מספרת רון');
  // The search finds a client by the business and by the contact.
  const found = async (q) => { await listPage.fill('#client-search', q); return listPage.locator('#client-list a.crow .cname strong').allInnerTexts(); };
  assert.deepEqual(await found('חיפה'), ['מספרת רון חיפה · מספרת רון']);
  assert.deepEqual((await found('עיצוב שיער')), ['רון עיצוב שיער · מספרת רון']);
  assert.deepEqual((await found('מספרת רון')).sort(), ['מספרת רון חיפה · מספרת רון', 'רון עיצוב שיער · מספרת רון']);
  assert.ok(await listPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  Object.assign(A, { business: null });
  Object.assign(B, { name: bName, business: bBusiness });
  await listPage.close();
  assert.match(lines[2], /^הבא: אישור התסריטים · ליאור · [^]* · מחכים מהלקוח: אישור התסריטים$/);
  // The timeline: what was done (who and when), what is open, what is planned.
  const tl = owner.locator('#timeline');
  assert.match(await tl.locator('.tl-h').first().innerText(), /בוצע\s*\d+/);
  assert.match(await tl.locator('.tl-done').innerText(), /12 · כתיבת התסריטים לשבוע הצילום|12 · כתיבת התסריטים/);
  assert.match(await tl.locator('.tl-done').innerText(), /ליאור · /);
  assert.match(await tl.locator('.tl-now').innerText(), /13 · שיחת Zoom לאישור התוכן · ליאור/);
  // Assigning the editor (22א) hangs on the shoot day: it must be set by then. Editing (22)
  // hangs on 22א, whose own deadline is not known yet: "not set", with no date claimed.
  const planned = await tl.locator('.tl-planned').innerText();
  assert.match(planned, /22א · העברה לעריכה ושיוך לעורך · ליאור · טרם נקבע · חייב להיקבע עד מחר/);
  assert.match(planned, /22 · עריכת הסרטונים · אופיר · טרם נקבע(\n|$)/);
  // Show everything done, and back; the link opens the process.
  await owner.click('#tl-toggle');
  assert.equal(await owner.getAttribute('#tl-toggle', 'aria-expanded'), 'true');
  assert.ok(await tl.locator('.tl-done li').count() > 5);
  // The question asked from screen 1 is recorded in the card, with its answer.
  const cq = owner.locator('#questions');
  assert.match(await cq.innerText(), /שאלות לאחראי[^]*הבעלים שאל\/ה את ליאור[^]*על: צילום בסיכון[^]*״הלקוח יאשר את התסריטים עד מחר\?״[^]*ליאור: ״הזום איתו מחר ב־10:00, אישור עד הצהריים״/);
  await tl.locator('.tl-now a').first().click();
  await owner.waitForFunction(() => document.getElementById('p13')?.closest('details')?.open);
  // Imported history is marked as such; the owner sees it on the imported client.
  await owner.goto(`${BASE}client.html?id=${E.id}`);
  await owner.waitForSelector('#timeline');
  assert.match(await owner.locator('#timeline .tl-done').innerText(), /ייבוא/);
  assert.equal(await owner.locator('.hhead').evaluate((el) => el.classList.contains('h-green')), true);
  assert.match(await owner.locator('.hhead .hline').first().innerText(), /ירוק\s*הכול לפי התוכנית/);
  await shot(owner, 'owner-04-card');
});

await step('after landing, the owner\'s "לקוחות" links open the clients list (not screen 1 again)', async () => {
  await owner.goto(`${BASE}client.html?id=${B.id}`);
  await owner.waitForSelector('.hhead');
  await owner.click('#side-clients');
  await owner.waitForSelector('#view-mine:not([hidden]), #view-clients:not([hidden])');
  await owner.waitForTimeout(300);
  assert.match(new URL(owner.url()).pathname, /\/clients\.html$/);
  // Screen 1 is in the menu of the manager profile ("מבט מנהל"), on phones too.
  // The page head does not repeat it (the phone review of 4.10.2026).
  await owner.waitForSelector('#profile-switch');
  assert.equal(await owner.isHidden('#cta-owner'), true);
  assert.equal(await owner.getAttribute('#cta-owner', 'href'), 'owner.html');
  assert.equal(await owner.getAttribute('#side-manager', 'href'), 'owner.html#now');
  assert.equal(await owner.isVisible('#side-manager'), true);
  // And screen 1's own "לקוחות" opens the list.
  await owner.goto(`${BASE}owner.html`);
  await owner.waitForSelector('#view-now:not([hidden]) .ow-row');
  assert.equal(await owner.getAttribute('#nav-work', 'href'), 'clients.html#clients');
});

await step('"שאלה לאחראי" only to someone who can sign in', async () => {
  // A fresh exception on the imported client, for Ilai, who has no login yet.
  db.client_tasks.push({ id: randomUUID(), client_id: E.id, title: 'הלקוח ביקש לשנות את הלוגו', owner: 'ilai', done_at: null, due_on: null, urgent: false, source: 'escalation', created_at: '2026-10-20T09:30:00+03:00', created_by_email: 'lior@astrateg.test' });
  await owner.click('#btn-refresh');
  const row = owner.locator(`#ow-rows > li:has(a.wclient[href="client.html?id=${E.id}"])`);
  await row.waitFor();
  assert.match(await row.locator('.ow-reason').innerText(), /חריגה פתוחה/);
  assert.equal(await row.locator('.ask-btn').count(), 0);
  assert.equal(await row.locator('.ow-nologin').innerText(), 'אין לעילאי כניסה למערכת');
  // Lior, who has a login, can still be asked.
  assert.equal(await owner.locator('#ow-rows > li').nth(0).locator('.ask-btn').count(), 1);
  db.client_tasks = [];
  await owner.click('#btn-refresh');
  await owner.waitForFunction((id) => !document.querySelector(`#ow-rows a.wclient[href="client.html?id=${id}"]`), E.id);
});

await step('the managers: Irit opens screen 1 too; Lior opens screen 2 but not screen 1; an editor opens neither', async () => {
  // Irit (and Ofir) have the manager profile (the owner's decision): screen 1 with its questions.
  const ictx = await newContext();
  const irit = await newPage(ictx);
  await signIn(irit, 'owner.html#now', 'irit@astrateg.test');
  await irit.waitForSelector('#view-now:not([hidden]) .ow-row');
  assert.equal(await irit.isHidden('#tab-now'), false);
  assert.equal(await text(irit, '#ow-title'), 'מה דורש אותי');
  assert.ok(await irit.locator('.ask-btn').count() > 0);
  assert.equal(await text(irit, '#link-work'), 'המשימות שלי');
  // Her clients.html is still hers by default ("המשימות שלי"), not redirected.
  await irit.goto(`${BASE}clients.html`);
  await irit.waitForSelector('#view-mine:not([hidden])');
  assert.match(irit.url(), /clients\.html/);
  await ictx.close();
  const lctx = await newContext();
  const lior = await newPage(lctx);
  await signIn(lior, 'owner.html#now', 'lior@astrateg.test');
  await lior.waitForSelector('#view-all:not([hidden]) .ga-item');
  assert.equal(new URL(lior.url()).hash, '#all');
  assert.equal(await lior.isHidden('#tab-now'), true);
  assert.equal(await lior.isHidden('#view-now'), true);
  assert.equal(await text(lior, '#ow-title'), 'כל הלקוחות במבט');
  assert.equal(await lior.locator('.ask-btn').count(), 0);
  // No switch for Lior, and no way into screen 1 by the address either.
  assert.equal(await lior.locator('#mode-bar').count(), 0);
  await lior.evaluate(() => { location.hash = '#now'; });
  await lior.waitForTimeout(200);
  assert.equal(await lior.isHidden('#view-now'), true);
  await lctx.close();
  const nctx = await newContext();
  const nadia = await newPage(nctx);
  await signIn(nadia, 'owner.html', 'nadia@astrateg.test');
  await nadia.waitForSelector('#no-access:not([hidden])');
  assert.equal(await nadia.isHidden('#ow-page'), true);
  assert.equal(await nadia.getAttribute('#no-access a', 'href'), 'clients.html#mine');
  await nctx.close();
});

await step('the team screen: a worker sees only their own row; the owner and Lior see everyone', async () => {
  const wctx = await newContext();
  const ofir = await newPage(wctx);
  await signIn(ofir, 'clients.html#performance', 'ofir@astrateg.test');
  await ofir.waitForSelector('.perf-me tbody tr');
  assert.deepEqual(await ofir.locator('.perf-people td[data-label="עובד"]').allInnerTexts(), ['אופיר']);
  assert.equal(await ofir.locator('.perf-team').count(), 0);
  // The columns of section 6: open, late, this week, on time, median vs norm, editor load, returns, "not relevant", date changes.
  assert.deepEqual(await ofir.locator('.perf-me thead th').allInnerTexts(),
    ['עובד', 'פתוחים', 'באיחור', 'להשבוע', 'בזמן', 'זמן חציוני מול נורמה', 'עומס עריכה', 'החזרות לתיקון', 'לא רלוונטי', 'שינויי מועד']);
  await wctx.close();
  const nctx = await newContext();
  const nadia = await newPage(nctx);
  await signIn(nadia, 'clients.html#mine', 'nadia@astrateg.test'); // an editor's first screen is editor.html
  await nadia.waitForSelector('#view-mine:not([hidden])');
  assert.equal(await text(nadia, '#tab-performance'), 'הנתונים שלי');
  await nadia.click('#tab-performance');
  await nadia.waitForSelector('.perf-me tbody tr');
  assert.deepEqual(await nadia.locator('.perf-people td[data-label="עובד"]').allInnerTexts(), ['נדיה']);
  assert.match(await nadia.locator('.perf-me td[data-label="עומס עריכה"]').innerText(), /^0 מתוך 2$/);
  assert.equal(await nadia.locator('.perf-team, .perf-calls').count(), 0);
  await nctx.close();
  await owner.goto(`${BASE}clients.html#performance`);
  await owner.waitForSelector('.perf-team tbody tr');
  assert.equal(await owner.locator('.perf-team td[data-label="עובד"]').count(), 9);
  assert.equal(await owner.locator('.perf-me').count(), 0);
});

await step('the owners\' end of the day (owner.html#eod): a row per employee, the totals, the items worst first; the same numbers as the 19:00 message; owners only', async () => {
  // What the message would say now, from the same data (app/day-summary.js through the engine's own function).
  const live = db.clients.filter((c) => c.status === 'active' || c.status === 'ending');
  const checksOf = (c) => Object.fromEntries(db.protocol_checks.filter((x) => x.client_id === c.id).map((x) => [x.item_key, x]));
  const expected = daySummary({ clients: live, checksOf, stateOf: (c) => clientState(c, checksOf(c), serverNow()), tasks: db.client_tasks, now: serverNow() });
  assert.ok(expected.rows.length >= 1 && expected.totals.late >= 1, JSON.stringify(expected.totals));
  await owner.goto(`${BASE}owner.html#eod`);
  await owner.waitForSelector('#view-eod:not([hidden]) #eod-body tr');
  assert.equal(await owner.isHidden('#tab-eod'), false);
  assert.equal(await owner.getAttribute('#tab-eod', 'aria-selected'), 'true');
  assert.equal(await text(owner, '#ow-title'), 'סיכום היום');
  assert.equal(await text(owner, '#eod-head'), headline(expected));
  const rows = await owner.locator('#eod-body tr').evaluateAll((trs) => trs.map((tr) => [tr.dataset.person, ...[...tr.querySelectorAll('td')].map((td) => td.innerText.trim())]));
  assert.deepEqual(rows, expected.rows.map((r) => [r.person, r.late ? String(r.late) : '—', r.today ? String(r.today) : '—', r.late ? r.longest : '—']));
  assert.match(await text(owner, '#eod-foot'), new RegExp(`סך הכול\\s+${expected.totals.late}`));
  const items = await owner.locator('#eod-items > li.eod-item').count();
  assert.equal(items + (await owner.locator('#eod-items .more-row').count() ? expected.items.length - items : 0), expected.items.length);
  assert.match(await owner.locator('#eod-items > li').first().innerText(), /באיחור/);
  // No price anywhere in it (ops §35).
  assert.doesNotMatch(await owner.locator('#view-eod').innerText(), /₪|מחיר/);
  // An item opens its process in the client card.
  assert.match(await owner.locator('#eod-items .wclient').first().getAttribute('href'), /^client\.html\?id=/);
  await shot(owner, 'owner-07-eod');
  // On a 360px phone: no sideways scrolling of the page, and the tab is a 44px target.
  const pctx = await newContext({ width: 360, height: 780 });
  const phone = await newPage(pctx);
  await signIn(phone, 'owner.html#eod', 'owner@astrateg.test');
  await phone.waitForSelector('#view-eod:not([hidden]) #eod-body tr');
  assert.ok(await noHScroll(phone), 'the end-of-day table scrolls the page sideways at 360px');
  assert.ok((await phone.locator('#tab-eod').boundingBox()).height >= 44);
  await shot(phone, 'owner-08-eod-phone');
  await pctx.close();
  // Nobody but the owners: no tab, and the address does not open it (Irit and Ofir are managers; Lior sees screen 2).
  for (const [email, home] of [['irit@astrateg.test', '#view-now'], ['ofir@astrateg.test', '#view-now'], ['lior@astrateg.test', '#view-all']]) {
    const ctx = await newContext();
    const page = await newPage(ctx);
    await signIn(page, 'owner.html#eod', email);
    await page.waitForSelector(`${home}:not([hidden])`);
    assert.equal(await page.isHidden('#tab-eod'), true, email);
    assert.equal(await page.isHidden('#view-eod'), true, email);
    await page.evaluate(() => { location.hash = '#eod'; });
    await page.waitForTimeout(200);
    assert.equal(await page.isHidden('#view-eod'), true, email);
    assert.equal(await page.locator('#eod-body tr').count(), 0, email);
    await ctx.close();
  }
});

await step('everything green: "הכול לפי התוכנית"', async () => {
  const saved = [db.office_reviews, [A, B, C].map((c) => c.status)];
  for (const c of [A, B, C]) c.status = 'ended';
  db.office_reviews = [...db.office_reviews, { day: '2026-10-19', kind: 'p32', note: null, by_email: 'irit@astrateg.test', at: '2026-10-19T12:00:00+03:00', note_by: null, note_at: null }];
  await owner.goto(`${BASE}owner.html`);
  await owner.waitForSelector('#ow-empty:not([hidden])');
  assert.equal(await text(owner, '#ow-empty'), 'הכול לפי התוכנית');
  assert.equal(await owner.locator('#ow-rows > li').count(), 0);
  assert.match(await owner.locator('#ow-stats > li').first().innerText(), /0[^]*אדום[^]*0[^]*צהוב[^]*2[^]*ירוק/);
  // The answered question whose row is gone is still there to read, for three days.
  assert.match(await owner.locator('#ow-answers').innerText(), /תשובות אחרונות[^]*מספרת רון[^]*ליאור ענה\/תה/);
  await shot(owner, 'owner-05-all-green');
  // The end of the day says so in one friendly sentence, with no table.
  await owner.goto(`${BASE}owner.html#eod`);
  await owner.waitForSelector('#view-eod:not([hidden]) #eod-head.is-clear');
  assert.equal(await text(owner, '#eod-head'), EMPTY_DAY);
  assert.equal(await owner.isHidden('#eod-wrap'), true);
  assert.equal(await owner.locator('#eod-items > li').count(), 0);
  await shot(owner, 'owner-09-eod-empty');
  db.office_reviews = saved[0];
  [A, B, C].forEach((c, i) => { c.status = saved[1][i]; });
});

await step('a 360px phone: no sideways scrolling, 44px targets, on both screens', async () => {
  const pctx = await newContext({ width: 360, height: 780 });
  const phone = await newPage(pctx);
  await signIn(phone, 'owner.html', 'owner@astrateg.test');
  await phone.waitForSelector('#view-now:not([hidden]) .ow-row');
  assert.ok(await noHScroll(phone), 'screen 1 scrolls sideways at 360px');
  const heights = await phone.locator('.ow-acts .btn, #tab-now, #tab-all').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  assert.ok(heights.length >= 9 && heights.every((x) => x >= 44), JSON.stringify(heights));
  const tiles = await phone.locator('#ow-stats > li').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left >= 0, r.right <= 360]; }));
  assert.ok(tiles.every(([a, b]) => a && b), JSON.stringify(tiles));
  await shot(phone, 'owner-06-phone-screen1');
  await phone.locator('.ask-btn').first().click();
  await phone.waitForSelector('#dlg-ask[open]');
  assert.ok(await noHScroll(phone), 'the dialog scrolls sideways at 360px');
  assert.ok((await phone.locator('#ask-submit').boundingBox()).height >= 44);
  await phone.locator('#dlg-ask [data-close]').first().click();
  await phone.click('#tab-all');
  await phone.waitForSelector('.ga-item');
  await phone.click(`#gab-${B.id}`);
  assert.ok(await noHScroll(phone), 'screen 2 scrolls sideways at 360px');
  const rowH = await phone.locator('.ga-row, .ga-filters .chip, #board-range .chip, .ga-more .btn').evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().height));
  assert.ok(rowH.length > 8 && rowH.every((x) => x >= 44), JSON.stringify(rowH));
  await shot(phone, 'owner-07-phone-screen2');
  await phone.goto(`${BASE}client.html?id=${B.id}`);
  await phone.waitForSelector('.hhead');
  assert.ok(await noHScroll(phone), 'the card scrolls sideways at 360px');
  await shot(phone, 'owner-08-phone-card');
  // The whole team's table, as the owner sees it on a phone.
  await phone.goto(`${BASE}clients.html#performance`);
  await phone.waitForSelector('.perf-team tbody tr');
  assert.ok(await noHScroll(phone), 'the team screen scrolls sideways at 360px');
  await shot(phone, 'owner-09-phone-team');
  await pctx.close();
  // Lior on a phone: the bottom bar holds his three screens, and the way into screen 2 is
  // the button at the top, "מבט מנהל" (since 6.10.2026; it was "כל הלקוחות במבט" behind "עוד").
  const ictx = await newContext({ width: 360, height: 780 });
  const lior = await newPage(ictx);
  await signIn(lior, 'clients.html#mine', 'lior@astrateg.test');
  await lior.waitForSelector('#view-mine:not([hidden])');
  assert.equal(await lior.locator('#nav-owner').isVisible(), false);
  assert.deepEqual(await lior.locator('#side-list .side-link:visible').allInnerTexts(), ['המשימות שלי', 'לקוחות', 'החלטות', 'עוד']);
  const cta = lior.locator('#profile-switch');
  assert.equal(await cta.isVisible(), true);
  assert.equal(await cta.getAttribute('href'), 'owner.html#all');
  assert.equal(await cta.innerText(), 'מבט מנהל');
  assert.ok((await cta.boundingBox()).height >= 44);
  assert.ok(await noHScroll(lior), 'clients.html scrolls sideways at 360px');
  await cta.click();
  await lior.waitForSelector('#view-all:not([hidden]) .ga-item');
  // There, "כל הלקוחות במבט" is the first screen of the bar.
  assert.equal(await lior.getAttribute('#side-overview', 'aria-current'), 'page');
  await ictx.close();
});

assert.deepEqual(errors, []);
await browser.close();
noCspViolations();
console.log(`owner-e2e: ${passed} passed`);
