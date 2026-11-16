// Graphics tasks that close by themselves (the owner, 17.11.2026; docs/ops.md, section 138), in the
// browser, against an in-memory fake of Supabase that answers as the migration does
// (tests/sql/gfx-auto.test.mjs holds the real rules). Invented people and clients only.
//   1  Chromium 1366, Irit: "שליחת נודניק" to Ilai on a client shows "גרפיקות (לא חובה)": the three
//      kinds as chips, "כמה גרפיקות" typed key by key with Backspace (letters never stay), "לתקן"
//      hides the number; a chip pressed again is unchosen; to Nadia, or without a client, nothing
//      shows; sent: the database gets the kind and the number in the brief. Her closed list: the
//      system's line and "לפתוח מחדש".
//   2  WebKit as an iPhone 13, the same form, typing the number key by key.
//   3  WebKit as an iPhone 13, Ilai: his open task "להכין · 4 מתוך 10", "נסגרו אוטומטית (1)" with the
//      line, "לפתוח מחדש" brings it back to his open tasks; no sideways scroll, targets 44px.
//   4  Chromium 1366, Ilai: the same card.
// Run: node <a static server> . 8491 &  then  BASE_URL=http://localhost:8491/ node tests/gfx-auto-e2e.mjs
// SHOTS=1 SHOTS_OUT=<dir> also saves the screenshots (gfx-*.png).
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { withClientColumns } from './fake-clients.mjs';
import { watchCsp } from './csp-watch.mjs';
import { GIVERS } from '../app/staff-tasks-logic.js';

