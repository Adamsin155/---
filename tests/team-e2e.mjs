// End-to-end check of the team screen (team.html) and the "choose a password"
// landing on clients.html, against an in-memory fake of Supabase that also fakes
// the staff-admin function (with the function's own rules module).
// Run: npx http-server -p 8080 -s . &  then  node tests/team-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import {
  roleOf, planUpsert, planRemove, planLink, linkTypeFor, buildLoginLink, summarize, normEmail,
} from '../supabase/functions/staff-admin/rules.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const hoursAgo = (n) => new Date(Date.now() - n * 36e5).toISOString();

// Logins (auth users) and the staff list. Nadia has a staff row but no login; Eli has neither.
const users = new Map();
const addUser = (email, extra = {}) => {
  const u = { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: hoursAgo(500), last_sign_in_at: null, invited_at: null, ...extra };
  users.set(email, u);
  return u;
};
addUser('owner@astrateg.test', { last_sign_in_at: hoursAgo(1) });
addUser('irit@astrateg.test', { last_sign_in_at: hoursAgo(2) });
addUser('lior@astrateg.test', { last_sign_in_at: hoursAgo(26) });
addUser('ofir@astrateg.test', { email_confirmed_at: null, invited_at: hoursAgo(30) });
addUser('yariv@astrateg.test', { last_sign_in_at: hoursAgo(3) });
const staff = [
  { email: 'owner@astrateg.test', person: null, vault: true, created_at: hoursAgo(900) },
  { email: 'irit@astrateg.test', person: 'irit', vault: true, created_at: hoursAgo(800) },
  { email: 'lior@astrateg.test', person: 'lior', vault: true, created_at: hoursAgo(700) },
  { email: 'ofir@astrateg.test', person: 'ofir', vault: true, created_at: hoursAgo(600) },
  { email: 'nadia@astrateg.test', person: 'nadia', vault: false, created_at: hoursAgo(500) },
  { email: 'yariv@astrateg.test', person: 'yariv', vault: false, created_at: hoursAgo(400) },
];
const tables = { clients: [], protocol_checks: [], client_tasks: [], quotes: [], office_reviews: [], client_status_notes: [], protocol_log: [] };

const EXP = Math.floor(Date.now() / 1000) + 3 * 3600;
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const sessionFor = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: EXP - Math.floor(Date.now() / 1000), expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};

const tokens = new Map();        // token hash -> { email, type, used }
const fnCalls = [];              // { by, action, ... }
const verifyCalls = [];
const passwordUpdates = [];
const lastLink = new Map();

function staffAdmin(caller, body) {
  if (!caller) return [401, { error: 'not_signed_in' }];
  const me = staff.find((r) => r.email === caller.email);
  const role = roleOf(me);
  fnCalls.push({ by: caller.email, ...body });
  if (!role) return [403, { error: 'not_allowed' }];
  const find = (email) => staff.find((r) => r.email === email) || null;
  if (body.action === 'list') {
    return [200, { caller: { email: caller.email, person: me.person, owner: role === 'owner' }, rows: staff.map((r) => summarize(r, users.get(r.email), lastLink.get(r.email))) }];
  }
  const email = normEmail(body.email);
  if (!email) return [400, { error: 'bad_email' }];
  if (body.action === 'upsert') {
    const existing = find(email);
    const personTaken = !existing && staff.some((r) => r.person === body.person);
    const plan = planUpsert({ role, callerEmail: caller.email, existing, input: body, personTaken });
    if (!plan.ok) return [plan.status, { error: plan.error }];
    if (existing) Object.assign(existing, { person: plan.row.person, vault: plan.row.vault });
    else staff.push({ ...plan.row, created_at: new Date().toISOString() });
    return [200, { ok: true }];
  }
  if (body.action === 'remove') {
    const existing = find(email);
    const plan = planRemove({ role, callerEmail: caller.email, existing });
    if (!plan.ok) return [plan.status, { error: plan.error }];
    staff.splice(staff.indexOf(existing), 1);
    return [200, { ok: true }];
  }
  if (body.action === 'link') {
    const plan = planLink({ role, target: find(email), redirectTo: body.redirectTo });
    if (!plan.ok) return [plan.status, { error: plan.error }];
    const type = linkTypeFor(users.get(email) || null);
    if (type === 'invite') addUser(email, { email_confirmed_at: null, invited_at: new Date().toISOString() });
    const hash = randomBytes(16).toString('hex');
    tokens.set(hash, { email, type, used: false });
    lastLink.set(email, { at: new Date().toISOString(), by_email: caller.email });
    return [200, { link: buildLoginLink(plan.page, type, hash), type }];
  }
  return [400, { error: 'unknown_action' }];
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
  const me = userOf(headers);
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    u.last_sign_in_at = new Date().toISOString();
    return json(200, sessionFor(u));
  }
  if (p === '/auth/v1/verify') {
    verifyCalls.push(body);
    const t = tokens.get(body.token_hash);
    if (!t || t.used || t.type !== body.type) return json(403, { code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' });
    t.used = true;
    const u = users.get(t.email);
    u.email_confirmed_at ||= new Date().toISOString();
    u.last_sign_in_at = new Date().toISOString();
    return json(200, sessionFor(u));
  }
  if (p === '/auth/v1/user') {
    if (!me) return json(401, { code: 401, msg: 'invalid JWT' });
    if (req.method() === 'PUT') passwordUpdates.push({ email: me.email, password: body.password });
    return json(200, me);
  }
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p === '/functions/v1/staff-admin') {
    const [status, data] = staffAdmin(me, body);
    return json(status, data);
  }
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me?.email_confirmed_at && staff.some((r) => r.email === me.email));
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  if (!me) return json(401, { message: 'permission denied' });
  let rows = m[1] === 'staff' ? staff : tables[m[1]];
  if (!rows) return json(404, { message: 'not found' });
  const eq = url.searchParams.get('email');
  if (eq?.startsWith('eq.')) rows = rows.filter((r) => r.email === eq.slice(3));
  if ((headers.accept || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' });
  return json(200, rows);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newPage(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', fakeSupabase);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, path, email) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app:not([hidden])');
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const text = (page, sel) => page.locator(sel).innerText();
const toastHas = (page, s) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), s);
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last calls: ${JSON.stringify(fnCalls.slice(-3))}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

