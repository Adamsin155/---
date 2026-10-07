// End-to-end check of the landing of the old clients in the browser (the owner's
// decision of 7.10.2026; docs/ops.md, section 41), against an in-memory fake of
// Supabase that answers as the database does (the real rules: tests/sql/landing.test.mjs;
// the logic: tests/landing.test.mjs):
//   - Irit on a 390px phone: one line at the top of "המשימות שלי", the intake screen,
//     the proposal accepted in one tap, "ביטול", "הכול כבר בוצע", item by item, the
//     station corrected; no clock, no lateness, nothing scrolls sideways, 44px targets;
//     the line disappears when she is done and what she left open waits with no clock;
//   - a client signed today is not in landing and runs its clocks as always;
//   - an editor sees only her own clients and items; the database refuses the rest;
//   - the last person to finish activates the client: what stayed open is live with a
//     fresh deadline, not late;
//   - the owners' control on owner.html: who took in how many, and "מפעילים" for the
//     ready clients, the coming shoot days, one person and everyone; nobody else has it;
//   - the client card says "בקליטה"; before the migrations nothing breaks.
// Run: npx http-server -p 8501 -s -c-1 . &  then
//      BASE_URL=http://localhost:8501/ node tests/landing-e2e.mjs [outDir]
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { withClientColumns } from './fake-clients.mjs';
import { mayWrite } from '../scripts/protocol-writers.mjs';
import { importKeys, IMPORT_NOTE } from '../app/client-open.js';
import { clientState, clientLabel, freshDeadline } from '../app/protocol-logic.js';
import { intakeFor, intakeLeft, intakeItems, waitingPeople, proposalFor, landingBoard } from '../app/landing-logic.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Tuesday 20.10.2026, 11:00 in Jerusalem: an office day.
const NOW = new Date('2026-10-20T08:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();
const minutesAgo = (n) => new Date(NOW - n * 6e4).toISOString();

const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', anna: 'anna', stav: 'stav' };
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
const rowOf = (u) => staff.find((s) => s.email === u?.email) || null;
const personOf = (u) => rowOf(u)?.person ?? null;
const isOwner = (u) => !!rowOf(u) && rowOf(u).person === null;
const isOffice = (u) => !!rowOf(u) && OFFICE.has(rowOf(u).person);

const IMPORTED = '2026-10-06T10:00:00Z';
const client = (name, business, fields = {}) => ({
  id: randomUUID(), name, business, address: null, phone: '050-1234567', package_name: 'סושיאל', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  editor_name: null, editor: null, deal_at: '2026-05-10T07:00:00Z', char_at: null, shoot_at: null, contract_end: '2027-05-10', status: 'active', notes: null, quote_id: null,
  created_at: IMPORTED, created_by_email: 'system', links: {}, deliverables: { videos: 20, graphics: 35, shoot_days: 1 }, rounds: [], verified_at: null, verified_by: null,
  closed_reason: null, archived_at: null, archived_by: null, protocol_version: 7,
  landing: true, landed_at: null, landed_by: null, landing_slot: null, ...fields,
});
const db = {
  clients: [
    // The old system said "new"; its meeting and its shoot day were months ago.
    client('דנה', 'קפה דנה', { char_at: '2026-05-14T08:00:00Z', shoot_at: '2026-06-20T06:00:00Z', editor: 'nadia' }),
    // Waiting for its shoot day next week.
    client('משה', 'מוסך הצפון', { char_at: '2026-09-14T08:00:00Z', shoot_at: '2026-10-28T06:00:00Z', editor: 'anna' }),
    // Nothing is known about it.
    client('רון', 'פיצה רון', { editor: 'anna' }),
    // Publishing for months: only the weekly call and the month's items.
    client('יעל', 'מספרת יעל', { char_at: '2026-05-14T08:00:00Z', shoot_at: '2026-06-01T06:00:00Z', editor: 'nadia' }),
    // In editing, with Nadia.
    client('נועה', 'סטודיו נועה', { char_at: '2026-08-14T08:00:00Z', shoot_at: '2026-10-01T06:00:00Z', editor: 'nadia' }),
    // Signed two minutes ago: never in landing.
    client('גיל', 'לקוח חדש', { deal_at: minutesAgo(2), created_at: minutesAgo(2), landing: false, quote_id: null, created_by_email: 'irit@astrateg.test', verified_at: minutesAgo(1) }),
  ],
  protocol_checks: [], client_tasks: [], client_landing_marks: [], client_landing_done: [], protocol_log: [],
};
const C = (business) => db.clients.find((c) => c.business === business);
const seed = (business, station, extra = []) => {
  for (const k of [...importKeys(station, { shootSet: !!C(business).shoot_at })]) db.protocol_checks.push({ client_id: C(business).id, item_key: k, state: 'done', note: IMPORT_NOTE, by_email: '', at: IMPORTED });
  for (const k of extra) db.protocol_checks.push({ client_id: C(business).id, item_key: k, state: 'done', note: null, by_email: 'ofir@astrateg.test', at: '2026-10-12T08:00:00Z' });
};
seed('מוסך הצפון', 'content');
seed('מספרת יעל', 'ongoing');
seed('סטודיו נועה', 'post', clientState(C('סטודיו נועה'), {}, NOW).states.find((s) => s.proc.id === 'p22a').proc.items.map((i) => i.key));

// The fake's own view of the data, in the shapes the logic reads.
const checksBy = () => { const o = {}; for (const r of db.protocol_checks) (o[r.client_id] ||= {})[r.item_key] = r; return o; };
const marksBy = () => { const o = {}; for (const r of db.client_landing_marks) (o[r.client_id] ||= {})[r.item_key] = r; return o; };
const doneBy = () => { const o = {}; for (const r of db.client_landing_done) (o[r.client_id] ||= {})[r.person] = r; return o; };
const listOf = (person) => intakeFor(person, db.clients, checksBy(), marksBy(), doneBy(), new Date(serverNow()));
const waitingOn = (business) => waitingPeople(C(business), checksBy()[C(business).id] || {}, marksBy()[C(business).id] || {}, doneBy()[C(business).id] || {}, new Date(serverNow()));
const board = () => landingBoard(db.clients, checksBy(), marksBy(), doneBy(), new Date(serverNow()));

const calls = [];
const before = { landing: false, intake: false }; // the migrations that are not applied yet
const sees = (u, c) => !!c && !c.archived_at && (isOffice(u) || (!!personOf(u) && c.editor === personOf(u)));

function release(c, by) {
  for (const m of db.client_landing_marks.filter((x) => x.client_id === c.id && (x.choice === 'done' || x.choice === 'na'))) {
    if (db.protocol_checks.some((x) => x.client_id === c.id && x.item_key === m.item_key)) continue;
    db.protocol_checks.push({ client_id: c.id, item_key: m.item_key, state: m.choice === 'na' ? 'na' : 'done', note: IMPORT_NOTE, by_email: by, at: serverNow() });
  }
  Object.assign(c, { landing: false, landed_at: serverNow(), landed_by: by, landing_slot: db.clients.filter((x) => x.landed_at).length % 10 });
}

function rpc(name, body, me, json) {
  if (name === 'is_staff') return json(200, !!rowOf(me));
  if (name === 'is_office') return json(200, isOffice(me));
  if (/^can_/.test(name)) return json(200, false);
  if (name.startsWith('landing_')) {
    calls.push({ fn: name, body, by: me?.email || null });
    if (before.intake) return json(404, { code: 'PGRST202', message: `Could not find the function public.${name}` });
    if (!rowOf(me)) return json(403, { code: '42501', message: 'not allowed' });
  }
  if (name === 'landing_take') {
    const person = personOf(me);
    const c = db.clients.find((x) => x.id === body.p_client);
    if (!person || !sees(me, c)) return json(403, { code: '42501', message: 'not allowed' });
    if (!c.landing) return json(400, { code: 'P0001', message: 'not in landing: this client is already active' });
    for (const [k, v] of Object.entries(body.p_marks || {})) {
      if (!['done', 'open', 'na'].includes(v)) return json(400, { code: '22023', message: 'bad choice' });
      if (!mayWrite({ person, client: c, key: k })) return json(403, { code: '42501', message: 'not allowed: not your item' });
    }
    for (const [k, v] of Object.entries(body.p_marks || {})) {
      db.client_landing_marks = db.client_landing_marks.filter((x) => !(x.client_id === c.id && x.item_key === k));
      db.client_landing_marks.push({ client_id: c.id, item_key: k, choice: v, person, by_email: me.email, at: serverNow() });
    }
    let released = false;
    if (body.p_done !== null && body.p_done !== undefined) {
      db.client_landing_done = db.client_landing_done.filter((x) => !(x.client_id === c.id && x.person === person));
      db.client_landing_done.push({ client_id: c.id, person, done: body.p_done, by_email: me.email, at: serverNow() });
      if (body.p_done && Array.isArray(body.p_waiting)
        && body.p_waiting.every((p) => p === person || db.client_landing_done.some((x) => x.client_id === c.id && x.person === p && x.done))) {
        release(c, me.email);
        released = true;
      }
    }
    return json(200, { landing: !released });
  }
  if (name === 'landing_done_for' || name === 'landing_activate') {
    if (!isOwner(me)) return json(403, { code: '42501', message: 'not allowed' });
    const list = db.clients.filter((c) => (body.p_clients || []).includes(c.id) && c.landing);
    if (name === 'landing_activate') { for (const c of list) release(c, me.email); return json(200, list.length); }
    for (const c of list) {
      db.client_landing_done = db.client_landing_done.filter((x) => !(x.client_id === c.id && x.person === body.p_person));
      db.client_landing_done.push({ client_id: c.id, person: body.p_person, done: true, by_email: me.email, at: serverNow() });
    }
    return json(200, list.length);
  }
  return json(200, []);
}

function matches(r, k, v) {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('neq.')) return String(r[k]) !== v.slice(4);
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(r[k]));
  return true;
}
const SKIP = new Set(['select', 'order', 'offset', 'limit', 'on_conflict', 'columns', 'or']);
const filtered = (rows, url) => rows.filter((r) => [...url.searchParams.entries()].every(([k, v]) => SKIP.has(k) || !(k in r) || matches(r, k, v)));
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
  if (p.startsWith('/functions/v1/')) return json(200, {});
  if (p.startsWith('/rest/v1/rpc/')) return rpc(p.slice('/rest/v1/rpc/'.length), body || {}, me, json);
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  const table = m[1];
  if (table === 'staff') {
    const eq = url.searchParams.get('email');
    return answer(req, json)(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff);
  }
  if (table === 'clients') {
    const cols = url.searchParams.get('select') || '';
    if (req.method() !== 'GET') { calls.push({ directWrite: req.method(), body, by: me.email }); return json(403, { code: '42501', message: 'permission denied' }); }
    if (before.landing && /landing|landed_/.test(`${cols} ${url.searchParams.get('or') || ''}`)) return json(400, { code: '42703', message: 'column clients.landing does not exist' });
    if (before.intake && /landing_slot/.test(cols)) return json(400, { code: '42703', message: 'column clients.landing_slot does not exist' });
    const rows = filtered(db.clients.filter((c) => sees(me, c)), url);
    return answer(req, json)(before.landing ? rows.map(({ landing, landed_at, landed_by, landing_slot, ...r }) => r) : rows);
  }
  if (table === 'client_landing_marks' || table === 'client_landing_done') {
    if (before.intake || before.landing) return json(404, { code: 'PGRST205', message: `Could not find the table public.${table}` });
    if (req.method() !== 'GET') { calls.push({ directWrite: req.method(), table, by: me.email }); return json(403, { code: '42501', message: 'permission denied' }); }
    return json(200, db[table].filter((r) => sees(me, db.clients.find((c) => c.id === r.client_id))));
  }
  if (table === 'protocol_checks') {
    const mine = (r) => sees(me, db.clients.find((c) => c.id === r.client_id));
    if (req.method() === 'GET') return answer(req, json)(filtered(db.protocol_checks.filter(mine), url));
    // Imported history is written by the office only (private.protocol_write_ok).
    if (req.method() === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      for (const r of rows) {
        const c = db.clients.find((x) => x.id === r.client_id);
        if (!sees(me, c) || !mayWrite({ person: personOf(me), client: c, key: r.item_key, note: r.note })) return json(403, { code: '42501', message: 'new row violates row-level security policy' });
      }
      const out = rows.map((r) => {
        db.protocol_checks = db.protocol_checks.filter((x) => !(x.client_id === r.client_id && x.item_key === r.item_key));
        const row = { client_id: r.client_id, item_key: r.item_key, state: r.state, note: r.note ?? null, by_email: me.email, at: serverNow() };
        db.protocol_checks.push(row);
        return row;
      });
      calls.push({ checks: 'set', n: out.length, note: rows[0]?.note, by: me.email });
      return answer(req, json)(out);
    }
    if (req.method() === 'DELETE') {
      const gone = filtered(db.protocol_checks.filter(mine), url);
      if (!isOffice(me)) return json(403, { code: '42501', message: 'permission denied' });
      db.protocol_checks = db.protocol_checks.filter((r) => !gone.includes(r));
      calls.push({ checks: 'clear', n: gone.length, by: me.email });
      return json(200, []);
    }
  }
  if (req.method() !== 'GET') return json(200, []);
  return answer(req, json)(filtered(db[table] || [], url));
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newPage(viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time: new Date(serverNow()) });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => db.clients, staff: () => staff }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  watchCsp(page);
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  return page;
}
async function signIn(page, path, who) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.locator('#app:not([hidden])').waitFor();
  await page.waitForLoadState('networkidle');
}
const PHONE = { width: 390, height: 844 };
const shot = async (page, name, fullPage = true) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage }); };
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.offsetParent && el.getBoundingClientRect().height < 43.5)
  .map((el) => `${el.textContent.trim().slice(0, 24)}:${Math.round(el.getBoundingClientRect().height)}`), sel);
