// End-to-end check of "קוד הכספת" (the owner's decision of 6.10.2026) against an
// in-memory fake of Supabase that answers as the migration does
// (supabase/migrations/20261008100100_vault_code.sql), the clock fixed on Sunday
// 11.10.2026 at 10:00 in Israel:
//   - before a code exists the vault works exactly as before, and the owner's card on
//     the team page says so;
//   - the owner sets a code (a weak one and a mistyped one are refused in Hebrew); the
//     card shows only that a code exists and when it was changed, never the code;
//   - Ilai, on a 360px phone, presses "הצגת סיסמה": a small dialog with a masked numeric
//     6-digit field; a wrong code counts down; the right one shows the password,
//     "הכספת פתוחה עוד 10:00" and "נעילה עכשיו"; ten minutes later the code is asked again;
//   - Nirel has the vault flag and was not given the code: five wrong codes lock her for
//     15 minutes, nothing is revealed, and she still adds a login without any code;
//   - the owner sees who typed a wrong code and who was locked; changing the code ends
//     everyone's unlocks; Irit (who manages the team, not the owner) has no such card.
// Run: npx http-server -p 8107 -s -c-1 . &  then  BASE_URL=http://localhost:8107/ node tests/vault-code-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { weakCode, isCode } from '../app/vault-code.js';
import { summarize, roleOf } from '../supabase/functions/staff-admin/rules.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
let NOW = new Date('2026-10-11T10:00:00+03:00'); // Sunday
const serverNow = () => new Date(NOW);
const iso = () => serverNow().toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;

// ── People: the vault flag is the owner's, Lior's, Ilai's and Nirel's ──
const people = { owner: null, irit: 'irit', lior: 'lior', ilai: 'ilai', nirel: 'nirel' };
const VAULT = new Set(['owner', 'lior', 'ilai', 'nirel']);
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-09-01T09:00:00+03:00', last_sign_in_at: null }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: VAULT.has(k), phone: null, created_at: '2026-09-01T09:00:00+03:00' }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const rowOf = (u) => staff.find((r) => r.email === u?.email) || null;
const isOwner = (u) => rowOf(u)?.person === null;
const hasVault = (u) => !!rowOf(u)?.vault;

// ── A client of Natali's that Nirel edits, with two logins in the vault ──
const D = {
  id: 'dddddddd-0000-4000-8000-000000000001', name: 'דנה לוי', business: 'קפה דנה', address: 'הרצל 1, חיפה', phone: '050-1112222',
  package_name: 'Social · נטלי', shoot_type: 'natali', characterizer: 'ofir', has_logo: true, editor_name: null, editor: 'nirel',
  deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-09-03T10:00:00+03:00', shoot_at: '2026-10-20T10:00:00+03:00', contract_end: '2027-09-01',
  status: 'active', notes: null, quote_id: null, created_at: '2026-09-01T09:00:00+03:00', created_by_email: 'irit@astrateg.test',
  links: {}, deliverables: { videos: 25 }, rounds: [], verified_at: null, verified_by: null, closed_reason: null, protocol_version: 6,
};
const SECRET = 'Insta-סוד 9!';
const access = (network, username, secret) => ({ id: randomUUID(), client_id: D.id, network, label: null, username, has_secret: secret ? randomUUID() : null, status: 'ok', note: null, updated_by: 'lior@astrateg.test', updated_at: '2026-10-01T09:00:00+03:00', created_at: `2026-10-01T09:0${network === 'instagram' ? 0 : 1}:00+03:00` });
const db = {
  staff, clients: [D],
  protocol_checks: ['p01.prepared', 'p01.sent', 'p01.signed', 'p02.opened'].map((k) => ({ client_id: D.id, item_key: k, state: 'done', note: 'ייבוא', by_email: 'irit@astrateg.test', at: '2026-09-01T09:10:00+03:00' })),
  client_tasks: [], protocol_log: [], client_access: [access('instagram', 'dana_cafe', true), access('tiktok', 'dana.tt', false)], client_access_log: [],
  client_status_notes: [], office_reviews: [], quotes: [], client_messages: [], message_templates: [], client_questions: [], client_date_changes: [],
  reminder_log: [], push_subscriptions: [], characterizations: [], content_briefs: [], vault_code_log: [],
};
const secrets = new Map([[db.client_access[0].has_secret, SECRET]]);