// ── The owner ─────────────────────────────
const owner = await newPage();
await step('owner sees everyone: owner first, then the protocol people, with their login state', async () => {
  await signIn(owner, 'team.html', 'owner@astrateg.test');
  await owner.waitForSelector('#team-list .tm-row');
  assert.equal(await owner.locator('#no-access').isHidden(), true);
  const people = await owner.locator('#team-list .tm-row').evaluateAll((els) => els.map((e) => e.dataset.person));
  assert.deepEqual(people, ['owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli']);
  assert.match(await text(owner, '#row-owner'), /הבעלים[\s\S]*זה אני/);
  assert.match(await text(owner, '#row-irit'), /עירית[\s\S]*irit@astrateg\.test[\s\S]*מחובר\/ה לאחרונה היום/);
  assert.match(await text(owner, '#row-lior'), /מחובר\/ה לאחרונה אתמול/);
  assert.match(await text(owner, '#row-ofir'), /טרם נכנס\/ה/);
  assert.match(await text(owner, '#row-nadia'), /nadia@astrateg\.test[\s\S]*אין חשבון/);
  assert.match(await text(owner, '#row-eli'), /אלי[\s\S]*צלם[\s\S]*אין חשבון/);
  assert.equal(await owner.locator('#email-eli').count(), 1, 'a missing email can be added');
  assert.equal(await owner.locator('#mklink-eli').count(), 0, 'no link without an email');
  assert.equal(await owner.locator('#remove-owner').count(), 0, 'the owner cannot remove themselves');
  assert.equal(await owner.locator('#remove-nadia').count(), 1);
  await shot(owner, 'team-01-owner');
});

await step('owner toggles the vault (with a confirmation)', async () => {
  assert.equal(await owner.getAttribute('#vault-nadia', 'aria-pressed'), 'false');
  await owner.click('#vault-nadia');
  await owner.waitForSelector('#vault-nadia[aria-pressed="true"]');
  assert.equal(staff.find((r) => r.person === 'nadia').vault, true);
  assert.deepEqual(fnCalls.at(-2), { by: 'owner@astrateg.test', action: 'upsert', email: 'nadia@astrateg.test', vault: true });
});