const cardOf = (page, business) => page.locator('.land-card', { hasText: business });
// The items one by one are folded under the two quick buttons.
const showItems = async (page, business) => { const d = cardOf(page, business).locator('details.land-more'); if (!(await d.evaluate((e) => e.open))) await d.locator('summary').click(); };
const cards = (page) => page.locator('.land-card').evaluateAll((els) => els.map((e) => e.dataset.id));
const toastOf = (page) => page.locator('#toast.on > span').innerText();
const lineOf = async (page) => ((await page.locator('#land-line').isHidden()) ? null : (await page.locator('#land-line').innerText()).replace(/\s+/g, ' ').trim());
const lateMarks = (page, root) => page.evaluate((r) => [...document.querySelectorAll(`${r} .s-overdue, ${r} .is-late, ${r} .late, ${r} .tag-warn, ${r} .tag-urgent`)].filter((e) => e.offsetParent).length, root);
const lastTake = () => calls.filter((c) => c.fn === 'landing_take').at(-1);
const settle = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(80); };
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
  const irit = await newPage(PHONE);
  await signIn(irit, 'clients.html#mine', 'irit');
  const iritAtStart = listOf('irit');

  await step('Irit, 390px: one line at the top of "המשימות שלי"; the old clients are in no list and no clock, the client signed today is', async () => {
    assert.ok(iritAtStart.length >= 3 && ['קפה דנה', 'מוסך הצפון', 'פיצה רון'].every((b) => iritAtStart.some((x) => x.client.business === b)), 'the scenario');
    assert.equal(await lineOf(irit), `יש ${iritAtStart.length} לקוחות קיימים לקלוט לקליטה`);
    // The line is the first thing under the tabs, above the panel and its cards.
    assert.equal(await irit.evaluate(() => document.getElementById('view-mine').previousElementSibling.id), 'land-line');
    assert.equal(await irit.locator('#view-mine > *').first().getAttribute('id'), 'now-bar');
    const mine = await irit.locator('#view-mine').innerText();
    for (const b of ['קפה דנה', 'מוסך הצפון', 'פיצה רון', 'מספרת יעל', 'סטודיו נועה']) assert.ok(!mine.includes(b), `${b} is in the list`);
    assert.ok(mine.includes('לקוח חדש'), 'the client signed today is in the list');
    assert.ok((await irit.locator('#now-bar').innerText()).includes('לקוח חדש'), 'and its clock runs');
    assert.ok(!(await irit.locator('#now-bar').innerText()).includes('קפה דנה'));
    assert.ok(await irit.locator('#land-quiet').isHidden());
    assert.deepEqual(await smallTargets(irit, '#land-line a'), []);
    assert.ok(await noSideScroll(irit));
    await shot(irit, '01-irit-mine-390');
  });

  await step('the intake screen: her clients, her items only, three choices each, no clock and no colour of lateness', async () => {
    await irit.click('#land-line a');
    await irit.locator('.land-card').first().waitFor();
    assert.deepEqual((await cards(irit)).sort(), iritAtStart.map((x) => x.client.id).sort());
    assert.equal((await irit.locator('#land-progress .land-count').innerText()).trim(), `נשארו ${iritAtStart.length} מתוך ${iritAtStart.length} לקוחות`);
    for (const x of iritAtStart) {
      const keys = await irit.locator(`.land-card[data-id="${x.client.id}"] .land-choice[data-choice="done"]`).evaluateAll((els) => els.map((e) => e.dataset.key));
      assert.deepEqual(keys, x.items.map((i) => i.key), clientLabel(x.client));
      for (const k of keys) assert.ok(mayWrite({ person: 'irit', client: x.client, key: k }));
    }
    // Each card opens short: the quick buttons, and "פריט־פריט" one tap away.
    assert.equal(await irit.locator('.land-choice:visible').count(), 0);
    assert.match((await cardOf(irit, 'פיצה רון').locator('details.land-more > summary').innerText()).trim(), /^פריט־פריט \(\d+\)$/);
    assert.deepEqual(await cardOf(irit, 'פיצה רון').locator('.land-actions button').allInnerTexts(), ['הכול כבר בוצע אצלי בלקוח הזה', 'הכול עדיין פתוח · סיימתי']);
    await showItems(irit, 'פיצה רון');
    assert.deepEqual(await cardOf(irit, 'פיצה רון').locator('.land-item').first().locator('.land-choice').allInnerTexts(), ['כבר בוצע', 'עדיין פתוח', 'לא רלוונטי']);
    assert.equal(await lateMarks(irit, '#app'), 0);
    assert.ok(!/באיחור|יעד:|נגמר|דק׳/.test(await irit.locator('#app').innerText()));
    assert.ok(await noSideScroll(irit));
    assert.deepEqual(await smallTargets(irit, '.land-app button, .land-app select, .land-app a'), []);
    // The office corrects the station here; the proposal is shown, not applied.
    assert.equal(await irit.locator('.land-station').count(), iritAtStart.length);
    assert.match(await cardOf(irit, 'קפה דנה').locator('.land-proposal p').innerText(), /ההצעה: יום הצילום כבר היה \(20\.6\), ולכן \d+ פריטים כבר בוצעו/);
    assert.equal(await cardOf(irit, 'פיצה רון').locator('.land-proposal').count(), 0);
    assert.equal(await irit.locator('.land-choice.is-on').count(), 0);
    assert.equal(db.client_landing_marks.length, 0);
    await shot(irit, '02-irit-intake-390');
  });

  await step('one tap accepts the proposal and finishes the client; nothing of the protocol is touched', async () => {
    const p = proposalFor('irit', C('קפה דנה'), {}, {}, NOW);
    const checksBefore = db.protocol_checks.length;
    await cardOf(irit, 'קפה דנה').locator('[data-act="accept"]').click();
    await cardOf(irit, 'קפה דנה').locator('.land-fin').waitFor();
    const call = lastTake();
    assert.equal(call.by, 'irit@astrateg.test');
    assert.equal(call.body.p_done, true);
    for (const k of p.done) assert.equal(call.body.p_marks[k], 'done', k);
    for (const k of p.open) assert.equal(call.body.p_marks[k], 'open', k);
    assert.ok(Array.isArray(call.body.p_waiting) && call.body.p_waiting.length > 0 && !call.body.p_waiting.includes('irit'));
    assert.equal(db.protocol_checks.length, checksBefore);
    assert.equal(C('קפה דנה').landing, true, 'others have not finished: still in landing');
    // Her answers opened the next items in the protocol (sending the videos…): not answered, so open.
    assert.match(await cardOf(irit, 'קפה דנה').locator('.land-fin').innerText(), /קפה דנה · דנה\s*נקלט · (הכול כבר בוצע|\d+ פריטים נשארו פתוחים|פריט אחד נשאר פתוח)\s*ביטול/);
    assert.equal((await irit.locator('#land-progress .land-count').innerText()).trim(), `נשארו ${iritAtStart.length - 1} מתוך ${iritAtStart.length} לקוחות`);
    assert.equal(await toastOf(irit), 'קפה דנה · דנה: ההצעה התקבלה.');
    assert.equal(db.client_landing_marks.filter((m) => m.client_id === C('קפה דנה').id).every((m) => m.person === 'irit' && m.by_email === 'irit@astrateg.test' && m.at), true);
  });

  await step('a wrong tap is taken back: "ביטול" reopens the client with its answers, and one answer is changed', async () => {
    await cardOf(irit, 'קפה דנה').locator('[data-act="undo"]').click();
    await cardOf(irit, 'קפה דנה').locator('.land-items').waitFor();
    assert.deepEqual([lastTake().body.p_done, lastTake().body.p_marks], [false, {}]);
    assert.equal(db.client_landing_done.find((d) => d.client_id === C('קפה דנה').id && d.person === 'irit').done, false);
    const first = cardOf(irit, 'קפה דנה').locator('.land-item').first();
    assert.equal(await first.locator('.land-choice.is-on').innerText(), 'כבר בוצע');
    await first.locator('.land-choice[data-choice="open"]').click();
    await first.locator('.land-choice[data-choice="open"].is-on').waitFor();
    assert.deepEqual(Object.values(lastTake().body.p_marks), ['open']);
    assert.equal(lastTake().body.p_done, null);
    assert.equal(await first.locator('.land-choice[data-choice="open"]').getAttribute('aria-pressed'), 'true');
    // "Everything of mine here was done", in one tap.
    await cardOf(irit, 'קפה דנה').locator('[data-act="all"]').click();
    await cardOf(irit, 'קפה דנה').locator('.land-fin').waitFor();
    assert.ok(Object.values(lastTake().body.p_marks).every((v) => v === 'done'));
    assert.ok(db.client_landing_marks.filter((m) => m.client_id === C('קפה דנה').id && m.person === 'irit').every((m) => m.choice === 'done'));
  });

  let ronOpen = null;
  await step('item by item: "עדיין פתוח", "לא רלוונטי", and "סיימתי" records the rest as open', async () => {
    const card = cardOf(irit, 'פיצה רון');
    const items = intakeItems('irit', C('פיצה רון'), {}, {}, NOW);
    ronOpen = items[0];
    await showItems(irit, 'פיצה רון');
    await card.locator(`.land-choice[data-key="${items[0].key}"][data-choice="open"]`).click();
    await card.locator(`.land-choice[data-key="${items[0].key}"].is-on`).waitFor();
    await card.locator(`.land-choice[data-key="${items[1].key}"][data-choice="na"]`).click();
    await card.locator(`.land-choice[data-key="${items[1].key}"].is-on`).waitFor();
    await card.locator(`.land-choice[data-key="${items[2].key}"][data-choice="done"]`).click();
    await card.locator(`.land-choice[data-key="${items[2].key}"].is-on`).waitFor();
    await card.locator('[data-act="finish"]').click();
    await card.locator('.land-fin').waitFor();
    const mine = Object.fromEntries(db.client_landing_marks.filter((m) => m.client_id === C('פיצה רון').id).map((m) => [m.item_key, m.choice]));
    assert.equal(mine[items[0].key], 'open');
    assert.equal(mine[items[1].key], 'na');
    assert.equal(mine[items[2].key], 'done');
    assert.ok(items.slice(3).every((i) => mine[i.key] === 'open'), 'what was not answered stays open');
    assert.match(await card.locator('.land-fin').innerText(), /נקלט · \d+ פריטים נשארו פתוחים|נקלט · פריט אחד נשאר פתוח/);
  });

  await step('the office corrects the station in one step, as the import form marks it', async () => {
    const c = C('מוסך הצפון');
    const card = cardOf(irit, 'מוסך הצפון');
    assert.equal((await card.locator('.land-head .tag').innerText()).trim(), 'לפי המערכת: תוכן ואישור');
    const had = db.protocol_checks.filter((r) => r.client_id === c.id).length;
    await showItems(irit, 'מוסך הצפון');
    await card.locator('select.land-st').selectOption('shoot');
    await card.locator('[data-act="station"]').click();
    await irit.locator('#toast.on').waitFor();
    assert.equal(await toastOf(irit), 'מוסך הצפון · משה: התחנה תוקנה ל״יום צילום״.');
    const now = db.protocol_checks.filter((r) => r.client_id === c.id);
    assert.deepEqual(now.map((r) => r.item_key).sort(), importKeys('shoot').sort());
    assert.ok(now.length > had && now.every((r) => r.note === IMPORT_NOTE && r.state === 'done'));
    assert.equal(calls.filter((x) => x.checks === 'set').at(-1).by, 'irit@astrateg.test');
    assert.equal(c.landing, true, 'correcting the station does not activate');
    await settle(irit);
    // Back one station: the imported marks from it on are taken back.
    const back = cardOf(irit, 'מוסך הצפון');
    if (await back.count()) {
      assert.equal((await back.locator('.land-head .tag').innerText()).trim(), 'לפי המערכת: יום צילום');
    }
    assert.deepEqual((await cards(irit)).sort(), listOf('irit').map((x) => x.client.id).sort());
  });

  await step('when she is done the line disappears; what she left open waits under the list with no clock', async () => {
    // Whatever is still unanswered: "סיימתי" on each.
    for (let i = 0; i < 6 && intakeLeft(listOf('irit')) > 0; i += 1) {
      await irit.locator('.land-card:not(.is-finished) [data-act="finish"]').first().click();
      await settle(irit);
    }
    assert.equal(intakeLeft(listOf('irit')), 0);
    assert.match((await irit.locator('#land-progress .land-count').innerText()).trim(), /^סיימת: \d+ לקוחות נקלטו$/);
    assert.match(await irit.locator('#land-progress').innerText(), /לקוח יוצא מקליטה כשכל מי שיש לו בו עבודה סיים לעבור עליו, או כשהבעלים מפעילים/);
    await shot(irit, '03-irit-done-390');
    await irit.goto(`${BASE}clients.html#mine`);
    await irit.locator('#mine-list').waitFor();
    await settle(irit);
    assert.equal(await lineOf(irit), null);
    assert.ok(!(await irit.locator('#land-quiet').isHidden()));
    const quiet = await irit.locator('#land-quiet').innerText();
    assert.match(quiet, /בקליטה · בלי שעון/);
    await irit.locator('#land-quiet summary').click();
    assert.ok((await irit.locator('#land-quiet').innerText()).includes('פיצה רון'));
    assert.ok((await irit.locator('#land-quiet').innerText()).includes(ronOpen.label));
    assert.equal(await lateMarks(irit, '#land-quiet'), 0);
    assert.ok(!(await irit.locator('#mine-list').innerText()).includes('פיצה רון'), 'not in the live list while in landing');
    assert.ok(await noSideScroll(irit));
    await shot(irit, '04-irit-mine-after-390');
  });

  await step('the clients list and the client card say "בקליטה", quietly, with no lateness', async () => {
    await irit.goto(`${BASE}clients.html#clients`);
    await irit.locator('#client-list .crow').first().waitFor();
    const rows = await irit.locator('#client-list .crow').evaluateAll((els) => els.map((e) => [e.querySelector('strong').textContent, !!e.querySelector('.tag-landing')]));
    assert.deepEqual(Object.fromEntries(rows), { 'קפה דנה · דנה': true, 'מוסך הצפון · משה': true, 'פיצה רון · רון': true, 'מספרת יעל · יעל': true, 'סטודיו נועה · נועה': true, 'לקוח חדש · גיל': false });
    assert.equal(await lateMarks(irit, '#client-list li:has(.tag-landing)'), 0);
    await irit.goto(`${BASE}client.html?id=${C('קפה דנה').id}`);
    await irit.locator('#land-note').waitFor();
    assert.match(await irit.locator('#land-note').innerText(), /בקליטה\s*הלקוח הגיע מהמערכת הישנה ועוד לא הופעל: אין עליו שעונים, איחורים או התראות/);
    assert.equal(await irit.locator('#land-activate').count(), 0, 'only the owners activate');
    assert.equal(await irit.locator('#cc-head .s-overdue').count(), 0);
    assert.equal(await irit.locator('.proc.s-overdue, .pcard.s-overdue').count(), 0);
    assert.ok(!/באיחור/.test(await irit.locator('#cc-head').innerText()));
  });

  await step('an editor sees only the clients she edits and only her own items; the database refuses anything else', async () => {
    const nadia = await newPage(PHONE);
    await signIn(nadia, 'clients.html#mine', 'nadia');
    const hers = listOf('nadia');
    assert.deepEqual(hers.map((x) => x.client.business), ['סטודיו נועה']);
    assert.equal(await lineOf(nadia), 'יש לקוח קיים אחד לקלוט לקליטה');
    await nadia.click('#land-line a');
    await nadia.locator('.land-card').first().waitFor();
    assert.deepEqual(await cards(nadia), [C('סטודיו נועה').id]);
    const keys = await nadia.locator('.land-choice[data-choice="done"]').evaluateAll((els) => els.map((e) => e.dataset.key));
    assert.deepEqual(keys, hers[0].items.map((i) => i.key));
    assert.ok(keys.length > 0 && keys.every((k) => mayWrite({ person: 'nadia', client: C('סטודיו נועה'), key: k })));
    assert.equal(await nadia.locator('.land-station').count(), 0, 'the station is the office\'s to correct');
    assert.ok(await noSideScroll(nadia));
    // Straight at the database: an item of Lior's on her client, her item on a client that is not hers, the columns themselves.
    const tryTake = (client, key) => nadia.evaluate(async ([url, token, c, k]) => {
      const r = await fetch(`${url}/rest/v1/rpc/landing_take`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_client: c, p_marks: { [k]: 'done' }, p_done: null, p_waiting: null }) });
      return r.status;
    }, ['https://czncjzziqrqtezpwxxpz.supabase.co', jwtFor(users.get('nadia@astrateg.test')), client.id, key]);
    assert.equal(await tryTake(C('סטודיו נועה'), 'p18.scripts'), 403);
    assert.equal(await tryTake(C('פיצה רון'), keys[0]), 403);
    assert.equal(await nadia.evaluate(async ([url, token, id]) => (await fetch(`${url}/rest/v1/rpc/landing_activate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_clients: [id] }) })).status,
      ['https://czncjzziqrqtezpwxxpz.supabase.co', jwtFor(users.get('nadia@astrateg.test')), C('סטודיו נועה').id]), 403);
    assert.ok(db.client_landing_marks.every((m) => m.person !== 'nadia'));
    await shot(nadia, '05-editor-intake-390');
    await nadia.context().close();
    // Anna has nothing to take in: no line, and the screen says so. A sales agent has no clients at all.
    const anna = await newPage(PHONE);
    await signIn(anna, 'clients.html#mine', 'anna');
    assert.deepEqual(listOf('anna'), []);
    assert.equal(await lineOf(anna), null);
    await anna.goto(`${BASE}landing.html`);
    await anna.locator('#land-progress .land-empty').waitFor();
    assert.match(await anna.locator('#land-progress').innerText(), /אין לקוחות קיימים שמחכים לך/);
    assert.equal(await anna.locator('.land-card').count(), 0);
    await anna.context().close();
  });

  await step('the last person to finish activates the client: what stayed open is live, with a fresh deadline and not late', async () => {
    const c = C('פיצה רון');
    // Everyone but Lior has finished it.
    for (const p of waitingOn('פיצה רון').filter((x) => x !== 'lior')) db.client_landing_done.push({ client_id: c.id, person: p, done: true, by_email: `${p}@astrateg.test`, at: serverNow() });
    assert.deepEqual(waitingOn('פיצה רון'), ['lior']);
    const lior = await newPage({ width: 1366, height: 900 });
    await signIn(lior, 'landing.html', 'lior');
    await lior.locator('.land-card').first().waitFor();
    await shot(lior, '06-lior-intake-1366');
    assert.ok(await noSideScroll(lior));
    await cardOf(lior, 'פיצה רון').locator('[data-act="finish"]').click();
    await lior.locator('#toast.on').waitFor();
    assert.equal(await toastOf(lior), 'פיצה רון · רון הופעל: כולם סיימו לעבור עליו.');
    assert.deepEqual(lastTake().body.p_waiting, []);
    assert.deepEqual([c.landing, c.landed_by, !!c.landed_at], [false, 'lior@astrateg.test', true]);
    await settle(lior);
    assert.equal(await cardOf(lior, 'פיצה רון').count(), 0);
    // Irit's "לא רלוונטי" and "כבר בוצע" became imported history; her open item did not.
    const got = Object.fromEntries(db.protocol_checks.filter((r) => r.client_id === c.id).map((r) => [r.item_key, `${r.state}:${r.note}`]));
    assert.equal(got[ronOpen.key], undefined);
    assert.ok(Object.values(got).length >= 2 && Object.values(got).every((v) => v === `done:${IMPORT_NOTE}` || v === `na:${IMPORT_NOTE}`));
    // In the logic: nothing overdue, every deadline at or after the fresh one.
    const s = clientState(c, checksBy()[c.id], new Date(serverNow()));
    assert.equal(s.overdue, 0);
    assert.ok(s.states.filter((x) => !x.complete && x.dueAt && x.proc.due?.from !== 'contractEnd').every((x) => x.dueAt >= freshDeadline(new Date(c.landed_at))));
    await lior.context().close();
    // On Irit's phone: the item is in her list now, with a deadline, and not under "באיחור".
    await irit.goto(`${BASE}clients.html#mine`);
    await irit.locator('#mine-list').waitFor();
    await settle(irit);
    assert.ok((await irit.locator('#mine-list').innerText()).includes('פיצה רון'));
    assert.equal(await irit.locator('#mine-list .g-overdue', { hasText: 'פיצה רון' }).count(), 0);
    assert.ok(!(await irit.locator('#now-bar').innerText().catch(() => '')).includes('פיצה רון'), 'no five-minute clock from months ago');
    if (!(await irit.locator('#land-quiet').isHidden())) assert.ok(!(await irit.locator('#land-quiet').innerText()).includes('פיצה רון'));
    await shot(irit, '07-irit-mine-activated-390');
  });

  const owner = await newPage({ width: 1366, height: 900 });
  await step('the owners: a line on their tasks, and on "מבט מנהל" who took in how many, with the "מפעילים" actions', async () => {
    await signIn(owner, 'clients.html#mine', 'owner');
    const b = board();
    assert.equal(await lineOf(owner), `${b.total} לקוחות קיימים עדיין בקליטה להפעלה`);
    await owner.click('#land-line a');
    await owner.locator('#landing:not([hidden]) h2').waitFor();
    assert.equal((await owner.locator('#landing h2').innerText()).trim(), 'קליטת הלקוחות הקיימים');
    assert.match(await owner.locator('#landing').innerText(), new RegExp(`${b.total} לקוחות בקליטה: בלי שעונים, בלי איחורים ובלי התראות, עד שמפעילים`));
    const rows = await owner.locator('#landing [data-person]').evaluateAll((els) => els.map((e) => [e.dataset.person, e.querySelector('.land-ctl-text').textContent]));
    assert.deepEqual(rows.map((r) => r[0]), b.people.map((p) => p.key));
    const irow = b.people.find((p) => p.key === 'irit');
    assert.ok(rows.find((r) => r[0] === 'irit')[1].startsWith(`עירית · עבר/ה על ${irow.finished} מתוך ${irow.total}`));
    assert.equal(irow.left.length, 0);
    assert.equal(await owner.locator('#landing [data-person="irit"] button').count(), 0, 'Irit finished: nothing to press');
    assert.ok(b.ready.some((c) => c.business === 'מספרת יעל'), 'a client with nothing to take in is ready');
    assert.match(await owner.locator('#landing').innerText(), /יום צילום ב־14 הימים הקרובים: 1 · מוסך הצפון · משה/);
    assert.match(await owner.locator('#landing').innerText(), /התזכורות שלהם כבויות עד ההפעלה/);
    assert.equal(await lateMarks(owner, '#landing'), 0);
    await shot(owner, '08-owner-control-1366');
  });

  await step('"מפעילים" asks once more, then activates: the ready clients, and the ones with a shoot day ahead', async () => {
    // The shoot day next week first (the client may be "ready" as well).
    await owner.click('#landing [data-act="soon"]');
    assert.equal(C('מוסך הצפון').landing, true, 'the first tap only asks');
    await owner.click('#landing [data-act="soon"]');
    await owner.waitForFunction(() => !document.querySelector('#landing [data-act="soon"]'));
    assert.deepEqual(calls.filter((c) => c.fn === 'landing_activate').at(-1).body.p_clients, [C('מוסך הצפון').id]);
    assert.deepEqual([C('מוסך הצפון').landing, C('מוסך הצפון').landed_by], [false, 'owner@astrateg.test']);
    await settle(owner);
    const ready = board().ready.map((c) => c.id);
    const n = calls.filter((c) => c.fn === 'landing_activate').length;
    await owner.click('#landing [data-act="ready"]');
    assert.equal(calls.filter((c) => c.fn === 'landing_activate').length, n, 'the first tap only asks');
    assert.equal((await owner.locator('#landing [data-act="ready"]').innerText()).trim(), 'בטוח? מפעילים');
    await owner.click('#landing [data-act="ready"]');
    await owner.locator('#toast.on').waitFor();
    assert.deepEqual(calls.filter((c) => c.fn === 'landing_activate').at(-1).body.p_clients.sort(), ready.sort());
    assert.match(await toastOf(owner), /יצאו מקליטה\. המועדים נספרים מעכשיו\./);
    assert.equal(C('מספרת יעל').landing, false);
    await settle(owner);
    assert.notEqual(C('מוסך הצפון').landing_slot, C('מספרת יעל').landing_slot);
  });

  await step('"מפעילים את ליאור" closes his part; a client that then waits for nobody is activated, the others stay', async () => {
    await settle(owner);
    const b = board();
    const lrow = b.people.find((p) => p.key === 'lior');
    assert.ok(lrow && lrow.left.length > 0, 'Lior still has clients to go over');
    const freeAfter = lrow.left.filter((c) => waitingOn(c.business).every((p) => p === 'lior')).map((c) => c.id);
    const staying = lrow.left.filter((c) => !freeAfter.includes(c.id)).map((c) => c.id);
    await owner.click('#landing [data-act="person:lior"]');
    await owner.click('#landing [data-act="person:lior"]');
    await owner.locator('#toast.on').waitFor();
    await settle(owner);
    const done = calls.filter((c) => c.fn === 'landing_done_for').at(-1);
    assert.deepEqual([done.body.p_person, done.body.p_clients.slice().sort()], ['lior', lrow.left.map((c) => c.id).sort()]);
    for (const id of lrow.left.map((c) => c.id)) assert.ok(db.client_landing_done.some((d) => d.client_id === id && d.person === 'lior' && d.done && d.by_email === 'owner@astrateg.test'));
    for (const id of freeAfter) assert.equal(db.clients.find((c) => c.id === id).landing, false);
    for (const id of staying) assert.equal(db.clients.find((c) => c.id === id).landing, true);
    assert.ok(staying.length > 0, 'the scenario: someone else has not finished');
  });

  await step('the client card of an owner activates one client; "מפעילים את כולם" ends the landing and the control goes away', async () => {
    const left = board().clients;
    assert.ok(left.length >= 2);
    const card = await newPage({ width: 1366, height: 900 });
    await signIn(card, `client.html?id=${left[0].id}`, 'owner');
    await card.locator('#land-activate').waitFor();
    await card.click('#land-activate');
    await card.waitForFunction(() => !document.getElementById('land-note'));
    assert.equal(left[0].landing, false);
    assert.equal(await card.locator('.tag-landing').count(), 0);
    await card.context().close();
    await owner.reload();
    await owner.locator('#landing:not([hidden]) h2').waitFor();
    await owner.click('#landing [data-act="all"]');
    await owner.click('#landing [data-act="all"]');
    await owner.locator('#landing[hidden]').waitFor({ state: 'attached' });
    assert.equal(db.clients.filter((c) => c.landing).length, 0);
    assert.equal(await owner.locator('#landing *').count(), 0);
    await owner.goto(`${BASE}clients.html#mine`);
    await owner.locator('#mine-list').waitFor();
    await settle(owner);
    assert.equal(await lineOf(owner), null);
    // Nothing was born late: no client has an overdue process on the day of its activation.
    for (const c of db.clients.filter((x) => x.landed_at)) {
      const s = clientState(c, checksBy()[c.id] || {}, new Date(serverNow()));
      assert.deepEqual(s.states.filter((x) => x.status === 'overdue' && x.proc.due?.from !== 'contractEnd').map((x) => x.proc.id), [], c.business);
    }
  });

  await step('nobody but the owners has the control', async () => {
    for (const who of ['irit', 'ofir']) {
      C('קפה דנה').landing = true; // one client back in landing, to have something to show
      const page = await newPage();
      await signIn(page, 'owner.html', who);
      await page.waitForLoadState('networkidle');
      assert.ok(await page.locator('#landing').isHidden(), who);
      assert.equal(await page.locator('#landing *').count(), 0, who);
      await page.context().close();
    }
    C('קפה דנה').landing = false;
  });

  await step('before the migrations: no line, no tag, no screen, and the pages work', async () => {
    for (const c of db.clients.slice(0, 2)) Object.assign(c, { landing: true, landed_at: null });
    before.landing = true;
    const page = await newPage(PHONE);
    await signIn(page, 'clients.html#mine', 'irit');
    await page.locator('#mine-list').waitFor();
    assert.equal(await lineOf(page), null);
    await page.goto(`${BASE}clients.html#clients`);
    await page.locator('#client-list .crow').first().waitFor();
    assert.equal(await page.locator('#client-list .tag-landing').count(), 0);
    await page.goto(`${BASE}landing.html`);
    await page.locator('#land-progress .land-empty').waitFor();
    await page.context().close();
    // The first migration only: clients are quiet, and the intake screen says it is not there yet.
    before.landing = false;
    before.intake = true;
    const mid = await newPage(PHONE);
    await signIn(mid, 'clients.html#mine', 'irit');
    await mid.locator('#mine-list').waitFor();
    assert.equal(await lineOf(mid), null);
    assert.ok(!(await mid.locator('#mine-list').innerText()).includes('קפה דנה'), 'quiet');
    await mid.goto(`${BASE}clients.html#clients`);
    await mid.locator('#client-list .crow').first().waitFor();
    assert.equal(await mid.locator('#client-list .tag-landing').count(), 2, 'the tag needs only the first migration');
    await mid.context().close();
    before.intake = false;
    for (const c of db.clients) c.landing = false;
  });

  assert.equal(calls.filter((c) => c.directWrite).length, 0, 'no page writes the clients table or the landing tables directly');
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
