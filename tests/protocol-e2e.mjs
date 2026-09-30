// End-to-end check of the client protocol pages against an in-memory fake of Supabase.
// Run: npx http-server -p 8080 . &  then  node tests/protocol-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { STATIONS } from '../app/protocol.js';
import { clientState } from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const USER = { id: randomUUID(), email: 'irit@astrateg.test', aud: 'authenticated', role: 'authenticated' };
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

const hoursAgo = (n) => new Date(Date.now() - n * 36e5).toISOString();
const daysFromNow = (n, h = 10) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const signedQuote = { id: randomUUID(), number: 'AST-2026-0042', client_name: 'דנה לוי', signed_at: hoursAgo(1), status: 'signed',
  company: 'סטודיו דנה', phone: '050-1234567', tier: 'Social all in one', influencer: 'נטלי דדון', package_id: 'social-natali', term_months: 12,
  selection: { tier: 'social', influencer: 'natali', paid: ['natali-story'], free: { graphics: 4, simeonStories: 0, simeonJoin: false, extraCh14: false } } };

const db = {
  staff: [{ email: USER.email, person: 'irit', vault: true }],
  quotes: [signedQuote],
  clients: [],
  protocol_checks: [],
  protocol_log: [],
  client_tasks: [],
  client_access: [],
  client_access_log: [],
  client_status_notes: [],
};
const secrets = new Map();
let failNextCheck = false;

// Seed: one client mid-way, one just signed.
const seeded = { id: randomUUID(), name: 'מספרת רון', business: 'רון עיצוב שיער', phone: '052-7654321', package_name: 'Social + TV · דניס, מישל וסמיון',
  shoot_type: 'dms', characterizer: 'ofir', has_logo: true, editor_name: null, deal_at: hoursAgo(80), char_at: hoursAgo(50), shoot_at: daysFromNow(2),
  contract_end: '2027-09-20', status: 'active', notes: null, quote_id: null, created_at: hoursAgo(80), created_by_email: USER.email,
  address: 'הרצל 10, תל אביב', links: {}, deliverables: { videos: 42, graphics: 42, shoot_days: 2, collabs: 3, stories: 3, ch14: 1, done: { videos: 0 } }, rounds: [], verified_at: null, verified_by: null, closed_reason: null };
const fresh = { ...seeded, id: randomUUID(), name: 'פיצה נאפולי', business: null, phone: null, package_name: null, shoot_type: null, characterizer: null,
  has_logo: null, deal_at: hoursAgo(3), char_at: null, shoot_at: null, contract_end: null };
db.clients.push(seeded, fresh);
const doneKeys = ['p01.prepared', 'p01.sent', 'p01.signed', 'p02.opened', 'p02.m.lior', 'p02.m.irit', 'p02.m.ofir', 'p02.m.ilai', 'p02.m.client', 'p02.intro', 'p03.who', 'p03.scheduled',
  'p04.address', 'p04.phone', 'p04.services', 'p04.audiences', 'p04.advantages', 'p04.goals', 'p04.offers', 'p04.content', 'p04.graphics', 'p04.campaigns', 'p04.special', 'p04.saved', 'p05.access', 'p05.logo', 'p05.colors', 'p05.photos', 'p05.videos'];
for (const k of doneKeys) db.protocol_checks.push({ client_id: seeded.id, item_key: k, state: 'done', note: null, by_email: 'ofir@astrateg.test', at: hoursAgo(49) });
db.protocol_checks.push({ client_id: seeded.id, item_key: 'p05.menu', state: 'na', note: null, by_email: 'ofir@astrateg.test', at: hoursAgo(49) });
db.client_tasks.push({ id: randomUUID(), client_id: seeded.id, title: 'לשלוח ללקוח את רשימת השאלות לראיון', owner: 'irit', due_on: new Date().toISOString().slice(0, 10), done_at: null, done_by_email: null, created_by_email: 'lior@astrateg.test', created_at: hoursAgo(5) });