const BASE = process.env.BASE_URL || 'http://localhost:8491/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
if (SHOTS) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Tuesday 17.11.2026, 10:00 in Jerusalem: an office day, inside the reminders' window.
const NOW = new Date('2026-11-17T08:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();
const minutesAgo = (n) => new Date(NOW - n * 6e4).toISOString();

const PEOPLE = { owner: null, irit: 'irit', ilai: 'ilai', nadia: 'nadia', nirel: 'nirel' };
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

const client = (name, business) => ({
  id: randomUUID(), name, business, address: null, phone: null, package_name: 'סושיאל', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  editor_name: null, editor: null, deal_at: minutesAgo(60 * 24 * 200), char_at: null, shoot_at: null, contract_end: '2027-12-31', status: 'active', notes: null, quote_id: null,
  created_at: minutesAgo(60 * 24 * 200), created_by_email: null, links: {}, deliverables: {}, rounds: [], verified_at: minutesAgo(60 * 24 * 199), verified_by: 'irit@astrateg.test',
  closed_reason: null, archived_at: null, archived_by: null, protocol_version: 7,
});
const C1 = client('דנה לוי', 'מאפיית הדגמה');
const C2 = client('יוסי כהן', 'מוסך הדגמה');
const tables = { clients: [C1, C2], protocol_checks: [], client_tasks: [], office_reviews: [], client_status_notes: [], protocol_log: [] };
const task = (o) => ({
  id: randomUUID(), created_by: 'irit', created_by_email: 'irit@astrateg.test', status: 'open', done_at: null, done_by_email: null, cancelled_at: null, cancelled_by_email: null,
  brief: null, claimed_at: null, gfx_kind: null, gfx_count: null, gfx_done: null, auto_note: null, ...o,
});
const tasks = [
  task({ created_at: minutesAgo(60 * 24 * 2), assignee: 'ilai', body: 'מאפיית הדגמה- להכין גרפיקות לחנוכה', client_id: C1.id, client_name: 'מאפיית הדגמה · דנה לוי', gfx_kind: 'make', gfx_count: 10, gfx_done: 4 }),
  task({ created_at: minutesAgo(60 * 24 * 6), assignee: 'ilai', body: 'מוסך הדגמה- להכין עוד גרפיקות', client_id: C2.id, client_name: 'מוסך הדגמה · יוסי כהן',
    status: 'done', done_at: minutesAgo(60 * 3), done_by_email: 'system:auto', auto_note: 'נסגר אוטומטית: עלו 9 גרפיקות בדרייב ב־15.11' }),
];
const calls = [];
const visible = (t, me) => { const p = personOf(me); return !!p && (t.assignee === p || t.created_by === p || p === 'owner'); };
function rpc(name, body, me, json) {
  if (name === 'is_staff') return json(200, !!me && staff.some((s) => s.email === me.email));
  if (name === 'is_office') return json(200, isOffice(me));
  if (name.startsWith('staff_task_')) {
    calls.push({ name, body, by: me?.email });
    const p = personOf(me);
    if (!p) return json(403, { code: '42501', message: 'not allowed' });
    if (name === 'staff_task_create' || name === 'staff_task_create_brief') {
      if (!GIVERS.includes(p)) return json(403, { code: '42501', message: 'not allowed' });
      const b = body.p_brief || {};
      if ((b.gfx_kind || b.gfx_count) && (!['ilai', 'nirel'].includes(body.p_assignee) || !body.p_client)) return json(400, { code: '22023', message: 'a graphics kind needs a graphics person and a client' });
      const c = tables.clients.find((x) => x.id === body.p_client) || null;
      const t = task({ created_at: serverNow(), created_by: p, created_by_email: me.email, assignee: body.p_assignee, body: body.p_body, client_id: c?.id || null, client_name: c ? `${c.business} · ${c.name}` : null,
        gfx_kind: b.gfx_kind || (b.gfx_count ? 'make' : null), gfx_count: b.gfx_kind === 'fix' ? null : b.gfx_count || null });
      tasks.push(t);
      return json(200, t.id);
    }
    const t = tasks.find((x) => x.id === body.p_id);
    if (!t || !visible(t, me)) return json(404, { code: 'P0002', message: 'task not found' });
    if (name === 'staff_task_reopen') {
      const auto = t.status === 'done' && t.done_by_email === 'system:auto';
      if (!(p === 'owner' || t.created_by === p || (auto && t.assignee === p))) return json(403, { code: '42501', message: 'not allowed' });
      if (t.status !== 'done') return json(400, { code: '22023', message: 'this task is not done' });
      Object.assign(t, { status: 'open', done_at: null, done_by_email: null, auto_note: null, auto_reopened_at: serverNow() });
      return json(200, t);
    }
    if (name === 'staff_task_done') {
      if (t.status !== 'open') return json(400, { code: '22023', message: 'this task is not open' });
      Object.assign(t, { status: 'done', done_at: serverNow(), done_by_email: me.email });
      return json(200, t);
    }
    return json(200, t);
  }
  return json(200, []);
}
const filtersOf = (url) => [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k));
const matcher = (filters) => (row) => filters.every(([k, v]) => {
  if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
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
  if (p.startsWith('/rest/v1/rpc/')) return rpc(p.slice('/rest/v1/rpc/'.length), body || {}, me, json);
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  if (m[1] === 'staff_tasks') return answer(req, json)(tasks.filter((t) => visible(t, me)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    return answer(req, json)(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff);
  }
  if (m[1] === 'clients') return answer(req, json)(isOffice(me) ? tables.clients.filter(matcher(filtersOf(url))) : []);
  if (['reminder_log', 'deal_requests', 'quotes'].includes(m[1])) return json(200, []);
  return answer(req, json)((tables[m[1]] || []).filter(matcher(filtersOf(url).filter(([k]) => k === 'id' || k === 'client_id'))));
}

const errors = [];
async function newPage(browser, opts) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', ...opts });
  await ctx.clock.install({ time: new Date(serverNow()) });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => tables.clients, staff: () => staff }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page);
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return { page, ctx };
}
async function signIn(page, who) {
  await page.goto(`${BASE}clients.html#mine`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.locator('#app:not([hidden])').waitFor();
  await page.locator('#staff-tasks-card:not([hidden])').waitFor();
}
const shot = async (page, name, sel = null) => {
  if (!SHOTS) return;
  await page.locator('#toast').evaluate((el) => { el.style.visibility = 'hidden'; }).catch(() => {});
  if (sel) await page.locator(sel).screenshot({ path: `${OUT}${name}.png` });
  else await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
  await page.locator('#toast').evaluate((el) => { el.style.visibility = ''; }).catch(() => {});
};
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.offsetParent && el.getBoundingClientRect().height < 43.5)
  .map((el) => `${el.textContent.trim().slice(0, 20)}:${Math.round(el.getBoundingClientRect().height)}`), sel);
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last calls: ${JSON.stringify(calls.slice(-3)).slice(0, 900)}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