// ── "קוד הכספת", as the migration defines it ──
const vault = { code: null, unlocks: new Map() }; // code: { salt, hash, set_at, set_by }
const hashOf = (code, salt) => createHash('sha256').update(`${salt}:${code}`).digest('hex');
const mine = (email) => { if (!vault.unlocks.has(email)) vault.unlocks.set(email, { until: null, failed: 0, locked: null }); return vault.unlocks.get(email); };
const live = (v) => !!v && new Date(v) > serverNow();
const vaultOpen = (email) => !vault.code || live(vault.unlocks.get(email)?.until);
const log = (email, event) => db.vault_code_log.push({ id: db.vault_code_log.length + 1, email, event, at: iso() });
function codeStatus(me) {
  const u = vault.unlocks.get(me.email);
  return { set: !!vault.code, changedAt: vault.code?.set_at ?? null, owner: isOwner(me), openUntil: live(u?.until) ? u.until : null, lockedUntil: live(u?.locked) ? u.locked : null, left: live(u?.locked) ? 0 : 5 - (u?.failed || 0) };
}
function codeSet(me, code) {
  if (!isOwner(me)) return [403, { code: '42501', message: 'not allowed: owner only' }];
  if (!isCode(code)) return [400, { code: '22023', message: 'the code is exactly 6 digits' }];
  if (weakCode(code)) return [400, { code: '22023', message: 'weak code' }];
  const had = !!vault.code;
  const salt = randomBytes(8).toString('hex');
  vault.code = { salt, hash: hashOf(code, salt), set_at: iso(), set_by: me.email };
  vault.unlocks.clear();
  log(me.email, had ? 'changed' : 'set');
  return [200, { set: true, changedAt: vault.code.set_at }];
}
function codeUnlock(me, code) {
  if (!hasVault(me)) return [403, { code: '42501', message: 'not allowed' }];
  if (!vault.code) return [200, { state: 'none' }];
  const u = mine(me.email);
  if (live(u.locked)) return [200, { state: 'locked', until: u.locked }];
  if (u.locked) { u.locked = null; u.failed = 0; }
  if (isCode(code) && hashOf(code, vault.code.salt) === vault.code.hash) {
    Object.assign(u, { until: new Date(serverNow().getTime() + 10 * 60e3).toISOString(), failed: 0, locked: null });
    log(me.email, 'unlocked');
    return [200, { state: 'open', until: u.until }];
  }
  log(me.email, 'wrong');
  if (u.failed + 1 >= 5) {
    Object.assign(u, { failed: 0, until: null, locked: new Date(serverNow().getTime() + 15 * 60e3).toISOString() });
    log(me.email, 'lockout');
    return [200, { state: 'locked', until: u.locked }];
  }
  u.failed += 1;
  return [200, { state: 'wrong', left: 5 - u.failed }];
}

function matches(r, k, v) {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v.startsWith('gte.')) return r[k] !== null && r[k] !== undefined && String(r[k]) >= v.slice(4);
  if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')); return set.includes(String(r[k])); }
  return true;
}
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns', 'or'].includes(k)) continue;
    out = out.filter((r) => matches(r, k, v));
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split(',')[0].split('.');
    out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  return out.slice(0, Number(params.get('limit') || 1e9));
}