function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith('neq.')) out = out.filter((r) => String(r[k]) !== v.slice(4));
    else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    else if (v === 'not.is.null') out = out.filter((r) => r[k] !== null && r[k] !== undefined);
    else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')); out = out.filter((r) => set.includes(String(r[k]))); }
    else if (v.startsWith('gte.')) out = out.filter((r) => String(r[k]) >= v.slice(4));
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
    if (body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: USER });
  }
  if (p === '/auth/v1/user') return json(200, USER);
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  const authed = (headers.authorization || '').includes(JWT);
  if (p === '/rest/v1/rpc/is_staff') return json(200, authed);
  // Access vault: the password never sits on the row, only in the secret store.
  const vaultOk = authed && db.staff[0].vault; // an admin-set flag, not the self-chosen person
  const logAccess = (a, action) => db.client_access_log.push({ id: db.client_access_log.length + 1, access_id: a.id, client_id: a.client_id, network: a.network, action, by_email: USER.email, at: new Date().toISOString() });
  if (p === '/rest/v1/rpc/can_use_vault') return json(200, vaultOk);
  if (p.startsWith('/rest/v1/rpc/access_') && !vaultOk) return json(400, { message: 'not allowed' });
  if (p === '/rest/v1/rpc/access_save') {
    let a = db.client_access.find((x) => x.id === body.p_id);
    const fields = { network: body.p_network, label: body.p_label || null, username: body.p_username || null, status: body.p_status || 'ok', note: body.p_note || null, updated_by: USER.email, updated_at: new Date().toISOString() };
    if (a) Object.assign(a, fields); else { a = { id: randomUUID(), client_id: body.p_client, has_secret: null, created_at: fields.updated_at, ...fields }; db.client_access.push(a); }
    if (body.p_password) { secrets.set(a.id, body.p_password); a.has_secret = randomUUID(); }
    logAccess(a, body.p_id ? 'update' : 'create');
    return json(200, a.id);
  }
  if (p === '/rest/v1/rpc/access_reveal') {
    const a = db.client_access.find((x) => x.id === body.p_id);
    if (!a) return json(400, { message: 'access not found' });
    logAccess(a, 'reveal');
    return json(200, secrets.get(a.id) ?? null);
  }
  if (p === '/rest/v1/rpc/access_delete') {
    const a = db.client_access.find((x) => x.id === body.p_id);
    if (a) { db.client_access = db.client_access.filter((x) => x !== a); secrets.delete(a.id); logAccess(a, 'delete'); }
    return json(200, null);
  }
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { message: 'not found' });
  if (!authed) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  const now = new Date().toISOString();

  if (req.method() === 'GET') {
    let rows = applyFilters(db[table], url.searchParams);
    if (table === 'protocol_log' || table === 'client_access_log') rows = [...rows].reverse();
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    return reply(rows.slice(off, off + lim));
  }
  if (req.method() === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const out = [];
    for (const r of rows) {
      if (table === 'protocol_checks') {
        if (failNextCheck) { failNextCheck = false; return json(500, { message: 'Failed to fetch' }); }
        const row = { ...r, by_email: USER.email, at: now };
        const i = db.protocol_checks.findIndex((x) => x.client_id === r.client_id && x.item_key === r.item_key);
        if (i >= 0) db.protocol_checks[i] = row; else db.protocol_checks.push(row);
        db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: r.state, note: r.note, by_email: USER.email, at: now });
        out.push(row);
      } else if (table === 'clients') {
        const row = { address: null, links: {}, deliverables: {}, rounds: [], verified_at: null, verified_by: null, closed_reason: null, business: null, phone: null, package_name: null, shoot_type: null, characterizer: null, has_logo: null, editor_name: null, char_at: null, shoot_at: null, contract_end: null, status: 'active', notes: null, quote_id: null, deal_at: now, ...r, id: randomUUID(), created_at: now, created_by_email: USER.email };
        db.clients.push(row);
        out.push(row);
      } else if (table === 'client_tasks') {
        const row = { due_on: null, done_at: null, done_by_email: null, source: null, brief: null, urgent: false, ...r, id: randomUUID(), created_by_email: USER.email, created_at: now };
        db.client_tasks.push(row);
        out.push(row);
      } else if (table === 'client_status_notes') {
        const row = { ...r, by_email: USER.email, at: now };
        const i = db.client_status_notes.findIndex((x) => x.client_id === r.client_id && x.week === r.week);
        if (i >= 0) db.client_status_notes[i] = row; else db.client_status_notes.push(row);
        out.push(row);
      }
    }
    return reply(out);
  }
  if (req.method() === 'PATCH') {
    const rows = applyFilters(db[table], url.searchParams);
    for (const r of rows) {
      Object.assign(r, body);
      if (table === 'client_tasks') r.done_by_email = r.done_at ? USER.email : null;
    }
    return reply(rows);
  }
  if (req.method() === 'DELETE') {
    const rows = applyFilters(db[table], url.searchParams);
    db[table] = db[table].filter((r) => !rows.includes(r));
    if (table === 'protocol_checks') for (const r of rows) db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: 'clear', note: null, by_email: USER.email, at: now });
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  return json(405, {});
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 1280, height: 900 } });
await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', fakeSupabase);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const shot = async (name, pg = page) => { if (OUT) await pg.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const noHScroll = async (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

// Login
await page.goto(`${BASE}clients.html`);
await page.fill('#lg-email', USER.email);
await page.fill('#lg-pass', 'correct-horse');
await page.click('#lg-submit');
await page.waitForSelector('#app:not([hidden])');

// My work: Irit's open items across clients, most urgent first.
await page.waitForSelector('#view-mine:not([hidden]) .witem');
assert.equal(await page.getAttribute('#tab-mine', 'aria-selected'), 'true');
const mine = await page.locator('#mine-list').innerText();
assert.match(mine, /באיחור/);
assert.match(mine, /פיצה נאפולי/);
assert.match(mine, /לשלוח ללקוח את רשימת השאלות לראיון/); // task from the weekly call
assert.doesNotMatch(mine, /כתובת מלאה של העסק/); // Ofir's characterization items are not Irit's
await shot('01-my-work');

// Grouped by client and process: the seven WhatsApp items are one group.
assert.equal(await page.locator('.wproc:has-text("פתיחת קבוצת WhatsApp")').count(), 1);
// Check an item straight from "my work", then undo it from the toast.
const firstLabel = await page.locator('.witem .wlabel').first().innerText();
const before = await page.locator('.witem').count();
await page.locator('.witem .cbx').first().click();
await page.waitForFunction(() => document.querySelector('#toast.on')?.textContent.includes('סומן כבוצע'));
assert.equal(await page.locator('.witem').count(), before - 1);
assert.ok(db.protocol_checks.some((c) => c.state === 'done' && c.by_email === USER.email) || db.client_tasks.some((t) => t.done_at), `saved: ${firstLabel}`);
await page.click('.toast-act');
await page.waitForFunction((n) => document.querySelectorAll('.witem').length === n, before);
assert.ok(!db.protocol_checks.some((c) => c.by_email === USER.email && c.state === 'done') && !db.client_tasks.some((t) => t.done_at), 'undo cleared the check');

// Clients tab
await page.click('#tab-clients');
await page.waitForSelector('.crow');
assert.equal(await page.locator('.crow').count(), 2);
await shot('02-clients');

// Control tab
await page.click('#tab-control');
await page.waitForSelector('.ctable');
assert.match(await page.locator('#control').innerText(), /לקוחות עם איחור/);
await shot('03-control');

// New client from a signed agreement: the deal clock starts at the signature, and the
// shoot type and quantities come from the agreement's package (with its add-ons).
await page.click('#btn-new');
await page.waitForSelector('#from-quote-field:not([hidden])');
assert.equal(await page.innerText('#new-h'), 'פרטי עסקה');
await page.selectOption('#new-quote', signedQuote.id);
assert.equal(await page.inputValue('#new-name'), 'דנה לוי');
assert.equal(await page.inputValue('#new-package'), 'social-natali');
assert.equal(await page.inputValue('#new-shoot-type'), 'natali');
assert.match(await page.innerText('#new-shoot-hint'), /לפי החבילה/);
assert.match(await page.innerText('#new-package-hint'), /סרטונים 25 · גרפיקות 39[^]*כולל התוספות בהסכם/);
await page.click('#new-submit');
await page.waitForURL(/client\.html\?id=/);
const created = db.clients.find((c) => c.name === 'דנה לוי');
assert.equal(created.quote_id, signedQuote.id);
assert.equal(created.shoot_type, 'natali');
assert.equal(created.deal_at, signedQuote.signed_at);
assert.equal(created.package_name, 'Social all in one · נטלי דדון');
assert.deepEqual(created.deliverables, { videos: 25, graphics: 39, shoot_days: 1, collabs: 0, stories: 1, ch14: 0, monthly: 0 });