let eliLink;
await step('owner adds Eli\'s email and creates an invite link: copy and WhatsApp', async () => {
  await owner.fill('#email-eli', 'not-an-email');
  await owner.click('#save-eli');
  await toastHas(owner, 'כתובת המייל לא תקינה');
  assert.equal(await owner.getAttribute('#email-eli', 'aria-invalid'), 'true');
  await owner.fill('#email-eli', ' Eli@Astrateg.TEST ');
  await owner.click('#save-eli');
  await owner.waitForSelector('#mklink-eli');
  assert.deepEqual(staff.at(-1).email, 'eli@astrateg.test');
  assert.deepEqual([staff.at(-1).person, staff.at(-1).vault], ['eli', false]);
  assert.match(await text(owner, '#row-eli'), /eli@astrateg\.test/);

  await owner.click('#mklink-eli');
  await owner.waitForSelector('#link-eli');
  const call = fnCalls.filter((c) => c.action === 'link').at(-1);
  assert.deepEqual(call, { by: 'owner@astrateg.test', action: 'link', email: 'eli@astrateg.test', redirectTo: `${BASE}clients.html` });
  eliLink = await owner.inputValue('#link-eli');
  assert.match(eliLink, new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}clients\\.html#type=invite&token_hash=[0-9a-f]{32}$`));
  assert.match(await text(owner, '#row-eli .tm-link'), /קישור הזמנה לאלי[\s\S]*אישי[\s\S]*תקף לשעה[\s\S]*קישור חדש בכל רגע/);
  assert.match(await text(owner, '#row-eli'), /טרם נכנס\/ה/, 'the invite made a login');
  assert.match(await text(owner, '#row-eli'), /קישור אחרון: היום \d\d:\d\d, הבעלים/);
  assert.equal(await text(owner, '#mklink-eli'), 'קישור חדש');

  const wa = await owner.getAttribute('#wa-eli', 'href');
  assert.ok(wa.startsWith('https://wa.me/?text='), `no phone number in ${wa.slice(0, 30)}`);
  const msg = decodeURIComponent(wa.slice('https://wa.me/?text='.length));
  assert.match(msg, /^היי אלי,/);
  assert.ok(msg.endsWith(eliLink), 'the message ends with the link');
  assert.equal(await owner.getAttribute('#wa-eli', 'target'), '_blank');

  await owner.click('#copy-eli');
  await toastHas(owner, 'הקישור הועתק');
  assert.equal(await owner.evaluate(() => navigator.clipboard.readText()), eliLink);
  assert.equal([...tokens.values()].at(-1).used, false, 'making the link spends nothing');
});