const rpcCalls = [];
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
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p === '/functions/v1/staff-admin') {
    const row = rowOf(me);
    const role = roleOf(row);
    if (!role) return json(403, { error: 'not_allowed' });
    if (body.action === 'list') return json(200, { caller: { email: me.email, person: row.person, owner: role === 'owner', vault: !!row.vault }, rows: staff.map((r) => summarize(r, users.get(r.email), null)) });
    return json(400, { error: 'unknown_action' });
  }
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(p)?.[1];
  if (rpc) {
    rpcCalls.push({ name: rpc, body, by: me?.email || null, url: req.url() });
    if (rpc === 'is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
    if (!me) return json(401, { code: '42501', message: 'permission denied' });
    if (rpc === 'vault_code_status') return json(200, codeStatus(me));
    if (rpc === 'vault_code_set') return json(...codeSet(me, body.p_code));
    if (rpc === 'vault_unlock') return json(...codeUnlock(me, body.p_code));
    if (rpc === 'vault_lock') { const u = vault.unlocks.get(me.email); if (live(u?.until)) { u.until = null; log(me.email, 'locked'); } return json(200, null); }
    if (rpc === 'can_use_vault' || rpc === 'can_use_client_vault') return json(200, hasVault(me));
    if (rpc === 'access_reveal') {
      if (!hasVault(me)) return json(400, { message: 'not allowed' });
      if (!vaultOpen(me.email)) return json(403, { code: '42501', message: 'vault locked: the code is needed' });
      const a = db.client_access.find((x) => x.id === body.p_id);
      db.client_access_log.push({ id: db.client_access_log.length + 1, access_id: a.id, client_id: a.client_id, network: a.network, action: 'reveal', by_email: me.email, at: iso() });
      return json(200, secrets.get(a.has_secret) ?? null);
    }
    if (rpc === 'access_save') {
      if (!hasVault(me)) return json(400, { message: 'not allowed' });
      const a = { id: randomUUID(), client_id: body.p_client, network: body.p_network, label: body.p_label || null, username: body.p_username || null, has_secret: null, status: body.p_status || 'ok', note: body.p_note || null, updated_by: me.email, updated_at: iso(), created_at: iso() };
      db.client_access.push(a);
      if (body.p_password) { a.has_secret = randomUUID(); secrets.set(a.has_secret, body.p_password); }
      db.client_access_log.push({ id: db.client_access_log.length + 1, access_id: a.id, client_id: a.client_id, network: a.network, action: 'create', by_email: me.email, at: iso() });
      return json(200, a.id);
    }
    return json(200, null);
  }
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${m?.[1]}'` });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' })) : json(200, rows));
  if (req.method() === 'GET') {
    let rows = applyFilters(db[table], url.searchParams);
    if ((table === 'client_access' || table === 'client_access_log') && !hasVault(me)) rows = [];
    if (table === 'vault_code_log' && !isOwner(me)) rows = [];
    return reply(rows);
  }
  return json(403, { code: '42501', message: `permission denied for table ${table}` });
}

// ── Browser ───────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const PHONE = { width: 360, height: 740 };
const contexts = [];
async function newContext(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, hasTouch: viewport.width < 500, isMobile: viewport.width < 500 });
  await ctx.clock.setFixedTime(NOW);
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  contexts.push(ctx);
  return ctx;
}
// The office's clock and every open page's move together.
async function setTime(t) { NOW = new Date(t); for (const c of contexts) await c.clock.setFixedTime(NOW); }
async function newPage(ctx) {
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
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` }); };
const shotOf = async (page, sel, name) => { if (OUT) await page.locator(sel).first().screenshot({ path: `${OUT}/${name}.png` }); };
const toastHas = (page, s) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), s);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const text = (page, sel) => page.locator(sel).first().innerText();
const revealBtn = (page) => page.locator('#access-list .access-row').first().getByRole('button', { name: 'הצגת סיסמה' });
const shownSecret = (page) => page.locator('#access-list .secret').first().innerText();
const reveals = () => db.client_access_log.filter((x) => x.action === 'reveal').length;
let passed = 0;
async function step(name, fn) { await fn(); passed += 1; console.log(`ok ${passed} - ${name}`); }
const CODE = '483920';

const ilaiCtx = await newContext(PHONE);
const ilai = await newPage(ilaiCtx);
const ownerCtx = await newContext();
const owner = await newPage(ownerCtx);

await step('before any code exists the vault works exactly as before: Ilai sees a password with no dialog', async () => {
  await signIn(ilai, `client.html?id=${D.id}`, 'ilai@astrateg.test');
  await ilai.waitForSelector('#access-list .access-row');
  await revealBtn(ilai).click();
  await ilai.waitForFunction((s) => document.querySelector('#access-list .secret')?.textContent.includes(s), SECRET);
  assert.equal(await ilai.locator('#dlg-vault-code').count(), 0);
  assert.ok(await ilai.locator('#vault-open').isHidden());
  assert.equal(reveals(), 1);
});

await step('the owner\'s card on the team page: no code yet, and it says the vault works as it did', async () => {
  await signIn(owner, 'team.html', 'owner@astrateg.test');
  await owner.waitForSelector('#vc-panel');
  assert.equal(await text(owner, '#vc-panel-h'), 'קוד הכספת');
  assert.equal(await text(owner, '#vc-state'), 'עוד לא הוגדר קוד. הכספת עובדת כמו עד היום: מי שמסומנת לו ״כספת״ רואה סיסמאות בלי קוד.');
  assert.equal(await text(owner, '#vc-save'), 'הגדרת קוד');
  for (const id of ['vc-code', 'vc-again']) {
    assert.deepEqual([await owner.getAttribute(`#${id}`, 'type'), await owner.getAttribute(`#${id}`, 'inputmode'), await owner.getAttribute(`#${id}`, 'autocomplete'), await owner.getAttribute(`#${id}`, 'maxlength')], ['password', 'numeric', 'off', '6'], id);
  }
  assert.equal(await owner.locator('#vc-log').count(), 0);
  assert.equal(await owner.locator('#vc-panel .btn-primary').count(), 0, 'not the screen\'s pink action');
});