// Irit's card opens on her own processes and items; the whole protocol is one explicit click away.
await page.waitForSelector('#p02');
assert.match(await page.locator('#viewbar').innerText(), /רק התהליכים והפריטים שלך/);
assert.equal(await page.locator('#p11').count(), 1); // hers
assert.equal(await page.locator('#p11b').count(), 0); // Lior's
// Process 7 is Ilai's graphics: Irit sees her review items; Ilai's own item is summed up in one line.
assert.equal(await page.locator('#i-p07-made').count(), 0);
assert.equal(await page.locator('#i-p07-r-spelling').count(), 1);
assert.match(await page.locator('#p07 .others-note').textContent(), /ועוד פריט אחד בתהליך הזה אצל עילאי/);
assert.match(await page.locator('.cc-next .k').innerText(), /הצעד הבא שלך/);
assert.match(await page.locator('#p02 .others-note').textContent(), /ועוד 2 פריטים בתהליך הזה אצל ליאור/); // p02.deal, p02.team
assert.equal(await page.locator('#i-p02-deal').count(), 0);
await shot('04a-client-card-mine');
await page.click('#view-toggle');
await page.waitForSelector('#p11b', { state: 'attached' });
assert.equal(await page.innerText('#view-toggle'), 'רק התהליכים שלי');
assert.equal(await page.evaluate(() => document.activeElement?.id), 'view-toggle');
// Client card: Natali-only processes show, the DMS day does not.
assert.equal(await page.locator('#p11b').count(), 1);
assert.equal(await page.locator('#p21').count(), 0);
assert.match(await page.locator('#p11').textContent(), /חסר בפרטי הלקוח: מועד יום הצילום/);
// The signed agreement already covers process 1: it is done and folded away.
assert.deepEqual(db.protocol_checks.filter((c) => c.client_id === created.id).map((c) => c.item_key).sort(), ['p01.prepared', 'p01.sent', 'p01.signed']);
assert.equal(await page.locator('#p01').count(), 0);
assert.match(await page.locator('.done-row').first().innerText(), /1 תהליכים הושלמו/);
await page.check('#i-p02-opened');
await page.waitForFunction(() => document.querySelector('#i-p02-opened')?.closest('.item').classList.contains('is-done') && !document.querySelector('.is-busy'));
assert.ok(db.protocol_checks.some((c) => c.client_id === created.id && c.item_key === 'p02.opened'));
assert.match(await page.locator('#p02').textContent(), /בוצע · עירית/); // names, not email prefixes
// Focus stays on the checkbox after saving.
assert.equal(await page.evaluate(() => document.activeElement?.id), 'i-p02-opened');
// Sending the graphics waits for the review items.
assert.equal(await page.locator('#i-p07-sent').isDisabled(), true);
assert.match(await page.locator('#p07').textContent(), /ממתין ל: 7 בדיקות למעלה/);

// A required item needs a reason to be marked not relevant.
await page.click('#i-p02-intro-na', { force: true });
await page.waitForSelector('#dlg-na[open]');
await page.click('#na-submit');
assert.equal(await page.isVisible('#na-err'), true);
await page.fill('#na-reason', 'הלקוח ביקש הודעה מליאור בלבד');
await page.click('#na-submit');
await page.waitForFunction(() => document.querySelector('#i-p02-intro')?.closest('.item').classList.contains('is-na'));
assert.equal(db.protocol_checks.find((c) => c.client_id === created.id && c.item_key === 'p02.intro').note, 'הלקוח ביקש הודעה מליאור בלבד');

// Not relevant, then back
await page.click('#i-p05-menu-na'); // optional: no reason needed
await page.waitForFunction(() => document.querySelector('#i-p05-menu')?.closest('.item').classList.contains('is-na'));
assert.equal(db.protocol_checks.find((c) => c.client_id === created.id && c.item_key === 'p05.menu').state, 'na');

// A failed save rolls the checkbox back and says so.
failNextCheck = true;
// A plain click: check() would retry once it sees the rollback.
await page.click('#i-p02-m-lior');
await page.waitForFunction(() => !document.querySelector('#i-p02-m-lior').checked && !document.querySelector('.is-busy'));
assert.match(await page.locator('#toast').innerText(), /הסימון לא נשמר/);
assert.ok(!db.protocol_checks.some((c) => c.client_id === created.id && c.item_key === 'p02.m.lior'));

// Uncheck is recorded in history
await page.uncheck('#i-p02-opened');
await page.waitForFunction(() => !document.querySelector('.is-busy') && !document.querySelector('#i-p02-opened').checked);
await page.waitForFunction(() => /ביטל\/ה סימון/.test(document.querySelector('#hist-list').innerText));

// Edit details: Lior characterizes, so he takes the access too; no logo adds Ilai's logo item.
await page.click('#btn-edit');
await page.fill('#ed-char-at', '2026-10-01T10:00');
assert.deepEqual(await page.locator('#ed-characterizer option').evaluateAll((os) => os.map((o) => o.value)), ['', 'ofir', 'lior']);
await page.selectOption('#ed-characterizer', 'lior');
await page.selectOption('#ed-logo', 'false');
await page.fill('#ed-shoot-at', '2026-10-11T10:00');
await page.click('#ed-submit');
await page.waitForSelector('#i-p05-newlogo');
const p5 = await page.locator('#p05 .proc-meta').textContent();
assert.match(p5, /ליאור/); // whoever characterizes (Ofir or Lior) takes the access in the meeting
assert.doesNotMatch(p5, /אופיר/);
// Sunday shoot: reminder due on Thursday, the previous business day, at 11:00.
assert.match(await page.locator('#p15').textContent(), /11:00/);
// Shared process: Irit takes it, and it shows as hers.
await page.evaluate(() => { document.querySelector('#p29')?.closest('details').setAttribute('open', ''); });
await page.click('#p29 .claim .btn');
await page.waitForFunction(() => /עירית לקח/.test(document.querySelector('#p29 .claim')?.textContent || ''));
assert.equal(db.protocol_checks.find((c) => c.client_id === created.id && c.item_key === 'p29.claim').note, 'irit');

// Tasks
await page.fill('#task-title', 'להזמין מאפרת לנטלי');
await page.selectOption('#task-owner', 'lior');
await page.click('#task-submit');
await page.waitForFunction(() => /להזמין מאפרת לנטלי/.test(document.querySelector('#task-list').innerText));
assert.equal(db.client_tasks.at(-1).owner, 'lior');