// The form on one page: Ilai on a client, the chips, the number typed key by key.
async function formFlow(page, tag) {
  await page.click('#st-new');
  await page.locator('#st-form').waitFor();
  assert.equal(await page.locator('#st-gfx').isHidden(), true, 'nobody chosen: no graphics choice');
  await page.selectOption('#st-assignee', 'ilai');
  assert.equal(await page.locator('#st-gfx').isHidden(), true, 'no client yet');
  await page.selectOption('#st-client', C1.id);
  await page.locator('#st-gfx:not([hidden])').waitFor();
  assert.equal(await page.locator('#st-gfx legend').innerText(), 'גרפיקות (לא חובה)');
  assert.deepEqual(await page.locator('#st-gfx .st-chip span').allInnerTexts(), ['להכין', 'לתקן', 'לתזמן']);
  // To Nadia: gone; back to Ilai: there.
  await page.selectOption('#st-assignee', 'nadia');
  assert.equal(await page.locator('#st-gfx').isHidden(), true, 'not a graphics person');
  await page.selectOption('#st-assignee', 'ilai');
  assert.equal(await page.locator('#st-gfx').isHidden(), false);
  // "לתקן" hides the number; pressed again it is unchosen.
  await page.locator('.st-chip', { hasText: 'לתקן' }).click();
  assert.equal(await page.locator('.st-gfx-count').isHidden(), true);
  assert.match(await page.locator('.st-gfx-hint').innerText(), /ה־AI יבדוק/);
  await page.locator('.st-chip', { hasText: 'לתקן' }).click();
  assert.equal(await page.locator('input[name="gfxKind"]:checked').count(), 0, 'a chip pressed again is unchosen');
  assert.equal(await page.locator('.st-gfx-count').isHidden(), false);
  await page.locator('.st-chip', { hasText: 'להכין' }).click();
  // The number, key by key: a letter never stays, Backspace deletes, typed again.
  const n = page.locator('#st-gfxCount');
  await n.click();
  await n.pressSequentially('1', { delay: 40 });
  await n.pressSequentially('א', { delay: 40 });
  await n.pressSequentially('2', { delay: 40 });
  assert.equal(await n.inputValue(), '12');
  await n.press('Backspace');
  assert.equal(await n.inputValue(), '1');
  await n.pressSequentially('0', { delay: 40 });
  assert.equal(await n.inputValue(), '10');
  await n.pressSequentially('99', { delay: 40 });
  assert.equal(await n.inputValue(), '109', 'maxlength 3');
  for (let i = 0; i < 3; i += 1) await n.press('Backspace');
  assert.equal(await n.inputValue(), '');
  await n.pressSequentially('0', { delay: 40 });
  await page.fill('#st-body', `מאפיית הדגמה- להכין גרפיקות (${tag})`);
  await page.click('#st-send');
  assert.equal(await page.locator('#st-gfxCount-err').innerText(), 'מספר בין 1 ל־200.', '0 is refused next to the field');
  await shot(page, `gfx-form-error-${tag}`, '#st-form');
  await n.press('Backspace');
  await n.pressSequentially('10', { delay: 40 });
  assert.equal(await page.locator('#st-gfxCount-err').isHidden(), true, 'the error goes while it is corrected');
  await shot(page, `gfx-form-${tag}`, '#st-form');
  assert.deepEqual(await smallTargets(page, '#st-gfx .st-chip span, #st-gfxCount, #st-send'), []);
  assert.equal(await noSideScroll(page), true);
  await page.click('#st-send');
  await page.locator('#st-form').waitFor({ state: 'detached' });
  const sent = calls.filter((c) => c.name === 'staff_task_create_brief').at(-1);
  assert.deepEqual([sent.body.p_assignee, sent.body.p_client, sent.body.p_brief], ['ilai', C1.id, { gfx_kind: 'make', gfx_count: 10 }]);
}