await step('a weak code and a mistyped one are refused in Hebrew; then the code is set, and never shown', async () => {
  await owner.fill('#vc-code', '123456');
  await owner.fill('#vc-again', '123456');
  await owner.click('#vc-save');
  assert.match(await text(owner, '#vc-err'), /הקוד קל מדי לניחוש/);
  await owner.fill('#vc-code', '12ab34');
  assert.equal(await owner.inputValue('#vc-code'), '1234', 'digits only');
  await owner.fill('#vc-code', CODE);
  await owner.fill('#vc-again', '483921');
  await owner.click('#vc-save');
  assert.equal(await text(owner, '#vc-err'), 'שני הקודים לא זהים.');
  assert.equal(vault.code, null);
  await owner.fill('#vc-again', CODE);
  await owner.click('#vc-save');
  await toastHas(owner, 'קוד הכספת הוגדר');
  await owner.waitForFunction(() => document.getElementById('vc-state').textContent.startsWith('הוגדר קוד'));
  assert.equal(await text(owner, '#vc-state'), 'הוגדר קוד. שונה לאחרונה ב־11.10.2026.');
  assert.equal(await text(owner, '#vc-save'), 'החלפת הקוד');
  assert.deepEqual([await owner.inputValue('#vc-code'), await owner.inputValue('#vc-again')], ['', '']);
  assert.ok(!(await owner.evaluate(() => document.documentElement.outerHTML)).includes(CODE), 'the code is nowhere in the page');
  // Kept as a salted hash; no answer of the database holds the code.
  assert.ok(vault.code.hash && !JSON.stringify(vault.code).includes(CODE));
  assert.ok(!JSON.stringify(codeStatus(users.get('owner@astrateg.test'))).includes(CODE));
  for (const c of rpcCalls) assert.ok(!c.url.includes(CODE), 'the code is never in an address');
  await shotOf(owner, '#vc-panel', '01-team-code-desktop');
});