// Nirel gets a brief, never a vague instruction: problem, change and the result wanted.
await page.fill('#task-title', 'לתקן את הפתיח בסרטון');
await page.selectOption('#task-owner', 'nirel');
assert.equal(await page.evaluate(() => document.querySelector('#task-brief-box').open), true);
const tasksBefore = db.client_tasks.length;
await page.click('#task-submit');
await page.waitForFunction(() => document.querySelector('#toast.on')?.textContent.includes('צריך בריף'));
assert.equal(db.client_tasks.length, tasksBefore);
await page.fill('#tb-problem', 'הפתיח ארוך מדי');
await page.fill('#tb-change', 'לקצר ל־3 שניות');
await page.fill('#tb-result', 'פתיח קצר עם הלוגו');
await page.click('#task-submit'); // still missing: what stays as it is
await page.waitForFunction(() => document.activeElement?.id === 'tb-keep');
await page.fill('#tb-keep', 'המוזיקה והצבעים');
await page.click('#task-submit'); // and when it is due
await page.waitForFunction(() => document.activeElement?.id === 'task-due');
assert.equal(db.client_tasks.length, tasksBefore);
await page.fill('#task-due', '2026-10-05');
await page.check('#task-urgent');
await page.click('#task-submit');
await page.waitForFunction(() => /לתקן את הפתיח/.test(document.querySelector('#task-list').innerText));
const briefTask = db.client_tasks.at(-1);
assert.equal(briefTask.owner, 'nirel');
assert.equal(briefTask.urgent, true);
assert.equal(briefTask.brief.change, 'לקצר ל־3 שניות');
assert.match(await page.locator('#task-list').innerText(), /דחוף/);

// Escalation to Lior: details are required; it lands as an urgent task of his.
await page.click('#btn-escalate');
await page.waitForSelector('#dlg-escalate[open]');
await page.click('#esc-submit');
assert.equal(await page.isVisible('#esc-err'), true);
await page.fill('#esc-details', 'הלקוח לא מאשר את הסקריפט כבר שבוע');
await page.check('#esc-urgent');
await page.click('#esc-submit');
await page.waitForFunction(() => !document.querySelector('#dlg-escalate[open]'));
const esc = db.client_tasks.at(-1);
assert.deepEqual([esc.owner, esc.source, esc.urgent], ['lior', 'escalation', true]);
assert.match(esc.title, /הלקוח לא מאשר את הסקריפט/);

// Access vault: a working login needs a user name; the password is stored apart and shown on request only.
await page.click('#access-add');
await page.waitForSelector('#dlg-access[open]');
await page.selectOption('#acc-network', 'instagram');
await page.click('#acc-submit');
assert.match(await page.locator('#acc-err').innerText(), /שם משתמש/);
await page.fill('#acc-username', 'ron.hair');
await page.fill('#acc-password', 'S3cret!pw');
await page.click('#acc-submit');
await page.waitForSelector('.access-row');
assert.equal(db.client_access.length, 1);
assert.ok(!JSON.stringify(db.client_access).includes('S3cret'), 'password stored on the row');
assert.doesNotMatch(await page.locator('#access').textContent(), /S3cret/);
await page.click('.access-row button:has-text("הצגת סיסמה")');
await page.waitForFunction(() => /S3cret!pw/.test(document.querySelector('.access-row .secret')?.textContent || ''));
assert.equal(db.client_access_log.at(-1).action, 'reveal');
await page.waitForFunction(() => /צפה\/תה בסיסמה/.test(document.querySelector('#access-log').textContent));
// The password stays on screen after the log refreshes.
await page.waitForTimeout(300);
assert.match(await page.locator('.access-row .secret').textContent(), /S3cret!pw/);
// A broken login opens an urgent task for Lior to restore it.
await page.click('#access-add');
await page.waitForSelector('#dlg-access[open]');
await page.selectOption('#acc-network', 'facebook');
await page.selectOption('#acc-status', 'broken');
assert.equal(await page.isVisible('#acc-task-wrap'), true);
await page.click('#acc-submit');
await page.waitForFunction(() => document.querySelectorAll('.access-row').length === 2);
const accTask = db.client_tasks.at(-1);
assert.deepEqual([accTask.owner, accTask.urgent], ['lior', true]);
assert.match(accTask.title, /פייסבוק|Facebook/i);

// Mark a whole process: process 3 has four items, all Irit's.
await page.evaluate(() => { document.querySelector('#p03')?.closest('details').setAttribute('open', ''); });
await page.waitForSelector('#p03-bulk');
assert.match(await page.locator('#p03-bulk').innerText(), /סימון כל התהליך כבוצע \(4\)/);
await page.click('#p03-bulk');
await page.waitForFunction(() => document.querySelector('#toast.on')?.textContent.includes('סומנו 4 פריטים'));
assert.equal(db.protocol_checks.filter((c) => c.client_id === created.id && c.item_key.startsWith('p03.')).length, 4);
await page.click('.toast-act');
await page.waitForFunction(() => document.querySelector('#toast.on')?.textContent.includes('בוטל'));
assert.equal(db.protocol_checks.filter((c) => c.client_id === created.id && c.item_key.startsWith('p03.')).length, 0);
// Completing a process that waits on the client in bulk ends the wait and keeps its time (decision 3).
db.protocol_checks.push({ client_id: created.id, item_key: 'p03.wait', state: 'done', note: JSON.stringify({ reason: 'הלקוח בודק מועדים', recheck: null }), by_email: USER.email, at: hoursAgo(1) });
await page.reload();
await page.evaluate(() => { document.querySelector('#p03')?.closest('details').setAttribute('open', ''); });
await page.waitForSelector('#p03.s-client #p03-bulk');
await page.click('#p03-bulk');
await page.waitForFunction(() => document.querySelector('#toast.on')?.textContent.includes('סומנו 4 פריטים'));
assert.ok(!db.protocol_checks.some((c) => c.client_id === created.id && c.item_key === 'p03.wait'));
assert.equal(typeof JSON.parse(db.protocol_checks.find((c) => c.client_id === created.id && c.item_key === 'p03.waited').note).min, 'number');
assert.equal(await page.locator('#p03.s-client').count(), 0);
await page.click('.toast-act');
await page.waitForFunction(() => document.querySelector('#toast.on')?.textContent.includes('בוטל'));