let exitCode = 0;
const chrome = await chromium.launch();
const wk = await webkit.launch();
try {
  await step('1 Chromium 1366, Irit: the graphics choice in "שליחת נודניק", the number key by key, sent in the brief', async () => {
    const { page } = await newPage(chrome, { viewport: { width: 1366, height: 900 } });
    await signIn(page, 'irit');
    await formFlow(page, '1366');
    // Without a client: nothing about graphics is sent.
    await page.click('#st-new');
    await page.selectOption('#st-assignee', 'ilai');
    await page.fill('#st-body', 'להתקשר לספק');
    assert.equal(await page.locator('#st-gfx').isHidden(), true);
    await page.click('#st-send');
    await page.locator('#st-form').waitFor({ state: 'detached' });
    assert.equal(calls.at(-1).name, 'staff_task_create');
    // Her closed list: the system's line and "לפתוח מחדש".
    if (await page.getAttribute('#st-closed-toggle', 'aria-expanded') !== 'true') await page.locator('#st-closed-toggle').click();
    const item = page.locator('.st-item', { hasText: 'מוסך הדגמה- להכין עוד גרפיקות' });
    assert.equal(await item.locator('.st-state').innerText(), 'נסגר אוטומטית');
    assert.match(await item.locator('.st-auto').innerText(), /נסגר אוטומטית: עלו 9 גרפיקות בדרייב ב־15\.11/);
    assert.equal(await item.locator('.st-reopen').count(), 1);
    if (await page.getAttribute('#st-open-toggle', 'aria-expanded') !== 'true') await page.locator('#st-open-toggle').click();
    const open = page.locator('.st-item', { hasText: 'להכין גרפיקות לחנוכה' });
    assert.match(await open.locator('.st-gfx').innerText(), /להכין · 4 מתוך 10/);
    await shot(page, 'gfx-irit-lists-1366', '#staff-tasks-card');
  });

  await step('2 WebKit iPhone 13, Irit: the same form, the number typed key by key', async () => {
    const { page } = await newPage(wk, devices['iPhone 13']);
    await signIn(page, 'irit');
    await formFlow(page, '390');
  });

  for (const [label, browser, opts, tag] of [['3 WebKit iPhone 13', wk, devices['iPhone 13'], '390'], ['4 Chromium 1366', chrome, { viewport: { width: 1366, height: 900 } }, '1366']]) {
    await step(`${label}, Ilai: "4 מתוך 10", "נסגרו אוטומטית (1)" and "לפתוח מחדש"`, async () => {
      const auto = tasks.find((t) => t.body === 'מוסך הדגמה- להכין עוד גרפיקות');
      Object.assign(auto, { status: 'done', done_at: minutesAgo(60 * 3), done_by_email: 'system:auto', auto_note: 'נסגר אוטומטית: עלו 9 גרפיקות בדרייב ב־15.11' });
      const { page } = await newPage(browser, opts);
      await signIn(page, 'ilai');
      const card = page.locator('#staff-tasks-card');
      const typed = card.locator('.st-item.is-mine', { hasText: 'להכין גרפיקות לחנוכה' });
      assert.match(await typed.locator('.st-gfx').innerText(), /להכין · 4 מתוך 10/);
      assert.equal(await card.locator('#st-auto-h').innerText(), 'נסגרו אוטומטית (1)');
      const a = card.locator('.st-item.is-auto');
      assert.equal(await a.locator('.st-auto').innerText(), 'נסגר אוטומטית: עלו 9 גרפיקות בדרייב ב־15.11');
      assert.deepEqual(await smallTargets(page, '#staff-tasks-card .btn'), []);
      assert.equal(await noSideScroll(page), true);
      await shot(page, `gfx-ilai-${tag}`, '#staff-tasks-card');
      await a.locator('.st-reopen').click();
      await card.locator('.st-item.is-auto').waitFor({ state: 'detached' });
      assert.equal(calls.at(-1).name, 'staff_task_reopen');
      assert.equal(await card.locator('.st-item.is-mine', { hasText: 'מוסך הדגמה- להכין עוד גרפיקות' }).count(), 1, 'back with his open tasks');
      await shot(page, `gfx-ilai-reopened-${tag}`, '#staff-tasks-card');
    });
  }
  assert.deepEqual(errors, []);
  console.log(`\n${passed} passed`);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await chrome.close();
  await wk.close();
}
process.exit(exitCode);