await step('Ilai on a 360px phone: "הצגת סיסמה" now asks for the code, in a small dialog with a masked numeric field', async () => {
  await ilai.reload();
  await ilai.waitForSelector('#access-list .access-row');
  // Statuses and the list are there without any code.
  assert.match((await ilai.locator('#access-list .access-row').first().innerText()).replace(/\s+/g, ' '), /^Instagram dana_cafe תקינה/);
  await revealBtn(ilai).click();
  await ilai.waitForSelector('#dlg-vault-code[open]');
  assert.equal(await text(ilai, '#vg-h'), 'קוד הכספת');
  for (const [attr, want] of [['type', 'password'], ['inputmode', 'numeric'], ['autocomplete', 'off'], ['maxlength', '6'], ['pattern', '[0-9]*']]) assert.equal(await ilai.getAttribute('#vg-code', attr), want, attr);
  assert.equal(await ilai.evaluate(() => document.activeElement.id), 'vg-code');
  assert.equal(await ilai.locator('label[for="vg-code"]').innerText(), 'קוד של 6 ספרות');
  for (const sel of ['#vg-submit', '#dlg-vault-code [data-close].btn', '#vg-code']) assert.ok((await ilai.locator(sel).boundingBox()).height >= 44, sel);
  assert.ok(await noHScroll(ilai));
  await shot(ilai, '02-code-dialog-360');
  // Too short: said at once, nothing is sent.
  const sent = rpcCalls.filter((c) => c.name === 'vault_unlock').length;
  await ilai.fill('#vg-code', '4839');
  await ilai.click('#vg-submit');
  assert.equal(await text(ilai, '#vg-err'), 'הקוד הוא בדיוק 6 ספרות.');
  assert.equal(rpcCalls.filter((c) => c.name === 'vault_unlock').length, sent);
});

await step('a wrong code counts down ("קוד שגוי. נותרו 4 ניסיונות"); the right one shows the password', async () => {
  await ilai.fill('#vg-code', '483921');
  await ilai.click('#vg-submit');
  await ilai.waitForFunction(() => /קוד שגוי/.test(document.getElementById('vg-err').textContent));
  assert.equal(await text(ilai, '#vg-err'), 'קוד שגוי. נותרו 4 ניסיונות.');
  assert.equal(await ilai.inputValue('#vg-code'), '', 'the field is cleared');
  await ilai.fill('#vg-code', '000001');
  await ilai.click('#vg-submit');
  await ilai.waitForFunction(() => /נותרו 3/.test(document.getElementById('vg-err').textContent));
  assert.equal(reveals(), 1, 'nothing was revealed');
  await shot(ilai, '03-code-wrong-360');
  await ilai.fill('#vg-code', CODE);
  await ilai.click('#vg-submit');
  await ilai.waitForFunction((s) => document.querySelector('#access-list .secret')?.textContent.includes(s), SECRET);
  assert.equal(await ilai.locator('#dlg-vault-code[open]').count(), 0);
  assert.equal(reveals(), 2);
  assert.equal(codeStatus(users.get('ilai@astrateg.test')).left, 5, 'the right code clears the count');
});

await step('"הכספת פתוחה עוד 10:00" and "נעילה עכשיו"; while it is open no code is asked', async () => {
  await ilai.waitForSelector('#vault-open:not([hidden])');
  assert.equal(await text(ilai, '#vault-open-text'), 'הכספת פתוחה עוד 10:00');
  assert.ok((await ilai.locator('#vault-lock').boundingBox()).height >= 44);
  assert.ok(await noHScroll(ilai));
  await shotOf(ilai, '#access', '04-vault-open-360');
  await setTime('2026-10-11T10:03:20+03:00');
  await revealBtn(ilai).click();
  await ilai.waitForFunction(() => document.getElementById('vault-open-text')?.textContent === 'הכספת פתוחה עוד 06:40');
  assert.equal(await ilai.locator('#dlg-vault-code[open]').count(), 0);
  assert.equal(reveals(), 3);
  // "נעילה עכשיו": the password leaves the screen, and the next press asks again.
  await ilai.click('#vault-lock');
  await ilai.waitForSelector('#vault-open', { state: 'hidden' });
  assert.equal((await shownSecret(ilai)).trim(), '');
  await revealBtn(ilai).click();
  await ilai.waitForSelector('#dlg-vault-code[open]');
  assert.equal(reveals(), 3);
  // Closing the dialog is quiet: no error, nothing shown.
  await ilai.click('#dlg-vault-code .close');
  assert.equal((await shownSecret(ilai)).trim(), '');
  assert.ok(!(await ilai.locator('#toast').innerText()).includes('לא ניתן'), 'no error is shown for a closed dialog');
});