// Waiting on the client: a reason is required; the process leaves "overdue".
await page.click('#p02 .wait-btn');
await page.waitForSelector('#dlg-wait[open]');
await page.click('#wait-submit');
assert.equal(await page.isVisible('#wait-err'), true);
await page.fill('#wait-reason', 'הלקוח עוד לא הצטרף לקבוצה');
await page.click('#wait-submit');
await page.waitForSelector('#p02.s-client');
assert.match(await page.locator('#p02 .wait-line').innerText(), /הלקוח עוד לא הצטרף לקבוצה/);
assert.equal(JSON.parse(db.protocol_checks.find((c) => c.client_id === created.id && c.item_key === 'p02.wait').note).reason, 'הלקוח עוד לא הצטרף לקבוצה');
await page.click('#p02 .wait-line button:has-text("סיום המתנה")');
await page.waitForFunction(() => !document.querySelector('#p02.s-client'));
// The wait's office minutes are kept on the process: its deadline moves on by them.
assert.equal(typeof JSON.parse(db.protocol_checks.find((c) => c.client_id === created.id && c.item_key === 'p02.waited').note).min, 'number');
assert.ok(!db.protocol_checks.some((c) => c.client_id === created.id && c.item_key === 'p02.wait'));

// Links: passwords are refused, links are saved and shown.
await page.click('#btn-edit');
await page.fill('#ed-link-drive', 'https://drive.google.com/x?password=1');
await page.click('#ed-submit');
assert.match(await page.locator('#ed-err').innerText(), /סיסמאות/);
await page.fill('#ed-link-drive', 'https://drive.google.com/drive/folders/abc');
await page.fill('#ed-address', 'הבונים 5, רמת גן');
await page.fill('#ed-deliv-videos', '25');
await page.fill('#ed-deliv-shoot_days', '1');
// Natali clients can be edited by Nirel too.
assert.ok((await page.locator('#ed-editor option').allTextContents()).some((t) => /ניראל/.test(t)));
await page.selectOption('#ed-editor', 'nirel');
await page.click('#ed-submit');
await page.waitForSelector('.cc-links a.link-chip');
assert.equal(db.clients.find((c) => c.id === created.id).links.drive, 'https://drive.google.com/drive/folders/abc');
assert.equal(db.clients.find((c) => c.id === created.id).editor, 'nirel');
assert.match(await page.locator('#p22 .proc-meta').textContent(), /ניראל/);
// Nirel edits only Natali's clients: a different shoot type refuses her instead of dropping her silently.
await page.click('#btn-edit');
await page.selectOption('#ed-shoot-type', 'dms');
assert.equal(await page.inputValue('#ed-editor'), 'nirel');
await page.click('#ed-submit');
assert.match(await page.locator('#ed-err').innerText(), /נטלי/);
await page.click('#dlg-edit [data-close]');

// Package quantities: + saves after a short pause.
assert.match(await page.locator('#deliv-videos-v').innerText(), /נמסרו 0 מתוך 25/);
await page.click('#deliv-videos-plus');
await page.click('#deliv-videos-plus');
assert.match(await page.locator('#deliv-videos-v').innerText(), /נמסרו 2 מתוך 25/);
await page.waitForFunction((cid) => true, created.id);
await page.waitForTimeout(1200);
assert.equal(db.clients.find((c) => c.id === created.id).deliverables.done.videos, 2);

// Calendar: Google link with the team arriving an hour before the influencers.
const gcal = await page.locator('.cc-facts details.cal a').nth(1).getAttribute('href');
assert.match(gcal, /dates=20261011T060000Z%2F20261011T100000Z/); // Natali: 09:00–13:00 Israel time

// Extra shoot round beyond the package asks for a purchased day.
await page.click('.deliv-row .btn:has-text("הוספת סבב צילום")');
await page.waitForSelector('#dlg-round[open]');
await page.click('#round-submit');
assert.match(await page.locator('#round-err').innerText(), /נרכש יום צילום נוסף/);
await page.check('#round-extra');
await page.fill('#round-at', '2027-03-10T10:00');
await page.click('#round-submit');
await page.waitForSelector('#r2-p11', { state: 'attached' });
assert.equal(db.clients.find((c) => c.id === created.id).rounds[0].n, 2);
assert.equal(await page.locator('#r2-p11b').count(), 1);

// Structured weekly call with a task.
await page.evaluate(() => document.querySelectorAll('details.phase').forEach((d) => { d.open = true; }));
await page.click('#p31 .recurring .btn');
await page.waitForSelector('#dlg-call[open]');
await page.click('#call-submit');
assert.match(await page.locator('#call-err').innerText(), /לא נכתב דבר/);
await page.fill('#call-campaigns', 'קמפיין לידים רץ טוב');
await page.click('#call-add-task');
await page.fill('#ct-1-t', 'לשלוח הצעה לסרטון נוסף');
await page.click('#call-submit');
assert.match(await page.locator('#call-err').innerText(), /בחרו מי מבצע/);
await page.selectOption('#ct-1-o', 'lior');
await page.click('#call-submit');
await page.waitForFunction(() => !document.querySelector('#dlg-call[open]'));
const call = db.protocol_checks.find((c) => c.client_id === created.id && c.item_key === 'p31.call');
assert.equal(JSON.parse(call.note).topics.campaigns, 'קמפיין לידים רץ טוב');
assert.deepEqual(db.client_tasks.filter((t) => t.client_id === created.id && t.source === 'p31').map((t) => t.owner), ['lior']);
// Irit checks every call is documented and every task has an owner.
assert.match(db.client_tasks.find((t) => t.client_id === created.id && t.source === 'followup' && t.owner === 'irit').title, /מתועדת/);

// Reload keeps everything
await page.reload();
await page.waitForSelector('#p02');
assert.equal(await page.isChecked('#i-p02-opened'), false);
assert.match(await page.locator('#p05').textContent(), /לא רלוונטי/);

// Person focus: only Ilai's processes
await page.click('.viewbar .chip:has-text("עילאי")');
await page.check('.only input');
await page.evaluate(() => document.querySelectorAll('details.phase').forEach((d) => { d.open = true; }));
const shown = await page.locator('.proc').evaluateAll((els) => els.map((e) => e.id));
assert.ok(shown.includes('p06') && !shown.includes('p04') && !shown.includes('p12') && !shown.includes('p10'), shown.join());
await page.uncheck('.only input');
await page.click('.viewbar .chip:has-text("כל הצוות")');
await shot('04-client-card');

// Seeded client, mid-way
await page.goto(`${BASE}client.html?id=${seeded.id}`);
await page.waitForSelector('#p21', { state: 'attached' });
await shot('05-client-midway');

// Keyboard: tab to a checkbox and toggle with space.
await page.focus('#i-p06-verified');
await page.keyboard.press('Space');
await page.waitForFunction(() => document.querySelector('#i-p06-verified').checked && !document.querySelector('.is-busy'));