await step('a second person with a login gets a password link; the owner can remove a row', async () => {
  await owner.click('#mklink-irit');
  await owner.waitForSelector('#link-irit');
  assert.match(await text(owner, '#row-irit .tm-link'), /קישור לבחירת סיסמה לעירית/);
  assert.match(await owner.inputValue('#link-irit'), /#type=recovery&token_hash=/);
  assert.equal(await owner.locator('#link-eli').count(), 1, 'the earlier link stays on the page');

  await owner.click('#remove-nadia');
  await owner.waitForSelector('#email-nadia');
  assert.equal(staff.some((r) => r.email === 'nadia@astrateg.test'), false);
});

await step('owner on a phone: no sideways scrolling', async () => {
  const phone = await newPage({ width: 390, height: 844 });
  await signIn(phone, 'team.html', 'owner@astrateg.test');
  await phone.waitForSelector('#team-list .tm-row');
  await phone.click('#mklink-lior');
  await phone.waitForSelector('#link-lior');
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await shot(phone, 'team-02-phone');
});

await step('clients.html shows the team link to the owner', async () => {
  await owner.goto(`${BASE}clients.html`);
  await owner.waitForSelector('#app:not([hidden])');
  await owner.waitForFunction(() => !document.getElementById('nav-team').hidden);
  assert.equal(await owner.getAttribute('#nav-team', 'href'), 'team.html');
});

// ── Irit ──────────────────────────────────
await step('Irit manages the team without the owner\'s powers', async () => {
  const irit = await newPage();
  await signIn(irit, 'team.html', 'irit@astrateg.test');
  await irit.waitForSelector('#team-list .tm-row');
  assert.equal(await irit.locator('.tm-vault-btn').count(), 0, 'no vault switch');
  assert.ok(await irit.locator('.tm-vault').count() > 0, 'the vault shows as a badge');
  assert.equal(await irit.locator('.tm-remove').count(), 0, 'no removing');
  assert.equal(await irit.locator('#mklink-owner').count(), 0, 'no link for the owner');
  assert.match(await text(irit, '#row-irit'), /זה אני/);
  await irit.click('#mklink-ofir');
  await irit.waitForSelector('#link-ofir');
  assert.match(await irit.inputValue('#link-ofir'), /#type=recovery&token_hash=/);
  assert.equal(fnCalls.at(-1).by, 'irit@astrateg.test');
  await irit.fill('#email-nadia', 'nadia2@astrateg.test');
  await irit.click('#save-nadia');
  await irit.waitForSelector('#mklink-nadia');
  const nadia = staff.find((r) => r.person === 'nadia');
  assert.deepEqual([nadia.email, nadia.vault], ['nadia2@astrateg.test', false]);
  await irit.goto(`${BASE}clients.html`);
  await irit.waitForSelector('#app:not([hidden])');
  await irit.waitForFunction(() => !document.getElementById('nav-team').hidden);
});

// ── An editor ─────────────────────────────
await step('an editor gets a friendly "no access", and no team link', async () => {
  const yariv = await newPage();
  const before = fnCalls.length;
  await signIn(yariv, 'team.html', 'yariv@astrateg.test');
  await yariv.waitForSelector('#no-access:not([hidden])');
  assert.match(await text(yariv, '#no-access'), /אין לך גישה לעמוד הזה/);
  assert.equal(await yariv.getAttribute('#no-access a', 'href'), 'clients.html');
  assert.equal(await yariv.locator('#team-page').isHidden(), true);
  assert.equal(fnCalls.length, before, 'the page does not ask the function');
  assert.deepEqual(staffAdmin(users.get('yariv@astrateg.test'), { action: 'list' }), [403, { error: 'not_allowed' }]);
  await yariv.goto(`${BASE}clients.html`);
  await yariv.waitForSelector('#app:not([hidden])');
  await yariv.waitForTimeout(200);
  assert.equal(await yariv.locator('#nav-team').isHidden(), true);
});

// ── Landing from a link ───────────────────
await step('a recovery URL asks for a password, then continues into the app', async () => {
  const r = await newPage();
  const ofir = users.get('ofir@astrateg.test');
  ofir.email_confirmed_at = new Date().toISOString();
  await r.goto(`${BASE}clients.html#access_token=${jwtFor(ofir)}&refresh_token=r&expires_in=3600&token_type=bearer&type=recovery`);
  await r.waitForSelector('#sp-form');
  assert.equal(await text(r, '#sp-h'), 'בחירת סיסמה חדשה');
  assert.equal(await r.evaluate(() => location.hash), '', 'the token is removed from the address bar');
  assert.equal(await r.locator('#login-form').isHidden(), true);
  assert.equal(await r.locator('#app').isHidden(), true);
  await r.fill('#sp-new', 'short');
  await r.fill('#sp-again', 'short');
  await r.click('#sp-submit');
  assert.match(await text(r, '#sp-err'), /לפחות 8 תווים/);
  await r.fill('#sp-new', 'new-password-1');
  await r.fill('#sp-again', 'new-password-2');
  await r.click('#sp-submit');
  assert.match(await text(r, '#sp-err'), /אינן זהות/);
  assert.equal(passwordUpdates.length, 0);
  await r.fill('#sp-again', 'new-password-1');
  await r.click('#sp-submit');
  await r.waitForSelector('#app:not([hidden])');
  assert.deepEqual(passwordUpdates.at(-1), { email: 'ofir@astrateg.test', password: 'new-password-1' });
  await toastHas(r, 'הסיסמה נשמרה');
  assert.equal(await r.locator('#sp-form').count(), 0);
  await shot(r, 'team-03-after-password');
});

await step('the invite link from WhatsApp: spent only when the password is saved', async () => {
  const e = await newPage({ width: 390, height: 844 });
  await e.goto(eliLink);
  await e.waitForSelector('#sp-form');
  assert.match(await text(e, '#sp-h'), /ברוכים הבאים/);
  assert.equal(await e.evaluate(() => location.hash), '');
  await e.waitForTimeout(200);
  assert.equal(verifyCalls.length, 0, 'opening the link does not use it up');
  await shot(e, 'team-04-choose-password');
  await e.fill('#sp-new', 'eli-password-1');
  await e.fill('#sp-again', 'eli-password-1');
  await e.click('#sp-submit');
  await e.waitForSelector('#app:not([hidden])');
  assert.deepEqual(verifyCalls.at(-1), { ...verifyCalls.at(-1), token_hash: new URL(eliLink).hash.split('token_hash=')[1], type: 'invite' });
  assert.deepEqual(passwordUpdates.at(-1), { email: 'eli@astrateg.test', password: 'eli-password-1' });
  assert.equal(await text(e, '#session-who'), 'eli@astrateg.test');
  // The session stays on the device: a reload goes straight in.
  await e.reload();
  await e.waitForSelector('#app:not([hidden])');
  assert.equal(await e.locator('#login-block').isHidden(), true);
});

await step('a used or expired link explains what to do', async () => {
  const again = await newPage();
  await again.goto(eliLink);
  await again.waitForSelector('#sp-form');
  await again.fill('#sp-new', 'eli-password-2');
  await again.fill('#sp-again', 'eli-password-2');
  await again.click('#sp-submit');
  await again.waitForSelector('#login-form:not([hidden])');
  assert.match(await text(again, '#lg-err'), /הקישור כבר לא תקף[\s\S]*עירית או מליאור/);
  assert.equal(passwordUpdates.at(-1).password, 'eli-password-1');

  const x = await newPage();
  await x.goto(`${BASE}clients.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
  await x.waitForSelector('#lg-err:not([hidden])');
  assert.match(await text(x, '#lg-err'), /הקישור כבר לא תקף/);
  assert.equal(await x.evaluate(() => location.hash), '');
});

await browser.close();
assert.deepEqual(errors, []);
console.log(`team-e2e: ${passed} passed`);