await step('ten minutes after the code, it is asked again (the database decides, not the page)', async () => {
  await revealBtn(ilai).click();
  await ilai.waitForSelector('#dlg-vault-code[open]');
  await ilai.fill('#vg-code', CODE);
  await ilai.click('#vg-submit');
  await ilai.waitForFunction((s) => document.querySelector('#access-list .secret')?.textContent.includes(s), SECRET);
  assert.equal(reveals(), 4);
  await setTime('2026-10-11T10:13:21+03:00');
  // A page that still believes it is open is refused by the database.
  const refused = await ilai.evaluate(async (id) => {
    const { supabase } = await import('./app/supa.js');
    const { error } = await supabase.rpc('access_reveal', { p_id: id });
    return error?.message || null;
  }, db.client_access[0].id);
  assert.match(refused, /vault locked/);
  await ilai.reload();
  await ilai.waitForSelector('#access-list .access-row');
  assert.ok(await ilai.locator('#vault-open').isHidden());
  await revealBtn(ilai).click();
  await ilai.waitForSelector('#dlg-vault-code[open]');
  assert.equal(reveals(), 4);
  await ilai.click('#dlg-vault-code .close');
});

await step('Nirel has the vault flag and not the code: five wrong codes lock her for 15 minutes; nothing is revealed', async () => {
  const ctx = await newContext(PHONE);
  const page = await newPage(ctx);
  await signIn(page, `client.html?id=${D.id}`, 'nirel@astrateg.test');
  await page.waitForSelector('#access-list .access-row');
  await revealBtn(page).click();
  await page.waitForSelector('#dlg-vault-code[open]');
  for (let left = 4; left >= 1; left -= 1) {
    await page.fill('#vg-code', `11223${left}`);
    await page.click('#vg-submit');
    await page.waitForFunction((n) => document.getElementById('vg-err').textContent.includes(n), left === 1 ? 'נותר ניסיון אחד' : `נותרו ${left}`);
  }
  assert.equal(await text(page, '#vg-err'), 'קוד שגוי. נותר ניסיון אחד.');
  await page.fill('#vg-code', '556677');
  await page.click('#vg-submit');
  await page.waitForFunction(() => /ננעל/.test(document.getElementById('vg-err').textContent));
  assert.equal(await text(page, '#vg-err'), 'ננעל ל־15 דקות אחרי 5 קודים שגויים.');
  assert.equal(await page.locator('#vg-code').isDisabled(), true);
  assert.equal(await page.locator('#vg-submit').isDisabled(), true);
  assert.ok(await noHScroll(page));
  await shot(page, '05-code-locked-360');
  await page.click('#dlg-vault-code .close');
  // Still locked a few minutes later, also with the right code typed by hand.
  await setTime('2026-10-11T10:20:00+03:00');
  await revealBtn(page).click();
  await page.waitForSelector('#dlg-vault-code[open]');
  assert.equal(await text(page, '#vg-err'), 'ננעל. אפשר לנסות שוב בעוד 9 דקות.');
  assert.equal(codeUnlock(users.get('nirel@astrateg.test'), CODE)[1].state, 'locked');
  await page.click('#dlg-vault-code .close');
  assert.equal(db.client_access_log.filter((x) => x.action === 'reveal' && x.by_email === 'nirel@astrateg.test').length, 0);
  assert.equal((await shownSecret(page)).trim(), '');
  // Adding a login needs no code: only viewing passwords is gated.
  await page.click('#access-add');
  await page.selectOption('#acc-network', 'youtube');
  await page.fill('#acc-username', 'dana_yt');
  await page.fill('#acc-password', 'yt-new');
  await page.click('#acc-submit');
  await toastHas(page, 'הגישה נשמרה בכספת');
  assert.ok(db.client_access.some((a) => a.network === 'youtube' && a.updated_by === 'nirel@astrateg.test'));
  assert.equal(await page.locator('#dlg-vault-code[open]').count(), 0);
  await ctx.close();
});