// A video editor ('own'): only her processes, none of the office's controls, no vault;
// a paused edit tells Lior and Ofir.
db.staff[0].person = 'nadia';
db.staff[0].vault = false;
seeded.editor = 'nadia';
seeded.links = { drive: 'https://drive.google.com/drive/folders/ron' };
await page.goto(`${BASE}client.html?id=${seeded.id}`);
await page.waitForSelector('#p22', { state: 'attached' });
assert.equal(await page.isHidden('#access'), true);
const nadiaProcs = await page.locator('.proc').evaluateAll((els) => els.map((e) => e.id));
assert.ok(nadiaProcs.length && nadiaProcs.every((x) => ['p22', 'p24', 'p27'].includes(x)), nadiaProcs.join());
assert.equal(await page.locator('#view-toggle').count(), 0); // no "whole protocol" for 'own'
assert.match(await page.locator('#viewbar').innerText(), /רק התהליכים והפריטים שלך בלקוח הזה/);
for (const sel of ['#btn-edit', '.deliv', '.round-add', '.auto-note .btn', '.cc-links .btn-text', '.chip-missing']) assert.equal(await page.locator(sel).count(), 0, sel);
assert.equal(await page.isVisible('#btn-escalate'), true); // exceptions still go to Lior
assert.equal(await page.isHidden('#history'), true);
assert.equal(await page.isHidden('#tasks'), true); // no task of hers here, and no task form
assert.match(await page.locator('.cc-links').innerText(), /תיקיית Drive/); // the links to work with stay
assert.doesNotMatch(await page.locator('.cc-facts').innerText(), /טלפון|סיום החוזה/);
assert.match(await page.locator('.cc-progress').innerText(), /התהליכים שלי שהושלמו/);
assert.equal(await page.locator('#app > a.back').innerText(), '→ מה עליי');
// Why her editing waits, in one line.
assert.match(await page.locator('.cc-next').innerText(), /התהליך הבא שלך[^]*22 · עריכת הסרטונים[^]*ממתין ל: הלקוח שויך לעורך והכונן הועבר אליו \(תהליך 22א\)/);
await page.evaluate(() => { document.querySelector('#p22')?.closest('details').setAttribute('open', ''); });
await page.click('#p22 button:has-text("עצירת העריכה")');
await page.waitForSelector('#dlg-pause[open]');
await page.click('#pause-submit');
assert.equal(await page.isVisible('#pause-err'), true);
await page.fill('#pause-stage', 'חיתוך ראשון');
await page.fill('#pause-left', 'כתוביות ומוזיקה');
await page.fill('#pause-why', 'סרטון דחוף ללקוח אחר');
await page.click('#pause-submit');
await page.waitForSelector('#p22 .pause-line');
await page.waitForFunction(() => document.querySelector('#toast.on')?.textContent.includes('ליאור ואופיר עודכנו'));
assert.equal(JSON.parse(db.protocol_checks.find((c) => c.client_id === seeded.id && c.item_key === 'p22.pause').note).left, 'כתוביות ומוזיקה');
assert.deepEqual(db.client_tasks.filter((t) => t.client_id === seeded.id && /עצר/.test(t.title)).map((t) => t.owner).sort(), ['lior', 'ofir']);
await page.click('#p22 .pause-line button:has-text("חזרה לעריכה")');
await page.waitForFunction(() => !document.querySelector('#p22 .pause-line'));
// A task given to her shows (only hers), without the form to open tasks.
db.client_tasks.push({ id: randomUUID(), client_id: seeded.id, title: 'לקצר את סרטון 4', owner: 'nadia', due_on: null, done_at: null, done_by_email: null, created_by_email: 'ofir@astrateg.test', created_at: hoursAgo(1), source: null, brief: null, urgent: false });
await page.reload();
await page.waitForSelector('#tasks:not([hidden]) .tlist .item');
assert.equal(await page.isHidden('#task-form'), true);
assert.deepEqual(await page.locator('#task-list .ilabel').allInnerTexts(), ['לקצר את סרטון 4']);
await shot('09-editor-card');

// Her "my work": no picker, no one else's list, no office tabs, only her clients.
await page.goto(`${BASE}clients.html`);
await page.waitForSelector('#view-mine:not([hidden]) .wproc');
assert.equal(await page.getAttribute('#tab-mine', 'aria-selected'), 'true');
assert.match(await page.locator('#me-bar').innerText(), /נדיה/);
assert.equal(await page.locator('.who-panel, #mine-people .chip, #mine-select').count(), 0);
for (const t of ['#tab-control', '#btn-new']) assert.equal(await page.isHidden(t), true, t);
// Her own row of the team screen only (decision 22): no process table, no one else.
assert.equal(await page.innerText('#tab-performance'), 'הנתונים שלי');
assert.match(await page.locator('#mine-list').innerText(), /מספרת רון[^]*לקצר את סרטון 4/);
assert.doesNotMatch(await page.locator('#mine-list').innerText(), /פיצה נאפולי|דנה לוי/);
await page.goto(`${BASE}clients.html#control`); // the office screens are not reachable by link either
await page.waitForSelector('#view-mine:not([hidden])');
assert.equal(await page.isHidden('#view-control'), true);
await page.click('#tab-clients');
await page.waitForSelector('.crow');
assert.equal(await page.innerText('#tab-clients'), 'הלקוחות שלי');
assert.deepEqual(await page.locator('.crow strong').allInnerTexts(), ['מספרת רון']); // the client she edits
assert.match(await page.locator('.crow .cnext').innerText(), /הצעד הבא שלך[^]*לקצר את סרטון 4/);
assert.equal(await page.locator('#client-filters .chip').count(), 0);
await shot('10-editor-clients');
db.client_tasks = db.client_tasks.filter((t) => t.owner !== 'nadia');

// The photographer ('own'): the coming shoot day is in his list before it starts,
// and the card shows only his three shoot-day processes.
db.staff[0].person = 'eli';
await page.goto(`${BASE}clients.html`);
await page.waitForSelector('#view-mine:not([hidden]) .g-soon');
const soon = page.locator('.g-soon .soon-card:has(.wclient:text("מספרת רון"))');
assert.match(await soon.innerText(), /יום צילום[^]*הגעת המשפיענים[^]*כתובת: הרצל 10, תל אביב[^]*17ב · הצלם: הגעה, ציוד ובי־רול[^]*18ב[^]*19ב/);
assert.equal(await page.locator('.g-soon .cbx').count(), 0); // not checkable before the day
assert.equal(await page.locator('#mine-people .chip, #tab-control:not([hidden])').count(), 0);
assert.ok(await noHScroll(page));
await shot('11-photographer-mine');
await soon.locator('.wclient').click();
await page.waitForSelector('#p17b');
assert.equal(new URL(page.url()).hash, '#p17b');
const eliProcs = await page.locator('.proc').evaluateAll((els) => els.map((e) => e.id));
assert.deepEqual(eliProcs, ['p17b', 'p18b', 'p19b']);
assert.match(await page.locator('.cc-facts').innerText(), /הרצל 10, תל אביב/);
// One click: arriving an hour early is checked on the card.
await page.check('#i-p17b-arrived');
await page.waitForFunction(() => document.querySelector('#i-p17b-arrived')?.closest('.item').classList.contains('is-done') && !document.querySelector('.is-busy'));
assert.ok(db.protocol_checks.some((c) => c.client_id === seeded.id && c.item_key === 'p17b.arrived' && c.state === 'done'));
// Handing the drive to Lior is confirmed on its own, never in bulk.
assert.equal(await page.locator('#i-p19b-handed').count(), 1);
await shot('12-photographer-card');
db.protocol_checks = db.protocol_checks.filter((c) => !(c.client_id === seeded.id && c.item_key === 'p17b.arrived'));

db.staff[0].person = 'irit';
db.staff[0].vault = true;
seeded.editor = null;

// Manual open ("פרטי עסקה"): the shoot type is required; a catalog package sets it and fills the quantities.
await page.goto(`${BASE}clients.html#clients`);
await page.waitForSelector('.crow');
await page.click('#btn-new');
await page.waitForSelector('#dlg-new[open]');
assert.ok((await page.locator('#new-package option').allTextContents()).includes('Social + TV all in one · סמיון, מישל ודניס'));
await page.fill('#new-name', 'קפה גליל');
const clientsBefore = db.clients.length;
await page.click('#new-submit');
assert.match(await page.locator('#new-err').innerText(), /חסר סוג יום הצילום/);
assert.equal(await page.getAttribute('#new-shoot-type', 'aria-invalid'), 'true');
assert.equal(db.clients.length, clientsBefore);
await page.selectOption('#new-package', 'social-tv-simeon');
assert.equal(await page.inputValue('#new-shoot-type'), 'dms'); // from the package in the catalog
assert.equal(await page.isHidden('#new-err'), true);
assert.equal(await page.getAttribute('#new-shoot-type', 'aria-invalid'), null);
assert.match(await page.innerText('#new-package-hint'), /סרטונים 42 · גרפיקות 42/);
await page.selectOption('#new-package', ''); // outside the catalog nothing is guessed
assert.equal(await page.inputValue('#new-shoot-type'), '');
await page.selectOption('#new-package', 'social-tv-simeon');
await shot('13-new-deal');
await page.click('#new-submit');
await page.waitForURL(/client\.html\?id=/);
const manual = db.clients.find((c) => c.name === 'קפה גליל');
assert.equal(manual.shoot_type, 'dms');
assert.equal(manual.package_name, 'Social + TV all in one · סמיון, מישל ודניס');
assert.deepEqual(manual.deliverables, { videos: 42, graphics: 42, shoot_days: 2, collabs: 3, stories: 3, ch14: 1, monthly: 0 });
assert.ok(Math.abs(Date.now() - new Date(manual.deal_at)) < 5 * 60e3, 'a new deal reaches the office now');
assert.equal(db.protocol_checks.filter((c) => c.client_id === manual.id).length, 0);
// Scripts and graphics follow the package, not a fixed 36.
await page.waitForSelector('#p02', { state: 'attached' });
if (await page.innerText('#view-toggle') !== 'רק התהליכים שלי') await page.click('#view-toggle');
await page.waitForSelector('#p12', { state: 'attached' });
assert.match(await page.locator('#p12 .pkg-qty').textContent(), /בחבילה של הלקוח: 42 סרטונים/);
assert.match(await page.locator('#p23 .pkg-qty').textContent(), /בחבילה של הלקוח: 42 גרפיקות/);
assert.match(await page.locator('#i-p12-scripts').evaluate((el) => el.closest('.item').textContent), /לפי החבילה/);
for (const pid of ['#p12', '#p23']) assert.doesNotMatch(await page.locator(pid).textContent(), /(^|\D)36(\D|$)|עוד 27/, pid);

// Importing a client already in editing: everything before "עריכה ובקרה" is marked
// 'ייבוא' by the signed-in user, with the known dates, and none of it shows as late.
await page.goto(`${BASE}clients.html#clients`);
await page.waitForSelector('.crow');
await page.click('#btn-new');
await page.waitForSelector('#dlg-new[open]');
assert.equal(await page.isHidden('#new-import'), true);
await page.click('#new-mode-import');
assert.equal(await page.getAttribute('#new-mode-import', 'aria-pressed'), 'true');
assert.equal(await page.isVisible('#new-import'), true);
assert.deepEqual((await page.locator('#new-station option').allTextContents()).slice(1),
  ['1. הצטרפות', '2. אפיון', '3. תוכן ואישור', '4. יום צילום', '5. עריכה ובקרה', '6. פרסום', '7. שוטף', '8. חידוש']);