await step('the owner sees who typed a wrong code and who was locked, and when; never what was typed', async () => {
  await owner.reload();
  await owner.waitForSelector('#vc-log');
  assert.match(await text(owner, '#vc-log summary'), /^קודים שגויים ונעילות \(8\)$/);
  await owner.click('#vc-log summary');
  const lines = (await owner.locator('#vc-log li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  assert.ok(lines.some((l) => /ניראל ננעל\/ה ל־15 דקות$/.test(l)), lines.join(' | '));
  assert.equal(lines.filter((l) => /ניראל הקליד\/ה קוד שגוי$/.test(l)).length, 5);
  assert.equal(lines.filter((l) => /עילאי הקליד\/ה קוד שגוי$/.test(l)).length, 2);
  assert.ok(lines.every((l) => /\d{1,2}:\d{2}/.test(l)), 'each with its time');
  const all = await owner.evaluate(() => document.getElementById('vc-panel').innerText);
  for (const typed of [CODE, '483921', '556677', '112234']) assert.ok(!all.includes(typed), typed);
  assert.deepEqual(Object.keys(db.vault_code_log[0]).sort(), ['at', 'email', 'event', 'id']);
  await shotOf(owner, '#vc-panel', '06-team-code-log-desktop');
});

await step('changing the code ends everyone\'s unlocks: the old code no longer opens, the new one does', async () => {
  // Lior opens the vault with the current code.
  const ctx = await newContext();
  const lior = await newPage(ctx);
  await signIn(lior, `client.html?id=${D.id}`, 'lior@astrateg.test');
  await lior.waitForSelector('#access-list .access-row');
  await revealBtn(lior).click();
  await lior.waitForSelector('#dlg-vault-code[open]');
  await lior.fill('#vg-code', CODE);
  await lior.click('#vg-submit');
  await lior.waitForSelector('#vault-open:not([hidden])');
  await shotOf(lior, '#access', '07-vault-open-desktop');
  // The owner changes it (someone left).
  await owner.fill('#vc-code', '772910');
  await owner.fill('#vc-again', '772910');
  await owner.click('#vc-save');
  await toastHas(owner, 'הקוד הוחלף. הכספת ננעלה לכולם');
  assert.equal(vault.unlocks.size, 0);
  assert.equal(db.vault_code_log.at(-1).event, 'changed');
  await lior.reload();
  await lior.waitForSelector('#access-list .access-row');
  assert.ok(await lior.locator('#vault-open').isHidden());
  await revealBtn(lior).click();
  await lior.waitForSelector('#dlg-vault-code[open]');
  await lior.fill('#vg-code', CODE);
  await lior.click('#vg-submit');
  await lior.waitForFunction(() => /קוד שגוי\. נותרו 4/.test(document.getElementById('vg-err').textContent));
  await lior.fill('#vg-code', '772910');
  await lior.click('#vg-submit');
  await lior.waitForFunction((s) => document.querySelector('#access-list .secret')?.textContent.includes(s), SECRET);
  await ctx.close();
});

await step('Irit manages the team but is not the owner: no "קוד הכספת" card, and she cannot set a code', async () => {
  const ctx = await newContext(PHONE);
  const page = await newPage(ctx);
  await signIn(page, 'team.html', 'irit@astrateg.test');
  await page.waitForSelector('#team-list > *');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#vc-panel:not([hidden])').count(), 0);
  assert.equal(codeSet(users.get('irit@astrateg.test'), '483920')[0], 403);
  assert.ok(await noHScroll(page));
  await ctx.close();
  // The owner's card on a phone.
  const octx = await newContext({ width: 375, height: 812 });
  const o = await newPage(octx);
  await signIn(o, 'team.html', 'owner@astrateg.test');
  await o.waitForSelector('#vc-panel');
  assert.ok(await noHScroll(o));
  for (const sel of ['#vc-save', '#vc-code']) assert.ok((await o.locator(sel).boundingBox()).height >= 44, sel);
  await shotOf(o, '#vc-panel', '08-team-code-375');
  await octx.close();
});

await ilaiCtx.close();
await ownerCtx.close();
await browser.close();
assert.deepEqual(errors, [], errors.join('\n'));
console.log(`vault code e2e: ${passed} steps passed`);