await page.fill('#new-name', 'מאפיית שיבולת');
await page.selectOption('#new-package', 'social-natali');
await page.click('#new-submit');
assert.match(await page.locator('#new-err').innerText(), /התחנה/);
await page.selectOption('#new-station', 'post');
await page.fill('#new-deal-at', '2026-08-02T10:00');
await page.fill('#new-char-at', '2026-08-04T10:00');
await page.fill('#new-shoot-at', '2026-08-20T10:00');
await shot('14-import');
await page.click('#new-submit');
await page.waitForURL(/client\.html\?id=/);
const imported = db.clients.find((c) => c.name === 'מאפיית שיבולת');
assert.equal(imported.shoot_type, 'natali');
assert.equal(imported.deal_at, new Date('2026-08-02T10:00:00+03:00').toISOString());
assert.equal(imported.char_at, new Date('2026-08-04T10:00:00+03:00').toISOString());
assert.equal(imported.shoot_at, new Date('2026-08-20T10:00:00+03:00').toISOString());
const impChecks = db.protocol_checks.filter((c) => c.client_id === imported.id);
assert.deepEqual(impChecks.map((c) => c.item_key).sort(), importKeys('post').sort());
assert.ok(impChecks.every((c) => c.state === 'done' && c.note === 'ייבוא' && c.by_email === USER.email), 'import checks');
assert.ok(impChecks.some((c) => c.item_key === 'p19b.handed') && impChecks.some((c) => c.item_key === 'p11b.ride'));
const postOn = new Set(STATIONS.slice(4).flatMap((st) => st.procs));
assert.ok(!impChecks.some((c) => postOn.has(c.item_key.split('.')[0])), 'nothing from the station on is marked');
const beforePost = new Set(STATIONS.slice(0, 4).flatMap((st) => st.procs));
const impState = clientState(imported, Object.fromEntries(impChecks.map((c) => [c.item_key, c])), new Date());
assert.ok(impState.states.filter((x) => beforePost.has(x.proc.id)).every((x) => x.status === 'done'));
assert.equal(impState.current, 'post');
await page.waitForSelector('#p22a', { state: 'attached' });
// Every process before the station is on the card, and done: none of them late or due today.
const shownBefore = async () => page.locator('.proc').evaluateAll((els, ids) => els.filter((e) => ids.includes(e.id))
  .map((e) => `${e.id}:${[...e.classList].find((c) => c.startsWith('s-'))}`), [...beforePost]);
const impBefore = impState.states.filter((x) => beforePost.has(x.proc.id)).map((x) => `${x.proc.id}:s-done`);
assert.deepEqual((await shownBefore()).sort(), impBefore.sort());
const lateProcs = await page.locator('.proc.s-overdue, .proc.s-today').evaluateAll((els) => els.map((e) => e.id));
assert.ok(lateProcs.every((pid) => postOn.has(pid)), `late before the station: ${lateProcs}`);
assert.equal(await page.locator('.phase.is-current h2').innerText(), 'עריכה ומסירה');
await shot('15-imported-card');
// Details the import did not ask for, filled on the card later (no logo, the other shoot day),
// reopen nothing before the station.
Object.assign(imported, { has_logo: false, shoot_type: 'dms' });
await page.reload();
await page.waitForSelector('#p22a', { state: 'attached' });
assert.deepEqual((await shownBefore()).sort(),
  clientState(imported, Object.fromEntries(impChecks.map((c) => [c.item_key, c])), new Date()).states
    .filter((x) => beforePost.has(x.proc.id)).map((x) => `${x.proc.id}:s-done`).sort());
assert.ok((await shownBefore()).some((x) => x === 'p21:s-done') && (await shownBefore()).includes('p05:s-done'));
assert.equal(await page.locator('.phase.is-current h2').innerText(), 'עריכה ומסירה');

// The client opens but the import's checks fail to save: the dialog does not close
// quietly (that would lose the import), and pressing again saves only the checks.
await page.goto(`${BASE}clients.html#clients`);
await page.waitForSelector('.crow');
await page.click('#btn-new');
await page.waitForSelector('#dlg-new[open]');
await page.click('#new-mode-import');
await page.fill('#new-name', 'גלידה אמיתית');
await page.selectOption('#new-package', 'social-simeon');
await page.selectOption('#new-station', 'content');
failNextCheck = true;
await page.click('#new-submit');
await page.waitForSelector('#new-err:not([hidden])');
assert.match(await page.innerText('#new-err'), /הלקוח נפתח, אבל הסימונים של הייבוא לא נשמרו/);
assert.equal(await page.innerText('#new-submit'), 'שמירת הסימונים');
const gelato = () => db.clients.filter((c) => c.name === 'גלידה אמיתית');
assert.equal(gelato().length, 1);
assert.equal(db.protocol_checks.filter((c) => c.client_id === gelato()[0].id).length, 0);
const asked = [];
const answer = (d) => { asked.push(d.message()); d.dismiss(); };
page.on('dialog', answer);
await page.keyboard.press('Escape');
await page.click('#dlg-new [data-close]');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape'); // may close without a cancel the page can stop: it reopens
await page.waitForTimeout(100);
page.off('dialog', answer);
assert.ok(asked.length >= 2 && asked.every((m) => /סימוני הייבוא לא נשמרו/.test(m)), asked.join(' | '));
assert.equal(await page.locator('#dlg-new').evaluate((d) => d.open), true);
assert.match(await page.innerText('#new-err'), /לא נשמרו/);
await page.click('#new-submit');
await page.waitForURL(/client\.html\?id=/);
assert.equal(gelato().length, 1, 'the retry does not open the client twice');
const gelatoChecks = db.protocol_checks.filter((c) => c.client_id === gelato()[0].id);
assert.deepEqual(gelatoChecks.map((c) => c.item_key).sort(), importKeys('content').sort());
assert.ok(gelatoChecks.every((c) => c.note === 'ייבוא'));

// Mobile
const mob = await ctx.newPage();
await mob.setViewportSize({ width: 360, height: 780 });
await mob.goto(`${BASE}client.html?id=${seeded.id}`);
await mob.waitForSelector('#p06', { state: 'attached' });
assert.ok(await noHScroll(mob), 'client card scrolls sideways at 360px');
const box = await mob.locator('#i-p06-name').boundingBox();
const row = await mob.locator('#i-p06-name').evaluate((el) => el.closest('.item').getBoundingClientRect().height);
assert.ok(box.width >= 24 && row >= 44, `touch target ${box.width}x${row}`);
await shot('06-mobile-card', mob);
await mob.goto(`${BASE}clients.html#clients`);
await mob.waitForSelector('.crow');
assert.ok(await noHScroll(mob), 'clients list scrolls sideways at 360px');
await shot('07-mobile-clients', mob);
// The deal form, in import mode, fits a phone.
await mob.click('#btn-new');
await mob.waitForSelector('#dlg-new[open]');
await mob.click('#new-mode-import');
const dlgBox = await mob.locator('#dlg-new').boundingBox();
assert.ok(dlgBox.x >= 0 && dlgBox.x + dlgBox.width <= 360, `deal form ${dlgBox.x}+${dlgBox.width}`);
assert.ok(await mob.locator('#new-station').evaluate((el) => el.getBoundingClientRect().right <= 360));
await shot('07b-mobile-import', mob);
await mob.click('#dlg-new [data-close]');
await mob.goto(`${BASE}clients.html#mine`);
await mob.waitForSelector('.witem');
assert.ok(await noHScroll(mob), 'my work scrolls sideways at 360px');
await shot('08-mobile-mine', mob);

assert.deepEqual(errors, []);
await browser.close();
console.log('protocol e2e: all checks passed');
